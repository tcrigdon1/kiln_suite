/* Cutline — scene evaluation: what is visible at a given sequence frame, with all keyframes resolved. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, P = C.P, KF = C.KF;
  var S = C.Scene = {};

  S.BLENDS = [['normal', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['add', 'Add (Linear Dodge)'], ['subtract', 'Subtract'],
    ['darken', 'Darken'], ['lighten', 'Lighten'], ['difference', 'Difference'], ['exclusion', 'Exclusion'], ['softlight', 'Soft Light'], ['hardlight', 'Hard Light'],
    ['dodge', 'Color Dodge'], ['burn', 'Color Burn'], ['color', 'Color'], ['luminosity', 'Luminosity']];
  S.blendIndex = function (b) { for (var i = 0; i < S.BLENDS.length; i++) if (S.BLENDS[i][0] === b) return i; return 0; };

  var TF_KEYS = ['x', 'y', 'scale', 'sw', 'sh', 'rot', 'ax', 'ay', 'op', 'cl', 'cr', 'ct', 'cb'];
  var COL_NUM = ['temp', 'tint', 'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'sat', 'vib', 'fade', 'sharpen', 'lookAmt',
    'shX', 'shY', 'shL', 'midX', 'midY', 'midL', 'hiX', 'hiY', 'hiL', 'vig', 'vigMid', 'vigRound', 'vigFeather', 'lutAmt'];
  S.TF_KEYS = TF_KEYS; S.COL_NUM = COL_NUM;

  S.evalTransform = function (clip, lf) {
    var o = {};
    for (var i = 0; i < TF_KEYS.length; i++) { var k = TF_KEYS[i]; o[k] = KF.value(clip, 'tf.' + k, lf); }
    o.uni = clip.tf.uni; o.fh = clip.tf.fh; o.fv = clip.tf.fv;
    return o;
  };
  S.evalFx = function (clip, lf, stage) {
    var out = [];
    (clip.fx || []).forEach(function (e) {
      if (!e.on) return;
      var def = C.FX.byId[e.type];
      if (!def || def.audio) return;
      if (stage && def.stage !== stage) return;
      var p = {};
      def.params.forEach(function (q) {
        p[q.k] = q.type === 'range' ? KF.value(clip, 'fx.' + e.id + '.' + q.k, lf) : e.p[q.k];
        if (p[q.k] == null) p[q.k] = q.def;
      });
      out.push({ def: def, p: p, id: e.id });
    });
    return out;
  };
  S.evalColor = function (clip, lf) {
    var col = clip.col;
    if (!col || !col.on || P.colorIsDefault(col)) return null;
    var o = { look: col.look, curves: col.curves, lut: col.lut || null };
    COL_NUM.forEach(function (k) { o[k] = KF.value(clip, 'col.' + k, lf); if (o[k] == null) o[k] = k === 'lutAmt' ? 100 : 0; });
    return o;
  };

  function clipLayer(seq, clip, frame, opts) {
    var m = P.media(clip.mediaId);
    var lf = U.clamp(frame - clip.start, 0, clip.dur - 1);
    var L = {
      t: 'clip', clip: clip, media: m, frame: frame, lf: lf, localRaw: frame - clip.start,
      srcSec: P.sourceSec(seq, clip, frame),
      tf: S.evalTransform(clip, lf), fx: S.evalFx(clip, lf, 'source'), lfx: S.evalFx(clip, lf, 'layer'),
      col: S.evalColor(clip, lf), blend: clip.blend || 'normal',
      masks: clip.masks && clip.masks.length ? C.Masks.eval(clip, lf) : []
    };
    if (m && !P.isStill(m)) L.srcSec = U.clamp(L.srcSec, 0, Math.max(0, (m.duration || 0) - 0.5 / seq.fps));
    L.adjust = !!(m && m.type === 'gen' && m.gen && m.gen.kind === 'adjust') || !!(clip.gen && clip.gen.kind === 'adjust');
    L.offline = !m || !C.Media.isOnline(m);
    if (m && m.type === 'nest' && !L.offline) {
      var inner = P.seqById(m.seqId), depth = (opts && opts.depth) || 0;
      if (inner && depth < 4) L.inner = S.build(inner, Math.floor(L.srcSec * inner.fps + 1e-6), { captions: false, depth: depth + 1 });
      else L.offline = true;
    }
    return L;
  }
  S.clipLayer = clipLayer;

  S.build = function (seq, frame, opts) {
    opts = opts || {};
    var scene = { w: seq.w, h: seq.h, bg: seq.bg || '#000000', layers: [], frame: frame, fps: seq.fps, time: frame / seq.fps, seq: seq };
    var vts = P.vtracks(seq);
    for (var ti = 0; ti < vts.length; ti++) {
      var t = vts[ti];
      if (t.hidden) continue;
      // transitions first
      var tr = null, trr = null;
      for (var k = 0; k < seq.transitions.length; k++) {
        var x = seq.transitions[k];
        if (x.trackId !== t.id) continue;
        var def = C.TR.byId[x.type];
        if (!def || def.kind !== 'video') continue;
        var rr = P.transitionRange(seq, x);
        if (frame >= rr.start && frame < rr.end) { tr = x; trr = rr; break; }
      }
      if (tr) {
        var a = trr.a && trr.a.enabled !== false ? clipLayer(seq, trr.a, frame, opts) : null;
        var b = trr.b && trr.b.enabled !== false ? clipLayer(seq, trr.b, frame, opts) : null;
        var p = (frame - trr.start + 0.5) / tr.dur;
        if (tr.reverse) p = 1 - p;
        scene.layers.push({ t: 'trans', tr: tr, def: C.TR.byId[tr.type], p: U.clamp(p, 0, 1), params: Object.assign(C.TR.defaults(tr.type), tr.params || {}),
          a: a, b: b, blend: (b || a || {}).blend || 'normal', trackId: t.id });
        continue;
      }
      var clips = seq.clips;
      for (var ci = 0; ci < clips.length; ci++) {
        var c = clips[ci];
        if (c.trackId !== t.id || c.enabled === false) continue;
        if (frame >= c.start && frame < c.start + c.dur) { scene.layers.push(clipLayer(seq, c, frame, opts)); break; }
      }
    }
    if (opts.captions !== false && seq.showCaptions !== false) {
      var cap = C.Titles.captionAt(seq, frame);
      if (cap) scene.caption = cap;
    }
    return scene;
  };

  // All clip layers referenced by a scene (including transition sides)
  S.clipLayers = function (scene) {
    var out = [];
    function add(L) { if (!L) return; out.push(L); if (L.inner) S.clipLayers(L.inner).forEach(function (x) { out.push(x); }); }
    scene.layers.forEach(function (L) {
      if (L.t === 'clip') add(L);
      else if (L.t === 'trans') { add(L.a); add(L.b); }
    });
    return out;
  };

  /* Geometry: compute the four corners (sequence px) + uvs for a clip layer */
  S.naturalSize = function (seq, L) {
    var m = L.media;
    if (!m || m.type === 'gen') return [seq.w, seq.h];
    if (m.type === 'nest' && L.inner) return [L.inner.w, L.inner.h];
    return [m.w || seq.w, m.h || seq.h];
  };
  // Map a point in the clip's natural (source) pixel space to sequence pixels, and back
  S.mapPoint = function (seq, L, px, py) {
    var q = S.quad(seq, L), tf = L.tf, a = tf.rot * Math.PI / 180;
    var dx = (px - tf.ax / 100 * q.nw) * q.sx, dy = (py - tf.ay / 100 * q.nh) * q.sy;
    return [dx * Math.cos(a) - dy * Math.sin(a) + tf.x, dx * Math.sin(a) + dy * Math.cos(a) + tf.y];
  };
  S.unmapPoint = function (seq, L, x, y) {
    var q = S.quad(seq, L), tf = L.tf, a = tf.rot * Math.PI / 180;
    var ux = x - tf.x, uy = y - tf.y;
    var dx = ux * Math.cos(a) + uy * Math.sin(a), dy = -ux * Math.sin(a) + uy * Math.cos(a);
    return [dx / (q.sx || 1e-6) + tf.ax / 100 * q.nw, dy / (q.sy || 1e-6) + tf.ay / 100 * q.nh];
  };
  S.quad = function (seq, L) {
    var ns = S.naturalSize(seq, L), nw = ns[0], nh = ns[1], tf = L.tf;
    var fit = L.clip.fit ? Math.min(seq.w / nw, seq.h / nh) : 1;
    var sx = fit * (tf.uni ? tf.scale : tf.sw) / 100 * (tf.fh ? -1 : 1);
    var sy = fit * (tf.uni ? tf.scale : tf.sh) / 100 * (tf.fv ? -1 : 1);
    var ax = tf.ax / 100 * nw, ay = tf.ay / 100 * nh;
    var x0 = U.clamp(tf.cl, 0, 100) / 100 * nw, x1 = nw * (1 - U.clamp(tf.cr, 0, 100) / 100);
    var y0 = U.clamp(tf.ct, 0, 100) / 100 * nh, y1 = nh * (1 - U.clamp(tf.cb, 0, 100) / 100);
    var a = tf.rot * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    function pt(px, py) {
      var dx = (px - ax) * sx, dy = (py - ay) * sy;
      return [dx * ca - dy * sa + tf.x, dx * sa + dy * ca + tf.y];
    }
    return {
      pts: [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)],
      uvs: [[x0 / nw, y0 / nh], [x1 / nw, y0 / nh], [x1 / nw, y1 / nh], [x0 / nw, y1 / nh]],
      full: [pt(0, 0), pt(nw, 0), pt(nw, nh), pt(0, nh)],
      anchor: [tf.x, tf.y], nw: nw, nh: nh, fit: fit, sx: sx, sy: sy
    };
  };
})();
