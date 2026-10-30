// 5+6. Program monitor on-canvas transform + Inspector fields & keyframes
const H = require('./hlib');
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('h5');
  await H.boot(p);
  await H.newProjectUI(p);
  await H.importUI(p, ['main1080.webm', 'still.jpg']);
  const sr = await H.center(p, '#p-timeline .tl-scroll');
  let it = await H.center(p, '#p-bin .bin-item:has(.name:text-is("still.jpg"))');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V1'));
  it = await H.center(p, '#p-bin .bin-item:has(.name:text-is("main1080.webm"))');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V2'));
  await H.key(p, 'Backslash');
  // select V2 clip by clicking it in the program monitor
  await p.mouse.click(await H.tlX(p, 30), (await H.center(p, '#p-timeline .tl-ruler-hit')).y);
  const pv = await H.center(p, '#p-program canvas.overlay');
  await p.mouse.click(pv.x, pv.y);
  await p.waitForTimeout(200);
  const selName = await p.evaluate(() => { const c = Cutline.P.primaryClip(); return c && c.name + ':' + c.kind; });
  H.ok(selName === 'main1080.webm:video', 'clicking program monitor selects topmost clip (' + selName + ')');
  await H.shot(p, 'selected-in-program');
  const tf = () => p.evaluate(() => { const c = Cutline.P.primaryClip(); return Object.assign({}, c.tf); });
  // move: drag inside frame by (+60,+30) screen px
  const k = await p.evaluate(() => Cutline.Program.sk);
  await H.drag(p, pv.x - 40, pv.y - 20, pv.x + 20, pv.y + 10);
  let t = await tf();
  H.ok(Math.abs(t.x - (960 + 60 / k)) < 3 && Math.abs(t.y - (540 + 30 / k)) < 3, 'drag in program moves clip: x ' + t.x + ', y ' + t.y + ' (k=' + k.toFixed(3) + ')');
  // scale: drag bottom-right corner handle outward
  const corner = await p.evaluate(() => { const h = Cutline.Program.handles.find(h => h.kind === 'corner' && h.i === 0); const r = Cutline.Program.overlay.getBoundingClientRect(); return { x: r.left + h.p[0], y: r.top + h.p[1] }; });
  await H.drag(p, corner.x, corner.y, corner.x + 60, corner.y + 34);
  t = await tf();
  H.ok(t.scale < 90 && t.scale > 40, 'corner drag inward scales down to ' + t.scale);
  // rotate handle
  const rot = await p.evaluate(() => { const h = Cutline.Program.handles.find(h => h.kind === 'rot'); const r = Cutline.Program.overlay.getBoundingClientRect(); return { x: r.left + h.p[0], y: r.top + h.p[1] }; });
  await H.drag(p, rot.x, rot.y, rot.x + 80, rot.y + 25);
  t = await tf();
  H.ok(Math.abs(t.rot) > 10, 'rotation handle rotates (' + t.rot + '°)');
  await H.shot(p, 'transformed');
  // safe margins toggle & zoom via the More menu (buttons hidden at this monitor width)
  await p.click('#p-program .icon-btn[data-tip="More display options"]');
  await H.shot(p, 'more-menu');
  await p.locator('.cl-menu .item', { hasText: 'Safe Margins' }).click();
  await p.waitForTimeout(100);
  H.ok(await p.evaluate(() => Cutline.Program.safe), 'safe margins on via More menu');
  await p.click('#p-program .icon-btn[data-tip="More display options"]');
  await p.locator('.cl-menu .item', { hasText: 'Zoom' }).hover();
  await p.waitForTimeout(150);
  await p.locator('.cl-menu').last().locator('.item', { hasText: '50%' }).click();
  await p.waitForTimeout(200);
  H.ok(await p.evaluate(() => Cutline.Program.zoom === '0.5'), 'program zoom 50%');
  await H.shot(p, 'safe-zoom50');
  await p.click('#p-program .icon-btn[data-tip="More display options"]');
  await p.locator('.cl-menu .item', { hasText: 'Zoom' }).hover(); await p.waitForTimeout(150);
  await p.locator('.cl-menu').last().locator('.item', { hasText: 'Fit' }).click();
  // full-screen toggle
  await p.click('#p-program .icon-btn[data-tip="Full-screen preview"]');
  await p.waitForTimeout(500);
  const fsOn = await p.evaluate(() => !!document.fullscreenElement);
  await H.shot(p, 'fullscreen');
  H.ok(fsOn, 'full-screen preview entered');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  if (await p.evaluate(() => !!document.fullscreenElement)) await p.click('#p-program .icon-btn[data-tip="Full-screen preview"]').catch(() => {});
  await p.evaluate(() => document.fullscreenElement && document.exitFullscreen());
  await p.waitForTimeout(300);
  // reset transform (inspector button)
  await p.click('.insp-scroll .cl-section .sec-tools .icon-btn[data-tip="Reset transform"]');
  t = await tf();
  H.ok(t.x === 960 && t.scale === 100 && t.rot === 0, 'reset transform');
  // --- Inspector: scrub Position X label by dragging
  const lab = await H.center(p, '.insp-scroll .cl-field:has(label:text-is("Position X")) label.scrub');
  await H.drag(p, lab.x, lab.y, lab.x + 50, lab.y, { steps: 10 });
  t = await tf();
  H.ok(t.x > 990 && t.x < 1030, 'scrub Position X label +50px → ' + t.x);
  // type into Scale field
  const sc = p.locator('.insp-scroll .cl-field:has(label:text-is("Scale")) input[type=number]');
  await sc.click({ clickCount: 3 }); await p.keyboard.type('50'); await p.keyboard.press('Enter');
  await p.waitForTimeout(150);
  t = await tf();
  H.ok(t.scale === 50, 'typed Scale 50 → ' + t.scale);
  // opacity slider: drag range thumb left
  const op = p.locator('.insp-scroll .cl-field:has(label:text-is("Opacity")) input[type=range]');
  const ob = await op.boundingBox();
  await H.drag(p, ob.x + ob.width - 4, ob.y + ob.height / 2, ob.x + ob.width * 0.5, ob.y + ob.height / 2);
  t = await tf();
  H.ok(t.op > 35 && t.op < 65, 'opacity slider drag → ' + t.op);
  // undo the last 3 property changes and confirm values restore stepwise
  await p.mouse.click(await H.tlX(p, 300), await H.tlRowY(p, 'V3'));
  await H.key(p, 'Control+z');
  // reselect
  await p.mouse.click(pv.x, pv.y); await p.waitForTimeout(150);
  t = await tf();
  H.ok(t.op === 100 && t.scale === 50, 'undo reverts opacity only (op ' + t.op + ', scale ' + t.scale + ')');
  await H.shot(p, 'inspector-values');
  // --- keyframes: stopwatch on Position X at frame 30, move to frame 90, type new value
  await p.mouse.click(await H.tlX(p, 30), (await H.center(p, '#p-timeline .tl-ruler-hit')).y);
  await p.click('.insp-scroll .cl-field:has(label:text-is("Position X")) .kf-btn[title^="Toggle animation"]');
  await p.waitForTimeout(150);
  await p.mouse.click(await H.tlX(p, 90), (await H.center(p, '#p-timeline .tl-ruler-hit')).y);
  const f90 = await H.frame(p);
  const px = p.locator('.insp-scroll .cl-field:has(label:text-is("Position X")) input[type=number]');
  await px.click({ clickCount: 3 }); await p.keyboard.type('400'); await p.keyboard.press('Enter');
  await p.waitForTimeout(150);
  const kf = await p.evaluate(() => { const c = Cutline.P.primaryClip(); return (c.kf['tf.x'] || []).map(k => [k.f, k.v, k.e]); });
  H.ok(kf.length === 2 && kf[1][1] === 400, 'two Position X keyframes: ' + JSON.stringify(kf));
  // midpoint interpolation
  const mid = Math.round((kf[0][0] + kf[1][0]) / 2);
  const cs = await p.evaluate(() => Cutline.P.primaryClip().start);
  await p.mouse.click(await H.tlX(p, cs + mid), (await H.center(p, '#p-timeline .tl-ruler-hit')).y);
  const vmid = parseFloat(await px.inputValue());
  const expMid = (kf[0][1] + 400) / 2;
  H.ok(Math.abs(vmid - expMid) < 25, 'interpolated mid value ' + vmid + ' ≈ ' + expMid);
  await H.shot(p, 'keyframes');
  // ease menu: right-click second keyframe diamond in the lane
  const dia = p.locator('.insp-scroll .cl-field:has(label:text-is("Position X")) + .kf-lane .dia').nth(1);
  await dia.click({ button: 'right' });
  await p.waitForTimeout(150);
  const easeItems = await p.locator('.cl-menu .item .lbl').allInnerTexts();
  await H.shot(p, 'ease-menu');
  H.ok(easeItems.length >= 3, 'ease menu items: ' + easeItems.join(', ').replace(/\n/g, ''));
  const easeName = easeItems.find(x => /Ease In|Ease Out|Ease/.test(x));
  await p.locator('.cl-menu .item .lbl:text-is("Ease In-Out")').first().click();
  await p.waitForTimeout(200);
  const kfE = await p.evaluate(() => Cutline.P.primaryClip().kf['tf.x'].map(k => k.e));
  H.ok(kfE[1] !== 'linear' || kfE[0] !== 'linear', 'easing changed: ' + kfE);
  // drag first keyframe diamond to the right in the lane
  const d0 = p.locator('.insp-scroll .cl-field:has(label:text-is("Position X")) + .kf-lane .dia').first();
  const db = await d0.boundingBox();
  await H.drag(p, db.x + db.width / 2, db.y + db.height / 2, db.x + db.width / 2 + 25, db.y + db.height / 2);
  const kf2 = await p.evaluate(() => Cutline.P.primaryClip().kf['tf.x'].map(k => k.f));
  H.ok(kf2[0] > kf[0][0], 'drag keyframe in lane moves it (' + kf[0][0] + '→' + kf2[0] + ')');
  // keyframes visible on timeline clip and draggable there
  await H.shot(p, 'kf-dragged');
  // next/prev keyframe buttons
  await p.click('.insp-scroll .cl-field:has(label:text-is("Position X")) .kf-btn[title="Previous keyframe"]');
  const fp = await H.frame(p);
  H.ok(fp === cs + kf2[0], 'previous-keyframe button jumps to first key (' + fp + ')');
  // dragging in program monitor while animated adds/updates a key at playhead
  await p.mouse.click(await H.tlX(p, cs + 60), (await H.center(p, '#p-timeline .tl-ruler-hit')).y);
  await H.drag(p, pv.x, pv.y, pv.x + 30, pv.y);
  const kf3 = await p.evaluate(() => Cutline.P.primaryClip().kf['tf.x'].length);
  H.ok(kf3 === 3, 'program-monitor drag while animated adds a keyframe (' + kf3 + ')');
  await H.finish(b, errs, 'h5_program');
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
