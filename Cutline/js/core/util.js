/* Cutline — core utilities. Classic script; defines the global namespace. */
(function () {
  'use strict';
  var C = window.Cutline = window.Cutline || {};
  C.version = '1.0.0';
  C.repoURL = 'https://github.com/tcrigdon1/kiln_suite';

  var U = C.util = {};

  U.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.round = function (v, d) { var m = Math.pow(10, d || 0); return Math.round(v * m) / m; };
  var _uidN = 0;
  U.uid = function (p) {
    _uidN = (_uidN + 1) % 1e6;
    return (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + _uidN.toString(36);
  };
  U.clone = function (o) { return o == null ? o : JSON.parse(JSON.stringify(o)); };
  U.dbToGain = function (db) { return db <= -96 ? 0 : Math.pow(10, db / 20); };
  U.gainToDb = function (g) { return g <= 0.0000158 ? -96 : 20 * Math.log10(g); };
  U.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };

  /* ---------- Time & timecode ---------- */
  // Integer timebase used for display: 29.97 -> 30, 23.976 -> 24, 59.94 -> 60
  U.tcBase = function (fps) { return Math.round(fps); };
  // NTSC "drop-frame" rates (29.97 / 59.94) count in 30 / 60 fps but skip frame numbers so the readout tracks wall time:
  // 2 (or 4) frame numbers are dropped at the start of every minute except every tenth. 23.976 is never drop-frame.
  U.dropFrames = function (fps) {
    if (C.prefs && C.prefs.tcDropFrame === false) return 0;
    if (Math.abs(fps - 29.97) < 0.01) return 2;
    if (Math.abs(fps - 59.94) < 0.01) return 4;
    return 0;
  };
  U.isDropFrame = function (fps) { return U.dropFrames(fps) > 0; };
  // frame count -> [hh, mm, ss, ff] honouring drop-frame numbering
  U.tcParts = function (frames, fps) {
    var b = U.tcBase(fps), D = U.dropFrames(fps);
    if (D) {
      var per10 = b * 600 - 9 * D, perMin = b * 60 - D;
      var d = Math.floor(frames / per10), m = frames % per10;
      frames += 9 * D * d + (m >= D ? D * Math.floor((m - D) / perMin) : 0);
    }
    var ff = frames % b, s = Math.floor(frames / b);
    return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60, ff];
  };
  U.fmtTC = function (frames, fps, opts) {
    var neg = frames < 0; frames = Math.abs(Math.round(frames));
    var t = U.tcParts(frames, fps), sep = U.dropFrames(fps) ? ';' : ':';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    var out = p(t[0]) + ':' + p(t[1]) + ':' + p(t[2]) + sep + p(t[3]);
    if (opts && opts.short && t[0] === 0) out = p(t[1]) + ':' + p(t[2]) + sep + p(t[3]);
    return (neg ? '-' : '') + out;
  };
  // [hh, mm, ss, ff] -> frame count (drop-frame aware; ff beyond the dropped numbers is accepted as typed)
  U.tcToFrames = function (hh, mm, ss, ff, fps) {
    var b = U.tcBase(fps), D = U.dropFrames(fps), mins = hh * 60 + mm;
    var f = ((hh * 60 + mm) * 60 + ss) * b + ff;
    if (D) f -= D * (mins - Math.floor(mins / 10));
    return f;
  };
  // Parse "HH:MM:SS:FF", "HH:MM:SS;FF", "MM:SS:FF", "SS:FF", "+12", "-5", "125" (frames) or "1.5s"
  U.parseTC = function (str, fps, current) {
    str = String(str).trim();
    if (!str) return null;
    var rel = 0;
    if (str[0] === '+' || str[0] === '-') { rel = str[0] === '+' ? 1 : -1; str = str.slice(1); }
    var f;
    if (/s$/i.test(str)) f = Math.round(parseFloat(str) * fps);
    else if (str.indexOf(':') >= 0 || str.indexOf(';') >= 0 || str.indexOf('.') >= 0) {
      var parts = str.split(/[:;.]/).map(function (x) { return parseInt(x, 10) || 0; });
      while (parts.length < 4) parts.unshift(0);
      f = U.tcToFrames(parts[0], parts[1], parts[2], parts[3], fps);
    } else {
      // plain digits: interpret as compact timecode e.g. 1000 -> 00:00:10:00
      var digits = str.replace(/\D/g, '');
      if (!digits) return null;
      if (rel) f = parseInt(digits, 10);
      else {
        while (digits.length < 8) digits = '0' + digits;
        f = U.tcToFrames(+digits.slice(-8, -6), +digits.slice(-6, -4), +digits.slice(-4, -2), +digits.slice(-2), fps);
      }
    }
    if (isNaN(f)) return null;
    if (rel) return (current || 0) + rel * f;
    return f;
  };
  U.fmtDur = function (sec) {
    if (!isFinite(sec)) return '--:--';
    sec = Math.max(0, sec);
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    var h = Math.floor(m / 60); m = m % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  };
  U.fmtSize = function (b) {
    if (!b) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
  };

  /* ---------- DOM ---------- */
  // h('div.cls#id', {attrs, on:{click}}, children...)
  U.h = function (sel, attrs) {
    var m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(sel) || [];
    var el = document.createElement(m[1] || 'div');
    if (m[2]) m[2].replace(/([.#])([\w-]+)/g, function (_, t, n) { if (t === '.') el.classList.add(n); else el.id = n; });
    var kids = Array.prototype.slice.call(arguments, 2);
    if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
    if (attrs) {
      for (var k in attrs) {
        var v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'on') { for (var ev in v) el.addEventListener(ev, v[ev]); }
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
        else if (k in el && k !== 'list' && k !== 'type' && typeof v !== 'string') el[k] = v;
        else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    U.append(el, kids);
    return el;
  };
  U.append = function (el, kids) {
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) U.append(el, c);
      else if (c instanceof Node) el.appendChild(c);
      else el.appendChild(document.createTextNode(String(c)));
    }
    return el;
  };
  U.$ = function (s, root) { return (root || document).querySelector(s); };
  U.$$ = function (s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); };
  U.clear = function (el) { while (el && el.firstChild) el.removeChild(el.firstChild); return el; };

  U.debounce = function (fn, ms) {
    var t; return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); };
  };
  U.throttle = function (fn, ms) {
    var last = 0, t = null, args;
    return function () {
      args = arguments; var now = performance.now(), s = this;
      if (now - last >= ms) { last = now; fn.apply(s, args); }
      else if (!t) t = setTimeout(function () { t = null; last = performance.now(); fn.apply(s, args); }, ms - (now - last));
    };
  };
  U.raf = function (fn) {
    var pending = false;
    return function () { if (pending) return; pending = true; requestAnimationFrame(function () { pending = false; fn(); }); };
  };

  // Drag helper: calls move(dx, dy, ev) and up(ev) with pointer capture semantics
  U.drag = function (ev, move, up) {
    var sx = ev.clientX, sy = ev.clientY, capEl = null;
    // pointer capture keeps the drag alive when the pointer leaves the window (window listeners are the fallback)
    try { if (ev.pointerId != null && ev.target && ev.target.setPointerCapture && ev.pointerType !== 'mouse') { ev.target.setPointerCapture(ev.pointerId); capEl = ev.target; } } catch (e) { }
    function mm(e) { if (ev.pointerId != null && e.pointerId != null && e.pointerId !== ev.pointerId) return; move(e.clientX - sx, e.clientY - sy, e); }
    function mu(e) {
      if (ev.pointerId != null && e.pointerId != null && e.pointerId !== ev.pointerId) return;
      window.removeEventListener('pointermove', mm, true);
      window.removeEventListener('pointerup', mu, true);
      window.removeEventListener('pointercancel', mu, true);
      if (capEl) { try { capEl.releasePointerCapture(ev.pointerId); } catch (x) { } }
      if (up) up(e, e.clientX - sx, e.clientY - sy);
    }
    window.addEventListener('pointermove', mm, true);
    window.addEventListener('pointerup', mu, true);
    window.addEventListener('pointercancel', mu, true);
  };

  /* ---------- Events ---------- */
  function Emitter() { this._h = {}; }
  Emitter.prototype.on = function (n, f) { (this._h[n] = this._h[n] || []).push(f); return f; };
  Emitter.prototype.off = function (n, f) { var a = this._h[n]; if (a) { var i = a.indexOf(f); if (i >= 0) a.splice(i, 1); } };
  Emitter.prototype.emit = function (n) {
    var a = this._h[n]; if (!a) return;
    var args = Array.prototype.slice.call(arguments, 1);
    a.slice().forEach(function (f) {
      try { f.apply(null, args); } catch (e) { console.error('[Cutline] handler error for', n, e); }
    });
  };
  U.Emitter = Emitter;
  C.bus = new Emitter();

  /* ---------- Storage ---------- */
  U.lsGet = function (k, def) {
    try { var v = localStorage.getItem('cutline.' + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
  };
  U.lsSet = function (k, v) { try { localStorage.setItem('cutline.' + k, JSON.stringify(v)); } catch (e) { /* quota */ } };

  /* ---------- Colors ---------- */
  U.hexToRgb = function (hex) {
    hex = String(hex || '#000').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(hex.slice(0, 6), 16) || 0;
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };
  U.rgbToHex = function (r, g, b) {
    var f = function (x) { x = Math.round(U.clamp(x, 0, 1) * 255).toString(16); return x.length < 2 ? '0' + x : x; };
    return '#' + f(r) + f(g) + f(b);
  };
  U.rgba = function (hex, a) { var c = U.hexToRgb(hex); return 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + a + ')'; };

  U.download = function (blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  };
  U.pickFiles = function (accept, multiple) {
    return new Promise(function (res) {
      var i = document.createElement('input');
      i.type = 'file'; if (accept) i.accept = accept; i.multiple = !!multiple;
      i.style.display = 'none';
      i.addEventListener('change', function () { res(Array.prototype.slice.call(i.files || [])); i.remove(); });
      document.body.appendChild(i); i.click();
    });
  };
  U.isTyping = function (e) {
    var t = e.target;
    if (!t || !t.tagName) return false;
    if (t.isContentEditable) return true;
    var tag = t.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
      var ty = (t.type || '').toLowerCase();
      if (ty === 'range') return /^Arrow|^Page|^Home|^End/.test(e.key || ''); // a focused slider owns its arrow keys
      if (ty === 'checkbox' || ty === 'radio' || ty === 'color') return e.key === ' ' || e.key === 'Enter';
      return ['text', 'number', 'search', 'email', 'password', 'url', 'tel', 'date', 'time'].indexOf(ty) >= 0;
    }
    if (tag === 'SELECT') return !(e.ctrlKey || e.metaKey);
    return false;
  };
  U.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
})();
