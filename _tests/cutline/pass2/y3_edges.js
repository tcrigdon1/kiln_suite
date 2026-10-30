// pass2 y3: hands-on break-it session with real input. Drag a clip over itself, trim past neighbours, ripple with a
// locked track, undo during playback, delete a track with clips, rename media mid-playback, sequence settings with
// clips, in>out guards, new project while an export runs, 0-byte / corrupt imports, shortcuts while typing, relink
// with two files sharing a name, project load with missing media, HiDPI + 1366x768 layout.

const H = require('./plib');
const fs = require('fs');
const OUT = H.path.join(__dirname, 'out') + '/';
(async () => {
  const { b, p, errs, ctx } = await H.launch();
  H.setPrefix('y3');
  await H.boot(p);
  await H.newProjectUI(p, { name: 'Edges', w: 1280, h: 720, fps: 30 });
  await H.importUI2(p, ['clip25.webm', 'clip60.webm', 'music.mp3']);
  const sr = await H.center(p, '#p-timeline .tl-scroll');
  const lib = async (n) => H.center(p, `#p-bin .bin-item:has(.name:text-is("${n}"))`);
  let it = await lib('clip25.webm');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V1'));
  if (await p.$('.dialog:has-text("Clip format differs")')) await p.click('.dialog .btn:text-is("Keep Sequence Settings")');
  await p.waitForTimeout(150);
  it = await lib('clip60.webm');
  const end1 = await p.evaluate(() => Cutline.P.seqDuration(Cutline.P.seq()));
  const dx2 = await H.tlX(p, end1) + 2; H.info('drop2 at x=' + dx2 + ' end1=' + end1 + ' ppf=' + await p.evaluate(() => Cutline.TL.ppf) + ' areaW=' + await p.evaluate(() => Cutline.TL.area.clientWidth));
  await H.dnd(p, it.x, it.y, dx2, await H.tlRowY(p, 'V1'));
  await H.shot(p, 'after-drop2');
  await H.key(p, 'Backslash');
  const ppf = async () => p.evaluate(() => Cutline.TL.ppf);
  const histTop = async () => p.evaluate(() => Cutline.H.undo.length ? Cutline.H.undo[Cutline.H.undo.length - 1].label : '');
  const undoIf = async (label) => { if ((await histTop()) === label) await H.key(p, 'Control+z'); };
  let cl = await H.clips(p);
  H.info('placed: ' + JSON.stringify(cl.map(c => [c.track, c.start, c.dur])));
  H.ok(cl.filter(c => c.track === 'V1').length === 2 && cl.filter(c => c.track === 'V1')[1].start === end1, 'two clips back to back on V1');
  // ---- 1. drag a clip over itself (move right by ~1/3 of its length: overlaps its old place)
  const c1 = await H.clipBox(p, { track: 'V1', idx: 0 });
  await H.drag(p, c1.x0 + 40, c1.y, c1.x0 + 40 + (c1.x1 - c1.x0) / 3, c1.y);
  cl = await H.clips(p);
  const v1 = cl.filter(c => c.track === 'V1');
  H.info('after self-overlap move: ' + JSON.stringify(v1.map(c => [c.name, c.start, c.dur])));
  H.ok(v1.filter(c => c.name === 'clip25.webm').length === 1 && v1.every((c, i) => i === 0 || v1[i - 1].start + v1[i - 1].dur <= c.start), 'moving a clip over its own old position leaves one copy and no overlap');
  const movedDur = v1.find(c => c.name === 'clip25.webm').dur;
  H.ok(movedDur === c1.dur, 'moved clip keeps its duration (' + movedDur + ')');
  await H.key(p, 'Control+z');
  H.info('after undo move: ' + JSON.stringify((await H.clips(p)).map(c => [c.track, c.name, c.start, c.dur])));
  // ---- 2. trim end past the neighbour: the edge must stop at the neighbour's start
  const c1b = await H.clipBox(p, { track: 'V1', idx: 0 });
  await H.drag(p, c1b.x1 - 2, c1b.y, c1b.x1 + 400, c1b.y);
  cl = await H.clips(p);
  const first = cl.filter(c => c.track === 'V1')[0], second = cl.filter(c => c.track === 'V1')[1];
  H.ok(first.start + first.dur <= second.start, 'trim end stops at the next clip (' + (first.start + first.dur) + ' <= ' + second.start + ')');
  H.info('after trim: ' + JSON.stringify((await H.clips(p)).map(c => [c.track, c.name, c.start, c.dur])));
  await undoIf('Trim');
  H.info('after undo trim: ' + JSON.stringify((await H.clips(p)).map(c => [c.track, c.name, c.start, c.dur])) + ' hist ' + JSON.stringify(await p.evaluate(() => Cutline.H.undo.map(u => u.label))));
  // ---- 3. ripple delete with the audio track locked: locked track must not move
  const lockBtn = p.locator('#p-timeline .th.audio .tbtn.lock').first();
  await lockBtn.click();
  await p.waitForTimeout(100);
  const a1Before = (await H.clips(p)).filter(c => c.track === 'A1').map(c => [c.start, c.dur]);
  const cA = await H.clipBox(p, { track: 'V1', idx: 0 });
  await p.mouse.click(cA.x0 + 30, cA.y);
  await H.key(p, 'Shift+Delete');
  cl = await H.clips(p);
  const a1After = cl.filter(c => c.track === 'A1').map(c => [c.start, c.dur]);
  H.info('ripple delete with A1 locked: V1 ' + JSON.stringify(cl.filter(c => c.track === 'V1').map(c => [c.start, c.dur])) + ' A1 before ' + JSON.stringify(a1Before) + ' after ' + JSON.stringify(a1After));
  H.ok(JSON.stringify(a1Before) === JSON.stringify(a1After), 'locked audio track is untouched by ripple delete');
  H.ok(cl.filter(c => c.track === 'V1').length === 1 && cl.filter(c => c.track === 'V1')[0].start === 0, 'V1 rippled (one clip left at 0)');
  await undoIf('Ripple Delete');
  await lockBtn.click();
  await p.waitForTimeout(100);
  // ---- 4. undo during playback
  await H.key(p, 'Home');
  await H.key(p, 'Space');
  await p.waitForTimeout(700);
  const c2 = await H.clipBox(p, { track: 'V1', idx: 1 });
  await p.mouse.click(c2.x0 + 30, c2.y);
  await H.key(p, 'Delete');
  await p.waitForTimeout(300);
  await H.key(p, 'Control+z');
  await p.waitForTimeout(700);
  const st4 = await p.evaluate(() => ({ playing: Cutline.Engine.playing, frame: Cutline.Engine.frame, clips: Cutline.P.seq().clips.length }));
  H.info('undo during playback: ' + JSON.stringify(st4));
  H.ok(st4.clips === 4, 'delete + undo while playing restores the clip');
  if (st4.playing) await H.key(p, 'Space');
  await p.waitForTimeout(200);
  // ---- 5. delete a track with clips via the header context menu, then undo
  const th = await H.center(p, '#p-timeline .th.audio .name');
  await p.mouse.click(th.x, th.y, { button: 'right' });
  await p.waitForTimeout(150);
  await p.locator('.cl-menu .item', { hasText: 'Delete Track' }).click();
  await p.waitForTimeout(250);
  const t5 = await p.evaluate(() => ({ tracks: Cutline.P.seq().tracks.map(t => t.kind[0]).join(''), clips: Cutline.P.seq().clips.length, dialog: !!document.querySelector('.dialog') }));
  H.info('after delete audio track: ' + JSON.stringify(t5));
  if (t5.dialog) { await p.click('.dialog-foot .btn.primary'); await p.waitForTimeout(200); }
  const t5b = await p.evaluate(() => ({ tracks: Cutline.P.seq().tracks.map(t => t.kind[0]).join(''), clips: Cutline.P.seq().clips.length }));
  H.ok(t5b.tracks.length === 5 && t5b.clips === 2, 'deleting the audio track removes its 2 clips (' + JSON.stringify(t5b) + ')');
  await H.key(p, 'Control+z');
  const t5c = await p.evaluate(() => ({ tracks: Cutline.P.seq().tracks.map(t => t.kind[0]).join(''), clips: Cutline.P.seq().clips.length }));
  H.ok(t5c.tracks.length === 6 && t5c.clips === 4, 'undo restores the track and its clips');
  // ---- 6. rename media while playing
  await H.key(p, 'Home'); await H.key(p, 'Space');
  await p.waitForTimeout(400);
  it = await lib('clip25.webm');
  await p.mouse.click(it.x, it.y, { button: 'right' });
  await p.locator('.cl-menu .item', { hasText: 'Rename' }).click();
  await p.waitForTimeout(150);
  await p.keyboard.press('Control+a'); await p.keyboard.type('renamed25.webm'); await p.keyboard.press('Enter');
  await p.waitForTimeout(600);
  const st6 = await p.evaluate(() => ({ playing: Cutline.Engine.playing, names: Cutline.state.project.media.map(m => m.name), online: Cutline.Media.offlineMedia().length }));
  H.info('rename during playback: ' + JSON.stringify(st6));
  H.ok(st6.names.indexOf('renamed25.webm') >= 0 && st6.online === 0, 'media renamed mid-playback stays online');
  if (st6.playing) await H.key(p, 'Space');
  await p.waitForTimeout(200);
  await H.shot(p, 'renamed');
  // ---- 7. sequence settings with clips: 30 -> 60 fps and 1280x720 -> 1920x1080
  const before7 = await p.evaluate(() => Cutline.P.seq().clips.map(c => [c.start, c.dur]));
  await H.menu(p, 'Sequence', 'Sequence Settings');
  await p.click('.dialog .preset[data-w="1920"][data-h="1080"]');
  await p.click('.dialog .chip-row .chip:text-is("60")');
  await p.click('.dialog-foot .btn.primary');
  await p.waitForTimeout(400);
  const after7 = await p.evaluate(() => ({ fps: Cutline.P.seq().fps, w: Cutline.P.seq().w, clips: Cutline.P.seq().clips.map(c => [c.start, c.dur]), tf: Cutline.P.seq().clips.filter(c => c.tf).map(c => [Math.round(c.tf.x), Math.round(c.tf.y)]) }));
  H.info('seq settings 60fps/1080p: ' + JSON.stringify(after7) + ' (was ' + JSON.stringify(before7) + ')');
  H.ok(after7.fps === 60 && after7.clips.every((c, i) => c[0] === before7[i][0] * 2 && c[1] === before7[i][1] * 2), 'clips rescaled to the new frame rate');
  H.ok(after7.tf.every(t => t[0] === 960 && t[1] === 540), 'clip positions re-centred for the new frame size');
  await H.key(p, 'Control+z');
  await p.waitForTimeout(200);
  // ---- 8. In after Out: marking In past Out drops the Out
  await H.key(p, 'Home');
  await p.mouse.click(await H.tlX(p, 50), (await H.center(p, '#p-timeline .tl-ruler-hit')).y);
  await p.mouse.click(await H.tlX(p, 30), await H.tlRowY(p, 'V3'));
  await H.key(p, 'o');
  await p.mouse.click(await H.tlX(p, 100), (await H.center(p, '#p-timeline .tl-ruler-hit')).y);
  await p.mouse.click(await H.tlX(p, 30), await H.tlRowY(p, 'V3'));
  await H.key(p, 'i');
  const io = await p.evaluate(() => [Cutline.P.seq().inF, Cutline.P.seq().outF]);
  H.ok(io[0] === 100 && io[1] == null, 'marking In after Out clears the Out point (' + io + ')');
  await H.key(p, 'Alt+x');
  // ---- 9. new project while an export is running: must be refused (or wait), never crash
  await H.key(p, 'Home');
  await p.evaluate(() => { window.__exp = Cutline.Export.runWithUI({ format: 'webm-vp9', res: 'seq', w: 640, h: 360, fps: 30, quality: 'low', range: 'all', audio: true, abitrate: 96000, captions: false, name: 'y3run', seqId: Cutline.P.seq().id }); });
  await p.waitForTimeout(600);
  const progressOpen = await p.locator('.dialog:has-text("Exporting")').count();
  await H.key(p, 'Control+Alt+n');
  await p.waitForTimeout(400);
  const dlgs = await p.evaluate(() => Cutline.ui.openDialogs.map(d => d.el.querySelector('.dialog-head span').textContent));
  H.info('dialogs while exporting after Ctrl+Alt+N: ' + JSON.stringify(dlgs) + ' (progress was open: ' + progressOpen + ')');
  H.ok(progressOpen === 1 && !dlgs.some(t => /Welcome/.test(t)), 'New Project is blocked while an export is running');
  await p.locator('.dialog:has-text("Exporting") .btn', { hasText: 'Cancel' }).click().catch(() => { });
  await p.waitForFunction(() => !Array.from(document.querySelectorAll('.dialog-head span')).some(e => /Exporting/.test(e.textContent)), null, { timeout: 60000 });
  await p.waitForTimeout(300);
  H.ok(await p.evaluate(() => !!Cutline.state.project && Cutline.state.project.name === 'Edges'), 'project survived the cancelled export');
  // ---- 10. 0-byte and corrupt imports
  const nBefore = await p.evaluate(() => Cutline.state.project.media.length);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('.bin-toolbar .icon-btn[data-tip^="Import media"]')]);
  await fc.setFiles([H.MEDIA2 + 'empty.webm', H.MEDIA2 + 'corrupt.mp4']);
  await p.waitForFunction(() => !Array.from(document.querySelectorAll('.dialog-head span')).some(e => /Importing/.test(e.textContent)), null, { timeout: 60000 });
  await p.waitForTimeout(500);
  await H.shot(p, 'bad-imports');
  const dl10 = await p.evaluate(() => Cutline.ui.openDialogs.map(d => d.el.querySelector('.dialog-head span').textContent));
  H.info('dialogs after bad import: ' + JSON.stringify(dl10));
  H.ok(dl10.length === 1, 'one dialog lists every failed file (not one per file)');
  for (let i = 0; i < 3 && (await p.locator('.dialog .btn.primary').count()); i++) { await p.locator('.dialog .btn.primary').last().click(); await p.waitForTimeout(150); }
  const nAfter = await p.evaluate(() => Cutline.state.project.media.length);
  H.ok(nAfter === nBefore, 'empty / corrupt files are rejected without adding media (' + nBefore + ' -> ' + nAfter + ')');
  // ---- 11. shortcuts while typing: Space/Delete in an Inspector number field must not act on the timeline
  const cB = await H.clipBox(p, { track: 'V1', idx: 0 });
  await p.mouse.click(cB.x0 + 30, cB.y);
  await p.click('.tab[data-id="inspector"]');
  await p.waitForTimeout(200);
  const numIn = p.locator('#p-right .pane.active input[type=number]').first();
  await numIn.click(); await p.keyboard.press('End');
  await p.keyboard.press('Space'); await p.waitForTimeout(150);
  await p.keyboard.press('Delete'); await p.waitForTimeout(150);
  const st11 = await p.evaluate(() => ({ playing: Cutline.Engine.playing, clips: Cutline.P.seq().clips.length }));
  H.ok(!st11.playing && st11.clips === 4, 'Space / Delete inside a number field do not play or delete');
  const rng = p.locator('#p-right .pane.active input[type=range]').first();
  if (await rng.count()) {
    const f0 = await H.frame(p);
    const v0 = await rng.inputValue();
    await rng.click(); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(100);
    H.ok((await H.frame(p)) === f0, 'arrow key on a focused slider does not step the playhead');
    H.ok(+(await rng.inputValue()) !== +v0, 'arrow key moved the slider itself (' + v0 + ' -> ' + await rng.inputValue() + ')');
    await p.mouse.click(await H.tlX(p, 5), await H.tlRowY(p, 'V3'));
    await undoIf('Scale');
  }
  await p.mouse.click(await H.tlX(p, 5), await H.tlRowY(p, 'V3'));
  // ---- 12. save, then reload with missing media -> relink dialog, offline placeholders render, two same-name files relink by size
  await p.evaluate(() => { window.showSaveFilePicker = undefined; });
  const [dl] = await Promise.all([p.waitForEvent('download'), H.key(p, 'Control+s')]);
  const kcut = OUT + 'y3.kcut'; await dl.saveAs(kcut);
  await p.waitForTimeout(300);
  // second project: import pass2/media/dup/clip25.webm (same name as the handson one, different size) to prove size matching
  await H.boot(p);
  await p.evaluate(() => { try { indexedDB.deleteDatabase('cutline'); } catch (e) { } });
  await H.boot(p);
  await p.waitForSelector('.dialog .welcome');
  const [fc2] = await Promise.all([p.waitForEvent('filechooser'), p.click('.welcome .side button:has-text("Open Project")')]);
  await fc2.setFiles([kcut]);
  await p.waitForFunction(() => !!Cutline.state.project && Cutline.state.project.name === 'Edges');
  await p.waitForTimeout(1200);
  const rl = await p.locator('.dialog:has-text("Relink Media")').count();
  H.ok(rl === 1, 'relink dialog offered when media files are missing');
  await H.shot(p, 'offline-project');
  const off = await p.evaluate(() => Cutline.Media.offlineMedia().map(m => m.name));
  H.info('offline: ' + JSON.stringify(off));
  // the program monitor shows an offline slate rather than black
  await p.evaluate(() => Cutline.Engine.seek(10));
  await p.waitForTimeout(500);
  const px = await H.progPixels(p, [[0.5, 0.5], [0.1, 0.1]]);
  H.info('offline pixels ' + JSON.stringify(px));
  H.ok(px.some(c => c[0] + c[1] + c[2] > 40), 'offline media renders a visible slate, not black');
  // relink: pick both files named clip25.webm (the real one and a different-size impostor) + the others
  const [fc3] = await Promise.all([p.waitForEvent('filechooser'), p.click('.dialog .btn.primary:has-text("Select Files")')]);
  await fc3.setFiles([H.MEDIA2 + 'dup/clip25.webm', H.MEDIA + 'clip25.webm', H.MEDIA + 'clip60.webm', H.MEDIA + 'music.mp3']);
  await p.waitForFunction(() => Cutline.Media.offlineMedia().length === 0, null, { timeout: 60000 });
  await p.waitForTimeout(500);
  const relinked = await p.evaluate(() => Cutline.state.project.media.filter(m => m.type !== 'gen').map(m => [m.name, m.size, Cutline.MRT[m.id] && Cutline.MRT[m.id].file && Cutline.MRT[m.id].file.size]));
  H.info('relinked: ' + JSON.stringify(relinked));
  H.ok(relinked.every(r => r[1] === r[2]), 'each media relinked to the file with the matching size (same-name impostor ignored)');
  await p.click('.dialog .btn:has-text("Close")').catch(() => { });
  // ---- 13. HiDPI + 1366x768
  await p.setViewportSize({ width: 1366, height: 768 });
  await p.waitForTimeout(400);
  await H.shot(p, '1366x768');
  const fit = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight, tl: Cutline.TL.area.clientWidth }));
  H.ok(fit.sw <= fit.cw && fit.sh <= fit.ch && fit.tl > 300, 'layout fits 1366x768 without page scrollbars (' + JSON.stringify(fit) + ')');
  await b.close();
  // DPI 2 session
  const b2 = await require('playwright').chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx2 = await b2.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2 });
  const p2 = await ctx2.newPage(); const errs2 = [];
  p2.on('console', m => { if (m.type() === 'error') errs2.push('console: ' + m.text()); }); p2.on('pageerror', e => errs2.push('pageerror: ' + e.message));
  await H.boot(p2, '?test=1');
  await p2.evaluate(() => { const C = Cutline; C.edit('d', s => { const m = C.Media.newGen('bars'); C.T.placeMedia(s, m, 0, C.P.vtracks(s)[0].id, C.P.atracks(s)[0].id, 'overwrite'); }); C.Engine.seek(5); });
  await p2.waitForTimeout(600);
  await p2.click('.tab[data-id="color"]'); await p2.waitForTimeout(600);
  const dpi = await p2.evaluate(() => { const TL = Cutline.TL, cv = TL.canvas, pc = Cutline.Program.canvas, sc = document.querySelector('#p-right .pane.active canvas'); return { tl: [cv.width, cv.clientWidth], prog: [pc.width, pc.clientWidth, Cutline.Engine.outputSize()], scope: sc ? [sc.width, sc.clientWidth] : null, dpr: devicePixelRatio }; });
  H.info('DPI2 canvases (backing px vs css px): ' + JSON.stringify(dpi));
  H.ok(dpi.tl[0] === dpi.tl[1] * 2, 'timeline canvas is rendered at 2x on a HiDPI display');
  H.ok(!dpi.scope || dpi.scope[0] >= dpi.scope[1] * 2 - 2, 'scope canvas is rendered at 2x on a HiDPI display');
  await p2.screenshot({ path: H.SHOTS + 'y3-dpi2.png' });
  errs.push(...errs2);
  await b2.close();
  await H.finish({ close: async () => { } }, errs, 'y3_edges');
})();
