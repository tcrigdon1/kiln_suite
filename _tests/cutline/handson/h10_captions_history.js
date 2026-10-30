// 12+13. Captions: import SRT, edit, export SRT; undo/redo many steps; History panel jump
const H = require('./hlib');
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('h10');
  await H.boot(p);
  await H.newProjectUI(p);
  await H.importUI(p, ['main1080.webm']);
  const sr = await H.center(p, '#p-timeline .tl-scroll');
  const it = await H.center(p, '#p-bin .bin-item:has(.name:text-is("main1080.webm"))');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V1'));
  await H.key(p, 'Backslash');
  // --- import SRT from the Captions tab
  await p.click('#p-bin .tab[data-id="captions"]');
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('#p-bin .pane-toolbar button:text-is("Import SRT")')]);
  await fc.setFiles(H.MEDIA + 'subs.srt');
  await p.waitForTimeout(400);
  let caps = await p.evaluate(() => Cutline.P.seq().captions.map(c => [c.start, c.end, c.text]));
  H.ok(caps.length === 3 && caps[0][0] === 15 && caps[0][1] === 60 && caps[1][2] === 'Second line\nwith two rows', 'SRT imported with timing at 30fps: ' + JSON.stringify(caps));
  await H.shot(p, 'captions-imported');
  // caption lane shows; caption burns into the program at 1s
  await p.mouse.click(await H.tlX(p, 30), (await H.center(p, '#p-timeline .tl-ruler-hit')).y);
  const capPx = await H.progPixels(p, [[0.5, 0.9], [0.5, 0.88]]);
  await H.shot(p, 'caption-in-program');
  // --- edit the first caption's text in the list
  const ta = p.locator('#p-bin .cap-row textarea').first();
  await ta.click();
  await p.keyboard.press('Control+a'); await p.keyboard.type('Edited caption text');
  await p.keyboard.press('Tab');
  await p.waitForTimeout(200);
  caps = await p.evaluate(() => Cutline.P.seq().captions.map(c => c.text));
  H.ok(caps[0] === 'Edited caption text', 'caption text edited: ' + caps[0]);
  // change end time by typing
  const en = p.locator('#p-bin .cap-row .times input').nth(1);
  await en.click({ clickCount: 3 }); await p.keyboard.type('00:00:02:15'); await p.keyboard.press('Enter');
  await p.waitForTimeout(150);
  const e0 = await p.evaluate(() => Cutline.P.seq().captions[0].end);
  H.ok(e0 === 75, 'caption end retimed to 2:15 (' + e0 + ')');
  // drag a caption block on the timeline caption lane +15f
  const capRow = await p.evaluate(() => { const TL = Cutline.TL, r = TL.rows.find(r => r.cap), sr = TL.scroller.getBoundingClientRect(); return sr.top + r.y - TL.scrollY + r.h / 2; });
  const c2 = await p.evaluate(() => Cutline.P.seq().captions[1]);
  const ppf = await p.evaluate(() => Cutline.TL.ppf);
  await H.key(p, 's'); // snapping off for an exact move
  const cx = await H.tlX(p, (c2.start + c2.end) / 2);
  await H.drag(p, cx, capRow, cx + 15 * ppf, capRow);
  await H.key(p, 's');
  const c2b = await p.evaluate(() => Cutline.P.seq().captions[1]);
  H.ok(Math.abs(c2b.start - (c2.start + 15)) <= 1, 'caption dragged on the lane (' + c2.start + '→' + c2b.start + ')');
  // --- export SRT
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#p-bin .pane-toolbar button:text-is("Export SRT")')]);
  const path = H.SHOTS + '../out-captions.srt';
  await dl.saveAs(path);
  const srt = H.fs.readFileSync(path, 'utf8');
  H.ok(/00:00:00,500 --> 00:00:02,500\r?\nEdited caption text/.test(srt) && /Second line\r?\nwith two rows/.test(srt), 'exported SRT has edits:\n' + srt.split('\n').slice(0, 8).join(' / '));
  // --- undo/redo through many steps
  await p.mouse.click(await H.tlX(p, 400), await H.tlRowY(p, 'V3'));
  const labels0 = await p.evaluate(() => Cutline.H.undo.map(u => u.label));
  const nUndo = labels0.length;
  for (let i = 0; i < 4; i++) await H.key(p, 'Control+z');
  let st = await p.evaluate(() => ({ n: Cutline.H.undo.length, caps: Cutline.P.seq().captions.length, t0: Cutline.P.seq().captions[0] && Cutline.P.seq().captions[0].text }));
  H.ok(st.n === nUndo - 4, 'four undos (' + nUndo + '→' + st.n + ')');
  for (let i = 0; i < 4; i++) await H.key(p, 'Control+Shift+z');
  st = await p.evaluate(() => ({ n: Cutline.H.undo.length, t0: Cutline.P.seq().captions[0].text, s1: Cutline.P.seq().captions[1].start }));
  H.ok(st.n === nUndo && st.t0 === 'Edited caption text' && st.s1 === c2b.start, 'four redos restore everything');
  // Ctrl+Y redo alias
  await H.key(p, 'Control+z'); await H.key(p, 'Control+y');
  H.ok((await p.evaluate(() => Cutline.H.undo.length)) === nUndo, 'Ctrl+Y redoes');
  // --- History panel: jump back to "Import Captions", then forward to the last step
  await p.click('#p-bin .tab[data-id="history"]');
  await p.waitForTimeout(200);
  await H.shot(p, 'history');
  await p.locator('#p-bin .lrow', { hasText: 'Import Captions' }).click();
  await p.waitForTimeout(200);
  st = await p.evaluate(() => ({ caps: Cutline.P.seq().captions.map(c => c.text)[0], redo: Cutline.H.redo.length }));
  H.ok(st.caps === 'Hello from captions' && st.redo >= 3, 'History jump back to Import Captions: ' + JSON.stringify(st));
  await H.shot(p, 'history-jumped');
  await p.locator('#p-bin .lrow').last().click();
  await p.waitForTimeout(200);
  st = await p.evaluate(() => ({ caps: Cutline.P.seq().captions.map(c => c.text)[0], redo: Cutline.H.redo.length }));
  H.ok(st.caps === 'Edited caption text' && st.redo === 0, 'History jump forward to the latest step');
  // Edit menu shows Undo label state
  await H.finish(b, errs, 'h10_captions_history');
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
