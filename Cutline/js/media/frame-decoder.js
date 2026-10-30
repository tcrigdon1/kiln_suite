/* Cutline — frame-exact video frame access via WebCodecs VideoDecoder (export, thumbnails, scrub previews).
   getFrame(t) returns the VideoFrame displayed at source time t (seconds): the last frame whose timestamp is <= t.
   Sequential access decodes forward without re-seeking; a jump past the next key frame (or backwards) re-seeks to the
   key frame at/before t, so only the ranges actually used are ever read from a long file. Because the frame is chosen
   by display time, variable-frame-rate sources (dropped frames) are conformed to the output frame rate naturally. */
(function () {
  'use strict';
  var C = window.Cutline;
  var MAX_QUEUE = 12;

  function FrameDecoder(file, info) {
    this.file = file; this.info = info; this.track = info.track || (info.probe && info.probe.video);
    this.frames = []; this.err = null; this.cur = null; this.cursor = null; this.fedPts = -Infinity; this.eos = false;
    this.busy = Promise.resolve();
    this.configure();
  }
  FrameDecoder.prototype.configure = function () {
    var self = this;
    if (this.dec) { try { this.dec.close(); } catch (e) { } }
    this.frames.forEach(function (f) { try { f.close(); } catch (e) { } }); this.frames = [];
    this.err = null;
    this.dec = new VideoDecoder({
      output: function (f) {
        // keep the queue sorted by timestamp (decoders emit in presentation order, but be defensive)
        var a = self.frames, i = a.length;
        while (i > 0 && a[i - 1].timestamp > f.timestamp) i--;
        a.splice(i, 0, f);
      },
      error: function (e) {
        self.err = e; console.warn('[Cutline] decoder error', e && e.message);
        // a GPU decoder that fails mid-stream (driver limits, odd streams) is swapped for the software one
        var fb = C.GPU && C.GPU.decFallback(self.info.config);
        if (fb) { self.info.config = fb; self.needReconfigure = true; console.warn('[Cutline] falling back to software decode'); }
      }
    });
    this.dec.configure(this.info.config);
    this.cursor = null; this.fedPts = -Infinity; this.eos = false; this.needKey = true;
  };
  // Serialise requests (export asks for one frame at a time, but thumbnails/scrubs may overlap)
  FrameDecoder.prototype.getFrame = function (tSec) {
    var self = this;
    var p = this.busy.then(function () { return self._get(tSec); });
    this.busy = p.catch(function () { });
    return p;
  };
  FrameDecoder.prototype._get = function (tSec) {
    var self = this, tr = this.track;
    var tUs = Math.round(tSec * 1e6) + 1000; // 1 ms tolerance for timestamp rounding in containers
    if (this.err || this.dec.state === 'closed') this.configure();
    // current frame still valid?
    if (this.cur && this.cur.timestamp <= tUs && this.frames.length && this.frames[0].timestamp > tUs) return Promise.resolve(this.cur);
    if (this.cur && this.cur.timestamp <= tUs && this.eos && !this.frames.length) return Promise.resolve(this.cur);
    // re-seek when going backwards, or when the target lies beyond the next key frame we'd otherwise decode through
    var keyT = tr.keyTimeBefore(tUs);
    var behind = this.cur && tUs < this.cur.timestamp;
    var lastQueued = this.frames.length ? this.frames[this.frames.length - 1].timestamp : (this.cur ? this.cur.timestamp : -Infinity);
    var reseek = !this.cursor || behind || this.eos && (!this.cur || tUs > lastQueued) || (keyT > this.fedPts + 1000 && keyT > lastQueued);
    var start = performance.now();
    var prep = Promise.resolve();
    if (reseek) {
      // a fresh decoder per seek (reset()+configure() can leave Chromium's software decoders stalled)
      if (this.fedPts > -Infinity || this.eos || this.err || this.needReconfigure) { this.configure(); this.needReconfigure = false; }
      this.frames.forEach(function (f) { try { f.close(); } catch (e) { } }); this.frames = [];
      if (this.cur) { try { this.cur.close(); } catch (e) { } this.cur = null; }
      this.eos = false; this.fedPts = -Infinity; this.needKey = true;
      prep = tr.cursor(tUs).then(function (c) { self.cursor = c; });
    }
    return prep.then(function () {
      return new Promise(function (resolve, reject) {
        var flushing = false;
        function pick() {
          // drop frames older than the newest frame at/before t
          var a = self.frames, cand = null, k = -1;
          for (var i = 0; i < a.length; i++) { if (a[i].timestamp <= tUs) k = i; else break; }
          if (k >= 0) {
            cand = a[k];
            for (var j = 0; j < k; j++) { try { a[j].close(); } catch (e) { } }
            self.frames = a = a.slice(k + 1);
            if (self.cur && self.cur !== cand) { try { self.cur.close(); } catch (e) { } }
            self.cur = cand;
          }
          if (self.cur && self.cur.timestamp <= tUs && (a.length || self.eos)) return self.cur;
          // target precedes the first frame of the stream: show the first frame
          // (decoders emit in presentation order, so the first output after a key-frame seek is the earliest frame)
          if (!self.cur && a.length && (self.eos || a[0].timestamp > tUs)) { self.cur = a.shift(); return self.cur; }
          return null;
        }
        function loop() {
          if (self.err) { var e = self.err; self.needReconfigure = true; reject(e); return; }
          var f = pick();
          if (f) { resolve(f); return; }
          if (performance.now() - start > 15000) { reject(new Error('decode timeout at ' + tSec.toFixed(3) + 's (queued ' + self.frames.length + ', fed to ' + (self.fedPts / 1e6).toFixed(3) + 's, decodeQueue ' + self.dec.decodeQueueSize + ', state ' + self.dec.state + ')')); return; }
          if (flushing) { setTimeout(loop, 2); return; }
          if (self.frames.length >= MAX_QUEUE || self.dec.decodeQueueSize >= 8) { setTimeout(loop, 1); return; }
          self.cursor.next().then(function (s) {
            if (!s) {
              flushing = true;
              self.dec.flush().then(function () { self.eos = true; flushing = false; loop(); }, function (e) { flushing = false; self.err = self.err || e; loop(); });
              return;
            }
            if (self.needKey && !s.key) { loop(); return; }
            self.needKey = false;
            try { self.dec.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: Math.round(s.pts), duration: s.dur ? Math.round(s.dur) : undefined, data: s.data })); }
            catch (e) { self.err = e; }
            self.fedPts = Math.max(self.fedPts, s.pts);
            // decoders may hold the last frames until more input arrives; nudge with a flush when far past t
            loop();
          }, reject);
        }
        loop();
      });
    });
  };
  FrameDecoder.prototype.close = function () {
    try { this.dec.close(); } catch (e) { }
    this.frames.forEach(function (f) { try { f.close(); } catch (e) { } }); this.frames = [];
    if (this.cur) { try { this.cur.close(); } catch (e) { } this.cur = null; }
  };
  C.FrameDecoder = FrameDecoder;

  // Color calibration: decoders and <video> may disagree on untagged streams (BT.601 vs BT.709).
  // Compare a decoded key frame against the element's rendering and pick the matching interpretation,
  // so exported frames look exactly like the preview.
  function grab(src) {
    var c = document.createElement('canvas'); c.width = 48; c.height = 27;
    var g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(src, 0, 0, 48, 27);
    return g.getImageData(0, 0, 48, 27).data;
  }
  function diff(a, b) { var s = 0; for (var i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return s / (a.length / 4); }
  // Decode the first key frame at/after the start of the track (or at/before tUs) -> {f: VideoFrame, pts}
  function decodeKey(info, cfg, tUs) {
    var tr = info.track;
    return tr.cursor(tUs || 0).then(function (cur) {
      function first() { return cur.next().then(function (s) { if (!s) throw new Error('no key frame'); return s.key ? s : first(); }); }
      return first();
    }).then(function (s) {
      return new Promise(function (res, rej) {
        var got = null;
        var dec = new VideoDecoder({ output: function (f) { if (!got) got = f; else f.close(); }, error: rej });
        dec.configure(cfg);
        dec.decode(new EncodedVideoChunk({ type: 'key', timestamp: Math.round(s.pts), data: s.data }));
        dec.flush().then(function () { dec.close(); if (got) res({ f: got, pts: s.pts }); else rej(new Error('no frame')); }, rej);
      });
    });
  }
  C.FrameDecoder.calibrate = function (m, info) {
    var rt = C.MRT[m.id];
    if (!rt || !rt.url) return Promise.resolve(info);
    return decodeKey(info, info.config, 0).then(function (r0) {
      var cs = r0.f.colorSpace || {};
      var v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = rt.url;
      return C.Media.waitEvent(v, 'loadeddata', 'error', 10000).then(function () { return C.Media.seekTo(v, r0.pts / 1e6 + 0.001); }).then(function () {
        var ref = grab(v), d0 = diff(ref, grab(r0.f));
        r0.f.close();
        var alt = cs.matrix === 'smpte170m' || cs.matrix === 'bt470bg' ? { matrix: 'bt709', primaries: 'bt709', transfer: 'bt709', fullRange: !!cs.fullRange } : { matrix: 'smpte170m', primaries: 'smpte170m', transfer: 'smpte170m', fullRange: !!cs.fullRange };
        var cfg2 = Object.assign({}, info.config, { colorSpace: alt });
        return decodeKey(info, cfg2, 0).then(function (r1) {
          var d1 = diff(ref, grab(r1.f)); r1.f.close();
          v.removeAttribute('src'); v.load();
          if (d1 + 0.5 < d0) info.config = cfg2;
          info.calibrated = { d0: d0, d1: d1 };
          return info;
        });
      });
    }).catch(function (e) { console.warn('[Cutline] color calibration skipped', e && e.message); return info; });
  };

  // Cache of demux (+ calibration) results per source file (subclips share their parent's file)
  var infoCache = {};
  C.FrameDecoder.infoFor = function (m) {
    var base = C.Media.base ? C.Media.base(m) : m;
    var rt = C.MRT[base.id]; if (!rt || !rt.file) return Promise.resolve(null);
    if (infoCache[base.id] && infoCache[base.id].file === rt.file) return infoCache[base.id].p;
    var p = C.Demux.open(rt.file).then(function (info) { return info ? C.FrameDecoder.calibrate(base, info) : null; })
      .then(function (info) { if (!info || !C.GPU) return info; return C.GPU.decConfig(info.config).then(function (cfg) { info.config = cfg; return info; }); });
    infoCache[base.id] = { file: rt.file, p: p };
    return p;
  };

  /* ---------- Key-frame thumbnails (fast: one key frame read + decode, no seeking through the file) ---------- */
  // Resolves a canvas of height H showing the key frame at/before t (seconds), or null when WebCodecs can't decode it.
  C.FrameDecoder.keyThumb = function (m, t, H) {
    var base = C.Media.base ? C.Media.base(m) : m;
    var rt = C.MRT[base.id]; if (!rt || !rt.file || !window.VideoDecoder) return Promise.resolve(null);
    return C.Demux.probe(rt.file).then(function (pi) {
      var v = pi && pi.video; if (!v || !v.config) return null;
      return v.cursor(Math.round(t * 1e6)).then(function (cur) {
        function first() { return cur.next().then(function (s) { if (!s) return null; return s.key ? s : first(); }); }
        return first();
      }).then(function (s) {
        if (!s) return null;
        return new Promise(function (res) {
          var got = null;
          var dec = new VideoDecoder({ output: function (f) { if (!got) got = f; else f.close(); }, error: function () { res(null); } });
          dec.configure(v.config);
          dec.decode(new EncodedVideoChunk({ type: 'key', timestamp: Math.round(s.pts), data: s.data }));
          dec.flush().then(function () {
            try { dec.close(); } catch (e) { }
            if (!got) { res(null); return; }
            var w = Math.max(1, Math.round(H * (got.displayWidth / Math.max(1, got.displayHeight))));
            var c = document.createElement('canvas'); c.width = w; c.height = H;
            try { c.getContext('2d').drawImage(got, 0, 0, w, H); } catch (e) { }
            var ts = got.timestamp / 1e6; got.close();
            c.t = ts;
            res(c);
          }, function () { try { dec.close(); } catch (e) { } if (got) got.close(); res(null); });
        });
      });
    }).catch(function () { return null; });
  };
})();
