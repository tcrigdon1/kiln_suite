/* =========================================================================
   Gesso — layer model, factories, and parametric renderers
   (text layers, shape layers, fill layers, gradients).

   Every pixel-carrying layer owns a <canvas> (layer.canvas) that is only as large as its
   content, placed in the document by canvas.ox / canvas.oy (see Layers.growTo, trim, readRect,
   writeRect).  Content may lie outside the document and is kept when moved back in.  Masks stay
   document-sized at (0,0).  Text / shape / fill layers keep their parameters and re-render their
   canvas (clipped to the document) whenever layer.version changes.  Layer object fields:
     id, type ('raster'|'text'|'shape'|'adjustment'|'fill'|'group'), name,
     visible, opacity (0..1), fillOpacity (0..1), blend, clip (bool),
     locks {pixels, position, alpha, all}, mask (null | {canvas, enabled, density, feather}),
     effects (null | {enabled, items:{dropShadow:{...}, ...}}),
     text / shape / fill / adj (type specific), children + collapsed (groups),
     version (bumped on any content change, drives caches)
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util;

  /* ---------------- Gradients (shared by tool, fill layers, effects) ---------------- */
  const G = (S.Gradient = {
    PRESETS: [
      { name: 'Foreground to Background', dyn: 'fgbg' },
      { name: 'Foreground to Transparent', dyn: 'fgt' },
      { name: 'Black to White', stops: [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }] },
      { name: 'Spectrum', stops: ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ff0000'].map((c, i, a) => ({ pos: i / (a.length - 1), color: c })) },
      { name: 'Ember', stops: [{ pos: 0, color: '#2a0b05' }, { pos: 0.45, color: '#c2410c' }, { pos: 0.8, color: '#f0913a' }, { pos: 1, color: '#ffe3b0' }] },
      { name: 'Lagoon', stops: [{ pos: 0, color: '#062a33' }, { pos: 0.55, color: '#3dbfae' }, { pos: 1, color: '#e6fff9' }] },
      { name: 'Dusk', stops: [{ pos: 0, color: '#241445' }, { pos: 0.5, color: '#b33f6b' }, { pos: 1, color: '#ffb36b' }] },
      { name: 'Chrome', stops: [{ pos: 0, color: '#3b3b3b' }, { pos: 0.3, color: '#f5f5f5' }, { pos: 0.5, color: '#7a7a7a' }, { pos: 0.72, color: '#e0e0e0' }, { pos: 1, color: '#4a4a4a' }] },
      { name: 'Transparent Stripes', stops: [{ pos: 0, color: '#000000', alpha: 1 }, { pos: 0.25, color: '#000000', alpha: 0 }, { pos: 0.5, color: '#000000', alpha: 1 }, { pos: 0.75, color: '#000000', alpha: 0 }, { pos: 1, color: '#000000', alpha: 1 }] },
    ],
    /** Resolve preset to concrete stops (dynamic presets use current fg/bg) */
    resolve(preset) {
      if (!preset) return G.resolve(G.PRESETS[0]);
      if (Array.isArray(preset)) return preset;
      if (preset.dyn === 'fgbg') return [{ pos: 0, color: S.app.fg }, { pos: 1, color: S.app.bg }];
      if (preset.dyn === 'fgt') return [{ pos: 0, color: S.app.fg, alpha: 1 }, { pos: 1, color: S.app.fg, alpha: 0 }];
      return preset.stops.map((s) => ({ ...s }));
    },
    css(stops) { return 'linear-gradient(90deg,' + stops.map((s) => U.rgba(s.color, s.alpha ?? 1) + ' ' + (s.pos * 100).toFixed(1) + '%').join(',') + ')'; },
    addStops(g, stops, reverse, mirror) {
      let st = stops.slice().sort((a, b) => a.pos - b.pos);
      if (reverse) st = st.map((s) => ({ ...s, pos: 1 - s.pos })).reverse();
      if (mirror) {
        for (const s of st) g.addColorStop(0.5 - s.pos / 2, U.rgba(s.color, s.alpha ?? 1));
        for (const s of st) g.addColorStop(0.5 + s.pos / 2, U.rgba(s.color, s.alpha ?? 1));
      } else for (const s of st) g.addColorStop(U.clamp(s.pos, 0, 1), U.rgba(s.color, s.alpha ?? 1));
    },
    /** 256-entry RGBA LUT */
    lut(stops, reverse) {
      const c = U.createCanvas(256, 1), x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 256, 0);
      G.addStops(g, stops, reverse);
      x.fillStyle = g; x.fillRect(0, 0, 256, 1);
      return x.getImageData(0, 0, 256, 1).data;
    },
    /**
     * Paint a gradient filling the whole ctx canvas.
     * spec = { stops, type: linear|radial|angle|reflected|diamond, x1,y1,x2,y2, reverse }
     */
    paint(ctx, spec, w, h) { G.paintRect(ctx, spec, { x: 0, y: 0, w, h }); },
    /** Paint a gradient over rect R (user space; the ctx may be translated — the diamond path honours an integer translation) */
    paintRect(ctx, spec, R) {
      const { x1, y1, x2, y2 } = spec;
      const stops = spec.stops, type = spec.type || 'linear';
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      let g;
      if (type === 'linear') g = ctx.createLinearGradient(x1, y1, x2, y2);
      else if (type === 'radial') g = ctx.createRadialGradient(x1, y1, 0, x1, y1, len);
      else if (type === 'angle') g = ctx.createConicGradient(Math.atan2(y2 - y1, x2 - x1), x1, y1);
      else if (type === 'reflected') g = ctx.createLinearGradient(x1 - (x2 - x1), y1 - (y2 - y1), x2, y2);
      if (g) {
        G.addStops(g, stops, spec.reverse, type === 'reflected');
        ctx.fillStyle = g; ctx.fillRect(R.x, R.y, R.w, R.h);
        return;
      }
      // diamond: per-pixel
      const w = R.w, h = R.h, m = ctx.getTransform(), tx = Math.round(m.e), ty = Math.round(m.f);
      const lut = G.lut(stops, spec.reverse);
      const img = ctx.createImageData(w, h), d = img.data;
      const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const dx = x + R.x + 0.5 - x1, dy = y + R.y + 0.5 - y1;
        const a = Math.abs(dx * ux + dy * uy), b = Math.abs(-dx * uy + dy * ux);
        const t = Math.min(255, ((a + b) / len) * 255) | 0, i = (y * w + x) * 4;
        d[i] = lut[t * 4]; d[i + 1] = lut[t * 4 + 1]; d[i + 2] = lut[t * 4 + 2]; d[i + 3] = lut[t * 4 + 3];
      }
      ctx.putImageData(img, R.x + tx, R.y + ty);
    },
  });

  /* ---------------- Text layout & render ---------------- */
  const T = (S.Text = {
    FONTS: ['Segoe UI', 'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Franklin Gothic Medium', 'Gabriola', 'Georgia', 'Impact', 'Ink Free', 'Lucida Console', 'Lucida Sans Unicode', 'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Sitka Text', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'serif', 'sans-serif', 'monospace', 'cursive'],
    defaults() {
      return { text: '', x: 0, y: 0, box: null, font: 'Segoe UI', size: 48, weight: 400, italic: false, color: S.app.fg || '#000000',
        align: 'left', leading: 0, tracking: 0, underline: false, strike: false, allCaps: false, smallCaps: false, warp: null };
    },
    /** warp presets (Properties ▸ Text Warp): t.warp = { style, bend (-100…100) } */
    WARPS: [{ value: 'none', label: 'None' }, { value: 'arc', label: 'Arc' }, { value: 'arcLower', label: 'Arc Lower' }, { value: 'arcUpper', label: 'Arc Upper' }, { value: 'bulge', label: 'Bulge' }, { value: 'flag', label: 'Flag' }, { value: 'wave', label: 'Wave' }, { value: 'rise', label: 'Rise' }],
    hasWarp(t) { const w = t.warp; return !!(w && w.style && w.style !== 'none' && +w.bend && !T.hasCurve(t)); },
    /**
     * Column mapping of a warp: for u (0…1 across the text) returns { dy, sy, anchor } — the vertical offset,
     * vertical scale and which edge stays put. The text is rendered straight, then re-drawn column by column.
     */
    warpMap(t) {
      const style = t.warp.style, b = Math.max(-1, Math.min(1, (+t.warp.bend || 0) / 100));
      const k = (u) => 1 - (2 * u - 1) * (2 * u - 1); // 0 at the ends, 1 in the middle
      switch (style) {
        case 'arc': return (u, H) => ({ dy: -b * H * 0.5 * k(u), sy: 1, anchor: 'center' });
        case 'arcLower': return (u, H) => ({ dy: 0, sy: 1 + b * 0.6 * k(u), anchor: 'top' });
        case 'arcUpper': return (u, H) => ({ dy: 0, sy: 1 + b * 0.6 * k(u), anchor: 'bottom' });
        case 'bulge': return (u, H) => ({ dy: 0, sy: 1 + b * 0.8 * k(u), anchor: 'center' });
        case 'flag': return (u, H) => ({ dy: -b * H * 0.5 * Math.sin(2 * Math.PI * u), sy: 1, anchor: 'center' });
        case 'wave': return (u, H) => ({ dy: -b * H * 0.35 * Math.sin(3 * Math.PI * u), sy: 1 + b * 0.15 * Math.cos(3 * Math.PI * u), anchor: 'center' });
        case 'rise': return (u, H) => ({ dy: -b * H * 0.6 * (u - 0.5), sy: 1, anchor: 'center' });
      }
      return () => ({ dy: 0, sy: 1, anchor: 'center' });
    },
    /** destination top / height of a 1-px column of the straight rendering (height H at y0) under a warp */
    warpColumn(map, u, y0, H) {
      const m = map(u, H), h = Math.max(0.5, H * m.sy);
      const y = m.anchor === 'top' ? y0 : m.anchor === 'bottom' ? y0 + H - h : y0 + H / 2 - h / 2;
      return [y + m.dy, h];
    },
    /** bounding box of the warped rendering (the straight bbox grown by the column mapping) */
    warpBBox(t, bb) {
      const map = T.warpMap(t), pad = Math.ceil(t.size * 0.3) + 2, y0 = bb.y - pad, H = bb.h + pad * 2;
      let y1 = Infinity, y2 = -Infinity;
      for (let i = 0; i <= 64; i++) { const [y, h] = T.warpColumn(map, i / 64, y0, H); if (y < y1) y1 = y; if (y + h > y2) y2 = y + h; }
      return { x: bb.x, y: y1, w: bb.w, h: Math.max(2, y2 - y1) };
    },
    fontString(t) { return (t.italic ? 'italic ' : '') + (t.weight || 400) + ' ' + t.size + 'px "' + t.font + '", sans-serif'; },
    setup(ctx, t) {
      ctx.font = T.fontString(t);
      ctx.textBaseline = 'alphabetic';
      try { ctx.letterSpacing = ((t.tracking || 0) / 1000) * t.size + 'px'; } catch (e) {}
      try { ctx.fontVariantCaps = t.smallCaps ? 'small-caps' : 'normal'; } catch (e) {}
      try { ctx.wordSpacing = '0px'; } catch (e) {}
    },
    /** per-line word spacing (justified paragraphs) on a measuring / drawing context */
    lineSpacing(ctx, L) { try { ctx.wordSpacing = (L && L.ws ? L.ws : 0) + 'px'; } catch (e) {} },
    lineHeight(t) { return t.leading > 0 ? t.leading : t.size * 1.25; },
    /**
     * Lay out text. Returns { lines:[{text,start,end,x,y(baseline),w}], bbox:{x,y,w,h} }
     * start/end are character indices into t.text (the source string).
     */
    layout(t) {
      const c = T._mctx || (T._mctx = U.createCanvas(4, 4).getContext('2d'));
      T.setup(c, t);
      const src = t.text || '';
      const disp = t.allCaps ? src.toUpperCase() : src;
      const lh = T.lineHeight(t);
      const asc = t.size * 0.92;
      const raw = [];
      // hard lines
      let idx = 0;
      for (const part of disp.split('\n')) {
        if (!t.box) raw.push({ text: part, start: idx, end: idx + part.length, last: true });
        else {
          // word wrap inside box width
          const maxW = Math.max(4, t.box.w);
          let cur = '', curStart = idx;
          // break opportunities: after spaces, and (CJK / long words) between graphemes when a word alone is wider than the box
          let words = part.match(/\S+\s*|\s+/g) || [''];
          const seg = T._seg || (T._seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null);
          const split = (wd) => (seg ? Array.from(seg.segment(wd), (s) => s.segment) : Array.from(wd));
          words = words.flatMap((wd) => (c.measureText(wd.trimEnd()).width > maxW && wd.trim().length > 1 ? split(wd) : [wd]));
          let pos = idx;
          for (const wd of words) {
            const test = cur + wd;
            if (cur && c.measureText(test.trimEnd()).width > maxW) {
              raw.push({ text: cur, start: curStart, end: pos });
              cur = wd; curStart = pos;
            } else cur = test;
            pos += wd.length;
          }
          raw.push({ text: cur, start: curStart, end: idx + part.length, last: true });
        }
        idx += part.length + 1;
      }
      const lines = [];
      let minX = Infinity, maxX = -Infinity;
      raw.forEach((r, i) => {
        const txt = r.text.replace(/\s+$/, '');
        let w = c.measureText(txt).width, ws = 0;
        let x = t.x;
        if (t.box) {
          if (t.align === 'center') x = t.x + (t.box.w - w) / 2; else if (t.align === 'right') x = t.x + t.box.w - w;
          else if (t.align === 'justify' && !r.last) {
            // justify: the slack is shared by the word gaps (the last line of a paragraph stays ragged)
            const gaps = (txt.match(/ /g) || []).length;
            if (gaps && w < t.box.w) { ws = (t.box.w - w) / gaps; w = t.box.w; }
          }
        } else {
          if (t.align === 'center') x = t.x - w / 2; else if (t.align === 'right') x = t.x - w;
        }
        const y = t.y + asc + i * lh;
        lines.push({ text: r.text, start: r.start, end: r.end, x, y, w, ws });
        minX = Math.min(minX, x); maxX = Math.max(maxX, x + w);
      });
      const h = Math.max(lh, raw.length * lh);
      const bbox = t.box ? { x: t.x, y: t.y, w: t.box.w, h: t.box.h } : { x: isFinite(minX) ? minX : t.x, y: t.y, w: Math.max(2, maxX - minX || 2), h };
      const lay = { lines, bbox, lh, asc };
      if (T.hasCurve(t)) { lay.curve = T.curveLayout(t, lay); lay.bbox = lay.curve.bbox; }
      else if (T.hasWarp(t)) { lay.plainBBox = bbox; lay.bbox = T.warpBBox(t, bbox); }
      return lay;
    },
    hasCurve(t) { const c = t.curve; return !!(c && (c.type === 'circle' || (c.type === 'path' && c.path && c.path.subpaths && c.path.subpaths.length))); },
    /**
     * Text on a curve.  t.curve = { type:'circle', radius, start (deg, 0 = 12 o'clock, clockwise), dir:'outside'|'inside' }
     *                         or { type:'path', path (relative to t.x,t.y), start (px along the path), flip }
     * For curved text (t.x, t.y) is the circle centre / the path origin.  Glyphs are placed one by one with
     * their baseline on the curve (multi-line text stacks away from it), honouring tracking, size and alignment.
     */
    curveLayout(t, lay) {
      const c = T._mctx; T.setup(c, t);
      try { c.letterSpacing = '0px'; } catch (e) {}
      const cv = t.curve, tr = ((t.tracking || 0) / 1000) * t.size, lh = lay.lh, asc = lay.asc, desc = t.size * 0.25;
      const disp = t.allCaps ? (t.text || '').toUpperCase() : t.text || '';
      let follow, total = 0;
      if (cv.type === 'circle') {
        const R = Math.max(1, +cv.radius || 100), st = ((+cv.start || 0) * Math.PI) / 180, inside = cv.dir === 'inside';
        follow = (s, li) => {
          const r = Math.max(1, inside ? R + li * lh : R - li * lh);
          const th = inside ? st - s / r : st + s / r;
          return { x: t.x + r * Math.sin(th), y: t.y - r * Math.cos(th), rot: inside ? th + Math.PI : th };
        };
      } else {
        // flatten the path to a polyline with cumulative arc length
        const pts = [];
        for (const sp of cv.path.subpaths) {
          const n = sp.nodes; if (!n.length) continue;
          const cnt = sp.closed ? n.length : n.length - 1;
          if (!pts.length) pts.push([n[0].x, n[0].y]);
          for (let i = 0; i < cnt; i++) {
            const A = n[i], B = n[(i + 1) % n.length];
            for (let k = 1; k <= 32; k++) {
              const u = k / 32, mu = 1 - u;
              pts.push([mu * mu * mu * A.x + 3 * mu * mu * u * A.ox + 3 * mu * u * u * B.ix + u * u * u * B.x, mu * mu * mu * A.y + 3 * mu * mu * u * A.oy + 3 * mu * u * u * B.iy + u * u * u * B.y]);
            }
          }
          break; // text follows the first subpath
        }
        if (cv.flip) pts.reverse();
        if (pts.length < 2) pts.push([pts.length ? pts[0][0] + 1 : 1, pts.length ? pts[0][1] : 0]);
        const cum = [0];
        for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        total = cum[cum.length - 1];
        follow = (s, li) => {
          let i = 1;
          if (s <= 0) i = 1; else if (s >= total) i = pts.length - 1; else { let lo = 1, hi = pts.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < s) lo = m + 1; else hi = m; } i = lo; }
          const a = pts[i - 1], b = pts[i], segL = cum[i] - cum[i - 1] || 1e-9, u = (s - cum[i - 1]) / segL;
          const rot = Math.atan2(b[1] - a[1], b[0] - a[0]);
          const x = a[0] + (b[0] - a[0]) * u, y = a[1] + (b[1] - a[1]) * u, off = li * lh;
          return { x: t.x + x - Math.sin(rot) * off, y: t.y + y + Math.cos(rot) * off, rot };
        };
      }
      const glyphs = [], rows = [];
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      lay.lines.forEach((L, li) => {
        const str = disp.slice(L.start, L.end).replace(/[\s]+$/, '');
        const n = str.length, cw = [0];
        for (let k = 1; k <= n; k++) cw.push(c.measureText(str.slice(0, k)).width + k * tr);
        const W = n ? cw[n] - tr : 0;
        const st0 = cv.type === 'path' ? +cv.start || 0 : 0;
        const s0 = cv.type === 'path'
          ? (t.align === 'center' ? total / 2 + st0 - W / 2 : t.align === 'right' ? total - st0 - W : st0)
          : (t.align === 'center' ? -W / 2 : t.align === 'right' ? -W : 0);
        rows.push({ start: L.start, end: L.start + n, s0, cw, li });
        for (let k = 0; k < n; k++) {
          const w = cw[k + 1] - cw[k] - tr, mid = s0 + cw[k] + w / 2;
          const g = follow(mid, li);
          Object.assign(g, { i: L.start + k, ch: str[k], w, li });
          glyphs.push(g);
          const cs = Math.cos(g.rot), sn = Math.sin(g.rot);
          for (const [px, py] of [[-w / 2, -asc], [w / 2, -asc], [w / 2, desc], [-w / 2, desc]]) {
            const X = g.x + px * cs - py * sn, Y = g.y + px * sn + py * cs;
            if (X < x1) x1 = X; if (X > x2) x2 = X; if (Y < y1) y1 = Y; if (Y > y2) y2 = Y;
          }
        }
      });
      if (!isFinite(x1)) { const p = follow(0, 0); x1 = p.x - 2; y1 = p.y - asc; x2 = p.x + 2; y2 = p.y + desc; }
      /** baseline point & angle for a caret before character index `index` */
      const caret = (index) => {
        let row = rows[rows.length - 1];
        for (const r of rows) if (index >= r.start && index <= r.end) { row = r; break; }
        if (!row) return Object.assign(follow(0, 0), { index });
        const k = Math.max(0, Math.min(row.cw.length - 1, index - row.start));
        const sAt = row.s0 + row.cw[k] - (k > 0 && k === row.cw.length - 1 ? tr : 0);
        return follow(sAt, row.li);
      };
      return { glyphs, rows, caret, asc, desc, bbox: { x: x1, y: y1, w: Math.max(2, x2 - x1), h: Math.max(2, y2 - y1) } };
    },
    /** caret position for a character index → {x, y(top), h}; curved text adds {ang, bx, by} (baseline point) */
    caretPos(t, lay, index) {
      if (lay.curve) {
        const p = lay.curve.caret(index), up = [Math.sin(p.rot), -Math.cos(p.rot)];
        return { x: p.x + up[0] * lay.asc, y: p.y + up[1] * lay.asc, h: lay.lh, ang: p.rot, bx: p.x, by: p.y };
      }
      const c = T._mctx; T.setup(c, t);
      const disp = t.allCaps ? (t.text || '').toUpperCase() : t.text || '';
      let line = lay.lines[lay.lines.length - 1];
      for (const L of lay.lines) { if (index >= L.start && index <= L.end) { line = L; break; } }
      if (!line) return { x: t.x, y: t.y, h: t.size };
      const sub = disp.slice(line.start, Math.min(index, line.end));
      T.lineSpacing(c, line);
      return { x: line.x + c.measureText(sub).width, y: line.y - lay.asc, h: lay.lh };
    },
    /** char index nearest to doc point */
    indexAt(t, lay, px, py) {
      if (lay.curve) {
        let best = null, bd = Infinity;
        for (const g of lay.curve.glyphs) {
          const cx = g.x + Math.sin(g.rot) * t.size * 0.35, cy = g.y - Math.cos(g.rot) * t.size * 0.35;
          const d = Math.hypot(px - cx, py - cy); if (d < bd) { bd = d; best = g; }
        }
        if (!best) return 0;
        const along = (px - best.x) * Math.cos(best.rot) + (py - best.y) * Math.sin(best.rot);
        return along < 0 ? best.i : best.i + 1;
      }
      const c = T._mctx; T.setup(c, t);
      const disp = t.allCaps ? (t.text || '').toUpperCase() : t.text || '';
      let L = lay.lines[0];
      for (const l of lay.lines) if (py >= l.y - lay.asc) L = l;
      if (!L) return 0;
      let best = L.start, bd = Infinity;
      T.lineSpacing(c, L);
      for (let i = L.start; i <= L.end; i++) {
        const x = L.x + c.measureText(disp.slice(L.start, i)).width;
        const d = Math.abs(x - px);
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    },
    render(ctx, t) {
      const lay = T.layout(t);
      ctx.save();
      if (t.matrix) ctx.transform(t.matrix[0], t.matrix[1], t.matrix[2], t.matrix[3], t.matrix[4], t.matrix[5]);
      T.setup(ctx, t);
      ctx.fillStyle = t.color;
      if (lay.curve) {
        try { ctx.letterSpacing = '0px'; } catch (e) {}
        const th = Math.max(1, t.size / 16);
        for (const g of lay.curve.glyphs) {
          ctx.save();
          ctx.translate(g.x, g.y); ctx.rotate(g.rot);
          ctx.fillText(g.ch, -g.w / 2, 0);
          if (t.underline) ctx.fillRect(-g.w / 2 - 0.5, t.size * 0.1, g.w + ((t.tracking || 0) / 1000) * t.size + 1, th);
          if (t.strike) ctx.fillRect(-g.w / 2 - 0.5, -t.size * 0.3, g.w + ((t.tracking || 0) / 1000) * t.size + 1, th);
          ctx.restore();
        }
        ctx.restore();
        return lay;
      }
      const drawLines = (cx) => {
        for (const L of lay.lines) {
          // paragraph boxes hide lines that don't fit (except the first)
          if (t.box && L !== lay.lines[0] && L.y + t.size * 0.25 > t.y + t.box.h) break;
          T.lineSpacing(cx, L);
          cx.fillText(L.text.replace(/\s+$/, ''), L.x, L.y);
          if (t.underline || t.strike) {
            const th = Math.max(1, t.size / 16);
            if (t.underline) cx.fillRect(L.x, L.y + t.size * 0.1, L.w, th);
            if (t.strike) cx.fillRect(L.x, L.y - t.size * 0.3, L.w, th);
          }
        }
      };
      // warp presets: render straight, then redraw column by column (hidden while the text is being edited so
      // the caret matches the glyphs)
      const editing = S.TextTool && S.TextTool.edit && S.TextTool.edit.layer && S.TextTool.edit.layer.text === t;
      if (lay.plainBBox && !editing) {
        const bb = lay.plainBBox, pad = Math.ceil(t.size * 0.3) + 2;
        const W = Math.max(1, Math.ceil(bb.w + pad * 2)), H = Math.max(1, Math.ceil(bb.h + pad * 2)), x0 = Math.floor(bb.x) - pad, y0 = Math.floor(bb.y) - pad;
        if (W * H <= 64e6) {
          const tmp = U.createCanvas(W, H), tx = tmp.getContext('2d'); // not pooled: text sizes vary too much
          tx.save(); tx.translate(-x0, -y0); T.setup(tx, t); tx.fillStyle = t.color; drawLines(tx); tx.restore();
          const map = T.warpMap(t);
          ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
          for (let x = 0; x < W; x++) { const [y, h] = T.warpColumn(map, (x + 0.5) / W, y0, H); ctx.drawImage(tmp, x, 0, 1, H, x0 + x, y, 1, h); }
          ctx.restore();
          return lay;
        }
      }
      drawLines(ctx);
      ctx.restore();
      return lay;
    },
  });

  /* ---------------- Shapes ----------------
     A shape layer keeps parametric geometry (x,y,w,h / x1..y2 / path) in LOCAL space plus:
       matrix  null | [a,b,c,d,e,f]  persistent affine applied to the local geometry. Scale is always
               baked into the parameters (see setAffine), so the matrix only holds rotation/skew/flip and
               a translation — rounded-rect radii, star points etc. stay editable after Free Transform.
       repeat  null | {enabled, count, cx, cy, offset, rotate}  radial repeat around (cx,cy)
       fill / stroke paint: {enabled, color, type:'solid'|'linear'|'radial'|'angle'|'reflected'|'diamond',
               stops, angle, scale, ox, oy, reverse}  — gradients are laid out on the shape's own
               (local, untransformed) bounds, so they rotate and repeat with the shape.  */
  const M = {
    I: () => [1, 0, 0, 1, 0, 0],
    mul(m, n) { return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]; },
    apply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; },
    rotAbout(rad, cx, cy) { const c = Math.cos(rad), s = Math.sin(rad); return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]; },
    translate(dx, dy) { return [1, 0, 0, 1, dx, dy]; },
    isIdentity(m) { return !m || (Math.abs(m[0] - 1) < 1e-9 && Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && Math.abs(m[3] - 1) < 1e-9 && Math.abs(m[4]) < 1e-9 && Math.abs(m[5]) < 1e-9); },
    isTranslate(m) { return !m || (Math.abs(m[0] - 1) < 1e-9 && Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && Math.abs(m[3] - 1) < 1e-9); },
    /** linear part = R(rot) · [[1, shear],[0, flip]] · diag(sx, sy) */
    decompose(m) {
      const sx = Math.hypot(m[0], m[1]), rot = Math.atan2(m[1], m[0]), c = Math.cos(rot), s = Math.sin(rot);
      const c2 = c * m[2] + s * m[3], d2 = -s * m[2] + c * m[3];
      const sy = Math.abs(d2);
      return { sx, sy, rot, flip: d2 < 0 ? -1 : 1, shear: sy > 1e-12 ? c2 / sy : 0 };
    },
  };
  S.Affine = M;
  const BOX_KINDS = { rect: 1, roundRect: 1, ellipse: 1, polygon: 1, star: 1, custom: 1 };
  const PAINT_TYPES = ['solid', 'linear', 'radial', 'angle', 'reflected', 'diamond'];

  const Sh = (S.Shape = {
    PAINT_TYPES,
    defaults(kind) {
      return { kind: kind || 'rect', x: 0, y: 0, w: 100, h: 100, radius: 16, sides: 6, inner: 0.5, points: 5,
        x1: 0, y1: 0, x2: 100, y2: 100, lineWidth: 6, arrowStart: false, arrowEnd: false, custom: 'heart', path: null, matrix: null, repeat: null,
        fill: { enabled: true, color: S.app.fg || '#000000', type: 'solid' },
        stroke: { enabled: false, color: '#000000', width: 4, align: 'center', dash: 'solid', cap: 'round', join: 'round', type: 'solid' } };
    },
    /** default gradient settings added when a paint is switched to a gradient type */
    gradientDefaults(color) { return { stops: [{ pos: 0, color: color || '#000000' }, { pos: 1, color: '#ffffff' }], angle: 90, scale: 100, ox: 0, oy: 0, reverse: false }; },
    isGradient(p) { return !!(p && p.type && p.type !== 'solid'); },
    /** Parametric geometry → path, in local (untransformed) space */
    localPath(s) {
      const P = S.Paths;
      switch (s.kind) {
        case 'rect': return P.rect(s.x, s.y, s.w, s.h, 0);
        case 'roundRect': return P.rect(s.x, s.y, s.w, s.h, s.radii && s.radii.some((v) => v != null) ? s.radii.map((v, i) => (v == null ? s.radius : v)) : s.radius);
        case 'ellipse': return P.ellipse(s.x + s.w / 2, s.y + s.h / 2, s.w / 2, s.h / 2);
        case 'polygon': return P.polygon(s.x + s.w / 2, s.y + s.h / 2, Math.abs(s.w) / 2, Math.abs(s.h) / 2, s.sides);
        case 'star': return P.star(s.x + s.w / 2, s.y + s.h / 2, Math.abs(s.w) / 2, Math.abs(s.h) / 2, s.points, s.inner);
        case 'line': return P.line(s.x1, s.y1, s.x2, s.y2, s.lineWidth, s.arrowStart, s.arrowEnd);
        case 'custom': {
          let { x, y, w, h } = s; if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
          return P.custom(s.custom, x, y, w, h);
        }
        case 'path': return s.path || P.empty();
      }
      return P.empty();
    },
    /** natural centre in local space (box centre for box shapes — e.g. a star's centre, not its bounds') */
    localCenter(s) {
      if (BOX_KINDS[s.kind]) return [s.x + s.w / 2, s.y + s.h / 2];
      if (s.kind === 'line') return [(s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2];
      const b = S.Paths.bounds(Sh.localPath(s)); return [b.x + b.w / 2, b.y + b.h / 2];
    },
    /** natural centre in doc space (persistent matrix applied) */
    center(s) { const c = Sh.localCenter(s); return s.matrix ? M.apply(s.matrix, c[0], c[1]) : c; },
    /** One matrix per drawn copy (the persistent matrix, combined with the radial repeat) */
    instances(s) {
      const base = s.matrix || null;
      const r = s.repeat;
      if (!r || !r.enabled || !(r.count >= 2)) return [base];
      const B = base || M.I();
      const bc = Sh.center(s);
      const cx = r.cx ?? 0, cy = r.cy ?? 0;
      let dx = bc[0] - cx, dy = bc[1] - cy; const dl = Math.hypot(dx, dy);
      if (dl < 1e-6) { dx = 0; dy = -1; } else { dx /= dl; dy /= dl; }
      const off = r.offset || 0;
      const B2 = off ? M.mul(M.translate(dx * off, dy * off), B) : B;
      const p0 = [bc[0] + dx * off, bc[1] + dy * off];
      const out = [];
      const n = Math.min(720, Math.round(r.count));
      for (let i = 0; i < n; i++) {
        const R = M.rotAbout((i / n) * Math.PI * 2, cx, cy);
        if (r.rotate === false) { const p = M.apply(R, p0[0], p0[1]); out.push(M.mul(M.translate(p[0] - p0[0], p[1] - p0[1]), B2)); }
        else out.push(M.mul(R, B2));
      }
      return out;
    },
    /** The editable outline (persistent matrix applied, repeat copies excluded), doc space */
    editPath(s) { const p = Sh.localPath(s); return s.matrix ? S.Paths.transform(p, (x, y) => M.apply(s.matrix, x, y)) : p; },
    /** Full outline in doc space (all repeat copies) */
    toPath(s) {
      const local = Sh.localPath(s), inst = Sh.instances(s);
      if (inst.length === 1 && !inst[0]) return local;
      const out = { subpaths: [] };
      for (const m of inst) out.subpaths.push(...(m ? S.Paths.transform(local, (x, y) => M.apply(m, x, y)) : S.Paths.clone(local)).subpaths);
      return out;
    },
    bounds(s) { return S.Paths.bounds(Sh.toPath(s)); },
    /** rotation of the persistent matrix, in degrees */
    rotation(s) { return s.matrix ? +(M.decompose(s.matrix).rot * 180 / Math.PI).toFixed(3) : 0; },
    /**
     * Set the shape so that its local geometry is mapped by the affine A (A maps the CURRENT local geometry
     * to doc space).  Scale is baked into the parameters about the local bounds centre; the remaining
     * rotation/skew/flip is kept in s.matrix (null when it is a pure translation, which is baked too).
     */
    setAffine(s, A) {
      const P = S.Paths;
      if (s.kind === 'line') {
        [s.x1, s.y1] = M.apply(A, s.x1, s.y1); [s.x2, s.y2] = M.apply(A, s.x2, s.y2);
        s.matrix = null; return s;
      }
      const lb = P.bounds(Sh.localPath(s)), cx = lb.x + lb.w / 2, cy = lb.y + lb.h / 2;
      const d = M.decompose(A);
      let sx = d.sx, sy = d.sy;
      if (!(sx > 1e-6) || !(sy > 1e-6)) { sx = 1; sy = 1; } // degenerate: keep it in the matrix
      const keepAll = !(d.sx > 1e-6) || !(d.sy > 1e-6);
      let N;
      if (keepAll) N = A.slice();
      else {
        const c = Math.cos(d.rot), sn = Math.sin(d.rot);
        // R·K, K = [[1, shear],[0, flip]]
        const RK = [c, sn, c * d.shear - sn * d.flip, sn * d.shear + c * d.flip, 0, 0];
        const t = M.apply(RK, sx * cx - cx, sy * cy - cy);
        N = [RK[0], RK[1], RK[2], RK[3], t[0] + A[4], t[1] + A[5]];
        // bake the scale about the bounds centre
        if (Math.abs(sx - 1) > 1e-9 || Math.abs(sy - 1) > 1e-9) {
          if (BOX_KINDS[s.kind]) {
            let { x, y, w, h } = s; if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
            const bx = x + w / 2, by = y + h / 2; // box centre may differ from path-bounds centre (custom shapes)
            const nbx = cx + (bx - cx) * sx, nby = cy + (by - cy) * sy;
            s.w = w * sx; s.h = h * sy; s.x = nbx - s.w / 2; s.y = nby - s.h / 2;
          } else if (s.kind === 'path') s.path = P.transform(s.path || P.empty(), (x, y) => [cx + (x - cx) * sx, cy + (y - cy) * sy]);
        }
      }
      if (M.isTranslate(N)) {
        const dx = N[4], dy = N[5];
        if (BOX_KINDS[s.kind]) { s.x += dx; s.y += dy; } else if (s.kind === 'path') s.path = P.translate(s.path || P.empty(), dx, dy);
        s.matrix = null;
      } else s.matrix = N;
      return s;
    },
    /** translate a shape in doc space (moves its repeat centre too) */
    translate(s, dx, dy) {
      if (s.kind === 'line') { s.x1 += dx; s.x2 += dx; s.y1 += dy; s.y2 += dy; }
      else if (s.matrix) { s.matrix = s.matrix.slice(); s.matrix[4] += dx; s.matrix[5] += dy; }
      else if (s.kind === 'path') s.path = S.Paths.translate(s.path || S.Paths.empty(), dx, dy);
      else { s.x += dx; s.y += dy; }
      if (s.repeat) { s.repeat.cx = (s.repeat.cx || 0) + dx; s.repeat.cy = (s.repeat.cy || 0) + dy; }
      return s;
    },
    /** Gradient image for a paint laid out on local bounds lb (margin m), returned as a canvas pattern */
    paintPattern(ctx, p, lb, margin) {
      const w = Math.max(1, lb.w), h = Math.max(1, lb.h);
      const R = { x: lb.x - margin, y: lb.y - margin, w: w + margin * 2, h: h + margin * 2 };
      const k = Math.min(1, 2048 / Math.max(R.w, R.h));
      const gw = Math.max(1, Math.ceil(R.w * k)), gh = Math.max(1, Math.ceil(R.h * k));
      const c = U.createCanvas(gw, gh), x = c.getContext('2d');
      const stops = p.stops && p.stops.length >= 2 ? p.stops : Sh.gradientDefaults(p.color).stops;
      const sc = (p.scale ?? 100) / 100 || 1, a = ((p.angle ?? 90) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
      // centre in gradient-canvas pixels
      const gx = (lb.x + w / 2 + ((p.ox || 0) / 100) * w - R.x) * k, gy = (lb.y + h / 2 + ((p.oy || 0) / 100) * h - R.y) * k;
      const type = p.type;
      if (type === 'linear' || type === 'reflected') {
        const half = ((Math.abs(ca) * w + Math.abs(sa) * h) / 2) * sc * k;
        // reflected = the stops mirrored around the centre over the same span
        const g = x.createLinearGradient(gx - ca * half, gy + sa * half, gx + ca * half, gy - sa * half);
        G.addStops(g, stops, p.reverse, type === 'reflected');
        x.fillStyle = g; x.fillRect(0, 0, gw, gh);
      } else if (type === 'radial') {
        // elliptical: fits the shape's bounds (scale 100% = touches the bounding box edges)
        const rx = Math.max(0.5, (w / 2) * sc * k), ry = Math.max(0.5, (h / 2) * sc * k);
        x.setTransform(rx, 0, 0, ry, gx, gy);
        const g = x.createRadialGradient(0, 0, 0, 0, 0, 1);
        G.addStops(g, stops, p.reverse);
        x.fillStyle = g; x.fillRect(-gx / rx - 1, -gy / ry - 1, gw / rx + 2, gh / ry + 2);
        x.setTransform(1, 0, 0, 1, 0, 0);
      } else if (type === 'angle') {
        const g = x.createConicGradient(-a, gx, gy);
        G.addStops(g, stops, p.reverse);
        x.fillStyle = g; x.fillRect(0, 0, gw, gh);
      } else { // diamond, fitted to the bounds
        const lut = G.lut(stops, p.reverse), img = x.createImageData(gw, gh), d = img.data;
        const hw = Math.max(0.5, (w / 2) * sc * k), hh = Math.max(0.5, (h / 2) * sc * k);
        for (let yy = 0; yy < gh; yy++) for (let xx = 0; xx < gw; xx++) {
          const t = Math.min(255, ((Math.abs(xx + 0.5 - gx) / hw + Math.abs(yy + 0.5 - gy) / hh) * 255)) | 0, i = (yy * gw + xx) * 4;
          d[i] = lut[t * 4]; d[i + 1] = lut[t * 4 + 1]; d[i + 2] = lut[t * 4 + 2]; d[i + 3] = lut[t * 4 + 3];
        }
        x.putImageData(img, 0, 0);
      }
      const pat = ctx.createPattern(c, 'no-repeat');
      pat.setTransform(new DOMMatrix([1 / k, 0, 0, 1 / k, R.x, R.y]));
      return pat;
    },
    /** fillStyle / strokeStyle for a paint */
    style(ctx, p, lb, margin) { return Sh.isGradient(p) ? Sh.paintPattern(ctx, p, lb, margin) : p.color; },
    render(ctx, s) {
      const local = Sh.localPath(s);
      const path2d = S.Paths.toPath2D(local);
      const lb = S.Paths.bounds(local);
      const st = s.stroke;
      const strokeOn = st && st.enabled && st.width > 0;
      const margin = strokeOn ? st.width * (st.align === 'outside' ? 2 : 1) + 2 : 2;
      // build the paint styles once (shared by every repeat copy — they live in local space)
      const fillStyle = s.fill && s.fill.enabled ? Sh.style(ctx, s.fill, lb, 2) : null;
      const strokeStyle = strokeOn ? Sh.style(ctx, st, lb, margin) : null;
      for (const m of Sh.instances(s)) {
        ctx.save();
        if (m) ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
        if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fill(path2d, 'nonzero'); }
        if (strokeOn) {
          ctx.strokeStyle = strokeStyle; ctx.lineCap = st.cap || 'round'; ctx.lineJoin = st.join || 'round';
          const w = st.width;
          ctx.setLineDash(st.dash === 'dash' ? [w * 3, w * 2] : st.dash === 'dot' ? [0.01, w * 2] : []);
          if (st.dash === 'dot') ctx.lineCap = 'round';
          if (st.align === 'inside') { ctx.save(); ctx.clip(path2d); ctx.lineWidth = w * 2; ctx.stroke(path2d); ctx.restore(); }
          else if (st.align === 'outside') {
            // draw doubled stroke, then knock out the interior (on a scratch canvas with the same transform)
            const tmp = U.scratch(ctx.canvas.width, ctx.canvas.height), tx = tmp.getContext('2d');
            tx.setTransform(ctx.getTransform());
            tx.strokeStyle = strokeStyle; tx.lineCap = ctx.lineCap; tx.lineJoin = ctx.lineJoin; tx.setLineDash(ctx.getLineDash());
            tx.lineWidth = w * 2; tx.stroke(path2d);
            tx.globalCompositeOperation = 'destination-out'; tx.fill(path2d);
            ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(tmp, 0, 0); ctx.restore(); U.release(tmp);
          } else { ctx.lineWidth = w; ctx.stroke(path2d); }
        }
        ctx.restore();
      }
    },
  });

  /* ---------------- Layer factory ---------------- */
  const L = (S.Layers = {
    TYPES: { raster: 'Layer', text: 'Text', shape: 'Shape', adjustment: 'Adjustment', fill: 'Fill', group: 'Group' },
    base(type, name) {
      return { id: U.uid('L'), type, name: name || L.TYPES[type], visible: true, opacity: 1, fillOpacity: 1, blend: type === 'group' ? 'pass-through' : 'normal',
        clip: false, locks: { pixels: false, position: false, alpha: false, all: false }, mask: null, effects: null, version: 1 };
    },
    /** New raster layer.  Without a canvas it starts empty (a tiny canvas that grows when painted). */
    raster(doc, name, canvas) {
      const l = L.base('raster', name);
      l.canvas = canvas || L.emptyCanvas();
      return l;
    },
    /** Placeholder canvas of an empty layer: it is replaced (not grown around) by the first paint operation */
    emptyCanvas() { const c = U.createCanvas(1, 1); c._empty = true; return c; },
    text(doc, t) {
      const l = L.base('text');
      l.text = Object.assign(T.defaults(), t || {});
      l.name = (l.text.text || 'Text').split('\n')[0].slice(0, 30) || 'Text';
      l.canvas = U.createCanvas(1, 1); l._rv = -1;
      return l;
    },
    shape(doc, s) {
      const l = L.base('shape');
      l.shape = Object.assign(Sh.defaults(s && s.kind), s || {});
      const names = { rect: 'Rectangle', roundRect: 'Rounded Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', star: 'Star', line: 'Line', custom: 'Custom Shape', path: 'Shape' };
      l.name = names[l.shape.kind] || 'Shape';
      l.canvas = U.createCanvas(1, 1); l._rv = -1;
      return l;
    },
    fill(doc, f) {
      const l = L.base('fill');
      l.fill = Object.assign({ kind: 'solid', color: S.app.fg, stops: G.resolve(G.PRESETS[0]), gtype: 'linear', angle: 90, scale: 100, reverse: false }, f || {});
      l.name = l.fill.kind === 'solid' ? 'Color Fill' : 'Gradient Fill';
      l.canvas = U.createCanvas(1, 1); l._rv = -1;
      l.mask = L.newMask(doc, 255);
      return l;
    },

    /* ---------- content-sized canvases ---------- */
    PAD: 48,          // headroom added when a canvas has to grow (brush strokes near the edge)
    TRIM_PAD: 2,      // transparent border kept around trimmed content (keeps resampling fringe-free)
    MAX_SIDE: 16384,
    /** Largest document-space rectangle a layer canvas may cover (memory safety for huge transforms) */
    limitRect(doc) { const m = Math.min(4096, Math.max(doc.width, doc.height)); return { x: -m, y: -m, w: doc.width + 2 * m, h: doc.height + 2 * m }; },
    /**
     * Make sure canvas c covers document rect r (in place: the canvas keeps its identity, so history
     * snapshots that share it stay consistent — growing only adds transparent pixels).  Returns true if grown.
     *   pad    headroom around r (default L.PAD)
     *   limit  optional rect the padding is clipped to (r itself is always covered) — e.g. the document, so a
     *          stroke along the canvas edge does not grow a 48-px transparent apron around the picture
     *   fill   alpha (0..255) the newly added area is filled with (sparse masks: their implicit outside value)
     */
    growTo(c, r, pad, limit, fill) {
      const cur = U.rectOf(c);
      r = U.rectRound(r); if (!r) return false;
      const p = pad == null ? L.PAD : pad;
      let want = { x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p };
      if (limit && p) want = U.rectUnion(U.rectIntersect(want, limit) || r, r);
      if (c._empty) { // placeholder of an empty layer: place the canvas where the first paint lands
        c.width = Math.min(L.MAX_SIDE, want.w); c.height = Math.min(L.MAX_SIDE, want.h); c.ox = want.x; c.oy = want.y; c._empty = false;
        if (fill) { const x = c.getContext('2d'); x.fillStyle = 'rgba(0,0,0,' + fill / 255 + ')'; x.fillRect(0, 0, c.width, c.height); }
        return true;
      }
      if (r.x >= cur.x && r.y >= cur.y && r.x + r.w <= cur.x + cur.w && r.y + r.h <= cur.y + cur.h) return false;
      let n = U.rectUnion(cur, want);
      // never shrink the existing area (it may hold pixels), but cap the size
      if (n.w > L.MAX_SIDE) { n.w = L.MAX_SIDE; if (n.x > cur.x) n.x = cur.x; if (n.x + n.w < cur.x + cur.w) n.x = cur.x + cur.w - n.w; }
      if (n.h > L.MAX_SIDE) { n.h = L.MAX_SIDE; if (n.y > cur.y) n.y = cur.y; if (n.y + n.h < cur.y + cur.h) n.y = cur.y + cur.h - n.h; }
      if (n.w === cur.w && n.h === cur.h && n.x === cur.x && n.y === cur.y) return false;
      const keep = U.scratch(cur.w, cur.h); keep.getContext('2d').drawImage(c, 0, 0);
      c.width = n.w; c.height = n.h; c.ox = n.x; c.oy = n.y; c._empty = false;
      const x = c.getContext('2d');
      if (fill) { x.fillStyle = 'rgba(0,0,0,' + fill / 255 + ')'; x.fillRect(0, 0, n.w, n.h); x.clearRect(cur.x - n.x, cur.y - n.y, cur.w, cur.h); }
      x.drawImage(keep, 0, 0, cur.w, cur.h, cur.x - n.x, cur.y - n.y, cur.w, cur.h);
      U.release(keep);
      return true;
    },
    /** ImageData of document rect r read from an offset canvas (alpha `fill` — default transparent — outside the canvas) */
    readRect(c, r, fill) {
      const sr = U.rectOf(c);
      if (r.x >= sr.x && r.y >= sr.y && r.x + r.w <= sr.x + sr.w && r.y + r.h <= sr.y + sr.h) return c.getContext('2d').getImageData(r.x - sr.x, r.y - sr.y, r.w, r.h);
      const t = document.createElement('canvas'); t.width = r.w; t.height = r.h;
      const x = t.getContext('2d', { willReadFrequently: true });
      if (fill) { x.fillStyle = 'rgba(0,0,0,' + fill / 255 + ')'; x.fillRect(0, 0, r.w, r.h); const i = U.rectIntersect(r, sr); if (i) x.clearRect(i.x - r.x, i.y - r.y, i.w, i.h); }
      U.blitRect(x, c, r, 0, 0);
      return x.getImageData(0, 0, r.w, r.h);
    },
    /** Write ImageData at document rect r (grows the canvas as needed; `fill` = alpha of newly added area) */
    writeRect(c, img, r, fill) {
      L.growTo(c, r, 0, null, fill);
      c.getContext('2d').putImageData(img, r.x - (c.ox || 0), r.y - (c.oy || 0));
    },
    /** Replace a canvas's whole content with an (offset) snapshot, in place (`fill`: alpha of the area the snapshot does not cover) */
    restoreFrom(c, snap, fill) {
      const x = c.getContext('2d');
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'copy'; x.globalAlpha = 1;
      x.drawImage(snap, (snap.ox || 0) - (c.ox || 0), (snap.oy || 0) - (c.oy || 0));
      if (fill && (snap.width < c.width || snap.height < c.height || (snap.ox || 0) !== (c.ox || 0) || (snap.oy || 0) !== (c.oy || 0))) { x.globalCompositeOperation = 'destination-over'; x.fillStyle = 'rgba(0,0,0,' + fill / 255 + ')'; x.fillRect(0, 0, c.width, c.height); }
      x.restore();
    },
    /** A new document-sized canvas (at 0,0) showing the canvas's content (for legacy whole-document code paths) */
    docCanvas(c, doc) {
      const d = U.createCanvas(doc.width, doc.height);
      d.getContext('2d').drawImage(c, c.ox || 0, c.oy || 0);
      return d;
    },
    /** Trimmed copy of a canvas: content bounds + TRIM_PAD (or a 1×1 empty canvas). The copy keeps the document position. */
    trim(c) {
      const b = L.contentBounds(c);
      if (!b) return U.createCanvas(1, 1, c.ox || 0, c.oy || 0);
      const p = L.TRIM_PAD, x = Math.max(0, b.x - p), y = Math.max(0, b.y - p), w = Math.min(c.width, b.x + b.w + p) - x, h = Math.min(c.height, b.y + b.h + p) - y;
      if (x === 0 && y === 0 && w === c.width && h === c.height) return U.cloneCanvas(c);
      const t = U.createCanvas(w, h, (c.ox || 0) + x, (c.oy || 0) + y);
      t.getContext('2d').drawImage(c, x, y, w, h, 0, 0, w, h);
      return t;
    },
    /** Shrink a canvas to its content in place (identity kept; only transparent pixels are dropped) */
    trimInPlace(c) {
      const t = L.trim(c);
      if (t.width === c.width && t.height === c.height) return false;
      c.width = t.width; c.height = t.height; c.ox = t.ox || 0; c.oy = t.oy || 0;
      c.getContext('2d').drawImage(t, 0, 0);
      return true;
    },
    /** Document-space content bounds of a layer's pixels (cached per version); null when empty */
    contentRect(l) {
      const c = l.canvas; if (!c) return null;
      const key = l.version + ':' + c.width + 'x' + c.height + '@' + (c.ox || 0) + ',' + (c.oy || 0);
      if (l._cbKey === key) return l._cb ? { ...l._cb } : null;
      const b = L.contentBounds(c);
      l._cbKey = key; l._cb = b ? { x: b.x + (c.ox || 0), y: b.y + (c.oy || 0), w: b.w, h: b.h } : null;
      return l._cb ? { ...l._cb } : null;
    },
    adjustment(doc, effectId, params) {
      const l = L.base('adjustment');
      const fx = window.ImageFX && ImageFX.adjustments[effectId];
      l.adj = { id: effectId, params: params || L.defaultParams(fx) };
      l.name = fx ? fx.name : effectId;
      // adjustment layers carry a reveal-all mask by default (like most editors)
      l.mask = L.newMask(doc, 255);
      return l;
    },
    group(doc, name) {
      const l = L.base('group', name || 'Group');
      l.children = []; l.collapsed = false;
      return l;
    },
    defaultParams(fx) {
      const p = {};
      if (fx) for (const d of fx.params) p[d.id] = JSON.parse(JSON.stringify(d.default));
      return p;
    },
    /* ---------- sparse masks ----------
       mask = { canvas, outside, enabled, density, feather, version }.  The canvas is an offset canvas that
       only covers the painted part of the mask; `outside` (0..255) is the implicit value everywhere else, so a
       reveal-all / hide-all mask costs one pixel.  The canvas grows (filled with `outside`) when painted. */
    newMask(doc, value) {
      value = value ? 255 : 0;
      const c = L.emptyCanvas();
      if (value) { const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 1, 1); }
      void doc;
      return { canvas: c, outside: value, enabled: true, density: 1, feather: 0, version: 1 };
    },
    /** A mask whose canvas is `canvas` (offset) with the given implicit outside value */
    maskFrom(canvas, outside) { return { canvas, outside: outside ? 255 : 0, enabled: true, density: 1, feather: 0, version: 1 }; },
    /** Implicit value outside a mask canvas (legacy masks without the field are document-sized → 0) */
    maskOutside(m) { return m.outside == null ? 0 : m.outside; },
    /**
     * A new canvas covering document rect r showing the raw mask (outside value filled in).
     * Pass `target` (a canvas of r.w × r.h) to draw into it instead of allocating.
     */
    maskOver(m, r, target) {
      const c = target || U.createCanvas(r.w, r.h, r.x, r.y), x = c.getContext('2d');
      const o = L.maskOutside(m), mc = m.canvas;
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
      if (o) { x.fillStyle = 'rgba(0,0,0,' + o / 255 + ')'; x.fillRect(0, 0, r.w, r.h); const i = U.rectIntersect(r, U.rectOf(mc)); if (i) x.clearRect(i.x - r.x, i.y - r.y, i.w, i.h); }
      U.blitRect(x, mc, r, 0, 0);
      x.restore();
      return c;
    },
    /** Document-sized (0,0) canvas of a mask — for selections and legacy whole-document code paths */
    maskDocCanvas(m, doc) { return L.maskOver(m, { x: 0, y: 0, w: doc.width, h: doc.height }); },
    /** Shrink a mask canvas to the area that differs from its outside value (in place) */
    trimMask(m) {
      const c = m.canvas, w = c.width, h = c.height, o = L.maskOutside(m);
      if (c._empty || w * h <= 4) return false;
      const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
      let x1 = w, y1 = h, x2 = -1, y2 = -1;
      for (let y = 0; y < h; y++) { let k = y * w * 4 + 3; for (let x = 0; x < w; x++, k += 4) if (d[k] !== o) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; y2 = y; } }
      if (x2 < 0) { // uniform: one pixel of the outside value
        c.width = c.height = 1; c._empty = true; const x = c.getContext('2d'); if (o) { x.fillStyle = '#000'; x.fillRect(0, 0, 1, 1); }
        return true;
      }
      const p = L.TRIM_PAD, nx = Math.max(0, x1 - p), ny = Math.max(0, y1 - p), nw = Math.min(w, x2 + 1 + p) - nx, nh = Math.min(h, y2 + 1 + p) - ny;
      if (nx === 0 && ny === 0 && nw === w && nh === h) return false;
      const t = U.createCanvas(nw, nh); t.getContext('2d').drawImage(c, nx, ny, nw, nh, 0, 0, nw, nh);
      c.width = nw; c.height = nh; c.ox = (c.ox || 0) + nx; c.oy = (c.oy || 0) + ny;
      c.getContext('2d').drawImage(t, 0, 0);
      return true;
    },
    /** Legacy (document-sized) mask canvas → sparse mask: pick the border value as the outside value and trim */
    sparseMask(canvas, props) {
      const m = Object.assign({ enabled: true, density: 1, feather: 0, version: 1 }, props || {}, { canvas, outside: 0 });
      const w = canvas.width, h = canvas.height;
      if (w > 2 && h > 2) {
        const x = canvas.getContext('2d', { willReadFrequently: true });
        const top = x.getImageData(0, 0, w, 1).data, bottom = x.getImageData(0, h - 1, w, 1).data, left = x.getImageData(0, 0, 1, h).data, right = x.getImageData(w - 1, 0, 1, h).data;
        const v = top[3]; let uniform = true;
        for (const row of [top, bottom, left, right]) { for (let i = 3; i < row.length && uniform; i += 4) if (row[i] !== v) uniform = false; if (!uniform) break; }
        if (uniform) m.outside = v;
      }
      L.trimMask(m);
      return m;
    },
    /** Cloned mask (new canvas) */
    cloneMask(m) { return { ...m, canvas: U.cloneCanvas(m.canvas) }; },
    /** Inverted copy of a mask */
    invertMask(m) {
      const c = U.cloneCanvas(m.canvas), x = c.getContext('2d');
      x.globalCompositeOperation = 'source-out'; x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height); // 1 − alpha
      return { ...m, canvas: c, outside: 255 - L.maskOutside(m), version: (m.version || 0) + 1 };
    },
    /** Bytes of canvas memory a layer holds (pixels + mask + effect cache) */
    bytesOf(l) {
      let b = 0;
      const sz = (c) => (c ? c.width * c.height * 4 : 0);
      if (l.canvas) b += sz(l.canvas);
      if (l.mask && l.mask.canvas) b += sz(l.mask.canvas);
      if (l._fxCache && l._fxCache.canvas) b += sz(l._fxCache.canvas);
      if (l.mask && l.mask._proc) b += sz(l.mask._proc);
      return b;
    },
    isPixel(l) { return l && (l.type === 'raster'); },
    hasCanvas(l) { return l && l.type !== 'group' && l.type !== 'adjustment'; },
    /** Document-space rectangle a parametric layer needs to render into (clipped to the document) */
    renderRect(l, doc) {
      const D = { x: 0, y: 0, w: doc.width, h: doc.height };
      if (l.type === 'fill') return D;
      let b = null, m = 4;
      if (l.type === 'text') { b = S.layerBounds ? S.layerBounds(l, doc) : null; m = Math.max(8, (l.text.size || 48) * 1.2); }
      else if (l.type === 'shape') {
        b = S.Shape.bounds(l.shape); const st = l.shape.stroke;
        const sw = st && st.enabled ? st.width : 0;
        m = 4 + sw * (st && st.join === 'miter' ? 10 : 2) + (l.shape.kind === 'line' ? (l.shape.lineWidth || 0) * 3 : 0);
      }
      if (!b || !(b.w >= 0) || !(b.h >= 0)) return D;
      const r = U.rectRound({ x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m });
      return (r && U.rectIntersect(r, D)) || { x: 0, y: 0, w: 1, h: 1 };
    },
    /**
     * Make sure parametric layers have up-to-date pixels (content-sized canvas, clipped to the document).
     * Fill layers are painted procedurally by the compositor (see Compositor.paintFill) and keep only a
     * 1×1 placeholder canvas here; code that needs their pixels calls L.materialize().
     */
    ensure(l, doc) {
      if (!l || !L.hasCanvas(l)) return;
      if (l.type === 'raster') { if (!l.canvas) l.canvas = U.createCanvas(1, 1); return; }
      const sz = doc.width + 'x' + doc.height;
      if (l.canvas && l._rv === l.version && l._rsz === sz) return;
      if (l.type === 'fill') {
        const c = (l.canvas = U.createCanvas(1, 1)); c._procedural = true;
        l._rv = l.version; l._rsz = sz;
        return;
      }
      const r = L.renderRect(l, doc);
      const c = (l.canvas = U.createCanvas(r.w, r.h, r.x, r.y));
      const ctx = c.getContext('2d');
      if (l.type === 'shape') {
        // gradient patterns are sampled in device space: render at document coordinates (pooled scratch) and
        // copy the content rectangle, so the result is bit-identical to a document-sized canvas
        const t = U.scratch(doc.width, doc.height);
        Sh.render(t.getContext('2d'), l.shape);
        ctx.drawImage(t, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        U.release(t);
      } else {
        ctx.translate(-r.x, -r.y);
        if (l.type === 'text') T.render(ctx, l.text);
        else if (l.type === 'fill') L.renderFill(ctx, l.fill, doc.width, doc.height);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      l._rv = l.version; l._rsz = sz;
    },
    /** Full pixels of a layer as a document-positioned canvas (fill layers are rendered over the whole document) */
    materialize(l, doc) {
      L.ensure(l, doc);
      if (l.type !== 'fill') return U.cloneCanvas(l.canvas);
      const c = U.createCanvas(doc.width, doc.height);
      L.renderFill(c.getContext('2d'), l.fill, doc.width, doc.height);
      return c;
    },
    /** Paint a fill layer over document rect R of a ctx that maps document coordinates */
    renderFill(ctx, f, w, h, R) {
      R = R || { x: 0, y: 0, w, h };
      if (f.kind === 'solid') { ctx.fillStyle = f.color; ctx.fillRect(R.x, R.y, R.w, R.h); return; }
      const a = ((f.angle || 0) * Math.PI) / 180, cx = w / 2 + (f.ox || 0), cy = h / 2 + (f.oy || 0);
      const half = ((Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * h) / 2) * (f.scale || 100) / 100;
      const type = f.gtype || 'linear';
      let spec;
      if (type === 'linear') spec = { x1: cx - Math.cos(a) * half, y1: cy + Math.sin(a) * half, x2: cx + Math.cos(a) * half, y2: cy - Math.sin(a) * half };
      else spec = { x1: cx, y1: cy, x2: cx + Math.cos(a) * half, y2: cy - Math.sin(a) * half };
      G.paintRect(ctx, Object.assign(spec, { stops: f.stops, type, reverse: f.reverse }), R);
    },
    /** Deep-ish clone for history snapshots (canvases shared by reference) */
    cloneMeta(l) {
      const c = Object.assign({}, l);
      c.locks = { ...l.locks };
      if (l.mask) c.mask = { ...l.mask };
      if (l.effects) c.effects = JSON.parse(JSON.stringify(l.effects));
      if (l.text) c.text = JSON.parse(JSON.stringify(l.text));
      if (l.shape) c.shape = JSON.parse(JSON.stringify(l.shape));
      if (l.fill) c.fill = JSON.parse(JSON.stringify(l.fill));
      if (l.adj) c.adj = JSON.parse(JSON.stringify(l.adj));
      if (l.children) c.children = l.children.map(L.cloneMeta);
      delete c._fxCache; delete c._thumb;
      // cached Layers-panel thumbnail canvases are DOM nodes: a copy must never share them
      // (a node can only sit in one row, so duplicates showed an empty/black thumbnail)
      for (const k in c) if (k.startsWith('_th_')) delete c[k];
      return c;
    },
    /** True duplicate with copied pixels (for Duplicate Layer) */
    duplicate(l, doc) {
      const c = L.cloneMeta(l);
      const fresh = (x) => {
        x.id = U.uid('L');
        if (x.canvas) x.canvas = U.cloneCanvas(x.canvas);
        if (x.mask) x.mask = { ...x.mask, canvas: U.cloneCanvas(x.mask.canvas) };
        x._rv = -1; x.version = (x.version || 1) + 1;
        if (x.children) x.children.forEach(fresh);
      };
      fresh(c);
      c.name = l.name + ' copy';
      void doc;
      return c;
    },
    /** Bounding box of non-transparent pixels of a canvas (or null) */
    contentBounds(canvas, threshold = 0) {
      const w = canvas.width, h = canvas.height;
      const img = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
      if (threshold > 0) {
        const d = img.data;
        let x1 = w, y1 = h, x2 = -1, y2 = -1;
        for (let y = 0; y < h; y++) {
          let row = y * w * 4;
          for (let x = 0; x < w; x++, row += 4) if (d[row + 3] > threshold) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; y2 = y; }
        }
        return x2 < 0 ? null : { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 };
      }
      // alpha 0 pixels read back as 0,0,0,0 → a non-zero 32-bit word means "has coverage"
      const p = new Uint32Array(img.data.buffer);
      let y1 = 0, y2 = h - 1;
      const rowHas = (y) => { const o = y * w; for (let x = 0; x < w; x++) if (p[o + x]) return true; return false; };
      while (y1 < h && !rowHas(y1)) y1++;
      if (y1 >= h) return null;
      while (y2 > y1 && !rowHas(y2)) y2--;
      let x1 = w, x2 = -1;
      for (let y = y1; y <= y2; y++) {
        const o = y * w;
        for (let x = 0; x < x1; x++) if (p[o + x]) { x1 = x; break; }
        for (let x = w - 1; x > x2; x--) if (p[o + x]) { x2 = x; break; }
      }
      return { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 };
    },
  });
})();
