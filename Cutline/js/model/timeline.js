/* Cutline — timeline editing operations. All functions mutate the given sequence in place.
   Times are integer frames on the sequence timebase; clip.in is in source seconds. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, P = C.P, KF = C.KF;
  var T = C.T = {};

  function spf(seq, clip) { return clip.speed / seq.fps; } // source seconds per timeline frame

  T.sortClips = function (seq) { seq.clips.sort(function (a, b) { return a.start - b.start; }); };

  /* ---------- Speed ramps (time remapping) ----------
     Keyframes on 'tm.speed' (percent, eased between keys) make the speed a function of the clip-local frame. The
     source time consumed up to local frame f is the integral S(f) of that function; everything that maps timeline
     time to source time (P.sourceSec, trims, splits, slips, audio) goes through these helpers. */
  T.hasRamp = function (clip) { return !!(clip && clip.kf && clip.kf['tm.speed'] && clip.kf['tm.speed'].length && clip.freeze == null); };
  // instantaneous speed ratio at a (float) local frame
  T.speedAt = function (clip, lf) {
    if (!T.hasRamp(clip)) return clip.speed;
    return Math.max(0, KF.evalKeys(clip.kf['tm.speed'], lf)) / 100;
  };
  var cumCache = {};
  // cumulative table: cum[i] = source seconds consumed by local frames [0, i); extrapolated linearly outside [0, dur]
  function rampTable(seq, clip) {
    var keys = clip.kf['tm.speed'], sig = JSON.stringify(keys) + '|' + clip.dur + '|' + seq.fps;
    var e = cumCache[clip.id];
    if (e && e.sig === sig) return e;
    var n = Math.max(1, Math.round(clip.dur)), cum = new Float64Array(n + 1), acc = 0;
    for (var i = 0; i < n; i++) { cum[i] = acc; acc += T.speedAt(clip, i + 0.5) / seq.fps; }
    cum[n] = acc;
    e = cumCache[clip.id] = { sig: sig, cum: cum, n: n, s0: T.speedAt(clip, 0) / seq.fps, s1: T.speedAt(clip, n) / seq.fps, keyCount: Object.keys(cumCache).length };
    if (e.keyCount > 400) { var ks = Object.keys(cumCache); for (var k = 0; k < 200; k++) delete cumCache[ks[k]]; }
    return e;
  }
  // S(f): source seconds consumed from local frame 0 to local (float) frame f
  T.rampCum = function (seq, clip, f) {
    var t = rampTable(seq, clip);
    if (f <= 0) return f * t.s0;
    if (f >= t.n) return t.cum[t.n] + (f - t.n) * t.s1;
    var i = Math.floor(f), k = f - i;
    return t.cum[i] + (t.cum[i + 1] - t.cum[i]) * k;
  };
  // source seconds at a local frame (honours reverse); the ramped counterpart of the constant-speed formula
  T.rampSrc = function (seq, clip, lf) {
    if (clip.reverse) return clip.in + T.rampCum(seq, clip, clip.dur) - T.rampCum(seq, clip, lf + 1);
    return clip.in + T.rampCum(seq, clip, lf);
  };
  // frames needed from local 0 to consume `span` source seconds (speed held after the last key); Infinity if never
  T.rampDurFor = function (seq, clip, span) {
    var t = rampTable(seq, clip);
    if (span <= 0) return 0;
    if (t.cum[t.n] >= span) { for (var i = 0; i < t.n; i++) if (t.cum[i + 1] >= span - 1e-9) return i + 1; return t.n; }
    if (t.s1 <= 1e-12) return Infinity;
    return t.n + Math.ceil((span - t.cum[t.n]) / t.s1 - 1e-9);
  };
  T.rampMaxDur = function (seq, clip, remaining) { var d = T.rampDurFor(seq, clip, remaining + 1e-6); return d === Infinity ? Infinity : Math.max(1, Math.floor(d)); };
  // source seconds covered by the clip's own range (constant or ramped)
  T.srcSpan = function (seq, clip, f0, f1) {
    if (f1 == null) { f1 = f0; f0 = 0; }
    if (T.hasRamp(clip)) return T.rampCum(seq, clip, f1) - T.rampCum(seq, clip, f0);
    return (f1 - f0) * spf(seq, clip);
  };
  // after the ramp keys changed: resize the clip so it still covers `span` source seconds (clamped to the media and
  // to the next clip on its track); returns the duration change
  T.fitRampDur = function (seq, clip, span) {
    var m = P.media(clip.mediaId), old = clip.dur;
    var d = T.hasRamp(clip) ? T.rampDurFor(seq, clip, span) : Math.round(span / spf(seq, clip));
    if (!isFinite(d)) d = old;
    d = Math.max(1, Math.round(d));
    if (m && !P.isStill(m)) { var mx = P.clipMaxDur(seq, clip); if (d > mx) d = Math.max(1, mx); }
    var nb = T.neighbors(seq, clip);
    if (nb.nextAny && clip.start + d > nb.nextAny.start) d = Math.max(1, nb.nextAny.start - clip.start);
    clip.dur = d;
    if (clip.fadeOut) clip.fadeOut = Math.min(clip.fadeOut, d);
    return d - old;
  };
  // set / add a speed key at a local frame keeping the source range the clip covers; linked partners follow
  T.setRampKey = function (seq, clip, lf, pct) {
    var group = C.state.linked && clip.link ? P.linked(seq, clip) : [clip];
    group.forEach(function (c) {
      var span = T.srcSpan(seq, c, c.dur);
      c.kf = c.kf || {};
      if (!c.kf['tm.speed'] || !c.kf['tm.speed'].length) c.kf['tm.speed'] = [{ f: 0, v: Math.round(c.speed * 10000) / 100, e: 'linear' }];
      KF.setAt(c, 'tm.speed', lf, pct);
      T.fitRampDur(seq, c, span);
    });
  };
  T.clearRamp = function (seq, clip) {
    var group = C.state.linked && clip.link ? P.linked(seq, clip) : [clip];
    group.forEach(function (c) {
      if (!T.hasRamp(c)) return;
      var span = T.srcSpan(seq, c, c.dur), avg = span / (c.dur / seq.fps);
      delete c.kf['tm.speed'];
      c.speed = U.clamp(avg || 1, 0.05, 20); if (c.tm) c.tm.speed = Math.round(c.speed * 10000) / 100;
      T.fitRampDur(seq, c, span);
    });
  };

  /* ---------- Trim primitives ---------- */
  // Allowed range for new left-edge position
  T.startLimits = function (seq, clip) {
    var end = clip.start + clip.dur, m = P.media(clip.mediaId);
    var min = -1e9;
    if (m && !P.isStill(m) && clip.freeze == null) {
      var ramp = T.hasRamp(clip);
      var s0 = ramp ? T.speedAt(clip, 0) / seq.fps : spf(seq, clip), s1 = ramp ? T.speedAt(clip, clip.dur) / seq.fps : spf(seq, clip);
      if (!clip.reverse) min = s0 > 1e-12 ? clip.start - Math.floor(clip.in / s0 + 1e-6) : -1e9;
      else { var rem = m.duration - clip.in - (ramp ? T.srcSpan(seq, clip, clip.dur) : 0); min = ramp ? (s1 > 1e-12 ? clip.start - Math.floor(rem / s1 + 1e-6) : -1e9) : end - Math.floor((m.duration - clip.in) / s1 + 1e-6); }
    }
    return { min: Math.max(min, -1e9), max: end - 1 };
  };
  T.endLimits = function (seq, clip) {
    var m = P.media(clip.mediaId), max = 1e9;
    if (m && !P.isStill(m) && clip.freeze == null) {
      if (T.hasRamp(clip)) {
        if (!clip.reverse) { var md = T.rampMaxDur(seq, clip, m.duration - clip.in); max = md === Infinity ? 1e9 : clip.start + md; }
        else { var s0 = T.speedAt(clip, 0) / seq.fps; max = s0 > 1e-12 ? clip.start + clip.dur + Math.floor(clip.in / s0 + 1e-6) : 1e9; }
      }
      else if (!clip.reverse) max = clip.start + Math.floor((m.duration - clip.in) / spf(seq, clip) + 1e-6);
      else max = clip.start + clip.dur + Math.floor(clip.in / spf(seq, clip) + 1e-6);
    }
    return { min: clip.start + 1, max: max };
  };
  T.setStart = function (seq, clip, ns) {
    var lim = T.startLimits(seq, clip);
    ns = U.clamp(Math.round(ns), lim.min, lim.max);
    var d = ns - clip.start;
    if (!d) return 0;
    var consumed = T.srcSpan(seq, clip, 0, d); // source seconds dropped (d > 0) or regained (d < 0) at the head
    clip.start = ns; clip.dur -= d;
    if (clip.freeze == null && !clip.reverse) clip.in = Math.max(0, clip.in + consumed);
    KF.shiftAll(clip, d);
    (clip.markers || []).forEach(function (mk) { mk.f -= d; });
    if (clip.fadeIn) clip.fadeIn = Math.min(clip.fadeIn, clip.dur);
    return d;
  };
  T.setEnd = function (seq, clip, ne) {
    var lim = T.endLimits(seq, clip);
    ne = U.clamp(Math.round(ne), lim.min, lim.max);
    var d = ne - (clip.start + clip.dur);
    if (!d) return 0;
    var consumed = T.srcSpan(seq, clip, clip.dur, clip.dur + d); // source seconds added at the tail (reverse: taken from the head)
    clip.dur += d;
    if (clip.freeze == null && clip.reverse) clip.in = Math.max(0, clip.in - consumed);
    if (clip.fadeOut) clip.fadeOut = Math.min(clip.fadeOut, clip.dur);
    return d;
  };

  /* ---------- Split ---------- */
  T.split = function (seq, clip, f) {
    f = Math.round(f);
    if (f <= clip.start || f >= clip.start + clip.dur) return null;
    var right = U.clone(clip);
    right.id = U.uid('c');
    var leftDur = f - clip.start, rightDur = clip.start + clip.dur - f;
    var leftSpan = T.srcSpan(seq, clip, 0, leftDur), rightSpan = T.srcSpan(seq, clip, leftDur, clip.dur);
    right.start = f; right.dur = rightDur;
    if (clip.freeze == null) {
      if (!clip.reverse) right.in = clip.in + leftSpan;
      else clip.in = clip.in + rightSpan;
    }
    clip.dur = leftDur;
    KF.shiftAll(right, leftDur);
    right.markers = (clip.markers || []).filter(function (m) { return m.f >= leftDur; }).map(function (m) { m = U.clone(m); m.f -= leftDur; return m; });
    clip.markers = (clip.markers || []).filter(function (m) { return m.f < leftDur; });
    if (clip.kind === 'audio') { right.fadeIn = 0; clip.fadeOut = 0; right.fadeOut = Math.min(right.fadeOut || 0, rightDur); clip.fadeIn = Math.min(clip.fadeIn || 0, leftDur); }
    seq.clips.push(right);
    // outgoing transitions move to the right part
    seq.transitions.forEach(function (tr) { if (tr.a === clip.id) tr.a = right.id; });
    return right;
  };
  // Split a set of clips (and their links) at frame f; returns right-hand clips
  T.splitClips = function (seq, clips, f) {
    var linkMap = {}, rights = [];
    clips.forEach(function (c) {
      var r = T.split(seq, c, f);
      if (r) {
        if (c.link) { linkMap[c.link] = linkMap[c.link] || U.uid('lk'); r.link = linkMap[c.link]; }
        rights.push(r);
      }
    });
    return rights;
  };

  /* ---------- Overwrite / clear ---------- */
  // Remove everything in [from, to) on a track (except excluded ids). Splits/trims as needed.
  T.clearRange = function (seq, trackId, from, to, exclude) {
    if (to <= from) return;
    exclude = exclude || {};
    var list = seq.clips.filter(function (c) { return c.trackId === trackId && !exclude[c.id]; });
    list.forEach(function (c) {
      var s = c.start, e = c.start + c.dur;
      if (e <= from || s >= to) return;
      if (s >= from && e <= to) { T.removeClip(seq, c.id); return; }
      if (s < from && e > to) {
        var r = T.split(seq, c, to);
        if (r) { r.link = null; }
        T.setEnd(seq, c, from);
        return;
      }
      if (s < from) { T.setEnd(seq, c, from); return; }
      if (e > to) { T.setStart(seq, c, to); }
    });
  };
  T.removeClip = function (seq, id) {
    seq.clips = seq.clips.filter(function (c) { return c.id !== id; });
    seq.transitions.forEach(function (tr) { if (tr.a === id) tr.a = null; if (tr.b === id) tr.b = null; });
    seq.transitions = seq.transitions.filter(function (tr) { return tr.a || tr.b; });
  };
  T.removeClips = function (seq, ids) { ids.forEach(function (id) { T.removeClip(seq, id); }); };

  /* ---------- Insert (ripple) ---------- */
  T.rippleInsert = function (seq, trackIds, at, len) {
    if (len <= 0) return;
    trackIds.forEach(function (tid) {
      seq.clips.filter(function (c) { return c.trackId === tid && c.start < at && c.start + c.dur > at; })
        .forEach(function (c) { var r = T.split(seq, c, at); if (r) r.link = null; });
      seq.clips.forEach(function (c) { if (c.trackId === tid && c.start >= at) c.start += len; });
    });
  };
  T.unlockedTracks = function (seq, kind) {
    return seq.tracks.filter(function (t) { return !t.lock && (!kind || t.kind === kind); }).map(function (t) { return t.id; });
  };

  // Shift clips on tracks starting at/after 'at' by -len (closing a hole of length len ending at at+len)
  T.rippleRemoveSpan = function (seq, trackIds, from, len) {
    trackIds.forEach(function (tid) {
      seq.clips.forEach(function (c) { if (c.trackId === tid && c.start >= from + len - 0) c.start -= len; });
    });
  };

  T.rippleDelete = function (seq, ids) {
    var clips = ids.map(function (id) { return P.clip(seq, id); }).filter(Boolean);
    var byTrack = {};
    clips.forEach(function (c) { (byTrack[c.trackId] = byTrack[c.trackId] || []).push([c.start, c.start + c.dur]); });
    T.removeClips(seq, ids);
    Object.keys(byTrack).forEach(function (tid) {
      // merge ranges, process from latest to earliest
      var rs = byTrack[tid].sort(function (a, b) { return a[0] - b[0]; }), merged = [];
      rs.forEach(function (r) { var l = merged[merged.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else merged.push(r.slice()); });
      for (var i = merged.length - 1; i >= 0; i--) {
        var s = merged[i][0], e = merged[i][1], len = e - s;
        // only ripple as far as there is room (stop at the nearest clip beginning inside the gap — none since removed)
        seq.clips.forEach(function (c) { if (c.trackId === tid && c.start >= e) c.start -= len; });
      }
    });
  };

  // Gap on a track at frame f: returns [start, end] or null
  T.gapAt = function (seq, trackId, f) {
    var list = P.clipsOn(seq, trackId), prevEnd = 0;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (f < c.start) return f >= prevEnd ? [prevEnd, c.start] : null;
      if (f < c.start + c.dur) return null;
      prevEnd = c.start + c.dur;
    }
    return null;
  };
  T.closeGap = function (seq, trackId, gs, ge, allTracks) {
    var len = ge - gs;
    var tids = allTracks ? T.unlockedTracks(seq) : [trackId];
    // ripple every affected track on which the gap range is empty (keeps linked A/V in sync);
    // tracks with material inside the range stay put
    var skipped = [];
    tids = tids.filter(function (tid) {
      if (tid === trackId) return true;
      var busy = seq.clips.some(function (c) { return c.trackId === tid && c.start < ge && c.start + c.dur > gs; });
      if (busy) skipped.push(tid);
      return !busy;
    });
    tids.forEach(function (tid) { seq.clips.forEach(function (c) { if (c.trackId === tid && c.start >= ge) c.start -= len; }); });
    return skipped;
  };
  T.closeGaps = function (seq, trackIds) {
    trackIds.forEach(function (tid) {
      var list = P.clipsOn(seq, tid); if (!list.length) return;
      var pos = list[0].start;
      list.forEach(function (c) { c.start = pos; pos += c.dur; });
    });
  };

  /* ---------- Move ---------- */
  // moves: [{clip, start, trackId}] ; mode 'overwrite' | 'insert'
  T.applyMoves = function (seq, moves, mode) {
    var ids = {}; moves.forEach(function (m) { ids[m.clip.id] = true; });
    if (mode === 'insert') {
      var byTrack = {}, minS = Infinity, maxE = -Infinity;
      moves.forEach(function (m) { minS = Math.min(minS, m.start); maxE = Math.max(maxE, m.start + m.clip.dur); byTrack[m.trackId] = true; });
      // lift moved clips first (they are excluded by id)
      var holder = seq.clips.filter(function (c) { return ids[c.id]; });
      seq.clips = seq.clips.filter(function (c) { return !ids[c.id]; });
      T.rippleInsert(seq, Object.keys(byTrack), minS, maxE - minS);
      holder.forEach(function (c) { seq.clips.push(c); });
      moves.forEach(function (m) { m.clip.start = m.start; m.clip.trackId = m.trackId; });
    } else {
      moves.forEach(function (m) { m.clip.start = m.start; m.clip.trackId = m.trackId; });
      moves.forEach(function (m) { T.clearRange(seq, m.trackId, m.start, m.start + m.clip.dur, ids); });
    }
    T.sortClips(seq);
  };

  /* ---------- Lift / Extract ---------- */
  T.targetTracks = function (seq) { return seq.tracks.filter(function (t) { return t.target && !t.lock; }).map(function (t) { return t.id; }); };
  T.lift = function (seq, from, to, trackIds) { trackIds.forEach(function (tid) { T.clearRange(seq, tid, from, to); }); };
  T.extract = function (seq, from, to, trackIds) {
    T.lift(seq, from, to, trackIds);
    trackIds.forEach(function (tid) { seq.clips.forEach(function (c) { if (c.trackId === tid && c.start >= to) c.start -= (to - from); }); });
  };

  /* ---------- Trim modes ---------- */
  T.rippleTrim = function (seq, clip, edge, newPos) {
    var partners = [clip];
    if (C.state.linked && clip.link) partners = P.linked(seq, clip);
    var d;
    if (edge === 'end') {
      var oldEnd = clip.start + clip.dur;
      d = T.setEnd(seq, clip, newPos);
      partners.forEach(function (p) { if (p !== clip) T.setEnd(seq, p, p.start + p.dur + d); });
      var tids = {}; partners.forEach(function (p) { tids[p.trackId] = true; });
      seq.clips.forEach(function (c) { if (tids[c.trackId] && partners.indexOf(c) < 0 && c.start >= oldEnd) c.start += d; });
    } else {
      // keep start position fixed: change in-point and shift following clips
      var oldStart = clip.start, oldEnd2 = clip.start + clip.dur;
      d = T.setStart(seq, clip, newPos); // moved left edge by d
      partners.forEach(function (p) { if (p !== clip) T.setStart(seq, p, p.start + d); });
      partners.forEach(function (p) { p.start -= d; });
      var tids2 = {}; partners.forEach(function (p) { tids2[p.trackId] = true; });
      seq.clips.forEach(function (c) { if (tids2[c.trackId] && partners.indexOf(c) < 0 && c.start >= oldEnd2) c.start -= d; });
      void oldStart;
    }
    return d;
  };
  T.neighbors = function (seq, clip) {
    var list = P.clipsOn(seq, clip.trackId), i = list.indexOf(clip);
    var prev = i > 0 && list[i - 1].start + list[i - 1].dur === clip.start ? list[i - 1] : null;
    var next = i < list.length - 1 && list[i + 1].start === clip.start + clip.dur ? list[i + 1] : null;
    return { prev: prev, next: next, prevAny: i > 0 ? list[i - 1] : null, nextAny: i < list.length - 1 ? list[i + 1] : null };
  };
  T.roll = function (seq, a, b, cut) {
    // a ends at old cut, b starts at old cut
    var la = T.endLimits(seq, a), lb = T.startLimits(seq, b);
    cut = U.clamp(Math.round(cut), Math.max(la.min, lb.min), Math.min(la.max, lb.max));
    T.setEnd(seq, a, cut); T.setStart(seq, b, cut);
    return cut;
  };
  T.slip = function (seq, clip, dFrames) {
    var m = P.media(clip.mediaId);
    if (!m || P.isStill(m) || clip.freeze != null) return;
    var span = T.srcSpan(seq, clip, clip.dur);
    var ni = clip.in + (clip.reverse ? -dFrames : -dFrames) * (T.hasRamp(clip) ? span / clip.dur : spf(seq, clip));
    clip.in = U.clamp(ni, 0, Math.max(0, m.duration - span));
  };
  // the slide offset T.slide would actually apply (no mutation)
  T.slideClamp = function (seq, clip, d, prev, next) {
    d = Math.round(d);
    if (prev) { var lp = T.endLimits(seq, prev); d = U.clamp(d, lp.min - prev.start - prev.dur, lp.max - prev.start - prev.dur); }
    else d = Math.max(d, -clip.start);
    if (next) { var ln = T.startLimits(seq, next); d = U.clamp(d, ln.min - next.start, ln.max - next.start); }
    return d;
  };
  T.slide = function (seq, clip, d, prev, next) {
    d = Math.round(d);
    if (prev) { var lp = T.endLimits(seq, prev); d = U.clamp(d, lp.min - prev.start - prev.dur, lp.max - prev.start - prev.dur); }
    else d = Math.max(d, -clip.start);
    if (next) { var ln = T.startLimits(seq, next); d = U.clamp(d, ln.min - next.start, ln.max - next.start); }
    if (prev) T.setEnd(seq, prev, prev.start + prev.dur + d);
    if (next) T.setStart(seq, next, next.start + d);
    clip.start += d;
    return d;
  };
  T.setSpeed = function (seq, clip, speed, keepDur) {
    speed = U.clamp(speed, 0.05, 20);
    if (T.hasRamp(clip)) { // scale the whole ramp so its average becomes `speed`
      var span0 = T.srcSpan(seq, clip, clip.dur), avg = span0 / Math.max(1e-6, clip.dur / seq.fps), k = speed / Math.max(1e-6, avg);
      clip.kf['tm.speed'].forEach(function (key) { key.v = Math.round(U.clamp(key.v * k, 0, 2000) * 100) / 100; });
      clip.speed = speed; if (clip.tm) clip.tm.speed = Math.round(speed * 10000) / 100;
      if (!keepDur) T.fitRampDur(seq, clip, span0);
      return;
    }
    var old = clip.speed;
    if (!keepDur) {
      var nd = Math.max(1, Math.round(clip.dur * old / speed));
      KF.scaleAll(clip, nd / clip.dur);
      clip.dur = nd;
    }
    clip.speed = speed; if (clip.tm) clip.tm.speed = Math.round(speed * 10000) / 100;
    var m = P.media(clip.mediaId);
    if (m && !P.isStill(m)) {
      var maxDur = Math.floor((m.duration - clip.in) / (speed / seq.fps));
      if (clip.dur > maxDur) clip.dur = Math.max(1, maxDur);
    }
  };
  T.rateStretch = function (seq, clip, edge, newPos) {
    var md = P.media(clip.mediaId);
    if ((md && P.isStill(md)) || clip.freeze != null) { if (edge === 'end') T.setEnd(seq, clip, newPos); else T.setStart(seq, clip, newPos); return; }
    if (T.hasRamp(clip)) { // stretch the ramp in time: keys keep their relative positions, speeds scale inversely
      var span = T.srcSpan(seq, clip, clip.dur), nd0 = Math.max(1, Math.round(edge === 'end' ? newPos - clip.start : clip.start + clip.dur - newPos)), k = clip.dur / nd0;
      clip.kf['tm.speed'].forEach(function (key) { key.f = Math.round(key.f / k); key.v = Math.round(U.clamp(key.v * k, 0, 2000) * 100) / 100; });
      if (edge === 'start') clip.start = clip.start + clip.dur - nd0;
      clip.dur = nd0; T.fitRampDur(seq, clip, span); clip.speed = U.clamp(span / (clip.dur / seq.fps), 0.05, 20);
      return;
    }
    var srcSpan = clip.dur * clip.speed; // in frames*speed
    var nd;
    if (edge === 'end') nd = Math.max(1, Math.round(newPos - clip.start));
    else nd = Math.max(1, Math.round(clip.start + clip.dur - newPos));
    var ns = srcSpan / nd;
    if (ns < 0.05 || ns > 20) return;
    KF.scaleAll(clip, nd / clip.dur);
    if (edge === 'start') clip.start = clip.start + clip.dur - nd;
    clip.dur = nd; clip.speed = ns;
  };

  /* ---------- Validation ---------- */
  T.validate = function (seq) {
    P.refreshNests();
    // transitions: drop references to missing clips; un-adjacent pairs become single-sided on b
    seq.transitions = seq.transitions.filter(function (tr) {
      var a = tr.a && P.clip(seq, tr.a), b = tr.b && P.clip(seq, tr.b);
      if (!a) tr.a = null; if (!b) tr.b = null;
      if (a && b && (a.trackId !== b.trackId || a.start + a.dur !== b.start)) { tr.a = null; a = null; }
      if (!tr.a && !tr.b) return false;
      var host = b || a;
      tr.trackId = host.trackId;
      // clamp duration
      var maxD = b && a ? Math.min(a.dur, b.dur) * 2 : (b || a).dur;
      if (a && b) {
        if (tr.align === 'start') maxD = b.dur; else if (tr.align === 'end') maxD = a.dur;
        else maxD = Math.min(a.dur, b.dur) * 2;
      }
      tr.dur = U.clamp(tr.dur, 1, Math.max(1, maxD));
      return true;
    });
    // remove duplicate transitions on the same edge
    var seen = {};
    seq.transitions = seq.transitions.filter(function (tr) { var k = (tr.a || '-') + '|' + (tr.b || '-'); if (seen[k]) return false; seen[k] = 1; return true; });
    seq.clips = seq.clips.filter(function (c) { return c.dur >= 1 && P.track(seq, c.trackId); });
    seq.clips.forEach(function (c) { if (!c.tm) c.tm = { speed: Math.round((c.speed || 1) * 10000) / 100 }; if (c.kf && c.kf['tm.speed'] && !c.kf['tm.speed'].length) delete c.kf['tm.speed']; });
    T.sortClips(seq);
  };

  /* ---------- Edit points ---------- */
  T.editPoints = function (seq, trackIds) {
    var s = { 0: true };
    seq.clips.forEach(function (c) { if (!trackIds || trackIds.indexOf(c.trackId) >= 0) { s[c.start] = true; s[c.start + c.dur] = true; } });
    return Object.keys(s).map(Number).sort(function (a, b) { return a - b; });
  };

  /* ---------- Clipboard ---------- */
  T.copy = function (seq, clips) {
    if (!clips.length) return null;
    var minS = Math.min.apply(null, clips.map(function (c) { return c.start; }));
    var trs = seq.transitions.filter(function (tr) {
      var ids = clips.map(function (c) { return c.id; });
      return (!tr.a || ids.indexOf(tr.a) >= 0) && (!tr.b || ids.indexOf(tr.b) >= 0);
    });
    return {
      clips: clips.map(function (c) {
        var t = P.track(seq, c.trackId), list = t.kind === 'video' ? P.vtracks(seq) : P.atracks(seq);
        var o = U.clone(c); o._off = c.start - minS; o._tk = t.kind; o._ti = list.indexOf(t); return o;
      }),
      transitions: U.clone(trs)
    };
  };
  T.paste = function (seq, cb, at, insert) {
    if (!cb) return [];
    var idMap = {}, linkMap = {}, out = [];
    var span = 0;
    cb.clips.forEach(function (o) { span = Math.max(span, o._off + o.dur); });
    var made = cb.clips.map(function (o) {
      var c = U.clone(o);
      var list = o._tk === 'video' ? P.vtracks(seq) : P.atracks(seq);
      while (list.length <= o._ti) { var nt = P.newTrack(o._tk); seq.tracks.push(nt); list = o._tk === 'video' ? P.vtracks(seq) : P.atracks(seq); }
      c.trackId = list[o._ti].id;
      c.start = at + o._off;
      idMap[o.id] = c.id = U.uid('c');
      if (o.link) { linkMap[o.link] = linkMap[o.link] || U.uid('lk'); c.link = linkMap[o.link]; }
      delete c._off; delete c._tk; delete c._ti;
      return c;
    });
    if (insert) {
      var tids = {}; made.forEach(function (c) { tids[c.trackId] = true; });
      T.rippleInsert(seq, Object.keys(tids), at, span);
    } else {
      made.forEach(function (c) { T.clearRange(seq, c.trackId, c.start, c.start + c.dur); });
    }
    made.forEach(function (c) { seq.clips.push(c); out.push(c); });
    (cb.transitions || []).forEach(function (tr) {
      var n = U.clone(tr); n.id = U.uid('tr'); n.a = tr.a ? idMap[tr.a] || null : null; n.b = tr.b ? idMap[tr.b] || null : null;
      if (n.a || n.b) seq.transitions.push(n);
    });
    T.sortClips(seq);
    return out;
  };

  /* ---------- Source edits (insert/overwrite from the source monitor) ---------- */
  // opts: {media, inSec, outSec, at, mode:'insert'|'overwrite', video:true, audio:true}
  T.sourceEdit = function (seq, opts) {
    var m = opts.media, fps = seq.fps;
    var vt = P.vtracks(seq).filter(function (t) { return t.target && !t.lock; })[0];
    var at = P.atracks(seq).filter(function (t) { return t.target && !t.lock; })[0];
    var wantV = opts.video !== false && P.mediaHasVideo(m) && vt;
    var wantA = opts.audio !== false && P.mediaHasAudio(m) && at;
    if (!wantV && !wantA) return null;
    var durF;
    if (P.isStill(m) && opts.outSec == null) durF = Math.round((m.stillDur || C.prefs.stillDur) * fps);
    else durF = Math.max(1, Math.round(((opts.outSec != null ? opts.outSec : m.duration) - (opts.inSec || 0)) * fps));
    var start = opts.at;
    if (opts.mode === 'insert') {
      T.rippleInsert(seq, T.unlockedTracks(seq), start, durF);
    } else {
      if (wantV) T.clearRange(seq, vt.id, start, start + durF);
      if (wantA) T.clearRange(seq, at.id, start, start + durF);
    }
    var link = wantV && wantA ? U.uid('lk') : null, made = [];
    if (wantV) { var cv = P.newClip(seq, m, 'video', vt.id, start, durF, opts.inSec || 0); cv.link = link; seq.clips.push(cv); made.push(cv); }
    if (wantA) { var ca = P.newClip(seq, m, 'audio', at.id, start, durF, opts.inSec || 0); ca.link = link; seq.clips.push(ca); made.push(ca); }
    T.sortClips(seq);
    return made;
  };
  // Add media to specific tracks (used by drag-and-drop)
  T.placeMedia = function (seq, m, start, vTrackId, aTrackId, mode, inSec, outSec) {
    var fps = seq.fps, durF;
    if (inSec == null && outSec == null && m.sub) { inSec = m.sub.in; outSec = m.sub.out; } // subclip: its source range
    if (P.isStill(m)) { durF = Math.round((m.stillDur || C.prefs.stillDur) * fps); if (outSec != null) durF = Math.max(1, Math.round((outSec - (inSec || 0)) * fps)); inSec = 0; } // stills: an explicit In/Out (source marks) sets the length
    else durF = Math.max(1, Math.round(((outSec != null ? outSec : m.duration) - (inSec || 0)) * fps));
    var tids = []; if (vTrackId) tids.push(vTrackId); if (aTrackId) tids.push(aTrackId);
    if (mode === 'insert') T.rippleInsert(seq, tids, start, durF);
    else tids.forEach(function (tid) { T.clearRange(seq, tid, start, start + durF); });
    var link = vTrackId && aTrackId ? U.uid('lk') : null, made = [];
    if (vTrackId) { var cv = P.newClip(seq, m, 'video', vTrackId, start, durF, inSec || 0); cv.link = link; seq.clips.push(cv); made.push(cv); }
    if (aTrackId) { var ca = P.newClip(seq, m, 'audio', aTrackId, start, durF, inSec || 0); ca.link = link; seq.clips.push(ca); made.push(ca); }
    T.sortClips(seq);
    return made;
  };
})();
