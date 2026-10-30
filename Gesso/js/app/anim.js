/* =========================================================================
   Gesso — Frame Animation.  Frames are Layer-Comp style snapshots (visibility, opacity, position, appearance)
   with a delay; switching frames records the one you leave and applies the one you open, so you animate by
   editing layers frame by frame.  Tween inserts in-between frames (opacity + position).  Export to GIF, APNG
   or WebM (File ▸ Export ▸ Animation…).  doc.anim = { frames: [{ id, delay, layers }], current, loop }
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util, P = S.Panels;
  const AN = (S.Anim = {});
  const CAP = { visibility: true, position: true, appearance: true };

  AN.get = (doc) => doc && doc.anim && doc.anim.frames && doc.anim.frames.length ? doc.anim : null;
  AN.current = (doc) => { const a = AN.get(doc); if (!a) return null; return a.frames.find((f) => f.id === a.current) || a.frames[0]; };
  function frameOf(doc, delay) { return Object.assign({ id: U.uid('fr'), delay: delay || 100 }, S.Comps.capture(doc, CAP)); }
  function emit(doc) { S.bus.emit('anim:changed', doc); }

  /** Start animating: the current document state becomes frame 1 */
  AN.create = function (doc) {
    if (AN.get(doc)) return;
    doc.commit('Create Animation', () => { const f = frameOf(doc, 100); doc.anim = { frames: [f], current: f.id, loop: true }; });
    emit(doc);
  };
  /** record the live layer state into the current frame (what Layer Comps call Update) */
  AN.record = function (doc, inCommit) {
    const a = AN.get(doc), cur = AN.current(doc); if (!a || !cur) return;
    const do_ = () => { const snap = S.Comps.capture(doc, CAP); cur.layers = snap.layers; cur._thumb = null; };
    if (inCommit) do_(); else doc.commit('Update Frame', do_, { key: 'anim-record', selection: false });
  };
  /** show a frame: records the one being left first (PS behaviour) */
  AN.goto = function (doc, id, opts) {
    const a = AN.get(doc); if (!a) return;
    const target = a.frames.find((f) => f.id === id); if (!target) return;
    const prev = AN.current(doc);
    doc.commit('Go to Frame', () => {
      if (prev && prev !== target && !(opts && opts.noRecord)) { const snap = S.Comps.capture(doc, CAP); prev.layers = snap.layers; prev._thumb = null; }
      S.Comps.applyRecords(doc, target); a.current = target.id;
    }, { selection: false });
    S.bus.emit('activeLayer:changed', doc); emit(doc);
  };
  AN.add = function (doc) {
    const a = AN.get(doc); if (!a) { AN.create(doc); return; }
    const cur = AN.current(doc), i = a.frames.indexOf(cur);
    doc.commit('New Frame', () => {
      const snap = S.Comps.capture(doc, CAP); cur.layers = snap.layers; cur._thumb = null; // keep what was edited on the current frame
      const f = Object.assign({ id: U.uid('fr'), delay: cur.delay }, S.Comps.capture(doc, CAP));
      a.frames.splice(i + 1, 0, f); a.current = f.id;
    });
    emit(doc);
  };
  AN.remove = function (doc, id) {
    const a = AN.get(doc); if (!a || a.frames.length <= 1) { if (a) AN.clear(doc); return; }
    const i = a.frames.findIndex((f) => f.id === id); if (i < 0) return;
    doc.commit('Delete Frame', () => { a.frames.splice(i, 1); if (a.current === id) { const n = a.frames[Math.min(i, a.frames.length - 1)]; S.Comps.applyRecords(doc, n); a.current = n.id; } });
    S.bus.emit('activeLayer:changed', doc); emit(doc);
  };
  AN.clear = function (doc) { doc.commit('Remove Animation', () => { doc.anim = null; }); emit(doc); };
  AN.move = function (doc, id, dir) {
    const a = AN.get(doc); if (!a) return; const i = a.frames.findIndex((f) => f.id === id), j = i + dir; if (i < 0 || j < 0 || j >= a.frames.length) return;
    doc.commit('Reorder Frames', () => { const f = a.frames.splice(i, 1)[0]; a.frames.splice(j, 0, f); }); emit(doc);
  };
  AN.setDelay = function (doc, ids, ms) {
    const a = AN.get(doc); if (!a) return;
    doc.commit('Frame Delay', () => { a.frames.forEach((f) => { if (!ids || ids.includes(f.id)) f.delay = Math.max(10, Math.round(ms)); }); }, { key: 'anim-delay', selection: false }); emit(doc);
  };
  /** linear interpolation of two frame records (opacity, position); visibility & appearance come from A */
  function lerpRecords(A, B, t) {
    const out = {};
    for (const id in A.layers) {
      const a = A.layers[id], b = B.layers[id]; const r = JSON.parse(JSON.stringify(a)); out[id] = r;
      if (!b) continue;
      if (a.opacity != null && b.opacity != null) r.opacity = a.opacity + (b.opacity - a.opacity) * t;
      if (a.fillOpacity != null && b.fillOpacity != null) r.fillOpacity = a.fillOpacity + (b.fillOpacity - a.fillOpacity) * t;
      const p = a.pos, q = b.pos; if (!p || !q || p.kind !== q.kind) continue;
      const L = (x, y) => Math.round(x + (y - x) * t);
      if (p.kind === 'raster') { r.pos.ox = L(p.ox, q.ox); r.pos.oy = L(p.oy, q.oy); r.pos.mox = L(p.mox, q.mox); r.pos.moy = L(p.moy, q.moy); if (p.em && q.em) r.pos.em = p.em.map((v, i) => v + (q.em[i] - v) * t); }
      else if (p.kind === 'text') { r.pos.x = p.x + (q.x - p.x) * t; r.pos.y = p.y + (q.y - p.y) * t; if (p.matrix && q.matrix) r.pos.matrix = p.matrix.map((v, i) => v + (q.matrix[i] - v) * t); }
      else if (p.kind === 'fill') { r.pos.ox = L(p.ox, q.ox); r.pos.oy = L(p.oy, q.oy); }
      else if (p.kind === 'shape') { try { const ba = S.Shape.bounds(p.shape), bb = S.Shape.bounds(q.shape); if (ba && bb) { const sh = JSON.parse(JSON.stringify(p.shape)); S.Shape.translate(sh, (bb.x - ba.x) * t, (bb.y - ba.y) * t); r.pos.shape = sh; } } catch (e) { } }
    }
    return out;
  }
  /** insert n in-between frames after frame id (towards the next frame, or the first frame when looping from the last) */
  AN.tween = function (doc, id, n) {
    const a = AN.get(doc); if (!a) return; const i = a.frames.findIndex((f) => f.id === id); if (i < 0) return;
    const A = a.frames[i], B = a.frames[i + 1] || a.frames[0]; if (A === B) return;
    doc.commit('Tween Frames', () => {
      AN.record(doc, true); // the current frame's live edits count
      const ins = [];
      for (let k = 1; k <= n; k++) ins.push({ id: U.uid('fr'), delay: A.delay, layers: lerpRecords(A, B, k / (n + 1)), opts: A.opts });
      a.frames.splice(i + 1, 0, ...ins);
    });
    emit(doc);
  };

  /* ---------- playback ---------- */
  let playing = null;
  AN.playing = () => !!playing;
  AN.stop = function () { if (!playing) return; clearTimeout(playing.t); const doc = playing.doc; playing = null; emit(doc); };
  AN.play = function (doc) {
    const a = AN.get(doc); if (!a || playing) return;
    AN.record(doc); // keep edits made on the current frame
    let i = Math.max(0, a.frames.indexOf(AN.current(doc)));
    playing = { doc, t: null };
    const step = () => {
      if (!playing || playing.doc !== doc || !AN.get(doc)) { playing = null; emit(doc); return; }
      const f = a.frames[i];
      doc.commit('Play Animation', () => { S.Comps.applyRecords(doc, f); a.current = f.id; }, { key: 'anim-play', selection: false });
      emit(doc);
      i++;
      if (i >= a.frames.length) { if (a.loop === false) { playing = null; emit(doc); return; } i = 0; }
      playing.t = setTimeout(step, f.delay);
    };
    step();
  };

  /* ---------- rendering & export ---------- */
  /** render every frame to a canvas at scale (restores the document afterwards); onProgress(k) */
  AN.renderFrames = async function (doc, scale, opts) {
    const a = AN.get(doc); if (!a) return [];
    AN.record(doc);
    const before = doc.captureState(), prev = a.current, out = [];
    try {
      for (let i = 0; i < a.frames.length; i++) {
        const f = a.frames[i];
        S.Comps.applyRecords(doc, f); doc.invalidate(); S.Compositor.update(doc);
        const c = S.FileIO.renderExport(doc, scale, opts && opts.matte ? opts.matte : null);
        out.push({ data: c, delay: f.delay });
        if (opts && opts.onProgress) opts.onProgress((i + 1) / a.frames.length);
        if (opts && opts.cancelled && opts.cancelled()) break;
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally { doc.restoreState(before); a.current = prev; S.bus.emit('layers:changed', doc); }
    return out;
  };
  AN.thumb = function (doc, f) {
    if (f._thumb) return f._thumb;
    const cur = AN.current(doc);
    try {
      if (f !== cur) { S.Comps.applyRecords(doc, f); doc.invalidate(); S.Compositor.update(doc); }
      const k = 56 / Math.max(doc.width, doc.height);
      f._thumb = S.FileIO.renderExport(doc, k, null);
    } catch (e) { f._thumb = null; }
    finally { if (f !== cur && cur) { S.Comps.applyRecords(doc, cur); doc.invalidate(); S.Compositor.update(doc); } }
    return f._thumb;
  };
  const fmtBytes = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
  async function save(blob, name, mime, ext, desc) {
    if (window.showSaveFilePicker) {
      try { const h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: desc, accept: { [mime]: ['.' + ext] } }] }); const w = await h.createWritable(); await w.write(blob); await w.close(); return true; }
      catch (e) { if (e.name === 'AbortError') return false; }
    }
    U.downloadBlob(blob, name); return true;
  }
  AN.exportDialog = function (doc) {
    const a = AN.get(doc); if (!a) { S.toast('No animation frames — open the Animation panel and add frames first'); return; }
    const last = S.store.get('animExport', { format: 'gif', scale: 100, dither: true, transparent: false, loop: true });
    const defs = [
      { id: 'format', label: 'Format', type: 'select', default: last.format, options: [{ value: 'gif', label: 'Animated GIF (256 colours)' }, { value: 'apng', label: 'Animated PNG (full colour, alpha)' }, { value: 'webm', label: 'WebM video (real-time capture)' }] },
      { id: 'scale', label: 'Scale', type: 'range', default: last.scale, min: 5, max: 200, step: 1, unit: '%' },
      { id: 'dither', label: 'Dither (GIF)', type: 'checkbox', default: last.dither !== false },
      { id: 'transparent', label: 'Transparent background (GIF/APNG)', type: 'checkbox', default: !!last.transparent },
      { id: 'loop', label: 'Loop forever', type: 'checkbox', default: last.loop !== false },
    ];
    let vals = {}; defs.forEach((d) => (vals[d.id] = d.default));
    const info = U.el('div', { class: 'muted', style: { fontSize: '11px', marginTop: '6px' } });
    const upd = () => { const sc = vals.scale / 100, w = Math.round(doc.width * sc), h = Math.round(doc.height * sc), ms = a.frames.reduce((s, f) => s + f.delay, 0); info.textContent = a.frames.length + ' frames · ' + w + ' × ' + h + ' px · ' + (ms / 1000).toFixed(2) + ' s per loop' + (vals.format === 'webm' ? ' · captured in real time through MediaRecorder' : ''); };
    const ui = S.ParamUI.build(defs, vals, (v) => { vals = v; upd(); }); upd();
    S.Dialog.open({ title: 'Export Animation', body: U.el('div', {}, [ui, info]), width: 440, buttons: [{ label: 'Cancel' }, { label: 'Export', primary: true, run: async () => {
      S.store.set('animExport', vals);
      const prog = S.Progress.start('Rendering frames', { cancellable: true });
      try {
        const frames = await AN.renderFrames(doc, vals.scale / 100, { matte: vals.transparent ? null : '#ffffff', onProgress: (k) => prog.set(k * 0.5), cancelled: () => prog.cancelled });
        if (prog.cancelled || !frames.length) return;
        const base = doc.name.replace(/\.[^.]+$/, '');
        if (vals.format === 'gif') {
          const blob = window.AnimEnc.gif(frames, { loop: vals.loop ? 0 : -1, dither: vals.dither, transparent: vals.transparent, onProgress: (k) => prog.set(0.5 + k * 0.5) });
          if (await save(blob, base + '.gif', 'image/gif', 'gif', 'Animated GIF')) S.toast('Exported ' + base + '.gif (' + fmtBytes(blob.size) + ')');
        } else if (vals.format === 'apng') {
          const blob = await window.AnimEnc.apng(frames, { loop: vals.loop ? 0 : 1, onProgress: (k) => prog.set(0.5 + k * 0.5) });
          if (await save(blob, base + '.png', 'image/png', 'png', 'Animated PNG')) S.toast('Exported ' + base + '.png (APNG, ' + fmtBytes(blob.size) + ')');
        } else {
          const blob = await recordWebm(frames, (k) => prog.set(0.5 + k * 0.5));
          if (blob && await save(blob, base + '.webm', 'video/webm', 'webm', 'WebM video')) S.toast('Exported ' + base + '.webm (' + fmtBytes(blob.size) + ')');
        }
      } catch (e) { console.error(e); S.toast('Export failed: ' + (e && e.message || e)); } finally { prog.done(); }
    } }] });
  };
  // WebM through canvas.captureStream + MediaRecorder: plays the frames in real time while recording
  function recordWebm(frames, onProgress) {
    return new Promise((resolve) => {
      if (!window.MediaRecorder) { S.toast('MediaRecorder is not available in this browser'); resolve(null); return; }
      const c = U.createCanvas(frames[0].data.width, frames[0].data.height), x = c.getContext('2d');
      const stream = c.captureStream(30), rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm' }), parts = [];
      rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
      rec.onstop = () => resolve(new Blob(parts, { type: 'video/webm' }));
      let i = 0;
      const draw = () => { x.clearRect(0, 0, c.width, c.height); x.drawImage(frames[i].data, 0, 0); };
      draw(); rec.start(100);
      const step = () => { onProgress((i + 1) / frames.length); const d = frames[i].delay; i++; if (i >= frames.length) { setTimeout(() => rec.stop(), Math.max(d, 60)); return; } setTimeout(() => { draw(); step(); }, d); };
      step();
    });
  }

  /* ---------- panel ---------- */
  P.register({
    id: 'animation', title: 'Animation', icon: 'play', defaultNear: 'history', events: ['anim:changed', 'doc:switched', 'history:changed'],
    build(body) {
      body.classList.add('anim-panel');
      const strip = U.el('div', { class: 'anim-strip' });
      const foot = U.el('div', { class: 'panel-foot anim-foot' });
      const btn = (icon, tip, fn, label) => { const b = U.el('button', { class: 'icon-btn' + (label ? ' with-label' : ''), html: (icon ? S.icon(icon) : '') + (label ? '<span>' + label + '</span>' : ''), 'data-tip': tip, 'data-tip-pos': 'top' }); b.onclick = fn; return b; };
      const doc = () => S.app.doc;
      const playBtn = btn('play', 'Play / stop (Space in the panel)', () => { const d = doc(); if (!d) return; if (AN.playing()) AN.stop(); else AN.play(d); });
      const addBtn = btn('plus', 'New frame (duplicates the current one)', () => { const d = doc(); if (d) AN.add(d); });
      const delBtn = btn('trash', 'Delete frame', () => { const d = doc(); const c = d && AN.current(d); if (c) AN.remove(d, c.id); });
      const tweenBtn = btn('sliders', 'Tween: insert in-between frames towards the next frame', async () => { const d = doc(); const c = d && AN.current(d); if (!c) return; const n = await S.Dialog.prompt('Frames to add between this frame and the next (opacity and position are interpolated)', '5', 'Tween'); if (n == null) return; AN.tween(d, c.id, Math.max(1, Math.min(120, +n | 0))); });
      const expBtn = btn('export', 'Export animation (GIF / APNG / WebM)', () => { const d = doc(); if (d) AN.exportDialog(d); });
      const delay = U.el('input', { type: 'number', min: 10, max: 10000, step: 10, value: 100, class: 'anim-delay', 'data-tip': 'Frame delay (ms) — applies to the current frame; Shift+Enter applies to all', 'data-tip-pos': 'top' });
      delay.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { const d = doc(); const c = d && AN.current(d); if (c) AN.setDelay(d, e.shiftKey ? null : [c.id], +delay.value); delay.blur(); } });
      delay.addEventListener('change', () => { const d = doc(); const c = d && AN.current(d); if (c) AN.setDelay(d, [c.id], +delay.value); });
      const loop = U.el('input', { type: 'checkbox', checked: true, 'data-tip': 'Loop playback', 'data-tip-pos': 'top' });
      loop.onchange = () => { const d = doc(); if (d && d.anim) { d.anim.loop = loop.checked; } };
      const info = U.el('span', { class: 'muted anim-info' });
      foot.append(playBtn, addBtn, delBtn, tweenBtn, U.el('span', { class: 'sep' }), delay, U.el('span', { class: 'muted' }, 'ms'), U.el('label', { class: 'anim-loop' }, [loop, U.el('span', {}, 'loop')]), U.el('div', { style: { flex: 1 } }), info, expBtn);
      const empty = U.el('div', { class: 'anim-empty' });
      const start = U.el('button', { class: 'btn primary sm' }, 'Make Frame Animation'); start.onclick = () => { const d = doc(); if (d) AN.create(d); };
      empty.append(U.el('div', { class: 'muted', style: { marginBottom: '6px' } }, 'Turn the layers into frames: each frame remembers which layers are visible, their opacity and position. Edit, add a frame, move things, repeat.'), start);
      body.append(empty, strip, foot);
      let dragId = null;
      strip.addEventListener('keydown', (e) => { if (e.key === ' ') { e.preventDefault(); playBtn.click(); } });
      function render() {
        const d = doc(), a = d && AN.get(d);
        empty.style.display = a ? 'none' : ''; strip.style.display = a ? '' : 'none'; foot.style.display = a ? '' : 'none';
        if (!a) { if (!d) empty.querySelector('button').disabled = true; else empty.querySelector('button').disabled = false; return; }
        const cur = AN.current(d); if (cur && !AN.playing()) cur._thumb = null; // the live frame may have been edited
        playBtn.innerHTML = S.icon(AN.playing() ? 'stop' : 'play');
        if (document.activeElement !== delay) delay.value = cur ? cur.delay : 100;
        loop.checked = a.loop !== false;
        info.textContent = a.frames.length + ' frame' + (a.frames.length === 1 ? '' : 's') + ' · ' + (a.frames.reduce((s, f) => s + f.delay, 0) / 1000).toFixed(2) + ' s';
        strip.innerHTML = '';
        a.frames.forEach((f, i) => {
          const el = U.el('div', { class: 'anim-frame' + (f === cur ? ' active' : ''), draggable: 'true', tabindex: '0', title: 'Frame ' + (i + 1) + ' · ' + f.delay + ' ms' });
          const th = U.el('div', { class: 'anim-thumb' });
          if (!AN.playing()) { const c = AN.thumb(d, f); if (c) th.appendChild(c); }
          el.append(th, U.el('div', { class: 'anim-num' }, String(i + 1)), U.el('div', { class: 'anim-ms' }, (f.delay / 1000).toFixed(2)));
          el.onclick = () => { if (AN.playing()) AN.stop(); AN.goto(d, f.id); };
          el.ondragstart = (e) => { dragId = f.id; e.dataTransfer.effectAllowed = 'move'; };
          el.ondragover = (e) => { e.preventDefault(); };
          el.ondrop = (e) => { e.preventDefault(); if (!dragId || dragId === f.id) return; const from = a.frames.findIndex((x) => x.id === dragId); const to = i; d.commit('Reorder Frames', () => { const fr = a.frames.splice(from, 1)[0]; a.frames.splice(to, 0, fr); }); dragId = null; emit(d); };
          el.oncontextmenu = (e) => { S.Menu.context([
            { label: 'Duplicate Frame', run: () => { AN.goto(d, f.id); AN.add(d); } },
            { label: 'Tween to Next…', run: () => tweenBtn.click() },
            { label: 'Move Left', run: () => AN.move(d, f.id, -1), disabled: i === 0 }, { label: 'Move Right', run: () => AN.move(d, f.id, 1), disabled: i === a.frames.length - 1 },
            '-', { label: 'Delete Frame', run: () => AN.remove(d, f.id) }, { label: 'Remove Animation (keep layers as they are)', run: () => AN.clear(d) }], e); };
          strip.appendChild(el);
        });
        const act = strip.querySelector('.anim-frame.active'); if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      render();
      return { update: render };
    },
  });

  S.Cmd.register('file.exportAnim', { label: 'Export Animation (GIF / APNG / WebM)…', run: () => AN.exportDialog(S.app.doc), enabled: () => !!(S.app.doc && AN.get(S.app.doc)) });
  S.Cmd.register('anim.new', { label: 'Animation: New Frame', run: () => AN.add(S.app.doc), enabled: () => !!S.app.doc });
  S.Cmd.register('anim.play', { label: 'Animation: Play / Stop', run: () => { const d = S.app.doc; if (AN.playing()) AN.stop(); else AN.play(d); }, enabled: () => !!(S.app.doc && AN.get(S.app.doc)) });
  S.Cmd.register('anim.next', { label: 'Animation: Next Frame', run: () => { const d = S.app.doc, a = AN.get(d); if (!a) return; const i = a.frames.indexOf(AN.current(d)); AN.goto(d, a.frames[(i + 1) % a.frames.length].id); }, enabled: () => !!(S.app.doc && AN.get(S.app.doc)) });
  S.Cmd.register('anim.prev', { label: 'Animation: Previous Frame', run: () => { const d = S.app.doc, a = AN.get(d); if (!a) return; const i = a.frames.indexOf(AN.current(d)); AN.goto(d, a.frames[(i - 1 + a.frames.length) % a.frames.length].id); }, enabled: () => !!(S.app.doc && AN.get(S.app.doc)) });
})();
