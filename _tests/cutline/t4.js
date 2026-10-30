const { launch, newProject, importFiles, MEDIA } = require('./lib');
function assert(c, m) { if (!c) throw new Error('ASSERT: ' + m); console.log('  ok -', m); }
(async () => {
  const { b, p, errs } = await launch();
  try {
    await newProject(p);
    await importFiles(p, ['test1.webm', 'bars.webm', 'photo.png']);
    const S = () => p.evaluate(() => Cutline.P.seq().clips.filter(c => c.kind === 'video').sort((a, b) => a.start - b.start).map(c => [c.start, c.dur, +c.in.toFixed(3), +c.speed.toFixed(3)]));
    const A = () => p.evaluate(() => Cutline.P.seq().clips.filter(c => c.kind === 'audio').sort((a, b) => a.start - b.start).map(c => [c.start, c.dur]));
    await p.evaluate(() => { const C = Cutline; C.edit('x', s2 => { const m = C.state.project.media; const v = C.P.vtracks(s2)[0].id, a = C.P.atracks(s2)[0].id; C.T.placeMedia(s2, m[0], 0, v, a, 'overwrite'); C.T.placeMedia(s2, m[1], 300, v, a, 'overwrite'); C.T.placeMedia(s2, m[2], 480, v, null, 'overwrite'); }); C.TL.zoomFit(); });
    const tl = await p.locator('.tl-scroll').boundingBox();
    const rowY = await p.evaluate(() => Cutline.TL.rowOf(Cutline.P.vtracks(Cutline.P.seq())[0].id).y + 30);
    const X = f => p.evaluate(f => Cutline.TL.f2x(f), f);
    const ppf = await p.evaluate(() => Cutline.TL.ppf);
    async function drag(x0, x1, mods = []) { for (const m of mods) await p.keyboard.down(m); await p.mouse.move(tl.x + x0, tl.y + rowY); await p.mouse.down(); await p.mouse.move(tl.x + x1, tl.y + rowY, { steps: 6 }); await p.mouse.up(); for (const m of mods) await p.keyboard.up(m); }
    console.log('start', JSON.stringify(await S()));
    // ripple edit tool: trim end of clip1 by -60 frames -> following clips shift
    await p.keyboard.press('b');
    let x = await X(300); await drag(x - 2, x - 2 - 60 * ppf);
    let v = await S(); console.log('ripple', JSON.stringify(v));
    assert(v[0][1] < 250 && v[1][0] === v[0][1], 'ripple trim shifts following clips');
    const aa = await A(); assert(aa[1][0] === v[1][0], 'linked audio rippled too');
    // rolling edit between clip1 and clip2: +20 frames
    await p.keyboard.press('n');
    x = await X(v[1][0]); await drag(x, x + 20 * ppf);
    const v2 = await S(); console.log('roll', JSON.stringify(v2));
    assert(v2[1][0] > v[1][0] && v2[0][1] === v2[1][0] && v2[1][0] + v2[1][1] === v[1][0] + v[1][1], 'rolling edit moves the cut, keeps total');
    // slip clip2 by +15 frames (in-point changes, position same)
    await p.keyboard.press('y');
    x = await X(v2[1][0] + 40); await drag(x, x - 15 * ppf);
    const v3 = await S(); console.log('slip', JSON.stringify(v3));
    assert(v3[1][0] === v2[1][0] && v3[1][2] > v2[1][2], 'slip changes source in-point only');
    // slide clip2 by +10
    await p.keyboard.press('u');
    x = await X(v3[1][0] + 40); await drag(x, x + 10 * ppf);
    const v4 = await S(); console.log('slide', JSON.stringify(v4));
    assert(v4[1][0] === v3[1][0] + 10 && v4[0][1] === v3[0][1] + 10, 'slide moves clip and trims neighbours');
    // rate stretch photo? use clip1 end
    await p.keyboard.press('r');
    x = await X(v4[0][1]); 
    // first undo slide to make sure end edge isn't adjacent... just stretch start of clip3 (photo) instead
    const e3 = v4[2][0] + v4[2][1]; x = await X(e3); await drag(x - 1, x - 1 + 30 * ppf);
    const v5 = await S(); console.log('rate', JSON.stringify(v5));
    assert(v5[2][1] > v4[2][1], 'rate stretch lengthens still/clip');
    await p.keyboard.press('v');
    // ripple delete clip2
    await p.evaluate(() => { const s = Cutline.P.seq(); const v = s.clips.filter(c => c.kind === 'video').sort((a, b) => a.start - b.start); Cutline.A.select([v[1].id]); });
    await p.keyboard.press('Shift+Delete');
    const v6 = await S(); console.log('ripple delete', JSON.stringify(v6));
    assert(v6.length === 2 && v6[1][0] === v6[0][1], 'ripple delete closes gap');
    // undo x1
    await p.keyboard.press('Control+z');
    assert((await S()).length === 3, 'undo ripple delete');
    // copy/paste at end
    await p.evaluate(() => { const s = Cutline.P.seq(); const v = s.clips.filter(c => c.kind === 'video').sort((a, b) => a.start - b.start); Cutline.A.select([v[0].id]); Cutline.Engine.seek(Cutline.P.seqDuration(s)); });
    await p.keyboard.press('Control+c'); await p.keyboard.press('Control+v');
    assert((await S()).length === 4, 'copy/paste');
    // lift/extract
    await p.evaluate(() => Cutline.Engine.seek(30)); await p.keyboard.press('i');
    await p.evaluate(() => Cutline.Engine.seek(59)); await p.keyboard.press('o');
    const before = await S();
    await p.keyboard.press("'");
    const after = await S(); console.log('extract', JSON.stringify(before.slice(0, 2)), '->', JSON.stringify(after.slice(0, 3)));
    assert(after[1][0] === 30 && after[0][1] === 30, 'extract removes in/out range and ripples');
    // markers
    await p.evaluate(() => { Cutline.A.deselect(); Cutline.Engine.seek(100); Cutline.state.focus = 'timeline'; });
    await p.keyboard.press('m');
    await p.evaluate(() => Cutline.Engine.seek(200)); await p.keyboard.press('m');
    let mk = await p.evaluate(() => Cutline.P.seq().markers.map(m => m.f));
    assert(mk.length === 2 && mk[0] === 100, 'markers added');
    await p.evaluate(() => Cutline.Engine.seek(0)); await p.keyboard.press('Shift+m');
    assert(await p.evaluate(() => Cutline.Engine.frame) === 100, 'next marker nav');
    // speed dialog on clip 1: 200%
    await p.evaluate(() => { const s = Cutline.P.seq(); const v = s.clips.filter(c => c.kind === 'video').sort((a, b) => a.start - b.start); Cutline.A.select([v[0].id]); });
    const d0 = (await S())[0][1];
    await p.keyboard.press('Control+r');
    await p.fill('.dialog input[type=number]', '200'); await p.click('.dialog-foot .btn.primary');
    const sp = await S(); console.log('speed', d0, '->', JSON.stringify(sp[0]));
    assert(sp[0][3] === 2 && Math.abs(sp[0][1] - d0 / 2) <= 1, 'speed 200% halves duration');
    // freeze frame
    await p.evaluate(() => Cutline.Engine.seek(5));
    const nb = (await S()).length; await p.keyboard.press('Shift+f');
    assert((await S()).length === nb + 2 || (await S()).length === nb + 1, 'freeze frame inserted');
    // captions
    await p.evaluate(() => { Cutline.Engine.seek(10); Cutline.Side.addCaption(); });
    await p.evaluate(() => { const s = Cutline.P.seq(); Cutline.edit('cap', s2 => { s2.captions[0].text = 'Hello captions'; }); });
    const srt = await p.evaluate(() => Cutline.Titles.toSRT(Cutline.P.seq()));
    console.log(srt.trim().replace(/\n/g, ' | '));
    assert(/Hello captions/.test(srt), 'caption to SRT');
    const parsed = await p.evaluate((t) => Cutline.Titles.parseSRT(t, 30).length, srt + '\n2\n00:00:05,000 --> 00:00:06,500\nSecond line\n');
    assert(parsed === 2, 'SRT parse');
    await p.evaluate(() => Cutline.Engine.seek(15)); await p.waitForTimeout(300);
    await p.screenshot({ path: 'shots/20-captions.png' });
    // track ops
    await p.evaluate(() => Cutline.A.addTrack('video'));
    assert(await p.evaluate(() => Cutline.P.vtracks(Cutline.P.seq()).length) === 4, 'add track');
    // lock V1 then try deleting its clip
    await p.evaluate(() => { const s = Cutline.P.seq(); Cutline.edit('lock', s2 => { Cutline.P.vtracks(s2)[0].lock = true; }); const v = s.clips.filter(c => c.kind === 'video')[0]; Cutline.A.select([v.id]); });
    const n0 = (await S()).length; await p.keyboard.press('Delete');
    assert((await S()).length === n0, 'locked track protects clips');
    await p.evaluate(() => Cutline.edit('unlock', s2 => { Cutline.P.vtracks(s2)[0].lock = false; }));
    // history panel
    await p.click('.tabs .tab[data-id="history"]');
    const hcount = await p.locator('.list-pane .lrow').count();
    assert(hcount > 10, 'history panel lists steps (' + hcount + ')');
    await p.screenshot({ path: 'shots/21-history.png' });
    // relink: simulate offline
    const off = await p.evaluate(async () => { const m = Cutline.state.project.media.find(x => x.name === 'bars.webm'); delete Cutline.MRT[m.id]; return Cutline.Media.offlineMedia().length; });
    assert(off === 1, 'media offline simulated');
    await p.evaluate(() => Cutline.Engine.renderNow());
    await p.evaluate(() => Cutline.IO.relinkDialog());
    await p.waitForTimeout(300);
    await p.screenshot({ path: 'shots/22-relink.png' });
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('.dialog-foot .btn.primary')]);
    await fc.setFiles([MEDIA + 'bars.webm', MEDIA + 'tone.wav']);
    await p.waitForFunction(() => Cutline.Media.offlineMedia().length === 0, null, { timeout: 15000 });
    console.log('  ok - relinked by filename');
  } catch (e) { console.log('TEST ERROR', e); await p.screenshot({ path: 'shots/err.png' }); }
  console.log('ERRORS:\n' + errs.join('\n').slice(0, 3000));
  await b.close();
})();
