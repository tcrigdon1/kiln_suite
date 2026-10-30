// Pass 2 hands-on session 2: size extremes (8×8 and 6000×4000 documents), 1-px and 2000-px brushes,
// opacity-0 layers, nested groups 4 deep with masks + clipping, memory growth over 200 undoable actions.
const { launch, assert, near } = require('./lib');

(async () => {
  const H = await launch();
  const { page } = H;
  const cdp = await H.context.newCDPSession(page); await cdp.send('Performance.enable');
  const heap = async () => { const m = (await cdp.send('Performance.getMetrics')).metrics; return Math.round(m.find((x) => x.name === 'JSHeapUsedSize').value / 1048576); };
  const canvasMB = () => H.ev(() => { let b = 0; const seen = new Set(); const v = (c) => { if (c && !seen.has(c)) { seen.add(c); b += c.width * c.height * 4; } };
    for (const d of Gesso.app.docs) { d.walk((l) => { v(l.canvas); if (l.mask) v(l.mask.canvas); if (l._fxCache) v(l._fxCache.canvas); }); v(d.composite); for (const e of d.history.entries) if (e.before) { /* state entries share canvases */ } }
    return Math.round(b / 1048576); });

  await H.step('8×8 document: fit zooms to the max, 1-px pencil paints exactly one pixel, export works', async () => {
    await H.key('Control+n');
    await page.locator('.gesso-dialog input[type=number]').nth(0).fill('8');
    await page.locator('.gesso-dialog input[type=number]').nth(1).fill('8');
    await H.dialogBtn('Create');
    await H.wait(300);
    const st = await H.state();
    assert(st.w === 8 && st.h === 8, 'size');
    assert(st.zoom >= 32, 'zoomed in to ' + st.zoom);
    await H.tool('pencil');
    await H.ev(() => { Gesso.Tools.byId.pencil.opts.size = 1; Gesso.App.setFg('#ff0000'); });
    await H.clickDoc(3.5, 3.5);
    const p = await H.px(3, 3), q = await H.px(4, 3), r = await H.px(3, 4);
    assert(p[0] > 200 && p[1] < 60, 'pixel (3,3) red ' + p);
    assert(q[0] > 200 && q[1] > 200 && r[1] > 200, 'neighbours untouched ' + q + ' / ' + r);
    await H.shot('a2-01-tiny-doc');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+Alt+Shift+s')]);
    assert((await dl.suggestedFilename()).endsWith('.png'), 'exported ' + (await dl.suggestedFilename()));
    await H.key('Control+w'); await H.wait(200);
    if (await H.dialogOpen()) await page.locator('.gesso-dialog .dialog-foot button', { hasText: 'Don’t Save' }).click();
  });

  await H.step('6000×4000 document: 2000-px soft brush stroke, filter preview, export estimate, no errors', async () => {
    const m0 = await heap();
    await H.key('Control+n');
    await page.locator('.gesso-dialog input[type=number]').nth(0).fill('6000');
    await page.locator('.gesso-dialog input[type=number]').nth(1).fill('4000');
    await page.locator('.gesso-dialog select').nth(1).selectOption('transparent');
    await H.dialogBtn('Create');
    await H.wait(500);
    assert((await H.state()).w === 6000, 'created');
    await H.key('b');
    await H.ev(() => { const o = Gesso.Tools.byId.brush.opts; o.size = 2000; o.hardness = 0; o.opacity = 100; Gesso.App.setFg('#3366cc'); });
    const t0 = Date.now();
    await H.dragDoc([[1500, 2000], [4500, 2000]], { steps: 8 });
    const dt = Date.now() - t0;
    console.log('     2000px stroke on 6000×4000 took', dt, 'ms');
    const p = await H.px(3000, 2000); assert(p[3] > 200, 'painted ' + p);
    const li = await H.ev(() => { const c = Gesso.app.doc.activeLayer().canvas; return [c.width, c.height, c.ox, c.oy]; });
    console.log('     layer canvas after big stroke', li, 'canvas MB', await canvasMB());
    await H.shot('a2-02-big-doc-stroke');
    // filter dialog with preview on a huge visible area (fast preview path)
    await H.menu('Filter', 'Blur', 'Gaussian Blur…');
    await H.wait(900);
    assert(await H.dialogOpen(), 'filter dialog');
    const info = await page.locator('.fx-info').textContent();
    console.log('     preview info:', info);
    await H.dialogBtn('OK');
    await H.wait(1500);
    assert(!(await H.dialogOpen()), 'applied');
    await H.key('Control+z');
    await H.wait(300);
    const m1 = await heap();
    console.log('     JS heap', m0, '→', m1, 'MB');
    await H.key('Control+w'); await H.wait(200);
    if (await H.dialogOpen()) await page.locator('.gesso-dialog .dialog-foot button', { hasText: 'Don’t Save' }).click();
    await H.wait(200);
  });

  await H.step('opacity-0 layer: hidden in the composite, eyedropper samples through it, move still works', async () => {
    await H.ev(() => Gesso.App.createDoc({ name: 'Op', w: 500, h: 400, dpi: 72, bg: 'white' }));
    await H.wait(200);
    await H.key('Control+Shift+n');
    await H.key('b');
    await H.ev(() => { const o = Gesso.Tools.byId.brush.opts; o.size = 40; o.hardness = 1; o.opacity = 100; Gesso.App.setFg('#00aa00'); });
    await H.dragDoc([[100, 200], [400, 200]]);
    const op = page.locator('.layers-top input[type=number]').first();
    await op.fill('0'); await op.press('Enter');
    await H.wait(150);
    const p = await H.px(250, 200);
    assert(p[0] > 240 && p[1] > 240 && p[2] > 240, 'composite shows white ' + p);
    await H.key('i');
    await H.clickDoc(250, 200);
    const fg = await H.ev(() => Gesso.app.fg);
    assert(fg === '#ffffff', 'eyedropper got white ' + fg);
    await H.key('v');
    await H.dragDoc([[250, 200], [250, 300]]);
    const b = await H.ev(() => Gesso.Layers.contentRect(Gesso.app.doc.activeLayer()));
    assert(b && b.y > 250, 'moved an invisible layer ' + JSON.stringify(b));
    await op.fill('100'); await op.press('Enter');
    await H.wait(100);
    const p2 = await H.px(250, 300); assert(p2[1] > 150 && p2[0] < 80, 'visible again ' + p2);
    await H.shot('a2-03-opacity0');
  });

  await H.step('nested groups 4 deep with masks and clipping render, move and transform as a whole', async () => {
    await H.ev(() => {
      const d = Gesso.app.doc;
      d.commit('build', () => {
        const mk = (name, color, x, y) => { const c = Gesso.util.createCanvas(120, 120, x, y); const g = c.getContext('2d'); g.fillStyle = color; g.beginPath(); g.arc(60, 60, 58, 0, 7); g.fill(); return Gesso.Layers.raster(d, name, c); };
        const g1 = Gesso.Layers.group(d, 'G1'), g2 = Gesso.Layers.group(d, 'G2'), g3 = Gesso.Layers.group(d, 'G3'), g4 = Gesso.Layers.group(d, 'G4');
        const base = mk('base', '#cc3333', 100, 60), clipA = mk('clipA', '#ffee00', 150, 100); clipA.clip = true;
        g4.children.push(base, clipA);
        g4.mask = Gesso.Layers.newMask(d, 255); Gesso.Layers.writeRect(g4.mask.canvas, new ImageData(500, 100), { x: 0, y: 0, w: 500, h: 100 }, 255); // hide the top strip (sparse mask: write a transparent patch)
        g3.children.push(g4, mk('sib', '#3344cc', 300, 150)); g3.blend = 'multiply'; g3.opacity = 0.9;
        g2.children.push(g3); g2.mask = Gesso.Layers.newMask(d, 255);
        g1.children.push(g2);
        d.layers.push(g1); d.activeId = g1.id; d.selectedIds = new Set([g1.id]);
      });
    });
    await H.wait(200);
    let p = await H.px(170, 120); assert(p[0] > 150 && p[1] > 150 && p[2] < 80, 'clipped yellow over red ' + p);
    p = await H.px(160, 80); assert(p[0] > 240 && p[1] > 240, 'top strip masked out by G4 mask ' + p);
    await H.shot('a2-04-nested-before');
    await H.key('v');
    await page.locator('.layer-row', { hasText: 'G1' }).first().click();
    await H.dragDoc([[170, 120], [270, 220]], { steps: 10 });
    p = await H.px(270, 220); assert(p[0] > 150 && p[1] > 150 && p[2] < 80, 'group moved together ' + p);
    await H.key('Control+t'); await H.wait(150);
    const c = await H.ev(() => Gesso.Transform.active && Gesso.Transform.active.corners.map((q) => [q.x, q.y]));
    assert(c, 'multi transform on nested group');
    await H.dragDoc([[c[2][0], c[2][1]], [c[2][0] - 60, c[2][1] - 60]]);
    await H.key('Enter'); await H.wait(200);
    const st = await H.state();
    assert(st.histName === 'Free Transform', 'committed');
    await H.key('Control+z'); await H.key('Control+z');
    p = await H.px(170, 120); assert(p[0] > 150 && p[1] > 150 && p[2] < 80, 'undo restores nested group ' + p);
    await H.shot('a2-05-nested-after');
  });

  await H.step('memory: 200 undoable actions (strokes, moves, fills) do not grow memory without bound', async () => {
    await H.ev(() => Gesso.App.createDoc({ name: 'Mem', w: 1200, h: 800, dpi: 72, bg: 'white' }));
    await H.wait(200);
    await H.key('b');
    await H.ev(() => { const o = Gesso.Tools.byId.brush.opts; o.size = 30; o.hardness = 0.5; o.opacity = 100; Gesso.App.setFg('#884422'); });
    const m0 = await heap(), c0 = await canvasMB();
    for (let i = 0; i < 200; i++) {
      const x = 50 + (i * 37) % 1100, y = 50 + (i * 53) % 700;
      if (i % 10 === 9) { await H.key('v'); await H.dragDoc([[600, 400], [610, 405]], { steps: 2, after: 10 }); await H.key('b'); }
      else await H.dragDoc([[x, y], [x + 60, y + 30]], { steps: 2, after: 10 });
    }
    await H.wait(500);
    const m1 = await heap(), c1 = await canvasMB();
    const hist = await H.ev(() => { const h = Gesso.app.doc.history; return { n: h.entries.length, bytesMB: Math.round(h.entries.reduce((a, e) => a + (e.bytes || 0), 0) / 1048576), pool: Gesso.util._poolSize ? Gesso.util._poolSize() : null }; });
    console.log('     heap', m0, '→', m1, 'MB; layer canvases', c0, '→', c1, 'MB; history', JSON.stringify(hist));
    assert(hist.n <= 61, 'history capped at 60 steps (' + hist.n + ')');
    assert(m1 - m0 < 600, 'heap growth ' + (m1 - m0) + ' MB');
    assert(c1 - c0 < 64, 'layer canvas growth ' + (c1 - c0) + ' MB');
    await H.shot('a2-06-memory');
  });

  await H.finish();
})();
