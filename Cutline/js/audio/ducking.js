/* Cutline — Auto-duck: lowers music tracks under speech. The voice tracks' loudness envelope is measured from the
   source audio (decoded buffers, or the waveform/RMS pyramid of streamed long media); wherever it rises above the
   threshold the music clips get volume keyframes (attack / hold / release ramps). The keyframes are ordinary
   'au.vol' keys flagged `d:1`, so they can be dragged, deleted or regenerated. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, h = U.h, P = C.P, KF = C.KF;
  var D = C.Duck = {};
  var RATE = 20; // envelope samples per second

  // dBFS RMS envelope (RATE Hz) of what a track plays over the sequence span
  D.trackEnvelope = function (seq, trackId, nSamples) {
    var env = new Float32Array(nSamples).fill(-96), fps = seq.fps;
    seq.clips.forEach(function (clip) {
      if (clip.trackId !== trackId || clip.kind !== 'audio' || clip.enabled === false || clip.au.mute) return;
      var m = P.media(clip.mediaId); if (!m) return;
      var buf = C.Media.audioBuffer(m), rt = C.MRT[C.Media.base(m).id] || {}, pk = rt.peaks;
      var i0 = Math.max(0, Math.floor(clip.start / fps * RATE)), i1 = Math.min(nSamples, Math.ceil((clip.start + clip.dur) / fps * RATE));
      for (var i = i0; i < i1; i++) {
        var tA = i / RATE, tB = (i + 1) / RATE, fA = tA * fps, fB = tB * fps;
        var sA = P.sourceSec(seq, clip, fA), sB = P.sourceSec(seq, clip, fB); if (sA > sB) { var t = sA; sA = sB; sB = t; }
        var lvl = -96;
        if (buf) {
          var a = Math.max(0, Math.floor(sA * buf.sampleRate)), b = Math.min(buf.length, Math.ceil(sB * buf.sampleRate)), sum = 0, n = 0;
          for (var c = 0; c < buf.numberOfChannels; c++) { var d = buf.getChannelData(c); for (var k = a; k < b; k += 4) { sum += d[k] * d[k]; n++; } }
          if (n) lvl = U.gainToDb(Math.sqrt(sum / n));
        } else if (pk && pk.rms && pk.rmsRate) {
          var r0 = Math.floor(sA * pk.rmsRate), r1 = Math.max(r0 + 1, Math.ceil(sB * pk.rmsRate)), mx = 0;
          for (var j = r0; j < r1 && j < pk.rmsN; j++) if (pk.rms[j] > mx) mx = pk.rms[j];
          lvl = U.gainToDb(mx);
        } else if (pk) { var sp = C.Media.peakSpan(pk, sA, sB, rt.loop); lvl = U.gainToDb(Math.max(-sp.lo, sp.hi) * 0.7); }
        lvl += KF.value(clip, 'au.vol', U.clamp(fA - clip.start, 0, clip.dur - 1)) + (clip.au.gain || 0);
        if (lvl > env[i]) env[i] = lvl;
      }
    });
    return env;
  };
  // speech segments [a, b] in seconds where any voice track is above the threshold (holes shorter than `hold` are bridged)
  D.segments = function (seq, voiceTracks, thresholdDb, holdSec) {
    var n = Math.ceil(P.seqDuration(seq) / seq.fps * RATE) + 1, env = new Float32Array(n).fill(-96);
    voiceTracks.forEach(function (tid) { var e = D.trackEnvelope(seq, tid, n); for (var i = 0; i < n; i++) if (e[i] > env[i]) env[i] = e[i]; });
    var segs = [], cur = null;
    for (var i = 0; i < n; i++) {
      var on = env[i] > thresholdDb;
      if (on) { if (!cur) cur = { a: i / RATE, b: (i + 1) / RATE }; else cur.b = (i + 1) / RATE; }
      else if (cur && i / RATE - cur.b >= holdSec) { segs.push(cur); cur = null; }
    }
    if (cur) segs.push(cur);
    return { segs: segs, env: env };
  };
  // apply volume keyframes to the music clips. opts: {musicTracks, voiceTracks, threshold, reduction, attack, release, hold}
  D.apply = function (seq, opts) {
    var fps = seq.fps, r = D.segments(seq, opts.voiceTracks, opts.threshold, opts.hold / 1000), segs = r.segs, count = 0, clipsTouched = 0;
    seq.clips.forEach(function (clip) {
      if (clip.kind !== 'audio' || opts.musicTracks.indexOf(clip.trackId) < 0) return;
      clip.kf = clip.kf || {};
      var old = (clip.kf['au.vol'] || []).filter(function (k) { return !k.d; }); // keep the user's own keys
      var baseAt = function (lf) { return old.length ? KF.evalKeys(old, lf) : clip.au.vol; };
      var keys = old.slice(), cs = clip.start / fps, ce = (clip.start + clip.dur) / fps, touched = false;
      function put(tSec, ducked) {
        var lf = Math.round(U.clamp(tSec * fps - clip.start, 0, clip.dur - 1));
        var v = U.round(baseAt(lf) + (ducked ? opts.reduction : 0), 1);
        for (var i = keys.length - 1; i >= 0; i--) if (keys[i].f === lf && keys[i].d) keys.splice(i, 1);
        if (keys.some(function (k) { return k.f === lf && !k.d; })) return;
        keys.push({ f: lf, v: v, e: 'linear', d: 1 }); count++; touched = true;
      }
      var at = opts.attack / 1000, rel = opts.release / 1000;
      // merge segments that are closer than attack+release so the music does not pump between words
      var merged = [];
      segs.forEach(function (s) { var l = merged[merged.length - 1]; if (l && s.a - l.b < at + rel) l.b = Math.max(l.b, s.b); else merged.push({ a: s.a, b: s.b }); });
      merged.forEach(function (s) {
        if (s.b <= cs || s.a >= ce) return;
        if (s.a - at > cs) put(s.a - at, false); else if (s.a > cs) put(cs, false);
        put(Math.max(s.a, cs), true); put(Math.min(s.b, ce - 1 / fps), true);
        if (s.b + rel < ce) put(s.b + rel, false);
      });
      if (!touched) return;
      if (!old.length && !keys.some(function (k) { return k.f === 0; })) keys.push({ f: 0, v: U.round(clip.au.vol, 1), e: 'linear', d: 1 });
      KF.sort(keys); clip.kf['au.vol'] = keys; clipsTouched++;
    });
    return { keys: count, clips: clipsTouched, segments: segs.length };
  };
  D.remove = function (seq, trackIds) {
    var n = 0;
    seq.clips.forEach(function (clip) {
      if (clip.kind !== 'audio' || (trackIds && trackIds.indexOf(clip.trackId) < 0) || !clip.kf || !clip.kf['au.vol']) return;
      var keep = clip.kf['au.vol'].filter(function (k) { return !k.d; });
      n += clip.kf['au.vol'].length - keep.length;
      if (keep.length) clip.kf['au.vol'] = keep; else delete clip.kf['au.vol'];
    });
    return n;
  };

  C.A.duckDialog = function () {
    var s = P.seq(); if (!s) return;
    var ats = P.atracks(s); if (ats.length < 2) { C.toast('Auto-duck needs at least two audio tracks (music and voice)'); return; }
    var prefs = U.lsGet('duck', { threshold: -35, reduction: -12, attack: 200, release: 600, hold: 400 });
    // defaults: music = tracks whose clips come from audio-only files, voice = tracks with video-linked audio
    var isMusic = function (t) { return s.clips.some(function (c) { return c.trackId === t.id && c.kind === 'audio' && (P.media(c.mediaId) || {}).type === 'audio'; }); };
    var isVoice = function (t) { return s.clips.some(function (c) { return c.trackId === t.id && c.kind === 'audio' && c.link; }); };
    var music = {}, voice = {};
    ats.forEach(function (t) { music[t.id] = isMusic(t) && !isVoice(t); voice[t.id] = isVoice(t) || (!isMusic(t) && s.clips.some(function (c) { return c.trackId === t.id && c.kind === 'audio'; })); if (music[t.id]) voice[t.id] = false; });
    function trackList(sel, other) {
      var box = h('div.duck-tracks');
      ats.forEach(function (t) {
        var cb = h('input', { type: 'checkbox', checked: !!sel[t.id] });
        cb.addEventListener('change', function () { sel[t.id] = cb.checked; if (cb.checked && other[t.id]) { other[t.id] = false; refresh(); } });
        var n = s.clips.filter(function (c) { return c.trackId === t.id && c.kind === 'audio'; }).length;
        box.appendChild(h('label.cl-check', cb, h('span', P.trackLabel(s, t) + '  ' + P.trackDisplayName(s, t) + '  (' + n + ' clip' + (n === 1 ? '' : 's') + ')')));
      });
      return box;
    }
    var mBox, vBox, grid;
    function num(label, key, min, max, step, unit) { var i = h('input', { type: 'number', value: prefs[key], min: min, max: max, step: step, style: { width: '80px' } }); i.addEventListener('keydown', function (e) { e.stopPropagation(); }); i.addEventListener('input', function () { prefs[key] = +i.value; }); return [h('label', label), h('div.row', i, h('span.muted', unit))]; }
    function refresh() {
      U.clear(grid);
      mBox = trackList(music, voice); vBox = trackList(voice, music);
      U.append(grid, [h('label', 'Music tracks (ducked)'), mBox, h('label', 'Voice tracks (sidechain)'), vBox]);
      U.append(grid, num('Threshold', 'threshold', -80, 0, 1, 'dBFS — voice above this triggers the duck'));
      U.append(grid, num('Reduction', 'reduction', -40, 0, 0.5, 'dB applied to the music'));
      U.append(grid, num('Attack', 'attack', 10, 2000, 10, 'ms fade down before speech'));
      U.append(grid, num('Release', 'release', 10, 4000, 10, 'ms fade back up after speech'));
      U.append(grid, num('Hold', 'hold', 0, 3000, 10, 'ms — pauses shorter than this stay ducked'));
    }
    grid = h('div.form-grid'); refresh();
    var body = h('div', { style: { width: '560px', lineHeight: 1.5 } },
      h('div.muted', { style: { marginBottom: '8px' } }, 'Writes volume keyframes on the music clips wherever the voice tracks are louder than the threshold. The keyframes are editable afterwards; running Auto-duck again replaces them (your own keyframes are kept).'),
      grid);
    C.ui.dialog({ title: 'Auto-Duck Music', width: 620, body: body, buttons: [
      { label: 'Remove Ducking', left: true, action: function () { var n = 0; C.edit('Remove Ducking', function (s2) { n = D.remove(s2); }); C.toast('Removed ' + n + ' ducking keyframes'); } },
      { label: 'Cancel' },
      { label: 'Duck', primary: true, action: function () {
        var mt = Object.keys(music).filter(function (k) { return music[k]; }), vt = Object.keys(voice).filter(function (k) { return voice[k]; });
        if (!mt.length || !vt.length) { C.toast('Pick at least one music track and one voice track'); return false; }
        U.lsSet('duck', prefs);
        var res;
        C.edit('Auto-Duck Music', function (s2) { res = D.apply(s2, { musicTracks: mt, voiceTracks: vt, threshold: prefs.threshold, reduction: prefs.reduction, attack: prefs.attack, release: prefs.release, hold: prefs.hold }); });
        if (res) C.toast(res.segments ? 'Ducked ' + res.clips + ' music clip' + (res.clips === 1 ? '' : 's') + ' under ' + res.segments + ' speech segment' + (res.segments === 1 ? '' : 's') + ' (' + res.keys + ' keyframes)' : 'No speech above ' + prefs.threshold + ' dBFS found on the voice tracks', 4000);
      } }] });
  };
})();
