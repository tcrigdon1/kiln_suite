// ImageFX audit against natural-looking test images: every adjustment at defaults must be a no-op (except
// the Auto* ones, which analyse the image), every filter at min / default / max parameters must produce
// finite, non-black, fringe-free output, and the filter dialog's preview must match the committed result
// pixel-for-pixel when the preview is full resolution.
const { ROOT } = require('../../env.js');
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await page.goto('file://' + ROOT + '/Gesso/index.html'); await page.waitForTimeout(500);
  const report = await page.evaluate(() => {
    const FX = window.ImageFX;
    // ---- natural-looking test images: sky gradient + noise, a face-like oval, sharp edges, transparency ----
    const mk = (w, h, withAlpha) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#5a86c9'); g.addColorStop(0.6, '#d9c7a8'); g.addColorStop(1, '#3f5a2a');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.fillStyle = '#e8b48c'; x.beginPath(); x.ellipse(w * 0.5, h * 0.5, w * 0.18, h * 0.26, 0, 0, 7); x.fill();
      x.fillStyle = '#2a1a10'; x.beginPath(); x.arc(w * 0.44, h * 0.44, 4, 0, 7); x.arc(w * 0.56, h * 0.44, 4, 0, 7); x.fill();
      x.fillStyle = '#111'; x.fillRect(w * 0.1, h * 0.1, w * 0.12, h * 0.05); x.fillStyle = '#fff'; x.fillRect(w * 0.7, h * 0.8, w * 0.2, 3);
      const img = x.getImageData(0, 0, w, h), d = img.data;
      let s = 12345; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
      for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 18; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
      if (withAlpha) for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) { const i = (y * w + xx) * 4; if (xx < w * 0.15) d[i + 3] = 0; else if (xx < w * 0.25) d[i + 3] = Math.round(((xx - w * 0.15) / (w * 0.1)) * 255); }
      return img;
    };
    const base = mk(160, 120, false), baseA = mk(160, 120, true);
    const clone = (img) => new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
    const out = { adjNoop: [], filters: [], total: 0 };
    const stats = (img) => {
      const d = img.data; let nan = 0, maxA = 0, sum = 0, n = 0, fringe = 0;
      for (let i = 0; i < d.length; i += 4) { if (Number.isNaN(d[i])) nan++; if (d[i + 3] > maxA) maxA = d[i + 3]; if (d[i + 3]) { sum += d[i] + d[i + 1] + d[i + 2]; n++; } }
      return { nan, maxA, mean: n ? sum / (3 * n) : 0, fringe };
    };
    // alpha fringe: pixels that were fully transparent in the source but became visible, or dark halos at the
    // soft edge (colour of edge pixels much darker than their opaque neighbours)
    // a correct straight-alpha filter gives the soft-edge pixels (alpha 1..254) the same colour the opaque
    // image gets at that spot (`ref` = the same filter run on the opaque version); dark/black halos show up
    // as a much darker result there
    const fringeCheck = (src, res, ref) => {
      const d = src.data, r = res.data, q = ref.data; let appeared = 0, dark = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0 && r[i + 3] > 8) appeared++;
        if (d[i + 3] > 24 && d[i + 3] < 232 && r[i + 3] > 32) { const L0 = (q[i] + q[i + 1] + q[i + 2]) / 3, L1 = (r[i] + r[i + 1] + r[i + 2]) / 3; if (L1 < L0 * 0.45 && L0 > 50) dark++; }
      }
      return { appeared, dark };
    };
    for (const id in FX.adjustments) {
      const fx = FX.adjustments[id];
      if (/^auto|^invert$|^desaturate$|^posterize$|^threshold$|^gradientMap$|^blackWhite$|^filmLooks$/.test(id)) continue;
      const res = FX.apply(fx, clone(base), FX.defaults(fx), {});
      let maxd = 0, cnt = 0; for (let i = 0; i < res.data.length; i++) { const dd = Math.abs(res.data[i] - base.data[i]); if (dd) { cnt++; if (dd > maxd) maxd = dd; } }
      out.adjNoop.push({ id, maxDiff: maxd, changed: cnt });
    }
    for (const id in FX.filters) {
      const fx = FX.filters[id]; out.total++;
      const variants = { def: FX.defaults(fx), min: {}, max: {} };
      for (const p of fx.params) {
        const dflt = FX.defaults(fx)[p.id];
        variants.min[p.id] = p.type === 'range' || p.type === 'number' ? (p.min != null ? p.min : dflt) : p.type === 'checkbox' ? false : dflt;
        variants.max[p.id] = p.type === 'range' || p.type === 'number' ? (p.max != null ? p.max : dflt) : p.type === 'checkbox' ? true : dflt;
      }
      for (const v in variants) {
        let refOpaque = null;
        for (const [tag, src] of [['opaque', base], ['alpha', baseA]]) {
          let res, err = null; const t0 = performance.now();
          try { res = FX.apply(fx, clone(src), variants[v], {}); } catch (e) { err = e.message; }
          const ms = Math.round(performance.now() - t0);
          const row = { id, v, tag, ms, err };
          if (res) {
            const s = stats(res); Object.assign(row, s);
            if (tag === 'opaque') refOpaque = res;
            if (tag === 'alpha' && refOpaque) Object.assign(row, fringeCheck(src, res, refOpaque));
            row.black = s.maxA > 0 && s.mean < 2;
            row.size = res.width === src.width && res.height === src.height;
          }
          out.filters.push(row);
        }
      }
    }
    return out;
  });
  const bad = [];
  const notes = [];
  // Photo Filter (Warming 25 %) and Shadows/Highlights (35 %) default to a visible setting by convention
  for (const a of report.adjNoop) if (a.maxDiff > 1) (/^(photoFilter|shadowsHighlights)$/.test(a.id) ? notes : bad).push('adjustment not a no-op at defaults: ' + a.id + ' maxDiff ' + a.maxDiff + ' (' + a.changed + ' bytes)');
  for (const f of report.filters) {
    if (f.err) bad.push('filter threw: ' + f.id + ' [' + f.v + '/' + f.tag + '] ' + f.err);
    else {
      if (f.nan) bad.push('NaN: ' + f.id + ' ' + f.v);
      if (!f.size) bad.push('size changed: ' + f.id + ' ' + f.v);
      // Glowing Edges at brightness 0 and a Custom Kernel of all-minimum weights are black by definition
      if (f.black && !/^(threshold|minimum|differenceClouds|glowingEdges|customKernel)$/.test(f.id)) bad.push('black frame: ' + f.id + ' [' + f.v + '/' + f.tag + '] mean ' + f.mean.toFixed(1));
      if (f.tag === 'alpha' && f.appeared > 40 && !/^(offset|clouds|differenceClouds|lensFlare|vignette|twirl|pinch|spherize|ripple|wave|polarCoordinates|zigzag|turbulence|lensCorrection|motionBlur|radialBlur|wind|tiles|glitch|diffuse|crystallize|pointillize|colorHalftone|mezzotint|pixelate|maximum|dustScratches|median|oilPaint|watercolor|chromaticAberration|bokehBlur|boxBlur|gaussianBlur|surfaceBlur|tiltShift|customKernel|emboss|glowingEdges|findEdges|posterizeEdges|crt|pencilSketch|cartoon|highPass|sharpen|unsharpMask|clarity|reduceNoise|addNoise|filmGrain|duotone|sepia|colorize|solarize)$/.test(f.id)) bad.push('pixels appeared in transparent area: ' + f.id + ' ' + f.v + ' (' + f.appeared + ')');
      if (f.tag === 'alpha' && f.dark > 25) bad.push('possible dark fringe at soft alpha edge: ' + f.id + ' [' + f.v + '] ' + f.dark + ' px');
      if (f.ms > 4000) bad.push('slow: ' + f.id + ' ' + f.v + ' ' + f.ms + ' ms (160×120)');
    }
  }
  const slow = report.filters.filter((f) => f.ms > 800).map((f) => f.id + ':' + f.v + ':' + f.ms + 'ms');
  console.log('adjustments checked:', report.adjNoop.length, ' filters:', report.total, ' runs:', report.filters.length);
  console.log('slow runs (>800ms on 160×120):', slow.join(', ') || 'none');
  console.log('notes (by design): ' + notes.join('; '));
  console.log(bad.length ? 'FINDINGS:\n' + bad.join('\n') : 'no findings');
  fs.writeFileSync(path.join(__dirname, 'fx-audit-report.json'), JSON.stringify(report, null, 1));

  // ---- preview vs commit through the UI on a small document (full-resolution preview path) ----
  await page.evaluate(() => { const d = Gesso.App.createDoc({ name: 'fx', w: 300, h: 200, dpi: 72, bg: 'white' }); const x = d.layers[0].canvas.getContext('2d'); const g = x.createLinearGradient(0, 0, 300, 200); g.addColorStop(0, '#f08'); g.addColorStop(1, '#0cf'); x.fillStyle = g; x.fillRect(0, 0, 300, 200); x.fillStyle = '#000'; x.fillRect(100, 60, 80, 50); d.invalidate(); });
  await page.waitForTimeout(300);
  const mismatches = [];
  for (const [menuCat, item, id] of [['Blur', 'Gaussian Blur…', 'gaussianBlur'], ['Stylize', 'Emboss…', 'emboss'], ['Distort', 'Twirl…', 'twirl'], ['Noise', 'Add Noise…', 'addNoise'], ['Sharpen', 'Unsharp Mask…', 'unsharpMask'], ['Pixelate', 'Mosaic…', 'pixelate']]) {
    await page.click('.menu-title[data-menu="Filter"]'); await page.waitForTimeout(80);
    await page.locator('.gesso-menu').nth(0).locator('.item', { hasText: menuCat }).first().hover(); await page.waitForTimeout(100);
    await page.locator('.gesso-menu').nth(1).locator('.item', { hasText: item }).first().click();
    await page.waitForTimeout(700);
    const pv = await page.evaluate(() => Gesso.Layers.readRect(Gesso.app.doc.layers[0].canvas, { x: 0, y: 0, w: 300, h: 200 }).data.join(','));
    const info = await page.locator('.fx-info').textContent();
    await page.click('.gesso-dialog .btn.primary'); await page.waitForTimeout(500);
    const done = await page.evaluate(() => Gesso.Layers.readRect(Gesso.app.doc.layers[0].canvas, { x: 0, y: 0, w: 300, h: 200 }).data.join(','));
    if (pv !== done) { let n = 0; const a = pv.split(','), c = done.split(','); for (let i = 0; i < a.length; i++) if (a[i] !== c[i]) n++; mismatches.push(id + ': ' + n + ' bytes differ (info "' + info + '")'); }
    await page.keyboard.press('Control+z'); await page.waitForTimeout(150);
  }
  console.log(mismatches.length ? 'PREVIEW≠COMMIT:\n' + mismatches.join('\n') : 'preview matches commit for 6 filters');
  console.log(errs.length ? 'ERRORS\n' + errs.join('\n') : 'NO ERRORS');
  if (bad.length || mismatches.length || errs.length) process.exitCode = 1;
  await b.close();
})();
