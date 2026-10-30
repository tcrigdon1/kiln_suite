const { TMP } = require('../env.js');
const { launch, newProject, importFiles } = require('./lib');
const fs = require('fs');
(async () => {
  const { b, p, errs } = await launch();
  await newProject(p);
  const files = ['test1.webm', 'vp9.mp4', 'frag.mp4', 'vp8.webm'];
  await importFiles(p, files);
  for (const f of files) {
    const info = await p.evaluate(async (f) => { const m = Cutline.state.project.media.find(x => x.name === f); const i = await Cutline.FrameDecoder.infoFor(m); return i ? { codec: i.codec, n: i.samples.length, keys: i.samples.filter(s => s.key).length, first: i.byPts[0].pts, w: i.width } : null; }, f);
    console.log(f, JSON.stringify(info));
    if (f === 'test2.mp4') continue;
    for (const fast of [true, false]) {
      const r = await p.evaluate(async ({ f, fast }) => {
        const C = Cutline;
        C.edit('x', s2 => { s2.clips = []; const m = C.state.project.media.find(x => x.name === f); C.T.placeMedia(s2, m, 0, C.P.vtracks(s2)[0].id, null, 'overwrite', 0.5, 3.5); });
        const t0 = performance.now();
        const res = await C.Export.run({ format: 'webm-vp9', w: 640, h: 360, fps: 30, quality: 'high', range: 'all', audio: false, captions: false, fastDecode: fast });
        const u = new Uint8Array(await res.blob.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768));
        return { ms: performance.now() - t0, b64: btoa(s) };
      }, { f, fast });
      const out = `${TMP}/dec-${f}-${fast ? 'fast' : 'seek'}.webm`;
      fs.writeFileSync(out, Buffer.from(r.b64, 'base64'));
      console.log('  ', fast ? 'fast' : 'seek', (r.ms / 1000).toFixed(1) + 's');
    }
  }
  console.log('ERRORS:\n' + errs.join('\n').slice(0, 2000));
  await b.close();
})();
