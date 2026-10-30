/* Cutline — WebGL2 compositor. Pipeline per clip: source texture -> effect chain (straight alpha, ping-pong)
   -> color grade -> transform into a frame-sized premultiplied layer -> layer effects -> transition -> blend into accumulator. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, S = C.Scene;

  var VS_FULL = '#version 300 es\nin vec2 a_pos; out vec2 v_uv; void main(){ v_uv=a_pos*0.5+0.5; gl_Position=vec4(a_pos,0.,1.); }';
  var VS_QUAD = '#version 300 es\nin vec2 a_pos; in vec2 a_uv; uniform vec2 u_res; out vec2 v_uv; void main(){ v_uv=a_uv; gl_Position=vec4(a_pos/u_res*2.-1.,0.,1.); }';
  var FS_HEAD = '#version 300 es\nprecision highp float;\nin vec2 v_uv; out vec4 o;\n';
  var FS_COPY = FS_HEAD + 'uniform sampler2D u_tex; void main(){ o=texture(u_tex,v_uv); }';
  var FS_TRANSFORM = FS_HEAD + 'uniform sampler2D u_tex; uniform float u_op; void main(){ vec4 c=texture(u_tex,v_uv); o=vec4(c.rgb*c.a,c.a)*u_op; }';
  var FS_PRESENT = FS_HEAD + 'uniform sampler2D u_tex; void main(){ vec4 c=texture(u_tex,vec2(v_uv.x,1.-v_uv.y)); o=vec4(c.rgb,1.); }';
  var FS_BLEND = FS_HEAD + [
    'uniform sampler2D u_dst, u_src; uniform int u_mode; uniform float u_op;',
    'float lum(vec3 c){ return dot(c,vec3(0.2126,0.7152,0.0722)); }',
    'vec3 setLum(vec3 c, float l){ float d=l-lum(c); c+=d; float L=lum(c); float n=min(c.r,min(c.g,c.b)); float x=max(c.r,max(c.g,c.b)); if(n<0.) c=L+(c-L)*L/max(L-n,1e-5); if(x>1.) c=L+(c-L)*(1.-L)/max(x-L,1e-5); return c; }',
    'vec3 bl(vec3 b, vec3 s){',
    ' if(u_mode==1) return b*s; if(u_mode==2) return 1.-(1.-b)*(1.-s);',
    ' if(u_mode==3) return mix(2.*b*s, 1.-2.*(1.-b)*(1.-s), step(0.5,b));',
    ' if(u_mode==4) return min(b+s,1.); if(u_mode==5) return max(b-s,0.);',
    ' if(u_mode==6) return min(b,s); if(u_mode==7) return max(b,s); if(u_mode==8) return abs(b-s); if(u_mode==9) return b+s-2.*b*s;',
    ' if(u_mode==10) return mix(b-(1.-2.*s)*b*(1.-b), b+(2.*s-1.)*(sqrt(b)-b), step(0.5,s));',
    ' if(u_mode==11) return mix(2.*b*s, 1.-2.*(1.-b)*(1.-s), step(0.5,s));',
    ' if(u_mode==12) return min(b/max(1.-s,1e-4),1.); if(u_mode==13) return 1.-min((1.-b)/max(s,1e-4),1.);',
    ' if(u_mode==14) return setLum(s,lum(b)); if(u_mode==15) return setLum(b,lum(s));',
    ' return s; }',
    'void main(){ vec4 d=texture(u_dst,v_uv); vec4 s=texture(u_src,v_uv)*u_op; float a=s.a; vec3 cs=a>0.0001?s.rgb/a:vec3(0.); vec3 r=d.rgb*(1.-a)+bl(d.rgb,cs)*a; o=vec4(r, a+d.a*(1.-a)); }'
  ].join('\n');
  var FS_CLEAR_EMPTY = FS_HEAD + 'void main(){ o=vec4(0.); }';
  // masks: alpha-multiply a straight-alpha source by the mask, or blend an effect's result into its input inside the mask
  var FS_MASK = FS_HEAD + 'uniform sampler2D u_tex, u_mask; void main(){ vec4 c=texture(u_tex,v_uv); o=vec4(c.rgb, c.a*texture(u_mask,v_uv).a); }';
  // track matte: premultiplied layer × matte coverage (luma of the straight colour × alpha, or alpha alone)
  var FS_TRACKMATTE = FS_HEAD + 'uniform sampler2D u_tex, u_matte; uniform int u_type, u_inv; uniform float u_soft;\n' +
    'void main(){ vec4 c=texture(u_tex,v_uv); vec4 m=texture(u_matte,v_uv); float k = (u_type==1) ? m.a : ((m.a>0.0001) ? dot(m.rgb/m.a, vec3(0.2126,0.7152,0.0722))*m.a : 0.0); if(u_inv==1) k=1.0-k; if(u_soft>0.0){ float s=u_soft*0.5; k=smoothstep(0.5-s,0.5+s,k);} o=c*k; }';
  var FS_MASKMIX = FS_HEAD + 'uniform sampler2D u_tex, u_orig, u_mask; void main(){ o=mix(texture(u_orig,v_uv), texture(u_tex,v_uv), texture(u_mask,v_uv).a); }';
  var FS_FRAMEMIX = FS_HEAD + 'uniform sampler2D u_tex, u_b; uniform float u_mix; void main(){ o=mix(texture(u_tex,v_uv), texture(u_b,v_uv), u_mix); }';

  var FS_COLOR = C.FX.PRELUDE + C.FX.LOOK_GLSL + [
    'uniform sampler2D u_lut; uniform float u_temp,u_tint,u_exp,u_con,u_hi,u_sh,u_wh,u_bl,u_sat,u_vib,u_fade,u_sharp,u_lookAmt; uniform float u_P[10];',
    'uniform vec3 u_shC,u_midC,u_hiC; uniform float u_shL,u_midL,u_hiL; uniform vec4 u_vig;',
    'void main(){ vec4 c=tex(v_uv); vec3 x=c.rgb;',
    ' if(u_sharp>0.){ vec2 d=1./u_size; vec3 b=(tex(v_uv+vec2(d.x,0.)).rgb+tex(v_uv-vec2(d.x,0.)).rgb+tex(v_uv+vec2(0.,d.y)).rgb+tex(v_uv-vec2(0.,d.y)).rgb)*0.25; x=clamp(x+(x-b)*u_sharp,0.,1.); }',
    ' x*=vec3(1.+u_temp*0.25, 1.-u_tint*0.2, 1.-u_temp*0.25); x.rb*=1.+u_tint*0.07;',
    ' x*=exp2(u_exp);',
    ' x=(x-0.5)*(1.+u_con)+0.5;',
    ' float l=luma(x); float shm=1.-smoothstep(0.,0.55,l); float him=smoothstep(0.45,1.,l);',
    ' x+=u_sh*0.35*shm*(1.-clamp(l,0.,1.)); x+=u_hi*0.35*him*(u_hi>0.?(1.-clamp(l,0.,1.)):clamp(l,0.,1.));',
    ' float bp=-u_bl*0.08, wp=1.-u_wh*0.12; x=(x-bp)/max(wp-bp,0.05);',
    ' l=clamp(luma(x),0.,1.);',
    ' x+=u_shC*(1.-l)*(1.-l)*0.6+u_shL*0.25*(1.-l)*(1.-l);',
    ' x=pow(max(x,0.),vec3(1./max(1.+u_midL*0.6,0.1)))+u_midC*4.*l*(1.-l)*0.35;',
    ' x=x*(1.+u_hiL*0.4)+u_hiC*l*l*0.6;',
    ' l=luma(x); x=mix(vec3(l),x,u_sat); float s=max(x.r,max(x.g,x.b))-min(x.r,min(x.g,x.b)); x=mix(vec3(luma(x)),x,1.+u_vib*(1.-clamp(s,0.,1.)));',
    ' x=clamp(x,0.,1.);',
    ' x=vec3(texture(u_lut,vec2(x.r*0.99609+0.00195,0.5)).r, texture(u_lut,vec2(x.g*0.99609+0.00195,0.5)).g, texture(u_lut,vec2(x.b*0.99609+0.00195,0.5)).b);',
    ' x=x*(1.-u_fade*0.25)+u_fade*0.12;',
    ' x=applyLook(x,u_P,u_lookAmt);',
    ' if(u_vig.x!=0.){ vec2 q=v_uv-0.5; float d=mix(max(abs(q.x),abs(q.y))*2.,length(q)*2.,u_vig.z); float m=smoothstep(u_vig.y,u_vig.y+u_vig.w,d); x = u_vig.x>0. ? x*(1.-m*u_vig.x) : mix(x,vec3(1.),m*-u_vig.x); }',
    ' o=vec4(clamp(x,0.,1.),c.a); }'
  ].join('\n');

  /* ---------- Curves LUT ---------- */
  C.Color = C.Color || {};
  // Monotone cubic interpolation through points [[x,y],...]
  C.Color.curveFn = function (pts) {
    pts = pts.slice().sort(function (a, b) { return a[0] - b[0]; });
    var n = pts.length;
    if (n < 2) return function (x) { return x; };
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
    var d = [], m = [];
    for (var i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      var a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { var t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    return function (x) {
      if (x <= xs[0]) return ys[0];
      if (x >= xs[n - 1]) return ys[n - 1];
      var k = 0; while (k < n - 2 && x > xs[k + 1]) k++;
      var h = xs[k + 1] - xs[k], t = (x - xs[k]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1];
    };
  };
  C.Color.lut = function (curves) {
    var out = new Uint8Array(256 * 4);
    var fm = C.Color.curveFn(curves.m), fr = C.Color.curveFn(curves.r), fg = C.Color.curveFn(curves.g), fb = C.Color.curveFn(curves.b);
    for (var i = 0; i < 256; i++) {
      var v = U.clamp(fm(i / 255), 0, 1);
      out[i * 4] = Math.round(U.clamp(fr(v), 0, 1) * 255);
      out[i * 4 + 1] = Math.round(U.clamp(fg(v), 0, 1) * 255);
      out[i * 4 + 2] = Math.round(U.clamp(fb(v), 0, 1) * 255);
      out[i * 4 + 3] = 255;
    }
    return out;
  };
  C.Color.wheelOffset = function (x, y) {
    var r = Math.min(1, Math.hypot(x, y) / 100);
    if (r < 1e-4) return [0, 0, 0];
    var h = (Math.atan2(y, x) / (2 * Math.PI) + 1) % 1;
    var k = function (n) { var t = (n + h * 6) % 6; return 1 - Math.max(0, Math.min(t, 4 - t, 1)); };
    var c = [k(5), k(3), k(1)];
    var l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return [(c[0] - l) * r * 0.5, (c[1] - l) * r * 0.5, (c[2] - l) * r * 0.5];
  };

  function GLComp(canvas) {
    this.canvas = canvas;
    var gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.kind = 'webgl2';
    this.progs = {}; this.free = []; this.texCache = {}; this.lutCache = {};
    var self = this;
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); self.lost = true; });
    canvas.addEventListener('webglcontextrestored', function () { self.lost = false; self.init(); C.bus.emit('rerender'); });
    this.init();
  }
  GLComp.prototype.init = function () {
    var gl = this.gl;
    this.progs = {}; this.free = []; this.texCache = {}; this.lutCache = {};
    this.fullBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fullBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.quadBuf = gl.createBuffer();
    this.vaoFull = gl.createVertexArray();
    this.vaoQuad = gl.createVertexArray();
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    this.placeholder = null;
    this.identityLut = null;
  };
  GLComp.prototype.compile = function (vs, fs, key) {
    var gl = this.gl;
    key = key || fs;
    if (this.progs[key]) return this.progs[key];
    function sh(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var log = gl.getShaderInfoLog(s); console.error('[Cutline] shader compile error:', log, '\n', src); throw new Error('Shader error: ' + log); }
      return s;
    }
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'a_pos'); gl.bindAttribLocation(p, 1, 'a_uv');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link error: ' + gl.getProgramInfoLog(p));
    var prog = { p: p, loc: {} };
    this.progs[key] = prog;
    return prog;
  };
  GLComp.prototype.loc = function (prog, name) {
    if (!(name in prog.loc)) prog.loc[name] = this.gl.getUniformLocation(prog.p, name);
    return prog.loc[name];
  };
  GLComp.prototype.setUniforms = function (prog, u, unitStart) {
    var gl = this.gl, unit = unitStart || 0;
    for (var k in u) {
      var v = u[k], l = this.loc(prog, k);
      if (l == null) continue;
      if (typeof v === 'number') gl.uniform1f(l, v);
      else if (v && typeof v.i === 'number') gl.uniform1i(l, v.i);
      else if (v instanceof WebGLTexture) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, v); gl.uniform1i(l, unit); unit++; }
      else if (Array.isArray(v) || v instanceof Float32Array) {
        if (k.indexOf('[') >= 0) gl.uniform1fv(l, v);
        else if (v.length === 2) gl.uniform2fv(l, v); else if (v.length === 3) gl.uniform3fv(l, v); else if (v.length === 4) gl.uniform4fv(l, v);
        else gl.uniform1fv(l, v);
      }
    }
    return unit;
  };
  GLComp.prototype.newTex = function (w, h, data) {
    var gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (w) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data || null);
    return t;
  };
  GLComp.prototype.getTarget = function (w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    for (var i = 0; i < this.free.length; i++) {
      var f = this.free[i];
      if (f.w === w && f.h === h) { this.free.splice(i, 1); return f; }
    }
    var gl = this.gl, tex = this.newTex(w, h), fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { w: w, h: h, tex: tex, fbo: fbo, rt: true };
  };
  GLComp.prototype.release = function (t) {
    if (!t || !t.rt) return;
    if (this.free.indexOf(t) >= 0) return;
    this.free.push(t);
    if (this.free.length > 24) { var x = this.free.shift(); this.gl.deleteTexture(x.tex); this.gl.deleteFramebuffer(x.fbo); }
  };
  GLComp.prototype.bindTarget = function (t, clear) {
    var gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
    gl.viewport(0, 0, t ? t.w : this.canvas.width, t ? t.h : this.canvas.height);
    if (clear) { gl.clearColor(clear[0], clear[1], clear[2], clear[3]); gl.clear(gl.COLOR_BUFFER_BIT); }
  };
  GLComp.prototype.drawFull = function () {
    var gl = this.gl;
    gl.bindVertexArray(this.vaoFull);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fullBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disableVertexAttribArray(1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  // run a fullscreen pass: frag uses u_tex (input), u_orig, u_size
  GLComp.prototype.pass = function (frag, input, out, uniforms, extra) {
    var gl = this.gl;
    var prog = this.compile(VS_FULL, frag);
    gl.useProgram(prog.p);
    this.bindTarget(out, null);
    var u = { u_tex: input.tex, u_size: [input.w, input.h], u_time: (extra && extra.time) || 0, u_px: (extra && extra.px) || 1 };
    if (extra && extra.orig) u.u_orig = extra.orig.tex; else u.u_orig = input.tex;
    var unit = this.setUniforms(prog, u, 0);
    if (uniforms) this.setUniforms(prog, uniforms, unit);
    this.drawFull();
  };

  GLComp.prototype.upload = function (key, el, ver, w, h) {
    var gl = this.gl, e = this.texCache[key];
    if (!el) { if (e) e.used = performance.now(); return e && e.w ? { tex: e.tex, w: e.w, h: e.h } : null; }
    if (!e) e = this.texCache[key] = { tex: this.newTex(0, 0), ver: null, w: 0, h: 0 };
    if (e.ver !== ver || ver == null) {
      gl.bindTexture(gl.TEXTURE_2D, e.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
        e.ver = ver; e.w = w; e.h = h;
      } catch (err) { if (!e.w) return null; }
    }
    e.used = performance.now();
    return e.w ? { tex: e.tex, w: e.w, h: e.h } : null;
  };
  GLComp.prototype.gcTextures = function (maxAge) {
    var now = performance.now(), gl = this.gl;
    for (var k in this.texCache) if (now - this.texCache[k].used > (maxAge || 15000)) { gl.deleteTexture(this.texCache[k].tex); delete this.texCache[k]; }
  };
  GLComp.prototype.getPlaceholder = function () {
    if (this.placeholder) return this.placeholder;
    var c = document.createElement('canvas'); c.width = 640; c.height = 360;
    var g = c.getContext('2d');
    g.fillStyle = '#2a1414'; g.fillRect(0, 0, 640, 360);
    g.strokeStyle = 'rgba(229,83,75,.35)'; g.lineWidth = 18;
    for (var i = -360; i < 640; i += 56) { g.beginPath(); g.moveTo(i, 360); g.lineTo(i + 360, 0); g.stroke(); }
    g.fillStyle = '#f2ebe3'; g.font = '700 34px sans-serif'; g.textAlign = 'center'; g.fillText('MEDIA OFFLINE', 320, 175);
    g.font = '18px sans-serif'; g.fillStyle = '#c8bdb1'; g.fillText('File › Relink Media…', 320, 210);
    this.placeholder = this.upload('__offline', c, 1, 640, 360);
    return this.placeholder;
  };
  GLComp.prototype.lutTex = function (curves) {
    var key = JSON.stringify(curves);
    if (this.lutCache[key]) return this.lutCache[key];
    var t = this.newTex(256, 1, C.Color.lut(curves));
    var keys = Object.keys(this.lutCache);
    if (keys.length > 32) { this.gl.deleteTexture(this.lutCache[keys[0]]); delete this.lutCache[keys[0]]; }
    this.lutCache[key] = t;
    return t;
  };

  GLComp.prototype.colorUniforms = function (col) {
    var lp = C.FX.LOOK_PARAMS[col.look] || C.FX.LOOK_PARAMS.none;
    return {
      u_lut: this.lutTex(col.curves || C.P.defaultColor().curves),
      u_temp: col.temp / 100, u_tint: col.tint / 100, u_exp: col.exposure, u_con: col.contrast / 100, u_hi: col.highlights / 100, u_sh: col.shadows / 100,
      u_wh: col.whites / 100, u_bl: col.blacks / 100, u_sat: col.sat / 100, u_vib: col.vib / 100, u_fade: col.fade / 100, u_sharp: col.sharpen / 40,
      u_lookAmt: col.look && col.look !== 'none' ? col.lookAmt / 100 : 0, 'u_P[0]': lp,
      u_shC: C.Color.wheelOffset(col.shX, col.shY), u_midC: C.Color.wheelOffset(col.midX, col.midY), u_hiC: C.Color.wheelOffset(col.hiX, col.hiY),
      u_shL: col.shL / 100, u_midL: col.midL / 100, u_hiL: col.hiL / 100,
      u_vig: [col.vig / 100, 0.3 + col.vigMid / 100 * 0.9, col.vigRound / 100, col.vigFeather / 100 * 0.9 + 0.01]
    };
  };

  // mask texture for a set of evaluated masks at w×h (cached by signature)
  GLComp.prototype.maskTex = function (key, masks, w, h, sw, sh) {
    var sig = C.Masks.sig(masks) + '|' + w + 'x' + h + '|' + sw;
    var e = this.texCache['mask:' + key];
    if (e && e.ver === sig) { e.used = performance.now(); return { tex: e.tex, w: w, h: h }; }
    var cv = C.Masks.canvas(masks, w, h, sw, sh, 'gl:' + key);
    return this.upload('mask:' + key, cv, sig, w, h);
  };
  // Apply a list of evaluated effects (+ optional color) to an input target/texture; returns new target (or input if nothing)
  // ctx.masks (evaluated masks) scope effects: an effect with masks is blended into its input inside the mask only.
  GLComp.prototype.applyChain = function (input, fx, col, w, h, ctx) {
    var cur = input, self = this;
    fx.forEach(function (e) {
      if (self.badFx && self.badFx[e.def.id]) return;
      var passes = e.def.passes || [{ frag: e.def.frag, uniforms: e.def.uniforms }];
      var mk = ctx.masks && ctx.masks.length ? C.Masks.forFx(ctx.masks, e.id) : [];
      if (mk.length) passes = passes.concat([{ maskMix: true }]);
      var orig = cur, interm = [];
      try {
        passes.forEach(function (ps) {
          var out = self.getTarget(w, h);
          if (ps.maskMix) {
            var mt = self.maskTex((ctx.maskKey || '') + '|' + e.id, mk, w, h, ctx.srcW || w, ctx.srcH || h);
            try { self.pass(FS_MASKMIX, cur, out, { u_mask: mt ? mt.tex : cur.tex }, { orig: orig }); }
            catch (err) { self.release(out); throw err; }
            if (cur !== orig && cur !== input) interm.push(cur);
            cur = out; return;
          }
          var u = ps.uniforms ? ps.uniforms(e.p, ctx) : {};
          try { self.pass(C.FX.PRELUDE + ps.frag, cur, out, u, { orig: orig, time: ctx.time, px: ctx.px }); }
          catch (err) { self.release(out); throw err; }
          if (cur !== orig && cur !== input) interm.push(cur);
          cur = out;
        });
      } catch (err) {
        // skip a broken effect rather than blanking the clip
        console.error('[Cutline] effect "' + e.def.name + '" failed and was bypassed:', err.message);
        self.badFx = self.badFx || {}; self.badFx[e.def.id] = true;
        interm.forEach(function (t) { if (t !== orig) self.release(t); });
        if (cur !== orig && cur !== input) self.release(cur);
        cur = orig; return;
      }
      interm.forEach(function (t) { self.release(t); });
      if (orig !== input && orig !== cur) self.release(orig);
    });
    if (col) {
      var out = self.getTarget(w, h);
      self.pass(FS_COLOR, cur, out, self.colorUniforms(col), { time: ctx.time, px: ctx.px });
      if (cur !== input) self.release(cur);
      cur = out;
      // 3D LUT after the grade (intensity keyframeable)
      var lrec = col.lut && C.LUT ? C.LUT.get(col.lut) : null, lamt = col.lutAmt == null ? 1 : col.lutAmt / 100;
      if (lrec && lamt > 0) {
        var lt = self.lut3dTex(lrec), out2 = self.getTarget(w, h);
        try { self.pass(C.LUT.FS, cur, out2, { u_lut3d: lt, u_n: lrec.size, u_amt: U.clamp(lamt, 0, 1) }, null); self.release(cur); cur = out2; }
        catch (err) { self.release(out2); console.error('[Cutline] LUT pass failed', err); }
      }
    }
    return cur;
  };
  GLComp.prototype.lut3dTex = function (rec) {
    this.lut3dCache = this.lut3dCache || {};
    var e = this.lut3dCache[rec.id];
    if (e) return e;
    var td = C.LUT.texData(rec), t = this.newTex(td.w, td.h, td.data);
    var keys = Object.keys(this.lut3dCache);
    if (keys.length > 12) { this.gl.deleteTexture(this.lut3dCache[keys[0]]); delete this.lut3dCache[keys[0]]; }
    this.lut3dCache[rec.id] = t;
    return t;
  };

  GLComp.prototype.renderClip = function (L, ctx) {
    var gl = this.gl, seq = ctx.seq, outW = ctx.outW, outH = ctx.outH;
    var tex, nestTarget = null, q0 = null;
    if (L.inner) {
      // nested sequence: compose the inner scene into a texture at the size it will be displayed
      q0 = S.quad(seq, L);
      var kk = Math.min(1, (outW / seq.w) * q0.fit * Math.max(1, Math.abs(q0.sx / q0.fit)));
      var iw = Math.max(2, Math.round(L.inner.w * kk)), ih = Math.max(2, Math.round(L.inner.h * kk));
      nestTarget = this.compose(L.inner, iw, ih, ctx.provider, { captions: false });
      tex = { tex: nestTarget.tex, w: iw, h: ih };
    } else {
      var src = L.offline ? null : ctx.provider.source(L, ctx);
      if (!src) tex = L.offline ? this.getPlaceholder() : null;
      else tex = this.upload(src.key, src.el, src.ver, src.w, src.h);
    }
    var layer = this.getTarget(outW, outH);
    this.bindTarget(layer, [0, 0, 0, 0]);
    if (!tex) return layer;
    var q = q0 || S.quad(seq, L);
    var sc = outW / seq.w;
    // processing size for source-stage effects
    var k = Math.min(1, sc * q.fit * Math.max(1, Math.abs(q.sx / q.fit))), pw = Math.max(2, Math.round(q.nw * k)), ph = Math.max(2, Math.round(q.nh * k));
    var input = { tex: tex.tex, w: tex.w, h: tex.h }, blendT = null;
    // frame blending (speed changes): mix the second decoded source frame in before any effect
    var bsrc = !L.inner && ctx.provider.blendSource ? ctx.provider.blendSource(L) : null;
    if (bsrc && bsrc.mix > 0) {
      var btex = this.upload(bsrc.key, bsrc.el, bsrc.ver, bsrc.w, bsrc.h);
      if (btex) { blendT = this.getTarget(tex.w, tex.h); this.pass(FS_FRAMEMIX, input, blendT, { u_b: btex.tex, u_mix: bsrc.mix }, null); input = blendT; }
    }
    var processed = input;
    var clipMasks = L.masks && L.masks.length ? C.Masks.forClip(L.masks) : [];
    if (L.fx.length || L.col || clipMasks.length) {
      var ectx = { time: ctx.time, px: pw / q.nw / q.fit, seqPx: sc, masks: L.masks, maskKey: ctx.provider.mode + ':' + L.clip.id, srcW: q.nw, srcH: q.nh };
      // effects read the raw texture at its own size: resample into proc size first if sizes differ much
      var base = input;
      if (input.w !== pw || input.h !== ph) { base = this.getTarget(pw, ph); this.pass(FS_COPY, input, base, null, null); }
      processed = this.applyChain(base, L.fx, L.col, pw, ph, ectx);
      if (clipMasks.length) { // whole-clip masks limit the clip's alpha after its effects
        var mt = this.maskTex(ectx.maskKey + '|clip', clipMasks, pw, ph, q.nw, q.nh);
        if (mt) { var mo = this.getTarget(pw, ph); this.pass(FS_MASK, processed, mo, { u_mask: mt.tex }, null); if (processed !== input && processed !== base) this.release(processed); processed = mo; }
      }
      if (base !== input && base !== processed) this.release(base);
    }
    // transform pass
    var prog = this.compile(VS_QUAD, FS_TRANSFORM, 'transform');
    gl.useProgram(prog.p);
    this.bindTarget(layer, null);
    var data = new Float32Array(16);
    var order = [0, 1, 3, 2];
    for (var i = 0; i < 4; i++) {
      var p = q.pts[order[i]], uv = q.uvs[order[i]];
      data[i * 4] = p[0] * sc; data[i * 4 + 1] = p[1] * sc; data[i * 4 + 2] = uv[0]; data[i * 4 + 3] = uv[1];
    }
    gl.bindVertexArray(this.vaoQuad);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    this.setUniforms(prog, { u_tex: processed.tex, u_res: [outW, outH], u_op: U.clamp(L.tf.op / 100, 0, 1) });
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (processed !== input) this.release(processed);
    if (blendT) this.release(blendT);
    if (nestTarget) this.release(nestTarget);
    if (L.lfx.length) {
      var lt = this.applyChain(layer, L.lfx, null, outW, outH, { time: ctx.time, px: sc });
      if (lt !== layer) { this.release(layer); layer = lt; }
    }
    return layer;
  };

  GLComp.prototype.blendInto = function (acc, layer, mode, op) {
    var gl = this.gl, out = this.getTarget(acc.w, acc.h);
    var prog = this.compile(VS_FULL, FS_BLEND, 'blend');
    gl.useProgram(prog.p);
    this.bindTarget(out, null);
    this.setUniforms(prog, { u_dst: acc.tex, u_src: layer.tex, u_mode: { i: S.blendIndex(mode) }, u_op: op == null ? 1 : op });
    this.drawFull();
    this.release(acc);
    return out;
  };

  GLComp.prototype.emptyTarget = function (w, h) { var t = this.getTarget(w, h); this.bindTarget(t, [0, 0, 0, 0]); return t; };

  GLComp.prototype.render = function (scene, outW, outH, provider, opts) {
    opts = opts || {};
    if (this.lost) return;
    var gl = this.gl;
    outW = Math.max(2, Math.round(outW)); outH = Math.max(2, Math.round(outH));
    if (opts.present !== false && (this.canvas.width !== outW || this.canvas.height !== outH)) { this.canvas.width = outW; this.canvas.height = outH; }
    var acc = this.compose(scene, outW, outH, provider, opts);
    if (opts.present !== false) {
      var pp = this.compile(VS_FULL, FS_PRESENT, 'present');
      gl.useProgram(pp.p);
      this.bindTarget(null, null);
      this.setUniforms(pp, { u_tex: acc.tex });
      this.drawFull();
    }
    if (this.last) this.release(this.last);
    this.last = acc;
    this.lastSize = [outW, outH];
  };
  // Show a pre-rendered frame (ImageBitmap / canvas) instead of composing: used by the render cache
  GLComp.prototype.presentBitmap = function (el, w, h) {
    if (this.lost) return false;
    var gl = this.gl;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    var t = this.upload('__rcache', el, (this.rcSerial = (this.rcSerial || 0) + 1), w, h); if (!t) return false;
    var tg = this.getTarget(w, h);
    this.pass(FS_COPY, { tex: t.tex, w: w, h: h }, tg, null, null);
    var pp = this.compile(VS_FULL, FS_PRESENT, 'present');
    gl.useProgram(pp.p); this.bindTarget(null, null); this.setUniforms(pp, { u_tex: tg.tex }); this.drawFull();
    if (this.last) this.release(this.last);
    this.last = tg; this.lastSize = [w, h];
    return true;
  };
  // Composite a scene into a new target (caller owns/releases it)
  GLComp.prototype.compose = function (scene, outW, outH, provider, opts) {
    opts = opts || {};
    var gl = this.gl, self = this;
    var ctx = { seq: scene.seq, outW: outW, outH: outH, provider: provider, time: scene.time, scene: scene };
    var bg = U.hexToRgb(scene.bg);
    var acc = this.getTarget(outW, outH);
    this.bindTarget(acc, [bg[0], bg[1], bg[2], 1]);
    var matteUsed = {};
    scene.layers.forEach(function (L, li) {
      if (matteUsed[li]) return; // this layer is someone's matte: not drawn on its own
      try {
        if (L.t === 'clip') {
          var tm = !L.adjust && L.lfx && L.lfx.filter(function (e) { return e.def && e.def.trackMatte; })[0];
          if (tm) {
            var lay0 = self.renderClip(L, ctx), mL = null;
            // the matte is the next clip up (a transition there contributes its incoming clip)
            for (var mi = li + 1; mi < scene.layers.length; mi++) { var cand = scene.layers[mi]; if (cand.t === 'clip' && !cand.adjust) { mL = cand; matteUsed[mi] = true; break; } if (cand.t === 'trans') { mL = cand.b || cand.a; matteUsed[mi] = true; break; } }
            var mt = mL ? self.renderClip(mL, ctx) : self.emptyTarget(outW, outH);
            var keyed = self.getTarget(outW, outH);
            self.pass(FS_TRACKMATTE, lay0, keyed, { u_matte: mt.tex, u_type: { i: tm.p.type === 'alpha' ? 1 : 0 }, u_inv: { i: tm.p.inv ? 1 : 0 }, u_soft: (tm.p.soft || 0) / 100 }, null);
            self.release(lay0); self.release(mt);
            acc = self.blendInto(acc, keyed, L.blend, 1);
            self.release(keyed);
            return;
          }
          if (L.adjust) {
            var fx = L.fx.concat(L.lfx);
            if (!fx.length && !L.col) return;
            var res = self.applyChain(acc, fx, L.col, outW, outH, { time: ctx.time, px: outW / scene.w, masks: L.masks, maskKey: provider.mode + ':' + L.clip.id, srcW: scene.w, srcH: scene.h });
            var cmk = L.masks && L.masks.length ? C.Masks.forClip(L.masks) : [];
            if (res !== acc && cmk.length) { // whole-clip mask on an adjustment clip: the adjustment only shows inside the mask
              var mt2 = self.maskTex(provider.mode + ':' + L.clip.id + '|clip', cmk, outW, outH, scene.w, scene.h), mixed = self.getTarget(outW, outH);
              self.pass(FS_MASKMIX, res, mixed, { u_mask: mt2 ? mt2.tex : res.tex }, { orig: acc }); self.release(res); res = mixed;
            }
            if (res !== acc) { acc = self.blendInto(acc, res, L.blend, U.clamp(L.tf.op / 100, 0, 1)); self.release(res); }
          } else {
            var lay = self.renderClip(L, ctx);
            acc = self.blendInto(acc, lay, L.blend, 1);
            self.release(lay);
          }
        } else if (L.t === 'trans') {
          var la = L.a && !L.a.adjust ? self.renderClip(L.a, ctx) : self.emptyTarget(outW, outH);
          var lb = L.b && !L.b.adjust ? self.renderClip(L.b, ctx) : self.emptyTarget(outW, outH);
          var out = self.getTarget(outW, outH);
          var prog = self.compile(VS_FULL, C.TR.PRELUDE + L.def.frag);
          gl.useProgram(prog.p);
          self.bindTarget(out, null);
          var u = { u_a: la.tex, u_b: lb.tex, u_p: L.p, u_size: [outW, outH], u_time: ctx.time };
          var unit = self.setUniforms(prog, u, 0);
          if (L.def.uniforms) self.setUniforms(prog, L.def.uniforms(L.params, { px: outW / scene.w }), unit);
          self.drawFull();
          self.release(la); self.release(lb);
          acc = self.blendInto(acc, out, L.blend, 1);
          self.release(out);
        }
      } catch (e) { console.error('[Cutline] layer render failed', e); }
    });
    if (scene.caption && opts.captions !== false) {
      var cc = provider.captionCanvas(scene, outW, outH);
      if (cc) {
        var ct = this.upload('__caption' + (provider.mode || ''), cc.el, cc.ver, outW, outH);
        var layer = this.getTarget(outW, outH);
        var prog2 = this.compile(VS_FULL, FS_TRANSFORM, 'capxf');
        gl.useProgram(prog2.p); this.bindTarget(layer, [0, 0, 0, 0]);
        this.setUniforms(prog2, { u_tex: ct.tex, u_op: 1 }); this.drawFull();
        acc = this.blendInto(acc, layer, 'normal', 1);
        this.release(layer);
      }
    }
    return acc;
  };

  // Read back a downscaled copy of the last frame (top-down RGBA)
  GLComp.prototype.readSmall = function (w, h) {
    if (!this.last || this.lost) return null;
    var gl = this.gl, t = this.getTarget(w, h);
    var prog = this.compile(VS_FULL, FS_COPY, 'copy');
    gl.useProgram(prog.p); this.bindTarget(t, null);
    this.setUniforms(prog, { u_tex: this.last.tex }); this.drawFull();
    var px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    this.release(t);
    return px;
  };
  // Full-resolution readback of last frame (top-down)
  GLComp.prototype.readFull = function () {
    if (!this.last) return null;
    var gl = this.gl, w = this.last.w, h = this.last.h, px = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.last.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { w: w, h: h, data: px };
  };
  GLComp.prototype.destroy = function () {
    var ext = this.gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext();
  };

  C.GLComp = GLComp;
  void FS_CLEAR_EMPTY;
})();
