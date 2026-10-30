/* =========================================================================
   Gesso — Layers panel.
   Click = select · Ctrl/Shift-click = multi-select · double-click name = rename
   double-click row = Layer Effects (text: edit text) · Ctrl-click thumbnail =
   load selection · click mask thumbnail = paint on mask · Alt-click mask =
   view mask · Shift-click mask = disable · drag rows to reorder / into groups.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util;
  const TH_W = 34, TH_H = 26;

  function thumb(l, doc, which) {
    const key = '_th_' + which;
    let c = l[key];
    const ver = l.version + ':' + doc.width + 'x' + doc.height + (which === 'mask' && l.mask ? ':' + (l.mask.version || 0) : '') + (l.canvas ? ':' + l.canvas.width + 'x' + l.canvas.height + '@' + (l.canvas.ox || 0) + ',' + (l.canvas.oy || 0) : '');
    if (c && c._ver === ver) return c;
    if (!c) { c = U.createCanvas(TH_W * 2, TH_H * 2); c.className = 'lthumb-canvas'; }
    const x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    const k = Math.min(c.width / doc.width, c.height / doc.height);
    const w = doc.width * k, h = doc.height * k, ox = (c.width - w) / 2, oy = (c.height - h) / 2;
    if (which === 'mask') {
      x.fillStyle = '#000'; x.fillRect(ox, oy, w, h);
      const t = U.createCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h))), tx = t.getContext('2d');
      const m = l.mask, mc = m.canvas, o = S.Layers.maskOutside(m);
      if (o) { tx.fillStyle = 'rgba(0,0,0,' + o / 255 + ')'; tx.fillRect(0, 0, t.width, t.height); }
      if (!mc._empty) { tx.save(); tx.scale(t.width / doc.width, t.height / doc.height); tx.clearRect(mc.ox || 0, mc.oy || 0, mc.width, mc.height); tx.drawImage(mc, mc.ox || 0, mc.oy || 0); tx.restore(); }
      tx.globalCompositeOperation = 'source-in'; tx.fillStyle = '#fff'; tx.fillRect(0, 0, t.width, t.height);
      x.drawImage(t, ox, oy);
    } else {
      // checker
      const s = 5;
      for (let yy = 0; yy < h; yy += s) for (let xx = 0; xx < w; xx += s) { x.fillStyle = ((xx + yy) / s) % 2 ? '#bdbdbd' : '#f0f0f0'; x.fillRect(ox + xx, oy + yy, Math.min(s, w - xx), Math.min(s, h - yy)); }
      if (l.type === 'group') { const fc = S.Compositor.flatten(doc, l.children); x.drawImage(fc, ox, oy, w, h); }
      else if (S.Layers.hasCanvas(l)) {
        S.Layers.ensure(l, doc); x.imageSmoothingQuality = 'high';
        const lc = l.canvas; x.save(); x.beginPath(); x.rect(ox, oy, w, h); x.clip();
        x.drawImage(lc, ox + (lc.ox || 0) * k, oy + (lc.oy || 0) * k, lc.width * k, lc.height * k); x.restore();
      }
    }
    c._ver = ver;
    l[key] = c;
    return c;
  }

  S.Panels.register({
    id: 'layers', title: 'Layers', icon: 'layers',
    events: ['layers:changed', 'doc:switched', 'activeLayer:changed', 'history:changed', 'thumbs:refresh'],
    build(body) {
      const top = U.el('div', { class: 'layers-top' });
      const blend = U.el('select', { class: 'layers-blend', title: 'Blend mode' });
      const opacity = U.el('input', { type: 'number', min: 0, max: 100, title: 'Opacity' });
      const fill = U.el('input', { type: 'number', min: 0, max: 100, title: 'Fill opacity (content only, keeps effects)' });
      const locks = U.el('div', { class: 'lock-row' });
      const lockBtns = {};
      for (const [k, ic, tip] of [['alpha', 'lockAlpha', 'Lock transparent pixels'], ['pixels', 'lockPixels', 'Lock image pixels'], ['position', 'lockMove', 'Lock position'], ['all', 'lock', 'Lock all']]) {
        const b = U.el('button', { class: 'icon-btn', html: S.icon(ic), 'data-tip': tip, 'data-tip-pos': 'bottom' });
        b.addEventListener('click', () => { const d = S.app.doc, l = d && d.activeLayer(); if (!l) return; d.commit('Lock', () => { for (const x of d.selectedLayers()) x.locks[k] = !l.locks[k]; }); });
        lockBtns[k] = b; locks.appendChild(b);
      }
      [opacity, fill].forEach((n) => n.addEventListener('keydown', S.ParamUI.blurOnEnter));
      top.append(U.el('div', { class: 'row' }, [blend, U.el('span', { class: 'muted lbl' }, 'Opacity'), opacity]),
        U.el('div', { class: 'row' }, [U.el('span', { class: 'muted lbl' }, 'Lock'), locks, U.el('div', { style: { flex: 1 } }), U.el('span', { class: 'muted lbl' }, 'Fill'), fill]));
      const list = U.el('div', { class: 'layer-list', tabindex: 0 });
      const bottom = U.el('div', { class: 'layers-bottom' });
      const bb = (icon, tip, fn) => { const b = U.el('button', { class: 'icon-btn', html: S.icon(icon), 'data-tip': tip, 'data-tip-pos': 'top' }); b.addEventListener('click', fn); bottom.appendChild(b); return b; };
      bb('link', 'Clip to layer below (Ctrl+Alt+G)', () => S.Cmd.run('layer.clip'));
      const fxBtn = bb('fx', 'Layer Effects', (e) => S.Menu.show(S.Effects.DEFS.map((d) => ({ label: d.name, run: () => S.Cmd.run('layer.effects', d.id) })).concat(['-', { cmd: 'layer.clearEffects' }]), e.clientX, e.clientY - 240));
      bb('mask', 'Add layer mask (Alt: hide all)', (e) => { const d = S.app.doc; if (!d) return; S.Cmd.run(e.altKey ? 'layer.maskHide' : d.selection ? 'layer.maskFromSel' : 'layer.maskReveal'); });
      bb('adjust', 'New fill or adjustment layer', (e) => S.Menu.show(S.App.adjustmentMenu(), e.clientX, e.clientY - 300));
      bb('folder', 'New group', () => S.Cmd.run('layer.newGroup'));
      bb('newLayer', 'New layer (Ctrl+Shift+N)', () => S.Cmd.run('layer.new'));
      bb('trash', 'Delete layer', () => S.Cmd.run('layer.delete'));
      void fxBtn;
      // filter bar: type to search layer names, pick a kind; hidden until the funnel button is clicked (or Ctrl+Alt+F)
      const filt = U.el('div', { class: 'layers-filter', style: { display: 'none' } });
      const fq = U.el('input', { type: 'search', placeholder: 'Filter layers by name…', class: 'layers-filter-q' });
      const fk = U.el('select', { class: 'layers-filter-kind' }, [['', 'All kinds'], ['raster', 'Pixel'], ['text', 'Text'], ['shape', 'Shape'], ['adjustment', 'Adjustment'], ['fill', 'Fill'], ['group', 'Group'], ['embedded', 'Embedded'], ['fx', 'With effects'], ['mask', 'With mask'], ['hidden', 'Hidden']].map((o) => U.el('option', { value: o[0] }, o[1])));
      const fclose = U.el('button', { class: 'icon-btn', html: S.icon('close'), 'data-tip': 'Clear filter', 'data-tip-pos': 'bottom' });
      filt.append(fq, fk, fclose);
      const filterState = { q: '', kind: '' };
      const applyFilter = () => { filterState.q = fq.value.trim().toLowerCase(); filterState.kind = fk.value; render(); };
      fq.addEventListener('input', applyFilter); fk.addEventListener('change', applyFilter);
      fq.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { fq.value = ''; fk.value = ''; filt.style.display = 'none'; applyFilter(); } });
      fclose.addEventListener('click', () => { fq.value = ''; fk.value = ''; filt.style.display = 'none'; applyFilter(); });
      S.Panels.layersFilterToggle = () => { const show = filt.style.display === 'none'; filt.style.display = show ? '' : 'none'; if (show) fq.focus(); else { fq.value = ''; fk.value = ''; applyFilter(); } };
      const funnel = U.el('button', { class: 'icon-btn', html: S.icon('filter'), 'data-tip': 'Filter layers (Ctrl+Alt+F)', 'data-tip-pos': 'bottom' });
      funnel.addEventListener('click', () => S.Panels.layersFilterToggle());
      top.appendChild(funnel);
      const matches = (l) => {
        const k = filterState.kind;
        if (k === 'fx' ? !(l.effects && l.effects.length) : k === 'mask' ? !l.mask : k === 'hidden' ? l.visible : k === 'embedded' ? !l.embed : k ? (l.type !== k || (k === 'raster' && l.embed)) : false) return false;
        return !filterState.q || (l.name || '').toLowerCase().includes(filterState.q);
      };
      const anyMatch = (l) => matches(l) || (l.children || []).some(anyMatch);
      body.append(top, filt, list, bottom);
      body.classList.add('layers-panel');

      S.blendOptions(blend, true);
      blend.addEventListener('change', () => { const d = S.app.doc; d.commit('Blend Mode', () => { for (const l of d.selectedLayers()) { if (blend.value === 'pass-through' && l.type !== 'group') continue; l.blend = blend.value; l.version++; } }); blend.blur(); });
      const setOp = (key, inp) => inp.addEventListener('change', () => { const d = S.app.doc; const v = U.clamp(+inp.value, 0, 100) / 100; d.commit(key === 'opacity' ? 'Opacity' : 'Fill Opacity', () => { for (const l of d.selectedLayers()) { l[key] = v; l.version++; } }, { key: key + d.activeId }); });
      setOp('opacity', opacity); setOp('fillOpacity', fill);
      // scrub opacity with the wheel
      opacity.addEventListener('wheel', (e) => { e.preventDefault(); opacity.value = U.clamp(+opacity.value - Math.sign(e.deltaY) * 5, 0, 100); opacity.dispatchEvent(new Event('change')); }, { passive: false });

      let dragId = null;
      function row(l, depth, doc) {
        const sel = doc.selectedIds.has(l.id), active = doc.activeId === l.id;
        const r = U.el('div', { class: 'layer-row' + (sel ? ' selected' : '') + (active ? ' active' : '') + (l.visible ? '' : ' hidden-layer') + (l.clip ? ' clipped' : ''), draggable: true });
        r.dataset.id = l.id;
        r.style.paddingLeft = 4 + depth * 14 + 'px';
        const eye = U.el('button', { class: 'icon-btn eye', html: S.icon(l.visible ? 'eye' : 'eyeOff'), title: 'Toggle visibility (Alt-click: solo)' });
        eye.addEventListener('click', (e) => {
          e.stopPropagation();
          if (e.altKey) { doc.commit('Solo Layer', () => { const all = doc.allLayers(); const others = all.filter((x) => x !== l && x.type !== 'group'); const anyOn = others.some((x) => x.visible); others.forEach((x) => (x.visible = !anyOn)); l.visible = true; }); return; }
          doc.commit(l.visible ? 'Hide Layer' : 'Show Layer', () => { l.visible = !l.visible; });
        });
        r.appendChild(eye);
        if (l.clip) r.appendChild(U.el('span', { class: 'clip-arrow', html: S.icon('clip'), title: 'Clipped to layer below' }));
        if (l.type === 'group') {
          const ch = U.el('button', { class: 'icon-btn chev', html: S.icon(l.collapsed ? 'chevRight' : 'chevDown') });
          ch.addEventListener('click', (e) => { e.stopPropagation(); l.collapsed = !l.collapsed; render(); });
          r.appendChild(ch);
          r.appendChild(U.el('span', { class: 'group-ico', html: S.icon('folder') }));
        }
        const maskTarget = !!l.mask && (l.editMask || l.type === 'adjustment' || l.type === 'fill');
        const thWrap = U.el('div', { class: 'lthumb' + (!maskTarget ? ' target' : ''), title: 'Ctrl-click: load as selection' });
        if (l.type === 'adjustment') thWrap.appendChild(U.el('div', { class: 'adj-ico', html: S.icon((S.ADJ_ICON && S.ADJ_ICON[l.adj.id]) || 'adjust') }));
        else if (l.type === 'fill') { const sw = U.el('div', { class: 'fill-ico' }); sw.style.background = l.fill.kind === 'solid' ? l.fill.color : S.Gradient.css(l.fill.stops); thWrap.appendChild(sw); }
        else if (l.type !== 'group') thWrap.appendChild(thumb(l, doc, 'pix'));
        if (l.type === 'text') thWrap.appendChild(U.el('span', { class: 'type-badge' }, 'T'));
        if (l.embed) thWrap.appendChild(U.el('span', { class: 'type-badge embed-badge', title: 'Embedded object (non-destructive)' }, '◈'));
        if (l.type === 'shape') thWrap.appendChild(U.el('span', { class: 'type-badge', html: S.icon('polygon') }));
        thWrap.addEventListener('click', (e) => {
          if (e.ctrlKey || e.metaKey) {
            e.stopPropagation();
            const s = S.Ops.layerAlphaSelection(doc, l);
            const mode = e.shiftKey && e.altKey ? 'intersect' : e.shiftKey ? 'add' : e.altKey ? 'subtract' : 'new';
            doc.setSelection(mode === 'new' ? s : S.Sel.combine(doc.selection, s ? s.mask : new Uint8ClampedArray(doc.width * doc.height), mode, doc.width, doc.height), 'Load Selection');
            return;
          }
          if (l.editMask) { l.editMask = false; if (doc.maskView) { doc.maskView = null; doc.invalidate(); } S.bus.emit('activeLayer:changed', doc); }
        });
        if (l.type !== 'group') r.appendChild(thWrap);
        if (l.mask) {
          const mw = U.el('div', { class: 'lthumb mask' + (maskTarget ? ' target' : '') + (l.mask.enabled === false ? ' disabled' : ''), title: 'Layer mask — click to edit, Alt-click to view, Shift-click to disable' });
          mw.appendChild(thumb(l, doc, 'mask'));
          mw.addEventListener('click', (e) => {
            e.stopPropagation();
            if (e.shiftKey) { S.Cmd.run('layer.maskToggle'); return; }
            if (e.ctrlKey || e.metaKey) { doc.setActive(l.id); S.Cmd.run('layer.maskToSel'); return; }
            if (doc.activeId !== l.id) doc.setActive(l.id);
            l.editMask = true;
            if (e.altKey) { doc.maskView = doc.maskView === l.id ? null : l.id; doc.invalidate(); }
            else if (doc.maskView && doc.maskView !== l.id) { doc.maskView = null; doc.invalidate(); }
            S.bus.emit('activeLayer:changed', doc); render();
          });
          r.appendChild(mw);
        }
        // the name text itself is the rename target; the empty rest of the row opens Layer Effects
        const name = U.el('div', { class: 'lname' }, [U.el('span', { class: 'lname-text' }, l.name)]);
        r.appendChild(name);
        if (l.effects && Object.keys(l.effects.items || {}).length) {
          const fx = U.el('span', { class: 'fx-badge' + (l.effects.enabled === false ? ' off' : ''), title: 'Layer effects (double-click to edit)' }, 'fx');

          r.appendChild(fx);
        }
        if (l.locks.all || l.locks.pixels || l.locks.position || l.locks.alpha) r.appendChild(U.el('span', { class: 'lock-ind', html: S.icon('lock') }));
        // selection & interactions
        r.addEventListener('click', (e) => {
          const mode = e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'range' : null;
          if (!mode && doc.activeId === l.id && doc.selectedIds.size === 1 && doc.selectedIds.has(l.id)) return; // already the only selection
          doc.setActive(l.id, mode);
        });
        r.addEventListener('contextmenu', (e) => { if (!doc.selectedIds.has(l.id)) doc.setActive(l.id); S.Menu.context(S.App.layerContextMenu(l), e); });
        // drag & drop
        r.addEventListener('dragstart', (e) => { dragId = l.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-layer', l.id); r.classList.add('dragging'); });
        r.addEventListener('dragend', () => { dragId = null; list.querySelectorAll('.drop-above,.drop-below,.drop-into,.dragging').forEach((x) => x.classList.remove('drop-above', 'drop-below', 'drop-into', 'dragging')); if (renderPending) render(); });
        r.addEventListener('dragover', (e) => {
          if (!dragId || dragId === l.id) return;
          e.preventDefault();
          const b = r.getBoundingClientRect(), y = (e.clientY - b.top) / b.height;
          r.classList.remove('drop-above', 'drop-below', 'drop-into');
          if (l.type === 'group' && y > 0.3 && y < 0.7) r.classList.add('drop-into');
          else r.classList.add(y < 0.5 ? 'drop-above' : 'drop-below');
        });
        r.addEventListener('dragleave', () => r.classList.remove('drop-above', 'drop-below', 'drop-into'));
        r.addEventListener('drop', (e) => {
          e.preventDefault();
          const where = r.classList.contains('drop-into') ? 'inside' : r.classList.contains('drop-above') ? 'above' : 'below';
          const moving = doc.selectedIds.has(dragId) ? doc.selectedLayers() : [doc.findLayer(dragId)];
          if (moving.some((m) => m.id === l.id || doc.isDescendant(l.id, m.id))) return;
          dragId = null; // allow the re-render triggered by the commit
          doc.commit('Move Layer', () => {
            for (const m of moving) doc.removeLayer(m.id);
            // in the panel "above" means higher in the stack = later in the array
            const ordered = where === 'below' ? moving.slice().reverse() : moving;
            let ref = l.id;
            for (const m of ordered) { doc.insertLayer(m, ref, where === 'inside' ? 'inside' : where === 'above' ? 'above' : 'below'); if (where !== 'inside') ref = m.id; }
          });
        });
        return r;
      }
      let renderPending = false;
      function render() {
        // replacing the rows during an HTML5 drag removes the drag source, which cancels the drop
        if (dragId) { renderPending = true; return; }
        // …and while a layer name is being typed (a delayed thumbnail refresh would destroy the field)
        if (list.querySelector('input.rename:not([data-done])')) { renderPending = true; return; }
        renderPending = false;
        const doc = S.app.doc;
        list.innerHTML = '';
        if (!doc) { list.appendChild(U.el('div', { class: 'empty-note' }, 'No document')); return; }
        const filtering = !!(filterState.q || filterState.kind);
        const rec = (layers, depth) => {
          for (let i = layers.length - 1; i >= 0; i--) {
            const l = layers[i];
            if (filtering && !anyMatch(l)) continue;
            list.appendChild(row(l, depth, doc));
            if (l.children && (!l.collapsed || filtering)) rec(l.children, depth + 1);
          }
        };
        rec(doc.layers, 0);
        if (filtering && !list.children.length) list.appendChild(U.el('div', { class: 'empty-note' }, 'No layers match the filter'));
        const l = doc.activeLayer();
        const enable = !!l;
        [blend, opacity, fill].forEach((x) => (x.disabled = !enable));
        if (l) {
          blend.value = l.blend || 'normal';
          // don't overwrite a number the user is typing (thumbnail refreshes re-render while painting)
          if (document.activeElement !== opacity) opacity.value = Math.round(l.opacity * 100);
          if (document.activeElement !== fill) fill.value = Math.round((l.fillOpacity ?? 1) * 100);
          for (const k in lockBtns) lockBtns[k].classList.toggle('active', !!l.locks[k]);
        }
        const act = list.querySelector('.layer-row.active');
        if (act && act.scrollIntoViewIfNeeded) act.scrollIntoViewIfNeeded(false);
      }
      // refresh thumbnails while painting (debounced)
      const refreshThumbs = U.debounce(() => { if (S.Panels.isShown('layers')) render(); }, 350);
      S.bus.on('composite:updated', refreshThumbs);
      /* Double-click handling.  The first click of a double-click selects the layer, which re-renders the
         list, so the browser never sees two clicks on the same element and 'dblclick' would not fire.
         Detect double-clicks ourselves on the (persistent) list element instead. */
      function startRename(l, doc) {
        const r = list.querySelector('.layer-row[data-id="' + l.id + '"]'); const name = r && r.querySelector('.lname');
        if (!name) return;
        const inp = U.el('input', { type: 'text', value: l.name, class: 'rename' });
        name.replaceWith(inp); inp.focus(); inp.select();
        let finished = false;
        const done = (ok) => {
          if (finished) return; finished = true; inp.dataset.done = '1';
          if (ok && inp.value && inp.value !== l.name) doc.commit('Rename Layer', () => { l.name = inp.value; }); else render();
        };
        inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); });
        inp.addEventListener('blur', () => done(true));
        inp.addEventListener('click', (ev) => ev.stopPropagation());
        inp.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      }
      function onDouble(l, part, doc) {
        if (part === 'eye' || part === 'chev') return;
        if (part === 'name') { startRename(l, doc); return; }
        if (part === 'fx') { S.Cmd.run('layer.effects'); return; }
        if (part === 'mask') { S.Panels.show('properties'); return; } // mask density/feather live in Properties
        if (l.type === 'text' && part === 'thumb') { S.TextTool.editLayer(l); return; }
        if (l.embed && part === 'thumb') { S.Cmd.run('layer.editContents'); return; }
        if (l.type === 'adjustment' || l.type === 'fill' || (l.type === 'shape' && part === 'thumb')) { S.Panels.show('properties'); return; }
        S.Cmd.run('layer.effects');
      }
      let lastClick = null;
      // a click anywhere else in between means the next click on a row is not a double-click
      document.addEventListener('pointerdown', (e) => { if (!list.contains(e.target)) lastClick = null; }, true);
      // runs after the row's own click handler (bubbling), so the selection change has been emitted already;
      // the rAF callback is queued after the panel's re-render and acts on the fresh DOM
      list.addEventListener('click', (e) => {
        if (e.button !== 0 || e.target.closest('input')) return;
        const r = e.target.closest('.layer-row'); if (!r) { lastClick = null; return; }
        const part = e.target.closest('.eye') ? 'eye' : e.target.closest('.chev') ? 'chev' : e.target.closest('.fx-badge') ? 'fx' : e.target.closest('.lname-text') ? 'name' : e.target.closest('.lthumb.mask') ? 'mask' : e.target.closest('.lthumb') ? 'thumb' : 'row';
        const now = performance.now();
        if (lastClick && lastClick.id === r.dataset.id && lastClick.part === part && now - lastClick.t < 450 && Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) < 6 && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
          lastClick = null;
          const doc = S.app.doc, l = doc && doc.findLayer(r.dataset.id);
          if (l) requestAnimationFrame(() => onDouble(l, part, doc));
          return;
        }
        lastClick = { id: r.dataset.id, part, t: now, x: e.clientX, y: e.clientY };
      });
      list.addEventListener('dragover', (e) => { if (dragId) e.preventDefault(); });
      list.addEventListener('contextmenu', (e) => { if (e.target === list) S.Menu.context([{ cmd: 'layer.new' }, { cmd: 'layer.newGroup' }], e); });
      return { update: render };
    },
  });
})();
