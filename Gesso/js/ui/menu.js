/* =========================================================================
   Gesso — menus: menubar dropdowns and context menus.
   Menu item spec:
     '-'                                  divider
     { cmd: 'edit.undo' }                 label/shortcut/enabled come from S.Cmd
     { label, run, kbd, disabled, checked, sub: [items] | () => [items] }
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util;
  const M = (S.Menu = {});
  let openStack = []; // currently open menu elements (root first)
  let barState = null;

  function resolve(item) {
    if (item === '-' || item == null) return item;
    if (item.cmd) {
      const c = S.Cmd.get(item.cmd);
      if (!c) return { label: item.cmd + ' (missing)', disabled: true };
      return {
        label: item.label || c.label,
        kbd: S.Cmd.keyLabel(item.cmd),
        run: () => S.Cmd.run(item.cmd, item.arg),
        disabled: c.enabled ? !c.enabled(item.arg) : false,
        checked: c.checked ? c.checked(item.arg) : undefined,
      };
    }
    return item;
  }

  M.closeAll = function () {
    openStack.forEach((m) => m.remove());
    openStack = [];
    if (barState) { barState.titles.forEach((t) => t.classList.remove('open')); barState.active = false; }
  };
  function closeFrom(level) {
    while (openStack.length > level) openStack.pop().remove();
  }

  /** Show a menu at screen position. level = nesting depth */
  M.show = function (items, x, y, level = 0, anchorRect) {
    closeFrom(level);
    if (typeof items === 'function') items = items();
    const menu = U.el('div', { class: 'menu gesso-menu' });
    menu._openedAt = performance.now(); menu._ctx = openingContext;
    let lastWasDivider = true;
    items.map(resolve).forEach((it, idx, arr) => {
      if (it === '-' || it == null) {
        if (!lastWasDivider && idx < arr.length - 1) menu.appendChild(U.el('div', { class: 'divider' }));
        lastWasDivider = true; return;
      }
      if (it.hidden) return;
      lastWasDivider = false;
      if (it.header) { menu.appendChild(U.el('div', { class: 'menu-header' }, it.header)); return; }
      const row = U.el('div', { class: 'item' + (it.disabled ? ' disabled' : '') + (it.sub ? ' has-sub' : '') });
      const left = U.el('span', { class: 'item-label' });
      left.appendChild(U.el('span', { class: 'check' }, it.checked ? '✓' : ''));
      if (it.icon) left.appendChild(U.el('span', { class: 'mi-icon', html: S.icon(it.icon) }));
      left.appendChild(document.createTextNode(it.label));
      row.appendChild(left);
      if (it.kbd) row.appendChild(U.el('span', { class: 'kbd' }, it.kbd));
      if (it.swatch) row.appendChild(U.el('span', { class: 'menu-swatch', style: { background: it.swatch } }));
      row.addEventListener('mouseenter', () => {
        menu.querySelectorAll('.item.hot').forEach((e) => e.classList.remove('hot'));
        row.classList.add('hot');
        if (it.sub) {
          const r = row.getBoundingClientRect();
          M.show(it.sub, r.right - 2, r.top - 4, level + 1, r);
        } else closeFrom(level + 1);
      });
      row.addEventListener('mouseup', (e) => {
        if (it.disabled || it.sub) return;
        // the gesture that opened the menu must not also pick an item: a right-button release (Linux/macOS fire
        // 'contextmenu' on mousedown, so the mouseup lands on the freshly opened menu) or any release within the
        // first 150 ms is ignored
        if (e.button !== 0 || (menu._ctx && performance.now() - menu._openedAt < 150)) return;
        e.stopPropagation();
        M.closeAll();
        setTimeout(() => { try { it.run && it.run(); } catch (err) { console.error(err); S.toast('Error: ' + err.message); } }, 0);
      });
      row.addEventListener('mousedown', (e) => e.stopPropagation());
      menu.appendChild(row);
    });
    if (lastWasDivider && menu.lastChild && menu.lastChild.classList.contains('divider')) menu.lastChild.remove();
    document.body.appendChild(menu);
    // keep inside the viewport
    const r = menu.getBoundingClientRect();
    let px = x, py = y;
    if (px + r.width > innerWidth - 4) px = anchorRect ? anchorRect.left - r.width + 2 : innerWidth - r.width - 4;
    if (py + r.height > innerHeight - 4) py = Math.max(4, innerHeight - r.height - 4);
    menu.style.left = Math.max(2, px) + 'px';
    menu.style.top = py + 'px';
    menu.style.maxHeight = innerHeight - 8 + 'px';
    menu.style.overflowY = r.height > innerHeight - 8 ? 'auto' : '';
    openStack.push(menu);
    return menu;
  };

  let openingContext = false;
  M.context = function (items, ev) {
    ev.preventDefault();
    M.closeAll();
    openingContext = true;
    try { M.show(items, ev.clientX, ev.clientY, 0); } finally { openingContext = false; }
  };

  /** Build a menubar. menus: [{title, items}] */
  M.bar = function (container, menus) {
    const titles = [];
    barState = { titles, active: false };
    menus.forEach((m) => {
      const t = U.el('div', { class: 'menu-title' }, m.title);
      t.dataset.menu = m.title;
      const open = () => {
        titles.forEach((x) => x.classList.remove('open'));
        t.classList.add('open');
        const r = t.getBoundingClientRect();
        M.show(m.items, r.left, r.bottom + 2, 0);
        barState.active = true;
      };
      t.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (barState.active && t.classList.contains('open')) { M.closeAll(); return; }
        open();
      });
      t.addEventListener('mouseenter', () => { if (barState.active && !t.classList.contains('open')) open(); });
      container.appendChild(t);
      titles.push(t);
    });
  };

  document.addEventListener('mousedown', (e) => {
    if (!openStack.length) return;
    if (openStack.some((m) => m.contains(e.target))) return;
    M.closeAll();
  });
  window.addEventListener('blur', () => M.closeAll());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openStack.length) { M.closeAll(); e.stopPropagation(); } }, true);
  M.isOpen = () => openStack.length > 0;
})();
