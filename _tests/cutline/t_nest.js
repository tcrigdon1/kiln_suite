const { launch, newProject, importFiles } = require('./lib');
function assert(c, m) { if (!c) throw new Error('ASSERT: ' + m); console.log('  ok -', m); }
(async () => {
  const { b, p, errs } = await launch();
  try {
    await newProject(p);
    await importFiles(p, ['test1.webm', 'photo.png', 'tone.wav']);
    await p.evaluate(() => {
      const C = Cutline, m = n => C.state.project.media.find(x => x.name === n);
      C.edit('b', s2 => { const v = C.P.vtracks(s2), a = C.P.atracks(s2); C.T.placeMedia(s2, m('test1.webm'), 0, v[0].id, a[0].id, 'overwrite', 0, 4); const ph = C.T.placeMedia(s2, m('photo.png'), 30, v[1].id, null, 'overwrite'); ph[0].tf.scale = 40; C.T.placeMedia(s2, m('tone.wav'), 0, null, a[1].id, 'overwrite', 0, 3); });
      C.A.selectAll();
    });
    const before = await p.evaluate(async () => { const C = Cutline; C.Engine.seek(60); C.Engine.renderNow(); await new Promise(r => setTimeout(r, 600)); C.Engine.renderNow(); return Array.from(C.Engine.comp.readSmall(8, 4)); });
    const audioBefore = await p.evaluate(async () => { const b = await Cutline.Mixer.renderOffline(Cutline.P.seq(), 0, 4, 48000); const d = b.getChannelData(0); let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; return Math.sqrt(s / d.length); });
    await p.keyboard.press('Control+g');
    const st = await p.evaluate(() => ({ seqs: Cutline.state.project.sequences.length, clips: Cutline.P.seq().clips.map(c => [c.kind, c.start, c.dur, Cutline.P.media(c.mediaId).type]) }));
    console.log(JSON.stringify(st));
    assert(st.seqs === 2 && st.clips.length === 2 && st.clips[0][3] === 'nest', 'nest replaces clips with nested clip');
    const after = await p.evaluate(async () => { const C = Cutline; C.Engine.seek(60); C.Engine.renderNow(); await new Promise(r => setTimeout(r, 800)); C.Engine.renderNow(); return Array.from(C.Engine.comp.readSmall(8, 4)); });
    let diff = 0; for (let i = 0; i < before.length; i++) diff += Math.abs(before[i] - after[i]); diff /= before.length;
    console.log('pixel diff before/after nest', diff.toFixed(2));
    assert(diff < 6, 'nested render matches original');
    const audioAfter = await p.evaluate(async () => { const b = await Cutline.Mixer.renderOffline(Cutline.P.seq(), 0, 4, 48000); const d = b.getChannelData(0); let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; return Math.sqrt(s / d.length); });
    console.log('audio rms', audioBefore.toFixed(4), audioAfter.toFixed(4));
    assert(Math.abs(audioBefore - audioAfter) < 0.002, 'nested audio matches original');
    await p.screenshot({ path: 'shots/90-nested.png' });
    // dblclick nest -> opens inner
    const tl = await p.locator('.tl-scroll').boundingBox();
    const xy = await p.evaluate(() => { const C = Cutline, s = C.P.seq(), c = s.clips.find(c => c.kind === 'video'); return { x: C.TL.f2x(c.start + 20), y: C.TL.rowOf(c.trackId).y + 30 }; });
    await p.mouse.dblclick(tl.x + xy.x, tl.y + xy.y);
    await p.waitForTimeout(200);
    assert(await p.evaluate(() => Cutline.P.seq().clips.length) === 4, 'double-click opens nested sequence');
    // edit inside -> outer nest duration updates
    await p.evaluate(() => { const C = Cutline; C.edit('trim', s2 => { const c = s2.clips.find(c => c.kind === 'video' && C.P.media(c.mediaId).type === 'video'); C.T.setEnd(s2, c, 150); }); });
    const nd = await p.evaluate(() => Cutline.state.project.media.find(m => m.type === 'nest').duration);
    console.log('nest dur', nd);
    // export containing nest
    await p.click('.seq-tab >> nth=0');
    const sz = await p.evaluate(async () => { const r = await Cutline.Export.run({ format: 'webm-vp9', w: 320, h: 180, fps: 30, quality: 'low', range: 'all', audio: true, captions: false }); return r.blob.size; });
    assert(sz > 10000, 'export with nested sequence (' + sz + ' bytes)');
  } catch (e) { console.log('TEST ERROR', e); await p.screenshot({ path: 'shots/err.png' }); }
  console.log('ERRORS:\n' + errs.join('\n').slice(0, 3000));
  await b.close();
})();
