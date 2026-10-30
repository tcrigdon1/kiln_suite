// Long-form #2 — importing 10-hour files through the UI: import time, memory, background waveform/loudness pass
// (time, responsiveness, correctness), timeline overview + zoomed waveform screenshots, lazy thumbnails, and
// instant reopen from the IndexedDB peak cache.
const L = require('./lflib');
const SEG = 150.008; // concat segment length of the test media (see build_media.sh)
(async () => {
  const which = process.argv[2] || 'vod10h.mp4';
  const { b, ctx, p, errs, cdp } = await L.launch();
  await L.boot(p); await L.newProjectUI(p, { w: 1280, h: 720, fps: 30 });
  const t0 = Date.now();
  const imp = await L.withMem(b, cdp, async () => {
    await L.importUI(p, [which]);
    await p.waitForFunction(() => { const C = Cutline; return C.state.project.media.length === 1 && C.MRT[C.state.project.media[0].id].status === 'ready'; }, null, { timeout: 60000, polling: 50 });
    return Date.now() - t0;
  }, 200);
  const m = await p.evaluate(() => { const C = Cutline, m = C.state.project.media[0], rt = C.MRT[m.id]; return { id: m.id, dur: m.duration, fps: m.fps, w: m.w, h: m.h, streamed: !!rt.stream, importMs: rt.importMs, size: m.size }; });
  L.info(which + ': import ' + imp.result + ' ms (in-app ' + m.importMs.toFixed(0) + ' ms), ' + (m.size / 1073741824).toFixed(2) + ' GB, ' + m.dur.toFixed(1) + ' s, ' + m.w + 'x' + m.h + '@' + m.fps + '; heap peak ' + imp.heap.toFixed(0) + ' MB, renderer RSS peak ' + imp.rss.toFixed(0) + ' MB');
  L.ok(imp.result < 10000, which + ' imported (metadata only) in ' + (imp.result / 1000).toFixed(1) + ' s');
  L.ok(m.streamed && Math.abs(m.dur - 36001.9) < 1, 'audio is streamed (not decoded whole); duration 10:00:01');
  L.ok(imp.rss < 1500, 'renderer memory during import stays bounded (' + imp.rss.toFixed(0) + ' MB RSS)');

  // drop the whole 10-hour clip on the timeline (real mouse drag from the Library)
  const item = await L.center(p, '.bin-item[data-id="' + m.id + '"]');
  const tl = await L.center(p, '.tl-scroll');
  const rowY = await p.evaluate(() => { const C = Cutline, TL = C.TL, r = TL.rows.find(r => r.track && C.P.trackLabel(C.P.seq(), r.track) === 'V1'); return TL.scroller.getBoundingClientRect().top + r.y - TL.scrollY + r.h / 2; });
  await p.mouse.move(item.x, item.y); await p.mouse.down();
  for (let i = 1; i <= 20; i++) { await p.mouse.move(item.x + (tl.bb.x + 40 - item.x) * i / 20, item.y + (rowY - item.y) * i / 20); await p.waitForTimeout(15); }
  await p.mouse.up(); await p.waitForTimeout(400);
  const clipsN = await p.evaluate(() => Cutline.P.seq().clips.length);
  L.ok(clipsN === 2, 'dragged the 10-hour clip onto the timeline (linked video + audio)');
  // the clip-format dialog may pop up (720p30 project, 60 fps source): keep sequence settings
  if (await p.locator('.dialog-foot .btn:has-text("Keep Sequence Settings")').count()) await p.click('.dialog-foot .btn:has-text("Keep Sequence Settings")');
  await p.keyboard.press('\\'); await p.waitForTimeout(400); // zoom to fit
  const fit = await p.evaluate(() => ({ ppf: Cutline.TL.ppf, w: Cutline.TL.area.clientWidth, dur: Cutline.P.seqDuration(Cutline.P.seq()) }));
  L.ok(fit.ppf * fit.dur <= fit.w, 'zoom to fit shows all 10 hours on screen (' + fit.ppf.toExponential(2) + ' px/frame)');

  // waveform pass: progress, responsiveness, time
  const w0 = Date.now();
  await p.evaluate(() => { window.__gaps = []; let last = performance.now(); (function f() { const n = performance.now(); window.__gaps.push(n - last); last = n; if (!window.__stopGaps) requestAnimationFrame(f); })();
    window.__longTasks = []; try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__longTasks.push(e.duration))).observe({ type: 'longtask', buffered: false }); } catch (e) { } });
  await p.waitForTimeout(6000);
  await L.shot(p, '2-' + which + '-waveform-in-progress');
  const mid = await p.evaluate(() => { const C = Cutline, rt = C.MRT[C.state.project.media[0].id]; return rt.peaks ? rt.peaks.done : -1; });
  // interact while the pass runs: zoom in/out with the keyboard and measure the response
  const resp = await p.evaluate(async () => { const t = performance.now(); Cutline.TL.zoomBy(1.5); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); const d = performance.now() - t; Cutline.TL.zoomBy(1 / 1.5); return d; });
  const wave = await L.withMem(b, cdp, () => p.waitForFunction(() => { const C = Cutline, rt = C.MRT[C.state.project.media[0].id]; return rt.peaks && rt.peaks.done >= 1; }, null, { timeout: 1200000, polling: 1000 }), 1000);
  const waveS = (Date.now() - w0) / 1000;
  const gaps = await p.evaluate(() => { window.__stopGaps = true; const g = window.__gaps.slice(5).sort((a, b) => a - b); return { n: g.length, p50: g[g.length >> 1], p99: g[Math.floor(g.length * 0.99)], max: g[g.length - 1], long: window.__longTasks.length, longMax: Math.max(0, ...window.__longTasks) }; });
  L.info('waveform/loudness pass over 10 h: ' + waveS.toFixed(0) + ' s (' + (36000 / waveS).toFixed(0) + 'x real time); in-progress at 6 s: ' + (mid * 100).toFixed(1) + '%; heap peak ' + wave.heap.toFixed(0) + ' MB, RSS peak ' + wave.rss.toFixed(0) + ' MB');
  L.info('UI during the pass: frame gap p50 ' + gaps.p50.toFixed(1) + ' ms, p99 ' + gaps.p99.toFixed(1) + ' ms, max ' + gaps.max.toFixed(0) + ' ms over ' + gaps.n + ' frames; long tasks ' + gaps.long + ' (max ' + gaps.longMax.toFixed(0) + ' ms); zoom keypress → painted in ' + resp.toFixed(0) + ' ms');
  L.ok(gaps.p99 < 100 && resp < 250, 'timeline stays responsive while the waveform pass runs (p99 frame gap ' + gaps.p99.toFixed(0) + ' ms)');
  L.ok(wave.rss < 1500, 'memory bounded during the waveform pass (' + wave.rss.toFixed(0) + ' MB RSS)');
  // peaks correctness: loud bursts at SEG*k + 37 s (1.5 s) and + 112 s (4 s) above quiet noise
  const chk = await p.evaluate((SEG) => {
    const C = Cutline, rt = C.MRT[C.state.project.media[0].id], pk = rt.peaks, out = [];
    for (const k of [0, 1, 77, 120, 239]) { const a = k * SEG; const loud = C.Media.peakSpan(pk, a + 37.2, a + 38.2), quiet = C.Media.peakSpan(pk, a + 20, a + 21), sus = C.Media.peakSpan(pk, a + 113, a + 115); out.push([k, loud.hi, quiet.hi, sus.hi]); }
    const overview = C.Media.peakSpan(pk, 0, 36000); // coarsest pyramid level
    return { out, overview: overview.hi, levels: pk.levels.map(l => l.n), n: pk.n, rmsN: pk.rmsN };
  }, SEG);
  const good = chk.out.every(r => r[1] > 0.6 && r[3] > 0.3 && r[2] < 0.1);
  L.ok(good, 'peaks show the loud bursts and quiet noise at the right times across the 10 h (k, burst, quiet, sustained): ' + chk.out.map(r => r.map(x => typeof x === 'number' && x % 1 ? x.toFixed(2) : x).join('/')).join('  '));
  L.ok(chk.levels.length >= 5 && chk.levels[chk.levels.length - 1] < 2000, 'peak pyramid: ' + chk.n + ' base buckets + levels ' + chk.levels.join('/') + ' (overview uses the coarsest level)');
  await p.waitForTimeout(500);
  await L.shot(p, '2-' + which + '-overview-10h');
  // zoom into one burst (frame level) using the timeline timecode field + keyboard zoom
  await p.click('.tl-tc'); await p.keyboard.type('00:10:37:15'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  for (let i = 0; i < 26; i++) await p.keyboard.press('=');
  await p.waitForTimeout(1500);
  const z = await p.evaluate(() => ({ ppf: Cutline.TL.ppf, k: Cutline.TL.scrollK, sx: Cutline.TL.scrollX, f2x: Cutline.TL.f2x(Cutline.Engine.frame), thumbs: Cutline.Media.thumbStats() }));
  L.ok(z.ppf >= 20 && z.f2x > 0 && z.f2x < 1400, 'zoomed to frame level on a 10-hour sequence (' + z.ppf.toFixed(1) + ' px/frame, scroll scale ' + z.k.toFixed(2) + ', playhead on screen)');
  await p.waitForTimeout(2500);
  await L.shot(p, '2-' + which + '-zoom-frames');
  for (let i = 0; i < 12; i++) await p.keyboard.press('-');
  await p.waitForTimeout(2500);
  await L.shot(p, '2-' + which + '-zoom-seconds');
  const th = await p.evaluate(() => Cutline.Media.thumbStats());
  L.ok(th.cached > 0 && th.cached <= th.cap, 'filmstrip thumbnails are generated lazily for the visible range (' + th.cached + ' cached, cap ' + th.cap + ')');
  // timecodes past 9:59:59
  await p.click('.tl-tc'); await p.keyboard.type('10:00:00:00'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  const tcs = await p.evaluate(() => ({ tl: Cutline.TL.tcEl.textContent, prog: Cutline.Program.tc.textContent, dur: Cutline.TL.durVal.textContent, status: document.getElementById('statusbar').textContent }));
  L.ok(tcs.tl === '10:00:00:00' && tcs.prog === '10:00:00:00' && /^10:00:0/.test(tcs.dur), 'timecodes past 9:59:59 display correctly (timeline ' + tcs.tl + ', program ' + tcs.prog + ', duration ' + tcs.dur + ')');

  // reopen: peaks come from the IndexedDB cache
  await p.reload(); await p.waitForFunction(() => window.Cutline && Cutline.ready);
  await p.evaluate(() => Cutline.ui.openDialogs.slice().forEach(d => d.close()));
  await p.evaluate(() => Cutline.IO.createProject({ projectName: 'Reopen', w: 1280, h: 720, fps: 30 }));
  const r0 = Date.now();
  await L.importUI(p, [which]);
  await p.waitForFunction(() => { const C = Cutline, m = C.state.project.media[0]; const rt = m && C.MRT[m.id]; return rt && rt.peaks && rt.peaks.done >= 1; }, null, { timeout: 30000, polling: 50 });
  const cached = await p.evaluate(() => { const C = Cutline, rt = C.MRT[C.state.project.media[0].id]; return { fromCache: !!rt.peaks.fromCache, ms: rt.peaksMs }; });
  L.ok(cached.fromCache && Date.now() - r0 < 8000, 'reopening: waveform loaded from the IndexedDB cache in ' + cached.ms.toFixed(0) + ' ms (import + peaks ' + (Date.now() - r0) + ' ms)');
  const n = L.done(errs);
  await b.close();
  process.exit(n ? 1 : 0);
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
