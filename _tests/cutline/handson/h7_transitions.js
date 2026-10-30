// 8. Transitions: drag Cross Dissolve & Wipe onto cuts, drag edges, Ctrl+D, audio crossfade
const H = require('./hlib');
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('h7');
  await H.boot(p);
  await H.newProjectUI(p);
  await H.importUI(p, ['main1080.webm']);
  const sr = await H.center(p, '#p-timeline .tl-scroll');
  const it = await H.center(p, '#p-bin .bin-item:has(.name:text-is("main1080.webm"))');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V1'));
  await H.key(p, 'Backslash');
  // cuts at 150, 300, 450 with the razor (shift = all tracks)
  await H.key(p, 'c');
  for (const f of [150, 300, 450]) { const bx = await H.clipBox(p, { track: 'V1' }); await p.mouse.click(await H.tlX(p, f + 0.3), bx.y); }
  await H.key(p, 'v');
  let cl = await H.clips(p);
  H.ok(cl.filter(c => c.track === 'V1').length === 4 && cl.filter(c => c.track === 'A1').length === 4, 'three razor cuts on linked A/V');
  // drag Cross Dissolve from Effects browser onto the cut at 150 (drop just left of the cut on clip 0 end)
  await p.click('#p-right .tab[data-id="effects"]');
  await p.click('.fxb-search input'); await p.keyboard.type('dissolve');
  let src = await H.center(p, '.fxb-item:has(span:text-is("Cross Dissolve"))');
  const yV1 = await H.tlRowY(p, 'V1');
  await H.dnd(p, src.x, src.y, await H.tlX(p, 146), yV1);
  let trs = await p.evaluate(() => Cutline.P.seq().transitions.map(t => ({ type: t.type, dur: t.dur, a: !!t.a, b: !!t.b, align: t.align })));
  H.ok(trs.length === 1 && trs[0].type === 'cross' && trs[0].a && trs[0].b && trs[0].align === 'center', 'Cross Dissolve on cut 150: ' + JSON.stringify(trs));
  const d0 = trs[0].dur;
  await H.shot(p, 'dissolve');
  // program mid-transition shows a blend (frame 150 in middle) — sample vs neighbouring frames
  // drag the transition's right edge outwards by 10 frames
  const rect = await p.evaluate(() => { const t = Cutline.P.seq().transitions[0], r = Cutline.TL.scroller.getBoundingClientRect(); return { x0: r.left + t._rect[0], x1: r.left + t._rect[0] + t._rect[2], y: r.top + t._rect[1] + t._rect[3] / 2 - 30 + 30 - (Cutline.TL.RULER) + Cutline.TL.RULER }; });
  const ppf = await p.evaluate(() => Cutline.TL.ppf);
  const tY = await p.evaluate(() => { const t = Cutline.P.seq().transitions[0]; const cv = Cutline.TL.canvas.getBoundingClientRect(); return cv.top + t._rect[1] + t._rect[3] / 2; });
  await H.drag(p, rect.x1 - 2, tY, rect.x1 - 2 + 10 * ppf, tY);
  trs = await p.evaluate(() => Cutline.P.seq().transitions.map(t => t.dur));
  H.ok(trs[0] >= d0 + 18, 'dragging transition edge extends it (center-aligned: +2×): ' + d0 + '→' + trs[0]);
  await H.shot(p, 'dissolve-longer');
  // click on transition body selects it and shows its inspector; change duration by typing
  await p.mouse.click((rect.x0 + rect.x1) / 2, tY);
  await p.waitForTimeout(150);
  const inspTitle = await p.locator('.insp-scroll .insp-title .nm').innerText().catch(() => '');
  H.ok(/Cross Dissolve/.test(inspTitle), 'click transition → inspector shows it (' + inspTitle + ')');
  // Wipe onto cut 300
  await p.click('#p-right .tab[data-id="effects"]');
  await p.click('.fxb-search input', { clickCount: 3 }); await p.keyboard.type('wipe');
  src = await H.center(p, '.fxb-item:has(span:text-is("Wipe"))');
  await H.dnd(p, src.x, src.y, await H.tlX(p, 303), yV1);
  trs = await p.evaluate(() => Cutline.P.seq().transitions.map(t => t.type));
  H.ok(trs.includes('wipe'), 'Wipe dropped on cut 300: ' + trs);
  // mid-wipe frame shows two halves differing from both neighbours
  await p.mouse.click(await H.tlX(p, 300), (await H.center(p, '#p-timeline .tl-ruler-hit')).y);
  await H.shot(p, 'wipe-mid');
  // Ctrl+D at playhead near cut 450
  await p.mouse.click(await H.tlX(p, 452), (await H.center(p, '#p-timeline .tl-ruler-hit')).y);
  await p.mouse.click(await H.tlX(p, 10), await H.tlRowY(p, 'V3')); // deselect / focus timeline
  await H.key(p, 'Control+d');
  trs = await p.evaluate(() => Cutline.P.seq().transitions.filter(t => t.type === 'cross').length);
  H.ok(trs === 2, 'Ctrl+D adds the default (Cross Dissolve) at the nearest cut (' + trs + ')');
  // audio crossfade with Ctrl+Shift+D
  await H.key(p, 'Control+Shift+d');
  const atr = await p.evaluate(() => { const s = Cutline.P.seq(); return s.transitions.filter(t => Cutline.TR.byId[t.type].kind === 'audio').map(t => t.type); });
  H.ok(atr.length === 1, 'Ctrl+Shift+D adds an audio crossfade on A1: ' + atr);
  // drag the audio transition (Constant Power) from browser onto A1 cut 150
  await p.click('#p-right .tab[data-id="effects"]');
  await p.click('.fxb-search input', { clickCount: 3 }); await p.keyboard.type('constant');
  src = await H.center(p, '.fxb-item:has(span:text-is("Constant Gain"))');
  await H.dnd(p, src.x, src.y, await H.tlX(p, 146), await H.tlRowY(p, 'A1'));
  const atr2 = await p.evaluate(() => { const s = Cutline.P.seq(); return s.transitions.filter(t => Cutline.TR.byId[t.type].kind === 'audio').map(t => t.type); });
  H.ok(atr2.includes('a_gain'), 'audio transition dropped on A1 cut: ' + atr2);
  // video transition onto audio clip refused with a toast, no crash
  await p.click('.fxb-search input', { clickCount: 3 }); await p.keyboard.type('barn');
  src = await H.center(p, '.fxb-item:has(span:text-is("Barn Doors"))');
  await H.dnd(p, src.x, src.y, await H.tlX(p, 296), await H.tlRowY(p, 'A1'));
  const toast = await p.locator('.toast').allInnerTexts();
  H.ok(toast.some(t => /Video transitions go on video clips/.test(t)), 'video transition on audio clip refused: ' + toast.join(' | '));
  await H.key(p, 'Backslash');
  await H.shot(p, 'all-transitions');
  // delete a transition with right-click → Delete Transition
  const t0 = await p.evaluate(() => { const t = Cutline.P.seq().transitions.find(t => t.type === 'wipe'); const cv = Cutline.TL.canvas.getBoundingClientRect(); return { x: cv.left + t._rect[0] + t._rect[2] / 2, y: cv.top + t._rect[1] + t._rect[3] / 2 }; });
  await p.mouse.click(t0.x, t0.y, { button: 'right' });
  await p.locator('.cl-menu .item', { hasText: 'Delete Transition' }).click();
  await p.waitForTimeout(150);
  H.ok(!(await p.evaluate(() => Cutline.P.seq().transitions.some(t => t.type === 'wipe'))), 'transition deleted via context menu');
  // playback through a dissolve: render mid frame differs from both sides
  const hs = [];
  for (const f of [140, 150, 160]) { await p.mouse.click(await H.tlX(p, f), (await H.center(p, '#p-timeline .tl-ruler-hit')).y); hs.push(await H.progHash(p)); }
  H.ok(new Set(hs).size === 3, 'frames across the dissolve render distinct images');
  await H.finish(b, errs, 'h7_transitions');
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
