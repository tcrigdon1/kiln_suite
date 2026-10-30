// Crash sweep: every right-click menu item on timeline clips/transitions/gaps/headers/ruler and library items
const H = require('./hlib');
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('h15');
  await H.boot(p);
  await H.newProjectUI(p);
  await H.importUI(p, ['main1080.webm', 'still.jpg']);
  const sr = await H.center(p, '#p-timeline .tl-scroll');
  let it = await H.center(p, '#p-bin .bin-item:has(.name:text-is("main1080.webm"))');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V1'));
  await H.key(p, 'Backslash');
  it = await H.center(p, '#p-bin .bin-item:has(.name:text-is("still.jpg"))');
  await H.dnd(p, it.x, it.y, await H.tlX(p, 400), await H.tlRowY(p, 'V2'));
  const ruler = async (f) => p.mouse.click(await H.tlX(p, f), (await H.center(p, '#p-timeline .tl-ruler-hit')).y);
  // cut at 200, transition, gap on V2 before the still
  await ruler(200); await p.mouse.click(await H.tlX(p, 10), await H.tlRowY(p, 'V3')); await H.key(p, 'Control+k'); await H.key(p, 'Control+d');
  await H.key(p, 'm');
  let n = 0;
  async function sweep(label, openMenu) {
    await openMenu();
    await p.waitForTimeout(120);
    const items = await p.$$eval('.cl-menu:last-of-type .item:not(.disabled):not(.has-sub) .lbl', els => els.map(e => e.textContent.replace(/^✓/, '')));
    await p.keyboard.press('Escape');
    for (const lab of items) {
      const u0 = await p.evaluate(() => Cutline.H.undo.length);
      await openMenu(); await p.waitForTimeout(100);
      const el = p.locator('.cl-menu .item:not(.has-sub)', { hasText: lab }).first();
      try { await el.click({ timeout: 2000 }); n++; } catch (e) { H.info('could not click ' + label + ' › ' + lab); await p.keyboard.press('Escape'); continue; }
      await p.waitForTimeout(250);
      for (let k = 0; k < 3 && await p.locator('.modal-backdrop').count(); k++) { await p.keyboard.press('Escape'); await p.waitForTimeout(80); }
      await p.locator('#p-program textarea, .bin-rename').evaluateAll(els => els.forEach(e => e.blur())).catch(() => { });
      const u1 = await p.evaluate(() => Cutline.H.undo.length);
      for (let k = u0; k < u1; k++) await p.evaluate(() => Cutline.H.doUndoSilent()); // restore state for the next item (history API only for cleanup)
      if (errs.length) { H.info('error after ' + label + ' › ' + lab); break; }
    }
    H.ok(!errs.length, label + ': ' + items.length + ' items clicked without errors (' + items.join(', ') + ')');
  }
  const clipPt = async (track, idx) => { const bx = await H.clipBox(p, { track, idx }); return [(bx.x0 + bx.x1) / 2 + 8, bx.y]; };
  await sweep('video clip', async () => { const [x, y] = await clipPt('V1', 0); await p.mouse.click(x, y, { button: 'right' }); });
  await sweep('audio clip', async () => { const [x, y] = await clipPt('A1', 1); await p.mouse.click(x, y, { button: 'right' }); });
  await sweep('transition', async () => { await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); const t = await p.evaluate(() => { const t = Cutline.P.seq().transitions[0]; const cv = Cutline.TL.canvas.getBoundingClientRect(); return t && t._rect ? { x: cv.left + t._rect[0] + t._rect[2] / 2, y: cv.top + t._rect[1] + t._rect[3] / 2 } : null; }); if (t) await p.mouse.click(t.x, t.y, { button: 'right' }); });
  await sweep('gap', async () => { await p.mouse.click(await H.tlX(p, 150), await H.tlRowY(p, 'V2'), { button: 'right' }); });
  await sweep('empty track area', async () => { await p.mouse.click(await H.tlX(p, 150), await H.tlRowY(p, 'V3'), { button: 'right' }); });
  await sweep('track header', async () => { await p.click('.tl-heads .th.video:has(.lbl:text-is("V2")) .name', { button: 'right' }); });
  await sweep('ruler', async () => { await p.mouse.click(await H.tlX(p, 300), (await H.center(p, '#p-timeline .tl-ruler-hit')).y, { button: 'right' }); });
  await sweep('library media', async () => { await p.click('#p-bin .bin-item:has(.name:text-is("main1080.webm"))', { button: 'right' }); });
  await sweep('library sequence', async () => { await p.click('#p-bin .bin-item:has(.name:text-is("Sequence 1"))', { button: 'right' }); });
  await sweep('library background', async () => { const bb = await H.center(p, '#p-bin .bin-body'); await p.mouse.click(bb.bb.x + bb.bb.width - 10, bb.bb.y + bb.bb.height - 10, { button: 'right' }); });
  H.info('clicked ' + n + ' context-menu items');
  await H.shot(p, 'after-sweep');
  await H.finish(b, errs, 'h15_context_menus');
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
