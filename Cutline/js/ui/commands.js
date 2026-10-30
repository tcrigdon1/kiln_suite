/* Cutline — command registry with customisable keyboard shortcuts. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, A = C.A, E = function () { return C.Engine; };
  var CMD = C.CMD = { list: [], byId: {}, overrides: U.lsGet('keys', {}) };

  function reg(id, name, group, keys, run, opts) {
    var c = Object.assign({ id: id, name: name, group: group, defKeys: keys ? [].concat(keys) : [], run: run }, opts || {});
    CMD.list.push(c); CMD.byId[id] = c;
  }
  CMD.reg = reg;
  // Menu item for a command: label, shortcut, enabled state and (for toggles registered with opts.checked) the check mark.
  CMD.menuItem = function (id, label) {
    var c = CMD.byId[id]; if (!c) return { label: label || id, disabled: true };
    var it = { label: label || c.name, kbd: CMD.keyLabel(id), action: function () { CMD.run(id); }, disabled: function () { return c.needsProject !== false && !C.state.project; } };
    if (c.checked) it.checked = function () { try { return !!c.checked(); } catch (e) { return false; } };
    return it;
  };
  CMD.keys = function (id) { var c = CMD.byId[id]; if (!c) return []; return CMD.overrides[id] ? [].concat(CMD.overrides[id]) : c.defKeys; };
  CMD.keyLabel = function (id) { var k = CMD.keys(id)[0]; return k ? k.replace(/Left$/, '←').replace(/Right$/, '→').replace(/Up$/, '↑').replace(/Down$/, '↓') : ''; };
  CMD.run = function (id) {
    var c = CMD.byId[id]; if (!c) return;
    if (c.needsProject !== false && !C.state.project) return;
    try { c.run(); } catch (e) { console.error('[Cutline] command failed', id, e); C.toast('Error: ' + e.message); }
  };
  CMD.setKeys = function (id, keys) { CMD.overrides[id] = keys; U.lsSet('keys', CMD.overrides); rebuild(); };
  CMD.resetKeys = function () { CMD.overrides = {}; U.lsSet('keys', {}); rebuild(); };

  var CODE_NAMES = { Comma: ',', Period: '.', Semicolon: ';', Quote: "'", Backslash: '\\', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backquote: '`', Slash: '/',
    NumpadAdd: '=', NumpadSubtract: '-', Space: 'Space', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Delete: 'Delete', Backspace: 'Backspace',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Enter: 'Enter', NumpadEnter: 'Enter', Escape: 'Escape', Tab: 'Tab', Insert: 'Insert' };
  CMD.eventKey = function (e) {
    var k = null, code = e.code || '';
    if (/^Key[A-Z]$/.test(code)) k = code.slice(3);
    else if (/^Digit\d$/.test(code)) k = code.slice(5);
    else if (/^Numpad\d$/.test(code)) k = code.slice(6);
    else if (/^F\d{1,2}$/.test(code)) k = code;
    else if (CODE_NAMES[code]) k = CODE_NAMES[code];
    else if (e.key && e.key.length === 1) k = e.key.toUpperCase();
    if (!k) return null;
    return (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + k;
  };
  var map = {};
  function rebuild() {
    map = {};
    CMD.list.forEach(function (c) { CMD.keys(c.id).forEach(function (k) { map[k] = c.id; }); });
    C.bus.emit('keys');
  }
  CMD.rebuild = rebuild;
  CMD.lookup = function (k) { return map[k]; };

  /* ---------- Definitions ---------- */
  // File
  reg('newProject', 'New Project…', 'File', 'Ctrl+Alt+N', function () { C.IO.newProjectFlow(); }, { needsProject: false });
  reg('openProject', 'Open Project…', 'File', 'Ctrl+O', function () { C.IO.open(); }, { needsProject: false });
  reg('saveProject', 'Save Project', 'File', 'Ctrl+S', function () { C.IO.save(false); });
  reg('saveAs', 'Save Project As…', 'File', 'Ctrl+Shift+S', function () { C.IO.save(true); });
  reg('import', 'Import Media…', 'File', 'Ctrl+I', function () { C.Bin.importDialog(); });
  reg('relink', 'Relink Media…', 'File', null, function () { C.IO.relinkDialog(); });
  reg('export', 'Export Media…', 'File', 'Ctrl+M', function () { C.Export.dialog(); });
  reg('exportFrame', 'Export Frame (PNG)', 'File', 'Ctrl+Shift+E', function () { C.Export.frame(); });
  reg('exportSRT', 'Export Captions (SRT)', 'File', null, function () { C.Export.srt(); });
  reg('exportWav', 'Export Audio (WAV)', 'File', null, function () { C.Export.dialog({ format: 'wav' }); });
  reg('batchExport', 'Batch Export Queue…', 'File', null, function () { C.Export.batchDialog(); });
  reg('versions', 'Restore Previous Version…', 'File', null, function () { C.IO.versionsDialog(); });
  reg('projectManager', 'Project Manager…', 'File', null, function () { C.IO.projectManager(); });
  // Edit
  reg('undo', 'Undo', 'Edit', 'Ctrl+Z', function () { C.H.doUndo(); });
  reg('redo', 'Redo', 'Edit', ['Ctrl+Shift+Z', 'Ctrl+Y'], function () { C.H.doRedo(); });
  reg('cut', 'Cut', 'Edit', 'Ctrl+X', function () { A.cut(); });
  reg('copy', 'Copy', 'Edit', 'Ctrl+C', function () { A.copy(); });
  reg('paste', 'Paste', 'Edit', 'Ctrl+V', function () { A.paste(false); });
  reg('pasteInsert', 'Paste Insert', 'Edit', 'Ctrl+Shift+V', function () { A.paste(true); });
  reg('duplicate', 'Duplicate', 'Edit', 'Ctrl+Shift+/', function () { A.duplicate(); });
  reg('delete', 'Delete (Lift)', 'Edit', ['Delete', 'Backspace'], function () { if (C.state.focus === 'bin' && C.Bin) C.Bin.deleteSelected(); else A.del(false); });
  reg('rippleDelete', 'Ripple Delete', 'Edit', ['Shift+Delete', 'Shift+Backspace'], function () { A.del(true); });
  reg('selectAll', 'Select All', 'Edit', 'Ctrl+A', function () { if (C.state.focus === 'bin' && C.Bin) C.Bin.selectAll(); else A.selectAll(); });
  reg('deselect', 'Deselect All', 'Edit', 'Ctrl+Shift+A', function () { A.deselect(); });
  reg('prefs', 'Preferences…', 'Edit', 'Ctrl+,', function () { C.ui.prefsDialog(); }, { needsProject: false });
  reg('shortcuts', 'Keyboard Shortcuts…', 'Help', ['F1', 'Shift+/'], function () { C.ui.shortcutsDialog(); }, { needsProject: false });
  reg('gpuReport', 'GPU & Hardware Codecs…', 'Help', [], function () { C.GPU.dialog(); }, { needsProject: false });
  // Clip
  reg('speed', 'Speed / Duration…', 'Clip', 'Ctrl+R', function () { A.speedDialog(); });
  reg('enable', 'Enable / Disable', 'Clip', 'Shift+E', function () { A.toggleEnable(); });
  reg('link', 'Link / Unlink', 'Clip', 'Ctrl+L', function () { A.toggleLink(); });
  reg('freeze', 'Insert Freeze Frame', 'Clip', 'Shift+F', function () { A.freezeFrame(); });
  reg('normalize', 'Normalize Audio', 'Clip', null, function () { A.normalize(); });
  reg('nudgeL', 'Nudge Clip Left', 'Clip', 'Alt+Left', function () { A.nudge(-1); });
  reg('nudgeR', 'Nudge Clip Right', 'Clip', 'Alt+Right', function () { A.nudge(1); });
  reg('nudgeL5', 'Nudge Clip Left 5 Frames', 'Clip', 'Alt+Shift+Left', function () { A.nudge(-5); });
  reg('nudgeR5', 'Nudge Clip Right 5 Frames', 'Clip', 'Alt+Shift+Right', function () { A.nudge(5); });
  reg('matchFrame', 'Match Frame', 'Clip', 'F', function () { A.matchFrame(); });
  reg('nest', 'Nest Selected Clips', 'Clip', 'Ctrl+G', function () { A.nest(); });
  reg('reframe', 'Auto-Reframe…', 'Clip', null, function () { A.reframeDialog(); });
  reg('replaceClip', 'Replace with Library Item', 'Clip', 'Alt+R', function () { A.replaceClip(); });
  reg('copyAttrs', 'Copy Attributes', 'Clip', 'Ctrl+Alt+C', function () { A.copyAttributes(); });
  reg('pasteAttrs', 'Paste Attributes…', 'Clip', 'Ctrl+Alt+V', function () { A.pasteAttributesDialog(); });
  reg('selectByMedia', 'Select All Clips Using This Media', 'Clip', null, function () { var c = C.P.primaryClip(); if (c) A.selectByMedia(c.mediaId); else C.toast('Select a clip first'); });
  reg('trimStartPH', 'Trim Start to Playhead', 'Clip', 'Alt+[', function () { A.trimToPlayhead('start'); });
  reg('trimEndPH', 'Trim End to Playhead', 'Clip', 'Alt+]', function () { A.trimToPlayhead('end'); });
  // Sequence
  reg('split', 'Split at Playhead', 'Sequence', 'Ctrl+K', function () { A.split(false); });
  reg('splitAll', 'Split All Tracks at Playhead', 'Sequence', 'Ctrl+Shift+K', function () { A.split(true); });
  reg('rippleTrimPrev', 'Ripple Trim Start to Playhead', 'Sequence', 'Q', function () { A.rippleTrimToPlayhead('start'); });
  reg('rippleTrimNext', 'Ripple Trim End to Playhead', 'Sequence', 'W', function () { A.rippleTrimToPlayhead('end'); });
  reg('lift', 'Lift (In→Out)', 'Sequence', ';', function () { A.liftExtract(false); });
  reg('extract', 'Extract (In→Out)', 'Sequence', "'", function () { A.liftExtract(true); });
  reg('liftNew', 'Lift to New Sequence', 'Sequence', null, function () { A.rangeToSequence(false); });
  reg('extractNew', 'Extract to New Sequence', 'Sequence', null, function () { A.rangeToSequence(true); });
  reg('insert', 'Insert from Source', 'Sequence', ',', function () { A.sourceEdit('insert'); });
  reg('overwrite', 'Overwrite from Source', 'Sequence', '.', function () { A.sourceEdit('overwrite'); });
  reg('closeGaps', 'Close Gaps', 'Sequence', null, function () { A.closeGaps(); });
  reg('autoDuck', 'Auto-Duck Music…', 'Sequence', null, function () { A.duckDialog(); });
  reg('trVideo', 'Apply Default Video Transition', 'Sequence', 'Ctrl+D', function () { A.addTransition('video'); });
  reg('trAudio', 'Apply Default Audio Transition', 'Sequence', 'Ctrl+Shift+D', function () { A.addTransition('audio'); });
  reg('selectAtPlayhead', 'Select Clip at Playhead', 'Sequence', 'D', function () { A.selectAtPlayhead(); });
  reg('addVTrack', 'Add Video Track', 'Sequence', null, function () { A.addTrack('video'); });
  reg('addATrack', 'Add Audio Track', 'Sequence', null, function () { A.addTrack('audio'); });
  // Chrome/Edge reserve Ctrl+N / Ctrl+T / Ctrl+W for their own windows/tabs, so defaults avoid them
  reg('newSeq', 'New Sequence…', 'Sequence', 'Ctrl+Alt+Shift+N', function () { A.newSequence(); });
  reg('newSeqFromSel', 'New Sequence from Selection', 'Sequence', null, function () { A.sequenceFromSelection(); });
  reg('multicam', 'New Multicam Sequence…', 'Sequence', null, function () { C.Multicam.dialog(); });
  reg('makeSubclip', 'Make Subclip (Source In/Out)', 'Clip', ['Ctrl+U', 'Alt+U'], function () { A.makeSubclip(); });
  reg('findHighlights', 'Find Highlights…', 'Clip', null, function () { A.findHighlightsDialog(); });
  reg('removeSilences', 'Remove Silences…', 'Sequence', null, function () { C.AutoCut.removeSilencesDialog(); });
  reg('sceneCuts', 'Detect Scene Cuts…', 'Sequence', null, function () { C.AutoCut.sceneCutsDialog(); });
  reg('seqSettings', 'Sequence Settings…', 'Sequence', null, function () { C.ui.sequenceDialog(C.P.seq()); });
  reg('snap', 'Toggle Snapping', 'Sequence', 'S', function () { A.toggleSnap(); }, { checked: function () { return !!C.state.snapping; } });
  reg('linkedSel', 'Toggle Linked Selection', 'Sequence', 'Ctrl+Shift+L', function () { A.toggleLinked(); }, { checked: function () { return !!C.state.linked; } });
  reg('zoomIn', 'Zoom In', 'Sequence', ['=', 'Shift+='], function () { A.zoom(1.5); });
  reg('zoomOut', 'Zoom Out', 'Sequence', '-', function () { A.zoom(1 / 1.5); });
  reg('zoomFit', 'Zoom to Fit', 'Sequence', '\\', function () { A.zoomFit(); });
  // Markers
  reg('markIn', 'Mark In', 'Markers', 'I', function () { A.markIn(); });
  reg('markOut', 'Mark Out', 'Markers', 'O', function () { A.markOut(); });
  reg('markClip', 'Mark Clip', 'Markers', 'X', function () { A.markClip(); });
  reg('clearMarks', 'Clear In and Out', 'Markers', ['Alt+X', 'Ctrl+Shift+X'], function () { A.clearMarks(); });
  reg('goIn', 'Go to In', 'Markers', 'Shift+I', function () { A.goIn(); });
  reg('goOut', 'Go to Out', 'Markers', 'Shift+O', function () { A.goOut(); });
  reg('addMarker', 'Add Marker', 'Markers', 'M', function () { A.addMarker(); });
  reg('nextMarker', 'Next Marker', 'Markers', 'Shift+M', function () { A.gotoMarker(1); });
  reg('prevMarker', 'Previous Marker', 'Markers', 'Ctrl+Shift+M', function () { A.gotoMarker(-1); });
  // 1–8: colour of the selected marker (or label of the selected clips); in a multicam sequence they switch angles
  for (var ki = 1; ki <= 8; ki++) (function (i) { reg('color' + i, 'Marker / Label Color ' + i + ' (multicam: angle ' + i + ')', 'Markers', String(i), function () { if (C.Multicam && C.Multicam.switchAngle(i)) return; if (!A.setMarkerColor(i - 1)) C.toast('Select a marker or clips first (' + i + ' sets the colour)'); }); })(ki);
  // Playback
  function focusSrc() { return C.state.focus === 'source' && C.Source && C.state.sourceMedia; }
  reg('play', 'Play / Pause', 'Playback', 'Space', function () { if (focusSrc()) C.Source.toggle(); else E().toggle(); });
  // holding K while tapping L / J steps one frame (standard JKL behaviour)
  reg('shuttleL', 'Shuttle Forward (L)', 'Playback', 'L', function () { if (kHeld) { if (focusSrc()) C.Source.step(1); else E().step(1); return; } if (focusSrc()) C.Source.shuttle('l'); else E().shuttle('l'); });
  reg('shuttleK', 'Stop (K)', 'Playback', 'K', function () { if (focusSrc()) C.Source.shuttle('k'); else E().shuttle('k'); });
  reg('shuttleJ', 'Shuttle Reverse (J)', 'Playback', 'J', function () { if (kHeld) { if (focusSrc()) C.Source.step(-1); else E().step(-1); return; } if (focusSrc()) C.Source.shuttle('j'); else E().shuttle('j'); });
  reg('stepB', 'Step Back 1 Frame', 'Playback', 'Left', function () { if (focusSrc()) C.Source.step(-1); else E().step(-1); });
  reg('stepF', 'Step Forward 1 Frame', 'Playback', 'Right', function () { if (focusSrc()) C.Source.step(1); else E().step(1); });
  reg('stepB5', 'Step Back 5 Frames', 'Playback', 'Shift+Left', function () { if (focusSrc()) C.Source.step(-5); else E().step(-5); });
  reg('stepF5', 'Step Forward 5 Frames', 'Playback', 'Shift+Right', function () { if (focusSrc()) C.Source.step(5); else E().step(5); });
  reg('home', 'Go to Start', 'Playback', 'Home', function () { if (focusSrc()) C.Source.seek(0); else E().seek(0); });
  reg('end', 'Go to End', 'Playback', 'End', function () { if (focusSrc()) C.Source.seek(1e9); else E().seek(C.P.seqDuration(C.P.seq())); });
  reg('prevEdit', 'Previous Edit Point', 'Playback', 'Up', function () { A.editPoint(-1); });
  reg('nextEdit', 'Next Edit Point', 'Playback', 'Down', function () { A.editPoint(1); });
  reg('loop', 'Toggle Loop Playback', 'Playback', 'Ctrl+Shift+L', function () { E().loop = !E().loop; C.toast('Loop ' + (E().loop ? 'on' : 'off')); C.bus.emit('state'); }, { checked: function () { return !!(C.Engine && C.Engine.loop); } });
  reg('fullscreen', 'Full-Screen Preview', 'View', 'Ctrl+Shift+F', function () { C.Program.fullscreen(); }, { checked: function () { return !!document.fullscreenElement; } });
  reg('safe', 'Toggle Safe Margins', 'View', null, function () { C.Program.toggle('safe'); }, { checked: function () { return !!C.Program.safe; } });
  reg('grid', 'Toggle Grid', 'View', null, function () { C.Program.toggle('grid'); }, { checked: function () { return !!C.Program.grid; } });
  // Tools
  A.TOOLS.forEach(function (t) { reg('tool_' + t.id, t.name + ' Tool', 'Tools', t.key, function () { A.setTool(t.id); }); });
  reg('newTitle', 'New Title', 'Titles', 'Ctrl+Alt+T', function () { A.addTitleAtPlayhead(); });

  // Loop conflicts with linked selection default: give loop a different key
  CMD.byId.loop.defKeys = ['Ctrl+Alt+L'];

  rebuild();

  /* ---------- Key dispatch ---------- */
  var kHeld = null;
  document.addEventListener('keyup', function (e) { if (kHeld && e.code === kHeld) kHeld = null; });
  window.addEventListener('blur', function () { kHeld = null; });
  document.addEventListener('keydown', function (e) {
    if (C.ui.openDialogs.length) return;
    if (U.isTyping(e)) return;
    if (C.ui.capturingKey) return;
    var k = CMD.eventKey(e); if (!k) return;
    var id = map[k];
    if (!id) return;
    var c = CMD.byId[id];
    if (c.needsProject !== false && !C.state.project) return;
    e.preventDefault(); e.stopPropagation();
    if (id === 'shuttleK') kHeld = e.code;
    if (e.repeat && ['stepB', 'stepF', 'stepB5', 'stepF5', 'nudgeL', 'nudgeR', 'zoomIn', 'zoomOut', 'prevEdit', 'nextEdit', 'undo', 'redo'].indexOf(id) < 0) return;
    CMD.run(id);
  });
})();
