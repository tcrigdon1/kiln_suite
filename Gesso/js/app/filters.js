/* =========================================================================
   Gesso — filter / destructive adjustment dialogs with live preview,
   and the Layer Effects dialog.
   Previews are rendered straight into the target canvas (so blend modes,
   masks and layers above preview correctly) and rolled back on Cancel.
   Large visible areas are previewed at reduced resolution ("fast preview")
   with pixel-unit parameters scaled accordingly.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util;
  const FX = (S.FX = { last: null });
  const MAX_PREVIEW = 1.6e6; // pixels

  /** Target canvas for destructive effects (pixels or mask), with rasterize prompt */
  async function effectTarget(doc) {
    const t = doc.paintTarget();
    if (!t) { S.toast('No layer selected'); return null; }
    if (t.kind === 'invalid') {
      if (['text', 'shape', 'fill'].includes(t.layer.type) || S.Embed.is(t.layer)) {
        if (!(await S.Dialog.confirm('“' + t.layer.name + '” ' + (S.Embed.is(t.layer) ? 'is an embedded object and ' : '') + 'must be rasterized before applying this. Rasterize now?', 'Rasterize'))) return null;
        S.Cmd.run('layer.rasterize');
        return doc.paintTarget();
      }
      S.toast(t.layer.type === 'adjustment' ? 'Select the adjustment layer’s mask, or a pixel layer' : 'Select a pixel layer');
      return null;
    }
    if (t.layer && (t.layer.locks.all || t.layer.locks.pixels)) { S.toast('Layer is locked'); return null; }
    return t;
  }
  FX.effectTarget = effectTarget;

  /** ImageData for a target; masks are converted to opaque grayscale */
  function readTarget(t, r) {
    const img = S.Layers.readRect(t.canvas, r, t.outside || 0);
    if (t.kind !== 'pixels') { const d = img.data; for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = d[i + 3]; d[i + 3] = 255; } }
    return img;
  }
  function writeTarget(t, img, r) {
    if (t.kind !== 'pixels') { const d = img.data; for (let i = 0; i < d.length; i += 4) { d[i + 3] = U.luma(d[i], d[i + 1], d[i + 2]); d[i] = d[i + 1] = d[i + 2] = 0; } }
    S.Layers.writeRect(t.canvas, img, r, t.outside || 0);
  }
  function selMaskFor(doc, r) {
    if (!doc.selection) return undefined;
    const m = new Uint8ClampedArray(r.w * r.h), s = doc.selection.mask, W = doc.width;
    for (let y = 0; y < r.h; y++) m.set(s.subarray((y + r.y) * W + r.x, (y + r.y) * W + r.x + r.w), y * r.w);
    return m;
  }
  function bumpTarget(doc, t) {
    if (t.kind === 'quickmask') doc.quickMask.version = (doc.quickMask.version || 0) + 1;
    else { if (t.kind === 'mask') t.layer.mask.version = (t.layer.mask.version || 0) + 1; doc.bump(t.layer); }
    doc.invalidate();
  }

  /** Apply an effect to the whole target (or selection) and record history */
  function applyFull(doc, t, fx, params, name, snapshot, extraOpts, noRecord) {
    const r = doc.selection ? doc.selection.bounds : { x: 0, y: 0, w: doc.width, h: doc.height };
    const edit = { snapshot: snapshot || U.cloneCanvas(t.canvas) };
    // read from the untouched snapshot
    const src = { kind: t.kind, canvas: edit.snapshot, outside: t.outside };
    const img = readTarget(src, r);
    let out;
    const eo = extraOpts && extraOpts.depth && r.w * r.h !== doc.width * doc.height ? FX.sliceExtra(extraOpts, r, doc) : extraOpts;
    try { out = fx.apply(img, params, Object.assign({ selectionMask: selMaskFor(doc, r) }, eo || {})) || img; }
    catch (e) { console.error(e); S.toast('Effect failed: ' + e.message); return false; }
    // restore full snapshot first (in case preview touched other areas), then write result
    S.Layers.restoreFrom(t.canvas, edit.snapshot, t.outside || 0);
    writeTarget(t, out, r);
    const before = S.Layers.readRect(edit.snapshot, r, t.outside || 0);
    const after = S.Layers.readRect(t.canvas, r, t.outside || 0);
    doc.pushPixelEntry(name, t.kind, t.layer ? t.layer.id : null, r, before, after);
    if (fx.id && fx.id !== 'gallery' && !noRecord) S.bus.emit('action:filter', { type: 'filter', id: fx.id, name, params: JSON.parse(JSON.stringify(params || {})) });
    // the whole-document write may have grown the layer: drop transparent (or outside-valued) borders again
    if (t.kind === 'pixels') S.Layers.trimInPlace(t.canvas); else if (t.kind === 'mask') S.Layers.trimMask(t.layer.mask);
    bumpTarget(doc, t);
    S.bus.emit('layers:changed', doc);
    return true;
  }

  /** Generic effect dialog (filters and destructive adjustments) */
  FX.dialog = async function (fx, kind) {
    const doc = S.app.doc; if (!doc || !fx) return;
    const t = await effectTarget(doc); if (!t) return;
    const name = fx.name;
    const stored = S.store.get('fxparams', {})[fx.id];
    const params = Object.assign(window.ImageFX.defaults ? ImageFX.defaults(fx) : S.Layers.defaultParams(fx), stored || {});
    if (!fx.params.length) { // no parameters: apply immediately
      applyFull(doc, t, fx, params, name);
      FX.last = { fx, params, kind };
      return;
    }
    const snapshot = U.cloneCanvas(t.canvas);
    let preview = true, vals = params, pending = null, busy = false, closed = false;
    const info = U.el('span', { class: 'muted fx-info' }, '');
    const extra = FX.extraUI(fx, doc, () => runPreview()); // reference layer / depth map pickers for some effects
    const restore = () => { S.Layers.restoreFrom(t.canvas, snapshot, t.outside || 0); if (t.kind === 'pixels') S.Layers.trimInPlace(t.canvas); else if (t.kind === 'mask') S.Layers.trimMask(t.layer.mask); bumpTarget(doc, t); };
    const runPreview = () => {
      if (closed) return; // a preview scheduled before OK/Cancel must not overwrite the committed result
      if (busy) { pending = true; return; }
      if (!preview) { restore(); return; }
      busy = true;
      info.textContent = 'Rendering…';
      setTimeout(() => {
        if (closed) { busy = false; return; }
        try {
          const vis = S.View.visibleDocRect(doc);
          let r = U.rectInt(U.rectIntersect({ x: vis.x - 16, y: vis.y - 16, w: vis.w + 32, h: vis.h + 32 }, { x: 0, y: 0, w: doc.width, h: doc.height }) || { x: 0, y: 0, w: 1, h: 1 }, doc.width, doc.height);
          if (doc.selection) r = U.rectInt(U.rectIntersect(r, doc.selection.bounds) || doc.selection.bounds, doc.width, doc.height);
          if (!r) { busy = false; return; }
          const t0 = performance.now();
          const k = Math.min(1, Math.sqrt(MAX_PREVIEW / (r.w * r.h)));
          const src = { kind: t.kind, canvas: snapshot, outside: t.outside };
          S.Layers.restoreFrom(t.canvas, snapshot, t.outside || 0);
          if (k >= 1) {
            const img = readTarget(src, r);
            const out = fx.apply(img, vals, Object.assign({ selectionMask: selMaskFor(doc, r) }, extra.opts(r, 1))) || img;
            writeTarget(t, out, r);
            info.textContent = '';
          } else {
            // fast preview: downscale, scale px params, upscale back
            const sw = Math.max(1, Math.round(r.w * k)), sh = Math.max(1, Math.round(r.h * k));
            const small = U.createCanvas(sw, sh), sx = small.getContext('2d');
            if (t.outside) { sx.fillStyle = 'rgba(0,0,0,' + t.outside / 255 + ')'; sx.fillRect(0, 0, sw, sh); }
            const big = S.Layers.maskOver({ canvas: snapshot, outside: t.outside || 0 }, r); // snapshot region with outside fill
            sx.drawImage(big, 0, 0, r.w, r.h, 0, 0, sw, sh);
            const p2 = Object.assign({}, vals);
            for (const d of fx.params) if (d.unit === 'px' && typeof p2[d.id] === 'number') p2[d.id] *= k;
            const img = readTarget({ kind: t.kind, canvas: small }, { x: 0, y: 0, w: sw, h: sh });
            let mask;
            if (doc.selection) { const mc = U.createCanvas(sw, sh); mc.getContext('2d').drawImage(S.Sel.canvas(doc.selection), r.x, r.y, r.w, r.h, 0, 0, sw, sh); mask = S.Sel.alphaOf(mc); }
            const out = fx.apply(img, p2, Object.assign({ selectionMask: mask }, extra.opts(r, k))) || img;
            writeTarget({ kind: t.kind, canvas: small }, out, { x: 0, y: 0, w: sw, h: sh });
            S.Layers.growTo(t.canvas, r, 0, null, t.outside || 0);
            const x = t.canvas.getContext('2d');
            x.save(); x.setTransform(1, 0, 0, 1, -(t.canvas.ox || 0), -(t.canvas.oy || 0)); x.beginPath(); x.rect(r.x, r.y, r.w, r.h); x.clip(); x.clearRect(r.x, r.y, r.w, r.h); x.imageSmoothingQuality = 'high';
            x.drawImage(small, 0, 0, sw, sh, r.x, r.y, r.w, r.h); x.restore();
            info.textContent = 'Fast preview (' + Math.round(k * 100) + '%)';
          }
          bumpTarget(doc, t);
          void t0;
        } catch (e) { console.error(e); info.textContent = 'Preview failed: ' + e.message; }
        busy = false;
        if (pending) { pending = false; runPreview(); }
      }, 10);
    };
    const debounced = U.debounce(runPreview, 140);
    const histogram = () => S.ParamUI.histogramOf(snapshot);
    const ui = S.ParamUI.build(fx.params, params, (v, id, final) => { vals = v; if (final) runPreview(); else debounced(); }, { histogram });
    const pv = U.el('label', { class: 'check-row' }, [U.el('input', { type: 'checkbox', checked: true, onchange: (e) => { preview = e.target.checked; runPreview(); } }), U.el('span', {}, 'Preview')]);
    const resetBtn = U.el('button', { class: 'btn ghost btn-sm' }, 'Reset');
    const body = U.el('div', { class: 'fx-dialog-body' }, [extra.el, ui]);
    const dlg = S.Dialog.open({
      title: name, body, cls: 'fx-dialog', width: ['curve', 'levels', 'gradient'].some((ty) => fx.params.some((p) => p.type === ty)) ? 300 : 360, transparent: true,
      footLeft: U.el('div', { class: 'row' }, [pv, resetBtn, info]),
      onCancel: () => { closed = true; extra.close(); restore(); },
      buttons: [{ label: 'Cancel', run: () => { closed = true; extra.close(); restore(); } }, { label: 'OK', primary: true, run: () => {
        closed = true; extra.close();
        applyFull(doc, t, fx, vals, name, snapshot, extra.opts({ x: 0, y: 0, w: doc.width, h: doc.height }, 1));
        const all = S.store.get('fxparams', {}); all[fx.id] = vals; S.store.set('fxparams', all);
        FX.last = { fx, params: JSON.parse(JSON.stringify(vals)), kind };
      } }],
    });
    resetBtn.addEventListener('click', () => {
      const def = ImageFX.defaults ? ImageFX.defaults(fx) : S.Layers.defaultParams(fx);
      vals = def; body.innerHTML = '';
      body.appendChild(S.ParamUI.build(fx.params, def, (v, id, final) => { vals = v; if (final) runPreview(); else debounced(); }, { histogram }));
      runPreview();
    });
    // position dialog to the right so the canvas stays visible
    dlg.el.style.position = 'fixed'; dlg.el.style.right = '340px'; dlg.el.style.top = '110px';
    // effects with a centre (radial blur, twirl…): click on the picture to place it
    if (fx.params.some((p) => p.id === 'centerX') && fx.params.some((p) => p.id === 'centerY')) {
      dlg.el.closest('.modal-backdrop').classList.add('modeless');
      const hint = U.el('div', { class: 'muted param-note' }, 'Click on the picture to set the centre.');
      body.insertBefore(hint, body.firstChild);
      S.app.pickHook = (pi) => {
        const cx = U.clamp(Math.round((pi.x / doc.width) * 100), 0, 100), cy = U.clamp(Math.round((pi.y / doc.height) * 100), 0, 100);
        vals.centerX = cx; vals.centerY = cy;
        const inputs = ui.querySelectorAll('input[type=range]');
        ui.querySelectorAll('.field').forEach((f) => { const lab = f.querySelector('label'); if (!lab) return; const v = /Center X|Centre X|Horizontal/i.test(lab.textContent) ? cx : /Center Y|Centre Y|Vertical/i.test(lab.textContent) ? cy : null; if (v == null) return; f.querySelectorAll('input').forEach((i) => (i.value = v)); });
        void inputs; runPreview();
      };
      const off = () => { if (S.app.pickHook) S.app.pickHook = null; };
      const onClose0 = extra.close; extra.close = () => { off(); onClose0(); };
    }
    runPreview();
  };
  FX.filterDialog = (id) => FX.dialog(ImageFX.filters[id], 'filter');
  /** apply an effect with given parameters, no dialog (actions / batch) */
  FX.applyWithParams = (doc, t, fx, params, name) => applyFull(doc, t, fx, params, name || fx.name);
  FX.applyAdjustmentDestructive = (id) => FX.dialog(ImageFX.adjustments[id], 'adjustment');
  FX.quickApply = async function (id, name) {
    const fx = ImageFX.adjustments[id] || ImageFX.filters[id];
    if (!fx) { S.toast(name + ' is not available'); return; }
    const doc = S.app.doc, t = await effectTarget(doc); if (!t) return;
    applyFull(doc, t, fx, ImageFX.defaults ? ImageFX.defaults(fx) : {}, name, null, null, true); // the command itself is what actions record
  };
  FX.repeatLast = async function () {
    if (!FX.last) return;
    const doc = S.app.doc, t = await effectTarget(doc); if (!t) return;
    applyFull(doc, t, FX.last.fx, FX.last.params, FX.last.fx.name);
  };

  /* ======================= per-effect extras: reference layer, depth map ======================= */
  /** luminance (0..1) of a layer rendered over the document */
  function layerDepth(doc, l) {
    const c = S.Compositor.renderSingle(Object.assign({}, l, { opacity: 1, blend: 'normal', clip: false }), doc);
    const d = c.getContext('2d').getImageData(0, 0, doc.width, doc.height).data, n = doc.width * doc.height, out = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) out[i] = (U.luma(d[j], d[j + 1], d[j + 2]) / 255) * (d[j + 3] / 255);
    return out;
  }
  /** cut the document-size depth map to rect r (and scale k) */
  FX.sliceExtra = function (extra, r, doc, k) {
    if (!extra || !extra.depth) return extra;
    k = k || 1;
    const sw = Math.max(1, Math.round(r.w * k)), sh = Math.max(1, Math.round(r.h * k)), out = new Float32Array(sw * sh), W = doc.width;
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const dx = Math.min(doc.width - 1, r.x + Math.floor(x / k)), dy = Math.min(doc.height - 1, r.y + Math.floor(y / k)); out[y * sw + x] = extra.depth[dy * W + dx]; }
    return Object.assign({}, extra, { depth: out });
  };
  /** UI + opts provider for effects that need another layer (matchColor: reference statistics; depthBlur: depth map) */
  FX.extraUI = function (fx, doc, onChange) {
    const el = U.el('div', { class: 'fx-extra' });
    const state = { reference: null, depth: null };
    const none = { el, opts: () => ({}), close: () => {} };
    if (!fx || (fx.id !== 'matchColor' && fx.id !== 'depthBlur')) return none;
    const layers = doc.allLayers().filter((l) => l.type !== 'group' && l.type !== 'adjustment' && l.id !== doc.activeId);
    const sel = U.el('select');
    sel.appendChild(U.el('option', { value: '' }, fx.id === 'matchColor' ? 'Choose the reference layer…' : 'Choose the depth layer (bright = far)…'));
    if (fx.id === 'depthBlur') sel.appendChild(U.el('option', { value: '__sel' }, 'Current selection as the in-focus area'));
    for (const l of layers) sel.appendChild(U.el('option', { value: l.id }, l.name));
    const compute = () => {
      state.reference = null; state.depth = null;
      const v = sel.value; if (!v) { onChange(); return; }
      if (fx.id === 'matchColor') {
        const l = doc.findLayer(v); if (!l) return;
        const c = S.Compositor.renderSingle(Object.assign({}, l, { opacity: 1, blend: 'normal', clip: false }), doc);
        state.reference = S.labStats(c.getContext('2d').getImageData(0, 0, doc.width, doc.height));
      } else if (v === '__sel') {
        const n = doc.width * doc.height, m = doc.selection ? doc.selection.mask : null, out = new Float32Array(n);
        if (m) { const dist = S.Sel.distance(doc.width, doc.height, (i) => m[i] >= 128); for (let i = 0; i < n; i++) out[i] = Math.min(1, dist[i] / 120); }
        state.depth = out;
      } else { const l = doc.findLayer(v); if (l) state.depth = layerDepth(doc, l); }
      onChange();
    };
    sel.addEventListener('change', compute);
    el.append(U.el('div', { class: 'field field-wide' }, [U.el('label', {}, fx.id === 'matchColor' ? 'Reference' : 'Depth map'), sel]));
    if (!layers.length && fx.id === 'matchColor') el.appendChild(U.el('div', { class: 'param-note muted' }, 'Add another layer to match colours against.'));
    return { el, opts: (r, k) => { if (state.reference) return { reference: state.reference }; if (state.depth) return FX.sliceExtra({ depth: state.depth }, r, doc, k); return {}; }, close: () => {} };
  };

  /* ======================= Filter Gallery / smart filters ======================= */
  /** apply a filter stack to an ImageData (px parameters scaled by k for fast previews) */
  FX.applyStack = function (img, stack, k, opts) {
    for (const f of stack) {
      if (f.on === false) continue;
      const fx = ImageFX.filters[f.id] || ImageFX.adjustments[f.id]; if (!fx) continue;
      let p = f.params || {};
      if (k && k < 1) { p = Object.assign({}, p); for (const d of fx.params) if (d.unit === 'px' && typeof p[d.id] === 'number') p[d.id] *= k; }
      try { img = fx.apply(img, p, opts || {}) || img; } catch (e) { console.warn('filter failed', f.id, e); }
    }
    return img;
  };
  FX.filterChoices = function () {
    const out = [];
    const cats = (ImageFX.categories && ImageFX.categories.filters) || [];
    const by = {};
    for (const id in ImageFX.filters) { const c = ImageFX.filters[id].category || 'Other'; (by[c] = by[c] || []).push(ImageFX.filters[id]); }
    for (const c of cats.concat(Object.keys(by).filter((x) => !cats.includes(x)))) if (by[c]) for (const fx of by[c].sort((a, b) => a.name.localeCompare(b.name))) if (!['matchColor', 'depthBlur'].includes(fx.id)) out.push({ value: fx.id, label: c + ' ▸ ' + fx.name.replace('…', '') });
    for (const fx of S.adjList()) out.push({ value: fx.id, label: 'Adjust ▸ ' + fx.name });
    return out;
  };
  /**
   * Filter Gallery: stack several filters with live preview.  On an embedded object the stack is stored as
   * smart filters (editable later); on a pixel layer / mask it is applied destructively in one history step.
   */
  FX.galleryDialog = async function (layer) {
    const doc = S.app.doc; if (!doc) return;
    const l = layer || doc.activeLayer();
    const smart = S.Embed.is(l) && !(l.editMask && l.mask);
    let t = null, snapshot = null;
    if (!smart) { t = await effectTarget(doc); if (!t) return; snapshot = U.cloneCanvas(t.canvas); }
    const before = doc.captureState();
    const stack = smart ? JSON.parse(JSON.stringify(l.embed.filters || [])) : [];
    if (!stack.length) stack.push({ id: 'gaussianBlur', params: ImageFX.defaults(ImageFX.filters.gaussianBlur), on: true });
    let cur = 0, closed = false, busy = false, pending = false;
    const list = U.el('div', { class: 'fg-list' }), right = U.el('div', { class: 'fg-params' }), info = U.el('span', { class: 'muted fx-info' });
    const choices = FX.filterChoices();
    const fxOf = (f) => ImageFX.filters[f.id] || ImageFX.adjustments[f.id];
    const renderList = () => {
      list.innerHTML = '';
      stack.forEach((f, i) => {
        const cb = U.el('input', { type: 'checkbox', checked: f.on !== false }); cb.addEventListener('click', (e) => e.stopPropagation()); cb.addEventListener('change', () => { f.on = cb.checked; preview(); });
        const row = U.el('div', { class: 'fx-item' + (i === cur ? ' active' : '') }, [cb, U.el('span', { style: { flex: 1 } }, (fxOf(f) || {}).name || f.id)]);
        const up = U.el('button', { class: 'icon-btn', html: S.icon('chevDown'), title: 'Move down (applied later)' }); up.style.transform = 'rotate(180deg)';
        const dn = U.el('button', { class: 'icon-btn', html: S.icon('chevDown'), title: 'Move up' });
        const del = U.el('button', { class: 'icon-btn', html: S.icon('close'), title: 'Remove' });
        up.addEventListener('click', (e) => { e.stopPropagation(); if (i > 0) { [stack[i - 1], stack[i]] = [stack[i], stack[i - 1]]; cur = i - 1; renderList(); renderParams(); preview(); } });
        dn.addEventListener('click', (e) => { e.stopPropagation(); if (i < stack.length - 1) { [stack[i + 1], stack[i]] = [stack[i], stack[i + 1]]; cur = i + 1; renderList(); renderParams(); preview(); } });
        del.addEventListener('click', (e) => { e.stopPropagation(); stack.splice(i, 1); cur = Math.max(0, Math.min(cur, stack.length - 1)); renderList(); renderParams(); preview(); });
        row.append(up, dn, del);
        row.addEventListener('click', () => { cur = i; renderList(); renderParams(); });
        list.appendChild(row);
      });
      const add = U.el('button', { class: 'btn btn-sm' }, '+ Add filter');
      add.addEventListener('click', () => { stack.push({ id: 'sharpen', params: ImageFX.defaults(ImageFX.filters.sharpen), on: true }); cur = stack.length - 1; renderList(); renderParams(); preview(); });
      list.appendChild(U.el('div', { class: 'fg-add' }, [add]));
    };
    const renderParams = () => {
      right.innerHTML = '';
      const f = stack[cur]; if (!f) { right.appendChild(U.el('div', { class: 'muted' }, 'Add a filter to the stack.')); return; }
      const selDef = [{ id: 'id', label: 'Filter', type: 'select', default: f.id, options: choices }];
      right.appendChild(S.ParamUI.build(selDef, {}, (v) => { f.id = v.id; f.params = ImageFX.defaults(fxOf(f)); renderList(); renderParams(); preview(); }));
      const fx = fxOf(f);
      if (fx && fx.params.length) right.appendChild(S.ParamUI.build(fx.params.filter((p) => p.type !== 'hidden'), f.params, (v, id, final) => { Object.assign(f.params, JSON.parse(JSON.stringify(v))); if (final) preview(); else debounced(); }, { histogram: () => S.ParamUI.histogramOf(smart ? l.embed.source : snapshot) }));
      else right.appendChild(U.el('div', { class: 'muted param-note' }, 'This filter has no settings.'));
    };
    const previewSmart = () => { l.embed.filters = JSON.parse(JSON.stringify(stack)); S.Embed.bump(l); S.Embed.render(l, doc); doc.invalidate(); S.View.redraw(); };
    const previewDestructive = () => {
      if (busy) { pending = true; return; }
      busy = true; info.textContent = 'Rendering…';
      setTimeout(() => {
        if (closed) { busy = false; return; }
        try {
          const vis = S.View.visibleDocRect(doc);
          let r = U.rectInt(U.rectIntersect({ x: vis.x - 16, y: vis.y - 16, w: vis.w + 32, h: vis.h + 32 }, { x: 0, y: 0, w: doc.width, h: doc.height }) || { x: 0, y: 0, w: 1, h: 1 }, doc.width, doc.height);
          if (doc.selection) r = U.rectInt(U.rectIntersect(r, doc.selection.bounds) || doc.selection.bounds, doc.width, doc.height);
          S.Layers.restoreFrom(t.canvas, snapshot, t.outside || 0);
          if (r) {
            const k = Math.min(1, Math.sqrt(MAX_PREVIEW / (r.w * r.h)));
            const sw = Math.max(1, Math.round(r.w * k)), sh = Math.max(1, Math.round(r.h * k));
            const small = U.createCanvas(sw, sh), sx = small.getContext('2d');
            sx.drawImage(S.Layers.maskOver({ canvas: snapshot, outside: t.outside || 0 }, r), 0, 0, r.w, r.h, 0, 0, sw, sh);
            const img = readTarget({ kind: t.kind, canvas: small }, { x: 0, y: 0, w: sw, h: sh });
            let mask; if (doc.selection) { const mc = U.createCanvas(sw, sh); mc.getContext('2d').drawImage(S.Sel.canvas(doc.selection), r.x, r.y, r.w, r.h, 0, 0, sw, sh); mask = S.Sel.alphaOf(mc); }
            const out = FX.applyStack(img, stack, k, { selectionMask: mask });
            writeTarget({ kind: t.kind, canvas: small }, out, { x: 0, y: 0, w: sw, h: sh });
            S.Layers.growTo(t.canvas, r, 0, null, t.outside || 0);
            const x = t.canvas.getContext('2d');
            x.save(); x.setTransform(1, 0, 0, 1, -(t.canvas.ox || 0), -(t.canvas.oy || 0)); x.beginPath(); x.rect(r.x, r.y, r.w, r.h); x.clip(); x.clearRect(r.x, r.y, r.w, r.h); x.imageSmoothingQuality = 'high'; x.drawImage(small, 0, 0, sw, sh, r.x, r.y, r.w, r.h); x.restore();
            info.textContent = k < 1 ? 'Fast preview (' + Math.round(k * 100) + '%)' : '';
          }
          bumpTarget(doc, t);
        } catch (e) { console.error(e); info.textContent = 'Preview failed: ' + e.message; }
        busy = false; if (pending) { pending = false; previewDestructive(); }
      }, 10);
    };
    const preview = () => (smart ? previewSmart() : previewDestructive());
    const debounced = U.debounce(preview, 140);
    renderList(); renderParams(); preview();
    const maskBtn = smart ? U.el('button', { class: 'btn btn-sm' }, l.embed.fmask ? 'Remove filter mask' : 'Mask from selection') : null;
    if (maskBtn) maskBtn.addEventListener('click', () => {
      if (l.embed.fmask) { l.embed.fmask = null; maskBtn.textContent = 'Mask from selection'; }
      else { if (!doc.selection) { S.toast('Make a selection first: the smart filters then only apply inside it'); return; } l.embed.fmask = S.Layers.maskFrom(S.selMaskCanvas(doc, false), 0); maskBtn.textContent = 'Remove filter mask'; }
      previewSmart();
    });
    const dlg = S.Dialog.open({ title: smart ? 'Smart Filters — ' + l.name : 'Filter Gallery', cls: 'effects-dialog fg-dialog', transparent: true,
      body: U.el('div', { class: 'fx-effects-body' }, [list, right]),
      footLeft: U.el('div', { class: 'row' }, [maskBtn, info, smart ? U.el('span', { class: 'muted' }, 'Non-destructive: edit again any time (Properties ▸ Smart filters…)') : null]),
      onCancel: () => { closed = true; if (smart) { doc.restoreState(before); S.bus.emit('layers:changed', doc); } else { S.Layers.restoreFrom(t.canvas, snapshot, t.outside || 0); if (t.kind === 'pixels') S.Layers.trimInPlace(t.canvas); bumpTarget(doc, t); } },
      buttons: [{ label: 'Cancel', run: () => { dlg.close(false); } }, { label: 'OK', primary: true, run: () => {
        closed = true;
        if (smart) { l.embed.filters = JSON.parse(JSON.stringify(stack)); S.Embed.bump(l); S.Embed.render(l, doc); doc.pushState('Smart Filters', before); S.bus.emit('activeLayer:changed', doc); return; }
        // destructive: one combined effect through applyFull
        const combined = { id: 'gallery', name: 'Filter Gallery', params: [], apply: (img, p, o) => FX.applyStack(img, stack, 1, o) };
        applyFull(doc, t, combined, {}, 'Filter Gallery', snapshot);
      } }] });
    dlg.el.style.position = 'fixed'; dlg.el.style.right = '330px'; dlg.el.style.top = '90px';
  };
  S.Cmd.register('filter.gallery', { label: 'Filter Gallery…', key: 'Ctrl+Alt+Shift+G', run: () => FX.galleryDialog(), enabled: () => !!(S.app.doc && S.app.doc.activeLayer()) });
  S.Cmd.register('filter.smart', { label: 'Smart Filters… (embedded objects)', run: () => FX.galleryDialog(S.app.doc.activeLayer()), enabled: () => !!(S.app.doc && S.Embed.is(S.app.doc.activeLayer())) });
  S.Cmd.register('filter.convertSmart', { label: 'Convert for Smart Filters', run: () => S.Cmd.run('layer.convertEmbed'), enabled: () => !!(S.app.doc && S.app.doc.activeLayer() && ['raster', 'text', 'shape', 'fill'].includes(S.app.doc.activeLayer().type) && !S.Embed.is(S.app.doc.activeLayer())) });
  S.Cmd.register('filter.clearSmart', { label: 'Clear Smart Filters', run: () => { const d = S.app.doc, l = d.activeLayer(); d.commit('Clear Smart Filters', () => { l.embed.filters = []; l.embed.fmask = null; S.Embed.bump(l); S.Embed.render(l, d); }); }, enabled: () => !!(S.app.doc && S.Embed.is(S.app.doc.activeLayer()) && (S.app.doc.activeLayer().embed.filters || []).length) });

  /* ======================= Layer Effects dialog ======================= */
  FX.effectsDialog = function (layer, focusId) {
    const doc = S.app.doc;
    if (!layer || layer.type === 'adjustment') return;
    const before = doc.captureState();
    const l = doc.findLayer(layer.id);
    if (!l.effects) l.effects = { enabled: true, items: {} };
    const items = l.effects.items;
    let current = focusId || Object.keys(items).find((k) => items[k].on) || 'dropShadow';
    const list = U.el('div', { class: 'fx-list' });
    const right = U.el('div', { class: 'fx-params' });
    const blendRow = U.el('div', { class: 'fx-blend' });
    const refresh = () => { l.version++; doc.invalidate(); S.View.redraw(); };
    function renderList() {
      list.innerHTML = '';
      list.appendChild(U.el('div', { class: 'fx-list-head' }, 'Blending'));
      const opRow = U.el('div', { class: 'fx-item' + (current === '_blend' ? ' active' : '') }, [U.el('span', {}, 'Blending Options')]);
      opRow.addEventListener('click', () => { current = '_blend'; renderList(); renderParams(); });
      list.appendChild(opRow);
      list.appendChild(U.el('div', { class: 'fx-list-head' }, 'Effects'));
      for (const d of S.Effects.DEFS) {
        const on = !!(items[d.id] && items[d.id].on);
        const cb = U.el('input', { type: 'checkbox', checked: on });
        cb.addEventListener('click', (e) => e.stopPropagation());
        cb.addEventListener('change', () => {
          if (!items[d.id]) items[d.id] = S.Effects.defaults(d.id);
          items[d.id].on = cb.checked;
          current = d.id; renderList(); renderParams(); refresh();
        });
        const row = U.el('div', { class: 'fx-item' + (current === d.id ? ' active' : '') }, [cb, U.el('span', {}, d.name)]);
        row.addEventListener('click', () => {
          if (!items[d.id]) { items[d.id] = S.Effects.defaults(d.id); refresh(); }
          if (!items[d.id].on && current !== d.id) { items[d.id].on = true; refresh(); }
          current = d.id; renderList(); renderParams();
        });
        list.appendChild(row);
      }
    }
    function renderParams() {
      right.innerHTML = '';
      if (current === '_blend') {
        const defs = [
          { id: 'blend', label: 'Blend Mode', type: 'select', default: l.blend, options: S.BLEND_MODES.filter(Boolean).map((m) => ({ value: m.id, label: m.label })) },
          { id: 'opacity', label: 'Opacity', type: 'range', default: Math.round(l.opacity * 100), min: 0, max: 100, unit: '%' },
          { id: 'fillOpacity', label: 'Fill Opacity', type: 'range', default: Math.round((l.fillOpacity ?? 1) * 100), min: 0, max: 100, unit: '%' },
          { id: 'note', type: 'note', label: 'Fill opacity fades the layer content but keeps effects like strokes and shadows fully visible.' },
        ];
        right.appendChild(U.el('div', { class: 'fx-title' }, 'Blending Options'));
        right.appendChild(S.ParamUI.build(defs, {}, (v) => { l.blend = v.blend; l.opacity = v.opacity / 100; l.fillOpacity = v.fillOpacity / 100; refresh(); }));
        return;
      }
      const def = S.Effects.def(current);
      if (!items[current]) items[current] = S.Effects.defaults(current);
      right.appendChild(U.el('div', { class: 'fx-title' }, def.name));
      right.appendChild(S.ParamUI.build(def.params, items[current], (v) => { Object.assign(items[current], v); refresh(); }));
    }
    renderList(); renderParams();
    void blendRow;
    const body = U.el('div', { class: 'fx-effects-body' }, [list, right]);
    const dlg = S.Dialog.open({ title: 'Layer Effects — ' + l.name, body, cls: 'effects-dialog', transparent: true,
      onCancel: () => { doc.restoreState(before); S.bus.emit('layers:changed', doc); },
      buttons: [{ label: 'Cancel', run: () => { doc.restoreState(before); S.bus.emit('layers:changed', doc); } },
        { label: 'OK', primary: true, run: () => {
          // drop effects that are off entirely
          for (const k in items) if (!items[k].on) delete items[k];
          if (!Object.keys(items).length) l.effects = null;
          doc.pushState('Layer Effects', before);
        } }] });
    dlg.el.style.position = 'fixed'; dlg.el.style.right = '330px'; dlg.el.style.top = '90px';
  };
})();
