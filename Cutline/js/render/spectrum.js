/* Cutline — Audio Spectrum generator: bars / mirror / line / ring that react to the audio clip playing under the
   generator clip (or a chosen media item).  Analysis = 2048-point FFT every 1/60 s over the 10-second audio
   chunks the streamer already caches, folded into 64 log-spaced bands, cached per media chunk. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, P = C.P;
  var SP = C.Spectrum = { NB: 64, HOP: 1 / 60, N: 2048, cache: {}, pending: {} };

  /* ---------- FFT ---------- */
  var N = SP.N, rev = new Uint32Array(N), cs = new Float32Array(N / 2), sn = new Float32Array(N / 2), win = new Float32Array(N);
  (function () { var bits = Math.log2(N); for (var i = 0; i < N; i++) { var r = 0, x = i; for (var b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); } for (var k = 0; k < N / 2; k++) { cs[k] = Math.cos(2 * Math.PI * k / N); sn[k] = Math.sin(2 * Math.PI * k / N); } })();
  var re = new Float32Array(N), im = new Float32Array(N);
  function fftMag(src, off, mags) {
    for (var i = 0; i < N; i++) { var j = rev[i]; re[i] = (src[off + j] || 0) * win[j]; im[i] = 0; }
    for (var s = 2; s <= N; s <<= 1) { var h = s >> 1, step = N / s; for (var k = 0; k < N; k += s) for (var q = 0; q < h; q++) { var wr = cs[q * step], wi = -sn[q * step], a = k + q, b = a + h, tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; } }
    for (var m = 0; m < N / 2; m++) mags[m] = Math.hypot(re[m], im[m]) / (N / 4);
  }
  // 64 log-spaced band edges (bins) between 40 Hz and min(16 kHz, Nyquist)
  function bandEdges(sr) {
    var lo = 40, hi = Math.min(16000, sr / 2), e = new Int32Array(SP.NB + 1);
    for (var i = 0; i <= SP.NB; i++) { var f = lo * Math.pow(hi / lo, i / SP.NB); e[i] = Math.max(1, Math.min(N / 2 - 1, Math.round(f / sr * N))); }
    for (var k = 1; k <= SP.NB; k++) if (e[k] <= e[k - 1]) e[k] = e[k - 1] + 1;
    return e;
  }
  // analyse an AudioBuffer region [t0, t1) (seconds within the buffer) → Float32Array(hops × NB) of 0..1 levels
  SP.analyse = function (buf, t0, t1) {
    var sr = buf.sampleRate, n = buf.length, ch = buf.numberOfChannels, mono = new Float32Array(n);
    for (var c = 0; c < ch; c++) { var d = buf.getChannelData(c); for (var i = 0; i < n; i++) mono[i] += d[i] / ch; }
    var hopS = Math.round(SP.HOP * sr), hops = Math.max(1, Math.floor((t1 - t0) / SP.HOP)), out = new Float32Array(hops * SP.NB), mags = new Float32Array(N / 2), edges = bandEdges(sr);
    for (var hI = 0; hI < hops; hI++) {
      var centre = Math.round((t0 + hI * SP.HOP) * sr), off = centre - N / 2;
      if (off < 0 || off + N > n) { // pad edges
        var tmp = new Float32Array(N); for (var k = 0; k < N; k++) { var idx = off + k; tmp[k] = idx >= 0 && idx < n ? mono[idx] : 0; } fftMag(tmp, 0, mags);
      } else fftMag(mono, off, mags);
      for (var b = 0; b < SP.NB; b++) { var s = 0, cnt = 0; for (var q = edges[b]; q < edges[b + 1]; q++) { s += mags[q]; cnt++; } var m = cnt ? s / cnt : 0; var db = 20 * Math.log10(m + 1e-7); out[hI * SP.NB + b] = Math.max(0, Math.min(1, (db + 54) / 54)); }
    }
    return { hops: hops, data: out, t0: t0 };
  };

  /* ---------- per-media chunk cache ---------- */
  function base(m) { return C.Media.base ? C.Media.base(m) : m; }
  SP.ensure = function (m, tSec) {
    m = base(m); var rt = C.MRT[m.id]; if (!rt) return Promise.resolve(null);
    var i = Math.max(0, Math.floor(tSec / C.AudioStream.CHUNK)), key = m.id + ':' + i;
    var c = SP.cache[m.id] = SP.cache[m.id] || {};
    if (c[i]) return Promise.resolve(c[i]);
    if (SP.pending[key]) return SP.pending[key];
    var p;
    if (C.AudioStream.isStreamed(m)) p = C.AudioStream.chunk(m, i).then(function (buf) { return SP.analyse(buf, 0, buf.length / buf.sampleRate); }).then(function (r) { r.start = i * C.AudioStream.CHUNK; return r; });
    else if (rt.buffer) p = Promise.resolve(SP.analyse(rt.buffer, i * C.AudioStream.CHUNK, Math.min(rt.buffer.duration, (i + 1) * C.AudioStream.CHUNK))).then(function (r) { r.start = i * C.AudioStream.CHUNK; return r; });
    else return Promise.resolve(null);
    SP.pending[key] = p.then(function (r) { c[i] = r; delete SP.pending[key]; var ks = Object.keys(c); if (ks.length > 90) delete c[ks[0]]; return r; }, function () { delete SP.pending[key]; return null; });
    return SP.pending[key];
  };
  // levels at tSec: Float32Array(n) folded from the 64 bands, averaged over `smooth` hops around t
  SP.bandsAt = function (m, tSec, n, smooth) {
    m = base(m); var c = SP.cache[m.id]; if (!c) return null;
    var i = Math.floor(tSec / C.AudioStream.CHUNK), rec = c[i]; if (!rec) return null;
    var h0 = Math.round((tSec - rec.start) / SP.HOP), k = Math.max(0, Math.round(smooth)), out = new Float32Array(n), cnt = 0;
    for (var hh = h0 - k; hh <= h0; hh++) {
      var r2 = rec, hi = hh;
      if (hh < 0) { r2 = c[i - 1]; if (!r2) continue; hi = r2.hops + hh; } if (hi >= r2.hops) continue;
      var o = hi * SP.NB;
      for (var b = 0; b < n; b++) { var a = Math.floor(b * SP.NB / n), e = Math.max(a + 1, Math.floor((b + 1) * SP.NB / n)), s = 0; for (var q = a; q < e; q++) s += r2.data[o + q]; out[b] += s / (e - a); }
      cnt++;
    }
    if (!cnt) return null;
    for (var z = 0; z < n; z++) out[z] /= cnt;
    return out;
  };
  // which audio plays under frame f: the chosen media, or the first audio clip there (longest wins)
  SP.audioUnder = function (seq, f, gen) {
    var best = null;
    seq.clips.forEach(function (c) {
      if (c.kind !== 'audio' || c.enabled === false || f < c.start || f >= c.start + c.dur) return;
      var m = c.mediaId && P.media(c.mediaId); if (!m) return;
      if (gen.source && base(m).id !== gen.source) return;
      if (!best || c.dur > best.c.dur) best = { c: c, m: base(m) };
    });
    if (!best) return null;
    var spf = best.c.speed / seq.fps, lf = f - best.c.start;
    return { m: best.m, t: best.c.in + (best.c.reverse ? (best.c.dur - 1 - lf) : lf) * spf };
  };
  SP.prepare = function (seq, f, gen) {
    var au = SP.audioUnder(seq, f, gen); if (!au) return Promise.resolve();
    var jobs = [SP.ensure(au.m, au.t)];
    if (au.t % C.AudioStream.CHUNK > C.AudioStream.CHUNK - 0.5) jobs.push(SP.ensure(au.m, au.t + 0.5));
    return Promise.all(jobs);
  };

  /* ---------- drawing ---------- */
  SP.draw = function (g, gen, w, h, opts) {
    var seq = opts && opts.seq, f = opts ? opts.frame : 0;
    var n = Math.max(4, Math.min(256, gen.bands || 48)), levels = null;
    if (seq) {
      var au = SP.audioUnder(seq, f, gen);
      if (au) {
        levels = SP.bandsAt(au.m, au.t, n, (gen.smooth || 0) / 100 * 8);
        // live playback renders without prepare(): analyse on demand and redraw once the chunk is ready; also
        // start the next chunk early so playback never waits at a 10-second boundary
        if (!levels) SP.ensure(au.m, au.t).then(function (r) { if (r && C.Engine && !C.Engine.playing) { if (C.Engine.renderNow) C.Engine.renderNow(); else C.bus.emit('changed', { live: true }); } });
        else if (au.t % C.AudioStream.CHUNK > C.AudioStream.CHUNK - 1.5) SP.ensure(au.m, au.t + 1.5);
      }
    }
    if (!levels) levels = new Float32Array(n);
    var gain = (gen.gain == null ? 100 : gen.gain) / 100, hh = h * ((gen.height == null ? 50 : gen.height) / 100), gap = (gen.gap == null ? 30 : gen.gap) / 100;
    if (gen.bg && gen.bg !== 'transparent') { g.fillStyle = gen.bg; g.fillRect(0, 0, w, h); }
    var col = gen.color || '#f0913a', col2 = gen.color2 || col, useGrad = gen.gradient !== false && col2 !== col;
    var style = gen.style || 'bars', pos = gen.pos || 'bottom';
    var baseY = pos === 'top' ? 0 : pos === 'center' ? h / 2 : h;
    var fill = function (y0, y1) { if (!useGrad) return col; var gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, col2); gr.addColorStop(1, col); return gr; };
    g.lineCap = 'round'; g.lineJoin = 'round';
    if (style === 'ring') {
      var cx = w / 2, cy = h / 2, r0 = Math.min(w, h) * 0.22, rmax = Math.min(w, h) * 0.5 - r0;
      g.lineWidth = Math.max(1.5, (2 * Math.PI * r0 / n) * (1 - gap)); g.strokeStyle = col;
      for (var i = 0; i < n; i++) { var a = -Math.PI / 2 + i / n * Math.PI * 2, v = Math.min(1, levels[i] * gain), r1 = r0 + Math.max(2, v * rmax); if (useGrad) { var gr = g.createLinearGradient(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); gr.addColorStop(0, col); gr.addColorStop(1, col2); g.strokeStyle = gr; } g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.stroke(); }
      return;
    }
    if (style === 'line') {
      g.lineWidth = Math.max(1.5, h * 0.006); g.beginPath();
      for (var j = 0; j < n; j++) { var x = (j + 0.5) / n * w, v2 = Math.min(1, levels[j] * gain), y = pos === 'top' ? v2 * hh : pos === 'center' ? h / 2 - v2 * hh / 2 : h - v2 * hh; j ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.strokeStyle = fill(baseY - (pos === 'top' ? -hh : hh), baseY); g.stroke();
      if (gen.fillUnder !== false) { g.lineTo(w, baseY === h / 2 ? h / 2 : baseY); g.lineTo(0, baseY === h / 2 ? h / 2 : baseY); g.closePath(); g.globalAlpha = 0.3; g.fillStyle = col; g.fill(); g.globalAlpha = 1; }
      return;
    }
    var bw = w / n, bwid = Math.max(1, bw * (1 - gap)), rad = gen.round === false ? 0 : Math.min(bwid / 2, 6 * (w / 1920));
    for (var k = 0; k < n; k++) {
      var v3 = Math.min(1, levels[k] * gain), bh = Math.max(2, v3 * hh), x0 = k * bw + (bw - bwid) / 2;
      if (style === 'mirror' || pos === 'center') { var yTop = h / 2 - bh / 2; g.fillStyle = fill(yTop, yTop + bh); roundRect(g, x0, yTop, bwid, bh, rad); g.fill(); }
      else if (pos === 'top') { g.fillStyle = fill(bh, 0); roundRect(g, x0, 0, bwid, bh, rad); g.fill(); }
      else { g.fillStyle = fill(h - bh, h); roundRect(g, x0, h - bh, bwid, bh, rad); g.fill(); }
    }
  };
  function roundRect(g, x, y, w, h, r) { g.beginPath(); if (!r) { g.rect(x, y, w, h); return; } r = Math.min(r, w / 2, h / 2); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  /* ---------- registration ---------- */
  C.Media.GEN_DEFAULTS.spectrum = function () { return { kind: 'spectrum', style: 'bars', bands: 48, color: '#f0913a', color2: '#3dbfae', gradient: true, height: 55, pos: 'bottom', gap: 30, smooth: 40, gain: 110, round: true, bg: 'transparent', source: null, fillUnder: true }; };
  C.Media.GEN_NAMES.spectrum = 'Audio Spectrum';
})();
