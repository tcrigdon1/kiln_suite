/* Cutline — project create/save/open (.kcut JSON), autosave & crash recovery, media relinking. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, h = U.h, P = C.P;
  var IO = C.IO = {};

  function resetRuntime() {
    if (C.Engine.playing) C.Engine.pause();
    for (var k in C.MRT) { if (C.MRT[k].url) try { URL.revokeObjectURL(C.MRT[k].url); } catch (e) { } }
    C.MRT = {};
    if (C.Engine.provider) C.Engine.provider.dropAll();
    C.state.selection = []; C.state.selTransition = null; C.state.selMarker = null; C.state.selGap = null;
    C.state.sourceMedia = null; C.state.playheads = {}; C.state.zooms = {};
    C.state.fileHandle = null;
    if (C.Source && C.Source.close) C.Source.close();
  }
  // keep the browser media cache limited to files used by the current project
  IO.pruneCache = function () {
    var p = C.state.project; if (!p || !C.Store) return;
    var keep = {}; p.media.forEach(function (m) { if (m.type !== 'gen' && m.type !== 'nest') { var k = C.Store.mediaKey(m); keep[k] = 1; keep['proxy|' + k] = 1; } });
    C.Store.mediaKeys().then(function (keys) { (keys || []).forEach(function (k) { if (!keep[k]) C.Store.delMedia(k); }); });
  };
  function afterLoad(label) {
    var p = C.state.project;
    setTimeout(IO.pruneCache, 3000);
    C.H.reset(label);
    C.state.dirty = false;
    var seq = P.seq();
    p.sequences.forEach(function (s) {
      if (s.playhead) { C.state.playheads[s.id] = s.playhead; }
      if (s.zoom) { C.state.zooms[s.id] = s.zoom; }
    });
    C.Engine.setFrame(seq ? (C.state.playheads[seq.id] || 0) : 0);
    // regenerate thumbnails for generated items
    p.media.forEach(function (m) { if (m.type === 'gen') { C.MRT[m.id] = { status: 'ready', film: [] }; C.Media.genThumb(m); } else if (m.type === 'nest') C.MRT[m.id] = { status: 'ready', film: [] }; });
    C.bus.emit('project');
    C.bus.emit('media');
    C.bus.emit('sequence');
    C.bus.emit('selection');
    C.bus.emit('changed', { load: true });
    C.bus.emit('saved');
  }

  IO.createProject = function (opts) {
    resetRuntime();
    C.state.project = P.newProject(opts);
    afterLoad('New Project');
    C.toast('Created ' + C.state.project.name);
    IO.autosaveNow();
  };
  IO.newProjectFlow = function () {
    var go = function () { C.ui.welcome(); };
    if (C.state.project && C.state.dirty) C.ui.confirm('Discard unsaved changes to "' + C.state.project.name + '"?', 'Discard').then(function (ok) { if (ok) go(); });
    else go();
  };

  IO.serialize = function () {
    var p = U.clone(C.state.project);
    p.modified = Date.now();
    p.sequences.forEach(function (s) {
      s.playhead = (C.state.playheads || {})[s.id] || 0;
      if (s.id === p.activeSeq) s.playhead = C.Engine.frame;
      s.zoom = (C.state.zooms || {})[s.id] || 0;
    });
    p.savedWith = 'Cutline ' + C.version;
    return JSON.stringify(p, null, 1);
  };

  IO.save = function (as) {
    var p = C.state.project; if (!p) return Promise.resolve(false);
    var json = IO.serialize();
    var fname = (p.name || 'project').replace(/[\\/:*?"<>|]+/g, '_') + '.kcut';
    var blob = new Blob([json], { type: 'application/json' });
    function done() { C.state.dirty = false; C.bus.emit('saved'); C.toast('Saved ' + fname); IO.autosaveNow(); return true; }
    if (window.showSaveFilePicker) {
      var getHandle = (!as && C.state.fileHandle) ? Promise.resolve(C.state.fileHandle) :
        window.showSaveFilePicker({ suggestedName: fname, types: [{ description: 'Cutline Project', accept: { 'application/json': ['.kcut'] } }] });
      return getHandle.then(function (fh) {
        C.state.fileHandle = fh;
        return fh.createWritable().then(function (w) { return w.write(blob).then(function () { return w.close(); }); });
      }).then(done).catch(function (e) {
        if (e && e.name === 'AbortError') return false;
        console.warn('[Cutline] FS access save failed, falling back to download', e);
        U.download(blob, fname); return done();
      });
    }
    U.download(blob, fname);
    return Promise.resolve(done());
  };

  IO.open = function () {
    var go = function () {
      if (window.showOpenFilePicker) {
        window.showOpenFilePicker({ types: [{ description: 'Cutline Project', accept: { 'application/json': ['.kcut', '.json'] } }] }).then(function (hs) {
          var fh = hs[0];
          return fh.getFile().then(function (f) { return f.text(); }).then(function (txt) { IO.load(txt, fh); });
        }).catch(function (e) {
          if (!(e && e.name === 'AbortError')) { console.warn(e); pickFallback(); }
          else if (!C.state.project) IO.getRecovery().then(function (rec) { C.ui.welcome({ recovery: rec }); });
        });
      } else pickFallback();
    };
    function pickFallback() {
      U.pickFiles('.kcut,.json,application/json', false).then(function (fs) {
        if (fs[0]) fs[0].text().then(function (t) { IO.load(t, null); });
      });
      // if the picker is dismissed without a project open, bring the welcome screen back
      if (!C.state.project) window.addEventListener('focus', function back() { window.removeEventListener('focus', back); setTimeout(function () { if (!C.state.project && !C.ui.openDialogs.length) C.ui.welcome({}); }, 600); });
    }
    if (C.state.project && C.state.dirty) C.ui.confirm('Discard unsaved changes to "' + C.state.project.name + '"?', 'Discard').then(function (ok) { if (ok) go(); });
    else go();
  };
  IO.load = function (txt, handle, label) {
    var data;
    function fail(msg) { C.ui.alert('Cannot open project', msg).then(function () { if (!C.state.project) C.ui.welcome({}); }); return false; }
    try { data = JSON.parse(txt); } catch (e) { return fail('The file is not a valid Cutline project (JSON parse error).'); }
    if (!data || data.app !== 'Cutline' || !Array.isArray(data.sequences)) return fail('This file is not a Cutline project (.kcut).');
    C.ui.openDialogs.slice().forEach(function (d) { d.close(); });
    resetRuntime();
    migrate(data);
    C.state.project = data;
    C.state.fileHandle = handle || null;
    afterLoad(label || 'Open Project');
    IO.autosaveNow();
    // reconnect media: browser cache first, then ask
    C.Media.tryCache().then(function (n) {
      var off = C.Media.offlineMedia();
      if (n) C.toast('Restored ' + n + ' media file(s) from the local cache');
      if (off.length) IO.relinkDialog();
    });
    return true;
  };
  function migrate(p) {
    p.folders = p.folders || []; p.media = p.media || [];
    p.sequences.forEach(function (s) {
      s.transitions = s.transitions || []; s.markers = s.markers || []; s.captions = s.captions || [];
      s.capStyle = s.capStyle || P.newSequence().capStyle;
      s.clips.forEach(function (c) { c.fx = c.fx || []; c.kf = c.kf || {}; c.markers = c.markers || []; if (c.kind === 'video' && !c.tf) c.tf = P.defaultTransform(s); if (c.kind === 'audio' && !c.au) c.au = { vol: 0, pan: 0, mute: false, gain: 0, pitch: true }; if (!c.tm) c.tm = { speed: Math.round((c.speed || 1) * 10000) / 100 }; });
    });
    if (!p.activeSeq || !p.sequences.some(function (s) { return s.id === p.activeSeq; })) p.activeSeq = p.sequences[0].id;
  }

  /* ---------- Autosave & recovery ---------- */
  var timer = null, lastAuto = null;
  IO.autosaveNow = function () {
    if (!C.state.project) return;
    try {
      // never snapshot a half-finished live edit (a drag in progress): recover the last committed state instead
      var liveProject = null;
      if (C.H && C.H.cur && C.H.snapshot() !== C.H.cur) { liveProject = C.state.project; C.state.project = JSON.parse(C.H.cur); C.state.project.activeSeq = liveProject.activeSeq; }
      var json;
      try { json = IO.serialize(); } finally { if (liveProject) C.state.project = liveProject; }
      if (json === lastAuto) return;
      lastAuto = json;
      var rec = { name: C.state.project.name, saved: Date.now(), json: json, clean: !C.state.dirty };
      try { localStorage.setItem('cutline.autosave', JSON.stringify(rec)); }
      catch (e) { C.Store.put('autosave', rec); }
      C.Store.put('autosave', rec);
      if (C.state.dirty && IO.pushVersion) IO.pushVersion(json);
    } catch (e) { console.warn('[Cutline] autosave failed', e); }
  };
  IO.startAutosave = function () {
    if (timer) clearInterval(timer);
    var s = +C.prefs.autosave;
    if (s > 0) timer = setInterval(function () { if (C.state.project && C.state.dirty) IO.autosaveNow(); }, s * 1000);
  };
  IO.getRecovery = function () {
    var rec = null;
    try { rec = JSON.parse(localStorage.getItem('cutline.autosave') || 'null'); } catch (e) { }
    if (rec && rec.json) return Promise.resolve(rec);
    return C.Store.get('autosave').then(function (r) { return r && r.json ? r : null; });
  };
  IO.recover = function (rec) { IO.load(rec.json, null, 'Recovered Session'); C.state.dirty = true; C.bus.emit('saved'); };
  IO.markClean = function () { try { var rec = JSON.parse(localStorage.getItem('cutline.autosave') || 'null'); if (rec) { rec.clean = true; localStorage.setItem('cutline.autosave', JSON.stringify(rec)); } } catch (e) { } };

  window.addEventListener('beforeunload', function (e) {
    if (C.state.project) IO.autosaveNow();
    if (C.state.project && C.state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------- Relink ---------- */
  IO.relinkDialog = function () {
    var list = h('div.relink-list');
    var d;
    function render() {
      U.clear(list);
      var all = C.state.project.media.filter(function (m) { return m.type !== 'gen' && m.type !== 'nest'; });
      if (!all.length) { list.appendChild(h('div.relink-row', 'No file-based media in this project.')); return; }
      all.forEach(function (m) {
        var on = C.Media.isOnline(m);
        var loc = h('button.btn.sm', 'Locate…');
        loc.addEventListener('click', function () {
          U.pickFiles(m.type === 'audio' ? 'audio/*' : m.type === 'image' ? 'image/*' : 'video/*', false).then(function (fs) {
            if (!fs[0]) return;
            C.Media.relink(m, fs[0]).then(function () { render(); C.toast('Relinked ' + m.name); }).catch(function (e) { C.toast('Relink failed: ' + e.message); });
          });
        });
        list.appendChild(h('div.relink-row', h('span', { html: C.icon(C.Bin.iconFor(m)), style: { width: '16px', display: 'inline-flex' } }), h('span', m.name + (m.file && m.file !== m.name ? ' → ' + m.file : '')), h('span.muted', U.fmtSize(m.size)), h('span.st.' + (on ? 'on' : 'off'), on ? 'ONLINE' : 'OFFLINE'), on ? null : loc));
      });
      U.$$('.relink-row svg', list).forEach(function (s) { s.setAttribute('style', 'width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:1.7'); });
    }
    render();
    var off = C.Media.offlineMedia().length;
    d = C.ui.dialog({ title: 'Relink Media', width: 600,
      body: h('div', h('p.muted', { style: { marginTop: 0, lineHeight: 1.5 } }, off ? off + ' media file(s) are offline. Browsers cannot reopen files by path, so select the files again — they are matched automatically by file name (and size).' : 'All media is online.'), list),
      buttons: [{ label: 'Close' }, { label: 'Select Files…', primary: true, action: function () {
        U.pickFiles('', true).then(function (files) {
          if (!files.length) return;
          C.Media.matchFiles(files).then(function (n) { C.toast(n ? 'Relinked ' + n + ' file(s)' : 'No matching file names found'); render(); });
        });
        return false;
      } }] });
    return d;
  };
})();
