/* =========================================================================
   Gesso — application bootstrap: documents, tabs, welcome screen, status
   bar, keyboard handling, colors, autosave.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util, A = (S.App = S.App || {});

  /* ---------------- colors ---------------- */
  A.setFg = function (hex, quiet, fromPanel) {
    S.app.fg = hex; S.store.set('fg', hex);
    const e = document.querySelector('.swatch-fg'); if (e) e.style.background = hex;
    if (!fromPanel) S.bus.emit('color:changed');
    void quiet;
  };
  A.setBg = function (hex, fromPanel) {
    S.app.bg = hex; S.store.set('bg', hex);
    const e = document.querySelector('.swatch-bg'); if (e) e.style.background = hex;
    if (fromPanel !== true) S.bus.emit('color:changed');
  };

  /* ---------------- documents ---------------- */
  A.addDoc = function (d, historyName) {
    d.history.entries = [{ type: 'base', name: historyName || 'Open', undo() {}, redo() {}, time: Date.now() }];
    d.history.index = 0;
    // the opened/created pixels, kept for the History Brush (skipped on very large documents)
    d._openFlat = null;
    setTimeout(() => { try { if (d.width * d.height <= 40e6 && S.app.docs.includes(d)) { S.Compositor.update(d); d._openFlat = U.cloneCanvas(S.Compositor.flatten(d)); } } catch (e) { } }, 0);
    d.modified = false;
    S.app.docs.push(d);
    A.setActiveDoc(d);
    return d;
  };
  /** Commit whatever interactive session is live (transform, mesh warp, warp brush, text editing) */
  A.commitSessions = function () {
    if (S.Transform.active) S.Transform.commit();
    if (S.MeshWarp && S.MeshWarp.active) S.MeshWarp.commit();
    if (S.WarpTool && S.WarpTool.session) S.WarpTool.commit();
    if (S.TextTool && S.TextTool.edit) S.TextTool.commit();
  };
  A.setActiveDoc = function (d) {
    A.commitSessions();
    const prev = S.app.doc;
    if (prev && prev !== d) S.Compositor.dropCache(prev); // painting caches are only kept for the document on screen
    S.app.doc = d;
    document.body.classList.toggle('has-doc', !!d);
    A.renderTabs();
    A.renderWelcome();
    if (d) { if (d.view.needsFit) S.View.fit(d, true); d.invalidate(); }
    S.View.applyRulerVisibility();
    S.bus.emit('doc:switched', d);
    S.bus.emit('layers:changed', d);
    S.bus.emit('history:changed', d);
    S.Tools.renderOptions();
    const t = S.app.tool; if (t && t.activate && t.id === 'crop') t.activate();
    A.updateStatus();
  };
  A.closeDoc = async function (d) {
    if (!d) return true;
    if (d.modified && d.history.entries.length > 1) {
      const r = await S.Dialog.choice('Save changes to “' + d.name + '” before closing?', [{ label: 'Don’t Save', value: 'discard', cls: 'danger' }, { label: 'Cancel', value: 'cancel' }, { label: 'Save', value: 'save', primary: true }]);
      if (r === 'cancel' || r == null) return false;
      if (r === 'save') { S.App.setActiveDoc(d); await S.FileIO.saveProject(d, false); if (d.modified) return false; }
    }
    if (S.app.doc === d && S.Transform.active) S.Transform.cancel();
    if (S.app.doc === d && S.MeshWarp && S.MeshWarp.active) S.MeshWarp.cancel();
    if (S.app.doc === d && S.WarpTool && S.WarpTool.session) S.WarpTool.cancel();
    const i = S.app.docs.indexOf(d);
    S.app.docs.splice(i, 1);
    S.FileIO.clearRecovery(d);
    A.setActiveDoc(S.app.docs[Math.min(i, S.app.docs.length - 1)] || null);
    // release what the closed document held: its composite / caches and pooled scratch canvases of its size
    d.composite = null; S.Compositor.dropCache(d); d.history.entries.length = 0; d.layers = [];
    U.trimPool(S.app.docs.map((x) => [x.width, x.height]));
    S.bus.emit('doc:closed', d);
    return true;
  };

  /* ---------------- tabs ---------------- */
  A.renderTabs = function () {
    const el = document.getElementById('doctabs');
    el.innerHTML = '';
    for (const d of S.app.docs) {
      const t = U.el('div', { class: 'doctab' + (d === S.app.doc ? ' active' : ''), title: d.name + ' — ' + d.width + '×' + d.height });
      t.appendChild(U.el('span', { class: 'doctab-name' }, d.name));
      t.appendChild(U.el('span', { class: 'doctab-meta' }, '@' + Math.round(d.view.zoom * 100) + '%'));
      if (d.modified) t.appendChild(U.el('span', { class: 'doctab-dot', title: 'Unsaved changes' }));
      const x = U.el('button', { class: 'icon-btn doctab-x', html: S.icon('close'), title: 'Close' });
      x.addEventListener('click', (e) => { e.stopPropagation(); A.closeDoc(d); });
      t.addEventListener('mousedown', (e) => { if (e.button === 1) { e.preventDefault(); A.closeDoc(d); } });
      t.addEventListener('click', () => { if (d !== S.app.doc) A.setActiveDoc(d); });
      t.appendChild(x);
      el.appendChild(t);
    }
    const plus = U.el('button', { class: 'icon-btn doctab-new', html: S.icon('plus'), title: 'New document (Ctrl+N)' });
    plus.onclick = () => S.Cmd.run('file.new');
    el.appendChild(plus);
  };
  const refreshTabs = U.debounce(() => A.renderTabs(), 150);
  S.bus.on('history:changed', refreshTabs);
  S.bus.on('view:changed', refreshTabs);
  S.bus.on('doc:renamed', refreshTabs);

  /* ---------------- welcome ---------------- */
  A.renderWelcome = function () {
    const el = document.getElementById('welcome');
    if (S.app.doc) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.innerHTML = '';
    const recent = S.store.get('recent', []);
    const card = U.el('div', { class: 'welcome-card' });
    card.appendChild(U.el('div', { class: 'welcome-brand' }, [U.el('span', { html: S.brandMark.replace('class="mark"', 'class="mark big"') }), U.el('div', {}, [U.el('h1', {}, 'Gesso'), U.el('div', { class: 'muted' }, 'Layered image editor · Kiln Suite')])]));
    const actions = U.el('div', { class: 'welcome-actions' });
    const act = (icon, title, sub, fn) => { const b = U.el('button', { class: 'welcome-act' }, [U.el('span', { class: 'wa-ico', html: S.icon(icon) }), U.el('span', { class: 'wa-text' }, [U.el('b', {}, title), U.el('span', { class: 'muted' }, sub)])]); b.onclick = fn; actions.appendChild(b); };
    act('filePlus', 'New document', 'Ctrl+N — choose a size or preset', () => S.Cmd.run('file.new'));
    act('open', 'Open…', 'Ctrl+O — images or .kgesso projects', () => S.Cmd.run('file.open'));
    act('image', 'Paste from clipboard', 'Ctrl+V — opens as a new document', () => S.Clip.pasteFromMenu());
    card.appendChild(actions);
    const quick = U.el('div', { class: 'welcome-quick' });
    for (const [n, w, h] of [['1920 × 1080', 1920, 1080], ['1080 × 1080', 1080, 1080], ['1080 × 1920', 1080, 1920], ['A4 300ppi', 2480, 3508]]) {
      const b = U.el('button', { class: 'btn' }, n);
      b.onclick = () => A.createDoc({ name: 'Untitled-' + (S.app.docs.length + 1), w, h, dpi: w === 2480 ? 300 : 72, bg: 'white' });
      quick.appendChild(b);
    }
    card.appendChild(U.el('div', { class: 'welcome-section' }, 'Quick start'));
    card.appendChild(quick);
    card.appendChild(U.el('div', { class: 'welcome-section' }, 'Recent'));
    const rl = U.el('div', { class: 'welcome-recent' });
    if (!recent.length) rl.appendChild(U.el('div', { class: 'muted' }, 'Files you open or save will appear here.'));
    for (const r of recent.slice(0, 8)) {
      const row = U.el('button', { class: 'recent-row' }, [U.el('span', { html: S.icon(/\.k(gesso|strata)$/.test(r.name) ? 'layers' : 'image') }), U.el('span', { class: 'rr-name' }, r.name), U.el('span', { class: 'muted' }, new Date(r.time).toLocaleDateString())]);
      row.onclick = () => S.FileIO.openRecent(r.name);
      rl.appendChild(row);
    }
    card.appendChild(rl);
    card.appendChild(U.el('div', { class: 'welcome-foot muted' }, 'Tip: drag image files anywhere onto this window to open them.'));
    el.appendChild(card);
  };
  S.bus.on('recent:changed', () => A.renderWelcome());

  /* ---------------- status bar ---------------- */
  A.updateStatus = function () {
    const d = S.app.doc;
    const z = document.getElementById('st-zoom'), sz = document.getElementById('st-size'), cur = document.getElementById('st-cursor'), col = document.getElementById('st-color'), tl = document.getElementById('st-tool');
    if (!d) { z.textContent = ''; sz.textContent = ''; cur.textContent = ''; col.innerHTML = ''; tl.textContent = S.app.tool ? S.app.tool.name : ''; return; }
    if (document.activeElement !== z) z.value = Math.round(d.view.zoom * 1000) / 10;
    sz.textContent = d.width + ' × ' + d.height + ' px' + (d.selection ? '  ·  sel ' + d.selection.bounds.w + '×' + d.selection.bounds.h : '');
    tl.textContent = (S.app.tool ? S.app.tool.name : '') + (d.quickMask ? '  ·  QUICK MASK' : '') + (d.activeLayer() && d.activeLayer().editMask ? '  ·  editing mask' : '');
  };
  const statusCursor = (info) => {
    const d = S.app.doc; if (!d) return;
    const x = Math.floor(info.x), y = Math.floor(info.y);
    document.getElementById('st-cursor').textContent = 'X ' + x + '  Y ' + y;
    const col = document.getElementById('st-color');
    if (d.composite && x >= 0 && y >= 0 && x < d.width && y < d.height) {
      const p = U.samplePixels(d.composite, x, y);
      col.innerHTML = '<span class="st-sw" style="background:rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + p[3] / 255 + ')"></span>' + U.rgbToHex(p[0], p[1], p[2]) + ' · α ' + Math.round((p[3] / 255) * 100) + '%';
    } else col.textContent = '';
  };
  let lastCur = 0;
  S.bus.on('cursor:moved', (info) => { const n = performance.now(); if (n - lastCur > 40) { lastCur = n; statusCursor(info); } });
  ['view:changed', 'selection:changed', 'tool:changed', 'doc:switched', 'activeLayer:changed', 'layers:changed', 'doc:resized'].forEach((e) => S.bus.on(e, () => A.updateStatus()));

  /* ---------------- keyboard ---------------- */
  function isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes(t.type) || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }
  function onKeyDown(e) {
    A.altDown = e.altKey;
    // stop a lone Alt from moving keyboard focus to the browser's menu (Windows)
    if (e.key === 'Alt' && !isTyping(e)) e.preventDefault();
    if (S.Dialog.isOpen() || isTyping(e) || S.Menu.isOpen()) return;
    const d = S.app.doc, tool = S.app.tool;
    if (e.code === 'Space' && !e.repeat) {
      if (tool && tool.keepSpace && tool.edit) return;
      S.View.spaceDown = true; S.View.updateCursor(); e.preventDefault(); return;
    }
    if (e.code === 'Space') { e.preventDefault(); return; }
    // tool-specific keys first (Enter/Escape/arrows/Delete…)
    if (d && tool && tool.onKey && tool.onKey(e, d)) { e.preventDefault(); S.View.redraw(); return; }
    const ks = S.Cmd.eventKey(e);
    if (!ks) return;
    // Ctrl+V: let the native paste event fire (gives access to system clipboard images)
    if (ks === 'Ctrl+V') return;
    if (ks === 'Escape' && d && d.selection && !(tool && tool.drag)) { /* Escape doesn't deselect, mirrors pro editors */ }
    const id = S.Cmd.forKey(ks);
    if (id) {
      e.preventDefault();
      // history jumps while the mouse is still down (mid-stroke, mid-drag) would pull the canvas from under the tool
      if (S.View.dragging && (id === 'edit.undo' || id === 'edit.redo' || id === 'file.close' || id === 'file.closeAll')) return;
      S.Cmd.run(id);
      return;
    }
    // brush size / hardness / opacity
    const o = tool && tool.opts;
    if (o && (e.key === '[' || e.key === ']' || e.code === 'BracketLeft' || e.code === 'BracketRight') && !e.ctrlKey) {
      const up = e.code === 'BracketRight';
      if (e.shiftKey && o.hardness != null) o.hardness = U.clamp(Math.round((o.hardness + (up ? 0.25 : -0.25)) * 4) / 4, 0, 1);
      else if (o.size != null) { const s = o.size, step = s < 10 ? 1 : s < 50 ? 5 : s < 100 ? 10 : s < 300 ? 25 : 50; o.size = U.clamp(up ? s + step : s - step, 1, 2500); }
      S.Tools.saveOpts(); S.Tools.syncOptions(); S.bus.emit('tool:options', tool); S.View.redraw(); e.preventDefault(); return;
    }
    if (o && /^Digit\d$/.test(e.code) && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const n = +e.code.slice(5); const v = n === 0 ? 100 : n * 10;
      const key = o.opacity != null ? 'opacity' : o.strength != null ? 'strength' : o.exposure != null ? 'exposure' : null;
      if (key) { o[key] = v; S.Tools.saveOpts(); S.Tools.syncOptions(); S.toast(tool.name + ' ' + key + ': ' + v + '%', 700); }
      e.preventDefault(); return;
    }
    // single-letter tools (not in the middle of a drag: the stroke in progress would lose its tool)
    if (!e.ctrlKey && !e.metaKey && !e.altKey && /^Key[A-Z]$/.test(e.code)) {
      if (S.Transform.active || (S.MeshWarp && S.MeshWarp.active) || S.View.dragging) return;
      if (S.Tools.byKey(e.code.slice(3), e.shiftKey)) { e.preventDefault(); return; }
    }
  }
  function onKeyUp(e) {
    A.altDown = e.altKey;
    if (e.key === 'Alt' && !isTyping(e)) e.preventDefault();
    if (e.code === 'Space') { S.View.spaceDown = false; S.View.updateCursor(); }
    if (S.app.tool && S.app.tool.id === 'zoom') S.View.updateCursor();
  }

  /* ---------------- autosave ---------------- */
  let autosaveTimer = null;
  A.startAutosave = function () {
    clearInterval(autosaveTimer);
    const m = S.app.prefs.autosaveMin;
    if (m > 0) autosaveTimer = setInterval(() => S.FileIO.autosave(), m * 60000);
  };

  /* ---------------- boot ---------------- */
  A.boot = function () {
    S.app.prefs = Object.assign({}, A.PREF_DEFAULTS, S.store.get('prefs', {}));
    S.app.fg = S.store.get('fg', '#000000'); S.app.bg = S.store.get('bg', '#ffffff');
    // brand + menubar
    const mb = document.getElementById('menubar');
    mb.appendChild(U.el('div', { class: 'brand' }, [U.el('span', { html: S.brandMark }), U.el('span', {}, 'Gesso')]));
    S.Menu.bar(mb, S.MENUS);
    mb.appendChild(U.el('div', { style: { flex: 1 } }));
    const quick = U.el('div', { class: 'mb-quick' });
    for (const [ic, cmd, tip] of [['undo', 'edit.undo', 'Undo (Ctrl+Z)'], ['redo', 'edit.redo', 'Redo (Ctrl+Shift+Z)'], ['save', 'file.save', 'Save project (Ctrl+S)'], ['image', 'file.export', 'Export (Ctrl+Alt+S)']]) {
      const b = U.el('button', { class: 'icon-btn', html: S.icon(ic), 'data-tip': tip, 'data-tip-pos': 'bottom' });
      b.onclick = () => S.Cmd.run(cmd); quick.appendChild(b);
    }
    mb.appendChild(quick);
    S.View.init(document.getElementById('workspace'));
    S.Tools.initStrip(document.getElementById('toolstrip'));
    S.Tools.initOptions(document.getElementById('optionsbar'));
    S.Panels.init(document.getElementById('dock'));
    const last = S.store.get('lastTool', 'brush');
    S.Tools.select(S.Tools.byId[last] ? last : 'brush');
    // status bar zoom field
    const z = document.getElementById('st-zoom');
    z.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { S.View.setZoom(U.clamp(+z.value, 1, 6400) / 100); z.blur(); } });
    addEventListener('keydown', onKeyDown);
    addEventListener('keyup', onKeyUp);
    addEventListener('blur', () => { S.View.spaceDown = false; A.altDown = false; });
    document.addEventListener('paste', (e) => { if (S.Dialog.isOpen()) return; S.Clip.handlePaste(e); });
    S.FileIO.initDrop();
    addEventListener('beforeunload', (e) => {
      if (S.app.docs.some((d) => d.modified && d.history.entries.length > 1)) { S.FileIO.autosave(); e.preventDefault(); e.returnValue = ''; }
    });
    A.applyPrefs();
    A.setActiveDoc(null);
    A.startAutosave();
    setTimeout(() => S.FileIO.checkRecovery(), 400);
    // keep the dock thumbnails fresh after strokes
    S.bus.on('history:changed', () => S.bus.emit('thumbs:refresh'));
    console.info('Gesso ' + S.version + ' ready — ImageFX ' + (window.ImageFX ? ImageFX.version : 'missing'));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', A.boot); else A.boot();
})();
