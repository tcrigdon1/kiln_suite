// Hands-on session 1: welcome → new document dialog → open photo (menu + drag-drop) → painting tools.
const { launch, assert, near, ASSETS } = require('./lib');
const path = require('path');
const fs = require('fs');

(async () => {
  const H = await launch();
  const { page } = H;
  await H.shot('s1-01-welcome');

  await H.step('new document via dialog (preset + custom background)', async () => {
    await page.keyboard.press('Control+n');
    await H.wait(300);
    assert(await H.dialogOpen(), 'dialog did not open');
    await page.locator('.nd-cats .tab', { hasText: 'Social' }).click();
    await page.locator('.nd-card', { hasText: 'Square 1080' }).click();
    await page.locator('.nd-fields select').nth(1).selectOption('custom');
    await H.wait(100);
    await H.shot('s1-02-newdoc-dialog');
    await page.locator('.nd-fields .color-chip').click();
    await H.wait(200);
    await H.shot('s1-03-colorpicker');
    // type a hex value in the color picker
    const hex = page.locator('.gesso-dialog .cp .hex-input').last();
    await hex.fill('#3a6ea5');
    await hex.press('Enter');
    await H.wait(150);
    // Enter in the hex field applies & closes the picker (primary button)
    if (await H.dialogOpen() > 1) await H.dialogBtn('OK');
    await H.dialogBtn('Create');
    await H.wait(300);
    const st = await H.state();
    assert(st && st.w === 1080 && st.h === 1080, JSON.stringify(st));
    const p = await H.px(500, 500);
    assert(near(p, [0x3a, 0x6e, 0xa5, 255], 3), 'bg ' + p);
    await H.shot('s1-04-newdoc');
  });

  await H.step('open photo via File ▸ Open (file chooser)', async () => {
    const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 4000 }), H.menu('File', 'Open…')]);
    await fc.setFiles(path.join(ASSETS, 'photo.png'));
    await H.wait(800);
    const st = await H.state();
    assert(st.w === 1920 && st.h === 1080, JSON.stringify(st));
    await H.shot('s1-05-opened');
  });

  await H.step('open via drag & drop', async () => {
    const buf = fs.readFileSync(path.join(ASSETS, 'face.jpg')).toString('base64');
    const n0 = await H.ev(() => Gesso.app.docs.length);
    const dt = await page.evaluateHandle(async (b64) => {
      const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const dt = new DataTransfer(); dt.items.add(new File([u], 'face.jpg', { type: 'image/jpeg' })); return dt;
    }, buf);
    await page.dispatchEvent('#view', 'dragenter', { dataTransfer: dt });
    await H.wait(100);
    await H.shot('s1-06-drop-overlay');
    await page.dispatchEvent('#view', 'drop', { dataTransfer: dt });
    await H.wait(800);
    const n1 = await H.ev(() => Gesso.app.docs.length);
    assert(n1 === n0 + 1, n0 + '→' + n1);
    const ov = await page.locator('.drop-overlay.show').count();
    assert(ov === 0, 'drop overlay still visible');
    await H.shot('s1-07-dropped');
  });

  await H.step('brush via B key, [ ] size, opacity digit, paint stroke', async () => {
    await H.key('b');
    let st = await H.state();
    assert(st.tool === 'brush', st.tool);
    // new layer via panel button
    await page.locator('.layers-bottom .icon-btn[data-tip^="New layer"]').click();
    await H.wait(100);
    const s0 = await H.ev(() => Gesso.Tools.byId.brush.opts.size);
    await H.key(']', 3);
    const s1 = await H.ev(() => Gesso.Tools.byId.brush.opts.size);
    assert(s1 > s0, s0 + ' → ' + s1);
    const h0 = await H.ev(() => Gesso.Tools.byId.brush.opts.hardness);
    await H.key('Shift+BracketLeft');
    const h1 = await H.ev(() => Gesso.Tools.byId.brush.opts.hardness);
    assert(h1 < h0, 'hardness ' + h0 + ' → ' + h1);
    const shown = await page.locator('#optionsbar .opt-num', { has: page.locator('.opt-label', { hasText: 'Hardness' }) }).locator('input').inputValue();
    assert(Math.abs(+shown - h1 * 100) < 1, 'options bar shows hardness ' + shown);
    await H.key('5');
    const op = await H.ev(() => Gesso.Tools.byId.brush.opts.opacity);
    assert(op === 50 || op === 0.5, 'opacity ' + op);
    await H.key('0');
    await H.dragDoc([[200, 200], [400, 260], [600, 220], [800, 300]], { steps: 15 });
    const p = await H.lpx(400, 260);
    assert(p[3] > 200, 'not painted ' + p);
    await H.shot('s1-08-brush');
  });

  await H.step('change color via swatch click and picker', async () => {
    await page.locator('.swatch-fg').click();
    await H.wait(200);
    await H.shot('s1-09-picker');
    const hex = page.locator('.gesso-dialog .cp .hex-input').last();
    await hex.fill('ff2200'); await hex.press('Enter');
    await H.wait(100);
    if (await H.dialogOpen()) await H.dialogBtn('OK');
    const fg = await H.ev(() => Gesso.app.fg);
    assert(fg.toLowerCase() === '#ff2200', fg);
    await H.dragDoc([[200, 500], [900, 520]]);
    const p = await H.lpx(550, 510);
    assert(p[0] > 200 && p[1] < 80, 'color ' + p);
  });

  await H.step('eraser (E) erases', async () => {
    await H.key('e');
    await H.dragDoc([[500, 480], [600, 540]]);
    const p = await H.lpx(550, 510);
    assert(p[3] < 60, 'not erased ' + p);
    await H.shot('s1-10-eraser');
  });

  await H.step('pencil via flyout', async () => {
    await H.tool('pencil');
    const st = await H.state(); assert(st.tool === 'pencil', st.tool);
    await H.dragDoc([[100, 700], [500, 720]]);
    const p = await H.lpx(300, 710);
    assert(p[3] === 255, 'pencil ' + p);
  });

  await H.step('smudge, dodge, burn on the background', async () => {
    await page.locator('.layer-row', { hasText: 'Background' }).click();
    await H.tool('smudge');
    await H.dragDoc([[300, 300], [400, 330]]);
    await H.tool('dodge');
    await H.dragDoc([[600, 600], [700, 650]]);
    await H.tool('burn');
    await H.dragDoc([[700, 300], [800, 350]]);
    await H.shot('s1-11-smudge-dodge-burn');
    const h = await H.ev(() => Gesso.app.doc.history.entries.slice(-3).map((e) => e.name));
    assert(h.length === 3, JSON.stringify(h));
    console.log('     history:', h.join(' | '));
  });

  await H.step('clone stamp: Alt-click source then paint', async () => {
    await H.key('s');
    let st = await H.state(); assert(st.tool === 'clone', st.tool);
    await H.clickDoc(500, 400, { mods: ['Alt'] });
    await H.dragDoc([[100, 100], [160, 120]]);
    await H.shot('s1-12-clone');
    const h = await H.ev(() => Gesso.app.doc.history.entries[Gesso.app.doc.history.index].name);
    assert(/clone/i.test(h), h);
  });

  await H.step('healing brush', async () => {
    await H.key('j');
    const st = await H.state(); console.log('     J tool =', st.tool);
    if (st.tool === 'healBrush' || st.tool === 'heal') await H.clickDoc(520, 420, { mods: ['Alt'] });
    await H.dragDoc([[150, 150], [190, 170]]);
    await H.shot('s1-13-heal');
  });

  await H.step('bucket fill', async () => {
    await H.tool('bucket');
    await H.clickDoc(50, 1000);
    const p = await H.px(50, 1000);
    console.log('     bucket px', p);
    await H.shot('s1-14-bucket');
  });

  await H.step('gradient: all five types by drag', async () => {
    await page.locator('.layers-bottom .icon-btn[data-tip^="New layer"]').click();
    await H.key('g');
    let st = await H.state(); console.log('     G tool =', st.tool);
    if (st.tool !== 'gradient') await H.tool('gradient');
    for (const [i, t] of ['linear', 'radial', 'angle', 'reflected', 'diamond'].entries()) {
      const btn = page.locator('#optionsbar .icon-btn[data-tip*="' + t.charAt(0).toUpperCase() + t.slice(1) + '"]');
      if (await btn.count()) await btn.first().click();
      else console.log('     no button for', t);
      const y = 120 + i * 180;
      await H.dragDoc([[200 + i * 150, y], [320 + i * 150, y + 60]], { steps: 6 });
      await H.shot('s1-15-gradient-' + t);
    }
    const h = await H.ev(() => Gesso.app.doc.history.entries.slice(-5).map((e) => e.name));
    console.log('     history:', h.join(' | '));
  });

  await H.finish();
})();
