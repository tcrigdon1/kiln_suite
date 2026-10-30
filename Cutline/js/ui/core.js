/* Cutline — UI primitives: toasts, dialogs, menus, progress, form fields, split panes. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, h = U.h;
  var ui = C.ui = {};

  /* ---------- Toast ---------- */
  var toastWrap;
  C.toast = function (msg, ms) {
    if (!toastWrap) { toastWrap = h('div.toast-wrap'); document.body.appendChild(toastWrap); }
    var t = h('div.toast', msg);
    toastWrap.appendChild(t);
    while (toastWrap.children.length > 4) toastWrap.firstChild.remove();
    setTimeout(function () { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 320); }, ms || 2200);
  };
  ui.toast = C.toast;

  /* ---------- Dialog ---------- */
  ui.openDialogs = [];
  ui.dialog = function (o) {
    var back = h('div.modal-backdrop');
    var foot = h('div.dialog-foot');
    var closeBtn = h('button.icon-btn', { title: 'Close', html: C.icon('close') });
    var dlg = h('div.dialog' + (o.cls ? '.' + o.cls : ''), { style: { width: o.width ? o.width + 'px' : null } },
      h('div.dialog-head', h('span', o.title || ''), h('div.spacer'), o.closable === false ? null : closeBtn),
      h('div.dialog-body', o.body),
      (o.buttons && o.buttons.length) ? foot : null);
    back.appendChild(dlg);
    var api = {
      el: dlg, back: back, closed: false,
      close: function (v) {
        if (api.closed) return; api.closed = true;
        back.remove(); ui.openDialogs.splice(ui.openDialogs.indexOf(api), 1);
        document.removeEventListener('keydown', onKey, true);
        if (o.onClose) o.onClose(v);
      }
    };
    (o.buttons || []).forEach(function (b) {
      var btn = h('button.btn' + (b.primary ? '.primary' : '') + (b.danger ? '.danger' : ''), b.label);
      if (b.left) btn.style.marginRight = 'auto';
      btn.addEventListener('click', function () { var r = b.action ? b.action(api) : undefined; if (r !== false) api.close(b.value); });
      foot.appendChild(btn);
      if (b.id) api[b.id] = btn;
    });
    closeBtn.addEventListener('click', function () { api.close(); });
    function onKey(e) {
      if (ui.openDialogs[ui.openDialogs.length - 1] !== api) return;
      if (e.key === 'Escape' && o.closable !== false) { e.preventDefault(); e.stopPropagation(); api.close(); }
      else if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA' && o.enterKey !== false) {
        var pb = (o.buttons || []).filter(function (b) { return b.primary; })[0];
        if (pb) { e.preventDefault(); e.stopPropagation(); var r = pb.action ? pb.action(api) : undefined; if (r !== false) api.close(pb.value); }
      }
      e.stopPropagation();
    }
    document.addEventListener('keydown', onKey, true);
    if (o.backdropClose) back.addEventListener('pointerdown', function (e) { if (e.target === back) api.close(); });
    document.body.appendChild(back);
    ui.openDialogs.push(api);
    setTimeout(function () { var f = dlg.querySelector('[autofocus], input[type=text], textarea'); if (f) { f.focus(); if (f.select) f.select(); } }, 20);
    return api;
  };
  ui.alert = function (title, msg) {
    return new Promise(function (res) { ui.dialog({ title: title, body: h('div', { style: { maxWidth: '460px', lineHeight: '1.5' } }, msg), buttons: [{ label: 'OK', primary: true }], onClose: function () { res(); } }); });
  };
  ui.confirm = function (msg, ok, title) {
    return new Promise(function (res) {
      var v = false;
      ui.dialog({ title: title || 'Confirm', body: h('div', { style: { maxWidth: '440px', lineHeight: '1.5' } }, msg),
        buttons: [{ label: 'Cancel' }, { label: ok || 'OK', primary: true, action: function () { v = true; } }], onClose: function () { res(v); } });
    });
  };
  ui.prompt = function (title, value, label) {
    return new Promise(function (res) {
      var inp = h('input', { type: 'text', value: value || '', style: { width: '320px' }, autofocus: true });
      var v = null;
      ui.dialog({ title: title, body: h('div', label ? h('div.muted', { style: { marginBottom: '6px' } }, label) : null, inp),
        buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, action: function () { v = inp.value; } }], onClose: function () { res(v); } });
    });
  };

  /* ---------- Context / dropdown menus ---------- */
  var openMenu = null;
  ui.closeMenus = function () { if (openMenu) { openMenu.forEach(function (m) { m.remove(); }); openMenu = null; } if (ui.onMenuClose) { var f = ui.onMenuClose; ui.onMenuClose = null; f(); } };
  function buildMenu(items, x, y, level) {
    var m = h('div.menu.cl-menu');
    items.forEach(function (it) {
      if (!it) return;
      if (it === '-') { m.appendChild(h('div.divider')); return; }
      if (it.header) { m.appendChild(h('div.menu-header', it.header)); return; }
      var disabled = typeof it.disabled === 'function' ? it.disabled() : it.disabled;
      var checked = typeof it.checked === 'function' ? it.checked() : it.checked;
      var row = h('div.item' + (disabled ? '.disabled' : '') + (it.sub ? '.has-sub' : ''),
        h('span.lbl', h('span.chk', checked ? '✓' : ''), it.label),
        it.kbd ? h('span.kbd', it.kbd) : null);
      if (it.sub) {
        row.addEventListener('mouseenter', function () {
          while (openMenu.length > level + 1) openMenu.pop().remove();
          var r = row.getBoundingClientRect();
          var sub = buildMenu(typeof it.sub === 'function' ? it.sub() : it.sub, r.right - 2, r.top - 4, level + 1);
          openMenu.push(sub);
        });
      } else {
        row.addEventListener('mouseenter', function () { while (openMenu && openMenu.length > level + 1) openMenu.pop().remove(); });
        row.addEventListener('click', function (e) { e.stopPropagation(); ui.closeMenus(); if (it.action) setTimeout(function () { it.action(); }, 0); });
      }
      m.appendChild(row);
    });
    document.body.appendChild(m);
    var r = m.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 4) x = Math.max(4, (level ? x - r.width - 220 + 4 : window.innerWidth - r.width - 4));
    if (y + r.height > window.innerHeight - 4) y = Math.max(4, window.innerHeight - r.height - 4);
    m.style.left = x + 'px'; m.style.top = y + 'px';
    return m;
  }
  ui.menu = function (items, x, y) {
    ui.closeMenus();
    openMenu = [];
    openMenu.push(buildMenu(items, x, y, 0));
  };
  document.addEventListener('pointerdown', function (e) {
    if (openMenu && !e.target.closest('.cl-menu') && !e.target.closest('.menu-title')) ui.closeMenus();
  }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && openMenu) { ui.closeMenus(); e.stopPropagation(); } }, true);
  window.addEventListener('blur', function () { ui.closeMenus(); });

  /* ---------- Progress ---------- */
  ui.progress = function (title, opts) {
    opts = opts || {};
    var bar = h('div.cl-progress-fill'), txt = h('div.muted.cl-progress-text', ''), cancelled = false;
    var d = ui.dialog({ title: title, closable: false, enterKey: false,
      body: h('div', { style: { width: '400px' } }, h('div.cl-progress', bar), txt),
      buttons: opts.cancel ? [{ label: 'Cancel', id: 'cancelBtn', action: function () { if (cancelled) return false; cancelled = true; opts.cancel(); txt.textContent = 'Cancelling…'; if (d.cancelBtn) d.cancelBtn.disabled = true; return false; } }] : [] });
    return {
      update: function (p, t) { bar.style.width = (U.clamp(p, 0, 1) * 100).toFixed(1) + '%'; if (t != null && !cancelled) txt.textContent = t; },
      done: function () { d.close(); },
      get cancelled() { return cancelled; }
    };
  };

  /* ---------- Fields ---------- */
  // Numeric field with scrubbable label, range slider and number input.
  // o: {label, min, max, step, value, unit, slider:true, onInput(v), onCommit(v), extra (node), kf (node), width}
  ui.numField = function (o) {
    var step = o.step || 1, dec = step < 1 ? Math.max(0, Math.ceil(-Math.log10(step))) : 0;
    var lab = h('label.scrub', { title: o.label + ' — drag to adjust · double-click to reset' }, o.label);
    var num = h('input', { type: 'number', step: step });
    var rng = o.slider === false ? null : h('input', { type: 'range', min: o.min, max: o.max, step: step });
    var cur = o.value;
    function fmt(v) { return (+v).toFixed(dec); }
    function set(v) { cur = v; num.value = fmt(v); if (rng) rng.value = v; }
    function clampv(v) { if (o.min != null && o.softMin == null) v = Math.max(o.min, v); if (o.max != null && o.softMax == null) v = Math.min(o.max, v); return v; }
    set(o.value);
    var startVal = null;
    function begin() { if (startVal == null) startVal = cur; }
    function input(v) { begin(); v = clampv(v); set(v); if (o.onInput) o.onInput(v); }
    function commit() { if (startVal != null && startVal !== cur && o.onCommit) o.onCommit(cur); startVal = null; }
    if (rng) {
      rng.addEventListener('input', function () { input(parseFloat(rng.value)); });
      rng.addEventListener('change', commit);
    }
    num.addEventListener('input', function () { var v = parseFloat(num.value); if (!isNaN(v)) { begin(); v = clampv(v); cur = v; if (rng) rng.value = v; if (o.onInput) o.onInput(v); } });
    num.addEventListener('change', function () { set(cur); commit(); });
    num.addEventListener('keydown', function (e) { if (e.key === 'Enter') { num.blur(); } e.stopPropagation(); });
    lab.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      var v0 = cur, range = (o.max - o.min) || 100;
      var perPx = o.dragStep || Math.max(step, range / 300);
      document.body.classList.add('cl-scrubbing');
      U.drag(e, function (dx, dy, ev) { var k = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1; input(Math.round((v0 + dx * perPx * k) / step) * step); },
        function () { document.body.classList.remove('cl-scrubbing'); commit(); });
    });
    lab.addEventListener('dblclick', function () { if (o.def != null) { begin(); input(o.def); commit(); } });
    var row = h('div.field.cl-field' + (rng ? '' : '.no-slider'), o.kf || null, lab, rng || h('span'), h('div.num-wrap', num, o.unit ? h('span.unit', o.unit.trim()) : null), o.extra || null);
    row.set = function (v) { if (startVal == null && document.activeElement !== num) set(v); };
    row.input = num; row.range = rng;
    return row;
  };
  ui.selectField = function (label, options, value, onChange) {
    var s = h('select');
    options.forEach(function (op) { var v = Array.isArray(op) ? op[0] : op, t = Array.isArray(op) ? op[1] : op; s.appendChild(h('option', { value: v }, t)); });
    s.value = value;
    s.addEventListener('change', function () { onChange(s.value); });
    var row = h('div.field.cl-field.wide', h('label', label), s);
    row.set = function (v) { s.value = v; }; row.select = s;
    return row;
  };
  ui.colorField = function (label, value, onInput, onCommit) {
    var c = h('input', { type: 'color', value: value || '#000000' });
    var hex = h('span.hex', value);
    c.addEventListener('input', function () { hex.textContent = c.value; if (onInput) onInput(c.value); });
    c.addEventListener('change', function () { if (onCommit) onCommit(c.value); });
    var row = h('div.field.cl-field.wide', h('label', label), h('div.row', c, hex));
    row.set = function (v) { c.value = v; hex.textContent = v; };
    return row;
  };
  ui.checkField = function (label, value, onChange, opts) {
    var c = h('input', { type: 'checkbox', checked: !!value });
    c.addEventListener('change', function () { onChange(c.checked); });
    var row = h('label.cl-check', c, h('span', label));
    if (opts && opts.title) row.title = opts.title;
    row.set = function (v) { c.checked = !!v; };
    return row;
  };
  ui.textField = function (label, value, onChange, multi) {
    var i = multi ? h('textarea', { rows: 3 }) : h('input', { type: 'text' });
    i.value = value || '';
    i.addEventListener('keydown', function (e) { e.stopPropagation(); });
    i.addEventListener(multi ? 'input' : 'change', function () { onChange(i.value, false); });
    if (multi) i.addEventListener('change', function () { onChange(i.value, true); });
    var row = h('div.cl-textfield', label ? h('label', label) : null, i);
    row.set = function (v) { if (document.activeElement !== i) i.value = v; };
    row.input = i;
    return row;
  };
  ui.section = function (title, opts) {
    opts = opts || {};
    var body = h('div.sec-body');
    var head = h('div.sec-head', h('span.caret', { html: C.icon('chevdown') }), h('span.sec-title', title), h('span.spacer'), opts.tools || null);
    var sec = h('div.cl-section', head, body);
    var key = opts.key ? 'sec.' + opts.key : null;
    if (key && U.lsGet(key, false)) sec.classList.add('collapsed');
    head.addEventListener('click', function (e) {
      if (e.target.closest('.sec-tools, button, input, select')) return;
      sec.classList.toggle('collapsed');
      if (key) U.lsSet(key, sec.classList.contains('collapsed'));
    });
    sec.body = body; sec.head = head;
    return sec;
  };
  ui.iconBtn = function (icon, tip, onClick, opts) {
    opts = opts || {};
    var b = h('button.icon-btn' + (opts.cls ? '.' + opts.cls : ''), { html: C.icon(icon), 'data-tip': tip || null, 'aria-label': tip || icon });
    if (opts.tipPos) b.setAttribute('data-tip-pos', opts.tipPos);
    // toolbar buttons give focus back after a click so Space keeps meaning play/pause (not "press this button again")
    b.addEventListener('click', function (e) { if (onClick) onClick(e, b); try { b.blur(); } catch (x) { } });
    return b;
  };

  /* ---------- Tabs ---------- */
  ui.tabs = function (bar, tabs, onSelect, initial) {
    var els = {};
    tabs.forEach(function (t) {
      var el = h('div.tab', { 'data-id': t.id }, t.label);
      el.addEventListener('click', function () { api.select(t.id); });
      bar.appendChild(el); els[t.id] = el;
    });
    var api = {
      current: null,
      select: function (id) {
        if (!els[id]) return;
        Object.keys(els).forEach(function (k) { els[k].classList.toggle('active', k === id); });
        api.current = id;
        onSelect(id);
      }, els: els
    };
    if (initial) api.select(initial);
    return api;
  };

  /* ---------- Split panes ---------- */
  ui.LAYOUT_DEFAULT = { binW: 300, srcW: 0.5, rightW: 340, topH: 0.5 };
  ui.layout = Object.assign({}, ui.LAYOUT_DEFAULT, U.lsGet('layout', {}));
  ui.applyLayout = function () {
    var L = ui.layout, r = document.documentElement.style;
    r.setProperty('--bin-w', L.binW + 'px');
    r.setProperty('--right-w', L.rightW + 'px');
    r.setProperty('--top-frac', L.topH);
    r.setProperty('--src-frac', L.srcW);
    document.body.classList.toggle('no-source', !!L.hideSource);
    C.bus.emit('layout');
  };
  ui.saveLayout = function () { U.lsSet('layout', ui.layout); };
  ui.resetLayout = function () { ui.layout = Object.assign({}, ui.LAYOUT_DEFAULT); ui.saveLayout(); ui.applyLayout(); };
  ui.initSplitters = function () {
    U.$$('[data-split]').forEach(function (el) {
      el.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        var which = el.getAttribute('data-split'), L = ui.layout, start = Object.assign({}, L);
        var top = U.$('#toprow'), left = U.$('#leftcol');
        document.body.classList.add('cl-resizing', which === 'top' ? 'row-resize' : 'col-resize');
        U.drag(e, function (dx, dy) {
          if (which === 'bin') L.binW = U.clamp(start.binW + dx, 180, 700);
          else if (which === 'right') L.rightW = U.clamp(start.rightW - dx, 260, 720);
          else if (which === 'source') {
            var avail = top.clientWidth - L.binW - 8;
            L.srcW = U.clamp(start.srcW + dx / Math.max(1, avail), 0.15, 0.85);
          } else if (which === 'top') L.topH = U.clamp(start.topH + dy / Math.max(1, left.clientHeight), 0.18, 0.82);
          ui.applyLayout();
        }, function () { document.body.classList.remove('cl-resizing', 'row-resize', 'col-resize'); ui.saveLayout(); });
      });
      el.addEventListener('dblclick', function () { ui.resetLayout(); });
    });
  };

  /* ---------- Misc ---------- */
  ui.fileDrop = function (el, onFiles, onOver) {
    el.addEventListener('dragover', function (e) {
      if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; el.classList.add('drop-hot'); if (onOver) onOver(e); }
    });
    el.addEventListener('dragleave', function (e) { if (!el.contains(e.relatedTarget)) el.classList.remove('drop-hot'); });
    el.addEventListener('drop', function (e) {
      el.classList.remove('drop-hot');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); e.stopPropagation(); onFiles(e.dataTransfer.files, e); }
    });
  };
})();
