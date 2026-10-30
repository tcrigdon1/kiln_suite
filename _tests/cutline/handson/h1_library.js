// 1. Welcome → new project → import (button + drag-drop) → views, search, folders
const H = require('./hlib');
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('h1');
  await H.boot(p);
  await H.shot(p, 'welcome');
  await H.newProjectUI(p, { name: 'Hands On' });
  const s = await p.evaluate(() => { const s = Cutline.P.seq(); return { w: s.w, h: s.h, fps: s.fps, name: Cutline.state.project.name }; });
  H.ok(s.w === 1920 && s.h === 1080 && s.fps === 30 && s.name === 'Hands On', 'new project 1080p30 named "Hands On" ' + JSON.stringify(s));
  await H.shot(p, 'empty-project');
  await H.importUI(p, ['main1080.webm', 'music.mp3', 'still.jpg']);
  await H.shot(p, 'imported-button');
  // drag-drop files onto library body
  const lib = await H.center(p, '#p-bin .bin-body');
  await H.dropFiles(p, ['silent.webm', 'logo_alpha.png', 'sweep.wav'], lib.x, lib.y);
  await H.waitReady(p, 6);
  H.ok((await p.evaluate(() => Cutline.state.project.media.length)) === 6, 'drag-drop import adds 3 more items');
  await H.shot(p, 'imported-drop');
  // list view
  await p.click('.bin-toolbar .icon-btn[data-tip="List view"]');
  await p.waitForTimeout(200);
  H.ok(await p.locator('table.bin-list tr.bin-item').count() >= 6, 'list view shows rows');
  await H.shot(p, 'list-view');
  // search
  await p.click('.bin-search input');
  await p.keyboard.type('webm');
  await p.waitForTimeout(200);
  const nSearch = await p.locator('#p-bin .bin-body [data-id]').count();
  H.ok(nSearch === 2, 'search "webm" filters to 2 items (got ' + nSearch + ')');
  await H.shot(p, 'search');
  await p.keyboard.press('Escape');
  await p.click('.bin-toolbar .icon-btn[data-tip="Grid view"]');
  // new folder (renames inline)
  await p.click('.bin-toolbar .icon-btn[data-tip="New folder"]');
  await p.waitForTimeout(150);
  await p.keyboard.type('Audio');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(200);
  const folders = await p.evaluate(() => Cutline.state.project.folders.map(f => f.name));
  H.ok(folders[0] === 'Audio', 'folder created & renamed: ' + folders);
  await H.shot(p, 'folder');
  // drag music.mp3 onto folder
  const music = await H.center(p, '#p-bin .bin-item:has(.name:text-is("music.mp3"))');
  const fold = await H.center(p, '#p-bin .bin-item:has(.name:text-is("Audio"))');
  await H.dnd(p, music.x, music.y, fold.x, fold.y);
  // ctrl-click second item & drag both
  const inFolder = await p.evaluate(() => Cutline.state.project.media.filter(m => m.folder).map(m => m.name));
  H.ok(inFolder.includes('music.mp3'), 'music.mp3 moved into folder via drag: ' + inFolder);
  // second move in list view (compact rows, everything visible)
  await p.click('.bin-toolbar .icon-btn[data-tip="List view"]');
  await p.waitForTimeout(150);
  await p.click('#p-bin tr.bin-item:has(.nm:text-is("sweep.wav"))');
  const sw = await H.center(p, '#p-bin tr.bin-item:has(.nm:text-is("sweep.wav"))');
  const fold2 = await H.center(p, '#p-bin tr.bin-item:has(.nm:text-is("Audio"))');
  await H.dnd(p, sw.x, sw.y, fold2.x, fold2.y);
  await H.shot(p, 'moved-into-folder');
  await p.click('.bin-toolbar .icon-btn[data-tip="Grid view"]');
  await p.waitForTimeout(150);
  // open folder by double-click, then back via crumb
  await p.dblclick('#p-bin .bin-item:has(.name:text-is("Audio"))');
  await p.waitForTimeout(200);
  H.ok(await p.locator('#p-bin .bin-body [data-id]').count() === 2, 'folder shows its 2 items');
  await H.shot(p, 'inside-folder');
  await p.click('#p-bin .bin-crumbs .crumb >> nth=0');
  await p.waitForTimeout(150);
  // hover-scrub thumbnail of a video
  const vid = await H.center(p, '#p-bin .bin-item:has(.name:text-is("main1080.webm")) .thumb');
  await p.mouse.move(vid.bb.x + 5, vid.y); await p.mouse.move(vid.bb.x + vid.bb.width * 0.7, vid.y, { steps: 5 });
  await H.shot(p, 'hover-scrub', { clip: { x: 0, y: 0, width: 420, height: 450 } });
  await p.mouse.move(800, 10);
  // properties via context menu
  await p.click('#p-bin .bin-item:has(.name:text-is("main1080.webm"))', { button: 'right' });
  await p.locator('.cl-menu .item', { hasText: 'Properties' }).click();
  await p.waitForTimeout(150);
  const props = await p.locator('.dialog .form-grid').innerText();
  H.ok(/1920 × 1080/.test(props) && /30 fps/.test(props), 'properties show 1920×1080 30fps');
  await H.shot(p, 'properties');
  await p.keyboard.press('Escape');
  // drop files directly on the timeline → imports and places
  const tl = await H.center(p, '#p-timeline .tl-scroll');
  await H.dropFiles(p, ['clip25.webm'], tl.bb.x + 100, await H.tlRowY(p, 'V1'));
  await H.waitReady(p, 7);
  await p.waitForTimeout(500);
  const cl = await H.clips(p);
  H.ok(cl.some(c => c.name === 'clip25.webm' && c.track === 'V1'), 'file dropped on timeline is placed on V1');
  await H.shot(p, 'dropped-on-timeline');
  // sequence mismatch prompt should appear for 1280x720@25 first clip
  const dlg = await p.locator('.dialog-head span').allInnerTexts();
  info('dialogs: ' + dlg.join(' | '));
  await H.finish(b, errs, 'h1_library');
  function info(m) { H.info(m); }
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
