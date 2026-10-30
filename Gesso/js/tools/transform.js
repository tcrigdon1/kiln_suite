/* =========================================================================
   Gesso — Move tool and Free Transform.

   Free Transform conventions (shown in the options bar hint):
     • drag inside: move          • drag corner: scale proportionally
     • Shift + corner: free scale • Alt: scale from centre
     • drag outside the box: rotate (Shift snaps to 15°)
     • Ctrl + corner: distort (perspective)   • Ctrl + edge: skew
     • Enter / ✓ commits, Esc / ✕ cancels
   Works on: raster layers, the current selection's pixels, text layers
   (re-editable — stored as a matrix), shape layers (stay parametric: scale is baked
   into the parameters, rotation/skew go into shape.matrix; only perspective distort
   turns a shape into a path), and groups / several selected layers at once.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util, T = S.Tools;

  /* ---------------- geometry helpers ---------------- */
  const G = (S.Geom = {
    affineFromRect(r, c) {
      const a = (c[1].x - c[0].x) / r.w, b = (c[1].y - c[0].y) / r.w;
      const cc = (c[3].x - c[0].x) / r.h, d = (c[3].y - c[0].y) / r.h;
      return [a, b, cc, d, c[0].x - a * r.x - cc * r.y, c[0].y - b * r.x - d * r.y];
    },
    apply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; },
    mul(m, n) { // m ∘ n
      return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
    },
    invert(m) {
      const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
      return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
    },
    isAffine(c) { return Math.hypot(c[2].x - (c[1].x + c[3].x - c[0].x), c[2].y - (c[1].y + c[3].y - c[0].y)) < 0.5; },
    /** homography mapping unit square → quad c (returns fn(u,v) → [x,y]) */
    homography(c) {
      const [p0, p1, p2, p3] = c;
      const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
      const sx = p0.x - p1.x + p2.x - p3.x, sy = p0.y - p1.y + p2.y - p3.y;
      let g = 0, h = 0;
      if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
        const den = dx1 * dy2 - dx2 * dy1 || 1e-12;
        g = (sx * dy2 - dx2 * sy) / den; h = (dx1 * sy - sx * dy1) / den;
      }
      const a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + h * p3.x, cx = p0.x;
      const d = p1.y - p0.y + g * p1.y, e = p3.y - p0.y + h * p3.y, f = p0.y;
      return (u, v) => { const w = g * u + h * v + 1; return [(a * u + b * v + cx) / w, (d * u + e * v + f) / w]; };
    },
    /** draw src (region r) mapped to quad c onto ctx */
    drawQuad(ctx, src, r, c, quality) {
      ctx.imageSmoothingEnabled = quality !== 'nearest';
      ctx.imageSmoothingQuality = quality === 'bicubic' ? 'high' : quality === 'bilinear' ? 'medium' : 'low';
      const sox = src.ox || 0, soy = src.oy || 0;
      if (G.isAffine(c)) {
        ctx.save();
        const m = G.affineFromRect(r, c);
        ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
        ctx.drawImage(src, r.x - sox, r.y - soy, r.w, r.h, r.x, r.y, r.w, r.h);
        ctx.restore();
        return;
      }
      const H = G.homography(c), N = Math.max(8, Math.min(28, Math.round(Math.max(r.w, r.h) / 40)));
      const pts = [];
      for (let j = 0; j <= N; j++) { pts[j] = []; for (let i = 0; i <= N; i++) pts[j][i] = H(i / N, j / N); }
      const tri = (s0, s1, s2, d0, d1, d2) => {
        // expand destination triangle slightly to hide seams
        const cx = (d0[0] + d1[0] + d2[0]) / 3, cy = (d0[1] + d1[1] + d2[1]) / 3;
        const ex = (p) => { const dx = p[0] - cx, dy = p[1] - cy, l = Math.hypot(dx, dy) || 1; return [p[0] + (dx / l) * 0.6, p[1] + (dy / l) * 0.6]; };
        const e0 = ex(d0), e1 = ex(d1), e2 = ex(d2);
        ctx.save();
        ctx.beginPath(); ctx.moveTo(e0[0], e0[1]); ctx.lineTo(e1[0], e1[1]); ctx.lineTo(e2[0], e2[1]); ctx.closePath(); ctx.clip();
        // affine mapping source triangle → dest triangle
        const [x0, y0] = s0, [x1, y1] = s1, [x2, y2] = s2;
        const den = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0) || 1e-12;
        const a = ((d1[0] - d0[0]) * (y2 - y0) - (d2[0] - d0[0]) * (y1 - y0)) / den;
        const b = ((d1[1] - d0[1]) * (y2 - y0) - (d2[1] - d0[1]) * (y1 - y0)) / den;
        const cc = ((d2[0] - d0[0]) * (x1 - x0) - (d1[0] - d0[0]) * (x2 - x0)) / den;
        const d = ((d2[1] - d0[1]) * (x1 - x0) - (d1[1] - d0[1]) * (x2 - x0)) / den;
        ctx.transform(a, b, cc, d, d0[0] - a * x0 - cc * y0, d0[1] - b * x0 - d * y0);
        ctx.drawImage(src, sox, soy);
        ctx.restore();
      };
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const sx0 = r.x + (i / N) * r.w, sx1 = r.x + ((i + 1) / N) * r.w, sy0 = r.y + (j / N) * r.h, sy1 = r.y + ((j + 1) / N) * r.h;
        tri([sx0, sy0], [sx1, sy0], [sx1, sy1], pts[j][i], pts[j][i + 1], pts[j + 1][i + 1]);
        tri([sx0, sy0], [sx1, sy1], [sx0, sy1], pts[j][i], pts[j + 1][i + 1], pts[j + 1][i]);
      }
    },
    /** map a point of rect r through quad c (affine or projective) */
    mapPoint(r, c, x, y) {
      if (G.isAffine(c)) return G.apply(G.affineFromRect(r, c), x, y);
      return G.homography(c)((x - r.x) / r.w, (y - r.y) / r.h);
    },
  });

  /* ---------------- layer bounds ---------------- */
  function layerBounds(l, doc) {
    if (l.type === 'group') {
      let b = null; doc.walk((c) => { if (c.type !== 'group') { const cb = layerBounds(c, doc); if (cb) b = U.rectUnion(b, cb); } }, l.children);
      return b;
    }
    if (l.type === 'adjustment' || l.type === 'fill') return { x: 0, y: 0, w: doc.width, h: doc.height };
    if (l.type === 'text') {
      const lay = S.Text.layout(l.text); const bb = lay.bbox;
      if (!l.text.matrix) return bb;
      const pts = [[bb.x, bb.y], [bb.x + bb.w, bb.y], [bb.x + bb.w, bb.y + bb.h], [bb.x, bb.y + bb.h]].map((p) => G.apply(l.text.matrix, p[0], p[1]));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    if (l.type === 'shape') { const b = S.Shape.bounds(l.shape); const sw = l.shape.stroke && l.shape.stroke.enabled ? l.shape.stroke.width : 0; return { x: b.x - sw / 2, y: b.y - sw / 2, w: b.w + sw, h: b.h + sw }; }
    S.Layers.ensure(l, doc);
    return S.Layers.contentRect(l);
  }
  S.layerBounds = layerBounds;
  /** Document rect covered by a transformed source rect (for sizing the destination canvas) */
  function quadBounds(corners, doc) {
    const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
    const b = U.rectRound({ x: Math.min(...xs) - 2, y: Math.min(...ys) - 2, w: Math.max(...xs) - Math.min(...xs) + 4, h: Math.max(...ys) - Math.min(...ys) + 4 });
    return (b && U.rectIntersect(b, S.Layers.limitRect(doc))) || { x: 0, y: 0, w: 1, h: 1 };
  }
  /** Fresh canvas covering doc rect b with a context translated into document space */
  function canvasFor(b) { const c = U.createCanvas(b.w, b.h, b.x, b.y); const x = c.getContext('2d'); x.translate(-b.x, -b.y); return [c, x]; }
  /**
   * Sparse masks under transform: `maskSrc` is the raw mask materialised over the transform rect (see
   * maskSource); the result is a new mask canvas covering the mapped quad, everything else keeps the
   * mask's implicit outside value.
   */
  function maskSource(m, rect) { return m.canvas._empty ? null : S.Layers.maskOver(m, U.rectRound(rect) || { x: 0, y: 0, w: 1, h: 1 }); }
  function maskQuad(m, maskSrc, rect, corners, q, doc) {
    if (!maskSrc) return { ...m, canvas: U.cloneCanvas(m.canvas), version: (m.version || 0) + 1 };
    const b = quadBounds(corners, doc), [nc, cx] = canvasFor(b);
    const o = S.Layers.maskOutside(m);
    G.drawQuad(cx, maskSrc, rect, corners, q);
    if (o) {
      // outside value everywhere the quad does not cover
      const cov = U.createCanvas(b.w, b.h), kx = cov.getContext('2d');
      kx.fillStyle = 'rgba(0,0,0,' + o / 255 + ')'; kx.fillRect(0, 0, b.w, b.h);
      kx.translate(-b.x, -b.y); kx.globalCompositeOperation = 'destination-out';
      kx.beginPath(); corners.forEach((p, i) => (i ? kx.lineTo(p.x, p.y) : kx.moveTo(p.x, p.y))); kx.closePath(); kx.fill();
      cx.save(); cx.setTransform(1, 0, 0, 1, 0, 0); cx.globalCompositeOperation = 'destination-over'; cx.drawImage(cov, 0, 0); cx.restore();
    }
    U.resetCtx(nc);
    return { ...m, canvas: nc, version: (m.version || 0) + 1 };
  }

  /* ---------------- moving layers ---------------- */
  /** Translate a layer by dx,dy relative to its state captured in `orig` (see prepareMove) */
  function prepareMove(l, doc) {
    const o = { l };
    if (l.type === 'raster') { o.canvas = l.canvas; l.canvas = U.cloneCanvas(o.canvas); if (l.embed) { o.em = l.embed.matrix.slice(); l.embed = { ...l.embed, matrix: o.em.slice() }; } }
    if (l.mask) { o.mask = l.mask.canvas; l.mask = { ...l.mask, canvas: U.cloneCanvas(o.mask), version: (l.mask.version || 0) + 1 }; }
    if (l.type === 'text') o.t = { x: l.text.x, y: l.text.y, m: l.text.matrix ? l.text.matrix.slice() : null };
    if (l.type === 'shape') o.s = JSON.parse(JSON.stringify(l.shape));
    if (l.type === 'fill') o.f = { ox: l.fill.ox || 0, oy: l.fill.oy || 0 };
    if (l.type === 'group') o.children = l.children.map((c) => prepareMove(c, doc));
    return o;
  }
  function applyMove(o, dx, dy, doc) {
    const l = o.l;
    if (o.canvas) { l.canvas.ox = (o.canvas.ox || 0) + dx; l.canvas.oy = (o.canvas.oy || 0) + dy; }
    if (o.em) { l.embed.matrix = o.em.slice(); l.embed.matrix[4] += dx; l.embed.matrix[5] += dy; l._ev = l.embed.version; }
    if (o.mask) {
      // sparse mask: moves with its offset; the area that comes into view takes the mask's outside value
      l.mask.canvas.ox = (o.mask.ox || 0) + dx; l.mask.canvas.oy = (o.mask.oy || 0) + dy;
      l.mask.version = (l.mask.version || 0) + 1;
    }
    if (o.t) { if (o.t.m) { l.text.matrix = o.t.m.slice(); l.text.matrix[4] += dx; l.text.matrix[5] += dy; } else { l.text.x = o.t.x + dx; l.text.y = o.t.y + dy; } }
    if (o.s) l.shape = S.Shape.translate(JSON.parse(JSON.stringify(o.s)), dx, dy);
    if (o.f) { l.fill.ox = o.f.ox + dx; l.fill.oy = o.f.oy + dy; }
    if (o.children) o.children.forEach((c) => applyMove(c, dx, dy, doc));
    l.version++; l._thumbDirty = true;
  }
  S.moveLayers = function (doc, layers, dx, dy, name, key) {
    layers = layers.filter((l) => !(l.locks.position || l.locks.all));
    if (!layers.length) { S.toast('Layer position is locked'); return; }
    doc.commit(name || 'Move', () => { for (const l of layers) applyMove(prepareMove(l, doc), dx, dy, doc); }, { key });
  };

  function topLayerAt(doc, x, y, list = doc.layers) {
    for (let i = list.length - 1; i >= 0; i--) {
      const l = list[i];
      if (!l.visible) continue;
      if (l.type === 'group') { const r = topLayerAt(doc, x, y, l.children); if (r) return r; continue; }
      if (!S.Layers.hasCanvas(l)) continue;
      if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) continue;
      if (l.type === 'fill') return l; // fills cover the whole document
      S.Layers.ensure(l, doc);
      const c = l.canvas, lx = (x | 0) - (c.ox || 0), ly = (y | 0) - (c.oy || 0);
      if (lx < 0 || ly < 0 || lx >= c.width || ly >= c.height) continue;
      const a = U.samplePixels(c, lx, ly)[3];
      if (a > 10) return l;
    }
    return null;
  }
  S.topLayerAt = topLayerAt;

  /* ---------------- alignment ---------------- */
  S.alignLayers = function (doc, how) {
    const layers = doc.selectedLayers().filter((l) => !(l.locks.position || l.locks.all));
    if (!layers.length) return;
    const ref = doc.selection ? doc.selection.bounds : layers.length > 1 && !S.Tools.byId.move.opts.alignToCanvas
      ? layers.map((l) => layerBounds(l, doc)).filter(Boolean).reduce((a, b) => U.rectUnion(a, b), null)
      : { x: 0, y: 0, w: doc.width, h: doc.height };
    if (!ref) return;
    doc.commit('Align', () => {
      for (const l of layers) {
        const b = layerBounds(l, doc); if (!b) continue;
        let dx = 0, dy = 0;
        if (how === 'left') dx = ref.x - b.x; if (how === 'right') dx = ref.x + ref.w - (b.x + b.w); if (how === 'hcenter') dx = ref.x + ref.w / 2 - (b.x + b.w / 2);
        if (how === 'top') dy = ref.y - b.y; if (how === 'bottom') dy = ref.y + ref.h - (b.y + b.h); if (how === 'vcenter') dy = ref.y + ref.h / 2 - (b.y + b.h / 2);
        applyMove(prepareMove(l, doc), Math.round(dx), Math.round(dy), doc);
      }
    });
  };

  /** distribute ≥ 3 selected layers: 'h' / 'v' = even centre spacing, 'hgap' / 'vgap' = even gaps between edges */
  S.distributeLayers = function (doc, how) {
    const layers = doc.selectedLayers().filter((l) => !(l.locks.position || l.locks.all)).map((l) => ({ l, b: layerBounds(l, doc) })).filter((x) => x.b);
    if (layers.length < 3) { S.toast('Select at least three layers to distribute'); return; }
    const horiz = how[0] === 'h', gap = how.endsWith('gap');
    const pos = (b) => (horiz ? b.x : b.y), size = (b) => (horiz ? b.w : b.h);
    layers.sort((a, b) => pos(a.b) + size(a.b) / 2 - (pos(b.b) + size(b.b) / 2));
    const first = layers[0].b, last = layers[layers.length - 1].b;
    doc.commit('Distribute', () => {
      if (gap) {
        const total = pos(last) + size(last) - pos(first), used = layers.reduce((a, x) => a + size(x.b), 0), g = (total - used) / (layers.length - 1);
        let cur = pos(first);
        for (const x of layers) { const d = Math.round(cur - pos(x.b)); if (d) applyMove(prepareMove(x.l, doc), horiz ? d : 0, horiz ? 0 : d, doc); cur += size(x.b) + g; }
      } else {
        const c0 = pos(first) + size(first) / 2, c1 = pos(last) + size(last) / 2, step = (c1 - c0) / (layers.length - 1);
        layers.forEach((x, i) => { const d = Math.round(c0 + i * step - (pos(x.b) + size(x.b) / 2)); if (d) applyMove(prepareMove(x.l, doc), horiz ? d : 0, horiz ? 0 : d, doc); });
      }
    });
  };

  /* ======================= Move tool ======================= */
  T.register({
    id: 'move', name: 'Move', key: 'V', icon: 'move', group: 'move', cursor: 'move',
    opts: { autoSelect: false, autoWhat: 'layer', showBounds: true, alignToCanvas: true },
    options(bar) {
      const ui = T.ui, o = this.opts;
      ui.check(bar, 'Auto-select', o, 'autoSelect');
      ui.select(bar, '', o, 'autoWhat', [{ value: 'layer', label: 'Layer' }, { value: 'group', label: 'Group' }]);
      ui.check(bar, 'Show bounds', o, 'showBounds');
      ui.sep(bar);
      const al = (icon, how, tip) => ui.button(bar, '', () => S.app.doc && S.alignLayers(S.app.doc, how), { icon, tip });
      al('alignL', 'left', 'Align left edges'); al('alignCH', 'hcenter', 'Align horizontal centers'); al('alignR', 'right', 'Align right edges');
      al('alignT', 'top', 'Align top edges'); al('alignCV', 'vcenter', 'Align vertical centers'); al('alignB', 'bottom', 'Align bottom edges');
      ui.check(bar, 'To canvas', o, 'alignToCanvas');
      bar.appendChild(U.el('span', { class: 'muted opt-hint' }, 'Aligns to selection when one exists'));
    },
    onDown(info, doc) {
      if (this.opts.autoSelect || info.ctrl) {
        let l = topLayerAt(doc, info.x, info.y);
        if (l && this.opts.autoWhat === 'group') { let p = doc.parentInfo(l.id); while (p && p.parent) { l = p.parent; p = doc.parentInfo(l.id); } }
        if (l && l.id !== doc.activeId) doc.setActive(l.id, info.shift ? 'toggle' : null);
      }
      const active = doc.activeLayer();
      if (!active) return;
      const before = doc.captureState();
      // move selected pixels when a selection exists on a raster layer
      if (doc.selection && active.type === 'raster' && !active.editMask) {
        if (active.locks.all || active.locks.pixels || active.locks.position) { S.toast('Layer is locked'); return; }
        const sel = doc.selection, sc = S.Sel.canvas(sel), sb = sel.bounds, src = active.canvas;
        const float = U.createCanvas(sb.w, sb.h, sb.x, sb.y), fx = float.getContext('2d');
        fx.drawImage(src, (src.ox || 0) - sb.x, (src.oy || 0) - sb.y); fx.globalCompositeOperation = 'destination-in'; fx.drawImage(sc, -sb.x, -sb.y);
        const rest = U.cloneCanvas(src), rx = rest.getContext('2d');
        if (!info.alt) { rx.globalCompositeOperation = 'destination-out'; rx.drawImage(sc, -(rest.ox || 0), -(rest.oy || 0)); }
        active.canvas = U.cloneCanvas(rest);
        this.drag = { kind: 'float', before, x0: info.x, y0: info.y, l: active, float, rest, sel, b: sel.bounds, dx: 0, dy: 0 };
        this.renderFloat(doc);
        return;
      }
      const layers = doc.selectedLayers().filter((l) => !(l.locks.position || l.locks.all));
      if (!layers.length) { S.toast('Layer position is locked'); return; }
      const bounds = layers.map((l) => layerBounds(l, doc)).filter(Boolean).reduce((a, b) => U.rectUnion(a, b), null);
      this.drag = { kind: 'layers', before, x0: info.x, y0: info.y, orig: layers.map((l) => prepareMove(l, doc)), b: bounds, dx: 0, dy: 0 };
    },
    onMove(info, doc) {
      const d = this.drag; if (!d) return;
      let dx = Math.round(info.x - d.x0), dy = Math.round(info.y - d.y0);
      if (info.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      if (d.b) { const [sx, sy] = S.View.snapRect({ x: d.b.x + dx, y: d.b.y + dy, w: d.b.w, h: d.b.h }); dx += Math.round(sx); dy += Math.round(sy); }
      if (dx === d.dx && dy === d.dy) return;
      d.dx = dx; d.dy = dy;
      if (d.kind === 'float') this.renderFloat(doc);
      else { for (const o of d.orig) applyMove(o, dx, dy, doc); doc.invalidate(); }
    },
    renderFloat(doc) {
      const d = this.drag, c = d.l.canvas;
      const fr = U.rectOf(d.float); fr.x += d.dx; fr.y += d.dy;
      S.Layers.growTo(c, U.rectIntersect(fr, S.Layers.limitRect(doc)) || fr, 0);
      const x = c.getContext('2d');
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height); x.translate(-(c.ox || 0), -(c.oy || 0));
      U.drawAt(x, d.rest); x.drawImage(d.float, fr.x, fr.y); x.restore();
      d.l.version++; d.l._thumbDirty = true;
      doc.selection = d.dx || d.dy ? S.Sel.shift(d.sel, d.dx, d.dy) : d.sel;
      doc.invalidate();
    },
    onUp(info, doc) {
      const d = this.drag; this.drag = null;
      if (!d) return;
      if (!d.dx && !d.dy && !(d.kind === 'float' && info.alt)) { doc.restoreState(d.before); return; }
      doc.pushState(d.kind === 'float' ? 'Move Selection Contents' : 'Move', d.before);
    },
    onKey(e, doc) {
      const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!k || e.ctrlKey || e.metaKey) return false;
      const m = e.shiftKey ? 10 : 1;
      const l = doc.activeLayer();
      if (doc.selection && l && l.type === 'raster') {
        // nudge selection contents
        this.onDown({ x: 0, y: 0, alt: false, shift: false, ctrl: false }, doc);
        if (this.drag) { this.drag.dx = k[0] * m; this.drag.dy = k[1] * m; this.renderFloat(doc); this.onUp({ alt: false }, doc); }
      } else S.moveLayers(doc, doc.selectedLayers(), k[0] * m, k[1] * m, 'Nudge', 'nudge');
      return true;
    },
    drawOverlay(ctx, doc) {
      if (!this.opts.showBounds) return;
      const l = doc.activeLayer();
      if (!l || l.type === 'adjustment' || l.type === 'fill') return;
      if (this._bKey !== l.id + ':' + l.version) { this._b = layerBounds(l, doc); this._bKey = l.id + ':' + l.version; }
      const b = this._b; if (!b) return;
      const [x1, y1] = S.View.toScreen(b.x, b.y), [x2, y2] = S.View.toScreen(b.x + b.w, b.y + b.h);
      ctx.strokeStyle = 'rgba(61,191,174,.85)'; ctx.lineWidth = 1; ctx.strokeRect(Math.round(x1) + 0.5, Math.round(y1) + 0.5, Math.round(x2 - x1), Math.round(y2 - y1));
      if (this.drag) S.App.hud(ctx, x2 + 8, y2 + 8, 'Δx ' + this.drag.dx + '  Δy ' + this.drag.dy);
    },
  });

  /* ======================= Free Transform ======================= */
  const TR = (S.Transform = {});
  TR.active = null;

  TR.begin = function (opts) {
    opts = opts || {};
    const doc = S.app.doc; if (!doc) return;
    if (TR.active) return;
    const l = doc.activeLayer() || (opts.selectionOnly ? { locks: {}, type: 'none', version: 0 } : null);
    if (!l) { S.toast('No layer selected'); return; }
    if (!opts.selectionOnly && (l.locks.all || l.locks.position)) { S.toast('Layer is locked'); return; }
    const before = doc.captureState();
    const st = { doc, l, before, quality: S.app.prefs.interpolation || 'bicubic', prevTool: S.app.tool, kind: null };
    const selLayers = opts.selectionOnly ? [] : doc.selectedLayers();
    const multi = !opts.selectionOnly && (l.type === 'group' || selLayers.length > 1) && !(doc.selection && l.type === 'raster' && selLayers.length === 1);
    if (multi) {
      // groups / several selected layers: one box around everything, each layer transformed in its own way
      const leaves = [], seen = new Set();
      const add = (x) => { if (seen.has(x.id)) return; seen.add(x.id); if (x.type === 'group') x.children.forEach(add); else if (['raster', 'text', 'shape'].includes(x.type) && !(x.locks.all || x.locks.position)) leaves.push(x); };
      selLayers.forEach(add);
      let R = null;
      for (const x of leaves) { const b = layerBounds(x, doc); if (b && b.w > 0 && b.h > 0) R = U.rectUnion(R, b); }
      if (!leaves.length || !R) { S.toast('Nothing to transform in the selected layers'); return; }
      st.kind = 'multi';
      st.rect = { x: R.x, y: R.y, w: Math.max(1, R.w), h: Math.max(1, R.h) };
      st.items = leaves.map((x) => {
        if (x.type === 'raster') {
          const it = { l: x, kind: 'raster', src: x.canvas, mask0: x.mask, maskSrc: x.mask ? maskSource(x.mask, st.rect) : null, embed0: x.embed ? x.embed.matrix.slice() : null };
          x.canvas = S.Layers.emptyCanvas();
          if (x.embed) x.embed = { ...x.embed };
          if (x.mask) x.mask = { ...x.mask, canvas: U.cloneCanvas(x.mask.canvas) };
          return it;
        }
        if (x.type === 'text') return { l: x, kind: 'text', m0: x.text.matrix ? x.text.matrix.slice() : [1, 0, 0, 1, 0, 0] };
        return { l: x, kind: 'shape', shape0: JSON.parse(JSON.stringify(x.shape)), m0: x.shape.matrix ? x.shape.matrix.slice() : [1, 0, 0, 1, 0, 0] };
      });
    } else if (opts.selectionOnly) {
      if (!doc.selection) return;
      st.kind = 'selmask';
      st.src = U.cloneCanvas(S.Sel.canvas(doc.selection));
      st.rect = { ...doc.selection.bounds };
    } else if (doc.selection && l.type === 'raster' && !l.editMask) {
      const sc = S.Sel.canvas(doc.selection), sb = doc.selection.bounds, src0 = l.canvas;
      st.kind = 'float';
      st.src = U.createCanvas(sb.w, sb.h, sb.x, sb.y);
      const fx = st.src.getContext('2d'); fx.drawImage(src0, (src0.ox || 0) - sb.x, (src0.oy || 0) - sb.y); fx.globalCompositeOperation = 'destination-in'; fx.drawImage(sc, -sb.x, -sb.y);
      st.rest = U.cloneCanvas(src0);
      const rx = st.rest.getContext('2d'); rx.globalCompositeOperation = 'destination-out'; rx.drawImage(sc, -(st.rest.ox || 0), -(st.rest.oy || 0));
      const cb = S.Layers.contentBounds(st.src);
      st.rect = cb ? { x: cb.x + sb.x, y: cb.y + sb.y, w: cb.w, h: cb.h } : { ...sb };
      st.selSrc = sc;
      st.selRect = doc.selection.bounds;
      l.canvas = S.Layers.emptyCanvas();
    } else if (l.type === 'raster') {
      const target = l.editMask && l.mask ? 'mask' : 'pixels';
      st.kind = target === 'mask' ? 'mask' : 'raster';
      if (target === 'mask') {
        // transform the mask itself: work on the mask materialised over the document (and its own canvas)
        st.rect = U.rectUnion({ x: 0, y: 0, w: doc.width, h: doc.height }, U.rectOf(l.mask.canvas));
        st.mask0 = l.mask; st.maskSrc = maskSource(l.mask, st.rect);
        if (!st.maskSrc) { S.toast('The mask is uniform — nothing to transform'); return; }
        l.mask = { ...l.mask, canvas: U.cloneCanvas(l.mask.canvas) };
      } else {
        st.src = l.canvas;
        st.rect = S.Layers.contentRect(l);
        if (!st.rect) { S.toast('Layer is empty'); return; }
        l.canvas = S.Layers.emptyCanvas();
        if (l.embed) { st.embed0 = l.embed.matrix.slice(); l.embed = { ...l.embed }; }
        // move the mask along with the pixels
        if (l.mask) { st.mask0 = l.mask; st.maskSrc = maskSource(l.mask, st.rect); l.mask = { ...l.mask, canvas: U.cloneCanvas(l.mask.canvas) }; }
      }
    } else if (l.type === 'text') {
      st.kind = 'text';
      st.rect = S.Text.layout(l.text).bbox;
      st.m0 = l.text.matrix ? l.text.matrix.slice() : [1, 0, 0, 1, 0, 0];
    } else if (l.type === 'shape') {
      // transform the parametric shape in its local frame: the result is stored back as parameters +
      // a persistent matrix (S.Shape.setAffine), so star points, corner radii etc. stay editable
      st.kind = 'shape';
      st.path = S.Shape.localPath(l.shape);
      st.rect = S.Paths.bounds(st.path);
      st.shape0 = JSON.parse(JSON.stringify(l.shape));
      st.m0 = l.shape.matrix ? l.shape.matrix.slice() : [1, 0, 0, 1, 0, 0];
      if (st.rect.w < 1) st.rect.w = 1; if (st.rect.h < 1) st.rect.h = 1;
    } else { S.toast('Free Transform works on pixel, text and shape layers'); return; }
    const r = st.rect;
    if (st.kind === 'text' || st.kind === 'shape') {
      st.corners = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map((p) => { const q = G.apply(st.m0, p[0], p[1]); return { x: q[0], y: q[1] }; });
    } else st.corners = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
    st.c0 = st.corners.map((c) => ({ ...c }));
    TR.active = st;
    // temporarily switch to the transform pseudo-tool
    S.app.tool = TR.tool;
    S.Tools.renderOptions(); S.Tools.renderStrip(); S.View.updateCursor(); S.bus.emit('tool:changed', TR.tool);
    if (opts.apply) { opts.apply(st); TR.render(); TR.commit(); return; }
    TR.render();
  };
  TR.render = function (finalQuality) {
    const st = TR.active; if (!st) return;
    const { doc, l } = st;
    const q = finalQuality || (st.dragging ? 'bilinear' : st.quality);
    if (st.kind === 'multi') {
      const affine = G.isAffine(st.corners);
      // text can only be affine: use the parallelogram spanned by corners 0, 1, 3
      const c3 = affine ? st.corners : [st.corners[0], st.corners[1], { x: st.corners[1].x + st.corners[3].x - st.corners[0].x, y: st.corners[1].y + st.corners[3].y - st.corners[0].y }, st.corners[3]];
      const A = G.affineFromRect(st.rect, c3);
      const sc = Math.sqrt(Math.abs(polyArea(st.corners)) / Math.max(1, polyArea(st.c0)));
      for (const it of st.items) {
        const x = it.l;
        if (it.kind === 'raster') {
          if (it.embed0) { x.embed.matrix = G.mul(A, it.embed0); S.Embed.bump(x); S.Embed.render(x, doc); }
          else { const [nc, cx] = canvasFor(quadBounds(st.corners, doc)); x.canvas = nc; G.drawQuad(cx, it.src, st.rect, st.corners, q); U.resetCtx(nc); }
          if (it.mask0) x.mask = maskQuad(it.mask0, it.maskSrc, st.rect, st.corners, q, doc);
        } else if (it.kind === 'text') {
          x.text.matrix = G.mul(A, it.m0);
        } else {
          const sh = JSON.parse(JSON.stringify(it.shape0));
          if (affine) {
            if (sh.repeat) [sh.repeat.cx, sh.repeat.cy] = G.apply(A, sh.repeat.cx || 0, sh.repeat.cy || 0);
            S.Shape.setAffine(sh, G.mul(A, it.m0));
          } else {
            sh.path = S.Paths.transform(S.Shape.toPath(it.shape0), (px, py) => G.mapPoint(st.rect, st.corners, px, py));
            sh.kind = 'path'; sh.matrix = null; sh.repeat = null;
          }
          if (sh.stroke) sh.stroke.width = it.shape0.stroke.width * (isFinite(sc) ? sc : 1);
          if (sh.kind === 'line') sh.lineWidth = it.shape0.lineWidth * (isFinite(sc) ? sc : 1);
          x.shape = sh;
        }
        x.version++; x._thumbDirty = true;
      }
      doc.invalidate();
      return;
    }
    if (st.kind === 'selmask') {
      if (st.dragging && !finalQuality) { S.View.redraw(); return; }
      const c = U.createCanvas(doc.width, doc.height);
      G.drawQuad(c.getContext('2d'), st.src, st.rect, st.corners, 'bilinear');
      doc.selection = S.Sel.make(S.Sel.alphaOf(c), doc.width, doc.height);
      S.View.redraw();
      return;
    }
    if (st.kind === 'mask') {
      l.mask = maskQuad(st.mask0, st.maskSrc, st.rect, st.corners, q, doc);
    } else if (st.kind === 'float' || st.kind === 'raster') {
      if (st.embed0 && G.isAffine(st.corners)) {
        // embedded object: compose the matrix and re-render from the untouched source (no generation loss)
        l.embed.matrix = G.mul(G.affineFromRect(st.rect, st.corners), st.embed0); S.Embed.bump(l); S.Embed.render(l, doc); st.embedPersp = false;
      } else {
        let b = quadBounds(st.corners, doc);
        if (st.kind === 'float') b = U.rectUnion(b, U.rectOf(st.rest));
        const [nc, x] = canvasFor(b); l.canvas = nc; x.save();
        if (st.kind === 'float') U.drawAt(x, st.rest);
        G.drawQuad(x, st.src, st.rect, st.corners, q);
        x.restore(); U.resetCtx(nc);
        if (st.embed0) st.embedPersp = true;
      }
      if (st.mask0) l.mask = maskQuad(st.mask0, st.maskSrc, st.rect, st.corners, q, doc);
    } else if (st.kind === 'text') {
      if (!G.isAffine(st.corners)) { // text supports affine only
        st.corners[2] = { x: st.corners[1].x + st.corners[3].x - st.corners[0].x, y: st.corners[1].y + st.corners[3].y - st.corners[0].y };
      }
      l.text.matrix = G.affineFromRect(st.rect, st.corners);
    } else if (st.kind === 'shape') {
      const s = JSON.parse(JSON.stringify(st.shape0));
      if (G.isAffine(st.corners)) {
        // corners = local rect mapped by the full affine (old matrix included)
        S.Shape.setAffine(s, G.affineFromRect(st.rect, st.corners));
        st.distorted = false;
      } else {
        // perspective distort cannot be expressed parametrically: bake into a path
        s.path = S.Paths.transform(st.path, (x, y) => G.mapPoint(st.rect, st.corners, x, y));
        s.kind = 'path'; s.matrix = null;
        st.distorted = true;
      }
      if (s.stroke && st.shape0.stroke) {
        const sc = Math.sqrt(Math.abs(polyArea(st.corners)) / Math.max(1, polyArea(st.c0)));
        s.stroke.width = st.shape0.stroke.width * (isFinite(sc) ? sc : 1);
      }
      if (s.kind === 'line' && st.shape0.kind === 'line') {
        const sc = Math.sqrt(Math.abs(polyArea(st.corners)) / Math.max(1, polyArea(st.c0)));
        s.lineWidth = st.shape0.lineWidth * (isFinite(sc) ? sc : 1);
      }
      l.shape = s;
    }
    l.version++; l._thumbDirty = true;
    doc.invalidate();
  };
  function polyArea(c) { let a = 0; for (let i = 0; i < 4; i++) { const p = c[i], n = c[(i + 1) % 4]; a += p.x * n.y - n.x * p.y; } return Math.abs(a / 2); }

  TR.commit = function () {
    const st = TR.active; if (!st) return;
    TR.render(st.quality);
    const { doc } = st;
    if (st.kind === 'float') {
      // transform the selection too
      const c = U.createCanvas(doc.width, doc.height);
      G.drawQuad(c.getContext('2d'), st.selSrc, st.rect, st.corners, 'bilinear');
      doc.selection = S.Sel.make(S.Sel.alphaOf(c), doc.width, doc.height);
    }
    TR.active = null;
    if (st.embedPersp) { S.Embed.rasterize(st.l); S.toast('Perspective distort rasterized the embedded object'); }
    doc.pushState('Free Transform', st.before);
    if (st.kind === 'shape' && st.distorted && st.shape0.kind !== 'path') S.toast('Perspective distort turned the shape into a path');
    TR.exit(st);
  };
  TR.cancel = function () {
    const st = TR.active; if (!st) return;
    TR.active = null;
    st.doc.restoreState(st.before);
    S.bus.emit('layers:changed', st.doc);
    TR.exit(st);
  };
  TR.exit = function (st) {
    S.app.tool = st.prevTool && st.prevTool !== TR.tool ? st.prevTool : S.Tools.byId.move;
    S.Tools.renderOptions(); S.Tools.renderStrip(); S.View.updateCursor(); S.View.redraw();
    S.bus.emit('tool:changed', S.app.tool);
  };
  /** Instant transforms (flip / rotate 90) using the same pipeline */
  TR.instant = function (fn) {
    TR.begin({ apply: (st) => {
      const r = st.rect, cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      st.corners = st.corners.map((p) => { const q = fn(p.x - cx, p.y - cy); return { x: q[0] + cx, y: q[1] + cy }; });
    } });
  };

  /* ---------------- numeric helpers (for options bar) ---------------- */
  function decompose(st) {
    const c = st.corners;
    const cx = (c[0].x + c[1].x + c[2].x + c[3].x) / 4, cy = (c[0].y + c[1].y + c[2].y + c[3].y) / 4;
    const w = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y), h = Math.hypot(c[3].x - c[0].x, c[3].y - c[0].y);
    const a = (Math.atan2(c[1].y - c[0].y, c[1].x - c[0].x) * 180) / Math.PI;
    const w0 = Math.hypot(st.c0[1].x - st.c0[0].x, st.c0[1].y - st.c0[0].y), h0 = Math.hypot(st.c0[3].x - st.c0[0].x, st.c0[3].y - st.c0[0].y);
    return { cx, cy, sw: (w / w0) * 100, sh: (h / h0) * 100, a };
  }
  function recompose(st, v) {
    // rebuild an affine box from centre, scale %, angle based on original rect
    const w0 = Math.hypot(st.c0[1].x - st.c0[0].x, st.c0[1].y - st.c0[0].y), h0 = Math.hypot(st.c0[3].x - st.c0[0].x, st.c0[3].y - st.c0[0].y);
    const w = (w0 * v.sw) / 100, h = (h0 * v.sh) / 100, a = (v.a * Math.PI) / 180;
    const ux = Math.cos(a), uy = Math.sin(a), vx = -Math.sin(a), vy = Math.cos(a);
    st.corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => ({ x: v.cx + (sx * w * ux) / 2 + (sy * h * vx) / 2, y: v.cy + (sx * w * uy) / 2 + (sy * h * vy) / 2 }));
  }

  /* ---------------- the transform pseudo-tool ---------------- */
  TR.tool = {
    id: 'transform', name: 'Free Transform', icon: 'move', group: '_transform', key: '', opts: { constrain: true },
    options(bar) {
      const st = TR.active; if (!st) return;
      const v = decompose(st), ui = T.ui;
      const vals = { cx: Math.round(v.cx), cy: Math.round(v.cy), sw: +v.sw.toFixed(1), sh: +v.sh.toFixed(1), a: +v.a.toFixed(1) };
      const upd = () => { recompose(st, vals); TR.render(); S.View.redraw(); };
      ui.num(bar, 'X', vals, 'cx', -30000, 30000, { unit: 'px', onChange: upd });
      ui.num(bar, 'Y', vals, 'cy', -30000, 30000, { unit: 'px', onChange: upd });
      ui.num(bar, 'W', vals, 'sw', -10000, 10000, { unit: '%', step: 0.1, onChange: (val) => { if (this.opts.constrain) vals.sh = val; upd(); S.Tools.syncOptions(); } });
      ui.check(bar, 'Link', this.opts, 'constrain').title = 'Keep W and H linked in the numeric fields';
      ui.num(bar, 'H', vals, 'sh', -10000, 10000, { unit: '%', step: 0.1, onChange: (val) => { if (this.opts.constrain) vals.sw = val; upd(); S.Tools.syncOptions(); } });
      ui.num(bar, '∠', vals, 'a', -360, 360, { unit: '°', step: 0.1, onChange: upd });
      ui.select(bar, 'Interpolation', st, 'quality', [{ value: 'nearest', label: 'Nearest Neighbor' }, { value: 'bilinear', label: 'Bilinear' }, { value: 'bicubic', label: 'Bicubic (smooth)' }], () => TR.render());
      ui.sep(bar);
      ui.button(bar, '', () => TR.flip('h'), { icon: 'flipH', tip: 'Flip horizontal' });
      ui.button(bar, '', () => TR.rot90(), { icon: 'rotateCW', tip: 'Rotate 90° CW' });
      ui.sep(bar);
      ui.button(bar, 'Cancel', () => TR.cancel(), { tip: 'Esc' });
      ui.button(bar, 'Commit', () => TR.commit(), { primary: true, tip: 'Enter' });
      bar.appendChild(U.el('span', { class: 'muted opt-hint' }, 'Shift: free scale · Alt: from centre · Ctrl+corner: distort · Ctrl+edge: skew · outside: rotate'));
      TR._vals = vals;
    },
    syncNumbers() { const st = TR.active; if (!st || !TR._vals) return; const v = decompose(st); Object.assign(TR._vals, { cx: Math.round(v.cx), cy: Math.round(v.cy), sw: +v.sw.toFixed(1), sh: +v.sh.toFixed(1), a: +v.a.toFixed(1) }); S.Tools.syncOptions(); },
    hit(info, doc) {
      const st = TR.active; const c = st.corners.map((p) => S.View.toScreen(p.x, p.y, doc));
      for (let i = 0; i < 4; i++) if (Math.hypot(c[i][0] - info.sx, c[i][1] - info.sy) < 8) return { type: 'corner', i };
      for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4]; if (Math.hypot((a[0] + b[0]) / 2 - info.sx, (a[1] + b[1]) / 2 - info.sy) < 8) return { type: 'edge', i }; }
      // inside quad?
      const p = new Path2D(); p.moveTo(c[0][0], c[0][1]); for (let i = 1; i < 4; i++) p.lineTo(c[i][0], c[i][1]); p.closePath();
      if (S.View.ctx.isPointInPath(p, info.sx * S.View.dpr, info.sy * S.View.dpr)) return { type: 'move' };
      return { type: 'rotate' };
    },
    cursor() {
      const h = this._hover;
      if (!h) return 'default';
      if (h.type === 'move') return 'move';
      if (h.type === 'rotate') return 'alias';
      if (h.type === 'corner') return h.i % 2 ? 'nesw-resize' : 'nwse-resize';
      return h.i % 2 ? 'ew-resize' : 'ns-resize';
    },
    onHover(info, doc) { if (!TR.active) return; this._hover = this.hit(info, doc); S.View.updateCursor(); },
    onDown(info, doc) {
      const st = TR.active; if (!st) return;
      const h = this.hit(info, doc);
      st.dragging = { h, x0: info.x, y0: info.y, corners: st.corners.map((p) => ({ ...p })), ctrl: info.ctrl };
    },
    onMove(info) {
      const st = TR.active; if (!st || !st.dragging) return;
      const d = st.dragging, h = d.h, c0 = d.corners;
      const dx = info.x - d.x0, dy = info.y - d.y0;
      const cx = (c0[0].x + c0[1].x + c0[2].x + c0[3].x) / 4, cy = (c0[0].y + c0[1].y + c0[2].y + c0[3].y) / 4;
      if (h.type === 'move') {
        let mx = dx, my = dy;
        const xs = c0.map((p) => p.x + mx), ys = c0.map((p) => p.y + my);
        const [sx, sy] = S.View.snapRect({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
        mx += sx; my += sy;
        st.corners = c0.map((p) => ({ x: p.x + mx, y: p.y + my }));
      } else if (h.type === 'rotate') {
        const a0 = Math.atan2(d.y0 - cy, d.x0 - cx), a1 = Math.atan2(info.y - cy, info.x - cx);
        let da = a1 - a0;
        if (info.shift) { const base = Math.atan2(c0[1].y - c0[0].y, c0[1].x - c0[0].x); const tgt = Math.round((base + da) / (Math.PI / 12)) * (Math.PI / 12); da = tgt - base; }
        const cs = Math.cos(da), sn = Math.sin(da);
        st.corners = c0.map((p) => ({ x: cx + (p.x - cx) * cs - (p.y - cy) * sn, y: cy + (p.x - cx) * sn + (p.y - cy) * cs }));
      } else if (h.type === 'corner' && (d.ctrl || info.ctrl)) {
        st.corners = c0.map((p) => ({ ...p }));
        st.corners[h.i] = { x: c0[h.i].x + dx, y: c0[h.i].y + dy };
        if (st.kind === 'text') st.corners = c0; // text: no distort
      } else if (h.type === 'edge' && (d.ctrl || info.ctrl)) {
        // skew: move both corners of this edge along the edge direction
        const i = h.i, j = (i + 1) % 4;
        const ex = c0[j].x - c0[i].x, ey = c0[j].y - c0[i].y, el = Math.hypot(ex, ey) || 1;
        const t = (dx * ex + dy * ey) / el;
        st.corners = c0.map((p) => ({ ...p }));
        st.corners[i] = { x: c0[i].x + (ex / el) * t, y: c0[i].y + (ey / el) * t };
        st.corners[j] = { x: c0[j].x + (ex / el) * t, y: c0[j].y + (ey / el) * t };
      } else {
        // scale in the box's local frame (u = c0→c1, v = c0→c3)
        const ux = c0[1].x - c0[0].x, uy = c0[1].y - c0[0].y, vx = c0[3].x - c0[0].x, vy = c0[3].y - c0[0].y;
        const det = ux * vy - uy * vx || 1e-9;
        const toLocal = (x, y) => { const px = x - c0[0].x, py = y - c0[0].y; return [(px * vy - py * vx) / det, (ux * py - uy * px) / det]; };
        const LOC = [[0, 0], [1, 0], [1, 1], [0, 1]];
        let hx, hy, useX = true, useY = true;
        if (h.type === 'corner') [hx, hy] = LOC[h.i];
        else { const a = LOC[h.i], b = LOC[(h.i + 1) % 4]; hx = (a[0] + b[0]) / 2; hy = (a[1] + b[1]) / 2; useX = hx !== 0.5; useY = hy !== 0.5; }
        const ax = info.alt ? 0.5 : 1 - hx, ay = info.alt ? 0.5 : 1 - hy;
        const [mx, my] = toLocal(info.x, info.y);
        let sx = useX ? (mx - ax) / (hx - ax || 1e-9) : 1, sy = useY ? (my - ay) / (hy - ay || 1e-9) : 1;
        const proportional = h.type === 'corner' ? !info.shift : info.shift;
        if (proportional) {
          if (h.type === 'corner') { const s = Math.abs(sx) > Math.abs(sy) ? sx : sy; sx = Math.sign(sx || 1) * Math.abs(s); sy = Math.sign(sy || 1) * Math.abs(s); }
          else if (useX) sy = Math.abs(sx); else sx = Math.abs(sy);
        }
        const map = (lx, ly) => { const nx = ax + (lx - ax) * sx, ny = ay + (ly - ay) * sy; return { x: c0[0].x + nx * ux + ny * vx, y: c0[0].y + nx * uy + ny * vy }; };
        // apply via local coordinates of each (possibly distorted) corner
        st.corners = c0.map((p) => { const [lx, ly] = toLocal(p.x, p.y); return map(lx, ly); });
      }
      TR.render();
      this.syncNumbers();
    },
    onUp() { const st = TR.active; if (!st) return; st.dragging = null; TR.render(); this.syncNumbers(); },
    onDblClick(info, doc) { if (this.hit(info, doc).type === 'move') TR.commit(); },
    onKey(e) {
      if (e.key === 'Enter') { TR.commit(); return true; }
      if (e.key === 'Escape') { TR.cancel(); return true; }
      // document undo/redo underneath a live transform would corrupt it: Ctrl+Z resets the box
      // (then cancels), Ctrl+Y / Ctrl+Shift+Z are ignored
      if ((e.ctrlKey || e.metaKey) && /^[zy]$/i.test(e.key)) {
        const st = TR.active;
        if (st && e.key.toLowerCase() === 'z' && !e.shiftKey) {
          const same = st.corners.every((p, i) => Math.abs(p.x - st.c0[i].x) < 1e-6 && Math.abs(p.y - st.c0[i].y) < 1e-6);
          if (same) TR.cancel(); else { st.corners = st.c0.map((c) => ({ ...c })); TR.render(); this.syncNumbers(); S.toast('Transform reset (Esc cancels)', 900); }
        }
        return true;
      }
      const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (k && TR.active) { const m = e.shiftKey ? 10 : 1; TR.active.corners = TR.active.corners.map((p) => ({ x: p.x + k[0] * m, y: p.y + k[1] * m })); TR.render(); this.syncNumbers(); return true; }
      return false;
    },
    commitOnSwitch() { TR.commit(); },
    get hideAnts() { return !(TR.active && TR.active.kind === 'selmask'); },
    drawOverlay(ctx, doc) {
      const st = TR.active; if (!st) return;
      const c = st.corners.map((p) => S.View.toScreen(p.x, p.y, doc));
      ctx.lineWidth = 1; ctx.strokeStyle = '#f0913a';
      ctx.beginPath(); c.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke();
      const hs = 4;
      const handle = (x, y) => { ctx.fillStyle = '#1c1916'; ctx.fillRect(x - hs, y - hs, hs * 2, hs * 2); ctx.strokeRect(x - hs + 0.5, y - hs + 0.5, hs * 2 - 1, hs * 2 - 1); };
      for (let i = 0; i < 4; i++) { handle(c[i][0], c[i][1]); const n = c[(i + 1) % 4]; handle((c[i][0] + n[0]) / 2, (c[i][1] + n[1]) / 2); }
      const cx = (c[0][0] + c[2][0]) / 2, cy = (c[0][1] + c[2][1]) / 2;
      ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.stroke();
      if (st.dragging) { const v = decompose(st); S.App.hud(ctx, S.View.mouse.sx + 16, S.View.mouse.sy + 16, st.dragging.h.type === 'rotate' ? v.a.toFixed(1) + '°' : 'W ' + v.sw.toFixed(1) + '%  H ' + v.sh.toFixed(1) + '%'); }
    },
  };
  TR.flip = function (axis) {
    const st = TR.active; if (!st) return;
    const c = st.corners;
    st.corners = axis === 'h' ? [c[1], c[0], c[3], c[2]] : [c[3], c[2], c[1], c[0]];
    TR.render(); TR.tool.syncNumbers(); S.View.redraw();
  };
  TR.rot90 = function () {
    const st = TR.active; if (!st) return;
    const c = st.corners, cx = (c[0].x + c[2].x) / 2, cy = (c[0].y + c[2].y) / 2;
    st.corners = c.map((p) => ({ x: cx - (p.y - cy), y: cy + (p.x - cx) }));
    TR.render(); TR.tool.syncNumbers(); S.View.redraw();
  };
})();
