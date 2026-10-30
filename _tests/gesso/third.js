// Third batch: compositing semantics, layer ops, misc tools, guides, transforms on text/shape, autosave.
const { ROOT } = require('../env.js');
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const OUT = path.join(__dirname, 'shots');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('framenavigated', (f) => console.log('NAV', f.url()));
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
  const assert = (c, m) => { if (!c) throw new Error('assert: ' + m); };
  const px = (x, y) => ev(([x, y]) => { const d = Gesso.app.doc; d.invalidate(); Gesso.Compositor.update(d); return Array.from(d.composite.getContext('2d').getImageData(x, y, 1, 1).data); }, [x, y]);

  await ev(() => Gesso.App.createDoc({ name: 'T3', w: 800, h: 600, dpi: 72, bg: 'white' }));

  await step('clipping mask: color fill clipped to shape', async () => {
    await ev(() => {
      const d = Gesso.app.doc;
      Gesso.addLayer(Gesso.Layers.shape(d, { kind: 'ellipse', x: 100, y: 100, w: 200, h: 200, fill: { enabled: true, color: '#000000' } }), 'shape');
      const f = Gesso.Layers.fill(d, { kind: 'solid', color: '#ff0000' }); Gesso.addLayer(f, 'fill');
      d.commit('clip', () => { d.findLayer(f.id).clip = true; });
    });
    const inside = await px(200, 200), outside = await px(50, 50);
    assert(inside[0] > 240 && inside[1] < 20, 'inside red ' + inside);
    assert(outside[0] > 240 && outside[1] > 240, 'outside white ' + outside);
  });

  await step('group opacity + blend', async () => {
    await ev(() => { const d = Gesso.app.doc; const sel = d.allLayers().filter((l) => l.type !== 'raster'); d.selectedIds = new Set(sel.map((l) => l.id)); d.activeId = sel[0].id; Gesso.Cmd.run('layer.group'); const g = d.activeLayer(); d.commit('op', () => { g.opacity = 0.5; g.blend = 'normal'; }); });
    const p = await px(200, 200);
    assert(p[0] > 240 && p[1] > 100 && p[1] < 150, 'half red ' + p);
  });

  await step('dissolve blend mode', async () => {
    await ev(() => { const d = Gesso.app.doc; const g = d.activeLayer(); d.commit('b', () => { g.blend = 'dissolve'; }); });
    await shot('26-dissolve');
    await ev(() => { const d = Gesso.app.doc; const g = d.activeLayer(); d.commit('b', () => { g.blend = 'pass-through'; g.opacity = 1; }); });
  });

  await step('merge visible + flatten + undo', async () => {
    await ev(() => Gesso.Cmd.run('layer.mergeVisible'));
    let n = await ev(() => Gesso.app.doc.allLayers().length);
    assert(n === 1, 'merged ' + n);
    const p = await px(200, 200);
    assert(p[0] > 240 && p[1] < 20, 'merged keeps look ' + p);
    await page.keyboard.press('Control+z');
    n = await ev(() => Gesso.app.doc.allLayers().length);
    assert(n > 2, 'undo merge ' + n);
  });

  await step('text paragraph + double-click re-edit + transform (matrix)', async () => {
    await page.keyboard.press('t');
    await drag([[420, 80], [760, 260]]);
    await page.keyboard.type('Paragraph text wraps inside its box nicely');
    await page.keyboard.press('Escape');
    const box = await ev(() => { const l = Gesso.app.doc.activeLayer(); return l.type + ':' + !!l.text.box + ':' + Gesso.Text.layout(l.text).lines.length; });
    assert(box.startsWith('text:true') && +box.split(':')[2] >= 2, box);
    // rotate via transform
    await page.keyboard.press('Control+t');
    await ev(() => Gesso.Transform.rot90());
    await page.keyboard.press('Enter');
    const m = await ev(() => Gesso.app.doc.activeLayer().text.matrix);
    assert(m && Math.abs(m[1] - 1) < 1e-6, 'matrix ' + m);
    await ev(() => Gesso.Cmd.run('edit.undo'));
    // double click re-edit
    const [x, y] = await toPage(500, 110);
    await page.keyboard.press('t');
    await page.mouse.dblclick(x, y);
    await page.waitForTimeout(100);
    const editing = await ev(() => !!Gesso.TextTool.edit);
    assert(editing, 'reedit');
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await page.keyboard.press('Control+Enter');
    const t = await ev(() => Gesso.app.doc.activeLayer().text.text);
    assert(t.includes('!'), t);
  });

  await step('shape transform (perspective distort)', async () => {
    await ev(() => { const d = Gesso.app.doc; Gesso.addLayer(Gesso.Layers.shape(d, { kind: 'rect', x: 450, y: 350, w: 200, h: 150, fill: { enabled: true, color: '#3dbfae' } }), 's'); });
    await ev(() => Gesso.Transform.begin());
    // ctrl-drag top-right corner
    await drag([[650, 350], [700, 300]], { mods: ['Control'] });
    await page.keyboard.press('Enter');
    const k = await ev(() => Gesso.app.doc.activeLayer().shape.kind);
    assert(k === 'path', k);
    await shot('27-distort');
  });

  await step('raster perspective distort', async () => {
    await ev(() => { const d = Gesso.app.doc; d.setActive(d.layers[0].id); });
    await page.keyboard.press('Control+t');
    await drag([[0, 0], [100, 80]], { mods: ['Control'] });
    await page.keyboard.press('Enter');
    const p = await px(5, 5);
    assert(p[3] < 10, 'corner now transparent ' + p);
    await page.keyboard.press('Control+z');
  });

  await step('ctrl+click thumbnail loads selection', async () => {
    await ev(() => { const d = Gesso.app.doc; d.setActive(d.allLayers().find((l) => l.type === 'shape' && l.shape.kind === 'path').id); });
    await page.click('.layer-row.active .lthumb', { modifiers: ['Control'] });
    const b = await ev(() => Gesso.app.doc.selection && Gesso.app.doc.selection.bounds);
    assert(b && b.w > 180, JSON.stringify(b));
    await ev(() => Gesso.Cmd.run('select.border') );
    await page.waitForTimeout(120);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+d');
  });

  await step('guides from ruler + snapping', async () => {
    const r = await page.$('#ruler-v');
    const b = await r.boundingBox();
    const [tx, ty] = await toPage(300, 300);
    await page.mouse.move(b.x + 10, ty); await page.mouse.down(); await page.mouse.move(tx, ty, { steps: 6 }); await page.mouse.up();
    const g = await ev(() => Gesso.app.doc.guides);
    assert(g.length === 1 && g[0].dir === 'v' && Math.abs(g[0].pos - 300) <= 2, JSON.stringify(g));
    const s = await ev(() => Gesso.View.snapPoint(302, 10));
    assert(Math.abs(s[0] - g[0].pos) < 0.01, 'snap ' + s);
  });

  await step('layer drag reorder in panel', async () => {
    const before = await ev(() => Gesso.app.doc.layers.map((l) => l.name).join('|'));
    const rows = page.locator('.layer-list > .layer-row');
    const cnt = await rows.count();
    await rows.nth(cnt - 1).dragTo(rows.nth(0), { targetPosition: { x: 60, y: 4 } });
    await page.waitForTimeout(150);
    const after = await ev(() => Gesso.app.doc.layers.map((l) => l.name).join('|'));
    assert(before !== after, 'order changed: ' + after);
  });

  await step('pencil / blur / sharpen / burn / sponge / heal / mixer', async () => {
    await ev(() => { Gesso.Cmd.run('layer.new'); const d = Gesso.app.doc; });
    for (const id of ['pencil', 'brush']) { await ev((i) => Gesso.Tools.select(i), id); await drag([[50, 400], [300, 450]]); }
    await ev(() => { const d = Gesso.app.doc; d.setActive(d.layers.find((l) => l.type === 'raster').id); });
    for (const id of ['blur', 'sharpen', 'burn', 'sponge', 'smudge']) { await ev((i) => Gesso.Tools.select(i), id); await drag([[60, 410], [250, 440]]); }
    await ev(() => Gesso.Tools.select('heal'));
    await drag([[500, 550]], { mods: ['Alt'] });
    await drag([[100, 420], [150, 430]]);
  });

  await step('canvas ops: arbitrary rotate, flip, trim', async () => {
    await ev(() => { const d = Gesso.app.doc; d.commit('rot', () => Gesso.Ops.rotateCanvas(d, 30)); });
    const s = await ev(() => [Gesso.app.doc.width, Gesso.app.doc.height]);
    assert(s[0] > 900, 'rot size ' + s);
    await ev(() => Gesso.Cmd.run('image.flipH'));
    await ev(() => { Gesso.Cmd.run('edit.undo'); Gesso.Cmd.run('edit.undo'); });
    const s2 = await ev(() => [Gesso.app.doc.width, Gesso.app.doc.height]);
    assert(s2[0] === 800, 'undo rot ' + s2);
  });

  await step('repeat last filter', async () => {
    await ev(() => { const d = Gesso.app.doc; d.setActive(d.layers.find((l) => l.type === 'raster').id); Gesso.Cmd.run('filter.apply', 'pixelate'); });
    await page.waitForTimeout(300);
    await page.click('.dialog .btn.primary');
    const n1 = await ev(() => Gesso.app.doc.history.entries.length);
    await page.keyboard.press('Control+Alt+f');
    const n2 = await ev(() => Gesso.app.doc.history.entries.length);
    assert(n2 === n1 + 1, 'repeat ' + n1 + '→' + n2);
  });

  await step('all filters run without error', async () => {
    const res = await ev(() => {
      const fails = [];
      const img = new ImageData(64, 48);
      for (let i = 0; i < img.data.length; i++) img.data[i] = (i * 37) % 256;
      for (const id in ImageFX.filters) { try { ImageFX.filters[id].apply(new ImageData(new Uint8ClampedArray(img.data), 64, 48), ImageFX.defaults(ImageFX.filters[id]), {}); } catch (e) { fails.push(id + ':' + e.message); } }
      for (const id in ImageFX.adjustments) { try { ImageFX.adjustments[id].apply(new ImageData(new Uint8ClampedArray(img.data), 64, 48), ImageFX.defaults(ImageFX.adjustments[id]), {}); } catch (e) { fails.push(id + ':' + e.message); } }
      return fails;
    });
    assert(!res.length, res.join(', '));
  });

  await step('all filter dialogs open with params UI', async () => {
    const ids = await ev(() => Object.keys(ImageFX.filters).filter((id) => ImageFX.filters[id].params.length));
    for (const id of ids) {
      await ev((i) => Gesso.Cmd.run('filter.apply', i), id);
      await page.waitForTimeout(120);
      const open = await ev(() => Gesso.Dialog.isOpen());
      if (!open) throw new Error('no dialog for ' + id);
      await page.keyboard.press('Escape');
    }
  });

  await step('channels + mask view', async () => {
    await ev(() => Gesso.Cmd.run('view.channel', 'r'));
    await ev(() => Gesso.Cmd.run('view.channel', 'rgb'));
  });

  await step('autosave writes recovery record', async () => {
    await ev(() => Gesso.FileIO.autosave());
    await page.waitForTimeout(500);
    const n = await ev(async () => (await Gesso.FileIO.idb('recovery', 'readonly', (st) => st.getAllKeys())).length);
    assert(n >= 1, 'recovery ' + n);
  });

  await step('recovery dialog on reload', async () => {
    await page.reload();
    await page.waitForTimeout(1200);
    const open = await ev(() => Gesso.Dialog.isOpen() && document.querySelector('.dialog-head').textContent);
    assert(open && open.includes('Recover'), 'dialog ' + open);
    await shot('28-recovery');
    await page.click('.dialog .btn.primary');
    await page.waitForTimeout(800);
    const n = await ev(() => Gesso.app.docs.length);
    assert(n === 1, 'recovered docs ' + n);
  });

  console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nNO ERRORS');
  await browser.close();
})();
