/* =========================================================================
   Gesso — dock & panel framework.
   Panels register with S.Panels.register({ id, title, icon, build(body) → {update?} ,
   events:[bus events that trigger update] }).
   Layout = columns → groups → tabbed panels.  Tabs can be dragged between
   groups; groups collapse by double-clicking their tab bar.  Layout persists.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util;
  const P = (S.Panels = { defs: {}, inst: {} });

  const DEFAULT = {
    second: true,
    cols: [
      { id: 'A', width: 236, groups: [
        { panels: ['navigator', 'histogram', 'info'], active: 'navigator', flex: 0, h: 292 }, // tall enough for the Histogram graph + statistics
        { panels: ['history', 'brushes', 'comps'], active: 'history', flex: 1 },
        { panels: ['character', 'paths', 'channels'], active: 'character', flex: 1 },
      ] },
      { id: 'B', width: 292, groups: [
        { panels: ['color', 'swatches'], active: 'color', flex: 0, h: 226 },
        { panels: ['properties', 'adjustments'], active: 'properties', flex: 1 },
        { panels: ['layers'], active: 'layers', flex: 1.4 },
      ] },
    ],
  };
  // compact default for narrower screens: one main column, rarely used panels in the (hidden) second column
  const DEFAULT_SINGLE = {
    second: false,
    cols: [
      { id: 'A', width: 236, groups: [{ panels: ['histogram', 'info'], active: 'histogram', flex: 1 }] },
      { id: 'B', width: 292, groups: [
        { panels: ['color', 'swatches', 'navigator'], active: 'color', flex: 0, h: 226 },
        { panels: ['properties', 'adjustments', 'history', 'brushes', 'character', 'comps'], active: 'properties', flex: 1 },
        { panels: ['layers', 'channels', 'paths'], active: 'layers', flex: 1.3 },
      ] },
    ],
  };
  const defaultLayout = () => JSON.parse(JSON.stringify(innerWidth < 1500 ? DEFAULT_SINGLE : DEFAULT));
  P.layout = null;

  P.register = function (def) { P.defs[def.id] = def; };

  P.init = function (dockEl) {
    P.el = dockEl;
    const saved = S.store.get('layout', null);
    P.layout = saved && saved.cols && saved.v === 2 ? saved : defaultLayout();
    // make sure every panel appears somewhere (new panels added in updates)
    P.layout.cols.forEach((c) => c.groups.forEach((g) => { g.panels = g.panels.filter((p) => P.defs[p]); if (g.active && !P.defs[g.active]) g.active = g.panels[0]; }));
    const seen = new Set(); P.layout.cols.forEach((c) => c.groups.forEach((g) => g.panels.forEach((p) => seen.add(p))));
    P.layout.hidden = (P.layout.hidden || []).filter((id) => P.defs[id]);
    for (const id in P.defs) if (!seen.has(id) && !P.layout.hidden.includes(id)) {
      const def = P.defs[id];
      if (def.defaultHidden) { P.layout.hidden.push(id); continue; }
      // new panels join the group of the panel they belong near (e.g. Layer Comps next to History), else Properties
      let g = null;
      if (def.defaultNear) P.layout.cols.forEach((c) => c.groups.forEach((x) => { if (!g && x.panels.includes(def.defaultNear)) g = x; }));
      (g || P.layout.cols[1].groups[1]).panels.push(id);
    }
    P.render();
    // update panels on bus events
    const evs = new Set();
    for (const id in P.defs) (P.defs[id].events || []).forEach((e) => evs.add(e));
    evs.forEach((e) => S.bus.on(e, () => P.updateFor(e)));
  };
  P.save = function () { P.layout.v = 2; S.store.set('layout', P.layout); };

  /** Panels currently visible (active tab of an expanded group) */
  P.isShown = function (id) {
    for (const c of P.visibleCols()) for (const g of c.groups) if (g.active === id && !g.collapsed) return true;
    return false;
  };
  P.isVisible = function (id) { return P.layout.cols.some((c) => c.groups.some((g) => g.panels.includes(id))) && (P.layout.second || !P.layout.cols[0].groups.some((g) => g.panels.includes(id))); };
  P.visibleCols = () => P.layout.cols.filter((c, i) => i > 0 || P.layout.second);

  const pending = new Set();
  let scheduled = false;
  P.updateFor = function (evt) {
    for (const id in P.inst) {
      const def = P.defs[id];
      if (def && def.events && def.events.includes(evt)) pending.add(id);
    }
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      for (const id of pending) { if (P.isShown(id)) P.update(id); else if (P.inst[id]) P.inst[id].stale = true; }
      pending.clear();
    });
  };
  P.update = function (id) {
    const i = P.inst[id];
    if (!i || !i.api || !i.api.update) return;
    i.stale = false;
    try { i.api.update(); } catch (e) { console.error('[panel ' + id + ']', e); }
  };
  P.updateAll = function () { for (const id in P.inst) if (P.isShown(id)) P.update(id); else P.inst[id].stale = true; };

  /** Build (once) a panel body */
  function instance(id) {
    if (P.inst[id]) return P.inst[id];
    const def = P.defs[id];
    const body = U.el('div', { class: 'panel-body panel-' + id });
    const inst = { body, api: null, stale: true };
    P.inst[id] = inst;
    try { inst.api = def.build(body) || {}; } catch (e) { console.error('panel build failed', id, e); inst.api = {}; }
    return inst;
  }

  let dragPanel = null;
  P.render = function () {
    const el = P.el;
    el.innerHTML = '';
    P.visibleCols().forEach((col) => {
      const colEl = U.el('div', { class: 'dock-col', style: { width: col.width + 'px' } });
      // column resize handle (left edge)
      const rh = U.el('div', { class: 'dock-resize' });
      rh.addEventListener('pointerdown', (e) => {
        rh.setPointerCapture(e.pointerId); const x0 = e.clientX, w0 = col.width;
        rh.onpointermove = (ev) => { col.width = U.clamp(w0 - (ev.clientX - x0), 200, 520); colEl.style.width = col.width + 'px'; S.View.resize(); };
        rh.onpointerup = () => { rh.onpointermove = null; P.save(); };
      });
      colEl.appendChild(rh);
      col.groups = col.groups.filter((g) => g.panels.length);
      col.groups.forEach((g, gi) => {
        if (!g.panels.includes(g.active)) g.active = g.panels[0];
        const grp = U.el('div', { class: 'panel dock-group' + (g.collapsed ? ' collapsed' : '') });
        if (g.collapsed) grp.style.flex = '0 0 auto';
        else if (g.flex) grp.style.flex = g.flex + ' 1 0';
        else grp.style.flex = '0 0 ' + (g.h || 200) + 'px';
        const tabs = U.el('div', { class: 'tabs dock-tabs' });
        // crowded groups: inactive tabs collapse to icons
        const crowded = g.panels.reduce((a, pid) => a + ((P.defs[pid] && P.defs[pid].title.length) || 6) * 7.2 + 16, 0) > col.width - 30;
        g.panels.forEach((pid) => {
          const def = P.defs[pid]; if (!def) return;
          const iconOnly = crowded && pid !== g.active;
          const t = U.el('div', { class: 'tab' + (pid === g.active ? ' active' : '') + (iconOnly ? ' icon-tab' : ''), draggable: true, title: def.title, html: iconOnly ? S.icon(def.icon) : null }, iconOnly ? null : def.title);
          t.addEventListener('click', () => {
            if (g.active === pid && !g.collapsed) return;
            g.active = pid; g.collapsed = false; P.save(); P.render();
          });
          t.addEventListener('dragstart', (e) => { dragPanel = pid; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', pid); });
          t.addEventListener('dragend', () => { dragPanel = null; document.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target')); });
          tabs.appendChild(t);
        });
        tabs.appendChild(U.el('div', { class: 'spacer', style: { flex: 1 } }));
        const coll = U.el('button', { class: 'icon-btn tab-btn', html: S.icon(g.collapsed ? 'chevRight' : 'chevDown'), title: g.collapsed ? 'Expand' : 'Collapse' });
        coll.addEventListener('click', () => { g.collapsed = !g.collapsed; P.save(); P.render(); });
        tabs.appendChild(coll);
        tabs.addEventListener('dblclick', (e) => { if (e.target === tabs || e.target.classList.contains('spacer')) { g.collapsed = !g.collapsed; P.save(); P.render(); } });
        tabs.addEventListener('dragover', (e) => { if (dragPanel) { e.preventDefault(); tabs.classList.add('drop-target'); } });
        tabs.addEventListener('dragleave', () => tabs.classList.remove('drop-target'));
        tabs.addEventListener('drop', (e) => {
          e.preventDefault(); tabs.classList.remove('drop-target');
          const pid = dragPanel; if (!pid) return;
          P.layout.cols.forEach((c) => c.groups.forEach((x) => { x.panels = x.panels.filter((p) => p !== pid); }));
          g.panels.push(pid); g.active = pid; g.collapsed = false;
          P.save(); P.render();
        });
        grp.appendChild(tabs);
        if (!g.collapsed) {
          const inst = instance(g.active);
          grp.appendChild(inst.body);
          if (inst.stale) P.update(g.active);
        }
        // vertical splitter between fixed-height group and next
        if (gi < col.groups.length - 1 && !g.collapsed && !g.flex) {
          const sp = U.el('div', { class: 'group-split' });
          sp.addEventListener('pointerdown', (e) => {
            sp.setPointerCapture(e.pointerId); const y0 = e.clientY, h0 = g.h || 200;
            sp.onpointermove = (ev) => { g.h = U.clamp(h0 + ev.clientY - y0, 80, 700); grp.style.flex = '0 0 ' + g.h + 'px'; };
            sp.onpointerup = () => { sp.onpointermove = null; P.save(); };
          });
          grp.appendChild(sp);
        }
        colEl.appendChild(grp);
      });
      // drop zone at column bottom → new group
      const dz = U.el('div', { class: 'dock-dropzone' });
      dz.addEventListener('dragover', (e) => { if (dragPanel) { e.preventDefault(); dz.classList.add('drop-target'); } });
      dz.addEventListener('dragleave', () => dz.classList.remove('drop-target'));
      dz.addEventListener('drop', (e) => {
        e.preventDefault(); const pid = dragPanel; if (!pid) return;
        P.layout.cols.forEach((c) => c.groups.forEach((x) => { x.panels = x.panels.filter((p) => p !== pid); }));
        col.groups.push({ panels: [pid], active: pid, flex: 1 });
        P.save(); P.render();
      });
      colEl.appendChild(dz);
      el.appendChild(colEl);
    });
    requestAnimationFrame(() => S.View && S.View.resize && S.View.resize());
  };

  /** Show a panel (bring its tab to front, adding it to the default group if hidden) */
  P.show = function (id) {
    if (!P.defs[id]) return;
    let found = false;
    P.layout.cols.forEach((c, ci) => c.groups.forEach((g) => { if (g.panels.includes(id)) { g.active = id; g.collapsed = false; found = true; if (ci === 0 && !P.layout.second) P.layout.second = true; } }));
    if (!found) {
      // restore to default location
      let placed = false;
      DEFAULT.cols.forEach((dc, ci) => dc.groups.forEach((dg, gi) => {
        if (placed || !dg.panels.includes(id)) return;
        const col = P.layout.cols[ci]; let g = col.groups[gi];
        if (!g) { g = { panels: [], flex: 1 }; col.groups.push(g); }
        g.panels.push(id); g.active = id; g.collapsed = false; placed = true;
        if (ci === 0) P.layout.second = true;
      }));
      if (!placed) { P.layout.cols[1].groups[0].panels.push(id); P.layout.cols[1].groups[0].active = id; }
      P.layout.hidden = (P.layout.hidden || []).filter((x) => x !== id);
    }
    P.save(); P.render();
  };
  P.hide = function (id) {
    if (!P.defs[id]) return;
    P.layout.cols.forEach((c) => c.groups.forEach((g) => { g.panels = g.panels.filter((p) => p !== id); }));
    P.layout.hidden = [...new Set([...(P.layout.hidden || []), id])];
    P.save(); P.render();
  };
  P.toggle = function (id) { if (!P.defs[id]) return; if (P.isVisible(id)) P.hide(id); else P.show(id); };
  P.reset = function () { P.layout = defaultLayout(); P.save(); P.render(); };
  P.toggleSecondDock = function () { P.layout.second = !P.layout.second; P.save(); P.render(); };
  P.secondDockVisible = () => !!P.layout.second;
})();
