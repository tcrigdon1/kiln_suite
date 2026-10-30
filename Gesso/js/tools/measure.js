/* =========================================================================
   Gesso — Ruler (measure + straighten) and Perspective Crop tools.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util, T = S.Tools, O = S.Ops;
  const fmt = (v) => Math.round(v * 10) / 10;

  /* ---------- helpers ---------- */
  // largest axis-aligned rectangle inside a w×h image rotated by `rad` (Coppola's formula)
  S.Ops.largestRotatedRect = function (w, h, rad) {
    const s = Math.abs(Math.sin(rad)), c = Math.abs(Math.cos(rad));
    if (s < 1e-9) return [w, h];
    const long = Math.max(w, h), short = Math.min(w, h);
    let rw, rh;
    if (short <= 2 * s * c * long || Math.abs(s - c) < 1e-9) { const x = 0.5 * short; if (w >= h) { rw = x / s; rh = x / c; } else { rw = x / c; rh = x / s; } }
    else { const cos2 = c * c - s * s; rw = (w * c - h * s) / cos2; rh = (h * c - w * s) / cos2; }
    return [Math.max(1, Math.floor(rw)), Math.max(1, Math.floor(rh))];
  };
  /** rotate the whole canvas by deg and (optionally) crop away the empty corners */
  S.Ops.straightenCanvas = function (doc, deg, crop) {
    const W0 = doc.width, H0 = doc.height;
    doc.commit('Straighten', () => {
      O.rotateCanvas(doc, deg);
      if (crop) {
        const [rw, rh] = S.Ops.largestRotatedRect(W0, H0, (deg * Math.PI) / 180);
        const ox = Math.round((doc.width - rw) / 2), oy = Math.round((doc.height - rh) / 2);
        O.resizeCanvas(doc, rw, rh, -ox, -oy, null, { clip: true });
      }
    });
    S.View.fit(doc, false); S.bus.emit('doc:resized', doc);
  };
  /** rotate one raster layer about the document centre */
  S.Ops.rotateLayer = function (doc, l, deg) {
    if (!l || l.type !== 'raster' || l.embed) return false;
    const r = (deg * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r), cx = doc.width / 2, cy = doc.height / 2;
    const m = [cs, sn, -sn, cs, cx - cs * cx + sn * cy, cy - sn * cx - cs * cy];
    doc.commit('Rotate Layer', () => { l.canvas = O.mapCanvas(l.canvas, m, doc); if (l.mask) l.mask = O.mapMask(l.mask, m, doc, doc.width, doc.height); l.version++; doc.bump(l); });
    return true;
  };

  /* ---------- Ruler ---------- */
  T.register({
    id: 'ruler', name: 'Ruler', key: 'I', icon: 'ruler', group: 'eyedropper', cursor: 'crosshair',
    opts: { crop: true },
    options(bar) {
      const ui = T.ui, a = this.a, b = this.b, has = a && b;
      const dx = has ? b[0] - a[0] : 0, dy = has ? b[1] - a[1] : 0;
      const len = Math.hypot(dx, dy), ang = has ? (Math.atan2(-dy, dx) * 180) / Math.PI : 0;
      const ro = (l, v) => bar.appendChild(U.el('span', { class: 'opt-readout' }, [U.el('span', { class: 'opt-label' }, l), U.el('b', {}, v)]));
      ro('X', has ? fmt(a[0]) : '–'); ro('Y', has ? fmt(a[1]) : '–'); ro('W', has ? fmt(Math.abs(dx)) : '–'); ro('H', has ? fmt(Math.abs(dy)) : '–');
      ro('A', has ? fmt(ang) + '°' : '–'); ro('L', has ? fmt(len) + ' px' : '–');
      ui.sep(bar);
      ui.check(bar, 'Crop to fit', this.opts, 'crop');
      const st = ui.button(bar, 'Straighten Image', () => this.straighten(false), { primary: true });
      const sl = ui.button(bar, 'Straighten Layer', () => this.straighten(true));
      st.disabled = sl.disabled = !has || len < 2;
      ui.button(bar, 'Clear', () => { this.a = this.b = null; T.renderOptions(); S.View.redraw(); });
      bar.appendChild(U.el('span', { class: 'muted opt-hint' }, 'Drag along something that should be level or upright, then Straighten'));
    },
    /** the rotation that makes the measured line horizontal (or vertical when it is closer to that) */
    angle() {
      if (!this.a || !this.b) return 0;
      let ang = (Math.atan2(-(this.b[1] - this.a[1]), this.b[0] - this.a[0]) * 180) / Math.PI;
      while (ang > 45) ang -= 90; while (ang <= -45) ang += 90;
      return ang;
    },
    straighten(layerOnly) {
      const d = S.app.doc; if (!d || !this.a || !this.b) return;
      const deg = this.angle(); if (Math.abs(deg) < 0.01) { S.toast('Already level'); return; }
      if (layerOnly) { if (!S.Ops.rotateLayer(d, d.activeLayer(), deg)) S.toast('Straighten Layer needs a pixel layer (rasterize embedded / text / shape layers first)'); }
      else S.Ops.straightenCanvas(d, deg, this.opts.crop);
      this.a = this.b = null; T.renderOptions();
    },
    activate() { this.a = this.b = null; },
    onDown(info) { const [x, y] = S.View.snapPoint(info.x, info.y); this.a = [x, y]; this.b = [x, y]; this.drag = true; S.View.redraw(); },
    onMove(info) {
      if (!this.drag) return;
      let [x, y] = S.View.snapPoint(info.x, info.y);
      if (info.shift) { const dx = x - this.a[0], dy = y - this.a[1]; if (Math.abs(dx) > Math.abs(dy)) y = this.a[1]; else x = this.a[0]; }
      this.b = [x, y]; T.renderOptions(); S.View.redraw();
    },
    onUp() { this.drag = false; T.renderOptions(); },
    onKey(e) { if (e.key === 'Enter' && this.a && this.b) { this.straighten(false); return true; } if (e.key === 'Escape') { this.a = this.b = null; T.renderOptions(); S.View.redraw(); return true; } return false; },
    drawOverlay(ctx, doc) {
      if (!this.a || !this.b) return;
      const [x1, y1] = S.View.toScreen(this.a[0], this.a[1], doc), [x2, y2] = S.View.toScreen(this.b[0], this.b[1], doc);
      ctx.save();
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.lineWidth = 1.2; ctx.strokeStyle = '#f0913a'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      [[x1, y1], [x2, y2]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke(); });
      const dx = this.b[0] - this.a[0], dy = this.b[1] - this.a[1];
      const label = fmt(Math.hypot(dx, dy)) + ' px · ' + fmt((Math.atan2(-dy, dx) * 180) / Math.PI) + '°';
      ctx.font = '11px system-ui, sans-serif'; const tw = ctx.measureText(label).width;
      const lx = (x1 + x2) / 2 + 8, ly = (y1 + y2) / 2 - 8;
      ctx.fillStyle = 'rgba(20,18,16,.85)'; ctx.fillRect(lx - 4, ly - 12, tw + 8, 16); ctx.fillStyle = '#fff'; ctx.fillText(label, lx, ly);
      ctx.restore();
    },
  });

  /* ---------- Perspective Crop ---------- */
  T.register({
    id: 'pcrop', name: 'Perspective Crop', key: 'C', icon: 'pcrop', group: 'crop', cursor: 'crosshair',
    opts: { grid: true, size: 'auto', w: 1000, h: 1000 },
    options(bar) {
      const ui = T.ui, o = this.opts;
      ui.select(bar, 'Output', o, 'size', [{ value: 'auto', label: 'Auto (from the drawn edges)' }, { value: 'custom', label: 'Custom size' }], () => T.renderOptions());
      if (o.size === 'custom') { ui.num(bar, 'W', o, 'w', 1, 20000, { unit: 'px' }); ui.num(bar, 'H', o, 'h', 1, 20000, { unit: 'px' }); }
      ui.check(bar, 'Grid', o, 'grid');
      ui.sep(bar);
      const c = this.corners;
      const commit = ui.button(bar, 'Crop', () => this.commit(), { primary: true }); commit.disabled = !c;
      ui.button(bar, 'Cancel', () => this.cancel());
      bar.appendChild(U.el('span', { class: 'muted opt-hint' }, c ? 'Drag the corners onto the four corners of the surface, then Crop (Enter)' : 'Drag a box, then move its corners onto the skewed surface'));
    },
    activate() { this.corners = null; this.drag = null; },
    deactivate() { this.corners = null; },
    cancel() { this.corners = null; this.drag = null; T.renderOptions(); S.View.redraw(); },
    outSize() {
      const c = this.corners, o = this.opts; if (!c) return null;
      if (o.size === 'custom') return [Math.round(o.w), Math.round(o.h)];
      const L = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);
      return [Math.max(1, Math.round((L(c[0], c[1]) + L(c[3], c[2])) / 2)), Math.max(1, Math.round((L(c[0], c[3]) + L(c[1], c[2])) / 2))];
    },
    hit(info, doc) {
      if (!this.corners) return null;
      for (let i = 0; i < 4; i++) { const [sx, sy] = S.View.toScreen(this.corners[i][0], this.corners[i][1], doc); if (Math.hypot(sx - info.sx, sy - info.sy) < 10) return { i }; }
      return null;
    },
    onHover(info, doc) { this._hover = this.hit(info, doc); S.View.updateCursor(); },
    cursor() { return this._hover ? 'move' : 'crosshair'; },
    onDown(info, doc) {
      const [x, y] = S.View.snapPoint(info.x, info.y);
      const h = this.hit(info, doc);
      if (h) { this.drag = { i: h.i }; return; }
      this.corners = [[x, y], [x, y], [x, y], [x, y]]; this.drag = { newBox: true, x0: x, y0: y };
    },
    onMove(info) {
      const d = this.drag; if (!d) return;
      const [x, y] = S.View.snapPoint(info.x, info.y);
      if (d.newBox) { const x1 = Math.min(d.x0, x), x2 = Math.max(d.x0, x), y1 = Math.min(d.y0, y), y2 = Math.max(d.y0, y); this.corners = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]; }
      else this.corners[d.i] = [x, y];
      S.View.redraw();
    },
    onUp() { if (this.drag && this.drag.newBox) { const c = this.corners; if (Math.abs(c[1][0] - c[0][0]) < 2 || Math.abs(c[3][1] - c[0][1]) < 2) this.corners = null; } this.drag = null; T.renderOptions(); S.View.redraw(); },
    onDblClick() { this.commit(); },
    onKey(e) { if (e.key === 'Enter') { this.commit(); return true; } if (e.key === 'Escape') { this.cancel(); return true; } return false; },
    drawOverlay(ctx, doc) {
      const c = this.corners; if (!c) return;
      const sc = c.map((p) => S.View.toScreen(p[0], p[1], doc));
      ctx.save();
      // shield outside the quad
      ctx.fillStyle = 'rgba(10,8,6,.5)'; ctx.beginPath(); ctx.rect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.moveTo(sc[0][0], sc[0][1]); for (let i = 3; i >= 1; i--) ctx.lineTo(sc[i][0], sc[i][1]); ctx.closePath(); ctx.fill('evenodd');
      ctx.strokeStyle = '#f0913a'; ctx.lineWidth = 1.2; ctx.beginPath(); sc.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke();
      if (this.opts.grid) {
        const H = S.Geom.homography(c.map((p) => ({ x: p[0], y: p[1] })));
        ctx.strokeStyle = 'rgba(240,145,58,.45)'; ctx.lineWidth = 1; ctx.beginPath();
        for (let k = 1; k < 3; k++) { const t = k / 3; const a = H(t, 0), b = H(t, 1), e = H(0, t), f = H(1, t); [[a, b], [e, f]].forEach(([p, q]) => { const ps = S.View.toScreen(p[0], p[1], doc), qs = S.View.toScreen(q[0], q[1], doc); ctx.moveTo(ps[0], ps[1]); ctx.lineTo(qs[0], qs[1]); }); }
        ctx.stroke();
      }
      sc.forEach((p) => { ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#f0913a'; ctx.stroke(); });
      const sz = this.outSize(); if (sz) { const label = sz[0] + ' × ' + sz[1] + ' px'; ctx.font = '11px system-ui, sans-serif'; const tw = ctx.measureText(label).width; ctx.fillStyle = 'rgba(20,18,16,.85)'; ctx.fillRect(sc[2][0] - tw - 10, sc[2][1] + 6, tw + 8, 16); ctx.fillStyle = '#fff'; ctx.fillText(label, sc[2][0] - tw - 6, sc[2][1] + 18); }
      ctx.restore();
    },
    commit() {
      const d = S.app.doc, c = this.corners; if (!d || !c) return;
      const [W, H] = this.outSize();
      if (W * H > 80e6) { S.toast('Output is too large (' + W + ' × ' + H + ')'); return; }
      const quad = c.map((p) => ({ x: p[0], y: p[1] }));
      d.commit('Perspective Crop', () => {
        O.perspectiveCrop(d, quad, W, H);
      });
      this.corners = null; S.View.fit(d, false); S.bus.emit('doc:resized', d); T.renderOptions();
    },
  });

  /** Map the quad (document coords, clockwise from top-left) onto a W×H rectangle: every raster layer and mask
   *  is resampled (bilinear); parametric layers are rasterized first. */
  O.perspectiveCrop = function (doc, quad, W, H) {
    const Hm = S.Geom.homography(quad);
    // forward homography rect(0..1) → quad; sample per output pixel
    const map = (src, outside) => { // src: ImageData over the whole document (plus transparent outside)
      const sw = src.width, sh = src.height, sd = src.data, out = new ImageData(W, H), od = out.data;
      const ox = src.ox || 0, oy = src.oy || 0;
      for (let y = 0; y < H; y++) {
        const v = (y + 0.5) / H;
        for (let x = 0; x < W; x++) {
          const [px, py] = Hm((x + 0.5) / W, v);
          const fx = px - ox - 0.5, fy = py - oy - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
          const o = (y * W + x) * 4;
          let r = 0, g = 0, b = 0, a = 0;
          for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
            const xx = x0 + i, yy = y0 + j, wgt = (i ? tx : 1 - tx) * (j ? ty : 1 - ty);
            if (xx < 0 || yy < 0 || xx >= sw || yy >= sh) { a += outside * wgt; r += outside * wgt * 0; continue; }
            const k = (yy * sw + xx) * 4, wa = sd[k + 3] * wgt;
            r += sd[k] * wa; g += sd[k + 1] * wa; b += sd[k + 2] * wa; a += wa;
          }
          if (a > 0) { od[o] = r / a; od[o + 1] = g / a; od[o + 2] = b / a; od[o + 3] = a; }
        }
      }
      return out;
    };
    doc.walk((l) => {
      if (l.type !== 'raster' && l.type !== 'group') O.rasterize(doc, l);
    });
    doc.walk((l) => {
      if (l.type === 'raster') {
        if (l.embed) O.rasterize(doc, l);
        const r = U.rectOf(l.canvas);
        const src = l.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, l.canvas.width, l.canvas.height); src.ox = r.x; src.oy = r.y;
        const out = map(src, 0);
        const c = U.createCanvas(W, H); c.getContext('2d').putImageData(out, 0, 0); l.canvas = c; l.version++;
      }
      if (l.mask && !l.mask.canvas._empty) {
        const mc = l.mask.canvas, r = U.rectOf(mc), fillA = S.Layers.maskOutside ? S.Layers.maskOutside(l.mask) : 0;
        const src = mc.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, mc.width, mc.height); src.ox = r.x; src.oy = r.y;
        const out = map(src, fillA);
        const c = U.createCanvas(W, H); c.getContext('2d').putImageData(out, 0, 0); l.mask = { ...l.mask, canvas: c, version: (l.mask.version || 0) + 1 };
      }
      l._rv = -1; l._thumbDirty = true;
    });
    doc.selection = null; doc.lastSelection = null; doc.guides = []; doc.paths = doc.paths.map((p) => p); doc.quickMask = null;
    doc.width = W; doc.height = H; doc.composite = null;
  };
})();
