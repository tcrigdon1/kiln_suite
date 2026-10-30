/* =========================================================================
   Gesso — Color Look export.  Bakes the document's adjustment layers into a
   3D colour lookup table: a .cube file (video / photo tools) or a HALD CLUT
   image (PNG).  A LUT can only hold point operations, so masks, clipping,
   blend modes and group isolation are ignored; adjustments with a spatial
   radius and the image-dependent auto adjustments are approximated.

   S.LUT.layersFor(doc, source)      adjustment layers, bottom → top
   S.LUT.runnable(entries)           the ones that will actually run
   S.LUT.lattice(n, width)           identity lattice ImageData (red fastest)
   S.LUT.bake(img, entries)          run an ImageData through the layers
   S.LUT.cubeText(img, n, title)     contents of a .cube file
   S.LUT.haldCanvas(level, entries)  HALD CLUT canvas (level³ × level³ px)
   Commands: file.exportLut, file.exportHald
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util;
  const L = (S.LUT = {});
  const doc = () => S.app.doc;
  const FX = () => (window.ImageFX && ImageFX.adjustments) || {};

  /**
   * Adjustment layers of a document in render order (bottom → top), each with the visibility and
   * opacity of its enclosing groups folded in: [{ layer, visible, opacity }].
   * source: 'all' | 'above' (above the active layer in the Layers panel) | 'this' (the active layer only)
   */
  L.layersFor = function (d, source) {
    const out = [];
    const rec = (list, vis, op) => {
      for (const l of list) {
        const v = vis && l.visible !== false, o = op * (l.opacity == null ? 1 : l.opacity);
        if (l.type === 'adjustment' && l.adj) out.push({ layer: l, visible: v, opacity: o });
        else if (l.children) rec(l.children, v, o);
      }
    };
    rec(d.layers, true, 1);
    if (source === 'this') { const a = d.activeLayer(); return out.filter((e) => e.layer === a); }
    if (source === 'above') {
      const flat = d.flatTopDown().map((f) => f.layer), i = flat.indexOf(d.activeLayer());
      const above = new Set(i < 0 ? flat : flat.slice(0, i));
      return out.filter((e) => above.has(e.layer));
    }
    return out;
  };
  /** Entries that take part in the bake: visible, non-zero opacity, effect available */
  L.runnable = (entries) => entries.filter((e) => e.visible && e.opacity > 0 && !!FX()[e.layer.adj.id]);
  /** Adjustments a LUT can only approximate: spatial ones (a pixel-radius parameter) and the auto ones */
  L.isApprox = function (l) {
    const fx = FX()[l.adj.id];
    if (!fx) return false;
    if (/^auto/.test(l.adj.id)) return true;
    return (fx.params || []).some((p) => p.unit === 'px');
  };

  /** n³ identity lattice, red varying fastest, then green, then blue, laid out in rows of `width` pixels */
  L.lattice = function (n, width) {
    const total = n * n * n, W = width || n * n, H = Math.ceil(total / W);
    const img = new ImageData(W, H), d = img.data, k = 255 / (n - 1);
    for (let i = 0, j = 0; i < total; i++, j += 4) {
      d[j] = Math.round((i % n) * k);
      d[j + 1] = Math.round((((i / n) | 0) % n) * k);
      d[j + 2] = Math.round(((i / (n * n)) | 0) * k);
      d[j + 3] = 255;
    }
    return img;
  };

  /** Run an ImageData through the adjustment layers (bottom → top); opacity mixes result and input */
  L.bake = function (img, entries) {
    let cur = img;
    for (const e of L.runnable(entries)) {
      const l = e.layer;
      let res;
      try { res = ImageFX.apply(l.adj.id, cur, l.adj.params || {}); } catch (err) { console.warn('Color Look: ' + l.name + ' failed', err); continue; }
      if (!res) continue;
      if (e.opacity < 1) {
        const a = cur.data, b = res.data, out = new ImageData(cur.width, cur.height), o = out.data, k = e.opacity;
        for (let i = 0; i < a.length; i += 4) {
          o[i] = a[i] + (b[i] - a[i]) * k; o[i + 1] = a[i + 1] + (b[i + 1] - a[i + 1]) * k; o[i + 2] = a[i + 2] + (b[i + 2] - a[i + 2]) * k; o[i + 3] = a[i + 3];
        }
        res = out;
      }
      cur = res;
    }
    return cur;
  };

  /** .cube text for a baked lattice of size n (TITLE, LUT_3D_SIZE, DOMAIN_MIN/MAX, n³ "r g b" lines, red fastest) */
  L.cubeText = function (img, n, title, entries) {
    const d = img.data, total = n * n * n, lines = [];
    lines.push('TITLE "' + String(title || 'Color Look').replace(/"/g, "'").replace(/[\r\n]+/g, ' ') + '"');
    const names = entries ? L.runnable(entries).map((e) => e.layer.name) : [];
    lines.push('# Exported from Gesso' + (names.length ? ' — ' + names.join(', ') : ' — identity') + ' (8-bit precision)');
    lines.push('LUT_3D_SIZE ' + n);
    lines.push('DOMAIN_MIN 0 0 0');
    lines.push('DOMAIN_MAX 1 1 1');
    for (let i = 0, j = 0; i < total; i++, j += 4) lines.push((d[j] / 255).toFixed(6) + ' ' + (d[j + 1] / 255).toFixed(6) + ' ' + (d[j + 2] / 255).toFixed(6));
    return lines.join('\n') + '\n';
  };

  /** HALD CLUT image: level² steps per channel, level³ × level³ pixels (level 8 → 512 × 512) */
  L.haldCanvas = function (level, entries) {
    const n = level * level, size = level * level * level;
    const img = L.bake(L.lattice(n, size), entries);
    const c = U.createCanvas(size, size);
    c.getContext('2d').putImageData(img, 0, 0);
    return c;
  };

  async function save(blob, name, mime, ext, desc) {
    try {
      if (window.showSaveFilePicker) {
        const h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: desc, accept: { [mime]: ['.' + ext] } }] });
        const w = await h.createWritable(); await w.write(blob); await w.close();
        return true;
      }
    } catch (e) { if (e.name === 'AbortError') return false; console.warn(e); }
    U.downloadBlob(blob, name);
    return true;
  }
  const fileSafe = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Color Look';

  /** Export dialog shared by the .cube and HALD commands.  kind: 'cube' | 'hald' */
  L.dialog = function (d, kind) {
    const active = d.activeLayer();
    const srcOpts = [{ value: 'all', label: 'All adjustment layers' }, { value: 'above', label: 'Adjustment layers above the active layer' }];
    if (active && active.type === 'adjustment') srcOpts.push({ value: 'this', label: 'This adjustment layer only' });
    const last = Object.assign({ size: 33, level: 8, source: 'all' }, S.store.get('lut', {}));
    const defs = kind === 'cube'
      ? [{ id: 'size', label: 'LUT size', type: 'select', default: [17, 33, 65].includes(+last.size) ? +last.size : 33, options: [{ value: 17, label: '17 × 17 × 17 (small)' }, { value: 33, label: '33 × 33 × 33 (standard)' }, { value: 65, label: '65 × 65 × 65 (fine)' }] }]
      : [{ id: 'level', label: 'HALD level', type: 'select', default: [4, 8, 12].includes(+last.level) ? +last.level : 8, options: [{ value: 4, label: '4 — 64 × 64 px, 16 steps' }, { value: 8, label: '8 — 512 × 512 px, 64 steps' }, { value: 12, label: '12 — 1728 × 1728 px, 144 steps' }] }];
    defs.push({ id: 'source', label: 'Source', type: 'select', default: srcOpts.some((o) => o.value === last.source) ? last.source : 'all', options: srcOpts });
    defs.push({ id: 'title', label: 'Title', type: 'text', default: d.name });
    const vals = {};
    const ui = S.ParamUI.build(defs, {}, (v) => { Object.assign(vals, v); refresh(); });
    Object.assign(vals, ui.values);
    const summary = U.el('div', { class: 'lut-summary' });
    const approx = U.el('div', { class: 'muted param-note lut-approx' });
    const note = U.el('div', { class: 'muted param-note' }, 'A LUT stores colour → colour only: layer masks, clipping, blend modes and group isolation are ignored. Values are 8-bit.');
    function refresh() {
      const entries = L.layersFor(d, vals.source), run = L.runnable(entries);
      const skipped = entries.length - run.length;
      summary.innerHTML = '';
      if (!run.length) summary.appendChild(U.el('div', { class: 'muted' }, entries.length ? 'All ' + entries.length + ' adjustment layers are hidden — the result is an identity look.' : 'No adjustment layers — the result is an identity look.'));
      else {
        summary.appendChild(U.el('div', {}, 'Bakes ' + run.length + ' adjustment layer' + (run.length === 1 ? '' : 's') + ' (bottom → top):'));
        summary.appendChild(U.el('div', { class: 'lut-list' }, run.map((e) => U.el('span', { class: 'lut-chip' + (L.isApprox(e.layer) ? ' approx' : ''), title: e.layer.name + (e.opacity < 1 ? ' · opacity ' + Math.round(e.opacity * 100) + ' %' : '') }, e.layer.name + (e.opacity < 1 ? ' ' + Math.round(e.opacity * 100) + '%' : '')))));
        if (skipped) summary.appendChild(U.el('div', { class: 'muted' }, skipped + ' hidden or unavailable layer' + (skipped === 1 ? ' is' : 's are') + ' skipped.'));
      }
      const ap = run.filter((e) => L.isApprox(e.layer)).map((e) => e.layer.name);
      approx.textContent = ap.length ? 'Spatial / auto adjustments are approximated (they depend on neighbouring pixels or the whole image): ' + ap.join(', ') + '.' : '';
      approx.style.display = ap.length ? '' : 'none';
    }
    refresh();
    const body = U.el('div', { class: 'lut-body' }, [ui, summary, approx, note]);
    S.Dialog.open({ title: kind === 'cube' ? 'Export Color Look (.cube LUT)' : 'Export Color Look as HALD Image', body, width: 460,
      buttons: [{ label: 'Cancel' }, { label: 'Export', primary: true, run: () => {
        const title = (vals.title || '').trim() || d.name;
        const entries = L.layersFor(d, vals.source);
        S.store.set('lut', { size: vals.size != null ? +vals.size : last.size, level: vals.level != null ? +vals.level : last.level, source: vals.source });
        if (kind === 'cube') {
          const n = +vals.size || 33, text = L.cubeText(L.bake(L.lattice(n), entries), n, title, entries), name = fileSafe(title) + '.cube';
          save(new Blob([text], { type: 'text/plain' }), name, 'text/plain', 'cube', 'Cube LUT').then((ok) => { if (ok) S.toast('Exported ' + name + ' (' + n + '³)'); });
        } else {
          const level = +vals.level || 8, c = L.haldCanvas(level, entries), name = fileSafe(title) + '-hald' + level + '.png';
          U.canvasToBlob(c, 'image/png').then((b) => save(b, name, 'image/png', 'png', 'HALD CLUT image')).then((ok) => { if (ok) S.toast('Exported ' + name + ' (' + c.width + ' × ' + c.height + ')'); });
        }
      } }] });
  };

  S.Cmd.register('file.exportLut', { label: 'Export Color Look (.cube LUT)…', run: () => L.dialog(doc(), 'cube'), enabled: () => !!doc() });
  S.Cmd.register('file.exportHald', { label: 'Export Color Look as HALD Image (PNG)…', run: () => L.dialog(doc(), 'hald'), enabled: () => !!doc() });
})();
