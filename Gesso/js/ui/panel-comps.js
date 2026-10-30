/* =========================================================================
   Gesso — Layer Comps: named snapshots of each layer's visibility, position, appearance (opacity, fill,
   blend) and effects.  Switching comps is undoable; comps are saved in the project and can all be exported
   as separate files (File ▸ Export ▸ Export Layer Comps…).
   doc.comps = [{ id, name, layers: { [layerId]: { visible, opacity, fillOpacity, blend, effects, pos } } }]
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util, P = S.Panels;
  const CM = (S.Comps = {});

  /** position record of a layer (type specific) */
  function posOf(l) {
    if (l.type === 'raster') return { kind: 'raster', ox: l.canvas.ox || 0, oy: l.canvas.oy || 0, mox: l.mask ? l.mask.canvas.ox || 0 : 0, moy: l.mask ? l.mask.canvas.oy || 0 : 0, em: l.embed ? l.embed.matrix.slice() : null };
    if (l.type === 'text') return { kind: 'text', x: l.text.x, y: l.text.y, matrix: l.text.matrix ? l.text.matrix.slice() : null };
    if (l.type === 'shape') return { kind: 'shape', shape: JSON.parse(JSON.stringify(l.shape)) };
    if (l.type === 'fill') return { kind: 'fill', ox: l.fill.ox || 0, oy: l.fill.oy || 0 };
    return null;
  }
  CM.capture = function (doc, opts) {
    opts = Object.assign({ visibility: true, position: true, appearance: true }, opts || {});
    const layers = {};
    doc.walk((l) => {
      const r = {};
      if (opts.visibility) r.visible = !!l.visible;
      if (opts.appearance) { r.opacity = l.opacity; r.fillOpacity = l.fillOpacity ?? 1; r.blend = l.blend; r.effects = l.effects ? JSON.parse(JSON.stringify(l.effects)) : null; r.clip = !!l.clip; }
      if (opts.position) r.pos = posOf(l);
      layers[l.id] = r;
    });
    return { layers, opts };
  };
  /** apply a comp's records to the live layers (inside a commit) */
  CM.applyRecords = function (doc, comp) {
    doc.walk((l) => {
      const r = comp.layers[l.id]; if (!r) return;
      if (r.visible != null) l.visible = r.visible;
      if (r.opacity != null) { l.opacity = r.opacity; l.fillOpacity = r.fillOpacity; l.blend = r.blend; l.effects = r.effects ? JSON.parse(JSON.stringify(r.effects)) : null; l.clip = !!r.clip; }
      const p = r.pos;
      if (p && p.kind === l.type) {
        if (p.kind === 'raster') {
          if ((l.canvas.ox || 0) !== p.ox || (l.canvas.oy || 0) !== p.oy) { const c = U.cloneCanvas(l.canvas); c.ox = p.ox; c.oy = p.oy; l.canvas = c; }
          if (l.mask && ((l.mask.canvas.ox || 0) !== p.mox || (l.mask.canvas.oy || 0) !== p.moy)) { const mc = U.cloneCanvas(l.mask.canvas); mc.ox = p.mox; mc.oy = p.moy; l.mask = { ...l.mask, canvas: mc, version: (l.mask.version || 0) + 1 }; }
          if (l.embed && p.em) { l.embed = { ...l.embed, matrix: p.em.slice() }; l._ev = l.embed.version; }
        } else if (p.kind === 'text') { l.text.x = p.x; l.text.y = p.y; l.text.matrix = p.matrix ? p.matrix.slice() : null; }
        else if (p.kind === 'shape') l.shape = JSON.parse(JSON.stringify(p.shape));
        else if (p.kind === 'fill') { l.fill.ox = p.ox; l.fill.oy = p.oy; }
      }
      l.version++; l._rv = -1; l._thumbDirty = true;
    });
  };
  CM.add = function (doc, name, opts) {
    const comp = Object.assign({ id: U.uid('comp'), name: name || 'Comp ' + ((doc.comps || []).length + 1) }, CM.capture(doc, opts));
    doc.commit('New Layer Comp', () => { doc.comps = (doc.comps || []).concat([comp]); doc.activeCompId = comp.id; });
    S.bus.emit('comps:changed', doc);
    return comp;
  };
  CM.apply = function (doc, id) {
    const comp = (doc.comps || []).find((c) => c.id === id); if (!comp) return;
    doc.commit('Apply Layer Comp', () => { CM.applyRecords(doc, comp); doc.activeCompId = id; });
    S.bus.emit('comps:changed', doc); S.bus.emit('activeLayer:changed', doc);
  };
  CM.update = function (doc, id) {
    const i = (doc.comps || []).findIndex((c) => c.id === id); if (i < 0) return;
    doc.commit('Update Layer Comp', () => { const old = doc.comps[i]; doc.comps = doc.comps.slice(); doc.comps[i] = Object.assign({ id: old.id, name: old.name }, CM.capture(doc, old.opts)); doc.activeCompId = id; });
    S.bus.emit('comps:changed', doc);
  };
  CM.remove = function (doc, id) {
    doc.commit('Delete Layer Comp', () => { doc.comps = (doc.comps || []).filter((c) => c.id !== id); if (doc.activeCompId === id) doc.activeCompId = null; });
    S.bus.emit('comps:changed', doc);
  };
  CM.rename = async function (doc, id) {
    const c = (doc.comps || []).find((x) => x.id === id); if (!c) return;
    const n = await S.Dialog.prompt('Comp name', c.name, 'Rename Layer Comp'); if (!n) return;
    doc.commit('Rename Layer Comp', () => { doc.comps = doc.comps.map((x) => (x.id === id ? { ...x, name: n } : x)); });
    S.bus.emit('comps:changed', doc);
  };
  /** Export every comp as its own PNG/JPEG (through the export batch machinery) */
  CM.exportAll = async function (doc) {
    const comps = doc.comps || []; if (!comps.length) { S.toast('No layer comps'); return; }
    const st = Object.assign({ format: 'png', quality: 90, scale: 100, matte: '#ffffff' }, S.store.get('export', {}));
    const before = doc.captureState(), prevComp = doc.activeCompId;
    const items = [];
    const prog = S.Progress.start('Export layer comps', { cancellable: true });
    try {
      let dir = null;
      if (window.showDirectoryPicker) { try { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch (e) { if (e.name === 'AbortError') { prog.done(); return; } } }
      for (let i = 0; i < comps.length; i++) {
        if (prog.cancelled) break;
        CM.applyRecords(doc, comps[i]); doc.invalidate(); S.Compositor.update(doc);
        const c = S.FileIO.renderExport(doc, st.scale / 100, st.format === 'jpeg' ? st.matte : null);
        const ext = st.format === 'jpeg' ? 'jpg' : st.format;
        const blob = await U.canvasToBlob(c, 'image/' + st.format, st.quality / 100);
        const fname = doc.name + ' — ' + comps[i].name.replace(/[\\/:*?"<>|]/g, '_') + '.' + ext;
        if (dir) { const h = await dir.getFileHandle(fname, { create: true }); const w = await h.createWritable(); await w.write(blob); await w.close(); }
        else { U.downloadBlob(blob, fname); await new Promise((r) => setTimeout(r, 250)); }
        items.push(fname); prog.set((i + 1) / comps.length, comps[i].name);
      }
    } finally {
      doc.restoreState(before); doc.activeCompId = prevComp; S.bus.emit('layers:changed', doc); prog.done();
    }
    S.toast('Exported ' + items.length + ' comp' + (items.length === 1 ? '' : 's'));
  };

  S.Cmd.register('layer.compNew', { label: 'New Layer Comp…', run: async () => { const d = S.app.doc; const n = await S.Dialog.prompt('Comp name', 'Comp ' + ((d.comps || []).length + 1), 'New Layer Comp'); if (n == null) return; CM.add(d, n); S.Panels.show('comps'); }, enabled: () => !!S.app.doc });
  S.Cmd.register('layer.compUpdate', { label: 'Update Layer Comp', run: () => { const d = S.app.doc; if (d.activeCompId) CM.update(d, d.activeCompId); }, enabled: () => !!(S.app.doc && S.app.doc.activeCompId) });
  S.Cmd.register('layer.compNext', { label: 'Next Layer Comp', key: 'Ctrl+Alt+]', run: () => { const d = S.app.doc, cs = d.comps || []; if (!cs.length) return; const i = cs.findIndex((c) => c.id === d.activeCompId); CM.apply(d, cs[(i + 1) % cs.length].id); }, enabled: () => !!(S.app.doc && (S.app.doc.comps || []).length) });
  S.Cmd.register('layer.compPrev', { label: 'Previous Layer Comp', key: 'Ctrl+Alt+[', run: () => { const d = S.app.doc, cs = d.comps || []; if (!cs.length) return; const i = cs.findIndex((c) => c.id === d.activeCompId); CM.apply(d, cs[(i - 1 + cs.length) % cs.length].id); }, enabled: () => !!(S.app.doc && (S.app.doc.comps || []).length) });
  S.Cmd.register('file.exportComps', { label: 'Export Layer Comps as Files…', run: () => CM.exportAll(S.app.doc), enabled: () => !!(S.app.doc && (S.app.doc.comps || []).length) });

  /* ---------------- panel ---------------- */
  P.register({
    id: 'comps', title: 'Layer Comps', icon: 'layers', defaultNear: 'history', events: ['comps:changed', 'doc:switched', 'history:changed'],
    build(body) {
      const list = U.el('div', { class: 'comps-list' });
      const foot = U.el('div', { class: 'panel-foot' });
      const b = (icon, tip, fn) => { const x = U.el('button', { class: 'icon-btn', html: S.icon(icon), 'data-tip': tip, 'data-tip-pos': 'top' }); x.onclick = fn; foot.appendChild(x); return x; };
      b('plus', 'New comp from the current state', () => S.Cmd.run('layer.compNew'));
      b('undo', 'Update the selected comp with the current state', () => S.Cmd.run('layer.compUpdate'));
      b('image', 'Export all comps as files', () => S.Cmd.run('file.exportComps'));
      foot.appendChild(U.el('div', { style: { flex: 1 } }));
      b('trash', 'Delete the selected comp', () => { const d = S.app.doc; if (d && d.activeCompId) CM.remove(d, d.activeCompId); });
      body.append(list, foot); body.classList.add('flex-panel');
      return { update() {
        const d = S.app.doc; list.innerHTML = '';
        if (!d) return;
        const comps = d.comps || [];
        if (!comps.length) list.appendChild(U.el('div', { class: 'empty-note' }, 'No layer comps. Click + to remember the current visibility, positions and effects as a comp; click a comp to switch to it.'));
        for (const c of comps) {
          const dot = U.el('span', { class: 'comp-dot' + (c.id === d.activeCompId ? ' on' : '') });
          const r = U.el('div', { class: 'comp-row' + (c.id === d.activeCompId ? ' active' : ''), title: 'Click to apply · double-click to rename' }, [dot, U.el('span', { style: { flex: 1 } }, c.name), U.el('span', { class: 'muted' }, [c.opts.visibility ? 'V' : '', c.opts.position ? 'P' : '', c.opts.appearance ? 'A' : ''].join(''))]);
          r.onclick = () => CM.apply(d, c.id);
          r.ondblclick = () => CM.rename(d, c.id);
          list.appendChild(r);
        }
      } };
    },
  });
})();
