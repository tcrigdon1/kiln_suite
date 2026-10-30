/* =========================================================================
   Gesso — Mesh Warp (Edit ▸ Transform ▸ Mesh Warp).  A grid of control points (3×3 … 6×6) over the
   layer's pixels; dragging the points bends the image through a Catmull-Rom spline surface.  The result is
   resampled with bicubic filtering (bilinear while dragging) into a new content-sized canvas, so pixels may
   bend past the document edge without being lost.  Enter / Commit = one history step, Esc = cancel.
   Perspective (4-corner) distortion remains in Free Transform (Ctrl+corner).
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util, T = S.Tools;
  const MW = (S.MeshWarp = { active: null });

  /** Catmull-Rom interpolation of 4 values at t∈[0,1] */
  const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  /** evaluate the control grid (rows × cols of {x,y}) at (u,v) ∈ [0,1]² */
  function evalGrid(G, u, v) {
    const rows = G.length, cols = G[0].length;
    const fx = u * (cols - 1), fy = v * (rows - 1);
    let i = Math.min(cols - 2, Math.floor(fx)), j = Math.min(rows - 2, Math.floor(fy));
    const tx = fx - i, ty = fy - j;
    const col = (c) => U.clamp(c, 0, cols - 1), row = (r) => U.clamp(r, 0, rows - 1);
    const rx = [], ry = [];
    for (let k = -1; k <= 2; k++) {
      const r = G[row(j + k)];
      rx.push(cr(r[col(i - 1)].x, r[col(i)].x, r[col(i + 1)].x, r[col(i + 2)].x, tx));
      ry.push(cr(r[col(i - 1)].y, r[col(i)].y, r[col(i + 1)].y, r[col(i + 2)].y, tx));
    }
    return [cr(rx[0], rx[1], rx[2], rx[3], ty), cr(ry[0], ry[1], ry[2], ry[3], ty)];
  }

  /**
   * Render src (offset canvas, source rect R in document space) through the grid into a new canvas.
   * Cells of the spline surface are rasterised as destination triangles whose source coordinates are
   * interpolated barycentrically, then sampled (bicubic / bilinear, premultiplied) from the source.
   */
  function renderMesh(src, R, G, quality, doc) {
    const cellPx = quality === 'bicubic' ? 6 : 10;
    const nu = Math.max(2, Math.ceil(R.w / cellPx)), nv = Math.max(2, Math.ceil(R.h / cellPx));
    // surface sample points: destination position for source lattice point (u,v)
    const P = new Float32Array((nu + 1) * (nv + 1) * 2);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const [x, y] = evalGrid(G, i / nu, j / nv), k = (j * (nu + 1) + i) * 2;
      P[k] = x; P[k + 1] = y;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    let B = U.rectRound({ x: minX - 1, y: minY - 1, w: maxX - minX + 2, h: maxY - minY + 2 });
    B = (B && U.rectIntersect(B, S.Layers.limitRect(doc))) || { x: 0, y: 0, w: 1, h: 1 };
    const out = U.createCanvas(B.w, B.h, B.x, B.y), W = B.w, Hh = B.h;
    const sx = new Float32Array(W * Hh), sy = new Float32Array(W * Hh), cov = new Uint8Array(W * Hh);
    // rasterise every cell as two triangles (source coords are affine per triangle)
    const tri = (ax, ay, au, av, bx, by, bu, bv, cx, cy, cu, cv) => {
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - B.x)), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx) - B.x));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - B.y)), y1 = Math.min(Hh - 1, Math.ceil(Math.max(ay, by, cy) - B.y));
      const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay); if (Math.abs(det) < 1e-9) return;
      const id = 1 / det, eps = -0.002;
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5 + B.y;
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5 + B.x;
          const l1 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) * id; if (l1 < eps) continue;
          const l2 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) * id; if (l2 < eps) continue;
          const l3 = 1 - l1 - l2; if (l3 < eps) continue;
          const k = y * W + x;
          sx[k] = l1 * au + l2 * bu + l3 * cu; sy[k] = l1 * av + l2 * bv + l3 * cv; cov[k] = 1;
        }
      }
    };
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const k00 = (j * (nu + 1) + i) * 2, k10 = k00 + 2, k01 = k00 + (nu + 1) * 2, k11 = k01 + 2;
      const u0 = R.x + (i / nu) * R.w, u1 = R.x + ((i + 1) / nu) * R.w, v0 = R.y + (j / nv) * R.h, v1 = R.y + ((j + 1) / nv) * R.h;
      tri(P[k00], P[k00 + 1], u0, v0, P[k10], P[k10 + 1], u1, v0, P[k11], P[k11 + 1], u1, v1);
      tri(P[k00], P[k00 + 1], u0, v0, P[k11], P[k11 + 1], u1, v1, P[k01], P[k01 + 1], u0, v1);
    }
    // sample the source
    const sr = U.rectOf(src), sd = S.Layers.readRect(src, sr).data, SW = sr.w, SH = sr.h;
    const img = out.getContext('2d').createImageData(W, Hh), o = img.data;
    const cubic = (t) => { t = Math.abs(t); return t < 1 ? 1.5 * t * t * t - 2.5 * t * t + 1 : t < 2 ? -0.5 * t * t * t + 2.5 * t * t - 4 * t + 2 : 0; };
    for (let k = 0; k < cov.length; k++) {
      if (!cov[k]) continue;
      const x = sx[k] - sr.x - 0.5, y = sy[k] - sr.y - 0.5;
      let R_ = 0, G_ = 0, B_ = 0, A_ = 0, Wt = 0;
      if (quality === 'bicubic') {
        const fx = Math.floor(x), fy = Math.floor(y);
        for (let j = -1; j <= 2; j++) { const yy = fy + j; if (yy < 0 || yy >= SH) continue; const wy = cubic(y - yy);
          for (let i = -1; i <= 2; i++) { const xx = fx + i; if (xx < 0 || xx >= SW) continue; const w = wy * cubic(x - xx); if (!w) continue; const q = (yy * SW + xx) * 4, a = sd[q + 3] * w; R_ += sd[q] * a; G_ += sd[q + 1] * a; B_ += sd[q + 2] * a; A_ += a; Wt += w; } }
      } else {
        const fx = Math.floor(x), fy = Math.floor(y), ax = x - fx, ay = y - fy;
        for (let j = 0; j < 2; j++) { const yy = fy + j; if (yy < 0 || yy >= SH) continue; for (let i = 0; i < 2; i++) { const xx = fx + i; if (xx < 0 || xx >= SW) continue; const w = (i ? ax : 1 - ax) * (j ? ay : 1 - ay); const q = (yy * SW + xx) * 4, a = sd[q + 3] * w; R_ += sd[q] * a; G_ += sd[q + 1] * a; B_ += sd[q + 2] * a; A_ += a; Wt += w; } }
      }
      if (A_ <= 0) continue;
      const m = k * 4; o[m] = R_ / A_; o[m + 1] = G_ / A_; o[m + 2] = B_ / A_; o[m + 3] = Math.min(255, Math.max(0, A_ / (Wt || 1)));
    }
    out.getContext('2d').putImageData(img, 0, 0);
    return out;
  }
  MW.renderMesh = renderMesh;

  MW.begin = async function (opts) {
    const doc = S.app.doc; if (!doc || MW.active) return;
    if (S.Transform.active) S.Transform.commit();
    let l = doc.activeLayer();
    if (!l) { S.toast('No layer selected'); return; }
    if (l.locks.all || l.locks.position || l.locks.pixels) { S.toast('Layer is locked'); return; }
    if (l.type === 'group' || l.type === 'adjustment' || l.type === 'fill') { S.toast('Mesh Warp works on a pixel, text or shape layer'); return; }
    if (l.type !== 'raster' || S.Embed.is(l)) {
      if (!(await S.Dialog.confirm('“' + l.name + '” is ' + (S.Embed.is(l) ? 'an embedded object' : 'a ' + l.type + ' layer') + '. Rasterize it so it can be mesh-warped?', 'Rasterize'))) return;
      doc.commit('Rasterize', () => S.Ops.rasterize(doc, l)); l = doc.findLayer(l.id);
    }
    const R = S.Layers.contentRect(l);
    if (!R) { S.toast('Layer is empty'); return; }
    const before = doc.captureState();
    const st = { doc, l, before, src: l.canvas, rect: R, quality: S.app.prefs.interpolation || 'bicubic', prevTool: S.app.tool, size: (opts && opts.size) || MW.tool.opts.grid || 4 };
    st.grid = MW.makeGrid(R, st.size);
    MW.active = st;
    S.app.tool = MW.tool;
    T.renderOptions(); T.renderStrip(); S.View.updateCursor(); S.bus.emit('tool:changed', MW.tool);
    MW.render();
  };
  MW.makeGrid = function (R, n) {
    const G = [];
    for (let j = 0; j < n; j++) { const row = []; for (let i = 0; i < n; i++) row.push({ x: R.x + (i / (n - 1)) * R.w, y: R.y + (j / (n - 1)) * R.h }); G.push(row); }
    return G;
  };
  MW.isIdentity = function (st) { const G0 = MW.makeGrid(st.rect, st.size); return st.grid.every((row, j) => row.every((p, i) => Math.abs(p.x - G0[j][i].x) < 0.01 && Math.abs(p.y - G0[j][i].y) < 0.01)); };
  MW.render = function (final) {
    const st = MW.active; if (!st) return;
    const q = final ? st.quality : (st.dragging ? 'bilinear' : st.quality);
    st.l.canvas = renderMesh(st.src, st.rect, st.grid, q, st.doc);
    st.l.version++; st.l._thumbDirty = true;
    st.doc.invalidate();
  };
  MW.commit = function () {
    const st = MW.active; if (!st) return;
    MW.active = null;
    if (MW.isIdentity(st)) { st.l.canvas = st.src; st.doc.restoreState(st.before); }
    else { st.l.canvas = renderMesh(st.src, st.rect, st.grid, st.quality, st.doc); S.Layers.trimInPlace(st.l.canvas); st.l.version++; st.doc.pushState('Mesh Warp', st.before); }
    MW.exit(st);
  };
  MW.cancel = function () {
    const st = MW.active; if (!st) return;
    MW.active = null;
    st.doc.restoreState(st.before); S.bus.emit('layers:changed', st.doc);
    MW.exit(st);
  };
  MW.exit = function (st) {
    S.app.tool = st.prevTool && st.prevTool !== MW.tool ? st.prevTool : S.Tools.byId.move;
    T.renderOptions(); T.renderStrip(); S.View.updateCursor(); S.View.redraw();
    S.bus.emit('tool:changed', S.app.tool);
  };

  MW.tool = {
    id: 'meshWarp', name: 'Mesh Warp', icon: 'meshWarp', group: '_transform', key: '', opts: { grid: 4 },
    options(bar) {
      const st = MW.active; if (!st) return;
      const ui = T.ui;
      ui.select(bar, 'Grid', this.opts, 'grid', [{ value: 3, label: '3 × 3' }, { value: 4, label: '4 × 4' }, { value: 5, label: '5 × 5' }, { value: 6, label: '6 × 6' }], (v) => { st.size = v; st.grid = MW.makeGrid(st.rect, v); MW.render(); });
      ui.select(bar, 'Interpolation', st, 'quality', [{ value: 'bilinear', label: 'Bilinear' }, { value: 'bicubic', label: 'Bicubic (smooth)' }], () => MW.render());
      ui.sep(bar);
      ui.button(bar, 'Reset', () => { st.grid = MW.makeGrid(st.rect, st.size); MW.render(); });
      ui.button(bar, 'Cancel', () => MW.cancel(), { tip: 'Esc' });
      ui.button(bar, 'Commit', () => MW.commit(), { primary: true, tip: 'Enter' });
      bar.appendChild(U.el('span', { class: 'muted opt-hint' }, 'Drag the grid points · Shift: move a whole row/column · Enter commits'));
    },
    hit(info) {
      const st = MW.active; let best = null, bd = 10;
      st.grid.forEach((row, j) => row.forEach((p, i) => { const [sx, sy] = S.View.toScreen(p.x, p.y); const d = Math.hypot(sx - info.sx, sy - info.sy); if (d < bd) { bd = d; best = { i, j }; } }));
      return best;
    },
    cursor() { return this._hover ? 'move' : 'default'; },
    onHover(info) { if (MW.active) { this._hover = this.hit(info); S.View.updateCursor(); } },
    onDown(info) {
      const st = MW.active; if (!st) return;
      const h = this.hit(info); if (!h) return;
      st.dragging = { h, x0: info.x, y0: info.y, grid0: st.grid.map((r) => r.map((p) => ({ ...p }))), shift: info.shift };
    },
    onMove(info) {
      const st = MW.active; if (!st || !st.dragging) return;
      const d = st.dragging, dx = info.x - d.x0, dy = info.y - d.y0;
      st.grid = d.grid0.map((row, j) => row.map((p, i) => {
        const hitRow = j === d.h.j, hitCol = i === d.h.i;
        if (d.shift || info.shift) return hitRow || hitCol ? { x: p.x + dx, y: p.y + dy } : p; // whole row and column
        return hitRow && hitCol ? { x: p.x + dx, y: p.y + dy } : p;
      }));
      if (!this._q) { this._q = true; requestAnimationFrame(() => { this._q = false; if (MW.active && MW.active.dragging) MW.render(); }); }
    },
    onUp() { const st = MW.active; if (!st) return; st.dragging = null; MW.render(); },
    onKey(e) {
      if (e.key === 'Enter') { MW.commit(); return true; }
      if (e.key === 'Escape') { MW.cancel(); return true; }
      if ((e.ctrlKey || e.metaKey) && /^[zy]$/i.test(e.key)) { const st = MW.active; if (st && e.key.toLowerCase() === 'z' && !e.shiftKey) { if (MW.isIdentity(st)) MW.cancel(); else { st.grid = MW.makeGrid(st.rect, st.size); MW.render(); S.toast('Mesh reset (Esc cancels)', 900); } } return true; }
      return false;
    },
    commitOnSwitch() { MW.commit(); },
    get hideAnts() { return true; },
    drawOverlay(ctx) {
      const st = MW.active; if (!st) return;
      const G = st.grid, n = st.size;
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(240,145,58,.9)';
      // spline curves through the control points
      const steps = 12;
      ctx.beginPath();
      for (let j = 0; j < n; j++) { for (let k = 0; k <= (n - 1) * steps; k++) { const [x, y] = evalGrid(G, k / ((n - 1) * steps), j / (n - 1)); const [sx, sy] = S.View.toScreen(x, y); if (k) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); } }
      for (let i = 0; i < n; i++) { for (let k = 0; k <= (n - 1) * steps; k++) { const [x, y] = evalGrid(G, i / (n - 1), k / ((n - 1) * steps)); const [sx, sy] = S.View.toScreen(x, y); if (k) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); } }
      ctx.stroke();
      G.forEach((row, j) => row.forEach((p, i) => {
        const [sx, sy] = S.View.toScreen(p.x, p.y);
        const hot = this._hover && this._hover.i === i && this._hover.j === j;
        ctx.fillStyle = hot ? '#f0913a' : '#1c1916'; ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }));
    },
  };
  S.bus.on('doc:switched', (d) => { if (MW.active && MW.active.doc !== d) MW.commit(); });
})();
