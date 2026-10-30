/* =========================================================================
   Gesso — multi-layer photo tools:
     · Layer ▸ Auto-Align Layers     translation alignment of the selected layers (coarse-to-fine search)
     · Layer ▸ Merge Exposures (HDR look)   exposure fusion of the selected layers into one new layer
     · Image ▸ Apply Image…          blend one layer's pixels / channel onto the active layer or its mask
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util, O = S.Ops;
  const PM = (S.PhotoMerge = {});

  function selectedRaster(doc) {
    const ids = doc.selectedIds && doc.selectedIds.size ? [...doc.selectedIds] : [];
    let layers = [];
    doc.walk((l) => { if (l.type === 'raster' && !l.embed && (ids.length ? ids.includes(l.id) : l.visible)) layers.push(l); });
    return layers;
  }
  function luma(img, w, h) { const d = img.data, out = new Float32Array(w * h); for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = (0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]) * (d[j + 3] / 255); return out; }
  function downsample(src, w, h) { // 2× box
    const nw = w >> 1, nh = h >> 1, out = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) { const i = 2 * y * w + 2 * x; out[y * nw + x] = (src[i] + src[i + 1] + src[i + w] + src[i + w + 1]) / 4; }
    return out;
  }
  // mean-removed SSD between ref and img shifted by (dx,dy), over the overlap
  function score(ref, img, w, h, dx, dy) {
    let sa = 0, sb = 0, n = 0;
    const x0 = Math.max(0, dx), x1 = Math.min(w, w + dx), y0 = Math.max(0, dy), y1 = Math.min(h, h + dy);
    if (x1 - x0 < 8 || y1 - y0 < 8) return Infinity;
    const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 20000)));
    for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) { sa += ref[y * w + x]; sb += img[(y - dy) * w + (x - dx)]; n++; }
    const ma = sa / n, mb = sb / n; let s = 0;
    for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) { const d = (ref[y * w + x] - ma) - (img[(y - dy) * w + (x - dx)] - mb); s += d * d; }
    return s / n;
  }
  /** best (dx,dy) that moves `img` onto `ref` (both luma arrays w×h); pyramid search with ±range at the top */
  PM.align = function (ref, img, w, h, maxShiftFrac) {
    const pyr = [{ r: ref, i: img, w, h }];
    while (pyr[pyr.length - 1].w > 64 && pyr[pyr.length - 1].h > 64 && pyr.length < 7) { const t = pyr[pyr.length - 1]; pyr.push({ r: downsample(t.r, t.w, t.h), i: downsample(t.i, t.w, t.h), w: t.w >> 1, h: t.h >> 1 }); }
    let dx = 0, dy = 0;
    for (let L = pyr.length - 1; L >= 0; L--) {
      const t = pyr[L];
      const range = L === pyr.length - 1 ? Math.max(2, Math.round(Math.max(t.w, t.h) * (maxShiftFrac || 0.15))) : 2;
      let best = Infinity, bx = dx, by = dy;
      for (let yy = dy - range; yy <= dy + range; yy++) for (let xx = dx - range; xx <= dx + range; xx++) { const s = score(t.r, t.i, t.w, t.h, xx, yy); if (s < best) { best = s; bx = xx; by = yy; } }
      dx = bx; dy = by;
      if (L > 0) { dx *= 2; dy *= 2; }
    }
    return [dx, dy];
  };
  PM.autoAlign = function (doc) {
    const layers = selectedRaster(doc);
    if (layers.length < 2) { S.toast('Select two or more pixel layers to align (Ctrl-click in the Layers panel)'); return; }
    const rect = { x: 0, y: 0, w: doc.width, h: doc.height };
    const ref = layers[0], refL = luma(S.Layers.readRect(ref.canvas, rect, 0), doc.width, doc.height);
    const moves = [];
    for (let i = 1; i < layers.length; i++) {
      const l = layers[i], lum = luma(S.Layers.readRect(l.canvas, rect, 0), doc.width, doc.height);
      const [dx, dy] = PM.align(refL, lum, doc.width, doc.height, 0.15);
      moves.push({ l, dx, dy });
    }
    doc.commit('Auto-Align Layers', () => {
      moves.forEach(({ l, dx, dy }) => { if (!dx && !dy) return; const c = U.cloneCanvas(l.canvas); c.ox = (l.canvas.ox || 0) + dx; c.oy = (l.canvas.oy || 0) + dy; l.canvas = c; if (l.mask && !l.mask.canvas._empty) { const mc = U.cloneCanvas(l.mask.canvas); mc.ox = (mc.ox || 0) + dx; mc.oy = (mc.oy || 0) + dy; l.mask = { ...l.mask, canvas: mc, version: (l.mask.version || 0) + 1 }; } l.version++; doc.bump(l); });
    });
    S.toast('Aligned ' + moves.length + ' layer' + (moves.length === 1 ? '' : 's') + ' to “' + ref.name + '”: ' + moves.map((m) => m.l.name + ' ' + (m.dx >= 0 ? '+' : '') + m.dx + ', ' + (m.dy >= 0 ? '+' : '') + m.dy).join(' · '), 5000);
  };

  /* ---------- exposure fusion (Mertens-style weights, multi-scale blurred weight maps) ---------- */
  function fusionWorker() {
    return function () {
      function blur(src, w, h, r, tmp) { // separable box blur, 3 passes ≈ gaussian
        let a = src, b = tmp;
        for (let pass = 0; pass < 3; pass++) {
          for (let y = 0; y < h; y++) { let s = 0; const o = y * w; for (let x = -r; x <= r; x++) s += a[o + Math.min(w - 1, Math.max(0, x))]; for (let x = 0; x < w; x++) { b[o + x] = s / (2 * r + 1); s += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)]; } }
          for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y <= r; y++) s += b[Math.min(h - 1, Math.max(0, y)) * w + x]; for (let y = 0; y < h; y++) { a[y * w + x] = s / (2 * r + 1); s += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x]; } }
        }
        return a;
      }
      self.onmessage = function (e) {
        const { imgs, w, h, wc, ws, we, sigma } = e.data, n = imgs.length, N = w * h;
        // reduced grid for weights (≤ 512 px)
        const k = Math.max(1, Math.ceil(Math.max(w, h) / 512)), rw = Math.ceil(w / k), rh = Math.ceil(h / k);
        const weights = [], tmp = new Float32Array(rw * rh);
        for (let i = 0; i < n; i++) {
          const d = imgs[i], W = new Float32Array(rw * rh), L = new Float32Array(rw * rh);
          for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) { const q = (Math.min(h - 1, y * k) * w + Math.min(w - 1, x * k)) * 4; L[y * rw + x] = (0.299 * d[q] + 0.587 * d[q + 1] + 0.114 * d[q + 2]) / 255; }
          for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
            const q = (Math.min(h - 1, y * k) * w + Math.min(w - 1, x * k)) * 4, r = d[q] / 255, g = d[q + 1] / 255, b = d[q + 2] / 255;
            const xl = Math.max(0, x - 1), xr = Math.min(rw - 1, x + 1), yu = Math.max(0, y - 1), yd = Math.min(rh - 1, y + 1);
            const lap = Math.abs(4 * L[y * rw + x] - L[y * rw + xl] - L[y * rw + xr] - L[yu * rw + x] - L[yd * rw + x]);
            const mean = (r + g + b) / 3, sat = Math.sqrt(((r - mean) ** 2 + (g - mean) ** 2 + (b - mean) ** 2) / 3);
            const ex = Math.exp(-((r - 0.5) ** 2) / (2 * sigma * sigma)) * Math.exp(-((g - 0.5) ** 2) / (2 * sigma * sigma)) * Math.exp(-((b - 0.5) ** 2) / (2 * sigma * sigma));
            W[y * rw + x] = Math.pow(lap + 1e-6, wc) * Math.pow(sat + 1e-6, ws) * Math.pow(ex + 1e-6, we) + 1e-9;
          }
          weights.push(W);
        }
        // normalise, then smooth each weight map (avoids seams; some halo is the price of not doing full pyramids)
        for (let p = 0; p < rw * rh; p++) { let s = 0; for (let i = 0; i < n; i++) s += weights[i][p]; for (let i = 0; i < n; i++) weights[i][p] /= s; }
        const rad = Math.max(2, Math.round(Math.max(rw, rh) * 0.02));
        for (let i = 0; i < n; i++) blur(weights[i], rw, rh, rad, tmp);
        for (let p = 0; p < rw * rh; p++) { let s = 0; for (let i = 0; i < n; i++) s += weights[i][p]; for (let i = 0; i < n; i++) weights[i][p] /= s; }
        // blend at full resolution with bilinear weight lookup
        const out = new Uint8ClampedArray(N * 4);
        for (let y = 0; y < h; y++) {
          const fy = Math.min(rh - 1, y / k), y0 = Math.floor(fy), y1 = Math.min(rh - 1, y0 + 1), ty = fy - y0;
          for (let x = 0; x < w; x++) {
            const fx = Math.min(rw - 1, x / k), x0 = Math.floor(fx), x1 = Math.min(rw - 1, x0 + 1), tx = fx - x0;
            let r = 0, g = 0, b = 0, a = 0; const o = (y * w + x) * 4;
            for (let i = 0; i < n; i++) {
              const W = weights[i], wt = (W[y0 * rw + x0] * (1 - tx) + W[y0 * rw + x1] * tx) * (1 - ty) + (W[y1 * rw + x0] * (1 - tx) + W[y1 * rw + x1] * tx) * ty;
              const d = imgs[i]; r += d[o] * wt; g += d[o + 1] * wt; b += d[o + 2] * wt; a += d[o + 3] * wt;
            }
            out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
          }
          if ((y & 63) === 0) self.postMessage({ progress: y / h });
        }
        self.postMessage({ done: true, rgba: out }, [out.buffer]);
      };
    }.toString();
  }
  let fuseUrl = null;
  PM.fuse = function (imgs, w, h, opts, onProgress) {
    return new Promise((resolve, reject) => {
      if (!fuseUrl) fuseUrl = URL.createObjectURL(new Blob(['(' + fusionWorker() + ')()'], { type: 'text/javascript' }));
      const wk = new Worker(fuseUrl);
      wk.onmessage = (e) => { if (e.data.progress != null) { if (onProgress) onProgress(e.data.progress); return; } wk.terminate(); resolve(new ImageData(new Uint8ClampedArray(e.data.rgba), w, h)); };
      wk.onerror = (e) => { wk.terminate(); reject(new Error(e.message || 'fusion worker failed')); };
      const bufs = imgs.map((im) => new Uint8ClampedArray(im.data));
      wk.postMessage({ imgs: bufs, w, h, wc: opts.contrast, ws: opts.saturation, we: opts.exposure, sigma: opts.sigma || 0.2 }, bufs.map((b) => b.buffer));
    });
  };
  PM.mergeExposuresDialog = function (doc) {
    const layers = selectedRaster(doc);
    if (layers.length < 2) { S.toast('Select two or more exposures (pixel layers) — Ctrl-click them in the Layers panel'); return; }
    const last = S.store.get('fusion', { contrast: 1, saturation: 1, exposure: 1, align: true });
    const defs = [
      { id: 'contrast', label: 'Contrast weight', type: 'range', default: last.contrast, min: 0, max: 2, step: 0.1 },
      { id: 'saturation', label: 'Saturation weight', type: 'range', default: last.saturation, min: 0, max: 2, step: 0.1 },
      { id: 'exposure', label: 'Well-exposedness weight', type: 'range', default: last.exposure, min: 0, max: 2, step: 0.1 },
      { id: 'align', label: 'Auto-align the layers first', type: 'checkbox', default: last.align !== false },
    ];
    let vals = {}; defs.forEach((d) => (vals[d.id] = d.default));
    const ui = S.ParamUI.build(defs, vals, (v) => { vals = v; });
    const info = U.el('div', { class: 'muted', style: { fontSize: '11px', marginTop: '6px', lineHeight: '1.5' } }, 'Merges ' + layers.length + ' layers (' + layers.map((l) => l.name).join(', ') + ') into one new layer: each pixel is taken from whichever exposure shows it best — no tone-mapping halos, no 32-bit step. Shoot a dark, a normal and a bright frame of the same scene.');
    S.Dialog.open({ title: 'Merge Exposures (HDR look)', body: U.el('div', {}, [ui, info]), width: 440, buttons: [{ label: 'Cancel' }, { label: 'Merge', primary: true, run: async () => {
      S.store.set('fusion', vals);
      if (vals.align) PM.autoAlign(doc);
      const prog = S.Progress.start('Merging exposures');
      try {
        const rect = { x: 0, y: 0, w: doc.width, h: doc.height };
        const imgs = layers.map((l) => S.Layers.readRect(l.canvas, rect, 0));
        const out = await PM.fuse(imgs, doc.width, doc.height, { contrast: vals.contrast, saturation: vals.saturation, exposure: vals.exposure }, (k) => prog.set(k));
        doc.commit('Merge Exposures', () => {
          const c = U.createCanvas(doc.width, doc.height); c.getContext('2d').putImageData(out, 0, 0);
          const l = S.Layers.raster(doc, 'Merged exposure', c);
          doc.insertLayer(l, layers[layers.length - 1].id, 'above');
          layers.forEach((x) => { x.visible = false; x.version++; });
          doc.setActive(l.id);
        });
        S.toast('Merged ' + layers.length + ' exposures into a new layer (the originals are hidden, not deleted)');
      } catch (e) { console.error(e); S.toast('Merge failed: ' + (e && e.message || e)); } finally { prog.done(); }
    } }] });
  };

  /* ---------- Apply Image ---------- */
  PM.applyImageDialog = function (doc) {
    const target = doc.activeLayer();
    if (!target || target.type !== 'raster' || target.embed) { S.toast('Apply Image needs a pixel layer as the target'); return; }
    const sources = []; doc.walk((l) => { if ((l.type === 'raster' && !l.embed) || l.type === 'text' || l.type === 'shape') sources.push(l); });
    const opts = [{ value: '__merged', label: 'Merged (everything visible)' }].concat(sources.map((l) => ({ value: l.id, label: l.name })));
    const last = S.store.get('applyImage', { channel: 'rgb', blend: 'normal', opacity: 100, invert: false, dest: 'pixels' });
    const defs = [
      { id: 'source', label: 'Source', type: 'select', default: sources.find((l) => l !== target) ? sources.find((l) => l !== target).id : '__merged', options: opts },
      { id: 'channel', label: 'Channel', type: 'select', default: last.channel, options: [{ value: 'rgb', label: 'RGB' }, { value: 'r', label: 'Red' }, { value: 'g', label: 'Green' }, { value: 'b', label: 'Blue' }, { value: 'l', label: 'Luminosity' }, { value: 'a', label: 'Transparency' }] },
      { id: 'invert', label: 'Invert source', type: 'checkbox', default: !!last.invert },
      { id: 'blend', label: 'Blending', type: 'select', default: last.blend, options: ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference', 'add', 'subtract', 'soft-light', 'hard-light'].map((b) => ({ value: b, label: b[0].toUpperCase() + b.slice(1).replace('-', ' ') })) },
      { id: 'opacity', label: 'Opacity', type: 'range', default: last.opacity, min: 0, max: 100, step: 1, unit: '%' },
      { id: 'dest', label: 'Apply to', type: 'select', default: target.mask ? last.dest : 'pixels', options: [{ value: 'pixels', label: 'Layer pixels' }].concat(target.mask ? [{ value: 'mask', label: 'Layer mask' }] : []) },
      { id: 'sel', label: 'Only inside the selection', type: 'checkbox', default: !!doc.selection },
    ];
    let vals = {}; defs.forEach((d) => (vals[d.id] = d.default));
    const ui = S.ParamUI.build(defs, vals, (v) => { vals = v; });
    S.Dialog.open({ title: 'Apply Image', body: ui, width: 420, buttons: [{ label: 'Cancel' }, { label: 'Apply', primary: true, run: () => {
      S.store.set('applyImage', { channel: vals.channel, blend: vals.blend, opacity: vals.opacity, invert: vals.invert, dest: vals.dest });
      doc.commit('Apply Image', () => PM.applyImage(doc, target, vals));
      S.toast('Applied image');
    } }] });
  };
  const BLEND = {
    normal: (a, b) => b, multiply: (a, b) => a * b / 255, screen: (a, b) => 255 - (255 - a) * (255 - b) / 255,
    overlay: (a, b) => (a < 128 ? 2 * a * b / 255 : 255 - 2 * (255 - a) * (255 - b) / 255), 'hard-light': (a, b) => (b < 128 ? 2 * a * b / 255 : 255 - 2 * (255 - a) * (255 - b) / 255),
    'soft-light': (a, b) => { const A = a / 255, B = b / 255; return 255 * ((1 - 2 * B) * A * A + 2 * B * A); },
    darken: (a, b) => Math.min(a, b), lighten: (a, b) => Math.max(a, b), difference: (a, b) => Math.abs(a - b), add: (a, b) => Math.min(255, a + b), subtract: (a, b) => Math.max(0, a - b),
  };
  PM.applyImage = function (doc, target, v) {
    const rect = { x: 0, y: 0, w: doc.width, h: doc.height }, W = doc.width, H = doc.height;
    let srcImg;
    if (v.source === '__merged') srcImg = S.Compositor.flatten(doc).getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H);
    else { const l = doc.findLayer(v.source); if (!l) return false; S.Layers.ensure(l, doc); srcImg = S.Layers.readRect(l.canvas, rect, 0); }
    const toMask = v.dest === 'mask' && target.mask;
    const dstImg = toMask ? S.Layers.readRect(target.mask.canvas, rect, S.Layers.maskOutside ? S.Layers.maskOutside(target.mask) : 0) : S.Layers.readRect(target.canvas, rect, 0);
    const s = srcImg.data, d = dstImg.data, sel = v.sel && doc.selection ? doc.selection.mask : null, f = BLEND[v.blend] || BLEND.normal, op = v.opacity / 100;
    for (let i = 0, j = 0; i < W * H; i++, j += 4) {
      let k = op; if (sel) k *= sel[i] / 255; if (!k) continue;
      let sr = s[j], sg = s[j + 1], sb = s[j + 2], sa = s[j + 3];
      if (v.channel === 'l' || v.channel === 'a' || v.channel === 'r' || v.channel === 'g' || v.channel === 'b') {
        const g = v.channel === 'l' ? 0.299 * sr + 0.587 * sg + 0.114 * sb : v.channel === 'a' ? sa : v.channel === 'r' ? sr : v.channel === 'g' ? sg : sb;
        sr = sg = sb = g; if (v.channel === 'a') sa = 255;
      }
      if (v.invert) { sr = 255 - sr; sg = 255 - sg; sb = 255 - sb; }
      if (toMask) { const cur = d[j + 3], nv = f(cur, sr); d[j + 3] = cur + (nv - cur) * k * (sa / 255); continue; }
      const da = d[j + 3];
      if (da === 0) { // nothing underneath: the source shows through at k × its own alpha
        d[j] = sr; d[j + 1] = sg; d[j + 2] = sb; d[j + 3] = sa * k; continue;
      }
      const kk = k * (sa / 255);
      d[j] = d[j] + (f(d[j], sr) - d[j]) * kk; d[j + 1] = d[j + 1] + (f(d[j + 1], sg) - d[j + 1]) * kk; d[j + 2] = d[j + 2] + (f(d[j + 2], sb) - d[j + 2]) * kk;
    }
    if (toMask) { const c = U.createCanvas(W, H); c.getContext('2d').putImageData(dstImg, 0, 0); target.mask = { ...target.mask, canvas: c, version: (target.mask.version || 0) + 1 }; }
    else { const c = U.createCanvas(W, H); c.getContext('2d').putImageData(dstImg, 0, 0); target.canvas = c; }
    target.version++; doc.bump(target);
    return true;
  };

  S.Cmd.register('layer.autoAlign', { label: 'Auto-Align Layers', run: () => PM.autoAlign(S.app.doc), enabled: () => !!S.app.doc });
  S.Cmd.register('layer.mergeExposures', { label: 'Merge Exposures (HDR look)…', run: () => PM.mergeExposuresDialog(S.app.doc), enabled: () => !!S.app.doc });
  S.Cmd.register('image.applyImage', { label: 'Apply Image…', run: () => PM.applyImageDialog(S.app.doc), enabled: () => !!S.app.doc });
})();
