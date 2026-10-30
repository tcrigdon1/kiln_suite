/* Cutline — automatic cuts: Remove Silences (jump cuts from the loudness envelope) and Detect Scene Cuts
   (shot changes from frame differences).  Both work on the selected clips, or every clip on the unlocked target
   tracks when nothing is selected, and never touch locked tracks. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, P = C.P, T = C.T, h = U.h;
  var AC = C.AutoCut = {};

  function seq() { return P.seq(); }
  function targetClips(s) {
    var sel = P.selectedClips();
    if (sel.length) return sel;
    var locked = {}; s.tracks.forEach(function (t) { if (t.lock || !t.target) locked[t.id] = true; });
    return s.clips.filter(function (c) { return !locked[c.trackId] && c.mediaId; });
  }
  // group linked clips (video + its audio) so each source range is analysed once
  function groups(clips) {
    var byLink = {}, out = [];
    clips.forEach(function (c) {
      if (c.link) { if (!byLink[c.link]) { byLink[c.link] = { clips: [] }; out.push(byLink[c.link]); } byLink[c.link].clips.push(c); }
      else out.push({ clips: [c] });
    });
    out.forEach(function (g) {
      g.audio = g.clips.filter(function (c) { return c.kind === 'audio'; })[0] || null;
      g.video = g.clips.filter(function (c) { return c.kind === 'video'; })[0] || null;
      g.ref = g.audio || g.video; // the clip whose timing drives the analysis
      g.tracks = U.uniq ? U.uniq(g.clips.map(function (c) { return c.trackId; })) : g.clips.map(function (c) { return c.trackId; }).filter(function (t, i, a) { return a.indexOf(t) === i; });
    });
    return out;
  }
  function mediaOf(clip) { var m = P.media(clip.mediaId); return m ? C.Media.base(m) : null; }
  // RMS envelope for a media item ({rms, rmsN, rmsRate}) — shared with Find Highlights
  function envelope(m, onStatus) {
    var rt = C.MRT[m.id]; if (!rt) return Promise.reject(new Error(m.name + ' is offline'));
    if (rt.peaks && rt.peaks.rmsN && rt.peaks.done >= 1) return Promise.resolve(rt.peaks);
    if (rt.stream) {
      var tick = setInterval(function () { var pk = rt.peaks; if (pk && pk.done < 1 && onStatus) onStatus('Reading audio of ' + m.name + '… ' + Math.floor(pk.done * 100) + '%'); }, 300);
      return C.AudioStream.startPeaks(m).then(function (pk) { clearInterval(tick); return pk; }, function (e) { clearInterval(tick); throw e; });
    }
    if (rt.buffer) return Promise.resolve(C.A.rmsFromBuffer(rt));
    return Promise.reject(new Error(m.name + ' has no audio'));
  }
  function db(x) { return 20 * Math.log10(Math.max(1e-6, x)); }

  /* ---------- silence analysis ---------- */
  // silent spans of one clip in local frames: [{f0, f1}] (half-open), after padding and the minimum length
  AC.silentSpans = function (s, clip, env, o) {
    var spans = [], n = clip.dur, rate = env.rmsRate, minF = Math.max(1, Math.round(o.minLen * s.fps)), padF = Math.round(o.pad * s.fps);
    var ramp = T.hasRamp(clip), spf = clip.speed / s.fps;
    var run0 = -1;
    for (var lf = 0; lf <= n; lf++) {
      var silent = false;
      if (lf < n) {
        var src = ramp ? T.rampSrc(s, clip, lf) : (clip.reverse ? clip.in + (n - 1 - lf) * spf : clip.in + lf * spf);
        var i = Math.min(env.rmsN - 1, Math.max(0, Math.floor(src * rate)));
        silent = db(env.rms[i]) < o.threshold;
      }
      if (silent && run0 < 0) run0 = lf;
      else if (!silent && run0 >= 0) {
        var f0 = run0, f1 = lf; run0 = -1;
        if (f1 - f0 >= minF) {
          // keep a little room on both sides so words are not clipped; a span touching the clip edge keeps no pad there
          var a = f0 === 0 ? 0 : f0 + padF, b = f1 === n ? n : f1 - padF;
          if (b - a >= 1) spans.push({ f0: a, f1: b });
        }
      }
    }
    return spans;
  };
  AC.analyseSilence = function (s, clips, o, onStatus) {
    var gs = groups(clips).filter(function (g) { return g.ref && mediaOf(g.ref) && mediaOf(g.ref).hasAudio !== false; });
    var out = [];
    return gs.reduce(function (p, g) {
      return p.then(function () {
        var m = mediaOf(g.ref);
        return envelope(m, onStatus).then(function (env) {
          if (!env || !env.rmsN) return;
          AC.silentSpans(s, g.ref, env, o).forEach(function (sp) { out.push({ from: g.ref.start + sp.f0, to: g.ref.start + sp.f1, tracks: g.tracks, group: g }); });
        }, function (e) { console.warn('[Cutline] silence analysis skipped', m && m.name, e && e.message); });
      });
    }, Promise.resolve()).then(function () { out.sort(function (a, b) { return a.from - b.from; }); return out; });
  };
  // merge spans into non-overlapping [from,to) ranges (for whole-timeline rippling)
  function mergeSpans(spans) {
    var out = [];
    spans.slice().sort(function (a, b) { return a.from - b.from; }).forEach(function (sp) {
      var l = out[out.length - 1];
      if (l && sp.from <= l.to) l.to = Math.max(l.to, sp.to); else out.push({ from: sp.from, to: sp.to });
    });
    return out;
  }
  // apply: action = 'ripple' | 'lift' | 'split' | 'markers'; allTracks: ripple/lift across every unlocked track
  AC.applySpans = function (s, spans, action, allTracks, label) {
    var unlocked = s.tracks.filter(function (t) { return !t.lock; }).map(function (t) { return t.id; });
    if (action === 'markers') {
      spans.forEach(function (sp) { s.markers.push({ id: U.uid('mk'), f: sp.from, end: sp.to, name: label, color: '#c8bdb1', note: label + ' · ' + U.fmtTC(sp.to - sp.from, s.fps), auto: true }); });
      s.markers.sort(function (a, b) { return a.f - b.f; });
      return spans.length;
    }
    if (action === 'split') {
      var cuts = {};
      spans.forEach(function (sp) { cuts[sp.from] = sp; cuts[sp.to] = sp; });
      Object.keys(cuts).map(Number).sort(function (a, b) { return b - a; }).forEach(function (f) {
        var tr = allTracks ? unlocked : cuts[f].tracks;
        var at = s.clips.filter(function (c) { return tr.indexOf(c.trackId) >= 0 && f > c.start && f < c.start + c.dur; });
        T.splitClips(s, at, f);
      });
      return spans.length;
    }
    var list = allTracks ? mergeSpans(spans).map(function (r) { return { from: r.from, to: r.to, tracks: unlocked }; }) : spans.slice();
    list.sort(function (a, b) { return b.from - a.from; });
    list.forEach(function (sp) { if (action === 'ripple') T.extract(s, sp.from, sp.to, sp.tracks); else T.lift(s, sp.from, sp.to, sp.tracks); });
    return list.length;
  };

  AC.removeSilencesDialog = function () {
    var s = seq(); if (!s) return;
    var clips = targetClips(s);
    if (!clips.length) { C.toast('Select clips, or make the tracks you want to cut target tracks'); return; }
    var prefs = U.lsGet('autocut.silence', { threshold: -40, minLen: 0.7, pad: 0.12, action: 'ripple', all: true });
    var thr = h('input', { type: 'range', min: -70, max: -10, step: 1, value: prefs.threshold }), thrV = h('span.muted', '');
    var minLen = h('input', { type: 'number', min: 0.1, max: 60, step: 0.1, value: prefs.minLen, style: { width: '80px' } });
    var pad = h('input', { type: 'number', min: 0, max: 5, step: 0.01, value: prefs.pad, style: { width: '80px' } });
    var action = h('select', [['ripple', 'Cut them out and close the gaps (jump cuts)'], ['lift', 'Cut them out, leave gaps'], ['split', 'Only add cuts at their edges'], ['markers', 'Only add markers']].map(function (o) { return h('option', { value: o[0] }, o[1]); }));
    action.value = prefs.action;
    var all = h('input', { type: 'checkbox', checked: !!prefs.all });
    var status = h('div.muted.ac-status', { style: { minHeight: '18px' } }, ''), found = null, tok = 0;
    [minLen, pad].forEach(function (i) { i.addEventListener('keydown', function (e) { e.stopPropagation(); }); });
    function opts() { return { threshold: +thr.value, minLen: Math.max(0.05, +minLen.value || 0.5), pad: Math.max(0, +pad.value || 0) }; }
    function analyse() {
      var my = ++tok, o = opts(); thrV.textContent = thr.value + ' dBFS — quieter than this counts as silence';
      status.textContent = 'Analysing…'; found = null; if (d && d.go) d.go.disabled = true;
      AC.analyseSilence(s, clips, o, function (msg) { if (my === tok) status.textContent = msg; }).then(function (spans) {
        if (my !== tok) return;
        found = spans;
        var total = spans.reduce(function (a, sp) { return a + (sp.to - sp.from); }, 0);
        status.textContent = spans.length ? spans.length + ' silent span' + (spans.length === 1 ? '' : 's') + ' · ' + U.fmtTC(total, s.fps) + ' total in ' + clips.length + ' clip' + (clips.length === 1 ? '' : 's') : 'No silences found with these settings in ' + clips.length + ' clip' + (clips.length === 1 ? '' : 's');
        if (d && d.go) d.go.disabled = !spans.length;
      }, function (e) { if (my === tok) status.textContent = 'Could not analyse: ' + (e && e.message || e); });
    }
    var tmr = null; function later() { clearTimeout(tmr); tmr = setTimeout(analyse, 250); }
    thr.addEventListener('input', later); minLen.addEventListener('input', later); pad.addEventListener('input', later);
    var body = h('div', { style: { width: '540px', lineHeight: '1.5' } },
      h('div', { style: { marginBottom: '8px' } }, 'Finds the quiet stretches in ', h('b', clips.length === 1 ? clips[0].name : clips.length + ' clips'), ' from their audio and cuts them out — the classic jump-cut pass for talking-head and stream footage. Linked video and audio are cut together; music on other tracks is left alone unless you ripple every track.'),
      h('div.form-grid',
        h('label', 'Silence threshold'), h('div', thr, h('br'), thrV),
        h('label', 'Minimum silence'), h('div.row', minLen, h('span.muted', 'seconds — shorter pauses are kept')),
        h('label', 'Keep padding'), h('div.row', pad, h('span.muted', 'seconds left on each side of a cut')),
        h('label', 'Action'), action,
        h('label', 'Other tracks'), h('label.cl-check', all, h('span', 'Ripple every unlocked track (keeps overlays in sync; also shifts music)'))),
      status);
    var d = C.ui.dialog({ title: 'Remove Silences', width: 580, body: body, buttons: [{ label: 'Cancel' }, { label: 'Apply', primary: true, id: 'go', action: function () {
      if (!found || !found.length) return false;
      var o = opts(); U.lsSet('autocut.silence', { threshold: o.threshold, minLen: o.minLen, pad: o.pad, action: action.value, all: all.checked });
      var n = 0, act = action.value;
      C.edit(act === 'markers' ? 'Mark Silences' : 'Remove Silences', function (s2) { n = AC.applySpans(s2, found, act, all.checked, 'Silence'); });
      C.A.deselect && C.A.deselect();
      C.toast(act === 'markers' ? n + ' silence markers added' : act === 'split' ? 'Cuts added around ' + n + ' silent spans' : n + ' silent span' + (n === 1 ? '' : 's') + ' removed', 3500);
    } }] });
    analyse();
  };

  /* ---------- scene cut detection ---------- */
  // Scan a media item's source range [t0,t1) at `rate` samples per second; resolves [{t, score}] of shot changes.
  AC.scanCuts = function (m, t0, t1, o, onStatus, cancel) {
    var rt = C.MRT[m.id]; if (!rt || !rt.url) return Promise.reject(new Error(m.name + ' is offline'));
    var v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = rt.url;
    var W = 48, H = 27, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var g = cv.getContext('2d', { willReadFrequently: true });
    var step = 1 / (o.rate || 4), prev = null, prevHist = null, diffs = [], times = [];
    function sample() {
      g.drawImage(v, 0, 0, W, H);
      var d = g.getImageData(0, 0, W, H).data, lum = new Float32Array(W * H), hist = new Float32Array(32);
      for (var i = 0, j = 0; i < lum.length; i++, j += 4) { var y = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]; lum[i] = y; hist[Math.min(31, y / 8) | 0]++; }
      var score = 0;
      if (prev) {
        var pix = 0; for (var k = 0; k < lum.length; k++) pix += Math.abs(lum[k] - prev[k]); pix /= lum.length * 255;
        var hd = 0; for (var b = 0; b < 32; b++) hd += Math.abs(hist[b] - prevHist[b]); hd /= 2 * lum.length;
        score = 0.6 * pix + 0.4 * hd; // 0..1: both the picture and its tonal distribution must change for a cut
      }
      prev = lum; prevHist = hist; return score;
    }
    return C.Media.waitEvent(v, 'loadeddata', 'error', 15000).then(function () {
      var t = t0, n = Math.max(1, Math.ceil((t1 - t0) / step)), i = 0;
      function next() {
        if (cancel && cancel.v) return Promise.resolve();
        if (t >= t1 - 1e-6) return Promise.resolve();
        return C.Media.seekTo(v, t).then(function () {
          diffs.push(sample()); times.push(t);
          i++; t = t0 + i * step;
          if (onStatus && i % 20 === 0) onStatus(Math.min(1, i / n), 'Scanning ' + m.name + '… ' + Math.floor(100 * i / n) + '%');
          return next();
        });
      }
      return next();
    }).then(function () {
      try { v.removeAttribute('src'); v.load(); } catch (e) { }
      // a cut is a local maximum that stands well above its neighbourhood (adaptive threshold handles dark/bright scenes)
      var cuts = [], win = Math.max(2, Math.round(1.5 / step)), minGap = o.minGap || 0.5, last = -Infinity;
      for (var k = 1; k < diffs.length; k++) {
        var a = Math.max(1, k - win), b = Math.min(diffs.length, k + win + 1), sum = 0, cnt = 0;
        for (var q = a; q < b; q++) if (q !== k) { sum += diffs[q]; cnt++; }
        var base = cnt ? sum / cnt : 0, sc = diffs[k];
        var isPeak = sc >= diffs[k - 1] && (k + 1 >= diffs.length || sc >= diffs[k + 1]);
        if (isPeak && sc > o.threshold && sc > base * 3 + 0.02 && times[k] - last >= minGap) { cuts.push({ t: times[k], score: sc }); last = times[k]; }
      }
      return cuts;
    });
  };
  AC.sceneCutsDialog = function () {
    var s = seq(); if (!s) return;
    var clips = targetClips(s).filter(function (c) { return c.kind === 'video' && mediaOf(c) && mediaOf(c).type === 'video'; });
    if (!clips.length) { C.toast('Select video clips first'); return; }
    var prefs = U.lsGet('autocut.scenes', { sens: 0.3, rate: 4, action: 'markers' });
    var sens = h('input', { type: 'range', min: 0.1, max: 0.6, step: 0.02, value: prefs.sens }), sensV = h('span.muted', '');
    var rate = h('select', [[2, '2 per second (fast)'], [4, '4 per second'], [8, '8 per second (precise)']].map(function (o) { return h('option', { value: o[0] }, o[1]); })); rate.value = String(prefs.rate);
    var action = h('select', [['markers', 'Add sequence markers at each cut'], ['split', 'Split the clips at each cut']].map(function (o) { return h('option', { value: o[0] }, o[1]); })); action.value = prefs.action;
    var status = h('div.muted', { style: { minHeight: '18px' } }, ''), cancel = { v: false };
    function upd() { sensV.textContent = (+sens.value <= 0.2 ? 'sensitive — catches soft cuts, may flag fast motion' : +sens.value >= 0.45 ? 'strict — only hard cuts' : 'balanced'); }
    sens.addEventListener('input', upd); upd();
    var body = h('div', { style: { width: '520px', lineHeight: '1.5' } },
      h('div', { style: { marginBottom: '8px' } }, 'Scans ', h('b', clips.length === 1 ? clips[0].name : clips.length + ' clips'), ' for shot changes (camera switches, scene transitions, loading screens) and marks or splits them. Fades and slow dissolves are not cuts and are skipped on purpose.'),
      h('div.form-grid', h('label', 'Sensitivity'), h('div', sens, h('br'), sensV), h('label', 'Scan rate'), rate, h('label', 'Action'), action),
      status);
    var d = C.ui.dialog({ title: 'Detect Scene Cuts', width: 560, body: body, onClose: function () { cancel.v = true; }, buttons: [{ label: 'Cancel' }, { label: 'Scan', primary: true, id: 'go', action: function () {
      var o = { threshold: 0.7 - +sens.value, rate: +rate.value, minGap: 0.5 };
      U.lsSet('autocut.scenes', { sens: +sens.value, rate: o.rate, action: action.value });
      d.go.disabled = true; var all = [];
      clips.reduce(function (p, c) {
        return p.then(function () {
          if (cancel.v) return;
          var m = mediaOf(c), span = T.srcSpan(s, c, 0, c.dur), t0 = c.in, t1 = c.in + span;
          return AC.scanCuts(m, t0, t1, o, function (k, msg) { status.textContent = msg; }, cancel).then(function (cuts) {
            cuts.forEach(function (cut) {
              // source time → local frame (constant speed; ramps use the cumulative table)
              var lf = T.hasRamp(c) ? T.rampDurFor(s, c, cut.t - c.in) : Math.round((c.reverse ? (t1 - cut.t) : (cut.t - c.in)) / (c.speed / s.fps));
              if (lf > 0 && lf < c.dur) all.push({ f: c.start + lf, clip: c, score: cut.score });
            });
          });
        });
      }, Promise.resolve()).then(function () {
        if (cancel.v) return;
        if (!all.length) { status.textContent = 'No cuts found — try a higher sensitivity'; d.go.disabled = false; return; }
        var act = action.value, n = 0;
        C.edit(act === 'split' ? 'Split at Scene Cuts' : 'Mark Scene Cuts', function (s2) {
          if (act === 'markers') {
            all.forEach(function (x) { if (!s2.markers.some(function (mk) { return Math.abs(mk.f - x.f) <= 1; })) { s2.markers.push({ id: U.uid('mk'), f: x.f, name: 'Cut', color: '#5aa9e6', note: 'Scene cut · confidence ' + Math.round(x.score * 100) + '%', strength: x.score, auto: true }); n++; } });
            s2.markers.sort(function (a, b) { return a.f - b.f; });
          } else {
            all.sort(function (a, b) { return b.f - a.f; }).forEach(function (x) {
              var c = P.clip(s2, x.clip.id); if (!c) return;
              var group = s2.clips.filter(function (k) { return k.id === c.id || (c.link && k.link === c.link); });
              var at = group.filter(function (k) { return x.f > k.start && x.f < k.start + k.dur; });
              if (at.length) { T.splitClips(s2, at, x.f); n++; }
            });
          }
        });
        d.close();
        C.toast(act === 'split' ? n + ' cut' + (n === 1 ? '' : 's') + ' added' : n + ' scene-cut marker' + (n === 1 ? '' : 's') + ' added', 3500);
        if (act === 'markers' && C.ui.showLeftTab) C.ui.showLeftTab('markers');
      }, function (e) { status.textContent = 'Could not scan: ' + (e && e.message || e); d.go.disabled = false; });
      return false;
    } }] });
  };
})();

