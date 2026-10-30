// Pass 3 — Blend If: this-layer / underlying ranges with split handles; UI drag with real mouse; undo; serialize
const { launch, assert } = require('../pass2/lib');
(async () => {
  const H = await launch();
  const { page } = H;
  await H.ev(() => {
    const S = window.Gesso, d = S.App.createDoc({ name: 'BI', w: 256, h: 100, dpi: 72, bg: 'white' });
    // background: horizontal black→white gradient; top layer: solid red
    const x = d.layers[0].canvas.getContext('2d'); const g = x.createLinearGradient(0, 0, 256, 0); g.addColorStop(0, '#000'); g.addColorStop(1, '#fff'); x.fillStyle = g; x.fillRect(0, 0, 256, 100); d.bump(d.layers[0]);
    const c = S.util.createCanvas(256, 100); c.getContext('2d').fillStyle = '#e02020'; c.getContext('2d').fillRect(0, 0, 256, 100);
    const red = S.Layers.raster(d, 'red', c); d.insertLayer(red, d.activeId, 'above'); d.setActive(red.id);
  });
  await H.wait(200);
  const px = (X) => H.ev((X) => { const f = Gesso.Compositor.flatten(Gesso.app.doc); return Array.from(f.getContext('2d').getImageData(X, 50, 1, 1).data).slice(0, 3); }, X);

  await H.step('Underlying range hides the red layer over dark pixels, with a soft ramp when the handle is split', async () => {
    await H.ev(() => { const d = Gesso.app.doc, l = d.activeLayer(); d.commit('bi', () => { l.blendIf = { on: true, channel: 'gray', t: [0, 0, 255, 255], u: [64, 128, 255, 255] }; l.version++; }); });
    const dark = await px(20), mid = await px(96), bright = await px(220);
    assert(dark[0] < 60 && dark[1] < 60, 'over black the red is hidden: ' + JSON.stringify(dark));
    assert(bright[0] > 200 && bright[1] < 60, 'over white the red shows: ' + JSON.stringify(bright));
    assert(mid[0] > 90 && mid[0] < 200 && mid[1] > 40, 'inside the split ramp (96) it is partially blended: ' + JSON.stringify(mid));
  });

  await H.step('This Layer range: a gradient layer vanishes where its own luma is out of range', async () => {
    await H.ev(() => {
      const S = window.Gesso, d = S.app.doc, l = d.activeLayer();
      const c = S.util.createCanvas(256, 100), x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 256, 0); g.addColorStop(0, '#0000ff'); g.addColorStop(1, '#ffff00'); x.fillStyle = g; x.fillRect(0, 0, 256, 100);
      d.commit('swap', () => { l.canvas = c; l.version++; l.blendIf = { on: true, channel: 'gray', t: [0, 0, 120, 120], u: [0, 0, 255, 255] }; d.bump(l); });
    });
    const left = await px(10), right = await px(246);
    assert(left[2] > 150 && left[0] < 80, 'dark-luma blue end stays: ' + JSON.stringify(left));
    assert(right[0] > 200 && right[1] > 200 && right[2] > 200, 'bright yellow end is hidden (white background shows): ' + JSON.stringify(right));
  });

  await H.step('Properties panel: dragging the Underlying low handle with the mouse changes the range and makes one undo step', async () => {
    await H.ev(() => { const d = Gesso.app.doc, l = d.activeLayer(); d.commit('reset', () => { l.blendIf = { on: true, channel: 'gray', t: [0, 0, 255, 255], u: [0, 0, 255, 255] }; l.version++; }); Gesso.Panels.show('properties'); });
    await H.wait(300);
    const rows = page.locator('.bi-row'); assert(await rows.count() === 2, 'two slider rows');
    const under = rows.nth(1), handle = under.locator('.bi-handle').nth(1), track = under.locator('.bi-track');
    await handle.scrollIntoViewIfNeeded(); await H.wait(100);
    const tb = await track.boundingBox(), hb = await handle.boundingBox();
    const n0 = await H.ev(() => Gesso.app.doc.history.entries.length);
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down(); await page.mouse.move(hb.x + hb.width / 2 + tb.width * 0.4, hb.y + hb.height / 2, { steps: 8 }); await page.mouse.up(); await H.wait(200);
    const r = await H.ev(() => { const d = Gesso.app.doc; return { u: d.activeLayer().blendIf.u, n: d.history.entries.length, name: d.history.entries[d.history.index].name }; });
    assert(r.u[0] > 80 && r.u[0] < 130 && r.u[1] === r.u[0], 'low pair moved together to ~102: ' + JSON.stringify(r.u));
    assert(r.n === n0 + 1 && r.name === 'Blend If', 'one undo step: ' + r.name);
    await H.ev(() => Gesso.Cmd.run('edit.undo'));
    const u2 = await H.ev(() => Gesso.app.doc.activeLayer().blendIf.u);
    assert(u2[0] === 0 && u2[1] === 0, 'undo restores');
  });

  await H.step('Blend If survives save/load', async () => {
    const r = await H.ev(async () => { const S = window.Gesso, d = S.app.doc; d.activeLayer().blendIf = { on: true, channel: 'r', t: [10, 20, 200, 230], u: [0, 0, 255, 255] }; const j = await S.FileIO.serialize(d); const d2 = await S.FileIO.loadProject(JSON.parse(JSON.stringify(j)), 'x', { noAdd: true }); return d2.layers.find((l) => l.name === 'red').blendIf; });
    assert(r && r.channel === 'r' && r.t[1] === 20 && r.t[3] === 230, JSON.stringify(r));
  });
  await H.finish();
})();
