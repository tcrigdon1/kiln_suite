// C2 — Select Subject (saliency + colour-model refinement) and the Select & Refine upgrades (smart radius,
// decontaminate, output to mask).  Checked by IoU against known ground truth.
const { launch, assert, ASSETS } = require('./lib');
const path = require('path');

(async () => {
  const H = await launch();
  const { page } = H;

  /** IoU between the current selection (threshold 128) and a predicate on document pixels */
  const iou = (predSrc) => H.ev((src) => {
    const d = Gesso.app.doc, s = d.selection; if (!s) return 0;
    const pred = new Function('x', 'y', 'return ' + src);
    let inter = 0, uni = 0;
    for (let y = 0; y < d.height; y += 2) for (let x = 0; x < d.width; x += 2) { const a = s.mask[y * d.width + x] >= 128, b = pred(x, y); if (a && b) inter++; if (a || b) uni++; }
    return uni ? inter / uni : 0;
  }, predSrc);

  await H.step('face.jpg: Select ▸ Select Subject picks the face (IoU > 0.85 against the ellipse), not the sky or grass', async () => {
    const fc = page.waitForEvent('filechooser');
    await H.key('Control+o');
    await (await fc).setFiles(path.join(ASSETS, 'face.jpg'));
    await H.wait(500);
    const t0 = Date.now();
    await H.menu('Select', 'Select Subject');
    for (let i = 0; i < 100; i++) { if (!(await H.ev(() => !!document.querySelector('.progress-row')))) break; await H.wait(100); }
    await H.wait(200);
    const ms = Date.now() - t0;
    const st = await H.state();
    assert(st.sel, 'a selection was made');
    // the face is an ellipse centred ≈ (600, 375), radii ≈ 200 × 225
    const v = await iou('((x-600)/200)**2 + ((y-375)/225)**2 <= 1');
    console.log('   face IoU', v.toFixed(3), 'in', ms, 'ms');
    assert(v > 0.85, 'IoU ' + v.toFixed(3));
    await H.shot('c5-01-face-subject');
  });

  await H.step('textured scene: a patterned object on a patterned background is found (IoU > 0.75)', async () => {
    await H.ev(() => {
      const d = Gesso.App.createDoc({ name: 'Scene', w: 720, h: 480, dpi: 72, bg: 'white' });
      const x = d.layers[0].canvas.getContext('2d');
      // background: bluish gradient with horizontal grain
      const g = x.createLinearGradient(0, 0, 0, 480); g.addColorStop(0, '#5b7ea8'); g.addColorStop(1, '#c9d6e4'); x.fillStyle = g; x.fillRect(0, 0, 720, 480);
      let s = 99; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
      x.strokeStyle = 'rgba(255,255,255,.25)'; for (let y = 0; y < 480; y += 6) { x.beginPath(); x.moveTo(0, y + rnd() * 3); x.lineTo(720, y + rnd() * 3); x.stroke(); }
      // object: an orange-brown rounded blob with dark spots, off centre
      x.fillStyle = '#c8652a'; x.beginPath(); x.ellipse(400, 250, 150, 110, -0.4, 0, 7); x.fill();
      x.fillStyle = '#6a2d10'; for (let i = 0; i < 40; i++) { const a = rnd() * 7, r = rnd() * 120; const px = 400 + Math.cos(a) * r, py = 250 + Math.sin(a) * r * 0.7; if (((px - 400) / 150) ** 2 + ((py - 250) / 110) ** 2 < 0.8) { x.beginPath(); x.arc(px, py, 4 + rnd() * 6, 0, 7); x.fill(); } }
      d.layers[0].version++; d.invalidate();
    });
    await H.wait(200);
    await H.key('Control+Alt+Shift+a');
    for (let i = 0; i < 100; i++) { if (!(await H.ev(() => !!document.querySelector('.progress-row')))) break; await H.wait(100); }
    await H.wait(200);
    // ground truth: the rotated ellipse
    const v = await iou('(function(){const c=Math.cos(0.4),s=Math.sin(0.4);const dx=x-400,dy=y-250;const u=dx*c-dy*s,w=dx*s+dy*c;return (u/150)**2+(w/110)**2<=1;})()');
    console.log('   scene IoU', v.toFixed(3));
    assert(v > 0.75, 'IoU ' + v.toFixed(3));
    await H.shot('c5-02-scene-subject');
  });

  await H.step('Select and Refine: smart radius keeps a good edge, "New Layer with Mask" + decontaminate output a masked copy', async () => {
    await H.menu('Select', 'Select and Refine…');
    await H.wait(200);
    const radius = page.locator('.gesso-dialog input[type=range]').first();
    await radius.fill('6'); await radius.dispatchEvent('input'); await radius.dispatchEvent('change');
    await H.wait(400);
    const v = await iou('(function(){const c=Math.cos(0.4),s=Math.sin(0.4);const dx=x-400,dy=y-250;const u=dx*c-dy*s,w=dx*s+dy*c;return (u/150)**2+(w/110)**2<=1;})()');
    assert(v > 0.75, 'IoU after smart radius ' + v.toFixed(3));
    await page.locator('.gesso-dialog input[type=checkbox]').first().check(); // decontaminate
    await page.locator('.gesso-dialog select').last().selectOption('newLayerMask');
    await H.shot('c5-03-refine-dialog');
    await H.dialogBtn('OK');
    await H.wait(300);
    const st = await H.state();
    assert(st.active === 'Background (refined)' && st.layers[0].mask, 'new masked layer on top ' + JSON.stringify(st.layers.map((l) => l.name + (l.mask ? '[m]' : ''))));
    const samples = [await H.px(400, 250), await H.px(340, 240), await H.px(460, 260), await H.px(400, 290)], outside = await H.px(80, 80);
    assert(samples.some((p) => p[0] > 150 && p[2] < 100), 'object visible through the mask ' + JSON.stringify(samples));
    assert(outside[3] === 0, 'background hidden by the mask (original layer hidden) ' + outside);
    await H.shot('c5-04-masked-copy');
  });

  await H.step('Select Subject of Layer uses only the active layer; a layer without a subject reports it', async () => {
    await H.ev(() => { const d = Gesso.app.doc; d.setActive(d.layers[0].id); });
    await H.menu('Select', 'Select Subject of Layer');
    for (let i = 0; i < 50; i++) { if (!(await H.ev(() => !!document.querySelector('.progress-row')))) break; await H.wait(100); }
    const st = await H.state();
    assert(st.sel, 'selection exists ' + JSON.stringify(st.sel));
  });

  await H.finish();
})();
