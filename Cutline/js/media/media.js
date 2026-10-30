/* Cutline — media import, probing, thumbnails, filmstrips, audio decode & waveform peaks. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, P = C.P;
  var M = C.Media = {};
  var SR = 48000;
  var decodeCtx = null;
  function getDecodeCtx() {
    if (!decodeCtx) decodeCtx = new OfflineAudioContext(2, 1, SR);
    return decodeCtx;
  }
  M.SR = SR;

  var VIDEO_EXT = /\.(mp4|m4v|webm|mov|mkv|ogv|avi|3gp)$/i;
  // Containers browsers can't play at all (raw HLS/DVR segments, Flash video…): explained with the exact fix
  var REMUX_EXT = /\.(ts|m2ts|mts|tsv|flv|m3u8|f4v|vob|wmv|rm|rmvb)$/i;
  M.LONG_SEC = 600;               // longer than this (or > 1 GB): audio is streamed, never decoded whole
  M.LONG_BYTES = 1073741824;
  M.isLong = function (m) { return (m.duration || 0) > M.LONG_SEC || (m.size || 0) > M.LONG_BYTES; };
  M.remuxHelp = function (name, why) {
    var base = String(name || 'input').replace(/\.[^.]+$/, ''), ext = (String(name).match(/\.([^.]+)$/) || [])[1] || '';
    var h = U.h;
    return h('div', { style: { maxWidth: '560px', lineHeight: '1.55' } },
      h('div', h('b', name), ' ' + (why || (/^(ts|m2ts|mts|tsv)$/i.test(ext) ? 'is an MPEG transport stream (raw HLS segments, as some downloaders leave them). Browsers cannot open .ts files directly.' : 'uses a container this browser cannot play.'))),
      h('div', { style: { marginTop: '8px' } }, 'Fix: remux it to MP4 — this copies the streams without re-encoding, so it is fast and lossless:'),
      h('pre.code-snip', { style: { userSelect: 'all', whiteSpace: 'pre-wrap', background: 'var(--bg-0, #111)', padding: '6px 8px', borderRadius: '4px', margin: '6px 0' } }, 'ffmpeg -i "' + name + '" -c copy "' + base + '.mp4"'),
      h('div.muted', 'Downloading a Twitch VOD? yt-dlp\'s default output is already an MP4 (H.264 + AAC): yt-dlp "https://www.twitch.tv/videos/<id>". The Video Producer "Download" button also gives an MP4.'),
      h('div.muted', { style: { marginTop: '6px' } }, 'If the remuxed file still will not play, re-encode it: ffmpeg -i "' + name + '" -c:v libx264 -crf 18 -c:a aac "' + base + '.mp4"'));
  };
  var AUDIO_EXT = /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|weba)$/i;
  var IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i;
  M.kindOf = function (file) {
    var t = file.type || '';
    if (t.indexOf('video/') === 0 || (!t && VIDEO_EXT.test(file.name))) return 'video';
    if (t.indexOf('audio/') === 0 || AUDIO_EXT.test(file.name)) return 'audio';
    if (t.indexOf('image/') === 0 || IMAGE_EXT.test(file.name)) return 'image';
    if (VIDEO_EXT.test(file.name)) return 'video';
    return null;
  };

  function waitEvent(el, ok, bad, ms) {
    return new Promise(function (res, rej) {
      var to = setTimeout(function () { cleanup(); rej(new Error('timeout waiting for ' + ok)); }, ms || 15000);
      function okf() { cleanup(); res(); }
      function badf() { cleanup(); rej(new Error('media error ' + (el.error ? el.error.code : ''))); }
      function cleanup() { clearTimeout(to); el.removeEventListener(ok, okf); if (bad) el.removeEventListener(bad, badf); }
      el.addEventListener(ok, okf); if (bad) el.addEventListener(bad, badf);
    });
  }
  M.waitEvent = waitEvent;
  function seekTo(el, t, ms) {
    return new Promise(function (res) {
      if (Math.abs(el.currentTime - t) < 0.0005 && el.readyState >= 2) { res(); return; }
      var done = false;
      var to = setTimeout(function () { if (!done) { done = true; el.removeEventListener('seeked', f); res(); } }, ms || 4000);
      function f() { if (done) return; done = true; clearTimeout(to); el.removeEventListener('seeked', f); res(); }
      el.addEventListener('seeked', f);
      el.currentTime = t;
    });
  }
  M.seekTo = seekTo;

  function thumbCanvas(src, sw, sh, H) {
    var w = Math.max(1, Math.round(H * (sw / Math.max(1, sh))));
    var c = document.createElement('canvas'); c.width = w; c.height = H;
    var g = c.getContext('2d');
    try { g.drawImage(src, 0, 0, w, H); } catch (e) { g.fillStyle = '#222'; g.fillRect(0, 0, w, H); }
    return c;
  }

  M.thumbH = function () { return { low: 36, medium: 54, high: 90 }[C.prefs.thumbQuality] || 54; };

  /* ---------- Import ---------- */
  M.importFiles = function (files, folderId) {
    files = Array.prototype.slice.call(files || []);
    var remux = files.filter(function (f) { return REMUX_EXT.test(f.name); });
    files = files.filter(function (f) { return !REMUX_EXT.test(f.name); });
    if (remux.length && C.ui && C.ui.dialog) C.ui.dialog({ title: 'This file needs remuxing first', width: 600, body: M.remuxHelp(remux[0].name), buttons: [{ label: 'OK', primary: true }] });
    var accepted = files.filter(function (f) { return M.kindOf(f); });
    var rejected = files.length - accepted.length;
    if (rejected) C.toast(rejected + ' file(s) skipped (unsupported type)');
    if (!accepted.length) return Promise.resolve([]);
    var created = [], failed = [];
    var job = C.ui && C.ui.progress ? C.ui.progress('Importing ' + accepted.length + ' file(s)…') : null;
    var chain = Promise.resolve();
    accepted.forEach(function (file, i) {
      chain = chain.then(function () {
        if (job) { job.k = i / accepted.length; job.update(job.k, 'Importing ' + file.name); }
        if (!file.size) return Promise.reject(new Error('the file is empty (0 bytes)')).catch(function (e) { failed.push({ name: file.name, msg: e.message }); });
        return M.addFile(file, folderId, null, job).then(function (m) { if (m) created.push(m); }).catch(function (e) {
          console.warn('[Cutline] import failed', file.name, e && e.message);
          failed.push({ name: file.name, msg: e && e.message || 'unknown error', friendly: e && e.friendly });
        });
      });
    });
    return chain.then(function () {
      if (job) job.done();
      // one dialog for everything that failed (not one per file)
      if (failed.length && C.ui && C.ui.dialog) {
        var h = U.h, body = h('div', { style: { maxWidth: '600px', lineHeight: 1.5 } });
        if (failed.length === 1 && failed[0].friendly) body.appendChild(failed[0].friendly);
        else failed.forEach(function (f) { body.appendChild(h('div', { style: { marginBottom: '6px' } }, h('b', f.name), ' — ', f.msg)); });
        if (failed.length > 1 && failed.some(function (f) { return f.friendly; })) body.appendChild(h('div.muted', { style: { marginTop: '8px' } }, 'Files the browser cannot play can usually be fixed by remuxing: ffmpeg -i "input" -c copy "output.mp4"'));
        C.ui.dialog({ title: failed.length === 1 ? 'Cannot open ' + failed[0].name : failed.length + ' files could not be imported', width: 640, body: body, buttons: [{ label: 'OK', primary: true }] });
      } else if (failed.length) failed.forEach(function (f) { C.toast('Could not import ' + f.name + ': ' + f.msg); });
      if (created.length) {
        C.edit('Import ' + (created.length === 1 ? created[0].name : created.length + ' items'), function () { return true; });
        C.bus.emit('media');
      }
      return created;
    });
  };

  // Subclips share their parent's file/runtime: base(m) is the record that owns the file
  M.base = function (m) { if (m && m.sub && m.sub.of) { var p = P.media(m.sub.of); if (p) return p; } return m; };
  M.linkSubs = function (parentId) {
    var prj = C.state.project; if (!prj) return;
    prj.media.forEach(function (x) { if (x.sub && x.sub.of === parentId) { if (C.MRT[parentId]) C.MRT[x.id] = C.MRT[parentId]; else delete C.MRT[x.id]; } });
  };
  M.addFile = function (file, folderId, existing, job) {
    var kind = M.kindOf(file);
    var m = existing || {
      id: U.uid('m'), name: file.name, type: kind, size: file.size, lastModified: file.lastModified || 0, mime: file.type,
      duration: 0, w: 0, h: 0, fps: null, hasAudio: kind === 'audio', hasVideo: kind === 'video', folder: folderId || null, added: Date.now()
    };
    if (existing) { m.size = file.size; m.lastModified = file.lastModified || m.lastModified || 0; if (file.name !== m.name) m.file = file.name; else delete m.file; } // relinked to a renamed file: remember its name so it matches next time
    var rt = C.MRT[m.id] = { file: file, url: URL.createObjectURL(file), status: 'loading', film: [] };
    if (!existing) C.state.project.media.push(m);
    var t0 = performance.now();
    // container probe (metadata only: MP4 moov / Matroska header+Cues) runs alongside the element probe
    var demuxP = kind === 'image' || !C.Demux ? Promise.resolve(null) : C.Demux.probe(file, function (k, msg) { rt.indexing = k; if (job) job.update(job.k || 0, msg + ' ' + file.name + ' ' + Math.round(k * 100) + '%'); C.bus.emit('media:progress', m.id); });
    var p;
    if (kind === 'image') p = probeImage(m, rt);
    else if (kind === 'video') p = probeVideo(m, rt).catch(function (e) { return demuxP.then(function (pi) { throw friendlyError(m, pi, e); }); })
      .then(function () { return demuxP; }).then(function (pi) { return afterProbe(m, rt, pi); });
    else p = probeAudio(m, rt).catch(function (e) { return demuxP.then(function (pi) { throw friendlyError(m, pi, e); }); })
      .then(function () { return demuxP; }).then(function (pi) { return afterProbe(m, rt, pi); });
    return p.then(function () {
      rt.status = 'ready'; rt.importMs = performance.now() - t0;
      M.linkSubs(m.id);
      C.bus.emit('media:update', m.id);
      if (kind === 'video' && m.hasVideo) M.queueFilmstrip(m.id);
      // cache small media for crash recovery. Never large files: IndexedDB would have to hold a full copy
      // (the limit is the "cache" preference, hard-capped at 512 MB regardless of the setting).
      if (C.Store && file.size <= Math.min(512, C.prefs.cacheMB) * 1048576) C.Store.putMedia(C.Store.mediaKey(m), file);
      return m;
    }).catch(function (e) {
      if (!existing) C.state.project.media = C.state.project.media.filter(function (x) { return x !== m; });
      if (rt.url) try { URL.revokeObjectURL(rt.url); } catch (x) { }
      delete C.MRT[m.id];
      throw e;
    });
  };
  // Explain why a file can't be played, with the exact fix
  function friendlyError(m, pi, e) {
    var err = new Error('this browser cannot play it' + (e && e.message ? ' (' + e.message + ')' : ''));
    var codecs = [];
    if (pi && pi.video) codecs.push((pi.video.codec || pi.video.fourcc || pi.video.codecId || 'unknown') + ' video' + (pi.video.config ? '' : ' (not decodable here)'));
    if (pi && pi.audio) codecs.push((pi.audio.codec || pi.audio.fourcc || pi.audio.codecId || 'unknown') + ' audio' + (pi.audio.config ? '' : ' (not decodable here)'));
    var why = 'could not be opened by the browser' + (codecs.length ? ' — it contains ' + codecs.join(' and ') + '.' : '.');
    if (pi && pi.video && /^(hvc1|hev1)/.test(pi.video.codec || '')) why += ' HEVC/H.265 playback needs hardware support (and on Windows the HEVC Video Extension).';
    if (pi && pi.video && /^avc1/.test(pi.video.codec || '') && !pi.video.config) why += ' This browser build has no H.264 decoder (Chrome and Edge on Windows include one).';
    err.friendly = M.remuxHelp(m.name, why);
    return err;
  }
  // After the element probe: frame rate / VFR from container timestamps and the audio strategy
  function afterProbe(m, rt, pi) {
    rt.probe = pi || null;
    // a duration-less (live-style) file whose end-seek timed out: take the container scan's duration instead
    if ((!isFinite(m.duration) || !m.duration) && pi && isFinite(pi.duration) && pi.duration > 0) m.duration = pi.duration;
    var jobs = [];
    if (pi && pi.video && m.hasVideo) jobs.push(C.Demux.frameRate(pi).then(function (st) {
      if (!st || !st.fps) return;
      var precise = snapFps(st.fps, 0.0015);
      if (st.vfr) { m.vfr = true; m.fpsAvg = Math.round(st.fps * 100) / 100; m.fps = snapFps(st.median || st.fps, 0.03); if (m.fps % 1 && Math.abs(Math.round(m.fps) - m.fps) < 0.05) m.fps = snapFps(st.fps, 0.02); }
      else m.fps = precise;
    }).catch(function () { }));
    return Promise.all(jobs).then(function () {
      var wantsAudio = m.type === 'audio' || (pi ? !!pi.audio : true);
      if (!wantsAudio) { m.hasAudio = false; return; }
      var long = M.isLong(m);
      if (!long) return decodeAudio(m, rt, m.type !== 'audio');
      if (pi && pi.audio && pi.audio.config) return setupStream(m, rt, pi.audio);
      // long file whose audio WebCodecs can't decode: full decode only if the PCM stays reasonable
      var pcm = (m.duration || 0) * 48000 * 2 * 4;
      if (pcm <= 1.2 * 1073741824 && m.size <= M.LONG_BYTES) return decodeAudio(m, rt, m.type !== 'audio');
      m.hasAudio = false;
      var cname = pi && pi.audio ? (pi.audio.codec || pi.audio.fourcc || pi.audio.codecId) : 'unknown';
      C.toast(m.name + ': audio (' + cname + ') cannot be streamed in this browser — imported without audio. Remux the audio to AAC or Opus.', 6000);
      if (m.type === 'audio') throw new Error('audio codec ' + cname + ' cannot be decoded in streaming mode');
    });
  }
  function setupStream(m, rt, atrack) {
    rt.stream = { track: atrack };
    m.hasAudio = true; m.channels = Math.min(2, atrack.channels || 2); m.sampleRate = atrack.sampleRate || 48000; m.streamed = true;
    if (!m.duration) m.duration = atrack.duration || 0;
    // waveform + loudness pass in the background (or instant from the IndexedDB cache)
    setTimeout(function () { if (C.MRT[m.id] === rt && C.AudioStream) C.AudioStream.startPeaks(m); }, 50);
  }
  M.isStreamed = function (m) { return !!(C.AudioStream && C.AudioStream.isStreamed(m)); };

  function probeImage(m, rt) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () {
        m.w = img.naturalWidth || 1920; m.h = img.naturalHeight || 1080; m.duration = 0;
        rt.image = img;
        rt.thumb = thumbCanvas(img, m.w, m.h, 90);
        res();
      };
      img.onerror = function () { rej(new Error('cannot decode image')); };
      img.src = rt.url;
    });
  }
  function probeVideo(m, rt) {
    var v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.playsInline = true; v.crossOrigin = 'anonymous';
    v.src = rt.url;
    return waitEvent(v, 'loadedmetadata', 'error', 20000).then(function () {
      if (!isFinite(v.duration)) {
        // some recorded webm files lack a duration header
        return seekTo(v, 1e7, 15000).then(function () { m.duration = v.duration; return seekTo(v, 0); }); // the end-seek scans the file: allow it time
      }
      m.duration = v.duration;
    }).then(function () {
      m.w = v.videoWidth; m.h = v.videoHeight; m.hasVideo = m.w > 0;
      if (!m.hasVideo) { m.type = 'audio'; return; }
      return seekTo(v, Math.min(m.duration * 0.15, 2)).then(function () {
        rt.thumb = thumbCanvas(v, m.w, m.h, 90);
        return detectFps(v, m);
      });
    }).then(function () { v.removeAttribute('src'); v.load(); });
  }
  function detectFps(v, m) {
    if (!('requestVideoFrameCallback' in v)) return Promise.resolve();
    return new Promise(function (res) {
      var times = [], n = 0, done = false;
      var finish = function () {
        if (done) return; done = true; try { v.pause(); } catch (e) {}
        if (times.length > 3) {
          var ds = [];
          for (var i = 1; i < times.length; i++) { var d = times[i] - times[i - 1]; if (d > 0.002) ds.push(d); }
          ds.sort(function (a, b) { return a - b; });
          if (ds.length) {
            // average the single-frame steps (those close to the smallest step): container timestamps are often
            // rounded to 1 ms, so a 60 fps file shows 16/17 ms steps and the minimum alone would read as 62.5 fps
            var single = ds.filter(function (d) { return d < ds[0] * 1.45; });
            var d0 = single.reduce(function (a, b) { return a + b; }, 0) / single.length, fps = 1 / d0;
            // coarse estimate: prefer the integer rate when 29.97/30-style pairs can't be told apart
            var sn = snapFps(fps, 0.03);
            if (sn % 1 && Math.abs(Math.round(sn) - fps) / fps < 0.006) sn = Math.round(sn);
            m.fps = sn;
          }
        }
        res();
      };
      var cb = function (now, meta) {
        times.push(meta.mediaTime); n++;
        if (n < 20) v.requestVideoFrameCallback(cb); else finish();
      };
      v.requestVideoFrameCallback(cb);
      v.playbackRate = 1;
      var pp = v.play(); if (pp && pp.catch) pp.catch(function () { finish(); });
      setTimeout(finish, 1500);
    });
  }
  var FPS_STD = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 100, 119.88, 120];
  function snapFps(fps, tol) {
    var best = null, bd = 1e9;
    FPS_STD.forEach(function (f) { var e = Math.abs(f - fps) / f; if (e < bd) { bd = e; best = f; } });
    return bd < tol ? best : Math.round(fps * 100) / 100;
  }
  function probeAudio(m, rt) {
    var a = document.createElement('audio');
    a.preload = 'metadata'; a.src = rt.url;
    return waitEvent(a, 'loadedmetadata', 'error', 15000).then(function () {
      m.duration = isFinite(a.duration) ? a.duration : 0;
      a.removeAttribute('src'); a.load();
    });
  }
  // Short media: decode the whole audio track once (fast path; the PCM fits comfortably in memory)
  function decodeAudio(m, rt, optional) {
    if (m.size > M.LONG_BYTES * 1.2) { m.hasAudio = false; if (optional) C.toast(m.name + ': file too large to decode audio in the browser'); return Promise.resolve(); }
    return rt.file.arrayBuffer().then(function (ab) {
      return new Promise(function (res, rej) {
        try { var pr = getDecodeCtx().decodeAudioData(ab); if (pr && pr.then) pr.then(res, rej); else rej(new Error('no promise')); } catch (e) { rej(e); }
      });
    }).then(function (buf) {
      rt.buffer = buf; m.hasAudio = true;
      if (!m.duration) m.duration = buf.duration;
      rt.peaks = M.computePeaks(buf);
      m.channels = buf.numberOfChannels; m.sampleRate = rt.file ? (m.sampleRate || null) : null;
    }).catch(function (e) {
      if (!optional) throw new Error('cannot decode audio');
      m.hasAudio = false;
    });
  }
  M.PEAK_SPP = 256;
  M.computePeaks = function (buf) {
    var spp = M.PEAK_SPP, n = Math.ceil(buf.length / spp);
    var mn = new Float32Array(n), mx = new Float32Array(n);
    var chs = []; for (var c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
    var nc = chs.length;
    for (var i = 0; i < n; i++) {
      var lo = 0, hi = 0, s0 = i * spp, s1 = Math.min(buf.length, s0 + spp);
      for (var s = s0; s < s1; s += 2) {
        var v = 0; for (var k = 0; k < nc; k++) v += chs[k][s];
        v /= nc;
        if (v < lo) lo = v; if (v > hi) hi = v;
      }
      mn[i] = lo; mx[i] = hi;
    }
    return { min: mn, max: mx, rate: buf.sampleRate / spp };
  };

  // Min/max of a peaks object over source seconds [tA, tB) as floats in [-1, 1], using the coarsest pyramid level
  // that still has >= 1 bucket per span (so a 10-hour overview costs about the same as a zoomed view).
  M.peakSpan = function (pk, tA, tB, loop) {
    var L = pk, span = (tB - tA) * pk.rate;
    if (pk.levels) for (var li = 0; li < pk.levels.length && span >= 8; li++) { L = pk.levels[li]; span /= 4; }
    var n = L.n != null ? L.n : L.min.length, total = L.min.length;
    var iA = Math.floor(tA * L.rate), iB = Math.max(iA + 1, Math.ceil(tB * L.rate)), lo = 0, hi = 0, any = false;
    for (var i = iA; i < iB; i++) {
      var ii = i; if (loop) ii = ((i % total) + total) % total;
      if (ii < 0 || ii >= n) continue;
      any = true; if (L.min[ii] < lo) lo = L.min[ii]; if (L.max[ii] > hi) hi = L.max[ii];
    }
    var k = pk.k || 1;
    return { lo: lo * k, hi: hi * k, any: any };
  };
  M.peaksPending = function (pk, t) { return pk && pk.levels && pk.done < 1 && t * pk.rate >= pk.n; };

  /* ---------- Lazy key-frame thumbnails for long media (visible range only, LRU-capped) ---------- */
  var thumbLRU = new Map(), THUMB_CAP = 360, thumbQ = [], thumbBusy = 0, thumbEls = {};
  M.thumbStats = function () { return { cached: thumbLRU.size, queued: thumbQ.length, cap: THUMB_CAP }; };
  function thumbKey(id, q) { return id + '|' + q.toFixed(2); }
  // Cached thumbnail nearest to source time t for media id, quantised to `step` seconds; requests it if missing.
  M.thumbAt = function (id, t, step) {
    var m = M.base(P.media(id)); if (!m) return null;
    id = m.id;
    step = Math.max(step || 1, 0.5);
    var q = Math.max(0, Math.round(t / step) * step), key = thumbKey(id, q), hit = thumbLRU.get(key);
    if (hit) { thumbLRU.delete(key); thumbLRU.set(key, hit); return hit; }
    if (!thumbQ.some(function (r) { return r.key === key; })) { thumbQ.push({ key: key, id: id, t: q }); if (thumbQ.length > 48) thumbQ.shift(); }
    pumpThumbs();
    // meanwhile: the closest thumbnail we already have for this media
    var rt = C.MRT[id], best = null, bd = 1e18;
    thumbLRU.forEach(function (c, k) { if (k.lastIndexOf(id + '|', 0) === 0) { var d = Math.abs(c.t0 - t); if (d < bd) { bd = d; best = c; } } });
    if (best && bd < step * 4) return best;
    return M.filmFrame(id, t) || (rt && rt.thumb) || best;
  };
  function pumpThumbs() {
    while (thumbBusy < 2 && thumbQ.length) {
      var r = thumbQ.pop(); // newest first: what is on screen now
      if (thumbLRU.has(r.key)) continue;
      thumbBusy++;
      (function (r) {
        makeThumb(r.id, r.t).then(function (c) {
          thumbBusy--;
          if (c) {
            c.t0 = r.t; thumbLRU.set(r.key, c);
            while (thumbLRU.size > THUMB_CAP) thumbLRU.delete(thumbLRU.keys().next().value);
            filmEmit(r.id);
          }
          pumpThumbs();
        }, function () { thumbBusy--; pumpThumbs(); });
      })(r);
    }
  }
  var filmEmit = U.throttle(function (id) { C.bus.emit('film', id); }, 120);
  function makeThumb(id, t) {
    var m = P.media(id); if (!m) return Promise.resolve(null);
    var H = M.thumbH();
    var viaKey = C.FrameDecoder && C.FrameDecoder.keyThumb ? C.FrameDecoder.keyThumb(m, t, H) : Promise.resolve(null);
    return viaKey.then(function (c) { return c || elementThumb(m, t, H); });
  }
  // fallback when WebCodecs can't decode the codec: seek a hidden element (one per media)
  function elementThumb(m, t, H) {
    var rt = C.MRT[m.id]; if (!rt || !rt.url) return Promise.resolve(null);
    var e = thumbEls[m.id];
    if (!e || e.url !== rt.url) { var v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = rt.url; e = thumbEls[m.id] = { v: v, url: rt.url, ready: waitEvent(v, 'loadeddata', 'error', 20000) }; }
    return e.ready.then(function () { return seekTo(e.v, Math.min(t, Math.max(0, m.duration - 0.05))); }).then(function () { return thumbCanvas(e.v, m.w, m.h, H); }).catch(function () { return null; });
  }

  /* ---------- Filmstrips (background) ---------- */
  var filmQueue = [], filmBusy = false;
  M.queueFilmstrip = function (id) { if (filmQueue.indexOf(id) < 0) filmQueue.push(id); pumpFilm(); };
  function pumpFilm() {
    if (filmBusy || !filmQueue.length) return;
    filmBusy = true;
    var id = filmQueue.shift();
    buildFilm(id).catch(function (e) { console.warn('[Cutline] filmstrip failed', e); }).then(function () { filmBusy = false; setTimeout(pumpFilm, 30); });
  }
  function buildFilm(id) {
    var m = P.media(id), rt = C.MRT[id];
    if (!m || !rt || !rt.url || m.type !== 'video') return Promise.resolve();
    if (M.isLong(m)) return buildFilmKeys(m, rt);
    var v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.src = rt.url;
    var H = M.thumbH();
    var n = U.clamp(Math.ceil(m.duration / 1.0), 6, 90);
    var step = m.duration / n;
    rt.film = [];
    return waitEvent(v, 'loadeddata', 'error', 20000).then(function () {
      var i = 0;
      function next() {
        if (i >= n || !C.MRT[id]) return Promise.resolve();
        var t = Math.min(m.duration - 0.05, i * step + 0.02);
        return seekTo(v, Math.max(0, t)).then(function () {
          rt.film.push({ t: t, c: thumbCanvas(v, m.w, m.h, H) });
          i++;
          if (i % 6 === 0) C.bus.emit('film', id);
          return next();
        });
      }
      return next();
    }).then(function () { rt.filmH = H; C.bus.emit('film', id); v.removeAttribute('src'); v.load(); });
  }
  // Library hover-scrub strip for long media: 60 key-frame thumbnails (one key frame read each)
  function buildFilmKeys(m, rt) {
    var n = 60, H = M.thumbH(), i = 0, film = [];
    rt.film = film;
    function next() {
      if (i >= n || C.MRT[m.id] !== rt) return Promise.resolve();
      var t = (i + 0.5) * m.duration / n; i++;
      return makeThumb(m.id, t).then(function (c) { if (c) film.push({ t: c.t != null ? c.t : t, c: c }); if (i % 10 === 0) C.bus.emit('film', m.id); return next(); });
    }
    return next().then(function () { film.sort(function (a, b) { return a.t - b.t; }); rt.filmH = H; C.bus.emit('film', m.id); });
  }
  M.filmFrame = function (id, t) {
    var rt = C.MRT[id]; if (!rt || !rt.film || !rt.film.length) return rt && rt.thumb;
    var f = rt.film, best = f[0], bd = 1e9;
    // film entries are sorted by time
    var lo = 0, hi = f.length - 1;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (f[mid].t < t) lo = mid + 1; else hi = mid; }
    for (var k = Math.max(0, lo - 1); k <= Math.min(f.length - 1, lo + 1); k++) { var d = Math.abs(f[k].t - t); if (d < bd) { bd = d; best = f[k]; } }
    return best.c;
  };
  M.rebuildAllFilm = function () { C.state.project.media.forEach(function (m) { if (m.type === 'video' && C.MRT[m.id]) M.queueFilmstrip(m.id); }); };

  /* ---------- Generated items ---------- */
  M.GEN_DEFAULTS = {
    title: function () { return { kind: 'title', layers: [C.Titles.newTextLayer({ text: 'Your Title' })], roll: null }; },
    solid: function () { return { kind: 'solid', color: '#f0913a' }; },
    gradient: function () { return { kind: 'gradient', c1: '#1f3b4d', c2: '#f0913a', angle: 135, mode: 'linear' }; },
    adjust: function () { return { kind: 'adjust' }; },
    bars: function () { return { kind: 'bars', toneHz: 1000, toneDb: -20 }; },
    countdown: function () { return { kind: 'countdown', from: 8, c1: '#24201c', c2: '#f0913a', c3: '#f2ebe3' }; },
    tcburn: function () { return { kind: 'tcburn', pos: 'bl', size: 44, color: '#ffffff', bg: '#000000', bgOp: 0.7, font: 'Consolas', label: '', offset: 0, frames: false, margin: 40 }; }
  };
  M.GEN_NAMES = { title: 'Title', solid: 'Solid Color', gradient: 'Gradient', adjust: 'Adjustment Clip', bars: 'Bars & Tone', countdown: 'Countdown', tcburn: 'Timecode Burn-in' };
  M.newGen = function (kind, opts) {
    var seq = P.seq();
    var g = opts && opts.gen ? opts.gen : M.GEN_DEFAULTS[kind]();
    var count = C.state.project.media.filter(function (x) { return x.type === 'gen' && x.gen.kind === kind; }).length;
    var m = {
      id: U.uid('m'), type: 'gen', name: (opts && opts.name) || (M.GEN_NAMES[kind] + (count ? ' ' + (count + 1) : '')),
      gen: g, w: seq ? seq.w : 1920, h: seq ? seq.h : 1080, duration: 0, folder: (opts && opts.folder) || null, added: Date.now(),
      stillDur: kind === 'countdown' ? (g.from + 2) : (kind === 'bars' ? 10 : C.prefs.stillDur), hasAudio: kind === 'bars' || kind === 'countdown'
    };
    C.state.project.media.push(m);
    C.MRT[m.id] = { status: 'ready', film: [] };
    M.genThumb(m);
    return m;
  };
  M.genThumb = function (m) {
    var rt = C.MRT[m.id] || (C.MRT[m.id] = { status: 'ready', film: [] });
    var c = document.createElement('canvas'); c.width = 160; c.height = 90;
    try {
      var g = c.getContext('2d');
      var w = m.w || 1920, h = m.h || 1080;
      var tw = Math.min(w, 640), th = Math.round(tw * h / w);
      var big = C.Titles.renderGen(m.gen, null, m.gen.kind === 'countdown' ? 0.3 : 0, tw, th, null);
      if (m.gen.kind === 'title') { g.fillStyle = '#1d2228'; g.fillRect(0, 0, 160, 90); g.fillStyle = '#262c33'; for (var cy = 0; cy < 90; cy += 10) for (var cx = (cy / 10) % 2 * 10; cx < 160; cx += 20) g.fillRect(cx, cy, 10, 10); }
      if (m.gen.kind !== 'title') { g.fillStyle = '#000'; g.fillRect(0, 0, 160, 90); }
      if (m.gen.kind === 'adjust') { g.fillStyle = '#2b3138'; g.fillRect(0, 0, 160, 90); g.strokeStyle = '#7f8fa6'; g.strokeRect(6.5, 6.5, 147, 77); g.fillStyle = '#9fb0c6'; g.font = '600 13px sans-serif'; g.textAlign = 'center'; g.fillText('ADJUST', 80, 50); }
      else if (big) { var s = Math.min(160 / big.width, 90 / big.height); g.drawImage(big, (160 - big.width * s) / 2, (90 - big.height * s) / 2, big.width * s, big.height * s); }
    } catch (e) { console.warn(e); }
    rt.thumb = c;
  };
  // Procedural audio for generated items
  M.genBuffer = function (m) {
    var rt = C.MRT[m.id] || (C.MRT[m.id] = { status: 'ready', film: [] });
    if (rt.buffer) return rt.buffer;
    var ctx = getDecodeCtx();
    var g = m.gen, buf;
    if (g.kind === 'bars') {
      buf = ctx.createBuffer(2, SR, SR);
      var amp = U.dbToGain(g.toneDb || -20), hz = g.toneHz || 1000;
      for (var ch = 0; ch < 2; ch++) { var d = buf.getChannelData(ch); for (var i = 0; i < SR; i++) d[i] = amp * Math.sin(2 * Math.PI * hz * i / SR); }
      rt.loop = true;
    } else if (g.kind === 'countdown') {
      var secs = (g.from || 8) + 2;
      buf = ctx.createBuffer(2, SR * secs, SR);
      for (var c2 = 0; c2 < 2; c2++) {
        var dd = buf.getChannelData(c2);
        for (var s = 0; s < (g.from || 8) - 1; s++) {
          var off = s * SR;
          for (var j = 0; j < SR * 0.08; j++) dd[off + j] = 0.35 * Math.sin(2 * Math.PI * 1000 * j / SR) * Math.min(1, (SR * 0.08 - j) / 200);
        }
      }
      rt.loop = false;
    } else return null;
    rt.buffer = buf;
    rt.peaks = M.computePeaks(buf);
    return buf;
  };
  M.audioBuffer = function (m) {
    if (!m) return null;
    if (m.type === 'gen') return M.genBuffer(m);
    m = M.base(m);
    var rt = C.MRT[m.id];
    return rt && rt.buffer || null;
  };

  M.isOnline = function (m) {
    if (!m) return false;
    if (m.type === 'gen') return true;
    if (m.type === 'nest') return !!P.seqById(m.seqId);
    var rt = C.MRT[m.id];
    return !!(rt && rt.url && rt.status === 'ready');
  };
  M.offlineMedia = function () { return (C.state.project ? C.state.project.media : []).filter(function (m) { return m.type !== 'gen' && m.type !== 'nest' && !m.sub && !M.isOnline(m); }); };

  // Attach a file to an existing (offline) media record
  M.relink = function (m, file) {
    var old = C.MRT[m.id];
    if (old && old.url) URL.revokeObjectURL(old.url);
    return M.addFile(file, m.folder, m).then(function () { C.bus.emit('media'); C.bus.emit('changed', { relink: true }); return m; });
  };
  M.matchFiles = function (files) {
    var off = M.offlineMedia(), jobs = [], used = {};
    off.forEach(function (m) {
      var want = m.file || m.name;
      var cands = files.filter(function (f) { return (f.name === want || f.name === m.name) && !used[f.name + f.size]; });
      if (!cands.length) cands = files.filter(function (f) { return f.name.toLowerCase() === want.toLowerCase() && !used[f.name + f.size]; });
      var exact = cands.filter(function (f) { return f.size === m.size; })[0] || cands[0];
      if (exact) { used[exact.name + exact.size] = 1; jobs.push(M.relink(m, exact).catch(function (e) { C.toast('Relink failed: ' + m.name); })); }
    });
    return Promise.all(jobs).then(function (r) { return r.filter(Boolean).length; });
  };
  M.tryCache = function () {
    if (!C.Store) return Promise.resolve(0);
    var off = M.offlineMedia(), n = 0;
    return Promise.all(off.map(function (m) {
      return C.Store.getMedia(C.Store.mediaKey(m)).then(function (blob) {
        if (!blob) return;
        var f = blob instanceof File ? blob : new File([blob], m.name, { type: m.mime || blob.type, lastModified: m.lastModified });
        return M.addFile(f, m.folder, m).then(function () { n++; }).catch(function () {});
      });
    })).then(function () { if (n) { C.bus.emit('media'); C.bus.emit('changed', { relink: true }); } return n; });
  };

  M.removeMedia = function (ids) {
    // deleting a source also deletes its subclips
    ids = ids.slice();
    C.state.project.media.forEach(function (m) { if (m.sub && ids.indexOf(m.sub.of) >= 0 && ids.indexOf(m.id) < 0) ids.push(m.id); });
    C.edit('Delete ' + ids.length + ' item(s)', function (seq, prj) {
      prj.sequences.forEach(function (s) {
        var del = s.clips.filter(function (c) { return ids.indexOf(c.mediaId) >= 0; }).map(function (c) { return c.id; });
        C.T.removeClips(s, del);
      });
      prj.media = prj.media.filter(function (m) { return ids.indexOf(m.id) < 0; });
    });
    C.bus.emit('media');
  };
})();
