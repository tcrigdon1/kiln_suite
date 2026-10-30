/* Cutline — timeline quality-of-life and workspace additions: extend edit, gap navigation, bulk track actions,
   chapter export, clip notes, command palette, keyboard layouts, project templates, project merge, demo project,
   welcome tour. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, h = U.h, P = C.P, T = C.T, A = C.A, CMD = C.CMD;

  /* ---------- Extend edit (E): move the nearest edge of the selected clips to the playhead ---------- */
  A.extendEdit = function () {
    var s = P.seq(), f = C.Engine.frame; if (!s) return;
    var list = P.selectedClips();
    if (!list.length) list = s.clips.filter(function (c) { var t = P.track(s, c.trackId); return t && t.target && !t.lock; });
    list = list.filter(function (c) { return !P.isTrackLocked(s, c.trackId); });
    if (!list.length) { C.toast('Select a clip (or target a track) to extend an edit to the playhead'); return; }
    // one clip per track: the one whose edge is nearest the playhead
    var byTrack = {};
    list.forEach(function (c) { var d = Math.min(Math.abs(c.start - f), Math.abs(c.start + c.dur - f)); var cur = byTrack[c.trackId]; if (!cur || d < cur.d) byTrack[c.trackId] = { c: c, d: d }; });
    var n = 0;
    C.edit('Extend Edit', function (s2) {
      Object.keys(byTrack).forEach(function (tid) {
        var c = P.clip(s2, byTrack[tid].c.id); if (!c) return;
        var edge = Math.abs(c.start - f) <= Math.abs(c.start + c.dur - f) ? 'start' : 'end';
        if (f >= c.start && f < c.start + c.dur) edge = (f - c.start) < (c.start + c.dur - f) ? 'start' : 'end';
        var nb = T.neighbors(s2, c);
        if (edge === 'end') { if (nb.next) T.roll(s2, c, nb.next, f); else { if (nb.nextAny && f > nb.nextAny.start) return; T.setEnd(s2, c, f); } }
        else { if (nb.prev) T.roll(s2, nb.prev, c, f); else { if (nb.prevAny && f < nb.prevAny.start + nb.prevAny.dur) return; T.setStart(s2, c, f); } }
        n++;
      });
      if (!n) return false;
    });
    if (!n) C.toast('Nothing could be extended to the playhead');
  };

  /* ---------- Gap navigation ---------- */
  A.gaps = function (s, tids) {
    var out = [];
    (tids || s.tracks.map(function (t) { return t.id; })).forEach(function (tid) {
      var list = P.clipsOn(s, tid), pos = 0;
      list.forEach(function (c) { if (c.start > pos) out.push({ trackId: tid, s: pos, e: c.start }); pos = Math.max(pos, c.start + c.dur); });
    });
    return out.sort(function (a, b) { return a.s - b.s; });
  };
  A.gotoGap = function (dir) {
    var s = P.seq(), f = C.Engine.frame; if (!s) return;
    var tids = T.targetTracks(s); if (!tids.length) tids = null;
    var gaps = A.gaps(s, tids);
    var g = dir > 0 ? gaps.filter(function (x) { return x.s > f; })[0] : gaps.filter(function (x) { return x.s < f; }).pop();
    if (!g) { C.toast(dir > 0 ? 'No gap after the playhead' + (tids ? ' on targeted tracks' : '') : 'No gap before the playhead'); return; }
    C.state.selection = []; C.state.selGap = g; C.bus.emit('selection');
    C.Engine.seek(g.s);
    C.toast('Gap on ' + P.trackLabel(s, P.track(s, g.trackId)) + ': ' + U.fmtTC(g.e - g.s, s.fps, { short: true }) + ' (Delete closes it)');
  };

  /* ---------- Bulk track actions ---------- */
  A.allTracks = function (what) {
    var labels = { lock: 'Lock All Tracks', unlock: 'Unlock All Tracks', mute: 'Mute All Audio', unmute: 'Unmute All Audio', solo: 'Solo All Audio', unsolo: 'Clear Solo', target: 'Target All Tracks', untarget: 'Untarget All Tracks', show: 'Show All Video', hide: 'Hide All Video' };
    C.edit(labels[what] || 'Tracks', function (s) {
      s.tracks.forEach(function (t) {
        if (what === 'lock' || what === 'unlock') t.lock = what === 'lock';
        else if ((what === 'mute' || what === 'unmute') && t.kind === 'audio') t.mute = what === 'mute';
        else if ((what === 'solo' || what === 'unsolo') && t.kind === 'audio') t.solo = what === 'solo';
        else if (what === 'target' || what === 'untarget') t.target = what === 'target';
        else if ((what === 'show' || what === 'hide') && t.kind === 'video') t.hidden = what === 'hide';
      });
    });
    C.bus.emit('tracks');
  };

  /* ---------- Chapters (video-platform chapter list from sequence markers) ---------- */
  A.chaptersText = function (s) {
    s = s || P.seq(); if (!s) return '';
    var mk = s.markers.slice().sort(function (a, b) { return a.f - b.f; }).filter(function (m) { return m.name; });
    var lines = mk.map(function (m) { var sec = Math.floor(m.f / s.fps), mm = Math.floor(sec / 60), ss = sec % 60, hh = Math.floor(mm / 60); mm = mm % 60; return (hh ? hh + ':' + (mm < 10 ? '0' : '') : '') + mm + ':' + (ss < 10 ? '0' : '') + ss + ' ' + m.name; });
    if (lines.length && !/^0:00 /.test(lines[0])) lines.unshift('0:00 Intro');
    return lines.join('\n');
  };
  A.exportChapters = function () {
    var s = P.seq(); if (!s) return;
    var txt = A.chaptersText(s);
    if (!txt) { C.toast('Add named sequence markers first (M) — each becomes a chapter'); return; }
    var ta = h('textarea', { rows: Math.min(14, txt.split('\n').length + 1), style: { width: '420px', fontFamily: 'var(--mono)', fontSize: '12px' } }); ta.value = txt;
    ta.addEventListener('keydown', function (e) { e.stopPropagation(); });
    C.ui.dialog({ title: 'Chapters — ' + s.name, body: h('div', h('p.muted', { style: { marginTop: 0 } }, 'Paste this into the video description. Platforms need a 0:00 chapter and at least three chapters of 10 s or more.'), ta),
      buttons: [{ label: 'Download .txt', left: true, action: function () { U.download(new Blob([ta.value], { type: 'text/plain' }), (s.name || 'chapters') + '-chapters.txt'); return false; } }, { label: 'Close' },
        { label: 'Copy', primary: true, action: function () { ta.select(); (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(ta.value) : Promise.reject()).then(function () { C.toast('Chapters copied'); }, function () { try { document.execCommand('copy'); C.toast('Chapters copied'); } catch (e) { } }); } }] });
  };

  /* ---------- Clip notes ---------- */
  A.editNote = function (clipId) {
    var s = P.seq(), c = P.clip(s, clipId || (P.primaryClip() || {}).id); if (!c) { C.toast('Select a clip first'); return; }
    var ta = h('textarea', { rows: 5, style: { width: '380px' } }); ta.value = c.note || '';
    ta.addEventListener('keydown', function (e) { e.stopPropagation(); });
    C.ui.dialog({ title: 'Note — ' + c.name, body: ta, buttons: [{ label: 'Cancel' }, { label: 'Save', primary: true, action: function () { var v = ta.value.trim(); C.edit('Clip Note', function (s2) { var x = P.clip(s2, c.id); if (!x) return false; if (v) x.note = v; else delete x.note; }); } }] });
  };
  C.Inspector.extra.push(function (s, c) {
    var sec = C.ui.section('Note' + (c.note ? '' : ''), { key: 'note' }), ta = h('textarea', { rows: 3, placeholder: 'Notes about this clip (searchable with Find clip…)', style: { width: '100%', boxSizing: 'border-box', resize: 'vertical' } });
    ta.value = c.note || '';
    ta.addEventListener('keydown', function (e) { e.stopPropagation(); });
    ta.addEventListener('change', function () { var v = ta.value.trim(), id = c.id; C.edit('Clip Note', function (s2) { var x = P.clip(s2, id); if (!x) return false; if (v) x.note = v; else delete x.note; }); });
    sec.body.appendChild(h('div', { style: { padding: '6px 10px 8px' } }, ta));
    C.Inspector.scroll.appendChild(sec);
  });
  // Find clip… also matches notes
  if (C.TL && C.TL.matches) {
    var baseMatches = C.TL.matches;
    C.TL.matches = function (c) {
      var f = C.TL.filter;
      if (f && f.q && c.note && String(c.note).toLowerCase().indexOf(f.q) >= 0) return !(f.label === 'none' ? !!c.label : (f.label && c.label !== f.label));
      return baseMatches(c);
    };
  }

  /* ---------- Commands & menu items ---------- */
  CMD.reg('extendEdit', 'Extend Edit to Playhead', 'Sequence', 'E', function () { A.extendEdit(); });
  CMD.reg('nextGap', 'Go to Next Gap', 'Sequence', 'Ctrl+Shift+Down', function () { A.gotoGap(1); });
  CMD.reg('prevGap', 'Go to Previous Gap', 'Sequence', 'Ctrl+Shift+Up', function () { A.gotoGap(-1); });
  CMD.reg('lockAll', 'Lock All Tracks', 'Sequence', null, function () { A.allTracks('lock'); });
  CMD.reg('unlockAll', 'Unlock All Tracks', 'Sequence', null, function () { A.allTracks('unlock'); });
  CMD.reg('muteAll', 'Mute All Audio Tracks', 'Sequence', null, function () { A.allTracks('mute'); });
  CMD.reg('unmuteAll', 'Unmute All Audio Tracks', 'Sequence', null, function () { A.allTracks('unmute'); });
  CMD.reg('clearSolo', 'Clear All Solo', 'Sequence', null, function () { A.allTracks('unsolo'); });
  CMD.reg('chapters', 'Export Chapters (YouTube list)…', 'Markers', null, function () { A.exportChapters(); });
  CMD.reg('clipNote', 'Edit Clip Note…', 'Clip', 'Alt+N', function () { A.editNote(); });
  CMD.reg('palette', 'Command Palette…', 'Help', ['Ctrl+Shift+P', 'F3'], function () { C.ui.palette(); }, { needsProject: false });
  CMD.reg('tour', 'Welcome Tour', 'Help', null, function () { C.ui.tour(true); }, { needsProject: false });
  CMD.reg('demoProject', 'Open Demo Project', 'File', null, function () { C.IO.openDemo(); }, { needsProject: false });
  CMD.reg('saveTemplate', 'Save Project as Template…', 'File', null, function () { C.IO.saveTemplateDialog(); });
  CMD.reg('importProject', 'Import Project (merge)…', 'File', null, function () { C.IO.importProjectFlow(); });
  CMD.reg('keyLayout', 'Keyboard Layout…', 'Edit', null, function () { C.ui.keyLayoutDialog(); }, { needsProject: false });
  CMD.rebuild();
  function cmd(id) { return CMD.menuItem(id); }
  C.Menus.extra.Sequence = function () { return [cmd('extendEdit'), cmd('nextGap'), cmd('prevGap'), { label: 'Every Track', sub: [cmd('lockAll'), cmd('unlockAll'), '-', cmd('muteAll'), cmd('unmuteAll'), cmd('clearSolo'), '-', { label: 'Target All', action: function () { A.allTracks('target'); } }, { label: 'Untarget All', action: function () { A.allTracks('untarget'); } }] }]; };
  C.Menus.extra.Markers = function () { return [cmd('chapters')]; };
  C.Menus.extra.Clip = function () { return [cmd('clipNote')]; };
  C.Menus.extra.File = function () { return [cmd('importProject'), cmd('saveTemplate'), cmd('demoProject')]; };
  C.Menus.extra.Edit = function () { return [cmd('keyLayout')]; };
  C.Menus.extra.Help = function () { return [cmd('palette'), cmd('tour')]; };

  /* ---------- Command palette ---------- */
  function fuzzy(q, text) {
    text = text.toLowerCase(); q = q.toLowerCase();
    if (!q) return 1;
    var i = text.indexOf(q); if (i >= 0) return 100 - i * 0.5 + (i === 0 || /\W/.test(text[i - 1]) ? 20 : 0);
    var ti = 0, score = 0, last = -1;
    for (var k = 0; k < q.length; k++) { var ch = q[k]; if (ch === ' ') continue; var j = text.indexOf(ch, ti); if (j < 0) return 0; score += (j === last + 1 ? 3 : 1) - j * 0.01; last = j; ti = j + 1; }
    return score;
  }
  C.ui.paletteItems = function () {
    var items = [];
    CMD.list.forEach(function (c) { if (c.needsProject !== false && !C.state.project) return; items.push({ label: c.name, group: c.group, kbd: CMD.keyLabel(c.id), run: function () { CMD.run(c.id); } }); });
    var seen = {}; items.forEach(function (i) { seen[i.label] = 1; });
    function walk(list, path) {
      (typeof list === 'function' ? list() : list).forEach(function (it) {
        if (!it || it === '-' || it.header) return;
        if (it.sub) { walk(it.sub, path.concat(it.label)); return; }
        var dis = typeof it.disabled === 'function' ? it.disabled() : it.disabled;
        if (dis || seen[it.label]) return;
        seen[it.label] = 1;
        items.push({ label: it.label, group: path.join(' › '), kbd: it.kbd || '', run: it.action });
      });
    }
    C.Menus.defs().forEach(function (d) { walk(d.items, [d.title]); });
    if (C.state.project) {
      C.state.project.sequences.forEach(function (sq) { items.push({ label: 'Open sequence: ' + sq.name, group: 'Sequences', kbd: '', run: function () { A.switchSequence(sq.id); } }); });
      C.state.project.media.filter(function (m) { return m.type !== 'nest'; }).slice(0, 400).forEach(function (m) { items.push({ label: 'Source: ' + m.name, group: 'Library', kbd: '', run: function () { if (C.Source) C.Source.open(m.id); } }); });
    }
    return items;
  };
  C.ui.palette = function () {
    if (U.$('.cl-palette')) return;
    var items = C.ui.paletteItems(), sel = 0, shown = [];
    var inp = h('input.cl-palette-in', { type: 'text', placeholder: 'Type a command… (↑↓ to choose, Enter to run, Esc to close)' });
    var list = h('div.cl-palette-list'), box = h('div.cl-palette', inp, list), back = h('div.cl-palette-back', box);
    function render() {
      var q = inp.value.trim();
      shown = items.map(function (it) { return { it: it, s: fuzzy(q, it.label) + fuzzy(q, it.group) * 0.3 }; }).filter(function (x) { return !q || x.s > 0; }).sort(function (a, b) { return b.s - a.s; }).slice(0, 14).map(function (x) { return x.it; });
      if (sel >= shown.length) sel = 0;
      U.clear(list);
      shown.forEach(function (it, i) {
        var row = h('div.cl-palette-row' + (i === sel ? '.sel' : ''), h('span.grp', it.group), h('span.lbl', it.label), h('span.kbd', it.kbd || ''));
        row.addEventListener('pointerdown', function (e) { e.preventDefault(); sel = i; go(); });
        row.addEventListener('mouseenter', function () { sel = i; U.$$('.cl-palette-row', list).forEach(function (r, k) { r.classList.toggle('sel', k === i); }); });
        list.appendChild(row);
      });
      if (!shown.length) list.appendChild(h('div.cl-palette-row.muted', 'No matching command'));
    }
    var api = { el: back, close: function () { close(); } };
    function close() { back.remove(); document.removeEventListener('keydown', onKey, true); var i = C.ui.openDialogs.indexOf(api); if (i >= 0) C.ui.openDialogs.splice(i, 1); }
    function go() { var it = shown[sel]; close(); if (it) setTimeout(function () { try { it.run(); } catch (e) { C.toast('Error: ' + e.message); } }, 0); }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); sel = (sel + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % Math.max(1, shown.length); render(); return; }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); go(); return; }
      e.stopPropagation();
    }
    inp.addEventListener('input', function () { sel = 0; render(); });
    back.addEventListener('pointerdown', function (e) { if (e.target === back) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(back);
    C.ui.openDialogs.push(api);   // so Escape handling, tests and 'close everything' paths treat the palette like a dialog
    render();
    inp.focus();
  };

  /* ---------- Keyboard layouts (shortcut presets) ---------- */
  C.KEY_LAYOUTS = {
    default: { name: 'Default', keys: {} },
    // letters laid out around the left hand: cuts on the home row, trims on the brackets
    lefthand: { name: 'Left-hand editing', keys: { split: 'Ctrl+B', splitAll: 'Ctrl+Shift+B', rippleTrimPrev: '[', rippleTrimNext: ']', trimStartPH: 'Shift+[', trimEndPH: 'Shift+]', addMarker: 'Ctrl+Shift+M', nextMarker: "Shift+'", prevMarker: 'Shift+;', snap: 'G', extendEdit: 'Shift+E', selectAtPlayhead: 'Shift+D', zoomIn: 'Ctrl+=', zoomOut: 'Ctrl+-', zoomFit: 'Ctrl+0' } },
    // function keys for transport-heavy work (keeps letters free for tools)
    fkeys: { name: 'Function keys', keys: { markIn: 'F5', markOut: 'F6', goIn: 'Shift+F5', goOut: 'Shift+F6', addMarker: 'F8', split: 'F7', splitAll: 'Shift+F7', insert: 'F9', overwrite: 'F10', lift: 'F11', extract: 'F12', play: 'Space' } }
  };
  C.ui.applyKeyLayout = function (id) {
    var L = C.KEY_LAYOUTS[id]; if (!L) return;
    CMD.overrides = {};
    Object.keys(L.keys).forEach(function (cid) { if (!CMD.byId[cid]) return; var k = L.keys[cid]; var other = CMD.lookup(k); if (other && other !== cid && !L.keys[other]) CMD.overrides[other] = CMD.keys(other).filter(function (x) { return x !== k; }); CMD.overrides[cid] = [k]; });
    U.lsSet('keys', CMD.overrides); U.lsSet('keyLayout', id);
    CMD.rebuild();
  };
  C.ui.keyLayoutDialog = function () {
    var cur = U.lsGet('keyLayout', 'default'), sel = h('select', { style: { width: '100%' } });
    Object.keys(C.KEY_LAYOUTS).forEach(function (id) { sel.appendChild(h('option', { value: id }, C.KEY_LAYOUTS[id].name)); }); sel.value = cur;
    var prev = h('div', { style: { fontSize: '11px', lineHeight: 1.6, maxHeight: '240px', overflow: 'auto', marginTop: '8px' } });
    function render() { U.clear(prev); var L = C.KEY_LAYOUTS[sel.value]; var ks = Object.keys(L.keys); if (!ks.length) { prev.appendChild(h('div.muted', 'The built-in defaults (see Keyboard Shortcuts…).')); return; } ks.forEach(function (cid) { if (CMD.byId[cid]) prev.appendChild(h('div', h('span.kbd-chip', L.keys[cid]), ' ', CMD.byId[cid].name)); }); }
    sel.addEventListener('change', render); render();
    C.ui.dialog({ title: 'Keyboard Layout', width: 440, body: h('div', h('p.muted', { style: { marginTop: 0 } }, 'Switch the whole set of shortcuts. Individual keys can still be changed in Keyboard Shortcuts… afterwards.'), sel, prev),
      buttons: [{ label: 'Cancel' }, { label: 'Apply', primary: true, action: function () { C.ui.applyKeyLayout(sel.value); C.toast('Keyboard layout: ' + C.KEY_LAYOUTS[sel.value].name); } }] });
  };

  /* ---------- Project templates ---------- */
  var TPL_KEY = 'templates';
  C.IO.templates = function () { return U.lsGet(TPL_KEY, []); };
  C.IO.saveTemplateDialog = function () {
    var prj = C.state.project; if (!prj) return;
    var name = h('input', { type: 'text', value: prj.name + ' template', style: { width: '100%' } }); name.addEventListener('keydown', function (e) { e.stopPropagation(); });
    var keepGen = h('input', { type: 'checkbox', checked: true });
    C.ui.dialog({ title: 'Save as Template', width: 440, body: h('div', h('p.muted', { style: { marginTop: 0, lineHeight: 1.5 } }, 'A template stores the sequences (settings, tracks, generated items such as titles, bars and solids, markers and captions) without file-based media. New projects can start from it on the Welcome screen.'),
      h('div.form-grid', h('label', 'Name'), name, h('label', ''), h('label.cl-check', keepGen, h('span', 'Keep clips of generated items (titles, solids…)')))),
      buttons: [{ label: 'Cancel' }, { label: 'Save Template', primary: true, action: function () {
        var p = U.clone(prj); p.name = name.value.trim() || 'Template';
        p.media = p.media.filter(function (m) { return m.type === 'gen' || m.type === 'nest'; });
        var keep = {}; p.media.forEach(function (m) { keep[m.id] = 1; });
        p.sequences.forEach(function (s) { s.clips = keepGen.checked ? s.clips.filter(function (c) { return keep[c.mediaId]; }) : []; if (!keepGen.checked) s.transitions = []; s.playhead = 0; });
        delete p.id; delete p.created; delete p.modified;
        var list = C.IO.templates().filter(function (t) { return t.name !== p.name; });
        list.push({ name: p.name, saved: Date.now(), project: p });
        U.lsSet(TPL_KEY, list);
        C.toast('Template "' + p.name + '" saved');
      } }] });
  };
  C.IO.createFromTemplate = function (tpl, projectName) {
    var p = U.clone(tpl.project);
    p.app = 'Cutline'; p.format = 'kcut'; p.version = p.version || 1; p.id = U.uid('prj'); p.name = projectName || tpl.name; p.created = Date.now(); p.modified = Date.now();
    C.IO.load(JSON.stringify(p), null, 'New Project');
    C.state.dirty = false; C.bus.emit('saved');
    C.toast('Created ' + p.name + ' from template');
  };
  C.IO.deleteTemplate = function (name) { U.lsSet(TPL_KEY, C.IO.templates().filter(function (t) { return t.name !== name; })); };

  /* ---------- Import (merge) another project ---------- */
  C.IO.importProjectFlow = function () {
    if (!C.state.project) return;
    U.pickFiles('.kcut,.json,application/json', false).then(function (fs) { if (fs[0]) fs[0].text().then(function (t) { C.IO.mergeProject(t); }); });
  };
  C.IO.mergeProject = function (txt) {
    var data; try { data = JSON.parse(txt); } catch (e) { C.ui.alert('Cannot import', 'The file is not a valid Cutline project.'); return false; }
    if (!data || data.app !== 'Cutline' || !Array.isArray(data.sequences)) { C.ui.alert('Cannot import', 'This file is not a Cutline project (.kcut).'); return false; }
    var added = { media: 0, seqs: 0, folders: 0 };
    C.edit('Import Project ' + (data.name || ''), function (s, prj) {
      var json = JSON.stringify(data), idMap = {};
      // every id gets a fresh one (media, folders, sequences, tracks, clips, transitions, markers, captions) so nothing collides
      var ids = {}; json.replace(/"id":"([^"]+)"/g, function (_, id) { ids[id] = 1; return _; });
      json.replace(/"(mediaId|folder|seqId|trackId|activeSeq|parent|a|b|of)":"([^"]+)"/g, function (_, k, id) { ids[id] = 1; return _; });
      Object.keys(ids).forEach(function (id) { idMap[id] = U.uid(id.split('_')[0] || 'x'); });
      // reuse existing file-based media with the same file name + size instead of duplicating it
      var reuse = {};
      (data.media || []).forEach(function (m) { if (m.type === 'gen' || m.type === 'nest' || m.sub) return; var ex = prj.media.filter(function (x) { return x.type === m.type && (x.file || x.name) === (m.file || m.name) && x.size === m.size; })[0]; if (ex) reuse[m.id] = ex.id; });
      var out = JSON.parse(json.replace(/"([a-zA-Z]+)":"([^"]+)"/g, function (all, k, v) { if (reuse[v] && (k === 'mediaId' || k === 'of' || k === 'id')) return k === 'id' ? all : '"' + k + '":"' + reuse[v] + '"'; return idMap[v] ? '"' + k + '":"' + idMap[v] + '"' : all; }));
      (out.folders || []).forEach(function (f) { prj.folders.push(f); added.folders++; });
      (out.luts || []).forEach(function (l) { prj.luts = prj.luts || []; if (!prj.luts.some(function (x) { return x.id === l.id || (x.size === l.size && x.data === l.data); })) prj.luts.push(l); });
      (out.media || []).forEach(function (m) { if (reuse[m.id]) return; prj.media.push(m); added.media++; if (m.type === 'gen') { C.MRT[m.id] = { status: 'ready', film: [] }; C.Media.genThumb(m); } else if (m.type === 'nest') C.MRT[m.id] = { status: 'ready', film: [] }; });
      var names = {}; prj.sequences.forEach(function (q) { names[q.name] = 1; });
      out.sequences.forEach(function (q) { var base = q.name, n = 2; while (names[q.name]) q.name = base + ' (' + (n++) + ')'; names[q.name] = 1; q.playhead = 0; prj.sequences.push(q); added.seqs++; });
    });
    P.refreshNests();
    C.bus.emit('media'); C.bus.emit('sequence');
    C.toast('Imported ' + added.seqs + ' sequence' + (added.seqs === 1 ? '' : 's') + ', ' + added.media + ' media item' + (added.media === 1 ? '' : 's'), 4000);
    var off = C.Media.offlineMedia(); if (off.length) setTimeout(function () { C.IO.relinkDialog(); }, 300);
    return true;
  };

  /* ---------- Demo project (procedural: bars, tone, solids, gradients, titles, transitions, captions, markers) ---------- */
  C.IO.demoProject = function () {
    var prj = P.newProject({ projectName: 'Cutline Demo', w: 1280, h: 720, fps: 30 }), s = prj.sequences[0];
    s.name = 'Demo Edit';
    C.state.project = prj; // generated items register through the normal path
    var M = C.Media, fps = s.fps, v1 = P.vtracks(s)[0].id, v2 = P.vtracks(s)[1].id, v3 = P.vtracks(s)[2].id, a1 = P.atracks(s)[0].id;
    var bars = M.newGen('bars'), teal = M.newGen('solid'), amber = M.newGen('solid'), grad = M.newGen('gradient'), grad2 = M.newGen('gradient'), adj = M.newGen('adjust');
    teal.gen.color = '#1f6f68'; teal.name = 'Teal'; amber.gen.color = '#b4642a'; amber.name = 'Amber';
    grad.name = 'Dusk gradient'; grad2.gen.c1 = '#120f1e'; grad2.gen.c2 = '#5c3a7a'; grad2.gen.angle = 90; grad2.name = 'Violet gradient';
    var titleM = M.newGen('title'); titleM.name = 'Welcome title';
    titleM.gen.layers = [C.Titles.newTextLayer({ text: 'Welcome to Cutline', size: 92, weight: 700, y: 44 }), C.Titles.newTextLayer({ text: 'a browser-based video editor', size: 36, y: 60, color: '#f0c38a' })];
    var lower = M.newGen('title'); lower.name = 'Lower third';
    lower.gen.layers = [C.Titles.newShapeLayer('rect', { x: 22, y: 86, w: 36, h: 7, color: '#f0913a' }), C.Titles.newTextLayer({ text: 'Demo project', size: 34, weight: 700, x: 22, y: 89, align: 'left' })];
    function put(m, start, dur, tid, atid) { return T.placeMedia(s, m, start, tid, atid || null, 'overwrite', 0, dur / fps); }
    var c1 = put(bars, 0, 60, v1, a1)[0];
    var c2 = put(grad, 60, 120, v1)[0];
    var c3 = put(teal, 180, 90, v1)[0];
    var c4 = put(grad2, 270, 120, v1)[0];
    var c5 = put(amber, 390, 90, v1)[0];
    var ttl = put(titleM, 70, 100, v3)[0]; ttl.kf = { 'tf.op': [{ f: 0, v: 0, e: 'out' }, { f: 15, v: 100, e: 'linear' }, { f: 85, v: 100, e: 'in' }, { f: 99, v: 0, e: 'linear' }] };
    var lt = put(lower, 190, 150, v2)[0]; lt.kf = { 'tf.x': [{ f: 0, v: s.w / 2 - 300, e: 'out' }, { f: 12, v: s.w / 2, e: 'linear' }] };
    var ad = put(adj, 280, 100, v3)[0]; ad.fx.push(Object.assign(C.FX.newInstance('vignette'), {}));
    c3.fx.push(C.FX.newInstance('grain'));
    c4.kf = { 'tf.scale': [{ f: 0, v: 100, e: 'inout' }, { f: 119, v: 115, e: 'linear' }] };
    s.transitions.push({ id: U.uid('tr'), type: 'cross', a: c1.id, b: c2.id, dur: 20, align: 'center', params: {}, trackId: v1 });
    s.transitions.push({ id: U.uid('tr'), type: 'wipe', a: c2.id, b: c3.id, dur: 24, align: 'center', params: C.TR.defaults('wipe'), trackId: v1 });
    s.transitions.push({ id: U.uid('tr'), type: 'push', a: c3.id, b: c4.id, dur: 20, align: 'center', params: C.TR.defaults('push'), trackId: v1 });
    s.transitions.push({ id: U.uid('tr'), type: 'dipblack', a: c5.id, b: null, dur: 30, align: 'end', params: {}, trackId: v1 });
    var tone = s.clips.filter(function (c) { return c.kind === 'audio'; })[0]; if (tone) { tone.au.vol = -18; tone.fadeOut = 30; }
    s.captions = [{ id: U.uid('cap'), start: 75, end: 165, text: 'Captions are burnt in on export (or saved as SRT).' }, { id: U.uid('cap'), start: 200, end: 330, text: 'Drag effects from the Effects tab onto any clip.' }];
    s.markers = [{ id: U.uid('mk'), f: 0, name: 'Intro', color: A.MARKER_COLORS[0], note: '', dur: 0 }, { id: U.uid('mk'), f: 180, name: 'Chapter 2', color: A.MARKER_COLORS[1], note: 'Grain + lower third', dur: 0 }, { id: U.uid('mk'), f: 390, name: 'Outro', color: A.MARKER_COLORS[2], note: '', dur: 0 }];
    c2.note = 'Demo clips are generated — no media files needed.';
    T.validate(s);
    return prj;
  };
  C.IO.openDemo = function () {
    var go = function () {
      C.ui.openDialogs.slice().forEach(function (d) { d.close(); });
      var cur = C.state.project;
      var prj = C.IO.demoProject();
      C.state.project = cur; // load through the normal path (runtime reset, history, autosave)
      C.IO.load(JSON.stringify(prj), null, 'Demo Project');
      C.state.dirty = false; C.bus.emit('saved');
      if (C.TL) setTimeout(C.TL.zoomFit, 80);
      C.toast('Demo project loaded — everything here is generated, so it works without any media files', 4000);
    };
    if (C.state.project && C.state.dirty) C.ui.confirm('Discard unsaved changes to "' + C.state.project.name + '"?', 'Discard').then(function (ok) { if (ok) go(); }); else go();
  };

  /* ---------- Welcome tour (coach marks) ---------- */
  C.ui.tour = function (force) {
    if (!force && U.lsGet('tourDone', false)) return;
    if (U.$('.cl-tour')) return;
    var steps = [
      { sel: '#p-bin', title: 'Library', text: 'Import media here (drag files in, or Ctrl+I). Double-click an item to view it in the Source monitor; drag it to the timeline to use it.' },
      { sel: '#p-source', title: 'Source monitor', text: 'Mark In (I) and Out (O) on a clip, then press , to insert or . to overwrite at the playhead.' },
      { sel: '#p-program', title: 'Program monitor', text: 'Your edit plays here. Drag the frame to reposition clips, use the handles to scale and rotate, double-click text to edit it.' },
      { sel: '#p-timeline', title: 'Timeline', text: 'Space plays, J/K/L shuttle, Ctrl+K splits at the playhead. Tools on the left: Selection (V), Ripple (B), Rolling (N), Razor (C), Slip (Y), Slide (U).' },
      { sel: '#p-right', title: 'Inspector · Effects · Color · Audio', text: 'Properties and keyframes of the selected clip, the effects browser, grading with scopes and the audio mixer. Press Ctrl+Shift+P for the command palette any time.' }
    ];
    var i = 0, back = h('div.cl-tour'), hole = h('div.cl-tour-hole'), card = h('div.cl-tour-card');
    back.appendChild(hole); back.appendChild(card);
    function show() {
      var st = steps[i], el = U.$(st.sel), r = el ? el.getBoundingClientRect() : { left: 100, top: 100, width: 300, height: 200 };
      hole.style.left = (r.left - 4) + 'px'; hole.style.top = (r.top - 4) + 'px'; hole.style.width = (r.width + 8) + 'px'; hole.style.height = (r.height + 8) + 'px';
      U.clear(card);
      U.append(card, [h('div.t', st.title), h('div.b', st.text), h('div.row', { style: { marginTop: '10px', gap: '6px' } }, h('span.muted', (i + 1) + ' / ' + steps.length), h('span', { style: { flex: 1 } }),
        h('button.btn', { on: { click: done } }, 'Skip'), i > 0 ? h('button.btn', { on: { click: function () { i--; show(); } } }, 'Back') : null,
        h('button.btn.primary', { on: { click: function () { if (i < steps.length - 1) { i++; show(); } else done(); } } }, i < steps.length - 1 ? 'Next' : 'Done'))]);
      var cw = 340, left = Math.min(window.innerWidth - cw - 12, Math.max(12, r.left + r.width / 2 - cw / 2)), top = r.bottom + 12;
      if (top + 170 > window.innerHeight) top = Math.max(12, r.top - 180);
      card.style.left = left + 'px'; card.style.top = top + 'px'; card.style.width = cw + 'px';
    }
    function done() { back.remove(); U.lsSet('tourDone', true); document.removeEventListener('keydown', onKey, true); }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); done(); } else if (e.key === 'Enter' || e.key === 'ArrowRight') { e.stopPropagation(); if (i < steps.length - 1) { i++; show(); } else done(); } }
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(back);
    show();
  };
  // first project ever created in this browser: offer the tour once (not in automated/test sessions)
  var firstProject = true;
  C.bus.on('project', function () {
    if (!firstProject) return; firstProject = false;
    if (U.lsGet('tourDone', false) || /[?&]test=1/.test(location.search) || U.lsGet('tourSeen', false)) return;
    U.lsSet('tourSeen', true);
    setTimeout(function () { if (C.state.project && !C.ui.openDialogs.length) C.ui.tour(false); }, 900);
  });
})();
