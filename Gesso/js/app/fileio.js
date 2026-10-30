/* =========================================================================
   Gesso — file input/output: open images & projects, drag & drop,
   clipboard, native .kgesso project format, export (PNG/JPEG/WebP),
   print, recent files, autosave/recovery (IndexedDB).

   .kgesso = JSON: { format:'kgesso', version:2, name, width, height, dpi,
     guides, paths, activePathId, selection (PNG data URL of alpha or null),
     layers:[ {...metadata, pixels: dataURL?, bounds:{x,y,w,h}?, mask:{data,enabled,density,feather}?, children?} ] }
   version 2 stores raster pixels trimmed to their content with `bounds` (document position of the PNG);
   version 1 files (full-size layer PNGs at 0,0) still load and are trimmed on the way in.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util;
  const F = (S.FileIO = {});
  const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|avif|ico|svg)$/i;

  /* ---------------- IndexedDB helper ---------------- */
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (!window.indexedDB) { rej(new Error('no idb')); return; }
      const r = indexedDB.open('gesso', 2);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('recovery')) d.createObjectStore('recovery');
        if (!d.objectStoreNames.contains('handles')) d.createObjectStore('handles');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function idb(store, mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction(store, mode), st = tx.objectStore(store);
      const req = fn(st);
      tx.oncomplete = () => res(req && req.result);
      tx.onerror = () => rej(tx.error);
    });
  }
  F.idb = idb;

  /* ---------------- opening ---------------- */
  F.open = async function (opts) {
    opts = opts || {};
    if (window.showOpenFilePicker && !opts.legacy) {
      try {
        const handles = await window.showOpenFilePicker({ multiple: true, types: [
          { description: 'Images & Gesso projects', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif', '.svg'], 'application/json': ['.kgesso', '.kstrata'] } }] });
        for (const h of handles) { const f = await h.getFile(); await F.openFile(f, { asLayer: opts.asLayer, handle: h }); }
        return;
      } catch (e) { if (e.name === 'AbortError') return; /* fall back */ }
    }
    const inp = U.el('input', { type: 'file', multiple: true, accept: 'image/*,.svg,.kgesso,.kstrata' });
    inp.addEventListener('change', async () => { for (const f of inp.files) await F.openFile(f, opts); });
    inp.click();
  };
  F.openFile = async function (file, opts) {
    opts = opts || {};
    try {
      if (/\.k(gesso|strata)$/i.test(file.name) || file.type === 'application/json') {   // .kstrata = the pre-1.0 name of the format
        const text = await U.readFile(file, 'text');
        const d = await F.loadProject(JSON.parse(text), file.name.replace(/\.k(gesso|strata)$/i, ''));
        if (opts.handle) { d.fileHandle = opts.handle; F.rememberHandle(opts.handle, d.name + '.kgesso'); }
        F.addRecent(file.name);
        return d;
      }
      if (/\.svg$/i.test(file.name) || file.type === 'image/svg+xml') {
        // vector import: shapes / text / groups become editable layers
        const text = await U.readFile(file, 'text'), name = file.name.replace(/\.svg$/i, '');
        const r = await S.Vector.importSVG(text, name, { asLayer: opts.asLayer && !!S.app.doc });
        if (!(opts.asLayer && S.app.doc)) { if (opts.handle) F.rememberHandle(opts.handle, file.name); F.addRecent(file.name); }
        return r;
      }
      if (!file.type.startsWith('image/') && !IMG_RE.test(file.name)) { S.toast('Unsupported file: ' + file.name); return; }
      const url = URL.createObjectURL(file);
      const img = await U.loadImage(url);
      URL.revokeObjectURL(url);
      const name = file.name.replace(/\.[^.]+$/, '');
      if (opts.asLayer && S.app.doc) { F.placeImage(S.app.doc, img, name); return; }
      const d = F.docFromImage(img, name);
      if (opts.handle) F.rememberHandle(opts.handle, file.name);
      F.addRecent(file.name);
      return d;
    } catch (e) { console.error(e); S.toast('Could not open ' + file.name + ': ' + e.message); }
  };
  F.docFromImage = function (img, name) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const d = new S.Document({ name, width: w, height: h });
    const c = U.createCanvas(w, h); c.getContext('2d').drawImage(img, 0, 0);
    const l = S.Layers.raster(d, 'Background', c);
    d.layers.push(l); d.activeId = l.id; d.selectedIds = new Set([l.id]);
    S.App.addDoc(d, 'Open');
    return d;
  };
  /** Add an image as a new layer, centred (or at x,y) */
  F.placeImage = function (doc, img, name, x, y) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    let px = x, py = y;
    if (px == null) {
      // centre on the current selection (like most editors), else in the visible area
      const sb = doc.selection && doc.selection.bounds;
      const vis = sb || S.View.visibleDocRect(doc);
      const cx = U.clamp(vis.x + vis.w / 2, 0, doc.width), cy = U.clamp(vis.y + vis.h / 2, 0, doc.height);
      px = Math.round(cx - w / 2); py = Math.round(cy - h / 2);
      if (w >= doc.width) px = Math.round((doc.width - w) / 2); if (h >= doc.height) py = Math.round((doc.height - h) / 2);
    }
    const c = U.createCanvas(w, h, px, py); c.getContext('2d').drawImage(img, 0, 0);
    const l = S.Layers.raster(doc, name || 'Pasted Layer', c);
    // the pasted layer must not stay cut by an old selection (the Move tool would only move the selected part)
    doc.commit(name === 'Pasted Layer' ? 'Paste' : 'Place Image', () => {
      doc.insertLayer(l); doc.activeId = l.id; doc.selectedIds = new Set([l.id]);
      if (doc.selection) { doc.lastSelection = doc.selection; doc.selection = null; }
    });
    S.bus.emit('activeLayer:changed', doc);
    if (w > doc.width || h > doc.height) S.toast('Image is larger than the canvas — its pixels outside are kept (Free Transform, Image ▸ Reveal All)');
    return l;
  };

  /* ---------------- drag & drop ---------------- */
  F.initDrop = function () {
    let depth = 0;
    const overlay = U.el('div', { class: 'drop-overlay' }, [U.el('div', { class: 'drop-card' }, [U.el('div', { html: S.icon('image') }), U.el('div', {}, 'Drop to open'), U.el('div', { class: 'muted' }, 'Hold Shift to place into the current document')])]);
    document.body.appendChild(overlay);
    addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { depth++; overlay.classList.add('show'); e.preventDefault(); } });
    addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
    addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) overlay.classList.remove('show'); });
    addEventListener('drop', async (e) => {
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault(); depth = 0; overlay.classList.remove('show');
      const asLayer = e.shiftKey && !!S.app.doc;
      for (const f of e.dataTransfer.files) await F.openFile(f, { asLayer });
    });
  };

  /* ---------------- project save / load ---------------- */
  const blobToDataURL = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
  async function canvasData(c) { const b = await U.canvasToBlob(c, 'image/png'); return blobToDataURL(b); }
  async function serializeLayer(l) {
    const o = {};
    for (const k in l) {
      if (k.startsWith('_') || k === 'canvas' || k === 'mask' || k === 'children' || k === 'editMask' || k === 'embed') continue;
      o[k] = l[k];
    }
    if (l.type === 'raster') {
      const t = S.Layers.trim(l.canvas);
      if (S.Layers.contentBounds(t)) { o.pixels = await canvasData(t); o.bounds = { x: t.ox || 0, y: t.oy || 0, w: t.width, h: t.height }; }
      if (l.embed) { const e = l.embed, sc = e.source; o.embed = { source: await canvasData(sc), bounds: { x: sc.ox || 0, y: sc.oy || 0, w: sc.width, h: sc.height }, matrix: e.matrix.slice(), filters: JSON.parse(JSON.stringify(e.filters || [])) };
        if (e.fmask && !e.fmask.canvas._empty) { const fm = e.fmask.canvas; o.embed.fmask = { data: await canvasData(fm), bounds: { x: fm.ox || 0, y: fm.oy || 0 }, outside: S.Layers.maskOutside(e.fmask) }; } }
    }
    if (l.mask) {
      const m = l.mask, mc = m.canvas;
      o.mask = { enabled: m.enabled !== false, density: m.density ?? 1, feather: m.feather || 0, outside: S.Layers.maskOutside(m) };
      if (!mc._empty) { o.mask.data = await canvasData(mc); o.mask.bounds = { x: mc.ox || 0, y: mc.oy || 0, w: mc.width, h: mc.height }; }
    }
    if (l.children) o.children = await Promise.all(l.children.map(serializeLayer));
    return o;
  }
  F.serialize = async function (doc) {
    let sel = null;
    if (doc.selection) sel = await canvasData(S.Sel.canvas(doc.selection));
    return {
      format: 'kgesso', version: 2, app: 'Gesso ' + S.version, name: doc.name, width: doc.width, height: doc.height, dpi: doc.dpi,
      guides: doc.guides, paths: doc.paths, activePathId: doc.activePathId, selection: sel, activeId: doc.activeId, comps: doc.comps || [], activeCompId: doc.activeCompId || null,
      anim: doc.anim && doc.anim.frames ? { frames: doc.anim.frames.map((f) => ({ id: f.id, delay: f.delay, layers: f.layers, opts: f.opts })), current: doc.anim.current, loop: doc.anim.loop !== false } : null,
      layers: await Promise.all(doc.layers.map(serializeLayer)),
      alphaChannels: await Promise.all(doc.alphaChannels.filter((c) => c.sel).map(async (c) => ({ name: c.name, data: await canvasData(S.Sel.canvas(c.sel)) }))),
    };
  };
  async function decode(url, w, h) {
    const img = await U.loadImage(url);
    const c = U.createCanvas(w, h); c.getContext('2d').drawImage(img, 0, 0);
    return c;
  }
  /** Decode a raster layer's PNG into a content-sized canvas at its document position */
  async function decodePixels(o, doc) {
    const img = await U.loadImage(o.pixels);
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (o.bounds) { const c = U.createCanvas(w, h, o.bounds.x, o.bounds.y); c.getContext('2d').drawImage(img, 0, 0); return c; }
    // legacy full-size layer: find the content and keep only that part
    const full = U.createCanvas(w, h); full.getContext('2d').drawImage(img, 0, 0);
    return S.Layers.trim(full);
  }
  async function deserializeLayer(o, doc) {
    const l = Object.assign(S.Layers.base(o.type, o.name), o);
    delete l.pixels; delete l.bounds; delete l.embed;
    l.locks = Object.assign({ pixels: false, position: false, alpha: false, all: false }, o.locks || {});
    if (o.type === 'raster') l.canvas = o.pixels ? await decodePixels(o, doc) : S.Layers.emptyCanvas();
    if (o.type === 'raster' && o.embed && o.embed.source) {
      const img = await U.loadImage(o.embed.source), b = o.embed.bounds || { x: 0, y: 0 };
      const sc = U.createCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height, b.x, b.y); sc.getContext('2d').drawImage(img, 0, 0);
      l.embed = { source: sc, matrix: o.embed.matrix || [1, 0, 0, 1, 0, 0], filters: o.embed.filters || [], version: 1 };
      if (o.embed.fmask && o.embed.fmask.data) { const fi = await U.loadImage(o.embed.fmask.data), fb = o.embed.fmask.bounds || { x: 0, y: 0 }; const fc = U.createCanvas(fi.naturalWidth || fi.width, fi.naturalHeight || fi.height, fb.x, fb.y); fc.getContext('2d').drawImage(fi, 0, 0); l.embed.fmask = S.Layers.maskFrom(fc, o.embed.fmask.outside); }
      l._ev = 1; // the saved pixels are the rendered result: no re-render needed until something changes
    }
    if (o.type !== 'raster' && o.type !== 'group' && o.type !== 'adjustment') l.canvas = U.createCanvas(1, 1);
    if (o.mask) {
      const props = { enabled: o.mask.enabled !== false, density: o.mask.density ?? 1, feather: o.mask.feather || 0, version: 1 };
      if (o.mask.outside != null) { // v2: sparse mask (data + bounds, or uniform)
        const m = S.Layers.newMask(doc, o.mask.outside); Object.assign(m, props);
        if (o.mask.data) { const img = await U.loadImage(o.mask.data), b = o.mask.bounds || { x: 0, y: 0 }; const c = U.createCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height, b.x, b.y); c.getContext('2d').drawImage(img, 0, 0); m.canvas = c; }
        l.mask = m;
      } else l.mask = S.Layers.sparseMask(await decode(o.mask.data, doc.width, doc.height), props); // v1: full-size PNG
    } else l.mask = null;
    if (o.children) l.children = await Promise.all(o.children.map((c) => deserializeLayer(c, doc)));
    l.version = 1; l._rv = -1;
    return l;
  }
  F.loadProject = async function (data, fallbackName, opts) {
    if (!data || (data.format !== 'kgesso' && data.format !== 'kstrata')) throw new Error('Not a Gesso project file');
    const d = new S.Document({ name: data.name || fallbackName, width: data.width, height: data.height, dpi: data.dpi });
    d.layers = await Promise.all((data.layers || []).map((o) => deserializeLayer(o, d)));
    d.guides = data.guides || [];
    d.paths = data.paths || [];
    d.activePathId = data.activePathId || null;
    d.comps = Array.isArray(data.comps) ? data.comps : []; d.activeCompId = data.activeCompId || null;
    d.anim = data.anim && Array.isArray(data.anim.frames) && data.anim.frames.length ? data.anim : null;
    if (data.selection) { const c = await decode(data.selection, d.width, d.height); d.selection = S.Sel.make(S.Sel.alphaOf(c), d.width, d.height); }
    for (const ch of data.alphaChannels || []) { const c = await decode(ch.data, d.width, d.height); const sel = S.Sel.make(S.Sel.alphaOf(c), d.width, d.height); if (sel) d.alphaChannels.push({ id: U.uid('ch'), name: ch.name, sel }); }
    const act = data.activeId && d.findLayer(data.activeId) ? data.activeId : d.layers.length ? d.layers[d.layers.length - 1].id : null;
    d.activeId = act; d.selectedIds = new Set(act ? [act] : []);
    if (!opts || !opts.noAdd) S.App.addDoc(d, 'Open Project');
    return d;
  };
  F.saveProject = async function (doc, saveAs) {
    if (!doc) return;
    S.App.commitSessions();
    // the contents document of an embedded object saves back into its parent instead of to a file
    if (doc.embedLink && !saveAs) { if (S.Embed.commitContents(doc)) return; }
    S.toast('Saving…', 900);
    const json = JSON.stringify(await F.serialize(doc));
    const blob = new Blob([json], { type: 'application/json' });
    const fname = doc.name.replace(/[\\/:*?"<>|]/g, '_') + '.kgesso';
    try {
      if (window.showSaveFilePicker) {
        let h = !saveAs && doc.fileHandle && /\.k(gesso|strata)$/i.test(doc.fileHandle.name) ? doc.fileHandle : null;
        if (!h) h = await window.showSaveFilePicker({ suggestedName: fname, types: [{ description: 'Gesso project', accept: { 'application/json': ['.kgesso', '.kstrata'] } }] });
        const w = await h.createWritable(); await w.write(blob); await w.close();
        doc.fileHandle = h; doc.name = h.name.replace(/\.k(gesso|strata)$/i, '');
        F.rememberHandle(h, h.name);
      } else U.downloadBlob(blob, fname);
    } catch (e) { if (e.name === 'AbortError') return; console.warn(e); U.downloadBlob(blob, fname); }
    doc.modified = false;
    doc.savedIndex = doc.history.index;
    F.addRecent(doc.name + '.kgesso');
    F.clearRecovery(doc);
    S.bus.emit('doc:renamed', doc);
    S.toast('Saved ' + doc.name + '.kgesso');
  };

  /* ---------------- export ---------------- */
  F.renderExport = function (doc, scale, bg) {
    S.Compositor.update(doc);
    const flat = S.Compositor.flatten(doc);
    const W = Math.max(1, Math.round(doc.width * scale)), H = Math.max(1, Math.round(doc.height * scale));
    let out = scale === 1 ? flat : S.Ops.resample(flat, W, H, 'bicubic');
    if (bg) { const c = U.createCanvas(W, H), x = c.getContext('2d'); x.fillStyle = bg; x.fillRect(0, 0, W, H); x.drawImage(out, 0, 0); out = c; }
    return out;
  };
  async function saveBlob(blob, name, mime, ext) {
    try {
      if (window.showSaveFilePicker) {
        const h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: ext.toUpperCase() + ' image', accept: { [mime]: ['.' + ext] } }] });
        const w = await h.createWritable(); await w.write(blob); await w.close();
        return true;
      }
    } catch (e) { if (e.name === 'AbortError') return false; console.warn(e); }
    U.downloadBlob(blob, name);
    return true;
  }
  F.quickExport = async function (doc) {
    const c = F.renderExport(doc, 1);
    const b = await U.canvasToBlob(c, 'image/png');
    if (await saveBlob(b, doc.name + '.png', 'image/png', 'png')) S.toast('Exported ' + doc.name + '.png');
  };
  F.exportDialog = function (doc) {
    const st = Object.assign({ format: 'png', quality: 90, scale: 100, matte: '#ffffff' }, S.store.get('export', {}));
    const name = U.el('input', { type: 'text', value: doc.name, style: { width: '100%' } });
    const size = U.el('div', { class: 'muted' });
    const prev = U.el('canvas', { class: 'export-preview checker' });
    const vals = st;
    const defs = [
      { id: 'format', label: 'Format', type: 'select', default: st.format, options: [{ value: 'png', label: 'PNG (lossless, transparency)' }, { value: 'jpeg', label: 'JPEG' }, { value: 'webp', label: 'WebP' }] },
      { id: 'quality', label: 'Quality', type: 'range', default: st.quality, min: 1, max: 100, unit: '%' },
      { id: 'scale', label: 'Scale', type: 'range', default: st.scale, min: 1, max: 400, unit: '%' },
      { id: 'matte', label: 'JPEG matte', type: 'color', default: st.matte },
    ];
    let estTimer = null;
    const update = () => {
      const W = Math.round(doc.width * vals.scale / 100), H = Math.round(doc.height * vals.scale / 100);
      size.textContent = W + ' × ' + H + ' px · estimating…';
      clearTimeout(estTimer);
      estTimer = setTimeout(async () => {
        const c = F.renderExport(doc, vals.scale / 100, vals.format === 'jpeg' ? vals.matte : null);
        const b = await U.canvasToBlob(c, 'image/' + vals.format, vals.quality / 100);
        size.textContent = W + ' × ' + H + ' px · ≈ ' + (b.size > 1048576 ? (b.size / 1048576).toFixed(2) + ' MB' : Math.round(b.size / 1024) + ' KB');
        const k = Math.min(1, 300 / Math.max(c.width, c.height));
        prev.width = Math.max(1, c.width * k); prev.height = Math.max(1, c.height * k);
        prev.getContext('2d').drawImage(c, 0, 0, prev.width, prev.height);
      }, 250);
    };
    const ui = S.ParamUI.build(defs, vals, (v) => { Object.assign(vals, v); update(); });
    // ---- export presets: several sizes / formats in one go ----
    const presets = F.exportPresets();
    const presetSel = U.el('select', { style: { flex: 1 } });
    const renderPresetSel = (sel) => { presetSel.innerHTML = ''; presets.forEach((p, i) => presetSel.appendChild(U.el('option', { value: i }, p.name + ' (' + p.items.length + ' files)'))); const i = sel != null ? sel : S.store.get('export.preset', 0); presetSel.value = String(Math.min(presets.length - 1, Math.max(0, i))); S.store.set('export.preset', +presetSel.value); };
    renderPresetSel();
    const presetInfo = U.el('div', { class: 'muted export-preset-info' });
    const showPreset = () => { const p = presets[+presetSel.value]; presetInfo.textContent = p ? p.items.map((it) => (it.suffix || '') + '.' + (it.format === 'jpeg' ? 'jpg' : it.format) + ' @' + it.scale + '%').join('  ·  ') : ''; };
    presetSel.addEventListener('change', () => { S.store.set('export.preset', +presetSel.value); showPreset(); });
    showPreset();
    const addBtn = U.el('button', { class: 'btn btn-sm', title: 'Save the settings above as a new file in the selected preset' }, '+ Add current');
    addBtn.addEventListener('click', async () => {
      const p = presets[+presetSel.value]; if (!p) return;
      const suffix = await S.Dialog.prompt('File name suffix for this size (e.g. @2x)', vals.scale === 100 ? '' : '@' + Math.round(vals.scale) + 'pct', 'Add to preset');
      if (suffix == null) return;
      p.items.push({ suffix, scale: vals.scale, format: vals.format, quality: vals.quality }); F.saveExportPresets(presets); renderPresetSel(+presetSel.value); showPreset();
    });
    const newBtn = U.el('button', { class: 'btn btn-sm' }, 'New preset…');
    newBtn.addEventListener('click', async () => { const n = await S.Dialog.prompt('Preset name', 'My export set', 'New Export Preset'); if (!n) return; presets.push({ name: n, items: [{ suffix: '', scale: vals.scale, format: vals.format, quality: vals.quality }] }); F.saveExportPresets(presets); renderPresetSel(presets.length - 1); showPreset(); });
    const delBtn = U.el('button', { class: 'btn btn-sm ghost' }, 'Delete');
    delBtn.addEventListener('click', () => { if (presets.length <= 1) { S.toast('Keep at least one preset'); return; } presets.splice(+presetSel.value, 1); F.saveExportPresets(presets); renderPresetSel(0); showPreset(); });
    const presetBox = U.el('div', { class: 'export-presets' }, [U.el('div', { class: 'param-header' }, 'Batch export'), U.el('div', { class: 'row' }, [presetSel, newBtn, delBtn]), presetInfo, U.el('div', { class: 'row' }, [addBtn])]);
    const body = U.el('div', { class: 'export-body' }, [U.el('div', { class: 'export-left' }, [prev]), U.el('div', { class: 'export-right' }, [U.el('label', { class: 'muted' }, 'File name'), name, ui, size, presetBox])]);
    S.Dialog.open({ title: 'Export As', body, width: 680, footLeft: U.el('span', { class: 'muted' }, 'Files are exported in sRGB (the canvas working space); no colour profile is embedded.'), buttons: [{ label: 'Cancel' },
      { label: 'Export Preset', run: () => { S.store.set('export', vals); const p = presets[+presetSel.value]; if (p) F.exportBatch(doc, name.value || doc.name, p.items, vals.matte); }, ok: true },
      { label: 'Export', primary: true, run: () => {
      S.store.set('export', vals);
      (async () => {
        const c = F.renderExport(doc, vals.scale / 100, vals.format === 'jpeg' ? vals.matte : null);
        const mime = 'image/' + vals.format, ext = vals.format === 'jpeg' ? 'jpg' : vals.format;
        const b = await U.canvasToBlob(c, mime, vals.quality / 100);
        if (await saveBlob(b, (name.value || doc.name) + '.' + ext, mime, ext)) S.toast('Exported ' + (name.value || doc.name) + '.' + ext);
      })();
    } }] });
    update();
  };
  F.DEFAULT_PRESETS = [
    { name: 'Web 1× / 2× / 3× PNG + JPEG', items: [{ suffix: '', scale: 100, format: 'png', quality: 90 }, { suffix: '@2x', scale: 200, format: 'png', quality: 90 }, { suffix: '@3x', scale: 300, format: 'png', quality: 90 }, { suffix: '', scale: 100, format: 'jpeg', quality: 85 }] },
    { name: 'Thumbnail + full JPEG', items: [{ suffix: '-thumb', scale: 25, format: 'jpeg', quality: 80 }, { suffix: '', scale: 100, format: 'jpeg', quality: 90 }] },
  ];
  F.exportPresets = () => { const p = S.store.get('export.presets', null); return Array.isArray(p) && p.length ? p : JSON.parse(JSON.stringify(F.DEFAULT_PRESETS)); };
  F.saveExportPresets = (p) => S.store.set('export.presets', p);
  /** Export every item of a preset.  With the File System Access API the files go into one chosen folder; otherwise they download one by one. */
  F.exportBatch = async function (doc, base, items, matte) {
    let dir = null;
    if (window.showDirectoryPicker) { try { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch (e) { if (e.name === 'AbortError') return; dir = null; } }
    let n = 0;
    for (const it of items) {
      const mime = 'image/' + it.format, ext = it.format === 'jpeg' ? 'jpg' : it.format;
      const c = F.renderExport(doc, it.scale / 100, it.format === 'jpeg' ? matte || '#ffffff' : null);
      const blob = await U.canvasToBlob(c, mime, (it.quality || 90) / 100);
      const fname = base + (it.suffix || '') + '.' + ext;
      try {
        if (dir) { const h = await dir.getFileHandle(fname, { create: true }); const w = await h.createWritable(); await w.write(blob); await w.close(); }
        else { U.downloadBlob(blob, fname); await new Promise((r) => setTimeout(r, 250)); }
        n++;
      } catch (e) { console.warn(e); S.toast('Could not write ' + fname); }
    }
    S.toast('Exported ' + n + ' file' + (n === 1 ? '' : 's') + (dir ? ' to the chosen folder' : ''));
  };
  F.print = function (doc) {
    const c = F.renderExport(doc, 1);
    const url = c.toDataURL('image/png');
    const w = window.open('', '_blank');
    if (!w) { S.toast('Pop-up blocked — allow pop-ups to print'); return; }
    w.document.write('<title>' + doc.name + '</title><style>html,body{margin:0}img{max-width:100%;max-height:100vh;display:block;margin:auto}</style><img src="' + url + '" onload="setTimeout(()=>print(),200)">');
    w.document.close();
  };

  /* ---------------- recent files ---------------- */
  F.addRecent = function (name) {
    const r = S.store.get('recent', []).filter((x) => x.name !== name);
    r.unshift({ name, time: Date.now() });
    S.store.set('recent', r.slice(0, 12));
    S.bus.emit('recent:changed');
  };
  F.rememberHandle = function (h, name) { idb('handles', 'readwrite', (st) => st.put(h, name)).catch(() => {}); };
  F.openRecent = async function (name) {
    try {
      const h = await idb('handles', 'readonly', (st) => st.get(name));
      if (h && h.queryPermission) {
        let p = await h.queryPermission({ mode: 'read' });
        if (p !== 'granted') p = await h.requestPermission({ mode: 'read' });
        if (p === 'granted') { await F.openFile(await h.getFile(), { handle: h }); return; }
      }
    } catch (e) { console.warn(e); }
    S.toast('“' + name + '” can’t be reopened automatically — choose it in the Open dialog');
    F.open();
  };

  /* ---------------- autosave / recovery ---------------- */
  F.autosave = async function () {
    for (const d of S.app.docs) {
      if (!d.modified || d._autosaving) continue;
      if (d.history.index === d._autosavedIndex) continue;
      d._autosaving = true;
      try {
        const data = await F.serialize(d);
        await idb('recovery', 'readwrite', (st) => st.put({ name: d.name, time: Date.now(), json: JSON.stringify(data) }, d.id));
        d._autosavedIndex = d.history.index;
      } catch (e) { console.warn('autosave failed', e); }
      d._autosaving = false;
    }
  };
  F.clearRecovery = function (doc) { idb('recovery', 'readwrite', (st) => st.delete(doc.id)).catch(() => {}); };
  F.checkRecovery = async function () {
    let items = [];
    try {
      const keys = await idb('recovery', 'readonly', (st) => st.getAllKeys());
      const vals = await idb('recovery', 'readonly', (st) => st.getAll());
      items = (keys || []).map((k, i) => ({ key: k, ...vals[i] }));
    } catch (e) { return; }
    if (!items.length) return;
    const list = U.el('div', { class: 'recovery-list' }, items.map((it) => U.el('label', { class: 'check-row' }, [U.el('input', { type: 'checkbox', checked: true, value: it.key }), U.el('span', {}, it.name + ' — ' + new Date(it.time).toLocaleString())])));
    S.Dialog.open({ title: 'Recover unsaved work?', body: U.el('div', {}, [U.el('div', { class: 'dlg-msg', style: { marginBottom: '10px' } }, 'Gesso found documents that were not saved before the last session ended.'), list]),
      buttons: [
        { label: 'Discard', cls: 'danger', run: () => { items.forEach((it) => idb('recovery', 'readwrite', (st) => st.delete(it.key))); } },
        { label: 'Recover', primary: true, run: async () => {
          const chosen = [...list.querySelectorAll('input:checked')].map((i) => i.value);
          for (const it of items) {
            if (chosen.includes(it.key)) { try { const d = await F.loadProject(JSON.parse(it.json), it.name); d.name = it.name + ' (recovered)'; d.modified = true; S.bus.emit('doc:renamed', d); } catch (e) { console.warn(e); } }
            idb('recovery', 'readwrite', (st) => st.delete(it.key));
          }
        } }] });
  };

  /* ======================= Clipboard ======================= */
  const Clip = (S.Clip = { data: null });
  Clip.copy = async function (merged, cut) {
    const doc = S.app.doc; if (!doc) return;
    const res = S.Ops.copyPixels(doc, merged);
    if (!res) { S.toast('Nothing to copy'); return; }
    Clip.data = { canvas: res.canvas, x: res.x, y: res.y, w: res.canvas.width, h: res.canvas.height, time: Date.now() };
    if (cut) S.Ops.clearSelection(doc);
    S.toast((cut ? 'Cut ' : 'Copied ') + res.canvas.width + ' × ' + res.canvas.height + ' px', 1000);
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const blob = await U.canvasToBlob(res.canvas, 'image/png');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        Clip.data.system = true;
      }
    } catch (e) { /* system clipboard not available (e.g. permissions) */ }
  };
  /** Paste from internal clipboard */
  Clip.pasteInternal = function (inPlace, newDoc) {
    const c = Clip.data;
    if (!c) { S.toast('Clipboard is empty'); return; }
    if (newDoc || !S.app.doc) { const d = F.docFromImage(c.canvas, 'Pasted'); return d; }
    F.placeImage(S.app.doc, c.canvas, 'Pasted Layer', inPlace ? c.x : null, inPlace ? c.y : null);
  };
  /** Handle a paste event (Ctrl+V): prefer system clipboard images, fall back to internal */
  Clip.handlePaste = async function (e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const items = e.clipboardData ? [...e.clipboardData.items] : [];
    const imgItem = items.find((i) => i.type.startsWith('image/'));
    e.preventDefault();
    if (imgItem) {
      const file = imgItem.getAsFile();
      const url = URL.createObjectURL(file);
      try {
        const img = await U.loadImage(url);
        // if it matches what we copied ourselves, use the internal copy (keeps position)
        if (Clip.data && Clip.data.w === img.width && Clip.data.h === img.height) { Clip.pasteInternal(false); return; }
        if (!S.app.doc) F.docFromImage(img, 'Pasted Image');
        else F.placeImage(S.app.doc, img, 'Pasted Layer');
      } finally { URL.revokeObjectURL(url); }
      return;
    }
    const text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (Clip.data) { Clip.pasteInternal(false); return; }
    if (text && S.app.doc) {
      const d = S.app.doc, o = S.Tools.byId.text.opts;
      S.addLayer(S.Layers.text(d, { text: text.slice(0, 5000), x: d.width * 0.1, y: d.height * 0.1, font: o.font, size: o.size, color: S.app.fg }), 'Paste Text');
      return;
    }
    S.toast('Clipboard has no image');
  };
  Clip.pasteFromMenu = async function () {
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const it of items) {
          const type = it.types.find((t) => t.startsWith('image/'));
          if (type) {
            const blob = await it.getType(type);
            const img = await U.loadImage(URL.createObjectURL(blob));
            if (Clip.data && Clip.data.w === img.width && Clip.data.h === img.height) { Clip.pasteInternal(false); return; }
            if (!S.app.doc) F.docFromImage(img, 'Pasted Image'); else F.placeImage(S.app.doc, img, 'Pasted Layer');
            return;
          }
        }
      }
    } catch (e) { /* fall through to internal */ }
    Clip.pasteInternal(false);
  };
})();
