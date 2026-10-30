// Pass 3 — History Brush, Color Replacement brush, Make Seamless filter, Palette panel
const { launch, assert } = require('../pass2/lib');
(async () => {
  const H = await launch();
  const { page } = H;
  await H.ev(() => {
    const S = window.Gesso, d = S.App.createDoc({ name: 'BR', w: 300, h: 200, dpi: 72, bg: 'white' });
    const x = d.layers[0].canvas.getContext('2d'); x.fillStyle = '#2060c0'; x.fillRect(40, 40, 100, 120); x.fillStyle = '#e0a000'; x.fillRect(160, 40, 100, 120); d.bump(d.layers[0]);
  });
  await H.wait(200);
  await H.step('tools, filter and panel registered', async () => {
    const r = await H.ev(() => ({ hb: !!Gesso.Tools.byId.historyBrush, cr: !!Gesso.Tools.byId.colorReplace, f: !!(ImageFX.filters.makeSeamless), p: !!Gesso.Panels.defs.palette }));
    assert(r.hb && r.cr && r.f && r.p, JSON.stringify(r));
  });
  await H.step('Color Replacement: a stroke across both squares recolours only the blue one (sampled at the start)', async () => {
    await H.ev(() => { Gesso.App.setFg('#d02020'); Gesso.Tools.select('colorReplace'); const t = Gesso.app.tool; t.opts.size = 30; t.opts.tolerance = 25; t.opts.sampling = 'once'; t.opts.hardness = 1; });
    await H.dragDoc([[60, 100], [240, 100]], { steps: 30 });
    const r = await H.ev(() => { const d = Gesso.app.doc, x = d.layers[0].canvas.getContext('2d'); const px = (X, Y) => Array.from(x.getImageData(X - (d.layers[0].canvas.ox || 0), Y - (d.layers[0].canvas.oy || 0), 1, 1).data).slice(0, 3); return { blueNow: px(90, 100), yellowNow: px(210, 100), blueFar: px(90, 50), white: px(150, 100) }; });
    assert(r.blueNow[0] > 120 && r.blueNow[2] < 120, 'blue became reddish: ' + JSON.stringify(r.blueNow));
    assert(r.yellowNow[0] > 200 && r.yellowNow[1] > 140 && r.yellowNow[2] < 60, 'yellow untouched: ' + JSON.stringify(r.yellowNow));
    assert(r.blueFar[2] > 150, 'blue outside the stroke untouched');
    assert(r.white[0] > 240 && r.white[1] > 240, 'white gap untouched: ' + JSON.stringify(r.white));
  });
  await H.step('History Brush paints the opened state back over the recoloured area', async () => {
    await H.ev(() => { Gesso.Tools.select('historyBrush'); const t = Gesso.app.tool; t.opts.size = 40; t.opts.source = 'open'; t.opts.hardness = 1; t.opts.opacity = 100; });
    await H.dragDoc([[60, 100], [120, 100]], { steps: 20 });
    const r = await H.ev(() => { const d = Gesso.app.doc, x = d.layers[0].canvas.getContext('2d'); const px = (X, Y) => Array.from(x.getImageData(X - (d.layers[0].canvas.ox || 0), Y - (d.layers[0].canvas.oy || 0), 1, 1).data).slice(0, 3); return { restored: px(90, 100), name: d.history.entries[d.history.index].name }; });
    assert(r.restored[2] > 150 && r.restored[0] < 80, 'blue restored: ' + JSON.stringify(r.restored));
  });
  await H.step('Make Seamless: the left/right and top/bottom edges of the result match', async () => {
    const r = await H.ev(() => {
      const S = window.Gesso, c = S.util.createCanvas(120, 80), x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 120, 80); g.addColorStop(0, '#000'); g.addColorStop(1, '#fff'); x.fillStyle = g; x.fillRect(0, 0, 120, 80);
      const img = x.getImageData(0, 0, 120, 80), out = ImageFX.apply('makeSeamless', img, { blend: 30 });
      let eLR = 0, eTB = 0; for (let y = 0; y < 80; y++) { const a = (y * 120) * 4, b = (y * 120 + 119) * 4; eLR += Math.abs(out.data[a] - out.data[b]); } for (let xx = 0; xx < 120; xx++) { const a = xx * 4, b = (79 * 120 + xx) * 4; eTB += Math.abs(out.data[a] - out.data[b]); }
      let oLR = 0; for (let y = 0; y < 80; y++) { const a = (y * 120) * 4, b = (y * 120 + 119) * 4; oLR += Math.abs(img.data[a] - img.data[b]); }
      return { eLR: eLR / 80, eTB: eTB / 120, oLR: oLR / 80 };
    });
    assert(r.eLR < 12 && r.eTB < 12 && r.oLR > 150, JSON.stringify(r));
  });
  await H.step('Palette panel extracts the dominant colours and sets the foreground on click', async () => {
    await H.ev(() => { Gesso.Panels.show('palette'); });
    await H.wait(200);
    await page.locator('.palette-panel .btn', { hasText: 'Extract' }).click(); await H.wait(300);
    const sw = await page.locator('.palette-sw').count();
    assert(sw >= 3, 'swatches ' + sw);
    const hexes = await page.locator('.palette-sw span').allInnerTexts();
    const has = (want) => hexes.some((h) => { const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16); return Math.abs(r - want[0]) < 40 && Math.abs(g - want[1]) < 40 && Math.abs(b - want[2]) < 40; });
    assert(has([255, 255, 255]) && has([0xe0, 0xa0, 0]) && has([0x20, 0x60, 0xc0]), 'white, yellow and blue found in ' + hexes.join(' '));
    await page.locator('.palette-sw').first().click();
    const fg = await H.ev(() => Gesso.app.fg);
    assert(hexes.map((h) => h.toLowerCase()).includes(fg.toLowerCase()), 'fg set to a swatch: ' + fg);
  });
  await H.finish();
})();
