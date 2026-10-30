/* =========================================================================
   Gesso — Content-Aware Scale (seam carving).  Removes or duplicates the least noticeable vertical and
   horizontal seams so a picture can change aspect without squashing its subject.  Seams are found on a
   reduced copy (≤ ~700 px) and applied as k-pixel bands at full resolution; the selection protects areas.
   Runs in a Worker (Blob URL — works from file://).
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util, O = S.Ops;
  const CA = (S.CAScale = {});

  function workerSource() {
    return function () {
      function energy(lum, w, h, prot, out) {
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const xl = x > 0 ? x - 1 : x, xr = x < w - 1 ? x + 1 : x, yu = y > 0 ? y - 1 : y, yd = y < h - 1 ? y + 1 : y;
          const gx = lum[y * w + xr] - lum[y * w + xl], gy = lum[yd * w + x] - lum[yu * w + x];
          let e = Math.abs(gx) + Math.abs(gy);
          if (prot) { const p = prot[y * w + x]; if (p > 0) e += p * 40; else if (p < 0) e += p * 0.5; }
          out[y * w + x] = e;
        }
      }
      // lowest-energy vertical seam: returns Int32Array(h) of x per row
      function seam(E, w, h, cum, from) {
        for (let x = 0; x < w; x++) cum[x] = E[x];
        for (let y = 1; y < h; y++) {
          const o = y * w, p = o - w;
          for (let x = 0; x < w; x++) {
            let best = cum[p + x], bi = x;
            if (x > 0 && cum[p + x - 1] < best) { best = cum[p + x - 1]; bi = x - 1; }
            if (x < w - 1 && cum[p + x + 1] < best) { best = cum[p + x + 1]; bi = x + 1; }
            cum[o + x] = best + E[o + x]; from[o + x] = bi;
          }
        }
        let bx = 0, bv = Infinity; const lo = (h - 1) * w;
        for (let x = 0; x < w; x++) if (cum[lo + x] < bv) { bv = cum[lo + x]; bx = x; }
        const s = new Int32Array(h); s[h - 1] = bx;
        for (let y = h - 1; y > 0; y--) s[y - 1] = from[y * w + s[y]];
        return s;
      }
      // remove one column per row (seam) from a w-wide buffer with `ch` channels per pixel
      function removeSeam(buf, w, h, ch, s) {
        const nw = w - 1, out = new buf.constructor(nw * h * ch);
        for (let y = 0; y < h; y++) {
          const sx = s[y], ri = y * w * ch, ro = y * nw * ch;
          out.set(buf.subarray(ri, ri + sx * ch), ro);
          out.set(buf.subarray(ri + (sx + 1) * ch, ri + w * ch), ro + sx * ch);
        }
        return out;
      }
      function transpose(buf, w, h, ch) {
        const out = new buf.constructor(buf.length);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) out[(x * h + y) * ch + c] = buf[(y * w + x) * ch + c];
        return out;
      }
      function lumaOf(rgba, n) { const l = new Float32Array(n); for (let i = 0, j = 0; i < n; i++, j += 4) l[i] = (0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]) * (rgba[j + 3] / 255); return l; }
      // reduce by integer factor k (box average); protect: max over the box
      function reduce(rgba, prot, w, h, k) {
        const rw = Math.ceil(w / k), rh = Math.ceil(h / k), out = new Uint8ClampedArray(rw * rh * 4), po = prot ? new Int8Array(rw * rh) : null;
        for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
          let r = 0, g = 0, b = 0, a = 0, n = 0, pm = 0;
          for (let j = 0; j < k; j++) { const yy = y * k + j; if (yy >= h) break; for (let i = 0; i < k; i++) { const xx = x * k + i; if (xx >= w) break; const q = (yy * w + xx) * 4; r += rgba[q]; g += rgba[q + 1]; b += rgba[q + 2]; a += rgba[q + 3]; n++; if (prot) { const pv = prot[yy * w + xx]; if (pv > pm) pm = pv; } } }
          const o = (y * rw + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
          if (po) po[y * rw + x] = pm;
        }
        return { rgba: out, prot: po, w: rw, h: rh };
      }
      // carve `count` vertical seams (count<0 inserts). Works at reduced resolution, applies k-wide bands at full res.
      function carveV(rgba, prot, w, h, count, progress) {
        const k = Math.max(1, Math.ceil(Math.max(w, h) / 700));
        const low = reduce(rgba, prot, w, h, k);
        let lw = low.w, lh = low.h, lrgba = low.rgba, lprot = low.prot;
        const n = Math.round(Math.abs(count) / k);
        if (!n) return { rgba, w, h };
        const insert = count < 0;
        let cur = rgba, cw = w;
        // for insertion: find seams on a copy while tracking original low-res columns
        let idx = null; if (insert) { idx = new Int32Array(lw * lh); for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) idx[y * lw + x] = x; }
        const marks = insert ? new Uint8Array(w * h) : null; // full-res columns to duplicate
        for (let i = 0; i < n && lw > 2; i++) {
          const lum = lumaOf(lrgba, lw * lh), E = new Float32Array(lw * lh), cum = new Float32Array(lw * lh), from = new Int32Array(lw * lh);
          energy(lum, lw, lh, lprot, E);
          const s = seam(E, lw, lh, cum, from);
          if (insert) {
            for (let y = 0; y < lh; y++) { const ox = idx[y * lw + s[y]]; for (let j = 0; j < k; j++) { const yy = y * k + j; if (yy >= h) break; for (let t = 0; t < k; t++) { const xx = ox * k + t; if (xx < w) marks[yy * w + xx] = 1; } } }
            idx = removeSeam(idx, lw, lh, 1, s);
          } else {
            // full-res: remove the k columns of the band following the low-res seam, row by row
            const nw = cw - k, out = new Uint8ClampedArray(nw * h * 4);
            for (let yy = 0; yy < h; yy++) {
              const sx = Math.min(cw - k, s[Math.min(lh - 1, Math.floor(yy / k))] * k);
              const ri = yy * cw * 4, ro = yy * nw * 4;
              out.set(cur.subarray(ri, ri + sx * 4), ro);
              out.set(cur.subarray(ri + (sx + k) * 4, ri + cw * 4), ro + sx * 4);
            }
            cur = out; cw = nw;
          }
          lrgba = removeSeam(lrgba, lw, lh, 4, s); if (lprot) lprot = removeSeam(lprot, lw, lh, 1, s); lw--;
          if (progress && (i & 3) === 0) progress((i + 1) / n);
        }
        if (!insert) return { rgba: cur, w: cw, h };
        // duplicate marked columns (averaged with their right neighbour)
        let add = 0; for (let x = 0; x < w; x++) if (marks[x]) add++;
        const rowAdd = new Int32Array(h); let maxAdd = 0; for (let y = 0; y < h; y++) { let a = 0; for (let x = 0; x < w; x++) if (marks[y * w + x]) a++; rowAdd[y] = a; if (a > maxAdd) maxAdd = a; }
        const nw = w + maxAdd, out = new Uint8ClampedArray(nw * h * 4);
        for (let y = 0; y < h; y++) {
          let o = y * nw * 4, placed = 0;
          for (let x = 0; x < w; x++) {
            const q = (y * w + x) * 4; out[o] = rgba[q]; out[o + 1] = rgba[q + 1]; out[o + 2] = rgba[q + 2]; out[o + 3] = rgba[q + 3]; o += 4;
            if (marks[y * w + x]) { const q2 = x + 1 < w ? q + 4 : q; out[o] = (rgba[q] + rgba[q2]) / 2; out[o + 1] = (rgba[q + 1] + rgba[q2 + 1]) / 2; out[o + 2] = (rgba[q + 2] + rgba[q2 + 2]) / 2; out[o + 3] = (rgba[q + 3] + rgba[q2 + 3]) / 2; o += 4; placed++; }
          }
          // rows with fewer marks than the widest row: pad by repeating the last pixel so every row has nw pixels
          while (placed < maxAdd) { const q = (y * w + w - 1) * 4; out[o] = rgba[q]; out[o + 1] = rgba[q + 1]; out[o + 2] = rgba[q + 2]; out[o + 3] = rgba[q + 3]; o += 4; placed++; }
        }
        void add;
        return { rgba: out, w: nw, h };
      }
      self.onmessage = function (e) {
        const { rgba, prot, w, h, tw, th } = e.data;
        let cur = { rgba, w, h }, p = prot;
        const post = (k) => self.postMessage({ progress: k });
        if (tw !== w) cur = carveV(cur.rgba, p, cur.w, cur.h, w - tw, (k) => post(k * (th !== h ? 0.5 : 1)));
        if (th !== h) {
          // protect mask must follow the horizontal carve: re-derive by nearest scaling (good enough for a guard)
          let p2 = null;
          if (p) { p2 = new Int8Array(cur.w * cur.h); for (let y = 0; y < cur.h; y++) for (let x = 0; x < cur.w; x++) p2[y * cur.w + x] = p[y * w + Math.min(w - 1, Math.floor(x * w / cur.w))]; }
          const t = transpose(cur.rgba, cur.w, cur.h, 4), tp = p2 ? transpose(p2, cur.w, cur.h, 1) : null;
          const r = carveV(t, tp, cur.h, cur.w, h - th, (k) => post(0.5 + k * 0.5));
          cur = { rgba: transpose(r.rgba, r.w, r.h, 4), w: r.h, h: r.w };
        }
        // exact size: fall back to a plain resample for any rounding remainder
        self.postMessage({ done: true, rgba: cur.rgba, w: cur.w, h: cur.h }, [cur.rgba.buffer]);
      };
    }.toString();
  }
  let workerUrl = null;
  function worker() { if (!workerUrl) workerUrl = URL.createObjectURL(new Blob(['(' + workerSource() + ')()'], { type: 'text/javascript' })); return new Worker(workerUrl); }

  /** carve an ImageData to tw×th; prot: Int8Array (1 = protect, -1 = remove first) or null; resolves ImageData */
  CA.carve = function (img, prot, tw, th, onProgress) {
    return new Promise((resolve, reject) => {
      const wk = worker();
      wk.onmessage = (e) => {
        if (e.data.progress != null) { if (onProgress) onProgress(e.data.progress); return; }
        wk.terminate();
        let out = new ImageData(new Uint8ClampedArray(e.data.rgba), e.data.w, e.data.h);
        if (e.data.w !== tw || e.data.h !== th) { // rounding remainder → resample
          const c = U.createCanvas(e.data.w, e.data.h); c.getContext('2d').putImageData(out, 0, 0);
          const r = O.resample(c, tw, th, 'bicubic'); out = r.getContext('2d').getImageData(0, 0, tw, th);
        }
        resolve(out);
      };
      wk.onerror = (e) => { wk.terminate(); reject(new Error(e.message || 'worker failed')); };
      const copy = new Uint8ClampedArray(img.data);
      wk.postMessage({ rgba: copy, prot, w: img.width, h: img.height, tw, th }, [copy.buffer].concat(prot ? [prot.buffer] : []));
    });
  };

  CA.dialog = function (doc) {
    const l = doc.activeLayer();
    if (!l || l.type !== 'raster' || l.embed) { S.toast('Content-Aware Scale works on a pixel layer — rasterize text, shapes and embedded objects first'); return; }
    const hasSel = !!doc.selection;
    const last = S.store.get('cascale', { wp: 80, hp: 100, protect: true, canvas: true, skin: false });
    const defs = [
      { id: 'wp', label: 'Width', type: 'range', default: last.wp, min: 20, max: 200, step: 1, unit: '%' },
      { id: 'hp', label: 'Height', type: 'range', default: last.hp, min: 20, max: 200, step: 1, unit: '%' },
      { id: 'protect', label: hasSel ? 'Protect the selected area' : 'Protect the selected area (no selection)', type: 'checkbox', default: !!last.protect && hasSel },
      { id: 'skin', label: 'Protect skin tones', type: 'checkbox', default: !!last.skin },
      { id: 'canvas', label: 'Resize the canvas to the new size', type: 'checkbox', default: last.canvas !== false },
    ];
    let vals = {}; defs.forEach((d) => (vals[d.id] = d.default));
    const info = U.el('div', { class: 'muted', style: { fontSize: '11px', marginTop: '6px', lineHeight: '1.5' } });
    const upd = () => { const W = Math.round(doc.width * vals.wp / 100), H = Math.round(doc.height * vals.hp / 100); info.textContent = doc.width + ' × ' + doc.height + '  →  ' + W + ' × ' + H + ' px · the picture is carved along low-detail seams instead of being squashed; large changes (beyond ~40 %) start to show.'; };
    const ui = S.ParamUI.build(defs, vals, (v) => { vals = v; upd(); }); upd();
    S.Dialog.open({ title: 'Content-Aware Scale', body: U.el('div', {}, [ui, info]), width: 440, buttons: [{ label: 'Cancel' }, { label: 'Scale', primary: true, run: async () => {
      S.store.set('cascale', vals);
      const W = Math.max(8, Math.round(doc.width * vals.wp / 100)), H = Math.max(8, Math.round(doc.height * vals.hp / 100));
      if (W === doc.width && H === doc.height) return;
      await CA.apply(doc, l, W, H, { protect: vals.protect && hasSel, skin: vals.skin, canvas: vals.canvas });
    } }] });
  };
  CA.apply = async function (doc, l, W, H, o) {
    const rect = { x: 0, y: 0, w: doc.width, h: doc.height };
    const img = S.Layers.readRect(l.canvas, rect, 0);
    let prot = null;
    if ((o.protect && doc.selection) || o.skin) {
      prot = new Int8Array(doc.width * doc.height);
      if (o.protect && doc.selection) { const m = doc.selection.mask; for (let i = 0; i < prot.length; i++) if (m[i] > 127) prot[i] = 1; }
      if (o.skin) { const d = img.data; for (let i = 0, j = 0; i < prot.length; i++, j += 4) { const r = d[j], g = d[j + 1], b = d[j + 2]; if (r > 95 && g > 40 && b > 20 && r > g && r > b && r - Math.min(g, b) > 15 && d[j + 3] > 100) prot[i] = prot[i] || 1; } }
    }
    const prog = S.Progress.start('Content-Aware Scale');
    try {
      const out = await CA.carve(img, prot, W, H, (k) => prog.set(k));
      doc.commit('Content-Aware Scale', () => {
        const c = U.createCanvas(W, H); c.getContext('2d').putImageData(out, 0, 0);
        l.canvas = c; l.version++; l._rv = -1; l._thumbDirty = true;
        if (l.mask && !l.mask.canvas._empty) { const mc = U.cloneCanvas(l.mask.canvas); l.mask = { ...l.mask, canvas: O.resample(mc, Math.max(1, Math.round(mc.width * W / doc.width)), Math.max(1, Math.round(mc.height * H / doc.height)), 'bicubic'), version: (l.mask.version || 0) + 1 }; l.mask.canvas.ox = Math.round((mc.ox || 0) * W / doc.width); l.mask.canvas.oy = Math.round((mc.oy || 0) * H / doc.height); }
        doc.selection = null; doc.lastSelection = null;
        if (o.canvas) O.resizeCanvas(doc, W, H, 0, 0, null, {});
      });
      S.View.fit(doc, false); S.bus.emit('doc:resized', doc);
    } catch (e) { console.error(e); S.toast('Content-Aware Scale failed: ' + (e && e.message || e)); } finally { prog.done(); }
  };
  S.Cmd.register('image.caScale', { label: 'Content-Aware Scale…', key: 'Ctrl+Alt+Shift+C', run: () => CA.dialog(S.app.doc), enabled: () => !!S.app.doc });
})();
