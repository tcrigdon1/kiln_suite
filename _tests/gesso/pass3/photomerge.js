// Pass 3 — Auto-Align Layers, Merge Exposures (exposure fusion), Apply Image
const { launch, assert } = require('../pass2/lib');
(async () => {
  const H = await launch();
  const { page } = H;
  // three "exposures" of the same scene: a gradient sky + dark ground with a bright square; the 2nd is shifted (+9,-6)
  await H.ev(() => {
    const S = window.Gesso, d = S.App.createDoc({ name: 'HDR', w: 320, h: 240, dpi: 72, bg: 'white' });
    const scene = (ev, dx, dy) => {
      const c = S.util.createCanvas(320, 240), x = c.getContext('2d'); x.translate(dx, dy);
      const g = x.createLinearGradient(0, 0, 0, 120); g.addColorStop(0, 'rgb(' + Math.min(255, 180 * ev) + ',' + Math.min(255, 200 * ev) + ',' + Math.min(255, 255 * ev) + ')'); g.addColorStop(1, 'rgb(' + Math.min(255, 240 * ev) + ',' + Math.min(255, 240 * ev) + ',' + Math.min(255, 255 * ev) + ')');
      x.fillStyle = g; x.fillRect(-20, -20, 360, 140); x.fillStyle = 'rgb(' + Math.min(255, 20 * ev) + ',' + Math.min(255, 30 * ev) + ',' + Math.min(255, 10 * ev) + ')'; x.fillRect(-20, 120, 360, 140);
      x.fillStyle = 'rgb(' + Math.min(255, 90 * ev) + ',' + Math.min(255, 60 * ev) + ',' + Math.min(255, 30 * ev) + ')'; x.fillRect(120, 150, 60, 50); x.fillStyle = '#fff'; x.fillRect(200, 40, 30, 30);
      return c;
    };
    const dark = S.Layers.raster(d, 'dark', scene(0.5, 0, 0)), mid = S.Layers.raster(d, 'mid', scene(1.5, 9, -6)), bright = S.Layers.raster(d, 'bright', scene(4, 0, 0));
    d.insertLayer(dark, d.activeId, 'above'); d.insertLayer(mid, dark.id, 'above'); d.insertLayer(bright, mid.id, 'above');
    d.selectedIds = new Set([dark.id, mid.id, bright.id]); d.activeId = bright.id;
  });
  await H.wait(200);

  await H.step('Auto-Align finds the (+9,−6) shift of the middle exposure', async () => {
    const r = await H.ev(() => { const S = window.Gesso, d = S.app.doc; S.PhotoMerge.autoAlign(d); const m = d.layers.find((l) => l.name === 'mid'); return { ox: m.canvas.ox || 0, oy: m.canvas.oy || 0, name: d.history.entries[d.history.index].name }; });
    assert(r.ox === -9 && r.oy === 6 && r.name === 'Auto-Align Layers', JSON.stringify(r));
  });

  await H.step('Merge Exposures: new layer, dark sky from the dark frame, ground from the bright one, originals hidden', async () => {
    await H.ev(() => { const S = window.Gesso, d = S.app.doc; d.selectedIds = new Set(d.layers.filter((l) => /dark|mid|bright/.test(l.name)).map((l) => l.id)); });
    const r = await H.ev(async () => {
      const S = window.Gesso, d = S.app.doc, layers = d.layers.filter((l) => /dark|mid|bright/.test(l.name));
      const imgs = layers.map((l) => S.Layers.readRect(l.canvas, { x: 0, y: 0, w: d.width, h: d.height }, 0));
      const out = await S.PhotoMerge.fuse(imgs, d.width, d.height, { contrast: 1, saturation: 1, exposure: 1 });
      const px = (x, y) => { const o = (y * d.width + x) * 4; return [out.data[o], out.data[o + 1], out.data[o + 2]]; };
      return { sky: px(60, 30), ground: px(40, 200), box: px(150, 175) };
    });
    // sky: bright frame is blown out (255), dark frame ~ (90,100,128): fused sky must not be clipped
    assert(r.sky[2] < 250 && r.sky[2] > 100, 'sky not blown out: ' + JSON.stringify(r.sky));
    // ground: dark frame is ~ (10,15,5): fused ground should be lifted well above it
    assert(r.ground[1] > 40, 'ground lifted: ' + JSON.stringify(r.ground));
    assert(r.box[0] > r.ground[0] + 30, 'the box on the ground keeps contrast: ' + JSON.stringify(r));
    // through the dialog path (merge creates a layer and hides the sources)
    await H.ev(() => Gesso.Cmd.run('layer.mergeExposures')); await H.wait(300);
    await page.locator('.gesso-dialog .btn.primary, .gesso-dialog button.primary').last().click();
    await page.waitForFunction(() => Gesso.app.doc.layers.some((l) => l.name === 'Merged exposure'), null, { timeout: 20000 });
    const st = await H.ev(() => { const d = Gesso.app.doc; return { merged: !!d.layers.find((l) => l.name === 'Merged exposure'), hidden: d.layers.filter((l) => /dark|mid|bright/.test(l.name)).every((l) => !l.visible), active: d.activeLayer().name }; });
    assert(st.merged && st.hidden && st.active === 'Merged exposure', JSON.stringify(st));
  });

  await H.step('Apply Image: multiply the merged layer by the dark layer\'s luminosity at 50 %, only inside a selection', async () => {
    const r = await H.ev(() => {
      const S = window.Gesso, d = S.app.doc, t = d.activeLayer(), src = d.layers.find((l) => l.name === 'dark');
      const before = S.Layers.readRect(t.canvas, { x: 0, y: 0, w: d.width, h: d.height }, 0).data.slice();
      d.selection = S.Sel.make(S.Sel.rectMask(d.width, d.height, 0, 0, 160, 240), d.width, d.height);
      d.commit('Apply Image', () => S.PhotoMerge.applyImage(d, t, { source: src.id, channel: 'l', invert: false, blend: 'multiply', opacity: 50, dest: 'pixels', sel: true }));
      const after = S.Layers.readRect(t.canvas, { x: 0, y: 0, w: d.width, h: d.height }, 0).data;
      const at = (x, y) => (y * d.width + x) * 4;
      const i1 = at(60, 30), i2 = at(260, 30);
      return { inB: before[i1], inA: after[i1], outB: before[i2], outA: after[i2], name: d.history.entries[d.history.index].name };
    });
    assert(r.inA < r.inB - 5, 'inside the selection the pixel got darker (' + r.inB + ' → ' + r.inA + ')');
    assert(r.outA === r.outB, 'outside the selection unchanged');
    assert(r.name === 'Apply Image', 'undo step');
    await H.ev(() => Gesso.Cmd.run('edit.undo'));
  });

  await H.step('commands/menus registered', async () => {
    const r = await H.ev(() => ({ a: !!Gesso.Cmd.get('layer.autoAlign'), m: !!Gesso.Cmd.get('layer.mergeExposures'), i: !!Gesso.Cmd.get('image.applyImage') }));
    assert(r.a && r.m && r.i, JSON.stringify(r));
    await H.menu('Image'); const items = await page.locator('.gesso-menu').first().locator('.item').allTextContents(); await H.key('Escape');
    assert(items.some((t) => /Apply Image/.test(t)) && items.some((t) => /Content-Aware Scale/.test(t)), items.join('|'));
  });

  await H.finish();
})();
