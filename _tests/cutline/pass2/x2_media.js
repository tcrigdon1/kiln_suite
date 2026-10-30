// pass2 exploration 2: nesting cycles, captions edge cases, titles with emoji/RTL, 4K on vertical, routing of
// audio-only/video-only drops, zero-duration stills, EXIF rotation, zoom extremes, save/load with everything
const H = require('./plib');
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('x2');
  await H.boot(p);
  await H.newProjectUI(p);
  await H.importUI2(p, ['main1080.webm', 'music.mp3', 'clip4k.webm', 'still.jpg', 'exif_rot.jpg', 'silent.webm', 'subs.srt'].filter(n => n !== 'subs.srt'));
  const libItem = async (n) => H.center(p, `#p-bin .bin-item:has(.name:text-is("${n}"))`);
  const sr = await H.center(p, '#p-timeline .tl-scroll');
  const dismissMatch = async () => { await p.waitForTimeout(250); if (await p.$('.dialog:has-text("Clip format differs")')) await p.click('.dialog .btn:text-is("Keep Sequence Settings")'); };
  // ---- EXIF rotation: how is the image reported?
  const ex = await p.evaluate(() => { const m = Cutline.state.project.media.find(m => m.name === 'exif_rot.jpg'); return { w: m.w, h: m.h }; });
  H.info('exif_rot.jpg probed as ' + JSON.stringify(ex));
  let it = await libItem('exif_rot.jpg');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V1'));
  await p.waitForTimeout(600);
  await H.key(p, 'Backslash');
  // the picture should be landscape with the yellow band at the top (EXIF applied) → sample top-centre vs left-centre
  let px = await H.progPixels(p, [[0.5, 0.08], [0.5, 0.92], [0.5, 0.5]]);
  H.info('exif render pixels top/bottom/centre: ' + JSON.stringify(px));
  H.ok(px[0][0] > 180 && px[0][1] > 150 && px[0][2] < 120, 'EXIF-rotated JPEG shows yellow band at the top (orientation honoured)');
  H.ok(ex.w === 800 && ex.h === 600, 'EXIF-rotated JPEG probed as 800×600 (display size), got ' + ex.w + '×' + ex.h);
  await H.shot(p, 'exif');
  await H.key(p, 'Control+z');
  // ---- 0-duration still: set still duration to 0 via context menu
  it = await libItem('still.jpg');
  await p.mouse.click(it.x, it.y, { button: 'right' });
  await p.click('.cl-menu .item:has-text("Set Still Duration")');
  await p.waitForSelector('.dialog');
  await p.fill('.dialog input[type=text]', '0');
  await p.click('.dialog .btn.primary');
  await p.waitForTimeout(200);
  let sd = await p.evaluate(() => Cutline.state.project.media.find(m => m.name === 'still.jpg').stillDur);
  H.info('still duration after entering 0: ' + sd);
  await p.mouse.click(it.x, it.y, { button: 'right' });
  await p.click('.cl-menu .item:has-text("Set Still Duration")');
  await p.fill('.dialog input[type=text]', '0.001');
  await p.click('.dialog .btn.primary');
  await p.waitForTimeout(200);
  sd = await p.evaluate(() => Cutline.state.project.media.find(m => m.name === 'still.jpg').stillDur);
  H.info('still duration after entering 0.001: ' + sd);
  it = await libItem('still.jpg');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V1'));
  await p.waitForTimeout(300);
  let cl = await H.clips(p);
  H.info('clips after dropping 0.001s still: ' + JSON.stringify(cl.map(c => [c.track, c.start, c.dur])));
  H.ok(cl.length === 1 && cl[0].dur >= 1, 'a near-zero still still yields a >=1 frame clip');
  await H.shot(p, 'zero-still');
  await H.key(p, 'Control+z');
  // ---- audio-only clip dropped on a video track → routed to audio track; video-only (silent.webm) on audio track → routed to video
  it = await libItem('music.mp3');
  await H.dnd(p, it.x, it.y, await H.tlX(p, 10), await H.tlRowY(p, 'V2'));
  await p.waitForTimeout(300);
  cl = await H.clips(p);
  H.info('music dropped on V2: ' + JSON.stringify(cl.map(c => [c.track, c.kind, c.start])));
  H.ok(cl.length === 1 && cl[0].kind === 'audio' && cl[0].track[0] === 'A', 'audio file dropped on a video track lands on an audio track');
  await H.key(p, 'Control+z');
  it = await libItem('silent.webm');
  await H.dnd(p, it.x, it.y, await H.tlX(p, 10), await H.tlRowY(p, 'A2'));
  await p.waitForTimeout(300);
  await dismissMatch();
  cl = await H.clips(p);
  H.info('silent.webm dropped on A2: ' + JSON.stringify(cl.map(c => [c.track, c.kind, c.start])));
  H.ok(cl.length === 1 && cl[0].kind === 'video' && cl[0].track[0] === 'V', 'video-only file dropped on an audio track lands on a video track');
  await H.key(p, 'Control+z');
  // ---- 4K clip on a vertical sequence with scale to frame
  await H.key(p, 'Control+Alt+Shift+n');
  await p.waitForSelector('.dialog:has-text("New Sequence")');
  await p.click('.dialog .preset[data-w="1080"][data-h="1920"]');
  await p.click('.dialog .btn.primary');
  await p.waitForTimeout(300);
  it = await libItem('clip4k.webm');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V1'));
  await dismissMatch();
  await p.waitForTimeout(1500);
  await H.key(p, 'Backslash');
  const q = await p.evaluate(() => { const C = Cutline, s = C.P.seq(), c = s.clips.find(c => c.kind === 'video'); const L = C.Scene.clipLayer(s, c, 0, {}); const q = C.Scene.quad(s, L); return { fit: c.fit, pts: q.pts, w: s.w, h: s.h }; });
  H.info('4K on vertical quad: ' + JSON.stringify(q.pts.map(p => p.map(Math.round))) + ' fit=' + q.fit);
  H.ok(q.fit && Math.round(q.pts[1][0] - q.pts[0][0]) === 1080 && Math.round(q.pts[2][1] - q.pts[1][1]) === 608, 'scale-to-frame fits 3840×2160 into 1080 wide (1080×608)');
  px = await H.progPixels(p, [[0.5, 0.05], [0.5, 0.5], [0.5, 0.95]]);
  H.info('vertical seq pixels top/mid/bottom ' + JSON.stringify(px));
  H.ok(px[0].every(v => v < 20) && px[2].every(v => v < 20), 'letterbox bars above/below the 4K clip are background');
  await H.shot(p, '4k-vertical');
  // 4K source thumbnails on the timeline + program at full res; check program canvas size vs playback res
  const cvs = await p.evaluate(() => ({ w: Cutline.Program.canvas.width, h: Cutline.Program.canvas.height, dpr: devicePixelRatio }));
  H.info('program canvas ' + JSON.stringify(cvs));
  // ---- Nesting cycle: nest the 4K clip, open the nested sequence, try to insert the parent into it
  await p.evaluate(() => Cutline.A.selectAll());
  await H.key(p, 'Control+g');
  await p.waitForTimeout(300);
  let seqs = await p.evaluate(() => Cutline.state.project.sequences.map(s => s.name));
  H.info('sequences after nest: ' + seqs);
  const nestedName = seqs[seqs.length - 1];
  const parentName = await p.evaluate(() => Cutline.P.seq().name);
  // double-click the nested clip to open it
  let nb = await H.clipBox(p, { track: 'V1' });
  await p.mouse.dblclick(nb.x0 + 30, nb.y);
  await p.waitForTimeout(300);
  H.ok((await p.evaluate(() => Cutline.P.seq().name)) === nestedName, 'double-click opens the nested sequence');
  // library: context menu on the parent sequence → Insert as Nested Clip
  const pit = await H.center(p, `#p-bin .bin-item:has(.name:text-is("${parentName}"))`);
  await p.mouse.click(pit.x, pit.y, { button: 'right' });
  await p.click('.cl-menu .item:has-text("Insert as Nested Clip")');
  await p.waitForTimeout(300);
  cl = await H.clips(p);
  H.info('after trying to nest the parent into its child: ' + JSON.stringify(cl.map(c => [c.name, c.track])));
  H.ok(!cl.some(c => c.name === parentName), 'refused: parent sequence cannot be nested into its own nested sequence');
  // drag the parent sequence item onto the timeline
  await H.dnd(p, pit.x, pit.y, await H.tlX(p, 200), await H.tlRowY(p, 'V2'));
  await p.waitForTimeout(300);
  cl = await H.clips(p);
  H.ok(!cl.some(c => c.name === parentName), 'refused by drag too');
  await H.shot(p, 'nest-cycle-refused');
  // also: nest the nested clip inside itself via the Library "New Sequence from Clip"? n/a. Switch back.
  await p.click(`.seq-tab:text-is("${parentName}")`);
  await p.waitForTimeout(200);
  // ---- captions: overlapping, out of order, with HTML
  await p.click('.seq-tab:text-is("Sequence 1")');
  await p.waitForTimeout(200);
  it = await libItem('main1080.webm');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V1'));
  await dismissMatch();
  await H.key(p, 'Backslash');
  const srt = `1\n00:00:02,000 --> 00:00:01,000\nBackwards <i>italic</i> & <b>bold</b>\n\n3\n00:00:00,500 --> 00:00:03,000\n<font color="red">Second starts first</font> <script>alert(1)</script>\n\n2\n00:00:02,500 --> 00:00:04,000\nOverlaps "quotes" & ampersand\n\n4\n00:00:05,000 --> 00:00:05,000\nZero length\n`;
  H.fs.writeFileSync(H.MEDIA2 + 'weird.srt', srt);
  await p.click('#p-bin .tab[data-id="captions"]');
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('#p-bin .pane-toolbar button:has-text("Import SRT")')]);
  await fc.setFiles(H.MEDIA2 + 'weird.srt');
  await p.waitForTimeout(500);
  const caps = await p.evaluate(() => Cutline.P.seq().captions.map(c => [c.start, c.end, c.text]));
  H.info('captions parsed: ' + JSON.stringify(caps));
  H.ok(caps.every(c => c[1] > c[0]), 'every caption has end > start (backwards / zero-length fixed up)');
  H.ok(!caps.some(c => /<|>/.test(c[2])), 'HTML tags stripped from caption text');
  H.ok(caps.some(c => /&/.test(c[2])) && !caps.some(c => /&amp;/.test(c[2])), 'ampersand kept as a literal &');
  // render during the overlap (frame 80 = 2.67 s): which caption shows? must not throw; export SRT must be sorted
  await p.evaluate(() => Cutline.Engine.seek(80)); await p.waitForTimeout(400);
  await H.shot(p, 'captions-overlap');
  const srtOut = await p.evaluate(() => Cutline.Titles.toSRT(Cutline.P.seq()));
  H.info('SRT out:\n' + srtOut);
  // ---- title with emoji and RTL
  await p.evaluate(() => Cutline.Engine.seek(30));
  await H.key(p, 'Control+Alt+t');
  await p.waitForTimeout(300);
  const ta = p.locator('#p-right textarea').first();
  await ta.click({ clickCount: 3 });
  await p.keyboard.type('Hi 👋🏽 שלום عالم 🎬');
  await p.keyboard.press('Tab');
  await p.waitForTimeout(400);
  const ttext = await p.evaluate(() => { const c = Cutline.P.selectedClips()[0]; return c && c.gen.layers[0].text; });
  H.ok(ttext === 'Hi 👋🏽 שלום عالم 🎬', 'emoji + RTL text stored intact: ' + ttext);
  await H.shot(p, 'title-emoji-rtl');
  // double-click the title in the program monitor to edit inline (bounds with RTL text)
  const tb = await p.evaluate(() => { const C = Cutline, s = C.P.seq(), c = C.P.selectedClips()[0]; const b = C.Titles.layerBounds(c.gen.layers[0], s.w, s.h, 1920); return { b: b, sk: C.Program.sk }; });
  H.info('title bounds ' + JSON.stringify(tb));
  H.ok(tb.b.w > 100 && tb.b.w < 1900, 'layer bounds measured sanely for mixed-script text');
  // ---- very long zoom: zoom in to frame level then zoom to fit
  await p.evaluate(() => { if (document.activeElement) document.activeElement.blur(); }); // Tab above may have landed in an inspector field
  for (let i = 0; i < 25; i++) await H.key(p, 'Equal');
  const ppfMax = await p.evaluate(() => Cutline.TL.ppf);
  await H.shot(p, 'zoom-max');
  await H.key(p, 'Backslash');
  const ppfFit = await p.evaluate(() => ({ ppf: Cutline.TL.ppf, sx: Cutline.TL.scrollX, zoomVal: Cutline.TL.zoomRange.value }));
  H.info('ppf max ' + ppfMax + ' fit ' + JSON.stringify(ppfFit));
  H.ok(ppfMax === 40 && ppfFit.sx === 0, 'zoom in caps at 40 px/frame and zoom-to-fit scrolls back to 0');
  // zoom out beyond fit
  for (let i = 0; i < 25; i++) await H.key(p, 'Minus');
  const ppfMin = await p.evaluate(() => ({ ppf: Cutline.TL.ppf, min: Cutline.TL.minPpf() }));
  H.info('ppf after max zoom out ' + JSON.stringify(ppfMin));
  await H.shot(p, 'zoom-min');
  await H.key(p, 'Backslash');
  // ---- save the project with everything used at once, reload it and compare
  const before = await p.evaluate(() => JSON.parse(Cutline.IO.serialize()));
  const [dl] = await Promise.all([p.waitForEvent('download'), H.key(p, 'Control+s')]);
  const saved = H.path.join(__dirname, 'out', 'x2-save.kcut');
  await dl.saveAs(saved);
  const json = JSON.parse(H.fs.readFileSync(saved, 'utf8'));
  const strip = (o) => { const c = JSON.parse(JSON.stringify(o)); delete c.modified; c.sequences.forEach(s => { delete s.playhead; delete s.zoom; }); return c; };
  H.ok(JSON.stringify(strip(json)) === JSON.stringify(strip(before)), 'saved .kcut equals the in-memory serialisation');
  const keys = { seqs: json.sequences.length, nest: json.media.filter(m => m.type === 'nest').length, caps: json.sequences[0].captions.length, trans: json.sequences.reduce((a, s) => a + s.transitions.length, 0), title: json.media.filter(m => m.type === 'gen').length };
  H.info('saved features: ' + JSON.stringify(keys));
  // reload in a fresh page, open it, relink by file picker (names match)
  await p.goto('about:blank');
  await H.boot(p, '?fresh=' + Date.now());
  const [fc2] = await Promise.all([p.waitForEvent('filechooser'), p.click('.welcome .btn:has-text("Open Project")')]);
  await fc2.setFiles(saved);
  await p.waitForFunction(() => !!Cutline.state.project);
  await p.waitForTimeout(800);
  const relinkDlg = await p.$('.dialog:has-text("Relink Media")');
  H.info('relink dialog after open: ' + !!relinkDlg);
  if (relinkDlg) {
    const [fc3] = await Promise.all([p.waitForEvent('filechooser'), p.click('.dialog .btn.primary')]);
    await fc3.setFiles(['main1080.webm', 'music.mp3', 'clip4k.webm', 'still.jpg', 'exif_rot.jpg', 'silent.webm'].map(H.mediaPath));
    await p.waitForFunction(() => Cutline.Media.offlineMedia().length === 0, null, { timeout: 60000 });
    await p.click('.dialog .btn:text-is("Close")');
  }
  await p.waitForTimeout(500);
  const after = await p.evaluate(() => JSON.parse(Cutline.IO.serialize()));
  const cmp = (o) => { const c = strip(o); c.media.forEach(m => { delete m.size; delete m.lastModified; delete m.mime; delete m.fps; delete m.fpsAvg; delete m.vfr; delete m.channels; delete m.sampleRate; delete m.streamed; }); return c; };
  const same = JSON.stringify(cmp(after)) === JSON.stringify(cmp(json));
  H.ok(same, 'reloaded project model matches the saved one (ignoring probe-derived media fields)');
  if (!same) {
    const a = cmp(after), bb = cmp(json);
    for (const k of Object.keys(bb)) if (JSON.stringify(a[k]) !== JSON.stringify(bb[k])) H.info('differs: ' + k + '\n  saved: ' + JSON.stringify(bb[k]).slice(0, 600) + '\n  after: ' + JSON.stringify(a[k]).slice(0, 600));
  }
  await H.key(p, 'Backslash');
  await H.shot(p, 'reloaded');
  await H.finish(b, errs, 'x2_media');
})();
