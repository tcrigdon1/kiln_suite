const { launch, newProject, importFiles } = require('./lib');
(async () => {
  const { b, p, errs } = await launch(); p.on('console', m => { if (m.type() === 'warning') console.log('WARN', m.text()); });
  await newProject(p);
  await importFiles(p, ['noise.mp3']);
  const r = await p.evaluate(async () => {
    const C = Cutline;
    C.edit('x', s2 => { const c = C.T.placeMedia(s2, C.state.project.media[0], 0, null, C.P.atracks(s2)[0].id, 'overwrite'); });
    const rms = async () => { const b = await C.Mixer.renderOffline(C.P.seq(), 0, 3, 48000); const d = b.getChannelData(0); let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; return Math.sqrt(s / d.length); };
    const a = await rms();
    C.edit('g', s2 => { const fx = C.FX.newInstance('a_gate'); fx.p.th = -5; s2.clips[0].fx.push(fx); });
    const g = await rms();
    return { a, g };
  });
  console.log(JSON.stringify(r), errs.join('\n'));
  await b.close();
})();
