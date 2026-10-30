/* Cutline — project data model (plain JSON-serialisable objects) and accessors. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util;

  C.FPS_PRESETS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
  C.RES_PRESETS = [
    { id: '1080p', name: 'HD 1080p (1920×1080)', w: 1920, h: 1080 },
    { id: '4k', name: 'UHD 4K (3840×2160)', w: 3840, h: 2160 },
    { id: '720p', name: 'HD 720p (1280×720)', w: 1280, h: 720 },
    { id: 'vert', name: 'Vertical 1080×1920', w: 1080, h: 1920 },
    { id: 'square', name: 'Square 1080×1080', w: 1080, h: 1080 },
    { id: '4x5', name: 'Portrait 4:5 (1080×1350)', w: 1080, h: 1350 },
    { id: 'dci', name: 'Cinema 2K (2048×858)', w: 2048, h: 858 }
  ];

  var DEFAULT_PREFS = {
    stillDur: 5, transDur: 1, audioTransDur: 1, autosave: 60, thumbQuality: 'medium',
    playbackRes: 'auto', snapping: true, scaleToFrame: true, cacheMB: 100, linkedSelection: true,
    showWaveforms: true, showThumbs: true, showKeyframes: true, audioScrub: true, defaultTrackH: 54, tcDropFrame: true,
    gpuCodec: 'prefer'
  };
  C.prefs = Object.assign({}, DEFAULT_PREFS, U.lsGet('prefs', {}));
  C.savePrefs = function () { U.lsSet('prefs', C.prefs); C.bus.emit('prefs'); };
  C.DEFAULT_PREFS = DEFAULT_PREFS;

  var P = C.P = {};

  P.newTrack = function (kind, name) {
    return {
      id: U.uid('t'), kind: kind, name: name || '', hidden: false, mute: false, solo: false, lock: false,
      h: kind === 'video' ? 54 : 50, target: true, vol: 0, pan: 0, sync: true
    };
  };

  P.newSequence = function (opts) {
    opts = opts || {};
    var s = {
      id: U.uid('seq'), name: opts.name || 'Sequence 1',
      w: opts.w || 1920, h: opts.h || 1080, fps: opts.fps || 30, bg: opts.bg || '#000000',
      tracks: [], clips: [], transitions: [], markers: [], captions: [],
      capStyle: { font: 'Segoe UI', size: 46, color: '#ffffff', bg: '#000000', bgOp: 0.6, pos: 0.9, weight: 600, outline: 0 },
      inF: null, outF: null, playhead: 0, zoom: 0, scrollX: 0, showCaptions: true
    };
    var nv = opts.vtracks || 3, na = opts.atracks || 3, i;
    for (i = 0; i < nv; i++) s.tracks.push(P.newTrack('video'));
    for (i = 0; i < na; i++) s.tracks.push(P.newTrack('audio'));
    return s;
  };

  P.newProject = function (opts) {
    opts = opts || {};
    var seq = P.newSequence(opts);
    return {
      app: 'Cutline', format: 'kcut', version: 1,
      id: U.uid('prj'), name: opts.projectName || 'Untitled Project',
      created: Date.now(), modified: Date.now(),
      settings: { w: seq.w, h: seq.h, fps: seq.fps, bg: seq.bg },
      media: [], folders: [], sequences: [seq], activeSeq: seq.id
    };
  };

  /* ---------- Runtime state ---------- */
  C.state = {
    project: null,
    selection: [],        // clip ids
    selTransition: null,  // transition id
    selMarker: null,
    tool: 'select',
    snapping: C.prefs.snapping,
    linked: C.prefs.linkedSelection,
    sourceMedia: null,    // media id open in source monitor
    focus: 'timeline',    // 'timeline' | 'source' | 'program' | 'bin'
    clipboard: null,
    dirty: false,
    fileHandle: null
  };

  P.project = function () { return C.state.project; };
  P.seq = function () {
    var p = C.state.project; if (!p) return null;
    for (var i = 0; i < p.sequences.length; i++) if (p.sequences[i].id === p.activeSeq) return p.sequences[i];
    return p.sequences[0];
  };
  P.seqById = function (id) {
    var p = C.state.project; if (!p) return null;
    for (var i = 0; i < p.sequences.length; i++) if (p.sequences[i].id === id) return p.sequences[i];
    return null;
  };
  P.media = function (id) {
    var p = C.state.project; if (!p || !id) return null;
    var m = p.media;
    for (var i = 0; i < m.length; i++) if (m[i].id === id) return m[i];
    return null;
  };
  P.track = function (seq, id) {
    for (var i = 0; i < seq.tracks.length; i++) if (seq.tracks[i].id === id) return seq.tracks[i];
    return null;
  };
  P.clip = function (seq, id) {
    var c = seq.clips;
    for (var i = 0; i < c.length; i++) if (c[i].id === id) return c[i];
    return null;
  };
  P.vtracks = function (seq) { return seq.tracks.filter(function (t) { return t.kind === 'video'; }); };
  P.atracks = function (seq) { return seq.tracks.filter(function (t) { return t.kind === 'audio'; }); };
  P.trackLabel = function (seq, t) {
    var list = t.kind === 'video' ? P.vtracks(seq) : P.atracks(seq);
    return (t.kind === 'video' ? 'V' : 'A') + (list.indexOf(t) + 1);
  };
  P.trackDisplayName = function (seq, t) { return t.name || (t.kind === 'video' ? 'Video ' : 'Audio ') + (P.trackLabel(seq, t).slice(1)); };
  P.clipsOn = function (seq, trackId) {
    return seq.clips.filter(function (c) { return c.trackId === trackId; }).sort(function (a, b) { return a.start - b.start; });
  };
  P.clipEnd = function (c) { return c.start + c.dur; };
  P.seqDuration = function (seq) {
    var e = 0; seq.clips.forEach(function (c) { e = Math.max(e, c.start + c.dur); });
    seq.captions.forEach(function (c) { e = Math.max(e, c.end); });
    return e;
  };
  P.linked = function (seq, clip) {
    if (!clip || !clip.link) return [clip];
    return seq.clips.filter(function (c) { return c.link === clip.link; });
  };
  P.selectedClips = function () {
    var seq = P.seq(); if (!seq) return [];
    return C.state.selection.map(function (id) { return P.clip(seq, id); }).filter(Boolean);
  };
  P.primaryClip = function () {
    var s = P.selectedClips(); if (!s.length) return null;
    if (C.state.primaryId) { var pc = s.filter(function (c) { return c.id === C.state.primaryId; })[0]; if (pc) return pc; }
    var v = s.filter(function (c) { return c.kind === 'video'; });
    return v.length ? v[v.length - 1] : s[s.length - 1];
  };

  P.isVisual = function (media) {
    if (!media) return false;
    return media.type === 'video' || media.type === 'image' || media.type === 'gen' || media.type === 'nest';
  };
  P.mediaHasAudio = function (m) {
    if (!m) return false;
    if (m.type === 'audio') return true;
    if (m.type === 'video') return !!m.hasAudio;
    if (m.type === 'gen') return m.gen && (m.gen.kind === 'bars' || m.gen.kind === 'countdown');
    if (m.type === 'nest') return !!m.hasAudio;
    return false;
  };
  P.mediaHasVideo = function (m) {
    if (!m) return false;
    if (m.type === 'audio') return false;
    if (m.type === 'nest') return m.hasVideo !== false;
    if (m.type === 'video') return m.hasVideo !== false;
    return true;
  };
  P.isStill = function (m) { return m && (m.type === 'image' || m.type === 'gen'); };

  P.defaultTransform = function (seq) {
    return { x: seq.w / 2, y: seq.h / 2, scale: 100, sw: 100, sh: 100, uni: true, rot: 0, ax: 50, ay: 50, op: 100, cl: 0, cr: 0, ct: 0, cb: 0, fh: false, fv: false };
  };
  P.defaultColor = function () {
    return {
      on: true, temp: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, sat: 100, vib: 0,
      fade: 0, sharpen: 0, look: 'none', lookAmt: 100, lut: null, lutAmt: 100,
      shX: 0, shY: 0, shL: 0, midX: 0, midY: 0, midL: 0, hiX: 0, hiY: 0, hiL: 0,
      curves: { m: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] },
      vig: 0, vigMid: 50, vigRound: 50, vigFeather: 50
    };
  };
  P.colorIsDefault = function (col) {
    if (!col || !col.on) return true;
    var d = P.defaultColor();
    for (var k in d) {
      if (k === 'on' || k === 'curves' || k === 'look' || k === 'lookAmt' || k === 'lut' || k === 'lutAmt') continue;
      if (col[k] !== d[k]) return false;
    }
    if (col.look && col.look !== 'none') return false;
    if (col.lut) return false;
    var cv = col.curves;
    if (cv) for (var ch in cv) { var pts = cv[ch]; if (pts.length !== 2 || pts[0][0] !== 0 || pts[0][1] !== 0 || pts[1][0] !== 1 || pts[1][1] !== 1) return false; }
    return true;
  };

  P.newClip = function (seq, media, kind, trackId, start, dur, inSec) {
    var name = media ? media.name : 'Clip';
    var c = {
      id: U.uid('c'), kind: kind, trackId: trackId, mediaId: media ? media.id : null, name: name,
      start: Math.round(start), dur: Math.max(1, Math.round(dur)), in: inSec || 0,
      speed: 1, reverse: false, freeze: null, link: null, enabled: true, label: null,
      fx: [], kf: {}, markers: [], tm: { speed: 100 }
    };
    if (kind === 'video') {
      c.tf = P.defaultTransform(seq);
      c.fit = C.prefs.scaleToFrame;
      c.blend = 'normal';
      c.col = null;
      if (media && media.type === 'gen') {
        c.gen = U.clone(media.gen);
        if (media.gen.kind === 'adjust') c.fit = false;
      }
    } else {
      c.au = { vol: 0, pan: 0, mute: false, gain: 0, pitch: true };
      c.fadeIn = 0; c.fadeOut = 0;
    }
    return c;
  };

  P.sourceSec = function (seq, clip, frame) {
    // Map a sequence frame to a source time (seconds) for this clip. Works outside clip bounds (for transition handles).
    if (clip.freeze != null) return clip.freeze;
    if (C.T && C.T.hasRamp(clip)) return C.T.rampSrc(seq, clip, frame - clip.start);
    var local = (frame - clip.start) / seq.fps;
    var durSec = clip.dur / seq.fps;
    var t = clip.reverse ? clip.in + (durSec - local - 1 / seq.fps) * clip.speed : clip.in + local * clip.speed;
    return t;
  };
  P.mediaDurSec = function (m) {
    if (!m) return 0;
    if (P.isStill(m)) return Infinity;
    return m.duration || 0;
  };
  // Max frames a clip can extend given media duration and in-point
  P.clipMaxDur = function (seq, clip) {
    var m = P.media(clip.mediaId);
    if (!m || P.isStill(m) || clip.freeze != null) return Infinity;
    if (C.T && C.T.hasRamp(clip)) return C.T.rampMaxDur(seq, clip, m.duration - clip.in);
    return Math.floor(((m.duration - clip.in) / clip.speed) * seq.fps + 1e-6);
  };

  P.findTransition = function (seq, id) {
    for (var i = 0; i < seq.transitions.length; i++) if (seq.transitions[i].id === id) return seq.transitions[i];
    return null;
  };
  // A transition references clip ids a (outgoing) and/or b (incoming)
  P.transitionRange = function (seq, tr) {
    var a = tr.a ? P.clip(seq, tr.a) : null, b = tr.b ? P.clip(seq, tr.b) : null;
    var cut = b ? b.start : (a ? a.start + a.dur : 0);
    var d = tr.dur, s;
    if (!a) s = cut;               // fade in at start of b
    else if (!b) s = cut - d;      // fade out at end of a
    else if (tr.align === 'start') s = cut;
    else if (tr.align === 'end') s = cut - d;
    else s = cut - Math.floor(d / 2);
    return { start: s, end: s + d, cut: cut, a: a, b: b };
  };

  /* --------- Media runtime registry (not serialised) --------- */
  C.MRT = {}; // mediaId -> { file, url, status, thumb, film:[], peaks, buffer, image, ... }

  P.trackOf = function (seq, clip) { return P.track(seq, clip.trackId); };

  /* ---------- Nested sequences ---------- */
  // Media record that represents a sequence used as a clip source
  P.nestMedia = function (seqId, create) {
    var prj = C.state.project; if (!prj) return null;
    var m = prj.media.filter(function (x) { return x.type === 'nest' && x.seqId === seqId; })[0];
    if (!m && create) {
      var s = P.seqById(seqId); if (!s) return null;
      m = { id: U.uid('m'), type: 'nest', seqId: seqId, name: s.name, w: s.w, h: s.h, duration: P.seqDuration(s) / s.fps, hasAudio: true, hasVideo: true, folder: '__nest', added: Date.now() };
      prj.media.push(m);
      C.MRT[m.id] = { status: 'ready', film: [] };
    }
    return m;
  };
  P.refreshNests = function () {
    var prj = C.state.project; if (!prj) return;
    prj.media.forEach(function (m) {
      if (m.type !== 'nest') return;
      var s = P.seqById(m.seqId); if (!s) return;
      m.name = s.name; m.w = s.w; m.h = s.h; m.duration = P.seqDuration(s) / s.fps;
      m.hasAudio = s.clips.some(function (c) { return c.kind === 'audio'; });
      m.hasVideo = s.clips.some(function (c) { return c.kind === 'video'; }) || !m.hasAudio;
    });
  };
  // true if sequence `outer` (directly or indirectly) contains a nest of `inner`
  P.seqContains = function (outerId, innerId, depth) {
    if (outerId === innerId) return true;
    if ((depth || 0) > 8) return true;
    var s = P.seqById(outerId); if (!s) return false;
    return s.clips.some(function (c) { var m = P.media(c.mediaId); return m && m.type === 'nest' && P.seqContains(m.seqId, innerId, (depth || 0) + 1); });
  };
  P.isTrackLocked = function (seq, trackId) { var t = P.track(seq, trackId); return !t || t.lock; };
})();
