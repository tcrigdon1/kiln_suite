// Extra editor workflows: Speed dialog, freeze frame, lift/extract, track targeting, link toggle, TC entry, loop, scrub bar, timeline keyframe drag, nest
const H = require('./hlib');
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('h16');
  await H.boot(p);
  await H.newProjectUI(p);
  await H.importUI(p, ['main1080.webm', 'music.mp3']);
  const sr = await H.center(p, '#p-timeline .tl-scroll');
  const it = await H.center(p, '#p-bin .bin-item:has(.name:text-is("main1080.webm"))');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V1'));
  const im = await H.center(p, '#p-bin .bin-item:has(.name:text-is("music.mp3"))');
  await H.dnd(p, im.x, im.y, sr.bb.x + 3, await H.tlRowY(p, 'A2'));
  await H.key(p, 'Backslash');
  const ruler = async (f) => p.mouse.click(await H.tlX(p, f), (await H.center(p, '#p-timeline .tl-ruler-hit')).y);
  const empty = async () => p.mouse.click(await H.tlX(p, 5), await H.tlRowY(p, 'V3'));
  // --- timecode entry in the program monitor
  await p.click('#p-program .mon-bar .tc');
  await p.keyboard.press('Control+a'); await p.keyboard.type('00:00:05:10'); await p.keyboard.press('Enter');
  H.ok((await H.frame(p)) === 160, 'typing a timecode in the program monitor seeks to 5:10 (' + await H.frame(p) + ')');
  // relative entry +15
  await p.click('#p-program .mon-bar .tc');
  await p.keyboard.press('Control+a'); await p.keyboard.type('+15'); await p.keyboard.press('Enter');
  H.info('after +15: ' + await H.frame(p));
  // --- program scrub bar drag
  const sb = await H.center(p, '#p-program .mon-scrub');
  await H.drag(p, sb.bb.x + 12, sb.y, sb.bb.x + 10 + (sb.bb.width - 20) * 0.5, sb.y);
  const fs = await H.frame(p);
  H.ok(Math.abs(fs - 300) <= 3, 'program scrub bar drag to 50% → frame ' + fs);
  // --- Speed/Duration dialog (Ctrl+R): 50% doubles the duration, ripple off
  const v1 = await H.clipBox(p, { track: 'V1' });
  await p.mouse.click(v1.x0 + 30, v1.y);
  await H.key(p, 'Control+r');
  await p.waitForTimeout(150);
  await H.shot(p, 'speed-dialog');
  const sp = p.locator('.dialog input[type=number]').first();
  await sp.click({ clickCount: 3 }); await p.keyboard.type('50');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(200);
  let cl = await H.clips(p);
  H.ok(cl.filter(c => c.name === 'main1080.webm').every(c => c.dur === 1200 && Math.abs(c.speed - 0.5) < 1e-6), 'speed 50% → 1200 frames for video and linked audio: ' + JSON.stringify(cl.map(c => [c.kind, c.dur, c.speed])));
  await H.key(p, 'Control+z');
  await H.key(p, 'Backslash');
  // --- freeze frame Shift+F at 100
  await ruler(100); await p.mouse.click((await H.clipBox(p, { track: 'V1' })).x0 + 200, (await H.clipBox(p, { track: 'V1' })).y);
  await ruler(100);
  await H.key(p, 'Shift+f');
  cl = await H.clips(p);
  const fr = cl.find(c => /freeze/.test(c.name));
  H.ok(fr && fr.start === 100 && fr.dur > 0 && Math.max(...cl.filter(c => c.track !== 'A2').map(c => c.start + c.dur)) === 600 + fr.dur, 'freeze frame inserted at 100 and later material rippled (' + (fr && fr.dur) + ' frames)');
  await H.key(p, 'Backslash');
  await H.shot(p, 'freeze');
  await H.key(p, 'Control+z');
  // --- lift (;) and extract (') with sequence In/Out
  await ruler(60); await empty(); await H.key(p, 'i');
  await ruler(119); await empty(); await H.key(p, 'o');
  await H.key(p, 'Semicolon');
  cl = await H.clips(p);
  H.ok(cl.filter(c => c.track === 'V1').length === 2 && Math.max(...cl.filter(c => c.track === 'V1').map(c => c.start + c.dur)) === 600, 'lift (;) leaves a 60-frame gap');
  await H.key(p, 'Control+z');
  await H.key(p, 'Quote');
  cl = await H.clips(p);
  H.ok(cl.filter(c => c.track === 'V1').length === 2 && Math.max(...cl.filter(c => c.track === 'V1').map(c => c.start + c.dur)) === 540, "extract (') closes the gap (end " + Math.max(...cl.filter(c => c.track === 'V1').map(c => c.start + c.dur)) + ')');
  await H.key(p, 'Control+z');
  cl = await H.clips(p);
  H.ok(cl.filter(c => c.track === 'V1').length === 1 && Math.max(...cl.map(c => c.start + c.dur)) === 600, 'a single Ctrl+Z undoes the extract');
  await H.key(p, 'Alt+x');
  // --- track targeting: untarget A2 (music) → Ctrl+K at playhead splits V1/A1 only
  await p.click('.tl-heads .th.audio:has(.lbl:text-is("A2")) .tgt');
  H.info('targets: ' + await p.evaluate(() => Cutline.P.seq().tracks.map(t => Cutline.P.trackLabel(Cutline.P.seq(), t) + '=' + t.target).join(' ')));
  await ruler(250); await empty();
  H.info('sel: ' + await p.evaluate(() => Cutline.state.selection.length));
  await H.key(p, 'Control+k');
  cl = await H.clips(p);
  H.info(JSON.stringify(cl.map(c => [c.track, c.start, c.dur])));
  H.ok(cl.filter(c => c.track === 'V1').length === 2 && cl.filter(c => c.track === 'A1').length === 2 && cl.filter(c => c.track === 'A2').length === 1, 'untargeted A2 is not split by Ctrl+K');
  await H.key(p, 'Control+z');
  await p.click('.tl-heads .th.audio:has(.lbl:text-is("A2")) .tgt');
  // --- linked selection toggle button: clicking video selects only the video
  await p.click('#p-timeline .panel-head .icon-btn[data-tip="Linked selection"]');
  const vb = await H.clipBox(p, { track: 'V1' });
  await p.mouse.click(vb.x0 + 300, vb.y);
  H.ok((await p.evaluate(() => Cutline.state.selection.length)) === 1, 'with linked selection off, clicking selects only the video');
  await p.click('#p-timeline .panel-head .icon-btn[data-tip="Linked selection"]');
  // --- loop playback between In/Out (Ctrl+Alt+L)
  await ruler(30); await empty(); await H.key(p, 'i');
  await ruler(59); await empty(); await H.key(p, 'o');
  await H.key(p, 'Control+Alt+l');
  await H.key(p, 'Shift+i');
  await p.keyboard.press('Space'); await p.waitForTimeout(2200); await p.keyboard.press('Space');
  const lf = await H.frame(p);
  H.ok(lf >= 30 && lf < 60, 'loop playback stays inside In/Out (frame ' + lf + ' after 2.2 s)');
  await H.key(p, 'Control+Alt+l'); await H.key(p, 'Alt+x');
  // --- timeline keyframe diamond drag: animate opacity at 0 and 60 via inspector, then drag the 2nd key on the clip
  await ruler(0);
  await p.mouse.click(vb.x0 + 300, vb.y);
  await p.click('#p-right .tab[data-id="inspector"]');
  await p.click('.insp-scroll .cl-field:has(label:text-is("Opacity")) .kf-btn[title^="Toggle animation"]');
  await ruler(60);
  const op = p.locator('.insp-scroll .cl-field:has(label:text-is("Opacity")) input[type=number]');
  await op.click({ clickCount: 3 }); await p.keyboard.type('20'); await p.keyboard.press('Enter');
  await p.waitForTimeout(200);
  const kfy = await p.evaluate(() => { const C = Cutline, TL = C.TL, s = C.P.seq(), c = s.clips.find(c => c.kind === 'video'), r = TL.rowOf(c.trackId); return TL.scroller.getBoundingClientRect().top + r.y - TL.scrollY + r.h - 2 - 7 + 1; });
  const kx = await H.tlX(p, 60.5);
  const ppf = await p.evaluate(() => Cutline.TL.ppf);
  await H.drag(p, kx, kfy, kx + 30 * ppf, kfy);
  const keys = await p.evaluate(() => { const c = Cutline.P.seq().clips.find(c => c.kind === 'video' && c.kf['tf.op']); return c ? c.kf['tf.op'].map(k => k.f) : JSON.stringify(Cutline.P.seq().clips.map(c => [c.name, Object.keys(c.kf)])); });
  H.ok(Math.abs(keys[1] - 90) <= 2, 'dragging a keyframe diamond on the timeline clip moves it (60→' + keys[1] + ')');
  await H.shot(p, 'timeline-kf');
  // --- nest (Ctrl+G) and open the nest by double-click
  await p.mouse.click(vb.x0 + 300, vb.y);
  await H.key(p, 'Control+g');
  cl = await H.clips(p);
  H.ok(cl.filter(c => /Nested/.test(c.name)).length === 2, 'Ctrl+G nests the selection: ' + cl.map(c => c.name).join(','));
  const nb = await H.clipBox(p, { track: 'V1' });
  await p.mouse.dblclick(nb.x0 + 100, nb.y);
  await p.waitForTimeout(300);
  const tabs = await p.$$eval('.seq-tab', els => els.map(e => e.textContent + (e.classList.contains('active') ? '*' : '')));
  H.ok(tabs.length === 2 && /\*$/.test(tabs[1]), 'double-click opens the nested sequence in a tab: ' + tabs.join(' | '));
  await H.shot(p, 'nested');
  await p.click('.seq-tab >> nth=0');
  // label color via clip context menu
  await p.waitForTimeout(300);
  const nb2 = await H.clipBox(p, { track: 'V1' });
  await p.mouse.click(nb2.x0 + 20, nb2.y, { button: 'right' });
  await p.locator('.cl-menu .item', { hasText: 'Label Color' }).hover(); await p.waitForTimeout(150);
  await p.locator('.cl-menu').last().locator('.item', { hasText: 'Rose' }).click();
  await p.waitForTimeout(150);
  H.ok(await p.evaluate(() => Cutline.P.seq().clips.some(c => c.label === '#e07fb5')), 'label color set to Rose');
  await H.finish(b, errs, 'h16_misc');
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
