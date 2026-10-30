const { launch, newProject, importFiles } = require('./lib');
(async () => {
  const { b, p, errs } = await launch();
  await newProject(p);
  await importFiles(p, ['audiofirst.mp4']);
  const r = await p.evaluate(async () => {
    const C = Cutline, out = {};
    const m = C.state.project.media[0]; const i = await C.FrameDecoder.infoFor(m);
    out.audiofirst = i ? { codec: i.codec, n: i.samples.length, w: i.width, cal: i.calibrated } : null;
    // MediaRecorder webm (unknown-size clusters)
    const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d');
    const st = c.captureStream(30); const rec = new MediaRecorder(st, { mimeType: 'video/webm;codecs=vp8' }); const parts = [];
    rec.ondataavailable = e => parts.push(e.data); rec.start(100);
    let n = 0; await new Promise(res => { const t = setInterval(() => { g.fillStyle = `hsl(${n * 10},80%,50%)`; g.fillRect(0, 0, 320, 180); g.fillStyle = '#fff'; g.font = '40px sans-serif'; g.fillText(String(n), 120, 100); n++; if (n > 45) { clearInterval(t); res(); } }, 33); });
    rec.stop(); await new Promise(r => rec.onstop = r);
    const file = new File(parts, 'rec.webm', { type: 'video/webm' });
    const info2 = await C.Demux.open(file);
    out.recorded = info2 ? { codec: info2.codec, n: info2.samples.length, keys: info2.samples.filter(s => s.key).length, last: info2.byPts[info2.byPts.length - 1].pts } : null;
    if (info2) {
      const fd = new C.FrameDecoder(file, info2); const f = await fd.getFrame(0.5); out.frameTs = f.timestamp; out.frameW = f.displayWidth; fd.close();
    }
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  console.log('ERRORS:\n' + errs.join('\n'));
  await b.close();
})();
