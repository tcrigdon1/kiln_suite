/* Cutline — streaming MP4 (ISO-BMFF) muxer for WebCodecs output: H.264 (avc1) or VP9 (vp09) video,
   AAC (mp4a) or Opus audio. Layout: ftyp + mdat (64-bit size, patched at the end) + moov written last, with co64
   chunk offsets when the file passes 4 GiB. Sample data goes to the sink as it arrives (interleaved by timestamp);
   only the small per-sample tables are kept in memory. */
(function () {
  'use strict';
  var C = window.Cutline;

  function u8(n) { return new Uint8Array([n & 255]); }
  function u16(n) { var b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n); return b; }
  function u32(n) { var b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0); return b; }
  function i32(n) { var b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, n | 0); return b; }
  function u64(n) { var b = new Uint8Array(8), dv = new DataView(b.buffer); dv.setUint32(0, Math.floor(n / 4294967296)); dv.setUint32(4, n >>> 0); return b; }
  function str(s) { return new TextEncoder().encode(s); }
  function cat(arr) { var len = 0; arr.forEach(function (a) { len += a.length; }); var o = new Uint8Array(len), p = 0; arr.forEach(function (a) { o.set(a, p); p += a.length; }); return o; }
  function box(type, kids) { var body = cat(kids); return cat([u32(body.length + 8), str(type), body]); }
  function full(type, ver, flags, kids) { return box(type, [u8(ver), new Uint8Array([(flags >> 16) & 255, (flags >> 8) & 255, flags & 255])].concat(kids)); }
  var MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
  function matrix() { return cat(MATRIX.map(function (v) { return u32(v); })); }
  function zeros(n) { return new Uint8Array(n); }
  function descBytes(desc) {
    if (!desc) return null;
    if (desc instanceof ArrayBuffer) return new Uint8Array(desc.slice(0));
    return new Uint8Array(desc.buffer.slice(desc.byteOffset, desc.byteOffset + desc.byteLength));
  }
  // big tables (stsz / co64 / ctts) built straight into one buffer
  function tableBox(type, ver, headWords, count, entryBytes, fill) {
    var bodyLen = 4 + headWords * 4 + count * entryBytes, b = new Uint8Array(8 + bodyLen), dv = new DataView(b.buffer);
    dv.setUint32(0, b.length); b.set(str(type), 4); b[8] = ver;
    fill(dv, 12);
    return b;
  }

  function MP4Muxer(opts, sink) {
    this.o = opts;
    this.ownSink = !sink;
    this.sink = sink || new C.BlobSink(opts.video ? 'video/mp4' : 'audio/mp4');
    this.vDesc = null; this.aDesc = null;
    this.tracks = {};
    if (opts.video) this.tracks.video = { kind: 'video', ts: [], dur: [], key: [], size: [], chunks: [] };
    if (opts.audio) this.tracks.audio = { kind: 'audio', ts: [], dur: [], key: [], size: [], chunks: [] };
    this.vq = []; this.aq = []; this.lastV = -1; this.lastA = -1; this.vDone = !opts.video; this.aDone = !opts.audio;
    this.started = false; this.curChunk = null;
  }
  MP4Muxer.prototype.addVideo = function (chunk, meta) {
    var d = new Uint8Array(chunk.byteLength); chunk.copyTo(d);
    if (meta && meta.decoderConfig && meta.decoderConfig.description && !this.vDesc) this.vDesc = descBytes(meta.decoderConfig.description);
    this.vq.push({ t: 'video', ts: chunk.timestamp, dur: chunk.duration, key: chunk.type === 'key', data: d });
    this.lastV = chunk.timestamp; this.pump();
  };
  MP4Muxer.prototype.addAudio = function (chunk, meta) {
    var d = new Uint8Array(chunk.byteLength); chunk.copyTo(d);
    if (meta && meta.decoderConfig && meta.decoderConfig.description && !this.aDesc) this.aDesc = descBytes(meta.decoderConfig.description);
    this.aq.push({ t: 'audio', ts: chunk.timestamp, dur: chunk.duration, key: true, data: d });
    this.lastA = chunk.timestamp; this.pump();
  };
  MP4Muxer.prototype.start = function () {
    var o = this.o;
    var brand = o.video && o.video.codec === 'avc' ? 'avc1' : o.video && o.video.codec === 'av1' ? 'av01' : o.video && o.video.codec === 'hevc' ? 'hvc1' : 'iso6';
    var ftyp = box('ftyp', [str('isom'), u32(0x200), str('isom'), str('iso2'), str(brand), str('mp41')]);
    this.sink.write(ftyp, false);
    this.mdatPos = this.sink.pos;
    this.sink.write(cat([u32(1), str('mdat'), u64(16)]), true); // 64-bit size patched in finalize
    this.started = true;
  };
  MP4Muxer.prototype.pump = function (final) {
    if (!this.started) this.start();
    var limit = final ? Infinity : Math.min(this.o.video ? (this.vDone ? Infinity : this.lastV) : Infinity, this.o.audio ? (this.aDone ? Infinity : this.lastA) : Infinity);
    var vq = this.vq, aq = this.aq, vi = 0, ai = 0;
    while (true) {
      var v = vi < vq.length ? vq[vi] : null, a = ai < aq.length ? aq[ai] : null;
      var s = v && (!a || v.ts <= a.ts) ? v : a;
      if (!s || s.ts > limit) break;
      if (s === v) vi++; else ai++;
      this.writeSample(s);
    }
    if (vi) this.vq = vq.slice(vi);
    if (ai) this.aq = aq.slice(ai);
  };
  MP4Muxer.prototype.writeSample = function (s) {
    var t = this.tracks[s.t]; if (!t) return;
    var cc = this.curChunk;
    if (!cc || cc.track !== t || s.ts - cc.t0 >= 1e6) { cc = this.curChunk = { track: t, t0: s.ts, offset: this.sink.pos, count: 0 }; t.chunks.push(cc); }
    cc.count++;
    t.ts.push(s.ts); t.dur.push(s.dur || 0); t.key.push(s.key ? 1 : 0); t.size.push(s.data.length);
    this.sink.write(s.data, false);
  };
  MP4Muxer.prototype.ready = function () { return this.sink.ready(); };

  function esdsBox(asc, bitrate) {
    function desc(tag, body) { var len = body.length; return cat([u8(tag), new Uint8Array([0x80 | ((len >> 21) & 127), 0x80 | ((len >> 14) & 127), 0x80 | ((len >> 7) & 127), len & 127]), body]); }
    var dsi = desc(0x05, asc);
    var dcd = desc(0x04, cat([u8(0x40), u8(0x15), new Uint8Array([0, 0, 0]), u32(bitrate || 128000), u32(bitrate || 128000), dsi]));
    var es = desc(0x03, cat([u16(1), u8(0), dcd, desc(0x06, u8(2))]));
    return full('esds', 0, 0, [es]);
  }
  function aacASC(sr, ch) {
    var idx = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350].indexOf(sr); if (idx < 0) idx = 3;
    var v = (2 << 11) | (idx << 7) | (ch << 3);
    return new Uint8Array([(v >> 8) & 255, v & 255]);
  }
  function dOps(head, ch, sr) {
    var preskip = 312, gain = 0;
    if (head && head.length >= 19) { var dv = new DataView(head.buffer, head.byteOffset); preskip = dv.getUint16(10, true); gain = dv.getInt16(16, true); }
    return box('dOps', [u8(0), u8(ch), u16(preskip), u32(sr), u16(gain & 0xffff), u8(0)]);
  }
  function vpcC() { return full('vpcC', 1, 0, [u8(0), u8(31), u8((8 << 4) | (1 << 1) | 0), u8(1), u8(1), u8(1), u16(0)]); }

  MP4Muxer.prototype.finalize = function () {
    var o = this.o, self = this, sink = this.sink;
    this.vDone = this.aDone = true;
    this.pump(true);
    var endPos = sink.pos;
    sink.patch(this.mdatPos + 8, u64(endPos - this.mdatPos));
    var useCo64 = endPos > 0xffffffff;
    var list = [];
    if (o.video && this.tracks.video.ts.length) list.push({ t: this.tracks.video, id: 1, timescale: Math.round(o.video.fps * 1000) });
    if (o.audio && this.tracks.audio.ts.length) list.push({ t: this.tracks.audio, id: list.length + 1, timescale: o.audio.sampleRate });
    var movieTS = 1000, maxDurMs = 0;
    var traks = list.map(function (L) {
      var t = L.t, ts = L.timescale, n = t.ts.length, kind = t.kind;
      var deltas = new Array(n), ctts = null, anyCtts = false;
      if (kind === 'video') {
        var delta = 1000; ctts = new Array(n);
        for (var i = 0; i < n; i++) { deltas[i] = delta; var off = Math.round(t.ts[i] / 1e6 * ts) - i * delta; ctts[i] = off; if (off !== 0) anyCtts = true; }
      } else {
        for (var j = 0; j < n; j++) { var d = t.dur[j] ? Math.round(t.dur[j] / 1e6 * ts) : (j < n - 1 ? Math.round((t.ts[j + 1] - t.ts[j]) / 1e6 * ts) : 960); deltas[j] = Math.max(1, d); }
      }
      var dur = 0; for (var q = 0; q < n; q++) dur += deltas[q];
      maxDurMs = Math.max(maxDurMs, dur / ts * 1000);
      var stts = [], last = null;
      deltas.forEach(function (dd) { if (last && last.d === dd) last.c++; else { last = { c: 1, d: dd }; stts.push(last); } });
      var sttsBox = full('stts', 0, 0, [u32(stts.length)].concat(stts.map(function (e) { return cat([u32(e.c), u32(e.d)]); })));
      var stszBox = tableBox('stsz', 0, 2, n, 4, function (dv, p) { dv.setUint32(p, 0); dv.setUint32(p + 4, n); p += 8; for (var k = 0; k < n; k++, p += 4) dv.setUint32(p, t.size[k]); });
      var stscE = [], prevCount = -1;
      t.chunks.forEach(function (c, ci) { if (c.count !== prevCount) { stscE.push(cat([u32(ci + 1), u32(c.count), u32(1)])); prevCount = c.count; } });
      var stscBox = full('stsc', 0, 0, [u32(stscE.length)].concat(stscE));
      var nc = t.chunks.length;
      var stcoBox = useCo64 ? tableBox('co64', 0, 1, nc, 8, function (dv, p) { dv.setUint32(p, nc); p += 4; for (var k = 0; k < nc; k++, p += 8) { var v = t.chunks[k].offset; dv.setUint32(p, Math.floor(v / 4294967296)); dv.setUint32(p + 4, v >>> 0); } })
        : tableBox('stco', 0, 1, nc, 4, function (dv, p) { dv.setUint32(p, nc); p += 4; for (var k = 0; k < nc; k++, p += 4) dv.setUint32(p, t.chunks[k].offset); });
      var entry;
      if (kind === 'video') {
        var vo = o.video, codecBox, entryType;
        if (vo.codec === 'avc') { codecBox = box('avcC', [self.vDesc || new Uint8Array(0)]); entryType = 'avc1'; }
        else if (vo.codec === 'hevc') { codecBox = box('hvcC', [self.vDesc || new Uint8Array(0)]); entryType = 'hvc1'; }
        else if (vo.codec === 'av1') { codecBox = box('av1C', [self.vDesc || new Uint8Array([0x81, 0x00, 0x0c, 0x00])]); entryType = 'av01'; }
        else { codecBox = vpcC(); entryType = 'vp09'; }
        entry = box(entryType, [zeros(6), u16(1), zeros(16), u16(vo.width), u16(vo.height), u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32), u16(0x18), u16(0xffff), codecBox]);
      } else {
        var ao = o.audio, abox = ao.codec === 'aac' ? esdsBox(self.aDesc || aacASC(ao.sampleRate, ao.channels), ao.bitrate) : dOps(self.aDesc, ao.channels, ao.sampleRate);
        entry = box(ao.codec === 'aac' ? 'mp4a' : 'Opus', [zeros(6), u16(1), zeros(8), u16(ao.channels), u16(16), u16(0), u16(0), u32(ao.sampleRate * 65536), abox]);
      }
      var stblKids = [full('stsd', 0, 0, [u32(1), entry]), sttsBox];
      if (kind === 'video') {
        var keys = []; for (var z = 0; z < n; z++) if (t.key[z]) keys.push(z + 1);
        if (keys.length < n) stblKids.push(full('stss', 0, 0, [u32(keys.length)].concat(keys.map(u32))));
        if (anyCtts) {
          var runs = [], lr = null; ctts.forEach(function (c) { if (lr && lr.o === c) lr.c++; else { lr = { c: 1, o: c }; runs.push(lr); } });
          stblKids.push(full('ctts', 1, 0, [u32(runs.length)].concat(runs.map(function (r) { return cat([u32(r.c), i32(r.o)]); }))));
        }
      }
      stblKids.push(stscBox, stszBox, stcoBox);
      var stbl = box('stbl', stblKids);
      var dinf = box('dinf', [full('dref', 0, 0, [u32(1), full('url ', 0, 1, [])])]);
      var mhd = kind === 'video' ? full('vmhd', 0, 1, [u16(0), u16(0), u16(0), u16(0)]) : full('smhd', 0, 0, [u16(0), u16(0)]);
      var minf = box('minf', [mhd, dinf, stbl]);
      var hdlr = full('hdlr', 0, 0, [u32(0), str(kind === 'video' ? 'vide' : 'soun'), zeros(12), str(kind === 'video' ? 'Cutline Video' : 'Cutline Audio'), u8(0)]);
      var mdhd = full('mdhd', 0, 0, [u32(0), u32(0), u32(ts), u32(dur), u16(0x55c4), u16(0)]);
      var mdia = box('mdia', [mdhd, hdlr, minf]);
      var tkhd = full('tkhd', 0, 3, [u32(0), u32(0), u32(L.id), u32(0), u32(Math.round(dur / ts * movieTS)), zeros(8), u16(0), u16(0), u16(kind === 'audio' ? 0x0100 : 0), u16(0), matrix(),
        u32(kind === 'video' ? o.video.width * 65536 : 0), u32(kind === 'video' ? o.video.height * 65536 : 0)]);
      return box('trak', [tkhd, mdia]);
    });
    var mvhd = full('mvhd', 0, 0, [u32(0), u32(0), u32(movieTS), u32(Math.round(maxDurMs)), u32(0x00010000), u16(0x0100), zeros(10), matrix(), zeros(24), u32(list.length + 1)]);
    sink.write(box('moov', [mvhd].concat(traks)), false);
    return sink.close().then(function (r) { self.result = r; return r; });
  };
  C.MP4Muxer = MP4Muxer;
})();
