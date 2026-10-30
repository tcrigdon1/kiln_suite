/* Cutline — Web Audio mixing engine. Clips are scheduled as AudioBufferSourceNodes with sample-accurate
   gain envelopes (keyframed volume, fades, audio transitions) -> pan -> clip effects -> track bus -> master. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, P = C.P, KF = C.KF;
  var MX = C.Mixer = { ctx: null, buses: null, sources: [], levelsCache: null };

  MX.ensure = function () {
    if (!MX.ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      MX.ctx = new AC({ latencyHint: 'interactive' });
      MX.master = MX.ctx.createGain();
      MX.masterMeter = makeMeter(MX.ctx);
      MX.master.connect(MX.masterMeter.input);
      MX.master.connect(MX.ctx.destination);
      MX.trackNodes = {};
      C.FX.loadWorklets(MX.ctx);
    }
    if (MX.ctx.state === 'suspended') MX.ctx.resume().catch(function () { });
    return MX.ctx;
  };

  function makeMeter(ctx) {
    var sp = ctx.createChannelSplitter(2), a = ctx.createAnalyser(), b = ctx.createAnalyser();
    a.fftSize = 1024; b.fftSize = 1024;
    sp.connect(a, 0); sp.connect(b, 1);
    return { input: sp, an: [a, b], buf: new Float32Array(1024) };
  }
  function meterLevel(m) {
    var out = [0, 0];
    for (var c = 0; c < 2; c++) {
      m.an[c].getFloatTimeDomainData(m.buf);
      var pk = 0, d = m.buf;
      for (var i = 0; i < d.length; i++) { var v = d[i] < 0 ? -d[i] : d[i]; if (v > pk) pk = v; }
      out[c] = pk;
    }
    return out;
  }

  function anySolo(seq) { return seq.tracks.some(function (t) { return t.kind === 'audio' && t.solo; }); }
  MX.trackAudible = function (seq, t) {
    if (t.mute) return false;
    if (anySolo(seq) && !t.solo) return false;
    return true;
  };

  // Persistent realtime track buses
  MX.updateTracks = function (seq) {
    if (!MX.ctx || !seq) return;
    var ctx = MX.ctx;
    P.atracks(seq).forEach(function (t) {
      var n = MX.trackNodes[t.id];
      if (!n) {
        n = MX.trackNodes[t.id] = { gain: ctx.createGain(), pan: ctx.createStereoPanner(), meter: makeMeter(ctx) };
        n.gain.connect(n.pan); n.pan.connect(n.meter.input); n.pan.connect(MX.master);
      }
      var g = MX.trackAudible(seq, t) ? U.dbToGain(t.vol || 0) : 0;
      n.gain.gain.setTargetAtTime(g, ctx.currentTime, 0.015);
      n.pan.pan.setTargetAtTime(U.clamp((t.pan || 0) / 100, -1, 1), ctx.currentTime, 0.015);
    });
    if (seq.masterVol != null) MX.master.gain.setTargetAtTime(U.dbToGain(seq.masterVol), ctx.currentTime, 0.015);
    MX.updateLimiter(seq);
  };
  // master limiter (realtime): master -> limiter -> meter + destination, rebuilt when its settings change
  MX.updateLimiter = function (seq) {
    var ctx = MX.ctx, ml = seq.masterLimit, want = ml && ml.on ? JSON.stringify([ml.ceil == null ? -1 : ml.ceil, ml.rel || 120, !!ctx.__gateReady]) : '';
    if (want === (MX.limSig || '')) return;
    if (want && !ctx.__gateReady) { C.FX.loadWorklets(ctx).then(function () { MX.limSig = null; MX.updateLimiter(P.seq() || seq); }); }
    try { MX.master.disconnect(); } catch (e) { }
    if (MX.limNode) { try { MX.limNode.output.disconnect(); } catch (e) { } MX.limNode = null; }
    if (want) {
      MX.limNode = C.FX.limiterNode(ctx, ml.ceil == null ? -1 : ml.ceil, ml.rel || 120);
      MX.master.connect(MX.limNode.input); MX.limNode.output.connect(MX.masterMeter.input); MX.limNode.output.connect(ctx.destination);
    } else { MX.master.connect(MX.masterMeter.input); MX.master.connect(ctx.destination); }
    MX.limSig = want;
  };

  // Build buses on an arbitrary (offline) context
  function buildBuses(ctx, dest, seq) {
    var map = {}, master = ctx.createGain();
    master.gain.value = U.dbToGain(seq.masterVol || 0);
    if (seq.masterLimit && seq.masterLimit.on) { var lim = C.FX.limiterNode(ctx, seq.masterLimit.ceil == null ? -1 : seq.masterLimit.ceil, seq.masterLimit.rel || 120); master.connect(lim.input); lim.output.connect(dest); }
    else master.connect(dest);
    P.atracks(seq).forEach(function (t) {
      var g = ctx.createGain(), p = ctx.createStereoPanner();
      g.gain.value = MX.trackAudible(seq, t) ? U.dbToGain(t.vol || 0) : 0;
      p.pan.value = U.clamp((t.pan || 0) / 100, -1, 1);
      g.connect(p); p.connect(master);
      map[t.id] = g;
    });
    return map;
  }

  MX.buildBuses = buildBuses;

  /* ---------- Buffer variants: reversed / time-stretched (pitch preserved) ---------- */
  var variantCache = {}, VARIANT_MAX = 24;
  function trimVariants() { var ks = Object.keys(variantCache); while (ks.length > VARIANT_MAX) delete variantCache[ks.shift()]; }
  MX.reversed = function (mediaId, buf) {
    var k = mediaId + '|rev';
    if (variantCache[k] && variantCache[k].src === buf) return variantCache[k].buf;
    var ctx = new OfflineAudioContext(buf.numberOfChannels, 1, buf.sampleRate);
    var nb = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
    for (var c = 0; c < buf.numberOfChannels; c++) { var s = buf.getChannelData(c), d = nb.getChannelData(c), n = s.length; for (var i = 0; i < n; i++) d[i] = s[n - 1 - i]; }
    variantCache[k] = { src: buf, buf: nb }; trimVariants();
    return nb;
  };
  // WSOLA time-stretch (speed > 1 = faster). Returns AudioBuffer of length len/speed.
  MX.timeStretch = function (buf, speed) {
    var N = 2048, Hs = N / 2, Ha = Hs * speed, tol = 384;
    var chs = buf.numberOfChannels, inLen = buf.length, outLen = Math.max(1, Math.floor(inLen / speed));
    var ctx = new OfflineAudioContext(chs, 1, buf.sampleRate);
    var nb = ctx.createBuffer(chs, outLen, buf.sampleRate);
    var win = new Float32Array(N); for (var i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    var ins = [], outs = []; for (var c = 0; c < chs; c++) { ins.push(buf.getChannelData(c)); outs.push(nb.getChannelData(c)); }
    var mono = ins[0];
    if (chs > 1) { mono = new Float32Array(inLen); for (var j = 0; j < inLen; j++) mono[j] = (ins[0][j] + ins[1][j]) * 0.5; }
    var prevPos = 0, frames = Math.ceil(outLen / Hs) + 1;
    for (var k = 0; k < frames; k++) {
      var outPos = k * Hs, ideal = Math.round(k * Ha), pos = ideal;
      if (k > 0) {
        var natural = prevPos + Hs, best = -Infinity, bestOff = 0;
        for (var off = -tol; off <= tol; off += 4) {
          var p = ideal + off; if (p < 0 || p + N >= inLen) continue;
          var sum = 0;
          for (var q = 0; q < Hs; q += 8) { var a = natural + q; if (a >= inLen) break; sum += mono[a] * mono[p + q]; }
          if (sum > best) { best = sum; bestOff = off; }
        }
        pos = Math.max(0, ideal + bestOff);
      }
      for (var cc = 0; cc < chs; cc++) {
        var src = ins[cc], dst = outs[cc];
        for (var s = 0; s < N; s++) { var oi = outPos + s, ii = pos + s; if (oi >= outLen) break; if (ii < inLen) dst[oi] += src[ii] * win[s]; }
      }
      prevPos = pos;
    }
    return nb;
  };
  var stretchJobs = {};
  MX.stretched = function (mediaId, buf, speed, reverse) {
    var k = mediaId + '|st|' + speed.toFixed(4) + (reverse ? '|r' : '');
    var e = variantCache[k];
    if (e && e.src === buf) return e.buf;
    if (!stretchJobs[k]) {
      stretchJobs[k] = true;
      setTimeout(function () {
        try {
          var base = reverse ? MX.reversed(mediaId, buf) : buf;
          variantCache[k] = { src: buf, buf: MX.timeStretch(base, speed) }; trimVariants();
          C.bus.emit('audio:variant');
        } catch (err) { console.warn('[Cutline] time-stretch failed', err); }
        delete stretchJobs[k];
      }, 10);
    }
    return null;
  };
  MX.stretchedSync = function (mediaId, buf, speed, reverse) {
    var k = mediaId + '|st|' + speed.toFixed(4) + (reverse ? '|r' : '');
    var e = variantCache[k];
    if (e && e.src === buf) return e.buf;
    var base = reverse ? MX.reversed(mediaId, buf) : buf;
    var nb = MX.timeStretch(base, speed);
    variantCache[k] = { src: buf, buf: nb }; trimVariants();
    return nb;
  };

  /* ---------- Speed ramps: varispeed rendering of the clip's timeline window ----------
     A ramped clip is rendered once into a buffer that runs at rate 1 along the timeline (pitch follows the speed,
     like tape); `base` holds source audio whose sample 0 is source time baseT0. Covers timeline [ws, we] frames. */
  MX.buildRamped = function (seq, clip, base, baseT0, ws, we) {
    var fps = seq.fps, sr = base.sampleRate, chs = base.numberOfChannels, N = Math.max(1, Math.ceil((we - ws) / fps * sr));
    var out = new AudioBuffer({ length: N, numberOfChannels: chs, sampleRate: sr }), ins = [], outs = [];
    for (var c = 0; c < chs; c++) { ins.push(base.getChannelData(c)); outs.push(out.getChannelData(c)); }
    var len = base.length, lf0 = ws - clip.start, step = fps / sr;
    for (var i = 0; i < N; i++) {
      var src = C.T.rampSrc(seq, clip, lf0 + i * step), x = (src - baseT0) * sr;
      if (x < 0 || x >= len - 1) continue;
      var j = Math.floor(x), k = x - j;
      for (c = 0; c < chs; c++) { var d = ins[c]; outs[c][i] = d[j] + (d[j + 1] - d[j]) * k; }
    }
    return out;
  };
  function rampSig(seq, clip, win) { return clip.id + '|ramp|' + JSON.stringify(clip.kf['tm.speed']) + '|' + clip.in + '|' + clip.dur + '|' + clip.start + '|' + win.ws + '|' + win.we + (clip.reverse ? 'r' : ''); }
  MX.ramped = function (seq, clip, base, win, sync) {
    var k = rampSig(seq, clip, win), e = variantCache[k];
    if (e && e.src === base) return e.buf;
    if (sync) { var nb = MX.buildRamped(seq, clip, base, 0, win.ws, win.we); variantCache[k] = { src: base, buf: nb }; trimVariants(); return nb; }
    if (!stretchJobs[k]) {
      stretchJobs[k] = true;
      setTimeout(function () {
        try { variantCache[k] = { src: base, buf: MX.buildRamped(seq, clip, base, 0, win.ws, win.we) }; trimVariants(); C.bus.emit('audio:variant'); }
        catch (err) { console.warn('[Cutline] speed ramp render failed', err); }
        delete stretchJobs[k];
      }, 10);
    }
    return null;
  };
  // streamed (long) media: decode just the used source range, then render the ramp from it
  MX.rampStreamed = function (m, seq, clip, win, offline) {
    var r = usedRange(seq, clip, m), key = rampSig(seq, clip, win) + '|' + r.a.toFixed(3) + '|' + r.b.toFixed(3);
    if (r.b - r.a > MX.STRETCH_MAX) return null;
    var e = stretchCache.filter(function (x) { return x.key === key; })[0];
    if (e && e.buf) return e;
    if (!e) {
      e = { key: key };
      e.p = C.AudioStream.decodeRange(m, r.a, r.b).then(function (buf) { e.buf = MX.buildRamped(seq, clip, buf, r.a, win.ws, win.we); return e; });
      stretchCache.push(e); while (stretchCache.length > 6) stretchCache.shift();
      if (!offline) e.p.then(function () { C.bus.emit('audio:variant'); }, function () { });
    }
    return null;
  };
  function scheduleRamped(ctx, seq, clip, rb, win, t0, t1, from, when0, bus, opts, srcs) {
    var fps = seq.fps, rate = opts.rate || 1, when = when0 + (t0 - from) / rate, dur = (t1 - t0) / rate;
    var src = ctx.createBufferSource(); src.buffer = rb; src.playbackRate.value = rate;
    src.connect(buildChain(ctx, seq, clip, win, t0, t1, when, dur, bus));
    try { src.start(Math.max(when, ctx.currentTime), Math.max(0, t0 - win.ws / fps), Math.max(0.001, t1 - t0)); srcs.push(src); }
    catch (e) { console.warn('[Cutline] ramp start failed', e); }
  }

  /* ---------- Envelope ---------- */
  MX.clipWindow = function (seq, clip) {
    var ws = clip.start, we = clip.start + clip.dur, tin = null, tout = null;
    seq.transitions.forEach(function (tr) {
      var def = C.TR.byId[tr.type]; if (!def || def.kind !== 'audio') return;
      if (tr.b === clip.id || tr.a === clip.id) {
        var rr = P.transitionRange(seq, tr);
        if (tr.b === clip.id) { ws = Math.min(ws, rr.start); tin = { s: rr.start, e: rr.end, type: tr.type }; }
        if (tr.a === clip.id) { we = Math.max(we, rr.end); tout = { s: rr.start, e: rr.end, type: tr.type }; }
      }
    });
    return { ws: ws, we: we, tin: tin, tout: tout };
  };
  // gain (linear) of a clip at sequence time f (frames, float)
  MX.clipGainAt = function (seq, clip, f, win) {
    var lf = U.clamp(f - clip.start, 0, clip.dur - 1);
    var db = KF.value(clip, 'au.vol', lf) + (clip.au.gain || 0);
    var g = U.dbToGain(db);
    var rel = f - clip.start;
    if (clip.fadeIn > 0 && rel < clip.fadeIn) g *= U.clamp(rel / clip.fadeIn, 0, 1);
    var toEnd = clip.start + clip.dur - f;
    if (clip.fadeOut > 0 && toEnd < clip.fadeOut) g *= U.clamp(toEnd / clip.fadeOut, 0, 1);
    if (win.tin && f < win.tin.e) g *= f < win.tin.s ? 0 : C.TR.audioGains(win.tin.type, (f - win.tin.s) / (win.tin.e - win.tin.s))[1];
    if (win.tout && f > win.tout.s) g *= f > win.tout.e ? 0 : C.TR.audioGains(win.tout.type, (f - win.tout.s) / (win.tout.e - win.tout.s))[0];
    if (!win.tin && rel < 0) g = 0;
    if (!win.tout && toEnd <= 0) g = 0;
    return g;
  };

  /* ---------- Scheduling ---------- */
  // Schedule all audio of seq from timeline second `from` at context time `when0`. opts: {to, buses, rate}
  MX.schedule = function (ctx, seq, from, when0, buses, opts) {
    opts = opts || {};
    var fps = seq.fps, srcs = [], to = opts.to != null ? opts.to : Infinity;
    seq.clips.forEach(function (clip) {
      if (clip.kind !== 'audio' || clip.enabled === false || clip.au.mute) return;
      var bus = buses[clip.trackId]; if (!bus) return;
      var m = P.media(clip.mediaId); if (!m) return;
      if (m.type === 'nest') { scheduleNest(ctx, seq, clip, m, from, when0, bus, opts, to, srcs); return; }
      var streamed = C.Media.isStreamed && C.Media.isStreamed(m);
      var base = streamed ? null : C.Media.audioBuffer(m); if (!base && !streamed) return;
      var win = MX.clipWindow(seq, clip);
      var t0 = Math.max(win.ws / fps, from), t1 = Math.min(win.we / fps, to);
      if (t1 - t0 < 0.001) return;
      if (clip.freeze == null && C.T.hasRamp(clip)) {
        var rb = null, rtl = C.MRT[C.Media.base(m).id] || {};
        if (!rtl.loop) {
          if (streamed) { var se = MX.rampStreamed(m, seq, clip, win, opts.offline); rb = se && se.buf; }
          else rb = MX.ramped(seq, clip, base, win, !!opts.offline);
          if (rb) { scheduleRamped(ctx, seq, clip, rb, win, t0, t1, from, when0, bus, opts, srcs); return; }
          if (!streamed) return; // rendering in the background: 'audio:variant' restarts playback
        }
      }
      if (streamed) { if (clip.freeze == null) scheduleStream(ctx, seq, clip, m, win, t0, t1, from, when0, bus, opts, srcs); return; }
      var speed = clip.speed, rt = C.MRT[m.id] || {};
      var buf = base, rate = speed, reverse = clip.reverse;
      var mapOffset; // timeline sec -> buffer offset sec
      if (clip.freeze != null) return;
      if (speed !== 1 && clip.au.pitch !== false && !rt.loop) {
        var st = opts.offline ? MX.stretchedSync(m.id, base, speed, reverse) : MX.stretched(m.id, base, speed, reverse);
        if (st) { buf = st; rate = 1; }
      }
      var stretchedUsed = buf !== base;
      if (reverse && !stretchedUsed) buf = MX.reversed(m.id, base);
      mapOffset = function (ts) {
        var s = P.sourceSec(seq, clip, ts * fps) + (reverse ? 1 / fps * speed : 0); // continuous source time
        var off = reverse ? base.duration - s : s;
        if (stretchedUsed) off = off / speed;
        return off;
      };
      var off0 = mapOffset(t0);
      // handle negative offsets (before media start)
      if (off0 < 0) { t0 += -off0 / rate; off0 = 0; if (t1 - t0 < 0.001) return; }
      var src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate * (opts.rate || 1);
      if (rt.loop) { src.loop = true; off0 = off0 % buf.duration; }
      var when = when0 + (t0 - from) / (opts.rate || 1), dur = (t1 - t0) / (opts.rate || 1);
      src.connect(buildChain(ctx, seq, clip, win, t0, t1, when, dur, bus));
      try { src.start(Math.max(when, ctx.currentTime), Math.max(0, off0), Math.max(0.001, (t1 - t0) * rate)); }
      catch (e) { console.warn('[Cutline] audio start failed', e); return; }
      srcs.push(src);
    });
    return srcs;
  };

  // Per-clip processing chain: sample-accurate gain envelope (keyframed volume, fades, audio transitions) -> pan
  // (static or keyframed) -> clip audio effects -> track bus. Returns the chain's input node.
  function buildChain(ctx, seq, clip, win, t0, t1, when, dur, bus) {
    var fps = seq.fps, g = ctx.createGain(), pan = ctx.createStereoPanner();
    // gain curve at ~200 Hz (capped: a multi-hour clip gets a coarser but still continuous curve)
    var n = Math.max(2, Math.min(200000, Math.ceil(dur * 200)));
    var curve = new Float32Array(n);
    for (var i = 0; i < n; i++) { var ts = t0 + (t1 - t0) * (i / (n - 1)); curve[i] = MX.clipGainAt(seq, clip, ts * fps, win); }
    try { g.gain.setValueCurveAtTime(curve, Math.max(when, ctx.currentTime), Math.max(0.002, dur - Math.max(0, ctx.currentTime - when))); }
    catch (e) { g.gain.value = curve[0]; }
    if (KF.has(clip, 'au.pan')) {
      var pc = new Float32Array(Math.max(2, Math.min(100000, Math.ceil(dur * 50))));
      for (var j = 0; j < pc.length; j++) { var tt = t0 + (t1 - t0) * (j / (pc.length - 1)); pc[j] = U.clamp(KF.value(clip, 'au.pan', U.clamp(tt * fps - clip.start, 0, clip.dur - 1)) / 100, -1, 1); }
      try { pan.pan.setValueCurveAtTime(pc, Math.max(when, ctx.currentTime), Math.max(0.002, dur)); } catch (e) { pan.pan.value = pc[0]; }
    } else pan.pan.value = U.clamp((clip.au.pan || 0) / 100, -1, 1);
    g.connect(pan);
    var last = pan;
    (clip.fx || []).forEach(function (fx) {
      if (!fx.on) return;
      var def = C.FX.byId[fx.type]; if (!def || !def.audio) return;
      try {
        var p = Object.assign(C.FX.defaults(fx.type), fx.p);
        var nodes = def.build(ctx, p);
        last.connect(nodes.input); last = nodes.output;
      } catch (e) { console.warn('[Cutline] audio fx failed', e); }
    });
    last.connect(bus);
    return g;
  }

  /* ---------- Streamed sources (long media): 10 s PCM chunks scheduled just ahead of the playhead ---------- */
  MX.streamJobs = [];
  MX.STRETCH_MAX = 900; // longest used range (s) that is time-stretched with pitch preserved; longer -> rate change
  function srcMap(seq, clip) {
    var fps = seq.fps, st = clip.start / fps, durSec = clip.dur / fps, sp = C.T.hasRamp(clip) ? C.T.srcSpan(seq, clip, clip.dur) / Math.max(1e-6, durSec) : clip.speed;
    if (clip.reverse) return { S: function (ts) { return clip.in + (durSec - (ts - st)) * sp; }, T: function (s) { return st + durSec - (s - clip.in) / sp; } };
    return { S: function (ts) { return clip.in + (ts - st) * sp; }, T: function (s) { return st + (s - clip.in) / sp; } };
  }
  MX.srcMap = srcMap;
  var revCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function reversedChunk(buf) {
    var r = revCache && revCache.get(buf); if (r) return r;
    r = new AudioBuffer({ length: buf.length, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
    for (var c = 0; c < buf.numberOfChannels; c++) { var s = buf.getChannelData(c), d = r.getChannelData(c), n = s.length; for (var i = 0; i < n; i++) d[i] = s[n - 1 - i]; }
    if (revCache) revCache.set(buf, r);
    return r;
  }
  function scheduleStream(ctx, seq, clip, m, win, t0, t1, from, when0, bus, opts, srcs) {
    var rate = opts.rate || 1, when = when0 + (t0 - from) / rate, dur = (t1 - t0) / rate;
    var job = { ctx: ctx, seq: seq, clip: clip, m: m, map: srcMap(seq, clip), t0: t0, t1: t1, from: from, when0: when0, rate: rate, speed: clip.speed,
      reverse: clip.reverse, srcs: srcs, done: {}, req: {}, offline: !!opts.offline };
    job.input = buildChain(ctx, seq, clip, win, t0, t1, when, dur, bus);
    if (clip.speed !== 1 && clip.au.pitch !== false) {
      var st = MX.streamStretch(m, seq, clip, opts.offline);
      if (st) { scheduleStretched(job, st); return; }
    }
    if (opts.offline) { pumpJob(job, Infinity); return; }
    if (opts.scrub) { pumpJob(job, 0.2); return; }
    MX.streamJobs.push(job); pumpJob(job); ensureStreamTimer();
  }
  function pumpJob(job, horizon) {
    if (job.dead) return;
    var ctx = job.ctx, CH = C.AudioStream.CHUNK;
    var nowT = job.offline ? job.t0 : job.from + Math.max(0, ctx.currentTime - job.when0) * job.rate;
    var hA = Math.max(job.t0, nowT), hB = Math.min(job.t1, nowT + (horizon == null ? 15 : horizon) * job.rate);
    if (hB <= hA) return;
    var sA = job.map.S(hA), sB = job.map.S(hB); if (sA > sB) { var tmp = sA; sA = sB; sB = tmp; }
    var i0 = Math.max(0, Math.floor(sA / CH)), i1 = Math.floor(Math.max(sA, sB - 1e-9) / CH);
    for (var i = i0; i <= i1; i++) {
      if (job.done[i]) continue;
      var buf = C.AudioStream.cached(job.m, i);
      if (!buf) {
        if (!job.offline && !job.req[i]) { job.req[i] = 1; C.AudioStream.chunk(job.m, i, true).then(function () { if (!job.dead) pumpJob(job); }, function () { }); }
        continue;
      }
      job.done[i] = 1;
      scheduleChunk(job, i, buf);
    }
  }
  function scheduleChunk(job, i, buf) {
    var ctx = job.ctx, cs = (buf.t0 != null ? buf.t0 : i * C.AudioStream.CHUNK), ce = cs + buf.duration;
    var ta = job.map.T(cs), tb = job.map.T(ce); if (ta > tb) { var tmp = ta; ta = tb; tb = tmp; }
    var a = Math.max(ta, job.t0), b = Math.min(tb, job.t1); if (b - a < 1e-4) return;
    var sb = job.reverse ? reversedChunk(buf) : buf;
    var offset = job.reverse ? (ce - job.map.S(a)) : (job.map.S(a) - cs);
    var when = job.when0 + (a - job.from) / job.rate, durBuf = (b - a) * job.speed;
    if (!job.offline && when < ctx.currentTime) { var late = ctx.currentTime - when; offset += late * job.rate * job.speed; durBuf -= late * job.rate * job.speed; when = ctx.currentTime; if (durBuf <= 0.0005) return; }
    var src = ctx.createBufferSource(); src.buffer = sb; src.playbackRate.value = job.speed * job.rate;
    src.connect(job.input);
    try { src.start(when, Math.max(0, offset), Math.max(0.0005, durBuf)); job.srcs.push(src); } catch (e) { console.warn('[Cutline] stream chunk start failed', e); }
  }
  function scheduleStretched(job, st) {
    var ctx = job.ctx, a = job.t0, b = job.t1;
    var offset = job.reverse ? (st.b - job.map.S(a)) / job.speed : (job.map.S(a) - st.a) / job.speed;
    var when = job.when0 + (a - job.from) / job.rate, d = (b - a);
    if (!job.offline && when < ctx.currentTime) { var late = ctx.currentTime - when; offset += late * job.rate; d -= late * job.rate; when = ctx.currentTime; if (d <= 0.0005) return; }
    var src = ctx.createBufferSource(); src.buffer = st.buf; src.playbackRate.value = job.rate;
    src.connect(job.input);
    try { src.start(when, Math.max(0, offset), Math.max(0.0005, d)); job.srcs.push(src); } catch (e) { console.warn('[Cutline] stretched start failed', e); }
  }
  var streamTimer = null;
  function ensureStreamTimer() {
    if (streamTimer) return;
    streamTimer = setInterval(function () {
      MX.streamJobs = MX.streamJobs.filter(function (j) { return !j.dead && (j.from + (j.ctx.currentTime - j.when0) * j.rate) < j.t1; });
      if (!MX.streamJobs.length) { clearInterval(streamTimer); streamTimer = null; return; }
      MX.streamJobs.forEach(function (j) { pumpJob(j); });
    }, 200);
  }
  // Used source range of a clip (including transition handles), clamped to the media
  function usedRange(seq, clip, m) {
    var win = MX.clipWindow(seq, clip), map = srcMap(seq, clip);
    var a = map.S(win.ws / seq.fps), b = map.S(win.we / seq.fps); if (a > b) { var t = a; a = b; b = t; }
    return { a: Math.max(0, a - 0.25), b: Math.min(m.duration || b + 0.25, b + 0.25) };
  }
  var stretchCache = [];
  function stretchKey(m, seq, clip) { var r = usedRange(seq, clip, m); return { key: C.Media.base(m).id + '|' + r.a.toFixed(3) + '|' + r.b.toFixed(3) + '|' + clip.speed.toFixed(4) + (clip.reverse ? 'r' : ''), r: r }; }
  // Pitch-preserving stretch of only the clip's used range (decoded on demand). Null while pending / too long.
  MX.streamStretch = function (m, seq, clip, offline) {
    var k = stretchKey(m, seq, clip);
    if (k.r.b - k.r.a > MX.STRETCH_MAX) return null;
    var e = stretchCache.filter(function (x) { return x.key === k.key; })[0];
    if (e && e.buf) return e;
    if (!e && !offline) MX.prepareStretch(m, seq, clip).then(function () { C.bus.emit('audio:variant'); }, function () { });
    return null;
  };
  MX.prepareStretch = function (m, seq, clip) {
    var k = stretchKey(m, seq, clip);
    if (k.r.b - k.r.a > MX.STRETCH_MAX) return Promise.resolve(null);
    var e = stretchCache.filter(function (x) { return x.key === k.key; })[0];
    if (e) return e.p;
    e = { key: k.key, a: k.r.a, b: k.r.b };
    e.p = C.AudioStream.decodeRange(m, k.r.a, k.r.b).then(function (buf) {
      var src = clip.reverse ? reversedChunk(buf) : buf;
      e.buf = MX.timeStretch(src, clip.speed);
      return e;
    });
    stretchCache.push(e); while (stretchCache.length > 6) stretchCache.shift();
    return e.p;
  };
  // Load everything streamed clips need to render [from, to] offline (chunks pinned until unpin)
  MX.prefetch = function (seq, from, to, pins, depth) {
    var jobs = [], fps = seq.fps;
    if ((depth || 0) > 3) return Promise.resolve();
    seq.clips.forEach(function (clip) {
      if (clip.kind !== 'audio' || clip.enabled === false || clip.au.mute || clip.freeze != null) return;
      var m = P.media(clip.mediaId); if (!m) return;
      var win = MX.clipWindow(seq, clip), t0 = Math.max(win.ws / fps, from), t1 = Math.min(win.we / fps, to);
      if (t1 - t0 < 0.001) return;
      if (m.type === 'nest') {
        var inner = P.seqById(m.seqId); if (!inner || clip.reverse) return;
        var sp = clip.speed || 1;
        jobs.push(MX.prefetch(inner, clip.in + (t0 - clip.start / fps) * sp, clip.in + (t1 - clip.start / fps) * sp, pins, (depth || 0) + 1));
        return;
      }
      if (!C.Media.isStreamed(m)) return;
      if (C.T.hasRamp(clip)) { var rr = usedRange(seq, clip, m); if (rr.b - rr.a <= MX.STRETCH_MAX) { MX.rampStreamed(m, seq, clip, win, true); var je = stretchCache[stretchCache.length - 1]; if (je && je.p) jobs.push(je.p); return; } }
      if (clip.speed !== 1 && clip.au.pitch !== false && stretchKey(m, seq, clip).r.b - stretchKey(m, seq, clip).r.a <= MX.STRETCH_MAX) { jobs.push(MX.prepareStretch(m, seq, clip)); return; }
      var map = srcMap(seq, clip), a = map.S(t0), b = map.S(t1); if (a > b) { var t = a; a = b; b = t; }
      jobs.push(C.AudioStream.ensure(m, Math.max(0, a), b, pins));
    });
    return Promise.all(jobs);
  };

  // Nested sequence audio: schedule the inner sequence through this clip's gain/pan/effects
  function scheduleNest(ctx, seq, clip, m, from, when0, bus, opts, to, srcs) {
    var inner = P.seqById(m.seqId), depth = (opts.depth || 0);
    if (!inner || depth > 3) return;
    var fps = seq.fps, rate = opts.rate || 1;
    var win = MX.clipWindow(seq, clip);
    var t0 = Math.max(win.ws / fps, from), t1 = Math.min(win.we / fps, to);
    if (t1 - t0 < 0.001) return;
    var g = ctx.createGain(), pan = ctx.createStereoPanner();
    var when = when0 + (t0 - from) / rate, dur = (t1 - t0) / rate;
    var n = Math.max(2, Math.min(200000, Math.ceil(dur * 200))), curve = new Float32Array(n);
    for (var i = 0; i < n; i++) { var ts = t0 + (t1 - t0) * (i / (n - 1)); curve[i] = MX.clipGainAt(seq, clip, ts * fps, win); }
    try { g.gain.setValueCurveAtTime(curve, Math.max(when, ctx.currentTime), Math.max(0.002, dur)); } catch (e) { g.gain.value = curve[0]; }
    pan.pan.value = U.clamp((clip.au.pan || 0) / 100, -1, 1);
    g.connect(pan);
    var last = pan;
    (clip.fx || []).forEach(function (fx) {
      if (!fx.on) return; var def = C.FX.byId[fx.type]; if (!def || !def.audio) return;
      try { var nodes = def.build(ctx, Object.assign(C.FX.defaults(fx.type), fx.p)); last.connect(nodes.input); last = nodes.output; } catch (e) { }
    });
    last.connect(bus);
    var innerBuses = buildBuses(ctx, g, inner);
    if (clip.reverse) return;
    var sp = clip.speed || 1; // inner time = in + (outer - start) * speed
    var inner0 = clip.in + (t0 - clip.start / fps) * sp, inner1 = clip.in + (t1 - clip.start / fps) * sp;
    MX.schedule(ctx, inner, inner0, when, innerBuses, { to: inner1, rate: rate * sp, offline: opts.offline, depth: depth + 1 }).forEach(function (s) { srcs.push(s); });
  }

  /* ---------- Realtime transport ---------- */
  MX.start = function (seq, fromSec, rate) {
    MX.stop();
    var ctx = MX.ensure();
    MX.updateTracks(seq);
    var buses = {};
    P.atracks(seq).forEach(function (t) { if (MX.trackNodes[t.id]) buses[t.id] = MX.trackNodes[t.id].gain; });
    var when = ctx.currentTime + 0.06;
    MX.sources = MX.schedule(ctx, seq, fromSec, when, buses, { rate: rate || 1 });
    MX.t0 = fromSec; MX.when0 = when; MX.rate = rate || 1;
    return when;
  };
  MX.stop = function () {
    MX.streamJobs.forEach(function (j) { j.dead = true; }); MX.streamJobs = [];
    MX.sources.forEach(function (s) { try { s.stop(); } catch (e) { } try { s.disconnect(); } catch (e) { } });
    MX.sources = [];
  };
  MX.now = function () { return MX.ctx ? MX.ctx.currentTime : performance.now() / 1000; };

  MX.scrub = U.throttle(function (seq, frame) {
    if (!C.prefs.audioScrub) return;
    var ctx = MX.ensure();
    MX.updateTracks(seq);
    var buses = {};
    P.atracks(seq).forEach(function (t) { if (MX.trackNodes[t.id]) buses[t.id] = MX.trackNodes[t.id].gain; });
    var s = frame / seq.fps;
    var srcs = MX.schedule(ctx, seq, s, ctx.currentTime + 0.01, buses, { to: s + 0.075, scrub: true });
    setTimeout(function () { srcs.forEach(function (x) { try { x.stop(); x.disconnect(); } catch (e) { } }); }, 300);
  }, 45);

  MX.levels = function (seq) {
    if (!MX.ctx) return null;
    var out = { master: meterLevel(MX.masterMeter), tracks: {} };
    if (seq) P.atracks(seq).forEach(function (t) { var n = MX.trackNodes[t.id]; if (n) out.tracks[t.id] = meterLevel(n.meter); });
    return out;
  };

  /* ---------- Offline mixdown ---------- */
  // Single-pass render of a range (short ranges). Long ranges are rendered block by block (see renderBlocks)
  // and concatenated, so an OfflineAudioContext never spans a multi-hour duration.
  MX.renderOffline = function (seq, fromSec, toSec, sampleRate) {
    sampleRate = sampleRate || 48000;
    if (toSec - fromSec > MX.SINGLE_PASS_MAX) {
      var len0 = Math.max(1, Math.ceil((toSec - fromSec) * sampleRate)), out = new AudioBuffer({ length: len0, numberOfChannels: 2, sampleRate: sampleRate }), pos = 0;
      return MX.renderBlocks(seq, fromSec, toSec, sampleRate, function (L, R) {
        var n = Math.min(L.length, len0 - pos); if (n <= 0) return;
        out.getChannelData(0).set(L.subarray(0, n), pos); out.getChannelData(1).set(R.subarray(0, n), pos); pos += n;
      }).then(function () { return out; });
    }
    var len = Math.max(1, Math.ceil((toSec - fromSec) * sampleRate));
    var ctx = new OfflineAudioContext(2, len, sampleRate), pins = [];
    return MX.prefetch(seq, fromSec, toSec, pins).then(function () { return worklets(ctx, seq); }).then(function () {
      var buses = buildBuses(ctx, ctx.destination, seq);
      MX.schedule(ctx, seq, fromSec, 0, buses, { to: toSec, offline: true });
      return ctx.startRendering();
    }).then(function (b) { C.AudioStream.unpin(pins); return b; }, function (e) { C.AudioStream.unpin(pins); throw e; });
  };
  MX.SINGLE_PASS_MAX = 600;
  // AudioWorklets (only the noise gate uses one) cost a worklet global scope per OfflineAudioContext, which adds up
  // over the dozens of blocks of a long export — load them only when the mix actually contains a gate.
  function needsWorklet(seq, depth) {
    if ((depth || 0) > 4) return false;
    if (seq.masterLimit && seq.masterLimit.on) return true;
    return seq.clips.some(function (c) {
      if ((c.fx || []).some(function (f) { return f.on && (f.type === 'a_gate' || f.type === 'a_limit' || f.type === 'a_denoise'); })) return true;
      var m = c.kind === 'audio' ? P.media(c.mediaId) : null;
      return !!(m && m.type === 'nest' && P.seqById(m.seqId) && needsWorklet(P.seqById(m.seqId), (depth || 0) + 1));
    });
  }
  MX.needsWorklet = needsWorklet;
  function worklets(ctx, seq) { return needsWorklet(seq) ? C.FX.loadWorklets(ctx) : Promise.resolve(false); }
  MX.BLOCK_SEC = 30;
  // Mix [fromSec, toSec) in fixed blocks (default 30 s) with 2 s of pre-roll each, so effects have settled state at
  // block starts. Each block only decodes the source audio it uses. onBlock(L, R, blockStartSec, index) may return
  // a promise (back-pressure). Block boundaries are exact sample multiples, so the blocks concatenate seamlessly.
  MX.renderBlocks = function (seq, fromSec, toSec, sampleRate, onBlock, opts) {
    opts = opts || {};
    var br = MX.blockRenderer(seq, fromSec, toSec, sampleRate, opts);
    function loop() {
      if (opts.cancel && opts.cancel.v) return Promise.resolve();
      return br.next().then(function (b) { if (!b) return; return Promise.resolve(onBlock(b.L, b.R, b.t, b.index)).then(loop); });
    }
    return loop();
  };
  // Pull-style block renderer (the exporter interleaves audio blocks with video frames): next() -> {L, R, t, index, n} | null
  MX.blockRenderer = function (seq, fromSec, toSec, sampleRate, opts) {
    opts = opts || {};
    sampleRate = sampleRate || 48000;
    var blockN = Math.round((opts.block || MX.BLOCK_SEC) * sampleRate), preMax = Math.round(2 * sampleRate);
    var total = Math.max(1, Math.ceil((toSec - fromSec) * sampleRate)), k = 0;
    return {
      total: total, blockN: blockN, sampleRate: sampleRate,
      next: function () {
        var s0 = k * blockN; if (s0 >= total) return Promise.resolve(null);
        var n = Math.min(blockN, total - s0), pre = k === 0 ? 0 : preMax;
        var b0 = fromSec + s0 / sampleRate, r0 = b0 - pre / sampleRate, r1 = b0 + n / sampleRate;
        var ctx = new OfflineAudioContext(2, pre + n, sampleRate), pins = [], idx = k++;
        return MX.prefetch(seq, Math.max(0, r0), r1, pins).then(function () { return worklets(ctx, seq); }).then(function () {
          var buses = buildBuses(ctx, ctx.destination, seq);
          MX.schedule(ctx, seq, r0, 0, buses, { to: r1, offline: true });
          return ctx.startRendering();
        }).then(function (buf) {
          C.AudioStream.unpin(pins);
          return { L: buf.getChannelData(0).subarray(pre, pre + n), R: buf.getChannelData(1).subarray(pre, pre + n), t: b0, index: idx, n: n, start: s0 };
        }, function (e) { C.AudioStream.unpin(pins); throw e; });
      }
    };
  };

  // Peak (linear) of a clip's source region (for Normalize)
  MX.clipPeak = function (seq, clip) {
    var m = P.media(clip.mediaId), buf = C.Media.audioBuffer(m);
    if (!buf && m && C.Media.isStreamed(m)) { // long media: use the waveform peaks over the used range
      var rt = C.MRT[C.Media.base(m).id], pk = rt && rt.peaks; if (!pk) return 0;
      var a = clip.in, b = clip.in + clip.dur / seq.fps * clip.speed, sp = C.Media.peakSpan(pk, Math.min(a, b), Math.max(a, b));
      return Math.max(-sp.lo, sp.hi);
    }
    if (!buf) return 0;
    var s0 = Math.max(0, Math.floor(clip.in * buf.sampleRate)), s1 = Math.min(buf.length, Math.ceil((clip.in + clip.dur / seq.fps * clip.speed) * buf.sampleRate));
    var pk = 0;
    for (var c = 0; c < buf.numberOfChannels; c++) { var d = buf.getChannelData(c); for (var i = s0; i < s1; i++) { var v = d[i] < 0 ? -d[i] : d[i]; if (v > pk) pk = v; } }
    return pk;
  };

  /* ---------- WAV encoding ---------- */
  MX.encodeWAV = function (buf, bits) {
    bits = bits || 16;
    var ch = buf.numberOfChannels, sr = buf.sampleRate, n = buf.length, bps = bits / 8;
    var ab = new ArrayBuffer(44 + n * ch * bps), dv = new DataView(ab);
    function str(o, s) { for (var i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); dv.setUint32(4, 36 + n * ch * bps, true); str(8, 'WAVE'); str(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, bits === 32 ? 3 : 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, sr, true);
    dv.setUint32(28, sr * ch * bps, true); dv.setUint16(32, ch * bps, true); dv.setUint16(34, bits, true); str(36, 'data'); dv.setUint32(40, n * ch * bps, true);
    var chans = []; for (var c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
    var o = 44;
    for (var i = 0; i < n; i++) for (c = 0; c < ch; c++) {
      var v = Math.max(-1, Math.min(1, chans[c][i]));
      if (bits === 16) { dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
      else if (bits === 24) { var x = Math.round(v < 0 ? v * 0x800000 : v * 0x7fffff); dv.setUint8(o, x & 255); dv.setUint8(o + 1, (x >> 8) & 255); dv.setUint8(o + 2, (x >> 16) & 255); o += 3; }
      else { dv.setFloat32(o, v, true); o += 4; }
    }
    return new Blob([ab], { type: 'audio/wav' });
  };
})();
