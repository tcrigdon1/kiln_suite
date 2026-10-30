/* Cutline — colour additions: .cube 3D LUT import (stored in the project, applied after the clip grade with an
   intensity), HSL secondary qualifier effect, colour-match effect (statistics transfer), halation / bloom. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, FX = C.FX;

  /* ---------- LUTs ---------- */
  var LUT = C.LUT = {};
  // parse a .cube text: { size, data: Uint8Array(size^3*3) } with red varying fastest (the .cube convention)
  LUT.parseCube = function (text) {
    var size = 0, size1d = 0, lo = [0, 0, 0], hi = [1, 1, 1], vals = [], title = '';
    text.split(/\r?\n/).forEach(function (line) {
      line = line.trim(); if (!line || line[0] === '#') return;
      var up = line.toUpperCase();
      if (up.indexOf('LUT_3D_SIZE') === 0) { size = parseInt(line.split(/\s+/)[1], 10); return; }
      if (up.indexOf('LUT_1D_SIZE') === 0) { size1d = parseInt(line.split(/\s+/)[1], 10); return; }
      if (up.indexOf('DOMAIN_MIN') === 0) { lo = line.split(/\s+/).slice(1, 4).map(parseFloat); return; }
      if (up.indexOf('DOMAIN_MAX') === 0) { hi = line.split(/\s+/).slice(1, 4).map(parseFloat); return; }
      if (up.indexOf('TITLE') === 0) { title = line.replace(/^TITLE\s*/i, '').replace(/^"|"$/g, ''); return; }
      if (/^[-+0-9.eE]/.test(line)) { var p = line.split(/\s+/); if (p.length >= 3) vals.push(+p[0], +p[1], +p[2]); }
    });
    if (!size) {
      if (size1d) throw new Error('This is a 1D LUT (LUT_1D_SIZE). Cutline imports 3D LUTs (LUT_3D_SIZE).');
      throw new Error('Not a .cube 3D LUT (no LUT_3D_SIZE line)');
    }
    if (size < 2 || size > 65) throw new Error('Unsupported LUT size ' + size);
    if (vals.length < size * size * size * 3) throw new Error('LUT has ' + (vals.length / 3) + ' entries, expected ' + size * size * size);
    var n = size * size * size, data = new Uint8Array(n * 3);
    for (var i = 0; i < n * 3; i++) { var c = i % 3, v = (vals[i] - lo[c]) / ((hi[c] - lo[c]) || 1); data[i] = Math.round(U.clamp(v, 0, 1) * 255); }
    return { size: size, data: data, title: title };
  };
  function b64(u8) { var s = ''; for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  function unb64(s) { var bin = atob(s), u8 = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; }
  LUT.list = function () { var p = C.state.project; return p && p.luts || []; };
  LUT.get = function (id) { return LUT.list().filter(function (l) { return l.id === id; })[0] || null; };
  // add a parsed LUT to the project (deduplicated by content); returns the record
  LUT.add = function (prj, name, parsed) {
    prj.luts = prj.luts || [];
    var data = b64(parsed.data), dup = prj.luts.filter(function (l) { return l.size === parsed.size && l.data === data; })[0];
    if (dup) return dup;
    var rec = { id: U.uid('lut'), name: name.replace(/\.cube$/i, ''), size: parsed.size, data: data, added: Date.now() };
    prj.luts.push(rec);
    return rec;
  };
  // RGBA pixels for the 2D-tiled 3D texture: size tiles (one per blue slice) side by side, each size×size (x = red, y = green)
  LUT.texData = function (rec) {
    if (rec.__tex) return rec.__tex;
    var N = rec.size, src = unb64(rec.data), W = N * N, out = new Uint8Array(W * N * 4);
    for (var b = 0; b < N; b++) for (var g = 0; g < N; g++) for (var r = 0; r < N; r++) {
      var i = ((b * N + g) * N + r) * 3, o = (g * W + b * N + r) * 4;
      out[o] = src[i]; out[o + 1] = src[i + 1]; out[o + 2] = src[i + 2]; out[o + 3] = 255;
    }
    rec.__tex = { w: W, h: N, data: out }; return rec.__tex;
  };
  // sample the LUT on the CPU (trilinear) — used by tests and by the colour panel preview swatch
  LUT.sample = function (rec, r, g, b) {
    var N = rec.size, src = rec.__raw || (rec.__raw = unb64(rec.data));
    function at(ri, gi, bi, c) { return src[((bi * N + gi) * N + ri) * 3 + c] / 255; }
    var x = U.clamp(r, 0, 1) * (N - 1), y = U.clamp(g, 0, 1) * (N - 1), z = U.clamp(b, 0, 1) * (N - 1);
    var x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z), x1 = Math.min(N - 1, x0 + 1), y1 = Math.min(N - 1, y0 + 1), z1 = Math.min(N - 1, z0 + 1), fx = x - x0, fy = y - y0, fz = z - z0, out = [0, 0, 0];
    for (var c = 0; c < 3; c++) {
      var c00 = at(x0, y0, z0, c) * (1 - fx) + at(x1, y0, z0, c) * fx, c10 = at(x0, y1, z0, c) * (1 - fx) + at(x1, y1, z0, c) * fx;
      var c01 = at(x0, y0, z1, c) * (1 - fx) + at(x1, y0, z1, c) * fx, c11 = at(x0, y1, z1, c) * (1 - fx) + at(x1, y1, z1, c) * fx;
      out[c] = (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz;
    }
    return out;
  };
  // GLSL: trilinear lookup in the tiled texture
  LUT.FS = C.FX.PRELUDE + 'uniform sampler2D u_lut3d; uniform float u_n, u_amt;\n' +
    'vec3 lut(vec3 c){ float n=u_n; vec2 texel=vec2(1./(n*n),1./n); float z=clamp(c.b,0.,1.)*(n-1.); float z0=floor(z), z1=min(n-1.,z0+1.), fz=z-z0;' +
    ' vec2 uv=vec2((clamp(c.r,0.,1.)*(n-1.)+0.5)/(n*n), (clamp(c.g,0.,1.)*(n-1.)+0.5)/n);' +
    ' vec3 a=texture(u_lut3d, uv+vec2(z0/n,0.)).rgb; vec3 b=texture(u_lut3d, uv+vec2(z1/n,0.)).rgb; return mix(a,b,fz); }\n' +
    'void main(){ vec4 c=tex(v_uv); o=vec4(mix(c.rgb, lut(c.rgb), u_amt), c.a); }';

  function r(k, name, min, max, def, step, unit) { return { k: k, name: name, type: 'range', min: min, max: max, def: def, step: step || 1, unit: unit || '' }; }
  function col(k, name, def) { return { k: k, name: name, type: 'color', def: def }; }
  function sel(k, name, opts, def) { return { k: k, name: name, type: 'select', options: opts, def: def }; }
  function bool(k, name, def) { return { k: k, name: name, type: 'bool', def: !!def }; }

  /* ---------- HSL secondary ---------- */
  FX.reg({ id: 'hslsec', name: 'HSL Secondary', cat: 'Color', params: [
      r('hue', 'Hue Centre', 0, 360, 25, 1, '°'), r('hw', 'Hue Range', 0, 180, 30, 1, '°'), r('hs', 'Hue Softness', 0, 90, 15, 1, '°'),
      r('s0', 'Saturation Min', 0, 100, 15, 1, '%'), r('s1', 'Saturation Max', 0, 100, 100, 1, '%'), r('l0', 'Luma Min', 0, 100, 0, 1, '%'), r('l1', 'Luma Max', 0, 100, 100, 1, '%'), r('soft', 'Sat / Luma Softness', 0, 50, 10, 1, '%'),
      r('dh', 'Hue Shift', -180, 180, 0, 1, '°'), r('ds', 'Saturation', -100, 100, 0, 1, '%'), r('dl', 'Lightness', -100, 100, 0, 1, '%'), r('dt', 'Temperature', -100, 100, 0), bool('mask', 'Show Mask', false)],
    frag: 'uniform float u_hue,u_hw,u_hs,u_s0,u_s1,u_l0,u_l1,u_soft,u_dh,u_ds,u_dl,u_dt; uniform int u_mask;\n' +
      'void main(){ vec4 c=tex(v_uv); vec3 hsv=rgb2hsv(c.rgb); float l=luma(c.rgb);' +
      ' float dh=abs(hsv.x-u_hue); dh=min(dh,1.-dh); float mh=1.-smoothstep(u_hw, u_hw+u_hs+1e-4, dh);' +
      ' float ms=smoothstep(u_s0-u_soft, u_s0+1e-4, hsv.y)*(1.-smoothstep(u_s1, u_s1+u_soft+1e-4, hsv.y));' +
      ' float ml=smoothstep(u_l0-u_soft, u_l0+1e-4, l)*(1.-smoothstep(u_l1, u_l1+u_soft+1e-4, l));' +
      ' float m=mh*ms*ml; if(u_mask==1){ o=vec4(vec3(m),c.a); return; }' +
      ' vec3 h2=hsv; h2.x=fract(h2.x+u_dh); h2.y=clamp(h2.y*(1.+u_ds),0.,1.); vec3 x=hsv2rgb(h2); x = u_dl>0. ? mix(x,vec3(1.),u_dl) : x*(1.+u_dl);' +
      ' x*=vec3(1.+u_dt*0.25,1.,1.-u_dt*0.25); o=vec4(mix(c.rgb,clamp(x,0.,1.),m),c.a); }',
    uniforms: function (p) { return { u_hue: p.hue / 360, u_hw: p.hw / 360, u_hs: p.hs / 360, u_s0: p.s0 / 100, u_s1: p.s1 / 100, u_l0: p.l0 / 100, u_l1: p.l1 / 100, u_soft: p.soft / 100, u_dh: p.dh / 360, u_ds: p.ds / 100, u_dl: p.dl / 100, u_dt: p.dt / 100, u_mask: { i: p.mask ? 1 : 0 } }; } });

  /* ---------- Colour match (per-channel gain + offset from the two clips' statistics) ---------- */
  FX.reg({ id: 'colormatch', name: 'Color Match', cat: 'Color', params: [r('amt', 'Amount', 0, 100, 100, 1, '%'), r('gr', 'Gain R', 0.2, 4, 1, 0.001), r('gg', 'Gain G', 0.2, 4, 1, 0.001), r('gb', 'Gain B', 0.2, 4, 1, 0.001), r('or', 'Offset R', -1, 1, 0, 0.001), r('og', 'Offset G', -1, 1, 0, 0.001), r('ob', 'Offset B', -1, 1, 0, 0.001)],
    frag: 'uniform vec3 u_gain,u_off; uniform float u_amt; void main(){ vec4 c=tex(v_uv); vec3 x=clamp(c.rgb*u_gain+u_off,0.,1.); o=vec4(mix(c.rgb,x,u_amt),c.a); }',
    uniforms: function (p) { return { u_gain: [p.gr, p.gg, p.gb], u_off: [p.or, p.og, p.ob], u_amt: p.amt / 100 }; } });
  // mean / std per channel of RGBA pixels
  C.LUT.stats = function (px, w, h) {
    var n = w * h, m = [0, 0, 0], v = [0, 0, 0], i, c;
    for (i = 0; i < n; i++) for (c = 0; c < 3; c++) m[c] += px[i * 4 + c] / 255;
    for (c = 0; c < 3; c++) m[c] /= n;
    for (i = 0; i < n; i++) for (c = 0; c < 3; c++) { var d = px[i * 4 + c] / 255 - m[c]; v[c] += d * d; }
    return { mean: m, std: v.map(function (q) { return Math.sqrt(q / n); }) };
  };
  // parameters that map target statistics onto the reference's: out = (in − μt)·(σr/σt) + μr
  C.LUT.matchParams = function (target, ref) {
    var p = { amt: 100 };
    ['r', 'g', 'b'].forEach(function (ch, c) {
      var g = U.clamp(ref.std[c] / Math.max(0.01, target.std[c]), 0.2, 4);
      p['g' + ch] = Math.round(g * 1000) / 1000; p['o' + ch] = Math.round(U.clamp(ref.mean[c] - target.mean[c] * g, -1, 1) * 1000) / 1000;
    });
    return p;
  };

  /* ---------- Halation / bloom ---------- */
  var BLUR1D = 'uniform vec2 u_dir; uniform float u_r; void main(){ if(u_r<0.5){ o=tex(v_uv); return; } vec4 acc=vec4(0.); float wsum=0.; float sig=max(u_r/2.5,0.5); float st=max(1.,u_r/12.); for(int i=-12;i<=12;i++){ float x=float(i)*st; float w=exp(-x*x/(2.*sig*sig)); vec4 s=tex(v_uv+u_dir*x/u_size); acc+=s*w; wsum+=w; } o=acc/wsum; }';
  FX.reg({ id: 'halation', name: 'Halation / Bloom', cat: 'Looks', params: [sel('mode', 'Mode', [['halation', 'Halation (film: warm red bleed around highlights)'], ['bloom', 'Bloom (soft white glow)']], 'halation'), r('th', 'Threshold', 0, 100, 65, 1, '%'), r('r', 'Radius', 2, 120, 30, 0.5, ' px'), r('amt', 'Amount', 0, 200, 60, 1, '%'), col('tint', 'Halation Tint', '#ff5a2e')],
    passes: [
      { frag: 'uniform float u_th; uniform int u_mode; void main(){ vec4 c=tex(v_uv); float l=luma(c.rgb); float m=smoothstep(u_th,u_th+0.2,l); vec3 g=c.rgb*m; if(u_mode==0){ g=vec3(max(g.r,max(g.g,g.b))*m); } o=vec4(g,1.); }', uniforms: function (p) { return { u_th: p.th / 100, u_mode: { i: p.mode === 'halation' ? 0 : 1 } }; } },
      { frag: BLUR1D, uniforms: function (p, ctx) { return { u_dir: [1, 0], u_r: p.r * ctx.px }; } },
      { frag: BLUR1D, uniforms: function (p, ctx) { return { u_dir: [0, 1], u_r: p.r * ctx.px }; } },
      { frag: 'uniform float u_amt; uniform vec3 u_tint; uniform int u_mode; void main(){ vec4 g=tex(v_uv); vec4 c=texture(u_orig,v_uv); vec3 add = u_mode==0 ? g.rgb*u_tint : g.rgb; vec3 x = 1.-(1.-c.rgb)*(1.-clamp(add*u_amt,0.,1.)); o=vec4(clamp(x,0.,1.),c.a); }', uniforms: function (p) { return { u_amt: p.amt / 100, u_tint: U.hexToRgb(p.tint), u_mode: { i: p.mode === 'halation' ? 0 : 1 } }; } }
    ] });

  /* ---------- False colour (exposure map) ---------- */
  // bands by luma (approximate IRE): purple <2, blue 2–10, teal 10–20, green 42–48 (18% grey), pink 52–58 (skin), yellow 78–90, red >94
  C.LUT.FALSE_BANDS = [[0, 0.02, [120, 0, 170], 'black clip'], [0.02, 0.10, [40, 60, 220], 'deep shadow'], [0.10, 0.20, [40, 160, 190], 'shadow'], [0.40, 0.50, [60, 190, 60], '18% grey'], [0.52, 0.62, [235, 130, 190], 'skin'], [0.78, 0.90, [240, 220, 60], 'highlight'], [0.94, 1.01, [230, 40, 40], 'clip']];
  C.LUT.falseColor = function (l) {
    var b = C.LUT.FALSE_BANDS;
    for (var i = 0; i < b.length; i++) if (l >= b[i][0] && l < b[i][1]) return b[i][2];
    var g = Math.round(l * 255); return [g, g, g];
  };
})();
