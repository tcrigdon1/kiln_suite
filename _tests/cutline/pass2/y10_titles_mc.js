// pass2 y10: titles — stagger animations, gradient/progress shapes, timecode burn-in, title templates with fields,
// caption presets + per-caption position; multicam grid view + flatten.
const H = require('./plib');
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('y10');
  await H.boot(p, '?test=1');
  await H.importUI2(p, ['track.webm', 'shaky.webm']);
  await p.evaluate(() => { const C = Cutline; C.edit('size', s => { s.w = 640; s.h = 360; }); });
  // helper: count bright pixels in a region of a 128x72 readback
  const bright = async (x0, y0, x1, y1, th = 120) => p.evaluate(([x0, y0, x1, y1, th]) => { const C = Cutline; C.Engine.renderNow(); const sm = C.Engine.comp.readSmall(128, 72); let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * 128 + x) * 4; if (sm[i] + sm[i + 1] + sm[i + 2] > th * 3) n++; } return n; }, [x0, y0, x1, y1, th]);

  /* ---------- rising-letters lower third: text builds up over the in animation ---------- */
  await p.evaluate(() => { const C = Cutline; C.Engine.seek(0); C.A.addTitleAtPlayhead(null, null, 'lowerStagger'); });
  await p.waitForTimeout(300);
  const seekF = async (f) => { await p.evaluate((f) => Cutline.Engine.seek(f), f); await p.waitForTimeout(150); };
  await seekF(3); const t3 = await bright(0, 44, 70, 62);
  await seekF(12); const t12 = await bright(0, 44, 70, 62);
  await seekF(45); const t45 = await bright(0, 44, 70, 62);
  H.info('lower third text pixels: f3=' + t3 + ' f12=' + t12 + ' f45=' + t45);
  H.ok(t3 < t12 && t12 < t45 && t45 > 60, 'character stagger reveals the name progressively');
  await H.shot(p, 'lower-third-mid');
  const clipInfo = await p.evaluate(() => { const C = Cutline, c = C.P.seq().clips[0]; return { anims: c.gen.layers.map(L => L.anIn), grad: c.gen.layers[0].grad }; });
  H.ok(clipInfo.anims.indexOf('chars') >= 0 && clipInfo.anims.indexOf('wordsUp') >= 0 && clipInfo.grad === true, 'preset uses stagger animations and a gradient bar');

  /* ---------- progress bar fills over the clip ---------- */
  await p.evaluate(() => { const C = Cutline; C.edit('clear', s => { s.clips = []; }); C.Engine.seek(0); C.A.addTitleAtPlayhead(null, null, 'progress'); });
  await p.waitForTimeout(300);
  const barW = async (f) => { await seekF(f); return p.evaluate(() => { const C = Cutline; C.Engine.renderNow(); const sm = C.Engine.comp.readSmall(640, 360); let maxX = -1; for (let x = 0; x < 640; x++) { const i = (342 * 640 + x) * 4; if (sm[i] > 200 && sm[i + 1] > 100 && sm[i + 2] < 120) maxX = x; } return maxX; }); };
  const w37 = await barW(37), w75 = await barW(75), w112 = await barW(112); // clip is 150 frames (5 s)
  H.info('progress fill right edge: 25%=' + w37 + ' 50%=' + w75 + ' 75%=' + w112);
  // bar spans 1700/1920 of the width centred: x from 37 to 603 → 25 % ≈ 178, 50 % ≈ 320, 75 % ≈ 461
  H.ok(Math.abs(w37 - 178) < 14 && Math.abs(w75 - 320) < 14 && Math.abs(w112 - 461) < 14, 'progress bar fill tracks the clip\'s elapsed fraction');
  await H.shot(p, 'progress-bar');

  /* ---------- timecode burn-in ---------- */
  const tc = await p.evaluate(async () => {
    const C = Cutline, P = C.P;
    const m = C.A.newGen('tcburn');
    C.edit('tc', s => { s.clips = []; const bg = C.Media.newGen('solid'); bg.gen.color = '#203040'; C.T.placeMedia(s, bg, 0, P.vtracks(s)[0].id, null, 'overwrite', 0, 4); C.T.placeMedia(s, m, 0, P.vtracks(s)[1].id, null, 'overwrite', 0, 4); });
    function shot(f) { C.Engine.seek(f); C.Engine.renderNow(); const sm = C.Engine.comp.readSmall(640, 360); let box = 0, white = 0, hash = 0; for (let y = 318; y < 352; y++) for (let x = 10; x < 140; x++) { const i = (y * 640 + x) * 4; if (sm[i] + sm[i + 1] + sm[i + 2] < 60) box++; if (sm[i] > 170 && sm[i + 1] > 170) { white++; hash = (hash * 31 + x * 7 + y) % 1000003; } } return { box, white, sig: hash + ':' + white }; }
    const a = shot(45), b2 = shot(46), c = shot(45);
    // the drawn string itself
    const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360; const g = cv.getContext('2d');
    let txt = null; const of = g.fillText.bind(g); g.fillText = function (t) { txt = t; return of.apply(g, arguments); };
    C.Titles.drawTcBurn(g, m.gen, 640, 360, { frame: 45, fps: 30 });
    return { box45: a.box, white45: a.white, differs: a.sig !== b2.sig, stable: a.sig === c.sig, txt, name: m.name };
  });
  H.info('timecode burn-in: ' + JSON.stringify(tc));
  H.ok(tc.box45 > 40 && tc.white45 > 10, 'timecode burn-in draws a dark box with white digits bottom-left');
  H.ok(tc.differs && tc.stable, 'the stamp changes from frame to frame and is stable for the same frame');
  H.ok(tc.txt === '00:00:01:15', 'frame 45 at 30 fps reads 00:00:01:15 (' + tc.txt + ')');
  await H.shot(p, 'timecode-burnin');

  /* ---------- title templates with fillable fields ---------- */
  await p.evaluate(() => { const C = Cutline; C.edit('clear', s => { s.clips = []; }); C.Engine.seek(0); const c = C.A.addTitleAtPlayhead(null, null, 'lower'); C.A.select([c.id]); C.ui.showTab('inspector'); });
  await p.waitForTimeout(400);
  await p.click('.insp-scroll button:has-text("Save as Template")');
  await p.waitForSelector('.dialog input[type=text]');
  await p.fill('.dialog input[type=text]', 'Interview name');
  await p.click('.dialog-foot .btn.primary');
  await p.waitForTimeout(300);
  const tpls = await p.evaluate(() => Cutline.Titles.templates().map(t => [t.name, t.fields.length]));
  H.ok(tpls.length === 1 && tpls[0][0] === 'Interview name' && tpls[0][1] === 2, 'title saved as a template with its two text fields (' + JSON.stringify(tpls) + ')');
  await p.evaluate(() => Cutline.Engine.seek(200));
  await H.menu(p, 'Effects', 'New Title', 'Interview name');
  await p.waitForSelector('.dialog:has-text("New Title from")');
  await H.shot(p, 'template-dialog');
  const fields = await p.locator('.dialog .form-grid input, .dialog .form-grid textarea').count();
  H.ok(fields === 2, 'template dialog exposes the two text fields');
  await p.fill('.dialog .form-grid input >> nth=0', 'Jordan Lee');
  await p.fill('.dialog .form-grid input >> nth=1', 'Producer');
  await p.click('.dialog-foot .btn.primary');
  await p.waitForTimeout(400);
  const made = await p.evaluate(() => { const s = Cutline.P.seq(); const c = s.clips.find(c => c.start === 200); return c && { texts: c.gen.layers.filter(L => L.type === 'text').map(L => L.text), name: c.name, ids: c.gen.layers.map(L => L.id) }; });
  H.info('from template: ' + JSON.stringify(made));
  H.ok(made && made.texts[0] === 'Jordan Lee' && made.texts[1] === 'Producer', 'a title created from the template carries the filled-in fields');
  await H.shot(p, 'template-title');

  /* ---------- caption presets + per-caption position ---------- */
  await p.evaluate(() => { const C = Cutline; C.edit('caps', s => { s.clips = []; s.captions = [{ id: 'c1', start: 0, end: 60, text: 'HELLO TOP' }, { id: 'c2', start: 60, end: 120, text: 'HELLO BOTTOM' }]; const bg = C.Media.newGen('solid'); bg.gen.color = '#202020'; C.T.placeMedia(s, bg, 0, C.P.vtracks(s)[0].id, null, 'overwrite', 0, 4); }); C.ui.showLeftTab('captions'); });
  await p.waitForTimeout(300);
  await p.selectOption('.cap-row >> nth=0 >> select.cap-pos', '0.12');
  await p.waitForTimeout(200);
  await seekF(10); const topA = await bright(0, 0, 128, 20), botA = await bright(0, 55, 128, 72);
  await seekF(80); const topB = await bright(0, 0, 128, 20), botB = await bright(0, 55, 128, 72);
  H.info('caption pixels: cap1 top=' + topA + ' bottom=' + botA + ' · cap2 top=' + topB + ' bottom=' + botB);
  H.ok(topA > 8 && botA === 0 && topB === 0 && botB > 8, 'per-caption position puts the first caption at the top and leaves the second at the style default');
  await p.click('.pane-toolbar button:has-text("Style"), .pane-toolbar .icon-btn[data-tip^="Caption style"]').catch(() => {});
  const styleOpen = await p.locator('.dialog:has-text("Caption Style")').count();
  if (!styleOpen) await p.evaluate(() => Cutline.Side.captionStyle());
  await p.waitForSelector('.dialog:has-text("Caption Style")');
  await p.selectOption('.dialog select >> nth=0', 'accent');
  await H.shot(p, 'caption-style-preset');
  await p.click('.dialog-foot .btn.primary');
  await p.waitForTimeout(300);
  const capSt = await p.evaluate(() => Cutline.P.seq().capStyle);
  H.ok(capSt.bg === '#f0913a' && capSt.font === 'Bahnschrift' && capSt.bgOp === 0.95, 'caption style preset fills the style fields (' + JSON.stringify(capSt) + ')');
  await seekF(80);
  const accent = await p.evaluate(() => { const C = Cutline; C.Engine.renderNow(); const sm = C.Engine.comp.readSmall(128, 72); let n = 0; for (let y = 58; y < 70; y++) for (let x = 20; x < 108; x++) { const i = (y * 128 + x) * 4; if (sm[i] > 200 && sm[i + 1] > 110 && sm[i + 1] < 180 && sm[i + 2] < 100) n++; } return n; });
  H.ok(accent > 60, 'the accent panel renders orange behind the caption (' + accent + ' px)');

  /* ---------- multicam grid view + flatten ---------- */
  await p.evaluate(() => { const C = Cutline; const ids = C.state.project.media.filter(m => /track|shaky/.test(m.name)).map(m => m.id); C.Multicam.create(ids, { sync: 'start', name: 'MC test' }); });
  await p.waitForTimeout(600);
  await H.menu(p, 'View', 'Multicam Grid View');
  await p.waitForTimeout(500);
  await seekF(45);
  const grid = await p.evaluate(() => { const C = Cutline; C.Engine.renderNow(); const sm = C.Engine.comp.readSmall(64, 36); const at = (x, y) => { const i = (y * 64 + x) * 4; return sm[i] + sm[i + 1] + sm[i + 2]; }; return { on: C.Multicam.gridOn, left: at(16, 9), right: at(48, 9), bottom: at(16, 27), active: C.P.seq().multicam.active }; });
  H.info('grid: ' + JSON.stringify(grid));
  H.ok(grid.on && grid.left > 90 && grid.right > 90 && grid.bottom < 60, 'grid view shows both angles side by side in the top row (empty cells dark)');
  await H.shot(p, 'multicam-grid');
  // click the second cell while playing → angle 2 from the playhead
  await p.evaluate(() => Cutline.Engine.play(1));
  await p.waitForTimeout(400);
  const ov = await H.center(p, '#p-program canvas.overlay');
  await p.mouse.click(ov.x + ov.bb.width * 0.25, ov.y - ov.bb.height * 0.25);
  await p.waitForTimeout(400);
  await p.evaluate(() => Cutline.Engine.pause());
  const sw = await p.evaluate(() => { const C = Cutline, s = C.P.seq(); const ang = s.multicam.angles; const on2 = s.clips.filter(c => c.kind === 'video' && c.trackId === ang[1].v && c.enabled !== false).length; const off1 = s.clips.filter(c => c.kind === 'video' && c.trackId === ang[0].v && c.enabled === false).length; return { active: s.multicam.active, on2, off1, playing: C.Engine.playing }; });
  H.info('after cell click: ' + JSON.stringify(sw));
  H.ok(sw.active === 2 && sw.on2 >= 1 && sw.off1 >= 1, 'clicking the second cell while playing cuts to angle 2');
  await H.menu(p, 'Sequence', 'Flatten Multicam');
  await p.waitForTimeout(400);
  const flat = await p.evaluate(() => { const C = Cutline, s = C.P.seq(); const vts = C.P.vtracks(s); return { mc: !!s.multicam, vtracks: vts.length, v1clips: s.clips.filter(c => c.kind === 'video' && c.trackId === vts[0].id).length, disabled: s.clips.filter(c => c.enabled === false).length, grid: C.Multicam.gridOn, undo: C.H.undo[C.H.undo.length - 1].label }; });
  H.info('flatten: ' + JSON.stringify(flat));
  H.ok(!flat.mc && flat.vtracks === 1 && flat.v1clips >= 2 && flat.disabled === 0 && flat.undo === 'Flatten Multicam', 'Flatten leaves one video track with the chosen pieces and no multicam state');
  await H.shot(p, 'multicam-flat');
  await H.finish(b, errs, 'y10_titles_mc');
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
