/* =========================================================================
   Gesso — document operations (S.Ops).  Pure-ish helpers that mutate a
   document; callers wrap them in doc.commit(...) for undo.
   Rule: never mutate an existing canvas in place inside commit() — create
   new canvases (history snapshots share canvas references).
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util;
  const O = (S.Ops = {});

  /** Translate every parametric layer (text/shape/fill offsets), recursively */
  function shiftParametric(l, dx, dy) {
    if (l.type === 'text') { if (l.text.matrix) { l.text.matrix = l.text.matrix.slice(); l.text.matrix[4] += dx; l.text.matrix[5] += dy; } else { l.text.x += dx; l.text.y += dy; } }
    if (l.type === 'shape') S.Shape.translate(l.shape, dx, dy);
    if (l.type === 'fill' && (l.fill.ox || l.fill.oy)) { /* fills are canvas-relative: keep centred offsets */ }
    l.version++; l._rv = -1;
  }
  function scaleParametric(l, sx, sy) {
    if (l.type === 'text') {
      if (l.text.matrix) { const m = l.text.matrix; l.text.matrix = [m[0] * sx, m[1] * sy, m[2] * sx, m[3] * sy, m[4] * sx, m[5] * sy]; }
      else if (Math.abs(sx - sy) < 1e-6) { l.text.x *= sx; l.text.y *= sy; l.text.size *= sx; if (l.text.box) l.text.box = { w: l.text.box.w * sx, h: l.text.box.h * sy }; if (l.text.leading) l.text.leading *= sx; }
      else l.text.matrix = [sx, 0, 0, sy, 0, 0];
    }
    if (l.type === 'shape') {
      const s = l.shape;
      if (s.matrix) { S.Shape.setAffine(s, S.Affine.mul([sx, 0, 0, sy, 0, 0], s.matrix)); s.radius *= Math.sqrt(sx * sy); }
      else if (s.kind === 'line') { s.x1 *= sx; s.x2 *= sx; s.y1 *= sy; s.y2 *= sy; s.lineWidth *= Math.sqrt(sx * sy); }
      else if (s.kind === 'path') s.path = S.Paths.transform(s.path, (x, y) => [x * sx, y * sy]);
      else { s.x *= sx; s.y *= sy; s.w *= sx; s.h *= sy; s.radius *= Math.sqrt(sx * sy); }
      if (s.stroke) s.stroke.width *= Math.sqrt(sx * sy);
      if (s.repeat) { s.repeat.cx *= sx; s.repeat.cy *= sy; s.repeat.offset = (s.repeat.offset || 0) * Math.sqrt(sx * sy); }
    }
    l.version++; l._rv = -1;
  }

  /** Apply a canvas→canvas mapping to the selection and saved selection channels */
  function mapSelections(doc, fn, W, H) {
    const m = (sel) => (sel ? S.Sel.make(S.Sel.alphaOf(fn(S.Sel.canvas(sel))), W, H) : sel);
    doc.selection = m(doc.selection);
    doc.alphaChannels = (doc.alphaChannels || []).map((c) => ({ ...c, sel: m(c.sel) })).filter((c) => c.sel);
    doc.lastSelection = null;
  }

  /**
   * Resize the canvas (no resampling); content is offset by (ox, oy).  Layer pixels outside the new
   * canvas are kept (they just move with their offset) unless opts.clip is set (Crop ▸ Delete).
   * fill: colour for the extended area of doc._bgLayer (Canvas Size extension colour).
   */
  O.resizeCanvas = function (doc, W, H, ox, oy, fill, opts) {
    W = Math.max(1, Math.round(W)); H = Math.max(1, Math.round(H)); ox = Math.round(ox); oy = Math.round(oy);
    const clip = opts && opts.clip;
    doc.walk((l) => {
      if (l.canvas && l.type === 'raster') {
        let c;
        if (fill && l === doc._bgLayer) {
          c = U.createCanvas(W, H); const x = c.getContext('2d');
          x.fillStyle = fill; x.fillRect(0, 0, W, H); x.clearRect(ox, oy, doc.width, doc.height);
          x.drawImage(l.canvas, ox + (l.canvas.ox || 0), oy + (l.canvas.oy || 0));
        } else {
          c = U.cloneCanvas(l.canvas); c.ox = (l.canvas.ox || 0) + ox; c.oy = (l.canvas.oy || 0) + oy;
          if (clip) {
            const i = U.rectIntersect(U.rectOf(c), { x: 0, y: 0, w: W, h: H });
            if (!i) c = S.Layers.emptyCanvas();
            else { const t = U.createCanvas(i.w, i.h, i.x, i.y); t.getContext('2d').drawImage(c, i.x - c.ox, i.y - c.oy, i.w, i.h, 0, 0, i.w, i.h); c = t; }
          }
        }
        l.canvas = c; l.version++;
        if (l.embed) { l.embed.matrix = S.Affine.mul([1, 0, 0, 1, ox, oy], l.embed.matrix); l._ev = l.embed.version; }
      }
      if (l.mask) {
        // sparse mask: it simply moves with its offset (the area that comes into view takes the outside value)
        let c = U.cloneCanvas(l.mask.canvas); c.ox = (l.mask.canvas.ox || 0) + ox; c.oy = (l.mask.canvas.oy || 0) + oy;
        if (clip && !c._empty) {
          const i = U.rectIntersect(U.rectOf(c), { x: 0, y: 0, w: W, h: H });
          if (!i) { c = S.Layers.newMask(doc, S.Layers.maskOutside(l.mask)).canvas; }
          else { const t = U.createCanvas(i.w, i.h, i.x, i.y); t.getContext('2d').drawImage(c, i.x - c.ox, i.y - c.oy, i.w, i.h, 0, 0, i.w, i.h); c = t; }
        }
        l.mask = { ...l.mask, canvas: c, version: (l.mask.version || 0) + 1 };
      }
      if (l.type === 'text' || l.type === 'shape') shiftParametric(l, ox, oy);
      if (l.type === 'fill') { l.version++; l._rv = -1; }
    });
    mapSelections(doc, (src) => { const c = U.createCanvas(W, H); c.getContext('2d').drawImage(src, ox, oy); return c; }, W, H);
    doc.guides = doc.guides.map((g) => ({ dir: g.dir, pos: g.pos + (g.dir === 'v' ? ox : oy) }));
    doc.paths = doc.paths.map((p) => ({ ...p, path: S.Paths.translate(p.path, ox, oy) }));
    if (doc.quickMask) doc.quickMask = null;
    doc.width = W; doc.height = H;
    doc.composite = null;
  };
  /** Union of the document and every raster layer's content (Image ▸ Reveal All) */
  O.contentExtent = function (doc) {
    let b = { x: 0, y: 0, w: doc.width, h: doc.height };
    doc.walk((l) => { if (l.type === 'raster') { const cb = S.Layers.contentRect(l); if (cb) b = U.rectUnion(b, cb); } });
    return b;
  };

  /** Resample the whole image */
  O.resizeImage = function (doc, W, H, method) {
    W = Math.max(1, Math.round(W)); H = Math.max(1, Math.round(H));
    const sx = W / doc.width, sy = H / doc.height;
    const resample = (src) => O.resample(src, W, H, method);
    const scaleOffset = (c) => {
      const r = U.rectOf(c);
      const nx = Math.floor(r.x * sx), ny = Math.floor(r.y * sy), nw = Math.max(1, Math.ceil((r.x + r.w) * sx) - nx), nh = Math.max(1, Math.ceil((r.y + r.h) * sy) - ny);
      const out = O.resample(c, nw, nh, method); out.ox = nx; out.oy = ny;
      return out;
    };
    doc.walk((l) => {
      if (l.type === 'raster') { if (l.embed) { l.embed.matrix = S.Affine.mul([sx, 0, 0, sy, 0, 0], l.embed.matrix); S.Embed.bump(l); S.Embed.render(l, doc); } else { l.canvas = scaleOffset(l.canvas); } l.version++; }
      if (l.mask) { const mc = l.mask.canvas; l.mask = { ...l.mask, canvas: mc._empty ? U.cloneCanvas(mc) : scaleOffset(mc), version: (l.mask.version || 0) + 1 }; }
      if (l.type === 'text' || l.type === 'shape') scaleParametric(l, sx, sy);
      if (l.type === 'fill') { l.version++; l._rv = -1; }
      if (l.effects) {
        const k = Math.sqrt(sx * sy);
        for (const key in l.effects.items) { const e = l.effects.items[key]; for (const f of ['distance', 'size']) if (e[f] != null) e[f] = Math.round(e[f] * k); }
      }
    });
    mapSelections(doc, resample, W, H);
    doc.guides = doc.guides.map((g) => ({ dir: g.dir, pos: Math.round(g.pos * (g.dir === 'v' ? sx : sy)) }));
    doc.paths = doc.paths.map((p) => ({ ...p, path: S.Paths.transform(p.path, (x, y) => [x * sx, y * sy]) }));
    doc.width = W; doc.height = H; doc.composite = null;
  };

  /** High-quality resample: progressive halving for downscales (avoids aliasing) */
  O.resample = function (src, W, H, method) {
    const out = U.createCanvas(W, H), x = out.getContext('2d');
    if (method === 'nearest') { x.imageSmoothingEnabled = false; x.drawImage(src, 0, 0, W, H); return out; }
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = method === 'bilinear' ? 'medium' : 'high';
    let cur = src, cw = src.width, ch = src.height;
    if (method !== 'bilinear') {
      while (cw / 2 > W && ch / 2 > H) {
        const nw = Math.max(W, Math.round(cw / 2)), nh = Math.max(H, Math.round(ch / 2));
        const t = U.createCanvas(nw, nh), tx = t.getContext('2d');
        tx.imageSmoothingQuality = 'high'; tx.drawImage(cur, 0, 0, nw, nh);
        cur = t; cw = nw; ch = nh;
      }
    }
    x.drawImage(cur, 0, 0, W, H);
    return out;
  };

  /** Map a shape through a whole-canvas affine, keeping it parametric (matrix + repeat centre) */
  function mapShape(sh, A) {
    if (sh.repeat) { [sh.repeat.cx, sh.repeat.cy] = S.Geom.apply(A, sh.repeat.cx || 0, sh.repeat.cy || 0); }
    S.Shape.setAffine(sh, S.Affine.mul(A, sh.matrix || [1, 0, 0, 1, 0, 0]));
  }

  /** Draw an offset canvas through an affine map into a new canvas covering the mapped bounds (content outside the document is kept) */
  O.mapCanvas = function (src, m, doc) {
    const r = U.rectOf(src);
    const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map((p) => S.Geom.apply(m, p[0], p[1]));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    let b = U.rectRound({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
    b = b && U.rectIntersect(b, S.Layers.limitRect(doc));
    if (!b) return U.createCanvas(1, 1);
    const c = U.createCanvas(b.w, b.h, b.x, b.y), x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.translate(-b.x, -b.y); x.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    x.drawImage(src, r.x, r.y);
    x.setTransform(1, 0, 0, 1, 0, 0); // never leave a transform on a canvas that becomes layer pixels
    return c;
  };

  /**
   * Map a sparse mask through a whole-canvas affine.  The mask is materialised over everything the new
   * document can see (plus its own canvas) before mapping, so the result is exact inside the new document and
   * the implicit outside value is kept beyond it.
   */
  O.mapMask = function (m, A, doc, W, H) {
    const mc = m.canvas;
    if (mc._empty) return { ...m, canvas: U.cloneCanvas(mc), version: (m.version || 0) + 1 };
    const inv = S.Geom.invert(A);
    const pts = [[0, 0], [W, 0], [W, H], [0, H]].map((p) => S.Geom.apply(inv, p[0], p[1]));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    let R = U.rectRound({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
    R = U.rectUnion(U.rectUnion(R, U.rectOf(mc)), { x: 0, y: 0, w: doc.width, h: doc.height });
    R = U.rectIntersect(R, S.Layers.limitRect(doc)) || U.rectOf(mc);
    const full = S.Layers.maskOver(m, R);
    const out = { ...m, canvas: O.mapCanvas(full, A, doc), version: (m.version || 0) + 1 };
    S.Layers.trimMask(out);
    return out;
  };
  /** Rotate the whole canvas by deg (90 multiples are lossless) */
  O.rotateCanvas = function (doc, deg) {
    deg = ((deg % 360) + 360) % 360;
    if (!deg) return;
    const rad = (deg * Math.PI) / 180;
    // exact values for quarter turns so pixels map 1:1 (cos(π) is -1, not -0.99999…) and nothing grows or blurs
    const cs = deg % 90 === 0 ? Math.round(Math.cos(rad)) : Math.cos(rad), sn = deg % 90 === 0 ? Math.round(Math.sin(rad)) : Math.sin(rad);
    const W0 = doc.width, H0 = doc.height;
    const W = Math.round(Math.abs(W0 * cs) + Math.abs(H0 * sn)), H = Math.round(Math.abs(W0 * sn) + Math.abs(H0 * cs));
    const mapM = [cs, sn, -sn, cs, W / 2 - (cs * W0) / 2 + (sn * H0) / 2, H / 2 - (sn * W0) / 2 - (cs * H0) / 2];
    const rot = (src) => {
      const c = U.createCanvas(W, H), x = c.getContext('2d');
      x.imageSmoothingQuality = 'high';
      x.setTransform(...mapM);
      x.drawImage(src, 0, 0);
      return c;
    };
    const mapPt = (px, py) => S.Geom.apply(mapM, px, py);
    doc.walk((l) => {
      if (l.type === 'raster') { if (l.embed) { l.embed.matrix = S.Affine.mul(mapM, l.embed.matrix); S.Embed.bump(l); } else l.canvas = O.mapCanvas(l.canvas, mapM, doc); l.version++; }
      if (l.mask) l.mask = O.mapMask(l.mask, mapM, doc, W, H);
      if (l.type === 'text') { l.text.matrix = S.Geom.mul(mapM, l.text.matrix || [1, 0, 0, 1, 0, 0]); l.version++; }
      if (l.type === 'shape') { mapShape(l.shape, mapM); l.version++; }
      if (l.type === 'fill') { if (l.fill.kind === 'gradient') l.fill.angle = (l.fill.angle || 0) - deg; l.version++; l._rv = -1; }
    });
    mapSelections(doc, rot, W, H);
    doc.paths = doc.paths.map((p) => ({ ...p, path: S.Paths.transform(p.path, mapPt) }));
    if (deg % 90 === 0) doc.guides = doc.guides.map((g) => { const [a, b] = mapPt(g.dir === 'v' ? g.pos : 0, g.dir === 'h' ? g.pos : 0); const vert = (g.dir === 'v') !== (deg % 180 !== 0); return { dir: vert ? 'v' : 'h', pos: Math.round(vert ? a : b) }; });
    else doc.guides = [];
    doc.width = W; doc.height = H; doc.composite = null;
  };
  O.flipCanvas = function (doc, axis) {
    const W = doc.width, H = doc.height;
    const m = axis === 'h' ? [-1, 0, 0, 1, W, 0] : [1, 0, 0, -1, 0, H];
    const flip = (src) => { const c = U.createCanvas(W, H), x = c.getContext('2d'); x.setTransform(...m); x.drawImage(src, 0, 0); return c; };
    const mapPt = (px, py) => S.Geom.apply(m, px, py);
    doc.walk((l) => {
      if (l.type === 'raster') { if (l.embed) { l.embed.matrix = S.Affine.mul(m, l.embed.matrix); S.Embed.bump(l); } else l.canvas = O.mapCanvas(l.canvas, m, doc); l.version++; }
      if (l.mask) l.mask = O.mapMask(l.mask, m, doc, W, H);
      if (l.type === 'text') { l.text.matrix = S.Geom.mul(m, l.text.matrix || [1, 0, 0, 1, 0, 0]); l.version++; }
      if (l.type === 'shape') { mapShape(l.shape, m); l.version++; }
    });
    mapSelections(doc, flip, W, H);
    doc.paths = doc.paths.map((p) => ({ ...p, path: S.Paths.transform(p.path, mapPt) }));
    doc.guides = doc.guides.map((g) => (axis === 'h' && g.dir === 'v' ? { dir: 'v', pos: W - g.pos } : axis === 'v' && g.dir === 'h' ? { dir: 'h', pos: H - g.pos } : g));
  };

  /* ---------------- layers ---------------- */
  O.rasterize = function (doc, l) {
    if (l.type === 'raster') { if (l.embed) { S.Layers.ensure(l, doc); S.Embed.rasterize(l); } return l; }
    if (l.type === 'group' || l.type === 'adjustment') return null;
    const r = S.Layers.raster(doc, l.name, S.Layers.materialize(l, doc));
    Object.assign(r, { id: l.id, visible: l.visible, opacity: l.opacity, fillOpacity: l.fillOpacity, blend: l.blend, clip: l.clip, locks: { ...l.locks }, mask: l.mask, effects: l.effects });
    const info = doc.parentInfo(l.id);
    info.list[info.index] = r;
    return r;
  };
  /** Merge a list of layers (bottom→top order, same parent) into one raster layer */
  O.mergeLayers = function (doc, layers, name) {
    if (!layers.length) return null;
    const info = doc.parentInfo(layers[layers.length - 1].id);
    const c = S.Layers.trim(S.Compositor.flatten(doc, layers));
    const r = S.Layers.raster(doc, name || layers[layers.length - 1].name, c);
    // insert where the topmost was, remove others
    const topIdx = info.list.indexOf(layers[layers.length - 1]);
    info.list.splice(topIdx + 1, 0, r);
    for (const l of layers) doc.removeLayer(l.id);
    doc.activeId = r.id; doc.selectedIds = new Set([r.id]);
    return r;
  };
  O.mergeDown = function (doc) {
    const l = doc.activeLayer(); if (!l) return false;
    const info = doc.parentInfo(l.id);
    if (info.index === 0) { S.toast('No layer below to merge into'); return false; }
    const below = info.list[info.index - 1];
    if (!below.visible || !l.visible) { S.toast('Both layers must be visible'); return false; }
    // keep the lower layer's name and blend: render lower alone, then upper over it
    const merged = O.mergeLayers(doc, [below, l], below.name);
    merged.opacity = 1;
    return merged;
  };
  O.mergeVisible = function (doc) {
    const vis = doc.layers.filter((l) => l.visible);
    if (vis.length < 2) return false;
    return O.mergeLayers(doc, vis, 'Merged');
  };
  O.flatten = function (doc) {
    const c = U.createCanvas(doc.width, doc.height), x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, doc.width, doc.height);
    x.drawImage(S.Compositor.flatten(doc), 0, 0);
    const r = S.Layers.raster(doc, 'Background', c);
    doc.layers = [r]; doc.activeId = r.id; doc.selectedIds = new Set([r.id]);
    return r;
  };
  O.group = function (doc, layers) {
    if (!layers.length) return null;
    const top = layers[layers.length - 1];
    const info = doc.parentInfo(top.id);
    const g = S.Layers.group(doc, 'Group ' + (doc.allLayers().filter((l) => l.type === 'group').length + 1));
    info.list.splice(info.index + 1, 0, g);
    for (const l of layers) { doc.removeLayer(l.id); g.children.push(l); }
    doc.activeId = g.id; doc.selectedIds = new Set([g.id]);
    return g;
  };
  O.ungroup = function (doc, g) {
    if (!g || g.type !== 'group') return false;
    const info = doc.parentInfo(g.id);
    info.list.splice(info.index, 1, ...g.children);
    doc.activeId = g.children.length ? g.children[g.children.length - 1].id : null;
    doc.selectedIds = new Set(g.children.map((c) => c.id));
    return true;
  };
  /** Move layer within its parent list: dir = +1 up, -1 down, 'top', 'bottom' */
  O.arrange = function (doc, l, dir) {
    const info = doc.parentInfo(l.id); if (!info) return;
    const list = info.list; list.splice(info.index, 1);
    let i = info.index;
    if (dir === 'top') i = list.length; else if (dir === 'bottom') i = 0; else i = U.clamp(i + dir, 0, list.length);
    list.splice(i, 0, l);
  };

  /* ---------------- selection helpers ---------------- */
  O.layerAlphaSelection = function (doc, l) {
    if (l.type === 'group') return null;
    if (l.type === 'adjustment') return l.mask ? S.Sel.make(S.Sel.alphaOf(S.Layers.maskDocCanvas(l.mask, doc)), doc.width, doc.height) : null;
    const D = { x: 0, y: 0, w: doc.width, h: doc.height };
    const st = S.Compositor.styled(l, doc, D);
    S.Layers.ensure(l, doc);
    const src = l.mask && l.mask.enabled !== false || l.type === 'fill' ? st.canvas : l.canvas;
    const m = S.Sel.alphaOf(S.Layers.docCanvas(src, doc));
    if (st.temp) U.release(st.canvas);
    return S.Sel.make(m, doc.width, doc.height);
  };

  /** Pixels of the active layer within the selection (or whole layer) → {canvas (cropped), x, y} */
  O.copyPixels = function (doc, merged) {
    let src;
    if (merged) src = S.Compositor.flatten(doc);
    else {
      const l = doc.activeLayer();
      if (!l || !S.Layers.hasCanvas(l)) return null;
      if (l.editMask && l.mask) src = S.Layers.maskDocCanvas(l.mask, doc);
      else src = l.type === 'fill' ? S.Layers.materialize(l, doc) : (S.Layers.ensure(l, doc), l.canvas);
    }
    let b;
    if (doc.selection) b = doc.selection.bounds;
    else { const cb = S.Layers.contentBounds(src); b = cb ? { x: cb.x + (src.ox || 0), y: cb.y + (src.oy || 0), w: cb.w, h: cb.h } : { x: 0, y: 0, w: doc.width, h: doc.height }; }
    const c = U.createCanvas(b.w, b.h), x = c.getContext('2d');
    x.drawImage(src, (src.ox || 0) - b.x, (src.oy || 0) - b.y);
    if (doc.selection) { x.globalCompositeOperation = 'destination-in'; x.drawImage(S.Sel.canvas(doc.selection), -b.x, -b.y); }
    return { canvas: c, x: b.x, y: b.y };
  };
  /** Clear selected pixels of the paint target (Delete key) */
  O.clearSelection = function (doc) {
    const t = doc.paintTarget();
    if (!t || t.kind === 'invalid') { S.toast('Select a pixel layer'); return; }
    if (t.layer && (t.layer.locks.all || t.layer.locks.pixels)) { S.toast('Layer is locked'); return; }
    const edit = doc.beginPixelEdit(t);
    const x = t.canvas.getContext('2d');
    x.save();
    if (t.kind === 'pixels' && !t.layer.locks.alpha) {
      x.globalCompositeOperation = 'destination-out';
      if (doc.selection) x.drawImage(S.Sel.canvas(doc.selection), -(t.canvas.ox || 0), -(t.canvas.oy || 0)); else x.fillRect(0, 0, t.canvas.width, t.canvas.height);
    } else {
      // masks: fill with background luminance;  locked-alpha: fill with background color
      const src = U.createCanvas(doc.width, doc.height), sx = src.getContext('2d');
      sx.fillStyle = S.app.bg; sx.fillRect(0, 0, doc.width, doc.height);
      if (doc.selection) { sx.globalCompositeOperation = 'destination-in'; sx.drawImage(S.Sel.canvas(doc.selection), 0, 0); }
      x.restore();
      edit.end && 0;
      S.paintCanvasOnto(doc, t, src, 1, 'normal', 'Clear');
      return;
    }
    x.restore();
    edit.end('Clear', doc.selection ? doc.selection.bounds : null);
    if (t.layer) doc.bump(t.layer); else doc.invalidate();
    S.bus.emit('layers:changed', doc);
  };

  /** Selection → work path, by tracing the mask outline (marching squares + simplification) */
  O.selectionToPath = function (sel, tolerance = 1.5) {
    const { w, h, mask } = sel;
    const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] >= 128;
    const visited = new Set();
    const subpaths = [];
    const b = sel.bounds;
    // trace boundaries of the pixel grid (edges between inside/outside), following edge loops
    const edgeKey = (x, y, d) => x + ',' + y + ',' + d;
    const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // R D L U along grid corners
    const isEdge = (x, y, d) => {
      // edge starting at corner (x,y) going in direction d, with inside pixel on the right-hand side
      if (d === 0) return inside(x, y) && !inside(x, y - 1);
      if (d === 1) return inside(x - 1, y) && !inside(x, y);
      if (d === 2) return inside(x - 1, y - 1) && !inside(x - 1, y);
      return inside(x, y - 1) && !inside(x - 1, y - 1);
    };
    for (let y = b.y; y <= b.y + b.h; y++) for (let x = b.x; x <= b.x + b.w; x++) {
      if (!isEdge(x, y, 0) || visited.has(edgeKey(x, y, 0))) continue;
      const pts = [];
      let cx = x, cy = y, d = 0, guard = 0;
      do {
        visited.add(edgeKey(cx, cy, d));
        pts.push([cx, cy]);
        cx += dirs[d][0]; cy += dirs[d][1];
        // prefer turning right, then straight, then left
        const order = [(d + 3) % 4, d, (d + 1) % 4];
        let nd = -1;
        for (const o of order) if (isEdge(cx, cy, o)) { nd = o; break; }
        if (nd < 0) break;
        d = nd;
      } while ((cx !== x || cy !== y || d !== 0) && ++guard < 4000000);
      if (pts.length < 3) continue;
      const simp = O.simplify(pts, tolerance);
      if (simp.length >= 3) subpaths.push({ closed: true, nodes: simp.map((p) => S.Paths.node(p[0], p[1])) });
    }
    return { subpaths };
  };
  O.simplify = function (pts, eps) {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, z] = stack.pop();
      let md = 0, mi = -1;
      const [x1, y1] = pts[a], [x2, y2] = pts[z], L = Math.hypot(x2 - x1, y2 - y1) || 1;
      for (let i = a + 1; i < z; i++) { const d = Math.abs((x2 - x1) * (y1 - pts[i][1]) - (x1 - pts[i][0]) * (y2 - y1)) / L; if (d > md) { md = d; mi = i; } }
      if (md > eps && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, z]); }
    }
    return pts.filter((_, i) => keep[i]);
  };
})();
