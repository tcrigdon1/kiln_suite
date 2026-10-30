// Compiles & renders every video effect, transition, blend mode, title preset and generated item.
const { launch, newProject, importFiles } = require('./lib');
(async () => {
  const { b, p, errs } = await launch();
  await newProject(p);
  await importFiles(p, ['test1.webm', 'photo.png']);
  const res = await p.evaluate(async () => {
    const C = Cutline, out = [];
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const avg = () => { const d = C.Engine.comp.readSmall(16, 9); let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return Math.round(s / (d.length / 4) / 3); };
    C.edit('x', s2 => { C.T.placeMedia(s2, C.state.project.media[0], 0, C.P.vtracks(s2)[0].id, null, 'overwrite'); C.T.placeMedia(s2, C.state.project.media[0], 300, C.P.vtracks(s2)[0].id, null, 'overwrite'); });
    C.Engine.seek(30); C.Engine.renderNow(); await sleep(400); C.Engine.renderNow();
    out.push(['base', avg()]);
    for (const d of C.FX.list.filter(x => !x.audio)) {
      C.edit('fx', s2 => { s2.clips[0].fx = [C.FX.newInstance(d.id)]; });
      C.Engine.renderNow(); out.push(['fx:' + d.id, avg()]);
    }
    C.edit('fx', s2 => { s2.clips[0].fx = []; });
    for (const d of C.TR.forKind('video')) {
      C.edit('tr', s2 => { s2.transitions = [{ id: 't1', type: d.id, a: s2.clips[0].id, b: s2.clips[1].id, dur: 30, align: 'center', params: C.TR.defaults(d.id), trackId: s2.clips[0].trackId }]; });
      C.Engine.seek(300); C.Engine.renderNow(); await sleep(30); C.Engine.renderNow(); out.push(['tr:' + d.id, avg()]);
    }
    C.edit('tr', s2 => { s2.transitions = []; });
    C.Engine.seek(30);
    for (const bm of C.Scene.BLENDS) {
      C.edit('b', s2 => { s2.clips[0].blend = bm[0]; }); C.Engine.renderNow(); out.push(['blend:' + bm[0], avg()]);
    }
    // color grade
    C.edit('col', s2 => { const c = s2.clips[0]; c.blend = 'normal'; c.col = C.P.defaultColor(); c.col.exposure = 0.5; c.col.look = 'ember'; c.col.shX = 40; c.col.curves.m = [[0, 0], [0.5, 0.6], [1, 1]]; c.col.vig = 40; });
    C.Engine.renderNow(); out.push(['color', avg()]);
    // titles & gens
    for (const pr of C.Titles.PRESETS) { const m = C.A.newGen('title', pr.id); C.edit('t', s2 => { C.T.placeMedia(s2, m, 0, C.P.vtracks(s2)[1].id, null, 'overwrite'); }); C.Engine.renderNow(); out.push(['title:' + pr.id, avg()]); }
    for (const k of ['solid', 'gradient', 'bars', 'countdown', 'adjust']) { const m = C.A.newGen(k); C.edit('g', s2 => { C.T.placeMedia(s2, m, 0, C.P.vtracks(s2)[2].id, null, 'overwrite'); if (k === 'adjust') s2.clips[s2.clips.length - 1].fx = [C.FX.newInstance('bw')]; }); C.Engine.renderNow(); out.push(['gen:' + k, avg()]); }
    return out;
  });
  console.log(res.map(r => r.join('=')).join('  '));
  console.log('ERRORS:\n' + errs.join('\n').slice(0, 3000));
  await b.close();
})();
