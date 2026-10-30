/* =========================================================================
   Gesso — Magnetic Lasso (edge-snapping selection), File ▸ Automate ▸ Contact Sheet…, and
   File ▸ Automate ▸ Data-Driven Export… (one image per CSV row, text layers filled from columns).
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util, T = S.Tools;

  /* ---------- Magnetic Lasso ---------- */
  // cost map: low where the gradient is strong; built once per stroke over the whole document at ≤ 1 px
  function costMap(doc) {
    // documents above ~3 MP are analysed at reduced resolution (k = 2, 3…); paths are scaled back up
    const k = Math.max(1, Math.ceil(Math.sqrt((doc.width * doc.height) / 3e6)));
    let flat = S.Compositor.flatten(doc);
    if (k > 1) flat = S.Ops.resample(flat, Math.max(2, Math.round(doc.width / k)), Math.max(2, Math.round(doc.height / k)), 'bilinear');
    const w = flat.width, h = flat.height;
    const d = flat.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data, lum = new Float32Array(w * h);
    for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    const g = new Float32Array(w * h); let gmax = 1e-6;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (lum[i + 1 - w] + 2 * lum[i + 1] + lum[i + 1 + w]) - (lum[i - 1 - w] + 2 * lum[i - 1] + lum[i - 1 + w]);
      const gy = (lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1]) - (lum[i - w - 1] + 2 * lum[i - w] + lum[i - w + 1]);
      const m = Math.hypot(gx, gy); g[i] = m; if (m > gmax) gmax = m;
    }
    const cost = new Float32Array(w * h);
    for (let i = 0; i < cost.length; i++) cost[i] = 1 - g[i] / gmax; // 0 on the strongest edge, 1 on flat areas
    return { cost, w, h, k };
  }
  const toLow = (cm, p) => [Math.min(cm.w - 1, Math.round(p[0] / cm.k)), Math.min(cm.h - 1, Math.round(p[1] / cm.k))];
  const toDoc = (cm, p) => [p[0] * cm.k, p[1] * cm.k];
  // cheapest 8-connected path from a to b (Dijkstra limited to a padded box around the two points)
  function livewire(cm, A, B, width) {
    const { cost, w, h } = cm, a = toLow(cm, A), b = toLow(cm, B);
    const pad = Math.max(8, Math.round((width || 24) / cm.k));
    const x0 = Math.max(0, Math.min(a[0], b[0]) - pad), x1 = Math.min(w - 1, Math.max(a[0], b[0]) + pad);
    const y0 = Math.max(0, Math.min(a[1], b[1]) - pad), y1 = Math.min(h - 1, Math.max(a[1], b[1]) + pad);
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, n = bw * bh;
    if (n > 400000) return [A.slice(), B.slice()]; // too far from the last anchor for a live search: straight segment
    const dist = new Float32Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    const si = (a[1] - y0) * bw + (a[0] - x0), ti = (b[1] - y0) * bw + (b[0] - x0);
    dist[si] = 0;
    // binary heap
    const heap = [], hpush = (d, i) => { heap.push([d, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const hpop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    hpush(0, si);
    while (heap.length) {
      const [dcur, i] = hpop(); if (done[i]) continue; done[i] = 1; if (i === ti) break;
      const x = i % bw, y = (i - x) / bw;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
        const j = ny * bw + nx; if (done[j]) continue;
        const c = cost[(ny + y0) * w + (nx + x0)], step = (dx && dy ? 1.4142 : 1) * (0.05 + c * c);
        const nd = dcur + step; if (nd < dist[j]) { dist[j] = nd; prev[j] = i; hpush(nd, j); }
      }
    }
    const path = []; let k = ti; if (prev[k] < 0 && k !== si) return [A.slice(), B.slice()];
    while (k >= 0) { path.push(toDoc(cm, [k % bw + x0, Math.floor(k / bw) + y0])); if (k === si) break; k = prev[k]; }
    path.reverse(); path[0] = A.slice(); path[path.length - 1] = B.slice(); return path;
  }
  T.register({
    id: 'magLasso', name: 'Magnetic Lasso', key: 'L', icon: 'magLasso', group: 'lasso', cursor: 'crosshair',
    opts: { mode: 'new', feather: 0, width: 32, freq: 20 },
    options(bar) {
      T.ui.selMode(bar, this.opts); T.ui.num(bar, 'Feather', this.opts, 'feather', 0, 250, { unit: 'px' });
      T.ui.num(bar, 'Width', this.opts, 'width', 4, 120, { unit: 'px' }); T.ui.num(bar, 'Frequency', this.opts, 'freq', 4, 100, { unit: 'px' });
      bar.appendChild(U.el('span', { class: 'muted opt-hint' }, 'Click to start, move along the edge (anchors drop on their own), click to pin, Enter / double-click to close, Backspace removes an anchor'));
    },
    activate() { this.reset(); },
    deactivate() { this.reset(); },
    reset() { this.anchors = null; this.segs = null; this.live = null; this.cm = null; this.hover = null; },
    clampPt(doc, info) { return [U.clamp(Math.round(info.x), 0, doc.width - 1), U.clamp(Math.round(info.y), 0, doc.height - 1)]; },
    // pull a point onto the strongest edge within the lasso width (nearer edges win over slightly stronger far ones)
    snap(p) {
      const cm = this.cm; if (!cm) return p;
      const q = toLow(cm, p), R = Math.max(2, Math.round(this.opts.width / 2 / cm.k)); let best = null, bs = Infinity;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const x = q[0] + dx, y = q[1] + dy; if (x < 0 || y < 0 || x >= cm.w || y >= cm.h) continue;
        const dist = Math.hypot(dx, dy); if (dist > R) continue;
        const sc = cm.cost[y * cm.w + x] + dist / R * 0.35; if (sc < bs) { bs = sc; best = [x, y]; }
      }
      return best && bs < 0.6 ? toDoc(cm, best) : p; // no real edge nearby: keep the click
    },
    onDown(info, doc) {
      let p = this.clampPt(doc, info);
      if (!this.anchors) { this.cm = costMap(doc); this.anchors = [this.snap(p)]; this.segs = []; this.mode = T.selModeFrom(info, this.opts.mode); S.View.redraw(); return; }
      const f = this.anchors[0];
      if (this.anchors.length > 1 && Math.hypot((p[0] - f[0]) * doc.view.zoom, (p[1] - f[1]) * doc.view.zoom) < 8) { this.close(doc); return; }
      this.pin(info.alt ? p : this.snap(p)); // Alt-click pins exactly where you click
    },
    pin(p) { const last = this.anchors[this.anchors.length - 1]; this.segs.push(livewire(this.cm, last, p, this.opts.width)); this.anchors.push(p); this.live = null; S.View.redraw(); },
    onHover(info, doc) {
      if (!this.anchors) return;
      const p = this.snap(this.clampPt(doc, info)), last = this.anchors[this.anchors.length - 1];
      this.live = livewire(this.cm, last, p, this.opts.width);
      // drop an anchor automatically every `freq` px of travel so the path stays glued to the edge behind the cursor
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= this.opts.freq) { const k = this.live[Math.max(0, this.live.length - 1 - Math.round(this.opts.freq / 2))]; if (k && (k[0] !== last[0] || k[1] !== last[1])) this.pin(k); }
      S.View.redraw();
    },
    onMove(info, doc) { this.onHover(info, doc); },
    onDblClick(info, doc) { if (this.anchors) this.close(doc); },
    onKey(e, doc) {
      if (!this.anchors) return false;
      if (e.key === 'Escape') { this.reset(); S.View.redraw(); return true; }
      if (e.key === 'Enter') { this.close(doc); return true; }
      if (e.key === 'Backspace' || e.key === 'Delete') { if (this.anchors.length > 1) { this.anchors.pop(); this.segs.pop(); } else this.reset(); S.View.redraw(); return true; }
      return false;
    },
    outline() { const pts = []; (this.segs || []).forEach((s) => s.forEach((p) => pts.push(p))); if (this.live) this.live.forEach((p) => pts.push(p)); return pts; },
    close(doc) {
      const a = this.anchors; if (!a || a.length < 2) { this.reset(); S.View.redraw(); return; }
      const back = livewire(this.cm, a[a.length - 1], a[0], this.opts.width);
      const pts = []; this.segs.forEach((s) => s.forEach((p) => pts.push(p))); back.forEach((p) => pts.push(p));
      const mode = this.mode, feather = this.opts.feather; this.reset();
      if (pts.length < 3) return;
      T.finishSelection(doc, S.Sel.polygonMask(doc.width, doc.height, pts), mode, feather, 'Magnetic Lasso');
    },
    drawOverlay(ctx, doc) {
      if (!this.anchors) return;
      const pts = this.outline(); if (!pts.length) return;
      ctx.save(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.setLineDash([]); ctx.beginPath();
      pts.forEach((p, i) => { const [x, y] = S.View.toScreen(p[0], p[1], doc); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
      ctx.strokeStyle = '#f0913a'; ctx.setLineDash([4, 3]); ctx.stroke();
      this.anchors.forEach((p) => { const [x, y] = S.View.toScreen(p[0], p[1], doc); ctx.fillStyle = '#f0913a'; ctx.beginPath(); ctx.rect(x - 2.5, y - 2.5, 5, 5); ctx.fill(); });
      ctx.restore();
    },
  });

  /* ---------- Contact Sheet ---------- */
  S.App.contactSheetDialog = async function () {
    const files = await pickImages(); if (!files || !files.length) return;
    const last = S.store.get('contact', { cols: 4, thumb: 360, gap: 16, labels: true, bg: '#1c1b19', fg: '#e8e4dd' });
    const defs = [
      { id: 'cols', label: 'Columns', type: 'range', default: last.cols, min: 1, max: 12, step: 1 },
      { id: 'thumb', label: 'Thumbnail size', type: 'range', default: last.thumb, min: 80, max: 1200, step: 10, unit: 'px' },
      { id: 'gap', label: 'Gap', type: 'range', default: last.gap, min: 0, max: 100, step: 1, unit: 'px' },
      { id: 'labels', label: 'File names under thumbnails', type: 'checkbox', default: last.labels !== false },
      { id: 'bg', label: 'Background', type: 'color', default: last.bg }, { id: 'fg', label: 'Label colour', type: 'color', default: last.fg },
    ];
    let vals = {}; defs.forEach((d) => (vals[d.id] = d.default));
    const ui = S.ParamUI.build(defs, vals, (v) => { vals = v; });
    S.Dialog.open({ title: 'Contact Sheet — ' + files.length + ' image' + (files.length === 1 ? '' : 's'), body: ui, width: 420, buttons: [{ label: 'Cancel' }, { label: 'Make Sheet', primary: true, run: async () => {
      S.store.set('contact', vals);
      const prog = S.Progress.start('Building contact sheet');
      try {
        const imgs = [];
        for (let i = 0; i < files.length; i++) { try { imgs.push({ name: files[i].name, img: await loadFile(files[i]) }); } catch (e) { } prog.set((i + 1) / files.length); }
        if (!imgs.length) { S.toast('None of the files could be read'); return; }
        const cols = vals.cols, th = vals.thumb, gap = vals.gap, lab = vals.labels ? 22 : 0, rows = Math.ceil(imgs.length / cols);
        const W = cols * th + (cols + 1) * gap, H = rows * (th + lab) + (rows + 1) * gap;
        const doc = S.App.createDoc({ name: 'Contact Sheet', w: W, h: H, dpi: 72, bg: vals.bg });
        const bgL = doc.layers[0];
        doc.commit('Contact Sheet', () => {
          imgs.forEach((it, i) => {
            const c = i % cols, r = Math.floor(i / cols), x0 = gap + c * (th + gap), y0 = gap + r * (th + lab + gap);
            const k = Math.min(th / it.img.width, th / it.img.height), w = Math.round(it.img.width * k), h = Math.round(it.img.height * k);
            const cv = U.createCanvas(w, h, x0 + Math.round((th - w) / 2), y0 + Math.round((th - h) / 2)); cv.getContext('2d').drawImage(it.img, 0, 0, w, h);
            const l = S.Layers.raster(doc, it.name.replace(/\.[^.]+$/, ''), cv); doc.insertLayer(l, doc.layers[doc.layers.length - 1].id, 'above');
            if (lab) { const t = S.Layers.text(doc, { text: it.name.replace(/\.[^.]+$/, ''), size: 13, color: vals.fg, x: x0, y: y0 + th + 15, box: { w: th, h: lab }, align: 'center' }); doc.insertLayer(t, doc.layers[doc.layers.length - 1].id, 'above'); }
          });
        });
        void bgL;
        S.toast('Contact sheet: ' + imgs.length + ' images, ' + cols + ' × ' + rows);
      } catch (e) { console.error(e); S.toast('Contact sheet failed: ' + (e && e.message || e)); } finally { prog.done(); }
    } }] });
  };
  function pickImages() {
    return new Promise((res) => { const inp = U.el('input', { type: 'file', multiple: true, accept: 'image/*' }); inp.style.display = 'none'; inp.addEventListener('change', () => { res([...inp.files]); inp.remove(); }); document.body.appendChild(inp); inp.click(); });
  }
  function loadFile(file) { return new Promise((res, rej) => { const url = URL.createObjectURL(file), img = new Image(); img.onload = () => { URL.revokeObjectURL(url); res(img); }; img.onerror = rej; img.src = url; }); }

  /* ---------- Data-Driven Export ---------- */
  function parseCSV(text) {
    const rows = [], sep = text.indexOf('\t') >= 0 && text.indexOf(',') < 0 ? '\t' : (text.split('\n')[0].split(';').length > text.split('\n')[0].split(',').length ? ';' : ',');
    let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === sep) { row.push(cur); cur = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; } else cur += ch;
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  }
  S.App.dataDrivenDialog = async function (doc) {
    const textLayers = []; doc.walk((l) => { if (l.type === 'text') textLayers.push(l); });
    if (!textLayers.length) { S.toast('Add text layers first — each CSV column fills the text layer with the same name'); return; }
    const files = await new Promise((res) => { const inp = U.el('input', { type: 'file', accept: '.csv,.tsv,text/csv,text/plain' }); inp.style.display = 'none'; inp.addEventListener('change', () => { res([...inp.files]); inp.remove(); }); document.body.appendChild(inp); inp.click(); });
    if (!files || !files.length) return;
    const rows = parseCSV(await files[0].text()); if (rows.length < 2) { S.toast('The CSV needs a header row and at least one data row'); return; }
    const header = rows[0].map((h) => h.trim()), data = rows.slice(1);
    const mapped = header.filter((h) => textLayers.some((l) => l.name === h));
    const nameCol = header.indexOf('filename') >= 0 ? header.indexOf('filename') : header.indexOf('name') >= 0 ? header.indexOf('name') : -1;
    const last = S.store.get('dataExport', { format: 'png', scale: 100 });
    const defs = [
      { id: 'format', label: 'Format', type: 'select', default: last.format, options: [{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPEG' }, { value: 'webp', label: 'WebP' }] },
      { id: 'scale', label: 'Scale', type: 'range', default: last.scale, min: 10, max: 200, step: 5, unit: '%' },
    ];
    let vals = {}; defs.forEach((d) => (vals[d.id] = d.default));
    const ui = S.ParamUI.build(defs, vals, (v) => { vals = v; });
    const info = U.el('div', { class: 'muted', style: { fontSize: '11px', marginTop: '6px', lineHeight: '1.5' } },
      data.length + ' rows · columns matched to text layers: ' + (mapped.length ? mapped.join(', ') : 'none!') + (header.filter((h) => !mapped.includes(h) && h !== 'filename' && h !== 'name').length ? ' · ignored: ' + header.filter((h) => !mapped.includes(h) && h !== 'filename' && h !== 'name').join(', ') : '') + (nameCol >= 0 ? ' · file names from “' + header[nameCol] + '”' : ' · files numbered 001, 002…'));
    S.Dialog.open({ title: 'Data-Driven Export', body: U.el('div', {}, [ui, info]), width: 440, buttons: [{ label: 'Cancel' }, { label: 'Export ' + data.length + ' files', primary: true, run: async () => {
      if (!mapped.length) { S.toast('No column matches a text layer name'); return; }
      S.store.set('dataExport', vals);
      const before = doc.captureState(), items = [];
      const prog = S.Progress.start('Data-driven export', { cancellable: true });
      let dir = null;
      if (window.showDirectoryPicker) { try { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch (e) { if (e.name === 'AbortError') { prog.done(); return; } } }
      try {
        for (let r = 0; r < data.length; r++) {
          if (prog.cancelled) break;
          header.forEach((h, ci) => { const l = textLayers.find((x) => x.name === h); if (l) { l.text.text = data[r][ci] || ''; l.version++; l._rv = -1; } });
          doc.invalidate(); S.Compositor.update(doc);
          const c = S.FileIO.renderExport(doc, vals.scale / 100, vals.format === 'jpeg' ? '#ffffff' : null);
          const ext = vals.format === 'jpeg' ? 'jpg' : vals.format, base = (nameCol >= 0 && data[r][nameCol] ? data[r][nameCol] : String(r + 1).padStart(3, '0')).replace(/[\\/:*?"<>|]/g, '_');
          const blob = await U.canvasToBlob(c, 'image/' + vals.format, 0.92), fname = base + '.' + ext;
          if (dir) { const fh = await dir.getFileHandle(fname, { create: true }); const w = await fh.createWritable(); await w.write(blob); await w.close(); }
          else { U.downloadBlob(blob, fname); await new Promise((res) => setTimeout(res, 250)); }
          items.push(fname); prog.set((r + 1) / data.length, fname);
        }
      } finally { doc.restoreState(before); doc.invalidate(); S.bus.emit('layers:changed', doc); prog.done(); }
      S.toast('Exported ' + items.length + ' file' + (items.length === 1 ? '' : 's'));
    } }] });
  };
  S.App.renderDataRow = function (doc, header, row) { // used by tests / actions: fill the text layers from one row without exporting
    doc.walk((l) => { if (l.type === 'text') { const ci = header.indexOf(l.name); if (ci >= 0) { l.text.text = row[ci] || ''; l.version++; l._rv = -1; } } });
    doc.invalidate();
  };
  S.App.parseCSV = parseCSV;

  S.Cmd.register('file.contactSheet', { label: 'Contact Sheet…', run: () => S.App.contactSheetDialog() });
  S.Cmd.register('file.dataDriven', { label: 'Data-Driven Export (CSV → images)…', run: () => S.App.dataDrivenDialog(S.app.doc), enabled: () => !!S.app.doc });
})();
