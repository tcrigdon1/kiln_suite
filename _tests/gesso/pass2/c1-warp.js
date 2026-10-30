// Part C1: Warp tool — push / twirl / bloat / pinch / reconstruct, in-session undo, mesh, commit & cancel.
const { launch, assert, near, ASSETS } = require('./lib');
const path = require('path');

(async () => {
  const H = await launch();
  const { page } = H;
  await H.ev(() => Gesso.App.createDoc({ name: 'Warp', w: 600, h: 400, dpi: 72, bg: 'white' }));
  await H.wait(200);
  // a crisp vertical black bar on its own layer: easy to see where pixels went
  await H.key('Control+Shift+n');
  await H.ev(() => { Gesso.Tools.select('pencil'); Object.assign(Gesso.Tools.byId.pencil.opts, { size: 20, opacity: 100 }); Gesso.App.setFg('#000000'); });
  await H.dragDoc([[300, 60], [300, 340]]);
  const hist = () => H.ev(() => Gesso.app.doc.history.entries.map((e) => e.name));
  let darkX;

  await H.step('Y selects Warp; Push drags the bar sideways live; Enter commits one "Warp" history step', async () => {
    await H.key('y');
    assert((await H.state()).tool === 'warp', 'warp tool');
    await H.ev(() => Object.assign(Gesso.Tools.byId.warp.opts, { mode: 'push', size: 120, strength: 100, hardness: 0.5, mesh: true }));
    await H.dragDoc([[300, 200], [380, 200]], { steps: 16 });
    darkX = (y) => H.ev((y) => { const d = Gesso.app.doc; Gesso.Compositor.update(d); let best = -1, bv = 255; for (let x = 200; x < 500; x++) { const v = Gesso.util.samplePixels(d.composite, x, y)[0]; if (v < bv) { bv = v; best = x; } } return bv < 128 ? best : -1; }, y);
    let p = await H.px(300, 200), q = await darkX(200);
    assert(p[0] > 200 && q > 330, 'bar pushed right at y=200: centre now ' + p + ', darkest x = ' + q);
    const top = await H.px(300, 80); assert(top[0] < 80, 'far from the brush the bar stays ' + top);
    await H.shot('c1-01-push-mesh');
    const h0 = (await hist()).length;
    await H.key('Enter');
    const h = await hist();
    assert(h.length === h0 + 1 && h[h.length - 1] === 'Warp', 'one Warp entry ' + JSON.stringify(h.slice(-2)));
    q = await darkX(200); assert(q > 330, 'committed result darkest x = ' + q);
    await H.key('Control+z');
    p = await H.px(300, 200); assert(p[0] < 80, 'undo restores the straight bar ' + p);
    await H.key('Control+Shift+z');
  });

  await H.step('Ctrl+Z inside the session undoes the last stroke only; Esc cancels the whole session', async () => {
    await H.ev(() => Object.assign(Gesso.Tools.byId.warp.opts, { mode: 'push' }));
    await H.dragDoc([[300, 300], [240, 300]], { steps: 12 }); // stroke 1: push the lower part left (bar at x≈300)
    await H.dragDoc([[300, 100], [400, 100]], { steps: 12 }); // stroke 2: push the upper part right
    let a = await darkX(100); assert(a > 340, 'stroke 2 applied, darkest x = ' + a);
    await H.key('Control+z');
    a = await darkX(100); assert(a >= 290 && a <= 312, 'stroke 2 undone (bar back at x≈300 there) ' + a);
    const b = await darkX(300); assert(b < 290, 'stroke 1 still there ' + b);
    assert(await H.ev(() => !!Gesso.Tools.byId.warp.session), 'session still open');
    await H.key('Escape');
    assert(!(await H.ev(() => !!Gesso.Tools.byId.warp.session)), 'session closed');
    const c = await darkX(300); assert(c >= 290 && c <= 310, 'cancel restored the committed layer ' + c);
    const s = await H.state(); assert(s.histName === 'Warp', 'history unchanged by the cancelled session');
  });

  await H.step('Twirl, Bloat, Pinch and Reconstruct behave as named', async () => {
    await H.key('Control+z'); // back to the straight bar
    await H.ev(() => Object.assign(Gesso.Tools.byId.warp.opts, { mode: 'twirl', size: 160, strength: 100, mesh: false }));
    for (let i = 0; i < 6; i++) await H.dragDoc([[300, 200], [301, 200]], { steps: 2, after: 30 });
    const t1 = await H.px(300, 200), t2 = await darkX(170), t3 = await darkX(230);
    console.log('     twirl centre', t1, 'darkest x at y=170:', t2, 'at y=230:', t3);
    assert(Math.abs(t2 - 300) > 12 && Math.abs(t3 - 300) > 12 && Math.sign(t2 - 300) !== Math.sign(t3 - 300), 'bar twisted into an S around the centre');
    await H.key('Escape');
    await H.ev(() => Object.assign(Gesso.Tools.byId.warp.opts, { mode: 'bloat', size: 160 }));
    for (let i = 0; i < 6; i++) await H.dragDoc([[300, 200], [301, 200]], { steps: 2, after: 30 });
    const w = await H.ev(() => { let n = 0; for (let x = 250; x < 350; x++) if (Gesso.util.samplePixels(Gesso.app.doc.composite, x, 200)[0] < 128) n++; return n; });
    assert(w > 24, 'bloat widened the bar to ' + w + ' px');
    await H.shot('c1-02-bloat');
    await H.ev(() => Object.assign(Gesso.Tools.byId.warp.opts, { mode: 'pinch' }));
    for (let i = 0; i < 6; i++) await H.dragDoc([[300, 200], [301, 200]], { steps: 2, after: 30 });
    const w2 = await H.ev(() => { let n = 0; for (let x = 250; x < 350; x++) if (Gesso.util.samplePixels(Gesso.app.doc.composite, x, 200)[0] < 128) n++; return n; });
    assert(w2 < w, 'pinch narrowed it again ' + w2);
    await H.ev(() => Object.assign(Gesso.Tools.byId.warp.opts, { mode: 'reconstruct', size: 220 }));
    for (let i = 0; i < 20; i++) await H.dragDoc([[300, 200], [301, 200]], { steps: 2, after: 10 });
    const w3 = await H.ev(() => { let n = 0; for (let x = 250; x < 350; x++) if (Gesso.util.samplePixels(Gesso.app.doc.composite, x, 200)[0] < 128) n++; return n; });
    assert(Math.abs(w3 - 20) <= 4, 'reconstruct brings the bar back to ~20 px (' + w3 + ')');
    await H.key('Enter');
  });

  await H.step('warp on a text layer offers to rasterize; pushing past the canvas edge keeps pixels (layer grows)', async () => {
    await H.key('t'); await H.clickDoc(100, 300); await page.keyboard.type('Wavy'); await H.key('Escape');
    await H.key('y');
    await H.dragDoc([[110, 290], [140, 290]]);
    await H.wait(200);
    assert(await H.dialogOpen(), 'rasterize prompt');
    await H.dialogBtn('Rasterize');
    await H.wait(150);
    assert((await H.state()).activeType === 'raster', 'rasterized');
    await H.ev(() => Object.assign(Gesso.Tools.byId.warp.opts, { mode: 'push', size: 200, strength: 100 }));
    await H.dragDoc([[120, 300], [-60, 300]], { steps: 20 });
    const r = await H.ev(() => Gesso.util.rectOf(Gesso.app.doc.activeLayer().canvas));
    assert(r.x < 0, 'layer canvas grew past the left edge ' + JSON.stringify(r));
    await H.key('Enter');
    const cr = await H.ev(() => Gesso.Layers.contentRect(Gesso.app.doc.activeLayer()));
    assert(cr && cr.x < 0, 'content kept outside the document ' + JSON.stringify(cr));
    await H.shot('c1-03-text-warped');
  });

  await H.step('Freeze protects an area from pushing (red tint shown); Thaw all releases it', async () => {
    await H.key('Control+z'); await H.key('Control+z'); // make sure the bar is straight (undo earlier warps if any)
    await H.ev(() => { const d = Gesso.app.doc; d.setActive(d.allLayers().find((l) => l.name === 'Layer 1').id); Gesso.Tools.select('warp'); Object.assign(Gesso.Tools.byId.warp.opts, { mode: 'freeze', size: 140, strength: 100, hardness: 1, showFreeze: true }); });
    const darkW = (y) => H.ev((y) => { const d = Gesso.app.doc; Gesso.Compositor.update(d); let best = -1, bv = 255; for (let x = 200; x < 600; x++) { const v = Gesso.util.samplePixels(d.composite, x, y)[0]; if (v < bv) { bv = v; best = x; } } return bv < 128 ? best : -1; }, y);
    const x0 = await darkW(120); assert(x0 > 0, 'bar visible ' + x0);
    await H.dragDoc([[300, 100], [300, 140]], { steps: 6 });
    const fz = await H.ev(() => { const s = Gesso.WarpTool.session; let n = 0; for (let i = 0; i < s.freeze.length; i++) if (s.freeze[i] > 0.5) n++; return n; });
    assert(fz > 2000, 'frozen pixels ' + fz);
    await H.shot('c1-04-frozen');
    await H.ev(() => { Gesso.Tools.byId.warp.opts.mode = 'push'; Gesso.Tools.byId.warp.opts.strength = 40; });
    await H.dragDoc([[300, 120], [340, 120]], { steps: 8 });
    const frozenX = await darkW(120);
    assert(Math.abs(frozenX - x0) <= 3, 'frozen part did not move (' + x0 + ' → ' + frozenX + ')');
    await H.dragDoc([[300, 235], [340, 235]], { steps: 8 });
    const moved = await darkW(235);
    assert(moved > x0 + 15, 'unfrozen part moves (' + x0 + ' → ' + moved + ')');
    await page.locator('#optionsbar button', { hasText: 'Thaw all' }).click();
    await H.dragDoc([[300, 120], [340, 120]], { steps: 8 });
    const after = await darkW(120);
    assert(after > x0 + 15, 'after Thaw all the area moves again (' + x0 + ' → ' + after + ')');
    await H.key('Escape');
  });

  await H.finish();
})();
