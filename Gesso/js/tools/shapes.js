/* =========================================================================
   Gesso — Shape tools (rectangle, rounded rectangle, ellipse, polygon, star,
   line/arrow, custom shapes), Pen tool and Direct Selection tool.

   Shape tools create re-editable shape layers (or a work path / pixels,
   depending on the Mode option).  Shift constrains, Alt draws from the centre.
   Pen: click = corner point, click-drag = smooth point, click the first point
   to close, Enter/Esc to finish an open path, Ctrl = temporary direct select.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util, T = S.Tools, P = S.Paths;

  const shapeOpts = () => ({ mode: 'shape', fillOn: true, fill: null, strokeOn: false, stroke: '#1c1916', strokeWidth: 4, dash: 'solid', align: 'center',
    radius: 24, sides: 6, points: 5, inner: 50, lineWidth: 6, arrowStart: false, arrowEnd: false, custom: 'heart',
    fillType: 'solid', fillGrad: null, strokeType: 'solid', strokeGrad: null });

  /** shape params for the active shape layer, or tool options when none */
  function activeShape() { const d = S.app.doc, l = d && d.activeLayer(); return l && l.type === 'shape' ? l : null; }

  /* ---------- paint (solid / gradient) helpers shared by the options bar and the Properties panel ---------- */
  const PAINT_OPTIONS = [{ value: 'solid', label: 'Solid' }, { value: 'linear', label: 'Linear gradient' }, { value: 'radial', label: 'Radial gradient' },
    { value: 'angle', label: 'Angle gradient' }, { value: 'reflected', label: 'Reflected gradient' }, { value: 'diamond', label: 'Diamond gradient' }];
  const PAINT_OPTIONS_SHORT = PAINT_OPTIONS.map((o) => ({ value: o.value, label: o.label.replace(' gradient', '') }));
  const GRAD_KEYS = ['stops', 'angle', 'scale', 'ox', 'oy', 'reverse'];
  /** make sure a paint switched to a gradient type has gradient settings */
  function ensureGradient(p) { if (p.type && p.type !== 'solid') { const d = S.Shape.gradientDefaults(p.color); for (const k of GRAD_KEYS) if (p[k] == null) p[k] = d[k]; } return p; }
  /** ParamUI defs for a gradient paint (used by the popup and by Properties) */
  function gradientDefs(p, prefix) {
    prefix = prefix || '';
    return [
      { id: prefix + 'stops', label: 'Gradient', type: 'gradient', default: p.stops },
      { id: prefix + 'angle', label: 'Angle', type: 'angle', default: p.angle ?? 90 },
      { id: prefix + 'scale', label: 'Scale', type: 'range', default: p.scale ?? 100, min: 10, max: 400, unit: '%' },
      { id: prefix + 'ox', label: 'Offset X', type: 'range', default: p.ox || 0, min: -100, max: 100, unit: '%' },
      { id: prefix + 'oy', label: 'Offset Y', type: 'range', default: p.oy || 0, min: -100, max: 100, unit: '%' },
      { id: prefix + 'reverse', label: 'Reverse', type: 'checkbox', default: !!p.reverse },
    ];
  }
  /** Popup gradient editor. getPaint() returns the paint object to edit in place; live(final) is called after edits */
  function editGradientPopup(title, paint, live, cancel) {
    ensureGradient(paint);
    const vals = {}; for (const k of GRAD_KEYS) vals[k] = JSON.parse(JSON.stringify(paint[k]));
    S.Dialog.form(title, gradientDefs(paint), vals, (v) => { for (const k of GRAD_KEYS) paint[k] = v[k]; live(true); },
      { width: 360, onChange: (v) => { for (const k of GRAD_KEYS) paint[k] = JSON.parse(JSON.stringify(v[k])); live(false); }, onCancel: cancel });
  }
  S.ShapePaint = { PAINT_OPTIONS, GRAD_KEYS, ensureGradient, gradientDefs, editGradientPopup };

  function gradSwatch(bar, paint, onClick, tip) {
    const sw = U.el('button', { class: 'grad-swatch checker', 'data-tip': tip, 'data-tip-pos': 'bottom' });
    sw.appendChild(U.el('div', { style: { background: S.Gradient.css((paint.stops && paint.stops.length >= 2 ? paint.stops : S.Shape.gradientDefaults(paint.color).stops).slice().sort((a, b) => a.pos - b.pos)) } }));
    sw.addEventListener('click', onClick);
    bar.appendChild(sw);
    return sw;
  }

  function shapeOptionsBar(tool, bar) {
    const ui = T.ui, o = tool.opts;
    // new shapes are filled with the foreground colour until a fill colour is picked here
    if (!o.fill || !o.fillCustom) o.fill = S.app.fg;
    ui.select(bar, '', o, 'mode', [{ value: 'shape', label: 'Shape' }, { value: 'path', label: 'Path' }, { value: 'pixels', label: 'Pixels' }]);
    const L = activeShape();
    // fill & stroke edit the active shape layer if there is one, else the defaults for new shapes
    const proxy = L ? { fillOn: L.shape.fill.enabled, fill: L.shape.fill.color, fillType: L.shape.fill.type || 'solid', strokeOn: L.shape.stroke.enabled, stroke: L.shape.stroke.color, strokeType: L.shape.stroke.type || 'solid', strokeWidth: L.shape.stroke.width, dash: L.shape.stroke.dash, align: L.shape.stroke.align } : o;
    const push = (final) => {
      if (!L) return;
      const doc = S.app.doc;
      doc.commit('Shape Properties', () => {
        L.shape.fill.enabled = proxy.fillOn; L.shape.fill.color = proxy.fill; L.shape.fill.type = proxy.fillType; ensureGradient(L.shape.fill);
        L.shape.stroke.enabled = proxy.strokeOn; L.shape.stroke.color = proxy.stroke; L.shape.stroke.type = proxy.strokeType; ensureGradient(L.shape.stroke);
        L.shape.stroke.width = proxy.strokeWidth; L.shape.stroke.dash = proxy.dash; L.shape.stroke.align = proxy.align;
        L.version++;
      }, { key: 'shapeprops-' + L.id });
      void final;
    };
    /** paint object being edited by the gradient popup (layer paint or tool defaults) */
    const paintFor = (which) => {
      if (L) return L.shape[which];
      const key = which + 'Grad';
      if (!o[key]) o[key] = S.Shape.gradientDefaults(which === 'fill' ? o.fill : o.stroke);
      o[key].type = o[which + 'Type']; o[key].color = which === 'fill' ? o.fill : o.stroke;
      return o[key];
    };
    const gradPopup = (which) => {
      const doc = S.app.doc, paint = paintFor(which);
      const before = L ? doc.captureState() : null;
      editGradientPopup((which === 'fill' ? 'Fill' : 'Stroke') + ' Gradient', paint, (final) => {
        if (L) { L.version++; doc.invalidate(); if (final) { doc.pushState('Shape Gradient', before); T.renderOptions(); } }
        else if (final) { T.saveOpts(); T.renderOptions(); }
      }, () => { if (L) { doc.restoreState(before); S.bus.emit('layers:changed', doc); } T.renderOptions(); });
    };
    ui.check(bar, 'Fill', proxy, 'fillOn', () => push(true));
    ui.select(bar, '', proxy, 'fillType', PAINT_OPTIONS_SHORT, () => { push(true); T.renderOptions(); }).classList.add('opt-paint-type');
    if (proxy.fillType && proxy.fillType !== 'solid') gradSwatch(bar, paintFor('fill'), () => gradPopup('fill'), 'Edit fill gradient');
    else ui.color(bar, '', proxy, 'fill', (c, f) => { if (!L) o.fillCustom = true; push(f); });
    ui.check(bar, 'Stroke', proxy, 'strokeOn', () => push(true));
    ui.select(bar, '', proxy, 'strokeType', PAINT_OPTIONS_SHORT, () => { push(true); T.renderOptions(); }).classList.add('opt-paint-type');
    if (proxy.strokeType && proxy.strokeType !== 'solid') gradSwatch(bar, paintFor('stroke'), () => gradPopup('stroke'), 'Edit stroke gradient');
    else ui.color(bar, '', proxy, 'stroke', (c, f) => push(f));
    ui.num(bar, 'W', proxy, 'strokeWidth', 0, 500, { unit: 'px', step: 0.5, onChange: () => push(true) });
    ui.select(bar, '', proxy, 'dash', [{ value: 'solid', label: '─── Solid' }, { value: 'dash', label: '- - - Dashed' }, { value: 'dot', label: '· · · Dotted' }], () => push(true));
    ui.select(bar, '', proxy, 'align', [{ value: 'center', label: 'Center' }, { value: 'inside', label: 'Inside' }, { value: 'outside', label: 'Outside' }], () => push(true));
    if (L && !tool.isPen) { ui.sep(bar); bar.appendChild(U.el('span', { class: 'muted opt-hint' }, 'Editing “' + L.name + '”')); }
  }

  /** paint for a new shape from the tool options (solid colour or the tool's default gradient) */
  function toolPaint(o, which, base) {
    const type = o[which + 'Type'] || 'solid';
    base.type = type;
    if (type !== 'solid') Object.assign(base, JSON.parse(JSON.stringify(o[which + 'Grad'] || S.Shape.gradientDefaults(base.color))), { type, color: base.color });
    return base;
  }

  function makeShapeTool(id, name, icon, kind, extra) {
    return T.register({
      id, name, key: 'U', icon, group: 'shape', cursor: 'crosshair',
      opts: shapeOpts(),
      options(bar) {
        shapeOptionsBar(this, bar);
        T.ui.sep(bar);
        if (!extra) return;
        // geometry fields edit the active shape layer when it is of this kind (the bar says "Editing …"),
        // otherwise they are the defaults for the next shape drawn
        const L = activeShape();
        if (L && L.shape.kind === kind) {
          const sh = L.shape;
          const proxy = { radius: sh.radius, sides: sh.sides, points: sh.points, inner: Math.round((sh.inner ?? 0.5) * 100), lineWidth: sh.lineWidth, arrowStart: sh.arrowStart, arrowEnd: sh.arrowEnd, custom: sh.custom };
          const push = () => {
            const doc = S.app.doc;
            doc.commit('Shape Geometry', () => {
              for (const k of ['radius', 'sides', 'points', 'lineWidth', 'arrowStart', 'arrowEnd', 'custom']) L.shape[k] = proxy[k];
              L.shape.inner = proxy.inner / 100; L.version++;
            }, { key: 'shapegeo-' + L.id });
          };
          extra({ opts: proxy }, bar, push);
        } else extra(this, bar);
      },
      onDown(info, doc) {
        const [x, y] = S.View.snapPoint(info.x, info.y);
        this.drag = { x0: x, y0: y, x1: x, y1: y, before: doc.captureState(), layer: null, moved: false, sx: info.sx, sy: info.sy };
      },
      geometry(info, dd) {
        const d = dd || this.drag;
        let x0 = d.x0, y0 = d.y0, w = d.x1 - d.x0, h = d.y1 - d.y0;
        if (kind === 'line') {
          let x1 = d.x1, y1 = d.y1;
          if (d.shift) { const a = Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 4)) * (Math.PI / 4), l = Math.hypot(x1 - x0, y1 - y0); x1 = x0 + Math.cos(a) * l; y1 = y0 + Math.sin(a) * l; }
          return { x1: x0, y1: y0, x2: x1, y2: y1 };
        }
        if (d.shift) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
        if (d.alt) { x0 -= w; y0 -= h; w *= 2; h *= 2; }
        if (w < 0) { x0 += w; w = -w; } if (h < 0) { y0 += h; h = -h; }
        void info;
        return { x: x0, y: y0, w, h };
      },
      params(info, dd) {
        const o = this.opts, g = this.geometry(info, dd);
        return Object.assign({ kind, radius: o.radius, sides: o.sides, points: o.points, inner: o.inner / 100, lineWidth: o.lineWidth, arrowStart: o.arrowStart, arrowEnd: o.arrowEnd, custom: o.custom,
          fill: toolPaint(o, 'fill', { enabled: kind === 'line' ? true : o.fillOn, color: o.fillCustom && o.fill ? o.fill : S.app.fg }),
          stroke: toolPaint(o, 'stroke', { enabled: kind === 'line' ? false : o.strokeOn, color: o.stroke, width: o.strokeWidth, align: o.align, dash: o.dash, cap: 'round', join: 'round' }) }, g);
      },
      onMove(info, doc) {
        const d = this.drag; if (!d) return;
        const [x, y] = S.View.snapDragPoint(info.x, info.y, d.x0, d.y0);
        d.x1 = x; d.y1 = y; d.shift = info.shift; d.alt = info.alt;
        if (!d.moved && Math.hypot(info.sx - d.sx, info.sy - d.sy) < 3) return;
        d.moved = true;
        if (this.opts.mode === 'shape') {
          const s = this.params(info);
          if (!d.layer) { d.layer = S.Layers.shape(doc, s); doc.insertLayer(d.layer); doc.setActive(d.layer.id); }
          else { d.layer.shape = Object.assign(d.layer.shape, s); d.layer.version++; }
          doc.invalidate();
        }
      },
      onUp(info, doc) {
        const d = this.drag; this.drag = null;
        if (!d || !d.moved) { if (d && !d.moved) this.clickDialog(doc, d); return; }
        const s = this.params(info, d);
        if (this.opts.mode === 'shape') { doc.pushState('New ' + name, d.before); }
        else if (this.opts.mode === 'path') {
          doc.commit(name + ' Path', () => {
            let p = doc.paths.find((q) => q.id === doc.activePathId);
            if (!p) { p = { id: U.uid('path'), name: 'Work Path', path: P.empty() }; doc.paths.push(p); doc.activePathId = p.id; }
            p.path.subpaths.push(...S.Shape.toPath(s).subpaths);
          });
          S.bus.emit('paths:changed', doc);
        } else {
          const t = doc.paintTarget();
          if (!t || t.kind === 'invalid') { S.toast('Select a pixel layer to draw pixels'); return; }
          const c = U.createCanvas(doc.width, doc.height);
          S.Shape.render(c.getContext('2d'), s);
          S.paintCanvasOnto(doc, t, c, 1, 'normal', name);
        }
        S.Tools.renderOptions();
      },
      clickDialog(doc, d) {
        // click without dragging: numeric size dialog
        if (this.opts.mode !== 'shape') return;
        S.Dialog.form('Create ' + name, [{ id: 'w', label: 'Width', type: 'number', default: 200, min: 1, max: 30000, unit: 'px' }, { id: 'h', label: 'Height', type: 'number', default: 200, min: 1, max: 30000, unit: 'px' }], {}, (v) => {
          this.drag = { x0: d.x0, y0: d.y0, x1: d.x0 + v.w, y1: d.y0 + v.h, moved: true };
          const s = this.params({});
          this.drag = null;
          doc.commit('New ' + name, () => { const l = S.Layers.shape(doc, s); doc.insertLayer(l); doc.activeId = l.id; doc.selectedIds = new Set([l.id]); });
          S.bus.emit('activeLayer:changed', doc);
        });
      },
      onKey(e, doc) { if (e.key === 'Escape' && this.drag) { if (this.drag.layer) doc.restoreState(this.drag.before); this.drag = null; return true; } return false; },
      drawOverlay(ctx, doc) {
        const d = this.drag;
        if (!d || !d.moved || this.opts.mode === 'shape') return;
        const p2 = P.toPath2D(S.Shape.toPath(this.params({})), (x, y) => S.View.toScreen(x, y, doc));
        ctx.strokeStyle = '#3dbfae'; ctx.lineWidth = 1.2; ctx.stroke(p2);
      },
    });
  }
  makeShapeTool('rect', 'Rectangle', 'rect', 'rect');
  makeShapeTool('roundRect', 'Rounded Rectangle', 'roundRect', 'roundRect', (t, bar, ch) => T.ui.num(bar, 'Radius', t.opts, 'radius', 0, 2000, { unit: 'px', onChange: ch }));
  makeShapeTool('ellipse', 'Ellipse', 'ellipse', 'ellipse');
  makeShapeTool('polygon', 'Polygon', 'polygon', 'polygon', (t, bar, ch) => T.ui.num(bar, 'Sides', t.opts, 'sides', 3, 100, { onChange: ch }));
  makeShapeTool('star', 'Star', 'star', 'star', (t, bar, ch) => { T.ui.num(bar, 'Points', t.opts, 'points', 3, 100, { onChange: ch }); T.ui.num(bar, 'Inner', t.opts, 'inner', 5, 95, { unit: '%', onChange: ch }); });
  makeShapeTool('line', 'Line', 'line', 'line', (t, bar, ch) => {
    T.ui.num(bar, 'Weight', t.opts, 'lineWidth', 1, 500, { unit: 'px', onChange: ch });
    T.ui.check(bar, 'Arrow start', t.opts, 'arrowStart', ch); T.ui.check(bar, 'Arrow end', t.opts, 'arrowEnd', ch);
  });
  makeShapeTool('customShape', 'Custom Shape', 'heart', 'custom', (t, bar, ch) => {
    T.ui.select(bar, 'Shape', t.opts, 'custom', Object.keys(P.CUSTOM).map((k) => ({ value: k, label: P.CUSTOM[k].label })), ch);
  });

  /* ======================= Pen ======================= */
  function activePath(doc, create) {
    let p = doc.paths.find((q) => q.id === doc.activePathId);
    if (!p && create) { p = { id: U.uid('path'), name: 'Work Path', path: P.empty() }; doc.paths.push(p); doc.activePathId = p.id; S.bus.emit('paths:changed', doc); }
    return p;
  }
  /** what the pen/direct-select edits: {path, set(path), kind} */
  function editTarget(doc, preferShape) {
    const l = doc.activeLayer();
    if (preferShape && l && l.type === 'shape') {
      // node editing works on the (matrix-applied) outline of the base copy and turns it into a plain path
      return { kind: 'shape', layer: l, get: () => S.Shape.editPath(l.shape), set: (p) => { l.shape.kind = 'path'; l.shape.matrix = null; l.shape.path = p; l.version++; doc.invalidate(); } };
    }
    const ap = activePath(doc, false);
    if (ap) return { kind: 'path', get: () => ap.path, set: (p) => { ap.path = p; S.bus.emit('paths:changed', doc); } };
    if (l && l.type === 'shape') return editTarget(doc, true);
    return null;
  }

  T.register({
    id: 'pen', name: 'Pen', key: 'P', icon: 'pen', group: 'pen', cursor: 'crosshair', isPen: true, showPaths: true,
    opts: Object.assign(shapeOpts(), { mode: 'path', autoAddDelete: true, rubber: true }),
    options(bar) {
      const ui = T.ui, o = this.opts;
      ui.select(bar, '', o, 'mode', [{ value: 'path', label: 'Path' }, { value: 'shape', label: 'Shape' }], () => T.renderOptions());
      if (o.mode === 'shape') shapeOptionsBar(this, bar);
      ui.check(bar, 'Auto add/delete', o, 'autoAddDelete');
      ui.sep(bar);
      ui.button(bar, 'Selection', () => S.Cmd.run('path.toSelection'), { tip: 'Make selection from path' });
      ui.button(bar, 'Shape', () => S.Cmd.run('path.toShape'), { tip: 'Make shape layer from path' });
      ui.button(bar, 'Fill', () => S.Cmd.run('path.fill'));
      ui.button(bar, 'Stroke', () => S.Cmd.run('path.stroke'));
    },
    activate() { this.cur = null; },
    deactivate() { this.finish(); },
    get selectedNode() { return this.cur ? { sp: this.cur.sp, i: this.cur.nodes() - 1 } : null; },
    get editTarget() { return this.cur ? this.cur.kind : null; },
    target(doc) {
      if (this.opts.mode === 'shape') {
        if (this.cur && this.cur.layer) return editTarget(doc, true);
        return null;
      }
      return { kind: 'path', path: activePath(doc, true) };
    },
    onDown(info, doc) {
      if (info.ctrl) { const ds = T.byId.directSelect; this._ds = true; ds.onDown(info, doc); return; }
      const [x, y] = S.View.snapPoint(info.x, info.y);
      const before = doc.captureState();
      // obtain path being edited
      let getP, setP, kind;
      if (this.opts.mode === 'shape') {
        let l = this.cur && this.cur.layer;
        if (!l || !doc.findLayer(l.id)) {
          const o = this.opts;
          l = S.Layers.shape(doc, { kind: 'path', path: P.empty(), fill: toolPaint(o, 'fill', { enabled: o.fillOn, color: o.fillCustom && o.fill ? o.fill : S.app.fg }), stroke: toolPaint(o, 'stroke', { enabled: o.strokeOn, color: o.stroke, width: o.strokeWidth, align: o.align, dash: o.dash, cap: 'round', join: 'round' }) });
          doc.insertLayer(l); doc.setActive(l.id);
          this.cur = null;
        }
        // a shape that was transformed meanwhile: bake its matrix so new anchors land where they are clicked
        if (l.shape.matrix) { l.shape.path = S.Shape.editPath(l.shape); l.shape.matrix = null; }
        getP = () => l.shape.path; setP = (p) => { l.shape.path = p; l.version++; doc.invalidate(); }; kind = 'shape';
        this._layer = l;
      } else {
        const ap = activePath(doc, true);
        getP = () => ap.path; setP = (p) => { ap.path = p; S.bus.emit('paths:changed', doc); }; kind = 'path';
        this._layer = null;
      }
      const path = P.clone(getP());
      const tol = 7 / doc.view.zoom;
      if (this.cur && this.cur.kind === kind) {
        const sp = path.subpaths[this.cur.sp];
        if (sp && sp.nodes.length > 1 && !sp.closed) {
          const f = sp.nodes[0];
          if (Math.hypot(f.x - x, f.y - y) < tol) {
            sp.closed = true; setP(path);
            this.drag = { before, getP, setP, sp: this.cur.sp, i: 0, closing: true, x0: x, y0: y };
            this.finishAfter = true;
            return;
          }
        }
      } else if (this.opts.autoAddDelete) {
        // add / delete anchors on existing path when not drawing
        const hit = P.hitTest(path, x, y, tol);
        if (hit && hit.part === 'anchor') {
          const sp = path.subpaths[hit.sp];
          sp.nodes.splice(hit.i, 1);
          if (!sp.nodes.length) path.subpaths.splice(hit.sp, 1);
          setP(path); doc.pushState('Delete Anchor', before); return;
        }
        const seg = P.nearestSegment(path, x, y);
        if (seg && seg.d < tol) {
          const sp = path.subpaths[seg.sp], A = sp.nodes[seg.i], B = sp.nodes[(seg.i + 1) % sp.nodes.length];
          const s = P.splitSegment(A, B, seg.t);
          A.ox = s.a[0]; A.oy = s.a[1]; B.ix = s.c[0]; B.iy = s.c[1];
          sp.nodes.splice(seg.i + 1, 0, { x: s.f[0], y: s.f[1], ix: s.d[0], iy: s.d[1], ox: s.e[0], oy: s.e[1] });
          setP(path); doc.pushState('Add Anchor', before); return;
        }
      }
      // add a new anchor
      let spIndex;
      if (this.cur && this.cur.kind === kind && path.subpaths[this.cur.sp] && !path.subpaths[this.cur.sp].closed) spIndex = this.cur.sp;
      else { path.subpaths.push({ closed: false, nodes: [] }); spIndex = path.subpaths.length - 1; }
      path.subpaths[spIndex].nodes.push(P.node(x, y));
      setP(path);
      this.cur = { kind, sp: spIndex, layer: this._layer, nodes: () => { const p = getP(); return p.subpaths[spIndex] ? p.subpaths[spIndex].nodes.length : 0; } };
      this.drag = { before, getP, setP, sp: spIndex, i: path.subpaths[spIndex].nodes.length - 1, x0: x, y0: y };
    },
    onMove(info, doc) {
      if (this._ds) { T.byId.directSelect.onMove(info, doc); return; }
      const d = this.drag; if (!d) return;
      const path = P.clone(d.getP());
      const sp = path.subpaths[d.sp]; if (!sp) return;
      const n = sp.nodes[d.i];
      let hx = info.x, hy = info.y;
      if (info.shift) { const a = Math.round(Math.atan2(hy - n.y, hx - n.x) / (Math.PI / 4)) * (Math.PI / 4), l = Math.hypot(hx - n.x, hy - n.y); hx = n.x + Math.cos(a) * l; hy = n.y + Math.sin(a) * l; }
      if (Math.hypot(hx - n.x, hy - n.y) * doc.view.zoom < 2) return;
      n.ox = hx; n.oy = hy;
      if (!info.alt) { n.ix = 2 * n.x - hx; n.iy = 2 * n.y - hy; }
      if (d.closing) { n.ix = 2 * n.x - hx; n.iy = 2 * n.y - hy; n.ox = hx; n.oy = hy; [n.ix, n.iy, n.ox, n.oy] = [n.ix, n.iy, n.ox, n.oy]; }
      d.setP(path);
    },
    onUp(info, doc) {
      if (this._ds) { this._ds = false; T.byId.directSelect.onUp(info, doc); return; }
      const d = this.drag; this.drag = null;
      if (!d) return;
      doc.pushState(d.closing ? 'Close Path' : 'Pen Anchor', d.before);
      if (this.finishAfter) { this.finishAfter = false; this.finish(); }
    },
    finish() { this.cur = null; S.View.redraw(); },
    onKey(e) {
      if ((e.key === 'Enter' || e.key === 'Escape') && this.cur) { this.finish(); return true; }
      return false;
    },
    onHover() { if (this.cur) S.View.redraw(); },
    drawOverlay(ctx, doc) {
      // rubber band from last anchor to mouse
      if (!this.cur || this.drag) return;
      const t = this.cur.kind === 'shape' && this.cur.layer ? S.Shape.editPath(this.cur.layer.shape) : (activePath(doc, false) || {}).path;
      const sp = t && t.subpaths[this.cur.sp]; if (!sp || !sp.nodes.length || sp.closed) return;
      const n = sp.nodes[sp.nodes.length - 1];
      const [ax, ay] = S.View.toScreen(n.x, n.y), [cx, cy] = S.View.toScreen(n.ox, n.oy);
      ctx.strokeStyle = 'rgba(61,191,174,.7)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.bezierCurveTo(cx, cy, S.View.mouse.sx, S.View.mouse.sy, S.View.mouse.sx, S.View.mouse.sy); ctx.stroke(); ctx.setLineDash([]);
      void doc;
    },
  });

  /* ======================= Direct selection ======================= */
  T.register({
    id: 'directSelect', name: 'Node Selection', key: 'A', icon: 'directSelect', group: 'pathsel', cursor: 'default', showPaths: true,
    opts: {},
    selectedNode: null, editTarget: null,
    options(bar) {
      bar.appendChild(U.el('span', { class: 'muted opt-hint' }, 'Drag anchors or handles of the active path or shape layer · Alt-drag a handle to break symmetry · Delete removes the selected anchor'));
      T.ui.sep(bar);
      T.ui.button(bar, 'Convert to corner', () => this.convert(false));
      T.ui.button(bar, 'Convert to smooth', () => this.convert(true));
    },
    pickTarget(doc, x, y, tol) {
      // prefer whichever of (active shape, active path) has a hit
      const cands = [];
      const l = doc.activeLayer();
      if (l && l.type === 'shape') cands.push(editTarget(doc, true));
      const ap = activePath(doc, false);
      if (ap) cands.push({ kind: 'path', get: () => ap.path, set: (p) => { ap.path = p; S.bus.emit('paths:changed', doc); } });
      for (const c of cands) { const h = P.hitTest(c.get(), x, y, tol); if (h) return { t: c, h }; }
      return cands.length ? { t: cands[0], h: null } : null;
    },
    onDown(info, doc) {
      const tol = 7 / doc.view.zoom;
      const r = this.pickTarget(doc, info.x, info.y, tol);
      if (!r) return;
      this.editTarget = r.t.kind;
      if (!r.h) {
        // drag a whole subpath when clicking on its segment
        const seg = P.nearestSegment(r.t.get(), info.x, info.y);
        if (seg && seg.d < tol) { this.drag = { t: r.t, whole: seg.sp, x0: info.x, y0: info.y, path0: P.clone(r.t.get()), before: doc.captureState() }; return; }
        this.selectedNode = null; S.View.redraw(); return;
      }
      this.selectedNode = { sp: r.h.sp, i: r.h.i };
      this.drag = { t: r.t, h: r.h, x0: info.x, y0: info.y, path0: P.clone(r.t.get()), before: doc.captureState() };
    },
    onMove(info) {
      const d = this.drag; if (!d) return;
      let dx = info.x - d.x0, dy = info.y - d.y0;
      const path = P.clone(d.path0);
      if (d.whole != null) {
        for (const n of path.subpaths[d.whole].nodes) { n.x += dx; n.y += dy; n.ix += dx; n.iy += dy; n.ox += dx; n.oy += dy; }
        d.t.set(path); d.moved = true; return;
      }
      const n = path.subpaths[d.h.sp].nodes[d.h.i], n0 = d.path0.subpaths[d.h.sp].nodes[d.h.i];
      if (d.h.part === 'anchor') {
        const [sx, sy] = S.View.snapPoint(n0.x + dx, n0.y + dy); dx = sx - n0.x; dy = sy - n0.y;
        n.x = n0.x + dx; n.y = n0.y + dy; n.ix = n0.ix + dx; n.iy = n0.iy + dy; n.ox = n0.ox + dx; n.oy = n0.oy + dy;
      } else {
        const key = d.h.part === 'in' ? ['ix', 'iy'] : ['ox', 'oy'], other = d.h.part === 'in' ? ['ox', 'oy'] : ['ix', 'iy'];
        n[key[0]] = n0[key[0]] + dx; n[key[1]] = n0[key[1]] + dy;
        // keep smooth points symmetric (collinear) unless Alt
        const wasSmooth = Math.abs((n0.ix - n0.x) * (n0.oy - n0.y) - (n0.iy - n0.y) * (n0.ox - n0.x)) < 1 && (n0.ix !== n0.x || n0.iy !== n0.y) && (n0.ox !== n0.x || n0.oy !== n0.y);
        if (wasSmooth && !info.alt) {
          const lo = Math.hypot(n0[other[0]] - n0.x, n0[other[1]] - n0.y), vx = n[key[0]] - n.x, vy = n[key[1]] - n.y, l = Math.hypot(vx, vy) || 1;
          n[other[0]] = n.x - (vx / l) * lo; n[other[1]] = n.y - (vy / l) * lo;
        }
      }
      d.t.set(path); d.moved = true;
    },
    onUp(info, doc) {
      const d = this.drag; this.drag = null;
      if (d && d.moved) doc.pushState('Edit Path', d.before);
    },
    convert(smooth) {
      const doc = S.app.doc; if (!doc || !this.selectedNode) return;
      const r = editTarget(doc, this.editTarget === 'shape'); if (!r) return;
      doc.commit(smooth ? 'Smooth Anchor' : 'Corner Anchor', () => {
        const p = P.clone(r.get()); const sp = p.subpaths[this.selectedNode.sp]; if (!sp) return;
        const n = sp.nodes[this.selectedNode.i]; if (!n) return;
        if (!smooth) { n.ix = n.x; n.iy = n.y; n.ox = n.x; n.oy = n.y; }
        else {
          const prev = sp.nodes[(this.selectedNode.i - 1 + sp.nodes.length) % sp.nodes.length], next = sp.nodes[(this.selectedNode.i + 1) % sp.nodes.length];
          const vx = next.x - prev.x, vy = next.y - prev.y, k = 0.25;
          n.ix = n.x - vx * k; n.iy = n.y - vy * k; n.ox = n.x + vx * k; n.oy = n.y + vy * k;
        }
        r.set(p);
      });
    },
    onKey(e, doc) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedNode) {
        const r = editTarget(doc, this.editTarget === 'shape'); if (!r) return false;
        doc.commit('Delete Anchor', () => {
          const p = P.clone(r.get()); const sp = p.subpaths[this.selectedNode.sp];
          if (sp) { sp.nodes.splice(this.selectedNode.i, 1); if (sp.nodes.length < 2) p.subpaths.splice(this.selectedNode.sp, 1); }
          r.set(p);
        });
        this.selectedNode = null;
        return true;
      }
      return false;
    },
  });
})();
/* keep the shape options bar in step with the active shape layer (selection changes, undo, Properties edits) */
(function () {
  'use strict';
  const S = window.Gesso, T = S.Tools;
  let down = false;
  addEventListener('pointerdown', () => { down = true; }, true);
  addEventListener('pointerup', () => { down = false; }, true);
  const isShapeTool = () => { const t = S.app.tool; return t && (t.group === 'shape' || (t.isPen && t.opts.mode === 'shape')); };
  const refresh = S.util.debounce(() => {
    if (!isShapeTool()) return;
    const ob = document.getElementById('optionsbar');
    if (down || (ob && ob.contains(document.activeElement)) || S.Dialog.isOpen()) { refresh(); return; }
    T.renderOptions();
  }, 250);
  S.bus.on('activeLayer:changed', () => { if (isShapeTool()) T.renderOptions(); });
  // the default fill follows the foreground colour (until a custom fill colour is chosen in the options bar)
  S.bus.on('color:changed', () => {
    for (const t of T.list) if ((t.group === 'shape' || t.isPen) && !t.opts.fillCustom) t.opts.fill = S.app.fg;
    if (isShapeTool()) T.syncOptions();
  });
  S.bus.on('history:changed', refresh);
})();
