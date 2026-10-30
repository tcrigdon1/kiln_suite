const { launch, newProject, importFiles } = require('./lib');
(async () => {
  const { b, p, errs } = await launch();
  p.on('filechooser', fc => { }); p.on('dialog', d => d.dismiss());
  await newProject(p);
  await importFiles(p, ['test1.webm', 'tone.wav']);
  await p.evaluate(() => { const C = Cutline; C.edit('x', s2 => { const m = C.state.project.media; C.T.placeMedia(s2, m[0], 0, C.P.vtracks(s2)[0].id, C.P.atracks(s2)[0].id, 'overwrite'); C.T.placeMedia(s2, m[0], 330, C.P.vtracks(s2)[0].id, null, 'overwrite'); }); C.TL.zoomFit(); window.__base = C.H.undo.length; });
  const tl = await p.locator('.tl-scroll').boundingBox();
  async function ctxAt(getXY, filter) {
    const xy = await p.evaluate(getXY);
    await p.mouse.click(tl.x + xy.x, tl.y + xy.y, { button: 'right' });
    const labels = await p.$$eval('.cl-menu .item:not(.disabled):not(.has-sub) .lbl', els => els.map(e => e.textContent.replace(/^✓/, '')));
    await p.keyboard.press('Escape');
    let n = 0;
    for (const lab of labels) {
      if (filter && !filter(lab)) continue;
      await p.mouse.click(tl.x + xy.x, tl.y + xy.y, { button: 'right' });
      try { await p.locator('.cl-menu .item:not(.has-sub)', { hasText: lab }).first().click({ timeout: 1500 }); n++; } catch (e) { await p.keyboard.press('Escape'); }
      await p.waitForTimeout(100);
      await p.evaluate(() => Cutline.ui.openDialogs.slice().forEach(d => d.close()));
      await p.evaluate(() => { while (Cutline.H.undo.length > window.__base) Cutline.H.doUndoSilent(); });
    }
    return n;
  }
  const clipXY = () => { const C = Cutline, s = C.P.seq(), c = s.clips.find(c => c.kind === 'video'); return { x: C.TL.f2x(c.start + 30), y: C.TL.rowOf(c.trackId).y + 30 }; };
  const aXY = () => { const C = Cutline, s = C.P.seq(), c = s.clips.find(c => c.kind === 'audio'); return { x: C.TL.f2x(c.start + 30), y: C.TL.rowOf(c.trackId).y + 30 }; };
  const gapXY = () => { const C = Cutline, s = C.P.seq(); return { x: C.TL.f2x(315), y: C.TL.rowOf(C.P.vtracks(s)[0].id).y + 30 }; };
  const emptyXY = () => { const C = Cutline, s = C.P.seq(); return { x: C.TL.f2x(100), y: C.TL.rowOf(C.P.vtracks(s)[2].id).y + 20 }; };
  console.log('clip menu', await ctxAt(clipXY, l => !/Reveal|Open in Source/.test(l)));
  console.log('audio menu', await ctxAt(aXY));
  console.log('gap menu', await ctxAt(gapXY));
  console.log('empty menu', await ctxAt(emptyXY));
  // transition menu
  await p.evaluate(() => { const C = Cutline; C.edit('tr', s2 => { const v = s2.clips.filter(c => c.kind === 'video').sort((a, b) => a.start - b.start); C.A.placeTransition(s2, v[0], 'out', 'cross', 30); }); });
  const trXY = () => { const C = Cutline, s = C.P.seq(), t = s.transitions[0]; const r = t._rect; return { x: r[0] + r[2] / 2, y: r[1] + r[3] / 2 - 30 + 0 }; };
  await p.waitForTimeout(200);
  console.log('ERRORS:\n' + errs.join('\n').slice(0, 3000));
  await b.close();
})();
