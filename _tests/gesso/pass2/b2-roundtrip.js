// Part B: .kgesso save / open round trips (format v2 with layer bounds), legacy v1 files, drift check.
const { ROOT } = require('../../env.js');
const { launch, assert, ASSETS } = require('./lib');
const path = require('path');
const fs = require('fs');
const DL = path.join(__dirname, 'downloads'); fs.mkdirSync(DL, { recursive: true });

(async () => {
  const H = await launch();
  const { page } = H;
  const flat = () => H.ev(() => { const d = Gesso.app.doc; return Gesso.Compositor.flatten(d).toDataURL(); });
  const sizes = () => H.ev(() => { const out = []; Gesso.app.doc.walk((l) => { if (l.canvas) out.push([l.name, l.canvas.width, l.canvas.height, l.canvas.ox || 0, l.canvas.oy || 0]); }); return out; });
  const diffCount = async (a, b) => H.ev(async ([a, b]) => {
    const load = (u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = u; });
    const A = await load(a), B = await load(b); if (A.width !== B.width || A.height !== B.height) return -1;
    const c = document.createElement('canvas'); c.width = A.width; c.height = A.height; const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(A, 0, 0); const da = x.getImageData(0, 0, c.width, c.height).data; x.clearRect(0, 0, c.width, c.height); x.drawImage(B, 0, 0); const db = x.getImageData(0, 0, c.width, c.height).data;
    let n = 0, mx = 0; for (let i = 0; i < da.length; i++) { const d = Math.abs(da[i] - db[i]); if (d) { n++; if (d > mx) mx = d; } } return [n, mx];
  }, [a, b]);

  // open the photo, add a painted layer moved partly off-canvas, a text layer with a shadow, a masked shape
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
  await fc.setFiles(path.join(ASSETS, 'photo.png'));
  await H.wait(600);
  await H.key('Control+Shift+n');
  await H.key('b');
  await H.ev(() => { const o = Gesso.Tools.byId.brush.opts; o.size = 30; o.opacity = 100; Gesso.App.setFg('#2244ff'); });
  await H.dragDoc([[60, 60], [300, 200]]);
  await H.key('v');
  await H.dragDoc([[180, 130], [20, 130]], { steps: 10 }); // part of the stroke now lies outside
  await H.key('t');
  await H.clickDoc(200, 300);
  await page.keyboard.type('Round trip');
  await H.key('Escape');
  await H.ev(() => { const d = Gesso.app.doc, l = d.activeLayer(); d.commit('fx', () => { l.effects = { enabled: true, items: { dropShadow: Object.assign(Gesso.Effects.defaults('dropShadow'), { distance: 12, size: 20 }) } }; l.version++; }); });
  await H.tool('shapeEllipse').catch(() => {});
  await H.ev(() => Gesso.Tools.select('ellipse'));
  await H.dragDoc([[300, 50], [500, 250]]);
  await H.menu('Layer', 'Layer Mask', 'Reveal All');
  const st0 = await H.state();
  const before = await flat();
  const sz0 = await sizes();
  console.log('     layers', JSON.stringify(sz0));

  let current = before, lastSizes = sz0;
  for (let round = 1; round <= 3; round++) {
    await H.step('save / reopen round ' + round + ' renders identically and layer canvases do not grow', async () => {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+Shift+s')]);
      const file = path.join(DL, 'rt' + round + '.kgesso'); await dl.saveAs(file);
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert(json.version === 2 && json.layers.some((l) => l.bounds), 'v2 with bounds');
      await H.key('Control+w'); // close (may ask to save → Don't Save)
      await H.wait(200);
      if (await H.dialogOpen()) await page.locator('.gesso-dialog .dialog-foot button', { hasText: 'Don’t Save' }).click();
      await H.wait(200);
      const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
      await fc2.setFiles(file);
      await H.wait(900);
      const st = await H.state();
      assert(st.layers.length === st0.layers.length, 'layer count ' + st.layers.length);
      const after = await flat();
      const [n, mx] = await diffCount(current, after);
      assert(n === 0, 'pixels differ after round ' + round + ': ' + n + ' (max ' + mx + ')');
      const sz = await sizes();
      for (let i = 0; i < sz.length; i++) assert(sz[i][1] * sz[i][2] <= lastSizes[i][1] * lastSizes[i][2] + 8, 'canvas grew: ' + JSON.stringify([lastSizes[i], sz[i]]));
      current = after; lastSizes = sz;
    });
  }
  await H.shot('b2-01-after-rounds');

  await H.step('the painted layer keeps its off-canvas pixels through save/open', async () => {
    const info = await H.ev(() => { const l = Gesso.app.doc.allLayers().find((x) => x.name === 'Layer 1'); return { r: Gesso.Layers.contentRect(l), c: [l.canvas.ox, l.canvas.oy, l.canvas.width] }; });
    assert(info.r && info.r.x < 0, 'content starts left of the canvas ' + JSON.stringify(info));
  });

  await H.step('legacy v1 project (full-size layer PNGs) opens, is trimmed and renders', async () => {
    const legacy = ROOT + '/_tests/watch/out/Kiln Ember Concept.kgesso';
    const json = JSON.parse(fs.readFileSync(legacy, 'utf8'));
    assert(json.version === 1 && !json.layers.some((l) => l.bounds), 'is v1');
    const [fc3] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
    await fc3.setFiles(legacy);
    await H.wait(2500);
    const st = await H.state();
    assert(st.w === 1600 && st.h === 2000, 'size');
    const r = await H.ev(() => { const out = []; Gesso.app.doc.walk((l) => { if (l.type === 'raster') out.push([l.name, l.canvas.width, l.canvas.height]); }); return out; });
    assert(r.every((x) => x[1] * x[2] < 1600 * 2000), 'rasters trimmed ' + JSON.stringify(r));
    const png = await flat();
    const ref = 'data:image/png;base64,' + fs.readFileSync(ROOT + '/_tests/watch/out/Kiln Ember Concept.png').toString('base64');
    const [n, mx] = await diffCount(png, ref);
    assert(n === 0, 'legacy render differs: ' + n + ' max ' + mx);
    await H.shot('b2-02-legacy');
  });

  await H.finish();
})();