/* ---------- Censor: pixelate / blur a region, ready for tracking ---------- */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, P = C.P, h = U.h;
  var AC = C.AutoCut;
  AC.censorDialog = function () {
    var s = P.seq(); if (!s) return;
    var clips = P.selectedClips().filter(function (c) { return c.kind === 'video'; });
    if (!clips.length) { C.toast('Select a video clip first'); return; }
    var prefs = U.lsGet('autocut.censor', { kind: 'pixelate', amount: 28, shape: 'ellipse', track: true });
    var kind = h('select', [['pixelate', 'Pixelate (mosaic)'], ['gblur', 'Blur'], ['solid', 'Black box']].map(function (o) { return h('option', { value: o[0] }, o[1]); })); kind.value = prefs.kind;
    var amount = h('input', { type: 'range', min: 4, max: 80, step: 1, value: prefs.amount }), amtV = h('span.muted', '');
    var shape = h('select', [['ellipse', 'Ellipse'], ['rect', 'Rectangle']].map(function (o) { return h('option', { value: o[0] }, o[1]); })); shape.value = prefs.shape;
    var track = h('input', { type: 'checkbox', checked: prefs.track !== false });
    function upd() { amtV.textContent = kind.value === 'gblur' ? amount.value + ' px blur' : kind.value === 'pixelate' ? amount.value + ' px cells' : 'solid'; amount.disabled = kind.value === 'solid'; }
    kind.addEventListener('change', upd); amount.addEventListener('input', upd); upd();
    var body = h('div', { style: { width: '480px', lineHeight: '1.5' } },
      h('div', { style: { marginBottom: '8px' } }, 'Adds a masked region to ', h('b', clips.length === 1 ? clips[0].name : clips.length + ' clips'), ' that hides a face, a name on screen or a chat overlay. The region starts in the upper middle of the frame: drag it over the subject in the Program monitor, then let the tracker follow it.'),
      h('div.form-grid', h('label', 'Hide with'), kind, h('label', 'Strength'), h('div', amount, h('br'), amtV), h('label', 'Shape'), shape,
        h('label', 'Tracking'), h('label.cl-check', track, h('span', 'Track the region forward from the playhead right away'))));
    var d = C.ui.dialog({ title: 'Censor Region', width: 520, body: body, buttons: [{ label: 'Cancel' }, { label: 'Add', primary: true, id: 'go', action: function () {
      U.lsSet('autocut.censor', { kind: kind.value, amount: +amount.value, shape: shape.value, track: track.checked });
      var made = [];
      C.edit('Censor Region', function (s2) {
        clips.forEach(function (c) {
          var cc = P.clip(s2, c.id); if (!cc) return;
          var fx;
          if (kind.value === 'solid') { fx = C.FX.newInstance('levels'); fx.p.ow = 0; fx.p.ob = 0; } // Levels with output white 0 = solid black
          else { fx = C.FX.newInstance(kind.value); if (kind.value === 'pixelate') fx.p.size = +amount.value; else fx.p.r = +amount.value; }
          cc.fx = cc.fx || []; cc.fx.push(fx);
          var m = C.Masks.newMask(shape.value, { cx: 50, cy: 38, w: shape.value === 'rect' ? 22 : 18, h: shape.value === 'rect' ? 30 : 30, feather: kind.value === 'solid' ? 0 : 12, fx: fx.id, name: 'Censor' });
          cc.masks = cc.masks || []; cc.masks.push(m);
          made.push({ clip: cc.id, mask: m.id });
        });
      });
      if (made.length === 1 && C.Inspector) { C.Inspector.selMask = made[0].mask; if (C.Program) C.Program.selMask = made[0].mask; C.Inspector.sig = null; C.Inspector.refresh(); }
      d.close();
      if (track.checked && made.length === 1 && C.Tracker) {
        var c = P.clip(s, made[0].clip), lf = C.Engine.frame - c.start;
        if (lf >= 0 && lf < c.dur - 1) {
          var opts = { cancel: {} }, prog = C.ui.progress('Tracking the censor region…', { cancel: function () { opts.cancel.v = true; } });
          opts.onProgress = function (p) { prog.update(p, Math.round(p * 100) + '%'); };
          C.Tracker.trackMask(s, c, made[0].mask, lf, 1, opts).then(function (r) { prog.done(); C.toast('Censor region tracked: ' + r.keys + ' keyframes — reposition it on the first frame if it drifted, then track again', 4500); }, function (e) { prog.done(); C.toast('Tracking failed: ' + (e && e.message || e)); });
          return;
        }
      }
      C.toast('Censor region added — drag it over the subject in the Program monitor, then Track ▶ in the Inspector', 4500);
    } }] });
  };
  C.CMD.reg('censor', 'Censor Region (Blur / Pixelate)…', 'Clip', null, function () { AC.censorDialog(); });
  var prevClip = C.Menus.extra.Clip;
  C.Menus.extra.Clip = function () {
    var c = C.CMD.byId;
    return (prevClip ? prevClip() : []).concat([{ label: c.censor.name, action: function () { C.CMD.run('censor'); }, disabled: function () { return !C.state.project; } }]);
  };
})();

