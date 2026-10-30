// C11 / C7 — command palette, welcome tour, clipping & gamut warnings, grayscale proof, customize toolbar,
// recent colours, per-document autosave + crash recovery, match zoom, histogram clipping read-out.
const { launch, assert } = require('./lib');

(async () => {
  const H = await launch();
  const { page } = H;
  await H.wait(1500);

  await H.step('First launch offers the tour; Help ▸ Welcome Tour walks through 6 spotlighted steps and ends', async () => {
    assert(await H.ev(() => !!document.querySelector('.tour-offer')), 'tour offer shown on first launch');
    await page.locator('.tour-offer button', { hasText: 'Start tour' }).click();
    await H.wait(200);
    assert(await H.ev(() => !!document.querySelector('.tour-card')), 'tour overlay open');
    await H.shot('c9-01-tour');
    for (let i = 0; i < 6; i++) { const txt = await page.locator('.tour-step').innerText(); assert(txt.startsWith((i + 1) + ' /'), 'step ' + txt); await page.locator('.tour-card button', { hasText: /Next|Done/ }).click(); await H.wait(150); }
    assert(!(await H.ev(() => !!document.querySelector('.tour-card'))), 'tour finished');
    assert(await H.ev(() => localStorage.getItem('gesso.tourSeen') === 'true'), 'remembered');
  });

  await H.ev(() => Gesso.App.createDoc({ name: 'Pal', w: 500, h: 300, dpi: 72, bg: 'white' }));
  await H.wait(200);

  await H.step('F3 opens the command palette; fuzzy "gaus bl" runs Gaussian Blur; "layrs pnl" shows the Layers panel; Esc closes', async () => {
    await H.key('F3');
    await H.wait(150);
    assert(await H.ev(() => !!document.querySelector('.palette')), 'palette open');
    await page.keyboard.type('gaus bl');
    await H.wait(150);
    const first = await page.locator('.palette-row').first().innerText();
    assert(/Gaussian Blur/.test(first), 'top match: ' + first);
    await H.shot('c9-02-palette');
    await page.keyboard.press('Enter');
    await H.wait(400);
    assert(await H.dialogOpen(), 'Gaussian Blur dialog opened from the palette');
    await H.dialogBtn('Cancel');
    await H.key('Control+Shift+k');
    await page.keyboard.type('layrs pnl');
    await H.wait(100);
    assert(/Layers panel/.test(await page.locator('.palette-row').first().innerText()), 'panel match');
    await page.keyboard.press('Escape');
    assert(!(await H.ev(() => !!document.querySelector('.palette'))), 'closed by Esc');
  });

  await H.step('View ▸ Clipping Warning marks pure white red and pure black blue; Proof Colors grayscale desaturates the view', async () => {
    await H.ev(() => { const d = Gesso.app.doc, x = d.layers[0].canvas.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 100, 300); x.fillStyle = '#e02020'; x.fillRect(100, 0, 150, 300); d.layers[0].version++; d.invalidate(); });
    await H.menu('View', 'Clipping Warning (red = highlights, blue = shadows, orange = channel)');
    await H.wait(400);
    const screen = (x, y) => H.ev(([x, y]) => { const V = Gesso.View, [sx, sy] = V.toScreen(x, y); return Array.from(V.ctx.getImageData(Math.round(sx * V.dpr), Math.round(sy * V.dpr), 1, 1).data); }, [x, y]);
    let w = await screen(400, 150), b = await screen(50, 150);
    assert(w[0] > 200 && w[1] < 120, 'white region flagged red ' + w);
    assert(b[2] > 200 && b[0] < 120, 'black region flagged blue ' + b);
    await H.shot('c9-03-clipping');
    await H.menu('View', 'Clipping Warning (red = highlights, blue = shadows, orange = channel)');
    await H.menu('View', 'Proof Colors: Grayscale');
    await H.wait(300);
    const r = await screen(175, 150);
    assert(Math.abs(r[0] - r[1]) < 12 && Math.abs(r[1] - r[2]) < 12, 'red shows gray under proof ' + r);
    await H.menu('View', 'Proof Colors: Grayscale');
    const r2 = await screen(175, 150); assert(r2[0] > 150 && r2[1] < 80, 'proof off ' + r2);
    const hist = await H.ev(() => { Gesso.Panels.show('histogram'); return true; });
    await H.wait(900);
    const clip = await page.locator('.hist-clip').innerText();
    assert(/shadows \d+\.\d+ %/.test(clip) && /▲/.test(clip), 'histogram clipping read-out: ' + clip);
    void hist;
  });

  await H.step('Customize Toolbar hides the Zoom group (its key still works); Recent colours appear in Swatches', async () => {
    await H.menu('Edit', 'Customize Toolbar…');
    const rows = page.locator('.tb-list .check-row');
    const n = await rows.count();
    for (let i = 0; i < n; i++) { if (/Zoom/.test(await rows.nth(i).innerText())) await rows.nth(i).locator('input').uncheck(); }
    await H.dialogBtn('OK');
    await H.wait(150);
    const vis = await H.ev(() => getComputedStyle(document.querySelector('.tool-btn[data-tool="zoom"]')).display);
    assert(vis === 'none', 'zoom button hidden');
    await H.key('z'); assert((await H.state()).tool === 'zoom', 'Z still selects it');
    await H.ev(() => { Gesso.app.prefs.hiddenTools = []; Gesso.Tools.renderStrip(); });
    await H.ev(() => { Gesso.App.setFg('#12a4c8'); });
    await H.wait(1100);
    await H.ev(() => Gesso.Panels.show('swatches'));
    await H.wait(200);
    const rc = await H.ev(() => [...document.querySelectorAll('.swatch-recent .swatch')].map((s) => s.title));
    assert(rc.includes('#12a4c8'), 'recent colour listed ' + rc);
  });

  await H.step('File ▸ Autosave This Document toggles; autosave + reload offers recovery and restores the picture (crash recovery)', async () => {
    await H.menu('File', 'Autosave This Document');
    assert(await H.ev(() => Gesso.app.doc.autosave === false), 'turned off');
    await H.menu('File', 'Autosave This Document');
    await H.ev(async () => { Gesso.app.doc.modified = true; await Gesso.FileIO.autosave(); });
    await H.wait(500);
    await page.reload(); await H.wait(900);
    assert(await H.dialogOpen(), 'recovery dialog after reload');
    await H.shot('c9-04-recovery');
    await H.dialogBtn('Recover');
    await H.wait(800);
    const st = await H.state();
    assert(st && /Pal/.test(st.name), 'document recovered: ' + (st && st.name));
    const p = await H.px(175, 150); assert(p[0] > 150 && p[1] < 80, 'pixels recovered ' + p);
  });

  await H.step('Window ▸ Arrange ▸ Match Zoom applies the zoom to every open document', async () => {
    await H.ev(() => Gesso.App.createDoc({ name: 'Two', w: 400, h: 300, dpi: 72, bg: 'white' }));
    await H.wait(200);
    await H.key('Control+1');
    await H.menu('Window', 'Arrange', 'Match Zoom (all documents)');
    const zs = await H.ev(() => Gesso.app.docs.map((d) => d.view.zoom));
    assert(zs.every((z) => Math.abs(z - 1) < 1e-6), 'zooms ' + zs);
  });

  await H.finish();
})();
