/* Cutline — colour UI additions: LUT section in the Color panel (.cube import, intensity), neutral-pick white
   balance, Match Color dialog, false-colour scope. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, h = U.h, P = C.P, CP = C.ColorPanel, A = C.A;

  /* ---------- LUT section ---------- */
  function setGrade(clipId, label, fn) { C.edit(label, function (s2) { var cc = P.clip(s2, clipId); if (!cc) return; cc.col = cc.col || P.defaultColor(); fn(cc.col, cc, s2); }); }
  C.LUT.importFiles = function (files, clipId) {
    var added = [], errs = [];
    var jobs = Array.prototype.map.call(files, function (f) {
      return f.text().then(function (txt) { added.push({ name: f.name, parsed: C.LUT.parseCube(txt) }); }, function (e) { errs.push(f.name + ': ' + e.message); }).catch(function (e) { errs.push(f.name + ': ' + (e && e.message || e)); });
    });
    return Promise.all(jobs).then(function () {
      var recs = [];
      if (added.length) C.edit('Import LUT', function (s2, prj) {
        added.forEach(function (a) { recs.push(C.LUT.add(prj, a.name, a.parsed)); });
        if (clipId) { var cc = P.clip(s2, clipId); if (cc && cc.kind === 'video') { cc.col = cc.col || P.defaultColor(); cc.col.lut = recs[0].id; if (cc.col.lutAmt == null) cc.col.lutAmt = 100; } }
      });
      if (errs.length) C.ui.alert('Some LUTs could not be imported', errs.join('\n'));
      if (recs.length) C.toast('Imported ' + recs.length + ' LUT' + (recs.length > 1 ? 's' : '') + (clipId ? ' and applied to the clip' : ''));
      return recs;
    });
  };
  C.LUT.pickFiles = function (clipId) {
    var inp = h('input', { type: 'file', accept: '.cube,text/plain', multiple: true, style: { display: 'none' } });
    inp.addEventListener('change', function () { if (inp.files.length) C.LUT.importFiles(inp.files, clipId); inp.remove(); });
    document.body.appendChild(inp); inp.click();
  };
  CP.extra.push(function (c, col, ctx, f) {
    var sec = C.ui.section('LUT', { key: 'col-lut' }), luts = C.LUT.list();
    var opts = [['', 'None']].concat(luts.map(function (l) { return [l.id, l.name + ' (' + l.size + '³)']; }));
    var selRow = C.ui.selectField('LUT', opts, col.lut || '', function (v) { setGrade(c.id, v ? 'Apply LUT' : 'Remove LUT', function (g) { g.lut = v || null; if (g.lutAmt == null) g.lutAmt = 100; }); });
    sec.body.appendChild(selRow);
    sec.body.appendChild(f('lutAmt', 'Intensity', 0, 100, 1, 100, '%'));
    var rec = col.lut ? C.LUT.get(col.lut) : null;
    if (rec) { // preview strip: a grey ramp through the LUT
      var cv = h('canvas.lut-strip'); cv.width = 128; cv.height = 10; var g = cv.getContext('2d');
      for (var x = 0; x < 128; x++) { var v = x / 127, o = C.LUT.sample(rec, v, v, v); g.fillStyle = 'rgb(' + Math.round(o[0] * 255) + ',' + Math.round(o[1] * 255) + ',' + Math.round(o[2] * 255) + ')'; g.fillRect(x, 0, 1, 10); }
      sec.body.appendChild(h('div.row', { style: { gap: '8px', alignItems: 'center', margin: '2px 0 4px 24px' } }, cv, h('span.muted', { style: { fontSize: '11px' } }, 'grey ramp through ' + rec.name)));
    }
    sec.body.appendChild(h('div.row', { style: { gap: '6px', marginTop: '4px' } },
      h('button.btn.sm', { title: 'Import one or more .cube 3D LUTs into the project and apply the first to this clip', on: { click: function () { C.LUT.pickFiles(c.id); } } }, 'Import .cube…'),
      luts.length ? h('button.btn.sm', { title: 'Remove LUTs from the project', on: { click: function () { manageLuts(); } } }, 'Manage…') : null,
      h('span.muted', { style: { fontSize: '11px', alignSelf: 'center' } }, luts.length ? luts.length + ' in project' : 'LUTs are saved inside the project file')));
    CP.scroll.appendChild(sec);
  });
  function manageLuts() {
    var luts = C.LUT.list(), list = h('div', { style: { minWidth: '360px' } });
    luts.forEach(function (l) {
      var used = 0; (C.state.project.sequences || []).forEach(function (s) { s.clips.forEach(function (c) { if (c.col && c.col.lut === l.id) used++; }); });
      list.appendChild(h('div.row', { style: { justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--line-soft)' } }, h('span', l.name + ' · ' + l.size + '³ · used by ' + used + ' clip' + (used === 1 ? '' : 's')),
        h('button.btn.sm', { on: { click: function () { C.edit('Delete LUT', function (s2, prj) { prj.luts = (prj.luts || []).filter(function (x) { return x.id !== l.id; }); prj.sequences.forEach(function (s) { s.clips.forEach(function (c) { if (c.col && c.col.lut === l.id) c.col.lut = null; }); }); }); d.close(); CP.sig = null; CP.refresh(); } } }, 'Delete')));
    });
    var d = C.ui.dialog({ title: 'Project LUTs', body: list, buttons: [{ label: 'Close', primary: true }] });
  }

  /* ---------- white balance by neutral pick ---------- */
  CP.pickNeutral = function () {
    var c = CP.clip(); if (!c) { C.toast('Select a video clip first'); return; }
    C.Program.pickColor(function (rgb) {
      if (!rgb) { C.toast('Could not read the picture'); return; }
      var r = rgb[0], g = rgb[1], b = rgb[2];
      if (r + g + b < 0.06) { C.toast('That point is too dark to balance on — pick a grey or white area'); return; }
      if (r + g + b > 2.94) { C.toast('That point is clipped white — pick a lighter grey instead'); return; }
      // the grade multiplies r by (1+0.25t)(1+0.07k), g by (1−0.2k), b by (1−0.25t)(1+0.07k): solve for the t,k that make the pick neutral
      var t = (b - r) / Math.max(0.02, 0.25 * (r + b)), K = g / Math.max(0.02, r * (1 + 0.25 * t)), k = (K - 1) / (0.07 + 0.2 * K);
      t = U.clamp(t, -1, 1); k = U.clamp(k, -1, 1);
      var lf = CP.lf();
      C.edit('Auto White Balance', function (s2) {
        var cc = P.clip(s2, c.id); if (!cc) return; cc.col = cc.col || P.defaultColor();
        var t0 = C.KF.value(cc, 'col.temp', lf) || 0, k0 = C.KF.value(cc, 'col.tint', lf) || 0;
        C.KF.setAt(cc, 'col.temp', lf, Math.round(U.clamp(t0 + t * 100, -100, 100))); C.KF.setAt(cc, 'col.tint', lf, Math.round(U.clamp(k0 + k * 100, -100, 100)));
      });
      C.toast('White balance set from the picked neutral (temperature ' + (t >= 0 ? '+' : '') + Math.round(t * 100) + ', tint ' + (k >= 0 ? '+' : '') + Math.round(k * 100) + ')');
    }, 'Click something neutral (grey or white) in the Program monitor');
  };

  /* ---------- Match Color ---------- */
  // render one frame of a clip alone at 96×54 (its own grade and effects, without an existing Color Match) and return stats
  function clipStats(seq, clip, lf) {
    var cv = document.createElement('canvas'), comp = C.createCompositor(cv), prov = new C.SourceProvider('match'); prov.useDecoders = !!window.VideoDecoder;
    var f = clip.start + U.clamp(lf == null ? Math.floor(clip.dur / 2) : lf, 0, clip.dur - 1);
    var tmp = U.clone(seq); tmp.clips = tmp.clips.filter(function (c) { return c.id === clip.id; }).map(function (c) { c.fx = (c.fx || []).filter(function (e) { return e.type !== 'colormatch'; }); c.enabled = true; return c; }); tmp.transitions = []; tmp.captions = [];
    tmp.tracks.forEach(function (t) { t.hidden = false; });
    var scene = C.Scene.build(tmp, f, { captions: false });
    return prov.prepare(scene).then(function () {
      comp.render(scene, 96, 54, prov, { captions: false });
      var px = comp.readFull();
      prov.dropAll(); if (comp.destroy) comp.destroy();
      return C.LUT.stats(px.data, px.w, px.h);
    });
  }
  A.matchColorDialog = function () {
    var s = P.seq(), sel = P.selectedClips().filter(function (c) { return c.kind === 'video'; });
    if (sel.length < 2) { C.toast('Select two video clips: the one to fix and the reference (Ctrl+click)'); return; }
    var order = sel.slice(0, 2), status = h('div.muted', { style: { minHeight: '18px' } });
    var tgtSel = h('select'); order.forEach(function (c, i) { tgtSel.appendChild(h('option', { value: c.id }, c.name)); });
    var sw = h('div.row', { style: { gap: '10px', alignItems: 'center', margin: '8px 0' } });
    function refSel() { return order.filter(function (c) { return c.id !== tgtSel.value; })[0]; }
    var body = h('div', { style: { width: '480px', lineHeight: 1.5 } },
      h('div.muted', { style: { marginBottom: '8px' } }, 'Measures the colour statistics of both clips at their middle frame and adds a Color Match effect to the clip being fixed, so its brightness, contrast and colour cast follow the reference. Fine-tune with the effect\'s Amount afterwards.'),
      h('div.form-grid', h('label', 'Fix this clip'), tgtSel), sw, status);
    var d = C.ui.dialog({ title: 'Match Color', width: 540, body: body, buttons: [{ label: 'Cancel' }, { label: 'Match', primary: true, id: 'go', action: function () {
      d.go.disabled = true; status.textContent = 'Analysing…';
      var tgt = P.clip(s, tgtSel.value), ref = refSel();
      Promise.all([clipStats(s, tgt), clipStats(s, ref)]).then(function (st) {
        var params = C.LUT.matchParams(st[0], st[1]);
        C.edit('Match Color', function (s2) {
          var cc = P.clip(s2, tgt.id); if (!cc) return;
          var e = (cc.fx || []).filter(function (x) { return x.type === 'colormatch'; })[0];
          if (!e) { e = C.FX.newInstance('colormatch'); cc.fx.push(e); }
          Object.assign(e.p, params); e.on = true;
        });
        d.close();
        C.toast('Matched ' + tgt.name + ' to ' + ref.name + ' (gain ' + [params.gr, params.gg, params.gb].map(function (v) { return v.toFixed(2); }).join('/') + ')', 4000);
      }, function (e) { status.textContent = 'Could not analyse: ' + (e && e.message || e); d.go.disabled = false; });
      return false;
    } }] });
    function drawSw() { U.clear(sw); sw.appendChild(h('span.muted', 'Reference: ')); sw.appendChild(h('b', refSel().name)); }
    tgtSel.addEventListener('change', drawSw); drawSw();
  };
  C.CMD.reg('matchColor', 'Match Color to Reference…', 'Clip', null, function () { A.matchColorDialog(); });
  var prevClip = C.Menus.extra.Clip;
  C.Menus.extra.Clip = function () { var c = C.CMD.byId.matchColor; return (prevClip ? prevClip() : []).concat([{ label: c.name, action: function () { C.CMD.run('matchColor'); }, disabled: function () { return !C.state.project; } }]); };

  /* ---------- false colour scope ---------- */
  CP.drawFalse = function (g, d, CW, CH, dpr) {
    var px = d.data, w = d.w, hh = d.h, legendW = Math.round(96 * dpr), picW = CW - legendW, sc = Math.min(picW / w, CH / hh), pw = Math.round(w * sc), ph = Math.round(hh * sc), ox = Math.round((picW - pw) / 2), oy = Math.round((CH - ph) / 2);
    var img = g.createImageData(pw, ph), o = img.data;
    for (var y = 0; y < ph; y++) for (var x = 0; x < pw; x++) {
      var sx = Math.min(w - 1, Math.floor(x / sc)), sy = Math.min(hh - 1, Math.floor(y / sc)), i = (sy * w + sx) * 4;
      var l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255, c = C.LUT.falseColor(l), k = (y * pw + x) * 4;
      o[k] = c[0]; o[k + 1] = c[1]; o[k + 2] = c[2]; o[k + 3] = 255;
    }
    g.putImageData(img, ox, oy);
    // legend
    var bands = C.LUT.FALSE_BANDS.slice().reverse(), rowH = Math.min(16 * dpr, CH / (bands.length + 1)), x0 = CW - legendW + 4 * dpr;
    g.font = (9 * dpr) + 'px Segoe UI, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
    bands.forEach(function (b, i) {
      var y = 4 * dpr + i * rowH;
      g.fillStyle = 'rgb(' + b[2].join(',') + ')'; g.fillRect(x0, y, 10 * dpr, rowH - 2 * dpr);
      g.fillStyle = 'rgba(242,235,227,.85)'; g.fillText(Math.round(b[0] * 100) + (b[1] <= 1 ? '–' + Math.round(b[1] * 100) : '+') + ' ' + b[3], x0 + 13 * dpr, y + rowH / 2 - dpr);
    });
    g.fillStyle = 'rgba(242,235,227,.5)'; g.fillText('grey = other', x0, 4 * dpr + bands.length * rowH + rowH / 2 - dpr);
  };
})();
