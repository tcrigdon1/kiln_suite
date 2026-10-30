/* =========================================================================
   Gesso — generic parameter UI generator.
   S.ParamUI.build(defs, values, onChange(values, id, final), opts) → HTMLElement
   Supports ParamDef types: range, number, checkbox, select, color, angle,
   curve, levels, gradient, plus internal helpers: text, header, note.
   opts.histogram: () => ({r,g,b,l}) arrays of 256 counts (for curves/levels)
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util;
  const P = (S.ParamUI = {});
  const clone = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);

  P.build = function (defs, values, onChange, opts) {
    opts = opts || {};
    const vals = {};
    for (const d of defs) vals[d.id] = clone(values && values[d.id] !== undefined ? values[d.id] : d.default);
    const root = U.el('div', { class: 'param-ui' });
    const emit = (id, final) => onChange && onChange(vals, id, final);
    for (const d of defs) {
      if (d.showIf && !d.showIf(vals)) { /* rendered but hidden toggling not supported; keep simple */ }
      const w = (P.widgets[d.type] || P.widgets.number)(d, vals, emit, opts);
      if (w) root.appendChild(w);
    }
    root.values = vals;
    return root;
  };

  /**
   * Field keydown: keep keys away from the app shortcuts while typing, and give focus back to the
   * document on Enter (after the value is applied) — otherwise Ctrl+Z / tool keys stay trapped in the field.
   * Inside dialogs Enter must keep confirming the dialog, so only panel fields blur.
   */
  function blurOnEnter(e) {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.target.closest('.gesso-dialog')) e.target.blur(); // blur commits the value ('change')
  }
  P.blurOnEnter = blurOnEnter;

  function labelFor(d) { return d.label + (d.unit && d.unit !== '%' && d.unit !== '°' ? ' (' + d.unit + ')' : ''); }

  /** slider + number field row (exported for reuse in panels/options bar) */
  P.slider = function (label, value, min, max, step, onInput, onFinal, unit) {
    const row = U.el('div', { class: 'field' });
    const lab = U.el('label', { title: label }, label);
    const r = U.el('input', { type: 'range', min, max, step: step || 1, value });
    const n = U.el('input', { type: 'number', min, max, step: step || 1, value: U.fmt(value, 2) });
    const set = (v, final) => {
      v = U.clamp(+v, min, max);
      if (isNaN(v)) return;
      r.value = v; n.value = U.fmt(v, 2);
      onInput && onInput(v);
      if (final && onFinal) onFinal(v);
    };
    r.addEventListener('input', () => set(r.value, false));
    r.addEventListener('change', () => set(r.value, true));
    n.addEventListener('change', () => set(n.value, true));
    n.addEventListener('keydown', blurOnEnter);
    r.addEventListener('dblclick', () => { if (r.dataset.def != null) set(r.dataset.def, true); });
    row.append(lab, r, n);
    if (unit) n.title = unit;
    row.setValue = (v) => { r.value = v; n.value = U.fmt(v, 2); };
    return row;
  };

  P.widgets = {
    header(d) { return U.el('div', { class: 'param-header' }, d.label); },
    hidden() { return null; },
    note(d) { return U.el('div', { class: 'param-note muted' }, d.label); },
    range(d, vals, emit) {
      const row = P.slider(labelFor(d), vals[d.id], d.min ?? 0, d.max ?? 100, d.step ?? 1,
        (v) => { vals[d.id] = v; emit(d.id, false); }, () => emit(d.id, true), d.unit);
      row.querySelector('input[type=range]').dataset.def = d.default;
      return row;
    },
    number(d, vals, emit) {
      const row = U.el('div', { class: 'field field-2' });
      const n = U.el('input', { type: 'number', value: vals[d.id], min: d.min, max: d.max, step: d.step || 1 });
      n.addEventListener('change', () => { let v = +n.value; if (d.min != null) v = Math.max(d.min, v); if (d.max != null) v = Math.min(d.max, v); n.value = v; vals[d.id] = v; emit(d.id, true); });
      n.addEventListener('keydown', blurOnEnter);
      row.append(U.el('label', {}, labelFor(d)), n);
      if (d.unit) row.appendChild(U.el('span', { class: 'muted' }, d.unit));
      return row;
    },
    text(d, vals, emit) {
      const row = U.el('div', { class: 'field field-wide' });
      const n = U.el('input', { type: 'text', value: vals[d.id] ?? '' });
      n.addEventListener('input', () => { vals[d.id] = n.value; emit(d.id, false); });
      n.addEventListener('change', () => emit(d.id, true));
      n.addEventListener('keydown', (e) => { if (e.key !== 'Enter' && e.key !== 'Escape') e.stopPropagation(); });
      row.append(U.el('label', {}, labelFor(d)), n);
      return row;
    },
    checkbox(d, vals, emit) {
      const row = U.el('label', { class: 'check-row' });
      const c = U.el('input', { type: 'checkbox', checked: !!vals[d.id] });
      c.addEventListener('change', () => { vals[d.id] = c.checked; emit(d.id, true); });
      row.append(c, U.el('span', {}, d.label));
      return row;
    },
    select(d, vals, emit) {
      const row = U.el('div', { class: 'field field-wide' });
      const s = U.el('select');
      for (const o of d.options || []) {
        const op = typeof o === 'object' ? o : { value: o, label: o };
        s.appendChild(U.el('option', { value: op.value }, op.label));
      }
      s.value = vals[d.id];
      s.addEventListener('change', () => {
        const o = (d.options || []).find((x) => String(typeof x === 'object' ? x.value : x) === s.value);
        vals[d.id] = o && typeof o === 'object' ? o.value : s.value;
        emit(d.id, true);
      });
      row.append(U.el('label', {}, labelFor(d)), s);
      return row;
    },
    color(d, vals, emit) {
      const row = U.el('div', { class: 'field field-wide' });
      const sw = U.el('button', { class: 'color-chip', style: { background: vals[d.id] }, title: 'Pick color' });
      const hex = U.el('input', { type: 'text', value: vals[d.id], class: 'hex-input', maxlength: 7 });
      const set = (v, final) => { vals[d.id] = v; sw.style.background = v; hex.value = v; emit(d.id, final); };
      sw.addEventListener('click', () => S.ColorPicker.open(vals[d.id], (c) => set(c, false), (c) => set(c, true)));
      hex.addEventListener('change', () => { if (/^#?[0-9a-f]{6}$/i.test(hex.value)) set('#' + hex.value.replace('#', '').toLowerCase(), true); else hex.value = vals[d.id]; });
      hex.addEventListener('keydown', (e) => e.stopPropagation());
      row.append(U.el('label', {}, labelFor(d)), U.el('div', { class: 'row' }, [sw, hex]));
      return row;
    },
    angle(d, vals, emit) {
      const row = U.el('div', { class: 'field' });
      const dial = U.el('div', { class: 'angle-dial', title: 'Drag to set angle' });
      const hand = U.el('div', { class: 'hand' });
      dial.appendChild(hand);
      const n = U.el('input', { type: 'number', min: -360, max: 360, value: vals[d.id] });
      const draw = () => { hand.style.transform = 'rotate(' + -vals[d.id] + 'deg)'; n.value = Math.round(vals[d.id]); };
      const set = (v, final) => {
        v = Math.round(v);
        if (d.min != null && d.max != null && d.max - d.min < 360) v = U.clamp(v, d.min, d.max);
        vals[d.id] = v; draw(); emit(d.id, final);
      };
      dial.addEventListener('pointerdown', (e) => {
        dial.setPointerCapture(e.pointerId);
        const mv = (ev) => {
          const r = dial.getBoundingClientRect();
          let a = (Math.atan2(-(ev.clientY - r.top - r.height / 2), ev.clientX - r.left - r.width / 2) * 180) / Math.PI;
          if (ev.shiftKey) a = Math.round(a / 15) * 15;
          set(a, false);
        };
        mv(e);
        dial.onpointermove = mv;
        dial.onpointerup = () => { dial.onpointermove = null; set(vals[d.id], true); };
      });
      n.addEventListener('change', () => set(+n.value || 0, true));
      n.addEventListener('keydown', blurOnEnter);
      draw();
      row.append(U.el('label', {}, d.label), U.el('div', { class: 'row' }, [dial]), n);
      return row;
    },
    curve(d, vals, emit, opts) { return P.curveEditor(d, vals, emit, opts); },
    levels(d, vals, emit, opts) { return P.levelsEditor(d, vals, emit, opts); },
    gradient(d, vals, emit) { return P.gradientEditor(d, vals, emit); },
  };

  /* ---------------- Histogram helper ---------------- */
  P.histogramOf = function (canvasOrImageData) {
    let img = canvasOrImageData;
    if (img instanceof HTMLCanvasElement) {
      // downsample large canvases for speed
      const s = Math.min(1, 512 / Math.max(img.width, img.height));
      const c = U.createCanvas(img.width * s, img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      img = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    }
    const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      r[d[i]]++; g[d[i + 1]]++; b[d[i + 2]]++; l[(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0]++;
    }
    return { r, g, b, l };
  };
  P.drawHistogram = function (ctx, arr, x, y, w, h, color, log) {
    let max = 1;
    for (let i = 0; i < 256; i++) max = Math.max(max, log ? Math.log(1 + arr[i]) : arr[i]);
    // ignore extreme spikes when scaling
    const sorted = Array.from(arr).sort((a, b) => b - a);
    if (!log && sorted[0] > sorted[3] * 4) max = Math.max(1, sorted[3] * 1.3);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(x, y + h);
    for (let i = 0; i < 256; i++) {
      const v = log ? Math.log(1 + arr[i]) : arr[i];
      ctx.lineTo(x + (i / 255) * w, y + h - Math.min(1, v / max) * h);
    }
    ctx.lineTo(x + w, y + h); ctx.closePath(); ctx.fill();
  };

  /* ---------------- Monotone cubic interpolation ---------------- */
  P.curveLUT = function (pts) {
    pts = pts.slice().sort((a, b) => a[0] - b[0]);
    const n = pts.length, out = new Float32Array(256);
    if (n === 1) { out.fill(pts[0][1]); return out; }
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const dx = [], m = [], dydx = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = xs[i + 1] - xs[i] || 1e-6; dydx[i] = (ys[i + 1] - ys[i]) / dx[i]; }
    m[0] = dydx[0]; m[n - 1] = dydx[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = dydx[i - 1] * dydx[i] <= 0 ? 0 : (dydx[i - 1] + dydx[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (!dydx[i]) { m[i] = m[i + 1] = 0; continue; }
      const a = m[i] / dydx[i], b = m[i + 1] / dydx[i], s = a * a + b * b;
      if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * dydx[i]; m[i + 1] = t * b * dydx[i]; }
    }
    for (let x = 0; x < 256; x++) {
      if (x <= xs[0]) { out[x] = ys[0]; continue; }
      if (x >= xs[n - 1]) { out[x] = ys[n - 1]; continue; }
      let i = 0; while (x > xs[i + 1]) i++;
      const h = dx[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
      out[x] = (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
    }
    return out;
  };

  /* ---------------- Curve editor ---------------- */
  P.curveEditor = function (d, vals, emit, opts) {
    const wrap = U.el('div', { class: 'curve-editor' });
    if (!vals[d.id] || !vals[d.id].rgb) vals[d.id] = clone(d.default || { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] });
    for (const k of ['rgb', 'r', 'g', 'b']) if (!vals[d.id][k]) vals[d.id][k] = [[0, 0], [255, 255]];
    let ch = 'rgb';
    const chSel = U.el('select', {}, [['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']].map(([v, l]) => U.el('option', { value: v }, l)));
    const reset = U.el('button', { class: 'btn ghost btn-sm' }, 'Reset');
    const readout = U.el('span', { class: 'muted mono' }, '');
    wrap.appendChild(U.el('div', { class: 'row', style: { marginBottom: '6px' } }, [U.el('span', { class: 'muted' }, 'Channel'), chSel, U.el('div', { style: { flex: 1 } }), readout, reset]));
    const SZ = 232, PAD = 6;
    const cv = U.el('canvas', { width: SZ * 2, height: SZ * 2, class: 'curve-canvas' });
    cv.style.width = cv.style.height = SZ + 'px';
    wrap.appendChild(cv);
    const ctx = cv.getContext('2d');
    ctx.scale(2, 2);
    const hist = opts.histogram ? opts.histogram() : null;
    const inner = SZ - PAD * 2;
    const toC = (x, y) => [PAD + (x / 255) * inner, PAD + (1 - y / 255) * inner];
    const fromC = (cx, cy) => [U.clamp(((cx - PAD) / inner) * 255, 0, 255), U.clamp((1 - (cy - PAD) / inner) * 255, 0, 255)];
    const colors = { rgb: '#f2ebe3', r: '#ff6b6b', g: '#6bdc7a', b: '#6aa8ff' };
    let sel = -1;
    function draw() {
      ctx.clearRect(0, 0, SZ, SZ);
      ctx.fillStyle = '#100e0c'; ctx.fillRect(PAD, PAD, inner, inner);
      if (hist) P.drawHistogram(ctx, hist[ch === 'rgb' ? 'l' : ch], PAD, PAD, inner, inner, 'rgba(200,189,177,.16)');
      ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) { const p = PAD + (i / 4) * inner; ctx.beginPath(); ctx.moveTo(p, PAD); ctx.lineTo(p, PAD + inner); ctx.moveTo(PAD, p); ctx.lineTo(PAD + inner, p); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.beginPath(); ctx.moveTo(...toC(0, 0)); ctx.lineTo(...toC(255, 255)); ctx.stroke();
      // other channels faintly
      for (const k of ['r', 'g', 'b', 'rgb']) {
        if (k === ch) continue;
        const pts = vals[d.id][k];
        if (pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 255 && pts[1][1] === 255) continue;
        const lut = P.curveLUT(pts);
        ctx.strokeStyle = colors[k] + '55'; ctx.beginPath();
        for (let x = 0; x < 256; x++) { const [a, b] = toC(x, lut[x]); x ? ctx.lineTo(a, b) : ctx.moveTo(a, b); }
        ctx.stroke();
      }
      const pts = vals[d.id][ch], lut = P.curveLUT(pts);
      ctx.strokeStyle = colors[ch]; ctx.lineWidth = 1.6; ctx.beginPath();
      for (let x = 0; x < 256; x++) { const [a, b] = toC(x, U.clamp(lut[x], 0, 255)); x ? ctx.lineTo(a, b) : ctx.moveTo(a, b); }
      ctx.stroke();
      pts.forEach((p, i) => {
        const [a, b] = toC(p[0], p[1]);
        ctx.fillStyle = i === sel ? '#f0913a' : '#1c1916'; ctx.strokeStyle = i === sel ? '#ffad62' : colors[ch];
        ctx.lineWidth = 1.4; ctx.beginPath(); ctx.rect(a - 3.5, b - 3.5, 7, 7); ctx.fill(); ctx.stroke();
      });
    }
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('pointerdown', (e) => {
      const pts = vals[d.id][ch];
      const [cx, cy] = pos(e);
      sel = -1;
      pts.forEach((p, i) => { const [a, b] = toC(p[0], p[1]); if (Math.hypot(a - cx, b - cy) < 8) sel = i; });
      if (sel < 0) {
        const [x] = fromC(cx, cy);
        const lut = P.curveLUT(pts);
        pts.push([Math.round(x), Math.round(U.clamp(fromC(cx, cy)[1], 0, 255))]);
        void lut;
        pts.sort((a, b) => a[0] - b[0]);
        sel = pts.findIndex((p) => p[0] === Math.round(x));
      }
      cv.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const [mx, my] = pos(ev);
        const p = pts[sel];
        if (!p) return;
        const isEnd = sel === 0 || sel === pts.length - 1;
        const out = my < -20 || my > SZ + 20 || mx < -20 || mx > SZ + 20;
        if (out && !isEnd && pts.length > 2) { p._remove = true; } else p._remove = false;
        let [x, y] = fromC(mx, my);
        const lo = sel > 0 ? pts[sel - 1][0] + 1 : 0, hi = sel < pts.length - 1 ? pts[sel + 1][0] - 1 : 255;
        p[0] = Math.round(U.clamp(x, lo, hi)); p[1] = Math.round(y);
        readout.textContent = 'In ' + p[0] + '  Out ' + p[1];
        draw();
        emit(d.id, false);
      };
      move(e);
      cv.onpointermove = move;
      cv.onpointerup = () => {
        cv.onpointermove = null;
        const i = pts.findIndex((p) => p._remove);
        if (i >= 0) { pts.splice(i, 1); sel = -1; }
        pts.forEach((p) => delete p._remove);
        draw(); emit(d.id, true);
      };
    });
    cv.addEventListener('dblclick', (e) => {
      const pts = vals[d.id][ch]; const [cx, cy] = pos(e);
      const i = pts.findIndex((p) => { const [a, b] = toC(p[0], p[1]); return Math.hypot(a - cx, b - cy) < 8; });
      if (i > 0 && i < pts.length - 1) { pts.splice(i, 1); draw(); emit(d.id, true); }
    });
    chSel.addEventListener('change', () => { ch = chSel.value; sel = -1; draw(); });
    reset.addEventListener('click', () => { vals[d.id][ch] = [[0, 0], [255, 255]]; draw(); emit(d.id, true); });
    wrap.appendChild(U.el('div', { class: 'muted hint' }, 'Click to add a point · drag off the graph or double-click to remove'));
    draw();
    return wrap;
  };

  /* ---------------- Levels editor ---------------- */
  P.levelsEditor = function (d, vals, emit, opts) {
    // value format (ImageFX): { rgb:{inBlack,inWhite,gamma,outBlack,outWhite}, r:{..}, g:{..}, b:{..} }
    const def = () => ({ inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 });
    let V = vals[d.id];
    if (!V || typeof V !== 'object') V = {};
    if (V.channel !== undefined && V.inBlack !== undefined) { // legacy single-channel form
      const one = { inBlack: V.inBlack, inWhite: V.inWhite, gamma: V.gamma, outBlack: V.outBlack, outWhite: V.outWhite };
      V = { rgb: def(), r: def(), g: def(), b: def() }; V[V.channel || 'rgb'] = one;
    }
    for (const k of ['rgb', 'r', 'g', 'b']) V[k] = Object.assign(def(), V[k] || {});
    vals[d.id] = V;
    let ch = 'rgb';
    const cur = () => V[ch];
    const wrap = U.el('div', { class: 'levels-editor' });
    const chSel = U.el('select', {}, [['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']].map(([v, l]) => U.el('option', { value: v }, l)));
    const auto = U.el('button', { class: 'btn ghost btn-sm' }, 'Auto');
    const reset = U.el('button', { class: 'btn ghost btn-sm' }, 'Reset');
    wrap.appendChild(U.el('div', { class: 'row', style: { marginBottom: '6px' } }, [U.el('span', { class: 'muted' }, 'Channel'), chSel, U.el('div', { style: { flex: 1 } }), auto, reset]));
    const W = 232, H = 96;
    const cv = U.el('canvas', { width: W * 2, height: H * 2, class: 'levels-hist' });
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const ctx = cv.getContext('2d'); ctx.scale(2, 2);
    const hist = opts.histogram ? opts.histogram() : null;
    const mkTrack = (cls) => U.el('div', { class: 'lv-track ' + cls });
    const inTrack = mkTrack('lv-in'), outTrack = mkTrack('lv-out');
    const hB = U.el('div', { class: 'lv-h black' }), hG = U.el('div', { class: 'lv-h gray' }), hW = U.el('div', { class: 'lv-h white' });
    inTrack.append(hB, hG, hW);
    const oB = U.el('div', { class: 'lv-h black' }), oW = U.el('div', { class: 'lv-h white' });
    outTrack.append(oB, oW);
    const num = (v, min, max, step) => { const n = U.el('input', { type: 'number', min, max, step, value: v }); n.addEventListener('keydown', (e) => e.stopPropagation()); return n; };
    const nB = num(0, 0, 253, 1), nG = num(1, 0.1, 9.99, 0.01), nW = num(255, 2, 255, 1);
    const nOB = num(0, 0, 255, 1), nOW = num(255, 0, 255, 1);
    wrap.append(cv, inTrack, U.el('div', { class: 'row lv-nums' }, [nB, nG, nW]),
      U.el('div', { class: 'muted', style: { margin: '6px 0 2px' } }, 'Output Levels'), outTrack, U.el('div', { class: 'row lv-nums' }, [nOB, U.el('span'), nOW]));
    const midPos = () => { const L = cur(); return L.inBlack + (L.inWhite - L.inBlack) * Math.pow(0.5, L.gamma); };
    function draw() {
      const L = cur();
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#100e0c'; ctx.fillRect(0, 0, W, H);
      if (hist) {
        const key = ch === 'rgb' ? 'l' : ch;
        P.drawHistogram(ctx, hist[key], 0, 4, W, H - 4, { l: 'rgba(242,235,227,.65)', r: 'rgba(255,107,107,.75)', g: 'rgba(107,220,122,.75)', b: 'rgba(106,168,255,.75)' }[key]);
      } else { ctx.fillStyle = '#5a5047'; ctx.fillText('No histogram', 8, 16); }
      const px = (v) => (v / 255) * 100 + '%';
      hB.style.left = px(L.inBlack); hW.style.left = px(L.inWhite); hG.style.left = px(midPos());
      oB.style.left = px(L.outBlack); oW.style.left = px(L.outWhite);
      nB.value = Math.round(L.inBlack); nW.value = Math.round(L.inWhite); nG.value = (+L.gamma).toFixed(2);
      nOB.value = Math.round(L.outBlack); nOW.value = Math.round(L.outWhite);
    }
    const drag = (handle, track, fn) => {
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault(); handle.setPointerCapture(e.pointerId);
        const mv = (ev) => { const r = track.getBoundingClientRect(); fn(U.clamp(((ev.clientX - r.left) / r.width) * 255, 0, 255), cur()); draw(); emit(d.id, false); };
        handle.onpointermove = mv;
        handle.onpointerup = () => { handle.onpointermove = null; emit(d.id, true); };
      });
    };
    drag(hB, inTrack, (v, L) => { L.inBlack = Math.round(Math.min(v, L.inWhite - 2)); });
    drag(hW, inTrack, (v, L) => { L.inWhite = Math.round(Math.max(v, L.inBlack + 2)); });
    drag(hG, inTrack, (v, L) => { const t = U.clamp((v - L.inBlack) / (L.inWhite - L.inBlack), 0.01, 0.99); L.gamma = +U.clamp(Math.log(t) / Math.log(0.5), 0.1, 9.99).toFixed(2); });
    drag(oB, outTrack, (v, L) => { L.outBlack = Math.round(v); });
    drag(oW, outTrack, (v, L) => { L.outWhite = Math.round(v); });
    const bindNum = (n, key) => n.addEventListener('change', () => { const L = cur(); L[key] = +n.value; if (L.inWhite <= L.inBlack) L.inWhite = L.inBlack + 2; draw(); emit(d.id, true); });
    bindNum(nB, 'inBlack'); bindNum(nG, 'gamma'); bindNum(nW, 'inWhite'); bindNum(nOB, 'outBlack'); bindNum(nOW, 'outWhite');
    chSel.addEventListener('change', () => { ch = chSel.value; draw(); });
    reset.addEventListener('click', () => { Object.assign(cur(), def()); draw(); emit(d.id, true); });
    auto.addEventListener('click', () => {
      if (!hist) return;
      const a = hist[ch === 'rgb' ? 'l' : ch], L = cur();
      let total = 0; for (let i = 0; i < 256; i++) total += a[i];
      const clip = total * 0.001; let acc = 0, lo = 0, hi = 255;
      for (let i = 0; i < 256; i++) { acc += a[i]; if (acc > clip) { lo = i; break; } }
      acc = 0; for (let i = 255; i >= 0; i--) { acc += a[i]; if (acc > clip) { hi = i; break; } }
      L.inBlack = lo; L.inWhite = Math.max(lo + 2, hi); L.gamma = 1; draw(); emit(d.id, true);
    });
    draw();
    return wrap;
  };

  /* ---------------- Gradient editor ---------------- */
  P.gradientEditor = function (d, vals, emit) {
    if (!Array.isArray(vals[d.id]) || vals[d.id].length < 2) vals[d.id] = clone(d.default || [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }]);
    const wrap = U.el('div', { class: 'grad-editor' });
    const presetSel = U.el('select', { class: 'grad-presets' });
    presetSel.appendChild(U.el('option', { value: '' }, 'Presets…'));
    S.Gradient.PRESETS.forEach((p, i) => presetSel.appendChild(U.el('option', { value: i }, p.name)));
    const rev = U.el('button', { class: 'btn ghost btn-sm', title: 'Reverse' }, 'Reverse');
    if (d.label) wrap.appendChild(U.el('div', { class: 'param-label' }, d.label));
    wrap.appendChild(U.el('div', { class: 'row', style: { marginBottom: '6px' } }, [presetSel, U.el('div', { style: { flex: 1 } }), rev]));
    const barWrap = U.el('div', { class: 'grad-bar-wrap' });
    const bar = U.el('div', { class: 'grad-bar checker' });
    const fillEl = U.el('div', { class: 'grad-fill' });
    bar.appendChild(fillEl);
    const stopsRow = U.el('div', { class: 'grad-stops' });
    barWrap.append(bar, stopsRow);
    wrap.appendChild(barWrap);
    const sw = U.el('button', { class: 'color-chip' });
    const posN = U.el('input', { type: 'number', min: 0, max: 100, value: 0 });
    const alphaN = U.el('input', { type: 'number', min: 0, max: 100, value: 100 });
    const del = U.el('button', { class: 'icon-btn', html: S.icon('trash'), title: 'Delete stop' });
    [posN, alphaN].forEach((n) => n.addEventListener('keydown', (e) => e.stopPropagation()));
    wrap.appendChild(U.el('div', { class: 'row grad-stop-edit' }, [U.el('span', { class: 'muted' }, 'Stop'), sw, U.el('span', { class: 'muted' }, 'Loc'), posN, U.el('span', { class: 'muted' }, 'Opac'), alphaN, del]));
    let sel = 0;
    const stops = () => vals[d.id];
    function draw() {
      const st = stops().slice().sort((a, b) => a.pos - b.pos);
      fillEl.style.background = S.Gradient.css(st);
      stopsRow.innerHTML = '';
      stops().forEach((s, i) => {
        const m = U.el('div', { class: 'grad-stop' + (i === sel ? ' sel' : ''), style: { left: s.pos * 100 + '%' } });
        m.appendChild(U.el('i', { style: { background: s.color } }));
        m.addEventListener('pointerdown', (e) => {
          e.stopPropagation(); sel = i; draw();
          const r = stopsRow.getBoundingClientRect();
          const mk = stopsRow.children[i];
          mk.setPointerCapture(e.pointerId);
          mk.onpointermove = (ev) => {
            s.pos = +U.clamp((ev.clientX - r.left) / r.width, 0, 1).toFixed(3);
            s._remove = stops().length > 2 && ev.clientY - r.bottom > 30;
            mk.style.left = s.pos * 100 + '%'; mk.style.opacity = s._remove ? 0.3 : 1;
            fillEl.style.background = S.Gradient.css(stops().slice().sort((a, b) => a.pos - b.pos));
            posN.value = Math.round(s.pos * 100);
            emit(d.id, false);
          };
          mk.onpointerup = () => {
            mk.onpointermove = null;
            if (s._remove) { stops().splice(i, 1); sel = 0; }
            stops().forEach((x) => delete x._remove);
            draw(); emit(d.id, true);
          };
        });
        m.addEventListener('dblclick', () => S.ColorPicker.open(s.color, (c) => { s.color = c; draw(); emit(d.id, false); }, (c) => { s.color = c; draw(); emit(d.id, true); }));
        stopsRow.appendChild(m);
      });
      const s = stops()[sel] || stops()[0];
      sw.style.background = s.color; posN.value = Math.round(s.pos * 100); alphaN.value = Math.round((s.alpha ?? 1) * 100);
    }
    stopsRow.addEventListener('pointerdown', (e) => {
      const r = stopsRow.getBoundingClientRect();
      const pos = U.clamp((e.clientX - r.left) / r.width, 0, 1);
      // interpolate color at pos
      const lut = S.Gradient.lut(stops());
      const k = Math.round(pos * 255) * 4;
      stops().push({ pos: +pos.toFixed(3), color: U.rgbToHex(lut[k], lut[k + 1], lut[k + 2]), alpha: +(lut[k + 3] / 255).toFixed(2) });
      sel = stops().length - 1; draw(); emit(d.id, true);
    });
    sw.addEventListener('click', () => { const s = stops()[sel]; S.ColorPicker.open(s.color, (c) => { s.color = c; draw(); emit(d.id, false); }, (c) => { s.color = c; draw(); emit(d.id, true); }); });
    posN.addEventListener('change', () => { stops()[sel].pos = U.clamp(+posN.value / 100, 0, 1); draw(); emit(d.id, true); });
    alphaN.addEventListener('change', () => { stops()[sel].alpha = U.clamp(+alphaN.value / 100, 0, 1); draw(); emit(d.id, true); });
    del.addEventListener('click', () => { if (stops().length > 2) { stops().splice(sel, 1); sel = 0; draw(); emit(d.id, true); } });
    rev.addEventListener('click', () => { vals[d.id] = stops().map((s) => ({ ...s, pos: 1 - s.pos })).reverse(); sel = 0; draw(); emit(d.id, true); });
    presetSel.addEventListener('change', () => {
      if (presetSel.value === '') return;
      vals[d.id] = S.Gradient.resolve(S.Gradient.PRESETS[+presetSel.value]);
      presetSel.value = ''; sel = 0; draw(); emit(d.id, true);
    });
    draw();
    return wrap;
  };
})();
