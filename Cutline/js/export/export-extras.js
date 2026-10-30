/* Cutline — extra export targets: animated GIF (median-cut palette, optional dithering, own LZW encoder),
   PNG image sequence packed in a ZIP (stored, CRC-32), and a contact-sheet PNG with timecodes. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, P = C.P, h = U.h;
  var XE = C.ExportExtras = {};

  /* ---------- frame source shared by the image exporters ---------- */
  function frameLoop(st, s, fr, onProgress, cancel, onFrame) {
    var w = st.w || s.w, hh = st.h || s.h, fps = st.fps || s.fps;
    var canvas = document.createElement('canvas'); canvas.width = w; canvas.height = hh;
    var comp = C.createCompositor(canvas), prov = new C.SourceProvider('export');
    prov.useDecoders = C.prefs.fastDecode !== false && !!window.VideoDecoder;
    var total = Math.max(1, Math.round((fr[1] - fr[0]) / s.fps * fps)), i = 0, g2 = canvas.getContext ? null : null;
    function step() {
      if (cancel.v || i >= total) return Promise.resolve();
      var tSec = i / fps, seqF = fr[0] + Math.floor(tSec * s.fps + 1e-6);
      var scene = C.Scene.build(s, seqF, { captions: st.captions });
      return prov.prepare(scene).then(function () {
        comp.render(scene, w, hh, prov, { captions: st.captions });
        var px = comp.readFull();
        return onFrame(px, i, total, canvas);
      }).then(function () {
        i++;
        onProgress(Math.min(0.98, i / total), 'Frame ' + i + ' / ' + total);
        if (i % 6 === 0) return new Promise(function (r) { setTimeout(r, 0); }).then(step);
        return step();
      });
    }
    void g2;
    return step().then(function () { prov.dropAll(); if (comp.destroy) comp.destroy(); return { w: w, h: hh, fps: fps, total: total }; }, function (e) { prov.dropAll(); if (comp.destroy) comp.destroy(); throw e; });
  }
  // readFull() hands back bottom-up rows from WebGL; make them top-down RGBA
  function topDown(px, w, hh) {
    var out = new Uint8Array(px.data.length), row = w * 4;
    for (var y = 0; y < hh; y++) out.set(px.data.subarray((hh - 1 - y) * row, (hh - y) * row), y * row);
    return out;
  }
  XE.topDown = topDown;

  /* ---------- GIF ---------- */
  // median-cut palette (<= 256 colours) from sampled pixels
  function medianCut(samples, n) {
    var boxes = [{ px: samples }];
    function range(b) { var mn = [255, 255, 255], mx = [0, 0, 0]; b.px.forEach(function (p) { for (var c = 0; c < 3; c++) { if (p[c] < mn[c]) mn[c] = p[c]; if (p[c] > mx[c]) mx[c] = p[c]; } }); b.rng = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]]; b.span = Math.max.apply(null, b.rng); }
    range(boxes[0]);
    while (boxes.length < n) {
      var bi = -1, best = -1;
      boxes.forEach(function (b, i) { if (b.px.length > 1 && b.span > best) { best = b.span; bi = i; } });
      if (bi < 0) break;
      var b = boxes[bi], ch = b.rng.indexOf(b.span);
      b.px.sort(function (p, q) { return p[ch] - q[ch]; });
      var mid = b.px.length >> 1, b1 = { px: b.px.slice(0, mid) }, b2 = { px: b.px.slice(mid) };
      range(b1); range(b2); boxes.splice(bi, 1, b1, b2);
    }
    return boxes.map(function (b) { var r = 0, g = 0, bl = 0; b.px.forEach(function (p) { r += p[0]; g += p[1]; bl += p[2]; }); var k = b.px.length || 1; return [Math.round(r / k), Math.round(g / k), Math.round(bl / k)]; });
  }
  // nearest palette index with a 32^3 lookup cache
  function Quantizer(pal) {
    this.pal = pal; this.cache = new Int16Array(32768).fill(-1);
  }
  Quantizer.prototype.index = function (r, g, b) {
    var key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3), c = this.cache[key];
    if (c >= 0) return c;
    var best = 0, bd = 1e9, pal = this.pal;
    for (var i = 0; i < pal.length; i++) { var dr = pal[i][0] - r, dg = pal[i][1] - g, db = pal[i][2] - b, d = dr * dr * 2 + dg * dg * 3 + db * db; if (d < bd) { bd = d; best = i; } }
    this.cache[key] = best;
    return best;
  };
  // LZW (GIF variant) -> sub-blocked byte stream
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
  XE.lzw = lzw;
  function GifWriter(w, hh, pal, loop) {
    this.parts = []; this.w = w; this.h = hh;
    var hdr = [71, 73, 70, 56, 57, 97, w & 255, w >> 8, hh & 255, hh >> 8, 0xF7, 0, 0]; // GCT 256 entries
    var gct = []; for (var i = 0; i < 256; i++) { var c = pal[i] || [0, 0, 0]; gct.push(c[0], c[1], c[2]); }
    var app = [0x21, 0xFF, 11, 78, 69, 84, 83, 67, 65, 80, 69, 50, 46, 48, 3, 1, loop & 255, (loop >> 8) & 255, 0];
    this.parts.push(new Uint8Array(hdr.concat(gct, app)));
  }
  GifWriter.prototype.addFrame = function (indices, delayCs) {
    var w = this.w, hh = this.h;
    var gce = [0x21, 0xF9, 4, 0, delayCs & 255, (delayCs >> 8) & 255, 0, 0];
    var desc = [0x2C, 0, 0, 0, 0, w & 255, w >> 8, hh & 255, hh >> 8, 0, 8];
    this.parts.push(new Uint8Array(gce.concat(desc)), new Uint8Array(lzw(indices, 8)));
  };
  GifWriter.prototype.blob = function () { this.parts.push(new Uint8Array([0x3B])); return new Blob(this.parts, { type: 'image/gif' }); };

  XE.renderGif = function (st, s, fr, onProgress, cancel) {
    var fps = st.fps || s.fps, w = st.w || s.w, hh = st.h || s.h;
    var total = Math.round((fr[1] - fr[0]) / s.fps * fps);
    if (total > 1800) return Promise.reject(new Error('GIF export is limited to 1800 frames (' + total + ' requested) — shorten the range or lower the frame rate'));
    // pass 1: palette from a spread of frames (every k-th frame, up to 24), sampling every 7th pixel
    var samples = [], every = Math.max(1, Math.floor(total / 24)), writer = null, q = null, frames = [];
    return frameLoop(st, s, fr, function (p, msg) { onProgress(p * 0.9, msg); }, cancel, function (px, i) {
      var data = topDown(px, w, hh);
      frames.push(data);
      if (i % every === 0) for (var k = (i * 13) % 7; k < data.length; k += 7 * 4) samples.push([data[k], data[k + 1], data[k + 2]]);
      return null;
    }).then(function (info) {
      if (cancel.v) return null;
      onProgress(0.9, 'Building palette…');
      var pal = medianCut(samples, 256); while (pal.length < 256) pal.push([0, 0, 0]);
      q = new Quantizer(pal);
      writer = new GifWriter(w, hh, pal, 0);
      var delay = Math.max(2, Math.round(100 / fps)), n = frames.length, dither = st.dither !== false;
      var idx = new Uint8Array(w * hh), err = dither ? new Float32Array((w + 2) * 3 * 2) : null;
      return (function loop(i) {
        if (i >= n || cancel.v) return Promise.resolve();
        var d = frames[i];
        if (!dither) { for (var p = 0, o = 0; p < idx.length; p++, o += 4) idx[p] = q.index(d[o], d[o + 1], d[o + 2]); }
        else { // Floyd–Steinberg with two error rows
          err.fill(0);
          var rowA = 0, rowB = (w + 2) * 3;
          for (var y = 0; y < hh; y++) {
            var cur = y % 2 ? rowB : rowA, nxt = y % 2 ? rowA : rowB;
            for (var t = 0; t < (w + 2) * 3; t++) err[nxt + t] = 0;
            for (var x = 0; x < w; x++) {
              var o2 = (y * w + x) * 4, e = cur + (x + 1) * 3;
              var r = U.clamp(d[o2] + err[e], 0, 255), g = U.clamp(d[o2 + 1] + err[e + 1], 0, 255), b = U.clamp(d[o2 + 2] + err[e + 2], 0, 255);
              var pi = q.index(r | 0, g | 0, b | 0), pc = pal[pi];
              idx[y * w + x] = pi;
              var er = r - pc[0], eg = g - pc[1], eb = b - pc[2];
              err[e + 3] += er * 7 / 16; err[e + 4] += eg * 7 / 16; err[e + 5] += eb * 7 / 16;
              var dn = nxt + (x + 1) * 3;
              err[dn - 3] += er * 3 / 16; err[dn - 2] += eg * 3 / 16; err[dn - 1] += eb * 3 / 16;
              err[dn] += er * 5 / 16; err[dn + 1] += eg * 5 / 16; err[dn + 2] += eb * 5 / 16;
              err[dn + 3] += er / 16; err[dn + 4] += eg / 16; err[dn + 5] += eb / 16;
            }
          }
        }
        writer.addFrame(idx, delay);
        frames[i] = null;
        onProgress(0.9 + 0.1 * (i + 1) / n, 'Encoding GIF frame ' + (i + 1) + ' / ' + n);
        return (i % 4 === 3 ? new Promise(function (r) { setTimeout(r, 0); }) : Promise.resolve()).then(function () { return loop(i + 1); });
      })(0).then(function () { if (cancel.v) return null; var blob = writer.blob(); return { blob: blob, ext: 'gif', size: blob.size, frames: info.total }; });
    });
  };

  /* ---------- ZIP (stored) ---------- */
  var crcTable = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { var c = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  XE.crc32 = crc32;
  function ZipWriter(sink) { this.sink = sink || new C.BlobSink('application/zip'); this.entries = []; }
  function le16(n) { return [n & 255, (n >> 8) & 255]; }
  function le32(n) { return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]; }
  function dosTime(d) { return le16((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)).concat(le16(((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate())); }
  ZipWriter.prototype.add = function (name, u8) {
    var nm = new TextEncoder().encode(name), crc = crc32(u8), off = this.sink.pos, dt = dosTime(new Date());
    var hdr = new Uint8Array([0x50, 0x4B, 3, 4].concat(le16(20), le16(0), le16(0), dt, le32(crc), le32(u8.length), le32(u8.length), le16(nm.length), le16(0)));
    this.sink.write([hdr, nm, u8], false);
    this.entries.push({ nm: nm, crc: crc, size: u8.length, off: off, dt: dt });
  };
  ZipWriter.prototype.finalize = function () {
    var self = this, cdStart = this.sink.pos, cdLen = 0;
    this.entries.forEach(function (e) {
      var cd = new Uint8Array([0x50, 0x4B, 1, 2].concat(le16(20), le16(20), le16(0), le16(0), e.dt, le32(e.crc), le32(e.size), le32(e.size), le16(e.nm.length), le16(0), le16(0), le16(0), le16(0), le32(0), le32(e.off)));
      self.sink.write([cd, e.nm], false); cdLen += cd.length + e.nm.length;
    });
    var n = this.entries.length;
    this.sink.write(new Uint8Array([0x50, 0x4B, 5, 6].concat(le16(0), le16(0), le16(n), le16(n), le32(cdLen), le32(cdStart), le16(0))), false);
    return this.sink.close();
  };
  XE.ZipWriter = ZipWriter;
  function canvasPNG(cv) { return new Promise(function (res) { cv.toBlob(function (b) { b.arrayBuffer().then(function (ab) { res(new Uint8Array(ab)); }); }, 'image/png'); }); }
  XE.renderPngZip = function (st, s, fr, onProgress, cancel, sink) {
    var total = Math.round((fr[1] - fr[0]) / s.fps * (st.fps || s.fps));
    if (total > 3000) return Promise.reject(new Error('PNG sequence export is limited to 3000 frames (' + total + ' requested)'));
    var zip = new ZipWriter(sink || null), base = (st.name || 'frame').replace(/[\\/:*?"<>|]+/g, '_'), pad = String(total).length < 4 ? 4 : String(total).length;
    var tmp = document.createElement('canvas');
    return frameLoop(st, s, fr, onProgress, cancel, function (px, i, n, canvas) {
      // canvas holds the WebGL frame (preserveDrawingBuffer) -> encode via a 2D copy so toBlob works on every renderer
      tmp.width = canvas.width; tmp.height = canvas.height; tmp.getContext('2d').drawImage(canvas, 0, 0);
      return canvasPNG(tmp).then(function (u8) { var num = String(i + 1); while (num.length < pad) num = '0' + num; zip.add(base + '_' + num + '.png', u8); return zip.sink.ready ? zip.sink.ready() : null; });
    }).then(function () { if (cancel.v) { zip.sink.abort(); return null; } return zip.finalize().then(function (r) { return r.file ? Object.assign({ ext: 'zip' }, r) : { blob: r.blob, ext: 'zip', size: r.blob.size }; }); });
  };

  /* ---------- Contact sheet ---------- */
  XE.contactSheetDialog = function () {
    var s = P.seq(); if (!s || !P.seqDuration(s)) { C.toast('The sequence is empty'); return; }
    var cols = h('input', { type: 'number', value: 4, min: 1, max: 12, style: { width: '70px' } }), rows = h('input', { type: 'number', value: 4, min: 1, max: 20, style: { width: '70px' } });
    var tw = h('input', { type: 'number', value: 320, min: 80, max: 1280, step: 10, style: { width: '80px' } });
    var src = h('select'); [['even', 'Evenly spaced'], ['markers', 'At sequence markers (' + s.markers.length + ')'], ['cuts', 'At every cut on V1']].forEach(function (o) { src.appendChild(h('option', { value: o[0] }, o[1])); });
    [cols, rows, tw].forEach(function (i) { i.addEventListener('keydown', function (e) { e.stopPropagation(); }); });
    C.ui.dialog({ title: 'Contact Sheet', width: 460, body: h('div', h('p.muted', { style: { marginTop: 0, lineHeight: 1.5 } }, 'A single PNG with thumbnails and timecodes — handy for notes, chapter planning or a quick overview.'),
      h('div.form-grid', h('label', 'Frames from'), src, h('label', 'Grid'), h('div.row', cols, h('span.muted', '×'), rows), h('label', 'Thumbnail width'), h('div.row', tw, h('span.muted', 'px')))),
      buttons: [{ label: 'Cancel' }, { label: 'Create', primary: true, action: function () {
        var o = { cols: U.clamp(+cols.value || 4, 1, 12), rows: U.clamp(+rows.value || 4, 1, 20), tw: U.clamp(+tw.value || 320, 80, 1280), src: src.value };
        var pr = C.ui.progress('Rendering contact sheet…', { cancel: function () { o.cancel = true; } });
        XE.contactSheet(s, o, function (p, m) { pr.update(p, m); }).then(function (blob) { pr.done(); if (blob) C.Export.saveBlob(blob, (s.name || 'sheet') + '-contact-sheet.png'); }, function (e) { pr.done(); C.ui.alert('Contact sheet failed', String(e && e.message || e)); });
      } }] });
  };
  XE.contactSheet = function (s, o, onProgress) {
    var dur = P.seqDuration(s), frames = [], n = o.cols * o.rows;
    if (o.src === 'markers' && s.markers.length) frames = s.markers.map(function (m) { return m.f; }).sort(function (a, b) { return a - b; }).slice(0, n);
    else if (o.src === 'cuts') { var v1 = P.vtracks(s)[0]; frames = P.clipsOn(s, v1.id).map(function (c) { return c.start; }).slice(0, n); }
    if (!frames.length) for (var i = 0; i < n; i++) frames.push(Math.min(dur - 1, Math.floor((i + 0.5) * dur / n)));
    var tw = o.tw, th = Math.round(tw * s.h / s.w), pad = 10, labelH = 18, W = o.cols * (tw + pad) + pad, H = Math.ceil(frames.length / o.cols) * (th + labelH + pad) + pad + 30;
    var out = document.createElement('canvas'); out.width = W; out.height = H;
    var g = out.getContext('2d'); g.fillStyle = '#141210'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#f2ebe3'; g.font = '600 14px Segoe UI, sans-serif'; g.fillText(s.name + '  ·  ' + s.w + '×' + s.h + ' @ ' + s.fps + ' fps  ·  ' + U.fmtTC(dur, s.fps), pad, 20);
    var cv = document.createElement('canvas'); cv.width = tw; cv.height = th;
    var comp = C.createCompositor(cv), prov = new C.SourceProvider('export'); prov.useDecoders = !!window.VideoDecoder;
    var tmp = document.createElement('canvas'); tmp.width = tw; tmp.height = th;
    return (function loop(i) {
      if (i >= frames.length || o.cancel) return Promise.resolve();
      var scene = C.Scene.build(s, frames[i], { captions: false });
      return prov.prepare(scene).then(function () {
        comp.render(scene, tw, th, prov, {});
        tmp.getContext('2d').drawImage(cv, 0, 0);
        var x = pad + (i % o.cols) * (tw + pad), y = 30 + pad + Math.floor(i / o.cols) * (th + labelH + pad);
        g.drawImage(tmp, x, y);
        g.fillStyle = '#c8bdb1'; g.font = '11px ' + (getComputedStyle(document.body).getPropertyValue('--mono') || 'monospace'); g.fillText(U.fmtTC(frames[i], s.fps), x, y + th + 13);
        var mk = s.markers.filter(function (m) { return m.f === frames[i] && m.name; })[0]; if (mk) { g.fillStyle = '#f0913a'; g.font = '600 11px Segoe UI, sans-serif'; g.fillText(mk.name, x + 90, y + th + 13); }
        onProgress((i + 1) / frames.length, 'Frame ' + (i + 1) + ' / ' + frames.length);
        return loop(i + 1);
      });
    })(0).then(function () { prov.dropAll(); if (comp.destroy) comp.destroy(); if (o.cancel) return null; return new Promise(function (res) { out.toBlob(res, 'image/png'); }); });
  };
  C.CMD.reg('contactSheet', 'Export Contact Sheet (PNG)…', 'File', null, function () { XE.contactSheetDialog(); });
  C.CMD.rebuild();
  var prevFile = C.Menus.extra.File;
  C.Menus.extra.File = function () { return (prevFile ? prevFile() : []).concat([{ label: 'Export Contact Sheet (PNG)…', action: function () { XE.contactSheetDialog(); }, disabled: function () { return !C.state.project; } }]); };
})();
