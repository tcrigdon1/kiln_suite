// Second batch: pen/paths, crop, quick mask, dialogs (effects, curves, levels, export, prefs, shortcuts), open image, paste.
const { ROOT } = require('../env.js');
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  await page.addInitScript(() => { window.showSaveFilePicker = undefined; window.showOpenFilePicker = undefined; });
  await page.goto('file://' + ROOT + '/Gesso/index.html');
  await page.waitForTimeout(500);
  const step = async (name, fn) => { try { await fn(); console.log('ok   ', name); } catch (e) { console.log('FAIL ', name, e.message.split('\n')[0]); errors.push('step ' + name + ': ' + e.message.split('\n')[0]); } };
  const shot = (n) => page.screenshot({ path: OUT + '/' + n + '.png' });
  const ev = (fn, arg) => page.evaluate(fn, arg);
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
  const click = (x, y, mods) => drag([[x, y]], { mods });
  const assert = (c, m) => { if (!c) throw new Error('assert: ' + m); };

  // make a test PNG to open
  const pngPath = path.join(__dirname, 'downloads', 'sample.png');
  await step('open image via file chooser', async () => {
    const b64 = await ev(() => { const c = document.createElement('canvas'); c.width = 640; c.height = 420; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 640, 420); g.addColorStop(0, '#203060'); g.addColorStop(1, '#f0a050'); x.fillStyle = g; x.fillRect(0, 0, 640, 420); x.fillStyle = '#fff'; x.beginPath(); x.arc(320, 210, 90, 0, 7); x.fill(); x.fillStyle = '#c33'; x.fillRect(40, 40, 120, 80); return c.toDataURL().split(',')[1]; });
    fs.mkdirSync(path.dirname(pngPath), { recursive: true });
    fs.writeFileSync(pngPath, Buffer.from(b64, 'base64'));
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
    await fc.setFiles(pngPath);
    await page.waitForTimeout(500);
    const s = await ev(() => Gesso.app.doc && [Gesso.app.doc.width, Gesso.app.doc.height, Gesso.app.doc.name]);
    assert(s && s[0] === 640 && s[1] === 420, JSON.stringify(s));
  });

  await step('curves adjustment layer UI', async () => {
    await page.click('.dock-tabs .tab >> text=Adjustments');
    await page.click('.adj-btn[title="Curves"]');
    await page.waitForTimeout(300);
    const cv = await page.$('.curve-canvas');
    const b = await cv.boundingBox();
    await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.3, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    await shot('12-curves');
    const pts = await ev(() => Gesso.app.doc.activeLayer().adj.params.curve.rgb.length);
    assert(pts === 3, 'points ' + pts);
  });

  await step('levels adjustment layer UI', async () => {
    await ev(() => Gesso.Cmd.run('layer.newAdjustment', 'levels'));
    await page.waitForTimeout(300);
    const h = await page.$('.lv-in .lv-h.black');
    const b = await h.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + 4); await page.mouse.down();
    await page.mouse.move(b.x + 40, b.y + 4, { steps: 4 }); await page.mouse.up();
    await page.waitForTimeout(300);
    await shot('13-levels');
    const v = await ev(() => Gesso.app.doc.activeLayer().adj.params.levels.rgb.inBlack);
    assert(v > 10, 'inBlack ' + v);
  });

  await step('layer effects dialog via UI', async () => {
    await ev(() => { const d = Gesso.app.doc; d.setActive(d.layers[0].id); });
    await ev(() => Gesso.Cmd.run('layer.effects', 'outerGlow'));
    await page.waitForTimeout(300);
    await page.click('.fx-item >> text=Inner Shadow');
    await page.waitForTimeout(200);
    await shot('14-effects-dialog');
    await page.click('.dialog .btn.primary');
    const fx = await ev(() => Object.keys(Gesso.app.doc.layers[0].effects.items));
    assert(fx.includes('outerGlow') && fx.includes('innerShadow'), fx.join());
  });

  await step('pen path → selection → shape', async () => {
    await page.keyboard.press('p');
    await click(100, 100); await click(300, 120);
    await drag([[320, 300], [380, 360]]);
    await click(100, 100); // close
    const n = await ev(() => { const d = Gesso.app.doc; const p = d.paths.find((x) => x.id === d.activePathId); return p && p.path.subpaths[0].nodes.length + ':' + p.path.subpaths[0].closed; });
    assert(n === '3:true', n);
    await ev(() => Gesso.Cmd.run('path.toSelection'));
    assert(await ev(() => !!Gesso.app.doc.selection), 'path selection');
    await ev(() => Gesso.Cmd.run('path.toShape'));
    await page.keyboard.press('a');
    await shot('15-pen');
    await page.keyboard.press('Control+d');
  });

  await step('crop tool', async () => {
    await page.keyboard.press('c');
    await drag([[50, 30], [600, 400]]);
    await shot('16-crop');
    await page.keyboard.press('Enter');
    const s = await ev(() => [Gesso.app.doc.width, Gesso.app.doc.height]);
    assert(s[0] === 550 && s[1] === 370, 'crop ' + s);
    await page.keyboard.press('Control+z');
    const s2 = await ev(() => [Gesso.app.doc.width, Gesso.app.doc.height]);
    assert(s2[0] === 640, 'undo crop ' + s2);
  });

  await step('quick mask round trip', async () => {
    await page.keyboard.press('m');
    await drag([[100, 100], [300, 300]]);
    await page.keyboard.press('q');
    assert(await ev(() => !!Gesso.app.doc.quickMask), 'qm on');
    await ev(() => { Gesso.App.setFg('#ffffff'); Gesso.Tools.select('brush'); Gesso.Tools.byId.brush.opts.size = 60; Gesso.Tools.byId.brush.opts.opacity = 100; });
    await drag([[400, 300], [500, 300]]);
    await page.waitForTimeout(100);
    await shot('17-quickmask');
    await page.keyboard.press('q');
    const b = await ev(() => Gesso.app.doc.selection && Gesso.app.doc.selection.bounds);
    assert(b && b.x + b.w > 480, 'qm selection ' + JSON.stringify(b));
  });

  await step('selection modify + stroke + fill', async () => {
    await ev(() => { const d = Gesso.app.doc; d.setActive(d.layers[0].id); d.setSelection(Gesso.Sel.feather(d.selection, 4), 'f'); d.setSelection(Gesso.Sel.expand(d.selection, 5), 'e'); });
    await ev(() => Gesso.Cmd.run('layer.new'));
    await ev(() => Gesso.App.fillWith('#3dbfae', 'Fill'));
    await page.keyboard.press('Control+d');
  });

  await step('color range dialog', async () => {
    await ev(() => Gesso.Cmd.run('select.colorRange'));
    await page.waitForTimeout(200);
    await click(320, 210);
    await page.waitForTimeout(100);
    await shot('18-colorrange');
    await page.click('.dialog .btn.primary');
    assert(await ev(() => !!Gesso.app.doc.selection), 'cr selection');
    await page.keyboard.press('Control+d');
  });

  await step('destructive adjustment dialog (hue/sat) + levels', async () => {
    await ev(() => { const d = Gesso.app.doc; d.setActive(d.layers[0].id); Gesso.Cmd.run('image.adjust', 'hueSaturation'); });
    await page.waitForTimeout(400);
    await page.click('.dialog .btn.primary');
    await ev(() => Gesso.Cmd.run('image.adjust', 'levels'));
    await page.waitForTimeout(400);
    await shot('19-levels-dialog');
    await page.click('.dialog .btn.primary');
    await ev(() => Gesso.Cmd.run('image.autoContrast'));
  });

  await step('export dialog', async () => {
    await page.keyboard.press('Control+Alt+s');
    await page.waitForTimeout(600);
    await shot('20-export');
    await page.click('.dialog .btn >> text=Cancel');
  });

  await step('preferences + shortcuts + about', async () => {
    await page.keyboard.press('Control+k'); await page.waitForTimeout(150); await shot('21-prefs'); await page.keyboard.press('Escape');
    await page.keyboard.press('F1'); await page.waitForTimeout(150); await shot('22-shortcuts'); await page.keyboard.press('Escape');
    await ev(() => Gesso.Cmd.run('help.about')); await page.waitForTimeout(100); await page.keyboard.press('Escape');
  });

  await step('copy / paste in place', async () => {
    await page.keyboard.press('m');
    await drag([[20, 20], [200, 150]]);
    await ev(() => { const d = Gesso.app.doc; d.setActive(d.layers[0].id); });
    await ev(() => Gesso.Clip.copy(false, false));
    await ev(() => Gesso.Clip.pasteInternal(true));
    const n = await ev(() => Gesso.app.doc.activeLayer().name);
    assert(n === 'Pasted Layer', n);
  });

  await step('context menus', async () => {
    const [x, y] = await toPage(300, 200);
    await page.mouse.click(x, y, { button: 'right' });
    await page.waitForTimeout(100);
    await shot('23-ctx');
    await page.keyboard.press('Escape');
    await page.click('.layer-row.active', { button: 'right' });
    await page.waitForTimeout(100);
    await page.keyboard.press('Escape');
  });

  await step('tool flyout + every tool activates', async () => {
    const ids = await ev(() => Gesso.Tools.list.map((t) => t.id));
    for (const id of ids) { await ev((i) => Gesso.Tools.select(i), id); await page.waitForTimeout(30); }
    await page.click('[data-tool]', { button: 'right' });
    await page.click('.tool-btn[data-tool="marqueeRect"], .tool-btn[data-tool="marqueeEllipse"]', { button: 'right' });
    await page.waitForTimeout(100);
    await shot('24-flyout');
    await page.keyboard.press('Escape');
  });

  await step('zoom + pan shortcuts', async () => {
    await page.keyboard.press('Control+1');
    let z = await ev(() => Gesso.app.doc.view.zoom); assert(z === 1, 'zoom ' + z);
    await page.keyboard.press('Control+='); z = await ev(() => Gesso.app.doc.view.zoom); assert(z > 1, 'zoom in ' + z);
    await page.keyboard.press('Control+0');
    await page.keyboard.press("Control+'");
    await page.keyboard.press('Control+r');
    await shot('25-grid');
    await page.keyboard.press("Control+'");
    await page.keyboard.press('Control+r');
  });

  console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nNO ERRORS');
  await browser.close();
})();
