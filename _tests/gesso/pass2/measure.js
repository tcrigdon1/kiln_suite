// Measures memory + open time for a watch design, and brush latency on a 4K doc (CDP Performance.getMetrics).
// Usage: node measure.js "Kiln Lattice"
const { ROOT } = require('../../env.js');
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const name = process.argv[2] || 'Kiln Lattice';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const cdp = await ctx.newCDPSession(p); await cdp.send('Performance.enable');
  const mem = async () => { const m = (await cdp.send('Performance.getMetrics')).metrics; const g = (k) => m.find((x) => x.name === k).value; return { js: Math.round(g('JSHeapUsedSize') / 1048576), docs: g('Documents'), nodes: g('Nodes') }; };
  const gpuMem = () => p.evaluate(() => { // sum of all canvas backing stores reachable from documents
    let bytes = 0; const seen = new Set();
    const vis = (c) => { if (!c || seen.has(c)) return; seen.add(c); bytes += c.width * c.height * 4; };
    for (const d of Gesso.app.docs) { d.walk((l) => { vis(l.canvas); if (l.mask) vis(l.mask.canvas); if (l._fxCache) vis(l._fxCache.canvas); }); vis(d.composite); }
    return Math.round(bytes / 1048576);
  });
  await p.goto('file://' + ROOT + '/Gesso/index.html'); await p.waitForTimeout(700);
  const m0 = await mem();
  const txt = fs.readFileSync(ROOT + '/_tests/watch/out/' + name + ' Concept.kgesso', 'utf8');
  const t0 = Date.now();
  await p.evaluate(async (t) => { const d = await Gesso.FileIO.loadProject(JSON.parse(t), 'x'); await new Promise((r) => setTimeout(r, 50)); Gesso.Compositor.update(d); }, txt);
  const tOpen = Date.now() - t0;
  await p.waitForTimeout(800);
  const m1 = await mem(); const canvasMB = await gpuMem();
  console.log(JSON.stringify({ name, openMs: tOpen, jsHeapBeforeMB: m0.js, jsHeapAfterMB: m1.js, layerCanvasMB: canvasMB }));
  // brush latency on a 4K doc
  await p.evaluate(() => Gesso.App.createDoc({ name: '4k', w: 3840, h: 2160, dpi: 72, bg: 'white' }));
  await p.waitForTimeout(300);
  await p.keyboard.press('b');
  await p.evaluate(() => { Gesso.Tools.byId.brush.opts.size = 60; });
  const pt = await p.evaluate(() => { const r = Gesso.View.canvas.getBoundingClientRect(); const s = Gesso.View.toScreen(400, 400); return [r.left + s[0], r.top + s[1]]; });
  const t1 = performance.now();
  await p.mouse.move(pt[0], pt[1]); await p.mouse.down();
  for (let i = 1; i <= 60; i++) await p.mouse.move(pt[0] + i * 8, pt[1] + Math.sin(i / 5) * 40);
  await p.mouse.up();
  const strokeMs = Math.round(performance.now() - t1);
  // frame time inside page: measure a second stroke via rAF stamps
  const frame = await p.evaluate(async (pt) => {
    const times = []; let last = performance.now(); let on = true;
    const tick = () => { const n = performance.now(); times.push(n - last); last = n; if (on) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
    await new Promise((r) => setTimeout(r, 600)); on = false;
    return { avgFrameMs: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1), maxFrameMs: +Math.max(...times).toFixed(1) };
  }, pt);
  console.log(JSON.stringify({ brush4kStroke60ptsMs: strokeMs, idle: frame }));
  console.log(errs.length ? 'ERRORS\n' + errs.join('\n') : 'NO ERRORS');
  await b.close();
})();
