// Hands-on session 7: export PNG/JPEG, save project & reopen, context menus, flyouts, Window menu,
// reset workspace, preferences, shortcuts rebind; layout at 1366×768.
const { launch, assert, near, ASSETS, ROOT } = require('./lib');
const path = require('path');
const fs = require('fs');
const DL = path.join(ROOT, 'downloads'); fs.mkdirSync(DL, { recursive: true });

(async () => {
  const H = await launch();
  const { page } = H;
  await page.locator('.welcome-quick .btn', { hasText: '1080 × 1080' }).click();
  await H.wait(300);
  // some content: a shape, a text layer and a brush stroke
  await H.tool('ellipse');
  await H.dragDoc([[200, 200], [700, 600]]);
  await H.key('t');
  await H.clickDoc(150, 850);
  await page.keyboard.type('Saved & reopened');
  await page.keyboard.press('Control+Enter');
  await H.key('Control+Shift+n');
  await H.key('b');
  await H.dragDoc([[100, 100], [900, 150]]);

  await H.step('Export As dialog → PNG download', async () => {
    await H.menu('File', 'Export As…');
    await H.wait(500);
    await H.shot('s7-01-export-dialog');
    const [dl] = await Promise.all([page.waitForEvent('download'), H.dialogBtn('Export')]);
    const p = path.join(DL, dl.suggestedFilename()); await dl.saveAs(p);
    const sig = fs.readFileSync(p).slice(0, 8).toString('hex');
    assert(sig === '89504e470d0a1a0a', 'not a PNG: ' + sig + ' ' + dl.suggestedFilename());
  });

  await H.step('Export As dialog → JPEG download', async () => {
    await page.keyboard.press('Control+Alt+s');
    await H.wait(400);
    await page.locator('.gesso-dialog select').first().selectOption('jpeg');
    await H.wait(400);
    await H.shot('s7-02-export-jpeg');
    const [dl] = await Promise.all([page.waitForEvent('download'), H.dialogBtn('Export')]);
    const p = path.join(DL, dl.suggestedFilename()); await dl.saveAs(p);
    const sig = fs.readFileSync(p).slice(0, 3).toString('hex');
    assert(sig === 'ffd8ff' && /\.jpg$/.test(dl.suggestedFilename()), 'not a JPEG: ' + sig + ' ' + dl.suggestedFilename());
  });

  let proj;
  await H.step('Save project (Ctrl+S) and reopen it with File ▸ Open', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
    proj = path.join(DL, dl.suggestedFilename()); await dl.saveAs(proj);
    assert(/\.kgesso$/.test(proj), proj);
    const before = await H.state();
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), H.menu('File', 'Open…')]);
    await fc.setFiles(proj);
    await H.wait(1200);
    const n = await H.ev(() => Gesso.app.docs.length);
    assert(n === 2, 'docs ' + n);
    const after = await H.state();
    assert(JSON.stringify(after.layers.map((l) => l.name + l.type)) === JSON.stringify(before.layers.map((l) => l.name + l.type)), JSON.stringify([before.layers, after.layers]));
    const p = await H.px(450, 400);
    assert(p[3] === 255 && p[0] < 30, 'ellipse pixels ' + p);
    await H.shot('s7-03-reopened');
  });

  await H.step('canvas right-click context menu', async () => {
    await H.key('m');
    await H.clickDoc(500, 500, { button: 'right' });
    await H.wait(150);
    await H.shot('s7-04-canvas-ctx');
    const items = await page.locator('.gesso-menu .item').allInnerTexts();
    assert(items.length > 3, 'menu items ' + items.length);
    await page.keyboard.press('Escape');
    assert(!(await page.locator('.gesso-menu').count()), 'menu not closed by Esc');
  });

  await H.step('tool flyout by long press', async () => {
    const b = page.locator('.tool-btn[data-tool="' + (await H.ev(() => Gesso.Tools.groupActive.lasso)) + '"]');
    const bb = await b.boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.mouse.down(); await H.wait(500); await page.mouse.up();
    await H.wait(100);
    await H.shot('s7-05-flyout');
    const n = await page.locator('.gesso-menu .item').count();
    assert(n === 3, 'flyout items ' + n); // lasso, polygonal, magnetic
    await page.locator('.gesso-menu .item', { hasText: 'Polygonal Lasso' }).click();
    await H.wait(100);
    assert((await H.state()).tool === 'polyLasso', 'flyout pick');
  });

  await H.step('Window ▸ Panels toggles a panel; Reset Workspace restores', async () => {
    const vis0 = await page.locator('.dock-tabs .tab[title="Histogram"]').count();
    await H.menu('Window', 'Panels', 'Histogram');
    await H.wait(200);
    const vis1 = await page.locator('.dock-tabs .tab[title="Histogram"]').count();
    assert(vis1 !== vis0, 'histogram toggle ' + vis0 + '→' + vis1);
    await H.menu('Window', 'Reset Workspace');
    await H.wait(300);
    const vis2 = await page.locator('.dock-tabs .tab[title="Histogram"]').count();
    assert(vis2 === vis0 || vis2 === 1, 'reset ' + vis2);
    await H.shot('s7-06-reset-workspace');
  });

  await H.step('Preferences dialog opens and saves', async () => {
    await page.keyboard.press('Control+k');
    await H.wait(300);
    assert(await H.dialogOpen(), 'prefs');
    await H.shot('s7-07-prefs');
    await page.locator('.gesso-dialog .dialog-foot button.primary').click();
    await H.wait(150);
    assert(!(await H.dialogOpen()), 'prefs not closed');
  });

  await H.step('Shortcuts dialog: rebind "Duplicate Layer" to Ctrl+Shift+Y and use it', async () => {
    await H.menu('Help', 'Keyboard Shortcuts…');
    await H.wait(300);
    await page.locator('.sc-search').fill('duplicate layer');
    await H.wait(150);
    await H.shot('s7-08-shortcuts');
    await page.locator('.sc-row', { hasText: 'Duplicate Layer' }).locator('.sc-key').click();
    await page.keyboard.press('Control+Shift+y');
    await H.wait(150);
    const k = await page.locator('.sc-row', { hasText: 'Duplicate Layer' }).locator('.sc-key').innerText();
    assert(k === 'Ctrl+Shift+Y', 'recorded ' + k);
    await H.dialogBtn('Done');
    const n0 = (await H.state()).layers.length;
    await page.keyboard.press('Control+Shift+y');
    await H.wait(150);
    const n1 = (await H.state()).layers.length;
    assert(n1 === n0 + 1, 'shortcut did not duplicate ' + n0 + '→' + n1);
    await H.wait(300);
    const th = await H.ev(() => [...document.querySelectorAll('.layer-row')].map((r) => r.querySelectorAll('.lthumb:not(.mask) canvas').length));
    assert(th.every((n) => n === 1), 'every row should show its own thumbnail ' + JSON.stringify(th));
  });

  await H.step('layout at 1366×768', async () => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await H.wait(500);
    await H.shot('s7-09-1366');
    const ov = await H.ev(() => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, opt: (() => { const e = document.getElementById('optionsbar'); return [e.scrollWidth, e.clientWidth]; })() }));
    console.log('     overflow', JSON.stringify(ov));
    assert(ov.sw <= 1366 && ov.sh <= 768, 'page scrolls ' + JSON.stringify(ov));
    for (const id of ['brush', 'text', 'rect', 'move']) { await H.tool(id); await H.wait(100); await H.shot('s7-10-1366-' + id); }
  });

  await H.finish();
})();
