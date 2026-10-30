/* =========================================================================
   Gesso — Text tool.  Click = point text, drag = paragraph text box.
   Editing uses a hidden <textarea> (works with IME / clipboard) whose value
   drives the text layer; the caret & selection are drawn on the canvas.
   Ctrl+Enter or Esc commits, clicking outside commits, double-clicking a text
   layer (canvas or Layers panel) re-enters editing.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util, T = S.Tools;
  const G = () => S.Geom;

  const WEIGHTS = [{ value: 100, label: 'Thin' }, { value: 300, label: 'Light' }, { value: 400, label: 'Regular' }, { value: 500, label: 'Medium' }, { value: 600, label: 'Semibold' }, { value: 700, label: 'Bold' }, { value: 900, label: 'Black' }];

  const tool = T.register({
    id: 'text', name: 'Text', key: 'T', icon: 'text', group: 'text', cursor: 'text',
    opts: { font: 'Segoe UI', size: 64, weight: 400, italic: false, color: null, align: 'left', leading: 0, tracking: 0, underline: false, strike: false, allCaps: false, smallCaps: false },
    keepSpace: true,
    /** settings object being edited: the active text layer's data, or the tool defaults */
    target() {
      const d = S.app.doc;
      if (this.edit) return this.edit.layer.text;
      const l = d && d.activeLayer();
      if (l && l.type === 'text') return l.text;
      return this.opts;
    },
    options(bar) {
      const ui = T.ui, tg = this.target();
      // with no text layer active, the colour for new text is simply the foreground colour
      const onCh = (key) => () => this.applyProp(key, tg[key]);
      const fontSel = ui.select(bar, '', tg, 'font', S.Text.FONTS.concat(S.Text.extraFonts || []).filter((v, i, a) => a.indexOf(v) === i), onCh('font'));
      fontSel.querySelector('select').classList.add('font-select');
      if (tg.font && !S.Text.FONTS.includes(tg.font) && !(S.Text.extraFonts || []).includes(tg.font)) { const s = fontSel.querySelector('select'); s.appendChild(U.el('option', { value: tg.font }, tg.font)); s.value = tg.font; }
      if ('queryLocalFonts' in window && !S.Text.extraFonts) {
        ui.button(bar, '', async () => {
          try {
            const fonts = await window.queryLocalFonts();
            S.Text.extraFonts = [...new Set(fonts.map((f) => f.family))].sort();
            T.renderOptions(); S.toast(S.Text.extraFonts.length + ' installed fonts loaded');
          } catch (e) { S.toast('Font access was not granted'); }
        }, { icon: 'plus', tip: 'Load installed fonts' });
      }
      ui.select(bar, '', tg, 'weight', WEIGHTS, onCh('weight'));
      ui.num(bar, 'Size', tg, 'size', 1, 2000, { unit: 'px', onChange: onCh('size') });
      const colorObj = tg === this.opts ? { get color() { return S.app.fg; }, set color(v) { /* applied via applyProp */ } } : tg;
      ui.color(bar, '', colorObj, 'color', (c, final) => this.applyProp('color', c, final));
      ui.seg(bar, tg, 'align', [{ value: 'left', icon: 'txtL', tip: 'Align left' }, { value: 'center', icon: 'txtC', tip: 'Center' }, { value: 'right', icon: 'txtR', tip: 'Align right' }, { value: 'justify', icon: 'txtJ', tip: 'Justify (paragraph text)' }], onCh('align'));
      const tg2 = U.el('div', { class: 'opt-seg' });
      for (const [k, lab, tip, st] of [['italic', 'I', 'Italic', 'font-style:italic'], ['underline', 'U', 'Underline', 'text-decoration:underline'], ['strike', 'S', 'Strikethrough', 'text-decoration:line-through'], ['allCaps', 'TT', 'All caps', ''], ['smallCaps', 'Tт', 'Small caps', 'font-variant:small-caps']]) {
        const b = U.el('button', { class: 'icon-btn' + (tg[k] ? ' active' : ''), 'data-tip': tip, 'data-tip-pos': 'bottom', html: '<span style="' + st + ';font-weight:700">' + lab + '</span>' });
        b.addEventListener('click', () => { tg[k] = !tg[k]; b.classList.toggle('active', tg[k]); this.applyProp(k, tg[k]); });
        tg2.appendChild(b);
      }
      bar.appendChild(tg2);
      ui.num(bar, 'Leading', tg, 'leading', 0, 4000, { unit: 'px', onChange: onCh('leading') });
      ui.num(bar, 'Tracking', tg, 'tracking', -500, 2000, { onChange: onCh('tracking') });
      if (this.edit) {
        ui.sep(bar);
        ui.button(bar, 'Cancel', () => this.cancel());
        ui.button(bar, 'Commit', () => this.commit(), { primary: true });
      }
    },
    /** Apply a character/paragraph property to the edited/active text layer (undoable) */
    applyProp(key, value, final = true) {
      const d = S.app.doc;
      if (this.edit) { this.edit.layer.text[key] = value; this.edit.layer.version++; d.invalidate(); S.View.redraw(); return; }
      const l = d && d.activeLayer();
      if (l && l.type === 'text') {
        d.commit('Text Properties', () => { l.text[key] = value; l.version++; }, { key: 'textprop-' + l.id + key });
      } else if (key === 'color') { if (final) S.App.setFg(value); }
      else { this.opts[key] = value; T.saveOpts(); }
      void final;
      S.bus.emit('text:changed');
    },
    toLocal(l, x, y) { if (!l.text.matrix) return [x, y]; return G().apply(G().invert(l.text.matrix), x, y); },
    toDoc(l, x, y) { if (!l.text.matrix) return [x, y]; return G().apply(l.text.matrix, x, y); },
    /** is local point (lx,ly) on the text? curved text: near a glyph (its bbox may span a whole dial) */
    hitsLayout(t, lay, lx, ly, pad) {
      if (lay.curve) {
        const r = t.size * 0.7 + pad;
        return lay.curve.glyphs.some((g) => Math.hypot(lx - (g.x + Math.sin(g.rot) * t.size * 0.35), ly - (g.y - Math.cos(g.rot) * t.size * 0.35)) < r);
      }
      const b = lay.bbox;
      return lx >= b.x - pad && lx <= b.x + b.w + pad && ly >= b.y - pad && ly <= b.y + b.h + pad;
    },
    hitText(doc, x, y) {
      const list = doc.flatTopDown();
      for (const { layer: l } of list) {
        if (l.type !== 'text' || !l.visible) continue;
        const [lx, ly] = this.toLocal(l, x, y);
        if (this.hitsLayout(l.text, S.Text.layout(l.text), lx, ly, 4)) return l;
      }
      return null;
    },
    onDown(info, doc) {
      if (this.edit) {
        const l = this.edit.layer;
        const [lx, ly] = this.toLocal(l, info.x, info.y);
        if (this.hitsLayout(l.text, S.Text.layout(l.text), lx, ly, 6)) {
          const lay = S.Text.layout(l.text);
          const i = S.Text.indexAt(l.text, lay, lx, ly);
          this.edit.ta.setSelectionRange(i, i);
          this.edit.selAnchor = i; this.edit.selecting = true;
          this.focusTA();
          return;
        }
        this.commit();
        return;
      }
      const hit = this.hitText(doc, info.x, info.y);
      if (hit && !info.shift) { this.editLayer(hit, info); return; }
      this.drag = { x0: info.x, y0: info.y, x1: info.x, y1: info.y, moved: false, sx: info.sx, sy: info.sy };
    },
    onMove(info) {
      if (this.edit && this.edit.selecting) {
        const l = this.edit.layer, [lx, ly] = this.toLocal(l, info.x, info.y);
        const i = S.Text.indexAt(l.text, S.Text.layout(l.text), lx, ly), a = this.edit.selAnchor;
        this.edit.ta.setSelectionRange(Math.min(a, i), Math.max(a, i), i < a ? 'backward' : 'forward');
        return;
      }
      const d = this.drag; if (!d) return;
      d.x1 = info.x; d.y1 = info.y;
      if (Math.hypot(info.sx - d.sx, info.sy - d.sy) > 4) d.moved = true;
    },
    onUp(info, doc) {
      if (this.edit) { this.edit.selecting = false; this.focusTA(); return; }
      const d = this.drag; this.drag = null;
      if (!d) return;
      const o = this.opts;
      const t = { font: o.font, size: o.size, weight: o.weight, italic: o.italic, color: S.app.fg, align: o.align, leading: o.leading, tracking: o.tracking, underline: o.underline, strike: o.strike, allCaps: o.allCaps, smallCaps: !!o.smallCaps, text: '' };
      if (d.moved) {
        const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
        Object.assign(t, { x, y, box: { w: Math.max(10, Math.abs(d.x1 - d.x0)), h: Math.max(10, Math.abs(d.y1 - d.y0)) } });
      } else Object.assign(t, { x: d.x0, y: d.y0 - o.size * 0.92 });
      const before = doc.captureState();
      const l = S.Layers.text(doc, t);
      doc.insertLayer(l);
      doc.setActive(l.id);
      this.startEdit(l, before, true);
    },
    onDblClick(info, doc) { if (!this.edit) { const hit = this.hitText(doc, info.x, info.y); if (hit) this.editLayer(hit); } },
    editLayer(l, info) {
      const doc = S.app.doc;
      if (S.app.tool !== this) T.select('text');
      if (l.locks.all) { S.toast('Layer is locked'); return; }
      doc.setActive(l.id);
      this.startEdit(l, doc.captureState(), false);
      if (info) {
        const [lx, ly] = this.toLocal(l, info.x, info.y);
        const i = S.Text.indexAt(l.text, S.Text.layout(l.text), lx, ly);
        this.edit.ta.setSelectionRange(i, i);
      } else this.edit.ta.select();
    },
    startEdit(l, before, isNew) {
      const ta = U.el('textarea', { class: 'text-ime', spellcheck: false, autocomplete: 'off', wrap: 'off' });
      ta.value = l.text.text;
      document.body.appendChild(ta);
      this.edit = { layer: l, before, isNew, ta, original: JSON.stringify(l.text) };
      ta.addEventListener('input', () => {
        l.text.text = ta.value;
        l.name = (ta.value.split('\n')[0] || 'Text').slice(0, 30);
        l.version++; S.app.doc.invalidate(); S.View.redraw();
        this.positionTA();
        this._notify();
      });
      ta.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey)) || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.commit(); return; }
        if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) return; // native textarea undo
        if ((e.ctrlKey || e.metaKey) && !['a', 'c', 'v', 'x', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'home', 'end', 'backspace', 'delete', 'shift', 'control', 'meta', 'alt'].includes(e.key.toLowerCase())) {
          // application shortcuts (Save, Close, zoom…) work while typing: the text is committed first
          const ks = S.Cmd.eventKey(e), id = ks && S.Cmd.forKey(ks);
          if (id) { e.preventDefault(); e.stopPropagation(); this.commit(); S.Cmd.run(id); return; }
        }
        e.stopPropagation();
        setTimeout(() => S.View.redraw(), 0);
      });
      ta.addEventListener('keyup', () => S.View.redraw());
      ta.addEventListener('select', () => S.View.redraw());
      this.focusTA();
      T.renderOptions();
      S.bus.emit('layers:changed', S.app.doc);
    },
    focusTA() { if (this.edit) { this.positionTA(); setTimeout(() => this.edit && this.edit.ta.focus({ preventScroll: true }), 0); } },
    positionTA() {
      const e = this.edit; if (!e) return;
      const l = e.layer, lay = S.Text.layout(l.text);
      const c = S.Text.caretPos(l.text, lay, e.ta.selectionStart);
      const [dx, dy] = this.toDoc(l, c.x, c.y);
      const [sx, sy] = S.View.toScreen(dx, dy);
      const r = S.View.canvas.getBoundingClientRect();
      e.ta.style.left = r.left + sx + 'px'; e.ta.style.top = r.top + sy + 'px';
      e.ta.style.fontSize = Math.max(8, l.text.size * S.app.doc.view.zoom) + 'px';
    },
    commit() {
      const e = this.edit; if (!e) return;
      this.edit = null;
      e.ta.remove();
      const doc = S.app.doc, l = e.layer;
      if (!l.text.text.trim()) {
        // empty text → remove the layer
        doc.restoreState(e.before);
        if (!e.isNew) doc.commit('Delete Text', () => { doc.removeLayer(l.id); });
      } else if (e.isNew || JSON.stringify(l.text) !== e.original) {
        doc.pushState(e.isNew ? 'New Text Layer' : 'Edit Text', e.before);
      }
      T.renderOptions();
      S.bus.emit('layers:changed', doc);
      S.View.redraw();
    },
    cancel() {
      const e = this.edit; if (!e) return;
      this.edit = null; e.ta.remove();
      S.app.doc.restoreState(e.before);
      T.renderOptions(); S.bus.emit('layers:changed', S.app.doc);
    },
    commitOnSwitch() { this.commit(); },
    deactivate() { this.commit(); },
    onKey(e) { if (this.edit) return true; return false; },
    get animated() { return !!this.edit; },
    drawOverlay(ctx, doc) {
      const d = this.drag;
      if (d && d.moved) {
        const [x1, y1] = S.View.toScreen(d.x0, d.y0), [x2, y2] = S.View.toScreen(d.x1, d.y1);
        ctx.strokeStyle = '#fff'; ctx.setLineDash([4, 3]); ctx.strokeRect(Math.min(x1, x2) + 0.5, Math.min(y1, y2) + 0.5, Math.abs(x2 - x1), Math.abs(y2 - y1)); ctx.setLineDash([]);
      }
      const e = this.edit; if (!e) return;
      const l = e.layer, t = l.text, lay = S.Text.layout(t);
      const toS = (x, y) => { const [a, b] = this.toDoc(l, x, y); return S.View.toScreen(a, b, doc); };
      // bounding box
      const b = lay.bbox;
      const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map((p) => toS(p[0] - 3, p[1] - 3).map((v, i) => v));
      ctx.strokeStyle = 'rgba(240,145,58,.8)'; ctx.lineWidth = 1; ctx.setLineDash(t.box ? [] : [3, 3]);
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
      // selection highlight
      const s0 = e.ta.selectionStart, s1 = e.ta.selectionEnd;
      if (s1 > s0 && lay.curve) {
        // curved text: highlight each selected glyph's (rotated) box
        ctx.fillStyle = 'rgba(61,191,174,.35)';
        for (const g of lay.curve.glyphs) {
          if (g.i < s0 || g.i >= s1) continue;
          const cs = Math.cos(g.rot), sn = Math.sin(g.rot), hw = g.w / 2 + ((t.tracking || 0) / 2000) * t.size;
          const q = [[-hw, -lay.asc], [hw, -lay.asc], [hw, lay.curve.desc], [-hw, lay.curve.desc]].map(([px, py]) => toS(g.x + px * cs - py * sn, g.y + px * sn + py * cs));
          ctx.beginPath(); q.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.fill();
        }
      } else if (s1 > s0) {
        ctx.fillStyle = 'rgba(61,191,174,.35)';
        for (const L of lay.lines) {
          const a = Math.max(s0, L.start), z = Math.min(s1, L.end);
          if (z <= a) continue;
          const ca = S.Text.caretPos(t, lay, a), cz = S.Text.caretPos(t, lay, z);
          const q = [toS(ca.x, ca.y), toS(cz.x, ca.y), toS(cz.x, ca.y + ca.h), toS(ca.x, ca.y + ca.h)];
          ctx.beginPath(); q.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.fill();
        }
      }
      // caret (blinks with the ants timer)
      if (s0 === s1 && Math.floor(Date.now() / 530) % 2 === 0) {
        const c = S.Text.caretPos(t, lay, e.ta.selectionStart);
        let p1 = toS(c.x, c.y + c.h * 0.08), p2 = toS(c.x, c.y + c.h * 0.95);
        if (c.ang != null) { // curved text: caret runs along the glyph's up direction
          const ux = Math.sin(c.ang), uy = -Math.cos(c.ang), dsc = t.size * 0.25;
          p1 = toS(c.bx + ux * lay.asc, c.by + uy * lay.asc); p2 = toS(c.bx - ux * dsc, c.by - uy * dsc);
        }
        ctx.strokeStyle = U.luma(...Object.values(U.hexToRgb(t.color))) > 128 ? '#000' : '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
        ctx.strokeStyle = t.color; ctx.lineWidth = 1.5; ctx.stroke();
      }
    },
  });
  tool._notify = U.debounce(() => S.bus.emit('layers:changed', S.app.doc), 400);
  S.TextTool = tool;
  // keep options bar in sync when the active layer changes
  S.bus.on('activeLayer:changed', () => { if (S.app.tool === tool && !tool.edit) T.renderOptions(); });
  S.bus.on('view:changed', () => tool.positionTA());
})();
