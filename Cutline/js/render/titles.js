/* Cutline — procedural renderers for titles, solids, gradients, bars, countdowns, captions. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util;
  var T = C.Titles = {};

  T.FONTS = ['Segoe UI', 'Segoe UI Variable Display', 'Bahnschrift', 'Arial', 'Arial Black', 'Calibri', 'Cambria', 'Candara', 'Consolas', 'Constantia',
    'Corbel', 'Courier New', 'Franklin Gothic Medium', 'Gabriola', 'Georgia', 'Impact', 'Lucida Console', 'Palatino Linotype', 'Segoe Print',
    'Segoe Script', 'Sitka Text', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Comic Sans MS', 'sans-serif', 'serif', 'monospace', 'cursive'];
  T.loadLocalFonts = function () {
    if (!window.queryLocalFonts) return Promise.resolve(false);
    return window.queryLocalFonts().then(function (fonts) {
      var fam = {}; fonts.forEach(function (f) { fam[f.family] = 1; });
      Object.keys(fam).sort().forEach(function (f) { if (T.FONTS.indexOf(f) < 0) T.FONTS.push(f); });
      return true;
    }).catch(function () { return false; });
  };

  T.ANIMS = [
    { id: 'none', name: 'None' }, { id: 'fade', name: 'Fade' }, { id: 'slideUp', name: 'Slide Up' }, { id: 'slideDown', name: 'Slide Down' },
    { id: 'slideLeft', name: 'Slide Left' }, { id: 'slideRight', name: 'Slide Right' }, { id: 'pop', name: 'Scale Pop' },
    { id: 'typewriter', name: 'Typewriter' }, { id: 'blur', name: 'Blur In' }, { id: 'words', name: 'Word Pop' },
    { id: 'chars', name: 'Character Rise (stagger)' }, { id: 'charsFade', name: 'Character Fade (stagger)' }, { id: 'wordsUp', name: 'Word Slide Up (stagger)' }, { id: 'wipe', name: 'Wipe Reveal' }
  ];
  // per-unit stagger: progress p (0..1) over n units with k units overlapping at once → progress of unit i
  T.staggerAt = function (p, i, n, k) { if (p >= 1) return 1; if (p <= 0) return 0; var span = n + k - 1; return U.clamp((p * span - i) / k, 0, 1); };

  T.newTextLayer = function (o) {
    return Object.assign({
      id: U.uid('L'), type: 'text', text: 'Text', font: 'Segoe UI', size: 110, weight: 700, italic: false, color: '#ffffff', align: 'center',
      tracking: 0, lh: 1.15, stroke: false, strokeColor: '#141210', strokeW: 6, shadow: true, shadowColor: '#000000', shadowBlur: 18, shadowX: 0, shadowY: 6, shadowOp: 0.55,
      box: false, boxColor: '#141210', boxPad: 24, boxRadius: 10, boxOp: 0.75, x: 50, y: 50, opacity: 100, rot: 0, scale: 100,
      anIn: 'none', anOut: 'none', anDur: 0.5
    }, o || {});
  };
  T.newShapeLayer = function (shape, o) {
    return Object.assign({ id: U.uid('L'), type: shape || 'rect', x: 50, y: 50, w: 600, h: 140, color: '#f0913a', radius: 0, opacity: 100, rot: 0, scale: 100,
      stroke: false, strokeColor: '#ffffff', strokeW: 4, grad: false, color2: '#3dbfae', gradAngle: 0, anIn: 'none', anOut: 'none', anDur: 0.5,
      pFrom: 0, pTo: 100, pTrack: true, pTrackOp: 0.3 }, o || {}); // pFrom/pTo/pTrack: 'progress' bars (fill grows over the clip's duration)
  };

  /* Original title presets */
  T.PRESETS = [
    { id: 'center', name: 'Centered Title', make: function () { return { kind: 'title', layers: [T.newTextLayer({ text: 'Centered Title', size: 130, anIn: 'pop', anOut: 'fade' }), T.newTextLayer({ text: 'a short subtitle line', size: 48, weight: 400, y: 61, shadow: false, color: '#f0c79a', tracking: 4, anIn: 'fade', anOut: 'fade' })] }; } },
    { id: 'lower', name: 'Lower Third', make: function () { return { kind: 'title', layers: [T.newShapeLayer('rect', { x: 26, y: 82, w: 760, h: 150, color: '#141210', opacity: 82, radius: 6, anIn: 'slideRight', anOut: 'slideLeft' }), T.newShapeLayer('rect', { x: 6.3, y: 82, w: 12, h: 150, color: '#f0913a', anIn: 'slideRight', anOut: 'slideLeft' }), T.newTextLayer({ text: 'Jordan Rivers', size: 62, align: 'left', x: 8.6, y: 79.6, shadow: false, anIn: 'slideRight', anOut: 'slideLeft' }), T.newTextLayer({ text: 'Field Producer', size: 36, weight: 400, align: 'left', x: 8.6, y: 85.6, color: '#3dbfae', shadow: false, anIn: 'slideRight', anOut: 'slideLeft' })] }; } },
    { id: 'subtitle', name: 'Subtitle', make: function () { return { kind: 'title', layers: [T.newTextLayer({ text: 'This is a subtitle line', size: 52, weight: 600, y: 88, box: true, boxOp: 0.6, shadow: false, anIn: 'fade', anOut: 'fade', anDur: 0.2 })] }; } },
    { id: 'credits', name: 'End Credits Roll', make: function () { return { kind: 'title', roll: { on: true }, layers: [T.newTextLayer({ text: 'THE END', size: 120, y: 50, anIn: 'none', anOut: 'none' }), T.newTextLayer({ text: 'Directed by\nAlex Morgan\n\nEdited by\nSam Lee\n\nMusic\nThe Kiln Ensemble\n\nMade with Cutline', size: 54, weight: 400, lh: 1.45, y: 110, shadow: false, anIn: 'none', anOut: 'none' })] }; } },
    { id: 'kinetic', name: 'Kinetic Word Pop', make: function () { return { kind: 'title', layers: [T.newTextLayer({ text: 'MAKE IT POP', size: 160, weight: 900, font: 'Arial Black', color: '#f0913a', stroke: true, strokeColor: '#141210', strokeW: 10, anIn: 'words', anOut: 'pop', anDur: 1.2 })] }; } },
    { id: 'chapter', name: 'Chapter Card', make: function () { return { kind: 'title', layers: [T.newShapeLayer('rect', { x: 50, y: 50, w: 4000, h: 4000, color: '#141210', opacity: 100, anIn: 'fade', anOut: 'fade' }), T.newTextLayer({ text: 'CHAPTER ONE', size: 40, weight: 600, y: 42, tracking: 14, color: '#3dbfae', shadow: false, anIn: 'fade', anOut: 'fade' }), T.newTextLayer({ text: 'The Beginning', size: 120, weight: 300, y: 52, shadow: false, anIn: 'blur', anOut: 'fade' }), T.newShapeLayer('rect', { x: 50, y: 61, w: 220, h: 4, color: '#f0913a', anIn: 'pop', anOut: 'fade' })] }; } },
    { id: 'lowerStagger', name: 'Name Strap — Rising Letters', make: function () { return { kind: 'title', layers: [
      T.newShapeLayer('rect', { x: 23, y: 80, w: 700, h: 6, color: '#f0913a', color2: '#3dbfae', grad: true, gradAngle: 0, anIn: 'wipe', anOut: 'wipe', anDur: 0.6 }),
      T.newTextLayer({ text: 'Alex Morgan', size: 78, weight: 800, align: 'left', x: 6, y: 74, shadow: false, anIn: 'chars', anOut: 'charsFade', anDur: 0.9 }),
      T.newTextLayer({ text: 'Director of Photography', size: 40, weight: 400, align: 'left', x: 6, y: 86, color: '#f0c79a', tracking: 2, shadow: false, anIn: 'wordsUp', anOut: 'fade', anDur: 0.8 })] }; } },
    { id: 'progress', name: 'Progress Bar', make: function () { return { kind: 'title', layers: [
      T.newShapeLayer('progress', { x: 50, y: 95, w: 1700, h: 14, radius: 7, color: '#f0913a', color2: '#ffd27a', grad: true, pTrack: true, pTrackOp: 0.25, anIn: 'fade', anOut: 'fade', anDur: 0.3 })] }; } },
    { id: 'chapterBar', name: 'Chapter Bar (counting)', make: function () { return { kind: 'title', layers: [
      T.newShapeLayer('rect', { x: 50, y: 92, w: 1920, h: 90, color: '#141210', opacity: 70, anIn: 'slideUp', anOut: 'slideDown', anDur: 0.4 }),
      T.newShapeLayer('progress', { x: 50, y: 96.6, w: 1920, h: 8, radius: 0, color: '#3dbfae', pTrack: false, anIn: 'fade', anOut: 'fade', anDur: 0.3 }),
      T.newTextLayer({ text: 'Part 2 — Setting Up', size: 44, weight: 600, align: 'left', x: 3, y: 91.5, shadow: false, anIn: 'wipe', anOut: 'fade', anDur: 0.6 })] }; } },
    { id: 'social', name: 'Social Handle', make: function () { return { kind: 'title', layers: [
      T.newShapeLayer('rect', { x: 86, y: 8, w: 420, h: 72, radius: 36, color: '#f0913a', color2: '#e5534b', grad: true, gradAngle: 20, anIn: 'pop', anOut: 'pop', anDur: 0.5 }),
      T.newTextLayer({ text: '@cutline.edits', size: 40, weight: 700, x: 86, y: 8, color: '#1c1208', shadow: false, anIn: 'charsFade', anOut: 'fade', anDur: 0.7 })] }; } },
    { id: 'callout', name: 'Callout Tag', make: function () { return { kind: 'title', layers: [T.newTextLayer({ text: 'NEW!', size: 64, weight: 800, x: 78, y: 18, box: true, boxColor: '#f0913a', boxOp: 1, color: '#141210', shadow: false, rot: -6, anIn: 'pop', anOut: 'pop' })] }; } }
  ];

  function easeOut(t) { return 1 - Math.pow(1 - U.clamp(t, 0, 1), 3); }
  function easeOutBack(t) { t = U.clamp(t, 0, 1); var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }

  // Animation state for a layer given local time and clip duration (seconds)
  function animState(L, t, dur) {
    var st = { op: 1, dx: 0, dy: 0, sc: 1, chars: 1, blur: 0, words: 1, stag: null, wipe: 1 };
    if (dur == null) return st;
    var ad = Math.max(0.05, Math.min(L.anDur || 0.5, dur / 2));
    var pin = U.clamp(t / ad, 0, 1), pout = U.clamp((dur - t) / ad, 0, 1);
    apply(L.anIn || 'none', pin, st, 1);
    apply(L.anOut || 'none', pout, st, -1);
    return st;
  }
  function apply(kind, p, st, dir) {
    if (p >= 1 || kind === 'none') return;
    var e = easeOut(p);
    switch (kind) {
      case 'fade': st.op *= e; break;
      case 'slideUp': st.dy += (1 - e) * 120 * dir; st.op *= e; break;
      case 'slideDown': st.dy -= (1 - e) * 120 * dir; st.op *= e; break;
      case 'slideLeft': st.dx += (1 - e) * 220 * dir; st.op *= e; break;
      case 'slideRight': st.dx -= (1 - e) * 220 * dir; st.op *= e; break;
      case 'pop': st.sc *= dir > 0 ? Math.max(0.01, easeOutBack(p)) : Math.max(0.01, e); st.op *= Math.min(1, p * 3); break;
      case 'typewriter': st.chars = Math.min(st.chars, p); break;
      case 'blur': st.blur = Math.max(st.blur, (1 - e) * 24); st.op *= Math.min(1, p * 1.5); break;
      case 'words': st.words = Math.min(st.words, p); break;
      case 'chars': case 'charsFade': case 'wordsUp': st.stag = { kind: kind, p: p, dir: dir }; break;
      case 'wipe': st.wipe = Math.min(st.wipe, p); st.wipeDir = dir; break;
    }
  }

  function roundRect(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  T.roundRect = roundRect;

  function fontStr(L, scale) { return (L.italic ? 'italic ' : '') + (L.weight || 400) + ' ' + Math.max(1, L.size * scale) + 'px "' + L.font + '", sans-serif'; }

  // Measure a text layer's bounding box in frame px (unanimated); used for on-canvas selection
  T.layerBounds = function (L, w, h, ref) {
    var s = w / (ref || 1920);
    if (L.type !== 'text') return { x: L.x / 100 * w - L.w * s / 2, y: L.y / 100 * h - L.h * s / 2, w: L.w * s, h: L.h * s };
    var g = T._mctx || (T._mctx = document.createElement('canvas').getContext('2d'));
    g.font = fontStr(L, s);
    if ('letterSpacing' in g) g.letterSpacing = (L.tracking || 0) * s + 'px';
    var lines = String(L.text).split('\n'), lh = L.size * s * (L.lh || 1.2), mw = 0;
    lines.forEach(function (ln) { mw = Math.max(mw, g.measureText(ln).width); });
    var th = lines.length * lh, cx = L.x / 100 * w, cy = L.y / 100 * h;
    var x0 = L.align === 'left' ? cx : L.align === 'right' ? cx - mw : cx - mw / 2;
    return { x: x0, y: cy - th / 2, w: mw, h: th };
  };

  function drawText(g, L, w, h, s, st) {
    var lines = String(L.text == null ? '' : L.text).split('\n');
    g.font = fontStr(L, s);
    if ('letterSpacing' in g) g.letterSpacing = (L.tracking || 0) * s + 'px';
    g.textBaseline = 'middle';
    var lh = L.size * s * (L.lh || 1.2);
    var widths = lines.map(function (ln) { return g.measureText(ln).width; });
    var mw = Math.max.apply(null, widths.concat([0]));
    var th = lines.length * lh;
    var top = -th / 2;
    var ax = L.align === 'left' ? 0 : L.align === 'right' ? -mw : -mw / 2;
    // typewriter / words
    var total = lines.join('').length, showChars = Math.round(total * st.chars);
    var allWords = lines.join(' ').split(/\s+/).filter(Boolean), nWords = allWords.length;
    var wordsShown = st.words * nWords;
    if (L.box) {
      var pad = (L.boxPad || 0) * s;
      g.save(); g.globalAlpha *= (L.boxOp == null ? 1 : L.boxOp); g.fillStyle = L.boxColor || '#000';
      roundRect(g, ax - pad, top - pad * 0.6, mw + pad * 2, th + pad * 1.2, (L.boxRadius || 0) * s); g.fill(); g.restore();
    }
    if (L.shadow) {
      g.shadowColor = U.rgba(L.shadowColor || '#000', L.shadowOp == null ? 0.6 : L.shadowOp);
      g.shadowBlur = (L.shadowBlur || 0) * s; g.shadowOffsetX = (L.shadowX || 0) * s; g.shadowOffsetY = (L.shadowY || 0) * s;
    }
    var used = 0, wordIdx = 0;
    if (st.wipe < 1) { // wipe reveal: clip the text box from the left (in) or towards the right (out)
      var ww = mw + 40 * s, wx = ax - 20 * s, wt = st.wipeDir < 0 ? 1 - easeOut(1 - st.wipe) : easeOut(st.wipe);
      g.beginPath(); if (st.wipeDir < 0) g.rect(wx + ww * (1 - wt), top - lh, ww * wt, th + lh * 2); else g.rect(wx, top - lh, ww * wt, th + lh * 2); g.clip();
    }
    if (st.stag) { // per-character / per-word stagger animation
      var units = [], nTot = 0;
      lines.forEach(function (ln, i) {
        var y = top + lh * (i + 0.5), lx = L.align === 'left' ? 0 : L.align === 'right' ? -widths[i] : -widths[i] / 2, x = lx;
        var parts = st.stag.kind === 'wordsUp' ? ln.split(/(\s+)/) : ln.split('');
        parts.forEach(function (pt) { var pw = g.measureText(pt).width; if (/\S/.test(pt)) units.push({ t: pt, x: x, y: y, w: pw }); x += pw; });
      });
      nTot = units.length; var k = st.stag.kind === 'wordsUp' ? 2 : Math.max(3, Math.round(nTot * 0.25));
      units.forEach(function (u, idx) {
        var i2 = st.stag.dir > 0 ? idx : nTot - 1 - idx, q = T.staggerAt(st.stag.p, i2, nTot, k); if (q <= 0) return;
        var e = easeOut(q), rise = st.stag.kind === 'charsFade' ? 0 : (1 - e) * (st.stag.kind === 'wordsUp' ? lh * 0.9 : L.size * s * 0.6) * st.stag.dir;
        g.save(); g.globalAlpha *= e; g.translate(0, rise);
        if (L.stroke && L.strokeW > 0) { g.lineWidth = L.strokeW * s; g.strokeStyle = L.strokeColor; g.lineJoin = 'round'; g.strokeText(u.t, u.x, u.y); g.shadowColor = 'transparent'; }
        g.fillStyle = L.color; g.fillText(u.t, u.x, u.y); g.restore();
      });
      g.shadowColor = 'transparent';
      return;
    }
    lines.forEach(function (ln, i) {
      var y = top + lh * (i + 0.5);
      var lx = L.align === 'left' ? 0 : L.align === 'right' ? -widths[i] : -widths[i] / 2;
      var text = ln;
      if (st.chars < 1) { var rem = showChars - used; text = rem <= 0 ? '' : ln.slice(0, rem); used += ln.length; }
      if (st.words < 1) {
        // draw word by word with pop
        var parts = ln.split(/(\s+)/), x = lx;
        parts.forEach(function (pt) {
          var pw = g.measureText(pt).width;
          if (/\S/.test(pt)) {
            var wp = U.clamp(wordsShown - wordIdx, 0, 1); wordIdx++;
            if (wp > 0) {
              g.save(); var sc = easeOutBack(wp); g.translate(x + pw / 2, y); g.scale(sc, sc); g.globalAlpha *= Math.min(1, wp * 2);
              if (L.stroke && L.strokeW > 0) { g.lineWidth = L.strokeW * s; g.strokeStyle = L.strokeColor; g.lineJoin = 'round'; g.strokeText(pt, -pw / 2, 0); g.shadowColor = 'transparent'; }
              g.fillStyle = L.color; g.fillText(pt, -pw / 2, 0); g.restore();
            }
          }
          x += pw;
        });
        return;
      }
      if (!text) return;
      if (L.stroke && L.strokeW > 0) {
        g.lineWidth = L.strokeW * s; g.strokeStyle = L.strokeColor || '#000'; g.lineJoin = 'round'; g.miterLimit = 2;
        g.strokeText(text, lx, y);
        g.save(); g.shadowColor = 'transparent'; g.fillStyle = L.color; g.fillText(text, lx, y); g.restore();
      } else { g.fillStyle = L.color; g.fillText(text, lx, y); }
    });
    g.shadowColor = 'transparent';
    void ax;
  }

  function shapeFill(g, L, w, h) {
    if (!L.grad) return L.color;
    var a = (L.gradAngle || 0) * Math.PI / 180, dx = Math.cos(a) * w / 2, dy = Math.sin(a) * h / 2;
    var gr = g.createLinearGradient(-dx, -dy, dx, dy); gr.addColorStop(0, L.color); gr.addColorStop(1, L.color2 || '#3dbfae'); return gr;
  }
  function drawShape(g, L, s, gv, prog) {
    var w = (gv ? gv('w') : L.w) * s, h = (gv ? gv('h') : L.h) * s, rad = ((gv ? gv('radius') : L.radius) || 0) * s;
    if (L.type === 'progress') { // bar that fills from pFrom% to pTo% over the clip (track behind it)
      var p = U.clamp((L.pFrom || 0) / 100 + ((L.pTo == null ? 100 : L.pTo) - (L.pFrom || 0)) / 100 * (prog == null ? 1 : prog), 0, 1);
      if (L.pTrack !== false) { g.save(); g.globalAlpha *= (L.pTrackOp == null ? 0.3 : L.pTrackOp); g.fillStyle = L.color2 && !L.grad ? L.color2 : '#ffffff'; roundRect(g, -w / 2, -h / 2, w, h, rad); g.fill(); g.restore(); }
      if (p > 0) { g.save(); g.beginPath(); g.rect(-w / 2 - 1, -h / 2 - 1, w * p + 1, h + 2); g.clip(); g.fillStyle = shapeFill(g, L, w, h); roundRect(g, -w / 2, -h / 2, w, h, rad); g.fill(); g.restore(); }
      if (L.stroke && L.strokeW > 0) { roundRect(g, -w / 2, -h / 2, w, h, rad); g.lineWidth = L.strokeW * s; g.strokeStyle = L.strokeColor; g.stroke(); }
      return;
    }
    g.fillStyle = shapeFill(g, L, w, h);
    if (L.type === 'ellipse') { g.beginPath(); g.ellipse(0, 0, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2); }
    else roundRect(g, -w / 2, -h / 2, w, h, rad);
    g.fill();
    if (L.stroke && L.strokeW > 0) { g.lineWidth = L.strokeW * s; g.strokeStyle = L.strokeColor; g.stroke(); }
  }

  // values may come from keyframes: getter(layer, key) -> number
  T.drawTitle = function (g, gen, w, h, t, dur, getter) {
    var s = w / 1920 * (h / w > 1 ? 1 : 1);
    if (h > w) s = w / 1080; // vertical formats: design relative to width
    var layers = gen.layers || [];
    var rollY = 0;
    if (gen.roll && gen.roll.on && dur) {
      // content extent
      var minY = Infinity, maxY = -Infinity;
      layers.forEach(function (L) { var b = T.layerBounds(L, w, h, h > w ? 1080 : 1920); minY = Math.min(minY, b.y); maxY = Math.max(maxY, b.y + b.h); });
      if (!isFinite(minY)) { minY = 0; maxY = h; }
      var startOff = h - minY + 10, endOff = -maxY - 10;
      rollY = U.lerp(startOff, endOff, U.clamp(t / dur, 0, 1));
    }
    if (gen.bg && gen.bgOn) { g.fillStyle = gen.bg; g.fillRect(0, 0, w, h); }
    layers.forEach(function (L) {
      if (L.hidden) return;
      var gv = function (k) { return getter ? getter(L, k) : L[k]; };
      var st = animState(L, t, dur);
      var op = (gv('opacity') == null ? 100 : gv('opacity')) / 100 * st.op;
      if (op <= 0.001) return;
      g.save();
      g.globalAlpha = op;
      if (st.blur > 0.3 && 'filter' in g) g.filter = 'blur(' + (st.blur * s).toFixed(1) + 'px)';
      g.translate(gv('x') / 100 * w + st.dx * s, gv('y') / 100 * h + st.dy * s + rollY);
      if (L.rot) g.rotate(gv('rot') * Math.PI / 180);
      var sc = (gv('scale') == null ? 100 : gv('scale')) / 100 * st.sc;
      if (sc !== 1) g.scale(sc, sc);
      if (L.type === 'text') { var L2 = Object.assign({}, L, { size: gv('size') }); drawText(g, L2, w, h, s, st); }
      else drawShape(g, L, s, gv, dur ? U.clamp(t / dur, 0, 1) : 1);
      g.restore();
    });
  };

  function drawBars(g, w, h) {
    var cols = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
    var bw = w / 7, top = h * 0.66;
    cols.forEach(function (c, i) { g.fillStyle = c; g.fillRect(Math.floor(i * bw), 0, Math.ceil(bw) + 1, top); });
    var mid = h * 0.08;
    var rev = ['#0000c0', '#131313', '#c000c0', '#131313', '#00c0c0', '#131313', '#c0c0c0'];
    rev.forEach(function (c, i) { g.fillStyle = c; g.fillRect(Math.floor(i * bw), top, Math.ceil(bw) + 1, mid); });
    var y2 = top + mid;
    var grd = g.createLinearGradient(0, 0, w, 0); grd.addColorStop(0, '#000'); grd.addColorStop(1, '#fff');
    g.fillStyle = grd; g.fillRect(0, y2, w * 0.62, h - y2);
    var pl = ['#090909', '#131313', '#1d1d1d'];
    pl.forEach(function (c, i) { g.fillStyle = c; g.fillRect(w * 0.62 + i * w * 0.05, y2, w * 0.05 + 1, h - y2); });
    g.fillStyle = '#131313'; g.fillRect(w * 0.77, y2, w * 0.23, h - y2);
    g.fillStyle = '#f0913a'; g.font = '700 ' + Math.round(h * 0.045) + 'px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('CUTLINE  ·  1 kHz', w * 0.885, y2 + (h - y2) / 2);
  }
  function drawCountdown(g, gen, w, h, t) {
    var from = gen.from || 8;
    g.fillStyle = gen.c1 || '#24201c'; g.fillRect(0, 0, w, h);
    var cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.36;
    if (t >= from) { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); return; }
    var sec = Math.floor(t), frac = t - sec, num = from - sec;
    // sweep
    g.save(); g.globalAlpha = 0.5; g.fillStyle = gen.c2 || '#f0913a';
    g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R * 1.6, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); g.closePath(); g.fill(); g.restore();
    g.strokeStyle = gen.c3 || '#f2ebe3'; g.lineWidth = Math.max(2, h * 0.006);
    g.beginPath(); g.moveTo(0, cy); g.lineTo(w, cy); g.moveTo(cx, 0); g.lineTo(cx, h); g.stroke();
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(cx, cy, R * 0.82, 0, Math.PI * 2); g.stroke();
    g.fillStyle = gen.c3 || '#f2ebe3'; g.font = '700 ' + Math.round(R * 1.15) + 'px "Segoe UI", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(num), cx, cy + R * 0.05);
  }
  function drawGradient(g, gen, w, h) {
    var grd;
    if (gen.mode === 'radial') grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2);
    else {
      var a = (gen.angle || 0) * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), L = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
      grd = g.createLinearGradient(w / 2 - dx * L, h / 2 - dy * L, w / 2 + dx * L, h / 2 + dy * L);
    }
    grd.addColorStop(0, gen.c1); grd.addColorStop(1, gen.c2);
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }

  // Render a generated item to a canvas. Returns canvas (or null for adjustment).
  var pool = {};
  // timecode burn-in: sequence timecode (and optional label / source clip name) in a box
  T.TC_POS = [['bl', 'Bottom left'], ['bc', 'Bottom centre'], ['br', 'Bottom right'], ['tl', 'Top left'], ['tc', 'Top centre'], ['tr', 'Top right']];
  function drawTcBurn(g, gen, w, h, o) {
    var s = w / 1920, size = (gen.size || 44) * s, fps = o && o.fps || 30, f = o && o.frame != null ? o.frame : 0;
    var txt = (gen.label ? gen.label + '  ' : '') + U.fmtTC(Math.max(0, f + (gen.offset || 0)), fps) + (gen.frames ? '  #' + f : '');
    g.font = '600 ' + size + 'px "' + (gen.font || 'Consolas') + '", monospace'; g.textBaseline = 'middle';
    var tw = g.measureText(txt).width, pad = size * 0.45, bw = tw + pad * 2, bh = size * 1.5, m = (gen.margin == null ? 40 : gen.margin) * s;
    var pos = gen.pos || 'bl', x = /l$/.test(pos) ? m : /r$/.test(pos) ? w - m - bw : (w - bw) / 2, y = /^t/.test(pos) ? m : h - m - bh;
    g.globalAlpha = (gen.bgOp == null ? 0.7 : gen.bgOp); g.fillStyle = gen.bg || '#000000'; roundRect(g, x, y, bw, bh, size * 0.15); g.fill();
    g.globalAlpha = 1; g.fillStyle = gen.color || '#ffffff'; g.textAlign = 'left'; g.fillText(txt, x + pad, y + bh / 2);
  }
  T.drawTcBurn = drawTcBurn;
  T.renderGen = function (gen, clip, t, w, h, dur, key, getter, opts) {
    if (!gen || gen.kind === 'adjust') return null;
    w = Math.max(2, Math.round(w)); h = Math.max(2, Math.round(h));
    var c;
    if (key) { c = pool[key]; if (!c) c = pool[key] = document.createElement('canvas'); }
    else c = document.createElement('canvas');
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    var g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.globalAlpha = 1; g.filter = 'none';
    switch (gen.kind) {
      case 'solid': g.fillStyle = gen.color; g.fillRect(0, 0, w, h); break;
      case 'gradient': drawGradient(g, gen, w, h); break;
      case 'bars': drawBars(g, w, h); break;
      case 'countdown': drawCountdown(g, gen, w, h, t || 0); break;
      case 'title': T.drawTitle(g, gen, w, h, t || 0, dur, getter); break;
      case 'tcburn': drawTcBurn(g, gen, w, h, opts); break;
      case 'spectrum': if (C.Spectrum) C.Spectrum.draw(g, gen, w, h, opts); break;
    }
    return c;
  };
  T.releaseKey = function (key) { delete pool[key]; };
  T.isAnimated = function (gen, clip) {
    if (!gen) return false;
    if (gen.kind === 'countdown' || gen.kind === 'tcburn' || gen.kind === 'spectrum') return true;
    if (gen.kind !== 'title') return false;
    if (gen.roll && gen.roll.on) return true;
    if (clip && clip.kf) for (var p in clip.kf) if (p.indexOf('tt.') === 0) return true;
    return (gen.layers || []).some(function (L) { return (L.anIn && L.anIn !== 'none') || (L.anOut && L.anOut !== 'none') || L.type === 'progress'; });
  };

  /* ---------- Title templates (reusable titles with exposed text fields; kept in localStorage) ---------- */
  T.templates = function () { return U.lsGet('titleTemplates', []); };
  T.saveTemplate = function (name, gen) {
    var list = T.templates(), fields = (gen.layers || []).filter(function (L) { return L.type === 'text' && !L.hidden; }).map(function (L) { return { id: L.id, label: (L.text || '').split('\n')[0].slice(0, 32) || 'Text' }; });
    var rec = { id: U.uid('tt'), name: name, gen: U.clone(gen), fields: fields, saved: Date.now() };
    list = list.filter(function (t) { return t.name !== name; }); list.push(rec); U.lsSet('titleTemplates', list);
    return rec;
  };
  T.deleteTemplate = function (id) { U.lsSet('titleTemplates', T.templates().filter(function (t) { return t.id !== id; })); };
  // a fresh gen from a template with the exposed fields filled: values = { layerId: text }
  T.fromTemplate = function (tpl, values) {
    var gen = U.clone(tpl.gen), map = {};
    gen.layers.forEach(function (L) { var nid = U.uid('L'); map[L.id] = nid; if (values && values[L.id] != null) L.text = values[L.id]; L.id = nid; });
    return gen;
  };

  /* ---------- Captions ---------- */
  T.captionAt = function (seq, frame) {
    var cs = seq.captions;
    for (var i = 0; i < cs.length; i++) if (frame >= cs[i].start && frame < cs[i].end) return cs[i];
    return null;
  };
  T.CAP_PRESETS = [
    { id: 'clean', name: 'Clean (shadowed white)', st: { font: 'Segoe UI', size: 46, color: '#ffffff', bg: '#000000', bgOp: 0, pos: 0.9, weight: 600, outline: 4 } },
    { id: 'boxed', name: 'Boxed (dark panel)', st: { font: 'Segoe UI', size: 46, color: '#ffffff', bg: '#000000', bgOp: 0.6, pos: 0.9, weight: 600, outline: 0 } },
    { id: 'bold', name: 'Bold outline (social)', st: { font: 'Arial Black', size: 60, color: '#ffffff', bg: '#000000', bgOp: 0, pos: 0.5, weight: 900, outline: 10 } },
    { id: 'yellow', name: 'Yellow subtitle', st: { font: 'Arial', size: 44, color: '#ffe55c', bg: '#000000', bgOp: 0, pos: 0.92, weight: 600, outline: 5 } },
    { id: 'accent', name: 'Accent panel', st: { font: 'Bahnschrift', size: 48, color: '#1c1208', bg: '#f0913a', bgOp: 0.95, pos: 0.88, weight: 700, outline: 0 } },
    { id: 'top', name: 'Upper third', st: { font: 'Segoe UI', size: 42, color: '#ffffff', bg: '#141210', bgOp: 0.7, pos: 0.12, weight: 600, outline: 0 } }
  ];
  T.CAP_POS = [['', 'Default (style)'], ['0.12', 'Top'], ['0.5', 'Middle'], ['0.78', 'Lower'], ['0.9', 'Bottom']];
  T.drawCaption = function (g, seq, cap, w, h) {
    var st = seq.capStyle, s = Math.min(w, h * 16 / 9) / 1920;
    if (cap.pos != null && cap.pos !== '') st = Object.assign({}, st, { pos: +cap.pos }); // per-caption position override
    var size = st.size * s;
    g.save();
    g.font = (st.weight || 600) + ' ' + size + 'px "' + st.font + '", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    var lines = String(cap.text).split('\n'), lh = size * 1.25;
    var mw = Math.max.apply(null, lines.map(function (l) { return g.measureText(l).width; }).concat([0]));
    var cy = h * st.pos - (lines.length - 1) * lh / 2;
    if (st.bgOp > 0) {
      g.fillStyle = U.rgba(st.bg, st.bgOp);
      roundRect(g, w / 2 - mw / 2 - size * 0.45, cy - lh / 2 - size * 0.15, mw + size * 0.9, lh * lines.length + size * 0.3, size * 0.2); g.fill();
    }
    lines.forEach(function (ln, i) {
      if (st.outline > 0) { g.lineWidth = st.outline * s; g.strokeStyle = '#000'; g.lineJoin = 'round'; g.strokeText(ln, w / 2, cy + i * lh); }
      g.fillStyle = st.color; g.fillText(ln, w / 2, cy + i * lh);
    });
    g.restore();
  };

  /* ---------- SRT ---------- */
  function srtTime(sec) {
    var ms = Math.round(sec * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, r = ms % 1000;
    var p = function (n, l) { n = String(n); while (n.length < l) n = '0' + n; return n; };
    return p(h, 2) + ':' + p(m, 2) + ':' + p(s, 2) + ',' + p(r, 3);
  }
  T.toSRT = function (seq) {
    return seq.captions.slice().sort(function (a, b) { return a.start - b.start; }).map(function (c, i) {
      return (i + 1) + '\n' + srtTime(c.start / seq.fps) + ' --> ' + srtTime(c.end / seq.fps) + '\n' + c.text + '\n';
    }).join('\n');
  };
  T.parseSRT = function (text, fps) {
    var out = [];
    text = text.replace(/\r/g, '').replace(/^﻿/, '');
    var blocks = text.split(/\n\s*\n/);
    var tre = /(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/;
    blocks.forEach(function (b) {
      var lines = b.split('\n').filter(function (l) { return l.trim() !== ''; });
      for (var i = 0; i < lines.length; i++) {
        var m = tre.exec(lines[i]);
        if (m) {
          var s = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000, e = (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8]) / 1000;
          var txt = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '');
          out.push({ id: U.uid('cap'), start: Math.round(s * fps), end: Math.max(Math.round(s * fps) + 1, Math.round(e * fps)), text: txt });
          break;
        }
      }
    });
    return out;
  };
})();
