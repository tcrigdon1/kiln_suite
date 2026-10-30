/* Cutline — frame source provider: manages hidden <video> elements per active clip, image & generated textures.
   One provider per consumer ('preview' for the program monitor, 'export' for rendering). */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, P = C.P, KF = C.KF;

  // Video elements are pooled per source file (not per clip): a sequence cut from many pieces of one long VOD reuses
  // the same couple of elements — the active piece plays on one while the next piece is pre-seeked on another — so a
  // cut never waits for a fresh element to open (and re-parse the index of) a multi-GB file.
  function Provider(mode) { this.mode = mode; this.vids = {}; this.assign = {}; this.tag = 0; this.vidN = 0; this.genSig = {}; this.capSig = null; this.capCanvas = null; }

  Provider.prototype.videoFor = function (clip, media) {
    var base = C.Media.base ? C.Media.base(media) : media;
    var rt = C.MRT[base.id];
    // the Program monitor plays the proxy when one exists (and proxies are on); export / stills use the original
    var url = rt && (this.mode === 'preview' && C.Proxy ? C.Proxy.playUrl(rt) : rt.url);
    var key = this.assign[clip.id], e = key ? this.vids[key] : null;
    if (e && (e.mediaId !== base.id || e.url !== url)) { this.drop(key); e = null; }
    if (e && e.claim === this.tag && e.clipId !== clip.id) e = null; // taken by another clip in this frame
    if (!e) {
      if (!rt || !url) return null;
      for (var k in this.vids) {
        var x = this.vids[k];
        if (x.mediaId === base.id && x.url === url && x.claim !== this.tag) { e = x; key = k; break; }
      }
      if (!e) {
        var el = document.createElement('video');
        el.muted = true; el.preload = 'auto'; el.playsInline = true; el.disablePictureInPicture = true;
        el.src = url;
        key = base.id + '#' + (this.vidN++);
        e = this.vids[key] = { el: el, mediaId: base.id, url: url, used: performance.now(), key: key };
        if (this.mode === 'preview') {
          var kick = function () { C.bus.emit('rerender'); };
          el.addEventListener('seeked', kick); el.addEventListener('loadeddata', kick);
        }
      }
      if (e.clipId && e.clipId !== clip.id && this.assign[e.clipId] === key) delete this.assign[e.clipId];
      this.assign[clip.id] = key;
      e.target = null;
    }
    e.claim = this.tag; e.clipId = clip.id;
    e.used = performance.now();
    return e;
  };
  Provider.prototype.elementOf = function (clipId) { var k = this.assign[clipId]; return k ? this.vids[k] : null; };
  Provider.prototype.drop = function (key) {
    var e = this.vids[key]; if (!e) return;
    try { e.el.pause(); e.el.removeAttribute('src'); e.el.load(); } catch (x) { }
    delete this.vids[key];
    for (var c in this.assign) if (this.assign[c] === key) delete this.assign[c];
  };
  Provider.prototype.dropAll = function () {
    for (var k in this.vids) this.drop(k); this.genSig = {}; this.assign = {};
    if (this.decs) { for (var d in this.decs) { var st = this.decs[d]; if (st.dec) st.dec.close(); else st.p.then(function (x) { if (x) x.close(); }); } this.decs = {}; }
    this.releaseOwned();
    this.frames = {};
  };
  // VideoFrame clones made for frame blending are ours to close
  Provider.prototype.releaseOwned = function () {
    (this.owned || []).forEach(function (f) { try { f.close(); } catch (e) { } });
    this.owned = []; this.frames2 = {};
  };
  // second (blend) source frame for a layer: { el, ver, w, h, mix } or null
  Provider.prototype.blendSource = function (L) {
    var b = this.frames2 && this.frames2[L.clip.id]; if (!b) return null;
    try { return { key: this.mode + ':' + L.clip.id + ':b', el: b.f, ver: b.f.timestamp + '|' + (this.frameSerial = (this.frameSerial || 0) + 1), w: b.f.displayWidth, h: b.f.displayHeight, mix: b.mix }; } catch (err) { return null; }
  };

  Provider.prototype.source = function (L, ctx) {
    var m = L.media; if (!m) return null;
    var key = this.mode + ':' + L.clip.id;
    if (m.type === 'video') {
      var fr = this.frames && this.frames[L.clip.id];
      if (fr) { try { return { key: key, el: fr, ver: fr.timestamp + '|' + (this.frameSerial = (this.frameSerial || 0) + 1), w: fr.displayWidth, h: fr.displayHeight }; } catch (err) { } }
      var e = this.videoFor(L.clip, m); if (!e) return null;
      if (e.el.readyState < 2) return { key: key, el: null, ver: '__keep', w: m.w, h: m.h };
      return { key: key, el: e.el, ver: null, w: e.el.videoWidth || m.w, h: e.el.videoHeight || m.h };
    }
    if (m.type === 'image') {
      var rt = C.MRT[m.id]; if (!rt || !rt.image) return null;
      return { key: 'img:' + m.id, el: rt.image, ver: rt.url, w: m.w, h: m.h };
    }
    if (m.type === 'gen') {
      var clip = L.clip, gen = clip.gen || m.gen, seq = ctx.seq;
      var w = ctx.outW, h = ctx.outH;
      var lsec = L.lf / seq.fps, dsec = clip.dur / seq.fps;
      var animated = C.Titles.isAnimated(gen, clip);
      var sig = JSON.stringify(gen) + '|' + w + 'x' + h + (animated ? '|' + L.lf : '') + (gen.kind === 'tcburn' || gen.kind === 'spectrum' ? '|' + L.frame + '|' + seq.fps : '');
      if (gen.kind === 'title' && clip.kf) sig += '|' + JSON.stringify(clip.kf);
      var getter = null;
      if (clip.kf) getter = function (layer, k) { var p = 'tt.' + layer.id + '.' + k; return KF.has(clip, p) ? KF.value(clip, p, L.lf) : layer[k]; };
      var cv;
      if (this.genSig[key] === sig && this.genCanvas && this.genCanvas[key]) cv = this.genCanvas[key];
      else {
        cv = C.Titles.renderGen(gen, clip, lsec, w, h, dsec, key, getter, { frame: L.frame, fps: seq.fps, seq: seq });
        this.genCanvas = this.genCanvas || {}; this.genCanvas[key] = cv; this.genSig[key] = sig;
        var gk = Object.keys(this.genCanvas); // bounded: titles come and go over a long session
        if (gk.length > 40) for (var gi = 0; gi < gk.length - 32; gi++) { delete this.genCanvas[gk[gi]]; delete this.genSig[gk[gi]]; if (C.Titles.releaseKey) C.Titles.releaseKey(gk[gi]); }
      }
      if (!cv) return null;
      return { key: key, el: cv, ver: sig, w: seq.w, h: seq.h };
    }
    return null;
  };

  Provider.prototype.captionCanvas = function (scene, w, h) {
    var cap = scene.caption; if (!cap) return null;
    var sig = cap.id + '|' + cap.text + '|' + w + 'x' + h + '|' + JSON.stringify(scene.seq.capStyle);
    if (sig !== this.capSig) {
      var c = this.capCanvas || (this.capCanvas = document.createElement('canvas'));
      c.width = w; c.height = h;
      var g = c.getContext('2d'); g.clearRect(0, 0, w, h);
      C.Titles.drawCaption(g, scene.seq, cap, w, h);
      this.capSig = sig;
    }
    return { el: this.capCanvas, ver: sig };
  };

  // Keep video elements in step with the scene (preview).
  Provider.prototype.sync = function (scene, playing, rate, lookahead) {
    var active = {}, self = this, fps = scene.fps;
    this.tag++;
    C.Scene.clipLayers(scene).forEach(function (L) {
      var m = L.media;
      if (!m || m.type !== 'video' || L.offline) return;
      var e = self.videoFor(L.clip, m); if (!e) return;
      active[e.key] = true;
      var el = e.el, want = L.srcSec + 0.001, clip = L.clip;
      if (e.preroll) { clearTimeout(e.preroll); e.preroll = null; }
      var r = C.T.speedAt(clip, L.lf) * rate;
      var canPlay = playing && rate > 0 && !clip.reverse && clip.freeze == null && r >= 0.0625 && r <= 16 && L.localRaw >= 0 && L.localRaw < clip.dur;
      if (canPlay) {
        var sd = el.currentTime - want, drift = Math.abs(sd);
        if (el.paused) {
          // starting from a standstill: aim a little ahead so the element's start-up latency lands it on time
          if (drift > 0.04 || sd < -0.02) el.currentTime = want + 0.06 * r;
          el.playbackRate = r;
          var pr = el.play(); if (pr && pr.catch) pr.catch(function () { });
        } else if (drift > Math.max(0.35, 6 / fps) * Math.max(1, r)) {
          // far off: hard resync
          el.currentTime = want + 0.03 * r; el.playbackRate = r;
        } else if (drift > 0.6 / fps) {
          // small drift: nudge the rate so the element converges without a visible seek
          var k = U.clamp(sd * 2, -0.25, 0.25);
          var nr = r * (1 - k);
          if (Math.abs(el.playbackRate - nr) > 0.005) el.playbackRate = nr;
        } else if (Math.abs(el.playbackRate - r) > 1e-3) el.playbackRate = r;
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - want) > 0.45 / fps && (!el.seeking || Math.abs((e.target || -1) - want) > 0.45 / fps)) { e.target = want; el.currentTime = want; }
      }
    });
    if (lookahead) {
      C.Scene.clipLayers(lookahead).forEach(function (L) {
        var m = L.media;
        if (!m || m.type !== 'video' || L.offline) return;
        var cur = self.elementOf(L.clip.id); if (cur && active[cur.key] && cur.clipId === L.clip.id) return;
        var e = self.videoFor(L.clip, m); if (!e) return;
        active[e.key] = true;
        var startAt = P.sourceSec(scene.seq, L.clip, L.clip.start), untilCut = (L.clip.start - scene.frame) / fps / Math.max(0.01, Math.abs(rate));
        var r2 = C.T.speedAt(L.clip, 0) * rate, canRoll = playing && rate > 0 && !L.clip.reverse && L.clip.freeze == null && r2 >= 0.0625 && r2 <= 16;
        if (canRoll && untilCut > 0 && untilCut < 0.5 && e.el.readyState >= 2) {
          // pre-roll: start the incoming clip's element a moment before the cut so it is already running at the cut.
          // When the clip starts near the file's beginning there is nothing to roll through: start it later instead.
          if (e.el.paused && !e.preroll) {
            var from = startAt - untilCut * r2 + 0.06 * r2, delay = from < 0 ? -from / r2 : 0, el2 = e.el;
            var go = function () { e.preroll = null; if (!el2.paused || e.clipId !== L.clip.id) return; el2.currentTime = Math.max(0, from); el2.playbackRate = r2; var pr2 = el2.play(); if (pr2 && pr2.catch) pr2.catch(function () { }); };
            if (delay > 0.005) e.preroll = setTimeout(go, delay * 1000); else go();
          }
          return;
        }
        if (e.preroll) { clearTimeout(e.preroll); e.preroll = null; }
        if (!e.el.paused) e.el.pause();
        if (Math.abs(e.el.currentTime - startAt) > 0.1 && !e.el.seeking) e.el.currentTime = Math.max(0, startAt);
      });
    }
    var now = performance.now();
    for (var k in this.vids) {
      if (active[k]) continue;
      var e2 = this.vids[k];
      if (!e2.el.paused) e2.el.pause();
      if (now - e2.used > 6000) this.drop(k);
    }
  };

  // True while a video needed by the scene has no decoded picture yet (a freshly created element)
  Provider.prototype.notReady = function (scene) {
    var self = this;
    return C.Scene.clipLayers(scene).some(function (L) {
      var m = L.media; if (!m || m.type !== 'video' || L.offline) return false;
      var e = self.elementOf(L.clip.id);
      return !!(e && e.el.readyState < 2 && !e.el.error);
    });
  };

  // Export: make sure every video in the scene shows exactly the right frame.
  // Uses WebCodecs decoding (frame-exact, fast) when the container/codec is supported, else seeks <video> elements.
  // Decoders are keyed by source file + slot (n-th use of that source in the current frame), so consecutive pieces
  // of one long source share a decoder that simply seeks to the next piece's nearest key frame.
  Provider.prototype.decodedFrame = function (L, slot) {
    var self = this, m = L.media, id = L.clip.id, base = C.Media.base ? C.Media.base(m) : m, key = base.id + '#' + slot;
    this.decs = this.decs || {}; this.noDec = this.noDec || {};
    var st = this.decs[key];
    if (!st) {
      st = this.decs[key] = { p: C.FrameDecoder.infoFor(base).then(function (info) { var rt = C.MRT[base.id]; return info && rt ? new C.FrameDecoder(rt.file, info) : null; }) };
    }
    st.used = this.prepN;
    return st.p.then(function (dec) {
      if (!dec) { self.noDec[base.id] = true; return false; }
      st.dec = dec;
      // frame blending: when the mapped source time falls between two source frames, decode both and mix them
      var fps = base.fps || m.fps, clip = L.clip, mixT = 0, tA = L.srcSec, tB = null;
      if (clip.tm && clip.tm.blend && fps > 0 && clip.freeze == null) {
        var fi = L.srcSec * fps, a = Math.floor(fi + 1e-4), fr = fi - a;
        if (fr > 0.03 && fr < 0.97 && (a + 1.5) / fps < (base.duration || Infinity)) { tA = (a + 0.5) / fps; tB = (a + 1.5) / fps; mixT = fr; }
      }
      return dec.getFrame(tA).then(function (f) {
        if (tB == null) { self.frames[id] = f; return true; }
        var fa; try { fa = f.clone(); } catch (err) { self.frames[id] = f; return true; }
        return dec.getFrame(tB).then(function (fb) {
          self.frames[id] = fa; (self.owned = self.owned || []).push(fa);
          if (fb && fb.timestamp !== fa.timestamp) { self.frames2 = self.frames2 || {}; self.frames2[id] = { f: fb, mix: mixT }; }
          return true;
        }, function () { self.frames[id] = fa; (self.owned = self.owned || []).push(fa); return true; });
      });
    }).catch(function (e) {
      console.warn('[Cutline] WebCodecs decode failed for ' + m.name + ', falling back to seeking:', e && e.message);
      self.noDec[base.id] = true;
      if (st.dec) { st.dec.close(); }
      delete self.decs[key];
      return false;
    });
  };
  Provider.prototype.prepare = function (scene) {
    var self = this, jobs = [], slots = {};
    this.releaseOwned();
    this.frames = {}; this.tag++; this.prepN = (this.prepN || 0) + 1;
    C.Scene.clipLayers(scene).forEach(function (L) {
      var m = L.media;
      if (m && m.type === 'gen' && C.Spectrum) { var gg = L.clip.gen || m.gen; if (gg && gg.kind === 'spectrum') jobs.push(C.Spectrum.prepare(scene.seq, L.frame, gg)); }
      if (!m || m.type !== 'video' || L.offline) return;
      var bid = (C.Media.base ? C.Media.base(m) : m).id, slot = slots[bid] = (slots[bid] == null ? 0 : slots[bid] + 1);
      if (self.useDecoders && !(self.noDec && self.noDec[bid])) {
        jobs.push(self.decodedFrame(L, slot).then(function (ok) { if (!ok) return self.prepareElement(L, scene); }));
        return;
      }
      jobs.push(self.prepareElement(L, scene));
    });
    // close decoders that haven't been needed for a while (a source that no longer appears)
    if (this.decs && this.prepN % 60 === 0) for (var k in this.decs) { var st = this.decs[k]; if (st.dec && this.prepN - (st.used || 0) > 120) { st.dec.close(); delete this.decs[k]; } }
    return Promise.all(jobs);
  };
  Provider.prototype.prepareElement = function (L, scene) {
    var self = this, jobs = [];
    (function () {
      var m = L.media;
      var e = self.videoFor(L.clip, m); if (!e) return;
      var el = e.el, want = L.srcSec + 0.001;
      jobs.push(new Promise(function (res) {
        var done = false, to;
        function fin() { if (done) return; done = true; clearTimeout(to); el.removeEventListener('seeked', onSeek); el.removeEventListener('loadeddata', onLoad); res(); }
        function onSeek() { if (el.readyState >= 2) fin(); else el.addEventListener('loadeddata', onLoad); }
        function onLoad() { el.removeEventListener('loadeddata', onLoad); if (Math.abs(el.currentTime - want) > 0.25 / scene.fps) { el.removeEventListener('seeked', onSeek); el.addEventListener('seeked', onSeek); el.currentTime = want; } else fin(); }
        to = setTimeout(fin, 8000);
        if (el.readyState < 1) { el.addEventListener('loadeddata', onLoad); return; }
        if (Math.abs(el.currentTime - want) <= 0.2 / scene.fps && el.readyState >= 2 && !el.seeking) { fin(); return; }
        el.addEventListener('seeked', onSeek);
        el.currentTime = want;
      }));
    })();
    return Promise.all(jobs);
  };
  Provider.prototype.gc = function (maxAge) {
    var now = performance.now();
    for (var k in this.vids) if (now - this.vids[k].used > (maxAge || 6000)) this.drop(k);
  };

  C.SourceProvider = Provider;
})();
