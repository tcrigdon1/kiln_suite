/* Cutline — playback engine: transport, master clock (AudioContext time), JKL shuttle, program rendering. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, P = C.P;
  var E = C.Engine = { playing: false, rate: 1, frame: 0, loop: false, resScale: 1, scopesWanted: false };

  E.init = function (canvas) {
    E.canvas = canvas;
    E.comp = C.createCompositor(canvas, U.lsGet('force2d', false));
    E.provider = new C.SourceProvider('preview');
    E.requestRender = U.raf(function () { if (!E.playing) E.renderNow(); });
    C.bus.on('changed', function (info) {
      E.requestRender();
      if (E.playing && E.rate > 0 && !(info && info.live)) restartAudioSoon();
    });
    C.bus.on('rerender', function () { E.requestRender(); });
    C.bus.on('audio:variant', function () { if (E.playing && E.rate > 0) restartAudioSoon(); });
    C.bus.on('tracks', function () { var s = P.seq(); if (s) C.Mixer.updateTracks(s); });
    setInterval(function () { if (E.comp) E.comp.gcTextures(); }, 5000);
  };
  var restartAudioSoon = U.debounce(function () { if (E.playing && E.rate > 0) { var f = E.currentFrame(); E.startClock(f); } }, 150);

  E.fps = function () { var s = P.seq(); return s ? s.fps : 30; };
  E.endFrame = function () { var s = P.seq(); return s ? Math.max(1, P.seqDuration(s)) : 1; };
  E.outputSize = function () {
    var s = P.seq(); if (!s) return [2, 2];
    var sc = C.prefs.playbackRes === 'auto' ? autoScale(s) : (+C.prefs.playbackRes || 1);
    // frames arriving late during playback: drop the processing resolution (Auto only) until the transport stops
    if (E.playing && C.prefs.playbackRes === 'auto' && E.dynDrop) sc = Math.min(sc, E.dynDrop);
    if (E.exportScale) sc = E.exportScale;
    return [Math.max(2, Math.round(s.w * sc)), Math.max(2, Math.round(s.h * sc))];
  };
  // adaptive quality: called with the wall time one frame took to build+draw
  E.dynDrop = 0; E.lateN = 0; E.okN = 0;
  function noteFrameTime(ms, fps) {
    var budget = 1000 / Math.max(1, fps);
    if (ms > budget * 1.15) { E.lateN++; E.okN = 0; } else { E.okN++; if (E.okN > 90) E.lateN = 0; }
    if (E.lateN >= 12) {
      E.lateN = 0;
      var cur = E.dynDrop || 1, next = cur > 0.5 ? 0.5 : 0.25;
      if (next !== cur) { E.dynDrop = next; C.bus.emit('state'); if (!E.droppedToast) { E.droppedToast = true; C.toast('Playback quality lowered to keep up (Auto resolution)', 2500); } }
    }
  }
  E.resetDyn = function () { if (E.dynDrop) { E.dynDrop = 0; C.bus.emit('state'); } E.lateN = 0; E.okN = 0; };
  function autoScale(s) {
    var box = E.canvas && E.canvas.parentElement;
    if (!box) return 1;
    var dpr = window.devicePixelRatio || 1, w = box.clientWidth * dpr, h = box.clientHeight * dpr;
    var k = Math.min(w / s.w, h / s.h);
    if (k >= 0.75) return 1; if (k >= 0.4) return 0.5; return 0.25;
  }

  E.setFrame = function (f, silent) {
    var s = P.seq(); if (!s) return;
    f = Math.max(0, Math.round(f));
    E.frame = f;
    C.state.playheads = C.state.playheads || {};
    C.state.playheads[s.id] = f;
    if (!silent) C.bus.emit('playhead', f);
  };
  E.seek = function (f, opts) {
    var s = P.seq(); if (!s) return;
    var was = E.playing;
    f = Math.max(0, Math.round(f));
    E.setFrame(f);
    if (was) E.startClock(f);
    else {
      E.requestRender();
      if (opts && opts.scrub) C.Mixer.scrub(s, f);
    }
  };
  E.step = function (n) { if (E.playing) E.pause(); E.seek(E.frame + n, { scrub: true }); };

  E.startClock = function (f) {
    var s = P.seq();
    E.t0 = f;
    if (E.rate > 0) {
      try { E.when = C.Mixer.start(s, f / s.fps, E.rate); E.audioClock = C.Mixer.ctx && C.Mixer.ctx.state === 'running'; }
      catch (e) { console.warn('[Cutline] audio start failed', e); E.audioClock = false; }
    } else { C.Mixer.stop(); E.audioClock = false; }
    E.p0 = performance.now();
  };
  E.currentFrame = function () {
    var s = P.seq(); if (!s) return 0;
    if (!E.playing) return E.frame;
    var el;
    if (E.audioClock && C.Mixer.ctx) el = Math.max(0, C.Mixer.ctx.currentTime - E.when);
    else el = (performance.now() - E.p0) / 1000;
    return E.t0 + el * s.fps * E.rate;
  };
  E.range = function () {
    var s = P.seq(), end = E.endFrame();
    if (E.loop && s.inF != null && s.outF != null && s.outF > s.inF) return [s.inF, s.outF];
    return [0, end];
  };
  E.play = function (rate) {
    var s = P.seq(); if (!s) return;
    rate = rate || 1;
    var r = E.range();
    if (rate > 0 && E.frame >= r[1] - 1) E.setFrame(r[0]);
    if (rate < 0 && E.frame <= 0) return;
    if (E.loop && rate > 0 && (E.frame < r[0] || E.frame >= r[1])) E.setFrame(r[0]);
    E.rate = rate;
    E.playing = true;
    E.startClock(E.frame);
    C.bus.emit('transport', { playing: true, rate: rate });
    tick();
  };
  E.pause = function () {
    if (!E.playing) return;
    E.playing = false;
    C.Mixer.stop();
    E.setFrame(Math.round(E.currentFrame()));
    E.rate = 1;
    C.bus.emit('transport', { playing: false, rate: 1 });
    E.resetDyn();
    E.renderNow();
  };
  E.toggle = function () { if (E.playing) E.pause(); else E.play(1); };
  E.shuttle = function (key) {
    if (key === 'k') { E.pause(); return; }
    var dir = key === 'l' ? 1 : -1;
    if (E.playing && Math.sign(E.rate) === dir) {
      var nr = Math.min(8, Math.abs(E.rate) * 2) * dir;
      E.setFrame(Math.round(E.currentFrame()), true);
      E.rate = nr; E.startClock(E.frame);
      C.bus.emit('transport', { playing: true, rate: nr });
    } else {
      if (E.playing) E.pause();
      E.play(dir);
    }
  };

  function tick() {
    if (!E.playing) return;
    var f = E.currentFrame(), r = E.range();
    if (E.rate > 0 && f >= r[1]) {
      if (E.loop) { E.setFrame(r[0]); E.startClock(r[0]); f = r[0]; }
      else { E.setFrame(r[1] - 1); E.pause(); return; }
    }
    if (E.rate < 0 && f <= 0) { E.setFrame(0); E.pause(); return; }
    E.setFrame(Math.floor(f));
    var t0 = performance.now();
    E.renderNow(true);
    noteFrameTime(performance.now() - t0, E.fps());
    requestAnimationFrame(tick);
  }

  var lastScopes = 0;
  E.renderNow = function (playing) {
    var s = P.seq(); if (!s || !E.comp) return;
    var f = E.frame;
    try {
      // pre-rendered frame (Sequence › Render In to Out): show it as is when the sequence has not changed since
      var rc = C.RenderCache;
      if (rc && !(C.Multicam && C.Multicam.gridOn) && E.comp.presentBitmap) {
        var bm = rc.frame(s, f);
        if (bm && E.comp.presentBitmap(bm.img, bm.w, bm.h)) {
          if (playing) E.provider.sync(C.Scene.build(s, f), true, E.rate, null); // keep video elements rolling for the next uncached frame
          E.lastScene = C.Scene.build(s, f); C.bus.emit('rendered', E.lastScene);
          if (E.scopesWanted && !playing) { var pxc = E.comp.readSmall(256, Math.max(16, Math.round(256 * s.h / s.w))); if (pxc) C.bus.emit('scopes', { data: pxc, w: 256, h: Math.max(16, Math.round(256 * s.h / s.w)) }); }
          return;
        }
      }
      var scene = C.Multicam && C.Multicam.gridOn && s.multicam ? C.Multicam.gridScene(s, f) : C.Scene.build(s, f);
      var look = playing ? C.Scene.build(s, f + Math.round(s.fps * Math.max(1, Math.abs(E.rate)) * Math.sign(E.rate || 1))) : null;
      E.provider.sync(scene, !!playing, E.rate, look);
      // parked on a frame whose video isn't decoded yet: keep showing the previous picture instead of flashing black
      // (the element's 'loadeddata' event triggers a re-render; give up waiting after 1.5 s)
      if (!playing && E.lastScene && E.provider.notReady(scene)) {
        var now0 = performance.now();
        if (!E.pendSince) E.pendSince = now0;
        if (now0 - E.pendSince < 1500) { setTimeout(E.requestRender, 150); return; }
      }
      E.pendSince = 0;
      var sz = E.outputSize();
      E.comp.render(scene, sz[0], sz[1], E.provider, { captions: true });
      E.lastScene = scene;
      C.bus.emit('rendered', scene);
      var now = performance.now();
      if (E.scopesWanted && (!playing || now - lastScopes > 160)) {
        lastScopes = now;
        var px = E.comp.readSmall(256, Math.max(16, Math.round(256 * s.h / s.w)));
        if (px) C.bus.emit('scopes', { data: px, w: 256, h: Math.max(16, Math.round(256 * s.h / s.w)) });
      }
    } catch (e) { console.error('[Cutline] render error', e); }
  };

  E.snapshotPNG = function () {
    var s = P.seq(); if (!s) return Promise.resolve(null);
    var cv = document.createElement('canvas');
    var comp = C.createCompositor(cv);
    var prov = new C.SourceProvider('snap');
    var scene = C.Scene.build(s, E.frame);
    return prov.prepare(scene).then(function () {
      comp.render(scene, s.w, s.h, prov, { captions: true });
      return new Promise(function (res) { cv.toBlob(function (b) { prov.dropAll(); if (comp.destroy) comp.destroy(); res(b); }, 'image/png'); });
    });
  };
})();
