/* =========================================================================
   Gesso — History, Color, Swatches, Brushes, Navigator, Histogram, Info,
   Character, Paths and Channels panels.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util, P = S.Panels;

  /* ---------------- History ---------------- */
  P.register({
    id: 'history', title: 'History', icon: 'history', events: ['history:changed', 'doc:switched'],
    build(body) {
      const list = U.el('div', { class: 'hist-list' });
      const foot = U.el('div', { class: 'panel-foot' });
      const undo = U.el('button', { class: 'icon-btn', html: S.icon('undo'), 'data-tip': 'Undo', 'data-tip-pos': 'top' });
      const redo = U.el('button', { class: 'icon-btn', html: S.icon('redo'), 'data-tip': 'Redo', 'data-tip-pos': 'top' });
      undo.onclick = () => S.Cmd.run('edit.undo'); redo.onclick = () => S.Cmd.run('edit.redo');
      const info = U.el('span', { class: 'muted' });
      const snapBtn = U.el('button', { class: 'icon-btn', html: S.icon('image'), 'data-tip': 'New snapshot', 'data-tip-pos': 'top' });
      snapBtn.onclick = () => { if (S.app.doc) { S.app.doc.makeSnapshot(); S.toast('Snapshot saved'); } };
      foot.append(undo, redo, snapBtn, U.el('div', { style: { flex: 1 } }), info);
      const snaps = U.el('div', { class: 'snap-list' });
      body.append(snaps, list, foot);
      body.classList.add('flex-panel');
      return {
        update() {
          const d = S.app.doc; list.innerHTML = ''; snaps.innerHTML = '';
          if (!d) return;
          for (const sn of d.snapshots) {
            const del = U.el('button', { class: 'icon-btn', html: S.icon('close'), title: 'Delete snapshot' });
            del.onclick = (e) => { e.stopPropagation(); d.snapshots = d.snapshots.filter((x) => x !== sn); S.bus.emit('history:changed', d); };
            const r = U.el('div', { class: 'hist-row snap', title: 'Click to restore this snapshot' }, [U.el('span', { class: 'hist-ico', html: S.icon('image') }), U.el('span', { style: { flex: 1 } }, sn.name), del]);
            r.onclick = () => d.restoreSnapshot(sn.id);
            snaps.appendChild(r);
          }
          d.history.entries.forEach((e, i) => {
            const r = U.el('div', { class: 'hist-row' + (i === d.history.index ? ' current' : '') + (i > d.history.index ? ' future' : '') }, [U.el('span', { class: 'hist-ico', html: S.icon(i === 0 ? 'image' : e.type === 'pixels' ? 'brush' : 'layers') }), U.el('span', {}, e.name)]);
            r.addEventListener('click', () => d.history.jumpTo(i));
            list.appendChild(r);
          });
          const mb = d.history.entries.reduce((a, e) => a + (e.bytes || 0), 0) / 1048576;
          info.textContent = d.history.entries.length - 1 + ' steps · ' + mb.toFixed(1) + ' MB';
          const cur = list.querySelector('.current'); if (cur && cur.scrollIntoViewIfNeeded) cur.scrollIntoViewIfNeeded(false);
        },
      };
    },
  });

  /* ---------------- Color ---------------- */
  P.register({
    id: 'color', title: 'Color', icon: 'palette', events: ['color:changed'],
    build(body) {
      let editing = 'fg';
      const fgS = U.el('button', { class: 'cpanel-sw fg', title: 'Foreground' }), bgS = U.el('button', { class: 'cpanel-sw bg', title: 'Background' });
      const w = S.ColorPicker.widget(S.app.fg, (c) => { if (editing === 'fg') S.App.setFg(c, false, true); else S.App.setBg(c, true); }, true);
      fgS.onclick = () => { editing = 'fg'; sync(); }; bgS.onclick = () => { editing = 'bg'; sync(); };
      const sws = U.el('div', { class: 'cpanel-sws' }, [bgS, fgS]);
      body.append(U.el('div', { class: 'cpanel' }, [sws, w.el]));
      function sync() {
        fgS.style.background = S.app.fg; bgS.style.background = S.app.bg;
        fgS.classList.toggle('editing', editing === 'fg'); bgS.classList.toggle('editing', editing === 'bg');
        w.set(editing === 'fg' ? S.app.fg : S.app.bg);
      }
      sync();
      return { update: sync };
    },
  });

  /* ---------------- Swatches ---------------- */
  const DEFAULT_SWATCHES = ['#000000', '#3a3a3a', '#7a7a7a', '#b5b5b5', '#e6e6e6', '#ffffff', '#5c1a1b', '#a8262b', '#e5534b', '#f28b82', '#7a3a10', '#c2611f', '#f0913a', '#ffbf80',
    '#6b5310', '#c9a227', '#e2b93d', '#fff0a8', '#1f4a24', '#3d8b45', '#67c26f', '#b9e8bb', '#0f4a44', '#1f8f82', '#3dbfae', '#a8ebe2', '#14325c', '#2b63b8', '#5b9bf0', '#b3d1ff',
    '#3a1f5c', '#6c3fb0', '#a678f0', '#dcc6ff', '#5c1a45', '#b03a8a', '#ec7cc4', '#ffc4ea', '#3b2a20', '#6e4b35', '#a87a58', '#e3c4a6'];
  P.register({
    id: 'swatches', title: 'Swatches', icon: 'palette', events: ['recentColors:changed'],
    build(body) {
      const recent = U.el('div', { class: 'swatch-grid swatch-recent' });
      const grid = U.el('div', { class: 'swatch-grid' });
      const foot = U.el('div', { class: 'panel-foot' });
      const add = U.el('button', { class: 'icon-btn', html: S.icon('plus'), 'data-tip': 'Add foreground color', 'data-tip-pos': 'top' });
      const reset = U.el('button', { class: 'btn ghost btn-sm' }, 'Reset');
      foot.append(add, U.el('span', { class: 'muted', style: { flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, 'Click: FG · Ctrl+click: BG'), reset);
      body.append(U.el('div', { class: 'muted panel-hint swatch-recent-label' }, 'Recent'), recent, grid, foot);
      body.classList.add('flex-panel');
      const get = () => S.store.get('swatches', DEFAULT_SWATCHES);
      function render() {
        recent.innerHTML = '';
        const rc = (S.App.recentColors && S.App.recentColors()) || [];
        if (!rc.length) recent.appendChild(U.el('span', { class: 'muted', style: { fontSize: '11px' } }, 'Colours you pick show up here'));
        for (const c of rc) { const s = U.el('button', { class: 'swatch', style: { background: c }, title: c }); s.addEventListener('click', (e) => (e.ctrlKey || e.metaKey ? S.App.setBg(c) : S.App.setFg(c))); recent.appendChild(s); }
        grid.innerHTML = '';
        get().forEach((c, i) => {
          const s = U.el('button', { class: 'swatch', style: { background: c }, title: c });
          s.addEventListener('click', (e) => (e.ctrlKey || e.metaKey ? S.App.setBg(c) : S.App.setFg(c)));
          s.addEventListener('contextmenu', (e) => S.Menu.context([{ label: 'Set foreground', run: () => S.App.setFg(c) }, { label: 'Set background', run: () => S.App.setBg(c) }, '-', { label: 'Delete swatch', run: () => { const a = get(); a.splice(i, 1); S.store.set('swatches', a); render(); } }], e));
          grid.appendChild(s);
        });
      }
      add.onclick = () => { const a = get(); if (!a.includes(S.app.fg)) a.push(S.app.fg); S.store.set('swatches', a); render(); };
      reset.onclick = () => { S.store.del('swatches'); render(); };
      render();
      return { update: render };
    },
  });

  /* ---------------- Brushes ---------------- */
  function brushPreview(p, w, h) {
    const c = U.createCanvas(w * 2, h * 2), x = c.getContext('2d');
    const size = Math.min(26, h * 1.4), steps = 60;
    const r = S.Brush.rng(p.name.length * 31);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, px = 12 + t * (w * 2 - 24), py = h + Math.sin(t * Math.PI * 2) * h * 0.45;
      const sp = Math.max(1, (p.spacing || 10) / 10);
      if (i % Math.ceil(sp) !== 0) continue;
      let s = size * (0.35 + 0.65 * Math.sin(t * Math.PI));
      if (p.sizeJitter) s *= 1 - (r() * p.sizeJitter) / 100;
      let dx = 0, dy = 0; if (p.scatter) { dx = (r() - 0.5) * s * p.scatter / 60; dy = (r() - 0.5) * s * p.scatter / 60; }
      const tip = S.Brush.tip(p.tip, s, p.hardness ?? 1, '#e9dfd3');
      x.globalAlpha = (p.flow || 100) / 100 * (p.opacityJitter ? 1 - r() * p.opacityJitter / 100 : 1);
      x.save(); x.translate(px + dx, py + dy); if (p.angleJitter) x.rotate((r() - 0.5) * p.angleJitter * Math.PI / 180);
      x.drawImage(tip, -tip.width / 2, -tip.height / 2); x.restore();
    }
    c.style.width = w + 'px'; c.style.height = h + 'px';
    return c;
  }
  const PAINT_TOOLS = ['brush', 'pencil', 'eraser', 'clone', 'heal', 'spotHeal'];
  S.App = S.App || {};
  P.register({
    id: 'brushes', title: 'Brushes', icon: 'brushes', events: ['tool:changed', 'tool:options'],
    build(body) {
      const list = U.el('div', { class: 'brush-list' });
      const settings = U.el('div', { class: 'brush-settings' });
      body.append(list, settings);
      const tool = () => (PAINT_TOOLS.includes(S.app.tool && S.app.tool.id) ? S.app.tool : S.Tools.byId.brush);
      function renderList() {
        list.innerHTML = '';
        const t = tool();
        for (const p of S.Brush.PRESETS) {
          const r = U.el('div', { class: 'brush-row' + (t.opts.preset === p.name ? ' active' : '') }, [brushPreview(p, 120, 22), U.el('span', {}, p.name)]);
          r.addEventListener('click', () => { S.Brush.applyPreset(t.opts, p); S.Tools.saveOpts(); S.Tools.syncOptions(); S.bus.emit('tool:options', t); if (!PAINT_TOOLS.includes(S.app.tool && S.app.tool.id)) S.Tools.select('brush'); });
          list.appendChild(r);
        }
      }
      function renderSettings() {
        settings.innerHTML = '';
        const t = tool(), o = t.opts;
        settings.appendChild(U.el('div', { class: 'prop-head' }, [U.el('span', {}, 'Tip settings — ' + t.name)]));
        const defs = [
          { id: 'size', label: 'Size', type: 'range', default: o.size, min: 1, max: 1000, unit: 'px' },
          { id: 'hardness', label: 'Hardness', type: 'range', default: Math.round((o.hardness ?? 1) * 100), min: 0, max: 100, unit: '%' },
          { id: 'spacing', label: 'Spacing', type: 'range', default: o.spacing ?? 10, min: 1, max: 300, unit: '%' },
          { id: 'scatter', label: 'Scatter', type: 'range', default: o.scatter || 0, min: 0, max: 300, unit: '%' },
          { id: 'sizeJitter', label: 'Size jitter', type: 'range', default: o.sizeJitter || 0, min: 0, max: 100, unit: '%' },
          { id: 'angleJitter', label: 'Angle jitter', type: 'range', default: o.angleJitter || 0, min: 0, max: 360 },
          { id: 'opacityJitter', label: 'Opacity jitter', type: 'range', default: o.opacityJitter || 0, min: 0, max: 100, unit: '%' },
          { id: 'count', label: 'Count', type: 'range', default: o.count || 1, min: 1, max: 10 },
          { id: 'followAngle', label: 'Follow stroke direction', type: 'checkbox', default: !!o.followAngle },
        ];
        settings.appendChild(S.ParamUI.build(defs, {}, (v, id) => { o[id] = id === 'hardness' ? v[id] / 100 : v[id]; S.Tools.saveOpts(); S.Tools.syncOptions(); S.View.redraw(); }));
      }
      return { update() { renderList(); renderSettings(); } };
    },
  });
  /** Popup brush picker used by the options bar */
  S.App.showBrushPicker = function (tool, anchor) {
    const r = anchor.getBoundingClientRect();
    S.Menu.show(S.Brush.PRESETS.map((p) => ({ label: p.name, checked: tool.opts.preset === p.name, run: () => { S.Brush.applyPreset(tool.opts, p); S.Tools.saveOpts(); S.Tools.renderOptions(); S.bus.emit('tool:options', tool); } })), r.left, r.bottom + 4);
  };

  /* ---------------- Navigator ---------------- */
  P.register({
    id: 'navigator', title: 'Navigator', icon: 'navigator', events: ['composite:updated', 'view:changed', 'doc:switched'],
    build(body) {
      const cv = U.el('canvas', { class: 'nav-canvas' });
      const zoomRow = U.el('div', { class: 'row nav-zoom' });
      const pct = U.el('input', { type: 'number', min: 1, max: 6400, class: 'nav-pct' });
      const sl = U.el('input', { type: 'range', min: 0, max: 1000, value: 500 });
      const zo = U.el('button', { class: 'icon-btn', html: S.icon('minus') }), zi = U.el('button', { class: 'icon-btn', html: S.icon('plus') });
      zoomRow.append(pct, zo, sl, zi);
      body.append(U.el('div', { class: 'nav-wrap' }, [cv]), zoomRow);
      body.classList.add('flex-panel');
      pct.addEventListener('keydown', (e) => e.stopPropagation());
      const toSl = (z) => Math.round(((Math.log(z) - Math.log(0.01)) / (Math.log(64) - Math.log(0.01))) * 1000);
      const fromSl = (v) => Math.exp(Math.log(0.01) + (v / 1000) * (Math.log(64) - Math.log(0.01)));
      sl.addEventListener('input', () => S.View.setZoom(fromSl(+sl.value)));
      pct.addEventListener('change', () => S.View.setZoom(+pct.value / 100));
      zo.onclick = () => S.View.zoomStep(-1); zi.onclick = () => S.View.zoomStep(1);
      let geo = null;
      const draw = () => {
        const d = S.app.doc, x = cv.getContext('2d');
        const wrap = cv.parentElement; const W = wrap.clientWidth || 200, H = Math.max(60, wrap.clientHeight || 120);
        const dpr = devicePixelRatio || 1;
        cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
        x.setTransform(dpr, 0, 0, dpr, 0, 0);
        x.clearRect(0, 0, W, H);
        if (!d || !d.composite) { geo = null; return; }
        const k = Math.min((W - 8) / d.width, (H - 8) / d.height);
        const w = d.width * k, h = d.height * k, ox = (W - w) / 2, oy = (H - h) / 2;
        geo = { k, ox, oy };
        x.fillStyle = '#ddd'; x.fillRect(ox, oy, w, h);
        x.imageSmoothingQuality = 'high';
        x.drawImage(d.composite, ox, oy, w, h);
        const v = S.View.visibleDocRect(d);
        x.strokeStyle = '#f0913a'; x.lineWidth = 1.5;
        x.strokeRect(ox + v.x * k, oy + v.y * k, v.w * k, v.h * k);
        if (document.activeElement !== pct) pct.value = Math.round(d.view.zoom * 100);
        sl.value = toSl(d.view.zoom);
      };
      const panTo = (e) => {
        const d = S.app.doc; if (!d || !geo) return;
        const r = cv.getBoundingClientRect();
        const dx = (e.clientX - r.left - geo.ox) / geo.k, dy = (e.clientY - r.top - geo.oy) / geo.k;
        d.view.panX = S.View.w / 2 - dx * d.view.zoom; d.view.panY = S.View.h / 2 - dy * d.view.zoom;
        S.View.viewChanged();
      };
      cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); panTo(e); cv.onpointermove = panTo; cv.onpointerup = () => (cv.onpointermove = null); });
      const throttled = U.debounce(draw, 60);
      new ResizeObserver(() => throttled()).observe(body);
      return { update: throttled };
    },
  });

  /* ---------------- Histogram ---------------- */
  /**
   * Histogram of the flattened document, or of the selected pixels when a selection exists (each pixel
   * weighted by its selection value).  Large documents are point-sampled (at most ~1 M pixels); the
   * recompute is debounced and waits for a brush stroke to end.
   * S.App.histogramOfDoc(doc) → { r, g, b, l: Float64Array(256) weighted counts, total (sum of weights),
   *   factor (real pixels per sample), pixels (≈ total × factor), stride, selection }
   */
  const HIST_MAX_SAMPLES = 1e6;
  let histReadCanvas = null;
  S.App = S.App || {};
  S.App.histogramOfDoc = function (d) {
    if (!d) return null;
    if (!d.composite || d._dirty) S.Compositor.update(d);
    if (!d.composite) return null;
    // the composite may show a mask or a single channel (View ▸ Channels); the histogram is always of the real image
    const special = d.maskView || (d.channelView && d.channelView !== 'rgb');
    const src = special ? S.Compositor.flatten(d) : d.composite;
    const sel = d.selection, W = d.width, H = d.height;
    const R = sel ? sel.bounds : { x: 0, y: 0, w: W, h: H };
    const s = Math.max(1, Math.ceil(Math.sqrt((R.w * R.h) / HIST_MAX_SAMPLES)));
    const DW = Math.max(1, Math.ceil(R.w / s)), DH = Math.max(1, Math.ceil(R.h / s));
    if (!histReadCanvas) { histReadCanvas = document.createElement('canvas'); histReadCanvas._ctx = histReadCanvas.getContext('2d', { willReadFrequently: true }); }
    const rc = histReadCanvas, x = rc._ctx;
    if (rc.width !== DW || rc.height !== DH) { rc.width = DW; rc.height = DH; }
    x.imageSmoothingEnabled = false; // point sampling: one real pixel per sample, no averaging
    x.clearRect(0, 0, DW, DH);
    x.drawImage(src, R.x, R.y, DW * s, DH * s, 0, 0, DW, DH);
    const px = x.getImageData(0, 0, DW, DH).data;
    const r = new Float64Array(256), g = new Float64Array(256), b = new Float64Array(256), l = new Float64Array(256);
    const mask = sel ? sel.mask : null;
    let total = 0;
    for (let j = 0; j < DH; j++) {
      const my = R.y + Math.min(R.h - 1, Math.floor((j + 0.5) * s));
      for (let i = 0; i < DW; i++) {
        const k = (j * DW + i) * 4;
        if (!px[k + 3]) continue;
        let w = 1;
        if (mask) { const mx = R.x + Math.min(R.w - 1, Math.floor((i + 0.5) * s)); w = mask[my * W + mx] / 255; if (!w) continue; }
        r[px[k]] += w; g[px[k + 1]] += w; b[px[k + 2]] += w;
        l[(0.299 * px[k] + 0.587 * px[k + 1] + 0.114 * px[k + 2] + 0.5) | 0] += w;
        total += w;
      }
    }
    // factor: real pixels per sample; pixels: estimated number of (weighted) pixels in the region
    const factor = (R.w * R.h) / (DW * DH);
    return { r, g, b, l, total, factor, pixels: total * factor, stride: s, selection: !!sel };
  };
  P.register({
    id: 'histogram', title: 'Histogram', icon: 'histogram', events: ['composite:updated', 'doc:switched', 'selection:changed'],
    build(body) {
      const CH = { colors: 'RGB', l: 'Luminosity', r: 'Red', g: 'Green', b: 'Blue' };
      const chSel = U.el('select', { title: 'Channel' }, Object.keys(CH).map((v) => U.el('option', { value: v }, CH[v])));
      let ch = S.store.get('histCh', 'colors'); if (ch === 'rgb') ch = 'l'; if (!CH[ch]) ch = 'colors';
      chSel.value = ch;
      const logChk = U.el('input', { type: 'checkbox', checked: !!S.store.get('histLog', false) });
      const logLab = U.el('label', { class: 'check-row hist-log', title: 'Logarithmic vertical scale (shows sparse levels)' }, [logChk, U.el('span', {}, 'Log scale')]);
      const cv = U.el('canvas', { class: 'hist-canvas', title: 'Hover for the level under the cursor' });
      // clipping line (inline text so it wraps on narrow docks): "shadows 0.00 % · highlights 100.00 % ▲"
      const clipLo = U.el('span', { class: 'hist-clip-v mono' }), clipHi = U.el('span', { class: 'hist-clip-v mono' }), clipWarn = U.el('span', { class: 'hist-clip-warn' });
      const clip = U.el('div', { class: 'hist-clip muted', title: 'Clipping: share of pixels at level 0 (shadows) and 255 (highlights) in the shown channel. View ▸ Clipping Warning paints them on the canvas.' },
        ['shadows ', clipLo, ' · highlights ', clipHi, clipWarn]);
      const grid = U.el('div', { class: 'hist-grid' });
      const cell = (label, title) => { const v = U.el('span', { class: 'hist-v mono' }, '—'); grid.append(U.el('span', { class: 'muted', title: title || label }, label), v); return v; };
      const vMean = cell('Mean'), vLevel = cell('Level', 'Level under the cursor'), vStd = cell('Std Dev'), vCount = cell('Count', 'Pixels at the level under the cursor'), vMed = cell('Median'), vPct = cell('Percentile', 'Share of pixels at or below the level under the cursor');
      const vPix = cell('Pixels', 'Pixels counted (the selection when one is active; ≈ when sampled)'); grid.append(U.el('span'), U.el('span'));
      body.append(U.el('div', { class: 'row hist-head' }, [chSel, U.el('span', { style: { flex: 1 } }), logLab]), cv, clip, grid);

      let hist = null, hoverLevel = -1;
      const arr = () => (ch === 'r' || ch === 'g' || ch === 'b' ? hist[ch] : hist.l); // stats channel (RGB overlay → luminosity)
      const fmtN = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + ' M' : Math.round(n).toLocaleString());
      const cssVar = (n, f) => { const v = getComputedStyle(document.documentElement).getPropertyValue(n); return (v && v.trim()) || f; };
      const RGB = { r: '230,70,70', g: '70,200,90', b: '80,130,245' };

      function stats() {
        if (!hist || !hist.total) {
          vMean.textContent = vStd.textContent = vMed.textContent = vPix.textContent = '—';
          clipLo.textContent = clipHi.textContent = '—'; clipWarn.textContent = ''; clip.classList.remove('warn'); clipLo.classList.remove('warn'); clipHi.classList.remove('warn');
          return;
        }
        const a = arr(), n = hist.total;
        let sum = 0, sq = 0; for (let i = 0; i < 256; i++) sum += a[i] * i;
        const mean = sum / n; for (let i = 0; i < 256; i++) sq += a[i] * (i - mean) * (i - mean);
        let med = 0, acc = 0; for (let i = 0; i < 256; i++) { acc += a[i]; if (acc >= n / 2) { med = i; break; } }
        vMean.textContent = mean.toFixed(1); vStd.textContent = Math.sqrt(sq / n).toFixed(1); vMed.textContent = String(med);
        vPix.textContent = (hist.stride > 1 ? '≈ ' : '') + fmtN(hist.pixels);
        // clipping: share of pixels at 0 / 255 of the shown channel (RGB overlay → mean of the three channels)
        const share = (i) => (ch === 'colors' ? (hist.r[i] + hist.g[i] + hist.b[i]) / 3 : a[i]) / n * 100;
        const lo = share(0), hi = share(255);
        clipLo.textContent = lo.toFixed(2) + ' %'; clipHi.textContent = hi.toFixed(2) + ' %';
        clipLo.classList.toggle('warn', lo > 1); clipHi.classList.toggle('warn', hi > 1);
        clipWarn.textContent = lo > 1 || hi > 1 ? ' ▲' : '';
        clip.classList.toggle('warn', lo > 1 || hi > 1);
      }
      function readout() {
        if (!hist || !hist.total || hoverLevel < 0) { vLevel.textContent = vCount.textContent = vPct.textContent = '—'; return; }
        const a = arr(); let acc = 0; for (let i = 0; i <= hoverLevel; i++) acc += a[i];
        vLevel.textContent = String(hoverLevel);
        vCount.textContent = (hist.stride > 1 ? '≈ ' : '') + fmtN(a[hoverLevel] * hist.factor);
        vPct.textContent = ((acc / hist.total) * 100).toFixed(1) + ' %';
      }
      /** vertical scale of one channel: ignore a lone spike (e.g. a flat background) so the rest stays readable */
      const scaleOf = (a, log) => {
        if (log) { let m = 0; for (let i = 0; i < 256; i++) if (a[i] > m) m = a[i]; return Math.log1p(m); }
        const sorted = Array.from(a).sort((p, q) => q - p);
        return sorted[0] > sorted[3] * 4 && sorted[3] > 0 ? sorted[3] * 1.3 : sorted[0];
      };
      function draw() {
        const W = Math.max(60, (body.clientWidth || 220) - 20), H = 120, dpr = devicePixelRatio || 1;
        if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
        const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0);
        x.fillStyle = cssVar('--bg-0', '#141210'); x.fillRect(0, 0, W, H);
        x.strokeStyle = cssVar('--line-soft', '#2a2520'); x.lineWidth = 1;
        for (let i = 1; i < 4; i++) { const px = Math.round((i / 4) * W) + 0.5; x.beginPath(); x.moveTo(px, 0); x.lineTo(px, H); x.stroke(); }
        if (!hist || !hist.total) {
          x.fillStyle = cssVar('--text-2', '#8d8277'); x.font = '11px ' + cssVar('--font', 'sans-serif'); x.textAlign = 'center';
          x.fillText(S.app.doc ? (hist && hist.selection ? 'No pixels in the selection' : 'No pixels') : 'No document', W / 2, H / 2 + 4);
          return;
        }
        const log = logChk.checked, keys = ch === 'colors' ? ['r', 'g', 'b'] : [ch];
        const scale = Math.max(1e-9, Math.max(...keys.map((k) => scaleOf(hist[k], log))));
        const top = 3, hh = H - top;
        // one step per level (so a lone spike at 0 or 255 is still a visible bar)
        const shape = (a, fill) => {
          x.fillStyle = fill; x.beginPath(); x.moveTo(0, H);
          for (let i = 0; i < 256; i++) { const v = log ? Math.log1p(a[i]) : a[i], y = H - Math.min(1, v / scale) * hh; x.lineTo((i / 256) * W, y); x.lineTo(((i + 1) / 256) * W, y); }
          x.lineTo(W, H); x.closePath(); x.fill();
        };
        if (ch === 'colors') { x.globalCompositeOperation = 'lighter'; for (const k of keys) shape(hist[k], 'rgba(' + RGB[k] + ',.78)'); x.globalCompositeOperation = 'source-over'; }
        else shape(hist[ch], ch === 'l' ? cssVar('--text-1', '#c8bdb1') : 'rgb(' + RGB[ch] + ')');
        // source tag: selection and / or sampling ratio (only when it is not the plain, fully counted document)
        const tag = [hist.selection ? 'Selection' : null, hist.stride > 1 ? '1:' + hist.stride * hist.stride + ' sampled' : null].filter(Boolean).join(' · ');
        if (tag) {
          x.font = '10px ' + cssVar('--font', 'sans-serif'); x.textAlign = 'right'; x.textBaseline = 'top';
          const tw = x.measureText(tag).width + 8;
          x.fillStyle = cssVar('--bg-2', '#24201c'); x.globalAlpha = 0.85; x.fillRect(W - tw - 3, 3, tw, 14); x.globalAlpha = 1;
          x.fillStyle = hist.selection ? cssVar('--accent-2', '#3dbfae') : cssVar('--text-2', '#8d8277'); x.fillText(tag, W - 7, 5);
          x.textBaseline = 'alphabetic';
        }
        if (hoverLevel >= 0) {
          const px = Math.round(((hoverLevel + 0.5) / 256) * W) + 0.5;
          x.strokeStyle = cssVar('--accent', '#f0913a'); x.beginPath(); x.moveTo(px, 0); x.lineTo(px, H); x.stroke();
        }
      }
      const recompute = () => { hist = S.App.histogramOfDoc(S.app.doc); stats(); draw(); readout(); };
      let timer = null, waited = 0;
      const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          // a brush / warp / quick-select stroke is in progress: wait for it to end (but never longer than ~6 s)
          if (S.app.tool && S.app.tool.st && waited < 40) { waited++; schedule(); return; }
          waited = 0;
          try { recompute(); } catch (e) { console.warn('[histogram]', e); }
        }, 150);
      };
      cv.addEventListener('pointermove', (e) => { const r = cv.getBoundingClientRect(); hoverLevel = U.clamp(Math.floor(((e.clientX - r.left) / Math.max(1, r.width)) * 256), 0, 255); draw(); readout(); });
      cv.addEventListener('pointerleave', () => { hoverLevel = -1; draw(); readout(); });
      chSel.addEventListener('change', () => { ch = chSel.value; S.store.set('histCh', ch); stats(); draw(); readout(); });
      logChk.addEventListener('change', () => { S.store.set('histLog', logChk.checked); draw(); });
      new ResizeObserver(() => draw()).observe(body);
      return { update: schedule, recompute, get hist() { return hist; } };
    },
  });

  /* ---------------- Performance (memory & compositing) ---------------- */
  S.App = S.App || {};
  /** Estimated pixel memory of a document, by category (bytes) */
  S.App.docMemory = function (d) {
    const sz = (c) => (c ? c.width * c.height * 4 : 0);
    const m = { layers: 0, masks: 0, effects: 0, history: 0, composite: sz(d.composite), caches: 0, count: 0, pixelLayers: 0 };
    const seen = new Set();
    d.walk((l) => {
      m.count++;
      if (l.canvas) { m.layers += sz(l.canvas); seen.add(l.canvas); if (l.type === 'raster') m.pixelLayers++; }
      if (l.mask && l.mask.canvas) { m.masks += sz(l.mask.canvas); seen.add(l.mask.canvas); if (l.mask._proc) m.masks += sz(l.mask._proc); }
      if (l._fxCache) m.effects += sz(l._fxCache.canvas);
    });
    // history: canvases referenced by state entries that the live document no longer uses, plus pixel patches
    const hist = new Set();
    for (const e of d.history.entries) {
      if (e.type === 'pixels') m.history += e.bytes || 0;
      for (const st of [e.before, e.after]) if (st) { const rec = (list) => list.forEach((l) => { if (l.canvas && !seen.has(l.canvas)) hist.add(l.canvas); if (l.mask && l.mask.canvas && !seen.has(l.mask.canvas)) hist.add(l.mask.canvas); if (l.children) rec(l.children); }); rec(st.layers); }
    }
    for (const c of hist) m.history += sz(c);
    if (d._below) m.caches += sz(d._below.canvas); if (d._above) m.caches += sz(d._above.canvas);
    m.total = m.layers + m.masks + m.effects + m.history + m.composite + m.caches;
    return m;
  };
  const MB = (b) => (b / 1048576).toFixed(1) + ' MB';
  P.register({
    id: 'performance', title: 'Performance', icon: 'histogram', defaultHidden: true, events: ['composite:updated', 'doc:switched', 'layers:changed', 'history:changed', 'doc:closed'],
    build(body) {
      const grid = U.el('div', { class: 'info-grid mono' });
      const docs = U.el('div', { class: 'perf-docs' });
      const foot = U.el('div', { class: 'prop-btns' });
      const compact = U.el('button', { class: 'btn btn-sm' }, 'Compact memory');
      compact.title = 'Trim layer canvases and masks to their content, drop effect caches and the undo history pixel copies';
      compact.addEventListener('click', () => {
        const d = S.app.doc; if (!d) return;
        let n = 0;
        d.walk((l) => { if (l.type === 'raster' && S.Layers.trimInPlace(l.canvas)) { l.version++; n++; } if (l.mask && S.Layers.trimMask(l.mask)) { l.mask.version = (l.mask.version || 0) + 1; l.version++; n++; } l._fxCache = null; if (l.mask) l.mask._proc = null; });
        S.Compositor.dropCache(d); U.trimPool(S.app.docs.map((x) => [x.width, x.height]));
        d.invalidate(); S.bus.emit('layers:changed', d); S.toast('Compacted ' + n + ' canvas' + (n === 1 ? '' : 'es'));
      });
      const purge = U.el('button', { class: 'btn btn-sm ghost' }, 'Purge history');
      purge.addEventListener('click', async () => { const d = S.app.doc; if (!d) return; if (!(await S.Dialog.confirm('Discard the undo history of “' + d.name + '” to free memory?', 'Purge'))) return; d.history.entries.length = d.history.index + 1; d.history.entries.splice(1, d.history.entries.length - 2); d.history.index = d.history.entries.length - 1; S.bus.emit('history:changed', d); });
      foot.append(compact, purge);
      body.append(grid, docs, foot);
      let last = 0;
      const update = () => {
        const now = performance.now(); if (now - last < 250) { clearTimeout(update._t); update._t = setTimeout(update, 260); return; } last = now;
        grid.innerHTML = ''; docs.innerHTML = '';
        const d = S.app.doc;
        const add = (k, v) => grid.append(U.el('span', { class: 'muted' }, k), U.el('span', {}, v));
        if (!d) { add('Document', '—'); return; }
        const m = S.App.docMemory(d), st = S.Compositor.stats;
        add('Document', d.width + ' × ' + d.height + ' · ' + m.count + ' layers (' + m.pixelLayers + ' pixel)');
        add('Pixel memory', MB(m.total));
        add('  layers', MB(m.layers)); add('  masks', MB(m.masks)); add('  effect caches', MB(m.effects)); add('  undo history', MB(m.history)); add('  composite', MB(m.composite)); add('  paint caches', MB(m.caches));
        add('Scratch pool', MB(U.poolBytes()));
        add('Last composite', (d._compositeMs != null ? d._compositeMs.toFixed(1) : '—') + ' ms' + (st.cached ? ' (cached)' : '') + (st.lastRect ? ' · ' + st.lastRect.w + '×' + st.lastRect.h : ''));
        add('Full document', 'would be ' + MB(d.width * d.height * 4) + ' per layer');
        if (performance.memory) add('JS heap', MB(performance.memory.usedJSHeapSize));
        let all = 0; for (const x of S.app.docs) all += S.App.docMemory(x).total;
        if (S.app.docs.length > 1) docs.appendChild(U.el('div', { class: 'muted panel-hint' }, S.app.docs.length + ' open documents · ' + MB(all) + ' in total'));
        const sm = document.getElementById('st-mem'); if (sm) { sm.textContent = MB(m.total); sm.title = 'Pixel memory of this document (layers ' + MB(m.layers) + ', masks ' + MB(m.masks) + ', effects ' + MB(m.effects) + ', history ' + MB(m.history) + ') · last composite ' + (d._compositeMs || 0).toFixed(1) + ' ms'; }
      };
      return { update };
    },
  });
  // status bar readout (hover for the breakdown), refreshed lazily
  S.bus.on('doc:switched', () => { const sm = document.getElementById('st-mem'); if (sm && !S.app.doc) sm.textContent = ''; });
  let memTick = 0;
  S.bus.on('composite:updated', () => { const now = performance.now(); if (now - memTick < 1500) return; memTick = now; const d = S.app.doc, sm = document.getElementById('st-mem'); if (!d || !sm || P.isShown('performance')) return; const m = S.App.docMemory(d); sm.textContent = MB(m.total); sm.title = 'Pixel memory of this document (layers ' + MB(m.layers) + ', masks ' + MB(m.masks) + ', effects ' + MB(m.effects) + ', history ' + MB(m.history) + ') · last composite ' + (d._compositeMs || 0).toFixed(1) + ' ms · Window ▸ Panels ▸ Performance for details'; });

  /* ---------------- Info ---------------- */
  P.register({
    id: 'info', title: 'Info', icon: 'info', events: ['cursor:moved', 'selection:changed', 'doc:switched'],
    build(body) {
      const g = U.el('div', { class: 'info-grid mono' });
      body.appendChild(g);
      const sw = U.el('span', { class: 'info-sw' });
      let last = 0;
      return {
        update() {
          const now = performance.now(); if (now - last < 50) return; last = now;
          const d = S.app.doc; g.innerHTML = '';
          if (!d) return;
          const m = S.View.mouse, x = Math.floor(m.x), y = Math.floor(m.y);
          let rgba = null;
          if (d.composite && x >= 0 && y >= 0 && x < d.width && y < d.height) rgba = U.samplePixels(d.composite, x, y);
          const add = (k, v) => g.append(U.el('span', { class: 'muted' }, k), U.el('span', {}, v));
          add('X / Y', x + ', ' + y + ' px');
          if (rgba) {
            const hsv = U.rgbToHsv(rgba[0], rgba[1], rgba[2]);
            sw.style.background = 'rgba(' + rgba[0] + ',' + rgba[1] + ',' + rgba[2] + ',' + rgba[3] / 255 + ')';
            g.append(U.el('span', { class: 'muted' }, 'Color'), U.el('span', {}, [sw, ' ' + U.rgbToHex(rgba[0], rgba[1], rgba[2])]));
            add('R G B', rgba[0] + '  ' + rgba[1] + '  ' + rgba[2]);
            add('Alpha', Math.round((rgba[3] / 255) * 100) + '%');
            add('H S B', Math.round(hsv.h) + '°  ' + Math.round(hsv.s * 100) + '%  ' + Math.round(hsv.v * 100) + '%');
          } else add('Color', '—');
          add('Document', d.width + ' × ' + d.height);
          if (d.selection) add('Selection', d.selection.bounds.w + ' × ' + d.selection.bounds.h + ' @ ' + d.selection.bounds.x + ',' + d.selection.bounds.y);
          const l = d.activeLayer(); if (l) add('Layer', l.name + (l.editMask ? ' (mask)' : ''));
        },
      };
    },
  });

  /* ---------------- Character ---------------- */
  P.register({
    id: 'character', title: 'Character', icon: 'character', events: ['activeLayer:changed', 'tool:changed', 'doc:switched', 'text:changed', 'color:changed'],
    build(body) {
      return {
        update() {
          body.innerHTML = '';
          const tt = S.TextTool, tg = tt.target();
          const d = S.app.doc, l = d && d.activeLayer();
          body.appendChild(U.el('div', { class: 'muted panel-hint' }, tt.edit ? 'Editing text' : l && l.type === 'text' ? 'Text layer: ' + l.name : 'Defaults for new text'));
          const fonts = S.Text.FONTS.concat(S.Text.extraFonts || []); if (!fonts.includes(tg.font)) fonts.unshift(tg.font);
          const defs = [
            { id: 'font', label: 'Font', type: 'select', default: tg.font, options: fonts },
            { id: 'weight', label: 'Weight', type: 'select', default: tg.weight, options: [100, 300, 400, 500, 600, 700, 900].map((w) => ({ value: w, label: String(w) })) },
            { id: 'size', label: 'Size', type: 'range', default: tg.size, min: 1, max: 600, unit: 'px' },
            { id: 'leading', label: 'Leading', type: 'range', default: tg.leading || 0, min: 0, max: 800, unit: 'px' },
            { id: 'tracking', label: 'Tracking', type: 'range', default: tg.tracking || 0, min: -200, max: 1000 },
            { id: 'color', label: 'Color', type: 'color', default: tg === tt.opts ? S.app.fg : tg.color || S.app.fg },
            { id: 'align', label: 'Paragraph', type: 'select', default: tg.align, options: [{ value: 'left', label: 'Align left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Align right' }, { value: 'justify', label: 'Justify (paragraph text)' }] },
            { id: 'italic', label: 'Faux italic', type: 'checkbox', default: !!tg.italic },
            { id: 'underline', label: 'Underline', type: 'checkbox', default: !!tg.underline },
            { id: 'strike', label: 'Strikethrough', type: 'checkbox', default: !!tg.strike },
            { id: 'allCaps', label: 'All caps', type: 'checkbox', default: !!tg.allCaps },
            { id: 'smallCaps', label: 'Small caps', type: 'checkbox', default: !!tg.smallCaps },
          ];
          body.appendChild(S.ParamUI.build(defs, {}, (v, id, final) => { if (final || id === 'size' || id === 'leading' || id === 'tracking' || id === 'color') tt.applyProp(id, v[id], final); if (S.app.tool === tt) S.Tools.syncOptions(); }));
          if (l && l.type === 'text') {
            const cv = l.text.curve;
            const b = U.el('button', { class: 'btn btn-sm char-curve-btn' }, cv ? 'Text on ' + cv.type + ' — edit…' : 'Text on circle / path…');
            b.addEventListener('click', () => { S.Panels.show('properties'); setTimeout(() => { const e = document.querySelector('.panel-properties .curve-ui'); if (e) e.scrollIntoView({ block: 'center' }); }, 60); });
            body.appendChild(U.el('div', { class: 'prop-btns' }, [b]));
          }
        },
      };
    },
  });

  /* ---------------- Paths ---------------- */
  P.register({
    id: 'paths', title: 'Paths', icon: 'paths', events: ['paths:changed', 'doc:switched', 'history:changed'],
    build(body) {
      const list = U.el('div', { class: 'paths-list' });
      const foot = U.el('div', { class: 'panel-foot' });
      const b = (icon, tip, cmd) => { const x = U.el('button', { class: 'icon-btn', html: S.icon(icon), 'data-tip': tip, 'data-tip-pos': 'top' }); x.onclick = () => S.Cmd.run(cmd); foot.appendChild(x); };
      b('fill', 'Fill path with foreground', 'path.fill'); b('brush', 'Stroke path with brush', 'path.stroke'); b('marqueeRect', 'Load path as selection', 'path.toSelection');
      b('polyLasso', 'Make work path from selection', 'select.toPath'); b('polygon', 'Make shape layer', 'path.toShape');
      foot.appendChild(U.el('div', { style: { flex: 1 } })); b('plus', 'New path', 'path.new'); b('trash', 'Delete path', 'path.delete');
      body.append(list, foot); body.classList.add('flex-panel');
      return {
        update() {
          const d = S.app.doc; list.innerHTML = '';
          if (!d) return;
          if (!d.paths.length) list.appendChild(U.el('div', { class: 'empty-note' }, 'No paths. Use the Pen tool (P) or Select ▸ Make Work Path.'));
          for (const p of d.paths) {
            const c = U.createCanvas(60, 40), x = c.getContext('2d');
            x.fillStyle = '#f0f0f0'; x.fillRect(0, 0, 60, 40);
            const k = Math.min(56 / d.width, 36 / d.height);
            x.save(); x.translate((60 - d.width * k) / 2, (40 - d.height * k) / 2); x.scale(k, k); x.fillStyle = '#555'; x.fill(S.Paths.toPath2D(p.path)); x.restore();
            c.style.width = '30px'; c.style.height = '20px';
            const r = U.el('div', { class: 'path-row' + (p.id === d.activePathId ? ' active' : '') }, [c, U.el('span', { style: { fontStyle: p.name === 'Work Path' ? 'italic' : '' } }, p.name)]);
            r.onclick = () => { d.activePathId = d.activePathId === p.id ? null : p.id; S.bus.emit('paths:changed', d); S.View.redraw(); };
            r.ondblclick = async () => { const n = await S.Dialog.prompt('Path name', p.name, 'Rename Path'); if (n) d.commit('Rename Path', () => { d.paths.find((q) => q.id === p.id).name = n; }); };
            list.appendChild(r);
          }
        },
      };
    },
  });

  /* ---------------- Channels ---------------- */
  P.register({
    id: 'channels', title: 'Channels', icon: 'channels', events: ['channels:changed', 'doc:switched', 'composite:updated', 'activeLayer:changed'],
    build(body) {
      const list = U.el('div', { class: 'chan-list' });
      body.appendChild(list);
      const upd = () => {
        const d = S.app.doc; list.innerHTML = '';
        if (!d) return;
        const rows = [['rgb', 'RGB', 'Ctrl+2'], ['r', 'Red', ''], ['g', 'Green', ''], ['b', 'Blue', ''], ['a', 'Alpha (transparency)', '']];
        for (const [id, name] of rows) {
          const r = U.el('div', { class: 'chan-row' + ((d.channelView || 'rgb') === id && !d.maskView ? ' active' : '') }, [U.el('span', { class: 'chan-dot ' + id }), U.el('span', {}, name)]);
          r.onclick = () => { d.maskView = null; S.Cmd.run('view.channel', id); upd(); };
          list.appendChild(r);
        }
        const l = d.activeLayer();
        if (l && l.mask) {
          const r = U.el('div', { class: 'chan-row' + (d.maskView === l.id ? ' active' : '') }, [U.el('span', { class: 'chan-dot mask' }), U.el('span', { style: { fontStyle: 'italic' } }, l.name + ' Mask')]);
          r.onclick = () => { d.maskView = d.maskView === l.id ? null : l.id; d.invalidate(); upd(); };
          list.appendChild(r);
        }
        if (d.quickMask) list.appendChild(U.el('div', { class: 'chan-row active' }, [U.el('span', { class: 'chan-dot qm' }), U.el('span', { style: { fontStyle: 'italic' } }, 'Quick Mask')]));
        for (const ch of d.alphaChannels) {
          const del = U.el('button', { class: 'icon-btn', html: S.icon('trash'), title: 'Delete channel' });
          del.onclick = (e) => { e.stopPropagation(); d.commit('Delete Channel', () => { d.alphaChannels = d.alphaChannels.filter((c) => c.id !== ch.id); }); upd(); };
          const r = U.el('div', { class: 'chan-row', title: 'Click to load as selection' }, [U.el('span', { class: 'chan-dot mask' }), U.el('span', { style: { flex: 1 } }, ch.name), del]);
          r.onclick = () => S.Cmd.run('select.load', ch.id);
          list.appendChild(r);
        }
        const save = U.el('button', { class: 'btn btn-sm', style: { marginTop: '8px' } }, 'Save selection as channel');
        save.onclick = () => S.Cmd.run('select.save');
        list.appendChild(save);
        list.appendChild(U.el('div', { class: 'muted panel-hint', style: { marginTop: '8px' } }, 'Click a color channel to view it in grayscale; click a saved channel to load it as a selection.'));
      };
      return { update: U.debounce(upd, 120) };
    },
  });
})();
