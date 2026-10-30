// Pass 3 — EDL / FCP-XML export, marker import (CSV + chapters), align clip marker to playhead
const L = require('../pass2/plib.js');
const { ok, info } = L;
const path = require('path'), fs = require('fs');
(async () => {
  const { b, p, errs } = await L.launch();
  await L.boot(p); await L.newProjectUI(p, { name: 'IX' });
  const media = path.join(__dirname, 'media', 'talkcuts.webm');
  const before = await p.evaluate(() => Cutline.state.project.media.length);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('.bin-toolbar .icon-btn[data-tip^="Import media"]')]);
  await fc.setFiles([media]); await L.waitReady(p, before + 1);
  await p.evaluate(() => {
    const C = Cutline, s = C.P.seq(), m = C.state.project.media[0];
    C.edit('place', (s2) => {
      const v1 = s2.tracks.filter(t => t.kind === 'video')[0].id, a1 = s2.tracks.filter(t => t.kind === 'audio')[0].id;
      C.T.placeMedia(s2, m, 30, v1, a1, 'overwrite', 2, 8); // 6 s from source 2 s, at frame 30
      const c2 = C.P.newClip(s2, m, 'video', v1.id || v1, 300, 60, 1); c2.speed = 2; s2.clips.push(c2);
      s2.markers.push({ id: 'mk1', f: 45, name: 'Drop', color: '#f0913a', dur: 0, note: 'the beat' });
    });
  });
  // --- EDL ---
  const edl = await p.evaluate(() => Cutline.Interchange.edl(Cutline.P.seq()));
  info(edl.split('\r\n').slice(0, 6).join(' | '));
  ok(/^TITLE: Sequence 1/.test(edl) && /FCM: NON-DROP FRAME/.test(edl), 'EDL header');
  ok(/^001  TALKCUTS V     C        00:00:02:00 00:00:08:00 00:00:01:00 00:00:07:00$/m.test(edl), 'event 1: source 2–8 s recorded at 1–7 s on V');
  ok(/^002  TALKCUTS A     C        00:00:02:00 00:00:08:00 00:00:01:00 00:00:07:00$/m.test(edl), 'event 2: the linked audio on A');
  ok(/^M2   TALKCUTS\s+60\.0\s+00:00:01:00$/m.test(edl), 'speed change written as an M2 motion line (60 fps = 200 %)');
  ok(/\* FROM CLIP NAME: talkcuts\.webm/.test(edl) && /\* MARKER 00:00:01:15 Drop/.test(edl), 'clip names and markers as comments');
  // --- FCP XML ---
  const xml = await p.evaluate(() => Cutline.Interchange.fcpxml(Cutline.P.seq()));
  const parsed = await p.evaluate((x) => { const d = new DOMParser().parseFromString(x, 'application/xml'); const err = d.querySelector('parsererror'); if (err) return { err: err.textContent }; const ci = Array.from(d.querySelectorAll('clipitem')); return { n: ci.length, files: d.querySelectorAll('file[id]').length, fullFiles: d.querySelectorAll('file > name').length, first: { start: ci[0].querySelector('start').textContent, end: ci[0].querySelector('end').textContent, in: ci[0].querySelector('in').textContent, out: ci[0].querySelector('out').textContent }, speed: !!d.querySelector('effectid'), tracks: d.querySelectorAll('track').length, markers: d.querySelectorAll('sequence > marker').length, tb: d.querySelector('sequence > rate > timebase').textContent }; }, xml);
  info(JSON.stringify(parsed));
  ok(!parsed.err && parsed.n === 3, 'XML parses with 3 clipitems');
  ok(parsed.first.start === '30' && parsed.first.end === '210' && parsed.first.in === '60' && parsed.first.out === '240', 'first clipitem frames (start/end/in/out)');
  ok(parsed.fullFiles === 1 && parsed.files === 3, 'the media file is described once and referenced twice more');
  ok(parsed.speed && parsed.markers === 1 && parsed.tb === '30', 'speed effect, sequence marker and timebase present');
  // --- menu entries + download ---
  const dl = p.waitForEvent('download');
  await L.menu(p, 'File', 'Export Sequence as EDL');
  const d = await dl; ok(/\.edl$/.test(d.suggestedFilename()), 'File menu exports ' + d.suggestedFilename());
  // --- marker import: chapters + csv ---
  const imp = await p.evaluate(() => {
    const IX = Cutline.Interchange, fps = 30;
    const ch = IX.parseMarkers('Chapters:\n0:00 Intro\n1:05 First boss\n(12:30) Credits\n1:02:03 Late one', fps);
    const csv = IX.parseMarkers('Source,Timecode,Name,Color,Duration,Strength,Notes\n"IX",00:00:10:00,"Hype",#e2b93d,00:00:02:00,,"note, with comma"\n"talkcuts.webm",00:00:03:00,"Src",#5aa9e6,00:00:00:00,,""', fps);
    return { ch: ch.map(m => [m.f, m.name]), csv: csv.map(m => [m.f, m.name, m.dur, m.note, m.source]) };
  });
  info(JSON.stringify(imp));
  ok(imp.ch.length === 4 && imp.ch[1][0] === 1950 && imp.ch[1][1] === 'First boss' && imp.ch[2][0] === 22500 && imp.ch[3][0] === (3723 * 30), 'YouTube chapter lines parse (m:ss, (mm:ss), h:mm:ss)');
  ok(imp.csv.length === 2 && imp.csv[0][0] === 300 && imp.csv[0][2] === 60 && imp.csv[0][3] === 'note, with comma' && imp.csv[1][4] === 'talkcuts.webm', 'Cutline CSV parses with quoted commas, durations and sources');
  // --- align marker to playhead ---
  const al = await p.evaluate(() => {
    const C = Cutline, s = C.P.seq(), c = s.clips.filter(k => k.kind === 'video')[0];
    C.edit('mk', (s2) => { const cc = C.P.clip(s2, c.id); cc.markers = [{ id: 'cm', f: 60, name: 'Beat' }]; });
    C.state.selection = [c.id]; C.bus.emit('selection');
    C.Engine.setFrame(150, true);
    const pts = C.Interchange.syncPoints(s, C.P.clip(s, c.id));
    C.CMD.run('alignMarker');
    const cc = C.P.clip(s, c.id), aud = s.clips.filter(k => k.kind === 'audio' && k.link === cc.link)[0];
    return { pts: pts.map(x => x.f), start: cc.start, audStart: aud && aud.start, label: C.H.undo[C.H.undo.length - 1].label };
  });
  info(JSON.stringify(al));
  ok(al.pts.length === 1 && al.start === 90 && al.audStart === 90 && al.label === 'Align Marker to Playhead', 'clip (and its linked audio) moved so the Beat marker sits on frame 150');
  // source-media marker as sync point
  const al2 = await p.evaluate(() => {
    const C = Cutline, s = C.P.seq(), c = s.clips.filter(k => k.kind === 'video')[0];
    C.edit('srcmk', (s2, prj) => { const m = prj.media[0]; m.markers = [{ id: 'sm', t: 5, name: 'Drop' }]; });
    return C.Interchange.syncPoints(s, C.P.clip(s, c.id)).map(x => [x.f, x.name, !!x.src]);
  });
  ok(al2.length === 2 && al2.some(x => x[0] === 90 && x[2]), 'a source-monitor marker at 5 s shows up as a sync point at local frame 90 (clip in = 2 s)');
  await L.finish(b, errs, 'y3_interchange');
})();
