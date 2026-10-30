/* =========================================================================
   Gesso — Patch Fill (content fill from surroundings, patch-match style), the Remove tool and the Patch tool.

   SmartFill.inpaint(img, hole) fills the pixels where hole > 0 with texture synthesised from the rest of
   the image: coarse-to-fine; at each level an approximate nearest-neighbour field (random init,
   propagation, random search — the PatchMatch idea) maps every hole pixel to a 7×7 source patch that
   lies fully in the known area, and the hole is rebuilt by averaging ("voting") the overlapping patches.
   The coarsest level starts from a diffusion fill, finer levels from the upsampled coarser result.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util;
  const SF = (S.SmartFill = {});
  const PR = 3; // patch radius (7×7 patches)

  function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  /** downsample an RGBA Float32 plane image and a mask by 2 (box) */
  function down(img, w, h, mask) {
    const w2 = Math.max(1, w >> 1), h2 = Math.max(1, h >> 1), o = new Float32Array(w2 * h2 * 4), m = new Uint8Array(w2 * h2);
    for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0, hole = 0;
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
        const xx = Math.min(w - 1, x * 2 + i), yy = Math.min(h - 1, y * 2 + j), k = (yy * w + xx) * 4;
        r += img[k]; g += img[k + 1]; b += img[k + 2]; a += img[k + 3]; n++; if (mask[yy * w + xx]) hole++;
      }
      const q = (y * w2 + x) * 4; o[q] = r / n; o[q + 1] = g / n; o[q + 2] = b / n; o[q + 3] = a / n;
      m[y * w2 + x] = hole ? 1 : 0; // any hole pixel makes the coarse pixel unknown
    }
    return { img: o, w: w2, h: h2, mask: m };
  }
  /** bilinear upsample of the hole area of `small` into `big` (only where big.mask) */
  function upFill(small, big) {
    const { w, h, img, mask } = big, sw = small.w, sh = small.h, si = small.img;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / 2 - 0.5)), fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
      const k = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const v00 = si[(y0 * sw + x0) * 4 + c], v10 = si[(y0 * sw + x1) * 4 + c], v01 = si[(y1 * sw + x0) * 4 + c], v11 = si[(y1 * sw + x1) * 4 + c];
        img[k + c] = (v00 * (1 - ax) + v10 * ax) * (1 - ay) + (v01 * (1 - ax) + v11 * ax) * ay;
      }
    }
  }
  /** diffusion fill: repeatedly average known/filled neighbours into the hole (coarsest level seed) */
  function diffuse(L) {
    const { w, h, img, mask } = L;
    const idx = []; for (let i = 0; i < mask.length; i++) if (mask[i]) idx.push(i);
    if (!idx.length) return;
    // start from the mean of the boundary
    let mr = 0, mg = 0, mb = 0, ma = 0, n = 0;
    for (const i of idx) { const x = i % w, y = (i / w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h || mask[yy * w + xx]) continue; const k = (yy * w + xx) * 4; mr += img[k]; mg += img[k + 1]; mb += img[k + 2]; ma += img[k + 3]; n++; } }
    if (n) for (const i of idx) { img[i * 4] = mr / n; img[i * 4 + 1] = mg / n; img[i * 4 + 2] = mb / n; img[i * 4 + 3] = ma / n; }
    const passes = Math.min(400, Math.max(40, Math.round(Math.sqrt(idx.length) * 3)));
    for (let p = 0; p < passes; p++) {
      for (let t = 0; t < idx.length; t++) {
        const i = p & 1 ? idx[idx.length - 1 - t] : idx[t], x = i % w, y = (i / w) | 0;
        let r = 0, g = 0, b = 0, a = 0, c = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const k = (yy * w + xx) * 4; r += img[k]; g += img[k + 1]; b += img[k + 2]; a += img[k + 3]; c++; }
        if (c) { img[i * 4] = r / c; img[i * 4 + 1] = g / c; img[i * 4 + 2] = b / c; img[i * 4 + 3] = a / c; }
      }
    }
  }
  /** one PatchMatch + vote round on level L; nnf persists between rounds */
  function patchMatch(L, iters, R, seed) {
    const { w, h, img, mask } = L;
    // valid source centres: patch fully inside the image and free of hole pixels
    const valid = new Uint8Array(w * h); const srcList = [];
    for (let y = PR; y < h - PR; y++) for (let x = PR; x < w - PR; x++) {
      let ok = true;
      for (let j = -PR; j <= PR && ok; j++) for (let i = -PR; i <= PR; i++) if (mask[(y + j) * w + x + i]) { ok = false; break; }
      if (ok) { valid[y * w + x] = 1; srcList.push(y * w + x); }
    }
    if (!srcList.length) return false;
    const holes = []; for (let i = 0; i < mask.length; i++) if (mask[i]) holes.push(i);
    const rand = rng(seed);
    const nnf = L.nnf || (L.nnf = new Int32Array(w * h).fill(-1)), cost = new Float32Array(w * h).fill(1e30);
    const dist = (p, q, best) => { // SSD over the patch (target pixels at p vs source at q), early exit
      const px = p % w, py = (p / w) | 0, qx = q % w, qy = (q / w) | 0;
      let d = 0;
      for (let j = -PR; j <= PR; j++) {
        const ty = py + j, sy = qy + j; if (ty < 0 || ty >= h) continue;
        for (let i = -PR; i <= PR; i++) {
          const tx = px + i; if (tx < 0 || tx >= w) continue;
          const a = (ty * w + tx) * 4, b = (sy * w + qx + i) * 4;
          const dr = img[a] - img[b], dg = img[a + 1] - img[b + 1], db = img[a + 2] - img[b + 2], da = img[a + 3] - img[b + 3];
          d += dr * dr + dg * dg + db * db + da * da * 0.5;
        }
        if (d > best) return d;
      }
      return d;
    };
    // init: keep previous field where still valid, else random
    for (const p of holes) { let q = nnf[p]; if (q < 0 || !valid[q]) q = srcList[(rand() * srcList.length) | 0]; nnf[p] = q; cost[p] = dist(p, q, 1e30); }
    const tryQ = (p, q) => { if (q < 0 || q >= w * h || !valid[q]) return; const c = dist(p, q, cost[p]); if (c < cost[p]) { cost[p] = c; nnf[p] = q; } };
    const maxR = Math.max(w, h);
    for (let it = 0; it < iters; it++) {
      const rev = it & 1;
      for (let t = 0; t < holes.length; t++) {
        const p = rev ? holes[holes.length - 1 - t] : holes[t], px = p % w;
        // propagation from the already-processed neighbours
        const dxs = rev ? 1 : -1;
        if (px + dxs >= 0 && px + dxs < w) { const n = p + dxs; if (mask[n] && nnf[n] >= 0) tryQ(p, nnf[n] - dxs); }
        const n2 = p + dxs * w; if (n2 >= 0 && n2 < w * h && mask[n2] && nnf[n2] >= 0) tryQ(p, nnf[n2] - dxs * w);
        // random search around the current best
        let rad = maxR; const q0 = nnf[p], qx = q0 % w, qy = (q0 / w) | 0;
        while (rad >= 1) { const x = Math.round(qx + (rand() * 2 - 1) * rad), y = Math.round(qy + (rand() * 2 - 1) * rad); if (x >= 0 && y >= 0 && x < w && y < h) tryQ(p, y * w + x); rad = rad / 2; }
      }
    }
    // vote: every hole pixel is the average of the overlapping source patches' pixels
    const acc = new Float32Array(holes.length * 5);
    const hidx = new Int32Array(w * h).fill(-1); holes.forEach((p, i) => (hidx[p] = i));
    for (const p of holes) {
      const q = nnf[p], px = p % w, py = (p / w) | 0, qx = q % w, qy = (q / w) | 0;
      for (let j = -PR; j <= PR; j++) for (let i = -PR; i <= PR; i++) {
        const tx = px + i, ty = py + j; if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
        const hi = hidx[ty * w + tx]; if (hi < 0) continue;
        const s = ((qy + j) * w + qx + i) * 4, wgt = 1 / (1 + Math.abs(i) + Math.abs(j));
        acc[hi * 5] += img[s] * wgt; acc[hi * 5 + 1] += img[s + 1] * wgt; acc[hi * 5 + 2] += img[s + 2] * wgt; acc[hi * 5 + 3] += img[s + 3] * wgt; acc[hi * 5 + 4] += wgt;
      }
    }
    holes.forEach((p, i) => { const n = acc[i * 5 + 4]; if (n) { img[p * 4] = acc[i * 5] / n; img[p * 4 + 1] = acc[i * 5 + 1] / n; img[p * 4 + 2] = acc[i * 5 + 2] / n; img[p * 4 + 3] = acc[i * 5 + 3] / n; } });
    void R;
    return true;
  }

  /**
   * Fill the pixels of `img` (ImageData) where hole[i] > 127.  Returns a new ImageData (or null when cancelled).
   * opts.seed for repeatable results; opts.progress(fraction, note) is called between rounds and may return
   * false to cancel; the work yields to the event loop between rounds so the UI stays alive.
   */
  SF.inpaint = async function (img, hole, opts) {
    opts = opts || {};
    const w = img.width, h = img.height, src = img.data;
    const base = new Float32Array(w * h * 4); for (let i = 0; i < base.length; i++) base[i] = src[i];
    const mask = new Uint8Array(w * h); let any = 0; for (let i = 0; i < mask.length; i++) if (hole[i] > 127) { mask[i] = 1; any++; }
    if (!any) return img;
    // pyramid down to ~48 px or until the hole vanishes
    const levels = [{ img: base, w, h, mask }];
    while (levels[levels.length - 1].w > 48 && levels[levels.length - 1].h > 48 && levels.length < 6) {
      const L = levels[levels.length - 1], D = down(L.img, L.w, L.h, L.mask);
      if (!D.mask.some((m) => m)) break;
      levels.push(D);
    }
    const seed = opts.seed || 7;
    const steps = levels.reduce((a, L, li) => a + (li === 0 ? 3 : 2), 0); let step = 0;
    const report = (note) => { step++; return !opts.progress || opts.progress(step / (steps + 1), note) !== false; };
    for (let li = levels.length - 1; li >= 0; li--) {
      const L = levels[li];
      if (li === levels.length - 1) diffuse(L); else upFill(levels[li + 1], L);
      const rounds = li === 0 ? 3 : 2, iters = li === 0 ? 3 : 4;
      for (let r = 0; r < rounds; r++) {
        if (!patchMatch(L, iters, r, seed + li * 31 + r)) break;
        if (!report('level ' + (levels.length - li) + '/' + levels.length)) return null;
        if (opts.sync !== true) await S.Progress.tick();
      }
    }
    const out = new ImageData(w, h), d = out.data;
    for (let i = 0; i < d.length; i++) d[i] = base[i];
    // keep the original outside the hole exactly
    for (let i = 0; i < mask.length; i++) if (!mask[i]) { d[i * 4] = src[i * 4]; d[i * 4 + 1] = src[i * 4 + 1]; d[i * 4 + 2] = src[i * 4 + 2]; d[i * 4 + 3] = src[i * 4 + 3]; }
    return out;
  };

  /**
   * Patch Fill the current selection on the paint target (Edit ▸ Fill ▸ Patch from surroundings).
   * opts.sample: 'layer' | 'all' (default: the layer, falling back to all layers when the layer is mostly
   * transparent around the hole).  Shows a cancellable progress bar; one history step when done.
   */
  SF.busy = false;
  SF.run = async function (doc, opts) {
    opts = opts || {};
    doc = doc || S.app.doc; if (!doc) return false;
    if (!doc.selection) { S.toast('Make a selection to fill'); return false; }
    if (SF.busy) { S.toast('A patch fill is already running'); return false; }
    const t = await S.FX.effectTarget(doc); if (!t || t.kind !== 'pixels') { if (t) S.toast('Patch Fill works on pixel layers'); return false; }
    const sel = doc.selection, b = sel.bounds, m = Math.max(24, Math.round(Math.max(b.w, b.h) * 0.6));
    let R = U.rectRound({ x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m });
    R = U.rectIntersect(R, { x: 0, y: 0, w: doc.width, h: doc.height }) || b;
    const sampleAll = opts.sample === 'all';
    const src = sampleAll ? S.Compositor.flatten(doc) : t.canvas;
    const img = S.Layers.readRect(src, R);
    // hole = selection (expanded by 1 px so antialiased edge pixels are rebuilt too)
    const hole = new Uint8ClampedArray(R.w * R.h), sm = sel.mask, W = doc.width;
    for (let y = 0; y < R.h; y++) for (let x = 0; x < R.w; x++) hole[y * R.w + x] = sm[(y + R.y) * W + x + R.x] > 0 ? 255 : 0;
    // with the layer as the source, transparent surroundings are useless: fall back to all layers automatically
    if (!sampleAll && !opts.sample) { let known = 0, opaque = 0; for (let i = 0; i < hole.length; i++) if (!hole[i]) { known++; if (img.data[i * 4 + 3] > 0) opaque++; } if (known && opaque / known < 0.5) return SF.run(doc, { ...opts, sample: 'all' }); }
    const t0 = performance.now();
    const layerId = t.layer.id, version0 = t.layer.version;
    const prog = S.Progress.start(opts.label || 'Patch fill');
    SF.busy = true;
    let out;
    try { out = await SF.inpaint(img, hole, { seed: opts.seed, progress: (f, note) => { prog.set(f, note); return !prog.cancelled; } }); }
    finally { SF.busy = false; prog.done(); }
    if (!out) { S.toast('Patch fill cancelled', 900); return false; }
    // the document may have changed meanwhile (another document, deleted layer, edited pixels): give up safely
    const l = doc.findLayer(layerId);
    if (!S.app.docs.includes(doc) || !l || l.version !== version0 || l.canvas !== t.canvas) { S.toast('Patch fill discarded — the layer changed while it was running'); return false; }
    // write only the hole pixels (feathered by the selection mask)
    const cur = S.Layers.readRect(t.canvas, R), cd = cur.data, od = out.data;
    for (let y = 0; y < R.h; y++) for (let x = 0; x < R.w; x++) { const i = y * R.w + x, k = sm[(y + R.y) * W + x + R.x] / 255; if (!k) continue; for (let c = 0; c < 4; c++) cd[i * 4 + c] = cd[i * 4 + c] + (od[i * 4 + c] - cd[i * 4 + c]) * k; }
    const edit = doc.beginPixelEdit(t);
    S.Layers.writeRect(t.canvas, cur, R);
    edit.end(opts.label || 'Patch Fill', R);
    doc.bump(t.layer, R); S.bus.emit('layers:changed', doc);
    if (opts.deselect) doc.setSelection(null, 'Deselect');
    S.toast((opts.label || 'Patch fill') + ' done in ' + Math.round(performance.now() - t0) + ' ms', 1200);
    return true;
  };
  SF.dialog = function () {
    const doc = S.app.doc; if (!doc || !doc.selection) { S.toast('Make a selection to fill'); return; }
    const st = S.store.get('smartfill', { sample: 'auto' });
    S.Dialog.form('Patch Fill', [
      { id: 'sample', label: 'Sample from', type: 'select', default: st.sample, options: [{ value: 'auto', label: 'Current layer (all layers if empty around)' }, { value: 'layer', label: 'Current layer' }, { value: 'all', label: 'All layers' }] },
      { id: 'note', type: 'note', label: 'Fills the selection with texture synthesised from its surroundings (patch matching, coarse to fine). Larger selections take longer; Esc cancels.' },
    ], st, (v) => { S.store.set('smartfill', v); setTimeout(() => SF.run(doc, { sample: v.sample === 'auto' ? undefined : v.sample }), 30); });
  };
  S.Cmd.register('edit.patchFill', { label: 'Patch Fill (from surroundings)…', key: 'Ctrl+Shift+F5', run: () => SF.dialog(), enabled: () => !!(S.app.doc && S.app.doc.selection && S.app.doc.activeLayer()) });

  /* ======================= Remove tool: lasso an object, it is filled from its surroundings ======================= */
  S.Tools.register({
    id: 'remove', name: 'Remove', key: 'J', icon: 'remove', group: 'heal', cursor: 'crosshair',
    opts: { expand: 3, sample: 'auto' },
    options(bar) {
      const ui = S.Tools.ui;
      ui.num(bar, 'Expand', this.opts, 'expand', 0, 40, { unit: 'px' });
      ui.select(bar, 'Sample', this.opts, 'sample', [{ value: 'auto', label: 'Current layer (auto)' }, { value: 'all', label: 'All layers' }]);
      bar.appendChild(U.el('span', { class: 'muted opt-hint' }, 'Draw around an object to remove it (texture is rebuilt from the surroundings) · Esc cancels'));
    },
    onDown(info) { this.pts = [[info.x, info.y]]; },
    onMove(info) { if (this.pts) { const l = this.pts[this.pts.length - 1]; if (Math.hypot(info.x - l[0], info.y - l[1]) > 0.7 / S.app.doc.view.zoom) this.pts.push([info.x, info.y]); } },
    async onUp(info, doc) {
      const pts = this.pts; this.pts = null;
      if (!pts || pts.length < 3) return;
      let sel = S.Sel.make(S.Sel.polygonMask(doc.width, doc.height, pts), doc.width, doc.height);
      if (!sel) return;
      if (this.opts.expand > 0) sel = S.Sel.expand(sel, this.opts.expand) || sel;
      const before = doc.captureState(), prevSel = doc.selection;
      doc.selection = sel; S.View.redraw();
      const ok = await SF.run(doc, { sample: this.opts.sample === 'all' ? 'all' : undefined, label: 'Remove' });
      if (!S.app.docs.includes(doc)) return;
      if (!ok) { doc.selection = prevSel; S.View.redraw(); return; }
      // the fill recorded its own pixel step; the temporary selection is restored silently
      doc.selection = prevSel; S.bus.emit('selection:changed', doc); S.View.redraw();
      void before;
    },
    onKey(e) { if (e.key === 'Escape' && this.pts) { this.pts = null; S.View.redraw(); return true; } return false; },
    drawOverlay(ctx) {
      if (!this.pts) return;
      ctx.beginPath(); this.pts.forEach((p, i) => { const [x, y] = S.View.toScreen(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.closePath(); ctx.fillStyle = 'rgba(240,145,58,.18)'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([4, 4]); ctx.strokeStyle = '#000'; ctx.stroke(); ctx.setLineDash([]);
    },
  });

  /* ======================= Patch tool ======================= */
  S.Tools.register({
    id: 'patch', name: 'Patch', key: 'J', icon: 'patch', group: 'heal', cursor: 'crosshair',
    opts: { mode: 'source', feather: 2 },
    options(bar) {
      const ui = S.Tools.ui;
      ui.select(bar, 'Patch', this.opts, 'mode', [{ value: 'source', label: 'Source (drag the selection onto good pixels)' }, { value: 'destination', label: 'Destination (drag a copy onto the flaw)' }]);
      ui.num(bar, 'Feather', this.opts, 'feather', 0, 50, { unit: 'px' });
      ui.sep(bar);
      ui.button(bar, 'Patch Fill…', () => SF.dialog());
      bar.appendChild(U.el('span', { class: 'muted opt-hint' }, 'Lasso an area, then drag it where it should sample from'));
    },
    onDown(info, doc) {
      const inside = doc.selection && info.x >= 0 && info.y >= 0 && info.x < doc.width && info.y < doc.height && doc.selection.mask[(info.y | 0) * doc.width + (info.x | 0)] > 127;
      if (inside) { this.drag = { x0: info.x, y0: info.y, dx: 0, dy: 0, sel: doc.selection }; return; }
      this.pts = [[info.x, info.y]];
    },
    onMove(info) {
      if (this.drag) { this.drag.dx = Math.round(info.x - this.drag.x0); this.drag.dy = Math.round(info.y - this.drag.y0); return; }
      if (this.pts) { const l = this.pts[this.pts.length - 1]; if (Math.hypot(info.x - l[0], info.y - l[1]) > 0.7 / S.app.doc.view.zoom) this.pts.push([info.x, info.y]); }
    },
    async onUp(info, doc) {
      if (this.pts) {
        const pts = this.pts; this.pts = null;
        if (pts.length < 3) { if (doc.selection) doc.setSelection(null, 'Deselect'); return; }
        doc.setSelection(S.Sel.make(S.Sel.polygonMask(doc.width, doc.height, pts), doc.width, doc.height), 'Patch Selection');
        return;
      }
      const d = this.drag; this.drag = null;
      if (!d || (!d.dx && !d.dy)) return;
      const t = await S.FX.effectTarget(doc); if (!t || t.kind !== 'pixels') { if (t) S.toast('Patch works on pixel layers'); return; }
      const sel = d.sel, b = sel.bounds, f = this.opts.feather;
      // destination rect / source rect (document space)
      const dstB = this.opts.mode === 'source' ? b : { x: b.x + d.dx, y: b.y + d.dy, w: b.w, h: b.h };
      const srcOff = this.opts.mode === 'source' ? { x: d.dx, y: d.dy } : { x: -d.dx, y: -d.dy };
      let R = U.rectRound({ x: dstB.x - f - 2, y: dstB.y - f - 2, w: dstB.w + 2 * f + 4, h: dstB.h + 2 * f + 4 });
      R = U.rectIntersect(R, { x: 0, y: 0, w: doc.width, h: doc.height }); if (!R) return;
      // coverage = the (feathered) selection placed at the destination
      let cov = sel; if (this.opts.mode === 'destination') cov = S.Sel.shift(sel, d.dx, d.dy); if (f > 0 && cov) cov = S.Sel.feather(cov, f) || cov;
      if (!cov) return;
      const srcC = U.createCanvas(R.w, R.h), sx = srcC.getContext('2d');
      const flat = S.Compositor.flatten(doc); // sample the picture as seen
      sx.drawImage(flat, R.x + srcOff.x, R.y + srcOff.y, R.w, R.h, 0, 0, R.w, R.h);
      sx.globalCompositeOperation = 'destination-in'; sx.drawImage(S.Sel.canvas(cov), -R.x, -R.y);
      S.healBlend(doc, t, R, srcC, Math.max(8, Math.min(60, Math.round(Math.max(b.w, b.h) / 4))), 'Patch');
      if (this.opts.mode === 'destination') doc.setSelection(cov, 'Patch');
    },
    onKey(e, doc) { if (e.key === 'Escape' && (this.pts || this.drag)) { this.pts = null; this.drag = null; S.View.redraw(); return true; } void doc; return false; },
    drawOverlay(ctx, doc) {
      if (this.pts) {
        ctx.beginPath(); this.pts.forEach((p, i) => { const [x, y] = S.View.toScreen(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([4, 4]); ctx.strokeStyle = '#000'; ctx.stroke(); ctx.setLineDash([]);
      }
      const d = this.drag; if (!d) return;
      const p = S.Sel.outline(d.sel), z = doc.view.zoom;
      ctx.save(); ctx.translate(doc.view.panX + d.dx * z, doc.view.panY + d.dy * z); ctx.scale(z, z);
      ctx.lineWidth = 1 / z; ctx.strokeStyle = '#f0913a'; ctx.stroke(p); ctx.setLineDash([4 / z, 4 / z]); ctx.strokeStyle = '#000'; ctx.stroke(p); ctx.restore();
      S.App.hud(ctx, S.View.mouse.sx + 14, S.View.mouse.sy + 14, (this.opts.mode === 'source' ? 'sample from here' : 'copy to here') + '  Δ' + d.dx + ',' + d.dy);
    },
  });
})();
