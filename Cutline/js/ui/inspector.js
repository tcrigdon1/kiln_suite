/* Cutline — Inspector: clip transform/speed/audio, keyframes, effect stack, title editor, transition settings. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, h = U.h, P = C.P, KF = C.KF, A = C.A;
  var I = C.Inspector = { bound: [], sig: null, selLayer: null };

  I.init = function (pane) {
    I.pane = pane;
    I.scroll = h('div.insp-scroll');
    pane.appendChild(I.scroll);
    var refresh = U.raf(function () { I.refresh(); });
    C.bus.on('selection', function () { I.sig = null; refresh(); });
    C.bus.on('changed', refresh);
    C.bus.on('playhead', U.throttle(function () { I.updateValues(); }, 50));
    C.bus.on('inspector:refresh', function () { I.updateValues(); });
    C.bus.on('titlelayer', function (id) { I.selLayer = id; I.sig = null; refresh(); });
    I.refresh();
  };
  I.clip = function () { var s = P.seq(); return s && I.clipId ? P.clip(s, I.clipId) : null; };
  I.lf = function () { var c = I.clip(); if (!c) return 0; return U.clamp(C.Engine.frame - c.start, 0, c.dur - 1); };

  function signature() {
    var s = P.seq(); if (!s) return 'none';
    if (C.state.selTransition) { var tr = P.findTransition(s, C.state.selTransition); return tr ? 'tr:' + tr.id + ':' + tr.type : 'none'; }
    var sel = P.selectedClips();
    if (!sel.length) return 'none';
    var c = P.primaryClip();
    var parts = ['c', c.id, sel.length, c.kind, (c.fx || []).map(function (f) { return f.id + (f.on ? 1 : 0); }).join(','), Object.keys(c.kf || {}).sort().join(','), c.tf ? c.tf.uni : '', c.freeze, c.reverse, c.link, C.T.hasRamp(c) ? 'ramp' : '',
      (c.masks || []).map(function (m) { return m.id + m.type + (m.fx || '') + (m.inv ? 1 : 0) + (m.smooth ? 's' : '') + (m.pts ? m.pts.length : 0) + (C.Masks.pointsAnimated(c, m.id) ? 'a' : ''); }).join(','), I.selMask, c.note ? 1 : 0];
    // the effective layer selection (not the raw I.selLayer): a fresh title picks its first text layer while building, and the
    // signature must not change because of that, or the panel is rebuilt on the first keystroke and the text box loses focus
    if (c.gen) parts.push(c.gen.kind, (c.gen.layers || []).map(function (l) { return l.id + l.type + (l.stroke ? 1 : 0) + (l.shadow ? 1 : 0) + (l.box ? 1 : 0); }).join(','), c.gen.kind === 'title' ? effLayer(c) : '', c.gen.roll && c.gen.roll.on, c.gen.mode);
    (c.fx || []).forEach(function (f) { var d = C.FX.byId[f.type]; if (d) d.params.forEach(function (q) { if (q.type === 'select' || q.type === 'bool') parts.push(f.p[q.k]); }); });
    return parts.join('|');
  }
  function effLayer(c) {
    var g = c.gen; if (!g || !g.layers) return null;
    if (I.selLayer && g.layers.some(function (l) { return l.id === I.selLayer; })) return I.selLayer;
    var tl0 = g.layers.filter(function (l) { return l.type === 'text'; })[0] || g.layers[0];
    return tl0 ? tl0.id : null;
  }
  I.refresh = function () {
    var sig = signature();
    if (sig === I.sig) { I.updateValues(); return; }
    I.sig = sig;
    var st = I.scroll.scrollTop;
    U.clear(I.scroll); I.bound = [];
    var s = P.seq();
    if (!s) return;
    if (C.state.selTransition) { var tr = P.findTransition(s, C.state.selTransition); if (tr) { buildTransition(s, tr); I.scroll.scrollTop = st; return; } }
    var sel = P.selectedClips();
    if (!sel.length) {
      I.clipId = null;
      I.scroll.appendChild(h('div.insp-empty', { html: C.icon('sliders') }, h('div', 'Select a clip in the timeline to edit its properties.'), h('div', { style: { marginTop: '10px', fontSize: '11px' } }, 'Tip: drag effects from the Effects tab onto clips, or use the Color tab to grade.')));
      return;
    }
    var c = P.primaryClip();
    I.clipId = c.id;
    buildHeader(s, c, sel);
    if (c.kind === 'video') {
      var m = P.media(c.mediaId);
      if (c.gen && c.gen.kind === 'title') buildTitle(s, c);
      else if (c.gen) buildGen(s, c);
      if (!(c.gen && c.gen.kind === 'adjust')) buildTransform(s, c);
      else buildOpacityOnly(s, c);
      if (m && m.type === 'video') buildSpeed(s, c);
      buildEffects(s, c, 'video');
      buildMasks(s, c);
    } else {
      buildAudio(s, c);
      buildSpeed(s, c);
      buildEffects(s, c, 'audio');
    }
    (I.extra || []).forEach(function (fn) { try { fn(s, c, sel); } catch (e) { console.warn('[Cutline] inspector section failed', e); } });
    I.scroll.scrollTop = st;
    I.updateValues();
  };
  I.extra = []; // other modules append section builders: function (seq, clip, selection)
  I.updateValues = function () {
    var c = I.clip(); if (!c) return;
    var lf = I.lf();
    I.bound.forEach(function (b) { try { b(c, lf); } catch (e) { } });
  };

  function curOr(fn) { return function () { var c = I.clip(); if (c) return fn(c); }; }

  /* ---------- keyframeable numeric field ---------- */
  function kfField(path, o) {
    var X = o.ctx || I;
    var stop = h('button.kf-btn', { title: 'Toggle animation (keyframes)', html: C.icon('stopwatch') });
    var nav = h('span.kf-nav');
    var prev = h('button.kf-btn', { title: 'Previous keyframe', html: C.icon('kfprev') });
    var add = h('button.kf-btn', { title: 'Add / remove keyframe at playhead', html: C.icon('keyframe') });
    var next = h('button.kf-btn', { title: 'Next keyframe', html: C.icon('kfnext') });
    var graphBtn = h('button.kf-btn.kf-graph-btn', { title: 'Graph editor (value curve, easing handles)', html: C.icon('graph') });
    nav.appendChild(prev); nav.appendChild(add); nav.appendChild(next); if (C.GraphEditor && !o.noGraph) nav.appendChild(graphBtn);
    var graph = null, graphOpen = !!(C.state.graphOpen && C.state.graphOpen[path]);
    var row = C.ui.numField({
      label: o.label, min: o.min, max: o.max, step: o.step, unit: o.unit, def: o.def, slider: o.slider, softMin: o.softMin, softMax: o.softMax, dragStep: o.dragStep,
      value: 0, kf: o.noKf ? h('span') : stop, extra: o.noKf ? null : nav,
      onInput: function (v) { var c = X.clip(); if (!c) return; if (o.set) o.set(c, v); else KF.setAt(c, path, X.lf(), v); C.live(); updLane(); },
      onCommit: function () { C.commit('Change ' + o.label); }
    });
    row.classList.add('with-kf');
    var lane = h('div.kf-lane');
    var wrap = h('div', row, lane);
    function syncGraph(c, keys) {
      graphBtn.classList.toggle('on', graphOpen);
      if (graphOpen && keys && !graph) { graph = C.GraphEditor.build(path, o, X.clip, X.lf); wrap.appendChild(graph.el); }
      if (graph) { graph.el.style.display = graphOpen && keys ? '' : 'none'; if (graphOpen && keys) graph.draw(); }
    }
    graphBtn.addEventListener('click', function () { graphOpen = !graphOpen; C.state.graphOpen = C.state.graphOpen || {}; C.state.graphOpen[path] = graphOpen; updLane(); });
    function updLane() {
      var c = X.clip(); if (!c) return;
      var keys = KF.keys(c, path);
      stop.classList.toggle('on', !!keys);
      nav.style.visibility = keys ? 'visible' : 'hidden';
      lane.style.display = keys && C.prefs.showKeyframes !== false ? '' : 'none';
      syncGraph(c, keys);
      add.classList.toggle('has', !!KF.keyAt(c, path, X.lf()));
      if (!keys) return;
      U.clear(lane);
      var w = lane.clientWidth || 200;
      keys.forEach(function (k) {
        // keys trimmed outside the clip stay (the trim can be undone / extended back): pin them to the lane edge, dimmed
        var out = k.f < 0 || k.f >= c.dur;
        var d = h('div.dia' + (k.e === 'hold' ? '.hold' : '') + (out ? '.out' : ''), { title: 'Frame ' + k.f + (out ? ' (outside the trimmed clip)' : '') + ' · ' + (Math.round(k.v * 100) / 100) + ' · ' + k.e + ' (right-click for easing)' });
        d.style.left = (U.clamp((k.f + 0.5) / c.dur, 0, 1) * 100) + '%';
        d.addEventListener('pointerdown', function (e) {
          e.stopPropagation(); e.preventDefault();
          if (e.button !== 0) return;
          var f0 = k.f, moved = false, cid = c.id, span0 = isRamp ? C.T.srcSpan(P.seq(), c, c.dur) : 0, dur0 = c.dur;
          C.Engine.seek(c.start + f0);
          U.drag(e, function (dx) {
            var cc = P.clip(P.seq(), cid); if (!cc) return;
            var ks = KF.keys(cc, path); if (!ks) return;
            var kk = ks.filter(function (x) { return x.f === (moved ? kk0 : f0); })[0];
            var nf = U.clamp(Math.round(f0 + dx / w * dur0), 0, dur0 - 1);
            if (!kk || ks.some(function (x) { return x !== kk && x.f === nf; })) return;
            kk.f = nf; kk0 = nf; moved = true; KF.sort(ks);
            if (isRamp) C.T.fitRampDur(P.seq(), cc, span0);
            C.live(); C.Engine.seek(cc.start + nf); updLane();
          }, function () { if (moved) C.commit('Move Keyframe'); });
          var kk0 = f0;
        });
        d.addEventListener('contextmenu', function (e) {
          e.preventDefault(); e.stopPropagation();
          var items = KF.EASINGS.map(function (es) {
            return { label: es.name, checked: (k.e || 'linear') === es.id, action: function () { C.edit('Keyframe Easing', function (s2) { var cc = P.clip(s2, c.id); var kk = (KF.keys(cc, path) || []).filter(function (x) { return x.f === k.f; })[0]; if (kk) { kk.e = es.id; if (es.id === 'bezier' && !kk.bz) kk.bz = KF.BEZIER_DEFAULT.slice(); } }); if (es.id === 'bezier' && !graphOpen) { graphOpen = true; C.state.graphOpen = C.state.graphOpen || {}; C.state.graphOpen[path] = true; updLane(); }; } };
          });
          items.push('-', { label: 'Delete Keyframe', action: function () { C.edit('Delete Keyframe', function (s2) { KF.removeKeyAt(P.clip(s2, c.id), path, k.f); }); } });
          C.ui.menu(items, e.clientX, e.clientY);
        });
        lane.appendChild(d);
      });
      var phx = h('div.ph'); phx.style.left = ((X.lf() + 0.5) / c.dur * 100) + '%'; lane.appendChild(phx);
    }
    lane.addEventListener('pointerdown', function (e) {
      if (e.target !== lane) return;
      var c = X.clip(); if (!c) return;
      var r = lane.getBoundingClientRect();
      C.Engine.seek(c.start + Math.round(U.clamp((e.clientX - r.left) / r.width, 0, 1) * (c.dur - 1)));
    });
    var isRamp = path === 'tm.speed';
    stop.addEventListener('click', function () {
      var c = X.clip(); if (!c) return;
      if (isRamp) { C.edit(KF.has(c, path) ? 'Remove Speed Ramp' : 'Speed Ramp', function (s2) { var cc = P.clip(s2, c.id); if (C.T.hasRamp(cc)) C.T.clearRamp(s2, cc); else C.T.setRampKey(s2, cc, X.lf(), Math.round(cc.speed * 10000) / 100); }); return; }
      C.edit(KF.has(c, path) ? 'Stop Animating' : 'Animate ' + o.label, function (s2) { KF.toggle(P.clip(s2, c.id), path, X.lf()); });
    });
    add.addEventListener('click', function () {
      var c = X.clip(); if (!c) return;
      C.edit('Keyframe', function (s2) {
        var cc = P.clip(s2, c.id), lf = X.lf(), span = isRamp ? C.T.srcSpan(s2, cc, cc.dur) : 0;
        if (KF.keyAt(cc, path, lf)) KF.removeKeyAt(cc, path, lf); else KF.addKey(cc, path, lf);
        if (isRamp) { if (!C.T.hasRamp(cc)) C.T.clearRamp(s2, cc); else C.T.fitRampDur(s2, cc, span); }
      });
    });
    prev.addEventListener('click', function () { var c = X.clip(); var f = c && KF.neighbor(c, path, X.lf(), -1); if (f != null) C.Engine.seek(c.start + f); });
    next.addEventListener('click', function () { var c = X.clip(); var f = c && KF.neighbor(c, path, X.lf(), 1); if (f != null) C.Engine.seek(c.start + f); });
    X.bound.push(function (c, lf) { var v = o.get ? o.get(c, lf) : KF.value(c, path, lf); if (v != null) row.set(v); updLane(); });
    setTimeout(updLane, 0);
    return wrap;
  }
  I.kfField = kfField;

  /* ---------- header ---------- */
  function buildHeader(s, c, sel) {
    var m = P.media(c.mediaId);
    var col = c.kind === 'audio' ? 'var(--clip-audio)' : m && m.type === 'gen' ? 'var(--clip-gen)' : 'var(--clip-video)';
    var nm = h('div.nm', { title: 'Double-click to rename' }, c.name);
    nm.addEventListener('dblclick', function () { C.ui.prompt('Clip name', c.name).then(function (v) { if (v) C.edit('Rename Clip', function (s2) { P.clip(s2, c.id).name = v; }); }); });
    var head = h('div.insp-title', h('div.sw', { style: { background: c.label || col } }),
      h('div', { style: { flex: 1, minWidth: 0 } }, nm, h('div.meta', U.fmtTC(c.start, s.fps) + ' → ' + U.fmtTC(c.start + c.dur, s.fps) + '  ·  ' + U.fmtTC(c.dur, s.fps, { short: true }))),
      sel.length > 1 ? h('span.muted', '+' + (sel.length - 1)) : null,
      C.ui.iconBtn(c.enabled === false ? 'eyeoff' : 'eye', c.enabled === false ? 'Enable clip' : 'Disable clip', function () { A.toggleEnable(); }, { cls: 'sm', tipPos: 'bottom' }));
    I.scroll.appendChild(head);
  }

  /* ---------- transform ---------- */
  function buildTransform(s, c) {
    var sec = C.ui.section('Transform', { key: 'tf', tools: h('span.sec-tools', C.ui.iconBtn('undo', 'Reset transform', function () { A.resetTransform(); }, { cls: 'sm', tipPos: 'bottom' })) });
    var b = sec.body;
    b.appendChild(kfField('tf.x', { label: 'Position X', min: -s.w, max: s.w * 2, step: 0.1, def: s.w / 2, slider: false, dragStep: 1 }));
    b.appendChild(kfField('tf.y', { label: 'Position Y', min: -s.h, max: s.h * 2, step: 0.1, def: s.h / 2, slider: false, dragStep: 1 }));
    if (c.tf.uni) b.appendChild(kfField('tf.scale', { label: 'Scale', min: 0, max: 400, step: 0.1, def: 100, unit: '%' }));
    else { b.appendChild(kfField('tf.sw', { label: 'Scale Width', min: 0, max: 400, step: 0.1, def: 100, unit: '%' })); b.appendChild(kfField('tf.sh', { label: 'Scale Height', min: 0, max: 400, step: 0.1, def: 100, unit: '%' })); }
    b.appendChild(h('div.row', { style: { margin: '2px 0 6px 24px', gap: '14px' } },
      C.ui.checkField('Uniform scale', c.tf.uni, function (v) { C.edit('Uniform Scale', function (s2) { var cc = P.clip(s2, c.id); if (!v) { cc.tf.sw = cc.tf.scale; cc.tf.sh = cc.tf.scale; } else cc.tf.scale = cc.tf.sw; cc.tf.uni = v; }); }),
      C.ui.checkField('Scale to frame', c.fit, function (v) { C.edit('Scale to Frame', function (s2) { P.clip(s2, c.id).fit = v; }); })));
    b.appendChild(kfField('tf.rot', { label: 'Rotation', min: -360, max: 360, step: 0.1, def: 0, unit: '°', slider: true }));
    b.appendChild(kfField('tf.ax', { label: 'Anchor X', min: -100, max: 200, step: 0.1, def: 50, unit: '%', slider: false }));
    b.appendChild(kfField('tf.ay', { label: 'Anchor Y', min: -100, max: 200, step: 0.1, def: 50, unit: '%', slider: false }));
    b.appendChild(kfField('tf.op', { label: 'Opacity', min: 0, max: 100, step: 0.1, def: 100, unit: '%' }));
    var blend = C.ui.selectField('Blend Mode', C.Scene.BLENDS, c.blend || 'normal', function (v) { C.edit('Blend Mode', function (s2) { P.clip(s2, c.id).blend = v; }); });
    b.appendChild(blend);
    var flips = h('div.field.cl-field.wide', h('label', 'Flip'), h('div.seg',
      segBtn('Horizontal', c.tf.fh, function () { C.edit('Flip Horizontal', function (s2) { var cc = P.clip(s2, c.id); cc.tf.fh = !cc.tf.fh; }); }),
      segBtn('Vertical', c.tf.fv, function () { C.edit('Flip Vertical', function (s2) { var cc = P.clip(s2, c.id); cc.tf.fv = !cc.tf.fv; }); })));
    b.appendChild(flips);
    I.scroll.appendChild(sec);
    var crop = C.ui.section('Crop', { key: 'crop' });
    [['cl', 'Left'], ['cr', 'Right'], ['ct', 'Top'], ['cb', 'Bottom']].forEach(function (k) { crop.body.appendChild(kfField('tf.' + k[0], { label: k[1], min: 0, max: 100, step: 0.1, def: 0, unit: '%' })); });
    I.scroll.appendChild(crop);
  }
  function buildOpacityOnly(s, c) {
    var sec = C.ui.section('Adjustment', { key: 'adj' });
    sec.body.appendChild(h('div.muted', { style: { fontSize: '11px', margin: '4px 0 8px', lineHeight: 1.5 } }, 'Effects and color grading on this clip apply to every track below it.'));
    sec.body.appendChild(kfField('tf.op', { label: 'Opacity', min: 0, max: 100, step: 0.1, def: 100, unit: '%' }));
    sec.body.appendChild(C.ui.selectField('Blend Mode', C.Scene.BLENDS, c.blend || 'normal', function (v) { C.edit('Blend Mode', function (s2) { P.clip(s2, c.id).blend = v; }); }));
    I.scroll.appendChild(sec);
  }
  function segBtn(label, on, fn) { var b = h('button' + (on ? '.on' : ''), label); b.addEventListener('click', fn); return b; }

  /* ---------- speed ---------- */
  function buildSpeed(s, c) {
    var m = P.media(c.mediaId); if (!m || P.isStill(m)) return;
    var sec = C.ui.section('Time', { key: 'time' });
    var b = sec.body;
    var ramp = C.T.hasRamp(c);
    if (ramp) {
      // time remapping: the Speed field edits the ramp key at the playhead; the graph below shows the whole curve
      b.appendChild(kfField('tm.speed', { label: 'Speed', min: 0, max: 1000, step: 1, unit: '%', def: 100, slider: true,
        get: function (cc, lf) { return KF.value(cc, 'tm.speed', lf); },
        set: function (cc, v) { C.T.setRampKey(P.seq(), cc, I.lf(), v); } }));
      b.appendChild(buildRampGraph(s, c));
      b.appendChild(h('div.muted', { style: { fontSize: '11px', margin: '2px 0 6px' } }, 'Speed ramp: drag the points (up/down = speed, left/right = time); right-click a point for the ease between speeds. 0% holds a frame. Audio follows the ramp like tape (pitch changes).'));
    } else {
      var sp = C.ui.numField({ label: 'Speed', min: 5, max: 1000, step: 1, value: c.speed * 100, unit: '%', def: 100, slider: true,
        onInput: function (v) { C.H.revertLive(); var cc = I.clip(); if (!cc) return; C.T.setSpeed(P.seq(), cc, v / 100, false); C.T.validate(P.seq()); C.live(); },
        onCommit: function () { C.commit('Change Speed'); } });
      var rampBtn = h('button.kf-btn', { title: 'Speed ramp (time remapping): add speed keyframes', html: C.icon('stopwatch') });
      rampBtn.addEventListener('click', function () { var cc = I.clip(); if (!cc) return; C.edit('Speed Ramp', function (s2) { var x = P.clip(s2, cc.id); C.T.setRampKey(s2, x, I.lf(), Math.round(x.speed * 10000) / 100); }); });
      sp.classList.add('with-kf'); sp.insertBefore(rampBtn, sp.firstChild);
      b.appendChild(sp);
      I.bound.push(function (cc) { sp.set(Math.round(cc.speed * 1000) / 10); });
    }
    b.appendChild(h('div.row', { style: { gap: '14px', margin: '4px 0' } },
      C.ui.checkField('Reverse', c.reverse, function (v) { C.edit('Reverse', function (s2) { P.linked(s2, P.clip(s2, c.id)).forEach(function (x) { x.reverse = v; }); }); }),
      c.au ? C.ui.checkField('Maintain pitch', c.au.pitch !== false, function (v) { C.edit('Maintain Pitch', function (s2) { P.clip(s2, c.id).au.pitch = v; }); }) : null,
      c.kind === 'video' && m.type === 'video' ? C.ui.checkField('Frame blending', !!(c.tm && c.tm.blend), function (v) { C.edit('Frame Blending', function (s2) { var x = P.clip(s2, c.id); x.tm = x.tm || { speed: 100 }; x.tm.blend = v; }); }, { title: 'Blend neighbouring source frames when the speed is not 100% (export and frame-exact stills; live playback shows the nearest frame)' }) : null));
    if (c.freeze != null) b.appendChild(h('div.muted', { style: { fontSize: '11px', margin: '4px 0' } }, 'Freeze frame at source ' + U.fmtTC(Math.round(c.freeze * s.fps), s.fps)));
    b.appendChild(h('div.row', { style: { gap: '6px', marginTop: '6px' } },
      h('button.btn.sm', { on: { click: A.speedDialog } }, 'Speed / Duration…'),
      c.kind === 'video' ? h('button.btn.sm', { on: { click: A.freezeFrame } }, 'Freeze Frame') : null));
    I.scroll.appendChild(sec);
  }

  // speed graph: speed (%) over the clip's local time with draggable keyframe points
  function buildRampGraph(s, c) {
    var cv = h('canvas.ramp-graph'), wrap = h('div.ramp-wrap', cv), cid = c.id;
    var Hh = 84, pad = { l: 34, r: 8, t: 6, b: 14 };
    function yOf(v, hh) { var g = hh - pad.t - pad.b; return pad.t + (v <= 200 ? g * (1 - 0.7 * v / 200) : g * (0.3 - 0.3 * Math.min(1, (v - 200) / 800))); }
    function vOf(y, hh) { var g = hh - pad.t - pad.b, k = (y - pad.t) / g; return k >= 0.3 ? (1 - k) / 0.7 * 200 : 200 + (0.3 - k) / 0.3 * 800; }
    function draw() {
      var cc = I.clip(); if (!cc || !cv.isConnected) return;
      var dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 280;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(Hh * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr); }
      var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, Hh);
      var keys = KF.keys(cc, 'tm.speed') || [], gw = W - pad.l - pad.r, dur = Math.max(1, cc.dur);
      var X = function (f) { return pad.l + f / dur * gw; };
      g.fillStyle = '#141210'; g.fillRect(pad.l, pad.t, gw, Hh - pad.t - pad.b);
      g.font = '9px ' + getComputedStyle(document.body).getPropertyValue('--mono'); g.textAlign = 'right'; g.textBaseline = 'middle';
      [0, 50, 100, 200, 500, 1000].forEach(function (v) { var y = yOf(v, Hh); g.fillStyle = v === 100 ? 'rgba(61,191,174,.35)' : 'rgba(255,255,255,.07)'; g.fillRect(pad.l, Math.round(y) + 0.5, gw, 1); g.fillStyle = '#8d8277'; g.fillText(v + '%', pad.l - 4, y); });
      // curve
      g.strokeStyle = '#f0913a'; g.lineWidth = 1.5; g.beginPath();
      for (var x = 0; x <= gw; x += 2) { var f = x / gw * dur, v = C.T.speedAt(cc, f) * 100, y = yOf(v, Hh); if (x === 0) g.moveTo(pad.l + x, y); else g.lineTo(pad.l + x, y); }
      g.stroke();
      // playhead
      var lf = I.lf(); g.fillStyle = 'rgba(255,173,98,.8)'; g.fillRect(Math.round(X(lf + 0.5)), pad.t, 1, Hh - pad.t - pad.b);
      // keys
      keys.forEach(function (k) { var x2 = X(k.f + 0.5), y2 = yOf(k.v, Hh); g.beginPath(); g.arc(x2, y2, 4, 0, Math.PI * 2); g.fillStyle = k.e === 'hold' ? '#3dbfae' : '#f2ebe3'; g.fill(); g.strokeStyle = '#1a120a'; g.lineWidth = 1; g.stroke(); });
      g.fillStyle = '#8d8277'; g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillText('0', pad.l, Hh - 1); g.textAlign = 'right'; g.fillText(U.fmtTC(dur, s.fps, { short: true }), W - pad.r, Hh - 1);
    }
    function keyAt(e) {
      var cc = I.clip(); if (!cc) return null;
      var r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, gw = r.width - pad.l - pad.r, best = null, bd = 9;
      (KF.keys(cc, 'tm.speed') || []).forEach(function (k) { var d = Math.hypot(pad.l + (k.f + 0.5) / cc.dur * gw - x, yOf(k.v, r.height) - y); if (d < bd) { bd = d; best = k; } });
      return best;
    }
    cv.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      var cc = I.clip(); if (!cc) return;
      var r = cv.getBoundingClientRect(), gw = r.width - pad.l - pad.r;
      var k = keyAt(e), f0, v0, dur0 = cc.dur, span0 = C.T.srcSpan(P.seq(), cc, cc.dur), moved = false, created = false;
      if (!k) { // click on the curve: add a key there; drag adjusts it
        var f = U.clamp(Math.round((e.clientX - r.left - pad.l) / gw * dur0 - 0.5), 0, dur0 - 1);
        if (e.detail < 2) { C.Engine.seek(cc.start + f); draw(); return; }
        C.H.revertLive(); cc = I.clip(); C.T.setRampKey(P.seq(), cc, f, Math.round(C.T.speedAt(cc, f) * 100)); created = true; C.live();
        k = KF.keyAt(cc, 'tm.speed', f);
      }
      f0 = k.f; v0 = k.v;
      C.Engine.seek(cc.start + f0);
      U.drag(e, function (dx, dy, ev) {
        moved = true;
        C.H.revertLive();
        var c2 = I.clip(); if (!c2) return;
        var ks = KF.keys(c2, 'tm.speed'); if (!ks) return;
        if (created) { C.T.setRampKey(P.seq(), c2, f0, v0); ks = KF.keys(c2, 'tm.speed'); }
        var kk = ks.filter(function (q) { return q.f === f0; })[0]; if (!kk) return;
        var nf = U.clamp(Math.round(f0 + dx / gw * dur0), 0, dur0 - 1);
        if (ks.some(function (q) { return q !== kk && q.f === nf; })) nf = kk.f;
        var nv = U.clamp(vOf(yOf(v0, r.height) + dy, r.height), 0, 1000);
        if (ev.shiftKey) nv = Math.round(nv / 25) * 25; else nv = Math.round(nv);
        kk.f = nf; kk.v = nv; KF.sort(ks);
        var group = C.state.linked && c2.link ? P.linked(P.seq(), c2) : [c2];
        group.forEach(function (gc) { if (gc !== c2) { gc.kf = gc.kf || {}; gc.kf['tm.speed'] = U.clone(ks); } C.T.fitRampDur(P.seq(), gc, span0); });
        C.live(); C.Engine.seek(c2.start + Math.min(nf, c2.dur - 1)); draw();
        C.bus.emit('inspector:refresh');
      }, function () { if (moved || created) C.commit('Speed Ramp'); else draw(); });
    });
    cv.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      var cc = I.clip(), k = keyAt(e); if (!cc) return;
      var items = [];
      if (k) {
        KF.EASINGS.forEach(function (es) { items.push({ label: es.name, checked: k.e === es.id, action: function () { C.edit('Ramp Easing', function (s2) { var x = P.clip(s2, cid); var kk = (KF.keys(x, 'tm.speed') || []).filter(function (q) { return q.f === k.f; })[0]; if (kk) { kk.e = es.id; if (es.id === 'bezier' && !kk.bz) kk.bz = KF.BEZIER_DEFAULT.slice(); } }); } }); });
        items.push('-', { label: 'Delete Point', action: function () { C.edit('Delete Ramp Point', function (s2) { var x = P.clip(s2, cid), span = C.T.srcSpan(s2, x, x.dur); KF.removeKeyAt(x, 'tm.speed', k.f); if (!C.T.hasRamp(x)) C.T.clearRamp(s2, x); else C.T.fitRampDur(s2, x, span); }); } });
      }
      items.push({ label: 'Add Point at Playhead', action: function () { C.edit('Ramp Point', function (s2) { var x = P.clip(s2, cid); C.T.setRampKey(s2, x, U.clamp(C.Engine.frame - x.start, 0, x.dur - 1), Math.round(C.T.speedAt(x, C.Engine.frame - x.start) * 100)); }); } });
      items.push({ label: 'Remove Speed Ramp', action: function () { C.edit('Remove Speed Ramp', function (s2) { C.T.clearRamp(s2, P.clip(s2, cid)); }); } });
      C.ui.menu(items, e.clientX, e.clientY);
    });
    I.bound.push(function () { draw(); });
    setTimeout(draw, 0);
    return wrap;
  }

  /* ---------- audio ---------- */
  function buildAudio(s, c) {
    var sec = C.ui.section('Audio', { key: 'audio' });
    var b = sec.body;
    b.appendChild(kfField('au.vol', { label: 'Volume', min: -60, max: 12, step: 0.1, def: 0, unit: 'dB' }));
    b.appendChild(kfField('au.pan', { label: 'Pan', min: -100, max: 100, step: 1, def: 0 }));
    b.appendChild(kfField('au.gain', { label: 'Clip Gain', min: -40, max: 30, step: 0.1, def: 0, unit: 'dB', noKf: true }));
    var fps = s.fps;
    var fin = C.ui.numField({ label: 'Fade In', min: 0, max: 30, step: 0.05, value: (c.fadeIn || 0) / fps, unit: 's', def: 0,
      onInput: function (v) { var cc = I.clip(); if (!cc) return; cc.fadeIn = Math.min(Math.round(v * fps), cc.dur); C.live(); }, onCommit: function () { C.commit('Fade In'); } });
    var fout = C.ui.numField({ label: 'Fade Out', min: 0, max: 30, step: 0.05, value: (c.fadeOut || 0) / fps, unit: 's', def: 0,
      onInput: function (v) { var cc = I.clip(); if (!cc) return; cc.fadeOut = Math.min(Math.round(v * fps), cc.dur); C.live(); }, onCommit: function () { C.commit('Fade Out'); } });
    [fin, fout].forEach(function (r) { r.classList.add('no-kf'); b.appendChild(r); });
    I.bound.push(function (cc) { fin.set((cc.fadeIn || 0) / fps); fout.set((cc.fadeOut || 0) / fps); });
    b.appendChild(h('div.row', { style: { gap: '12px', marginTop: '6px' } },
      C.ui.checkField('Mute clip', c.au.mute, function (v) { C.edit('Mute Clip', function (s2) { P.clip(s2, c.id).au.mute = v; }); }),
      h('button.btn.sm', { on: { click: A.normalize } }, 'Normalize')));
    I.scroll.appendChild(sec);
  }

  /* ---------- generated items ---------- */
  function genChange(label, fn, live) {
    var c = I.clip(); if (!c) return;
    fn(c.gen, c);
    if (live) C.live(); else C.commit(label);
  }
  function buildGen(s, c) {
    var g = c.gen, sec = C.ui.section(C.Media.GEN_NAMES[g.kind] || 'Generator', { key: 'gen' }), b = sec.body;
    if (g.kind === 'solid') b.appendChild(C.ui.colorField('Color', g.color, function (v) { genChange('', function (gg) { gg.color = v; }, true); }, function () { C.commit('Solid Color'); }));
    if (g.kind === 'gradient') {
      b.appendChild(C.ui.colorField('Start Color', g.c1, function (v) { genChange('', function (gg) { gg.c1 = v; }, true); }, function () { C.commit('Gradient'); }));
      b.appendChild(C.ui.colorField('End Color', g.c2, function (v) { genChange('', function (gg) { gg.c2 = v; }, true); }, function () { C.commit('Gradient'); }));
      b.appendChild(C.ui.selectField('Type', [['linear', 'Linear'], ['radial', 'Radial']], g.mode, function (v) { genChange('Gradient Type', function (gg) { gg.mode = v; }); }));
      var ang = C.ui.numField({ label: 'Angle', min: -180, max: 360, step: 1, value: g.angle, unit: '°', onInput: function (v) { genChange('', function (gg) { gg.angle = v; }, true); }, onCommit: function () { C.commit('Gradient Angle'); } });
      ang.classList.add('no-kf'); b.appendChild(ang);
    }
    if (g.kind === 'countdown') {
      var fr = C.ui.numField({ label: 'Count From', min: 2, max: 20, step: 1, value: g.from, onInput: function (v) { genChange('', function (gg) { gg.from = v; }, true); }, onCommit: function () { C.commit('Countdown'); } });
      fr.classList.add('no-kf'); b.appendChild(fr);
      b.appendChild(C.ui.colorField('Background', g.c1, function (v) { genChange('', function (gg) { gg.c1 = v; }, true); }, function () { C.commit('Countdown'); }));
      b.appendChild(C.ui.colorField('Sweep', g.c2, function (v) { genChange('', function (gg) { gg.c2 = v; }, true); }, function () { C.commit('Countdown'); }));
      b.appendChild(C.ui.colorField('Lines & Number', g.c3, function (v) { genChange('', function (gg) { gg.c3 = v; }, true); }, function () { C.commit('Countdown'); }));
    }
    if (g.kind === 'bars') b.appendChild(h('div.muted', { style: { fontSize: '11px' } }, 'Color bars with a 1 kHz reference tone on the linked audio clip.'));
    if (g.kind === 'spectrum') {
      b.appendChild(h('div.muted', { style: { fontSize: '11px', marginBottom: '4px' } }, 'Reacts to the audio clip playing under this clip (or the chosen item). Put it above the footage; set its blend mode for overlays.'));
      var auds = [['', 'Audio under this clip (auto)']].concat(C.state.project.media.filter(function (m) { return m.type !== 'gen' && m.hasAudio !== false && (m.type === 'audio' || m.type === 'video'); }).map(function (m) { return [m.id, m.name]; }));
      b.appendChild(C.ui.selectField('Follow', auds, g.source || '', function (v) { genChange('Spectrum Source', function (gg) { gg.source = v || null; }); }));
      b.appendChild(C.ui.selectField('Style', [['bars', 'Bars'], ['mirror', 'Mirrored bars'], ['line', 'Line'], ['ring', 'Ring']], g.style || 'bars', function (v) { genChange('Spectrum Style', function (gg) { gg.style = v; }); }));
      b.appendChild(C.ui.selectField('Position', [['bottom', 'Bottom'], ['center', 'Centre'], ['top', 'Top']], g.pos || 'bottom', function (v) { genChange('Spectrum Position', function (gg) { gg.pos = v; }); }));
      [['bands', 'Bands', 4, 256, 1, ''], ['height', 'Height', 5, 100, 1, '%'], ['gap', 'Gap', 0, 90, 1, '%'], ['smooth', 'Smoothing', 0, 100, 1, '%'], ['gain', 'Gain', 10, 400, 1, '%']].forEach(function (d) {
        var nf = C.ui.numField({ label: d[1], min: d[2], max: d[3], step: d[4], value: g[d[0]], unit: d[5], onInput: function (v) { genChange('', function (gg) { gg[d[0]] = v; }, true); }, onCommit: function () { C.commit('Spectrum ' + d[1]); } }); nf.classList.add('no-kf'); b.appendChild(nf);
      });
      b.appendChild(C.ui.colorField('Color', g.color, function (v) { genChange('', function (gg) { gg.color = v; }, true); }, function () { C.commit('Spectrum Color'); }));
      b.appendChild(C.ui.colorField('Tip Color', g.color2, function (v) { genChange('', function (gg) { gg.color2 = v; }, true); }, function () { C.commit('Spectrum Color'); }));
      b.appendChild(C.ui.checkField('Rounded bars', g.round !== false, function (v) { genChange('Spectrum Bars', function (gg) { gg.round = v; }); }));
    }
    if (g.kind === 'tcburn') {
      b.appendChild(h('div.muted', { style: { fontSize: '11px', marginBottom: '4px' } }, 'Burns the sequence timecode into the picture. Place it on the top track over the part to stamp; it renders in export too.'));
      b.appendChild(C.ui.selectField('Position', C.Titles.TC_POS, g.pos || 'bl', function (v) { genChange('Timecode Position', function (gg) { gg.pos = v; }); }));
      var tsz = C.ui.numField({ label: 'Size', min: 12, max: 160, step: 1, value: g.size || 44, unit: 'px', onInput: function (v) { genChange('', function (gg) { gg.size = v; }, true); }, onCommit: function () { C.commit('Timecode Size'); } }); tsz.classList.add('no-kf'); b.appendChild(tsz);
      var tmg = C.ui.numField({ label: 'Margin', min: 0, max: 400, step: 1, value: g.margin == null ? 40 : g.margin, unit: 'px', onInput: function (v) { genChange('', function (gg) { gg.margin = v; }, true); }, onCommit: function () { C.commit('Timecode Margin'); } }); tmg.classList.add('no-kf'); b.appendChild(tmg);
      var tof = C.ui.numField({ label: 'Offset', min: -100000, max: 100000, step: 1, value: g.offset || 0, unit: 'frames', onInput: function (v) { genChange('', function (gg) { gg.offset = Math.round(v); }, true); }, onCommit: function () { C.commit('Timecode Offset'); } }); tof.classList.add('no-kf'); b.appendChild(tof);
      b.appendChild(C.ui.textField('Label', g.label || '', function (v, commit) { genChange('Timecode Label', function (gg) { gg.label = v; }, !commit); }));
      b.appendChild(C.ui.colorField('Text', g.color || '#ffffff', function (v) { genChange('', function (gg) { gg.color = v; }, true); }, function () { C.commit('Timecode Color'); }));
      b.appendChild(C.ui.colorField('Box', g.bg || '#000000', function (v) { genChange('', function (gg) { gg.bg = v; }, true); }, function () { C.commit('Timecode Box'); }));
      var tbo = C.ui.numField({ label: 'Box Opacity', min: 0, max: 1, step: 0.05, value: g.bgOp == null ? 0.7 : g.bgOp, onInput: function (v) { genChange('', function (gg) { gg.bgOp = v; }, true); }, onCommit: function () { C.commit('Timecode Box'); } }); tbo.classList.add('no-kf'); b.appendChild(tbo);
      b.appendChild(C.ui.checkField('Show frame number', !!g.frames, function (v) { genChange('Timecode Frames', function (gg) { gg.frames = v; }); }));
    }
    I.scroll.appendChild(sec);
  }

  /* ---------- titles ---------- */
  function buildTitle(s, c) {
    var g = c.gen;
    I.selLayer = effLayer(c);
    var sec = C.ui.section('Title', { key: 'title' }), b = sec.body;
    var presetSel = h('select', { style: { flex: 1 } }, h('option', { value: '' }, 'Apply preset…'));
    C.Titles.PRESETS.forEach(function (p) { presetSel.appendChild(h('option', { value: p.id }, p.name)); });
    presetSel.addEventListener('change', function () {
      var pr = C.Titles.PRESETS.filter(function (p) { return p.id === presetSel.value; })[0]; if (!pr) return;
      C.edit('Title Preset', function (s2) { var cc = P.clip(s2, c.id); cc.gen = pr.make(); Object.keys(cc.kf || {}).forEach(function (k) { if (k.indexOf('tt.') === 0) delete cc.kf[k]; }); });
      I.selLayer = null;
    });
    var tplBtn = h('button.btn.sm', { title: 'Save this title as a reusable template (its text layers become fillable fields: Effects › New Title › My Templates)' }, 'Save as Template…');
    tplBtn.addEventListener('click', function () { A.saveTitleTemplate(c.id); });
    b.appendChild(h('div.row', { style: { margin: '4px 0 6px', gap: '6px' } }, presetSel, tplBtn));
    // layers list
    var list = h('div.layer-list');
    g.layers.slice().reverse().forEach(function (L) {
      var row = h('div.layer-row' + (L.id === I.selLayer ? '.sel' : ''), h('span', { html: C.icon(L.type === 'text' ? 'text' : L.type === 'ellipse' ? 'dot' : 'solid') }),
        h('span.ln', L.type === 'text' ? (L.text || '').split('\n')[0] || '(empty)' : (L.type === 'rect' ? 'Rectangle' : L.type === 'progress' ? 'Progress Bar' : 'Ellipse')),
        h('button.kf-btn', { title: L.hidden ? 'Show layer' : 'Hide layer', html: C.icon(L.hidden ? 'eyeoff' : 'eye'), on: { click: function (e) { e.stopPropagation(); C.edit('Toggle Layer', function (s2) { var x = layerById(P.clip(s2, c.id), L.id); x.hidden = !x.hidden; }); } } }));
      row.addEventListener('click', function () { I.selLayer = L.id; C.Program.selLayer = L.id; I.sig = null; I.refresh(); C.Program.drawOverlay(); });
      list.appendChild(row);
    });
    b.appendChild(list);
    b.appendChild(h('div.row', { style: { gap: '4px', marginBottom: '6px', flexWrap: 'wrap' } },
      h('button.btn.sm', { on: { click: function () { addLayer(c, C.Titles.newTextLayer({ text: 'New Text', size: 80, y: 50 })); } } }, '+ Text'),
      h('button.btn.sm', { on: { click: function () { addLayer(c, C.Titles.newShapeLayer('rect')); } } }, '+ Rectangle'),
      h('button.btn.sm', { on: { click: function () { addLayer(c, C.Titles.newShapeLayer('ellipse', { w: 300, h: 300 })); } } }, '+ Ellipse'),
      h('button.btn.sm', { title: 'A bar that fills over the clip\'s duration', on: { click: function () { addLayer(c, C.Titles.newShapeLayer('progress', { w: 1200, h: 14, radius: 7, y: 92 })); } } }, '+ Progress'),
      C.ui.iconBtn('chevdown', 'Move layer down', function () { moveLayer(c, -1); }, { cls: 'sm', tipPos: 'bottom' }),
      C.ui.iconBtn('chevdown', 'Move layer up', function () { moveLayer(c, 1); }, { cls: 'sm up', tipPos: 'bottom' }),
      C.ui.iconBtn('trash', 'Delete layer', function () { if (!I.selLayer) return; var id = I.selLayer; C.edit('Delete Layer', function (s2) { var cc = P.clip(s2, c.id); cc.gen.layers = cc.gen.layers.filter(function (l) { return l.id !== id; }); }); I.selLayer = null; }, { cls: 'sm', tipPos: 'bottom' })));
    b.appendChild(C.ui.checkField('Scroll as credits roll', g.roll && g.roll.on, function (v) { C.edit('Credits Roll', function (s2) { P.clip(s2, c.id).gen.roll = { on: v }; }); }));
    I.scroll.appendChild(sec);
    var L = layerById(c, I.selLayer);
    if (!L) return;
    var ls = C.ui.section(L.type === 'text' ? 'Text Layer' : 'Shape Layer', { key: 'tlayer' }), lb = ls.body;
    var lid = L.id;
    function setL(label, fn, live) { var cc = I.clip(); if (!cc) return; var x = layerById(cc, lid); if (!x) return; fn(x); if (live) C.live(); else C.commit(label); }
    function num(k, label, min, max, step, unit, noKf) {
      return kfField('tt.' + lid + '.' + k, { label: label, min: min, max: max, step: step, unit: unit, noKf: noKf, def: L[k],
        get: function (cc, lf) { var x = layerById(cc, lid); if (!x) return null; return KF.has(cc, 'tt.' + lid + '.' + k) ? KF.value(cc, 'tt.' + lid + '.' + k, lf) : x[k]; },
        set: function (cc, v) { var x = layerById(cc, lid); if (!x) return; if (KF.has(cc, 'tt.' + lid + '.' + k)) KF.setAt(cc, 'tt.' + lid + '.' + k, I.lf(), v); else x[k] = v; } });
    }
    if (L.type === 'text') {
      var tf = C.ui.textField(null, L.text, function (v, commit) { setL('Edit Text', function (x) { x.text = v; }, !commit); }, true);
      lb.appendChild(tf);
      I.bound.push(function (cc) { var x = layerById(cc, lid); if (x) tf.set(x.text); });
      var fontSel = h('select', { style: { width: '100%' } });
      C.Titles.FONTS.forEach(function (f) { fontSel.appendChild(h('option', { value: f, style: { fontFamily: f } }, f)); });
      if (C.Titles.FONTS.indexOf(L.font) < 0) fontSel.appendChild(h('option', { value: L.font }, L.font));
      fontSel.value = L.font;
      fontSel.addEventListener('change', function () { setL('Font', function (x) { x.font = fontSel.value; }); });
      var more = h('button.btn.sm', { title: 'Load installed fonts (asks permission)' }, 'More…');
      more.addEventListener('click', function () { C.Titles.loadLocalFonts().then(function (ok) { if (ok) { I.sig = null; I.refresh(); C.toast('Installed fonts loaded'); } else C.toast('Local font access not available in this browser'); }); });
      lb.appendChild(h('div.field.cl-field.wide', h('label', 'Font'), h('div.row', fontSel, window.queryLocalFonts ? more : null)));
      var wsel = C.ui.selectField('Weight', [[100, 'Thin'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra Bold'], [900, 'Black']], L.weight, function (v) { setL('Font Weight', function (x) { x.weight = +v; }); });
      lb.appendChild(wsel);
      lb.appendChild(num('size', 'Size', 4, 600, 1, 'px'));
      lb.appendChild(C.ui.colorField('Color', L.color, function (v) { setL('', function (x) { x.color = v; }, true); }, function () { C.commit('Text Color'); }));
      lb.appendChild(h('div.field.cl-field.wide', h('label', 'Style'), h('div.row',
        h('div.seg', segBtn('Left', L.align === 'left', function () { setL('Align', function (x) { x.align = 'left'; }); }), segBtn('Center', L.align === 'center', function () { setL('Align', function (x) { x.align = 'center'; }); }), segBtn('Right', L.align === 'right', function () { setL('Align', function (x) { x.align = 'right'; }); })),
        h('div.seg', segBtn('Italic', L.italic, function () { setL('Italic', function (x) { x.italic = !x.italic; }); })))));
      lb.appendChild(num('tracking', 'Tracking', -20, 100, 0.5, 'px', true));
      lb.appendChild(num('lh', 'Line Height', 0.6, 3, 0.01, '', true));
      // stroke / shadow / box
      var st = C.ui.section('Stroke, Shadow & Background', { key: 'tstyle' });
      st.body.appendChild(C.ui.checkField('Stroke', L.stroke, function (v) { setL('Stroke', function (x) { x.stroke = v; }); }));
      if (L.stroke) {
        st.body.appendChild(C.ui.colorField('Stroke Color', L.strokeColor, function (v) { setL('', function (x) { x.strokeColor = v; }, true); }, function () { C.commit('Stroke Color'); }));
        st.body.appendChild(num('strokeW', 'Stroke Width', 0, 60, 0.5, 'px', true));
      }
      st.body.appendChild(C.ui.checkField('Drop shadow', L.shadow, function (v) { setL('Shadow', function (x) { x.shadow = v; }); }));
      if (L.shadow) {
        st.body.appendChild(C.ui.colorField('Shadow Color', L.shadowColor, function (v) { setL('', function (x) { x.shadowColor = v; }, true); }, function () { C.commit('Shadow Color'); }));
        st.body.appendChild(num('shadowBlur', 'Blur', 0, 100, 1, 'px', true));
        st.body.appendChild(num('shadowX', 'Offset X', -100, 100, 1, 'px', true));
        st.body.appendChild(num('shadowY', 'Offset Y', -100, 100, 1, 'px', true));
        st.body.appendChild(num('shadowOp', 'Opacity', 0, 1, 0.01, '', true));
      }
      st.body.appendChild(C.ui.checkField('Background box', L.box, function (v) { setL('Background Box', function (x) { x.box = v; }); }));
      if (L.box) {
        st.body.appendChild(C.ui.colorField('Box Color', L.boxColor, function (v) { setL('', function (x) { x.boxColor = v; }, true); }, function () { C.commit('Box Color'); }));
        st.body.appendChild(num('boxPad', 'Padding', 0, 200, 1, 'px', true));
        st.body.appendChild(num('boxRadius', 'Corner Radius', 0, 200, 1, 'px', true));
        st.body.appendChild(num('boxOp', 'Opacity', 0, 1, 0.01, '', true));
      }
      I.scroll.appendChild(ls);
      I.scroll.appendChild(st);
    } else {
      lb.appendChild(C.ui.colorField('Fill', L.color, function (v) { setL('', function (x) { x.color = v; }, true); }, function () { C.commit('Shape Color'); }));
      lb.appendChild(C.ui.checkField('Gradient fill', !!L.grad, function (v) { setL('Gradient Fill', function (x) { x.grad = v; }); }));
      if (L.grad) {
        lb.appendChild(C.ui.colorField('Second Color', L.color2 || '#3dbfae', function (v) { setL('', function (x) { x.color2 = v; }, true); }, function () { C.commit('Gradient Color'); }));
        lb.appendChild(num('gradAngle', 'Gradient Angle', -180, 180, 1, '°', true));
      }
      lb.appendChild(num('w', 'Width', 1, 4000, 1, 'px'));
      lb.appendChild(num('h', 'Height', 1, 4000, 1, 'px'));
      if (L.type === 'rect' || L.type === 'progress') lb.appendChild(num('radius', 'Corner Radius', 0, 500, 1, 'px'));
      if (L.type === 'progress') {
        lb.appendChild(num('pFrom', 'Fill From', 0, 100, 1, '%', true)); lb.appendChild(num('pTo', 'Fill To', 0, 100, 1, '%', true));
        lb.appendChild(C.ui.checkField('Show track behind the fill', L.pTrack !== false, function (v) { setL('Progress Track', function (x) { x.pTrack = v; }); }));
        if (L.pTrack !== false) lb.appendChild(num('pTrackOp', 'Track Opacity', 0, 1, 0.05, '', true));
        lb.appendChild(h('div.muted', { style: { fontSize: '11px', margin: '2px 0 4px' } }, 'The fill grows from "Fill From" to "Fill To" over the clip\'s duration — trim the clip to the section it should time.'));
      }
      lb.appendChild(C.ui.checkField('Outline', L.stroke, function (v) { setL('Outline', function (x) { x.stroke = v; }); }));
      if (L.stroke) { lb.appendChild(C.ui.colorField('Outline Color', L.strokeColor, function (v) { setL('', function (x) { x.strokeColor = v; }, true); }, function () { C.commit('Outline Color'); })); lb.appendChild(num('strokeW', 'Outline Width', 0, 60, 0.5, 'px', true)); }
      I.scroll.appendChild(ls);
    }
    var pos = C.ui.section('Layer Position & Animation', { key: 'tpos' });
    pos.body.appendChild(num('x', 'Position X', -50, 150, 0.1, '%'));
    pos.body.appendChild(num('y', 'Position Y', -50, 150, 0.1, '%'));
    pos.body.appendChild(num('scale', 'Scale', 0, 500, 0.1, '%'));
    pos.body.appendChild(num('rot', 'Rotation', -360, 360, 0.1, '°'));
    pos.body.appendChild(num('opacity', 'Opacity', 0, 100, 0.1, '%'));
    pos.body.appendChild(C.ui.selectField('Animate In', C.Titles.ANIMS.filter(function (a) { return L.type === 'text' || ['typewriter', 'words', 'chars', 'charsFade', 'wordsUp', 'wipe'].indexOf(a.id) < 0; }).map(function (a) { return [a.id, a.name]; }), L.anIn || 'none', function (v) { setL('Animation In', function (x) { x.anIn = v; }); }));
    pos.body.appendChild(C.ui.selectField('Animate Out', C.Titles.ANIMS.filter(function (a) { return a.id !== 'typewriter' && a.id !== 'words' && (L.type === 'text' || ['chars', 'charsFade', 'wordsUp', 'wipe'].indexOf(a.id) < 0); }).map(function (a) { return [a.id, a.name]; }), L.anOut || 'none', function (v) { setL('Animation Out', function (x) { x.anOut = v; }); }));
    pos.body.appendChild(num('anDur', 'Anim. Duration', 0.05, 5, 0.05, 's', true));
    pos.body.appendChild(h('div.row', { style: { gap: '4px', marginTop: '6px' } },
      h('button.btn.sm', { on: { click: function () { setL('Center Horizontally', function (x) { x.x = 50; }); } } }, 'Center H'),
      h('button.btn.sm', { on: { click: function () { setL('Center Vertically', function (x) { x.y = 50; }); } } }, 'Center V')));
    I.scroll.appendChild(pos);
  }
  function layerById(c, id) { return c && c.gen && c.gen.layers ? c.gen.layers.filter(function (l) { return l.id === id; })[0] : null; }
  function addLayer(c, L) { C.edit('Add Layer', function (s2) { P.clip(s2, c.id).gen.layers.push(L); }); I.selLayer = L.id; I.sig = null; I.refresh(); }
  function moveLayer(c, d) {
    var id = I.selLayer; if (!id) return;
    C.edit('Reorder Layer', function (s2) { var ls = P.clip(s2, c.id).gen.layers, i = ls.findIndex(function (l) { return l.id === id; }), j = i + d; if (i < 0 || j < 0 || j >= ls.length) return false; var t = ls[i]; ls[i] = ls[j]; ls[j] = t; });
  }

  /* ---------- effects stack ---------- */
  function buildEffects(s, c, kind) {
    var list = (c.fx || []).filter(function (f) { var d = C.FX.byId[f.type]; return d && (kind === 'audio' ? d.audio : !d.audio); });
    var addBtn = C.ui.iconBtn('plus', 'Add effect', function (e, b) {
      var r = b.getBoundingClientRect(), cats = {};
      C.FX.forKind(kind).forEach(function (d) { (cats[d.cat] = cats[d.cat] || []).push(d); });
      C.ui.menu(Object.keys(cats).map(function (cat) { return { label: cat, sub: cats[cat].map(function (d) { return { label: d.name, action: function () { A.applyEffect(d.id, [c.id]); } }; }) }; }), r.left - 160, r.bottom + 2);
    }, { cls: 'sm', tipPos: 'bottom' });
    var sec = C.ui.section((kind === 'audio' ? 'Audio Effects' : 'Effects') + (list.length ? ' (' + list.length + ')' : ''), { key: 'fx-' + kind, tools: h('span.sec-tools', addBtn) });
    if (!list.length) sec.body.appendChild(h('div.muted', { style: { fontSize: '11px', padding: '4px 0' } }, 'No effects. Drag one from the Effects tab or click +.'));
    list.forEach(function (fx) {
      var def = C.FX.byId[fx.type];
      var item = h('div.fx-item' + (fx.on ? '' : '.off'));
      var collapsedKey = 'fxc.' + fx.id;
      if (U.lsGet(collapsedKey, false)) item.classList.add('collapsed');
      var onBox = h('input', { type: 'checkbox', checked: fx.on, title: 'Enable / bypass' });
      onBox.addEventListener('click', function (e) { e.stopPropagation(); });
      onBox.addEventListener('change', function () { C.edit((onBox.checked ? 'Enable ' : 'Bypass ') + def.name, function (s2) { var x = (P.clip(s2, c.id).fx || []).filter(function (f) { return f.id === fx.id; })[0]; if (x) x.on = onBox.checked; }); });
      var head = h('div.fx-head', h('span.grip', { html: C.icon('drag'), title: 'Drag to reorder' }), onBox, h('span.nm', def.name),
        C.ui.iconBtn('undo', 'Reset parameters', function (e) { e.stopPropagation(); C.edit('Reset ' + def.name, function (s2) { var cc = P.clip(s2, c.id), x = cc.fx.filter(function (f) { return f.id === fx.id; })[0]; x.p = C.FX.defaults(def.id); KF.removeForEffect(cc, fx.id); }); }, { cls: 'sm' }),
        C.ui.iconBtn('trash', 'Remove effect', function (e) { e.stopPropagation(); C.edit('Remove ' + def.name, function (s2) { var cc = P.clip(s2, c.id); cc.fx = cc.fx.filter(function (f) { return f.id !== fx.id; }); KF.removeForEffect(cc, fx.id); }); }, { cls: 'sm' }));
      head.addEventListener('click', function (e) { if (e.target.closest('button,input')) return; item.classList.toggle('collapsed'); U.lsSet(collapsedKey, item.classList.contains('collapsed')); });
      // reorder via drag
      var grip = head.querySelector('.grip');
      grip.addEventListener('pointerdown', function (e) {
        e.preventDefault(); e.stopPropagation();
        var items = U.$$('.fx-item', sec.body), from = items.indexOf(item), to = from;
        U.drag(e, function (dx, dy, ev) {
          items.forEach(function (it) { it.classList.remove('drag-over'); });
          var tgt = document.elementFromPoint(ev.clientX, ev.clientY); var it2 = tgt && tgt.closest('.fx-item');
          if (it2 && items.indexOf(it2) >= 0) { to = items.indexOf(it2); it2.classList.add('drag-over'); }
        }, function () {
          items.forEach(function (it) { it.classList.remove('drag-over'); });
          if (to === from) return;
          C.edit('Reorder Effects', function (s2) {
            var cc = P.clip(s2, c.id), ids = list.map(function (f) { return f.id; });
            var moved = ids.splice(from, 1)[0]; ids.splice(to, 0, moved);
            var others = cc.fx.filter(function (f) { return ids.indexOf(f.id) < 0; });
            cc.fx = (kind === 'audio' ? others : []).concat(ids.map(function (id) { return cc.fx.filter(function (f) { return f.id === id; })[0]; })).concat(kind === 'audio' ? [] : others);
          });
        });
      });
      var body = h('div.fx-body');
      if (def.ui) { try { var custom = def.ui(c, fx, { clip: I.clip, lf: I.lf, kfField: kfField }); if (custom) body.appendChild(custom); } catch (err) { console.warn('[Cutline] effect UI failed', err); } }
      def.params.forEach(function (q) {
        var path = 'fx.' + fx.id + '.' + q.k;
        function setP(v, live) { var cc = I.clip(); if (!cc) return; var x = (cc.fx || []).filter(function (f) { return f.id === fx.id; })[0]; if (!x) return; x.p[q.k] = v; if (live) C.live(); else C.commit(def.name + ': ' + q.name); }
        if (q.type === 'range') body.appendChild(kfField(path, { label: q.name, min: q.min, max: q.max, step: q.step, unit: q.unit, def: q.def, noKf: !!def.audio }));
        else if (q.type === 'color') { var cf = C.ui.colorField(q.name, fx.p[q.k], function (v) { setP(v, true); }, function (v) { setP(v, false); }); body.appendChild(cf); if (def.id === 'chromakey' && q.k === 'key') cf.querySelector('.row').appendChild(pickerBtn(function (hex) { setP(hex, false); cf.set(hex); })); }
        else if (q.type === 'select') body.appendChild(C.ui.selectField(q.name, q.options, fx.p[q.k], function (v) { setP(v, false); }));
        else if (q.type === 'bool') body.appendChild(C.ui.checkField(q.name, fx.p[q.k], function (v) { setP(v, false); }));
      });
      item.appendChild(head); item.appendChild(body);
      sec.body.appendChild(item);
    });
    I.scroll.appendChild(sec);
  }
  /* ---------- masks ---------- */
  function buildMasks(s, c) {
    var masks = c.masks || [];
    if (I.selMask && !masks.some(function (m) { return m.id === I.selMask; })) I.selMask = null;
    var addBtn = C.ui.iconBtn('plus', 'Add mask', function (e, b) {
      var r = b.getBoundingClientRect();
      C.ui.menu([
        { label: 'Ellipse', action: function () { addMask(c, 'ellipse'); } },
        { label: 'Rectangle', action: function () { addMask(c, 'rect'); } },
        { label: 'Pen Path (draw on the Program monitor)', action: function () { addMask(c, 'path'); } }
      ], r.left - 120, r.bottom + 2);
    }, { cls: 'sm', tipPos: 'bottom' });
    var sec = C.ui.section('Masks' + (masks.length ? ' (' + masks.length + ')' : ''), { key: 'masks', tools: h('span.sec-tools', addBtn) });
    var b = sec.body;
    if (!masks.length) { b.appendChild(h('div.muted', { style: { fontSize: '11px', padding: '4px 0' } }, 'No masks. Click + to limit the clip, or an effect, to an ellipse, rectangle or drawn shape.')); I.scroll.appendChild(sec); return; }
    var list = h('div.layer-list');
    masks.forEach(function (m, i) {
      var fxName = m.fx ? (function () { var f = (c.fx || []).filter(function (x) { return x.id === m.fx; })[0]; var d = f && C.FX.byId[f.type]; return d ? d.name : 'effect'; })() : null;
      var row = h('div.layer-row' + (m.id === I.selMask ? '.sel' : ''), h('span', { html: C.icon(m.type === 'rect' ? 'solid' : m.type === 'path' ? 'pen' : 'dot') }),
        h('span.ln', (m.name || ({ ellipse: 'Ellipse', rect: 'Rectangle', path: 'Path' })[m.type] + ' ' + (i + 1)) + (fxName ? ' → ' + fxName : '') + (m.inv ? ' (inverted)' : '')),
        C.ui.iconBtn('trash', 'Delete mask', function (e) { e.stopPropagation(); C.edit('Delete Mask', function (s2) { var cc = P.clip(s2, c.id); cc.masks = (cc.masks || []).filter(function (x) { return x.id !== m.id; }); KF.removeForPrefix(cc, 'mk.' + m.id + '.'); }); if (I.selMask === m.id) I.selMask = null; }, { cls: 'sm' }));
      row.addEventListener('click', function () { I.selMask = m.id; C.Program.selMask = m.id; I.sig = null; I.refresh(); C.Program.drawOverlay(); });
      list.appendChild(row);
    });
    b.appendChild(list);
    var M = masks.filter(function (m) { return m.id === I.selMask; })[0];
    if (!M) { b.appendChild(h('div.muted', { style: { fontSize: '11px', padding: '4px 0' } }, 'Select a mask to edit it; its handles appear on the Program monitor.')); I.scroll.appendChild(sec); return; }
    C.Program.selMask = M.id;
    var mid = M.id;
    function mf(k, label, min, max, step, unit) { return kfField('mk.' + mid + '.' + k, { label: label, min: min, max: max, step: step, unit: unit, def: C.Masks.newMask(M.type)[k] }); }
    if (M.type !== 'path') {
      b.appendChild(mf('cx', 'Center X', -50, 150, 0.1, '%')); b.appendChild(mf('cy', 'Center Y', -50, 150, 0.1, '%'));
      b.appendChild(mf('w', 'Width', 0, 200, 0.1, '%')); b.appendChild(mf('h', 'Height', 0, 200, 0.1, '%'));
      b.appendChild(mf('rot', 'Rotation', -180, 180, 0.5, '°'));
    } else {
      var animPts = C.Masks.pointsAnimated(c, mid);
      var animBtn = h('button.kf-btn' + (animPts ? '.on' : ''), { title: animPts ? 'Point animation on: dragging a point adds a keyframe for it at the playhead. Click to bake the current shape and stop animating points.' : 'Animate the points: keyframe every point at the playhead; dragging a point then keys it there', html: C.icon('stopwatch') });
      animBtn.addEventListener('click', function () { C.edit(animPts ? 'Stop Animating Points' : 'Animate Mask Points', function (s2) { var cc = P.clip(s2, c.id); if (cc) C.Masks.animatePoints(cc, mid, !animPts, I.lf()); }); I.sig = null; I.refresh(); });
      b.appendChild(h('div.row', { style: { gap: '6px', margin: '4px 0', alignItems: 'center' } }, animBtn, h('span.muted', { style: { fontSize: '11px', flex: 1 } }, (M.pts || []).length + ' points' + (animPts ? ' (animated)' : '') + ' — drag them on the Program monitor; double-click an edge to add one, Alt+click a point to remove it.'),
        h('button.btn.sm', { on: { click: function () { C.Program.beginPen(c.id, mid); } } }, 'Draw…')));
      b.appendChild(h('div.row', { style: { gap: '14px', margin: '2px 0 4px 24px' } },
        C.ui.checkField('Smooth curve', !!M.smooth, function (v) { C.edit('Smooth Mask', function (s2) { var x = C.Masks.byId(P.clip(s2, c.id), mid); if (x) x.smooth = v; }); }, { title: 'Draw the path as a smooth curve through its points instead of straight segments' })));
      b.appendChild(mf('cx', 'Offset X', -50, 150, 0.1, '%')); b.appendChild(mf('cy', 'Offset Y', -50, 150, 0.1, '%'));
      b.appendChild(mf('w', 'Scale X', 0, 200, 0.1, '')); b.appendChild(mf('h', 'Scale Y', 0, 200, 0.1, ''));
      b.appendChild(mf('rot', 'Rotation', -180, 180, 0.5, '°'));
    }
    var mediaOf = P.media(c.mediaId);
    if (mediaOf && mediaOf.type === 'video') { // tracking
      var trackRow = h('div.row', { style: { gap: '6px', margin: '6px 0 2px' } },
        h('span.muted', { style: { fontSize: '11px', minWidth: '58px' } }, 'Track'),
        h('button.btn.sm', { title: 'Follow the picture under the mask backwards to the clip start (writes Center keyframes)', on: { click: function () { trackMask(c, mid, -1); } } }, '◀ Backward'),
        h('button.btn.sm', { title: 'Follow the picture under the mask forward to the clip end (writes Center keyframes)', on: { click: function () { trackMask(c, mid, 1); } } }, 'Forward ▶'));
      b.appendChild(trackRow);
    }
    b.appendChild(mf('feather', 'Feather', 0, 400, 1, 'px'));
    b.appendChild(mf('expand', 'Expansion', -300, 300, 1, 'px'));
    b.appendChild(mf('op', 'Opacity', 0, 100, 1, '%'));
    var fxOpts = [['', 'Whole clip (cuts out everything outside)']].concat((c.fx || []).filter(function (f) { var d = C.FX.byId[f.type]; return d && !d.audio; }).map(function (f) { return [f.id, 'Effect: ' + C.FX.byId[f.type].name]; }));
    b.appendChild(C.ui.selectField('Applies to', fxOpts, M.fx || '', function (v) { C.edit('Mask Target', function (s2) { var x = C.Masks.byId(P.clip(s2, c.id), mid); if (x) x.fx = v || null; }); }));
    b.appendChild(h('div.row', { style: { gap: '14px', margin: '4px 0 2px 24px' } },
      C.ui.checkField('Invert', M.inv, function (v) { C.edit('Invert Mask', function (s2) { var x = C.Masks.byId(P.clip(s2, c.id), mid); if (x) x.inv = v; }); })));
    I.scroll.appendChild(sec);
  }
  function trackMask(c, mid, dir) {
    var s = P.seq(), lf = I.lf();
    if (dir > 0 && lf >= c.dur - 1) { C.toast('The playhead is already at the end of the clip'); return; }
    if (dir < 0 && lf <= 0) { C.toast('The playhead is already at the start of the clip'); return; }
    var opts = { cancel: {} }, prog = C.ui.progress('Tracking mask…', { cancel: function () { opts.cancel.v = true; } });
    opts.onProgress = function (p) { prog.update(p, Math.round(p * 100) + '%'); };
    C.Tracker.trackMask(s, c, mid, lf, dir, opts).then(function (r) {
      prog.done();
      C.toast('Tracked ' + r.keys + ' keyframes' + (r.step > 1 ? ' (every ' + r.step + ' frames)' : '') + (r.lost ? ' · ' + r.lost + ' frames held (weak match)' : ''));
    }, function (e) { prog.done(); C.toast('Tracking failed: ' + (e && e.message || e)); });
  }
  function addMask(c, type) {
    var m = C.Masks.newMask(type, type === 'rect' ? { w: 60, h: 60 } : {});
    C.edit('Add Mask', function (s2) { var cc = P.clip(s2, c.id); cc.masks = cc.masks || []; cc.masks.push(m); });
    I.selMask = m.id; C.Program.selMask = m.id; I.sig = null; I.refresh();
    if (type === 'path') C.Program.beginPen(c.id, m.id);
  }
  I.selectMask = function (id) { I.selMask = id; I.sig = null; I.refresh(); };

  // Eyedropper: pick a color from the program monitor
  function pickerBtn(cb) {
    var b = C.ui.iconBtn('wand', 'Pick key color from Program monitor', function () {
      C.toast('Click in the Program monitor to sample a color');
      var ov = C.Program.overlay;
      function pick(e) {
        e.stopPropagation(); e.preventDefault();
        ov.removeEventListener('pointerdown', pick, true); ov.style.cursor = '';
        var r = ov.getBoundingClientRect(), comp = C.Engine.comp;
        var kx = (e.clientX - r.left) / r.width, ky = (e.clientY - r.top) / r.height;
        // sample the unkeyed frame: bypass this clip's keyers for one synchronous render, then restore
        var cc = I.clip(), bypassed = [];
        if (cc) (cc.fx || []).forEach(function (f) { if (f.on && (f.type === 'chromakey' || f.type === 'lumakey')) { f.on = false; bypassed.push(f); } });
        var rd = null;
        try { if (bypassed.length) C.Engine.renderNow(); rd = comp.readFull && comp.readFull(); }
        finally { bypassed.forEach(function (f) { f.on = true; }); if (bypassed.length) C.Engine.renderNow(); }
        if (!rd) return;
        var x = U.clamp(Math.floor(kx * rd.w), 0, rd.w - 1), y = U.clamp(Math.floor(ky * rd.h), 0, rd.h - 1), i = (y * rd.w + x) * 4;
        cb(U.rgbToHex(rd.data[i] / 255, rd.data[i + 1] / 255, rd.data[i + 2] / 255));
      }
      ov.style.cursor = 'crosshair';
      ov.addEventListener('pointerdown', pick, true);
    }, { cls: 'sm' });
    return b;
  }

  /* ---------- transitions ---------- */
  function buildTransition(s, tr) {
    var def = C.TR.byId[tr.type];
    I.clipId = null;
    var rg = P.transitionRange(s, tr);
    I.scroll.appendChild(h('div.insp-title', h('div.sw', { style: { background: def.kind === 'audio' ? 'var(--clip-audio)' : 'var(--accent-2)' } }),
      h('div', { style: { flex: 1 } }, h('div.nm', def.name), h('div.meta', U.fmtTC(rg.start, s.fps) + ' → ' + U.fmtTC(rg.end, s.fps)))));
    var sec = C.ui.section('Transition', { key: 'trans' }), b = sec.body;
    function upd(label, fn) { C.edit(label, function (s2) { var t = P.findTransition(s2, tr.id); if (t) fn(t, s2); }); }
    b.appendChild(C.ui.selectField('Type', C.TR.forKind(def.kind).map(function (d) { return [d.id, d.name]; }), tr.type, function (v) { upd('Transition Type', function (t) { t.type = v; t.params = C.TR.defaults(v); }); }));
    var dur = C.ui.numField({ label: 'Duration', min: 0.04, max: 10, step: 0.01, value: tr.dur / s.fps, unit: 's', def: C.prefs.transDur,
      onInput: function (v) { var t = P.findTransition(P.seq(), tr.id); if (t) { t.dur = Math.max(1, Math.round(v * s.fps)); C.T.validate(P.seq()); C.live(); } }, onCommit: function () { C.commit('Transition Duration'); } });
    dur.classList.add('no-kf');
    b.appendChild(dur);
    if (tr.a && tr.b) b.appendChild(h('div.field.cl-field.wide', h('label', 'Alignment'), h('div.seg',
      segBtn('Center', tr.align === 'center', function () { upd('Alignment', function (t) { t.align = 'center'; }); }),
      segBtn('Start at cut', tr.align === 'start', function () { upd('Alignment', function (t) { t.align = 'start'; }); }),
      segBtn('End at cut', tr.align === 'end', function () { upd('Alignment', function (t) { t.align = 'end'; }); }))));
    else b.appendChild(h('div.muted', { style: { fontSize: '11px', margin: '4px 0' } }, tr.b ? 'Single-sided: transitions in from the track below.' : 'Single-sided: transitions out to the track below.'));
    if (def.kind === 'video') b.appendChild(C.ui.checkField('Reverse direction', tr.reverse, function (v) { upd('Reverse Transition', function (t) { t.reverse = v; }); }));
    def.params.forEach(function (q) {
      var cur = (tr.params || {})[q.k]; if (cur == null) cur = q.def;
      if (q.type === 'range') {
        var f = C.ui.numField({ label: q.name, min: q.min, max: q.max, step: q.step, value: cur, unit: q.unit, def: q.def,
          onInput: function (v) { var t = P.findTransition(P.seq(), tr.id); if (t) { t.params = t.params || {}; t.params[q.k] = v; C.live(); } }, onCommit: function () { C.commit('Transition: ' + q.name); } });
        f.classList.add('no-kf'); b.appendChild(f);
      } else if (q.type === 'select') b.appendChild(C.ui.selectField(q.name, q.options, cur, function (v) { upd('Transition: ' + q.name, function (t) { t.params = t.params || {}; t.params[q.k] = v; }); }));
      else if (q.type === 'color') b.appendChild(C.ui.colorField(q.name, cur, function (v) { var t = P.findTransition(P.seq(), tr.id); if (t) { t.params[q.k] = v; C.live(); } }, function () { C.commit('Transition: ' + q.name); }));
    });
    b.appendChild(h('div.row', { style: { marginTop: '8px', gap: '6px' } },
      h('button.btn.sm', { on: { click: function () { C.prefs[def.kind === 'audio' ? 'defAudioTr' : 'defVideoTr'] = tr.type; C.savePrefs(); C.toast(def.name + ' is now the default ' + def.kind + ' transition'); } } }, 'Set as Default'),
      h('button.btn.sm.danger', { on: { click: function () { A.del(false); } } }, 'Delete')));
    I.scroll.appendChild(sec);
  }
})();
