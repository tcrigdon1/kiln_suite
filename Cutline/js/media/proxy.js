/* Cutline — proxies: a low-resolution VP8/VP9 WebM copy of a video file, transcoded in the background with WebCodecs
   (decode → scale → encode → own WebM muxer) and kept in IndexedDB, keyed by file name + size + mtime so it survives
   reloads and relinks. The Program monitor's <video> elements play the proxy when "Use Proxies" is on; export,
   frame-exact stills, thumbnails and audio always read the original. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, h = U.h, P = C.P;
  var PX = C.Proxy = { jobs: {}, queue: [] };
  PX.WIDTHS = [[640, '640 px wide (fastest)'], [960, '960 px wide'], [1280, '1280 px wide']];
  if (C.prefs.useProxies == null) C.prefs.useProxies = true;
  if (!C.prefs.proxyWidth) C.prefs.proxyWidth = 960;

  function key(m) { return 'proxy|' + C.Store.mediaKey(C.Media.base(m)); }
  PX.has = function (m) { var rt = m && C.MRT[C.Media.base(m).id]; return !!(rt && rt.proxyUrl); };
  PX.busy = function (m) { return !!(m && PX.jobs[C.Media.base(m).id]); };
  // the URL a preview element should play for this media
  PX.playUrl = function (rt) { return C.prefs.useProxies !== false && rt.proxyUrl ? rt.proxyUrl : rt.url; };
  function attach(base, blob, meta) {
    var rt = C.MRT[base.id]; if (!rt) return;
    if (rt.proxyUrl) { try { URL.revokeObjectURL(rt.proxyUrl); } catch (e) { } }
    rt.proxyUrl = URL.createObjectURL(blob); rt.proxy = Object.assign({ size: blob.size }, meta || {});
    C.Media.linkSubs(base.id);
    C.bus.emit('media:update', base.id); C.bus.emit('rerender'); C.bus.emit('state');
  }
  // look up a cached proxy when a media item comes online
  PX.restore = function (m) {
    var base = C.Media.base(m), rt = C.MRT[base.id];
    if (!rt || rt.proxyUrl || rt.proxyChecked || base.type !== 'video' || !rt.file) return Promise.resolve(false);
    rt.proxyChecked = true;
    return C.Store.getMedia(key(base)).then(function (rec) {
      if (!rec || !rec.blob) return false;
      attach(base, rec.blob, rec.meta); return true;
    });
  };
  C.bus.on('media:update', function (id) { var m = P.media(id); if (m && m.type === 'video' && C.MRT[id] && C.MRT[id].status === 'ready') PX.restore(m); });
  C.bus.on('project', function () { (C.state.project ? C.state.project.media : []).forEach(function (m) { if (m.type === 'video' && C.MRT[m.id] && C.MRT[m.id].status === 'ready') PX.restore(m); }); });

  // transcode one media item; resolves when stored. opts: { width, onProgress, cancel }
  PX.make = function (m, opts) {
    opts = opts || {};
    var base = C.Media.base(m), rt = C.MRT[base.id];
    if (!rt || !rt.file || base.type !== 'video') return Promise.reject(new Error('Not a video file'));
    if (PX.jobs[base.id]) return PX.jobs[base.id].p;
    if (!window.VideoEncoder || !window.VideoDecoder) return Promise.reject(new Error('This browser has no WebCodecs encoder'));
    var job = PX.jobs[base.id] = { progress: 0, cancel: opts.cancel || { v: false } };
    C.bus.emit('proxy:progress', base.id);
    var tw = Math.min(opts.width || C.prefs.proxyWidth || 960, base.w || 1920), ar = (base.h || 1080) / (base.w || 1920);
    var w = Math.max(64, Math.round(tw / 2) * 2), hh = Math.max(64, Math.round(w * ar / 2) * 2), fps = base.fps || 30;
    var frames = Math.max(1, Math.round((base.duration || 0) * fps)), bitrate = Math.round(w * hh * fps * 0.08);
    var canvas = document.createElement('canvas'); canvas.width = w; canvas.height = hh;
    var g = canvas.getContext('2d'), err = null, mux, enc, dec, vel = null, chunks = 0;
    function progress(p, msg) { job.progress = p; if (opts.onProgress) opts.onProgress(p, msg); C.bus.emit('proxy:progress', base.id); }
    var p = C.Export.findVideoConfig('vp8', w, hh, fps, bitrate, 'variable').then(function (cfg) {
      return cfg || C.Export.findVideoConfig('vp9', w, hh, fps, bitrate, 'variable');
    }).then(function (cfg) {
      if (!cfg) throw new Error('No VP8/VP9 encoder available');
      mux = new C.WebMMuxer({ video: { codec: /vp09/.test(cfg.codec) ? 'V_VP9' : 'V_VP8', width: w, height: hh, fps: fps } }, null);
      enc = new VideoEncoder({ output: function (ch, meta) { chunks++; mux.addVideo(ch, meta); }, error: function (e) { err = e; } });
      enc.configure(cfg);
      return C.FrameDecoder.infoFor(base);
    }).then(function (info) {
      if (info) dec = new C.FrameDecoder(rt.file, info);
      else { // no WebCodecs decode for this container: seek a hidden <video> instead (slower, still exact enough)
        vel = document.createElement('video'); vel.muted = true; vel.preload = 'auto'; vel.src = rt.url;
        return C.Media.waitEvent(vel, 'loadeddata', 'error', 20000);
      }
    }).then(function () {
      var i = 0, gop = Math.round(fps * 2);
      function wait() { if (enc.encodeQueueSize <= 6) return Promise.resolve(); return new Promise(function (r) { var t = setInterval(function () { if (enc.encodeQueueSize <= 3 || err) { clearInterval(t); r(); } }, 4); }); }
      function step() {
        if (job.cancel.v || err || i >= frames) return Promise.resolve();
        var t = (i + 0.5) / fps;
        var get = dec ? dec.getFrame(Math.min(t, base.duration - 0.01)).then(function (f) { g.drawImage(f, 0, 0, w, hh); }) : C.Media.seekTo(vel, Math.min(t, base.duration - 0.05)).then(function () { g.drawImage(vel, 0, 0, w, hh); });
        return get.then(function () {
          var vf = new VideoFrame(canvas, { timestamp: Math.round(i / fps * 1e6), duration: Math.round(1e6 / fps) });
          enc.encode(vf, { keyFrame: i % gop === 0 }); vf.close();
          i++;
          if (i % 10 === 0) progress(i / frames, 'Proxy ' + base.name + ' — frame ' + i + ' / ' + frames);
          return wait().then(function () { return i % 6 === 0 ? new Promise(function (r) { setTimeout(r, 0); }) : null; }).then(step);
        });
      }
      return step();
    }).then(function () {
      if (dec) dec.close(); if (vel) { try { vel.removeAttribute('src'); vel.load(); } catch (e) { } }
      if (job.cancel.v) { try { enc.close(); } catch (e) { } return null; }
      return enc.flush().then(function () { enc.close(); if (err) throw err; return mux.finalize(); }).then(function (r) {
        var blob = r.blob, meta = { w: w, h: hh, fps: fps, frames: frames, made: Date.now() };
        return C.Store.putMedia(key(base), { blob: blob, meta: meta }).then(function () { attach(base, blob, meta); return { size: blob.size, w: w, h: hh, chunks: chunks }; });
      });
    }).then(function (r) { delete PX.jobs[base.id]; C.bus.emit('proxy:progress', base.id); C.bus.emit('media'); return r; },
      function (e) { delete PX.jobs[base.id]; C.bus.emit('proxy:progress', base.id); try { if (enc && enc.state !== 'closed') enc.close(); } catch (x) { } if (dec) dec.close(); console.warn('[Cutline] proxy failed for ' + base.name, e); throw e; });
    job.p = p;
    return p;
  };
  PX.remove = function (m) {
    var base = C.Media.base(m), rt = C.MRT[base.id];
    if (rt && rt.proxyUrl) { try { URL.revokeObjectURL(rt.proxyUrl); } catch (e) { } delete rt.proxyUrl; delete rt.proxy; C.Media.linkSubs(base.id); }
    return C.Store.delMedia(key(base)).then(function () { C.bus.emit('media:update', base.id); C.bus.emit('rerender'); C.bus.emit('media'); });
  };
  // background queue (one transcode at a time)
  PX.enqueue = function (ids) {
    ids.forEach(function (id) { var m = P.media(id); if (m && m.type === 'video' && !PX.has(m) && !PX.busy(m) && PX.queue.indexOf(id) < 0) PX.queue.push(id); });
    pump();
  };
  var pumping = false;
  function pump() {
    if (pumping || !PX.queue.length) return;
    var id = PX.queue.shift(), m = P.media(id);
    if (!m) { pump(); return; }
    pumping = true;
    var job = C.jobs ? C.jobs.start('Proxy: ' + m.name, { cancel: true }) : null, cancel = { v: false };
    if (job && job.onCancel) job.onCancel(function () { cancel.v = true; });
    PX.make(m, { cancel: cancel, onProgress: function (p, msg) { if (job) job.update(p, msg); } }).then(function (r) {
      if (job) job.done(); if (r) C.toast('Proxy ready: ' + m.name + ' (' + r.w + '×' + r.h + ', ' + U.fmtSize(r.size) + ')', 3500);
    }, function (e) { if (job) job.done(); C.toast('Proxy failed for ' + m.name + ': ' + (e && e.message || e), 5000); }).then(function () { pumping = false; pump(); });
  }
  PX.toggleUse = function () { C.prefs.useProxies = C.prefs.useProxies === false; C.savePrefs(); C.Engine.provider.dropAll(); C.bus.emit('rerender'); C.bus.emit('state'); if (C.Bin && C.Bin.render) C.Bin.render(); C.toast(C.prefs.useProxies ? 'Playing proxies where available' : 'Playing full-resolution media'); };
  // is the current program frame being shown from a proxy?
  PX.activeInScene = function (scene) {
    if (!scene || C.prefs.useProxies === false) return false;
    return C.Scene.clipLayers(scene).some(function (L) { return L.media && L.media.type === 'video' && PX.has(L.media); });
  };

  /* ---------- UI: commands, menus, library badge ---------- */
  function selectedVideo() {
    var ids = (C.Bin && C.state.focus === 'bin' ? C.Bin.sel : []).filter(function (i) { var m = P.media(i); return m && m.type === 'video'; });
    if (!ids.length) ids = P.selectedClips().map(function (c) { var m = P.media(c.mediaId); return m && m.type === 'video' ? C.Media.base(m).id : null; }).filter(Boolean);
    return ids.filter(function (id, i, a) { return a.indexOf(id) === i; });
  }
  C.CMD.reg('proxyMake', 'Create Proxies for Selected', 'File', null, function () { var ids = selectedVideo(); if (!ids.length) { C.toast('Select video items in the Library (or clips on the timeline) first'); return; } PX.enqueue(ids); C.toast('Queued ' + ids.length + ' prox' + (ids.length > 1 ? 'ies' : 'y')); });
  C.CMD.reg('proxyAll', 'Create Proxies for All Video', 'File', null, function () { var ids = C.state.project.media.filter(function (m) { return m.type === 'video' && !m.sub && !PX.has(m); }).map(function (m) { return m.id; }); if (!ids.length) { C.toast('Every video item already has a proxy'); return; } PX.enqueue(ids); C.toast('Queued ' + ids.length + ' prox' + (ids.length > 1 ? 'ies' : 'y')); });
  C.CMD.reg('proxyRemove', 'Remove Proxies for Selected', 'File', null, function () { var ids = selectedVideo().filter(function (id) { return PX.has(P.media(id)); }); if (!ids.length) { C.toast('No proxies on the selection'); return; } Promise.all(ids.map(function (id) { return PX.remove(P.media(id)); })).then(function () { C.toast('Removed ' + ids.length + ' prox' + (ids.length > 1 ? 'ies' : 'y')); }); });
  C.CMD.reg('proxyToggle', 'Use Proxies (when available)', 'View', 'Ctrl+Shift+Alt+P', function () { PX.toggleUse(); }, { needsProject: false, checked: function () { return C.prefs.useProxies !== false; } });
  var prevFile = C.Menus.extra.File;
  C.Menus.extra.File = function () {
    var c = C.CMD.byId;
    function cmd(id) { return C.CMD.menuItem(id); }
    return (prevFile ? prevFile() : []).concat([{ label: 'Proxies', sub: [cmd('proxyMake'), cmd('proxyAll'), cmd('proxyRemove'), '-',
      { label: 'Proxy size', sub: PX.WIDTHS.map(function (o) { return { label: o[1], checked: function () { return C.prefs.proxyWidth === o[0]; }, action: function () { C.prefs.proxyWidth = o[0]; C.savePrefs(); } }; }) }] }]);
  };
  var prevView = C.Menus.extra.View;
  C.Menus.extra.View = function () { return (prevView ? prevView() : []).concat([{ label: 'Use Proxies (when available)', kbd: C.CMD.keyLabel('proxyToggle'), checked: function () { return C.prefs.useProxies !== false; }, action: function () { PX.toggleUse(); } }]); };
  // Library context menu entries
  if (C.Bin) {
    C.Bin.extraItems = C.Bin.extraItems || [];
    C.Bin.extraItems.push(function (x) {
      if (x.kind !== 'media' || x.obj.type !== 'video') return [];
      var m = x.obj, id = m.id;
      if (PX.busy(m)) return [{ label: 'Proxy: transcoding ' + Math.round((PX.jobs[C.Media.base(m).id].progress || 0) * 100) + '%…', disabled: true }];
      return PX.has(m) ? [{ label: 'Remove Proxy (' + U.fmtSize(C.MRT[C.Media.base(m).id].proxy.size) + ')', action: function () { PX.remove(m); } }]
        : [{ label: 'Create Proxy', action: function () { PX.enqueue([id]); } }];
    });
  }
  C.bus.on('proxy:progress', function () { if (C.Bin && C.Bin.render) C.Bin.render(); });
})();
