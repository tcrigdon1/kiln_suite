/* Cutline — interchange: CMX 3600 EDL and FCP 7 XML (xmeml) export of the active sequence, marker import
   (Cutline CSV, YouTube chapter lists, plain "timecode name" lines), and sync helpers (align a clip's marker
   to the playhead). */
(function () {
  'use strict';
  var C = window.Cutline, U = C.util, P = C.P, T = C.T;
  var IX = C.Interchange = {};

  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function tc(frames, fps) { // non-drop hh:mm:ss:ff at the sequence's nominal rate
    var r = Math.round(fps), f = Math.max(0, Math.round(frames)), ff = f % r, s = Math.floor(f / r);
    return pad(Math.floor(s / 3600), 2) + ':' + pad(Math.floor(s / 60) % 60, 2) + ':' + pad(s % 60, 2) + ':' + pad(ff, 2);
  }
  function reelOf(name, used) { // 8-char reel names, unique per media file
    var base = (name || 'AX').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8) || 'AX';
    var r = base, k = 2; while (used[r] && used[r] !== name) { r = base.slice(0, 8 - String(k).length) + k; k++; }
    used[r] = name; return r;
  }
  // events in timeline order: one per clip, per track kind
  function events(s) {
    var used = {}, out = [];
    var vt = s.tracks.filter(function (t) { return t.kind === 'video'; }), at = s.tracks.filter(function (t) { return t.kind === 'audio'; });
    var order = {}; s.tracks.forEach(function (t, i) { order[t.id] = (t.kind === 'video' ? 0 : 1000) + i; });
    s.clips.slice().sort(function (a, b) { return a.start - b.start || order[a.trackId] - order[b.trackId]; }).forEach(function (c) {
      if (c.enabled === false) return;
      var m = c.mediaId ? P.media(c.mediaId) : null, base = m ? C.Media.base(m) : null;
      var name = base ? base.name : c.name, tr = P.track(s, c.trackId);
      var srcIn = Math.round(c.in * s.fps), srcSpan = Math.round(T.srcSpan(s, c, 0, c.dur) * s.fps);
      out.push({ clip: c, media: base, name: name, reel: base ? reelOf(name, used) : 'BL', kind: c.kind, trackIndex: (c.kind === 'video' ? vt : at).indexOf(tr) + 1,
        recIn: c.start, recOut: c.start + c.dur, srcIn: srcIn, srcOut: srcIn + srcSpan, speed: c.speed, gen: !!(base && base.type === 'gen') });
    });
    return out;
  }
  IX.edl = function (s) {
    var lines = ['TITLE: ' + (s.name || 'Sequence'), 'FCM: NON-DROP FRAME', ''];
    var n = 1;
    events(s).forEach(function (e) {
      var ch = e.kind === 'video' ? 'V' : (e.trackIndex <= 1 ? 'A' : e.trackIndex === 2 ? 'A2' : 'A' + e.trackIndex);
      lines.push(pad(n, 3) + '  ' + (e.reel + '        ').slice(0, 8) + ' ' + (ch + '      ').slice(0, 6) + 'C        ' + tc(e.srcIn, s.fps) + ' ' + tc(e.srcOut, s.fps) + ' ' + tc(e.recIn, s.fps) + ' ' + tc(e.recOut, s.fps));
      if (e.speed && e.speed !== 1) lines.push('M2   ' + (e.reel + '        ').slice(0, 8) + '       ' + (e.speed * s.fps).toFixed(1) + '                 ' + tc(e.srcIn, s.fps));
      lines.push('* FROM CLIP NAME: ' + e.name);
      if (e.kind === 'video' && e.trackIndex > 1) lines.push('* VIDEO TRACK: V' + e.trackIndex);
      lines.push('');
      n++;
    });
    s.markers.forEach(function (m) { lines.push('* MARKER ' + tc(m.f, s.fps) + ' ' + (m.name || '')); });
    return lines.join('\r\n');
  };
  function xmlEsc(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  IX.fcpxml = function (s) {
    var fps = s.fps, ntsc = Math.abs(fps - Math.round(fps)) > 0.001, tb = Math.round(fps);
    var rate = '<rate><timebase>' + tb + '</timebase><ntsc>' + (ntsc ? 'TRUE' : 'FALSE') + '</ntsc></rate>';
    var evs = events(s), files = {}, fileN = 0;
    evs.forEach(function (e) { if (e.media && !files[e.media.id]) files[e.media.id] = { id: 'file-' + (++fileN), m: e.media }; });
    var dur = P.seqDuration(s);
    var x = ['<?xml version="1.0" encoding="UTF-8"?>', '<!DOCTYPE xmeml>', '<xmeml version="5">', '<sequence id="seq-1">', '<name>' + xmlEsc(s.name) + '</name>', '<duration>' + dur + '</duration>', rate,
      '<timecode>' + rate + '<string>00:00:00:00</string><frame>0</frame><displayformat>' + (ntsc ? 'DF' : 'NDF') + '</displayformat></timecode>', '<media>'];
    function clipitem(e, idx, kindTag) {
      var f = e.media ? files[e.media.id] : null, m = e.media, first = f && !f.written;
      var out = ['<clipitem id="clip-' + idx + '">', '<name>' + xmlEsc(e.name) + '</name>', '<enabled>TRUE</enabled>', '<duration>' + (m && m.duration ? Math.round(m.duration * fps) : e.recOut - e.recIn) + '</duration>', rate,
        '<start>' + e.recIn + '</start>', '<end>' + e.recOut + '</end>', '<in>' + e.srcIn + '</in>', '<out>' + e.srcOut + '</out>'];
      if (f) {
        if (first) {
          f.written = true;
          out.push('<file id="' + f.id + '">', '<name>' + xmlEsc(m.name) + '</name>', '<pathurl>file://localhost/' + xmlEsc(encodeURI(m.name)) + '</pathurl>', rate,
            '<duration>' + Math.round((m.duration || 0) * fps) + '</duration>', '<media>');
          if (m.type === 'video' || m.type === 'image' || m.type === 'gen') out.push('<video><samplecharacteristics><width>' + (m.w || s.w) + '</width><height>' + (m.h || s.h) + '</height></samplecharacteristics></video>');
          if (m.hasAudio || m.type === 'audio') out.push('<audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio>');
          out.push('</media>', '</file>');
        } else out.push('<file id="' + f.id + '"/>');
      }
      if (e.speed && e.speed !== 1) out.push('<filter><effect><name>Time Remap</name><effectid>timeremap</effectid><effecttype>motion</effecttype><mediatype>video</mediatype><parameter><parameterid>speed</parameterid><name>speed</name><value>' + (e.speed * 100).toFixed(2) + '</value></parameter></effect></filter>');
      if (kindTag === 'audio') out.push('<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>');
      else out.push('<sourcetrack><mediatype>video</mediatype><trackindex>1</trackindex></sourcetrack>');
      out.push('</clipitem>');
      return out.join('\n');
    }
    var idx = 0;
    ['video', 'audio'].forEach(function (kind) {
      var tracks = s.tracks.filter(function (t) { return t.kind === kind; });
      x.push('<' + kind + '>');
      if (kind === 'video') x.push('<format><samplecharacteristics><width>' + s.w + '</width><height>' + s.h + '</height>' + rate + '</samplecharacteristics></format>');
      tracks.forEach(function (t) {
        x.push('<track>');
        evs.filter(function (e) { return e.clip.trackId === t.id; }).forEach(function (e) { x.push(clipitem(e, ++idx, kind)); });
        x.push('<enabled>' + (t.hidden || t.mute ? 'FALSE' : 'TRUE') + '</enabled>', '<locked>' + (t.lock ? 'TRUE' : 'FALSE') + '</locked>', '</track>');
      });
      x.push('</' + kind + '>');
    });
    x.push('</media>');
    s.markers.forEach(function (m) { x.push('<marker><name>' + xmlEsc(m.name || '') + '</name><comment>' + xmlEsc(m.note || '') + '</comment><in>' + m.f + '</in><out>' + (m.dur ? m.f + m.dur : -1) + '</out></marker>'); });
    x.push('</sequence>', '</xmeml>');
    return x.join('\n');
  };
  function download(text, name, mime) { U.download(new Blob([text], { type: mime }), name); }
  IX.exportEDL = function () { var s = P.seq(); if (!s) return; download(IX.edl(s), (s.name || 'sequence') + '.edl', 'text/plain'); C.toast('Exported ' + s.name + '.edl (CMX 3600 — one event per clip; effects and transitions are not carried over)'); };
  IX.exportXML = function () { var s = P.seq(); if (!s) return; download(IX.fcpxml(s), (s.name || 'sequence') + '.xml', 'application/xml'); C.toast('Exported ' + s.name + '.xml (FCP 7 XML — clips, tracks, speed and markers; relink the media on import)'); };

  /* ---------- marker import ---------- */
  // Accepts: Cutline CSV (Source,Timecode,Name,Color,Duration,...), YouTube chapters ("0:00 Intro"), "hh:mm:ss:ff name" lines.
  IX.parseMarkers = function (txt, fps) {
    var out = [], lines = txt.split(/\r?\n/);
    function csvSplit(line) { var o = [], cur = '', q = false; for (var i = 0; i < line.length; i++) { var ch = line[i]; if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ',') { o.push(cur); cur = ''; } else cur += ch; } o.push(cur); return o; }
    var csv = /^Source,Timecode/i.test(lines[0] || '');
    // a chapter list (any m:ss entry) reads h:mm:ss as hours; otherwise three fields are mm:ss:ff timecode
    var chapterStyle = !csv && lines.some(function (l) { return /(^|[\s(\[])\d{1,2}:\d{2}(\s|$|[\])])/.test(l); });
    lines.forEach(function (line, i) {
      line = line.trim(); if (!line) return;
      if (csv) {
        if (i === 0) return;
        var c = csvSplit(line), f = U.parseTC(c[1], fps); if (f == null) return;
        var d = c[4] ? U.parseTC(c[4], fps) : 0;
        out.push({ f: f, name: c[2] || '', color: /^#/.test(c[3] || '') ? c[3] : null, dur: d || 0, note: c[6] || '', source: c[0] || '' });
        return;
      }
      var m = line.match(/^\(?\[?\s*(\d{1,2}(?::\d{2}){1,3}(?:[.;:]\d{1,3})?)\s*[\]\)]?\s*[-–—:|]?\s*(.*)$/);
      if (!m) return;
      var t = m[1], parts = t.split(':');
      var f2;
      if (parts.length === 2 || (parts.length === 3 && (chapterStyle || t.indexOf('.') >= 0))) { // m:ss or h:mm:ss(.ms) chapter style → seconds
        var sec = 0; t.split(':').forEach(function (p) { sec = sec * 60 + parseFloat(p); }); f2 = Math.round(sec * fps);
      } else f2 = U.parseTC(t, fps);
      if (f2 == null) return;
      out.push({ f: f2, name: m[2].trim(), color: null, dur: 0, note: '' });
    });
    return out;
  };
  IX.importMarkers = function () {
    if (!C.state.project) return;
    U.pickFiles('.csv,.txt,text/plain,text/csv', false).then(function (files) {
      if (!files.length) return;
      files[0].text().then(function (txt) {
        var s = P.seq(), list = IX.parseMarkers(txt, s.fps);
        if (!list.length) { C.toast('No markers found — expected a Cutline marker CSV, a YouTube chapter list (0:00 Intro) or "timecode name" lines'); return; }
        // CSV rows that belong to source media go to that media; everything else to the sequence
        var n = 0, nm = 0;
        C.edit('Import Markers', function (s2, prj) {
          list.forEach(function (mk) {
            var md = mk.source && mk.source !== s2.name ? prj.media.filter(function (x) { return x.name === mk.source; })[0] : null;
            if (md) { md.markers = md.markers || []; var t = mk.f / s2.fps; if (!md.markers.some(function (q) { return Math.abs(q.t - t) < 0.02; })) { md.markers.push({ id: U.uid('mk'), t: t, end: mk.dur ? t + mk.dur / s2.fps : undefined, name: mk.name, color: mk.color || '#5aa9e6', note: mk.note }); nm++; } return; }
            if (s2.markers.some(function (q) { return q.f === mk.f; })) return;
            s2.markers.push({ id: U.uid('mk'), f: mk.f, name: mk.name, color: mk.color || C.A.MARKER_COLORS[0], dur: mk.dur || 0, note: mk.note }); n++;
          });
          s2.markers.sort(function (a, b) { return a.f - b.f; });
        });
        if (nm) C.bus.emit('media');
        C.toast(n + ' sequence marker' + (n === 1 ? '' : 's') + (nm ? ' and ' + nm + ' source marker' + (nm === 1 ? '' : 's') : '') + ' imported', 3500);
        if (C.ui.showLeftTab) C.ui.showLeftTab('markers');
      });
    });
  };

  /* ---------- sync: align a clip marker to the playhead ---------- */
  // candidate sync points of a clip in local frames: its clip markers + source-media markers inside its range
  IX.syncPoints = function (s, c) {
    var pts = (c.markers || []).map(function (m) { return { f: m.f, name: m.name || 'Clip marker' }; });
    var m = c.mediaId ? P.media(c.mediaId) : null, base = m ? C.Media.base(m) : null;
    if (base && base.markers && !T.hasRamp(c)) {
      var spf = c.speed / s.fps, span = T.srcSpan(s, c, 0, c.dur);
      base.markers.forEach(function (mk) { var rel = mk.t - c.in; if (rel >= 0 && rel <= span) pts.push({ f: Math.round(c.reverse ? (span - rel) / spf : rel / spf), name: mk.name || 'Source marker', src: true }); });
    }
    pts.sort(function (a, b) { return a.f - b.f; });
    return pts;
  };
  IX.alignToPlayhead = function (which) {
    var s = P.seq(); if (!s) return;
    var sel = P.selectedClips(); if (!sel.length) { C.toast('Select the clip whose marker should land on the playhead'); return; }
    var c = sel[0], pts = IX.syncPoints(s, c);
    if (!pts.length) { C.toast('No markers on ' + c.name + ' — add a clip marker (M on the clip) or a marker in the Source monitor at the beat/drop first'); return; }
    var ph = C.Engine.frame, lfPh = ph - c.start;
    var pick = which === 'next' ? (pts.filter(function (p) { return p.f > lfPh; })[0] || pts[0]) : which === 'prev' ? (pts.filter(function (p) { return p.f < lfPh; }).pop() || pts[pts.length - 1])
      : pts.reduce(function (best, p) { return !best || Math.abs(p.f - lfPh) < Math.abs(best.f - lfPh) ? p : best; }, null);
    var newStart = ph - pick.f;
    if (newStart === c.start) { C.toast('“' + pick.name + '” is already on the playhead'); return; }
    var group = s.clips.filter(function (k) { return k.id === c.id || (c.link && k.link === c.link); });
    var delta = newStart - c.start;
    if (group.some(function (k) { return k.start + delta < 0; })) { C.toast('Cannot move the clip before the start of the sequence'); return; }
    C.edit('Align Marker to Playhead', function (s2) {
      var moves = group.map(function (k) { var kk = P.clip(s2, k.id); return { clip: kk, start: kk.start + delta, trackId: kk.trackId }; });
      T.applyMoves(s2, moves, 'overwrite');
    });
    C.toast('“' + pick.name + '” aligned to ' + U.fmtTC(ph, s.fps) + ' (moved ' + (delta > 0 ? '+' : '') + delta + ' frames)', 3000);
  };

  C.CMD.reg('exportEDL', 'Export Sequence as EDL (CMX 3600)…', 'File', null, function () { IX.exportEDL(); });
  C.CMD.reg('exportXML', 'Export Sequence as FCP 7 XML…', 'File', null, function () { IX.exportXML(); });
  C.CMD.reg('importMarkers', 'Import Markers (CSV / chapters)…', 'Markers', null, function () { IX.importMarkers(); });
  C.CMD.reg('alignMarker', 'Align Clip Marker to Playhead', 'Clip', 'Alt+Shift+M', function () { IX.alignToPlayhead('nearest'); });
  C.CMD.reg('alignMarkerNext', 'Align Next Clip Marker to Playhead', 'Clip', null, function () { IX.alignToPlayhead('next'); });
  C.CMD.reg('alignMarkerPrev', 'Align Previous Clip Marker to Playhead', 'Clip', null, function () { IX.alignToPlayhead('prev'); });
  function cmd(id) { return C.CMD.menuItem(id); }
  var pf = C.Menus.extra.File, pm = C.Menus.extra.Markers, pc = C.Menus.extra.Clip;
  C.Menus.extra.File = function () { return (pf ? pf() : []).concat([cmd('exportEDL'), cmd('exportXML')]); };
  C.Menus.extra.Markers = function () { return (pm ? pm() : []).concat([cmd('importMarkers')]); };
  C.Menus.extra.Clip = function () { return (pc ? pc() : []).concat([cmd('alignMarker'), cmd('alignMarkerNext'), cmd('alignMarkerPrev')]); };
})();
