/*!
 * ImageFX 1.0 — pure-JavaScript image adjustments & filters for Kiln Suite (Gesso).
 * No dependencies, no DOM, no modules. Works from file://, in Web Workers and in Node.
 *
 * ============================================================================
 *  INTERFACE
 * ============================================================================
 *  globalThis.ImageFX = {
 *    version: '1.0',
 *    adjustments: { [id]: Effect },
 *    filters:     { [id]: Effect },
 *    categories:  { filters: ['Blur','Sharpen','Noise','Stylize','Distort','Pixelate',
 *                             'Render','Artistic','Color','Other'] },
 *    defaults(effect)                          -> params object (deep-cloned ParamDef defaults)
 *    apply(idOrEffect, imageData, params?, opts?) -> ImageData
 *        Looks the id up in adjustments, then filters. Missing params are filled with
 *        defaults. NOTE: ImageFX.apply() never mutates `imageData` (it works on a clone).
 *        Calling effect.apply() directly MAY mutate and return the input.
 *    histogram(imageData, mask?) -> { r, g, b, lum, a }  (Uint32Array(256) each)
 *        Pixels with alpha 0 are excluded from r/g/b/lum. With a mask, only pixels
 *        whose mask value is >= 128 are counted.
 *    util: { clamp, rgbToHsl, hslToRgb, rgbToHsv, hsvToRgb, hexToRgb, rgbToHex,
 *            luminance, buildCurveLUT, sampleBilinear, gradientLUT,
 *            createImageData, cloneImageData, gaussianBlur }
 *  }
 *
 *  ImageData-like: { width, height, data: Uint8ClampedArray(width*height*4) } RGBA,
 *  straight (non-premultiplied) alpha.
 *
 *  Effect = { id, name, category, params: [ParamDef], apply(imageData, params, opts) }
 *    - apply() may mutate & return the same object or return a new same-size ImageData.
 *    - opts.selectionMask: Uint8ClampedArray(w*h), 0..255. Every effect's apply() is
 *      wrapped centrally (see wrapEffect) so the result is blended with the ORIGINAL
 *      pixels by the mask (255 = full effect, 0 = original). Effect authors do not need
 *      to handle the mask themselves.
 *    - opts.seed: optional number; mixed into the effect's own `seed` param (if any) so
 *      random effects are deterministic for a given (params.seed, opts.seed) pair.
 *    - Params passed to the wrapped apply() are normalised: missing keys get defaults,
 *      partial 'curve' / 'levels' values are completed.
 *
 *  ParamDef = { id, label, type, default, min?, max?, step?, options?, unit? }
 *    type: 'range' | 'number' | 'checkbox' | 'select' | 'color' ('#rrggbb') |
 *          'angle' (degrees) |
 *          'curve'    { rgb:[[x,y]..], r:[..], g:[..], b:[..] } points 0..255, sorted by x
 *          'levels'   { rgb:{inBlack,inWhite,gamma,outBlack,outWhite}, r:{..}, g:{..}, b:{..} }
 *          'gradient' [{pos:0..1, color:'#rrggbb'}, ...]
 *
 *  ADDING AN EFFECT
 *    defFilter({ id:'myFx', name:'My FX', category:'Stylize',
 *                params:[ range('amount','Amount',50,0,100) ],
 *                apply: function (img, p, opts) { ...; return img; } });
 *    (defAdj() for adjustments.) Helpers available inside this file: blurImage(),
 *    gaussPlane(), toPlanes()/fromPlanes() (premultiplied float planes), warp() for
 *    displacement effects with bilinear sampling, rng(seed), perlin noise (makeNoise),
 *    lumPlane(), applyLUT3(), etc.
 * ============================================================================
 */
