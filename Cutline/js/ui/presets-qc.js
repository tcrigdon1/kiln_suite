/* Cutline — effect presets (save / apply a clip's effect stack), Split at Markers, QC finder (gaps, tiny clips,
   black frames), and Export Grade as .cube (the selected clip's colour grade + colour effects baked to a 3D LUT). */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, P = C.P, T = C.T, h = U.h;
  var PQ = C.PresetsQC = {};

  /* ---------- effect presets ---------- */
  PQ.presets = function () { return U.lsGet('fxPresets', []); };
  PQ.savePresets = function (list) { U.lsSet('fxPresets', list); C.bus.emit('presets'); };
  PQ.savePreset = function () {
    var c = P.selectedClips()[0]; if (!c) { C.toast('Select a clip first'); return; }
    var fx = (c.fx || []).filter(function (f) { var d = C.FX.byId[f.type]; return !!d; });
    var hasCol = c.kind === 'video' && c.col && JSON.stringify(c.col) !== JSON.stringify(P.defaultColor());
    if (!fx.length && !hasCol) { C.toast(c.name + ' has no effects or colour grade to save'); return; }
    var name = h('input', { type: 'text', value: (c.name || 'Preset').replace(/\.[^.]+$/, '') + ' look', style: { width: '100%' } });
    var inclCol = h('input', { type: 'checkbox', checked: hasCol });
    name.addEventListener('keydown', function (e) { e.stopPropagation(); });
    var body = h('div', { style: { width: '380px' } }, h('div.form-grid', h('label', 'Name'), name, h('label', 'Include'), h('div', h('div', fx.length + ' effect' + (fx.length === 1 ? '' : 's') + ': ' + fx.map(function (f) { return C.FX.byId[f.type].name; }).join(', ')), hasCol ? h('label.cl-check', inclCol, h('span', 'Colour grade (Lift/Gamma/Gain, curves, etc.)')) : null)));
    var d = C.ui.dialog({ title: 'Save Effect Preset', body: body, buttons: [{ label: 'Cancel' }, { label: 'Save', primary: true, action: function () {
      var list = PQ.presets().filter(function (p) { return p.name !== name.value.trim(); });
      list.push({ id: U.uid('pre'), name: name.value.trim() || 'Preset', kind: c.kind, fx: fx.map(function (f) { return { type: f.type, p: U.clone(f.p), on: f.on !== false }; }), col: hasCol && inclCol.checked ? U.clone(c.col) : null, made: Date.now() });
      PQ.savePresets(list); C.toast('Preset “' + (name.value.trim() || 'Preset') + '” saved');
    } }] });
    setTimeout(function () { name.focus(); name.select(); }, 30); void d;
  };
  PQ.applyPreset = function (id, replace) {
    var pre = PQ.presets().filter(function (p) { return p.id === id; })[0]; if (!pre) return;
    var clips = P.selectedClips(); if (!clips.length) { C.toast('Select the clips to apply “' + pre.name + '” to'); return; }
    C.edit('Apply Preset ' + pre.name, function (s2) {
      clips.forEach(function (c) {
        var cc = P.clip(s2, c.id); if (!cc) return;
        if (replace) cc.fx = [];
        pre.fx.forEach(function (f) { var def = C.FX.byId[f.type]; if (!def) return; if (def.audio && cc.kind !== 'audio' && !(cc.kind === 'video' && !cc.link)) return; if (!def.audio && cc.kind !== 'video') return; var inst = C.FX.newInstance(f.type); Object.assign(inst.p, f.p); inst.on = f.on !== false; cc.fx = cc.fx || []; cc.fx.push(inst); });
        if (pre.col && cc.kind === 'video') cc.col = U.clone(pre.col);
      });
    });
    C.toast('“' + pre.name + '” applied to ' + clips.length + ' clip' + (clips.length === 1 ? '' : 's'));
  };
  PQ.managePresets = function () {
    var list = PQ.presets();
    var body = h('div', { style: { width: '460px' } });
    function render() {
      U.clear(body);
      if (!list.length) { body.appendChild(h('div.muted', 'No presets yet — select a clip with effects and use Clip ▸ Effect Presets ▸ Save Current Effects as Preset…')); return; }
      list.forEach(function (p) {
        var row = h('div.row', { style: { gap: '8px', padding: '4px 0', borderBottom: '1px solid var(--line-soft)' } },
          h('div', { style: { flex: 1 } }, h('div', p.name), h('div.muted', { style: { fontSize: '11px' } }, p.fx.map(function (f) { return (C.FX.byId[f.type] || {}).name || f.type; }).join(', ') + (p.col ? ' · colour grade' : ''))),
          h('button.btn.sm', { on: { click: function () { C.ui.prompt('Rename Preset', p.name, 'Name').then(function (n) { if (n) { p.name = n; PQ.savePresets(list); render(); } }); } } }, 'Rename'),
          h('button.btn.sm', { on: { click: function () { list.splice(list.indexOf(p), 1); PQ.savePresets(list); render(); } } }, 'Delete'));
        body.appendChild(row);
      });
      var exp = h('div.row', { style: { gap: '8px', marginTop: '10px' } },
        h('button.btn.sm', { on: { click: function () { U.download(new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' }), 'cutline-effect-presets.json'); } } }, 'Export all…'),
        h('button.btn.sm', { on: { click: function () { U.pickFiles('.json,application/json', false).then(function (files) { if (!files.length) return; files[0].text().then(function (t) { try { var arr = JSON.parse(t); if (!Array.isArray(arr)) throw new Error('not a preset file'); arr.forEach(function (p) { if (p && p.name && Array.isArray(p.fx)) { p.id = U.uid('pre'); list.push(p); } }); PQ.savePresets(list); render(); } catch (e) { C.toast('Could not import: ' + e.message); } }); }); } } }, 'Import…'));
      body.appendChild(exp);
    }
    render();
    C.ui.dialog({ title: 'Effect Presets', body: body, buttons: [{ label: 'Close', primary: true }] });
  };

  /* ---------- split at markers ---------- */
  PQ.splitAtMarkers = function () {
    var s = P.seq(); if (!s) return;
    if (!s.markers.length) { C.toast('No sequence markers'); return; }
    var sel = P.selectedClips(), locked = {}; s.tracks.forEach(function (t) { if (t.lock) locked[t.id] = true; });
    var n = 0;
    C.edit('Split at Markers', function (s2) {
      var ids = sel.length ? sel.map(function (c) { return c.id; }) : null;
      s2.markers.map(function (m) { return m.f; }).sort(function (a, b) { return b - a; }).forEach(function (f) {
        var at = s2.clips.filter(function (c) { return !locked[c.trackId] && (!ids || ids.indexOf(c.id) >= 0) && f > c.start && f < c.start + c.dur; });
        // linked partners split together
        var links = {}; at.forEach(function (c) { if (c.link) links[c.link] = 1; });
        s2.clips.forEach(function (c) { if (c.link && links[c.link] && at.indexOf(c) < 0 && !locked[c.trackId] && f > c.start && f < c.start + c.dur) at.push(c); });
        if (at.length) { T.splitClips(s2, at, f); n += at.length; }
      });
    });
    C.toast(n ? n + ' cut' + (n === 1 ? '' : 's') + ' added at ' + s.markers.length + ' marker' + (s.markers.length === 1 ? '' : 's') : 'No clips under the markers');
  };

  /* ---------- QC: gaps, flash frames, black frames ---------- */
  PQ.findProblems = function (opts, onStatus) {
    var s = P.seq(), out = [], fps = s.fps, minClip = opts.minClip || 3;
    var vt = s.tracks.filter(function (t) { return t.kind === 'video' && !t.hidden; });
    // tiny clips
    s.clips.forEach(function (c) { if (c.dur < minClip) out.push({ kind: 'flash', f: c.start, end: c.start + c.dur, text: 'Clip “' + c.name + '” is only ' + c.dur + ' frame' + (c.dur === 1 ? '' : 's') + ' long' }); });
    // gaps in video coverage (no clip on any visible video track)
    var end = P.seqDuration(s), edges = [0, end]; s.clips.forEach(function (c) { if (vt.some(function (t) { return t.id === c.trackId; })) { edges.push(c.start, c.start + c.dur); } });
    edges = edges.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
    for (var i = 0; i < edges.length - 1; i++) { var a = edges[i], b = edges[i + 1]; if (b <= a) continue; var mid = (a + b) / 2; var covered = s.clips.some(function (c) { return c.enabled !== false && vt.some(function (t) { return t.id === c.trackId; }) && mid >= c.start && mid < c.start + c.dur; }); if (!covered) out.push({ kind: 'gap', f: a, end: b, text: 'No video for ' + U.fmtTC(b - a, fps) + ' (black gap)' }); }
    if (!opts.black) return Promise.resolve(out);
    // black frames: render the programme at low resolution every `step` frames
    var cv = document.createElement('canvas'); cv.width = 64; cv.height = 36;
    var comp = C.createCompositor(cv), prov = new C.SourceProvider('qc'); prov.useDecoders = false;
    var step = Math.max(1, Math.round(fps / (opts.rate || 2))), f = 0, run = null, total = end;
    function finish(r) { if (r) out.push(r); }
    function next() {
      if (f >= total || (opts.cancel && opts.cancel.v)) { finish(run); prov.dropAll(); if (comp.destroy) comp.destroy(); return Promise.resolve(out); }
      var scene = C.Scene.build(s, f, { captions: false });
      return prov.prepare(scene).then(function () {
        comp.render(scene, 64, 36, prov, { captions: false });
        var px = comp.readSmall ? comp.readSmall(8, 4) : null; var mean = 0;
        if (px) { for (var i = 0; i < px.length; i += 4) mean += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; mean /= px.length / 4; }
        var black = px && mean < (opts.threshold || 8);
        var inGap = out.some(function (o) { return o.kind === 'gap' && f >= o.f && f < o.end; });
        if (black && !inGap) { if (!run) run = { kind: 'black', f: f, end: f + step, text: '' }; else run.end = f + step; }
        else if (run) { run.text = 'Black picture for ' + U.fmtTC(run.end - run.f, fps) + ' (a clip renders black here)'; finish(run); run = null; }
        if (onStatus && (f / step) % 10 === 0) onStatus(f / total, 'Scanning for black frames… ' + Math.floor(100 * f / total) + '%');
        f += step;
        return next();
      });
    }
    return next();
  };
  PQ.qcDialog = function () {
    var s = P.seq(); if (!s) return;
    var prefs = U.lsGet('qc', { minClip: 3, black: true, rate: 2 });
    var minClip = h('input', { type: 'number', min: 1, max: 30, value: prefs.minClip, style: { width: '70px' } });
    var black = h('input', { type: 'checkbox', checked: prefs.black !== false });
    var rate = h('select', [[1, '1 per second'], [2, '2 per second'], [5, '5 per second']].map(function (o) { return h('option', { value: o[0] }, o[1]); })); rate.value = String(prefs.rate);
    var status = h('div.muted', { style: { minHeight: '18px' } }), cancel = { v: false };
    minClip.addEventListener('keydown', function (e) { e.stopPropagation(); });
    var body = h('div', { style: { width: '500px', lineHeight: '1.5' } },
      h('div', { style: { marginBottom: '8px' } }, 'Checks the sequence for the classic delivery mistakes — gaps with no video, flash frames (clips a few frames long) and stretches that render black — and lists them as markers you can jump through.'),
      h('div.form-grid', h('label', 'Flash frames'), h('div.row', minClip, h('span.muted', 'frames or shorter')), h('label', 'Black frames'), h('label.cl-check', black, h('span', 'Render-scan the programme (slower)')), h('label', 'Scan rate'), rate), status);
    var d = C.ui.dialog({ title: 'Find Problem Frames', width: 540, body: body, onClose: function () { cancel.v = true; }, buttons: [{ label: 'Cancel' }, { label: 'Check', primary: true, id: 'go', action: function () {
      var o = { minClip: +minClip.value || 3, black: black.checked, rate: +rate.value, threshold: 8, cancel: cancel };
      U.lsSet('qc', { minClip: o.minClip, black: o.black, rate: o.rate });
      d.go.disabled = true;
      PQ.findProblems(o, function (k, msg) { status.textContent = msg; }).then(function (list) {
        if (cancel.v) return;
        d.close();
        if (!list.length) { C.toast('No problems found — no gaps, flash frames or black stretches'); return; }
        C.edit('QC Markers', function (s2) {
          s2.markers = s2.markers.filter(function (m) { return !m.qc; });
          list.forEach(function (p) { s2.markers.push({ id: U.uid('mk'), f: p.f, dur: Math.max(0, p.end - p.f), name: p.kind === 'gap' ? 'Gap' : p.kind === 'flash' ? 'Flash frame' : 'Black', color: '#e5534b', note: p.text, qc: true }); });
          s2.markers.sort(function (a, b) { return a.f - b.f; });
        });
        C.toast(list.length + ' problem' + (list.length === 1 ? '' : 's') + ' marked in red — see the Markers list', 4000);
        if (C.ui.showLeftTab) C.ui.showLeftTab('markers');
      }, function (e) { status.textContent = 'Check failed: ' + (e && e.message || e); d.go.disabled = false; });
      return false;
    } }] });
  };

  /* ---------- Export Grade as .cube ---------- */
  PQ.exportGrade = function () {
    var s = P.seq(), c = P.selectedClips().filter(function (x) { return x.kind === 'video'; })[0];
    if (!c) { C.toast('Select the video clip whose grade you want to export'); return; }
    var n = 33, cv = document.createElement('canvas'); cv.width = n * n; cv.height = n; // lattice: x = r + n*g, y = b
    var g = cv.getContext('2d'), img = g.createImageData(n * n, n), d = img.data;
    for (var b = 0; b < n; b++) for (var gg = 0; gg < n; gg++) for (var r = 0; r < n; r++) { var o = (b * n * n + gg * n + r) * 4; d[o] = r / (n - 1) * 255; d[o + 1] = gg / (n - 1) * 255; d[o + 2] = b / (n - 1) * 255; d[o + 3] = 255; }
    g.putImageData(img, 0, 0);
    var oc = document.createElement('canvas'), comp = C.createCompositor(oc, false);
    if (!comp.applyChain || !comp.upload) { C.toast('Grade export needs the WebGL renderer'); return; }
    var lf = Math.max(0, Math.min(c.dur - 1, C.Engine.frame - c.start));
    var fx = C.Scene.evalFx(c, lf, 'source').filter(function (e) { return (e.def.cat === 'Color' || e.def.id === 'lut' || /curves|levels|lift|hsl|match|temp|sat|expos|bright|duotone|sepia|thermal|hue|invert|posterize|bw|film/i.test(e.def.id)); });
    var col = C.Scene.evalColor(c, lf);
    var tex = comp.upload('__grade', cv, Date.now(), n * n, n), input = { tex: tex.tex, w: n * n, h: n };
    var res = comp.applyChain(input, fx, col, n * n, n, { time: 0, px: 1, masks: [], maskKey: 'grade', srcW: n * n, srcH: n });
    var gl = comp.gl; comp.bindTarget(res, null); var px = new Uint8Array(n * n * n * 4); gl.readPixels(0, 0, n * n, n, gl.RGBA, gl.UNSIGNED_BYTE, px);
    if (res !== input) comp.release(res); if (comp.destroy) comp.destroy();
    var lines = ['TITLE "' + (c.name || 'grade').replace(/"/g, '') + ' (Cutline)"', '# ' + (fx.length ? fx.map(function (e) { return e.def.name; }).join(', ') + ' + ' : '') + 'colour grade of ' + c.name, 'LUT_3D_SIZE ' + n, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
    for (var bb = 0; bb < n; bb++) for (var g2 = 0; g2 < n; g2++) for (var r2 = 0; r2 < n; r2++) { var q = (bb * n * n + g2 * n + r2) * 4; lines.push((px[q] / 255).toFixed(6) + ' ' + (px[q + 1] / 255).toFixed(6) + ' ' + (px[q + 2] / 255).toFixed(6)); }
    U.download(new Blob([lines.join('\n')], { type: 'text/plain' }), (c.name || 'grade').replace(/\.[^.]+$/, '') + '-grade.cube');
    C.toast('Exported the grade of ' + c.name + ' as a 33-point .cube — load it in Gesso (Filter ▸ LUT) or any grading tool');
  };

  C.CMD.reg('savePreset', 'Save Current Effects as Preset…', 'Clip', null, function () { PQ.savePreset(); });
  C.CMD.reg('managePresets', 'Manage Effect Presets…', 'Clip', null, function () { PQ.managePresets(); });
  C.CMD.reg('splitAtMarkers', 'Split at Markers', 'Sequence', null, function () { PQ.splitAtMarkers(); });
  C.CMD.reg('qcCheck', 'Find Problem Frames…', 'Sequence', null, function () { PQ.qcDialog(); });
  C.CMD.reg('exportGrade', 'Export Grade as .cube LUT', 'File', null, function () { PQ.exportGrade(); });
  function cmd(id) { return C.CMD.menuItem(id); }
  var pc = C.Menus.extra.Clip, ps = C.Menus.extra.Sequence, pf = C.Menus.extra.File;
  C.Menus.extra.Clip = function () {
    // the submenu is a function so it always lists the presets saved so far (menus are built once at start-up)
    var sub = function () {
      var pres = PQ.presets(), out = pres.map(function (p) { return { label: p.name, action: function () { PQ.applyPreset(p.id, false); } }; });
      if (pres.length) out.push('-');
      out.push(cmd('savePreset'), cmd('managePresets'));
      return out;
    };
    return (pc ? pc() : []).concat([{ label: 'Effect Presets', sub: sub }]);
  };
  C.Menus.extra.Sequence = function () { return (ps ? ps() : []).concat([cmd('splitAtMarkers'), cmd('qcCheck')]); };
  C.Menus.extra.File = function () { return (pf ? pf() : []).concat([cmd('exportGrade')]); };
})();
