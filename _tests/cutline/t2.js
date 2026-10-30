const { TMP } = require('../env.js');
const { launch, newProject, importFiles } = require('./lib');
const fs = require('fs');
function assert(c, m) { if (!c) throw new Error('ASSERT: ' + m); console.log('  ok -', m); }
(async () => {
  const { b, p, errs } = await launch();
  try {
    await newProject(p);
    await importFiles(p, ['test1.webm', 'bars.webm', 'tone.wav', 'photo.png']);
    const mid = n => p.evaluate(n => Cutline.state.project.media.find(m => m.name === n).id, n);
    // place via drag onto V1
    const tlBox = await p.locator('.tl-scroll').boundingBox();
    const rowY = await p.evaluate(() => { const s = Cutline.P.seq(); const v1 = Cutline.P.vtracks(s)[0]; return Cutline.TL.rowOf(v1.id).y + 20; });
    await p.dragAndDrop(`.bin-item[data-id="${await mid('test1.webm')}"]`, '.tl-scroll', { targetPosition: { x: 2, y: rowY } });
    await p.waitForTimeout(300);
    let clips = await p.evaluate(() => Cutline.P.seq().clips.length);
    if (clips !== 2) { await p.screenshot({ path: 'shots/err-drag.png' }); console.log(await p.evaluate(() => JSON.stringify(Cutline.P.seq().clips.map(c => [c.kind, c.start, c.trackId])))); }
    assert(clips === 2, 'drag to timeline creates linked A/V clips');
    // second clip via source monitor + overwrite at end
    await p.dblclick(`.bin-item[data-id="${await mid('bars.webm')}"]`);
    await p.waitForTimeout(400);
    await p.keyboard.press('End'); // source: go to end? (focus source)
    await p.evaluate(() => { Cutline.state.focus = 'timeline'; Cutline.Engine.seek(Cutline.P.seqDuration(Cutline.P.seq())); });
    await p.evaluate(() => { Cutline.state.focus = 'timeline'; });
    await p.keyboard.press('.');
    await p.waitForTimeout(300);
    clips = await p.evaluate(() => Cutline.P.seq().clips.map(c => [c.kind, c.start, c.dur, c.name]));
    console.log(JSON.stringify(clips));
    assert(clips.length === 4, 'overwrite edit from source adds 2 clips');
    await p.evaluate(() => Cutline.TL.zoomFit());
    // play
    await p.evaluate(() => Cutline.Engine.seek(30));
    await p.keyboard.press('Space');
    await p.waitForTimeout(1200);
    await p.keyboard.press('Space');
    const f = await p.evaluate(() => Cutline.Engine.frame);
    console.log('frame after play', f);
    assert(f > 45, 'playback advances');
    await p.screenshot({ path: 'shots/04-played.png' });
    // check program canvas pixel non-black
    const px = await p.evaluate(() => { const d = Cutline.Engine.comp.readSmall(16, 9); let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4) / 3; });
    console.log('avg brightness', px);
    assert(px > 30, 'program shows composited video');
    // razor at frame 150 on V1
    await p.evaluate(() => Cutline.Engine.seek(150));
    await p.keyboard.press('c');
    const x150 = await p.evaluate(() => Cutline.TL.f2x(150));
    await p.mouse.click(tlBox.x + x150, tlBox.y + rowY);
    clips = await p.evaluate(() => Cutline.P.seq().clips.length);
    assert(clips === 6, 'razor splits linked clips (6 clips)');
    await p.keyboard.press('v');
    // trim: drag end of first clip left by ~ 30 frames
    const e1 = await p.evaluate(() => { const s = Cutline.P.seq(); const c = s.clips.filter(c => c.kind === 'video').sort((a, b) => a.start - b.start)[0]; return { x: Cutline.TL.f2x(c.start + c.dur), end: c.start + c.dur, ppf: Cutline.TL.ppf }; });
    await p.mouse.move(tlBox.x + e1.x - 2, tlBox.y + rowY);
    await p.mouse.down();
    await p.mouse.move(tlBox.x + e1.x - 2 - 30 * e1.ppf, tlBox.y + rowY, { steps: 5 });
    await p.mouse.up();
    const end2 = await p.evaluate(() => { const s = Cutline.P.seq(); const c = s.clips.filter(c => c.kind === 'video').sort((a, b) => a.start - b.start)[0]; return c.start + c.dur; });
    console.log('trim end', e1.end, '->', end2);
    assert(end2 < e1.end - 20, 'trim shortens clip');
    // move second video clip left to close gap (snap)
    const c2 = await p.evaluate(() => { const s = Cutline.P.seq(); const v = s.clips.filter(c => c.kind === 'video').sort((a, b) => a.start - b.start); return { x: Cutline.TL.f2x(v[1].start + 10), start: v[1].start }; });
    
    await p.mouse.move(tlBox.x + c2.x, tlBox.y + rowY);
    await p.mouse.down();
    await p.mouse.move(tlBox.x + c2.x - (c2.start - end2) * e1.ppf - 3, tlBox.y + rowY, { steps: 8 });
    await p.mouse.up();
    const st2 = await p.evaluate(() => { const s = Cutline.P.seq(); const v = s.clips.filter(c => c.kind === 'video').sort((a, b) => a.start - b.start); return v[1].start; });
    console.log('moved start', c2.start, '->', st2, 'expected', end2, 'ppf', e1.ppf, await p.evaluate(()=>JSON.stringify([Cutline.TL.ppf, Cutline.TL.snapPoints({}), Cutline.state.selection.length, Cutline.P.seq().clips.map(c=>[c.kind,c.start,c.dur])])));
    assert(st2 === end2, 'move with snapping to previous clip end');
    // add effect to first clip via double-click in effects panel
    await p.evaluate(() => { const s = Cutline.P.seq(); const v = s.clips.filter(c => c.kind === 'video').sort((a, b) => a.start - b.start); Cutline.A.select([v[0].id]); });
    await p.click('.tabs .tab[data-id="effects"]');
    await p.dblclick('.fxb-item[title="Film Look"]');
    await p.dblclick('.fxb-item[title="Vignette"]');
    const nfx = await p.evaluate(() => Cutline.P.primaryClip().fx.length);
    assert(nfx === 2, 'effects applied');
    // add transition at the cut via Ctrl+D
    await p.evaluate((f) => Cutline.Engine.seek(f), end2);
    await p.keyboard.press('Control+d');
    const ntr = await p.evaluate(() => Cutline.P.seq().transitions.length);
    assert(ntr >= 1, 'default transition added');
    await p.evaluate((f) => Cutline.Engine.seek(f - 2), end2);
    await p.waitForTimeout(500);
    await p.click('.tabs .tab[data-id="inspector"]');
    await p.screenshot({ path: 'shots/05-effects-transition.png' });
    // keyframes: opacity on first clip
    await p.evaluate(() => { const s = Cutline.P.seq(); const v = s.clips.filter(c => c.kind === 'video').sort((a, b) => a.start - b.start); Cutline.A.select([v[0].id]); Cutline.Engine.seek(v[0].start + 10); });
    await p.waitForTimeout(200);
    const opRow = p.locator('.cl-field', { hasText: 'Opacity' }).first();
    await opRow.locator('.kf-btn').first().click();
    await p.evaluate(() => Cutline.Engine.seek(60));
    await p.waitForTimeout(100);
    await opRow.locator('input[type=number]').fill('20');
    await opRow.locator('input[type=number]').press('Enter');
    await p.waitForTimeout(200);
    const kf = await p.evaluate(() => JSON.stringify(Cutline.P.primaryClip().kf['tf.op']));
    console.log('kf', kf);
    assert(JSON.parse(kf).length === 2, 'two opacity keyframes');
    const v45 = await p.evaluate(() => { const c = Cutline.P.primaryClip(); return Cutline.KF.value(c, 'tf.op', 35); });
    console.log('interp at 35', v45);
    assert(v45 < 100 && v45 > 20, 'keyframe interpolation');
    // title via text tool
    await p.keyboard.press('t');
    const pb = await p.locator('.mon-stage canvas.overlay').nth(1).boundingBox();
    await p.mouse.click(pb.x + pb.width * 0.5, pb.y + pb.height * 0.8);
    await p.waitForTimeout(300);
    const title = await p.evaluate(() => { const c = Cutline.P.primaryClip(); return c && c.gen && c.gen.kind; });
    assert(title === 'title', 'text tool creates title clip');
    await p.screenshot({ path: 'shots/06-title.png' });
    // undo/redo
    const before = await p.evaluate(() => Cutline.P.seq().clips.length);
    await p.keyboard.press('Control+z');
    const afterU = await p.evaluate(() => Cutline.P.seq().clips.length);
    await p.keyboard.press('Control+Shift+z');
    const afterR = await p.evaluate(() => Cutline.P.seq().clips.length);
    console.log('undo/redo', before, afterU, afterR);
    assert(afterU === before - 1 && afterR === before, 'undo/redo');
    // save project (download fallback)
    await p.evaluate(() => { window.showSaveFilePicker = undefined; Cutline.Export.noPicker = true; });
    const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+s')]);
    const proj = TMP + '/test.kcut'; await dl.saveAs(proj);
    const txt = fs.readFileSync(proj, 'utf8');
    const j = JSON.parse(txt);
    assert(j.app === 'Cutline' && j.sequences[0].clips.length === afterR, 'project saved as .kcut JSON');
    // reload project in page
    await p.evaluate((t) => Cutline.IO.load(t, null), txt);
    await p.waitForTimeout(1000);
    const after = await p.evaluate(() => ({ clips: Cutline.P.seq().clips.length, offline: Cutline.Media.offlineMedia().length }));
    console.log('after load', after);
    assert(after.clips === afterR, 'project loads');
    await p.screenshot({ path: 'shots/07-loaded.png' });
    // close any relink dialog
    await p.evaluate(() => Cutline.ui.openDialogs.slice().forEach(d => d.close()));
    // export WebM
    await p.evaluate(() => { Cutline.Engine.seek(0); });
    const t0 = Date.now();
    const res = await p.evaluate(async () => {
      const r = await Cutline.Export.run({ format: 'webm-vp9', w: 640, h: 360, fps: 30, quality: 'medium', range: 'all', audio: true, abitrate: 128000, captions: true });
      const ab = await r.blob.arrayBuffer();
      let s = ''; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768));
      return btoa(s);
    });
    fs.writeFileSync(TMP + '/out.webm', Buffer.from(res, 'base64'));
    console.log('export took', (Date.now() - t0) / 1000, 's');
  } catch (e) { console.log('TEST ERROR', e); await p.screenshot({ path: 'shots/err.png' }); }
  console.log('ERRORS:\n' + errs.join('\n'));
  await b.close();
})();
