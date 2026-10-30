// Fourth batch: input niceties (keys, wheel, space-pan, alt-right-drag), paste & drop events.
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

  await step('paste image via clipboard event → new document', async () => {
    const n = await ev(async () => {
      const c = document.createElement('canvas'); c.width = 300; c.height = 200; const x = c.getContext('2d'); x.fillStyle = '#5b9bf0'; x.fillRect(0, 0, 300, 200);
      const blob = await new Promise((r) => c.toBlob(r));
      const dt = new DataTransfer(); dt.items.add(new File([blob], 'clip.png', { type: 'image/png' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      return [Gesso.app.docs.length, Gesso.app.doc && Gesso.app.doc.width];
    });
    assert(n[0] === 1 && n[1] === 300, JSON.stringify(n));
  });

  await step('paste again → new layer in current doc', async () => {
    const n = await ev(async () => {
      const c = document.createElement('canvas'); c.width = 120; c.height = 80; c.getContext('2d').fillRect(0, 0, 120, 80);
      const blob = await new Promise((r) => c.toBlob(r));
      const dt = new DataTransfer(); dt.items.add(new File([blob], 'clip.png', { type: 'image/png' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      return Gesso.app.doc.allLayers().length;
    });
    assert(n === 2, 'layers ' + n);
  });

  await step('drop file → opens document', async () => {
    const n = await ev(async () => {
      const c = document.createElement('canvas'); c.width = 222; c.height = 111; c.getContext('2d').fillRect(0, 0, 50, 50);
      const blob = await new Promise((r) => c.toBlob(r));
      const dt = new DataTransfer(); dt.items.add(new File([blob], 'dropped.png', { type: 'image/png' }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 400));
      return [Gesso.app.docs.length, Gesso.app.doc.name, Gesso.app.doc.width];
    });
    assert(n[0] === 2 && n[1] === 'dropped' && n[2] === 222, JSON.stringify(n));
  });

  await step('ctrl+wheel zoom, wheel pan, space-drag pan', async () => {
    await ev(() => Gesso.App.createDoc({ name: 'K', w: 800, h: 600, dpi: 72, bg: 'white' }));
    const z0 = await ev(() => Gesso.app.doc.view.zoom);
    const [cx, cy] = await toPage(400, 300);
    await page.mouse.move(cx, cy);
    await page.keyboard.down('Control'); await page.mouse.wheel(0, -300); await page.keyboard.up('Control');
    await page.waitForTimeout(100);
    const z1 = await ev(() => Gesso.app.doc.view.zoom);
    assert(z1 > z0, 'zoom ' + z0 + '→' + z1);
    const p0 = await ev(() => Gesso.app.doc.view.panY);
    await page.mouse.wheel(0, 120); await page.waitForTimeout(100);
    const p1 = await ev(() => Gesso.app.doc.view.panY);
    assert(p1 < p0, 'pan ' + p0 + '→' + p1);
    await page.keyboard.down('Space');
    await page.mouse.down(); await page.mouse.move(cx + 100, cy + 50, { steps: 4 }); await page.mouse.up();
    await page.keyboard.up('Space');
    const px = await ev(() => Gesso.app.doc.view.panX);
    assert(Math.abs(px) > 1, 'space pan');
  });

  await step('[ ] size, shift+[ hardness, number keys opacity', async () => {
    await page.keyboard.press('b');
    const s0 = await ev(() => Gesso.Tools.byId.brush.opts.size);
    await page.keyboard.press(']'); await page.keyboard.press(']');
    const s1 = await ev(() => Gesso.Tools.byId.brush.opts.size);
    assert(s1 > s0, 'size ' + s0 + '→' + s1);
    await page.keyboard.press('Shift+BracketLeft');
    await page.keyboard.press('5');
    const o = await ev(() => Gesso.Tools.byId.brush.opts.opacity);
    assert(o === 50, 'opacity ' + o);
    await page.keyboard.press('0');
  });

  await step('alt + right-drag resizes brush', async () => {
    const s0 = await ev(() => Gesso.Tools.byId.brush.opts.size);
    const [cx, cy] = await toPage(400, 300);
    await page.mouse.move(cx, cy);
    await page.keyboard.down('Alt');
    await page.mouse.down({ button: 'right' }); await page.mouse.move(cx + 80, cy, { steps: 5 }); await page.mouse.up({ button: 'right' });
    await page.keyboard.up('Alt');
    const s1 = await ev(() => Gesso.Tools.byId.brush.opts.size);
    assert(s1 > s0, 'alt-right ' + s0 + '→' + s1);
    await page.screenshot({ path: OUT + '/32-brushcursor.png' });
  });

  await step('shift-click draws straight line', async () => {
    await ev(() => { Gesso.View.fit(); Gesso.Cmd.run('layer.new'); Gesso.Tools.byId.brush.opts.size = 10; Gesso.Tools.byId.brush.opts.opacity = 100; Gesso.Tools.byId.brush.opts.smoothing = 0; Gesso.App.setFg('#000000'); });
    const [ax, ay] = await toPage(100, 100), [bx, by] = await toPage(500, 100);
    await page.mouse.click(ax, ay);
    await page.keyboard.down('Shift'); await page.mouse.click(bx, by); await page.keyboard.up('Shift');
    const p = await ev(() => { const d = Gesso.app.doc; return Gesso.Layers.readRect(d.activeLayer().canvas, { x: 300, y: 100, w: 1, h: 1 }).data[3]; });
    assert(p > 200, 'line alpha ' + p);
  });

  await step('tool letter keys + shift cycle', async () => {
    await page.keyboard.press('m'); let t = await ev(() => Gesso.app.tool.id); assert(t.startsWith('marquee'), t);
    await page.keyboard.press('Shift+m'); const t2 = await ev(() => Gesso.app.tool.id); assert(t2 !== t && t2.startsWith('marquee'), t2);
    await page.keyboard.press('u'); t = await ev(() => Gesso.app.tool.id); assert(['rect', 'roundRect', 'ellipse', 'polygon', 'star', 'line', 'customShape'].includes(t), t);
    await page.keyboard.press('x'); const fg = await ev(() => Gesso.app.fg); assert(fg === '#ffffff', fg);
    await page.keyboard.press('d'); const fg2 = await ev(() => Gesso.app.fg); assert(fg2 === '#000000', fg2);
  });

  await step('custom shortcut recording', async () => {
    await page.keyboard.press('F1');
    await page.waitForTimeout(150);
    await page.fill('.sc-search', 'Flatten Image');
    await page.click('.sc-key');
    console.log('    rec state:', await page.textContent('.sc-key'));
    await page.keyboard.press('Control+Alt+Shift+F');
    const k = await ev(() => Gesso.Cmd.keyOf('layer.flatten'));
    assert(k === 'Ctrl+Alt+Shift+F', k);
    await page.keyboard.press('Escape');
    await ev(() => Gesso.Cmd.setKey('layer.flatten', ''));
  });

  await step('preferences UI scale applies', async () => {
    await ev(() => { Gesso.app.prefs.uiScale = 125; Gesso.App.applyPrefs(); });
    await page.waitForTimeout(200);
    await page.screenshot({ path: OUT + '/33-uiscale.png' });
    await ev(() => { Gesso.app.prefs.uiScale = 100; Gesso.App.applyPrefs(); });
  });

  await step('close docs (with confirm)', async () => {
    await ev(() => { Gesso.App.closeDoc(Gesso.app.doc); });
    await page.waitForTimeout(150);
    const open = await ev(() => Gesso.Dialog.isOpen());
    if (open) await page.click('.dialog .btn.danger');
    await page.waitForTimeout(100);
  });

  console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nNO ERRORS');
  await browser.close();
})();
