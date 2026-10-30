// 2. Source monitor: open, scrub, I/O keys, insert/overwrite, drag video-only/audio-only handles
const H = require('./hlib');
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('h2');
  await H.boot(p);
  await H.newProjectUI(p);
  await H.importUI(p, ['main1080.webm', 'music.mp3']);
  await p.dblclick('#p-bin .bin-item:has(.name:text-is("main1080.webm"))');
  await p.waitForTimeout(600);
  H.ok(await p.evaluate(() => !!Cutline.state.sourceMedia), 'double-click opens clip in Source monitor');
  // scrub: drag across the source scrub bar to ~25%
  const sc = await H.center(p, '#p-source .mon-scrub');
  await H.drag(p, sc.bb.x + 12, sc.y, sc.bb.x + 10 + (sc.bb.width - 20) * 0.25, sc.y, { steps: 10 });
  await p.waitForTimeout(400);
  const t1 = await p.evaluate(() => Cutline.Source.time());
  H.ok(Math.abs(t1 - 5) < 0.4, 'scrubbed source to ~5s (got ' + t1.toFixed(2) + ')');
  await H.shot(p, 'source-scrubbed');
  // I at 5s, step forward 3s with Shift+Right (5 frames) ×18, O
  await p.click('#p-source .mon-view'); // focus source
  await H.key(p, 'i');
  for (let i = 0; i < 18; i++) await p.keyboard.press('Shift+ArrowRight');
  await p.waitForTimeout(300);
  await H.key(p, 'o');
  const mk = await p.evaluate(() => Cutline.Source.marks());
  H.ok(Math.abs(mk.inSec - t1) < 0.05 && Math.abs(mk.outSec - (t1 + 3 + 1 / 30)) < 0.1, 'source In/Out set by keys: ' + JSON.stringify(mk));
  await H.shot(p, 'source-marked');
  // Insert with , → lands at playhead 0 on V1/A1
  await H.key(p, ',');
  await p.waitForTimeout(300);
  let cl = await H.clips(p);
  H.ok(cl.length === 2 && cl.every(c => c.start === 0 && c.dur === 91), 'insert (,) placed 3s+1f A/V at 0: ' + JSON.stringify(cl.map(c => [c.track, c.start, c.dur])));
  const ph = await H.frame(p);
  H.ok(ph === 91, 'playhead moved to end of inserted clip (' + ph + ')');
  // Overwrite with . (focus source again)
  await p.click('#p-source .mon-view');
  await H.key(p, '.');
  cl = await H.clips(p);
  H.ok(cl.length === 4 && cl.filter(c => c.start === 91).length === 2, 'overwrite (.) appended at playhead');
  await H.shot(p, 'after-insert-overwrite');
  // Insert at playhead 45 → splits existing & pushes
  await p.click('#p-program .mon-view');
  await H.key(p, 'Home');
  for (let i = 0; i < 9; i++) await p.keyboard.press('Shift+ArrowRight');
  await p.click('#p-source .mon-view');
  await H.key(p, ',');
  cl = await H.clips(p);
  H.ok(cl.length === 8 && Math.max(...cl.map(c => c.start + c.dur)) === 91 * 3, 'insert mid-clip splits and ripples (' + cl.length + ' clips, end ' + Math.max(...cl.map(c => c.start + c.dur)) + ')');
  await H.shot(p, 'insert-mid');
  // zoom timeline to fit so drop targets are visible
  await p.mouse.click(await H.tlX(p, 10), (await H.center(p, '#p-timeline .tl-ruler-hit')).y + 400 > 0 ? await H.tlRowY(p, 'V3') : 0);
  await H.key(p, 'Backslash');
  // Drag video-only handle to V2
  const vh = await H.center(p, '#p-source .drag-handle[title^="Drag video only"]');
  const y2 = await H.tlRowY(p, 'V2'), x2 = await H.tlX(p, 150);
  await H.dnd(p, vh.x, vh.y, x2, y2);
  await p.waitForTimeout(300);
  cl = await H.clips(p);
  const v2 = cl.filter(c => c.track === 'V2'), a2 = cl.filter(c => c.track === 'A2');
  H.ok(v2.length === 1 && a2.length === 0, 'video-only handle drag → V2 only (V2 ' + v2.length + ', A2 ' + a2.length + ')');
  if (v2[0]) H.ok(Math.abs(v2[0].start - 150) <= 2 && v2[0].dur === 91, 'V2 clip at ~150 dur 91 (' + v2[0].start + ',' + v2[0].dur + ')');
  await H.shot(p, 'drag-video-only');
  // Drag audio-only handle to A3
  const ah = await H.center(p, '#p-source .drag-handle[title^="Drag audio only"]');
  const y3 = await H.tlRowY(p, 'A3'), x3 = await H.tlX(p, 200);
  await H.dnd(p, ah.x, ah.y, x3, y3);
  cl = await H.clips(p);
  H.ok(cl.filter(c => c.track === 'A3').length === 1 && cl.filter(c => c.track === 'V3').length === 0, 'audio-only handle drag → A3 only');
  await H.shot(p, 'drag-audio-only');
  // drag whole source view onto timeline V3
  const sv = await H.center(p, '#p-source .mon-view');
  await H.dnd(p, sv.x, sv.y, await H.tlX(p, 240), await H.tlRowY(p, 'V3'));
  cl = await H.clips(p);
  H.ok(cl.filter(c => c.track === 'V3').length === 1, 'dragging the source picture puts A/V on timeline (V3 count ' + cl.filter(c => c.track === 'V3').length + ')');
  await H.shot(p, 'drag-source-view');
  // play source with space then stop with K; verify time advanced
  await p.click('#p-source .mon-view');
  const tA = await p.evaluate(() => Cutline.Source.time());
  await H.key(p, 'Space'); await p.waitForTimeout(800); await H.key(p, 'k');
  const tB = await p.evaluate(() => Cutline.Source.time());
  H.ok(tB > tA + 0.3, 'source plays with Space (' + tA.toFixed(2) + '→' + tB.toFixed(2) + ')');
  // audio file in source shows waveform
  await p.dblclick('#p-bin .bin-item:has(.name:text-is("music.mp3"))');
  await p.waitForTimeout(500);
  await H.shot(p, 'source-audio');
  await H.finish(b, errs, 'h2_source');
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
