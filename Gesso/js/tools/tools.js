/* =========================================================================
   Gesso — tool registry, tool strip (with grouped flyouts) and the
   context-sensitive options bar.

   A tool is an object registered with S.Tools.register({...}):
     id, name, key, icon, group, opts (persisted defaults)
     options(bar)          build options-bar UI (use S.Tools.ui helpers)
     onDown/onMove/onUp(info, doc), onHover, onDblClick, onKey(e) → bool
     activate(), deactivate(), commit(), cancel()
     drawOverlay(ctx, doc)  screen space,  drawDocPreview(ctx, doc) doc space
     brushCursor() → diameter (doc px) to show the round brush cursor
     cursor: CSS cursor (string or fn)
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util;

  const T = (S.Tools = {
    list: [], byId: {}, groups: [],
    GROUP_ORDER: ['move', 'marquee', 'lasso', 'wand', 'crop', 'eyedropper', 'heal', 'brush', 'clone', 'eraser', 'fill', 'blur', 'dodge', 'warp', 'pen', 'text', 'pathsel', 'shape', 'hand', 'zoom'],
    groupActive: {}, // group -> last used tool id
  });

  T.register = function (tool) {
    const saved = S.store.get('toolopts', {})[tool.id];
    tool.opts = Object.assign({}, tool.opts || {}, saved || {});
    tool.defaults = JSON.parse(JSON.stringify(tool.opts));
    T.list.push(tool); T.byId[tool.id] = tool;
    if (!T.groupActive[tool.group]) T.groupActive[tool.group] = tool.id;
    return tool;
  };
  T.saveOpts = U.debounce(() => {
    const all = {};
    for (const t of T.list) all[t.id] = t.opts;
    S.store.set('toolopts', all);
  }, 400);

  T.select = function (id) {
    const t = T.byId[id];
    if (!t) return;
    const prev = S.app.tool;
    if (prev === t) return;
    if (prev) {
      if (prev.commitOnSwitch) prev.commitOnSwitch();
      if (prev.deactivate) prev.deactivate();
    }
    S.app.tool = t;
    T.groupActive[t.group] = id;
    S.store.set('lastTool', id);
    if (t.activate) t.activate();
    T.renderStrip();
    T.renderOptions();
    S.View.updateCursor();
    S.View.redraw();
    S.bus.emit('tool:changed', t);
  };
  /** keyboard: press letter selects group's current tool; Shift+letter cycles group */
  T.byKey = function (key, cycle) {
    key = key.toUpperCase();
    const groupTools = T.list.filter((t) => t.key === key);
    if (!groupTools.length) return false;
    const cur = S.app.tool;
    if (cycle && cur && cur.key === key) {
      const i = groupTools.indexOf(cur);
      T.select(groupTools[(i + 1) % groupTools.length].id);
    } else {
      const g = groupTools[0].group;
      const last = T.byId[T.groupActive[g]];
      T.select(last && last.key === key ? last.id : groupTools[0].id);
    }
    return true;
  };

  /* ---------------- Tool strip ---------------- */
  T.initStrip = function (el) {
    T.stripEl = el;
    T.renderStrip();
  };
  T.renderStrip = function () {
    const el = T.stripEl; if (!el) return;
    el.innerHTML = '';
    const tools = U.el('div', { class: 'tool-buttons' });
    const seps = { crop: 1, eyedropper: 0, heal: 1, pen: 1, hand: 1 };
    for (const g of T.GROUP_ORDER) {
      const members = T.list.filter((t) => t.group === g);
      if (!members.length) continue;
      if (seps[g]) tools.appendChild(U.el('div', { class: 'tool-sep' }));
      const t = T.byId[T.groupActive[g]] || members[0];
      const active = S.app.tool && S.app.tool.group === g;
      const b = U.el('button', { class: 'icon-btn tool-btn' + (active ? ' active' : ''), html: S.icon(t.icon), 'data-tip': t.name + ' (' + t.key + ')', 'data-tool': t.id });
      if (members.length > 1) b.appendChild(U.el('span', { class: 'flyout-mark' }));
      let timer = null;
      const openFly = () => {
        const r = b.getBoundingClientRect();
        S.Menu.show(members.map((m) => ({ label: m.name, icon: m.icon, kbd: m.key, checked: m === t, run: () => T.select(m.id) })), r.right + 4, r.top, 0);
      };
      b.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (members.length > 1) timer = setTimeout(() => { timer = null; openFly(); }, 350);
      });
      b.addEventListener('pointerup', (e) => {
        if (e.button !== 0) return;
        if (timer) { clearTimeout(timer); timer = null; T.select(t.id); }
        else if (members.length === 1) T.select(t.id);
      });
      b.addEventListener('pointerleave', () => { if (timer) { clearTimeout(timer); timer = null; } });
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); if (members.length > 1) openFly(); });
      tools.appendChild(b);
    }
    el.appendChild(tools);
    // colors
    const colors = U.el('div', { class: 'tool-colors' });
    const fg = U.el('button', { class: 'swatch-fg', title: 'Foreground color (click to edit)', style: { background: S.app.fg } });
    const bg = U.el('button', { class: 'swatch-bg', title: 'Background color (click to edit)', style: { background: S.app.bg } });
    const sw = U.el('button', { class: 'mini-btn swap', html: '<svg viewBox="0 0 24 24"><path d="M6 9V7a2 2 0 012-2h9M14 2l3 3-3 3M18 15v2a2 2 0 01-2 2H7M10 22l-3-3 3-3"/></svg>', title: 'Swap colors (X)' });
    const df = U.el('button', { class: 'mini-btn reset', html: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="10" height="10" fill="#000" stroke="#c8bdb1"/><rect x="11" y="11" width="10" height="10" fill="#fff" stroke="#c8bdb1"/></svg>', title: 'Default colors (D)' });
    fg.addEventListener('click', () => S.ColorPicker.open(S.app.fg, null, (c) => S.App.setFg(c), { title: 'Foreground Color' }));
    bg.addEventListener('click', () => S.ColorPicker.open(S.app.bg, null, (c) => S.App.setBg(c), { title: 'Background Color' }));
    sw.addEventListener('click', () => S.Cmd.run('color.swap'));
    df.addEventListener('click', () => S.Cmd.run('color.default'));
    colors.append(bg, fg, sw, df);
    el.appendChild(colors);
    const qm = U.el('button', { class: 'icon-btn tool-btn' + (S.app.doc && S.app.doc.quickMask ? ' active' : ''), html: S.icon('quickMask'), 'data-tip': 'Quick Mask (Q)' });
    qm.addEventListener('click', () => S.Cmd.run('select.quickMask'));
    el.appendChild(qm);
  };

  /* ---------------- Options bar ---------------- */
  T.initOptions = function (el) { T.optsEl = el; S.bus.on('tool:options', () => T.syncOptions()); };
  T.renderOptions = function () {
    const el = T.optsEl, t = S.app.tool;
    if (!el) return;
    el.innerHTML = '';
    if (!t) return;
    el.appendChild(U.el('div', { class: 'opt-tool' }, [U.el('span', { class: 'opt-tool-ico', html: S.icon(t.icon) }), U.el('span', {}, t.name)]));
    el.appendChild(U.el('div', { class: 'sep' }));
    T._syncers = [];
    if (t.options) t.options(el);
    const reset = U.el('button', { class: 'icon-btn opt-reset', html: S.icon('undo'), 'data-tip': 'Reset tool options', 'data-tip-pos': 'bottom' });
    reset.addEventListener('click', () => { t.opts = JSON.parse(JSON.stringify(t.defaults)); T.saveOpts(); T.renderOptions(); S.View.redraw(); });
    el.appendChild(U.el('div', { style: { flex: 1 } }));
    el.appendChild(reset);
  };
  T.syncOptions = function () { (T._syncers || []).forEach((f) => f()); };

  /* ---------- options-bar control helpers ---------- */
  const ui = (T.ui = {});
  /** Compact numeric control with scrubby label and popup slider */
  ui.num = function (bar, label, obj, key, min, max, opts) {
    opts = opts || {};
    const unit = opts.unit || '';
    const wrap = U.el('div', { class: 'opt-num' });
    const lab = U.el('span', { class: 'opt-label scrub', title: 'Drag to adjust' }, label);
    const inp = U.el('input', { type: 'number', min, max, step: opts.step || 1 });
    const drop = U.el('button', { class: 'opt-drop', html: '<svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5"/></svg>' });
    const scale = opts.scale || 1; // stored value = shown / scale
    const get = () => obj[key] * scale;
    const set = (v, final) => {
      v = U.clamp(+v, min, max); if (isNaN(v)) return;
      obj[key] = opts.step && opts.step < 1 ? v / scale : Math.round(v) / scale;
      inp.value = U.fmt(get(), 2);
      opts.onChange && opts.onChange(obj[key], final);
      T.saveOpts(); S.View.redraw();
    };
    inp.value = U.fmt(get(), 2);
    inp.addEventListener('change', () => set(inp.value, true));
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') inp.blur(); });
    lab.addEventListener('pointerdown', (e) => {
      const x0 = e.clientX, v0 = get();
      lab.setPointerCapture(e.pointerId);
      lab.onpointermove = (ev) => set(v0 + ((ev.clientX - x0) * (max - min)) / 400, false);
      lab.onpointerup = () => { lab.onpointermove = null; set(get(), true); };
    });
    drop.addEventListener('click', () => {
      const r = wrap.getBoundingClientRect();
      const pop = U.el('div', { class: 'menu opt-pop' });
      const rng = U.el('input', { type: 'range', min, max, step: opts.step || 1, value: get() });
      rng.addEventListener('input', () => set(rng.value, false));
      rng.addEventListener('change', () => set(rng.value, true));
      pop.appendChild(rng);
      pop.style.left = r.left + 'px'; pop.style.top = r.bottom + 4 + 'px';
      document.body.appendChild(pop);
      const close = (ev) => { if (!pop.contains(ev.target)) { pop.remove(); removeEventListener('mousedown', close, true); } };
      setTimeout(() => addEventListener('mousedown', close, true), 0);
    });
    wrap.append(lab, inp);
    if (unit) wrap.appendChild(U.el('span', { class: 'opt-unit' }, unit));
    wrap.appendChild(drop);
    bar.appendChild(wrap);
    (T._syncers = T._syncers || []).push(() => { if (document.activeElement !== inp) inp.value = U.fmt(get(), 2); });
    return wrap;
  };
  ui.check = function (bar, label, obj, key, onChange) {
    const l = U.el('label', { class: 'opt-check' });
    const c = U.el('input', { type: 'checkbox', checked: !!obj[key] });
    c.addEventListener('change', () => { obj[key] = c.checked; T.saveOpts(); onChange && onChange(c.checked); S.View.redraw(); });
    l.append(c, U.el('span', {}, label));
    bar.appendChild(l);
    (T._syncers = T._syncers || []).push(() => { c.checked = !!obj[key]; });
    return l;
  };
  ui.select = function (bar, label, obj, key, options, onChange) {
    const w = U.el('div', { class: 'opt-sel' });
    if (label) w.appendChild(U.el('span', { class: 'opt-label' }, label));
    const s = U.el('select');
    for (const o of options) {
      if (o === '-') { s.appendChild(U.el('option', { disabled: true }, '──────')); continue; }
      const op = typeof o === 'object' ? o : { value: o, label: o };
      s.appendChild(U.el('option', { value: op.value }, op.label));
    }
    s.value = obj[key];
    s.addEventListener('change', () => { obj[key] = isNaN(+s.value) || s.value === '' ? s.value : +s.value; T.saveOpts(); onChange && onChange(obj[key]); S.View.redraw(); s.blur(); });
    w.appendChild(s);
    bar.appendChild(w);
    (T._syncers = T._syncers || []).push(() => { s.value = obj[key]; });
    return w;
  };
  ui.blend = function (bar, obj, key = 'blend', label = 'Mode') {
    const w = ui.select(bar, label, obj, key, []);
    const s = w.querySelector('select');
    S.blendOptions(s);
    // painting modes extra: behind & clear
    s.insertBefore(U.el('option', { value: 'behind' }, 'Behind'), s.children[2]);
    s.insertBefore(U.el('option', { value: 'clear' }, 'Clear'), s.children[3]);
    s.value = obj[key] || 'normal';
    return w;
  };
  /** segmented icon buttons: items [{value, icon, tip}] */
  ui.seg = function (bar, obj, key, items, onChange) {
    const w = U.el('div', { class: 'opt-seg' });
    const btns = items.map((it) => {
      const b = U.el('button', { class: 'icon-btn' + (obj[key] === it.value ? ' active' : ''), html: it.icon ? S.icon(it.icon) : '', 'data-tip': it.tip, 'data-tip-pos': 'bottom' }, it.icon ? null : it.label);
      b.addEventListener('click', () => { obj[key] = it.value; btns.forEach((x) => x.classList.remove('active')); b.classList.add('active'); T.saveOpts(); onChange && onChange(it.value); S.View.redraw(); });
      w.appendChild(b);
      return b;
    });
    bar.appendChild(w);
    (T._syncers = T._syncers || []).push(() => btns.forEach((b, i) => b.classList.toggle('active', obj[key] === items[i].value)));
    return w;
  };
  ui.button = function (bar, label, run, opts) {
    opts = opts || {};
    const b = U.el('button', { class: opts.icon && !label ? 'icon-btn' : 'btn btn-sm' + (opts.primary ? ' primary' : ''), html: opts.icon ? S.icon(opts.icon) + (label ? '<span>' + label + '</span>' : '') : null, 'data-tip': opts.tip, 'data-tip-pos': 'bottom' }, opts.icon ? null : label);
    b.addEventListener('click', run);
    bar.appendChild(b);
    return b;
  };
  ui.sep = (bar) => bar.appendChild(U.el('div', { class: 'sep' }));
  ui.color = function (bar, label, obj, key, onChange) {
    const w = U.el('div', { class: 'opt-sel' });
    if (label) w.appendChild(U.el('span', { class: 'opt-label' }, label));
    const b = U.el('button', { class: 'color-chip', style: { background: obj[key] } });
    b.addEventListener('click', () => S.ColorPicker.open(obj[key], (c) => { obj[key] = c; b.style.background = c; onChange && onChange(c, false); }, (c) => { obj[key] = c; b.style.background = c; T.saveOpts(); onChange && onChange(c, true); }));
    w.appendChild(b);
    bar.appendChild(w);
    (T._syncers = T._syncers || []).push(() => { b.style.background = obj[key]; });
    return w;
  };
  /** Selection mode buttons (new/add/subtract/intersect) shared by selection tools */
  ui.selMode = function (bar, obj) {
    return ui.seg(bar, obj, 'mode', [
      { value: 'new', icon: 'selNew', tip: 'New selection' }, { value: 'add', icon: 'selAdd', tip: 'Add to selection (Shift)' },
      { value: 'subtract', icon: 'selSub', tip: 'Subtract from selection (Alt)' }, { value: 'intersect', icon: 'selInt', tip: 'Intersect with selection (Shift+Alt)' },
    ]);
  };
  /** Resolve modifier keys into a selection mode */
  T.selModeFrom = function (info, base) {
    if (info.shift && info.alt) return 'intersect';
    if (info.shift) return 'add';
    if (info.alt) return 'subtract';
    return base || 'new';
  };
})();
