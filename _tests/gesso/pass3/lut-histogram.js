// Pass 3 — Color Look export (.cube LUT / HALD PNG) and the Histogram panel.
//   • identity document → identity .cube (every sample equals its lattice coordinate within 1/255)
//   • Hue/Saturation adjustment layer → .cube parses (header, N³ lines, values 0..1) and is not identity;
//     opacity mixes the result; hidden layers are skipped; "above the active layer" / "this layer only" sources
//   • HALD level 8 → 512 × 512 PNG whose corners match the baked lattice
//   • dialog opened from the File menu downloads a file
//   • Histogram panel: luminosity / RGB / channels, stats, clipping, log scale, selection-aware, hover read-out,
//     stride sampling on a large document, deferred while a brush stroke is live
const { launch, assert } = require('../pass2/lib');
const path = require('path');
const fs = require('fs');
const DL = path.join(__dirname, 'downloads'); fs.mkdirSync(DL, { recursive: true });

function parseCube(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  const head = {}, data = [];
  for (const l of lines) {
    const m = /^(TITLE|LUT_3D_SIZE|DOMAIN_MIN|DOMAIN_MAX)\s+(.*)$/.exec(l);
    if (m) head[m[1]] = m[2];
    else data.push(l.trim().split(/\s+/).map(Number));
  }
  return { head, data };
}

