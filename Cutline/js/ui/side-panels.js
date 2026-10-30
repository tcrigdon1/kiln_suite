/* Cutline — side panels: Markers list, Captions editor, History list. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, h = U.h, P = C.P, A = C.A;
  var SP = C.Side = {};

  /* ---------- Markers ---------- */
  // Markers list: sequence markers, clip markers and markers on source media (added while watching in the Source
  // monitor, or suggested by Find Highlights). Clicking a source marker opens that media in the Source monitor there.
  SP.markerFilter = U.lsGet('markers.filter', 'all');
  SP.markerSort = U.lsGet('markers.sort', 'time');
  SP.initMarkers = function (pane) {
    SP.mkList = h('div.list-pane');
    var filt = h('select', { title: 'Show' }), sort = h('select', { title: 'Sort' });
    [['all', 'All markers'], ['seq', 'This sequence'], ['source', 'Source media']].forEach(function (o) { filt.appendChild(h('option', { value: o[0] }, o[1])); });
    [['time', 'By time'], ['strength', 'By strength']].forEach(function (o) { sort.appendChild(h('option', { value: o[0] }, o[1])); });
    filt.addEventListener('change', function () { SP.markerFilter = filt.value; U.lsSet('markers.filter', filt.value); SP.renderMarkers(); });
    sort.addEventListener('change', function () { SP.markerSort = sort.value; U.lsSet('markers.sort', sort.value); SP.renderMarkers(); });
    SP.mkFilterSel = filt; SP.mkSortSel = sort;
    pane.appendChild(h('div.pane-toolbar', h('button.btn.sm', { title: 'Adds to the Source monitor clip when it has focus, otherwise to the sequence', on: { click: function () { if (C.state.focus !== 'source') C.state.focus = 'program'; A.addMarker(); } } }, '+ Marker'),
      filt, sort, h('span', { style: { flex: 1 } }), h('button.btn.sm', { on: { click: function () { SP.exportMarkers(); } } }, 'Export CSV')));
    pane.appendChild(SP.mkList);
    var r = U.debounce(SP.renderMarkers, 50);
    C.bus.on('changed', function (x) { if (x && x.live) return; r(); }); C.bus.on('selection', r); C.bus.on('sequence', r); C.bus.on('media', r);
  };
  SP.markerRows = function () {
    var s = P.seq(), all = [], f = SP.markerFilter;
    if (s && f !== 'source') {
      s.markers.forEach(function (m) { all.push({ m: m, f: m.f, t: m.f / s.fps, seq: true }); });
      s.clips.forEach(function (c) { (c.markers || []).forEach(function (m) { all.push({ m: m, f: c.start + m.f, t: (c.start + m.f) / s.fps, clip: c }); }); });
    }
    if (f !== 'seq' && C.state.project) C.state.project.media.forEach(function (md) {
      if (md.sub || !md.markers || !md.markers.length) return;
      md.markers.forEach(function (m) { all.push({ m: m, t: m.t, media: md, strength: m.strength }); });
    });
    if (SP.markerSort === 'strength') all.sort(function (a, b) { return (b.strength != null ? b.strength : -1e9) - (a.strength != null ? a.strength : -1e9) || a.t - b.t; });
    else all.sort(function (a, b) { if (!!a.media !== !!b.media) return a.media ? 1 : -1; if (a.media && b.media && a.media !== b.media) return a.media.name.localeCompare(b.media.name); return a.t - b.t; });
    return all;
  };
  SP.renderMarkers = function () {
    if (!SP.mkList) return;
    if (SP.mkFilterSel) { SP.mkFilterSel.value = SP.markerFilter; SP.mkSortSel.value = SP.markerSort; }
    U.clear(SP.mkList);
    var s = P.seq(); if (!s) return;
    var all = SP.markerRows();
    if (!all.length) { SP.mkList.appendChild(h('div.insp-empty', { html: C.icon('marker') }, SP.markerFilter === 'source' ? 'No markers on source media yet. Press M while watching a clip in the Source monitor, or run Find Highlights… on a long recording.' : 'No markers yet. Press M to add one at the playhead.')); return; }
    var lastMedia = null;
    all.forEach(function (x) {
      if (x.media && x.media !== lastMedia && SP.markerSort !== 'strength') { lastMedia = x.media; SP.mkList.appendChild(h('div.lgroup', x.media.name)); }
      var fps = x.media ? (x.media.fps || s.fps) : s.fps;
      var tc = x.media ? U.fmtTC(Math.round(x.t * fps), fps) : U.fmtTC(x.f, s.fps);
      var badge = x.m.auto ? h('span.mk-strength', { title: 'Suggested by Find Highlights (strength ' + x.m.strength + ')', style: { background: C.Source && C.Source.strengthColor ? C.Source.strengthColor(x.m.strength) : '#e2b93d' } }, String(Math.round(x.m.strength))) : null;
      var sel = x.seq ? C.state.selMarker === x.m.id : SP.selSrcMarker === x.m.id;
      var row = h('div.lrow' + (sel ? '.sel' : '') + (x.media ? '.src-mk' : ''), { 'data-mk': x.m.id }, h('span.dot', { style: { background: x.m.color } }), h('span.tcs', tc), badge,
        h('span.grow', (x.m.name || '(unnamed)') + (x.clip ? '  · ' + x.clip.name : '') + (x.media && SP.markerSort === 'strength' ? '  · ' + x.media.name : '') + (x.m.note && !x.m.auto ? ' — ' + x.m.note : '')));
      row.addEventListener('click', function () {
        if (x.media) { SP.selSrcMarker = x.m.id; C.Source.open(x.media.id, x.t); C.state.focus = 'source'; SP.renderMarkers(); return; }
        C.Engine.seek(x.f); if (x.seq) { C.state.selMarker = x.m.id; C.bus.emit('selection'); }
      });
      row.addEventListener('dblclick', function () { if (x.seq) A.editMarker(x.m.id); else if (x.media) SP.editSourceMarker(x.media.id, x.m.id); });
      row.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        var items = [{ label: 'Edit…', action: function () { if (x.seq) A.editMarker(x.m.id); else if (x.media) SP.editSourceMarker(x.media.id, x.m.id); }, disabled: !!x.clip }];
        if (x.media) items.push({ label: 'Make Subclip Around Marker…', action: function () { SP.subclipAround(x.media.id, x.m); } });
        items.push({ label: 'Delete', action: function () { SP.deleteMarker(x); } });
        if (x.media && x.m.auto) items.push({ label: 'Delete All Suggested Markers on ' + x.media.name, action: function () { C.edit('Delete Suggested Markers', function (s2, prj) { var md = prj.media.filter(function (q) { return q.id === x.media.id; })[0]; md.markers = (md.markers || []).filter(function (q) { return !q.auto; }); }); } });
        C.ui.menu(items, e.clientX, e.clientY);
      });
      SP.mkList.appendChild(row);
    });
  };
  SP.deleteMarker = function (x) {
    C.edit('Delete Marker', function (s2, prj) {
      if (x.seq) s2.markers = s2.markers.filter(function (m) { return m.id !== x.m.id; });
      else if (x.media) { var md = prj.media.filter(function (q) { return q.id === x.media.id; })[0]; md.markers = md.markers.filter(function (m) { return m.id !== x.m.id; }); }
      else { var c = P.clip(s2, x.clip.id); c.markers = c.markers.filter(function (m) { return m.id !== x.m.id; }); }
    });
  };
  SP.editSourceMarker = function (mediaId, id) {
    var md = P.media(mediaId), m = md && (md.markers || []).filter(function (q) { return q.id === id; })[0]; if (!m) return;
    var name = h('input', { type: 'text', value: m.name || '', style: { width: '280px' } }), note = h('textarea', { rows: 3, style: { width: '280px' } }); note.value = m.note || '';
    var fps = md.fps || 30;
    C.ui.dialog({ title: 'Marker at ' + U.fmtTC(Math.round(m.t * fps), fps) + ' — ' + md.name, width: 420, body: h('div.form-grid', h('label', 'Name'), name, h('label', 'Notes'), note),
      buttons: [{ label: 'Delete', danger: true, left: true, action: function () { SP.deleteMarker({ media: md, m: m }); } }, { label: 'Cancel' },
        { label: 'OK', primary: true, action: function () { C.edit('Edit Marker', function (s2, prj) { var q = prj.media.filter(function (x) { return x.id === mediaId; })[0]; var mm = q.markers.filter(function (x) { return x.id === id; })[0]; if (mm) { mm.name = name.value; mm.note = note.value; } }); } }] });
  };
  // Quick subclip of the moment around a marker (default 20 s before → 20 s after)
  SP.subclipAround = function (mediaId, mk) {
    var md = P.media(mediaId); if (!md) return;
    C.ui.prompt('Subclip around marker', '20', 'Seconds before and after the marker (e.g. 20 or 30,15)').then(function (v) {
      if (v == null) return;
      var parts = String(v).split(/[,\s]+/).map(parseFloat), pre = parts[0] || 20, post = parts.length > 1 && !isNaN(parts[1]) ? parts[1] : pre;
      C.Source.open(mediaId, mk.t);
      var a = Math.max(0, mk.t - pre), b = Math.min(md.duration, (mk.end || mk.t) + post);
      md.srcIn = a; md.srcOut = b;
      C.Source.makeSubclip((mk.name || 'Marker') + ' @ ' + U.fmtTC(Math.round(mk.t * (md.fps || 30)), md.fps || 30).slice(0, -3));
      C.Source.update();
    });
  };
  SP.exportMarkers = function () {
    var s = P.seq(); if (!s) return;
    var lines = ['Source,Timecode,Name,Color,Duration,Strength,Notes'];
    s.markers.forEach(function (m) { lines.push([JSON.stringify(s.name), U.fmtTC(m.f, s.fps), JSON.stringify(m.name || ''), m.color, U.fmtTC(m.dur || 0, s.fps), '', JSON.stringify(m.note || '')].join(',')); });
    (C.state.project.media || []).forEach(function (md) { (md.markers || []).forEach(function (m) { var fps = md.fps || 30; lines.push([JSON.stringify(md.name), U.fmtTC(Math.round(m.t * fps), fps), JSON.stringify(m.name || ''), m.color, '', m.strength != null ? m.strength : '', JSON.stringify(m.note || '')].join(',')); }); });
    U.download(new Blob([lines.join('\n')], { type: 'text/csv' }), (s.name || 'markers') + '-markers.csv');
  };

  /* ---------- Captions ---------- */
  SP.initCaptions = function (pane) {
    var st = h('button.btn.sm', { on: { click: SP.captionStyle } }, 'Style…');
    pane.appendChild(h('div.pane-toolbar',
      h('button.btn.sm', { on: { click: SP.addCaption } }, '+ Caption'),
      h('button.btn.sm', { on: { click: SP.importSRT } }, 'Import SRT'),
      h('button.btn.sm', { on: { click: function () { C.Export.srt(); } } }, 'Export SRT'), st));
    SP.capList = h('div.list-pane');
    pane.appendChild(SP.capList);
    var r = U.debounce(function (x) { if (x && x.live) return; SP.renderCaptions(); }, 60);
    C.bus.on('changed', r); C.bus.on('sequence', r);
    C.bus.on('caption:select', function (id) { SP.selCap = id; SP.renderCaptions(); var el = U.$('[data-cap="' + id + '"]', SP.capList); if (el) el.scrollIntoView({ block: 'nearest' }); });
    C.bus.on('playhead', U.throttle(function () {
      var s = P.seq(); if (!s || !SP.capList) return;
      var f = C.Engine.frame;
      U.$$('.cap-row', SP.capList).forEach(function (r2) { var c = s.captions.filter(function (x) { return x.id === r2.getAttribute('data-cap'); })[0]; r2.classList.toggle('active', !!c && f >= c.start && f < c.end); });
    }, 100));
  };
  SP.addCaption = function () {
    var s = P.seq(); if (!s) return;
    var f = C.Engine.frame, id = U.uid('cap');
    C.edit('Add Caption', function (s2) {
      var len = Math.round(2.5 * s2.fps), end = f + len;
      var next = s2.captions.filter(function (c) { return c.start > f; }).sort(function (a, b) { return a.start - b.start; })[0];
      if (next) end = Math.min(end, next.start);
      if (end <= f) end = f + 1;
      s2.captions.push({ id: id, start: f, end: end, text: 'New caption' });
      s2.captions.sort(function (a, b) { return a.start - b.start; });
    });
    SP.selCap = id; C.TL.showCaps = true; C.TL.layoutRows(); C.TL.renderHeads();
    setTimeout(function () { var ta = U.$('[data-cap="' + id + '"] textarea'); if (ta) { ta.focus(); ta.select(); } }, 80);
  };
  SP.renderCaptions = function () {
    if (!SP.capList) return;
    var s = P.seq(); U.clear(SP.capList); if (!s) return;
    if (!s.captions.length) { SP.capList.appendChild(h('div.insp-empty', { html: C.icon('caption') }, 'No captions. Add one at the playhead or import an SRT file.')); return; }
    s.captions.slice().sort(function (a, b) { return a.start - b.start; }).forEach(function (cp) {
      var st = h('input', { type: 'text', value: U.fmtTC(cp.start, s.fps) }), en = h('input', { type: 'text', value: U.fmtTC(cp.end, s.fps) });
      var ta = h('textarea'); ta.value = cp.text;
      [st, en, ta].forEach(function (i) { i.addEventListener('keydown', function (e) { e.stopPropagation(); }); });
      st.addEventListener('change', function () { var f = U.parseTC(st.value, s.fps); if (f != null) C.edit('Caption Start', function (s2) { var c = cap(s2, cp.id); c.start = Math.max(0, Math.min(f, c.end - 1)); }); });
      en.addEventListener('change', function () { var f = U.parseTC(en.value, s.fps); if (f != null) C.edit('Caption End', function (s2) { var c = cap(s2, cp.id); c.end = Math.max(c.start + 1, f); }); });
      ta.addEventListener('input', function () { var c = cap(P.seq(), cp.id); if (c) { c.text = ta.value; C.live(); } });
      ta.addEventListener('change', function () { C.commit('Edit Caption'); });
      ta.addEventListener('focus', function () { C.Engine.seek(cp.start); });
      var posSel = h('select.cap-pos', { title: 'Vertical position of this caption (overrides the style)' });
      C.Titles.CAP_POS.forEach(function (o) { posSel.appendChild(h('option', { value: o[0] }, o[1])); }); posSel.value = cp.pos != null && cp.pos !== '' ? String(cp.pos) : '';
      if (posSel.value !== (cp.pos != null && cp.pos !== '' ? String(cp.pos) : '')) { posSel.appendChild(h('option', { value: String(cp.pos) }, 'Custom')); posSel.value = String(cp.pos); }
      posSel.addEventListener('change', function () { C.edit('Caption Position', function (s2) { var c = cap(s2, cp.id); if (!c) return; if (posSel.value === '') delete c.pos; else c.pos = +posSel.value; }); });
      var row = h('div.cap-row' + (SP.selCap === cp.id ? '.active' : ''), { 'data-cap': cp.id },
        h('div.times', st, h('span.muted', '→'), en, posSel),
        h('div.row', C.ui.iconBtn('play', 'Go to caption', function () { C.Engine.seek(cp.start); }, { cls: 'sm' }), C.ui.iconBtn('trash', 'Delete caption', function () { C.edit('Delete Caption', function (s2) { s2.captions = s2.captions.filter(function (c) { return c.id !== cp.id; }); }); }, { cls: 'sm' })),
        ta);
      SP.capList.appendChild(row);
    });
  };
  function cap(s, id) { return s.captions.filter(function (c) { return c.id === id; })[0]; }
  SP.importSRT = function () {
    if (!C.state.project) return;
    U.pickFiles('.srt,.vtt,text/plain', false).then(function (files) {
      if (!files.length) return;
      files[0].text().then(function (txt) {
        var s = P.seq(), caps = C.Titles.parseSRT(txt, s.fps);
        if (!caps.length) { C.toast('No captions found in file'); return; }
        C.edit('Import Captions', function (s2) { s2.captions = s2.captions.concat(caps).sort(function (a, b) { return a.start - b.start; }); });
        C.TL.showCaps = true; C.TL.layoutRows(); C.TL.renderHeads();
        C.toast('Imported ' + caps.length + ' captions');
        C.ui.showLeftTab('captions');
      });
    });
  };
  SP.captionStyle = function () {
    var s = P.seq(); if (!s) return;
    var st = U.clone(s.capStyle);
    var body = h('div', { style: { width: '380px' } });
    function fld(label, el) { body.appendChild(h('div.field.cl-field.wide', h('label', label), el)); }
    var preset = h('select'); preset.appendChild(h('option', { value: '' }, 'Choose a preset…')); C.Titles.CAP_PRESETS.forEach(function (pr) { preset.appendChild(h('option', { value: pr.id }, pr.name)); });
    preset.addEventListener('change', function () {
      var pr = C.Titles.CAP_PRESETS.filter(function (x) { return x.id === preset.value; })[0]; if (!pr) return;
      font.value = pr.st.font; size.value = pr.st.size; weight.value = pr.st.weight; color.value = pr.st.color; bg.value = pr.st.bg; bgop.value = pr.st.bgOp; outline.value = pr.st.outline; pos.value = pr.st.pos;
    });
    fld('Preset', preset);
    var font = h('select'); C.Titles.FONTS.forEach(function (f) { font.appendChild(h('option', { value: f }, f)); }); font.value = st.font;
    fld('Font', font);
    var size = h('input', { type: 'number', value: st.size, min: 10, max: 200 }); fld('Size', size);
    var weight = h('select'); [[400, 'Regular'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra Bold']].forEach(function (o) { weight.appendChild(h('option', { value: o[0] }, o[1])); }); weight.value = st.weight; fld('Weight', weight);
    var color = h('input', { type: 'color', value: st.color }); fld('Text Color', color);
    var bg = h('input', { type: 'color', value: st.bg }); fld('Box Color', bg);
    var bgop = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: st.bgOp }); fld('Box Opacity', bgop);
    var outline = h('input', { type: 'number', value: st.outline, min: 0, max: 20 }); fld('Outline', outline);
    var pos = h('input', { type: 'range', min: 0.1, max: 0.97, step: 0.01, value: st.pos }); fld('Vertical Position', pos);
    C.ui.dialog({ title: 'Caption Style', body: body, buttons: [{ label: 'Cancel' }, { label: 'Apply', primary: true, action: function () {
      C.edit('Caption Style', function (s2) { s2.capStyle = { font: font.value, size: +size.value, weight: +weight.value, color: color.value, bg: bg.value, bgOp: +bgop.value, outline: +outline.value, pos: +pos.value }; });
    } }] });
  };

  /* ---------- History ---------- */
  SP.initHistory = function (pane) {
    SP.hList = h('div.list-pane');
    pane.appendChild(h('div.pane-toolbar', C.ui.iconBtn('undo', 'Undo (Ctrl+Z)', function () { C.H.doUndo(); }, { cls: 'sm', tipPos: 'bottom' }), C.ui.iconBtn('redo', 'Redo (Ctrl+Shift+Z)', function () { C.H.doRedo(); }, { cls: 'sm', tipPos: 'bottom' }),
      h('span.muted', { style: { fontSize: '11px', marginLeft: '6px' } }, 'Click a step to jump to it')));
    pane.appendChild(SP.hList);
    C.bus.on('history', U.debounce(SP.renderHistory, 40));
  };
  SP.renderHistory = function () {
    if (!SP.hList) return;
    U.clear(SP.hList);
    var H = C.H, n = H.undo.length;
    var rows = [{ label: H.baseLabel, idx: 0 }];
    H.undo.forEach(function (e, i) { rows.push({ label: e.label, idx: i + 1 }); });
    H.redo.slice().reverse().forEach(function (e, i) { rows.push({ label: e.label, idx: n + i + 1, future: true }); });
    rows.forEach(function (r) {
      var el = h('div.lrow' + (r.idx === n ? '.current' : '') + (r.future ? '.future' : ''), h('span', { html: C.icon(r.idx === 0 ? 'open' : 'history'), style: { display: 'inline-flex', width: '14px' } }), h('span.grow', r.label));
      el.querySelector('svg').setAttribute('style', 'width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:1.7');
      el.addEventListener('click', function () { H.jumpTo(r.idx); });
      SP.hList.appendChild(el);
    });
    var cur = SP.hList.querySelector('.current'); if (cur) cur.scrollIntoView({ block: 'nearest' });
  };
})();
