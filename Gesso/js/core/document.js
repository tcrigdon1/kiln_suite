/* =========================================================================
   Gesso — Document model + History (undo/redo)

   History has two entry kinds:
   • 'state'  – snapshot of document structure (layer tree metadata, selection,
                guides, paths, size).  Canvases are shared by reference, so any
                operation that changes pixels wholesale must SWAP in new canvases
                rather than mutate the old ones (see doc.replaceCanvas).
   • 'pixels' – a rectangular before/after ImageData patch on one canvas
                (brush strokes, fills, filters).  Entries are applied strictly in
                order, so in-place pixel patches and state snapshots stay consistent.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util;

  /* ======================= History ======================= */
  class History {
    constructor(doc) {
      this.doc = doc;
      this.entries = [];
      this.index = -1;
    }
    get max() { return (S.app.prefs && S.app.prefs.historySteps) || 60; }
    push(entry) {
      entry.time = Date.now();
      this.entries.length = this.index + 1;
      this.entries.push(entry);
      this.index = this.entries.length - 1;
      this.trim();
      this.doc.modified = true;
      S.bus.emit('history:changed', this.doc);
    }
    trim() {
      const maxBytes = ((S.app.prefs && S.app.prefs.historyMB) || 600) * 1048576;
      let bytes = this.entries.reduce((a, e) => a + (e.bytes || 0), 0);
      while (this.entries.length > 2 && (this.entries.length > this.max + 1 || bytes > maxBytes)) {
        // drop the oldest undoable entry; entry 0 is the base ("New"/"Open") marker
        const e = this.entries.splice(1, 1)[0];
        bytes -= e.bytes || 0;
        this.index--;
      }
    }
    get canUndo() { return this.index > 0; }
    get canRedo() { return this.index < this.entries.length - 1; }
    undo() {
      if (!this.canUndo) return false;
      const e = this.entries[this.index], sz = this.size();
      e.undo();
      this.index--;
      this.after(sz);
      return e.name;
    }
    redo() {
      if (!this.canRedo) return false;
      const e = this.entries[this.index + 1], sz = this.size();
      e.redo();
      this.index++;
      this.after(sz);
      return e.name;
    }
    jumpTo(i) {
      const sz = this.size();
      while (this.index > i && this.canUndo) { this.entries[this.index].undo(); this.index--; }
      while (this.index < i && this.canRedo) { this.entries[this.index + 1].redo(); this.index++; }
      this.after(sz);
    }
    size() { return this.doc.width + 'x' + this.doc.height; }
    after(prevSize) {
      this.doc.invalidate();
      this.doc.modified = true;
      S.bus.emit('history:changed', this.doc);
      S.bus.emit('layers:changed', this.doc);
      S.bus.emit('selection:changed', this.doc);
      // undoing / redoing a crop, canvas size, image size or canvas rotation: refit the view like the command did
      if (prevSize && prevSize !== this.size() && this.doc === S.app.doc) { if (S.View && S.View.fit) S.View.fit(this.doc, false); S.bus.emit('doc:resized', this.doc); }
    }
    /** Last entry, if it is the newest and was pushed with the same coalesce key recently */
    coalesceTarget(key) {
      const e = this.entries[this.index];
      if (key && e && e.key === key && this.index === this.entries.length - 1 && Date.now() - e.time < 2500) return e;
      return null;
    }
  }
  S.History = History;

  /* ======================= Document ======================= */
  let docCounter = 1;
  class Document {
    constructor(opts) {
      opts = opts || {};
      this.id = U.uid('doc');
      this.name = opts.name || 'Untitled-' + docCounter++;
      this.width = Math.max(1, Math.round(opts.width || 1920));
      this.height = Math.max(1, Math.round(opts.height || 1080));
      this.dpi = opts.dpi || 72;
      this.layers = [];
      this.selection = null;
      this.lastSelection = null;
      this.guides = [];
      this.paths = [];
      this.alphaChannels = []; // saved selections: [{id, name, sel}] (sel objects are immutable)
      this.snapshots = [];
      this.comps = []; this.activeCompId = null;
      this.activePathId = null;
      this.activeId = null;
      this.selectedIds = new Set();
      this.view = { zoom: 1, panX: 0, panY: 0, rot: 0, needsFit: true };
      this.history = new History(this);
      this.composite = null;
      this._dirty = null;
      this.quickMask = null;
      this.maskView = null;
      this.channelView = 'rgb';
      this.modified = false;
      this.fileHandle = null;
    }

    /* ---------- rendering ---------- */
    invalidate(rect) {
      const full = { x: 0, y: 0, w: this.width, h: this.height };
      this._dirty = rect ? U.rectUnion(this._dirty, rect) : full;
      if (S.app.requestRender) S.app.requestRender();
    }
    bump(layer, rect) {
      if (layer) { layer.version = (layer.version || 0) + 1; layer._thumbDirty = true; }
      // effects or masks extend beyond painted rect, so invalidate fully when present
      if (layer && (S.Effects.active(layer) || (layer.mask && layer.mask.feather > 0))) rect = null;
      this.invalidate(rect);
    }

    /* ---------- layer tree ---------- */
    walk(fn, list = this.layers, parent = null, depth = 0) {
      for (let i = 0; i < list.length; i++) {
        const l = list[i];
        if (fn(l, parent, i, list, depth) === false) return false;
        if (l.children && this.walk(fn, l.children, l, depth + 1) === false) return false;
      }
    }
    findLayer(id) { let f = null; if (!id) return null; this.walk((l) => { if (l.id === id) { f = l; return false; } }); return f; }
    parentInfo(id) {
      let info = null;
      this.walk((l, parent, i, list) => { if (l.id === id) { info = { parent, index: i, list }; return false; } });
      return info;
    }
    /** All layers depth-first in top-to-bottom visual order (as shown in Layers panel) */
    flatTopDown() {
      const out = [];
      const rec = (list, depth) => { for (let i = list.length - 1; i >= 0; i--) { out.push({ layer: list[i], depth }); if (list[i].children) rec(list[i].children, depth + 1); } };
      rec(this.layers, 0);
      return out;
    }
    allLayers() { const a = []; this.walk((l) => a.push(l)); return a; }
    activeLayer() { return this.findLayer(this.activeId); }
    selectedLayers() {
      const a = []; this.walk((l) => { if (this.selectedIds.has(l.id)) a.push(l); });
      if (!a.length && this.activeLayer()) a.push(this.activeLayer());
      return a;
    }
    setActive(id, mode) {
      if (mode === 'toggle') {
        if (this.selectedIds.has(id) && this.selectedIds.size > 1) { this.selectedIds.delete(id); if (this.activeId === id) this.activeId = [...this.selectedIds][0]; }
        else { this.selectedIds.add(id); this.activeId = id; }
      } else if (mode === 'range' && this.activeId) {
        const flat = this.flatTopDown().map((f) => f.layer.id);
        const a = flat.indexOf(this.activeId), b = flat.indexOf(id);
        this.selectedIds = new Set(flat.slice(Math.min(a, b), Math.max(a, b) + 1));
      } else {
        this.activeId = id;
        this.selectedIds = new Set(id ? [id] : []);
      }
      const l = this.findLayer(this.activeId);
      if (l && !l.mask) l.editMask = false;
      S.bus.emit('layers:changed', this);
      S.bus.emit('activeLayer:changed', this);
    }
    /** Insert above the reference layer (default: active layer), at the same tree level */
    insertLayer(layer, refId, where = 'above') {
      refId = refId === undefined ? this.activeId : refId;
      const ref = refId && this.parentInfo(refId);
      if (where === 'inside') {
        const g = this.findLayer(refId);
        if (g && g.children) { g.children.push(layer); return layer; }
      }
      if (ref) ref.list.splice(where === 'below' ? ref.index : ref.index + 1, 0, layer);
      else this.layers.push(layer);
      return layer;
    }
    removeLayer(id) {
      const info = this.parentInfo(id);
      if (!info) return null;
      return info.list.splice(info.index, 1)[0];
    }
    isDescendant(id, ancestorId) {
      const a = this.findLayer(ancestorId);
      if (!a || !a.children) return false;
      let found = false;
      this.walk((l) => { if (l.id === id) { found = true; return false; } }, a.children);
      return found;
    }

    /* ---------- history helpers ---------- */
    captureState() {
      return {
        width: this.width, height: this.height,
        layers: this.layers.map(S.Layers.cloneMeta),
        selection: this.selection, activeId: this.activeId, selectedIds: [...this.selectedIds],
        guides: this.guides.map((g) => ({ ...g })),
        paths: JSON.parse(JSON.stringify(this.paths)), activePathId: this.activePathId,
        quickMask: this.quickMask,
        alphaChannels: this.alphaChannels.slice(),
        comps: this.comps || [], activeCompId: this.activeCompId || null,
        anim: this.anim && this.anim.frames ? { frames: this.anim.frames.map((f) => ({ ...f })), current: this.anim.current, loop: this.anim.loop } : null,
      };
    }
    /** everything about a layer (apart from its id) that caches key on; canvases by identity */
    static metaSig(l) {
      return JSON.stringify([l.type, l.visible, l.opacity, l.fillOpacity, l.blend, l.clip, l.locks, l.effects, l.text, l.shape, l.fill, l.adj, l.blendIf || null,
        l.mask ? [l.mask.enabled, l.mask.density, l.mask.feather, l.mask.outside] : null]);
    }
    restoreState(st) {
      // layers that are unchanged (same canvases, same settings) keep their version and caches: an undo of a
      // selection change must not force 150 layers to re-render their effects and thumbnails
      const live = new Map();
      this.walk((l) => live.set(l.id, l));
      this.width = st.width; this.height = st.height;
      this.layers = st.layers.map(S.Layers.cloneMeta);
      this.walk((l) => {
        const o = live.get(l.id);
        const same = o && o.canvas === l.canvas && (o.mask ? l.mask && o.mask.canvas === l.mask.canvas : !l.mask) && Document.metaSig(o) === Document.metaSig(l);
        if (same) {
          l.version = o.version; l._rv = o._rv; l._rsz = o._rsz; l._cb = o._cb; l._cbKey = o._cbKey;
          if (o._fxCache) l._fxCache = o._fxCache;
          for (const k in o) if (k.startsWith('_th_')) l[k] = o[k];
        } else { l._rv = -1; l.version = Math.max(l.version || 0, o ? o.version || 0 : 0) + 1; l._thumbDirty = true; }
      });
      this._layerCountDirty = true;
      this.selection = st.selection;
      this.activeId = st.activeId; this.selectedIds = new Set(st.selectedIds);
      this.guides = st.guides.map((g) => ({ ...g }));
      this.paths = JSON.parse(JSON.stringify(st.paths)); this.activePathId = st.activePathId;
      this.quickMask = st.quickMask;
      this.alphaChannels = (st.alphaChannels || []).slice();
      this.comps = st.comps || []; this.activeCompId = st.activeCompId || null;
      this.anim = st.anim && st.anim.frames ? { frames: st.anim.frames.map((f) => ({ ...f })), current: st.anim.current, loop: st.anim.loop } : null;
      this.composite = null;
      this.invalidate();
    }
    /**
     * Run fn() and record an undoable structural step.
     * opts.key: coalesce consecutive steps with the same key (slider drags).
     */
    commit(name, fn, opts) {
      opts = opts || {};
      const target = opts.key ? this.history.coalesceTarget(opts.key) : null;
      const before = target ? null : this.captureState();
      let result;
      try { result = fn(); } catch (e) { console.error(e); S.toast('Error: ' + e.message); if (before) this.restoreState(before); return; }
      if (result === false) return false;
      const after = this.captureState();
      if (target) { target.after = after; target.time = Date.now(); }
      else {
        const doc = this;
        this.history.push({ type: 'state', name, key: opts.key, before, after, bytes: Document.stateBytes(before, after),
          undo() { doc.restoreState(this.before); }, redo() { doc.restoreState(this.after); } });
      }
      this._layerCountDirty = true;
      this.invalidate();
      S.bus.emit('layers:changed', this);
      if (opts.selection !== false) S.bus.emit('selection:changed', this);
      return result;
    }
    /** Estimated pixel memory a state entry keeps alive: canvases in `after` that `before` does not reference */
    static stateBytes(before, after) {
      const seen = new Set();
      const collect = (list) => list.forEach((l) => { if (l.canvas) seen.add(l.canvas); if (l.mask) seen.add(l.mask.canvas); if (l.children) collect(l.children); });
      collect(before.layers);
      let b = 0;
      const count = (list) => list.forEach((l) => { if (l.canvas && !seen.has(l.canvas)) b += l.canvas.width * l.canvas.height * 4; if (l.mask && !seen.has(l.mask.canvas)) b += l.mask.canvas.width * l.mask.canvas.height * 4; if (l.children) count(l.children); });
      count(after.layers);
      return b;
    }
    /** Snapshots: full copies (including pixels) that can be restored later */
    deepState() {
      const st = this.captureState();
      const cloneTree = (list) => list.forEach((l) => {
        if (l.canvas && l.type === 'raster') l.canvas = U.cloneCanvas(l.canvas);
        if (l.mask) l.mask = { ...l.mask, canvas: U.cloneCanvas(l.mask.canvas) };
        if (l.children) cloneTree(l.children);
      });
      cloneTree(st.layers);
      if (st.quickMask) st.quickMask = { ...st.quickMask, canvas: U.cloneCanvas(st.quickMask.canvas) };
      return st;
    }
    makeSnapshot(name) {
      const snap = { id: U.uid('snap'), name: name || 'Snapshot ' + (this.snapshots.length + 1), state: this.deepState(), time: Date.now() };
      this.snapshots.push(snap);
      S.bus.emit('history:changed', this);
      return snap;
    }
    restoreSnapshot(id) {
      const snap = this.snapshots.find((x) => x.id === id);
      if (!snap) return;
      // restore from a fresh copy so the snapshot stays pristine
      const tmp = { ...snap.state, layers: snap.state.layers.map(S.Layers.cloneMeta) };
      const cloneTree = (list) => list.forEach((l) => {
        if (l.canvas && l.type === 'raster') l.canvas = U.cloneCanvas(l.canvas);
        if (l.mask) l.mask = { ...l.mask, canvas: U.cloneCanvas(l.mask.canvas) };
        if (l.children) cloneTree(l.children);
      });
      cloneTree(tmp.layers);
      this.commit('Restore ' + snap.name, () => this.restoreState(tmp));
    }
    /** Push a state entry using a state captured earlier (for interactive operations) */
    pushState(name, before) {
      const after = this.captureState(), doc = this;
      this.history.push({ type: 'state', name, before, after, bytes: Document.stateBytes(before, after), undo() { doc.restoreState(this.before); }, redo() { doc.restoreState(this.after); } });
      this._layerCountDirty = true;
      this.invalidate();
      S.bus.emit('layers:changed', this);
      S.bus.emit('selection:changed', this);
    }
    /** Canvas being painted by brushes for the active layer: pixels, layer mask, or quick mask */
    /**
     * Canvas being painted by brushes for the active layer: pixels, layer mask, or quick mask.
     * Mask targets carry `outside` (the mask's implicit value beyond its canvas) — readers use
     * Layers.readRect(canvas, r, outside) / writeRect(canvas, img, r, outside).
     */
    paintTarget() {
      if (this.quickMask) return { kind: 'quickmask', canvas: this.quickMask.canvas, layer: null, outside: 0 };
      const l = this.activeLayer();
      if (!l) return null;
      // adjustment & fill layers have no pixels of their own: brushes edit their mask
      if (l.mask && (l.editMask || l.type === 'adjustment' || l.type === 'fill')) return { kind: 'mask', canvas: l.mask.canvas, layer: l, outside: S.Layers.maskOutside(l.mask) };
      if (l.type === 'raster') return { kind: 'pixels', canvas: l.canvas, layer: l, outside: 0 };
      return { kind: 'invalid', layer: l };
    }
    /** Begin a pixel edit on a canvas; returns an object with end(name, rect).  rect is in document space. */
    beginPixelEdit(target) {
      const snap = U.cloneCanvas(target.canvas);
      const doc = this;
      const layerId = target.layer ? target.layer.id : null, kind = target.kind, fill = target.outside || 0;
      return {
        snapshot: snap, outside: fill,
        end(name, rect) {
          const canvasNow = doc._resolveCanvas(kind, layerId);
          if (!canvasNow) return;
          let r = rect ? U.rectRound(rect) : U.rectUnion(U.rectUnion(U.rectOf(snap), U.rectOf(canvasNow)), { x: 0, y: 0, w: doc.width, h: doc.height });
          if (!r) return;
          // only the part that touches either canvas can have changed
          const cover = U.rectUnion(U.rectOf(snap), U.rectOf(canvasNow));
          r = U.rectIntersect(r, cover); if (!r) return;
          const before = S.Layers.readRect(snap, r, fill);
          const after = S.Layers.readRect(canvasNow, r, fill);
          doc.pushPixelEntry(name, kind, layerId, r, before, after);
        },
      };
    }
    _resolveCanvas(kind, layerId) {
      if (kind === 'quickmask') return this.quickMask && this.quickMask.canvas;
      const l = this.findLayer(layerId);
      if (!l) return null;
      return kind === 'mask' ? l.mask && l.mask.canvas : l.canvas;
    }
    pushPixelEntry(name, kind, layerId, r, before, after) {
      const doc = this;
      const apply = (img) => {
        const c = doc._resolveCanvas(kind, layerId);
        if (!c) return;
        const l = doc.findLayer(layerId);
        S.Layers.writeRect(c, img, r, kind === 'mask' && l ? S.Layers.maskOutside(l.mask) : 0);
        // a large patch (whole-layer filter) may have grown the canvas: keep it compact
        if (l && r.w * r.h >= 0.25 * c.width * c.height) { if (kind === 'mask') S.Layers.trimMask(l.mask); else if (kind === 'pixels') S.Layers.trimInPlace(c); }
        if (l) { l.version++; l._thumbDirty = true; if (kind === 'mask') l.mask.version = (l.mask.version || 0) + 1; }
      };
      this.history.push({ type: 'pixels', name, bytes: before.data.length * 2, undo() { apply(before); }, redo() { apply(after); } });
    }
    /** Replace a raster layer's canvas (undoable via commit snapshot) */
    replaceCanvas(layer, canvas) { layer.canvas = canvas; layer.version++; layer._thumbDirty = true; }
    setSelection(sel, name) {
      this.commit(name || (sel ? 'Selection' : 'Deselect'), () => {
        if (this.selection) this.lastSelection = this.selection;
        this.selection = sel;
      });
      S.bus.emit('selection:changed', this);
    }
  }
  S.Document = Document;
})();
