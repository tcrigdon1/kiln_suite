/* =========================================================================
   Gesso — selection tools: Rectangle/Ellipse marquee, Lasso, Polygonal
   lasso, Magic Wand, Quick Selection brush.
   Modifiers at mouse-down: Shift = add, Alt = subtract, Shift+Alt = intersect.
   While dragging a marquee: Shift = constrain square/circle, Alt = from centre.
   Drag inside an existing selection (New mode) moves the selection outline.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util, T = S.Tools;

  function sampleImage(doc, all) {
    if (all) { S.Compositor.update(doc); return doc.composite.getContext('2d').getImageData(0, 0, doc.width, doc.height); }
    const l = doc.activeLayer();
    if (!l || !S.Layers.hasCanvas(l)) { S.Compositor.update(doc); return doc.composite.getContext('2d').getImageData(0, 0, doc.width, doc.height); }
    if (l.type === 'fill') return S.Layers.materialize(l, doc).getContext('2d').getImageData(0, 0, doc.width, doc.height);
    S.Layers.ensure(l, doc);
    return S.Layers.readRect(l.canvas, { x: 0, y: 0, w: doc.width, h: doc.height });
  }
  S.sampleImage = sampleImage;

  T.finishSelection = finishSelection;
  function finishSelection(doc, mask, mode, feather, name) {
    let sel = S.Sel.make(mask, doc.width, doc.height);
    if (sel && feather > 0) sel = S.Sel.feather(sel, feather);
    const res = mode === 'new' ? sel : S.Sel.combine(doc.selection, sel ? sel.mask : new Uint8ClampedArray(doc.width * doc.height), mode, doc.width, doc.height);
    doc.setSelection(res, name);
  }
  function shiftMask(sel, dx, dy) {
    const { w, h, mask } = sel, out = new Uint8ClampedArray(w * h);
    dx = Math.round(dx); dy = Math.round(dy);
    for (let y = 0; y < h; y++) {
      const sy = y - dy; if (sy < 0 || sy >= h) continue;
      for (let x = 0; x < w; x++) { const sx = x - dx; if (sx >= 0 && sx < w) out[y * w + x] = mask[sy * w + sx]; }
    }
    return S.Sel.make(out, w, h);
  }
  S.Sel.shift = shiftMask;
  const insideSel = (doc, x, y) => doc.selection && x >= 0 && y >= 0 && x < doc.width && y < doc.height && doc.selection.mask[(y | 0) * doc.width + (x | 0)] > 127;

  /* ---------------- Marquee ---------------- */
  function marquee(id, name, icon, ellipse) {
    return T.register({
      id, name, key: 'M', icon, group: 'marquee', cursor: 'crosshair',
      opts: { mode: 'new', feather: 0, style: 'normal', ratioW: 1, ratioH: 1, fixedW: 64, fixedH: 64 },
      options(bar) {
        const ui = T.ui, o = this.opts;
        ui.selMode(bar, o);
        ui.num(bar, 'Feather', o, 'feather', 0, 250, { unit: 'px' });
        ui.select(bar, 'Style', o, 'style', [{ value: 'normal', label: 'Normal' }, { value: 'ratio', label: 'Fixed Ratio' }, { value: 'size', label: 'Fixed Size' }], () => T.renderOptions());
        if (o.style === 'ratio') { ui.num(bar, 'W', o, 'ratioW', 0.01, 100, { step: 0.01 }); ui.num(bar, 'H', o, 'ratioH', 0.01, 100, { step: 0.01 }); }
        if (o.style === 'size') { ui.num(bar, 'W', o, 'fixedW', 1, 30000, { unit: 'px' }); ui.num(bar, 'H', o, 'fixedH', 1, 30000, { unit: 'px' }); }
        ui.sep(bar);
        ui.button(bar, 'Select and Refine…', () => S.Cmd.run('select.refine'));
      },
      onDown(info, doc) {
        const mode = T.selModeFrom(info, this.opts.mode);
        if (mode === 'new' && insideSel(doc, info.x, info.y) && this.opts.style !== 'size') {
          this.drag = { move: true, x0: info.x, y0: info.y, sel: doc.selection, dx: 0, dy: 0 };
          return;
        }
        const [x, y] = S.View.snapPoint(info.x, info.y);
        this.drag = { x0: x, y0: y, x1: x, y1: y, mode, sx: info.sx, sy: info.sy };
        if (this.opts.style === 'size') this.onMove(info, doc);
      },
      onMove(info) {
        const d = this.drag; if (!d) return;
        if (d.move) { d.dx = Math.round(info.x - d.x0); d.dy = Math.round(info.y - d.y0); return; }
        let [x, y] = S.View.snapDragPoint(info.x, info.y, d.x0, d.y0);
        const o = this.opts;
        if (o.style === 'size') { d.x0 = x - o.fixedW / 2; d.y0 = y - o.fixedH / 2; d.x1 = d.x0 + o.fixedW; d.y1 = d.y0 + o.fixedH; d.moved = true; return; }
        let w = x - d.x0, h = y - d.y0;
        const ratio = o.style === 'ratio' ? o.ratioW / o.ratioH : info.shift ? 1 : 0;
        if (ratio) { const m = Math.max(Math.abs(w), Math.abs(h) * ratio); w = Math.sign(w || 1) * m; h = (Math.sign(h || 1) * m) / ratio; }
        d.alt = info.alt && !(d.mode === 'subtract' || d.mode === 'intersect') ? true : info.alt && Math.hypot(info.sx - d.sx, info.sy - d.sy) > 0 && d.altAfter;
        d.fromCenter = info.alt;
        d.w = w; d.h = h;
        d.moved = d.moved || Math.hypot(info.sx - d.sx, info.sy - d.sy) > 2;
      },
      rect(dd) {
        const d = dd || this.drag;
        if (this.opts.style === 'size') return { x: Math.round(d.x0), y: Math.round(d.y0), w: this.opts.fixedW, h: this.opts.fixedH };
        let x = d.x0, y = d.y0, w = d.w || 0, h = d.h || 0;
        if (d.fromCenter && d.mode !== 'subtract') { x -= w; y -= h; w *= 2; h *= 2; }
        if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
        return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
      },
      onUp(info, doc) {
        const d = this.drag; this.drag = null;
        if (!d) return;
        if (d.move) {
          if (d.dx || d.dy) doc.setSelection(shiftMask(d.sel, d.dx, d.dy), 'Move Selection');
          else if (this.opts.mode === 'new') doc.setSelection(null, 'Deselect');
          return;
        }
        if (!d.moved) { if (d.mode === 'new' && doc.selection) doc.setSelection(null, 'Deselect'); return; }
        const r = this.rect(d);
        if (r.w < 1 || r.h < 1) return;
        const mask = ellipse ? S.Sel.ellipseMask(doc.width, doc.height, r.x, r.y, r.w, r.h) : S.Sel.rectMask(doc.width, doc.height, r.x, r.y, r.w, r.h);
        finishSelection(doc, mask, d.mode, this.opts.feather, ellipse ? 'Elliptical Marquee' : 'Rectangular Marquee');
      },
      onKey(e) { if (e.key === 'Escape' && this.drag) { this.drag = null; S.View.redraw(); return true; } return false; },
      drawOverlay(ctx, doc) {
        const d = this.drag; if (!d) return;
        if (d.move) {
          const p = S.Sel.outline(d.sel); const z = doc.view.zoom;
          ctx.save(); ctx.translate(doc.view.panX + d.dx * z, doc.view.panY + d.dy * z); ctx.scale(z, z);
          ctx.lineWidth = 1 / z; ctx.strokeStyle = '#fff'; ctx.stroke(p); ctx.setLineDash([4 / z, 4 / z]); ctx.strokeStyle = '#000'; ctx.stroke(p); ctx.restore();
          return;
        }
        if (!d.moved) return;
        const r = this.rect();
        const [x1, y1] = S.View.toScreen(r.x, r.y), [x2, y2] = S.View.toScreen(r.x + r.w, r.y + r.h);
        ctx.beginPath();
        if (ellipse) ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
        else ctx.rect(x1 + 0.5, y1 + 0.5, x2 - x1, y2 - y1);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
        ctx.setLineDash([4, 4]); ctx.lineDashOffset = -S.View.antsOffset; ctx.strokeStyle = '#000'; ctx.stroke();
        ctx.setLineDash([]);
        S.App.hud(ctx, x2 + 10, y2 + 10, r.w + ' × ' + r.h + ' px');
      },
    });
  }
  marquee('marqueeRect', 'Rectangular Marquee', 'marqueeRect', false);
  marquee('marqueeEllipse', 'Elliptical Marquee', 'marqueeEllipse', true);

  /* ---------------- Lasso ---------------- */
  T.register({
    id: 'lasso', name: 'Lasso', key: 'L', icon: 'lasso', group: 'lasso', cursor: 'crosshair',
    opts: { mode: 'new', feather: 0 },
    options(bar) { T.ui.selMode(bar, this.opts); T.ui.num(bar, 'Feather', this.opts, 'feather', 0, 250, { unit: 'px' }); },
    onDown(info) { this.pts = [[info.x, info.y]]; this.mode = T.selModeFrom(info, this.opts.mode); },
    onMove(info) { if (!this.pts) return; const l = this.pts[this.pts.length - 1]; if (Math.hypot(info.x - l[0], info.y - l[1]) > 0.7 / S.app.doc.view.zoom) this.pts.push([info.x, info.y]); },
    onUp(info, doc) {
      const pts = this.pts; this.pts = null;
      if (!pts || pts.length < 3) { if (this.mode === 'new' && doc.selection) doc.setSelection(null, 'Deselect'); return; }
      finishSelection(doc, S.Sel.polygonMask(doc.width, doc.height, pts), this.mode, this.opts.feather, 'Lasso');
    },
    drawOverlay(ctx) {
      if (!this.pts) return;
      ctx.beginPath();
      this.pts.forEach((p, i) => { const [x, y] = S.View.toScreen(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([4, 4]); ctx.strokeStyle = '#000'; ctx.stroke();
    },
  });

  /* ---------------- Polygonal lasso ---------------- */
  T.register({
    id: 'polyLasso', name: 'Polygonal Lasso', key: 'L', icon: 'polyLasso', group: 'lasso', cursor: 'crosshair',
    opts: { mode: 'new', feather: 0 },
    options(bar) {
      T.ui.selMode(bar, this.opts); T.ui.num(bar, 'Feather', this.opts, 'feather', 0, 250, { unit: 'px' });
      bar.appendChild(U.el('span', { class: 'muted opt-hint' }, 'Click to add points · double-click / Enter to close · Backspace removes last'));
    },
    onDown(info, doc) {
      let [x, y] = S.View.snapPoint(info.x, info.y);
      if (!this.pts) { this.pts = [[x, y]]; this.mode = T.selModeFrom(info, this.opts.mode); return; }
      if (info.shift && this.pts.length) { // constrain to 45°
        const l = this.pts[this.pts.length - 1], a = Math.round(Math.atan2(y - l[1], x - l[0]) / (Math.PI / 4)) * (Math.PI / 4), dd = Math.hypot(x - l[0], y - l[1]);
        x = l[0] + Math.cos(a) * dd; y = l[1] + Math.sin(a) * dd;
      }
      const f = this.pts[0];
      if (this.pts.length > 2 && Math.hypot((x - f[0]) * doc.view.zoom, (y - f[1]) * doc.view.zoom) < 8) { this.close(doc); return; }
      this.pts.push([x, y]);
    },
    onDblClick(info, doc) { if (this.pts) this.close(doc); },
    close(doc) {
      const pts = this.pts; this.pts = null;
      if (!pts || pts.length < 3) return;
      finishSelection(doc, S.Sel.polygonMask(doc.width, doc.height, pts), this.mode, this.opts.feather, 'Polygonal Lasso');
    },
    onKey(e, doc) {
      if (!this.pts) return false;
      if (e.key === 'Escape') { this.pts = null; S.View.redraw(); return true; }
      if (e.key === 'Enter') { this.close(doc); return true; }
      if (e.key === 'Backspace' || e.key === 'Delete') { this.pts.pop(); if (!this.pts.length) this.pts = null; S.View.redraw(); return true; }
      return false;
    },
    deactivate() { this.pts = null; },
    onHover() { if (this.pts) S.View.redraw(); },
    animated: false,
    drawOverlay(ctx) {
      if (!this.pts) return;
      ctx.beginPath();
      this.pts.forEach((p, i) => { const [x, y] = S.View.toScreen(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.lineTo(S.View.mouse.sx, S.View.mouse.sy);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([4, 4]); ctx.strokeStyle = '#000'; ctx.stroke();
      ctx.setLineDash([]);
      const [fx, fy] = S.View.toScreen(this.pts[0][0], this.pts[0][1]);
      ctx.strokeStyle = '#f0913a'; ctx.beginPath(); ctx.arc(fx, fy, 4, 0, Math.PI * 2); ctx.stroke();
    },
  });

  /* ---------------- Magic wand ---------------- */
  T.register({
    id: 'wand', name: 'Magic Wand', key: 'W', icon: 'wand', group: 'wand', cursor: 'crosshair',
    opts: { mode: 'new', tolerance: 32, contiguous: true, antialias: true, sampleAll: false },
    options(bar) {
      const ui = T.ui, o = this.opts;
      ui.selMode(bar, o);
      ui.num(bar, 'Tolerance', o, 'tolerance', 0, 255);
      ui.check(bar, 'Anti-alias', o, 'antialias');
      ui.check(bar, 'Contiguous', o, 'contiguous');
      ui.check(bar, 'Sample all layers', o, 'sampleAll');
    },
    onDown(info, doc) {
      if (info.x < 0 || info.y < 0 || info.x >= doc.width || info.y >= doc.height) return;
      const img = sampleImage(doc, this.opts.sampleAll);
      const mask = S.Sel.colorMask(img, info.x, info.y, this.opts.tolerance, this.opts.contiguous, this.opts.antialias);
      finishSelection(doc, mask, T.selModeFrom(info, this.opts.mode), 0, 'Magic Wand');
    },
  });

  /* ---------------- Quick selection brush ---------------- */
  T.register({
    id: 'quickSelect', name: 'Select Brush', key: 'W', icon: 'quickSelect', group: 'wand',
    opts: { size: 30, mode: 'add', tolerance: 28, sampleAll: false },
    brushCursor() { return this.opts.size; },
    options(bar) {
      const ui = T.ui, o = this.opts;
      ui.seg(bar, o, 'mode', [{ value: 'new', icon: 'selNew', tip: 'New selection' }, { value: 'add', icon: 'selAdd', tip: 'Add to selection' }, { value: 'subtract', icon: 'selSub', tip: 'Subtract (Alt)' }]);
      ui.num(bar, 'Size', o, 'size', 2, 500, { unit: 'px' });
      ui.num(bar, 'Tolerance', o, 'tolerance', 1, 128);
      ui.check(bar, 'Sample all layers', o, 'sampleAll');
    },
    onDown(info, doc) {
      const mode = info.alt ? 'subtract' : this.opts.mode;
      this.st = { doc, img: sampleImage(doc, this.opts.sampleAll), mask: new Uint8ClampedArray(doc.width * doc.height), before: doc.captureState(), base: mode === 'new' && !this._continued ? null : doc.selection, mode, last: null };
      this.grow(info.x, info.y);
    },
    onMove(info) {
      const st = this.st; if (!st) return;
      const l = st.last, step = Math.max(2, this.opts.size / 3);
      if (l && Math.hypot(info.x - l[0], info.y - l[1]) < step) return;
      this.grow(info.x, info.y);
    },
    grow(cx, cy) {
      const st = this.st, { img, mask } = st, W = img.width, H = img.height, d = img.data;
      st.last = [cx, cy];
      const r = this.opts.size / 2, lim = r * 3.2;
      cx = Math.round(cx); cy = Math.round(cy);
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) return;
      // seed colour = average under brush
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let y = Math.max(0, cy - r); y < Math.min(H, cy + r); y++) for (let x = Math.max(0, cx - r); x < Math.min(W, cx + r); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        const i = ((y | 0) * W + (x | 0)) * 4; sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; n++;
      }
      if (!n) return;
      sr /= n; sg /= n; sb /= n;
      const tol = this.opts.tolerance * 1.0;
      // one visited buffer per stroke (a fresh W×H allocation per pointer event is slow on large documents);
      // a stamp value marks this flood so the buffer never has to be cleared
      if (!st.visited) { st.visited = new Uint32Array(W * H); st.stamp = 0; }
      const visited = st.visited, stamp = ++st.stamp;
      const stack = [cx, cy];
      const x0 = Math.max(0, cx - lim | 0), x1 = Math.min(W - 1, cx + lim | 0), y0 = Math.max(0, cy - lim | 0), y1 = Math.min(H - 1, cy + lim | 0);
      while (stack.length) {
        const y = stack.pop(), x = stack.pop();
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        const p = y * W + x;
        if (visited[p] === stamp) continue;
        visited[p] = stamp;
        const i = p * 4;
        const inBrush = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
        const diff = Math.max(Math.abs(d[i] - sr), Math.abs(d[i + 1] - sg), Math.abs(d[i + 2] - sb));
        if (!inBrush && diff > tol) continue;
        mask[p] = 255;
        stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
      }
      // live preview
      const doc = st.doc;
      const sel = S.Sel.make(new Uint8ClampedArray(mask), W, H);
      doc.selection = st.mode === 'new' ? sel : S.Sel.combine(st.base, sel ? sel.mask : mask, st.mode, W, H);
      S.View.redraw();
    },
    onUp(info, doc) {
      const st = this.st; this.st = null;
      if (!st) return;
      // smooth the result a little
      if (doc.selection) doc.selection = S.Sel.smooth(doc.selection, 1) || doc.selection;
      doc.pushState('Select Brush', st.before);
      this._continued = true; setTimeout(() => (this._continued = false), 0);
    },
  });
})();
