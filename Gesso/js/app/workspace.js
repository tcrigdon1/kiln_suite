/* =========================================================================
   Gesso — workspace & quality-of-life features:
     • Command palette (Ctrl+Shift+K / F3): fuzzy search over commands, filters, adjustments, panels, tools
     • Welcome tour (Help ▸ Welcome Tour; offered once on first launch)
     • Recent colours (Swatches panel), Window ▸ Match Zoom / Match Location
     • View ▸ Clipping Warning (shadow / highlight clipping overlay), Gamut Warning, Proof Colors ▸ Grayscale
     • Histogram clipping read-out, per-document autosave toggle, status-bar colour profile
     • Edit ▸ Customize Toolbar… (hide / show tool groups), quick-mask colour & opacity preferences
     • Display colour space preference (sRGB / Display P3 when the browser supports it)
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util, A = (S.App = S.App || {});
  const doc = () => S.app.doc;

  /* ======================= Command palette ======================= */
  const Pal = (S.Palette = {});
  const GROUPS = { file: 'File', edit: 'Edit', image: 'Image', layer: 'Layer', select: 'Select', path: 'Paths', filter: 'Filter', view: 'View', window: 'Window', help: 'Help', color: 'Color' };
  Pal.items = function () {
    const out = [];
    for (const id of S.Cmd.order) {
      const c = S.Cmd.map[id];
      if (['image.adjust', 'layer.newAdjustment', 'filter.apply', 'window.panel', 'view.channel', 'select.load'].includes(id)) continue;
      out.push({ label: c.label.replace(/…$/, ''), group: GROUPS[id.split('.')[0]] || 'Other', kbd: S.Cmd.keyLabel(id), run: () => S.Cmd.run(id), enabled: () => !c.enabled || c.enabled() });
    }
    if (window.ImageFX) {
      for (const id in ImageFX.filters) { const fx = ImageFX.filters[id]; out.push({ label: fx.name.replace(/…$/, ''), group: 'Filter ▸ ' + (fx.category || 'Other'), run: () => S.Cmd.run('filter.apply', id), enabled: () => !!(doc() && doc().activeLayer()) }); }
      for (const fx of S.adjList()) { out.push({ label: fx.name + ' (adjustment layer)', group: 'Adjust', run: () => S.Cmd.run('layer.newAdjustment', fx.id), enabled: () => !!doc() }); out.push({ label: fx.name + ' (apply to layer)', group: 'Adjust', run: () => S.Cmd.run('image.adjust', fx.id), enabled: () => !!(doc() && doc().activeLayer()) }); }
    }
    for (const id in S.Panels.defs) out.push({ label: S.Panels.defs[id].title + ' panel', group: 'Window', run: () => S.Panels.show(id), enabled: () => true });
    for (const t of S.Tools.list) out.push({ label: t.name + ' tool', group: 'Tools', kbd: t.key || '', run: () => S.Tools.select(t.id), enabled: () => true });
    return out;
  };
  /** fuzzy score: subsequence match, bonuses for word starts and consecutive characters */
  Pal.score = function (q, text) {
    q = q.toLowerCase(); text = text.toLowerCase();
    if (!q) return 1;
    let ti = 0, score = 0, last = -2;
    for (const ch of q) {
      const i = text.indexOf(ch, ti); if (i < 0) return 0;
      score += 1 + (i === last + 1 ? 2 : 0) + (i === 0 || /[\s▸(/]/.test(text[i - 1]) ? 2 : 0);
      last = i; ti = i + 1;
    }
    return score / (1 + text.length * 0.02);
  };
  Pal.open = function () {
    if (document.querySelector('.palette')) return;
    const items = Pal.items(), recent = S.store.get('palette.recent', []);
    const wrap = U.el('div', { class: 'palette-backdrop' }), box = U.el('div', { class: 'palette' });
    const inp = U.el('input', { type: 'text', placeholder: 'Type a command, filter, panel or tool…', spellcheck: false });
    const list = U.el('div', { class: 'palette-list' });
    let rows = [], sel = 0;
    const close = () => { wrap.remove(); removeEventListener('keydown', onKey, true); };
    const render = () => {
      const q = inp.value.trim();
      let scored = items.map((it) => ({ it, s: Pal.score(q, it.label + ' ' + it.group) })).filter((x) => x.s > 0);
      if (!q) scored = scored.sort((a, b) => (recent.indexOf(b.it.label) >= 0 ? recent.length - recent.indexOf(b.it.label) : 0) - (recent.indexOf(a.it.label) >= 0 ? recent.length - recent.indexOf(a.it.label) : 0));
      else scored.sort((a, b) => b.s - a.s);
      rows = scored.slice(0, 14).map((x) => x.it);
      sel = Math.min(sel, Math.max(0, rows.length - 1));
      list.innerHTML = '';
      rows.forEach((it, i) => {
        const en = it.enabled();
        const r = U.el('div', { class: 'palette-row' + (i === sel ? ' sel' : '') + (en ? '' : ' disabled') }, [U.el('span', { class: 'palette-group' }, it.group), U.el('span', { class: 'palette-label' }, it.label), U.el('span', { class: 'kbd' }, it.kbd || '')]);
        r.addEventListener('mousemove', () => { if (sel !== i) { sel = i; render(); } });
        r.addEventListener('mousedown', (e) => { e.preventDefault(); run(i); });
        list.appendChild(r);
      });
      if (!rows.length) list.appendChild(U.el('div', { class: 'palette-row muted' }, 'No matches'));
    };
    const run = (i) => {
      const it = rows[i]; if (!it) return;
      if (!it.enabled()) { S.toast('“' + it.label + '” is not available right now', 1200); return; }
      close();
      const rc = [it.label].concat(recent.filter((x) => x !== it.label)).slice(0, 10); S.store.set('palette.recent', rc);
      setTimeout(() => it.run(), 0);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(rows.length - 1, sel + 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); run(sel); }
      else e.stopPropagation();
    };
    inp.addEventListener('input', () => { sel = 0; render(); });
    addEventListener('keydown', onKey, true);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    box.append(U.el('div', { class: 'palette-head' }, [U.el('span', { html: S.icon('zoom') }), inp]), list, U.el('div', { class: 'palette-foot muted' }, '↑↓ choose · Enter run · Esc close'));
    wrap.appendChild(box); document.body.appendChild(wrap);
    render(); setTimeout(() => inp.focus(), 10);
  };
  S.Cmd.register('help.palette', { label: 'Command Palette…', key: 'Ctrl+Shift+K,F3', run: () => Pal.open() });

  /* ======================= Welcome tour ======================= */
  const TOUR = [
    { sel: '#menubar', title: 'Menus', text: 'Everything lives in the menus. Shortcuts are shown next to the commands and can be changed in Edit ▸ Keyboard Shortcuts. Ctrl+Shift+K (or F3) opens a command palette that searches all of them.' },
    { sel: '#toolstrip', title: 'Tools', text: 'Painting, selection, retouching (Heal, Patch, Remove), warping, text and shape tools. Press a tool’s letter to pick it; Shift+letter cycles a group; right-click a button for the flyout.' },
    { sel: '#optionsbar', title: 'Tool options', text: 'The bar changes with the tool: brush size, hardness, blend mode, selection modes, transform numbers… Drag a label to scrub a value.' },
    { sel: '.panel-layers', fallback: '#dock', title: 'Layers', text: 'Pixel, text, shape, fill and adjustment layers, groups, masks, clipping, effects (fx) and embedded objects (◈). Double-click a name to rename, drag rows to reorder, drag panel tabs to re-dock them.' },
    { sel: '#workspace', title: 'Canvas', text: 'Space+drag pans, Ctrl+wheel zooms under the cursor, drag from the rulers for guides, Tab hides the panels. Drop image files anywhere to open them.' },
    { sel: '#statusbar', title: 'Status bar', text: 'Zoom, size, cursor position and colour, the document’s pixel memory (Window ▸ Panels ▸ Performance for details) and the active tool.' },
  ];
  A.tour = function () {
    let i = 0;
    const back = U.el('div', { class: 'tour-backdrop' }), spot = U.el('div', { class: 'tour-spot' }), card = U.el('div', { class: 'tour-card' });
    back.append(spot, card); document.body.appendChild(back);
    const end = () => { back.remove(); removeEventListener('keydown', onKey, true); S.store.set('tourSeen', true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(); } else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); step(i + 1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); step(i - 1); } };
    addEventListener('keydown', onKey, true);
    const step = (n) => {
      if (n < 0) n = 0;
      if (n >= TOUR.length) { end(); return; }
      i = n;
      const t = TOUR[i];
      const el = document.querySelector(t.sel) || (t.fallback && document.querySelector(t.fallback)) || document.body;
      const r = el.getBoundingClientRect();
      Object.assign(spot.style, { left: r.left - 4 + 'px', top: r.top - 4 + 'px', width: r.width + 8 + 'px', height: r.height + 8 + 'px' });
      card.innerHTML = '';
      card.append(U.el('div', { class: 'tour-step muted' }, (i + 1) + ' / ' + TOUR.length), U.el('h3', {}, t.title), U.el('p', {}, t.text));
      const row = U.el('div', { class: 'row tour-btns' });
      const skip = U.el('button', { class: 'btn ghost btn-sm' }, 'Skip'); skip.onclick = end;
      const prev = U.el('button', { class: 'btn btn-sm', disabled: i === 0 }, 'Back'); prev.onclick = () => step(i - 1);
      const next = U.el('button', { class: 'btn primary btn-sm' }, i === TOUR.length - 1 ? 'Done' : 'Next'); next.onclick = () => step(i + 1);
      row.append(skip, U.el('div', { style: { flex: 1 } }), prev, next); card.appendChild(row);
      // place the card near the spotlight, inside the window
      const cw = 340, ch = 190;
      let cx = r.left + r.width / 2 - cw / 2, cy = r.bottom + 14;
      if (cy + ch > innerHeight) cy = r.top - ch - 14; if (cy < 8) cy = Math.max(8, innerHeight / 2 - ch / 2);
      if (r.width < innerWidth * 0.3 && r.left > innerWidth / 2) cx = r.left - cw - 14; else if (r.width < innerWidth * 0.3 && r.right < innerWidth / 2) cx = r.right + 14;
      cx = U.clamp(cx, 8, innerWidth - cw - 8);
      Object.assign(card.style, { left: cx + 'px', top: cy + 'px', width: cw + 'px' });
      next.focus();
    };
    step(0);
  };
  S.Cmd.register('help.tour', { label: 'Welcome Tour', run: () => A.tour() });
  /** first launch: offer the tour without getting in the way */
  A.offerTour = function () {
    if (S.store.get('tourSeen', false)) return;
    const bar = U.el('div', { class: 'tour-offer' }, [U.el('span', {}, 'New to Gesso? Take the 1-minute tour of the workspace.'), U.el('button', { class: 'btn primary btn-sm' }, 'Start tour'), U.el('button', { class: 'btn ghost btn-sm' }, 'No thanks')]);
    bar.querySelectorAll('button')[0].onclick = () => { bar.remove(); A.tour(); };
    bar.querySelectorAll('button')[1].onclick = () => { bar.remove(); S.store.set('tourSeen', true); };
    document.body.appendChild(bar);
    setTimeout(() => { if (bar.parentNode) bar.remove(); }, 20000);
  };

  /* ======================= Recent colours ======================= */
  A.recentColors = () => S.store.get('recentColors', []);
  A.pushRecentColor = function (hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    const rc = [hex.toLowerCase()].concat(A.recentColors().filter((c) => c !== hex.toLowerCase())).slice(0, 14);
    S.store.set('recentColors', rc); S.bus.emit('recentColors:changed');
  };
  // record colours chosen through the picker (committed values), not every drag step
  const setFg0 = A.setFg;
  let fgTimer = null;
  A.setFg = function (hex, quiet, fromPanel) { setFg0(hex, quiet, fromPanel); clearTimeout(fgTimer); fgTimer = setTimeout(() => A.pushRecentColor(S.app.fg), 900); };

  /* ======================= Window ▸ Match zoom / location ======================= */
  S.Cmd.register('window.matchZoom', { label: 'Match Zoom (all documents)', run: () => { const z = doc().view.zoom; for (const d of S.app.docs) if (d !== doc()) { d.view.zoom = z; d.view.needsFit = false; } S.toast('All documents at ' + Math.round(z * 100) + ' %'); }, enabled: () => S.app.docs.length > 1 });
  S.Cmd.register('window.matchLocation', { label: 'Match Zoom and Location', run: () => { const v = doc().view; for (const d of S.app.docs) if (d !== doc()) { d.view.zoom = v.zoom; d.view.panX = v.panX; d.view.panY = v.panY; d.view.needsFit = false; } S.toast('View matched'); }, enabled: () => S.app.docs.length > 1 });

  /* ======================= per-document autosave, profile in the status bar ======================= */
  S.Cmd.register('file.autosaveDoc', { label: 'Autosave This Document', run: () => { const d = doc(); d.autosave = d.autosave === false; S.toast(d.autosave === false ? 'Autosave off for ' + d.name : 'Autosave on for ' + d.name); }, checked: () => !!(doc() && doc().autosave !== false), enabled: () => !!doc() });
  const autosave0 = S.FileIO.autosave;
  S.FileIO.autosave = async function () { const skip = S.app.docs.filter((d) => d.autosave === false); skip.forEach((d) => (d._autosavedIndex = d.history.index)); return autosave0(); };
  const upd0 = A.updateStatus;
  A.updateStatus = function () { upd0(); const d = doc(), sz = document.getElementById('st-size'); if (d && sz) sz.textContent += '  ·  ' + (S.app.prefs.displaySpace === 'display-p3' ? 'sRGB → P3 display' : 'sRGB'); };

  /* ======================= view overlays: clipping / gamut warnings, proof colours ======================= */
  const V = S.View;
  V.clipWarn = false; V.gamutWarn = false; V.proof = 'none';
  let ovCache = null;
  function overlayCanvas(d) {
    const key = d.id + ':' + d.compositeVersion + ':' + V.clipWarn + ':' + V.gamutWarn + ':' + d.width + 'x' + d.height;
    if (ovCache && ovCache.key === key) return ovCache.c;
    const k = Math.min(1, 1024 / Math.max(d.width, d.height)), w = Math.max(1, Math.round(d.width * k)), h = Math.max(1, Math.round(d.height * k));
    const c = U.createCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(d.composite, 0, 0, w, h);
    const img = x.getImageData(0, 0, w, h), p = img.data;
    for (let i = 0; i < p.length; i += 4) {
      const r = p[i], g = p[i + 1], b = p[i + 2], a = p[i + 3];
      let show = 0;
      if (V.clipWarn && a) { if (r >= 254 && g >= 254 && b >= 254) show = 1; else if (r <= 1 && g <= 1 && b <= 1) show = 2; else if (r >= 254 || g >= 254 || b >= 254) show = 3; }
      if (!show && V.gamutWarn && a) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx > 200 && mx - mn > 215) show = 4; }
      if (show === 1) { p[i] = 255; p[i + 1] = 60; p[i + 2] = 60; p[i + 3] = 230; }
      else if (show === 2) { p[i] = 60; p[i + 1] = 120; p[i + 2] = 255; p[i + 3] = 230; }
      else if (show === 3) { p[i] = 255; p[i + 1] = 180; p[i + 2] = 40; p[i + 3] = 200; }
      else if (show === 4) { p[i] = 140; p[i + 1] = 140; p[i + 2] = 140; p[i + 3] = 230; }
      else p[i + 3] = 0;
    }
    x.putImageData(img, 0, 0);
    ovCache = { key, c };
    return c;
  }
  // overlays are drawn by the viewport right after the composite (see View.drawOverlays); proof colours are a
  // canvas filter on the composite blit (View.proofFilter)
  V.drawOverlays = function (ctx, d) {
    if (!(V.clipWarn || V.gamutWarn) || !d.composite) return;
    const c = overlayCanvas(d);
    ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(c, 0, 0, d.width, d.height); ctx.restore();
  };
  V.proofFilter = () => (V.proof === 'gray' ? 'grayscale(1)' : 'none');
  const tog = (id, key, label, k) => S.Cmd.register(id, { label, key: k, run: () => { V[key] = !V[key]; ovCache = null; V.redraw(true); }, checked: () => !!V[key], enabled: () => !!doc() });
  tog('view.clipWarn', 'clipWarn', 'Clipping Warning (red = highlights, blue = shadows, orange = channel)', 'Ctrl+Alt+Shift+H');
  tog('view.gamutWarn', 'gamutWarn', 'Gamut Warning (very saturated colours shown gray)', 'Ctrl+Shift+Y');
  S.Cmd.register('view.proofGray', { label: 'Proof Colors: Grayscale', key: 'Ctrl+Alt+Shift+Y', run: () => { V.proof = V.proof === 'gray' ? 'none' : 'gray'; V.redraw(true); }, checked: () => V.proof === 'gray', enabled: () => !!doc() });

  /* ======================= Customize toolbar ======================= */
  A.customizeToolbarDialog = function () {
    const hidden = new Set(S.app.prefs.hiddenTools || []);
    const list = U.el('div', { class: 'tb-list' });
    for (const g of S.Tools.GROUP_ORDER) {
      const members = S.Tools.list.filter((t) => t.group === g); if (!members.length) continue;
      const cb = U.el('input', { type: 'checkbox', checked: !hidden.has(g) });
      cb.addEventListener('change', () => { if (cb.checked) hidden.delete(g); else hidden.add(g); });
      list.appendChild(U.el('label', { class: 'check-row' }, [cb, U.el('span', { html: S.icon(members[0].icon) }), U.el('span', {}, members.map((m) => m.name).join(' / '))]));
    }
    S.Dialog.open({ title: 'Customize Toolbar', width: 420, body: U.el('div', {}, [U.el('div', { class: 'muted', style: { marginBottom: '8px' } }, 'Untick a group to hide it from the tool strip (its shortcut keys keep working).'), list]),
      buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, run: () => { S.app.prefs.hiddenTools = [...hidden]; S.store.set('prefs', S.app.prefs); S.Tools.renderStrip(); } }] });
  };
  S.Cmd.register('edit.customizeToolbar', { label: 'Customize Toolbar…', run: () => A.customizeToolbarDialog() });
  const strip0 = S.Tools.renderStrip;
  S.Tools.renderStrip = function () {
    strip0();
    const hidden = S.app.prefs.hiddenTools || [];
    if (!hidden.length || !S.Tools.stripEl) return;
    S.Tools.stripEl.querySelectorAll('.tool-btn[data-tool]').forEach((b) => { const t = S.Tools.byId[b.dataset.tool]; if (t && hidden.includes(t.group)) b.style.display = 'none'; });
  };

  /* ======================= preferences: quick mask colour, display space ======================= */
  Object.assign(A.PREF_DEFAULTS, { qmColor: '#e62828', qmOpacity: 50, displaySpace: 'srgb', hiddenTools: [], paintCache: true });
  const prefs0 = A.prefsDialog;
  A.prefsDialog = function () {
    prefs0();
    // extend the open preferences form with the extra settings
    const dlg = S.Dialog.top(); if (!dlg) return;
    const p = S.app.prefs;
    const extra = S.ParamUI.build([
      { id: 'h5', type: 'header', label: 'Quick mask & colour' },
      { id: 'qmColor', label: 'Quick mask color', type: 'color', default: p.qmColor },
      { id: 'qmOpacity', label: 'Quick mask opacity', type: 'range', default: p.qmOpacity, min: 10, max: 100, unit: '%' },
      { id: 'displaySpace', label: 'Display color space', type: 'select', default: p.displaySpace, options: [{ value: 'srgb', label: 'sRGB (default)' }, { value: 'display-p3', label: 'Display P3 (wide-gamut screens)' }] },
      { id: 'paintCache', label: 'Painting cache (faster brushes on many-layer documents)', type: 'checkbox', default: p.paintCache !== false },
    ], {}, (v) => { Object.assign(S.app.prefs, { qmColor: v.qmColor, qmOpacity: v.qmOpacity, displaySpace: v.displaySpace, paintCache: v.paintCache }); S.store.set('prefs', S.app.prefs); A.applyDisplaySpace(); if (doc()) doc().invalidate(); });
    dlg.body.appendChild(extra);
  };
  A.applyDisplaySpace = function () {
    const want = S.app.prefs.displaySpace === 'display-p3' ? 'display-p3' : 'srgb';
    if (V._space === want) return;
    // a canvas keeps the colour space of its first context → the viewport canvas is recreated
    const got = V.recreateCanvas();
    if (got !== want) { S.toast('Display P3 is not supported by this browser — staying in sRGB'); S.app.prefs.displaySpace = 'srgb'; S.store.set('prefs', S.app.prefs); }
    A.updateStatus(); V.redraw(true);
  };
  // quick mask overlay colour / opacity come from the preferences (viewport reads them through this hook)
  S.quickMaskStyle = () => { const c = U.hexToRgb(S.app.prefs.qmColor || '#e62828'); return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + (S.app.prefs.qmOpacity || 50) / 100 + ')'; };

  /* boot-time pieces */
  S.bus.on('doc:switched', () => setTimeout(() => A.updateStatus(), 0));
  setTimeout(() => { A.applyDisplaySpace(); if (!S.app.docs.length) A.offerTour(); }, 1200);
})();