/* ---------- Voice Polish preset + pop-out Program Monitor ---------- */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, P = C.P;
  // one-click dialogue chain: rumble filter → noise reduction → de-esser → compressor → presence EQ → limiter
  C.AutoCut.voicePolish = function () {
    var s = P.seq(); if (!s) return;
    // audio clips, plus the linked audio of any selected video clip (selecting the picture is the natural gesture)
    var sel = P.selectedClips(), ids = {}, clips = [];
    sel.forEach(function (c) {
      if (c.kind === 'audio') { if (!ids[c.id]) { ids[c.id] = 1; clips.push(c); } return; }
      if (c.kind === 'video' && c.link) s.clips.forEach(function (k) { if (k.kind === 'audio' && k.link === c.link && !ids[k.id]) { ids[k.id] = 1; clips.push(k); } });
    });
    if (!clips.length) { C.toast('Select the audio clip(s) with the voice first (or the video clip they are linked to)'); return; }
    var chain = [['a_hpf', { f: 85, q: 0.7 }], ['a_denoise', { amount: 10, sens: 45, smooth: 55 }], ['a_deess', { f: 6000, amt: 45, th: -28 }], ['a_comp', { th: -20, ratio: 3, knee: 8, att: 8, rel: 180, makeup: 4 }], ['a_eq', { low: -2, mid: 2.5, midf: 3000, high: 1.5 }], ['a_limit', { ceil: -1, rel: 120, gain: 0 }]];
    C.edit('Voice Polish', function (s2) {
      clips.forEach(function (c) {
        var cc = P.clip(s2, c.id); if (!cc) return;
        cc.fx = (cc.fx || []).filter(function (f) { return !f._voicePolish; });
        chain.forEach(function (it) { var fx = C.FX.newInstance(it[0]); if (!fx) return; Object.keys(it[1]).forEach(function (k) { if (k in fx.p) fx.p[k] = it[1][k]; }); fx._voicePolish = true; cc.fx.push(fx); });
      });
    });
    C.toast('Voice Polish applied to ' + clips.length + ' clip' + (clips.length === 1 ? '' : 's') + ' — six effects you can tweak or remove in the Effects tab', 4000);
  };
  C.CMD.reg('voicePolish', 'Voice Polish (dialogue chain)', 'Clip', null, function () { C.AutoCut.voicePolish(); });

  // second-screen program view: a window that mirrors the Program monitor's canvas through captureStream
  var pop = null;
  C.AutoCut.popOutProgram = function () {
    if (pop && !pop.closed) { pop.focus(); return; }
    var cv = C.Program && C.Program.canvas; if (!cv || !cv.captureStream) { C.toast('The Program monitor is not available'); return; }
    pop = window.open('', 'cutline-program', 'width=960,height=560,menubar=no,toolbar=no,location=no,status=no');
    if (!pop) { C.toast('The browser blocked the pop-up window — allow pop-ups for this page and try again'); return; }
    var d = pop.document;
    d.open(); d.write('<!doctype html><title>Cutline — Program</title><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}video{width:100%;height:100%;object-fit:contain;display:block;cursor:none}body:hover video{cursor:default}#hint{position:fixed;left:10px;bottom:8px;color:#aaa;font:12px system-ui;opacity:.8}</style><video id="v" autoplay muted playsinline></video><div id="hint">Double-click for full screen · Esc to leave</div>'); d.close();
    var v = d.getElementById('v'), stream = cv.captureStream(60);
    v.srcObject = stream; v.play().catch(function () { });
    v.addEventListener('dblclick', function () { if (d.fullscreenElement) d.exitFullscreen(); else v.requestFullscreen && v.requestFullscreen(); });
    var hint = d.getElementById('hint'); setTimeout(function () { if (hint) hint.style.opacity = '0'; }, 4000);
    pop.addEventListener('beforeunload', function () { try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { } pop = null; });
    C.toast('Program monitor opened in its own window — drag it to your second screen', 3500);
  };
  C.CMD.reg('popOutProgram', 'Pop Out Program Monitor', 'View', null, function () { C.AutoCut.popOutProgram(); }, { checked: function () { return !!(pop && !pop.closed); } });
  var prevClip = C.Menus.extra.Clip, prevView = C.Menus.extra.View;
  function cmd(id) { return C.CMD.menuItem(id); }
  C.Menus.extra.Clip = function () { return (prevClip ? prevClip() : []).concat([cmd('voicePolish')]); };
  C.Menus.extra.View = function () { return (prevView ? prevView() : []).concat([cmd('popOutProgram')]); };
})();
