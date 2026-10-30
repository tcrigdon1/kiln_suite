/* Cutline — streaming WebM (Matroska) muxer for WebCodecs output (VP8/VP9 video + Opus audio).
   Clusters are written to the sink as soon as they close (audio and video interleaved by timestamp), so memory
   stays bounded for long exports. The Segment size, Duration and the SeekHead entry for Cues are written as
   fixed-width placeholders and patched at the end; Cues are appended after the last cluster.
   Compatibility: `new WebMMuxer(opts)` without a sink buffers into a BlobSink and finalize() returns a Blob. */
(function () {
  'use strict';
  var C = window.Cutline;

  function idBytes(id) { var b = []; while (id > 0) { b.unshift(id & 0xff); id = Math.floor(id / 256); } return new Uint8Array(b); }
  function sizeVint(n) {
    for (var len = 1; len <= 8; len++) {
      if (n < Math.pow(2, 7 * len) - 1) {
        var b = new Uint8Array(len), v = n;
        for (var i = len - 1; i >= 0; i--) { b[i] = v & 0xff; v = Math.floor(v / 256); }
        b[0] |= (0x80 >> (len - 1));
        return b;
      }
    }
    throw new Error('size too large');
  }
  function size8(n) { var b = new Uint8Array(8), v = n; for (var i = 7; i >= 1; i--) { b[i] = v & 0xff; v = Math.floor(v / 256); } b[0] = 0x01; return b; }
  function uintBytes(n) { var b = []; do { b.unshift(n & 0xff); n = Math.floor(n / 256); } while (n > 0); return new Uint8Array(b); }
  function uintFixed(n, w) { var b = new Uint8Array(w), v = n; for (var i = w - 1; i >= 0; i--) { b[i] = v & 0xff; v = Math.floor(v / 256); } return b; }
  function floatBytes(f) { var b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, f); return b; }
  function strBytes(s) { return new TextEncoder().encode(s); }
  function node(id, kids) {
    var parts = [], len = 0;
    kids.forEach(function (k) {
      if (k instanceof Uint8Array) { parts.push(k); len += k.length; }
      else { parts.push.apply(parts, k.parts); len += k.len; }
    });
    var ib = idBytes(id), sb = sizeVint(len);
    return { len: ib.length + sb.length + len, parts: [ib, sb].concat(parts) };
  }
  function flat(n) { var out = new Uint8Array(n.len), o = 0; n.parts.forEach(function (p) { out.set(p, o); o += p.length; }); return out; }
  function u(id, n) { return node(id, [uintBytes(n)]); }
  function f(id, x) { return node(id, [floatBytes(x)]); }
  function s(id, x) { return node(id, [strBytes(x)]); }
  function bin(id, b) { return node(id, [b]); }
  function opusHead(ch, sr, preskip) {
    var b = new Uint8Array(19), dv = new DataView(b.buffer);
    b.set(strBytes('OpusHead'), 0); b[8] = 1; b[9] = ch; dv.setUint16(10, preskip, true); dv.setUint32(12, sr, true); dv.setInt16(16, 0, true); b[18] = 0;
    return b;
  }

  function WebMMuxer(opts, sink) {
    this.o = opts; // {video:{codec:'V_VP9', width, height, fps}, audio:{codec:'A_OPUS', sampleRate, channels}}
    this.ownSink = !sink;
    this.sink = sink || new C.BlobSink(opts.video ? 'video/webm' : 'audio/webm');
    this.vq = []; this.aq = []; this.audioPriv = null;
    this.started = false; this.cluster = null; this.cues = []; this.lastV = -1; this.lastA = -1; this.maxMs = 0;
    this.vDone = !opts.video; this.aDone = !opts.audio;
    this.bytesWritten = 0;
  }
  WebMMuxer.prototype.addVideo = function (chunk, meta) {
    var d = new Uint8Array(chunk.byteLength); chunk.copyTo(d);
    if (meta && meta.decoderConfig && meta.decoderConfig.description && !this.videoPriv) { var vd = meta.decoderConfig.description; this.videoPriv = vd instanceof ArrayBuffer ? new Uint8Array(vd.slice(0)) : new Uint8Array(vd.buffer.slice(vd.byteOffset, vd.byteOffset + vd.byteLength)); }
    this.vq.push({ ts: chunk.timestamp, key: chunk.type === 'key', data: d, track: 1 });
    this.lastV = chunk.timestamp;
    this.pump();
  };
  WebMMuxer.prototype.addAudio = function (chunk, meta) {
    var d = new Uint8Array(chunk.byteLength); chunk.copyTo(d);
    if (meta && meta.decoderConfig && meta.decoderConfig.description && !this.audioPriv) {
      var desc = meta.decoderConfig.description;
      this.audioPriv = desc instanceof ArrayBuffer ? new Uint8Array(desc.slice(0)) : new Uint8Array(desc.buffer.slice(desc.byteOffset, desc.byteOffset + desc.byteLength));
    }
    this.aq.push({ ts: chunk.timestamp, key: true, data: d, track: 2 });
    this.lastA = chunk.timestamp;
    this.pump();
  };
  // header: EBML, Segment (unknown size, patched), SeekHead (Info/Tracks/Cues with fixed-width positions), Info, Tracks
  WebMMuxer.prototype.writeHeader = function () {
    var o = this.o, sink = this.sink;
    var ebml = node(0x1A45DFA3, [u(0x4286, 1), u(0x42F7, 1), u(0x42F2, 4), u(0x42F3, 8), s(0x4282, 'webm'), u(0x4287, 4), u(0x4285, 2)]);
    var tracks = [];
    if (o.video) tracks.push(node(0xAE, [u(0xD7, 1), u(0x73C5, 1), u(0x83, 1), s(0x86, o.video.codec), u(0x9C, 0),
      u(0x23E383, Math.round(1e9 / o.video.fps))].concat(this.videoPriv && o.video.codec === 'V_AV1' ? [bin(0x63A2, this.videoPriv)] : []).concat([
      node(0xE0, [u(0xB0, o.video.width), u(0xBA, o.video.height)])])));
    var preskip = 312;
    if (o.audio) {
      var priv = this.audioPriv;
      if (!priv || priv.length < 19 || String.fromCharCode.apply(null, priv.subarray(0, 8)) !== 'OpusHead') priv = opusHead(o.audio.channels, o.audio.sampleRate, preskip);
      else preskip = new DataView(priv.buffer, priv.byteOffset).getUint16(10, true);
      tracks.push(node(0xAE, [u(0xD7, 2), u(0x73C5, 2), u(0x83, 2), s(0x86, o.audio.codec), bin(0x63A2, priv),
        u(0x56AA, Math.round(preskip / 48000 * 1e9)), u(0x56BB, 80000000),
        node(0xE1, [f(0xB5, o.audio.sampleRate), u(0x9F, o.audio.channels)])]));
    }
    var info = node(0x1549A966, [u(0x2AD7B1, 1000000), s(0x4D80, 'Cutline'), s(0x5741, 'Cutline ' + C.version), f(0x4489, 0)]);
    var tracksEl = node(0x1654AE6B, tracks);
    // SeekHead with 8-byte SeekPositions so they can be patched in place
    function seek(idNum, pos) { return node(0x4DBB, [node(0x53AB, [idBytes(idNum)]), node(0x53AC, [uintFixed(pos, 8)])]); }
    var tmpHead = node(0x114D9B74, [seek(0x1549A966, 0), seek(0x1654AE6B, 0), seek(0x1C53BB6B, 0)]);
    var headLen = tmpHead.len;
    var infoPos = headLen, tracksPos = headLen + info.len;
    var seekHead = node(0x114D9B74, [seek(0x1549A966, infoPos), seek(0x1654AE6B, tracksPos), seek(0x1C53BB6B, 0)]);
    var shBytes = flat(seekHead), infoBytes = flat(info);
    var ebmlBytes = flat(ebml);
    this.segSizePos = ebmlBytes.length + 4; // after the 4-byte Segment ID
    this.segDataStart = this.segSizePos + 8;
    // locate patch points inside the SeekHead (Cues SeekPosition = last 8 bytes) and Info (Duration = last 8 bytes)
    this.cuesSeekPos = this.segDataStart + shBytes.length - 8;
    this.durPos = this.segDataStart + infoPos + infoBytes.length - 8;
    var segHead = new Uint8Array(12); segHead.set(idBytes(0x18538067), 0); segHead.set([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], 4);
    var hdr = new Uint8Array(ebmlBytes.length + 12 + shBytes.length + infoBytes.length);
    hdr.set(ebmlBytes, 0); hdr.set(segHead, ebmlBytes.length); hdr.set(shBytes, ebmlBytes.length + 12); hdr.set(infoBytes, ebmlBytes.length + 12 + shBytes.length);
    sink.write(hdr, true);
    sink.write(flat(tracksEl), false);
    this.started = true;
  };
  // Emit blocks in timestamp order up to the point both tracks have reached (all of them when finishing)
  WebMMuxer.prototype.pump = function (final) {
    var o = this.o;
    if (!this.started) {
      // wait for the audio decoder config (OpusHead) before writing Tracks, unless there is no audio
      if (o.audio && !this.audioPriv && !this.aq.length && !final) return;
      if (o.video && !this.vq.length && !final && !this.vDone) return;
      this.writeHeader();
    }
    var limit;
    if (final) limit = Infinity;
    else {
      var vl = o.video ? (this.vDone ? Infinity : this.lastV) : Infinity, al = o.audio ? (this.aDone ? Infinity : this.lastA) : Infinity;
      limit = Math.min(vl, al);
    }
    var vq = this.vq, aq = this.aq, vi = 0, ai = 0;
    while (true) {
      var v = vi < vq.length ? vq[vi] : null, a = ai < aq.length ? aq[ai] : null;
      var b = v && (!a || v.ts <= a.ts) ? v : a;
      if (!b || b.ts > limit) break;
      if (b === v) vi++; else ai++;
      this.addBlock(b);
    }
    if (vi) this.vq = vq.slice(vi);
    if (ai) this.aq = aq.slice(ai);
  };
  WebMMuxer.prototype.addBlock = function (b) {
    var ms = Math.round(b.ts / 1000), hasVideo = !!this.o.video, cur = this.cluster;
    var startNew = !cur || ms - cur.t0 > 30000 || (hasVideo ? (b.track === 1 && b.key && ms - cur.t0 >= 1000) : ms - cur.t0 >= 2000);
    if (startNew) { this.closeCluster(); cur = this.cluster = { t0: ms, parts: [], len: 0, key: b.track === 1 && b.key }; var tc = u(0xE7, ms); cur.parts.push(flat(tc)); cur.len += tc.len; }
    var hdr = new Uint8Array(4), rel = ms - cur.t0;
    hdr[0] = 0x80 | b.track; hdr[1] = (rel >> 8) & 0xff; hdr[2] = rel & 0xff; hdr[3] = b.key ? 0x80 : 0;
    var id = idBytes(0xA3), sz = sizeVint(4 + b.data.length);
    cur.parts.push(id, sz, hdr, b.data); cur.len += id.length + sz.length + 4 + b.data.length;
    var endMs = ms + (b.track === 1 ? 1000 / this.o.video.fps : 20);
    if (endMs > this.maxMs) this.maxMs = endMs;
  };
  WebMMuxer.prototype.closeCluster = function () {
    var cur = this.cluster; if (!cur) return;
    this.cluster = null;
    var pos = this.sink.pos - this.segDataStart;
    if (cur.key || !this.o.video) this.cues.push({ t: cur.t0, pos: pos });
    var head = [idBytes(0x1F43B675), sizeVint(cur.len)];
    this.sink.write(head.concat(cur.parts), false);
  };
  WebMMuxer.prototype.ready = function () { return this.sink.ready(); };
  WebMMuxer.prototype.finalize = function () {
    var self = this, sink = this.sink;
    this.vDone = this.aDone = true;
    this.pump(true);
    this.closeCluster();
    var hasVideo = !!this.o.video;
    var cuesPos = sink.pos - this.segDataStart;
    if (this.cues.length) {
      var cueList = this.cues.map(function (c) { return node(0xBB, [u(0xB3, c.t), node(0xB7, [u(0xF7, hasVideo ? 1 : 2), u(0xF1, c.pos)])]); });
      sink.write(flat(node(0x1C53BB6B, cueList)), false);
      sink.patch(this.cuesSeekPos, uintFixed(cuesPos, 8));
    } else {
      // no cues: turn the reserved SeekPosition into a harmless position of the Info element
      sink.patch(this.cuesSeekPos, uintFixed(0, 8));
    }
    sink.patch(this.segSizePos, size8(sink.pos - this.segDataStart));
    sink.patch(this.durPos, floatBytes(this.maxMs));
    return sink.close().then(function (r) { self.result = r; return r; });
  };
  // Legacy synchronous-style API: finalize() returned a Blob. With an own BlobSink this still works (resolved value).
  WebMMuxer.prototype.finalizeBlob = function () { return this.finalize().then(function (r) { return r.blob; }); };
  C.WebMMuxer = WebMMuxer;
})();
