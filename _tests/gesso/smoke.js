// Basic smoke test: load Gesso, collect errors, screenshot welcome + new doc.
const { ROOT } = require('../env.js');
const { chromium } = require('playwright');
const path = require('path');
const OUT = path.join(__dirname, 'shots');
require('fs').mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  await page.goto('file://' + ROOT + '/Gesso/index.html');
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + '/01-welcome.png' });
  await page.evaluate(() => Gesso.App.createDoc({ name: 'Test', w: 1200, h: 800, dpi: 72, bg: 'white' }));
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + '/02-newdoc.png' });
  console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
  await browser.close();
})();
