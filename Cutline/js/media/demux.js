/* Cutline — demuxers for ISO-BMFF (MP4/MOV, incl. fragmented, moov-at-end, co64) and Matroska/WebM.
   Built for very large files (tens of GB, millions of samples): every access is a ranged File.slice() read,
   MP4 sample tables are kept in compact typed arrays, and Matroska clusters are located through Cues (or a lazy
   cluster-skip index when a file has none) and parsed on demand. Each track exposes a cursor API:
     track.cursor(tUs) -> Promise<Cursor>, cursor.next() -> Promise<{pts, dur, key, data}|null>   (times in µs)
   D.probe(file) returns {video, audio, duration, container} regardless of codec support;
   D.open(file) keeps the older video-only contract used by export (null unless the video track can be decoded). */
(function () {
  'use strict';
  var C = window.Cutline;
  var D = C.Demux = {};

  // Windowed random-access reader over a File/Blob
  function Reader(file) { this.f = file; this.size = file.size; this.wOff = -1; this.w = null; this.WIN = 4 * 1048576; }
  Reader.prototype.load = function (off, len) {
    var self = this, n = Math.max(len, this.WIN);
    return this.f.slice(off, Math.min(this.size, off + n)).arrayBuffer().then(function (ab) { self.wOff = off; self.w = new Uint8Array(ab); });
  };
  Reader.prototype.bytes = function (off, len) {
    var self = this;
    if (this.w && off >= this.wOff && off + len <= this.wOff + this.w.length) return Promise.resolve(this.w.subarray(off - this.wOff, off - this.wOff + len));
    if (off >= this.size) return Promise.resolve(new Uint8Array(0));
    return this.load(off, len).then(function () { return self.w.subarray(0, Math.min(len, self.w.length)); });
  };
  Reader.prototype.exact = function (off, len) { return this.f.slice(off, Math.min(this.size, off + len)).arrayBuffer().then(function (ab) { return new Uint8Array(ab); }); };
  D.Reader = Reader;

  function u32(b, o) { return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; }
  function u16(b, o) { return (b[o] << 8) | b[o + 1]; }
  function i32(b, o) { var v = u32(b, o); return v > 0x7fffffff ? v - 0x100000000 : v; }
  function u64(b, o) { return u32(b, o) * 4294967296 + u32(b, o + 4); }
  function str4(b, o) { return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); }
  function hex2(n) { return (n < 16 ? '0' : '') + n.toString(16); }
  function bsearchLE(arr, n, v) { // last index i < n with arr[i] <= v (or -1)
    var lo = 0, hi = n - 1, r = -1;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (arr[mid] <= v) { r = mid; lo = mid + 1; } else hi = mid - 1; }
    return r;
  }
  D.bsearchLE = bsearchLE;

  /* ======================= ISO-BMFF ======================= */
  function boxes(b, start, end) {
    var out = [], o = start;
    while (o + 8 <= end) {
      var size = u32(b, o), type = str4(b, o + 4), hdr = 8;
      if (size === 1) { size = u64(b, o + 8); hdr = 16; } else if (size === 0) size = end - o;
      if (size < hdr || o + size > end + 0) { if (size < hdr) break; size = end - o; }
      out.push({ type: type, start: o, end: o + size, data: o + hdr });
      o += size;
    }
    return out;
  }
  function child(b, box, type, skip) { var list = boxes(b, box.data + (skip || 0), box.end); for (var i = 0; i < list.length; i++) if (list[i].type === type) return list[i]; return null; }
  function children(b, box, type, skip) { return boxes(b, box.data + (skip || 0), box.end).filter(function (x) { return x.type === type; }); }

  function videoCodecFromEntry(b, se) {
    var type = se.type, info = { fourcc: type };
    info.width = u16(b, se.data + 24); info.height = u16(b, se.data + 26);
    var kids = boxes(b, se.data + 78, se.end);
    function find(t) { for (var i = 0; i < kids.length; i++) if (kids[i].type === t) return kids[i]; return null; }
    if (type === 'avc1' || type === 'avc3') {
      var avcC = find('avcC'); if (!avcC) return info;
      var d = b.slice(avcC.data, avcC.end);
      info.codec = 'avc1.' + hex2(d[1]) + hex2(d[2]) + hex2(d[3]);
      info.description = d;
    } else if (type === 'hvc1' || type === 'hev1') {
      var hv = find('hvcC'); if (!hv) return info;
      var h = b.slice(hv.data, hv.end);
      var space = (h[1] >> 6) & 3, tier = (h[1] >> 5) & 1, prof = h[1] & 31;
      var compat = u32(h, 2), rev = 0; for (var i = 0; i < 32; i++) { rev = (rev << 1) | ((compat >>> i) & 1); } rev >>>= 0;
      var cons = []; for (var j = 6; j < 12; j++) cons.push(h[j]); while (cons.length && cons[cons.length - 1] === 0) cons.pop();
      info.codec = type + '.' + (['', 'A', 'B', 'C'][space]) + prof + '.' + rev.toString(16) + '.' + (tier ? 'H' : 'L') + h[12] + (cons.length ? '.' + cons.map(function (x) { return x.toString(16); }).join('.') : '');
      info.description = h;
    } else if (type === 'vp09') {
      var vp = find('vpcC'); var v = vp ? b.slice(vp.data + 4, vp.end) : null;
      info.codec = v ? 'vp09.' + ('0' + v[0]).slice(-2) + '.' + ('0' + v[1]).slice(-2) + '.' + ('0' + (v[2] >> 4)).slice(-2) : 'vp09.00.10.08';
    } else if (type === 'av01') {
      var av = find('av1C'); var a = av ? b.slice(av.data, av.end) : null;
      if (a) {
        var profile = (a[1] >> 5) & 7, level = a[1] & 31, tierA = (a[2] >> 7) & 1, hb = (a[2] >> 6) & 1, tw = (a[2] >> 5) & 1;
        info.codec = 'av01.' + profile + '.' + ('0' + level).slice(-2) + (tierA ? 'H' : 'M') + '.' + (hb ? (tw ? '12' : '10') : '08');
        info.description = a;
      } else info.codec = 'av01.0.08M.08';
    }
    return info;
  }
  // MPEG-4 descriptor length (1-4 bytes, 7 bits each)
  function descLen(b, o) { var len = 0, n = 0; while (n < 4) { var c = b[o + n]; n++; len = (len << 7) | (c & 0x7f); if (!(c & 0x80)) break; } return { len: len, n: n }; }
  function parseEsds(b, box) {
    var o = box.data + 4, end = box.end, out = {};
    while (o + 2 <= end) {
      var tag = b[o], L = descLen(b, o + 1), body = o + 1 + L.n;
      if (tag === 0x03) { var fl = b[body + 2], p = body + 3; if (fl & 0x80) p += 2; if (fl & 0x40) p += 1 + b[p]; if (fl & 0x20) p += 2; o = p; continue; }
      if (tag === 0x04) { out.oti = b[body]; o = body + 13; continue; }
      if (tag === 0x05) { out.asc = b.slice(body, body + L.len); break; }
      o = body + L.len;
    }
    return out;
  }
  function opusHeadFrom(ch, preskip, sr, gain) {
    var h = new Uint8Array(19), dv = new DataView(h.buffer);
    'OpusHead'.split('').forEach(function (c, i) { h[i] = c.charCodeAt(0); });
    h[8] = 1; h[9] = ch; dv.setUint16(10, preskip, true); dv.setUint32(12, sr, true); dv.setInt16(16, gain, true); h[18] = 0;
    return h;
  }
  function audioCodecFromEntry(b, se) {
    var type = se.type, ver = u16(b, se.data + 8);
    var info = { fourcc: type, channels: u16(b, se.data + 16), sampleRate: u32(b, se.data + 24) / 65536 };
    var kidsOff = se.data + 28 + (ver === 1 ? 16 : ver === 2 ? 36 : 0);
    var kids = boxes(b, kidsOff, se.end);
    function find(t) { for (var i = 0; i < kids.length; i++) if (kids[i].type === t) return kids[i]; return null; }
    if (type === 'mp4a') {
      var es = find('esds');
      if (!es) { var wave = find('wave'); if (wave) { var wk = boxes(b, wave.data, wave.end); es = wk.filter(function (x) { return x.type === 'esds'; })[0]; } }
      var e = es ? parseEsds(b, es) : {};
      if (e.oti === 0x6B || e.oti === 0x69) info.codec = 'mp3';
      else if (e.asc && e.asc.length) {
        var aot = e.asc[0] >> 3; if (aot === 31) aot = 32 + (((e.asc[0] & 7) << 3) | (e.asc[1] >> 5));
        info.codec = 'mp4a.40.' + aot; info.description = e.asc;
        var sfi = ((e.asc[0] & 7) << 1) | (e.asc[1] >> 7), SR = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
        if (SR[sfi]) info.sampleRate = SR[sfi];
        var chc = (e.asc[1] >> 3) & 15; if (chc > 0 && chc < 8) info.channels = chc === 7 ? 8 : chc;
      } else info.codec = 'mp4a.40.2';
    } else if (type === 'Opus') {
      var dops = find('dOps');
      if (dops) {
        var o = dops.data, ch = b[o + 1], pre = u16(b, o + 2), isr = u32(b, o + 4), gain = u16(b, o + 8); if (gain > 32767) gain -= 65536;
        info.channels = ch; info.preskip = pre; info.description = opusHeadFrom(ch, pre, isr, gain);
      }
      info.codec = 'opus'; info.sampleRate = 48000;
    } else if (type === 'fLaC') { info.codec = 'flac'; var dfla = find('dfLa'); if (dfla) { var md = b.slice(dfla.data + 4, dfla.end), d2 = new Uint8Array(4 + md.length); d2.set([0x66, 0x4c, 0x61, 0x43]); d2.set(md, 4); info.description = d2; } }
    else if (type === '.mp3' || type === 'mp3 ') info.codec = 'mp3';
    else if (type === 'ulaw') info.codec = 'ulaw';
    else if (type === 'alaw') info.codec = 'alaw';
    return info;
  }

  // Compact sample table builder (growable typed arrays)
  function Table(cap) { cap = Math.max(16, cap | 0); this.n = 0; this.off = new Float64Array(cap); this.size = new Uint32Array(cap); this.pts = new Float64Array(cap); this.dur = new Float32Array(cap); this.key = new Uint8Array(cap); }
  Table.prototype.grow = function (need) {
    var cap = this.off.length; if (need <= cap) return;
    var nc = Math.max(need, Math.ceil(cap * 1.6)), self = this;
    ['off', 'size', 'pts', 'dur', 'key'].forEach(function (k) { var a = new self[k].constructor(nc); a.set(self[k].subarray(0, self.n)); self[k] = a; });
  };
  Table.prototype.push = function (off, size, pts, dur, key) { if (this.n >= this.off.length) this.grow(this.n + 1); var i = this.n++; this.off[i] = off; this.size[i] = size; this.pts[i] = pts; this.dur[i] = dur; this.key[i] = key ? 1 : 0; };
  Table.prototype.finish = function () {
    var n = this.n, self = this;
    ['off', 'size', 'pts', 'dur', 'key'].forEach(function (k) { if (self[k].length !== n) self[k] = self[k].slice(0, n); });
    var nk = 0; for (var i = 0; i < n; i++) if (this.key[i]) nk++;
    this.keys = new Uint32Array(nk); nk = 0; for (i = 0; i < n; i++) if (this.key[i]) this.keys[nk++] = i;
    // presentation time of each key frame (monotonic for well-formed files) for seeking
    this.keyPts = new Float64Array(this.keys.length);
    for (i = 0; i < this.keys.length; i++) this.keyPts[i] = this.pts[this.keys[i]];
    for (i = 1; i < this.keyPts.length; i++) if (this.keyPts[i] < this.keyPts[i - 1]) this.keyPts[i] = this.keyPts[i - 1];
    // fill missing durations from the next presentation time (decode order is close enough to presentation order here)
    for (i = 0; i < n; i++) if (!this.dur[i]) this.dur[i] = i + 1 < n ? Math.max(0, this.pts[i + 1] - this.pts[i]) : (i > 0 ? this.dur[i - 1] : 33333);
    return this;
  };

  // Cursor over an MP4 table: contiguous samples are read in one ranged read (≤ 2 MB)
  function TableCursor(reader, tab, i) { this.r = reader; this.t = tab; this.i = i; this.buf = null; this.bufOff = 0; this.bufEnd = 0; }
  TableCursor.prototype.next = function () {
    var t = this.t, i = this.i, self = this;
    if (i >= t.n) return Promise.resolve(null);
    this.i++;
    var off = t.off[i], size = t.size[i];
    var mk = function (data) { return { pts: t.pts[i], dur: t.dur[i], key: !!t.key[i], data: data, index: i }; };
    if (this.buf && off >= this.bufOff && off + size <= this.bufEnd) return Promise.resolve(mk(this.buf.subarray(off - this.bufOff, off - this.bufOff + size)));
    // Read a window covering this sample and the following ones: contiguous runs, and also samples interleaved
    // with the other track when the gaps are small (files muxed with per-frame interleaving would otherwise cost
    // one read per sample: ~2 million reads for a 10-hour VOD's audio).
    var end = off + size, j = i + 1, WIN = 4 * 1048576, GAP = 256 * 1024;
    while (j < t.n) {
      var o2 = t.off[j], e2 = o2 + t.size[j];
      if (o2 < end || e2 - off > WIN || o2 - end > GAP) break;
      end = e2; j++;
    }
    return this.r.exact(off, end - off).then(function (b) { self.buf = b; self.bufOff = off; self.bufEnd = off + b.length; return mk(b.subarray(0, Math.min(size, b.length))); });
  };

  function mp4Track(file, reader, kind, codecInfo, tab, ts, durSec) {
    var tr = Object.assign({ type: kind, container: 'mp4' }, codecInfo);
    tr.table = tab; tr.count = tab.n; tr.timescale = ts;
    tr.duration = durSec || (tab.n ? (tab.pts[tab.n - 1] + tab.dur[tab.n - 1]) / 1e6 : 0);
    tr.keyTimeBefore = function (tUs) { var k = bsearchLE(tab.keyPts, tab.keyPts.length, tUs); return k < 0 ? (tab.keyPts.length ? tab.keyPts[0] : 0) : tab.keyPts[k]; };
    tr.keyIndexBefore = function (tUs) { var k = bsearchLE(tab.keyPts, tab.keyPts.length, tUs); return tab.keys.length ? tab.keys[Math.max(0, k)] : 0; };
    tr.cursor = function (tUs) {
      var i;
      if (kind === 'video') i = tr.keyIndexBefore(tUs);
      else { i = Math.max(0, bsearchLE(tab.pts, tab.n, tUs)); }
      return Promise.resolve(new TableCursor(new Reader(file), tab, i));
    };
    return tr;
  }

  function parseMP4(file, progress) {
    var r = new Reader(file), top = [];
    function scan(off) {
      if (off + 8 > file.size) return Promise.resolve();
      return r.exact(off, 16).then(function (h) {
        if (h.length < 8) return;
        var size = u32(h, 0), type = str4(h, 4), hdr = 8;
        if (size === 1) { size = u64(h, 8); hdr = 16; } else if (size === 0) size = file.size - off;
        if (size < 8) return;
        top.push({ type: type, start: off, end: off + size, hdr: hdr });
        if (top.length > 200000) return;
        if (top.length % 500 === 0 && progress) progress(Math.min(0.9, off / file.size), 'Indexing fragments…');
        return scan(off + size);
      });
    }
    return r.exact(0, 12).then(function (h) {
      var t0 = str4(h, 4);
      if (['ftyp', 'moov', 'mdat', 'free', 'wide', 'skip', 'styp', 'pnot'].indexOf(t0) < 0) return null;
      return scan(0).then(function () {
        var moovB = top.filter(function (x) { return x.type === 'moov'; })[0];
        if (!moovB || moovB.end - moovB.start > 768 * 1048576) return null;
        return r.exact(moovB.start, moovB.end - moovB.start).then(function (b) {
          var moov = { type: 'moov', start: 0, end: b.length, data: moovB.hdr };
          var mvhd = child(b, moov, 'mvhd'), mts = mvhd ? (b[mvhd.data] === 1 ? u32(b, mvhd.data + 20) : u32(b, mvhd.data + 12)) : 1000;
          var movieDur = mvhd ? (b[mvhd.data] === 1 ? u64(b, mvhd.data + 24) : u32(b, mvhd.data + 16)) / mts : 0;
          var out = { container: 'mp4', video: null, audio: null, duration: movieDur };
          var trexMap = {}, mvex = child(b, moov, 'mvex');
          if (mvex) children(b, mvex, 'trex').forEach(function (tx) { trexMap[u32(b, tx.data + 4)] = { dur: u32(b, tx.data + 12), size: u32(b, tx.data + 16), flags: u32(b, tx.data + 20) }; });
          var parsed = [];
          children(b, moov, 'trak').forEach(function (trak) {
            var mdia = child(b, trak, 'mdia'); if (!mdia) return;
            var hdlr = child(b, mdia, 'hdlr'), htype = hdlr ? str4(b, hdlr.data + 8) : '';
            var kind = htype === 'vide' ? 'video' : htype === 'soun' ? 'audio' : null;
            if (!kind || out[kind]) return;
            var tkhd = child(b, trak, 'tkhd'), trackId = tkhd ? (b[tkhd.data] === 1 ? u32(b, tkhd.data + 20) : u32(b, tkhd.data + 12)) : 1;
            var mdhd = child(b, mdia, 'mdhd'), ver = b[mdhd.data];
            var ts = ver === 1 ? u32(b, mdhd.data + 20) : u32(b, mdhd.data + 12);
            var mdur = (ver === 1 ? u64(b, mdhd.data + 24) : u32(b, mdhd.data + 16)) / ts;
            var minf = child(b, mdia, 'minf'); if (!minf) return;
            var stbl = child(b, minf, 'stbl'); if (!stbl) return;
            var stsd = child(b, stbl, 'stsd'), se = stsd ? boxes(b, stsd.data + 8, stsd.end)[0] : null; if (!se) return;
            var ci = kind === 'video' ? videoCodecFromEntry(b, se) : audioCodecFromEntry(b, se);
            // edit list: initial empty edits + media start offset
            var edts = child(b, trak, 'edts'), mediaOff = 0, emptyOff = 0;
            if (edts) {
              var elst = child(b, edts, 'elst');
              if (elst) {
                var ev = b[elst.data], n = u32(b, elst.data + 4), o = elst.data + 8;
                for (var e = 0; e < n; e++) {
                  var segDur = ev === 1 ? u64(b, o) : u32(b, o), mt = ev === 1 ? (u32(b, o + 8) > 0x7fffffff ? -1 : u64(b, o + 8)) : i32(b, o + 4);
                  o += ev === 1 ? 20 : 12;
                  if (mt === -1) { emptyOff += segDur / mts; continue; }
                  mediaOff = mt; break;
                }
              }
            }
            function tbl(t) { return child(b, stbl, t); }
            var stszB = tbl('stsz'), stz2 = tbl('stz2'), stcoB = tbl('stco') || tbl('co64'), stscB = tbl('stsc'), sttsB = tbl('stts'), cttsB = tbl('ctts'), stssB = tbl('stss');
            var cnt = stszB ? u32(b, stszB.data + 8) : 0, tab = new Table(cnt || 64);
            var scale = 1e6 / ts, base = -mediaOff * scale + emptyOff * 1e6;
            if (stszB && cnt > 0 && stcoB && stscB && sttsB) {
              var fixed = u32(b, stszB.data + 4), szo = stszB.data + 12;
              var co64 = stcoB.type === 'co64', nch = u32(b, stcoB.data + 4), cof = stcoB.data + 8;
              var nsc = u32(b, stscB.data + 4), sco = stscB.data + 8;
              var si = 0, scIdx = 0;
              tab.grow(cnt);
              for (var ch = 0; ch < nch && si < cnt; ch++) {
                while (scIdx + 1 < nsc && u32(b, sco + (scIdx + 1) * 12) <= ch + 1) scIdx++;
                var per = u32(b, sco + scIdx * 12 + 4);
                var off = co64 ? u64(b, cof + ch * 8) : u32(b, cof + ch * 4);
                for (var z = 0; z < per && si < cnt; z++) {
                  var sz = fixed || u32(b, szo + si * 4);
                  tab.off[si] = off; tab.size[si] = sz; tab.key[si] = stssB ? 0 : 1; off += sz; si++;
                }
              }
              tab.n = si;
              // decode timestamps (stts) + composition offsets (ctts) -> presentation time (µs)
              var dts = 0, idx = 0, nst = u32(b, sttsB.data + 4);
              for (var t = 0; t < nst && idx < si; t++) {
                var count = u32(b, sttsB.data + 8 + t * 8), delta = u32(b, sttsB.data + 12 + t * 8), dUs = delta * scale;
                for (var y = 0; y < count && idx < si; y++) { tab.pts[idx] = dts * scale + base; tab.dur[idx] = dUs; dts += delta; idx++; }
              }
              if (cttsB) {
                var cv = b[cttsB.data], nct = u32(b, cttsB.data + 4), cix = 0;
                for (var w = 0; w < nct && cix < si; w++) { var cc = u32(b, cttsB.data + 8 + w * 8), cOff = (cv === 1 ? i32(b, cttsB.data + 12 + w * 8) : u32(b, cttsB.data + 12 + w * 8)) * scale; for (var x2 = 0; x2 < cc && cix < si; x2++) tab.pts[cix++] += cOff; }
              }
              if (stssB) { var nss = u32(b, stssB.data + 4); for (var ss = 0; ss < nss; ss++) { var kk = u32(b, stssB.data + 8 + ss * 4) - 1; if (kk >= 0 && kk < si) tab.key[kk] = 1; } }
            } else if (stz2) { /* rare compact sizes: unsupported */ }
            parsed.push({ kind: kind, trackId: trackId, ci: ci, tab: tab, ts: ts, scale: scale, base: base, mdur: mdur, trex: trexMap[trackId] });
          });
          // fragmented MP4: walk moof boxes
          var moofs = top.filter(function (x) { return x.type === 'moof'; });
          var chain = Promise.resolve();
          if (moofs.length) {
            var fdts = {};
            parsed.forEach(function (p) { var tb = p.tab; fdts[p.trackId] = tb.n ? (tb.pts[tb.n - 1] - p.base) / p.scale + tb.dur[tb.n - 1] / p.scale : 0; });
            moofs.forEach(function (mf, mi) {
              chain = chain.then(function () {
                if (progress && mi % 200 === 0) progress(0.9 + 0.1 * mi / moofs.length, 'Reading fragments…');
                return r.exact(mf.start, mf.end - mf.start).then(function (mb) {
                  var moof = { start: 0, end: mb.length, data: mf.hdr };
                  children(mb, moof, 'traf').forEach(function (traf) {
                    var tfhd = child(mb, traf, 'tfhd'); if (!tfhd) return;
                    var fl = u32(mb, tfhd.data) & 0xffffff, tid = u32(mb, tfhd.data + 4), p = tfhd.data + 8;
                    var pt = parsed.filter(function (x) { return x.trackId === tid; })[0]; if (!pt) return;
                    var trex = pt.trex, base = mf.start, defDur = trex ? trex.dur : 0, defSize = trex ? trex.size : 0, defFlags = trex ? trex.flags : 0;
                    if (fl & 1) { base = u64(mb, p); p += 8; } if (fl & 2) p += 4; if (fl & 8) { defDur = u32(mb, p); p += 4; } if (fl & 0x10) { defSize = u32(mb, p); p += 4; } if (fl & 0x20) { defFlags = u32(mb, p); p += 4; }
                    if (!(fl & 1) && (fl & 0x20000)) base = mf.start;
                    var tfdt = child(mb, traf, 'tfdt'); if (tfdt) fdts[tid] = mb[tfdt.data] === 1 ? u64(mb, tfdt.data + 4) : u32(mb, tfdt.data + 4);
                    children(mb, traf, 'trun').forEach(function (trun) {
                      var tf = u32(mb, trun.data) & 0xffffff, tv = mb[trun.data], n2 = u32(mb, trun.data + 4), q2 = trun.data + 8, doff = 0, firstFlags = null;
                      if (tf & 1) { doff = i32(mb, q2); q2 += 4; } if (tf & 4) { firstFlags = u32(mb, q2); q2 += 4; }
                      var off2 = base + doff;
                      for (var i2 = 0; i2 < n2; i2++) {
                        var sd = defDur, sz = defSize, sf = defFlags, sco2 = 0;
                        if (tf & 0x100) { sd = u32(mb, q2); q2 += 4; } if (tf & 0x200) { sz = u32(mb, q2); q2 += 4; } if (tf & 0x400) { sf = u32(mb, q2); q2 += 4; } if (tf & 0x800) { sco2 = tv === 1 ? i32(mb, q2) : u32(mb, q2); q2 += 4; }
                        if (i2 === 0 && firstFlags != null) sf = firstFlags;
                        pt.tab.push(off2, sz, (fdts[tid] + sco2) * pt.scale + pt.base, sd * pt.scale, pt.kind === 'audio' ? true : !((sf >> 16) & 1));
                        off2 += sz; fdts[tid] += sd;
                      }
                    });
                  });
                });
              });
            });
          }
          return chain.then(function () {
            parsed.forEach(function (p) {
              p.tab.finish();
              if (!p.tab.n) return;
              out[p.kind] = mp4Track(file, r, p.kind, p.ci, p.tab, p.ts, p.mdur);
            });
            out.duration = Math.max(out.duration || 0, out.video ? out.video.duration : 0, out.audio ? out.audio.duration : 0);
            return out;
          });
        });
      });
    });
  }

  /* ======================= Matroska / WebM ======================= */
  var MKV = { EBML: 0x1A45DFA3, Segment: 0x18538067, SeekHead: 0x114D9B74, Seek: 0x4DBB, SeekID: 0x53AB, SeekPosition: 0x53AC,
    Info: 0x1549A966, TimecodeScale: 0x2AD7B1, Duration: 0x4489, Tracks: 0x1654AE6B, TrackEntry: 0xAE, TrackNumber: 0xD7, TrackType: 0x83,
    CodecID: 0x86, CodecPrivate: 0x63A2, DefaultDuration: 0x23E383, CodecDelay: 0x56AA, SeekPreRoll: 0x56BB, Video: 0xE0, PixelWidth: 0xB0, PixelHeight: 0xBA,
    Audio: 0xE1, SamplingFrequency: 0xB5, Channels: 0x9F, ContentEncodings: 0x6D80,
    Cluster: 0x1F43B675, Timecode: 0xE7, SimpleBlock: 0xA3, BlockGroup: 0xA0, Block: 0xA1, ReferenceBlock: 0xFB, BlockDuration: 0x9B,
    Cues: 0x1C53BB6B, CuePoint: 0xBB, CueTime: 0xB3, CueTrackPositions: 0xB7, CueTrack: 0xF7, CueClusterPosition: 0xF1 };
  var TOP_LEVEL = {}; [MKV.Cluster, MKV.Cues, MKV.Tracks, MKV.Info, MKV.SeekHead, 0x1254C367, 0x1941A469, 0x1043A770].forEach(function (id) { TOP_LEVEL[id] = 1; });

  function vintAt(b, o, keep) {
    var first = b[o]; if (first === undefined) return null;
    var len = 1, mask = 0x80;
    while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
    if (len > 8 || o + len > b.length) return null;
    var v = keep ? first : first & (mask - 1), ones = (first & (mask - 1)) === mask - 1;
    for (var i = 1; i < len; i++) { var x = b[o + i]; v = v * 256 + x; if (x !== 255) ones = false; }
    return { v: v, len: len, unknown: !keep && ones };
  }
  // element header at b[o]: {id, size (-1 unknown), hdr}
  function elHead(b, o) {
    var idv = vintAt(b, o, true); if (!idv) return null;
    var sv = vintAt(b, o + idv.len, false); if (!sv) return null;
    return { id: idv.v, size: sv.unknown ? -1 : sv.v, hdr: idv.len + sv.len };
  }
  function ebmlKids(b, start, end) {
    var out = [], o = start;
    while (o < end) {
      var e = elHead(b, o); if (!e) break;
      var dEnd = e.size < 0 ? end : Math.min(end, o + e.hdr + e.size);
      out.push({ id: e.id, data: o + e.hdr, end: dEnd, start: o });
      o = dEnd;
    }
    return out;
  }
  function uintOf(b, s, e) { var v = 0; for (var i = s; i < e; i++) v = v * 256 + b[i]; return v; }
  function floatOf(b, s, e) { var dv = new DataView(b.buffer, b.byteOffset + s, e - s); return e - s === 4 ? dv.getFloat32(0) : dv.getFloat64(0); }
  function strOf(b, s, e) { return String.fromCharCode.apply(null, b.subarray(s, e)).replace(/\0+$/, ''); }

  function parseTracksEl(b, s, e) {
    var tracks = [];
    ebmlKids(b, s, e).forEach(function (te) {
      if (te.id !== MKV.TrackEntry) return;
      var t = {};
      ebmlKids(b, te.data, te.end).forEach(function (k) {
        switch (k.id) {
          case MKV.TrackNumber: t.num = uintOf(b, k.data, k.end); break;
          case MKV.TrackType: t.type = uintOf(b, k.data, k.end); break;
          case MKV.CodecID: t.codec = strOf(b, k.data, k.end); break;
          case MKV.CodecPrivate: t.priv = b.slice(k.data, k.end); break;
          case MKV.DefaultDuration: t.defDur = uintOf(b, k.data, k.end); break;
          case MKV.CodecDelay: t.codecDelay = uintOf(b, k.data, k.end); break;
          case MKV.ContentEncodings: t.encoded = true; break;
          case MKV.Video: ebmlKids(b, k.data, k.end).forEach(function (v) { if (v.id === MKV.PixelWidth) t.w = uintOf(b, v.data, v.end); if (v.id === MKV.PixelHeight) t.h = uintOf(b, v.data, v.end); }); break;
          case MKV.Audio: ebmlKids(b, k.data, k.end).forEach(function (a) { if (a.id === MKV.SamplingFrequency) t.sr = floatOf(b, a.data, a.end); if (a.id === MKV.Channels) t.ch = uintOf(b, a.data, a.end); }); break;
        }
      });
      tracks.push(t);
    });
    return tracks;
  }
  function mkvVideoCodec(vt) {
    var info = { width: vt.w, height: vt.h, codecId: vt.codec };
    if (vt.codec === 'V_VP8') info.codec = 'vp8';
    else if (vt.codec === 'V_VP9') info.codec = 'vp09.00.10.08';
    else if (vt.codec === 'V_AV1') { var a = vt.priv; info.codec = a && a.length > 3 ? 'av01.' + ((a[1] >> 5) & 7) + '.' + ('0' + (a[1] & 31)).slice(-2) + (((a[2] >> 7) & 1) ? 'H' : 'M') + '.' + (((a[2] >> 6) & 1) ? '10' : '08') : 'av01.0.08M.08'; if (a) info.description = a; }
    else if (vt.codec === 'V_MPEG4/ISO/AVC' && vt.priv) { info.codec = 'avc1.' + hex2(vt.priv[1]) + hex2(vt.priv[2]) + hex2(vt.priv[3]); info.description = vt.priv; }
    else if (vt.codec === 'V_MPEGH/ISO/HEVC' && vt.priv) { info.codec = 'hvc1.1.6.L93.B0'; info.description = vt.priv; }
    if (vt.defDur) info.frameDurUs = vt.defDur / 1000;
    return info;
  }
  function mkvAudioCodec(at) {
    var info = { sampleRate: at.sr || 48000, channels: at.ch || 2, codecId: at.codec };
    if (at.codec === 'A_OPUS') { info.codec = 'opus'; info.sampleRate = 48000; if (at.priv && at.priv.length >= 19) { info.description = at.priv; info.preskip = at.priv[10] | (at.priv[11] << 8); } }
    else if (at.codec === 'A_AAC' || /^A_AAC/.test(at.codec || '')) { info.codec = 'mp4a.40.2'; if (at.priv && at.priv.length >= 2) { var aot = at.priv[0] >> 3; info.codec = 'mp4a.40.' + aot; info.description = at.priv; } }
    else if (at.codec === 'A_VORBIS') { info.codec = 'vorbis'; if (at.priv) info.description = at.priv; }
    else if (at.codec === 'A_FLAC') { info.codec = 'flac'; if (at.priv) info.description = at.priv; }
    else if (at.codec === 'A_MPEG/L3') info.codec = 'mp3';
    if (at.defDur) info.frameDurUs = at.defDur / 1000;
    info.codecDelayUs = at.codecDelay ? at.codecDelay / 1000 : 0;
    return info;
  }

  // Parse the blocks of one cluster held in `b` (cluster element data from dStart to dEnd), base offset `abs`
  function parseClusterBlocks(b, dStart, dEnd, abs, scaleUs, tracksByNum) {
    var tc = 0, blocks = [], o = dStart;
    function addBlock(s, e, isSimple, group) {
      var tn = vintAt(b, s, false); if (!tn) return;
      var rel = (b[s + tn.len] << 8) | b[s + tn.len + 1]; if (rel > 32767) rel -= 65536;
      var flags = b[s + tn.len + 2], lace = (flags >> 1) & 3, p = s + tn.len + 3;
      var key = isSimple ? !!(flags & 0x80) : !(group && group.ref);
      var ts = (tc + rel) * scaleUs, tr = tracksByNum[tn.v];
      var fd = tr && tr.frameDurUs ? tr.frameDurUs : 0;
      if (!lace) { blocks.push({ track: tn.v, pts: ts, off: abs + p, size: e - p, key: key, dur: group && group.dur ? group.dur * scaleUs : 0 }); return; }
      var nf = b[p] + 1; p++;
      var sizes = [];
      if (lace === 1) { // Xiph
        for (var i = 0; i < nf - 1; i++) { var sz = 0, c; do { c = b[p++]; sz += c; } while (c === 255); sizes.push(sz); }
      } else if (lace === 3) { // EBML
        var first = vintAt(b, p, false); p += first.len; sizes.push(first.v);
        for (var j = 1; j < nf - 1; j++) { var dv = vintAt(b, p, false); p += dv.len; var bias = Math.pow(2, 7 * dv.len - 1) - 1; sizes.push(sizes[j - 1] + dv.v - bias); }
      }
      var total = e - p;
      if (lace === 2) { var each = Math.floor(total / nf); for (var k = 0; k < nf - 1; k++) sizes.push(each); }
      var used = 0; sizes.forEach(function (x) { used += x; }); sizes.push(total - used);
      if (!fd && tr && tr.kind === 'audio') fd = /mp4a/.test(tr.codec || '') ? 1024 / (tr.sampleRate || 48000) * 1e6 : (tr.codec === 'opus' ? 20000 : 0);
      for (var q = 0; q < sizes.length; q++) { blocks.push({ track: tn.v, pts: ts + q * fd, off: abs + p, size: sizes[q], key: true, dur: fd }); p += sizes[q]; }
    }
    while (o < dEnd) {
      var e = elHead(b, o); if (!e || o + e.hdr > dEnd) { o = dEnd; break; } // header runs past the buffer: incomplete
      if (TOP_LEVEL[e.id]) break; // next cluster / top-level element: this (unknown-size) cluster ends here
      if (e.size < 0) { o += e.hdr; continue; }
      var ds = o + e.hdr, de = ds + e.size;
      if (de > dEnd) { if (e.id === MKV.SimpleBlock || e.id === MKV.BlockGroup) { o = dEnd; break; } de = dEnd; }
      if (e.id === MKV.Timecode) tc = uintOf(b, ds, de);
      else if (e.id === MKV.SimpleBlock) addBlock(ds, de, true, null);
      else if (e.id === MKV.BlockGroup) {
        var g = { ref: false, dur: 0 }, blk = null;
        ebmlKids(b, ds, de).forEach(function (k) { if (k.id === MKV.Block) blk = k; else if (k.id === MKV.ReferenceBlock) g.ref = true; else if (k.id === MKV.BlockDuration) g.dur = uintOf(b, k.data, k.end); });
        if (blk) addBlock(blk.data, blk.end, false, g);
      }
      o = de;
    }
    return { time: tc * scaleUs, blocks: blocks, endRel: o };
  }

  function parseMKV(file, progress) {
    var size = file.size, r = new Reader(file);
    r.WIN = 1048576;
    var st = { scaleNs: 1000000, tracks: [], cues: null, segData: 0, segEnd: size, firstCluster: -1, durationTicks: 0 };
    function readEl(off, maxLen) { return r.exact(off, maxLen); }
    return r.exact(0, 64).then(function (h0) {
      if (u32(h0, 0) !== MKV.EBML) return null;
      var eh = elHead(h0, 0), o = eh.hdr + eh.size;
      return r.exact(o, 16).then(function (hs) {
        var se = elHead(hs, 0); if (!se || se.id !== MKV.Segment) return null;
        st.segData = o + se.hdr; st.segEnd = se.size < 0 ? size : Math.min(size, st.segData + se.size);
        var seekCues = -1;
        // walk top-level elements until the first Cluster
        function walk(pos, guard) {
          if (pos >= st.segEnd || guard > 64) return Promise.resolve();
          return r.exact(pos, 16).then(function (hb) {
            var e = elHead(hb, 0); if (!e) return;
            if (e.id === MKV.Cluster) { st.firstCluster = pos; return; }
            if (e.size < 0) return; // unknown-size non-cluster: give up walking
            var dataPos = pos + e.hdr, next = dataPos + e.size;
            var want = (e.id === MKV.SeekHead || e.id === MKV.Info || e.id === MKV.Tracks || e.id === MKV.Cues) && e.size < 64 * 1048576;
            var p = want ? readEl(dataPos, e.size) : Promise.resolve(null);
            return p.then(function (b) {
              if (b) {
                if (e.id === MKV.Info) ebmlKids(b, 0, b.length).forEach(function (k) { if (k.id === MKV.TimecodeScale) st.scaleNs = uintOf(b, k.data, k.end); if (k.id === MKV.Duration) st.durationTicks = floatOf(b, k.data, k.end); });
                else if (e.id === MKV.Tracks) st.tracks = parseTracksEl(b, 0, b.length);
                else if (e.id === MKV.Cues) st.cuesBytes = b;
                else if (e.id === MKV.SeekHead) ebmlKids(b, 0, b.length).forEach(function (sk) {
                  if (sk.id !== MKV.Seek) return; var sid = 0, spos = -1;
                  ebmlKids(b, sk.data, sk.end).forEach(function (k) { if (k.id === MKV.SeekID) sid = uintOf(b, k.data, k.end); if (k.id === MKV.SeekPosition) spos = uintOf(b, k.data, k.end); });
                  if (sid === MKV.Cues && spos >= 0) seekCues = st.segData + spos;
                });
              }
              return walk(next, guard + 1);
            });
          });
        }
        return walk(st.segData, 0).then(function () {
          if (st.cuesBytes || seekCues < 0 || seekCues >= size) return;
          return r.exact(seekCues, 16).then(function (hb) {
            var e = elHead(hb, 0); if (!e || e.id !== MKV.Cues || e.size < 0 || e.size > 256 * 1048576) return;
            return readEl(seekCues + e.hdr, e.size).then(function (b) { st.cuesBytes = b; });
          });
        }).then(function () { return buildMkv(file, st, progress); });
      });
    });
  }

  function buildMkv(file, st, progress) {
    var scaleUs = st.scaleNs / 1000, out = { container: 'webm', video: null, audio: null, duration: st.durationTicks ? st.durationTicks * scaleUs / 1e6 : 0 };
    var vt = st.tracks.filter(function (t) { return t.type === 1; })[0], at = st.tracks.filter(function (t) { return t.type === 2; })[0];
    if (st.firstCluster < 0) return out;
    var byNum = {};
    // cluster index: positions (absolute) + start times (µs); from Cues when available, otherwise built lazily
    var idx = { pos: [], time: [], complete: false, scanPos: st.firstCluster, scanning: null };
    if (st.cuesBytes) {
      var b = st.cuesBytes, vnum = vt ? vt.num : (at ? at.num : 1), seen = {};
      var pts = [];
      ebmlKids(b, 0, b.length).forEach(function (cp) {
        if (cp.id !== MKV.CuePoint) return;
        var t = 0, poss = [];
        ebmlKids(b, cp.data, cp.end).forEach(function (k) {
          if (k.id === MKV.CueTime) t = uintOf(b, k.data, k.end);
          else if (k.id === MKV.CueTrackPositions) { var tr = 0, cpos = -1; ebmlKids(b, k.data, k.end).forEach(function (q) { if (q.id === MKV.CueTrack) tr = uintOf(b, q.data, q.end); if (q.id === MKV.CueClusterPosition) cpos = uintOf(b, q.data, q.end); }); if (cpos >= 0) poss.push({ tr: tr, pos: cpos }); }
        });
        poss.forEach(function (p) { if (p.tr === vnum || !vt) { var ap = st.segData + p.pos; if (!seen[ap]) { seen[ap] = 1; pts.push([t * scaleUs, ap]); } } });
      });
      pts.sort(function (x, y) { return x[1] - y[1]; });
      pts.forEach(function (p) { idx.time.push(p[0]); idx.pos.push(p[1]); });
      if (idx.pos.length) idx.fromCues = true;
    }
    var reader = new Reader(file); reader.WIN = 65536;
    var cache = [], CACHE_MAX = 8; // parsed clusters (with bytes)
    // read a whole cluster at absolute position `pos` -> {pos, time, blocks, next, bytes, bytesOff}
    function readCluster(pos) {
      for (var i = 0; i < cache.length; i++) if (cache[i].pos === pos) { var hit = cache.splice(i, 1)[0]; cache.push(hit); return Promise.resolve(hit); }
      return reader.exact(pos, 16).then(function (hb) {
        var e = elHead(hb, 0);
        if (!e || e.id !== MKV.Cluster) return null;
        var dataPos = pos + e.hdr;
        var known = e.size >= 0;
        var len = known ? e.size : 4 * 1048576;
        function load(l) {
          return reader.exact(dataPos, l).then(function (bb) {
            var res = parseClusterBlocks(bb, 0, bb.length, dataPos, scaleUs, byNum);
            if (!known && res.endRel >= bb.length && dataPos + bb.length < st.segEnd && l < 64 * 1048576) return load(l * 2);
            var end = known ? dataPos + e.size : dataPos + res.endRel;
            var cl = { pos: pos, time: res.time, blocks: res.blocks, next: end < st.segEnd ? end : -1, bytes: bb, bytesOff: dataPos };
            cache.push(cl); while (cache.length > CACHE_MAX) cache.shift();
            return cl;
          });
        }
        return load(len);
      });
    }
    // position of the next cluster after a non-cluster element (Cues, Tags...) -> skip forward
    function nextClusterFrom(pos, guard) {
      if (pos < 0 || pos >= st.segEnd || (guard || 0) > 32) return Promise.resolve(-1);
      return reader.exact(pos, 16).then(function (hb) {
        var e = elHead(hb, 0); if (!e) return -1;
        if (e.id === MKV.Cluster) return pos;
        if (e.size < 0) return -1;
        return nextClusterFrom(pos + e.hdr + e.size, (guard || 0) + 1);
      });
    }
    // Lazy index: cluster-skip scan from idx.scanPos until time >= untilUs (or end). Reads only element headers +
    // the cluster Timecode for known-size clusters; unknown-size clusters are parsed to find where they end.
    function extendIndex(untilUs) {
      if (idx.complete || idx.fromCues) return Promise.resolve();
      if (idx.scanning) return idx.scanning.then(function () { return extendIndex(untilUs); });
      var startT = performance.now();
      idx.scanning = new Promise(function (resolve) {
        var n = 0;
        function step() {
          var pos = idx.scanPos;
          if (pos < 0 || pos >= st.segEnd) { idx.complete = true; resolve(); return; }
          var lastT = idx.time.length ? idx.time[idx.time.length - 1] : -1;
          if (untilUs != null && lastT > untilUs) { resolve(); return; }
          reader.exact(pos, 64).then(function (hb) {
            var e = elHead(hb, 0);
            if (!e) { idx.complete = true; resolve(); return; }
            if (e.id !== MKV.Cluster) {
              if (e.size < 0) { idx.complete = true; resolve(); return; }
              idx.scanPos = pos + e.hdr + e.size; return next();
            }
            if (e.size >= 0) {
              // timecode is (nearly always) the first child
              var c = elHead(hb, e.hdr), tcv = 0;
              if (c && c.id === MKV.Timecode) tcv = uintOf(hb, e.hdr + c.hdr, e.hdr + c.hdr + c.size);
              idx.pos.push(pos); idx.time.push(tcv * scaleUs);
              idx.scanPos = pos + e.hdr + e.size; return next();
            }
            return readCluster(pos).then(function (cl) {
              if (!cl) { idx.complete = true; resolve(); return; }
              idx.pos.push(pos); idx.time.push(cl.time);
              idx.scanPos = cl.next; return next();
            });
          }).catch(function () { idx.complete = true; resolve(); });
          function next() {
            n++;
            if (n % 400 === 0) { if (progress && st.segEnd) progress(Math.min(1, idx.scanPos / st.segEnd), 'Indexing clusters…'); setTimeout(step, 0); }
            else step();
          }
        }
        step();
      }).then(function () { idx.scanning = null; idx.scanMs = (idx.scanMs || 0) + performance.now() - startT; });
      return idx.scanning;
    }
    // Find a cluster that starts at or after byte `from`: scan a window for the Cluster ID and validate it by its
    // header + leading Timecode element. Resolves {pos, time} or null.
    function clusterAtOrAfter(from, limit) {
      var WIN = 1048576;
      function scan(off) {
        if (off >= Math.min(st.segEnd, limit || Infinity)) return Promise.resolve(null);
        return reader.exact(off, WIN + 64).then(function (b) {
          for (var i = 0; i + 16 < b.length; i++) {
            if (b[i] !== 0x1F || b[i + 1] !== 0x43 || b[i + 2] !== 0xB6 || b[i + 3] !== 0x75) continue;
            var e = elHead(b, i); if (!e || e.id !== MKV.Cluster) continue;
            var c = elHead(b, i + e.hdr); if (!c || c.id !== MKV.Timecode || c.size < 1 || c.size > 8) continue;
            return { pos: off + i, time: uintOf(b, i + e.hdr + c.hdr, i + e.hdr + c.hdr + c.size) * scaleUs };
          }
          if (b.length < WIN) return null;
          return scan(off + WIN);
        });
      }
      return scan(Math.max(from, st.firstCluster));
    }
    // No Cues: bisect on byte offsets (cluster timecodes are monotonic) — ~20 small reads instead of a full scan
    var known = []; // sparse [pos, time] points discovered by bisection
    function bisect(tUs) {
      var lo = st.firstCluster, hi = st.segEnd, best = { pos: st.firstCluster, time: 0 }, n = 0;
      known.forEach(function (k) { if (k[1] <= tUs && k[0] > best.pos) best = { pos: k[0], time: k[1] }; if (k[1] > tUs && k[0] < hi) hi = k[0]; });
      lo = best.pos;
      function step() {
        if (hi - lo < 2 * 1048576 || n++ > 40) return Promise.resolve(best.pos);
        var mid = Math.floor((lo + hi) / 2);
        return clusterAtOrAfter(mid, hi).then(function (c) {
          if (!c) { hi = mid; return step(); }
          known.push([c.pos, c.time]);
          if (c.time <= tUs) { best = c; lo = c.pos + 1; } else hi = mid;
          return step();
        });
      }
      // then walk forward cluster by cluster (cheap: the gap is < 2 MB) to the last cluster starting <= t
      return step().then(function (p0) {
        function walk(p) {
          return readCluster(p).then(function (cl) {
            if (!cl || cl.next < 0) return p;
            return nextClusterFrom(cl.next).then(function (nx) {
              if (nx < 0) return p;
              return reader.exact(nx, 64).then(function (hb) {
                var e = elHead(hb, 0), c = e && elHead(hb, e.hdr);
                var tn = c && c.id === MKV.Timecode ? uintOf(hb, e.hdr + c.hdr, e.hdr + c.hdr + c.size) * scaleUs : Infinity;
                if (tn > tUs) return p;
                known.push([nx, tn]);
                return walk(nx);
              });
            });
          });
        }
        return walk(p0);
      });
    }
    function clusterBefore(tUs) {
      var i = bsearchLE(idx.time, idx.time.length, tUs);
      return i < 0 ? (idx.pos.length ? idx.pos[0] : st.firstCluster) : idx.pos[i];
    }
    function clusterIndexOf(pos) { var i = bsearchLE(idx.pos, idx.pos.length, pos); return i >= 0 && idx.pos[i] === pos ? i : -1; }

    function MkvCursor(trackNum, startPos, fromUs, wantKey) { this.tn = trackNum; this.pos = startPos; this.cl = null; this.bi = 0; this.from = fromUs; this.wantKey = wantKey; this.started = false; }
    MkvCursor.prototype.next = function () {
      var self = this;
      if (this.cl) {
        while (this.bi < this.cl.blocks.length) {
          var bl = this.cl.blocks[this.bi++];
          if (bl.track !== this.tn) continue;
          if (!this.started) {
            if (this.wantKey && !bl.key) continue;
            if (!this.wantKey && bl.pts + 1 < this.from - 200000) continue; // audio: start a little before `from`
            this.started = true;
          }
          var rel = bl.off - this.cl.bytesOff;
          return Promise.resolve({ pts: bl.pts, dur: bl.dur, key: bl.key, data: this.cl.bytes.subarray(rel, rel + bl.size) });
        }
        var nx = this.cl.next; this.cl = null; this.pos = nx;
        if (nx < 0) return Promise.resolve(null);
        return nextClusterFrom(nx).then(function (p) { self.pos = p; if (p < 0) return null; return self.next(); });
      }
      if (this.pos < 0) return Promise.resolve(null);
      return readCluster(this.pos).then(function (cl) { if (!cl) return null; self.cl = cl; self.bi = 0; return self.next(); });
    };

    function mkTrack(t, kind) {
      var ci = kind === 'video' ? mkvVideoCodec(t) : mkvAudioCodec(t);
      var tr = Object.assign({ type: kind, container: 'webm', num: t.num, encoded: !!t.encoded }, ci);
      byNum[t.num] = { kind: kind, codec: ci.codec, sampleRate: ci.sampleRate, frameDurUs: ci.frameDurUs };
      tr.index = idx;
      tr.duration = out.duration;
      tr.keyTimeBefore = function (tUs) { var i = bsearchLE(idx.time, idx.time.length, tUs); return i < 0 ? 0 : idx.time[i]; };
      // Seek: video starts at the cluster (from Cues: a key-frame cluster) at/before t; if that cluster's first block
      // of this track is not a key frame, step back one indexed cluster at a time.
      tr.cursor = function (tUs) {
        var target = kind === 'audio' ? tUs - 300000 : tUs;
        // with Cues (or a finished index) look the cluster up; otherwise bisect the file
        var posP = idx.fromCues || idx.complete || target <= 0 ? Promise.resolve(clusterBefore(target)) : bisect(target);
        return posP.then(function (pos) {
          if (kind === 'audio') return new MkvCursor(t.num, pos, tUs, false);
          var tries = 0;
          function check(p) {
            return readCluster(p).then(function (cl) {
              if (!cl) return new MkvCursor(t.num, p, tUs, true);
              var first = null; for (var i = 0; i < cl.blocks.length; i++) if (cl.blocks[i].track === t.num) { first = cl.blocks[i]; break; }
              var hasKey = cl.blocks.some(function (bl) { return bl.track === t.num && bl.key && bl.pts <= tUs + 1000; });
              var ci2 = clusterIndexOf(p);
              if ((first && first.key) || hasKey || tries++ > 30) return new MkvCursor(t.num, p, tUs, true);
              if (ci2 > 0) return check(idx.pos[ci2 - 1]);
              if (idx.fromCues || p <= st.firstCluster) return new MkvCursor(t.num, p, tUs, true);
              return bisect(Math.max(0, cl.time - 1)).then(function (pp) { return pp >= p ? new MkvCursor(t.num, p, tUs, true) : check(pp); });
            });
          }
          return check(pos);
        });
      };
      return tr;
    }
    if (vt) out.video = mkTrack(vt, 'video');
    if (at) out.audio = mkTrack(at, 'audio');
    out.index = idx;
    out.extendIndex = extendIndex;
    out.readCluster = readCluster;
    // Duration fallback when the header has none (live/recorded files): last cluster's last block
    var durP = Promise.resolve();
    if (!out.duration) {
      var lastP = idx.fromCues && idx.pos.length ? Promise.resolve(idx.pos[idx.pos.length - 1])
        : (function tail(back) { // find the last cluster by scanning backwards from the end of the file
          var from = Math.max(st.firstCluster, st.segEnd - back);
          return clusterAtOrAfter(from).then(function (c) {
            if (!c) return back < st.segEnd && back < 256 * 1048576 ? tail(back * 4) : st.firstCluster;
            function last(cpos) { return clusterAtOrAfter(cpos + 16).then(function (n2) { return n2 ? last(n2.pos) : cpos; }); }
            return last(c.pos);
          });
        })(4 * 1048576);
      durP = lastP.then(function (lp) {
        return readCluster(lp).then(function (cl) {
          if (!cl) return; var mx = cl.time; cl.blocks.forEach(function (bl) { mx = Math.max(mx, bl.pts + (bl.dur || 0)); });
          out.duration = mx / 1e6 + 0.02;
          if (out.video) out.video.duration = out.duration; if (out.audio) out.audio.duration = out.duration;
        });
      });
    }
    return durP.then(function () { return out; });
  }

  /* ======================= Public API ======================= */
  var probeCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  // Full container probe; never rejects (resolves null for unknown/unsupported containers)
  D.probe = function (file, progress) {
    if (!file) return Promise.resolve(null);
    if (probeCache && probeCache.has(file)) return probeCache.get(file);
    var name = (file.name || '').toLowerCase();
    var isMkv = /\.(webm|mkv|mka|weba)$/.test(name) || /webm|matroska/.test(file.type || '');
    var p = (isMkv ? parseMKV(file, progress) : parseMP4(file, progress).then(function (r) { return r || parseMKV(file, progress); }))
      .then(function (info) {
        if (!info) return null;
        info.file = file;
        return checkSupport(info).then(function () { return info; });
      }).catch(function (e) { console.warn('[Cutline] demux failed', e); return null; });
    if (probeCache) probeCache.set(file, p);
    return p;
  };
  function checkSupport(info) {
    var jobs = [];
    var v = info.video, a = info.audio;
    if (v) {
      v.config = null;
      if (v.codec && window.VideoDecoder && !v.encoded) {
        var cfg = { codec: v.codec, codedWidth: v.width, codedHeight: v.height };
        if (v.description) cfg.description = v.description;
        jobs.push(VideoDecoder.isConfigSupported(cfg).then(function (r) { if (r.supported) v.config = cfg; }).catch(function () { }));
      }
    }
    if (a) {
      a.config = null;
      if (a.codec && window.AudioDecoder && !a.encoded) {
        var acfg = { codec: a.codec, sampleRate: a.sampleRate || 48000, numberOfChannels: a.channels || 2 };
        if (a.description) acfg.description = a.description;
        jobs.push(AudioDecoder.isConfigSupported(acfg).then(function (r) { if (r.supported) a.config = acfg; }).catch(function () { }));
      }
    }
    return Promise.all(jobs);
  }

  // Older video-only contract (export/frame decoding): null unless the video track can be decoded with WebCodecs.
  // Adds lazily materialised `samples` / `byPts` object arrays for small MP4 files (diagnostics & tests).
  D.open = function (file) {
    if (!file || !window.VideoDecoder || !window.EncodedVideoChunk) return Promise.resolve(null);
    return D.probe(file).then(function (pi) {
      if (!pi || !pi.video || !pi.video.config) return null;
      var v = pi.video;
      var info = { codec: v.codec, description: v.description, width: v.width, height: v.height, container: pi.container, config: v.config, track: v, probe: pi, duration: pi.duration };
      var mat = null;
      function materialize() {
        if (mat) return mat;
        var list = [];
        if (v.table) { var t = v.table; for (var i = 0; i < t.n; i++) list.push({ offset: t.off[i], size: t.size[i], key: !!t.key[i], pts: Math.round(t.pts[i]), durUs: Math.round(t.dur[i]), di: i }); }
        mat = { samples: list, byPts: list.slice().sort(function (x, y) { return x.pts - y.pts; }) };
        return mat;
      }
      if (v.table) {
        Object.defineProperty(info, 'samples', { get: function () { return materialize().samples; }, enumerable: false });
        Object.defineProperty(info, 'byPts', { get: function () { return materialize().byPts; }, enumerable: false });
        return info;
      }
      // Matroska: small files get a full block list (scan) so diagnostics work like before; large files stay lazy.
      if (file.size > 64 * 1048576) return info;
      return D.mkvBlockList(pi, v).then(function (list) {
        var byPts = list.slice().sort(function (x, y) { return x.pts - y.pts; });
        Object.defineProperty(info, 'samples', { value: list, enumerable: false });
        Object.defineProperty(info, 'byPts', { value: byPts, enumerable: false });
        return info;
      });
    });
  };
  // Every block of one Matroska track (small files only)
  D.mkvBlockList = function (pi, tr) {
    var list = [];
    return tr.cursor(-1e12).then(function (cur) {
      function step() { return cur.next().then(function (s) { if (!s) return list; list.push({ pts: Math.round(s.pts), key: s.key, size: s.data.length, durUs: Math.round(s.dur || 0), di: list.length }); return step(); }); }
      return step();
    });
  };

  // Estimated frame rate of a video track from its timestamps (all samples for MP4, first clusters for Matroska).
  // Returns {fps, vfr} where vfr flags irregular frame spacing (dropped / variable frames).
  D.frameRate = function (pi) {
    var v = pi && pi.video; if (!v) return Promise.resolve(null);
    function stats(pts) {
      if (pts.length < 8) return null;
      var a = Array.prototype.slice.call(pts).sort(function (x, y) { return x - y; });
      var span = (a[a.length - 1] - a[0]) / 1e6; if (span <= 0) return null;
      var ds = []; for (var i = 1; i < a.length; i++) ds.push(a[i] - a[i - 1]);
      ds.sort(function (x, y) { return x - y; });
      var med = ds[ds.length >> 1], irregular = 0;
      for (i = 0; i < ds.length; i++) if (Math.abs(ds[i] - med) > med * 0.25) irregular++;
      // nominal rate: average of the single-frame steps (millisecond-rounded containers alternate 16/17 ms at 60 fps)
      var single = ds.filter(function (d) { return d < ds[0] * 1.45; }), nom = single.reduce(function (x, y) { return x + y; }, 0) / Math.max(1, single.length);
      return { fps: (a.length - 1) / span, median: 1e6 / (nom || med), vfr: irregular / ds.length > 0.01 };
    }
    if (v.table) {
      var t = v.table, n = Math.min(t.n, 4000), arr = new Float64Array(n);
      // sample evenly spaced runs across the file so a long VOD is characterised as a whole
      var runs = Math.min(20, Math.max(1, Math.floor(t.n / 200))), per = Math.floor(n / runs), k = 0;
      var whole = t.n > 1 ? (t.n - 1) / ((t.pts[t.n - 1] - t.pts[0]) / 1e6) : 0;
      for (var r = 0; r < runs; r++) { var s0 = Math.floor(r * (t.n - per) / Math.max(1, runs - 1)); for (var j = 0; j < per && k < n; j++) arr[k++] = t.pts[s0 + j]; }
      var st = stats(arr.subarray(0, k));
      if (st && whole) st.fps = whole;
      return Promise.resolve(st);
    }
    // Matroska: measure the first ~600 frames (DefaultDuration is only nominal — VFR files keep it too)
    var nominal = v.frameDurUs ? { fps: 1e6 / v.frameDurUs, median: 1e6 / v.frameDurUs, vfr: false } : null;
    return v.cursor(0).then(function (cur) {
      var pts = [];
      function step() { return cur.next().then(function (s) { if (!s || pts.length >= 600) return stats(pts) || nominal; pts.push(s.pts); return step(); }); }
      return step();
    }).catch(function () { return nominal; });
  };
})();
