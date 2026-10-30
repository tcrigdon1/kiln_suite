// Pass 2 hands-on session 3: UI environments — HiDPI (deviceScaleFactor 2) sharpness + hit-testing,
// a 1280×720 window, UI scale 150 %, dragging panels around and resetting the workspace, keyboard-only dialogs.
const { ROOT } = require('../../env.js');
const { chromium } = require('playwright');
const { launch, assert, near, ASSETS } = require('./lib');
const path = require('path');
const fs = require('fs');
const SHOTS = path.join(__dirname, 'shots');

async function session(name, ctxOpts, fn) {
  const browser = await chromium.launch();
  const context = await browser.newContext(Object.assign({ viewport: { width: 1600, height: 900 } }, ctxOpts));
  await context.addInitScript(() => { delete window.showOpenFilePicker; delete window.showSaveFilePicker; });
  const page = await context.newPage();
  const errors = []; page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); }); page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto('file://' + ROOT + '/Gesso/index.html'); await page.waitForTimeout(600);
  const results = [];
  const H = {
    page, errors,
    shot: (n) => page.screenshot({ path: path.join(SHOTS, n + '.png') }),
    ev: (f, a) => page.evaluate(f, a),
    pt: (x, y) => page.evaluate(([x, y]) => { const r = Gesso.View.canvas.getBoundingClientRect(); const s = Gesso.View.toScreen(x, y); return [r.left + s[0], r.top + s[1]]; }, [x, y]),
    async dragDoc(pts, steps = 8) { const sp = []; for (const p of pts) sp.push(await H.pt(p[0], p[1])); await page.mouse.move(sp[0][0], sp[0][1]); await page.mouse.down(); for (let i = 1; i < sp.length; i++) await page.mouse.move(sp[i][0], sp[i][1], { steps }); await page.mouse.up(); await page.waitForTimeout(120); },
    async step(n, f) { try { await f(); results.push(1); console.log('PASS ', n); } catch (e) { results.push(0); console.log('FAIL ', n, '—', e.message.split('\n')[0]); await H.shot('FAIL-' + n.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)); } },
  };
  console.log('== ' + name);
  await fn(H);
  await browser.close();
  const fails = results.filter((r) => !r).length;
  console.log(`${results.length - fails}/${results.length} passed`);
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO ERRORS');
  if (fails || errors.length) process.exitCode = 1;
}

