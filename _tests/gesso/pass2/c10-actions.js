// C6 — Actions: record (filter with params, invert, image size %), play on another document, Batch over
// files (downloads), Export Layers to Files.
const { launch, assert, ASSETS } = require('./lib');
const path = require('path');

(async () => {
  const H = await launch();
  const { page } = H;
  await H.ev(() => { const d = Gesso.App.createDoc({ name: 'Rec', w: 400, h: 300, dpi: 72, bg: 'white' }); const x = d.layers[0].canvas.getContext('2d'); x.fillStyle = '#3060c0'; x.fillRect(50, 50, 300, 200); d.layers[0].version++; d.invalidate(); });
  await H.wait(200);

  await H.step('Record an action: Gaussian Blur (radius 6) + Invert + Image Size 50 %; the Actions panel lists 3 steps', async () => {
    await H.menu('File', 'Actions', 'Record Action…');
    await page.locator('.gesso-dialog input').fill('Blur-invert-half'); await H.dialogBtn('OK');
    await H.wait(200);
    assert(await H.ev(() => !!Gesso.Actions.recording), 'recording');
    await H.menu('Filter', 'Blur', 'Gaussian Blur…'); await H.wait(300);
    const r = page.locator('.gesso-dialog input[type=range]').first(); await r.fill('6'); await r.dispatchEvent('input'); await r.dispatchEvent('change'); await H.wait(300);
    await H.dialogBtn('OK'); await H.wait(300);
    await H.key('Control+i'); await H.wait(150);
    await H.menu('Image', 'Image Size…'); await page.locator('.gesso-dialog input[type=number]').nth(2).fill('50'); await page.locator('.gesso-dialog input[type=number]').nth(2).dispatchEvent('input'); await H.dialogBtn('OK'); await H.wait(300);
    await H.menu('File', 'Actions', 'Stop Recording');
    await H.wait(200);
    const acts = await H.ev(() => Gesso.Actions.list());
    assert(acts.length === 1 && acts[0].steps.length === 3, 'steps: ' + JSON.stringify(acts[0] && acts[0].steps.map((s) => s.type + ':' + (s.id || s.pct))));
    assert(acts[0].steps[0].type === 'filter' && acts[0].steps[0].params.radius === 6 && acts[0].steps[1].id === 'image.invert' && acts[0].steps[2].pct === 50, JSON.stringify(acts[0].steps));
    const txt = await page.locator('.panel-actions').innerText();
    assert(/Blur-invert-half/.test(txt) && /3 steps/.test(txt), 'panel: ' + txt.slice(0, 80));
    await H.shot('c10-01-actions');
  });

  await H.step('Play it (F9) on a fresh 600×400 document: blurred, inverted, resized to 300×200', async () => {
    await H.ev(() => { const d = Gesso.App.createDoc({ name: 'Play', w: 600, h: 400, dpi: 72, bg: 'white' }); const x = d.layers[0].canvas.getContext('2d'); x.fillStyle = '#c03030'; x.fillRect(100, 100, 200, 200); d.layers[0].version++; d.invalidate(); });
    await H.wait(200);
    await H.key('F9');
    for (let i = 0; i < 80; i++) { if (i > 2 && !(await H.ev(() => !!document.querySelector('.progress-row') || Gesso.Actions.playing))) break; await H.wait(100); }
    await H.wait(200);
    const st = await H.state();
    assert(st.w === 300 && st.h === 200, 'resized ' + st.w + '×' + st.h);
    const p = await H.px(100, 100); assert(p[1] > 150 && p[0] < 120, 'inverted red → cyan-ish ' + p);
    const names = await H.ev(() => Gesso.app.doc.history.entries.map((e) => e.name));
    assert(names.includes('Gaussian Blur') && names.includes('Invert') && names.includes('Image Size'), 'history ' + names);
  });

  await H.step('Batch: the action runs over two image files and exports both (downloads)', async () => {
    await H.menu('File', 'Actions', 'Batch…');
    await H.wait(200);
    const fc = page.waitForEvent('filechooser');
    await page.locator('.gesso-dialog button', { hasText: 'Choose images…' }).click();
    await (await fc).setFiles([path.join(ASSETS, 'face.jpg'), path.join(ASSETS, 'photo.png')]);
    await H.wait(300);
    const downloads = []; page.on('download', (x) => downloads.push(x.suggestedFilename()));
    const n0 = await H.ev(() => Gesso.app.docs.length);
    await H.dialogBtn('Run');
    for (let i = 0; i < 300; i++) { await H.wait(100); if (i > 5 && !(await H.ev(() => !!document.querySelector('.progress-row')))) break; }
    await H.wait(300);
    assert(downloads.length === 2, 'two results downloaded: ' + downloads.length);
    assert((await H.ev(() => Gesso.app.docs.length)) === n0, 'batch documents closed again');
  });

  await H.step('Export Layers to Files writes one file per visible top-level layer', async () => {
    await H.ev(() => { const d = Gesso.app.doc; d.commit('more', () => { for (const [n, c] of [['A', '#f00'], ['B', '#0f0']]) { const cv = Gesso.util.createCanvas(60, 60, 20, 20); cv.getContext('2d').fillStyle = c; cv.getContext('2d').fillRect(0, 0, 60, 60); d.layers.push(Gesso.Layers.raster(d, n, cv)); } }); });
    const downloads = []; page.on('download', (x) => downloads.push(x.suggestedFilename()));
    await H.menu('File', 'Export Layers to Files…');
    await H.wait(200);
    await H.dialogBtn('OK');
    for (let i = 0; i < 100; i++) { await H.wait(100); if (i > 3 && !(await H.ev(() => !!document.querySelector('.progress-row')))) break; }
    await H.wait(300);
    assert(downloads.length === 3, 'three layer files: ' + downloads.length);
  });

  await H.finish();
})();
