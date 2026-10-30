/* Cutline — preview render cache: "Render In to Out" pre-renders frames (frame-exact, with decoders, like an export)
   into ImageBitmaps at the preview size. The engine shows cached frames directly while the sequence is unchanged;
   any edit invalidates the cache. The timeline ruler shows a render bar: green = rendered, red = In→Out not rendered. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, P = C.P;
  var RC = C.RenderCache = { frames: {}, seqId: null, sig: null, bytes: 0, LIMIT: 400 * 1048576, n: 0 };

  // cheap content signature: clips/transitions/captions/tracks of the sequence (not playhead/zoom/selection)
  function sigOf(s) {
    var o = { c: s.clips, t: s.transitions, k: s.captions, tr: s.tracks.map(function (t) { return [t.id, t.hidden, t.mute]; }), w: s.w, h: s.h, fps: s.fps, bg: s.bg, cap: s.capStyle, sc: s.showCaptions, lut: (C.state.project.luts || []).length, media: C.state.project.media.length };
    return JSON.stringify(o);
  }
  RC.clear = function () {
    for (var k in RC.frames) { try { RC.frames[k].img.close(); } catch (e) { } }
    RC.frames = {}; RC.bytes = 0; RC.n = 0; RC.seqId = null; RC.sig = null;
    if (C.TL && C.TL.redraw) C.TL.redraw();
  };
  RC.valid = function (s) { return RC.seqId === s.id && RC.sig === sigOf(s); };
  RC.frame = function (s, f) {
    if (!RC.n) return null;
    if (!RC.valid(s)) { RC.clear(); return null; }
    return RC.frames[f] || null;
  };
  RC.has = function (f) { return !!RC.frames[f]; };
  // ranges of cached frames [[a,b),...] for the bar
  RC.ranges = function () {
    var ks = Object.keys(RC.frames).map(Number).sort(function (a, b) { return a - b; }), out = [], i = 0;
    while (i < ks.length) { var a = ks[i], b = a + 1; while (i + 1 < ks.length && ks[i + 1] === b) { b++; i++; } out.push([a, b]); i++; }
    return out;
  };
  RC.drawBar = function (g, s, W, TL) {
    var y = TL.RULER - 3, hh = 2;
    if (RC.n && RC.seqId === s.id && RC.valid(s)) {
      g.fillStyle = '#3fb950';
      RC.ranges().forEach(function (r) { var x0 = TL.f2x(r[0]), x1 = TL.f2x(r[1]); if (x1 < 0 || x0 > W) return; g.fillRect(Math.max(0, x0), y, Math.min(W, x1) - Math.max(0, x0), hh); });
    }
    if (s.inF != null && s.outF != null && s.outF > s.inF) { // unrendered part of In→Out
      var inside = [[s.inF, s.outF]];
      if (RC.n && RC.seqId === s.id && RC.valid(s)) RC.ranges().forEach(function (r) { var nx = []; inside.forEach(function (q) { if (r[1] <= q[0] || r[0] >= q[1]) { nx.push(q); return; } if (q[0] < r[0]) nx.push([q[0], r[0]]); if (r[1] < q[1]) nx.push([r[1], q[1]]); }); inside = nx; });
      g.fillStyle = 'rgba(229,83,75,.8)';
      inside.forEach(function (q) { var x0 = TL.f2x(q[0]), x1 = TL.f2x(q[1]); if (x1 < 0 || x0 > W) return; g.fillRect(Math.max(0, x0), y, Math.min(W, x1) - Math.max(0, x0), hh); });
    }
  };
  // render [f0, f1) at the current preview size; opts: { onProgress, cancel }
  RC.render = function (s, f0, f1, opts) {
    opts = opts || {};
    var E = C.Engine, sz = E.outputSize(), w = sz[0], hh = sz[1];
    if (!RC.valid(s)) { RC.clear(); RC.seqId = s.id; RC.sig = sigOf(s); }
    var canvas = document.createElement('canvas'); canvas.width = w; canvas.height = hh;
    var comp = C.createCompositor(canvas), prov = new C.SourceProvider('export');
    prov.useDecoders = C.prefs.fastDecode !== false && !!window.VideoDecoder;
    var f = f0, total = Math.max(1, f1 - f0), done = 0, perFrame = w * hh * 4, t0 = performance.now();
    function step() {
      if (opts.cancel && opts.cancel.v) return Promise.resolve('cancelled');
      if (f >= f1) return Promise.resolve('done');
      if (RC.bytes + perFrame > RC.LIMIT) return Promise.resolve('full');
      if (RC.frames[f]) { f++; done++; return step(); }
      var scene = C.Scene.build(s, f, { captions: true });
      return prov.prepare(scene).then(function () {
        comp.render(scene, w, hh, prov, { captions: true });
        return createImageBitmap(canvas);
      }).then(function (bm) {
        RC.frames[f] = { img: bm, w: w, h: hh }; RC.bytes += perFrame; RC.n++;
        f++; done++;
        if (opts.onProgress && (done % 3 === 0 || f >= f1)) opts.onProgress(done / total, 'Frame ' + done + ' / ' + total + ' · ' + (done / Math.max(0.001, (performance.now() - t0) / 1000)).toFixed(1) + ' fps · ' + U.fmtSize(RC.bytes));
        if (done % 6 === 0) { if (C.TL && C.TL.redraw) C.TL.redraw(); return new Promise(function (r) { setTimeout(r, 0); }).then(step); }
        return step();
      });
    }
    return step().then(function (why) { prov.dropAll(); if (comp.destroy) comp.destroy(); if (C.TL && C.TL.redraw) C.TL.redraw(); C.Engine.requestRender(); return { why: why, frames: done, bytes: RC.bytes }; },
      function (e) { prov.dropAll(); if (comp.destroy) comp.destroy(); throw e; });
  };
  RC.renderInOut = function () {
    var s = P.seq(); if (!s) return;
    var a = s.inF != null ? s.inF : 0, b = s.outF != null ? s.outF : P.seqDuration(s);
    if (b <= a) { C.toast('Set In and Out points (or clear them to render the whole sequence)'); return; }
    if (C.Engine.playing) C.Engine.pause();
    var cancel = { v: false }, prog = C.ui.progress('Rendering preview ' + U.fmtTC(a, s.fps) + ' → ' + U.fmtTC(b, s.fps), { cancel: function () { cancel.v = true; } });
    RC.render(s, a, b, { cancel: cancel, onProgress: function (p, t) { prog.update(p, t); } }).then(function (r) {
      prog.done();
      C.toast(r.why === 'full' ? 'Render cache full (' + U.fmtSize(RC.LIMIT) + ') — ' + r.frames + ' frames rendered' : r.why === 'cancelled' ? 'Render stopped after ' + r.frames + ' frames' : 'Rendered ' + r.frames + ' frames (' + U.fmtSize(r.bytes) + ')', 3500);
    }, function (e) { prog.done(); C.toast('Render failed: ' + (e && e.message || e)); });
  };
  // invalidate on edits (not live drags: those revert or commit) and on sequence switches / project changes
  C.bus.on('changed', function (info) { if (info && info.live) return; var s = P.seq(); if (RC.n && (!s || !RC.valid(s))) RC.clear(); });
  C.bus.on('project', function () { RC.clear(); });
  C.bus.on('prefs', function () { if (RC.n) { var sz = C.Engine.outputSize(), any = RC.frames[Object.keys(RC.frames)[0]]; if (any && (any.w !== sz[0] || any.h !== sz[1])) RC.clear(); } });

  C.CMD.reg('renderInOut', 'Render In to Out (preview cache)', 'Sequence', 'Ctrl+Alt+R', function () { RC.renderInOut(); });
  C.CMD.reg('renderClear', 'Clear Render Cache', 'Sequence', null, function () { RC.clear(); C.toast('Render cache cleared'); });
  var prev = C.Menus.extra.Sequence;
  function cmd(id) { return C.CMD.menuItem(id); }
  C.Menus.extra.Sequence = function () { return (prev ? prev() : []).concat([cmd('renderInOut'), cmd('renderClear')]); };
})();
