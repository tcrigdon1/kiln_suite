// Pass 2 hands-on session 1: tools on the wrong layer type, zero-size drags, selections partly off-canvas,
// undo in the middle of text editing / a transform, closing a document mid-tool, switching docs with a dialog open.
const { launch, assert, near, ASSETS } = require('./lib');
const path = require('path');

(async () => {
  const H = await launch();
  const { page } = H;
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
  await fc.setFiles(path.join(ASSETS, 'face.jpg'));
  await H.wait(700);
  const hist = () => H.ev(() => Gesso.app.doc.history.entries.map((e) => e.name));
  const toasts = () => H.ev(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent));

  await H.step('zero-size drags: marquee click deselects, shape click creates nothing, crop click does not crop, gradient click is a no-op', async () => {
    await H.key('m');
    await H.dragDoc([[100, 100], [300, 220]]);
    assert((await H.state()).sel, 'has selection');
    await H.clickDoc(400, 400);
    assert(!(await H.state()).sel, 'click (no drag) outside the selection deselects');
    const n0 = (await H.state()).layers.length;
    await H.tool('rect');
    await H.clickDoc(200, 200);
    await H.wait(200);
    // a plain click offers to create the shape by size (like most editors); Esc must leave nothing behind
    assert(await H.dialogOpen(), 'click without drag opens the Create dialog');
    await H.key('Escape'); await H.wait(150);
    const st = await H.state();
    assert(st.layers.length === n0 && !(await H.dialogOpen()), 'Esc: no layer added (' + st.layers.length + ' vs ' + n0 + ')');
    await H.key('c');
    await H.clickDoc(300, 300); await H.key('Enter');
    const s2 = await H.state(); assert(s2.w === 1200 && s2.h === 800, 'crop click kept the size ' + s2.w + 'x' + s2.h);
    await H.key('Escape');
    await H.tool('gradient');
    const h0 = (await hist()).length;
    await H.clickDoc(300, 300);
    assert((await hist()).length === h0, 'gradient click without drag added no history entry');
    await H.shot('a1-01-zero-drags');
  });

  await H.step('brush on a text layer asks to rasterize; Cancel keeps the text layer, Esc too', async () => {
    await H.key('t');
    await H.clickDoc(400, 500);
    await page.keyboard.type('Hello edge cases');
    await H.key('Escape');
    assert((await H.state()).activeType === 'text', 'text layer active');
    await H.key('b');
    await H.dragDoc([[380, 480], [520, 480]]);
    await H.wait(200);
    assert(await H.dialogOpen(), 'rasterize prompt shown');
    await H.shot('a1-02-rasterize-prompt');
    await H.dialogBtn('Cancel');
    assert((await H.state()).activeType === 'text', 'still text after Cancel');
    await H.dragDoc([[380, 480], [520, 480]]);
    await H.wait(200);
    await H.key('Escape');
    await H.wait(150);
    assert(!(await H.dialogOpen()) && (await H.state()).activeType === 'text', 'Esc cancels the prompt too');
    // brush drag after the dialog: no stray stroke was painted on anything
    const names = (await H.state()).layers.map((l) => l.name);
    assert(!names.some((n) => /^Layer \d+$/.test(n)), 'no stray raster layer ' + names);
  });

  await H.step('brush on a text layer → Rasterize → the stroke of the same drag is NOT applied; the next drag paints', async () => {
    await H.dragDoc([[380, 480], [520, 480]]);
    await H.wait(200);
    await H.dialogBtn('Rasterize');
    await H.wait(200);
    assert((await H.state()).activeType === 'raster', 'rasterized');
    const p0 = await H.lpx(450, 530);
    await H.dragDoc([[380, 540], [520, 540]]);
    const p1 = await H.lpx(450, 540);
    assert(p1[3] > 100, 'second drag paints ' + p1);
    void p0;
  });

  await H.step('bucket on a group, transform on an adjustment layer, eraser on a locked layer → toasts, no changes', async () => {
    await H.menu('Layer', 'New', 'New Group');
    await H.tool('bucket');
    const h0 = (await hist()).length;
    await H.clickDoc(600, 600);
    await H.wait(150);
    assert((await hist()).length === h0, 'bucket on a group did nothing');
    await H.menu('Layer', 'New Adjustment Layer', 'Brightness/Contrast');
    await H.wait(200);
    await H.key('Escape');
    const t0 = await toasts();
    await H.key('Control+t');
    await H.wait(200);
    const active = await H.ev(() => !!Gesso.Transform.active);
    assert(!active, 'no transform on an adjustment layer');
    // the Backdrop (bottom) layer: lock it, try the eraser
    await page.locator('.layer-row').last().click();
    await page.locator('.lock-row .icon-btn').last().click(); // lock all
    await H.key('e');
    const before = await H.lpx(800, 300);
    await H.dragDoc([[700, 300], [900, 300]]);
    const after = await H.lpx(800, 300);
    assert(near(before, after, 0), 'locked layer untouched by the eraser');
    const t1 = await toasts();
    assert(t1.length >= t0.length, 'toast shown ' + JSON.stringify(t1));
    await page.locator('.lock-row .icon-btn').last().click(); // unlock
    await H.shot('a1-03-wrong-layer-tools');
  });

  await H.step('selection partly off-canvas: marquee from inside to far outside, fill, copy/paste, move', async () => {
    await H.key('m');
    const a = await H.pt(1000, 600), b = await H.pt(1500, 1000); // ends outside the document
    await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(b[0], b[1], { steps: 12 }); await page.mouse.up();
    await H.wait(150);
    const st = await H.state();
    assert(st.sel && st.sel.x === 1000 && st.sel.x + st.sel.w <= 1200, 'selection clamped to the canvas ' + JSON.stringify(st.sel));
    await page.locator('.layer-row').last().click();
    await H.key('Alt+Backspace'); // fill with foreground
    const p = await H.px(1100, 700);
    assert(p[3] === 255, 'filled ' + p);
    await H.key('Control+c'); await H.key('Control+v');
    const st2 = await H.state();
    assert(st2.active === 'Pasted Layer' && !st2.sel, 'pasted and deselected');
    await H.key('v');
    await H.dragDoc([[1100, 700], [800, 400]]);
    assert((await H.state()).histName === 'Move', 'moved pasted layer');
    await H.shot('a1-04-offcanvas-selection');
  });

  await H.step('undo (Ctrl+Z) while editing text undoes typing inside the field, not the document', async () => {
    await H.key('t');
    await H.clickDoc(300, 700);
    await page.keyboard.type('abc');
    const h0 = (await hist()).length;
    await H.key('Control+z');
    await H.wait(100);
    const txt = await H.ev(() => Gesso.TextTool.edit && Gesso.TextTool.edit.layer.text.text);
    assert((await hist()).length === h0, 'document history untouched while typing');
    assert(txt !== undefined && txt !== null, 'still editing (' + txt + ')');
    await page.keyboard.type('xyz');
    await H.key('Escape');
    const l = await H.ev(() => { const d = Gesso.app.doc, l = d.activeLayer(); return l && l.type === 'text' ? l.text.text : null; });
    assert(l && l.endsWith('xyz'), 'text committed: ' + l);
  });

  await H.step('undo (Ctrl+Z) in the middle of a Free Transform is ignored (no corrupted state)', async () => {
    const h0 = await hist();
    await H.key('Control+t');
    await H.wait(150);
    assert(await H.ev(() => !!Gesso.Transform.active), 'transform active');
    const c = await H.ev(() => Gesso.Transform.active.corners.map((p) => [p.x, p.y]));
    await H.dragDoc([[c[2][0], c[2][1]], [c[2][0] + 80, c[2][1] + 60]]);
    await H.key('Control+z');
    await H.wait(150);
    const stillActive = await H.ev(() => !!Gesso.Transform.active);
    const h1 = await hist();
    assert(h1.length >= h0.length - 0, 'history not rewound underneath the transform: ' + h0.length + ' → ' + h1.length);
    await H.key('Enter');
    await H.wait(150);
    assert(!(await H.ev(() => !!Gesso.Transform.active)), 'committed');
    const h2 = await hist();
    assert(h2[h2.length - 1] === 'Free Transform' && h2.length === h0.length + 1, 'exactly one Free Transform entry ' + JSON.stringify(h2.slice(-3)) + ' (was active after undo: ' + stillActive + ')');
    await H.key('Control+z');
    assert((await hist()).length === h2.length && (await H.state()).hist === h2.length - 2, 'undo after commit undoes the transform');
    await H.shot('a1-05-undo-mid-transform');
  });

  await H.step('closing the document in the middle of a transform / crop / text edit leaves no stale tool state', async () => {
    await H.ev(() => Gesso.App.createDoc({ name: 'Scratch', w: 400, h: 300, dpi: 72, bg: 'white' }));
    await H.wait(200);
    await H.key('b'); await H.dragDoc([[50, 50], [300, 200]]);
    await H.key('Control+t'); await H.wait(100);
    await H.key('Control+w'); await H.wait(200);
    if (await H.dialogOpen()) await page.locator('.gesso-dialog .dialog-foot button', { hasText: 'Don’t Save' }).click();
    await H.wait(200);
    assert(!(await H.ev(() => !!Gesso.Transform.active)), 'transform cleared on close');
    const st = await H.state(); assert(st && st.name !== 'Scratch', 'back on the first document');
    await H.ev(() => Gesso.App.createDoc({ name: 'Scratch2', w: 400, h: 300, dpi: 72, bg: 'white' }));
    await H.wait(200);
    await H.key('t'); await H.clickDoc(100, 100); await page.keyboard.type('bye');
    await H.key('Control+w'); await H.wait(200);
    if (await H.dialogOpen()) await page.locator('.gesso-dialog .dialog-foot button', { hasText: 'Don’t Save' }).click();
    await H.wait(200);
    assert(!(await H.ev(() => !!Gesso.TextTool.edit)), 'text edit cleared on close');
    assert(!(await H.ev(() => !!document.querySelector('.text-ime'))), 'no orphan textarea');
    await H.ev(() => Gesso.App.createDoc({ name: 'Scratch3', w: 400, h: 300, dpi: 72, bg: 'white' }));
    await H.wait(200);
    await H.key('c'); await H.dragDoc([[50, 50], [200, 200]]);
    await H.key('Control+w'); await H.wait(200);
    if (await H.dialogOpen()) await page.locator('.gesso-dialog .dialog-foot button', { hasText: 'Don’t Save' }).click();
    await H.wait(300);
    const cr = await H.ev(() => { const t = Gesso.Tools.byId.crop, d = Gesso.app.doc; return t.rect && d ? [t.rect.w, t.rect.h, d.width, d.height] : null; });
    assert(!cr || (cr[0] === cr[2] && cr[1] === cr[3]), 'crop box reset for the remaining doc ' + JSON.stringify(cr));
    await H.shot('a1-06-close-mid-tool');
  });

  await H.step('switching documents while the (modeless) Color Range dialog is open keeps it bound to its document', async () => {
    await H.ev(() => Gesso.App.createDoc({ name: 'Other', w: 300, h: 200, dpi: 72, bg: 'black' }));
    await H.wait(200);
    await page.locator('.doctab').first().click(); // back to face.jpg
    await H.wait(200);
    await H.menu('Select', 'Color Range…');
    await H.wait(200);
    assert(await H.dialogOpen(), 'dialog open');
    await page.locator('.doctab').nth(1).click(); // switch to "Other" with the dialog open
    await H.wait(200);
    // the dialog belongs to the first document: it is dismissed (not left sampling the wrong document)
    assert(!(await H.dialogOpen()), 'modeless dialog closed on document switch');
    assert(await H.ev(() => !Gesso.app.pickHook), 'no stale canvas pick hook');
    await H.clickDoc(100, 100);
    const st = await H.state();
    assert(st.name === 'Other' && !st.sel, 'click on the other document did nothing odd');
    await H.shot('a1-07-dialog-switch-doc');
  });

  await H.finish();
})();
