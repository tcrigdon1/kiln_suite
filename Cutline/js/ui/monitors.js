/* Cutline — Source and Program monitors (playback controls, overlays, on-canvas transform handles). */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, h = U.h, P = C.P, KF = C.KF;

  function btn(icon, tip, fn, cls) { return C.ui.iconBtn(icon, tip, fn, { cls: cls || 'sm', tipPos: 'bottom' }); }
  function fitStage(view, stage, w, h2, zoom) {
    var vw = view.clientWidth, vh = view.clientHeight;
    if (!vw || !vh) return 1;
    var dpr = window.devicePixelRatio || 1, k;
    if (zoom === 'fit' || !zoom) k = Math.min(vw / w, vh / h2);
    else k = (+zoom) / dpr;
    stage.style.width = Math.max(2, Math.round(w * k)) + 'px';
    stage.style.height = Math.max(2, Math.round(h2 * k)) + 'px';
    view.classList.toggle('zoomed', zoom !== 'fit' && (w * k > vw || h2 * k > vh));
    if (view.classList.contains('zoomed')) { stage.style.margin = Math.max(0, (vh - h2 * k) / 2) + 'px ' + Math.max(0, (vw - w * k) / 2) + 'px'; }
    else stage.style.margin = '';
    return k;
  }
  function tcEditable(el, getFps, getCur, onSet) {
    el.addEventListener('click', function () {
      var inp = h('input.tc-input', { type: 'text', value: el.textContent });
      el.style.display = 'none'; el.parentNode.insertBefore(inp, el.nextSibling); inp.focus(); inp.select();
      var done = false;
      function fin(ok) {
        if (done) return; done = true;
        if (ok) { var f = U.parseTC(inp.value, getFps(), getCur()); if (f != null) onSet(f); }
        inp.remove(); el.style.display = '';
      }
      inp.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') fin(true); if (e.key === 'Escape') fin(false); });
      inp.addEventListener('blur', function () { fin(true); });
    });
  }
  // Scrub bar (shared look)
  function drawScrub(cv, opts) {
    var dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    var pad = 10, w = W - pad * 2, dur = Math.max(1e-6, opts.dur);
    var X = function (t) { return pad + t / dur * w; };
    g.fillStyle = '#2e2924'; g.fillRect(pad, H / 2 - 2, w, 4);
    if (opts.wave) {
      var pk = opts.wave, n = pk.min.length; g.fillStyle = opts.waveStrong ? 'rgba(240,160,74,.6)' : 'rgba(240,160,74,.35)';
      for (var x = 0; x < w; x += 1) {
        var i0 = Math.floor(x / w * n), i1 = Math.max(i0 + 1, Math.floor((x + 1) / w * n)), lo = 0, hi = 0;
        for (var i = i0; i < i1; i++) { if ((pk.min[i] || 0) < lo) lo = pk.min[i]; if ((pk.max[i] || 0) > hi) hi = pk.max[i]; }
        g.fillRect(pad + x, H / 2 - hi * H * 0.46, 1, (hi - lo) * H * 0.46 + 1);
      }
    }
    if (opts.inT != null || opts.outT != null) {
      var a = opts.inT != null ? opts.inT : 0, b = opts.outT != null ? opts.outT : dur;
      g.fillStyle = 'rgba(240,145,58,.28)'; g.fillRect(X(a), 3, X(b) - X(a), H - 6);
      g.fillStyle = '#f0913a';
      if (opts.inT != null) g.fillRect(X(a) - 1, 3, 2, H - 6);
      if (opts.outT != null) g.fillRect(X(b) - 1, 3, 2, H - 6);
    }
    (opts.markers || []).forEach(function (m) { g.fillStyle = m.color || '#3dbfae'; g.beginPath(); g.moveTo(X(m.t) - 4, 2); g.lineTo(X(m.t) + 4, 2); g.lineTo(X(m.t), 8); g.fill(); });
    var px = X(U.clamp(opts.t, 0, dur));
    g.fillStyle = '#ffad62'; g.fillRect(px - 1, 0, 2, H);
    g.beginPath(); g.moveTo(px - 5, 0); g.lineTo(px + 5, 0); g.lineTo(px, 6); g.fill();
    return { X: X, pad: pad, w: w };
  }

  /* ======================= SOURCE MONITOR ======================= */
  var S = C.Source = { useVideo: true, useAudio: true, rev: null };
  S.init = function (panel) {
    S.title = h('span.title-sub', '');
    panel.appendChild(h('div.panel-head', 'Source', S.title));
    S.view = h('div.mon-view');
    S.stage = h('div.mon-stage');
    S.video = h('video', { playsInline: true, preload: 'auto' });
    S.img = h('img', { draggable: false });
    S.gen = h('canvas.srcgen');
    S.empty = h('div.mon-empty', { html: C.icon('film') }, h('div', 'Double-click an item in the Library to view it here.'));
    S.stage.appendChild(S.video); S.stage.appendChild(S.img); S.stage.appendChild(S.gen);
    S.waveCv = h('canvas.overlay'); S.stage.appendChild(S.waveCv);
    S.kfPrev = h('canvas.kf-prev'); S.kfPrev.style.display = 'none'; S.stage.appendChild(S.kfPrev);
    S.view.appendChild(S.stage); S.view.appendChild(S.empty);
    S.scrubCv = h('canvas');
    S.scrub = h('div.mon-scrub', S.scrubCv);
    S.tc = h('div.tc', '00:00:00:00'); S.dur = h('div.tc.dur', '00:00:00:00');
    S.playBtn = btn('play', 'Play / Pause (Space)', function () { S.toggle(); }, 'play');
    S.vHandle = h('div.drag-handle', { draggable: true, title: 'Drag video only to the timeline', html: C.icon('film') + 'V' });
    S.aHandle = h('div.drag-handle', { draggable: true, title: 'Drag audio only to the timeline', html: C.icon('audio') + 'A' });
    var bar = h('div.mon-bar.src-bar', S.tc,
      btn('markin', 'Mark In (I)', function () { S.markIn(); }), btn('markout', 'Mark Out (O)', function () { S.markOut(); }), btn('clearmarks', 'Clear In/Out', function () { S.clearMarks(); }),
      h('div.grow'),
      h('div.center', btn('stepback', 'Step back (←)', function () { S.step(-1); }), S.playBtn, btn('stepfwd', 'Step forward (→)', function () { S.step(1); })),
      h('div.grow'),
      S.subBtn = btn('subclip', 'Make Subclip from In/Out (Ctrl+U)', function () { S.makeSubclip(); }),
      S.mkBtn = btn('marker', 'Add marker on this media (M)', function () { S.addMarker(); }),
      btn('insert', 'Insert (,)', function () { C.A.sourceEdit('insert'); }), btn('overwrite', 'Overwrite (.)', function () { C.A.sourceEdit('overwrite'); }),
      S.vHandle, S.aHandle, S.moreBtn = btn('more', 'More', function (e, b2) {
        var r = b2.getBoundingClientRect();
        C.ui.menu([{ label: 'Clear In/Out', action: function () { S.clearMarks(); } }, { label: 'Make Subclip', kbd: C.CMD.keyLabel('makeSubclip'), action: function () { S.makeSubclip(); } },
          { label: 'Add Marker', kbd: 'M', action: function () { S.addMarker(); } }, { label: 'Find Highlights…', action: function () { var m = S.media(); if (m) C.A.findHighlightsDialog(C.Media.base(m).id); } }, '-',
          { label: 'Audio Waveform', checked: C.prefs.srcWave !== false, action: function () { C.prefs.srcWave = C.prefs.srcWave === false; C.savePrefs(); S.update(); } }, '-',
          { label: 'Use Video (V)', checked: S.useVideo, action: function () { S.vHandle.click(); } },
          { label: 'Use Audio (A)', checked: S.useAudio, action: function () { S.aHandle.click(); } }], r.left, r.bottom + 2);
      }), S.dur);
    S.vHandle.classList.add('opt-h'); S.aHandle.classList.add('opt-h'); S.moreBtn.classList.add('opt-more'); S.subBtn.classList.add('opt-h'); S.mkBtn.classList.add('opt-h');
    U.$$('button', bar).forEach(function (b2, i) { if (i === 2) b2.classList.add('opt-c'); });
    panel.appendChild(h('div.monitor', S.view, S.scrub, bar));
    tcEditable(S.tc, S.fps, function () { return Math.round(S.video.currentTime * S.fps()); }, function (f) { S.seek(f / S.fps()); });
    panel.addEventListener('pointerdown', function () { C.state.focus = 'source'; U.$$('.panel.focus').forEach(function (p) { p.classList.remove('focus'); }); });
    S.video.addEventListener('timeupdate', S.update);
    S.video.addEventListener('seeked', function () {
      // coalesced scrubbing: apply the newest pending target once the previous seek has landed
      if (S.pendingSeek != null) { var t = S.pendingSeek; S.pendingSeek = null; S.video.currentTime = t; return; }
      S.seekTarget = null;
      if (!S.scrubbing) S.kfPrev.style.display = 'none';
      S.update();
    });
    S.video.addEventListener('play', function () { S.playBtn.innerHTML = C.icon('pause'); });
    S.video.addEventListener('pause', function () { S.playBtn.innerHTML = C.icon('play'); S.update(); });
    var rafLoop = function () { if (!S.video.paused) S.update(); requestAnimationFrame(rafLoop); };
    requestAnimationFrame(rafLoop);
    // scrubbing
    S.scrub.addEventListener('pointerdown', function (e) {
      var m = S.media(); if (!m) return;
      var r = S.scrub.getBoundingClientRect();
      S.scrubbing = true;
      function at(ev) { var k = U.clamp((ev.clientX - r.left - 10) / (r.width - 20), 0, 1); S.seek(k * S.duration(), true); }
      at(e); U.drag(e, function (dx, dy, ev) { at(ev); }, function () { S.scrubbing = false; if (!S.video.seeking) S.kfPrev.style.display = 'none'; });
    });
    // drag to timeline
    function dragStart(e, v, a) {
      var m = S.media(); if (!m) { e.preventDefault(); return; }
      var mk = S.marks();
      e.dataTransfer.setData('application/x-cutline-media', JSON.stringify([m.id]));
      e.dataTransfer.setData('text/plain', 'cutline:' + m.id);
      e.dataTransfer.effectAllowed = 'copy';
      C.state.dragMedia = { ids: [m.id], video: v, audio: a, inSec: mk.inSec, outSec: mk.outSec };
    }
    S.view.draggable = true;
    S.view.addEventListener('dragstart', function (e) { dragStart(e, S.useVideo, S.useAudio); });
    S.vHandle.addEventListener('dragstart', function (e) { e.stopPropagation(); dragStart(e, true, false); });
    S.aHandle.addEventListener('dragstart', function (e) { e.stopPropagation(); dragStart(e, false, true); });
    [S.view, S.vHandle, S.aHandle].forEach(function (el) { el.addEventListener('dragend', function () { C.state.dragMedia = null; C.bus.emit('dragend'); }); });
    S.vHandle.addEventListener('click', function () { S.useVideo = !S.useVideo; S.vHandle.classList.toggle('off', !S.useVideo); });
    S.aHandle.addEventListener('click', function () { S.useAudio = !S.useAudio; S.aHandle.classList.toggle('off', !S.useAudio); });
    new ResizeObserver(function () { S.layout(); }).observe(S.view);
    C.bus.on('media:update', function (id) { if (id === C.state.sourceMedia) S.open(id, S.video.currentTime); });
    C.bus.on('changed', function (x) { if (C.state.sourceMedia && !P.media(C.state.sourceMedia)) S.close(); else if (x && x.restore) S.layout(); });
    S.close();
  };
  S.media = function () { return P.media(C.state.sourceMedia); };
  S.fps = function () { var m = S.media(); var s = P.seq(); return (m && m.fps) || (s ? s.fps : 30); };
  S.duration = function () { var m = S.media(); if (!m) return 0; return P.isStill(m) ? (m.stillDur || C.prefs.stillDur) : m.duration; };
  S.close = function () {
    C.state.sourceMedia = null;
    S.video.pause(); S.video.removeAttribute('src'); S.video.load();
    S.video.style.display = S.img.style.display = S.gen.style.display = 'none';
    S.stage.style.display = 'none'; S.empty.style.display = '';
    S.title.textContent = '';
    S.update();
  };
  S.open = function (id, t) {
    var m = P.media(id); if (!m) return;
    C.state.sourceMedia = id;
    C.state.focus = 'source';
    S.stopRev();
    S.title.textContent = m.name;
    S.empty.style.display = 'none'; S.stage.style.display = '';
    S.video.style.display = S.img.style.display = S.gen.style.display = 'none';
    S.waveCv.style.display = 'none';
    var rt = C.MRT[id];
    if (m.type === 'video' || m.type === 'audio') {
      if (!rt || !rt.url) { S.empty.style.display = ''; S.empty.lastChild.textContent = 'Media offline — use File › Relink Media.'; S.stage.style.display = 'none'; return; }
      if (S.video.getAttribute('src') !== rt.url) { S.video.src = rt.url; }
      S.video.style.display = '';
      S.video.muted = false;
      var start = t != null ? t : (m.srcIn || 0);
      var go = function () { S.video.currentTime = Math.min(start, (m.duration || 0) - 0.01); S.update(); S.layout(); };
      if (S.video.readyState >= 1) go(); else S.video.addEventListener('loadedmetadata', go, { once: true });
      if (m.type === 'audio') { S.waveCv.style.display = ''; S.drawWave(); }
    } else if (m.type === 'image') {
      S.img.src = rt && rt.url || ''; S.img.style.display = '';
    } else {
      S.gen.style.display = '';
      var s = P.seq();
      var c = m.gen ? C.Titles.renderGen(m.gen, null, m.gen.kind === 'countdown' ? 0.3 : 0, Math.min(1280, m.w || 1280), Math.min(1280, m.w || 1280) * (m.h || 720) / (m.w || 1280), null) : null;
      if (c) { S.gen.width = c.width; S.gen.height = c.height; S.gen.getContext('2d').drawImage(c, 0, 0); }
      else { S.gen.width = 320; S.gen.height = 180; var g = S.gen.getContext('2d'); g.fillStyle = '#2b3138'; g.fillRect(0, 0, 320, 180); g.fillStyle = '#9fb0c6'; g.font = '600 18px sans-serif'; g.textAlign = 'center'; g.fillText(m.type === 'nest' ? 'Nested Sequence' : 'Adjustment Clip', 160, 96); if (m.type === 'nest') { g.font = '13px sans-serif'; g.fillText((m.name || '').slice(0, 40), 160, 120); } }
      void s;
    }
    S.layout(); S.update();
  };
  S.drawWave = function () {
    var m = S.media(), rt = m && C.MRT[m.id]; if (!rt || !rt.peaks) return;
    var cv = S.waveCv, W = 800, H = 300; cv.width = W; cv.height = H;
    var g = cv.getContext('2d'); g.fillStyle = '#120d08'; g.fillRect(0, 0, W, H);
    var pk = rt.peaks, n = pk.min.length; g.fillStyle = '#f0a04a';
    for (var x = 0; x < W; x++) { var i0 = Math.floor(x / W * n), i1 = Math.max(i0 + 1, Math.floor((x + 1) / W * n)), lo = 0, hi = 0; for (var i = i0; i < i1; i++) { if (pk.min[i] < lo) lo = pk.min[i]; if (pk.max[i] > hi) hi = pk.max[i]; } g.fillRect(x, H / 2 - hi * H * 0.45, 1, (hi - lo) * H * 0.45 + 1); }
  };
  S.layout = function () {
    var m = S.media(); if (!m) return;
    var w = m.type === 'audio' ? 16 : (m.w || 16), hh = m.type === 'audio' ? 9 : (m.h || 9);
    fitStage(S.view, S.stage, w, hh, 'fit');
    S.update();
  };
  S.time = function () { var m = S.media(); if (!m) return 0; if (S.seekTarget != null && (m.type === 'video' || m.type === 'audio')) return S.seekTarget; return (m.type === 'video' || m.type === 'audio') ? S.video.currentTime : (S.stillT || 0); };
  S.update = function () {
    var m = S.media(), fps = S.fps();
    var t = S.time(), dur = S.duration();
    S.tc.textContent = U.fmtTC(Math.round(t * fps), fps);
    var mk = S.marks();
    var span = (mk.outSec != null ? mk.outSec : dur) - (mk.inSec || 0);
    S.dur.textContent = m ? U.fmtTC(Math.round(span * fps), fps) : '00:00:00:00';
    var rt = m && C.MRT[m.id];
    var mk2 = m ? (C.Media.base(m).markers || []).map(function (x) { return { t: x.t, color: x.auto ? strengthColor(x.strength) : (x.color || '#3dbfae') }; }) : [];
    var showWave = m && rt && rt.peaks && (m.type === 'audio' || (m.type === 'video' && m.hasAudio)) && C.prefs.srcWave !== false;
    S.scrub.classList.toggle('with-wave', !!showWave);
    drawScrub(S.scrubCv, { dur: dur || 1, t: t, inT: m ? m.srcIn : null, outT: m ? m.srcOut : null, wave: showWave ? rt.peaks : null, waveStrong: !!showWave, markers: mk2 });
  };
  function strengthColor(v) { v = U.clamp(((v || 0) - 6) / 18, 0, 1); return 'rgb(' + Math.round(230) + ',' + Math.round(200 - 120 * v) + ',' + Math.round(80 - 40 * v) + ')'; }
  S.strengthColor = strengthColor;
  // Seeks are coalesced: while the element is still seeking only the newest target is kept, so dragging across a
  // 10-hour file never queues hundreds of seeks. For long media a key-frame preview is shown while dragging.
  S.seek = function (t, fromScrub) {
    var m = S.media(); if (!m) return;
    t = U.clamp(t, 0, S.duration());
    if (m.type === 'video' || m.type === 'audio') {
      t = Math.min(t, Math.max(0, m.duration - 0.001));
      S.seekTarget = t;
      if (S.video.seeking) S.pendingSeek = t; else S.video.currentTime = t;
      if (fromScrub && m.type === 'video' && C.Media.isLong(C.Media.base(m))) S.keyPreview(t);
    }
    else S.stillT = t;
    S.update();
  };
  var kfBusy = false, kfWant = null;
  S.keyPreview = function (t) {
    kfWant = t;
    if (kfBusy || !C.FrameDecoder || !C.FrameDecoder.keyThumb) return;
    var m = S.media(); if (!m) return;
    kfBusy = true;
    var H = Math.min(360, m.h || 360);
    C.FrameDecoder.keyThumb(m, t, H).then(function (c) {
      kfBusy = false;
      if (c && (S.scrubbing || S.video.seeking) && S.media() === m) {
        S.kfPrev.width = c.width; S.kfPrev.height = c.height; S.kfPrev.getContext('2d').drawImage(c, 0, 0); S.kfPrev.style.display = '';
        S.kfPrevT = c.t;
      }
      if (kfWant !== t && (S.scrubbing || S.video.seeking)) S.keyPreview(kfWant);
    }, function () { kfBusy = false; });
  };
  /* ---------- markers on source media + subclips ---------- */
  S.addMarker = function () {
    var m = S.media(); if (!m || !(m.type === 'video' || m.type === 'audio')) { C.toast('Open a clip in the Source monitor first'); return; }
    var bid = C.Media.base(m).id, t = S.time(), id = U.uid('mk'), b0 = C.Media.base(m);
    if ((b0.markers || []).some(function (x) { return Math.abs(x.t - t) < 0.5 / (b0.fps || 30); })) { C.toast('There is already a marker here'); return; }
    C.edit('Add Source Marker', function (s, prj) {
      var bm = prj.media.filter(function (x) { return x.id === bid; })[0];
      bm.markers = bm.markers || [];
      bm.markers.push({ id: id, t: t, name: 'Marker ' + (bm.markers.length + 1), color: C.A.MARKER_COLORS[1], note: '' });
      bm.markers.sort(function (a, b) { return a.t - b.t; });
    });
    S.update();
  };
  S.makeSubclip = function (name) {
    var m = S.media(); if (!m || !(m.type === 'video' || m.type === 'audio')) { C.toast('Open a video or audio clip in the Source monitor first'); return null; }
    var mk = S.marks(), a = mk.inSec || 0, b = mk.outSec != null ? mk.outSec : S.duration();
    if (m.srcIn == null && m.srcOut == null) { C.toast('Set In (I) and Out (O) in the Source monitor first'); return null; }
    if (b - a < 0.05) { C.toast('The In/Out range is too short'); return null; }
    var bm = C.Media.base(m), fps = bm.fps || 30;
    var count = C.state.project.media.filter(function (x) { return x.sub && x.sub.of === bm.id; }).length;
    var nm = name || (bm.name.replace(/\.[^.]+$/, '') + ' — ' + U.fmtTC(Math.round(a * fps), fps, { short: a < 3600 }).slice(0, -3) + ' (' + U.fmtDur(b - a) + ')');
    var sub = { id: U.uid('m'), name: nm, type: bm.type, sub: { of: bm.id, in: a, out: b }, size: bm.size, lastModified: bm.lastModified, mime: bm.mime,
      duration: bm.duration, w: bm.w, h: bm.h, fps: bm.fps, hasAudio: bm.hasAudio, hasVideo: bm.hasVideo, channels: bm.channels, folder: C.Bin ? C.Bin.currentFolder() : null, added: Date.now(), srcIn: a, srcOut: b, subN: count + 1 };
    C.edit('Make Subclip', function (s, prj) { prj.media.push(sub); });
    if (C.MRT[bm.id]) C.MRT[sub.id] = C.MRT[bm.id];
    C.bus.emit('media');
    C.toast('Subclip "' + nm + '" added to the Library');
    return sub;
  };
  S.step = function (n) { S.stopRev(); S.video.pause(); S.seek(S.time() + n / S.fps()); };
  S.toggle = function () {
    var m = S.media(); if (!m || !(m.type === 'video' || m.type === 'audio')) return;
    S.stopRev();
    if (S.video.paused) { S.video.playbackRate = 1; var mk = S.marks(); if (mk.outSec != null && S.video.currentTime >= mk.outSec - 0.02) S.video.currentTime = mk.inSec || 0; S.video.play().catch(function () { }); }
    else S.video.pause();
  };
  S.stopRev = function () { if (S.rev) { clearInterval(S.rev); S.rev = null; } };
  S.shuttle = function (k) {
    var m = S.media(); if (!m || !(m.type === 'video' || m.type === 'audio')) return;
    if (k === 'k') { S.stopRev(); S.video.pause(); return; }
    if (k === 'l') {
      S.stopRev();
      if (!S.video.paused && S.video.playbackRate > 0) S.video.playbackRate = Math.min(8, S.video.playbackRate * 2);
      else { S.video.playbackRate = 1; S.video.play().catch(function () { }); }
    } else {
      S.video.pause();
      var rate = S.rev ? Math.min(8, (S.revRate || 1) * 2) : 1;
      S.stopRev(); S.revRate = rate;
      S.rev = setInterval(function () { var t = S.video.currentTime - rate / 15; if (t <= 0) { S.stopRev(); t = 0; } S.video.currentTime = t; }, 1000 / 15);
    }
  };
  S.marks = function () { var m = S.media(); return { inSec: m && m.srcIn != null ? m.srcIn : 0, outSec: m && m.srcOut != null ? m.srcOut : null }; };
  S.markIn = function () { var m = S.media(); if (!m) return; m.srcIn = S.time(); if (m.srcOut != null && m.srcOut <= m.srcIn) m.srcOut = null; S.update(); };
  S.markOut = function () { var m = S.media(); if (!m) return; m.srcOut = S.time() + 1 / S.fps(); if (m.srcIn != null && m.srcIn >= m.srcOut) m.srcIn = null; S.update(); };
  S.clearMarks = function () { var m = S.media(); if (!m) return; m.srcIn = null; m.srcOut = null; S.update(); };
  S.goIn = function () { var m = S.media(); if (m) S.seek(m.srcIn || 0); };
  S.goOut = function () { var m = S.media(); if (m && m.srcOut != null) S.seek(m.srcOut - 1 / S.fps()); };

  /* ======================= PROGRAM MONITOR ======================= */
  var PG = C.Program = { zoom: 'fit', safe: false, grid: false };
  PG.init = function (panel) {
    PG.title = h('span.title-sub', '');
    panel.appendChild(h('div.panel-head', 'Program', PG.title));
    PG.view = h('div.mon-view');
    PG.stage = h('div.mon-stage');
    PG.canvas = h('canvas.prog');
    PG.overlay = h('canvas.overlay.interactive');
    PG.stage.appendChild(PG.canvas); PG.stage.appendChild(PG.overlay);
    PG.view.appendChild(PG.stage);
    PG.scrubCv = h('canvas');
    PG.scrub = h('div.mon-scrub', PG.scrubCv);
    PG.tc = h('div.tc', '00:00:00:00'); PG.dur = h('div.tc.dur', '00:00:00:00');
    PG.playBtn = btn('play', 'Play / Pause (Space)', function () { C.Engine.toggle(); }, 'play');
    PG.shuttleInd = h('span.shuttle-ind', '');
    PG.loopBtn = btn('loop', 'Loop playback', function () { C.CMD.run('loop'); });
    PG.safeBtn = btn('safe', 'Safe margins', function () { PG.toggle('safe'); });
    PG.gridBtn = btn('grid', 'Grid', function () { PG.toggle('grid'); });
    var resSel = h('select', { title: 'Playback resolution' });
    [['auto', 'Auto'], ['1', 'Full'], ['0.5', '1/2'], ['0.25', '1/4']].forEach(function (o) { resSel.appendChild(h('option', { value: o[0] }, o[1])); });
    resSel.value = String(C.prefs.playbackRes);
    resSel.addEventListener('change', function () { C.prefs.playbackRes = resSel.value === 'auto' ? 'auto' : +resSel.value; C.savePrefs(); C.Engine.requestRender(); });
    var zoomSel = h('select', { title: 'Zoom' });
    [['fit', 'Fit'], ['0.25', '25%'], ['0.5', '50%'], ['1', '100%'], ['2', '200%']].forEach(function (o) { zoomSel.appendChild(h('option', { value: o[0] }, o[1])); });
    zoomSel.addEventListener('change', function () { PG.zoom = zoomSel.value; PG.layout(); });
    var bar = h('div.mon-bar', PG.tc,
      btn('markin', 'Mark In (I)', function () { C.state.focus = 'program'; C.A.markIn(); }), btn('markout', 'Mark Out (O)', function () { C.state.focus = 'program'; C.A.markOut(); }),
      btn('marker', 'Add marker (M)', function () { C.state.focus = 'program'; C.A.addMarker(); }),
      h('div.grow'),
      h('div.center', btn('prevedit', 'Previous edit (↑)', function () { C.A.editPoint(-1); }), btn('stepback', 'Step back (←)', function () { C.Engine.step(-1); }), PG.playBtn,
        btn('stepfwd', 'Step forward (→)', function () { C.Engine.step(1); }), btn('nextedit', 'Next edit (↓)', function () { C.A.editPoint(1); }), PG.shuttleInd),
      h('div.grow'),
      PG.loopBtn, PG.safeBtn, PG.gridBtn, btn('camera', 'Export frame (PNG)', function () { C.Export.frame(); }), resSel, zoomSel,
      btn('fullscreen', 'Full-screen preview', function () { PG.fullscreen(); }),
      PG.moreBtn = btn('more', 'More display options', function (e, b2) {
        var r = b2.getBoundingClientRect();
        C.ui.menu([
          { label: 'Loop Playback', checked: C.Engine.loop, action: function () { C.CMD.run('loop'); } },
          { label: 'Safe Margins', checked: PG.safe, action: function () { PG.toggle('safe'); } },
          { label: 'Grid', checked: PG.grid, action: function () { PG.toggle('grid'); } },
          { label: 'Multicam Grid View', kbd: C.CMD.keyLabel('mcGrid'), checked: !!(C.Multicam && C.Multicam.gridOn), disabled: !(P.seq() && P.seq().multicam), action: function () { C.Multicam.toggleGrid(); } }, '-',
          { label: 'Zoom', sub: [['fit', 'Fit'], ['0.25', '25%'], ['0.5', '50%'], ['1', '100%'], ['2', '200%']].map(function (o) { return { label: o[1], checked: PG.zoom === o[0], action: function () { PG.zoom = o[0]; zoomSel.value = o[0]; PG.layout(); } }; }) },
          { label: 'Playback Resolution', sub: [['auto', 'Auto'], [1, 'Full'], [0.5, '1/2'], [0.25, '1/4']].map(function (o) { return { label: o[1], checked: C.prefs.playbackRes == o[0], action: function () { C.prefs.playbackRes = o[0]; C.savePrefs(); resSel.value = String(o[0]); C.Engine.requestRender(); } }; }) }, '-',
          { label: 'Add Marker', kbd: 'M', action: function () { C.state.focus = 'program'; C.A.addMarker(); } },
          { label: 'Export Frame (PNG)', action: function () { C.Export.frame(); } }], r.left, r.bottom + 2);
      }), PG.dur);
    PG.moreBtn.classList.add('opt-more');
    [PG.safeBtn, PG.gridBtn, zoomSel].forEach(function (x) { x.classList.add('opt-a'); });
    U.$$('button', bar).forEach(function (b2) { var t = b2.getAttribute('data-tip') || ''; if (/^Mark|^Add marker|^Previous edit|^Next edit|^Export frame/.test(t)) b2.classList.add('opt-c'); });
    [PG.loopBtn, resSel].forEach(function (x) { x.classList.add('opt-b'); });
    PG.shuttleInd.classList.add('opt-c');
    panel.appendChild(h('div.monitor', PG.view, PG.scrub, bar));
    tcEditable(PG.tc, function () { return C.Engine.fps(); }, function () { return C.Engine.frame; }, function (f) { C.Engine.seek(f); });
    panel.addEventListener('pointerdown', function () { C.state.focus = 'program'; });
    PG.scrub.addEventListener('pointerdown', function (e) {
      var s = P.seq(); if (!s) return;
      var r = PG.scrub.getBoundingClientRect(), dur = Math.max(1, P.seqDuration(s));
      function at(ev) { var k = U.clamp((ev.clientX - r.left - 10) / (r.width - 20), 0, 1); C.Engine.seek(Math.round(k * dur), { scrub: true }); }
      if (C.Engine.playing) C.Engine.pause();
      at(e); U.drag(e, function (dx, dy, ev) { at(ev); });
    });
    new ResizeObserver(function () { PG.layout(); }).observe(PG.view);
    C.bus.on('playhead', PG.updateTime);
    C.bus.on('changed', function () { PG.updateTime(); PG.drawOverlay(); PG.title.textContent = P.seq() ? P.seq().name : ''; });
    C.bus.on('sequence', function () { PG.layout(); });
    C.bus.on('rendered', function () { PG.drawOverlay(); });
    C.bus.on('selection', function () { PG.drawOverlay(); });
    C.bus.on('state', function () { PG.loopBtn.classList.toggle('active', C.Engine.loop); });
    C.bus.on('transport', function (t) {
      PG.playBtn.innerHTML = C.icon(t.playing ? 'pause' : 'play');
      PG.shuttleInd.textContent = t.playing && t.rate !== 1 ? (t.rate > 0 ? '▶' : '◀') + Math.abs(t.rate) + '×' : '';
    });
    C.bus.on('prefs', function () { resSel.value = String(C.prefs.playbackRes); });
    PG.initInteraction();
    // file drop onto program = import + append? keep import only
    C.ui.fileDrop(PG.view, function (files) { C.Media.importFiles(files); });
  };
  PG.layout = function () {
    var s = P.seq(); if (!s) return;
    PG.k = fitStage(PG.view, PG.stage, s.w, s.h, PG.zoom);
    PG.title.textContent = s.name;
    PG.drawOverlay(); PG.updateTime();
    if (C.prefs.playbackRes === 'auto') C.Engine.requestRender();
  };
  PG.toggle = function (k) { PG[k] = !PG[k]; PG.safeBtn.classList.toggle('active', PG.safe); PG.gridBtn.classList.toggle('active', PG.grid); PG.drawOverlay(); };
  PG.fullscreen = function () {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    var req = PG.view.requestFullscreen || PG.view.webkitRequestFullscreen;
    if (req) req.call(PG.view).then(function () { setTimeout(PG.layout, 100); }).catch(function () { C.toast('Full screen not available'); });
  };
  document.addEventListener('fullscreenchange', function () { setTimeout(function () { if (C.Program.view) C.Program.layout(); }, 60); });
  PG.updateTime = function () {
    var s = P.seq(); if (!s) return;
    var f = C.Engine.frame, dur = P.seqDuration(s);
    PG.tc.textContent = U.fmtTC(f, s.fps);
    PG.dur.textContent = U.fmtTC(s.inF != null && s.outF != null ? s.outF - s.inF : dur, s.fps);
    var mk = s.markers.map(function (m) { return { t: m.f, color: m.color }; });
    drawScrub(PG.scrubCv, { dur: Math.max(1, dur), t: f, inT: s.inF, outT: s.outF, markers: mk });
  };

  /* ---------- Overlay & on-canvas transform ---------- */
  function selVisualClip() {
    var s = P.seq(), c = P.primaryClip();
    if (!s || !c || c.kind !== 'video') return null;
    var f = C.Engine.frame;
    if (f < c.start || f >= c.start + c.dur) return null;
    var m = P.media(c.mediaId); if (!m) return null;
    if (m.type === 'gen' && m.gen.kind === 'adjust') return null;
    return c;
  }
  function layerFor(c) { var s = P.seq(); return C.Scene.clipLayer(s, c, C.Engine.frame, {}); }
  function toScreen(p) { return [p[0] * PG.sk, p[1] * PG.sk]; }
  PG.drawOverlay = function () {
    var s = P.seq(), cv = PG.overlay; if (!s || !cv) return;
    var dpr = window.devicePixelRatio || 1, W = PG.stage.clientWidth, H = PG.stage.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    PG.sk = W / s.w;
    if (C.Multicam && C.Multicam.drawGridOverlay(g, s, W, H)) return;
    if (PG.grid) {
      g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 1; g.beginPath();
      for (var i = 1; i < 3; i++) { g.moveTo(W * i / 3 + .5, 0); g.lineTo(W * i / 3 + .5, H); g.moveTo(0, H * i / 3 + .5); g.lineTo(W, H * i / 3 + .5); }
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.08)'; g.beginPath();
      for (i = 1; i < 12; i++) { if (i % 4 === 0) continue; g.moveTo(W * i / 12 + .5, 0); g.lineTo(W * i / 12 + .5, H); g.moveTo(0, H * i / 12 + .5); g.lineTo(W, H * i / 12 + .5); }
      g.stroke();
    }
    if (PG.safe) {
      g.strokeStyle = 'rgba(240,145,58,.7)'; g.setLineDash([5, 4]); g.lineWidth = 1;
      g.strokeRect(W * 0.05 + .5, H * 0.05 + .5, W * 0.9, H * 0.9);
      g.strokeStyle = 'rgba(61,191,174,.7)'; g.strokeRect(W * 0.1 + .5, H * 0.1 + .5, W * 0.8, H * 0.8);
      g.setLineDash([]);
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.moveTo(W / 2 - 10, H / 2); g.lineTo(W / 2 + 10, H / 2); g.moveTo(W / 2, H / 2 - 10); g.lineTo(W / 2, H / 2 + 10); g.stroke();
    }
    if (!s.clips.length) {
      g.fillStyle = 'rgba(200,189,177,.45)'; g.font = '12px Segoe UI, sans-serif'; g.textAlign = 'center';
      g.fillText('Empty sequence', W / 2, H / 2 - 6); g.fillStyle = 'rgba(200,189,177,.3)'; g.fillText(s.w + ' × ' + s.h + '  ·  ' + s.fps + ' fps', W / 2, H / 2 + 12);
      g.textAlign = 'left';
    }
    var c = selVisualClip();
    if (!c) return;
    var L = layerFor(c), q = C.Scene.quad(s, L);
    var pts = q.full.map(toScreen);
    g.strokeStyle = '#f0913a'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (i = 1; i < 4; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); g.stroke();
    // handles: corners + edge midpoints
    PG.handles = [];
    var hp = [];
    for (i = 0; i < 4; i++) { hp.push({ p: pts[i], kind: 'corner', i: i }); var n = pts[(i + 1) % 4]; hp.push({ p: [(pts[i][0] + n[0]) / 2, (pts[i][1] + n[1]) / 2], kind: 'edge', i: i }); }
    hp.forEach(function (hd) { g.fillStyle = '#1c1916'; g.strokeStyle = '#ffad62'; g.lineWidth = 1.5; g.fillRect(hd.p[0] - 4, hd.p[1] - 4, 8, 8); g.strokeRect(hd.p[0] - 4, hd.p[1] - 4, 8, 8); });
    // rotation handle: above top edge midpoint
    var tm = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
    var ang = L.tf.rot * Math.PI / 180, flipY = q.sy < 0 ? -1 : 1;
    var rh = [tm[0] + Math.sin(ang) * 26 * flipY, tm[1] - Math.cos(ang) * 26 * flipY];
    g.strokeStyle = '#ffad62'; g.beginPath(); g.moveTo(tm[0], tm[1]); g.lineTo(rh[0], rh[1]); g.stroke();
    g.beginPath(); g.arc(rh[0], rh[1], 5, 0, Math.PI * 2); g.fillStyle = '#3dbfae'; g.fill(); g.stroke();
    // anchor
    var a = toScreen(q.anchor);
    g.strokeStyle = '#3dbfae'; g.beginPath(); g.arc(a[0], a[1], 5, 0, Math.PI * 2); g.moveTo(a[0] - 8, a[1]); g.lineTo(a[0] + 8, a[1]); g.moveTo(a[0], a[1] - 8); g.lineTo(a[0], a[1] + 8); g.stroke();
    hp.push({ p: rh, kind: 'rot' });
    PG.handles = hp;
    PG.maskHandles = [];
    if (c.masks && c.masks.length) drawMasks(g, s, c, L);
    // title layers outline (mapped through the clip's own transform)
    if (c.gen && c.gen.kind === 'title') {
      g.setLineDash([3, 3]);
      (c.gen.layers || []).forEach(function (Ly) {
        if (Ly.hidden) return;
        var poly = layerPoly(s, L, titleLayerBounds(s, c, Ly)).map(toScreen);
        g.strokeStyle = PG.selLayer === Ly.id ? 'rgba(255,173,98,.95)' : 'rgba(61,191,174,.6)';
        g.beginPath(); g.moveTo(poly[0][0], poly[0][1]); for (var k = 1; k < 4; k++) g.lineTo(poly[k][0], poly[k][1]); g.closePath(); g.stroke();
      });
      g.setLineDash([]);
    }
  };
  /* ---------- masks: outlines, handles, pen drawing ---------- */
  function maskNatural(s, L) { var ns = C.Scene.naturalSize(s, L); return ns; }
  function drawMasks(g, s, c, L) {
    var ns = maskNatural(s, L), nw = ns[0], nh = ns[1], lf = U.clamp(C.Engine.frame - c.start, 0, c.dur - 1);
    var ev = C.Masks.eval(c, lf);
    ev.forEach(function (m) {
      var sel = m.id === PG.selMask;
      var poly = C.Masks.outline(m, nw, nh).map(function (pt) { return toScreen(C.Scene.mapPoint(s, L, pt[0], pt[1])); });
      if (poly.length >= 2) {
        g.setLineDash(sel ? [] : [4, 3]); g.strokeStyle = sel ? '#5aa9e6' : 'rgba(90,169,230,.6)'; g.lineWidth = sel ? 1.5 : 1;
        g.beginPath(); poly.forEach(function (pt, i) { if (i) g.lineTo(pt[0], pt[1]); else g.moveTo(pt[0], pt[1]); });
        if (m.type !== 'path' || !PG.pen || PG.pen.maskId !== m.id) g.closePath();
        g.stroke(); g.setLineDash([]);
      }
      if (!sel) return;
      var hs = [];
      if (m.type === 'path') {
        var xf = C.Masks.pathXform(m, nw, nh);
        (m.pts || []).forEach(function (pt, i) { var q = xf.fwd(pt); hs.push({ p: toScreen(C.Scene.mapPoint(s, L, q[0], q[1])), kind: 'pt', i: i, mask: m.id }); });
        if ((m.pts || []).length >= 3 && !(PG.pen && PG.pen.maskId === m.id)) {
          hs.push({ p: toScreen(C.Scene.mapPoint(s, L, xf.centre[0], xf.centre[1])), kind: 'center', mask: m.id });
          hs.push({ p: toScreen(C.Scene.mapPoint(s, L, xf.centre[0], xf.centre[1] - 30 / (PG.sk * Math.abs(C.Scene.quad(s, L).sy || 1)))), kind: 'mrot', mask: m.id });
        }
      } else {
        var cx = m.cx / 100 * nw, cy = m.cy / 100 * nh, hw = m.w / 200 * nw, hh = m.h / 200 * nh, a = (m.rot || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
        var at = function (dx, dy) { return toScreen(C.Scene.mapPoint(s, L, cx + dx * ca - dy * sa, cy + dx * sa + dy * ca)); };
        hs.push({ p: at(0, 0), kind: 'center', mask: m.id });
        hs.push({ p: at(hw, 0), kind: 'w', mask: m.id }, { p: at(-hw, 0), kind: 'w', mask: m.id, neg: true }, { p: at(0, hh), kind: 'h', mask: m.id }, { p: at(0, -hh), kind: 'h', mask: m.id, neg: true });
        hs.push({ p: at(0, -hh - 22 / (PG.sk * Math.abs(C.Scene.quad(s, L).sy || 1))), kind: 'mrot', mask: m.id });
      }
      hs.forEach(function (hd) {
        g.fillStyle = hd.kind === 'mrot' ? '#5aa9e6' : '#1c1916'; g.strokeStyle = '#5aa9e6'; g.lineWidth = 1.5;
        if (hd.kind === 'center' || hd.kind === 'mrot') { g.beginPath(); g.arc(hd.p[0], hd.p[1], 4.5, 0, Math.PI * 2); g.fill(); g.stroke(); }
        else { g.fillRect(hd.p[0] - 4, hd.p[1] - 4, 8, 8); g.strokeRect(hd.p[0] - 4, hd.p[1] - 4, 8, 8); }
      });
      PG.maskHandles = PG.maskHandles.concat(hs);
    });
    if (PG.pen) { g.fillStyle = 'rgba(20,18,16,.8)'; g.font = '11px Segoe UI, sans-serif'; var tw = g.measureText('Pen: click to add points · double-click or Enter to finish · Esc cancels').width; g.fillRect(8, 8, tw + 12, 20); g.fillStyle = '#f2ebe3'; g.textBaseline = 'middle'; g.fillText('Pen: click to add points · double-click or Enter to finish · Esc cancels', 14, 18); }
  }
  // set a mask parameter at the current frame (keyframe-aware)
  function setMaskParam(cc, mid, k, v, lf) { KF.setAt(cc, 'mk.' + mid + '.' + k, lf, v); var m = C.Masks.byId(cc, mid); if (m && !KF.has(cc, 'mk.' + mid + '.' + k)) m[k] = v; }
  function dragMask(e, c, hd, L, sx0, sy0) {
    var s = P.seq(), id = c.id, mid = hd.mask, lf = U.clamp(C.Engine.frame - c.start, 0, c.dur - 1), moved = false;
    var ns = maskNatural(s, L), nw = ns[0], nh = ns[1];
    var m0 = C.Masks.eval(c, lf).filter(function (m) { return m.id === mid; })[0]; if (!m0) return;
    var u0 = C.Scene.unmapPoint(s, L, sx0, sy0), cx0 = m0.cx / 100 * nw, cy0 = m0.cy / 100 * nh;
    var xf0 = m0.type === 'path' ? C.Masks.pathXform(m0, nw, nh) : null;
    if (xf0) { cx0 = xf0.centre[0]; cy0 = xf0.centre[1]; }
    var a0 = Math.atan2(u0[1] - cy0, u0[0] - cx0), animPts = m0.type === 'path' && C.Masks.pointsAnimated(c, mid);
    if (e.altKey && hd.kind === 'pt') { // remove a point
      C.edit('Remove Mask Point', function (s2) {
        var cc2 = P.clip(s2, id), m = C.Masks.byId(cc2, mid); if (!m) return;
        if (m.pts.length <= 3) { C.toast('A path needs at least 3 points'); return; }
        var anim = C.Masks.pointsAnimated(cc2, mid); if (anim) C.Masks.animatePoints(cc2, mid, false, lf);
        m.pts.splice(hd.i, 1);
        if (anim) C.Masks.animatePoints(cc2, mid, true, lf);
      });
      return;
    }
    U.drag(e, function (dx, dy, ev) {
      var cc = P.clip(P.seq(), id); if (!cc) return;
      var m = C.Masks.byId(cc, mid); if (!m) return;
      var u = C.Scene.unmapPoint(s, L, sx0 + dx / PG.sk, sy0 + dy / PG.sk), du = [u[0] - u0[0], u[1] - u0[1]];
      moved = true;
      if (hd.kind === 'pt') {
        // the point is dragged in the mask's transformed space; store it untransformed
        var q0 = xf0.fwd(m0.pts[hd.i]), np = xf0.inv(q0[0] + du[0], q0[1] + du[1]);
        np = [U.round(U.clamp(np[0], -100, 200), 2), U.round(U.clamp(np[1], -100, 200), 2)];
        if (animPts) C.Masks.setPointAt(cc, mid, hd.i, lf, np); else m.pts[hd.i] = np;
      }
      else if (hd.kind === 'center') { setMaskParam(cc, mid, 'cx', U.round(m0.cx + du[0] / nw * 100, 2), lf); setMaskParam(cc, mid, 'cy', U.round(m0.cy + du[1] / nh * 100, 2), lf); }
      else if (hd.kind === 'mrot') { var a = Math.atan2(u[1] - cy0, u[0] - cx0), deg = m0.rot + (a - a0) * 180 / Math.PI; if (ev.shiftKey) deg = Math.round(deg / 15) * 15; setMaskParam(cc, mid, 'rot', U.round(((deg + 180) % 360 + 360) % 360 - 180, 1), lf); }
      else { // w / h handles: project the pointer onto the mask's local axis
        var a2 = (m0.rot || 0) * Math.PI / 180, lx = (u[0] - cx0) * Math.cos(-a2) - (u[1] - cy0) * Math.sin(-a2), ly = (u[0] - cx0) * Math.sin(-a2) + (u[1] - cy0) * Math.cos(-a2);
        if (hd.kind === 'w') setMaskParam(cc, mid, 'w', U.round(U.clamp(Math.abs(lx) * 2 / nw * 100, 0, 200), 2), lf);
        else setMaskParam(cc, mid, 'h', U.round(U.clamp(Math.abs(ly) * 2 / nh * 100, 0, 200), 2), lf);
        if (ev.shiftKey) { var m2 = C.Masks.byId(cc, mid); setMaskParam(cc, mid, hd.kind === 'w' ? 'h' : 'w', hd.kind === 'w' ? m2.w * nw / nh : m2.h * nh / nw, lf); }
      }
      C.live(); C.bus.emit('inspector:refresh');
    }, function () { if (moved) C.commit('Edit Mask'); });
  }
  // pen: add points to a path mask by clicking on the monitor
  // one-shot colour pick on the Program monitor: fn([r,g,b] 0..1 or null, fx, fy)
  PG.pickColor = function (fn, hint) { PG.pick = fn; PG.overlay.style.cursor = 'crosshair'; C.toast(hint || 'Click a point in the Program monitor'); };
  PG.beginPen = function (clipId, maskId) {
    PG.pen = { clipId: clipId, maskId: maskId };
    PG.selMask = maskId;
    PG.overlay.style.cursor = 'crosshair';
    C.toast('Pen mask: click on the Program monitor to place points, double-click or press Enter to finish');
    PG.drawOverlay();
  };
  PG.endPen = function (cancel) {
    var pen = PG.pen; if (!pen) return;
    PG.pen = null; PG.overlay.style.cursor = '';
    var s = P.seq(), c = s && P.clip(s, pen.clipId), m = c && C.Masks.byId(c, pen.maskId);
    if (m && (cancel || (m.pts || []).length < 3)) {
      C.H.revertLive();
      var c2 = P.clip(P.seq(), pen.clipId), m2 = c2 && C.Masks.byId(c2, pen.maskId);
      if (m2 && (m2.pts || []).length < 3) { C.edit('Cancel Mask', function (s2) { var cc = P.clip(s2, pen.clipId); if (cc) cc.masks = (cc.masks || []).filter(function (x) { return x.id !== pen.maskId; }); }); if (C.Inspector.selMask === pen.maskId) C.Inspector.selectMask(null); }
      if (cancel) C.toast('Pen mask cancelled');
    } else C.commit('Draw Mask');
    PG.drawOverlay();
  };
  document.addEventListener('keydown', function (e) {
    if (!PG.pen) return;
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); PG.endPen(false); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); PG.endPen(true); }
  }, true);
  function penClick(e, sx, sy) {
    var pen = PG.pen, s = P.seq(), c = P.clip(s, pen.clipId); if (!c) { PG.pen = null; return; }
    var L = layerFor(c), ns = maskNatural(s, L), u = C.Scene.unmapPoint(s, L, sx, sy);
    var m = C.Masks.byId(c, pen.maskId); if (!m) { PG.pen = null; return; }
    var pt = [U.round(u[0] / ns[0] * 100, 2), U.round(u[1] / ns[1] * 100, 2)];
    // clicking the first point again closes the path
    if (m.pts.length >= 3) { var f0 = toScreen(C.Scene.mapPoint(s, L, m.pts[0][0] / 100 * ns[0], m.pts[0][1] / 100 * ns[1])), r = PG.overlay.getBoundingClientRect(); if (Math.hypot(f0[0] - (e.clientX - r.left), f0[1] - (e.clientY - r.top)) < 8) { PG.endPen(false); return; } }
    m.pts.push(pt);
    C.live(); C.bus.emit('inspector:refresh'); PG.drawOverlay();
  }
  // title layer bounds in the generator's own frame (= sequence size), honouring keyframed layer position
  function titleLayerBounds(s, c, Ly) {
    var lf = U.clamp(C.Engine.frame - c.start, 0, c.dur - 1), L2 = Ly;
    if (KF.has(c, 'tt.' + Ly.id + '.x') || KF.has(c, 'tt.' + Ly.id + '.y')) {
      L2 = Object.assign({}, Ly);
      if (KF.has(c, 'tt.' + Ly.id + '.x')) L2.x = KF.value(c, 'tt.' + Ly.id + '.x', lf);
      if (KF.has(c, 'tt.' + Ly.id + '.y')) L2.y = KF.value(c, 'tt.' + Ly.id + '.y', lf);
    }
    return C.Titles.layerBounds(L2, s.w, s.h, s.h > s.w ? 1080 : 1920);
  }
  function layerPoly(s, L, b) {
    return [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(function (pt) { return C.Scene.mapPoint(s, L, pt[0], pt[1]); });
  }
  // topmost title layer under a sequence-space point (pad in generator px)
  function titleLayerAt(s, c, sx, sy, pad, textOnly) {
    var L = layerFor(c), u = C.Scene.unmapPoint(s, L, sx, sy);
    return c.gen.layers.slice().reverse().filter(function (Ly) {
      if (Ly.hidden || (textOnly && Ly.type !== 'text')) return false;
      var b = titleLayerBounds(s, c, Ly);
      return u[0] >= b.x - pad && u[0] <= b.x + b.w + pad && u[1] >= b.y - pad && u[1] <= b.y + b.h + pad;
    })[0] || null;
  }
  function pointInQuad(pt, q) {
    var inside = false;
    for (var i = 0, j = 3; i < 4; j = i++) {
      var xi = q[i][0], yi = q[i][1], xj = q[j][0], yj = q[j][1];
      if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  PG.initInteraction = function () {
    var ov = PG.overlay;
    ov.addEventListener('dblclick', function (e) {
      if (PG.pen) { PG.endPen(false); return; }
      var s0 = P.seq(), c0 = selVisualClip();
      if (s0 && c0 && c0.masks && PG.selMask) { // double-click on a path edge adds a point there
        var r0 = ov.getBoundingClientRect(), sx = (e.clientX - r0.left) / PG.sk, sy = (e.clientY - r0.top) / PG.sk;
        var m = C.Masks.byId(c0, PG.selMask);
        if (m && m.type === 'path' && m.pts.length >= 2) {
          var L0 = layerFor(c0), ns0 = maskNatural(s0, L0), u = C.Scene.unmapPoint(s0, L0, sx, sy), best = -1, bd = 1e9, lf0 = U.clamp(C.Engine.frame - c0.start, 0, c0.dur - 1);
          var mEv = C.Masks.eval(c0, lf0).filter(function (x) { return x.id === m.id; })[0] || m, xfA = C.Masks.pathXform(mEv, ns0[0], ns0[1]), pts = mEv.pts.map(xfA.fwd);
          for (var i = 0; i < pts.length; i++) { var a = pts[i], b2 = pts[(i + 1) % pts.length], vx = b2[0] - a[0], vy = b2[1] - a[1], t = U.clamp(((u[0] - a[0]) * vx + (u[1] - a[1]) * vy) / Math.max(1e-6, vx * vx + vy * vy), 0, 1), d = Math.hypot(a[0] + vx * t - u[0], a[1] + vy * t - u[1]); if (d < bd) { bd = d; best = i; } }
          if (best >= 0 && bd * PG.sk < 10) {
            var npt = xfA.inv(u[0], u[1]); npt = [U.round(npt[0], 2), U.round(npt[1], 2)];
            C.edit('Add Mask Point', function (s2) {
              var cc2 = P.clip(s2, c0.id), mm = C.Masks.byId(cc2, m.id); if (!mm) return;
              var anim = C.Masks.pointsAnimated(cc2, m.id); if (anim) C.Masks.animatePoints(cc2, m.id, false, lf0); // bake, insert, re-key
              mm.pts.splice(best + 1, 0, npt);
              if (anim) C.Masks.animatePoints(cc2, m.id, true, lf0);
            }); return;
          }
        }
      }
      var s = P.seq(), c = selVisualClip(); if (!s || !c || !c.gen || c.gen.kind !== 'title') return;
      var r = ov.getBoundingClientRect(), sx = (e.clientX - r.left) / PG.sk, sy = (e.clientY - r.top) / PG.sk;
      var Ly = titleLayerAt(s, c, sx, sy, 10, true);
      if (!Ly) return;
      PG.editText(c, Ly);
    });
    ov.addEventListener('pointermove', function (e) {
      if (e.buttons) return;
      var r = ov.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      var cur = C.state.tool === 'text' ? 'text' : PG.pen ? 'crosshair' : 'default';
      (PG.handles || []).forEach(function (hd) { if (Math.abs(hd.p[0] - x) < 7 && Math.abs(hd.p[1] - y) < 7) cur = hd.kind === 'rot' ? 'grab' : hd.kind === 'corner' ? 'nwse-resize' : 'move'; });
      (PG.maskHandles || []).forEach(function (hd) { if (Math.abs(hd.p[0] - x) < 7 && Math.abs(hd.p[1] - y) < 7) cur = hd.kind === 'mrot' ? 'grab' : hd.kind === 'center' || hd.kind === 'pt' ? 'move' : hd.kind === 'w' ? 'ew-resize' : 'ns-resize'; });
      var c = selVisualClip();
      if (cur === 'default' && c) { var q = C.Scene.quad(P.seq(), layerFor(c)); if (pointInQuad([x / PG.sk, y / PG.sk], q.full)) cur = 'move'; }
      ov.style.cursor = cur;
    });
    ov.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      var s = P.seq(); if (!s) return;
      if (PG.pick) { // colour picker (white balance etc.): sample the composed frame under the pointer
        var rp = ov.getBoundingClientRect(), fn = PG.pick; PG.pick = null; ov.style.cursor = '';
        var fx = (e.clientX - rp.left) / rp.width, fy = (e.clientY - rp.top) / rp.height;
        var sm = C.Engine.comp.readSmall ? C.Engine.comp.readSmall(256, Math.max(16, Math.round(256 * s.h / s.w))) : null;
        if (sm) { var sw2 = 256, sh2 = Math.max(16, Math.round(256 * s.h / s.w)), acc = [0, 0, 0], n = 0; // 5×5 average
          for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) { var xx = U.clamp(Math.round(fx * sw2) + dx, 0, sw2 - 1), yy = U.clamp(Math.round(fy * sh2) + dy, 0, sh2 - 1), i = (yy * sw2 + xx) * 4; acc[0] += sm[i]; acc[1] += sm[i + 1]; acc[2] += sm[i + 2]; n++; }
          fn(acc.map(function (v) { return v / n / 255; }), fx, fy);
        } else fn(null, fx, fy);
        return;
      }
      if (C.Multicam && C.Multicam.gridOn && s.multicam) { // grid view: clicking a cell cuts to that angle (also while playing)
        var rg = ov.getBoundingClientRect(), k = C.Multicam.gridHit(s, (e.clientX - rg.left) / rg.width, (e.clientY - rg.top) / rg.height);
        if (k) C.Multicam.switchAngle(k);
        return;
      }
      if (C.Engine.playing) C.Engine.pause();
      var r = ov.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      var sx = x / PG.sk, sy = y / PG.sk;
      if (PG.pen) { if (e.detail < 2) penClick(e, sx, sy); return; }
      if (C.state.tool === 'text') { C.A.addTitleAtPlayhead(sx, sy); C.A.setTool('select'); return; }
      var c = selVisualClip();
      var mh = null;
      (PG.maskHandles || []).forEach(function (hd) { if (Math.abs(hd.p[0] - x) < 7 && Math.abs(hd.p[1] - y) < 7) mh = hd; });
      if (c && mh) { dragMask(e, c, mh, layerFor(c), sx, sy); return; }
      var hit = null;
      (PG.handles || []).forEach(function (hd) { if (Math.abs(hd.p[0] - x) < 7 && Math.abs(hd.p[1] - y) < 7) hit = hd; });
      if (c) {
        var L = layerFor(c), q = C.Scene.quad(s, L);
        // title layer drag (hit-tested through the clip's transform)
        if (!hit && c.gen && c.gen.kind === 'title') {
          var Lh = titleLayerAt(s, c, sx, sy, 0, false);
          if (Lh) { dragTitleLayer(e, c, Lh, sx, sy); return; }
        }
        if (hit || pointInQuad([sx, sy], q.full)) { dragTransform(e, c, hit, L, q, sx, sy); return; }
      }
      // click-select topmost visible clip under pointer
      var scene = C.Scene.build(s, C.Engine.frame);
      var layersTop = scene.layers.slice().reverse();
      for (var i = 0; i < layersTop.length; i++) {
        var LL = layersTop[i]; if (LL.t !== 'clip' || LL.adjust) continue;
        var qq = C.Scene.quad(s, LL);
        if (pointInQuad([sx, sy], qq.full)) { C.A.select([LL.clip.id]); PG.drawOverlay(); return; }
      }
    });
  };
  // Inline text editing directly over the program monitor
  PG.editText = function (c, Ly) {
    var s = P.seq(), ref = s.h > s.w ? 1080 : 1920, L = layerFor(c);
    // screen-space bounding box of the (possibly transformed) layer
    var poly = layerPoly(s, L, titleLayerBounds(s, c, Ly));
    var xs = poly.map(function (q) { return q[0]; }), ys = poly.map(function (q) { return q[1]; });
    var b = { x: Math.min.apply(null, xs), y: Math.min.apply(null, ys), w: Math.max.apply(null, xs) - Math.min.apply(null, xs), h: Math.max.apply(null, ys) - Math.min.apply(null, ys) };
    var q0 = C.Scene.quad(s, L), ks = Math.abs(q0.sx) || 1;
    var ta = h('textarea', { style: { position: 'absolute', left: Math.max(0, b.x * PG.sk - 6) + 'px', top: Math.max(0, b.y * PG.sk - 6) + 'px', width: Math.max(160, b.w * PG.sk + 24) + 'px', height: Math.max(40, b.h * PG.sk + 16) + 'px',
      zIndex: 20, background: 'rgba(20,18,16,.85)', color: '#fff', border: '1px solid var(--accent)', font: Math.max(12, Ly.size * (s.w / ref) * ks * PG.sk * 0.9) + 'px ' + Ly.font, textAlign: Ly.align, resize: 'none' } });
    ta.value = Ly.text;
    PG.stage.appendChild(ta); ta.focus(); ta.select();
    var cid = c.id, lid = Ly.id, done = false;
    function fin(ok) {
      if (done) return; done = true; ta.remove();
      if (ok) C.edit('Edit Text', function (s2) { var cc = P.clip(s2, cid); var l = cc && cc.gen.layers.filter(function (x) { return x.id === lid; })[0]; if (!l || l.text === ta.value) return false; l.text = ta.value; });
    }
    ta.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Escape') fin(false); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) fin(true); });
    ta.addEventListener('blur', function () { fin(true); });
  };
  function dragTitleLayer(e, c, Ly, sx0, sy0) {
    PG.selLayer = Ly.id; C.bus.emit('titlelayer', Ly.id);
    var s = P.seq(), id = c.id, lid = Ly.id, moved = false, lfc = U.clamp(C.Engine.frame - c.start, 0, c.dur - 1);
    // current (possibly keyframed) layer position in %
    var x0 = KF.has(c, 'tt.' + lid + '.x') ? KF.value(c, 'tt.' + lid + '.x', lfc) : Ly.x;
    var y0 = KF.has(c, 'tt.' + lid + '.y') ? KF.value(c, 'tt.' + lid + '.y', lfc) : Ly.y;
    var lf = C.Engine.frame - c.start, L0 = layerFor(c), u0 = C.Scene.unmapPoint(s, L0, sx0, sy0);
    U.drag(e, function (dx, dy, ev) {
      var cc = P.clip(P.seq(), id); if (!cc) return;
      var L2 = cc.gen.layers.filter(function (l) { return l.id === lid; })[0]; if (!L2) return;
      // pointer delta measured in the title's own frame, so dragging follows a scaled/rotated clip
      var u1 = C.Scene.unmapPoint(s, L0, sx0 + dx / PG.sk, sy0 + dy / PG.sk);
      var nx = x0 + (u1[0] - u0[0]) / s.w * 100, ny = y0 + (u1[1] - u0[1]) / s.h * 100;
      if (!ev.shiftKey) { if (Math.abs(nx - 50) < 0.8) nx = 50; if (Math.abs(ny - 50) < 0.8) ny = 50; }
      KF.setAt(cc, 'tt.' + lid + '.x', lf, U.round(nx, 2)); KF.setAt(cc, 'tt.' + lid + '.y', lf, U.round(ny, 2));
      if (!KF.has(cc, 'tt.' + lid + '.x')) L2.x = U.round(nx, 2);
      if (!KF.has(cc, 'tt.' + lid + '.y')) L2.y = U.round(ny, 2);
      moved = true; C.live(); C.bus.emit('inspector:refresh');
    }, function () { if (moved) C.commit('Move Text'); });
  }
  function dragTransform(e, c, hit, L, q, sx0, sy0) {
    var s = P.seq(), id = c.id, lf = C.Engine.frame - c.start, tf0 = Object.assign({}, L.tf), moved = false;
    var center = [tf0.x, tf0.y];
    var d0 = Math.hypot(sx0 - center[0], sy0 - center[1]) || 1;
    var a0 = Math.atan2(sy0 - center[1], sx0 - center[0]);
    U.drag(e, function (dx, dy, ev) {
      var cc = P.clip(P.seq(), id); if (!cc) return;
      var sx = sx0 + dx / PG.sk, sy = sy0 + dy / PG.sk;
      if (!hit) {
        var nx = tf0.x + dx / PG.sk, ny = tf0.y + dy / PG.sk;
        if (!ev.shiftKey) { if (Math.abs(nx - s.w / 2) < 8 / PG.sk) nx = s.w / 2; if (Math.abs(ny - s.h / 2) < 8 / PG.sk) ny = s.h / 2; }
        KF.setAt(cc, 'tf.x', lf, U.round(nx, 1)); KF.setAt(cc, 'tf.y', lf, U.round(ny, 1));
      } else if (hit.kind === 'rot') {
        var a = Math.atan2(sy - center[1], sx - center[0]);
        var deg = tf0.rot + (a - a0) * 180 / Math.PI;
        if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
        KF.setAt(cc, 'tf.rot', lf, U.round(deg, 1));
      } else {
        var d = Math.hypot(sx - center[0], sy - center[1]);
        var k = d / d0;
        if (hit.kind === 'edge' && !cc.tf.uni) {
          // edge handles: non-uniform scale along local axis
          var ang = tf0.rot * Math.PI / 180, lx = (sx - center[0]) * Math.cos(-ang) - (sy - center[1]) * Math.sin(-ang), ly = (sx - center[0]) * Math.sin(-ang) + (sy - center[1]) * Math.cos(-ang);
          var lx0 = (sx0 - center[0]) * Math.cos(-ang) - (sy0 - center[1]) * Math.sin(-ang), ly0 = (sx0 - center[0]) * Math.sin(-ang) + (sy0 - center[1]) * Math.cos(-ang);
          if (hit.i % 2 === 1) KF.setAt(cc, 'tf.sw', lf, U.round(Math.max(1, tf0.sw * Math.abs(lx / (lx0 || 1))), 1));
          else KF.setAt(cc, 'tf.sh', lf, U.round(Math.max(1, tf0.sh * Math.abs(ly / (ly0 || 1))), 1));
        } else {
          if (cc.tf.uni) KF.setAt(cc, 'tf.scale', lf, U.round(Math.max(1, tf0.scale * k), 1));
          else { KF.setAt(cc, 'tf.sw', lf, U.round(Math.max(1, tf0.sw * k), 1)); KF.setAt(cc, 'tf.sh', lf, U.round(Math.max(1, tf0.sh * k), 1)); }
        }
      }
      moved = true;
      C.live(); C.bus.emit('inspector:refresh');
    }, function () { if (moved) C.commit(hit ? (hit.kind === 'rot' ? 'Rotate' : 'Scale') : 'Move'); });
    void q;
  }
})();
