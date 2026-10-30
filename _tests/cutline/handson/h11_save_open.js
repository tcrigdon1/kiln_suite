// 14. Save (download), reload, open, relink (fresh browser profile = no media cache), autosave recovery
const H = require('./hlib');
(async () => {
  let { b, ctx, p, errs } = await H.launch();
  H.setPrefix('h11');
  await H.boot(p);
  await H.newProjectUI(p, { name: 'Save Test' });
  await H.importUI(p, ['main1080.webm', 'music.mp3', 'still.jpg']);
  const sr = await H.center(p, '#p-timeline .tl-scroll');
  let it = await H.center(p, '#p-bin .bin-item:has(.name:text-is("main1080.webm"))');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V1'));
  await H.key(p, 'Backslash');
  it = await H.center(p, '#p-bin .bin-item:has(.name:text-is("still.jpg"))');
  await H.dnd(p, it.x, it.y, await H.tlX(p, 100), await H.tlRowY(p, 'V2'));
  it = await H.center(p, '#p-bin .bin-item:has(.name:text-is("music.mp3"))');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'A2'));
  await p.mouse.click(await H.tlX(p, 200), (await H.center(p, '#p-timeline .tl-ruler-hit')).y);
  await p.mouse.click(await H.tlX(p, 10), await H.tlRowY(p, 'V3'));
  await H.key(p, 'm');
  const snapshot = await p.evaluate(() => JSON.stringify(Cutline.P.seq().clips.map(c => [c.name, c.start, c.dur, c.trackId])) + '|' + Cutline.P.seq().markers.length);
  H.ok((await p.locator('#menubar .proj-name').innerText()).includes('•'), 'unsaved indicator shown in the menubar');
  // --- Ctrl+S → download .kcut
  const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Control+s')]);
  const kcut = H.SHOTS + '../Save Test.kcut';
  await dl.saveAs(kcut);
  H.ok(dl.suggestedFilename() === 'Save Test.kcut', 'Ctrl+S downloads "' + dl.suggestedFilename() + '"');
  await p.waitForTimeout(200);
  H.ok(!(await p.locator('#menubar .proj-name').innerText()).includes('•'), 'saved: unsaved indicator cleared');
  const json = JSON.parse(H.fs.readFileSync(kcut, 'utf8'));
  H.ok(json.app === 'Cutline' && json.sequences[0].clips.length === 4, 'saved file is a Cutline project with 4 clips');
  await H.shot(p, 'saved');
  // --- make an unsaved change, then reload → autosave recovery offered on the welcome screen
  await H.key(p, 'Home'); await H.key(p, 'm');
  await p.waitForTimeout(200);
  await p.evaluate(() => new Promise(r => setTimeout(r, 50)));
  await p.reload();
  await p.waitForFunction(() => window.Cutline && window.Cutline.ready);
  await p.waitForTimeout(300);
  await H.shot(p, 'welcome-recovery');
  const recBtn = p.locator('.dialog .welcome button:has-text("Recover Last Session")');
  H.ok(await recBtn.count() === 1, 'welcome offers "Recover Last Session" after reload');
  await recBtn.click();
  await p.waitForFunction(() => !!Cutline.state.project);
  await p.waitForTimeout(800);
  const rec = await p.evaluate(() => ({ name: Cutline.state.project.name, markers: Cutline.P.seq().markers.length, clips: Cutline.P.seq().clips.length, offline: Cutline.Media.offlineMedia().length }));
  H.ok(rec.name === 'Save Test' && rec.markers === 2 && rec.clips === 4, 'recovered session includes the unsaved marker: ' + JSON.stringify(rec));
  // relink dialog may appear if the cache couldn't restore media
  await p.waitForTimeout(800);
  await H.shot(p, 'recovered');
  const dlgs = await p.locator('.dialog-head span').allInnerTexts();
  H.info('dialogs after recovery: ' + dlgs.join(' | ') + ' offline=' + rec.offline);
  if (dlgs.some(t => /Relink/.test(t))) await p.locator('.dialog-foot .btn:text-is("Close")').click();
  const prev = await H.progHash(p);
  H.ok(prev !== 0, 'program renders after recovery');
  await b.close();
  // --- brand-new profile (no cache/autosave): open the .kcut → relink flow
  ({ b, ctx, p, errs } = await H.launch());
  await H.boot(p);
  await H.shot(p, 'fresh-welcome');
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('.dialog .welcome button:has-text("Open Project")')]);
  await fc.setFiles(kcut);
  await p.waitForFunction(() => !!Cutline.state.project);
  await p.waitForTimeout(1200);
  await H.shot(p, 'relink-dialog');
  const relink = await p.locator('.dialog-head span:text-is("Relink Media")').count();
  H.ok(relink === 1, 'opening a project whose media is not cached shows the Relink dialog');
  const offRows = await p.locator('.relink-row .st.off').count();
  H.ok(offRows === 3, '3 files listed offline (' + offRows + ')');
  const tl = await p.evaluate(() => JSON.stringify(Cutline.P.seq().clips.map(c => [c.name, c.start, c.dur, c.trackId])) + '|' + Cutline.P.seq().markers.length);
  H.ok(tl === snapshot, 'timeline restored exactly from the file');
  // select all three files at once → matched by name
  const [fc2] = await Promise.all([p.waitForEvent('filechooser'), p.click('.dialog-foot .btn:text-is("Select Files…")')]);
  await fc2.setFiles(['main1080.webm', 'music.mp3', 'still.jpg'].map(n => H.MEDIA + n));
  await p.waitForFunction(() => Cutline.Media.offlineMedia().length === 0, null, { timeout: 30000 });
  await p.waitForTimeout(800);
  H.ok((await p.locator('.relink-row .st.on').count()) === 3, 'all 3 files relinked (rows show ONLINE)');
  await H.shot(p, 'relinked');
  await p.locator('.dialog-foot .btn:text-is("Close")').click();
  await p.waitForTimeout(500);
  await p.mouse.click(await H.tlX(p, 30), (await H.center(p, '#p-timeline .tl-ruler-hit')).y);
  await p.waitForTimeout(800);
  const px = await H.progPixels(p, [[0.5, 0.5]]);
  H.ok(px[0][0] + px[0][1] + px[0][2] > 60, 'relinked media renders in the program monitor ' + JSON.stringify(px));
  await H.shot(p, 'after-relink');
  // --- open a non-project file → friendly error, app keeps working
  const fcP = p.waitForEvent('filechooser', { timeout: 6000 }).catch(() => null);
  await p.keyboard.press('Control+o');
  await p.waitForTimeout(300);
  if (await p.locator('.dialog-foot .btn:text-is("Discard")').count()) { await H.shot(p, 'discard-confirm'); await p.click('.dialog-foot .btn:text-is("Discard")'); }
  const fc3 = await fcP;
  if (fc3) {
    await fc3.setFiles(H.MEDIA + 'subs.srt');
    await p.waitForTimeout(400);
    const t = await p.locator('.dialog-head span').allInnerTexts();
    H.ok(t.some(x => /Cannot open project/.test(x)), 'opening a non-project shows "Cannot open project" (' + t.join('|') + ')');
    await H.shot(p, 'bad-file');
    await p.keyboard.press('Enter');
  } else H.ok(false, 'Ctrl+O opens a file chooser');
  H.ok(await p.evaluate(() => Cutline.P.seq().clips.length === 4), 'project still open after the failed open');
  await H.finish(b, errs, 'h11_save_open');
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
