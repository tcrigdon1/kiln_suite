/* =========================================================================
   Gesso — color picker dialog (HSV square + hue strip + RGB/HSB/HEX fields)
   S.ColorPicker.open(hex, onChange(hex), onDone(hex), {title, alpha})
   Also exports S.ColorPicker.mountInline(container, hex, onChange) for panels.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util;
  const CP = (S.ColorPicker = {});

  /** Build the picker widget; returns {el, set(hex), get()} */
  CP.widget = function (hex, onChange, compact) {
    let hsv = (() => { const c = U.hexToRgb(hex); return U.rgbToHsv(c.r, c.g, c.b); })();
    const el = U.el('div', { class: 'cp' + (compact ? ' compact' : '') });
    const SQ = compact ? 150 : 220;
    const sv = U.el('canvas', { class: 'cp-sv', width: SQ, height: SQ });
    const svCur = U.el('div', { class: 'cp-cursor' });
    const svWrap = U.el('div', { class: 'cp-sv-wrap', style: { width: SQ + 'px', height: SQ + 'px' } }, [sv, svCur]);
    const hue = U.el('canvas', { class: 'cp-hue', width: 16, height: SQ });
    const hueCur = U.el('div', { class: 'cp-hue-cur' });
    const hueWrap = U.el('div', { class: 'cp-hue-wrap', style: { height: SQ + 'px' } }, [hue, hueCur]);
    el.append(svWrap, hueWrap);
    const fields = {};
    const right = U.el('div', { class: 'cp-fields' });
    const mk = (k, max) => {
      const n = U.el('input', { type: 'number', min: 0, max, step: 1 });
      n.addEventListener('keydown', (e) => e.stopPropagation());
      fields[k] = n;
      right.appendChild(U.el('label', { class: 'cp-f' }, [U.el('span', {}, k.toUpperCase()), n]));
      return n;
    };
    if (!compact) {
      mk('h', 360); mk('s', 100); mk('b', 100);
      right.appendChild(U.el('div', { class: 'hsep' }));
      mk('r', 255); mk('g', 255); mk('b2', 255);
      fields.b2.previousSibling.textContent = 'B';
    }
    const hexIn = U.el('input', { type: 'text', class: 'hex-input', maxlength: 7 });
    hexIn.addEventListener('keydown', (e) => e.stopPropagation());
    right.appendChild(U.el('label', { class: 'cp-f' }, [U.el('span', {}, '#'), hexIn]));
    if ('EyeDropper' in window) {
      const eb = U.el('button', { class: 'btn btn-sm', html: S.icon('eyedropper') + ' Screen' , title: 'Pick a color from anywhere on screen' });
      eb.addEventListener('click', async () => { try { const r = await new window.EyeDropper().open(); set(r.sRGBHex, true); } catch (e) {} });
      right.appendChild(eb);
    }
    el.appendChild(right);
    const hctx = hue.getContext('2d');
    const hg = hctx.createLinearGradient(0, 0, 0, SQ);
    for (let i = 0; i <= 6; i++) hg.addColorStop(i / 6, 'hsl(' + (360 - i * 60) + ',100%,50%)');
    hctx.fillStyle = hg; hctx.fillRect(0, 0, 16, SQ);
    const sctx = sv.getContext('2d');
    function drawSV() {
      const c = U.hsvToRgb(hsv.h, 1, 1);
      sctx.fillStyle = U.rgbToHex(c); sctx.fillRect(0, 0, SQ, SQ);
      const w = sctx.createLinearGradient(0, 0, SQ, 0); w.addColorStop(0, '#fff'); w.addColorStop(1, 'rgba(255,255,255,0)');
      sctx.fillStyle = w; sctx.fillRect(0, 0, SQ, SQ);
      const b = sctx.createLinearGradient(0, 0, 0, SQ); b.addColorStop(0, 'rgba(0,0,0,0)'); b.addColorStop(1, '#000');
      sctx.fillStyle = b; sctx.fillRect(0, 0, SQ, SQ);
    }
    const get = () => U.rgbToHex(U.hsvToRgb(hsv.h, hsv.s, hsv.v));
    function sync(skip) {
      drawSV();
      svCur.style.left = hsv.s * SQ + 'px'; svCur.style.top = (1 - hsv.v) * SQ + 'px';
      hueCur.style.top = (1 - hsv.h / 360) * SQ + 'px';
      const rgb = U.hsvToRgb(hsv.h, hsv.s, hsv.v);
      if (!compact) {
        if (skip !== 'h') fields.h.value = Math.round(hsv.h); if (skip !== 's') fields.s.value = Math.round(hsv.s * 100); if (skip !== 'b') fields.b.value = Math.round(hsv.v * 100);
        if (skip !== 'r') fields.r.value = rgb.r; if (skip !== 'g') fields.g.value = rgb.g; if (skip !== 'b2') fields.b2.value = rgb.b;
      }
      if (skip !== 'hex') hexIn.value = get();
    }
    function set(h, notify) {
      const c = U.hexToRgb(h); const n = U.rgbToHsv(c.r, c.g, c.b);
      if (n.s === 0 || n.v === 0) n.h = hsv.h; // keep hue for grays
      hsv = n; sync(); if (notify) onChange && onChange(get());
    }
    const dragOn = (target, fn) => target.addEventListener('pointerdown', (e) => {
      target.setPointerCapture(e.pointerId); fn(e);
      target.onpointermove = fn; target.onpointerup = () => { target.onpointermove = null; };
    });
    dragOn(svWrap, (e) => {
      const r = sv.getBoundingClientRect();
      hsv.s = U.clamp((e.clientX - r.left) / r.width, 0, 1); hsv.v = 1 - U.clamp((e.clientY - r.top) / r.height, 0, 1);
      sync(); onChange && onChange(get());
    });
    dragOn(hueWrap, (e) => {
      const r = hue.getBoundingClientRect();
      hsv.h = (1 - U.clamp((e.clientY - r.top) / r.height, 0, 1)) * 359.9;
      sync(); onChange && onChange(get());
    });
    if (!compact) {
      const hsb = () => { hsv = { h: +fields.h.value % 360, s: U.clamp(+fields.s.value / 100, 0, 1), v: U.clamp(+fields.b.value / 100, 0, 1) }; };
      ['h', 's', 'b'].forEach((k) => fields[k].addEventListener('input', () => { hsb(); sync(k); onChange && onChange(get()); }));
      ['r', 'g', 'b2'].forEach((k) => fields[k].addEventListener('input', () => {
        const c = { r: U.clamp(+fields.r.value, 0, 255), g: U.clamp(+fields.g.value, 0, 255), b: U.clamp(+fields.b2.value, 0, 255) };
        const n = U.rgbToHsv(c.r, c.g, c.b); if (n.s === 0) n.h = hsv.h; hsv = n; sync(k); onChange && onChange(get());
      }));
    }
    hexIn.addEventListener('input', () => { if (/^#?[0-9a-f]{6}$/i.test(hexIn.value)) { const c = U.hexToRgb(hexIn.value); hsv = U.rgbToHsv(c.r, c.g, c.b); sync('hex'); onChange && onChange(get()); } });
    sync();
    return { el, set: (h) => set(h, false), get };
  };

  CP.open = function (hex, onChange, onDone, opts) {
    opts = opts || {};
    const orig = hex;
    const prevNew = U.el('div', { class: 'cp-new', style: { background: hex } });
    const prevOld = U.el('div', { class: 'cp-old', style: { background: orig }, title: 'Click to restore original' });
    const w = CP.widget(hex, (c) => { prevNew.style.background = c; onChange && onChange(c); });
    prevOld.addEventListener('click', () => { w.set(orig); prevNew.style.background = orig; onChange && onChange(orig); });
    const prev = U.el('div', { class: 'cp-preview' }, [U.el('span', { class: 'muted' }, 'new'), prevNew, prevOld, U.el('span', { class: 'muted' }, 'current')]);
    const body = U.el('div', { class: 'cp-dialog-body' }, [w.el, prev]);
    // swatch strip of recent colors
    const recent = S.store.get('recentColors', []);
    if (recent.length) {
      const strip = U.el('div', { class: 'cp-recent' });
      recent.slice(0, 16).forEach((c) => {
        const s = U.el('button', { class: 'swatch', style: { background: c }, title: c });
        s.addEventListener('click', () => { w.set(c); prevNew.style.background = c; onChange && onChange(c); });
        strip.appendChild(s);
      });
      body.appendChild(strip);
    }
    S.Dialog.open({ title: opts.title || 'Color Picker', body, cls: 'cp-dialog',
      onCancel: () => { onChange && onChange(orig); },
      buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, run: () => {
        const c = w.get();
        const r = S.store.get('recentColors', []).filter((x) => x !== c); r.unshift(c); S.store.set('recentColors', r.slice(0, 24));
        onDone && onDone(c);
      } }] });
  };
})();
