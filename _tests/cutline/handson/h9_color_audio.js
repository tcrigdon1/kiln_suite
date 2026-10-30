// 10+11. Color tab (wheels, curves, sliders, scopes) and audio (faders, pan, volume line, fades, audio fx, normalize, voiceover)
const H = require('./hlib');
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('h9');
  await H.boot(p);
  await H.newProjectUI(p);
  await H.importUI(p, ['main1080.webm', 'music.mp3']);
  const sr = await H.center(p, '#p-timeline .tl-scroll');
  let it = await H.center(p, '#p-bin .bin-item:has(.name:text-is("main1080.webm"))');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V1'));
  it = await H.center(p, '#p-bin .bin-item:has(.name:text-is("music.mp3"))');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'A2'));
  await H.key(p, 'Backslash');
  const ruler = async (f) => p.mouse.click(await H.tlX(p, f), (await H.center(p, '#p-timeline .tl-ruler-hit')).y);
  await ruler(60);
  const v1 = await H.clipBox(p, { track: 'V1' });
  await p.mouse.click((v1.x0 + v1.x1) / 2, v1.y);
  // --- Color workspace button
  await p.click('.ws-btns .ws[data-ws="color"]');
  await p.waitForTimeout(400);
  H.ok(await p.evaluate(() => document.querySelector('#p-right .tab[data-id="color"]').classList.contains('active')), 'Color workspace shows the Color tab');
  const scopeInk = async () => p.evaluate(() => { const cv = Cutline.ColorPanel.scopeCv; const g = cv.getContext('2d'); const d = g.getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) n++; return n; });
  await p.waitForTimeout(400);
  const ink = await scopeInk();
  H.ok(ink > 500, 'waveform scope renders (' + ink + ' lit px)');
  await H.shot(p, 'color-tab');
  // scopes select: parade / vectorscope / histogram
  for (const sc of ['parade', 'vector', 'histogram']) {
    await p.selectOption('.scopes select', sc); await p.waitForTimeout(250);
    H.ok((await scopeInk()) > 200, sc + ' scope renders');
  }
  await H.shot(p, 'histogram');
  await p.selectOption('.scopes select', 'waveform');
  // --- slider: drag Saturation range to 0
  const pxBefore = await H.progPixels(p, [[0.3, 0.3]]);
  const sat = p.locator('#p-right .cl-field:has(label:text-is("Saturation")) input[type=range]');
  await sat.scrollIntoViewIfNeeded();
  const sb = await sat.boundingBox();
  await H.drag(p, sb.x + sb.width / 2, sb.y + sb.height / 2, sb.x + 1, sb.y + sb.height / 2);
  const colSat = await p.evaluate(() => Cutline.P.primaryClip().col && Cutline.P.primaryClip().col.sat);
  H.ok(colSat === 0, 'saturation slider dragged to 0 (' + colSat + ')');
  const pxAfter = await H.progPixels(p, [[0.3, 0.3]]);
  const spread = (c) => Math.max(...c) - Math.min(...c);
  H.ok(spread(pxAfter[0]) < 10 && spread(pxBefore[0]) > 50, 'program goes grayscale: ' + JSON.stringify(pxBefore) + '→' + JSON.stringify(pxAfter));
  await H.key(p, 'Control+z');
  // --- wheel: drag the Highlights wheel puck toward blue
  const wheel = p.locator('#p-right .wheel:has(.wlabel:text-is("Highlights")) canvas');
  await wheel.scrollIntoViewIfNeeded();
  const wb = await wheel.boundingBox();
  await H.drag(p, wb.x + wb.width / 2, wb.y + wb.height / 2, wb.x + wb.width * 0.8, wb.y + wb.height * 0.5);
  const hi = await p.evaluate(() => { const c = Cutline.P.primaryClip(); return c.col ? [c.col.hiX, c.col.hiY] : null; });
  H.ok(hi && hi[0] > 40, 'highlights wheel drag sets hiX/hiY ' + JSON.stringify(hi));
  await H.shot(p, 'wheel');
  // --- curves: add a point and drag it up
  const cv = p.locator('#p-right .curves-wrap canvas');
  await cv.scrollIntoViewIfNeeded();
  const cb = await cv.boundingBox();
  await H.drag(p, cb.x + cb.width * 0.5, cb.y + cb.height * 0.5, cb.x + cb.width * 0.5, cb.y + cb.height * 0.3);
  const curve = await p.evaluate(() => Cutline.P.primaryClip().col.curves.m);
  H.ok(curve.length === 3 && curve[1][1] > 0.6, 'curve point added and raised: ' + JSON.stringify(curve));
  await H.shot(p, 'curves');
  // undo curve and wheel
  const hist = await p.evaluate(() => Cutline.H.undo.map(u => u.label).slice(-3));
  H.info('history tail: ' + hist.join(' | '));
  // --- color on a fresh clip with no grade: dragging a wheel first must not throw
  await H.key(p, 'Control+z'); await H.key(p, 'Control+z');
  await p.click('#p-right .insp-title .icon-btn[data-tip="Reset all grading"]');
  await p.waitForTimeout(200);
  await wheel.scrollIntoViewIfNeeded();
  const wb2 = await wheel.boundingBox();
  H.ok(await p.evaluate(() => { const c = Cutline.P.primaryClip(); return !c.col || Cutline.P.colorIsDefault(c.col); }), 'reset all grading clears the grade');
  await H.drag(p, wb2.x + wb2.width / 2, wb2.y + wb2.height / 2, wb2.x + wb2.width * 0.5, wb2.y + wb2.height * 0.2); void wb.x;
  H.ok(await p.evaluate(() => { const c = Cutline.P.primaryClip(); return !!(c.col && c.col.hiY > 0); }), 'wheel works on an ungraded clip: ' + await p.evaluate(() => JSON.stringify(Cutline.P.primaryClip().col && [Cutline.P.primaryClip().col.hiX, Cutline.P.primaryClip().col.hiY])) + JSON.stringify(wb2));
  await H.shot(p, 'wheel-after-reset');
  // --- Audio workspace: track fader & pan
  await p.click('.ws-btns .ws[data-ws="audio"]');
  await p.waitForTimeout(300);
  await H.shot(p, 'audio-tab');
  const fader = p.locator('#p-right .strip:has(.sname:text-is("A2")) input.fader');
  const fb = await fader.boundingBox();
  info('fader box ' + JSON.stringify(fb));
  // vertical or horizontal? drag along its long axis toward minimum
  if (fb.height > fb.width) await H.drag(p, fb.x + fb.width / 2, fb.y + fb.height * 0.2, fb.x + fb.width / 2, fb.y + fb.height * 0.6);
  else await H.drag(p, fb.x + fb.width * 0.8, fb.y + fb.height / 2, fb.x + fb.width * 0.4, fb.y + fb.height / 2);
  const tv = await p.evaluate(() => { const s = Cutline.P.seq(); return s.tracks.find(t => Cutline.P.trackLabel(s, t) === 'A2').vol; });
  H.ok(tv < -3, 'A2 fader dragged down → ' + tv + ' dB');
  const pan = p.locator('#p-right .strip:has(.sname:text-is("A2")) input.pan');
  const pb = await pan.boundingBox();
  await H.drag(p, pb.x + pb.width / 2, pb.y + pb.height / 2, pb.x + pb.width * 0.15, pb.y + pb.height / 2);
  const tp = await p.evaluate(() => { const s = Cutline.P.seq(); return s.tracks.find(t => Cutline.P.trackLabel(s, t) === 'A2').pan; });
  H.ok(tp < -40, 'A2 pan dragged left → ' + tp);
  // --- clip volume line drag on the A2 music clip
  const a2 = await H.clipBox(p, { track: 'A2' });
  const vy = await p.evaluate((id) => { const C = Cutline, TL = C.TL, s = C.P.seq(), c = C.P.clip(s, id), r = TL.rowOf(c.trackId); const headH = Math.min(15, (r.h - 2) * 0.32), bodyY = headH + 1, bodyH = r.h - 2 - headH; return TL.scroller.getBoundingClientRect().top + r.y - TL.scrollY + bodyY + bodyH * (1 - (c.au.vol + 60) / 72); }, a2.id);
  await p.mouse.move((a2.x0 + a2.x1) / 2, vy);
  const cur = await p.evaluate(() => Cutline.TL.scroller.style.cursor);
  H.ok(cur === 'ns-resize', 'hovering the volume line shows ns-resize (' + cur + ')');
  await H.drag(p, (a2.x0 + a2.x1) / 2, vy, (a2.x0 + a2.x1) / 2, vy + 8);
  const vol = await p.evaluate((id) => Cutline.P.clip(Cutline.P.seq(), id).au.vol, a2.id);
  H.ok(vol < -3, 'volume line drag lowers clip volume → ' + vol + ' dB');
  // --- fade handles: select clip, drag fade-in handle right
  await p.mouse.click((a2.x0 + a2.x1) / 2, a2.top + a2.h * 0.75);
  const fy = await p.evaluate((id) => { const C = Cutline, TL = C.TL, c = C.P.clip(C.P.seq(), id), r = TL.rowOf(c.trackId); const headH = Math.min(15, (r.h - 2) * 0.32); return TL.scroller.getBoundingClientRect().top + r.y - TL.scrollY + headH + 1 + 2; }, a2.id);
  const ppf = await p.evaluate(() => Cutline.TL.ppf);
  await H.drag(p, a2.x0 + 1, fy, a2.x0 + 1 + 30 * ppf, fy);
  const fi = await p.evaluate((id) => Cutline.P.clip(Cutline.P.seq(), id).fadeIn, a2.id);
  H.ok(fi >= 25 && fi <= 35, 'fade-in handle drag → ' + fi + ' frames');
  const a2b = await H.clipBox(p, { track: 'A2' });
  H.ok(a2b.start === a2.start && a2b.dur === a2.dur, 'grabbing the fade handle did not trim the clip');
  await H.drag(p, a2.x1 - 1, fy, a2.x1 - 1 - 45 * ppf, fy);
  const fo = await p.evaluate((id) => Cutline.P.clip(Cutline.P.seq(), id).fadeOut, a2.id);
  H.ok(fo >= 40 && fo <= 50, 'fade-out handle drag → ' + fo + ' frames');
  await H.shot(p, 'audio-fades');
  // --- audio effect via inspector + menu, then Normalize button
  await p.click('#p-right .tab[data-id="inspector"]');
  await p.click('.insp-scroll .cl-section:has(.sec-title:has-text("Audio Effects")) .icon-btn[data-tip="Add effect"]');
  await p.locator('.cl-menu .item').first().hover(); await p.waitForTimeout(150);
  const firstAfx = await p.locator('.cl-menu').last().locator('.item').first().innerText();
  await p.locator('.cl-menu').last().locator('.item').first().click();
  await p.waitForTimeout(150);
  const afx = await p.evaluate((id) => Cutline.P.clip(Cutline.P.seq(), id).fx.map(f => f.type), a2.id);
  H.ok(afx.length === 1, 'audio effect added from inspector + menu: ' + afx + ' (' + firstAfx.trim() + ')');
  await p.click('.insp-scroll button:text-is("Normalize")');
  await p.waitForTimeout(300);
  const gain = await p.evaluate((id) => Cutline.P.clip(Cutline.P.seq(), id).au.gain, a2.id);
  H.ok(gain > 3, 'normalize raises clip gain for a −10 dBFS file → ' + gain + ' dB');
  await H.shot(p, 'audio-inspector');
  // --- voiceover: record ~2.5 s from the fake mic
  await p.click('#p-right .tab[data-id="audio"]');
  await ruler(30);
  await p.locator('#p-right .pane-toolbar label.cl-check input').uncheck(); // don't play timeline while recording
  await p.click('#p-right .pane-toolbar button:has-text("Record Voiceover")');
  await p.waitForTimeout(2600);
  await H.shot(p, 'recording');
  await p.click('#p-right .pane-toolbar button:has-text("Stop Recording")');
  await p.waitForFunction(() => Cutline.state.project.media.some(m => /^Voiceover/.test(m.name) && Cutline.MRT[m.id] && Cutline.MRT[m.id].status === 'ready'), null, { timeout: 15000 });
  await p.waitForTimeout(500);
  const vo = await p.evaluate(() => { const C = Cutline, s = C.P.seq(), c = s.clips.find(c => /^Voiceover/.test(c.name)); return c ? { start: c.start, dur: c.dur, track: C.P.trackLabel(s, C.P.track(s, c.trackId)), mdur: C.P.media(c.mediaId).duration } : null; });
  H.ok(vo && Math.abs(vo.start - 30) <= 1 && vo.dur > 50 && vo.dur < 160, 'voiceover clip placed at playhead: ' + JSON.stringify(vo));
  await H.key(p, 'Backslash');
  await H.shot(p, 'voiceover');
  await H.finish(b, errs, 'h9_color_audio');
  function info(m) { H.info(m); }
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
