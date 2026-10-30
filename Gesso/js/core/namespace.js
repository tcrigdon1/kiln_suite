/* =========================================================================
   Gesso — global namespace, utilities, event bus
   Everything in Gesso hangs off window.Gesso (alias S inside files).
   Classic scripts only (works from file://). Load order matters: see index.html.
   ========================================================================= */
(function () {
  'use strict';
  const S = (window.Gesso = window.Gesso || {});
  S.version = '1.0.0';
  S.repoURL = 'https://github.com/tcrigdon1/kiln_suite';

  /* ---------------- Utilities ---------------- */
  const U = (S.util = {});

  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  let _uid = 1;
  U.uid = (p = 'id') => p + '_' + Date.now().toString(36) + '_' + (_uid++).toString(36);

  /** Tiny DOM builder: el('div', {class:'x', onclick: fn, style:{...}}, [children | 'text']) */
  U.el = function (tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
        else if (k === 'html') e.innerHTML = v;
        else if (k === 'text') e.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(e.dataset, v);
        else if (k in e && typeof v !== 'string') e[k] = v;
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    if (children != null) {
      if (!Array.isArray(children)) children = [children];
      for (const c of children) {
        if (c == null || c === false) continue;
        e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
      }
    }
    return e;
  };

  /**
   * Canvases that hold layer pixels carry a document-space offset (c.ox, c.oy = where canvas pixel
   * (0,0) sits in the document).  A canvas without ox/oy is at (0,0).  Layer canvases are only as large
   * as their content (see Layers.growTo / trim), so most helpers below take an optional offset.
   */
  U.createCanvas = function (w, h, ox, oy) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    if (ox || oy) { c.ox = Math.round(ox || 0); c.oy = Math.round(oy || 0); }
    return c;
  };
  U.ctx = (c) => c.getContext('2d', { willReadFrequently: false });
  U.cloneCanvas = function (src) {
    const c = U.createCanvas(src.width, src.height, src.ox, src.oy);
    if (src._empty) c._empty = true;
    c.getContext('2d').drawImage(src, 0, 0);
    return c;
  };
  U.clearCanvas = (c) => c.getContext('2d').clearRect(0, 0, c.width, c.height);
  /** Document-space rectangle covered by a canvas */
  U.rectOf = (c) => ({ x: c.ox || 0, y: c.oy || 0, w: c.width, h: c.height });
  /** Round a rect outwards to integer pixels (no clamping) */
  U.rectRound = function (r) {
    const x = Math.floor(r.x), y = Math.floor(r.y), x2 = Math.ceil(r.x + r.w), y2 = Math.ceil(r.y + r.h);
    if (x2 <= x || y2 <= y) return null;
    return { x, y, w: x2 - x, h: y2 - y };
  };
  /**
   * Draw the document-space rectangle r of src (an offset canvas) onto ctx, whose current transform maps
   * document coordinates (the destination is r itself, or dx,dy when given).  Pixels outside src are skipped.
   */
  U.blitRect = function (ctx, src, r, dx, dy) {
    const sr = U.rectOf(src), i = U.rectIntersect(r, sr);
    if (!i) return;
    const ox = dx == null ? 0 : dx - r.x, oy = dy == null ? 0 : dy - r.y;
    ctx.drawImage(src, i.x - sr.x, i.y - sr.y, i.w, i.h, i.x + ox, i.y + oy, i.w, i.h);
  };
  /** drawImage src at its own document offset onto a ctx that maps document coordinates */
  U.drawAt = (ctx, src) => ctx.drawImage(src, src.ox || 0, src.oy || 0);

  /*
   * Pool of scratch canvases keyed by size, to avoid churn during compositing.
   * scratch(w, h, rect): the caller promises to draw only inside `rect` (canvas pixels); the pool then
   * only has to clear the area the previous user touched instead of the whole (document-sized) canvas,
   * which is what makes small dirty-rectangle composites cheap on large documents.
   */
  const pool = [];
  const FULL = (c) => ({ x: 0, y: 0, w: c.width, h: c.height });
  /** Clear any transform left on a canvas's context (a canvas that becomes layer pixels must be painted on in plain canvas space) */
  U.resetCtx = function (c) { if (c) c.getContext('2d').setTransform(1, 0, 0, 1, 0, 0); return c; };
  U.scratch = function (w, h, rect) {
    let c = null;
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      if (!p._busy && p.width === w && p.height === h) { c = p; break; }
    }
    if (!c) {
      c = U.createCanvas(w, h);
      c._used = null; // freshly created: already clear
      pool.push(c);
      if (pool.length > 24) for (let i = 0; i < pool.length && pool.length > 16; i++) if (!pool[i]._busy) { pool.splice(i, 1); i--; }
    }
    c._busy = true; c.ox = 0; c.oy = 0;
    const x = c.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.filter = 'none'; x.imageSmoothingEnabled = true;
    if (c._used) { const u = c._used; x.clearRect(u.x, u.y, u.w, u.h); }
    c._used = rect ? U.rectRound(rect) || FULL(c) : FULL(c);
    return c;
  };
  U.release = function (c) { if (c) c._busy = false; };
  /** Drop pooled canvases that no open document needs (called when documents close / resize) */
  U.trimPool = function (keepSizes) {
    for (let i = pool.length - 1; i >= 0; i--) {
      const c = pool[i];
      if (c._busy) continue;
      if (!keepSizes.some((s) => s[0] === c.width && s[1] === c.height)) { c.width = c.height = 1; pool.splice(i, 1); }
    }
  };
  U.poolBytes = () => pool.reduce((a, c) => a + c.width * c.height * 4, 0);

  /**
   * Read a few pixels from a (GPU) canvas without making Chrome move that canvas to
   * software rendering: copy the region into a tiny read-optimised canvas first.
   */
  let _pick = null;
  U.samplePixels = function (src, x, y, w = 1, h = 1) {
    if (!_pick) { _pick = document.createElement('canvas'); _pick.width = 64; _pick.height = 64; _pick._ctx = _pick.getContext('2d', { willReadFrequently: true }); }
    if (w > _pick.width || h > _pick.height) { _pick.width = Math.max(w, 64); _pick.height = Math.max(h, 64); _pick._ctx = _pick.getContext('2d', { willReadFrequently: true }); }
    const c = _pick._ctx;
    c.clearRect(0, 0, w, h);
    c.drawImage(src, x, y, w, h, 0, 0, w, h);
    return c.getImageData(0, 0, w, h).data;
  };

  U.rectUnion = function (a, b) {
    if (!a) return b ? { ...b } : null;
    if (!b) return { ...a };
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  };
  U.rectIntersect = function (a, b) {
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    const r = Math.min(a.x + a.w, b.x + b.w), btm = Math.min(a.y + a.h, b.y + b.h);
    if (r <= x || btm <= y) return null;
    return { x, y, w: r - x, h: btm - y };
  };
  U.rectInt = function (r, W, H) {
    // snap to integer pixels and clamp to bounds
    let x = Math.floor(r.x), y = Math.floor(r.y);
    let x2 = Math.ceil(r.x + r.w), y2 = Math.ceil(r.y + r.h);
    x = U.clamp(x, 0, W); y = U.clamp(y, 0, H); x2 = U.clamp(x2, 0, W); y2 = U.clamp(y2, 0, H);
    if (x2 <= x || y2 <= y) return null;
    return { x, y, w: x2 - x, h: y2 - y };
  };

  U.debounce = function (fn, ms) {
    let t = null;
    const d = function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
    d.cancel = () => clearTimeout(t);
    return d;
  };

  U.downloadBlob = function (blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  };
  U.readFile = function (file, as = 'dataURL') {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      if (as === 'text') r.readAsText(file); else if (as === 'buffer') r.readAsArrayBuffer(file); else r.readAsDataURL(file);
    });
  };
  U.loadImage = function (src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('Could not decode image'));
      img.src = src;
    });
  };
  U.canvasToBlob = (c, type = 'image/png', q) => new Promise((res) => c.toBlob(res, type, q));
  U.fmt = (n, d = 0) => (Math.round(n * Math.pow(10, d)) / Math.pow(10, d)).toString();
  U.isMac = /Mac/.test(navigator.platform);

  /* ---------------- Color helpers ---------------- */
  U.hexToRgb = function (hex) {
    hex = String(hex || '#000').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const n = parseInt(hex.slice(0, 6), 16) || 0;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };
  U.rgbToHex = function (r, g, b) {
    if (typeof r === 'object') ({ r, g, b } = r);
    const h = (v) => U.clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
    return '#' + h(r) + h(g) + h(b);
  };
  U.rgbToHsv = function (r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return { h, s: max ? d / max : 0, v: max };
  };
  U.hsvToRgb = function (h, s, v) {
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
    return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
  };
  U.rgbToHsl = function (r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0; const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0); else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h, s, l };
  };
  U.hslToRgb = function (h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    if (!s) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
    return { r: Math.round(f(h + 1 / 3) * 255), g: Math.round(f(h) * 255), b: Math.round(f(h - 1 / 3) * 255) };
  };
  U.luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  U.rgba = (hex, a) => { const c = U.hexToRgb(hex); return `rgba(${c.r},${c.g},${c.b},${a})`; };

  /* ---------------- Event bus ---------------- */
  const handlers = {};
  S.bus = {
    on(evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); return () => S.bus.off(evt, fn); },
    off(evt, fn) { const a = handlers[evt]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } },
    emit(evt, data) {
      const a = handlers[evt];
      if (!a) return;
      for (const fn of a.slice()) {
        try { fn(data); } catch (err) { console.error('[bus ' + evt + ']', err); }
      }
    },
  };

  /* ---------------- Toast ---------------- */
  S.toast = function (msg, ms = 2200) {
    let wrap = document.querySelector('.toast-wrap');
    if (!wrap) { wrap = U.el('div', { class: 'toast-wrap' }); document.body.appendChild(wrap); }
    const t = U.el('div', { class: 'toast' }, msg);
    wrap.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, ms);
  };

  /* ---------------- localStorage helpers (safe) ---------------- */
  S.store = {
    get(key, def) { try { const v = localStorage.getItem('gesso.' + key); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(key, val) { try { localStorage.setItem('gesso.' + key, JSON.stringify(val)); } catch (e) { /* quota */ } },
    del(key) { try { localStorage.removeItem('gesso.' + key); } catch (e) {} },
  };

  /* App-wide state (populated in app/main.js) */
  S.app = {
    docs: [],
    doc: null,           // active document
    fg: '#000000',
    bg: '#ffffff',
    tool: null,
    prefs: {},
  };

  /* Blend modes: id -> canvas globalCompositeOperation */
  S.BLEND_MODES = [
    { id: 'normal', label: 'Normal', op: 'source-over' },
    { id: 'dissolve', label: 'Dissolve', op: 'source-over' },
    null,
    { id: 'darken', label: 'Darken', op: 'darken' },
    { id: 'multiply', label: 'Multiply', op: 'multiply' },
    { id: 'color-burn', label: 'Color Burn', op: 'color-burn' },
    null,
    { id: 'lighten', label: 'Lighten', op: 'lighten' },
    { id: 'screen', label: 'Screen', op: 'screen' },
    { id: 'color-dodge', label: 'Color Dodge', op: 'color-dodge' },
    null,
    { id: 'overlay', label: 'Overlay', op: 'overlay' },
    { id: 'soft-light', label: 'Soft Light', op: 'soft-light' },
    { id: 'hard-light', label: 'Hard Light', op: 'hard-light' },
    null,
    { id: 'difference', label: 'Difference', op: 'difference' },
    { id: 'exclusion', label: 'Exclusion', op: 'exclusion' },
    null,
    { id: 'hue', label: 'Hue', op: 'hue' },
    { id: 'saturation', label: 'Saturation', op: 'saturation' },
    { id: 'color', label: 'Color', op: 'color' },
    { id: 'luminosity', label: 'Luminosity', op: 'luminosity' },
  ];
  S.blendOp = function (id) {
    if (!id || id === 'normal' || id === 'dissolve' || id === 'pass-through') return 'source-over';
    for (const m of S.BLEND_MODES) if (m && m.id === id) return m.op;
    return 'source-over';
  };
  /** Build <option>s for a blend select. */
  S.blendOptions = function (sel, includePass) {
    sel.innerHTML = '';
    if (includePass) sel.appendChild(U.el('option', { value: 'pass-through' }, 'Pass Through'));
    for (const m of S.BLEND_MODES) {
      if (!m) { sel.appendChild(U.el('option', { disabled: true }, '──────────')); continue; }
      sel.appendChild(U.el('option', { value: m.id }, m.label));
    }
  };
})();
