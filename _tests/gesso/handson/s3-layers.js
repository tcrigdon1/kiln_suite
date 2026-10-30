// Hands-on session 3: Layers panel — add, rename, reorder, visibility, blend/opacity, mask, clip, group, merge, duplicate, delete, effects.
const { launch, assert, near } = require('./lib');

(async () => {
  const H = await launch();
  const { page } = H;
  // new doc via quick-start button on the welcome screen
  await page.locator('.welcome-quick .btn', { hasText: '1080 × 1080' }).click();
  await H.wait(300);
  const newLayerBtn = page.locator('.layers-bottom .icon-btn[data-tip^="New layer"]');
  const row = (name) => page.locator('.layer-row', { has: page.locator('.lname', { hasText: new RegExp('^' + name + '$') }) });

  await H.step('add layers with the panel button and paint on them', async () => {
    await newLayerBtn.click(); await H.wait(100);
    await H.key('b');
    await H.dragDoc([[200, 200], [500, 500]]);
    await newLayerBtn.click(); await H.wait(100);
    await page.locator('.swatch-fg').click(); await H.wait(150);
    const hex = page.locator('.gesso-dialog .cp .hex-input').last(); await hex.fill('2266ff'); await hex.press('Enter');
    await H.wait(100);
    await H.dragDoc([[500, 200], [200, 500]]);
    const st = await H.state();
    assert(st.layers.map((l) => l.name).join(',') === 'Layer 2,Layer 1,Background', st.layers.map((l) => l.name).join(','));
  });

  await H.step('rename by double-clicking the name', async () => {
    await row('Layer 2').locator('.lname-text').dblclick();
    await H.wait(100);
    const inp = page.locator('.layer-row input.rename');
    await inp.fill('Blue X'); await inp.press('Enter');
    await H.wait(150);
    const st = await H.state();
    assert(st.layers[0].name === 'Blue X', st.layers[0].name);
  });

  await H.step('drag-reorder rows', async () => {
    const a = await row('Blue X').boundingBox(), b = await row('Layer 1').boundingBox();
    await page.mouse.move(a.x + 120, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + 120, a.y + a.height / 2 + 8, { steps: 3 });
    await page.mouse.move(b.x + 120, b.y + b.height * 0.85, { steps: 10 });
    await H.shot('s3-01-dragging');
    await page.mouse.up();
    await H.wait(200);
    const st = await H.state();
    assert(st.layers.map((l) => l.name).join(',') === 'Layer 1,Blue X,Background', st.layers.map((l) => l.name).join(','));
  });

  await H.step('toggle eye', async () => {
    await row('Layer 1').locator('.eye').click(); await H.wait(100);
    let st = await H.state(); assert(st.layers[0].visible === false, 'hidden');
    await row('Layer 1').locator('.eye').click(); await H.wait(100);
    st = await H.state(); assert(st.layers[0].visible === true, 'shown');
  });

  await H.step('blend mode & opacity from the panel (typing in the field)', async () => {
    await row('Blue X').click();
    await page.locator('.layers-top select.layers-blend').selectOption('multiply');
    await H.wait(100);
    const op = page.locator('.layers-top input[type=number]').first();
    await op.click(); await op.press('Control+a'); await page.keyboard.type('40', { delay: 120 }); await op.press('Enter');
    await H.wait(200);
    const st = await H.state();
    const l = st.layers.find((x) => x.name === 'Blue X');
    assert(l.blend === 'multiply', l.blend);
    assert(Math.abs(l.opacity - 0.4) < 0.01, 'opacity ' + l.opacity);
    await H.shot('s3-02-blend-opacity');
    // Enter hands focus back to the document: Ctrl+Z now undoes the opacity change, not the field's text
    await page.keyboard.press('Control+z');
    await H.wait(150);
    const o2 = (await H.state()).layers.find((x) => x.name === 'Blue X').opacity;
    assert(Math.abs(o2 - 1) < 0.01, 'Ctrl+Z after Enter → opacity ' + o2);
    await page.keyboard.press('Control+Shift+z');
    await H.wait(150);
  });

  await H.step('add mask with button and paint black on it', async () => {
    await page.locator('.layers-bottom .icon-btn[data-tip^="Add layer mask"]').click();
    await H.wait(150);
    let st = await H.state(); assert(st.layers.find((x) => x.name === 'Blue X').mask, 'no mask');
    await H.key('d'); // default colours: fg black
    await H.key('b');
    await H.dragDoc([[150, 350], [550, 350]]);
    const m = await H.ev(() => { const l = Gesso.app.doc.activeLayer(); return Array.from(Gesso.util.samplePixels(l.mask.canvas, 350, 350)); });
    assert(m[3] < 30, 'mask not painted ' + m);
    const pix = await H.ev(() => Array.from(Gesso.Layers.readRect(Gesso.app.doc.activeLayer().canvas, { x: 350, y: 350, w: 1, h: 1 }).data));
    assert(pix[3] > 0 && pix[2] > 200, 'painted the pixels instead of the mask? ' + pix);
    await H.shot('s3-03-mask');
  });

  await H.step('clipping mask via panel button', async () => {
    await row('Layer 1').click();
    await page.locator('.layers-bottom .icon-btn[data-tip^="Clip to layer below"]').click();
    await H.wait(150);
    const st = await H.state(); assert(st.layers[0].clip === true, 'clip');
    await H.shot('s3-04-clip');
    await page.locator('.layers-bottom .icon-btn[data-tip^="Clip to layer below"]').click();
  });

  await H.step('group with Ctrl+G, then ungroup', async () => {
    await row('Layer 1').click();
    await row('Blue X').click({ modifiers: ['Shift'] });
    await H.key('Control+g');
    let st = await H.state();
    assert(st.layers[0].type === 'group' && st.layers[1].depth === 1 && st.layers[2].depth === 1, JSON.stringify(st.layers.map((l) => [l.name, l.depth])));
    await H.shot('s3-05-group');
    await H.key('Control+Shift+g');
    st = await H.state();
    console.log('     after ungroup:', st.layers.map((l) => l.name).join(', '), 'active', st.active);
    assert(!st.layers.some((l) => l.type === 'group'), 'ungroup');
  });

  await H.step('duplicate via context menu, merge down, delete', async () => {
    await row('Layer 1').click({ button: 'right' });
    await H.wait(100);
    await H.shot('s3-06-ctx');
    await H.ctxMenuClick('Duplicate Layer');
    let st = await H.state();
    console.log('     after dup:', st.layers.map((l) => l.name + (l.mask ? '[m]' : '')).join(', '), 'active', st.active);
    assert(st.layers.some((l) => l.name === 'Layer 1 copy'), 'dup');
    await H.key('Control+e');
    st = await H.state();
    console.log('     after merge:', st.layers.map((l) => l.name + (l.mask ? '[m]' : '')).join(', '), 'active', st.active);
    assert(!st.layers.some((l) => l.name === 'Layer 1 copy'), 'merge ' + st.layers.map((l) => l.name));
    const n0 = st.layers.length;
    await page.locator('.layers-bottom .icon-btn[data-tip^="Delete layer"]').click();
    await H.wait(100);
    st = await H.state(); assert(st.layers.length === n0 - 1, 'delete');
  });

  await H.step('layer effects dialog by double-clicking a row', async () => {
    await row('Blue X').dblclick({ position: { x: 200, y: 10 } });
    await H.wait(300);
    assert(await H.dialogOpen(), 'effects dialog');
    await H.shot('s3-07-effects-dialog');
    // enable drop shadow via its checkbox / row
    const ds = page.locator('.gesso-dialog').getByText('Drop Shadow').first();
    await ds.click();
    await H.wait(200);
    const cb = page.locator('.gesso-dialog .fx-list input[type=checkbox]').first();
    if (await cb.count()) { if (!(await cb.isChecked())) await cb.check(); }
    await H.wait(200);
    await H.shot('s3-08-effects-dropshadow');
    await H.dialogBtn('OK');
    const fx = await H.ev(() => JSON.stringify(Gesso.app.doc.activeLayer().effects));
    console.log('     effects', fx && fx.slice(0, 120));
    assert(fx && fx !== 'null', 'no effects');
    await H.shot('s3-09-after-effects');
  });

  await H.finish();
})();
