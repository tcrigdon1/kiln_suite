// Hands-on session 4: Free Transform, flip, numeric fields; Crop tool; Image Size & Canvas Size dialogs.
const { launch, assert, near, ASSETS } = require('./lib');
const path = require('path');

(async () => {
  const H = await launch();
  const { page } = H;
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
  await fc.setFiles(path.join(ASSETS, 'face.jpg'));
  await H.wait(700);
  // a layer with a red square to transform
  await H.key('Control+Shift+n');
  await H.key('m');
  await H.dragDoc([[400, 300], [600, 450]]);
  await page.locator('.swatch-fg').click(); await H.wait(150);
  { const hex = page.locator('.gesso-dialog .cp .hex-input').last(); await hex.fill('dd2222'); await hex.press('Enter'); }
  await H.key('Alt+Backspace');
  await H.key('Control+d');
  const bounds = () => H.ev(() => Gesso.layerBounds(Gesso.app.doc.activeLayer(), Gesso.app.doc));

  await H.step('Free Transform: corner drag scales proportionally, Enter commits', async () => {
    await H.key('Control+t');
    let st = await H.state(); assert(st.tool === 'transform', st.tool);
    await H.shot('s4-01-transform-begin');
    await H.dragDoc([[600, 450], [700, 520]], { steps: 10 });
    await H.shot('s4-02-transform-scaled');
    await H.key('Enter');
    const b = await bounds();
    assert(Math.abs(b.w / b.h - 200 / 150) < 0.03, 'proportional ' + JSON.stringify(b));
    assert(b.w > 260, 'scaled ' + JSON.stringify(b));
  });

  await H.step('Free Transform: Shift+corner free scale; rotate outside with Shift snapping', async () => {
    await H.key('Control+t');
    let b0 = await bounds();
    await H.dragDoc([[b0.x + b0.w, b0.y + b0.h], [b0.x + b0.w + 60, b0.y + b0.h - 60]], { mods: ['Shift'] });
    await H.key('Enter');
    let b = await bounds();
    assert(Math.abs(b.w / b.h - b0.w / b0.h) > 0.1, 'free scale ' + JSON.stringify([b0, b]));
    await H.key('Control+t');
    b0 = await bounds();
    const cx = b0.x + b0.w / 2, cy = b0.y + b0.h / 2;
    await H.dragDoc([[cx + b0.w, cy], [cx + b0.w * 0.7, cy + b0.w * 0.7]], { mods: ['Shift'], steps: 10 });
    const ang = await H.ev(() => Gesso.Transform.active && +(Math.atan2(Gesso.Transform.active.corners[1].y - Gesso.Transform.active.corners[0].y, Gesso.Transform.active.corners[1].x - Gesso.Transform.active.corners[0].x) * 180 / Math.PI).toFixed(2));
    assert(Math.abs(ang % 15) < 0.01 || Math.abs(Math.abs(ang % 15) - 15) < 0.01, 'snapped angle ' + ang);
    await H.shot('s4-03-rotate');
    await H.key('Enter');
  });

  await H.step('Free Transform: flip button & numeric fields', async () => {
    await H.key('Control+t');
    await page.locator('#optionsbar .icon-btn[data-tip="Flip horizontal"]').click();
    const angInp = page.locator('#optionsbar .opt-num', { hasText: '∠' }).locator('input');
    await angInp.fill('0'); await angInp.press('Enter');
    const wInp = page.locator('#optionsbar .opt-num', { has: page.locator('.opt-label', { hasText: /^W$/ }) }).locator('input');
    await wInp.fill('50'); await wInp.press('Enter');
    await H.wait(100);
    await H.shot('s4-04-numeric');
    await H.key('Enter');
    const st = await H.state();
    assert(st.tool !== 'transform', 'still transforming');
  });

  await H.step('Esc cancels a transform', async () => {
    const b0 = await bounds();
    await H.key('Control+t');
    await H.dragDoc([[b0.x + b0.w / 2, b0.y + b0.h / 2], [b0.x + b0.w / 2 + 100, b0.y + b0.h / 2]]);
    await H.key('Escape');
    const b = await bounds();
    assert(Math.abs(b.x - b0.x) < 1, 'cancel ' + JSON.stringify([b0, b]));
  });

  await H.step('Edit ▸ Transform ▸ Flip Horizontal from the menu', async () => {
    const before = await H.ev(() => Gesso.app.doc.history.index);
    await H.menu('Edit', 'Transform', 'Flip Horizontal');
    const after = await H.ev(() => Gesso.app.doc.history.index);
    assert(after === before + 1, 'flip not recorded');
  });

  await H.step('Crop tool: drag, adjust a handle, Enter', async () => {
    await H.key('c');
    await H.wait(150);
    await H.shot('s4-05-crop-begin');
    await H.dragDoc([[100, 100], [1000, 700]], { steps: 10 });
    await H.shot('s4-06-crop-drag');
    // drag the right edge handle inwards
    await H.dragDoc([[1000, 400], [900, 400]], { steps: 8 });
    await H.shot('s4-07-crop-handle');
    await H.key('Enter');
    await H.wait(200);
    const st = await H.state();
    assert(Math.abs(st.w - 800) <= 2 && Math.abs(st.h - 600) <= 2, 'cropped ' + st.w + 'x' + st.h);
    await H.shot('s4-08-cropped');
  });

  await H.step('Image ▸ Image Size dialog', async () => {
    await H.menu('Image', 'Image Size…');
    await H.wait(200);
    await H.shot('s4-09-image-size');
    const w = page.locator('.gesso-dialog input[type=number]').first();
    await w.fill('400'); await w.press('Tab');
    await H.wait(100);
    await H.shot('s4-10-image-size-filled');
    await H.dialogBtn('OK');
    await H.wait(300);
    const st = await H.state();
    assert(st.w === 400 && Math.abs(st.h - 300) <= 1, st.w + 'x' + st.h);
  });

  await H.step('Image ▸ Canvas Size dialog', async () => {
    await H.menu('Image', 'Canvas Size…');
    await H.wait(200);
    await H.shot('s4-11-canvas-size');
    const w = page.locator('.gesso-dialog input[type=number]').first();
    await w.fill('500'); await w.press('Tab');
    await H.dialogBtn('OK');
    await H.wait(300);
    const st = await H.state();
    assert(st.w === 500 && Math.abs(st.h - 300) <= 1, st.w + 'x' + st.h);
    const cr = await H.ev(() => Gesso.Tools.byId.crop.rect);
    assert(cr && cr.w === 500 && cr.h === 300, 'crop box did not follow the new canvas size ' + JSON.stringify(cr));
    await H.shot('s4-12-canvas-sized');
  });

  await H.finish();
})();
