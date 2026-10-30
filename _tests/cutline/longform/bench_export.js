// Export speed micro-benchmark (not part of the suite): 20 s of main1080 at 640x360, run twice, with the time split.
// Pass "plain" to disable the second-pass hooks at runtime (frame blending / proxies / LUT / render cache) for an A/B.
const { ROOT } = require('../../env.js');
const L = require('./lflib');
(async () => {
  const { b, p, errs } = await L.launch({});
  await L.boot(p, '?test=1');
  await p.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'imp'; document.body.appendChild(i); });
  await p.setInputFiles('#imp', [ROOT + '/_tests/cutline/handson/media/main1080.webm']);
  await p.evaluate(async () => { const C = Cutline; const ms = await C.Media.importFiles(Array.from(document.getElementById('imp').files)); });
  await p.waitForFunction(() => Cutline.state.project.media.every(m => Cutline.MRT[m.id] && Cutline.MRT[m.id].status === 'ready'));
  const plain = process.argv.includes('plain');
  const r = await p.evaluate(async (plain) => {
    const C = Cutline, P = C.P, T = C.T;
    if (plain) { C.SourceProvider.prototype.blendSource = undefined; C.Proxy = null; C.RenderCache = null; C.LUT = null; }
    C.edit('setup', (s, prj) => { const m = prj.media.find(x => /main1080/.test(x.name)); T.placeMedia(s, m, 0, P.vtracks(s)[0].id, P.atracks(s)[0].id, 'overwrite', 0, 20); });
    const s = P.seq(), st = { format: 'webm-vp9', res: 'custom', w: 640, h: 360, fps: 30, quality: 'low', range: 'all', audio: true, abitrate: 96000, captions: false, name: 'bench', seqId: s.id };
    const out = [];
    for (let i = 0; i < 2; i++) { const t0 = performance.now(); const rr = await C.Export.run(st, () => { }, { v: false }, null); const st2 = Object.assign({}, C.Export.lastStats); out.push({ secs: Math.round((performance.now() - t0) / 100) / 10, fps: Math.round(600 / ((performance.now() - t0) / 1000) * 10) / 10, size: rr.blob.size, prepare: Math.round(st2.prepare), render: Math.round(st2.render), encode: Math.round(st2.encode), wait: Math.round(st2.wait), audio: Math.round(st2.audio) }); }
    return out;
  }, plain);
  console.log((plain ? 'plain ' : 'full  ') + JSON.stringify(r));
  await b.close();
})();