(async () => {
  await session('HiDPI ×2', { deviceScaleFactor: 2 }, async (H) => {
    const { page } = H;
    await H.ev(() => Gesso.App.createDoc({ name: 'HiDPI', w: 800, h: 600, dpi: 72, bg: 'white' }));
    await page.waitForTimeout(300);
    await H.step('view canvas backing store is 2× and a 1-px line renders crisp', async () => {
      const dims = await H.ev(() => [Gesso.View.canvas.width, Gesso.View.w, Gesso.View.dpr]);
      assert(dims[2] === 2 && Math.abs(dims[0] - dims[1] * 2) <= 1, 'canvas ' + dims);
      await page.keyboard.press('Control+1'); // 100 %
      await H.ev(() => Gesso.Tools.select('pencil'));
      await H.ev(() => { Gesso.Tools.byId.pencil.opts.size = 1; Gesso.App.setFg('#000000'); });
      await H.dragDoc([[100.5, 100.5], [300.5, 100.5]]);
      // read the screen pixels through the view canvas: the line must be exactly 2 device pixels tall
      const col = await H.ev(() => { const V = Gesso.View, [sx, sy] = V.toScreen(200, 100); const d = V.ctx.getImageData(Math.round(sx * 2), Math.round((sy - 3) * 2), 1, 12).data; const out = []; for (let i = 0; i < 12; i++) out.push(d[i * 4]); return out; });
      const dark = col.filter((v) => v < 100).length;
      assert(dark >= 1 && dark <= 3, 'line thickness in device px: ' + dark + ' (' + col + ')');
      await H.shot('a3-01-hidpi');
    });
    await H.step('transform handles hit-test correctly at 2×', async () => {
      await H.ev(() => Gesso.Tools.select('brush'));
      await H.ev(() => { const o = Gesso.Tools.byId.brush.opts; o.size = 40; o.hardness = 1; });
      await H.ev(() => Gesso.Cmd.run('layer.new'));
      await H.dragDoc([[200, 200], [500, 400]]);
      await page.keyboard.press('Control+t'); await page.waitForTimeout(150);
      const c = await H.ev(() => Gesso.Transform.active.corners.map((p) => [p.x, p.y]));
      await H.dragDoc([[c[2][0], c[2][1]], [c[2][0] + 100, c[2][1] + 100]], 10);
      const c2 = await H.ev(() => Gesso.Transform.active.corners.map((p) => [p.x, p.y]));
      assert(c2[2][0] > c[2][0] + 80, 'corner handle grabbed and dragged: ' + JSON.stringify([c[2], c2[2]]));
      await page.keyboard.press('Escape');
    });
  });

  await session('1280×720 window', { viewport: { width: 1280, height: 720 } }, async (H) => {
    const { page } = H;
    await H.step('layout fits: options bar not clipped, dock visible, canvas has room', async () => {
      await H.ev(() => Gesso.App.createDoc({ name: 'Small', w: 1920, h: 1080, dpi: 72, bg: 'white' }));
      await page.waitForTimeout(300);
      const m = await H.ev(() => { const ob = document.getElementById('optionsbar'); const dock = document.getElementById('dock').getBoundingClientRect(); return { obScroll: ob.scrollWidth, obW: ob.clientWidth, dockW: dock.width, viewW: Gesso.View.w, viewH: Gesso.View.h, overflow: document.documentElement.scrollWidth > innerWidth }; });
      console.log('     metrics', JSON.stringify(m));
      assert(!m.overflow, 'no horizontal page overflow');
      assert(m.viewW > 500 && m.viewH > 350, 'canvas area ' + m.viewW + 'x' + m.viewH);
      await H.ev(() => Gesso.Tools.select('brush'));
      await page.waitForTimeout(100);
      const ob = await H.ev(() => { const ob = document.getElementById('optionsbar'); return [ob.scrollWidth, ob.clientWidth]; });
      assert(ob[0] <= ob[1] + 1, 'brush options bar fits (' + ob + ')');
      await H.ev(() => Gesso.Tools.select('text'));
      await page.waitForTimeout(100);
      const ob2 = await H.ev(() => { const ob = document.getElementById('optionsbar'); return [ob.scrollWidth, ob.clientWidth]; });
      console.log('     text options bar', ob2);
      await H.shot('a3-02-1280');
    });
  });

  await session('UI scale 150 %', {}, async (H) => {
    const { page } = H;
    await H.step('panels/toolstrip at 150 %: tool buttons and layer rows still hit-test correctly', async () => {
      await H.ev(() => { Gesso.app.prefs.uiScale = 150; Gesso.store.set('prefs', Gesso.app.prefs); Gesso.App.applyPrefs(); });
      await page.waitForTimeout(300);
      await H.ev(() => Gesso.App.createDoc({ name: 'Scaled', w: 800, h: 600, dpi: 72, bg: 'white' }));
      await page.waitForTimeout(300);
      await page.locator('.tool-btn[data-tool="eraser"]').click();
      assert((await H.ev(() => Gesso.app.tool.id)) === 'eraser', 'tool strip click at 150 %');
      await page.locator('.layers-bottom .icon-btn').nth(5).click(); // new layer
      await page.waitForTimeout(150);
      const n = await H.ev(() => Gesso.app.doc.layers.length);
      assert(n === 2, 'new layer via scaled panel button (' + n + ')');
      await page.locator('.layer-row').last().click();
      assert((await H.ev(() => Gesso.app.doc.activeLayer().name)) === 'Background', 'layer row click at 150 %');
      // canvas coordinates are unaffected by the UI zoom
      await H.ev(() => Gesso.Tools.select('brush'));
      await H.ev(() => { Gesso.Cmd.run('layer.new'); const o = Gesso.Tools.byId.brush.opts; o.size = 30; o.hardness = 1; Gesso.App.setFg('#ff0000'); });
      await H.dragDoc([[300, 300], [301, 300]]);
      const p = await H.ev(() => Array.from(Gesso.util.samplePixels(Gesso.Compositor.flatten(Gesso.app.doc), 300, 300)));
      assert(p[0] > 200 && p[1] < 60, 'painted where clicked at 150 % UI scale ' + p);
      await H.shot('a3-03-uiscale150');
      await H.ev(() => { Gesso.app.prefs.uiScale = 100; Gesso.store.set('prefs', Gesso.app.prefs); Gesso.App.applyPrefs(); });
    });
  });

  await session('panels & keyboard dialogs', {}, async (H) => {
    const { page } = H;
    await H.ev(() => Gesso.App.createDoc({ name: 'P', w: 800, h: 600, dpi: 72, bg: 'white' }));
    await page.waitForTimeout(300);
    await H.step('drag the History tab into the Layers group and back; Reset Workspace restores the default', async () => {
      const hist = page.locator('.dock-tabs .tab', { hasText: 'History' }).first();
      const layersTabs = page.locator('.dock-group', { has: page.locator('.tab', { hasText: 'Layers' }) }).locator('.dock-tabs').first();
      await hist.dragTo(layersTabs);
      await page.waitForTimeout(250);
      const inLayersGroup = await H.ev(() => Gesso.Panels.layout.cols.some((c) => c.groups.some((g) => g.panels.includes('history') && g.panels.includes('layers'))));
      assert(inLayersGroup, 'history moved into the layers group');
      await H.shot('a3-04-panel-dragged');
      await page.reload(); await page.waitForTimeout(600);
      const persisted = await H.ev(() => Gesso.Panels.layout.cols.some((c) => c.groups.some((g) => g.panels.includes('history') && g.panels.includes('layers'))));
      assert(persisted, 'layout persisted across reload');
      await page.click('.menu-title[data-menu="Window"]'); await page.waitForTimeout(80);
      await page.locator('.gesso-menu .item', { hasText: 'Reset Workspace' }).click(); await page.waitForTimeout(250);
      const reset = await H.ev(() => Gesso.Panels.layout.cols.some((c) => c.groups.some((g) => g.panels.includes('history') && g.panels.includes('layers'))));
      assert(!reset, 'reset workspace');
      await H.shot('a3-05-panel-reset');
    });
    await H.step('keyboard-only New Document: Tab cycles inside the dialog, Enter creates, Esc cancels', async () => {
      await H.ev(() => Gesso.App.createDoc({ name: 'P2', w: 400, h: 300, dpi: 72, bg: 'white' }));
      await page.waitForTimeout(200);
      await page.keyboard.press('Control+n'); await page.waitForTimeout(250);
      const n0 = await H.ev(() => Gesso.app.docs.length);
      // walk 60 tabs: focus must never leave the dialog
      let outside = 0;
      for (let i = 0; i < 60; i++) { await page.keyboard.press('Tab'); const inside = await H.ev(() => !!document.activeElement.closest('.gesso-dialog')); if (!inside) outside++; }
      assert(outside === 0, 'focus escaped the dialog ' + outside + ' times');
      await page.keyboard.press('Escape'); await page.waitForTimeout(150);
      assert((await H.ev(() => Gesso.app.docs.length)) === n0 && !(await H.ev(() => Gesso.Dialog.isOpen())), 'Esc cancelled');
      await page.keyboard.press('Control+n'); await page.waitForTimeout(250);
      await page.keyboard.type('KeyboardDoc');
      await page.keyboard.press('Tab'); await page.keyboard.press('Control+a'); await page.keyboard.type('640');
      await page.keyboard.press('Enter'); await page.waitForTimeout(300);
      const d = await H.ev(() => ({ n: Gesso.app.docs.length, name: Gesso.app.doc.name, w: Gesso.app.doc.width }));
      assert(d.n === n0 + 1 && d.name === 'KeyboardDoc' && d.w === 640, 'created by keyboard ' + JSON.stringify(d));
      await H.shot('a3-06-keyboard-dialog');
    });
    await H.step('Image Size dialog by keyboard: type width, Enter applies', async () => {
      await page.keyboard.press('Control+Alt+i'); await page.waitForTimeout(250);
      await page.keyboard.press('Control+a'); await page.keyboard.type('320');
      await page.keyboard.press('Enter'); await page.waitForTimeout(300);
      const w = await H.ev(() => [Gesso.app.doc.width, Gesso.app.doc.height]);
      assert(w[0] === 320 && w[1] === 540, 'resized by keyboard (constrained from 640×1080) ' + w);
    });
    await H.step('Preferences ▸ Display color space: switching to Display P3 recreates the view canvas in P3; painting still works; sRGB restores', async () => {
      const before = await H.ev(() => ({ space: Gesso.View._space, attrs: Gesso.View.ctx.getContextAttributes().colorSpace }));
      assert(before.space === 'srgb' && before.attrs === 'srgb', 'starts in sRGB ' + JSON.stringify(before));
      const okBtn = () => page.locator('.gesso-dialog .dialog-foot button', { hasText: 'OK' }).last();
      await page.keyboard.press('Control+k'); await page.waitForTimeout(250);
      const sel = page.locator('.gesso-dialog .field', { hasText: 'Display color space' }).locator('select');
      await sel.selectOption('display-p3'); await page.waitForTimeout(300);
      await okBtn().click(); await page.waitForTimeout(300);
      const after = await H.ev(() => ({ space: Gesso.View._space, attrs: Gesso.View.ctx.getContextAttributes().colorSpace, same: Gesso.View.ctx.canvas === document.getElementById('view'), status: document.getElementById('st-size').textContent }));
      assert(after.space === 'display-p3' && after.attrs === 'display-p3' && after.same, 'view context is now P3 ' + JSON.stringify(after));
      assert(/P3/.test(after.status), 'status bar shows the P3 mode: ' + after.status);
      // the new canvas has working pointer handlers: paint a dab with the brush
      await H.ev(() => { Gesso.Tools.select('brush'); const o = Gesso.Tools.byId.brush.opts; o.size = 30; o.hardness = 1; Gesso.Cmd.run('layer.new'); });
      const [cx, cy] = await H.pt(100, 100); await page.mouse.click(cx, cy); await page.waitForTimeout(150);
      const p = await H.ev(() => { const d = Gesso.app.doc, l = d.activeLayer(); return Array.from(Gesso.Layers.readRect(l.canvas, { x: 100, y: 100, w: 1, h: 1 }).data); });
      assert(p[3] > 200, 'painted on the recreated canvas ' + p);
      // the on-screen pixel is the foreground colour (black) → canvas shows the document
      const scr = await H.ev(() => { const V = Gesso.View, s = V.toScreen(100, 100); return Array.from(V.ctx.getImageData(Math.round(s[0] * V.dpr), Math.round(s[1] * V.dpr), 1, 1).data); });
      assert(scr[0] < 40 && scr[1] < 40 && scr[2] < 40, 'screen pixel is dark ' + scr);
      const later = await H.ev(() => ({ pref: Gesso.app.prefs.displaySpace, stored: Gesso.store.get('prefs').displaySpace, status: document.getElementById('st-size').textContent }));
      assert(later.pref === 'display-p3' && later.stored === 'display-p3' && /P3/.test(later.status), 'the preference survives OK and later status refreshes ' + JSON.stringify(later));
      await H.shot('a3-07-display-p3');
      await page.keyboard.press('Control+k'); await page.waitForTimeout(250);
      await page.locator('.gesso-dialog .field', { hasText: 'Display color space' }).locator('select').selectOption('srgb'); await page.waitForTimeout(200);
      await okBtn().click(); await page.waitForTimeout(300);
      assert((await H.ev(() => Gesso.View.ctx.getContextAttributes().colorSpace)) === 'srgb', 'back to sRGB');
    });
  });
})();