(async () => {
  const H = await launch();
  const { page } = H;
  await H.ev(() => Gesso.App.createDoc({ name: 'Look', w: 400, h: 300, dpi: 72, bg: 'white' }));
  await H.wait(200);

  await H.step('commands and menu items are registered; the Histogram panel exists', async () => {
    const r = await H.ev(() => ({
      lut: !!Gesso.Cmd.get('file.exportLut'), hald: !!Gesso.Cmd.get('file.exportHald'), en: Gesso.Cmd.get('file.exportLut').enabled(),
      panel: !!Gesso.Panels.defs.histogram, api: !!(Gesso.LUT && Gesso.LUT.lattice && Gesso.LUT.bake && Gesso.LUT.cubeText && Gesso.LUT.haldCanvas),
      palette: Gesso.Palette.items().filter((i) => /Color Look/.test(i.label)).length,
    }));
    assert(r.lut && r.hald && r.en && r.panel && r.api, JSON.stringify(r));
    assert(r.palette === 2, 'both commands in the command palette: ' + r.palette);
    await H.menu('File', 'Export');
    const items = await page.locator('.gesso-menu').nth(1).locator('.item').allTextContents();
    assert(items.some((t) => /Color Look \(\.cube LUT\)/.test(t)) && items.some((t) => /HALD/.test(t)), 'submenu items: ' + items.join(' | '));
    await H.key('Escape');
  });

  await H.step('identity document → identity 17³ and 33³ LUTs (every sample equals its lattice coordinate within 1/255)', async () => {
    for (const n of [17, 33]) {
      const text = await H.ev((n) => { const L = Gesso.LUT, d = Gesso.app.doc, e = L.layersFor(d, 'all'); return L.cubeText(L.bake(L.lattice(n), e), n, 'Identity', e); }, n);
      const { head, data } = parseCube(text);
      assert(head.TITLE === '"Identity"', 'title ' + head.TITLE);
      assert(+head.LUT_3D_SIZE === n, 'size ' + head.LUT_3D_SIZE);
      assert(head.DOMAIN_MIN === '0 0 0' && head.DOMAIN_MAX === '1 1 1', 'domain');
      assert(data.length === n * n * n, 'line count ' + data.length + ' != ' + n * n * n);
      let maxErr = 0;
      for (let i = 0; i < data.length; i++) {
        const r = i % n, g = Math.floor(i / n) % n, b = Math.floor(i / (n * n));
        const exp = [r / (n - 1), g / (n - 1), b / (n - 1)];
        for (let c = 0; c < 3; c++) { assert(data[i][c] >= 0 && data[i][c] <= 1, 'range'); maxErr = Math.max(maxErr, Math.abs(data[i][c] - exp[c])); }
      }
      assert(maxErr <= 1 / 255 + 1e-6, 'identity max error ' + maxErr + ' for n=' + n);
      // red varies fastest: the second line is one red step up
      assert(Math.abs(data[1][0] - 1 / (n - 1)) < 1 / 255 && data[1][1] === 0 && data[1][2] === 0, 'red fastest: ' + data[1]);
    }
  });

  await H.step('Hue/Saturation adjustment layer → valid non-identity LUT that matches ImageFX on sample colours', async () => {
    await H.ev(() => { Gesso.Cmd.run('layer.newAdjustment', 'hueSaturation'); const d = Gesso.app.doc, l = d.activeLayer(); d.commit('hue', () => { l.adj.params.hue = 120; l.adj.params.saturation = 20; l.version++; }); });
    await H.wait(150);
    const r = await H.ev(() => {
      const L = Gesso.LUT, d = Gesso.app.doc, e = L.layersFor(d, 'all'), n = 33;
      const text = L.cubeText(L.bake(L.lattice(n), e), n, d.name, e);
      // reference: run a pure red / mid-grey / sky-blue pixel through ImageFX directly
      const img = new ImageData(3, 1); img.data.set([255, 0, 0, 255, 128, 128, 128, 255, 64, 128, 255, 255]);
      const ref = Array.from(ImageFX.apply('hueSaturation', img, d.activeLayer().adj.params).data);
      return { text, ref, layers: e.length, run: L.runnable(e).length, approx: L.isApprox(d.activeLayer()) };
    });
    assert(r.layers === 1 && r.run === 1 && !r.approx, 'one runnable point adjustment ' + JSON.stringify([r.layers, r.run, r.approx]));
    const { head, data } = parseCube(r.text);
    assert(head.TITLE === '"Look"' && +head.LUT_3D_SIZE === 33 && data.length === 33 ** 3, 'header/lines');
    let bad = 0, moved = 0;
    for (let i = 0; i < data.length; i++) {
      const [a, b, c] = data[i];
      if (!(a >= 0 && a <= 1 && b >= 0 && b <= 1 && c >= 0 && c <= 1) || [a, b, c].some((v) => Number.isNaN(v))) bad++;
      const r0 = (i % 33) / 32, g0 = (Math.floor(i / 33) % 33) / 32, b0 = Math.floor(i / 1089) / 32;
      if (Math.abs(a - r0) + Math.abs(b - g0) + Math.abs(c - b0) > 0.05) moved++;
    }
    assert(bad === 0, bad + ' out-of-range values');
    assert(moved > data.length / 4, 'hue rotation moved most colours (' + moved + ')');
    // exact lattice nodes: pure red (32,0,0), mid grey (16,16,16), (8,16,32)
    const at = (r, g, b) => data[r + 33 * g + 1089 * b].map((v) => Math.round(v * 255));
    const near = (p, q, t) => p.every((v, i) => Math.abs(v - q[i]) <= t);
    assert(near(at(32, 0, 0), r.ref.slice(0, 3), 3), 'red node ' + at(32, 0, 0) + ' vs ' + r.ref.slice(0, 3));
    // grey (input 127/128 after 8-bit quantisation) stays grey-ish under a hue rotation
    const grey = at(16, 16, 16); assert(Math.abs(grey[0] - grey[1]) <= 2 && Math.abs(grey[1] - grey[2]) <= 2, 'grey stays neutral ' + grey);
    assert(near(at(8, 16, 32), r.ref.slice(8, 11), 4), 'blue node ' + at(8, 16, 32) + ' vs ' + r.ref.slice(8, 11));
    // "red fastest" also holds for the baked table: neighbouring lines differ only through the red input
    assert(/^TITLE "Look"\n#[^\n]*\nLUT_3D_SIZE 33\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n/.test(r.text), 'header order');
  });

  await H.step('layer opacity mixes the look; hidden layers are skipped; source "above" / "this" filters', async () => {
    const r = await H.ev(() => {
      const L = Gesso.LUT, d = Gesso.app.doc, hue = d.activeLayer();
      const probe = () => { const img = new ImageData(1, 1); img.data.set([255, 0, 0, 255]); return Array.from(L.bake(img, L.layersFor(d, 'all')).data.slice(0, 3)); };
      const full = probe();
      hue.opacity = 0.5; const half = probe();
      hue.opacity = 1; hue.visible = false; const hidden = probe(); hue.visible = true;
      // a second adjustment (Invert) below the hue layer, and a group with a hidden adjustment on top
      const inv = Gesso.Layers.adjustment(d, 'invert'); d.layers.splice(1, 0, inv);
      const g = Gesso.Layers.group(d); const th = Gesso.Layers.adjustment(d, 'threshold'); th.visible = false; g.children.push(th); d.layers.push(g);
      const order = L.layersFor(d, 'all').map((e) => e.layer.adj.id + (e.visible ? '' : '(hidden)'));
      d.activeId = inv.id; const above = L.layersFor(d, 'above').map((e) => e.layer.adj.id);
      d.activeId = hue.id; const above2 = L.layersFor(d, 'above').map((e) => e.layer.adj.id), thisOnly = L.layersFor(d, 'this').map((e) => e.layer.adj.id);
      d.activeId = d.layers[0].id; const aboveBg = L.layersFor(d, 'above').map((e) => e.layer.adj.id);
      const chain = probe(); // invert then hue on red
      // reference for the chain: invert red → cyan, then hue/sat
      const i1 = new ImageData(1, 1); i1.data.set([255, 0, 0, 255]);
      const ref = Array.from(ImageFX.apply('hueSaturation', ImageFX.apply('invert', i1, {}), hue.adj.params).data.slice(0, 3));
      // clean up: drop the extra layers again
      d.layers.splice(d.layers.indexOf(inv), 1); d.layers.splice(d.layers.indexOf(g), 1); d.activeId = hue.id; d.invalidate();
      return { full, half, hidden, order, above, above2, thisOnly, aboveBg, chain, ref };
    });
    assert(r.hidden.join() === '255,0,0', 'hidden layer skipped ' + r.hidden);
    for (let c = 0; c < 3; c++) assert(Math.abs(r.half[c] - (255 * (c === 0) + (r.full[c] - 255 * (c === 0)) * 0.5)) <= 1.5, 'opacity 50 % mixes: ' + r.half + ' vs full ' + r.full);
    assert(r.order.join() === 'invert,hueSaturation,threshold(hidden)', 'bottom → top order incl. groups: ' + r.order);
    assert(r.above.join() === 'hueSaturation,threshold', 'above invert: ' + r.above);
    assert(r.above2.join() === 'threshold' && r.thisOnly.join() === 'hueSaturation', 'above hue / this: ' + r.above2 + ' / ' + r.thisOnly);
    assert(r.aboveBg.join() === 'invert,hueSaturation,threshold', 'above background = all: ' + r.aboveBg);
    assert(r.chain.every((v, i) => Math.abs(v - r.ref[i]) <= 1), 'chain invert → hue matches ImageFX: ' + r.chain + ' vs ' + r.ref);
  });

  await H.step('HALD level 8 renders a 512 × 512 image whose nodes match the baked lattice', async () => {
    const r = await H.ev(() => {
      const L = Gesso.LUT, d = Gesso.app.doc, e = L.layersFor(d, 'all');
      const c = L.haldCanvas(8, e), x = c.getContext('2d');
      const px = (i, j) => Array.from(x.getImageData(i, j, 1, 1).data.slice(0, 3));
      // identity reference pixels of the HALD layout (red fastest along x, 64 steps; green every 64 px; blue per 8 rows)
      const id = L.lattice(64, 512);
      const ref = (i, j) => { const k = (j * 512 + i) * 4; const im = new ImageData(1, 1); im.data.set([id.data[k], id.data[k + 1], id.data[k + 2], 255]); return Array.from(L.bake(im, e).data.slice(0, 3)); };
      const pts = [[0, 0], [63, 0], [511, 511], [200, 300], [64, 8], [5, 511]];
      return { w: c.width, h: c.height, pairs: pts.map(([i, j]) => [px(i, j), ref(i, j)]), idCorner: Array.from(id.data.slice(0, 3)), idLast: Array.from(id.data.slice(511 * 512 * 4 + 511 * 4, 511 * 512 * 4 + 511 * 4 + 3)), idG: Array.from(id.data.slice(64 * 4, 64 * 4 + 3)), idB: Array.from(id.data.slice(8 * 512 * 4, 8 * 512 * 4 + 3)) };
    });
    assert(r.w === 512 && r.h === 512, 'size ' + r.w + '×' + r.h);
    assert(r.idCorner.join() === '0,0,0' && r.idLast.join() === '255,255,255', 'identity corners ' + r.idCorner + ' / ' + r.idLast);
    assert(r.idG.join() === '0,4,0' && r.idB.join() === '0,0,4', 'HALD layout: green steps every 64 px, blue every 8 rows: ' + r.idG + ' / ' + r.idB);
    for (const [a, b] of r.pairs) assert(a.every((v, i) => Math.abs(v - b[i]) <= 1), 'hald pixel ' + a + ' vs ' + b);
  });

  await H.step('File ▸ Export ▸ Color Look dialog lists the layer and downloads <title>.cube', async () => {
    await H.menu('File', 'Export', 'Color Look (.cube LUT)…');
    assert(await H.dialogOpen(), 'dialog open');
    const chips = await page.locator('.gesso-dialog .lut-chip').allTextContents();
    assert(chips.length === 1 && /Hue\/Saturation/.test(chips[0]), 'chips ' + chips);
    assert(/masks, clipping, blend modes/.test(await page.locator('.gesso-dialog .lut-body').textContent()), 'limitation note');
    const srcOpts = await page.locator('.gesso-dialog select').nth(1).locator('option').allTextContents();
    assert(srcOpts.length === 3 && /This adjustment layer only/.test(srcOpts[2]), 'source options (active = adjustment): ' + srcOpts);
    await page.locator('.gesso-dialog select').first().selectOption('17');
    const title = page.locator('.gesso-dialog input[type=text]');
    await title.fill('My Look'); await title.dispatchEvent('input');
    await H.shot('p3-01-lut-dialog');
    const [dl] = await Promise.all([page.waitForEvent('download'), H.dialogBtn('Export')]);
    assert(dl.suggestedFilename() === 'My Look.cube', 'file name ' + dl.suggestedFilename());
    const f = path.join(DL, dl.suggestedFilename()); await dl.saveAs(f);
    const { head, data } = parseCube(fs.readFileSync(f, 'utf8'));
    assert(head.TITLE === '"My Look"' && +head.LUT_3D_SIZE === 17 && data.length === 17 ** 3, 'downloaded cube header ' + JSON.stringify(head) + ' lines ' + data.length);
    assert(data.every((l) => l.length === 3 && l.every((v) => v >= 0 && v <= 1)), 'values 0..1');
    assert(!(await H.dialogOpen()), 'dialog closed');
    // HALD dialog downloads a PNG
    await H.ev(() => Gesso.Cmd.run('file.exportHald'));
    await H.wait(200);
    const [dl2] = await Promise.all([page.waitForEvent('download'), H.dialogBtn('Export')]);
    assert(/^Look-hald8\.png$/.test(dl2.suggestedFilename()), 'hald name ' + dl2.suggestedFilename());
    const f2 = path.join(DL, dl2.suggestedFilename()); await dl2.saveAs(f2);
    const b = fs.readFileSync(f2);
    assert(b.readUInt32BE(16) === 512 && b.readUInt32BE(20) === 512, 'hald png 512×512');
  });

  /* ======================= Histogram panel ======================= */
  await H.step('Histogram panel shows the flattened document: white doc → all at 255, clipping 100 %, stats', async () => {
    await H.ev(() => { const d = Gesso.app.doc; d.commit('remove hue', () => { d.layers.splice(1, 1); d.activeId = d.layers[0].id; }); Gesso.Panels.show('histogram'); });
    await H.wait(500);
    const api = () => H.ev(() => { const a = Gesso.Panels.inst.histogram.api; a.recompute(); const h = a.hist; return { total: h.total, pixels: h.pixels, stride: h.stride, sel: h.selection, l255: h.l[255], r0: h.r[0] }; });
    const h = await api();
    assert(h.total === 400 * 300 && h.pixels === 120000 && h.stride === 1 && !h.sel && h.l255 === 120000 && h.r0 === 0, JSON.stringify(h));
    const txt = async (lab) => (await page.locator('.panel-histogram .hist-grid .muted', { hasText: new RegExp('^' + lab + '$') }).locator('xpath=following-sibling::span[1]').textContent()).trim();
    assert((await txt('Mean')) === '255.0' && (await txt('Std Dev')) === '0.0' && (await txt('Median')) === '255', 'stats ' + [await txt('Mean'), await txt('Std Dev'), await txt('Median')]);
    assert((await txt('Pixels')) === '120,000', 'pixels ' + (await txt('Pixels')));
    const clip = await page.locator('.panel-histogram .hist-clip').innerText();
    assert(/shadows 0\.00 %/.test(clip) && /highlights 100\.00 %/.test(clip) && /▲/.test(clip), 'clipping read-out ' + clip);
    const box0 = await page.locator('.panel-histogram .hist-grid').boundingBox(), gb = await page.locator('.panel-histogram').boundingBox();
    assert(box0 && gb && box0.y + box0.height <= gb.y + gb.height + 1, 'statistics fit in the default group height without scrolling: ' + JSON.stringify([box0, gb]));
    assert(await page.locator('.panel-histogram .hist-clip.warn').count(), 'highlight clipping warns');
    const cv = page.locator('.panel-histogram .hist-canvas');
    const box = await cv.boundingBox();
    assert(box && box.height >= 110 && box.height <= 130 && box.width > 150, 'canvas size ' + JSON.stringify(box));
    await H.shot('p3-02-histogram-white');
  });

  await H.step('channels, log scale and hover read-out (level / count / percentile)', async () => {
    // half black, half white + a grey stripe → known histogram
    await H.ev(() => {
      const d = Gesso.app.doc, l = d.layers[0], x = l.canvas.getContext('2d');
      d.commit('paint', () => { x.fillStyle = '#000'; x.fillRect(0, 0, 200, 300); x.fillStyle = '#808080'; x.fillRect(150, 0, 100, 300); l.version++; d.invalidate(); });
    });
    await H.wait(500);
    const h = await H.ev(() => { const a = Gesso.Panels.inst.histogram.api; a.recompute(); const h = a.hist; return { l0: h.l[0], l128: h.l[128], l255: h.l[255], total: h.total }; });
    assert(h.l0 === 150 * 300 && h.l128 === 100 * 300 && h.l255 === 150 * 300 && h.total === 120000, 'tri-level histogram ' + JSON.stringify(h));
    const txt = async (lab) => (await page.locator('.panel-histogram .hist-grid .muted', { hasText: new RegExp('^' + lab + '$') }).locator('xpath=following-sibling::span[1]').textContent()).trim();
    await page.locator('.panel-histogram select').selectOption('l');
    await H.wait(100);
    assert((await txt('Median')) === '128', 'median ' + (await txt('Median')));
    const mean = 0.375 * 0 + 0.25 * 128 + 0.375 * 255;
    assert(Math.abs(+(await txt('Mean')) - mean) < 0.1, 'mean ' + (await txt('Mean')) + ' vs ' + mean);
    const clip = await page.locator('.panel-histogram .hist-clip').innerText();
    assert(/shadows 37\.50 % · highlights 37\.50 % ▲/.test(clip), 'both ends clip 37.5 %: ' + clip);
    // hover: middle of the canvas ≈ level 128
    const cv = page.locator('.panel-histogram .hist-canvas'), box = await cv.boundingBox();
    const xAt = (lvl) => box.x + ((lvl + 0.5) / 256) * box.width;
    await page.mouse.move(xAt(128), box.y + box.height / 2); await H.wait(80);
    assert((await txt('Level')) === '128', 'level ' + (await txt('Level')));
    assert((await txt('Count')) === '30,000', 'count ' + (await txt('Count')));
    assert((await txt('Percentile')) === '62.5 %', 'percentile ' + (await txt('Percentile')));
    await page.mouse.move(xAt(0), box.y + 10); await H.wait(80);
    assert((await txt('Level')) === '0' && (await txt('Count')) === '45,000' && (await txt('Percentile')) === '37.5 %', 'level 0 read-out ' + [await txt('Level'), await txt('Count'), await txt('Percentile')]);
    await page.mouse.move(xAt(64), box.y + 10); await H.wait(80);
    assert((await txt('Count')) === '0' && (await txt('Percentile')) === '37.5 %', 'empty level ' + [await txt('Count'), await txt('Percentile')]);
    await page.mouse.move(10, 10); await H.wait(80);
    assert((await txt('Level')) === '—', 'read-out cleared on leave');
    // the drawn graph has three peaks: pixel columns at levels 0, 128 and 255 are lit, level 64 is background
    const lit = await H.ev(() => {
      const cv = document.querySelector('.panel-histogram .hist-canvas'), x = cv.getContext('2d'), dpr = devicePixelRatio || 1;
      const col = (lvl) => { const px = Math.round((lvl / 255) * (cv.width / dpr - 1) * dpr); const d = x.getImageData(Math.min(cv.width - 1, px), Math.round(cv.height * 0.5), 1, 1).data; return d[0] + d[1] + d[2]; };
      return { l128: col(128), l40: col(40), l200: col(200) };
    });
    assert(lit.l128 > lit.l40 + 100 && lit.l128 > lit.l200 + 100, 'level 128 column is drawn, 40 / 200 are background: ' + JSON.stringify(lit));
    // channel modes: Red channel of pure colours
    await page.locator('.panel-histogram select').selectOption('r'); await H.wait(100);
    assert((await txt('Median')) === '128', 'red median ' + (await txt('Median')));
    await page.locator('.panel-histogram select').selectOption('colors'); await H.wait(100);
    assert((await txt('Median')) === '128', 'RGB overlay uses luminosity for stats');
    // log scale toggles and persists
    await page.locator('.panel-histogram .hist-log input').check(); await H.wait(100);
    const persisted = await H.ev(() => [Gesso.store.get('histLog'), Gesso.store.get('histCh')]);
    assert(persisted[0] === true && persisted[1] === 'colors', 'persisted ' + persisted);
    await H.shot('p3-03-histogram-log');
    await page.locator('.panel-histogram .hist-log input').uncheck();
  });

  await H.step('with a selection the histogram covers the selected pixels only (weighted by the mask)', async () => {
    await H.ev(() => { const d = Gesso.app.doc; d.selection = Gesso.Sel.make(Gesso.Sel.rectMask(d.width, d.height, 0, 0, 100, 300), d.width, d.height); Gesso.bus.emit('selection:changed', d); });
    await H.wait(400);
    let h = await H.ev(() => { const a = Gesso.Panels.inst.histogram.api; const h = a.hist; return { sel: h.selection, total: h.total, l0: h.l[0], l255: h.l[255], pixels: h.pixels }; });
    assert(h.sel && h.total === 30000 && h.l0 === 30000 && h.l255 === 0, 'black part only ' + JSON.stringify(h));
    const txt = async (lab) => (await page.locator('.panel-histogram .hist-grid .muted', { hasText: new RegExp('^' + lab + '$') }).locator('xpath=following-sibling::span[1]').textContent()).trim();
    assert((await txt('Pixels')) === '30,000', 'pixels of the selection ' + (await txt('Pixels')));
    // a 50 % feathered-style mask weights pixels by half
    h = await H.ev(() => {
      const d = Gesso.app.doc, m = new Uint8ClampedArray(d.width * d.height);
      for (let y = 0; y < 300; y++) for (let x = 300; x < 400; x++) m[y * d.width + x] = 128;
      d.selection = Gesso.Sel.make(m, d.width, d.height);
      const a = Gesso.Panels.inst.histogram.api; a.recompute(); const h = a.hist; return { total: h.total, l255: h.l[255] };
    });
    assert(Math.abs(h.total - 30000 * 128 / 255) < 1 && Math.abs(h.l255 - h.total) < 1e-6, 'half-weighted white pixels ' + JSON.stringify(h));
    await H.ev(() => { const d = Gesso.app.doc; d.selection = null; Gesso.bus.emit('selection:changed', d); });
    await H.wait(400);
    h = await H.ev(() => { const h = Gesso.Panels.inst.histogram.api.hist; return { sel: h.selection, total: h.total }; });
    assert(!h.sel && h.total === 120000, 'back to the whole document ' + JSON.stringify(h));
  });

  await H.step('large documents are point-sampled (≤ ~1 M samples); recompute is deferred while a brush stroke is live', async () => {
    await H.ev(() => Gesso.App.createDoc({ name: 'Big', w: 3000, h: 2000, dpi: 72, bg: 'white' }));
    await H.wait(600);
    let h = await H.ev(() => { const a = Gesso.Panels.inst.histogram.api; a.recompute(); const h = a.hist; return { stride: h.stride, total: h.total, pixels: h.pixels, l255: h.l[255] }; });
    assert(h.stride === 3 && h.total <= 1.05e6 && h.total > 600000 && h.pixels === 6e6 && h.l255 === h.total, 'sampled ' + JSON.stringify(h));
    const txt = async (lab) => (await page.locator('.panel-histogram .hist-grid .muted', { hasText: new RegExp('^' + lab + '$') }).locator('xpath=following-sibling::span[1]').textContent()).trim();
    assert((await txt('Pixels')) === '≈ 6.00 M', 'approximate pixel count ' + (await txt('Pixels')));
    // simulate a live stroke: the debounced update must not recompute until the stroke flag clears
    const r = await H.ev(async () => {
      const a = Gesso.Panels.inst.histogram.api, d = Gesso.app.doc;
      const before = a.hist;
      const tool = Gesso.app.tool; const hadSt = tool.st; tool.st = { fake: true };
      const x = d.layers[0].canvas.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 1500, 2000); d.layers[0].version++; d.invalidate(); Gesso.View.draw();
      await new Promise((r) => setTimeout(r, 450));
      const during = a.hist === before;
      tool.st = hadSt || null;
      await new Promise((r) => setTimeout(r, 450));
      const after = a.hist !== before && a.hist.l[0] > 0;
      return { during, after, l0: a.hist.l[0], total: a.hist.total };
    });
    assert(r.during, 'no recompute while the stroke is live');
    assert(r.after && Math.abs(r.l0 / r.total - 0.5) < 0.01, 'recomputed after the stroke: ' + JSON.stringify(r));
    await H.shot('p3-04-histogram-big');
    await H.ev(() => { const d = Gesso.app.doc; d.modified = false; Gesso.App.closeDoc(d); });
    await H.wait(300);
  });

  await H.step('no document → the panel shows a placeholder without errors', async () => {
    await H.ev(() => { for (const d of Gesso.app.docs.slice()) { d.modified = false; Gesso.App.closeDoc(d); } });
    await H.wait(400);
    const r = await H.ev(() => { const a = Gesso.Panels.inst.histogram.api; a.recompute(); return { hist: a.hist, docs: Gesso.app.docs.length }; });
    assert(r.hist === null && r.docs === 0, JSON.stringify(r));
    const txt = async (lab) => (await page.locator('.panel-histogram .hist-grid .muted', { hasText: new RegExp('^' + lab + '$') }).locator('xpath=following-sibling::span[1]').textContent()).trim();
    assert((await txt('Mean')) === '—' && (await txt('Pixels')) === '—', 'cleared stats');
    assert(/shadows —/.test(await page.locator('.panel-histogram .hist-clip').innerText()), 'cleared clipping');
  });

  await H.finish();
})();
