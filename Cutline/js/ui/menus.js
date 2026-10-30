/* Cutline — application menubar. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, h = U.h, A = C.A;
  var M = C.Menus = {};

  function cmd(id, label) { return C.CMD.menuItem(id, label); }
  function noProj() { return !C.state.project; }

  // other modules append items to a top-level menu: M.extra['Clip'] = [items...] (inserted before the menu's last group)
  M.extra = {};
  function withExtra(title, items) { var ex = M.extra[title]; if (typeof ex === 'function') ex = ex(); if (!ex || !ex.length) return items; return items.concat(['-'], ex); }
  M.defs = function () {
    return [
      { title: 'File', items: [cmd('newProject'), cmd('openProject'), '-', cmd('saveProject'), cmd('saveAs'), '-', cmd('import'), cmd('relink'),
        { label: 'Import Captions (SRT)…', action: function () { C.Side.importSRT(); }, disabled: noProj }, '-',
        cmd('export'), cmd('batchExport'), cmd('exportFrame'), cmd('exportWav'), cmd('exportSRT'), '-',
        cmd('projectManager'), cmd('versions'), { label: 'Project Settings…', action: function () { C.ui.sequenceDialog(C.P.seq()); }, disabled: noProj }] },
      { title: 'Edit', items: [
        { label: 'Undo', kbd: C.CMD.keyLabel('undo'), action: function () { C.H.doUndo(); }, disabled: function () { return !C.H.undo.length; } },
        { label: 'Redo', kbd: C.CMD.keyLabel('redo'), action: function () { C.H.doRedo(); }, disabled: function () { return !C.H.redo.length; } }, '-',
        cmd('cut'), cmd('copy'), cmd('paste'), cmd('pasteInsert'), cmd('duplicate'), '-', cmd('delete', 'Delete'), cmd('rippleDelete'), '-',
        cmd('selectAll'), cmd('deselect'), '-', cmd('prefs'), cmd('shortcuts')] },
      { title: 'Clip', items: [cmd('speed'), cmd('enable'), cmd('link'), cmd('nest'), '-', cmd('freeze'), cmd('normalize'), cmd('reframe'), '-',
        { label: 'Scale to Frame Size', action: function () { A.setFit(true); }, disabled: noProj }, { label: 'Native Size (100%)', action: function () { A.setFit(false); }, disabled: noProj },
        { label: 'Reset Transform', action: function () { A.resetTransform(); }, disabled: noProj }, '-',
        cmd('copyAttrs'), cmd('pasteAttrs'), cmd('replaceClip'), cmd('selectByMedia'), '-',
        cmd('nudgeL'), cmd('nudgeR'), cmd('trimStartPH'), cmd('trimEndPH'), cmd('matchFrame'), '-', cmd('makeSubclip'), cmd('findHighlights'), '-',
        { label: 'Label Color', sub: function () { return C.A.MARKER_COLORS.map(function (c, i) { return { label: ['Amber', 'Teal', 'Red', 'Green', 'Yellow', 'Sky', 'Rose', 'Sand'][i], action: function () { A.setLabel(c); } }; }).concat(['-', { label: 'Default', action: function () { A.setLabel(null); } }]); } }] },
      { title: 'Sequence', items: [cmd('split'), cmd('splitAll'), cmd('rippleTrimPrev'), cmd('rippleTrimNext'), '-', cmd('insert'), cmd('overwrite'), cmd('lift'), cmd('extract'), cmd('liftNew'), cmd('extractNew'), cmd('closeGaps'), '-', cmd('removeSilences'), cmd('sceneCuts'), '-',
        cmd('trVideo'), cmd('trAudio'), '-', cmd('autoDuck'), '-', cmd('addVTrack'), cmd('addATrack'), '-', cmd('snap'), cmd('linkedSel'), '-', cmd('zoomIn'), cmd('zoomOut'), cmd('zoomFit'), '-',
        cmd('newSeq'), cmd('newSeqFromSel'), cmd('multicam'), cmd('seqSettings')] },
      { title: 'Markers', items: [cmd('markIn'), cmd('markOut'), cmd('markClip'), cmd('goIn'), cmd('goOut'), cmd('clearMarks'), '-', cmd('addMarker'), cmd('nextMarker'), cmd('prevMarker'),
        { label: 'Clear All Markers', action: function () { C.edit('Clear Markers', function (s) { s.markers = []; }); }, disabled: noProj }] },
      { title: 'Effects', items: function () {
        var cats = {};
        C.FX.list.forEach(function (d) { (cats[d.cat] = cats[d.cat] || []).push(d); });
        var out = Object.keys(cats).map(function (cat) { return { label: cat, sub: cats[cat].map(function (d) { return { label: d.name, action: function () { A.applyEffect(d.id); } }; }) }; });
        out.push('-');
        out.push({ label: 'Video Transitions', sub: C.TR.forKind('video').map(function (d) { return { label: d.name, action: function () { A.addTransition('video', d.id); } }; }) });
        out.push({ label: 'Audio Transitions', sub: C.TR.forKind('audio').map(function (d) { return { label: d.name, action: function () { A.addTransition('audio', d.id); } }; }) });
        out.push('-');
        var tpls = C.Titles.templates();
        out.push({ label: 'New Title', sub: [{ label: 'Blank Title', kbd: C.CMD.keyLabel('newTitle'), action: function () { A.addTitleAtPlayhead(); } }].concat(C.Titles.PRESETS.map(function (p) { return { label: p.name, action: function () { A.addTitleAtPlayhead(null, null, p.id); } }; }))
          .concat(tpls.length ? ['-', { header: 'My Templates' }].concat(tpls.map(function (t) { return { label: t.name, action: function () { A.titleFromTemplate(t.id); } }; })) : []) });
        out.push({ label: 'New Item', sub: ['solid', 'gradient', 'adjust', 'bars', 'countdown', 'tcburn'].map(function (k) { return { label: C.Media.GEN_NAMES[k], action: function () { A.newGen(k); } }; }) });
        return out;
      } },
      { title: 'View', items: [
        { label: 'Playback Resolution', sub: [['auto', 'Auto'], [1, 'Full'], [0.5, '1/2'], [0.25, '1/4']].map(function (r) { return { label: r[1], checked: function () { return C.prefs.playbackRes == r[0]; }, action: function () { C.prefs.playbackRes = r[0]; C.savePrefs(); C.Engine.requestRender(); } }; }) },
        cmd('safe', 'Safe Margins'), cmd('grid', 'Grid Overlay'),
        { label: 'Show Captions', checked: function () { var s = C.P.seq(); return s && s.showCaptions !== false; }, action: function () { var s = C.P.seq(); if (s) { s.showCaptions = s.showCaptions === false; C.live(); C.commit('Toggle Captions'); } }, disabled: noProj }, '-',
        { label: 'Show Waveforms', checked: function () { return C.prefs.showWaveforms; }, action: function () { C.prefs.showWaveforms = !C.prefs.showWaveforms; C.savePrefs(); } },
        { label: 'Show Thumbnails', checked: function () { return C.prefs.showThumbs; }, action: function () { C.prefs.showThumbs = !C.prefs.showThumbs; C.savePrefs(); } },
        { label: 'Show Keyframes on Clips', checked: function () { return C.prefs.showKeyframes; }, action: function () { C.prefs.showKeyframes = !C.prefs.showKeyframes; C.savePrefs(); } },
        { label: 'Audio Scrubbing', checked: function () { return C.prefs.audioScrub; }, action: function () { C.prefs.audioScrub = !C.prefs.audioScrub; C.savePrefs(); } }, '-',
        cmd('loop', 'Loop Playback'), cmd('fullscreen')] },
      { title: 'Window', items: [
        { label: 'Editing Workspace', action: function () { M.workspace('edit'); } },
        { label: 'Color Workspace', action: function () { M.workspace('color'); } },
        { label: 'Audio Workspace', action: function () { M.workspace('audio'); } },
        { label: 'Titles Workspace', action: function () { M.workspace('titles'); } }, '-',
        { label: 'Source Monitor', checked: function () { return !C.ui.layout.hideSource; }, action: function () { C.ui.layout.hideSource = !C.ui.layout.hideSource; C.ui.saveLayout(); C.ui.applyLayout(); } },
        { label: 'Inspector', action: function () { C.ui.showTab('inspector'); } }, { label: 'Effects', action: function () { C.ui.showTab('effects'); } },
        { label: 'Color', action: function () { C.ui.showTab('color'); } }, { label: 'Audio Mixer', action: function () { C.ui.showTab('audio'); } }, '-',
        { label: 'Library', action: function () { C.ui.showLeftTab('library'); } }, { label: 'Markers', action: function () { C.ui.showLeftTab('markers'); } },
        { label: 'Captions', action: function () { C.ui.showLeftTab('captions'); } }, { label: 'History', action: function () { C.ui.showLeftTab('history'); } }, '-',
        { label: 'Reset Layout', action: function () { C.ui.resetLayout(); } }] },
      { title: 'Help', items: [cmd('shortcuts'), { label: 'Quick Start Guide', action: function () { C.ui.quickStart(); } }, cmd('gpuReport'), '-', { label: 'About Cutline', action: function () { C.ui.about(); } }] }
    ];
  };

  M.workspace = function (id) {
    var L = C.ui.layout;
    if (id === 'color') { C.ui.showTab('color'); L.rightW = Math.max(L.rightW, 380); }
    else if (id === 'audio') { C.ui.showTab('audio'); }
    else if (id === 'titles') { C.ui.showTab('inspector'); C.ui.showLeftTab('library'); }
    else { C.ui.showTab('inspector'); C.ui.showLeftTab('library'); }
    M.ws = id;
    C.ui.saveLayout(); C.ui.applyLayout();
    U.$$('.ws-btns .ws').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-ws') === id); });
  };

  M.build = function () {
    var bar = U.$('#menubar');
    U.clear(bar);
    bar.appendChild(h('div.brand', { html: C.brandMark + '<span>Cutline</span>' }));
    var openTitle = null;
    M.defs().forEach(function (d) {
      if (M.extra[d.title]) { var base = d.items; d.items = typeof base === 'function' ? function () { return withExtra(d.title, base()); } : withExtra(d.title, base); }
      var t = h('div.menu-title', d.title);
      function open() {
        var r = t.getBoundingClientRect();
        U.$$('.menu-title.open').forEach(function (x) { x.classList.remove('open'); });
        t.classList.add('open'); openTitle = t;
        C.ui.menu(typeof d.items === 'function' ? d.items() : d.items, r.left, r.bottom + 2);
        C.ui.onMenuClose = function () { t.classList.remove('open'); openTitle = null; };
      }
      t.addEventListener('pointerdown', function (e) { e.preventDefault(); if (openTitle === t) { C.ui.closeMenus(); } else open(); });
      t.addEventListener('mouseenter', function () { if (openTitle && openTitle !== t) open(); });
      bar.appendChild(t);
    });
    bar.appendChild(h('div.spacer'));
    M.projName = h('div.proj-name');
    bar.appendChild(M.projName);
    var ws = h('div.ws-btns');
    [['edit', 'Editing'], ['color', 'Color'], ['audio', 'Audio'], ['titles', 'Titles']].forEach(function (w) {
      var b = h('div.ws', { 'data-ws': w[0] }, w[1]);
      b.addEventListener('click', function () { M.workspace(w[0]); });
      ws.appendChild(b);
    });
    bar.appendChild(ws);
    M.updateTitle();
  };
  M.updateTitle = function () {
    if (!M.projName) return;
    var p = C.state.project;
    M.projName.innerHTML = p ? '<b>' + U.esc(p.name) + '</b>' + (C.state.dirty ? ' •' : '') : '';
    document.title = (p ? p.name + (C.state.dirty ? ' •' : '') + ' — ' : '') + 'Cutline — Kiln Suite';
  };
  C.bus.on('history', function () { M.updateTitle(); });
  C.bus.on('saved', function () { M.updateTitle(); });
  C.bus.on('keys', function () { if (U.$('#menubar') && U.$('#menubar').children.length) M.build(); });

  // Extra actions referenced by menus
  A.setFit = function (fit) {
    var c = C.P.selectedClips().filter(function (x) { return x.kind === 'video'; }); if (!c.length) return;
    C.edit(fit ? 'Scale to Frame' : 'Native Size', function (s) { c.forEach(function (x) { C.P.clip(s, x.id).fit = fit; }); });
  };
  A.resetTransform = function () {
    var c = C.P.selectedClips().filter(function (x) { return x.kind === 'video'; }); if (!c.length) return;
    C.edit('Reset Transform', function (s) { c.forEach(function (x) { var cc = C.P.clip(s, x.id); cc.tf = C.P.defaultTransform(s); Object.keys(cc.kf || {}).forEach(function (k) { if (k.indexOf('tf.') === 0) delete cc.kf[k]; }); }); });
  };
  A.setLabel = function (col) {
    var c = C.P.selectedClips(); if (!c.length) return;
    C.edit('Label Color', function (s) { c.forEach(function (x) { C.P.clip(s, x.id).label = col; }); });
  };
})();
