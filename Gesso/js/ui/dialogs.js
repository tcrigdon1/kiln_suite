/* =========================================================================
   Gesso — generic dialogs.
   S.Dialog.open({ title, body, buttons:[{label, primary, run}], width, onCancel })
     run() may return false to keep the dialog open.
   S.Dialog.form(title, paramDefs, values, onOK)  — quick forms via ParamUI
   S.Dialog.confirm(msg) / S.Dialog.alert(msg)    — promise based
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util;
  const D = (S.Dialog = {});
  const stack = [];

  D.open = function (opts) {
    const back = U.el('div', { class: 'modal-backdrop' + (opts.transparent ? ' see-through' : '') });
    const dlg = U.el('div', { class: 'dialog gesso-dialog' + (opts.cls ? ' ' + opts.cls : '') });
    if (opts.width) dlg.style.width = opts.width + 'px';
    const head = U.el('div', { class: 'dialog-head' }, [U.el('span', {}, opts.title || ''), U.el('div', { class: 'spacer' })]);
    const x = U.el('button', { class: 'icon-btn', html: S.icon('close'), 'aria-label': 'Close' });
    head.appendChild(x);
    const body = U.el('div', { class: 'dialog-body' });
    if (opts.body) body.appendChild(opts.body);
    const foot = U.el('div', { class: 'dialog-foot' });
    if (opts.footLeft) { foot.appendChild(opts.footLeft); foot.appendChild(U.el('div', { style: { flex: 1 } })); }
    dlg.append(head, body);
    let closed = false;
    const api = {
      el: dlg, body,
      close(ok) {
        if (closed) return;
        closed = true;
        back.remove();
        const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
        if (!ok && opts.onCancel) opts.onCancel();
        if (opts.onClose) opts.onClose(ok);
      },
    };
    const buttons = opts.buttons || [{ label: 'OK', primary: true }];
    buttons.forEach((b) => {
      const btn = U.el('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.cls ? ' ' + b.cls : '') }, b.label);
      btn.addEventListener('click', () => {
        if (b.run && b.run(api) === false) return;
        api.close(!!b.primary || b.ok);
      });
      if (b.primary) api.primaryBtn = btn;
      foot.appendChild(btn);
    });
    if (buttons.length) dlg.appendChild(foot);
    x.addEventListener('click', () => api.close(false));
    back.appendChild(dlg);
    back.addEventListener('mousedown', (e) => { if (e.target === back && opts.backdropClose) api.close(false); });
    // drag by header
    head.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      const r = dlg.getBoundingClientRect();
      const ox = e.clientX - r.left, oy = e.clientY - r.top;
      dlg.style.position = 'fixed';
      const mv = (ev) => { dlg.style.left = ev.clientX - ox + 'px'; dlg.style.top = Math.max(0, ev.clientY - oy) + 'px'; };
      const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
      addEventListener('mousemove', mv); addEventListener('mouseup', up);
      dlg.style.left = r.left + 'px'; dlg.style.top = r.top + 'px'; dlg.style.margin = '0';
    });
    // capture phase: inputs inside the dialog may stop propagation of their own key events
    dlg.addEventListener('keydown', (e) => {
      if (stack[stack.length - 1] !== api) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); api.close(false); }
      else if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON' && api.primaryBtn) {
        e.preventDefault(); e.stopPropagation();
        if (e.target.tagName === 'INPUT') e.target.dispatchEvent(new Event('change', { bubbles: true }));
        api.primaryBtn.click();
      } else if (e.key === 'Tab') {
        // keep keyboard focus inside the dialog (cycle at both ends)
        const f = [...dlg.querySelectorAll('input,select,textarea,button,[tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled && el.offsetParent !== null);
        if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
      }
    }, true);
    document.body.appendChild(back);
    stack.push(api);
    setTimeout(() => {
      const f = dlg.querySelector('[autofocus]') || dlg.querySelector('input[type=text],input[type=number],select,textarea');
      if (f) { f.focus(); if (f.select) f.select(); } else dlg.setAttribute('tabindex', '-1'), dlg.focus();
    }, 20);
    return api;
  };
  D.isOpen = () => stack.length > 0;
  D.top = () => stack[stack.length - 1];

  D.form = function (title, defs, values, onOK, opts) {
    values = Object.assign({}, values);
    for (const d of defs) if (values[d.id] === undefined) values[d.id] = d.default;
    const ui = S.ParamUI.build(defs, values, (v) => { values = v; if (opts && opts.onChange) opts.onChange(values); });
    return D.open(Object.assign({ title, body: ui, buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, run: () => onOK(values) }] }, opts || {}));
  };
  D.confirm = function (msg, okLabel = 'OK', title = 'Gesso') {
    return new Promise((res) => {
      D.open({ title, body: U.el('div', { class: 'dlg-msg' }, msg), onCancel: () => res(false),
        buttons: [{ label: 'Cancel', run: () => res(false) }, { label: okLabel, primary: true, run: () => res(true) }] });
    });
  };
  D.choice = function (msg, choices, title = 'Gesso') {
    return new Promise((res) => {
      D.open({ title, body: U.el('div', { class: 'dlg-msg' }, msg), onCancel: () => res(null),
        buttons: choices.map((c) => ({ label: c.label, primary: c.primary, cls: c.cls, ok: true, run: () => res(c.value) })) });
    });
  };
  D.alert = function (msg, title = 'Gesso') {
    return new Promise((res) => D.open({ title, body: U.el('div', { class: 'dlg-msg' }, msg), onClose: () => res(), buttons: [{ label: 'OK', primary: true }] }));
  };
  /**
   * Non-modal progress toast with a Cancel button.
   * const p = S.Progress.start('Patch fill'); p.set(0.3, 'level 2 / 4'); p.cancelled; p.done();
   */
  S.Progress = {
    start(label, opts) {
      opts = opts || {};
      let wrap = document.querySelector('.progress-wrap');
      if (!wrap) { wrap = U.el('div', { class: 'progress-wrap' }); document.body.appendChild(wrap); }
      const bar = U.el('div', { class: 'progress-bar' }), fill = U.el('div', { class: 'progress-fill' });
      bar.appendChild(fill);
      const text = U.el('span', { class: 'progress-text' }, label);
      const cancel = U.el('button', { class: 'btn btn-sm ghost' }, 'Cancel');
      const row = U.el('div', { class: 'progress-row' }, [text, bar, opts.cancellable === false ? null : cancel]);
      wrap.appendChild(row);
      const api = { cancelled: false, el: row,
        set(f, note) { fill.style.width = Math.round(U.clamp(f, 0, 1) * 100) + '%'; if (note) text.textContent = label + ' — ' + note; },
        done() { row.remove(); if (!wrap.children.length) wrap.remove(); },
      };
      cancel.addEventListener('click', () => { api.cancelled = true; text.textContent = label + ' — cancelling…'; });
      const onKey = (e) => { if (e.key === 'Escape' && document.body.contains(row)) { api.cancelled = true; e.stopPropagation(); } };
      addEventListener('keydown', onKey, true);
      const done0 = api.done; api.done = () => { removeEventListener('keydown', onKey, true); done0(); };
      return api;
    },
    /** let the UI breathe between heavy steps */
    tick() { return new Promise((r) => setTimeout(r, 0)); },
  };

  D.prompt = function (msg, value, title = 'Gesso') {
    return new Promise((res) => {
      const inp = U.el('input', { type: 'text', value: value || '', style: { width: '100%' }, autofocus: true });
      D.open({ title, body: U.el('div', {}, [U.el('div', { class: 'dlg-msg', style: { marginBottom: '8px' } }, msg), inp]), onCancel: () => res(null),
        buttons: [{ label: 'Cancel', run: () => res(null) }, { label: 'OK', primary: true, run: () => res(inp.value) }] });
    });
  };
})();
