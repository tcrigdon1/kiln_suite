// Pass 3 — layer filter, magnetic lasso, contact sheet, data-driven export
const { launch, assert } = require('../pass2/lib');
const path = require('path'), fs = require('fs');
(async () => {
  const H = await launch();
  const { page } = H;
  await H.ev(() => {
    const S = window.Gesso, d = S.App.createDoc({ name: 'A6', w: 400, h: 300, dpi: 72, bg: 'white' });
    // a dark disc on a light background for the magnetic lasso
    const x = d.layers[0].canvas.getContext('2d'); x.fillStyle = '#e8e8e8'; x.fillRect(0, 0, 400, 300); x.fillStyle = '#202020'; x.beginPath(); x.arc(200, 150, 80, 0, 7); x.fill(); d.bump(d.layers[0]);
    const t1 = S.Layers.text(d, { text: 'Hello', x: 20, y: 40, size: 24 }); t1.name = 'title'; d.insertLayer(t1, d.activeId, 'above');
    const t2 = S.Layers.text(d, { text: 'World', x: 20, y: 80, size: 18 }); t2.name = 'subtitle'; d.insertLayer(t2, t1.id, 'above');
    const r2 = S.Layers.raster(d, 'Sky', S.util.createCanvas(10, 10)); d.insertLayer(r2, t2.id, 'above');
  });
  await H.wait(200);

  await H.step('Layers panel filter: typing narrows the list; kind filter works; Escape clears', async () => {
    await H.ev(() => Gesso.Cmd.run('layer.filter')); await H.wait(150);
    const vis = async () => page.locator('.panel-layers .layer-row, .layers-list .layer-row, .layer-row').count();
    const all = await vis();
    await page.keyboard.type('sky'); await H.wait(150);
    const n1 = await vis();
    assert(all >= 4 && n1 === 1, 'typed filter: ' + all + ' → ' + n1);
    await page.locator('.layers-filter-q').fill(''); await page.selectOption('.layers-filter-kind', 'text'); await H.wait(150);
    const n2 = await vis(); assert(n2 === 2, 'kind filter text → ' + n2);
    await page.locator('.layers-filter-q').focus(); await H.key('Escape'); await H.wait(150);
    const n3 = await vis(); assert(n3 === all, 'cleared: ' + n3);
  });

  await H.step('Magnetic Lasso snaps to the disc edge: a loose path around it yields a selection close to the disc area', async () => {
    await H.ev(() => Gesso.Tools.select('magLasso'));
    // anchors roughly 15 px outside the disc; the snapping should pull the outline onto the edge (radius 80)
    const pts = []; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; pts.push([200 + Math.cos(a) * 95, 150 + Math.sin(a) * 95]); }
    const p0 = await H.pt(pts[0][0], pts[0][1]); await page.mouse.click(p0[0], p0[1]); await H.wait(150);
    for (let i = 1; i < pts.length; i++) { const q = await H.pt(pts[i][0], pts[i][1]); await page.mouse.move(q[0], q[1], { steps: 6 }); await H.wait(40); await page.mouse.click(q[0], q[1]); await H.wait(60); }
    await H.key('Enter'); await H.wait(300);
    const r = await H.ev(() => { const d = Gesso.app.doc; if (!d.selection) return null; const m = d.selection.mask; let n = 0, inside = 0; for (let i = 0; i < m.length; i++) if (m[i] > 127) { n++; const x = i % d.width, y = (i / d.width) | 0; if (Math.hypot(x - 200, y - 150) <= 82) inside++; } return { n, inside, bounds: d.selection.bounds }; });
    assert(r, 'a selection was made');
    const disc = Math.PI * 80 * 80, loose = Math.PI * 95 * 95;
    assert(r.n < (disc + loose) / 2 && r.n > disc * 0.85, 'selection area ' + r.n + ' is close to the disc (' + Math.round(disc) + ') not the loose path (' + Math.round(loose) + ')');
    assert(r.inside / r.n > 0.95, 'selection sits inside the disc edge (' + (r.inside / r.n).toFixed(3) + ')');
  });

  await H.step('CSV parsing + data row fill', async () => {
    const r = await H.ev(() => {
      const S = window.Gesso, d = S.app.doc;
      const rows = S.App.parseCSV('title,subtitle,filename\n"Kiln, Suite","line ""two""",first\nB,C,second\n');
      S.App.renderDataRow(d, rows[0], rows[1]);
      const t = d.layers.find((l) => l.name === 'title'), s = d.layers.find((l) => l.name === 'subtitle');
      return { rows: rows.length, cols: rows[0], t: t.text.text, s: s.text.text };
    });
    assert(r.rows === 3 && r.cols.join('|') === 'title|subtitle|filename' && r.t === 'Kiln, Suite' && r.s === 'line "two"', JSON.stringify(r));
  });

  await H.step('Data-Driven Export downloads one file per row named from the filename column', async () => {
    const csv = path.join(__dirname, 'rows.csv'); fs.writeFileSync(csv, 'title,subtitle,filename\nOne,Alpha,card-one\nTwo,Beta,card-two\n');
    const dls = []; page.on('download', (d) => dls.push(d.suggestedFilename()));
    const fcP = page.waitForEvent('filechooser');
    page.evaluate(() => { Gesso.Cmd.run('file.dataDriven'); });
    const fc = await fcP; await fc.setFiles(csv); await H.wait(400);
    await page.locator('.gesso-dialog .btn.primary, .gesso-dialog button.primary').last().click();
    await page.waitForFunction(() => !document.querySelector('.gesso-dialog'), null, { timeout: 15000 }); await H.wait(800);
    assert(dls.includes('card-one.png') && dls.includes('card-two.png'), 'downloads: ' + dls.join(', '));
    const restored = await H.ev(() => Gesso.app.doc.layers.find((l) => l.name === 'title').text.text);
    assert(restored === 'Kiln, Suite', 'document restored after export: ' + restored);
  });

  await H.step('Contact Sheet builds a new document with one layer per image plus labels', async () => {
    const imgs = [];
    for (const [n, c] of [['a.png', '#f00'], ['b.png', '#0f0'], ['c.png', '#00f']]) { const p = path.join(__dirname, n); imgs.push(p); }
    // make three small PNGs with the browser
    const datas = await H.ev(() => ['#f00', '#0f0', '#00f'].map((c) => { const cv = document.createElement('canvas'); cv.width = 120; cv.height = 90; const x = cv.getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, 120, 90); return cv.toDataURL('image/png'); }));
    datas.forEach((d, i) => fs.writeFileSync(imgs[i], Buffer.from(d.split(',')[1], 'base64')));
    const fcP = page.waitForEvent('filechooser');
    page.evaluate(() => { Gesso.Cmd.run('file.contactSheet'); });
    const fc = await fcP; await fc.setFiles(imgs); await H.wait(400);
    await page.locator('.gesso-dialog .btn.primary, .gesso-dialog button.primary').last().click();
    await page.waitForFunction(() => Gesso.app.doc && Gesso.app.doc.name === 'Contact Sheet', null, { timeout: 15000 }); await H.wait(300);
    const r = await H.ev(() => { const d = Gesso.app.doc; return { w: d.width, h: d.height, rasters: d.layers.filter((l) => l.type === 'raster').length, texts: d.layers.filter((l) => l.type === 'text').map((l) => l.text.text) }; });
    assert(r.rasters === 4 && r.texts.join(',') === 'a,b,c', JSON.stringify(r));
    assert(r.w > 1000 && r.h > 300, 'sheet size ' + r.w + '×' + r.h);
  });

  await H.finish();
})();
