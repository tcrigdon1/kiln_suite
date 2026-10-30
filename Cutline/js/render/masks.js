/* Cutline — clip masks: ellipse / rectangle / pen-path shapes with feather, expansion, inversion and opacity.
   A mask either limits the whole clip (its alpha) or scopes one effect to a region (mask.fx = effect id), e.g. a
   blur on a face. Shape parameters are in percent of the clip's source frame and keyframeable ('mk.<id>.<key>');
   pen points can be animated per point, and a path as a whole moves/scales/rotates through cx/cy/w/h/rot. The shapes are rasterised to a canvas at the processing size and used as a texture. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, KF = C.KF;
  var M = C.Masks = {};
  M.KEYS = ['cx', 'cy', 'w', 'h', 'rot', 'feather', 'expand', 'op'];
  M.newMask = function (type, o) {
    return Object.assign({ id: U.uid('mk'), type: type || 'ellipse', name: '', cx: 50, cy: 50, w: 50, h: 50, rot: 0, pts: [], feather: 20, expand: 0, inv: false, op: 100, fx: null }, o || {});
  };
  M.byId = function (clip, id) { return (clip.masks || []).filter(function (m) { return m.id === id; })[0] || null; };
  // keyframe-resolved copies of a clip's masks at a local frame
  M.eval = function (clip, lf) {
    var out = [];
    (clip.masks || []).forEach(function (m) {
      var e = Object.assign({}, m);
      M.KEYS.forEach(function (k) { var v = KF.value(clip, 'mk.' + m.id + '.' + k, lf); if (v != null) e[k] = v; });
      if (m.type === 'path' && M.pointsAnimated(clip, m.id)) {
        e.pts = (m.pts || []).map(function (p, i) {
          var x = KF.value(clip, 'mk.' + m.id + '.p' + i + 'x', lf), y = KF.value(clip, 'mk.' + m.id + '.p' + i + 'y', lf);
          return [x == null ? p[0] : x, y == null ? p[1] : y];
        });
      }
      out.push(e);
    });
    return out;
  };
  // path points carry per-point keys 'mk.<id>.p<i>x' / 'p<i>y' once "Animate points" is on
  M.pointsAnimated = function (clip, mid) {
    if (!clip.kf) return false;
    var pre = 'mk.' + mid + '.p';
    for (var k in clip.kf) if (k.indexOf(pre) === 0 && clip.kf[k] && clip.kf[k].length) return true;
    return false;
  };
  M.setPointAt = function (clip, mid, i, lf, pt) {
    clip.kf = clip.kf || {};
    ['x', 'y'].forEach(function (ax, j) {
      var path = 'mk.' + mid + '.p' + i + ax;
      if (!clip.kf[path] || !clip.kf[path].length) clip.kf[path] = [{ f: Math.round(lf), v: pt[j], e: 'linear' }];
      else KF.setAt(clip, path, lf, pt[j]);
    });
  };
  // turn point animation on (a key per point at lf) or off (bake the values at lf into the static points)
  M.animatePoints = function (clip, mid, on, lf) {
    var m = M.byId(clip, mid); if (!m) return;
    if (on) (m.pts || []).forEach(function (p, i) { M.setPointAt(clip, mid, i, lf, p); });
    else {
      var ev = M.eval(clip, lf).filter(function (x) { return x.id === mid; })[0];
      if (ev) m.pts = ev.pts.map(function (p) { return [p[0], p[1]]; });
      KF.removeForPrefix(clip, 'mk.' + mid + '.p');
    }
  };
  M.sig = function (masks) { return JSON.stringify(masks.map(function (m) { return [m.type, m.cx, m.cy, m.w, m.h, m.rot, m.pts, m.feather, m.expand, m.inv, m.op, m.smooth ? 1 : 0]; })); };
  // A path mask's points are drawn through a transform driven by the same keyframeable cx/cy (offset from 50/50),
  // w/h (scale, 50 = 100%) and rot (about the points' centroid) as the shapes, so paths can be moved, scaled,
  // rotated and tracked without touching the points. Defaults are the identity, so older projects are unchanged.
  M.pathXform = function (m, sw, sh) {
    var pts = m.pts || [], n = pts.length || 1, cx = 0, cy = 0;
    pts.forEach(function (p) { cx += p[0] / n; cy += p[1] / n; });
    var ox = ((m.cx == null ? 50 : m.cx) - 50) / 100 * sw, oy = ((m.cy == null ? 50 : m.cy) - 50) / 100 * sh;
    var kx = (m.w == null ? 50 : m.w) / 50, ky = (m.h == null ? 50 : m.h) / 50, a = (m.rot || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    var pcx = cx / 100 * sw, pcy = cy / 100 * sh;
    return {
      identity: !ox && !oy && kx === 1 && ky === 1 && !a,
      fwd: function (p) { var dx = (p[0] / 100 * sw - pcx) * kx, dy = (p[1] / 100 * sh - pcy) * ky; return [pcx + ox + dx * ca - dy * sa, pcy + oy + dx * sa + dy * ca]; },
      inv: function (x, y) { var ux = x - pcx - ox, uy = y - pcy - oy; var dx = (ux * ca + uy * sa) / (kx || 1e-6), dy = (-ux * sa + uy * ca) / (ky || 1e-6); return [(pcx + dx) / sw * 100, (pcy + dy) / sh * 100]; },
      centre: [pcx + ox, pcy + oy]
    };
  };
  // closed Catmull-Rom spline through pts (source px) as cubic bezier segments: [[p0, c1, c2, p1], ...]
  M.splineSegs = function (pts) {
    var n = pts.length, segs = [];
    for (var i = 0; i < n; i++) {
      var p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      segs.push([p1, [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6], p2]);
    }
    return segs;
  };
  function tracePath(s, pts, smooth) {
    s.beginPath();
    if (smooth && pts.length >= 3) { var segs = M.splineSegs(pts); s.moveTo(segs[0][0][0], segs[0][0][1]); segs.forEach(function (g) { s.bezierCurveTo(g[1][0], g[1][1], g[2][0], g[2][1], g[3][0], g[3][1]); }); }
    else pts.forEach(function (p, i) { if (i) s.lineTo(p[0], p[1]); else s.moveTo(p[0], p[1]); });
    s.closePath();
  }
  // Rasterise masks into an RGBA canvas of w×h (white where the mask is, in the alpha channel too). Shape units are
  // percent of the source frame (sw×sh), feather/expansion are source pixels; k scales them to the canvas.
  var pool = {}, poolKeys = [], POOL_MAX = 48; // bounded: a long session touches many clips
  M.canvas = function (masks, w, h, sw, sh, key) {
    w = Math.max(2, Math.round(w)); h = Math.max(2, Math.round(h));
    var c;
    if (key) {
      c = pool[key];
      if (!c) { c = pool[key] = document.createElement('canvas'); poolKeys.push(key); while (poolKeys.length > POOL_MAX) { var old = poolKeys.shift(); var oc = pool[old]; delete pool[old]; if (oc) { oc.width = 1; oc.height = 1; } } }
    } else c = document.createElement('canvas');
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    var g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.filter = 'none';
    g.clearRect(0, 0, w, h);
    var k = w / Math.max(1, sw || w);
    masks.forEach(function (m) {
      var op = U.clamp((m.op == null ? 100 : m.op) / 100, 0, 1); if (op <= 0) return;
      var fe = Math.max(0, (m.feather || 0) * k), ex = (m.expand || 0) * k;
      // draw the shape (plus expansion) into a padded scratch layer, blur it, then composite: the padding keeps
      // inverted / edge-touching masks solid at the frame border instead of fading into the (transparent) outside
      var pad = Math.ceil(fe * 3) + 2, pw = w + pad * 2, ph = h + pad * 2;
      var sc = M._scratch || (M._scratch = document.createElement('canvas'));
      if (sc.width !== pw || sc.height !== ph) { sc.width = pw; sc.height = ph; }
      var s = sc.getContext('2d');
      s.setTransform(1, 0, 0, 1, 0, 0); s.globalCompositeOperation = 'source-over'; s.filter = 'none'; s.globalAlpha = 1;
      s.clearRect(0, 0, pw, ph);
      s.translate(pad, pad);
      s.fillStyle = '#fff'; s.strokeStyle = '#fff'; s.lineJoin = 'round'; s.lineCap = 'round';
      var cx = m.cx / 100 * w, cy = m.cy / 100 * h;
      if (m.type === 'path') {
        var xf = M.pathXform(m, w, h), pts = (m.pts || []).map(xf.fwd);
        if (pts.length >= 3) {
          tracePath(s, pts, m.smooth);
          s.fill();
          if (ex > 0) { s.lineWidth = ex * 2; s.stroke(); }
          else if (ex < 0) { s.globalCompositeOperation = 'destination-out'; s.lineWidth = -ex * 2; s.stroke(); s.globalCompositeOperation = 'source-over'; }
        }
      } else {
        var hw = Math.max(0, m.w / 200 * w + ex), hh = Math.max(0, m.h / 200 * h + ex);
        s.save(); s.translate(cx, cy); s.rotate((m.rot || 0) * Math.PI / 180);
        s.beginPath();
        if (m.type === 'rect') s.rect(-hw, -hh, hw * 2, hh * 2); else s.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
        s.fill(); s.restore();
      }
      if (m.inv) { s.globalCompositeOperation = 'source-out'; s.fillRect(-pad, -pad, pw, ph); s.globalCompositeOperation = 'source-over'; }
      g.globalAlpha = op;
      if (fe > 0.3 && 'filter' in g) { g.filter = 'blur(' + fe.toFixed(2) + 'px)'; g.drawImage(sc, -pad, -pad); g.filter = 'none'; }
      else g.drawImage(sc, -pad, -pad);
      g.globalAlpha = 1;
    });
    return c;
  };
  M.releaseKey = function (key) { delete pool[key]; var i = poolKeys.indexOf(key); if (i >= 0) poolKeys.splice(i, 1); };
  // does any mask scope the given effect id?
  M.forFx = function (masks, fxId) { return masks.filter(function (m) { return m.fx === fxId; }); };
  M.forClip = function (masks) { return masks.filter(function (m) { return !m.fx; }); };
  // outline polygon of a mask in source pixels (for the program-monitor overlay)
  M.outline = function (m, sw, sh) {
    if (m.type === 'path') {
      var pts = (m.pts || []).map(M.pathXform(m, sw, sh).fwd);
      if (!m.smooth || pts.length < 3) return pts;
      var out = [];
      M.splineSegs(pts).forEach(function (g) { for (var i = 0; i < 8; i++) { var t = i / 8, u = 1 - t; out.push([u * u * u * g[0][0] + 3 * u * u * t * g[1][0] + 3 * u * t * t * g[2][0] + t * t * t * g[3][0], u * u * u * g[0][1] + 3 * u * u * t * g[1][1] + 3 * u * t * t * g[2][1] + t * t * t * g[3][1]]); } });
      return out;
    }
    var cx = m.cx / 100 * sw, cy = m.cy / 100 * sh, hw = m.w / 200 * sw, hh = m.h / 200 * sh, a = (m.rot || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), out = [];
    var n = m.type === 'rect' ? 4 : 48;
    for (var i = 0; i < n; i++) {
      var px, py;
      if (m.type === 'rect') { px = (i === 1 || i === 2 ? hw : -hw); py = (i >= 2 ? hh : -hh); }
      else { var t = i / n * Math.PI * 2; px = Math.cos(t) * hw; py = Math.sin(t) * hh; }
      out.push([cx + px * ca - py * sa, cy + px * sa + py * ca]);
    }
    return out;
  };
})();
