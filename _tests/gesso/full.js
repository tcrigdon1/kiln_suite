// Full feature exercise for Gesso. Run: node full.js
const { ROOT } = require('../env.js');
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const DL = path.join(__dirname, 'downloads');
fs.mkdirSync(DL, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  // disable File System Access pickers so downloads are used
  await page.addInitScript(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; window.showSaveFilePicker = undefined; window.showOpenFilePicker = undefined; });
  await page.goto('file://' + ROOT + '/Gesso/index.html');
  await page.waitForTimeout(600);
  const step = async (name, fn) => {
    try { await fn(); console.log('ok   ', name); }
    catch (e) { console.log('FAIL ', name, e.message); errors.push('step ' + name + ': ' + e.message); }
  };
  const shot = (n) => page.screenshot({ path: OUT + '/' + n + '.png' });
  const ev = (fn, arg) => page.evaluate(fn, arg);

  // map doc coords → page coords
  const toPage = async (x, y) => ev(([x, y]) => { const r = Gesso.View.canvas.getBoundingClientRect(); const [sx, sy] = Gesso.View.toScreen(x, y); return [r.left + sx, r.top + sy]; }, [x, y]);
  const drag = async (pts, opts = {}) => {
    const [x0, y0] = await toPage(...pts[0]);
    if (opts.mods) for (const m of opts.mods) await page.keyboard.down(m);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i < pts.length; i++) { const [x, y] = await toPage(...pts[i]); await page.mouse.move(x, y, { steps: opts.steps || 8 }); }
    await page.mouse.up();
    if (opts.mods) for (const m of opts.mods) await page.keyboard.up(m);
    await page.waitForTimeout(80);
  };
  const click = async (x, y, mods) => drag([[x, y]], { mods });
  const pixel = (x, y, layerIdx) => ev(([x, y, li]) => {
    const d = Gesso.app.doc; Gesso.Compositor.update(d);
    const c = li == null ? d.composite : d.allLayers()[li].canvas;
    return Array.from(c.getContext('2d').getImageData(x, y, 1, 1).data);
  }, [x, y, layerIdx]);
  const assert = (cond, msg) => { if (!cond) throw new Error('assert: ' + msg); };

  await step('new document via dialog', async () => {
    await page.keyboard.press('Control+n');
    await page.waitForTimeout(200);
    await shot('03-newdoc-dialog');
    await page.click('.nd-cats .tab >> text=Social');
    await page.click('.nd-card >> text=Square 1080');
    await page.click('.dialog .btn.primary');
    await page.waitForTimeout(300);
    const s = await ev(() => [Gesso.app.doc.width, Gesso.app.doc.height]);
    assert(s[0] === 1080 && s[1] === 1080, 'size ' + s);
  });

  await step('brush stroke', async () => {
    await page.keyboard.press('b');
    await ev(() => { Gesso.App.setFg('#d03030'); const t = Gesso.Tools.byId.brush; t.opts.size = 40; t.opts.hardness = 1; t.opts.opacity = 100; t.opts.flow = 100; t.opts.smoothing = 0; Gesso.Brush.applyPreset(t.opts, Gesso.Brush.PRESETS[1]); });
    await page.keyboard.press('Control+Shift+n'); // new layer
    await drag([[100, 100], [300, 150], [500, 120], [700, 300]]);
    const p = await pixel(100, 100);
    assert(p[0] > 180 && p[1] < 80, 'brush color ' + p);
  });

  await step('undo / redo', async () => {
    await page.keyboard.press('Control+z');
    let p = await pixel(100, 100);
    assert(p[0] > 240 && p[1] > 240, 'undo restored white ' + p);
    await page.keyboard.press('Control+Shift+z');
    p = await pixel(100, 100);
    assert(p[0] > 180 && p[1] < 80, 'redo ' + p);
  });

  await step('blend mode change', async () => {
    await page.selectOption('.layers-blend', 'multiply');
    const b = await ev(() => Gesso.app.doc.activeLayer().blend);
    assert(b === 'multiply', b);
  });

  await step('shapes: rectangle & ellipse layers', async () => {
    await ev(() => { Gesso.Tools.select('rect'); Gesso.App.setFg('#2b63b8'); Gesso.Tools.byId.rect.opts.fill = '#2b63b8'; Gesso.Tools.byId.rect.opts.mode = 'shape'; });
    await drag([[600, 600], [900, 850]]);
    await ev(() => { Gesso.Tools.select('ellipse'); Gesso.Tools.byId.ellipse.opts.fill = '#3dbfae'; Gesso.Tools.byId.ellipse.opts.strokeOn = true; });
    await drag([[150, 600], [450, 900]]);
    const types = await ev(() => Gesso.app.doc.allLayers().map((l) => l.type));
    assert(types.filter((t) => t === 'shape').length === 2, types.join());
    const p = await pixel(750, 700);
    assert(p[2] > 150, 'rect pixel ' + p);
  });

  await step('star + custom shape', async () => {
    await ev(() => { Gesso.Tools.select('star'); Gesso.Tools.byId.star.opts.fill = '#e2b93d'; });
    await drag([[820, 120], [1000, 300]]);
    await ev(() => { Gesso.Tools.select('customShape'); Gesso.Tools.byId.customShape.opts.fill = '#ec7cc4'; });
    await drag([[480, 380], [620, 500]]);
  });

  await step('text layer', async () => {
    await page.keyboard.press('t');
    await ev(() => { Gesso.Tools.byId.text.opts.size = 90; Gesso.Tools.byId.text.opts.color = '#1c1916'; Gesso.Tools.byId.text.opts.weight = 700; });
    await click(120, 480);
    await page.keyboard.type('Gesso!');
    await page.waitForTimeout(150);
    await shot('04-text-editing');
    await page.keyboard.press('Control+Enter');
    const l = await ev(() => { const l = Gesso.app.doc.activeLayer(); return [l.type, l.text.text]; });
    assert(l[0] === 'text' && l[1] === 'Gesso!', l.join());
  });

  await step('layer effects (drop shadow + stroke)', async () => {
    await ev(() => {
      const d = Gesso.app.doc, l = d.activeLayer();
      d.commit('fx', () => { l.effects = { enabled: true, items: { dropShadow: Gesso.Effects.defaults('dropShadow'), stroke: Object.assign(Gesso.Effects.defaults('stroke'), { size: 4 }) } }; l.version++; });
    });
    await page.waitForTimeout(200);
  });

  await step('adjustment layer (hue/sat)', async () => {
    await ev(() => Gesso.Cmd.run('layer.newAdjustment', 'hueSaturation'));
    await page.waitForTimeout(200);
    await ev(() => { const d = Gesso.app.doc, l = d.activeLayer(); d.commit('adj', () => { l.adj.params.hue = 120; l.version++; }); });
    await page.waitForTimeout(200);
    await shot('05-adjustment');
    const t = await ev(() => Gesso.app.doc.activeLayer().type);
    assert(t === 'adjustment', t);
    await ev(() => Gesso.Cmd.run('layer.toggleVisible'));
  });

  await step('marquee selection + fill + filter on selection', async () => {
    await ev(() => { Gesso.app.doc.setActive(Gesso.app.doc.allLayers().find((l) => l.name === 'Layer 1').id); });
    await page.keyboard.press('m');
    await drag([[50, 50], [400, 300]]);
    const b = await ev(() => Gesso.app.doc.selection && Gesso.app.doc.selection.bounds);
    assert(b && b.w >= 340 && b.w <= 360, JSON.stringify(b));
    await ev(() => Gesso.Cmd.run('filter.apply', 'gaussianBlur'));
    await page.waitForTimeout(600);
    await shot('06-filter-dialog');
    await page.click('.dialog .btn.primary');
    await page.waitForTimeout(400);
  });

  await step('magic wand + inverse + deselect', async () => {
    await ev(() => Gesso.app.doc.setActive(Gesso.app.doc.layers[0].id));
    await page.keyboard.press('w');
    await ev(() => Gesso.Tools.select('wand'));
    await click(1000, 1000);
    let has = await ev(() => !!Gesso.app.doc.selection);
    assert(has, 'wand selection');
    await page.keyboard.press('Control+Shift+i');
    await page.keyboard.press('Control+d');
    has = await ev(() => !!Gesso.app.doc.selection);
    assert(!has, 'deselected');
  });

  await step('lasso + polygon lasso', async () => {
    await ev(() => Gesso.Tools.select('lasso'));
    await drag([[700, 450], [800, 420], [850, 520], [720, 560]]);
    await ev(() => Gesso.Tools.select('polyLasso'));
    await click(100, 950, ['Shift']);
    await click(200, 900);
    await click(260, 1000);
    await page.keyboard.press('Enter');
    const b = await ev(() => Gesso.app.doc.selection && Gesso.app.doc.selection.bounds);
    assert(b && b.w > 150, JSON.stringify(b));
    await page.keyboard.press('Control+d');
  });

  await step('free transform raster layer', async () => {
    await ev(() => Gesso.app.doc.setActive(Gesso.app.doc.allLayers().find((l) => l.name === 'Layer 1').id));
    await page.keyboard.press('Control+t');
    await page.waitForTimeout(200);
    const active = await ev(() => !!Gesso.Transform.active);
    assert(active, 'transform started');
    // rotate by dragging outside the box
    await drag([[1050, 60], [1050, 400]]);
    await shot('07-transform');
    await page.keyboard.press('Enter');
    const still = await ev(() => !!Gesso.Transform.active);
    assert(!still, 'transform committed');
  });

  await step('move tool nudge', async () => {
    await page.keyboard.press('v');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    const h = await ev(() => Gesso.app.doc.history.entries.slice(-2).map((e) => e.name).join(','));
    assert(h.includes('Nudge'), h);
  });

  await step('gradient tool on new layer', async () => {
    await page.keyboard.press('Control+Shift+n');
    await ev(() => { Gesso.Tools.select('gradient'); Gesso.Tools.byId.gradient.opts.preset = 4; Gesso.Tools.byId.gradient.opts.opacity = 60; });
    await drag([[0, 1000], [1080, 1000]]);
    await page.waitForTimeout(200);
  });

  await step('layer mask + paint on mask', async () => {
    await ev(() => Gesso.Cmd.run('layer.maskReveal'));
    await ev(() => { Gesso.App.setFg('#000000'); Gesso.Tools.select('brush'); Gesso.Tools.byId.brush.opts.size = 120; });
    await drag([[100, 1000], [900, 1000]]);
    const m = await ev(() => { const l = Gesso.app.doc.activeLayer(); return Array.from(l.mask.canvas.getContext('2d').getImageData(500, 1000, 1, 1).data); });
    assert(m[3] < 30, 'mask painted ' + m);
  });

  await step('eraser + clone + smudge + dodge', async () => {
    await ev(() => Gesso.app.doc.setActive(Gesso.app.doc.allLayers().find((l) => l.name === 'Layer 1').id));
    await page.keyboard.press('e');
    await drag([[300, 150], [400, 160]]);
    await page.keyboard.press('s');
    await click(500, 120, ['Alt']);
    await drag([[200, 400], [260, 420]]);
    await ev(() => Gesso.Tools.select('smudge'));
    await drag([[500, 130], [560, 200]]);
    await ev(() => { Gesso.app.doc.setActive(Gesso.app.doc.layers[0].id); Gesso.Tools.select('dodge'); });
    await drag([[50, 950], [200, 960]]);
    await ev(() => Gesso.Tools.select('spotHeal'));
    await drag([[60, 60], [80, 70]]);
  });

  await step('bucket fill', async () => {
    await ev(() => { Gesso.app.doc.setActive(Gesso.app.doc.layers[0].id); Gesso.Tools.select('bucket'); Gesso.App.setFg('#fff0a8'); });
    await click(1050, 30);
    const p = await pixel(1050, 30, 0);
    assert(p[2] < 200 && p[0] > 240, 'bucket ' + p);
  });

  await step('group layers', async () => {
    await ev(() => { const d = Gesso.app.doc; const shapes = d.allLayers().filter((l) => l.type === 'shape'); d.selectedIds = new Set(shapes.map((s) => s.id)); d.activeId = shapes[0].id; Gesso.Cmd.run('layer.group'); });
    const g = await ev(() => Gesso.app.doc.layers.some((l) => l.type === 'group'));
    assert(g, 'group created');
  });

  await step('image size + canvas size + rotate', async () => {
    await ev(() => { const d = Gesso.app.doc; d.commit('Image Size', () => Gesso.Ops.resizeImage(d, 900, 900, 'bicubic')); });
    await ev(() => { const d = Gesso.app.doc; d.commit('Canvas', () => Gesso.Ops.resizeCanvas(d, 1000, 950, 50, 25)); });
    await ev(() => Gesso.Cmd.run('image.rot90cw'));
    const s = await ev(() => [Gesso.app.doc.width, Gesso.app.doc.height]);
    assert(s[0] === 950 && s[1] === 1000, 'size ' + s);
    await ev(() => Gesso.Cmd.run('image.rot90ccw'));
    await ev(() => Gesso.View.fit());
    await page.waitForTimeout(200);
    await shot('08-composition');
  });

  await step('export PNG (download)', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), ev(() => Gesso.FileIO.quickExport(Gesso.app.doc))]);
    const p = path.join(DL, 'export.png');
    await dl.saveAs(p);
    const sz = fs.statSync(p).size;
    assert(sz > 1000, 'png size ' + sz);
  });

  let projectPath;
  await step('save project (.kgesso)', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), ev(() => Gesso.FileIO.saveProject(Gesso.app.doc, true))]);
    projectPath = path.join(DL, 'test.kgesso');
    await dl.saveAs(projectPath);
    const j = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
    assert(j.format === 'kgesso' && j.layers.length >= 4, 'layers ' + j.layers.length);
  });

  await step('load project', async () => {
    const text = fs.readFileSync(projectPath, 'utf8');
    const before = await ev(() => { const d = Gesso.app.doc; Gesso.Compositor.update(d); return d.composite.toDataURL().length; });
    const res = await ev(async (t) => {
      const d = await Gesso.FileIO.loadProject(JSON.parse(t), 'reloaded');
      await new Promise((r) => setTimeout(r, 300));
      Gesso.Compositor.update(d);
      return { n: Gesso.app.docs.length, layers: d.allLayers().length, types: d.allLayers().map((l) => l.type) };
    }, text);
    assert(res.n === 2 && res.layers >= 6, JSON.stringify(res));
    void before;
    await shot('09-reloaded');
  });

  await step('history panel jump', async () => {
    await ev(() => { const d = Gesso.app.doc; d.history.jumpTo(0); d.history.jumpTo(d.history.entries.length - 1); });
  });

  await step('menus open', async () => {
    for (const m of ['File', 'Edit', 'Image', 'Layer', 'Select', 'Filter', 'View', 'Window', 'Help']) {
      await page.click('.menu-title[data-menu="' + m + '"]');
      await page.waitForTimeout(60);
      if (m === 'Filter') {
        await page.hover('.gesso-menu .item >> text=Blur');
        await page.waitForTimeout(80);
        await shot('10-filter-menu');
      }
      if (m === 'Layer') await shot('11-layer-menu');
      await page.keyboard.press('Escape');
    }
  });

  console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nNO ERRORS');
  await browser.close();
})();
