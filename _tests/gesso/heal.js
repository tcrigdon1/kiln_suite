const { ROOT } = require('../env.js');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + ROOT + '/Gesso/index.html');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const d = Gesso.App.createDoc({ name: 'Heal', w: 400, h: 300, dpi: 72, bg: 'white' });
    const c = d.layers[0].canvas.getContext('2d');
    const g = c.createLinearGradient(0, 0, 400, 300); g.addColorStop(0, '#c8a070'); g.addColorStop(1, '#7a5030'); c.fillStyle = g; c.fillRect(0, 0, 400, 300);
    const img = c.getImageData(0, 0, 400, 300); for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 40; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; } c.putImageData(img, 0, 0);
    c.fillStyle = '#202020'; c.beginPath(); c.arc(120, 120, 10, 0, 7); c.fill(); c.beginPath(); c.arc(260, 180, 8, 0, 7); c.fill();
    d.bump(d.layers[0]);
    Gesso.View.setZoom(2);
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: __dirname + '/shots/39-heal-before.png' });
  const toPage = async (x, y) => page.evaluate(([x, y]) => { const r = Gesso.View.canvas.getBoundingClientRect(); const [sx, sy] = Gesso.View.toScreen(x, y); return [r.left + sx, r.top + sy]; }, [x, y]);
  await page.evaluate(() => { Gesso.Tools.select('spotHeal'); Gesso.Tools.byId.spotHeal.opts.size = 30; });
  for (const [x, y] of [[120, 120], [260, 180]]) { const [a, b] = await toPage(x, y); const [a2, b2] = await toPage(x + 3, y + 2); await page.mouse.move(a, b); await page.mouse.down(); await page.mouse.move(a2, b2, { steps: 3 }); await page.mouse.up(); }
  await page.waitForTimeout(200);
  await page.screenshot({ path: __dirname + '/shots/40-heal-after.png' });
  console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
  await browser.close();
})();
