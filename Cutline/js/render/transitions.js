/* Cutline — transition registry. Video transitions are shaders combining two premultiplied layer textures. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util;
  var TR = C.TR = { list: [], byId: {} };

  TR.PRELUDE = [
    '#version 300 es', 'precision highp float;', 'in vec2 v_uv; out vec4 o;',
    'uniform sampler2D u_a, u_b; uniform float u_p; uniform vec2 u_size; uniform float u_time;',
    'float inb(vec2 uv){ return step(0.,uv.x)*step(0.,uv.y)*step(uv.x,1.)*step(uv.y,1.); }',
    'vec4 A(vec2 uv){ return texture(u_a,uv)*inb(uv); }',
    'vec4 B(vec2 uv){ return texture(u_b,uv)*inb(uv); }',
    'float luma(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }',
    'float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }',
    'vec2 rot(vec2 p,float a){ return vec2(p.x*cos(a)-p.y*sin(a), p.x*sin(a)+p.y*cos(a)); }',
    ''
  ].join('\n');

  function r(k, name, min, max, def, step, unit) { return { k: k, name: name, type: 'range', min: min, max: max, def: def, step: step || 1, unit: unit || '' }; }
  function sel(k, name, opts, def) { return { k: k, name: name, type: 'select', options: opts, def: def }; }
  function col(k, name, def) { return { k: k, name: name, type: 'color', def: def }; }
  var DIRS = [['l', 'From Left'], ['r', 'From Right'], ['u', 'From Top'], ['d', 'From Bottom']];
  function dirVec(d) { return d === 'l' ? [1, 0] : d === 'r' ? [-1, 0] : d === 'u' ? [0, 1] : [0, -1]; } // sampling offset of incoming clip

  function reg(def) { def.params = def.params || []; def.kind = def.kind || 'video'; TR.list.push(def); TR.byId[def.id] = def; }
  TR.defaults = function (id) { var d = TR.byId[id], p = {}; if (d) d.params.forEach(function (q) { p[q.k] = q.def; }); return p; };

  reg({ id: 'cross', name: 'Cross Dissolve', cat: 'Dissolve', frag: 'void main(){ o=mix(A(v_uv),B(v_uv),u_p); }', canvas: function (g, a, b, p, w, h) { g.globalAlpha = 1 - p; if (a) g.drawImage(a, 0, 0, w, h); g.globalAlpha = p; if (b) g.drawImage(b, 0, 0, w, h); } });
  reg({ id: 'dipblack', name: 'Dip to Black', cat: 'Dissolve', frag: 'void main(){ vec4 k=vec4(0.,0.,0.,1.); o = u_p<0.5 ? mix(A(v_uv),k,u_p*2.) : mix(k,B(v_uv),u_p*2.-1.); }' });
  reg({ id: 'dipwhite', name: 'Dip to White', cat: 'Dissolve', frag: 'void main(){ vec4 k=vec4(1.); o = u_p<0.5 ? mix(A(v_uv),k,u_p*2.) : mix(k,B(v_uv),u_p*2.-1.); }' });
  reg({ id: 'dipcolor', name: 'Dip to Color', cat: 'Dissolve', params: [col('c', 'Color', '#f0913a')], frag: 'uniform vec3 u_c; void main(){ vec4 k=vec4(u_c,1.); o = u_p<0.5 ? mix(A(v_uv),k,u_p*2.) : mix(k,B(v_uv),u_p*2.-1.); }', uniforms: function (p) { return { u_c: U.hexToRgb(p.c) }; } });
  reg({ id: 'additive', name: 'Additive Dissolve', cat: 'Dissolve', frag: 'void main(){ vec4 a=A(v_uv)*min(1.,2.*(1.-u_p)), b=B(v_uv)*min(1.,2.*u_p); o=clamp(a+b,0.,1.); }' });
  reg({ id: 'film', name: 'Film Dissolve', cat: 'Dissolve', frag: 'void main(){ vec4 a=A(v_uv), b=B(v_uv); vec4 la=vec4(pow(a.rgb,vec3(2.2)),a.a), lb=vec4(pow(b.rgb,vec3(2.2)),b.a); float t=smoothstep(0.,1.,u_p); vec4 m=mix(la,lb,t); o=vec4(pow(max(m.rgb,0.),vec3(1./2.2)),m.a); }' });
  reg({ id: 'lumafade', name: 'Luma Fade', cat: 'Dissolve', params: [r('soft', 'Softness', 1, 100, 20), sel('mode', 'Order', [['dark', 'Darks First'], ['light', 'Lights First']], 'dark')],
    frag: 'uniform float u_soft; uniform int u_mode; void main(){ vec4 a=A(v_uv); float l=luma(a.a>0.?a.rgb/a.a:vec3(0.)); if(u_mode==1) l=1.-l; float e=u_p*(1.+u_soft); float m=smoothstep(l,l+u_soft,e); o=mix(a,B(v_uv),m); }',
    uniforms: function (p) { return { u_soft: p.soft / 100, u_mode: { i: p.mode === 'light' ? 1 : 0 } }; } });
  reg({ id: 'blurdis', name: 'Blur Dissolve', cat: 'Dissolve', params: [r('r', 'Blur', 0, 80, 30, 1, ' px')],
    frag: 'uniform float u_r; void main(){ float rr=u_r*sin(u_p*3.14159); vec4 a=vec4(0.),b=vec4(0.); for(int i=0;i<24;i++){ float fi=float(i); float an=fi*2.39996; float d=sqrt((fi+0.5)/24.)*rr; vec2 off=vec2(cos(an),sin(an))*d/u_size; a+=A(v_uv+off); b+=B(v_uv+off); } o=mix(a/24.,b/24.,smoothstep(0.2,0.8,u_p)); }',
    uniforms: function (p, ctx) { return { u_r: p.r * ctx.px }; } });

  reg({ id: 'wipe', name: 'Wipe', cat: 'Wipe', params: [r('ang', 'Angle', -180, 180, 0, 1, '°'), r('soft', 'Softness', 0, 100, 8)],
    frag: 'uniform float u_ang,u_soft; void main(){ vec2 d=vec2(cos(u_ang),sin(u_ang)); vec2 c=v_uv-0.5; float proj=dot(c,d); float ext=0.5*(abs(d.x)+abs(d.y)); float t=(proj+ext)/(2.*ext); float e=u_p*(1.+u_soft)-u_soft; float m=1.-smoothstep(e,e+u_soft+0.0001,t); o=mix(A(v_uv),B(v_uv),m); }',
    uniforms: function (p) { return { u_ang: p.ang * Math.PI / 180, u_soft: p.soft / 100 }; } });
  reg({ id: 'barn', name: 'Barn Doors', cat: 'Wipe', params: [sel('dir', 'Orientation', [['v', 'Vertical'], ['h', 'Horizontal']], 'v'), r('soft', 'Softness', 0, 100, 5)],
    frag: 'uniform int u_dir; uniform float u_soft; void main(){ float t = u_dir==0 ? abs(v_uv.x-0.5)*2. : abs(v_uv.y-0.5)*2.; float e=u_p*(1.+u_soft)-u_soft; float m=1.-smoothstep(e,e+u_soft+0.0001,t); o=mix(A(v_uv),B(v_uv),m); }',
    uniforms: function (p) { return { u_dir: { i: p.dir === 'v' ? 0 : 1 }, u_soft: p.soft / 100 }; } });
  reg({ id: 'clock', name: 'Clock Wipe', cat: 'Wipe', params: [r('soft', 'Softness', 0, 100, 3), r('start', 'Start Angle', -180, 180, -90, 1, '°')],
    frag: 'uniform float u_soft,u_start; void main(){ vec2 c=(v_uv-0.5)*vec2(u_size.x/u_size.y,1.); float a=atan(c.y,c.x)-u_start; a=mod(a+6.28318,6.28318)/6.28318; float e=u_p*(1.+u_soft)-u_soft; float m=1.-smoothstep(e,e+u_soft+0.0001,a); o=mix(A(v_uv),B(v_uv),m); }',
    uniforms: function (p) { return { u_soft: p.soft / 100, u_start: p.start * Math.PI / 180 }; } });
  reg({ id: 'iris', name: 'Iris Round', cat: 'Wipe', params: [r('soft', 'Softness', 0, 100, 6), r('cx', 'Center X', 0, 100, 50, 1, '%'), r('cy', 'Center Y', 0, 100, 50, 1, '%')],
    frag: 'uniform float u_soft; uniform vec2 u_c; void main(){ vec2 c=(v_uv-u_c)*vec2(u_size.x/u_size.y,1.); float maxd=length(vec2(max(u_c.x,1.-u_c.x)*u_size.x/u_size.y, max(u_c.y,1.-u_c.y))); float t=length(c)/maxd; float e=u_p*(1.+u_soft)-u_soft; float m=1.-smoothstep(e,e+u_soft+0.0001,t); o=mix(A(v_uv),B(v_uv),m); }',
    uniforms: function (p) { return { u_soft: p.soft / 100, u_c: [p.cx / 100, p.cy / 100] }; } });
  reg({ id: 'irisbox', name: 'Iris Box', cat: 'Wipe', params: [r('soft', 'Softness', 0, 100, 4)],
    frag: 'uniform float u_soft; void main(){ vec2 c=abs(v_uv-0.5)*2.; float t=max(c.x,c.y); float e=u_p*(1.+u_soft)-u_soft; float m=1.-smoothstep(e,e+u_soft+0.0001,t); o=mix(A(v_uv),B(v_uv),m); }',
    uniforms: function (p) { return { u_soft: p.soft / 100 }; } });
  reg({ id: 'checker', name: 'Checker Wipe', cat: 'Wipe', params: [r('n', 'Squares', 2, 32, 8)],
    frag: 'uniform float u_n; void main(){ vec2 g=floor(v_uv*vec2(u_n*u_size.x/u_size.y,u_n)); float off=mod(g.x+g.y,2.)*0.5; float t=clamp((u_p-off*0.5)*2.,0.,1.); float m=step(fract(v_uv.x*u_n*u_size.x/u_size.y),t); o=mix(A(v_uv),B(v_uv),m); }',
    uniforms: function (p) { return { u_n: p.n }; } });

  reg({ id: 'slide', name: 'Slide', cat: 'Motion', params: [sel('dir', 'Direction', DIRS, 'r')],
    frag: 'uniform vec2 u_d; void main(){ float e=1.-pow(1.-u_p,3.); vec2 off=u_d*(1.-e); vec4 b=B(v_uv+off); vec4 a=A(v_uv); o=b+a*(1.-b.a); }',
    uniforms: function (p) { var d = dirVec(p.dir); return { u_d: [d[0], d[1]] }; } });
  reg({ id: 'push', name: 'Push', cat: 'Motion', params: [sel('dir', 'Direction', DIRS, 'r')],
    frag: 'uniform vec2 u_d; void main(){ float e=smoothstep(0.,1.,u_p); vec4 b=B(v_uv+u_d*(1.-e)); vec4 a=A(v_uv-u_d*e); o=b+a*(1.-b.a); }',
    uniforms: function (p) { var d = dirVec(p.dir); return { u_d: [d[0], d[1]] }; } });
  reg({ id: 'whip', name: 'Whip Pan', cat: 'Motion', params: [sel('dir', 'Direction', DIRS, 'r'), r('blur', 'Motion Blur', 0, 100, 70)],
    frag: 'uniform vec2 u_d; uniform float u_bl; void main(){ float e=smoothstep(0.,1.,u_p); float s=sin(u_p*3.14159)*u_bl*0.25; vec4 acc=vec4(0.); for(int i=-10;i<=10;i++){ vec2 off=u_d*s*float(i)/10.; vec4 b=B(v_uv+u_d*(1.-e)+off); vec4 a=A(v_uv-u_d*e+off); acc+=b+a*(1.-b.a); } o=acc/21.; }',
    uniforms: function (p) { var d = dirVec(p.dir); return { u_d: [d[0], d[1]], u_bl: p.blur / 100 }; } });
  reg({ id: 'zoomin', name: 'Zoom In', cat: 'Motion', params: [r('amt', 'Zoom Amount', 100, 600, 250, 1, '%')],
    frag: 'uniform float u_z; void main(){ float sa=mix(1.,u_z,u_p); float sb=mix(1./u_z,1.,u_p); vec4 a=A((v_uv-0.5)/sa+0.5); vec4 b=B((v_uv-0.5)/sb+0.5); float m=smoothstep(0.3,0.7,u_p); o=mix(a,b,m); }',
    uniforms: function (p) { return { u_z: p.amt / 100 }; } });
  reg({ id: 'zoomout', name: 'Zoom Out', cat: 'Motion', params: [r('amt', 'Zoom Amount', 100, 600, 250, 1, '%')],
    frag: 'uniform float u_z; void main(){ float sa=mix(1.,1./u_z,u_p); float sb=mix(u_z,1.,u_p); vec4 a=A((v_uv-0.5)/sa+0.5); vec4 b=B((v_uv-0.5)/sb+0.5); float m=smoothstep(0.3,0.7,u_p); o=mix(a,b,m); }',
    uniforms: function (p) { return { u_z: p.amt / 100 }; } });
  reg({ id: 'spin', name: 'Spin', cat: 'Motion', params: [r('turns', 'Turns', -4, 4, 1, 0.25)],
    frag: 'uniform float u_t; void main(){ float asp=u_size.x/u_size.y; vec2 c=(v_uv-0.5)*vec2(asp,1.); float e=smoothstep(0.,1.,u_p); float ang=u_t*6.28318*e; float sc = u_p<0.5 ? 1.-u_p*1.6 : 0.2+(u_p-0.5)*1.6; vec2 q=rot(c,ang)/max(sc,0.001); q.x/=asp; vec4 a=A(q+0.5), b=B(q+0.5); o = u_p<0.5 ? a : b; }',
    uniforms: function (p) { return { u_t: p.turns }; } });
  reg({ id: 'glitchtr', name: 'Glitch Cut', cat: 'Stylized', params: [r('amt', 'Intensity', 0, 100, 70)],
    frag: 'uniform float u_amt; void main(){ float k=sin(u_p*3.14159)*u_amt; float row=floor(v_uv.y*24.); float n=hash(vec2(row,floor(u_p*30.))); vec2 uv=v_uv; uv.x+=(n-0.5)*0.3*k*step(0.6,n); float sp=0.02*k; vec4 a=vec4(A(uv+vec2(sp,0.)).r,A(uv).g,A(uv-vec2(sp,0.)).b,A(uv).a); vec4 b=vec4(B(uv+vec2(sp,0.)).r,B(uv).g,B(uv-vec2(sp,0.)).b,B(uv).a); float sw=step(hash(vec2(floor(v_uv.y*12.),floor(u_p*20.))),u_p); o=mix(a,b,sw); }',
    uniforms: function (p) { return { u_amt: p.amt / 100 }; } });
  reg({ id: 'pixelize', name: 'Pixel Dissolve', cat: 'Stylized', params: [r('max', 'Max Cell', 4, 200, 60, 1, ' px')],
    frag: 'uniform float u_m; void main(){ float s=max(1.,u_m*sin(u_p*3.14159)); vec2 cell=s/u_size; vec2 uv=(floor(v_uv/cell)+0.5)*cell; o=mix(A(uv),B(uv),smoothstep(0.35,0.65,u_p)); }',
    uniforms: function (p, ctx) { return { u_m: p.max * ctx.px }; } });
  reg({ id: 'flash', name: 'Flash Cut', cat: 'Stylized', params: [col('c', 'Flash Color', '#ffffff')],
    frag: 'uniform vec3 u_c; void main(){ float f=1.-abs(u_p-0.5)*2.; f=pow(f,2.); vec4 base = u_p<0.5 ? A(v_uv) : B(v_uv); o=vec4(mix(base.rgb,u_c,f), max(base.a,f)); }',
    uniforms: function (p) { return { u_c: U.hexToRgb(p.c) }; } });
  reg({ id: 'morph', name: 'Ripple Morph', cat: 'Stylized', params: [r('amp', 'Strength', 0, 100, 40), r('freq', 'Rings', 1, 40, 12)],
    frag: 'uniform float u_amp,u_fr; void main(){ vec2 c=v_uv-0.5; float d=length(c); float k=sin(u_p*3.14159)*u_amp*0.05; vec2 off=normalize(c+1e-5)*sin(d*u_fr*6.28-u_p*12.)*k; o=mix(A(v_uv+off),B(v_uv+off),smoothstep(0.2,0.8,u_p)); }',
    uniforms: function (p) { return { u_amp: p.amp / 100 * 2, u_fr: p.freq }; } });

  // Audio transitions
  reg({ id: 'a_power', name: 'Constant Power', cat: 'Audio', kind: 'audio' });
  reg({ id: 'a_gain', name: 'Constant Gain', cat: 'Audio', kind: 'audio' });
  reg({ id: 'a_exp', name: 'Exponential Fade', cat: 'Audio', kind: 'audio' });

  // Gain curves for audio transitions: returns [outGain, inGain] at progress p
  TR.audioGains = function (type, p) {
    p = U.clamp(p, 0, 1);
    if (type === 'a_gain') return [1 - p, p];
    if (type === 'a_exp') return [Math.pow(1 - p, 2.5), 1 - Math.pow(1 - p, 2.5)];
    return [Math.cos(p * Math.PI / 2), Math.sin(p * Math.PI / 2)];
  };
  TR.forKind = function (k) { return TR.list.filter(function (d) { return d.kind === k; }); };
})();
