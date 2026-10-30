// Hands-on session 9: more edge workflows — paragraph text, painting on non-pixel layers, rasterize prompts,
// effects cancel, rotate 90 on shapes, group transform, close with unsaved changes, tab switching, trim/flatten.
const { launch, assert, near } = require('./lib');

(async () => {
  const H = await launch();
  const { page } = H;
  await page.locator('.welcome-quick .btn', { hasText: '1920 × 1080' }).click();
  await H.wait(300);

  await H.step('paragraph text: drag a box, type a long line — it wraps inside the box', async () => {
    await H.key('t');
    await H.dragDoc([[200, 200], [700, 500]], { steps: 8 });
    await page.keyboard.type('The quick brown fox jumps over the lazy dog and keeps running far away');
    await page.keyboard.press('Control+Enter');
    await H.wait(150);
    const lay = await H.ev(() => { const t = Gesso.app.doc.activeLayer().text; const l = Gesso.Text.layout(t); return { lines: l.lines.length, box: t.box }; });
    assert(lay.box && lay.lines > 1, JSON.stringify(lay));
    await H.shot('s9-01-paragraph');
  });

  await H.step('brush on a text layer explains what to do (no silent failure)', async () => {
    await H.key('b');
    await H.dragDoc([[300, 300], [400, 320]]);
    const toast = await page.locator('.toast').allInnerTexts();
    console.log('     toasts:', JSON.stringify(toast));
    assert(toast.some((t) => /rasteri|pixel/i.test(t)) || (await H.dialogOpen()), 'no feedback when painting on a text layer');
    if (await H.dialogOpen()) await H.dialogBtn('Cancel');
  });

  await H.step('filter on a shape layer asks to rasterize', async () => {
    await H.tool('ellipse');
    await H.dragDoc([[900, 300], [1200, 600]]);
    await H.menu('Filter', 'Blur', 'Gaussian Blur…');
    await H.wait(300);
    const msg = await page.locator('.gesso-dialog .dlg-msg').allInnerTexts();
    assert(msg.some((m) => /rasteri/i.test(m)), 'rasterize prompt ' + JSON.stringify(msg));
    await H.dialogBtn('Cancel');
    const st = await H.state(); assert(st.activeType === 'shape', 'kept shape');
  });

  await H.step('Layer Effects → Cancel restores the layer', async () => {
    const before = await H.ev(() => JSON.stringify(Gesso.app.doc.activeLayer().effects));
    await page.locator('.layer-row.active .lthumb').first().click(); // keep it selected
    await H.menu('Layer', 'Layer Effects', 'Outer Glow…');
    await H.wait(300);
    await H.shot('s9-02-effects-open');
    await H.dialogBtn('Cancel');
    const after = await H.ev(() => JSON.stringify(Gesso.app.doc.activeLayer().effects));
    assert(before === after || (before === 'null' && /"items":\{\}/.test(after)), 'effects changed after cancel: ' + before + ' → ' + after);
    const fxShown = await H.ev(() => Gesso.Effects.active(Gesso.app.doc.activeLayer()));
    assert(!fxShown, 'cancelled effect still visible');
  });

  await H.step('Edit ▸ Transform ▸ Rotate 90° CW on a star keeps it a star', async () => {
    await H.tool('star');
    await H.dragDoc([[1300, 200], [1600, 500]]);
    await H.menu('Edit', 'Transform', 'Rotate 90° Clockwise');
    const s = await H.ev(() => { const l = Gesso.app.doc.activeLayer(); return [l.shape.kind, Gesso.Shape.rotation(l.shape)]; });
    assert(s[0] === 'star' && Math.abs(s[1] - 90) < 0.01, JSON.stringify(s));
  });

  await H.step('Free Transform a group (ellipse + star) scales both and keeps them parametric', async () => {
    await page.locator('.layer-row', { hasText: 'Ellipse' }).click();
    await page.locator('.layer-row', { hasText: 'Star' }).click({ modifiers: ['Control'] });
    await H.key('Control+g');
    const b0 = await H.ev(() => Gesso.layerBounds(Gesso.app.doc.activeLayer(), Gesso.app.doc));
    await H.key('Control+t');
    const kind = await H.ev(() => Gesso.Transform.active && Gesso.Transform.active.kind);
    assert(kind === 'multi', 'group transform kind ' + kind);
    await H.shot('s9-03-group-transform');
    // scale from the bottom-right corner, Alt = from centre
    await H.dragDoc([[b0.x + b0.w, b0.y + b0.h], [b0.x + b0.w - b0.w * 0.25, b0.y + b0.h - b0.h * 0.25]], { steps: 8 });
    await H.key('Enter');
    const kinds = await H.ev(() => Gesso.app.doc.allLayers().filter((l) => l.type === 'shape').map((l) => [l.shape.kind, Math.round(l.shape.w)]));
    const b1 = await H.ev(() => Gesso.layerBounds(Gesso.app.doc.activeLayer(), Gesso.app.doc));
    assert(kinds.every((k) => k[0] === 'ellipse' || k[0] === 'star'), JSON.stringify(kinds));
    assert(Math.abs(b1.w - b0.w * 0.75) < 6, 'group scaled ' + b0.w + ' → ' + b1.w);
    await H.shot('s9-03b-group-scaled');
    await H.key('Control+z');
    const b2 = await H.ev(() => Gesso.layerBounds(Gesso.app.doc.activeLayer(), Gesso.app.doc));
    assert(Math.abs(b2.w - b0.w) < 1, 'undo');
  });

  await H.step('second document + Ctrl+Tab cycles tabs', async () => {
    await page.keyboard.press('Control+n');
    await H.wait(200);
    await H.dialogBtn('Create');
    await H.wait(300);
    assert((await H.ev(() => Gesso.app.docs.length)) === 2, 'two docs');
    const a = await H.ev(() => Gesso.app.doc.id);
    await page.keyboard.press('Control+Tab');
    await H.wait(150);
    const b = await H.ev(() => Gesso.app.doc.id);
    assert(a !== b, 'Ctrl+Tab did not switch');
  });

  await H.step('closing a modified document asks to save; "Don\'t Save" closes it', async () => {
    const n = await H.ev(() => Gesso.app.docs.length);
    await page.locator('.doctab.active .doctab-x').click();
    await H.wait(200);
    await H.shot('s9-04-close-prompt');
    assert(await H.dialogOpen(), 'no save prompt');
    await page.locator('.gesso-dialog .dialog-foot button', { hasText: 'Don’t Save' }).click();
    await H.wait(200);
    assert((await H.ev(() => Gesso.app.docs.length)) === n - 1, 'not closed');
  });

  await H.step('Image ▸ Trim and Layer ▸ Flatten Image', async () => {
    const [fcDummy] = [null]; void fcDummy;
    await page.locator('.welcome-quick .btn, .doctab-new').first().click().catch(() => {});
    await H.wait(200);
    if (await H.dialogOpen()) {
      await page.locator('.gesso-dialog .nd-fields select').nth(1).selectOption('transparent');
      await H.dialogBtn('Create');
      await H.wait(300);
    }
    await H.key('b');
    await H.dragDoc([[400, 300], [700, 400]]);
    await H.menu('Image', 'Trim…');
    await H.wait(250);
    await H.shot('s9-05-trim');
    await H.dialogBtn('OK');
    await H.wait(300);
    const st = await H.state();
    console.log('     after trim', st.w + '×' + st.h);
    assert(st.w < 500 && st.h < 200, 'trim ' + st.w + 'x' + st.h);
    await H.menu('Layer', 'Flatten Image');
    const st2 = await H.state();
    assert(st2.layers.length === 1, 'flatten');
  });

  await H.finish();
})();
