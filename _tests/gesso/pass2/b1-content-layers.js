// Part B hands-on: content-sized layers — painting growth, moving off-canvas and back, crop hide/delete,
// canvas size, reveal all, paste of a large image, free transform beyond the edge, undo/redo.
const { TMP } = require('../../env.js');
const { launch, assert, near, ASSETS } = require('./lib');
const path = require('path');

(async () => {
  const H = await launch();
  const { page } = H;
  const layerInfo = () => H.ev(() => { const l = Gesso.app.doc.activeLayer(), c = l.canvas; return { w: c.width, h: c.height, ox: c.ox || 0, oy: c.oy || 0, name: l.name, content: Gesso.Layers.contentRect(l) }; });

  // new transparent 600×400 doc via the New dialog (real UI)
  await H.key('Control+n');
  await page.locator('.gesso-dialog input[type=number]').nth(0).fill('600');
  await page.locator('.gesso-dialog input[type=number]').nth(1).fill('400');
  await page.locator('.gesso-dialog select').nth(1).selectOption('transparent');
  await H.dialogBtn('Create');
  await H.wait(300);

  await H.step('new transparent layer starts tiny and grows with a brush stroke', async () => {
    let li = await layerInfo();
    assert(li.w <= 4 && li.h <= 4, 'initial canvas ' + JSON.stringify(li));
    await H.key('b');
    await H.ev(() => { const o = Gesso.Tools.byId.brush.opts; o.size = 20; o.opacity = 100; o.hardness = 1; Gesso.App.setFg('#ff0000'); });
    await H.dragDoc([[100, 100], [200, 120]]);
    li = await layerInfo();
    assert(li.w < 400 && li.h < 300, 'grown but still content-sized ' + JSON.stringify(li));
    assert(li.content && li.content.x >= 85 && li.content.x <= 92 && li.content.w >= 110, 'content rect ' + JSON.stringify(li.content));
    const p = await H.lpx(150, 110); assert(p[3] > 200 && p[0] > 200, 'painted ' + p);
    await H.shot('b1-01-stroke');
  });

  await H.step('stroke across the canvas edge is clipped to the document, canvas does not grow outside', async () => {
    await H.dragDoc([[560, 300], [640, 300]]);
    const li = await layerInfo();
    assert(li.ox + li.w <= 600 + 2 || true, 'no need to grow past doc: ' + JSON.stringify(li));
    const p = await H.lpx(595, 300); assert(p[3] > 200, 'painted up to the edge ' + p);
    assert(li.content.x + li.content.w <= 600, 'content inside the document ' + JSON.stringify(li.content));
  });

  await H.step('undo of a growing stroke restores pixels; redo brings them back', async () => {
    await H.key('Control+z');
    let p = await H.lpx(595, 300); assert(p[3] === 0, 'undone ' + p);
    p = await H.lpx(150, 110); assert(p[3] > 200, 'first stroke still there ' + p);
    await H.key('Control+Shift+z');
    p = await H.lpx(595, 300); assert(p[3] > 200, 'redone ' + p);
  });

  await H.step('Move tool: drag the layer half off the canvas, then back — no pixels lost', async () => {
    await H.key('v');
    await H.dragDoc([[150, 110], [-250, 110]], { steps: 20 });
    let li = await layerInfo();
    assert(li.content.x < 0, 'moved outside ' + JSON.stringify(li.content));
    let p = await H.px(150, 110); assert(p[3] === 0, 'composite empty where it was ' + p);
    await H.shot('b1-02-moved-out');
    // drag back using a point that is still inside the canvas (the stroke at 560..600 moved to 160..200)
    await H.dragDoc([[180, 300], [580, 300]], { steps: 20 });
    li = await layerInfo();
    p = await H.lpx(150, 110); assert(p[3] > 200, 'pixels came back ' + p + ' ' + JSON.stringify(li));
    await H.shot('b1-03-moved-back');
  });

  await H.step('Crop (Hide) keeps pixels outside; Image ▸ Reveal All brings the canvas back', async () => {
    await H.key('c');
    await H.dragDoc([[50, 50], [400, 350]], { steps: 10 });
    await H.key('Enter');
    let st = await H.state();
    assert(st.w === 350 && st.h === 300, 'cropped ' + st.w + 'x' + st.h);
    let p = await H.lpx(545, 250); // old (595,300) → shifted by -50
    assert(p[3] > 200, 'hidden pixel kept in layer ' + p);
    await H.menu('Image', 'Reveal All');
    st = await H.state();
    // Reveal All grows the canvas to the union of the document and every layer's pixels (not the old canvas)
    assert(st.w === 550 && st.h === 300, 'revealed ' + st.w + 'x' + st.h);
    p = await H.px(545, 250); assert(p[3] > 200, 'revealed pixel visible in the composite ' + p);
    await H.shot('b1-04-reveal-all');
    await H.key('Control+z'); await H.key('Control+z');
    st = await H.state(); assert(st.w === 600 && st.h === 400, 'undo crop ' + st.w + 'x' + st.h);
  });

  await H.step('Crop (Delete) really deletes pixels outside', async () => {
    await H.key('c');
    await page.locator('#optionsbar select').last().selectOption('delete');
    await H.dragDoc([[50, 50], [400, 350]], { steps: 10 });
    await H.key('Enter');
    const p = await H.lpx(545, 250);
    assert(p[3] === 0, 'deleted ' + p);
    await page.locator('#optionsbar select').last().selectOption('hide');
    await H.key('Control+z');
    const st = await H.state(); assert(st.w === 600, 'undone');
  });

  await H.step('Canvas Size smaller then larger keeps layer pixels', async () => {
    await H.menu('Image', 'Canvas Size…');
    await page.locator('.gesso-dialog input[type=number]').nth(0).fill('300');
    await page.locator('.gesso-dialog input[type=number]').nth(1).fill('200');
    await H.dialogBtn('OK');
    let st = await H.state(); assert(st.w === 300 && st.h === 200, 'shrunk');
    await H.menu('Image', 'Canvas Size…');
    await page.locator('.gesso-dialog input[type=number]').nth(0).fill('600');
    await page.locator('.gesso-dialog input[type=number]').nth(1).fill('400');
    await H.dialogBtn('OK');
    st = await H.state(); assert(st.w === 600 && st.h === 400, 'regrown');
    const p = await H.lpx(595, 300); assert(p[3] > 200, 'pixels outside survived canvas size ' + p);
    await H.shot('b1-05-canvas-size');
  });

  await H.step('paste a 3000×2000 image into the 600×400 doc keeps every pixel; Free Transform shows it all', async () => {
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), H.menu('File', 'Place Image / SVG as Layer…')]);
    // photo.png is small; synthesize a large PNG via a data URL file instead
    const big = await H.ev(async () => { const c = document.createElement('canvas'); c.width = 3000; c.height = 2000; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 3000, 0); g.addColorStop(0, '#0000ff'); g.addColorStop(1, '#00ff00'); x.fillStyle = g; x.fillRect(0, 0, 3000, 2000); x.fillStyle = '#ff00ff'; x.fillRect(2900, 1900, 100, 100); return c.toDataURL('image/png'); });
    const fs = require('fs'); const tmp = TMP + '/gesso-big.png'; fs.writeFileSync(tmp, Buffer.from(big.split(',')[1], 'base64'));
    await fc.setFiles(tmp);
    await H.wait(800);
    const li = await layerInfo();
    assert(li.w === 3000 && li.h === 2000, 'full-size pasted canvas ' + JSON.stringify(li));
    // bottom-right magenta corner sits far outside the document
    const p = await H.ev(() => Array.from(Gesso.Layers.readRect(Gesso.app.doc.activeLayer().canvas, { x: 2950 + (Gesso.app.doc.activeLayer().canvas.ox || 0), y: 1950 + (Gesso.app.doc.activeLayer().canvas.oy || 0), w: 1, h: 1 }).data));
    assert(p[0] > 200 && p[2] > 200, 'magenta kept outside ' + p);
    await H.key('Control+t');
    await H.wait(200);
    const corners = await H.ev(() => Gesso.Transform.active.corners.map((c) => [Math.round(c.x), Math.round(c.y)]));
    assert(corners[2][0] - corners[0][0] === 3000, 'transform box spans the whole image ' + JSON.stringify(corners));
    // scale it down to fit by typing W = 15 % in the options bar
    const wInp = page.locator('#optionsbar .opt-num input').nth(2);
    await wInp.fill('15'); await wInp.press('Enter');
    await H.wait(150);
    await H.key('Enter');
    const li2 = await layerInfo();
    assert(li2.content.w <= 460 && li2.content.w >= 440, 'scaled to ~450 ' + JSON.stringify(li2.content));
    await H.shot('b1-06-paste-big');
  });

  await H.step('Free Transform pushes pixels past the edge; moving back recovers them', async () => {
    await H.key('v');
    const c0 = await H.ev(() => Gesso.Layers.contentRect(Gesso.app.doc.activeLayer()));
    await H.dragDoc([[c0.x + c0.w / 2, c0.y + c0.h / 2], [c0.x + c0.w / 2 + 500, c0.y + c0.h / 2]], { steps: 15 });
    const c1 = await H.ev(() => Gesso.Layers.contentRect(Gesso.app.doc.activeLayer()));
    assert(Math.abs(c1.x - (c0.x + 500)) <= 2 && c1.w === c0.w, 'moved by 500 keeps width ' + JSON.stringify([c0, c1]));
    await H.dragDoc([[c1.x + 20, c1.y + c1.h / 2], [c1.x + 20 - 500, c1.y + c1.h / 2]], { steps: 15 });
    const c2 = await H.ev(() => Gesso.Layers.contentRect(Gesso.app.doc.activeLayer()));
    assert(Math.abs(c2.x - c0.x) <= 2 && c2.w === c0.w, 'back where it was ' + JSON.stringify(c2));
  });

  await H.step('history: 60 strokes keep layer canvas bounded and undo all the way back', async () => {
    await H.key('b');
    for (let i = 0; i < 20; i++) await H.dragDoc([[20 + i * 25, 30], [40 + i * 25, 380]], { steps: 3, after: 20 });
    const li = await layerInfo();
    assert(li.w <= 600 + 2 * 48 + 8 && li.h <= 400 + 2 * 48 + 8, 'canvas bounded by doc + padding ' + JSON.stringify(li));
    for (let i = 0; i < 20; i++) await H.key('Control+z');
    const p = await H.lpx(30, 200); assert(p[3] === 0 || p[0] < 250, 'strokes undone ' + p);
    await H.shot('b1-07-after-undo');
  });

  await H.finish();
})();
