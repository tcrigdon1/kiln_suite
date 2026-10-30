/* Cutline — export: WebCodecs (VideoEncoder/AudioEncoder) + own WebM/MP4 muxers (frame-exact, faster than real time),
   MediaRecorder real-time fallback, WAV mixdown, PNG frame and SRT captions. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, h = U.h, P = C.P;
  var X = C.Export = {};

  X.FORMATS = [
    { id: 'webm-vp9', name: 'WebM — VP9 video + Opus audio', ext: 'webm', container: 'webm', vcodec: 'vp9', acodec: 'opus' },
    { id: 'webm-vp8', name: 'WebM — VP8 video + Opus audio', ext: 'webm', container: 'webm', vcodec: 'vp8', acodec: 'opus' },
    { id: 'mp4-h264', name: 'MP4 — H.264 video + AAC audio', ext: 'mp4', container: 'mp4', vcodec: 'avc', acodec: 'aac' },
    { id: 'mp4-vp9', name: 'MP4 — VP9 video + Opus audio', ext: 'mp4', container: 'mp4', vcodec: 'vp9', acodec: 'opus' },
    { id: 'mp4-hevc', name: 'MP4 — H.265/HEVC video + AAC audio', ext: 'mp4', container: 'mp4', vcodec: 'hevc', acodec: 'aac', optional: true },
    { id: 'mp4-av1', name: 'MP4 — AV1 video + Opus audio', ext: 'mp4', container: 'mp4', vcodec: 'av1', acodec: 'opus', optional: true },
    { id: 'webm-av1', name: 'WebM — AV1 video + Opus audio', ext: 'webm', container: 'webm', vcodec: 'av1', acodec: 'opus', optional: true },
    { id: 'wav', name: 'WAV — audio only (PCM)', ext: 'wav', audioOnly: true },
    { id: 'webm-opus', name: 'WebM — audio only (Opus)', ext: 'webm', container: 'webm', acodec: 'opus', audioOnly: true },
    { id: 'gif', name: 'GIF — animated image (short ranges)', ext: 'gif', image: true, noAudio: true },
    { id: 'png-seq', name: 'PNG sequence (ZIP of numbered frames)', ext: 'zip', image: true, noAudio: true }
  ];
  X.RATE_MODES = [['variable', 'Constrained VBR (default)'], ['constant', 'Constant bitrate']];
  // one-click delivery presets (the format falls back to WebM VP9 when the preferred encoder is missing)
  X.PRESETS = [
    { id: 'yt1080', name: 'YouTube 1080p', format: 'mp4-h264', fallback: 'webm-vp9', w: 1920, h: 1080, quality: 'high', abitrate: 192000, audio: true },
    { id: 'yt4k', name: 'YouTube 4K', format: 'mp4-h264', fallback: 'webm-vp9', w: 3840, h: 2160, quality: 'high', abitrate: 256000, audio: true },
    { id: 'shorts', name: 'Vertical short (1080×1920)', format: 'mp4-h264', fallback: 'webm-vp9', w: 1080, h: 1920, quality: 'high', abitrate: 192000, audio: true, fit: 'vertical' },
    { id: 'podcast', name: 'Podcast audio (Opus)', format: 'webm-opus', abitrate: 128000, audio: true },
    { id: 'podcastwav', name: 'Podcast master (WAV)', format: 'wav', audio: true },
    { id: 'gif', name: 'GIF (480p, 15 fps)', format: 'gif', w: 854, h: 480, fps: 15 }
  ];
  X.QUALITY = [['low', 'Low (small file)', 0.045], ['medium', 'Medium', 0.09], ['high', 'High', 0.16], ['max', 'Very High', 0.28]];

  function avcLevel(w, h2, fps) {
    var mbs = Math.ceil(w / 16) * Math.ceil(h2 / 16), rate = mbs * fps;
    if (mbs <= 3600 && rate <= 108000) return '1f';
    if (mbs <= 8192 && rate <= 245760) return '28';
    if (mbs <= 8704 && rate <= 522240) return '2a';
    if (mbs <= 22080 && rate <= 983040) return '33';
    return '34';
  }
  X.codecCandidates = function (vcodec, w, h2, fps) {
    if (vcodec === 'vp9') return ['vp09.00.41.08', 'vp09.00.51.08', 'vp09.00.31.08', 'vp09.00.10.08'];
    if (vcodec === 'vp8') return ['vp8'];
    if (vcodec === 'av1') return ['av01.0.08M.08', 'av01.0.12M.08', 'av01.0.05M.08', 'av01.0.01M.08'];
    if (vcodec === 'hevc') return ['hvc1.1.6.L123.B0', 'hvc1.1.6.L153.B0', 'hev1.1.6.L123.B0', 'hvc1.1.6.L93.B0'];
    var lv = avcLevel(w, h2, fps);
    return ['avc1.6400' + lv, 'avc1.4D00' + lv, 'avc1.42E0' + lv, 'avc1.640034', 'avc1.42001f'];
  };
  X.findVideoConfig = function (vcodec, w, h2, fps, bitrate, rateMode) {
    if (!window.VideoEncoder) return Promise.resolve(null);
    // GPU first (NVENC / Quick Sync / AMF), then the browser's software encoder, per Preferences ▸ Video codecs;
    // every codec string is tried at each acceleration level before moving down a level
    var accels = C.GPU ? C.GPU.encOrder() : ['no-preference'];
    var list = [];
    accels.forEach(function (a) { X.codecCandidates(vcodec, w, h2, fps).forEach(function (c) { list.push([c, a]); }); });
    var i = 0;
    function next() {
      if (i >= list.length) return Promise.resolve(null);
      var it = list[i++];
      var cfg = { codec: it[0], width: w, height: h2, bitrate: bitrate, framerate: fps, latencyMode: 'quality', hardwareAcceleration: it[1] };
      if (rateMode === 'constant' || rateMode === 'variable') cfg.bitrateMode = rateMode;
      if (vcodec === 'avc') cfg.avc = { format: 'avc' };
      if (vcodec === 'hevc') cfg.hevc = { format: 'hevc' };
      return VideoEncoder.isConfigSupported(cfg).then(function (r) { return r.supported ? cfg : next(); }).catch(next);
    }
    return next();
  };
  X.findAudioConfig = function (acodec, sr, ch, bitrate) {
    if (!window.AudioEncoder) return Promise.resolve(null);
    var cfg = { codec: acodec === 'aac' ? 'mp4a.40.2' : 'opus', sampleRate: sr, numberOfChannels: ch, bitrate: bitrate };
    return AudioEncoder.isConfigSupported(cfg).then(function (r) { return r.supported ? cfg : null; }).catch(function () { return null; });
  };
  X.probe = function () {
    var out = {};
    return Promise.all(X.FORMATS.map(function (f) {
      if (f.id === 'wav') { out[f.id] = { ok: true, method: 'offline' }; return; }
      if (f.image) { out[f.id] = { ok: true, method: 'frames' }; return; }
      var pv = f.vcodec ? X.findVideoConfig(f.vcodec, 1280, 720, 30, 4e6) : Promise.resolve(true);
      var pa = X.findAudioConfig(f.acodec, 48000, 2, 128000);
      return Promise.all([pv, pa]).then(function (r) {
        var mrType = f.container === 'webm' ? 'video/webm;codecs=' + (f.vcodec === 'vp8' ? 'vp8' : 'vp9') + ',opus' : 'video/mp4;codecs=avc1,mp4a';
        var mr = !f.optional && window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(f.audioOnly ? 'audio/webm;codecs=opus' : mrType);
        out[f.id] = { ok: !!r[0] || !!mr, webcodecs: !!r[0], audio: !!r[1], method: r[0] ? 'webcodecs' : (mr ? 'mediarecorder' : null), mrType: mr ? mrType : null };
      });
    })).then(function () { return out; });
  };

  function saveBlob(blob, name) {
    X.lastBlob = blob; X.lastName = name;
    if (window.showSaveFilePicker && !X.noPicker) {
      var ext = name.split('.').pop();
      var accept = {}; accept[blob.type || 'application/octet-stream'] = ['.' + ext];
      return window.showSaveFilePicker({ suggestedName: name, types: [{ description: ext.toUpperCase() + ' file', accept: accept }] }).then(function (fh) {
        return fh.createWritable().then(function (w) { return w.write(blob).then(function () { return w.close(); }); });
      }).then(function () { C.toast('Exported ' + name); return true; }).catch(function (e) {
        if (e && e.name === 'AbortError') return false;
        U.download(blob, name); C.toast('Exported ' + name); return true;
      });
    }
    U.download(blob, name); C.toast('Exported ' + name);
    return Promise.resolve(true);
  }
  X.saveBlob = saveBlob;

  X.frame = function () {
    if (!C.state.project) return;
    C.Engine.snapshotPNG().then(function (b) {
      if (!b) return;
      var s = P.seq();
      saveBlob(b, (s.name || 'frame') + '_' + U.fmtTC(C.Engine.frame, s.fps).replace(/[:;]/g, '-') + '.png');
    });
  };
  X.srt = function () {
    var s = P.seq(); if (!s) return;
    if (!s.captions.length) { C.toast('This sequence has no captions'); return; }
    saveBlob(new Blob([C.Titles.toSRT(s)], { type: 'application/x-subrip' }), (s.name || 'captions') + '.srt');
  };

  /* ---------- Dialog ---------- */
  X.dialog = function (preset, dopts) {
    dopts = dopts || {};
    var s = dopts.seqId ? P.seqById(dopts.seqId) : P.seq(); if (!s) return;
    if (!P.seqDuration(s)) { C.toast('The sequence is empty — add clips before exporting'); return; }
    var multi = C.state.project.sequences.length > 1;
    var defName = ((multi ? s.name : C.state.project.name) || 'export').replace(/[\\/:*?"<>|]+/g, '_');
    var st = Object.assign({ format: 'webm-vp9', res: 'seq', w: s.w, h: s.h, fps: s.fps, quality: 'high', range: s.inF != null && s.outF != null ? 'inout' : 'all', audio: true, abitrate: 192000, captions: true,
      name: defName }, U.lsGet('export', {}), preset || {});
    if (!preset || !preset.name) st.name = defName;
    st.seqId = s.id;
    if (st.range === 'inout' && (s.inF == null || s.outF == null)) st.range = 'all';
    var caps = null;
    var g = h('div.form-grid');
    var presetSel = h('select', { style: { width: '100%' } });
    presetSel.appendChild(h('option', { value: '' }, 'Custom (settings below)'));
    X.PRESETS.forEach(function (pr) { presetSel.appendChild(h('option', { value: pr.id }, pr.name)); });
    var fmtSel = h('select', { style: { width: '100%' } });
    X.FORMATS.forEach(function (f) { if (f.optional) return; fmtSel.appendChild(h('option', { value: f.id }, f.name)); });
    if (!X.FORMATS.some(function (f) { return f.id === st.format && !f.optional; })) st.format = 'webm-vp9';
    fmtSel.value = st.format;
    var rateSel = h('select'); X.RATE_MODES.forEach(function (o) { rateSel.appendChild(h('option', { value: o[0] }, o[1])); }); rateSel.value = st.rateMode || 'variable';
    var ditherChk = h('input', { type: 'checkbox', checked: st.dither !== false });
    var resSel = h('select');
    [['seq', 'Sequence (' + s.w + '×' + s.h + ')'], ['half', '50% (' + Math.round(s.w / 2 / 2) * 2 + '×' + Math.round(s.h / 2 / 2) * 2 + ')'], ['1080', '1080 lines'], ['720', '720 lines'], ['480', '480 lines'], ['custom', 'Custom…']].forEach(function (o) { resSel.appendChild(h('option', { value: o[0] }, o[1])); });
    resSel.value = st.res;
    var cw = h('input', { type: 'number', value: st.w, style: { width: '76px' } }), ch = h('input', { type: 'number', value: st.h, style: { width: '76px' } });
    var customRow = h('div.row', cw, h('span.muted', '×'), ch);
    var fpsSel = h('select');
    [[s.fps, 'Sequence (' + s.fps + ')']].concat(C.FPS_PRESETS.filter(function (f) { return f !== s.fps; }).map(function (f) { return [f, String(f)]; })).forEach(function (o) { fpsSel.appendChild(h('option', { value: o[0] }, o[1])); });
    fpsSel.value = String(st.fps);
    var qSel = h('select'); X.QUALITY.forEach(function (q) { qSel.appendChild(h('option', { value: q[0] }, q[1])); }); qSel.value = st.quality;
    var rangeSel = h('select');
    rangeSel.appendChild(h('option', { value: 'all' }, 'Entire sequence (' + U.fmtTC(P.seqDuration(s), s.fps) + ')'));
    if (s.inF != null && s.outF != null) rangeSel.appendChild(h('option', { value: 'inout' }, 'In → Out (' + U.fmtTC(s.outF - s.inF, s.fps) + ')'));
    rangeSel.value = st.range;
    var audioChk = h('input', { type: 'checkbox', checked: st.audio });
    var abSel = h('select'); [[96000, '96 kbps'], [128000, '128 kbps'], [192000, '192 kbps'], [256000, '256 kbps'], [320000, '320 kbps']].forEach(function (o) { abSel.appendChild(h('option', { value: o[0] }, o[1])); }); abSel.value = String(st.abitrate);
    var capChk = h('input', { type: 'checkbox', checked: st.captions });
    var name = h('input', { type: 'text', value: st.name, style: { width: '100%' } });
    name.addEventListener('keydown', function (e) { e.stopPropagation(); });
    g.appendChild(h('label', 'Preset')); g.appendChild(presetSel);
    g.appendChild(h('label', 'File name')); g.appendChild(name);
    g.appendChild(h('label', 'Format')); g.appendChild(fmtSel);
    var qRow = [h('label', 'Quality'), h('div.row', qSel, rateSel)], gifRow = [h('label', 'GIF'), h('label.cl-check', ditherChk, h('span', 'Dither (smoother gradients, larger file)'))];
    var vRows = [h('label', 'Resolution'), h('div.row', resSel, customRow), h('label', 'Frame rate'), fpsSel].concat(qRow).concat(gifRow);
    vRows.forEach(function (r) { g.appendChild(r); });
    g.appendChild(h('label', 'Range')); g.appendChild(rangeSel);
    var aRow = [h('label', 'Audio'), h('div.row', h('label.cl-check', audioChk, h('span', 'Include audio')), abSel)];
    aRow.forEach(function (r) { g.appendChild(r); });
    var capRow = [h('label', 'Captions'), h('label.cl-check', capChk, h('span', 'Burn in captions (' + s.captions.length + ')'))];
    capRow.forEach(function (r) { g.appendChild(r); });
    var summary = h('div.export-summary');
    var prev = h('canvas'); prev.width = 320; prev.height = Math.round(320 * s.h / s.w);
    var right = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, h('div.preview', prev), summary);
    var body = h('div.export-grid', g, right);
    function applyPreset(id) {
      var pr = X.PRESETS.filter(function (x) { return x.id === id; })[0]; if (!pr) return;
      var want = pr.format, cap = caps && caps[want];
      if (caps && (!cap || !cap.ok) && pr.fallback) want = pr.fallback;
      fmtSel.value = want;
      if (pr.w) { if (pr.w === s.w && pr.h === s.h) resSel.value = 'seq'; else { resSel.value = 'custom'; cw.value = pr.w; ch.value = pr.h; } }
      if (pr.fps) { var opt = Array.prototype.slice.call(fpsSel.options).filter(function (o) { return +o.value === pr.fps; })[0]; if (!opt) fpsSel.appendChild(h('option', { value: pr.fps }, String(pr.fps))); fpsSel.value = String(pr.fps); }
      if (pr.quality) qSel.value = pr.quality;
      if (pr.abitrate) abSel.value = String(pr.abitrate);
      if (pr.audio != null) audioChk.checked = pr.audio;
    }
    presetSel.addEventListener('change', function () { applyPreset(presetSel.value); compute(); });
    var hwTok = 0;
    function compute() {
      st.format = fmtSel.value; st.res = resSel.value; st.fps = parseFloat(fpsSel.value); st.quality = qSel.value; st.range = rangeSel.value; st.rateMode = rateSel.value; st.dither = ditherChk.checked;
      st.audio = audioChk.checked; st.abitrate = +abSel.value; st.captions = capChk.checked; st.name = name.value.trim() || 'export';
      var w = s.w, hh = s.h;
      if (st.res === 'half') { w = s.w / 2; hh = s.h / 2; }
      else if (st.res === '1080' || st.res === '720' || st.res === '480') { var L = +st.res; if (s.w >= s.h) { hh = L; w = s.w / s.h * L; } else { w = L; hh = s.h / s.w * L; } }
      else if (st.res === 'custom') { w = +cw.value || s.w; hh = +ch.value || s.h; }
      st.w = Math.max(16, Math.round(w / 2) * 2); st.h = Math.max(16, Math.round(hh / 2) * 2);
      customRow.style.display = st.res === 'custom' ? '' : 'none';
      var f = X.FORMATS.filter(function (x) { return x.id === st.format; })[0];
      vRows.forEach(function (r) { r.style.display = f.audioOnly ? 'none' : ''; });
      qRow.forEach(function (r) { r.style.display = f.audioOnly || f.image ? 'none' : ''; });
      gifRow.forEach(function (r) { r.style.display = f.id === 'gif' ? '' : 'none'; });
      rateSel.style.display = f.vcodec ? '' : 'none';
      capRow.forEach(function (r) { r.style.display = f.audioOnly ? 'none' : ''; });
      aRow.forEach(function (r) { r.style.display = f.noAudio ? 'none' : ''; });
      abSel.style.display = f.id === 'wav' ? 'none' : '';
      var fr = X.rangeFrames(s, st.range), durS = (fr[1] - fr[0]) / s.fps;
      var vbr = f.audioOnly || f.image ? 0 : X.bitrate(st), abr = st.audio && !f.noAudio ? (f.id === 'wav' ? 48000 * 2 * 16 : st.abitrate) : 0;
      var est = (vbr + abr) * durS / 8;
      if (f.id === 'gif') est = st.w * st.h * 0.35 * durS * st.fps; // ~0.35 byte per pixel after LZW on typical video
      if (f.id === 'png-seq') est = st.w * st.h * 1.2 * durS * st.fps;
      var cap = caps ? caps[f.id] : null;
      var method = !cap ? 'checking…' : cap.method === 'webcodecs' ? 'WebCodecs (frame-exact, faster than real time)' : cap.method === 'mediarecorder' ? 'MediaRecorder (real-time fallback)' : cap.method === 'offline' ? 'Offline audio render' : cap.method === 'frames' ? (f.id === 'gif' ? 'Frame-by-frame render, 256-colour palette' + (durS > 30 ? ' — keep GIFs under 30 s' : '') : 'Frame-by-frame render to PNG (' + Math.round(durS * st.fps) + ' files)') :
        (f.vcodec === 'avc' ? 'H.264 encoding is not available in this browser. Choose WebM (VP9) or MP4 (VP9) instead.' : 'This format is not supported in this browser.');
      summary.innerHTML = '';
      var hwLine = f.vcodec && cap && cap.webcodecs ? h('div.muted', 'Encoder: checking…') : null;
      if (hwLine) {
        var tok = ++hwTok;
        X.findVideoConfig(f.vcodec, st.w, st.h, st.fps, vbr, st.rateMode).then(function (cfg) {
          if (tok !== hwTok || !cfg) return;
          var hw = cfg.hardwareAcceleration === 'prefer-hardware';
          hwLine.textContent = 'Encoder: ' + (hw ? 'GPU hardware (' + cfg.codec + ')' : (C.GPU && C.GPU.pref() === 'software' ? 'CPU software' : 'browser default — no hardware encoder for this codec/size') + ' (' + cfg.codec + ')');
          hwLine.style.color = hw ? 'var(--accent-2)' : '';
          hwLine.className = '';
        });
      }
      U.append(summary, [
        h('div', f.audioOnly ? 'Audio only' : st.w + '×' + st.h + ' @ ' + st.fps + ' fps' + (f.vcodec && st.rateMode === 'constant' ? ' · CBR' : '')),
        h('div', 'Duration ' + U.fmtTC(fr[1] - fr[0], s.fps)),
        f.audioOnly ? null : h('div', 'Video ≈ ' + (vbr / 1e6).toFixed(1) + ' Mbps'),
        h('div', 'Estimated size ≈ ' + U.fmtSize(est)),
        h('div', { style: { color: cap && !cap.ok ? 'var(--danger)' : 'var(--accent-2)' } }, method),
        hwLine,
        cap && f.acodec === 'aac' && cap.webcodecs && !cap.audio ? h('div', { style: { color: 'var(--warn)' } }, 'AAC encoder unavailable — audio will be Opus') : null,
        durS > 600 && f.vcodec && f.vcodec !== 'avc' && caps && caps['mp4-h264'] && caps['mp4-h264'].webcodecs ? h('div.muted', 'Tip: for long exports, MP4 — H.264 can use the hardware encoder and is usually much faster than VP9.') : null,
        f.id !== 'wav' ? h('div.muted', X.streamsToDisk() ? 'Written straight to disk while it renders (you choose the file first).' :
          (est > X.MEM_WARN ? h('span', { style: { color: 'var(--warn)' } }, 'No save dialog in this browser: the file (≈' + U.fmtSize(est) + ') is assembled in memory before downloading. Use Chrome or Edge for very long exports.') : 'Assembled in memory, then downloaded.')) : null]);
      if (d && d.go) d.go.disabled = !!(cap && !cap.ok);
    }
    [fmtSel, resSel, fpsSel, qSel, rangeSel, audioChk, abSel, capChk, rateSel, ditherChk].forEach(function (el) { el.addEventListener('change', function () { if (el !== presetSel && [fmtSel, resSel, fpsSel, qSel].indexOf(el) >= 0) presetSel.value = ''; compute(); }); });
    [cw, ch].forEach(function (el) { el.addEventListener('input', compute); el.addEventListener('keydown', function (e) { e.stopPropagation(); }); });
    // preview frame
    var pfr = s === P.seq() ? C.Engine.frame : ((C.state.playheads || {})[s.id] || 0);
    try { var offc = document.createElement('canvas'); var pc = C.createCompositor(offc); var pp = new C.SourceProvider('exprev'); var sc = C.Scene.build(s, Math.min(pfr, Math.max(0, P.seqDuration(s) - 1))); pp.prepare(sc).then(function () { pc.render(sc, prev.width, prev.height, pp, {}); prev.getContext('2d').drawImage(offc, 0, 0); pp.dropAll(); if (pc.destroy) pc.destroy(); }); } catch (e) { }
    function remember() { compute(); U.lsSet('export', { format: st.format, res: st.res, quality: st.quality, audio: st.audio, abitrate: st.abitrate, captions: st.captions, rateMode: st.rateMode, dither: st.dither }); }
    var buttons = dopts.queue ? [{ label: 'Cancel' }, { label: 'Add to Queue', primary: true, id: 'go', action: function () { remember(); X.enqueue(Object.assign({}, st)); if (dopts.onAdd) dopts.onAdd(); } }]
      : [{ label: 'Add to Batch Queue', left: true, action: function () { remember(); X.enqueue(Object.assign({}, st)); setTimeout(X.batchDialog, 30); } },
        { label: 'Cancel' }, { label: 'Export', primary: true, id: 'go', action: function () { remember(); X.runWithUI(st); } }];
    var d = C.ui.dialog({ title: dopts.queue ? 'Add to Batch Export — ' + s.name : 'Export' + (multi ? ' — ' + s.name : ''), width: 820, body: body, buttons: buttons });
    compute();
    X.probe().then(function (r) {
      caps = r;
      // flag formats this browser cannot encode right in the list; HEVC / AV1 only appear when an encoder exists
      U.$$('option', fmtSel).forEach(function (o) { var c = caps[o.value]; if (c && !c.ok) o.textContent = X.FORMATS.filter(function (x) { return x.id === o.value; })[0].name + '  (not available)'; });
      X.FORMATS.forEach(function (f, i) { if (f.optional && caps[f.id] && caps[f.id].webcodecs) { var before = U.$$('option', fmtSel).filter(function (o) { return ['wav', 'webm-opus', 'gif', 'png-seq'].indexOf(o.value) >= 0; })[0]; fmtSel.insertBefore(h('option', { value: f.id }, f.name), before || null); void i; } });
      if (st.format && !U.$$('option', fmtSel).some(function (o) { return o.value === st.format; })) { fmtSel.value = 'webm-vp9'; }
      compute();
    });
  };
  X.MEM_WARN = 1.5 * 1073741824;
  X.streamsToDisk = function () { return !!window.showSaveFilePicker && !X.noPicker; };
  X.bitrate = function (st) { var q = X.QUALITY.filter(function (x) { return x[0] === st.quality; })[0] || X.QUALITY[2]; return Math.round(Math.max(300000, st.w * st.h * st.fps * q[2])); };
  X.rangeFrames = function (s, range) {
    if (range === 'inout' && s.inF != null && s.outF != null) return [s.inF, s.outF];
    return [0, P.seqDuration(s)];
  };

  // Ask for the destination before rendering (needs the click's user activation), so the muxer can stream into it.
  // Resolves a FileSink, null (no picker: render to memory) or false (user cancelled the dialog).
  X.openSink = function (name, f) {
    if (f.id === 'wav' || f.id === 'gif' || !X.streamsToDisk()) return Promise.resolve(null);
    var ext = name.split('.').pop(), accept = {};
    accept[f.id === 'png-seq' ? 'application/zip' : f.audioOnly ? 'audio/' + ext : 'video/' + ext] = ['.' + ext];
    return Promise.resolve().then(function () { return window.showSaveFilePicker({ suggestedName: name, types: [{ description: ext.toUpperCase() + ' file', accept: accept }] }); })
      .then(function (fh) { return fh.createWritable().then(function (w) { return new C.FileSink(w, fh.name || name); }); })
      .catch(function (e) { if (e && e.name === 'AbortError') return false; console.warn('[Cutline] save dialog unavailable, rendering to memory', e && e.message); return null; });
  };
  X.runWithUI = function (st) {
    var f = X.FORMATS.filter(function (x) { return x.id === st.format; })[0];
    if (C.Engine.playing) C.Engine.pause();
    return X.openSink(st.name + '.' + f.ext, f).then(function (sink) {
      if (sink === false) return null;
      var cancel = { v: false };
      var pr = C.ui.progress('Exporting ' + st.name, { cancel: function () { cancel.v = true; } });
      var t0 = performance.now();
      return X.run(st, X.progressFn(pr, t0), cancel, sink).then(function (res) {
        pr.done();
        if (!res) { C.toast('Export cancelled'); return null; }
        X.last = res;
        var secs = ((performance.now() - t0) / 1000).toFixed(1);
        var encNote = X.lastEncoder && f.vcodec ? (X.lastEncoder.hw ? ' · GPU encoder' : ' · CPU encoder') : '';
        if (res.file) { C.toast('Exported ' + (res.name || st.name) + ' in ' + secs + ' s (' + U.fmtSize(res.size) + ')' + encNote, 4000); return res; }
        var ext = res.ext || f.ext;
        return saveBlob(res.blob, st.name + '.' + ext).then(function () {
          C.toast('Export finished in ' + secs + ' s (' + U.fmtSize(res.blob.size) + ')', 4000);
          return res;
        });
      }).catch(function (e) {
        pr.done(); console.error('[Cutline] export failed', e);
        C.ui.alert('Export failed', String(e && e.message || e));
        return null;
      });
    });
  };
  X.progressFn = function (pr, t0) {
    return function (p, msg) {
      var el = (performance.now() - t0) / 1000, eta = p > 0.01 && el > 1.5 ? el / p - el : null;
      pr.update(p, msg + (eta != null ? '  ·  ' + U.fmtDur(eta) + ' left' : ''));
    };
  };

  // Core export. Resolves {blob, ext} | {file: true, size, name} or null when cancelled. `sink` (optional) receives
  // the muxed bytes as they are produced; without one the output is assembled into a Blob.
  X.run = function (st, onProgress, cancel, sink) {
    var s = (st.seqId && P.seqById(st.seqId)) || P.seq();
    cancel = cancel || { v: false };
    onProgress = onProgress || function () { };
    var f = X.FORMATS.filter(function (x) { return x.id === st.format; })[0];
    var fr = X.rangeFrames(s, st.range);
    var t0 = fr[0] / s.fps, t1 = fr[1] / s.fps;
    if (t1 <= t0) return Promise.reject(new Error('Nothing to export in the selected range'));
    var hasAudio = st.audio && s.clips.some(function (c) { return c.kind === 'audio'; });
    var done = function (r) {
      if (!r) { if (sink) sink.abort(); return null; }
      if (!sink || r.file) return r;
      // a non-streaming path produced a Blob but the user picked a file: copy it in
      return sink.write(r.blob).then(function () { return sink.close(); }).then(function (x) { return Object.assign({ ext: r.ext }, x); });
    };
    if (f.id === 'wav') {
      onProgress(0.1, 'Rendering audio…');
      return C.Mixer.renderOffline(s, t0, t1, 48000).then(function (buf) { onProgress(1, 'Encoding WAV'); return done({ blob: C.Mixer.encodeWAV(buf, 16) }); });
    }
    if (f.audioOnly) {
      if (!hasAudio) return Promise.reject(new Error('The sequence has no audio'));
      return encodeAudioOnly(f, st, s, t0, t1, onProgress, cancel, sink).then(done);
    }
    if (f.id === 'gif') return C.ExportExtras.renderGif(st, s, fr, onProgress, cancel).then(done);
    if (f.id === 'png-seq') return C.ExportExtras.renderPngZip(st, s, fr, onProgress, cancel, sink).then(done);
    var w = st.w || s.w, hh = st.h || s.h, fps = st.fps || s.fps, br = X.bitrate({ w: w, h: hh, fps: fps, quality: st.quality });
    return X.findVideoConfig(f.vcodec, w, hh, fps, br, st.rateMode).then(function (vcfg) {
      if (!vcfg) {
        if (window.MediaRecorder) return recordRealtime(f, st, s, fr, w, hh, fps, br, onProgress, cancel);
        throw new Error('No encoder for ' + f.name + ' in this browser');
      }
      var getA = hasAudio ? X.findAudioConfig(f.acodec, 48000, 2, st.abitrate) : Promise.resolve(null);
      return getA.then(function (acfg) {
        var acodec = f.acodec;
        if (hasAudio && !acfg && f.acodec === 'aac') { acodec = 'opus'; return X.findAudioConfig('opus', 48000, 2, st.abitrate).then(function (c2) { return encodeAV(f, st, s, fr, vcfg, c2, 'opus', w, hh, fps, onProgress, cancel, sink); }); }
        return encodeAV(f, st, s, fr, vcfg, hasAudio ? acfg : null, acodec, w, hh, fps, onProgress, cancel, sink);
      });
    }).then(done, function (e) { if (sink) sink.abort(); throw e; });
  };

  // Encode one mixed block (planar L/R starting at sample index `start`) in 100 ms AudioData pieces
  function feedBlock(enc, L, R, start, sr) {
    var n = L.length, step = 4800;
    for (var i = 0; i < n; i += step) {
      var len = Math.min(step, n - i), data = new Float32Array(len * 2);
      data.set(L.subarray(i, i + len), 0); data.set(R.subarray(i, i + len), len);
      var ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: len, numberOfChannels: 2, timestamp: Math.round((start + i) / sr * 1e6), data: data });
      enc.encode(ad); ad.close();
    }
  }
  X.feedBlock = feedBlock;
  function encodeAudioOnly(f, st, s, t0, t1, onProgress, cancel, sink) {
    return X.findAudioConfig('opus', 48000, 2, st.abitrate).then(function (acfg) {
      if (!acfg) throw new Error('Opus encoder unavailable');
      var mux = new C.WebMMuxer({ audio: { codec: 'A_OPUS', sampleRate: 48000, channels: 2 } }, sink || null), err = null;
      var enc = new AudioEncoder({ output: function (ch, meta) { mux.addAudio(ch, meta); }, error: function (e) { err = e; } });
      enc.configure(acfg);
      var br = C.Mixer.blockRenderer(s, t0, t1, 48000);
      function loop() {
        if (cancel.v || err) return Promise.resolve();
        return br.next().then(function (b) {
          if (!b) return;
          feedBlock(enc, b.L, b.R, b.start, 48000);
          onProgress(Math.min(0.99, (b.start + b.n) / br.total), 'Encoding audio… ' + U.fmtDur((b.start + b.n) / 48000) + ' / ' + U.fmtDur(br.total / 48000));
          return mux.ready().then(loop);
        });
      }
      return loop().then(function () {
        if (cancel.v) { try { enc.close(); } catch (e) { } return null; }
        return enc.flush().then(function () { enc.close(); if (err) throw err; return mux.finalize(); }).then(function (r) { return r.file ? r : { blob: r.blob, ext: 'webm' }; });
      });
    });
  }

  function encodeAV(f, st, s, fr, vcfg, acfg, acodec, w, hh, fps, onProgress, cancel, sink) {
    var mux, mOpts;
    if (f.container === 'webm') mux = new C.WebMMuxer(mOpts = { video: { codec: f.vcodec === 'vp8' ? 'V_VP8' : f.vcodec === 'av1' ? 'V_AV1' : 'V_VP9', width: w, height: hh, fps: fps }, audio: acfg ? { codec: 'A_OPUS', sampleRate: 48000, channels: 2 } : null }, sink || null);
    else mux = new C.MP4Muxer(mOpts = { video: { codec: f.vcodec === 'avc' ? 'avc' : f.vcodec === 'hevc' ? 'hevc' : f.vcodec === 'av1' ? 'av1' : 'vp9', width: w, height: hh, fps: fps }, audio: acfg ? { codec: acodec === 'aac' ? 'aac' : 'opus', sampleRate: 48000, channels: 2, bitrate: st.abitrate } : null }, sink || null);
    void mOpts;
    var err = null;
    var venc = new VideoEncoder({ output: function (chunk, meta) { mux.addVideo(chunk, meta); }, error: function (e) { err = e; console.error('[Cutline] video encoder error', e); } });
    venc.configure(vcfg);
    X.lastEncoder = { codec: vcfg.codec, hw: vcfg.hardwareAcceleration === 'prefer-hardware' };
    var aenc = null, br = null, audioUntil = 0, audioEnd = false, t0s = fr[0] / s.fps, t1s = fr[1] / s.fps;
    if (acfg) {
      aenc = new AudioEncoder({ output: function (chunk, meta) { mux.addAudio(chunk, meta); }, error: function (e) { err = e; console.error('[Cutline] audio encoder error', e); } });
      aenc.configure(acfg);
      // audio is mixed in 30 s blocks just ahead of the video (only the used source ranges are decoded)
      br = C.Mixer.blockRenderer(s, t0s, t1s, 48000);
    }
    function ensureAudio(tSec) {
      if (!br || audioEnd || audioUntil >= tSec || cancel.v || err) return Promise.resolve();
      return br.next().then(function (b) {
        if (!b) { audioEnd = true; return; }
        feedBlock(aenc, b.L, b.R, b.start, 48000);
        audioUntil = (b.start + b.n) / 48000;
        return ensureAudio(tSec);
      });
    }
    var canvas = document.createElement('canvas'); canvas.width = w; canvas.height = hh;
    var comp = C.createCompositor(canvas);
    var prov = new C.SourceProvider('export');
    prov.useDecoders = st.fastDecode !== false && C.prefs.fastDecode !== false && !!window.VideoDecoder;
    var oldCache = C.AudioStream.setCacheLimit(Math.min(C.AudioStream.CACHE_BYTES, 32 * 1048576)); // keep the export's footprint flat
    var total = Math.max(1, Math.round((fr[1] - fr[0]) / s.fps * fps));
    var gop = Math.max(1, Math.round(fps * 2));
    var i = 0, wall0 = performance.now(), stats = X.lastStats = { audio: 0, prepare: 0, render: 0, encode: 0, wait: 0, frames: 0 }, tm = performance.now();
    function lap(k) { var n = performance.now(); stats[k] += n - tm; tm = n; }
    function waitQueue() {
      if (venc.encodeQueueSize <= 4) return Promise.resolve();
      return new Promise(function (res) { var t = setInterval(function () { if (venc.encodeQueueSize <= 2 || err) { clearInterval(t); res(); } }, 4); });
    }
    function step() {
      if (cancel.v || err) return Promise.resolve();
      if (i >= total) return Promise.resolve();
      var tSec = i / fps;
      var seqF = fr[0] + Math.floor(tSec * s.fps + 1e-6);
      tm = performance.now();
      return ensureAudio(tSec + 2).then(function () {
        lap('audio');
        var scene = C.Scene.build(s, seqF, { captions: st.captions });
        return prov.prepare(scene).then(function () { lap('prepare'); return scene; });
      }).then(function (scene) {
        comp.render(scene, w, hh, prov, { captions: st.captions });
        lap('render');
        var vf = new VideoFrame(canvas, { timestamp: Math.round(tSec * 1e6), duration: Math.round(1e6 / fps) });
        venc.encode(vf, { keyFrame: i % gop === 0 });
        vf.close();
        lap('encode');
        i++; stats.frames = i;
        if (i % 150 === 0 && comp.gcTextures) comp.gcTextures(4000); // free textures of clips that are no longer used
        if (i % 3 === 0 || i === total) {
          var el = (performance.now() - wall0) / 1000;
          onProgress(i / total, 'Frame ' + i + ' / ' + total + '  ·  ' + (i / Math.max(0.001, el)).toFixed(1) + ' fps' + (mux.sink ? '  ·  ' + U.fmtSize(mux.sink.pos) + (mux.sink.kind === 'file' ? ' written' : '') : ''));
        }
        return waitQueue().then(function () { return mux.ready(); }).then(function () { lap('wait'); });
      }).then(function () {
        // yield to the event loop every few frames to keep the UI responsive
        if (i % 8 === 0) return new Promise(function (r) { setTimeout(r, 0); }).then(step);
        return step();
      });
    }
    return step().then(function () {
      if (err) throw err;
      if (cancel.v) { try { venc.close(); if (aenc) aenc.close(); } catch (e) { } cleanup(); return null; }
      onProgress(1, 'Finalizing…');
      return ensureAudio(Infinity).then(function () { return Promise.all([venc.flush(), aenc ? aenc.flush() : null]); }).then(function () {
        venc.close(); if (aenc) aenc.close();
        cleanup();
        if (err) throw err;
        return mux.finalize();
      }).then(function (r) { return r.file ? Object.assign({ ext: f.ext }, r) : { blob: r.blob, ext: f.ext, size: r.blob.size }; });
    }, function (e) { cleanup(); throw e; });
    function cleanup() { prov.dropAll(); if (comp.destroy) comp.destroy(); C.AudioStream.setCacheLimit(oldCache); }
  }

  /* ---------- Batch export queue ---------- */
  X.queue = [];
  // the queue survives a reload: queued items are kept per project id
  X.persistQueue = function () {
    var p = C.state.project; if (!p) return;
    var items = X.queue.filter(function (x) { return x.status === 'queued'; }).map(function (x) { return x.st; });
    var all = U.lsGet('exportQueue', {}); if (items.length) all[p.id] = items; else delete all[p.id];
    U.lsSet('exportQueue', all);
  };
  X.restoreQueue = function () {
    var p = C.state.project; if (!p) return 0;
    var all = U.lsGet('exportQueue', {}), items = all[p.id] || [];
    X.queue = X.queue.filter(function (x) { return x.status !== 'queued' || x.restored; });
    items.forEach(function (st) { if (P.seqById(st.seqId)) X.queue.push({ id: U.uid('q'), st: st, status: 'queued', p: 0, msg: '', restored: true }); });
    C.bus.emit('exportqueue');
    return items.length;
  };
  C.bus.on('project', function () { var n = X.restoreQueue(); if (n) C.toast(n + ' export' + (n > 1 ? 's' : '') + ' waiting in the batch queue (File › Batch Export Queue…)', 4000); });
  C.bus.on('exportqueue', X.persistQueue); C.bus.on('exportqueue:done', X.persistQueue);
  X.enqueue = function (st) {
    var s = P.seqById(st.seqId); if (!s) return null;
    var item = { id: U.uid('q'), st: st, status: 'queued', p: 0, msg: '' };
    X.queue.push(item);
    C.toast('Added "' + s.name + '" to the batch queue (' + X.queue.length + ' item' + (X.queue.length > 1 ? 's' : '') + ')');
    C.bus.emit('exportqueue');
    return item;
  };
  X.batchDialog = function () {
    if (!C.state.project) return;
    var body = h('div.batch'), list = h('div.batch-list'), folderTxt = h('span.muted', ''), running = false, cancel = { v: false }, dir = null;
    var canDir = !!window.showDirectoryPicker && !X.noPicker;
    function row(it, i) {
      var s = P.seqById(it.st.seqId), f = X.FORMATS.filter(function (x) { return x.id === it.st.format; })[0];
      var name = h('input', { type: 'text', value: it.st.name, style: { width: '100%' }, disabled: running || it.status !== 'queued' });
      name.addEventListener('keydown', function (e) { e.stopPropagation(); });
      name.addEventListener('change', function () { it.st.name = name.value.trim() || it.st.name; });
      var fr = s ? X.rangeFrames(s, it.st.range) : [0, 0];
      var bar = h('div.cl-progress', h('div.cl-progress-fill', { style: { width: (it.p * 100).toFixed(1) + '%' } }));
      var rm = C.ui.iconBtn('trash', 'Remove from queue', function () { if (running && it.status === 'running') return; X.queue = X.queue.filter(function (x) { return x !== it; }); render(); X.persistQueue(); }, { cls: 'sm' });
      return h('div.batch-row', { 'data-q': it.id },
        h('div.batch-n', String(i + 1)),
        h('div.batch-main',
          h('div.batch-line', h('b', s ? s.name : '(deleted sequence)'), h('span.muted', '  ' + (f ? f.name.split(' — ')[0] : '') + ' · ' + (f && f.audioOnly ? 'audio' : it.st.w + '×' + it.st.h + ' @ ' + it.st.fps) + ' · ' + (s ? U.fmtTC(fr[1] - fr[0], s.fps) : ''))),
          h('div.batch-line', name, h('span.muted', '.' + (f ? f.ext : ''))),
          bar, h('div.muted.batch-msg', it.status === 'queued' ? 'Waiting' : it.msg)),
        rm);
    }
    function render() {
      U.clear(list);
      if (!X.queue.length) list.appendChild(h('div.insp-empty', 'The queue is empty. Use "Add Sequence…" (or "Add to Batch Queue" in the Export dialog) to queue each edit with its own file name and settings.'));
      X.queue.forEach(function (it, i) { list.appendChild(row(it, i)); });
      folderTxt.textContent = canDir ? (dir ? 'Output folder: ' + (dir.name || 'chosen') : 'You will be asked for an output folder when the queue starts.') : 'Each file is downloaded when it finishes.';
      if (d && d.start) d.start.disabled = running || !X.queue.some(function (x) { return x.status === 'queued'; });
    }
    function updateRow(it) {
      var el = U.$('[data-q="' + it.id + '"]', list); if (!el) return;
      var fill = el.querySelector('.cl-progress-fill'); if (fill) fill.style.width = (it.p * 100).toFixed(1) + '%';
      var msg = el.querySelector('.batch-msg'); if (msg) msg.textContent = it.msg;
      el.classList.toggle('done', it.status === 'done'); el.classList.toggle('failed', it.status === 'failed'); el.classList.toggle('running', it.status === 'running');
    }
    var addBtn = h('button.btn', 'Add Sequence…');
    addBtn.addEventListener('click', function () {
      if (running) return;
      var r = addBtn.getBoundingClientRect();
      C.ui.menu(C.state.project.sequences.map(function (sq) { return { label: sq.name + '  (' + U.fmtTC(P.seqDuration(sq), sq.fps) + ')', disabled: !P.seqDuration(sq), action: function () { X.dialog(null, { queue: true, seqId: sq.id, onAdd: render }); } }; }), r.left, r.bottom + 2);
    });
    var addAll = h('button.btn', 'Queue All Sequences');
    addAll.addEventListener('click', function () {
      if (running) return;
      var last = U.lsGet('export', {});
      C.state.project.sequences.forEach(function (sq) {
        if (!P.seqDuration(sq) || X.queue.some(function (x) { return x.st.seqId === sq.id && x.status === 'queued'; })) return;
        X.enqueue(Object.assign({ format: 'webm-vp9', res: 'seq', quality: 'high', audio: true, abitrate: 192000, captions: true }, last, { seqId: sq.id, name: sq.name.replace(/[\\/:*?"<>|]+/g, '_'), w: sq.w, h: sq.h, fps: sq.fps, range: 'all', res: 'seq' }));
      });
      render();
    });
    U.append(body, [h('div.row', { style: { gap: '6px', marginBottom: '8px' } }, addBtn, addAll, h('span', { style: { flex: 1 } }), folderTxt), list]);
    function runOne(it) {
      var f = X.FORMATS.filter(function (x) { return x.id === it.st.format; })[0], fname = it.st.name + '.' + f.ext;
      if (!P.seqById(it.st.seqId)) { it.status = 'failed'; it.msg = 'The sequence was deleted'; updateRow(it); return Promise.resolve(); }
      var sinkP = Promise.resolve(null);
      if (dir && f.id !== 'wav') sinkP = dir.getFileHandle(fname, { create: true }).then(function (fh) { return fh.createWritable(); }).then(function (w) { return new C.FileSink(w, fname); });
      it.status = 'running'; it.p = 0; it.msg = 'Starting…'; updateRow(it);
      var t0 = performance.now();
      return sinkP.then(function (sink) {
        return X.run(it.st, function (p, msg) {
          var el = (performance.now() - t0) / 1000, eta = p > 0.01 && el > 1.5 ? el / p - el : null;
          it.p = p; it.msg = msg + (eta != null ? '  ·  ' + U.fmtDur(eta) + ' left' : ''); updateRow(it);
        }, cancel, sink);
      }).then(function (res) {
        if (!res) { it.status = cancel.v ? 'cancelled' : 'failed'; it.msg = 'Cancelled'; updateRow(it); X.persistQueue(); return; }
        it.result = res; it.status = 'done'; it.p = 1; X.persistQueue();
        it.msg = 'Done in ' + U.fmtDur((performance.now() - t0) / 1000) + ' — ' + U.fmtSize(res.size || (res.blob && res.blob.size)) + (res.file ? ' → ' + fname : '');
        updateRow(it);
        if (!res.file && res.blob) { X.last = res; U.download(res.blob, fname); }
      }).catch(function (e) { console.error('[Cutline] batch item failed', e); it.status = 'failed'; it.msg = 'Failed: ' + (e && e.message || e); updateRow(it); });
    }
    function start() {
      if (running) return false;
      var pend = X.queue.filter(function (x) { return x.status === 'queued'; });
      if (!pend.length) return false;
      var pick = canDir && !dir ? window.showDirectoryPicker({ mode: 'readwrite' }).then(function (dh) { dir = dh; }, function (e) { if (e && e.name === 'AbortError') throw e; }) : Promise.resolve();
      pick.then(function () {
        running = true; cancel = { v: false }; render();
        d.cancelQ.disabled = false;
        if (C.Engine.playing) C.Engine.pause();
        var chain = Promise.resolve();
        pend.forEach(function (it) { chain = chain.then(function () { if (cancel.v) return; return runOne(it); }); });
        return chain.then(function () {
          running = false; d.cancelQ.disabled = true; render();
          var ok = pend.filter(function (x) { return x.status === 'done'; }).length;
          C.toast('Batch export: ' + ok + ' of ' + pend.length + ' finished', 4000);
          C.bus.emit('exportqueue:done');
        });
      }).catch(function () { });
      return false;
    }
    var d = C.ui.dialog({ title: 'Batch Export Queue', width: 760, body: body, enterKey: false, buttons: [
      { label: 'Clear Finished', left: true, action: function () { X.queue = X.queue.filter(function (x) { return x.status === 'queued' || x.status === 'running'; }); render(); return false; } },
      { label: 'Cancel Queue', id: 'cancelQ', action: function () { cancel.v = true; return false; } },
      { label: 'Close', action: function () { if (running) { C.toast('The queue is still running — cancel it first'); return false; } } },
      { label: 'Start Queue', primary: true, id: 'start', action: start }] });
    d.cancelQ.disabled = true;
    var onQ = function () { if (!d.closed && !running) render(); };
    C.bus.on('exportqueue', onQ);
    X.batchUI = { dialog: d, render: render, get running() { return running; } };
    render();
    return d;
  };

  // Real-time fallback using canvas.captureStream + MediaRecorder
  function recordRealtime(f, st, s, fr, w, hh, fps, br, onProgress, cancel) {
    return X.probe().then(function (caps) {
      var cap = caps[f.id];
      var type = cap && cap.mrType || 'video/webm;codecs=vp9,opus';
      if (!MediaRecorder.isTypeSupported(type)) type = 'video/webm';
      var canvas = document.createElement('canvas'); canvas.width = w; canvas.height = hh;
      var comp = C.createCompositor(canvas), prov = new C.SourceProvider('export');
      var stream = canvas.captureStream(fps);
      var actx = new (window.AudioContext || window.webkitAudioContext)();
      var dest = actx.createMediaStreamDestination();
      if (st.audio) dest.stream.getAudioTracks().forEach(function (t) { stream.addTrack(t); });
      var rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: br, audioBitsPerSecond: st.abitrate });
      var parts = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) parts.push(e.data); };
      var buses = C.Mixer.buildBuses(actx, dest, s);
      var t0 = fr[0] / s.fps, t1 = fr[1] / s.fps;
      return new Promise(function (resolve, reject) {
        rec.onstop = function () {
          prov.dropAll(); actx.close(); if (comp.destroy) comp.destroy();
          if (cancel.v) { resolve(null); return; }
          resolve({ blob: new Blob(parts, { type: type.split(';')[0] }), ext: type.indexOf('mp4') >= 0 ? 'mp4' : 'webm' });
        };
        // prime first frame
        var first = C.Scene.build(s, fr[0], { captions: st.captions });
        prov.prepare(first).then(function () {
          comp.render(first, w, hh, prov, { captions: st.captions });
          rec.start(500);
          var startAt = actx.currentTime + 0.1;
          if (st.audio) C.Mixer.schedule(actx, s, t0, startAt, buses, { to: t1 });
          function tick() {
            if (cancel.v) { rec.stop(); return; }
            var el = actx.currentTime - startAt;
            if (el >= t1 - t0) { setTimeout(function () { rec.stop(); }, 150); onProgress(1, 'Finishing…'); return; }
            var f2 = fr[0] + Math.max(0, Math.floor(el * s.fps));
            var sc = C.Scene.build(s, f2, { captions: st.captions });
            prov.sync(sc, true, 1, C.Scene.build(s, f2 + s.fps));
            comp.render(sc, w, hh, prov, { captions: st.captions });
            onProgress(el / (t1 - t0), 'Recording in real time… ' + U.fmtTC(f2 - fr[0], s.fps));
            requestAnimationFrame(tick);
          }
          tick();
        }).catch(reject);
      });
    });
  }
})();
