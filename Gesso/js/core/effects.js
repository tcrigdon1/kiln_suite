/* =========================================================================
   Gesso — Layer Effects (non-destructive, rendered at composite time)
   layer.effects = { enabled: true, items: { dropShadow: {on:true, ...params}, ... } }
   Parameters use the same ParamDef format as ImageFX so the generic
   parameter UI can edit them.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util;

  const blendSel = (def) => ({ id: 'blend', label: 'Blend Mode', type: 'select', default: def,
    options: S.BLEND_MODES.filter((m) => m && m.id !== 'dissolve').map((m) => ({ value: m.id, label: m.label })) });

  const DEFS = [
    { id: 'dropShadow', name: 'Drop Shadow', params: [
      blendSel('multiply'), { id: 'color', label: 'Color', type: 'color', default: '#000000' },
      { id: 'opacity', label: 'Opacity', type: 'range', default: 70, min: 0, max: 100, unit: '%' },
      { id: 'angle', label: 'Angle', type: 'angle', default: 120 },
      { id: 'distance', label: 'Distance', type: 'range', default: 10, min: 0, max: 300, unit: 'px' },
      { id: 'spread', label: 'Spread', type: 'range', default: 0, min: 0, max: 100, unit: '%' },
      { id: 'size', label: 'Size', type: 'range', default: 12, min: 0, max: 250, unit: 'px' },
    ] },
    { id: 'innerShadow', name: 'Inner Shadow', params: [
      blendSel('multiply'), { id: 'color', label: 'Color', type: 'color', default: '#000000' },
      { id: 'opacity', label: 'Opacity', type: 'range', default: 70, min: 0, max: 100, unit: '%' },
      { id: 'angle', label: 'Angle', type: 'angle', default: 120 },
      { id: 'distance', label: 'Distance', type: 'range', default: 6, min: 0, max: 300, unit: 'px' },
      { id: 'choke', label: 'Choke', type: 'range', default: 0, min: 0, max: 100, unit: '%' },
      { id: 'size', label: 'Size', type: 'range', default: 8, min: 0, max: 250, unit: 'px' },
    ] },
    { id: 'outerGlow', name: 'Outer Glow', params: [
      blendSel('screen'), { id: 'color', label: 'Color', type: 'color', default: '#ffd08a' },
      { id: 'opacity', label: 'Opacity', type: 'range', default: 75, min: 0, max: 100, unit: '%' },
      { id: 'spread', label: 'Spread', type: 'range', default: 0, min: 0, max: 100, unit: '%' },
      { id: 'size', label: 'Size', type: 'range', default: 18, min: 0, max: 250, unit: 'px' },
    ] },
    { id: 'innerGlow', name: 'Inner Glow', params: [
      blendSel('screen'), { id: 'color', label: 'Color', type: 'color', default: '#fff3c4' },
      { id: 'opacity', label: 'Opacity', type: 'range', default: 75, min: 0, max: 100, unit: '%' },
      { id: 'source', label: 'Source', type: 'select', default: 'edge', options: [{ value: 'edge', label: 'Edge' }, { value: 'center', label: 'Center' }] },
      { id: 'choke', label: 'Choke', type: 'range', default: 0, min: 0, max: 100, unit: '%' },
      { id: 'size', label: 'Size', type: 'range', default: 14, min: 0, max: 250, unit: 'px' },
    ] },
    { id: 'stroke', name: 'Stroke', params: [
      { id: 'size', label: 'Size', type: 'range', default: 3, min: 1, max: 100, unit: 'px' },
      { id: 'position', label: 'Position', type: 'select', default: 'outside', options: [{ value: 'outside', label: 'Outside' }, { value: 'inside', label: 'Inside' }, { value: 'center', label: 'Center' }] },
      blendSel('normal'), { id: 'color', label: 'Color', type: 'color', default: '#f0913a' },
      { id: 'opacity', label: 'Opacity', type: 'range', default: 100, min: 0, max: 100, unit: '%' },
    ] },
    { id: 'colorOverlay', name: 'Color Overlay', params: [
      blendSel('normal'), { id: 'color', label: 'Color', type: 'color', default: '#3dbfae' },
      { id: 'opacity', label: 'Opacity', type: 'range', default: 100, min: 0, max: 100, unit: '%' },
    ] },
    { id: 'gradientOverlay', name: 'Gradient Overlay', params: [
      blendSel('normal'), { id: 'opacity', label: 'Opacity', type: 'range', default: 100, min: 0, max: 100, unit: '%' },
      { id: 'gradient', label: 'Gradient', type: 'gradient', default: [{ pos: 0, color: '#241445' }, { pos: 0.5, color: '#b33f6b' }, { pos: 1, color: '#ffb36b' }] },
      { id: 'style', label: 'Style', type: 'select', default: 'linear', options: ['linear', 'radial', 'angle', 'reflected', 'diamond'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })) },
      { id: 'angle', label: 'Angle', type: 'angle', default: 90 },
      { id: 'scale', label: 'Scale', type: 'range', default: 100, min: 10, max: 150, unit: '%' },
      { id: 'reverse', label: 'Reverse', type: 'checkbox', default: false },
    ] },
  ];

  const FX = (S.Effects = {
    GRID: 32, // effect caches are aligned to this grid (see compose)
    DEFS,
    def(id) { return DEFS.find((d) => d.id === id); },
    defaults(id) { const p = { on: true }; for (const d of FX.def(id).params) p[d.id] = JSON.parse(JSON.stringify(d.default)); return p; },
    /** Does this layer have any active effect? */
    active(l) {
      if (!l.effects || l.effects.enabled === false) return false;
      for (const k in l.effects.items) if (l.effects.items[k] && l.effects.items[k].on) return true;
      return false;
    },
    signature(l) { return JSON.stringify(l.effects); },

    /* --- helpers --- */
    silhouette(src, color, w, h) {
      const c = U.createCanvas(w, h), x = c.getContext('2d');
      x.drawImage(src, 0, 0);
      x.globalCompositeOperation = 'source-in';
      x.fillStyle = color; x.fillRect(0, 0, w, h);
      return c;
    },
    /** Grow a silhouette by r px by stamping it on rings of offsets (GPU friendly) */
    dilate(src, r, w, h) {
      if (r < 0.5) return src;
      const c = U.createCanvas(w, h), x = c.getContext('2d');
      x.drawImage(src, 0, 0);
      const rings = r > 6 ? [r, r * 0.66, r * 0.33] : [r, r * 0.5];
      for (const rr of rings) {
        const n = Math.max(8, Math.ceil(rr * 1.6));
        for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; x.drawImage(src, Math.cos(a) * rr, Math.sin(a) * rr); }
      }
      return c;
    },
    blurred(src, r, w, h) {
      if (r < 0.5) return src;
      const c = U.createCanvas(w, h), x = c.getContext('2d');
      x.filter = 'blur(' + r + 'px)';
      x.drawImage(src, 0, 0);
      return c;
    },
    inverse(src, color, w, h) {
      const c = U.createCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = color; x.fillRect(0, 0, w, h);
      x.globalCompositeOperation = 'destination-out'; x.drawImage(src, 0, 0);
      return c;
    },

    /** How far (px) a layer's effects can extend beyond its content (blur ≈ 3σ, plus distance / spread) */
    reach(l) {
      const it = l.effects && l.effects.items || {};
      let r = 0;
      const ext = (p, dist) => { if (p && p.on) r = Math.max(r, (dist || 0) + (p.size || 0) * 3 + 8); };
      ext(it.dropShadow, it.dropShadow && it.dropShadow.distance); ext(it.outerGlow); ext(it.innerGlow); ext(it.innerShadow, it.innerShadow && it.innerShadow.distance); ext(it.stroke);
      return Math.ceil(r);
    },
    /**
     * Compose a layer's content with its effects.
     * content: (offset) canvas, already masked.  Returns a new canvas positioned in the document, covering
     * the content plus the effects' reach, clipped to the document.
     */
    compose(content, l, doc) {
      const cr = U.rectOf(content), R = FX.reach(l);
      // the working rectangle is aligned to a 64-px grid anchored at the document origin: the browser's
      // blur filter downsamples large radii, so keeping the same grid phase as a document-sized canvas
      // keeps the result identical to one
      const A = FX.GRID, wx = Math.floor((cr.x - R) / A) * A, wy = Math.floor((cr.y - R) / A) * A;
      const want = { x: wx, y: wy, w: Math.ceil((cr.x + cr.w + R - wx) / A) * A, h: Math.ceil((cr.y + cr.h + R - wy) / A) * A };
      const out0 = U.rectIntersect(want, { x: 0, y: 0, w: doc.width, h: doc.height }) || { x: 0, y: 0, w: 1, h: 1 };
      const w = out0.w, h = out0.h;
      // work on a canvas of the output size; `content` below is the layer drawn at its offset inside it
      const base = U.createCanvas(w, h); base.getContext('2d').drawImage(content, cr.x - out0.x, cr.y - out0.y);
      content = base;
      const outC = FX.composeAt(content, l, w, h, out0.x, out0.y, doc);
      outC.ox = out0.x; outC.oy = out0.y;
      return outC;
    },
    composeAt(content, l, w, h, ox = 0, oy = 0, doc = null) {
      const items = l.effects.items, fill = l.fillOpacity ?? 1;
      const out = U.createCanvas(w, h), o = out.getContext('2d');
      const on = (k) => items[k] && items[k].on;
      const blendDraw = (ctx, src, p, dx = 0, dy = 0) => {
        ctx.save(); ctx.globalAlpha = (p.opacity ?? 100) / 100; ctx.globalCompositeOperation = S.blendOp(p.blend);
        ctx.drawImage(src, dx, dy); ctx.restore();
      };
      // ---------- under content ----------
      if (on('dropShadow')) {
        const p = items.dropShadow;
        let s = FX.silhouette(content, p.color, w, h);
        const spread = (p.size * p.spread) / 100;
        if (spread) s = FX.dilate(s, spread, w, h);
        s = FX.blurred(s, (p.size - spread) / 2, w, h);
        const a = (p.angle * Math.PI) / 180;
        blendDraw(o, s, p, -Math.cos(a) * p.distance, Math.sin(a) * p.distance);
      }
      if (on('outerGlow')) {
        const p = items.outerGlow;
        let s = FX.silhouette(content, p.color, w, h);
        const spread = (p.size * p.spread) / 100;
        s = FX.dilate(s, spread + 1, w, h);
        s = FX.blurred(s, Math.max(1, (p.size - spread) / 2), w, h);
        blendDraw(o, s, p);
      }
      // ---------- content (with fill opacity) ----------
      o.save(); o.globalAlpha = fill; o.drawImage(content, 0, 0); o.restore();

      // ---------- interior effects: rendered on a layer clipped to content alpha ----------
      const needsInner = on('innerShadow') || on('innerGlow') || on('colorOverlay') || on('gradientOverlay');
      if (needsInner) {
        const inner = U.createCanvas(w, h), ix = inner.getContext('2d');
        // base the overlays on the content so blend modes have something to blend with
        ix.drawImage(content, 0, 0);
        if (on('gradientOverlay')) {
          const p = items.gradientOverlay;
          const b = S.Layers.contentBounds(content) || { x: 0, y: 0, w, h };
          const g = U.createCanvas(w, h), gx = g.getContext('2d');
          // lay the gradient out in document coordinates (translate the context) so it samples exactly like
          // a document-sized canvas would, whatever the content rectangle's position
          const a = (p.angle * Math.PI) / 180, cx = b.x + ox + b.w / 2, cy = b.y + oy + b.h / 2;
          const half = ((Math.abs(Math.cos(a)) * b.w + Math.abs(Math.sin(a)) * b.h) / 2) * p.scale / 100;
          const spec = p.style === 'linear'
            ? { x1: cx - Math.cos(a) * half, y1: cy + Math.sin(a) * half, x2: cx + Math.cos(a) * half, y2: cy - Math.sin(a) * half }
            : { x1: cx, y1: cy, x2: cx + Math.cos(a) * half, y2: cy - Math.sin(a) * half };
          // (gradients are evaluated in device space: paint on a document-sized pooled scratch and copy the window)
          if (doc && (ox || oy)) {
            const sc = U.scratch(doc.width, doc.height);
            S.Gradient.paintRect(sc.getContext('2d'), Object.assign(spec, { stops: p.gradient, type: p.style, reverse: p.reverse }), { x: ox, y: oy, w, h });
            gx.drawImage(sc, ox, oy, w, h, 0, 0, w, h); U.release(sc);
          } else S.Gradient.paintRect(gx, Object.assign(spec, { stops: p.gradient, type: p.style, reverse: p.reverse }), { x: 0, y: 0, w, h });
          gx.globalCompositeOperation = 'destination-in'; gx.drawImage(content, 0, 0);
          blendDraw(ix, g, p);
        }
        if (on('colorOverlay')) {
          const p = items.colorOverlay;
          blendDraw(ix, FX.silhouette(content, p.color, w, h), p);
        }
        if (on('innerGlow')) {
          const p = items.innerGlow;
          let s;
          if (p.source === 'center') { s = FX.silhouette(content, p.color, w, h); s = FX.dilate(FX.inverse(s, '#000', w, h), p.size * 0.5, w, h); s = FX.inverse(s, p.color, w, h); }
          else s = FX.inverse(content, p.color, w, h);
          const choke = (p.size * p.choke) / 100;
          if (choke) s = FX.dilate(s, choke, w, h);
          s = FX.blurred(s, Math.max(1, (p.size - choke) / 2), w, h);
          blendDraw(ix, s, p);
        }
        if (on('innerShadow')) {
          const p = items.innerShadow;
          let s = FX.inverse(content, p.color, w, h);
          const choke = (p.size * p.choke) / 100;
          if (choke) s = FX.dilate(s, choke, w, h);
          s = FX.blurred(s, (p.size - choke) / 2, w, h);
          const a = (p.angle * Math.PI) / 180;
          blendDraw(ix, s, p, -Math.cos(a) * p.distance, Math.sin(a) * p.distance);
        }
        ix.globalCompositeOperation = 'destination-in'; ix.drawImage(content, 0, 0);
        // remove the base copy of content that we added (keep only what changed): simplest is
        // to draw the whole interior layer at the fill opacity's complement over the content.
        o.save();
        if (fill < 1) {
          // when fill opacity is reduced, interior effects should still show fully: draw them
          // over a cleared interior
          o.globalCompositeOperation = 'destination-out'; o.drawImage(content, 0, 0);
          o.globalCompositeOperation = 'source-over';
          // redraw shadows/glows under (they were knocked out under content) — acceptable approximation
        }
        o.drawImage(inner, 0, 0);
        o.restore();
      }
      // ---------- stroke on top ----------
      if (on('stroke')) {
        const p = items.stroke, sz = p.size;
        const sil = FX.silhouette(content, p.color, w, h);
        let ring;
        if (p.position === 'outside') {
          ring = FX.dilate(sil, sz, w, h);
          const rx = ring.getContext('2d'); rx.globalCompositeOperation = 'destination-out'; rx.drawImage(content, 0, 0);
        } else if (p.position === 'inside') {
          const inv = FX.dilate(FX.inverse(content, '#000', w, h), sz, w, h);
          ring = FX.silhouette(content, p.color, w, h);
          const rx = ring.getContext('2d'); rx.globalCompositeOperation = 'destination-in'; rx.drawImage(inv, 0, 0);
        } else {
          ring = FX.dilate(sil, sz / 2, w, h);
          const inv = FX.dilate(FX.inverse(content, '#000', w, h), sz / 2, w, h);
          const inner = FX.silhouette(content, p.color, w, h);
          const ix = inner.getContext('2d'); ix.globalCompositeOperation = 'destination-out'; ix.drawImage(inv, 0, 0);
          const rx = ring.getContext('2d'); rx.globalCompositeOperation = 'destination-out'; rx.drawImage(inner, 0, 0);
        }
        blendDraw(o, ring, p);
      }
      return out;
    },
  });
})();
