/* Cutline — loudness & audio analysis: ITU-R BS.1770 integrated loudness (K-weighting, gated), loudness normalise /
   match across a selection, onset (transient) detection with a tempo estimate for beat markers. Pure DSP functions
   (kWeight, integratedLUFS, onsets, tempo) take Float32Arrays and are unit-testable without a DOM. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, h = U.h, P = C.P;
  var LD = C.Loudness = {};

  // biquad (direct form II transposed), returns a filtered copy
  function biquad(x, b0, b1, b2, a1, a2) {
    var y = new Float32Array(x.length), z1 = 0, z2 = 0;
    for (var i = 0; i < x.length; i++) { var v = x[i], o = b0 * v + z1; z1 = b1 * v - a1 * o + z2; z2 = b2 * v - a2 * o; y[i] = o; }
    return y;
  }
  // K-weighting (BS.1770-4): high shelf + high-pass, coefficients for any sample rate
  LD.kWeight = function (x, fs) {
    var f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    var K = Math.tan(Math.PI * f0 / fs), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416), a0 = 1 + K / Q + K * K;
    var y = biquad(x, (Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0);
    f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / fs); a0 = 1 + K / Q + K * K;
    return biquad(y, 1 / a0, -2 / a0, 1 / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0);
  };
  // integrated loudness (LUFS) of channels [Float32Array...] at fs, with absolute (−70) and relative (−10 LU) gating
  LD.integratedLUFS = function (chans, fs) {
    if (!chans.length || !chans[0].length) return -Infinity;
    var kw = chans.map(function (c) { return LD.kWeight(c, fs); }), blk = Math.round(0.4 * fs), hop = Math.round(0.1 * fs), n = kw[0].length, blocks = [];
    if (n < blk) { blk = n; hop = n; }
    for (var s0 = 0; s0 + blk <= n; s0 += hop) {
      var sum = 0;
      for (var c = 0; c < kw.length; c++) { var d = kw[c], q = 0; for (var i = s0; i < s0 + blk; i++) q += d[i] * d[i]; sum += q / blk; }
      blocks.push(-0.691 + 10 * Math.log10(sum + 1e-20));
    }
    if (!blocks.length) return -Infinity;
    function meanOver(th) { var acc = 0, k = 0; blocks.forEach(function (l) { if (l > th) { acc += Math.pow(10, (l + 0.691) / 10); k++; } }); return k ? -0.691 + 10 * Math.log10(acc / k) : -Infinity; }
    var abs = meanOver(-70); if (!isFinite(abs)) return -Infinity;
    var rel = meanOver(abs - 10);
    return isFinite(rel) ? rel : abs;
  };
  // measure a clip's source range: decoded buffer when available, else the RMS pyramid of streamed media (approximate)
  LD.measureClip = function (seq, clip) {
    var m = P.media(clip.mediaId), buf = C.Media.audioBuffer(m);
    var a = clip.in, b = clip.in + clip.dur / seq.fps * clip.speed;
    if (buf) {
      var s0 = Math.max(0, Math.floor(a * buf.sampleRate)), s1 = Math.min(buf.length, Math.ceil(b * buf.sampleRate));
      if (s1 - s0 < 64) return { lufs: -Infinity, exact: true };
      // long clips: analyse at most ~90 s spread over the range (every k-th second window)
      var chans = [];
      for (var c = 0; c < Math.min(2, buf.numberOfChannels); c++) {
        var d = buf.getChannelData(c).subarray(s0, s1);
        if (d.length > buf.sampleRate * 90) { var k = Math.ceil(d.length / (buf.sampleRate * 90)), win = buf.sampleRate * 3, out = new Float32Array(Math.ceil(d.length / k)), p = 0; for (var i = 0; i + win <= d.length && p < out.length; i += win * k) { var n2 = Math.min(win, out.length - p); out.set(d.subarray(i, i + n2), p); p += n2; } d = out.subarray(0, p); }
        chans.push(d);
      }
      return { lufs: LD.integratedLUFS(chans, buf.sampleRate), exact: true };
    }
    var rt = C.MRT[C.Media.base(m).id], pk = rt && rt.peaks;
    if (pk && pk.rms && pk.rmsRate) {
      var i0 = Math.max(0, Math.floor(a * pk.rmsRate)), i1 = Math.min(pk.rmsN, Math.ceil(b * pk.rmsRate)), acc = 0, cnt = 0;
      for (var j = i0; j < i1; j++) { var r = pk.rms[j]; if (r > 3e-4) { acc += r * r; cnt++; } }
      return cnt ? { lufs: -0.691 + 10 * Math.log10(acc / cnt), exact: false } : { lufs: -Infinity, exact: false };
    }
    return null;
  };

  /* ---------- onsets / tempo ---------- */
  // energy-flux onset detection on a mono signal: returns onset times (s) and the detection envelope at `rate` Hz
  LD.onsets = function (mono, fs, opts) {
    opts = opts || {};
    var rate = 100, hop = Math.round(fs / rate), n = Math.floor(mono.length / hop), env = new Float32Array(n), i, j;
    for (i = 0; i < n; i++) { var q = 0; for (j = i * hop; j < (i + 1) * hop; j++) q += mono[j] * mono[j]; env[i] = Math.sqrt(q / hop); }
    // half-wave rectified log-energy flux
    var flux = new Float32Array(n);
    for (i = 1; i < n; i++) { var d = Math.log10(env[i] + 1e-5) - Math.log10(env[i - 1] + 1e-5); flux[i] = d > 0 ? d : 0; }
    // adaptive threshold: local mean (±0.5 s) + sensitivity-scaled offset; peak picking with a 60 ms dead time
    var sens = opts.sensitivity == null ? 50 : opts.sensitivity, offs = 0.05 + (100 - sens) / 100 * 0.45, R = Math.round(rate * 0.5), out = [], last = -1e9;
    for (i = 1; i < n - 1; i++) {
      var a0 = Math.max(0, i - R), a1 = Math.min(n, i + R), mean = 0; for (j = a0; j < a1; j++) mean += flux[j]; mean /= (a1 - a0);
      if (flux[i] > mean + offs && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1] && env[i] > 0.003 && (i - last) >= rate * 0.06) { out.push(i / rate); last = i; }
    }
    return { times: out, env: env, flux: flux, rate: rate };
  };
  // tempo (BPM) from the flux envelope by autocorrelation in the 60–200 BPM range, plus the beat phase
  LD.tempo = function (flux, rate) {
    var n = flux.length, best = 0, bestLag = 0, minLag = Math.round(rate * 60 / 200), maxLag = Math.round(rate * 60 / 60);
    if (n < maxLag * 2) return null;
    var mean = 0; for (var i = 0; i < n; i++) mean += flux[i]; mean /= n;
    for (var lag = minLag; lag <= maxLag; lag++) {
      var acc = 0; for (var k = 0; k + lag < n; k++) acc += (flux[k] - mean) * (flux[k + lag] - mean);
      acc /= (n - lag);
      // mild preference for ~120 BPM over its half/double
      var bpm = 60 * rate / lag, w = 1 - Math.min(0.3, Math.abs(Math.log2(bpm / 120)) * 0.15);
      if (acc * w > best) { best = acc * w; bestLag = lag; }
    }
    if (!bestLag || best <= 0) return null;
    // phase: offset (in samples) whose comb of beats collects the most flux
    var bestPh = 0, bestSum = -1;
    for (var ph = 0; ph < bestLag; ph++) { var s = 0, c = 0; for (var t = ph; t < n; t += bestLag) { s += flux[t]; c++; } if (c && s / c > bestSum) { bestSum = s / c; bestPh = ph; } }
    return { bpm: Math.round(60 * rate / bestLag * 10) / 10, period: bestLag / rate, phase: bestPh / rate };
  };
  // mono mix of a clip's source range (decoded media only)
  function clipMono(seq, clip, maxSec) {
    var m = P.media(clip.mediaId), buf = C.Media.audioBuffer(m); if (!buf) return null;
    var a = clip.in, b = Math.min(clip.in + clip.dur / seq.fps * clip.speed, a + (maxSec || 600));
    var s0 = Math.max(0, Math.floor(a * buf.sampleRate)), s1 = Math.min(buf.length, Math.ceil(b * buf.sampleRate)), n = s1 - s0;
    if (n <= 0) return null;
    var out = new Float32Array(n), ch = buf.numberOfChannels;
    for (var c = 0; c < ch; c++) { var d = buf.getChannelData(c); for (var i = 0; i < n; i++) out[i] += d[s0 + i] / ch; }
    return { data: out, fs: buf.sampleRate, t0: a };
  }

  /* ---------- actions & dialogs ---------- */
  var A = C.A;
  LD.TARGETS = [[-14, '−14 LUFS (YouTube, Spotify)'], [-16, '−16 LUFS (podcast, Apple)'], [-18, '−18 LUFS'], [-23, '−23 LUFS (EBU R128 broadcast)'], [-24, '−24 LKFS (ATSC A/85)'], ['match', 'Match the first selected clip']];
  A.loudnessDialog = function () {
    var s = P.seq(), clips = P.selectedClips().filter(function (c) { return c.kind === 'audio'; });
    if (!clips.length) { C.toast('Select audio clips to normalise'); return; }
    var prefs = U.lsGet('loudness', { target: -14 });
    var tgt = h('select'); LD.TARGETS.forEach(function (o) { tgt.appendChild(h('option', { value: o[0] }, o[1])); }); tgt.value = String(prefs.target);
    var rows = h('div', { style: { maxHeight: '220px', overflow: 'auto', fontFamily: 'var(--mono)', fontSize: '11px', lineHeight: 1.7 } });
    var measured = clips.map(function (c) { var r = LD.measureClip(s, c); return { c: c, r: r }; });
    function refresh() {
      U.clear(rows);
      var ref = tgt.value === 'match' ? (measured[0].r ? measured[0].r.lufs + (measured[0].c.au.gain || 0) : -Infinity) : +tgt.value;
      measured.forEach(function (x, i) {
        var cur = x.r ? x.r.lufs + (x.c.au.gain || 0) : null, gain = x.r && isFinite(x.r.lufs) ? U.clamp(ref - x.r.lufs, -40, 40) : null;
        rows.appendChild(h('div', U.esc(x.c.name).slice(0, 34) + '  ' + (cur == null ? 'no audio data' : (isFinite(cur) ? cur.toFixed(1) + ' LUFS' + (x.r.exact ? '' : ' (approx.)') : 'silent')) + (gain != null && isFinite(gain) ? '  →  gain ' + (gain >= 0 ? '+' : '') + gain.toFixed(1) + ' dB' : '') + (tgt.value === 'match' && i === 0 ? '  (reference)' : '')));
      });
    }
    tgt.addEventListener('change', refresh); refresh();
    var body = h('div', { style: { width: '520px', lineHeight: 1.5 } },
      h('div.muted', { style: { marginBottom: '8px' } }, 'Measures each clip\'s integrated loudness (ITU-R BS.1770, K-weighted and gated) over the part it uses, and sets the clip gain so it plays at the target. Streamed long media is measured from its RMS profile (approximate).'),
      h('div.form-grid', h('label', 'Target'), tgt), rows);
    C.ui.dialog({ title: 'Normalise Loudness — ' + clips.length + ' clip' + (clips.length > 1 ? 's' : ''), width: 580, body: body, buttons: [{ label: 'Cancel' }, { label: 'Apply', primary: true, action: function () {
      U.lsSet('loudness', { target: tgt.value === 'match' ? -14 : +tgt.value });
      var ref = tgt.value === 'match' ? (measured[0].r ? measured[0].r.lufs + (measured[0].c.au.gain || 0) : null) : +tgt.value, n = 0;
      if (ref == null || !isFinite(ref)) { C.toast('The reference clip has no measurable audio'); return; }
      C.edit(tgt.value === 'match' ? 'Match Loudness' : 'Normalise Loudness', function (s2) {
        measured.forEach(function (x) { if (!x.r || !isFinite(x.r.lufs)) return; var cc = P.clip(s2, x.c.id); if (!cc) return; cc.au.gain = Math.round(U.clamp(ref - x.r.lufs, -40, 40) * 10) / 10; n++; });
      });
      C.toast((tgt.value === 'match' ? 'Matched ' : 'Normalised ') + n + ' clip' + (n > 1 ? 's' : '') + (tgt.value === 'match' ? ' to the first clip' : ' to ' + ref + ' LUFS'));
    } }] });
  };
  A.transientMarkersDialog = function () {
    var s = P.seq(), clips = P.selectedClips().filter(function (c) { return c.kind === 'audio'; });
    if (!clips.length) { C.toast('Select an audio clip to analyse'); return; }
    var clip = clips[0], src = clipMono(s, clip, 600);
    if (!src) { C.toast('That clip\'s audio is streamed or not decoded — transient detection needs decoded audio (files under the cache limit)'); return; }
    var prefs = U.lsGet('transients', { mode: 'transients', sens: 50, where: 'seq' });
    var mode = h('select'); [['transients', 'Every transient (hits, words, cuts)'], ['beats', 'Beat grid from the detected tempo'], ['bars', 'Every 4th beat (bars)']].forEach(function (o) { mode.appendChild(h('option', { value: o[0] }, o[1])); }); mode.value = prefs.mode;
    var sens = h('input', { type: 'range', min: 0, max: 100, step: 1, value: prefs.sens, style: { width: '160px' } }), sensV = h('span.muted', prefs.sens + '');
    var where = h('select'); [['seq', 'Sequence markers'], ['clip', 'Clip markers']].forEach(function (o) { where.appendChild(h('option', { value: o[0] }, o[1])); }); where.value = prefs.where;
    var status = h('div.muted', { style: { minHeight: '18px', marginTop: '6px' } }), res = null;
    function analyse() {
      res = LD.onsets(src.data, src.fs, { sensitivity: +sens.value });
      res.tempo = LD.tempo(res.flux, res.rate);
      status.textContent = res.times.length + ' transients' + (res.tempo ? ' · tempo ≈ ' + res.tempo.bpm + ' BPM' : ' · no steady tempo found') + (src.data.length / src.fs >= 600 ? ' (first 10 minutes)' : '');
    }
    sens.addEventListener('input', function () { sensV.textContent = sens.value; analyse(); });
    analyse();
    var body = h('div', { style: { width: '500px', lineHeight: 1.5 } },
      h('div.muted', { style: { marginBottom: '8px' } }, 'Finds energy transients in ' + U.esc(clip.name) + ' and drops markers on them (or on a beat grid when a steady tempo is detected). Markers are ordinary markers: snap to them, cut on them, or navigate with Shift+M.'),
      h('div.form-grid', h('label', 'Place on'), mode, h('label', 'Sensitivity'), h('div.row', sens, sensV), h('label', 'Add as'), where), status);
    C.ui.dialog({ title: 'Beat / Transient Markers', width: 560, body: body, buttons: [{ label: 'Cancel' }, { label: 'Add Markers', primary: true, action: function () {
      U.lsSet('transients', { mode: mode.value, sens: +sens.value, where: where.value });
      var times = [];
      if (mode.value === 'transients') times = res.times;
      else if (res.tempo) { var every = mode.value === 'bars' ? 4 : 1, dur = src.data.length / src.fs; for (var t = res.tempo.phase, k = 0; t < dur; t += res.tempo.period, k++) if (k % every === 0) times.push(t); }
      if (!times.length) { C.toast('Nothing to mark'); return; }
      var fps = s.fps, n = 0;
      C.edit('Transient Markers', function (s2) {
        var cc = P.clip(s2, clip.id); if (!cc) return;
        times.forEach(function (t, i) {
          var lf = Math.round(t / cc.speed * fps); if (lf < 0 || lf >= cc.dur) return;
          var col = A.MARKER_COLORS[mode.value === 'transients' ? 1 : 4];
          if (where.value === 'clip') { cc.markers = cc.markers || []; if (!cc.markers.some(function (mk) { return mk.f === lf; })) { cc.markers.push({ id: U.uid('mk'), f: lf, name: '', color: col, note: '' }); n++; } }
          else { var f = cc.start + lf; if (!s2.markers.some(function (mk) { return mk.f === f; })) { s2.markers.push({ id: U.uid('mk'), f: f, name: mode.value === 'transients' ? '' : 'Beat ' + (i + 1), color: col, note: '', dur: 0 }); n++; } }
        });
        s2.markers.sort(function (a, b) { return a.f - b.f; });
      });
      C.toast('Added ' + n + ' marker' + (n === 1 ? '' : 's'));
    } }] });
  };
  C.CMD.reg('loudness', 'Normalise Loudness (LUFS)…', 'Clip', null, function () { A.loudnessDialog(); });
  C.CMD.reg('transients', 'Beat / Transient Markers…', 'Markers', null, function () { A.transientMarkersDialog(); });
  var prevClip = C.Menus.extra.Clip, prevMk = C.Menus.extra.Markers;
  function cmd(id) { return C.CMD.menuItem(id); }
  C.Menus.extra.Clip = function () { return (prevClip ? prevClip() : []).concat([cmd('loudness')]); };
  C.Menus.extra.Markers = function () { return (prevMk ? prevMk() : []).concat([cmd('transients')]); };
})();
