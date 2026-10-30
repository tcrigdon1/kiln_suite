/* Cutline — draggable frequency-response graph for the 3-band EQ (Inspector). Low / high shelf points move up and
   down (gain); the mid point moves in both axes (gain and centre frequency). The curve is the response of the three
   biquads the effect builds, so what you see is what plays. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, h = U.h, P = C.P;
  var FMIN = 20, FMAX = 20000, GMAX = 24;
  function fx2x(f, w) { return Math.log(f / FMIN) / Math.log(FMAX / FMIN) * w; }
  function x2f(x, w) { return FMIN * Math.pow(FMAX / FMIN, U.clamp(x / w, 0, 1)); }
  function g2y(g, hh) { return hh / 2 - g / GMAX * (hh / 2 - 6); }
  function y2g(y, hh) { return U.clamp((hh / 2 - y) / (hh / 2 - 6) * GMAX, -GMAX, GMAX); }
  // magnitude response (dB) of a biquad from RBJ cookbook coefficients at frequency f
  function shelfCoef(type, f0, gainDb, fs) {
    var A = Math.pow(10, gainDb / 40), w0 = 2 * Math.PI * f0 / fs, cw = Math.cos(w0), sw = Math.sin(w0), S = 1, alpha = sw / 2 * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2), sq = 2 * Math.sqrt(A) * alpha;
    if (type === 'low') return [A * ((A + 1) - (A - 1) * cw + sq), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - sq), (A + 1) + (A - 1) * cw + sq, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - sq];
    return [A * ((A + 1) + (A - 1) * cw + sq), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - sq), (A + 1) - (A - 1) * cw + sq, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - sq];
  }
  function peakCoef(f0, gainDb, Q, fs) {
    var A = Math.pow(10, gainDb / 40), w0 = 2 * Math.PI * f0 / fs, cw = Math.cos(w0), alpha = Math.sin(w0) / (2 * Q);
    return [1 + alpha * A, -2 * cw, 1 - alpha * A, 1 + alpha / A, -2 * cw, 1 - alpha / A];
  }
  function magDb(c, f, fs) {
    var w = 2 * Math.PI * f / fs, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    var nr = c[0] + c[1] * c1 + c[2] * c2, ni = -(c[1] * s1 + c[2] * s2), dr = c[3] + c[4] * c1 + c[5] * c2, di = -(c[4] * s1 + c[5] * s2);
    return 10 * Math.log10((nr * nr + ni * ni) / Math.max(1e-12, dr * dr + di * di));
  }
  C.EQGraph = { response: function (p, f, fs) { fs = fs || 48000; return magDb(shelfCoef('low', 200, p.low, fs), f, fs) + magDb(peakCoef(p.midf, p.mid, 0.9, fs), f, fs) + magDb(shelfCoef('high', 5000, p.high, fs), f, fs); } };

  C.FX.byId.a_eq.ui = function (clip, fx, X) {
    var cv = h('canvas.eq-graph'), wrap = h('div.eq-wrap', cv), cid = clip.id, fid = fx.id, drag = null;
    function params() { var c = X.clip(); var e = c && (c.fx || []).filter(function (f) { return f.id === fid; })[0]; return e ? e.p : null; }
    function draw() {
      var p = params(); if (!p || !cv.isConnected) return;
      var dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 260, hh = 110;
      if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
      var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hh);
      g.fillStyle = '#15110e'; g.fillRect(0, 0, w, hh);
      g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1; g.font = '9px var(--mono, monospace)'; g.fillStyle = 'rgba(255,255,255,.35)';
      [50, 100, 200, 500, 1000, 2000, 5000, 10000].forEach(function (f) { var x = Math.round(fx2x(f, w)) + 0.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, hh); g.stroke(); g.fillText(f >= 1000 ? (f / 1000) + 'k' : f + '', x + 2, hh - 3); });
      [-12, 0, 12].forEach(function (d) { var y = Math.round(g2y(d, hh)) + 0.5; g.strokeStyle = d === 0 ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.07)'; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); if (d) g.fillText((d > 0 ? '+' : '') + d, 2, y - 2); });
      // response curve + fill
      g.beginPath();
      for (var x = 0; x <= w; x += 2) { var y = g2y(C.EQGraph.response(p, x2f(x, w)), hh); if (x) g.lineTo(x, y); else g.moveTo(x, y); }
      g.strokeStyle = '#f0a04a'; g.lineWidth = 1.6; g.stroke();
      g.lineTo(w, g2y(0, hh)); g.lineTo(0, g2y(0, hh)); g.closePath(); g.fillStyle = 'rgba(240,160,74,.14)'; g.fill();
      // handles
      pts(p, w, hh).forEach(function (pt) { g.beginPath(); g.arc(pt.x, pt.y, 5, 0, Math.PI * 2); g.fillStyle = drag && drag.k === pt.k ? '#ffd9a8' : '#1c1916'; g.fill(); g.strokeStyle = '#f0a04a'; g.lineWidth = 1.5; g.stroke(); });
    }
    function pts(p, w, hh) { return [{ k: 'low', x: fx2x(200, w), y: g2y(p.low, hh) }, { k: 'mid', x: fx2x(p.midf, w), y: g2y(p.mid, hh) }, { k: 'high', x: fx2x(5000, w), y: g2y(p.high, hh) }]; }
    cv.addEventListener('pointerdown', function (e) {
      var p = params(); if (!p) return;
      var r = cv.getBoundingClientRect(), w = r.width, hh = r.height, mx = e.clientX - r.left, my = e.clientY - r.top, best = null, bd = 14;
      pts(p, w, hh).forEach(function (pt) { var d = Math.hypot(pt.x - mx, pt.y - my); if (d < bd) { bd = d; best = pt; } });
      if (!best) return;
      e.preventDefault(); e.stopPropagation();
      drag = { k: best.k }; var g0 = p[best.k], f0 = p.midf, moved = false;
      U.drag(e, function (dx, dy) {
        var c = P.clip(P.seq(), cid), ef = c && (c.fx || []).filter(function (f) { return f.id === fid; })[0]; if (!ef) return;
        moved = true;
        ef.p[drag.k] = Math.round(U.clamp(g0 - dy / (hh / 2 - 6) * GMAX, -24, 24) * 2) / 2;
        if (drag.k === 'mid') ef.p.midf = Math.round(U.clamp(x2f(fx2x(f0, w) + dx, w), 200, 8000) / 10) * 10;
        C.live(); draw(); C.bus.emit('inspector:refresh');
      }, function () { drag = null; if (moved) C.commit('EQ'); else draw(); });
    });
    cv.addEventListener('dblclick', function (e) { // reset the nearest band
      var p = params(); if (!p) return;
      var r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, best = null, bd = 14;
      pts(p, r.width, r.height).forEach(function (pt) { var d = Math.hypot(pt.x - mx, pt.y - my); if (d < bd) { bd = d; best = pt; } });
      if (!best) return;
      C.edit('Reset EQ Band', function (s2) { var c = P.clip(s2, cid), ef = c && (c.fx || []).filter(function (f) { return f.id === fid; })[0]; if (ef) { ef.p[best.k] = 0; if (best.k === 'mid') ef.p.midf = 1200; } });
    });
    cv.title = 'Drag the points: low / high shelves up and down, the mid band in both directions · double-click a point to reset it';
    // redraw on value changes; drop the listener once the Inspector has rebuilt without this canvas
    var onRefresh = function () { if (!cv.isConnected && wrap.__seen) { C.bus.off('inspector:refresh', onRefresh); return; } if (cv.isConnected) wrap.__seen = true; draw(); };
    C.bus.on('inspector:refresh', onRefresh);
    requestAnimationFrame(draw); setTimeout(draw, 50);
    wrap.redraw = draw;
    return wrap;
  };
})();
