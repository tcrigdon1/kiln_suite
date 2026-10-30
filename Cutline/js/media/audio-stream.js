/* Cutline — streamed audio for long media (VODs, multi-hour recordings).
   Nothing is ever decoded whole: audio packets are read with ranged reads through the demuxer and decoded with
   WebCodecs AudioDecoder only for the window that is needed —
     · AS.chunk(m, i)        10-second PCM chunks (LRU-cached) for playback, scrubbing and offline mixing
     · AS.decodeRange(m,a,b) an arbitrary source range (time-stretch of a clip's used range)
     · AS.startPeaks(m)      one background pass over the file that builds the waveform peak pyramid and a
                             loudness (RMS) envelope, cached in IndexedDB keyed by name+size+lastModified. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util;
  var AS = C.AudioStream = {};
  AS.CHUNK = 10;                // seconds per cached chunk
  AS.CACHE_BYTES = 96 * 1048576; // decoded PCM kept in memory (≈ 4 min of 48 kHz stereo)
  AS.PEAK_SPP = 256;            // base peak bucket = 256 samples
  AS.RMS_RATE = 10;             // loudness envelope values per second
  var PREROLL = 0.12;           // decoder warm-up before a range (Opus needs 80 ms; AAC one frame)

  function base(m) { return C.Media.base ? C.Media.base(m) : m; }
  function rtOf(m) { return C.MRT[base(m).id]; }
  function track(m) { var rt = rtOf(m); return rt && rt.stream && rt.stream.track; }
  AS.isStreamed = function (m) { var rt = m && rtOf(m); return !!(rt && rt.stream && rt.stream.track); };

  var yieldCh = null, yieldQ = [];
  function yieldNow() {
    if (!yieldCh) { yieldCh = new MessageChannel(); yieldCh.port1.onmessage = function () { var f = yieldQ.shift(); if (f) f(); }; }
    return new Promise(function (r) { yieldQ.push(r); yieldCh.port2.postMessage(0); });
  }
  AS.yieldNow = yieldNow;

  // Copy an AudioData into planar Float32 channel arrays (≤ 2 channels) -> {ts (s), sr, n, ch: [Float32Array...]}
  var scratch = null;
  function planes(ad, keepCopy, ts) {
    var n = ad.numberOfFrames, nc = Math.min(2, ad.numberOfChannels), out = [];
    for (var c = 0; c < nc; c++) {
      var dst = keepCopy ? new Float32Array(n) : (scratch && scratch[c] && scratch[c].length >= n ? scratch[c].subarray(0, n) : null);
      if (!dst) { scratch = scratch || []; scratch[c] = new Float32Array(Math.max(n, 8192)); dst = scratch[c].subarray(0, n); }
      try { ad.copyTo(dst, { planeIndex: c, format: 'f32-planar' }); }
      catch (e) { // some decoders only offer interleaved output
        var tmp = new Float32Array(n * ad.numberOfChannels); ad.copyTo(tmp, { planeIndex: 0, format: 'f32' });
        for (var i = 0; i < n; i++) dst[i] = tmp[i * ad.numberOfChannels + c];
      }
      out.push(dst);
    }
    return { ts: ts != null ? ts : ad.timestamp / 1e6, sr: ad.sampleRate, n: n, ch: out };
  }

  // Decode [t0, t1) seconds of source audio into an AudioBuffer (native sample rate, ≤ 2 channels).
  AS.decodeRange = function (m, t0, t1) {
    var tr = track(m); if (!tr || !tr.config) return Promise.reject(new Error('no streamable audio'));
    t0 = Math.max(0, t0); if (t1 <= t0) t1 = t0 + 0.05;
    return tr.cursor(Math.round((t0 - PREROLL) * 1e6)).then(function (cur) {
      return new Promise(function (resolve, reject) {
        var sr = tr.sampleRate || 48000, nch = Math.min(2, tr.channels || 2), parts = [], err = null, done = false, map = new TsMap(tr);
        var dec = new AudioDecoder({
          output: function (ad) { try { var p = planes(ad, true, map.place(ad)); sr = p.sr; nch = p.ch.length; parts.push(p); } finally { ad.close(); } },
          error: function (e) { err = e; }
        });
        dec.configure(tr.config);
        var endUs = t1 * 1e6 + map.off;
        var feed = feeder(dec, cur, function (s) { return s.pts > endUs + 30000; }, function (e) {
          if (e) err = err || e;
          dec.flush().then(finish, function (e2) { err = err || e2; finish(); });
        }, function () { return !!err; }, 64, map);
        function finish() {
          if (done) return; done = true;
          try { dec.close(); } catch (e) { }
          if (err && !parts.length) { reject(err); return; }
          var len = Math.max(1, Math.round((t1 - t0) * sr));
          var buf = new AudioBuffer({ length: len, numberOfChannels: Math.max(1, nch), sampleRate: sr });
          var outs = []; for (var c = 0; c < buf.numberOfChannels; c++) outs.push(buf.getChannelData(c));
          parts.forEach(function (p) {
            var at = Math.round((p.ts - t0) * sr); // index of p's first sample in the output
            var s0 = Math.max(0, -at), s1 = Math.min(p.n, len - at);
            for (var c2 = 0; c2 < outs.length; c2++) { var src = p.ch[Math.min(c2, p.ch.length - 1)]; if (s1 > s0) outs[c2].set(src.subarray(s0, s1), at + s0); }
          });
          buf.t0 = t0;
          resolve(buf);
        }
        feed();
      });
    });
  };

  // Output timing. Chromium's AudioDecoder stamps outputs by counting samples from the first input — continuous and
  // sample-exact, but (a) it trims the codec's pre-skip from the first output after every configure(), also when a
  // decode starts mid-stream, without moving the clock, and (b) it is blind to discontinuities in the stream (dropped
  // or overlapping audio in a long recording, concatenated parts), which would accumulate drift over hours.
  // So inputs are tracked in order (one AudioData per packet): the offset between the container time and the decoder
  // clock is taken from the first full outputs (2nd-5th), and later re-synchronised whenever it changes by more than
  // 6 ms for 3 packets in a row. Millisecond jitter (rounded WebM times) is ignored.
  function TsMap(tr) { this.q = []; this.corr = 0; this.bad = 0; this.n = 0; this.base = []; this.off = tr && tr.container === 'webm' ? (tr.codecDelayUs || 0) : 0; }
  TsMap.prototype.push = function (pts) { this.q.push(pts - this.off); };
  TsMap.prototype.place = function (ad) {
    var P = this.q.length ? this.q.shift() : null, t = ad.timestamp / 1e6;
    this.n++;
    if (P == null) return t + this.corr;
    var off = P / 1e6 - t;
    if (this.n === 1) return t + this.corr; // possibly trimmed: its own timestamp is not comparable
    if (this.n <= 5) {
      this.base.push(off);
      var b = this.base.slice().sort(function (x, y) { return x - y; });
      this.corr = b[b.length >> 1];
      return t + this.corr;
    }
    if (Math.abs(off - this.corr) > 0.006) { if (++this.bad >= 3) { this.corr = off; this.bad = 0; this.resyncs = (this.resyncs || 0) + 1; } }
    else this.bad = 0;
    return t + this.corr;
  };
  AS.TsMap = TsMap;
  // Event-driven packet feeder: keeps up to `depth` chunks queued in the decoder, resumes on 'dequeue'.
  // stopAt(sample) -> true ends the stream before that sample; onEnd(err) is called once.
  function feeder(dec, cur, stopAt, onEnd, failed, depth, tsmap) {
    depth = depth || 64;
    var pulling = false, ended = false;
    function end(e) { if (ended) return; ended = true; dec.ondequeue = null; onEnd(e); }
    function pull() {
      if (pulling || ended) return;
      if (failed && failed()) { end(); return; }
      if (dec.decodeQueueSize >= depth) return; // resumed by ondequeue
      pulling = true;
      cur.next().then(function (s) {
        pulling = false;
        if (!s || stopAt(s)) { end(); return; }
        try { if (tsmap) tsmap.push(s.pts); dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(s.pts), duration: s.dur ? Math.round(s.dur) : undefined, data: s.data })); }
        catch (e) { end(e); return; }
        pull();
      }, function (e) { pulling = false; end(e); });
    }
    dec.ondequeue = function () { pull(); };
    return pull;
  }
  AS.feeder = feeder;

  /* ---------- chunk cache ---------- */
  var cache = new Map(), cacheBytes = 0, pending = {}, active = 0, queue = [];
  function ckey(m, i) { return base(m).id + '|' + i; }
  AS.cached = function (m, i) {
    var k = ckey(m, i), b = cache.get(k);
    if (b) { cache.delete(k); cache.set(k, b); }
    return b || null;
  };
  function put(k, b) {
    cache.set(k, b); cacheBytes += b.length * b.numberOfChannels * 4;
    var it = cache.keys();
    while (cacheBytes > AS.CACHE_BYTES && cache.size > 4) {
      var old = it.next().value; if (old === k) continue;
      var ob = cache.get(old); if (ob && ob.pinned) continue;
      cache.delete(old); cacheBytes -= ob ? ob.length * ob.numberOfChannels * 4 : 0;
    }
  }
  function pump() {
    while (active < 2 && queue.length) {
      var job = queue.shift(); active++;
      (function (job) {
        AS.decodeRange(job.m, job.i * AS.CHUNK, (job.i + 1) * AS.CHUNK).then(function (b) {
          put(job.k, b); delete pending[job.k]; active--; job.res(b); pump();
        }, function (e) { delete pending[job.k]; active--; job.rej(e); pump(); });
      })(job);
    }
  }
  // Promise of chunk i (source seconds [i*CHUNK, (i+1)*CHUNK))
  AS.chunk = function (m, i, urgent) {
    var k = ckey(m, i), hit = AS.cached(m, i);
    if (hit) return Promise.resolve(hit);
    if (pending[k]) return pending[k];
    var job = { m: base(m), i: i, k: k };
    pending[k] = new Promise(function (res, rej) { job.res = res; job.rej = rej; });
    if (urgent) queue.unshift(job); else queue.push(job);
    pump();
    return pending[k];
  };
  // Make sure all chunks covering [a, b] seconds are cached (and pinned until unpin())
  AS.ensure = function (m, a, b, pinSet) {
    var tr = track(m); if (!tr) return Promise.resolve();
    var i0 = Math.max(0, Math.floor(a / AS.CHUNK)), i1 = Math.floor(Math.max(a, b) / AS.CHUNK), jobs = [];
    for (var i = i0; i <= i1; i++) jobs.push(AS.chunk(m, i, true).then(function (bf) { if (pinSet) { bf.pinned = true; pinSet.push(bf); } }).catch(function (e) { console.warn('[Cutline] audio chunk failed', e && e.message); }));
    return Promise.all(jobs);
  };
  AS.unpin = function (pinSet) { (pinSet || []).forEach(function (b) { b.pinned = false; }); };
  AS.clearCache = function () { cache.clear(); cacheBytes = 0; };
  // Temporarily lower the cache (exports touch each range once, so a big cache only costs memory). Returns the old limit.
  AS.setCacheLimit = function (bytes) {
    var old = AS.CACHE_BYTES; AS.CACHE_BYTES = bytes;
    var it = cache.keys(), k;
    while (cacheBytes > AS.CACHE_BYTES && cache.size && !(k = it.next()).done) { var b = cache.get(k.value); if (b && b.pinned) continue; cache.delete(k.value); cacheBytes -= b ? b.length * b.numberOfChannels * 4 : 0; }
    return old;
  };
  AS.stats = function () { return { chunks: cache.size, bytes: cacheBytes, queued: queue.length, active: active }; };

  /* ---------- waveform peaks pyramid + loudness envelope ---------- */
  var LEVEL_K = 4, LEVELS = 6;
  function newPeaks(sr, dur) {
    var rate = sr / AS.PEAK_SPP, n = Math.ceil(dur * rate) + 2;
    var pk = { rate: rate, n: 0, cap: n, min: new Int16Array(n), max: new Int16Array(n), k: 1 / 32767, levels: [], done: 0, sr: sr, duration: dur };
    var r = rate, cap = n;
    for (var l = 0; l < LEVELS; l++) { r /= LEVEL_K; cap = Math.ceil(cap / LEVEL_K) + 1; pk.levels.push({ rate: r, n: 0, min: new Int16Array(cap), max: new Int16Array(cap) }); }
    pk.rmsRate = AS.RMS_RATE; pk.rms = new Float32Array(Math.ceil(dur * AS.RMS_RATE) + 2); pk.rmsN = 0;
    return pk;
  }
  AS.rebuildLevels = function (pk) {
    var src = pk;
    pk.levels.forEach(function (L) {
      var n = Math.ceil(src.n / LEVEL_K);
      for (var i = 0; i < n; i++) {
        var lo = 32767, hi = -32767, a = i * LEVEL_K, b = Math.min(src.n, a + LEVEL_K);
        for (var j = a; j < b; j++) { if (src.min[j] < lo) lo = src.min[j]; if (src.max[j] > hi) hi = src.max[j]; }
        L.min[i] = lo; L.max[i] = hi;
      }
      L.n = n; src = L;
    });
  };
  function setBucket(pk, i, lo, hi) {
    pk.min[i] = lo; pk.max[i] = hi; if (i + 1 > pk.n) pk.n = i + 1;
    var idx = i;
    for (var l = 0; l < pk.levels.length; l++) {
      var L = pk.levels[l], first = idx % LEVEL_K === 0; idx = Math.floor(idx / LEVEL_K);
      if (first || idx >= L.n) { L.min[idx] = lo; L.max[idx] = hi; }
      else { if (lo < L.min[idx]) L.min[idx] = lo; if (hi > L.max[idx]) L.max[idx] = hi; }
      if (idx + 1 > L.n) L.n = idx + 1;
      lo = L.min[idx]; hi = L.max[idx];
    }
  }
  function cacheKey(m) { var b = base(m); return 'peaks|' + b.name + '|' + b.size + '|' + (b.lastModified || 0); }
  AS.cacheKey = cacheKey;
  function savePeaks(m, pk) {
    if (!C.Store) return Promise.resolve();
    var rec = { v: 4, rate: pk.rate, sr: pk.sr, duration: pk.duration, n: pk.n, min: pk.min.slice(0, pk.n), max: pk.max.slice(0, pk.n), rms: pk.rms.slice(0, pk.rmsN), rmsRate: pk.rmsRate, saved: Date.now() };
    return C.Store.put(cacheKey(m), rec);
  }
  function loadPeaks(m) {
    if (!C.Store) return Promise.resolve(null);
    return C.Store.get(cacheKey(m)).then(function (rec) {
      if (!rec || rec.v !== 4 || !rec.n) return null;
      var pk = newPeaks(rec.sr, rec.duration);
      pk.min.set(rec.min.subarray(0, Math.min(rec.n, pk.min.length))); pk.max.set(rec.max.subarray(0, Math.min(rec.n, pk.max.length))); pk.n = Math.min(rec.n, pk.min.length);
      pk.rms.set(rec.rms.subarray(0, Math.min(rec.rms.length, pk.rms.length))); pk.rmsN = Math.min(rec.rms.length, pk.rms.length);
      AS.rebuildLevels(pk); pk.done = 1; pk.fromCache = true;
      return pk;
    }).catch(function () { return null; });
  }

  var peakJobs = {};
  // Start (or resume from cache) the background waveform/loudness pass for media m. Resolves the peaks object.
  AS.startPeaks = function (m) {
    var b = base(m), rt = rtOf(b), tr = track(b);
    if (!rt || !tr || !tr.config) return Promise.resolve(null);
    if (peakJobs[b.id] && peakJobs[b.id].file === rt.file) return peakJobs[b.id].p;
    var t0 = performance.now();
    var job = { file: rt.file, cancelled: false };
    job.p = loadPeaks(b).then(function (cached) {
      if (cached) { rt.peaks = cached; rt.peaksMs = performance.now() - t0; C.bus.emit('peaks', b.id); C.bus.emit('film', b.id); return cached; }
      return runPass(b, rt, tr, job).then(function (pk) {
        rt.peaksMs = performance.now() - t0;
        if (pk && pk.done >= 1) savePeaks(b, pk);
        return pk;
      });
    });
    peakJobs[b.id] = job;
    return job.p;
  };
  AS.cancelPeaks = function (m) { var j = peakJobs[base(m).id]; if (j) j.cancelled = true; };
  function runPass(b, rt, tr, job) {
    var sr = tr.sampleRate || 48000, dur = b.duration || tr.duration || 1;
    var pk = newPeaks(sr, dur);
    rt.peaks = pk; pk.done = 0;
    var spp = AS.PEAK_SPP, rmsSpan = sr / AS.RMS_RATE;
    // running accumulators keyed by absolute sample index
    var bucket = -1, bLo = 0, bHi = 0, rIdx = -1, rSum = 0, rCnt = 0;
    function flushBucket() { if (bucket >= 0 && bucket < pk.cap) setBucket(pk, bucket, Math.round(bLo * 32767), Math.round(bHi * 32767)); }
    function flushRms() { if (rIdx >= 0 && rIdx < pk.rms.length && rCnt) { pk.rms[rIdx] = Math.sqrt(rSum / rCnt); if (rIdx + 1 > pk.rmsN) pk.rmsN = rIdx + 1; } }
    // Fold one decoded block into the peak buckets and the RMS envelope (segment loops, no per-sample division)
    function addSamples(p) {
      var srcSr = p.sr || sr, L = p.ch[0], R = p.ch[1] || p.ch[0], n = p.n;
      var start = Math.round(p.ts * sr); // index at the track's nominal rate
      var step = srcSr === sr ? 1 : sr / srcSr;
      if (step !== 1) { // resampled indexing (rare): per-sample path
        for (var q = 0; q < n; q++) {
          var a2 = Math.floor(start + q * step); if (a2 < 0) continue;
          var v2 = (L[q] + R[q]) * 0.5, b2 = Math.floor(a2 / spp);
          if (b2 !== bucket) { flushBucket(); bucket = b2; bLo = 0; bHi = 0; }
          if (v2 < bLo) bLo = v2; if (v2 > bHi) bHi = v2;
          var r2 = Math.floor(a2 / rmsSpan);
          if (r2 !== rIdx) { flushRms(); rIdx = r2; rSum = 0; rCnt = 0; }
          rSum += (L[q] * L[q] + R[q] * R[q]) * 0.5; rCnt++;
        }
        return;
      }
      var i = start < 0 ? -start : 0;
      while (i < n) {
        var abs = start + i, bi = Math.floor(abs / spp), segEnd = Math.min(n, (bi + 1) * spp - start);
        if (bi !== bucket) { flushBucket(); bucket = bi; bLo = 0; bHi = 0; }
        var lo = bLo, hi = bHi;
        for (var j = i; j < segEnd; j++) { var v = (L[j] + R[j]) * 0.5; if (v < lo) lo = v; else if (v > hi) hi = v; }
        bLo = lo; bHi = hi; i = segEnd;
      }
      i = start < 0 ? -start : 0;
      while (i < n) {
        var abs2 = start + i, ri = Math.floor(abs2 / rmsSpan), segEnd2 = Math.min(n, Math.floor((ri + 1) * rmsSpan) - start);
        if (segEnd2 <= i) segEnd2 = i + 1;
        if (ri !== rIdx) { flushRms(); rIdx = ri; rSum = 0; rCnt = 0; }
        var sum = 0;
        for (var k = i; k < segEnd2; k++) sum += L[k] * L[k] + R[k] * R[k];
        rSum += sum * 0.5; rCnt += segEnd2 - i; i = segEnd2;
      }
    }
    return tr.cursor(0).then(function (cur) {
      return new Promise(function (resolve) {
        var err = null, flushing = false, finished = false;
        var map = new TsMap(tr);
        var dec = new AudioDecoder({ output: function (ad) { try { addSamples(planes(ad, false, map.place(ad))); } catch (e) { err = err || e; } ad.close(); }, error: function (e) { err = e; } });
        dec.configure(tr.config);
        function finish() {
          if (finished) return; finished = true;
          flushBucket(); flushRms();
          try { dec.close(); } catch (e) { }
          clearInterval(prog);
          pk.done = job.cancelled ? pk.done : (err ? Math.max(pk.done, 0.999) : 1);
          if (err) console.warn('[Cutline] waveform pass stopped:', err && err.message);
          C.bus.emit('peaks', b.id); C.bus.emit('film', b.id);
          resolve(pk);
        }
        var feed = feeder(dec, cur, function () { return job.cancelled || C.MRT[b.id] !== rt; }, function (e) {
          if (e) err = err || e;
          if (job.cancelled || C.MRT[b.id] !== rt) { finish(); return; }
          if (!flushing) { flushing = true; dec.flush().then(finish, function (e2) { err = err || e2; finish(); }); }
        }, function () { return !!err; }, 96, map);
        var prog = setInterval(function () {
          if (finished) { clearInterval(prog); return; }
          pk.done = Math.min(0.999, (pk.n / pk.rate) / dur); C.bus.emit('peaks', b.id);
        }, 500);
        feed();
      });
    });
  }

  /* ---------- Loudness-based highlight finder ---------- */
  // Analyses the RMS envelope: loudness per second (dBFS), a rolling baseline (median of the surrounding minutes),
  // and returns moments where loudness rises clearly above the baseline. opts: {sensitivity (dB above baseline),
  // minGap (s), max, minLen (s), window (s)}. Returns [{t, end, db, strength, label}] sorted by time.
  AS.findHighlights = function (pk, opts) {
    opts = Object.assign({ sensitivity: 9, minGap: 30, max: 40, minLen: 0.3, window: 120 }, opts || {});
    if (!pk || !pk.rmsN) return [];
    var rr = pk.rmsRate, n = pk.rmsN;
    var db = new Float32Array(n);
    for (var i = 0; i < n; i++) db[i] = pk.rms[i] > 1e-6 ? 20 * Math.log10(pk.rms[i]) : -120;
    // per-second loudness (energy mean over 1 s) and its baseline (median of +-window/2, computed at 5 s hops)
    var secs = Math.ceil(n / rr), loud = new Float32Array(secs);
    for (var s = 0; s < secs; s++) { var e = 0, c = 0; for (var j = s * rr; j < Math.min(n, (s + 1) * rr); j++) { e += pk.rms[j] * pk.rms[j]; c++; } loud[s] = c && e > 0 ? 10 * Math.log10(e / c) : -120; }
    var hop = 5, half = Math.round(opts.window / 2), baseAt = new Float32Array(Math.ceil(secs / hop) + 1);
    for (var h = 0; h < baseAt.length; h++) {
      var c0 = h * hop, a = Math.max(0, c0 - half), b = Math.min(secs, c0 + half), arr = [];
      for (var k = a; k < b; k++) if (loud[k] > -110) arr.push(loud[k]);
      arr.sort(function (x, y) { return x - y; });
      baseAt[h] = arr.length ? arr[arr.length >> 1] : -60;
    }
    function baseline(sec) { var x = sec / hop, i0 = Math.floor(x), f = x - i0; var v0 = baseAt[Math.min(baseAt.length - 1, i0)], v1 = baseAt[Math.min(baseAt.length - 1, i0 + 1)]; return v0 + (v1 - v0) * f; }
    // candidate regions at envelope resolution (0.1 s) above baseline + sensitivity
    var cands = [], inReg = false, rs = 0, peak = -200, peakAt = 0, sum = 0, cnt = 0;
    for (i = 0; i <= n; i++) {
      var over = i < n ? db[i] - baseline(i / rr) : -999;
      if (over >= opts.sensitivity) {
        if (!inReg) { inReg = true; rs = i; peak = -200; sum = 0; cnt = 0; }
        if (over > peak) { peak = over; peakAt = i; }
        sum += over; cnt++;
      } else if (inReg) {
        inReg = false;
        var len = (i - rs) / rr;
        if (len >= opts.minLen) {
          var sustain = Math.min(1, len / 4); // sustained reactions score higher than a single spike
          cands.push({ t: rs / rr, end: i / rr, peakT: peakAt / rr, db: peak, mean: sum / cnt, len: len, strength: Math.round((peak * 0.6 + (sum / cnt) * 0.4) * (0.75 + 0.25 * sustain) * 10) / 10 });
        }
      }
    }
    // merge regions closer than 1.5 s, then enforce spacing by strongest-first selection
    var merged = [];
    cands.forEach(function (c2) { var last = merged[merged.length - 1]; if (last && c2.t - last.end < 1.5) { last.end = c2.end; last.len = last.end - last.t; if (c2.db > last.db) { last.db = c2.db; last.peakT = c2.peakT; } last.strength = Math.max(last.strength, c2.strength); } else merged.push(Object.assign({}, c2)); });
    merged.sort(function (x, y) { return y.strength - x.strength; });
    var picked = [];
    for (i = 0; i < merged.length && picked.length < opts.max; i++) {
      var cnd = merged[i];
      if (picked.some(function (p) { return Math.abs(p.t - cnd.t) < opts.minGap; })) continue;
      picked.push(cnd);
    }
    picked.forEach(function (p) {
      p.label = (p.len >= 2.5 ? 'Sustained loud moment' : 'Loud moment') + ' +' + Math.round(p.db) + ' dB';
    });
    return picked.sort(function (x, y) { return x.t - y.t; });
  };
  void U;
})();
