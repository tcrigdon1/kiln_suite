/* Cutline — motion analysis shared by mask tracking (Masks › Track) and Steady Cam: phase correlation between two
   grayscale windows (a 2-D FFT on 64×64 / 128×128 tiles), and a frame sampler that steps a hidden <video> through a
   clip's source range. Pure functions (fft2, phaseCorr) have no DOM dependency so they can be unit-tested. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, P = C.P, KF = C.KF;
  var TK = C.Tracker = {};

  // in-place complex FFT (radix-2) of re/im arrays of length n (power of two); inverse when inv
  function fft1(re, im, n, inv) {
    for (var i = 1, j = 0; i < n; i++) { // bit reversal
      var bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
      if (i < j) { var t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = 2 * Math.PI / len * (inv ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang);
      for (var s = 0; s < n; s += len) {
        var cr = 1, ci = 0;
        for (var k = 0; k < len / 2; k++) {
          var a = s + k, b = a + len / 2;
          var xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          var ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
    if (inv) for (var q = 0; q < n; q++) { re[q] /= n; im[q] /= n; }
  }
  // 2-D FFT of an n×n image (row-major Float32Array) -> { re, im }
  TK.fft2 = function (px, n, inv, im0) {
    var re = new Float32Array(px), im = im0 ? new Float32Array(im0) : new Float32Array(n * n), r = new Float32Array(n), ii = new Float32Array(n), x, y;
    for (y = 0; y < n; y++) { for (x = 0; x < n; x++) { r[x] = re[y * n + x]; ii[x] = im[y * n + x]; } fft1(r, ii, n, inv); for (x = 0; x < n; x++) { re[y * n + x] = r[x]; im[y * n + x] = ii[x]; } }
    for (x = 0; x < n; x++) { for (y = 0; y < n; y++) { r[y] = re[y * n + x]; ii[y] = im[y * n + x]; } fft1(r, ii, n, inv); for (y = 0; y < n; y++) { re[y * n + x] = r[y]; im[y * n + x] = ii[y]; } }
    return { re: re, im: im };
  };
  // Hann-windowed, mean-removed copy of a grayscale tile
  TK.window = function (px, n) {
    var out = new Float32Array(n * n), mean = 0, i;
    for (i = 0; i < n * n; i++) mean += px[i]; mean /= n * n;
    for (var y = 0; y < n; y++) { var wy = 0.5 - 0.5 * Math.cos(2 * Math.PI * (y + 0.5) / n); for (var x = 0; x < n; x++) { var wx = 0.5 - 0.5 * Math.cos(2 * Math.PI * (x + 0.5) / n); out[y * n + x] = (px[y * n + x] - mean) * wx * wy; } }
    return out;
  };
  // displacement (dx, dy) of tile b relative to tile a (b ≈ a shifted by +dx,+dy), with a peak-sharpness score 0..1
  TK.phaseCorr = function (a, b, n) {
    var A = TK.fft2(TK.window(a, n), n, false), B = TK.fft2(TK.window(b, n), n, false);
    var re = new Float32Array(n * n), im = new Float32Array(n * n), mx = 0, i, pr, pi;
    for (i = 0; i < n * n; i++) { // B · conj(A)
      pr = B.re[i] * A.re[i] + B.im[i] * A.im[i]; pi = B.im[i] * A.re[i] - B.re[i] * A.im[i];
      re[i] = pr; im[i] = pi; var mg = Math.hypot(pr, pi); if (mg > mx) mx = mg;
    }
    // normalise to the phase, regularised so near-empty spectral bins (noise) do not dominate the peak
    var eps = mx * 2e-3 + 1e-12;
    for (i = 0; i < n * n; i++) { var mag = Math.hypot(re[i], im[i]) + eps; re[i] /= mag; im[i] /= mag; }
    var R = TK.fft2(re, n, true, im), best = -Infinity, bi = 0, sq = 0;
    for (var k = 0; k < n * n; k++) { var v = R.re[k]; sq += v * v; if (v > best) { best = v; bi = k; } }
    var psr = best / (Math.sqrt(sq / (n * n)) || 1e-9); // peak-to-RMS ratio: ~3-5 for unrelated tiles, 10+ for a real match
    var py = Math.floor(bi / n), px = bi % n;
    // sub-pixel refinement with a parabola through the neighbours (wrapping)
    function at(x, y) { return R.re[((y + n) % n) * n + ((x + n) % n)]; }
    var dxs = 0, dys = 0, l = at(px - 1, py), r = at(px + 1, py), u = at(px, py - 1), d = at(px, py + 1);
    var den = l - 2 * best + r; if (den < -1e-9) dxs = U.clamp(0.5 * (l - r) / den, -0.5, 0.5);
    den = u - 2 * best + d; if (den < -1e-9) dys = U.clamp(0.5 * (u - d) / den, -0.5, 0.5);
    var dx = px > n / 2 ? px - n : px, dy = py > n / 2 ? py - n : py;
    return { dx: dx + dxs, dy: dy + dys, score: U.clamp((psr - 4) / 16, 0, 1), psr: psr, peak: best };
  };

  // grayscale n×n tile of a drawable (video / canvas) region: source rect (sx, sy, sw, sh) in the drawable's px
  var tileCanvas = null;
  TK.tile = function (el, sx, sy, sw, sh, n) {
    var cv = tileCanvas || (tileCanvas = document.createElement('canvas'));
    if (cv.width !== n || cv.height !== n) { cv.width = n; cv.height = n; }
    var g = cv.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#000'; g.fillRect(0, 0, n, n);
    try { g.drawImage(el, sx, sy, sw, sh, 0, 0, n, n); } catch (e) { return null; }
    var d = g.getImageData(0, 0, n, n).data, out = new Float32Array(n * n);
    for (var i = 0; i < n * n; i++) out[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255;
    return out;
  };

  // Step a hidden video through the clip: cb(el, seqFrame, localFrame, index, count) per sampled frame (may return a
  // promise). Frames are sampled every `step` sequence frames from lf0 towards the clip end (dir>0) or start (dir<0).
  TK.sampleClip = function (seq, clip, lf0, dir, opts, cb) {
    var m = P.media(clip.mediaId), base = m && C.Media.base(m), rt = base && C.MRT[base.id];
    if (!m || m.type !== 'video' || !rt || !rt.url) return Promise.reject(new Error('The clip has no video file to analyse'));
    var span = dir > 0 ? clip.dur - 1 - lf0 : lf0, maxN = opts.maxSamples || 450, step = Math.max(1, Math.ceil(span / maxN)), n = Math.floor(span / step) + 1;
    var v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = rt.url;
    opts.cancel = opts.cancel || {};
    return C.Media.waitEvent(v, 'loadeddata', 'error', 20000).then(function () {
      var i = 0;
      function next() {
        if (i >= n || opts.cancel.v) return Promise.resolve(i);
        // aim at the middle of the source frame: seeking exactly onto a frame's timestamp can land on the previous one
        var lf = lf0 + dir * i * step, half = base.fps > 0 ? 0.45 / base.fps : 0.01;
        var t = U.clamp(P.sourceSec(seq, clip, clip.start + lf) + half, 0, Math.max(0, (base.duration || m.duration) - 0.05));
        return C.Media.seekTo(v, t).then(function () { return cb(v, clip.start + lf, lf, i, n); }).then(function () { i++; if (opts.onProgress) opts.onProgress(i / n); return next(); });
      }
      return next();
    }).then(function (done) { try { v.removeAttribute('src'); v.load(); } catch (e) { } return { samples: done, step: step }; },
      function (e) { try { v.removeAttribute('src'); v.load(); } catch (x) { } throw e; });
  };

  /* ---------- Mask tracking ---------- */
  // Follows the picture under a mask from the playhead to the clip's end (dir>0) or start (dir<0), writing
  // cx/cy keyframes (and, with opts.scale, w/h keys from the tile's apparent zoom). Returns a promise.
  TK.trackMask = function (seq, clip, maskId, lf0, dir, opts) {
    opts = opts || {};
    var m0 = C.Masks.eval(clip, lf0).filter(function (x) { return x.id === maskId; })[0];
    if (!m0) return Promise.reject(new Error('mask not found'));
    var media = P.media(clip.mediaId), sw = media.w || seq.w, sh = media.h || seq.h, N = 64;
    var xf = m0.type === 'path' ? C.Masks.pathXform(m0, sw, sh) : null;
    var cx = xf ? xf.centre[0] : m0.cx / 100 * sw, cy = xf ? xf.centre[1] : m0.cy / 100 * sh;
    // window: a little larger than the mask's bounding box so its surroundings help the match
    var bw, bh;
    if (m0.type === 'path') { var xs = m0.pts.map(function (p) { return xf.fwd(p)[0]; }), ys = m0.pts.map(function (p) { return xf.fwd(p)[1]; }); bw = Math.max.apply(null, xs) - Math.min.apply(null, xs); bh = Math.max.apply(null, ys) - Math.min.apply(null, ys); }
    else { bw = m0.w / 100 * sw; bh = m0.h / 100 * sh; }
    var win = U.clamp(Math.max(bw, bh) * 1.5, 48, Math.min(sw, sh)), prev = null, prevOrg = null, lost = 0, cid = clip.id, keys = [];
    // weight the tile by the mask's own shape (soft edge) so the picture inside the mask drives the match, not its surroundings
    var wt = new Float32Array(N * N), poly = C.Masks.outline(m0, sw, sh), wx0 = cx - win / 2, wy0 = cy - win / 2, kk = win / N;
    function inPoly(x, y) { var inside = false; for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) { var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside; } return inside; }
    for (var ty = 0; ty < N; ty++) for (var tx = 0; tx < N; tx++) {
      var px = wx0 + (tx + 0.5) * kk, py = wy0 + (ty + 0.5) * kk, v = inPoly(px, py) ? 1 : 0;
      // soft margin: sample 4 neighbours a few px out
      if (!v) { var d = kk * 3, n2 = 0; if (inPoly(px - d, py)) n2++; if (inPoly(px + d, py)) n2++; if (inPoly(px, py - d)) n2++; if (inPoly(px, py + d)) n2++; v = n2 / 4 * 0.6; }
      wt[ty * N + tx] = v;
    }
    function weighted(t) { var o = new Float32Array(N * N), mean = 0, i; for (i = 0; i < N * N; i++) mean += t[i]; mean /= N * N; for (i = 0; i < N * N; i++) o[i] = (t[i] - mean) * wt[i]; return o; }
    var startCx = m0.cx == null ? 50 : m0.cx, startCy = m0.cy == null ? 50 : m0.cy, offX = 0, offY = 0;
    keys.push({ lf: lf0, cx: startCx, cy: startCy });
    return TK.sampleClip(seq, clip, lf0, dir, opts, function (el, f, lf, i) {
      var org = [cx - win / 2, cy - win / 2], tile = TK.tile(el, org[0], org[1], win, win, N); if (!tile) return;
      tile = weighted(tile);
      if (prev) {
        // the window followed the mask between the two samples: the measured shift is relative to that move
        var r = TK.phaseCorr(prev, tile, N), k = win / N, mx = r.dx * k + (org[0] - prevOrg[0]), my = r.dy * k + (org[1] - prevOrg[1]);
        if (r.score < 0.08 || Math.abs(r.dx) > N * 0.35 || Math.abs(r.dy) > N * 0.35) { lost++; } // weak / implausible match: hold position
        else { lost = 0; cx += mx; cy += my; offX += mx; offY += my; }
        keys.push({ lf: lf, cx: startCx + offX / sw * 100, cy: startCy + offY / sh * 100 });
      }
      prev = tile; prevOrg = org;
    }).then(function (info) {
      if (keys.length < 2) throw new Error('Nothing to track in that direction');
      C.edit('Track Mask', function (s2) {
        var cc = P.clip(s2, cid); if (!cc) return;
        cc.kf = cc.kf || {};
        ['cx', 'cy'].forEach(function (k) {
          var path = 'mk.' + maskId + '.' + k, old = (cc.kf[path] || []).filter(function (q) { return dir > 0 ? q.f < lf0 : q.f > lf0; });
          cc.kf[path] = KF.sort(old.concat(keys.map(function (q) { return { f: Math.round(q.lf), v: U.round(q[k], 3), e: 'linear' }; })));
        });
      });
      return { keys: keys.length, step: info.step, lost: lost };
    });
  };
})();
/* ---------- Steady Cam (stabilisation-lite) ---------- */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, P = C.P, KF = C.KF, TK = C.Tracker;
  // Estimate the camera's global translation per sampled frame (phase correlation of the whole, downsampled picture),
  // smooth that path, and write Position keyframes that cancel the difference, plus a static zoom that hides the
  // moving borders. Options: smooth (frames, radius of the smoothing window), maxZoom (%, e.g. 125), onProgress, cancel.
  TK.steadyCam = function (seq, clip, opts) {
    opts = opts || {};
    var media = P.media(clip.mediaId), sw = media.w || seq.w, sh = media.h || seq.h, N = 128, prev = null, raw = [[0, 0]], frames = [0], cid = clip.id;
    var ox = 0, oy = 0;
    return TK.sampleClip(seq, clip, 0, 1, { maxSamples: opts.maxSamples || 600, cancel: opts.cancel, onProgress: opts.onProgress }, function (el, f, lf, i) {
      var tile = TK.tile(el, 0, 0, sw, sh, N); if (!tile) return;
      if (prev) {
        var r = TK.phaseCorr(prev, tile, N);
        if (r.score >= 0.05 && Math.abs(r.dx) < N * 0.3 && Math.abs(r.dy) < N * 0.3) { ox += r.dx * sw / N; oy += r.dy * sh / N; }
        raw.push([ox, oy]); frames.push(lf);
      }
      prev = tile;
    }).then(function (info) {
      if (raw.length < 3) throw new Error('The clip is too short to stabilise');
      var step = info.step, rad = Math.max(1, Math.round((opts.smooth || 20) / step)), n = raw.length, sm = [];
      for (var i = 0; i < n; i++) { // Gaussian-weighted moving average of the camera path
        var sx = 0, sy = 0, wsum = 0;
        for (var j = -rad; j <= rad; j++) { var k = U.clamp(i + j, 0, n - 1), w = Math.exp(-(j * j) / (2 * (rad / 2) * (rad / 2) + 1e-9)); sx += raw[k][0] * w; sy += raw[k][1] * w; wsum += w; }
        sm.push([sx / wsum, sy / wsum]);
      }
      // correction (source px) = smoothed − raw; the zoom must cover the largest correction on each axis
      var corr = raw.map(function (r, i) { return [sm[i][0] - r[0], sm[i][1] - r[1]]; }), mx = 0, my = 0;
      corr.forEach(function (c) { mx = Math.max(mx, Math.abs(c[0])); my = Math.max(my, Math.abs(c[1])); });
      var maxZoom = Math.max(1, (opts.maxZoom || 125) / 100), zoom = Math.min(maxZoom, Math.max(1 + 2 * mx / sw, 1 + 2 * my / sh) * 1.02);
      var limX = (zoom - 1) * sw / 2, limY = (zoom - 1) * sh / 2; // what the zoom can hide
      corr = corr.map(function (c) { return [U.clamp(c[0], -limX, limX), U.clamp(c[1], -limY, limY)]; });
      C.edit('Steady Cam', function (s2) {
        var cc = P.clip(s2, cid); if (!cc) return;
        var st = cc.stab || {}, tf = cc.tf, scale0 = st.scale0 != null ? st.scale0 : tf.scale;
        cc.kf = cc.kf || {};
        tf.scale = U.round(scale0 * zoom, 2);
        var q = C.Scene.quad(s2, { clip: cc, media: media, tf: C.Scene.evalTransform(cc, 0) }), kx = q.sx, ky = q.sy; // seq px per source px
        var bx = st.x0 != null ? st.x0 : tf.x, by = st.y0 != null ? st.y0 : tf.y;
        cc.kf['tf.x'] = corr.map(function (c, i) { return { f: frames[i], v: U.round(bx + c[0] * kx, 2), e: 'linear' }; });
        cc.kf['tf.y'] = corr.map(function (c, i) { return { f: frames[i], v: U.round(by + c[1] * ky, 2), e: 'linear' }; });
        cc.stab = { smooth: opts.smooth || 20, maxZoom: opts.maxZoom || 125, zoom: U.round(zoom * 100, 1), scale0: scale0, x0: bx, y0: by, samples: n, step: step };
      });
      return { samples: n, step: step, zoom: zoom, maxShift: Math.max(mx, my) };
    });
  };
  TK.removeSteadyCam = function (clip) {
    var st = clip.stab; if (!st) return;
    if (clip.kf) { delete clip.kf['tf.x']; delete clip.kf['tf.y']; }
    if (st.scale0 != null) clip.tf.scale = st.scale0;
    if (st.x0 != null) clip.tf.x = st.x0; if (st.y0 != null) clip.tf.y = st.y0;
    delete clip.stab;
  };
})();
