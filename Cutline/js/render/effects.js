/* Cutline — effect registry. Video effects are WebGL2 fragment shaders (straight alpha in, straight alpha out,
   except stage:'layer' effects which run on premultiplied frame-sized layers). Audio effects build Web Audio nodes. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util;
  var FX = C.FX = { list: [], byId: {} };

  // GLSL prelude shared by all effect shaders
  FX.PRELUDE = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 v_uv; out vec4 o;',
    'uniform sampler2D u_tex; uniform sampler2D u_orig; uniform vec2 u_size; uniform float u_time; uniform float u_px;',
    'float luma(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }',
    'vec3 rgb2hsv(vec3 c){ vec4 K=vec4(0.,-1./3.,2./3.,-1.); vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g)); vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r)); float d=q.x-min(q.w,q.y); float e=1.0e-10; return vec3(abs(q.z+(q.w-q.y)/(6.*d+e)),d/(q.x+e),q.x); }',
    'vec3 hsv2rgb(vec3 c){ vec3 p=abs(fract(c.xxx+vec3(1.,2./3.,1./3.))*6.-3.); return c.z*mix(vec3(1.),clamp(p-1.,0.,1.),c.y); }',
    'float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }',
    'vec4 tex(vec2 uv){ return texture(u_tex, uv); }',
    ''
  ].join('\n');

  function reg(def) {
    def.stage = def.stage || 'source';
    def.params = def.params || [];
    FX.list.push(def); FX.byId[def.id] = def;
  }
  FX.reg = reg;
  FX.defaults = function (id) {
    var d = FX.byId[id], p = {};
    if (!d) return p;
    d.params.forEach(function (q) { p[q.k] = U.clone(q.def); });
    return p;
  };
  FX.newInstance = function (id) { return { id: U.uid('fx'), type: id, on: true, p: FX.defaults(id) }; };
  FX.CATS = ['Color', 'Looks', 'Blur & Sharpen', 'Stylize', 'Distort', 'Keying', 'Layer', 'Audio'];

  function r(k, name, min, max, def, step, unit) { return { k: k, name: name, type: 'range', min: min, max: max, def: def, step: step || 1, unit: unit || '' }; }
  function col(k, name, def) { return { k: k, name: name, type: 'color', def: def }; }
  function sel(k, name, opts, def) { return { k: k, name: name, type: 'select', options: opts, def: def }; }
  function bool(k, name, def) { return { k: k, name: name, type: 'bool', def: !!def }; }
  function rgb(hex) { return U.hexToRgb(hex); }

  /* ======================= COLOR ======================= */
  reg({ id: 'brightness', name: 'Brightness & Contrast', cat: 'Color', params: [r('b', 'Brightness', -100, 100, 0), r('c', 'Contrast', -100, 100, 0)],
    frag: 'uniform float u_b, u_c; void main(){ vec4 c=tex(v_uv); vec3 x=c.rgb+u_b; x=(x-0.5)*u_c+0.5; o=vec4(clamp(x,0.,1.),c.a); }',
    uniforms: function (p) { return { u_b: p.b / 200, u_c: p.c >= 0 ? 1 + p.c / 50 : 1 + p.c / 100 }; },
    filter2d: function (p) { return 'brightness(' + (1 + p.b / 100) + ') contrast(' + (1 + p.c / 100) + ')'; } });
  reg({ id: 'exposure', name: 'Exposure', cat: 'Color', params: [r('ev', 'Exposure', -4, 4, 0, 0.05, ' stops'), r('off', 'Offset', -0.5, 0.5, 0, 0.01), r('gam', 'Gamma', 0.2, 3, 1, 0.01)],
    frag: 'uniform float u_ev,u_off,u_gam; void main(){ vec4 c=tex(v_uv); vec3 x=c.rgb*pow(2.,u_ev)+u_off; x=pow(max(x,0.),vec3(1./u_gam)); o=vec4(clamp(x,0.,1.),c.a); }',
    uniforms: function (p) { return { u_ev: p.ev, u_off: p.off, u_gam: p.gam }; },
    filter2d: function (p) { return 'brightness(' + Math.pow(2, p.ev) + ')'; } });
  reg({ id: 'saturation', name: 'Saturation & Vibrance', cat: 'Color', params: [r('s', 'Saturation', 0, 300, 100, 1, '%'), r('v', 'Vibrance', -100, 100, 0)],
    frag: 'uniform float u_s,u_v; void main(){ vec4 c=tex(v_uv); float l=luma(c.rgb); vec3 x=mix(vec3(l),c.rgb,u_s); float mx=max(x.r,max(x.g,x.b)), mn=min(x.r,min(x.g,x.b)); float sat=mx-mn; x=mix(vec3(luma(x)),x,1.+u_v*(1.-sat)); o=vec4(clamp(x,0.,1.),c.a); }',
    uniforms: function (p) { return { u_s: p.s / 100, u_v: p.v / 100 }; },
    filter2d: function (p) { return 'saturate(' + p.s / 100 + ')'; } });
  reg({ id: 'hue', name: 'Hue Shift', cat: 'Color', params: [r('h', 'Hue', -180, 180, 0, 1, '°'), r('s', 'Saturation', -100, 100, 0), r('l', 'Lightness', -100, 100, 0)],
    frag: 'uniform float u_h,u_s,u_l; void main(){ vec4 c=tex(v_uv); vec3 h=rgb2hsv(c.rgb); h.x=fract(h.x+u_h); h.y=clamp(h.y*(1.+u_s),0.,1.); vec3 x=hsv2rgb(h); x = u_l>0. ? mix(x,vec3(1.),u_l) : x*(1.+u_l); o=vec4(x,c.a); }',
    uniforms: function (p) { return { u_h: p.h / 360, u_s: p.s / 100, u_l: p.l / 100 }; },
    filter2d: function (p) { return 'hue-rotate(' + p.h + 'deg)'; } });
  reg({ id: 'temptint', name: 'Temperature & Tint', cat: 'Color', params: [r('t', 'Temperature', -100, 100, 0), r('g', 'Tint', -100, 100, 0)],
    frag: 'uniform float u_t,u_g; void main(){ vec4 c=tex(v_uv); vec3 x=c.rgb; x.r*=1.+u_t*0.3; x.b*=1.-u_t*0.3; x.g*=1.-u_g*0.25; x.rb*=1.+u_g*0.08; o=vec4(clamp(x,0.,1.),c.a); }',
    uniforms: function (p) { return { u_t: p.t / 100, u_g: p.g / 100 }; } });
  reg({ id: 'lgg', name: 'Lift / Gamma / Gain', cat: 'Color', params: [
      r('lm', 'Lift', -50, 50, 0), r('lr', 'Lift Red', -50, 50, 0), r('lg', 'Lift Green', -50, 50, 0), r('lb', 'Lift Blue', -50, 50, 0),
      r('gm', 'Gamma', -50, 50, 0), r('gr', 'Gamma Red', -50, 50, 0), r('gg', 'Gamma Green', -50, 50, 0), r('gb', 'Gamma Blue', -50, 50, 0),
      r('am', 'Gain', -50, 50, 0), r('ar', 'Gain Red', -50, 50, 0), r('ag', 'Gain Green', -50, 50, 0), r('ab', 'Gain Blue', -50, 50, 0)],
    frag: 'uniform vec3 u_l,u_g,u_a; void main(){ vec4 c=tex(v_uv); vec3 x=c.rgb*u_a; x=x+u_l*(1.-x); x=pow(max(x,0.),1./u_g); o=vec4(clamp(x,0.,1.),c.a); }',
    uniforms: function (p) {
      return { u_l: [(p.lm + p.lr) / 200, (p.lm + p.lg) / 200, (p.lm + p.lb) / 200],
        u_g: [Math.pow(2, (p.gm + p.gr) / 50), Math.pow(2, (p.gm + p.gg) / 50), Math.pow(2, (p.gm + p.gb) / 50)],
        u_a: [1 + (p.am + p.ar) / 100, 1 + (p.am + p.ag) / 100, 1 + (p.am + p.ab) / 100] };
    } });
  reg({ id: 'curves', name: 'Curves (Simple)', cat: 'Color', params: [r('sh', 'Shadows', -50, 50, 0), r('lm', 'Low Mids', -50, 50, 0), r('md', 'Midtones', -50, 50, 0), r('hm', 'High Mids', -50, 50, 0), r('hi', 'Highlights', -50, 50, 0), sel('ch', 'Channel', [['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']], 'rgb')],
    frag: 'uniform float u_p[7]; uniform vec3 u_mask;\n' +
      'float cr(float p0,float p1,float p2,float p3,float t){ return 0.5*((2.*p1)+(-p0+p2)*t+(2.*p0-5.*p1+4.*p2-p3)*t*t+(-p0+3.*p1-3.*p2+p3)*t*t*t); }\n' +
      'float curve(float x){ float s=clamp(x,0.,1.)*6.; int i=int(min(floor(s),5.)); float t=s-float(i); float p0=u_p[max(i-1,0)], p1=u_p[i], p2=u_p[min(i+1,6)], p3=u_p[min(i+2,6)]; return clamp(cr(p0,p1,p2,p3,t),0.,1.); }\n' +
      'void main(){ vec4 c=tex(v_uv); vec3 y=vec3(curve(c.r),curve(c.g),curve(c.b)); o=vec4(mix(c.rgb,y,u_mask),c.a); }',
    uniforms: function (p) {
      var b = [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1];
      var adj = [0, p.sh, p.lm, p.md, p.hm, p.hi, 0];
      return { 'u_p[0]': b.map(function (v, i) { return v + adj[i] / 200; }), u_mask: p.ch === 'rgb' ? [1, 1, 1] : p.ch === 'r' ? [1, 0, 0] : p.ch === 'g' ? [0, 1, 0] : [0, 0, 1] };
    } });
  reg({ id: 'bw', name: 'Black & White', cat: 'Color', params: [r('amt', 'Amount', 0, 100, 100, 1, '%'), r('r', 'Red Filter', -100, 200, 30), r('g', 'Green Filter', -100, 200, 59), r('b', 'Blue Filter', -100, 200, 11), r('tint', 'Tint Amount', 0, 100, 0), col('tc', 'Tint Color', '#d9a066')],
    frag: 'uniform float u_amt,u_ta; uniform vec3 u_w,u_tc; void main(){ vec4 c=tex(v_uv); float l=clamp(dot(c.rgb,u_w),0.,1.); vec3 g=vec3(l); vec3 t=mix(g, g*u_tc*1.4, u_ta); o=vec4(mix(c.rgb,clamp(t,0.,1.),u_amt),c.a); }',
    uniforms: function (p) { var s = (p.r + p.g + p.b) / 100 || 1; return { u_amt: p.amt / 100, u_w: [p.r / 100 / s, p.g / 100 / s, p.b / 100 / s], u_ta: p.tint / 100, u_tc: rgb(p.tc) }; },
    filter2d: function (p) { return 'grayscale(' + p.amt / 100 + ')'; } });
  reg({ id: 'sepia', name: 'Sepia', cat: 'Color', params: [r('amt', 'Amount', 0, 100, 100, 1, '%')],
    frag: 'uniform float u_amt; void main(){ vec4 c=tex(v_uv); vec3 s=vec3(dot(c.rgb,vec3(.393,.769,.189)),dot(c.rgb,vec3(.349,.686,.168)),dot(c.rgb,vec3(.272,.534,.131))); o=vec4(mix(c.rgb,clamp(s,0.,1.),u_amt),c.a); }',
    uniforms: function (p) { return { u_amt: p.amt / 100 }; }, filter2d: function (p) { return 'sepia(' + p.amt / 100 + ')'; } });
  reg({ id: 'invert', name: 'Invert', cat: 'Color', params: [r('amt', 'Amount', 0, 100, 100, 1, '%'), sel('ch', 'Channel', [['rgb', 'RGB'], ['luma', 'Luma only'], ['a', 'Alpha']], 'rgb')],
    frag: 'uniform float u_amt; uniform int u_ch; void main(){ vec4 c=tex(v_uv); vec4 x=c; if(u_ch==0) x.rgb=1.-c.rgb; else if(u_ch==1){ float l=luma(c.rgb); x.rgb=c.rgb+(1.-2.*l); } else x.a=1.-c.a; o=mix(c,clamp(x,0.,1.),u_amt); }',
    uniforms: function (p) { return { u_amt: p.amt / 100, u_ch: { i: p.ch === 'rgb' ? 0 : p.ch === 'luma' ? 1 : 2 } }; }, filter2d: function (p) { return 'invert(' + p.amt / 100 + ')'; } });
  reg({ id: 'posterize', name: 'Posterize', cat: 'Color', params: [r('lv', 'Levels', 2, 32, 6)],
    frag: 'uniform float u_lv; void main(){ vec4 c=tex(v_uv); o=vec4(floor(c.rgb*u_lv+0.5)/u_lv,c.a); }',
    uniforms: function (p) { return { u_lv: p.lv - 1 }; } });
  reg({ id: 'duotone', name: 'Duotone', cat: 'Color', params: [col('c1', 'Shadow Color', '#1b2a4a'), col('c2', 'Highlight Color', '#f0913a'), r('amt', 'Amount', 0, 100, 100, 1, '%'), r('con', 'Contrast', -50, 100, 0)],
    frag: 'uniform vec3 u_c1,u_c2; uniform float u_amt,u_con; void main(){ vec4 c=tex(v_uv); float l=clamp((luma(c.rgb)-.5)*u_con+.5,0.,1.); o=vec4(mix(c.rgb,mix(u_c1,u_c2,l),u_amt),c.a); }',
    uniforms: function (p) { return { u_c1: rgb(p.c1), u_c2: rgb(p.c2), u_amt: p.amt / 100, u_con: 1 + p.con / 50 }; } });
  reg({ id: 'colorreplace', name: 'Color Replace', cat: 'Color', params: [col('from', 'Target Color', '#d03030'), col('to', 'Replace With', '#3dbfae'), r('tol', 'Tolerance', 0, 100, 25), r('soft', 'Softness', 0, 100, 20), bool('keepL', 'Keep Luminance', true)],
    frag: 'uniform vec3 u_from,u_to; uniform float u_tol,u_soft; uniform int u_kl; void main(){ vec4 c=tex(v_uv); vec3 a=rgb2hsv(c.rgb), b=rgb2hsv(u_from); float dh=abs(a.x-b.x); dh=min(dh,1.-dh); float d=dh*2.+abs(a.y-b.y)*0.5; float m=1.-smoothstep(u_tol,u_tol+u_soft+0.001,d); m*=smoothstep(0.05,0.2,a.y); vec3 t=u_to; if(u_kl==1){ vec3 th=rgb2hsv(u_to); t=hsv2rgb(vec3(th.x,th.y*a.y/max(b.y,0.01),a.z)); } o=vec4(mix(c.rgb,clamp(t,0.,1.),m),c.a); }',
    uniforms: function (p) { return { u_from: rgb(p.from), u_to: rgb(p.to), u_tol: p.tol / 200, u_soft: p.soft / 200, u_kl: { i: p.keepL ? 1 : 0 } }; } });
  reg({ id: 'levels', name: 'Levels', cat: 'Color', params: [r('ib', 'Input Black', 0, 254, 0), r('iw', 'Input White', 1, 255, 255), r('g', 'Gamma', 0.1, 4, 1, 0.01), r('ob', 'Output Black', 0, 255, 0), r('ow', 'Output White', 0, 255, 255)],
    frag: 'uniform float u_ib,u_iw,u_g,u_ob,u_ow; void main(){ vec4 c=tex(v_uv); vec3 x=clamp((c.rgb-u_ib)/max(u_iw-u_ib,0.001),0.,1.); x=pow(x,vec3(1./u_g)); x=mix(vec3(u_ob),vec3(u_ow),x); o=vec4(x,c.a); }',
    uniforms: function (p) { return { u_ib: p.ib / 255, u_iw: p.iw / 255, u_g: p.g, u_ob: p.ob / 255, u_ow: p.ow / 255 }; } });

  /* ======================= LOOKS (original procedural presets) ======================= */
  FX.LOOKS = [
    ['none', 'None'], ['ember', 'Teal & Ember'], ['faded', 'Faded Film'], ['bleach', 'Silver Bleach'], ['night', 'Moonlit'],
    ['dusk', 'Warm Dusk'], ['steel', 'Cold Steel'], ['cross', 'Cross Process'], ['matte', 'Pastel Matte'], ['noir', 'Hard Noir'], ['kodak', 'Golden Hour Stock']
  ];
  // look parameters: [shadowTint r,g,b, highlightTint r,g,b, sat, contrast, fade, warmth]
  FX.LOOK_PARAMS = {
    none: [0, 0, 0, 0, 0, 0, 1, 1, 0, 0],
    ember: [-0.06, 0.02, 0.07, 0.07, 0.02, -0.06, 1.05, 1.12, 0.02, 0.02],
    faded: [0.03, 0.02, 0.05, 0.02, 0.01, -0.03, 0.78, 0.86, 0.12, 0.03],
    bleach: [0, 0, 0.01, 0.01, 0.01, 0.0, 0.45, 1.3, 0.0, 0.0],
    night: [-0.03, 0.0, 0.08, -0.04, 0.0, 0.06, 0.6, 1.1, 0.03, -0.12],
    dusk: [0.04, -0.01, -0.03, 0.08, 0.03, -0.05, 1.08, 1.05, 0.03, 0.1],
    steel: [-0.02, 0.01, 0.05, -0.02, 0.02, 0.05, 0.7, 1.15, 0.0, -0.08],
    cross: [0.0, 0.06, -0.06, 0.06, 0.06, -0.08, 1.25, 1.2, 0.0, 0.0],
    matte: [0.05, 0.03, 0.06, 0.03, 0.02, 0.03, 0.75, 0.8, 0.16, 0.02],
    noir: [0, 0, 0, 0, 0, 0, 0.0, 1.45, 0.02, 0.0],
    kodak: [0.03, 0.0, -0.04, 0.06, 0.04, -0.02, 1.1, 1.08, 0.04, 0.07]
  };
  FX.LOOK_GLSL = 'vec3 applyLook(vec3 x, float P[10], float amt){ vec3 y=x; y.r+=P[9]*0.15; y.b-=P[9]*0.15; float l=luma(y); y=mix(vec3(l),y,P[6]); y=(y-0.5)*P[7]+0.5; float ll=clamp(luma(y),0.,1.); y+=vec3(P[0],P[1],P[2])*(1.-ll)*2.+vec3(P[3],P[4],P[5])*ll*2.; y=mix(y,vec3(0.5)+y*0.5,0.)+P[8]*(1.-y)*0.6; return mix(x,clamp(y,0.,1.),amt); }\n';
  reg({ id: 'look', name: 'Film Look', cat: 'Looks', params: [sel('look', 'Look', FX.LOOKS.slice(1), 'ember'), r('amt', 'Intensity', 0, 100, 100, 1, '%')],
    frag: FX.LOOK_GLSL + 'uniform float u_P[10]; uniform float u_amt; void main(){ vec4 c=tex(v_uv); o=vec4(applyLook(c.rgb,u_P,u_amt),c.a); }',
    uniforms: function (p) { return { 'u_P[0]': FX.LOOK_PARAMS[p.look] || FX.LOOK_PARAMS.none, u_amt: p.amt / 100 }; } });

  /* ======================= BLUR & SHARPEN ======================= */
  var BLUR1D = 'uniform vec2 u_dir; uniform float u_r; void main(){ if(u_r<0.5){ o=tex(v_uv); return; } vec4 acc=vec4(0.); float wsum=0.; float sig=max(u_r/2.5,0.5); float st=max(1.,u_r/12.); for(int i=-12;i<=12;i++){ float x=float(i)*st; float w=exp(-x*x/(2.*sig*sig)); vec4 s=tex(v_uv+u_dir*x/u_size); s.rgb*=s.a; acc+=s*w; wsum+=w; } acc/=wsum; o=vec4(acc.a>0.0001?acc.rgb/acc.a:vec3(0.),acc.a); }';
  reg({ id: 'gblur', name: 'Gaussian Blur', cat: 'Blur & Sharpen', params: [r('r', 'Radius', 0, 120, 12, 0.5, ' px'), sel('dir', 'Direction', [['both', 'Both'], ['h', 'Horizontal'], ['v', 'Vertical']], 'both'), bool('rep', 'Repeat Edges', true)],
    passes: [
      { frag: BLUR1D, uniforms: function (p, ctx) { return { u_dir: [1, 0], u_r: p.dir === 'v' ? 0 : p.r * ctx.px }; } },
      { frag: BLUR1D, uniforms: function (p, ctx) { return { u_dir: [0, 1], u_r: p.dir === 'h' ? 0 : p.r * ctx.px }; } }
    ], filter2d: function (p) { return 'blur(' + p.r + 'px)'; } });
  reg({ id: 'dblur', name: 'Directional Blur', cat: 'Blur & Sharpen', params: [r('len', 'Length', 0, 200, 30, 1, ' px'), r('ang', 'Angle', -180, 180, 0, 1, '°')],
    frag: 'uniform vec2 u_d; void main(){ vec4 acc=vec4(0.); for(int i=-16;i<=16;i++){ vec4 s=tex(v_uv+u_d*float(i)/16./u_size); s.rgb*=s.a; acc+=s; } acc/=33.; o=vec4(acc.a>0.0001?acc.rgb/acc.a:vec3(0.),acc.a); }',
    uniforms: function (p, ctx) { var a = p.ang * Math.PI / 180, l = p.len * ctx.px / 2; return { u_d: [Math.cos(a) * l, Math.sin(a) * l] }; } });
  reg({ id: 'rblur', name: 'Radial Zoom Blur', cat: 'Blur & Sharpen', params: [r('amt', 'Amount', 0, 100, 20), r('cx', 'Center X', 0, 100, 50, 1, '%'), r('cy', 'Center Y', 0, 100, 50, 1, '%')],
    frag: 'uniform float u_amt; uniform vec2 u_c; void main(){ vec4 acc=vec4(0.); vec2 d=v_uv-u_c; for(int i=0;i<24;i++){ float s=1.-u_amt*float(i)/24.; vec4 t=tex(u_c+d*s); t.rgb*=t.a; acc+=t; } acc/=24.; o=vec4(acc.a>0.0001?acc.rgb/acc.a:vec3(0.),acc.a); }',
    uniforms: function (p) { return { u_amt: p.amt / 300, u_c: [p.cx / 100, p.cy / 100] }; } });
  reg({ id: 'sharpen', name: 'Sharpen', cat: 'Blur & Sharpen', params: [r('amt', 'Amount', 0, 300, 60), r('r', 'Radius', 0.5, 5, 1, 0.1, ' px')],
    frag: 'uniform float u_amt,u_r; void main(){ vec2 d=u_r/u_size; vec4 c=tex(v_uv); vec3 b=(tex(v_uv+vec2(d.x,0.)).rgb+tex(v_uv-vec2(d.x,0.)).rgb+tex(v_uv+vec2(0.,d.y)).rgb+tex(v_uv-vec2(0.,d.y)).rgb)*0.25; o=vec4(clamp(c.rgb+(c.rgb-b)*u_amt,0.,1.),c.a); }',
    uniforms: function (p, ctx) { return { u_amt: p.amt / 50, u_r: Math.max(0.5, p.r * ctx.px) }; } });
  reg({ id: 'tiltshift', name: 'Tilt-Shift', cat: 'Blur & Sharpen', params: [r('pos', 'Focus Position', 0, 100, 55, 1, '%'), r('width', 'Focus Width', 0, 100, 18, 1, '%'), r('soft', 'Transition', 1, 100, 25, 1, '%'), r('r', 'Blur', 0, 60, 18, 0.5, ' px'), r('sat', 'Saturation Boost', 0, 100, 20)],
    frag: 'uniform float u_pos,u_w,u_soft,u_r,u_sat; void main(){ float d=abs(v_uv.y-u_pos); float m=smoothstep(u_w*0.5,u_w*0.5+u_soft,d); vec4 acc=vec4(0.); float tot=0.; for(int i=0;i<36;i++){ float fi=float(i); float a=fi*2.39996; float rr=sqrt((fi+0.5)/36.); vec2 off=vec2(cos(a),sin(a))*rr*u_r*m/u_size; vec4 s=tex(v_uv+off); s.rgb*=s.a; acc+=s; tot+=1.; } acc/=tot; vec3 x=acc.a>0.0001?acc.rgb/acc.a:vec3(0.); x=mix(vec3(luma(x)),x,1.+u_sat); o=vec4(clamp(x,0.,1.),acc.a); }',
    uniforms: function (p, ctx) { return { u_pos: p.pos / 100, u_w: p.width / 100, u_soft: p.soft / 100, u_r: p.r * ctx.px, u_sat: p.sat / 100 }; } });
  reg({ id: 'glow', name: 'Glow', cat: 'Blur & Sharpen', params: [r('th', 'Threshold', 0, 100, 60, 1, '%'), r('r', 'Radius', 1, 80, 20, 0.5, ' px'), r('amt', 'Intensity', 0, 300, 100, 1, '%'), col('tint', 'Tint', '#ffffff')],
    passes: [
      { frag: 'uniform float u_th; void main(){ vec4 c=tex(v_uv); float l=luma(c.rgb); o=vec4(c.rgb*smoothstep(u_th,u_th+0.15,l),c.a); }', uniforms: function (p) { return { u_th: p.th / 100 }; } },
      { frag: BLUR1D, uniforms: function (p, ctx) { return { u_dir: [1, 0], u_r: p.r * ctx.px }; } },
      { frag: BLUR1D, uniforms: function (p, ctx) { return { u_dir: [0, 1], u_r: p.r * ctx.px }; } },
      { frag: 'uniform float u_amt; uniform vec3 u_tint; void main(){ vec4 g=tex(v_uv); vec4 c=texture(u_orig,v_uv); o=vec4(clamp(c.rgb+g.rgb*u_tint*u_amt,0.,1.),c.a); }', uniforms: function (p) { return { u_amt: p.amt / 100, u_tint: rgb(p.tint) }; } }
    ] });

  /* ======================= STYLIZE ======================= */
  reg({ id: 'vignette', name: 'Vignette', cat: 'Stylize', params: [r('amt', 'Amount', -100, 100, 50), r('size', 'Size', 0, 100, 50), r('round', 'Roundness', 0, 100, 60), r('feather', 'Feather', 1, 100, 50), col('c', 'Color', '#000000')],
    frag: 'uniform float u_amt,u_vs,u_round,u_f; uniform vec3 u_c; void main(){ vec4 c=tex(v_uv); vec2 q=v_uv-0.5; float d=mix(max(abs(q.x),abs(q.y))*2., length(q)*2., u_round); float m=smoothstep(u_vs, u_vs+u_f, d); vec3 x = u_amt>=0. ? mix(c.rgb,u_c,m*u_amt) : mix(c.rgb,vec3(1.),m*-u_amt); o=vec4(x,c.a); }',
    uniforms: function (p) { return { u_amt: p.amt / 100, u_vs: 0.3 + p.size / 100 * 0.9, u_round: p.round / 100, u_f: p.feather / 100 * 0.9 + 0.01, u_c: rgb(p.c) }; } });
  reg({ id: 'grain', name: 'Film Grain', cat: 'Stylize', params: [r('amt', 'Amount', 0, 100, 25), r('size', 'Size', 1, 6, 1.5, 0.1), r('col', 'Color Noise', 0, 100, 10), bool('anim', 'Animate', true)],
    frag: 'uniform float u_amt,u_sz,u_col,u_seed; void main(){ vec4 c=tex(v_uv); vec2 g=floor(v_uv*u_size/u_sz); float n=hash(g+u_seed)-0.5; vec3 cn=vec3(hash(g+u_seed+1.7),hash(g+u_seed+3.1),hash(g+u_seed+5.3))-0.5; vec3 nn=mix(vec3(n),cn,u_col); float l=luma(c.rgb); float w=1.-abs(l-0.5)*1.2; o=vec4(clamp(c.rgb+nn*u_amt*w,0.,1.),c.a); }',
    uniforms: function (p, ctx) { return { u_amt: p.amt / 160, u_sz: Math.max(1, p.size * ctx.px), u_col: p.col / 100, u_seed: p.anim ? Math.floor(ctx.time * 24) % 997 * 1.37 : 0.0 }; } });
  reg({ id: 'chroma_ab', name: 'Chromatic Aberration', cat: 'Stylize', params: [r('amt', 'Amount', 0, 40, 6, 0.1, ' px'), sel('mode', 'Mode', [['radial', 'Radial'], ['linear', 'Linear']], 'radial'), r('ang', 'Angle', -180, 180, 0, 1, '°')],
    frag: 'uniform float u_amt; uniform int u_mode; uniform vec2 u_dir; void main(){ vec2 d = u_mode==0 ? (v_uv-0.5)*2.*u_amt/u_size : u_dir*u_amt/u_size; vec4 c=tex(v_uv); float r=tex(v_uv+d).r; float b=tex(v_uv-d).b; o=vec4(r,c.g,b,c.a); }',
    uniforms: function (p, ctx) { var a = p.ang * Math.PI / 180; return { u_amt: p.amt * ctx.px, u_mode: { i: p.mode === 'radial' ? 0 : 1 }, u_dir: [Math.cos(a), Math.sin(a)] }; } });
  reg({ id: 'glitch', name: 'Glitch', cat: 'Stylize', params: [r('amt', 'Amount', 0, 100, 40), r('block', 'Block Size', 2, 100, 24), r('speed', 'Speed', 0, 30, 10), r('split', 'Color Split', 0, 50, 12, 1, ' px'), r('scan', 'Scanlines', 0, 100, 20)],
    frag: 'uniform float u_amt,u_block,u_t,u_split,u_scan; void main(){ vec2 uv=v_uv; float row=floor(uv.y*u_size.y/u_block); float tt=floor(u_t); float n=hash(vec2(row,tt)); float shift=(n>1.-u_amt*0.5)?(hash(vec2(row*1.3,tt+1.))-0.5)*0.15*u_amt:0.; uv.x+=shift; float bl=hash(vec2(floor(uv.x*u_size.x/(u_block*3.)),row+tt*7.)); vec4 c=tex(uv); float sp=u_split/u_size.x*(0.5+n); float r=tex(uv+vec2(sp,0.)).r, b=tex(uv-vec2(sp,0.)).b; vec3 x=vec3(r,c.g,b); if(bl>1.-u_amt*0.08) x=x.gbr; x*=1.-u_scan*0.35*step(0.5,fract(uv.y*u_size.y/3.)); o=vec4(x,c.a); }',
    uniforms: function (p, ctx) { return { u_amt: p.amt / 100, u_block: Math.max(1, p.block * ctx.px), u_t: ctx.time * p.speed, u_split: p.split * ctx.px * p.amt / 50, u_scan: p.scan / 100 }; } });
  reg({ id: 'pixelate', name: 'Pixelate', cat: 'Stylize', params: [r('size', 'Cell Size', 1, 200, 16, 1, ' px')],
    frag: 'uniform float u_s; void main(){ vec2 cell=u_s/u_size; vec2 uv=(floor(v_uv/cell)+0.5)*cell; o=tex(uv); }',
    uniforms: function (p, ctx) { return { u_s: Math.max(1, p.size * ctx.px) }; } });
  reg({ id: 'mirror', name: 'Mirror', cat: 'Stylize', params: [sel('mode', 'Mode', [['h', 'Left → Right'], ['h2', 'Right → Left'], ['v', 'Top → Bottom'], ['v2', 'Bottom → Top'], ['quad', 'Quad']], 'h')],
    frag: 'uniform int u_m; void main(){ vec2 uv=v_uv; if(u_m==0) uv.x = uv.x>0.5?1.-uv.x:uv.x; else if(u_m==1) uv.x = uv.x<0.5?1.-uv.x:uv.x; else if(u_m==2) uv.y = uv.y>0.5?1.-uv.y:uv.y; else if(u_m==3) uv.y=uv.y<0.5?1.-uv.y:uv.y; else { uv = 1.-abs(v_uv-0.5)*2.; } o=tex(uv); }',
    uniforms: function (p) { return { u_m: { i: ['h', 'h2', 'v', 'v2', 'quad'].indexOf(p.mode) } }; } });
  reg({ id: 'kaleido', name: 'Kaleidoscope', cat: 'Stylize', params: [r('seg', 'Segments', 2, 24, 6), r('ang', 'Rotation', -180, 180, 0, 1, '°'), r('zoom', 'Zoom', 20, 300, 100, 1, '%')],
    frag: 'uniform float u_seg,u_ang,u_zoom; void main(){ vec2 p=(v_uv-0.5)*vec2(u_size.x/u_size.y,1.); float r=length(p)/u_zoom; float a=atan(p.y,p.x)+u_ang; float s=6.28318/u_seg; a=mod(a,s); a=abs(a-s*0.5); vec2 q=vec2(cos(a),sin(a))*r; q.x/=u_size.x/u_size.y; o=tex(clamp(q+0.5,0.,1.)); }',
    uniforms: function (p) { return { u_seg: p.seg, u_ang: p.ang * Math.PI / 180, u_zoom: p.zoom / 100 }; } });
  reg({ id: 'edges', name: 'Edge Detect', cat: 'Stylize', params: [r('amt', 'Strength', 0, 500, 150), bool('inv', 'Invert', false), r('mix', 'Blend With Original', 0, 100, 0, 1, '%'), bool('color', 'Keep Color', false)],
    frag: 'uniform float u_amt,u_mix; uniform int u_inv,u_colr; void main(){ vec2 d=1./u_size; float tl=luma(tex(v_uv+vec2(-d.x,-d.y)).rgb), t=luma(tex(v_uv+vec2(0.,-d.y)).rgb), tr=luma(tex(v_uv+vec2(d.x,-d.y)).rgb), l=luma(tex(v_uv+vec2(-d.x,0.)).rgb), r=luma(tex(v_uv+vec2(d.x,0.)).rgb), bl=luma(tex(v_uv+vec2(-d.x,d.y)).rgb), b=luma(tex(v_uv+vec2(0.,d.y)).rgb), br=luma(tex(v_uv+vec2(d.x,d.y)).rgb); float gx=-tl-2.*l-bl+tr+2.*r+br, gy=-tl-2.*t-tr+bl+2.*b+br; float e=clamp(length(vec2(gx,gy))*u_amt,0.,1.); if(u_inv==1) e=1.-e; vec4 c=tex(v_uv); vec3 x=u_colr==1? c.rgb*e : vec3(e); o=vec4(mix(x,c.rgb,u_mix),c.a); }',
    uniforms: function (p) { return { u_amt: p.amt / 100, u_inv: { i: p.inv ? 1 : 0 }, u_mix: p.mix / 100, u_colr: { i: p.color ? 1 : 0 } }; } });
  reg({ id: 'emboss', name: 'Emboss', cat: 'Stylize', params: [r('amt', 'Strength', 0, 400, 150), r('ang', 'Light Angle', -180, 180, 45, 1, '°'), r('mix', 'Blend With Original', 0, 100, 0, 1, '%')],
    frag: 'uniform float u_amt,u_mix; uniform vec2 u_d; void main(){ vec4 c=tex(v_uv); float a=luma(tex(v_uv-u_d/u_size).rgb), b=luma(tex(v_uv+u_d/u_size).rgb); float e=clamp(0.5+(b-a)*u_amt,0.,1.); o=vec4(mix(vec3(e),c.rgb*e*2.,u_mix),c.a); }',
    uniforms: function (p, ctx) { var a = p.ang * Math.PI / 180; return { u_amt: p.amt / 50, u_mix: p.mix / 100, u_d: [Math.cos(a) * 1.5 * Math.max(1, ctx.px), Math.sin(a) * 1.5 * Math.max(1, ctx.px)] }; } });
  reg({ id: 'halftone', name: 'Halftone Dots', cat: 'Stylize', params: [r('size', 'Dot Size', 3, 80, 10, 1, ' px'), r('ang', 'Angle', 0, 90, 45, 1, '°'), bool('color', 'Color Dots', true), col('ink', 'Ink', '#141210'), col('paper', 'Paper', '#f2ebe3')],
    frag: 'uniform float u_s,u_a; uniform int u_colr; uniform vec3 u_ink,u_paper; void main(){ vec2 px=v_uv*u_size; mat2 R=mat2(cos(u_a),-sin(u_a),sin(u_a),cos(u_a)); vec2 q=R*px; vec2 cell=floor(q/u_s); vec2 cc=(cell+0.5)*u_s; vec2 src=transpose(R)*cc; vec4 c=tex(src/u_size); float l=luma(c.rgb); float rad=sqrt(1.-l)*u_s*0.62; float d=length(q-cc); float m=1.-smoothstep(rad-1.,rad+1.,d); vec3 ink = u_colr==1 ? c.rgb*0.85 : u_ink; o=vec4(mix(u_colr==1?vec3(1.):u_paper, ink, m), c.a); }',
    uniforms: function (p, ctx) { return { u_s: Math.max(2, p.size * ctx.px), u_a: p.ang * Math.PI / 180, u_colr: { i: p.color ? 1 : 0 }, u_ink: rgb(p.ink), u_paper: rgb(p.paper) }; } });
  reg({ id: 'scanlines', name: 'Retro Scanlines', cat: 'Stylize', params: [r('amt', 'Amount', 0, 100, 40), r('lines', 'Line Spacing', 2, 12, 3, 1, ' px'), r('curve', 'Screen Curve', 0, 100, 15), r('flicker', 'Flicker', 0, 100, 10)],
    frag: 'uniform float u_amt,u_ls,u_cur,u_fl; void main(){ vec2 p=v_uv*2.-1.; p*=1.+u_cur*dot(p,p)*0.15; vec2 uv=p*0.5+0.5; if(uv.x<0.||uv.x>1.||uv.y<0.||uv.y>1.){ o=vec4(0.,0.,0.,1.); return; } vec4 c=tex(uv); float s=0.5+0.5*sin(uv.y*u_size.y/u_ls*3.14159); vec3 x=c.rgb*(1.-u_amt*(1.-s)*0.8); x*=1.-u_fl; o=vec4(x,c.a); }',
    uniforms: function (p, ctx) { return { u_amt: p.amt / 100, u_ls: Math.max(1, p.lines * ctx.px), u_cur: p.curve / 100, u_fl: (Math.sin(ctx.time * 60) * 0.5 + 0.5) * p.flicker / 400 }; } });

  /* ======================= DISTORT ======================= */
  reg({ id: 'lens', name: 'Lens Distortion', cat: 'Distort', params: [r('amt', 'Curvature', -100, 100, 30), r('zoom', 'Zoom', 50, 200, 100, 1, '%'), bool('fill', 'Fill Edges', true)],
    frag: 'uniform float u_k,u_z; uniform int u_fill; void main(){ vec2 p=(v_uv-0.5)*vec2(u_size.x/u_size.y,1.); float r2=dot(p,p); vec2 q=p*(1.+u_k*r2)/u_z; q.x/=u_size.x/u_size.y; vec2 uv=q+0.5; if(u_fill==0 && (uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.)) { o=vec4(0.); return; } o=tex(clamp(uv,0.,1.)); }',
    uniforms: function (p) { return { u_k: p.amt / 100, u_z: p.zoom / 100, u_fill: { i: p.fill ? 1 : 0 } }; } });
  reg({ id: 'wave', name: 'Wave Warp', cat: 'Distort', params: [r('amp', 'Amplitude', 0, 100, 12, 1, ' px'), r('len', 'Wavelength', 10, 800, 120, 1, ' px'), r('speed', 'Speed', -10, 10, 1, 0.1), sel('dir', 'Direction', [['h', 'Horizontal'], ['v', 'Vertical'], ['both', 'Both']], 'h')],
    frag: 'uniform float u_amp,u_len,u_ph; uniform int u_dir; void main(){ vec2 px=v_uv*u_size; vec2 off=vec2(0.); if(u_dir!=1) off.x=sin(px.y/u_len*6.2832+u_ph)*u_amp; if(u_dir!=0) off.y=sin(px.x/u_len*6.2832+u_ph)*u_amp; o=tex(clamp((px+off)/u_size,0.,1.)); }',
    uniforms: function (p, ctx) { return { u_amp: p.amp * ctx.px, u_len: Math.max(1, p.len * ctx.px), u_ph: ctx.time * p.speed * 6.2832, u_dir: { i: p.dir === 'h' ? 0 : p.dir === 'v' ? 1 : 2 } }; } });
  reg({ id: 'twirl', name: 'Twirl', cat: 'Distort', params: [r('ang', 'Angle', -720, 720, 120, 1, '°'), r('rad', 'Radius', 1, 100, 45, 1, '%'), r('cx', 'Center X', 0, 100, 50, 1, '%'), r('cy', 'Center Y', 0, 100, 50, 1, '%')],
    frag: 'uniform float u_a,u_r; uniform vec2 u_c; void main(){ float asp=u_size.x/u_size.y; vec2 p=(v_uv-u_c)*vec2(asp,1.); float d=length(p); float t=clamp(1.-d/u_r,0.,1.); float a=u_a*t*t; vec2 q=vec2(p.x*cos(a)-p.y*sin(a),p.x*sin(a)+p.y*cos(a)); q.x/=asp; o=tex(clamp(q+u_c,0.,1.)); }',
    uniforms: function (p) { return { u_a: p.ang * Math.PI / 180, u_r: p.rad / 100, u_c: [p.cx / 100, p.cy / 100] }; } });
  reg({ id: 'bulge', name: 'Bulge / Pinch', cat: 'Distort', params: [r('amt', 'Amount', -100, 100, 40), r('rad', 'Radius', 1, 100, 35, 1, '%'), r('cx', 'Center X', 0, 100, 50, 1, '%'), r('cy', 'Center Y', 0, 100, 50, 1, '%')],
    frag: 'uniform float u_k,u_r; uniform vec2 u_c; void main(){ float asp=u_size.x/u_size.y; vec2 p=(v_uv-u_c)*vec2(asp,1.); float d=length(p); if(d<u_r){ float t=d/u_r; float f=u_k>0.? pow(t, 1.+u_k*1.5)/max(t,0.0001) : pow(t, 1./(1.-u_k*1.5))/max(t,0.0001); p*=mix(f,1.,smoothstep(0.85,1.,t)); } p.x/=asp; o=tex(clamp(p+u_c,0.,1.)); }',
    uniforms: function (p) { return { u_k: p.amt / 100, u_r: p.rad / 100, u_c: [p.cx / 100, p.cy / 100] }; } });
  reg({ id: 'shake', name: 'Camera Shake', cat: 'Distort', params: [r('amt', 'Amount', 0, 100, 20), r('freq', 'Frequency', 0.2, 20, 4, 0.1), r('rot', 'Rotation', 0, 10, 1, 0.1, '°'), r('zoom', 'Overscan', 100, 140, 108, 1, '%')],
    frag: 'uniform vec2 u_off; uniform float u_rot,u_z; void main(){ float asp=u_size.x/u_size.y; vec2 p=(v_uv-0.5)*vec2(asp,1.); p=vec2(p.x*cos(u_rot)-p.y*sin(u_rot),p.x*sin(u_rot)+p.y*cos(u_rot))/u_z; p.x/=asp; o=tex(clamp(p+0.5+u_off,0.,1.)); }',
    uniforms: function (p, ctx) {
      var t = ctx.time * p.freq, n = function (s) { return Math.sin(t * 1.7 + s) * 0.5 + Math.sin(t * 3.1 + s * 2.3) * 0.3 + Math.sin(t * 5.3 + s * 4.1) * 0.2; };
      return { u_off: [n(1) * p.amt / 1500, n(7) * p.amt / 1500], u_rot: n(13) * p.rot * Math.PI / 180, u_z: p.zoom / 100 };
    } });

  /* ======================= KEYING ======================= */
  reg({ id: 'chromakey', name: 'Chroma Key', cat: 'Keying', params: [col('key', 'Key Color', '#00ff00'), r('tol', 'Tolerance', 0, 100, 30), r('soft', 'Softness', 0, 100, 12), r('spill', 'Spill Suppression', 0, 100, 60), r('choke', 'Choke', -20, 20, 0), bool('matte', 'Show Matte', false)],
    frag: 'uniform vec3 u_key; uniform float u_tol,u_soft,u_spill,u_choke; uniform int u_matte;\n' +
      'vec2 uvc(vec3 c){ return vec2(-0.1146*c.r-0.3854*c.g+0.5*c.b, 0.5*c.r-0.4542*c.g-0.0458*c.b); }\n' +
      'void main(){ vec4 c=tex(v_uv); vec2 a=uvc(c.rgb), k=uvc(u_key); float d=distance(a,k)/0.7071; float m=smoothstep(u_tol-u_choke, u_tol+u_soft-u_choke+0.0001, d); vec3 x=c.rgb; vec3 kn=normalize(u_key+0.0001); int dom = (u_key.g>=u_key.r&&u_key.g>=u_key.b)?1:((u_key.b>=u_key.r)?2:0); if(dom==1){ float lim=max(x.r,x.b); float sp=max(0.,x.g-lim); x.g-=sp*u_spill; } else if(dom==2){ float lim=max(x.r,x.g); float sp=max(0.,x.b-lim); x.b-=sp*u_spill; } else { float lim=max(x.g,x.b); float sp=max(0.,x.r-lim); x.r-=sp*u_spill; } float al=c.a*m; if(u_matte==1){ o=vec4(vec3(al),1.); return; } o=vec4(x,al); }',
    uniforms: function (p) { return { u_key: rgb(p.key), u_tol: p.tol / 220, u_soft: p.soft / 200, u_spill: p.spill / 100, u_choke: p.choke / 400, u_matte: { i: p.matte ? 1 : 0 } }; } });
  reg({ id: 'lumakey', name: 'Luma Key', cat: 'Keying', params: [r('th', 'Threshold', 0, 100, 15, 1, '%'), r('soft', 'Softness', 0, 100, 10), bool('inv', 'Key Out Brights', false)],
    frag: 'uniform float u_th,u_soft; uniform int u_inv; void main(){ vec4 c=tex(v_uv); float l=luma(c.rgb); float m=smoothstep(u_th,u_th+u_soft+0.0001,l); if(u_inv==1) m=1.-smoothstep(1.-u_th-u_soft-0.0001,1.-u_th,l); o=vec4(c.rgb,c.a*m); }',
    uniforms: function (p) { return { u_th: p.th / 100, u_soft: p.soft / 100, u_inv: { i: p.inv ? 1 : 0 } }; } });
  reg({ id: 'cropfeather', name: 'Crop & Feather', cat: 'Keying', params: [r('l', 'Left', 0, 100, 0, 0.5, '%'), r('rt', 'Right', 0, 100, 0, 0.5, '%'), r('t', 'Top', 0, 100, 0, 0.5, '%'), r('b', 'Bottom', 0, 100, 0, 0.5, '%'), r('f', 'Feather', 0, 300, 20, 1, ' px'), r('rad', 'Corner Radius', 0, 500, 0, 1, ' px')],
    frag: 'uniform vec4 u_c; uniform float u_f,u_rad; void main(){ vec4 c=tex(v_uv); vec2 px=v_uv*u_size; vec2 lo=vec2(u_c.x,u_c.z)*u_size, hi=(1.-vec2(u_c.y,u_c.w))*u_size; vec2 ctr=(lo+hi)*0.5, hs=(hi-lo)*0.5; vec2 q=abs(px-ctr)-hs+u_rad; float d=length(max(q,0.))+min(max(q.x,q.y),0.)-u_rad; float m=1.-smoothstep(-u_f,0.,d); o=vec4(c.rgb,c.a*m); }',
    uniforms: function (p, ctx) { return { u_c: [p.l / 100, p.rt / 100, p.t / 100, p.b / 100], u_f: Math.max(0.5, p.f * ctx.px), u_rad: p.rad * ctx.px }; } });
  reg({ id: 'shapemask', name: 'Shape Mask', cat: 'Keying', params: [sel('shape', 'Shape', [['ellipse', 'Ellipse'], ['rect', 'Rectangle']], 'ellipse'), r('cx', 'Center X', 0, 100, 50, 0.5, '%'), r('cy', 'Center Y', 0, 100, 50, 0.5, '%'), r('w', 'Width', 0, 150, 60, 0.5, '%'), r('h', 'Height', 0, 150, 60, 0.5, '%'), r('f', 'Feather', 0, 300, 30, 1, ' px'), bool('inv', 'Invert', false)],
    frag: 'uniform vec2 u_c,u_s; uniform float u_f; uniform int u_sh,u_inv; void main(){ vec4 c=tex(v_uv); vec2 px=v_uv*u_size; vec2 ctr=u_c*u_size, hs=u_s*u_size*0.5; float d; if(u_sh==0){ vec2 q=(px-ctr)/max(hs,vec2(1.)); d=(length(q)-1.)*min(hs.x,hs.y); } else { vec2 q=abs(px-ctr)-hs; d=length(max(q,0.))+min(max(q.x,q.y),0.); } float m=1.-smoothstep(-u_f,0.,d); if(u_inv==1) m=1.-m; o=vec4(c.rgb,c.a*m); }',
    uniforms: function (p, ctx) { return { u_c: [p.cx / 100, p.cy / 100], u_s: [p.w / 100, p.h / 100], u_f: Math.max(0.5, p.f * ctx.px), u_sh: { i: p.shape === 'ellipse' ? 0 : 1 }, u_inv: { i: p.inv ? 1 : 0 } }; } });

  /* ======================= LAYER (frame-space, premultiplied) ======================= */
  reg({ id: 'dropshadow', name: 'Drop Shadow', cat: 'Layer', stage: 'layer', params: [col('c', 'Color', '#000000'), r('op', 'Opacity', 0, 100, 60, 1, '%'), r('ang', 'Direction', -180, 180, 135, 1, '°'), r('dist', 'Distance', 0, 200, 14, 1, ' px'), r('soft', 'Softness', 0, 100, 18, 1, ' px')],
    frag: 'uniform vec3 u_c; uniform float u_op,u_soft; uniform vec2 u_off; void main(){ vec4 c=tex(v_uv); float a=0.; float tot=0.; for(int i=0;i<32;i++){ float fi=float(i); float an=fi*2.39996; float rr=sqrt((fi+0.5)/32.)*u_soft; a+=tex(v_uv-(u_off+vec2(cos(an),sin(an))*rr)/u_size).a; tot+=1.; } a/=tot; float sa=a*u_op; o=vec4(c.rgb + u_c*sa*(1.-c.a), c.a + sa*(1.-c.a)); }',
    uniforms: function (p, ctx) { var a = p.ang * Math.PI / 180; return { u_c: rgb(p.c), u_op: p.op / 100, u_soft: p.soft * ctx.px, u_off: [Math.cos(a) * p.dist * ctx.px, Math.sin(a) * p.dist * ctx.px] }; } });
  reg({ id: 'stroke', name: 'Outline / Stroke', cat: 'Layer', stage: 'layer', params: [col('c', 'Color', '#f0913a'), r('w', 'Width', 1, 40, 6, 0.5, ' px'), r('op', 'Opacity', 0, 100, 100, 1, '%')],
    frag: 'uniform vec3 u_c; uniform float u_w,u_op; void main(){ vec4 c=tex(v_uv); float a=0.; for(int i=0;i<24;i++){ float an=float(i)*0.261799; a=max(a,tex(v_uv+vec2(cos(an),sin(an))*u_w/u_size).a); a=max(a,tex(v_uv+vec2(cos(an),sin(an))*u_w*0.5/u_size).a); } float sa=a*u_op; o=vec4(c.rgb+u_c*sa*(1.-c.a), c.a+sa*(1.-c.a)); }',
    uniforms: function (p, ctx) { return { u_c: rgb(p.c), u_w: p.w * ctx.px, u_op: p.op / 100 }; } });
  // The matte comes from the next video track up; the compositor renders that layer as the matte and hides it.
  reg({ id: 'trackmatte', name: 'Track Matte Key', cat: 'Keying', stage: 'layer', params: [sel('type', 'Matte', [['luma', 'Luminance of the track above'], ['alpha', 'Alpha (shape) of the track above']], 'luma'), bool('inv', 'Invert Matte', false), r('soft', 'Softness', 0, 100, 0, 1, '%')],
    frag: 'void main(){ o=tex(v_uv); }', trackMatte: true });
  reg({ id: 'letterbox', name: 'Letterbox Bars', cat: 'Layer', stage: 'layer', params: [sel('ar', 'Aspect', [['2.39', '2.39:1 Scope'], ['2.0', '2:1'], ['1.85', '1.85:1'], ['1.33', '4:3 Pillarbox'], ['1.0', '1:1'], ['custom', 'Custom']], '2.39'), r('custom', 'Custom Ratio', 0.5, 4, 2.2, 0.01), col('c', 'Color', '#000000'), r('op', 'Opacity', 0, 100, 100, 1, '%')],
    frag: 'uniform float u_ar,u_op; uniform vec3 u_c; void main(){ vec4 c=tex(v_uv); float fa=u_size.x/u_size.y; float m=0.; if(u_ar>fa){ float h=fa/u_ar; m=step(abs(v_uv.y-0.5),0.5)*(1.-step(abs(v_uv.y-0.5),h*0.5)); } else { float w=u_ar/fa; m=1.-step(abs(v_uv.x-0.5),w*0.5); } float a=m*u_op; o=vec4(mix(c.rgb,u_c,a), mix(c.a,1.,a)); }',
    uniforms: function (p) { return { u_ar: p.ar === 'custom' ? p.custom : parseFloat(p.ar), u_op: p.op / 100, u_c: rgb(p.c) }; } });
  reg({ id: 'blackwhitepoint', name: 'Frame Fade', cat: 'Layer', stage: 'layer', params: [col('c', 'Color', '#000000'), r('amt', 'Amount', 0, 100, 50, 1, '%')],
    frag: 'uniform vec3 u_c; uniform float u_a; void main(){ vec4 c=tex(v_uv); o=vec4(mix(c.rgb, u_c*c.a, u_a), c.a); }',
    uniforms: function (p) { return { u_c: rgb(p.c), u_a: p.amt / 100 }; } });

  /* ======================= AUDIO ======================= */
  function aud(def) { def.cat = 'Audio'; def.audio = true; reg(def); }
  aud({ id: 'a_eq', name: '3-Band EQ', params: [r('low', 'Low (200 Hz)', -24, 24, 0, 0.5, ' dB'), r('mid', 'Mid', -24, 24, 0, 0.5, ' dB'), r('midf', 'Mid Freq', 200, 8000, 1200, 10, ' Hz'), r('high', 'High (5 kHz)', -24, 24, 0, 0.5, ' dB')],
    build: function (ctx, p) {
      var a = ctx.createBiquadFilter(), b = ctx.createBiquadFilter(), c = ctx.createBiquadFilter();
      a.type = 'lowshelf'; a.frequency.value = 200; a.gain.value = p.low;
      b.type = 'peaking'; b.frequency.value = p.midf; b.Q.value = 0.9; b.gain.value = p.mid;
      c.type = 'highshelf'; c.frequency.value = 5000; c.gain.value = p.high;
      a.connect(b); b.connect(c); return { input: a, output: c };
    } });
  aud({ id: 'a_comp', name: 'Compressor', params: [r('th', 'Threshold', -60, 0, -18, 0.5, ' dB'), r('ratio', 'Ratio', 1, 20, 4, 0.1, ':1'), r('knee', 'Knee', 0, 40, 6, 0.5, ' dB'), r('att', 'Attack', 0, 200, 5, 0.5, ' ms'), r('rel', 'Release', 10, 1000, 150, 1, ' ms'), r('makeup', 'Makeup Gain', 0, 24, 3, 0.5, ' dB')],
    build: function (ctx, p) {
      var c = ctx.createDynamicsCompressor(); c.threshold.value = p.th; c.ratio.value = p.ratio; c.knee.value = p.knee; c.attack.value = p.att / 1000; c.release.value = p.rel / 1000;
      var g = ctx.createGain(); g.gain.value = U.dbToGain(p.makeup); c.connect(g); return { input: c, output: g };
    } });
  FX.impulse = function (ctx, secs, decay) {
    var len = Math.max(1, Math.floor(ctx.sampleRate * secs)), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    var seed = 1;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; }
    for (var ch = 0; ch < 2; ch++) { var d = buf.getChannelData(ch); for (var i = 0; i < len; i++) d[i] = rnd() * Math.pow(1 - i / len, decay); }
    return buf;
  };
  aud({ id: 'a_reverb', name: 'Reverb', params: [r('mix', 'Mix', 0, 100, 30, 1, '%'), r('size', 'Room Size', 0.2, 8, 2.2, 0.1, ' s'), r('decay', 'Damping', 0.5, 8, 2.5, 0.1), r('pre', 'Pre-delay', 0, 200, 15, 1, ' ms')],
    build: function (ctx, p) {
      var input = ctx.createGain(), out = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain(), conv = ctx.createConvolver(), pre = ctx.createDelay(1);
      conv.buffer = FX.impulse(ctx, p.size, p.decay); pre.delayTime.value = p.pre / 1000;
      dry.gain.value = Math.cos(p.mix / 100 * Math.PI / 2); wet.gain.value = Math.sin(p.mix / 100 * Math.PI / 2);
      input.connect(dry); dry.connect(out); input.connect(pre); pre.connect(conv); conv.connect(wet); wet.connect(out);
      return { input: input, output: out };
    } });
  aud({ id: 'a_delay', name: 'Echo / Delay', params: [r('time', 'Time', 10, 2000, 320, 1, ' ms'), r('fb', 'Feedback', 0, 95, 35, 1, '%'), r('mix', 'Mix', 0, 100, 30, 1, '%'), r('tone', 'Tone (LPF)', 500, 18000, 6000, 10, ' Hz')],
    build: function (ctx, p) {
      var input = ctx.createGain(), out = ctx.createGain(), d = ctx.createDelay(3), fb = ctx.createGain(), wet = ctx.createGain(), lp = ctx.createBiquadFilter();
      d.delayTime.value = p.time / 1000; fb.gain.value = p.fb / 100; wet.gain.value = p.mix / 100; lp.type = 'lowpass'; lp.frequency.value = p.tone;
      input.connect(out); input.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(wet); wet.connect(out);
      return { input: input, output: out };
    } });
  aud({ id: 'a_hpf', name: 'High-Pass Filter', params: [r('f', 'Cutoff', 20, 5000, 120, 1, ' Hz'), r('q', 'Resonance', 0.1, 12, 0.7, 0.1)],
    build: function (ctx, p) { var f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = p.f; f.Q.value = p.q; return { input: f, output: f }; } });
  aud({ id: 'a_lpf', name: 'Low-Pass Filter', params: [r('f', 'Cutoff', 200, 20000, 8000, 10, ' Hz'), r('q', 'Resonance', 0.1, 12, 0.7, 0.1)],
    build: function (ctx, p) { var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = p.f; f.Q.value = p.q; return { input: f, output: f }; } });
  aud({ id: 'a_phone', name: 'Telephone', params: [r('amt', 'Amount', 0, 100, 100, 1, '%')],
    build: function (ctx, p) {
      var input = ctx.createGain(), out = ctx.createGain(), h = ctx.createBiquadFilter(), l = ctx.createBiquadFilter(), sh = ctx.createWaveShaper(), dry = ctx.createGain(), wet = ctx.createGain();
      h.type = 'highpass'; h.frequency.value = 400; l.type = 'lowpass'; l.frequency.value = 3200;
      var curve = new Float32Array(256); for (var i = 0; i < 256; i++) { var x = i / 128 - 1; curve[i] = Math.tanh(x * 3); } sh.curve = curve;
      dry.gain.value = 1 - p.amt / 100; wet.gain.value = p.amt / 100;
      input.connect(dry); dry.connect(out); input.connect(h); h.connect(l); l.connect(sh); sh.connect(wet); wet.connect(out);
      return { input: input, output: out };
    } });
  aud({ id: 'a_distort', name: 'Saturation / Drive', params: [r('drive', 'Drive', 0, 100, 30), r('mix', 'Mix', 0, 100, 100, 1, '%')],
    build: function (ctx, p) {
      var input = ctx.createGain(), out = ctx.createGain(), sh = ctx.createWaveShaper(), dry = ctx.createGain(), wet = ctx.createGain();
      var k = 1 + p.drive / 5, curve = new Float32Array(1024);
      for (var i = 0; i < 1024; i++) { var x = i / 512 - 1; curve[i] = Math.tanh(x * k) / Math.tanh(k); }
      sh.curve = curve; sh.oversample = '2x'; dry.gain.value = 1 - p.mix / 100; wet.gain.value = p.mix / 100;
      input.connect(dry); dry.connect(out); input.connect(sh); sh.connect(wet); wet.connect(out); return { input: input, output: out };
    } });

  // De-esser: the band above the crossover is compressed on its own and summed back with the rest
  aud({ id: 'a_deess', name: 'De-esser', params: [r('f', 'Frequency', 2000, 12000, 5500, 50, ' Hz'), r('amt', 'Amount', 0, 100, 50, 1, '%'), r('th', 'Threshold', -60, 0, -30, 0.5, ' dB')],
    build: function (ctx, p) {
      var input = ctx.createGain(), out = ctx.createGain();
      var hp1 = ctx.createBiquadFilter(), hp2 = ctx.createBiquadFilter(), lp1 = ctx.createBiquadFilter(), lp2 = ctx.createBiquadFilter();
      [hp1, hp2].forEach(function (f) { f.type = 'highpass'; f.frequency.value = p.f; f.Q.value = 0.7071; });
      [lp1, lp2].forEach(function (f) { f.type = 'lowpass'; f.frequency.value = p.f; f.Q.value = 0.7071; });
      var comp = ctx.createDynamicsCompressor(); comp.threshold.value = p.th; comp.knee.value = 6; comp.ratio.value = 1 + p.amt / 100 * 11; comp.attack.value = 0.001; comp.release.value = 0.08;
      var trim = ctx.createGain(); trim.gain.value = Math.pow(10, -(p.amt / 100) * 0.3); // the compressor's auto make-up would lift the band; pull it back a little
      input.connect(lp1); lp1.connect(lp2); lp2.connect(out);
      input.connect(hp1); hp1.connect(hp2); hp2.connect(comp); comp.connect(trim); trim.connect(out);
      return { input: input, output: out };
    } });
  aud({ id: 'a_limit', name: 'Limiter', params: [r('ceil', 'Ceiling', -12, 0, -1, 0.1, ' dB'), r('rel', 'Release', 20, 1000, 120, 5, ' ms'), r('gain', 'Input Gain', 0, 24, 0, 0.5, ' dB')],
    build: function (ctx, p) {
      var g = ctx.createGain(); g.gain.value = U.dbToGain(p.gain);
      var lim = FX.limiterNode(ctx, p.ceil, p.rel);
      g.connect(lim.input); return { input: g, output: lim.output };
    } });
  // look-ahead peak limiter (AudioWorklet); falls back to a hard clip at the ceiling when worklets are unavailable
  FX.limiterNode = function (ctx, ceilDb, relMs) {
    if (ctx.__gateReady) {
      var node = new AudioWorkletNode(ctx, 'cutline-limiter', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      node.parameters.get('ceiling').value = ceilDb; node.parameters.get('release').value = relMs;
      return { input: node, output: node };
    }
    var sh = ctx.createWaveShaper(), c = U.dbToGain(ceilDb), curve = new Float32Array(2049);
    for (var i = 0; i < 2049; i++) { var x = (i / 1024 - 1) * 2; curve[i] = Math.max(-c, Math.min(c, x)); }
    sh.curve = curve; return { input: sh, output: sh };
  };

  // Noise gate and limiter run as AudioWorklets loaded from a data: URL (works from file://)
  FX.GATE_SRC = [
    'class CutlineGate extends AudioWorkletProcessor {',
    ' static get parameterDescriptors(){ return [{name:"threshold",defaultValue:-45},{name:"attack",defaultValue:5},{name:"release",defaultValue:120},{name:"hold",defaultValue:50},{name:"range",defaultValue:-60}]; }',
    ' constructor(){ super(); this.env=0; this.g=0; this.holdLeft=0; }',
    ' process(inputs, outputs, p){ const inp=inputs[0], out=outputs[0]; if(!inp||!inp.length){ return true; }',
    '  const th=Math.pow(10,p.threshold[0]/20), floor=Math.pow(10,p.range[0]/20), sr=sampleRate;',
    '  const a=Math.exp(-1/(Math.max(0.1,p.attack[0])*0.001*sr)), r=Math.exp(-1/(Math.max(1,p.release[0])*0.001*sr)), holdS=p.hold[0]*0.001*sr;',
    '  const n=inp[0].length;',
    '  for(let i=0;i<n;i++){ let pk=0; for(let c=0;c<inp.length;c++){ const v=Math.abs(inp[c][i]); if(v>pk) pk=v; }',
    '   this.env = pk>this.env ? pk : this.env*0.9995 + pk*0.0005;',
    '   let target; if(this.env>=th){ target=1; this.holdLeft=holdS; } else if(this.holdLeft>0){ target=1; this.holdLeft--; } else target=floor;',
    '   this.g = target>this.g ? target+(this.g-target)*a : target+(this.g-target)*r;',
    '   for(let c=0;c<out.length;c++){ const src=inp[c]||inp[0]; out[c][i]=src[i]*this.g; } }',
    '  return true; } }',
    'registerProcessor("cutline-gate", CutlineGate);',
    // look-ahead limiter: 5 ms delay line, gain = ceiling / peak over the look-ahead window, instant-ish attack, exponential release
    'class CutlineLimiter extends AudioWorkletProcessor {',
    ' static get parameterDescriptors(){ return [{name:"ceiling",defaultValue:-1},{name:"release",defaultValue:120}]; }',
    ' constructor(){ super(); this.n=Math.round(sampleRate*0.005); this.buf=[new Float32Array(this.n),new Float32Array(this.n)]; this.pk=new Float32Array(this.n); this.w=0; this.g=1; this.red=0; }',
    ' process(inputs, outputs, p){ const inp=inputs[0], out=outputs[0]; if(!inp||!inp.length){ return true; }',
    '  const c=Math.pow(10,p.ceiling[0]/20), rel=Math.exp(-1/(Math.max(5,p.release[0])*0.001*sampleRate)), att=Math.exp(-1/(0.0015*sampleRate)), n=inp[0].length, N=this.n;',
    '  for(let i=0;i<n;i++){ let pk=0; for(let ch=0;ch<inp.length;ch++){ const v=Math.abs(inp[ch][i]); if(v>pk) pk=v; }',
    '   this.pk[this.w]=pk; let mx=0; for(let k=0;k<N;k++){ if(this.pk[k]>mx) mx=this.pk[k]; }',
    '   const target = mx>c ? c/mx : 1;',
    '   this.g = target<this.g ? target+(this.g-target)*att : target+(this.g-target)*rel;',
    '   for(let ch=0;ch<out.length;ch++){ const b=this.buf[Math.min(ch,1)], src=inp[ch]||inp[0]; const d=b[this.w]; b[this.w]=src[i]; let y=d*this.g; if(y>c) y=c; else if(y<-c) y=-c; out[ch][i]=y; }',
    '   this.w=(this.w+1)%N; }',
    '  return true; } }',
    'registerProcessor("cutline-limiter", CutlineLimiter);',
    // adaptive spectral noise reduction: 1024-pt STFT (Hann, 75 % overlap), per-bin noise floor tracked as a slowly
    // rising minimum, spectral-subtraction gain with a floor and temporal smoothing, overlap-add resynthesis
    'class CutlineDenoise extends AudioWorkletProcessor {',
    ' static get parameterDescriptors(){ return [{name:"amount",defaultValue:12},{name:"sens",defaultValue:50},{name:"smooth",defaultValue:50}]; }',
    ' constructor(){ super(); const N=this.N=1024; this.H=128; this.win=new Float32Array(N); for(let i=0;i<N;i++) this.win[i]=0.5-0.5*Math.cos(2*Math.PI*i/N);',
    '  this.inb=[new Float32Array(N),new Float32Array(N)]; this.ola=[new Float32Array(N),new Float32Array(N)]; this.fifo=[new Float32Array(8192),new Float32Array(8192)]; this.fw=0; this.fr=0; this.fill=0; this.warm=0;',
    '  this.noise=new Float32Array(N/2+1).fill(1e9); this.smag=new Float32Array(N/2+1); this.gain=new Float32Array(N/2+1).fill(1); this.re=new Float32Array(N); this.im=new Float32Array(N);',
    '  this.rev=new Uint32Array(N); for(let i=0;i<N;i++){ let r=0,x=i; for(let b=0;b<10;b++){ r=(r<<1)|(x&1); x>>=1; } this.rev[i]=r; } this.cs=new Float32Array(N/2); this.sn=new Float32Array(N/2); for(let i=0;i<N/2;i++){ this.cs[i]=Math.cos(2*Math.PI*i/N); this.sn[i]=Math.sin(2*Math.PI*i/N); } }',
    ' fft(re,im,inv){ const N=this.N; for(let i=0;i<N;i++){ const j=this.rev[i]; if(j>i){ let t=re[i]; re[i]=re[j]; re[j]=t; t=im[i]; im[i]=im[j]; im[j]=t; } }',
    '  for(let s=2;s<=N;s<<=1){ const h=s>>1, step=N/s; for(let k=0;k<N;k+=s){ for(let j=0;j<h;j++){ const wr=this.cs[j*step], wi=(inv?1:-1)*this.sn[j*step]; const a=k+j, b=a+h; const tr=re[b]*wr-im[b]*wi, ti=re[b]*wi+im[b]*wr; re[b]=re[a]-tr; im[b]=im[a]-ti; re[a]+=tr; im[a]+=ti; } } }',
    '  if(inv){ for(let i=0;i<N;i++){ re[i]/=N; im[i]/=N; } } }',
    ' block(p){ const N=this.N, H=this.H, half=N/2, floor=Math.pow(10,-p.amount[0]/20), sens=0.6+p.sens[0]/100*1.6, sm=0.2+p.smooth[0]/100*0.7, rise=1.005;',
    '  for(let c=0;c<2;c++){ const x=this.inb[c], re=this.re, im=this.im; for(let i=0;i<N;i++){ re[i]=x[i]*this.win[i]; im[i]=0; } this.fft(re,im,false);',
    '   for(let k=0;k<=half;k++){ const m=Math.hypot(re[k],im[k]); if(c===0){ const sg=this.smag[k]=this.smag[k]>0?this.smag[k]*0.8+m*0.2:m; const nf=this.noise[k]; if(this.warm>=8) this.noise[k] = sg<nf ? sg : nf*rise; const g=Math.max(floor, 1-sens*2*this.noise[k]/(m+1e-9)); this.gain[k]=this.gain[k]*sm+g*(1-sm); }',
    '    const g2=this.gain[k]; re[k]*=g2; im[k]*=g2; if(k>0&&k<half){ re[N-k]*=g2; im[N-k]*=g2; } }',
    '   this.fft(re,im,true); const o=this.ola[c]; for(let i=0;i<N;i++) o[i]+=re[i]*this.win[i]/3; const f=this.fifo[c]; for(let i=0;i<H;i++) f[(this.fw+i)&8191]=o[i]; o.copyWithin(0,H); o.fill(0,N-H); }',
    '  this.fw=(this.fw+H)&8191; this.warm++; }',
    ' process(inputs, outputs, p){ const inp=inputs[0], out=outputs[0]; if(!inp||!inp.length) return true; const n=inp[0].length, N=this.N, H=this.H;',
    '  for(let i=0;i<n;i++){ for(let c=0;c<2;c++){ const src=inp[c]||inp[0]; this.inb[c][N-H+this.fill]=src[i]; } this.fill++;',
    '   if(this.fill===H){ this.block(p); for(let c=0;c<2;c++) this.inb[c].copyWithin(0,H); this.fill=0; } }',
    '  const avail=(this.fw-this.fr)&8191; for(let i=0;i<n;i++){ const ok=i<avail; for(let c=0;c<out.length;c++){ out[c][i]= ok ? this.fifo[Math.min(c,1)][(this.fr+i)&8191] : 0; } } this.fr=(this.fr+Math.min(n,avail))&8191;',
    '  return true; } }',
    'registerProcessor("cutline-denoise", CutlineDenoise);'
  ].join('\n');
  FX.gateURL = null;
  FX.loadWorklets = function (ctx) {
    if (!ctx || !ctx.audioWorklet) return Promise.resolve(false);
    if (ctx.__cutlineGate) return ctx.__cutlineGate;
    // data: URLs work for worklets on file:// pages (blob: URLs from an opaque origin do not)
    if (!FX.gateURL) FX.gateURL = 'data:application/javascript;base64,' + btoa(FX.GATE_SRC);
    ctx.__cutlineGate = ctx.audioWorklet.addModule(FX.gateURL).then(function () { ctx.__gateReady = true; return true; }).catch(function (e) { console.warn('[Cutline] noise gate unavailable', e); return false; });
    return ctx.__cutlineGate;
  };
  aud({ id: 'a_denoise', name: 'Noise Reduction', params: [r('amount', 'Reduction', 0, 30, 12, 0.5, ' dB'), r('sens', 'Sensitivity', 0, 100, 50, 1, '%'), r('smooth', 'Smoothing', 0, 100, 50, 1, '%')],
    build: function (ctx, p) {
      if (!ctx.__gateReady) { var pass = ctx.createGain(); return { input: pass, output: pass }; }
      var node = new AudioWorkletNode(ctx, 'cutline-denoise', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      node.parameters.get('amount').value = p.amount; node.parameters.get('sens').value = p.sens; node.parameters.get('smooth').value = p.smooth;
      return { input: node, output: node };
    } });
  aud({ id: 'a_gate', name: 'Noise Gate', params: [r('th', 'Threshold', -80, 0, -45, 0.5, ' dB'), r('range', 'Range', -90, 0, -60, 1, ' dB'), r('att', 'Attack', 0.1, 50, 3, 0.1, ' ms'), r('hold', 'Hold', 0, 500, 60, 1, ' ms'), r('rel', 'Release', 5, 1000, 150, 1, ' ms')],
    build: function (ctx, p) {
      if (!ctx.__gateReady) { var pass = ctx.createGain(); return { input: pass, output: pass }; }
      var node = new AudioWorkletNode(ctx, 'cutline-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      node.parameters.get('threshold').value = p.th; node.parameters.get('range').value = p.range;
      node.parameters.get('attack').value = p.att; node.parameters.get('hold').value = p.hold; node.parameters.get('release').value = p.rel;
      return { input: node, output: node };
    } });

  FX.forKind = function (kind) { return FX.list.filter(function (d) { return kind === 'audio' ? d.audio : !d.audio; }); };
})();
