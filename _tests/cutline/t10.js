const { launch, newProject, importFiles } = require('./lib');
(async () => {
  const { b, p, errs } = await launch({ viewport: { width: 1600, height: 950 } });
  await newProject(p);
  await importFiles(p, ['test1.webm', 'noise.mp3', 'tone.wav']);
  await p.evaluate(() => {
    const C = Cutline, m = n => C.state.project.media.find(x => x.name === n);
    C.edit('b', s2 => {
      const v = C.P.vtracks(s2), a = C.P.atracks(s2);
      const r = C.T.placeMedia(s2, m('test1.webm'), 0, v[0].id, a[0].id, 'overwrite', 0, 5);
      r[1].fadeIn = 20; r[1].fadeOut = 30; r[0].kf['tf.op'] = [{ f: 0, v: 0, e: 'linear' }, { f: 20, v: 100, e: 'linear' }, { f: 120, v: 100, e: 'linear' }];
      const n = C.T.placeMedia(s2, m('noise.mp3'), 40, null, a[1].id, 'overwrite');
      n[0].au.vol = -6; n[0].kf['au.vol'] = [{ f: 0, v: -20, e: 'linear' }, { f: 60, v: 0, e: 'linear' }];
      C.T.placeMedia(s2, m('tone.wav'), 150, null, a[0].id, 'overwrite', 0, 3);
      C.A.placeTransition(s2, s2.clips.find(c => c.mediaId === m('tone.wav').id), 'in', 'a_power', 20);
      s2.tracks.forEach(t => { if (t.kind === 'audio') t.h = 80; });
    });
    C.TL.ppf = 6; C.TL.updateSpacer(); C.TL.redraw();
    C.A.select([C.P.seq().clips.find(c => c.kind === 'audio').id]);
    C.Engine.seek(30);
  });
  await p.waitForTimeout(1200);
  await p.locator('#p-timeline').screenshot({ path: 'shots/70-timeline-detail.png' });
  console.log('ERRORS:', errs.join('\n'));
  await b.close();
})();
