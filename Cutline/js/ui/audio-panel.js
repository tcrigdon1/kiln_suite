/* Cutline — Audio mixer panel: per-track faders, pan, mute/solo, meters, master. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, h = U.h, P = C.P;
  var AP = C.AudioPanel = { strips: [] };

  AP.init = function (pane) {
    AP.pane = pane;
    AP.box = h('div.mixer');
    AP.recBtn = h('button.btn.sm', { html: C.icon('mic') + '<span>Record Voiceover</span>', title: 'Record from the microphone into a new audio clip at the playhead' });
    AP.recBtn.querySelector('svg').setAttribute('style', 'width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:1.7');
    AP.recBtn.addEventListener('click', function () { if (AP.rec) AP.stopRec(); else AP.startRec(); });
    AP.playChk = h('input', { type: 'checkbox', checked: true });
    AP.recStatus = h('span.muted', { style: { fontSize: '11px' } }, '');
    pane.appendChild(h('div.pane-toolbar', AP.recBtn, h('label.cl-check', { style: { margin: 0 } }, AP.playChk, h('span', 'Play timeline while recording')), AP.recStatus));
    pane.appendChild(AP.box);
    pane.appendChild(h('div.fxb-hint', 'Track faders & pan affect playback and export. Clip volume, pan, fades and audio effects are in the Inspector.'));
    C.bus.on('changed', function (x) { if (!x || !x.live) AP.render(); });
    C.bus.on('sequence', AP.render);
    C.bus.on('tracks', AP.render);
    loop();
    AP.render();
  };
  function strip(name, opts) {
    var meter = h('canvas.meter');
    var fader = h('input.fader', { type: 'range', min: -60, max: 12, step: 0.1, value: opts.vol, title: name + ' volume' });
    var db = h('div.db', fmt(opts.vol));
    fader.addEventListener('input', function () { db.textContent = fmt(+fader.value); opts.onVol(+fader.value, true); });
    fader.addEventListener('change', function () { opts.onVol(+fader.value, false); });
    fader.addEventListener('dblclick', function () { fader.value = 0; db.textContent = fmt(0); opts.onVol(0, false); });
    var el = h('div.strip' + (opts.master ? '.master' : ''), h('div.sname', name));
    if (opts.onPan) {
      var pan = h('input.pan', { type: 'range', min: -100, max: 100, step: 1, value: opts.pan, title: 'Pan' });
      pan.addEventListener('input', function () { opts.onPan(+pan.value, true); });
      pan.addEventListener('change', function () { opts.onPan(+pan.value, false); });
      pan.addEventListener('dblclick', function () { pan.value = 0; opts.onPan(0, false); });
      el.appendChild(pan);
    }
    el.appendChild(h('div.fader-wrap', fader, meter));
    el.appendChild(db);
    if (opts.btns) el.appendChild(opts.btns);
    AP.strips.push({ el: el, meter: meter, id: opts.id, peak: -96, hold: -96, holdT: 0 });
    return el;
  }
  AP.startRec = function () {
    if (!C.state.project) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { C.toast('Microphone recording is not available in this browser'); return; }
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).then(function (stream) {
      var type = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
      var rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined), parts = [];
      var startF = C.Engine.frame, t0 = performance.now();
      rec.ondataavailable = function (e) { if (e.data && e.data.size) parts.push(e.data); };
      rec.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        if (C.Engine.playing) C.Engine.pause();
        AP.rec = null; AP.recBtn.classList.remove('primary'); AP.recBtn.lastChild.textContent = 'Record Voiceover'; AP.recStatus.textContent = '';
        var n = C.state.project.media.filter(function (m) { return /^Voiceover/.test(m.name); }).length + 1;
        var file = new File(parts, 'Voiceover ' + n + '.webm', { type: (type || 'audio/webm').split(';')[0], lastModified: Date.now() });
        C.Media.importFiles([file]).then(function (ms) {
          if (!ms.length) return;
          var made;
          C.edit('Record Voiceover', function (s2) {
            var len = Math.max(1, Math.round(ms[0].duration * s2.fps));
            var tr = P.atracks(s2).filter(function (t) { return !t.lock && !s2.clips.some(function (c) { return c.trackId === t.id && c.start < startF + len && c.start + c.dur > startF; }); })[0];
            if (!tr) { tr = P.newTrack('audio'); s2.tracks.push(tr); }
            made = C.T.placeMedia(s2, ms[0], startF, null, tr.id, 'overwrite');
          });
          C.bus.emit('tracks');
          if (made) C.A.select(made.map(function (c) { return c.id; }));
        });
      };
      rec.start(250);
      AP.rec = rec;
      AP.recBtn.classList.add('primary'); AP.recBtn.lastChild.textContent = 'Stop Recording';
      AP.recTimer = setInterval(function () { if (!AP.rec) { clearInterval(AP.recTimer); return; } AP.recStatus.textContent = '● REC ' + U.fmtDur((performance.now() - t0) / 1000); }, 250);
      if (AP.playChk.checked) C.Engine.play(1);
    }).catch(function (e) { C.toast('Microphone unavailable: ' + e.message); });
  };
  AP.stopRec = function () { if (AP.rec && AP.rec.state !== 'inactive') AP.rec.stop(); };
  function fmt(v) { return (v > 0 ? '+' : '') + v.toFixed(1); }
  AP.render = function () {
    U.clear(AP.box); AP.strips = [];
    var s = P.seq(); if (!s) return;
    P.atracks(s).forEach(function (t) {
      var lab = P.trackLabel(s, t);
      var m = h('button.tbtn.mute' + (t.mute ? '.on' : ''), 'M'), so = h('button.tbtn.solo' + (t.solo ? '.on' : ''), 'S');
      m.addEventListener('click', function () { C.edit('Mute Track', function (s2) { var x = P.track(s2, t.id); x.mute = !x.mute; }); C.bus.emit('tracks'); });
      so.addEventListener('click', function () { C.edit('Solo Track', function (s2) { var x = P.track(s2, t.id); x.solo = !x.solo; }); C.bus.emit('tracks'); });
      AP.box.appendChild(strip(lab, {
        id: t.id, vol: t.vol || 0, pan: t.pan || 0, btns: h('div.sbtns', m, so),
        onVol: function (v, live) { var x = P.track(P.seq(), t.id); if (!x) return; x.vol = v; C.Mixer.updateTracks(P.seq()); if (!live) C.commit('Track Volume'); },
        onPan: function (v, live) { var x = P.track(P.seq(), t.id); if (!x) return; x.pan = v; C.Mixer.updateTracks(P.seq()); if (!live) C.commit('Track Pan'); }
      }));
    });
    var ms = strip('MASTER', { id: 'master', master: true, vol: s.masterVol || 0,
      onVol: function (v, live) { var sq = P.seq(); sq.masterVol = v; C.Mixer.updateTracks(sq); if (!live) C.commit('Master Volume'); } });
    // master limiter: look-ahead peak limiter on the mix (playback and export)
    var ml = s.masterLimit || { on: false, ceil: -1, rel: 120 };
    var limChk = h('input', { type: 'checkbox', checked: !!ml.on, title: 'Master limiter: keeps the mix peaks under the ceiling (look-ahead, 5 ms)' });
    var ceil = h('input', { type: 'number', min: -12, max: 0, step: 0.1, value: ml.ceil == null ? -1 : ml.ceil, title: 'Ceiling (dBFS)', style: { width: '52px' } });
    ceil.addEventListener('keydown', function (e) { e.stopPropagation(); });
    function setLim(live) { var sq = P.seq(); sq.masterLimit = { on: limChk.checked, ceil: U.clamp(+ceil.value || 0, -12, 0), rel: ml.rel || 120 }; C.Mixer.updateTracks(sq); if (!live) C.commit('Master Limiter'); }
    limChk.addEventListener('change', function () { setLim(false); });
    ceil.addEventListener('input', function () { setLim(true); }); ceil.addEventListener('change', function () { setLim(false); });
    ms.appendChild(h('div.lim-row', h('label.cl-check', { style: { margin: 0 } }, limChk, h('span', 'Limit')), h('div.row', ceil, h('span.muted', 'dB'))));
    AP.box.appendChild(ms);
  };
  function loop() {
    requestAnimationFrame(loop);
    if (!AP.visible || !AP.strips.length) return;
    var lv = C.Mixer.levels(P.seq()), now = performance.now();
    AP.strips.forEach(function (st) {
      var v = 0;
      if (lv) { var a = st.id === 'master' ? lv.master : lv.tracks[st.id]; if (a) v = Math.max(a[0], a[1]); }
      var db = U.gainToDb(v);
      st.peak = db > st.peak ? db : Math.max(db, st.peak - 1.2);
      if (st.peak > st.hold || now - st.holdT > 1500) { st.hold = st.peak; st.holdT = now; }
      var cv = st.meter, dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
      if (!W || !H) return;
      if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#0a0908'; g.fillRect(0, 0, W, H);
      var Y = function (d) { return H * (1 - U.clamp((d + 60) / 66, 0, 1)); };
      var grd = g.createLinearGradient(0, H, 0, 0);
      grd.addColorStop(0, '#3dbfae'); grd.addColorStop(0.62, '#8fcf6a'); grd.addColorStop(0.82, '#e2b93d'); grd.addColorStop(0.92, '#f0913a'); grd.addColorStop(1, '#e5534b');
      g.fillStyle = grd; var y = Y(st.peak); g.fillRect(1, y, W - 2, H - y);
      g.fillStyle = st.hold > -0.5 ? '#e5534b' : '#f2ebe3'; g.fillRect(1, Y(st.hold), W - 2, 1.5);
    });
  }
})();
