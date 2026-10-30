/* =========================================================================
   Gesso — compositor.  Renders the layer tree into doc.composite.
   Only the dirty rectangle is recomposited (doc.invalidate(rect)), which keeps
   brush strokes fast.  Handles: blend modes, opacity, fill opacity, masks
   (sparse, density + feather), clipping groups, groups (pass-through or isolated),
   adjustment layers (ImageFX), Layer Effects (cached per layer), Dissolve.

   Painting cache: while one layer is being edited, the layers below it and the layers above it are kept
   as two composited canvases (doc._below / doc._above) so a dirty-rectangle update only has to render the
   edited layer itself (see C.update).  The caches are keyed by a signature of the other layers and drop
   automatically when any of them changes.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util;

  const C = (S.Compositor = { stats: { lastMs: 0, lastRect: null, cached: false, composites: 0 } });

  /* ---------------- masks ---------------- */
  /**
   * Processed mask (density + feather applied) over document rect r, as a pooled scratch canvas of r.w×r.h
   * whose pixel (0,0) is document point (r.x, r.y).  Release it with U.release.
   */
  C.maskRect = function (l, r, doc) {
    const m = l.mask, out = U.scratch(r.w, r.h);
    const d = m.density ?? 1, f = m.feather > 0 ? m.feather : 0;
    if (d >= 1 && !f) { S.Layers.maskOver(m, r, out); out.ox = 0; out.oy = 0; return out; }
    // density / feather: processed once per mask version over the document (plus the canvas rect), cached
    const key = (m.version || 0) + ':' + l.version + ':' + d + ':' + f + ':' + doc.width + 'x' + doc.height;
    if (!m._proc || m._procKey !== key) {
      const margin = Math.ceil(f * 3) + 2;
      let R = U.rectUnion({ x: 0, y: 0, w: doc.width, h: doc.height }, U.rectOf(m.canvas));
      R = { x: R.x - margin, y: R.y - margin, w: R.w + 2 * margin, h: R.h + 2 * margin };
      const raw = S.Layers.maskOver(m, R);
      const c = U.createCanvas(R.w, R.h, R.x, R.y), x = c.getContext('2d');
      if (d < 1) { x.fillStyle = 'rgba(0,0,0,' + (1 - d) + ')'; x.fillRect(0, 0, R.w, R.h); x.globalCompositeOperation = 'lighter'; x.globalAlpha = d; }
      if (f) x.filter = 'blur(' + f + 'px)';
      x.drawImage(raw, 0, 0);
      m._proc = c; m._procKey = key;
    }
    const x = out.getContext('2d'), o = S.Layers.maskOutside(m) * d + (1 - d) * 255;
    x.fillStyle = 'rgba(0,0,0,' + o / 255 + ')'; x.fillRect(0, 0, r.w, r.h);
    const i = U.rectIntersect(r, U.rectOf(m._proc));
    if (i) { x.clearRect(i.x - r.x, i.y - r.y, i.w, i.h); U.blitRect(x, m._proc, i, i.x - r.x, i.y - r.y); }
    out.ox = 0; out.oy = 0;
    return out;
  };
  /** Legacy helper: document-sized processed mask (allocates; used by a few whole-document code paths) */
  C.maskCanvas = function (l, w, h) {
    const t = C.maskRect(l, { x: 0, y: 0, w, h }, { width: w, height: h });
    const c = U.cloneCanvas(t); c.ox = 0; c.oy = 0; U.release(t);
    return c;
  };
  /** Multiply the alpha of an (offset) content canvas by the layer's mask, in place */
  C.applyMask = function (content, l, doc) {
    const cr = U.rectOf(content), mk = C.maskRect(l, cr, doc), x = content.getContext('2d');
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'destination-in'; x.drawImage(mk, 0, 0); x.restore();
    U.release(mk);
  };

  /** Deterministic per-pixel hash for Dissolve */
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

  /** drawImage the document rect r of an (offset) canvas onto ctx at the same document position */
  C.drawRect = function (ctx, src, r) { U.blitRect(ctx, src, r); };

  /** Paint a fill layer's content over document rect r */
  C.paintFill = function (ctx, l, doc, r) { S.Layers.renderFill(ctx, l.fill, doc.width, doc.height, r); };

  /**
   * Return a canvas holding the layer's final look (content · mask · fill opacity · effects),
   * excluding layer opacity and blend mode.  {canvas, temp} — temp canvases must be released.
   */
  C.styled = function (l, doc, r) {
    const w = doc.width, h = doc.height;
    S.Layers.ensure(l, doc);
    const hasMask = l.mask && l.mask.enabled !== false;
    const hasFx = S.Effects.active(l);
    const fill = l.fillOpacity ?? 1;
    const procedural = l.type === 'fill';
    if (!hasMask && !hasFx && fill >= 1 && !procedural) return { canvas: l.canvas, temp: false };
    if (hasFx) {
      const key = l.version + '|' + (hasMask ? (l.mask.version || 0) + ':' + l.mask.density + ':' + l.mask.feather + ':' + l.mask.canvas.width + 'x' + l.mask.canvas.height : '-') + '|' + fill + '|' + S.Effects.signature(l) + '|' + w + 'x' + h + '|' + l.canvas.width + 'x' + l.canvas.height + '@' + (l.canvas.ox || 0) + ',' + (l.canvas.oy || 0);
      if (l._fxCache && l._fxCache.key === key) return { canvas: l._fxCache.canvas, temp: false };
      let content;
      if (procedural) { content = U.createCanvas(w, h); C.paintFill(content.getContext('2d'), l, doc, { x: 0, y: 0, w, h }); }
      else content = hasMask ? U.cloneCanvas(l.canvas) : l.canvas;
      if (hasMask) C.applyMask(content, l, doc);
      const out = S.Effects.compose(content, l, doc);
      l._fxCache = { key, canvas: out };
      return { canvas: out, temp: false };
    }
    const t = U.scratch(w, h, r), x = t.getContext('2d');
    x.save(); x.beginPath(); x.rect(r.x, r.y, r.w, r.h); x.clip();
    x.globalAlpha = fill;
    if (procedural) C.paintFill(x, l, doc, r); else U.drawAt(x, l.canvas);
    x.globalAlpha = 1;
    if (hasMask) { const mk = C.maskRect(l, r, doc); x.globalCompositeOperation = 'destination-in'; x.drawImage(mk, r.x, r.y); U.release(mk); }
    x.restore();
    return { canvas: t, temp: true };
  };

  /** Draw a canvas onto ctx with a layer's opacity + blend (handles Dissolve) */
  /** Blend If: per-pixel coverage from this layer's / the underlying pixels' channel values (split sliders) */
  C.blendIfActive = (bi) => !!(bi && bi.on && !(isFull(bi.t) && isFull(bi.u)));
  const isFull = (v) => !v || (v[0] <= 0 && v[1] <= 0 && v[2] >= 255 && v[3] >= 255);
  const ramp = (v, s) => (v < s[0] ? 0 : v < s[1] ? (v - s[0]) / Math.max(1, s[1] - s[0]) : v <= s[2] ? 1 : v < s[3] ? (s[3] - v) / Math.max(1, s[3] - s[2]) : 0);
  const chanOf = (d, k, ch) => (ch === 'r' ? d[k] : ch === 'g' ? d[k + 1] : ch === 'b' ? d[k + 2] : 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2]);
  C.applyBlendIf = function (ctx, src, i, bi) {
    const s = S.Layers.readRect(src, i), d = s.data;
    let u = null; try { u = ctx.getImageData(i.x, i.y, i.w, i.h).data; } catch (e) { u = null; }
    const ch = bi.channel || 'gray', tt = bi.t || [0, 0, 255, 255], uu = bi.u || [0, 0, 255, 255], useT = !isFull(tt), useU = !isFull(uu) && u;
    for (let k = 0; k < d.length; k += 4) {
      if (!d[k + 3]) continue;
      let f = 1;
      if (useT) f *= ramp(chanOf(d, k, ch), tt);
      if (useU && f) { const ua = u[k + 3]; f *= ua ? ramp(chanOf(u, k, ch), uu) : ramp(0, uu); }
      if (f < 1) d[k + 3] = Math.round(d[k + 3] * f);
    }
    const t = U.createCanvas(i.w, i.h, i.x, i.y); t.getContext('2d').putImageData(s, 0, 0);
    return t;
  };
  C.blit = function (ctx, src, l, r, opacityOverride) {
    const op = opacityOverride != null ? opacityOverride : l.opacity;
    const i = U.rectIntersect(r, U.rectOf(src));
    if (!i) return;
    if (C.blendIfActive(l.blendIf)) src = C.applyBlendIf(ctx, src, i, l.blendIf);
    if (l.blend === 'dissolve') {
      const t = U.scratch(i.w, i.h), x = t.getContext('2d');
      const img = S.Layers.readRect(src, i), d = img.data;
      for (let y = 0; y < i.h; y++) for (let xx = 0; xx < i.w; xx++) {
        const k = (y * i.w + xx) * 4;
        d[k + 3] = hash(xx + i.x, y + i.y) < (d[k + 3] / 255) * op ? 255 : 0;
      }
      x.putImageData(img, 0, 0);
      ctx.drawImage(t, 0, 0, i.w, i.h, i.x, i.y, i.w, i.h);
      U.release(t);
      return;
    }
    ctx.globalAlpha = op;
    ctx.globalCompositeOperation = S.blendOp(l.blend);
    C.drawRect(ctx, src, i);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };

  /** Apply an adjustment layer to the pixels already in ctx (within r). clipAlpha: optional canvas */
  C.applyAdjustment = function (l, ctx, r, doc, clipAlpha, noPad) {
    const fx = window.ImageFX && ImageFX.adjustments && ImageFX.adjustments[l.adj.id];
    if (!fx || l.opacity <= 0) return;
    // neighbourhood adjustments (e.g. Shadows/Highlights with a radius) must see pixels around the dirty rect,
    // otherwise partial updates leave seams: process a padded rect and keep only r
    let pad = 0;
    for (const p of fx.params || []) if (p.unit === 'px' && typeof l.adj.params[p.id] === 'number') pad = Math.max(pad, Math.ceil(l.adj.params[p.id] * 3) + 2);
    if (pad && !noPad) {
      const R = U.rectInt({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad }, doc.width, doc.height);
      if (R && (R.w > r.w || R.h > r.h)) {
        const big = U.scratch(doc.width, doc.height, R), bx = big.getContext('2d');
        bx.drawImage(ctx.canvas, R.x, R.y, R.w, R.h, R.x, R.y, R.w, R.h);
        C.applyAdjustment(l, bx, R, doc, clipAlpha, true);
        ctx.drawImage(big, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
        U.release(big);
        return;
      }
    }
    const img = ctx.getImageData(r.x, r.y, r.w, r.h);
    const orig = new Uint8ClampedArray(img.data);
    let res;
    try { res = fx.apply(img, l.adj.params, {}); } catch (e) { console.warn('Adjustment failed', e); return; }
    if (!res) res = img;
    const out = res.data, n = r.w * r.h;
    // weight = opacity × mask × clip alpha
    let mk = null, ck = null;
    if (l.mask && l.mask.enabled !== false) {
      const m = l.mask, d = m.density ?? 1;
      // a plain (unpainted) mask is a constant: no readback needed
      if (m.canvas._empty && !(m.feather > 0)) { const v = S.Layers.maskOutside(m) * d + (1 - d) * 255; if (v < 255) { mk = new Uint8ClampedArray(n * 4); for (let j = 3; j < mk.length; j += 4) mk[j] = v; } }
      else { const mc = C.maskRect(l, r, doc); mk = mc.getContext('2d').getImageData(0, 0, r.w, r.h).data; U.release(mc); }
    }
    if (clipAlpha) ck = clipAlpha.getContext('2d').getImageData(r.x, r.y, r.w, r.h).data;
    const op = l.opacity;
    const dst = img.data === out ? out : img.data;
    for (let i = 0, j = 3; i < n; i++, j += 4) {
      let k = op;
      if (mk) k *= mk[j] / 255;
      if (ck) k *= ck[j] / 255;
      const a = orig[j];
      if (k >= 1) { dst[j - 3] = out[j - 3]; dst[j - 2] = out[j - 2]; dst[j - 1] = out[j - 1]; }
      else { dst[j - 3] = orig[j - 3] + (out[j - 3] - orig[j - 3]) * k; dst[j - 2] = orig[j - 2] + (out[j - 2] - orig[j - 2]) * k; dst[j - 1] = orig[j - 1] + (out[j - 1] - orig[j - 1]) * k; }
      dst[j] = a; // adjustments never change coverage
    }
    ctx.putImageData(img.data === out ? res : img, r.x, r.y);
  };

  /** Render one (non-clipped) layer, including its clipping stack, onto ctx */
  C.renderLayer = function (l, ctx, r, doc, clipped) {
    const w = doc.width, h = doc.height;
    if (l.type === 'adjustment') { C.applyAdjustment(l, ctx, r, doc, null); return; }
    if (l.type === 'group') {
      const simple = l.blend === 'pass-through' && l.opacity >= 1 && !(l.mask && l.mask.enabled !== false) && !S.Effects.active(l) && !clipped.length;
      if (simple) { C.renderStack(l.children, ctx, r, doc); return; }
      const t = U.scratch(w, h, r), tx = t.getContext('2d');
      tx.save(); tx.beginPath(); tx.rect(r.x, r.y, r.w, r.h); tx.clip();
      C.renderStack(l.children, tx, r, doc);
      tx.restore();
      // treat the group result as content of a virtual layer
      const v = Object.assign({}, l, { type: 'raster', canvas: t, blend: l.blend === 'pass-through' ? 'normal' : l.blend, version: Math.random() });
      if (S.Effects.active(l)) v._fxCache = null;
      C.renderLayer(v, ctx, r, doc, clipped);
      U.release(t);
      return;
    }
    const st = C.styled(l, doc, r);
    if (!clipped.length) {
      C.blit(ctx, st.canvas, l, r);
    } else {
      // clipping group: base + clipped layers on an isolated canvas, then blit with base opacity/blend
      const base = U.scratch(w, h, r), bx = base.getContext('2d');
      C.drawRect(bx, st.canvas, r);
      const alpha = U.scratch(w, h, r), ax = alpha.getContext('2d');
      ax.drawImage(base, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
      for (const c of clipped) {
        if (!c.visible) continue;
        if (c.type === 'adjustment') { C.applyAdjustment(c, bx, r, doc, alpha); continue; }
        const t2 = U.scratch(w, h, r), t2x = t2.getContext('2d');
        t2x.save(); t2x.beginPath(); t2x.rect(r.x, r.y, r.w, r.h); t2x.clip();
        C.renderLayer(c, t2x, r, doc, []);
        t2x.globalCompositeOperation = 'destination-in';
        t2x.drawImage(alpha, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
        t2x.restore();
        // blend mode against the base, keep base coverage
        bx.save();
        bx.globalCompositeOperation = c.blend === 'normal' || c.blend === 'dissolve' ? 'source-atop' : S.blendOp(c.blend);
        bx.drawImage(t2, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
        bx.restore();
        U.release(t2);
      }
      C.blit(ctx, base, l, r);
      U.release(base); U.release(alpha);
    }
    if (st.temp) U.release(st.canvas);
  };

  /** Split a layer list into render units: [{base, clipped:[...]}] */
  function units(layers) {
    const out = [];
    let i = 0;
    while (i < layers.length) {
      const l = layers[i], clipped = [];
      let j = i + 1;
      if (l.type !== 'adjustment') while (j < layers.length && layers[j].clip) { clipped.push(layers[j]); j++; }
      out.push({ base: l, clipped });
      i = j;
    }
    return out;
  }

  /** Render an array of layers (bottom → top) onto ctx within rect r */
  C.renderStack = function (layers, ctx, r, doc) {
    for (const u of units(layers)) if (u.base.visible) C.renderLayer(u.base, ctx, r, doc, u.clipped);
  };

  /* ---------------- painting cache (layers below / above the edited one) ---------------- */
  /** signature of everything that affects how a subtree renders */
  function sig(l) {
    let s = l.id + ':' + l.version + ':' + (l.visible ? 1 : 0) + ':' + l.opacity + ':' + l.blend + ':' + (l.clip ? 1 : 0);
    if (l.mask) s += ':m' + (l.mask.version || 0) + (l.mask.enabled === false ? 'x' : '');
    if (l.children) { s += '['; for (const c of l.children) s += sig(c) + ','; s += ']'; }
    return s;
  }
  /** can a stack be pre-rendered on its own and simply drawn over whatever is below? */
  function independent(layers) {
    for (const l of layers) {
      if (!l.visible) continue;
      if (l.type === 'adjustment') return false;
      if (l.blend && l.blend !== 'normal' && l.blend !== 'dissolve' && l.blend !== 'pass-through') return false;
      if (l.children && !independent(l.children)) return false;
    }
    return true;
  }
  C.dropCache = function (doc) { doc._below = doc._above = null; };
  /**
   * Try to composite dirty rect r using cached renders of the layers below and above the active top-level
   * render unit.  Returns false when the cache cannot be used (the caller renders everything).
   */
  function cachedRender(doc, ctx, r, full) {
    const layers = doc.layers;
    if (layers.length < 3 || !doc.activeId) return false;
    const us = units(layers);
    let k = -1;
    for (let i = 0; i < us.length; i++) { const u = us[i]; if (u.base.id === doc.activeId || u.clipped.some((c) => c.id === doc.activeId) || (u.base.children && doc.isDescendant(doc.activeId, u.base.id))) { k = i; break; } }
    if (k < 0) return false;
    const below = us.slice(0, k).map((u) => [u.base].concat(u.clipped)).flat(), above = us.slice(k + 1).map((u) => [u.base].concat(u.clipped)).flat();
    if (!independent(above) || (us[k].base.type === 'adjustment' && false)) return false;
    const sb = doc.width + 'x' + doc.height + '|' + below.map(sig).join(';'), sa = doc.width + 'x' + doc.height + '|' + above.map(sig).join(';');
    const w = doc.width, h = doc.height, D = { x: 0, y: 0, w, h };
    const stale = !doc._below || doc._below.sig !== sb || !doc._above || doc._above.sig !== sa;
    // the caches are (re)built only on a full composite — a stale cache during a partial update means we
    // render the usual way and build them on the next full pass (which the caller forces, see C.update)
    if (stale && !full) return false;
    if (stale) {
      const bc = doc._below && doc._below.canvas && doc._below.canvas.width === w && doc._below.canvas.height === h ? doc._below.canvas : U.createCanvas(w, h);
      const ac = doc._above && doc._above.canvas && doc._above.canvas.width === w && doc._above.canvas.height === h ? doc._above.canvas : U.createCanvas(w, h);
      const bx = bc.getContext('2d'), ax = ac.getContext('2d');
      bx.clearRect(0, 0, w, h); C.renderStack(below, bx, D, doc);
      ax.clearRect(0, 0, w, h); C.renderStack(above, ax, D, doc);
      doc._below = { sig: sb, canvas: bc }; doc._above = { sig: sa, canvas: ac };
    }
    ctx.drawImage(doc._below.canvas, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    const u = us[k];
    if (u.base.visible) C.renderLayer(u.base, ctx, r, doc, u.clipped);
    ctx.drawImage(doc._above.canvas, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    return true;
  }

  /** Recomposite the dirty region of a document into doc.composite */
  C.update = function (doc) {
    const w = doc.width, h = doc.height;
    if (!doc.composite || doc.composite.width !== w || doc.composite.height !== h) {
      doc.composite = U.createCanvas(w, h);
      doc._dirty = { x: 0, y: 0, w, h };
      C.dropCache(doc);
    }
    if (!doc._dirty) return false;
    const t0 = performance.now();
    const r = U.rectInt(doc._dirty, w, h);
    doc._dirty = null;
    if (!r) return false;
    const full = r.x === 0 && r.y === 0 && r.w === w && r.h === h;
    const ctx = doc.composite.getContext('2d');
    ctx.save();
    ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    ctx.clearRect(r.x, r.y, r.w, r.h);
    let cached = false;
    // large documents with many layers: use the below/above caches so painting only renders the edited layer
    if (doc.allLayersCount === undefined || doc._layerCountDirty) { doc.allLayersCount = doc.allLayers().length; doc._layerCountDirty = false; }
    const useCache = (S.app.prefs && S.app.prefs.paintCache !== false) && doc.allLayersCount >= 4 && w * h >= 250000;
    if (useCache) cached = cachedRender(doc, ctx, r, full);
    if (!cached) C.renderStack(doc.layers, ctx, r, doc);
    ctx.restore();
    // optional special views
    if (doc.maskView) C.drawMaskView(doc, ctx, r);
    else if (doc.channelView && doc.channelView !== 'rgb') C.drawChannelView(doc, ctx, r);
    doc.compositeVersion = (doc.compositeVersion || 0) + 1;
    const ms = performance.now() - t0;
    C.stats.lastMs = ms; C.stats.lastRect = r; C.stats.cached = cached; C.stats.composites++;
    doc._compositeMs = ms;
    // a partial update that could not use a stale cache: rebuild the caches when idle so the next strokes are fast
    if (useCache && !cached && !full && !doc._cacheTimer) {
      doc._cacheTimer = setTimeout(() => { doc._cacheTimer = null; if (S.app.docs.includes(doc)) { const c = U.createCanvas(1, 1).getContext('2d'); try { cachedRender(doc, c, { x: 0, y: 0, w: 1, h: 1 }, true); } catch (e) { /* ignore */ } } }, 120);
    }
    return true;
  };

  C.drawMaskView = function (doc, ctx, r) {
    const l = doc.findLayer(doc.maskView);
    if (!l || !l.mask) return;
    ctx.save();
    ctx.fillStyle = '#000'; ctx.fillRect(r.x, r.y, r.w, r.h);
    const mk = S.Layers.maskOver(l.mask, r), t = U.scratch(r.w, r.h), x = t.getContext('2d');
    x.drawImage(mk, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = '#fff'; x.fillRect(0, 0, r.w, r.h);
    ctx.drawImage(t, 0, 0, r.w, r.h, r.x, r.y, r.w, r.h);
    U.release(t);
    ctx.restore();
  };
  C.drawChannelView = function (doc, ctx, r) {
    const img = ctx.getImageData(r.x, r.y, r.w, r.h), d = img.data;
    const k = { r: 0, g: 1, b: 2, a: 3 }[doc.channelView];
    for (let i = 0; i < d.length; i += 4) { const v = d[i + k]; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    ctx.putImageData(img, r.x, r.y);
  };

  /** Full flatten of given layers (default: whole doc) into a new canvas */
  C.flatten = function (doc, layers) {
    const c = U.createCanvas(doc.width, doc.height), x = c.getContext('2d');
    C.renderStack(layers || doc.layers, x, { x: 0, y: 0, w: doc.width, h: doc.height }, doc);
    return c;
  };
  /** A single layer's rendered look with opacity & blend applied over transparency */
  C.renderSingle = function (l, doc) {
    const c = U.createCanvas(doc.width, doc.height), x = c.getContext('2d');
    const prevClip = l.clip; l.clip = false;
    C.renderLayer(l, x, { x: 0, y: 0, w: doc.width, h: doc.height }, doc, []);
    l.clip = prevClip;
    return c;
  };
})();
