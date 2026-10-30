// Part C3: export presets — batch export 1×/2×/3× PNG + JPEG, create a preset, persistence across reload.
const { launch, assert } = require('./lib');
const path = require('path');
const fs = require('fs');
const DL = path.join(__dirname, 'downloads'); fs.mkdirSync(DL, { recursive: true });

(async () => {
  const H = await launch();
  const { page } = H;
  await H.ev(() => Gesso.App.createDoc({ name: 'Batch', w: 300, h: 200, dpi: 72, bg: 'white' }));
  await H.wait(200);

  await H.step('Export As ▸ Export Preset downloads four files at the right sizes', async () => {
    await H.key('Control+Alt+s');
    await H.wait(500);
    assert(await H.dialogOpen(), 'dialog');
    const info = await page.locator('.export-preset-info').textContent();
    assert(/@2x/.test(info) && /jpg/.test(info), 'default preset shown: ' + info);
    await H.shot('c3-01-export-dialog');
    const downloads = [];
    page.on('download', (d) => downloads.push(d));
    await page.locator('.gesso-dialog .dialog-foot button', { hasText: 'Export Preset' }).click();
    await H.wait(2500);
    const names = [];
    for (const d of downloads) { const n = d.suggestedFilename(); names.push(n); await d.saveAs(path.join(DL, n)); }
    assert(names.length === 4, 'four downloads: ' + names.join(', '));
    assert(names.includes('Batch.png') && names.includes('Batch@2x.png') && names.includes('Batch@3x.png') && names.includes('Batch.jpg'), 'names ' + names);
    const dims = (f) => { const b = fs.readFileSync(path.join(DL, f)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
    assert(dims('Batch.png')[0] === 300 && dims('Batch@2x.png')[0] === 600 && dims('Batch@3x.png')[0] === 900, 'png sizes ' + JSON.stringify([dims('Batch.png'), dims('Batch@2x.png'), dims('Batch@3x.png')]));
    const jpg = fs.readFileSync(path.join(DL, 'Batch.jpg')); assert(jpg[0] === 0xff && jpg[1] === 0xd8, 'jpeg magic');
    assert(!(await H.dialogOpen()), 'dialog closed after export');
  });

  await H.step('a new preset with two entries is remembered after reload', async () => {
    await H.key('Control+Alt+s');
    await H.wait(400);
    await page.locator('.gesso-dialog button', { hasText: 'New preset…' }).click();
    await H.wait(200);
    await page.keyboard.press('Control+a'); await page.keyboard.type('Icons'); await page.keyboard.press('Enter');
    await H.wait(200);
    // change scale to 50 % then add it to the preset
    const scale = page.locator('.gesso-dialog .field input[type=number]').nth(1);
    await scale.fill('50'); await scale.dispatchEvent('change');
    await page.locator('.gesso-dialog button', { hasText: '+ Add current' }).click();
    await H.wait(200);
    await page.keyboard.press('Control+a'); await page.keyboard.type('-small'); await page.keyboard.press('Enter');
    await H.wait(200);
    const info = await page.locator('.export-preset-info').textContent();
    assert(/-small/.test(info) && /@50%/.test(info), 'preset lists the new file: ' + info);
    await H.key('Escape');
    await page.reload(); await H.wait(600);
    const saved = await H.ev(() => Gesso.FileIO.exportPresets().map((p) => p.name + ':' + p.items.length));
    assert(saved.includes('Icons:2'), 'persisted ' + saved);
  });

  await H.finish();
})();
