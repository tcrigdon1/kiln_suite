/* Kiln Suite — animated image encoders, shared by Gesso and Cutline.
   AnimEnc.gif(frames, opts)  → Blob  frames: [{ data: ImageData | canvas, delay: ms }], opts { loop (0=forever), dither, transparent }
   AnimEnc.apng(frames, opts) → Promise<Blob> (frames as canvases / ImageData; uses the browser's PNG encoder per frame)
   Plain classic script: window.AnimEnc. */
(function () {
  'use strict';
  var E = (window.AnimEnc = {});

  function imageData(f) {
    if (f.data && f.data.data) return f.data;
    var c = f.data || f.canvas || f;
    return c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
  }

  /* ---------- palette ---------- */
  function medianCut(samples, n) {
    var boxes = [{ px: samples }];
    function range(b) { var mn = [255, 255, 255], mx = [0, 0, 0]; for (var i = 0; i < b.px.length; i++) { var p = b.px[i]; for (var c = 0; c < 3; c++) { if (p[c] < mn[c]) mn[c] = p[c]; if (p[c] > mx[c]) mx[c] = p[c]; } } b.rng = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]]; b.span = Math.max(b.rng[0], b.rng[1], b.rng[2]); }
    range(boxes[0]);
    while (boxes.length < n) {
      var bi = -1, best = -1;
      for (var i = 0; i < boxes.length; i++) if (boxes[i].px.length > 1 && boxes[i].span > best) { best = boxes[i].span; bi = i; }
      if (bi < 0) break;
      var b = boxes[bi], ch = b.rng.indexOf(b.span);
      b.px.sort(function (p, q) { return p[ch] - q[ch]; });
      var mid = b.px.length >> 1, b1 = { px: b.px.slice(0, mid) }, b2 = { px: b.px.slice(mid) };
      range(b1); range(b2); boxes.splice(bi, 1, b1, b2);
    }
    return boxes.map(function (b) { var r = 0, g = 0, bl = 0; for (var i = 0; i < b.px.length; i++) { r += b.px[i][0]; g += b.px[i][1]; bl += b.px[i][2]; } var k = b.px.length || 1; return [Math.round(r / k), Math.round(g / k), Math.round(bl / k)]; });
  }
  function Quantizer(pal) { this.pal = pal; this.cache = new Int16Array(32768).fill(-1); }
  Quantizer.prototype.index = function (r, g, b) {
    var key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3), c = this.cache[key];
    if (c >= 0) return c;
    var best = 0, bd = 1e9, pal = this.pal;
    for (var i = 0; i < pal.length; i++) { var dr = pal[i][0] - r, dg = pal[i][1] - g, db = pal[i][2] - b, d = dr * dr * 2 + dg * dg * 3 + db * db; if (d < bd) { bd = d; best = i; } }
    this.cache[key] = best; return best;
  };
  // palette over all frames (sampled), leaving the last slot for transparency when requested
  E.palette = function (frames, transparent) {
    var samples = [], budget = 60000, per = Math.max(1, Math.ceil(budget / frames.length));
    frames.forEach(function (f) {
      var d = imageData(f).data, n = d.length / 4, stride = Math.max(1, Math.floor(n / per));
      for (var i = 0; i < n; i += stride) { var j = i * 4; if (transparent && d[j + 3] < 128) continue; samples.push([d[j], d[j + 1], d[j + 2]]); }
    });
    if (!samples.length) samples.push([0, 0, 0]);
    var pal = medianCut(samples, transparent ? 255 : 256);
    while (pal.length < (transparent ? 255 : 256)) pal.push([0, 0, 0]);
    if (transparent) pal.push([0, 0, 0]);
    return pal;
  };
  // ImageData -> palette indices (optional Floyd–Steinberg error diffusion); transparent pixels -> index 255
  E.quantize = function (img, pal, dither, transparent) {
    var w = img.width, h = img.height, d = img.data, out = new Uint8Array(w * h), q = new Quantizer(pal);
    if (!dither) { for (var i = 0, j = 0; i < out.length; i++, j += 4) out[i] = transparent && d[j + 3] < 128 ? 255 : q.index(d[j], d[j + 1], d[j + 2]); return out; }
    var err = new Float32Array(w * h * 3), p = 0;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++, p++) {
      var j2 = p * 4;
      if (transparent && d[j2 + 3] < 128) { out[p] = 255; continue; }
      var r = Math.max(0, Math.min(255, d[j2] + err[p * 3])), g = Math.max(0, Math.min(255, d[j2 + 1] + err[p * 3 + 1])), b = Math.max(0, Math.min(255, d[j2 + 2] + err[p * 3 + 2]));
      var k = q.index(r, g, b); out[p] = k;
      var er = r - pal[k][0], eg = g - pal[k][1], eb = b - pal[k][2];
      function spread(dx, dy, wgt) { var xx = x + dx, yy = y + dy; if (xx < 0 || xx >= w || yy >= h) return; var o = (yy * w + xx) * 3; err[o] += er * wgt; err[o + 1] += eg * wgt; err[o + 2] += eb * wgt; }
      spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16);
    }
    return out;
  };
  /* ---------- GIF ---------- */
  function lzw(indices, minCode) {
    var clear = 1 << minCode, eoi = clear + 1, out = [], cur = 0, curBits = 0, codeSize = minCode + 1, next = eoi + 1, dict = new Map(), blk = [];
    function emit(code) { cur |= code << curBits; curBits += codeSize; while (curBits >= 8) { blk.push(cur & 255); cur >>>= 8; curBits -= 8; if (blk.length === 255) { out.push(255); Array.prototype.push.apply(out, blk); blk = []; } } }
    emit(clear);
    var prefix = indices[0];
    for (var i = 1; i < indices.length; i++) {
      var k = indices[i], key = prefix * 4096 + k, e = dict.get(key);
      if (e != null) { prefix = e; continue; }
      emit(prefix);
      if (next < 4096) { dict.set(key, next++); if (next > (1 << codeSize) && codeSize < 12) codeSize++; }
      else { emit(clear); dict.clear(); next = eoi + 1; codeSize = minCode + 1; }
      prefix = k;
    }
    emit(prefix); emit(eoi);
    if (curBits > 0) blk.push(cur & 255);
    if (blk.length) { out.push(blk.length); Array.prototype.push.apply(out, blk); }
    out.push(0);
    return out;
  }
  E.lzw = lzw;
  E.gif = function (frames, opts) {
    opts = opts || {};
    var first = imageData(frames[0]), w = first.width, h = first.height, tr = !!opts.transparent;
    var pal = E.palette(frames, tr), loop = opts.loop == null ? 0 : opts.loop;
    var hdr = [71, 73, 70, 56, 57, 97, w & 255, w >> 8, h & 255, h >> 8, 0xF7, 0, 0];
    var gct = []; for (var i = 0; i < 256; i++) { var c = pal[i] || [0, 0, 0]; gct.push(c[0], c[1], c[2]); }
    var parts = [new Uint8Array(hdr.concat(gct))];
    if (loop !== -1) parts.push(new Uint8Array([0x21, 0xFF, 11, 78, 69, 84, 83, 67, 65, 80, 69, 50, 46, 48, 3, 1, loop & 255, (loop >> 8) & 255, 0]));
    frames.forEach(function (f, fi) {
      var img = imageData(f), idx = E.quantize(img, pal, opts.dither !== false, tr), cs = Math.max(2, Math.round((f.delay || 100) / 10));
      var gce = [0x21, 0xF9, 4, tr ? 0x09 : 0, cs & 255, (cs >> 8) & 255, tr ? 255 : 0, 0]; // disposal 2 (restore bg) when transparent
      var desc = [0x2C, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0, 8];
      parts.push(new Uint8Array(gce.concat(desc)), new Uint8Array(lzw(idx, 8)));
      if (opts.onProgress) opts.onProgress((fi + 1) / frames.length);
    });
    parts.push(new Uint8Array([0x3B]));
    return new Blob(parts, { type: 'image/gif' });
  };

  /* ---------- APNG ---------- */
  var crcTable = null;
  function crc32(bytes, start, end) {
    if (!crcTable) { crcTable = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; } }
    var crc = 0xFFFFFFFF; for (var i = start; i < end; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function u32(v) { return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]; }
  function u16(v) { return [(v >>> 8) & 255, v & 255]; }
  function chunk(type, data) {
    var t = [type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)];
    var body = new Uint8Array(t.length + data.length); body.set(t, 0); body.set(data, 4);
    var out = new Uint8Array(12 + data.length); out.set(u32(data.length), 0); out.set(body, 4); out.set(u32(crc32(body, 0, body.length)), 8 + data.length);
    return out;
  }
  function pngChunks(buf) { // -> { ihdr: Uint8Array(data), idat: [Uint8Array] }
    var b = new Uint8Array(buf), p = 8, out = { idat: [], ihdr: null };
    while (p < b.length) {
      var len = (b[p] << 24 | b[p + 1] << 16 | b[p + 2] << 8 | b[p + 3]) >>> 0, type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
      var data = b.subarray(p + 8, p + 8 + len);
      if (type === 'IHDR') out.ihdr = data; else if (type === 'IDAT') out.idat.push(data);
      p += 12 + len;
    }
    return out;
  }
  function toCanvas(f) {
    if (f.data && f.data.data) { var c = document.createElement('canvas'); c.width = f.data.width; c.height = f.data.height; c.getContext('2d').putImageData(f.data, 0, 0); return c; }
    return f.data || f.canvas || f;
  }
  E.apng = function (frames, opts) {
    opts = opts || {};
    var loop = opts.loop == null ? 0 : opts.loop, seq = 0, parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
    var w = toCanvas(frames[0]).width, h = toCanvas(frames[0]).height;
    return frames.reduce(function (p, f, i) {
      return p.then(function () {
        return new Promise(function (res) { toCanvas(f).toBlob(res, 'image/png'); }).then(function (blob) { return blob.arrayBuffer(); }).then(function (buf) {
          var ch = pngChunks(buf);
          if (i === 0) { parts.push(chunk('IHDR', ch.ihdr)); parts.push(chunk('acTL', new Uint8Array(u32(frames.length).concat(u32(loop))))); }
          var delay = Math.max(1, Math.round(f.delay || 100));
          parts.push(chunk('fcTL', new Uint8Array(u32(seq++).concat(u32(w), u32(h), u32(0), u32(0), u16(delay), u16(1000), [0, 0]))));
          ch.idat.forEach(function (d) {
            if (i === 0) parts.push(chunk('IDAT', d));
            else { var fd = new Uint8Array(4 + d.length); fd.set(u32(seq++), 0); fd.set(d, 4); parts.push(chunk('fdAT', fd)); }
          });
          if (opts.onProgress) opts.onProgress((i + 1) / frames.length);
        });
      });
    }, Promise.resolve()).then(function () { parts.push(chunk('IEND', new Uint8Array(0))); return new Blob(parts, { type: 'image/png' }); });
  };
})();
