/* =========================================================================
   Gesso — Properties panel (context sensitive) and Adjustments panel.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util;

  /* Adjustment ids shown in the Adjustments panel / menus (auto ones excluded) */
  S.ADJ_ORDER = ['brightnessContrast', 'levels', 'curves', 'exposure', 'vibrance', 'hueSaturation', 'colorBalance', 'blackWhite', 'photoFilter', 'channelMixer', 'temperatureTint', 'invert', 'posterize', 'threshold', 'gradientMap', 'selectiveColor', 'shadowsHighlights', 'filmLooks'];
  S.adjList = function () {
    const A = (window.ImageFX && ImageFX.adjustments) || {};
    const ids = S.ADJ_ORDER.filter((id) => A[id]);
    for (const id in A) if (!ids.includes(id) && !/^auto|desaturate/.test(id)) ids.push(id);
    return ids.map((id) => A[id]);
  };
  const ADJ_ICON = { brightnessContrast: 'aBC', levels: 'aLevels', curves: 'aCurves', exposure: 'aExposure', vibrance: 'aVibrance', hueSaturation: 'aHueSat', colorBalance: 'aBalance', blackWhite: 'aBW', photoFilter: 'aPhoto', channelMixer: 'aMixer', temperatureTint: 'aTemp', invert: 'aInvert', posterize: 'aPoster', threshold: 'aThreshold', gradientMap: 'aGradMap', selectiveColor: 'aSelective', shadowsHighlights: 'aSH', filmLooks: 'aFilm' };
  S.ADJ_ICON = ADJ_ICON;

  S.Panels.register({
    id: 'adjustments', title: 'Adjustments', icon: 'adjust', events: [],
    build(body) {
      body.appendChild(U.el('div', { class: 'muted panel-hint' }, 'Add a non-destructive adjustment layer'));
      const grid = U.el('div', { class: 'adj-grid' });
      for (const fx of S.adjList()) {
        const b = U.el('button', { class: 'adj-btn', title: fx.name }, [U.el('span', { class: 'adj-glyph', html: S.icon(ADJ_ICON[fx.id] || 'adjust') }), U.el('span', { class: 'adj-name' }, fx.name)]);
        b.addEventListener('click', () => { if (!S.app.doc) return S.toast('Create or open a document first'); S.Cmd.run('layer.newAdjustment', fx.id); });
        grid.appendChild(b);
      }
      body.appendChild(grid);
      body.appendChild(U.el('div', { class: 'muted panel-hint', style: { marginTop: '10px' } }, 'Fill layers'));
      const g2 = U.el('div', { class: 'adj-grid' });
      for (const [lab, cmd, gl] of [['Solid Color', 'layer.newFillSolid', 'fill'], ['Gradient', 'layer.newFillGradient', 'gLinear']]) {
        const b = U.el('button', { class: 'adj-btn' }, [U.el('span', { class: 'adj-glyph', html: S.icon(gl) }), U.el('span', { class: 'adj-name' }, lab)]);
        b.addEventListener('click', () => S.Cmd.run(cmd)); g2.appendChild(b);
      }
      body.appendChild(g2);
      return {};
    },
  });

  /* ======================= Properties ======================= */
  S.Panels.register({
    id: 'properties', title: 'Properties', icon: 'sliders',
    events: ['activeLayer:changed', 'doc:switched', 'history:changed', 'layers:changed', 'doc:resized'],
    build(body) {
      let before = null, selfChange = false, lastKey = '';
      const live = (doc, name, mutate, final) => {
        if (!before) before = doc.captureState();
        mutate();
        doc.invalidate(); S.View.redraw();
        if (final) { selfChange = true; doc.pushState(name, before); before = null; selfChange = false; }
      };
      const section = (title, content, extra) => {
        const head = U.el('div', { class: 'prop-head' }, [U.el('span', {}, title), U.el('div', { style: { flex: 1 } }), extra || null]);
        return U.el('div', { class: 'prop-section' }, [head, content]);
      };
      const btn = (label, fn, icon) => { const b = U.el('button', { class: 'btn btn-sm', html: icon ? S.icon(icon) + '<span>' + label + '</span>' : null }, icon ? null : label); b.addEventListener('click', fn); return b; };

      /* ---------- Blend If: split sliders for this layer / the underlying layers ---------- */
      const dragPtr = (e, move, up) => {
        const x0 = e.clientX, y0 = e.clientY;
        const mv = (ev) => move(ev.clientX - x0, ev.clientY - y0, ev);
        const end = (ev) => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); if (up) up(ev); };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
      };
      function blendIfSection(doc, l) {
        const bi = l.blendIf || { on: false, channel: 'gray', t: [0, 0, 255, 255], u: [0, 0, 255, 255] };
        const wrap = U.el('div', { class: 'blendif' });
        const on = U.el('input', { type: 'checkbox', checked: !!bi.on });
        const chan = U.el('select', {}, [['gray', 'Gray'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']].map((o) => U.el('option', { value: o[0] }, o[1]))); chan.value = bi.channel || 'gray';
        const set = (mut, final, name) => live(doc, name || 'Blend If', () => { l.blendIf = Object.assign({ on: true, channel: 'gray', t: [0, 0, 255, 255], u: [0, 0, 255, 255] }, l.blendIf || {}); mut(l.blendIf); l.version++; }, final);
        on.addEventListener('change', () => set((b) => { b.on = on.checked; }, true));
        chan.addEventListener('change', () => set((b) => { b.channel = chan.value; }, true));
        const slider = (label, key) => {
          const row = U.el('div', { class: 'bi-row' }), track = U.el('div', { class: 'bi-track' }), vals = (l.blendIf && l.blendIf[key]) || [0, 0, 255, 255];
          const readout = U.el('span', { class: 'bi-vals muted' });
          const hs = [0, 1, 2, 3].map((k) => U.el('div', { class: 'bi-handle' + (k < 2 ? ' lo' : ' hi') + (k === 0 || k === 3 ? ' outer' : ''), title: 'Drag · Alt-drag splits the handle for a soft edge' }));
          const place = (v) => { hs.forEach((h, k) => { h.style.left = (v[k] / 255 * 100) + '%'; }); readout.textContent = (v[0] === v[1] ? v[0] : v[0] + '/' + v[1]) + '  ·  ' + (v[2] === v[3] ? v[2] : v[2] + '/' + v[3]); };
          place(vals);
          hs.forEach((h, k) => h.addEventListener('pointerdown', (e) => {
            e.preventDefault(); e.stopPropagation();
            const cur = ((l.blendIf && l.blendIf[key]) || [0, 0, 255, 255]).slice(), rect = track.getBoundingClientRect(), split = e.altKey, start = cur.slice();
            dragPtr(e, (dx) => {
              const dv = Math.round(dx / rect.width * 255);
              const v = start.slice();
              const pair = k < 2 ? [0, 1] : [2, 3];
              if (split) v[k] = U.clamp(start[k] + dv, 0, 255);
              else pair.forEach((q) => { v[q] = U.clamp(start[q] + dv, 0, 255); });
              // keep the pairs ordered: lo1 ≤ lo2 ≤ hi1 ≤ hi2
              v[0] = Math.min(v[0], v[1]); v[1] = Math.max(v[0], v[1]); v[2] = Math.max(v[2], v[1]); v[3] = Math.max(v[3], v[2]); if (v[1] > v[2]) { if (k < 2) v[1] = v[2]; else v[2] = v[1]; } v[0] = Math.min(v[0], v[1]);
              set((b) => { b[key] = v; b.on = true; }, false); place(v); on.checked = true;
            }, () => set((b) => { b[key] = (b[key] || start).slice(); }, true));
          }));
          const grad = U.el('div', { class: 'bi-grad' });
          track.append(grad, ...hs);
          row.append(U.el('div', { class: 'bi-label' }, [U.el('span', {}, label), readout]), track);
          return row;
        };
        const head = U.el('div', { class: 'bi-head' }, [U.el('label', { class: 'check-row' }, [on, U.el('span', {}, 'Enabled')]), U.el('div', { style: { flex: 1 } }), U.el('span', { class: 'muted' }, 'Channel'), chan]);
        wrap.append(head, slider('This Layer', 't'), slider('Underlying', 'u'), U.el('div', { class: 'muted panel-hint' }, 'Hides this layer where its own pixels (This Layer) or the layers below (Underlying) fall outside the range. Alt-drag a handle to split it and feather the edge.'));
        return section('Blend If', wrap);
      }

      function maskSection(doc, l) {
        const m = l.mask;
        const defs = [
          { id: 'density', label: 'Density', type: 'range', default: Math.round((m.density ?? 1) * 100), min: 0, max: 100, unit: '%' },
          { id: 'feather', label: 'Feather', type: 'range', default: m.feather || 0, min: 0, max: 250, step: 0.5, unit: 'px' },
        ];
        const ui = S.ParamUI.build(defs, {}, (v, id, final) => live(doc, 'Mask ' + (id === 'density' ? 'Density' : 'Feather'), () => { l.mask.density = v.density / 100; l.mask.feather = v.feather; l.version++; }, final));
        const row = U.el('div', { class: 'prop-btns' }, [
          btn('Invert', () => S.Cmd.run('layer.maskInvert')), btn('Select', () => S.Cmd.run('layer.maskToSel')),
          btn(m.enabled === false ? 'Enable' : 'Disable', () => S.Cmd.run('layer.maskToggle')),
          l.type !== 'adjustment' ? btn('Apply', () => S.Cmd.run('layer.maskApply')) : null, btn('Delete', () => S.Cmd.run('layer.maskDelete')),
        ]);
        const edit = U.el('label', { class: 'check-row' }, [U.el('input', { type: 'checkbox', checked: !!l.editMask, onchange: (e) => { l.editMask = e.target.checked; S.bus.emit('activeLayer:changed', doc); } }), U.el('span', {}, 'Paint on mask (brushes edit the mask)')]);
        return section('Layer Mask', U.el('div', {}, [edit, ui, row]));
      }

      function textSection(doc, l) {
        const t = l.text;
        const ta = U.el('textarea', { class: 'prop-text', rows: 3 });
        ta.value = t.text;
        ta.addEventListener('keydown', (e) => e.stopPropagation());
        ta.addEventListener('input', () => live(doc, 'Edit Text', () => { t.text = ta.value; l.name = (ta.value.split('\n')[0] || 'Text').slice(0, 30); l.version++; }, false));
        ta.addEventListener('change', () => live(doc, 'Edit Text', () => {}, true));
        const fonts = S.Text.FONTS.concat(S.Text.extraFonts || []);
        if (!fonts.includes(t.font)) fonts.unshift(t.font);
        const defs = [
          { id: 'font', label: 'Font', type: 'select', default: t.font, options: fonts },
          { id: 'weight', label: 'Weight', type: 'select', default: t.weight, options: [100, 300, 400, 500, 600, 700, 900].map((w) => ({ value: w, label: String(w) })) },
          { id: 'size', label: 'Size', type: 'range', default: t.size, min: 1, max: 600, unit: 'px' },
          { id: 'color', label: 'Color', type: 'color', default: t.color },
          { id: 'align', label: 'Align', type: 'select', default: t.align, options: [{ value: 'left', label: 'left' }, { value: 'center', label: 'center' }, { value: 'right', label: 'right' }, { value: 'justify', label: 'justify (paragraph text)' }] },
          { id: 'leading', label: 'Leading', type: 'range', default: t.leading || 0, min: 0, max: 800, unit: 'px' },
          { id: 'tracking', label: 'Tracking', type: 'range', default: t.tracking || 0, min: -200, max: 1000 },
          { id: 'italic', label: 'Italic', type: 'checkbox', default: !!t.italic },
          { id: 'underline', label: 'Underline', type: 'checkbox', default: !!t.underline },
          { id: 'strike', label: 'Strikethrough', type: 'checkbox', default: !!t.strike },
          { id: 'allCaps', label: 'All caps', type: 'checkbox', default: !!t.allCaps },
          { id: 'smallCaps', label: 'Small caps', type: 'checkbox', default: !!t.smallCaps },
        ];
        if (t.box) defs.push({ id: 'boxW', label: 'Box width', type: 'number', default: Math.round(t.box.w), min: 4, unit: 'px' }, { id: 'boxH', label: 'Box height', type: 'number', default: Math.round(t.box.h), min: 4, unit: 'px' });
        const ui = S.ParamUI.build(defs, {}, (v, id, final) => live(doc, 'Text Properties', () => {
          if (id === 'boxW' || id === 'boxH') t.box = { w: v.boxW, h: v.boxH }; else t[id] = v[id];
          l.version++;
        }, final));
        // rotation (about the text's centre) — stored in the text matrix, so the text stays editable
        const bb = S.Text.layout(t).bbox, A = S.Affine;
        const curRot = t.matrix ? +(A.decompose(t.matrix).rot * 180 / Math.PI).toFixed(2) : 0;
        const rotUI = S.ParamUI.build([{ id: 'rotation', label: 'Rotation', type: 'number', default: curRot, min: -360, max: 360, step: 0.1, unit: '°' }], {}, (v, id, final) => live(doc, 'Rotate Text', () => {
          const c = A.apply(t.matrix || A.I(), bb.x + bb.w / 2, bb.y + bb.h / 2);
          t.matrix = rotateMatrixTo(t.matrix, v.rotation, c[0], c[1]);
          if (A.isIdentity(t.matrix)) t.matrix = null;
          l.version++;
        }, final));
        const row = U.el('div', { class: 'prop-btns' }, [btn('Edit on canvas', () => S.TextTool.editLayer(l)), btn('Rasterize', () => S.Cmd.run('layer.rasterize')),
          t.matrix ? btn('Reset transform', () => S.app.doc.commit('Reset Text Transform', () => { t.matrix = null; l.version++; })) : null,
          t.curve ? null : t.box ? btn('To point text', () => S.app.doc.commit('Convert to Point Text', () => { t.box = null; l.version++; })) : btn('To paragraph', () => S.app.doc.commit('Convert to Paragraph Text', () => { const b = S.Text.layout(t).bbox; t.box = { w: Math.ceil(b.w + 10), h: Math.ceil(b.h + 10) }; t.x = b.x; l.version++; }))]);
        return U.el('div', {}, [section('Text', U.el('div', {}, [ta, ui, rotUI, row])), section('Text Warp', warpUI(doc, l)), section('Text on Path', curveUI(doc, l))]);
      }

      /* ---------- warp presets (arc, bulge, flag, wave…) ---------- */
      function warpUI(doc, l) {
        const t = l.text, w = t.warp || { style: 'none', bend: 50 };
        if (t.curve) return U.el('div', { class: 'muted panel-hint' }, 'Warp is not available for text on a path — straighten the text first.');
        const defs = [{ id: 'style', label: 'Style', type: 'select', default: w.style || 'none', options: S.Text.WARPS }];
        if (w.style && w.style !== 'none') defs.push({ id: 'bend', label: 'Bend', type: 'range', default: w.bend ?? 50, min: -100, max: 100, unit: '%' });
        const ui = S.ParamUI.build(defs, {}, (v, id, final) => {
          live(doc, 'Text Warp', () => { t.warp = v.style === 'none' ? null : { style: v.style, bend: v.bend ?? w.bend ?? 50 }; l.version++; }, final);
          if (id === 'style') render(true);
        });
        ui.classList.add('warp-ui');
        const kids = [ui];
        if (w.style && w.style !== 'none') kids.push(U.el('div', { class: 'muted panel-hint' }, 'The warp is hidden while the text is being edited on the canvas. Convert Text to Shape (Layer menu) traces the warped outline.'));
        return U.el('div', {}, kids);
      }

      /* ---------- text on a circle / path ---------- */
      function curveUI(doc, l) {
        const t = l.text, cv = t.curve || null, type = cv ? cv.type : 'none';
        const defs = [{ id: 'type', label: 'Curve', type: 'select', default: type, options: [{ value: 'none', label: 'None (straight)' }, { value: 'circle', label: 'Circle' }, { value: 'path', label: 'Path (from Paths panel)' }] }];
        if (type === 'circle') defs.push(
          { id: 'radius', label: 'Radius', type: 'range', default: Math.round(cv.radius), min: 5, max: 3000, unit: 'px' },
          { id: 'start', label: 'Start angle (° from top)', type: 'range', default: Math.round((cv.start || 0) * 10) / 10, min: -180, max: 180, step: 0.5 },
          { id: 'dir', label: 'Direction', type: 'select', default: cv.dir || 'outside', options: [{ value: 'outside', label: 'Outside — clockwise, top arc' }, { value: 'inside', label: 'Inside — counter-clockwise, bottom arc' }] },
          { id: 'cx', label: 'Centre X', type: 'number', default: Math.round(t.x), unit: 'px' },
          { id: 'cy', label: 'Centre Y', type: 'number', default: Math.round(t.y), unit: 'px' });
        if (type === 'path') defs.push(
          { id: 'start', label: 'Start offset', type: 'range', default: Math.round(cv.start || 0), min: -3000, max: 3000, unit: 'px' },
          { id: 'flip', label: 'Flip to other side', type: 'checkbox', default: !!cv.flip });
        const ui = S.ParamUI.build(defs, {}, (v, id, final) => {
          if (id === 'type') {
            if (v.type === 'path') { attachToPath(doc, l); return; }
            doc.commit(v.type === 'none' ? 'Straighten Text' : 'Text on Circle', () => { setCurveType(t, v.type); l.version++; });
            render(true); return;
          }
          live(doc, 'Text on Path', () => {
            if (id === 'cx') t.x = v.cx; else if (id === 'cy') t.y = v.cy; else t.curve[id] = v[id];
            l.version++;
          }, final);
        });
        ui.classList.add('curve-ui');
        const kids = [ui];
        if (type === 'path') kids.push(U.el('div', { class: 'prop-btns' }, [btn('Re-attach to active path', () => attachToPath(doc, l))]));
        if (type === 'none') kids.push(U.el('div', { class: 'muted panel-hint' }, 'Circle wraps the text around a ring (watch dials, badges). Path follows the path selected in the Paths panel.'));
        return U.el('div', {}, kids);
      }
      /** switch between straight and circle, keeping the text where it was */
      function setCurveType(t, type) {
        const cv = t.curve;
        if (cv) { // back to straight first
          t.x += cv.dx || 0; t.y += cv.dy || 0; if (cv.align0) t.align = cv.align0; t.curve = null;
        }
        if (type !== 'circle') return;
        const lay = S.Text.layout(t), bb = lay.bbox;
        const r = Math.max(Math.round(t.size * 1.5), Math.round(bb.w / (Math.PI / 2)));
        const cx = bb.x + bb.w / 2, cy = t.y + lay.asc + r;
        t.curve = { type: 'circle', radius: r, start: 0, dir: 'outside', dx: t.x - cx, dy: t.y - cy, align0: t.align };
        t.x = cx; t.y = cy; t.align = 'center';
      }
      function attachToPath(doc, l) {
        const t = l.text, ap = doc.paths.find((p) => p.id === doc.activePathId);
        if (!ap || !ap.path.subpaths.length || !ap.path.subpaths[0].nodes.length) { S.toast('Draw a path with the Pen tool (or select one in the Paths panel) first'); render(true); return; }
        doc.commit('Text on Path', () => {
          if (t.curve) setCurveType(t, 'none');
          let path = S.Paths.clone(ap.path);
          if (t.matrix) { const inv = S.Geom.invert(t.matrix); path = S.Paths.transform(path, (x, y) => S.Geom.apply(inv, x, y)); }
          const n0 = path.subpaths[0].nodes[0], ox = n0.x, oy = n0.y;
          t.curve = { type: 'path', path: S.Paths.translate(path, -ox, -oy), start: 0, flip: false, dx: t.x - ox, dy: t.y - oy, align0: t.align };
          t.x = ox; t.y = oy;
          l.version++;
        });
        render(true);
      }
      S.TextCurve = { setCurveType };

      /** rotate a matrix-carrying layer about a doc-space point to an absolute angle */
      function rotateMatrixTo(m, deg, cx, cy) {
        const A = S.Affine, cur = m ? A.decompose(m).rot : 0;
        return A.mul(A.rotAbout((deg * Math.PI) / 180 - cur, cx, cy), m || A.I());
      }

      function shapeSection(doc, l) {
        const s = l.shape;
        const geo = [];
        if (s.kind === 'line') geo.push(...['x1', 'y1', 'x2', 'y2'].map((k) => ({ id: k, label: k.toUpperCase(), type: 'number', default: Math.round(s[k]) })), { id: 'lineWidth', label: 'Weight', type: 'range', default: s.lineWidth, min: 1, max: 300, unit: 'px' }, { id: 'arrowStart', label: 'Arrow at start', type: 'checkbox', default: s.arrowStart }, { id: 'arrowEnd', label: 'Arrow at end', type: 'checkbox', default: s.arrowEnd });
        else if (s.kind !== 'path') geo.push(...[['x', 'X'], ['y', 'Y'], ['w', 'W'], ['h', 'H']].map(([k, lab]) => ({ id: k, label: lab, type: 'number', default: Math.round(s[k]), unit: 'px' })));
        if (s.kind === 'roundRect') {
          const sep = !!s.radii;
          geo.push({ id: 'radius', label: 'Corner radius', type: 'range', default: s.radius, min: 0, max: 1000, unit: 'px' }, { id: 'sepCorners', label: 'Separate corners', type: 'checkbox', default: sep });
          if (sep) geo.push(...[['r0', 'Top left'], ['r1', 'Top right'], ['r2', 'Bottom right'], ['r3', 'Bottom left']].map(([k, lab], i) => ({ id: k, label: lab, type: 'number', default: Math.round(s.radii[i] ?? s.radius), min: 0, max: 1000, unit: 'px' })));
        }
        if (s.kind === 'polygon') geo.push({ id: 'sides', label: 'Sides', type: 'range', default: s.sides, min: 3, max: 64 });
        if (s.kind === 'star') geo.push({ id: 'points', label: 'Points', type: 'range', default: s.points, min: 3, max: 64 }, { id: 'inner', label: 'Inner radius', type: 'range', default: Math.round(s.inner * 100), min: 5, max: 95, unit: '%' });
        if (s.kind === 'custom') geo.push({ id: 'custom', label: 'Shape', type: 'select', default: s.custom, options: Object.keys(S.Paths.CUSTOM).map((k) => ({ value: k, label: S.Paths.CUSTOM[k].label })) });
        if (s.kind !== 'line') geo.push({ id: 'rotation', label: 'Rotation', type: 'number', default: +S.Shape.rotation(s).toFixed(2), min: -360, max: 360, step: 0.1, unit: '°' });
        const g = S.ParamUI.build(geo, {}, (v, id, final) => { const hadRadii = !!s.radii; live(doc, id === 'rotation' ? 'Rotate Shape' : 'Shape Geometry', () => {
          if (id === 'rotation') {
            // rotate about the shape's own centre (repeat copies follow)
            const c = S.Shape.center(s);
            const target = rotateMatrixTo(s.matrix, v.rotation, c[0], c[1]);
            S.Shape.setAffine(s, target); // target maps the current local geometry to its rotated place
          } else if (id === 'sepCorners') s.radii = v.sepCorners ? [s.radius, s.radius, s.radius, s.radius] : null;
          else if (/^r[0-3]$/.test(id)) { s.radii = (s.radii || [s.radius, s.radius, s.radius, s.radius]).slice(); s.radii[+id[1]] = v[id]; }
          else if (id === 'radius' && s.radii) { s.radius = v.radius; s.radii = null; }
          else s[id] = id === 'inner' ? v[id] / 100 : v[id];
          l.version++;
        }, final); if (final && (id === 'sepCorners' || (id === 'radius' && hadRadii))) render(true); });

        const paint = (which, label) => {
          const p = s[which];
          const ty = p.type || 'solid';
          const defs = [{ id: 'on', label, type: 'checkbox', default: !!p.enabled },
            { id: 'type', label: label + ' type', type: 'select', default: ty, options: S.ShapePaint.PAINT_OPTIONS }];
          if (ty === 'solid') defs.push({ id: 'color', label: label + ' color', type: 'color', default: p.color });
          else defs.push(...S.ShapePaint.gradientDefs(S.ShapePaint.ensureGradient(p)));
          if (which === 'stroke') defs.push(
            { id: 'width', label: 'Stroke width', type: 'range', default: p.width, min: 0, max: 200, step: 0.5, unit: 'px' },
            { id: 'align', label: 'Stroke align', type: 'select', default: p.align, options: ['center', 'inside', 'outside'] },
            { id: 'dash', label: 'Dashes', type: 'select', default: p.dash, options: ['solid', 'dash', 'dot'] });
          const ui = S.ParamUI.build(defs, {}, (v, id, final) => {
            live(doc, which === 'fill' ? 'Shape Fill' : 'Shape Stroke', () => {
              if (id === 'on') p.enabled = v.on;
              else if (id === 'type') { p.type = v.type; S.ShapePaint.ensureGradient(p); }
              else p[id] = JSON.parse(JSON.stringify(v[id]));
              l.version++;
            }, final);
            if (id === 'type') render(true);
          });
          ui.classList.add('paint-ui', 'paint-' + which);
          return ui;
        };

        // radial repeat
        const r = s.repeat || {};
        const repDefs = [{ id: 'enabled', label: 'Radial repeat', type: 'checkbox', default: !!r.enabled }];
        if (r.enabled) repDefs.push(
          { id: 'count', label: 'Copies', type: 'range', default: r.count || 12, min: 2, max: 120 },
          { id: 'offset', label: 'Radius offset', type: 'range', default: r.offset || 0, min: -1000, max: 1000, unit: 'px' },
          { id: 'cx', label: 'Centre X', type: 'number', default: Math.round(r.cx ?? doc.width / 2), unit: 'px' },
          { id: 'cy', label: 'Centre Y', type: 'number', default: Math.round(r.cy ?? doc.height / 2), unit: 'px' },
          { id: 'rotate', label: 'Rotate copies', type: 'checkbox', default: r.rotate !== false });
        const rep = S.ParamUI.build(repDefs, {}, (v, id, final) => {
          live(doc, 'Radial Repeat', () => {
            if (!s.repeat) s.repeat = { enabled: false, count: 12, cx: Math.round(doc.width / 2), cy: Math.round(doc.height / 2), offset: 0, rotate: true };
            s.repeat[id] = v[id];
            l.version++;
          }, final);
          if (id === 'enabled') render(true);
        });
        rep.classList.add('repeat-ui');
        const repHint = r.enabled ? U.el('div', { class: 'muted panel-hint' }, 'Free Transform edits the repeated element; the Move tool moves the whole ring.') : null;

        const kindName = { rect: 'Rectangle', roundRect: 'Rounded Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', star: 'Star', line: 'Line', custom: 'Custom Shape', path: 'Path Shape' }[s.kind];
        const btns = [btn('Rasterize', () => S.Cmd.run('layer.rasterize')), btn('Edit points', () => S.Tools.select('directSelect'))];
        if (s.matrix) btns.push(btn('Reset rotation', () => doc.commit('Reset Shape Transform', () => {
          // drop rotation/skew/flip but keep the shape centred where it is (repeat centre untouched)
          const c = S.Shape.center(s), lc = S.Shape.localCenter(s);
          S.Shape.setAffine(s, S.Affine.translate(c[0] - lc[0], c[1] - lc[1]));
          l.version++;
        })));
        return U.el('div', {}, [section(kindName, g), section('Appearance', U.el('div', {}, [paint('fill', 'Fill'), U.el('div', { class: 'hsep' }), paint('stroke', 'Stroke')])),
          section('Repeat', U.el('div', {}, [rep, repHint])), U.el('div', { class: 'prop-btns' }, btns)]);
      }

      function fillSection(doc, l) {
        const f = l.fill;
        const defs = [{ id: 'kind', label: 'Type', type: 'select', default: f.kind, options: [{ value: 'solid', label: 'Solid Color' }, { value: 'gradient', label: 'Gradient' }] }];
        if (f.kind === 'solid') defs.push({ id: 'color', label: 'Color', type: 'color', default: f.color });
        else defs.push({ id: 'stops', label: 'Gradient', type: 'gradient', default: f.stops },
          { id: 'gtype', label: 'Style', type: 'select', default: f.gtype || 'linear', options: ['linear', 'radial', 'angle', 'reflected', 'diamond'] },
          { id: 'angle', label: 'Angle', type: 'angle', default: f.angle ?? 90 }, { id: 'scale', label: 'Scale', type: 'range', default: f.scale ?? 100, min: 10, max: 300, unit: '%' },
          { id: 'reverse', label: 'Reverse', type: 'checkbox', default: !!f.reverse });
        const ui = S.ParamUI.build(defs, {}, (v, id, final) => {
          live(doc, 'Fill Layer', () => { f[id] = v[id]; if (id === 'kind' && !f.stops) f.stops = S.Gradient.resolve(S.Gradient.PRESETS[0]); l.name = f.kind === 'solid' ? 'Color Fill' : 'Gradient Fill'; l.version++; }, final);
          if (id === 'kind') render(true);
        });
        return section('Fill Layer', ui);
      }

      function adjustmentSection(doc, l) {
        const fx = window.ImageFX && ImageFX.adjustments[l.adj.id];
        if (!fx) return section(l.name, U.el('div', { class: 'muted' }, 'This adjustment is not available in the loaded effects library.'));
        // histogram of everything below this layer
        const histogram = () => {
          const info = doc.parentInfo(l.id);
          const below = info.list.slice(0, info.index);
          return S.ParamUI.histogramOf(S.Compositor.flatten(doc, info.parent ? below : below));
        };
        const ui = fx.params.length ? S.ParamUI.build(fx.params, l.adj.params, (v, id, final) => live(doc, fx.name, () => { l.adj.params = JSON.parse(JSON.stringify(v)); l.version++; }, final), { histogram })
          : U.el('div', { class: 'muted' }, 'This adjustment has no settings.');
        const clipBtn = U.el('button', { class: 'icon-btn' + (l.clip ? ' active' : ''), html: S.icon('clip'), 'data-tip': 'Clip to layer below (affect only that layer)', 'data-tip-pos': 'bottom' });
        clipBtn.addEventListener('click', () => doc.commit('Clipping Mask', () => { l.clip = !l.clip; }));
        const reset = U.el('button', { class: 'icon-btn', html: S.icon('undo'), 'data-tip': 'Reset to defaults', 'data-tip-pos': 'bottom' });
        reset.addEventListener('click', () => { doc.commit('Reset ' + fx.name, () => { l.adj.params = ImageFX.defaults ? ImageFX.defaults(fx) : S.Layers.defaultParams(fx); l.version++; }); render(true); });
        const vis = U.el('button', { class: 'icon-btn', html: S.icon(l.visible ? 'eye' : 'eyeOff'), 'data-tip': 'Toggle adjustment', 'data-tip-pos': 'bottom' });
        vis.addEventListener('click', () => doc.commit('Toggle Adjustment', () => { l.visible = !l.visible; }));
        return section(fx.name, ui, U.el('div', { class: 'row' }, [clipBtn, vis, reset]));
      }

      function layerSection(doc, l) {
        const b = l.type === 'raster' ? S.layerBounds(l, doc) : null;
        const rows = U.el('div', { class: 'prop-grid' });
        const kv = (k, v) => { rows.append(U.el('span', { class: 'muted' }, k), U.el('span', {}, v)); };
        kv('Type', l.embed ? 'Embedded object' : { raster: 'Pixel layer', group: 'Group', text: 'Text', shape: 'Shape', fill: 'Fill', adjustment: 'Adjustment' }[l.type]);
        if (l.embed) { const e = l.embed, sc = S.Embed.scale(e.matrix), rot = S.Affine.decompose(e.matrix).rot * 180 / Math.PI; kv('Source', e.source.width + ' × ' + e.source.height + ' px'); kv('Scale', Math.round(sc * 1000) / 10 + '%' + (Math.abs(rot) > 0.05 ? ' · ' + rot.toFixed(1) + '°' : '')); if (e.filters && e.filters.length) kv('Smart filters', e.filters.map((f) => (f.on === false ? '(' : '') + ((window.ImageFX && (ImageFX.filters[f.id] || ImageFX.adjustments[f.id]) || {}).name || f.id) + (f.on === false ? ')' : '')).join(', ')); }
        if (b) { kv('Position', b.x + ', ' + b.y + ' px'); kv('Size', b.w + ' × ' + b.h + ' px'); }
        else if (l.type === 'raster') kv('Content', 'empty');
        if (l.type === 'group') kv('Layers', String(l.children.length));
        const defs = [
          { id: 'opacity', label: 'Opacity', type: 'range', default: Math.round(l.opacity * 100), min: 0, max: 100, unit: '%' },
          { id: 'fillOpacity', label: 'Fill', type: 'range', default: Math.round((l.fillOpacity ?? 1) * 100), min: 0, max: 100, unit: '%' },
        ];
        const ui = S.ParamUI.build(defs, {}, (v, id, final) => live(doc, id === 'opacity' ? 'Opacity' : 'Fill Opacity', () => { l[id] = v[id] / 100; l.version++; }, final));
        const btns = U.el('div', { class: 'prop-btns' }, [btn('Effects…', () => S.Cmd.run('layer.effects'), 'fx'), !l.mask && l.type !== 'group' ? btn('Add mask', () => S.Cmd.run(doc.selection ? 'layer.maskFromSel' : 'layer.maskReveal'), 'mask') : null,
          l.embed ? btn('Edit contents', () => S.Cmd.run('layer.editContents')) : null, l.embed ? btn('Smart filters…', () => S.FX.galleryDialog && S.FX.galleryDialog(l)) : null, l.embed ? btn('Rasterize', () => S.Cmd.run('layer.rasterize')) : null,
          !l.embed && l.type === 'raster' ? btn('Embed', () => S.Cmd.run('layer.convertEmbed')) : null]);
        return section(l.name, U.el('div', {}, [rows, ui, btns]));
      }

      function docSection(doc) {
        const rows = U.el('div', { class: 'prop-grid' });
        const kv = (k, v) => rows.append(U.el('span', { class: 'muted' }, k), U.el('span', {}, v));
        kv('Document', doc.name); kv('Size', doc.width + ' × ' + doc.height + ' px'); kv('Resolution', doc.dpi + ' ppi'); kv('Layers', String(doc.allLayers().length));
        if (doc.selection) kv('Selection', doc.selection.bounds.w + ' × ' + doc.selection.bounds.h + ' px');
        return section('Document', U.el('div', {}, [rows, U.el('div', { class: 'prop-btns' }, [btn('Image Size…', () => S.Cmd.run('image.size')), btn('Canvas Size…', () => S.Cmd.run('image.canvasSize'))])]));
      }

      function render(force) {
        const doc = S.app.doc;
        const l = doc && doc.activeLayer();
        const key = doc ? doc.id + ':' + (l ? l.id + ':' + l.type + ':' + (l.mask ? 1 : 0) + ':' + (l.embed ? 'e' + (l.embed.filters || []).length : '') + ':' + (l.type === 'shape' ? l.shape.kind + (l.shape.fill.type || '') + (l.shape.stroke.type || '') + !!(l.shape.repeat && l.shape.repeat.enabled) + !!l.shape.matrix : '') + ':' + (l.type === 'fill' ? l.fill.kind : '') + (l.type === 'text' ? (l.text.curve ? l.text.curve.type : '') + !!l.text.matrix + !!l.text.box + (l.text.warp ? l.text.warp.style : '') : '') : 'none') : '';
        if (selfChange && !force) return;
        if (!force && key === lastKey && body._built && before) return;
        lastKey = key;
        before = null;
        const scroll = body.scrollTop;
        body.innerHTML = '';
        body._built = true;
        if (!doc) { body.appendChild(U.el('div', { class: 'empty-note' }, 'No document open')); return; }
        if (!l) { body.appendChild(docSection(doc)); return; }
        if (l.type === 'adjustment') body.appendChild(adjustmentSection(doc, l));
        else if (l.type === 'text') body.appendChild(textSection(doc, l));
        else if (l.type === 'shape') body.appendChild(shapeSection(doc, l));
        else if (l.type === 'fill') body.appendChild(fillSection(doc, l));
        else body.appendChild(layerSection(doc, l));
        if (l.mask) body.appendChild(maskSection(doc, l));
        if (l.type !== 'adjustment') body.appendChild(blendIfSection(doc, l));
        body.scrollTop = scroll;
      }
      return { update: () => render(false) };
    },
  });
})();
