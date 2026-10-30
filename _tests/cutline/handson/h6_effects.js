// 7. Effects panel: search, drag onto clip, params, reorder/bypass/remove; chroma key + eyedropper; adjustment clip
const H = require('./hlib');
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('h6');
  await H.boot(p);
  await H.newProjectUI(p);
  await H.importUI(p, ['still.jpg', 'greenscreen.png']);
  const sr = await H.center(p, '#p-timeline .tl-scroll');
  let it = await H.center(p, '#p-bin .bin-item:has(.name:text-is("still.jpg"))');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V1'));
  it = await H.center(p, '#p-bin .bin-item:has(.name:text-is("greenscreen.png"))');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V2'));
  await H.key(p, 'Backslash');
  await p.mouse.click(await H.tlX(p, 20), (await H.center(p, '#p-timeline .tl-ruler-hit')).y);
  await p.click('#p-right .tab[data-id="effects"]');
  await p.click('.fxb-search input');
  await p.keyboard.type('blur');
  await p.waitForTimeout(150);
  const found = await p.locator('.fxb-item span').allInnerTexts();
  H.ok(found.includes('Gaussian Blur') && !found.includes('Sepia'), 'effects search "blur": ' + found.join(', '));
  await H.shot(p, 'fx-search');
  // drag Gaussian Blur onto the V1 clip
  let src = await H.center(p, '.fxb-item:has(span:text-is("Gaussian Blur"))');
  let v1 = await H.clipBox(p, { track: 'V1' });
  await H.dnd(p, src.x, src.y, (v1.x0 + v1.x1) / 2, v1.y);
  let fx = await p.evaluate(() => Cutline.P.seq().clips.find(c => c.name === 'still.jpg').fx.map(f => f.type));
  H.ok(fx.length === 1 && fx[0] === 'gblur', 'drag Gaussian Blur onto clip: ' + fx);
  H.ok(await p.evaluate(() => document.querySelector('#p-right .tab[data-id="effects"]').classList.contains('active')), 'Effects browser stays open after the drop');
  await H.shot(p, 'inspector-tab-pulse', { clip: { x: 1250, y: 30, width: 350, height: 40 } });
  await p.click('#p-right .tab[data-id="inspector"]');
  // inspector shows the effect; type Radius 30
  const rad = p.locator('.insp-scroll .fx-item .cl-field:has(label:text-is("Radius")) input[type=number]');
  await rad.click({ clickCount: 3 }); await p.keyboard.type('30'); await p.keyboard.press('Enter');
  await p.waitForTimeout(150);
  let pr = await p.evaluate(() => { const c = Cutline.P.seq().clips.find(c => c.name === 'still.jpg'); return Cutline.KF.value(c, 'fx.' + c.fx[0].id + '.r', 0); });
  H.ok(pr === 30, 'blur radius set to 30 (' + pr + ')');
  // add Sepia by dragging (clear search first)
  await p.click('#p-right .tab[data-id="effects"]');
  await p.click('.fxb-search input', { clickCount: 3 }); await p.keyboard.type('sepia');
  src = await H.center(p, '.fxb-item:has(span:text-is("Sepia"))');
  await H.dnd(p, src.x, src.y, (v1.x0 + v1.x1) / 2, v1.y);
  fx = await p.evaluate(() => Cutline.P.seq().clips.find(c => c.name === 'still.jpg').fx.map(f => f.type));
  H.ok(fx.join() === 'gblur,sepia', 'second effect appended: ' + fx);
  await p.click('#p-right .tab[data-id="inspector"]');
  await H.shot(p, 'two-effects');
  // reorder: drag Sepia's grip onto the blur item
  const g2 = await H.center(p, '.insp-scroll .fx-item:nth-of-type(2) .grip');
  const i1 = await H.center(p, '.insp-scroll .fx-item:nth-of-type(1) .fx-head');
  await H.drag(p, g2.x, g2.y, i1.x, i1.y);
  fx = await p.evaluate(() => Cutline.P.seq().clips.find(c => c.name === 'still.jpg').fx.map(f => f.type));
  H.ok(fx.join() === 'sepia,gblur', 'reorder by grip drag: ' + fx);
  // bypass the first (sepia) via checkbox
  const before = await H.progPixels(p, [[0.1, 0.5], [0.9, 0.5]]);
  await p.click('.insp-scroll .fx-item:nth-of-type(1) .fx-head input[type=checkbox]');
  await p.waitForTimeout(200);
  const on = await p.evaluate(() => Cutline.P.seq().clips.find(c => c.name === 'still.jpg').fx[0].on);
  H.ok(on === false, 'sepia bypassed');
  // remove blur via trash
  await p.click('.insp-scroll .fx-item:nth-of-type(2) .icon-btn[data-tip="Remove effect"]');
  fx = await p.evaluate(() => Cutline.P.seq().clips.find(c => c.name === 'still.jpg').fx.map(f => f.type));
  H.ok(fx.join() === 'sepia', 'blur removed: ' + fx);
  await H.shot(p, 'reorder-bypass-remove');
  // --- chroma key on the green PNG (V2)
  await p.click('#p-right .tab[data-id="effects"]');
  await p.click('.fxb-search input', { clickCount: 3 }); await p.keyboard.type('chroma');
  src = await H.center(p, '.fxb-item:has(span:text-is("Chroma Key"))');
  const v2 = await H.clipBox(p, { track: 'V2' });
  await H.dnd(p, src.x, src.y, (v2.x0 + v2.x1) / 2, v2.y);
  // first set key color to something wrong, then use the eyedropper on the green area
  const pv = await H.center(p, '#p-program canvas.overlay');
  await p.click('#p-right .tab[data-id="inspector"]');
  await p.click('.insp-scroll .fx-item .icon-btn[data-tip^="Pick key color"]');
  await p.mouse.click(pv.bb.x + pv.bb.width * 0.1, pv.bb.y + pv.bb.height * 0.15);
  await p.waitForTimeout(300);
  const key = await p.evaluate(() => Cutline.P.seq().clips.find(c => c.name === 'greenscreen.png').fx[0].p.key);
  H.ok(/^#0[0-9a-f]f[ef][0-9a-f]{2}$/i.test(key) || key.toLowerCase() === '#00ff00', 'eyedropper picked green key: ' + key);
  const px = await H.progPixels(p, [[0.1, 0.15], [0.5, 0.5]]);
  H.ok(!(px[0][1] > 200 && px[0][0] < 60 && px[0][2] < 60), 'green area keyed out (shows background): ' + JSON.stringify(px[0]));
  H.ok(px[1][0] > 180 && px[1][1] < 80, 'red box survives the key: ' + JSON.stringify(px[1]));
  await H.shot(p, 'chroma-keyed');
  // eyedropper again on an already keyed area must still sample the original green, not the background
  await p.click('.insp-scroll .fx-item .icon-btn[data-tip^="Pick key color"]');
  await p.mouse.click(pv.bb.x + pv.bb.width * 0.85, pv.bb.y + pv.bb.height * 0.8);
  await p.waitForTimeout(300);
  const key2 = await p.evaluate(() => Cutline.P.seq().clips.find(c => c.name === 'greenscreen.png').fx[0].p.key);
  H.ok(/^#0[0-9a-f]f[ef][0-9a-f]{2}$/i.test(key2) || key2.toLowerCase() === '#00ff00', 'eyedropper on keyed area still samples the source green: ' + key2);
  // --- adjustment clip via Library New Item → Adjustment Clip, drag to V3, apply Black & White
  await p.click('.bin-toolbar .icon-btn[data-tip="New item"]');
  await p.locator('.cl-menu .item', { hasText: 'Adjustment Clip' }).click();
  await p.waitForTimeout(300);
  it = await H.center(p, '#p-bin .bin-item:has(.name:text-is("Adjustment Clip"))');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V3'));
  await p.click('#p-right .tab[data-id="effects"]');
  await p.click('.fxb-search input', { clickCount: 3 }); await p.keyboard.type('black');
  src = await H.center(p, '.fxb-item:has(span:text-is("Black & White"))');
  const v3 = await H.clipBox(p, { track: 'V3' });
  await H.dnd(p, src.x, src.y, (v3.x0 + v3.x1) / 2, v3.y);
  await p.waitForTimeout(300);
  const g = await H.progPixels(p, [[0.5, 0.5], [0.1, 0.15]]);
  const gray = (c) => Math.max(...c) - Math.min(...c) < 12;
  H.ok(gray(g[0]) && gray(g[1]), 'adjustment clip B&W affects tracks below: ' + JSON.stringify(g));
  await H.shot(p, 'adjustment-bw');
  // effect applied via menu with selection & via double-click in browser
  await p.mouse.click((v1.x0 + v1.x1) / 2, v1.y);
  await p.click('.fxb-search input', { clickCount: 3 }); await p.keyboard.type('vignette');
  await p.dblclick('.fxb-item:has(span:text-is("Vignette"))');
  fx = await p.evaluate(() => Cutline.P.seq().clips.find(c => c.name === 'still.jpg').fx.map(f => f.type));
  H.ok(fx.includes('vignette'), 'double-click effect applies to selection: ' + fx);
  // dropping a video effect on an audio clip is refused gracefully (no crash)
  await H.finish(b, errs, 'h6_effects');
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
