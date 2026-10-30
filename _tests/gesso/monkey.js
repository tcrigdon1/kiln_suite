// Run every registered command in a populated document; close any dialog it opens.
const { ROOT } = require('../env.js');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('dialog', (d) => d.dismiss());
  await page.addInitScript(() => { window.showSaveFilePicker = undefined; window.showOpenFilePicker = undefined; window.open = () => null; });
  await page.goto('file://' + ROOT + '/Gesso/index.html');
  await page.waitForTimeout(400);
  const setup = () => page.evaluate(() => {
    const d = Gesso.App.createDoc({ name: 'M', w: 400, h: 300, dpi: 72, bg: 'white' });
    Gesso.Cmd.run('layer.new');
    Gesso.App.fillWith('#3366aa', 'f');
    Gesso.addLayer(Gesso.Layers.text(d, { text: 'Hi', x: 20, y: 20, size: 40 }), 't');
    Gesso.addLayer(Gesso.Layers.shape(d, { kind: 'star', x: 200, y: 100, w: 100, h: 100 }), 's');
    d.commit('fx', () => { d.activeLayer().effects = { enabled: true, items: { dropShadow: Gesso.Effects.defaults('dropShadow') } }; });
    d.commit('mask', () => { d.activeLayer().mask = Gesso.Layers.newMask(d, 255); });
    d.paths.push({ id: 'p1', name: 'P', path: Gesso.Paths.ellipse(100, 100, 50, 40) }); d.activePathId = 'p1';
    d.setSelection(Gesso.Sel.make(Gesso.Sel.rectMask(400, 300, 50, 50, 150, 100), 400, 300));
    return true;
  });
  await setup();
  const skip = new Set(['image.adjust', 'layer.newAdjustment', 'filter.apply', 'window.panel', 'view.channel', 'file.open', 'file.place', 'view.fullscreen', 'file.print', 'file.close', 'file.closeAll', 'select.load']);
  const ids = await page.evaluate(() => Gesso.Cmd.order.slice());
  const layerTargets = ['raster', 'text', 'shape'];
  for (const id of ids) {
    if (skip.has(id)) continue;
    for (const lt of (id.startsWith('layer.') || id.startsWith('edit.') || id.startsWith('image.') ? layerTargets : ['raster'])) {
      await page.evaluate((lt) => { const d = Gesso.app.doc; if (!d) return; const l = d.allLayers().find((x) => x.type === lt); if (l) d.setActive(l.id); }, lt);
      const before = errors.length;
      await page.evaluate((id) => { try { Gesso.Cmd.run(id); } catch (e) { console.error('cmd ' + id + ': ' + e.message); } }, id);
      await page.waitForTimeout(80);
      for (let k = 0; k < 3; k++) {
        const open = await page.evaluate(() => Gesso.Dialog.isOpen() || !!Gesso.Transform.active);
        if (!open) break;
        await page.evaluate(() => { if (Gesso.Transform.active) Gesso.Transform.cancel(); });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(60);
      }
      if (errors.length > before) console.log('ERR after', id, lt, errors.slice(before).join(' | ').slice(0, 300));
      const has = await page.evaluate(() => !!Gesso.app.doc);
      if (!has) await setup();
      if (!id.startsWith('layer.') && !id.startsWith('edit.') && !id.startsWith('image.')) break;
    }
  }
  console.log('commands run:', ids.length);
  console.log(errors.length ? '\nERRORS:\n' + errors.join('\n').slice(0, 3000) : '\nNO ERRORS');
  await browser.close();
})();
