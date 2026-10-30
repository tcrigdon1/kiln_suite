/* Cutline — dialogs: welcome / new project, sequence settings, preferences, keyboard shortcuts, about. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, h = U.h, P = C.P;
  var ui = C.ui;

  // Shared settings form (resolution / fps / bg). Returns {el, value()}
  function settingsForm(init) {
    init = init || {};
    var cur = { w: init.w || 1920, h: init.h || 1080, fps: init.fps || 30, bg: init.bg || '#000000', name: init.name || '' };
    var grid = h('div.preset-grid');
    var cw = h('input', { type: 'number', value: cur.w, min: 16, max: 8192, style: { width: '72px' } });
    var ch = h('input', { type: 'number', value: cur.h, min: 16, max: 8192, style: { width: '72px' } });
    function mark() { U.$$('.preset', grid).forEach(function (p) { p.classList.toggle('on', +p.getAttribute('data-w') === cur.w && +p.getAttribute('data-h') === cur.h); }); cw.value = cur.w; ch.value = cur.h; }
    C.RES_PRESETS.forEach(function (r) {
      var k = 30 / Math.max(r.w, r.h);
      var p = h('div.preset', { 'data-w': r.w, 'data-h': r.h }, h('div.shape', { style: { width: Math.round(r.w * k) + 'px', height: Math.round(r.h * k) + 'px' } }),
        h('div', h('div.pn', r.name.split(' (')[0]), h('div.pd', r.w + '×' + r.h)));
      p.addEventListener('click', function () { cur.w = r.w; cur.h = r.h; mark(); });
      grid.appendChild(p);
    });
    cw.addEventListener('input', function () { cur.w = Math.max(16, Math.round(+cw.value / 2) * 2 || 16); mark(); cw.value = +cw.value; });
    ch.addEventListener('input', function () { cur.h = Math.max(16, Math.round(+ch.value / 2) * 2 || 16); mark(); ch.value = +ch.value; });
    var fpsRow = h('div.chip-row');
    C.FPS_PRESETS.forEach(function (f) {
      var c = h('div.chip' + (f === cur.fps ? '.on' : ''), String(f));
      c.addEventListener('click', function () { cur.fps = f; U.$$('.chip', fpsRow).forEach(function (x) { x.classList.toggle('on', x === c); }); });
      fpsRow.appendChild(c);
    });
    var bg = h('input', { type: 'color', value: cur.bg });
    bg.addEventListener('input', function () { cur.bg = bg.value; });
    var name = h('input', { type: 'text', value: cur.name, placeholder: 'Untitled Project', style: { width: '100%' } });
    name.addEventListener('keydown', function (e) { e.stopPropagation(); });
    mark();
    var el = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
      init.showName !== false ? h('div', h('h3', init.nameLabel || 'Project name'), name) : null,
      h('div', h('h3', 'Frame size'), grid, h('div.row', { style: { marginTop: '8px' } }, h('span.muted', 'Custom:'), cw, h('span.muted', '×'), ch)),
      h('div', h('h3', 'Frame rate (fps)'), fpsRow),
      h('div.row', h('h3', { style: { margin: 0 } }, 'Background'), bg, h('span.muted', { style: { fontSize: '11px' } }, 'shown where no clip covers the frame')));
    return { el: el, value: function () { cur.name = name.value.trim(); cur.w = Math.round(cur.w / 2) * 2; cur.h = Math.round(cur.h / 2) * 2; return cur; } };
  }

  ui.welcome = function (opts) {
    opts = opts || {};
    var form = settingsForm({ name: '', w: 1920, h: 1080, fps: 30 });
    var recover = opts.recovery;
    var d;
    function btnI(icon, label, fn) { var b = h('button.btn', { html: C.icon(icon) + '<span>' + U.esc(label) + '</span>' }); b.addEventListener('click', fn); return b; }
    var side = h('div.side',
      h('div.logo', { html: C.brandMark.replace('class="mark"', '') }, h('div', h('div.t1', 'Cutline'), h('div.t2', 'Kiln Suite · Video'))),
      btnI('open', 'Open Project…', function () { d.close(); C.IO.open(); }),
      recover ? btnI('history', 'Recover Last Session', function () { d.close(); C.IO.recover(recover); }) : null,
      btnI('film', 'Open Demo Project', function () { d.close(); C.IO.openDemo(); }),
      btnI('keyboard', 'Keyboard Shortcuts', function () { ui.shortcutsDialog(); }),
      btnI('info', 'About', function () { ui.about(); }),
      h('div.recent', recover ? h('div', h('span.ws-dot'), 'Autosave found: ', h('b', recover.name || 'Untitled'), h('br'), new Date(recover.saved).toLocaleString()) : 'Projects are saved as .kcut files. Media stays on your disk and is relinked by file name when you reopen a project.'));
    // start from a saved project template (File › Save Project as Template…)
    var tpls = C.IO.templates ? C.IO.templates() : [], tplSel = null, tplRow = null;
    if (tpls.length) {
      tplSel = h('select', { style: { minWidth: '220px' } }); tplSel.appendChild(h('option', { value: '' }, 'Blank project (settings below)'));
      tpls.forEach(function (t) { tplSel.appendChild(h('option', { value: t.name }, t.name + '  (' + t.project.sequences.length + ' seq)')); });
      var del = h('button.btn.sm', 'Delete');
      del.addEventListener('click', function () { if (!tplSel.value) return; C.IO.deleteTemplate(tplSel.value); tplSel.querySelector('option[value="' + tplSel.value.replace(/"/g, '\\"') + '"]').remove(); tplSel.value = ''; });
      tplRow = h('div.row', { style: { gap: '8px', marginBottom: '4px' } }, h('span.muted', 'Template:'), tplSel, del);
    }
    var main = h('div.main', h('h3', { style: { fontSize: '16px' } }, 'New Project'), tplRow, form.el);
    d = ui.dialog({ title: 'Welcome to Cutline', width: 820, closable: !!C.state.project, body: h('div.welcome', side, main),
      buttons: [{ label: 'Create Project', primary: true, action: function () {
        var v = form.value();
        if (tplSel && tplSel.value) { var t = C.IO.templates().filter(function (x) { return x.name === tplSel.value; })[0]; if (t) { C.IO.createFromTemplate(t, v.name || t.name); return; } }
        C.IO.createProject({ projectName: v.name || 'Untitled Project', w: v.w, h: v.h, fps: v.fps, bg: v.bg });
      } }] });
    return d;
  };

  ui.sequenceDialog = function (seq, onCreate) {
    var isNew = !seq;
    var form = settingsForm({ name: seq ? seq.name : 'Sequence ' + ((C.state.project ? C.state.project.sequences.length : 0) + 1), w: seq ? seq.w : C.P.seq() ? C.P.seq().w : 1920, h: seq ? seq.h : C.P.seq() ? C.P.seq().h : 1080, fps: seq ? seq.fps : C.P.seq() ? C.P.seq().fps : 30, bg: seq ? seq.bg : '#000000', nameLabel: 'Sequence name' });
    ui.dialog({ title: isNew ? 'New Sequence' : 'Sequence Settings', width: 640, body: form.el,
      buttons: [{ label: 'Cancel' }, { label: isNew ? 'Create' : 'Apply', primary: true, action: function () {
        var v = form.value();
        if (isNew) { onCreate && onCreate(v); return; }
        var oldFps = seq.fps, id = seq.id;
        C.edit('Sequence Settings', function (s, prj) {
          var sq = prj.sequences.filter(function (x) { return x.id === id; })[0];
          var kx = v.w / sq.w, ky = v.h / sq.h;
          if (v.fps !== oldFps) {
            var r = v.fps / oldFps;
            sq.clips.forEach(function (c) { c.start = Math.round(c.start * r); c.dur = Math.max(1, Math.round(c.dur * r)); C.KF.scaleAll(c, r); if (c.fadeIn) c.fadeIn = Math.round(c.fadeIn * r); if (c.fadeOut) c.fadeOut = Math.round(c.fadeOut * r); });
            sq.transitions.forEach(function (t) { t.dur = Math.max(1, Math.round(t.dur * r)); });
            sq.markers.forEach(function (m) { m.f = Math.round(m.f * r); });
            sq.captions.forEach(function (c) { c.start = Math.round(c.start * r); c.end = Math.round(c.end * r); });
            if (sq.inF != null) sq.inF = Math.round(sq.inF * r); if (sq.outF != null) sq.outF = Math.round(sq.outF * r);
          }
          if (kx !== 1 || ky !== 1) sq.clips.forEach(function (c) { if (c.tf) { c.tf.x *= kx; c.tf.y *= ky; if (c.kf) { (c.kf['tf.x'] || []).forEach(function (k) { k.v *= kx; }); (c.kf['tf.y'] || []).forEach(function (k) { k.v *= ky; }); } } });
          sq.w = v.w; sq.h = v.h; sq.fps = v.fps; sq.bg = v.bg; if (v.name) sq.name = v.name;
          prj.settings = { w: v.w, h: v.h, fps: v.fps, bg: v.bg };
        });
        C.bus.emit('sequence');
      } }] });
  };

  ui.prefsDialog = function () {
    var p = Object.assign({}, C.prefs);
    var g = h('div.prefs-grid');
    function num(label, key, min, max, step, unit) {
      var i = h('input', { type: 'number', value: p[key], min: min, max: max, step: step || 1, style: { width: '90px' } });
      i.addEventListener('input', function () { p[key] = +i.value; });
      g.appendChild(h('label', label)); g.appendChild(h('div.row', i, unit ? h('span.muted', unit) : null));
    }
    function sel(label, key, opts) {
      var s = h('select'); opts.forEach(function (o) { s.appendChild(h('option', { value: o[0] }, o[1])); }); s.value = String(p[key]);
      s.addEventListener('change', function () { var v = s.value; p[key] = isNaN(+v) ? v : +v; });
      g.appendChild(h('label', label)); g.appendChild(s);
    }
    function chk(label, key) { var c = h('input', { type: 'checkbox', checked: !!p[key] }); c.addEventListener('change', function () { p[key] = c.checked; }); g.appendChild(h('label', label)); g.appendChild(h('div', c)); }
    num('Default still duration', 'stillDur', 0.1, 600, 0.1, 'seconds');
    num('Default video transition', 'transDur', 0.04, 10, 0.01, 'seconds');
    num('Default audio transition', 'audioTransDur', 0.04, 10, 0.01, 'seconds');
    num('Autosave interval', 'autosave', 0, 3600, 5, 'seconds (0 = off)');
    sel('Thumbnail quality', 'thumbQuality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]);
    sel('Default playback resolution', 'playbackRes', [['auto', 'Auto'], ['1', 'Full'], ['0.5', '1/2'], ['0.25', '1/4']]);
    chk('Snapping on by default', 'snapping');
    chk('Scale new media to frame size', 'scaleToFrame');
    chk('Linked selection by default', 'linkedSelection');
    chk('Audio scrubbing', 'audioScrub');
    chk('Drop-frame timecode for 29.97 / 59.94 (hh:mm:ss;ff)', 'tcDropFrame');
    num('Cache media for recovery up to', 'cacheMB', 0, 512, 10, 'MB per file (larger files are never copied into the browser; relink them instead)');
    sel('Video codecs', 'gpuCodec', [['prefer', 'GPU first (NVENC / Quick Sync / AMF), CPU fallback'], ['auto', 'Browser default'], ['software', 'CPU only']]);
    g.appendChild(h('label', '')); g.appendChild(h('div.muted', { style: { fontSize: '11px' } }, 'Applies to exports, proxies and frame-exact decoding. Help ▸ GPU & Hardware Codecs shows what this machine offers.'));
    var force2d = h('input', { type: 'checkbox', checked: !!U.lsGet('force2d', false) });
    g.appendChild(h('label', 'Use 2D renderer (no WebGL)')); g.appendChild(h('div.row', force2d, h('span.muted', { style: { fontSize: '11px' } }, 'takes effect after reload')));
    ui.dialog({ title: 'Preferences', body: g, buttons: [
      { label: 'Restore Defaults', left: true, action: function () { C.prefs = Object.assign({}, C.DEFAULT_PREFS); C.savePrefs(); C.toast('Preferences reset'); } },
      { label: 'Cancel' },
      { label: 'Save', primary: true, action: function () {
        var thumbsChanged = p.thumbQuality !== C.prefs.thumbQuality;
        Object.assign(C.prefs, p); C.savePrefs();
        U.lsSet('force2d', force2d.checked);
        C.state.snapping = C.prefs.snapping; C.bus.emit('state');
        if (thumbsChanged && C.state.project) C.Media.rebuildAllFilm();
        C.IO.startAutosave();
        C.Engine.requestRender();
      } }] });
  };

  ui.shortcutsDialog = function () {
    var q = '';
    var search = h('input', { type: 'text', placeholder: 'Filter commands…', style: { width: '100%', marginBottom: '8px' } });
    var table = h('table.kb-table');
    var wrap = h('div', { style: { width: '620px', maxHeight: '62vh', overflow: 'auto' } }, table);
    function render() {
      U.clear(table);
      var groups = {};
      C.CMD.list.forEach(function (c) { if (q && (c.name + ' ' + c.group).toLowerCase().indexOf(q) < 0) return; (groups[c.group] = groups[c.group] || []).push(c); });
      Object.keys(groups).forEach(function (g) {
        table.appendChild(h('tr.grp', h('td', { colspan: 2 }, g)));
        groups[g].forEach(function (c) {
          var keys = h('td.k');
          var ks = C.CMD.keys(c.id);
          ks.forEach(function (k, i) {
            var chip = h('span.kbd-chip', { title: 'Click to rebind' }, k);
            chip.addEventListener('click', function () { capture(c, chip, i); });
            keys.appendChild(chip);
          });
          var add = h('span.kbd-chip', { title: 'Add a shortcut', style: { opacity: ks.length ? 0.45 : 0.8 } }, ks.length ? '+' : 'Set…');
          add.addEventListener('click', function () { capture(c, add, ks.length); });
          keys.appendChild(add);
          table.appendChild(h('tr', keys, h('td', c.name)));
        });
      });
    }
    function capture(c, chip, idx) {
      chip.classList.add('capturing'); chip.textContent = 'Press keys… (Esc cancel, Backspace clear)';
      ui.capturingKey = true;
      function onKey(e) {
        e.preventDefault(); e.stopPropagation();
        if (['Control', 'Shift', 'Alt', 'Meta'].indexOf(e.key) >= 0) return;
        document.removeEventListener('keydown', onKey, true);
        ui.capturingKey = false;
        var keys = C.CMD.keys(c.id).slice();
        if (e.key === 'Escape') { render(); return; }
        if (e.key === 'Backspace' && !e.ctrlKey && !e.shiftKey) { keys.splice(idx, 1); C.CMD.setKeys(c.id, keys); render(); return; }
        var k = C.CMD.eventKey(e); if (!k) { render(); return; }
        var other = C.CMD.lookup(k);
        if (other && other !== c.id) { var ok = C.CMD.keys(other).filter(function (x) { return x !== k; }); C.CMD.setKeys(other, ok); C.toast('Removed ' + k + ' from "' + C.CMD.byId[other].name + '"'); }
        keys[idx] = k; C.CMD.setKeys(c.id, keys.filter(Boolean)); render();
      }
      document.addEventListener('keydown', onKey, true);
    }
    search.addEventListener('input', function () { q = search.value.trim().toLowerCase(); render(); });
    search.addEventListener('keydown', function (e) { e.stopPropagation(); });
    render();
    ui.dialog({ title: 'Keyboard Shortcuts', body: h('div', search, wrap), buttons: [{ label: 'Reset All to Defaults', left: true, action: function () { C.CMD.resetKeys(); render(); return false; } }, { label: 'Done', primary: true }], onClose: function () { ui.capturingKey = false; } });
  };

  ui.about = function () {
    ui.dialog({ title: 'About Cutline', body: h('div.about', { html: C.brandMark.replace('class="mark"', '') },
      h('h2', 'Cutline'), h('div.muted', 'Kiln Suite · version ' + C.version),
      h('p', 'A browser-based non-linear video editor: multitrack timeline, real-time GPU effects and transitions, color grading with scopes, titles, captions, audio mixing, and WebCodecs export.'),
      h('p.muted', { style: { fontSize: '11px' } }, 'Open-source friendly: plain HTML, CSS and JavaScript with no external dependencies. Runs entirely on your machine — your media never leaves your computer.'),
      h('p.muted', { style: { fontSize: '11px' } }, 'MIT License · © 2026 Thomas Rigdon · ', h('a', { href: C.repoURL, target: '_blank', rel: 'noopener' }, 'github.com/tcrigdon1/kiln_suite')),
      h('p.muted', { style: { fontSize: '11px' } }, 'Renderer: ' + (C.Engine.comp ? (C.Engine.comp.kind === 'webgl2' ? 'WebGL 2' : 'Canvas 2D (fallback)') : '—') + ' · WebCodecs: ' + (window.VideoEncoder ? 'available' : 'unavailable'))),
      buttons: [{ label: 'Close', primary: true }] });
  };

  ui.quickStart = function () {
    var steps = [
      ['Import', 'Drag files into the Library (or File › Import, Ctrl+I).'],
      ['Preview', 'Double-click a clip to open it in the Source monitor. Set In (I) and Out (O).'],
      ['Edit', 'Drag clips to the timeline, or press , (insert) / . (overwrite) at the playhead.'],
      ['Cut', 'Razor tool (C) or Ctrl+K splits at the playhead. Shift+Delete ripple-deletes.'],
      ['Trim', 'Drag clip edges. Ripple (B), Rolling (N), Slip (Y), Slide (U) and Rate Stretch (R) tools refine edits.'],
      ['Polish', 'Effects tab: drag effects/transitions onto clips. Color tab: grade with wheels, curves and scopes.'],
      ['Animate', 'Click the stopwatch next to any property in the Inspector to add keyframes.'],
      ['Titles', 'Text tool (T): click on the Program monitor. Ctrl+Alt+T adds a title at the playhead; presets are in Effects › New Title.'],
      ['Speed & stabilise', 'Inspector › Time: stopwatch on Speed for a ramp (frame blending optional). Clip › Steady Cam smooths shaky footage.'],
      ['Masks', 'Inspector › Masks: ellipse, rectangle or pen path per clip or per effect; Track ▶ follows the picture; paths can be smoothed and animated.'],
      ['Audio', 'Clip › Normalise Loudness (LUFS), Sequence › Auto-Duck, Markers › Beat / Transient Markers, master Limit in the Audio panel.'],
      ['Proxies', 'Right-click a video in the Library › Create Proxy for smooth playback of heavy files; export always uses the original.'],
      ['Export', 'File › Export Media (Ctrl+M): presets, WebM / MP4 via WebCodecs, GIF, PNG sequence, WAV audio, SRT captions; Sequence › Render In to Out caches a preview.']
    ];
    var t = h('table.kb-table');
    steps.forEach(function (s, i) { t.appendChild(h('tr', h('td.k', h('b', (i + 1) + '. ' + s[0])), h('td', s[1]))); });
    ui.dialog({ title: 'Quick Start', width: 640, body: t, buttons: [{ label: 'Got it', primary: true }] });
  };
})();
