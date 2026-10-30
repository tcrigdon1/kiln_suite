// Hands-on session 8: assorted tools/dialogs — eyedropper, swatches, quick mask, Edit ▸ Fill/Stroke, color range,
// transform selection, Paths panel, Shift-drop to place, gradient editor, lock, align, text/shape transform.
const { launch, assert, near, ASSETS } = require('./lib');
const path = require('path');
const fs = require('fs');

(async () => {
  const H = await launch();
  const { page } = H;
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
  await fc.setFiles(path.join(ASSETS, 'face.jpg'));
  await H.wait(700);
  const tab = async (title) => { await page.locator('.dock-tabs .tab[title="' + title + '"]').first().click(); await H.wait(150); };

  await H.step('eyedropper (I) samples the face colour into the foreground', async () => {
    await H.key('i');
    await H.clickDoc(600, 250);
    const fg = await H.ev(() => Gesso.app.fg);
    const p = await H.px(600, 250);
    const rgb = await H.ev((h) => Gesso.util.hexToRgb(h), fg);
    assert(near([rgb.r, rgb.g, rgb.b], p.slice(0, 3), 6), fg + ' vs ' + p);
  });

  await H.step('swatches panel click sets foreground', async () => {
    await tab('Swatches');
    const sw = page.locator('.panel-swatches .swatch, .panel-swatches button').nth(3);
    await sw.click();
    await H.wait(100);
    const fg = await H.ev(() => Gesso.app.fg);
    console.log('     fg after swatch', fg);
    await H.shot('s8-01-swatches');
    await tab('Color');
  });

  await H.step('quick mask: Q, paint, Q → selection', async () => {
    await H.key('q');
    assert(await H.ev(() => !!Gesso.app.doc.quickMask), 'quick mask on');
    await H.key('d');
    await H.key('b');
    await page.locator('#optionsbar .opt-num', { has: page.locator('.opt-label', { hasText: 'Size' }) }).locator('input').fill('80');
    await page.keyboard.press('Enter');
    await H.dragDoc([[200, 200], [400, 200]]);
    await H.shot('s8-02-quickmask');
    await H.key('q');
    // painting black protects: the stroke is excluded from the selection, the rest stays selected
    const m = await H.ev(() => { const s = Gesso.app.doc.selection; return [s.mask[200 * s.w + 300], s.mask[600 * s.w + 600]]; });
    assert(m[0] < 20 && m[1] > 200, 'qm mask ' + m);
  });

  await H.step('Edit ▸ Fill and Edit ▸ Stroke dialogs on a new layer', async () => {
    await H.key('Control+Shift+n');
    await H.menu('Edit', 'Fill…');
    await H.wait(200);
    await H.shot('s8-03-fill-dialog');
    await H.dialogBtn('OK');
    let p = await H.lpx(600, 600); assert(p[3] > 200, 'fill ' + p);
    await H.menu('Edit', 'Stroke…');
    await H.wait(200);
    await H.shot('s8-04-stroke-dialog');
    await H.dialogBtn('OK');
    await H.key('Control+d');
  });

  await H.step('Select ▸ Color Range dialog', async () => {
    await page.locator('.layer-row', { hasText: 'Background' }).click();
    await H.menu('Select', 'Color Range…');
    await H.wait(300);
    await H.shot('s8-05-color-range');
    // sample by clicking the canvas (the dialog lets you pick from the image)
    await H.clickDoc(100, 750);
    await H.wait(300);
    await H.dialogBtn('OK');
    const st = await H.state();
    assert(st.sel && st.sel.w > 900, 'color range sel ' + JSON.stringify(st.sel));
  });

  await H.step('Select ▸ Transform Selection: drag a corner then Enter', async () => {
    await H.key('Control+d');
    await H.tool('marqueeRect');
    await H.dragDoc([[100, 100], [300, 300]]);
    await H.menu('Select', 'Transform Selection');
    await H.dragDoc([[300, 300], [400, 400]], { steps: 8 });
    await H.key('Enter');
    const st = await H.state();
    assert(st.sel && st.sel.w > 260, 'transformed selection ' + JSON.stringify(st.sel));
    await H.key('Control+d');
  });

  await H.step('Paths panel: make work path from a selection, then load it back as selection', async () => {
    await H.dragDoc([[500, 500], [700, 650]]);
    await H.menu('Select', 'Make Work Path from Selection');
    await H.wait(200);
    await H.key('Control+d');
    await tab('Paths');
    await H.shot('s8-06-paths-panel');
    const btns = await page.locator('.panel-paths button').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-tip') || b.title || b.textContent));
    console.log('     paths buttons', JSON.stringify(btns));
    const toSel = page.locator('.panel-paths button[data-tip*="election"], .panel-paths button[title*="election"]').first();
    await toSel.click();
    await H.wait(150);
    const st = await H.state();
    assert(st.sel && Math.abs(st.sel.w - 200) < 4, 'path→selection ' + JSON.stringify(st.sel));
    await tab('Character');
  });

  await H.step('Shift + drop places the image as a layer', async () => {
    const buf = fs.readFileSync(path.join(ASSETS, 'face.jpg')).toString('base64');
    const n0 = (await H.state()).layers.length;
    const dt = await page.evaluateHandle(async (b64) => {
      const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const dt = new DataTransfer(); dt.items.add(new File([u], 'face.jpg', { type: 'image/jpeg' })); return dt;
    }, buf);
    await page.dispatchEvent('#view', 'drop', { dataTransfer: dt, shiftKey: true });
    await H.wait(700);
    const st = await H.state();
    assert(st.layers.length === n0 + 1 && (await H.ev(() => Gesso.app.docs.length)) === 1, 'place ' + n0 + '→' + st.layers.length);
  });

  await H.step('gradient tool: open the gradient editor by clicking the preview, pick a preset', async () => {
    await H.tool('gradient');
    await page.locator('#optionsbar .grad-swatch').click();
    await H.wait(250);
    await H.shot('s8-07-gradient-editor');
    if (await H.dialogOpen()) {
      await page.locator('.gesso-dialog select.grad-presets').selectOption({ label: 'Dusk' });
      await H.dialogBtn('OK');
    }
    const st = await H.ev(() => Gesso.Tools.byId.gradient.stops().map((s) => s.color).join(','));
    assert(st === '#241445,#b33f6b,#ffb36b', st);
  });

  await H.step('lock position blocks the move tool', async () => {
    await page.locator('.layers-top .lock-row button').nth(2).click();
    await H.key('v');
    const b0 = await H.ev(() => Gesso.layerBounds(Gesso.app.doc.activeLayer(), Gesso.app.doc));
    await H.dragDoc([[600, 400], [700, 450]]);
    const b1 = await H.ev(() => Gesso.layerBounds(Gesso.app.doc.activeLayer(), Gesso.app.doc));
    assert(b0.x === b1.x, 'moved a locked layer');
    await page.locator('.layers-top .lock-row button').nth(2).click();
  });

  await H.step('align: Move tool align buttons centre a shape on the canvas', async () => {
    await H.tool('ellipse');
    await H.dragDoc([[100, 100], [300, 250]]);
    await H.key('v');
    await page.locator('#optionsbar .icon-btn[data-tip="Align horizontal centers"]').click();
    await page.locator('#optionsbar .icon-btn[data-tip="Align vertical centers"]').click();
    const b = await H.ev(() => Gesso.layerBounds(Gesso.app.doc.activeLayer(), Gesso.app.doc));
    assert(Math.abs(b.x + b.w / 2 - 600) <= 1 && Math.abs(b.y + b.h / 2 - 400) <= 1, JSON.stringify(b));
    await H.shot('s8-08-align');
  });

  await H.finish();
})();
