/* Cutline — timeline view: canvas-drawn tracks, clips, waveforms, filmstrips, transitions, markers, and all tools. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, h = U.h, P = C.P, T = C.T, KF = C.KF, A = C.A;
  var TL = C.TL = { ppf: 4, scrollX: 0, scrollY: 0, rows: [], RULER: 30 };
  var COLORS = { video: '#2c8e83', image: '#2a7f9a', gen: '#7d9a3c', adjust: '#66778c', audio: '#b77632', offline: '#8a3530', nest: '#4b7f63', nestAudio: '#9a6a3c' };

  function seq() { return P.seq(); }
  function fps() { var s = seq(); return s ? s.fps : 30; }
  TL.f2x = function (f) { return f * TL.ppf - TL.scrollX; };
  TL.x2f = function (x) { return (x + TL.scrollX) / TL.ppf; };

  TL.init = function (panel) {
    TL.panel = panel;
    // header
    TL.seqTabs = h('div.seq-tabs');
    TL.tcEl = h('div.tl-tc', '00:00:00:00');
    TL.snapBtn = C.ui.iconBtn('magnet', 'Snapping (S)', function () { A.toggleSnap(); }, { cls: 'sm', tipPos: 'bottom' });
    TL.linkBtn = C.ui.iconBtn('link', 'Linked selection', function () { A.toggleLinked(); }, { cls: 'sm', tipPos: 'bottom' });
    TL.zoomRange = h('input.tl-zoom', { type: 'range', min: 0, max: 1000, value: 500, title: 'Zoom' });
    TL.zoomRange.addEventListener('input', function () {
      var k = TL.zoomRange.value / 1000, min = TL.minPpf(), max = 40;
      var cx = TL.f2x(C.Engine.frame);
      setPpf(min * Math.pow(max / min, k), cx >= 0 && cx < TL.area.clientWidth ? cx : TL.area.clientWidth / 2);
    });
    // running duration of the sequence + optional target (e.g. 20:00) with an over/under indicator
    TL.durVal = h('span.tl-dur-val', '00:00:00:00');
    TL.targetIn = h('input.tl-target', { type: 'text', placeholder: 'target', title: 'Target duration (e.g. 20:00 or 1:00:00) — Enter to set, empty to clear' });
    TL.durDelta = h('span.tl-dur-delta', '');
    TL.durEl = h('div.tl-dur', { title: 'Sequence duration' }, h('span.muted', 'Dur'), TL.durVal, h('span.muted', '/'), TL.targetIn, TL.durDelta);
    TL.targetIn.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') { TL.setTarget(TL.targetIn.value); TL.targetIn.blur(); } if (e.key === 'Escape') { TL.updateDuration(); TL.targetIn.blur(); } });
    TL.targetIn.addEventListener('change', function () { TL.setTarget(TL.targetIn.value); });
    // find clips by name / label: matches stay bright, the rest dims; Enter jumps to the next match
    TL.filter = { q: '', label: null };
    TL.searchIn = h('input.tl-search', { type: 'text', placeholder: 'Find clip…', title: 'Find clips by name (Enter: next match, Esc: clear)' });
    TL.searchIn.addEventListener('input', function () { TL.filter.q = TL.searchIn.value.trim().toLowerCase(); TL.redraw(); });
    TL.searchIn.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') TL.nextMatch(e.shiftKey ? -1 : 1); if (e.key === 'Escape') { TL.searchIn.value = ''; TL.filter.q = ''; TL.filter.label = null; TL.labelSel.value = ''; TL.redraw(); TL.searchIn.blur(); } });
    TL.labelSel = h('select.tl-label-filter', { title: 'Show only clips with this label colour' });
    [['', 'Any label']].concat(A.MARKER_COLORS.map(function (c, i) { return [c, ['Amber', 'Teal', 'Red', 'Green', 'Yellow', 'Sky', 'Rose', 'Sand'][i]]; })).concat([['none', 'No label']]).forEach(function (o) { TL.labelSel.appendChild(h('option', { value: o[0] }, o[1])); });
    TL.labelSel.addEventListener('change', function () { TL.filter.label = TL.labelSel.value || null; TL.redraw(); });
    var head = h('div.panel-head', TL.seqTabs, h('div.spacer'), h('div.tl-find', TL.searchIn, TL.labelSel), TL.durEl, TL.tcEl, TL.snapBtn, TL.linkBtn,
      C.ui.iconBtn('marker', 'Add marker (M)', function () { C.state.focus = 'timeline'; A.addMarker(); }, { cls: 'sm', tipPos: 'bottom' }),
      C.ui.iconBtn('settings', 'Timeline display settings', function (e, b) {
        var r = b.getBoundingClientRect();
        C.ui.menu([
          { label: 'Show Waveforms', checked: C.prefs.showWaveforms, action: function () { C.prefs.showWaveforms = !C.prefs.showWaveforms; C.savePrefs(); } },
          { label: 'Show Thumbnails', checked: C.prefs.showThumbs, action: function () { C.prefs.showThumbs = !C.prefs.showThumbs; C.savePrefs(); } },
          { label: 'Show Keyframes', checked: C.prefs.showKeyframes, action: function () { C.prefs.showKeyframes = !C.prefs.showKeyframes; C.savePrefs(); } },
          { label: 'Show Caption Lane', checked: !!TL.showCaps, action: function () { TL.showCaps = !TL.showCaps; TL.layoutRows(); TL.redraw(); } }, '-',
          { label: 'Expand All Tracks', action: function () { C.edit('Track Heights', function (s) { s.tracks.forEach(function (t) { t.h = 90; }); }); } },
          { label: 'Minimize All Tracks', action: function () { C.edit('Track Heights', function (s) { s.tracks.forEach(function (t) { t.h = 32; }); }); } }
        ], r.left, r.bottom + 2);
      }, { cls: 'sm', tipPos: 'bottom' }),
      C.ui.iconBtn('minus', 'Zoom out (-)', function () { A.zoom(1 / 1.5); }, { cls: 'sm', tipPos: 'bottom' }), TL.zoomRange,
      C.ui.iconBtn('plus', 'Zoom in (=)', function () { A.zoom(1.5); }, { cls: 'sm', tipPos: 'bottom' }));
    panel.appendChild(head);
    U.$('.tl-tc', head) && null;
    // tools
    TL.toolsEl = h('div.tl-tools');
    A.TOOLS.forEach(function (t) {
      var b = C.ui.iconBtn(t.icon, t.name + ' (' + t.key + ')', function () { A.setTool(t.id); });
      b.setAttribute('data-tool', t.id);
      TL.toolsEl.appendChild(b);
    });
    // keep tool tooltips in step with customised shortcuts
    function toolTips() { U.$$('[data-tool]', TL.toolsEl).forEach(function (b) { var t = A.TOOLS.filter(function (x) { return x.id === b.getAttribute('data-tool'); })[0], k = C.CMD && C.CMD.keyLabel('tool_' + t.id); b.setAttribute('data-tip', t.name + (k ? ' (' + k + ')' : '')); }); }
    C.bus.on('keys', toolTips); setTimeout(toolTips, 0);
    // headers
    TL.headsList = h('div.list');
    TL.heads = h('div.tl-heads', h('div.ruler-spacer',
      C.ui.iconBtn('plus', 'Add video track', function () { A.addTrack('video'); }, { cls: 'sm', tipPos: 'bottom' }),
      h('span', { style: { fontSize: '10px', color: 'var(--text-2)', marginRight: '6px' } }, 'V'),
      C.ui.iconBtn('plus', 'Add audio track', function () { A.addTrack('audio'); }, { cls: 'sm', tipPos: 'bottom' }),
      h('span', { style: { fontSize: '10px', color: 'var(--text-2)' } }, 'A')), TL.headsList);
    // area
    TL.canvas = h('canvas');
    TL.spacer = h('div.spacer');
    TL.scroller = h('div.tl-scroll', TL.spacer);
    TL.rulerHit = h('div.tl-ruler-hit');
    TL.area = h('div.tl-area', TL.canvas, TL.scroller, TL.rulerHit);
    // meters
    TL.meterCv = h('canvas');
    TL.meters = h('div.tl-meters', h('div.mlabel', 'MASTER'), TL.meterCv);
    panel.appendChild(h('div.tl-main', TL.toolsEl, TL.heads, TL.area, TL.meters));

    TL.scroller.addEventListener('scroll', function () {
      // logical scroll = physical * k (k > 1 only when the content is wider than the browser's maximum element width)
      var lx = TL.scroller.scrollLeft * (TL.scrollK || 1);
      if (Math.abs(lx - TL.scrollX) >= (TL.scrollK || 1)) TL.scrollX = lx;
      TL.scrollY = TL.scroller.scrollTop;
      TL.positionHeads(); TL.redraw();
    });
    TL.area.addEventListener('wheel', onWheel, { passive: false });
    TL.scroller.addEventListener('pointerdown', onDown);
    TL.scroller.addEventListener('pointermove', onHover);
    TL.scroller.addEventListener('pointerleave', function () { TL.hoverInfo = null; TL.scroller.style.cursor = ''; TL.redraw(); });
    TL.scroller.addEventListener('dblclick', onDbl);
    TL.scroller.addEventListener('contextmenu', onContext);
    TL.rulerHit.addEventListener('pointerdown', onRulerDown);
    TL.rulerHit.addEventListener('dblclick', function (e) {
      var mk = rulerMarkerAt(e.offsetX); if (mk) { A.editMarker(mk.id); return; }
      TL.typeTimecode(e.offsetX);
    });
    TL.rulerHit.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      var f = Math.round(TL.x2f(e.offsetX));
      C.ui.menu([{ label: 'Add Marker Here', action: function () { C.Engine.seek(f); A.addMarker(); } }, { label: 'Mark In Here', action: function () { C.edit('Mark In', function (s) { s.inF = f; }); } },
        { label: 'Mark Out Here', action: function () { C.edit('Mark Out', function (s) { s.outF = f; }); } }, { label: 'Clear In/Out', action: function () { C.edit('Clear In/Out', function (s) { s.inF = null; s.outF = null; }); } },
        '-', { label: 'Zoom to Fit', action: TL.zoomFit }], e.clientX, e.clientY);
    });
    // drag & drop from library / effects panel / OS
    TL.scroller.addEventListener('dragover', onDragOver);
    TL.scroller.addEventListener('dragleave', function (e) { if (!TL.scroller.contains(e.relatedTarget)) { TL.ghost = null; TL.dropHint = null; TL.redraw(); } });
    TL.scroller.addEventListener('drop', onDrop);
    C.bus.on('dragend', function () { TL.ghost = null; TL.dropHint = null; TL.redraw(); });

    TL.panel.addEventListener('pointerdown', function () { C.state.focus = 'timeline'; });
    new ResizeObserver(function () { TL.resize(); }).observe(TL.area);
    ['changed', 'selection', 'film', 'media:update', 'prefs', 'state'].forEach(function (ev) { C.bus.on(ev, function (info) { if (ev === 'changed') { TL.layoutRows(); if (!(info && info.live)) TL.renderHeads(); else TL.positionHeads(true); } TL.redraw(); TL.updateButtons(); }); });
    C.bus.on('playhead', function (f) { TL.tcEl.textContent = U.fmtTC(f, fps()); TL.autoScroll(); TL.redraw(); });
    C.bus.on('tool', function () { TL.updateButtons(); });
    C.bus.on('sequence', function () { TL.renderSeqTabs(); TL.layoutRows(); TL.renderHeads(); TL.zoomFitIfEmpty(); TL.redraw(); TL.updateDuration(); });
    C.bus.on('changed', U.debounce(function () { TL.updateDuration(); }, 40));
    C.bus.on('peaks', U.throttle(function () { TL.redraw(); }, 250));
    C.bus.on('tracks', function () { TL.layoutRows(); TL.renderHeads(); TL.redraw(); });
    tcEditable();
    meterLoop();
  };
  // small timecode box on the ruler: type a timecode (or +/-frames, 1.5s) and Enter to move the playhead there
  TL.typeTimecode = function (x) {
    if (TL.tcBox) TL.tcBox.remove();
    var f0 = Math.max(0, Math.round(TL.x2f(x)));
    C.Engine.seek(f0);
    var inp = TL.tcBox = h('input.tc-input.tl-ruler-tc', { type: 'text', value: U.fmtTC(f0, fps()), style: { left: Math.min(x, TL.area.clientWidth - 120) + 'px' } });
    TL.area.appendChild(inp); inp.focus(); inp.select();
    var done = false;
    function fin(ok) { if (done) return; done = true; if (ok) { var f = U.parseTC(inp.value, fps(), C.Engine.frame); if (f != null) C.Engine.seek(Math.max(0, f)); } inp.remove(); TL.tcBox = null; }
    inp.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') fin(true); if (e.key === 'Escape') fin(false); });
    inp.addEventListener('blur', function () { fin(true); });
  };
  function tcEditable() {
    TL.tcEl.addEventListener('click', function () {
      var inp = h('input.tc-input', { type: 'text', value: TL.tcEl.textContent, style: { width: '110px', fontFamily: 'var(--mono)' } });
      TL.tcEl.style.display = 'none'; TL.tcEl.parentNode.insertBefore(inp, TL.tcEl.nextSibling); inp.focus(); inp.select();
      var done = false;
      function fin(ok) { if (done) return; done = true; if (ok) { var f = U.parseTC(inp.value, fps(), C.Engine.frame); if (f != null) C.Engine.seek(f); } inp.remove(); TL.tcEl.style.display = ''; }
      inp.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') fin(true); if (e.key === 'Escape') fin(false); });
      inp.addEventListener('blur', function () { fin(true); });
    });
  }

  TL.matches = function (c) {
    var f = TL.filter; if (!f || (!f.q && !f.label)) return true;
    if (f.q && String(c.name || '').toLowerCase().indexOf(f.q) < 0) return false;
    if (f.label === 'none' ? !!c.label : (f.label && c.label !== f.label)) return false;
    return true;
  };
  TL.filterActive = function () { return !!(TL.filter && (TL.filter.q || TL.filter.label)); };
  TL.nextMatch = function (dir) {
    var s = seq(); if (!s || !TL.filterActive()) return;
    var list = s.clips.filter(TL.matches).sort(function (a, b) { return a.start - b.start || a.id.localeCompare(b.id); });
    if (!list.length) { C.toast('No clips match'); return; }
    var f = C.Engine.frame, cur = C.state.selection[0];
    var i = list.findIndex(function (c) { return c.id === cur; });
    var next = i >= 0 ? list[(i + dir + list.length) % list.length] : (dir > 0 ? list.filter(function (c) { return c.start > f; })[0] || list[0] : list.filter(function (c) { return c.start < f; }).pop() || list[list.length - 1]);
    A.select([next.id]); C.Engine.seek(next.start);
    var x = TL.f2x(next.start); if (x < 0 || x > TL.area.clientWidth - 40) TL.setScrollX(Math.max(0, next.start * TL.ppf - 60));
    C.toast((list.indexOf(next) + 1) + ' / ' + list.length + ': ' + next.name);
  };

  /* ---------- Duration readout / target ---------- */
  // "20:00" -> 1200 s; "1:00:00" -> 3600; "20" -> 20 minutes; "" -> none
  TL.parseTarget = function (v) {
    v = String(v || '').trim(); if (!v) return null;
    var parts = v.split(':').map(function (x) { return parseFloat(x) || 0; });
    if (parts.length === 1) return parts[0] * 60;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  };
  TL.setTarget = function (v) {
    var sec = TL.parseTarget(v), s = seq(); if (!s) return;
    if ((s.target || null) === sec) { TL.updateDuration(); return; }
    C.edit(sec ? 'Set Target Duration' : 'Clear Target Duration', function (s2) { s2.target = sec && sec > 0 ? sec : null; });
    TL.updateDuration();
  };
  TL.updateDuration = function () {
    var s = seq(); if (!s || !TL.durEl) return;
    var durF = P.seqDuration(s), dur = durF / s.fps;
    TL.durVal.textContent = U.fmtTC(durF, s.fps);
    if (document.activeElement !== TL.targetIn) TL.targetIn.value = s.target ? U.fmtDur(s.target) : '';
    var cls = '', txt = '';
    if (s.target) {
      var d = dur - s.target, tol = Math.max(1, 1 / s.fps);
      if (Math.abs(d) <= tol) { cls = 'on'; txt = 'on target'; }
      else if (d < 0) { cls = 'under'; txt = U.fmtDur(-d) + ' to go'; }
      else { cls = 'over'; txt = U.fmtDur(d) + ' over'; }
    }
    TL.durDelta.textContent = txt; TL.durDelta.className = 'tl-dur-delta' + (cls ? ' ' + cls : '');
    TL.durEl.classList.toggle('has-target', !!s.target);
  };

  TL.updateButtons = function () {
    TL.snapBtn.classList.toggle('active', C.state.snapping);
    TL.linkBtn.classList.toggle('active', C.state.linked);
    U.$$('[data-tool]', TL.toolsEl).forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tool') === C.state.tool); });
    var cur = { razor: 'crosshair', hand: 'grab', zoom: 'zoom-in', text: 'text', slip: 'ew-resize', slide: 'ew-resize' }[C.state.tool] || '';
    TL.scroller.style.cursor = cur;
  };

  /* ---------- Sequence tabs ---------- */
  TL.renderSeqTabs = function () {
    U.clear(TL.seqTabs);
    var p = C.state.project; if (!p) return;
    p.sequences.forEach(function (s) {
      var t = h('div.seq-tab' + (s.id === p.activeSeq ? '.active' : ''), s.name);
      t.addEventListener('click', function () { A.switchSequence(s.id); });
      t.addEventListener('dblclick', function () { C.ui.prompt('Rename sequence', s.name).then(function (v) { if (v) { C.edit('Rename Sequence', function (sq, prj) { var x = prj.sequences.filter(function (q) { return q.id === s.id; })[0]; if (x) x.name = v; }); TL.renderSeqTabs(); C.bus.emit('sequence'); } }); });
      TL.seqTabs.appendChild(t);
    });
  };

  /* ---------- Layout ---------- */
  TL.layoutRows = function () {
    var s = seq(); TL.rows = [];
    if (!s) return;
    var y = 0;
    if (TL.showCaps || s.captions.length) { TL.rows.push({ cap: true, y: y, h: 26 }); y += 26; }
    var vts = P.vtracks(s).slice().reverse(), ats = P.atracks(s);
    vts.forEach(function (t) { TL.rows.push({ track: t, y: y, h: t.h || 54 }); y += t.h || 54; });
    TL.sepY = y; y += 6;
    ats.forEach(function (t) { TL.rows.push({ track: t, y: y, h: t.h || 50 }); y += t.h || 50; });
    TL.contentH = y + 60;
    TL.updateSpacer();
  };
  // Browsers cap element widths (~33.5 M px in Chrome). A 10-hour 60 fps sequence zoomed to single frames is ~86 M px
  // wide, so the scroll spacer is capped and the native scroll position is scaled (TL.scrollK) to the logical one.
  TL.MAX_SPACER = 30000000;
  TL.updateSpacer = function () {
    var s = seq(); if (!s) return;
    var dur = Math.max(P.seqDuration(s), 10 * s.fps), vw = TL.area.clientWidth;
    var w = Math.max(vw + 10, (dur + 30 * s.fps) * TL.ppf);
    var sw = Math.min(w, TL.MAX_SPACER);
    TL.contentW = w;
    TL.scrollK = w > sw && sw > vw ? (w - vw) / (sw - vw) : 1;
    TL.spacer.style.width = sw + 'px';
    TL.spacer.style.height = Math.max(TL.contentH || 0, 10) + 'px';
  };
  TL.setScrollX = function (x) {
    x = Math.max(0, Math.min(x, Math.max(0, (TL.contentW || 0) - TL.area.clientWidth)));
    TL.scrollX = x;
    TL.scroller.scrollLeft = x / (TL.scrollK || 1);
  };
  TL.rowOf = function (trackId) { for (var i = 0; i < TL.rows.length; i++) if (TL.rows[i].track && TL.rows[i].track.id === trackId) return TL.rows[i]; return null; };
  TL.rowAtY = function (y) { // y in content coords
    for (var i = 0; i < TL.rows.length; i++) { var r = TL.rows[i]; if (y >= r.y && y < r.y + r.h) return r; }
    return null;
  };
  TL.resize = function () {
    var dpr = window.devicePixelRatio || 1, w = TL.area.clientWidth, hh = TL.area.clientHeight;
    TL.canvas.width = Math.round(w * dpr); TL.canvas.height = Math.round(hh * dpr);
    TL.canvas.style.width = w + 'px'; TL.canvas.style.height = hh + 'px';
    var mc = TL.meterCv; mc.width = Math.round(mc.clientWidth * dpr); mc.height = Math.round(mc.clientHeight * dpr);
    TL.updateSpacer(); TL.redraw();
  };
  // zoom range: the whole sequence (even 10+ hours) fits on screen ... down to 40 px per frame
  TL.minPpf = function () { var s = seq(); var dur = s ? Math.max(P.seqDuration(s), 10 * s.fps) : 300; return Math.max(1e-6, (TL.area.clientWidth - 40) / (dur * 1.6)); };
  TL.MAX_PPF = 40;
  function setPpf(p, anchorX) {
    var s = seq(); if (!s) return;
    var f = TL.x2f(anchorX);
    TL.ppf = U.clamp(p, TL.minPpf() * 0.5, TL.MAX_PPF);
    TL.updateSpacer();
    TL.setScrollX(Math.max(0, f * TL.ppf - anchorX));
    var min = TL.minPpf();
    TL.zoomRange.value = Math.round(U.clamp(Math.log(TL.ppf / min) / Math.log(TL.MAX_PPF / min), 0, 1) * 1000);
    C.state.zooms = C.state.zooms || {}; C.state.zooms[s.id] = TL.ppf;
    TL.redraw();
  }
  TL.zoomBy = function (k) { var px = TL.f2x(C.Engine.frame); if (px < 0 || px > TL.area.clientWidth) px = TL.area.clientWidth / 2; setPpf(TL.ppf * k, px); };
  TL.zoomFit = function () {
    var s = seq(); if (!s) return;
    var dur = Math.max(P.seqDuration(s), 5 * s.fps);
    TL.ppf = U.clamp((TL.area.clientWidth - 30) / dur, 1e-6, TL.MAX_PPF);
    TL.updateSpacer(); TL.setScrollX(0);
    setPpf(TL.ppf, 0);
  };
  TL.zoomFitIfEmpty = function () {
    var s = seq(); if (!s) return;
    var z = C.state.zooms && C.state.zooms[s.id];
    if (z) { TL.ppf = z; TL.updateSpacer(); } else TL.zoomFit();
  };
  TL.autoScroll = function () {
    if (!C.Engine.playing || TL.dragging) return;
    var x = TL.f2x(C.Engine.frame), w = TL.area.clientWidth;
    if (x > w - 20 || x < 0) TL.setScrollX(Math.max(0, C.Engine.frame * TL.ppf - 40));
  };
  function onWheel(e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      var r = TL.area.getBoundingClientRect();
      setPpf(TL.ppf * Math.pow(1.0018, -e.deltaY * (e.deltaMode ? 30 : 1)), e.clientX - r.left);
    } else if (e.altKey) {
      e.preventDefault();
      TL.setScrollX(TL.scrollX + e.deltaY * (e.deltaMode ? 30 : 1));
    } else if (e.shiftKey && !e.deltaX) {
      e.preventDefault(); TL.setScrollX(TL.scrollX + e.deltaY * (e.deltaMode ? 30 : 1));
    }
  }

  /* ---------- Track headers ---------- */
  TL.renderHeads = function () {
    var s = seq(); U.clear(TL.headsList); if (!s) return;
    TL.rows.forEach(function (r) {
      if (r.cap) {
        var ch = h('div.th', { style: { top: r.y + 'px', height: r.h + 'px' } }, h('div.lbl', { style: { width: '48px', color: 'var(--accent-2)' } }, 'CC'), h('div.body', h('div.name', 'Captions (' + s.captions.length + ')')));
        TL.headsList.appendChild(ch); r.el = ch; return;
      }
      var t = r.track, lab = P.trackLabel(s, t), video = t.kind === 'video';
      var tgt = h('div.tgt' + (t.target ? '.on' : ''), { title: 'Target track for source edits / paste' }, '◆');
      tgt.addEventListener('click', function () { C.edit('Target Track', function (sq) { var x = P.track(sq, t.id); x.target = !x.target; }); });
      function tb(cls, on, title, html, fn) { var b = h('button.tbtn.' + cls + (on ? '.on' : ''), { title: title, html: html }); b.addEventListener('click', function (e) { e.stopPropagation(); fn(e); }); return b; }
      var btns = h('div.btns');
      if (video) btns.appendChild(tb('eye', t.hidden, t.hidden ? 'Show track output' : 'Hide track output', C.icon(t.hidden ? 'eyeoff' : 'eye'), function () { C.edit('Toggle Track Output', function (sq) { var x = P.track(sq, t.id); x.hidden = !x.hidden; }); }));
      else {
        btns.appendChild(tb('mute', t.mute, 'Mute track', 'M', function () { C.edit('Mute Track', function (sq) { var x = P.track(sq, t.id); x.mute = !x.mute; }); C.bus.emit('tracks'); }));
        btns.appendChild(tb('solo', t.solo, 'Solo track', 'S', function (e) {
          C.edit('Solo Track', function (sq) { var x = P.track(sq, t.id); if (e.altKey) P.atracks(sq).forEach(function (o) { if (o !== x) o.solo = false; }); x.solo = !x.solo; }); C.bus.emit('tracks');
        }));
      }
      btns.appendChild(tb('lock', t.lock, t.lock ? 'Unlock track' : 'Lock track', C.icon(t.lock ? 'lock' : 'unlock'), function () { C.edit('Lock Track', function (sq) { var x = P.track(sq, t.id); x.lock = !x.lock; }); }));
      var name = h('div.name', { title: 'Double-click to rename' }, P.trackDisplayName(s, t));
      name.addEventListener('dblclick', function () { C.ui.prompt('Track name', t.name || P.trackDisplayName(s, t)).then(function (v) { if (v != null) C.edit('Rename Track', function (sq) { P.track(sq, t.id).name = v; }); }); });
      var rs = h('div.resize');
      rs.addEventListener('pointerdown', function (e) {
        e.preventDefault(); e.stopPropagation();
        var h0 = t.h || 54;
        U.drag(e, function (dx, dy) { var x = P.track(seq(), t.id); if (!x) return; x.h = U.clamp(Math.round(h0 + dy), 28, 220); TL.layoutRows(); TL.positionHeads(true); TL.redraw(); },
          function () { C.commit('Track Height'); TL.renderHeads(); });
      });
      var el = h('div.th.' + t.kind + (t.lock ? '.locked' : ''), { style: { top: r.y + 'px', height: r.h + 'px' } }, tgt, h('div.lbl', { style: t.color ? { background: t.color, color: '#1a120a' } : null }, lab), h('div.body', name, r.h >= 40 ? btns : null), rs);
      if (r.h < 40) { el.querySelector('.body').appendChild(btns); name.style.display = 'none'; }
      el.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        C.ui.menu([{ label: 'Rename Track…', action: function () { name.dispatchEvent(new MouseEvent('dblclick')); } },
          { label: 'Track Color', sub: A.MARKER_COLORS.map(function (col, i) { return { label: ['Amber', 'Teal', 'Red', 'Green', 'Yellow', 'Sky', 'Rose', 'Sand'][i], checked: t.color === col, action: function () { C.edit('Track Color', function (sq) { P.track(sq, t.id).color = col; }); } }; }).concat(['-', { label: 'Default', checked: !t.color, action: function () { C.edit('Track Color', function (sq) { delete P.track(sq, t.id).color; }); } }]) },
          { label: 'Select All Clips on Track', action: function () { var ids = seq().clips.filter(function (c) { return c.trackId === t.id; }).map(function (c) { return c.id; }); C.state.selection = ids; C.state.selTransition = null; C.bus.emit('selection'); } },
          '-', { label: 'Add Video Track', action: function () { A.addTrack('video'); } }, { label: 'Add Audio Track', action: function () { A.addTrack('audio'); } },
          '-', { label: 'Delete Track', action: function () { A.deleteTrack(t.id); } }], e.clientX, e.clientY);
      });
      TL.headsList.appendChild(el); r.el = el;
    });
    var sep = h('div.th-sep', { style: { top: TL.sepY + 'px' } });
    TL.headsList.appendChild(sep);
    TL.positionHeads();
  };
  TL.positionHeads = function (resizing) {
    TL.headsList.style.transform = 'translateY(' + (-TL.scrollY) + 'px)';
    if (resizing) TL.rows.forEach(function (r) { if (r.el) { r.el.style.top = r.y + 'px'; r.el.style.height = r.h + 'px'; } });
  };

  /* ---------- Drawing ---------- */
  TL.redraw = U.raf(function () { draw(); });
  function clipColor(c, m) {
    if (c.label) return c.label;
    var tk = P.track(seq(), c.trackId); if (tk && tk.color) return tk.color;
    if (!m || (m.type !== 'gen' && !C.Media.isOnline(m))) return COLORS.offline;
    if (m.type === 'nest') return c.kind === 'audio' ? COLORS.nestAudio : COLORS.nest;
    if (c.kind === 'audio') return COLORS.audio;
    if (m.type === 'gen') return m.gen.kind === 'adjust' ? COLORS.adjust : COLORS.gen;
    if (m.type === 'image') return COLORS.image;
    return COLORS.video;
  }
  function shade(hex, k) { var c = U.hexToRgb(hex); return 'rgb(' + c.map(function (v) { return Math.round(U.clamp(k > 0 ? v + (1 - v) * k : v * (1 + k), 0, 1) * 255); }).join(',') + ')'; }
  function rr(g, x, y, w, hh, r) { r = Math.min(r, w / 2, hh / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + hh, r); g.arcTo(x + w, y + hh, x, y + hh, r); g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  function draw() {
    var s = seq(), cv = TL.canvas; if (!s || !cv.width) return;
    var dpr = window.devicePixelRatio || 1, W = cv.width / dpr, H = cv.height / dpr;
    var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#141210'; g.fillRect(0, 0, W, H);
    var top = TL.RULER - TL.scrollY;
    var f0 = Math.floor(TL.x2f(0)), f1 = Math.ceil(TL.x2f(W));
    // rows background
    g.save(); g.beginPath(); g.rect(0, TL.RULER, W, H - TL.RULER); g.clip();
    TL.rows.forEach(function (r, i) {
      var y = top + r.y;
      if (y > H || y + r.h < TL.RULER) return;
      if (r.cap) { g.fillStyle = '#17201f'; g.fillRect(0, y, W, r.h); }
      else {
        g.fillStyle = r.track.kind === 'video' ? (i % 2 ? '#1a1815' : '#1c1a17') : (i % 2 ? '#1b1814' : '#1d1a16');
        if (r.track.lock) g.fillStyle = '#1f1715';
        g.fillRect(0, y, W, r.h);
      }
      g.fillStyle = '#25211d'; g.fillRect(0, y + r.h - 1, W, 1);
    });
    g.fillStyle = '#3b342e'; g.fillRect(0, top + TL.sepY, W, 6);
    // in/out shading
    if (s.inF != null || s.outF != null) {
      var a = s.inF != null ? TL.f2x(s.inF) : 0, b = s.outF != null ? TL.f2x(s.outF) : W;
      g.fillStyle = 'rgba(240,145,58,.05)'; g.fillRect(a, TL.RULER, b - a, H);
    }
    // gap selection
    if (C.state.selGap) { var gr = TL.rowOf(C.state.selGap.trackId); if (gr) { g.fillStyle = 'rgba(240,145,58,.22)'; g.fillRect(TL.f2x(C.state.selGap.s), top + gr.y + 2, (C.state.selGap.e - C.state.selGap.s) * TL.ppf, gr.h - 4); } }
    // clips
    var selSet = {}; C.state.selection.forEach(function (id) { selSet[id] = 1; });
    s.clips.forEach(function (c) {
      if (c.start > f1 || c.start + c.dur < f0) return;
      var r = TL.rowOf(c.trackId); if (!r) return;
      var y = top + r.y; if (y > H || y + r.h < TL.RULER) return;
      drawClip(g, s, c, r, y, !!selSet[c.id], W);
    });
    // transitions
    s.transitions.forEach(function (tr) {
      var r = TL.rowOf(tr.trackId); if (!r) return;
      var rg = P.transitionRange(s, tr), x = TL.f2x(rg.start), w = tr.dur * TL.ppf, y = top + r.y;
      if (x > W || x + w < 0) return;
      var def = C.TR.byId[tr.type] || { name: tr.type, kind: 'video' };
      var ty = y + Math.max(14, r.h * 0.42), th = Math.min(r.h - (ty - y) - 3, 20);
      if (th < 6) { ty = y + 2; th = r.h - 4; }
      var grd = g.createLinearGradient(x, 0, x + w, 0);
      grd.addColorStop(0, 'rgba(20,18,16,.85)'); grd.addColorStop(1, def.kind === 'audio' ? 'rgba(240,160,74,.55)' : 'rgba(61,191,174,.6)');
      rr(g, x + 0.5, ty + 0.5, Math.max(4, w - 1), th, 3); g.fillStyle = grd; g.fill();
      g.strokeStyle = C.state.selTransition === tr.id ? '#ffad62' : 'rgba(242,235,227,.5)'; g.lineWidth = C.state.selTransition === tr.id ? 2 : 1; g.stroke();
      g.beginPath(); g.moveTo(x + 2, ty + th - 2); g.lineTo(x + w - 2, ty + 2); g.strokeStyle = 'rgba(242,235,227,.35)'; g.lineWidth = 1; g.stroke();
      if (w > 40) { g.fillStyle = '#f2ebe3'; g.font = '600 9.5px Segoe UI, sans-serif'; g.textBaseline = 'middle'; g.save(); g.beginPath(); g.rect(x, ty, w, th); g.clip(); g.fillText(def.name, x + 5, ty + th / 2); g.restore(); }
      // screen rect for hit-testing; non-enumerable so it never leaks into project JSON / undo snapshots
      Object.defineProperty(tr, '_rect', { value: [x, ty, w, th], enumerable: false, configurable: true, writable: true });
    });
    // captions lane
    TL.rows.forEach(function (r) {
      if (!r.cap) return;
      var y = top + r.y;
      s.captions.forEach(function (cp) {
        var x = TL.f2x(cp.start), w = (cp.end - cp.start) * TL.ppf; if (x > W || x + w < 0) return;
        rr(g, x + 0.5, y + 3.5, Math.max(3, w - 1), r.h - 7, 3);
        g.fillStyle = TL.selCap === cp.id ? '#3a7c74' : '#25524d'; g.fill(); g.strokeStyle = TL.selCap === cp.id ? '#ffad62' : '#3dbfae'; g.lineWidth = 1; g.stroke();
        if (w > 20) { g.save(); g.beginPath(); g.rect(x, y, w, r.h); g.clip(); g.fillStyle = '#e6fff9'; g.font = '10px Segoe UI, sans-serif'; g.textBaseline = 'middle'; g.fillText(cp.text.replace(/\n/g, ' '), x + 4, y + r.h / 2); g.restore(); }
      });
    });
    if (!s.clips.length && !TL.ghost) {
      var r1 = TL.rows.filter(function (r) { return r.track && r.track.kind === 'video'; }).pop();
      if (r1) {
        var cy = top + r1.y + r1.h / 2;
        g.fillStyle = 'rgba(200,189,177,.38)'; g.font = '13px Segoe UI, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('Drag clips here from the Library — or open one in the Source monitor and press  ,  (insert)  /  .  (overwrite)', W / 2, cy);
        g.textAlign = 'left';
      }
    }
    // ghost (drag from library)
    if (TL.ghost) TL.ghost.forEach(function (gh) {
      var r = TL.rowOf(gh.trackId); if (!r) return;
      var x = TL.f2x(gh.start), w = gh.dur * TL.ppf, y = top + r.y;
      rr(g, x + 0.5, y + 1.5, w - 1, r.h - 3, 4); g.fillStyle = gh.kind === 'audio' ? 'rgba(183,118,50,.55)' : 'rgba(44,142,131,.55)'; g.fill();
      g.setLineDash([4, 3]); g.strokeStyle = '#ffad62'; g.lineWidth = 1.5; g.stroke(); g.setLineDash([]);
      if (TL.ghostInsert) { g.fillStyle = '#ffad62'; g.fillRect(x - 1, TL.RULER, 2, H); }
    });
    if (TL.dropHint) { g.fillStyle = 'rgba(255,173,98,.9)'; var dh = TL.dropHint; g.fillRect(dh.x - 2, top + dh.y, 4, dh.h); }
    // marquee
    if (TL.marquee) { var m = TL.marquee; g.fillStyle = 'rgba(240,145,58,.12)'; g.strokeStyle = 'rgba(240,145,58,.8)'; g.lineWidth = 1; g.fillRect(m.x, m.y, m.w, m.h); g.strokeRect(m.x + .5, m.y + .5, m.w, m.h); }
    g.restore();
    // ruler
    drawRuler(g, s, W);
    // snap line
    if (TL.snapLine != null) { var sx = TL.f2x(TL.snapLine); g.fillStyle = '#3dbfae'; g.fillRect(sx - 0.5, 0, 1, H); g.beginPath(); g.moveTo(sx - 5, TL.RULER); g.lineTo(sx + 5, TL.RULER); g.lineTo(sx, TL.RULER + 6); g.fill(); }
    // playhead
    var px = Math.round(TL.f2x(C.Engine.frame)) + 0.5;
    if (px >= -10 && px <= W + 10) {
      g.fillStyle = '#ffad62'; g.fillRect(px - 0.5, TL.RULER - 4, 1, H);
      g.beginPath(); g.moveTo(px - 6, 14); g.lineTo(px + 6, 14); g.lineTo(px + 6, 22); g.lineTo(px, 28); g.lineTo(px - 6, 22); g.closePath(); g.fill();
    }
  }
  function niceStep(ppf, fpsv) {
    var minPx = 90, steps = [1, 2, 5, 10, 15, 30].map(function (x) { return x; });
    var cands = [1, 2, 5, 10];
    var b = Math.round(fpsv);
    cands = cands.concat([b / 2 | 0 || 1, b, b * 2, b * 5, b * 10, b * 15, b * 30, b * 60, b * 120, b * 300, b * 600, b * 900, b * 1800, b * 3600, b * 7200, b * 10800, b * 21600]);
    cands = cands.filter(function (x) { return x >= 1; }).sort(function (a, c) { return a - c; });
    for (var i = 0; i < cands.length; i++) if (cands[i] * ppf >= minPx) return cands[i];
    void steps;
    return cands[cands.length - 1];
  }
  function drawRuler(g, s, W) {
    g.fillStyle = '#1f1c18'; g.fillRect(0, 0, W, TL.RULER);
    g.fillStyle = '#3b342e'; g.fillRect(0, TL.RULER - 1, W, 1);
    var step = niceStep(TL.ppf, s.fps), sub = step >= 10 ? step / 5 : step / 2;
    if (sub < 1) sub = 1;
    var f0 = Math.floor(TL.x2f(0) / sub) * sub, f1 = TL.x2f(W);
    g.fillStyle = '#8d8277'; g.font = '10px ' + getComputedStyle(document.body).getPropertyValue('--mono'); g.textBaseline = 'top';
    for (var f = Math.max(0, f0); f <= f1; f += sub) {
      var x = Math.round(TL.f2x(f)) + 0.5, major = Math.abs(f / step - Math.round(f / step)) < 1e-6;
      g.fillStyle = major ? '#8d8277' : '#4a423a';
      g.fillRect(x - 0.5, major ? 16 : 22, 1, major ? 13 : 7);
      if (major) { g.fillStyle = '#c8bdb1'; g.fillText(U.fmtTC(Math.round(f), s.fps, { short: P.seqDuration(s) < 3600 * s.fps }), x + 3, 4); }
    }
    if (TL.ppf >= 6) { // frame ticks
      g.fillStyle = '#3a332d';
      for (var ff = Math.max(0, Math.floor(TL.x2f(0))); ff <= f1; ff++) g.fillRect(Math.round(TL.f2x(ff)), 26, 1, 3);
    }
    // in/out
    if (s.inF != null || s.outF != null) {
      var a = s.inF != null ? TL.f2x(s.inF) : 0, b = s.outF != null ? TL.f2x(s.outF) : W;
      g.fillStyle = 'rgba(240,145,58,.35)'; g.fillRect(a, 24, b - a, 5);
      g.fillStyle = '#f0913a';
      if (s.inF != null) { g.fillRect(a, 12, 2, 17); g.fillRect(a, 12, 6, 2); }
      if (s.outF != null) { g.fillRect(b - 2, 12, 2, 17); g.fillRect(b - 6, 12, 6, 2); }
    }
    if (C.RenderCache) C.RenderCache.drawBar(g, s, W, TL); // render bar sits on top of the in/out band
    // markers
    s.markers.forEach(function (m) {
      var x = TL.f2x(m.f);
      if (x < -20 || x > W + 20) return;
      if (m.dur) { g.fillStyle = U.rgba(m.color, 0.35); g.fillRect(x, 16, m.dur * TL.ppf, 6); }
      g.fillStyle = m.color; g.beginPath(); g.moveTo(x - 5, 14); g.lineTo(x + 5, 14); g.lineTo(x + 5, 21); g.lineTo(x, 26); g.lineTo(x - 5, 21); g.closePath(); g.fill();
      if (C.state.selMarker === m.id) { g.strokeStyle = '#fff'; g.lineWidth = 1.2; g.stroke(); }
      if (m.name) {
        g.font = '600 9px Segoe UI, sans-serif'; var tw = g.measureText(m.name).width;
        g.fillStyle = 'rgba(20,18,16,.85)'; g.fillRect(x + 6, 15, tw + 6, 11);
        g.fillStyle = m.color; g.fillRect(x + 6, 15, 2, 11);
        g.fillStyle = '#f2ebe3'; g.textBaseline = 'middle'; g.fillText(m.name, x + 10, 20.5); g.textBaseline = 'top';
      }
      g.fillStyle = U.rgba(m.color, 0.5); g.fillRect(x - 0.5, TL.RULER, 1, 4000);
    });
  }

  function drawClip(g, s, c, r, y, selected, W) {
    var m = P.media(c.mediaId);
    var x = TL.f2x(c.start), w = c.dur * TL.ppf, hh = r.h - 2, yy = y + 1;
    var col = clipColor(c, m);
    var x0 = Math.max(x, -4), x1 = Math.min(x + w, W + 4), vw = x1 - x0;
    if (vw <= 0) return;
    g.save();
    if (TL.filterActive() && !TL.matches(c)) g.globalAlpha = 0.28;
    rr(g, x + 0.5, yy + 0.5, Math.max(2, w - 1), hh - 1, 4);
    g.fillStyle = shade(col, -0.35); g.fill();
    g.save(); g.clip();
    var headH = Math.min(15, hh * 0.32);
    var bodyY = yy + headH, bodyH = hh - headH;
    // body content
    if (c.kind === 'video' && C.prefs.showThumbs && m && bodyH > 14) drawFilm(g, s, c, m, x, bodyY, w, bodyH, x0, x1);
    if (c.kind === 'audio' && C.prefs.showWaveforms && m) drawWave(g, s, c, m, x, bodyY, w, bodyH, x0, x1, col);
    // head strip
    g.fillStyle = col; g.fillRect(x0, yy, vw, headH);
    if (c.enabled === false) { g.fillStyle = 'rgba(20,18,16,.6)'; g.fillRect(x0, yy, vw, hh); }
    // name + badges
    if (w > 18) {
      g.fillStyle = 'rgba(255,255,255,.95)'; g.font = '600 10px Segoe UI, sans-serif'; g.textBaseline = 'middle';
      var tx = Math.max(x + 5, 4), label = c.name;
      var badges = [];
      if ((c.fx && c.fx.length) || (c.col && !P.colorIsDefault(c.col))) badges.push('fx');
      if (T.hasRamp(c)) badges.push((c.reverse ? '◀' : '') + '⤴ ramp');
      else if (c.speed !== 1 || c.reverse) badges.push((c.reverse ? '◀' : '') + Math.round(c.speed * 100) + '%');
      if (c.freeze != null) badges.push('❚❚');
      if (c.link) badges.push('⛓');
      var sync = syncOffset(s, c);
      if (sync) badges.push((sync > 0 ? '+' : '−') + (Math.abs(sync) < s.fps ? Math.abs(sync) + 'f' : U.fmtTC(Math.abs(sync), s.fps, { short: true })));
      var bx = tx;
      badges.forEach(function (b, bi) {
        var bw = g.measureText(b).width + 6, isSync = sync && bi === badges.length - 1;
        g.fillStyle = b === 'fx' ? '#f0913a' : isSync ? '#c9443d' : 'rgba(10,8,6,.5)'; rr(g, bx, yy + 2, bw, headH - 4, 2); g.fill();
        g.fillStyle = b === 'fx' ? '#1a120a' : '#f2ebe3'; g.fillText(b, bx + 3, yy + headH / 2 + 0.5);
        bx += bw + 3;
      });
      g.fillStyle = 'rgba(255,255,255,.95)';
      g.fillText(label, bx + 1, yy + headH / 2 + 0.5);
    }
    // fades (audio)
    if (c.kind === 'audio') {
      g.fillStyle = 'rgba(10,8,6,.45)';
      if (c.fadeIn > 0) { g.beginPath(); g.moveTo(x, bodyY); g.lineTo(x + c.fadeIn * TL.ppf, bodyY); g.lineTo(x, yy + hh); g.closePath(); g.fill(); }
      if (c.fadeOut > 0) { var xe = x + w; g.beginPath(); g.moveTo(xe, bodyY); g.lineTo(xe - c.fadeOut * TL.ppf, bodyY); g.lineTo(xe, yy + hh); g.closePath(); g.fill(); }
      // volume line
      if (bodyH > 16) {
        g.strokeStyle = 'rgba(255,236,200,.75)'; g.lineWidth = 1; g.beginPath();
        var keys = KF.keys(c, 'au.vol');
        var vy = function (db) { return bodyY + bodyH * (1 - U.clamp((db + 60) / 72, 0, 1)); };
        if (keys) {
          var step = Math.max(2, 4);
          for (var px = x0; px <= x1; px += step) { var lf = (TL.x2f(px) - c.start); var yv = vy(KF.value(c, 'au.vol', U.clamp(lf, 0, c.dur - 1)) + (c.au.gain || 0)); if (px === x0) g.moveTo(px, yv); else g.lineTo(px, yv); }
        } else { var yv2 = vy(c.au.vol + (c.au.gain || 0)); g.moveTo(x0, yv2); g.lineTo(x1, yv2); }
        g.stroke();
      }
      // fade handles when hovered/selected
      if (selected || (TL.hoverInfo && TL.hoverInfo.clip === c.id)) {
        g.fillStyle = '#f2ebe3';
        g.fillRect(x + c.fadeIn * TL.ppf - 3, bodyY - 1, 6, 6);
        g.fillRect(x + w - c.fadeOut * TL.ppf - 3, bodyY - 1, 6, 6);
      }
    }
    // keyframes
    if (C.prefs.showKeyframes && c.kf && hh > 26) {
      var kfs = KF.allFrames(c), ky = yy + hh - 7;
      g.fillStyle = '#f2ebe3'; g.strokeStyle = 'rgba(10,8,6,.8)';
      kfs.forEach(function (k) {
        if (k < 0 || k >= c.dur) return;
        var kx = x + (k + 0.5) * TL.ppf; if (kx < x0 - 5 || kx > x1 + 5) return;
        g.beginPath(); g.moveTo(kx, ky - 4); g.lineTo(kx + 4, ky); g.lineTo(kx, ky + 4); g.lineTo(kx - 4, ky); g.closePath(); g.fill(); g.stroke();
      });
    }
    // clip markers
    (c.markers || []).forEach(function (mk) {
      var mx = x + mk.f * TL.ppf; g.fillStyle = mk.color || '#3dbfae';
      g.beginPath(); g.moveTo(mx - 4, yy + headH); g.lineTo(mx + 4, yy + headH); g.lineTo(mx, yy + headH + 6); g.fill();
    });
    g.restore();
    // border
    rr(g, x + 0.5, yy + 0.5, Math.max(2, w - 1), hh - 1, 4);
    g.lineWidth = selected ? 2 : 1;
    g.strokeStyle = selected ? '#ffad62' : shade(col, 0.25);
    g.stroke();
    if (m && m.type !== 'gen' && !C.Media.isOnline(m) && w > 60) { g.fillStyle = '#ffb3ad'; g.font = '700 9px Segoe UI'; g.fillText('OFFLINE', x + w - 50, yy + hh - 8); }
    g.restore();
  }
  // Frames a linked clip has slipped against its partner (video vs audio of the same source); 0 when in sync
  function syncOffset(s, c) {
    if (!c.link || c.reverse || c.freeze != null || T.hasRamp(c)) return 0;
    var o = P.linked(s, c).filter(function (x) { return x !== c && x.mediaId === c.mediaId && x.kind !== c.kind && !x.reverse && x.freeze == null; })[0];
    if (!o || Math.abs(o.speed - c.speed) > 1e-6) return 0;
    var z = function (x) { return x.start - x.in * s.fps / x.speed; }; // timeline frame where source time 0 would sit
    var d = Math.round(z(c) - z(o));
    return Math.abs(d) >= 1 ? d : 0;
  }
  TL.syncOffset = syncOffset;
  function drawFilm(g, s, c, m, x, y, w, hh, x0, x1) {
    var rt = C.MRT[m.id];
    if (m.type === 'nest') {
      g.fillStyle = 'rgba(10,8,6,.25)'; g.fillRect(x0, y, x1 - x0, hh);
      g.strokeStyle = 'rgba(242,235,227,.18)'; g.lineWidth = 1;
      for (var sx = Math.floor(x0 / 12) * 12; sx < x1; sx += 12) { g.beginPath(); g.moveTo(sx, y + hh); g.lineTo(sx + hh * 0.6, y); g.stroke(); }
      g.fillStyle = 'rgba(242,235,227,.75)'; g.font = '600 10px Segoe UI, sans-serif'; g.textBaseline = 'middle';
      g.fillText('▣ nested: ' + m.name, Math.max(x + 6, 4), y + hh / 2);
      return;
    }
    if (m.type === 'gen' || m.type === 'image') {
      var th = m.type === 'gen' && c.gen ? genThumb(c, m) : rt && rt.thumb; if (!th) return;
      var tw = hh * th.width / th.height;
      for (var px = Math.max(x, x0 - ((x0 - x) % tw)); px < x1; px += tw) g.drawImage(th, px, y, tw, hh);
      g.fillStyle = 'rgba(10,8,6,.25)'; g.fillRect(x0, y, x1 - x0, hh);
      return;
    }
    if (!rt) return;
    var aspect = (m.w || 16) / (m.h || 9), tw2 = Math.max(8, hh * aspect);
    var start = x + Math.floor((x0 - x) / tw2) * tw2;
    var lazy = C.Media.isLong(C.Media.base(m)), step = 0;
    if (lazy) { // seconds of source per tile, rounded to a nice grid so thumbnails are reused while scrolling
      var per = tw2 / TL.ppf / s.fps * Math.abs(c.speed || 1);
      var NICE = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
      step = NICE[NICE.length - 1]; for (var ni = 0; ni < NICE.length; ni++) if (NICE[ni] >= per) { step = NICE[ni]; break; }
    }
    for (var p = start; p < x1; p += tw2) {
      var f = TL.x2f(p + tw2 / 2);
      var t = P.sourceSec(s, c, U.clamp(f, c.start, c.start + c.dur - 1));
      var fr = lazy ? C.Media.thumbAt(m.id, t, step) : C.Media.filmFrame(m.id, t);
      if (fr) g.drawImage(fr, p, y, tw2, hh);
    }
    g.fillStyle = 'rgba(10,8,6,.18)'; g.fillRect(x0, y, x1 - x0, hh);
  }
  // logarithmic waveform display so quiet material stays visible
  function wscale(v) { if (v <= 0.0005) return 0; return U.clamp((20 * Math.log10(v) + 54) / 54, 0, 1.1); }
  var genCache = {};
  function genThumb(c, m) {
    var sig = JSON.stringify(c.gen), e = genCache[c.id];
    if (e && e.sig === sig) return e.cv;
    var s = seq(), cv = document.createElement('canvas'), H = 54, W = Math.round(H * s.w / s.h);
    cv.width = W; cv.height = H;
    var g = cv.getContext('2d');
    if (c.gen.kind === 'title') { g.fillStyle = '#1d2228'; g.fillRect(0, 0, W, H); g.fillStyle = '#262c33'; for (var yy = 0; yy < H; yy += 9) for (var xx = (yy / 9) % 2 * 9; xx < W; xx += 18) g.fillRect(xx, yy, 9, 9); }
    else if (c.gen.kind === 'adjust') { g.fillStyle = '#3a4350'; g.fillRect(0, 0, W, H); }
    try { var big = C.Titles.renderGen(c.gen, c, c.gen.kind === 'countdown' ? 0.3 : 0, Math.min(480, s.w), Math.min(480, s.w) * s.h / s.w, null); if (big) g.drawImage(big, 0, 0, W, H); } catch (err) { }
    genCache[c.id] = { sig: sig, cv: cv };
    return cv;
  }
  function drawWave(g, s, c, m, x, y, w, hh, x0, x1, col) {
    if (m.type === 'gen') C.Media.genBuffer(m);
    var rt = C.MRT[(C.Media.base(m) || m).id];
    var pk = rt && rt.peaks;
    var xa = Math.max(x0, x), xb = Math.min(x1, x + w);
    if (!pk) { if (rt && rt.stream && hh > 14) { g.fillStyle = 'rgba(242,235,227,.55)'; g.font = '10px Segoe UI, sans-serif'; g.textBaseline = 'middle'; g.fillText('Reading audio…', Math.max(x + 6, 6), y + hh / 2); } return; }
    var mid = y + hh / 2, amp = hh * 0.46 * U.clamp(1 + (c.au.vol + (c.au.gain || 0)) / 54, 0.05, 1.25);
    g.fillStyle = shade(col, 0.35);
    var loop = rt.loop, pendingFrom = null;
    g.beginPath();
    for (var px = Math.floor(xa); px < xb; px++) {
      var fA = TL.x2f(px), fB = TL.x2f(px + 1);
      var tA = P.sourceSec(s, c, fA), tB = P.sourceSec(s, c, fB);
      if (c.reverse) { var tmp = tA; tA = tB; tB = tmp; }
      if (pendingFrom == null && C.Media.peaksPending(pk, tA)) pendingFrom = px;
      var sp = C.Media.peakSpan(pk, tA, tB, loop);
      var a = wscale(sp.hi) * amp, b = -wscale(-sp.lo) * amp;
      g.rect(px, mid - a, 1, Math.max(1, a - b));
    }
    g.fill();
    // background waveform pass still running: hatch the part not analysed yet + show progress
    if (pk.done < 1 && pk.levels) {
      if (pendingFrom != null) { g.fillStyle = 'rgba(10,8,6,.28)'; for (var hx = Math.floor(pendingFrom / 8) * 8; hx < xb; hx += 8) g.fillRect(hx, y, 3, hh); }
      if (hh > 14) { g.fillStyle = 'rgba(242,235,227,.75)'; g.font = '600 9.5px Segoe UI, sans-serif'; g.textBaseline = 'bottom'; g.fillText('Waveform ' + Math.floor(pk.done * 100) + '%', Math.max(x + 6, 6), y + hh - 2); }
    }
  }

  /* ---------- Meters ---------- */
  var peakHold = [-96, -96], peakT = [0, 0], cur = [-96, -96];
  function meterLoop() {
    requestAnimationFrame(meterLoop);
    var cv = TL.meterCv; if (!cv || !cv.width) return;
    var lv = C.Mixer.levels(seq());
    var dpr = window.devicePixelRatio || 1, W = cv.width / dpr, H = cv.height / dpr;
    var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#1c1916'; g.fillRect(0, 0, W, H);
    var now = performance.now();
    for (var c = 0; c < 2; c++) {
      var db = lv ? U.gainToDb(lv.master[c]) : -96;
      cur[c] = db > cur[c] ? db : Math.max(db, cur[c] - 1.2);
      if (cur[c] > peakHold[c] || now - peakT[c] > 1500) { peakHold[c] = cur[c]; peakT[c] = now; }
    }
    var top = 6, bot = H - 6, mh = bot - top;
    var Y = function (db) { return top + mh * (1 - U.clamp((db + 60) / 66, 0, 1)); };
    var bw = 9, gap = 3, bx0 = W - 2 * bw - gap - 6;
    for (c = 0; c < 2; c++) {
      var bx = bx0 + c * (bw + gap);
      g.fillStyle = '#0d0c0a'; g.fillRect(bx, top, bw, mh);
      var grd = g.createLinearGradient(0, bot, 0, top);
      grd.addColorStop(0, '#3dbfae'); grd.addColorStop(0.62, '#8fcf6a'); grd.addColorStop(0.82, '#e2b93d'); grd.addColorStop(0.92, '#f0913a'); grd.addColorStop(1, '#e5534b');
      var yv = Y(cur[c]); g.fillStyle = grd; g.fillRect(bx, yv, bw, bot - yv);
      var yp = Y(peakHold[c]); g.fillStyle = peakHold[c] > -0.5 ? '#e5534b' : '#f2ebe3'; g.fillRect(bx, yp, bw, 1.5);
    }
    g.fillStyle = '#8d8277'; g.font = '8.5px sans-serif'; g.textAlign = 'right'; g.textBaseline = 'middle';
    [0, -6, -12, -18, -24, -36, -48, -60].forEach(function (d) { var yy = Y(d); g.fillText(String(d), bx0 - 3, yy); g.fillStyle = '#3a332d'; g.fillRect(bx0 - 2, yy, 2, 1); g.fillStyle = '#8d8277'; });
  }

  /* ---------- Hit testing ---------- */
  function contentY(clientY) { var r = TL.scroller.getBoundingClientRect(); return clientY - r.top + TL.scrollY; }
  function localX(clientX) { var r = TL.scroller.getBoundingClientRect(); return clientX - r.left; }
  TL.hit = function (clientX, clientY) {
    var s = seq(), x = localX(clientX), y = contentY(clientY);
    var row = TL.rowAtY(y), out = { x: x, y: y, row: row, f: TL.x2f(x) };
    if (!row) return out;
    if (row.cap) {
      var cp = s.captions.filter(function (c) { return out.f >= c.start && out.f < c.end; })[0];
      if (cp) { out.cap = cp; var ex = Math.min(6, (cp.end - cp.start) * TL.ppf / 4); out.part = x - TL.f2x(cp.start) < ex ? 'start' : TL.f2x(cp.end) - x < ex ? 'end' : 'body'; }
      return out;
    }
    out.track = row.track;
    // transition rects first (objects replaced by undo/live edits get their rect on the next draw: draw now if missing)
    if (s.transitions.some(function (t) { return !t._rect; })) draw();
    var tr = s.transitions.filter(function (t) {
      if (t.trackId !== row.track.id || !t._rect) return false;
      var R = t._rect, sy = y - TL.scrollY + TL.RULER - TL.RULER; void sy;
      var yy = y - TL.scrollY + TL.RULER;
      return x >= R[0] - 3 && x <= R[0] + R[2] + 3 && yy >= R[1] && yy <= R[1] + R[3];
    })[0];
    if (tr) {
      out.transition = tr; var R = tr._rect;
      out.part = x - R[0] < 5 ? 'tstart' : R[0] + R[2] - x < 5 ? 'tend' : 'tbody';
      return out;
    }
    var clips = s.clips.filter(function (c) { return c.trackId === row.track.id; });
    var edge = 7;
    for (var i = 0; i < clips.length; i++) {
      var c = clips[i], cx = TL.f2x(c.start), cw = c.dur * TL.ppf;
      if (x >= cx - edge && x <= cx + cw + edge) {
        var e = Math.min(edge, cw / 3);
        var inside = x >= cx && x <= cx + cw;
        if (!inside && !(Math.abs(x - cx) <= e || Math.abs(x - cx - cw) <= e)) continue;
        out.clip = c;
        var ry = y - row.y, headH = Math.min(15, (row.h - 2) * 0.32), bodyY = headH + 1, bodyH = row.h - 2 - headH;
        if (Math.abs(x - cx) <= e) out.part = 'start';
        else if (Math.abs(x - cx - cw) <= e) out.part = 'end';
        else out.part = 'body';
        // prefer the clip whose body contains x when touching edges between two clips
        if (out.part === 'end') { var nx = clips.filter(function (o) { return o.start === c.start + c.dur; })[0]; if (nx && x > cx + cw) { out.clip = nx; out.part = 'start'; } }
        if (out.clip !== c) { c = out.clip; cx = TL.f2x(c.start); cw = c.dur * TL.ppf; }
        // fade handles sit in the top corners of the audio body; they win over edge trimming there
        // (with no fade the handle is right at the edge, so otherwise it could never be grabbed)
        if (c.kind === 'audio' && (out.part === 'body' || out.part === 'start' || out.part === 'end') && x >= cx - 1 && x <= cx + cw + 1 && Math.abs(ry - bodyY - 2) < 6 && cw > 24) {
          var fiX0 = cx + (c.fadeIn || 0) * TL.ppf, foX0 = cx + cw - (c.fadeOut || 0) * TL.ppf;
          if (Math.abs(x - fiX0) < 6 && (out.part !== 'end')) out.part = 'fadeIn';
          else if (Math.abs(x - foX0) < 6 && (out.part !== 'start')) out.part = 'fadeOut';
        }
        if (c.kind === 'audio' && out.part === 'body') {
          if (out.part === 'body' && bodyH > 16 && !KF.has(c, 'au.vol')) {
            var vy = bodyY + bodyH * (1 - U.clamp((c.au.vol + (c.au.gain || 0) + 60) / 72, 0, 1));
            if (Math.abs(ry - vy) < 4) out.part = 'volume';
          }
        }
        if (out.part === 'body' && C.prefs.showKeyframes && c.kf && row.h > 26) {
          var ky = row.h - 2 - 7 + 1;
          if (Math.abs(ry - ky) < 6) {
            var kfs = KF.allFrames(c);
            for (var k = 0; k < kfs.length; k++) { var kx = TL.f2x(c.start + kfs[k] + 0.5); if (Math.abs(kx - x) < 6) { out.part = 'kf'; out.kf = kfs[k]; break; } }
          }
        }
        return out;
      }
    }
    // gap?
    var gap = T.gapAt(s, row.track.id, Math.floor(out.f));
    if (gap) out.gap = gap;
    return out;
  };

  /* ---------- Snapping ---------- */
  TL.snapPoints = function (excl) {
    var s = seq(), pts = [0, C.Engine.frame];
    if (s.inF != null) pts.push(s.inF); if (s.outF != null) pts.push(s.outF);
    s.markers.forEach(function (m) { pts.push(m.f); });
    s.clips.forEach(function (c) { if (excl && excl[c.id]) return; pts.push(c.start, c.start + c.dur); (c.markers || []).forEach(function (m) { pts.push(c.start + m.f); }); });
    s.captions.forEach(function (c) { pts.push(c.start, c.end); });
    return pts;
  };
  TL.snap = function (f, excl, pts, force) {
    if (!C.state.snapping && !force) return { f: f, d: null };
    pts = pts || TL.snapPoints(excl);
    var th = 8 / TL.ppf, best = null, bd = th;
    pts.forEach(function (p) { var d = Math.abs(p - f); if (d < bd) { bd = d; best = p; } });
    return best == null ? { f: f, d: null } : { f: best, d: best - f };
  };

  /* ---------- Hover ---------- */
  function onHover(e) {
    if (TL.dragging || e.buttons) return;
    var ht = TL.hit(e.clientX, e.clientY), tool = C.state.tool, cur = '';
    var prev = TL.hoverInfo && TL.hoverInfo.clip;
    TL.hoverInfo = ht.clip ? { clip: ht.clip.id } : null;
    if (prev !== (TL.hoverInfo && TL.hoverInfo.clip)) TL.redraw();
    if (ht.transition) cur = ht.part === 'tbody' ? 'pointer' : 'ew-resize';
    else if (ht.clip) {
      var p = ht.part;
      if (tool === 'select' || tool === 'ripple' || tool === 'roll' || tool === 'rate') {
        if (p === 'start' || p === 'end') cur = tool === 'ripple' ? (p === 'start' ? 'w-resize' : 'e-resize') : tool === 'roll' ? 'col-resize' : 'ew-resize';
        else if (p === 'fadeIn' || p === 'fadeOut') cur = 'ew-resize';
        else if (p === 'volume') cur = 'ns-resize';
        else if (p === 'kf') cur = 'pointer';
        else cur = tool === 'select' ? 'default' : '';
      }
    } else if (ht.cap) cur = ht.part === 'body' ? 'move' : 'ew-resize';
    var base = { razor: 'crosshair', hand: 'grab', zoom: 'zoom-in', text: 'text', slip: 'ew-resize', slide: 'ew-resize', trackfwd: 'e-resize' }[tool] || '';
    TL.scroller.style.cursor = cur || base;
  }

  /* ---------- Tooltip ---------- */
  var tip = null;
  function showTip(text, x, y) { if (!tip) { tip = h('div.tl-tooltip'); document.body.appendChild(tip); } tip.textContent = text; tip.style.left = (x + 14) + 'px'; tip.style.top = (y + 16) + 'px'; tip.style.display = ''; }
  function hideTip() { if (tip) tip.style.display = 'none'; }
  function dtc(d) { return (d >= 0 ? '+' : '−') + U.fmtTC(Math.abs(d), fps(), { short: true }); }

  /* ---------- Pointer down ---------- */
  function onRulerDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    var s = seq(); if (!s) return;
    var mk = rulerMarkerAt(e.offsetX);
    if (mk) {
      C.state.selMarker = mk.id; C.state.selection = []; C.bus.emit('selection');
      var f0 = mk.f, id = mk.id, moved = false;
      U.drag(e, function (dx) {
        H_revert(); var m2 = seq().markers.filter(function (x) { return x.id === id; })[0]; if (!m2) return;
        var sn = TL.snap(f0 + dx / TL.ppf, null, null); m2.f = Math.max(0, Math.round(sn.f)); TL.snapLine = sn.d != null ? m2.f : null; moved = dx !== 0; C.live();
      }, function () { TL.snapLine = null; if (moved) C.commit('Move Marker'); else { C.Engine.seek(f0); H_revert(); } TL.redraw(); });
      return;
    }
    var wasPlaying = C.Engine.playing;
    if (wasPlaying) C.Engine.pause();
    TL.dragging = true;
    var r = TL.rulerHit.getBoundingClientRect();
    var pts = TL.snapPoints();
    function at(ev) {
      var f = TL.x2f(ev.clientX - r.left);
      var sn = ev.shiftKey || C.state.snapping ? TL.snap(f, null, pts.filter(function (p) { return p !== C.Engine.frame; }), ev.shiftKey) : { f: f, d: null };
      TL.snapLine = sn.d != null ? sn.f : null;
      C.Engine.seek(Math.max(0, Math.round(sn.f)), { scrub: true });
    }
    at(e);
    U.drag(e, function (dx, dy, ev) { at(ev); }, function () { TL.dragging = false; TL.snapLine = null; TL.redraw(); });
  }
  function rulerMarkerAt(x) {
    var s = seq(); if (!s) return null;
    return s.markers.filter(function (m) { return Math.abs(TL.f2x(m.f) - x) < 6; })[0] || null;
  }
  function H_revert() { C.H.revertLive(); }

  function onDown(e) {
    var s = seq(); if (!s) return;
    if (e.button === 1 || (e.button === 0 && C.state.tool === 'hand')) { handDrag(e); return; }
    if (e.button !== 0) return;
    if (e.target !== TL.scroller && e.target !== TL.spacer) return;
    // clicks on the scrollbar area
    var sr = TL.scroller.getBoundingClientRect();
    if (e.clientX > sr.left + TL.scroller.clientWidth || e.clientY > sr.top + TL.scroller.clientHeight) return;
    e.preventDefault();
    if (C.Engine.playing && C.state.tool !== 'select') C.Engine.pause();
    var ht = TL.hit(e.clientX, e.clientY), tool = C.state.tool;
    C.state.selGap = null;
    if (tool === 'zoom') { setPpf(TL.ppf * (e.altKey ? 1 / 1.6 : 1.6), ht.x); return; }
    if (ht.cap) { capDrag(e, ht); return; }
    if (ht.transition) { transitionDrag(e, ht); return; }
    if (tool === 'razor') {
      if (!ht.clip) return;
      var sn = TL.snap(Math.round(ht.f), null);
      var f = Math.round(sn.f);
      if (e.shiftKey) { C.Engine.seek(f); A.split(true); } else A.splitAt(ht.clip, f, e.altKey);
      return;
    }
    if (tool === 'trackfwd') {
      var ff = Math.floor(ht.f);
      var ids = s.clips.filter(function (c) { return (e.shiftKey || (ht.track && c.trackId === ht.track.id)) && c.start + c.dur > ff; }).map(function (c) { return c.id; });
      A.select(ids);
      if (ids.length) moveDrag(e, ht, true);
      return;
    }
    if (!ht.clip) {
      if (ht.gap && !e.shiftKey && !e.ctrlKey) { C.state.selection = []; C.state.selGap = { trackId: ht.track.id, s: ht.gap[0], e: ht.gap[1] }; C.bus.emit('selection'); }
      marquee(e, ht);
      return;
    }
    var c = ht.clip, part = ht.part;
    if (P.isTrackLocked(s, c.trackId)) { C.toast('Track is locked'); return; }
    if (tool === 'slip' && part === 'body') { slipDrag(e, c); return; }
    if (tool === 'slide' && part === 'body') { slideDrag(e, c); return; }
    if (part === 'fadeIn' || part === 'fadeOut') { fadeDrag(e, c, part); return; }
    if (part === 'volume') { volumeDrag(e, c); return; }
    if (part === 'kf') { kfDrag(e, c, ht.kf); return; }
    if (part === 'start' || part === 'end') {
      if (tool === 'roll') { rollDrag(e, c, part); return; }
      if (tool === 'rate') { rateDrag(e, c, part); return; }
      trimDrag(e, c, part, tool === 'ripple');
      return;
    }
    // body: select + move
    var clickToSelect = null;
    if (e.shiftKey || e.ctrlKey || e.metaKey) { A.toggleSelect(c.id); if (C.state.selection.indexOf(c.id) < 0) return; }
    else if (C.state.selection.indexOf(c.id) < 0) A.select([c.id]);
    else if (C.state.selection.length > (C.state.linked ? P.linked(s, c).length : 1)) clickToSelect = c.id; // plain click (no drag) inside a multi-selection selects just this clip
    if (e.altKey) { C.state.selection = C.state.selection.filter(function (id) { var x = P.clip(s, id); return x && (x.id === c.id || !x.link || x.link !== c.link); }); C.bus.emit('selection'); clickToSelect = null; }
    moveDrag(e, ht, false, clickToSelect);
  }
  function handDrag(e) {
    e.preventDefault();
    var sx = TL.scrollX, sy = TL.scroller.scrollTop;
    TL.scroller.style.cursor = 'grabbing';
    U.drag(e, function (dx, dy) { TL.setScrollX(sx - dx); TL.scroller.scrollTop = sy - dy; }, function () { TL.updateButtons(); });
  }
  function marquee(e, ht) {
    var r = TL.scroller.getBoundingClientRect();
    var x0 = e.clientX - r.left, y0 = e.clientY - r.top + TL.RULER;
    var add = e.shiftKey || e.ctrlKey, base = add ? C.state.selection.slice() : [];
    var moved = false;
    TL.dragging = true;
    U.drag(e, function (dx, dy, ev) {
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      moved = true;
      var x1 = ev.clientX - r.left, y1 = ev.clientY - r.top + TL.RULER;
      TL.marquee = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
      var fA = TL.x2f(TL.marquee.x), fB = TL.x2f(TL.marquee.x + TL.marquee.w);
      var yA = TL.marquee.y - TL.RULER + TL.scrollY, yB = yA + TL.marquee.h;
      var s = seq(), ids = base.slice();
      s.clips.forEach(function (c) {
        var row = TL.rowOf(c.trackId); if (!row) return;
        if (c.start < fB && c.start + c.dur > fA && row.y < yB && row.y + row.h > yA && ids.indexOf(c.id) < 0) ids.push(c.id);
      });
      C.state.selection = ids; C.state.selGap = null; C.bus.emit('selection');
    }, function () {
      TL.dragging = false; TL.marquee = null;
      if (!moved) {
        if (!add && !C.state.selGap) A.deselect();
      } else if (C.state.linked) A.select(C.state.selection, false);
      TL.redraw();
    });
  }

  /* --- move --- */
  function moveDrag(e, ht, fromTrackSelect, clickToSelect) {
    var s = seq();
    var ids = C.state.selection.filter(function (id) { var c = P.clip(s, id); return c && !P.isTrackLocked(s, c.trackId); });
    if (!ids.length) return;
    var orig = ids.map(function (id) { var c = P.clip(s, id); return { id: id, start: c.start, trackId: c.trackId, kind: c.kind, dur: c.dur }; });
    var excl = {}; ids.forEach(function (id) { excl[id] = 1; });
    var pts = TL.snapPoints(excl);
    var grabRow = ht.row, moved = false, last = null;
    var vts = P.vtracks(s), ats = P.atracks(s);
    var minStart = Math.min.apply(null, orig.map(function (o) { return o.start; }));
    TL.dragging = true;
    U.drag(e, function (dx, dy, ev) {
      if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      moved = true;
      var df = Math.round(dx / TL.ppf);
      // snapping: test all clip edges
      var bestD = null;
      if (C.state.snapping) {
        orig.forEach(function (o) {
          [o.start + df, o.start + o.dur + df].forEach(function (f) { var sn = TL.snap(f, excl, pts); if (sn.d != null && (bestD == null || Math.abs(sn.d) < Math.abs(bestD))) bestD = sn.d; });
        });
        if (bestD != null) df += bestD;
      }
      if (minStart + df < 0) df = -minStart;
      // track offset
      var row = TL.rowAtY(contentY(ev.clientY));
      var dV = 0, dA = 0;
      if (row && row.track && grabRow && grabRow.track && !fromTrackSelect) {
        var gk = grabRow.track.kind, rk = row.track.kind;
        if (gk === rk) {
          var list = gk === 'video' ? vts : ats;
          // compare by id: live updates revert/clone the project, so row.track may be a newer object than list's entries
          var idx = function (t) { for (var i = 0; i < list.length; i++) if (list[i].id === t.id) return i; return -1; };
          var ri = idx(row.track), gi = idx(grabRow.track);
          var d = ri >= 0 && gi >= 0 ? ri - gi : 0;
          if (gk === 'video') dV = d; else dA = d;
        }
      }
      // clamp track offsets
      orig.forEach(function (o) {
        var list = o.kind === 'video' ? vts : ats, idx = list.findIndex(function (t) { return t.id === o.trackId; });
        if (o.kind === 'video') dV = U.clamp(dV, -idx, list.length - 1 - idx); else dA = U.clamp(dA, -idx, list.length - 1 - idx);
      });
      var mode = (ev.ctrlKey || ev.metaKey) ? 'insert' : 'overwrite';
      var key = df + '|' + dV + '|' + dA + '|' + mode;
      if (key === last) return; last = key;
      C.H.revertLive();
      var s2 = seq();
      var v2 = P.vtracks(s2), a2 = P.atracks(s2);
      var moves = orig.map(function (o) {
        var list = o.kind === 'video' ? v2 : a2, idx = list.findIndex(function (t) { return t.id === o.trackId; });
        var nt = list[idx + (o.kind === 'video' ? dV : dA)];
        return { clip: P.clip(s2, o.id), start: o.start + df, trackId: (nt && !nt.lock) ? nt.id : o.trackId };
      });
      T.applyMoves(s2, moves, mode);
      T.validate(s2);
      TL.snapLine = null;
      if (bestD != null) {
        // show the snap position: the moved edge that snapped
        var sp = null;
        orig.forEach(function (o) { [o.start + df, o.start + o.dur + df].forEach(function (f) { if (sp == null && pts.indexOf(f) >= 0) sp = f; }); });
        TL.snapLine = sp;
      }
      C.live();
      showTip((mode === 'insert' ? 'Insert ' : 'Move ') + dtc(df), ev.clientX, ev.clientY);
    }, function () {
      TL.dragging = false; hideTip(); TL.snapLine = null;
      if (moved) C.commit('Move Clips');
      else {
        C.H.revertLive();
        if (clickToSelect) A.select([clickToSelect]);
      }
      TL.redraw();
    });
  }

  /* --- trim (selection / ripple) --- */
  function trimDrag(e, c, edge, ripple) {
    var s = seq(), id = c.id, alt = e.altKey;
    var partners = (C.state.linked && !alt) ? P.linked(s, c).map(function (x) { return x.id; }) : [id];
    var o0 = { start: c.start, end: c.start + c.dur };
    var excl = {}; partners.forEach(function (p) { excl[p] = 1; });
    var pts = TL.snapPoints(excl), moved = false, ph0 = C.Engine.frame;
    TL.dragging = true;
    U.drag(e, function (dx, dy, ev) {
      moved = true;
      var raw = (edge === 'start' ? o0.start : o0.end) + dx / TL.ppf;
      var sn = TL.snap(raw, excl, pts), nf = Math.round(sn.f);
      C.H.revertLive();
      var s2 = seq(), cc = P.clip(s2, id), d = 0;
      if (ripple) {
        var savedLinked = C.state.linked; if (alt) C.state.linked = false;
        d = T.rippleTrim(s2, cc, edge, nf);
        C.state.linked = savedLinked;
      } else {
        // can't cross neighbours on the same track
        var nb = T.neighbors(s2, cc);
        if (edge === 'start') {
          if (nb.prevAny) nf = Math.max(nf, nb.prevAny.start + nb.prevAny.dur);
          var before = cc.start; T.setStart(s2, cc, nf); d = cc.start - before;
          partners.forEach(function (pid) { if (pid === id) return; var p = P.clip(s2, pid); if (p) { var pn = T.neighbors(s2, p); var t = p.start + d; if (pn.prevAny) t = Math.max(t, pn.prevAny.start + pn.prevAny.dur); T.setStart(s2, p, t); } });
        } else {
          if (nb.nextAny) nf = Math.min(nf, nb.nextAny.start);
          var be = cc.start + cc.dur; T.setEnd(s2, cc, nf); d = cc.start + cc.dur - be;
          partners.forEach(function (pid) { if (pid === id) return; var p = P.clip(s2, pid); if (p) { var pn = T.neighbors(s2, p); var t = p.start + p.dur + d; if (pn.nextAny) t = Math.min(t, pn.nextAny.start); T.setEnd(s2, p, t); } });
        }
      }
      T.validate(s2);
      TL.snapLine = sn.d != null ? nf : null;
      C.live();
      var cc2 = P.clip(seq(), id);
      showTip((ripple ? 'Ripple ' : 'Trim ') + dtc(d) + '   Dur ' + (cc2 ? U.fmtTC(cc2.dur, s2.fps, { short: true }) : ''), ev.clientX, ev.clientY);
      // show trimmed frame in program monitor
      if (cc2) C.Engine.seek(edge === 'start' ? cc2.start : cc2.start + cc2.dur - 1);
    }, function () { TL.dragging = false; TL.snapLine = null; hideTip(); if (moved) C.commit(ripple ? 'Ripple Trim' : 'Trim'); C.Engine.seek(ph0); TL.redraw(); });
  }
  function rollDrag(e, c, edge) {
    var s = seq(), nb = T.neighbors(s, c);
    var a = edge === 'end' ? c : nb.prev, b = edge === 'end' ? nb.next : c;
    if (!a || !b) { trimDrag(e, c, edge, false); return; }
    var aid = a.id, bid = b.id, cut0 = b.start, moved = false, ph0 = C.Engine.frame;
    var excl = {}; excl[aid] = 1; excl[bid] = 1; var pts = TL.snapPoints(excl);
    TL.dragging = true;
    U.drag(e, function (dx, dy, ev) {
      moved = true;
      var sn = TL.snap(cut0 + dx / TL.ppf, excl, pts);
      C.H.revertLive();
      var s2 = seq(), aa = P.clip(s2, aid), bb = P.clip(s2, bid);
      var cut = T.roll(s2, aa, bb, Math.round(sn.f));
      // linked partners roll too
      if (C.state.linked && !ev.altKey) {
        var pa = P.linked(s2, aa).filter(function (x) { return x !== aa; }), pb = P.linked(s2, bb).filter(function (x) { return x !== bb; });
        pa.forEach(function (x) { var n = T.neighbors(s2, x).next; if (n && pb.indexOf(n) >= 0) T.roll(s2, x, n, cut); });
      }
      T.validate(s2);
      TL.snapLine = sn.d != null ? cut : null;
      C.live(); C.Engine.seek(cut);
      showTip('Roll ' + dtc(cut - cut0), ev.clientX, ev.clientY);
    }, function () { TL.dragging = false; TL.snapLine = null; hideTip(); if (moved) C.commit('Rolling Edit'); C.Engine.seek(ph0); TL.redraw(); });
  }
  function rateDrag(e, c, edge) {
    var id = c.id, o0 = { start: c.start, end: c.start + c.dur }, moved = false, s = seq();
    var excl = {}; excl[id] = 1; var pts = TL.snapPoints(excl);
    var partners = C.state.linked ? P.linked(s, c).map(function (x) { return x.id; }) : [id];
    TL.dragging = true;
    U.drag(e, function (dx, dy, ev) {
      moved = true;
      var sn = TL.snap((edge === 'start' ? o0.start : o0.end) + dx / TL.ppf, excl, pts);
      C.H.revertLive();
      var s2 = seq();
      var cc = P.clip(s2, id), nb = T.neighbors(s2, cc), nf = Math.round(sn.f);
      if (edge === 'end' && nb.nextAny) nf = Math.min(nf, nb.nextAny.start);
      if (edge === 'start' && nb.prevAny) nf = Math.max(nf, nb.prevAny.start + nb.prevAny.dur);
      partners.forEach(function (pid) { var p = P.clip(s2, pid); if (p) T.rateStretch(s2, p, edge, nf); });
      T.validate(s2); C.live();
      var c2 = P.clip(seq(), id);
      showTip('Speed ' + (c2 ? Math.round(c2.speed * 1000) / 10 : 100) + '%   Dur ' + (c2 ? U.fmtTC(c2.dur, s2.fps, { short: true }) : ''), ev.clientX, ev.clientY);
    }, function () { TL.dragging = false; hideTip(); if (moved) C.commit('Rate Stretch'); TL.redraw(); });
  }
  function slipDrag(e, c) {
    var id = c.id, moved = false, s = seq(), ph0 = C.Engine.frame;
    var partners = C.state.linked && !e.altKey ? P.linked(s, c).map(function (x) { return x.id; }) : [id];
    TL.dragging = true;
    U.drag(e, function (dx, dy, ev) {
      moved = true;
      C.H.revertLive();
      var s2 = seq(), df = Math.round(dx / TL.ppf);
      partners.forEach(function (pid) { var p = P.clip(s2, pid); if (p) T.slip(s2, p, df); });
      C.live();
      var cc = P.clip(s2, id);
      showTip('Slip ' + dtc(df) + '   In ' + U.fmtTC(Math.round(cc.in * s2.fps), s2.fps, { short: true }), ev.clientX, ev.clientY);
      C.Engine.seek(cc.start);
    }, function () { TL.dragging = false; hideTip(); if (moved) C.commit('Slip'); C.Engine.seek(ph0); });
  }
  function slideDrag(e, c) {
    var id = c.id, moved = false, s = seq();
    // linked partners (e.g. the audio of a video clip) slide by the same amount to stay in sync
    var group = (C.state.linked && !e.altKey ? P.linked(s, c) : [c]).map(function (x) {
      var nb0 = T.neighbors(s, x);
      return { id: x.id, prevId: nb0.prev && nb0.prev.id, nextId: nb0.next && nb0.next.id };
    });
    TL.dragging = true;
    U.drag(e, function (dx, dy, ev) {
      moved = true;
      C.H.revertLive();
      var s2 = seq(), d = Math.round(dx / TL.ppf);
      var parts = group.map(function (g) { return { clip: P.clip(s2, g.id), prev: g.prevId ? P.clip(s2, g.prevId) : null, next: g.nextId ? P.clip(s2, g.nextId) : null }; }).filter(function (g) { return g.clip; });
      parts.forEach(function (g) { d = T.slideClamp(s2, g.clip, d, g.prev, g.next); });
      parts.forEach(function (g) {
        T.slide(s2, g.clip, d, g.prev, g.next);
        if (!g.prev || !g.next) { // no neighbour on a side: prevent overlaps
          var ex = {}; ex[g.clip.id] = 1;
          T.clearRange(s2, g.clip.trackId, g.clip.start, g.clip.start + g.clip.dur, ex);
        }
      });
      T.validate(s2); C.live();
      showTip('Slide ' + dtc(d), ev.clientX, ev.clientY);
    }, function () { TL.dragging = false; hideTip(); if (moved) C.commit('Slide'); });
  }
  function fadeDrag(e, c, part) {
    var id = c.id, moved = false, f0 = part === 'fadeIn' ? c.fadeIn : c.fadeOut;
    TL.dragging = true;
    U.drag(e, function (dx, dy, ev) {
      moved = true;
      var cc = P.clip(seq(), id); if (!cc) return;
      var d = Math.round(dx / TL.ppf) * (part === 'fadeIn' ? 1 : -1);
      var v = U.clamp(f0 + d, 0, cc.dur);
      if (part === 'fadeIn') cc.fadeIn = Math.min(v, cc.dur - (cc.fadeOut || 0)); else cc.fadeOut = Math.min(v, cc.dur - (cc.fadeIn || 0));
      C.live();
      showTip((part === 'fadeIn' ? 'Fade in ' : 'Fade out ') + U.fmtTC(v, fps(), { short: true }), ev.clientX, ev.clientY);
    }, function () { TL.dragging = false; hideTip(); if (moved) C.commit('Audio Fade'); });
  }
  function volumeDrag(e, c) {
    var id = c.id, moved = false, v0 = c.au.vol, row = TL.rowOf(c.trackId);
    var bodyH = row.h - 2 - Math.min(15, (row.h - 2) * 0.32);
    TL.dragging = true;
    U.drag(e, function (dx, dy, ev) {
      moved = true;
      var cc = P.clip(seq(), id); if (!cc) return;
      cc.au.vol = U.round(U.clamp(v0 - dy / bodyH * 72 * (ev.shiftKey ? 0.2 : 1), -60, 12), 1);
      C.live();
      showTip('Volume ' + (cc.au.vol >= 0 ? '+' : '') + cc.au.vol.toFixed(1) + ' dB', ev.clientX, ev.clientY);
    }, function () { TL.dragging = false; hideTip(); if (moved) C.commit('Clip Volume'); C.bus.emit('inspector:refresh'); });
  }
  function kfDrag(e, c, kfF) {
    var id = c.id, moved = false, span0 = T.hasRamp(c) ? T.srcSpan(seq(), c, c.dur) : null, dur0 = c.dur;
    A.select([id]);
    TL.dragging = true;
    U.drag(e, function (dx, dy, ev) {
      var df = Math.round(dx / TL.ppf); if (!df && !moved) return;
      moved = true;
      C.H.revertLive();
      var cc = P.clip(seq(), id);
      var nf = U.clamp(kfF + df, 0, dur0 - 1);
      for (var p in cc.kf) {
        var keys = cc.kf[p];
        if (keys.some(function (k) { return k.f === nf; }) && nf !== kfF) continue;
        keys.forEach(function (k) { if (k.f === kfF) k.f = nf; });
        KF.sort(keys);
      }
      if (span0 != null) T.fitRampDur(seq(), cc, span0);
      C.live(); C.Engine.seek(cc.start + nf);
      showTip('Keyframe ' + U.fmtTC(nf, fps(), { short: true }), ev.clientX, ev.clientY);
    }, function () { TL.dragging = false; hideTip(); if (moved) C.commit('Move Keyframes'); else C.Engine.seek(c.start + kfF); });
  }
  function transitionDrag(e, ht) {
    var tr = ht.transition, id = tr.id, part = ht.part;
    C.state.selTransition = id; C.state.selection = []; C.bus.emit('selection');
    C.ui.showTab && C.ui.showTab('inspector');
    if (part === 'tbody') return;
    var d0 = tr.dur, moved = false;
    TL.dragging = true;
    U.drag(e, function (dx, dy, ev) {
      moved = true;
      C.H.revertLive();
      var s2 = seq(), t2 = P.findTransition(s2, id); if (!t2) return;
      var df = Math.round(dx / TL.ppf) * (part === 'tstart' ? -1 : 1);
      var k = (t2.a && t2.b && t2.align === 'center') ? 2 : 1;
      t2.dur = Math.max(1, d0 + df * k);
      T.validate(s2); C.live();
      showTip('Duration ' + U.fmtTC(t2.dur, s2.fps, { short: true }), ev.clientX, ev.clientY);
    }, function () { TL.dragging = false; hideTip(); if (moved) C.commit('Transition Duration'); });
  }
  function capDrag(e, ht) {
    var cp = ht.cap, id = cp.id, part = ht.part, s0 = cp.start, e0 = cp.end, moved = false;
    TL.selCap = id; C.bus.emit('caption:select', id);
    TL.dragging = true;
    U.drag(e, function (dx, dy, ev) {
      moved = true;
      C.H.revertLive();
      var s2 = seq(), c2 = s2.captions.filter(function (x) { return x.id === id; })[0]; if (!c2) return;
      var df = Math.round(dx / TL.ppf);
      if (part === 'body') { var sn = TL.snap(s0 + df, null); df = Math.round(sn.f) - s0; c2.start = Math.max(0, s0 + df); c2.end = c2.start + (e0 - s0); }
      else if (part === 'start') c2.start = U.clamp(Math.round(TL.snap(s0 + df).f), 0, e0 - 1);
      else c2.end = Math.max(s0 + 1, Math.round(TL.snap(e0 + df).f));
      C.live();
    }, function () { TL.dragging = false; if (moved) C.commit('Edit Caption Timing'); else C.Engine.seek(cp.start); TL.redraw(); });
  }

  /* ---------- Double click & context ---------- */
  function onDbl(e) {
    var ht = TL.hit(e.clientX, e.clientY);
    if (ht.transition) { C.state.selTransition = ht.transition.id; C.bus.emit('selection'); C.ui.showTab('inspector'); return; }
    if (ht.cap) { C.ui.showLeftTab('captions'); C.bus.emit('caption:select', ht.cap.id); return; }
    if (!ht.clip) return;
    var m = P.media(ht.clip.mediaId);
    if (m && m.type === 'gen') { A.select([ht.clip.id]); C.ui.showTab('inspector'); return; }
    if (m && m.type === 'nest') { A.switchSequence(m.seqId); return; }
    if (m && C.Source) C.Source.open(m.id, P.sourceSec(seq(), ht.clip, U.clamp(Math.round(ht.f), ht.clip.start, ht.clip.start + ht.clip.dur - 1)));
  }
  function onContext(e) {
    e.preventDefault();
    var ht = TL.hit(e.clientX, e.clientY), s = seq();
    if (ht.transition) {
      var tr = ht.transition;
      C.state.selTransition = tr.id; C.bus.emit('selection');
      C.ui.menu([{ label: 'Align: Center on Cut', checked: tr.align === 'center', action: function () { C.edit('Transition Alignment', function (s2) { P.findTransition(s2, tr.id).align = 'center'; }); } },
        { label: 'Align: Start at Cut', checked: tr.align === 'start', action: function () { C.edit('Transition Alignment', function (s2) { P.findTransition(s2, tr.id).align = 'start'; }); } },
        { label: 'Align: End at Cut', checked: tr.align === 'end', action: function () { C.edit('Transition Alignment', function (s2) { P.findTransition(s2, tr.id).align = 'end'; }); } },
        '-', { label: 'Delete Transition', action: function () { A.del(false); } }], e.clientX, e.clientY);
      return;
    }
    if (ht.gap && !ht.clip) {
      C.state.selGap = { trackId: ht.track.id, s: ht.gap[0], e: ht.gap[1] }; TL.redraw();
      C.ui.menu([{ label: 'Ripple Delete Gap', action: function () { A.del(true); } }], e.clientX, e.clientY);
      return;
    }
    if (!ht.clip) {
      C.ui.menu([{ label: 'Paste', kbd: 'Ctrl+V', action: function () { A.paste(false); }, disabled: !C.state.clipboard }, { label: 'Paste Insert', action: function () { A.paste(true); }, disabled: !C.state.clipboard },
        '-', { label: 'Add Video Track', action: function () { A.addTrack('video'); } }, { label: 'Add Audio Track', action: function () { A.addTrack('audio'); } }], e.clientX, e.clientY);
      return;
    }
    var c = ht.clip, m = P.media(c.mediaId);
    if (C.state.selection.indexOf(c.id) < 0) A.select([c.id]);
    var f = Math.round(ht.f);
    var items = [
      { label: 'Cut', kbd: 'Ctrl+X', action: A.cut }, { label: 'Copy', kbd: 'Ctrl+C', action: A.copy }, { label: 'Duplicate', action: A.duplicate },
      { label: 'Delete', kbd: 'Del', action: function () { A.del(false); } }, { label: 'Ripple Delete', kbd: 'Shift+Del', action: function () { A.del(true); } }, '-',
      { label: 'Split Here', action: function () { A.splitAt(c, f); } },
      { label: c.enabled === false ? 'Enable' : 'Disable', action: A.toggleEnable },
      { label: c.link ? 'Unlink' : 'Link', action: A.toggleLink },
      { label: 'Speed / Duration…', kbd: 'Ctrl+R', action: A.speedDialog }, '-'];
    if (c.kind === 'video') {
      items.push({ label: 'Insert Freeze Frame', action: function () { C.Engine.seek(f); A.freezeFrame(); } });
      items.push({ label: 'Scale to Frame Size', checked: !!c.fit, action: function () { A.setFit(!c.fit); } });
      items.push({ label: 'Add Default Transition at Start', action: function () { A.addTransition('video', null, c.start); } });
      items.push({ label: 'Add Default Transition at End', action: function () { A.addTransition('video', null, c.start + c.dur); } });
    } else {
      items.push({ label: 'Normalize', action: A.normalize });
      items.push({ label: 'Add Crossfade at Start', action: function () { A.addTransition('audio', null, c.start); } });
      items.push({ label: 'Add Crossfade at End', action: function () { A.addTransition('audio', null, c.start + c.dur); } });
    }
    items.push('-');
    items.push({ label: 'Copy Attributes', action: A.copyAttributes }, { label: 'Paste Attributes…', action: A.pasteAttributesDialog, disabled: !C.state.attrClipboard });
    if (c.kind === 'video' && m && m.type === 'video') items.push({ label: 'Auto-Reframe…', action: A.reframeDialog });
    items.push({ label: 'Replace with Library Item', kbd: C.CMD.keyLabel('replaceClip'), action: function () { A.replaceClip(); } });
    items.push({ label: 'Select All Clips Using This Media', action: function () { A.selectByMedia(c.mediaId); } });
    items.push('-');
    items.push({ label: 'Rename…', action: function () { C.ui.prompt('Clip name', c.name).then(function (v) { if (v) C.edit('Rename Clip', function (s2) { var x = P.clip(s2, c.id); if (x) x.name = v; }); }); } });
    items.push({ label: 'Reveal in Library', action: function () { var m = P.media(c.mediaId); if (m) { C.ui.showLeftTab('library'); C.Bin.folder = m.folder || null; C.Bin.sel = [m.id]; C.Bin.render(); } } });
    items.push({ label: 'Open in Source Monitor', action: function () { C.Source.open(c.mediaId, P.sourceSec(s, c, U.clamp(f, c.start, c.start + c.dur - 1))); } });
    items.push({ label: 'Label Color', sub: A.MARKER_COLORS.map(function (col, i) { return { label: ['Amber', 'Teal', 'Red', 'Green', 'Yellow', 'Sky', 'Rose', 'Sand'][i], action: function () { A.setLabel(col); } }; }).concat([{ label: 'Default', action: function () { A.setLabel(null); } }]) });
    C.ui.menu(items, e.clientX, e.clientY);
  }

  /* ---------- Drag & drop ---------- */
  function clipAtFrame(s, trackId, f) { return s.clips.filter(function (c) { return c.trackId === trackId && f >= c.start && f < c.start + c.dur; })[0] || null; }
  function hasType(e, t) { return Array.prototype.indexOf.call(e.dataTransfer.types, t) >= 0; }
  function dropTargets(ev, media) {
    var s = seq(), row = TL.rowAtY(contentY(ev.clientY));
    var vts = P.vtracks(s), ats = P.atracks(s);
    var vt = null, at = null;
    var dm = C.state.dragMedia || { video: true, audio: true };
    var hasV = P.mediaHasVideo(media) && dm.video !== false, hasA = P.mediaHasAudio(media) && dm.audio !== false;
    if (row && row.track) {
      var byId = function (list, t) { for (var i = 0; i < list.length; i++) if (list[i].id === t.id) return i; return -1; };
      if (row.track.kind === 'video') { var vi = byId(vts, row.track); vt = vts[vi] || vts[0]; at = ats[Math.min(Math.max(0, vi), ats.length - 1)] || ats[0]; }
      else { var ai = byId(ats, row.track); at = ats[ai] || ats[0]; vt = vts[Math.min(Math.max(0, ai), vts.length - 1)] || vts[0]; }
    } else { vt = vts[0]; at = ats[0]; }
    return { vt: hasV ? vt : null, at: hasA ? at : null };
  }
  function onDragOver(e) {
    var s = seq(); if (!s) return;
    if (hasType(e, 'application/x-cutline-effect') || hasType(e, 'application/x-cutline-transition')) {
      e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
      var ht = TL.hit(e.clientX, e.clientY);
      TL.dropHint = null;
      if (hasType(e, 'application/x-cutline-transition') && !ht.clip && ht.transition && ht.track) ht.clip = clipAtFrame(s, ht.track.id, ht.f);
      if (hasType(e, 'application/x-cutline-transition') && ht.clip) {
        var c = ht.clip, mid = c.start + c.dur / 2, edgeF = ht.f < mid ? c.start : c.start + c.dur;
        TL.dropHint = { x: TL.f2x(edgeF), y: ht.row.y, h: ht.row.h };
      }
      TL.hoverInfo = ht.clip ? { clip: ht.clip.id } : null;
      TL.redraw();
      return;
    }
    var isMedia = hasType(e, 'application/x-cutline-media'), isFiles = hasType(e, 'Files');
    if (!isMedia && !isFiles) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    if (!isMedia || !C.state.dragMedia) { TL.ghost = null; TL.redraw(); return; }
    var dm = C.state.dragMedia, f = Math.max(0, Math.round(TL.x2f(localX(e.clientX))));
    var ghosts = [], pos = f, total = 0;
    var durs = dm.ids.map(function (id) {
      var m = P.media(id); if (!m) return 0;
      if (P.isStill(m)) return Math.round((m.stillDur || C.prefs.stillDur) * s.fps);
      var a = dm.inSec != null ? dm.inSec : (m.sub ? m.sub.in : 0), b = dm.outSec != null ? dm.outSec : (m.sub && dm.inSec == null ? m.sub.out : m.duration);
      return Math.max(1, Math.round((b - a) * s.fps));
    });
    total = durs.reduce(function (a, b) { return a + b; }, 0);
    var sn = TL.snap(f, null), sn2 = TL.snap(f + total, null);
    if (sn.d != null) pos = Math.round(sn.f); else if (sn2.d != null) pos = Math.round(sn2.f) - total;
    pos = Math.max(0, pos);
    dm.ids.forEach(function (id, i) {
      var m = P.media(id); if (!m) return;
      var tg = dropTargets(e, m);
      if (tg.vt) ghosts.push({ trackId: tg.vt.id, start: pos, dur: durs[i], kind: 'video' });
      if (tg.at) ghosts.push({ trackId: tg.at.id, start: pos, dur: durs[i], kind: 'audio' });
      pos += durs[i];
    });
    TL.ghost = ghosts; TL.ghostInsert = e.ctrlKey || e.metaKey;
    TL.snapLine = sn.d != null ? Math.round(sn.f) : null;
    TL.redraw();
  }
  function onDrop(e) {
    var s = seq(); if (!s) return;
    C.state.focus = 'timeline'; // keyboard focus follows the drop (Delete must not act on the Library item that was dragged)
    var ht = TL.hit(e.clientX, e.clientY);
    TL.snapLine = null;
    if (hasType(e, 'application/x-cutline-effect')) {
      e.preventDefault();
      var fx = e.dataTransfer.getData('application/x-cutline-effect');
      TL.dropHint = null; TL.redraw();
      if (!ht.clip) { C.toast('Drop the effect onto a clip'); return; }
      var ids = C.state.selection.indexOf(ht.clip.id) >= 0 ? C.state.selection : [ht.clip.id];
      A.applyEffect(fx, ids);
      // stay in the Effects browser so several effects can be dropped in a row; flag the Inspector tab instead
      A.select([ht.clip.id]); C.ui.pulseTab('inspector');
      return;
    }
    if (hasType(e, 'application/x-cutline-transition')) {
      e.preventDefault();
      var typ = e.dataTransfer.getData('application/x-cutline-transition');
      TL.dropHint = null; TL.redraw();
      if (!ht.clip && ht.transition && ht.track) ht.clip = clipAtFrame(s, ht.track.id, ht.f); // a transition bar may cover a very short clip entirely
      if (!ht.clip) { C.toast('Drop the transition onto a clip edge or cut'); return; }
      var def = C.TR.byId[typ];
      if ((def.kind === 'audio') !== (ht.clip.kind === 'audio')) { C.toast(def.kind === 'audio' ? 'Audio transitions go on audio clips' : 'Video transitions go on video clips'); return; }
      var c = ht.clip, edge = ht.f < c.start + c.dur / 2 ? 'in' : 'out', trId;
      C.edit('Add ' + def.name, function (s2) {
        var tr = A.placeTransition(s2, P.clip(s2, c.id), edge, typ, Math.max(2, Math.round((def.kind === 'audio' ? C.prefs.audioTransDur : C.prefs.transDur) * s2.fps)));
        trId = tr.id;
      });
      C.state.selTransition = trId; C.state.selection = []; C.bus.emit('selection');
      return;
    }
    var f = Math.max(0, Math.round(TL.x2f(localX(e.clientX))));
    var insert = e.ctrlKey || e.metaKey;
    if (hasType(e, 'application/x-cutline-media')) {
      e.preventDefault();
      var dm = C.state.dragMedia || { ids: JSON.parse(e.dataTransfer.getData('application/x-cutline-media') || '[]'), video: true, audio: true };
      var start = TL.ghost && TL.ghost.length ? Math.min.apply(null, TL.ghost.map(function (g) { return g.start; })) : f;
      TL.ghost = null;
      placeList(dm.ids, start, e, insert, dm);
      C.state.dragMedia = null;
      return;
    }
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      e.preventDefault(); e.stopPropagation(); // the window-level drop handler would import the files a second time
      var files = Array.prototype.slice.call(e.dataTransfer.files);
      var fakeEv = { clientX: e.clientX, clientY: e.clientY };
      C.Media.importFiles(files).then(function (ms) { if (ms.length) placeList(ms.map(function (m) { return m.id; }), f, fakeEv, insert, { video: true, audio: true }); });
    }
  }
  function placeList(ids, start, ev, insert, dm) {
    var made = [], cur = seq(), wasEmpty = !cur.clips.length;
    ids = ids.filter(function (id) { var m = P.media(id); if (m && m.type === 'nest' && P.seqContains(m.seqId, cur.id)) { C.toast('A sequence cannot be nested inside itself'); return false; } return true; });
    C.edit(insert ? 'Insert Clips' : 'Add Clips', function (s2) {
      var pos = start;
      ids.forEach(function (id) {
        var m = P.media(id); if (!m) return;
        var saved = C.state.dragMedia; C.state.dragMedia = dm;
        var tg = dropTargets(ev, m);
        C.state.dragMedia = saved;
        if (!tg.vt && !tg.at) return;
        if (tg.vt && tg.vt.lock) tg.vt = null; if (tg.at && tg.at.lock) tg.at = null;
        var r = T.placeMedia(s2, m, pos, tg.vt && tg.vt.id, tg.at && tg.at.id, insert ? 'insert' : 'overwrite', dm.inSec, dm.outSec);
        made = made.concat(r);
        if (r.length) pos = r[0].start + r[0].dur;
      });
      if (!made.length) return false;
    });
    if (made.length) {
      A.select(made.map(function (c) { return c.id; })); var s = seq(); if (P.seqDuration(s) * TL.ppf < 60) TL.zoomFit();
      if (wasEmpty) A.offerMatch(made[0].mediaId);
    }
    TL.redraw();
  }
})();