(function (root) {
  'use strict';

  // ==========================================================================
  //  Basic utilities
  // ==========================================================================
  /** clamp(v, min=0, max=255) */
  function clamp(v, lo, hi) {
    if (lo === undefined) { lo = 0; hi = 255; }
    return v < lo ? lo : (v > hi ? hi : v);
  }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function smoothstep(a, b, x) {
    var t = (x - a) / (b - a); t = t < 0 ? 0 : (t > 1 ? 1 : t);
    return t * t * (3 - 2 * t);
  }

  var HAS_IMAGEDATA = typeof ImageData === 'function';
  /** createImageData(w,h): real ImageData when available, else a plain object. */
  function createImageData(w, h) {
    w = Math.max(1, w | 0); h = Math.max(1, h | 0);
    if (HAS_IMAGEDATA) { try { return new ImageData(w, h); } catch (e) { /* fall through */ } }
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  }
  function cloneImageData(img) {
    var o = createImageData(img.width, img.height);
    o.data.set(img.data);
    return o;
  }

  /** luminance(r,g,b) -> 0..255 (Rec.601 weights). */
  function luminance(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }

  /** rgbToHsl(r,g,b 0..255) -> [h 0..360, s 0..1, l 0..1] */
  function rgbToHsl(r, g, b) { var o = [0, 0, 0]; rgbToHslInto(r, g, b, o); return o; }
  function rgbToHslInto(r, g, b, o) {
    r /= 255; g /= 255; b /= 255;
    var mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
    var mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
    var l = (mx + mn) / 2, h = 0, s = 0, d = mx - mn;
    if (d > 1e-9) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    o[0] = h; o[1] = s; o[2] = l;
  }
  function hue2rgb(p, q, t) {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }
  /** hslToRgb(h 0..360, s 0..1, l 0..1) -> [r,g,b] 0..255 (floats) */
  function hslToRgb(h, s, l) { var o = [0, 0, 0]; hslToRgbInto(h, s, l, o); return o; }
  function hslToRgbInto(h, s, l, o) {
    if (s <= 0) { o[0] = o[1] = o[2] = l * 255; return; }
    h = ((h % 360) + 360) % 360 / 360;
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    o[0] = hue2rgb(p, q, h + 1 / 3) * 255;
    o[1] = hue2rgb(p, q, h) * 255;
    o[2] = hue2rgb(p, q, h - 1 / 3) * 255;
  }
  /** rgbToHsv(r,g,b 0..255) -> [h 0..360, s 0..1, v 0..1] */
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
    if (d > 1e-9) {
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, mx === 0 ? 0 : d / mx, mx];
  }
  /** hsvToRgb(h 0..360, s 0..1, v 0..1) -> [r,g,b] 0..255 */
  function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360 / 60;
    var i = Math.floor(h), f = h - i, p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
    var r, g, b;
    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      default: r = v; g = p; b = q;
    }
    return [r * 255, g * 255, b * 255];
  }
  /** hexToRgb('#rrggbb' | '#rgb') -> [r,g,b] */
  function hexToRgb(hex) {
    var s = String(hex || '#000000').trim().replace(/^#/, '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var n = parseInt(s.slice(0, 6), 16);
    if (isNaN(n)) n = 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r, g, b) {
    if (Array.isArray(r)) { b = r[2]; g = r[1]; r = r[0]; }
    function h(v) { v = Math.round(clamp(v)); return (v < 16 ? '0' : '') + v.toString(16); }
    return '#' + h(r) + h(g) + h(b);
  }

  /**
   * buildCurveLUT(points) -> Uint8Array(256)
   * Monotone cubic (Fritsch–Carlson) interpolation through [[x,y],...] (0..255).
   * Outside the first/last point the curve is flat.
   */
  function buildCurveLUT(points) {
    var lut = new Uint8Array(256), i;
    if (!points || !points.length) { for (i = 0; i < 256; i++) lut[i] = i; return lut; }
    var pts = [];
    for (i = 0; i < points.length; i++) {
      var p = points[i];
      if (!p) continue;
      var px = +(p[0] !== undefined ? p[0] : p.x), py = +(p[1] !== undefined ? p[1] : p.y);
      if (isNaN(px) || isNaN(py)) continue;
      pts.push([clamp(px, 0, 255), clamp(py, 0, 255)]);
    }
    if (!pts.length) { for (i = 0; i < 256; i++) lut[i] = i; return lut; }
    pts.sort(function (a, b) { return a[0] - b[0]; });
    var xs = [], ys = [];
    for (i = 0; i < pts.length; i++) {
      if (xs.length && Math.abs(pts[i][0] - xs[xs.length - 1]) < 1e-6) ys[ys.length - 1] = pts[i][1];
      else { xs.push(pts[i][0]); ys.push(pts[i][1]); }
    }
    var n = xs.length;
    if (n === 1) { lut.fill(Math.round(ys[0])); return lut; }
    var d = new Array(n - 1), m = new Array(n);
    for (i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (i = 1; i < n - 1; i++) m[i] = (d[i - 1] * d[i] <= 0) ? 0 : (d[i - 1] + d[i]) / 2;
    for (i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      var a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { var t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    var seg = 0;
    for (var x = 0; x < 256; x++) {
      var y;
      if (x <= xs[0]) y = ys[0];
      else if (x >= xs[n - 1]) y = ys[n - 1];
      else {
        while (x > xs[seg + 1]) seg++;
        var hh = xs[seg + 1] - xs[seg], tt = (x - xs[seg]) / hh, t2 = tt * tt, t3 = t2 * tt;
        y = (2 * t3 - 3 * t2 + 1) * ys[seg] + (t3 - 2 * t2 + tt) * hh * m[seg] +
            (-2 * t3 + 3 * t2) * ys[seg + 1] + (t3 - t2) * hh * m[seg + 1];
      }
      lut[x] = Math.round(clamp(y, 0, 255));
    }
    return lut;
  }

  /**
   * gradientLUT(stops) -> Uint8ClampedArray(256*4) RGBA.
   * stops: [{pos:0..1, color:'#rrggbb', opacity?:0..1}]
   */
  function gradientLUT(stops) {
    var out = new Uint8ClampedArray(1024);
    var s = (stops && stops.length ? stops : [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }])
      .map(function (st) {
        var c = hexToRgb(st.color);
        var op = st.opacity !== undefined ? +st.opacity : (st.alpha !== undefined ? +st.alpha : 1);
        return { pos: clamp(+st.pos || 0, 0, 1), c: c, a: clamp(op, 0, 1) * 255 };
      }).sort(function (a, b) { return a.pos - b.pos; });
    for (var i = 0; i < 256; i++) {
      var t = i / 255, k = 0;
      while (k < s.length - 1 && s[k + 1].pos < t) k++;
      var A = s[k], B = s[Math.min(k + 1, s.length - 1)], f;
      if (t <= A.pos || A === B) f = (t <= A.pos ? 0 : 1);
      else f = clamp01((t - A.pos) / Math.max(1e-6, B.pos - A.pos));
      if (t <= s[0].pos) { A = B = s[0]; f = 0; }
      out[i * 4] = A.c[0] + (B.c[0] - A.c[0]) * f;
      out[i * 4 + 1] = A.c[1] + (B.c[1] - A.c[1]) * f;
      out[i * 4 + 2] = A.c[2] + (B.c[2] - A.c[2]) * f;
      out[i * 4 + 3] = A.a + (B.a - A.a) * f;
    }
    return out;
  }

  // --------------------------------------------------------------------------
  //  Bilinear sampling (premultiplied interpolation, straight-alpha output)
  // --------------------------------------------------------------------------
  var EDGE_CLAMP = 1, EDGE_WRAP = 2, EDGE_TRANSPARENT = 3;
  function edgeCode(s) { return s === 'wrap' ? EDGE_WRAP : (s === 'transparent' ? EDGE_TRANSPARENT : EDGE_CLAMP); }
  var SR = 0, SG = 0, SB = 0, SA = 0;
  function tap(d, w, h, x, y, wt, edge) {
    if (wt === 0) return;
    if (x < 0 || y < 0 || x >= w || y >= h) {
      if (edge === EDGE_TRANSPARENT) return;
      if (edge === EDGE_WRAP) { x %= w; if (x < 0) x += w; y %= h; if (y < 0) y += h; }
      else { x = x < 0 ? 0 : (x >= w ? w - 1 : x); y = y < 0 ? 0 : (y >= h ? h - 1 : y); }
    }
    var i = (y * w + x) << 2, a = d[i + 3] * wt;
    SR += d[i] * a; SG += d[i + 1] * a; SB += d[i + 2] * a; SA += a;
  }
  /** Writes bilinear sample of straight-alpha RGBA `d` at (x,y) into out[o..o+3]. */
  function bilinearInto(d, w, h, x, y, edge, out, o) {
    if (x !== x || y !== y) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0; return; }
    if (edge === EDGE_CLAMP) {
      if (x < 0) x = 0; else if (x > w - 1) x = w - 1;
      if (y < 0) y = 0; else if (y > h - 1) y = h - 1;
    } else if (edge === EDGE_TRANSPARENT) {
      if (x < -1 || y < -1 || x > w || y > h) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0; return; }
    }
    var x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    if (x0 >= 0 && y0 >= 0 && x0 < w - 1 && y0 < h - 1) {      // fast interior path
      var i = (y0 * w + x0) << 2, j = i + (w << 2), gx = 1 - fx, gy = 1 - fy;
      var a00 = d[i + 3] * gx * gy, a10 = d[i + 7] * fx * gy, a01 = d[j + 3] * gx * fy, a11 = d[j + 7] * fx * fy, A = a00 + a10 + a01 + a11;
      if (A > 1e-6) {
        var iv = 1 / A;
        out[o] = (d[i] * a00 + d[i + 4] * a10 + d[j] * a01 + d[j + 4] * a11) * iv;
        out[o + 1] = (d[i + 1] * a00 + d[i + 5] * a10 + d[j + 1] * a01 + d[j + 5] * a11) * iv;
        out[o + 2] = (d[i + 2] * a00 + d[i + 6] * a10 + d[j + 2] * a01 + d[j + 6] * a11) * iv;
        out[o + 3] = A;
      } else { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0; }
      return;
    }
    SR = SG = SB = SA = 0;
    tap(d, w, h, x0, y0, (1 - fx) * (1 - fy), edge);
    tap(d, w, h, x0 + 1, y0, fx * (1 - fy), edge);
    tap(d, w, h, x0, y0 + 1, (1 - fx) * fy, edge);
    tap(d, w, h, x0 + 1, y0 + 1, fx * fy, edge);
    if (SA > 1e-6) { var inv = 1 / SA; out[o] = SR * inv; out[o + 1] = SG * inv; out[o + 2] = SB * inv; out[o + 3] = SA; }
    else { out[o] = out[o + 1] = out[o + 2] = 0; out[o + 3] = 0; }
  }
  /** util.sampleBilinear(img,x,y,edge='clamp') -> [r,g,b,a] */
  function sampleBilinear(img, x, y, edge) {
    var o = [0, 0, 0, 0];
    bilinearInto(img.data, img.width, img.height, x, y, edgeCode(edge), o, 0);
    return o;
  }
  /** Bilinear sample of a single float plane, clamped edges. */
  function samplePlane(p, w, h, x, y) {
    if (x < 0) x = 0; else if (x > w - 1) x = w - 1;
    if (y < 0) y = 0; else if (y > h - 1) y = h - 1;
    var x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
    var x1 = x0 + 1 < w ? x0 + 1 : x0, y1 = y0 + 1 < h ? y0 + 1 : y0;
    var r0 = y0 * w, r1 = y1 * w;
    var a = p[r0 + x0] + (p[r0 + x1] - p[r0 + x0]) * fx;
    var b = p[r1 + x0] + (p[r1 + x1] - p[r1 + x0]) * fx;
    return a + (b - a) * fy;
  }

  // ==========================================================================
  //  Random numbers & noise
  // ==========================================================================
  function hashSeed(a, b) {
    var h = 2166136261 >>> 0, s = String(a) + '|' + String(b === undefined ? '' : b);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h || 1;
  }
  /** rng(seed) -> function returning uniform [0,1) (mulberry32). */
  function rng(seed) {
    var t = seed >>> 0;
    return function () {
      t = (t + 0x6D2B79F5) >>> 0;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  function effSeed(p, opts) {
    var s = p && p.seed !== undefined ? p.seed : 0;
    return (opts && opts.seed !== undefined && opts.seed !== null) ? hashSeed(s, opts.seed) : hashSeed(s, 'fx');
  }
  /** Table of 65536 standard-normal samples. */
  function gaussTable(seed) {
    var R = rng(seed), t = new Float32Array(65536);
    for (var i = 0; i < 65536; i += 2) {
      var u = R() || 1e-12, v = R();
      var m = Math.sqrt(-2 * Math.log(u));
      t[i] = m * Math.cos(6.283185307 * v); t[i + 1] = m * Math.sin(6.283185307 * v);
    }
    return t;
  }
  /** 2D gradient (Perlin) noise with seeded permutation. Returns {noise(x,y), fbm(x,y,oct,gain)} */
  function makeNoise(seed) {
    var R = rng(seed), perm = new Uint8Array(512), p = new Uint8Array(256), i;
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) { var j = (R() * (i + 1)) | 0, t = p[i]; p[i] = p[j]; p[j] = t; }
    for (i = 0; i < 512; i++) perm[i] = p[i & 255];
    var GX = new Float32Array(8), GY = new Float32Array(8);
    for (i = 0; i < 8; i++) { GX[i] = Math.cos(i * Math.PI / 4); GY[i] = Math.sin(i * Math.PI / 4); }
    function noise(x, y) {
      var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      xi &= 255; yi &= 255;
      var u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
      var aa = perm[perm[xi] + yi] & 7, ab = perm[perm[xi] + yi + 1] & 7;
      var ba = perm[perm[xi + 1] + yi] & 7, bb = perm[perm[xi + 1] + yi + 1] & 7;
      var n00 = GX[aa] * xf + GY[aa] * yf, n10 = GX[ba] * (xf - 1) + GY[ba] * yf;
      var n01 = GX[ab] * xf + GY[ab] * (yf - 1), n11 = GX[bb] * (xf - 1) + GY[bb] * (yf - 1);
      var x1 = n00 + (n10 - n00) * u, x2 = n01 + (n11 - n01) * u;
      return (x1 + (x2 - x1) * v) * 1.4142;   // ~[-1,1]
    }
    function fbm(x, y, oct, gain) {
      var s = 0, a = 1, f = 1, norm = 0;
      for (var o = 0; o < oct; o++) { s += a * noise(x * f + o * 17.31, y * f + o * 9.17); norm += a; a *= gain; f *= 2; }
      return s / norm;
    }
    return { noise: noise, fbm: fbm };
  }

  // ==========================================================================
  //  Float plane helpers & fast blur engine
  // ==========================================================================
  /** Premultiplied float planes. Returns {R,G,B,A,opaque,w,h}. */
  function toPlanes(img) {
    var d = img.data, n = img.width * img.height;
    var R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), A = new Float32Array(n);
    var opaque = true;
    for (var i = 0, j = 0; i < n; i++, j += 4) {
      var a = d[j + 3];
      if (a === 255) { R[i] = d[j]; G[i] = d[j + 1]; B[i] = d[j + 2]; A[i] = 255; }
      else { opaque = false; var f = a / 255; R[i] = d[j] * f; G[i] = d[j + 1] * f; B[i] = d[j + 2] * f; A[i] = a; }
    }
    return { R: R, G: G, B: B, A: A, opaque: opaque, w: img.width, h: img.height };
  }
  /** Write premultiplied planes back into straight-alpha `out` (ImageData). */
  function fromPlanes(pl, out) {
    var d = out.data, n = pl.w * pl.h, R = pl.R, G = pl.G, B = pl.B, A = pl.A;
    if (pl.opaque) {
      for (var i = 0, j = 0; i < n; i++, j += 4) { d[j] = R[i]; d[j + 1] = G[i]; d[j + 2] = B[i]; d[j + 3] = 255; }
      return out;
    }
    for (var k = 0, m = 0; k < n; k++, m += 4) {
      var a = A[k];
      if (a > 0.01) { var inv = 255 / a; d[m] = R[k] * inv; d[m + 1] = G[k] * inv; d[m + 2] = B[k] * inv; d[m + 3] = a; }
      else { d[m] = d[m + 1] = d[m + 2] = 0; d[m + 3] = 0; }
    }
    return out;
  }
  function planeList(pl) { return pl.opaque ? [pl.R, pl.G, pl.B] : [pl.R, pl.G, pl.B, pl.A]; }

  /** Luminance plane (Float32, 0..255) of straight RGB. */
  function lumPlane(img) {
    var d = img.data, n = img.width * img.height, L = new Float32Array(n);
    for (var i = 0, j = 0; i < n; i++, j += 4) L[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    return L;
  }

  function transpose(src, dst, w, h) {
    var B = 32;
    for (var by = 0; by < h; by += B) {
      var ey = by + B < h ? by + B : h;
      for (var bx = 0; bx < w; bx += B) {
        var ex = bx + B < w ? bx + B : w;
        for (var y = by; y < ey; y++) {
          var row = y * w;
          for (var x = bx; x < ex; x++) dst[x * h + y] = src[row + x];
        }
      }
    }
  }
  /** Horizontal box blur (clamped edges), integer radius r. */
  function boxH(src, dst, w, h, r) {
    if (r <= 0) { if (src !== dst) dst.set(src); return; }
    var inv = 1 / (r + r + 1), wm = w - 1;
    for (var y = 0; y < h; y++) {
      var row = y * w, sum = 0, k;
      for (k = -r; k <= r; k++) sum += src[row + (k < 0 ? 0 : (k > wm ? wm : k))];
      for (var x = 0; x < w; x++) {
        dst[row + x] = sum * inv;
        var ai = x + r + 1, ri = x - r;
        sum += src[row + (ai > wm ? wm : ai)] - src[row + (ri < 0 ? 0 : ri)];
      }
    }
  }
  /** Horizontal convolution with symmetric kernel k (length 2r+1), clamped edges. */
  function convH(src, dst, w, h, k, r) {
    var wm = w - 1;
    for (var y = 0; y < h; y++) {
      var row = y * w;
      for (var x = 0; x < w; x++) {
        var s = 0;
        if (x >= r && x + r <= wm) {
          var base = row + x - r;
          for (var i = 0; i <= r + r; i++) s += src[base + i] * k[i];
        } else {
          for (var j = -r; j <= r; j++) { var xx = x + j; xx = xx < 0 ? 0 : (xx > wm ? wm : xx); s += src[row + xx] * k[j + r]; }
        }
        dst[row + x] = s;
      }
    }
  }
  function boxesForGauss(sigma, n) {
    var wIdeal = Math.sqrt((12 * sigma * sigma / n) + 1);
    var wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
    var wu = wl + 2;
    var mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
    var m = Math.round(mIdeal), sizes = [];
    for (var i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
    return sizes;
  }
  function gaussKernel(sigma) {
    var r = Math.max(1, Math.ceil(sigma * 2.5)), k = new Float32Array(2 * r + 1), s = 0;
    for (var i = -r; i <= r; i++) { var v = Math.exp(-(i * i) / (2 * sigma * sigma)); k[i + r] = v; s += v; }
    for (i = 0; i < k.length; i++) k[i] /= s;
    return { k: k, r: r };
  }
  /**
   * Run a horizontal operation on rows, then on columns (via transposition).
   * hop(src, dst, w, h) must read src rows and write dst rows. Planes are blurred in place.
   */
  function separable(planes, w, h, hop) {
    var n = w * h, t1 = new Float32Array(n), t2 = new Float32Array(n);
    for (var i = 0; i < planes.length; i++) {
      var p = planes[i];
      hop(p, t1, w, h);
      transpose(t1, t2, w, h);
      hop(t2, t1, h, w);
      transpose(t1, p, h, w);
    }
  }
  // ---- stride-aware (interleaved, c channels) separable passes; vertical passes run row-wise (cache friendly) ----
  function boxHc(src, dst, w, h, c, r) {
    if (r <= 0) { dst.set(src); return; }
    var inv = 1 / (r + r + 1), wm = w - 1, L = w * c, y, x, k, base, q, ai, ri, A, B;
    if (c === 1) {
      for (y = 0; y < h; y++) {
        base = y * L; var s = 0;
        for (k = -r; k <= r; k++) s += src[base + (k < 0 ? 0 : (k > wm ? wm : k))];
        for (x = 0; x < w; x++) {
          dst[base + x] = s * inv; ai = x + r + 1; ri = x - r;
          s += src[base + (ai > wm ? wm : ai)] - src[base + (ri < 0 ? 0 : ri)];
        }
      }
    } else if (c === 3) {
      for (y = 0; y < h; y++) {
        base = y * L; var a0 = 0, a1 = 0, a2 = 0;
        for (k = -r; k <= r; k++) { q = base + (k < 0 ? 0 : (k > wm ? wm : k)) * 3; a0 += src[q]; a1 += src[q + 1]; a2 += src[q + 2]; }
        for (x = 0; x < w; x++) {
          q = base + x * 3; dst[q] = a0 * inv; dst[q + 1] = a1 * inv; dst[q + 2] = a2 * inv;
          ai = x + r + 1; ri = x - r; A = base + (ai > wm ? wm : ai) * 3; B = base + (ri < 0 ? 0 : ri) * 3;
          a0 += src[A] - src[B]; a1 += src[A + 1] - src[B + 1]; a2 += src[A + 2] - src[B + 2];
        }
      }
    } else {
      for (y = 0; y < h; y++) {
        base = y * L; var b0 = 0, b1 = 0, b2 = 0, b3 = 0;
        for (k = -r; k <= r; k++) { q = base + (k < 0 ? 0 : (k > wm ? wm : k)) * 4; b0 += src[q]; b1 += src[q + 1]; b2 += src[q + 2]; b3 += src[q + 3]; }
        for (x = 0; x < w; x++) {
          q = base + x * 4; dst[q] = b0 * inv; dst[q + 1] = b1 * inv; dst[q + 2] = b2 * inv; dst[q + 3] = b3 * inv;
          ai = x + r + 1; ri = x - r; A = base + (ai > wm ? wm : ai) * 4; B = base + (ri < 0 ? 0 : ri) * 4;
          b0 += src[A] - src[B]; b1 += src[A + 1] - src[B + 1]; b2 += src[A + 2] - src[B + 2]; b3 += src[A + 3] - src[B + 3];
        }
      }
    }
  }
  function boxVc(src, dst, w, h, c, r) {
    if (r <= 0) { dst.set(src); return; }
    var L = w * c, sums = new Float64Array(L), inv = 1 / (r + r + 1), hm = h - 1, i, k;
    for (k = -r; k <= r; k++) { var off = (k < 0 ? 0 : (k > hm ? hm : k)) * L; for (i = 0; i < L; i++) sums[i] += src[off + i]; }
    for (var y = 0; y < h; y++) {
      var o = y * L, ai = y + r + 1, ri = y - r, a = (ai > hm ? hm : ai) * L, b = (ri < 0 ? 0 : ri) * L;
      for (i = 0; i < L; i++) { dst[o + i] = sums[i] * inv; sums[i] += src[a + i] - src[b + i]; }
    }
  }
  function convHc(src, dst, w, h, c, k, r) {
    var wm = w - 1, L = w * c, n = 2 * r + 1, y, x, ch, t, s, base, q;
    for (y = 0; y < h; y++) {
      base = y * L;
      // borders (clamped)
      for (x = 0; x < w; x++) {
        if (x === r && w - r > r) x = w - r;   // skip interior
        for (ch = 0; ch < c; ch++) {
          s = 0;
          for (var j = -r; j <= r; j++) { var xx = x + j; xx = xx < 0 ? 0 : (xx > wm ? wm : xx); s += src[base + xx * c + ch] * k[j + r]; }
          dst[base + x * c + ch] = s;
        }
      }
      // interior: flat loop over row samples
      var i0 = base + r * c, i1 = base + (w - r) * c, rc = r * c;
      if (n === 3) { var k0 = k[0], k1 = k[1], k2 = k[2]; for (q = i0; q < i1; q++) dst[q] = src[q - c] * k0 + src[q] * k1 + src[q + c] * k2; }
      else if (n === 5) { var a0 = k[0], a1 = k[1], a2 = k[2], c2 = 2 * c; for (q = i0; q < i1; q++) dst[q] = (src[q - c2] + src[q + c2]) * a0 + (src[q - c] + src[q + c]) * a1 + src[q] * a2; }
      else if (n === 7) { var b0 = k[0], b1 = k[1], b2 = k[2], b3 = k[3], d2 = 2 * c, d3 = 3 * c; for (q = i0; q < i1; q++) dst[q] = (src[q - d3] + src[q + d3]) * b0 + (src[q - d2] + src[q + d2]) * b1 + (src[q - c] + src[q + c]) * b2 + src[q] * b3; }
      else if (n === 9) { var e0 = k[0], e1 = k[1], e2 = k[2], e3 = k[3], e4 = k[4], f2 = 2 * c, f3 = 3 * c, f4 = 4 * c;
        for (q = i0; q < i1; q++) dst[q] = (src[q - f4] + src[q + f4]) * e0 + (src[q - f3] + src[q + f3]) * e1 + (src[q - f2] + src[q + f2]) * e2 + (src[q - c] + src[q + c]) * e3 + src[q] * e4; }
      else if (n === 11) { var g0 = k[0], g1 = k[1], g2 = k[2], g3 = k[3], g4 = k[4], g5 = k[5], h2 = 2 * c, h3 = 3 * c, h4 = 4 * c, h5 = 5 * c;
        for (q = i0; q < i1; q++) dst[q] = (src[q - h5] + src[q + h5]) * g0 + (src[q - h4] + src[q + h4]) * g1 + (src[q - h3] + src[q + h3]) * g2 + (src[q - h2] + src[q + h2]) * g3 + (src[q - c] + src[q + c]) * g4 + src[q] * g5; }
      else for (q = i0; q < i1; q++) { s = 0; var p0 = q - rc; for (t = 0; t < n; t++) s += src[p0 + t * c] * k[t]; dst[q] = s; }
    }
  }
  function convVc(src, dst, w, h, c, k, r) {
    var L = w * c, hm = h - 1, n = 2 * r + 1, offs = new Int32Array(n), i, t;
    for (var y = 0; y < h; y++) {
      var o = y * L;
      for (t = 0; t < n; t++) { var yy = y + t - r; offs[t] = (yy < 0 ? 0 : (yy > hm ? hm : yy)) * L; }
      if (n === 3) { var o0 = offs[0], o1 = offs[1], o2 = offs[2], k0 = k[0], k1 = k[1], k2 = k[2]; for (i = 0; i < L; i++) dst[o + i] = src[o0 + i] * k0 + src[o1 + i] * k1 + src[o2 + i] * k2; }
      else if (n === 5) { var p0 = offs[0], p1 = offs[1], p2 = offs[2], p3 = offs[3], p4 = offs[4], a0 = k[0], a1 = k[1], a2 = k[2]; for (i = 0; i < L; i++) dst[o + i] = (src[p0 + i] + src[p4 + i]) * a0 + (src[p1 + i] + src[p3 + i]) * a1 + src[p2 + i] * a2; }
      else if (n === 7) { var q0 = offs[0], q1 = offs[1], q2 = offs[2], q3 = offs[3], q4 = offs[4], q5 = offs[5], q6 = offs[6], b0 = k[0], b1 = k[1], b2 = k[2], b3 = k[3];
        for (i = 0; i < L; i++) dst[o + i] = (src[q0 + i] + src[q6 + i]) * b0 + (src[q1 + i] + src[q5 + i]) * b1 + (src[q2 + i] + src[q4 + i]) * b2 + src[q3 + i] * b3; }
      else if (n === 9) { var u0 = offs[0], u1 = offs[1], u2 = offs[2], u3 = offs[3], u4 = offs[4], u5 = offs[5], u6 = offs[6], u7 = offs[7], u8 = offs[8], e0 = k[0], e1 = k[1], e2 = k[2], e3 = k[3], e4 = k[4];
        for (i = 0; i < L; i++) dst[o + i] = (src[u0 + i] + src[u8 + i]) * e0 + (src[u1 + i] + src[u7 + i]) * e1 + (src[u2 + i] + src[u6 + i]) * e2 + (src[u3 + i] + src[u5 + i]) * e3 + src[u4 + i] * e4; }
      else if (n === 11) { var v0 = offs[0], v1 = offs[1], v2 = offs[2], v3 = offs[3], v4 = offs[4], v5 = offs[5], v6 = offs[6], v7 = offs[7], v8 = offs[8], v9 = offs[9], v10 = offs[10], g0 = k[0], g1 = k[1], g2 = k[2], g3 = k[3], g4 = k[4], g5 = k[5];
        for (i = 0; i < L; i++) dst[o + i] = (src[v0 + i] + src[v10 + i]) * g0 + (src[v1 + i] + src[v9 + i]) * g1 + (src[v2 + i] + src[v8 + i]) * g2 + (src[v3 + i] + src[v7 + i]) * g3 + (src[v4 + i] + src[v6 + i]) * g4 + src[v5 + i] * g5; }
      else for (i = 0; i < L; i++) { var s = 0; for (t = 0; t < n; t++) s += src[offs[t] + i] * k[t]; dst[o + i] = s; }
    }
  }
  /** Gaussian blur, in place, of an interleaved float buffer with c channels.
   *  sigma < 1.2: exact kernel; otherwise 3 box passes; sigma >= 2: computed at reduced
   *  resolution (area downsample -> blur -> bilinear upsample), visually equivalent and ~f^2 faster. */
  var DOWNSAMPLE_SIGMA = 2;
  function gaussBuf(buf, w, h, c, sigma, tmp, inner) {
    if (!(sigma > 0.2)) return buf;
    if (!inner && sigma >= DOWNSAMPLE_SIGMA && w > 16 && h > 16) {
      var f = Math.max(2, Math.min(64, Math.ceil(sigma / 2)));
      var sm = downsampleBuf(buf, w, h, c, f);
      var s2 = Math.sqrt(Math.max(0.25, sigma * sigma - (f * f) / 4)) / f;
      gaussBuf(sm.buf, sm.w, sm.h, c, s2, null, true);
      upsampleBuf(sm, f, buf, w, h, c);
      return buf;
    }
    tmp = tmp && tmp.length >= buf.length ? tmp : new Float32Array(buf.length);
    if (sigma < 1.2 || (inner && sigma < 2.1)) {
      var gk = gaussKernel(sigma);
      convHc(buf, tmp, w, h, c, gk.k, gk.r);
      convVc(tmp, buf, w, h, c, gk.k, gk.r);
      return buf;
    }
    var b = boxesForGauss(sigma, 3);
    box3(buf, w, h, c, (b[0] - 1) >> 1, (b[1] - 1) >> 1, (b[2] - 1) >> 1);
    return buf;
  }
  /** Three cascaded box blurs: horizontal passes run in a row-local buffer (cache friendly),
   *  vertical passes run row-wise with per-column running sums. */
  function box3(buf, w, h, c, r0, r1, r2) {
    var L = w * c, A = new Float32Array(L), B = new Float32Array(L), y;
    for (y = 0; y < h; y++) {
      var row = buf.subarray(y * L, y * L + L);
      boxHc(row, A, w, 1, c, r0); boxHc(A, B, w, 1, c, r1); boxHc(B, row, w, 1, c, r2);
    }
    var tmp = new Float32Array(buf.length);
    boxVc(buf, tmp, w, h, c, r0); boxVc(tmp, buf, w, h, c, r1); boxVc(buf, tmp, w, h, c, r2);
    buf.set(tmp);
  }
  /** Downsample an interleaved buffer by integer factor f using bilinear "splatting" (tent filter).
   *  Unlike plain area averaging this preserves the sub-block position of features, so a blur done
   *  at low resolution and upsampled bilinearly stays centred. */
  function downsampleBuf(buf, w, h, c, f, fromRGBA) {
    var w2 = Math.ceil(w / f) + 1, h2 = Math.ceil(h / f) + 1, L2 = w2 * c, out = new Float32Array(w2 * h2 * c), wt = new Float32Array(w2 * h2), x, y, ch;
    var k0 = new Int32Array(w), fr = new Float32Array(w);
    for (x = 0; x < w; x++) { var u = (x + 0.5) / f - 0.5; if (u < 0) u = 0; var k = u | 0; k0[x] = k; fr[x] = u - k; }
    for (y = 0; y < h; y++) {
      var v = (y + 0.5) / f - 0.5; if (v < 0) v = 0;
      var ky = v | 0, fy = v - ky, gy = 1 - fy, r0 = ky * w2, r1 = r0 + w2, sc = fromRGBA ? 4 : c, ri = y * w * sc;
      for (x = 0; x < w; x++) {
        var kx = k0[x], fx = fr[x], gx = 1 - fx, s = ri + x * sc;
        var a = r0 + kx, b = a + 1, cc = r1 + kx, d = cc + 1;
        var wa = gx * gy, wb = fx * gy, wc = gx * fy, wd = fx * fy;
        wt[a] += wa; wt[b] += wb; wt[cc] += wc; wt[d] += wd;
        a *= c; b *= c; cc *= c; d *= c;
        var pm = 1;
        if (fromRGBA && c === 4) { pm = buf[s + 3] * (1 / 255); }
        var v0 = buf[s] * pm;
        out[a] += v0 * wa; out[b] += v0 * wb; out[cc] += v0 * wc; out[d] += v0 * wd;
        if (c > 1) {
          var v1 = buf[s + 1] * pm, v2 = buf[s + 2] * pm;
          out[a + 1] += v1 * wa; out[b + 1] += v1 * wb; out[cc + 1] += v1 * wc; out[d + 1] += v1 * wd;
          out[a + 2] += v2 * wa; out[b + 2] += v2 * wb; out[cc + 2] += v2 * wc; out[d + 2] += v2 * wd;
          if (c > 3) { var v3 = buf[s + 3]; out[a + 3] += v3 * wa; out[b + 3] += v3 * wb; out[cc + 3] += v3 * wc; out[d + 3] += v3 * wd; }
        }
      }
    }
    for (var i = 0; i < w2 * h2; i++) { var W = wt[i]; if (W > 1e-6) { var inv = 1 / W; for (ch = 0; ch < c; ch++) out[i * c + ch] *= inv; } }
    // fill any never-touched samples (last column/row) from neighbours
    for (y = 0; y < h2; y++) for (x = w2 - 1; x >= 0; x--) {
      var q = y * w2 + x;
      if (wt[q] <= 1e-6) { var src = x > 0 ? q - 1 : (y > 0 ? q - w2 : q); for (ch = 0; ch < c; ch++) out[q * c + ch] = out[src * c + ch]; if (x > 0) { wt[q] = wt[src]; } }
    }
    return { buf: out, w: w2, h: h2 };
  }
  /** Bilinear upsample of a premultiplied low-res buffer straight into RGBA u8 (unpremultiplying). */
  function upsampleToRGBA(sm, f, od, w, h, c) {
    var w2 = sm.w, h2 = sm.h, S = sm.buf, L2 = w2 * c, x;
    var x0s = new Int32Array(w), x1s = new Int32Array(w), fxs = new Float32Array(w);
    for (x = 0; x < w; x++) {
      var sx = (x + 0.5) / f - 0.5; if (sx < 0) sx = 0; if (sx > w2 - 1) sx = w2 - 1;
      var xi = sx | 0; x0s[x] = xi * c; x1s[x] = (xi + 1 < w2 ? xi + 1 : xi) * c; fxs[x] = sx - xi;
    }
    for (var y = 0; y < h; y++) {
      var sy = (y + 0.5) / f - 0.5; if (sy < 0) sy = 0; if (sy > h2 - 1) sy = h2 - 1;
      var yi = sy | 0, fy = sy - yi, fy1 = 1 - fy, r0 = yi * L2, r1 = (yi + 1 < h2 ? yi + 1 : yi) * L2, o = y * w * 4;
      for (x = 0; x < w; x++) {
        var a = x0s[x], b = x1s[x], fx = fxs[x], q = o + x * 4, w00 = (1 - fx) * fy1, w10 = fx * fy1, w01 = (1 - fx) * fy, w11 = fx * fy;
        var A0 = r0 + a, B0 = r0 + b, A1 = r1 + a, B1 = r1 + b;
        var R = S[A0] * w00 + S[B0] * w10 + S[A1] * w01 + S[B1] * w11;
        var G = S[A0 + 1] * w00 + S[B0 + 1] * w10 + S[A1 + 1] * w01 + S[B1 + 1] * w11;
        var B = S[A0 + 2] * w00 + S[B0 + 2] * w10 + S[A1 + 2] * w01 + S[B1 + 2] * w11;
        if (c === 3) { od[q] = R; od[q + 1] = G; od[q + 2] = B; od[q + 3] = 255; }
        else {
          var al = S[A0 + 3] * w00 + S[B0 + 3] * w10 + S[A1 + 3] * w01 + S[B1 + 3] * w11;
          if (al > 0.01) { var iv = 255 / al; od[q] = R * iv; od[q + 1] = G * iv; od[q + 2] = B * iv; od[q + 3] = al; }
          else { od[q] = od[q + 1] = od[q + 2] = od[q + 3] = 0; }
        }
      }
    }
  }
  /** Bilinear upsample of downsampleBuf() output back to w*h. */
  function upsampleBuf(sm, f, out, w, h, c) {
    var w2 = sm.w, h2 = sm.h, S = sm.buf, L2 = w2 * c, x, ch;
    var x0s = new Int32Array(w), x1s = new Int32Array(w), fxs = new Float32Array(w);
    for (x = 0; x < w; x++) {
      var sx = (x + 0.5) / f - 0.5; if (sx < 0) sx = 0; if (sx > w2 - 1) sx = w2 - 1;
      var xi = sx | 0; x0s[x] = xi * c; x1s[x] = (xi + 1 < w2 ? xi + 1 : xi) * c; fxs[x] = sx - xi;
    }
    for (var y = 0; y < h; y++) {
      var sy = (y + 0.5) / f - 0.5; if (sy < 0) sy = 0; if (sy > h2 - 1) sy = h2 - 1;
      var yi = sy | 0, fy = sy - yi, r0 = yi * L2, r1 = (yi + 1 < h2 ? yi + 1 : yi) * L2, o = y * w * c;
      var fy1 = 1 - fy;
      for (x = 0; x < w; x++) {
        var a = x0s[x], b = x1s[x], fx = fxs[x], q = o + x * c, w00 = (1 - fx) * fy1, w10 = fx * fy1, w01 = (1 - fx) * fy, w11 = fx * fy;
        var A0 = r0 + a, B0 = r0 + b, A1 = r1 + a, B1 = r1 + b;
        out[q] = S[A0] * w00 + S[B0] * w10 + S[A1] * w01 + S[B1] * w11;
        if (c > 1) {
          out[q + 1] = S[A0 + 1] * w00 + S[B0 + 1] * w10 + S[A1 + 1] * w01 + S[B1 + 1] * w11;
          out[q + 2] = S[A0 + 2] * w00 + S[B0 + 2] * w10 + S[A1 + 2] * w01 + S[B1 + 2] * w11;
          if (c > 3) out[q + 3] = S[A0 + 3] * w00 + S[B0 + 3] * w10 + S[A1 + 3] * w01 + S[B1 + 3] * w11;
        }
      }
    }
  }
  /** Gaussian blur of float planes in place (sigma in px). Exact kernel for small sigma, 3x box otherwise. */
  function gaussPlanes(planes, w, h, sigma) {
    if (!(sigma > 0.2)) return;
    var tmp = new Float32Array(w * h);
    for (var i = 0; i < planes.length; i++) gaussBuf(planes[i], w, h, 1, sigma, tmp);
  }
  /** Gaussian blur of a single float plane, returns a NEW plane. */
  function gaussPlane(p, w, h, sigma) {
    var c = new Float32Array(p);
    gaussPlanes([c], w, h, sigma);
    return c;
  }
  /** Gaussian blur an image (alpha-correct, premultiplied). Mutates & returns `img` unless `out` is given. */
  function blurImage(img, sigma, out) {
    out = out || img;
    if (!(sigma > 0.2)) { if (out !== img) out.data.set(img.data); return out; }
    var w = img.width, h = img.height, n = w * h, d = img.data, od = out.data, i, j, k;
    if (sigma >= DOWNSAMPLE_SIGMA && w > 16 && h > 16) {
      // fused fast path: premultiply while downsampling, unpremultiply while upsampling
      var opq = isOpaque(img), cc = opq ? 3 : 4, f = Math.max(2, Math.min(64, Math.ceil(sigma / 2)));
      var sm = downsampleBuf(d, w, h, cc, f, true);
      gaussBuf(sm.buf, sm.w, sm.h, cc, Math.sqrt(Math.max(0.25, sigma * sigma - (f * f) / 4)) / f, null, true);
      upsampleToRGBA(sm, f, od, w, h, cc);
      return out;
    }
    if (isOpaque(img)) {
      var f3 = new Float32Array(n * 3);
      for (i = 0, j = 0, k = 0; i < n; i++, j += 4, k += 3) { f3[k] = d[j]; f3[k + 1] = d[j + 1]; f3[k + 2] = d[j + 2]; }
      gaussBuf(f3, w, h, 3, sigma);
      for (i = 0, j = 0, k = 0; i < n; i++, j += 4, k += 3) { od[j] = f3[k]; od[j + 1] = f3[k + 1]; od[j + 2] = f3[k + 2]; od[j + 3] = 255; }
      return out;
    }
    var f = toPremulInterleaved(img);
    gaussBuf(f, w, h, 4, sigma);
    return fromPremulInterleaved(f, out);
  }
  function blurredCopy(img, sigma) { return blurImage(img, sigma, createImageData(img.width, img.height)); }

  /** Apply per-channel LUTs (length 256) to RGB. */
  function applyLUT3(img, lr, lg, lb) {
    var d = img.data, n = d.length;
    for (var i = 0; i < n; i += 4) { d[i] = lr[d[i]]; d[i + 1] = lg[d[i + 1]]; d[i + 2] = lb[d[i + 2]]; }
    return img;
  }
  function lutFrom(fn) { var l = new Uint8ClampedArray(256); for (var i = 0; i < 256; i++) l[i] = fn(i); return l; }
  function srgbToLin(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function linToSrgb(v) { v = v <= 0 ? 0 : (v >= 1 ? 1 : v); return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); }
  var S2L = new Float32Array(256);
  for (var _i = 0; _i < 256; _i++) S2L[_i] = srgbToLin(_i);

  /** Generic warp: map(x, y, xy) must set xy[0], xy[1] = source coords. Returns new ImageData. */
  function warp(img, edge, map) {
    var w = img.width, h = img.height, src = img.data, out = createImageData(w, h), od = out.data;
    var xy = new Float64Array(2), e = edgeCode(edge);
    for (var y = 0, o = 0; y < h; y++) {
      for (var x = 0; x < w; x++, o += 4) {
        xy[0] = x; xy[1] = y;
        map(x, y, xy);
        bilinearInto(src, w, h, xy[0], xy[1], e, od, o);
      }
    }
    return out;
  }

  /** Sobel gradient magnitude of a float plane -> new plane. */
  function sobelPlane(p, w, h) {
    var out = new Float32Array(w * h), wm = w - 1, hm = h - 1;
    for (var y = 0; y < h; y++) {
      var r0 = (y > 0 ? y - 1 : 0) * w, r1 = y * w, r2 = (y < hm ? y + 1 : hm) * w;
      for (var x = 0; x < w; x++) {
        var xl = x > 0 ? x - 1 : 0, xr = x < wm ? x + 1 : wm;
        var gx = (p[r0 + xr] + 2 * p[r1 + xr] + p[r2 + xr]) - (p[r0 + xl] + 2 * p[r1 + xl] + p[r2 + xl]);
        var gy = (p[r2 + xl] + 2 * p[r2 + x] + p[r2 + xr]) - (p[r0 + xl] + 2 * p[r0 + x] + p[r0 + xr]);
        out[r1 + x] = Math.sqrt(gx * gx + gy * gy);
      }
    }
    return out;
  }
  /** Extract straight channel c (0..3) as float plane. */
  function channelPlane(img, c) {
    var d = img.data, n = img.width * img.height, p = new Float32Array(n);
    for (var i = 0, j = c; i < n; i++, j += 4) p[i] = d[j];
    return p;
  }

  /** 1D sliding max/min (van Herk/Gil-Werman) on rows of a Uint8/Float plane. */
  function morphH(src, dst, w, h, r, isMax) {
    var len = w + 2 * r, g = new Float32Array(len), hb = new Float32Array(len), win = 2 * r + 1, ext = new Float32Array(len);
    for (var y = 0; y < h; y++) {
      var row = y * w, i;
      for (i = 0; i < len; i++) { var xx = i - r; xx = xx < 0 ? 0 : (xx >= w ? w - 1 : xx); ext[i] = src[row + xx]; }
      for (i = 0; i < len; i++) {
        if (i % win === 0) g[i] = ext[i];
        else g[i] = isMax ? (ext[i] > g[i - 1] ? ext[i] : g[i - 1]) : (ext[i] < g[i - 1] ? ext[i] : g[i - 1]);
      }
      for (i = len - 1; i >= 0; i--) {
        if (i === len - 1 || (i + 1) % win === 0) hb[i] = ext[i];
        else hb[i] = isMax ? (ext[i] > hb[i + 1] ? ext[i] : hb[i + 1]) : (ext[i] < hb[i + 1] ? ext[i] : hb[i + 1]);
      }
      for (var x = 0; x < w; x++) {
        var a = hb[x], b = g[x + 2 * r];
        dst[row + x] = isMax ? (a > b ? a : b) : (a < b ? a : b);
      }
    }
  }
  function morphPlanes(planes, w, h, r, isMax) {
    if (r < 1) return;
    separable(planes, w, h, function (s, d, W, H) { morphH(s, d, W, H, r, isMax); });
  }

  // ==========================================================================
  //  Registry, parameter helpers & the central mask wrapper
  // ==========================================================================
  var adjustments = {}, filters = {};

  function range(id, label, def, min, max, step, unit) {
    var o = { id: id, label: label, type: 'range', default: def, min: min, max: max, step: step || 1 };
    if (unit) o.unit = unit;
    return o;
  }
  function angle(id, label, def, min, max) {
    return { id: id, label: label, type: 'angle', default: def, min: min === undefined ? -180 : min, max: max === undefined ? 180 : max, step: 1, unit: '°' };
  }
  function check(id, label, def) { return { id: id, label: label, type: 'checkbox', default: !!def }; }
  function select(id, label, def, opts) {
    return { id: id, label: label, type: 'select', default: def, options: opts.map(function (o) { return Array.isArray(o) ? { value: o[0], label: o[1] } : { value: o, label: o }; }) };
  }
  function color(id, label, def) { return { id: id, label: label, type: 'color', default: def }; }
  function num(id, label, def, min, max, step) { var o = { id: id, label: label, type: 'number', default: def, step: step || 1 }; if (min !== undefined) o.min = min; if (max !== undefined) o.max = max; return o; }
  function seedParam() { return { id: 'seed', label: 'Seed', type: 'number', default: 1, min: 0, max: 99999, step: 1 }; }
  function edgeParam(def) { return select('edge', 'Undefined Areas', def || 'clamp', [['clamp', 'Repeat Edge Pixels'], ['wrap', 'Wrap Around'], ['transparent', 'Transparent']]); }

  var ID_CURVE = [[0, 0], [255, 255]];
  function defLevels() { return { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 }; }

  function deepClone(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(deepClone);
    var o = {}; for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = deepClone(v[k]);
    return o;
  }
  function defaults(effect) {
    if (typeof effect === 'string') effect = lookup(effect);
    var o = {};
    if (!effect || !effect.params) return o;
    for (var i = 0; i < effect.params.length; i++) o[effect.params[i].id] = deepClone(effect.params[i].default);
    return o;
  }
  function normParam(def, v) {
    if (v === undefined || v === null) return deepClone(def.default);
    switch (def.type) {
      case 'range': case 'number': case 'angle': {
        var n = +v; if (isNaN(n)) return def.default;
        return n;
      }
      case 'checkbox': return !!v;
      case 'curve': {
        var c = {}; ['rgb', 'r', 'g', 'b'].forEach(function (k) { c[k] = (v[k] && v[k].length) ? v[k] : deepClone(ID_CURVE); });
        return c;
      }
      case 'levels': {
        var L = {}; ['rgb', 'r', 'g', 'b'].forEach(function (k) {
          var s = v[k] || {}, d = defLevels(), o = {};
          for (var f in d) o[f] = (s[f] === undefined || s[f] === null || isNaN(+s[f])) ? d[f] : +s[f];
          L[k] = o;
        });
        return L;
      }
      case 'gradient': return (Array.isArray(v) && v.length) ? v : deepClone(def.default);
      default: return v;
    }
  }
  function fillParams(effect, params) {
    var o = {}, ps = effect.params || [];
    params = params || {};
    for (var i = 0; i < ps.length; i++) o[ps[i].id] = normParam(ps[i], params[ps[i].id]);
    for (var k in params) if (!(k in o)) o[k] = params[k];
    return o;
  }
  function blendMask(out, orig, mask) {
    var d = out.data, n = mask.length;
    for (var i = 0, j = 0; i < n; i++, j += 4) {
      var m = mask[i];
      if (m === 255) continue;
      if (m === 0) { d[j] = orig[j]; d[j + 1] = orig[j + 1]; d[j + 2] = orig[j + 2]; d[j + 3] = orig[j + 3]; continue; }
      var f = m / 255;
      d[j] = orig[j] + (d[j] - orig[j]) * f;
      d[j + 1] = orig[j + 1] + (d[j + 1] - orig[j + 1]) * f;
      d[j + 2] = orig[j + 2] + (d[j + 2] - orig[j + 2]) * f;
      d[j + 3] = orig[j + 3] + (d[j + 3] - orig[j + 3]) * f;
    }
  }
  /** Wrap effect.apply so params are normalised and opts.selectionMask is honoured centrally. */
  function wrapEffect(e) {
    var raw = e.apply;
    e.applyRaw = raw;
    e.apply = function (img, params, opts) {
      opts = opts || {};
      var p = fillParams(e, params);
      var mask = opts.selectionMask, orig = null;
      if (mask) {
        if (mask.length !== img.width * img.height) throw new Error('ImageFX: selectionMask length ' + mask.length + ' != width*height ' + (img.width * img.height));
        var any = false, all = true;
        for (var i = 0; i < mask.length; i++) { var m = mask[i]; if (m) any = true; if (m !== 255) all = false; if (any && !all) break; }
        if (!any) return img;
        if (all) mask = null; else orig = new Uint8ClampedArray(img.data);
      }
      var out = raw.call(e, img, p, opts) || img;
      if (out.width !== img.width || out.height !== img.height) throw new Error('ImageFX: effect ' + e.id + ' changed image size');
      if (mask) blendMask(out, orig, mask);
      return out;
    };
    return e;
  }
  function defAdj(e) { e.category = e.category || 'Adjustment'; e.kind = 'adjustment'; adjustments[e.id] = wrapEffect(e); return e; }
  function defFilter(e) { e.kind = 'filter'; filters[e.id] = wrapEffect(e); return e; }
  function lookup(id) { return adjustments[id] || filters[id] || null; }

  /** histogram(img, mask?) */
  function histogram(img, mask) {
    var r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), lum = new Uint32Array(256), a = new Uint32Array(256);
    var d = img.data, n = img.width * img.height;
    for (var i = 0, j = 0; i < n; i++, j += 4) {
      if (mask && mask[i] < 128) continue;
      a[d[j + 3]]++;
      if (d[j + 3] === 0) continue;
      r[d[j]]++; g[d[j + 1]]++; b[d[j + 2]]++;
      lum[(0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2] + 0.5) | 0]++;
    }
    return { r: r, g: g, b: b, lum: lum, a: a };
  }
  function percentile(h, frac) {
    var total = 0, i; for (i = 0; i < 256; i++) total += h[i];
    if (!total) return frac < 0.5 ? 0 : 255;
    var target = total * frac, acc = 0;
    for (i = 0; i < 256; i++) { acc += h[i]; if (acc > target) return i; }
    return 255;
  }

  // ==========================================================================
  //  ADJUSTMENTS
  // ==========================================================================

  defAdj({
    id: 'brightnessContrast', name: 'Brightness/Contrast',
    params: [range('brightness', 'Brightness', 0, -150, 150), range('contrast', 'Contrast', 0, -50, 100), check('legacy', 'Use Legacy', false)],
    apply: function (img, p) {
      var b = p.brightness, c = p.contrast;
      if (!b && !c) return img;
      var lut = lutFrom(function (v) {
        if (p.legacy) {
          var x = v + b;
          var f = c >= 0 ? 1 / Math.max(0.01, 1 - c / 100) : 1 + c / 100;
          return (x - 127.5) * f + 127.5;
        }
        var t = v / 255;
        if (b) t = Math.pow(t, Math.pow(2, -b / 100));
        if (c) {
          var k = c / 100, e = k >= 0 ? 1 + k * 2 : 1 / (1 - k * 1.6);
          t = t < 0.5 ? 0.5 * Math.pow(2 * t, e) : 1 - 0.5 * Math.pow(2 * (1 - t), e);
        }
        return t * 255;
      });
      return applyLUT3(img, lut, lut, lut);
    }
  });

  function levelsLUT(L) {
    var lut = new Float32Array(256), inB = L.inBlack, inW = L.inWhite, g = L.gamma > 0 ? L.gamma : 1, oB = L.outBlack, oW = L.outWhite;
    var span = inW - inB;
    for (var v = 0; v < 256; v++) {
      var t = Math.abs(span) < 1e-6 ? (v >= inB ? 1 : 0) : (v - inB) / span;
      t = clamp01(t);
      if (g !== 1) t = Math.pow(t, 1 / g);
      lut[v] = oB + t * (oW - oB);
    }
    return lut;
  }
  function composeLUT(first, second) { // second(first(v))
    var o = new Uint8ClampedArray(256);
    for (var v = 0; v < 256; v++) o[v] = second[Math.round(clamp(first[v]))];
    return o;
  }
  defAdj({
    id: 'levels', name: 'Levels',
    params: [{ id: 'levels', label: 'Levels', type: 'levels', default: { rgb: defLevels(), r: defLevels(), g: defLevels(), b: defLevels() } }],
    apply: function (img, p) {
      var L = p.levels, m = levelsLUT(L.rgb);
      return applyLUT3(img, composeLUT(m, levelsLUT(L.r)), composeLUT(m, levelsLUT(L.g)), composeLUT(m, levelsLUT(L.b)));
    }
  });

  defAdj({
    id: 'curves', name: 'Curves',
    params: [{ id: 'curve', label: 'Curve', type: 'curve', default: { rgb: deepClone(ID_CURVE), r: deepClone(ID_CURVE), g: deepClone(ID_CURVE), b: deepClone(ID_CURVE) } }],
    apply: function (img, p) {
      var c = p.curve, m = buildCurveLUT(c.rgb);
      return applyLUT3(img, composeLUT(m, buildCurveLUT(c.r)), composeLUT(m, buildCurveLUT(c.g)), composeLUT(m, buildCurveLUT(c.b)));
    }
  });

  defAdj({
    id: 'exposure', name: 'Exposure',
    params: [range('exposure', 'Exposure', 0, -5, 5, 0.01), range('offset', 'Offset', 0, -0.5, 0.5, 0.001), range('gamma', 'Gamma Correction', 1, 0.01, 9.99, 0.01)],
    apply: function (img, p) {
      if (!p.exposure && !p.offset && p.gamma === 1) return img;
      var mul = Math.pow(2, p.exposure), g = p.gamma > 0 ? p.gamma : 1;
      var lut = lutFrom(function (v) {
        var l = S2L[v] * mul + p.offset;
        if (l < 0) l = 0;
        if (g !== 1) l = Math.pow(l, 1 / g);
        return linToSrgb(l);
      });
      return applyLUT3(img, lut, lut, lut);
    }
  });

  var HUE_RANGES = { reds: 0, yellows: 60, greens: 120, cyans: 180, blues: 240, magentas: 300 };
  function hueRangeWeight(h, center) {
    var d = Math.abs(h - center) % 360; if (d > 180) d = 360 - d;
    if (d <= 15) return 1;
    if (d >= 45) return 0;
    var t = (d - 15) / 30; return 1 - t * t * (3 - 2 * t);
  }
  defAdj({
    id: 'hueSaturation', name: 'Hue/Saturation',
    params: [
      select('range', 'Range', 'master', [['master', 'Master'], ['reds', 'Reds'], ['yellows', 'Yellows'], ['greens', 'Greens'], ['cyans', 'Cyans'], ['blues', 'Blues'], ['magentas', 'Magentas']]),
      range('hue', 'Hue', 0, -180, 180), range('saturation', 'Saturation', 0, -100, 100), range('lightness', 'Lightness', 0, -100, 100),
      check('colorize', 'Colorize', false)
    ],
    apply: function (img, p) {
      var dh = p.hue, sat = p.saturation / 100, li = p.lightness / 100, colorize = p.colorize;
      if (!colorize && !dh && !sat && !li) return img;
      var center = HUE_RANGES[p.range], ranged = !colorize && center !== undefined;
      var d = img.data, n = d.length, hsl = new Float64Array(3), rgb = new Float64Array(3);
      var cH = ((dh % 360) + 360) % 360, cS = clamp01((p.saturation + 100) / 200);
      for (var i = 0; i < n; i += 4) {
        var r = d[i], g = d[i + 1], b = d[i + 2];
        rgbToHslInto(r, g, b, hsl);
        var w = 1;
        if (ranged) {
          w = hueRangeWeight(hsl[0], center) * Math.min(1, hsl[1] * 4);
          if (w <= 0) continue;
        }
        var nr, ng, nb;
        if (colorize) {
          hslToRgbInto(cH, cS, luminance(r, g, b) / 255, rgb);
        } else {
          var s = hsl[1];
          if (sat > 0) s = 1 - Math.pow(1 - s, 1 + sat * 2); else if (sat < 0) s = s * (1 + sat);
          hslToRgbInto(hsl[0] + dh, s, hsl[2], rgb);
        }
        nr = rgb[0]; ng = rgb[1]; nb = rgb[2];
        if (li > 0) { nr += (255 - nr) * li; ng += (255 - ng) * li; nb += (255 - nb) * li; }
        else if (li < 0) { nr *= 1 + li; ng *= 1 + li; nb *= 1 + li; }
        if (w < 1) { nr = r + (nr - r) * w; ng = g + (ng - g) * w; nb = b + (nb - b) * w; }
        d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
      }
      return img;
    }
  });

  defAdj({
    id: 'colorBalance', name: 'Color Balance',
    params: [
      range('shadowsCR', 'Shadows: Cyan–Red', 0, -100, 100), range('shadowsMG', 'Shadows: Magenta–Green', 0, -100, 100), range('shadowsYB', 'Shadows: Yellow–Blue', 0, -100, 100),
      range('midtonesCR', 'Midtones: Cyan–Red', 0, -100, 100), range('midtonesMG', 'Midtones: Magenta–Green', 0, -100, 100), range('midtonesYB', 'Midtones: Yellow–Blue', 0, -100, 100),
      range('highlightsCR', 'Highlights: Cyan–Red', 0, -100, 100), range('highlightsMG', 'Highlights: Magenta–Green', 0, -100, 100), range('highlightsYB', 'Highlights: Yellow–Blue', 0, -100, 100),
      check('preserveLuminosity', 'Preserve Luminosity', true)
    ],
    apply: function (img, p) {
      var keys = ['CR', 'MG', 'YB'], luts = [], any = false;
      for (var c = 0; c < 3; c++) {
        var s = p['shadows' + keys[c]] / 100, m = p['midtones' + keys[c]] / 100, h = p['highlights' + keys[c]] / 100;
        if (s || m || h) any = true;
        luts.push(new Float32Array(256));
        for (var v = 0; v < 256; v++) {
          var t = v / 255, ws = (1 - t) * (1 - t), wh = t * t, wm = 4 * t * (1 - t);
          // shadows act less on pure black, highlights less on pure white -> soften ends
          ws *= 0.35 + 0.65 * smoothstep(0, 0.12, t); wh *= 0.35 + 0.65 * smoothstep(0, 0.12, 1 - t);
          luts[c][v] = clamp(v + (s * ws + m * wm + h * wh) * 70);
        }
      }
      if (!any) return img;
      var d = img.data, n = d.length, R = luts[0], G = luts[1], B = luts[2], pl = p.preserveLuminosity;
      for (var i = 0; i < n; i += 4) {
        var r = d[i], g = d[i + 1], b = d[i + 2], nr = R[r], ng = G[g], nb = B[b];
        if (pl) {
          var dl = luminance(r, g, b) - luminance(nr, ng, nb);
          nr += dl; ng += dl; nb += dl;
        }
        d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
      }
      return img;
    }
  });

  defAdj({
    id: 'vibrance', name: 'Vibrance',
    params: [range('vibrance', 'Vibrance', 0, -100, 100), range('saturation', 'Saturation', 0, -100, 100)],
    apply: function (img, p) {
      var vib = p.vibrance / 100, sat = p.saturation / 100;
      if (!vib && !sat) return img;
      var d = img.data, n = d.length;
      for (var i = 0; i < n; i += 4) {
        var r = d[i], g = d[i + 1], b = d[i + 2];
        var mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
        var L = luminance(r, g, b), s = (mx - mn) / 255, f = 1;
        if (vib) {
          var amt = vib > 0 ? vib * (1 - s) * (1 - s) * 1.5 : vib * (1 - s * 0.5);
          if (vib > 0 && r > g && g > b && (r - b) < 160) amt *= 0.55; // protect skin tones
          if (amt > 0) { // limit to avoid clipping
            var lim = 1e9;
            if (mx > L) lim = Math.min(lim, (255 - L) / (mx - L));
            if (mn < L) lim = Math.min(lim, L / (L - mn));
            if (1 + amt > lim) amt = Math.max(0, lim - 1);
          }
          f *= 1 + amt;
        }
        f *= 1 + sat;
        d[i] = L + (r - L) * f; d[i + 1] = L + (g - L) * f; d[i + 2] = L + (b - L) * f;
      }
      return img;
    }
  });

  defAdj({
    id: 'blackWhite', name: 'Black & White',
    params: [
      range('reds', 'Reds', 40, -200, 300, 1, '%'), range('yellows', 'Yellows', 60, -200, 300, 1, '%'), range('greens', 'Greens', 40, -200, 300, 1, '%'),
      range('cyans', 'Cyans', 60, -200, 300, 1, '%'), range('blues', 'Blues', 20, -200, 300, 1, '%'), range('magentas', 'Magentas', 80, -200, 300, 1, '%'),
      check('tint', 'Tint', false), range('tintHue', 'Tint Hue', 35, 0, 360, 1, '°'), range('tintSaturation', 'Tint Saturation', 25, 0, 100, 1, '%')
    ],
    apply: function (img, p) {
      // primaries R,G,B ; secondaries by (max,mid) pair
      var wR = p.reds / 100, wY = p.yellows / 100, wG = p.greens / 100, wC = p.cyans / 100, wB = p.blues / 100, wM = p.magentas / 100;
      var d = img.data, n = d.length, rgb = new Float64Array(3), tint = p.tint, th = p.tintHue, ts = p.tintSaturation / 100;
      var tintLUT = null;
      if (tint) {
        tintLUT = new Uint8ClampedArray(768);
        for (var v = 0; v < 256; v++) { hslToRgbInto(th, ts, v / 255, rgb); tintLUT[v * 3] = rgb[0]; tintLUT[v * 3 + 1] = rgb[1]; tintLUT[v * 3 + 2] = rgb[2]; }
      }
      for (var i = 0; i < n; i += 4) {
        var r = d[i], g = d[i + 1], b = d[i + 2], mx, md, mn, wp, ws;
        if (r >= g) {
          if (g >= b) { mx = r; md = g; mn = b; wp = wR; ws = wY; }
          else if (r >= b) { mx = r; md = b; mn = g; wp = wR; ws = wM; }
          else { mx = b; md = r; mn = g; wp = wB; ws = wM; }
        } else {
          if (r >= b) { mx = g; md = r; mn = b; wp = wG; ws = wY; }
          else if (g >= b) { mx = g; md = b; mn = r; wp = wG; ws = wC; }
          else { mx = b; md = g; mn = r; wp = wB; ws = wC; }
        }
        var gray = mn + (md - mn) * ws + (mx - md) * wp;
        gray = gray < 0 ? 0 : (gray > 255 ? 255 : gray);
        if (tintLUT) { var k = (gray + 0.5 | 0) * 3; d[i] = tintLUT[k]; d[i + 1] = tintLUT[k + 1]; d[i + 2] = tintLUT[k + 2]; }
        else { d[i] = d[i + 1] = d[i + 2] = gray; }
      }
      return img;
    }
  });

  defAdj({
    id: 'photoFilter', name: 'Photo Filter',
    params: [color('color', 'Color', '#ec8a00'), range('density', 'Density', 25, 0, 100, 1, '%'), check('preserveLuminosity', 'Preserve Luminosity', true)],
    apply: function (img, p) {
      var c = hexToRgb(p.color), k = p.density / 100;
      if (!k) return img;
      var fr = 1 - k + k * c[0] / 255, fg = 1 - k + k * c[1] / 255, fb = 1 - k + k * c[2] / 255;
      var d = img.data, n = d.length, pl = p.preserveLuminosity;
      for (var i = 0; i < n; i += 4) {
        var r = d[i], g = d[i + 1], b = d[i + 2], nr = r * fr, ng = g * fg, nb = b * fb;
        if (pl) { var dl = luminance(r, g, b) - luminance(nr, ng, nb); nr += dl; ng += dl; nb += dl; }
        d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
      }
      return img;
    }
  });

  defAdj({
    id: 'channelMixer', name: 'Channel Mixer',
    params: [
      range('redR', 'Red out: Red', 100, -200, 200, 1, '%'), range('redG', 'Red out: Green', 0, -200, 200, 1, '%'), range('redB', 'Red out: Blue', 0, -200, 200, 1, '%'), range('redC', 'Red out: Constant', 0, -200, 200, 1, '%'),
      range('greenR', 'Green out: Red', 0, -200, 200, 1, '%'), range('greenG', 'Green out: Green', 100, -200, 200, 1, '%'), range('greenB', 'Green out: Blue', 0, -200, 200, 1, '%'), range('greenC', 'Green out: Constant', 0, -200, 200, 1, '%'),
      range('blueR', 'Blue out: Red', 0, -200, 200, 1, '%'), range('blueG', 'Blue out: Green', 0, -200, 200, 1, '%'), range('blueB', 'Blue out: Blue', 100, -200, 200, 1, '%'), range('blueC', 'Blue out: Constant', 0, -200, 200, 1, '%'),
      check('monochrome', 'Monochrome (uses Red output row)', false)
    ],
    apply: function (img, p) {
      var m = [p.redR, p.redG, p.redB, p.redC * 2.55, p.greenR, p.greenG, p.greenB, p.greenC * 2.55, p.blueR, p.blueG, p.blueB, p.blueC * 2.55];
      for (var k = 0; k < 12; k++) if (k % 4 !== 3) m[k] /= 100;
      if (p.monochrome) { for (k = 4; k < 12; k++) m[k] = m[k % 4]; }
      else if (m[0] === 1 && m[5] === 1 && m[10] === 1 && !m[1] && !m[2] && !m[3] && !m[4] && !m[6] && !m[7] && !m[8] && !m[9] && !m[11]) return img;
      var d = img.data, n = d.length;
      for (var i = 0; i < n; i += 4) {
        var r = d[i], g = d[i + 1], b = d[i + 2];
        d[i] = m[0] * r + m[1] * g + m[2] * b + m[3];
        d[i + 1] = m[4] * r + m[5] * g + m[6] * b + m[7];
        d[i + 2] = m[8] * r + m[9] * g + m[10] * b + m[11];
      }
      return img;
    }
  });

  defAdj({
    id: 'invert', name: 'Invert', params: [],
    apply: function (img) { var l = lutFrom(function (v) { return 255 - v; }); return applyLUT3(img, l, l, l); }
  });

  defAdj({
    id: 'posterize', name: 'Posterize', params: [range('levels', 'Levels', 4, 2, 255)],
    apply: function (img, p) {
      var n = Math.max(2, Math.round(p.levels));
      var l = lutFrom(function (v) { return Math.min(n - 1, Math.floor(v * n / 256)) * 255 / (n - 1); });
      return applyLUT3(img, l, l, l);
    }
  });

  defAdj({
    id: 'threshold', name: 'Threshold', params: [range('level', 'Threshold Level', 128, 1, 255)],
    apply: function (img, p) {
      var d = img.data, n = d.length, t = p.level;
      for (var i = 0; i < n; i += 4) d[i] = d[i + 1] = d[i + 2] = luminance(d[i], d[i + 1], d[i + 2]) >= t ? 255 : 0;
      return img;
    }
  });

  defAdj({
    id: 'gradientMap', name: 'Gradient Map',
    params: [{ id: 'gradient', label: 'Gradient', type: 'gradient', default: [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }] }, check('reverse', 'Reverse', false), check('dither', 'Dither', false)],
    apply: function (img, p) {
      var g = gradientLUT(p.gradient), d = img.data, n = d.length, rev = p.reverse, dith = p.dither, R = dith ? rng(77) : null;
      for (var i = 0; i < n; i += 4) {
        var L = luminance(d[i], d[i + 1], d[i + 2]);
        if (dith) L += R() - 0.5;
        var k = Math.round(clamp(L)); if (rev) k = 255 - k; k <<= 2;
        d[i] = g[k]; d[i + 1] = g[k + 1]; d[i + 2] = g[k + 2];
      }
      return img;
    }
  });

  defAdj({
    id: 'selectiveColor', name: 'Selective Color',
    params: [
      select('colors', 'Colors', 'reds', [['reds', 'Reds'], ['yellows', 'Yellows'], ['greens', 'Greens'], ['cyans', 'Cyans'], ['blues', 'Blues'], ['magentas', 'Magentas'], ['whites', 'Whites'], ['neutrals', 'Neutrals'], ['blacks', 'Blacks']]),
      range('cyan', 'Cyan', 0, -100, 100, 1, '%'), range('magenta', 'Magenta', 0, -100, 100, 1, '%'), range('yellow', 'Yellow', 0, -100, 100, 1, '%'), range('black', 'Black', 0, -100, 100, 1, '%'),
      select('method', 'Method', 'relative', [['relative', 'Relative'], ['absolute', 'Absolute']])
    ],
    apply: function (img, p) {
      var adj = [p.cyan / 100, p.magenta / 100, p.yellow / 100], k = p.black / 100, rel = p.method === 'relative';
      if (!adj[0] && !adj[1] && !adj[2] && !k) return img;
      var d = img.data, n = d.length, sel = p.colors, c = new Float64Array(3);
      for (var i = 0; i < n; i += 4) {
        var r = d[i], g = d[i + 1], b = d[i + 2];
        var mx = Math.max(r, g, b), mn = Math.min(r, g, b), md = r + g + b - mx - mn, w = 0;
        switch (sel) {
          case 'reds': w = (r === mx) ? mx - md : 0; break;
          case 'greens': w = (g === mx && r !== mx) ? mx - md : 0; break;
          case 'blues': w = (b === mx && r !== mx && g !== mx) ? mx - md : 0; break;
          case 'yellows': w = (b === mn) ? md - mn : 0; break;
          case 'cyans': w = (r === mn && b !== mn) ? md - mn : 0; break;
          case 'magentas': w = (g === mn && r !== mn && b !== mn) ? md - mn : 0; break;
          case 'whites': w = mn > 128 ? (mn - 128) * 2 : 0; break;
          case 'blacks': w = mx < 128 ? (128 - mx) * 2 : 0; break;
          case 'neutrals': w = 255 - (Math.abs(mx - 127.5) + Math.abs(mn - 127.5)); w = w < 0 ? 0 : w; break;
        }
        if (w <= 0) continue;
        w /= 255;
        c[0] = r; c[1] = g; c[2] = b;
        for (var ch = 0; ch < 3; ch++) {
          var v = c[ch] / 255, a = adj[ch];
          // ink = 1 - v ; positive ink amount removes light
          var delta = a * (rel ? (a > 0 ? v : 1 - v) : 1) + k * (rel ? (k > 0 ? v : 1 - v) : 1);
          c[ch] = clamp(c[ch] - delta * 255 * w);
        }
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
      }
      return img;
    }
  });

  defAdj({
    id: 'shadowsHighlights', name: 'Shadows/Highlights',
    params: [range('shadows', 'Shadows Amount', 35, 0, 100, 1, '%'), range('highlights', 'Highlights Amount', 0, 0, 100, 1, '%'), range('radius', 'Radius', 30, 1, 500, 1, 'px'), range('color', 'Color Correction', 0, -100, 100)],
    apply: function (img, p) {
      var s = p.shadows / 100, hA = p.highlights / 100, cc = p.color / 100;
      if (!s && !hA) return img;
      var w = img.width, h = img.height, L = lumPlane(img), B = gaussPlane(L, w, h, p.radius * 0.6);
      var d = img.data, n = w * h;
      for (var i = 0, j = 0; i < n; i++, j += 4) {
        var l = L[i] / 255, bl = B[i] / 255, nl = l;
        if (s) { var ms = (1 - bl) * (1 - bl); nl = 1 - Math.pow(1 - nl, 1 + s * ms * 2.2); }
        if (hA) { var mh = bl * bl; nl = Math.pow(nl, 1 + hA * mh * 2.2); }
        if (nl === l) continue;
        var r = d[j], g = d[j + 1], b = d[j + 2], L0 = L[i], L1 = nl * 255;
        var nr, ng, nb;
        if (L0 < 0.5) { nr = ng = nb = L1; }
        else {
          // scale chroma by ratio, but blend to additive for very dark pixels to avoid noise blow-up
          var ratio = L1 / L0, satf = 1 + cc * Math.abs(nl - l) * 3;
          nr = L1 + (r - L0) * Math.min(ratio, 2.5) * satf;
          ng = L1 + (g - L0) * Math.min(ratio, 2.5) * satf;
          nb = L1 + (b - L0) * Math.min(ratio, 2.5) * satf;
        }
        d[j] = nr; d[j + 1] = ng; d[j + 2] = nb;
      }
      return img;
    }
  });

  var FILM_LOOKS = {
    warmFade: { curves: { r: [[0, 22], [128, 142], [255, 250]], g: [[0, 16], [128, 130], [255, 242]], b: [[0, 30], [128, 114], [255, 218]] }, sat: 0.85, hi: [8, 4, -6] },
    tealOrange: { curves: { rgb: [[0, 0], [64, 52], [192, 208], [255, 255]] }, sat: 1.15, sh: [-34, 10, 32], hi: [36, 10, -34] },
    bleachBypass: { curves: { rgb: [[0, 0], [56, 36], [128, 128], [196, 218], [255, 255]], b: [[0, 4], [255, 250]] }, sat: 0.42 },
    crossProcess: { curves: { r: [[0, 0], [64, 38], [192, 228], [255, 255]], g: [[0, 0], [64, 48], [192, 214], [255, 255]], b: [[0, 56], [128, 128], [255, 200]] }, sat: 1.15 },
    fadedMatte: { curves: { rgb: [[0, 46], [64, 76], [190, 196], [255, 232]] }, sat: 0.72, sh: [0, 4, 10] },
    noir: { mono: [0.36, 0.5, 0.14], curves: { rgb: [[0, 0], [48, 18], [128, 126], [204, 232], [255, 255]] } }
  };
  defAdj({
    id: 'filmLooks', name: 'Film Looks',
    params: [select('look', 'Look', 'tealOrange', [['warmFade', 'Warm Fade'], ['tealOrange', 'Teal & Orange'], ['bleachBypass', 'Bleach Bypass'], ['crossProcess', 'Cross Process'], ['fadedMatte', 'Faded Matte'], ['noir', 'Noir']]), range('amount', 'Amount', 100, 0, 100, 1, '%')],
    apply: function (img, p) {
      var look = FILM_LOOKS[p.look] || FILM_LOOKS.tealOrange, amt = p.amount / 100;
      if (!amt) return img;
      var c = look.curves || {}, m = buildCurveLUT(c.rgb || ID_CURVE);
      var LR = composeLUT(buildCurveLUT(c.r || ID_CURVE), m), LG = composeLUT(buildCurveLUT(c.g || ID_CURVE), m), LB = composeLUT(buildCurveLUT(c.b || ID_CURVE), m);
      var sat = look.sat === undefined ? 1 : look.sat, sh = look.sh, hi = look.hi, mono = look.mono;
      var d = img.data, n = d.length;
      for (var i = 0; i < n; i += 4) {
        var r0 = d[i], g0 = d[i + 1], b0 = d[i + 2], r = r0, g = g0, b = b0;
        var L = luminance(r, g, b);
        if (mono) { r = g = b = mono[0] * r + mono[1] * g + mono[2] * b; }
        else if (sat !== 1) { r = L + (r - L) * sat; g = L + (g - L) * sat; b = L + (b - L) * sat; }
        var t = L / 255;
        if (sh) { var ws = (1 - t) * (1 - t); r += sh[0] * ws; g += sh[1] * ws; b += sh[2] * ws; }
        if (hi) { var wh = t * t; r += hi[0] * wh; g += hi[1] * wh; b += hi[2] * wh; }
        r = LR[clamp(Math.round(r))]; g = LG[clamp(Math.round(g))]; b = LB[clamp(Math.round(b))];
        d[i] = r0 + (r - r0) * amt; d[i + 1] = g0 + (g - g0) * amt; d[i + 2] = b0 + (b - b0) * amt;
      }
      return img;
    }
  });

  defAdj({
    id: 'temperatureTint', name: 'Temperature/Tint',
    params: [range('temperature', 'Temperature', 0, -100, 100), range('tint', 'Tint', 0, -100, 100)],
    apply: function (img, p) {
      var t = p.temperature / 100, u = p.tint / 100;
      if (!t && !u) return img;
      var gr = 1 + 0.45 * t, gb = 1 - 0.45 * t, gg = 1 - 0.3 * u;
      gr *= 1 + 0.06 * u; gb *= 1 + 0.06 * u;
      var k = 1 / (0.2126 * gr + 0.7152 * gg + 0.0722 * gb);
      gr *= k; gg *= k; gb *= k;
      return applyLUT3(img,
        lutFrom(function (v) { return linToSrgb(S2L[v] * gr); }),
        lutFrom(function (v) { return linToSrgb(S2L[v] * gg); }),
        lutFrom(function (v) { return linToSrgb(S2L[v] * gb); }));
    }
  });

  defAdj({
    id: 'desaturate', name: 'Desaturate', params: [],
    apply: function (img) {
      var d = img.data, n = d.length;
      for (var i = 0; i < n; i += 4) d[i] = d[i + 1] = d[i + 2] = luminance(d[i], d[i + 1], d[i + 2]);
      return img;
    }
  });

  function stretchLUT(lo, hi, gamma) {
    return lutFrom(function (v) {
      if (hi <= lo) return v;
      var t = clamp01((v - lo) / (hi - lo));
      if (gamma && gamma !== 1) t = Math.pow(t, 1 / gamma);
      return t * 255;
    });
  }
  defAdj({
    id: 'autoTone', name: 'Auto Tone', params: [],
    apply: function (img, p, opts) {
      var H = histogram(img, opts.selectionMask), l = [];
      ['r', 'g', 'b'].forEach(function (c) { l.push(stretchLUT(percentile(H[c], 0.001), percentile(H[c], 0.999))); });
      return applyLUT3(img, l[0], l[1], l[2]);
    }
  });
  defAdj({
    id: 'autoContrast', name: 'Auto Contrast', params: [],
    apply: function (img, p, opts) {
      var H = histogram(img, opts.selectionMask), lo = 255, hi = 0;
      ['r', 'g', 'b'].forEach(function (c) { lo = Math.min(lo, percentile(H[c], 0.001)); hi = Math.max(hi, percentile(H[c], 0.999)); });
      var l = stretchLUT(lo, hi);
      return applyLUT3(img, l, l, l);
    }
  });
  defAdj({
    id: 'autoColor', name: 'Auto Color', params: [],
    apply: function (img, p, opts) {
      var H = histogram(img, opts.selectionMask), luts = [], c, chans = ['r', 'g', 'b'];
      for (c = 0; c < 3; c++) { var h = H[chans[c]]; luts.push(stretchLUT(percentile(h, 0.005), percentile(h, 0.995))); }
      // find near-neutral midtones after the stretch and pull their average to gray
      var d = img.data, n = d.length, mask = opts.selectionMask, sr = 0, sg = 0, sb = 0, cnt = 0, R = luts[0], G = luts[1], B = luts[2];
      for (var i = 0, k = 0; i < n; i += 4, k++) {
        if (d[i + 3] === 0 || (mask && mask[k] < 128)) continue;
        var r = R[d[i]], g = G[d[i + 1]], b = B[d[i + 2]], mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (r + g + b) / 3;
        if (mx - mn < 48 && l > 40 && l < 215) { sr += r; sg += g; sb += b; cnt++; }
      }
      if (cnt > (n / 4) * 0.002) {
        var means = [sr / cnt, sg / cnt, sb / cnt], target = (means[0] + means[1] + means[2]) / 3;
        for (c = 0; c < 3; c++) {
          var gm = Math.log(clamp(means[c], 1, 254) / 255) / Math.log(clamp(target, 1, 254) / 255);
          gm = clamp(gm, 0.75, 1.33);
          var base = luts[c];
          luts[c] = (function (bs, g) { return lutFrom(function (x) { return 255 * Math.pow(bs[x] / 255, 1 / g); }); })(base, gm);
        }
      }
      return applyLUT3(img, luts[0], luts[1], luts[2]);
    }
  });

  // ==========================================================================
  //  FILTERS — Blur
  // ==========================================================================

  defFilter({
    id: 'gaussianBlur', name: 'Gaussian Blur', category: 'Blur',
    params: [range('radius', 'Radius', 4, 0.1, 250, 0.1, 'px')],
    apply: function (img, p) { return blurImage(img, p.radius); }
  });

  defFilter({
    id: 'boxBlur', name: 'Box Blur', category: 'Blur',
    params: [range('radius', 'Radius', 5, 1, 250, 1, 'px')],
    apply: function (img, p) {
      var r = Math.max(0, Math.round(p.radius)), pl = toPlanes(img);
      separable(planeList(pl), img.width, img.height, function (s, d, W, H) { boxH(s, d, W, H, r); });
      return fromPlanes(pl, img);
    }
  });

  /** One pass of the "doubling" line blur: dst = avg(src shifted by +v, src shifted by -v). Constant offsets. */
  function shiftAvgPass(src, dst, w, h, dx, dy) {
    var ix = Math.floor(dx), iy = Math.floor(dy), fx = dx - ix, fy = dy - iy;
    var jx = Math.floor(-dx), jy = Math.floor(-dy), gx = -dx - jx, gy = -dy - jy;
    var a00 = (1 - fx) * (1 - fy) * 0.5, a10 = fx * (1 - fy) * 0.5, a01 = (1 - fx) * fy * 0.5, a11 = fx * fy * 0.5;
    var b00 = (1 - gx) * (1 - gy) * 0.5, b10 = gx * (1 - gy) * 0.5, b01 = (1 - gx) * gy * 0.5, b11 = gx * gy * 0.5;
    var cA0 = new Int32Array(w), cA1 = new Int32Array(w), cB0 = new Int32Array(w), cB1 = new Int32Array(w), wm = w - 1, hm = h - 1, x, y;
    function cl(v, m) { return v < 0 ? 0 : (v > m ? m : v); }
    for (x = 0; x < w; x++) { cA0[x] = cl(x + ix, wm); cA1[x] = cl(x + ix + 1, wm); cB0[x] = cl(x + jx, wm); cB1[x] = cl(x + jx + 1, wm); }
    for (y = 0; y < h; y++) {
      var rA0 = cl(y + iy, hm) * w, rA1 = cl(y + iy + 1, hm) * w, rB0 = cl(y + jy, hm) * w, rB1 = cl(y + jy + 1, hm) * w, row = y * w;
      for (x = 0; x < w; x++) {
        var xa0 = cA0[x], xa1 = cA1[x], xb0 = cB0[x], xb1 = cB1[x];
        dst[row + x] = a00 * src[rA0 + xa0] + a10 * src[rA0 + xa1] + a01 * src[rA1 + xa0] + a11 * src[rA1 + xa1] +
                       b00 * src[rB0 + xb0] + b10 * src[rB0 + xb1] + b01 * src[rB1 + xb0] + b11 * src[rB1 + xb1];
      }
    }
  }
  defFilter({
    id: 'motionBlur', name: 'Motion Blur', category: 'Blur',
    params: [angle('angle', 'Angle', 0, -180, 180), range('distance', 'Distance', 25, 1, 1000, 1, 'px')],
    apply: function (img, p) {
      var dist = p.distance, a = p.angle * Math.PI / 180, cx = Math.cos(a), cy = -Math.sin(a);
      if (dist < 1) return img;
      var w = img.width, h = img.height, pl = toPlanes(img), planes = planeList(pl), tmp = new Float32Array(w * h);
      var shifts = [], s = dist / 4;
      while (s >= 0.45) { shifts.push(s); s /= 2; }
      if (!shifts.length) shifts.push(dist / 2);
      for (var k = 0; k < planes.length; k++) {
        var P = planes[k], src = P, dst = tmp;
        for (var i = 0; i < shifts.length; i++) {
          shiftAvgPass(src, dst, w, h, cx * shifts[i], cy * shifts[i]);
          var t = src; src = dst; dst = t;
        }
        if (src !== P) P.set(src);
      }
      return fromPlanes(pl, img);
    }
  });

  /** Interleaved premultiplied float RGBA buffer. */
  function toPremulInterleaved(img) {
    var d = img.data, n = d.length, f = new Float32Array(n);
    for (var i = 0; i < n; i += 4) { var a = d[i + 3] / 255; f[i] = d[i] * a; f[i + 1] = d[i + 1] * a; f[i + 2] = d[i + 2] * a; f[i + 3] = d[i + 3]; }
    return f;
  }
  function fromPremulInterleaved(f, img) {
    var d = img.data, n = d.length;
    for (var i = 0; i < n; i += 4) {
      var a = f[i + 3];
      if (a > 0.01) { var inv = 255 / a; d[i] = f[i] * inv; d[i + 1] = f[i + 1] * inv; d[i + 2] = f[i + 2] * inv; d[i + 3] = a; }
      else { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; }
    }
    return img;
  }
  // accumulate bilinear sample of interleaved float buffer (clamped) * wt into acc
  var ACC = new Float64Array(4);
  function accBilinearF(f, w, h, x, y, wt) {
    if (x < 0) x = 0; else if (x > w - 1) x = w - 1;
    if (y < 0) y = 0; else if (y > h - 1) y = h - 1;
    var x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
    var x1 = x0 < w - 1 ? x0 + 1 : x0, y1 = y0 < h - 1 ? y0 + 1 : y0;
    var i00 = (y0 * w + x0) << 2, i10 = (y0 * w + x1) << 2, i01 = (y1 * w + x0) << 2, i11 = (y1 * w + x1) << 2;
    var w00 = (1 - fx) * (1 - fy) * wt, w10 = fx * (1 - fy) * wt, w01 = (1 - fx) * fy * wt, w11 = fx * fy * wt;
    ACC[0] += f[i00] * w00 + f[i10] * w10 + f[i01] * w01 + f[i11] * w11;
    ACC[1] += f[i00 + 1] * w00 + f[i10 + 1] * w10 + f[i01 + 1] * w01 + f[i11 + 1] * w11;
    ACC[2] += f[i00 + 2] * w00 + f[i10 + 2] * w10 + f[i01 + 2] * w01 + f[i11 + 2] * w11;
    ACC[3] += f[i00 + 3] * w00 + f[i10 + 3] * w10 + f[i01 + 3] * w01 + f[i11 + 3] * w11;
  }
  defFilter({
    id: 'radialBlur', name: 'Radial Blur', category: 'Blur',
    params: [select('mode', 'Blur Method', 'zoom', [['spin', 'Spin'], ['zoom', 'Zoom']]), range('amount', 'Amount', 15, 1, 100), range('centerX', 'Center X', 50, 0, 100, 1, '%'), range('centerY', 'Center Y', 50, 0, 100, 1, '%')],
    apply: function (img, p) {
      var w = img.width, h = img.height, cx = p.centerX / 100 * (w - 1), cy = p.centerY / 100 * (h - 1);
      var Rmax = Math.max(Math.hypot(cx, cy), Math.hypot(w - cx, cy), Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy));
      var spin = p.mode === 'spin', total = spin ? p.amount * Math.PI / 180 : p.amount / 100 * 0.55;
      var spanPx = Rmax * total, shifts = [], s = total / 4;
      var passes = Math.max(1, Math.min(9, Math.ceil(Math.log(Math.max(2, spanPx / 2.5)) / Math.LN2)));
      for (var k = 0; k < passes; k++) { shifts.push(s); s /= 2; }
      var src = toPremulInterleaved(img), dst = new Float32Array(src.length);
      for (var pi = 0; pi < shifts.length; pi++) {
        var sh = shifts[pi], c = Math.cos(sh), sn = Math.sin(sh), e1 = Math.exp(sh), e2 = Math.exp(-sh);
        for (var y = 0, o = 0; y < h; y++) {
          var dy = y - cy;
          for (var x = 0; x < w; x++, o += 4) {
            var dx = x - cx;
            ACC[0] = ACC[1] = ACC[2] = ACC[3] = 0;
            if (spin) {
              accBilinearF(src, w, h, cx + dx * c - dy * sn, cy + dx * sn + dy * c, 0.5);
              accBilinearF(src, w, h, cx + dx * c + dy * sn, cy - dx * sn + dy * c, 0.5);
            } else {
              accBilinearF(src, w, h, cx + dx * e1, cy + dy * e1, 0.5);
              accBilinearF(src, w, h, cx + dx * e2, cy + dy * e2, 0.5);
            }
            dst[o] = ACC[0]; dst[o + 1] = ACC[1]; dst[o + 2] = ACC[2]; dst[o + 3] = ACC[3];
          }
        }
        var t = src; src = dst; dst = t;
      }
      return fromPremulInterleaved(src, img);
    }
  });

  /** Integer-factor area downsample of a plane. */
  function downsamplePlane(p, w, h, f) {
    var w2 = Math.ceil(w / f), h2 = Math.ceil(h / f), o = new Float32Array(w2 * h2), cnt = new Float32Array(w2 * h2);
    for (var y = 0; y < h; y++) {
      var row2 = ((y / f) | 0) * w2, row = y * w;
      for (var x = 0; x < w; x++) { var k = row2 + ((x / f) | 0); o[k] += p[row + x]; cnt[k]++; }
    }
    for (var i = 0; i < o.length; i++) o[i] /= cnt[i];
    return { p: o, w: w2, h: h2 };
  }
  /** Bilinear upsample (inverse of downsamplePlane) into target plane. */
  function upsamplePlane(small, f, w, h, out) {
    var w2 = small.w, h2 = small.h, P = small.p;
    for (var y = 0; y < h; y++) {
      var sy = (y + 0.5) / f - 0.5;
      for (var x = 0; x < w; x++) out[y * w + x] = samplePlane(P, w2, h2, (x + 0.5) / f - 0.5, sy);
    }
  }
  /** Disk (circular) mean filter of plane via per-row prefix sums. Edge-normalised. */
  function diskPlane(p, w, h, r) {
    var ri = Math.floor(r), half = new Int32Array(2 * ri + 1), dy;
    for (dy = -ri; dy <= ri; dy++) half[dy + ri] = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)) + 0.5);
    var W1 = w + 1, S = new Float32Array(W1 * h), out = new Float32Array(w * h), x, y;
    for (y = 0; y < h; y++) {
      var acc = 0, base = y * W1, row = y * w;
      S[base] = 0;
      for (x = 0; x < w; x++) { acc += p[row + x]; S[base + x + 1] = acc; }
    }
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        var sum = 0, cnt = 0;
        for (dy = -ri; dy <= ri; dy++) {
          var yy = y + dy; if (yy < 0 || yy >= h) continue;
          var hw = half[dy + ri], x0 = x - hw, x1 = x + hw;
          if (x0 < 0) x0 = 0; if (x1 > w - 1) x1 = w - 1;
          var b = yy * W1;
          sum += S[b + x1 + 1] - S[b + x0]; cnt += x1 - x0 + 1;
        }
        out[y * w + x] = sum / cnt;
      }
    }
    return out;
  }
  defFilter({
    id: 'bokehBlur', name: 'Bokeh Blur', category: 'Blur',
    params: [range('radius', 'Radius', 12, 1, 100, 1, 'px'), range('brightness', 'Highlight Boost', 25, 0, 100), range('threshold', 'Highlight Threshold', 190, 0, 255)],
    apply: function (img, p) {
      var w = img.width, h = img.height, n = w * h, d = img.data, r = p.radius;
      var boost = p.brightness / 100 * 12, thr = p.threshold / 255;
      var pl = toPlanes(img), planes = planeList(pl), i;
      // to linear light with highlight boost (so bright spots become bright discs)
      for (i = 0; i < n; i++) {
        var a = pl.A[i] / 255 || 0, j = i << 2;
        var l = (0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]) / 255, gain = 1;
        if (boost > 0 && l > thr) { var t = (l - thr) / Math.max(1e-3, 1 - thr); gain = 1 + boost * t * t; }
        pl.R[i] = S2L[d[j]] * gain * a; pl.G[i] = S2L[d[j + 1]] * gain * a; pl.B[i] = S2L[d[j + 2]] * gain * a;
      }
      var f = r > 10 ? Math.ceil(r / 10) : 1;
      for (var k = 0; k < planes.length; k++) {
        var P = planes[k];
        if (f > 1) {
          var sm = downsamplePlane(P, w, h, f);
          sm.p = diskPlane(sm.p, sm.w, sm.h, r / f);
          upsamplePlane(sm, f, w, h, P);
        } else planes[k] = P.set(diskPlane(P, w, h, r)) || P;
      }
      for (i = 0; i < n; i++) {
        var j2 = i << 2, A = pl.A[i] / 255;
        if (A <= 0.0001) { d[j2] = d[j2 + 1] = d[j2 + 2] = d[j2 + 3] = 0; continue; }
        d[j2] = linToSrgb(pl.R[i] / A); d[j2 + 1] = linToSrgb(pl.G[i] / A); d[j2 + 2] = linToSrgb(pl.B[i] / A); d[j2 + 3] = pl.A[i];
      }
      return img;
    }
  });

  /** Separable bilateral-style edge-preserving blur on straight RGB(A). weightLUT indexed by mean abs diff (0..255). */
  function bilateralSeparable(img, radius, weightLUT, spatialSigma) {
    var w = img.width, h = img.height, r = Math.max(1, Math.round(radius));
    var step = Math.max(1, Math.round(r / 5)), taps = [], tw = [];
    var ss = spatialSigma || r / 2;
    for (var k = -r; k <= r; k += step) { taps.push(k); tw.push(Math.exp(-(k * k) / (2 * ss * ss))); }
    var src = img.data, tmp = new Uint8ClampedArray(src.length), nt = taps.length;
    function pass(S, D, horiz) {
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var o = (y * w + x) << 2, cr = S[o], cg = S[o + 1], cb = S[o + 2];
          var sr = 0, sg = 0, sb = 0, sw = 0;
          for (var t = 0; t < nt; t++) {
            var q;
            if (horiz) { var xx = x + taps[t]; xx = xx < 0 ? 0 : (xx >= w ? w - 1 : xx); q = (y * w + xx) << 2; }
            else { var yy = y + taps[t]; yy = yy < 0 ? 0 : (yy >= h ? h - 1 : yy); q = (yy * w + x) << 2; }
            var dr = S[q] - cr, dg = S[q + 1] - cg, db = S[q + 2] - cb;
            var diff = ((dr < 0 ? -dr : dr) + (dg < 0 ? -dg : dg) + (db < 0 ? -db : db)) * 0.33333;
            var wt = weightLUT[diff | 0] * tw[t] * (S[q + 3] + 1);
            sr += S[q] * wt; sg += S[q + 1] * wt; sb += S[q + 2] * wt; sw += wt;
          }
          if (sw > 0) { D[o] = sr / sw; D[o + 1] = sg / sw; D[o + 2] = sb / sw; } else { D[o] = cr; D[o + 1] = cg; D[o + 2] = cb; }
          D[o + 3] = S[o + 3];
        }
      }
    }
    pass(src, tmp, true);
    pass(tmp, src, false);
    return img;
  }
  defFilter({
    id: 'surfaceBlur', name: 'Surface Blur', category: 'Blur',
    params: [range('radius', 'Radius', 6, 1, 100, 1, 'px'), range('threshold', 'Threshold', 20, 2, 255, 1, 'levels')],
    apply: function (img, p) {
      var thr = p.threshold, lut = new Float32Array(256);
      for (var i = 0; i < 256; i++) lut[i] = Math.max(0, 1 - i / (2.5 * thr));
      return bilateralSeparable(img, p.radius, lut, p.radius / 1.5);
    }
  });

  defFilter({
    id: 'tiltShift', name: 'Tilt-Shift', category: 'Blur',
    params: [range('position', 'Focus Position', 55, 0, 100, 1, '%'), range('width', 'Focus Width', 15, 0, 100, 1, '%'), range('transition', 'Transition', 30, 1, 100, 1, '%'),
      range('blur', 'Blur Amount', 12, 0, 100, 0.5, 'px'), angle('angle', 'Angle', 0, -90, 90), range('saturation', 'Saturation Boost', 15, 0, 100, 1, '%')],
    apply: function (img, p) {
      var w = img.width, h = img.height, n = w * h, d = img.data;
      var sig = p.blur, levels = [cloneImageData(img)];
      levels.push(sig > 0.3 ? blurredCopy(img, sig / 3) : cloneImageData(img));
      levels.push(sig > 0.3 ? blurredCopy(img, sig * 2 / 3) : cloneImageData(img));
      levels.push(sig > 0.3 ? blurredCopy(img, sig) : cloneImageData(img));
      var a = p.angle * Math.PI / 180, nx = -Math.sin(a), ny = Math.cos(a);
      var py = p.position / 100 * h, px = w / 2, half = p.width / 200 * h, trans = Math.max(1, p.transition / 100 * h);
      var sat = 1 + p.saturation / 100;
      for (var y = 0, i = 0; y < h; y++) {
        for (var x = 0; x < w; x++, i++) {
          var dist = Math.abs((x - px) * nx + (y - py) * ny);
          var t = clamp01((dist - half) / trans) * 3, lv = Math.min(2, t | 0), f = t - lv, j = i << 2;
          var A = levels[lv].data, B = levels[lv + 1].data, wa = A[j + 3] * (1 - f), wb = B[j + 3] * f, al = wa + wb;
          if (al <= 0) { d[j] = d[j + 1] = d[j + 2] = d[j + 3] = 0; continue; }
          var r = (A[j] * wa + B[j] * wb) / al, g = (A[j + 1] * wa + B[j + 1] * wb) / al, b = (A[j + 2] * wa + B[j + 2] * wb) / al;
          if (sat !== 1) { var L = luminance(r, g, b); r = L + (r - L) * sat; g = L + (g - L) * sat; b = L + (b - L) * sat; }
          d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = al;
        }
      }
      return img;
    }
  });

  // ==========================================================================
  //  FILTERS — Sharpen
  // ==========================================================================
  function unsharp(img, amount, radius, threshold) {
    var bl = blurredCopy(img, radius), d = img.data, b = bl.data, n = d.length, k = amount;
    for (var i = 0; i < n; i += 4) {
      for (var c = 0; c < 3; c++) {
        var v = d[i + c], diff = v - b[i + c];
        if (threshold > 0 && (diff < 0 ? -diff : diff) < threshold) continue;
        d[i + c] = v + diff * k;
      }
    }
    return img;
  }
  defFilter({
    id: 'sharpen', name: 'Sharpen', category: 'Sharpen',
    params: [range('amount', 'Amount', 80, 0, 500, 1, '%')],
    apply: function (img, p) { return unsharp(img, p.amount / 100, 0.8, 0); }
  });
  defFilter({
    id: 'unsharpMask', name: 'Unsharp Mask', category: 'Sharpen',
    params: [range('amount', 'Amount', 100, 1, 500, 1, '%'), range('radius', 'Radius', 1.5, 0.1, 250, 0.1, 'px'), range('threshold', 'Threshold', 0, 0, 255, 1, 'levels')],
    apply: function (img, p) { return unsharp(img, p.amount / 100, p.radius, p.threshold); }
  });
  defFilter({
    id: 'highPass', name: 'High Pass', category: 'Sharpen',
    params: [range('radius', 'Radius', 10, 0.1, 250, 0.1, 'px')],
    apply: function (img, p) {
      var bl = blurredCopy(img, p.radius), d = img.data, b = bl.data, n = d.length;
      for (var i = 0; i < n; i += 4) { d[i] = 128 + d[i] - b[i]; d[i + 1] = 128 + d[i + 1] - b[i + 1]; d[i + 2] = 128 + d[i + 2] - b[i + 2]; }
      return img;
    }
  });
  defFilter({
    id: 'clarity', name: 'Clarity', category: 'Sharpen',
    params: [range('amount', 'Amount', 40, -100, 100), range('radius', 'Radius', 20, 2, 200, 1, 'px')],
    apply: function (img, p) {
      var amt = p.amount / 100 * 1.6;
      if (!amt) return img;
      var w = img.width, h = img.height, L = lumPlane(img), B = gaussPlane(L, w, h, p.radius), d = img.data, n = w * h;
      for (var i = 0, j = 0; i < n; i++, j += 4) {
        var l = L[i] / 255, mid = 1 - (2 * l - 1) * (2 * l - 1);
        var delta = (L[i] - B[i]) * amt * (0.25 + 0.75 * mid);
        d[j] += delta; d[j + 1] += delta; d[j + 2] += delta;
      }
      return img;
    }
  });

  // ==========================================================================
  //  FILTERS — Noise
  // ==========================================================================
  defFilter({
    id: 'addNoise', name: 'Add Noise', category: 'Noise',
    params: [range('amount', 'Amount', 12, 0, 100, 0.5, '%'), select('distribution', 'Distribution', 'gaussian', [['uniform', 'Uniform'], ['gaussian', 'Gaussian']]), check('monochromatic', 'Monochromatic', false), seedParam()],
    apply: function (img, p, opts) {
      var a = p.amount / 100 * 255, seed = effSeed(p, opts), R = rng(seed), d = img.data, n = d.length;
      if (!a) return img;
      var mono = p.monochromatic;
      if (p.distribution === 'uniform') {
        for (var i = 0; i < n; i += 4) {
          if (mono) { var v = (R() * 2 - 1) * a; d[i] += v; d[i + 1] += v; d[i + 2] += v; }
          else { d[i] += (R() * 2 - 1) * a; d[i + 1] += (R() * 2 - 1) * a; d[i + 2] += (R() * 2 - 1) * a; }
        }
      } else {
        var G = gaussTable(seed), s = a * 0.5, x = (seed ^ 0x9e3779b9) >>> 0 || 1;
        for (var k = 0; k < n; k += 4) {
          x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
          if (mono) { var g = G[x & 65535] * s; d[k] += g; d[k + 1] += g; d[k + 2] += g; }
          else { d[k] += G[x & 65535] * s; d[k + 1] += G[(x >>> 16) & 65535] * s; d[k + 2] += G[((x >>> 8) ^ (x << 3)) & 65535] * s; }
        }
      }
      return img;
    }
  });

  /** Huang sliding-histogram median of channel c (interleaved RGBA). */
  function medianChannel(src, dst, w, h, c, r) {
    var hist = new Int32Array(256), half = ((2 * r + 1) * (2 * r + 1)) >> 1, rows = new Int32Array(2 * r + 1), wm = w - 1, hm = h - 1;
    for (var y = 0; y < h; y++) {
      var dy, k;
      for (dy = -r; dy <= r; dy++) { var yy = y + dy; rows[dy + r] = (yy < 0 ? 0 : (yy > hm ? hm : yy)) * w; }
      hist.fill(0);
      for (k = 0; k <= 2 * r; k++) for (var dx = -r; dx <= r; dx++) { var xx = dx < 0 ? 0 : (dx > wm ? wm : dx); hist[src[((rows[k] + xx) << 2) + c]]++; }
      var m = 0, lt = 0;
      while (lt + hist[m] <= half) { lt += hist[m]; m++; }
      dst[((y * w) << 2) + c] = m;
      for (var x = 1; x < w; x++) {
        var xo = x - r - 1, xi = x + r;
        xo = xo < 0 ? 0 : xo; xi = xi > wm ? wm : xi;
        for (k = 0; k <= 2 * r; k++) {
          var vo = src[((rows[k] + xo) << 2) + c], vi = src[((rows[k] + xi) << 2) + c];
          hist[vo]--; if (vo < m) lt--;
          hist[vi]++; if (vi < m) lt++;
        }
        if (lt > half) { do { m--; lt -= hist[m]; } while (lt > half); }
        else { while (lt + hist[m] <= half) { lt += hist[m]; m++; } }
        dst[((y * w + x) << 2) + c] = m;
      }
    }
  }
  /**
   * Constant-time median (Perreault & Hebert 2007) of channel c: per-column histograms with a
   * 16x16 coarse/fine split; the kernel's fine histograms are synchronised lazily.
   */
  function medianChannelCT(src, dst, w, h, c, r) {
    var wm = w - 1, hm = h - 1, colF = new Uint16Array(w * 256), colC = new Uint16Array(w * 16), x, y, k, b;
    var half = ((2 * r + 1) * (2 * r + 1)) >> 1, KC = new Int32Array(16), KF = new Int32Array(256), last = new Int32Array(16);
    function addRow(yy, sgn) {
      var row = yy * w;
      for (var xx = 0; xx < w; xx++) { var v = src[((row + xx) << 2) + c]; colF[(xx << 8) + v] += sgn; colC[(xx << 4) + (v >> 4)] += sgn; }
    }
    for (k = -r; k <= r; k++) addRow(k < 0 ? 0 : (k > hm ? hm : k), 1);
    for (y = 0; y < h; y++) {
      if (y > 0) { var yo = y - r - 1, yi = y + r; addRow(yo < 0 ? 0 : yo, -1); addRow(yi > hm ? hm : yi, 1); }
      KC.fill(0); for (b = 0; b < 16; b++) last[b] = -0x7fffffff;
      for (k = -r; k <= r; k++) { var cx = (k < 0 ? 0 : (k > wm ? wm : k)) << 4; for (b = 0; b < 16; b++) KC[b] += colC[cx + b]; }
      for (x = 0; x < w; x++) {
        if (x > 0) {
          var xa = x + r, xs = x - r - 1; xa = (xa > wm ? wm : xa) << 4; xs = (xs < 0 ? 0 : xs) << 4;
          for (b = 0; b < 16; b++) KC[b] += colC[xa + b] - colC[xs + b];
        }
        var acc = 0; b = 0;
        while (acc + KC[b] <= half) { acc += KC[b]; b++; }
        var fb = b << 4, i;
        if (x - last[b] > 2 * r + 1) {          // rebuild this coarse bin's fine histogram
          for (i = 0; i < 16; i++) KF[fb + i] = 0;
          for (k = -r; k <= r; k++) { var cf = ((x + k < 0 ? 0 : (x + k > wm ? wm : x + k)) << 8) + fb; for (i = 0; i < 16; i++) KF[fb + i] += colF[cf + i]; }
        } else {
          for (var xx2 = last[b] + 1; xx2 <= x; xx2++) {
            var pa = xx2 + r, ps = xx2 - r - 1; pa = ((pa > wm ? wm : pa) << 8) + fb; ps = ((ps < 0 ? 0 : ps) << 8) + fb;
            for (i = 0; i < 16; i++) KF[fb + i] += colF[pa + i] - colF[ps + i];
          }
        }
        last[b] = x;
        i = 0;
        while (acc + KF[fb + i] <= half) { acc += KF[fb + i]; i++; }
        dst[((y * w + x) << 2) + c] = fb + i;
      }
    }
  }
  function medianImage(img, r, withAlpha) {
    var src = new Uint8ClampedArray(img.data), dst = img.data;
    for (var c = 0; c < (withAlpha ? 4 : 3); c++) {
      if (r >= 12) medianChannelCT(src, dst, img.width, img.height, c, r);
      else medianChannel(src, dst, img.width, img.height, c, r);
    }
    return { img: img, orig: src };
  }
  function isOpaque(img) { var d = img.data; for (var i = 3; i < d.length; i += 4) if (d[i] !== 255) return false; return true; }
  defFilter({
    id: 'median', name: 'Median', category: 'Noise',
    params: [range('radius', 'Radius', 2, 1, 50, 1, 'px')],
    apply: function (img, p) { medianImage(img, Math.max(1, Math.round(p.radius)), !isOpaque(img)); return img; }
  });

  defFilter({
    id: 'dustScratches', name: 'Dust & Scratches', category: 'Noise',
    params: [range('radius', 'Radius', 2, 1, 50, 1, 'px'), range('threshold', 'Threshold', 10, 0, 255, 1, 'levels')],
    apply: function (img, p) {
      var res = medianImage(img, Math.max(1, Math.round(p.radius)), false), d = img.data, o = res.orig, t = p.threshold, n = d.length;
      for (var i = 0; i < n; i += 4) {
        var diff = Math.abs(o[i] - d[i]) + Math.abs(o[i + 1] - d[i + 1]) + Math.abs(o[i + 2] - d[i + 2]);
        if (diff / 3 <= t) { d[i] = o[i]; d[i + 1] = o[i + 1]; d[i + 2] = o[i + 2]; }
      }
      return img;
    }
  });

  defFilter({
    id: 'reduceNoise', name: 'Reduce Noise', category: 'Noise',
    params: [range('strength', 'Strength', 6, 0, 10, 1), range('preserveDetails', 'Preserve Details', 40, 0, 100, 1, '%'), range('colorNoise', 'Reduce Color Noise', 50, 0, 100, 1, '%')],
    apply: function (img, p) {
      var w = img.width, h = img.height, n = w * h, d = img.data, s = p.strength;
      if (!s && !p.colorNoise) return img;
      var Y = new Float32Array(n), Cb = new Float32Array(n), Cr = new Float32Array(n), i, j;
      for (i = 0, j = 0; i < n; i++, j += 4) {
        var r = d[j], g = d[j + 1], b = d[j + 2];
        Y[i] = 0.299 * r + 0.587 * g + 0.114 * b; Cb[i] = -0.168736 * r - 0.331264 * g + 0.5 * b; Cr[i] = 0.5 * r - 0.418688 * g - 0.081312 * b;
      }
      if (s > 0) {
        var Yd = new Float32Array(n), Yt = new Float32Array(n), rad = Math.ceil(1 + s * 0.5), ss = 0.7 + s * 0.3, sr = 3 + s * 3.2;
        var taps = 2 * rad + 1, sw = new Float32Array(taps), rl = new Float32Array(512);
        for (var k = -rad; k <= rad; k++) sw[k + rad] = Math.exp(-(k * k) / (2 * ss * ss));
        for (k = 0; k < 512; k++) rl[k] = Math.exp(-(k * k) / (2 * sr * sr));
        var passBil = function (S, D, horiz) {
          for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
            var o = y * w + x, c = S[o], acc = 0, ws = 0;
            for (var t = -rad; t <= rad; t++) {
              var q;
              if (horiz) { var xx = x + t; xx = xx < 0 ? 0 : (xx >= w ? w - 1 : xx); q = y * w + xx; }
              else { var yy = y + t; yy = yy < 0 ? 0 : (yy >= h ? h - 1 : yy); q = yy * w + x; }
              var v = S[q], df = v - c; df = df < 0 ? -df : df;
              var wt = sw[t + rad] * rl[df > 511 ? 511 : df | 0];
              acc += v * wt; ws += wt;
            }
            D[o] = acc / ws;
          }
        };
        passBil(Y, Yt, true); passBil(Yt, Yd, false);
        passBil(Yd, Yt, true); passBil(Yt, Yd, false);
        var keep = p.preserveDetails / 100 * 0.7;
        for (i = 0; i < n; i++) Y[i] = Yd[i] + (Y[i] - Yd[i]) * keep;
      }
      var cs = p.colorNoise / 100 * 5;
      if (cs > 0.3) gaussPlanes([Cb, Cr], w, h, cs);
      for (i = 0, j = 0; i < n; i++, j += 4) {
        d[j] = Y[i] + 1.402 * Cr[i]; d[j + 1] = Y[i] - 0.344136 * Cb[i] - 0.714136 * Cr[i]; d[j + 2] = Y[i] + 1.772 * Cb[i];
      }
      return img;
    }
  });

  // ==========================================================================
  //  FILTERS — Stylize
  // ==========================================================================
  defFilter({
    id: 'emboss', name: 'Emboss', category: 'Stylize',
    params: [angle('angle', 'Angle', 135), range('height', 'Height', 3, 1, 10, 1, 'px'), range('amount', 'Amount', 100, 1, 500, 1, '%'), check('keepColor', 'Keep Color', false)],
    apply: function (img, p) {
      var w = img.width, h = img.height, L = lumPlane(img), a = p.angle * Math.PI / 180;
      var dx = Math.cos(a) * p.height / 2, dy = -Math.sin(a) * p.height / 2, k = p.amount / 100 * 1.2, d = img.data;
      for (var y = 0, i = 0; y < h; y++) for (var x = 0; x < w; x++, i++) {
        var e = (samplePlane(L, w, h, x + dx, y + dy) - samplePlane(L, w, h, x - dx, y - dy)) * k, j = i << 2;
        if (p.keepColor) { d[j] += e; d[j + 1] += e; d[j + 2] += e; }
        else d[j] = d[j + 1] = d[j + 2] = 128 + e;
      }
      return img;
    }
  });

  defFilter({
    id: 'findEdges', name: 'Find Edges', category: 'Stylize',
    params: [range('strength', 'Strength', 100, 10, 400, 1, '%'), check('invert', 'Dark Edges on White', true)],
    apply: function (img, p) {
      var w = img.width, h = img.height, d = img.data, k = p.strength / 100 * 0.6, inv = p.invert;
      for (var c = 0; c < 3; c++) {
        var e = sobelPlane(channelPlane(img, c), w, h);
        for (var i = 0, j = c; i < e.length; i++, j += 4) { var v = e[i] * k; d[j] = inv ? 255 - v : v; }
      }
      return img;
    }
  });

  defFilter({
    id: 'glowingEdges', name: 'Glowing Edges', category: 'Stylize',
    params: [range('width', 'Edge Width', 2, 1, 14), range('brightness', 'Edge Brightness', 6, 0, 20), range('smoothness', 'Smoothness', 5, 1, 15)],
    apply: function (img, p) {
      var w = img.width, h = img.height, d = img.data, sm = blurredCopy(img, p.smoothness * 0.35), k = p.brightness / 6 * 0.9;
      var planes = [];
      for (var c = 0; c < 3; c++) {
        var e = sobelPlane(channelPlane(sm, c), w, h);
        for (var i = 0; i < e.length; i++) { var v = e[i] * k; e[i] = v > 255 ? 255 : v; }
        planes.push(e);
      }
      if (p.width > 1) { morphPlanes(planes, w, h, Math.round(p.width - 1), true); gaussPlanes(planes, w, h, 0.6); }
      for (c = 0; c < 3; c++) for (var q = 0, j = c; q < planes[c].length; q++, j += 4) d[j] = planes[c][q];
      return img;
    }
  });

  defFilter({
    id: 'solarize', name: 'Solarize', category: 'Stylize',
    params: [range('threshold', 'Threshold', 128, 0, 255)],
    apply: function (img, p) { var t = p.threshold, l = lutFrom(function (v) { return v > t ? 255 - v : v; }); return applyLUT3(img, l, l, l); }
  });

  defFilter({
    id: 'diffuse', name: 'Diffuse', category: 'Stylize',
    params: [select('mode', 'Mode', 'normal', [['normal', 'Normal'], ['darken', 'Darken Only'], ['lighten', 'Lighten Only']]), range('radius', 'Radius', 3, 1, 20, 1, 'px'), seedParam()],
    apply: function (img, p, opts) {
      var w = img.width, h = img.height, src = new Uint8ClampedArray(img.data), d = img.data, R = rng(effSeed(p, opts)), r = Math.round(p.radius), span = 2 * r + 1;
      var mode = p.mode === 'darken' ? 1 : (p.mode === 'lighten' ? 2 : 0);
      for (var y = 0, i = 0; y < h; y++) for (var x = 0; x < w; x++, i += 4) {
        var xx = x + ((R() * span) | 0) - r, yy = y + ((R() * span) | 0) - r;
        xx = xx < 0 ? 0 : (xx >= w ? w - 1 : xx); yy = yy < 0 ? 0 : (yy >= h ? h - 1 : yy);
        var q = (yy * w + xx) << 2;
        if (mode) {
          var lq = luminance(src[q], src[q + 1], src[q + 2]), li = luminance(src[i], src[i + 1], src[i + 2]);
          if (mode === 1 ? lq >= li : lq <= li) continue;
        }
        d[i] = src[q]; d[i + 1] = src[q + 1]; d[i + 2] = src[q + 2]; d[i + 3] = src[q + 3];
      }
      return img;
    }
  });

  defFilter({
    id: 'oilPaint', name: 'Oil Paint', category: 'Stylize',
    params: [range('radius', 'Brush Radius', 4, 1, 10, 1, 'px'), range('levels', 'Intensity Levels', 20, 4, 64)],
    apply: function (img, p) {
      var w = img.width, h = img.height, r = Math.round(p.radius), L = Math.round(p.levels), src = new Uint8ClampedArray(img.data), d = img.data;
      var n = w * h, bucket = new Uint8Array(n), i, wm = w - 1, hm = h - 1;
      for (i = 0; i < n; i++) { var j = i << 2; bucket[i] = Math.min(L - 1, ((0.299 * src[j] + 0.587 * src[j + 1] + 0.114 * src[j + 2]) * L / 256) | 0); }
      var cnt = new Int32Array(L), sr = new Float64Array(L), sg = new Float64Array(L), sb = new Float64Array(L), rows = new Int32Array(2 * r + 1);
      for (var y = 0; y < h; y++) {
        cnt.fill(0); sr.fill(0); sg.fill(0); sb.fill(0);
        for (var k = -r; k <= r; k++) { var yy = y + k; rows[k + r] = (yy < 0 ? 0 : (yy > hm ? hm : yy)) * w; }
        var add = function (xx, sgn) {
          for (var t = 0; t <= 2 * r; t++) {
            var q = rows[t] + xx, b = bucket[q], qq = q << 2;
            cnt[b] += sgn; sr[b] += sgn * src[qq]; sg[b] += sgn * src[qq + 1]; sb[b] += sgn * src[qq + 2];
          }
        };
        for (k = -r; k <= r; k++) add(k < 0 ? 0 : (k > wm ? wm : k), 1);
        for (var x = 0; x < w; x++) {
          if (x > 0) { var xo = x - r - 1, xi = x + r; add(xo < 0 ? 0 : xo, -1); add(xi > wm ? wm : xi, 1); }
          var best = 0, bc = -1;
          for (var b = 0; b < L; b++) if (cnt[b] > bc) { bc = cnt[b]; best = b; }
          var o = (y * w + x) << 2;
          d[o] = sr[best] / bc; d[o + 1] = sg[best] / bc; d[o + 2] = sb[best] / bc;
        }
      }
      return img;
    }
  });

  defFilter({
    id: 'posterizeEdges', name: 'Posterize Edges', category: 'Stylize',
    params: [range('thickness', 'Edge Thickness', 2, 0, 10), range('intensity', 'Edge Intensity', 2, 0, 10), range('levels', 'Posterization', 6, 2, 16)],
    apply: function (img, p) {
      var w = img.width, h = img.height, n = w * h, d = img.data, L = lumPlane(img);
      var E = sobelPlane(gaussPlane(L, w, h, 0.6 + p.thickness * 0.35), w, h), k = p.intensity / 2 / 255 * 0.9;
      var lv = Math.round(p.levels), post = lutFrom(function (v) { return Math.round(Math.round(v / 255 * (lv - 1)) / (lv - 1) * 255); });
      for (var i = 0, j = 0; i < n; i++, j += 4) {
        var e = clamp01((E[i] * k - 0.15) * 1.6), f = 1 - e;
        d[j] = post[d[j]] * f; d[j + 1] = post[d[j + 1]] * f; d[j + 2] = post[d[j + 2]] * f;
      }
      return img;
    }
  });

  defFilter({
    id: 'wind', name: 'Wind', category: 'Stylize',
    params: [select('method', 'Method', 'wind', [['wind', 'Wind'], ['blast', 'Blast'], ['stagger', 'Stagger']]), select('direction', 'Direction', 'fromRight', [['fromRight', 'From the Right'], ['fromLeft', 'From the Left']]), range('strength', 'Strength', 50, 1, 100), seedParam()],
    apply: function (img, p, opts) {
      var w = img.width, h = img.height, d = img.data, src = new Uint8ClampedArray(d), R = rng(effSeed(p, opts));
      var blast = p.method === 'blast', maxLen = (8 + p.strength * 1.2) * (blast ? 2.5 : 1) * Math.max(1, w / 1000);
      var startP = 0.04 + p.strength / 100 * 0.25;
      for (var y = 0; y < h; y++) {
        var dir = p.direction === 'fromRight' ? -1 : 1;
        if (p.method === 'stagger' && R() < 0.5) dir = -dir;
        var x = dir > 0 ? 0 : w - 1, sr = 0, sg = 0, sb = 0, sl = 0, s = 0, decay = 0;
        for (var c = 0; c < w; c++, x += dir) {
          var o = (y * w + x) << 2, r = src[o], g = src[o + 1], b = src[o + 2], L = luminance(r, g, b);
          var cur = sl * s;                       // current (decayed) streak brightness
          if (L > cur + 12 && R() < startP) {     // a brighter pixel launches a new streak
            sr = r; sg = g; sb = b; sl = L; s = 1; decay = 1 / (maxLen * (0.2 + R() * 0.8));
            continue;
          }
          if (s > 0) {
            if (L < cur) {
              var t = s * (blast ? 1 : 0.85);
              d[o] = r + (sr - r) * t; d[o + 1] = g + (sg - g) * t; d[o + 2] = b + (sb - b) * t;
            }
            s -= decay;
          }
        }
      }
      return img;
    }
  });

  defFilter({
    id: 'tiles', name: 'Tiles', category: 'Stylize',
    params: [range('count', 'Number of Tiles', 10, 1, 99), range('offset', 'Maximum Offset', 10, 1, 99, 1, '%'), select('fill', 'Fill Empty Area With', 'color', [['color', 'Background Color'], ['transparent', 'Transparent'], ['inverse', 'Inverse Image'], ['original', 'Unaltered Image']]), color('background', 'Background Color', '#ffffff'), seedParam()],
    apply: function (img, p, opts) {
      var w = img.width, h = img.height, src = new Uint8ClampedArray(img.data), d = img.data, R = rng(effSeed(p, opts));
      var ts = Math.max(2, Math.floor(Math.min(w, h) / p.count)), maxOff = ts * p.offset / 100, bg = hexToRgb(p.background), i;
      for (i = 0; i < d.length; i += 4) {
        if (p.fill === 'transparent') { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; }
        else if (p.fill === 'inverse') { d[i] = 255 - src[i]; d[i + 1] = 255 - src[i + 1]; d[i + 2] = 255 - src[i + 2]; }
        else if (p.fill === 'color') { d[i] = bg[0]; d[i + 1] = bg[1]; d[i + 2] = bg[2]; d[i + 3] = 255; }
      }
      for (var ty = 0; ty < h; ty += ts) for (var tx = 0; tx < w; tx += ts) {
        var ox = Math.round((R() * 2 - 1) * maxOff), oy = Math.round((R() * 2 - 1) * maxOff);
        for (var y = ty; y < Math.min(h, ty + ts); y++) {
          var yy = y + oy; if (yy < 0 || yy >= h) continue;
          for (var x = tx; x < Math.min(w, tx + ts); x++) {
            var xx = x + ox; if (xx < 0 || xx >= w) continue;
            var s = (y * w + x) << 2, t = (yy * w + xx) << 2;
            d[t] = src[s]; d[t + 1] = src[s + 1]; d[t + 2] = src[s + 2]; d[t + 3] = src[s + 3];
          }
        }
      }
      return img;
    }
  });

  // ==========================================================================
  //  FILTERS — Distort  (bilinear sampling, selectable edge mode)
  // ==========================================================================
  defFilter({
    id: 'twirl', name: 'Twirl', category: 'Distort',
    params: [angle('angle', 'Angle', 120, -999, 999), range('radius', 'Radius', 100, 1, 150, 1, '%'), edgeParam()],
    apply: function (img, p) {
      var w = img.width, h = img.height, cx = (w - 1) / 2, cy = (h - 1) / 2, R = Math.min(w, h) / 2 * p.radius / 100, A = p.angle * Math.PI / 180;
      return warp(img, p.edge, function (x, y, o) {
        var dx = x - cx, dy = y - cy, dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= R) return;
        var t = 1 - dist / R, a = A * t * t, c = Math.cos(a), s = Math.sin(a);
        o[0] = cx + dx * c - dy * s; o[1] = cy + dx * s + dy * c;
      });
    }
  });

  defFilter({
    id: 'pinch', name: 'Pinch', category: 'Distort',
    params: [range('amount', 'Amount', 50, -100, 100, 1, '%'), edgeParam()],
    apply: function (img, p) {
      var w = img.width, h = img.height, cx = (w - 1) / 2, cy = (h - 1) / 2, rx = w / 2, ry = h / 2, a = p.amount / 100;
      return warp(img, p.edge, function (x, y, o) {
        var dx = (x - cx) / rx, dy = (y - cy) / ry, d = Math.sqrt(dx * dx + dy * dy);
        if (d >= 1 || d === 0) return;
        var f = Math.pow(Math.sin(Math.PI / 2 * d), -a);
        // keep the scale finite near the centre
        if (f > 6) f = 6;
        var blend = smoothstep(1, 0.75, d); f = 1 + (f - 1) * blend;
        o[0] = cx + dx * f * rx; o[1] = cy + dy * f * ry;
      });
    }
  });

  defFilter({
    id: 'spherize', name: 'Spherize', category: 'Distort',
    params: [range('amount', 'Amount', 70, -100, 100, 1, '%'), select('mode', 'Mode', 'normal', [['normal', 'Normal'], ['horizontal', 'Horizontal Only'], ['vertical', 'Vertical Only']]), edgeParam()],
    apply: function (img, p) {
      var w = img.width, h = img.height, cx = (w - 1) / 2, cy = (h - 1) / 2, rx = w / 2, ry = h / 2, a = p.amount / 100, m = p.mode;
      if (m === 'horizontal') ry = 1e9; else if (m === 'vertical') rx = 1e9;
      var aa = Math.abs(a);
      return warp(img, p.edge, function (x, y, o) {
        var dx = (x - cx) / rx, dy = (y - cy) / ry;
        if (m === 'horizontal') dy = 0; else if (m === 'vertical') dx = 0;
        var t = Math.sqrt(dx * dx + dy * dy);
        if (t >= 1 || t === 0) return;
        var f = a > 0 ? Math.asin(t) / (Math.PI / 2) : Math.sin(t * Math.PI / 2);
        var s = (t + (f - t) * aa) / t;
        if (m !== 'vertical') o[0] = cx + (x - cx) * s;
        if (m !== 'horizontal') o[1] = cy + (y - cy) * s;
      });
    }
  });

  defFilter({
    id: 'ripple', name: 'Ripple', category: 'Distort',
    params: [range('amount', 'Amount', 100, -999, 999, 1, '%'), select('size', 'Size', 'medium', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]), edgeParam()],
    apply: function (img, p) {
      var per = p.size === 'small' ? 7 : (p.size === 'large' ? 34 : 15), A = p.amount / 100 * per * 0.22;
      var k = 2 * Math.PI / per;
      return warp(img, p.edge, function (x, y, o) {
        o[0] = x + A * Math.sin(y * k + Math.sin(x * k * 0.13) * 1.7);
        o[1] = y + A * Math.sin(x * k + Math.sin(y * k * 0.11) * 1.7);
      });
    }
  });

  defFilter({
    id: 'wave', name: 'Wave', category: 'Distort',
    params: [range('wavelength', 'Wavelength', 80, 2, 999, 1, 'px'), range('amplitude', 'Amplitude', 12, 0, 999, 1, 'px'), select('direction', 'Direction', 'both', [['both', 'Both'], ['horizontal', 'Horizontal'], ['vertical', 'Vertical']]), select('type', 'Type', 'sine', [['sine', 'Sine'], ['triangle', 'Triangle'], ['square', 'Square']]), edgeParam()],
    apply: function (img, p) {
      var L = p.wavelength, A = p.amplitude, t = p.type, dir = p.direction;
      function f(v) {
        var ph = v / L; ph -= Math.floor(ph);
        if (t === 'triangle') return ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
        if (t === 'square') return ph < 0.5 ? 1 : -1;
        return Math.sin(ph * 2 * Math.PI);
      }
      return warp(img, p.edge, function (x, y, o) {
        if (dir !== 'vertical') o[0] = x + A * f(y);
        if (dir !== 'horizontal') o[1] = y + A * f(x + L * 0.25);
      });
    }
  });

  defFilter({
    id: 'polarCoordinates', name: 'Polar Coordinates', category: 'Distort',
    params: [select('mode', 'Mode', 'rectToPolar', [['rectToPolar', 'Rectangular to Polar'], ['polarToRect', 'Polar to Rectangular']]), edgeParam('wrap')],
    apply: function (img, p) {
      var w = img.width, h = img.height, cx = w / 2, cy = h / 2, TWO = 2 * Math.PI;
      if (p.mode === 'polarToRect') {
        return warp(img, p.edge, function (x, y, o) {
          var ang = (x + 0.5) / w * TWO, rad = (y + 0.5) / h;
          o[0] = cx + Math.sin(ang) * rad * cx - 0.5; o[1] = cy - Math.cos(ang) * rad * cy - 0.5;
        });
      }
      return warp(img, p.edge, function (x, y, o) {
        var dx = (x + 0.5 - cx) / cx, dy = (y + 0.5 - cy) / cy;
        var ang = Math.atan2(dx, -dy); if (ang < 0) ang += TWO;
        o[0] = ang / TWO * w - 0.5; o[1] = Math.sqrt(dx * dx + dy * dy) * h - 0.5;
      });
    }
  });

  defFilter({
    id: 'zigzag', name: 'ZigZag', category: 'Distort',
    params: [range('amount', 'Amount', 40, -100, 100), range('ridges', 'Ridges', 6, 1, 20), edgeParam()],
    apply: function (img, p) {
      var w = img.width, h = img.height, cx = (w - 1) / 2, cy = (h - 1) / 2, R = Math.min(w, h) / 2, A = p.amount / 100 * R * 0.15, rid = p.ridges;
      return warp(img, p.edge, function (x, y, o) {
        var dx = x - cx, dy = y - cy, d = Math.sqrt(dx * dx + dy * dy);
        if (d >= R || d === 0) return;
        var fall = 1 - d / R, disp = A * Math.sin(d / R * rid * 2 * Math.PI) * fall;
        o[0] = x + dx / d * disp; o[1] = y + dy / d * disp;
      });
    }
  });

  defFilter({
    id: 'turbulence', name: 'Turbulence', category: 'Distort',
    params: [range('amount', 'Amount', 20, 0, 200, 1, 'px'), range('scale', 'Scale', 80, 4, 1000, 1, 'px'), range('detail', 'Detail', 3, 1, 8), seedParam(), edgeParam()],
    apply: function (img, p, opts) {
      var s = effSeed(p, opts), N1 = makeNoise(s), N2 = makeNoise(s ^ 0x5bd1e995), sc = 1 / p.scale, A = p.amount, oct = Math.round(p.detail);
      var w = img.width, h = img.height;
      // the finest octave has a period of scale/2^(oct-1); sample the field ~6x per period and interpolate
      var step = Math.max(1, Math.min(8, Math.floor(p.scale / Math.pow(2, oct - 1) / 6)));
      var gw = Math.ceil(w / step) + 2, gh = Math.ceil(h / step) + 2, DX = new Float32Array(gw * gh), DY = new Float32Array(gw * gh);
      for (var gy = 0; gy < gh; gy++) for (var gx = 0; gx < gw; gx++) {
        var x = gx * step, y = gy * step, k = gy * gw + gx;
        DX[k] = A * N1.fbm(x * sc, y * sc, oct, 0.5); DY[k] = A * N2.fbm(x * sc + 31.7, y * sc + 11.3, oct, 0.5);
      }
      var inv = 1 / step;
      return warp(img, p.edge, function (x, y, o) {
        var u = x * inv, v = y * inv;
        o[0] = x + samplePlane(DX, gw, gh, u, v); o[1] = y + samplePlane(DY, gw, gh, u, v);
      });
    }
  });

  defFilter({
    id: 'lensCorrection', name: 'Lens Correction', category: 'Distort',
    params: [range('distortion', 'Distortion (+barrel / −pincushion)', 25, -100, 100), range('scale', 'Scale', 100, 50, 150, 1, '%'),
      range('vignette', 'Vignette Amount', 0, -100, 100), range('midpoint', 'Vignette Midpoint', 50, 0, 100), edgeParam('transparent')],
    apply: function (img, p) {
      var w = img.width, h = img.height, cx = (w - 1) / 2, cy = (h - 1) / 2, R = Math.sqrt(cx * cx + cy * cy) || 1;
      var k = p.distortion / 100 * 0.45, sc = 100 / p.scale, out = img;
      if (k || sc !== 1) {
        out = warp(img, p.edge, function (x, y, o) {
          var dx = (x - cx) / R * sc, dy = (y - cy) / R * sc, r2 = dx * dx + dy * dy, f = 1 + k * r2;
          o[0] = cx + dx * f * R; o[1] = cy + dy * f * R;
        });
      }
      var v = p.vignette / 100;
      if (v) {
        var d = out.data, mid = 0.2 + p.midpoint / 100 * 0.8;
        for (var y = 0, i = 0; y < h; y++) for (var x = 0; x < w; x++, i += 4) {
          var rr = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / R, m = smoothstep(mid * 0.5, 1.15, rr) * Math.abs(v);
          if (v < 0) { var f2 = 1 - m; d[i] *= f2; d[i + 1] *= f2; d[i + 2] *= f2; }
          else { d[i] += (255 - d[i]) * m; d[i + 1] += (255 - d[i + 1]) * m; d[i + 2] += (255 - d[i + 2]) * m; }
        }
      }
      return out;
    }
  });

  // ==========================================================================
  //  FILTERS — Pixelate
  // ==========================================================================
  defFilter({
    id: 'pixelate', name: 'Mosaic', category: 'Pixelate',
    params: [range('cellSize', 'Cell Size', 12, 2, 200, 1, 'px')],
    apply: function (img, p) {
      var w = img.width, h = img.height, s = Math.round(p.cellSize), d = img.data;
      for (var by = 0; by < h; by += s) for (var bx = 0; bx < w; bx += s) {
        var ey = Math.min(h, by + s), ex = Math.min(w, bx + s), r = 0, g = 0, b = 0, a = 0, c = 0, x, y, i;
        for (y = by; y < ey; y++) for (x = bx; x < ex; x++) { i = (y * w + x) << 2; var al = d[i + 3]; r += d[i] * al; g += d[i + 1] * al; b += d[i + 2] * al; a += al; c++; }
        var R = a ? r / a : 0, G = a ? g / a : 0, B = a ? b / a : 0, A = a / c;
        for (y = by; y < ey; y++) for (x = bx; x < ex; x++) { i = (y * w + x) << 2; d[i] = R; d[i + 1] = G; d[i + 2] = B; d[i + 3] = A; }
      }
      return img;
    }
  });

  /** Jittered-grid feature points. Returns {px,py,gw,gh,s} */
  function jitterGrid(w, h, s, R, jitter) {
    var gw = Math.ceil(w / s) + 1, gh = Math.ceil(h / s) + 1, px = new Float32Array(gw * gh), py = new Float32Array(gw * gh);
    for (var gy = 0; gy < gh; gy++) for (var gx = 0; gx < gw; gx++) {
      var k = gy * gw + gx;
      px[k] = (gx + 0.5 + (R() - 0.5) * jitter) * s; py[k] = (gy + 0.5 + (R() - 0.5) * jitter) * s;
    }
    return { px: px, py: py, gw: gw, gh: gh, s: s };
  }
  defFilter({
    id: 'crystallize', name: 'Crystallize', category: 'Pixelate',
    params: [range('cellSize', 'Cell Size', 24, 3, 300, 1, 'px'), seedParam()],
    apply: function (img, p, opts) {
      var w = img.width, h = img.height, s = p.cellSize, G = jitterGrid(w, h, s, rng(effSeed(p, opts)), 0.95), d = img.data;
      var lab = new Int32Array(w * h), nc = G.gw * G.gh, sr = new Float64Array(nc), sg = new Float64Array(nc), sb = new Float64Array(nc), sa = new Float64Array(nc), cn = new Float64Array(nc);
      for (var y = 0, i = 0; y < h; y++) {
        var gy = Math.floor(y / s);
        for (var x = 0; x < w; x++, i++) {
          var gx = Math.floor(x / s), best = 1e30, bk = 0;
          for (var oy = -1; oy <= 1; oy++) {
            var yy = gy + oy; if (yy < 0 || yy >= G.gh) continue;
            for (var ox = -1; ox <= 1; ox++) {
              var xx = gx + ox; if (xx < 0 || xx >= G.gw) continue;
              var k = yy * G.gw + xx, ddx = G.px[k] - x, ddy = G.py[k] - y, dd = ddx * ddx + ddy * ddy;
              if (dd < best) { best = dd; bk = k; }
            }
          }
          lab[i] = bk;
          var j = i << 2, a = d[j + 3];
          sr[bk] += d[j] * a; sg[bk] += d[j + 1] * a; sb[bk] += d[j + 2] * a; sa[bk] += a; cn[bk]++;
        }
      }
      for (i = 0; i < w * h; i++) {
        var L = lab[i], q = i << 2, A = sa[L];
        d[q] = A ? sr[L] / A : 0; d[q + 1] = A ? sg[L] / A : 0; d[q + 2] = A ? sb[L] / A : 0; d[q + 3] = A / cn[L];
      }
      return img;
    }
  });

  defFilter({
    id: 'pointillize', name: 'Pointillize', category: 'Pixelate',
    params: [range('cellSize', 'Cell Size', 10, 3, 300, 1, 'px'), color('background', 'Background', '#ffffff'), seedParam()],
    apply: function (img, p, opts) {
      var w = img.width, h = img.height, s = p.cellSize, R = rng(effSeed(p, opts)), G = jitterGrid(w, h, s, R, 1.0), src = new Uint8ClampedArray(img.data), d = img.data;
      var nc = G.gw * G.gh, rad = new Float32Array(nc), col = new Float32Array(nc * 3), smp = new Float64Array(4), bg = hexToRgb(p.background), k;
      for (k = 0; k < nc; k++) {
        rad[k] = s * (0.62 + R() * 0.22);
        bilinearInto(src, w, h, G.px[k], G.py[k], EDGE_CLAMP, smp, 0);
        var jit = (R() - 0.5) * 30;
        // a dot centred on transparent pixels has no colour of its own: use the background (no black dots on alpha edges)
        if (smp[3] < 1) { smp[0] = bg[0]; smp[1] = bg[1]; smp[2] = bg[2]; }
        col[k * 3] = smp[0] + jit; col[k * 3 + 1] = smp[1] + jit; col[k * 3 + 2] = smp[2] + jit;
      }
      for (var y = 0, i = 0; y < h; y++) {
        var gy = Math.floor(y / s);
        for (var x = 0; x < w; x++, i += 4) {
          var gx = Math.floor(x / s), best = 1e9, bk = -1, bd = 0;
          for (var oy = -1; oy <= 1; oy++) {
            var yy = gy + oy; if (yy < 0 || yy >= G.gh) continue;
            for (var ox = -1; ox <= 1; ox++) {
              var xx = gx + ox; if (xx < 0 || xx >= G.gw) continue;
              k = yy * G.gw + xx;
              var dx = G.px[k] - x, dy = G.py[k] - y, dist = Math.sqrt(dx * dx + dy * dy), rel = dist / rad[k];
              if (rel < best) { best = rel; bk = k; bd = dist; }
            }
          }
          var cov = bk >= 0 ? clamp01(rad[bk] - bd + 0.5) : 0;
          var r = bg[0], g = bg[1], b = bg[2];
          if (cov > 0) { r += (col[bk * 3] - r) * cov; g += (col[bk * 3 + 1] - g) * cov; b += (col[bk * 3 + 2] - b) * cov; }
          d[i] = r; d[i + 1] = g; d[i + 2] = b;
        }
      }
      return img;
    }
  });

  defFilter({
    id: 'colorHalftone', name: 'Color Halftone', category: 'Pixelate',
    params: [range('maxRadius', 'Max Radius', 6, 2, 60, 1, 'px'), angle('angleC', 'Cyan Angle', 108, 0, 360), angle('angleM', 'Magenta Angle', 162, 0, 360), angle('angleY', 'Yellow Angle', 90, 0, 360), angle('angleK', 'Black Angle', 45, 0, 360)],
    apply: function (img, p) {
      var w = img.width, h = img.height, n = w * h, d = img.data, i, j;
      var C = new Float32Array(n), M = new Float32Array(n), Y = new Float32Array(n), K = new Float32Array(n);
      for (i = 0, j = 0; i < n; i++, j += 4) {
        var r = d[j] / 255, g = d[j + 1] / 255, b = d[j + 2] / 255, k = 1 - Math.max(r, g, b);
        K[i] = k;
        if (k < 1) { C[i] = (1 - r - k) / (1 - k); M[i] = (1 - g - k) / (1 - k); Y[i] = (1 - b - k) / (1 - k); }
      }
      var cell = 2 * p.maxRadius, planes = [C, M, Y, K], angles = [p.angleC, p.angleM, p.angleY, p.angleK], cov = [];
      gaussPlanes(planes, w, h, cell * 0.3);
      for (var c = 0; c < 4; c++) {
        var a = angles[c] * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), P = planes[c];
        // rotated bounding box
        var us = [0, w * ca, h * sa, w * ca + h * sa], vs = [0, -w * sa, h * ca, -w * sa + h * ca];
        var umin = Math.min.apply(null, us) - cell, vmin = Math.min.apply(null, vs) - cell;
        var gw = Math.ceil((Math.max.apply(null, us) - umin) / cell) + 2, gh = Math.ceil((Math.max.apply(null, vs) - vmin) / cell) + 2;
        var radii = new Float32Array(gw * gh);
        for (var gy = 0; gy < gh; gy++) for (var gx = 0; gx < gw; gx++) {
          var u = umin + (gx + 0.5) * cell, v = vmin + (gy + 0.5) * cell;
          var x = u * ca - v * sa, y = u * sa + v * ca;
          var val = (x < -cell || y < -cell || x > w + cell || y > h + cell) ? 0 : clamp01(samplePlane(P, w, h, x, y));
          radii[gy * gw + gx] = cell * 0.7071 * Math.sqrt(val);
        }
        var out = new Float32Array(n);
        for (var yy = 0, q = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++, q++) {
          var uu = (xx * ca + yy * sa - umin) / cell - 0.5, vv = (-xx * sa + yy * ca - vmin) / cell - 0.5;
          var i0 = Math.floor(uu), j0 = Math.floor(vv), best = 0;
          for (var oj = 0; oj <= 1; oj++) for (var oi = 0; oi <= 1; oi++) {
            var ii = i0 + oi, jj = j0 + oj;
            if (ii < 0 || jj < 0 || ii >= gw || jj >= gh) continue;
            var du = (uu - ii) * cell, dv = (vv - jj) * cell, dist = Math.sqrt(du * du + dv * dv);
            var cv = radii[jj * gw + ii] - dist + 0.5;
            if (cv > best) best = cv > 1 ? 1 : cv;
          }
          out[q] = best;
        }
        cov.push(out);
      }
      for (i = 0, j = 0; i < n; i++, j += 4) {
        var kk = 1 - cov[3][i];
        d[j] = 255 * (1 - cov[0][i]) * kk; d[j + 1] = 255 * (1 - cov[1][i]) * kk; d[j + 2] = 255 * (1 - cov[2][i]) * kk;
      }
      return img;
    }
  });

  defFilter({
    id: 'mezzotint', name: 'Mezzotint', category: 'Pixelate',
    params: [select('type', 'Type', 'fineDots', [['fineDots', 'Fine Dots'], ['coarseDots', 'Coarse Dots'], ['lines', 'Short Lines'], ['strokes', 'Long Strokes']]), seedParam()],
    apply: function (img, p, opts) {
      var w = img.width, h = img.height, d = img.data, R = rng(effSeed(p, opts)), t = p.type;
      var blk = t === 'coarseDots' ? 3 : 1, len = t === 'lines' ? 8 : (t === 'strokes' ? 32 : 1);
      var thr = new Float32Array(w * h * 3);
      for (var y = 0; y < h; y += blk) {
        for (var x = 0; x < w;) {
          var run = len > 1 ? Math.max(1, Math.round(len * (0.4 + R()))) : blk;
          var t0 = R() * 255, t1 = R() * 255, t2 = R() * 255;
          for (var yy = y; yy < Math.min(h, y + blk); yy++) for (var xx = x; xx < Math.min(w, x + run); xx++) {
            var k = (yy * w + xx) * 3; thr[k] = t0; thr[k + 1] = t1; thr[k + 2] = t2;
          }
          x += run;
        }
      }
      for (var i = 0, j = 0; i < d.length; i += 4, j += 3) { d[i] = d[i] > thr[j] ? 255 : 0; d[i + 1] = d[i + 1] > thr[j + 1] ? 255 : 0; d[i + 2] = d[i + 2] > thr[j + 2] ? 255 : 0; }
      return img;
    }
  });

  // ==========================================================================
  //  FILTERS — Render
  // ==========================================================================
  function blendChannel(mode, a, b) { // a = base, b = blend (0..255)
    switch (mode) {
      case 'multiply': return a * b / 255;
      case 'screen': return 255 - (255 - a) * (255 - b) / 255;
      case 'overlay': return a < 128 ? 2 * a * b / 255 : 255 - 2 * (255 - a) * (255 - b) / 255;
      case 'softLight': { var A = a / 255, B = b / 255; return 255 * (B < 0.5 ? A - (1 - 2 * B) * A * (1 - A) : A + (2 * B - 1) * ((A < 0.25 ? ((16 * A - 12) * A + 4) * A : Math.sqrt(A)) - A)); }
      case 'difference': return Math.abs(a - b);
      default: return b;
    }
  }
  var BLEND_OPTS = [['normal', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['softLight', 'Soft Light'], ['difference', 'Difference']];
  function renderClouds(img, p, opts, defMode) {
    var w = img.width, h = img.height, n = w * h, N = makeNoise(effSeed(p, opts)), sc = 1 / p.scale, oct = Math.round(p.detail), gain = p.roughness / 100;
    var F = new Float32Array(n), mn = 1e9, mx = -1e9, i;
    for (var y = 0, k = 0; y < h; y++) for (var x = 0; x < w; x++, k++) {
      var v = N.fbm(x * sc, y * sc, oct, gain); F[k] = v; if (v < mn) mn = v; if (v > mx) mx = v;
    }
    var fg = hexToRgb(p.foreground), bg = hexToRgb(p.background), d = img.data, inv = 1 / Math.max(1e-6, mx - mn), mode = p.blend || defMode, op = p.opacity / 100;
    for (i = 0; i < n; i++) {
      var t = (F[i] - mn) * inv, j = i << 2;
      var cr = bg[0] + (fg[0] - bg[0]) * t, cg = bg[1] + (fg[1] - bg[1]) * t, cb = bg[2] + (fg[2] - bg[2]) * t;
      if (mode === 'normal') {
        d[j] += (cr - d[j]) * op; d[j + 1] += (cg - d[j + 1]) * op; d[j + 2] += (cb - d[j + 2]) * op;
        d[j + 3] += (255 - d[j + 3]) * op;
      } else {
        d[j] += (blendChannel(mode, d[j], cr) - d[j]) * op; d[j + 1] += (blendChannel(mode, d[j + 1], cg) - d[j + 1]) * op; d[j + 2] += (blendChannel(mode, d[j + 2], cb) - d[j + 2]) * op;
      }
    }
    return img;
  }
  var cloudParams = function (mode) {
    return [color('foreground', 'Foreground', '#1e2a44'), color('background', 'Background', '#f4f1ea'), range('scale', 'Scale', 220, 4, 2000, 1, 'px'), range('detail', 'Detail', 7, 1, 12), range('roughness', 'Roughness', 50, 10, 90, 1, '%'),
      select('blend', 'Blend Mode', mode, BLEND_OPTS), range('opacity', 'Opacity', 100, 0, 100, 1, '%'), seedParam()];
  };
  defFilter({ id: 'clouds', name: 'Clouds', category: 'Render', params: cloudParams('normal'), apply: function (img, p, o) { return renderClouds(img, p, o, 'normal'); } });
  defFilter({ id: 'differenceClouds', name: 'Difference Clouds', category: 'Render', params: cloudParams('difference'), apply: function (img, p, o) { return renderClouds(img, p, o, 'difference'); } });

  defFilter({
    id: 'vignette', name: 'Vignette', category: 'Render',
    params: [range('amount', 'Amount', 60, 0, 100, 1, '%'), range('midpoint', 'Midpoint', 50, 0, 100), range('roundness', 'Roundness', 0, -100, 100), range('feather', 'Feather', 60, 1, 100), color('color', 'Color', '#000000')],
    apply: function (img, p) {
      var w = img.width, h = img.height, d = img.data, amt = p.amount / 100, c = hexToRgb(p.color);
      if (!amt) return img;
      var cx = w / 2, cy = h / 2, round = p.roundness / 100;
      // roundness -1 => ellipse fitted to the image, +1 => circle
      var m = Math.min(cx, cy), rr = round > 0 ? round : 0;
      var rx = cx + (m - cx) * rr, ry = cy + (m - cy) * rr;
      // negative roundness exaggerates the image aspect
      if (round < 0) { var ex = 1 - round * 0.5; if (cx > cy) rx *= ex; else ry *= ex; }
      var mid = 0.25 + p.midpoint / 100 * 0.9, fe = 0.05 + p.feather / 100 * 1.2, scale = Math.SQRT2 * 0.82;
      for (var y = 0, i = 0; y < h; y++) {
        var dy = (y + 0.5 - cy) / ry;
        for (var x = 0; x < w; x++, i += 4) {
          var dx = (x + 0.5 - cx) / rx, r = Math.sqrt(dx * dx + dy * dy) / scale;
          var t = smoothstep(mid - fe * 0.5, mid + fe * 0.5, r) * amt;
          if (t <= 0) continue;
          d[i] += (c[0] - d[i]) * t; d[i + 1] += (c[1] - d[i + 1]) * t; d[i + 2] += (c[2] - d[i + 2]) * t;
        }
      }
      return img;
    }
  });

  defFilter({
    id: 'lensFlare', name: 'Lens Flare', category: 'Render',
    params: [range('centerX', 'Center X', 28, 0, 100, 1, '%'), range('centerY', 'Center Y', 28, 0, 100, 1, '%'), range('brightness', 'Brightness', 100, 10, 300, 1, '%'),
      select('style', 'Style', 'prime', [['prime', 'Prime'], ['zoom', 'Zoom'], ['anamorphic', 'Anamorphic']]), color('tint', 'Tint', '#ffd7a0'), seedParam()],
    apply: function (img, p, opts) {
      var w = img.width, h = img.height, d = img.data, diag = Math.sqrt(w * w + h * h), B = p.brightness / 100, R = rng(effSeed(p, opts));
      var fx = p.centerX / 100 * w, fy = p.centerY / 100 * h, tint = hexToRgb(p.tint), style = p.style;
      var rays = new Float32Array(1024), k, a;
      var nr = style === 'zoom' ? 28 : 14;
      for (k = 0; k < nr; k++) {
        var ca = R() * 1024, amp = 0.3 + R() * 0.7, wd = 2 + R() * 5;
        for (a = -24; a <= 24; a++) { var idx = ((Math.round(ca) + a) % 1024 + 1024) % 1024; rays[idx] += amp * Math.exp(-(a * a) / (2 * wd * wd)); }
      }
      var ghosts = [], gcol = [[120, 255, 180], [255, 160, 90], [140, 170, 255], [255, 120, 200], [200, 255, 120]];
      var vx = w / 2 - fx, vy = h / 2 - fy, gpos = style === 'prime' ? [0.45, 0.8, 1.3, 1.65] : [0.3, 0.55, 0.85, 1.15, 1.45, 1.8];
      for (k = 0; k < gpos.length; k++) ghosts.push({ x: fx + vx * gpos[k] * 2 * 0.6, y: fy + vy * gpos[k] * 2 * 0.6, r: diag * (0.012 + R() * 0.05), c: gcol[k % gcol.length], i: 0.05 + R() * 0.08 });
      var sg = diag * 0.02, sg2 = 2 * sg * sg, halo = diag * 0.16, ringR = diag * 0.11, ringW = diag * 0.006;
      for (var y = 0, i = 0; y < h; y++) for (var x = 0; x < w; x++, i += 4) {
        var dx = x - fx, dy = y - fy, d2 = dx * dx + dy * dy, dist = Math.sqrt(d2);
        var core = Math.exp(-d2 / sg2) * 1.2 + Math.exp(-dist / (diag * 0.05)) * 0.35 + Math.exp(-dist / halo) * 0.12;
        var ang = Math.atan2(dy, dx), ri = rays[(((ang / (2 * Math.PI)) * 1024 | 0) + 1024) & 1023] * Math.exp(-dist / (diag * 0.18)) * 0.35;
        var lr = (core + ri) * tint[0], lg = (core + ri) * tint[1], lb = (core + ri) * tint[2];
        var rr = (dist - ringR) / ringW, ring = Math.exp(-rr * rr) * 0.08;
        if (ring > 0.001) { lr += ring * (180 + 75 * Math.sin(rr)); lg += ring * (180 + 75 * Math.sin(rr + 2)); lb += ring * (180 + 75 * Math.sin(rr + 4)); }
        if (style === 'anamorphic') {
          var st = Math.exp(-Math.abs(dy) / (diag * 0.0025)) * Math.exp(-Math.abs(dx) / (w * 0.45)) * 0.9;
          lr += st * 120; lg += st * 170; lb += st * 255;
        }
        for (k = 0; k < ghosts.length; k++) {
          var gh = ghosts[k], gx = x - gh.x, gy = y - gh.y, gd = Math.sqrt(gx * gx + gy * gy) / gh.r;
          if (gd < 1.2) { var gi = (1 - smoothstep(0.85, 1.05, gd)) * gh.i * (0.6 + 0.4 * gd); lr += gi * gh.c[0]; lg += gi * gh.c[1]; lb += gi * gh.c[2]; }
        }
        lr *= B; lg *= B; lb *= B;
        if (lr + lg + lb < 0.5) continue;
        d[i] = 255 - (255 - d[i]) * (255 - clamp(lr)) / 255;
        d[i + 1] = 255 - (255 - d[i + 1]) * (255 - clamp(lg)) / 255;
        d[i + 2] = 255 - (255 - d[i + 2]) * (255 - clamp(lb)) / 255;
      }
      return img;
    }
  });

  // ==========================================================================
  //  FILTERS — Artistic
  // ==========================================================================
  defFilter({
    id: 'cartoon', name: 'Cartoon', category: 'Artistic',
    params: [range('levels', 'Color Levels', 6, 2, 20), range('smoothing', 'Smoothing', 4, 0, 20, 1, 'px'), range('edgeStrength', 'Edge Strength', 60, 0, 100, 1, '%'), range('edgeThreshold', 'Edge Threshold', 30, 0, 100, 1, '%')],
    apply: function (img, p) {
      var w = img.width, h = img.height, n = w * h, d = img.data;
      var E = sobelPlane(gaussPlane(lumPlane(img), w, h, 1.2), w, h);
      if (p.smoothing > 0) {
        var lut = new Float32Array(256); for (var t = 0; t < 256; t++) lut[t] = Math.max(0, 1 - t / 60);
        bilateralSeparable(img, p.smoothing, lut);
      }
      var lv = Math.round(p.levels), hsl = new Float64Array(3), rgb = new Float64Array(3);
      var es = p.edgeStrength / 100, thr = p.edgeThreshold / 100 * 200;
      for (var i = 0, j = 0; i < n; i++, j += 4) {
        rgbToHslInto(d[j], d[j + 1], d[j + 2], hsl);
        var L = Math.round(hsl[2] * (lv - 1)) / (lv - 1);
        hslToRgbInto(hsl[0], Math.min(1, hsl[1] * 1.15), L * 0.9 + 0.05, rgb);
        var e = clamp01((E[i] - thr) / 60) * es, f = 1 - e;
        d[j] = rgb[0] * f; d[j + 1] = rgb[1] * f; d[j + 2] = rgb[2] * f;
      }
      return img;
    }
  });

  defFilter({
    id: 'pencilSketch', name: 'Pencil Sketch', category: 'Artistic',
    params: [range('radius', 'Stroke Width', 8, 1, 50, 0.5, 'px'), range('contrast', 'Darkness', 50, 0, 100, 1, '%'), check('colored', 'Colored Pencil', false)],
    apply: function (img, p) {
      var w = img.width, h = img.height, n = w * h, d = img.data, L = lumPlane(img), I = new Float32Array(n), i;
      for (i = 0; i < n; i++) I[i] = 255 - L[i];
      gaussPlanes([I], w, h, p.radius);
      var gam = 1 + p.contrast / 100 * 2.5;
      for (i = 0; i < n; i++) {
        var den = 255 - I[i], v = den <= 0.5 ? 255 : Math.min(255, L[i] * 255 / den), j = i << 2;
        v = 255 * Math.pow(v / 255, gam);
        if (p.colored) { var f = v / 255, s = 0.55; d[j] = v * (1 - s) + d[j] * f * s * 1.15; d[j + 1] = v * (1 - s) + d[j + 1] * f * s * 1.15; d[j + 2] = v * (1 - s) + d[j + 2] * f * s * 1.15; }
        else d[j] = d[j + 1] = d[j + 2] = v;
      }
      return img;
    }
  });

  /** Seamless tileable fBm value-noise texture (size x size, values ~[-1,1]). */
  function tileNoise(size, seed, octaves) {
    var R = rng(seed), out = new Float32Array(size * size), amp = 1, norm = 0;
    for (var o = 0, cells = 4; o < octaves; o++, cells *= 2, amp *= 0.55) {
      if (cells > size) break;
      var lat = new Float32Array(cells * cells), cs = size / cells, i;
      for (i = 0; i < lat.length; i++) lat[i] = R() * 2 - 1;
      for (var y = 0; y < size; y++) {
        var fy = y / cs, y0 = Math.floor(fy), ty = fy - y0; ty = ty * ty * (3 - 2 * ty);
        var ya = (y0 % cells) * cells, yb = ((y0 + 1) % cells) * cells;
        for (var x = 0; x < size; x++) {
          var fx = x / cs, x0 = Math.floor(fx), tx = fx - x0; tx = tx * tx * (3 - 2 * tx);
          var xa = x0 % cells, xb = (x0 + 1) % cells;
          var a = lat[ya + xa] + (lat[ya + xb] - lat[ya + xa]) * tx, b = lat[yb + xa] + (lat[yb + xb] - lat[yb + xa]) * tx;
          out[y * size + x] += (a + (b - a) * ty) * amp;
        }
      }
      norm += amp;
    }
    for (i = 0; i < out.length; i++) out[i] /= norm;
    return out;
  }
  defFilter({
    id: 'watercolor', name: 'Watercolor', category: 'Artistic',
    params: [range('brushSize', 'Brush Size', 5, 1, 20, 1, 'px'), range('edgeDarkening', 'Edge Darkening', 55, 0, 100, 1, '%'), range('texture', 'Paper Texture', 45, 0, 100, 1, '%'), range('bleed', 'Color Bleed', 40, 0, 100, 1, '%'), seedParam()],
    apply: function (img, p, opts) {
      var w = img.width, h = img.height, n = w * h, d = img.data, bs = p.brushSize, i, j;
      // 1) flatten into washes (edge-preserving)
      var lut = new Float32Array(256); for (var t = 0; t < 256; t++) lut[t] = Math.max(0, 1 - t / 40);
      bilateralSeparable(img, bs * 1.5, lut, bs);
      // 2) colour bleed: mix in a soft blur so pigments run across edges a little
      var soft = blurredCopy(img, bs * 1.2).data, bleed = p.bleed / 100 * 0.6;
      // 3) soft pigment pooling (partial posterize on luminance) + edge darkening via difference of gaussians
      var L = lumPlane(img), B = gaussPlane(L, w, h, bs * 0.7 + 1), ed = p.edgeDarkening / 100 * 3.2;
      var tex = p.texture > 0 ? tileNoise(256, effSeed(p, opts), 6) : null, fine = p.texture > 0 ? tileNoise(64, effSeed(p, opts) ^ 99, 4) : null, tx = p.texture / 100;
      for (var y = 0, k = 0; y < h; y++) for (var x = 0; x < w; x++, k++) {
        j = k << 2;
        var dog = Math.abs(L[k] - B[k]), edge = Math.min(0.45, dog * ed / 255);
        var paper = tex ? (tex[((y & 255) << 8) | (x & 255)] * 0.65 + fine[((y & 63) << 6) | (x & 63)] * 0.35) * tx : 0;
        var pool = 0.25 + 0.75 * (1 - Math.abs(L[k] / 255 * 6 - Math.round(L[k] / 255 * 6)));
        for (var c = 0; c < 3; c++) {
          var v = d[j + c] + (soft[j + c] - d[j + c]) * bleed;
          v = 255 - (255 - v) * (0.82 + 0.1 * pool);          // translucent pigment
          v *= 1 - edge;                                        // pigment collects at wash edges
          v *= 1 + paper * 0.22;                                // granulation on paper tooth
          d[j + c] = v + paper * 10;
        }
      }
      return img;
    }
  });

  defFilter({
    id: 'filmGrain', name: 'Film Grain', category: 'Artistic',
    params: [range('amount', 'Amount', 20, 0, 100, 1, '%'), range('size', 'Grain Size', 1.5, 0.5, 10, 0.1, 'px'), check('monochromatic', 'Monochromatic', true), seedParam()],
    apply: function (img, p, opts) {
      var w = img.width, h = img.height, n = w * h, d = img.data, seed = effSeed(p, opts), G = gaussTable(seed), amt = p.amount / 100 * 60;
      if (!amt) return img;
      var planes = [], cnt = p.monochromatic ? 1 : 3, x = (seed ^ 0xa5a5a5a5) >>> 0 || 7, c, i;
      var sig = Math.max(0, (p.size - 0.5) * 0.6);
      for (c = 0; c < cnt; c++) {
        var P = new Float32Array(n);
        for (i = 0; i < n; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; P[i] = G[(x >>> 0) & 65535]; }
        if (sig > 0.2) {
          gaussPlanes([P], w, h, sig);
          var ss = 0; for (i = 0; i < n; i += 7) ss += P[i] * P[i];
          var sd = Math.sqrt(ss / Math.ceil(n / 7)) || 1; for (i = 0; i < n; i++) P[i] /= sd;
        }
        planes.push(P);
      }
      for (i = 0; i < n; i++) {
        var j = i << 2, l = luminance(d[j], d[j + 1], d[j + 2]) / 255, wgt = (1 - Math.pow(2 * l - 1, 2) * 0.75) * amt;
        if (cnt === 1) { var g = planes[0][i] * wgt; d[j] += g; d[j + 1] += g; d[j + 2] += g; }
        else { d[j] += planes[0][i] * wgt; d[j + 1] += planes[1][i] * wgt; d[j + 2] += planes[2][i] * wgt; }
      }
      return img;
    }
  });

  defFilter({
    id: 'chromaticAberration', name: 'Chromatic Aberration', category: 'Artistic',
    params: [range('shift', 'Shift', 4, 0, 50, 0.5, 'px'), select('mode', 'Mode', 'radial', [['radial', 'Radial (lens)'], ['linear', 'Linear']]), angle('angle', 'Angle (linear)', 0)],
    apply: function (img, p) {
      var w = img.width, h = img.height, src = new Uint8ClampedArray(img.data), d = img.data, s = p.shift, smp = new Float64Array(4);
      if (!s) return img;
      var a = p.angle * Math.PI / 180, ax = Math.cos(a) * s, ay = -Math.sin(a) * s, cx = (w - 1) / 2, cy = (h - 1) / 2, R = Math.sqrt(cx * cx + cy * cy) || 1, radial = p.mode === 'radial';
      for (var y = 0, i = 0; y < h; y++) for (var x = 0; x < w; x++, i += 4) {
        var ox, oy;
        if (radial) { var f = s / R; ox = (x - cx) * f; oy = (y - cy) * f; } else { ox = ax; oy = ay; }
        bilinearInto(src, w, h, x - ox, y - oy, EDGE_CLAMP, smp, 0); var r = smp[0], ra = smp[3];
        bilinearInto(src, w, h, x + ox, y + oy, EDGE_CLAMP, smp, 0); var b = smp[2], ba = smp[3];
        d[i] = r; d[i + 2] = b; d[i + 3] = Math.max(src[i + 3], ra, ba);
      }
      return img;
    }
  });

  defFilter({
    id: 'glitch', name: 'Glitch', category: 'Artistic',
    params: [range('slices', 'Slices', 20, 1, 100), range('offset', 'Max Offset', 40, 0, 300, 1, 'px'), range('rgbSplit', 'RGB Split', 8, 0, 50, 1, 'px'), range('blocks', 'Corrupt Blocks', 6, 0, 40), seedParam()],
    apply: function (img, p, opts) {
      var w = img.width, h = img.height, src = new Uint8ClampedArray(img.data), d = img.data, R = rng(effSeed(p, opts));
      var rowOff = new Int32Array(h), k, y, x;
      for (k = 0; k < p.slices; k++) {
        var y0 = (R() * h) | 0, hh = Math.max(1, (R() * R() * h * 0.12) | 0), off = Math.round((R() * 2 - 1) * p.offset);
        for (y = y0; y < Math.min(h, y0 + hh); y++) rowOff[y] = off;
      }
      var sp = Math.round(p.rgbSplit);
      for (y = 0; y < h; y++) {
        var ro = rowOff[y], row = y * w;
        for (x = 0; x < w; x++) {
          var o = (row + x) << 2;
          var xr = ((x - ro + sp) % w + w) % w, xg = ((x - ro) % w + w) % w, xb = ((x - ro - sp) % w + w) % w;
          d[o] = src[(row + xr) << 2]; d[o + 1] = src[((row + xg) << 2) + 1]; d[o + 2] = src[((row + xb) << 2) + 2]; d[o + 3] = src[((row + xg) << 2) + 3];
        }
      }
      for (k = 0; k < p.blocks; k++) {
        var bw = (8 + R() * w * 0.15) | 0, bh = (4 + R() * h * 0.05) | 0, bx = (R() * (w - bw)) | 0, by = (R() * (h - bh)) | 0;
        var mode = (R() * 3) | 0, ch = (R() * 3) | 0, sx = (R() * (w - bw)) | 0, sy = (R() * (h - bh)) | 0;
        for (y = Math.max(0, by); y < Math.min(h, by + bh); y++) for (x = Math.max(0, bx); x < Math.min(w, bx + bw); x++) {
          var q = (y * w + x) << 2;
          if (mode === 0) { var s2 = (((sy + y - by) * w) + sx + x - bx) << 2; d[q] = src[s2]; d[q + 1] = src[s2 + 1]; d[q + 2] = src[s2 + 2]; }
          else if (mode === 1) { d[q + ch] = 255 - d[q + ch]; }
          else { d[q] = d[q] & 0xE0; d[q + 1] = d[q + 1] & 0xE0; d[q + 2] = d[q + 2] & 0xC0; }
        }
      }
      return img;
    }
  });

  defFilter({
    id: 'duotone', name: 'Duotone', category: 'Artistic',
    params: [color('shadowColor', 'Shadows', '#1b1f5c'), color('highlightColor', 'Highlights', '#ffb38a'), range('contrast', 'Contrast', 0, -100, 100)],
    apply: function (img, p) {
      var a = hexToRgb(p.shadowColor), b = hexToRgb(p.highlightColor), c = p.contrast / 100, d = img.data, n = d.length;
      var lut = new Float32Array(256);
      for (var v = 0; v < 256; v++) {
        var t = v / 255;
        if (c) { var e = c > 0 ? 1 + c * 2 : 1 / (1 - c * 1.5); t = t < 0.5 ? 0.5 * Math.pow(2 * t, e) : 1 - 0.5 * Math.pow(2 * (1 - t), e); }
        lut[v] = t;
      }
      for (var i = 0; i < n; i += 4) {
        var t2 = lut[Math.round(luminance(d[i], d[i + 1], d[i + 2]))];
        d[i] = a[0] + (b[0] - a[0]) * t2; d[i + 1] = a[1] + (b[1] - a[1]) * t2; d[i + 2] = a[2] + (b[2] - a[2]) * t2;
      }
      return img;
    }
  });

  defFilter({
    id: 'crt', name: 'CRT / Scanlines', category: 'Artistic',
    params: [range('lineSpacing', 'Line Spacing', 3, 2, 12, 1, 'px'), range('intensity', 'Scanline Intensity', 45, 0, 100, 1, '%'), check('rgbMask', 'RGB Phosphor Mask', true),
      range('curvature', 'Curvature', 15, 0, 100), range('vignette', 'Vignette', 30, 0, 100, 1, '%'), range('glow', 'Glow', 25, 0, 100, 1, '%')],
    apply: function (img, p) {
      var w = img.width, h = img.height, out = img, cx = (w - 1) / 2, cy = (h - 1) / 2, k = p.curvature / 100 * 0.25;
      if (k > 0) {
        out = warp(img, 'transparent', function (x, y, o) {
          var dx = (x - cx) / cx, dy = (y - cy) / cy, r2 = dx * dx + dy * dy, f = (1 + k * r2) / (1 + k);
          o[0] = cx + dx * f * cx; o[1] = cy + dy * f * cy;
        });
        // darken only where the curvature pulled transparency in from outside the frame (the "bezel"), not
        // pixels that were semi-transparent in the source — otherwise soft alpha edges turn black
        var od = out.data, sd = img.data; for (var q = 3; q < od.length; q += 4) { var sa = sd[q]; if (sa && od[q] < sa) { var al = od[q] / sa; od[q - 3] *= al; od[q - 2] *= al; od[q - 1] *= al; } od[q] = sa; }
      }
      var d = out.data, glow = p.glow / 100, bl = glow > 0 ? blurredCopy(out, Math.max(2, Math.min(w, h) / 200)).data : null;
      var sp = p.lineSpacing, I = p.intensity / 100, mask = p.rgbMask, vg = p.vignette / 100;
      var MASK = [[1, 0.72, 0.72], [0.72, 1, 0.72], [0.72, 0.72, 1]];
      for (var y = 0, i = 0; y < h; y++) {
        var scan = 1 - I * (0.5 - 0.5 * Math.cos(2 * Math.PI * (y % sp + 0.5) / sp));
        for (var x = 0; x < w; x++, i += 4) {
          var m = mask ? MASK[x % 3] : MASK[0];
          var dx = (x - cx) / cx, dy = (y - cy) / cy, v = 1 - vg * smoothstep(0.4, 1.6, dx * dx + dy * dy);
          for (var c = 0; c < 3; c++) {
            var val = d[i + c];
            if (bl) val = 255 - (255 - val) * (255 - bl[i + c] * glow * 0.8) / 255;
            d[i + c] = val * scan * (mask ? m[c] * 1.18 : 1) * v;
          }
        }
      }
      return out;
    }
  });

  // ==========================================================================
  //  FILTERS — Color
  // ==========================================================================
  var CH_OPTS = [['r', 'Red'], ['g', 'Green'], ['b', 'Blue']];
  defFilter({
    id: 'channelSwap', name: 'Channel Swap', category: 'Color',
    params: [select('red', 'Red from', 'b', CH_OPTS), select('green', 'Green from', 'g', CH_OPTS), select('blue', 'Blue from', 'r', CH_OPTS)],
    apply: function (img, p) {
      var map = { r: 0, g: 1, b: 2 }, a = map[p.red], b = map[p.green], c = map[p.blue], d = img.data, n = d.length;
      for (var i = 0; i < n; i += 4) { var r = d[i + a], g = d[i + b], bb = d[i + c]; d[i] = r; d[i + 1] = g; d[i + 2] = bb; }
      return img;
    }
  });
  defFilter({
    id: 'sepia', name: 'Sepia', category: 'Color',
    params: [range('amount', 'Amount', 100, 0, 100, 1, '%')],
    apply: function (img, p) {
      var a = p.amount / 100, d = img.data, n = d.length;
      for (var i = 0; i < n; i += 4) {
        var r = d[i], g = d[i + 1], b = d[i + 2];
        var sr = 0.393 * r + 0.769 * g + 0.189 * b, sg = 0.349 * r + 0.686 * g + 0.168 * b, sb = 0.272 * r + 0.534 * g + 0.131 * b;
        d[i] = r + (sr - r) * a; d[i + 1] = g + (sg - g) * a; d[i + 2] = b + (sb - b) * a;
      }
      return img;
    }
  });
  defFilter({
    id: 'colorize', name: 'Colorize', category: 'Color',
    params: [color('color', 'Color', '#3a7bd5'), range('amount', 'Amount', 100, 0, 100, 1, '%')],
    apply: function (img, p) {
      var c = hexToRgb(p.color), hsl = rgbToHsl(c[0], c[1], c[2]), a = p.amount / 100, d = img.data, n = d.length, rgb = new Float64Array(3), lut = new Float32Array(768);
      for (var v = 0; v < 256; v++) { hslToRgbInto(hsl[0], hsl[1], v / 255, rgb); lut[v * 3] = rgb[0]; lut[v * 3 + 1] = rgb[1]; lut[v * 3 + 2] = rgb[2]; }
      for (var i = 0; i < n; i += 4) {
        var k = Math.round(luminance(d[i], d[i + 1], d[i + 2])) * 3;
        d[i] += (lut[k] - d[i]) * a; d[i + 1] += (lut[k + 1] - d[i + 1]) * a; d[i + 2] += (lut[k + 2] - d[i + 2]) * a;
      }
      return img;
    }
  });
  defFilter({
    id: 'invertChannel', name: 'Invert Channel', category: 'Color',
    params: [check('red', 'Red', true), check('green', 'Green', false), check('blue', 'Blue', false)],
    apply: function (img, p) {
      var id = lutFrom(function (v) { return v; }), inv = lutFrom(function (v) { return 255 - v; });
      return applyLUT3(img, p.red ? inv : id, p.green ? inv : id, p.blue ? inv : id);
    }
  });

  // ==========================================================================
  //  FILTERS — Other
  // ==========================================================================
  defFilter({
    id: 'offset', name: 'Offset', category: 'Other',
    params: [range('x', 'Horizontal', 50, -100, 100, 0.1, '%'), range('y', 'Vertical', 50, -100, 100, 0.1, '%'), select('edge', 'Undefined Areas', 'wrap', [['wrap', 'Wrap Around'], ['clamp', 'Repeat Edge Pixels'], ['transparent', 'Set to Transparent']])],
    apply: function (img, p) {
      var w = img.width, h = img.height, ox = Math.round(p.x / 100 * w), oy = Math.round(p.y / 100 * h), src = new Uint8ClampedArray(img.data), d = img.data, e = p.edge;
      for (var y = 0, i = 0; y < h; y++) for (var x = 0; x < w; x++, i += 4) {
        var sx = x - ox, sy = y - oy;
        if (sx < 0 || sx >= w || sy < 0 || sy >= h) {
          if (e === 'transparent') { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; continue; }
          if (e === 'wrap') { sx = ((sx % w) + w) % w; sy = ((sy % h) + h) % h; }
          else { sx = sx < 0 ? 0 : (sx >= w ? w - 1 : sx); sy = sy < 0 ? 0 : (sy >= h ? h - 1 : sy); }
        }
        var q = (sy * w + sx) << 2;
        d[i] = src[q]; d[i + 1] = src[q + 1]; d[i + 2] = src[q + 2]; d[i + 3] = src[q + 3];
      }
      return img;
    }
  });

  function morphImage(img, r, isMax) {
    var w = img.width, h = img.height, planes = [], c;
    var opaque = isOpaque(img);
    for (c = 0; c < (opaque ? 3 : 4); c++) planes.push(channelPlane(img, c));
    morphPlanes(planes, w, h, Math.max(1, Math.round(r)), isMax);
    var d = img.data;
    for (c = 0; c < planes.length; c++) for (var i = 0, j = c; i < planes[c].length; i++, j += 4) d[j] = planes[c][i];
    return img;
  }
  defFilter({ id: 'maximum', name: 'Maximum', category: 'Other', params: [range('radius', 'Radius', 2, 1, 100, 1, 'px')], apply: function (img, p) { return morphImage(img, p.radius, true); } });
  defFilter({ id: 'minimum', name: 'Minimum', category: 'Other', params: [range('radius', 'Radius', 2, 1, 100, 1, 'px')], apply: function (img, p) { return morphImage(img, p.radius, false); } });

  var KDEF = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  defFilter({
    id: 'customKernel', name: 'Custom Kernel', category: 'Other',
    params: KDEF.map(function (v, i) { return num('k' + i, 'K[' + Math.floor(i / 3) + ',' + (i % 3) + ']', v, -999, 999, 1); })
      .concat([num('divisor', 'Scale (0 = auto)', 0, -9999, 9999, 1), num('offset', 'Offset', 0, -255, 255, 1)]),
    apply: function (img, p) {
      var k = [], s = 0, i;
      for (i = 0; i < 9; i++) { k.push(+p['k' + i] || 0); s += k[i]; }
      var div = +p.divisor || (s !== 0 ? s : 1), off = +p.offset || 0;
      for (i = 0; i < 9; i++) k[i] /= div;
      var w = img.width, h = img.height, src = new Uint8ClampedArray(img.data), d = img.data, wm = w - 1, hm = h - 1;
      for (var y = 0; y < h; y++) {
        var rows = [(y > 0 ? y - 1 : 0) * w, y * w, (y < hm ? y + 1 : hm) * w];
        for (var x = 0; x < w; x++) {
          var cols = [x > 0 ? x - 1 : 0, x, x < wm ? x + 1 : wm], o = (y * w + x) << 2;
          for (var c = 0; c < 3; c++) {
            var acc = 0;
            for (var ky = 0; ky < 3; ky++) for (var kx = 0; kx < 3; kx++) acc += src[((rows[ky] + cols[kx]) << 2) + c] * k[ky * 3 + kx];
            d[o + c] = acc + off;
          }
        }
      }
      return img;
    }
  });

  // ==========================================================================
  //  Public API
  // ==========================================================================
  function apply(idOrEffect, img, params, opts) {
    var e = typeof idOrEffect === 'string' ? lookup(idOrEffect) : idOrEffect;
    if (!e) throw new Error('ImageFX: unknown effect ' + idOrEffect);
    var work = cloneImageData(img);
    if (!e.applyRaw) wrapEffect(e);   // allow ad-hoc effects
    return e.apply(work, params, opts);
  }

  var ImageFX = {
    version: '1.0',
    adjustments: adjustments,
    filters: filters,
    categories: { filters: ['Blur', 'Sharpen', 'Noise', 'Stylize', 'Distort', 'Pixelate', 'Render', 'Artistic', 'Color', 'Other'] },
    defaults: defaults,
    apply: apply,
    histogram: histogram,
    get: lookup,
    register: function (kind, effect) { return kind === 'adjustment' ? defAdj(effect) : defFilter(effect); },
    util: {
      clamp: clamp, rgbToHsl: rgbToHsl, hslToRgb: hslToRgb, rgbToHsv: rgbToHsv, hsvToRgb: hsvToRgb,
      hexToRgb: hexToRgb, rgbToHex: rgbToHex, luminance: luminance, buildCurveLUT: buildCurveLUT,
      sampleBilinear: sampleBilinear, gradientLUT: gradientLUT, createImageData: createImageData,
      cloneImageData: cloneImageData, gaussianBlur: function (img, sigma) { return blurImage(img, sigma); }
    }
  };
  root.ImageFX = ImageFX;
  if (typeof module === 'object' && module && module.exports) module.exports = ImageFX;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this)));
