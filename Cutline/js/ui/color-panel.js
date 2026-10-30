/* Cutline — Color panel: grading controls (basic, creative, wheels, curves, vignette) and live scopes. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, h = U.h, P = C.P, KF = C.KF;
  var CP = C.ColorPanel = { bound: [], scope: U.lsGet('scope', 'waveform'), curveCh: 'm', sig: null };
  CP.clip = function () { var s = P.seq(); var c = s && CP.clipId ? P.clip(s, CP.clipId) : null; return c && c.kind === 'video' ? c : null; };
  CP.lf = function () { var c = CP.clip(); return c ? U.clamp(C.Engine.frame - c.start, 0, c.dur - 1) : 0; };

  CP.init = function (pane) {
    CP.pane = pane;
    var sel = h('select');
    [['waveform', 'Waveform (Luma)'], ['parade', 'RGB Parade'], ['vector', 'Vectorscope'], ['histogram', 'Histogram'], ['false', 'False Color (exposure)']].forEach(function (o) { sel.appendChild(h('option', { value: o[0] }, o[1])); });
    sel.value = CP.scope;
    sel.addEventListener('change', function () { CP.scope = sel.value; U.lsSet('scope', CP.scope); CP.drawScope(); });
    CP.scopeCv = h('canvas');
    CP.scopeBox = h('div.scopes', h('div.scope-bar', h('span', { style: { fontSize: '10px', color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '.6px', fontWeight: 600 } }, 'Scopes'), h('span.spacer', { style: { flex: 1 } }), sel), CP.scopeCv);
    CP.scroll = h('div.insp-scroll');
    pane.appendChild(CP.scopeBox); pane.appendChild(CP.scroll);
    C.bus.on('scopes', function (d) { CP.last = d; CP.drawScope(); });
    C.bus.on('selection', function () { CP.sig = null; CP.refreshSoon(); });
    C.bus.on('changed', function () { CP.refreshSoon(); });
    C.bus.on('playhead', U.throttle(function () { CP.updateValues(); }, 60));
    CP.refreshSoon = U.raf(CP.refresh);
    CP.refresh();
  };
  CP.extra = []; // other modules append section builders: function (clip, col, ctx, kfFieldFn)
  CP.setVisible = function (v) { CP.visible = v; C.Engine.scopesWanted = v; if (v) { C.Engine.requestRender(); CP.refresh(); } };

  CP.refresh = function () {
    var c = P.primaryClip();
    // a missing grade and a default grade must give the same signature: the first wheel/curve drag creates c.col,
    // and rebuilding the panel mid-drag would leave the drag writing through a detached canvas
    var cs = c && c.col ? c.col : { look: 'none', on: true };
    var sig = c ? c.id + '|' + c.kind + '|' + Object.keys(c.kf || {}).filter(function (k) { return k.indexOf('col.') === 0; }).sort().join(',') + '|' + (cs.look || 'none') + (cs.on !== false) + '|' + (cs.lut || '') + '|' + (C.LUT ? C.LUT.list().length : 0) : 'none';
    if (sig === CP.sig) { CP.updateValues(); return; }
    CP.sig = sig;
    var st = CP.scroll.scrollTop;
    U.clear(CP.scroll); CP.bound = [];
    if (!c || c.kind !== 'video') {
      CP.clipId = null;
      CP.scroll.appendChild(h('div.insp-empty', { html: C.icon('color') }, h('div', 'Select a video clip to grade it.'), h('div', { style: { marginTop: '8px', fontSize: '11px' } }, 'Tip: grade an Adjustment Clip to affect everything beneath it.')));
      return;
    }
    CP.clipId = c.id;
    var col = c.col || P.defaultColor();
    var head = h('div.insp-title', h('div.sw', { style: { background: 'linear-gradient(#e5534b,#67c26f,#5aa9e6)' } }), h('div.nm', c.name),
      C.ui.checkField('On', col.on !== false, function (v) { C.edit(v ? 'Enable Grade' : 'Bypass Grade', function (s2) { var cc = P.clip(s2, c.id); cc.col = cc.col || P.defaultColor(); cc.col.on = v; }); }),
      C.ui.iconBtn('undo', 'Reset all grading', function () { C.edit('Reset Grade', function (s2) { var cc = P.clip(s2, c.id); cc.col = null; Object.keys(cc.kf || {}).forEach(function (k) { if (k.indexOf('col.') === 0) delete cc.kf[k]; }); }); CP.sig = null; }, { cls: 'sm', tipPos: 'bottom' }));
    CP.scroll.appendChild(head);
    var ctx = { clip: CP.clip, lf: CP.lf, bound: CP.bound };
    function f(k, label, min, max, step, def, unit) {
      return C.Inspector.kfField('col.' + k, { label: label, min: min, max: max, step: step, def: def, unit: unit, ctx: ctx });
    }
    var basic = C.ui.section('Basic Correction', { key: 'col-basic' });
    basic.body.appendChild(sub('White Balance'));
    basic.body.appendChild(f('temp', 'Temperature', -100, 100, 1, 0));
    basic.body.appendChild(f('tint', 'Tint', -100, 100, 1, 0));
    basic.body.appendChild(sub('Tone'));
    basic.body.appendChild(f('exposure', 'Exposure', -4, 4, 0.01, 0));
    basic.body.appendChild(f('contrast', 'Contrast', -100, 100, 1, 0));
    basic.body.appendChild(f('highlights', 'Highlights', -100, 100, 1, 0));
    basic.body.appendChild(f('shadows', 'Shadows', -100, 100, 1, 0));
    basic.body.appendChild(f('whites', 'Whites', -100, 100, 1, 0));
    basic.body.appendChild(f('blacks', 'Blacks', -100, 100, 1, 0));
    basic.body.appendChild(sub('Color'));
    basic.body.appendChild(f('sat', 'Saturation', 0, 200, 1, 100));
    basic.body.appendChild(f('vib', 'Vibrance', -100, 100, 1, 0));
    basic.body.appendChild(h('div.row', { style: { marginTop: '6px', gap: '6px' } }, h('button.btn.sm', { on: { click: CP.autoBalance } }, 'Auto Tone'),
      h('button.btn.sm', { title: 'Auto white balance: click something that should be neutral grey or white in the Program monitor', on: { click: function () { if (CP.pickNeutral) CP.pickNeutral(); } } }, 'Pick Neutral…')));
    CP.scroll.appendChild(basic);

    var cr = C.ui.section('Creative', { key: 'col-creative' });
    var lookSel = C.ui.selectField('Look', C.FX.LOOKS, col.look || 'none', function (v) { C.edit('Look', function (s2) { var cc = P.clip(s2, c.id); cc.col = cc.col || P.defaultColor(); cc.col.look = v; }); });
    cr.body.appendChild(lookSel);
    cr.body.appendChild(f('lookAmt', 'Intensity', 0, 100, 1, 100, '%'));
    cr.body.appendChild(f('fade', 'Faded Film', 0, 100, 1, 0));
    cr.body.appendChild(f('sharpen', 'Sharpen', 0, 100, 1, 0));
    CP.scroll.appendChild(cr);

    var wh = C.ui.section('Color Wheels', { key: 'col-wheels' });
    var wheels = h('div.wheels');
    [['sh', 'Shadows'], ['mid', 'Midtones'], ['hi', 'Highlights']].forEach(function (w) { wheels.appendChild(makeWheel(w[0], w[1])); });
    wh.body.appendChild(wheels);
    CP.scroll.appendChild(wh);

    var cu = C.ui.section('Curves', { key: 'col-curves' });
    cu.body.appendChild(makeCurves());
    CP.scroll.appendChild(cu);

    var vg = C.ui.section('Vignette', { key: 'col-vig' });
    vg.body.appendChild(f('vig', 'Amount', -100, 100, 1, 0));
    vg.body.appendChild(f('vigMid', 'Midpoint', 0, 100, 1, 50));
    vg.body.appendChild(f('vigRound', 'Roundness', 0, 100, 1, 50));
    vg.body.appendChild(f('vigFeather', 'Feather', 0, 100, 1, 50));
    CP.scroll.appendChild(vg);
    (CP.extra || []).forEach(function (fn) { try { fn(c, col, ctx, f); } catch (e) { console.warn('[Cutline] color panel section failed', e); } });
    CP.scroll.scrollTop = st;
    CP.updateValues();
  };
  function sub(t) { return h('div', { style: { fontSize: '10px', color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '.6px', margin: '8px 0 2px' } }, t); }
  CP.updateValues = function () { var c = CP.clip(); if (!c) return; var lf = CP.lf(); CP.bound.forEach(function (b) { try { b(c, lf); } catch (e) { } }); };

  CP.autoBalance = function () {
    var d = CP.last, c = CP.clip(); if (!d || !c) { C.toast('Play or scrub to update the scopes first'); return; }
    var px = d.data, n = px.length / 4, lums = new Float32Array(n), sr = 0, sg = 0, sb = 0;
    for (var i = 0; i < n; i++) { var r = px[i * 4] / 255, g = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255; lums[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b; sr += r; sg += g; sb += b; }
    var sorted = Array.prototype.slice.call(lums).sort(function (a, b) { return a - b; });
    var lo = sorted[Math.floor(n * 0.01)], hi = sorted[Math.floor(n * 0.99)], mean = sorted[Math.floor(n / 2)];
    C.edit('Auto Tone', function (s2) {
      var cc = P.clip(s2, c.id); cc.col = cc.col || P.defaultColor();
      cc.col.blacks = U.clamp(Math.round(lo * 100 / 0.08 * 0.5), -100, 100);
      cc.col.whites = U.clamp(Math.round((1 - hi) * 100 / 0.12 * 0.8), -100, 100);
      cc.col.exposure = U.clamp(Math.round(Math.log2(0.45 / Math.max(0.05, mean)) * 50) / 100, -2, 2);
      var avg = (sr + sg + sb) / 3;
      cc.col.temp = U.clamp(Math.round((sb - sr) / Math.max(1e-3, avg) * 80), -60, 60);
    });
  };

  /* ---------- wheels ---------- */
  var wheelImg = null;
  function wheelImage(S) {
    if (wheelImg && wheelImg.width === S) return wheelImg;
    var c = document.createElement('canvas'); c.width = S; c.height = S;
    var g = c.getContext('2d'), id = g.createImageData(S, S), R = S / 2 - 2;
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
      var dx = x - S / 2, dy = S / 2 - y, d = Math.hypot(dx, dy), i = (y * S + x) * 4;
      if (d > R) { id.data[i + 3] = 0; continue; }
      var off = C.Color.wheelOffset(dx / R * 100, dy / R * 100);
      var base = 0.22, k = 1.4;
      id.data[i] = U.clamp(base + off[0] * k, 0, 1) * 255; id.data[i + 1] = U.clamp(base + off[1] * k, 0, 1) * 255; id.data[i + 2] = U.clamp(base + off[2] * k, 0, 1) * 255;
      id.data[i + 3] = d > R - 1 ? 255 * (R - d + 1) : 255;
    }
    g.putImageData(id, 0, 0);
    wheelImg = c; return c;
  }
  function makeWheel(key, label) {
    var S = 192, cv = h('canvas'); cv.width = S; cv.height = S;
    var lum = h('input', { type: 'range', min: -100, max: 100, step: 1, title: label + ' luminance' });
    var wrap = h('div.wheel', h('div.wlabel', label), cv, lum);
    function draw(c) {
      var g = cv.getContext('2d'); g.clearRect(0, 0, S, S);
      g.drawImage(wheelImage(S), 0, 0);
      var R = S / 2 - 2;
      g.strokeStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.moveTo(S / 2, 8); g.lineTo(S / 2, S - 8); g.moveTo(8, S / 2); g.lineTo(S - 8, S / 2); g.stroke();
      g.beginPath(); g.arc(S / 2, S / 2, R, 0, Math.PI * 2); g.strokeStyle = '#3b342e'; g.lineWidth = 2; g.stroke();
      var x = c ? KF.value(c, 'col.' + key + 'X', CP.lf()) || 0 : 0, y = c ? KF.value(c, 'col.' + key + 'Y', CP.lf()) || 0 : 0;
      var px = S / 2 + x / 100 * R, py = S / 2 - y / 100 * R;
      g.beginPath(); g.arc(px, py, 9, 0, Math.PI * 2); g.fillStyle = 'rgba(20,18,16,.6)'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#f2ebe3'; g.stroke();
      g.beginPath(); g.arc(px, py, 3, 0, Math.PI * 2); g.fillStyle = '#ffad62'; g.fill();
    }
    CP.bound.push(function (c, lf) { draw(c); lum.value = KF.value(c, 'col.' + key + 'L', lf) || 0; });
    function setXY(e, commit) {
      var r = cv.getBoundingClientRect(), R = r.width / 2 - 2 * r.width / S;
      if (!(R > 0)) return; // detached canvas
      var dx = (e.clientX - r.left - r.width / 2) / R, dy = -(e.clientY - r.top - r.height / 2) / R;
      var d = Math.hypot(dx, dy); if (d > 1) { dx /= d; dy /= d; }
      var k = e.shiftKey ? 0.3 : 1;
      var c = CP.clip(); if (!c) return;
      KF.setAt(c, 'col.' + key + 'X', CP.lf(), Math.round(dx * 100 * k)); KF.setAt(c, 'col.' + key + 'Y', CP.lf(), Math.round(dy * 100 * k));
      C.live(); draw(c);
    }
    cv.addEventListener('pointerdown', function (e) {
      e.preventDefault(); setXY(e);
      U.drag(e, function (dx, dy, ev) { setXY(ev); }, function () { C.commit(label + ' Wheel'); });
    });
    cv.addEventListener('dblclick', function () { C.edit('Reset ' + label, function (s2) { var c = P.clip(s2, CP.clipId); KF.setAt(c, 'col.' + key + 'X', CP.lf(), 0); KF.setAt(c, 'col.' + key + 'Y', CP.lf(), 0); }); });
    lum.addEventListener('input', function () { var c = CP.clip(); if (!c) return; KF.setAt(c, 'col.' + key + 'L', CP.lf(), +lum.value); C.live(); });
    lum.addEventListener('change', function () { C.commit(label + ' Luminance'); });
    lum.addEventListener('dblclick', function () { var c = CP.clip(); if (!c) return; KF.setAt(c, 'col.' + key + 'L', CP.lf(), 0); lum.value = 0; C.commit(label + ' Luminance'); });
    setTimeout(function () { draw(CP.clip()); }, 0);
    return wrap;
  }

  /* ---------- curves ---------- */
  function makeCurves() {
    var cv = h('canvas'), tabs = h('div.curve-tabs');
    [['m', 'LUMA'], ['r', 'R'], ['g', 'G'], ['b', 'B']].forEach(function (t) {
      var b = h('button' + (CP.curveCh === t[0] ? '.on' : ''), { 'data-ch': t[0] }, t[1]);
      b.addEventListener('click', function () { CP.curveCh = t[0]; U.$$('button', tabs).forEach(function (x) { x.classList.toggle('on', x === b); }); draw(); });
      tabs.appendChild(b);
    });
    var wrap = h('div.curves-wrap', tabs, cv, h('div.muted', { style: { fontSize: '10px', marginTop: '4px' } }, 'Click to add a point · drag to shape · double-click a point to remove'),
      h('button.btn.sm', { style: { marginTop: '4px' }, on: { click: function () { C.edit('Reset Curve', function (s2) { var c = P.clip(s2, CP.clipId); c.col = c.col || P.defaultColor(); c.col.curves[CP.curveCh] = [[0, 0], [1, 1]]; }); draw(); } } }, 'Reset Channel'));
    var COLS = { m: '#f2ebe3', r: '#ff6a5c', g: '#5fd16a', b: '#69a8ff' };
    function curves() { var c = CP.clip(); return (c && c.col && c.col.curves) || P.defaultColor().curves; }
    function draw() {
      var dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 280, H = cv.clientHeight || 200;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#0d0c0b'; g.fillRect(0, 0, W, H);
      g.strokeStyle = '#25211d'; g.lineWidth = 1; g.beginPath();
      for (var i = 1; i < 4; i++) { g.moveTo(W * i / 4 + .5, 0); g.lineTo(W * i / 4 + .5, H); g.moveTo(0, H * i / 4 + .5); g.lineTo(W, H * i / 4 + .5); }
      g.stroke();
      g.strokeStyle = '#3a332d'; g.beginPath(); g.moveTo(0, H); g.lineTo(W, 0); g.stroke();
      var cvs = curves();
      ['m', 'r', 'g', 'b'].forEach(function (ch) {
        if (ch === CP.curveCh) return;
        var pts = cvs[ch]; if (pts.length === 2 && pts[0][1] === 0 && pts[1][1] === 1) return;
        plot(g, cvs[ch], W, H, U.rgba(COLS[ch], 0.35), 1);
      });
      plot(g, cvs[CP.curveCh], W, H, COLS[CP.curveCh], 2);
      cvs[CP.curveCh].forEach(function (p) { g.beginPath(); g.arc(p[0] * W, (1 - p[1]) * H, 4.5, 0, Math.PI * 2); g.fillStyle = '#141210'; g.fill(); g.strokeStyle = COLS[CP.curveCh]; g.lineWidth = 2; g.stroke(); });
    }
    function plot(g, pts, W, H, col, lw) {
      var fn = C.Color.curveFn(pts); g.strokeStyle = col; g.lineWidth = lw; g.beginPath();
      for (var x = 0; x <= W; x += 2) { var y = U.clamp(fn(x / W), 0, 1); if (!x) g.moveTo(x, (1 - y) * H); else g.lineTo(x, (1 - y) * H); }
      g.stroke();
    }
    function pos(e) { var r = cv.getBoundingClientRect(); if (!r.width || !r.height) return null; return [U.clamp((e.clientX - r.left) / r.width, 0, 1), U.clamp(1 - (e.clientY - r.top) / r.height, 0, 1)]; }
    cv.addEventListener('pointerdown', function (e) {
      var c = CP.clip(); if (!c) return;
      e.preventDefault();
      if (!c.col) c.col = P.defaultColor();
      var pts = c.col.curves[CP.curveCh], p = pos(e), r = cv.getBoundingClientRect(); if (!p) return;
      var idx = -1, bd = 10;
      pts.forEach(function (q, i) { var d = Math.hypot((q[0] - p[0]) * r.width, (q[1] - p[1]) * r.height); if (d < bd) { bd = d; idx = i; } });
      if (idx < 0) { pts.push([p[0], p[1]]); pts.sort(function (a, b) { return a[0] - b[0]; }); idx = pts.findIndex(function (q) { return q[0] === p[0] && q[1] === p[1]; }); }
      var ch = CP.curveCh, cid = c.id;
      C.live(); draw();
      U.drag(e, function (dx, dy, ev) {
        var cc = P.clip(P.seq(), cid); if (!cc || !cc.col) return;
        var ps = cc.col.curves[ch], q = pos(ev); if (!q) return;
        var lo = idx > 0 ? ps[idx - 1][0] + 0.01 : 0, hi = idx < ps.length - 1 ? ps[idx + 1][0] - 0.01 : 1;
        if (idx === 0) q[0] = 0; else if (idx === ps.length - 1) q[0] = 1; else q[0] = U.clamp(q[0], lo, hi);
        ps[idx] = [U.round(q[0], 4), U.round(q[1], 4)];
        C.live(); draw();
      }, function () { C.commit('Curves'); });
    });
    cv.addEventListener('dblclick', function (e) {
      var c = CP.clip(); if (!c || !c.col) return;
      var p = pos(e), r = cv.getBoundingClientRect(), pts = c.col.curves[CP.curveCh]; if (!p) return;
      var idx = pts.findIndex(function (q, i) { return i > 0 && i < pts.length - 1 && Math.hypot((q[0] - p[0]) * r.width, (q[1] - p[1]) * r.height) < 10; });
      if (idx > 0) { C.edit('Remove Curve Point', function (s2) { P.clip(s2, c.id).col.curves[CP.curveCh].splice(idx, 1); }); draw(); }
    });
    CP.bound.push(function () { draw(); });
    setTimeout(draw, 0);
    return wrap;
  }

  /* ---------- scopes ---------- */
  CP.drawScope = function () {
    if (!CP.visible) return;
    var cv = CP.scopeCv, dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 300, H = cv.clientHeight || 150;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    var g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0);
    var CW = cv.width, CH = cv.height;
    g.fillStyle = '#0a0908'; g.fillRect(0, 0, CW, CH);
    var d = CP.last; if (!d) return;
    if (CP.scope === 'false' && CP.drawFalse) { CP.drawFalse(g, d, CW, CH, dpr); return; }
    var px = d.data, w = d.w, hh = d.h, n = w * hh;
    var img = g.createImageData(CW, CH), o = img.data;
    function add(x, y, r, gg, b) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= CW || y >= CH) return; var i = (y * CW + x) * 4; o[i] = Math.min(255, o[i] + r); o[i + 1] = Math.min(255, o[i + 1] + gg); o[i + 2] = Math.min(255, o[i + 2] + b); o[i + 3] = 255; }
    for (var i = 0; i < o.length; i += 4) { o[i] = 10; o[i + 1] = 9; o[i + 2] = 8; o[i + 3] = 255; }
    var k = Math.max(6, Math.round(2400 / hh * CH / 150));
    if (CP.scope === 'waveform' || CP.scope === 'parade') {
      var parade = CP.scope === 'parade';
      for (var y = 0; y < hh; y++) for (var x = 0; x < w; x++) {
        var j = (y * w + x) * 4, r = px[j], gg = px[j + 1], b = px[j + 2];
        if (!parade) { var l = 0.2126 * r + 0.7152 * gg + 0.0722 * b; add(x / w * CW, (1 - l / 255) * (CH - 8) + 4, k * 0.55, k, k * 0.75); }
        else {
          var sw = CW / 3;
          add(x / w * sw, (1 - r / 255) * (CH - 8) + 4, k, k * 0.25, k * 0.2);
          add(sw + x / w * sw, (1 - gg / 255) * (CH - 8) + 4, k * 0.25, k, k * 0.3);
          add(2 * sw + x / w * sw, (1 - b / 255) * (CH - 8) + 4, k * 0.3, k * 0.45, k);
        }
      }
    } else if (CP.scope === 'vector') {
      var cx = CW / 2, cy = CH / 2, R = Math.min(CW, CH) / 2 - 6;
      for (var q = 0; q < n; q++) {
        var jj = q * 4, rr = px[jj] / 255, g2 = px[jj + 1] / 255, bb = px[jj + 2] / 255;
        var cb = -0.1146 * rr - 0.3854 * g2 + 0.5 * bb, cr = 0.5 * rr - 0.4542 * g2 - 0.0458 * bb;
        add(cx + cb * 2 * R, cy - cr * 2 * R, k * 0.9, k, k * 0.8);
      }
    } else {
      var hr = new Uint32Array(256), hg = new Uint32Array(256), hb = new Uint32Array(256), max = 1;
      for (var z = 0; z < n; z++) { hr[px[z * 4]]++; hg[px[z * 4 + 1]]++; hb[px[z * 4 + 2]]++; }
      for (var t = 1; t < 255; t++) max = Math.max(max, hr[t], hg[t], hb[t]);
      g.putImageData(img, 0, 0);
      g.globalCompositeOperation = 'lighter';
      [[hr, 'rgba(229,83,75,.55)'], [hg, 'rgba(103,194,111,.55)'], [hb, 'rgba(90,169,230,.55)']].forEach(function (a) {
        g.fillStyle = a[1]; g.beginPath(); g.moveTo(0, CH);
        for (var v = 0; v < 256; v++) g.lineTo(v / 255 * CW, CH - Math.min(1, a[0][v] / max) * (CH - 6));
        g.lineTo(CW, CH); g.closePath(); g.fill();
      });
      g.globalCompositeOperation = 'source-over';
      return;
    }
    g.putImageData(img, 0, 0);
    // graticule
    g.strokeStyle = 'rgba(240,145,58,.25)'; g.fillStyle = 'rgba(200,189,177,.6)'; g.lineWidth = 1; g.font = (9 * dpr) + 'px sans-serif';
    if (CP.scope === 'vector') {
      var cx2 = CW / 2, cy2 = CH / 2, R2 = Math.min(CW, CH) / 2 - 6;
      g.beginPath(); g.arc(cx2, cy2, R2, 0, Math.PI * 2); g.moveTo(cx2 - R2, cy2); g.lineTo(cx2 + R2, cy2); g.moveTo(cx2, cy2 - R2); g.lineTo(cx2, cy2 + R2); g.stroke();
      [['R', [1, 0, 0]], ['Mg', [1, 0, 1]], ['B', [0, 0, 1]], ['Cy', [0, 1, 1]], ['G', [0, 1, 0]], ['Yl', [1, 1, 0]]].forEach(function (t2) {
        var c = t2[1].map(function (v) { return v * 0.75; });
        var cb2 = -0.1146 * c[0] - 0.3854 * c[1] + 0.5 * c[2], cr2 = 0.5 * c[0] - 0.4542 * c[1] - 0.0458 * c[2];
        var X = cx2 + cb2 * 2 * R2, Y = cy2 - cr2 * 2 * R2;
        g.strokeRect(X - 4 * dpr, Y - 4 * dpr, 8 * dpr, 8 * dpr); g.fillText(t2[0], X + 6 * dpr, Y - 4 * dpr);
      });
      // skin tone line (~123°)
      g.strokeStyle = 'rgba(240,160,74,.45)'; g.beginPath(); g.moveTo(cx2, cy2); var a = -123 * Math.PI / 180 + Math.PI / 2; g.lineTo(cx2 + Math.cos(Math.PI - 0.58) * R2 * -1 * -1, cy2 - Math.sin(2.15) * R2); g.stroke(); void a;
    } else {
      [0, 25, 50, 75, 100].forEach(function (p) { var y2 = (1 - p / 100) * (CH - 8 * 1) + 4; g.beginPath(); g.moveTo(0, y2 + .5); g.lineTo(CW, y2 + .5); g.stroke(); g.fillText(String(p), 3, y2 - 2); });
      if (CP.scope === 'parade') { g.beginPath(); g.moveTo(CW / 3, 0); g.lineTo(CW / 3, CH); g.moveTo(2 * CW / 3, 0); g.lineTo(2 * CW / 3, CH); g.stroke(); }
    }
  };
})();
