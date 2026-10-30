// Hands-on session 6: adjustment layers (curves/levels), filters + repeat, zoom/pan/navigator, rulers/guides/grid/snap, history.
const { launch, assert, near, ASSETS } = require('./lib');
const path = require('path');

(async () => {
  const H = await launch();
  const { page } = H;
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
  await fc.setFiles(path.join(ASSETS, 'face.jpg'));
  await H.wait(700);
  const tab = async (title) => { await page.locator('.dock-tabs .tab[title="' + title + '"]').first().click(); await H.wait(150); };

  await H.step('Curves adjustment layer from the Adjustments panel; drag a point', async () => {
    await tab('Adjustments');
    await page.locator('.panel-adjustments .adj-btn[title="Curves"]').click();
    await H.wait(300);
    const st = await H.state(); assert(st.activeType === 'adjustment', st.activeType);
    const cv = page.locator('.panel-properties canvas.curve-canvas');
    const b = await cv.boundingBox();
    const p0 = await H.px(600, 300);
    // drag the midpoint of the diagonal upwards (brighten)
    await H.dragScreen([[b.x + b.width / 2, b.y + b.height / 2], [b.x + b.width / 2, b.y + b.height * 0.25]], { steps: 8 });
    const p1 = await H.px(600, 300);
    assert(p1[0] > p0[0] + 10, 'curves did not brighten ' + p0 + ' → ' + p1);
    await H.shot('s6-01-curves');
  });

  await H.step('Levels adjustment layer; drag the black input handle', async () => {
    await tab('Adjustments');
    await page.locator('.panel-adjustments .adj-btn[title="Levels"]').click();
    await H.wait(300);
    const h = page.locator('.panel-properties .lv-in .lv-h.black');
    const tr = await page.locator('.panel-properties .lv-in').boundingBox();
    const hb = await h.boundingBox();
    await H.dragScreen([[hb.x + hb.width / 2, hb.y + hb.height / 2], [tr.x + tr.width * 0.3, hb.y + hb.height / 2]], { steps: 8 });
    const v = await H.ev(() => Gesso.app.doc.activeLayer().adj.params);
    const s = JSON.stringify(v);
    assert(/"inBlack":(\d+)/.test(s) && +s.match(/"inBlack":(\d+)/)[1] > 40, s.slice(0, 160));
    await H.shot('s6-02-levels');
  });

  await H.step('filter with live preview from the Filter menu, then repeat last filter', async () => {
    await page.locator('.layer-row', { hasText: 'Background' }).click();
    const cats = await H.ev(() => Object.values(ImageFX.filters).filter((f) => f.params.length).map((f) => [f.category, f.name]).slice(0, 40));
    const blur = cats.find((c) => /gaussian/i.test(c[1])) || cats[0];
    await H.menu('Filter', blur[0], blur[1] + '…');
    await H.wait(500);
    await H.shot('s6-03-filter-dialog');
    assert(await H.dialogOpen(), 'filter dialog');
    const rng = page.locator('.gesso-dialog input[type=range]').first();
    const rb = await rng.boundingBox();
    await page.mouse.click(rb.x + rb.width * 0.4, rb.y + rb.height / 2);
    await H.wait(600);
    await H.shot('s6-04-filter-preview');
    await H.dialogBtn('OK');
    await H.wait(300);
    const n1 = await H.ev(() => Gesso.app.doc.history.entries[Gesso.app.doc.history.index].name);
    assert(n1 === blur[1], n1);
    await H.key('Control+Alt+f');
    await H.wait(500);
    const idx = await H.ev(() => Gesso.app.doc.history.entries.slice(-2).map((e) => e.name));
    assert(idx[0] === blur[1] && idx[1] === blur[1], JSON.stringify(idx));
  });

  await H.step('zoom: Ctrl+wheel, Ctrl+0, Ctrl+1, zoom tool click & Alt-click', async () => {
    const z0 = (await H.state()).zoom;
    const c = await H.pt(600, 400);
    await page.mouse.move(c[0], c[1]);
    await page.keyboard.down('Control'); await page.mouse.wheel(0, -300); await page.keyboard.up('Control');
    await H.wait(150);
    const z1 = (await H.state()).zoom;
    assert(z1 > z0 * 1.3, 'ctrl+wheel ' + z0 + ' → ' + z1);
    const c2 = await H.pt(600, 400);
    assert(Math.abs(c2[0] - c[0]) < 3 && Math.abs(c2[1] - c[1]) < 3, 'zoom not anchored at cursor');
    await H.key('Control+1'); assert((await H.state()).zoom === 1, '100%');
    await H.key('Control+0');
    const zf = (await H.state()).zoom;
    await H.key('z');
    await H.clickDoc(300, 300);
    const zz = (await H.state()).zoom; assert(zz > zf, 'zoom tool in');
    await H.clickDoc(300, 300, { mods: ['Alt'] });
    assert((await H.state()).zoom < zz, 'zoom tool out');
    await H.shot('s6-05-zoom');
  });

  await H.step('pan: space-drag and hand tool; navigator drag', async () => {
    await H.key('Control+1');
    const p0 = await H.ev(() => [Gesso.app.doc.view.panX, Gesso.app.doc.view.panY]);
    const c = await H.pt(600, 400);
    await page.keyboard.down('Space');
    await H.dragScreen([[c[0], c[1]], [c[0] + 150, c[1] + 60]], { steps: 6 });
    await page.keyboard.up('Space');
    const p1 = await H.ev(() => [Gesso.app.doc.view.panX, Gesso.app.doc.view.panY]);
    assert(Math.abs(p1[0] - p0[0] - 150) < 3 && Math.abs(p1[1] - p0[1] - 60) < 3, 'space pan ' + p0 + ' → ' + p1);
    await H.key('h');
    await H.dragScreen([[c[0], c[1]], [c[0] - 100, c[1]]], { steps: 6 });
    const p2 = await H.ev(() => [Gesso.app.doc.view.panX, Gesso.app.doc.view.panY]);
    assert(Math.abs(p2[0] - p1[0] + 100) < 3, 'hand pan');
    await tab('Navigator');
    const nav = page.locator('.panel-navigator canvas').first();
    const nb = await nav.boundingBox();
    if (nb) {
      await H.dragScreen([[nb.x + nb.width / 2, nb.y + nb.height / 2], [nb.x + nb.width * 0.2, nb.y + nb.height * 0.3]], { steps: 6 });
      const p3 = await H.ev(() => [Gesso.app.doc.view.panX, Gesso.app.doc.view.panY]);
      console.log('     navigator pan', p2, '→', p3);
      assert(p3[0] !== p2[0], 'navigator drag did nothing');
    }
    await H.shot('s6-06-pan');
    await H.key('Control+0');
  });

  await H.step('rulers: drag a guide out; grid toggle; snap a shape to the guide', async () => {
    const vr = await page.locator('#ruler-v').boundingBox();
    const g = await H.pt(400, 300);
    await H.dragScreen([[vr.x + vr.width / 2, g[1]], [g[0], g[1]]], { steps: 10 });
    const guides = await H.ev(() => Gesso.app.doc.guides);
    assert(guides.length === 1 && guides[0].dir === 'v' && Math.abs(guides[0].pos - 400) <= 2, JSON.stringify(guides));
    await H.key("Control+'");
    assert(await H.ev(() => Gesso.View.showGrid), 'grid on');
    await H.shot('s6-07-guide-grid');
    await H.key("Control+'");
    await page.locator('.layers-bottom .icon-btn[data-tip^="New layer"]').click();
    await H.tool('rect');
    await H.dragDoc([[404, 500], [600, 650]], { steps: 8 });
    const sx = await H.ev(() => Gesso.app.doc.activeLayer().shape.x);
    const gp = await H.ev(() => Gesso.app.doc.guides[0].pos);
    assert(sx === gp, 'shape did not snap to guide: x ' + sx + ' guide ' + gp);
    await H.shot('s6-08-snap');
  });

  await H.step('undo / redo with keys and History panel clicks', async () => {
    const n = await H.ev(() => Gesso.app.doc.history.index);
    await H.key('Control+z', 3);
    let i = await H.ev(() => Gesso.app.doc.history.index); assert(i === n - 3, 'undo3 ' + i);
    await H.key('Control+Shift+z', 2);
    i = await H.ev(() => Gesso.app.doc.history.index); assert(i === n - 1, 'redo2 ' + i);
    await tab('History');
    const rows = page.locator('.panel-history .hist-row, .panel-history .history-row, .panel-history [data-index]');
    const cnt = await rows.count();
    console.log('     history rows', cnt);
    assert(cnt > 3, 'no history rows found');
    await rows.nth(1).click();
    i = await H.ev(() => Gesso.app.doc.history.index); assert(i === 1, 'history click → ' + i);
    await rows.nth(cnt - 1).click();
    i = await H.ev(() => Gesso.app.doc.history.index); assert(i === n, 'history click last → ' + i);
    await H.wait(400);
    await H.shot('s6-09-history');
  });

  await H.finish();
})();
