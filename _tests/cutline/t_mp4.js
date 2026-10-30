const { TMP } = require('../env.js');
const { launch, newProject, importFiles } = require('./lib');
const fs = require('fs');
(async () => {
  const { b, p, errs } = await launch();
  await newProject(p);
  await importFiles(p, ['bars.webm', 'tone.wav']);
  await p.evaluate(() => { const C = Cutline; C.edit('x', s2 => { const m = C.state.project.media; C.T.placeMedia(s2, m[0], 0, C.P.vtracks(s2)[0].id, C.P.atracks(s2)[0].id, 'overwrite'); C.T.placeMedia(s2, m[1], 0, null, C.P.atracks(s2)[1].id, 'overwrite'); s2.inF = 0; s2.outF = 60; }); });
  for (const fmt of ['mp4-vp9', 'webm-vp8', 'wav', 'webm-opus']) {
    const res = await p.evaluate(async (fmt) => {
      const r = await Cutline.Export.run({ format: fmt, w: 640, h: 360, fps: 30, quality: 'medium', range: 'inout', audio: true, abitrate: 128000, captions: false });
      const u = new Uint8Array(await r.blob.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768));
      return { b64: btoa(s), ext: r.ext };
    }, fmt);
    const f = TMP + '/out-' + fmt + '.' + (res.ext || (fmt === 'wav' ? 'wav' : fmt.split('-')[0]));
    fs.writeFileSync(f, Buffer.from(res.b64, 'base64'));
    console.log(f);
  }
  console.log('ERRORS:\n' + errs.join('\n'));
  await b.close();
})();
