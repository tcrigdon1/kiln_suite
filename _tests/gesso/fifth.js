// Fifth batch: dialogs via UI (image size, canvas size, trim, fill, stroke, refine, guide layout), shape modes, pen shape mode, move float.
const { ROOT } = require('../env.js');
const { chromium } = require('playwright');
const path = require('path');
const OUT = path.join(__dirname, 'shots');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  await page.goto('file://' + ROOT + '/Gesso/index.html');
  await page.waitForTimeout(400);
  const step = async (name, fn) => { try { await fn(); console.log('ok   ', name); } catch (e) { console.log('FAIL ', name, e.message.split('\n')[0]); errors.push('step ' + name + ': ' + e.message.split('\n')[0]); } };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const assert = (c, m) => { if (!c) throw new Error('assert: ' + m); };
  const toPage = async (x, y) => ev(([x, y]) => { const r = Gesso.View.canvas.getBoundingClientRect(); const [sx, sy] = Gesso.View.toScreen(x, y); return [r.left + sx, r.top + sy]; }, [x, y]);
  const drag = async (pts, opts = {}) => {
    const [x0, y0] = await toPage(...pts[0]);
    if (opts.mods) for (const m of opts.mods) await page.keyboard.down(m);
    await page.mouse.move(x0, y0); await page.mouse.down();
    for (let i = 1; i < pts.length; i++) { const [x, y] = await toPage(...pts[i]); await page.mouse.move(x, y, { steps: opts.steps || 6 }); }
    await page.mouse.up();
    if (opts.mods) for (const m of opts.mods) await page.keyboard.up(m);
    await page.waitForTimeout(60);
  };
  const dlgOK = async () => { await page.waitForTimeout(120); await page.click('.dialog .btn.primary'); await page.waitForTimeout(150); };

  await ev(() => Gesso.App.createDoc({ name: 'D', w: 600, h: 400, dpi: 72, bg: 'transparent' }));

  await step('fill dialog', async () => {
    await page.keyboard.press('Shift+F5');
    await page.waitForTimeout(150);
    await page.screenshot({ path: OUT + '/34-fill.png' });
    await dlgOK();
    const a = await ev(() => Gesso.Layers.readRect(Gesso.app.doc.layers[0].canvas, { x: 10, y: 10, w: 1, h: 1 }).data[3]); // layer canvases are content-sized: read in document space
    assert(a === 255, 'filled ' + a);
  });

  await step('image size dialog', async () => {
    await page.keyboard.press('Control+Alt+i');
    await page.waitForTimeout(150);
    const inputs = await page.$$('.dialog input[type=number]');
    await inputs[2].fill('50'); await inputs[2].dispatchEvent('input');
    await dlgOK();
    const s = await ev(() => [Gesso.app.doc.width, Gesso.app.doc.height]);
    assert(s[0] === 300 && s[1] === 200, 'size ' + s);
  });

  await step('canvas size dialog (relative, anchored)', async () => {
    await page.keyboard.press('Control+Alt+c');
    await page.waitForTimeout(150);
    await page.click('.dialog .check-row input');
    const inputs = await page.$$('.dialog input[type=number]');
    await inputs[0].fill('100'); await inputs[1].fill('50');
    await page.click('.anchor-cell >> nth=0');
    await page.screenshot({ path: OUT + '/35-canvassize.png' });
    await dlgOK();
    const s = await ev(() => [Gesso.app.doc.width, Gesso.app.doc.height]);
    assert(s[0] === 400 && s[1] === 250, 'size ' + s);
  });

  await step('trim transparent', async () => {
    await ev(() => Gesso.Cmd.run('image.trim'));
    await dlgOK();
    const s = await ev(() => [Gesso.app.doc.width, Gesso.app.doc.height]);
    assert(s[0] === 300 && s[1] === 200, 'trim ' + s);
  });

  await step('stroke dialog on selection', async () => {
    await ev(() => { Gesso.Cmd.run('layer.new'); const d = Gesso.app.doc; d.setSelection(Gesso.Sel.make(Gesso.Sel.rectMask(d.width, d.height, 50, 50, 100, 80), d.width, d.height)); });
    await ev(() => Gesso.Cmd.run('edit.stroke'));
    await dlgOK();
    const a = await ev(() => Gesso.Layers.readRect(Gesso.app.doc.activeLayer().canvas, { x: 50, y: 90, w: 1, h: 1 }).data[3]);
    assert(a > 100, 'stroke alpha ' + a);
  });

  await step('refine dialog → new layer with mask', async () => {
    await ev(() => Gesso.Cmd.run('select.refine'));
    await page.waitForTimeout(150);
    await page.selectOption('.dialog select', 'newLayerMask');
    await dlgOK();
    const m = await ev(() => !!Gesso.app.doc.activeLayer().mask);
    assert(m, 'mask');
  });

  await step('guide layout', async () => {
    await ev(() => Gesso.Cmd.run('view.guideLayout'));
    await dlgOK();
    const n = await ev(() => Gesso.app.doc.guides.length);
    assert(n >= 6, 'guides ' + n);
  });

  await step('shape tool path + pixels modes', async () => {
    await ev(() => { Gesso.View.fit(); Gesso.Tools.select('star'); Gesso.Tools.byId.star.opts.mode = 'path'; });
    await drag([[20, 20], [120, 120]]);
    const p = await ev(() => Gesso.app.doc.paths.length);
    assert(p === 1, 'path ' + p);
    await ev(() => { const d = Gesso.app.doc; d.setActive(d.layers[0].id); Gesso.Tools.byId.star.opts.mode = 'pixels'; });
    await drag([[150, 20], [250, 120]]);
    const h = await ev(() => Gesso.app.doc.history.entries[Gesso.app.doc.history.index].name);
    assert(h === 'Star', h);
    await ev(() => { Gesso.Tools.byId.star.opts.mode = 'shape'; });
  });

  await step('pen in shape mode', async () => {
    await ev(() => { Gesso.Tools.select('pen'); Gesso.Tools.byId.pen.opts.mode = 'shape'; Gesso.Tools.renderOptions(); });
    for (const [x, y] of [[30, 150], [120, 140], [100, 190]]) await drag([[x, y]]);
    await drag([[30, 150]]);
    const l = await ev(() => { const l = Gesso.app.doc.activeLayer(); return l.type + ':' + l.shape.kind + ':' + l.shape.path.subpaths[0].nodes.length; });
    assert(l === 'shape:path:3', l);
    await ev(() => { Gesso.Tools.byId.pen.opts.mode = 'path'; });
  });

  await step('move selection contents by dragging', async () => {
    await ev(() => { const d = Gesso.app.doc; d.setActive(d.layers[0].id); d.setSelection(Gesso.Sel.make(Gesso.Sel.rectMask(d.width, d.height, 0, 0, 60, 60), d.width, d.height)); Gesso.Tools.select('move'); });
    await drag([[30, 30], [130, 80]]);
    const b = await ev(() => Gesso.app.doc.selection.bounds);
    assert(b.x === 100 && b.y === 50, JSON.stringify(b));
    const h = await ev(() => Gesso.app.doc.history.entries[Gesso.app.doc.history.index].name);
    assert(h === 'Move Selection Contents', h);
    await page.keyboard.press('Control+d');
  });

  await step('layer via copy / cut', async () => {
    await ev(() => { const d = Gesso.app.doc; d.setActive(d.layers[0].id); d.setSelection(Gesso.Sel.make(Gesso.Sel.rectMask(d.width, d.height, 0, 0, 100, 100), d.width, d.height)); });
    await page.keyboard.press('Control+j');
    let n = await ev(() => Gesso.app.doc.activeLayer().name);
    assert(n.endsWith('copy'), n);
    await ev(() => { const d = Gesso.app.doc; d.setActive(d.layers[0].id); });
    await page.keyboard.press('Control+Shift+j');
    n = await ev(() => Gesso.app.doc.activeLayer().name);
    assert(n.endsWith('cut'), n);
  });

  await step('layer properties via UI (opacity input)', async () => {
    await page.fill('.layers-top input[type=number] >> nth=0', '40');
    await page.press('.layers-top input[type=number] >> nth=0', 'Enter');
    await page.waitForTimeout(100);
    const o = await ev(() => Gesso.app.doc.activeLayer().opacity);
    assert(Math.abs(o - 0.4) < 0.001, 'opacity ' + o);
  });

  await page.screenshot({ path: OUT + '/36-fifth.png' });
  console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nNO ERRORS');
  await browser.close();
})();
