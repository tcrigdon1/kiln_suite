// Pass 2 hands-on session 4: every painting / selection / layer operation on content-sized (offset) layers,
// the way a retoucher would use them: clone, heal, smudge, blur, dodge, eraser, bucket, gradient, masks,
// merge, duplicate, image size, rotate / flip canvas, layer pixels selection, layer via cut, effects.
const { launch, assert, near } = require('./lib');

(async () => {
  const H = await launch();
  const { page } = H;
  await H.ev(() => Gesso.App.createDoc({ name: 'Offs', w: 800, h: 600, dpi: 72, bg: 'white' }));
  await H.wait(200);
  const li = () => H.ev(() => { const l = Gesso.app.doc.activeLayer(), c = l.canvas; return { w: c.width, h: c.height, ox: c.ox || 0, oy: c.oy || 0, content: Gesso.Layers.contentRect(l) }; });
  const row = (name) => page.locator('.layer-row', { has: page.locator('.lname-text', { hasText: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }) }).first();
  const setBrush = (id, o) => H.ev(([id, o]) => { Gesso.Tools.select(id); Object.assign(Gesso.Tools.byId[id].opts, o); }, [id, o]);

  await H.step('new layer: red square via brush; clone (Alt-click source) copies the right pixels from an offset layer', async () => {
    await H.key('Control+Shift+n');
    await setBrush('brush', { size: 60, hardness: 1, opacity: 100, smoothing: 0 });
    await H.ev(() => Gesso.App.setFg('#dd2222'));
    await H.dragDoc([[120, 120], [180, 120]]);
    await H.dragDoc([[120, 150], [180, 150]]);
    const a = await li();
    assert(a.ox > 0 && a.oy > 0 && a.w < 400, 'content-sized layer ' + JSON.stringify(a));
    await setBrush('clone', { size: 40, hardness: 1, opacity: 100, aligned: true, sampleAll: false });
    await H.clickDoc(150, 135, { mods: ['Alt'] });
    await H.dragDoc([[500, 400], [520, 400]]);
    const p = await H.lpx(500, 400), q = await H.lpx(480, 400);
    assert(p[0] > 180 && p[1] < 80 && p[3] > 200, 'cloned red at 500,400: ' + p);
    void q;
    await H.shot('a4-01-clone');
  });

  await H.step('clone with "sample all layers" from the white background onto the layer', async () => {
    await setBrush('clone', { sampleAll: true });
    await H.clickDoc(600, 100, { mods: ['Alt'] });
    await H.dragDoc([[150, 135], [160, 135]]); // paints white (from the background) over the red square
    const p = await H.lpx(150, 135);
    assert(p[0] > 230 && p[1] > 230 && p[3] > 200, 'white cloned over red ' + p);
    await H.key('Control+z');
  });

  await H.step('smudge drags red outward past the layer canvas edge (canvas grows), blur and dodge work at the edge', async () => {
    const before = await li();
    await setBrush('smudge', { size: 40, strength: 90 });
    await H.dragDoc([[175, 135], [175 + before.w, 135]], { steps: 25 });
    const p = await H.lpx(175 + 60, 135);
    assert(p[3] > 20 && p[0] > p[1], 'smudged red trail at ' + (175 + 60) + ': ' + p);
    const after = await li();
    assert(after.w > before.w, 'canvas grew ' + before.w + ' → ' + after.w);
    await setBrush('blur', { size: 50, strength: 100 });
    await H.dragDoc([[120, 110], [120, 170]]);
    await setBrush('dodge', { size: 50, exposure: 100, range: 'midtones' });
    await H.dragDoc([[150, 110], [150, 170]]);
    const d = await H.lpx(150, 140);
    assert(d[0] > 200, 'dodged ' + d);
    await H.shot('a4-02-smudge-blur-dodge');
  });

  await H.step('eraser over an empty area does not grow the layer; over content it erases', async () => {
    const a = await li();
    await setBrush('eraser', { size: 60, hardness: 1, opacity: 100, eraseMode: 'brush' });
    await H.dragDoc([[700, 500], [760, 560]]);
    const b = await li();
    assert(b.w === a.w && b.h === a.h, 'no growth from erasing nothing ' + JSON.stringify([a.w, a.h, b.w, b.h]));
    await H.dragDoc([[120, 120], [180, 120]]);
    const p = await H.lpx(150, 120);
    assert(p[3] < 30, 'erased ' + p);
    await H.key('Control+z');
  });

  await H.step('paint bucket on the transparent part of the layer fills the whole document region (not just the canvas)', async () => {
    await setBrush('bucket', { tolerance: 32, contiguous: true, sampleAll: false, opacity: 100, blend: 'normal' });
    await H.ev(() => Gesso.App.setFg('#2266cc'));
    await H.clickDoc(700, 500);
    const p = await H.lpx(10, 590), q = await H.lpx(790, 10);
    assert(p[2] > 150 && q[2] > 150, 'filled corners ' + p + ' / ' + q);
    const r = await H.lpx(200, 160); assert(r[0] > 150 && r[2] < 100, 'red square kept ' + r);
    await H.shot('a4-03-bucket');
    await H.key('Control+z');
  });

  await H.step('gradient tool inside a selection on the layer; Select ▸ Layer Pixels then Layer via Cut', async () => {
    await H.key('m');
    await H.dragDoc([[400, 100], [700, 300]]);
    await H.ev(() => { Gesso.Tools.select('gradient'); Gesso.Tools.byId.gradient.opts.preset = 2; Gesso.Tools.byId.gradient.opts.type = 'linear'; });
    await H.dragDoc([[400, 200], [700, 200]]);
    const p1 = await H.lpx(420, 200), p2 = await H.lpx(680, 200);
    assert(p1[3] === 255 && p2[3] === 255 && p2[0] - p1[0] > 150, 'black→white gradient ' + p1 + ' → ' + p2);
    const out = await H.lpx(380, 200); assert(out[3] === 0, 'outside the selection untouched ' + out);
    await H.key('Control+d');
    await H.menu('Select', 'Layer Pixels');
    const st = await H.state();
    assert(st.sel && st.sel.x >= 85 && st.sel.y >= 85 && st.sel.x + st.sel.w <= 800, 'layer pixels selection ' + JSON.stringify(st.sel));
    await H.key('Control+d');
    await H.key('m');
    await H.dragDoc([[400, 100], [700, 300]]);
    await H.key('Control+Shift+j'); // layer via cut
    const st2 = await H.state();
    assert(st2.active.endsWith('cut'), 'cut layer ' + st2.active);
    const c = await li();
    assert(c.ox >= 395 && c.w <= 305, 'cut layer is content-sized at the selection ' + JSON.stringify(c));
    await row('Layer 1').click();
    const hole = await H.lpx(500, 200); assert(hole[3] === 0, 'pixels removed from the source ' + hole);
    await H.shot('a4-04-gradient-cut');
  });

  await H.step('layer mask painted on an offset layer; Apply Layer Mask keeps the position', async () => {
    await row('Layer 1 cut').click();
    await H.menu('Layer', 'Layer Mask', 'Reveal All');
    await setBrush('brush', { size: 80, hardness: 1, opacity: 100 });
    await H.ev(() => Gesso.App.setFg('#000000'));
    await H.dragDoc([[450, 150], [450, 250]]);
    let p = await H.px(450, 200);
    assert(p[0] > 240 && p[1] > 240 && p[2] > 240, 'masked out → white background shows ' + p);
    await H.menu('Layer', 'Layer Mask', 'Apply Layer Mask');
    p = await H.px(450, 200); const q = await H.px(650, 200);
    assert(p[0] > 240 && q[0] > 200 && q[3] === 255, 'mask applied: hole stays, rest kept ' + p + ' / ' + q);
    const c = await li(); assert(c.ox >= 395, 'position kept ' + JSON.stringify(c));
  });

  await H.step('merge down of offset layers; duplicate + move; stamp visible', async () => {
    await H.key('Control+e'); // merge "Layer 1 cut" into "Layer 1"
    let st = await H.state();
    assert(st.layers.length === 2, 'merged ' + JSON.stringify(st.layers.map((l) => l.name)));
    let p = await H.lpx(650, 200); assert(p[3] === 255, 'merged pixels ' + p);
    p = await H.lpx(150, 135); assert(p[0] > 150 && p[3] > 200, 'other pixels ' + p);
    await H.menu('Layer', 'Duplicate Layer');
    await H.key('v');
    await H.dragDoc([[650, 200], [650, 400]]);
    p = await H.px(650, 400); assert(p[3] === 255 && p[0] > 150, 'duplicate moved ' + p);
    await H.key('Control+Alt+Shift+e');
    st = await H.state(); assert(st.active === 'Stamp', 'stamp');
    const c = await li(); assert(c.w === 800 && c.h === 600, 'stamp is document-sized (opaque background) ' + JSON.stringify(c));
    await H.shot('a4-05-merge-dup');
  });

  await H.step('Image Size 50 % scales offset layers into place; Rotate Canvas 90° and Flip keep them aligned', async () => {
    const ref = await H.ev(() => Gesso.Compositor.flatten(Gesso.app.doc).toDataURL());
    await H.menu('Image', 'Image Size…');
    await page.locator('.gesso-dialog input[type=number]').nth(2).fill('50');
    await page.locator('.gesso-dialog input[type=number]').nth(2).dispatchEvent('input');
    await H.dialogBtn('OK');
    let st = await H.state(); assert(st.w === 400 && st.h === 300, 'resized');
    // compare the composite with a plain downscale of the previous composite
    const diff = await H.ev(async (ref) => {
      const img = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = ref; });
      const c = document.createElement('canvas'); c.width = 400; c.height = 300; const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, 400, 300);
      const a = x.getImageData(0, 0, 400, 300).data, b = Gesso.Compositor.flatten(Gesso.app.doc).getContext('2d').getImageData(0, 0, 400, 300).data;
      let n = 0, s = 0; for (let i = 0; i < a.length; i += 4) { const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); if (d > 90) n++; s += d; }
      return { bad: n, mean: s / (a.length / 4) };
    }, ref);
    assert(diff.bad < 400 && diff.mean < 12, 'downscaled composite matches a reference downscale ' + JSON.stringify(diff));
    await H.menu('Image', 'Rotate Canvas', '90° Clockwise');
    st = await H.state(); assert(st.w === 300 && st.h === 400, 'rotated');
    // an untouched red pixel of the square (195,170) is at (97,85) after scaling → (300-85, 97) after rotating CW
    let p = await H.px(300 - 85, 97); assert(p[0] > 150 && p[2] < 110, 'rotated content in place ' + p);
    await H.menu('Image', 'Rotate Canvas', 'Flip Canvas Horizontal');
    p = await H.px(85, 97); assert(p[0] > 150 && p[2] < 110, 'flipped content in place ' + p);
    await H.shot('a4-06-size-rotate-flip');
    await H.key('Control+z'); await H.key('Control+z'); await H.key('Control+z');
    st = await H.state(); assert(st.w === 800 && st.h === 600, 'undone to 800×600');
  });

  await H.step('drop shadow on a moved content-sized layer lands where it should (relative to the content)', async () => {
    await H.key('Control+d');
    const bgPix = await H.px(560, 375);
    await H.key('Control+Shift+n');
    await setBrush('pencil', { size: 60, opacity: 100 });
    await H.ev(() => Gesso.App.setFg('#2040c0'));
    await H.dragDoc([[430, 330], [670, 330]]); // a 60 px tall bar from x≈400..700, y≈300..360
    await H.ev(() => { const d = Gesso.app.doc, l = d.activeLayer(); d.commit('fx', () => { l.effects = { enabled: true, items: { dropShadow: Object.assign(Gesso.Effects.defaults('dropShadow'), { distance: 30, size: 0, angle: 135, opacity: 100, color: '#000000' }) } }; l.version++; }); });
    await H.wait(200);
    const sh = await H.px(415 + 30, 360 + 15), noSh = await H.px(400 - 15, 360 + 15);
    assert(sh[0] < 60 && sh[3] === 255, 'shadow below-right of the bar ' + sh);
    assert(noSh[0] > 200, 'no shadow left of the bar ' + noSh);
    await H.key('v');
    await H.dragDoc([[550, 330], [350, 330]], { steps: 10 });
    const sh2 = await H.px(215 + 30, 360 + 15), old = await H.px(560, 375);
    assert(sh2[0] < 60, 'shadow moved with the layer ' + sh2);
    assert(near(old, bgPix, 2), 'old shadow position cleared ' + old + ' (background ' + bgPix + ')');
    await H.shot('a4-07-shadow-moved');
  });

  await H.step('export matches the on-screen composite', async () => {
    const same = await H.ev(() => { const d = Gesso.app.doc; Gesso.Compositor.update(d); const a = d.composite.getContext('2d').getImageData(0, 0, d.width, d.height).data, b = Gesso.FileIO.renderExport(d, 1).getContext('2d').getImageData(0, 0, d.width, d.height).data; let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; });
    assert(same === 0, 'export differs from composite in ' + same + ' bytes');
  });

  await H.finish();
})();
