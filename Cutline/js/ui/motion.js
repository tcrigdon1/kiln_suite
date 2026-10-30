/* Cutline — Steady Cam (stabilisation-lite) dialog and Inspector status. Analysis lives in render/tracker.js. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, h = U.h, P = C.P, A = C.A;

  A.steadyCamDialog = function () {
    var s = P.seq(), clips = P.selectedClips().filter(function (c) { return c.kind === 'video' && (P.media(c.mediaId) || {}).type === 'video'; });
    if (!clips.length) { C.toast('Select a video clip to stabilise'); return; }
    var prefs = U.lsGet('steadycam', { smooth: 20, maxZoom: 125 });
    var smooth = h('input', { type: 'range', min: 3, max: 90, step: 1, value: prefs.smooth, style: { width: '180px' } }), smoothV = h('span.muted', prefs.smooth + ' frames');
    var zoom = h('select'); [[110, 'up to 110% (subtle)'], [125, 'up to 125%'], [140, 'up to 140%'], [160, 'up to 160% (handheld walking)']].forEach(function (o) { zoom.appendChild(h('option', { value: o[0] }, o[1])); }); zoom.value = String(prefs.maxZoom);
    smooth.addEventListener('input', function () { smoothV.textContent = smooth.value + ' frames'; });
    var status = h('div.muted', { style: { minHeight: '18px' } }), bar = h('div.cl-progress-fill'), prog = h('div.cl-progress', { style: { display: 'none' } }, bar);
    var already = clips.filter(function (c) { return c.stab; }).length;
    var body = h('div', { style: { width: '520px', lineHeight: 1.5 } },
      h('div.muted', { style: { marginBottom: '8px' } }, 'Measures the camera\'s shake frame by frame, smooths its path and animates Position to cancel the difference. The clip is zoomed just enough to hide the moving borders (never more than the limit below). The result is ordinary Position / Scale keyframes, so it renders in export and can be undone.' + (already ? ' Re-running replaces the previous Steady Cam keyframes.' : '')),
      h('div.form-grid', h('label', 'Smoothing'), h('div.row', smooth, smoothV), h('label', 'Zoom limit'), zoom),
      prog, status);
    var d = C.ui.dialog({ title: 'Steady Cam' + (clips.length > 1 ? ' — ' + clips.length + ' clips' : ' — ' + clips[0].name), width: 580, body: body, buttons: [{ label: 'Cancel', action: function () { cancel.v = true; } }, { label: 'Stabilise', primary: true, id: 'go', action: function () {
      var o = { smooth: +smooth.value, maxZoom: +zoom.value, cancel: cancel };
      U.lsSet('steadycam', { smooth: o.smooth, maxZoom: o.maxZoom });
      d.go.disabled = true; prog.style.display = '';
      var ids = clips.map(function (c) { return c.id; }), chain = Promise.resolve(), done = [];
      ids.forEach(function (id, idx) {
        chain = chain.then(function () {
          var cc = P.clip(P.seq(), id); if (!cc || cancel.v) return;
          if (cc.stab) C.edit('Remove Steady Cam', function (s2) { var x = P.clip(s2, id); if (x) C.Tracker.removeSteadyCam(x); });
          cc = P.clip(P.seq(), id);
          o.onProgress = function (p) { bar.style.width = (p * 100).toFixed(1) + '%'; status.textContent = 'Analysing ' + cc.name + (ids.length > 1 ? ' (' + (idx + 1) + '/' + ids.length + ')' : '') + ' — ' + Math.round(p * 100) + '%'; };
          return C.Tracker.steadyCam(P.seq(), cc, o).then(function (r) { done.push(r); });
        });
      });
      chain.then(function () {
        d.close();
        if (cancel.v) { C.toast('Steady Cam cancelled'); return; }
        var z = done.length ? Math.max.apply(null, done.map(function (r) { return r.zoom; })) : 1;
        C.toast('Stabilised ' + done.length + ' clip' + (done.length > 1 ? 's' : '') + ' · zoom ' + Math.round(z * 100) + '%', 4000);
      }, function (e) { status.textContent = 'Could not analyse: ' + (e && e.message || e); d.go.disabled = false; prog.style.display = 'none'; });
      return false;
    } }] });
    var cancel = { v: false };
  };
  A.removeSteadyCam = function () {
    var clips = P.selectedClips().filter(function (c) { return c.stab; });
    if (!clips.length) { C.toast('The selected clips have no Steady Cam applied'); return; }
    C.edit('Remove Steady Cam', function (s2) { clips.forEach(function (c) { var x = P.clip(s2, c.id); if (x) C.Tracker.removeSteadyCam(x); }); });
  };
  C.CMD.reg('steadyCam', 'Steady Cam (Stabilise)…', 'Clip', null, function () { A.steadyCamDialog(); });
  C.CMD.reg('steadyCamOff', 'Remove Steady Cam', 'Clip', null, function () { A.removeSteadyCam(); });
  var prevClip = C.Menus.extra.Clip;
  C.Menus.extra.Clip = function () {
    var c = C.CMD.byId;
    function cmd(id) { return C.CMD.menuItem(id); }
    return (prevClip ? prevClip() : []).concat([cmd('steadyCam'), cmd('steadyCamOff')]);
  };
  // Inspector: status line in the Motion section's neighbourhood
  C.Inspector.extra.push(function (s, c) {
    if (!c || !c.stab || c.kind !== 'video') return;
    var sec = C.ui.section('Steady Cam', { key: 'stab' });
    sec.body.appendChild(h('div.muted', { style: { fontSize: '11px', lineHeight: 1.5 } }, 'Stabilised: smoothing ' + c.stab.smooth + ' frames, zoom ' + c.stab.zoom + '% (limit ' + c.stab.maxZoom + '%), ' + c.stab.samples + ' samples' + (c.stab.step > 1 ? ' every ' + c.stab.step + ' frames' : '') + '. Position / Scale keyframes above are the correction.'));
    sec.body.appendChild(h('div.row', { style: { gap: '6px', marginTop: '4px' } },
      h('button.btn.sm', { on: { click: function () { A.steadyCamDialog(); } } }, 'Re-analyse…'),
      h('button.btn.sm', { on: { click: function () { A.removeSteadyCam(); } } }, 'Remove')));
    C.Inspector.scroll.appendChild(sec);
  });
})();
