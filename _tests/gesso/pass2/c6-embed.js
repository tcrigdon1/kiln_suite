// C4 — Embedded objects: convert, scale down then back up without degradation, move, undo, edit contents in a
// new tab and save back, perspective rasterizes, .kgesso round trip, rasterize command.
const { launch, assert } = require('./lib');
const path = require('path');
const fs = require('fs');

(async () => {
  const H = await launch();
  const { page } = H;
  await H.ev(() => {
    const d = Gesso.App.createDoc({ name: 'Embed', w: 600, h: 400, dpi: 72, bg: 'white' });
    // a detailed object: a fine checkerboard with a diagonal, on its own layer
    const c = Gesso.util.createCanvas(200, 200, 200, 100), x = c.getContext('2d');
    for (let y = 0; y < 200; y += 4) for (let xx = 0; xx < 200; xx += 4) { x.fillStyle = ((xx + y) / 4) % 2 ? '#111' : '#eee'; x.fillRect(xx, y, 4, 4); }
    x.strokeStyle = '#e04020'; x.lineWidth = 6; x.beginPath(); x.moveTo(0, 0); x.lineTo(200, 200); x.stroke();
    const l = Gesso.Layers.raster(d, 'Detail', c); d.commit('add', () => { d.insertLayer(l); d.activeId = l.id; d.selectedIds = new Set([l.id]); });
  });
  await H.wait(200);
  const sharpness = () => H.ev(() => { // mean absolute difference between neighbouring pixels inside the object (checker contrast)
    const d = Gesso.app.doc; Gesso.Compositor.update(d); const img = d.composite.getContext('2d').getImageData(210, 110, 180, 180).data;
    let s = 0, n = 0; for (let i = 0; i < img.length - 4; i += 4) { s += Math.abs(img[i] - img[i + 4]); n++; } return s / n;
  });
  const s0 = await sharpness();

  await H.step('Layer ▸ Embedded Object ▸ Convert keeps the picture identical and marks the layer', async () => {
    const before = await H.ev(() => Gesso.Compositor.flatten(Gesso.app.doc).toDataURL());
    await H.menu('Layer', 'Embedded Object', 'Convert to Embedded Object');
    await H.wait(150);
    const info = await H.ev(() => { const l = Gesso.app.doc.activeLayer(); return { embed: !!l.embed, src: l.embed && [l.embed.source.width, l.embed.source.height], badge: !!document.querySelector('.embed-badge') }; });
    assert(info.embed && info.src[0] >= 200 && info.badge, 'embedded ' + JSON.stringify(info));
    const after = await H.ev(() => Gesso.Compositor.flatten(Gesso.app.doc).toDataURL());
    assert(after === before, 'pixels unchanged by the conversion');
    const props = await page.locator('.panel-properties').innerText();
    assert(/Embedded object/.test(props) && /Source/.test(props), 'properties show the object info');
    await H.shot('c6-01-converted');
  });

  await H.step('Free Transform to 20 % then back to 100 % keeps the checkerboard sharp (a plain layer would be mush)', async () => {
    const scaleTo = async (k) => {
      await H.key('Control+t'); await H.wait(100);
      await H.ev((k) => { const st = Gesso.Transform.active; const c = st.corners, cx = (c[0].x + c[2].x) / 2, cy = (c[0].y + c[2].y) / 2; st.corners = c.map((p) => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k })); Gesso.Transform.render(); }, k);
      await H.key('Enter'); await H.wait(150);
    };
    await scaleTo(0.2);
    const small = await H.ev(() => { const l = Gesso.app.doc.activeLayer(); return { w: l.canvas.width, sc: Gesso.Embed.scale(l.embed.matrix) }; });
    assert(small.w < 60 && Math.abs(small.sc - 0.2) < 0.02, 'scaled down ' + JSON.stringify(small));
    await scaleTo(5);
    const s1 = await sharpness();
    console.log('   sharpness original', s0.toFixed(1), 'after 20%→100%', s1.toFixed(1));
    assert(s1 > s0 * 0.8, 'still sharp: ' + s1.toFixed(1) + ' vs ' + s0.toFixed(1));
    await H.shot('c6-02-rescaled');
    // compare with a plain layer doing the same round trip
    await H.ev(() => { const d = Gesso.app.doc; d.commit('dup', () => { const c = Gesso.Layers.duplicate(d.activeLayer(), d); Gesso.Embed.rasterize(c); d.insertLayer(c); d.activeId = c.id; d.selectedIds = new Set([c.id]); d.activeLayer().name = 'Plain'; }); });
    await H.ev(() => { const d = Gesso.app.doc; d.findLayer(d.layers[1].id).visible = false; d.invalidate(); });
    await scaleTo(0.2); await scaleTo(5);
    const s2 = await sharpness();
    console.log('   plain layer after the same round trip', s2.toFixed(1));
    assert(s2 < s1 * 0.75, 'plain layer degraded (' + s2.toFixed(1) + ') while the object stayed sharp (' + s1.toFixed(1) + ')');
    await H.ev(() => { const d = Gesso.app.doc; d.commit('cleanup', () => { d.removeLayer(d.activeId); d.layers[1].visible = true; d.activeId = d.layers[1].id; d.selectedIds = new Set([d.activeId]); }); });
  });

  await H.step('Move tool drags the object; the matrix follows (a later re-render lands in the same place); undo works', async () => {
    await H.key('v');
    const b0 = await H.ev(() => Gesso.Embed.bounds(Gesso.app.doc.activeLayer()));
    await H.dragDoc([[300, 200], [360, 230]], { steps: 10 });
    const b1 = await H.ev(() => { const l = Gesso.app.doc.activeLayer(); Gesso.Embed.bump(l); Gesso.Embed.render(l, Gesso.app.doc); return Gesso.Embed.bounds(l); });
    assert(Math.abs(b1.x - b0.x - 60) <= 1 && Math.abs(b1.y - b0.y - 30) <= 1, 'moved by 60,30: ' + JSON.stringify([b0, b1]));
    await H.key('Control+z');
    const b2 = await H.ev(() => Gesso.Embed.bounds(Gesso.app.doc.activeLayer()));
    assert(Math.abs(b2.x - b0.x) <= 1, 'undo restored the position');
  });

  await H.step('Edit Contents opens the source in a new tab; painting there and Ctrl+S updates the object in the parent', async () => {
    await H.menu('Layer', 'Embedded Object', 'Edit Contents (Embedded Object)');
    await H.wait(300);
    let st = await H.state();
    assert(/contents/.test(st.name) && st.w >= 200, 'contents document ' + st.name + ' ' + st.w + '×' + st.h);
    await H.key('b');
    await H.ev(() => { const o = Gesso.Tools.byId.brush.opts; o.size = 40; o.hardness = 1; o.pressureSize = false; Gesso.App.setFg('#20c020'); });
    await H.dragDoc([[20, 100], [180, 100]]);
    await H.key('Control+s');
    await H.wait(300);
    // back to the parent
    await H.ev(() => Gesso.App.setActiveDoc(Gesso.app.docs[0]));
    await H.wait(200);
    st = await H.state();
    assert(st.name === 'Embed' && st.histName === 'Update Embedded Object', 'parent got an update step: ' + st.histName);
    const p = await H.px(300, 200); assert(p[1] > 150 && p[0] < 100, 'green stroke visible in the parent ' + p);
    await H.shot('c6-03-contents-updated');
  });

  await H.step('Save / reopen keeps the object editable (source + matrix); Rasterize Object drops it', async () => {
    const dl = page.waitForEvent('download');
    await H.key('Control+s');
    const d = await dl; const file = path.join(__dirname, 'downloads', 'c6-embed.kgesso'); await d.saveAs(file);
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const L = json.layers.find((l) => l.embed);
    assert(L && L.embed.source && L.embed.matrix.length === 6, 'embed serialized');
    const fc = page.waitForEvent('filechooser');
    await H.key('Control+o');
    await (await fc).setFiles(file);
    await H.wait(600);
    const info = await H.ev(() => { const l = Gesso.app.doc.allLayers().find((x) => x.embed); return { ok: !!l, src: l && l.embed.source.width }; });
    assert(info.ok && info.src >= 200, 'reopened as embedded object');
    await H.ev(() => { const d = Gesso.app.doc; d.setActive(d.allLayers().find((x) => x.embed).id); });
    await H.menu('Layer', 'Embedded Object', 'Rasterize Object');
    await H.wait(150);
    assert(!(await H.ev(() => !!Gesso.app.doc.activeLayer().embed)), 'rasterized');
    await H.key('Control+z');
    assert(await H.ev(() => !!Gesso.app.doc.activeLayer().embed), 'undo restores the object');
  });

  await H.finish();
})();
