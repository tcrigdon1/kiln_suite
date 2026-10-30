/* =========================================================================
   Gesso — Select Subject and edge refinement (classical, no ML weights).

   Subject.select(doc, opts) → selection
     1. the picture is scaled down (≤ 220 px) and converted to Lab;
     2. saliency = colour distance to a background model fitted on the image border, times a soft
        centre prior; its upper range seeds "foreground", the border and the lowest range seed "background";
     3. GrabCut-style refinement: k-means colour models for FG / BG give per-pixel data costs, a contrast-
        weighted 4-neighbour smoothness term is solved with mean-field iterations (soft labels), and the models
        are re-fitted from the new labels — three rounds;
     4. the soft label field is brought back to full resolution with joint-bilateral upsampling (edge aware,
        guided by the full-size colours) and, optionally, refined in a band around the edge (Subject.refineBand)
        before it becomes a selection mask.
   Subject.refineBand(doc, img, alpha, radius) — "smart radius": inside a band of ±radius around the current
     edge, every pixel's opacity is re-estimated from the nearest definite inside / outside colours.
   Subject.decontaminate(img, alpha, radius) — replaces edge-pixel colours by the estimated foreground colour
     so semi-transparent fringes do not carry the old background.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util;
  const Sub = (S.Subject = {});

  /* ---------- colour ---------- */
  const lin = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; lin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  /** RGBA bytes → Lab planes (Float32Array ×3) */
  function toLab(d, n) {
    const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const r = lin[d[j]], g = lin[d[j + 1]], b = lin[d[j + 2]];
      const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = f(0.2126 * r + 0.7152 * g + 0.0722 * b), z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
      L[i] = 116 * y - 16; A[i] = 500 * (x - y); B[i] = 200 * (y - z);
    }
    return { L, A, B };
  }

  /* ---------- k-means colour model ---------- */
  function kmeans(lab, idx, k, iters) {
    k = Math.min(k, Math.max(1, idx.length));
    const cx = new Float32Array(k * 3), cnt = new Float32Array(k), varr = new Float32Array(k), wgt = new Float32Array(k);
    // init: spread by luminance quantiles
    const sorted = Array.from(idx).sort((a, b) => lab.L[a] - lab.L[b]);
    for (let c = 0; c < k; c++) { const i = sorted[Math.floor(((c + 0.5) / k) * sorted.length)]; cx[c * 3] = lab.L[i]; cx[c * 3 + 1] = lab.A[i]; cx[c * 3 + 2] = lab.B[i]; }
    const lab_ = new Int32Array(idx.length);
    for (let it = 0; it < iters; it++) {
      const acc = new Float32Array(k * 3); cnt.fill(0);
      for (let t = 0; t < idx.length; t++) {
        const i = idx[t]; let best = 0, bd = Infinity;
        for (let c = 0; c < k; c++) { const dl = lab.L[i] - cx[c * 3], da = lab.A[i] - cx[c * 3 + 1], db = lab.B[i] - cx[c * 3 + 2], d = dl * dl + da * da + db * db; if (d < bd) { bd = d; best = c; } }
        lab_[t] = best; acc[best * 3] += lab.L[i]; acc[best * 3 + 1] += lab.A[i]; acc[best * 3 + 2] += lab.B[i]; cnt[best]++;
      }
      for (let c = 0; c < k; c++) if (cnt[c]) { cx[c * 3] = acc[c * 3] / cnt[c]; cx[c * 3 + 1] = acc[c * 3 + 1] / cnt[c]; cx[c * 3 + 2] = acc[c * 3 + 2] / cnt[c]; }
    }
    varr.fill(0);
    for (let t = 0; t < idx.length; t++) { const i = idx[t], c = lab_[t]; const dl = lab.L[i] - cx[c * 3], da = lab.A[i] - cx[c * 3 + 1], db = lab.B[i] - cx[c * 3 + 2]; varr[c] += dl * dl + da * da + db * db; }
    for (let c = 0; c < k; c++) { varr[c] = Math.max(16, cnt[c] ? varr[c] / cnt[c] / 3 : 100); wgt[c] = Math.max(1e-3, cnt[c] / idx.length); }
    return { k, cx, varr, wgt };
  }
  /** negative log-likelihood (up to a constant) of pixel i under a model */
  function cost(model, lab, i) {
    let best = Infinity;
    for (let c = 0; c < model.k; c++) {
      const dl = lab.L[i] - model.cx[c * 3], da = lab.A[i] - model.cx[c * 3 + 1], db = lab.B[i] - model.cx[c * 3 + 2];
      const v = model.varr[c], d = (dl * dl + da * da + db * db) / (2 * v) + 1.5 * Math.log(v) - Math.log(model.wgt[c]);
      if (d < best) best = d;
    }
    return best;
  }

  /**
   * Core: soft foreground probability at low resolution.  img = ImageData (small). Returns Float32Array p (0..1).
   * opts.center 0..1 strength of the centre prior, opts.seedSel: optional low-res mask (Uint8) of a user hint
   */
  Sub.segmentSmall = function (img, opts) {
    opts = opts || {};
    const w = img.width, h = img.height, n = w * h, lab = toLab(img.data, n);
    // --- background model from the border
    const border = [];
    for (let x = 0; x < w; x++) { border.push(x, (h - 1) * w + x); }
    for (let y = 1; y < h - 1; y++) { border.push(y * w, y * w + w - 1); }
    const bgBorder = kmeans(lab, border, 6, 8);
    // --- saliency: distance to the border model × centre prior
    const sal = new Float32Array(n);
    const cx0 = (w - 1) / 2, cy0 = (h - 1) / 2, sx = w * 0.42, sy = h * 0.42, cs = opts.center == null ? 0.5 : opts.center;
    let smax = 0;
    for (let i = 0; i < n; i++) {
      let bd = Infinity;
      for (let c = 0; c < bgBorder.k; c++) { const dl = lab.L[i] - bgBorder.cx[c * 3], da = lab.A[i] - bgBorder.cx[c * 3 + 1], db = lab.B[i] - bgBorder.cx[c * 3 + 2]; const d = Math.sqrt(dl * dl + da * da + db * db); if (d < bd) bd = d; }
      const x = i % w, y = (i / w) | 0, dx = (x - cx0) / sx, dy = (y - cy0) / sy;
      const prior = Math.exp(-(dx * dx + dy * dy) / 2);
      sal[i] = bd * ((1 - cs) + cs * prior);
      if (sal[i] > smax) smax = sal[i];
    }
    if (smax <= 0) return new Float32Array(n).fill(0);
    // smooth the saliency a little (3×3 box, twice)
    for (let pass = 0; pass < 2; pass++) {
      const t = new Float32Array(n);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, c = 0; for (let j = -1; j <= 1; j++) for (let i2 = -1; i2 <= 1; i2++) { const xx = x + i2, yy = y + j; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; s += sal[yy * w + xx]; c++; } t[y * w + x] = s / c; }
      sal.set(t);
    }
    smax = 0; for (let i = 0; i < n; i++) if (sal[i] > smax) smax = sal[i];
    // --- seeds
    const fgSeed = [], bgSeed = [];
    const isBorder = new Uint8Array(n); for (const i of border) isBorder[i] = 1;
    const hi = smax * 0.55, lo = smax * 0.18;
    for (let i = 0; i < n; i++) {
      if (opts.seedSel && opts.seedSel[i] === 2) { fgSeed.push(i); continue; }
      if (opts.seedSel && opts.seedSel[i] === 1) { bgSeed.push(i); continue; }
      if (isBorder[i] || sal[i] < lo) bgSeed.push(i); else if (sal[i] > hi) fgSeed.push(i);
    }
    if (fgSeed.length < 20) { for (let i = 0; i < n; i++) if (sal[i] > smax * 0.35 && !isBorder[i]) fgSeed.push(i); }
    if (fgSeed.length < 20) return new Float32Array(n).fill(0);
    // --- pairwise weights (contrast sensitive)
    let beta = 0, cnt = 0;
    const diff = (i, j) => { const dl = lab.L[i] - lab.L[j], da = lab.A[i] - lab.A[j], db = lab.B[i] - lab.B[j]; return dl * dl + da * da + db * db; };
    for (let i = 0; i < n; i++) { const x = i % w; if (x < w - 1) { beta += diff(i, i + 1); cnt++; } if (i + w < n) { beta += diff(i, i + w); cnt++; } }
    beta = cnt ? beta / cnt : 1; beta = 1 / (2 * Math.max(1, beta));
    const wR = new Float32Array(n), wD = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i % w; wR[i] = x < w - 1 ? Math.exp(-beta * diff(i, i + 1)) : 0; wD[i] = i + w < n ? Math.exp(-beta * diff(i, i + w)) : 0; }
    // --- GrabCut-style rounds
    let p = new Float32Array(n);
    for (const i of fgSeed) p[i] = 1;
    const lambda = opts.smooth == null ? 3.0 : opts.smooth;
    let fgIdx = fgSeed, bgIdx = bgSeed;
    const dcost = new Float32Array(n);
    for (let round = 0; round < 3; round++) {
      const fgM = kmeans(lab, fgIdx, 5, 6), bgM = kmeans(lab, bgIdx, 5, 6);
      for (let i = 0; i < n; i++) {
        let d = cost(bgM, lab, i) - cost(fgM, lab, i); // > 0 favours foreground
        // weak saliency / centre prior to break ties
        d += (sal[i] / smax - 0.3) * 1.2;
        if (isBorder[i]) d -= 6;
        if (opts.seedSel) { if (opts.seedSel[i] === 2) d += 12; else if (opts.seedSel[i] === 1) d -= 12; }
        dcost[i] = U.clamp(d, -12, 12);
      }
      // mean-field iterations on the soft label
      for (let it = 0; it < 12; it++) {
        const q = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const x = i % w;
          let msg = 0;
          if (x > 0) msg += wR[i - 1] * (2 * p[i - 1] - 1);
          if (x < w - 1) msg += wR[i] * (2 * p[i + 1] - 1);
          if (i >= w) msg += wD[i - w] * (2 * p[i - w] - 1);
          if (i + w < n) msg += wD[i] * (2 * p[i + w] - 1);
          const e = dcost[i] + lambda * msg;
          q[i] = 1 / (1 + Math.exp(-e));
        }
        p = q;
      }
      // re-seed from the labels for the next round
      fgIdx = []; bgIdx = [];
      for (let i = 0; i < n; i++) { if (p[i] > 0.6) fgIdx.push(i); else if (p[i] < 0.4) bgIdx.push(i); }
      if (fgIdx.length < 20 || bgIdx.length < 20) break;
    }
    // keep the connected components that are salient enough: drop small specks far from the main blob
    Sub.cleanComponents(p, w, h);
    return p;
  };

  /** Remove tiny foreground islands (< 2 % of the largest) and tiny holes */
  Sub.cleanComponents = function (p, w, h) {
    const n = w * h, lab_ = new Int32Array(n).fill(-1), sizes = [];
    const stack = [];
    for (let s = 0; s < n; s++) {
      if (lab_[s] >= 0 || p[s] < 0.5) continue;
      const id = sizes.length; let size = 0; stack.push(s); lab_[s] = id;
      while (stack.length) {
        const i = stack.pop(); size++;
        const x = i % w;
        const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
        for (const j of nb) if (j >= 0 && j < n && lab_[j] < 0 && p[j] >= 0.5) { lab_[j] = id; stack.push(j); }
      }
      sizes.push(size);
    }
    if (!sizes.length) return;
    const max = Math.max(...sizes);
    for (let i = 0; i < n; i++) if (lab_[i] >= 0 && sizes[lab_[i]] < Math.max(8, max * 0.02)) p[i] = 0.05;
  };

  /**
   * Joint-bilateral upsampling of a low-res probability field to a full-res alpha (0..1), guided by colours.
   */
  Sub.upsample = function (p, sw, sh, img) {
    const W = img.width, H = img.height, d = img.data, out = new Float32Array(W * H);
    // low-res mean colour per cell (for the range weight) — approximate with the full-res pixel at the cell centre
    const kx = sw / W, ky = sh / H, sig2 = 2 * 18 * 18;
    const lowC = new Float32Array(sw * sh * 3);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const fx = Math.min(W - 1, Math.round((x + 0.5) / kx - 0.5)), fy = Math.min(H - 1, Math.round((y + 0.5) / ky - 0.5)), q = (fy * W + fx) * 4, o = (y * sw + x) * 3;
      lowC[o] = d[q]; lowC[o + 1] = d[q + 1]; lowC[o + 2] = d[q + 2];
    }
    for (let y = 0; y < H; y++) {
      const gy = (y + 0.5) * ky - 0.5, y0 = Math.max(0, Math.floor(gy)), y1 = Math.min(sh - 1, y0 + 1), ay = U.clamp(gy - y0, 0, 1);
      for (let x = 0; x < W; x++) {
        const gx = (x + 0.5) * kx - 0.5, x0 = Math.max(0, Math.floor(gx)), x1 = Math.min(sw - 1, x0 + 1), ax = U.clamp(gx - x0, 0, 1);
        const q = (y * W + x) * 4, r = d[q], g = d[q + 1], b = d[q + 2];
        let num = 0, den = 0;
        for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
          const lx = i ? x1 : x0, ly = j ? y1 : y0, li = ly * sw + lx, o = li * 3;
          const ws = (i ? ax : 1 - ax) * (j ? ay : 1 - ay);
          const dr = r - lowC[o], dg = g - lowC[o + 1], db = b - lowC[o + 2];
          const wgt = ws * (0.08 + Math.exp(-(dr * dr + dg * dg + db * db) / sig2));
          num += wgt * p[li]; den += wgt;
        }
        out[y * W + x] = den ? num / den : 0;
      }
    }
    return out;
  };

  /**
   * Smart radius: within ±radius of the alpha 0.5 contour, recompute alpha from the nearest definite inside and
   * outside colours (sampled along a ring of directions), then smooth the band.  alpha is modified in place.
   */
  Sub.refineBand = function (img, alpha, radius) {
    const W = img.width, H = img.height, d = img.data, n = W * H, R = Math.max(1, Math.round(radius));
    const band = new Uint8Array(n);
    // mark pixels whose neighbourhood (±R) contains both inside and outside: cheap test via a 2R box of min/max
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; let lo = 1, hi = 0;
      for (let j = -R; j <= R; j += Math.max(1, R >> 2)) { const yy = y + j; if (yy < 0 || yy >= H) continue; for (let k = -R; k <= R; k += Math.max(1, R >> 2)) { const xx = x + k; if (xx < 0 || xx >= W) continue; const a = alpha[yy * W + xx]; if (a < lo) lo = a; if (a > hi) hi = a; } }
      if (lo < 0.25 && hi > 0.75) band[i] = 1;
    }
    const out = new Float32Array(alpha);
    const dirs = 16, cs = [], sn = []; for (let k = 0; k < dirs; k++) { cs.push(Math.cos((k / dirs) * Math.PI * 2)); sn.push(Math.sin((k / dirs) * Math.PI * 2)); }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!band[i]) continue;
      const q = i * 4, r = d[q], g = d[q + 1], b = d[q + 2];
      // nearest definite FG and BG colours along the rays
      let fr = 0, fg = 0, fb = 0, fn = 0, br = 0, bg = 0, bb = 0, bn = 0;
      for (let k = 0; k < dirs; k++) {
        let gotF = false, gotB = false;
        for (let t = 1; t <= R * 2 && !(gotF && gotB); t++) {
          const xx = Math.round(x + cs[k] * t), yy = Math.round(y + sn[k] * t); if (xx < 0 || yy < 0 || xx >= W || yy >= H) break;
          const j = yy * W + xx, a = alpha[j], qq = j * 4;
          if (!gotF && a > 0.9) { const wgt = 1 / t; fr += d[qq] * wgt; fg += d[qq + 1] * wgt; fb += d[qq + 2] * wgt; fn += wgt; gotF = true; }
          if (!gotB && a < 0.1) { const wgt = 1 / t; br += d[qq] * wgt; bg += d[qq + 1] * wgt; bb += d[qq + 2] * wgt; bn += wgt; gotB = true; }
        }
      }
      if (!fn || !bn) continue;
      fr /= fn; fg /= fn; fb /= fn; br /= bn; bg /= bn; bb /= bn;
      // project the colour onto the FG–BG line
      const vx = fr - br, vy = fg - bg, vz = fb - bb, L2 = vx * vx + vy * vy + vz * vz;
      if (L2 < 100) continue; // colours too similar: keep the geometric alpha
      const t = ((r - br) * vx + (g - bg) * vy + (b - bb) * vz) / L2;
      out[i] = U.clamp(t, 0, 1) * 0.7 + alpha[i] * 0.3;
    }
    // light smoothing inside the band
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; if (!band[i]) continue; alpha[i] = (out[i] * 4 + out[i - 1] + out[i + 1] + out[i - W] + out[i + W]) / 8; }
    return band;
  };

  /** Replace colours of semi-transparent pixels by the estimated foreground colour (in place on img) */
  Sub.decontaminate = function (img, alpha, radius) {
    const W = img.width, H = img.height, d = img.data, R = Math.max(2, Math.round(radius || 4));
    const src = new Uint8ClampedArray(d);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, a = alpha[i]; if (a <= 0.02 || a >= 0.98) continue;
      // mean of nearby definite foreground colours
      let r = 0, g = 0, b = 0, n = 0;
      for (let j = -R; j <= R; j++) for (let k = -R; k <= R; k++) { const xx = x + k, yy = y + j; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const jj = yy * W + xx; if (alpha[jj] > 0.95) { const q = jj * 4, w = 1 / (1 + Math.abs(j) + Math.abs(k)); r += src[q] * w; g += src[q + 1] * w; b += src[q + 2] * w; n += w; } }
      if (!n) continue;
      const q = i * 4;
      d[q] = r / n; d[q + 1] = g / n; d[q + 2] = b / n;
    }
  };

  /** Full-resolution image used for selection (all visible layers, or the active layer) */
  function sourceImage(doc, layerOnly) { return S.sampleImage(doc, !layerOnly); }

  /**
   * Select the subject of the document (or of the active layer).  opts: { layerOnly, center, smooth, radius,
   * softness, seedSel (document-size Uint8: 2 = must be subject, 1 = must be background) }.  Returns a selection or null.
   */
  Sub.select = function (doc, opts) {
    opts = opts || {};
    const img = sourceImage(doc, opts.layerOnly);
    const W = img.width, H = img.height;
    const k = Math.min(1, 220 / Math.max(W, H)), sw = Math.max(8, Math.round(W * k)), sh = Math.max(8, Math.round(H * k));
    const full = U.createCanvas(W, H); full.getContext('2d').putImageData(img, 0, 0);
    const small = document.createElement('canvas'); small.width = sw; small.height = sh;
    const sx = small.getContext('2d', { willReadFrequently: true }); sx.imageSmoothingQuality = 'high'; sx.drawImage(full, 0, 0, sw, sh);
    const simg = sx.getImageData(0, 0, sw, sh);
    // transparent pixels are background
    let seedSel = null;
    if (opts.seedSel) { seedSel = new Uint8Array(sw * sh); for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) seedSel[y * sw + x] = opts.seedSel[Math.min(H - 1, Math.round((y + 0.5) / k)) * W + Math.min(W - 1, Math.round((x + 0.5) / k))]; }
    for (let i = 0; i < sw * sh; i++) if (simg.data[i * 4 + 3] < 40) { if (!seedSel) seedSel = new Uint8Array(sw * sh); seedSel[i] = 1; }
    const p = Sub.segmentSmall(simg, { center: opts.center, smooth: opts.smooth, seedSel });
    let any = false; for (let i = 0; i < p.length; i++) if (p[i] > 0.5) { any = true; break; }
    if (!any) return null;
    const alpha = Sub.upsample(p, sw, sh, img);
    if (opts.radius > 0) Sub.refineBand(img, alpha, opts.radius);
    const soft = opts.softness == null ? 1.5 : opts.softness; // width of the 0→255 ramp in alpha units around 0.5
    const mask = new Uint8ClampedArray(W * H), kk = 255 / Math.max(0.05, soft * 0.4);
    for (let i = 0; i < mask.length; i++) { mask[i] = U.clamp((alpha[i] - 0.5) * kk + 128, 0, 255); if (img.data[i * 4 + 3] < 8) mask[i] = 0; }
    return S.Sel.make(mask, W, H);
  };

  /* ---------- commands ---------- */
  S.Cmd.register('select.subject', { label: 'Select Subject', key: 'Ctrl+Alt+Shift+A', run: () => {
    const doc = S.app.doc; if (!doc) return;
    const prog = S.Progress.start('Select Subject', { cancellable: false });
    setTimeout(() => {
      try {
        const sel = Sub.select(doc, { radius: S.store.get('subject.radius', 3) });
        if (!sel) S.toast('No distinct subject found'); else doc.setSelection(sel, 'Select Subject');
      } catch (e) { console.error(e); S.toast('Select Subject failed: ' + e.message); }
      prog.done();
    }, 20);
  }, enabled: () => !!S.app.doc });
  S.Cmd.register('select.subjectLayer', { label: 'Select Subject of Layer', run: () => {
    const doc = S.app.doc; if (!doc) return;
    const prog = S.Progress.start('Select Subject', { cancellable: false });
    setTimeout(() => { try { const sel = Sub.select(doc, { layerOnly: true, radius: 3 }); if (!sel) S.toast('No distinct subject found'); else doc.setSelection(sel, 'Select Subject'); } catch (e) { console.error(e); } prog.done(); }, 20);
  }, enabled: () => !!(S.app.doc && S.app.doc.activeLayer() && S.Layers.hasCanvas(S.app.doc.activeLayer())) });
})();
