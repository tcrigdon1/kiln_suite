/* =========================================================================
   Gesso — menubar definitions.  Items reference commands by id.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso;

  function filterMenu() {
    const F = (window.ImageFX && ImageFX.filters) || {};
    const cats = (ImageFX.categories && ImageFX.categories.filters) || [];
    const by = {};
    for (const id in F) { const c = F[id].category || 'Other'; (by[c] = by[c] || []).push(F[id]); }
    const order = cats.concat(Object.keys(by).filter((c) => !cats.includes(c)));
    const items = [{ cmd: 'filter.repeat', label: S.FX.last ? 'Repeat ' + S.FX.last.fx.name : 'Repeat Last Filter' }, '-', { cmd: 'filter.gallery' }, { cmd: 'filter.convertSmart' }, { cmd: 'filter.smart' }, { cmd: 'filter.clearSmart' }, '-'];
    for (const c of order) {
      if (!by[c]) continue;
      items.push({ label: c, sub: by[c].sort((a, b) => a.name.localeCompare(b.name)).map((fx) => ({ label: fx.name + (fx.params.length ? '…' : ''), run: () => S.Cmd.run('filter.apply', fx.id), disabled: !S.app.doc })) });
    }
    return items;
  }
  function adjustMenu(destructive) {
    return S.adjList().map((fx) => ({ label: fx.name + (destructive && fx.params.length ? '…' : ''), run: () => S.Cmd.run(destructive ? 'image.adjust' : 'layer.newAdjustment', fx.id), disabled: !S.app.doc }));
  }
  S.App = S.App || {};
  S.App.adjustmentMenu = () => [{ cmd: 'layer.newFillSolid' }, { cmd: 'layer.newFillGradient' }, '-'].concat(adjustMenu(false));

  function recentMenu() {
    const r = S.store.get('recent', []);
    if (!r.length) return [{ label: 'No recent files', disabled: true }];
    return r.map((x) => ({ label: x.name, run: () => S.FileIO.openRecent(x.name) })).concat(['-', { label: 'Clear Recent', run: () => { S.store.set('recent', []); S.bus.emit('recent:changed'); } }]);
  }
  function panelsMenu() {
    return Object.keys(S.Panels.defs).sort((a, b) => S.Panels.defs[a].title.localeCompare(S.Panels.defs[b].title)).map((id) => ({ cmd: 'window.panel', arg: id, label: S.Panels.defs[id].title }));
  }
  function docsMenu() {
    return S.app.docs.map((d) => ({ label: d.name + (d.modified ? ' •' : ''), checked: d === S.app.doc, run: () => S.App.setActiveDoc(d) }));
  }

  S.MENUS = [
    { title: 'File', items: () => [
      { cmd: 'file.new' }, { cmd: 'file.open' }, { label: 'Open Recent', sub: recentMenu }, '-',
      { cmd: 'file.place' }, '-',
      { cmd: 'file.save' }, { cmd: 'file.saveAs' }, { cmd: 'file.revert' }, '-',
      { cmd: 'file.export' }, { cmd: 'file.quickPng' }, { cmd: 'file.exportLayers' }, { cmd: 'file.exportComps' }, { cmd: 'file.exportSvg' },
      { label: 'Export', sub: [{ cmd: 'file.exportAnim', label: 'Animation (GIF / APNG / WebM)…' }, '-', { cmd: 'file.exportLut', label: 'Color Look (.cube LUT)…' }, { cmd: 'file.exportHald', label: 'Color Look as HALD Image (PNG)…' }] }, '-',
      { label: 'Automate', sub: [{ cmd: 'file.contactSheet' }, { cmd: 'file.dataDriven' }] },
      { label: 'Actions', sub: [{ cmd: 'action.record' }, { cmd: 'action.stop' }, { cmd: 'action.playLast' }, '-', { cmd: 'file.batch' }, { cmd: 'window.panel', arg: 'actions', label: 'Actions Panel' }] }, '-',
      { cmd: 'file.print' }, { cmd: 'file.autosaveDoc' }, '-',
      { cmd: 'file.close' }, { cmd: 'file.closeAll' },
    ] },
    { title: 'Edit', items: () => [
      { cmd: 'edit.undo', label: S.app.doc && S.app.doc.history.canUndo ? 'Undo ' + S.app.doc.history.entries[S.app.doc.history.index].name : 'Undo' },
      { cmd: 'edit.redo', label: S.app.doc && S.app.doc.history.canRedo ? 'Redo ' + S.app.doc.history.entries[S.app.doc.history.index + 1].name : 'Redo' }, '-',
      { cmd: 'edit.cut' }, { cmd: 'edit.copy' }, { cmd: 'edit.copyMerged' }, { cmd: 'edit.paste', label: 'Paste' + (S.util.isMac ? '' : '') }, { cmd: 'edit.pasteInPlace' }, { cmd: 'edit.pasteNewDoc' }, { cmd: 'edit.clear' }, '-',
      { cmd: 'edit.fill' }, { cmd: 'edit.patchFill' }, { cmd: 'edit.stroke' }, '-',
      { cmd: 'edit.freeTransform' },
      { label: 'Transform', sub: [{ cmd: 'edit.freeTransform', label: 'Scale / Rotate / Skew / Distort' }, { cmd: 'edit.meshWarp', label: 'Mesh Warp (grid)' }, '-', { cmd: 'edit.rot180' }, { cmd: 'edit.rot90cw' }, { cmd: 'edit.rot90ccw' }, '-', { cmd: 'edit.flipH' }, { cmd: 'edit.flipV' }] },
      '-', { cmd: 'edit.defineBrush' }, { cmd: 'edit.definePattern' },
      '-', { cmd: 'edit.customizeToolbar' }, { cmd: 'edit.shortcuts' }, { cmd: 'edit.prefs' },
    ] },
    { title: 'Image', items: () => [
      { label: 'Adjustments', sub: () => adjustMenu(true) },
      { cmd: 'image.autoTone' }, { cmd: 'image.autoContrast' }, { cmd: 'image.autoColor' }, '-',
      { cmd: 'image.invert' }, { cmd: 'image.desaturate' }, { cmd: 'image.grayscale' }, '-',
      { cmd: 'image.size' }, { cmd: 'image.canvasSize' }, { cmd: 'image.caScale' }, { cmd: 'image.applyImage' },
      { label: 'Rotate Canvas', sub: [{ cmd: 'image.rot180' }, { cmd: 'image.rot90cw' }, { cmd: 'image.rot90ccw' }, { cmd: 'image.rotArb' }, '-', { cmd: 'image.flipH' }, { cmd: 'image.flipV' }] },
      { cmd: 'image.cropToSel' }, { cmd: 'image.trim' }, { cmd: 'image.revealAll' }, '-',
      { cmd: 'image.duplicate' },
    ] },
    { title: 'Layer', items: () => [
      { label: 'New', sub: [{ cmd: 'layer.new' }, { cmd: 'layer.newGroup' }, '-', { cmd: 'layer.newViaCopy' }, { cmd: 'layer.newViaCut' }] },
      { cmd: 'layer.duplicate' }, { cmd: 'layer.delete' }, { cmd: 'layer.rename' }, { cmd: 'layer.filter' }, '-',
      { label: 'New Fill Layer', sub: [{ cmd: 'layer.newFillSolid' }, { cmd: 'layer.newFillGradient' }] },
      { label: 'New Adjustment Layer', sub: () => adjustMenu(false) }, '-',
      { label: 'Layer Effects', sub: () => S.Effects.DEFS.map((d) => ({ label: d.name + '…', run: () => S.Cmd.run('layer.effects', d.id), disabled: !S.app.doc || !S.app.doc.activeLayer() })).concat(['-', { cmd: 'layer.toggleEffects' }, { cmd: 'layer.clearEffects' }, { cmd: 'layer.rasterizeEffects' }]) },
      { label: 'Layer Mask', sub: [{ cmd: 'layer.maskReveal', label: 'Reveal All' }, { cmd: 'layer.maskHide', label: 'Hide All' }, { cmd: 'layer.maskFromSel', label: 'Reveal Selection' }, { cmd: 'layer.maskHideSel', label: 'Hide Selection' }, '-', { cmd: 'layer.maskToggle' }, { cmd: 'layer.maskInvert' }, { cmd: 'layer.maskToSel' }, { cmd: 'layer.maskApply' }, { cmd: 'layer.maskTrim' }, { cmd: 'layer.maskDelete' }] },
      { cmd: 'layer.clip' }, '-',
      { cmd: 'layer.group' }, { cmd: 'layer.ungroup' }, '-',
      { label: 'Arrange', sub: [{ cmd: 'layer.front' }, { cmd: 'layer.forward' }, { cmd: 'layer.backward' }, { cmd: 'layer.back' }] },
      { label: 'Align', sub: ['left', 'hcenter', 'right', '-', 'top', 'vcenter', 'bottom'].map((h) => (h === '-' ? '-' : { cmd: 'layer.align.' + h, label: S.Cmd.get('layer.align.' + h).label.replace('Align ', '') })) },
      { label: 'Distribute', sub: ['h', 'hgap', '-', 'v', 'vgap'].map((h) => (h === '-' ? '-' : { cmd: 'layer.distribute.' + h, label: S.Cmd.get('layer.distribute.' + h).label.replace('Distribute ', '') })) },
      { label: 'Combine Shapes', sub: [{ cmd: 'layer.combine.unite' }, { cmd: 'layer.combine.subtract' }, { cmd: 'layer.combine.intersect' }, { cmd: 'layer.combine.exclude' }] },
      { label: 'Layer Comps', sub: [{ cmd: 'layer.compNew' }, { cmd: 'layer.compUpdate' }, { cmd: 'layer.compNext' }, { cmd: 'layer.compPrev' }, '-', { cmd: 'window.panel', arg: 'comps', label: 'Layer Comps Panel' }] },
      { label: 'Embedded Object', sub: [{ cmd: 'layer.convertEmbed' }, { cmd: 'layer.editContents' }, { cmd: 'layer.embedReset' }, '-', { cmd: 'layer.rasterize', label: 'Rasterize Object' }] },
      '-', { cmd: 'layer.rasterize' }, { cmd: 'layer.textToShape' }, { cmd: 'layer.trimToContent' }, { cmd: 'layer.trimToCanvas' }, { cmd: 'layer.lockAll' }, { cmd: 'layer.toggleVisible' }, '-',
      { cmd: 'layer.mergeDown' }, { cmd: 'layer.mergeVisible' }, { cmd: 'layer.stampVisible' }, { cmd: 'layer.flatten' }, '-', { cmd: 'layer.autoAlign' }, { cmd: 'layer.mergeExposures' },
    ] },
    { title: 'Select', items: () => [
      { cmd: 'select.all' }, { cmd: 'select.none' }, { cmd: 'select.reselect' }, { cmd: 'select.inverse' }, '-',
      { cmd: 'select.allLayers' }, { cmd: 'select.layerPixels' }, '-',
      { cmd: 'select.subject' }, { cmd: 'select.subjectLayer' }, { cmd: 'select.colorRange' }, { cmd: 'select.refine' },
      { label: 'Modify', sub: [{ cmd: 'select.border' }, { cmd: 'select.smooth' }, { cmd: 'select.expand' }, { cmd: 'select.contract' }, { cmd: 'select.feather' }] },
      { cmd: 'select.transform' }, '-',
      { cmd: 'select.quickMask' }, '-', { cmd: 'select.save' },
      { label: 'Load Selection', sub: () => (S.app.doc && S.app.doc.alphaChannels.length ? S.app.doc.alphaChannels.map((c) => ({ label: c.name, run: () => S.Cmd.run('select.load', c.id) })) : [{ label: 'No saved selections', disabled: true }]) },
      '-', { cmd: 'select.toPath' },
    ] },
    { title: 'Filter', items: filterMenu },
    { title: 'View', items: () => [
      { cmd: 'view.zoomIn' }, { cmd: 'view.zoomOut' }, { cmd: 'view.fit' }, { cmd: 'view.actual' }, { cmd: 'view.fill' }, '-',
      { cmd: 'view.showSelEdges' }, { cmd: 'view.showRulers' }, { cmd: 'view.showGrid' }, { cmd: 'view.showPixelGrid' }, { cmd: 'view.showGuides' }, '-',
      { cmd: 'view.snap' }, { cmd: 'view.lockGuides' }, { cmd: 'view.newGuide' }, { cmd: 'view.guideLayout' }, { cmd: 'view.clearGuides' }, '-',
      { cmd: 'view.clipWarn' }, { cmd: 'view.gamutWarn' }, { cmd: 'view.proofGray' }, '-',
      { cmd: 'view.focus' }, { cmd: 'view.fullscreen' },
    ] },
    { title: 'Window', items: () => [
      { label: 'Panels', sub: panelsMenu }, { cmd: 'window.secondDock' }, { cmd: 'window.reset' }, '-',
      { cmd: 'window.nextDoc' }, { label: 'Arrange', sub: [{ cmd: 'window.matchZoom' }, { cmd: 'window.matchLocation' }] }, ...(S.app.docs.length ? ['-', ...docsMenu()] : []),
    ] },
    { title: 'Help', items: () => [{ cmd: 'help.palette' }, { cmd: 'help.shortcuts' }, { cmd: 'help.tour' }, '-', { cmd: 'help.about' }] },
  ];
})();
