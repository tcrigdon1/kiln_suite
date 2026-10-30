/* Cutline — GPU codec preference (NVENC / Quick Sync / AMF through WebCodecs) and a hardware report.
   WebCodecs never says which encoder it picked; what we can do is ASK for hardware (hardwareAcceleration:
   'prefer-hardware'), find out whether the browser accepts that request for a codec/size, and fall back when it
   does not.  Chrome on Windows routes prefer-hardware H.264/HEVC/AV1 encodes to the vendor encoder (NVENC on
   GeForce) and prefer-hardware decodes to D3D11 video decode. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util;
  var G = C.GPU = {};

  // prefs.gpuCodec: 'prefer' (hardware first, software fallback) | 'auto' (browser decides) | 'software'
  G.pref = function () { var v = C.prefs && C.prefs.gpuCodec; return v === 'auto' || v === 'software' ? v : 'prefer'; };
  G.encOrder = function () {
    var p = G.pref();
    return p === 'prefer' ? ['prefer-hardware', 'no-preference'] : p === 'software' ? ['prefer-software'] : ['no-preference'];
  };
  G.label = function (accel) {
    return accel === 'prefer-hardware' ? 'GPU hardware encoder' : accel === 'prefer-software' ? 'CPU software encoder' : 'browser default';
  };

  /* ---------- decode ---------- */
  var decCache = {};
  // Resolve a decoder config with the hardware preference applied when the browser accepts it for this stream.
  G.decConfig = function (cfg) {
    if (!cfg || !window.VideoDecoder || G.pref() === 'auto') return Promise.resolve(cfg);
    var want = G.pref() === 'software' ? 'prefer-software' : 'prefer-hardware';
    var key = [cfg.codec, cfg.codedWidth, cfg.codedHeight, want].join('|');
    if (!decCache[key]) {
      var test = Object.assign({}, cfg, { hardwareAcceleration: want });
      decCache[key] = VideoDecoder.isConfigSupported(test).then(function (r) { return !!(r && r.supported); }).catch(function () { return false; });
    }
    return decCache[key].then(function (ok) { return ok ? Object.assign({}, cfg, { hardwareAcceleration: want }) : cfg; });
  };
  // After a hardware decoder failed mid-stream: the same config without the hardware request (null = nothing to drop)
  G.decFallback = function (cfg) {
    if (!cfg || cfg.hardwareAcceleration !== 'prefer-hardware') return null;
    var c = Object.assign({}, cfg); delete c.hardwareAcceleration; return c;
  };

  /* ---------- report ---------- */
  G.renderer = function () {
    try {
      var cv = document.createElement('canvas'), gl = cv.getContext('webgl2') || cv.getContext('webgl');
      if (!gl) return null;
      var ext = gl.getExtension('WEBGL_debug_renderer_info');
      var r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      var lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
      return r;
    } catch (e) { return null; }
  };
  var ENC = [
    ['H.264 (AVC)', 'avc1.640028', 'avc1.640033'],
    ['HEVC (H.265)', 'hvc1.1.6.L123.B0', 'hvc1.1.6.L153.B0'],
    ['AV1', 'av01.0.08M.08', 'av01.0.12M.08'],
    ['VP9', 'vp09.00.41.08', 'vp09.00.51.08']
  ];
  var DEC = [
    ['H.264 (AVC)', 'avc1.640028', 'avc1.640033'],
    ['HEVC (H.265)', 'hvc1.1.6.L123.B0', 'hvc1.1.6.L153.B0'],
    ['AV1', 'av01.0.08M.08', 'av01.0.12M.08'],
    ['VP9', 'vp09.00.41.08', 'vp09.00.51.08']
  ];
  var SIZES = [[1920, 1080, '1080p'], [3840, 2160, '4K']];
  function encSupport(codec, w, h, accel) {
    if (!window.VideoEncoder) return Promise.resolve(false);
    var cfg = { codec: codec, width: w, height: h, bitrate: Math.round(w * h * 60 * 0.08), framerate: 60, hardwareAcceleration: accel };
    if (/^avc1/.test(codec)) cfg.avc = { format: 'avc' };
    if (/^hvc1|^hev1/.test(codec)) cfg.hevc = { format: 'hevc' };
    return VideoEncoder.isConfigSupported(cfg).then(function (r) { return !!(r && r.supported); }).catch(function () { return false; });
  }
  function decSupport(codec, w, h, accel) {
    if (!window.VideoDecoder) return Promise.resolve(false);
    var cfg = { codec: codec, codedWidth: w, codedHeight: h, hardwareAcceleration: accel };
    return VideoDecoder.isConfigSupported(cfg).then(function (r) { return !!(r && r.supported); }).catch(function () { return false; });
  }
  // → { renderer, encode: [{name, cells:[{size, hw, sw}]}], decode: [...] }
  G.report = function () {
    var out = { renderer: G.renderer(), webcodecs: !!(window.VideoEncoder && window.VideoDecoder), encode: [], decode: [] };
    function rows(list, fn, into) {
      return Promise.all(list.map(function (row) {
        return Promise.all(SIZES.map(function (sz, i) {
          var codec = row[1 + i];
          return Promise.all([fn(codec, sz[0], sz[1], 'prefer-hardware'), fn(codec, sz[0], sz[1], 'prefer-software')]).then(function (r) { return { size: sz[2], hw: r[0], sw: r[1] }; });
        })).then(function (cells) { into.push({ name: row[0], cells: cells }); });
      }));
    }
    return rows(ENC, encSupport, out.encode).then(function () { return rows(DEC, decSupport, out.decode); }).then(function () { return out; });
  };

  G.dialog = function () {
    var h = U.h;
    var body = h('div', { style: { minWidth: '520px' } }, h('div.muted', 'Checking…'));
    var d = C.ui.dialog({ title: 'GPU & Hardware Codecs', body: body, buttons: [{ label: 'Close', primary: true }] });
    G.report().then(function (r) {
      body.innerHTML = '';
      var pref = G.pref();
      U.append(body, [
        h('div', { style: { marginBottom: '8px' } }, h('b', 'Graphics: '), r.renderer || 'unknown (WebGL unavailable)'),
        h('div', { style: { marginBottom: '8px' } }, h('b', 'Codec preference: '), pref === 'prefer' ? 'GPU first, CPU fallback' : pref === 'software' ? 'CPU only' : 'browser default', h('span.muted', '  (Edit ▸ Preferences ▸ Video codecs)')),
        !r.webcodecs ? h('div', { style: { color: 'var(--danger)' } }, 'This browser has no WebCodecs — exports fall back to real-time MediaRecorder.') : null
      ]);
      function table(title, rows) {
        var t = h('table.gpu-table', { style: { borderCollapse: 'collapse', margin: '6px 0 12px' } });
        t.appendChild(h('tr', h('th', { style: { textAlign: 'left', paddingRight: '28px' } }, title), SIZES.map(function (s) { return h('th', { style: { textAlign: 'left', paddingRight: '28px' } }, s[2]); })));
        rows.forEach(function (row) {
          t.appendChild(h('tr', h('td', row.name), row.cells.map(function (c) {
            var txt = c.hw ? 'GPU' + (c.sw ? ' + CPU' : '') : c.sw ? 'CPU only' : '—';
            return h('td', { style: { color: c.hw ? 'var(--accent-2)' : c.sw ? 'inherit' : 'var(--muted)' } }, txt);
          })));
        });
        return t;
      }
      U.append(body, [table('Encode (export, proxies)', r.encode), table('Decode (frame-exact export, thumbnails)', r.decode)]);
      var anyHw = r.encode.some(function (e) { return e.cells.some(function (c) { return c.hw; }); });
      U.append(body, [h('div.muted', { style: { fontSize: '11px', lineHeight: '1.5' } },
        anyHw ? 'GPU = the browser accepts a hardware-encoder request for that codec and size (NVENC on GeForce, Quick Sync on Intel, AMF on Radeon). Exports show which encoder they got in the Export dialog summary.'
          : 'No hardware encoder is exposed. In Chrome/Edge check chrome://gpu → "Video Encode: Hardware accelerated", update the GPU driver, and make sure hardware acceleration is on in the browser settings.'),
      h('div.muted', { style: { fontSize: '11px', marginTop: '6px' } }, 'Playback in the monitors decodes through <video> elements, which always use the GPU decoder when the driver offers one.')]);
    });
    return d;
  };
})();
