/* =========================================================================
   Gesso — Crop, Eyedropper, Paint Bucket, Gradient, Hand, Zoom tools.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util, T = S.Tools;

  /* ======================= Crop ======================= */
  const RATIOS = [{ value: 'free', label: 'Free' }, { value: 'orig', label: 'Original Ratio' }, { value: '1:1', label: '1 : 1 (Square)' }, { value: '4:3', label: '4 : 3' }, { value: '3:2', label: '3 : 2' },
    { value: '16:9', label: '16 : 9' }, { value: '9:16', label: '9 : 16' }, { value: '4:5', label: '4 : 5' }, { value: '5:7', label: '5 : 7' }, { value: 'custom', label: 'Custom…' }];
  T.register({
    id: 'crop', name: 'Crop', key: 'C', icon: 'crop', group: 'crop', cursor: 'crosshair', hideAnts: false,
    opts: { ratio: 'free', rw: 1, rh: 1, overlay: 'thirds', shield: true, cropped: 'hide' },
    options(bar) {
      const ui = T.ui, o = this.opts;
      ui.select(bar, 'Ratio', o, 'ratio', RATIOS, () => { this.applyRatio(); T.renderOptions(); });
      if (o.ratio === 'custom') { ui.num(bar, 'W', o, 'rw', 0.01, 10000, { step: 0.01, onChange: () => this.applyRatio() }); ui.num(bar, 'H', o, 'rh', 0.01, 10000, { step: 0.01, onChange: () => this.applyRatio() }); }
      ui.select(bar, 'Overlay', o, 'overlay', [{ value: 'thirds', label: 'Rule of Thirds' }, { value: 'grid', label: 'Grid' }, { value: 'golden', label: 'Golden Ratio' }, { value: 'none', label: 'None' }]);
      ui.check(bar, 'Shield', o, 'shield');
      ui.select(bar, 'Cropped pixels', o, 'cropped', [{ value: 'hide', label: 'Hide (keep outside)' }, { value: 'delete', label: 'Delete' }]);
      ui.sep(bar);
      ui.button(bar, 'Reset', () => this.reset());
      ui.button(bar, 'Cancel', () => this.cancel());
      ui.button(bar, 'Crop', () => this.commit(), { primary: true });
      bar.appendChild(U.el('span', { class: 'muted opt-hint' }, 'Hide keeps layer pixels outside the crop (Image ▸ Reveal All brings them back)'));
    },
    ratioValue() {
      const o = this.opts, d = S.app.doc;
      if (o.ratio === 'free') return 0;
      if (o.ratio === 'orig') return d ? d.width / d.height : 0;
      if (o.ratio === 'custom') return o.rw / o.rh;
      const [a, b] = o.ratio.split(':').map(Number); return a / b;
    },
    activate() { this.reset(); },
    deactivate() { this.rect = null; },
    reset() { const d = S.app.doc; this.rect = d ? { x: 0, y: 0, w: d.width, h: d.height } : null; this._size = d ? d.id + ':' + d.width + 'x' + d.height : ''; this.fresh = true; this.applyRatio(); S.View.redraw(); },
    /** the document changed size (Image/Canvas Size, undo of a crop, another tab): the box must follow */
    syncDoc() { const d = S.app.doc; if (S.app.tool === this && !this.drag && (d ? d.id + ':' + d.width + 'x' + d.height : '') !== this._size) this.reset(); },
    applyRatio() {
      const r = this.rect, k = this.ratioValue(); if (!r || !k) { S.View.redraw(); return; }
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      let w = r.w, h = w / k; if (h > r.h) { h = r.h; w = h * k; }
      this.rect = { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w: Math.round(w), h: Math.round(h) };
      S.View.redraw();
    },
    hit(info, doc) {
      const r = this.rect; if (!r) return null;
      const [x1, y1] = S.View.toScreen(r.x, r.y, doc), [x2, y2] = S.View.toScreen(r.x + r.w, r.y + r.h, doc);
      const near = (a, b) => Math.abs(a - b) < 8;
      const L = near(info.sx, x1), R = near(info.sx, x2), Tp = near(info.sy, y1), B = near(info.sy, y2);
      const inX = info.sx > x1 - 8 && info.sx < x2 + 8, inY = info.sy > y1 - 8 && info.sy < y2 + 8;
      if (inX && inY && (L || R || Tp || B)) return { l: L, r: R && !L, t: Tp, b: B && !Tp };
      if (info.sx > x1 && info.sx < x2 && info.sy > y1 && info.sy < y2) return { move: true };
      return null;
    },
    cursor() { const h = this._hover; if (!h) return 'crosshair'; if (h.move) return 'move'; if ((h.l && h.t) || (h.r && h.b)) return 'nwse-resize'; if ((h.r && h.t) || (h.l && h.b)) return 'nesw-resize'; return h.l || h.r ? 'ew-resize' : 'ns-resize'; },
    onHover(info, doc) { this._hover = this.hit(info, doc); S.View.updateCursor(); },
    onDown(info, doc) {
      if (!this.rect) this.reset();
      let h = this.hit(info, doc);
      // while the box is still the untouched full-canvas default, dragging inside draws a new box
      if (h && h.move && this.fresh) h = null;
      const [x, y] = S.View.snapPoint(info.x, info.y);
      this.drag = { h, x0: x, y0: y, r: { ...this.rect } };
      if (!h) this.drag.newRect = true;
      this.fresh = false;
    },
    onMove(info) {
      const d = this.drag; if (!d) return;
      const [x, y] = d.newRect ? S.View.snapDragPoint(info.x, info.y, d.x0, d.y0) : S.View.snapPoint(info.x, info.y);
      const k = this.ratioValue();
      let r;
      if (d.newRect) {
        let w = x - d.x0, h = y - d.y0;
        if (k || info.shift) { const kk = k || 1; const m = Math.max(Math.abs(w), Math.abs(h) * kk); w = Math.sign(w || 1) * m; h = (Math.sign(h || 1) * m) / kk; }
        r = { x: Math.min(d.x0, d.x0 + w), y: Math.min(d.y0, d.y0 + h), w: Math.abs(w), h: Math.abs(h) };
      } else if (d.h.move) {
        r = { ...d.r, x: d.r.x + (x - d.x0), y: d.r.y + (y - d.y0) };
      } else {
        let { x: rx, y: ry, w, h } = d.r; let x2 = rx + w, y2 = ry + h;
        if (d.h.l) rx = Math.min(x, x2 - 1); if (d.h.r) x2 = Math.max(x, rx + 1);
        if (d.h.t) ry = Math.min(y, y2 - 1); if (d.h.b) y2 = Math.max(y, ry + 1);
        w = x2 - rx; h = y2 - ry;
        if (k) {
          if (d.h.l || d.h.r) { const nh = w / k; if (d.h.t) ry = y2 - nh; else if (!d.h.b) ry = ry + (h - nh) / 2; h = nh; }
          else { const nw = h * k; rx = rx + (w - nw) / 2; w = nw; }
        }
        r = { x: rx, y: ry, w, h };
      }
      this.rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) };
    },
    onUp() { this.drag = null; },
    onDblClick() { this.commit(); },
    onKey(e) {
      if (e.key === 'Enter') { this.commit(); return true; }
      if (e.key === 'Escape') { this.cancel(); return true; }
      return false;
    },
    cancel() { this.reset(); },
    commit() {
      const d = S.app.doc, r = this.rect; if (!d || !r) return;
      if (r.x === 0 && r.y === 0 && r.w === d.width && r.h === d.height) return;
      d.commit('Crop', () => S.Ops.resizeCanvas(d, r.w, r.h, -r.x, -r.y, null, { clip: this.opts.cropped === 'delete' }));
      S.View.fit(d, false);
      this.reset();
      S.bus.emit('doc:resized', d);
    },
    drawOverlay(ctx, doc) {
      const r = this.rect; if (!r) return;
      const [x1, y1] = S.View.toScreen(r.x, r.y, doc), [x2, y2] = S.View.toScreen(r.x + r.w, r.y + r.h, doc);
      if (this.opts.shield) {
        ctx.save(); ctx.fillStyle = 'rgba(10,8,6,.62)';
        ctx.beginPath(); ctx.rect(0, 0, S.View.w, S.View.h); ctx.rect(x1, y1, x2 - x1, y2 - y1); ctx.fill('evenodd'); ctx.restore();
      }
      ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 1; ctx.strokeRect(x1 + 0.5, y1 + 0.5, x2 - x1, y2 - y1);
      ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.beginPath();
      const lines = this.opts.overlay === 'thirds' ? [1 / 3, 2 / 3] : this.opts.overlay === 'grid' ? [1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6] : this.opts.overlay === 'golden' ? [0.382, 0.618] : [];
      for (const f of lines) { const xx = x1 + (x2 - x1) * f, yy = y1 + (y2 - y1) * f; ctx.moveTo(xx, y1); ctx.lineTo(xx, y2); ctx.moveTo(x1, yy); ctx.lineTo(x2, yy); }
      ctx.stroke();
      // handles
      ctx.fillStyle = '#fff';
      const hs = [[x1, y1], [x2, y1], [x1, y2], [x2, y2], [(x1 + x2) / 2, y1], [(x1 + x2) / 2, y2], [x1, (y1 + y2) / 2], [x2, (y1 + y2) / 2]];
      for (const [hx, hy] of hs) ctx.fillRect(hx - 4, hy - 4, 8, 8);
      S.App.hud(ctx, x2 - 90, y2 + 10, r.w + ' × ' + r.h + ' px');
    },
  });
  ['doc:resized', 'doc:switched', 'history:changed'].forEach((e) => S.bus.on(e, () => T.byId.crop.syncDoc()));

  /* ======================= Eyedropper ======================= */
  T.register({
    id: 'eyedropper', name: 'Eyedropper', key: 'I', icon: 'eyedropper', group: 'eyedropper', cursor: 'crosshair',
    opts: { size: 1, sample: 'all' },
    options(bar) {
      T.ui.select(bar, 'Sample Size', this.opts, 'size', [{ value: 1, label: 'Point Sample' }, { value: 3, label: '3 × 3 Average' }, { value: 5, label: '5 × 5 Average' }, { value: 11, label: '11 × 11 Average' }, { value: 31, label: '31 × 31 Average' }]);
      T.ui.select(bar, 'Sample', this.opts, 'sample', [{ value: 'all', label: 'All Layers' }, { value: 'layer', label: 'Current Layer' }]);
    },
    sampleAt(info, doc, setFg) {
      const sz = +this.opts.size || 1, h = Math.floor(sz / 2);
      const x = Math.floor(info.x), y = Math.floor(info.y);
      if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null;
      let src;
      if (this.opts.sample === 'layer' && doc.activeLayer() && S.Layers.hasCanvas(doc.activeLayer())) { S.Layers.ensure(doc.activeLayer(), doc); src = doc.activeLayer().canvas; }
      else { S.Compositor.update(doc); src = doc.composite; }
      const r = U.rectInt({ x: x - h, y: y - h, w: sz, h: sz }, doc.width, doc.height);
      const d = U.samplePixels(src, r.x, r.y, r.w, r.h);
      let R = 0, G = 0, B = 0, A = 0;
      for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; R += d[i] * a; G += d[i + 1] * a; B += d[i + 2] * a; A += a; }
      if (!A) return null;
      const hex = U.rgbToHex(R / A, G / A, B / A);
      if (setFg !== false) { if (info.alt && setFg !== true) S.App.setBg(hex); else S.App.setFg(hex); }
      return hex;
    },
    onDown(info, doc) { this.dragging = true; this.preview = this.sampleAt(info, doc); },
    onMove(info, doc) { if (this.dragging) this.preview = this.sampleAt(info, doc); },
    onUp() { this.dragging = false; this.preview = null; },
    drawOverlay(ctx) {
      if (!this.dragging || !this.preview) return;
      const { sx, sy } = S.View.mouse;
      ctx.lineWidth = 12; ctx.strokeStyle = this.preview; ctx.beginPath(); ctx.arc(sx, sy, 34, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.beginPath(); ctx.arc(sx, sy, 40.5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(sx, sy, 27.5, 0, Math.PI * 2); ctx.stroke();
    },
  });

  /* ======================= Paint Bucket ======================= */
  /**
   * Composite a document-space source canvas (at 0,0 unless it carries ox/oy) onto a paint target
   * (respecting selection, opacity, blend).  rect: document rect the operation touches (default: the
   * source canvas' rect); the layer canvas grows to cover it.
   */
  S.paintCanvasOnto = function (doc, target, src, opacity, blend, name, ignoreSel, rect) {
    const edit = doc.beginPixelEdit(target);
    let s = src;
    if (doc.selection && !ignoreSel) {
      s = U.cloneCanvas(src);
      const x = s.getContext('2d'); x.globalCompositeOperation = 'destination-in'; x.drawImage(S.Sel.canvas(doc.selection), -(s.ox || 0), -(s.oy || 0));
    }
    let R = rect || U.rectOf(s);
    if (doc.selection && !ignoreSel) R = U.rectIntersect(R, doc.selection.bounds) || { x: 0, y: 0, w: 1, h: 1 };
    const tc = target.canvas, D = { x: 0, y: 0, w: doc.width, h: doc.height };
    if (target.kind === 'pixels') {
      S.Layers.growTo(tc, R, null, D);
      const tctx = tc.getContext('2d');
      tctx.save(); tctx.setTransform(1, 0, 0, 1, -(tc.ox || 0), -(tc.oy || 0)); tctx.globalAlpha = opacity;
      tctx.globalCompositeOperation = blend === 'behind' ? 'destination-over' : blend === 'clear' ? 'destination-out' : target.layer.locks.alpha ? 'source-atop' : S.blendOp(blend);
      U.blitRect(tctx, s, R); tctx.restore();
    } else {
      // mask target (sparse): luminance of src becomes the mask value inside R (clipped to the document)
      R = U.rectIntersect(R, D) || { x: 0, y: 0, w: 1, h: 1 };
      const fill = target.outside || 0;
      S.Layers.growTo(tc, R, 0, null, fill);
      const sd = S.Layers.readRect(s, R).data, img = S.Layers.readRect(tc, R, fill), o = img.data;
      for (let i = 0; i < o.length; i += 4) { const k = (sd[i + 3] / 255) * opacity; if (k) o[i + 3] += (U.luma(sd[i], sd[i + 1], sd[i + 2]) - o[i + 3]) * k; }
      tc.getContext('2d').putImageData(img, R.x - (tc.ox || 0), R.y - (tc.oy || 0));
      if (target.kind === 'quickmask') doc.quickMask.version = (doc.quickMask.version || 0) + 1;
      else target.layer.mask.version = (target.layer.mask.version || 0) + 1;
    }
    edit.end(name, R);
    if (target.layer) doc.bump(target.layer); else doc.invalidate();
    S.bus.emit('layers:changed', doc);
  };
  async function getTarget(doc) {
    const t = doc.paintTarget();
    if (!t) return null;
    if (t.kind === 'invalid') {
      if (t.layer.type === 'text' || t.layer.type === 'shape' || t.layer.type === 'fill' || S.Embed.is(t.layer)) {
        if (await S.Dialog.confirm('This layer must be rasterized before painting. Rasterize it?', 'Rasterize')) S.Cmd.run('layer.rasterize');
      } else S.toast('Select a pixel layer');
      return null;
    }
    if (t.layer && (t.layer.locks.all || t.layer.locks.pixels)) { S.toast('Layer is locked'); return null; }
    return t;
  }
  T.register({
    id: 'bucket', name: 'Paint Bucket', key: 'G', icon: 'bucket', group: 'fill', cursor: 'crosshair',
    opts: { tolerance: 32, contiguous: true, sampleAll: false, antialias: true, opacity: 100, blend: 'normal', source: 'fg' },
    options(bar) {
      const ui = T.ui, o = this.opts;
      ui.select(bar, 'Fill', o, 'source', [{ value: 'fg', label: 'Foreground' }, { value: 'bg', label: 'Background' }]);
      ui.blend(bar, o, 'blend');
      ui.num(bar, 'Opacity', o, 'opacity', 1, 100, { unit: '%' });
      ui.num(bar, 'Tolerance', o, 'tolerance', 0, 255);
      ui.check(bar, 'Anti-alias', o, 'antialias');
      ui.check(bar, 'Contiguous', o, 'contiguous');
      ui.check(bar, 'All layers', o, 'sampleAll');
    },
    async onDown(info, doc) {
      if (info.x < 0 || info.y < 0 || info.x >= doc.width || info.y >= doc.height) return;
      const t = await getTarget(doc); if (!t) return;
      let img;
      if (this.opts.sampleAll || t.kind !== 'pixels') { img = S.sampleImage(doc, true); }
      else img = S.Layers.readRect(t.canvas, { x: 0, y: 0, w: doc.width, h: doc.height });
      const mask = S.Sel.colorMask(img, info.x, info.y, this.opts.tolerance, this.opts.contiguous, this.opts.antialias);
      const sel = S.Sel.make(mask, doc.width, doc.height);
      if (!sel) return;
      const b = sel.bounds, src = U.createCanvas(b.w, b.h, b.x, b.y), x = src.getContext('2d');
      x.fillStyle = this.opts.source === 'bg' || info.alt ? S.app.bg : S.app.fg; x.fillRect(0, 0, b.w, b.h);
      x.globalCompositeOperation = 'destination-in'; x.drawImage(S.Sel.canvas(sel), -b.x, -b.y);
      S.paintCanvasOnto(doc, t, src, this.opts.opacity / 100, this.opts.blend, 'Paint Bucket', false, b);
    },
  });

  /* ======================= Gradient tool ======================= */
  T.register({
    id: 'gradient', name: 'Gradient', key: 'G', icon: 'gradient', group: 'fill', cursor: 'crosshair',
    opts: { type: 'linear', preset: 0, stops: null, reverse: false, opacity: 100, blend: 'normal', dither: true },
    stops() { return this.opts.stops && this.opts.preset === -1 ? this.opts.stops : S.Gradient.resolve(S.Gradient.PRESETS[this.opts.preset] || S.Gradient.PRESETS[0]); },
    options(bar) {
      const ui = T.ui, o = this.opts;
      const sw = U.el('button', { class: 'grad-swatch checker', title: 'Click to edit gradient' });
      const inner = U.el('div', { style: { background: S.Gradient.css(this.stops()) } });
      sw.appendChild(inner);
      sw.addEventListener('click', () => this.editGradient(() => (inner.style.background = S.Gradient.css(this.stops()))));
      bar.appendChild(sw);
      const presetOpts = S.Gradient.PRESETS.map((p, i) => ({ value: i, label: p.name }));
      presetOpts.push({ value: -1, label: 'Custom' });
      ui.select(bar, '', o, 'preset', presetOpts, () => (inner.style.background = S.Gradient.css(this.stops())));
      ui.seg(bar, o, 'type', [
        { value: 'linear', icon: 'gLinear', tip: 'Linear' }, { value: 'radial', icon: 'gRadial', tip: 'Radial' }, { value: 'angle', icon: 'gAngle', tip: 'Angle' },
        { value: 'reflected', icon: 'gReflect', tip: 'Reflected' }, { value: 'diamond', icon: 'gDiamond', tip: 'Diamond' }]);
      ui.blend(bar, o, 'blend');
      ui.num(bar, 'Opacity', o, 'opacity', 1, 100, { unit: '%' });
      ui.check(bar, 'Reverse', o, 'reverse');
      ui.check(bar, 'Dither', o, 'dither');
    },
    editGradient(done) {
      const vals = { g: this.stops().map((s) => ({ ...s })) };
      S.Dialog.form('Gradient Editor', [{ id: 'g', label: '', type: 'gradient', default: vals.g }], vals, (v) => {
        this.opts.stops = v.g; this.opts.preset = -1; T.saveOpts(); T.renderOptions(); done && done();
      }, { width: 380 });
    },
    async onDown(info, doc) {
      const t = await getTarget(doc); if (!t) return;
      const [x, y] = S.View.snapPoint(info.x, info.y);
      this.drag = { t, x1: x, y1: y, x2: x, y2: y, edit: doc.beginPixelEdit(t), doc };
    },
    onMove(info) {
      const d = this.drag; if (!d) return;
      let [x, y] = S.View.snapPoint(info.x, info.y);
      if (info.shift) { const a = Math.round(Math.atan2(y - d.y1, x - d.x1) / (Math.PI / 4)) * (Math.PI / 4), l = Math.hypot(x - d.x1, y - d.y1); x = d.x1 + Math.cos(a) * l; y = d.y1 + Math.sin(a) * l; }
      d.x2 = x; d.y2 = y;
      if (!this._q) { this._q = true; requestAnimationFrame(() => { this._q = false; if (this.drag) this.renderInto(this.drag, false); }); }
    },
    renderInto(d, final) {
      const doc = d.doc, W = doc.width, H = doc.height;
      if (Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 1) return;
      const g = U.scratch(W, H), gx = g.getContext('2d');
      // render diamond previews at reduced resolution for speed
      const lowres = !final && this.opts.type === 'diamond' && W * H > 600000;
      if (lowres) {
        const k = Math.sqrt(600000 / (W * H)), sw = Math.ceil(W * k), sh = Math.ceil(H * k), small = U.createCanvas(sw, sh);
        S.Gradient.paint(small.getContext('2d'), { stops: this.stops(), type: 'diamond', x1: d.x1 * k, y1: d.y1 * k, x2: d.x2 * k, y2: d.y2 * k, reverse: this.opts.reverse }, sw, sh);
        gx.drawImage(small, 0, 0, W, H);
      } else S.Gradient.paint(gx, { stops: this.stops(), type: this.opts.type, x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, reverse: this.opts.reverse }, W, H);
      if (final && this.opts.dither) {
        const img = gx.getImageData(0, 0, W, H), p = img.data;
        for (let i = 0; i < p.length; i += 4) { const n = Math.random() - 0.5; p[i] += n; p[i + 1] += n; p[i + 2] += n; }
        gx.putImageData(img, 0, 0);
      }
      if (doc.selection) { gx.globalCompositeOperation = 'destination-in'; gx.drawImage(S.Sel.canvas(doc.selection), 0, 0); }
      const tc = d.t.canvas, R = doc.selection ? doc.selection.bounds : { x: 0, y: 0, w: W, h: H };
      const fill = d.t.outside || 0;
      S.Layers.growTo(tc, R, 0, null, fill);
      const tctx = tc.getContext('2d');
      S.Layers.restoreFrom(tc, d.edit.snapshot);
      if (fill) { // the snapshot may be smaller than the grown canvas: the area around it is the outside value
        tctx.save(); tctx.globalCompositeOperation = 'destination-over'; tctx.fillStyle = 'rgba(0,0,0,' + fill / 255 + ')'; tctx.fillRect(0, 0, tc.width, tc.height); tctx.restore();
      }
      tctx.save();
      if (d.t.kind === 'pixels') {
        tctx.setTransform(1, 0, 0, 1, -(tc.ox || 0), -(tc.oy || 0));
        tctx.globalAlpha = this.opts.opacity / 100;
        const b = this.opts.blend;
        tctx.globalCompositeOperation = b === 'behind' ? 'destination-over' : b === 'clear' ? 'destination-out' : d.t.layer.locks.alpha ? 'source-atop' : S.blendOp(b);
        tctx.drawImage(g, 0, 0);
        tctx.restore();
      } else {
        tctx.restore();
        const sd = gx.getImageData(R.x, R.y, R.w, R.h).data, img = S.Layers.readRect(tc, R, fill), o = img.data, op = this.opts.opacity / 100;
        for (let i = 0; i < o.length; i += 4) { const k = (sd[i + 3] / 255) * op; o[i + 3] += (U.luma(sd[i], sd[i + 1], sd[i + 2]) - o[i + 3]) * k; }
        tctx.putImageData(img, R.x - (tc.ox || 0), R.y - (tc.oy || 0));
        if (d.t.kind === 'quickmask') doc.quickMask.version = (doc.quickMask.version || 0) + 1; else d.t.layer.mask.version = (d.t.layer.mask.version || 0) + 1;
      }
      U.release(g);
      if (d.t.layer) doc.bump(d.t.layer); else doc.invalidate();
    },
    onUp() {
      const d = this.drag; this.drag = null;
      if (!d) return;
      if (Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 1) return;
      this.renderInto(d, true);
      d.edit.end('Gradient', d.doc.selection ? d.doc.selection.bounds : { x: 0, y: 0, w: d.doc.width, h: d.doc.height });
      S.bus.emit('layers:changed', d.doc);
    },
    drawOverlay(ctx) {
      const d = this.drag; if (!d) return;
      const [a, b] = S.View.toScreen(d.x1, d.y1), [c, e] = S.View.toScreen(d.x2, d.y2);
      ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, e); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
      for (const [x, y] of [[a, b], [c, e]]) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    },
  });

  /* ======================= Hand & Zoom ======================= */
  T.register({
    id: 'hand', name: 'Hand', key: 'H', icon: 'hand', group: 'hand', cursor: 'grab',
    options(bar) {
      T.ui.button(bar, '100%', () => S.Cmd.run('view.actual'));
      T.ui.button(bar, 'Fit Screen', () => S.Cmd.run('view.fit'));
    },
    onDown(info, doc) { this.drag = { sx: info.ev.clientX, sy: info.ev.clientY, px: doc.view.panX, py: doc.view.panY }; S.View.canvas.style.cursor = 'grabbing'; },
    onMove(info, doc) { const d = this.drag; if (!d) return; doc.view.panX = d.px + info.ev.clientX - d.sx; doc.view.panY = d.py + info.ev.clientY - d.sy; S.View.viewChanged(); },
    onUp() { this.drag = null; S.View.updateCursor(); },
    onDblClick() { S.Cmd.run('view.fit'); },
  });
  T.register({
    id: 'zoom', name: 'Zoom', key: 'Z', icon: 'zoom', group: 'zoom', cursor: 'zoom-in', opts: { scrubby: true },
    options(bar) {
      T.ui.button(bar, '', () => S.View.zoomStep(1), { icon: 'plus', tip: 'Zoom in' });
      T.ui.button(bar, '', () => S.View.zoomStep(-1), { icon: 'minus', tip: 'Zoom out' });
      T.ui.check(bar, 'Scrubby zoom', this.opts, 'scrubby');
      T.ui.button(bar, '100%', () => S.Cmd.run('view.actual'));
      T.ui.button(bar, 'Fit Screen', () => S.Cmd.run('view.fit'));
      T.ui.button(bar, 'Fill Screen', () => S.Cmd.run('view.fill'));
    },
    onDown(info, doc) { this.drag = { sx: info.sx, sy: info.sy, x0: info.x, y0: info.y, z0: doc.view.zoom, alt: info.alt, moved: false, cx: info.sx, cy: info.sy }; },
    onMove(info, doc) {
      const d = this.drag; if (!d) return;
      d.cx = info.sx; d.cy = info.sy;
      if (Math.hypot(info.sx - d.sx, info.sy - d.sy) > 3) d.moved = true;
      if (d.moved && this.opts.scrubby) S.View.setZoom(d.z0 * Math.exp((info.sx - d.sx) / 150), d.sx, d.sy);
    },
    onUp(info, doc) {
      const d = this.drag; this.drag = null;
      if (!d) return;
      if (!d.moved) { S.View.zoomStep(d.alt || info.alt ? -1 : 1, info.sx, info.sy); return; }
      if (!this.opts.scrubby) {
        const x1 = Math.min(d.x0, info.x), y1 = Math.min(d.y0, info.y), w = Math.abs(info.x - d.x0), h = Math.abs(info.y - d.y0);
        if (w < 2 || h < 2) return;
        const z = Math.min(S.View.w / w, S.View.h / h);
        doc.view.zoom = U.clamp(z, 0.01, 64); doc.view.panX = S.View.w / 2 - (x1 + w / 2) * doc.view.zoom; doc.view.panY = S.View.h / 2 - (y1 + h / 2) * doc.view.zoom;
        S.View.viewChanged();
      }
    },
    cursor() { return S.App && S.App.altDown ? 'zoom-out' : 'zoom-in'; },
    drawOverlay(ctx) {
      const d = this.drag; if (!d || this.opts.scrubby || !d.moved) return;
      ctx.strokeStyle = '#fff'; ctx.setLineDash([4, 4]); ctx.strokeRect(d.sx + 0.5, d.sy + 0.5, d.cx - d.sx, d.cy - d.sy); ctx.setLineDash([]);
    },
  });
})();
