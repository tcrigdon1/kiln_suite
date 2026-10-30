const { launch, newProject, importFiles } = require('./lib');
(async () => {
  const { b, p, errs } = await launch();
  await newProject(p);
  await importFiles(p, ['vp8.webm']);
  const id = await p.evaluate(() => Cutline.state.project.media[0].id);
  const rowY = await p.evaluate(() => Cutline.TL.rowOf(Cutline.P.vtracks(Cutline.P.seq())[0].id).y + 20);
  await p.dragAndDrop(`.bin-item[data-id="${id}"]`, '.tl-scroll', { targetPosition: { x: 5, y: rowY } });
  await p.waitForTimeout(300);
  const dlg = await p.locator('.dialog-head:has-text("Clip format")').count();
  console.log('dialog', dlg);
  await p.click('.dialog-foot .btn.primary');
  const s = await p.evaluate(() => { const s = Cutline.P.seq(); return [s.w, s.h, s.fps, s.clips[0].dur]; });
  console.log('seq', JSON.stringify(s), errs.join('\n'));
  await b.close();
})();
