/* Cutline — Multicam-lite: sync two or more angles (by audio cross-correlation, by their first marker, or by start),
   stack them on one track per angle in a new sequence, and cut between angles with the number keys (1–8) while
   playing. Every switch is an ordinary edit: the angle clips are split at the switch point and only the chosen
   angle stays enabled in that segment, so the result is a normal, fully editable sequence. */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, h = U.h, P = C.P, T = C.T;
  var MC = C.Multicam = {};
  var ENV_RATE = 50;

  // RMS envelope (ENV_RATE Hz, linear) of a media item's audio
  function envelope(m) {
    var base = C.Media.base(m), buf = C.Media.audioBuffer(base), rt = C.MRT[base.id] || {}, pk = rt.peaks;
    var dur = base.duration || 0, n = Math.ceil(dur * ENV_RATE), env = new Float32Array(n);
    if (buf) {
      var span = Math.round(buf.sampleRate / ENV_RATE), chs = []; for (var c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
      for (var i = 0; i < n; i++) { var s0 = i * span, s1 = Math.min(buf.length, s0 + span), sum = 0, k = 0; for (var ch = 0; ch < chs.length; ch++) { var d = chs[ch]; for (var j = s0; j < s1; j += 2) { sum += d[j] * d[j]; k++; } } env[i] = k ? Math.sqrt(sum / k) : 0; }
    } else if (pk && pk.rms && pk.rmsRate) {
      for (var q = 0; q < n; q++) { var r = Math.min(pk.rmsN - 1, Math.floor(q / ENV_RATE * pk.rmsRate)); env[q] = r >= 0 ? pk.rms[r] : 0; }
    } else if (pk) {
      for (var w = 0; w < n; w++) { var sp = C.Media.peakSpan(pk, w / ENV_RATE, (w + 1) / ENV_RATE); env[w] = Math.max(-sp.lo, sp.hi); }
    } else return null;
    // log-compress and remove the mean so quiet/loud recordings correlate on their shape
    var mean = 0; for (var a = 0; a < n; a++) { env[a] = Math.log10(1 + env[a] * 50); mean += env[a]; } mean /= Math.max(1, n);
    for (var b = 0; b < n; b++) env[b] -= mean;
    return env;
  }
  // lag (seconds) such that event at time t in `ref` happens at time t - lag in `other` (other starts `lag` later)
  MC.audioOffset = function (refM, otherM, maxLagSec) {
    var A = envelope(refM), B = envelope(otherM);
    if (!A || !B || A.length < ENV_RATE || B.length < ENV_RATE) return null;
    var shorter = Math.min(A.length, B.length), minOverlap = Math.max(5 * ENV_RATE, Math.round(shorter * 0.25));
    var maxLag = Math.min(Math.round((maxLagSec || 120) * ENV_RATE), Math.max(A.length, B.length) - minOverlap);
    var best = 0, bestV = -Infinity, second = -Infinity;
    for (var lag = -maxLag; lag <= maxLag; lag++) {
      // B[i] ~ A[i + lag]; normalised cross-correlation over the overlap, so short overlaps cannot win by chance
      var i0 = Math.max(0, -lag), i1 = Math.min(B.length, A.length - lag), sum = 0, sa = 0, sb = 0;
      if (i1 - i0 < minOverlap) continue;
      for (var i = i0; i < i1; i++) { var a = A[i + lag], b = B[i]; sum += a * b; sa += a * a; sb += b * b; }
      var v = sum / Math.sqrt(Math.max(1e-12, sa * sb));
      if (v > bestV) { second = bestV; bestV = v; best = lag; } else if (v > second) second = v;
    }
    return { lagSec: best / ENV_RATE, confidence: bestV > 0 ? U.clamp((bestV - second) / Math.max(1e-9, Math.abs(bestV)) * 4 + bestV * 0.5, 0, 1) : 0 };
  };

  // Build the multicam sequence from library items. opts: {sync:'audio'|'marker'|'start', name}
  MC.create = function (ids, opts) {
    var items = ids.map(function (id) { return P.media(id); }).filter(function (m) { return m && (m.type === 'video' || m.type === 'audio'); });
    if (items.length < 2) { C.toast('Select at least two clips for a multicam sequence'); return null; }
    var ref = items[0], offsets = [0], notes = [];
    items.slice(1).forEach(function (m, i) {
      var off = 0;
      if (opts.sync === 'audio') {
        if (!P.mediaHasAudio(ref) || !P.mediaHasAudio(m)) { notes.push(m.name + ': no audio to sync, placed at start'); }
        else { var r = MC.audioOffset(ref, m, opts.maxLag || 120); if (r) { off = r.lagSec; notes.push(m.name + ': ' + (off >= 0 ? '+' : '') + off.toFixed(2) + ' s (confidence ' + Math.round(r.confidence * 100) + '%)'); } else notes.push(m.name + ': audio not analysed yet, placed at start'); }
      } else if (opts.sync === 'marker') {
        var mk0 = (C.Media.base(ref).markers || [])[0], mk1 = (C.Media.base(m).markers || [])[0];
        if (mk0 && mk1) { off = mk0.t - mk1.t; notes.push(m.name + ': aligned by markers (' + (off >= 0 ? '+' : '') + off.toFixed(2) + ' s)'); } else notes.push(m.name + ': needs a marker on both clips, placed at start');
      }
      offsets.push(off);
      void i;
    });
    var seqId = null;
    C.edit('Create Multicam Sequence', function (s, prj) {
      var fps = ref.fps || (s ? s.fps : 30), n = items.length;
      var ns = P.newSequence({ w: ref.w || 1920, h: ref.h || 1080, fps: fps, vtracks: n, atracks: n });
      ns.name = opts.name || ('Multicam ' + prj.sequences.filter(function (q) { return q.multicam; }).length + 1);
      var vts = P.vtracks(ns), ats = P.atracks(ns);
      // timeline start of each angle: angle k's source 0 sits at offsets[k] (relative to the reference); shift so the earliest is 0
      var minOff = Math.min.apply(null, offsets);
      ns.multicam = { angles: [], active: 1 };
      items.forEach(function (m, k) {
        var startF = Math.round((offsets[k] - minOff) * fps);
        vts[k].name = 'Angle ' + (k + 1) + ' · ' + m.name.replace(/\.[^.]+$/, ''); ats[k].name = vts[k].name;
        if (k > 0) { ats[k].mute = true; }
        T.placeMedia(ns, m, startF, P.mediaHasVideo(m) ? vts[k].id : null, P.mediaHasAudio(m) ? ats[k].id : null, 'overwrite');
        ns.multicam.angles.push({ v: vts[k].id, a: ats[k].id, name: m.name, mediaId: m.id });
      });
      // only angle 1 is visible to start with
      ns.clips.forEach(function (c) { if (c.kind === 'video' && c.trackId !== vts[0].id) c.enabled = false; });
      prj.sequences.push(ns); prj.activeSeq = ns.id; seqId = ns.id;
    });
    C.A.deselect(); C.Engine.setFrame(0); C.bus.emit('sequence'); C.bus.emit('changed', { seq: true }); C.bus.emit('tracks');
    if (C.TL) setTimeout(C.TL.zoomFit, 50);
    C.toast('Multicam sequence created — press 1–' + items.length + ' while playing to cut between angles' + (notes.length ? '. ' + notes.join('; ') : ''), 6000);
    return seqId;
  };

  // Switch to angle i (1-based) at the playhead: splits the angle clips there and enables only the chosen one until the next cut
  MC.switchAngle = function (i) {
    var s = P.seq(); if (!s || !s.multicam) return false;
    var ang = s.multicam.angles; if (i < 1 || i > ang.length) return false;
    var f = C.Engine.playing ? Math.round(C.Engine.currentFrame()) : C.Engine.frame;
    var vids = ang.map(function (a) { return a.v; });
    C.edit('Angle ' + i, function (s2) {
      s2.multicam.active = i;
      // split every angle clip spanning f (video only; audio stays continuous)
      var spanning = s2.clips.filter(function (c) { return c.kind === 'video' && vids.indexOf(c.trackId) >= 0 && f > c.start && f < c.start + c.dur; });
      spanning.forEach(function (c) { var r = T.split(s2, c, f); if (r) r.link = null; });
      // the segment [f, nextCut): the first cut on any angle track after f
      var next = Infinity;
      s2.clips.forEach(function (c) { if (c.kind === 'video' && vids.indexOf(c.trackId) >= 0) { if (c.start > f) next = Math.min(next, c.start); if (c.start + c.dur > f) next = Math.min(next, c.start + c.dur); } });
      s2.clips.forEach(function (c) {
        if (c.kind !== 'video' || vids.indexOf(c.trackId) < 0) return;
        if (c.start >= f && c.start < next) c.enabled = c.trackId === vids[i - 1];
      });
      // tidy: merge back-to-back pieces of the same source that ended up with the same state
      mergeRuns(s2, vids);
    });
    C.toast('Angle ' + i + ': ' + ang[i - 1].name, 1200);
    return true;
  };
  function mergeRuns(s, vids) {
    vids.forEach(function (tid) {
      var list = P.clipsOn(s, tid);
      for (var k = list.length - 2; k >= 0; k--) {
        var a = list[k], b = list[k + 1];
        if (a.mediaId !== b.mediaId || a.start + a.dur !== b.start || (a.enabled === false) !== (b.enabled === false) || a.speed !== b.speed || a.reverse !== b.reverse || T.hasRamp(a) || T.hasRamp(b) || a.freeze != null || b.freeze != null) continue;
        var ain = P.sourceSec(s, a, a.start + a.dur), bin = P.sourceSec(s, b, b.start);
        if (Math.abs(ain - bin) > 0.6 / s.fps) continue;
        if (JSON.stringify(a.fx) !== JSON.stringify(b.fx) || JSON.stringify(a.tf) !== JSON.stringify(b.tf) || (a.kf && Object.keys(a.kf).length) || (b.kf && Object.keys(b.kf).length)) continue;
        a.dur += b.dur; T.removeClip(s, b.id); list.splice(k + 1, 1);
      }
    });
  }

  /* ---------- Grid view: every angle at once in the Program monitor, the live angle outlined ---------- */
  MC.gridOn = false;
  MC.grid = function (seq) { var n = seq.multicam.angles.length, cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4, rows = Math.ceil(n / cols); return { n: n, cols: cols, rows: rows }; };
  // scene that shows all angles tiled (used by the engine instead of Scene.build while the grid view is on)
  MC.gridScene = function (seq, frame) {
    var g = MC.grid(seq), scene = { w: seq.w, h: seq.h, bg: '#101010', layers: [], frame: frame, fps: seq.fps, time: frame / seq.fps, seq: seq, multiview: true };
    var cw = seq.w / g.cols, ch = seq.h / g.rows;
    seq.multicam.angles.forEach(function (a, k) {
      var clip = seq.clips.filter(function (c) { return c.kind === 'video' && c.trackId === a.v && frame >= c.start && frame < c.start + c.dur; })[0];
      if (!clip) return;
      var L = C.Scene.clipLayer(seq, clip, frame, { captions: false });
      var col = k % g.cols, row = Math.floor(k / g.cols), cx = (col + 0.5) * cw, cy = (row + 0.5) * ch;
      // place the angle's picture in its cell: scale its transform down by the cell ratio and move its anchor to the cell centre
      var tf = Object.assign({}, L.tf), r = 1 / Math.max(g.cols, g.rows);
      tf.x = cx + (tf.x - seq.w / 2) * r; tf.y = cy + (tf.y - seq.h / 2) * r; tf.scale *= r; tf.sw *= r; tf.sh *= r; tf.op = 100;
      L.tf = tf; L.fx = []; L.lfx = []; L.col = null; L.masks = []; L.blend = 'normal'; L.offline = L.offline;
      scene.layers.push(L);
    });
    return scene;
  };
  MC.toggleGrid = function () {
    var s = P.seq(); if (!s || !s.multicam) { C.toast('Grid view is for multicam sequences (Sequence › New Multicam Sequence…)'); return; }
    MC.gridOn = !MC.gridOn; C.Engine.requestRender(); C.bus.emit('state'); if (C.Program.drawOverlay) C.Program.drawOverlay();
    C.toast(MC.gridOn ? 'Multicam grid: all angles, live angle outlined · 1–' + s.multicam.angles.length + ' switch' : 'Program view', 1500);
  };
  // overlay for the grid: cell borders, angle numbers, live angle highlighted
  MC.drawGridOverlay = function (g, seq, W, H) {
    if (!MC.gridOn || !seq.multicam) return false;
    var gr = MC.grid(seq), cw = W / gr.cols, ch = H / gr.rows;
    seq.multicam.angles.forEach(function (a, k) {
      var x = (k % gr.cols) * cw, y = Math.floor(k / gr.cols) * ch, live = seq.multicam.active === k + 1;
      g.strokeStyle = live ? '#f0913a' : 'rgba(255,255,255,.25)'; g.lineWidth = live ? 3 : 1; g.strokeRect(x + (live ? 1.5 : 0.5), y + (live ? 1.5 : 0.5), cw - (live ? 3 : 1), ch - (live ? 3 : 1));
      g.fillStyle = live ? '#f0913a' : 'rgba(20,18,16,.75)'; g.fillRect(x + 6, y + 6, 22 + (a.name.length > 0 ? Math.min(140, a.name.length * 6.5) : 0), 18);
      g.fillStyle = live ? '#1c1208' : '#f2ebe3'; g.font = 'bold 11px Segoe UI, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText((k + 1) + '  ' + a.name.replace(/\.[^.]+$/, '').slice(0, 22), x + 10, y + 15);
    });
    return true;
  };
  // click on a cell switches to that angle
  MC.gridHit = function (seq, fx, fy) { var gr = MC.grid(seq), k = Math.floor(fy * gr.rows) * gr.cols + Math.floor(fx * gr.cols); return k < gr.n ? k + 1 : 0; };

  /* ---------- Flatten: keep the chosen angle pieces on one video track, drop the rest ---------- */
  MC.flatten = function () {
    var s = P.seq(); if (!s || !s.multicam) { C.toast('The current sequence is not a multicam sequence'); return; }
    var removed = 0, kept = 0;
    C.edit('Flatten Multicam', function (s2) {
      var ang = s2.multicam.angles, vids = ang.map(function (a) { return a.v; }), v1 = vids[0];
      // drop every disabled angle piece, move the live pieces onto the first angle track
      s2.clips.slice().forEach(function (c) {
        if (c.kind !== 'video' || vids.indexOf(c.trackId) < 0) return;
        if (c.enabled === false) { T.removeClip(s2, c.id); removed++; return; }
        c.trackId = v1; c.enabled = true; kept++;
      });
      // drop the now-empty angle video tracks (except the first) and muted angle audio tracks that carry nothing audible
      var dropTracks = vids.slice(1).filter(function (tid) { return !s2.clips.some(function (c) { return c.trackId === tid; }); });
      ang.forEach(function (a, k) { if (k > 0) { var at = P.track(s2, a.a); if (at && at.mute) { s2.clips = s2.clips.filter(function (c) { return c.trackId !== a.a; }); dropTracks.push(a.a); } } });
      s2.tracks = s2.tracks.filter(function (t) { return dropTracks.indexOf(t.id) < 0; });
      var vt = P.track(s2, v1); if (vt) vt.name = '';
      s2.transitions = s2.transitions.filter(function (tr) { return dropTracks.indexOf(tr.trackId) < 0; });
      delete s2.multicam;
    });
    MC.gridOn = false;
    C.bus.emit('tracks'); C.bus.emit('sequence');
    C.toast('Flattened: ' + kept + ' angle piece' + (kept === 1 ? '' : 's') + ' on V1, ' + removed + ' removed. It is a normal sequence now.', 4000);
  };
  C.CMD.reg('mcGrid', 'Multicam Grid View', 'View', 'Shift+0', function () { MC.toggleGrid(); }, { checked: function () { return !!MC.gridOn; } });
  C.CMD.reg('mcFlatten', 'Flatten Multicam Sequence', 'Sequence', null, function () { MC.flatten(); });
  var prevSeqMenu = C.Menus.extra.Sequence, prevViewMenu = C.Menus.extra.View;
  function cmd(id) { return C.CMD.menuItem(id); }
  C.Menus.extra.Sequence = function () { return (prevSeqMenu ? prevSeqMenu() : []).concat([cmd('mcFlatten')]); };
  C.Menus.extra.View = function () { return (prevViewMenu ? prevViewMenu() : []).concat([{ label: 'Multicam Grid View', kbd: C.CMD.keyLabel('mcGrid'), checked: function () { return MC.gridOn; }, action: function () { MC.toggleGrid(); } }]); };

  MC.dialog = function (ids) {
    ids = ids || (C.Bin ? C.Bin.sel.filter(function (i) { var m = P.media(i); return m && (m.type === 'video' || m.type === 'audio'); }) : []);
    if (ids.length < 2) { C.toast('Select two or more clips in the Library first'); return; }
    var sync = h('select'); [['audio', 'Audio waveform (cross-correlation)'], ['marker', 'First marker on each clip'], ['start', 'Clip starts together']].forEach(function (o) { sync.appendChild(h('option', { value: o[0] }, o[1])); });
    var name = h('input', { type: 'text', value: 'Multicam ' + (C.state.project.sequences.filter(function (q) { return q.multicam; }).length + 1), style: { width: '100%' } });
    name.addEventListener('keydown', function (e) { e.stopPropagation(); });
    var maxLag = h('input', { type: 'number', value: 120, min: 1, max: 3600, style: { width: '80px' } });
    var list = h('ol', { style: { margin: '4px 0 8px 18px', lineHeight: 1.6 } });
    ids.forEach(function (id) { var m = P.media(id); list.appendChild(h('li', m.name + (P.mediaHasAudio(m) ? '' : '  (no audio)'))); });
    C.ui.dialog({ title: 'New Multicam Sequence', width: 520, body: h('div', { style: { lineHeight: 1.5 } },
      h('div.muted', 'Angles are stacked on V1…V' + ids.length + ' (the first is the reference and the audible audio). While playing, press 1–' + Math.min(8, ids.length) + ' to cut to that angle.'),
      list,
      h('div.form-grid', h('label', 'Name'), name, h('label', 'Sync by'), sync, h('label', 'Max offset'), h('div.row', maxLag, h('span.muted', 'seconds searched for audio sync')))),
      buttons: [{ label: 'Cancel' }, { label: 'Create', primary: true, action: function () { MC.create(ids, { sync: sync.value, name: name.value.trim() || null, maxLag: +maxLag.value || 120 }); } }] });
  };
})();
