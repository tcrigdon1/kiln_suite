// Sparse masks (Part B): paint / move / transform / invert / canvas size / filter / save+reload (v2) and a v1
// full-size mask file — all through the UI, checking the composite and that the mask canvas stays small.
const { launch, assert, near } = require('./lib');
const path = require('path');
const fs = require('fs');

(async () => {
  const H = await launch();
  const { page } = H;
  const maskInfo = () => H.ev(() => { const l = Gesso.app.doc.activeLayer(), m = l.mask; if (!m) return null; const c = m.canvas; return { w: c.width, h: c.height, ox: c.ox || 0, oy: c.oy || 0, outside: m.outside, empty: !!c._empty, editMask: !!l.editMask }; });

  await H.ev(() => Gesso.App.createDoc({ name: 'Masks', w: 600, h: 400, dpi: 72, bg: 'white' }));
  await H.wait(200);
  await H.menu('Layer', 'New', 'New Layer');
  await H.key('b');
  await H.ev(() => { const o = Gesso.Tools.byId.brush.opts; o.size = 80; o.opacity = 100; o.hardness = 1; o.pressureSize = false; Gesso.App.setFg('#2244cc'); });
  await H.dragDoc([[100, 200], [500, 200]]);

  await H.step('Reveal-all mask costs one pixel; painting black on it hides the layer there and grows the mask canvas only around the stroke', async () => {
    await H.menu('Layer', 'Layer Mask', 'Reveal All');
    let mi = await maskInfo();
    assert(mi && mi.w === 1 && mi.h === 1 && mi.outside === 255 && mi.editMask, 'fresh mask ' + JSON.stringify(mi));
    await H.ev(() => Gesso.App.setFg('#000000'));
    await H.dragDoc([[280, 200], [320, 200]]);
    mi = await maskInfo();
    assert(!mi.empty && mi.w < 300 && mi.h < 300 && mi.ox > 150 && mi.oy > 80, 'mask grew around the stroke only ' + JSON.stringify(mi));
    const hole = await H.px(300, 200), kept = await H.px(150, 200);
    assert(hole[0] > 240 && hole[1] > 240 && hole[2] > 240, 'hole shows the white background ' + hole);
    assert(kept[2] > 150 && kept[0] < 100, 'rest of the stroke still blue ' + kept);
    await H.shot('a5-01-mask-hole');
  });

  await H.step('Move tool moves the layer and its mask together; the area that moves in stays revealed', async () => {
    await H.key('v');
    await H.ev(() => { Gesso.app.doc.activeLayer().editMask = false; });
    await H.dragDoc([[150, 200], [250, 200]], { steps: 15 });
    const hole = await H.px(400, 200), blueNew = await H.px(230, 200);
    assert(hole[0] > 240 && hole[2] > 240, 'hole moved with the layer ' + hole);
    assert(blueNew[2] > 150 && blueNew[0] < 100, 'moved-in part visible (outside = reveal) ' + blueNew);
    const mi = await maskInfo(); assert(mi.ox > 250, 'mask canvas offset moved ' + JSON.stringify(mi));
    await H.key('Control+z');
    const back = await H.px(300, 200); assert(back[0] > 240, 'undo moved it back ' + back);
  });

  await H.step('Free Transform scales the layer together with its mask', async () => {
    await H.key('Control+t');
    await H.wait(150);
    await H.ev(() => { const st = Gesso.Transform.active; const v = { cx: 300, cy: 200, sw: 50, sh: 50, a: 0 }; const w0 = 400 + 80, k = 0.5; void w0; void k; st.corners = st.corners.map((p) => ({ x: 300 + (p.x - 300) * 0.5, y: 200 + (p.y - 200) * 0.5 })); Gesso.Transform.render(); });
    await H.key('Enter');
    await H.wait(150);
    const hole = await H.px(300, 200), blue = await H.px(240, 200), far = await H.px(120, 200);
    assert(hole[0] > 240, 'hole still at the centre ' + hole);
    assert(blue[2] > 150 && blue[0] < 100, 'scaled stroke ' + blue);
    assert(far[0] > 240 && far[2] > 240, 'outside the scaled stroke is background ' + far);
    await H.shot('a5-02-transformed');
    await H.key('Control+z');
  });

  await H.step('Invert Layer Mask flips the implicit outside value (only the hole stays visible)', async () => {
    await H.menu('Layer', 'Layer Mask', 'Invert Layer Mask');
    const mi = await maskInfo(); assert(mi.outside === 0, 'outside inverted ' + JSON.stringify(mi));
    const hole = await H.px(300, 200), kept = await H.px(150, 200);
    assert(hole[2] > 150 && hole[0] < 100, 'hole now shows the layer ' + hole);
    assert(kept[0] > 240, 'rest hidden ' + kept);
    await H.key('Control+z');
    const mi2 = await maskInfo(); assert(mi2.outside === 255, 'undo restored outside ' + JSON.stringify(mi2));
  });

  await H.step('Canvas Size: the new area of a reveal-all mask is revealed, hide-all stays hidden', async () => {
    await H.menu('Image', 'Canvas Size…');
    await page.locator('.gesso-dialog input[type=number]').nth(0).fill('800');
    await H.dialogBtn('OK');
    await H.wait(200);
    const st = await H.state(); assert(st.w === 800, 'canvas 800 wide');
    await H.key('v');
    await H.dragDoc([[200, 200], [500, 200]], { steps: 15 });
    const p = await H.px(620, 200), hole = await H.px(700, 200);
    assert(p[2] > 150 && p[0] < 100, 'layer visible in the extended area ' + p);
    assert(hole[3] === 0, 'the hole moved along (transparent extension behind it) ' + hole);
    await H.key('Control+z'); await H.key('Control+z');
    assert((await H.state()).w === 600, 'undone');
  });

  await H.step('Gaussian Blur on the mask (paint-on-mask target) works and the mask stays compact', async () => {
    await H.ev(() => { Gesso.app.doc.activeLayer().editMask = true; });
    await H.menu('Filter', 'Blur', 'Gaussian Blur…');
    await H.wait(400);
    await H.dialogBtn('OK');
    await H.wait(300);
    const mi = await maskInfo();
    assert(mi.w < 600 && mi.h < 400, 'mask canvas not blown up to the document ' + JSON.stringify(mi));
    const edge = await H.ev(() => { const l = Gesso.app.doc.activeLayer(); return Gesso.Layers.readRect(l.mask.canvas, { x: 239, y: 200, w: 1, h: 1 }, l.mask.outside).data[3]; }); // hole edge: partially blurred
    assert(edge > 5 && edge < 250, 'soft edge after blur ' + edge);
    const far = await H.ev(() => { const l = Gesso.app.doc.activeLayer(); return Gesso.Layers.readRect(l.mask.canvas, { x: 10, y: 10, w: 1, h: 1 }, l.mask.outside).data[3]; });
    assert(far === 255, 'far away the mask is still reveal-all ' + far);
    await H.key('Control+z');
  });

  await H.step('Save (v2) and reopen: mask bounds + outside round-trip and the picture is identical', async () => {
    const before = await H.ev(() => Gesso.Compositor.flatten(Gesso.app.doc).toDataURL());
    const dl = page.waitForEvent('download');
    await H.key('Control+s');
    const d = await dl; const file = path.join(__dirname, 'downloads', 'a5-masks.kgesso'); await d.saveAs(file);
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const L = json.layers.find((l) => l.mask);
    assert(json.version === 2 && L.mask.outside === 255 && L.mask.bounds && L.mask.bounds.w < 300, 'v2 mask serialized ' + JSON.stringify(L.mask.bounds) + ' outside ' + L.mask.outside);
    const fc = page.waitForEvent('filechooser');
    await H.key('Control+o');
    await (await fc).setFiles(file);
    await H.wait(600);
    const after = await H.ev(() => Gesso.Compositor.flatten(Gesso.app.doc).toDataURL());
    assert(after === before, 'reopened document renders identically');
    const mi = await H.ev(() => { const d = Gesso.app.doc; const l = d.allLayers().find((x) => x.mask); const c = l.mask.canvas; return { w: c.width, h: c.height, outside: l.mask.outside }; });
    assert(mi.w < 300 && mi.outside === 255, 'reopened mask is sparse ' + JSON.stringify(mi));
    await H.shot('a5-03-reopened');
  });

  await H.step('A v1 file with a full-size mask PNG loads, is compacted and renders the same as the v2 file', async () => {
    const r = await H.ev(async () => {
      const d = Gesso.app.doc;
      const v2 = await Gesso.FileIO.serialize(d);
      // turn it into a v1 file: full-document mask PNGs, full-document layer PNGs at 0,0
      const v1 = JSON.parse(JSON.stringify(v2)); v1.version = 1;
      const toURL = (c) => c.toDataURL('image/png');
      const walk = (list, src) => list.forEach((o, i) => {
        const l = src[i];
        if (l.mask) { o.mask = { data: toURL(Gesso.Layers.maskDocCanvas(l.mask, d)), enabled: true, density: 1, feather: 0 }; }
        if (l.type === 'raster' && o.pixels) { o.pixels = toURL(Gesso.Layers.docCanvas(l.canvas, d)); delete o.bounds; }
        if (o.children) walk(o.children, l.children);
      });
      walk(v1.layers, d.layers);
      const ref = Gesso.Compositor.flatten(d).toDataURL();
      const nd = await Gesso.FileIO.loadProject(v1, 'v1');
      await new Promise((res) => setTimeout(res, 300));
      const l = nd.allLayers().find((x) => x.mask);
      return { same: Gesso.Compositor.flatten(nd).toDataURL() === ref, mask: { w: l.mask.canvas.width, h: l.mask.canvas.height, outside: l.mask.outside } };
    });
    assert(r.same, 'v1 renders identically');
    assert(r.mask.w < 300 && r.mask.outside === 255, 'v1 mask compacted ' + JSON.stringify(r.mask));
  });

  await H.step('Hide-all mask + painting white reveals; Apply Layer Mask bakes it', async () => {
    await H.ev(() => Gesso.App.createDoc({ name: 'M2', w: 400, h: 300, dpi: 72, bg: 'white' }));
    await H.wait(150);
    await H.menu('Layer', 'New', 'New Layer');
    await H.key('b');
    await H.ev(() => { Gesso.App.setFg('#cc2222'); Gesso.Tools.byId.brush.opts.size = 100; });
    await H.dragDoc([[60, 150], [340, 150]]);
    await H.menu('Layer', 'Layer Mask', 'Hide All');
    let p = await H.px(200, 150); assert(p[0] > 240 && p[1] > 240, 'hidden ' + p);
    await H.ev(() => Gesso.App.setFg('#ffffff'));
    await H.dragDoc([[180, 150], [220, 150]]);
    p = await H.px(200, 150); assert(p[0] > 150 && p[1] < 100, 'revealed where painted white ' + p);
    const mi = await maskInfo(); assert(mi.outside === 0 && mi.w < 250, 'hide-all sparse ' + JSON.stringify(mi));
    await H.menu('Layer', 'Layer Mask', 'Apply Layer Mask');
    const st = await H.ev(() => { const l = Gesso.app.doc.activeLayer(); return { mask: !!l.mask, cr: Gesso.Layers.contentRect(l) }; });
    assert(!st.mask && st.cr && st.cr.w < 200, 'mask applied, only the revealed part remains ' + JSON.stringify(st));
    p = await H.px(100, 150); assert(p[0] > 240, 'hidden part really gone ' + p);
    await H.shot('a5-04-applied');
  });

  await H.finish();
})();
