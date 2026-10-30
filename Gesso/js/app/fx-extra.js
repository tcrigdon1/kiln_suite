/* =========================================================================
   Gesso — extra effects registered into the shared ImageFX library (ImageFX.register):
     dehaze        (filter, Color)      dark-channel haze removal
     hdrTone       (adjustment)         local tone mapping ("HDR look"): compress the base, keep detail
     matchColor    (filter, Color)      transfer the colour statistics of a reference layer (Lab mean / std)
     depthBlur     (filter, Blur)       lens-style blur whose radius follows a depth map (a layer's luminance)
     develop       (adjustment)         all-in-one raw-style development: temperature, tint, exposure, contrast,
                                        highlights, shadows, whites, blacks, texture, clarity, dehaze, vibrance,
                                        saturation, tone curve, split toning
   Gesso-side dialogs supply the reference / depth images through opts (see FX.dialog hooks in filters.js).
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util;
  if (!window.ImageFX) return;
  const IF = window.ImageFX, reg = (kind, e) => IF.register(kind, e);
  const range = (id, label, def, min, max, step, unit) => { const o = { id, label, type: 'range', default: def, min, max, step: step || 1 }; if (unit) o.unit = unit; return o; };
  const sel = (id, label, def, opts) => ({ id, label, type: 'select', default: def, options: opts.map((o) => ({ value: o[0], label: o[1] })) });
  const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

  /* ---------- Lab helpers (shared with Subject) ---------- */
  function rgb2lab(r, g, b, o) {
    const L = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const rl = L(r), gl = L(g), bl = L(b);
    const x = f((0.4124 * rl + 0.3576 * gl + 0.1805 * bl) / 0.95047), y = f(0.2126 * rl + 0.7152 * gl + 0.0722 * bl), z = f((0.0193 * rl + 0.1192 * gl + 0.9505 * bl) / 1.08883);
    o[0] = 116 * y - 16; o[1] = 500 * (x - y); o[2] = 200 * (y - z);
  }
  function lab2rgb(L, a, bb, o) {
    const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - bb / 200;
    const fi = (t) => (t > 0.2069 ? t * t * t : (t - 16 / 116) / 7.787);
    const X = 0.95047 * fi(fx), Y = fi(fy), Z = 1.08883 * fi(fz);
    let r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z, g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z, b = 0.0557 * X - 0.204 * Y + 1.057 * Z;
    const G = (c) => { c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055; return U.clamp(c * 255, 0, 255); };
    o[0] = G(r); o[1] = G(g); o[2] = G(b);
  }
  S.ColorMath = { rgb2lab, lab2rgb };
  /** mean / std of L, a, b over opaque pixels */
  function labStats(img) {
    const d = img.data, n = img.width * img.height, t = [0, 0, 0], s = [0, 0, 0], q = [0, 0, 0]; let c = 0;
    const step = Math.max(1, Math.floor(n / 60000));
    for (let i = 0; i < n; i += step) { if (d[i * 4 + 3] < 8) continue; rgb2lab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2], t); for (let k = 0; k < 3; k++) { s[k] += t[k]; q[k] += t[k] * t[k]; } c++; }
    if (!c) return null;
    const mean = s.map((v) => v / c), std = q.map((v, k) => Math.sqrt(Math.max(1e-6, v / c - mean[k] * mean[k])));
    return { mean, std };
  }
  S.labStats = labStats;

  /* ---------- Dehaze ---------- */
  reg('filter', {
    id: 'dehaze', name: 'Dehaze', category: 'Color',
    params: [range('amount', 'Amount', 50, -100, 100, 1, '%'), range('radius', 'Radius', 15, 3, 60, 1, 'px')],
    apply(img, p) {
      const w = img.width, h = img.height, n = w * h, d = img.data;
      // dark channel: min over RGB, then a min filter (box) of the given radius
      const dark = new Float32Array(n);
      for (let i = 0, j = 0; i < n; i++, j += 4) dark[i] = Math.min(d[j], d[j + 1], d[j + 2]);
      const r = Math.max(1, Math.round(p.radius / 2)), tmp = new Float32Array(n);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 255; for (let k = -r; k <= r; k++) { const xx = Math.min(w - 1, Math.max(0, x + k)); if (dark[y * w + xx] < m) m = dark[y * w + xx]; } tmp[y * w + x] = m; }
      for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) { let m = 255; for (let k = -r; k <= r; k++) { const yy = Math.min(h - 1, Math.max(0, y + k)); if (tmp[yy * w + x] < m) m = tmp[yy * w + x]; } dark[y * w + x] = m; }
      // atmospheric light: mean colour of the brightest 0.1 % dark-channel pixels
      const idx = []; for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 100000))) idx.push(i);
      idx.sort((a, b) => dark[b] - dark[a]);
      const top = idx.slice(0, Math.max(1, Math.floor(idx.length * 0.001)));
      let Ar = 0, Ag = 0, Ab = 0; for (const i of top) { Ar += d[i * 4]; Ag += d[i * 4 + 1]; Ab += d[i * 4 + 2]; }
      Ar = Math.max(1, Ar / top.length); Ag = Math.max(1, Ag / top.length); Ab = Math.max(1, Ab / top.length);
      const amt = p.amount / 100, omega = 0.95 * Math.abs(amt);
      // smooth the transmission a little (box blur of the dark channel)
      IF.util.gaussianBlur && void 0;
      for (let i = 0, j = 0; i < n; i++, j += 4) {
        const dc = Math.min(dark[i] / Ar, dark[i] / Ag, dark[i] / Ab);
        let t = 1 - omega * Math.min(1, dc); t = Math.max(0.15, t);
        if (amt < 0) t = 1 / (2 - t); // negative amount: add haze
        d[j] = U.clamp((d[j] - Ar) / t + Ar, 0, 255); d[j + 1] = U.clamp((d[j + 1] - Ag) / t + Ag, 0, 255); d[j + 2] = U.clamp((d[j + 2] - Ab) / t + Ab, 0, 255);
      }
      return img;
    },
  });

  /* ---------- HDR tone (local tone mapping) ---------- */
  function toneMap(img, p) {
    const w = img.width, h = img.height, n = w * h, d = img.data;
    const L = new Float32Array(n), lg = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) { L[i] = Math.max(1, lum(d[j], d[j + 1], d[j + 2])); lg[i] = Math.log(L[i]); }
    // base layer: large blur of log luminance (edge-blind but stable); detail = log - base
    const base = IF.util.createImageData(w, h); const bd = base.data;
    for (let i = 0, j = 0; i < n; i++, j += 4) { const v = (lg[i] / Math.log(256)) * 255; bd[j] = bd[j + 1] = bd[j + 2] = v; bd[j + 3] = 255; }
    IF.util.gaussianBlur(base, Math.max(2, p.radius));
    const comp = 1 - p.strength / 100 * 0.75, det = 1 + p.detail / 100;
    const mean = Math.log(90);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const b = (bd[j] / 255) * Math.log(256), dt = lg[i] - b;
      const nl = mean + (b - mean) * comp + dt * det;
      const k = Math.exp(nl) / L[i];
      let r = d[j] * k, g = d[j + 1] * k, bl = d[j + 2] * k;
      const nL = lum(r, g, bl), sat = 1 + p.saturation / 100;
      r = nL + (r - nL) * sat; g = nL + (g - nL) * sat; bl = nL + (bl - nL) * sat;
      d[j] = U.clamp(r, 0, 255); d[j + 1] = U.clamp(g, 0, 255); d[j + 2] = U.clamp(bl, 0, 255);
    }
    return img;
  }
  reg('adjustment', {
    id: 'hdrTone', name: 'Local Tone Mapping', category: 'Adjustment',
    params: [range('strength', 'Compression', 50, 0, 100, 1, '%'), range('detail', 'Detail', 40, -50, 200, 1, '%'), range('radius', 'Radius', 40, 4, 200, 1, 'px'), range('saturation', 'Saturation', 10, -100, 100, 1, '%')],
    apply: toneMap,
  });

  /* ---------- Match colour (reference statistics in params.ref = {mean:[3], std:[3]}) ---------- */
  reg('filter', {
    id: 'matchColor', name: 'Match Color (from layer)…', category: 'Color',
    params: [range('amount', 'Amount', 100, 0, 100, 1, '%'), range('luminance', 'Match luminance', 100, 0, 100, 1, '%'), { id: 'ref', label: 'Reference', type: 'hidden', default: null }],
    apply(img, p, opts) {
      const ref = (opts && opts.reference) || p.ref; if (!ref) return img;
      const src = labStats(img); if (!src) return img;
      const d = img.data, n = img.width * img.height, t = [0, 0, 0], o = [0, 0, 0], k = p.amount / 100, kl = (p.luminance / 100) * k;
      for (let i = 0, j = 0; i < n; i++, j += 4) {
        if (!d[j + 3]) continue;
        rgb2lab(d[j], d[j + 1], d[j + 2], t);
        const nl = ref.mean[0] + (t[0] - src.mean[0]) * (ref.std[0] / src.std[0]);
        const na = ref.mean[1] + (t[1] - src.mean[1]) * (ref.std[1] / src.std[1]);
        const nb = ref.mean[2] + (t[2] - src.mean[2]) * (ref.std[2] / src.std[2]);
        lab2rgb(t[0] + (nl - t[0]) * kl, t[1] + (na - t[1]) * k, t[2] + (nb - t[2]) * k, o);
        d[j] = o[0]; d[j + 1] = o[1]; d[j + 2] = o[2];
      }
      return img;
    },
  });

  /* ---------- Depth blur (opts.depth: Float32Array 0..1 per pixel, or params.depthConst) ---------- */
  reg('filter', {
    id: 'depthBlur', name: 'Depth Blur (lens, from layer)…', category: 'Blur',
    params: [range('radius', 'Max blur', 12, 1, 60, 1, 'px'), range('focus', 'Focus depth', 50, 0, 100, 1, '%'), range('depthRange', 'In-focus range', 15, 0, 100, 1, '%'), range('highlights', 'Highlight boost', 20, 0, 100, 1, '%')],
    apply(img, p, opts) {
      const w = img.width, h = img.height, n = w * h, depth = opts && opts.depth;
      if (!depth || depth.length !== n) return IF.util.gaussianBlur(img, p.radius / 2);
      // 4 blur levels, interpolated per pixel by the distance from the focus depth
      const levels = [img.data];
      const sig = [0, p.radius / 6, p.radius / 3, p.radius / 2];
      for (let k = 1; k < 4; k++) { const c = IF.util.cloneImageData(img); if (p.highlights > 0) { const cd = c.data, boost = 1 + p.highlights / 100; for (let i = 0; i < cd.length; i += 4) { const L = lum(cd[i], cd[i + 1], cd[i + 2]); if (L > 200) { const f = 1 + (boost - 1) * ((L - 200) / 55); cd[i] = Math.min(255, cd[i] * f); cd[i + 1] = Math.min(255, cd[i + 1] * f); cd[i + 2] = Math.min(255, cd[i + 2] * f); } } } IF.util.gaussianBlur(c, sig[k]); levels.push(c.data); }
      const out = IF.util.createImageData(w, h), od = out.data, f0 = p.focus / 100, rng = p.depthRange / 200;
      for (let i = 0, j = 0; i < n; i++, j += 4) {
        let a = Math.abs(depth[i] - f0) - rng; a = Math.max(0, a) / Math.max(0.01, 1 - rng); a = Math.min(1, a) * 3;
        const k0 = Math.min(2, Math.floor(a)), t = a - k0, A = levels[k0], B = levels[k0 + 1];
        for (let c = 0; c < 4; c++) od[j + c] = A[j + c] + (B[j + c] - A[j + c]) * t;
      }
      return out;
    },
  });

  /* ---------- Develop (all-in-one) ---------- */
  const A = IF.adjustments, F = IF.filters;
  const chain = (img, id, params) => { const e = A[id] || F[id]; return e ? (e.apply(img, params, {}) || img) : img; };
  reg('adjustment', {
    id: 'develop', name: 'Develop (all-in-one)', category: 'Adjustment',
    params: [
      { id: 'h1', type: 'header', label: 'White balance', default: 0 },
      range('temperature', 'Temperature', 0, -100, 100), range('tint', 'Tint', 0, -100, 100),
      { id: 'h2', type: 'header', label: 'Tone', default: 0 },
      range('exposure', 'Exposure', 0, -300, 300, 1), range('contrast', 'Contrast', 0, -100, 100), range('highlights', 'Highlights', 0, -100, 100), range('shadows', 'Shadows', 0, -100, 100), range('whites', 'Whites', 0, -100, 100), range('blacks', 'Blacks', 0, -100, 100),
      { id: 'h3', type: 'header', label: 'Presence', default: 0 },
      range('texture', 'Texture', 0, -100, 100), range('clarity', 'Clarity', 0, -100, 100), range('dehaze', 'Dehaze', 0, -100, 100), range('vibrance', 'Vibrance', 0, -100, 100), range('saturation', 'Saturation', 0, -100, 100), range('radius', 'Local radius', 24, 4, 120, 1, 'px'),
      { id: 'h4', type: 'header', label: 'Curve & split toning', default: 0 },
      { id: 'curve', label: 'Tone curve', type: 'curve', default: { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] } },
      { id: 'splitShadow', label: 'Shadow tint', type: 'color', default: '#3050a0' }, { id: 'splitHighlight', label: 'Highlight tint', type: 'color', default: '#f0b060' }, range('splitAmount', 'Split toning', 0, 0, 100, 1, '%'), range('splitBalance', 'Balance', 0, -100, 100),
    ],
    apply(img, p) {
      if (p.temperature || p.tint) img = chain(img, 'temperatureTint', { temperature: p.temperature, tint: p.tint });
      if (p.exposure) img = chain(img, 'exposure', { exposure: p.exposure / 100, offset: 0, gamma: 1 });
      if (p.contrast) img = chain(img, 'brightnessContrast', { brightness: 0, contrast: p.contrast });
      if (p.shadows || p.highlights) img = chain(img, 'shadowsHighlights', { shadows: Math.max(0, p.shadows), highlights: Math.max(0, -p.highlights), radius: p.radius, color: 0 });
      // whites / blacks: end-point curve; negative shadows / positive highlights fold in as well
      const wb = p.whites || p.blacks || p.shadows < 0 || p.highlights > 0;
      if (wb) {
        const pts = [[0, U.clamp(-p.blacks * 0.4, 0, 60)], [64, U.clamp(64 + Math.min(0, p.shadows) * 0.3, 0, 128)], [192, U.clamp(192 + Math.max(0, p.highlights) * 0.3, 128, 255)], [255, U.clamp(255 - Math.max(0, -p.whites) * 0.4 + Math.max(0, p.whites) * 0, 190, 255)]];
        if (p.whites > 0) pts[2][1] = U.clamp(pts[2][1] + p.whites * 0.25, 128, 255);
        if (p.blacks > 0) pts[1][1] = U.clamp(pts[1][1] - p.blacks * 0.2, 0, 128);
        img = chain(img, 'curves', { curve: { rgb: pts, r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] } });
      }
      if (p.texture) img = chain(img, p.texture > 0 ? 'unsharpMask' : 'surfaceBlur', p.texture > 0 ? { amount: p.texture, radius: 1.5, threshold: 0 } : { radius: 3, threshold: Math.round(-p.texture / 4) });
      if (p.clarity) img = chain(img, 'clarity', { amount: p.clarity, radius: p.radius });
      if (p.dehaze) img = chain(img, 'dehaze', { amount: p.dehaze, radius: 15 });
      if (p.vibrance) img = chain(img, 'vibrance', { vibrance: p.vibrance, saturation: 0 });
      if (p.saturation) img = chain(img, 'hueSaturation', { hue: 0, saturation: p.saturation, lightness: 0 });
      const c = p.curve; if (c && JSON.stringify(c) !== JSON.stringify({ rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] })) img = chain(img, 'curves', { curve: c });
      if (p.splitAmount > 0) {
        const sc = U.hexToRgb(p.splitShadow), hc = U.hexToRgb(p.splitHighlight), d = img.data, k = p.splitAmount / 100 * 0.6, bal = p.splitBalance / 100;
        for (let i = 0; i < d.length; i += 4) {
          const L = lum(d[i], d[i + 1], d[i + 2]) / 255, t = U.clamp((L - 0.5 + bal * 0.5) * 2 + 0.5, 0, 1);
          const tr = sc.r + (hc.r - sc.r) * t, tg = sc.g + (hc.g - sc.g) * t, tb = sc.b + (hc.b - sc.b) * t;
          const wgt = k * (1 - Math.abs(L - 0.5) * 2 * 0.5);
          d[i] = U.clamp(d[i] + (tr - 128) * wgt, 0, 255); d[i + 1] = U.clamp(d[i + 1] + (tg - 128) * wgt, 0, 255); d[i + 2] = U.clamp(d[i + 2] + (tb - 128) * wgt, 0, 255);
        }
      }
      return img;
    },
  });
  // show Develop near the top of the adjustments lists
  if (S.ADJ_ORDER && !S.ADJ_ORDER.includes('develop')) S.ADJ_ORDER.unshift('develop');
  if (S.ADJ_ORDER && !S.ADJ_ORDER.includes('hdrTone')) S.ADJ_ORDER.push('hdrTone');
  if (S.ADJ_ICON) { S.ADJ_ICON.develop = 'sliders'; S.ADJ_ICON.hdrTone = 'aSH'; }
})();
