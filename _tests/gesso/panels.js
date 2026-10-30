const { ROOT } = require('../env.js');
const { chromium } = require('playwright');
const OUT = __dirname + '/shots';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message + e.stack));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + ROOT + '/Gesso/index.html');
  await page.waitForTimeout(400);
  await page.evaluate(() => { Gesso.App.createDoc({ name: 'Panels', w: 1200, h: 800, dpi: 72, bg: 'white' }); const d = Gesso.app.doc; const c = d.layers[0].canvas.getContext('2d'); const g = c.createLinearGradient(0, 0, 1200, 800); g.addColorStop(0, '#203060'); g.addColorStop(1, '#f0a050'); c.fillStyle = g; c.fillRect(0, 0, 1200, 800); d.bump(d.layers[0]); Gesso.Tools.select('gradient'); });
  await page.waitForTimeout(300);
  const tabs = [['Histogram', 'Brushes', 'Paths', 'Swatches', 'Adjustments'], ['Info', 'History', 'Channels', 'Color', 'Properties']];
  let i = 0;
  for (const set of tabs) {
    for (const t of set) await page.click('.dock-tabs .tab >> text=' + t);
    await page.waitForTimeout(500);
    await page.screenshot({ path: OUT + '/30-panels-' + i++ + '.png' });
  }
  await page.evaluate(() => Gesso.ColorPicker.open('#3dbfae', null, null));
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + '/31-colorpicker.png' });
  console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
  await browser.close();
})();
