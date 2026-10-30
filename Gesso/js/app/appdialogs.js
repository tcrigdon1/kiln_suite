/* =========================================================================
   Gesso — application dialogs: New Document, Image Size, Canvas Size, Trim,
   Fill, Stroke, Color Range, Select & Refine, Guide Layout, Preferences,
   Keyboard Shortcuts, About; plus context menus and misc helpers.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util, A = (S.App = S.App || {});
  const doc = () => S.app.doc;

  /* ---------------- New Document ---------------- */
  const PRESETS = [
    { name: 'Full HD', w: 1920, h: 1080, dpi: 72, cat: 'Screen' }, { name: '4K UHD', w: 3840, h: 2160, dpi: 72, cat: 'Screen' },
    { name: 'Web 1366', w: 1366, h: 768, dpi: 72, cat: 'Screen' }, { name: 'Thumbnail 720p', w: 1280, h: 720, dpi: 72, cat: 'Screen' },
    { name: 'Square 1080', w: 1080, h: 1080, dpi: 72, cat: 'Social' }, { name: 'Portrait Post', w: 1080, h: 1350, dpi: 72, cat: 'Social' },
    { name: 'Story / Reel', w: 1080, h: 1920, dpi: 72, cat: 'Social' }, { name: 'Banner 3:1', w: 1500, h: 500, dpi: 72, cat: 'Social' },
    { name: 'A4 · 300 ppi', w: 2480, h: 3508, dpi: 300, cat: 'Print' }, { name: 'US Letter · 300 ppi', w: 2550, h: 3300, dpi: 300, cat: 'Print' },
    { name: 'A5 · 300 ppi', w: 1748, h: 2480, dpi: 300, cat: 'Print' }, { name: '4×6 Photo', w: 1800, h: 1200, dpi: 300, cat: 'Print' },
    { name: 'Icon 512', w: 512, h: 512, dpi: 72, cat: 'Other' }, { name: 'Pixel Art 64', w: 64, h: 64, dpi: 72, cat: 'Other' },
  ];
  const UNITS = { px: 1, in: null, cm: 2.54, mm: 25.4 };
  const toPx = (v, unit, dpi) => (unit === 'px' ? v : unit === 'in' ? v * dpi : (v / UNITS[unit]) * dpi);
  const fromPx = (v, unit, dpi) => (unit === 'px' ? v : unit === 'in' ? v / dpi : (v / dpi) * UNITS[unit]);

  A.newDocDialog = function () {
    const last = S.store.get('newdoc', { w: 1920, h: 1080, dpi: 72, bg: 'white', color: '#ffffff', unit: 'px' });
    const st = Object.assign({}, last, { name: 'Untitled-' + (S.app.docs.length + 1) });
    if (S.Clip.data) PRESETS.unshift({ name: 'Clipboard', w: S.Clip.data.w, h: S.Clip.data.h, dpi: 72, cat: 'Recent' }) && setTimeout(() => PRESETS.shift(), 0);
    const left = U.el('div', { class: 'nd-presets' });
    let cat = 'Screen';
    const cats = [...new Set(PRESETS.map((p) => p.cat))];
    const catTabs = U.el('div', { class: 'tabs nd-cats' });
    const cards = U.el('div', { class: 'nd-cards' });
    left.append(catTabs, cards);
    const right = U.el('div', { class: 'nd-fields' });
    const name = U.el('input', { type: 'text', value: st.name });
    const w = U.el('input', { type: 'number', min: 1 }), h = U.el('input', { type: 'number', min: 1 });
    const unit = U.el('select', {}, ['px', 'in', 'cm', 'mm'].map((u) => U.el('option', { value: u }, u)));
    const dpi = U.el('input', { type: 'number', min: 1, max: 4800, value: st.dpi });
    const orient = U.el('button', { class: 'icon-btn', html: S.icon('rotateCW'), title: 'Swap width and height' });
    const bg = U.el('select', {}, [['white', 'White'], ['black', 'Black'], ['transparent', 'Transparent'], ['fg', 'Foreground color'], ['bgc', 'Background color'], ['custom', 'Custom…']].map(([v, l]) => U.el('option', { value: v }, l)));
    const chip = U.el('button', { class: 'color-chip', style: { background: st.color } });
    const info = U.el('div', { class: 'muted nd-info' });
    unit.value = st.unit; bg.value = st.bg;
    const syncFields = () => { w.value = +fromPx(st.w, unit.value, st.dpi).toFixed(unit.value === 'px' ? 0 : 2); h.value = +fromPx(st.h, unit.value, st.dpi).toFixed(unit.value === 'px' ? 0 : 2); dpi.value = st.dpi; upd(); };
    const upd = () => { info.textContent = st.w + ' × ' + st.h + ' px · ' + ((st.w * st.h * 4) / 1048576).toFixed(1) + ' MB per layer'; chip.style.display = bg.value === 'custom' ? '' : 'none'; };
    [w, h, dpi, name].forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));
    w.addEventListener('input', () => { st.w = Math.max(1, Math.round(toPx(+w.value, unit.value, st.dpi))); upd(); renderCards(); });
    h.addEventListener('input', () => { st.h = Math.max(1, Math.round(toPx(+h.value, unit.value, st.dpi))); upd(); renderCards(); });
    dpi.addEventListener('input', () => { st.dpi = Math.max(1, +dpi.value || 72); if (unit.value !== 'px') { st.w = Math.round(toPx(+w.value, unit.value, st.dpi)); st.h = Math.round(toPx(+h.value, unit.value, st.dpi)); } upd(); });
    unit.addEventListener('change', syncFields);
    orient.addEventListener('click', () => { [st.w, st.h] = [st.h, st.w]; syncFields(); renderCards(); });
    bg.addEventListener('change', upd);
    chip.addEventListener('click', () => S.ColorPicker.open(st.color, null, (c) => { st.color = c; chip.style.background = c; }));
    function renderCards() {
      catTabs.innerHTML = '';
      for (const c of cats) { const t = U.el('div', { class: 'tab' + (c === cat ? ' active' : '') }, c); t.onclick = () => { cat = c; renderCards(); }; catTabs.appendChild(t); }
      cards.innerHTML = '';
      for (const p of PRESETS.filter((x) => x.cat === cat)) {
        const k = 44 / Math.max(p.w, p.h);
        const pv = U.el('div', { class: 'nd-shape', style: { width: Math.max(6, p.w * k) + 'px', height: Math.max(6, p.h * k) + 'px' } });
        const card = U.el('div', { class: 'nd-card' + (p.w === st.w && p.h === st.h ? ' active' : '') }, [U.el('div', { class: 'nd-pv' }, [pv]), U.el('div', { class: 'nd-name' }, p.name), U.el('div', { class: 'muted' }, p.w + ' × ' + p.h)]);
        card.onclick = () => { st.w = p.w; st.h = p.h; st.dpi = p.dpi; syncFields(); renderCards(); };
        card.ondblclick = () => dlg.primaryBtn.click();
        cards.appendChild(card);
      }
    }
    const fr = (lab, ...els) => U.el('div', { class: 'nd-row' }, [U.el('label', {}, lab), U.el('div', { class: 'row' }, els)]);
    right.append(fr('Name', name), fr('Width', w, unit), fr('Height', h, orient), fr('Resolution', dpi, U.el('span', { class: 'muted' }, 'ppi')), fr('Background', bg, chip), info);
    syncFields(); renderCards();
    const dlg = S.Dialog.open({ title: 'New Document', body: U.el('div', { class: 'nd-body' }, [left, right]), width: 720,
      buttons: [{ label: 'Cancel' }, { label: 'Create', primary: true, run: () => {
        st.name = name.value || st.name; st.unit = unit.value; st.bg = bg.value;
        if (st.w * st.h > 16384 * 16384 || st.w > 30000 || st.h > 30000) { S.toast('Document too large (max 30000 px per side)'); return false; }
        S.store.set('newdoc', { w: st.w, h: st.h, dpi: st.dpi, bg: st.bg, color: st.color, unit: st.unit });
        A.createDoc(st);
      } }] });
  };
  A.createDoc = function (st) {
    const d = new S.Document({ name: st.name, width: st.w, height: st.h, dpi: st.dpi });
    const fill = { white: '#ffffff', black: '#000000', fg: S.app.fg, bgc: S.app.bg, custom: st.color }[st.bg];
    const l = S.Layers.raster(d, st.bg === 'transparent' ? 'Layer 1' : 'Background', fill ? U.createCanvas(d.width, d.height) : null);
    if (fill) { const x = l.canvas.getContext('2d'); x.fillStyle = fill; x.fillRect(0, 0, d.width, d.height); }
    d.layers.push(l); d.activeId = l.id; d.selectedIds = new Set([l.id]);
    A.addDoc(d, 'New Document');
    return d;
  };
  A.duplicateDoc = async function (src) {
    const n = await S.Dialog.prompt('Name for the duplicate', src.name + ' copy', 'Duplicate Document');
    if (n == null) return;
    const data = await S.FileIO.serialize(src);
    const d = await S.FileIO.loadProject(data, n, { noAdd: true });
    d.name = n; A.addDoc(d, 'Duplicate');
  };

  /* ---------------- Image Size ---------------- */
  A.imageSizeDialog = function () {
    const d = doc();
    const st = { w: d.width, h: d.height, lock: true, method: S.app.prefs.interpolation || 'bicubic', pct: 100 };
    const w = U.el('input', { type: 'number', min: 1, value: st.w }), h = U.el('input', { type: 'number', min: 1, value: st.h });
    const pct = U.el('input', { type: 'number', min: 1, max: 10000, value: 100 });
    const lock = U.el('input', { type: 'checkbox', checked: true });
    const meth = U.el('select', {}, [['bicubic', 'Bicubic (smooth, best for reduction)'], ['bilinear', 'Bilinear'], ['nearest', 'Nearest Neighbor (hard edges)']].map(([v, l]) => U.el('option', { value: v }, l)));
    meth.value = st.method;
    const info = U.el('div', { class: 'muted' });
    const upd = () => { info.textContent = 'Current: ' + d.width + ' × ' + d.height + ' px  →  New: ' + st.w + ' × ' + st.h + ' px'; };
    [w, h, pct].forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));
    w.addEventListener('input', () => { st.w = Math.max(1, Math.round(+w.value)); if (lock.checked) { st.h = Math.max(1, Math.round((st.w * d.height) / d.width)); h.value = st.h; } pct.value = Math.round((st.w / d.width) * 1000) / 10; upd(); });
    h.addEventListener('input', () => { st.h = Math.max(1, Math.round(+h.value)); if (lock.checked) { st.w = Math.max(1, Math.round((st.h * d.width) / d.height)); w.value = st.w; } upd(); });
    pct.addEventListener('input', () => { const k = +pct.value / 100; st.w = Math.max(1, Math.round(d.width * k)); st.h = Math.max(1, Math.round(d.height * k)); w.value = st.w; h.value = st.h; upd(); });
    upd();
    const fr = (lab, ...els) => U.el('div', { class: 'nd-row' }, [U.el('label', {}, lab), U.el('div', { class: 'row' }, els)]);
    S.Dialog.open({ title: 'Image Size', width: 420, body: U.el('div', {}, [fr('Width', w, U.el('span', { class: 'muted' }, 'px')), fr('Height', h, U.el('span', { class: 'muted' }, 'px')), fr('Scale', pct, U.el('span', { class: 'muted' }, '%')),
      fr('', U.el('label', { class: 'check-row' }, [lock, U.el('span', {}, 'Constrain proportions')])), fr('Resample', meth), info]),
      buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, run: () => {
        if (st.w === d.width && st.h === d.height) return;
        const pct = Math.round((st.w / d.width) * 10000) / 100;
        d.commit('Image Size', () => S.Ops.resizeImage(d, st.w, st.h, meth.value));
        S.View.fit(d, false); S.bus.emit('doc:resized', d);
        if (S.Actions) S.Actions.record({ type: 'imageSize', pct, method: meth.value });
      } }] });
  };

  /* ---------------- Canvas Size ---------------- */
  A.canvasSizeDialog = function () {
    const d = doc();
    const st = { w: d.width, h: d.height, rel: false, ax: 1, ay: 1, color: '#ffffff' };
    const w = U.el('input', { type: 'number', value: st.w }), h = U.el('input', { type: 'number', value: st.h });
    const rel = U.el('input', { type: 'checkbox' });
    const grid = U.el('div', { class: 'anchor-grid' });
    const ext = U.el('select', {}, [['transparent', 'Transparent'], ['white', 'White'], ['black', 'Black'], ['bg', 'Background color']].map(([v, l]) => U.el('option', { value: v }, l)));
    [w, h].forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));
    const drawGrid = () => {
      grid.innerHTML = '';
      for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
        const dx = x - st.ax, dy = y - st.ay;
        const arrows = { '0,0': '●', '-1,0': '←', '1,0': '→', '0,-1': '↑', '0,1': '↓', '-1,-1': '↖', '1,-1': '↗', '-1,1': '↙', '1,1': '↘' };
        const c = U.el('button', { class: 'anchor-cell' + (dx === 0 && dy === 0 ? ' on' : '') }, Math.abs(dx) <= 1 && Math.abs(dy) <= 1 ? arrows[dx + ',' + dy] : '');
        c.onclick = () => { st.ax = x; st.ay = y; drawGrid(); };
        grid.appendChild(c);
      }
    };
    rel.addEventListener('change', () => { w.value = rel.checked ? 0 : d.width; h.value = rel.checked ? 0 : d.height; });
    drawGrid();
    const fr = (lab, ...els) => U.el('div', { class: 'nd-row' }, [U.el('label', {}, lab), U.el('div', { class: 'row' }, els)]);
    S.Dialog.open({ title: 'Canvas Size', width: 400, body: U.el('div', {}, [U.el('div', { class: 'muted', style: { marginBottom: '8px' } }, 'Current size: ' + d.width + ' × ' + d.height + ' px'), fr('Width', w, U.el('span', { class: 'muted' }, 'px')), fr('Height', h, U.el('span', { class: 'muted' }, 'px')),
      fr('', U.el('label', { class: 'check-row' }, [rel, U.el('span', {}, 'Relative')])), fr('Anchor', grid), fr('Extension', ext)]),
      buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, run: () => {
        const W = rel.checked ? d.width + +w.value : +w.value, H = rel.checked ? d.height + +h.value : +h.value;
        if (W < 1 || H < 1) { S.toast('Invalid size'); return false; }
        const ox = Math.round(((W - d.width) * st.ax) / 2), oy = Math.round(((H - d.height) * st.ay) / 2);
        const fill = { white: '#ffffff', black: '#000000', bg: S.app.bg }[ext.value];
        d.commit('Canvas Size', () => {
          d._bgLayer = fill ? d.layers.find((l) => l.type === 'raster') : null;
          S.Ops.resizeCanvas(d, W, H, ox, oy, fill);
          d._bgLayer = null;
        });
        S.View.fit(d, false); S.bus.emit('doc:resized', d);
        if (S.Actions) S.Actions.record({ type: 'canvasSize', w: W, h: H, ox, oy, fill: fill || null });
      } }] });
  };

  /* ---------------- Trim ---------------- */
  A.trimDialog = function () {
    S.Dialog.form('Trim', [{ id: 'based', label: 'Based on', type: 'select', default: 'transparent', options: [{ value: 'transparent', label: 'Transparent pixels' }, { value: 'tl', label: 'Top-left pixel color' }, { value: 'br', label: 'Bottom-right pixel color' }] }], {}, (v) => {
      const d = doc(), flat = S.Compositor.flatten(d), W = d.width, H = d.height;
      const px = flat.getContext('2d').getImageData(0, 0, W, H).data;
      const ref = v.based === 'tl' ? 0 : (W * H - 1) * 4;
      const keep = (i) => (v.based === 'transparent' ? px[i + 3] > 0 : Math.abs(px[i] - px[ref]) + Math.abs(px[i + 1] - px[ref + 1]) + Math.abs(px[i + 2] - px[ref + 2]) + Math.abs(px[i + 3] - px[ref + 3]) > 6);
      let x1 = W, y1 = H, x2 = -1, y2 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (keep((y * W + x) * 4)) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; y2 = y; }
      if (x2 < 0) { S.toast('Nothing to keep — the image would be empty'); return; }
      if (x1 === 0 && y1 === 0 && x2 === W - 1 && y2 === H - 1) { S.toast('Nothing to trim'); return; }
      d.commit('Trim', () => S.Ops.resizeCanvas(d, x2 - x1 + 1, y2 - y1 + 1, -x1, -y1));
      S.View.fit(d, false); S.bus.emit('doc:resized', d);
    });
  };

  /* ---------------- Fill & Stroke ---------------- */
  A.fillWith = function (color, name) {
    const d = doc(), t = d.paintTarget();
    if (!t || t.kind === 'invalid') { S.toast('Select a pixel layer'); return; }
    if (t.layer && (t.layer.locks.all || t.layer.locks.pixels)) { S.toast('Layer is locked'); return; }
    const c = U.createCanvas(d.width, d.height), x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, d.width, d.height);
    S.paintCanvasOnto(d, t, c, 1, 'normal', name, false, { x: 0, y: 0, w: d.width, h: d.height });
  };
  A.fillDialog = function () {
    const st = S.store.get('filldlg', { use: 'fg', color: '#808080', blend: 'normal', opacity: 100, preserve: false });
    S.Dialog.form('Fill', [
      { id: 'use', label: 'Contents', type: 'select', default: st.use, options: [{ value: 'fg', label: 'Foreground Color' }, { value: 'bg', label: 'Background Color' }, { value: 'color', label: 'Color…' }, { value: 'gray', label: '50% Gray' }, { value: 'white', label: 'White' }, { value: 'black', label: 'Black' }, { value: 'pattern', label: 'Checker Pattern' }, { value: 'patch', label: 'Patch from surroundings (content fill)' }] },
      { id: 'color', label: 'Color', type: 'color', default: st.color },
      { id: 'blend', label: 'Mode', type: 'select', default: st.blend, options: S.BLEND_MODES.filter(Boolean).map((m) => ({ value: m.id, label: m.label })) },
      { id: 'opacity', label: 'Opacity', type: 'range', default: st.opacity, min: 1, max: 100, unit: '%' },
      { id: 'preserve', label: 'Preserve transparency', type: 'checkbox', default: st.preserve },
    ], st, (v) => { S.store.set('filldlg', v); A.fillApply(v); if (S.Actions && v.use !== 'patch') S.Actions.record(Object.assign({ type: 'fill' }, v)); });
  };
  /** apply the Fill dialog's settings (also used by actions) */
  A.fillApply = function (v) {
    {
      const d = doc(), t = d.paintTarget();
      if (!t || t.kind === 'invalid') { S.toast('Select a pixel layer'); return; }
      if (v.use === 'patch') { if (!d.selection) { S.toast('Patch fill needs a selection'); return; } setTimeout(() => S.SmartFill.run(d, {}), 30); return; }
      const c = U.createCanvas(d.width, d.height), x = c.getContext('2d');
      if (v.use === 'pattern') {
        const p = U.createCanvas(32, 32), px = p.getContext('2d'); px.fillStyle = S.app.bg; px.fillRect(0, 0, 32, 32); px.fillStyle = S.app.fg; px.fillRect(0, 0, 16, 16); px.fillRect(16, 16, 16, 16);
        x.fillStyle = x.createPattern(p, 'repeat');
      } else x.fillStyle = { fg: S.app.fg, bg: S.app.bg, color: v.color, gray: '#808080', white: '#ffffff', black: '#000000' }[v.use];
      x.fillRect(0, 0, d.width, d.height);
      if (v.preserve && t.kind === 'pixels') { x.globalCompositeOperation = 'destination-in'; U.drawAt(x, t.canvas); }
      S.paintCanvasOnto(d, t, c, v.opacity / 100, v.preserve && v.blend === 'normal' ? 'normal' : v.blend, 'Fill');
    }
  };
  A.strokeDialog = function () {
    const st = S.store.get('strokedlg', { width: 3, color: S.app.fg, location: 'center', opacity: 100 });
    S.Dialog.form('Stroke', [
      { id: 'width', label: 'Width', type: 'range', default: st.width, min: 1, max: 250, unit: 'px' },
      { id: 'color', label: 'Color', type: 'color', default: st.color },
      { id: 'location', label: 'Location', type: 'select', default: st.location, options: [{ value: 'inside', label: 'Inside' }, { value: 'center', label: 'Center' }, { value: 'outside', label: 'Outside' }] },
      { id: 'opacity', label: 'Opacity', type: 'range', default: st.opacity, min: 1, max: 100, unit: '%' },
    ], st, (v) => {
      S.store.set('strokedlg', v);
      const d = doc(), t = d.paintTarget();
      if (!t || t.kind === 'invalid') { S.toast('Select a pixel layer'); return; }
      const sel = d.selection || S.Ops.layerAlphaSelection(d, d.activeLayer());
      if (!sel) { S.toast('Make a selection to stroke'); return; }
      let outer, inner;
      if (v.location === 'outside') { outer = S.Sel.expand(sel, v.width); inner = sel; }
      else if (v.location === 'inside') { outer = sel; inner = S.Sel.expand(sel, -v.width); }
      else { outer = S.Sel.expand(sel, v.width / 2); inner = S.Sel.expand(sel, -v.width / 2); }
      const ring = S.Sel.combine(outer, inner ? inner.mask : new Uint8ClampedArray(d.width * d.height), 'subtract', d.width, d.height);
      if (!ring) return;
      const c = U.createCanvas(d.width, d.height), x = c.getContext('2d');
      x.fillStyle = v.color; x.fillRect(0, 0, d.width, d.height);
      x.globalCompositeOperation = 'destination-in'; x.drawImage(S.Sel.canvas(ring), 0, 0);
      S.paintCanvasOnto(d, t, c, v.opacity / 100, 'normal', 'Stroke', true);
    });
  };

  /* ---------------- Color Range (modeless; click the canvas to sample) ---------------- */
  A.colorRangeDialog = function () {
    const d = doc();
    const img = S.sampleImage(d, true);
    const st = { color: S.app.fg, fuzz: 40, mode: 'sampled', invert: false, sel: 'new' };
    const pv = U.el('canvas', { class: 'cr-preview' });
    const k = Math.min(1, 240 / Math.max(d.width, d.height));
    pv.width = Math.max(1, Math.round(d.width * k)); pv.height = Math.max(1, Math.round(d.height * k));
    const small = U.createCanvas(pv.width, pv.height); small.getContext('2d').drawImage(S.Compositor.flatten(d), 0, 0, pv.width, pv.height);
    const simg = small.getContext('2d').getImageData(0, 0, pv.width, pv.height);
    const compute = (src) => {
      const n = src.width * src.height, out = new Uint8ClampedArray(n), p = src.data;
      if (st.mode === 'sampled') { const m = S.Sel.colorRange(src, U.hexToRgb(st.color), st.fuzz); out.set(m); }
      else for (let i = 0, j = 0; i < n; i++, j += 4) {
        const L = U.luma(p[j], p[j + 1], p[j + 2]) / 255;
        const v = st.mode === 'highlights' ? U.clamp((L - 0.55) * 4, 0, 1) : st.mode === 'shadows' ? U.clamp((0.45 - L) * 4, 0, 1) : U.clamp(1 - Math.abs(L - 0.5) * 4, 0, 1);
        out[i] = p[j + 3] ? v * 255 : 0;
      }
      if (st.invert) for (let i = 0; i < n; i++) out[i] = 255 - out[i];
      return out;
    };
    const drawPv = () => {
      const m = compute(simg), x = pv.getContext('2d'), o = x.createImageData(pv.width, pv.height);
      for (let i = 0; i < m.length; i++) { o.data[i * 4] = o.data[i * 4 + 1] = o.data[i * 4 + 2] = m[i]; o.data[i * 4 + 3] = 255; }
      x.putImageData(o, 0, 0);
    };
    const chip = U.el('span', { class: 'cr-chip', style: { background: st.color } });
    const ui = S.ParamUI.build([
      { id: 'mode', label: 'Select', type: 'select', default: 'sampled', options: [{ value: 'sampled', label: 'Sampled Color' }, { value: 'highlights', label: 'Highlights' }, { value: 'midtones', label: 'Midtones' }, { value: 'shadows', label: 'Shadows' }] },
      { id: 'fuzz', label: 'Fuzziness', type: 'range', default: 40, min: 1, max: 200 },
      { id: 'invert', label: 'Invert', type: 'checkbox', default: false },
      { id: 'sel', label: 'Combine', type: 'select', default: 'new', options: [{ value: 'new', label: 'New selection' }, { value: 'add', label: 'Add' }, { value: 'subtract', label: 'Subtract' }, { value: 'intersect', label: 'Intersect' }] },
    ], st, (v) => { Object.assign(st, v); drawPv(); });
    S.app.pickHook = (info) => {
      const x = Math.floor(info.x), y = Math.floor(info.y);
      if (x < 0 || y < 0 || x >= d.width || y >= d.height) return;
      const i = (y * d.width + x) * 4; st.color = U.rgbToHex(img.data[i], img.data[i + 1], img.data[i + 2]); chip.style.background = st.color; drawPv();
    };
    // the dialog belongs to this document: switching or closing documents dismisses it
    const offSwitch = S.bus.on('doc:switched', (nd) => { if (nd !== d) dlg.close(false); });
    const clear = () => { S.app.pickHook = null; offSwitch(); };
    drawPv();
    const dlg = S.Dialog.open({ title: 'Color Range', cls: 'modeless', transparent: true, body: U.el('div', { class: 'cr-body' }, [U.el('div', { class: 'row muted', style: { marginBottom: '6px' } }, [chip, ' Click on the image to sample a color']), pv, ui]),
      onClose: clear, buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, run: () => {
        const m = compute(img);
        const sel = st.sel === 'new' ? S.Sel.make(m, d.width, d.height) : S.Sel.combine(d.selection, m, st.sel, d.width, d.height);
        d.setSelection(sel, 'Color Range');
      } }] });
    dlg.el.closest('.modal-backdrop').classList.add('modeless');
    dlg.el.style.position = 'fixed'; dlg.el.style.right = '330px'; dlg.el.style.top = '100px';
  };

  /* ---------------- Select & Refine ---------------- */
  A.refineDialog = function () {
    const d = doc(), orig = d.selection;
    let base = orig; // the selection being refined ("Select Subject" in the dialog replaces it)
    const st = Object.assign({ smooth: 0, feather: 0, shift: 0, radius: 0, decontaminate: false, output: 'selection' }, S.store.get('refine', {}), { output: 'selection' });
    let img = null; // full-resolution picture for the smart radius (lazy)
    const picture = () => img || (img = S.sampleImage(d, true));
    const apply = () => {
      let s = base;
      if (st.radius > 0 && s) { // smart radius: re-estimate the edge from the colours around the current edge
        const im = picture(), n = s.w * s.h, alpha = new Float32Array(n);
        for (let i = 0; i < n; i++) alpha[i] = s.mask[i] / 255;
        S.Subject.refineBand(im, alpha, st.radius);
        const m = new Uint8ClampedArray(n); for (let i = 0; i < n; i++) m[i] = alpha[i] * 255;
        s = S.Sel.make(m, s.w, s.h) || s;
      }
      if (st.smooth > 0) s = S.Sel.smooth(s, st.smooth) || s;
      if (st.shift) s = S.Sel.expand(s, st.shift) || s;
      if (st.feather > 0) s = S.Sel.feather(s, st.feather) || s;
      return s;
    };
    const preview = U.debounce(() => { d.selection = apply(); S.View.redraw(); }, 150);
    const ui = S.ParamUI.build([
      { id: 'radius', label: 'Smart radius', type: 'range', default: st.radius, min: 0, max: 40, unit: 'px' },
      { id: 'note1', type: 'note', label: 'Smart radius re-detects the edge inside a band around it from the picture’s colours (hair, fur, soft edges).' },
      { id: 'smooth', label: 'Smooth', type: 'range', default: st.smooth, min: 0, max: 50 },
      { id: 'feather', label: 'Feather', type: 'range', default: st.feather, min: 0, max: 200, step: 0.5, unit: 'px' },
      { id: 'shift', label: 'Shift Edge', type: 'range', default: st.shift, min: -100, max: 100, unit: 'px' },
      { id: 'decontaminate', label: 'Decontaminate colors (new layer outputs)', type: 'checkbox', default: !!st.decontaminate },
      { id: 'output', label: 'Output to', type: 'select', default: 'selection', options: [{ value: 'selection', label: 'Selection' }, { value: 'mask', label: 'Layer Mask' }, { value: 'newLayer', label: 'New Layer' }, { value: 'newLayerMask', label: 'New Layer with Mask' }] },
    ], st, (v) => { Object.assign(st, v); preview(); });
    const subjectBtn = U.el('button', { class: 'btn btn-sm' }, 'Select Subject');
    subjectBtn.addEventListener('click', () => { const sel = S.Subject.select(d, { radius: st.radius }); if (!sel) { S.toast('No distinct subject found'); return; } base = sel; d.selection = apply(); S.View.redraw(); });
    S.Dialog.open({ title: 'Select and Refine', transparent: true, body: ui, width: 360,
      footLeft: subjectBtn,
      onCancel: () => { d.selection = orig; S.View.redraw(); },
      buttons: [{ label: 'Cancel', run: () => { d.selection = orig; S.View.redraw(); } }, { label: 'OK', primary: true, run: () => {
        S.store.set('refine', { smooth: st.smooth, feather: st.feather, shift: st.shift, radius: st.radius, decontaminate: st.decontaminate });
        const s = apply(); d.selection = orig;
        if (!s) { S.toast('The refined selection is empty'); return; }
        if (st.output === 'selection') d.setSelection(s, 'Refine Selection');
        else {
          d.commit('Refine Selection', () => {
            const l = d.activeLayer();
            const sb = s.bounds, mc = U.createCanvas(sb.w, sb.h, sb.x, sb.y); mc.getContext('2d').drawImage(S.Sel.canvas(s), -sb.x, -sb.y);
            if (st.output === 'mask' && l) { l.mask = S.Layers.maskFrom(mc, 0); l.version++; }
            else if (l && S.Layers.hasCanvas(l)) {
              const c = S.Layers.materialize(l, d);
              if (st.decontaminate) { // estimate pure foreground colours under the semi-transparent edge
                const cr = U.rectOf(c), im = c.getContext('2d').getImageData(0, 0, cr.w, cr.h), n = cr.w * cr.h, alpha = new Float32Array(n);
                for (let y = 0; y < cr.h; y++) for (let x = 0; x < cr.w; x++) { const dx = x + cr.x, dy = y + cr.y; alpha[y * cr.w + x] = dx >= 0 && dy >= 0 && dx < s.w && dy < s.h ? s.mask[dy * s.w + dx] / 255 : 0; }
                S.Subject.decontaminate(im, alpha, Math.max(3, st.radius));
                c.getContext('2d').putImageData(im, 0, 0);
              }
              const nl = S.Layers.raster(d, l.name + ' (refined)', c);
              if (st.output === 'newLayer') { const x = c.getContext('2d'); x.globalCompositeOperation = 'destination-in'; x.drawImage(S.Sel.canvas(s), -(c.ox || 0), -(c.oy || 0)); }
              else nl.mask = S.Layers.maskFrom(mc, 0);
              d.insertLayer(nl); d.activeId = nl.id; d.selectedIds = new Set([nl.id]); l.visible = false;
            }
            d.selection = null;
          });
        }
      } }] });
  };

  /* ---------------- Guide layout ---------------- */
  A.guideLayoutDialog = function () {
    S.Dialog.form('New Guide Layout', [
      { id: 'cols', label: 'Columns', type: 'number', default: 3, min: 0, max: 50 }, { id: 'rows', label: 'Rows', type: 'number', default: 0, min: 0, max: 50 },
      { id: 'gutter', label: 'Gutter', type: 'number', default: 20, min: 0, unit: 'px' }, { id: 'margin', label: 'Margin', type: 'number', default: 40, min: 0, unit: 'px' },
      { id: 'clear', label: 'Clear existing guides', type: 'checkbox', default: true },
    ], {}, (v) => {
      const d = doc();
      d.commit('Guide Layout', () => {
        if (v.clear) d.guides = [];
        const add = (dir, pos) => d.guides.push({ dir, pos: Math.round(pos) });
        if (v.margin) { add('v', v.margin); add('v', d.width - v.margin); add('h', v.margin); add('h', d.height - v.margin); }
        const lay = (n, len, dir) => {
          if (!n) return;
          const avail = len - v.margin * 2 - v.gutter * (n - 1), cw = avail / n;
          for (let i = 0; i < n; i++) { const s = v.margin + i * (cw + v.gutter); if (i > 0) add(dir, s); if (i < n - 1) add(dir, s + cw); }
        };
        lay(v.cols, d.width, 'v'); lay(v.rows, d.height, 'h');
      });
      S.View.showGuides = true; S.View.redraw();
    });
  };

  /* ---------------- Preferences ---------------- */
  A.PREF_DEFAULTS = { uiScale: 100, checkerSize: 8, checkerA: '#ffffff', checkerB: '#cfcfcf', historySteps: 60, historyMB: 600, interpolation: 'bicubic', cursor: 'outline', autosaveMin: 2, gridSize: 50, gridSub: 4, pasteboard: '#141210' };
  A.applyPrefs = function () {
    const p = S.app.prefs;
    const z = (p.uiScale || 100) / 100;
    for (const sel of ['.menubar', '#optionsbar', '#toolstrip', '#dock', '.statusbar', '#doctabs']) { const e = document.querySelector(sel); if (e) e.style.zoom = z === 1 ? '' : z; }
    document.documentElement.style.setProperty('--pasteboard', p.pasteboard || '#141210');
    if (S.View.resize) S.View.resize();
    S.View.redraw(true);
  };
  A.prefsDialog = function () {
    const p = S.app.prefs;
    const PREF_FORM = [
      { id: 'h1', type: 'header', label: 'Interface' },
      { id: 'uiScale', label: 'UI scale', type: 'range', default: p.uiScale, min: 75, max: 175, step: 5, unit: '%' },
      { id: 'cursor', label: 'Painting cursor', type: 'select', default: p.cursor, options: [{ value: 'outline', label: 'Brush outline' }, { value: 'cross', label: 'Precise crosshair' }] },
      { id: 'pasteboard', label: 'Pasteboard color', type: 'color', default: p.pasteboard },
      { id: 'h2', type: 'header', label: 'Transparency & Grid' },
      { id: 'checkerSize', label: 'Checker size', type: 'range', default: p.checkerSize, min: 2, max: 32, unit: 'px' },
      { id: 'checkerA', label: 'Checker color 1', type: 'color', default: p.checkerA }, { id: 'checkerB', label: 'Checker color 2', type: 'color', default: p.checkerB },
      { id: 'gridSize', label: 'Grid every', type: 'number', default: p.gridSize, min: 2, max: 2000, unit: 'px' }, { id: 'gridSub', label: 'Subdivisions', type: 'number', default: p.gridSub, min: 1, max: 20 },
      { id: 'h3', type: 'header', label: 'Performance' },
      { id: 'historySteps', label: 'History states', type: 'range', default: p.historySteps, min: 5, max: 300 },
      { id: 'historyMB', label: 'History memory', type: 'range', default: p.historyMB, min: 100, max: 4000, step: 50, unit: 'MB' },
      { id: 'interpolation', label: 'Default resampling', type: 'select', default: p.interpolation, options: [{ value: 'bicubic', label: 'Bicubic' }, { value: 'bilinear', label: 'Bilinear' }, { value: 'nearest', label: 'Nearest Neighbor' }] },
      { id: 'autosaveMin', label: 'Autosave every', type: 'range', default: p.autosaveMin, min: 0, max: 30, unit: 'min' },
    ];
    const own = new Set(PREF_FORM.filter((d) => d.type !== 'header').map((d) => d.id));
    S.Dialog.form('Preferences', PREF_FORM, p, (v) => {
      // only this form's own fields: settings added to the dialog by extensions (display colour space, quick
      // mask colour…) apply live and must not be overwritten by the snapshot taken when the dialog opened
      for (const k in v) if (own.has(k)) S.app.prefs[k] = v[k];
      S.store.set('prefs', S.app.prefs);
      A.applyPrefs();
      A.startAutosave();
      S.toast('Preferences saved');
    }, { width: 420, footLeft: U.el('button', { class: 'btn ghost', onclick: () => { S.app.prefs = Object.assign({}, A.PREF_DEFAULTS); S.store.set('prefs', S.app.prefs); A.applyPrefs(); S.Dialog.top().close(); S.toast('Preferences reset'); } }, 'Reset all') });
  };

  /* ---------------- Keyboard shortcuts ---------------- */
  A.shortcutsDialog = function () {
    const groups = { file: 'File', edit: 'Edit', image: 'Image', layer: 'Layer', select: 'Select', path: 'Paths', filter: 'Filter', view: 'View', window: 'Window', help: 'Help', color: 'Color' };
    const search = U.el('input', { type: 'text', placeholder: 'Search commands…', class: 'sc-search' });
    search.addEventListener('keydown', (e) => e.stopPropagation());
    const list = U.el('div', { class: 'sc-list' });
    const toolsInfo = U.el('div', { class: 'sc-static' });
    let recording = null;
    function render() {
      list.innerHTML = '';
      const q = search.value.toLowerCase();
      for (const g in groups) {
        const ids = S.Cmd.order.filter((id) => id.startsWith(g + '.') && !['image.adjust', 'layer.newAdjustment', 'filter.apply', 'window.panel', 'view.channel', 'layer.effects'].includes(id) || id === 'layer.effects');
        const rows = ids.filter((id) => id.startsWith(g + '.')).filter((id) => !q || S.Cmd.map[id].label.toLowerCase().includes(q) || S.Cmd.keyOf(id).toLowerCase().includes(q));
        if (!rows.length) continue;
        list.appendChild(U.el('div', { class: 'sc-group' }, groups[g]));
        for (const id of rows) {
          const c = S.Cmd.map[id];
          const key = U.el('button', { class: 'sc-key' + (recording === id ? ' rec' : '') }, recording === id ? 'Press keys…' : S.Cmd.keyOf(id) || '—');
          key.onclick = () => { recording = id; render(); };
          const rs = U.el('button', { class: 'icon-btn', html: S.icon('undo'), title: 'Reset to default' });
          rs.onclick = () => { S.Cmd.setKey(id, c.defaultKey); render(); };
          const clr = U.el('button', { class: 'icon-btn', html: S.icon('close'), title: 'Remove shortcut' });
          clr.onclick = () => { S.Cmd.setKey(id, ''); render(); };
          list.appendChild(U.el('div', { class: 'sc-row' }, [U.el('span', {}, c.label.replace('…', '')), key, rs, clr]));
        }
      }
    }
    const onKey = (e) => {
      if (!recording) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { recording = null; render(); return; }
      const k = S.Cmd.eventKey(e); if (!k) return;
      const clash = S.Cmd.forKey(k);
      if (clash && clash !== recording) { S.Cmd.setKey(clash, ''); S.toast('Removed ' + k + ' from “' + S.Cmd.map[clash].label + '”'); }
      S.Cmd.setKey(recording, k); recording = null; render();
    };
    addEventListener('keydown', onKey, true);
    const toolKeys = S.Tools.list.filter((t) => t.key).map((t) => t.name + ' — ' + t.key);
    toolsInfo.innerHTML = '<div class="sc-group">Tools (Shift+key cycles grouped tools)</div><div class="sc-cols">' + toolKeys.map((s) => '<div>' + s + '</div>').join('') + '</div>' +
      '<div class="sc-group">Painting & view</div><div class="sc-cols">' + ['[ / ] — brush size', 'Shift+[ / ] — hardness', '1…0 — tool opacity 10…100%', 'Alt+right-drag — resize brush', 'Space+drag — pan', 'Alt+wheel / Ctrl+wheel — zoom', 'Shift+click — straight line', 'Alt+click — sample color / set source', 'Arrows — nudge (Shift ×10)', 'Enter / Esc — commit / cancel', 'Ctrl+click thumbnail — load selection', 'Tab — hide panels'].map((s) => '<div>' + s + '</div>').join('') + '</div>';
    render();
    search.addEventListener('input', render);
    S.Dialog.open({ title: 'Keyboard Shortcuts', width: 680, body: U.el('div', { class: 'sc-body' }, [search, list, toolsInfo]), onClose: () => removeEventListener('keydown', onKey, true),
      footLeft: U.el('button', { class: 'btn ghost', onclick: () => { S.Cmd.resetKeys(); render(); } }, 'Reset all to defaults'), buttons: [{ label: 'Done', primary: true }] });
  };

  /* ---------------- About ---------------- */
  A.aboutDialog = function () {
    S.Dialog.open({ title: 'About Gesso', width: 440, body: U.el('div', { class: 'about' }, [
      U.el('div', { class: 'about-mark', html: S.brandMark }),
      U.el('h2', {}, 'Gesso ' + S.version),
      U.el('p', {}, 'A layered raster image editor — part of Kiln Suite.'),
      U.el('p', { class: 'muted' }, 'Built with plain JavaScript and the HTML canvas. No servers, no tracking: everything stays on your computer. Effects powered by the shared ImageFX library ' + (window.ImageFX ? '(v' + ImageFX.version + ')' : '') + '.'),
      U.el('p', { class: 'muted' }, 'Open source: the code is organised into small, commented files under Gesso/js — feel free to read, modify and extend it.'),
      U.el('p', { class: 'muted' }, ['MIT License · © 2026 Thomas Rigdon · ', U.el('a', { href: S.repoURL, target: '_blank', rel: 'noopener' }, 'github.com/tcrigdon1/kiln_suite')]),
    ]), buttons: [{ label: 'Close', primary: true }] });
  };

  /* ---------------- misc helpers ---------------- */
  A.layerVia = function (cut) {
    const d = doc(), l = d.activeLayer();
    if (!d.selection) { S.Cmd.run('layer.duplicate'); return; }
    if (!S.Layers.hasCanvas(l)) { S.toast('Select a pixel layer'); return; }
    d.commit(cut ? 'Layer via Cut' : 'Layer via Copy', () => {
      const sc = S.Sel.canvas(d.selection), sb = d.selection.bounds, src = l.type === 'raster' ? l.canvas : S.Layers.materialize(l, d);
      const c = U.createCanvas(sb.w, sb.h, sb.x, sb.y), x = c.getContext('2d');
      x.drawImage(src, (src.ox || 0) - sb.x, (src.oy || 0) - sb.y); x.globalCompositeOperation = 'destination-in'; x.drawImage(sc, -sb.x, -sb.y);
      if (cut && l.type === 'raster') { const r = U.cloneCanvas(src), rx = r.getContext('2d'); rx.globalCompositeOperation = 'destination-out'; rx.drawImage(sc, -(r.ox || 0), -(r.oy || 0)); l.canvas = r; l.version++; }
      const nl = S.Layers.raster(d, l.name + (cut ? ' cut' : ' copy'), c);
      d.insertLayer(nl, l.id); d.activeId = nl.id; d.selectedIds = new Set([nl.id]);
    });
  };
  A.toggleQuickMask = function () {
    const d = doc(); if (!d) return;
    if (!d.quickMask) {
      d.commit('Enter Quick Mask', () => {
        const c = U.createCanvas(d.width, d.height), x = c.getContext('2d');
        if (d.selection) x.drawImage(S.Sel.canvas(d.selection), 0, 0); else { x.fillStyle = '#000'; x.fillRect(0, 0, d.width, d.height); }
        d.quickMask = { canvas: c, version: 1 };
        if (d.selection) d.lastSelection = d.selection;
        d.selection = null; // the quick mask now holds the selection
      });
      S.toast('Quick Mask: paint black to protect, white to select. Press Q to exit.');
    } else {
      d.commit('Exit Quick Mask', () => {
        const m = S.Sel.alphaOf(d.quickMask.canvas);
        let all = true; for (let i = 0; i < m.length; i++) if (m[i] !== 255) { all = false; break; }
        d.selection = all ? null : S.Sel.make(m, d.width, d.height);
        d.quickMask = null;
      });
    }
    S.Tools.renderStrip(); S.bus.emit('channels:changed', d);
  };
  A.transformSelection = function () { S.Transform.begin({ selectionOnly: true }); };

  A.canvasContextMenu = function () {
    const d = doc(); if (!d) return [{ cmd: 'file.new' }, { cmd: 'file.open' }];
    if (d.selection) return [{ cmd: 'select.none' }, { cmd: 'select.inverse' }, '-', { cmd: 'select.feather' }, { cmd: 'select.refine' }, { cmd: 'select.transform' }, '-',
      { cmd: 'layer.newViaCopy' }, { cmd: 'layer.newViaCut' }, '-', { cmd: 'edit.fill' }, { cmd: 'edit.stroke' }, { cmd: 'edit.clear' }, '-', { cmd: 'layer.maskFromSel', label: 'Add Mask from Selection' }, { cmd: 'select.toPath' }];
    return [{ cmd: 'edit.undo' }, { cmd: 'edit.redo' }, '-', { cmd: 'select.all' }, { cmd: 'select.reselect' }, { cmd: 'edit.paste' }, '-', { cmd: 'layer.new' }, { cmd: 'layer.duplicate' }, { cmd: 'edit.freeTransform' }, '-', { cmd: 'view.fit' }, { cmd: 'view.actual' }];
  };
  A.layerContextMenu = function (l) {
    return [{ cmd: 'layer.duplicate' }, { cmd: 'layer.delete' }, { cmd: 'layer.rename' }, '-', { cmd: 'layer.group' }, { cmd: 'layer.ungroup' }, '-',
      { cmd: 'layer.effects' }, { cmd: 'layer.clearEffects' }, '-',
      { label: 'Layer Mask', sub: [{ cmd: 'layer.maskReveal', label: 'Reveal All' }, { cmd: 'layer.maskHide', label: 'Hide All' }, { cmd: 'layer.maskFromSel', label: 'From Selection' }, '-', { cmd: 'layer.maskToggle' }, { cmd: 'layer.maskInvert' }, { cmd: 'layer.maskApply' }, { cmd: 'layer.maskDelete' }] },
      { cmd: 'layer.clip' }, { cmd: 'select.layerPixels' }, '-', { cmd: 'layer.rasterize' }, { cmd: 'layer.rasterizeEffects' }, '-', { cmd: 'layer.mergeDown' }, { cmd: 'layer.mergeVisible' }, { cmd: 'layer.flatten' }, '-',
      { label: 'Export Layer as PNG', run: async () => { const d = doc(); const c = S.Compositor.renderSingle(Object.assign({}, l, { opacity: 1, blend: 'normal', clip: false }), d); U.downloadBlob(await U.canvasToBlob(c), l.name + '.png'); } }];
  };
  /** Small label drawn on the canvas overlay (sizes, angles…) */
  A.hud = function (ctx, x, y, text) {
    ctx.save();
    ctx.font = '11px ' + getComputedStyle(document.body).fontFamily;
    const w = ctx.measureText(text).width + 12;
    x = Math.min(x, S.View.w - w - 4); y = Math.min(y, S.View.h - 24);
    ctx.fillStyle = 'rgba(28,25,22,.92)'; ctx.strokeStyle = 'rgba(240,145,58,.6)';
    ctx.beginPath(); ctx.roundRect(x, y, w, 20, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f2ebe3'; ctx.fillText(text, x + 6, y + 14);
    ctx.restore();
  };
})();
