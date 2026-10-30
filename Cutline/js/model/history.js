/* Cutline — undo/redo history via project JSON snapshots (the model holds no media data, so it is small). */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util;
  var H = C.H = { undo: [], redo: [], cur: null, max: 300, baseLabel: 'Open Project' };

  // The active sequence tab is view state, not an edit: keep it out of snapshots so switching tabs never
  // becomes an undo step and undo/revert never drags the user back to an older tab.
  H.snapshot = function (p) {
    p = p || C.state.project; if (!p) return null;
    var a = p.activeSeq; p.activeSeq = undefined;
    try { return JSON.stringify(p); } finally { p.activeSeq = a; }
  };
  H.reset = function (label) {
    H.undo = []; H.redo = [];
    H.cur = H.snapshot();
    H.baseLabel = label || 'New Project';
    C.bus.emit('history');
  };
  H.commit = function (label) {
    if (!C.state.project) return false;
    var s = H.snapshot();
    if (s === H.cur) return false;
    H.undo.push({ label: label || 'Edit', snap: H.cur, time: Date.now() });
    if (H.undo.length > H.max) H.undo.shift();
    H.cur = s; H.redo = [];
    C.state.dirty = true;
    C.bus.emit('history');
    return true;
  };
  function restore(snap) {
    var p = JSON.parse(snap);
    var prev = C.state.project, prevActive = prev && prev.activeSeq;
    p.activeSeq = prevActive;
    var sigBefore = prev ? prev.sequences.map(function (s) { return s.id + s.name; }).join('|') : '';
    C.state.project = p;
    // stay on the sequence being edited when it still exists; but when the step only touched another sequence
    // (e.g. undoing after switching tabs) follow it there so the change is visible instead of silent
    if (!(prevActive && p.sequences.some(function (s) { return s.id === prevActive; }))) p.activeSeq = p.sequences[0] && p.sequences[0].id;
    else {
      var curChanged = false, others = [];
      p.sequences.forEach(function (s) {
        var old = prev && prev.sequences.filter(function (x) { return x.id === s.id; })[0];
        var diff = !old || JSON.stringify(old) !== JSON.stringify(s);
        if (s.id === prevActive) curChanged = diff; else if (diff) others.push(s.id);
      });
      p.activeSeq = (!curChanged && others.length === 1) ? others[0] : prevActive;
    }
    var seq = C.P.seq();
    var seqChanged = !seq || seq.id !== prevActive || sigBefore !== p.sequences.map(function (s) { return s.id + s.name; }).join('|');
    if (seq && seq.id !== prevActive) { C.state.selection = []; C.Engine && C.Engine.setFrame((C.state.playheads || {})[seq.id] || 0, true); }
    C.state.selection = C.state.selection.filter(function (id) { return seq && C.P.clip(seq, id); });
    if (C.state.selTransition && !(seq && C.P.findTransition(seq, C.state.selTransition))) C.state.selTransition = null;
    C.state.dirty = true;
    if (seqChanged) C.bus.emit('sequence');
    C.bus.emit('changed', { restore: true });
    C.bus.emit('selection');
    C.bus.emit('history');
  }
  H.doUndo = function () {
    if (!H.undo.length) { C.toast && C.toast('Nothing to undo'); return; }
    var e = H.undo.pop();
    H.redo.push({ label: e.label, snap: H.cur, time: e.time });
    H.cur = e.snap; restore(e.snap);
    C.toast && C.toast('Undo: ' + e.label);
  };
  H.doRedo = function () {
    if (!H.redo.length) { C.toast && C.toast('Nothing to redo'); return; }
    var e = H.redo.pop();
    H.undo.push({ label: e.label, snap: H.cur, time: e.time });
    H.cur = e.snap; restore(e.snap);
    C.toast && C.toast('Redo: ' + e.label);
  };
  // Jump to a given state index (0 = base, n = after undo[n-1])
  H.jumpTo = function (idx) {
    var n = H.undo.length;
    if (idx < n) { while (H.undo.length > idx) H.doUndoSilent(); }
    else { var k = idx - n; while (k-- > 0 && H.redo.length) H.doRedoSilent(); }
  };
  H.doUndoSilent = function () { var t = C.toast; C.toast = null; H.doUndo(); C.toast = t; };
  H.doRedoSilent = function () { var t = C.toast; C.toast = null; H.doRedo(); C.toast = t; };

  // Apply an edit and record it.
  C.edit = function (label, fn) {
    if (!C.state.project) return;
    var r;
    try { r = fn(C.P.seq(), C.state.project); }
    catch (e) { console.error('[Cutline] edit failed:', label, e); C.toast && C.toast('Edit failed: ' + e.message); H.revertLive(); return; }
    if (r === false) { H.revertLive(); return; }
    var seq = C.P.seq();
    if (seq) C.T.validate(seq);
    H.commit(label);
    C.bus.emit('changed', { label: label });
    return r;
  };
  // Live (uncommitted) change: re-render; caller must C.commit() later.
  C.live = function () { C.bus.emit('changed', { live: true }); };
  C.commit = function (label) {
    var seq = C.P.seq(); if (seq) C.T.validate(seq);
    if (H.commit(label)) C.bus.emit('changed', { label: label });
  };
  // Revert any uncommitted mutations back to the last committed snapshot
  H.revertLive = function () {
    if (H.cur && H.snapshot() !== H.cur) { var a = C.state.project.activeSeq; C.state.project = JSON.parse(H.cur); C.state.project.activeSeq = a; C.bus.emit('changed', { restore: true }); }
  };
})();
