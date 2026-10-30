// Drag every tool across the canvas on every layer type (raster, text, shape, adjustment mask, group, quick mask).
const { ROOT } = require('../env.js');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  await page.goto('file://' + ROOT + '/Gesso/index.html');
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const d = Gesso.App.createDoc({ name: 'TM', w: 500, h: 400, dpi: 72, bg: 'white' });
    Gesso.Cmd.run('layer.new'); Gesso.App.fillWith('#aa5533', 'f');
    Gesso.addLayer(Gesso.Layers.text(d, { text: 'Text', x: 20, y: 20, size: 40 }), 't');
    Gesso.addLayer(Gesso.Layers.shape(d, { kind: 'rect', x: 200, y: 100, w: 100, h: 100 }), 's');
    Gesso.Cmd.run('layer.newAdjustment', 'invert');
    Gesso.Cmd.run('layer.newGroup');
  });
  const toPage = async (x, y) => page.evaluate(([x, y]) => { const r = Gesso.View.canvas.getBoundingClientRect(); const [sx, sy] = Gesso.View.toScreen(x, y); return [r.left + sx, r.top + sy]; }, [x, y]);
  const tools = await page.evaluate(() => Gesso.Tools.list.map((t) => t.id));
  const types = ['raster', 'text', 'shape', 'adjustment', 'group', 'qm'];
  let n = 0;
  for (const ty of types) {
    for (const t of tools) {
      await page.evaluate(([ty, t]) => {
        const d = Gesso.app.doc;
        if (ty === 'qm') { if (!d.quickMask) Gesso.App.toggleQuickMask(); }
        else { if (d.quickMask) Gesso.App.toggleQuickMask(); const l = d.allLayers().find((x) => x.type === ty); if (l) d.setActive(l.id); }
        Gesso.Tools.select(t);
      }, [ty, t]);
      const before = errors.length;
      const [a, b] = await toPage(60 + (n % 5) * 20, 60), [c, e] = await toPage(260, 220);
      await page.mouse.move(a, b); await page.mouse.down(); await page.mouse.move(c, e, { steps: 5 }); await page.mouse.up();
      await page.waitForTimeout(40);
      // close dialogs (e.g. rasterize prompts) and commit transient states
      for (let k = 0; k < 3; k++) { if (!(await page.evaluate(() => Gesso.Dialog.isOpen()))) break; await page.keyboard.press('Escape'); await page.waitForTimeout(40); }
      await page.keyboard.press('Escape');
      await page.keyboard.press('Enter');
      if (errors.length > before) console.log('ERR', ty, t, errors.slice(before).join(' | ').slice(0, 400));
      n++;
    }
  }
  console.log('drags:', n);
  console.log(errors.length ? 'ERRORS: ' + errors.length : 'NO ERRORS');
  await browser.close();
})();
