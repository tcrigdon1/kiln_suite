/* =========================================================================
   Gesso — Actions (recorded command sequences), Batch processing and "Export Layers to Files".

   Recording hooks: plain commands are recorded by Cmd.run; commands that open a dialog record what the
   dialog finally applied (filters / destructive adjustments with their parameters, Image Size as a
   percentage so it adapts to each picture, Canvas Size, Fill).  Actions are kept in localStorage
   ('gesso.actions') and can be played on the active document or on a folder of images (File ▸ Batch…).
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util;
  const AC = (S.Actions = { recording: null, playing: false });
  const doc = () => S.app.doc;

  AC.list = () => S.store.get('actions', []);
  AC.save = (list) => { S.store.set('actions', list); S.bus.emit('actions:changed'); };
  /** commands whose effect is recorded by their dialog instead (or that make no sense in an action) */
  const SKIP = /^(file\.|edit\.undo|edit\.redo|edit\.prefs|edit\.shortcuts|edit\.customizeToolbar|window\.|help\.|view\.|filter\.apply|filter\.gallery|filter\.smart|image\.adjust|image\.size|image\.canvasSize|image\.rotArb|image\.trim|edit\.fill$|edit\.patchFill|edit\.stroke|select\.colorRange|select\.refine|select\.feather|select\.expand|select\.contract|select\.border|select\.smooth|layer\.effects|layer\.rename|layer\.compNew|select\.save|view\.newGuide|edit\.freeTransform|edit\.meshWarp|app\.)/;
  AC.record = function (step) { if (AC.recording && !AC.playing) { AC.recording.steps.push(step); S.bus.emit('actions:changed'); } };
  AC.start = function (name) { AC.recording = { name: name || 'Action ' + (AC.list().length + 1), steps: [] }; S.bus.emit('actions:changed'); S.toast('Recording “' + AC.recording.name + '” — everything you do is noted until you press Stop'); };
  AC.stop = function () {
    const r = AC.recording; AC.recording = null;
    if (!r) return;
    if (!r.steps.length) { S.toast('Nothing recorded'); S.bus.emit('actions:changed'); return; }
    const list = AC.list(); list.push({ id: U.uid('act'), name: r.name, steps: r.steps }); AC.save(list);
    S.toast('Saved action “' + r.name + '” (' + r.steps.length + ' steps)');
  };
  AC.describe = function (st) {
    if (st.type === 'cmd') { const c = S.Cmd.map[st.id]; return (c ? c.label.replace(/…$/, '') : st.id) + (st.arg != null ? ' (' + st.arg + ')' : ''); }
    if (st.type === 'filter') return st.name + ' ' + JSON.stringify(st.params).slice(0, 60);
    if (st.type === 'imageSize') return 'Image Size ' + st.pct + ' % (' + st.method + ')';
    if (st.type === 'canvasSize') return 'Canvas Size ' + st.w + ' × ' + st.h;
    if (st.type === 'fill') return 'Fill (' + st.use + ', ' + st.opacity + ' %)';
    if (st.type === 'selModify') return st.label + ' ' + st.r + ' px';
    return st.type;
  };
  /** play one step on the active document */
  AC.playStep = async function (st) {
    const d = doc(); if (!d) return;
    if (st.type === 'cmd') { await S.Cmd.run(st.id, st.arg); return; }
    if (st.type === 'filter') {
      const fx = ImageFX.filters[st.id] || ImageFX.adjustments[st.id]; if (!fx) return;
      const t = await S.FX.effectTarget(d); if (!t) return;
      S.FX.applyWithParams(d, t, fx, st.params, st.name);
      return;
    }
    if (st.type === 'imageSize') { const k = st.pct / 100; d.commit('Image Size', () => S.Ops.resizeImage(d, Math.max(1, Math.round(d.width * k)), Math.max(1, Math.round(d.height * k)), st.method)); S.View.fit(d, false); S.bus.emit('doc:resized', d); return; }
    if (st.type === 'canvasSize') { d.commit('Canvas Size', () => S.Ops.resizeCanvas(d, st.w, st.h, st.ox, st.oy, st.fill)); S.View.fit(d, false); S.bus.emit('doc:resized', d); return; }
    if (st.type === 'fill') { S.App.fillApply(st); return; }
    if (st.type === 'selModify') { if (d.selection) d.setSelection(S.Sel[st.fn](d.selection, st.r), st.label); return; }
  };
  AC.play = async function (action) {
    if (!action || AC.playing) return;
    AC.playing = true;
    const prog = S.Progress.start('Playing “' + action.name + '”');
    try {
      for (let i = 0; i < action.steps.length; i++) {
        if (prog.cancelled) break;
        prog.set((i + 1) / action.steps.length, AC.describe(action.steps[i]).slice(0, 40));
        await AC.playStep(action.steps[i]);
        await S.Progress.tick();
      }
    } catch (e) { console.error(e); S.toast('Action failed: ' + e.message); }
    AC.playing = false; prog.done();
  };

  /* ---------- hooks ---------- */
  const run0 = S.Cmd.run;
  S.Cmd.run = function (id, arg) {
    const res = run0.call(S.Cmd, id, arg);
    if (AC.recording && !AC.playing && !SKIP.test(id) && S.Cmd.map[id]) AC.record({ type: 'cmd', id, arg });
    return res;
  };
  S.bus.on('action:filter', (st) => AC.record(st));

  /* ---------- commands & panel ---------- */
  S.Cmd.register('action.record', { label: 'Record Action…', run: async () => { if (AC.recording) { AC.stop(); return; } const n = await S.Dialog.prompt('Action name', 'Action ' + (AC.list().length + 1), 'Record Action'); if (n == null) return; AC.start(n); S.Panels.show('actions'); }, checked: () => !!AC.recording });
  S.Cmd.register('action.stop', { label: 'Stop Recording', run: () => AC.stop(), enabled: () => !!AC.recording });
  S.Cmd.register('action.playLast', { label: 'Play Last Action', key: 'F9', run: () => { const l = AC.list(); if (l.length) AC.play(l[AC.selected ? l.findIndex((a) => a.id === AC.selected) : l.length - 1] || l[l.length - 1]); }, enabled: () => !!doc() && AC.list().length > 0 });
  S.Cmd.register('file.batch', { label: 'Batch…', run: () => AC.batchDialog() });
  S.Cmd.register('file.exportLayers', { label: 'Export Layers to Files…', run: () => AC.exportLayersDialog(doc()), enabled: () => !!doc() });

  S.Panels.register({
    id: 'actions', title: 'Actions', icon: 'history', defaultNear: 'history', events: ['actions:changed', 'doc:switched'],
    build(body) {
      const list = U.el('div', { class: 'act-list' }), steps = U.el('div', { class: 'act-steps mono muted' }), foot = U.el('div', { class: 'panel-foot' });
      const b = (icon, tip, fn) => { const x = U.el('button', { class: 'icon-btn', html: S.icon(icon), 'data-tip': tip, 'data-tip-pos': 'top' }); x.onclick = fn; foot.appendChild(x); return x; };
      const rec = b('dots', 'Record a new action (click again to stop)', () => S.Cmd.run('action.record'));
      b('redo', 'Play the selected action on this document', () => { const a = AC.list().find((x) => x.id === AC.selected); if (a) AC.play(a); else S.toast('Select an action'); });
      b('image', 'Batch: play an action on a folder of images', () => S.Cmd.run('file.batch'));
      foot.appendChild(U.el('div', { style: { flex: 1 } }));
      b('trash', 'Delete the selected action', () => { AC.save(AC.list().filter((a) => a.id !== AC.selected)); AC.selected = null; });
      body.append(list, steps, foot); body.classList.add('flex-panel');
      return { update() {
        list.innerHTML = ''; steps.innerHTML = '';
        rec.classList.toggle('active', !!AC.recording);
        if (AC.recording) list.appendChild(U.el('div', { class: 'act-row recording' }, '● Recording “' + AC.recording.name + '” — ' + AC.recording.steps.length + ' steps'));
        const acts = AC.list();
        if (!acts.length && !AC.recording) list.appendChild(U.el('div', { class: 'empty-note' }, 'No actions yet. Press ● to record a sequence of commands (filters, adjustments, resizes…), then play it here or on a folder with Batch.'));
        for (const a of acts) {
          const r = U.el('div', { class: 'act-row' + (a.id === AC.selected ? ' active' : '') }, [U.el('span', { style: { flex: 1 } }, a.name), U.el('span', { class: 'muted' }, a.steps.length + ' steps')]);
          r.onclick = () => { AC.selected = a.id; S.bus.emit('actions:changed'); };
          r.ondblclick = async () => { const n = await S.Dialog.prompt('Action name', a.name, 'Rename Action'); if (n) { a.name = n; AC.save(acts); } };
          list.appendChild(r);
        }
        const cur = (AC.recording && { steps: AC.recording.steps }) || acts.find((a) => a.id === AC.selected);
        if (cur) cur.steps.forEach((st, i) => steps.appendChild(U.el('div', {}, (i + 1) + '. ' + AC.describe(st))));
      } };
    },
  });

  /* ---------- Batch ---------- */
  AC.batchDialog = function () {
    const acts = AC.list();
    if (!acts.length) { S.toast('Record an action first (Window ▸ Panels ▸ Actions)'); return; }
    const st = Object.assign({ action: acts[0].id, format: 'png', quality: 90, scale: 100, suffix: '-edited' }, S.store.get('batch', {}));
    if (!acts.find((a) => a.id === st.action)) st.action = acts[0].id;
    const files = [];
    const info = U.el('div', { class: 'muted' }, 'No files chosen');
    const pick = U.el('button', { class: 'btn btn-sm' }, 'Choose images…');
    pick.addEventListener('click', async () => {
      files.length = 0;
      if (window.showDirectoryPicker) {
        try { const dir = await window.showDirectoryPicker(); for await (const [name, h] of dir.entries()) if (h.kind === 'file' && /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(name)) files.push(await h.getFile()); info.textContent = files.length + ' images in the folder'; return; } catch (e) { if (e.name === 'AbortError') return; }
      }
      const inp = U.el('input', { type: 'file', multiple: true, accept: 'image/*' });
      inp.addEventListener('change', () => { files.push(...inp.files); info.textContent = files.length + ' files chosen'; });
      inp.click();
    });
    const ui = S.ParamUI.build([
      { id: 'action', label: 'Action', type: 'select', default: st.action, options: acts.map((a) => ({ value: a.id, label: a.name })) },
      { id: 'format', label: 'Save as', type: 'select', default: st.format, options: [{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPEG' }, { value: 'webp', label: 'WebP' }] },
      { id: 'quality', label: 'Quality', type: 'range', default: st.quality, min: 1, max: 100, unit: '%' },
      { id: 'scale', label: 'Scale', type: 'range', default: st.scale, min: 1, max: 400, unit: '%' },
      { id: 'suffix', label: 'File suffix', type: 'text', default: st.suffix },
      { id: 'note', type: 'note', label: 'Each image is opened, the action is played, the result is exported and the document closed. With the File System Access API the results go into a folder you choose; otherwise they download one by one.' },
    ], st, (v) => Object.assign(st, v));
    S.Dialog.open({ title: 'Batch', width: 440, body: U.el('div', {}, [U.el('div', { class: 'row', style: { marginBottom: '8px' } }, [pick, info]), ui]),
      buttons: [{ label: 'Cancel' }, { label: 'Run', primary: true, run: () => { if (!files.length) { S.toast('Choose images first'); return false; } S.store.set('batch', st); setTimeout(() => AC.batch(files.slice(), acts.find((a) => a.id === st.action), st), 50); } }] });
  };
  AC.batch = async function (files, action, st) {
    let dir = null;
    if (window.showDirectoryPicker) { try { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch (e) { if (e.name === 'AbortError') return; } }
    const prog = S.Progress.start('Batch');
    let n = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        if (prog.cancelled) break;
        const f = files[i]; prog.set(i / files.length, f.name);
        const url = URL.createObjectURL(f);
        let img; try { img = await U.loadImage(url); } catch (e) { URL.revokeObjectURL(url); continue; }
        URL.revokeObjectURL(url);
        const d = S.FileIO.docFromImage(img, f.name.replace(/\.[^.]+$/, ''));
        await AC.play(action);
        const c = S.FileIO.renderExport(d, st.scale / 100, st.format === 'jpeg' ? '#ffffff' : null);
        const ext = st.format === 'jpeg' ? 'jpg' : st.format, blob = await U.canvasToBlob(c, 'image/' + st.format, st.quality / 100);
        const fname = d.name + (st.suffix || '') + '.' + ext;
        try {
          if (dir) { const h = await dir.getFileHandle(fname, { create: true }); const w = await h.createWritable(); await w.write(blob); await w.close(); }
          else { U.downloadBlob(blob, fname); await new Promise((r) => setTimeout(r, 250)); }
          n++;
        } catch (e) { console.warn(e); }
        d.modified = false; await S.App.closeDoc(d);
      }
    } finally { prog.done(); }
    S.toast('Batch done: ' + n + ' file' + (n === 1 ? '' : 's'));
  };

  /* ---------- Export layers to files ---------- */
  AC.exportLayersDialog = function (d) {
    const st = Object.assign({ which: 'top', trim: true, format: 'png', quality: 90, hidden: false }, S.store.get('exportLayers', {}));
    S.Dialog.form('Export Layers to Files', [
      { id: 'which', label: 'Layers', type: 'select', default: st.which, options: [{ value: 'top', label: 'Top-level layers (groups as one image)' }, { value: 'all', label: 'Every layer (groups expanded)' }, { value: 'selected', label: 'Selected layers' }] },
      { id: 'hidden', label: 'Include hidden layers', type: 'checkbox', default: st.hidden },
      { id: 'trim', label: 'Trim each file to its content', type: 'checkbox', default: st.trim },
      { id: 'format', label: 'Format', type: 'select', default: st.format, options: [{ value: 'png', label: 'PNG (keeps transparency)' }, { value: 'jpeg', label: 'JPEG' }, { value: 'webp', label: 'WebP' }] },
      { id: 'quality', label: 'Quality', type: 'range', default: st.quality, min: 1, max: 100, unit: '%' },
    ], st, (v) => { S.store.set('exportLayers', v); setTimeout(() => AC.exportLayers(d, v), 30); }, { width: 420 });
  };
  AC.exportLayers = async function (d, st) {
    let layers = st.which === 'all' ? d.allLayers().filter((l) => l.type !== 'group') : st.which === 'selected' ? d.selectedLayers() : d.layers.slice();
    if (!st.hidden) layers = layers.filter((l) => l.visible);
    if (!layers.length) { S.toast('No layers to export'); return; }
    let dir = null;
    if (window.showDirectoryPicker) { try { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch (e) { if (e.name === 'AbortError') return; } }
    const prog = S.Progress.start('Export layers');
    let n = 0;
    try {
      for (let i = 0; i < layers.length; i++) {
        if (prog.cancelled) break;
        const l = layers[i]; prog.set(i / layers.length, l.name);
        let c = S.Compositor.renderSingle(Object.assign({}, l, { visible: true, clip: false }), d);
        if (st.trim) { const t = S.Layers.trim(c); c = t.width > 1 || t.height > 1 ? t : c; }
        if (st.format === 'jpeg') { const j = U.createCanvas(c.width, c.height), x = j.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, j.width, j.height); x.drawImage(c, 0, 0); c = j; }
        const ext = st.format === 'jpeg' ? 'jpg' : st.format, blob = await U.canvasToBlob(c, 'image/' + st.format, st.quality / 100);
        const fname = d.name + ' — ' + String(i + 1).padStart(2, '0') + ' ' + l.name.replace(/[\\/:*?"<>|]/g, '_') + '.' + ext;
        try {
          if (dir) { const h = await dir.getFileHandle(fname, { create: true }); const w = await h.createWritable(); await w.write(blob); await w.close(); }
          else { U.downloadBlob(blob, fname); await new Promise((r) => setTimeout(r, 250)); }
          n++;
        } catch (e) { console.warn(e); }
        await S.Progress.tick();
      }
    } finally { prog.done(); }
    S.toast('Exported ' + n + ' layer' + (n === 1 ? '' : 's'));
  };
})();
