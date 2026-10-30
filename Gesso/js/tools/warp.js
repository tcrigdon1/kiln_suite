/* =========================================================================
   Gesso — Flow Warp tool (fluid distortion brushes).  Push, Pull, Twirl, Pinch, Bloat and Reconstruct brushes
   deform a raster layer through a displacement field (inverse mapping: for every output pixel the
   field says where in the untouched source it samples, bilinear).  The field lives in a session that
   starts with the first stroke and spans any number of strokes, so the result is previewed live on the
   layer itself; Enter / Commit bakes it as one history step, Esc / Cancel restores the source, "Reset"
   straightens everything.  Ctrl+Z inside the session undoes the last stroke.  An optional mesh shows the
   deformation.  Painting is limited to the selection when there is one.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util, T = S.Tools;

  const MODES = [{ value: 'push', label: 'Push (forward warp)' }, { value: 'pull', label: 'Pull (toward brush)' }, { value: 'twirl', label: 'Twirl (Alt: reverse)' }, { value: 'pinch', label: 'Pinch' }, { value: 'bloat', label: 'Bloat' }, { value: 'reconstruct', label: 'Reconstruct' }, { value: 'freeze', label: 'Freeze (protect)' }, { value: 'thaw', label: 'Thaw (unprotect)' }];

  /** A warp session on one layer */
  class Session {
    constructor(doc, l) {
      this.doc = doc; this.l = l;
      this.src = U.cloneCanvas(l.canvas);           // untouched source (offset canvas)
      this.before = doc.captureState();
      // working rect = the layer canvas rect; it grows when pixels are pushed outside (see ensure)
      const r = U.rectOf(l.canvas);
      this.alloc(r);
      l.canvas = U.cloneCanvas(this.src);           // the layer shows the live result (new identity: snapshots keep src)
      this.undoStack = [];
      this.sel = doc.selection;
    }
    alloc(r) {
      const n = r.w * r.h;
      const dx = new Float32Array(n), dy = new Float32Array(n), fz = new Float32Array(n);
      if (this.dx) { // copy the old field (and the freeze mask) into the new rect
        const o = this.rect;
        for (let y = 0; y < o.h; y++) { const yy = y + o.y - r.y; if (yy < 0 || yy >= r.h) continue; const so = y * o.w, to = yy * r.w + (o.x - r.x); dx.set(this.dx.subarray(so, so + o.w), to); dy.set(this.dy.subarray(so, so + o.w), to); fz.set(this.freeze.subarray(so, so + o.w), to); }
      }
      this.rect = { ...r }; this.dx = dx; this.dy = dy; this.freeze = fz;
      const sx = this.src.getContext('2d', { willReadFrequently: true });
      this.srcData = S.Layers.readRect(this.src, r).data; // source pixels in the working rect (transparent outside)
      void sx;
    }
    /** make the working rect contain document rect q */
    ensure(q) {
      const r = this.rect;
      const n = U.rectUnion(r, U.rectRound(q));
      if (n.x === r.x && n.y === r.y && n.w === r.w && n.h === r.h) return;
      const lim = S.Layers.limitRect(this.doc), c = U.rectIntersect(n, lim) || r;
      if (c.x === r.x && c.y === r.y && c.w === r.w && c.h === r.h) return;
      this.alloc(c);
      S.Layers.growTo(this.l.canvas, c, 0);
    }
    /** apply fn(i, x, y, w) to the field inside a brush circle; returns the dirty rect (document space) */
    brush(cx, cy, size, hardness, fn, ignoreFreeze) {
      const r = this.rect, rad = size / 2;
      const x0 = Math.max(r.x, Math.floor(cx - rad)), x1 = Math.min(r.x + r.w - 1, Math.ceil(cx + rad));
      const y0 = Math.max(r.y, Math.floor(cy - rad)), y1 = Math.min(r.y + r.h - 1, Math.ceil(cy + rad));
      if (x1 < x0 || y1 < y0) return null;
      const selM = this.sel && this.sel.mask, W = this.doc.width, H = this.doc.height;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const t = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / rad;
        if (t >= 1) continue;
        let w = S.Brush.falloff(t, hardness);
        if (selM) { if (x < 0 || y < 0 || x >= W || y >= H) continue; w *= selM[y * W + x] / 255; }
        const i = (y - r.y) * r.w + (x - r.x);
        if (!ignoreFreeze) w *= 1 - this.freeze[i];
        if (w <= 0.0005) continue;
        fn(i, x + 0.5, y + 0.5, w);
      }
      return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    }
    /** resample the dirty rect from the source through the field and write it to the layer canvas */
    render(d) {
      const r = this.rect, c = this.l.canvas;
      d = U.rectIntersect(d, r); if (!d) return;
      const ctx = c.getContext('2d'), img = ctx.createImageData(d.w, d.h), o = img.data, s = this.srcData, W = r.w, Hh = r.h;
      for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) {
        const px = d.x - r.x + x, py = d.y - r.y + y, i = py * W + px;
        let sx = px + this.dx[i], sy = py + this.dy[i];
        const k = (y * d.w + x) * 4;
        if (sx < -1 || sy < -1 || sx > W || sy > Hh) continue; // transparent
        // bilinear, premultiplied so transparent neighbours don't darken the colour
        const fx = Math.floor(sx), fy = Math.floor(sy), ax = sx - fx, ay = sy - fy;
        let R = 0, G = 0, B = 0, A = 0;
        for (let j = 0; j < 2; j++) for (let ii = 0; ii < 2; ii++) {
          const xx = fx + ii, yy = fy + j; if (xx < 0 || yy < 0 || xx >= W || yy >= Hh) continue;
          const wgt = (ii ? ax : 1 - ax) * (j ? ay : 1 - ay); if (!wgt) continue;
          const q = (yy * W + xx) * 4, a = s[q + 3] * wgt;
          R += s[q] * a; G += s[q + 1] * a; B += s[q + 2] * a; A += a;
        }
        if (A > 0) { o[k] = R / A; o[k + 1] = G / A; o[k + 2] = B / A; o[k + 3] = A; }
      }
      ctx.putImageData(img, d.x - (c.ox || 0), d.y - (c.oy || 0));
      this.l.version++; this.l._thumbDirty = true;
      this.doc.invalidate(d);
    }
    /* per-stroke undo: before each dab the field under the brush is saved as a chunk; a stroke is a list of
       chunks restored in reverse order (chunks are in document coordinates, so they survive growth) */
    beginStroke() { this.stroke = { chunks: [], bytes: 0, total: null }; }
    saveChunk(rect) {
      const st = this.stroke; if (!st || st.bytes > 96e6) return;
      const r = this.rect, q = U.rectIntersect(rect, r); if (!q) return;
      const n = q.w * q.h, dx = new Float32Array(n), dy = new Float32Array(n);
      for (let y = 0; y < q.h; y++) { const so = (q.y - r.y + y) * r.w + (q.x - r.x); dx.set(this.dx.subarray(so, so + q.w), y * q.w); dy.set(this.dy.subarray(so, so + q.w), y * q.w); }
      st.chunks.push({ q, dx, dy }); st.bytes += n * 8; st.total = U.rectUnion(st.total, q);
    }
    endStroke() {
      const st = this.stroke; this.stroke = null;
      if (!st || !st.chunks.length) return;
      if (st.bytes > 96e6) { this.undoStack.length = 0; return; } // too large to keep: no in-session undo for it
      this.undoStack.push(st);
      let bytes = 0; for (let i = this.undoStack.length - 1; i >= 0; i--) { bytes += this.undoStack[i].bytes; if (bytes > 160e6 || this.undoStack.length - i > 30) { this.undoStack.splice(0, i); break; } }
    }
    undo() {
      const st = this.undoStack.pop(); if (!st) return false;
      const r = this.rect;
      for (let k = st.chunks.length - 1; k >= 0; k--) {
        const u = st.chunks[k], q = U.rectIntersect(u.q, r); if (!q) continue;
        for (let y = 0; y < q.h; y++) { const to = (q.y - r.y + y) * r.w + (q.x - r.x), so = (q.y - u.q.y + y) * u.q.w + (q.x - u.q.x); this.dx.set(u.dx.subarray(so, so + q.w), to); this.dy.set(u.dy.subarray(so, so + q.w), to); }
      }
      this.render(st.total);
      return true;
    }
    reset() { this.beginStroke(); this.saveChunk(this.rect); this.endStroke(); this.dx.fill(0); this.dy.fill(0); this.render(this.rect); }
    isIdentity() { for (let i = 0; i < this.dx.length; i++) if (this.dx[i] || this.dy[i]) return false; return true; }
  }

  const tool = T.register({
    id: 'warp', name: 'Warp', key: 'Y', icon: 'warp', group: 'warp', cursor: 'crosshair',
    opts: { mode: 'push', size: 120, hardness: 0.3, strength: 50, mesh: false, meshStep: 24, showFreeze: true },
    brushCursor() { return this.opts.size; },
    brushCursorHard() { return this.opts.hardness; },
    options(bar) {
      const ui = T.ui, o = this.opts;
      ui.select(bar, 'Mode', o, 'mode', MODES);
      ui.num(bar, 'Size', o, 'size', 4, 2000, { unit: 'px' });
      ui.num(bar, 'Density', o, 'hardness', 0, 100, { unit: '%', scale: 100 });
      ui.num(bar, 'Pressure', o, 'strength', 1, 100, { unit: '%' });
      ui.check(bar, 'Show mesh', o, 'mesh');
      ui.check(bar, 'Show frozen', o, 'showFreeze');
      ui.sep(bar);
      ui.button(bar, 'Reset', () => { if (this.session) { this.session.reset(); S.View.redraw(); } });
      ui.button(bar, 'Thaw all', () => { if (this.session) { this.session.freeze.fill(0); S.View.redraw(); } });
      ui.button(bar, 'Cancel', () => this.cancel());
      ui.button(bar, 'Commit', () => this.commit(), { primary: true });
      bar.appendChild(U.el('span', { class: 'muted opt-hint' }, this.session ? 'Warping “' + this.session.l.name + '” — Enter commits, Esc cancels, Ctrl+Z undoes a stroke, Freeze protects areas' : 'Drag over a pixel layer to start'));
    },
    async onDown(info, doc) {
      if (this._starting) return;
      let s = this.session;
      if (s && s.doc !== doc) { this.commit(); s = null; }
      if (!s) {
        const l = doc.activeLayer();
        if (!l) { S.toast('Select a pixel layer'); return; }
        if (l.locks.all || l.locks.pixels) { S.toast('Layer is locked'); return; }
        if (l.type !== 'raster' || S.Embed.is(l)) {
          if (l.type === 'group' || l.type === 'adjustment') { S.toast('Warp works on pixel layers'); return; }
          this._starting = true;
          const ok = await S.Dialog.confirm('“' + l.name + '” is ' + (S.Embed.is(l) ? 'an embedded object' : 'a ' + l.type + ' layer') + '. Rasterize it so it can be warped?', 'Rasterize');
          this._starting = false;
          if (!ok) return;
          S.Cmd.run('layer.rasterize');
          return;
        }
        if (!S.Layers.contentRect(l)) { S.toast('Layer is empty'); return; }
        s = this.session = new Session(doc, l);
        T.renderOptions();
      } else if (s.l !== doc.activeLayer()) { S.toast('Commit or cancel the current warp first (Enter / Esc)'); return; }
      this.st = { last: { x: info.x, y: info.y }, total: null, alt: info.alt };
      s.beginStroke();
      this.dab(info, doc);
    },
    onMove(info, doc) { if (this.st && this.session) { this.dab(info, doc); } },
    onUp() {
      this.st = null;
      if (this.session) this.session.endStroke();
      S.View.redraw();
    },
    /** apply one brush step at the pointer */
    dab(info, doc) {
      const s = this.session, st = this.st, o = this.opts, sz = o.size, str = o.strength / 100;
      const mx = info.x - st.last.x, my = info.y - st.last.y;
      const reach = U.rectRound({ x: info.x - sz / 2 - 2, y: info.y - sz / 2 - 2, w: sz + 4, h: sz + 4 });
      s.ensure(reach);
      s.saveChunk(reach);
      const dx = s.dx, dy = s.dy, mode = o.mode, cx = info.x, cy = info.y;
      let dirty = null;
      const mag = Math.hypot(mx, my);
      if (mode === 'push') {
        if (mag < 0.01) return;
        dirty = s.brush(cx, cy, sz, o.hardness, (i, x, y, w) => { dx[i] -= mx * w * str * 1.2; dy[i] -= my * w * str * 1.2; });
      } else if (mode === 'pull') {
        const k = 0.08 * str;
        dirty = s.brush(cx, cy, sz, o.hardness, (i, x, y, w) => { dx[i] += (cx - x) * w * k; dy[i] += (cy - y) * w * k; });
      } else if (mode === 'twirl') {
        const a = (info.alt || st.alt ? -1 : 1) * 0.06 * str;
        dirty = s.brush(cx, cy, sz, o.hardness, (i, x, y, w) => {
          const vx = x - cx, vy = y - cy, ang = a * w, c = Math.cos(ang), sn = Math.sin(ang);
          dx[i] += (vx * c - vy * sn) - vx; dy[i] += (vx * sn + vy * c) - vy;
        });
      } else if (mode === 'pinch' || mode === 'bloat') {
        const k = (mode === 'pinch' ? 1 : -1) * 0.05 * str;
        dirty = s.brush(cx, cy, sz, o.hardness, (i, x, y, w) => { dx[i] += (x - cx) * w * k; dy[i] += (y - cy) * w * k; });
      } else if (mode === 'reconstruct') {
        const k = 0.12 * str;
        dirty = s.brush(cx, cy, sz, o.hardness, (i, x, y, w) => { dx[i] *= 1 - w * k; dy[i] *= 1 - w * k; });
      } else if (mode === 'freeze' || mode === 'thaw') {
        const fz = s.freeze, k = 0.25 * str + 0.05, up = mode === 'freeze';
        s.brush(cx, cy, sz, o.hardness, (i, x, y, w) => { fz[i] = up ? Math.min(1, fz[i] + w * k) : Math.max(0, fz[i] - w * k); }, true);
        st.last = { x: info.x, y: info.y }; S.View.redraw();
        return; // the picture itself does not change
      }
      st.last = { x: info.x, y: info.y };
      if (!dirty) return;
      st.total = U.rectUnion(st.total, dirty);
      s.render(dirty);
    },
    commit() {
      const s = this.session; if (!s) return;
      this.session = null; this.st = null;
      if (s.isIdentity()) { s.l.canvas = s.src; s.doc.restoreState(s.before); }
      else { S.Layers.trimInPlace(s.l.canvas); s.doc.pushState('Warp', s.before); }
      s.doc.invalidate(); S.bus.emit('layers:changed', s.doc);
      T.renderOptions(); S.View.redraw();
    },
    cancel() {
      const s = this.session; if (!s) return;
      this.session = null; this.st = null;
      s.doc.restoreState(s.before); S.bus.emit('layers:changed', s.doc);
      T.renderOptions(); S.View.redraw();
    },
    commitOnSwitch() { this.commit(); },
    deactivate() { this.commit(); },
    onKey(e) {
      if (!this.session) return false;
      if (e.key === 'Enter') { this.commit(); return true; }
      if (e.key === 'Escape') { this.cancel(); return true; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { if (!this.session.undo()) S.toast('Nothing to undo in this warp', 800); S.View.redraw(); return true; }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) return true;
      return false;
    },
    drawOverlay(ctx, doc) {
      const s = this.session; if (!s || s.doc !== doc) return;
      const r = s.rect, z = doc.view.zoom;
      // layer outline
      const [ax, ay] = S.View.toScreen(r.x, r.y), [bx, by] = S.View.toScreen(r.x + r.w, r.y + r.h);
      ctx.strokeStyle = 'rgba(240,145,58,.6)'; ctx.setLineDash([4, 3]); ctx.strokeRect(ax + 0.5, ay + 0.5, bx - ax, by - ay); ctx.setLineDash([]);
      if (this.opts.showFreeze !== false) { // frozen (protected) areas as a red tint
        let any = false; const fz = s.freeze; for (let i = 0; i < fz.length; i += 7) if (fz[i] > 0.01) { any = true; break; }
        if (any) {
          const key = r.w + 'x' + r.h;
          if (!this._fzc || this._fzKey !== key) { this._fzc = U.createCanvas(r.w, r.h); this._fzKey = key; }
          const fx = this._fzc.getContext('2d'), img = fx.createImageData(r.w, r.h), d = img.data;
          for (let i = 0; i < fz.length; i++) { const a = fz[i]; if (a > 0.01) { const k = i * 4; d[k] = 230; d[k + 1] = 40; d[k + 2] = 40; d[k + 3] = a * 110; } }
          fx.putImageData(img, 0, 0);
          ctx.save(); ctx.translate(doc.view.panX, doc.view.panY); ctx.scale(z, z); ctx.drawImage(this._fzc, r.x, r.y); ctx.restore();
        }
      }
      if (!this.opts.mesh) return;
      const step = Math.max(6, Math.round(this.opts.meshStep / Math.max(0.25, Math.min(1, z)))); // keep the mesh readable when zoomed out
      const node = (gx, gy) => { // deformed position of the image point that started at (gx,gy): output q shows source q+disp → image grid node at q−disp(q)
        const px = U.clamp(Math.round(gx - r.x), 0, r.w - 1), py = U.clamp(Math.round(gy - r.y), 0, r.h - 1), i = py * r.w + px;
        return S.View.toScreen(gx - s.dx[i], gy - s.dy[i]);
      };
      ctx.strokeStyle = 'rgba(61,191,174,.55)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let gy = r.y; gy <= r.y + r.h; gy += step) { let first = true; for (let gx = r.x; gx <= r.x + r.w; gx += step) { const [sx, sy] = node(gx, gy); if (first) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy); first = false; } }
      for (let gx = r.x; gx <= r.x + r.w; gx += step) { let first = true; for (let gy = r.y; gy <= r.y + r.h; gy += step) { const [sx, sy] = node(gx, gy); if (first) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy); first = false; } }
      ctx.stroke();
    },
  });
  S.WarpTool = tool;
  // a document switch or history jump while warping ends the session safely
  S.bus.on('doc:switched', (d) => { if (tool.session && tool.session.doc !== d) tool.commit(); });
})();
