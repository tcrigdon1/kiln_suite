// Performance probe: brush strokes on a 4K document with several layers.
const { ROOT } = require('../env.js');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + ROOT + '/Gesso/index.html');
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const d = Gesso.App.createDoc({ name: 'Big', w: 3840, h: 2160, dpi: 72, bg: 'white' });
    for (let i = 0; i < 4; i++) Gesso.Cmd.run('layer.new');
    Gesso.Cmd.run('layer.newAdjustment', 'hueSaturation');
    Gesso.Cmd.run('layer.new');
    Gesso.Tools.select('brush');
    Gesso.Tools.byId.brush.opts.size = 80;
    void d;
  });
  await page.waitForTimeout(500);
  const toPage = async (x, y) => page.evaluate(([x, y]) => { const r = Gesso.View.canvas.getBoundingClientRect(); const [sx, sy] = Gesso.View.toScreen(x, y); return [r.left + sx, r.top + sy]; }, [x, y]);
  const t0 = Date.now();
  const [x0, y0] = await toPage(200, 200);
  await page.mouse.move(x0, y0); await page.mouse.down();
  for (let i = 0; i < 60; i++) { const [x, y] = await toPage(200 + i * 50, 200 + Math.sin(i / 5) * 400 + 600); await page.mouse.move(x, y, { steps: 2 }); }
  await page.mouse.up();
  const dt = Date.now() - t0;
  const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const s = performance.now(); const f = () => { n++; if (performance.now() - s < 1000) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); }));
  console.log('stroke time (60 moves):', dt, 'ms; idle fps', fps);
  // time a full recomposite
  const comp = await page.evaluate(() => { const d = Gesso.app.doc; const s = performance.now(); d.invalidate(); Gesso.Compositor.update(d); return performance.now() - s; });
  console.log('full composite 4K w/ adjustment:', comp.toFixed(1), 'ms');
  console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
  await browser.close();
})();
