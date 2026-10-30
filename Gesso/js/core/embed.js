/* =========================================================================
   Gesso — Embedded objects (non-destructive pixel layers).

   A raster layer with `layer.embed = { source, matrix, filters, version }` keeps its original pixels
   (`source`, an offset canvas in the object's own space) and an affine `matrix` that places them in the
   document.  Its visible `canvas` is re-rendered from the source whenever the matrix or the filter stack
   changes (Embed.render), so scaling it down and up again never degrades, and the filter stack
   (`filters`: [{ id, params, on }], see Filter Gallery / smart filters) can be edited at any time.
   Painting / destructive filters ask to rasterize first (Layer ▸ Rasterize Layer drops the embed data).
   "Edit Contents" opens the source in its own document; saving that document writes it back.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util, L = S.Layers;
  const E = (S.Embed = {});

  E.is = (l) => !!(l && l.type === 'raster' && l.embed);

  /** Turn a pixel layer into an embedded object (in place; the layer keeps its id) */
  E.convert = function (l, doc) {
    if (!l || l.type !== 'raster' || l.embed) return l;
    const src = L.trim(l.canvas);
    l.embed = { source: src, matrix: [1, 0, 0, 1, 0, 0], filters: [], version: 1, name: l.name };
    E.render(l, doc);
    l.version++;
    void doc;
    return l;
  };
  /** Drop the embed data (the rendered pixels stay) */
  E.rasterize = function (l) { if (l && l.embed) { l.embed = null; l.version++; } return l; };

  /** Document-space bounds of the mapped source */
  E.bounds = function (l) {
    const e = l.embed, r = U.rectOf(e.source), m = e.matrix;
    const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map((p) => S.Affine.apply(m, p[0], p[1]));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  /** uniform scale factor of the matrix (geometric mean) */
  E.scale = function (m) { return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1; };

  /**
   * Render the object's pixels into l.canvas (content-sized, offset).  Strong downscales go through
   * progressive halving of the source first (no aliasing), then one high-quality affine draw.
   */
  E.render = function (l, doc) {
    const e = l.embed; if (!e) return;
    let b = U.rectRound(E.bounds(l));
    b = (b && U.rectIntersect({ x: b.x - 1, y: b.y - 1, w: b.w + 2, h: b.h + 2 }, L.limitRect(doc))) || { x: 0, y: 0, w: 1, h: 1 };
    const c = U.createCanvas(b.w, b.h, b.x, b.y), x = c.getContext('2d');
    let src = e.source, m = e.matrix.slice();
    const sc = E.scale(m);
    if (sc < 0.5) { // halve until within 2× of the target scale
      let cur = src, k = 1;
      while (k * 0.5 > sc * 0.9 && cur.width > 2 && cur.height > 2) {
        const t = U.createCanvas(Math.max(1, Math.round(cur.width / 2)), Math.max(1, Math.round(cur.height / 2))), tx = t.getContext('2d');
        tx.imageSmoothingQuality = 'high'; tx.drawImage(cur, 0, 0, t.width, t.height);
        cur = t; k /= 2;
      }
      // the halved copy is in a space scaled by k: fold that into the matrix
      m = S.Affine.mul(m, [1 / k, 0, 0, 1 / k, 0, 0]);
      src = cur; src.ox = (e.source.ox || 0) * k; src.oy = (e.source.oy || 0) * k;
    }
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.translate(-b.x, -b.y); x.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    x.drawImage(src, src.ox || 0, src.oy || 0);
    x.setTransform(1, 0, 0, 1, 0, 0);
    // smart filters (non-destructive filter stack)
    if (e.filters && e.filters.some((f) => f.on !== false) && window.ImageFX) {
      let img = x.getImageData(0, 0, b.w, b.h);
      const orig = e.fmask ? new Uint8ClampedArray(img.data) : null;
      for (const f of e.filters) {
        if (f.on === false) continue;
        const fx = ImageFX.filters[f.id] || ImageFX.adjustments[f.id];
        if (!fx) continue;
        try { img = ImageFX.apply(fx, img, f.params || {}, {}) || img; } catch (err) { console.warn('Smart filter failed', f.id, err); }
      }
      if (orig) { // smart-filter mask: filtered pixels only where the mask allows
        const mk = L.readRect(e.fmask.canvas, b, L.maskOutside(e.fmask)).data, d = img.data;
        for (let i = 0, j = 0; i < d.length; i += 4, j += 4) { const k = mk[j + 3] / 255; if (k >= 1) continue; for (let c2 = 0; c2 < 4; c2++) d[i + c2] = orig[i + c2] + (d[i + c2] - orig[i + c2]) * k; }
      }
      x.putImageData(img, 0, 0);
    }
    l.canvas = c; l._ev = e.version;
    delete l._cbKey;
  };
  /** make sure the rendered canvas matches the embed state */
  E.ensure = function (l, doc) { if (l.embed && l._ev !== l.embed.version) E.render(l, doc); };
  E.bump = function (l) { if (l.embed) { l.embed.version = (l.embed.version || 0) + 1; l.version++; l._thumbDirty = true; } };

  /** Apply a document-space affine A to the object (A maps the current placement to the new one) */
  E.transform = function (l, A, doc) {
    const e = l.embed; if (!e) return;
    e.matrix = S.Affine.mul(A, e.matrix);
    E.bump(l); E.render(l, doc);
  };
  E.translate = function (l, dx, dy, doc) { E.transform(l, [1, 0, 0, 1, dx, dy], doc); };

  /* ---------- editing the contents in its own document ---------- */
  E.editContents = function (doc, l) {
    if (!E.is(l)) return;
    const e = l.embed, src = e.source;
    const nd = new S.Document({ name: l.name + ' (contents)', width: Math.max(1, src.width), height: Math.max(1, src.height), dpi: doc.dpi });
    const c = U.createCanvas(src.width, src.height); c.getContext('2d').drawImage(src, 0, 0);
    const nl = L.raster(nd, 'Contents', c);
    nd.layers.push(nl); nd.activeId = nl.id; nd.selectedIds = new Set([nl.id]);
    nd.embedLink = { docId: doc.id, layerId: l.id, ox: src.ox || 0, oy: src.oy || 0 };
    S.App.addDoc(nd, 'Edit Contents');
    S.toast('Editing the embedded object — Save (Ctrl+S) writes it back into “' + doc.name + '”', 3000);
    return nd;
  };
  /** Write a contents document back into its parent layer.  Returns true when it did. */
  E.commitContents = function (cd) {
    const link = cd.embedLink; if (!link) return false;
    const pd = S.app.docs.find((d) => d.id === link.docId), l = pd && pd.findLayer(link.layerId);
    if (!pd || !l || !l.embed) { S.toast('The parent object no longer exists'); return false; }
    S.Compositor.update(cd);
    const flat = S.Compositor.flatten(cd);
    const src = L.trim(flat); src.ox = (src.ox || 0) + link.ox; src.oy = (src.oy || 0) + link.oy;
    pd.commit('Update Embedded Object', () => { const lay = pd.findLayer(link.layerId); lay.embed = { ...lay.embed, source: src }; E.bump(lay); E.render(lay, pd); });
    cd.modified = false; cd.savedIndex = cd.history.index;
    S.bus.emit('history:changed', pd);
    S.toast('“' + l.name + '” updated in ' + pd.name);
    return true;
  };

  /* ---------- hooks into the rest of the app ---------- */
  // rendering: keep the canvas in sync whenever anything asks for the layer's pixels
  const ensure0 = L.ensure;
  L.ensure = function (l, doc) { if (l && l.embed) E.ensure(l, doc); return ensure0(l, doc); };
  // history snapshots: the embed record is state (source canvas shared by reference)
  const cloneMeta0 = L.cloneMeta;
  L.cloneMeta = function (l) { const c = cloneMeta0(l); if (l.embed) c.embed = { ...l.embed, matrix: l.embed.matrix.slice(), filters: JSON.parse(JSON.stringify(l.embed.filters || [])), fmask: l.embed.fmask ? { ...l.embed.fmask } : null }; return c; };
  const duplicate0 = L.duplicate;
  L.duplicate = function (l, doc) { const c = duplicate0(l, doc); const fix = (x) => { if (x.embed) x.embed = { ...x.embed, source: U.cloneCanvas(x.embed.source), version: (x.embed.version || 0) + 1 }; if (x.children) x.children.forEach(fix); }; fix(c); return c; };
  // metaSig must see the embed state so undo keeps caches only when it is unchanged
  const metaSig0 = S.Document.metaSig;
  S.Document.metaSig = function (l) { return metaSig0(l) + (l.embed ? '|' + l.embed.matrix.join(',') + '|' + l.embed.version + '|' + JSON.stringify(l.embed.filters || []) + '|' + (l.embed.fmask ? 'm' : '') : ''); };
  // painting goes through the rasterize prompt
  const paintTarget0 = S.Document.prototype.paintTarget;
  S.Document.prototype.paintTarget = function () {
    const t = paintTarget0.call(this);
    if (t && t.kind === 'pixels' && t.layer && t.layer.embed) return { kind: 'invalid', layer: t.layer, embed: true };
    return t;
  };
})();
