
const { chromium } = require('playwright');
const { newProject, importFiles } = require('./lib');
function assert(c, m) { if (!c) throw new Error('ASSERT: ' + m); console.log('  ok -', m); }
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 950 }, permissions: ['microphone'] });
  const p = await ctx.newPage(); const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  try {
    await newProject(p);
    await importFiles(p, ['test1.webm', 'bars.webm']);
    await p.evaluate(() => { const C = Cutline; C.edit('x', s2 => { const m = C.state.project.media, v = C.P.vtracks(s2)[0].id, a = C.P.atracks(s2)[0].id; C.T.placeMedia(s2, m[0], 0, v, a, 'overwrite', 0, 4); C.T.placeMedia(s2, m[1], 120, v, a, 'overwrite', 0, 4); }); C.TL.zoomFit(); });
    const rowY = await p.evaluate(() => Cutline.TL.rowOf(Cutline.P.vtracks(Cutline.P.seq())[0].id).y + 30);
    const x60 = await p.evaluate(() => Cutline.TL.f2x(60)), x118 = await p.evaluate(() => Cutline.TL.f2x(117));
    await p.click('.tabs .tab[data-id="effects"]');
    await p.dragAndDrop('.fxb-item[title="Sepia"]', '.tl-scroll', { targetPosition: { x: x60, y: rowY } });
    await p.waitForTimeout(200);
    const fx = await p.evaluate(() => Cutline.P.seq().clips.filter(c => c.kind === 'video').sort((a, b) => a.start - b.start)[0].fx.map(f => f.type));
    assert(fx[0] === 'sepia', 'drag effect onto clip');
    await p.click('.tabs .tab[data-id="effects"]');
    await p.dragAndDrop('.fxb-item[title="Iris Round"]', '.tl-scroll', { targetPosition: { x: x118, y: rowY } });
    await p.waitForTimeout(200);
    const tr = await p.evaluate(() => Cutline.P.seq().transitions.map(t => [t.type, !!t.a, !!t.b]));
    console.log(JSON.stringify(tr));
    assert(tr.length === 1 && tr[0][0] === 'iris' && tr[0][1] && tr[0][2], 'drag transition onto cut (two-sided)');
    // audio transition drag on audio clip
    const arow = await p.evaluate(() => Cutline.TL.rowOf(Cutline.P.atracks(Cutline.P.seq())[0].id).y + 30);
    await p.click('.tabs .tab[data-id="effects"]');
    await p.dragAndDrop('.fxb-item[title="Constant Power"]', '.tl-scroll', { targetPosition: { x: x118, y: arow } });
    await p.waitForTimeout(200);
    assert(await p.evaluate(() => Cutline.P.seq().transitions.length) === 2, 'audio crossfade by drag');
    // folders
    await p.click('.tabs .tab[data-id="library"]');
    await p.evaluate(() => Cutline.Bin.newFolder());
    await p.keyboard.press('Enter');
    await p.waitForTimeout(200);
    const fid = await p.evaluate(() => Cutline.state.project.folders[0].id);
    const mid = await p.evaluate(() => Cutline.state.project.media[1].id);
    await p.dragAndDrop(`.bin-item[data-id="${mid}"]`, `.bin-item[data-id="${fid}"]`);
    await p.waitForTimeout(200);
    assert(await p.evaluate((mid) => Cutline.P.media(mid).folder, mid) === fid, 'drag media into folder');
    await p.dblclick(`.bin-item[data-id="${fid}"]`);
    await p.waitForTimeout(100);
    assert(await p.locator('.bin-item').count() === 1, 'folder view shows contents');
    await p.click('.bin-crumbs .crumb >> nth=0');
    // list view + search
    await p.click('.bin-toolbar .icon-btn[aria-label="List view"]');
    await p.fill('.bin-search input', 'bars');
    await p.waitForTimeout(100);
    assert(await p.locator('.bin-list tr.bin-item').count() === 1, 'search filter in list view');
    await p.screenshot({ path: 'shots/50-listview.png' });
    await p.fill('.bin-search input', '');
    await p.click('.bin-toolbar .icon-btn[aria-label="Grid view"]');
    // inline title text edit
    await p.evaluate(() => { Cutline.Engine.seek(30); Cutline.A.addTitleAtPlayhead(); Cutline.Engine.seek(40); });
    await p.waitForTimeout(400);
    const ov = await p.locator('#p-program canvas.overlay').boundingBox();
    const b2 = await p.evaluate(() => { const C = Cutline, s = C.P.seq(), L = C.P.primaryClip().gen.layers[0]; return C.Titles.layerBounds(L, s.w, s.h, 1920); });
    const k = ov.width / 1280;
    await p.mouse.dblclick(ov.x + (b2.x + b2.w / 2) * k, ov.y + (b2.y + b2.h / 2) * k);
    await p.waitForTimeout(200);
    await p.keyboard.type('Inline Edit');
    await p.keyboard.press('Control+Enter');
    const tt = await p.evaluate(() => Cutline.P.primaryClip().gen.layers[0].text);
    assert(tt === 'Inline Edit', 'inline text edit on program monitor');
    // voiceover with fake mic
    await p.click('.tabs .tab[data-id="audio"]');
    await p.evaluate(() => { Cutline.Engine.seek(0); });
    await p.click('.pane-toolbar button:has-text("Record Voiceover")');
    await p.waitForTimeout(1500);
    await p.click('.pane-toolbar button:has-text("Stop Recording")');
    await p.waitForFunction(() => Cutline.state.project.media.some(m => /^Voiceover/.test(m.name) && Cutline.MRT[m.id] && Cutline.MRT[m.id].status === 'ready'), null, { timeout: 15000 });
    await p.waitForTimeout(300);
    const vo = await p.evaluate(() => { const m = Cutline.state.project.media.find(m => /^Voiceover/.test(m.name)); return { dur: m.duration, clip: !!Cutline.P.seq().clips.find(c => c.mediaId === m.id) }; });
    console.log('voiceover', JSON.stringify(vo));
    assert(vo.clip && vo.dur > 0.5, 'voiceover recorded and placed');
    await p.screenshot({ path: 'shots/51-voiceover.png' });
  } catch (e) { console.log('TEST ERROR', e); await p.screenshot({ path: 'shots/err.png' }); }
  console.log('ERRORS:\n' + errs.join('\n').slice(0, 3000));
  await b.close();
})();
