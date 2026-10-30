/* =========================================================================
   Gesso — selection masks.
   A selection is { mask: Uint8ClampedArray(w*h) 0..255, w, h, bounds }.
   Selections are treated as IMMUTABLE: every operation returns a new object,
   so history snapshots can safely keep references.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util;

  const Sel = (S.Sel = {
    /** Wrap a mask into a selection object (null if empty) */
    make(mask, w, h) {
      const b = Sel.bounds(mask, w, h);
      if (!b) return null;
      return { mask, w, h, bounds: b };
    },
    bounds(mask, w, h) {
      let x1 = w, y1 = h, x2 = -1, y2 = -1;
      for (let y = 0; y < h; y++) {
        const o = y * w;
        let rowHas = false;
        for (let x = 0; x < w; x++) if (mask[o + x]) { rowHas = true; if (x < x1) x1 = x; break; }
        if (!rowHas) continue;
        for (let x = w - 1; x >= 0; x--) if (mask[o + x]) { if (x > x2) x2 = x; break; }
        if (y < y1) y1 = y; y2 = y;
      }
      if (x2 < 0) return null;
      return { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 };
    },
    all(w, h) { return Sel.make(new Uint8ClampedArray(w * h).fill(255), w, h); },

    /** Rasterize a Path2D into a mask. */
    fromPath2D(w, h, path, rule = 'nonzero') {
      // dedicated read-optimised canvas (keeps the GPU scratch pool fast)
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.fillStyle = '#000'; x.fill(path, rule);
      const d = x.getImageData(0, 0, w, h).data, m = new Uint8ClampedArray(w * h);
      for (let i = 0, j = 3; i < m.length; i++, j += 4) m[i] = d[j];
      return m;
    },
    fromCanvasAlpha(c) { return Sel.alphaOf(c); },
    alphaOf(c) {
      const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
      const m = new Uint8ClampedArray(c.width * c.height);
      for (let i = 0, j = 3; i < m.length; i++, j += 4) m[i] = d[j];
      return m;
    },
    rectMask(w, h, x, y, rw, rh) {
      const p = new Path2D(); p.rect(x, y, rw, rh); return Sel.fromPath2D(w, h, p);
    },
    ellipseMask(w, h, x, y, rw, rh) {
      const p = new Path2D(); p.ellipse(x + rw / 2, y + rh / 2, Math.abs(rw / 2), Math.abs(rh / 2), 0, 0, Math.PI * 2); return Sel.fromPath2D(w, h, p);
    },
    polygonMask(w, h, pts) {
      const p = new Path2D(); pts.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1]))); p.closePath();
      return Sel.fromPath2D(w, h, p, 'evenodd');
    },

    /** Combine an existing selection with a new mask. mode: new|add|subtract|intersect */
    combine(sel, mask, mode, w, h) {
      if (!sel || mode === 'new') {
        if (mode === 'subtract' || mode === 'intersect') return sel && mode === 'intersect' ? null : sel || null;
        return Sel.make(mask, w, h);
      }
      const a = sel.mask, out = new Uint8ClampedArray(w * h);
      if (mode === 'add') for (let i = 0; i < out.length; i++) out[i] = a[i] > mask[i] ? a[i] : mask[i];
      else if (mode === 'subtract') for (let i = 0; i < out.length; i++) out[i] = (a[i] * (255 - mask[i])) / 255;
      else if (mode === 'intersect') for (let i = 0; i < out.length; i++) out[i] = (a[i] * mask[i]) / 255;
      return Sel.make(out, w, h);
    },
    invert(sel, w, h) {
      const out = new Uint8ClampedArray(w * h);
      if (!sel) out.fill(255); else for (let i = 0; i < out.length; i++) out[i] = 255 - sel.mask[i];
      return Sel.make(out, w, h);
    },

    /** Box blur (3 passes ≈ gaussian) on a mask, returns new array */
    blurMask(src, w, h, r) {
      r = Math.max(1, Math.round(r));
      let a = new Float32Array(src), b = new Float32Array(w * h);
      for (let pass = 0; pass < 3; pass++) {
        // horizontal
        for (let y = 0; y < h; y++) {
          const o = y * w; let acc = 0;
          for (let x = -r; x <= r; x++) acc += a[o + U.clamp(x, 0, w - 1)];
          for (let x = 0; x < w; x++) {
            b[o + x] = acc / (2 * r + 1);
            acc += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)];
          }
        }
        // vertical
        for (let x = 0; x < w; x++) {
          let acc = 0;
          for (let y = -r; y <= r; y++) acc += b[U.clamp(y, 0, h - 1) * w + x];
          for (let y = 0; y < h; y++) {
            a[y * w + x] = acc / (2 * r + 1);
            acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
          }
        }
      }
      return Uint8ClampedArray.from(a);
    },
    feather(sel, r) {
      if (!sel || r <= 0) return sel;
      return Sel.make(Sel.blurMask(sel.mask, sel.w, sel.h, r / 2), sel.w, sel.h);
    },
    /** Chamfer distance transform: distance of each pixel to the nearest pixel where inside(i) is true */
    distance(w, h, inside) {
      const INF = 1e9, d = new Float32Array(w * h);
      for (let i = 0; i < d.length; i++) d[i] = inside(i) ? 0 : INF;
      const D = 1.4142;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x; let v = d[i];
        if (x > 0) v = Math.min(v, d[i - 1] + 1);
        if (y > 0) { v = Math.min(v, d[i - w] + 1); if (x > 0) v = Math.min(v, d[i - w - 1] + D); if (x < w - 1) v = Math.min(v, d[i - w + 1] + D); }
        d[i] = v;
      }
      for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x; let v = d[i];
        if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
        if (y < h - 1) { v = Math.min(v, d[i + w] + 1); if (x < w - 1) v = Math.min(v, d[i + w + 1] + D); if (x > 0) v = Math.min(v, d[i + w - 1] + D); }
        d[i] = v;
      }
      return d;
    },
    expand(sel, r) {
      if (!sel) return sel;
      const { w, h, mask } = sel, out = new Uint8ClampedArray(w * h);
      if (r >= 0) {
        const d = Sel.distance(w, h, (i) => mask[i] >= 128);
        for (let i = 0; i < out.length; i++) out[i] = d[i] <= r ? 255 : d[i] < r + 1 ? (r + 1 - d[i]) * 255 : 0;
      } else {
        const d = Sel.distance(w, h, (i) => mask[i] < 128);
        const rr = -r;
        for (let i = 0; i < out.length; i++) out[i] = d[i] > rr + 1 ? 255 : d[i] > rr ? (d[i] - rr) * 255 : 0;
      }
      return Sel.make(out, w, h);
    },
    border(sel, r) {
      if (!sel) return sel;
      const big = Sel.expand(sel, r / 2), small = Sel.expand(sel, -r / 2);
      if (!big) return null;
      return Sel.combine(big, small ? small.mask : new Uint8ClampedArray(sel.w * sel.h), 'subtract', sel.w, sel.h);
    },
    smooth(sel, r) {
      if (!sel) return sel;
      const b = Sel.blurMask(sel.mask, sel.w, sel.h, r);
      // re-threshold with a soft 1px ramp
      for (let i = 0; i < b.length; i++) b[i] = U.clamp((b[i] - 112) * 8, 0, 255);
      return Sel.make(b, sel.w, sel.h);
    },

    /** Alpha canvas for the selection (cached on the immutable object) */
    canvas(sel) {
      if (!sel) return null;
      if (sel._canvas) return sel._canvas;
      const c = U.createCanvas(sel.w, sel.h), x = c.getContext('2d');
      const img = x.createImageData(sel.w, sel.h), d = img.data, m = sel.mask;
      for (let i = 0, j = 3; i < m.length; i++, j += 4) d[j] = m[i];
      x.putImageData(img, 0, 0);
      sel._canvas = c;
      return c;
    },
    /** Marching-ants outline as a Path2D in document coordinates (threshold 128) */
    outline(sel) {
      if (!sel) return null;
      if (sel._outline) return sel._outline;
      const { w, h, mask } = sel, b = sel.bounds, p = new Path2D();
      const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] >= 128;
      let segs = 0;
      const x0 = Math.max(0, b.x - 1), x1 = Math.min(w, b.x + b.w + 1), y0 = Math.max(0, b.y - 1), y1 = Math.min(h, b.y + b.h + 1);
      // horizontal edges
      for (let y = y0; y <= y1; y++) {
        let run = -1;
        for (let x = x0; x <= x1; x++) {
          const e = x < x1 && inside(x, y) !== inside(x, y - 1);
          if (e && run < 0) run = x;
          else if (!e && run >= 0) { p.moveTo(run, y); p.lineTo(x, y); run = -1; segs++; }
        }
      }
      for (let x = x0; x <= x1; x++) {
        let run = -1;
        for (let y = y0; y <= y1; y++) {
          const e = y < y1 && inside(x, y) !== inside(x - 1, y);
          if (e && run < 0) run = y;
          else if (!e && run >= 0) { p.moveTo(x, run); p.lineTo(x, y); run = -1; segs++; }
        }
      }
      sel._outline = p; sel._segs = segs;
      return p;
    },

    /* ---------- Color-based selection ---------- */
    /** Flood / global color match. img = ImageData; tol 0..255. Returns mask */
    colorMask(img, sx, sy, tol, contiguous, antialias) {
      const { width: w, height: h, data: d } = img;
      sx = U.clamp(sx | 0, 0, w - 1); sy = U.clamp(sy | 0, 0, h - 1);
      const i0 = (sy * w + sx) * 4;
      const r0 = d[i0], g0 = d[i0 + 1], b0 = d[i0 + 2], a0 = d[i0 + 3];
      const match = (i) => {
        const j = i * 4;
        return Math.max(Math.abs(d[j] - r0), Math.abs(d[j + 1] - g0), Math.abs(d[j + 2] - b0), Math.abs(d[j + 3] - a0)) <= tol;
      };
      const out = new Uint8ClampedArray(w * h);
      if (!contiguous) { for (let i = 0; i < out.length; i++) if (match(i)) out[i] = 255; }
      else {
        // scanline flood fill
        const stack = [sx, sy];
        while (stack.length) {
          const y = stack.pop(), x = stack.pop();
          let lx = x; const row = y * w;
          if (out[row + x] || !match(row + x)) continue;
          while (lx > 0 && !out[row + lx - 1] && match(row + lx - 1)) lx--;
          let rx = x;
          while (rx < w - 1 && !out[row + rx + 1] && match(row + rx + 1)) rx++;
          for (let i = lx; i <= rx; i++) out[row + i] = 255;
          for (const ny of [y - 1, y + 1]) {
            if (ny < 0 || ny >= h) continue;
            const nrow = ny * w; let inRun = false;
            for (let i = lx; i <= rx; i++) {
              const ok = !out[nrow + i] && match(nrow + i);
              if (ok && !inRun) { stack.push(i, ny); inRun = true; } else if (!ok) inRun = false;
            }
          }
        }
      }
      if (antialias) {
        // soften 1px edge
        const o2 = new Uint8ClampedArray(out);
        for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (out[i]) continue;
          const n = (out[i - 1] + out[i + 1] + out[i - w] + out[i + w]) / 4;
          if (n) o2[i] = n * 0.5;
        }
        return o2;
      }
      return out;
    },
    /** Soft color range mask (fuzziness 0..200) */
    colorRange(img, rgb, fuzz) {
      const d = img.data, n = img.width * img.height, out = new Uint8ClampedArray(n);
      const f = Math.max(1, fuzz) * 1.0;
      for (let i = 0, j = 0; i < n; i++, j += 4) {
        const dist = Math.sqrt(((d[j] - rgb.r) ** 2 + (d[j + 1] - rgb.g) ** 2 + (d[j + 2] - rgb.b) ** 2) / 3);
        out[i] = d[j + 3] ? U.clamp((1 - dist / f) * 255 * 1.4, 0, 255) : 0;
      }
      return out;
    },
  });
})();
