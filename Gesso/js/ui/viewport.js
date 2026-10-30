/* =========================================================================
   Gesso — viewport: draws the active document (composite + overlays) on the
   screen canvas, handles zoom/pan, rulers, guides, grid, snapping, and routes
   pointer input to the active tool.

   View transform: screen = doc * zoom + pan   (CSS pixels, before DPR scaling)
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util;

  const V = (S.View = {
    zoomSteps: [0.02, 0.03, 0.05, 0.0625, 0.083, 0.125, 0.167, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 5, 6, 8, 12, 16, 24, 32, 48, 64],
    showRulers: true, showGrid: false, showGuides: true, showPixelGrid: true, snap: true, showSelEdges: true,
    mouse: { sx: 0, sy: 0, x: 0, y: 0, inside: false },
    spaceDown: false,
    antsOffset: 0,
  });

  V.init = function (ws) {
    V.ws = ws;
    V.canvas = ws.querySelector('#view');
    V.ctx = V.makeContext(V.canvas);
    V.rulerH = ws.querySelector('#ruler-h');
    V.rulerV = ws.querySelector('#ruler-v');
    V.corner = ws.querySelector('#ruler-corner');
    const p = S.store.get('view', {});
    Object.assign(V, { showRulers: p.showRulers ?? true, showGrid: p.showGrid ?? false, showGuides: p.showGuides ?? true, snap: p.snap ?? true, showPixelGrid: p.showPixelGrid ?? true });
    new ResizeObserver(() => V.resize()).observe(ws);
    V.resize();
    V.bindEvents();
    setInterval(() => { // marching ants animation
      const d = S.app.doc;
      if (d && (d.selection || (S.app.tool && S.app.tool.animated))) { V.antsOffset = (V.antsOffset + 1) % 8; V.redraw(); }
    }, 110);
    S.app.requestRender = () => V.redraw();
    S.bus.on('doc:switched', () => { V.applyRulerVisibility(); V.redraw(true); });
  };
  V.savePrefs = () => S.store.set('view', { showRulers: V.showRulers, showGrid: V.showGrid, showGuides: V.showGuides, snap: V.snap, showPixelGrid: V.showPixelGrid });

  V.applyRulerVisibility = function () {
    const on = V.showRulers && !!S.app.doc;
    V.ws.classList.toggle('rulers-on', on);
    V.resize();
  };
  V.resize = function () {
    const r = V.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    V.dpr = dpr; V.w = r.width; V.h = r.height;
    V.canvas.width = Math.max(1, Math.round(r.width * dpr));
    V.canvas.height = Math.max(1, Math.round(r.height * dpr));
    for (const rc of [V.rulerH, V.rulerV]) {
      const rr = rc.getBoundingClientRect();
      rc.width = Math.max(1, Math.round(rr.width * dpr)); rc.height = Math.max(1, Math.round(rr.height * dpr));
    }
    const d = S.app.doc;
    if (d && d.view.needsFit) V.fit(d, true);
    V.redraw(true);
  };

  /* ---------- coordinate helpers ---------- */
  V.toScreen = (x, y, d = S.app.doc) => [x * d.view.zoom + d.view.panX, y * d.view.zoom + d.view.panY];
  V.toDoc = (sx, sy, d = S.app.doc) => [(sx - d.view.panX) / d.view.zoom, (sy - d.view.panY) / d.view.zoom];
  V.visibleDocRect = function (d = S.app.doc) {
    const [x1, y1] = V.toDoc(0, 0, d), [x2, y2] = V.toDoc(V.w, V.h, d);
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  };
  V.fit = function (d = S.app.doc, capAt100) {
    if (!d || !V.w) return;
    const pad = 40;
    let z = Math.min((V.w - pad * 2) / d.width, (V.h - pad * 2) / d.height);
    // first view of a document: never above 100 %, except for tiny (pixel-art sized) documents, which open at
    // a comfortable integer zoom instead of as a speck
    if (capAt100 && z > 1) z = z >= 4 ? Math.max(1, V.zoomSteps.slice().reverse().find((s) => s <= z / 2 && s >= 1) || 1) : 1;
    z = Math.max(0.01, z);
    d.view.zoom = z;
    d.view.panX = Math.round((V.w - d.width * z) / 2);
    d.view.panY = Math.round((V.h - d.height * z) / 2);
    d.view.needsFit = false;
    V.viewChanged();
  };
  V.setZoom = function (z, sx, sy, d = S.app.doc) {
    if (!d) return;
    z = U.clamp(z, 0.01, 64);
    if (sx == null) { sx = V.w / 2; sy = V.h / 2; }
    const [dx, dy] = V.toDoc(sx, sy, d);
    d.view.zoom = z;
    d.view.panX = sx - dx * z; d.view.panY = sy - dy * z;
    V.viewChanged();
  };
  V.zoomStep = function (dir, sx, sy) {
    const d = S.app.doc; if (!d) return;
    const z = d.view.zoom;
    let nz;
    if (dir > 0) nz = V.zoomSteps.find((s) => s > z * 1.001) || 64;
    else nz = V.zoomSteps.slice().reverse().find((s) => s < z / 1.001) || 0.02;
    V.setZoom(nz, sx, sy);
  };
  V.pan = function (dx, dy) { const d = S.app.doc; if (!d) return; d.view.panX += dx; d.view.panY += dy; V.viewChanged(); };
  V.viewChanged = function () { V.redraw(true); S.bus.emit('view:changed', S.app.doc); };

  /* ---------- snapping ---------- */
  V.snapPoint = function (x, y, opts) {
    const d = S.app.doc;
    if (!d || !V.snap || (opts && opts.noSnap)) return [x, y];
    const tol = 7 / d.view.zoom;
    let bx = null, by = null, bdx = tol, bdy = tol;
    const tryX = (v) => { const dd = Math.abs(v - x); if (dd < bdx) { bdx = dd; bx = v; } };
    const tryY = (v) => { const dd = Math.abs(v - y); if (dd < bdy) { bdy = dd; by = v; } };
    tryX(0); tryX(d.width); tryX(d.width / 2); tryY(0); tryY(d.height); tryY(d.height / 2);
    if (V.showGuides) for (const g of d.guides) (g.dir === 'v' ? tryX : tryY)(g.pos);
    if (V.showGrid) {
      const gs = S.app.prefs.gridSize || 50, sub = gs / (S.app.prefs.gridSub || 4);
      tryX(Math.round(x / sub) * sub); tryY(Math.round(y / sub) * sub);
    }
    return [bx ?? x, by ?? y];
  };
  /**
   * Snap the moving end of a drag (marquee, shapes, crop).  A snap that would put the end on the same
   * line as the drag's start point is refused, so small boxes drawn near a guide or the canvas centre
   * don't collapse to zero width/height when both ends snap to that line.
   */
  V.snapDragPoint = function (x, y, x0, y0) {
    let [sx, sy] = V.snapPoint(x, y);
    if (Math.abs(sx - x0) < 1 && Math.abs(x - x0) >= 1) sx = x;
    if (Math.abs(sy - y0) < 1 && Math.abs(y - y0) >= 1) sy = y;
    return [sx, sy];
  };
  /** Snap a rectangle's edges (used by move/marquee) – returns dx,dy correction */
  V.snapRect = function (r) {
    const d = S.app.doc;
    if (!d || !V.snap) return [0, 0];
    const tol = 7 / d.view.zoom;
    let best = [null, null], bd = [tol, tol];
    const xs = [0, d.width, d.width / 2], ys = [0, d.height, d.height / 2];
    if (V.showGuides) for (const g of d.guides) (g.dir === 'v' ? xs : ys).push(g.pos);
    for (const ex of [r.x, r.x + r.w / 2, r.x + r.w]) for (const t of xs) { const dd = Math.abs(t - ex); if (dd < bd[0]) { bd[0] = dd; best[0] = t - ex; } }
    for (const ey of [r.y, r.y + r.h / 2, r.y + r.h]) for (const t of ys) { const dd = Math.abs(t - ey); if (dd < bd[1]) { bd[1] = dd; best[1] = t - ey; } }
    return [best[0] || 0, best[1] || 0];
  };

  /* ---------- drawing ---------- */
  let rafPending = false, viewDirty = true;
  V.redraw = function (full) {
    if (full) viewDirty = true;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; V.draw(); });
  };

  let checkerPat = null, checkerKey = '';
  function checker(ctx) {
    const p = S.app.prefs;
    const sz = p.checkerSize || 8, c1 = p.checkerA || '#ffffff', c2 = p.checkerB || '#cfcfcf';
    const key = sz + c1 + c2;
    if (!checkerPat || key !== checkerKey) {
      const c = U.createCanvas(sz * 2, sz * 2), x = c.getContext('2d');
      x.fillStyle = c1; x.fillRect(0, 0, sz * 2, sz * 2); x.fillStyle = c2; x.fillRect(0, 0, sz, sz); x.fillRect(sz, sz, sz, sz);
      checkerPat = ctx.createPattern(c, 'repeat'); checkerKey = key;
    }
    return checkerPat;
  }

  V.draw = function () {
    const ctx = V.ctx, d = S.app.doc, dpr = V.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--pasteboard') || '#141210';
    ctx.fillRect(0, 0, V.canvas.width, V.canvas.height);
    if (!d) return;
    const changed = S.Compositor.update(d);
    if (changed) S.bus.emit('composite:updated', d);
    const z = d.view.zoom, px = d.view.panX, py = d.view.panY;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // doc shadow + checkerboard
    const dw = d.width * z, dh = d.height * z;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 3;
    ctx.fillStyle = '#000'; ctx.fillRect(px, py, dw, dh);
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.rect(px, py, dw, dh); ctx.clip();
    ctx.fillStyle = checker(ctx); ctx.translate(px, py); ctx.fillRect(0, 0, dw, dh);
    ctx.restore();
    // composite
    ctx.save();
    ctx.translate(px, py); ctx.scale(z, z);
    ctx.imageSmoothingEnabled = z < 1;
    ctx.imageSmoothingQuality = 'high';
    if (V.proofFilter) ctx.filter = V.proofFilter();
    ctx.drawImage(d.composite, 0, 0);
    ctx.filter = 'none';
    if (V.drawOverlays) V.drawOverlays(ctx, d); // clipping / gamut warnings
    // live tool preview (e.g. transform, filter preview) drawn in doc space
    if (S.app.tool && S.app.tool.drawDocPreview) S.app.tool.drawDocPreview(ctx, d);
    // quick mask overlay
    if (d.quickMask) {
      const qm = quickMaskOverlay(d);
      ctx.drawImage(qm, 0, 0);
    }
    ctx.restore();
    // pixel grid
    if (V.showPixelGrid && z >= 10) drawPixelGrid(ctx, d);
    if (V.showGrid) drawGrid(ctx, d);
    // selection ants
    if (d.selection && !d.quickMask && V.showSelEdges && !(S.app.tool && S.app.tool.hideAnts)) drawAnts(ctx, d);
    if (V.showGuides) drawGuides(ctx, d);
    // paths
    drawPaths(ctx, d);
    // tool overlay in screen coords
    if (S.app.tool && S.app.tool.drawOverlay) { ctx.save(); S.app.tool.drawOverlay(ctx, d); ctx.restore(); }
    if (V.guideDrag) drawGuideLine(ctx, d, V.guideDrag.dir, V.guideDrag.pos, true);
    // brush cursor
    if (V.mouse.inside && S.app.tool && S.app.tool.brushCursor && S.app.prefs.cursor !== 'cross') drawBrushCursor(ctx, d);
    if (V.showRulers) drawRulers(d);
    viewDirty = false;
  };

  let qmCache = null;
  function quickMaskOverlay(d) {
    const v = (d.quickMask.version || 0) + ':' + (S.quickMaskStyle ? S.quickMaskStyle() : '');
    if (qmCache && qmCache.v === v && qmCache.doc === d && qmCache.c.width === d.width && qmCache.c.height === d.height) return qmCache.c;
    const c = qmCache && qmCache.c.width === d.width && qmCache.c.height === d.height ? qmCache.c : U.createCanvas(d.width, d.height);
    const x = c.getContext('2d');
    x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = S.quickMaskStyle ? S.quickMaskStyle() : 'rgba(230,40,40,0.5)'; x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'destination-out'; x.drawImage(d.quickMask.canvas, 0, 0);
    qmCache = { v, c, doc: d };
    return c;
  }

  function drawAnts(ctx, d) {
    const path = S.Sel.outline(d.selection);
    if (!path) return;
    const z = d.view.zoom;
    ctx.save();
    ctx.translate(d.view.panX, d.view.panY); ctx.scale(z, z);
    ctx.lineWidth = 1 / z;
    ctx.strokeStyle = '#fff'; ctx.setLineDash([]); ctx.stroke(path);
    ctx.strokeStyle = '#000'; ctx.setLineDash([4 / z, 4 / z]); ctx.lineDashOffset = -V.antsOffset / z; ctx.stroke(path);
    ctx.restore();
  }
  function drawPixelGrid(ctx, d) {
    const z = d.view.zoom, r = V.visibleDocRect(d);
    const x1 = Math.max(0, Math.floor(r.x)), x2 = Math.min(d.width, Math.ceil(r.x + r.w));
    const y1 = Math.max(0, Math.floor(r.y)), y2 = Math.min(d.height, Math.ceil(r.y + r.h));
    ctx.save(); ctx.strokeStyle = 'rgba(128,128,128,.35)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = x1; x <= x2; x++) { const sx = Math.round(x * z + d.view.panX) + 0.5; ctx.moveTo(sx, y1 * z + d.view.panY); ctx.lineTo(sx, y2 * z + d.view.panY); }
    for (let y = y1; y <= y2; y++) { const sy = Math.round(y * z + d.view.panY) + 0.5; ctx.moveTo(x1 * z + d.view.panX, sy); ctx.lineTo(x2 * z + d.view.panX, sy); }
    ctx.stroke(); ctx.restore();
  }
  function drawGrid(ctx, d) {
    const z = d.view.zoom, gs = S.app.prefs.gridSize || 50, sub = S.app.prefs.gridSub || 4;
    const [ox, oy] = V.toScreen(0, 0, d), [ex, ey] = V.toScreen(d.width, d.height, d);
    ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, ex - ox, ey - oy); ctx.clip();
    const step = gs / sub;
    if (step * z >= 6) {
      ctx.strokeStyle = 'rgba(61,191,174,.18)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = 0; x <= d.width; x += step) { const sx = Math.round(ox + x * z) + 0.5; ctx.moveTo(sx, oy); ctx.lineTo(sx, ey); }
      for (let y = 0; y <= d.height; y += step) { const sy = Math.round(oy + y * z) + 0.5; ctx.moveTo(ox, sy); ctx.lineTo(ex, sy); }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(61,191,174,.45)'; ctx.beginPath();
    for (let x = 0; x <= d.width; x += gs) { const sx = Math.round(ox + x * z) + 0.5; ctx.moveTo(sx, oy); ctx.lineTo(sx, ey); }
    for (let y = 0; y <= d.height; y += gs) { const sy = Math.round(oy + y * z) + 0.5; ctx.moveTo(ox, sy); ctx.lineTo(ex, sy); }
    ctx.stroke(); ctx.restore();
  }
  function drawGuideLine(ctx, d, dir, pos, active) {
    ctx.save();
    ctx.strokeStyle = active ? '#ffad62' : '#3dbfae'; ctx.lineWidth = 1;
    ctx.beginPath();
    if (dir === 'v') { const sx = Math.round(pos * d.view.zoom + d.view.panX) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, V.h); }
    else { const sy = Math.round(pos * d.view.zoom + d.view.panY) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(V.w, sy); }
    ctx.stroke(); ctx.restore();
  }
  function drawGuides(ctx, d) { for (const g of d.guides) if (!V.guideDrag || V.guideDrag.guide !== g) drawGuideLine(ctx, d, g.dir, g.pos); }

  function drawPaths(ctx, d) {
    const tool = S.app.tool;
    const showAll = tool && tool.showPaths;
    const path = d.paths.find((p) => p.id === d.activePathId);
    let shapePath = null;
    const al = d.activeLayer();
    if (showAll && al && al.type === 'shape') shapePath = S.Shape.editPath(al.shape);
    const list = [];
    if (path) list.push(path);
    if (shapePath) list.push({ path: shapePath, isShape: true });
    for (const p of list) {
      const P = p.path || p;
      const p2 = S.Paths.toPath2D(P, (x, y) => V.toScreen(x, y, d));
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 3; ctx.stroke(p2);
      ctx.strokeStyle = p.isShape ? '#ffad62' : '#3dbfae'; ctx.lineWidth = 1.2; ctx.stroke(p2);
      if (showAll) {
        const selN = tool.selectedNode;
        (P.subpaths || []).forEach((sp, si) => sp.nodes.forEach((n, i) => {
          const [ax, ay] = V.toScreen(n.x, n.y, d);
          const isSel = selN && selN.sp === si && selN.i === i && (tool.editTarget === (p.isShape ? 'shape' : 'path'));
          if (isSel || tool.showAllHandles) {
            for (const [hx, hy] of [[n.ix, n.iy], [n.ox, n.oy]]) {
              if (hx === n.x && hy === n.y) continue;
              const [sx, sy] = V.toScreen(hx, hy, d);
              ctx.strokeStyle = '#c8bdb1'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(sx, sy); ctx.stroke();
              ctx.fillStyle = '#c8bdb1'; ctx.beginPath(); ctx.arc(sx, sy, 3, 0, Math.PI * 2); ctx.fill();
            }
          }
          ctx.fillStyle = isSel ? '#3dbfae' : '#1c1916'; ctx.strokeStyle = '#3dbfae'; ctx.lineWidth = 1.2;
          ctx.fillRect(ax - 3.5, ay - 3.5, 7, 7); ctx.strokeRect(ax - 3.5, ay - 3.5, 7, 7);
        }));
      }
      ctx.restore();
    }
  }
  function drawBrushCursor(ctx, d) {
    const t = S.app.tool, size = t.brushCursor();
    if (!size) return;
    const r = (size / 2) * d.view.zoom;
    const { sx, sy } = V.mouse;
    ctx.save();
    if (r < 3) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(sx - 5, sy); ctx.lineTo(sx + 5, sy); ctx.moveTo(sx, sy - 5); ctx.lineTo(sx, sy + 5); ctx.stroke();
    } else {
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.beginPath(); ctx.arc(sx, sy, r + 0.5, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(sx, sy, r - 0.5, 0, Math.PI * 2); ctx.stroke();
      if (t.brushCursorHard && t.brushCursorHard() < 0.95 && r > 8) {
        const hr = Math.max(1, r * t.brushCursorHard());
        ctx.setLineDash([2, 3]); ctx.strokeStyle = 'rgba(0,0,0,.45)';
        ctx.beginPath(); ctx.arc(sx, sy, hr, 0, Math.PI * 2); ctx.stroke();
        ctx.lineDashOffset = 2.5; ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* ---------- rulers ---------- */
  function niceStep(z) {
    const target = 70 / z; // doc units per major tick ~70px
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
    return steps.find((s) => s >= target) || 10000;
  }
  function drawRulers(d) {
    const dpr = V.dpr;
    for (const horiz of [true, false]) {
      const rc = horiz ? V.rulerH : V.rulerV;
      const x = rc.getContext('2d');
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      const W = rc.width / dpr, H = rc.height / dpr;
      x.fillStyle = '#1c1916'; x.fillRect(0, 0, W, H);
      x.strokeStyle = '#3b342e'; x.beginPath();
      if (horiz) { x.moveTo(0, H - 0.5); x.lineTo(W, H - 0.5); } else { x.moveTo(W - 0.5, 0); x.lineTo(W - 0.5, H); }
      x.stroke();
      const z = d.view.zoom, pan = horiz ? d.view.panX : d.view.panY, len = horiz ? W : H;
      const step = niceStep(z), minor = step / 5;
      const start = Math.floor(-pan / z / step) * step, end = (len - pan) / z;
      x.fillStyle = '#8d8277'; x.strokeStyle = '#5a5047'; x.font = '9px ' + getComputedStyle(document.body).fontFamily;
      x.beginPath();
      for (let v = start; v <= end; v += minor) {
        const p = Math.round(v * z + pan) + 0.5;
        const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
        const tl = major ? 18 : 5;
        if (horiz) { x.moveTo(p, H); x.lineTo(p, H - tl); } else { x.moveTo(W, p); x.lineTo(W - tl, p); }
        if (major) {
          const label = String(Math.round(v));
          if (horiz) x.fillText(label, p + 3, 9);
          else { x.save(); x.translate(9, p + 3); x.rotate(-Math.PI / 2); x.textAlign = 'right'; x.fillText(label, 0, 0); x.restore(); }
        }
      }
      x.stroke();
      // mouse marker
      if (V.mouse.inside) {
        x.strokeStyle = '#f0913a'; x.beginPath();
        if (horiz) { const p = Math.round(V.mouse.sx) + 0.5; x.moveTo(p, 0); x.lineTo(p, H); } else { const p = Math.round(V.mouse.sy) + 0.5; x.moveTo(0, p); x.lineTo(W, p); }
        x.stroke();
      }
    }
  }

  /* ---------- input ---------- */
  function evInfo(e) {
    const r = V.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const d = S.app.doc;
    const [x, y] = d ? V.toDoc(sx, sy, d) : [0, 0];
    let pressure = e.pressure;
    if (e.pointerType === 'mouse' || !pressure) pressure = e.buttons || e.type === 'pointerup' ? 1 : 0;
    if (e.pointerType === 'mouse') pressure = 1;
    return { x, y, sx, sy, pressure, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, button: e.button, buttons: e.buttons, pointerType: e.pointerType, ev: e };
  }
  V.evInfo = evInfo;

  function guideAt(d, sx, sy) {
    if (!V.showGuides || d.guidesLocked) return null;
    for (const g of d.guides) {
      const p = g.dir === 'v' ? g.pos * d.view.zoom + d.view.panX : g.pos * d.view.zoom + d.view.panY;
      if (Math.abs((g.dir === 'v' ? sx : sy) - p) < 4) return g;
    }
    return null;
  }

  /** 2D context in the preferred display colour space (Display P3 when the browser supports it, else sRGB) */
  V.makeContext = function (canvas) {
    const prefs = S.store.get('prefs', {}), want = prefs.displaySpace === 'display-p3' ? 'display-p3' : 'srgb';
    let ctx = null;
    try { ctx = canvas.getContext('2d', { colorSpace: want }); } catch (e) { ctx = null; }
    if (!ctx) ctx = canvas.getContext('2d');
    let got = 'srgb';
    try { got = (ctx.getContextAttributes && ctx.getContextAttributes().colorSpace) || 'srgb'; } catch (e) {}
    V._space = got;
    return ctx;
  };
  /**
   * A canvas keeps the colour space of its first context, so switching the preference replaces the viewport
   * canvas element (same id / size / position) and re-binds its pointer handlers.
   */
  V.recreateCanvas = function () {
    const old = V.canvas, n = document.createElement('canvas');
    n.id = old.id; n.className = old.className; n.style.cssText = old.style.cssText;
    old.replaceWith(n);
    V.canvas = n; V.ctx = V.makeContext(n);
    if (V._bindCanvas) V._bindCanvas(n);
    V.resize(); V.updateCursor && V.updateCursor();
    return V._space;
  };

  V.bindEvents = function () {
    let drag = null; // {kind:'pan'|'tool'|'guide', ...}
    Object.defineProperty(V, 'dragging', { get: () => !!drag });

    const bindCanvas = (c) => {
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const d = S.app.doc; if (!d) return;
      const r = c.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      if (e.ctrlKey || e.metaKey || e.altKey) {
        const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022));
        V.setZoom(d.view.zoom * f, sx, sy);
      } else {
        let dx = e.deltaX, dy = e.deltaY;
        if (e.deltaMode === 1) { dx *= 20; dy *= 20; }
        if (e.shiftKey && !dx) { dx = dy; dy = 0; }
        V.pan(-dx, -dy);
      }
    }, { passive: false });

    c.addEventListener('pointerdown', (e) => {
      const d = S.app.doc; if (!d) return;
      S.Menu.closeAll();
      if (document.activeElement && document.activeElement !== document.body && !document.activeElement.classList.contains('text-ime')) document.activeElement.blur();
      const info = evInfo(e);
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* synthetic / already-released pointer */ }
      const tool = S.app.tool;
      if (e.button === 1 || (V.spaceDown && !(tool && tool.keepSpace)) ) {
        drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: d.view.panX, py: d.view.panY };
        c.style.cursor = 'grabbing';
        return;
      }
      if (e.button === 2) return; // context menu handled separately
      if (S.app.pickHook) { S.app.pickHook(info, d); return; } // modeless dialogs sampling the canvas
      // Alt + right-drag resize is handled in contextmenu; guide dragging with move tool:
      const g = guideAt(d, info.sx, info.sy);
      if (g && tool && (tool.id === 'move' || e.ctrlKey)) {
        drag = { kind: 'guide' };
        V.guideDrag = { guide: g, dir: g.dir, pos: g.pos };
        return;
      }
      // stylus eraser end: temporarily switch to the Eraser for this stroke
      if (e.pointerType === 'pen' && (e.buttons & 32) && tool && tool.id !== 'eraser' && S.Tools.byId.eraser) {
        V._penEraserPrev = tool.id; S.Tools.select('eraser');
      }
      const activeTool = S.app.tool;
      if (activeTool && activeTool.onDown) {
        drag = { kind: 'tool' };
        try { activeTool.onDown(info, d); } catch (err) { console.error(err); S.toast('Tool error: ' + err.message); drag = null; }
        V.redraw();
      }
    });
    c.addEventListener('pointermove', (e) => {
      const d = S.app.doc;
      const info = evInfo(e);
      V.mouse.sx = info.sx; V.mouse.sy = info.sy; V.mouse.x = info.x; V.mouse.y = info.y; V.mouse.inside = true;
      if (!d) return;
      if (drag && drag.kind === 'pan') {
        d.view.panX = drag.px + (e.clientX - drag.sx); d.view.panY = drag.py + (e.clientY - drag.sy);
        V.viewChanged(); return;
      }
      if (drag && drag.kind === 'guide') {
        const [x, y] = V.snapPoint(info.x, info.y, { noSnap: e.shiftKey });
        V.guideDrag.pos = V.guideDrag.dir === 'v' ? Math.round(x) : Math.round(y);
        V.redraw(); return;
      }
      if (drag && drag.kind === 'tool') {
        const tool = S.app.tool;
        if (tool && tool.onMove) {
          const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
          try { for (const ce of (evs.length ? evs : [e])) tool.onMove(evInfo(ce), d, true); } catch (err) { console.error(err); }
        }
        V.redraw();
      } else {
        const tool = S.app.tool;
        if (tool && tool.onHover) tool.onHover(info, d);
        // cursor over guides
        const g = guideAt(d, info.sx, info.sy);
        if (g && tool && tool.id === 'move') c.style.cursor = g.dir === 'v' ? 'ew-resize' : 'ns-resize';
        else V.updateCursor();
        if (tool && tool.brushCursor || V.showRulers) V.redraw();
      }
      S.bus.emit('cursor:moved', info);
    });
    const up = (e) => {
      const d = S.app.doc;
      if (!drag) return;
      const k = drag.kind; drag = null;
      if (k === 'pan') { V.updateCursor(); return; }
      if (k === 'guide') {
        const gd = V.guideDrag; V.guideDrag = null;
        const info = evInfo(e);
        const outside = info.sx < 0 || info.sy < 0 || info.sx > V.w || info.sy > V.h;
        d.commit(outside ? 'Delete Guide' : 'Move Guide', () => {
          const idx = d.guides.indexOf(gd.guide);
          if (outside) { if (idx >= 0) d.guides.splice(idx, 1); }
          else if (idx >= 0) d.guides[idx] = { dir: gd.dir, pos: gd.pos };
        });
        V.redraw(); return;
      }
      const tool = S.app.tool;
      if (tool && tool.onUp) { try { tool.onUp(evInfo(e), d); } catch (err) { console.error(err); S.toast('Tool error: ' + err.message); } }
      if (V._penEraserPrev) { const prev = V._penEraserPrev; V._penEraserPrev = null; S.Tools.select(prev); }
      V.redraw();
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => { V.mouse.inside = false; V.redraw(); });
    c.addEventListener('pointerenter', () => { V.mouse.inside = true; });
    c.addEventListener('dblclick', (e) => { const t = S.app.tool, d = S.app.doc; if (d && t && t.onDblClick) t.onDblClick(evInfo(e), d); });

    // context menu & Alt+right-drag brush resize
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const d = S.app.doc; if (!d) return;
      const t = S.app.tool;
      if (e.altKey && t && t.brushCursor) return;
      const items = (t && t.contextMenu && t.contextMenu(evInfo(e), d)) || S.App.canvasContextMenu();
      S.Menu.context(items, e);
    });
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 2 || !e.altKey) return;
      const t = S.app.tool; if (!t || !t.brushCursor || !t.opts) return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY, size0 = t.opts.size, hard0 = t.opts.hardness;
      const mv = (ev) => {
        t.opts.size = U.clamp(Math.round(size0 + (ev.clientX - sx) / (S.app.doc.view.zoom || 1) * 2), 1, 2500);
        if (hard0 != null) t.opts.hardness = U.clamp(hard0 - (ev.clientY - sy) / 200, 0, 1);
        S.bus.emit('tool:options', t); V.redraw();
      };
      const upx = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', upx); };
      addEventListener('pointermove', mv); addEventListener('pointerup', upx);
    });
    };
    bindCanvas(V.canvas);
    V._bindCanvas = bindCanvas;

    // rulers → guides
    for (const [rc, dir] of [[V.rulerH, 'h'], [V.rulerV, 'v']]) {
      rc.addEventListener('pointerdown', (e) => {
        const d = S.app.doc; if (!d) return;
        e.preventDefault();
        V.guideDrag = { guide: null, dir, pos: 0 };
        const mv = (ev) => {
          const r = V.canvas.getBoundingClientRect();
          const [x, y] = V.toDoc(ev.clientX - r.left, ev.clientY - r.top);
          const [snx, sny] = V.snapPoint(x, y, { noSnap: ev.shiftKey });
          V.guideDrag.pos = Math.round(dir === 'v' ? snx : sny);
          V.redraw();
        };
        const upx = (ev) => {
          removeEventListener('pointermove', mv); removeEventListener('pointerup', upx);
          const r = V.canvas.getBoundingClientRect();
          const inside = ev.clientX >= r.left && ev.clientY >= r.top && ev.clientX <= r.right && ev.clientY <= r.bottom;
          const g = V.guideDrag; V.guideDrag = null;
          if (inside) { d.commit('New Guide', () => { d.guides.push({ dir: g.dir, pos: g.pos }); }); V.showGuides = true; }
          V.redraw();
        };
        addEventListener('pointermove', mv); addEventListener('pointerup', upx);
      });
    }
    V.corner.addEventListener('dblclick', () => { const d = S.app.doc; if (d) { d.commit('Clear Guides', () => { d.guides = []; }); } });
  };

  V.updateCursor = function () {
    const t = S.app.tool;
    let cur = 'default';
    if (V.spaceDown) cur = 'grab';
    else if (t) {
      cur = typeof t.cursor === 'function' ? t.cursor() : t.cursor || 'default';
      if (t.brushCursor && S.app.prefs.cursor !== 'cross') cur = 'none';
      if (t.brushCursor && S.app.prefs.cursor === 'cross') cur = 'crosshair';
    }
    V.canvas.style.cursor = cur;
  };
})();
