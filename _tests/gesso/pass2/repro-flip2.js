// User's exact steps, all through real mouse/keyboard: photo → lasso a region → Layer via Cut → rotate 180 ×2 →
// flip horizontal → paint on the background (wrong layer) → select the cut layer → paint on it. Then compare
// what each stroke did with where the mouse went.
const { ROOT } = require('../../env.js');
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto('file://' + ROOT + '/Gesso/index.html'); await p.waitForTimeout(800);
  // open the real photo the user used (the greenhouse portrait) as a document
  const dataUrl = 'data:image/png;base64,' + fs.readFileSync(require('path').join(__dirname, '..', '..', 'assets', 'sample.png')).toString('base64');
  await p.evaluate(async (u) => { const img = await Gesso.util.loadImage(u); Gesso.FileIO.docFromImage(img, 'Photo'); }, dataUrl);
  await p.waitForTimeout(800);
  const S2 = async (x, y) => p.evaluate(([x, y]) => { const V = Gesso.View, d = Gesso.app.doc, r = V.canvas.getBoundingClientRect(), q = V.toScreen(x, y, d); return [q[0] + r.left, q[1] + r.top]; }, [x, y]);
  const drag = async (pts) => { const a = await S2(...pts[0]); await p.mouse.move(a[0], a[1]); await p.mouse.down(); for (const q of pts.slice(1)) { const s = await S2(...q); await p.mouse.move(s[0], s[1], { steps: 4 }); } await p.mouse.up(); await p.waitForTimeout(250); };
  // 1. lasso around her face (she is at roughly x 1000-1950, y 700-2160 in the 3840x2160 photo)
  await p.keyboard.press('l'); await p.waitForTimeout(100);
  await drag([[1050, 760], [1900, 740], [1980, 1500], [1850, 2100], [1100, 2120], [980, 1500]]);
  const selB = await p.evaluate(() => Gesso.app.doc.selection && Gesso.app.doc.selection.bounds);
  console.log('lasso bounds', JSON.stringify(selB));
  // 2. Layer via Cut (Ctrl+Shift+J)
  await p.keyboard.press('Control+Shift+j'); await p.waitForTimeout(500);
  console.log('layers', await p.evaluate(() => Gesso.app.doc.layers.map(l => l.name + '@' + [l.canvas.ox, l.canvas.oy, l.canvas.width, l.canvas.height])));
  // 3. rotate 180 twice, 4. flip horizontal (via commands = same as the menu)
  await p.evaluate(() => { Gesso.Cmd.run('image.rot180'); }); await p.waitForTimeout(400);
  await p.evaluate(() => { Gesso.Cmd.run('image.rot180'); }); await p.waitForTimeout(400);
  await p.evaluate(() => { Gesso.Cmd.run('image.flipH'); }); await p.waitForTimeout(400);
  console.log('after flip layers', await p.evaluate(() => Gesso.app.doc.layers.map(l => l.name + '@' + [l.canvas.ox, l.canvas.oy, l.canvas.width, l.canvas.height])), 'sel', await p.evaluate(() => Gesso.app.doc.selection && Gesso.app.doc.selection.bounds));
  await p.screenshot({ path: __dirname + '/shots/repro2-afterflip.png' });
  // 5. brush on the wrong layer (background) first
  await p.evaluate(() => { const d = Gesso.app.doc; d.setActive(d.layers[0].id); Gesso.App.setFg('#ff0000'); });
  await p.keyboard.press('b'); await p.waitForTimeout(100);
  await drag([[400, 300], [700, 320], [900, 300]]);
  // 6. then select her layer and paint across her face (mirrored: x ≈ 3840-1500 = 2340, y 1200)
  await p.evaluate(() => { const d = Gesso.app.doc; d.setActive(d.layers[1].id); });
  await p.waitForTimeout(100);
  await drag([[2200, 1200], [2400, 1250], [2600, 1200]]);
  await p.screenshot({ path: __dirname + '/shots/repro2-painted.png' });
  const res = await p.evaluate(() => {
    const S = window.Gesso, d = S.app.doc; const out = {};
    d.layers.forEach((l, i) => {
      const cc = l.canvas, x = cc.getContext('2d'), id = x.getImageData(0, 0, cc.width, cc.height).data; let n = 0, mnx = 1e9, mny = 1e9, mxx = -1, mxy = -1;
      for (let k = 0; k < id.length; k += 4) if (id[k] > 200 && id[k + 1] < 60 && id[k + 2] < 60 && id[k + 3] > 100) { n++; const q = k / 4, lx = q % cc.width, ly = (q / cc.width) | 0; mnx = Math.min(mnx, lx); mxx = Math.max(mxx, lx); mny = Math.min(mny, ly); mxy = Math.max(mxy, ly); }
      out[l.name] = { red: n, box: n ? [mnx + cc.ox, mny + cc.oy, mxx + cc.ox, mxy + cc.oy] : null, canvas: [cc.ox, cc.oy, cc.width, cc.height] };
    });
    return out;
  });
  console.log(JSON.stringify(res));
  console.log(errs.length ? 'ERRORS\n' + errs.join('\n') : 'NO ERRORS'); await b.close();
})();
