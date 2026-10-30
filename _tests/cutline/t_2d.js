const { ROOT } = require('../env.js');
const { launch, newProject, importFiles } = require('./lib');
(async () => {
  const { b, p, errs } = await launch();
  await p.goto('file://' + ROOT + '/Cutline/index.html');
  await p.evaluate(() => localStorage.setItem('cutline.force2d', 'true'));
  await newProject(p);
  await importFiles(p, ['test1.webm', 'photo.png']);
  const r = await p.evaluate(async () => {
    const C = Cutline;
    C.edit('x', s2 => { const m = C.state.project.media; const v = C.P.vtracks(s2); const a = C.T.placeMedia(s2, m[0], 0, v[0].id, null, 'overwrite'); a[0].fx.push(C.FX.newInstance('sepia')); const b = C.T.placeMedia(s2, m[1], 30, v[1].id, null, 'overwrite'); b[0].tf.scale = 40; b[0].tf.rot = 15; });
    C.Engine.seek(45); C.Engine.renderNow(); await new Promise(r => setTimeout(r, 600)); C.Engine.renderNow();
    const d = C.Engine.comp.readSmall(16, 9); let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return { kind: C.Engine.comp.kind, avg: s / (d.length / 4) / 3 };
  });
  console.log(JSON.stringify(r));
  await p.screenshot({ path: 'shots/80-2d.png' });
  const ex = await p.evaluate(async () => { const r = await Cutline.Export.run({ format: 'webm-vp9', w: 320, h: 180, fps: 30, quality: 'low', range: 'all', audio: false, captions: false }); return r.blob.size; });
  console.log('2d export bytes', ex);
  await p.evaluate(() => localStorage.removeItem('cutline.force2d'));
  console.log('ERRORS:', errs.join('\n'));
  await b.close();
})();
