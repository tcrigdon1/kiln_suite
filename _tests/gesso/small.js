const { ROOT } = require('../env.js');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1366, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + ROOT + '/Gesso/index.html');
  await page.waitForTimeout(400);
  await page.evaluate(() => { Gesso.App.createDoc({ name: 'Laptop', w: 1920, h: 1080, dpi: 72, bg: 'white' }); Gesso.Cmd.run('layer.new'); Gesso.Tools.select('brush'); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: __dirname + '/shots/37-laptop.png' });
  await page.evaluate(() => Gesso.Tools.select('text'));
  await page.waitForTimeout(100);
  await page.screenshot({ path: __dirname + '/shots/38-laptop-text.png' });
  console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
  await browser.close();
})();
