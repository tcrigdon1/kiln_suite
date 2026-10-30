const L = require('./lflib');
(async () => {
  const { b, p, errs, cdp } = await L.launch();
  await L.boot(p); await L.newProjectUI(p);
  const t0 = Date.now();
  const r = await L.withHeap(cdp, async () => {
    await L.importUI(p, [process.argv[2] || 'vod10h.mp4']);
    await p.waitForFunction(() => { const C = Cutline; return C.state.project.media.length && C.state.project.media.every(m => C.MRT[m.id] && C.MRT[m.id].status === 'ready'); }, null, { timeout: 120000 });
    return Date.now() - t0;
  });
  L.info('import ms ' + r.result + ' heap peak ' + r.peak.toFixed(0) + ' MB');
  const st = await p.evaluate(() => { const C = Cutline, m = C.state.project.media[0], rt = C.MRT[m.id]; return { m, importMs: rt.importMs, stream: !!rt.stream, probe: rt.probe && { dur: rt.probe.duration, vn: rt.probe.video && rt.probe.video.count, an: rt.probe.audio && rt.probe.audio.count } }; });
  console.log(JSON.stringify(st));
  const w0 = Date.now();
  const r2 = await L.withHeap(cdp, async () => {
    await p.waitForFunction(() => { const C = Cutline, m = C.state.project.media[0], rt = C.MRT[m.id]; return rt.peaks && rt.peaks.done >= 1; }, null, { timeout: 900000, polling: 2000 });
  }, 1000);
  L.info('waveform pass s ' + ((Date.now() - w0) / 1000).toFixed(1) + ' heap peak ' + r2.peak.toFixed(0));
  await L.shot(p, 'explore');
  console.log(errs.join('\n'));
  await b.close();
})();
