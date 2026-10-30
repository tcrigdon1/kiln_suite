/* Cutline — keyframe storage & interpolation. Keys are stored per clip:
   clip.kf[path] = [{f: localFrame, v: value, e: easing}], easing applies to segment after the key. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util;
  var KF = C.KF = {};

  KF.EASINGS = [
    { id: 'linear', name: 'Linear' }, { id: 'in', name: 'Ease In' }, { id: 'out', name: 'Ease Out' },
    { id: 'inout', name: 'Ease In-Out' }, { id: 'smooth', name: 'Smooth (gentle)' }, { id: 'snap', name: 'Snappy' },
    { id: 'back', name: 'Overshoot' }, { id: 'bounce', name: 'Bounce' }, { id: 'elastic', name: 'Elastic' },
    { id: 'hold', name: 'Hold' }, { id: 'bezier', name: 'Custom Curve…' }
  ];
  // cubic-bezier(x1,y1,x2,y2) like CSS: solve x(t)=u for t, return y(t)
  function bez1(a, b, t) { var it = 1 - t; return 3 * it * it * t * a + 3 * it * t * t * b + t * t * t; }
  KF.cubicBezier = function (u, x1, y1, x2, y2) {
    if (u <= 0) return 0; if (u >= 1) return 1;
    var t = u;
    for (var i = 0; i < 8; i++) { // Newton on x(t) - u
      var x = bez1(x1, x2, t) - u; if (Math.abs(x) < 1e-5) break;
      var it = 1 - t, dx = 3 * it * it * x1 + 6 * it * t * (x2 - x1) + 3 * t * t * (1 - x2);
      if (Math.abs(dx) < 1e-6) break; t -= x / dx; t = Math.min(1, Math.max(0, t));
    }
    return bez1(y1, y2, t);
  };
  KF.BEZIER_DEFAULT = [0.42, 0, 0.58, 1];

  function resolve(clip, path) {
    var p = path.split('.');
    if (p[0] === 'tf') return { obj: clip.tf, key: p[1] };
    if (p[0] === 'col') { if (!clip.col && clip.kind === 'video') clip.col = C.P.defaultColor(); return { obj: clip.col, key: p[1] }; }
    if (p[0] === 'au') return { obj: clip.au, key: p[1] };
    if (p[0] === 'tm') { if (!clip.tm) clip.tm = { speed: 100 }; return { obj: clip.tm, key: p[1] }; }
    if (p[0] === 'mk') { var mk = (clip.masks || []).filter(function (m) { return m.id === p[1]; })[0]; return mk ? { obj: mk, key: p[2] } : null; }
    if (p[0] === 'fx') {
      var fx = (clip.fx || []).filter(function (e) { return e.id === p[1]; })[0];
      return fx ? { obj: fx.p, key: p[2] } : null;
    }
    if (p[0] === 'tt') {
      var layers = clip.gen && clip.gen.layers || [];
      var L = layers.filter(function (l) { return l.id === p[1]; })[0];
      return L ? { obj: L, key: p[2] } : null;
    }
    if (p[0] === 'tr') return null;
    return null;
  }
  KF.resolve = resolve;
  KF.get = function (clip, path) { var r = resolve(clip, path); return r && r.obj ? r.obj[r.key] : undefined; };
  KF.setBase = function (clip, path, v) { var r = resolve(clip, path); if (r && r.obj) r.obj[r.key] = v; };
  KF.keys = function (clip, path) { return clip.kf && clip.kf[path] && clip.kf[path].length ? clip.kf[path] : null; };
  KF.has = function (clip, path) { return !!KF.keys(clip, path); };

  function ease(t, e, bz) {
    switch (e) {
      case 'in': return t * t * t;
      case 'out': return 1 - Math.pow(1 - t, 3);
      case 'inout': return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      case 'smooth': return t * t * (3 - 2 * t);
      case 'snap': return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
      case 'back': { var s = 1.70158; return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2); }
      case 'bounce': { var n1 = 7.5625, d1 = 2.75, x = t; if (x < 1 / d1) return n1 * x * x; if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75; if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375; return n1 * (x -= 2.625 / d1) * x + 0.984375; }
      case 'elastic': { if (t <= 0) return 0; if (t >= 1) return 1; var c4 = (2 * Math.PI) / 3; return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1; }
      case 'bezier': { var b = bz && bz.length === 4 ? bz : KF.BEZIER_DEFAULT; return KF.cubicBezier(t, b[0], b[1], b[2], b[3]); }
      case 'hold': return 0;
      default: return t;
    }
  }
  KF.ease = ease;

  KF.evalKeys = function (keys, f) {
    if (f <= keys[0].f) return keys[0].v;
    var last = keys[keys.length - 1];
    if (f >= last.f) return last.v;
    for (var i = 0; i < keys.length - 1; i++) {
      var a = keys[i], b = keys[i + 1];
      if (f >= a.f && f <= b.f) {
        if (b.f === a.f || f === b.f) return b.v; // exactly on a key: that key's value (a hold segment must still land on its end key)
        var t = ease((f - a.f) / (b.f - a.f), a.e || 'linear', a.bz);
        if (typeof a.v !== 'number') return t < 1 ? a.v : b.v;
        return a.v + (b.v - a.v) * t;
      }
    }
    return last.v;
  };

  KF.value = function (clip, path, localF) {
    var keys = KF.keys(clip, path);
    if (keys) return KF.evalKeys(keys, localF);
    return KF.get(clip, path);
  };

  KF.sort = function (keys) { keys.sort(function (a, b) { return a.f - b.f; }); return keys; };

  // Set a value at a local frame; adds/updates a key when the property is animated, else sets the static value.
  KF.setAt = function (clip, path, localF, v) {
    var keys = KF.keys(clip, path);
    if (!keys) { KF.setBase(clip, path, v); return; }
    localF = Math.round(localF);
    for (var i = 0; i < keys.length; i++) if (keys[i].f === localF) { keys[i].v = v; return; }
    keys.push({ f: localF, v: v, e: 'linear' });
    KF.sort(keys);
  };
  KF.addKey = function (clip, path, localF) {
    clip.kf = clip.kf || {};
    var v = KF.value(clip, path, localF);
    var keys = clip.kf[path] || (clip.kf[path] = []);
    localF = Math.round(localF);
    for (var i = 0; i < keys.length; i++) if (keys[i].f === localF) return;
    keys.push({ f: localF, v: v, e: 'linear' });
    KF.sort(keys);
  };
  KF.removeKeyAt = function (clip, path, localF) {
    var keys = KF.keys(clip, path); if (!keys) return;
    localF = Math.round(localF);
    var v = KF.value(clip, path, localF);
    clip.kf[path] = keys.filter(function (k) { return k.f !== localF; });
    if (!clip.kf[path].length) { delete clip.kf[path]; KF.setBase(clip, path, v); }
  };
  KF.keyAt = function (clip, path, localF) {
    var keys = KF.keys(clip, path); if (!keys) return null;
    localF = Math.round(localF);
    for (var i = 0; i < keys.length; i++) if (keys[i].f === localF) return keys[i];
    return null;
  };
  KF.toggle = function (clip, path, localF) {
    clip.kf = clip.kf || {};
    if (KF.has(clip, path)) {
      var v = KF.value(clip, path, localF);
      delete clip.kf[path];
      KF.setBase(clip, path, v);
    } else {
      clip.kf[path] = [{ f: Math.round(U.clamp(localF, 0, clip.dur - 1)), v: KF.get(clip, path), e: 'linear' }];
    }
  };
  KF.neighbor = function (clip, path, localF, dir) {
    var keys = KF.keys(clip, path); if (!keys) return null;
    if (dir > 0) { for (var i = 0; i < keys.length; i++) if (keys[i].f > localF + 0.001) return keys[i].f; }
    else { for (var j = keys.length - 1; j >= 0; j--) if (keys[j].f < localF - 0.001) return keys[j].f; }
    return null;
  };
  // All key frames (local) across every property of a clip
  KF.allFrames = function (clip) {
    var s = {};
    if (clip.kf) for (var p in clip.kf) clip.kf[p].forEach(function (k) { s[k.f] = true; });
    return Object.keys(s).map(Number).sort(function (a, b) { return a - b; });
  };
  KF.shiftAll = function (clip, d) {
    if (!clip.kf || !d) return;
    for (var p in clip.kf) clip.kf[p].forEach(function (k) { k.f -= d; });
  };
  KF.scaleAll = function (clip, ratio) {
    if (!clip.kf) return;
    for (var p in clip.kf) clip.kf[p].forEach(function (k) { k.f = Math.round(k.f * ratio); });
  };
  KF.removeForPrefix = function (clip, prefix) { if (!clip.kf) return; for (var p in clip.kf) if (p.indexOf(prefix) === 0) delete clip.kf[p]; };
  KF.removeForEffect = function (clip, fxId) {
    if (!clip.kf) return;
    for (var p in clip.kf) if (p.indexOf('fx.' + fxId + '.') === 0) delete clip.kf[p];
  };
  KF.anyAnimated = function (clip) { if (!clip.kf) return false; for (var p in clip.kf) if (clip.kf[p].length) return true; return false; };
})();
