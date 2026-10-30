/* =========================================================================
   Gesso — all application commands (menus + shortcuts call these).
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util, C = S.Cmd, O = S.Ops;
  const R = C.register;
  const doc = () => S.app.doc;
  const hasDoc = () => !!S.app.doc;
  const hasSel = () => !!(S.app.doc && S.app.doc.selection);
  const hasLayer = () => !!(S.app.doc && S.app.doc.activeLayer());
  const isRaster = () => { const l = hasDoc() && doc().activeLayer(); return !!l && l.type === 'raster'; };

  /* ======================= FILE ======================= */
  R('file.new', { label: 'New…', key: 'Ctrl+Alt+N,Ctrl+N', run: () => S.App.newDocDialog() });
  R('file.open', { label: 'Open…', key: 'Ctrl+O', run: () => S.FileIO.open() });
  R('file.place', { label: 'Place Image / SVG as Layer…', run: () => S.FileIO.open({ asLayer: true }), enabled: hasDoc });
  R('file.save', { label: 'Save Project', key: 'Ctrl+S', run: () => S.FileIO.saveProject(doc(), false), enabled: hasDoc });
  R('file.saveAs', { label: 'Save Project As…', key: 'Ctrl+Shift+S', run: () => S.FileIO.saveProject(doc(), true), enabled: hasDoc });
  R('file.export', { label: 'Export As…', key: 'Ctrl+Alt+S', run: () => S.FileIO.exportDialog(doc()), enabled: hasDoc });
  R('file.quickPng', { label: 'Quick Export as PNG', key: 'Ctrl+Alt+Shift+S', run: () => S.FileIO.quickExport(doc()), enabled: hasDoc });
  R('file.close', { label: 'Close', key: 'Ctrl+Alt+W,Ctrl+W', run: () => S.App.closeDoc(doc()), enabled: hasDoc });
  R('file.closeAll', { label: 'Close All', key: 'Ctrl+Alt+Shift+W', run: async () => { for (const d of S.app.docs.slice()) if (!(await S.App.closeDoc(d))) break; }, enabled: hasDoc });
  R('file.print', { label: 'Print…', key: 'Ctrl+P', run: () => S.FileIO.print(doc()), enabled: hasDoc });
  R('file.revert', { label: 'Revert to Opened State', run: () => { const d = doc(); d.history.jumpTo(0); }, enabled: () => hasDoc() && doc().history.index > 0 });

  /* ======================= EDIT ======================= */
  R('edit.undo', { label: 'Undo', key: 'Ctrl+Z', run: () => { const n = doc().history.undo(); if (n) S.toast('Undo ' + n, 900); }, enabled: () => hasDoc() && doc().history.canUndo });
  R('edit.redo', { label: 'Redo', key: 'Ctrl+Shift+Z,Ctrl+Y', run: () => { const n = doc().history.redo(); if (n) S.toast('Redo ' + n, 900); }, enabled: () => hasDoc() && doc().history.canRedo });
  R('edit.cut', { label: 'Cut', key: 'Ctrl+X', run: () => S.Clip.copy(false, true), enabled: hasLayer });
  R('edit.copy', { label: 'Copy', key: 'Ctrl+C', run: () => S.Clip.copy(false, false), enabled: hasLayer });
  R('edit.copyMerged', { label: 'Copy Merged', key: 'Ctrl+Shift+C', run: () => S.Clip.copy(true, false), enabled: hasDoc });
  R('edit.paste', { label: 'Paste', key: '', run: () => S.Clip.pasteFromMenu(false) });
  R('edit.pasteInPlace', { label: 'Paste in Place', key: 'Ctrl+Shift+V', run: () => S.Clip.pasteInternal(true) });
  R('edit.pasteNewDoc', { label: 'Paste as New Document', run: () => S.Clip.pasteInternal(false, true) });
  R('edit.clear', { label: 'Clear', key: 'Delete,Backspace', run: () => O.clearSelection(doc()), enabled: hasLayer });
  R('edit.fill', { label: 'Fill…', key: 'Shift+F5', run: () => S.App.fillDialog(), enabled: hasLayer });
  R('edit.fillFg', { label: 'Fill with Foreground', key: 'Alt+Backspace,Alt+Delete', run: () => S.App.fillWith(S.app.fg, 'Fill Foreground'), enabled: hasLayer });
  R('edit.fillBg', { label: 'Fill with Background', key: 'Ctrl+Backspace,Ctrl+Delete', run: () => S.App.fillWith(S.app.bg, 'Fill Background'), enabled: hasLayer });
  R('edit.stroke', { label: 'Stroke…', run: () => S.App.strokeDialog(), enabled: hasLayer });
  R('edit.freeTransform', { label: 'Free Transform', key: 'Ctrl+Alt+T,Ctrl+T', run: () => S.Transform.begin(), enabled: hasLayer });
  R('edit.meshWarp', { label: 'Mesh Warp', key: 'Ctrl+Alt+Shift+T', run: () => S.MeshWarp.begin(), enabled: hasLayer });
  const inst = (fn) => () => S.Transform.instant(fn);
  R('edit.flipH', { label: 'Flip Horizontal', run: inst((x, y) => [-x, y]), enabled: hasLayer });
  R('edit.flipV', { label: 'Flip Vertical', run: inst((x, y) => [x, -y]), enabled: hasLayer });
  R('edit.rot90cw', { label: 'Rotate 90° Clockwise', run: inst((x, y) => [-y, x]), enabled: hasLayer });
  R('edit.rot90ccw', { label: 'Rotate 90° Counter Clockwise', run: inst((x, y) => [y, -x]), enabled: hasLayer });
  R('edit.rot180', { label: 'Rotate 180°', run: inst((x, y) => [-x, -y]), enabled: hasLayer });
  R('edit.prefs', { label: 'Preferences…', key: 'Ctrl+K', run: () => S.App.prefsDialog() });
  R('edit.shortcuts', { label: 'Keyboard Shortcuts…', key: 'Ctrl+Alt+Shift+K', run: () => S.App.shortcutsDialog() });
  // Define Brush / Define Pattern take the selected pixels of the active layer (or the whole layer / document)
  const defineFrom = async (what, apply) => {
    const d = doc(), res = S.Ops.copyPixels(d, what === 'pattern' && !d.activeLayer());
    if (!res) { S.toast('Nothing selected to define a ' + what + ' from'); return; }
    if (what === 'brush' && Math.max(res.canvas.width, res.canvas.height) > 2500) { S.toast('Brush tips are limited to 2500 px'); return; }
    const names = Object.keys(S.Brush.custom[what === 'brush' ? 'tips' : 'patterns']);
    const n = await S.Dialog.prompt(what === 'brush' ? 'Brush name' : 'Pattern name', (what === 'brush' ? 'Brush ' : 'Pattern ') + (names.length + 1), what === 'brush' ? 'Define Brush' : 'Define Pattern');
    if (!n) return;
    apply(n, res.canvas);
    S.toast((what === 'brush' ? 'Brush "' : 'Pattern "') + n + '" defined (' + res.canvas.width + ' × ' + res.canvas.height + ' px)');
  };
  R('edit.defineBrush', { label: 'Define Brush from Selection…', run: () => defineFrom('brush', (n, c) => S.Brush.defineTip(n, c)), enabled: hasLayer });
  R('edit.definePattern', { label: 'Define Pattern from Selection…', run: () => defineFrom('pattern', (n, c) => S.Brush.definePattern(n, c)), enabled: hasDoc });

  /* align / distribute (Layer ▸ Align / Distribute, Move tool options bar) */
  const ALIGN = { left: 'Left Edges', hcenter: 'Horizontal Centers', right: 'Right Edges', top: 'Top Edges', vcenter: 'Vertical Centers', bottom: 'Bottom Edges' };
  for (const k in ALIGN) R('layer.align.' + k, { label: 'Align ' + ALIGN[k], run: () => S.alignLayers(doc(), k), enabled: hasLayer });
  const DIST = { h: 'Horizontal Centers', v: 'Vertical Centers', hgap: 'Horizontal Spacing', vgap: 'Vertical Spacing' };
  for (const k in DIST) R('layer.distribute.' + k, { label: 'Distribute ' + DIST[k], run: () => S.distributeLayers(doc(), k), enabled: () => hasDoc() && doc().selectedLayers().length >= 3 });

  /* ======================= IMAGE ======================= */
  R('image.size', { label: 'Image Size…', key: 'Ctrl+Alt+I', run: () => S.App.imageSizeDialog(), enabled: hasDoc });
  R('image.canvasSize', { label: 'Canvas Size…', key: 'Ctrl+Alt+C', run: () => S.App.canvasSizeDialog(), enabled: hasDoc });
  const rotCanvas = (deg, name) => () => { const d = doc(); d.commit(name, () => O.rotateCanvas(d, deg)); S.View.fit(d, false); S.bus.emit('doc:resized', d); };
  R('image.rot180', { label: '180°', run: rotCanvas(180, 'Rotate Canvas 180°'), enabled: hasDoc });
  R('image.rot90cw', { label: '90° Clockwise', run: rotCanvas(90, 'Rotate Canvas 90° CW'), enabled: hasDoc });
  R('image.rot90ccw', { label: '90° Counter Clockwise', run: rotCanvas(270, 'Rotate Canvas 90° CCW'), enabled: hasDoc });
  R('image.rotArb', { label: 'Arbitrary…', run: () => S.Dialog.form('Rotate Canvas', [{ id: 'a', label: 'Angle', type: 'angle', default: 15 }], {}, (v) => rotCanvas(v.a, 'Rotate Canvas')()), enabled: hasDoc });
  R('image.flipH', { label: 'Flip Canvas Horizontal', run: () => doc().commit('Flip Canvas Horizontal', () => O.flipCanvas(doc(), 'h')), enabled: hasDoc });
  R('image.flipV', { label: 'Flip Canvas Vertical', run: () => doc().commit('Flip Canvas Vertical', () => O.flipCanvas(doc(), 'v')), enabled: hasDoc });
  R('image.cropToSel', { label: 'Crop to Selection', run: () => { const d = doc(), b = d.selection.bounds; d.commit('Crop', () => { O.resizeCanvas(d, b.w, b.h, -b.x, -b.y, null, { clip: S.Tools.byId.crop.opts.cropped === 'delete' }); d.selection = null; }); S.View.fit(d, false); S.bus.emit('doc:resized', d); }, enabled: hasSel });
  R('image.trim', { label: 'Trim…', run: () => S.App.trimDialog(), enabled: hasDoc });
  R('image.revealAll', { label: 'Reveal All', run: () => {
    const d = doc(), b = O.contentExtent(d);
    if (b.x === 0 && b.y === 0 && b.w === d.width && b.h === d.height) { S.toast('Nothing hidden outside the canvas'); return; }
    d.commit('Reveal All', () => O.resizeCanvas(d, b.w, b.h, -b.x, -b.y));
    S.View.fit(d, false); S.bus.emit('doc:resized', d);
  }, enabled: hasDoc });
  R('layer.trimToContent', { label: 'Trim Layer Canvas to Content', run: () => {
    const d = doc(); let n = 0;
    for (const l of d.selectedLayers()) {
      if (l.type === 'raster' && S.Layers.trimInPlace(l.canvas)) { l.version++; n++; }
      if (l.mask && S.Layers.trimMask(l.mask)) { l.mask.version = (l.mask.version || 0) + 1; l.version++; }
    }
    d.invalidate(); S.bus.emit('layers:changed', d); S.toast(n ? 'Trimmed ' + n + ' layer' + (n > 1 ? 's' : '') : 'Nothing to trim');
  }, enabled: isRaster });
  R('layer.trimToCanvas', { label: 'Trim Layer to Canvas (delete pixels outside)', run: () => {
    const d = doc();
    d.commit('Trim to Canvas', () => {
      for (const l of d.selectedLayers()) {
        if (l.type !== 'raster') continue;
        const D = { x: 0, y: 0, w: d.width, h: d.height }, i = U.rectIntersect(U.rectOf(l.canvas), D);
        let c;
        if (!i) c = S.Layers.emptyCanvas(); else { c = U.createCanvas(i.w, i.h, i.x, i.y); c.getContext('2d').drawImage(l.canvas, i.x - (l.canvas.ox || 0), i.y - (l.canvas.oy || 0), i.w, i.h, 0, 0, i.w, i.h); S.Layers.trimInPlace(c); }
        l.canvas = c; l.version++;
      }
    });
  }, enabled: () => isRaster() && (() => { const l = doc().activeLayer(), r = U.rectOf(l.canvas); return r.x < 0 || r.y < 0 || r.x + r.w > doc().width || r.y + r.h > doc().height; })() });
  R('image.duplicate', { label: 'Duplicate…', run: () => S.App.duplicateDoc(doc()), enabled: hasDoc });
  const destructive = (id) => () => S.FX.applyAdjustmentDestructive(id);
  R('image.autoTone', { label: 'Auto Tone', key: 'Ctrl+Shift+L', run: () => S.FX.quickApply('autoTone', 'Auto Tone'), enabled: hasLayer });
  R('image.autoContrast', { label: 'Auto Contrast', key: 'Ctrl+Alt+Shift+L', run: () => S.FX.quickApply('autoContrast', 'Auto Contrast'), enabled: hasLayer });
  R('image.autoColor', { label: 'Auto Color', key: 'Ctrl+Shift+B', run: () => S.FX.quickApply('autoColor', 'Auto Color'), enabled: hasLayer });
  R('image.invert', { label: 'Invert', key: 'Ctrl+I', run: () => S.FX.quickApply('invert', 'Invert'), enabled: hasLayer });
  R('image.desaturate', { label: 'Desaturate', key: 'Ctrl+Shift+U', run: () => S.FX.quickApply('desaturate', 'Desaturate'), enabled: hasLayer });
  R('image.grayscale', { label: 'Grayscale (flatten color)', run: async () => {
    if (!(await S.Dialog.confirm('Convert every pixel layer to grayscale? Text and shape colors are kept.', 'Convert'))) return;
    const d = doc();
    d.commit('Grayscale', () => d.walk((l) => {
      if (l.type !== 'raster') return;
      const c = U.cloneCanvas(l.canvas), x = c.getContext('2d'), img = x.getImageData(0, 0, c.width, c.height), p = img.data;
      for (let i = 0; i < p.length; i += 4) { const v = U.luma(p[i], p[i + 1], p[i + 2]); p[i] = p[i + 1] = p[i + 2] = v; }
      x.putImageData(img, 0, 0); l.canvas = c; l.version++;
    }));
  }, enabled: hasDoc });
  R('image.adjust', { label: 'Adjustment', run: (id) => destructive(id)(), enabled: hasLayer });

  /* ======================= LAYER ======================= */
  const addLayer = (l, name) => { const d = doc(); d.commit(name || 'New Layer', () => { d.insertLayer(l); d.activeId = l.id; d.selectedIds = new Set([l.id]); }); S.bus.emit('activeLayer:changed', d); return l; };
  S.addLayer = addLayer;
  R('layer.new', { label: 'New Layer', key: 'Ctrl+Alt+Shift+N,Ctrl+Shift+N', run: () => {
    const d = doc(); let n = 1; d.walk((l) => { const m = /^Layer (\d+)$/.exec(l.name); if (m) n = Math.max(n, +m[1] + 1); });
    addLayer(S.Layers.raster(d, 'Layer ' + n));
  }, enabled: hasDoc });
  R('layer.newGroup', { label: 'New Group', run: () => addLayer(S.Layers.group(doc()), 'New Group'), enabled: hasDoc });
  R('layer.newViaCopy', { label: 'New Layer via Copy', key: 'Ctrl+J', run: () => S.App.layerVia(false), enabled: hasLayer });
  R('layer.newViaCut', { label: 'New Layer via Cut', key: 'Ctrl+Shift+J', run: () => S.App.layerVia(true), enabled: isRaster });
  R('layer.duplicate', { label: 'Duplicate Layer', run: () => {
    const d = doc(); const sel = d.selectedLayers();
    d.commit('Duplicate Layer', () => { let last; for (const l of sel) { const c = S.Layers.duplicate(l, d); d.insertLayer(c, l.id); last = c; } d.activeId = last.id; d.selectedIds = new Set([last.id]); });
  }, enabled: hasLayer });
  R('layer.delete', { label: 'Delete Layer', run: () => {
    const d = doc(); const sel = d.selectedLayers();
    if (sel.some((l) => l.locks.all)) { S.toast('A selected layer is locked'); return; }
    d.commit('Delete Layer', () => {
      const info = d.parentInfo(sel[0].id);
      for (const l of sel) d.removeLayer(l.id);
      const list = info.list.length ? info.list : d.layers;
      const next = list[Math.min(info.index, list.length - 1)] || d.flatTopDown()[0]?.layer;
      d.activeId = next ? next.id : null; d.selectedIds = new Set(next ? [next.id] : []);
    });
  }, enabled: hasLayer });
  R('layer.rename', { label: 'Rename Layer…', run: async () => { const l = doc().activeLayer(); const n = await S.Dialog.prompt('Layer name', l.name, 'Rename Layer'); if (n) doc().commit('Rename Layer', () => { doc().findLayer(l.id).name = n; }); }, enabled: hasLayer });
  R('layer.group', { label: 'Group Layers', key: 'Ctrl+G', run: () => { const d = doc(); const sel = d.selectedLayers(); const p = d.parentInfo(sel[0].id).list; const same = sel.filter((l) => p.includes(l)); d.commit('Group Layers', () => O.group(d, same)); }, enabled: hasLayer });
  R('layer.ungroup', { label: 'Ungroup Layers', key: 'Ctrl+Shift+G', run: () => doc().commit('Ungroup', () => O.ungroup(doc(), doc().activeLayer())), enabled: () => hasLayer() && doc().activeLayer().type === 'group' });
  R('layer.mergeDown', { label: 'Merge Down', key: 'Ctrl+E', run: () => {
    const d = doc(); const sel = d.selectedLayers();
    if (sel.length > 1) { const p = d.parentInfo(sel[0].id).list; d.commit('Merge Layers', () => O.mergeLayers(d, p.filter((l) => sel.includes(l)))); }
    else d.commit('Merge Down', () => O.mergeDown(d));
  }, enabled: hasLayer });
  R('layer.mergeVisible', { label: 'Merge Visible', key: 'Ctrl+Shift+E', run: () => doc().commit('Merge Visible', () => O.mergeVisible(doc())), enabled: hasDoc });
  R('layer.flatten', { label: 'Flatten Image', run: () => doc().commit('Flatten Image', () => O.flatten(doc())), enabled: hasDoc });
  R('layer.rasterize', { label: 'Rasterize Layer', run: () => { const d = doc(); d.commit('Rasterize', () => { for (const l of d.selectedLayers()) O.rasterize(d, l); }); }, enabled: () => hasLayer() && (['text', 'shape', 'fill'].includes(doc().activeLayer().type) || S.Embed.is(doc().activeLayer())) });
  R('layer.convertEmbed', { label: 'Convert to Embedded Object', run: () => {
    const d = doc();
    d.commit('Convert to Embedded Object', () => { for (let l of d.selectedLayers()) { if (['text', 'shape', 'fill'].includes(l.type)) l = O.rasterize(d, l); if (l && l.type === 'raster' && !l.embed) S.Embed.convert(l, d); } });
    S.bus.emit('activeLayer:changed', d);
  }, enabled: () => hasLayer() && ['raster', 'text', 'shape', 'fill'].includes(doc().activeLayer().type) && !S.Embed.is(doc().activeLayer()) });
  R('layer.editContents', { label: 'Edit Contents (Embedded Object)', run: () => S.Embed.editContents(doc(), doc().activeLayer()), enabled: () => hasLayer() && S.Embed.is(doc().activeLayer()) });
  R('layer.embedReset', { label: 'Reset Embedded Object Transform', run: () => { const d = doc(), l = d.activeLayer(); d.commit('Reset Object Transform', () => { const b = S.Embed.bounds(l), e = l.embed; e.matrix = [1, 0, 0, 1, Math.round(b.x) - (e.source.ox || 0), Math.round(b.y) - (e.source.oy || 0)]; S.Embed.bump(l); S.Embed.render(l, d); }); }, enabled: () => hasLayer() && S.Embed.is(doc().activeLayer()) });
  R('layer.rasterizeEffects', { label: 'Rasterize Layer Effects', run: () => {
    const d = doc(), l = d.activeLayer();
    d.commit('Rasterize Effects', () => { const c = S.Layers.trim(S.Compositor.renderSingle(Object.assign({}, l, { opacity: 1, blend: 'normal' }), d)); const r = O.rasterize(d, l) || l; r.canvas = c; r.effects = null; r.mask = null; r.fillOpacity = 1; r.version++; });
  }, enabled: () => hasLayer() && S.Effects.active(doc().activeLayer()) });
  /** Mask canvas holding the selection (sparse: only the selection's bounds, outside = 0) */
  const selMaskCanvas = (d, hide) => {
    const b = d.selection.bounds, c = U.createCanvas(b.w, b.h, b.x, b.y), x = c.getContext('2d');
    if (hide) { x.fillStyle = '#000'; x.fillRect(0, 0, b.w, b.h); x.globalCompositeOperation = 'destination-out'; }
    x.drawImage(S.Sel.canvas(d.selection), -b.x, -b.y);
    return c;
  };
  S.selMaskCanvas = selMaskCanvas;
  /** new fill/adjustment layers take the current selection as their mask */
  const selMask = (l) => { const d = doc(); if (d.selection && l.mask) l.mask = S.Layers.maskFrom(selMaskCanvas(d, false), 0); return l; };
  R('layer.newFillSolid', { label: 'Solid Color…', run: () => S.ColorPicker.open(S.app.fg, null, (c) => addLayer(selMask(S.Layers.fill(doc(), { kind: 'solid', color: c })), 'New Fill Layer'), { title: 'Fill Layer Color' }), enabled: hasDoc });
  R('layer.newFillGradient', { label: 'Gradient…', run: () => { addLayer(selMask(S.Layers.fill(doc(), { kind: 'gradient', stops: S.Gradient.resolve(S.Gradient.PRESETS[0]) })), 'New Fill Layer'); S.Panels.show('properties'); }, enabled: hasDoc });
  R('layer.newAdjustment', { label: 'Adjustment Layer', run: (id) => { const l = selMask(S.Layers.adjustment(doc(), id)); addLayer(l, 'New ' + l.name + ' Layer'); S.Panels.show('properties'); }, enabled: hasDoc });
  R('layer.effects', { label: 'Layer Effects…', run: (which) => S.FX.effectsDialog(doc().activeLayer(), which), enabled: () => hasLayer() && doc().activeLayer().type !== 'adjustment' });
  R('layer.clearEffects', { label: 'Clear Layer Effects', run: () => doc().commit('Clear Effects', () => { doc().activeLayer().effects = null; doc().activeLayer().version++; }), enabled: () => hasLayer() && !!doc().activeLayer().effects });
  R('layer.toggleEffects', { label: 'Hide All Effects', run: () => doc().commit('Toggle Effects', () => { const l = doc().activeLayer(); l.effects.enabled = l.effects.enabled === false; l.version++; }), enabled: () => hasLayer() && !!doc().activeLayer().effects });
  // masks
  const maskCmd = (name, fn, en) => ({ label: name, run: () => { const d = doc(); d.commit(name, () => fn(d, d.activeLayer())); S.bus.emit('activeLayer:changed', d); }, enabled: () => hasLayer() && (!en || en(doc().activeLayer())) });
  const noMask = (l) => !l.mask && l.type !== 'group' || (l.type === 'group' && !l.mask);
  R('layer.maskReveal', maskCmd('Add Layer Mask (Reveal All)', (d, l) => { l.mask = S.Layers.newMask(d, 255); l.editMask = true; }, noMask));
  R('layer.maskHide', maskCmd('Add Layer Mask (Hide All)', (d, l) => { l.mask = S.Layers.newMask(d, 0); l.editMask = true; }, noMask));
  R('layer.maskFromSel', maskCmd('Add Layer Mask (From Selection)', (d, l) => { l.mask = S.Layers.maskFrom(selMaskCanvas(d, false), 0); l.editMask = true; d.selection = null; }, (l) => noMask(l) && hasSel()));
  R('layer.maskHideSel', maskCmd('Add Layer Mask (Hide Selection)', (d, l) => { l.mask = S.Layers.maskFrom(selMaskCanvas(d, true), 255); l.editMask = true; d.selection = null; }, (l) => noMask(l) && hasSel()));
  R('layer.maskDelete', maskCmd('Delete Layer Mask', (d, l) => { l.mask = null; l.editMask = false; l.version++; }, (l) => !!l.mask));
  R('layer.maskApply', maskCmd('Apply Layer Mask', (d, l) => {
    if (l.type !== 'raster') { O.rasterize(d, l); l = d.findLayer(l.id); }
    const c = U.cloneCanvas(l.canvas);
    S.Compositor.applyMask(c, l, d);
    l.canvas = c; l.mask = null; l.editMask = false; l.version++;
  }, (l) => !!l.mask && l.type !== 'adjustment' && l.type !== 'group'));
  R('layer.maskToggle', maskCmd('Disable/Enable Layer Mask', (d, l) => { l.mask.enabled = l.mask.enabled === false; l.version++; }, (l) => !!l.mask));
  R('layer.maskInvert', maskCmd('Invert Layer Mask', (d, l) => { l.mask = S.Layers.invertMask(l.mask); l.version++; }, (l) => !!l.mask));
  R('layer.maskToSel', { label: 'Load Mask as Selection', run: () => { const d = doc(), l = d.activeLayer(); d.setSelection(S.Sel.make(S.Sel.alphaOf(S.Layers.maskDocCanvas(l.mask, d)), d.width, d.height), 'Load Selection'); }, enabled: () => hasLayer() && !!doc().activeLayer().mask });
  R('layer.maskTrim', { label: 'Compact Layer Mask', run: () => { const d = doc(); let n = 0; for (const l of d.selectedLayers()) if (l.mask && S.Layers.trimMask(l.mask)) { l.mask.version = (l.mask.version || 0) + 1; l.version++; n++; } d.invalidate(); S.bus.emit('layers:changed', d); S.toast(n ? 'Compacted ' + n + ' mask' + (n > 1 ? 's' : '') : 'Masks are already compact'); }, enabled: () => hasLayer() && !!doc().activeLayer().mask });
  R('layer.clip', { label: 'Create/Release Clipping Mask', key: 'Ctrl+Alt+G', run: () => doc().commit('Clipping Mask', () => { for (const l of doc().selectedLayers()) l.clip = !l.clip; }), enabled: hasLayer });
  R('layer.front', { label: 'Bring to Front', key: 'Ctrl+Shift+]', run: () => doc().commit('Arrange', () => O.arrange(doc(), doc().activeLayer(), 'top')), enabled: hasLayer });
  R('layer.forward', { label: 'Bring Forward', key: 'Ctrl+]', run: () => doc().commit('Arrange', () => O.arrange(doc(), doc().activeLayer(), 1)), enabled: hasLayer });
  R('layer.backward', { label: 'Send Backward', key: 'Ctrl+[', run: () => doc().commit('Arrange', () => O.arrange(doc(), doc().activeLayer(), -1)), enabled: hasLayer });
  R('layer.back', { label: 'Send to Back', key: 'Ctrl+Shift+[', run: () => doc().commit('Arrange', () => O.arrange(doc(), doc().activeLayer(), 'bottom')), enabled: hasLayer });
  R('layer.selectUp', { label: 'Select Layer Above', key: 'Alt+]', run: () => { const d = doc(), f = d.flatTopDown(), i = f.findIndex((x) => x.layer.id === d.activeId); if (i > 0) d.setActive(f[i - 1].layer.id); }, enabled: hasLayer });
  R('layer.selectDown', { label: 'Select Layer Below', key: 'Alt+[', run: () => { const d = doc(), f = d.flatTopDown(), i = f.findIndex((x) => x.layer.id === d.activeId); if (i < f.length - 1) d.setActive(f[i + 1].layer.id); }, enabled: hasLayer });
  R('layer.toggleVisible', { label: 'Show/Hide Layer', key: 'Ctrl+,', run: () => doc().commit('Visibility', () => { for (const l of doc().selectedLayers()) l.visible = !l.visible; }), enabled: hasLayer });
  R('layer.lockAll', { label: 'Lock All', key: 'Ctrl+/', run: () => doc().commit('Lock', () => { const l = doc().activeLayer(); l.locks.all = !l.locks.all; }), enabled: hasLayer, checked: () => hasLayer() && doc().activeLayer().locks.all });
  R('layer.stampVisible', { label: 'Stamp Visible to New Layer', key: 'Ctrl+Alt+Shift+E', run: () => addLayer(S.Layers.raster(doc(), 'Stamp', S.Layers.trim(S.Compositor.flatten(doc()))), 'Stamp Visible'), enabled: hasDoc });

  /* ======================= SELECT ======================= */
  const setSel = (sel, name) => doc().setSelection(sel, name);
  R('select.all', { label: 'All', key: 'Ctrl+A', run: () => setSel(S.Sel.all(doc().width, doc().height), 'Select All'), enabled: hasDoc });
  R('select.none', { label: 'Deselect', key: 'Ctrl+D', run: () => setSel(null, 'Deselect'), enabled: hasSel });
  R('select.reselect', { label: 'Reselect', key: 'Ctrl+Shift+D', run: () => setSel(doc().lastSelection, 'Reselect'), enabled: () => hasDoc() && !!doc().lastSelection && doc().lastSelection.w === doc().width && doc().lastSelection.h === doc().height });
  R('select.inverse', { label: 'Inverse', key: 'Ctrl+Shift+I', run: () => setSel(S.Sel.invert(doc().selection, doc().width, doc().height), 'Inverse'), enabled: hasDoc });
  R('select.layerPixels', { label: 'Layer Pixels', run: () => setSel(O.layerAlphaSelection(doc(), doc().activeLayer()), 'Select Layer Pixels'), enabled: hasLayer });
  R('select.allLayers', { label: 'All Layers', key: 'Ctrl+Alt+A', run: () => { const d = doc(); d.selectedIds = new Set(d.allLayers().map((l) => l.id)); S.bus.emit('layers:changed', d); }, enabled: hasDoc });
  R('select.colorRange', { label: 'Color Range…', run: () => S.App.colorRangeDialog(), enabled: hasDoc });
  const modify = (name, fnName, sign, label, def, max) => R('select.' + name, { label: label + '…', run: () => S.Dialog.form(label + ' Selection', [{ id: 'r', label: 'Radius', type: 'range', default: def, min: 1, max, unit: 'px' }], { r: S.store.get('sel.' + name, def) }, (v) => { S.store.set('sel.' + name, v.r); setSel(S.Sel[fnName](doc().selection, sign * v.r), label); if (S.Actions) S.Actions.record({ type: 'selModify', fn: fnName, r: sign * v.r, label }); }), enabled: hasSel });
  modify('feather', 'feather', 1, 'Feather', 5, 250);
  modify('expand', 'expand', 1, 'Expand', 4, 200);
  modify('contract', 'expand', -1, 'Contract', 4, 200);
  modify('border', 'border', 1, 'Border', 6, 200);
  modify('smooth', 'smooth', 1, 'Smooth', 3, 100);
  C.map['select.feather'].defaultKey = 'Shift+F6';
  R('select.refine', { label: 'Select and Refine…', run: () => S.App.refineDialog(), enabled: hasSel });
  R('select.quickMask', { label: 'Edit in Quick Mask Mode', key: 'Q', run: () => S.App.toggleQuickMask(), enabled: hasDoc, checked: () => hasDoc() && !!doc().quickMask });
  R('select.toPath', { label: 'Make Work Path from Selection', run: () => {
    const d = doc(), p = O.selectionToPath(d.selection, 1.2);
    d.commit('Make Work Path', () => { const wp = { id: U.uid('path'), name: 'Work Path', path: p }; d.paths = d.paths.filter((x) => x.name !== 'Work Path'); d.paths.push(wp); d.activePathId = wp.id; });
    S.bus.emit('paths:changed', d); S.Panels.show('paths');
  }, enabled: hasSel });
  R('select.save', { label: 'Save Selection…', run: async () => {
    const d = doc(); const n = await S.Dialog.prompt('Channel name', 'Alpha ' + (d.alphaChannels.length + 1), 'Save Selection');
    if (n == null) return;
    d.commit('Save Selection', () => { d.alphaChannels.push({ id: U.uid('ch'), name: n || 'Alpha', sel: d.selection }); });
    S.bus.emit('channels:changed', d);
  }, enabled: hasSel });
  R('select.load', { label: 'Load Selection', run: (id) => {
    const d = doc(); const ch = d.alphaChannels.find((c) => c.id === id) || d.alphaChannels[d.alphaChannels.length - 1];
    if (ch) d.setSelection(ch.sel, 'Load Selection');
  }, enabled: () => hasDoc() && doc().alphaChannels.length > 0 });
  R('select.transform', { label: 'Transform Selection', run: () => S.App.transformSelection(), enabled: hasSel });

  /* ======================= PATHS ======================= */
  const activePath = () => hasDoc() && doc().paths.find((p) => p.id === doc().activePathId);
  R('path.toSelection', { label: 'Make Selection from Path', run: () => { const d = doc(), p = activePath(); const m = S.Sel.fromPath2D(d.width, d.height, S.Paths.toPath2D(p.path), 'nonzero'); setSel(S.Sel.make(m, d.width, d.height), 'Path to Selection'); }, enabled: () => !!activePath() });
  R('path.toShape', { label: 'Make Shape Layer from Path', run: () => { const d = doc(), p = activePath(); addLayer(S.Layers.shape(d, { kind: 'path', path: S.Paths.clone(p.path), fill: { enabled: true, color: S.app.fg } }), 'Path to Shape'); }, enabled: () => !!activePath() });
  R('path.fill', { label: 'Fill Path', run: () => {
    const d = doc(), p = activePath(), t = d.paintTarget();
    if (!t || t.kind === 'invalid') { S.toast('Select a pixel layer'); return; }
    const pb = U.rectRound(S.Paths.bounds(p.path)) || { x: 0, y: 0, w: 1, h: 1 };
    const c = U.createCanvas(pb.w, pb.h, pb.x, pb.y), x = c.getContext('2d'); x.translate(-pb.x, -pb.y); x.fillStyle = S.app.fg; x.fill(S.Paths.toPath2D(p.path)); U.resetCtx(c);
    S.paintCanvasOnto(d, t, c, 1, 'normal', 'Fill Path', false, pb);
  }, enabled: () => !!activePath() });
  R('path.stroke', { label: 'Stroke Path (with Brush)', run: () => {
    const d = doc(), p = activePath();
    const pts = [];
    for (const sp of p.path.subpaths) {
      const n = sp.nodes, cnt = sp.closed ? n.length : n.length - 1;
      if (!n.length) continue;
      pts.push(null);
      for (let i = 0; i < cnt; i++) {
        const A = n[i], B = n[(i + 1) % n.length];
        for (let k = 0; k <= 40; k++) { const t = k / 40, mt = 1 - t; pts.push([mt * mt * mt * A.x + 3 * mt * mt * t * A.ox + 3 * mt * t * t * B.ix + t * t * t * B.x, mt * mt * mt * A.y + 3 * mt * mt * t * A.oy + 3 * mt * t * t * B.iy + t * t * t * B.y]); }
      }
    }
    // stroke each subpath separately with the Brush tool's current settings
    const brush = S.Tools.byId.brush; let cur = [];
    const flush = () => { if (cur.length > 1) S.Brush.strokePolyline(d, brush, cur); cur = []; };
    for (const q of pts) { if (q === null) flush(); else cur.push(q); }
    flush();
  }, enabled: () => !!activePath() });
  R('path.delete', { label: 'Delete Path', run: () => { const d = doc(); d.commit('Delete Path', () => { d.paths = d.paths.filter((p) => p.id !== d.activePathId); d.activePathId = null; }); S.bus.emit('paths:changed', d); }, enabled: () => !!activePath() });
  R('path.new', { label: 'New Path', run: () => { const d = doc(); d.commit('New Path', () => { const p = { id: U.uid('path'), name: 'Path ' + (d.paths.length + 1), path: S.Paths.empty() }; d.paths.push(p); d.activePathId = p.id; }); S.bus.emit('paths:changed', d); }, enabled: hasDoc });

  /* ======================= FILTER ======================= */
  R('filter.apply', { label: 'Filter', run: (id) => S.FX.filterDialog(id), enabled: hasLayer });
  R('filter.repeat', { label: 'Repeat Last Filter', key: 'Ctrl+Alt+F', run: () => S.FX.repeatLast(), enabled: () => hasLayer() && !!S.FX.last });

  /* ======================= VIEW ======================= */
  const V = S.View;
  R('view.zoomIn', { label: 'Zoom In', key: 'Ctrl+=,Ctrl++,Ctrl+Shift+=', run: () => V.zoomStep(1), enabled: hasDoc });
  R('view.zoomOut', { label: 'Zoom Out', key: 'Ctrl+-', run: () => V.zoomStep(-1), enabled: hasDoc });
  R('view.fit', { label: 'Fit on Screen', key: 'Ctrl+0', run: () => V.fit(doc(), false), enabled: hasDoc });
  R('view.actual', { label: '100%', key: 'Ctrl+1', run: () => V.setZoom(1), enabled: hasDoc });
  R('view.fill', { label: 'Fill Screen', run: () => { const d = doc(); const z = Math.max(V.w / d.width, V.h / d.height); d.view.zoom = z; d.view.panX = (V.w - d.width * z) / 2; d.view.panY = (V.h - d.height * z) / 2; V.viewChanged(); }, enabled: hasDoc });
  const tog = (key, label, k) => R('view.' + key, { label, key: k, run: () => { V[key] = !V[key]; V.savePrefs(); if (key === 'showRulers') V.applyRulerVisibility(); V.redraw(true); }, checked: () => !!V[key] });
  tog('showRulers', 'Rulers', 'Ctrl+R');
  tog('showGrid', 'Grid', "Ctrl+'");
  tog('showGuides', 'Guides', 'Ctrl+;');
  tog('snap', 'Snap', 'Ctrl+Shift+;');
  tog('showPixelGrid', 'Pixel Grid');
  tog('showSelEdges', 'Selection Edges', 'Ctrl+H');
  R('view.lockGuides', { label: 'Lock Guides', key: 'Ctrl+Alt+;', run: () => { doc().guidesLocked = !doc().guidesLocked; }, checked: () => hasDoc() && !!doc().guidesLocked, enabled: hasDoc });
  R('view.clearGuides', { label: 'Clear Guides', run: () => doc().commit('Clear Guides', () => { doc().guides = []; }), enabled: () => hasDoc() && doc().guides.length > 0 });
  R('view.newGuide', { label: 'New Guide…', run: () => S.Dialog.form('New Guide', [{ id: 'dir', label: 'Orientation', type: 'select', default: 'v', options: [{ value: 'v', label: 'Vertical' }, { value: 'h', label: 'Horizontal' }] }, { id: 'pos', label: 'Position', type: 'number', default: 0, unit: 'px' }], {}, (v) => doc().commit('New Guide', () => doc().guides.push({ dir: v.dir, pos: v.pos }))), enabled: hasDoc });
  R('view.guideLayout', { label: 'New Guide Layout…', run: () => S.App.guideLayoutDialog(), enabled: hasDoc });
  R('view.fullscreen', { label: 'Full Screen (unlocks Ctrl+T/N/W)', key: 'F11', checked: () => !!document.fullscreenElement, run: () => {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    // in full screen the Keyboard Lock API lets Gesso receive browser-reserved shortcuts
    document.documentElement.requestFullscreen().then(() => { if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock().catch(() => {}); }).catch(() => {});
  } });
  R('view.focus', { label: 'Hide Panels', key: 'Tab', run: () => document.body.classList.toggle('focus-mode'), checked: () => document.body.classList.contains('focus-mode') });
  R('view.channel', { label: 'Channel', run: (ch) => { const d = doc(); d.channelView = ch; d.invalidate(); S.bus.emit('channels:changed', d); }, enabled: hasDoc });

  /* ======================= WINDOW / HELP ======================= */
  R('window.reset', { label: 'Reset Workspace', run: () => S.Panels.reset() });
  R('window.nextDoc', { label: 'Next Document', key: 'Ctrl+`,Ctrl+Tab', run: () => { const a = S.app.docs, i = a.indexOf(doc()); if (a.length > 1) S.App.setActiveDoc(a[(i + 1) % a.length]); }, enabled: () => S.app.docs.length > 1 });
  R('layer.filter', { label: 'Filter Layers…', key: 'Ctrl+Alt+F', run: () => { S.Panels.show('layers'); if (S.Panels.layersFilterToggle) S.Panels.layersFilterToggle(); }, enabled: () => !!S.app.doc });
  R('window.panel', { label: 'Panel', run: (id) => S.Panels.toggle(id), checked: (id) => S.Panels.isVisible(id) });
  R('window.secondDock', { label: 'Secondary Dock Column', run: () => S.Panels.toggleSecondDock(), checked: () => S.Panels.secondDockVisible() });
  R('help.shortcuts', { label: 'Keyboard Shortcuts…', key: 'F1', run: () => S.App.shortcutsDialog() });
  R('help.about', { label: 'About Gesso', run: () => S.App.aboutDialog() });

  /* ======================= COLOR ======================= */
  R('color.swap', { label: 'Swap Colors', key: 'X', run: () => { const f = S.app.fg; S.App.setFg(S.app.bg, true); S.App.setBg(f); } });
  R('color.default', { label: 'Default Colors', key: 'D', run: () => { S.App.setFg('#000000', true); S.App.setBg('#ffffff'); } });
})();
