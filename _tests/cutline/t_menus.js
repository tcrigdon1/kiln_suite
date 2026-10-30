const { launch, newProject, importFiles } = require('./lib');
(async () => {
  const { b, p, errs } = await launch();
  p.on('filechooser', fc => { /* ignore */ });
  p.on('dialog', d => d.dismiss());
  await newProject(p);
  await importFiles(p, ['test1.webm', 'tone.wav']);
  await p.evaluate(() => { window.showSaveFilePicker = undefined; window.showOpenFilePicker = undefined; Cutline.Export.noPicker = true;
    const C = Cutline; C.edit('x', s2 => { const m = C.state.project.media; C.T.placeMedia(s2, m[0], 0, C.P.vtracks(s2)[0].id, C.P.atracks(s2)[0].id, 'overwrite'); C.T.placeMedia(s2, m[1], 300, null, C.P.atracks(s2)[1].id, 'overwrite'); s2.captions.push({ id: 'c', start: 0, end: 30, text: 'hi' }); });
    C.A.select([C.P.seq().clips[0].id]); C.Engine.seek(100); });
  const menus = await p.$$eval('.menu-title', els => els.map(e => e.textContent));
  let count = 0;
  for (const mt of menus) {
    await p.click(`.menu-title:has-text("${mt}")`);
    const labels = await p.$$eval('.cl-menu .item:not(.disabled):not(.has-sub) .lbl', els => els.map(e => e.textContent.replace(/^✓/, '')));
    await p.keyboard.press('Escape');
    for (const lab of labels) {
      if (/Export Media|Export Audio|Import|Open Project|New Project|Relink|Captions \(SRT\)…|Full-Screen/.test(lab) && !/Export Captions/.test(lab)) continue;
      await p.click(`.menu-title:has-text("${mt}")`);
      const item = p.locator('.cl-menu .item:not(.has-sub)', { hasText: lab }).first();
      try { await item.click({ timeout: 2000 }); count++; } catch (e) { console.log('could not click', mt, lab); await p.keyboard.press('Escape'); }
      await p.waitForTimeout(120);
      await p.evaluate(() => Cutline.ui.openDialogs.slice().forEach(d => d.close()));
      await p.evaluate(() => { const C = Cutline; if (!C.P.seq().clips.length) C.H.doUndoSilent(); if (C.P.selectedClips().length === 0 && C.P.seq().clips[0]) C.A.select([C.P.seq().clips[0].id]); });
    }
  }
  console.log('clicked', count, 'menu items');
  console.log('ERRORS:\n' + errs.join('\n').slice(0, 3000));
  await b.close();
})();
