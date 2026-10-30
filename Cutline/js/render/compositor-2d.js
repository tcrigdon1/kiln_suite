/* Cutline — Canvas 2D fallback compositor (used when WebGL2 is unavailable). Supports transforms, opacity,
   blend modes, a subset of effects via ctx.filter, and dissolve-style transitions. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, S = C.Scene;
  var BLEND2D = { normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', add: 'lighter', darken: 'darken', lighten: 'lighten',
    difference: 'difference', exclusion: 'exclusion', softlight: 'soft-light', hardlight: 'hard-light', dodge: 'color-dodge', burn: 'color-burn', color: 'color', luminosity: 'luminosity', subtract: 'difference' };

  function Comp2D(canvas) {
    this.canvas = canvas; this.kind = '2d';
    this.g = canvas.getContext('2d');
    this.tmp = document.createElement('canvas');
    this.tmp2 = document.createElement('canvas');
  }
  Comp2D.prototype.drawClip = function (g, L, ctx) {
    var src = L.offline ? null : ctx.provider.source(L, ctx);
    if (!src || !src.el) return;
    var seq = ctx.seq, sc = ctx.outW / seq.w, q = S.quad(seq, L);
    var filters = [];
    L.fx.forEach(function (e) { if (e.def.filter2d) filters.push(e.def.filter2d(e.p)); });
    if (L.col) {
      filters.push('brightness(' + Math.pow(2, L.col.exposure) + ')', 'contrast(' + (1 + L.col.contrast / 100) + ')', 'saturate(' + L.col.sat / 100 + ')');
    }
    g.save();
    g.globalAlpha = U.clamp(L.tf.op / 100, 0, 1) * (L._alpha == null ? 1 : L._alpha);
    g.globalCompositeOperation = BLEND2D[L.blend] || 'source-over';
    if (filters.length) g.filter = filters.join(' ');
    var tf = L.tf;
    g.setTransform(sc, 0, 0, sc, 0, 0);
    g.translate(tf.x, tf.y);
    g.rotate(tf.rot * Math.PI / 180);
    g.scale(q.sx, q.sy);
    var ax = tf.ax / 100 * q.nw, ay = tf.ay / 100 * q.nh;
    var x0 = tf.cl / 100 * q.nw, y0 = tf.ct / 100 * q.nh, x1 = q.nw * (1 - tf.cr / 100), y1 = q.nh * (1 - tf.cb / 100);
    var sw = src.w, sh = src.h, kx = sw / q.nw, ky = sh / q.nh;
    try { g.drawImage(src.el, x0 * kx, y0 * ky, Math.max(1, (x1 - x0) * kx), Math.max(1, (y1 - y0) * ky), x0 - ax, y0 - ay, x1 - x0, y1 - y0); } catch (e) { }
    g.restore();
  };
  Comp2D.prototype.render = function (scene, outW, outH, provider, opts) {
    opts = opts || {};
    outW = Math.round(outW); outH = Math.round(outH);
    if (this.canvas.width !== outW || this.canvas.height !== outH) { this.canvas.width = outW; this.canvas.height = outH; }
    var g = this.g, self = this, ctx = { seq: scene.seq, outW: outW, outH: outH, provider: provider, time: scene.time };
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
    g.fillStyle = scene.bg; g.fillRect(0, 0, outW, outH);
    scene.layers.forEach(function (L) {
      if (L.t === 'clip') { if (!L.adjust) self.drawClip(g, L, ctx); }
      else if (L.t === 'trans') {
        if (L.a) { L.a._alpha = 1 - L.p; self.drawClip(g, L.a, ctx); }
        if (L.b) { L.b._alpha = L.p; self.drawClip(g, L.b, ctx); }
      }
    });
    if (scene.caption && opts.captions !== false) { g.setTransform(1, 0, 0, 1, 0, 0); C.Titles.drawCaption(g, scene.seq, scene.caption, outW, outH); }
    this.lastSize = [outW, outH];
  };
  Comp2D.prototype.readSmall = function (w, h) {
    var t = this.tmp; t.width = w; t.height = h;
    var g = t.getContext('2d'); g.drawImage(this.canvas, 0, 0, w, h);
    return g.getImageData(0, 0, w, h).data;
  };
  Comp2D.prototype.readFull = function () {
    var g = this.g; return { w: this.canvas.width, h: this.canvas.height, data: g.getImageData(0, 0, this.canvas.width, this.canvas.height).data };
  };
  Comp2D.prototype.gcTextures = function () {};
  Comp2D.prototype.destroy = function () {};
  C.Comp2D = Comp2D;

  C.createCompositor = function (canvas, force2d) {
    if (!force2d) { try { return new C.GLComp(canvas); } catch (e) { console.warn('[Cutline] WebGL2 unavailable, using 2D fallback:', e.message); } }
    return new Comp2D(canvas);
  };
})();
