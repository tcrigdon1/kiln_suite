// pass2 y5: workspace additions — demo project, welcome tour, command palette, extend edit (E), gap navigation,
// bulk track actions, chapters text, clip notes (+ search), keyboard layouts, project templates, project merge.
const H = require('./plib');
const fs = require('fs');
const OUT = H.path.join(__dirname, 'out') + '/';
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('y5');
  await H.boot(p);
  await p.waitForSelector('.dialog .welcome');
  await H.shot(p, 'welcome');
  // ---- demo project from the welcome screen
  await p.click('.welcome .side button:has-text("Open Demo Project")');
  await p.waitForFunction(() => !!Cutline.state.project && Cutline.state.project.name === 'Cutline Demo');
  await p.waitForTimeout(1200);
  const demo = await p.evaluate(() => { const C = Cutline, s = C.P.seq(); return { clips: s.clips.length, trans: s.transitions.length, caps: s.captions.length, markers: s.markers.length, media: C.state.project.media.length, offline: C.Media.offlineMedia().length, tour: !!document.querySelector('.cl-tour') }; });
  H.info('demo: ' + JSON.stringify(demo));
  H.ok(demo.clips >= 8 && demo.trans === 4 && demo.caps === 2 && demo.markers === 3 && demo.offline === 0, 'demo project is populated and fully online');
  H.ok(demo.tour, 'welcome tour overlay shown on the first project');
  await H.shot(p, 'tour-step1');
  for (let i = 0; i < 4; i++) { await p.click('.cl-tour-card .btn.primary'); await p.waitForTimeout(250); }
  await H.shot(p, 'tour-step5');
  await p.click('.cl-tour-card .btn.primary'); await p.waitForTimeout(200);
  H.ok(!(await p.$('.cl-tour')), 'tour closes after the last step');
  await p.evaluate(() => Cutline.Engine.seek(100));
  await p.waitForTimeout(800);
  await H.shot(p, 'demo-frame100');
  const px = await H.progPixels(p, [[0.5, 0.5], [0.5, 0.1]]);
  H.ok(px.some(c => c[0] + c[1] + c[2] > 60), 'demo renders a picture at frame 100 (' + JSON.stringify(px) + ')');
  // ---- command palette
  await p.mouse.click(await H.tlX(p, 5), await H.tlRowY(p, 'V3'));
  await H.key(p, 'Control+Shift+p');
  await p.waitForSelector('.cl-palette');
  await p.keyboard.type('zoom fit');
  await p.waitForTimeout(150);
  await H.shot(p, 'palette');
  const first = await p.evaluate(() => document.querySelector('.cl-palette-row.sel .lbl').textContent);
  H.ok(/Zoom to Fit/.test(first), 'palette fuzzy search ranks "Zoom to Fit" first for "zoom fit" (' + first + ')');
  const ppf0 = await p.evaluate(() => Cutline.TL.ppf);
  await p.evaluate(() => { Cutline.TL.zoomBy(3); });
  await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  const ppf1 = await p.evaluate(() => Cutline.TL.ppf);
  H.ok(!(await p.$('.cl-palette')) && Math.abs(ppf1 - ppf0) < 1e-6, 'Enter runs the command and closes the palette');
  await H.key(p, 'Control+Shift+p'); await p.keyboard.type('source: amber'); await p.waitForTimeout(150); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  H.ok(await p.evaluate(() => { const m = Cutline.P.media(Cutline.state.sourceMedia); return m && m.name === 'Amber'; }), 'palette opens a library item in the Source monitor');
  // ---- extend edit: trim V1 clip 2 end back by 20, put playhead at the old cut, press E -> rolls back
  await p.mouse.click(await H.tlX(p, 5), await H.tlRowY(p, 'V3'));
  const before = await p.evaluate(() => Cutline.P.clipsOn(Cutline.P.seq(), Cutline.P.vtracks(Cutline.P.seq())[0].id).map(c => [c.start, c.dur]));
  await p.evaluate(() => { const C = Cutline; C.edit('t', s => { const list = C.P.clipsOn(s, C.P.vtracks(s)[0].id); C.T.setEnd(s, list[1], list[1].start + list[1].dur - 20); C.T.setStart(s, list[2], list[2].start + 20); }); C.Engine.seek(180); C.A.select([C.P.clipsOn(C.P.seq(), C.P.vtracks(C.P.seq())[0].id)[1].id]); });
  await H.key(p, 'e');
  const after = await p.evaluate(() => Cutline.P.clipsOn(Cutline.P.seq(), Cutline.P.vtracks(Cutline.P.seq())[0].id).map(c => [c.start, c.dur]));
  H.info('extend edit: ' + JSON.stringify(before) + ' -> ' + JSON.stringify(after));
  H.ok(after[1][0] + after[1][1] === 180 && after[2][0] === 200, 'E extends the selected clip\'s end to the playhead (gap closed up to the playhead)');
  await p.evaluate(() => { const C = Cutline; C.Engine.seek(200); C.A.select([C.P.clipsOn(C.P.seq(), C.P.vtracks(C.P.seq())[0].id)[2].id]); });
  await H.key(p, 'e');
  const after2 = await p.evaluate(() => Cutline.P.clipsOn(Cutline.P.seq(), Cutline.P.vtracks(Cutline.P.seq())[0].id).map(c => [c.start, c.dur]));
  H.ok(after2[2][0] === 200 && after2[1][0] + after2[1][1] === 180, 'E on the following clip at its own start changes nothing (edge already at the playhead)');
  // ---- gap navigation
  await p.evaluate(() => { const C = Cutline; C.A.allTracks('untarget'); C.edit('tgt', s => { C.P.vtracks(s)[0].target = true; }); C.Engine.seek(0); });
  await H.key(p, 'Control+Shift+ArrowDown');
  const g1 = await p.evaluate(() => ({ f: Cutline.Engine.frame, gap: Cutline.state.selGap }));
  H.info('next gap: ' + JSON.stringify(g1));
  H.ok(g1.f === 180 && g1.gap && g1.gap.s === 180 && g1.gap.e === 200, 'Ctrl+Shift+Down jumps to the next gap on targeted tracks and selects it');
  await H.key(p, 'Delete');
  const closed = await p.evaluate(() => Cutline.P.clipsOn(Cutline.P.seq(), Cutline.P.vtracks(Cutline.P.seq())[0].id).map(c => [c.start, c.dur]));
  H.ok(closed[2][0] === 180, 'Delete closes the selected gap (' + JSON.stringify(closed) + ')');
  await H.key(p, 'Control+z');
  // ---- bulk track actions via the menu
  await H.menu(p, 'Sequence', 'Every Track', 'Lock All');
  H.ok(await p.evaluate(() => Cutline.P.seq().tracks.every(t => t.lock)), 'Sequence › All Tracks › Lock All locks every track');
  await H.menu(p, 'Sequence', 'Every Track', 'Unlock All');
  H.ok(await p.evaluate(() => Cutline.P.seq().tracks.every(t => !t.lock)), 'Unlock All');
  await H.menu(p, 'Sequence', 'Every Track', 'Mute All');
  H.ok(await p.evaluate(() => Cutline.P.atracks(Cutline.P.seq()).every(t => t.mute)), 'Mute All Audio');
  await H.menu(p, 'Sequence', 'Every Track', 'Unmute All');
  // ---- chapters text
  const chap = await p.evaluate(() => Cutline.A.chaptersText());
  H.info('chapters:\n' + chap);
  H.ok(chap.split('\n').length === 3 && /^0:00 Intro\n0:06 Chapter 2\n0:13 Outro$/.test(chap), 'chapter list from named markers in m:ss form starting at 0:00');
  await H.menu(p, 'Markers', 'Export Chapters');
  await p.waitForSelector('.dialog textarea');
  await H.shot(p, 'chapters');
  await p.click('.dialog .btn:has-text("Close")');
  // ---- clip notes: inspector section + context menu + search
  const cb = await H.clipBox(p, { track: 'V1', idx: 2 });
  await p.mouse.click(cb.x0 + 60, cb.top + cb.h - 5);
  await p.click('.tab[data-id="inspector"]');
  await p.waitForTimeout(200);
  const noteTa = p.locator('#p-right .pane.active textarea[placeholder^="Notes about"]');
  H.info('inspector: ' + JSON.stringify(await p.evaluate(() => ({ sel: Cutline.state.selection.length, secs: Array.from(document.querySelectorAll('#p-right .pane.active .sec-title')).map(e => e.textContent), tas: document.querySelectorAll('#p-right textarea').length, dialogs: Cutline.ui.openDialogs.length }))));
  H.ok(await noteTa.count() === 1, 'Inspector has a Note section');
  await noteTa.click(); await p.keyboard.type('needs colour match later');
  await p.mouse.click(await H.tlX(p, 5), await H.tlRowY(p, 'V3'));
  await p.waitForTimeout(200);
  const note = await p.evaluate(() => Cutline.P.clipsOn(Cutline.P.seq(), Cutline.P.vtracks(Cutline.P.seq())[0].id)[2].note);
  H.ok(note === 'needs colour match later', 'note saved on the clip (' + note + ')');
  await p.click('#p-timeline .tl-search'); await p.keyboard.type('colour match'); await p.waitForTimeout(200);
  const matches = await p.evaluate(() => Cutline.P.seq().clips.filter(Cutline.TL.matches).map(c => c.name));
  H.ok(matches.length === 1 && matches[0] === 'Teal', 'Find clip… matches note text (' + matches + ')');
  await p.keyboard.press('Escape');
  await H.shot(p, 'note');
  // ---- keyboard layout
  await H.menu(p, 'Edit', 'Keyboard Layout');
  await p.selectOption('.dialog select', 'lefthand');
  await p.click('.dialog-foot .btn.primary');
  await p.waitForTimeout(200);
  const k1 = await p.evaluate(() => [Cutline.CMD.keys('split')[0], Cutline.CMD.lookup('G'), Cutline.CMD.lookup('S')]);
  H.ok(k1[0] === 'Ctrl+B' && k1[1] === 'snap' && k1[2] !== 'snap', 'left-hand layout rebinds Split and Snapping (' + JSON.stringify(k1) + ')');
  await p.mouse.click(await H.tlX(p, 5), await H.tlRowY(p, 'V3'));
  await p.evaluate(() => Cutline.Engine.seek(30));
  const nBefore = await p.evaluate(() => Cutline.P.seq().clips.length);
  await H.key(p, 'Control+b');
  H.ok((await p.evaluate(() => Cutline.P.seq().clips.length)) === nBefore + 2, 'Ctrl+B splits in the new layout');
  await H.key(p, 'Control+z');
  await p.evaluate(() => Cutline.ui.applyKeyLayout('default'));
  H.ok(await p.evaluate(() => Cutline.CMD.keys('split')[0] === 'Ctrl+K'), 'default layout restores Ctrl+K');
  // ---- template: save, then create a new project from it
  await H.menu(p, 'File', 'Save Project as Template');
  await p.click('.dialog input[type=text]', { clickCount: 3 }); await p.keyboard.type('Demo template');
  await p.click('.dialog-foot .btn.primary');
  await p.waitForTimeout(200);
  H.ok((await p.evaluate(() => Cutline.IO.templates().map(t => t.name))).indexOf('Demo template') >= 0, 'template saved');
  // save the demo as .kcut for the merge test
  await p.evaluate(() => { window.showSaveFilePicker = undefined; });
  const [dl] = await Promise.all([p.waitForEvent('download'), H.key(p, 'Control+s')]);
  const kcut = OUT + 'y5-demo.kcut'; await dl.saveAs(kcut);
  await p.evaluate(() => { Cutline.state.dirty = false; });
  await H.key(p, 'Control+Alt+n');
  await p.waitForSelector('.dialog .welcome');
  await H.shot(p, 'welcome-template');
  await p.selectOption('.welcome select', 'Demo template');
  await p.click('.welcome input[type=text]', { clickCount: 3 }); await p.keyboard.type('From Template');
  await p.click('.dialog-foot .btn.primary');
  await p.waitForFunction(() => !!Cutline.state.project && Cutline.state.project.name === 'From Template');
  await p.waitForTimeout(500);
  const tp = await p.evaluate(() => { const C = Cutline, s = C.P.seq(); return { seqs: C.state.project.sequences.length, clips: s.clips.length, gens: C.state.project.media.filter(m => m.type === 'gen').length, dirty: C.state.dirty, w: s.w }; });
  H.info('from template: ' + JSON.stringify(tp));
  H.ok(tp.clips >= 8 && tp.gens >= 6 && tp.w === 1280, 'new project from template carries sequences and generated items');
  // ---- merge the saved demo project into this one
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), H.menu(p, 'File', 'Import Project')]);
  await fc.setFiles([kcut]);
  await p.waitForTimeout(800);
  const mg = await p.evaluate(() => { const C = Cutline; return { seqs: C.state.project.sequences.map(s => s.name), media: C.state.project.media.length, ids: new Set(C.state.project.media.map(m => m.id)).size, clips: C.state.project.sequences[1] && C.state.project.sequences[1].clips.length, valid: C.state.project.sequences.every(s => s.clips.every(c => !c.mediaId || C.P.media(c.mediaId))) }; });
  H.info('merged: ' + JSON.stringify(mg));
  H.ok(mg.seqs.length === 2 && mg.seqs[1] === 'Demo Edit (2)' && mg.valid && mg.ids === mg.media, 'imported project adds its sequence (renamed) with valid media references and fresh ids');
  await H.key(p, 'Control+z');
  H.ok(await p.evaluate(() => Cutline.state.project.sequences.length === 1), 'project merge is one undo step');
  await H.finish(b, errs, 'y5_workspace');
})();
