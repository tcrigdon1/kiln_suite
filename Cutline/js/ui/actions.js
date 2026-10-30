/* Cutline — editing actions shared by menus, shortcuts and buttons. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, P = C.P, T = C.T, KF = C.KF;
  var A = C.A = {};

  function seq() { return P.seq(); }
  function ph() { return C.Engine.frame; }
  function sel() { return P.selectedClips(); }
  A.select = function (ids, add) {
    var s = seq(); if (!s) return;
    var out = add ? C.state.selection.slice() : [];
    ids.forEach(function (id) {
      var c = P.clip(s, id); if (!c) return;
      var group = C.state.linked ? P.linked(s, c) : [c];
      group.forEach(function (g) { if (out.indexOf(g.id) < 0) out.push(g.id); });
    });
    C.state.selection = out;
    C.state.selTransition = null;
    C.state.primaryId = ids.length === 1 ? ids[0] : null;
    C.bus.emit('selection');
  };
  A.toggleSelect = function (id) {
    var s = seq(), c = P.clip(s, id); if (!c) return;
    var group = C.state.linked ? P.linked(s, c) : [c];
    var has = C.state.selection.indexOf(id) >= 0;
    if (has) C.state.selection = C.state.selection.filter(function (x) { return !group.some(function (g) { return g.id === x; }); });
    else group.forEach(function (g) { if (C.state.selection.indexOf(g.id) < 0) C.state.selection.push(g.id); });
    C.state.selTransition = null;
    C.bus.emit('selection');
  };
  A.deselect = function () { C.state.selection = []; C.state.selTransition = null; C.state.selMarker = null; C.bus.emit('selection'); };
  A.selectAll = function () { var s = seq(); if (!s) return; C.state.selection = s.clips.map(function (c) { return c.id; }); C.bus.emit('selection'); };
  A.selectAtPlayhead = function () {
    var s = seq(), f = ph();
    var ids = s.clips.filter(function (c) { var t = P.track(s, c.trackId); return t && t.target && f >= c.start && f < c.start + c.dur; }).map(function (c) { return c.id; });
    A.select(ids);
  };

  /* ---------- Clipboard ---------- */
  A.copy = function () { var s = seq(), c = sel(); if (!c.length) return; C.state.clipboard = T.copy(s, c); C.toast('Copied ' + c.length + ' clip(s)'); };
  A.cut = function () {
    var c = sel(); if (!c.length) return;
    A.copy();
    C.edit('Cut', function (s) { T.removeClips(s, c.map(function (x) { return x.id; })); });
    A.deselect();
  };
  A.paste = function (insert) {
    if (!C.state.clipboard) { C.toast('Clipboard is empty'); return; }
    var made;
    C.edit(insert ? 'Paste Insert' : 'Paste', function (s) { made = T.paste(s, C.state.clipboard, ph(), insert); });
    if (made) { A.select(made.map(function (c) { return c.id; })); var end = Math.max.apply(null, made.map(function (c) { return c.start + c.dur; })); C.Engine.seek(end); }
  };
  A.duplicate = function () {
    var s = seq(), c = sel(); if (!c.length) return;
    var cb = T.copy(s, c), end = Math.max.apply(null, c.map(function (x) { return x.start + x.dur; })), made;
    C.edit('Duplicate', function (s2) { made = T.paste(s2, cb, end, false); });
    if (made) A.select(made.map(function (x) { return x.id; }));
  };
  A.del = function (ripple) {
    var s = seq();
    if (C.state.selTransition) {
      var id = C.state.selTransition;
      C.edit('Delete Transition', function (s2) { s2.transitions = s2.transitions.filter(function (t) { return t.id !== id; }); });
      C.state.selTransition = null; C.bus.emit('selection'); return;
    }
    if (C.state.selMarker) {
      var mk = C.state.selMarker;
      C.edit('Delete Marker', function (s2) { s2.markers = s2.markers.filter(function (m) { return m.id !== mk; }); });
      C.state.selMarker = null; C.bus.emit('selection'); return;
    }
    if (C.state.selGap) {
      var g = C.state.selGap;
      var skipped = [];
      C.edit('Ripple Delete Gap', function (s2) { skipped = T.closeGap(s2, g.trackId, g.s, g.e, true) || []; });
      if (skipped.length) C.toast(skipped.map(function (tid) { return P.trackLabel(s, P.track(s, tid)); }).join(', ') + ' not rippled: material inside the gap');
      C.state.selGap = null; C.bus.emit('selection'); return;
    }
    var c = sel().filter(function (x) { return !P.isTrackLocked(s, x.trackId); });
    if (!c.length) return;
    C.edit(ripple ? 'Ripple Delete' : 'Delete', function (s2) {
      var ids = c.map(function (x) { return x.id; });
      if (ripple) T.rippleDelete(s2, ids); else T.removeClips(s2, ids);
    });
    A.deselect();
  };

  /* ---------- Split / trim ---------- */
  A.split = function (allTracks) {
    var s = seq(), f = ph();
    var targets;
    var selected = sel();
    if (!allTracks && selected.length) targets = selected.filter(function (c) { return f > c.start && f < c.start + c.dur; });
    // a selection that does not span the playhead (e.g. the left half left selected after a previous split) falls back to the targeted tracks
    if (!targets || !targets.length) targets = s.clips.filter(function (c) {
      var t = P.track(s, c.trackId);
      return t && !t.lock && (allTracks || t.target) && f > c.start && f < c.start + c.dur;
    });
    // include linked partners
    var ids = {}; targets.forEach(function (c) { (C.state.linked ? P.linked(s, c) : [c]).forEach(function (x) { if (f > x.start && f < x.start + x.dur && !P.isTrackLocked(s, x.trackId)) ids[x.id] = x; }); });
    var list = Object.keys(ids).map(function (k) { return ids[k]; });
    if (!list.length) { C.toast('Nothing to split at playhead'); return; }
    C.edit('Split', function (s2) { T.splitClips(s2, list.map(function (x) { return P.clip(s2, x.id); }), f); });
  };
  A.splitAt = function (clip, f, ignoreLink) {
    var s = seq();
    var list = (ignoreLink || !C.state.linked) ? [clip] : P.linked(s, clip);
    list = list.filter(function (x) { return f > x.start && f < x.start + x.dur && !P.isTrackLocked(s, x.trackId); });
    if (!list.length) return;
    C.edit('Razor', function (s2) { T.splitClips(s2, list.map(function (x) { return P.clip(s2, x.id); }), f); });
  };
  // Q / W : ripple trim the clip under the playhead to the playhead
  A.rippleTrimToPlayhead = function (edge) {
    var s = seq(), f = ph();
    var c = s.clips.filter(function (x) { var t = P.track(s, x.trackId); return t && t.target && !t.lock && f > x.start && f < x.start + x.dur; })[0];
    if (!c) { C.toast('No clip under playhead on targeted tracks'); return; }
    C.edit(edge === 'start' ? 'Ripple Trim Start' : 'Ripple Trim End', function (s2) {
      var cc = P.clip(s2, c.id);
      if (edge === 'start') { T.rippleTrim(s2, cc, 'start', f); }
      else T.rippleTrim(s2, cc, 'end', f);
    });
    if (edge === 'start') C.Engine.seek(c.start);
  };
  A.nudge = function (n) {
    var s = seq(), c = sel(); if (!c.length) return;
    C.edit('Nudge', function (s2) {
      var moves = c.map(function (x) { var cc = P.clip(s2, x.id); return { clip: cc, start: Math.max(0, cc.start + n), trackId: cc.trackId }; });
      T.applyMoves(s2, moves, 'overwrite');
    });
  };
  A.closeGaps = function () {
    var s = seq();
    var tids = sel().length ? Object.keys(sel().reduce(function (o, c) { o[c.trackId] = 1; return o; }, {})) : T.targetTracks(s);
    C.edit('Close Gaps', function (s2) { T.closeGaps(s2, tids); });
  };

  /* ---------- Link / enable / speed ---------- */
  A.toggleLink = function () {
    var c = sel(); if (!c.length) return;
    var anyLinked = c.some(function (x) { return x.link; });
    C.edit(anyLinked ? 'Unlink' : 'Link', function (s2) {
      var lk = anyLinked ? null : U.uid('lk');
      c.forEach(function (x) { P.clip(s2, x.id).link = lk; });
    });
  };
  A.toggleEnable = function () {
    var c = sel(); if (!c.length) return;
    C.edit('Enable/Disable', function (s2) { c.forEach(function (x) { var cc = P.clip(s2, x.id); cc.enabled = cc.enabled === false; }); });
  };
  A.speedDialog = function () {
    var c = sel(); if (!c.length) { C.toast('Select a clip first'); return; }
    var s = seq(), first = c[0];
    var h = U.h;
    var sp = h('input', { type: 'number', value: Math.round(first.speed * 10000) / 100, step: 1, min: 5, max: 2000, style: { width: '90px' } });
    var dur = h('input', { type: 'text', value: U.fmtTC(first.dur, s.fps), style: { width: '110px' } });
    var rev = h('input', { type: 'checkbox', checked: first.reverse });
    var pitch = h('input', { type: 'checkbox', checked: !first.au || first.au.pitch !== false });
    var ripple = h('input', { type: 'checkbox', checked: false });
    var link = true;
    sp.addEventListener('input', function () { var v = parseFloat(sp.value); if (v > 0 && link) dur.value = U.fmtTC(Math.round(first.dur * first.speed / (v / 100)), s.fps); });
    dur.addEventListener('change', function () { var f = U.parseTC(dur.value, s.fps); if (f > 0 && link) sp.value = Math.round(first.dur * first.speed / f * 10000) / 100; });
    C.ui.dialog({
      title: 'Clip Speed / Duration', width: 380,
      body: h('div.form-grid',
        h('label', 'Speed'), h('div.row', sp, h('span.muted', '%')),
        h('label', 'Duration'), dur,
        h('label', ''), h('label.cl-check', rev, h('span', 'Reverse speed')),
        h('label', ''), h('label.cl-check', pitch, h('span', 'Maintain audio pitch')),
        h('label', ''), h('label.cl-check', ripple, h('span', 'Ripple edit, shifting trailing clips'))),
      buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, action: function () {
        var v = parseFloat(sp.value) / 100;
        if (!(v > 0)) return false;
        C.edit('Speed/Duration', function (s2) {
          c.forEach(function (x) {
            var cc = P.clip(s2, x.id), oldEnd = cc.start + cc.dur;
            T.setSpeed(s2, cc, v, false);
            cc.reverse = rev.checked;
            if (cc.au) cc.au.pitch = pitch.checked;
            var d = cc.start + cc.dur - oldEnd;
            if (ripple.checked && d) s2.clips.forEach(function (o) { if (o.trackId === cc.trackId && o !== cc && o.start >= oldEnd) o.start += d; });
            else if (d > 0) T.clearRange(s2, cc.trackId, oldEnd, oldEnd + d, (function () { var e = {}; e[cc.id] = 1; return e; })());
          });
        });
      } }]
    });
  };
  A.freezeFrame = function () {
    var s = seq(), f = ph();
    var c = sel().filter(function (x) { return x.kind === 'video'; })[0] || s.clips.filter(function (x) { var t = P.track(s, x.trackId); return x.kind === 'video' && t && t.target && f >= x.start && f < x.start + x.dur; })[0];
    if (!c) { C.toast('Select a video clip or place the playhead over one'); return; }
    var m = P.media(c.mediaId);
    if (!m || m.type !== 'video') { C.toast('Freeze frame needs a video clip'); return; }
    var at = U.clamp(f, c.start, c.start + c.dur - 1);
    var len = Math.round(C.prefs.stillDur * s.fps);
    C.edit('Insert Freeze Frame', function (s2) {
      var cc = P.clip(s2, c.id);
      var srcT = P.sourceSec(s2, cc, at);
      // open a gap on every unlocked track (keeps A/V sync), then drop the still into it
      T.rippleInsert(s2, T.unlockedTracks(s2), at, len);
      var fr = U.clone(cc); fr.id = U.uid('c'); fr.start = at; fr.dur = len; fr.freeze = srcT; fr.link = null; fr.speed = 1; fr.reverse = false;
      fr.name = (m.name || 'Clip') + ' (freeze)'; fr.kf = {}; fr.markers = []; fr.trackId = cc.trackId;
      s2.clips.push(fr);
      T.sortClips(s2);
    });
  };
  A.normalize = function () {
    var s = seq(), c = sel().filter(function (x) { return x.kind === 'audio'; });
    if (!c.length) { C.toast('Select audio clips to normalize'); return; }
    C.edit('Normalize Audio', function (s2) {
      c.forEach(function (x) {
        var cc = P.clip(s2, x.id), pk = C.Mixer.clipPeak(s2, cc);
        if (pk > 0) cc.au.gain = Math.round((-1 - U.gainToDb(pk)) * 10) / 10;
      });
    });
    C.toast('Normalized ' + c.length + ' clip(s) to −1 dBFS peak');
  };

  /* ---------- Marks & source edits ---------- */
  A.markIn = function () { if (C.state.focus === 'source' && C.Source) return C.Source.markIn(); C.edit('Mark In', function (s) { s.inF = ph(); if (s.outF != null && s.outF <= s.inF) s.outF = null; }); };
  A.markOut = function () { if (C.state.focus === 'source' && C.Source) return C.Source.markOut(); C.edit('Mark Out', function (s) { s.outF = ph() + 1; if (s.inF != null && s.inF >= s.outF) s.inF = null; }); };
  A.clearMarks = function () { if (C.state.focus === 'source' && C.Source) return C.Source.clearMarks(); C.edit('Clear In/Out', function (s) { s.inF = null; s.outF = null; }); };
  A.goIn = function () { if (C.state.focus === 'source' && C.Source) return C.Source.goIn(); var s = seq(); if (s.inF != null) C.Engine.seek(s.inF); };
  A.goOut = function () { if (C.state.focus === 'source' && C.Source) return C.Source.goOut(); var s = seq(); if (s.outF != null) C.Engine.seek(s.outF - 1); };
  A.markClip = function () {
    var s = seq(), f = ph();
    var c = sel()[0] || s.clips.filter(function (x) { var t = P.track(s, x.trackId); return t && t.target && f >= x.start && f < x.start + x.dur; })[0];
    if (!c) return;
    C.edit('Mark Clip', function (s2) { s2.inF = c.start; s2.outF = c.start + c.dur; });
  };
  A.liftExtract = function (extract) {
    var s = seq();
    if (s.inF == null || s.outF == null) { C.toast('Set sequence In and Out points first (I / O)'); return; }
    var tids = T.targetTracks(s);
    var inF = s.inF;
    // one undo step: extract also clears the Out point (the marked range no longer exists)
    C.edit(extract ? 'Extract' : 'Lift', function (s2) { if (extract) { T.extract(s2, s2.inF, s2.outF, tids); s2.outF = null; } else T.lift(s2, s2.inF, s2.outF, tids); });
    if (extract) C.Engine.seek(inF);
  };
  A.sourceEdit = function (mode) {
    if (!C.Source || !C.state.sourceMedia) { C.toast('Open a clip in the Source monitor first (double-click in the Library)'); return; }
    var m = P.media(C.state.sourceMedia); if (!m) return;
    var mk = C.Source.marks();
    var s = seq(), at = s.inF != null && C.state.useSeqIn ? s.inF : ph(), made, wasEmpty = !s.clips.length;
    C.edit(mode === 'insert' ? 'Insert' : 'Overwrite', function (s2) {
      made = T.sourceEdit(s2, { media: m, inSec: mk.inSec, outSec: mk.outSec, at: at, mode: mode, video: C.Source.useVideo, audio: C.Source.useAudio });
      if (!made) return false;
    });
    if (made && made.length) { A.select(made.map(function (c) { return c.id; })); C.Engine.seek(made[0].start + made[0].dur); if (wasEmpty) A.offerMatch(m.id); }
    else C.toast('No targeted (unlocked) tracks for this media');
  };
  A.matchFrame = function () {
    var s = seq(), f = ph();
    var c = sel()[0] || s.clips.filter(function (x) { var t = P.track(s, x.trackId); return x.kind === 'video' && t && !t.hidden && f >= x.start && f < x.start + x.dur; }).sort(function (a, b) { return s.tracks.indexOf(P.track(s, b.trackId)) - s.tracks.indexOf(P.track(s, a.trackId)); })[0];
    if (!c || !C.Source) return;
    C.Source.open(c.mediaId, P.sourceSec(s, c, U.clamp(f, c.start, c.start + c.dur - 1)));
  };

  /* ---------- Markers ---------- */
  A.MARKER_COLORS = ['#f0913a', '#3dbfae', '#e5534b', '#67c26f', '#e2b93d', '#5aa9e6', '#e07fb5', '#c8bdb1'];
  A.addMarker = function () {
    if (C.state.focus === 'source' && C.Source && C.state.sourceMedia) return C.Source.addMarker();
    var s = seq(), f = ph();
    var c = sel().length === 1 ? sel()[0] : null;
    if (c && f >= c.start && f < c.start + c.dur && C.state.focus !== 'program') {
      C.edit('Add Clip Marker', function (s2) { var cc = P.clip(s2, c.id); cc.markers = cc.markers || []; cc.markers.push({ id: U.uid('mk'), f: f - cc.start, name: '', color: A.MARKER_COLORS[0], note: '' }); });
      return;
    }
    if (s.markers.some(function (m) { return m.f === f; })) { var ex = s.markers.filter(function (m) { return m.f === f; })[0]; A.editMarker(ex.id); return; }
    C.edit('Add Marker', function (s2) { s2.markers.push({ id: U.uid('mk'), f: f, name: 'Marker ' + (s2.markers.length + 1), color: A.MARKER_COLORS[0], note: '', dur: 0 }); s2.markers.sort(function (a, b) { return a.f - b.f; }); });
  };
  A.gotoMarker = function (dir) {
    var s = seq(), f = ph();
    var fs = s.markers.map(function (m) { return m.f; });
    s.clips.forEach(function (c) { (c.markers || []).forEach(function (m) { fs.push(c.start + m.f); }); });
    fs.sort(function (a, b) { return a - b; });
    var t = dir > 0 ? fs.filter(function (x) { return x > f; })[0] : fs.filter(function (x) { return x < f; }).pop();
    if (t != null) C.Engine.seek(t);
  };
  A.editMarker = function (id) {
    var s = seq(), m = s.markers.filter(function (x) { return x.id === id; })[0]; if (!m) return;
    var h = U.h;
    var name = h('input', { type: 'text', value: m.name, style: { width: '260px' } });
    var note = h('textarea', { rows: 3, style: { width: '260px' } }); note.value = m.note || '';
    var dur = h('input', { type: 'text', value: U.fmtTC(m.dur || 0, s.fps), style: { width: '110px' } });
    var color = m.color, sw = h('div.row');
    A.MARKER_COLORS.forEach(function (c) {
      var b = h('button.swatch' + (c === color ? '.on' : ''), { style: { background: c } });
      b.addEventListener('click', function () { color = c; U.$$('.swatch', sw).forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); });
      sw.appendChild(b);
    });
    C.ui.dialog({ title: 'Marker at ' + U.fmtTC(m.f, s.fps), width: 400,
      body: h('div.form-grid', h('label', 'Name'), name, h('label', 'Duration'), dur, h('label', 'Color'), sw, h('label', 'Notes'), note),
      buttons: [{ label: 'Delete', danger: true, left: true, action: function () { C.edit('Delete Marker', function (s2) { s2.markers = s2.markers.filter(function (x) { return x.id !== id; }); }); } },
        { label: 'Cancel' }, { label: 'OK', primary: true, action: function () {
          C.edit('Edit Marker', function (s2) { var mm = s2.markers.filter(function (x) { return x.id === id; })[0]; if (!mm) return; mm.name = name.value; mm.note = note.value; mm.color = color; mm.dur = Math.max(0, U.parseTC(dur.value, s2.fps) || 0); });
        } }] });
  };

  /* ---------- Transitions ---------- */
  // Add a transition at the edit point nearest the playhead on targeted tracks, or at selected clip edges
  A.addTransition = function (kind, typeId, at) {
    var s = seq(), f = at != null ? at : ph();
    typeId = typeId || (kind === 'audio' ? (C.prefs.defAudioTr || 'a_power') : (C.prefs.defVideoTr || 'cross'));
    var durF = Math.max(2, Math.round((kind === 'audio' ? C.prefs.audioTransDur : C.prefs.transDur) * s.fps));
    var added = 0;
    C.edit('Add ' + C.TR.byId[typeId].name, function (s2) {
      var tracks = s2.tracks.filter(function (t) { return t.kind === kind && !t.lock && (t.target || sel().length); });
      var selIds = C.state.selection;
      tracks.forEach(function (t) {
        var list = P.clipsOn(s2, t.id);
        if (selIds.length) list = list.filter(function (c) { return selIds.indexOf(c.id) >= 0; });
        if (!list.length) return;
        // find nearest edge to f
        var best = null, bd = Infinity;
        P.clipsOn(s2, t.id).forEach(function (c) {
          if (selIds.length && selIds.indexOf(c.id) < 0) return;
          [[c.start, 'in'], [c.start + c.dur, 'out']].forEach(function (e) { var d = Math.abs(e[0] - f); if (d < bd) { bd = d; best = { clip: c, edge: e[1], f: e[0] }; } });
        });
        if (!best || bd > s2.fps * 3) return;
        A.placeTransition(s2, best.clip, best.edge, typeId, durF);
        added++;
      });
      if (!added) return false;
    });
    if (!added) C.toast('Place the playhead near an edit point on a targeted ' + kind + ' track');
  };
  A.placeTransition = function (s2, clip, edge, typeId, durF) {
    var nb = T.neighbors(s2, clip), a, b;
    if (edge === 'in') { b = clip; a = nb.prev; } else { a = clip; b = nb.next; }
    var align = a && b ? 'center' : (b ? 'start' : 'end');
    var existing = s2.transitions.filter(function (tr) { return (b && tr.b === b.id) || (a && !b && tr.a === a.id && !tr.b) || (a && b && tr.a === a.id && tr.b === b.id); })[0];
    if (existing) { existing.type = typeId; existing.params = C.TR.defaults(typeId); return existing; }
    var tr = { id: U.uid('tr'), type: typeId, a: a ? a.id : null, b: b ? b.id : null, dur: durF, align: align, params: C.TR.defaults(typeId), trackId: clip.trackId };
    s2.transitions.push(tr);
    return tr;
  };

  /* ---------- Effects ---------- */
  A.applyEffect = function (fxId, clipIds) {
    var def = C.FX.byId[fxId]; if (!def) return;
    var s = seq();
    var ids = clipIds || C.state.selection;
    var targets = ids.map(function (id) { return P.clip(s, id); }).filter(function (c) { return c && (def.audio ? c.kind === 'audio' : c.kind === 'video'); });
    if (!targets.length) { C.toast('Select ' + (def.audio ? 'an audio' : 'a video') + ' clip to apply ' + def.name); return; }
    C.edit('Apply ' + def.name, function (s2) { targets.forEach(function (c) { var cc = P.clip(s2, c.id); cc.fx = cc.fx || []; cc.fx.push(C.FX.newInstance(fxId)); }); });
    C.toast(def.name + ' applied');
  };

  /* ---------- Tracks ---------- */
  A.addTrack = function (kind) {
    C.edit('Add ' + (kind === 'video' ? 'Video' : 'Audio') + ' Track', function (s) {
      var t = P.newTrack(kind);
      if (kind === 'video') { var lastV = P.vtracks(s).pop(); s.tracks.splice(s.tracks.indexOf(lastV) + 1, 0, t); }
      else s.tracks.push(t);
    });
    C.bus.emit('tracks');
  };
  A.deleteTrack = function (id) {
    var s = seq(), t = P.track(s, id); if (!t) return;
    var list = t.kind === 'video' ? P.vtracks(s) : P.atracks(s);
    if (list.length <= 1) { C.toast('A sequence needs at least one ' + t.kind + ' track'); return; }
    var n = 0, lab = P.trackLabel(s, t);
    C.edit('Delete Track', function (s2) {
      var ids = s2.clips.filter(function (c) { return c.trackId === id; }).map(function (c) { return c.id; }); n = ids.length;
      T.removeClips(s2, ids);
      s2.tracks = s2.tracks.filter(function (x) { return x.id !== id; });
    });
    C.state.selection = C.state.selection.filter(function (cid) { return P.clip(P.seq(), cid); });
    C.bus.emit('tracks'); C.bus.emit('selection');
    if (n) C.toast('Deleted ' + lab + ' with ' + n + ' clip' + (n > 1 ? 's' : '') + ' (Ctrl+Z to undo)');
  };

  /* ---------- Tools ---------- */
  A.TOOLS = [
    { id: 'select', name: 'Selection', key: 'V', icon: 'select' },
    { id: 'trackfwd', name: 'Track Select Forward', key: 'A', icon: 'trackfwd' },
    { id: 'ripple', name: 'Ripple Edit', key: 'B', icon: 'ripple' },
    { id: 'roll', name: 'Rolling Edit', key: 'N', icon: 'roll' },
    { id: 'rate', name: 'Rate Stretch', key: 'R', icon: 'rate' },
    { id: 'razor', name: 'Razor', key: 'C', icon: 'razor' },
    { id: 'slip', name: 'Slip', key: 'Y', icon: 'slip' },
    { id: 'slide', name: 'Slide', key: 'U', icon: 'slide' },
    { id: 'hand', name: 'Hand', key: 'H', icon: 'hand' },
    { id: 'zoom', name: 'Zoom', key: 'Z', icon: 'zoom' },
    { id: 'text', name: 'Text', key: 'T', icon: 'text' }
  ];
  A.setTool = function (id) { C.state.tool = id; C.bus.emit('tool', id); };

  /* ---------- Navigation ---------- */
  A.editPoint = function (dir) {
    var s = seq(), f = ph();
    var tids = T.targetTracks(s);
    var pts = T.editPoints(s, tids.length ? tids : null);
    pts.push(P.seqDuration(s));
    var t = dir > 0 ? pts.filter(function (x) { return x > f; })[0] : pts.filter(function (x) { return x < f; }).pop();
    if (t != null) C.Engine.seek(t);
  };

  /* ---------- Generated items ---------- */
  A.newGen = function (kind, preset) {
    if (!C.state.project) return;
    var opts = {};
    if (preset && typeof preset === 'object') { opts.gen = preset.gen; opts.name = preset.name; }
    else if (preset) { var pr = C.Titles.PRESETS.filter(function (p) { return p.id === preset; })[0]; if (pr) { opts.gen = pr.make(); opts.name = pr.name; } }
    opts.folder = C.Bin && C.Bin.currentFolder ? C.Bin.currentFolder() : null;
    var m = C.Media.newGen(kind, opts);
    C.edit('New ' + m.name, function () { });
    C.bus.emit('media');
    return m;
  };
  // Create a title and drop it on the timeline at the playhead (Text tool)
  A.addTitleAtPlayhead = function (x, y, preset) {
    var m = A.newGen('title', preset);
    if (!m) return;
    var s = seq(), f = ph(), made;
    if (x != null) { m.gen.layers[0].x = U.round(x / s.w * 100, 2); m.gen.layers[0].y = U.round(y / s.h * 100, 2); m.gen.layers[0].text = 'Text'; m.gen.layers[0].size = 90; }
    C.edit('Add Title', function (s2) {
      // highest video track that is free at f, else add a track
      var vts = P.vtracks(s2), len = Math.round(C.prefs.stillDur * s2.fps), tgt = null;
      for (var i = vts.length - 1; i >= 0; i--) {
        var busy = s2.clips.some(function (c) { return c.trackId === vts[i].id && c.start < f + len && c.start + c.dur > f; });
        if (!busy && !vts[i].lock) { tgt = vts[i]; if (i === 0 || s2.clips.some(function (c) { return c.trackId === vts[i - 1].id && c.start < f + len && c.start + c.dur > f; })) break; }
      }
      if (!tgt) { tgt = P.newTrack('video'); s2.tracks.splice(s2.tracks.indexOf(vts[vts.length - 1]) + 1, 0, tgt); }
      made = T.placeMedia(s2, m, f, tgt.id, null, 'overwrite');
    });
    if (made) A.select([made[0].id]);
    C.ui && C.ui.showTab && C.ui.showTab('inspector');
    return made && made[0];
  };

  // Title templates: save the selected title (text layers become fields), create a title from one via a fill-in dialog
  A.saveTitleTemplate = function (clipId) {
    var s = seq(), c = clipId ? P.clip(s, clipId) : P.primaryClip();
    if (!c || !c.gen || c.gen.kind !== 'title') { C.toast('Select a title clip first'); return; }
    C.ui.prompt('Template name', c.name.replace(/^Title\s*\d*$/, '') || 'My Title', 'Text layers become fillable fields when the template is used (Effects › New Title › My Templates).').then(function (name) {
      if (!name) return;
      var rec = C.Titles.saveTemplate(name.trim(), c.gen);
      C.toast('Saved template "' + rec.name + '" with ' + rec.fields.length + ' field' + (rec.fields.length === 1 ? '' : 's'));
      if (C.Menus.build) C.Menus.build();
    });
  };
  A.titleFromTemplate = function (tplId) {
    var tpl = C.Titles.templates().filter(function (t) { return t.id === tplId; })[0]; if (!tpl) { C.toast('Template not found'); return; }
    var h = U.h, inputs = {}, g = h('div.form-grid', { style: { minWidth: '420px' } });
    tpl.fields.forEach(function (f) {
      var L = tpl.gen.layers.filter(function (x) { return x.id === f.id; })[0], multi = L && /\n/.test(L.text || '');
      var inp = multi ? h('textarea', { rows: 3, style: { width: '100%' } }) : h('input', { type: 'text', style: { width: '100%' } });
      inp.value = L ? L.text : ''; inp.addEventListener('keydown', function (e) { e.stopPropagation(); });
      inputs[f.id] = inp; g.appendChild(h('label', f.label)); g.appendChild(inp);
    });
    var body = h('div', h('div.muted', { style: { marginBottom: '8px' } }, 'Fill in the template\'s fields. The title is added at the playhead and stays fully editable.'), tpl.fields.length ? g : h('div.muted', 'This template has no text fields.'));
    C.ui.dialog({ title: 'New Title from "' + tpl.name + '"', width: 520, body: body, buttons: [
      { label: 'Delete Template', left: true, action: function () { C.Titles.deleteTemplate(tpl.id); C.toast('Template deleted'); if (C.Menus.build) C.Menus.build(); } },
      { label: 'Cancel' },
      { label: 'Add Title', primary: true, action: function () {
        var values = {}; Object.keys(inputs).forEach(function (k) { values[k] = inputs[k].value; });
        A.addTitleAtPlayhead(null, null, { gen: C.Titles.fromTemplate(tpl, values), name: tpl.name });
      } }] });
    if (tpl.fields.length) setTimeout(function () { inputs[tpl.fields[0].id].focus(); inputs[tpl.fields[0].id].select(); }, 30);
  };

  /* ---------- Zoom ---------- */
  A.zoom = function (k) { if (C.TL) C.TL.zoomBy(k); };
  A.zoomFit = function () { if (C.TL) C.TL.zoomFit(); };
  A.toggleSnap = function () { C.state.snapping = !C.state.snapping; C.toast('Snapping ' + (C.state.snapping ? 'on' : 'off')); C.bus.emit('state'); };
  A.toggleLinked = function () { C.state.linked = !C.state.linked; C.toast('Linked selection ' + (C.state.linked ? 'on' : 'off')); C.bus.emit('state'); };

  /* ---------- Sequences ---------- */
  A.newSequence = function () {
    C.ui.sequenceDialog(null, function (o) {
      C.edit('New Sequence', function (s, prj) {
        var ns = P.newSequence(o);
        ns.name = o.name || ('Sequence ' + (prj.sequences.length + 1));
        prj.sequences.push(ns); prj.activeSeq = ns.id;
      });
      A.deselect(); C.Engine.setFrame(0); C.bus.emit('sequence');
    });
  };
  // Place a sequence as a nested clip at the playhead (overwrite on targeted tracks)
  A.insertNest = function (seqId) {
    var cur = P.seq(); if (!cur) return;
    if (P.seqContains(seqId, cur.id)) { C.toast('A sequence cannot be nested inside itself'); return; }
    var made;
    C.edit('Insert Nested Sequence', function (s2) {
      var m = P.nestMedia(seqId, true); P.refreshNests();
      made = T.sourceEdit(s2, { media: m, inSec: 0, outSec: m.duration, at: C.Engine.frame, mode: 'overwrite' });
      if (!made) return false;
    });
    if (made) A.select(made.map(function (c) { return c.id; }));
  };
  // Move the selected clips into a new sequence and replace them with a nested clip
  A.nest = function () {
    var sel = P.selectedClips(); if (!sel.length) { C.toast('Select clips to nest'); return; }
    var s = P.seq(), minS = Math.min.apply(null, sel.map(function (c) { return c.start; })), maxE = Math.max.apply(null, sel.map(function (c) { return c.start + c.dur; }));
    var ids = sel.map(function (c) { return c.id; }), made;
    C.edit('Nest Clips', function (s2, prj) {
      var ns = P.newSequence({ w: s2.w, h: s2.h, fps: s2.fps, bg: s2.bg, vtracks: P.vtracks(s2).length, atracks: P.atracks(s2).length });
      ns.name = 'Nested ' + (prj.sequences.length + 1);
      ns.tracks = s2.tracks.map(function (t) { var n = U.clone(t); n.id = U.uid('t'); n._src = t.id; return n; });
      var tmap = {}; ns.tracks.forEach(function (t) { tmap[t._src] = t.id; delete t._src; });
      var moved = s2.clips.filter(function (c) { return ids.indexOf(c.id) >= 0; });
      moved.forEach(function (c) { var n = U.clone(c); n.start = c.start - minS; n.trackId = tmap[c.trackId]; ns.clips.push(n); });
      ns.transitions = s2.transitions.filter(function (tr) { return (!tr.a || ids.indexOf(tr.a) >= 0) && (!tr.b || ids.indexOf(tr.b) >= 0); }).map(function (tr) { var n = U.clone(tr); n.trackId = tmap[tr.trackId]; return n; });
      prj.sequences.push(ns);
      var vT = moved.filter(function (c) { return c.kind === 'video'; }).map(function (c) { return P.track(s2, c.trackId); });
      var aT = moved.filter(function (c) { return c.kind === 'audio'; }).map(function (c) { return P.track(s2, c.trackId); });
      var vt = vT.sort(function (a, b) { return s2.tracks.indexOf(a) - s2.tracks.indexOf(b); })[0], at = aT.sort(function (a, b) { return s2.tracks.indexOf(a) - s2.tracks.indexOf(b); })[0];
      T.removeClips(s2, ids);
      var m = P.nestMedia(ns.id, true); P.refreshNests();
      made = T.placeMedia(s2, m, minS, vt ? vt.id : null, at ? at.id : null, 'overwrite', 0, (maxE - minS) / s2.fps);
    });
    if (made) A.select(made.map(function (c) { return c.id; }));
    C.bus.emit('sequence');
    C.toast('Nested ' + ids.length + ' clip(s) — double-click the nested clip to open it');
  };
  // When the first clip lands in an empty sequence, offer to match the sequence to the clip's format
  A.offerMatch = function (mediaId) {
    var s = P.seq(), m = P.media(mediaId);
    if (!s || !m || m.type !== 'video' || !m.w || !m.h) return;
    var fps = m.fps || s.fps;
    if (m.w === s.w && m.h === s.h && Math.abs(fps - s.fps) < 0.01) return;
    if (s.clips.filter(function (c) { return c.kind === 'video'; }).length !== 1) return;
    C.ui.dialog({ title: 'Clip format differs from the sequence', width: 460,
      body: U.h('div', { style: { lineHeight: 1.6 } }, U.h('div', U.h('b', m.name), ' is ', U.h('b', m.w + '×' + m.h + ' @ ' + fps + ' fps'), '.'),
        U.h('div', 'The sequence is ', U.h('b', s.w + '×' + s.h + ' @ ' + s.fps + ' fps'), '. Change the sequence settings to match the clip?')),
      buttons: [{ label: 'Keep Sequence Settings' }, { label: 'Match Clip', primary: true, action: function () {
        var oldFps = s.fps;
        C.edit('Match Sequence to Clip', function (s2, prj) {
          var r = fps / oldFps;
          if (Math.abs(r - 1) > 1e-6) {
            s2.clips.forEach(function (c) { c.start = Math.round(c.start * r); c.dur = Math.max(1, Math.round(c.dur * r)); C.KF.scaleAll(c, r); });
            s2.markers.forEach(function (mk) { mk.f = Math.round(mk.f * r); });
          }
          var kx = m.w / s2.w, ky = m.h / s2.h;
          s2.clips.forEach(function (c) { if (c.tf) { c.tf.x *= kx; c.tf.y *= ky; } });
          s2.w = m.w; s2.h = m.h; s2.fps = fps;
        });
        C.bus.emit('sequence');
      } }] });
  };
  A.sequenceFromClip = function (mediaId) {
    var m = P.media(mediaId); if (!m) return;
    var made;
    C.edit('New Sequence from Clip', function (s, prj) {
      var ns = P.newSequence({ w: m.w || 1920, h: m.h || 1080, fps: m.fps || (P.seq() ? P.seq().fps : 30) });
      ns.name = m.name.replace(/\.[^.]+$/, '');
      prj.sequences.push(ns); prj.activeSeq = ns.id;
      made = T.placeMedia(ns, m, 0, P.mediaHasVideo(m) ? P.vtracks(ns)[0].id : null, P.mediaHasAudio(m) ? P.atracks(ns)[0].id : null, 'overwrite');
    });
    A.deselect(); C.Engine.setFrame(0); C.bus.emit('sequence'); C.bus.emit('changed', { seq: true });
    if (C.TL) setTimeout(C.TL.zoomFit, 50);
  };
  // New sequence with the given library items laid end to end (subclips of one source in source-time order)
  A.sequenceFromItems = function (ids) {
    var items = ids.map(function (i) { return P.media(i); }).filter(function (m) { return m && m.type !== 'nest'; });
    if (!items.length) { C.toast('Select media or subclips in the Library first'); return; }
    items.sort(function (a, b) {
      var ba = C.Media.base(a), bb = C.Media.base(b);
      if (ba.id === bb.id) return (a.sub ? a.sub.in : 0) - (b.sub ? b.sub.in : 0);
      return ids.indexOf(a.id) - ids.indexOf(b.id);
    });
    var first = items.filter(function (m) { return m.type === 'video'; })[0] || items[0];
    var made = 0;
    C.edit('New Sequence from Items', function (s, prj) {
      var cur = P.seq();
      var ns = P.newSequence({ w: first.w || (cur ? cur.w : 1920), h: first.h || (cur ? cur.h : 1080), fps: first.fps || (cur ? cur.fps : 30) });
      ns.name = 'Edit ' + (prj.sequences.length + 1);
      prj.sequences.push(ns); prj.activeSeq = ns.id;
      var pos = 0;
      items.forEach(function (m) {
        var r = T.placeMedia(ns, m, pos, P.mediaHasVideo(m) ? P.vtracks(ns)[0].id : null, P.mediaHasAudio(m) ? P.atracks(ns)[0].id : null, 'overwrite');
        if (r.length) { pos = r[0].start + r[0].dur; made++; }
      });
    });
    A.deselect(); C.Engine.setFrame(0); C.bus.emit('sequence'); C.bus.emit('changed', { seq: true });
    if (C.TL) setTimeout(C.TL.zoomFit, 50);
    C.toast('New sequence with ' + made + ' item' + (made === 1 ? '' : 's'));
  };
  // From the timeline selection: copy the selected clips (keeping their relative layout) into a new sequence
  A.sequenceFromSelection = function () {
    var sel = P.selectedClips();
    if (!sel.length) { if (C.Bin && C.Bin.sel.length) return A.sequenceFromItems(C.Bin.sel.slice()); C.toast('Select clips in the timeline (or items in the Library) first'); return; }
    var s = P.seq(), minS = Math.min.apply(null, sel.map(function (c) { return c.start; }));
    var ids = sel.map(function (c) { return c.id; });
    C.edit('New Sequence from Selection', function (s2, prj) {
      var ns = P.newSequence({ w: s2.w, h: s2.h, fps: s2.fps, bg: s2.bg, vtracks: P.vtracks(s2).length, atracks: P.atracks(s2).length });
      ns.name = 'Edit ' + (prj.sequences.length + 1);
      ns.tracks = s2.tracks.map(function (t) { var n = U.clone(t); n.id = U.uid('t'); n._src = t.id; return n; });
      var tmap = {}; ns.tracks.forEach(function (t) { tmap[t._src] = t.id; delete t._src; });
      var lmap = {};
      s2.clips.filter(function (c) { return ids.indexOf(c.id) >= 0; }).forEach(function (c) {
        var n = U.clone(c); n.id = U.uid('c'); n.start = c.start - minS; n.trackId = tmap[c.trackId];
        if (c.link) n.link = lmap[c.link] || (lmap[c.link] = U.uid('lk'));
        ns.clips.push(n);
      });
      ns.target = s2.target || null;
      prj.sequences.push(ns); prj.activeSeq = ns.id;
    });
    void s;
    A.deselect(); C.Engine.setFrame(0); C.bus.emit('sequence'); C.bus.emit('changed', { seq: true });
    if (C.TL) setTimeout(C.TL.zoomFit, 50);
  };
  A.makeSubclip = function () { if (C.Source) C.Source.makeSubclip(); };

  /* ---------- Highlight finder (loudness spikes in long streams) ---------- */
  A.findHighlightsDialog = function (mediaId) {
    var m = P.media(mediaId || C.state.sourceMedia || (C.Bin && C.Bin.sel[0]));
    if (!m) { C.toast('Select a video or audio item in the Library first'); return; }
    m = C.Media.base(m);
    if (!(m.type === 'video' || m.type === 'audio') || !m.hasAudio) { C.toast(m.name + ' has no audio to analyse'); return; }
    var h = U.h, prefs = U.lsGet('highlights', { sens: 9, gap: 45, max: 30 });
    var sens = h('input', { type: 'range', min: 3, max: 20, step: 0.5, value: prefs.sens }), sensV = h('span.muted', '');
    var gap = h('input', { type: 'number', min: 1, max: 3600, value: prefs.gap, style: { width: '80px' } });
    var mx = h('input', { type: 'number', min: 1, max: 500, value: prefs.max, style: { width: '80px' } });
    var repl = h('input', { type: 'checkbox', checked: true });
    var status = h('div.muted', { style: { minHeight: '18px' } }, '');
    [gap, mx].forEach(function (i) { i.addEventListener('keydown', function (e) { e.stopPropagation(); }); });
    function upd() { sensV.textContent = '+' + sens.value + ' dB above the surrounding level' + (sens.value <= 6 ? ' (finds more)' : sens.value >= 14 ? ' (only big moments)' : ''); }
    sens.addEventListener('input', upd); upd();
    var body = h('div', { style: { width: '520px', lineHeight: '1.5' } },
      h('div', { style: { marginBottom: '8px' } }, 'Scans the loudness of ', h('b', m.name), ' and drops markers where it rises clearly above the rolling baseline — streamer or game reactions, hype moments, explosions. ',
        h('b', 'These are suggestions'), ': each marker gets a strength score so you can review the strongest first in the Markers list.'),
      h('div.form-grid', h('label', 'Sensitivity'), h('div', sens, h('br'), sensV), h('label', 'Minimum spacing'), h('div.row', gap, h('span.muted', 'seconds between markers')),
        h('label', 'Maximum markers'), mx, h('label', 'Existing suggestions'), h('label.cl-check', repl, h('span', 'Replace earlier suggested markers (manual markers are kept)'))),
      status);
    var d = C.ui.dialog({ title: 'Find Highlights', width: 560, body: body, buttons: [{ label: 'Cancel' }, { label: 'Find Highlights', primary: true, id: 'go', action: function () {
      var o = { sensitivity: +sens.value, minGap: Math.max(1, +gap.value || 30), max: Math.max(1, Math.round(+mx.value || 30)) };
      U.lsSet('highlights', { sens: o.sensitivity, gap: o.minGap, max: o.max });
      d.go.disabled = true;
      A.findHighlights(m.id, o, repl.checked, function (k, msg) { status.textContent = msg; }).then(function (n) { d.close(); if (n != null) { C.ui.showLeftTab('markers'); if (C.Side) { C.Side.markerFilter = 'source'; C.Side.markerSort = 'strength'; C.Side.renderMarkers(); } } }, function (e) { status.textContent = 'Could not analyse: ' + (e && e.message || e); d.go.disabled = false; });
      return false;
    } }] });
  };
  // Analyse and add suggested markers to the media. Resolves the number of markers added.
  A.findHighlights = function (mediaId, opts, replace, onStatus) {
    var m = C.Media.base(P.media(mediaId)); if (!m) return Promise.reject(new Error('no media'));
    var rt = C.MRT[m.id]; if (!rt) return Promise.reject(new Error('media offline'));
    onStatus = onStatus || function () { };
    var peaksP;
    if (rt.stream) peaksP = C.AudioStream.startPeaks(m);
    else peaksP = Promise.resolve(rt.buffer ? A.rmsFromBuffer(rt) : null);
    var t0 = performance.now();
    var tick = setInterval(function () { var pk = rt.peaks; if (pk && pk.done < 1) onStatus(pk.done, 'Reading audio… ' + Math.floor(pk.done * 100) + '% (the waveform pass is shared, so this only happens once)'); }, 300);
    return peaksP.then(function (pk) {
      clearInterval(tick);
      if (!pk || !pk.rmsN) throw new Error('no loudness data');
      var found = C.AudioStream.findHighlights(pk, opts);
      C.edit('Find Highlights', function (s, prj) {
        var bm = prj.media.filter(function (x) { return x.id === m.id; })[0];
        bm.markers = (bm.markers || []).filter(function (x) { return !(replace && x.auto); });
        found.forEach(function (f) { bm.markers.push({ id: U.uid('mk'), t: f.t, end: f.end, name: f.label, color: '#e2b93d', note: 'Suggested by Find Highlights — peak ' + f.db.toFixed(1) + ' dB above baseline, ' + f.len.toFixed(1) + ' s', strength: f.strength, auto: true }); });
        bm.markers.sort(function (a, b) { return a.t - b.t; });
      });
      C.bus.emit('media');
      C.toast(found.length + ' suggested highlight marker' + (found.length === 1 ? '' : 's') + ' added to ' + m.name + ' (' + ((performance.now() - t0) / 1000).toFixed(1) + ' s)', 4000);
      return found.length;
    }, function (e) { clearInterval(tick); throw e; });
  };
  // short media: build the RMS envelope from the decoded buffer
  A.rmsFromBuffer = function (rt) {
    var b = rt.buffer, sr = b.sampleRate, rate = C.AudioStream.RMS_RATE, span = Math.round(sr / rate), n = Math.ceil(b.length / span);
    var rms = new Float32Array(n), chs = []; for (var c = 0; c < b.numberOfChannels; c++) chs.push(b.getChannelData(c));
    for (var i = 0; i < n; i++) { var s0 = i * span, s1 = Math.min(b.length, s0 + span), sum = 0; for (var k = 0; k < chs.length; k++) { var d = chs[k]; for (var j = s0; j < s1; j++) sum += d[j] * d[j]; } rms[i] = Math.sqrt(sum / Math.max(1, (s1 - s0) * chs.length)); }
    return { rms: rms, rmsN: n, rmsRate: rate };
  };
  A.switchSequence = function (id) {
    var p = C.state.project; if (!p || p.activeSeq === id) return;
    if (C.Engine.playing) C.Engine.pause();
    p.activeSeq = id;
    A.deselect();
    var f = (C.state.playheads || {})[id] || 0;
    C.Engine.setFrame(f);
    C.bus.emit('sequence');
    C.bus.emit('changed', { seq: true });
  };
})();
