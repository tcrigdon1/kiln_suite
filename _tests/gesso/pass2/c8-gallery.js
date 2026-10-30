// C12 — Filter Gallery (stacked filters, live preview), smart filters on embedded objects (editable, masked,
// saved), the new effects (Develop adjustment layer, Dehaze, Local Tone Mapping, Match Color, Depth Blur) and
// the centre picker of radial effects.
const { launch, assert, ASSETS } = require('./lib');
const path = require('path');
const fs = require('fs');

(async () => {
  const H = await launch();
  const { page } = H;
  const fc = page.waitForEvent('filechooser');
  await H.key('Control+o');
  await (await fc).setFiles(path.join(ASSETS, 'face.jpg'));
  await H.wait(500);
  // fine detail to measure blur against: a 3-px checker over the face area
  await H.ev(() => { const d = Gesso.app.doc, x = d.layers[0].canvas.getContext('2d'); for (let y = 150; y < 600; y += 3) for (let xx = 380; xx < 820; xx += 3) { x.fillStyle = ((xx - 380) / 3 + (y - 150) / 3) % 2 ? '#222' : '#ddd'; x.fillRect(xx, y, 3, 3); } d.layers[0].version++; d.invalidate(); });
  await H.wait(200);
  const sharp = () => H.ev(() => { const d = Gesso.app.doc; Gesso.Compositor.update(d); const img = d.composite.getContext('2d').getImageData(380, 150, 440, 450).data; let s = 0, n = 0; for (let i = 0; i < img.length - 4; i += 4) { s += Math.abs(img[i] - img[i + 4]); n++; } return s / n; });
  const s0 = await sharp();

  await H.step('Filter ▸ Filter Gallery: a stack (Gaussian Blur + Sharpen) previews live and applies as one history step', async () => {
    await H.menu('Filter', 'Filter Gallery…');
    await H.wait(400);
    assert(await H.dialogOpen(), 'gallery open');
    assert((await page.locator('.fg-list .fx-item').count()) === 1, 'one default entry');
    // raise the blur radius
    const r = page.locator('.fg-params input[type=range]').first();
    await r.fill('12'); await r.dispatchEvent('input'); await r.dispatchEvent('change');
    await H.wait(500);
    const sPreview = await sharp();
    assert(sPreview < s0 * 0.6, 'live preview blurred: ' + sPreview.toFixed(2) + ' < ' + s0.toFixed(2));
    await page.locator('.fg-add button').click();
    await H.wait(300);
    assert((await page.locator('.fg-list .fx-item').count()) === 2, 'second entry added');
    await H.shot('c8-01-gallery');
    const h0 = (await H.state()).hist;
    await H.dialogBtn('OK');
    await H.wait(600);
    const st = await H.state();
    assert(st.hist === h0 + 1 && st.histName === 'Filter Gallery', 'one step: ' + st.histName);
    const s1 = await sharp(); assert(s1 < s0 * 0.8, 'applied ' + s1.toFixed(2));
    await H.key('Control+z');
    assert(Math.abs((await sharp()) - s0) < 0.5, 'undo restored');
  });

  await H.step('Convert for Smart Filters, then Smart Filters…: non-destructive blur, editable, toggleable, undoable, saved in the file', async () => {
    await H.menu('Filter', 'Convert for Smart Filters');
    await H.wait(200);
    assert(await H.ev(() => !!Gesso.app.doc.activeLayer().embed), 'embedded');
    await H.menu('Filter', 'Smart Filters… (embedded objects)');
    await H.wait(400);
    const r = page.locator('.fg-params input[type=range]').first();
    await r.fill('10'); await r.dispatchEvent('input'); await r.dispatchEvent('change');
    await H.wait(300);
    await H.dialogBtn('OK');
    await H.wait(300);
    let info = await H.ev(() => { const l = Gesso.app.doc.activeLayer(); return { n: l.embed.filters.length, radius: l.embed.filters[0].params.radius, src: l.embed.source.width }; });
    assert(info.n === 1 && info.radius === 10, 'smart filter stored ' + JSON.stringify(info));
    const sBlur = await sharp(); assert(sBlur < s0 * 0.6, 'picture blurred non-destructively ' + sBlur.toFixed(2));
    const props = await page.locator('.panel-properties').innerText();
    assert(/Smart filters/.test(props) && /Gaussian Blur/.test(props), 'properties list the smart filter');
    // edit again: switch the entry off
    await H.menu('Filter', 'Smart Filters… (embedded objects)');
    await H.wait(300);
    await page.locator('.fg-list .fx-item input[type=checkbox]').first().uncheck();
    await H.wait(300);
    assert(Math.abs((await sharp()) - s0) < 1, 'disabled filter → original sharpness');
    await H.dialogBtn('OK'); await H.wait(200);
    await H.key('Control+z');
    assert((await sharp()) < s0 * 0.6, 'undo re-enables the blur');
    await H.shot('c8-02-smart');
    const dl = page.waitForEvent('download');
    await H.key('Control+s');
    const d = await dl; const file = path.join(__dirname, 'downloads', 'c8-smart.kgesso'); await d.saveAs(file);
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert(json.layers[0].embed.filters.length === 1, 'filters saved');
    const fc2 = page.waitForEvent('filechooser'); await H.key('Control+o'); await (await fc2).setFiles(file); await H.wait(600);
    assert((await H.ev(() => Gesso.app.doc.layers[0].embed.filters.length)) === 1, 'filters reloaded');
    await H.key('Control+w');
  });

  await H.step('Smart filter mask: with a selection, "Mask from selection" limits the blur to the selection', async () => {
    await H.key('m');
    await H.dragDoc([[0, 0], [600, 800]]);
    await H.menu('Filter', 'Smart Filters… (embedded objects)');
    await H.wait(300);
    await page.locator('.gesso-dialog .dialog-foot button', { hasText: 'Mask from selection' }).click();
    await H.wait(300);
    await H.dialogBtn('OK'); await H.wait(200);
    await H.key('Control+d');
    const left = await H.ev(() => { const d = Gesso.app.doc; Gesso.Compositor.update(d); const img = d.composite.getContext('2d').getImageData(400, 300, 150, 200).data; let s = 0, n = 0; for (let i = 0; i < img.length - 4; i += 4) { s += Math.abs(img[i] - img[i + 4]); n++; } return s / n; });
    const right = await H.ev(() => { const d = Gesso.app.doc; const img = d.composite.getContext('2d').getImageData(650, 300, 150, 200).data; let s = 0, n = 0; for (let i = 0; i < img.length - 4; i += 4) { s += Math.abs(img[i] - img[i + 4]); n++; } return s / n; });
    assert(right > left * 1.8, 'right (unmasked) sharp ' + right.toFixed(2) + ' vs left blurred ' + left.toFixed(2));
  });

  await H.step('Develop adjustment layer (all-in-one) brightens with Exposure; Local Tone Mapping and Dehaze run without errors', async () => {
    await H.menu('Layer', 'New Adjustment Layer', 'Develop (all-in-one)');
    await H.wait(400);
    const p0 = await H.px(600, 700);
    const exp = page.locator('.panel-properties input[type=number]').nth(2); // temperature, tint, exposure
    await exp.fill('150'); await exp.press('Enter');
    await H.wait(400);
    const p1 = await H.px(600, 700);
    assert(p1[1] > p0[1] + 20, 'brighter with exposure: ' + p0 + ' → ' + p1);
    await H.shot('c8-03-develop');
    await H.ev(() => { const d = Gesso.app.doc; d.setActive(d.layers[0].id); });
    await H.menu('Layer', 'Embedded Object', 'Rasterize Object');
    await H.menu('Filter', 'Color', 'Dehaze…'); await H.wait(400); await H.dialogBtn('OK'); await H.wait(400);
    assert((await H.state()).histName === 'Dehaze', 'dehaze applied');
    await H.menu('Image', 'Adjustments', 'Local Tone Mapping…'); await H.wait(400); await H.dialogBtn('OK'); await H.wait(600);
    assert((await H.state()).histName === 'Local Tone Mapping', 'tone mapping applied');
  });

  await H.step('Radial Blur centre picker: clicking the picture moves the centre; Match Color offers a reference layer; Depth Blur offers the selection as focus', async () => {
    await H.menu('Filter', 'Blur', 'Radial Blur…'); await H.wait(400);
    await H.clickDoc(200, 150);
    await H.wait(300);
    const vals = await H.ev(() => [...document.querySelectorAll('.gesso-dialog .field')].map((f) => f.querySelector('label').textContent + '=' + (f.querySelector('input[type=number]') || {}).value).join(' '));
    assert(/Center X[^=]*=17/.test(vals) && /Center Y[^=]*=19/.test(vals), 'centre picked: ' + vals);
    await H.dialogBtn('Cancel'); await H.wait(200);
    await H.ev(() => { const d = Gesso.app.doc; const c = Gesso.util.createCanvas(200, 200, 50, 50); const g = c.getContext('2d'); g.fillStyle = '#e8a040'; g.fillRect(0, 0, 200, 200); d.commit('ref', () => { const l = Gesso.Layers.raster(d, 'Warm', c); d.layers.push(l); }); d.setActive(d.layers[0].id); });
    await H.menu('Filter', 'Color', 'Match Color (from layer)…'); await H.wait(300);
    const opts = await H.ev(() => [...document.querySelectorAll('.gesso-dialog .fx-extra select option')].map((o) => o.textContent));
    assert(opts.includes('Warm'), 'reference layer offered: ' + opts.join('|'));
    await page.locator('.gesso-dialog .fx-extra select').selectOption({ label: 'Warm' });
    await H.wait(500);
    const p = await H.px(100, 100); assert(p[0] > p[2] + 30, 'picture warmed towards the reference ' + p);
    await H.dialogBtn('OK'); await H.wait(400);
    assert(/Match Color/.test((await H.state()).histName), 'match colour applied');
    await H.menu('Filter', 'Blur', 'Depth Blur (lens, from layer)…'); await H.wait(300);
    const opts2 = await H.ev(() => [...document.querySelectorAll('.gesso-dialog .fx-extra select option')].map((o) => o.textContent));
    assert(opts2.some((o) => /selection/.test(o)) && opts2.includes('Warm'), 'depth sources: ' + opts2.join('|'));
    await H.dialogBtn('Cancel');
  });

  await H.finish();
})();
