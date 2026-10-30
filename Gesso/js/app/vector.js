/* =========================================================================
   Gesso — vector utilities:
     • Layer ▸ Combine Shapes (Unite / Subtract Front / Intersect / Exclude): the selected shape layers are
       rasterised at 2× and the result is traced back into one path shape layer (curves are re-fitted, so
       the result stays editable with the Pen / Direct Select tools).  The bottom-most shape keeps its paint.
     • Layer ▸ Convert Text to Shape (traced) — same tracer; the browser gives no glyph outlines.
     • SVG import (File ▸ Open / Place): rect, circle, ellipse, line, polyline, polygon, path (incl. arcs),
       text, image, groups, transforms, inline styles, linear / radial gradients.
     • SVG export (File ▸ Export as SVG…): shape and text layers stay vector, everything else is embedded
       as PNG <image>.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util, M = S.Affine;
  const V = (S.Vector = {});
  const doc = () => S.app.doc;

  /* ======================= raster → path tracing ======================= */
  /**
   * draw(ctx) paints opaque coverage in DOC coordinates onto a context already scaled by k and translated so
   * that `bounds` fills the canvas. Returns a smoothed path in doc space.
   */
  V.trace = function (draw, bounds, opts) {
    opts = opts || {};
    const pad = 2;
    const bx = Math.floor(bounds.x) - pad, by = Math.floor(bounds.y) - pad, bw = Math.ceil(bounds.w) + pad * 2, bh = Math.ceil(bounds.h) + pad * 2;
    let k = opts.scale || 2;
    while (k > 0.25 && bw * k * bh * k > 16e6) k /= 2; // 16 Mpx cap
    const W = Math.max(1, Math.ceil(bw * k)), H = Math.max(1, Math.ceil(bh * k));
    const c = U.createCanvas(W, H), x = c.getContext('2d');
    x.setTransform(k, 0, 0, k, -bx * k, -by * k);
    draw(x, k);
    const d = x.getImageData(0, 0, W, H).data, mask = new Uint8Array(W * H);
    let x1 = W, y1 = H, x2 = -1, y2 = -1;
    for (let i = 0, p = 0; i < mask.length; i++, p += 4) if (d[p + 3] >= 128) { mask[i] = 255; const px = i % W, py = (i / W) | 0; if (px < x1) x1 = px; if (px > x2) x2 = px; if (py < y1) y1 = py; if (py > y2) y2 = py; }
    if (x2 < 0) return S.Paths.empty();
    const sel = { w: W, h: H, mask, bounds: { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 } };
    const raw = S.Ops.selectionToPath(sel, opts.tolerance != null ? opts.tolerance : 1.1);
    const p = S.Paths.transform(raw, (px, py) => [px / k + bx, py / k + by]);
    return opts.smooth === false ? p : V.smooth(p, opts.cornerDeg || 38);
  };

  /** Fit smooth bezier handles through polyline nodes; nodes whose turn is sharper than cornerDeg stay corners */
  V.smooth = function (path, cornerDeg) {
    const cosLimit = Math.cos((cornerDeg * Math.PI) / 180); // turn angle below cornerDeg → smooth node
    for (const sp of path.subpaths) {
      const n = sp.nodes, N = n.length; if (N < 3) continue;
      // drop near-collinear micro points first (tracing leaves stair steps)
      for (let i = 0; i < N; i++) {
        const a = n[(i + N - 1) % N], b = n[i], c = n[(i + 1) % N];
        const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y, lu = Math.hypot(ux, uy) || 1e-9, lv = Math.hypot(vx, vy) || 1e-9;
        const cos = (ux * vx + uy * vy) / (lu * lv); // 1 = straight on, -1 = reversal
        if (cos > cosLimit) {
          // smooth: handles along the chord a→c (Catmull-Rom like), scaled to neighbour distances
          const tx = (c.x - a.x), ty = (c.y - a.y), lt = Math.hypot(tx, ty) || 1e-9;
          b.ix = b.x - (tx / lt) * lu * 0.3; b.iy = b.y - (ty / lt) * lu * 0.3;
          b.ox = b.x + (tx / lt) * lv * 0.3; b.oy = b.y + (ty / lt) * lv * 0.3;
        } else { b.ix = b.ox = b.x; b.iy = b.oy = b.y; }
      }
    }
    return path;
  };

  /* ======================= Combine Shapes ======================= */
  const OPS = { unite: ['Unite', 'source-over'], subtract: ['Subtract Front Shapes', 'destination-out'], intersect: ['Intersect', 'destination-in'], exclude: ['Exclude Overlap', 'xor'] };
  V.selectedShapes = function (d) { return d ? d.flatTopDown().map((x) => x.layer).filter((l) => d.selectedIds.has(l.id) && l.type === 'shape') : []; };
  V.combine = function (d, op) {
    const tops = V.selectedShapes(d); // top → bottom
    if (tops.length < 2) { S.toast('Select two or more shape layers'); return; }
    const layers = tops.slice().reverse(); // bottom first: the bottom shape is the base
    const base = layers[0];
    let b = null; for (const l of layers) b = U.rectUnion(b, S.Shape.bounds(l.shape));
    if (!b || b.w < 1 || b.h < 1) return;
    const paths = layers.map((l) => S.Paths.toPath2D(S.Shape.toPath(l.shape)));
    const path = V.trace((ctx) => {
      ctx.fillStyle = '#000';
      ctx.fill(paths[0], 'nonzero');
      for (let i = 1; i < paths.length; i++) { ctx.globalCompositeOperation = OPS[op][1]; ctx.fill(paths[i], 'nonzero'); }
    }, b);
    d.commit('Combine Shapes: ' + OPS[op][0], () => {
      const s = base.shape;
      base.shape = Object.assign(S.Shape.defaults('path'), { kind: 'path', path, fill: JSON.parse(JSON.stringify(s.fill)), stroke: JSON.parse(JSON.stringify(s.stroke)), matrix: null, repeat: null });
      base.name = base.name.replace(/^(Rectangle|Rounded Rectangle|Ellipse|Polygon|Star|Line|Custom Shape)( copy)?$/, 'Shape');
      base.version++;
      for (const l of layers.slice(1)) d.removeLayer(l.id);
      d.activeId = base.id; d.selectedIds = new Set([base.id]);
    });
    S.bus.emit('layers:changed', d);
  };
  for (const op in OPS) S.Cmd.register('layer.combine.' + op, { label: OPS[op][0], run: () => V.combine(doc(), op), enabled: () => V.selectedShapes(doc()).length >= 2 });

  /* ======================= Text → Shape ======================= */
  V.textToShape = function (d) {
    const l = d.activeLayer(); if (!l || l.type !== 'text') return;
    const b = S.layerBounds(l, d); if (!b || b.w < 1 || b.h < 1) { S.toast('The text layer is empty'); return; }
    const t = Object.assign({}, l.text, { color: '#000000' });
    const path = V.trace((ctx) => S.Text.render(ctx, t), b, { cornerDeg: 45 });
    if (!path.subpaths.length) { S.toast('Nothing to convert'); return; }
    d.commit('Convert Text to Shape', () => {
      const s = Object.assign(S.Shape.defaults('path'), { kind: 'path', path, fill: { enabled: true, color: l.text.color, type: 'solid' }, stroke: { enabled: false, color: '#000000', width: 4, align: 'center', dash: 'solid', cap: 'round', join: 'round', type: 'solid' } });
      const nl = S.Layers.shape(d, s);
      nl.name = l.name + ' (shape)'; nl.opacity = l.opacity; nl.blend = l.blend; nl.effects = l.effects ? JSON.parse(JSON.stringify(l.effects)) : null; nl.mask = l.mask;
      d.insertLayer(nl, l.id, 'above'); d.removeLayer(l.id);
      d.activeId = nl.id; d.selectedIds = new Set([nl.id]);
    });
    S.bus.emit('layers:changed', d);
  };
  S.Cmd.register('layer.textToShape', { label: 'Convert Text to Shape (traced)', run: () => V.textToShape(doc()), enabled: () => { const l = doc() && doc().activeLayer(); return !!(l && l.type === 'text'); } });

  /* ======================= SVG import ======================= */
  const NUM = /[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi;
  const nums = (s) => (s ? (s.match(NUM) || []).map(Number) : []);
  const UNIT = { px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, '': 1 };
  const len = (s, rel) => { if (s == null || s === '') return null; const m = String(s).trim().match(/^([-+]?[\d.]+(?:e[-+]?\d+)?)\s*(px|pt|pc|mm|cm|in|%|em)?$/i); if (!m) return null; const v = +m[1], u = (m[2] || '').toLowerCase(); if (u === '%') return rel != null ? (v / 100) * rel : v; if (u === 'em') return v * 16; return v * (UNIT[u] || 1); };
  const parseTransform = (str) => {
    let m = M.I(); if (!str) return m;
    const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g; let r;
    while ((r = re.exec(str))) {
      const a = nums(r[2]); let t;
      switch (r[1]) {
        case 'matrix': t = a.length >= 6 ? a.slice(0, 6) : M.I(); break;
        case 'translate': t = M.translate(a[0] || 0, a[1] || 0); break;
        case 'scale': t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]; break;
        case 'rotate': t = M.rotAbout(((a[0] || 0) * Math.PI) / 180, a[1] || 0, a[2] || 0); break;
        case 'skewX': t = [1, 0, Math.tan(((a[0] || 0) * Math.PI) / 180), 1, 0, 0]; break;
        case 'skewY': t = [1, Math.tan(((a[0] || 0) * Math.PI) / 180), 0, 1, 0, 0]; break;
      }
      m = M.mul(m, t);
    }
    return m;
  };
  let _cctx = null;
  /** any CSS colour → { hex, alpha } (null for none / unparsable) */
  const parseColor = (s) => {
    if (!s) return null; s = String(s).trim(); if (!s || s === 'none' || s === 'transparent') return null;
    if (s === 'currentColor') s = '#000';
    const c = _cctx || (_cctx = U.createCanvas(1, 1).getContext('2d'));
    c.fillStyle = '#010203'; c.fillStyle = s; const v = c.fillStyle;
    if (v === '#010203' && !/^#?010203$/i.test(s)) return null;
    if (v[0] === '#') return { hex: v, alpha: 1 };
    const m = v.match(/rgba?\(([^)]*)\)/); if (!m) return null;
    const a = m[1].split(',').map((x) => parseFloat(x));
    return { hex: '#' + [a[0], a[1], a[2]].map((n) => Math.round(n).toString(16).padStart(2, '0')).join(''), alpha: a[3] == null ? 1 : a[3] };
  };
  /** SVG path data → path model (absolute coords) */
  V.parsePathData = function (d) {
    const P = S.Paths, out = { subpaths: [] };
    const toks = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g) || [];
    let i = 0, cmd = '', cx = 0, cy = 0, sx = 0, sy = 0, sp = null, lastC = null, lastQ = null;
    const next = () => +toks[i++];
    const start = (x, y) => { sp = { closed: false, nodes: [P.node(x, y)] }; out.subpaths.push(sp); cx = sx = x; cy = sy = y; };
    const cur = () => sp.nodes[sp.nodes.length - 1];
    const lineTo = (x, y) => { if (!sp) start(x, y); else sp.nodes.push(P.node(x, y)); cx = x; cy = y; lastC = lastQ = null; };
    const cubicTo = (x1, y1, x2, y2, x, y) => { if (!sp) start(cx, cy); const a = cur(); a.ox = x1; a.oy = y1; sp.nodes.push(P.node(x, y, x2, y2)); cx = x; cy = y; lastC = [x2, y2]; lastQ = null; };
    const quadTo = (qx, qy, x, y) => { cubicTo(cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y); lastQ = [qx, qy]; };
    const arcTo = (rx, ry, phi, fa, fs, x, y) => {
      // SVG implementation notes F.6.5: endpoint → centre parameterisation, then split into ≤ 90° cubic arcs
      if (rx === 0 || ry === 0) { lineTo(x, y); return; }
      rx = Math.abs(rx); ry = Math.abs(ry);
      const rad = (phi * Math.PI) / 180, cp = Math.cos(rad), spn = Math.sin(rad);
      const dx = (cx - x) / 2, dy = (cy - y) / 2, x1 = cp * dx + spn * dy, y1 = -spn * dx + cp * dy;
      let lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry); if (lam > 1) { lam = Math.sqrt(lam); rx *= lam; ry *= lam; }
      const sign = fa === fs ? -1 : 1, den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
      const co = den ? sign * Math.sqrt(Math.max(0, (rx * rx * ry * ry - den) / den)) : 0;
      const cxp = (co * rx * y1) / ry, cyp = (-co * ry * x1) / rx;
      const ccx = cp * cxp - spn * cyp + (cx + x) / 2, ccy = spn * cxp + cp * cyp + (cy + y) / 2;
      const ang = (ux, uy, vx, vy) => { const d = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return d; };
      const th1 = Math.atan2((y1 - cyp) / ry, (x1 - cxp) / rx);
      let dth = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
      if (!fs && dth > 0) dth -= 2 * Math.PI; else if (fs && dth < 0) dth += 2 * Math.PI;
      const segs = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2)));
      const pt = (t) => [ccx + rx * Math.cos(t) * cp - ry * Math.sin(t) * spn, ccy + rx * Math.cos(t) * spn + ry * Math.sin(t) * cp];
      const der = (t) => [-rx * Math.sin(t) * cp - ry * Math.cos(t) * spn, -rx * Math.sin(t) * spn + ry * Math.cos(t) * cp];
      for (let s = 0; s < segs; s++) {
        const a = th1 + (dth * s) / segs, b = th1 + (dth * (s + 1)) / segs, k = (4 / 3) * Math.tan((b - a) / 4);
        const p0 = pt(a), p3 = pt(b), d0 = der(a), d3 = der(b);
        cubicTo(p0[0] + k * d0[0], p0[1] + k * d0[1], p3[0] - k * d3[0], p3[1] - k * d3[1], p3[0], p3[1]);
      }
      cx = x; cy = y;
    };
    while (i < toks.length) {
      if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
      else if (cmd === 'M') cmd = 'L'; else if (cmd === 'm') cmd = 'l';
      const rel = cmd === cmd.toLowerCase(), ox = rel ? cx : 0, oy = rel ? cy : 0;
      switch (cmd.toUpperCase()) {
        case 'M': { const x = next() + ox, y = next() + oy; start(x, y); break; }
        case 'L': lineTo(next() + ox, next() + oy); break;
        case 'H': lineTo(next() + ox, cy); break;
        case 'V': lineTo(cx, next() + oy); break;
        case 'C': cubicTo(next() + ox, next() + oy, next() + ox, next() + oy, next() + ox, next() + oy); break;
        case 'S': { const r = lastC ? [2 * cx - lastC[0], 2 * cy - lastC[1]] : [cx, cy]; cubicTo(r[0], r[1], next() + ox, next() + oy, next() + ox, next() + oy); break; }
        case 'Q': quadTo(next() + ox, next() + oy, next() + ox, next() + oy); break;
        case 'T': { const r = lastQ ? [2 * cx - lastQ[0], 2 * cy - lastQ[1]] : [cx, cy]; quadTo(r[0], r[1], next() + ox, next() + oy); break; }
        case 'A': arcTo(next(), next(), next(), next(), next(), next() + ox, next() + oy); break;
        case 'Z': if (sp) { sp.closed = true; if (sp.nodes.length > 1) { const f = sp.nodes[0], l = sp.nodes[sp.nodes.length - 1]; if (Math.abs(f.x - l.x) < 1e-9 && Math.abs(f.y - l.y) < 1e-9) { f.ix = l.ix; f.iy = l.iy; sp.nodes.pop(); } } cx = sx; cy = sy; sp = null; lastC = lastQ = null; } break;
        default: i++; // unknown token
      }
      if (Number.isNaN(cx) || Number.isNaN(cy)) break;
    }
    return out;
  };

  const styleOf = (el, inherited) => {
    const st = Object.assign({}, inherited); delete st.opacity; // opacity composes instead of inheriting
    const read = (k) => { const a = el.getAttribute(k); if (a != null && a !== '') st[k] = a.trim(); };
    for (const k of ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'display', 'visibility', 'fill-rule', 'letter-spacing']) read(k);
    const css = el.getAttribute('style');
    if (css) for (const part of css.split(';')) { const i = part.indexOf(':'); if (i > 0) st[part.slice(0, i).trim()] = part.slice(i + 1).trim(); }
    return st;
  };

  V.parseSVG = function (text) {
    const dom = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = dom.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg' || dom.querySelector('parsererror')) throw new Error('Not a valid SVG file');
    const vb = nums(root.getAttribute('viewBox') || '');
    let W = len(root.getAttribute('width')), H = len(root.getAttribute('height'));
    if (vb.length === 4) { if (!W) W = vb[2]; if (!H) H = vb[3]; } else if (!W || !H) { W = W || 800; H = H || 600; }
    W = Math.max(1, Math.round(W)); H = Math.max(1, Math.round(H));
    let rootM = M.I();
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) rootM = M.mul([W / vb[2], 0, 0, H / vb[3], 0, 0], M.translate(-vb[0], -vb[1]));
    // gradient definitions
    const grads = {};
    for (const g of dom.querySelectorAll('linearGradient, radialGradient')) {
      let stops = [...g.querySelectorAll('stop')].map((s) => { const st = styleOf(s, {}); const c = parseColor(st['stop-color'] || s.getAttribute('stop-color') || '#000'); const off = s.getAttribute('offset') || '0'; return { pos: U.clamp(off.endsWith('%') ? parseFloat(off) / 100 : parseFloat(off) || 0, 0, 1), color: c ? c.hex : '#000000' }; });
      const href = g.getAttribute('href') || g.getAttribute('xlink:href');
      if (!stops.length && href && grads[href.slice(1)]) stops = grads[href.slice(1)].stops;
      if (stops.length < 2) stops = stops.length ? [stops[0], { pos: 1, color: stops[0].color }] : [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }];
      let angle = 90;
      if (g.nodeName === 'linearGradient') {
        const x1 = len(g.getAttribute('x1') ?? '0%', 1) ?? 0, y1 = len(g.getAttribute('y1') ?? '0%', 1) ?? 0, x2 = len(g.getAttribute('x2') ?? '100%', 1) ?? 1, y2 = len(g.getAttribute('y2') ?? '0%', 1) ?? 0;
        // Shape.paintPattern measures the angle counter-clockwise from +x with y up (0° = left→right, 90° = bottom→top)
        angle = ((Math.round((Math.atan2(-(y2 - y1), x2 - x1) * 180) / Math.PI) % 360) + 360) % 360;
      }
      grads[g.id] = { type: g.nodeName === 'linearGradient' ? 'linear' : 'radial', stops, angle, scale: 100, ox: 0, oy: 0, reverse: false };
    }
    const paint = (val, opac, fallbackOn) => {
      if (val == null) return fallbackOn ? { enabled: true, color: '#000000', type: 'solid', alpha: 1 } : { enabled: false, color: '#000000', type: 'solid', alpha: 1 };
      const m = val.match(/url\(\s*#([^)\s]+)\s*\)/);
      if (m && grads[m[1]]) { const g = grads[m[1]]; return { enabled: true, color: g.stops[0].color, type: g.type, stops: JSON.parse(JSON.stringify(g.stops)), angle: g.angle, scale: 100, ox: 0, oy: 0, reverse: false, alpha: opac }; }
      const c = parseColor(val);
      if (!c) return { enabled: false, color: '#000000', type: 'solid', alpha: 1 };
      return { enabled: true, color: c.hex, type: 'solid', alpha: c.alpha * opac };
    };
    const layers = [];
    const warn = { unsupported: new Set() };
    const makeShape = (kind, params, ctm, st, el) => {
      const fo = parseFloat(st['fill-opacity'] ?? 1), so = parseFloat(st['stroke-opacity'] ?? 1);
      const fill = paint(st.fill, isNaN(fo) ? 1 : fo, true), stroke = paint(st.stroke, isNaN(so) ? 1 : so, false);
      const sw = len(st['stroke-width']) ?? 1;
      const det = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])) || 1;
      const s = Object.assign(S.Shape.defaults(kind), params, {
        kind, matrix: null, repeat: null,
        fill: { enabled: fill.enabled, color: fill.color, type: fill.type, stops: fill.stops, angle: fill.angle, scale: fill.scale, ox: fill.ox, oy: fill.oy, reverse: fill.reverse },
        stroke: { enabled: stroke.enabled && sw > 0, color: stroke.color, type: stroke.type, stops: stroke.stops, angle: stroke.angle, scale: stroke.scale, ox: stroke.ox, oy: stroke.oy, reverse: stroke.reverse, width: sw * det, align: 'center', dash: /^\s*(none)?\s*$/.test(st['stroke-dasharray'] || '') ? 'solid' : (nums(st['stroke-dasharray'])[0] || 0) <= sw * 0.5 ? 'dot' : 'dash', cap: ['butt', 'round', 'square'].includes(st['stroke-linecap']) ? st['stroke-linecap'] : 'butt', join: ['miter', 'round', 'bevel'].includes(st['stroke-linejoin']) ? st['stroke-linejoin'] : 'miter' },
      });
      for (const k of ['stops', 'angle', 'scale', 'ox', 'oy', 'reverse']) { if (s.fill[k] === undefined) delete s.fill[k]; if (s.stroke[k] === undefined) delete s.stroke[k]; }
      if (!M.isIdentity(ctm)) S.Shape.setAffine(s, ctm);
      const l = S.Layers.shape(null, s);
      const nm = el.getAttribute('inkscape:label') || el.getAttribute('id'); if (nm) l.name = nm;
      const op = parseFloat(st.opacity ?? 1);
      l.opacity = U.clamp((isNaN(op) ? 1 : op) * (fill.enabled ? fill.alpha : stroke.alpha), 0, 1);
      if (st.display === 'none' || st.visibility === 'hidden') l.visible = false;
      return l;
    };
    const walk = (el, ctm, inherited, out) => {
      for (const ch of el.children) {
        const tag = ch.nodeName.replace(/^.*:/, '').toLowerCase();
        if (['defs', 'style', 'title', 'desc', 'metadata', 'lineargradient', 'radialgradient', 'clippath', 'mask', 'pattern', 'filter', 'symbol', 'marker'].includes(tag)) continue;
        const st = styleOf(ch, inherited), m = M.mul(ctm, parseTransform(ch.getAttribute('transform')));
        const a = (k, d) => { const v = len(ch.getAttribute(k)); return v == null ? d : v; };
        let l = null;
        switch (tag) {
          case 'g': case 'a': case 'switch': {
            const g = S.Layers.group(null, ch.getAttribute('inkscape:label') || ch.getAttribute('id') || 'Group');
            const op = parseFloat(st.opacity ?? 1); g.opacity = U.clamp(isNaN(op) ? 1 : op, 0, 1);
            if (st.display === 'none' || st.visibility === 'hidden') g.visible = false;
            walk(ch, m, st, g.children);
            if (g.children.length) out.push(g);
            continue;
          }
          case 'rect': { const w = a('width', 0), h = a('height', 0); if (w <= 0 || h <= 0) continue; const rx = a('rx', null), ry = a('ry', null), r = rx ?? ry ?? 0; l = makeShape(r > 0 ? 'roundRect' : 'rect', { x: a('x', 0), y: a('y', 0), w, h, radius: r }, m, st, ch); break; }
          case 'circle': { const r = a('r', 0); if (r <= 0) continue; l = makeShape('ellipse', { x: a('cx', 0) - r, y: a('cy', 0) - r, w: r * 2, h: r * 2 }, m, st, ch); break; }
          case 'ellipse': { const rx = a('rx', 0), ry = a('ry', 0); if (rx <= 0 || ry <= 0) continue; l = makeShape('ellipse', { x: a('cx', 0) - rx, y: a('cy', 0) - ry, w: rx * 2, h: ry * 2 }, m, st, ch); break; }
          case 'line': { const p = { subpaths: [{ closed: false, nodes: [S.Paths.node(a('x1', 0), a('y1', 0)), S.Paths.node(a('x2', 0), a('y2', 0))] }] }; const st2 = Object.assign({}, st, { fill: 'none' }); if (!st2.stroke) st2.stroke = '#000'; l = makeShape('path', { path: p }, m, st2, ch); break; }
          case 'polyline': case 'polygon': { const n = nums(ch.getAttribute('points')); if (n.length < 4) continue; const nodes = []; for (let i = 0; i + 1 < n.length; i += 2) nodes.push(S.Paths.node(n[i], n[i + 1])); const st2 = tag === 'polyline' ? Object.assign({}, st, { fill: st.fill ?? 'none' }) : st; l = makeShape('path', { path: { subpaths: [{ closed: tag === 'polygon', nodes }] } }, m, st2, ch); break; }
          case 'path': { const p = V.parsePathData(ch.getAttribute('d') || ''); if (!p.subpaths.some((sp) => sp.nodes.length > 1)) continue; l = makeShape('path', { path: p }, m, st, ch); break; }
          case 'text': {
            const spans = [...ch.querySelectorAll('tspan')];
            let txt = '';
            if (spans.length) { let lastY = null; for (const sp of spans) { const y = sp.getAttribute('y'); if (txt && (sp.hasAttribute('dy') || (y != null && y !== lastY))) txt += '\n'; txt += sp.textContent; if (y != null) lastY = y; } }
            else txt = ch.textContent;
            txt = txt.replace(/\s+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
            if (!txt) continue;
            const size = len(st['font-size']) || 16, fam = (st['font-family'] || 'sans-serif').split(',')[0].replace(/["']/g, '').trim();
            const first = spans[0] && spans[0].hasAttribute('x') ? spans[0] : ch;
            const x = len(first.getAttribute('x')) || 0, y = len(first.getAttribute('y')) || 0;
            const fo = parseFloat(st['fill-opacity'] ?? 1); const fill = paint(st.fill, isNaN(fo) ? 1 : fo, true);
            const wt = st['font-weight'], weight = wt === 'bold' ? 700 : wt === 'lighter' ? 300 : wt === 'bolder' ? 800 : parseInt(wt, 10) || 400;
            const t = Object.assign(S.Text.defaults(), { text: txt, x, y: y - size * 0.92, font: fam, size, weight, italic: /italic|oblique/.test(st['font-style'] || ''), color: fill.color, align: st['text-anchor'] === 'middle' ? 'center' : st['text-anchor'] === 'end' ? 'right' : 'left' });
            const ls = len(st['letter-spacing']); if (ls) t.tracking = Math.round((ls / size) * 1000);
            if (!M.isIdentity(m)) { if (M.isTranslate(m)) { t.x += m[4]; t.y += m[5]; } else t.matrix = m.slice(); }
            l = S.Layers.text(null, t);
            const nm = ch.getAttribute('inkscape:label') || ch.getAttribute('id'); if (nm) l.name = nm;
            const op = parseFloat(st.opacity ?? 1); l.opacity = U.clamp((isNaN(op) ? 1 : op) * fill.alpha, 0, 1);
            if (st.display === 'none' || st.visibility === 'hidden') l.visible = false;
            break;
          }
          case 'image': {
            const href = ch.getAttribute('href') || ch.getAttribute('xlink:href'); if (!href) continue;
            const w = a('width', 0), h = a('height', 0);
            l = S.Layers.raster(null, ch.getAttribute('id') || 'Image');
            l._svgImage = { href, x: a('x', 0), y: a('y', 0), w, h, m };
            const op = parseFloat(st.opacity ?? 1); l.opacity = U.clamp(isNaN(op) ? 1 : op, 0, 1);
            break;
          }
          default: warn.unsupported.add(tag); continue;
        }
        if (l) out.push(l);
      }
    };
    walk(root, rootM, {}, layers);
    return { width: W, height: H, layers, unsupported: [...warn.unsupported] };
  };
  /** load <image> elements (data URLs / same-origin files) into their raster layers */
  async function resolveImages(layers, d) {
    const pending = [];
    d.walk((l) => { if (l._svgImage) pending.push(l); }, layers);
    for (const l of pending) {
      const im = l._svgImage; delete l._svgImage;
      try {
        const img = await U.loadImage(im.href);
        const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, w = im.w || iw, h = im.h || ih;
        const A = M.mul(im.m, [w / iw, 0, 0, h / ih, im.x, im.y]);
        const corners = [[0, 0], [iw, 0], [iw, ih], [0, ih]].map((p) => M.apply(A, p[0], p[1]));
        const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
        const bx = Math.floor(Math.min(...xs)), by = Math.floor(Math.min(...ys)), bw = Math.max(1, Math.ceil(Math.max(...xs)) - bx), bh = Math.max(1, Math.ceil(Math.max(...ys)) - by);
        const c = U.createCanvas(bw, bh, bx, by), x = c.getContext('2d');
        x.setTransform(A[0], A[1], A[2], A[3], A[4] - bx, A[5] - by); x.drawImage(img, 0, 0); U.resetCtx(c);
        l.canvas = c;
      } catch (e) { l.name += ' (image not loaded)'; }
    }
  }
  /** Open an SVG as a new document, or place its layers (grouped) into `into` */
  V.importSVG = async function (text, name, opts) {
    opts = opts || {};
    const res = V.parseSVG(text);
    if (opts.asLayer && S.app.doc) {
      const d = S.app.doc;
      await resolveImages(res.layers, d);
      const g = S.Layers.group(d, name || 'SVG'); g.children = res.layers;
      d.commit('Place SVG', () => { d.insertLayer(g); d.activeId = g.id; d.selectedIds = new Set([g.id]); });
      if (res.unsupported.length) S.toast('Skipped unsupported SVG elements: ' + res.unsupported.join(', '));
      S.bus.emit('layers:changed', d);
      return g;
    }
    const d = new S.Document({ name: name || 'SVG', width: res.width, height: res.height });
    await resolveImages(res.layers, d);
    d.layers = res.layers;
    if (!d.layers.length) { const l = S.Layers.raster(d, 'Layer 1'); d.layers.push(l); }
    const top = d.layers[d.layers.length - 1]; d.activeId = top.id; d.selectedIds = new Set([top.id]);
    S.App.addDoc(d, 'Open');
    if (res.unsupported.length) S.toast('Skipped unsupported SVG elements: ' + res.unsupported.join(', '));
    return d;
  };

  /* ======================= SVG export ======================= */
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const f = (n) => (Math.abs(n - Math.round(n)) < 1e-6 ? String(Math.round(n)) : (+n.toFixed(3)).toString());
  V.pathData = function (p) {
    let d = '';
    for (const sp of p.subpaths || []) {
      const n = sp.nodes; if (!n.length) continue;
      d += 'M' + f(n[0].x) + ' ' + f(n[0].y);
      const seg = (A, B) => { if (A.ox === A.x && A.oy === A.y && B.ix === B.x && B.iy === B.y) d += 'L' + f(B.x) + ' ' + f(B.y); else d += 'C' + [A.ox, A.oy, B.ix, B.iy, B.x, B.y].map(f).join(' '); };
      for (let i = 1; i < n.length; i++) seg(n[i - 1], n[i]);
      if (sp.closed && n.length > 1) { seg(n[n.length - 1], n[0]); d += 'Z'; }
    }
    return d;
  };
  const BLEND_CSS = { multiply: 1, screen: 1, overlay: 1, darken: 1, lighten: 1, 'color-dodge': 1, 'color-burn': 1, 'hard-light': 1, 'soft-light': 1, difference: 1, exclusion: 1, hue: 1, saturation: 1, color: 1, luminosity: 1 };
  V.exportSVG = function (d, opts) {
    opts = opts || {};
    const defs = []; let gid = 0;
    const paintAttr = (p, lb, what) => {
      if (!p || !p.enabled) return what + '="none"';
      if (!S.Shape.isGradient(p) || !['linear', 'radial', 'reflected'].includes(p.type)) return what + '="' + (p.color || '#000') + '"';
      const id = 'g' + ++gid, stops = (p.stops && p.stops.length >= 2 ? p.stops : S.Shape.gradientDefaults(p.color).stops).slice();
      if (p.reverse) stops.reverse();
      const stopXml = stops.map((s, i) => '<stop offset="' + f(p.reverse ? 1 - s.pos : s.pos) + '" stop-color="' + s.color + '"/>').join('');
      const w = Math.max(1, lb.w), h = Math.max(1, lb.h), sc = (p.scale ?? 100) / 100 || 1, a = ((p.angle ?? 90) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
      const gx = lb.x + w / 2 + ((p.ox || 0) / 100) * w, gy = lb.y + h / 2 + ((p.oy || 0) / 100) * h;
      if (p.type === 'radial') defs.push('<radialGradient id="' + id + '" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(' + f(gx) + ' ' + f(gy) + ') scale(' + f((w / 2) * sc) + ' ' + f((h / 2) * sc) + ')">' + stopXml + '</radialGradient>');
      else {
        const half = ((Math.abs(ca) * w + Math.abs(sa) * h) / 2) * sc;
        const x1 = gx - ca * half, y1 = gy + sa * half, x2 = gx + ca * half, y2 = gy - sa * half;
        defs.push('<linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="' + f(x1) + '" y1="' + f(y1) + '" x2="' + f(x2) + '" y2="' + f(y2) + '"' + (p.type === 'reflected' ? ' spreadMethod="reflect"' : '') + '>' + stopXml + '</linearGradient>');
      }
      return what + '="url(#' + id + ')"';
    };
    const common = (l) => {
      let s = '';
      if (l.opacity < 1) s += ' opacity="' + f(l.opacity) + '"';
      if (!l.visible) s += ' display="none"';
      if (BLEND_CSS[l.blend]) s += ' style="mix-blend-mode:' + l.blend + '"';
      return s + ' data-name="' + esc(l.name) + '"';
    };
    const tr = (m) => (m && !M.isIdentity(m) ? ' transform="matrix(' + m.map(f).join(' ') + ')"' : '');
    const image = (c, extra) => { if (!c || c._empty || !c.width || !c.height) return ''; return '<image x="' + f(c.ox || 0) + '" y="' + f(c.oy || 0) + '" width="' + c.width + '" height="' + c.height + '" href="' + c.toDataURL('image/png') + '"' + (extra || '') + '/>'; };
    const emit = (l, ind) => {
      const pad = '  '.repeat(ind);
      if (l.type === 'group') return pad + '<g' + common(l) + '>\n' + l.children.map((c) => emit(c, ind + 1)).filter(Boolean).join('\n') + '\n' + pad + '</g>';
      if (l.type === 'adjustment') return pad + '<!-- adjustment layer "' + esc(l.name) + '" has no SVG equivalent -->';
      const notes = [];
      if (l.mask) notes.push('layer mask not exported');
      if (l.effects && l.effects.length) notes.push('layer effects not exported');
      const note = notes.length ? ' <!-- ' + notes.join('; ') + ' -->' : '';
      if (l.type === 'shape') {
        const s = l.shape, local = S.Shape.localPath(s), lb = S.Paths.bounds(local), dstr = V.pathData(local), st = s.stroke, strokeOn = st && st.enabled && st.width > 0;
        let attrs = paintAttr(s.fill, lb, 'fill') + ' fill-rule="nonzero" ' + paintAttr(strokeOn ? st : null, lb, 'stroke');
        if (strokeOn) {
          attrs += ' stroke-width="' + f(st.width) + '" stroke-linecap="' + (st.cap || 'round') + '" stroke-linejoin="' + (st.join || 'round') + '"';
          if (st.dash === 'dash') attrs += ' stroke-dasharray="' + f(st.width * 3) + ' ' + f(st.width * 2) + '"'; else if (st.dash === 'dot') attrs += ' stroke-dasharray="0.01 ' + f(st.width * 2) + '" stroke-linecap="round"';
          if (st.align !== 'center') notes.push('stroke aligned ' + st.align + ' exported as centred');
        }
        const inst = S.Shape.instances(s);
        const one = (m) => pad + '<path d="' + dstr + '" ' + attrs + tr(m) + (inst.length === 1 ? common(l) : '') + '/>';
        if (inst.length === 1) return one(inst[0]) + note;
        return pad + '<g' + common(l) + '>' + note + '\n' + inst.map((m) => '  ' + one(m)).join('\n') + '\n' + pad + '</g>';
      }
      if (l.type === 'text') {
        const t = l.text, lay = S.Text.layout(t);
        const font = ' font-family="' + esc(t.font) + '" font-size="' + f(t.size) + '"' + (t.weight && t.weight !== 400 ? ' font-weight="' + t.weight + '"' : '') + (t.italic ? ' font-style="italic"' : '') + ' fill="' + t.color + '"' + (t.tracking ? ' letter-spacing="' + f((t.tracking / 1000) * t.size) + '"' : '') + (t.smallCaps ? ' font-variant="small-caps"' : '') + (t.underline || t.strike ? ' text-decoration="' + [t.underline ? 'underline' : '', t.strike ? 'line-through' : ''].filter(Boolean).join(' ') + '"' : '');
        const disp = t.allCaps ? (t.text || '').toUpperCase() : t.text || '';
        if (lay.curve) {
          const glyphs = lay.curve.glyphs.map((g) => '<text x="0" y="0" transform="translate(' + f(g.x) + ' ' + f(g.y) + ') rotate(' + f((g.rot * 180) / Math.PI) + ')" text-anchor="middle">' + esc(g.ch) + '</text>').join('');
          return pad + '<g' + font + tr(t.matrix) + common(l) + '>' + glyphs + '</g>' + note;
        }
        if (t.warp && t.warp.style && t.warp.style !== 'none') notes.push('text warp exported as the un-warped text');
        const lines = lay.lines.map((L) => '<tspan x="' + f(L.x) + '" y="' + f(L.y) + '"' + (L.ws ? ' word-spacing="' + f(L.ws) + '"' : '') + '>' + esc(disp.slice(L.start, L.end).replace(/\s+$/, '')) + '</tspan>').join('');
        return pad + '<text xml:space="preserve"' + font + tr(t.matrix) + common(l) + '>' + lines + '</text>' + (notes.length ? ' <!-- ' + notes.join('; ') + ' -->' : '');
      }
      // raster / fill / embedded object: embedded PNG
      const c = l.type === 'fill' ? S.Layers.materialize(l, d) : (S.Layers.ensure(l, d), l.canvas);
      return pad + image(c, common(l)) + note;
    };
    const body = d.layers.map((l) => emit(l, 1)).filter(Boolean).join('\n');
    return '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + d.width + '" height="' + d.height + '" viewBox="0 0 ' + d.width + ' ' + d.height + '">\n' +
      '  <!-- exported by Gesso ' + (S.version || '') + ' -->\n' + (defs.length ? '  <defs>' + defs.join('') + '</defs>\n' : '') + body + '\n</svg>\n';
  };
  V.exportSVGFile = async function (d) {
    const svg = V.exportSVG(d), blob = new Blob([svg], { type: 'image/svg+xml' }), name = d.name + '.svg';
    try {
      if (window.showSaveFilePicker) {
        const h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'SVG image', accept: { 'image/svg+xml': ['.svg'] } }] });
        const w = await h.createWritable(); await w.write(blob); await w.close(); S.toast('Exported ' + name); return;
      }
    } catch (e) { if (e.name === 'AbortError') return; console.warn(e); }
    U.downloadBlob(blob, name); S.toast('Exported ' + name);
  };
  S.Cmd.register('file.exportSvg', { label: 'Export as SVG…', run: () => V.exportSVGFile(doc()), enabled: () => !!doc() });
})();
