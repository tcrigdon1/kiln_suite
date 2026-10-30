// C1 — Patch Fill (content fill) and the Remove tool: texture must be rebuilt, not blurred.
// A striped + noisy texture is drawn, an object painted over it, the object removed with the Remove tool; the
// filled area is compared with the original texture (which we still know) and with what a blur would give.
const { launch, assert } = require('./lib');

(async () => {
  const H = await launch();
  const { page } = H;
  await H.ev(() => {
    const d = Gesso.App.createDoc({ name: 'Tex', w: 640, h: 420, dpi: 72, bg: 'white' });
    const l = d.layers[0], c = l.canvas, x = c.getContext('2d');
    // diagonal stripes with a brick-ish grid and grain
    x.fillStyle = '#c9b48a'; x.fillRect(0, 0, 640, 420);
    x.strokeStyle = '#6b4e2a'; x.lineWidth = 7;
    for (let k = -600; k < 1200; k += 28) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k + 420, 420); x.stroke(); }
    x.strokeStyle = 'rgba(40,30,20,.35)'; x.lineWidth = 2;
    for (let y = 0; y < 420; y += 40) { x.beginPath(); x.moveTo(0, y); x.lineTo(640, y); x.stroke(); }
    const img = x.getImageData(0, 0, 640, 420), p = img.data;
    let s = 12345; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < p.length; i += 4) { const n = (rnd() - 0.5) * 36; p[i] += n; p[i + 1] += n; p[i + 2] += n; }
    x.putImageData(img, 0, 0);
    window.__orig = x.getImageData(0, 0, 640, 420).data;
    // the "object": a red disc with a dark outline
    x.fillStyle = '#e03030'; x.beginPath(); x.arc(320, 210, 46, 0, 7); x.fill(); x.strokeStyle = '#300'; x.lineWidth = 4; x.stroke();
    l.version++; d.invalidate();
  });
  await H.wait(200);
  await H.shot('c4-01-before');

  const stats = () => H.ev(() => {
    const d = Gesso.app.doc; Gesso.Compositor.update(d);
    const now = d.composite.getContext('2d').getImageData(0, 0, 640, 420).data, o = window.__orig, W = 640;
    let se = 0, n = 0, red = 0, grad = 0, gradOut = 0, nOut = 0;
    for (let y = 150; y < 270; y++) for (let x = 260; x < 380; x++) {
      const i = (y * W + x) * 4, inside = Math.hypot(x - 320, y - 210) < 50;
      const g = Math.abs(now[i] - now[i + 4]) + Math.abs(now[i] - now[i + W * 4]);
      if (inside) { for (let c = 0; c < 3; c++) se += (now[i + c] - o[i + c]) ** 2; n++; if (now[i] > 180 && now[i + 1] < 90) red++; grad += g; }
      else { gradOut += g; nOut++; }
    }
    const mse = se / (n * 3);
    return { psnr: 10 * Math.log10(255 * 255 / Math.max(1, mse)), red, gradIn: grad / n, gradOut: gradOut / nOut };
  });
  const s0 = await stats();
  assert(s0.red > 3000, 'the object is there (' + s0.red + ' red px)');

  await H.step('Remove tool: lasso around the object rebuilds the stripes (no red left, texture energy like the surroundings, PSNR vs the real texture well above a blur)', async () => {
    await H.tool('remove');
    const pts = []; for (let a = 0; a <= 24; a++) { const t = (a / 24) * Math.PI * 2; pts.push([320 + Math.cos(t) * 56, 210 + Math.sin(t) * 56]); }
    await H.dragDoc(pts, { steps: 2 });
    // wait for the progress bar to finish (the fill runs asynchronously)
    for (let i = 0; i < 100; i++) { if (!(await H.ev(() => !!document.querySelector('.progress-row')))) break; await H.wait(100); }
    await H.wait(200);
    const s1 = await stats();
    await H.shot('c4-02-removed');
    assert(s1.red < 40, 'red object gone (' + s1.red + ' px left)');
    assert(s1.gradIn > s1.gradOut * 0.55, 'filled area keeps texture detail: ' + s1.gradIn.toFixed(1) + ' vs surroundings ' + s1.gradOut.toFixed(1) + ' (a blur would be near 0)');
    assert(s1.psnr > 13, 'reconstruction resembles the real texture: PSNR ' + s1.psnr.toFixed(1) + ' dB');
    const st = await H.state();
    assert(st.histName === 'Remove' && !st.sel, 'one history step named Remove, selection restored (none)');
    console.log('   stats', JSON.stringify(s1));
  });

  await H.step('Undo restores the object; Edit ▸ Patch Fill via the menu with a marquee selection fills it again; Esc during the fill cancels', async () => {
    await H.key('Control+z');
    const s2 = await stats(); assert(s2.red > 3000, 'undo restored the object');
    await H.key('m');
    await H.dragDoc([[266, 156], [374, 264]]);
    await H.menu('Edit', 'Patch Fill (from surroundings)…');
    await H.wait(150);
    assert(await H.dialogOpen(), 'Patch Fill dialog');
    await H.shot('c4-03-dialog');
    await H.dialogBtn('OK');
    await H.wait(60);
    // cancel right away
    assert(await H.ev(() => !!document.querySelector('.progress-row')), 'progress bar shown');
    await page.keyboard.press('Escape');
    for (let i = 0; i < 100; i++) { if (!(await H.ev(() => !!document.querySelector('.progress-row')))) break; await H.wait(100); }
    const s3 = await stats(); assert(s3.red > 3000, 'cancelled: object still there');
    const h0 = (await H.state()).hist;
    // and run it to completion
    await H.menu('Edit', 'Patch Fill (from surroundings)…');
    await H.dialogBtn('OK');
    for (let i = 0; i < 150; i++) { if (i > 3 && !(await H.ev(() => !!document.querySelector('.progress-row')))) break; await H.wait(100); }
    await H.wait(200);
    const s4 = await stats();
    assert(s4.red < 40 && s4.psnr > 13, 'filled from the menu: red ' + s4.red + ' psnr ' + s4.psnr.toFixed(1));
    assert((await H.state()).hist === h0 + 1, 'one history step');
    await H.shot('c4-04-menu-fill');
  });

  await H.step('Fill dialog (Shift+F5) offers "Patch from surroundings"', async () => {
    await H.key('Control+z');
    await H.key('Shift+F5');
    await H.wait(150);
    const opts = await H.ev(() => [...document.querySelectorAll('.gesso-dialog select option')].map((o) => o.textContent));
    assert(opts.some((o) => /Patch from surroundings/.test(o)), 'option present: ' + opts.join(' | '));
    await page.locator('.gesso-dialog select').first().selectOption('patch');
    await H.dialogBtn('OK');
    for (let i = 0; i < 150; i++) { if (i > 3 && !(await H.ev(() => !!document.querySelector('.progress-row')))) break; await H.wait(100); }
    await H.wait(200);
    const s5 = await stats(); assert(s5.red < 40, 'filled via the Fill dialog');
  });

  await H.finish();
})();
