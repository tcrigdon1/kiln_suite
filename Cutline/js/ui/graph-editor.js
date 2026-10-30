/* Cutline — keyframe Graph Editor: a value-over-time curve for one animated property, under its row in the
   Inspector.  Drag keys (up/down = value, left/right = frame), drag the two handles of a "Custom Curve" segment,
   right-click a key for easing presets.  Pure canvas; reads/writes the same clip.kf data as the keyframe lane. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, P = C.P, KF = C.KF, h = U.h;
  var GE = C.GraphEditor = {};
  var H = 110, PAD = 8;

  // Build the editor for `path` on the clip returned by getClip(); opts = the property row options {min,max,label}
  GE.build = function (path, opts, getClip, getLf) {
    var cv = h('canvas.kf-graph', { height: H, title: 'Graph editor: drag keys to change value/time, drag handles on a Custom Curve segment, right-click a key for easing' });
    var wrap = h('div.kf-graph-wrap', cv);
    var ctx = cv.getContext('2d'), W = 240, dragging = null, hover = null;
    var cssVar = function (n, fb) { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb; } catch (e) { return fb; } };
    function range(c, keys) {
      var vals = keys.map(function (k) { return k.v; }).filter(function (v) { return typeof v === 'number'; });
      var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      if (opts && typeof opts.min === 'number' && typeof opts.max === 'number' && opts.max - opts.min < 1e6 && opts.max > opts.min) { lo = Math.min(lo, opts.min); hi = Math.max(hi, opts.max); }
      if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
      var m = (hi - lo) * 0.08; return [lo - m, hi + m];
    }
    function geom(c, keys) {
      var r = range(c, keys);
      return {
        x: function (f) { return PAD + U.clamp(f / Math.max(1, c.dur - 1), -0.2, 1.2) * (W - 2 * PAD); },
        y: function (v) { return H - PAD - (v - r[0]) / (r[1] - r[0]) * (H - 2 * PAD); },
        f: function (x) { return Math.round((x - PAD) / (W - 2 * PAD) * Math.max(1, c.dur - 1)); },
        v: function (y) { return r[0] + (H - PAD - y) / (H - 2 * PAD) * (r[1] - r[0]); }, r: r
      };
    }
    // handle positions of a bezier segment a→b in canvas space
    function handles(g, a, b) {
      var bz = a.bz && a.bz.length === 4 ? a.bz : KF.BEZIER_DEFAULT;
      var x0 = g.x(a.f), x1 = g.x(b.f), y0 = g.y(a.v), y1 = g.y(b.v);
      return [[x0 + (x1 - x0) * bz[0], y0 + (y1 - y0) * bz[1]], [x0 + (x1 - x0) * bz[2], y0 + (y1 - y0) * bz[3]]];
    }
    function draw() {
      var c = getClip(); if (!c) return;
      var keys = KF.keys(c, path);
      W = Math.max(120, wrap.clientWidth || 240);
      if (cv.width !== W * devicePixelRatio) { cv.width = W * devicePixelRatio; cv.height = H * devicePixelRatio; cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = cssVar('--bg-0', '#15161a'); ctx.fillRect(0, 0, W, H);
      if (!keys || typeof keys[0].v !== 'number') { ctx.fillStyle = cssVar('--text-2', '#888'); ctx.font = '11px system-ui'; ctx.fillText(keys ? 'Not a numeric property' : 'No keyframes', 10, H / 2); return; }
      var g = geom(c, keys);
      // grid: value lines + frame ticks every second
      ctx.strokeStyle = cssVar('--line-soft', '#2a2c33'); ctx.lineWidth = 1;
      for (var i = 0; i <= 4; i++) { var yy = PAD + i * (H - 2 * PAD) / 4; ctx.beginPath(); ctx.moveTo(PAD, yy + 0.5); ctx.lineTo(W - PAD, yy + 0.5); ctx.stroke(); }
      var fps = P.seq().fps;
      for (var f = 0; f < c.dur; f += fps) { var xx = g.x(f); ctx.beginPath(); ctx.moveTo(xx + 0.5, H - PAD); ctx.lineTo(xx + 0.5, H - PAD - 4); ctx.stroke(); }
      // curve
      ctx.strokeStyle = cssVar('--accent', '#f0913a'); ctx.lineWidth = 1.5; ctx.beginPath();
      for (var px = PAD; px <= W - PAD; px++) { var fv = (px - PAD) / (W - 2 * PAD) * Math.max(1, c.dur - 1); var v = KF.evalKeys(keys, fv); var yv = g.y(v); if (px === PAD) ctx.moveTo(px, yv); else ctx.lineTo(px, yv); }
      ctx.stroke();
      // bezier handles
      keys.forEach(function (a, i) {
        var b = keys[i + 1]; if (!b || a.e !== 'bezier') return;
        var hs = handles(g, a, b);
        ctx.strokeStyle = cssVar('--accent-2', '#3dbfae'); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(g.x(a.f), g.y(a.v)); ctx.lineTo(hs[0][0], hs[0][1]); ctx.moveTo(g.x(b.f), g.y(b.v)); ctx.lineTo(hs[1][0], hs[1][1]); ctx.stroke();
        hs.forEach(function (p) { ctx.fillStyle = cssVar('--accent-2', '#3dbfae'); ctx.beginPath(); ctx.arc(p[0], p[1], 3.5, 0, 7); ctx.fill(); });
      });
      // playhead
      var lf = getLf(); ctx.strokeStyle = cssVar('--text-2', '#999'); ctx.beginPath(); ctx.moveTo(g.x(lf) + 0.5, PAD); ctx.lineTo(g.x(lf) + 0.5, H - PAD); ctx.stroke();
      // keys
      keys.forEach(function (k) {
        var x = g.x(k.f), y = g.y(k.v), on = hover && hover.k === k;
        ctx.fillStyle = k.e === 'hold' ? cssVar('--text-1', '#ddd') : cssVar('--accent', '#f0913a');
        ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.fill();
        if (on) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
      });
      // labels
      ctx.fillStyle = cssVar('--text-2', '#999'); ctx.font = '10px system-ui'; ctx.textBaseline = 'top';
      ctx.fillText(fmt(g.r[1]), PAD + 2, PAD); ctx.textBaseline = 'bottom'; ctx.fillText(fmt(g.r[0]), PAD + 2, H - PAD);
      if (hover) { ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillStyle = cssVar('--text-1', '#ddd'); ctx.fillText('f ' + hover.k.f + ' · ' + fmt(hover.k.v) + ' · ' + (KF.EASINGS.filter(function (e) { return e.id === (hover.k.e || 'linear'); })[0] || {}).name, W - PAD, PAD); ctx.textAlign = 'left'; }
    }
    function fmt(v) { return Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100; }
    function hit(e) {
      var c = getClip(); var keys = c && KF.keys(c, path); if (!keys || typeof keys[0].v !== 'number') return null;
      var r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, g = geom(c, keys), best = null, bd = 64;
      keys.forEach(function (a, i) {
        var b = keys[i + 1];
        if (b && a.e === 'bezier') handles(g, a, b).forEach(function (p, hi) { var d = (p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y); if (d < bd) { bd = d; best = { k: a, b: b, handle: hi }; } });
      });
      keys.forEach(function (k) { var d = (g.x(k.f) - x) * (g.x(k.f) - x) + (g.y(k.v) - y) * (g.y(k.v) - y); if (d <= bd) { bd = d; best = { k: k }; } });
      return best;
    }
    cv.addEventListener('pointermove', function (e) { if (dragging) return; var hh = hit(e); if ((hh && hh.k) !== (hover && hover.k) || (hh && hh.handle) !== (hover && hover.handle)) { hover = hh; draw(); } cv.style.cursor = hh ? (hh.handle != null ? 'grab' : 'move') : 'default'; });
    cv.addEventListener('pointerleave', function () { hover = null; draw(); });
    cv.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      var c = getClip(); if (!c) return;
      var hh = hit(e);
      if (!hh) { var keys0 = KF.keys(c, path); if (keys0) { var g0 = geom(c, keys0), r0 = cv.getBoundingClientRect(); C.Engine.seek(c.start + U.clamp(g0.f(e.clientX - r0.left), 0, c.dur - 1)); } return; }
      e.preventDefault(); e.stopPropagation();
      var cid = c.id, f0 = hh.k.f, v0 = hh.k.v, moved = false, kf = f0;
      var r = cv.getBoundingClientRect(), x0 = e.clientX - r.left, y0 = e.clientY - r.top;
      dragging = hh;
      U.drag(e, function (dx, dy) {
        var cc = P.clip(P.seq(), cid); if (!cc) return;
        var ks = KF.keys(cc, path); if (!ks) return;
        var g = geom(cc, ks);
        var k = ks.filter(function (q) { return q.f === kf; })[0]; if (!k) return;
        if (hh.handle != null) {
          var b = ks[ks.indexOf(k) + 1]; if (!b) return;
          var ax = g.x(k.f), bx = g.x(b.f), ay = g.y(k.v), by = g.y(b.v);
          var hx = U.clamp((x0 + dx - ax) / ((bx - ax) || 1), 0, 1), hy = (y0 + dy - ay) / ((by - ay) || 1);
          var bz = (k.bz && k.bz.slice()) || KF.BEZIER_DEFAULT.slice();
          bz[hh.handle * 2] = Math.round(hx * 1000) / 1000; bz[hh.handle * 2 + 1] = Math.round(U.clamp(hy, -1, 2) * 1000) / 1000; k.bz = bz;
        } else {
          var nf = U.clamp(g.f(x0 + dx), 0, cc.dur - 1), nv = g.v(y0 + dy);
          if (opts && typeof opts.min === 'number') nv = Math.max(opts.min, nv);
          if (opts && typeof opts.max === 'number') nv = Math.min(opts.max, nv);
          if (opts && opts.step) nv = Math.round(nv / opts.step) * opts.step;
          if (e.shiftKey) nv = v0; // shift: time only
          if (ks.some(function (q) { return q !== k && q.f === nf; })) nf = k.f;
          k.f = nf; k.v = Math.round(nv * 10000) / 10000; kf = nf; KF.sort(ks);
          if (path === 'tm.speed' && C.T.hasRamp(cc)) C.T.fitRampDur(P.seq(), cc, C.T.srcSpan(P.seq(), cc, cc.dur));
        }
        moved = true; C.live(); draw();
      }, function () { dragging = null; if (moved) C.commit(hh.handle != null ? 'Curve Handle' : 'Move Keyframe'); draw(); });
    });
    cv.addEventListener('contextmenu', function (e) {
      e.preventDefault(); e.stopPropagation();
      var c = getClip(); var hh = hit(e); if (!c || !hh) return;
      var k = hh.k, items = KF.EASINGS.map(function (es) {
        return { label: es.name, checked: (k.e || 'linear') === es.id, action: function () { C.edit('Keyframe Easing', function (s2) { var cc = P.clip(s2, c.id); var kk = (KF.keys(cc, path) || []).filter(function (x) { return x.f === k.f; })[0]; if (kk) { kk.e = es.id; if (es.id === 'bezier' && !kk.bz) kk.bz = KF.BEZIER_DEFAULT.slice(); } }); draw(); } };
      });
      items.push('-', { label: 'Apply this easing to all keys', action: function () { C.edit('Keyframe Easing', function (s2) { var cc = P.clip(s2, c.id); (KF.keys(cc, path) || []).forEach(function (kk) { kk.e = k.e; if (k.bz) kk.bz = k.bz.slice(); }); }); draw(); } });
      items.push({ label: 'Delete Keyframe', action: function () { C.edit('Delete Keyframe', function (s2) { KF.removeKeyAt(P.clip(s2, c.id), path, k.f); }); draw(); } });
      C.ui.menu(items, e.clientX, e.clientY);
    });
    var ro = window.ResizeObserver ? new ResizeObserver(function () { draw(); }) : null; if (ro) ro.observe(wrap);
    return { el: wrap, draw: draw, destroy: function () { if (ro) ro.disconnect(); } };
  };
})();
