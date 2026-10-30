/* =========================================================================
   Gesso — extra brushes: History Brush (paints a snapshot / the opened state back in) and Color Replacement
   (recolours only pixels similar to the one under the cursor, keeping their luminosity).
   Also: Filter ▸ Other ▸ Make Seamless, and the Palette panel (dominant colours of the image).
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util, B = S.Brush, T = S.Tools;
  const base = T.byId.patternStamp; // reuse the pattern-stamp pipeline (dab = brush tip × source image)

  /* ---------- history source images ---------- */
  const histCache = { key: null, canvas: null };
  function flattenState(doc, state) {
    const cur = doc.captureState();
    try { doc.restoreState(state); doc.invalidate(); S.Compositor.update(doc); return U.cloneCanvas(S.Compositor.flatten(doc)); }
    finally { doc.restoreState(cur); doc.invalidate(); S.Compositor.update(doc); }
  }
  B.historySources = function (doc) {
    const out = [{ value: 'open', label: 'Opened / created state' }];
    (doc.snapshots || []).forEach((s) => out.push({ value: s.id, label: s.name }));
    return out;
  };
  B.historySource = function (doc, which) {
    let state = null, key = doc.id + ':' + which;
    if (which === 'open') {
      if (doc._openFlat) return doc._openFlat; // captured when the document was opened (app/main.js)
      S.toast('No opened-state image for this document — take a snapshot in the History panel and paint from that');
      return null;
    }
    else { const s = (doc.snapshots || []).find((x) => x.id === which); if (!s) return null; state = s.state; }
    if (histCache.key === key && histCache.canvas) return histCache.canvas;
    const c = flattenState(doc, state); histCache.key = key; histCache.canvas = c; return c;
  };

  T.register(Object.assign({}, base, {
    id: 'historyBrush', name: 'History Brush', key: 'Y', icon: 'history', group: 'clone',
    opts: Object.assign(B.BRUSH_DEFAULTS ? B.BRUSH_DEFAULTS() : JSON.parse(JSON.stringify(base.opts)), { size: 50, hardness: 0.5, source: 'open', preset: 'Soft Round', opacity: 100 }),
    options(bar) {
      const ui = T.ui, o = this.opts, d = S.app.doc;
      base.options.call(Object.assign(Object.create(this), { opts: Object.assign({}, o, { pattern: 'checker' }) }), bar);
      // the pattern-stamp options added Pattern/Scale/Aligned: drop those three and add the source picker instead
      const extra = [...bar.querySelectorAll('.opt-sel, .opt-num, .opt-check')].slice(-3); extra.forEach((el) => el.remove());
      if (d) ui.select(bar, 'Paint from', o, 'source', B.historySources(d));
      bar.appendChild(U.el('span', { class: 'muted opt-hint' }, 'Paints the chosen earlier state back in — undo with a brush. Take snapshots in the History panel to add more sources.'));
    },
    beginStroke(st, info) {
      st.buf = U.scratch(st.W, st.H); st.color = '#000';
      const src = B.historySource(st.doc, this.opts.source || 'open');
      st.patSrc = src; st.dabTmp = U.createCanvas(4, 4); st.patOrigin = { x: 0, y: 0 };
      if (src) { st.pat = st.dabTmp.getContext('2d').createPattern(src, 'no-repeat'); }
      void info;
    },
  }));

  /* ---------- Color Replacement ---------- */
  const brushTool = T.byId.brush;
  T.register(Object.assign({}, brushTool, {
    id: 'colorReplace', name: 'Color Replacement', key: 'B', icon: 'colorReplace', group: 'brush',
    opts: Object.assign(JSON.parse(JSON.stringify(brushTool.opts)), { size: 40, hardness: 0.7, tolerance: 30, sampling: 'continuous', mode: 'color', preset: 'Medium Round' }),
    options(bar) {
      const ui = T.ui, o = this.opts;
      ui.num(bar, 'Size', o, 'size', 1, 2500, { unit: 'px' });
      ui.num(bar, 'Hardness', o, 'hardness', 0, 100, { unit: '%', scale: 100 });
      ui.num(bar, 'Tolerance', o, 'tolerance', 1, 100, { unit: '%' });
      ui.select(bar, 'Sampling', o, 'sampling', [{ value: 'continuous', label: 'Continuous (under the cursor)' }, { value: 'once', label: 'Once (first click)' }, { value: 'bg', label: 'Background swatch' }]);
      ui.select(bar, 'Mode', o, 'mode', [{ value: 'color', label: 'Color (hue + saturation)' }, { value: 'hue', label: 'Hue only' }, { value: 'saturation', label: 'Saturation only' }, { value: 'luminosity', label: 'Luminosity' }]);
      ui.num(bar, 'Opacity', o, 'opacity', 1, 100, { unit: '%' });
      bar.appendChild(U.el('span', { class: 'muted opt-hint' }, 'Recolours only pixels similar to the sampled one with the foreground colour — shading stays'));
    },
    beginStroke(st, info) {
      brushTool.beginStroke.call(this, st, info);
      st.sampled = null; st.sampleMode = this.opts.sampling;
      if (st.sampleMode === 'bg') st.sampled = hexRgb(S.app.bg);
      else if (info) st.sampled = sampleAt(st, info.x, info.y);
    },
    onMove(info, doc, cont) {
      const st = this.st;
      if (st && st.sampleMode === 'continuous') { const s = sampleAt(st, info.x, info.y); if (s) st.sampled = s; }
      return brushTool.onMove.call(this, info, doc, cont);
    },
    composite(st, R) {
      // st.buf holds the stroke coverage in the fg colour; turn it into a recolour of the snapshot limited by colour similarity
      const snap = S.Layers.readRect(st.edit.snapshot, R, 0), cov = st.buf.getContext('2d', { willReadFrequently: true }).getImageData(R.x, R.y, R.w, R.h);
      const out = new ImageData(R.w, R.h), o = out.data, s = snap.data, c = cov.data;
      const fg = hexRgb(S.app.fg), fgH = rgb2hsl(fg[0], fg[1], fg[2]), ref = st.sampled || fg, tol = this.opts.tolerance / 100 * 441, mode = this.opts.mode, op = this.opts.opacity / 100;
      for (let i = 0; i < o.length; i += 4) {
        const a = c[i + 3]; if (!a || !s[i + 3]) continue;
        const dr = s[i] - ref[0], dg = s[i + 1] - ref[1], db = s[i + 2] - ref[2], dist = Math.sqrt(dr * dr + dg * dg + db * db);
        if (dist > tol) continue;
        const soft = dist > tol * 0.7 ? 1 - (dist - tol * 0.7) / (tol * 0.3) : 1;
        const k = (a / 255) * op * soft;
        const h = rgb2hsl(s[i], s[i + 1], s[i + 2]);
        let nh = h;
        if (mode === 'color') nh = [fgH[0], fgH[1], h[2]]; else if (mode === 'hue') nh = [fgH[0], h[1], h[2]]; else if (mode === 'saturation') nh = [h[0], fgH[1], h[2]]; else nh = [h[0], h[1], fgH[2]];
        const rgb = hsl2rgb(nh[0], nh[1], nh[2]);
        o[i] = rgb[0]; o[i + 1] = rgb[1]; o[i + 2] = rgb[2]; o[i + 3] = Math.round(255 * k);
      }
      // write: snapshot + recolour (normal blend) through the selection, like the brush does
      const tc = st.target.canvas; S.Layers.growTo(tc, R, null, { x: 0, y: 0, w: st.W, h: st.H });
      const tmp = U.scratch(st.W, st.H, R), tx = tmp.getContext('2d'); tx.putImageData(out, R.x, R.y);
      if (st.sel) { tx.globalCompositeOperation = 'destination-in'; tx.drawImage(S.Sel.canvas(st.sel), 0, 0); tx.globalCompositeOperation = 'source-over'; }
      const tctx = tc.getContext('2d'); tctx.save(); tctx.setTransform(1, 0, 0, 1, -(tc.ox || 0), -(tc.oy || 0)); tctx.beginPath(); tctx.rect(R.x, R.y, R.w, R.h); tctx.clip();
      tctx.clearRect(R.x, R.y, R.w, R.h); U.blitRect(tctx, st.edit.snapshot, R); tctx.drawImage(tmp, R.x, R.y, R.w, R.h, R.x, R.y, R.w, R.h); tctx.restore();
      U.release(tmp);
    },
  }));
  function sampleAt(st, x, y) {
    const r = { x: Math.round(x), y: Math.round(y), w: 1, h: 1 }; if (r.x < 0 || r.y < 0 || r.x >= st.W || r.y >= st.H) return null;
    const d = S.Layers.readRect(st.edit.snapshot, r, 0).data; if (!d[3]) return null; return [d[0], d[1], d[2]];
  }
  function hexRgb(h) { h = (h || '#000').replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function rgb2hsl(r, g, b) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; if (mx === mn) return [0, 0, l]; const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [h / 6, s, l]; }
  function hsl2rgb(h, s, l) { if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; } const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; const f = (t) => { t = (t + 1) % 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; }; return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)]; }

  /* ---------- Make Seamless (offset + cross-fade of the wrapped edges) ---------- */
  if (window.ImageFX && ImageFX.register) ImageFX.register('filter', {
    id: 'makeSeamless', name: 'Make Seamless (tile)', category: 'Other',
    params: [{ id: 'blend', label: 'Blend width', type: 'range', default: 25, min: 2, max: 50, step: 1, unit: '%' }],
    apply(img, p) {
      // blend each edge into its mirror image so opposite edges end up identical (both become the average)
      const w = img.width, h = img.height, d = img.data, out = new ImageData(w, h), o = out.data;
      const bw = Math.max(1, Math.round(w * p.blend / 100)), bh = Math.max(1, Math.round(h * p.blend / 100));
      for (let y = 0; y < h; y++) {
        const ey = Math.min(y, h - 1 - y), fy = ey < bh ? 0.5 * (1 - ey / bh) : 0, my = h - 1 - y;
        for (let x = 0; x < w; x++) {
          const ex = Math.min(x, w - 1 - x), fx = ex < bw ? 0.5 * (1 - ex / bw) : 0, mx = w - 1 - x;
          const i0 = (y * w + x) * 4, ix = (y * w + mx) * 4, iy = (my * w + x) * 4, ixy = (my * w + mx) * 4;
          const w0 = (1 - fx) * (1 - fy), wx = fx * (1 - fy), wy = (1 - fx) * fy, wxy = fx * fy;
          for (let c = 0; c < 4; c++) o[i0 + c] = d[i0 + c] * w0 + d[ix + c] * wx + d[iy + c] * wy + d[ixy + c] * wxy;
        }
      }
      return out;
    },
  });

  /* ---------- Palette panel ---------- */
  function extractPalette(canvas, n) {
    const w = canvas.width, h = canvas.height, k = Math.max(1, Math.ceil(Math.sqrt((w * h) / 40000)));
    const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data, px = [];
    for (let y = 0; y < h; y += k) for (let x = 0; x < w; x += k) { const i = (y * w + x) * 4; if (d[i + 3] > 128) px.push([d[i], d[i + 1], d[i + 2]]); }
    if (!px.length) return [];
    // k-means++ seeded, a few iterations
    const cents = [px[Math.floor(Math.random() * px.length)]];
    while (cents.length < n) { let best = null, bd = -1; for (let t = 0; t < 200; t++) { const p = px[Math.floor(Math.random() * px.length)]; let md = 1e9; for (const c of cents) { const dd = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (dd < md) md = dd; } if (md > bd) { bd = md; best = p; } } cents.push(best.slice()); }
    const assign = new Int32Array(px.length);
    for (let it = 0; it < 8; it++) {
      for (let i = 0; i < px.length; i++) { let bi = 0, bd = 1e12; for (let c = 0; c < cents.length; c++) { const dd = (px[i][0] - cents[c][0]) ** 2 + (px[i][1] - cents[c][1]) ** 2 + (px[i][2] - cents[c][2]) ** 2; if (dd < bd) { bd = dd; bi = c; } } assign[i] = bi; }
      const sum = cents.map(() => [0, 0, 0, 0]);
      for (let i = 0; i < px.length; i++) { const s = sum[assign[i]]; s[0] += px[i][0]; s[1] += px[i][1]; s[2] += px[i][2]; s[3]++; }
      sum.forEach((s, c) => { if (s[3]) cents[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
    }
    const counts = cents.map(() => 0); for (let i = 0; i < px.length; i++) counts[assign[i]]++;
    return cents.map((c, i) => ({ rgb: c.map(Math.round), share: counts[i] / px.length })).filter((c) => c.share > 0).sort((a, b) => b.share - a.share);
  }
  const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  S.Panels.register({
    id: 'palette', title: 'Palette', icon: 'swatches', defaultNear: 'histogram', events: ['doc:switched', 'composite:updated', 'selection:changed'],
    build(body) {
      body.classList.add('palette-panel');
      const head = U.el('div', { class: 'row palette-head' });
      const nSel = U.el('select', {}, [5, 8, 12, 16].map((n) => U.el('option', { value: n }, n + ' colours')));
      nSel.value = S.store.get('palette.n', 8);
      const refresh = U.el('button', { class: 'btn btn-sm' }, 'Extract');
      const exp = U.el('button', { class: 'icon-btn', html: S.icon('export'), 'data-tip': 'Export palette (GPL / CSS / JSON)', 'data-tip-pos': 'top' });
      head.append(nSel, refresh, U.el('div', { style: { flex: 1 } }), exp);
      const grid = U.el('div', { class: 'palette-grid' });
      const hint = U.el('div', { class: 'muted panel-hint' }, 'Dominant colours of the image (or the selection). Click a swatch to set the foreground colour, Alt-click for the background.');
      body.append(head, grid, hint);
      let pal = [];
      function run() {
        const d = S.app.doc; if (!d) { grid.innerHTML = ''; return; }
        S.store.set('palette.n', +nSel.value);
        let src = S.Compositor.flatten(d);
        if (d.selection) { const b = d.selection.bounds, c = U.createCanvas(b.w, b.h), x = c.getContext('2d'); x.drawImage(src, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h); x.globalCompositeOperation = 'destination-in'; x.drawImage(S.Sel.canvas(d.selection), -b.x, -b.y); src = c; }
        pal = extractPalette(src, +nSel.value);
        grid.innerHTML = '';
        pal.forEach((c) => {
          const sw = U.el('div', { class: 'palette-sw', title: hex(c.rgb) + ' · ' + Math.round(c.share * 100) + '%' });
          sw.style.background = hex(c.rgb); sw.style.flexBasis = Math.max(8, Math.round(c.share * 100)) + '%';
          sw.appendChild(U.el('span', {}, hex(c.rgb)));
          sw.onclick = (e) => { if (e.altKey) S.App.setBg ? S.App.setBg(hex(c.rgb)) : null; else S.App.setFg(hex(c.rgb)); };
          grid.appendChild(sw);
        });
      }
      refresh.onclick = run; nSel.onchange = run;
      exp.onclick = () => {
        if (!pal.length) run(); if (!pal.length) return;
        const d = S.app.doc, name = d ? d.name.replace(/\.[^.]+$/, '') : 'palette';
        S.Dialog.choice('Export the palette as…', ['GIMP palette (.gpl)', 'CSS variables', 'JSON'], 'Export Palette').then((i) => {
          if (i == null || i < 0) return;
          let text, fname, mime = 'text/plain';
          if (i === 0) { text = 'GIMP Palette\nName: ' + name + '\nColumns: 8\n#\n' + pal.map((c) => c.rgb.map((v) => String(v).padStart(3, ' ')).join(' ') + '\t' + hex(c.rgb)).join('\n') + '\n'; fname = name + '.gpl'; }
          else if (i === 1) { text = ':root {\n' + pal.map((c, k) => '  --color-' + (k + 1) + ': ' + hex(c.rgb) + '; /* ' + Math.round(c.share * 100) + '% */').join('\n') + '\n}\n'; fname = name + '-palette.css'; mime = 'text/css'; }
          else { text = JSON.stringify(pal.map((c) => ({ hex: hex(c.rgb), rgb: c.rgb, share: Math.round(c.share * 1000) / 1000 })), null, 2); fname = name + '-palette.json'; mime = 'application/json'; }
          U.downloadBlob(new Blob([text], { type: mime }), fname); S.toast('Exported ' + fname);
        });
      };
      let tmr = null;
      return { update: () => { if (!S.app.doc) { grid.innerHTML = ''; pal = []; } } , extract: run, get palette() { return pal; }, autoOnce: () => { clearTimeout(tmr); tmr = setTimeout(run, 50); } };
    },
  });
})();
