const L = require('./lflib');
(async () => {
  const { b, p, errs, cdp } = await L.launch();
  await L.boot(p); await L.newProjectUI(p);
  await L.importUI(p, [process.argv[2] || 'vod10h.mp4']);
  await p.waitForFunction(() => { const C = Cutline; return C.state.project.media.length && C.state.project.media.every(m => C.MRT[m.id] && C.MRT[m.id].status === 'ready'); }, null, { timeout: 120000 });
  const t0 = Date.now();
  for (let i = 0; i < 6; i++) {
    await p.waitForTimeout(10000);
    const d = await p.evaluate(() => { const C = Cutline, m = C.state.project.media[0], rt = C.MRT[m.id]; return rt.peaks ? rt.peaks.done : -1; });
    L.info(((Date.now() - t0) / 1000).toFixed(0) + ' s: done ' + (d * 100).toFixed(2) + '%  heap ' + (await L.heapMB(cdp)).toFixed(0) + ' MB  rss ' + L.rendererRSS(b).toFixed(0) + ' MB');
  }
  console.log(errs.join('\n'));
  await b.close();
})();
