/* Cutline — transition & effect pack (sequence 5): light leak, film burn, cube rotate, ink bleed, zoom swish,
   page turn; RGB split, lens flare, VHS look, soft focus glow, radial focus, cel shade, thermal, old film. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, TR = C.TR, FX = C.FX;
  function r(k, name, min, max, def, step, unit) { return { k: k, name: name, type: 'range', min: min, max: max, def: def, step: step || 1, unit: unit || '' }; }
  function sel(k, name, opts, def) { return { k: k, name: name, type: 'select', options: opts, def: def }; }
  function col(k, name, def) { return { k: k, name: name, type: 'color', def: def }; }
  function bool(k, name, def) { return { k: k, name: name, type: 'bool', def: def }; }
  function tr(def) { def.params = def.params || []; def.kind = 'video'; TR.list.push(def); TR.byId[def.id] = def; }
  function fx(def) { def.stage = def.stage || 'source'; def.params = def.params || []; FX.list.push(def); FX.byId[def.id] = def; }

  /* ---------- transitions ---------- */
  // warm streaks sweep across while the clips dissolve underneath
  tr({ id: 'lightleak', name: 'Light Leak', cat: 'Dissolve', params: [col('c', 'Color', '#ffb347'), r('amt', 'Intensity', 0, 200, 70, 1, '%'), r('ang', 'Angle', -90, 90, 25, 1, '°')],
    frag: 'uniform vec3 u_c; uniform float u_amt, u_ang;\n' +
      'void main(){ float m=smoothstep(0.2,0.8,u_p); vec4 base=mix(A(v_uv),B(v_uv),m); vec2 q=rot(v_uv-0.5,u_ang); float sweep=q.x+0.5 - (u_p*1.8-0.4);' +
      ' float leak = exp(-sweep*sweep*18.) + 0.6*exp(-(sweep-0.18)*(sweep-0.18)*40.) + 0.35*exp(-(sweep+0.22)*(sweep+0.22)*60.);' +
      ' float env = sin(u_p*3.14159); vec3 glow = u_c*leak*env*u_amt*0.45; o = vec4(base.rgb + glow*(0.6+0.4*base.a), max(base.a, min(1., leak*env*u_amt*0.5))); }',
    uniforms: function (p) { return { u_c: U.hexToRgb(p.c), u_amt: p.amt / 100, u_ang: p.ang * Math.PI / 180 }; } });
  // the outgoing frame scorches from a hot spot, the incoming one rises out of the burn
  tr({ id: 'filmburn', name: 'Film Burn', cat: 'Dissolve', params: [r('seed', 'Variation', 0, 100, 30), r('heat', 'Heat', 0, 100, 60)],
    frag: 'uniform float u_seed, u_heat;\n' +
      'float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }\n' +
      'void main(){ vec2 c=vec2(0.3+0.4*hash(vec2(u_seed,1.)),0.4+0.3*hash(vec2(u_seed,2.))); float d=distance(v_uv*vec2(u_size.x/u_size.y,1.), c*vec2(u_size.x/u_size.y,1.));' +
      ' float n=n2(v_uv*6.+u_seed)*0.35+n2(v_uv*18.+u_seed)*0.15; float front = u_p*1.6 - d - n; float burn = smoothstep(-0.08,0.08,front);' +
      ' float edge = smoothstep(0.,0.1,front)*(1.-smoothstep(0.1,0.3,front)); vec4 a=A(v_uv), b=B(v_uv);' +
      ' vec3 scorch = mix(a.rgb, vec3(0.05,0.02,0.0), smoothstep(-0.25,0.05,front)); vec3 fire = vec3(1.,0.55,0.15)*edge*u_heat*2. + vec3(1.,0.9,0.6)*edge*edge*u_heat;' +
      ' vec4 outA = vec4(scorch + fire, a.a); o = mix(outA, b + vec4(fire*(1.-burn),0.), burn); }',
    uniforms: function (p) { return { u_seed: p.seed, u_heat: p.heat / 100 }; } });
  // both frames on the faces of a rotating box
  tr({ id: 'cube', name: 'Cube Rotate', cat: 'Motion', params: [sel('dir', 'Direction', [['l', 'Left'], ['r', 'Right'], ['u', 'Up'], ['d', 'Down']], 'l'), r('persp', 'Perspective', 0, 100, 40), r('shade', 'Shading', 0, 100, 50)],
    frag: 'uniform int u_dir; uniform float u_persp, u_shade;\n' +
      'void main(){ vec2 uv = v_uv; bool vert = u_dir>=2; float s = (u_dir==1||u_dir==3) ? -1. : 1.; float t = u_p; float x = vert ? uv.y : uv.x; if(s<0.) x = 1.-x;' +
      ' float pr = u_persp*0.6; vec4 res; float ang = t*1.5708;' +
      ' float xa = x/(1.-t) ; float xb = (x-(1.-t))/t;' + // where on each face the ray lands
      ' if (x < 1.-t) { vec2 q = vert ? vec2(uv.x, (s<0.?1.-xa:xa)) : vec2((s<0.?1.-xa:xa), uv.y); float depth = mix(1., 1.+pr*t, xa); vec2 qq = vert ? vec2((q.x-0.5)*depth+0.5, q.y) : vec2(q.x, (q.y-0.5)*depth+0.5); res = A(qq)*(1.-u_shade*t*0.8); }' +
      ' else { vec2 q = vert ? vec2(uv.x, (s<0.?1.-xb:xb)) : vec2((s<0.?1.-xb:xb), uv.y); float depth = mix(1.+pr*(1.-t), 1., xb); vec2 qq = vert ? vec2((q.x-0.5)*depth+0.5, q.y) : vec2(q.x, (q.y-0.5)*depth+0.5); res = B(qq)*(1.-u_shade*(1.-t)*0.8); }' +
      ' o = res; }',
    uniforms: function (p) { return { u_dir: { i: p.dir === 'l' ? 0 : p.dir === 'r' ? 1 : p.dir === 'u' ? 2 : 3 }, u_persp: p.persp / 100, u_shade: p.shade / 100 }; } });
  // incoming frame soaks through like ink spreading on paper
  tr({ id: 'ink', name: 'Ink Bleed', cat: 'Dissolve', params: [r('seed', 'Variation', 0, 100, 10), r('soft', 'Edge Softness', 0, 100, 30), bool('dark', 'Dark Edge', true)],
    frag: 'uniform float u_seed, u_soft; uniform int u_dark;\n' +
      'float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }\n' +
      'void main(){ float n = n2(v_uv*4.+u_seed)*0.5 + n2(v_uv*9.+u_seed*2.)*0.3 + n2(v_uv*25.+u_seed*3.)*0.2; float th = u_p*1.3-0.15; float m = smoothstep(th-0.02-u_soft*0.15, th+0.02, n);' +
      ' vec4 a=A(v_uv), b=B(v_uv); float edge = (1.-m)*smoothstep(th-0.12-u_soft*0.15, th-0.02, n); vec3 col = mix(b.rgb, a.rgb, m); if(u_dark==1) col *= 1.-edge*0.7; o = vec4(col, mix(b.a,a.a,m)); }',
    uniforms: function (p) { return { u_seed: p.seed, u_soft: p.soft / 100, u_dark: { i: p.dark ? 1 : 0 } }; } });
  // fast zoom-blur swish through the cut
  tr({ id: 'swish', name: 'Zoom Swish', cat: 'Motion', params: [r('amt', 'Blur Amount', 0, 100, 60), sel('mode', 'Motion', [['in', 'Zoom In'], ['out', 'Zoom Out']], 'in')],
    frag: 'uniform float u_amt; uniform int u_mode;\n' +
      'void main(){ float e = sin(u_p*3.14159); float k = e*u_amt*0.5; vec2 c = v_uv-0.5; vec4 acc = vec4(0.); float m = smoothstep(0.35,0.65,u_p);' +
      ' for(int i=0;i<12;i++){ float t = float(i)/11.; float sc = 1. + (u_mode==0 ? 1. : -1.) * k * (t-0.5); vec2 uv = c/sc+0.5; acc += mix(A(uv),B(uv),m); } o = acc/12.; }',
    uniforms: function (p) { return { u_amt: p.amt / 100, u_mode: { i: p.mode === 'in' ? 0 : 1 } }; } });
  // simple page turn from the right edge with a shaded back face
  tr({ id: 'pageturn', name: 'Page Turn', cat: 'Wipe', params: [r('curl', 'Curl Radius', 2, 40, 12, 1, '%'), r('shade', 'Back Shade', 0, 100, 60)],
    frag: 'uniform float u_curl, u_shade;\n' +
      'void main(){ float rad = u_curl; vec2 uv=v_uv; float d = uv.x + uv.y*0.15; float edge = 1.0 + 0.15 - u_p*(1.3+rad*2.); float x = d - edge;' +
      ' if (x < 0.) { o = A(uv); } else if (x < rad) { float a = x/rad*3.14159; vec2 back = vec2(edge - x, uv.y); float sh = 1.-u_shade*(0.3+0.7*sin(a*0.5)); vec4 pa = A(vec2(clamp(back.x,0.,1.),back.y)); vec3 paper = mix(vec3(0.92), pa.rgb*0.6+0.35, 0.5)*sh; float m = smoothstep(0.,0.2,x/rad); o = mix(A(uv), vec4(paper,1.)*A(uv).a + B(uv)*(1.-A(uv).a), m); o = mix(o, B(uv), step(0.5, x/rad)*(x/rad-0.5)*2.*0.); }' +
      ' else { o = B(uv); } }',
    uniforms: function (p) { return { u_curl: p.curl / 100, u_shade: p.shade / 100 }; } });

  /* ---------- effects ---------- */
  fx({ id: 'rgbsplit', name: 'RGB Split', cat: 'Stylize', params: [r('amt', 'Offset', 0, 60, 8, 0.5, ' px'), r('ang', 'Angle', -180, 180, 0, 1, '°'), sel('mode', 'Mode', [['lin', 'Linear'], ['rad', 'Radial (from centre)']], 'lin')],
    frag: 'uniform float u_amt, u_ang; uniform int u_mode;\n' +
      'void main(){ vec2 d; if(u_mode==1){ d = (v_uv-0.5)*2.*u_amt; } else { d = vec2(cos(u_ang),sin(u_ang))*u_amt; } vec2 px = d/u_size; vec4 c=tex(v_uv); vec4 rr=tex(v_uv+px), bb=tex(v_uv-px); o = vec4(rr.r, c.g, bb.b, max(c.a, max(rr.a, bb.a))); }',
    uniforms: function (p, ctx) { return { u_amt: p.amt * (ctx && ctx.px || 1), u_ang: p.ang * Math.PI / 180, u_mode: { i: p.mode === 'rad' ? 1 : 0 } }; } });
  fx({ id: 'lensflare', name: 'Lens Flare', cat: 'Stylize', params: [r('x', 'Position X', 0, 100, 70, 0.5, '%'), r('y', 'Position Y', 0, 100, 30, 0.5, '%'), r('amt', 'Brightness', 0, 200, 80, 1, '%'), col('c', 'Tint', '#ffd9a0'), r('ghosts', 'Ghosts', 0, 100, 60)],
    frag: 'uniform vec2 u_pos; uniform float u_amt, u_ghosts; uniform vec3 u_c;\n' +
      'void main(){ vec4 c=tex(v_uv); float asp=u_size.x/u_size.y; vec2 uv=(v_uv-0.5)*vec2(asp,1.); vec2 L=(u_pos-0.5)*vec2(asp,1.); vec2 d=uv-L; float r=length(d);' +
      ' float core = exp(-r*r*40.)*1.2 + exp(-r*r*6.)*0.35; float streak = exp(-abs(d.y)*60.)*exp(-abs(d.x)*2.5)*0.5 + exp(-abs(d.x)*60.)*exp(-abs(d.y)*2.5)*0.25;' +
      ' float gh=0.; for(int i=1;i<=5;i++){ float t=float(i)*0.35; vec2 g = L*(1.-t*1.4); float rr=length(uv-g); float rad = 0.04+0.03*float(i); gh += smoothstep(rad,rad*0.6,rr)*(0.18-0.02*float(i)); }' +
      ' float ring = smoothstep(0.02,0.0,abs(length(uv+L*0.6)-0.22))*0.15; vec3 add = (u_c*(core+streak) + vec3(0.6,0.8,1.0)*(gh+ring)*u_ghosts)*u_amt; o = vec4(c.rgb + add*max(c.a,0.001)/max(c.a,0.001), max(c.a, min(1., core*u_amt))); }',
    uniforms: function (p) { return { u_pos: [p.x / 100, p.y / 100], u_amt: p.amt / 100, u_ghosts: p.ghosts / 100, u_c: U.hexToRgb(p.c) }; } });
  fx({ id: 'vhs', name: 'VHS Look', cat: 'Stylize', params: [r('bleed', 'Color Bleed', 0, 100, 50), r('noise', 'Noise', 0, 100, 35), r('wobble', 'Tracking Wobble', 0, 100, 30), r('lines', 'Scanlines', 0, 100, 40), bool('date', 'Soften', true)],
    frag: 'uniform float u_bleed, u_noise, u_wobble, u_lines; uniform int u_soft;\n' +
      'void main(){ vec2 uv=v_uv; float line = floor(uv.y*u_size.y); float wob = (hash(vec2(line, floor(u_time*24.)))-0.5)*u_wobble*0.01; float band = smoothstep(0.0,0.05,abs(fract(uv.y - u_time*0.08)-0.5)-0.46)*u_wobble*0.03; uv.x += wob*0.3 + band;' +
      ' vec2 px=vec2(1.,0.)/u_size; float b = u_bleed*6.; vec4 c; if(u_soft==1){ c = (tex(uv)*2.+tex(uv-px)+tex(uv+px))/4.; } else c = tex(uv);' +
      ' float cr = tex(uv+px*b).r, cb = tex(uv-px*b).b; vec3 col = vec3(mix(c.r,cr,0.6), c.g, mix(c.b,cb,0.6));' +
      ' float n = (hash(uv*u_size + u_time*7.)-0.5)*u_noise*0.25; col += n; float sl = 1.-u_lines*0.25*step(0.5, fract(uv.y*u_size.y*0.5)); col *= sl;' +
      ' col = mix(col, vec3(dot(col,vec3(0.3,0.59,0.11))), 0.15); o = vec4(col*c.a, c.a); o.rgb = col; }',
    uniforms: function (p) { return { u_bleed: p.bleed / 100, u_noise: p.noise / 100, u_wobble: p.wobble / 100, u_lines: p.lines / 100, u_soft: { i: p.date ? 1 : 0 } }; } });
  fx({ id: 'softfocus', name: 'Soft Focus Glow', cat: 'Blur & Sharpen', params: [r('r', 'Radius', 1, 40, 10, 0.5, ' px'), r('amt', 'Amount', 0, 100, 45), r('th', 'Highlights Only', 0, 100, 30)],
    frag: 'uniform float u_r, u_amt, u_th;\n' +
      'void main(){ vec4 c=tex(v_uv); vec2 px=u_r/u_size; vec4 acc=vec4(0.); float w=0.; for(int i=-3;i<=3;i++) for(int j=-3;j<=3;j++){ float g=exp(-float(i*i+j*j)/6.); acc+=tex(v_uv+vec2(float(i),float(j))*px)*g; w+=g; } acc/=w;' +
      ' float l = luma(acc.rgb); float k = smoothstep(u_th*0.8, 1.0, l); vec3 glow = acc.rgb*(0.4+0.6*k); vec3 col = 1.-(1.-c.rgb)*(1.-glow*u_amt); o = vec4(mix(c.rgb, col, u_amt), c.a); }',
    uniforms: function (p, ctx) { return { u_r: p.r * (ctx && ctx.px || 1), u_amt: p.amt / 100, u_th: p.th / 100 }; } });
  fx({ id: 'radialfocus', name: 'Radial Focus', cat: 'Blur & Sharpen', params: [r('x', 'Centre X', 0, 100, 50, 0.5, '%'), r('y', 'Centre Y', 0, 100, 50, 0.5, '%'), r('size', 'Sharp Area', 0, 100, 35), r('feather', 'Feather', 1, 100, 40), r('blur', 'Blur', 0, 40, 12, 0.5, ' px')],
    frag: 'uniform vec2 u_c; uniform float u_size2, u_feather, u_blur;\n' +
      'void main(){ float asp=u_size.x/u_size.y; vec2 d=(v_uv-u_c)*vec2(asp,1.); float r=length(d); float m = smoothstep(u_size2, u_size2+u_feather, r); vec4 c=tex(v_uv); if(m<=0.001){ o=c; return; }' +
      ' vec2 px=u_blur*m/u_size; vec4 acc=vec4(0.); float w=0.; for(int i=-3;i<=3;i++) for(int j=-3;j<=3;j++){ float g=exp(-float(i*i+j*j)/5.); acc+=tex(v_uv+vec2(float(i),float(j))*px)*g; w+=g; } o = mix(c, acc/w, m); }',
    uniforms: function (p, ctx) { return { u_c: [p.x / 100, p.y / 100], u_size2: p.size / 100 * 0.9, u_feather: p.feather / 100 * 0.8, u_blur: p.blur * (ctx && ctx.px || 1) }; } });
  fx({ id: 'celshade', name: 'Cel Shade (Comic)', cat: 'Stylize', params: [r('levels', 'Shade Levels', 2, 8, 4), r('edge', 'Ink Lines', 0, 100, 60), r('sat', 'Saturation', 0, 200, 120, 1, '%')],
    frag: 'uniform float u_levels, u_edge, u_sat;\n' +
      'void main(){ vec4 c=tex(v_uv); vec2 px=1./u_size; vec3 hsv=rgb2hsv(c.rgb); hsv.z = floor(hsv.z*u_levels+0.5)/u_levels; hsv.y = min(1., hsv.y*u_sat); vec3 col = hsv2rgb(hsv);' +
      ' float gx = luma(tex(v_uv+vec2(px.x,0.)).rgb)-luma(tex(v_uv-vec2(px.x,0.)).rgb); float gy = luma(tex(v_uv+vec2(0.,px.y)).rgb)-luma(tex(v_uv-vec2(0.,px.y)).rgb); float e = smoothstep(0.08, 0.25, length(vec2(gx,gy))*3.)*u_edge; o = vec4(col*(1.-e), c.a); }',
    uniforms: function (p) { return { u_levels: p.levels, u_edge: p.edge / 100, u_sat: p.sat / 100 }; } });
  fx({ id: 'thermal', name: 'Thermal Camera', cat: 'Color', params: [r('amt', 'Amount', 0, 100, 100, 1, '%'), sel('pal', 'Palette', [['iron', 'Iron'], ['rainbow', 'Rainbow'], ['white', 'White Hot']], 'iron')],
    frag: 'uniform float u_amt; uniform int u_pal;\n' +
      'vec3 iron(float t){ return vec3(smoothstep(0.,0.5,t)*1.1, smoothstep(0.3,0.85,t), smoothstep(0.,0.25,t)*(1.-smoothstep(0.3,0.6,t)) + smoothstep(0.8,1.,t)); }\n' +
      'void main(){ vec4 c=tex(v_uv); float l=luma(c.rgb); vec3 m; if(u_pal==0) m=iron(l); else if(u_pal==1) m=hsv2rgb(vec3((1.-l)*0.75,1.,1.)); else m=vec3(l); o = vec4(mix(c.rgb, m, u_amt), c.a); }',
    uniforms: function (p) { return { u_amt: p.amt / 100, u_pal: { i: p.pal === 'iron' ? 0 : p.pal === 'rainbow' ? 1 : 2 } }; } });
  fx({ id: 'oldfilm', name: 'Old Film', cat: 'Stylize', params: [r('grain', 'Grain', 0, 100, 40), r('scratch', 'Scratches', 0, 100, 30), r('flicker', 'Flicker', 0, 100, 25), r('sepia', 'Sepia', 0, 100, 60), r('vig', 'Vignette', 0, 100, 50), r('jitter', 'Gate Jitter', 0, 100, 20)],
    frag: 'uniform float u_grain, u_scratch, u_flicker, u_sepia, u_vig, u_jit;\n' +
      'void main(){ float fr = floor(u_time*24.); vec2 jit = (vec2(hash(vec2(fr,1.)),hash(vec2(fr,2.)))-0.5)*u_jit*0.01; vec4 c=tex(v_uv+jit); vec3 col=c.rgb;' +
      ' float l=luma(col); vec3 sep = vec3(l*1.1, l*0.95, l*0.75); col = mix(col, sep, u_sepia);' +
      ' float g = (hash(v_uv*u_size*0.5 + fr*13.)-0.5)*u_grain*0.3; col += g; col *= 1. + (hash(vec2(fr,7.))-0.5)*u_flicker*0.4;' +
      ' float sx = hash(vec2(floor(v_uv.x*u_size.x*0.25), fr)); float scr = step(1.-u_scratch*0.02, sx) * step(0.3, hash(vec2(fr, floor(v_uv.x*u_size.x*0.25)))); col = mix(col, vec3(0.9), scr*0.8);' +
      ' float d = distance(v_uv, vec2(0.5)); col *= 1. - smoothstep(0.35, 0.9, d)*u_vig; o = vec4(col, c.a); }',
    uniforms: function (p) { return { u_grain: p.grain / 100, u_scratch: p.scratch / 100, u_flicker: p.flicker / 100, u_sepia: p.sepia / 100, u_vig: p.vig / 100, u_jit: p.jitter / 100 }; } });
})();
