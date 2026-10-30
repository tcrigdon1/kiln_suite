const { launch, newProject } = require('./lib');
(async () => {
  const { b, p, errs } = await launch({ viewport: { width: 1440, height: 900 } });
  await newProject(p);
  await p.keyboard.press('Control+,'); await p.waitForTimeout(300);
  await p.screenshot({ path: 'shots/60-prefs.png' });
  await p.keyboard.press('Escape');
  await p.evaluate(() => Cutline.ui.about()); await p.waitForTimeout(200);
  await p.screenshot({ path: 'shots/61-about.png' });
  await p.keyboard.press('Escape');
  await p.evaluate(() => Cutline.ui.sequenceDialog(Cutline.P.seq())); await p.waitForTimeout(200);
  await p.screenshot({ path: 'shots/62-seqsettings.png' });
  await p.keyboard.press('Escape');
  await p.click('.menu-title:has-text("Effects")'); await p.waitForTimeout(150);
  await p.hover('.cl-menu .item:has-text("Stylize")'); await p.waitForTimeout(200);
  await p.screenshot({ path: 'shots/63-effectsmenu.png' });
  console.log('ERRORS:', errs.join('\n'));
  await b.close();
})();
