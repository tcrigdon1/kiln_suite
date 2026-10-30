const { launch, newProject, importFiles } = require('./lib');
(async () => {
  for (const vp of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
    const { b, p, errs } = await launch({ viewport: vp });
    try {
      await newProject(p);
      await importFiles(p, ['test1.webm', 'bars.webm', 'tone.wav', 'photo.png', 'green.png']);
      await p.evaluate(() => {
        const C = Cutline, m = n => C.state.project.media.find(x => x.name === n);
        C.edit('build', s2 => {
          const v = C.P.vtracks(s2), a = C.P.atracks(s2);
          C.T.placeMedia(s2, m('test1.webm'), 0, v[0].id, a[0].id, 'overwrite', 0, 6);
          C.T.placeMedia(s2, m('bars.webm'), 180, v[0].id, a[0].id, 'overwrite', 0, 4);
          C.T.placeMedia(s2, m('photo.png'), 300, v[0].id, null, 'overwrite');
          C.T.placeMedia(s2, m('tone.wav'), 30, null, a[1].id, 'overwrite');
          const g = C.T.placeMedia(s2, m('green.png'), 60, v[1].id, null, 'overwrite');
          g[0].fx.push(C.FX.newInstance('chromakey')); g[0].tf.scale = 40; g[0].tf.x = 960; g[0].tf.y = 200;
          const cl = s2.clips.filter(c => c.kind === 'video' && c.trackId === v[0].id).sort((x, y) => x.start - y.start);
          C.A.placeTransition(s2, cl[1], 'in', 'cross', 20);
          C.A.placeTransition(s2, cl[2], 'in', 'push', 20);
          cl[0].fx.push(C.FX.newInstance('look'));
          cl[0].kf['tf.scale'] = [{ f: 0, v: 100, e: 'inout' }, { f: 150, v: 115, e: 'linear' }];
          s2.markers.push({ id: 'm1', f: 90, name: 'Beat', color: '#3dbfae', note: '', dur: 0 });
          s2.markers.push({ id: 'm2', f: 240, name: 'Cut here', color: '#e5534b', note: '', dur: 0 });
          s2.captions.push({ id: 'c1', start: 20, end: 100, text: 'Welcome to Cutline' });
          s2.inF = 30; s2.outF = 260;
        });
        const t = C.A.addTitleAtPlayhead(null, null, 'lower');
        C.edit('mv', s2 => { const c = C.P.clip(s2, t.id); c.start = 100; c.dur = 120; });
        C.TL.zoomFit();
        C.A.select([C.P.seq().clips.find(c => c.mediaId === m('test1.webm').id && c.kind === 'video').id]);
        C.Engine.seek(130);
      });
      await p.waitForTimeout(1500);
      await p.screenshot({ path: `shots/40-session-${vp.width}.png` });
    } catch (e) { console.log('TEST ERROR', e); }
    console.log(vp.width, 'ERRORS:', errs.join('\n').slice(0, 1000));
    await b.close();
  }
})();
