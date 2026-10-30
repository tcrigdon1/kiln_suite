// Pass 3 — Remove Silences + Detect Scene Cuts on synthetic media (silences 3–5 s and 8–10 s; hard cuts at 4 s and 8 s)
const L = require('../pass2/plib.js');
const { ok, info } = L;
const path = require('path');
(async () => {
  const { b, p, errs } = await L.launch();
  await L.boot(p); await L.newProjectUI(p, { name: 'AutoCut' });
  const media = path.join(__dirname, 'media', 'talkcuts.webm');
  const before = await p.evaluate(() => Cutline.state.project.media.length);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('.bin-toolbar .icon-btn[data-tip^="Import media"]')]);
  await fc.setFiles([media]); await L.waitReady(p, before + 1);
  // place the clip at 0 (video + linked audio), plus a music clip of the same media on A2 that must NOT be rippled
  await p.evaluate(() => {
    const C = Cutline, s = C.P.seq(), m = C.state.project.media[0];
    C.edit('place', (s2) => { C.T.placeMedia(s2, m, 0, s2.tracks.filter(t => t.kind === 'video')[0].id, s2.tracks.filter(t => t.kind === 'audio')[0].id, 'overwrite'); });
    const a2 = s.tracks.filter(t => t.kind === 'audio')[1];
    C.edit('music', (s2) => { const c = C.P.newClip(s2, m, 'audio', a2.id, 0, Math.round(12 * s2.fps), 0); c.name = 'music'; s2.clips.push(c); });
    C.state.selection = s.clips.filter(c => c.name !== 'music').map(c => c.id); C.bus.emit('selection');
  });
  let cl = await L.clips(p); ok(cl.length === 3, 'placed video + audio + music (' + cl.length + ' clips)');
  // ---- silence analysis (model level) ----
  const spans = await p.evaluate(async () => {
    const C = Cutline, s = C.P.seq(), clips = C.P.selectedClips();
    const sp = await C.AutoCut.analyseSilence(s, clips, { threshold: -40, minLen: 0.7, pad: 0.1 });
    return sp.map(x => ({ from: x.from / s.fps, to: x.to / s.fps, tracks: x.tracks.length }));
  });
  info(JSON.stringify(spans));
  ok(spans.length === 2, 'two silent spans found (one per linked group, not per clip)');
  ok(spans[0] && Math.abs(spans[0].from - 3.1) < 0.2 && Math.abs(spans[0].to - 4.9) < 0.2, 'first span ≈ 3.1–4.9 s (padding applied)');
  ok(spans[1] && Math.abs(spans[1].from - 8.1) < 0.2 && Math.abs(spans[1].to - 9.9) < 0.2, 'second span ≈ 8.1–9.9 s');
  ok(spans[0] && spans[0].tracks === 2, 'span carries both linked tracks');
  // ---- dialog: ripple on the clips' own tracks only ----
  await L.menu(p, 'Sequence', 'Remove Silences…');
  await p.waitForSelector('.dialog');
  await p.waitForFunction(() => { const d = document.querySelector('.dialog'); return d && /silent span/.test(d.textContent); }, null, { timeout: 20000 });
  const stat = await p.evaluate(() => document.querySelector('.dialog .ac-status').textContent);
  info(stat); ok(/2 silent spans/.test(stat), 'dialog previews 2 silent spans');
  await p.evaluate(() => { const d = document.querySelector('.dialog'); const cb = d.querySelector('input[type=checkbox]'); if (cb.checked) cb.click(); });
  await p.click('.dialog-foot .btn.primary'); await p.waitForTimeout(400);
  cl = await L.clips(p);
  const v = cl.filter(c => c.kind === 'video'), music = cl.filter(c => c.name === 'music')[0];
  info(JSON.stringify(v.map(c => [c.start, c.dur, c.in.toFixed(2)])));
  ok(v.length === 3, 'video split into 3 pieces around the silences');
  const total = v.reduce((a, c) => a + c.dur, 0);
  const removedS = spans.reduce((a, x) => a + (x.to - x.from), 0);
  ok(Math.abs(total / 30 - (12 - removedS)) < 0.15, 'kept duration ≈ ' + (12 - removedS).toFixed(2) + ' s (' + (total / 30).toFixed(2) + ')');
  ok(v.every((c, i) => i === 0 || c.start === v[i - 1].start + v[i - 1].dur), 'pieces are contiguous (gaps closed)');
  ok(music && music.dur === 360 && music.start === 0, 'music on A2 untouched when not rippling every track');
  ok(Math.abs(v[1].in - 4.9) < 0.2 && Math.abs(v[2].in - 9.9) < 0.2, 'later pieces start at the right source time');
  ok(await p.evaluate(() => Cutline.H.undo.length > 0 && Cutline.H.undo[Cutline.H.undo.length - 1].label === 'Remove Silences'), 'one undo step "Remove Silences"');
  await p.keyboard.press('Control+z'); await p.waitForTimeout(200);
  cl = await L.clips(p); ok(cl.filter(c => c.kind === 'video').length === 1, 'undo restores the single clip');
  // ---- markers-only action + ripple all tracks via model API ----
  const nm = await p.evaluate(async () => {
    const C = Cutline, s = C.P.seq(); C.state.selection = s.clips.filter(c => c.name !== 'music').map(c => c.id);
    const sp = await C.AutoCut.analyseSilence(s, C.P.selectedClips(), { threshold: -40, minLen: 0.7, pad: 0.1 });
    C.edit('m', (s2) => C.AutoCut.applySpans(s2, sp, 'markers', false, 'Silence'));
    const n = s.markers.length;
    C.edit('r', (s2) => C.AutoCut.applySpans(s2, sp, 'ripple', true, 'Silence'));
    return { n, removed: sp.reduce((a, x) => a + (x.to - x.from), 0), music: s.clips.filter(c => c.name === 'music').map(c => c.dur) };
  });
  ok(nm.n === 2, 'markers action adds 2 ranged markers');
  ok(nm.music.length === 3 && nm.music.reduce((a, x) => a + x, 0) === 360 - nm.removed, 'ripple-all also cuts the music track (3 pieces, ' + nm.removed + ' frames removed)');
  // ---- scene cuts ----
  await p.evaluate(() => { const C = Cutline; C.H.doUndo(); C.H.doUndo(); const s = C.P.seq(); C.state.selection = s.clips.filter(c => c.kind === 'video').map(c => c.id); C.bus.emit('selection'); });
  const cuts = await p.evaluate(async () => {
    const C = Cutline, m = C.Media.base(C.state.project.media[0]);
    const r = await C.AutoCut.scanCuts(m, 0, 12, { threshold: 0.4, rate: 4, minGap: 0.5 });
    return r.map(c => +c.t.toFixed(2));
  });
  info('cuts ' + JSON.stringify(cuts));
  ok(cuts.length === 2, 'exactly two scene cuts detected');
  ok(cuts.some(t => Math.abs(t - 4) <= 0.3) && cuts.some(t => Math.abs(t - 8) <= 0.3), 'cuts at ≈ 4 s and ≈ 8 s');
  await L.menu(p, 'Sequence', 'Detect Scene Cuts…'); await p.waitForSelector('.dialog');
  await p.selectOption('.dialog select:nth-of-type(2)', 'split');
  await p.click('.dialog-foot .btn.primary');
  await p.waitForFunction(() => !document.querySelector('.dialog'), null, { timeout: 60000 }); await p.waitForTimeout(200);
  cl = await L.clips(p);
  const vv = cl.filter(c => c.kind === 'video').sort((a, b) => a.start - b.start), aa = cl.filter(c => c.kind === 'audio' && c.name !== 'music');
  info(JSON.stringify(vv.map(c => [c.start, c.dur])));
  ok(vv.length === 3 && aa.length === 3, 'video and its linked audio split into 3 at the scene cuts');
  ok(vv[1] && Math.abs(vv[1].start - 120) <= 9 && vv[2] && Math.abs(vv[2].start - 240) <= 9, 'splits land at ≈ 4 s and ≈ 8 s');
  await L.shot(p, 'autocut-done');
  await L.finish(b, errs, 'y1_autocut');
})();
