/* Cutline — second-pass additions: auto-reframe, replace clip, paste attributes, lift/extract to a new sequence,
   trim to playhead, select by media, marker colour keys, autosave versions, project manager. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, h = U.h, P = C.P, T = C.T, KF = C.KF, A = C.A;

  /* ---------- Auto-reframe (keyframed pan that follows the action for vertical/square deliveries) ---------- */
  // sample a clip's motion: returns [{lf, cx, cy}] with the centre of frame-to-frame change in source fractions
  A.analyseMotion = function (seq, clip, opts, onProgress) {
    var m = P.media(clip.mediaId), rt = C.MRT[C.Media.base(m).id];
    if (!m || m.type !== 'video' || !rt || !rt.url) return Promise.resolve([]);
    var step = Math.max(1, Math.round(seq.fps * (opts.stepSec || 0.25))), n = Math.ceil(clip.dur / step);
    if (n > 600) { step = Math.ceil(clip.dur / 600); n = Math.ceil(clip.dur / step); }
    var v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = rt.url;
    var W = 64, Hh = 36, cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
    var g = cv.getContext('2d', { willReadFrequently: true }), prev = null, out = [], cancelled = false;
    opts.cancel = opts.cancel || {};
    return C.Media.waitEvent(v, 'loadeddata', 'error', 20000).then(function () {
      var i = 0;
      function next() {
        if (i >= n || opts.cancel.v) return Promise.resolve(out);
        var lf = Math.min(clip.dur - 1, i * step), t = U.clamp(P.sourceSec(seq, clip, clip.start + lf), 0, Math.max(0, m.duration - 0.05));
        return C.Media.seekTo(v, t).then(function () {
          g.drawImage(v, 0, 0, W, Hh);
          var d = g.getImageData(0, 0, W, Hh).data, sx = 0, sy = 0, sw = 0;
          if (prev) {
            for (var y = 0; y < Hh; y++) for (var x = 0; x < W; x++) {
              var k = (y * W + x) * 4, df = Math.abs(d[k] - prev[k]) + Math.abs(d[k + 1] - prev[k + 1]) + Math.abs(d[k + 2] - prev[k + 2]);
              if (df > 30) { var w = df; sx += (x + 0.5) * w; sy += (y + 0.5) * w; sw += w; }
            }
          }
          // too little change (static shot): no opinion -> null, interpolated later
          out.push({ lf: lf, cx: sw > 300 ? sx / sw / W : null, cy: sw > 300 ? sy / sw / Hh : null, energy: sw });
          prev = new Uint8ClampedArray(d);
          i++; if (onProgress) onProgress(i / n);
          return next();
        });
      }
      return next();
    }).then(function (r) { v.removeAttribute('src'); v.load(); return r; }, function (e) { v.removeAttribute('src'); v.load(); throw e; });
  };
  // write tf.x / tf.y keyframes so the chosen anchor path stays centred; samples: [{lf, cx, cy}] (fractions of the source)
  A.applyReframe = function (seq, clip, samples, opts) {
    var m = P.media(clip.mediaId); if (!m) return 0;
    var nw = m.w || seq.w, nh = m.h || seq.h;
    var fit = Math.min(seq.w / nw, seq.h / nh), cover = Math.max(seq.w / nw, seq.h / nh);
    clip.fit = true; clip.tf.uni = true; clip.tf.scale = U.round(cover / fit * 100 * (opts.zoom || 1), 2); clip.tf.ax = 50; clip.tf.ay = 50; clip.tf.rot = 0;
    var sx = fit * clip.tf.scale / 100;
    var minX = seq.w - nw * sx / 2, maxX = nw * sx / 2, minY = seq.h - nh * sx / 2, maxY = nh * sx / 2;
    function xFor(cx) { return U.clamp(seq.w / 2 - (cx - 0.5) * nw * sx, Math.min(minX, maxX), Math.max(minX, maxX)); }
    function yFor(cy) { return U.clamp(seq.h / 2 - (cy - 0.5) * nh * sx, Math.min(minY, maxY), Math.max(minY, maxY)); }
    clip.kf = clip.kf || {};
    ['tf.x', 'tf.y'].forEach(function (pth) { if (clip.kf[pth]) { clip.kf[pth] = clip.kf[pth].filter(function (k) { return !k.r; }); if (!clip.kf[pth].length) delete clip.kf[pth]; } });
    if (!samples || !samples.length) { clip.tf.x = seq.w / 2; clip.tf.y = seq.h / 2; return 0; }
    // fill gaps (static stretches) by holding the last known centre, smooth with a moving average
    var last = { cx: 0.5, cy: 0.5 }, pts = samples.map(function (s) { if (s.cx != null) last = { cx: s.cx, cy: s.cy }; return { lf: s.lf, cx: last.cx, cy: last.cy }; });
    var win = Math.max(1, Math.round((opts.smooth || 1.5) / (opts.stepSec || 0.25)));
    var sm = pts.map(function (p, i) { var a = Math.max(0, i - win), b = Math.min(pts.length - 1, i + win), cx = 0, cy = 0, n = 0; for (var j = a; j <= b; j++) { cx += pts[j].cx; cy += pts[j].cy; n++; } return { lf: p.lf, cx: cx / n, cy: cy / n }; });
    var keysX = [], keysY = [], n = 0, lastX = null, lastY = null;
    sm.forEach(function (p, i) {
      var x = U.round(xFor(p.cx), 1), y = U.round(yFor(p.cy), 1), lastOne = i === sm.length - 1;
      if (lastX == null || Math.abs(x - lastX) > 2 || lastOne) { keysX.push({ f: p.lf, v: x, e: 'inout', r: 1 }); lastX = x; n++; }
      if (opts.vertical !== false && (lastY == null || Math.abs(y - lastY) > 2 || lastOne)) { keysY.push({ f: p.lf, v: y, e: 'inout', r: 1 }); lastY = y; }
    });
    // a pan that never moves becomes a static position
    if (keysX.length > 1 && keysX.every(function (k) { return Math.abs(k.v - keysX[0].v) <= 2; })) { clip.tf.x = keysX[0].v; keysX = []; }
    if (keysY.length > 1 && keysY.every(function (k) { return Math.abs(k.v - keysY[0].v) <= 2; })) { clip.tf.y = keysY[0].v; keysY = []; }
    if (keysX.length === 1) { clip.tf.x = keysX[0].v; keysX = []; }
    if (keysY.length === 1) { clip.tf.y = keysY[0].v; keysY = []; }
    if (keysX.length) clip.kf['tf.x'] = KF.sort((clip.kf['tf.x'] || []).concat(keysX)); if (keysY.length) clip.kf['tf.y'] = KF.sort((clip.kf['tf.y'] || []).concat(keysY));
    if (!keysX.length && !clip.kf['tf.x'] && samples.length) clip.tf.x = U.round(xFor(sm[0].cx), 1);
    return keysX.length + keysY.length;
  };
  A.reframeDialog = function () {
    var s = P.seq(), clips = P.selectedClips().filter(function (c) { return c.kind === 'video' && (P.media(c.mediaId) || {}).type === 'video'; });
    if (!clips.length) { C.toast('Select a video clip to reframe'); return; }
    var prefs = U.lsGet('reframe', { mode: 'motion', smooth: 1.5, zoom: 1 });
    var mode = h('select'); [['center', 'Keep the centre (fill the frame)'], ['motion', 'Follow the centre of motion'], ['keep', 'Fill the frame, keep my Position keyframes']].forEach(function (o) { mode.appendChild(h('option', { value: o[0] }, o[1])); }); mode.value = prefs.mode;
    var smooth = h('input', { type: 'number', min: 0.25, max: 10, step: 0.25, value: prefs.smooth, style: { width: '70px' } }), zoom = h('input', { type: 'number', min: 1, max: 2, step: 0.05, value: prefs.zoom, style: { width: '70px' } });
    [smooth, zoom].forEach(function (i) { i.addEventListener('keydown', function (e) { e.stopPropagation(); }); });
    var status = h('div.muted', { style: { minHeight: '18px' } });
    var m0 = P.media(clips[0].mediaId);
    var body = h('div', { style: { width: '520px', lineHeight: 1.5 } },
      h('div.muted', { style: { marginBottom: '8px' } }, 'Scales the clip to fill this ' + s.w + '×' + s.h + ' frame and animates Position so the action stays in view (' + m0.w + '×' + m0.h + ' source). Follow-motion scans the clip for where the picture changes most; the result is ordinary Position keyframes you can refine by hand.'),
      h('div.form-grid', h('label', 'Anchor'), mode, h('label', 'Smoothing'), h('div.row', smooth, h('span.muted', 'seconds (higher = calmer pans)')), h('label', 'Extra zoom'), h('div.row', zoom, h('span.muted', '× (1 = just fill the frame)'))),
      status);
    var d = C.ui.dialog({ title: 'Auto-Reframe', width: 580, body: body, buttons: [{ label: 'Cancel' }, { label: 'Reframe', primary: true, id: 'go', action: function () {
      var o = { mode: mode.value, smooth: +smooth.value || 1.5, zoom: +zoom.value || 1, stepSec: 0.25, cancel: { v: false } };
      U.lsSet('reframe', { mode: o.mode, smooth: o.smooth, zoom: o.zoom });
      d.go.disabled = true;
      var ids = clips.map(function (c) { return c.id; }), results = {}, chain = Promise.resolve();
      if (o.mode === 'motion') ids.forEach(function (id, idx) { chain = chain.then(function () { var cc = P.clip(P.seq(), id); if (!cc) return; return A.analyseMotion(P.seq(), cc, o, function (k) { status.textContent = 'Scanning ' + cc.name + ' (' + (idx + 1) + '/' + ids.length + ')  ' + Math.round(k * 100) + '%'; }).then(function (r) { results[id] = r; }); }); });
      chain.then(function () {
        var n = 0;
        C.edit('Auto-Reframe', function (s2) {
          ids.forEach(function (id) {
            var cc = P.clip(s2, id); if (!cc) return;
            if (o.mode === 'keep') { var keep = (cc.kf['tf.x'] || []).concat(cc.kf['tf.y'] || []); A.applyReframe(s2, cc, null, o); if (keep.length) { /* keyframes kept by applyReframe (only r-flagged ones are removed) */ } }
            else n += A.applyReframe(s2, cc, o.mode === 'motion' ? results[id] : null, o);
          });
        });
        d.close();
        C.toast(o.mode === 'motion' ? 'Reframed ' + ids.length + ' clip' + (ids.length > 1 ? 's' : '') + ' with ' + n + ' Position keyframes' : 'Reframed ' + ids.length + ' clip' + (ids.length > 1 ? 's' : ''), 4000);
      }, function (e) { status.textContent = 'Could not analyse: ' + (e && e.message || e); d.go.disabled = false; });
      return false;
    } }] });
  };

  /* ---------- Replace clip (swap the source, keep every edit) ---------- */
  A.replaceClip = function (mediaId) {
    var s = P.seq(), sel = P.selectedClips();
    var m = P.media(mediaId || (C.Bin && C.Bin.sel.filter(function (i) { return P.media(i); })[0]));
    if (!sel.length) { C.toast('Select the timeline clip to replace first'); return; }
    if (!m) { C.toast('Select the replacement item in the Library'); return; }
    var n = 0, warned = false;
    C.edit('Replace Clip', function (s2) {
      sel.forEach(function (c) {
        var cc = P.clip(s2, c.id); if (!cc) return;
        var want = cc.kind === 'video' ? P.mediaHasVideo(m) : P.mediaHasAudio(m);
        if (!want) { warned = true; return; }
        cc.mediaId = m.id; cc.name = m.name;
        if (m.type === 'gen') { cc.gen = U.clone(m.gen); } else delete cc.gen;
        cc.in = m.sub ? m.sub.in : 0; cc.freeze = null;
        var mx = P.clipMaxDur(s2, cc); if (cc.dur > mx) cc.dur = Math.max(1, mx);
        n++;
      });
      if (!n) return false;
    });
    if (!n) C.toast('The replacement has no ' + (sel[0].kind === 'video' ? 'video' : 'audio') + ' for ' + sel[0].name);
    else C.toast('Replaced ' + n + ' clip' + (n > 1 ? 's' : '') + ' with ' + m.name + (warned ? ' (some clips skipped: kind mismatch)' : ''));
  };

  /* ---------- Paste attributes ---------- */
  A.copyAttributes = function () {
    var c = P.primaryClip(); if (!c) { C.toast('Select a clip to copy attributes from'); return; }
    C.state.attrClipboard = { from: c.name, kind: c.kind, tf: U.clone(c.tf), fit: c.fit, blend: c.blend, col: U.clone(c.col), fx: U.clone(c.fx), masks: U.clone(c.masks), au: U.clone(c.au), fadeIn: c.fadeIn, fadeOut: c.fadeOut, speed: c.speed, reverse: c.reverse, kf: U.clone(c.kf), dur: c.dur };
    C.toast('Attributes copied from ' + c.name + ' (Clip › Paste Attributes…)');
  };
  A.pasteAttributesDialog = function () {
    var cb = C.state.attrClipboard; if (!cb) { C.toast('Copy attributes from a clip first (Clip › Copy Attributes)'); return; }
    var targets = P.selectedClips(); if (!targets.length) { C.toast('Select the clips to paste onto'); return; }
    var opts = { tf: true, fx: true, col: true, masks: true, au: true, speed: false, scaleKf: true };
    var video = cb.kind === 'video';
    function chk(label, key, show) { if (show === false) return null; var i = h('input', { type: 'checkbox', checked: opts[key] }); i.addEventListener('change', function () { opts[key] = i.checked; }); return h('label.cl-check', i, h('span', label)); }
    var body = h('div', { style: { width: '380px', display: 'flex', flexDirection: 'column', gap: '6px' } },
      h('div.muted', 'From ' + cb.from + ' to ' + targets.length + ' selected clip' + (targets.length > 1 ? 's' : '')),
      chk('Transform (position, scale, rotation, opacity, crop, blend)', 'tf', video), chk('Effects', 'fx'), chk('Color grade', 'col', video), chk('Masks', 'masks', video),
      chk('Audio (volume, pan, gain, fades, mute)', 'au', !video), chk('Speed / reverse', 'speed'), chk('Stretch keyframes to each clip\'s length', 'scaleKf'));
    C.ui.dialog({ title: 'Paste Attributes', body: body, buttons: [{ label: 'Cancel' }, { label: 'Paste', primary: true, action: function () {
      var n = 0;
      C.edit('Paste Attributes', function (s2) {
        targets.forEach(function (t) {
          var cc = P.clip(s2, t.id); if (!cc || cc.kind !== cb.kind) return;
          cc.kf = cc.kf || {};
          var k = opts.scaleKf && cb.dur > 1 ? (cc.dur - 1) / (cb.dur - 1) : 1;
          function copyKf(prefixes) { Object.keys(cb.kf || {}).forEach(function (pth) { if (!prefixes.some(function (p) { return pth.indexOf(p) === 0; })) return; cc.kf[pth] = cb.kf[pth].map(function (key) { return Object.assign({}, key, { f: Math.round(key.f * k) }); }); }); }
          function dropKf(prefixes) { Object.keys(cc.kf).forEach(function (pth) { if (prefixes.some(function (p) { return pth.indexOf(p) === 0; })) delete cc.kf[pth]; }); }
          if (video && opts.tf) { cc.tf = U.clone(cb.tf); cc.fit = cb.fit; cc.blend = cb.blend; dropKf(['tf.']); copyKf(['tf.']); }
          if (opts.fx) { cc.fx = U.clone(cb.fx || []).map(function (f) { var nf = Object.assign({}, f, { id: U.uid('fx') }); Object.keys(cb.kf || {}).forEach(function (pth) { if (pth.indexOf('fx.' + f.id + '.') === 0) cc.kf[pth.replace(f.id, nf.id)] = cb.kf[pth].map(function (key) { return Object.assign({}, key, { f: Math.round(key.f * k) }); }); }); (cb.masks || []).forEach(function (mk) { if (mk.fx === f.id) mk._nf = nf.id; }); return nf; }); dropKf(['fx.']); Object.keys(cc.kf).forEach(function (pth) { if (pth.indexOf('fx.') === 0 && !cc.fx.some(function (f) { return pth.indexOf('fx.' + f.id + '.') === 0; })) delete cc.kf[pth]; }); }
          if (video && opts.col) { cc.col = U.clone(cb.col); dropKf(['col.']); copyKf(['col.']); }
          if (video && opts.masks) { dropKf(['mk.']); cc.masks = U.clone(cb.masks || []).map(function (mk) { var nm = Object.assign({}, mk, { id: U.uid('mk') }); nm.fx = mk._nf || (opts.fx ? null : mk.fx); delete nm._nf; Object.keys(cb.kf || {}).forEach(function (pth) { if (pth.indexOf('mk.' + mk.id + '.') === 0) cc.kf[pth.replace(mk.id, nm.id)] = cb.kf[pth].map(function (key) { return Object.assign({}, key, { f: Math.round(key.f * k) }); }); }); return nm; }); }
          if (!video && opts.au) { cc.au = U.clone(cb.au); cc.fadeIn = Math.min(cb.fadeIn || 0, cc.dur); cc.fadeOut = Math.min(cb.fadeOut || 0, cc.dur); dropKf(['au.']); copyKf(['au.']); }
          if (opts.speed) { T.setSpeed(s2, cc, cb.speed, false); cc.reverse = cb.reverse; }
          n++;
        });
        (cb.masks || []).forEach(function (mk) { delete mk._nf; });
      });
      C.toast('Pasted attributes onto ' + n + ' clip' + (n === 1 ? '' : 's'));
    } }] });
  };

  /* ---------- Lift / Extract to a new sequence ---------- */
  A.rangeToSequence = function (extract) {
    var s = P.seq(); if (!s) return;
    if (s.inF == null || s.outF == null) { C.toast('Set sequence In and Out points first (I / O)'); return; }
    var tids = T.targetTracks(s), inF = s.inF, outF = s.outF, made = 0, newId;
    C.edit(extract ? 'Extract to New Sequence' : 'Lift to New Sequence', function (s2, prj) {
      var ns = P.newSequence({ w: s2.w, h: s2.h, fps: s2.fps, bg: s2.bg, vtracks: P.vtracks(s2).length, atracks: P.atracks(s2).length });
      ns.name = s2.name + ' ' + U.fmtTC(inF, s2.fps, { short: true }).replace(/[:;]/g, '.');
      ns.tracks = s2.tracks.map(function (t) { var n = U.clone(t); n.id = U.uid('t'); n._src = t.id; return n; });
      var tmap = {}; ns.tracks.forEach(function (t) { tmap[t._src] = t.id; delete t._src; });
      // copy (trimmed to the range) every clip on the targeted tracks that overlaps the range
      var lmap = {};
      s2.clips.forEach(function (c) {
        if (tids.indexOf(c.trackId) < 0 || c.start + c.dur <= inF || c.start >= outF) return;
        var n = U.clone(c); n.id = U.uid('c'); n.trackId = tmap[c.trackId];
        if (c.link) n.link = lmap[c.link] || (lmap[c.link] = U.uid('lk'));
        ns.clips.push(n);
        if (n.start < inF) T.setStart(ns, n, inF);
        if (n.start + n.dur > outF) T.setEnd(ns, n, outF);
        n.start -= inF; made++;
      });
      ns.captions = s2.captions.filter(function (c) { return c.end > inF && c.start < outF; }).map(function (c) { var n = U.clone(c); n.id = U.uid('cap'); n.start = Math.max(0, c.start - inF); n.end = Math.min(outF, c.end) - inF; return n; });
      ns.markers = s2.markers.filter(function (m) { return m.f >= inF && m.f < outF; }).map(function (m) { var n = U.clone(m); n.id = U.uid('mk'); n.f -= inF; return n; });
      prj.sequences.push(ns); newId = ns.id;
      if (extract) { T.extract(s2, inF, outF, tids); s2.outF = null; } else T.lift(s2, inF, outF, tids);
    });
    C.bus.emit('sequence');
    C.toast((extract ? 'Extracted' : 'Lifted') + ' ' + made + ' clip' + (made === 1 ? '' : 's') + ' into a new sequence');
    if (extract) C.Engine.seek(inF);
    void newId;
  };

  /* ---------- Trim to playhead (non-ripple) ---------- */
  A.trimToPlayhead = function (edge) {
    var s = P.seq(), f = C.Engine.frame;
    var list = P.selectedClips().filter(function (c) { return f > c.start && f < c.start + c.dur; });
    if (!list.length) list = s.clips.filter(function (c) { var t = P.track(s, c.trackId); return t && t.target && !t.lock && f > c.start && f < c.start + c.dur; });
    if (!list.length) { C.toast('No clip under the playhead' + (P.selectedClips().length ? ' in the selection' : ' on targeted tracks')); return; }
    C.edit(edge === 'start' ? 'Trim Start to Playhead' : 'Trim End to Playhead', function (s2) {
      list.forEach(function (c) { var cc = P.clip(s2, c.id); if (!cc) return; if (edge === 'start') T.setStart(s2, cc, f); else T.setEnd(s2, cc, f); });
    });
  };

  /* ---------- Select all clips using a media item ---------- */
  A.selectByMedia = function (mediaId) {
    var s = P.seq(); if (!s) return;
    var base = C.Media.base(P.media(mediaId)); if (!base) return;
    var ids = s.clips.filter(function (c) { var m = P.media(c.mediaId); return m && (m.id === mediaId || C.Media.base(m).id === base.id); }).map(function (c) { return c.id; });
    C.state.selection = ids; C.state.selTransition = null; C.state.primaryId = null; C.bus.emit('selection');
    C.toast(ids.length + ' clip' + (ids.length === 1 ? '' : 's') + ' use ' + base.name + (ids.length ? '' : ' in this sequence'));
  };

  /* ---------- Marker colours by number keys (1–8) ---------- */
  A.setMarkerColor = function (i) {
    var s = P.seq(), col = A.MARKER_COLORS[i]; if (!s || !col) return false;
    if (C.state.selMarker) { var id = C.state.selMarker; C.edit('Marker Color', function (s2) { var m = s2.markers.filter(function (x) { return x.id === id; })[0]; if (m) m.color = col; }); return true; }
    var sel = P.selectedClips();
    if (sel.length) { A.setLabel(col); return true; }
    return false;
  };

  /* ---------- Autosave versions ---------- */
  var VERS_KEY = 'versions', VERS_MAX = 12, VERS_GAP = 90000, lastVersion = 0;
  C.IO.pushVersion = function (json, label) {
    var now = Date.now();
    if (now - lastVersion < VERS_GAP) return Promise.resolve();
    lastVersion = now;
    return C.Store.get(VERS_KEY).then(function (list) {
      list = Array.isArray(list) ? list : [];
      var p; try { p = JSON.parse(json); } catch (e) { return; }
      list.push({ t: now, name: p.name, label: label || (C.H.undo.length ? C.H.undo[C.H.undo.length - 1].label : ''), seqs: p.sequences.length, clips: p.sequences.reduce(function (a, s) { return a + s.clips.length; }, 0), json: json });
      while (list.length > VERS_MAX) list.shift();
      return C.Store.put(VERS_KEY, list);
    });
  };
  C.IO.versionsDialog = function () {
    C.Store.get(VERS_KEY).then(function (list) {
      list = (Array.isArray(list) ? list : []).slice().reverse();
      var rows = h('div.relink-list');
      if (!list.length) rows.appendChild(h('div.relink-row', 'No earlier versions yet — a version is kept at most every 90 s while you edit (the last 12).'));
      list.forEach(function (v) {
        var btn = h('button.btn.sm', 'Restore');
        btn.addEventListener('click', function () {
          C.ui.confirm('Restore "' + v.name + '" as saved ' + new Date(v.t).toLocaleString() + '? The current state is kept as the newest version first.', 'Restore').then(function (ok) {
            if (!ok) return;
            lastVersion = 0; C.IO.pushVersion(C.IO.serialize(), 'Before restore');
            C.ui.openDialogs.slice().forEach(function (dd) { dd.close(); });
            C.IO.load(v.json, C.state.fileHandle, 'Restored Version'); C.state.dirty = true; C.bus.emit('saved');
          });
        });
        rows.appendChild(h('div.relink-row', h('span', { style: { fontFamily: 'var(--mono)', fontSize: '11px' } }, new Date(v.t).toLocaleString()), h('span', v.name), h('span.muted', v.seqs + ' seq · ' + v.clips + ' clips' + (v.label ? ' · after "' + v.label + '"' : '')), btn));
      });
      C.ui.dialog({ title: 'Restore Previous Version', width: 640, body: h('div', h('p.muted', { style: { marginTop: 0 } }, 'Automatic snapshots of this browser profile\'s recent work. Restoring replaces the open project (undo history starts fresh).'), rows), buttons: [{ label: 'Close', primary: true }] });
    });
  };

  /* ---------- Project manager ---------- */
  C.IO.projectManager = function () {
    var prj = C.state.project; if (!prj) return;
    function usage() {
      var use = {};
      prj.sequences.forEach(function (s) { s.clips.forEach(function (c) { var m = P.media(c.mediaId); if (!m) return; var b = C.Media.base(m); (use[b.id] = use[b.id] || { clips: 0, seqs: {} }).clips++; use[b.id].seqs[s.name] = 1; if (m.id !== b.id) { (use[m.id] = use[m.id] || { clips: 0, seqs: {} }).clips++; use[m.id].seqs[s.name] = 1; } }); });
      return use;
    }
    var body = h('div', { style: { width: '720px' } }), table = h('table.bin-list'), tot = h('div.row', { style: { gap: '14px', margin: '8px 0 0', fontSize: '11px' } });
    function render() {
      U.clear(table); U.clear(tot);
      var use = usage(), files = prj.media.filter(function (m) { return m.type !== 'nest'; }), totalB = 0, usedB = 0, unused = 0;
      table.appendChild(h('tr', h('th', 'Name'), h('th', 'Type'), h('th', 'Size'), h('th', 'Duration'), h('th', 'Used in'), h('th', 'Status')));
      files.sort(function (a, b) { return (b.size || 0) - (a.size || 0); }).forEach(function (m) {
        var u = use[m.id], online = C.Media.isOnline(m), sz = m.sub ? 0 : (m.size || 0);
        totalB += sz; if (u) usedB += sz; else unused++;
        table.appendChild(h('tr' + (u ? '' : '.unused'), h('td', { title: m.file && m.file !== m.name ? 'File: ' + m.file : m.name }, m.name), h('td', m.sub ? 'subclip' : m.type === 'gen' ? C.Media.GEN_NAMES[m.gen.kind] : m.type), h('td', m.sub ? '—' : U.fmtSize(m.size)), h('td', P.isStill(m) ? 'still' : U.fmtDur(m.sub ? m.sub.out - m.sub.in : m.duration)),
          h('td', u ? u.clips + ' clip' + (u.clips > 1 ? 's' : '') + ' · ' + Object.keys(u.seqs).join(', ') : h('span', { style: { color: 'var(--warn)' } }, 'unused')), h('td', m.type === 'gen' ? 'generated' : online ? 'online' : h('span', { style: { color: 'var(--danger)' } }, 'OFFLINE'))));
      });
      U.append(tot, [h('b', files.length + ' items'), h('span', U.fmtSize(totalB) + ' on disk'), h('span', U.fmtSize(usedB) + ' used by sequences'), h('span', { style: { color: unused ? 'var(--warn)' : 'inherit' } }, unused + ' unused')]);
      removeBtn.disabled = !unused;
    }
    var removeBtn = h('button.btn', 'Remove Unused Media');
    removeBtn.addEventListener('click', function () {
      var use = usage(), ids = prj.media.filter(function (m) { return m.type !== 'nest' && !use[m.id]; }).map(function (m) { return m.id; });
      if (!ids.length) return;
      C.ui.confirm('Remove ' + ids.length + ' unused item' + (ids.length > 1 ? 's' : '') + ' from the Library? The files on disk are not touched.', 'Remove').then(function (ok) { if (ok) { C.Media.removeMedia(ids); render(); } });
    });
    var copyBtn = h('button.btn', 'Copy Media List');
    copyBtn.addEventListener('click', function () {
      var use = usage();
      var lines = ['Name,File,Type,Size (bytes),Duration (s),Clips,Sequences,Status'].concat(prj.media.filter(function (m) { return m.type !== 'nest'; }).map(function (m) { var u = use[m.id]; return [JSON.stringify(m.name), JSON.stringify(m.file || m.name), m.type, m.size || 0, P.isStill(m) ? '' : (m.duration || 0).toFixed(3), u ? u.clips : 0, JSON.stringify(u ? Object.keys(u.seqs).join('; ') : ''), C.Media.isOnline(m) ? 'online' : 'offline'].join(','); }));
      var txt = lines.join('\n');
      (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { C.toast('Media list copied (CSV)'); }, function () { U.download(new Blob([txt], { type: 'text/csv' }), (prj.name || 'project') + '-media.csv'); });
    });
    U.append(body, [h('div.row', { style: { gap: '6px', marginBottom: '8px' } }, removeBtn, copyBtn, h('span', { style: { flex: 1 } }), h('button.btn', { on: { click: function () { C.IO.relinkDialog(); } } }, 'Relink Media…')), h('div', { style: { maxHeight: '50vh', overflow: 'auto' } }, table), tot]);
    render();
    C.ui.dialog({ title: 'Project Manager — ' + prj.name, width: 780, body: body, buttons: [{ label: 'Close', primary: true }] });
  };
})();
