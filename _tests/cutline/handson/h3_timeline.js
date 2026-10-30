// 3. Timeline editing with real mouse/keyboard
const H = require('./hlib');
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('h3');
  await H.boot(p);
  await H.newProjectUI(p);
  await H.importUI(p, ['main1080.webm', 'music.mp3', 'silent.webm', 'still.jpg']);
  const libItem = async (n) => H.center(p, `#p-bin .bin-item:has(.name:text-is("${n}"))`);
  // --- drag main1080 to V1 at start
  let it = await libItem('main1080.webm');
  const sr = await H.center(p, '#p-timeline .tl-scroll');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V1'));
  await p.waitForTimeout(300);
  let cl = await H.clips(p);
  H.ok(cl.length === 2 && cl[0].start === 0 && cl.find(c => c.track === 'A1'), 'library → V1 drop gives linked V1/A1 at 0: ' + JSON.stringify(cl.map(c => [c.track, c.start, c.dur])));
  await H.key(p, 'Backslash');
  await H.shot(p, 'first-clip');
  // --- silent.webm to V2 at ~3s (90f), music to A2 at 0
  it = await libItem('silent.webm');
  await H.dnd(p, it.x, it.y, await H.tlX(p, 90), await H.tlRowY(p, 'V2'));
  it = await libItem('music.mp3');
  await H.dnd(p, it.x, it.y, await H.tlX(p, 2), await H.tlRowY(p, 'A2'));
  cl = await H.clips(p);
  const v2 = cl.find(c => c.track === 'V2'), a2 = cl.find(c => c.track === 'A2');
  H.ok(v2 && Math.abs(v2.start - 90) <= 3 && !cl.find(c => c.track === 'A3' || (c.track === 'A2' && c.name === 'silent.webm')), 'silent.webm (no audio) → V2 only, at ~90 (' + (v2 && v2.start) + ')');
  H.ok(a2 && a2.start === 0, 'music.mp3 → A2, snapped to 0 (' + (a2 && a2.start) + ')');
  await H.shot(p, 'three-clips');
  // --- move V2 clip right ~30 frames (snapping off to measure)
  await H.key(p, 's'); // snap off
  let bx = await H.clipBox(p, { track: 'V2' });
  const ppf = await p.evaluate(() => Cutline.TL.ppf);
  await H.drag(p, bx.x0 + 20, bx.y, bx.x0 + 20 + 30 * ppf, bx.y);
  let nb = await H.clipBox(p, { track: 'V2' }); if (!nb) { console.log(JSON.stringify(await H.clips(p)), JSON.stringify(bx)); await H.shot(p,'dbg'); }
  H.ok(Math.abs(nb.start - (bx.start + 30)) <= 1, 'move V2 clip by +30f (' + bx.start + '→' + nb.start + ')');
  // --- snapping on: drag so start nears playhead at 150 → snaps exactly
  await H.key(p, 's');
  await p.mouse.click(await H.tlX(p, 150), (await H.center(p, '#p-timeline .tl-ruler-hit')).y); // set playhead via ruler
  H.ok((await H.frame(p)) === 150 || Math.abs((await H.frame(p)) - 150) <= 1, 'ruler click moves playhead');
  const phf = await H.frame(p);
  bx = await H.clipBox(p, { track: 'V2' });
  await H.drag(p, bx.x0 + 20, bx.y, bx.x0 + 20 + (phf - bx.start + 1.2) * ppf, bx.y);
  nb = await H.clipBox(p, { track: 'V2' });
  H.ok(nb.start === phf, 'snapping pulls clip start onto playhead (' + nb.start + ' vs ' + phf + ')');
  await H.shot(p, 'snapped');
  // --- trim V2 end left by 20f
  bx = await H.clipBox(p, { track: 'V2' });
  await H.key(p, 's'); // snap off for exact trim
  await H.drag(p, bx.x1 - 2, bx.y, bx.x1 - 2 - 20 * ppf, bx.y);
  nb = await H.clipBox(p, { track: 'V2' });
  H.ok(Math.abs(nb.dur - (bx.dur - 20)) <= 1, 'trim V2 end −20f (' + bx.dur + '→' + nb.dur + ')');
  // trim start right by 10
  bx = nb;
  await H.drag(p, bx.x0 + 2, bx.y, bx.x0 + 2 + 10 * ppf, bx.y);
  nb = await H.clipBox(p, { track: 'V2' });
  H.ok(Math.abs(nb.start - (bx.start + 10)) <= 1 && Math.abs(nb.dur - (bx.dur - 10)) <= 1, 'trim V2 start +10f (' + bx.start + '/' + bx.dur + '→' + nb.start + '/' + nb.dur + ')');
  await H.key(p, 's');
  await H.shot(p, 'trimmed');
  // --- razor tool click on V1 at ~200
  await H.key(p, 'c');
  let v1 = await H.clipBox(p, { track: 'V1' });
  await p.mouse.click(await H.tlX(p, 200.4), v1.y);
  await p.waitForTimeout(150);
  cl = await H.clips(p);
  H.ok(cl.filter(c => c.track === 'V1').length === 2 && cl.filter(c => c.track === 'A1').length === 2, 'razor click splits linked V1+A1');
  H.ok(cl.some(c => c.track === 'V1' && c.start === 200), 'razor cut at frame 200 (' + cl.filter(c => c.track === 'V1').map(c => c.start) + ')');
  await H.key(p, 'v');
  // --- Ctrl+K at playhead 400 (click ruler, then Ctrl+K)
  await p.mouse.click(await H.tlX(p, 400), (await H.center(p, '#p-timeline .tl-ruler-hit')).y);
  const k400 = await H.frame(p);
  await p.mouse.click(await H.tlX(p, 10), await H.tlRowY(p, 'V3')); // click empty to deselect
  await H.key(p, 'Control+k');
  cl = await H.clips(p);
  H.ok(cl.filter(c => c.track === 'V1').length === 3 && cl.some(c => c.track === 'V1' && c.start === k400), 'Ctrl+K splits targeted tracks at playhead ' + k400 + ': V1 starts ' + cl.filter(c => c.track === 'V1').map(c => c.start));
  H.ok(cl.filter(c => c.track === 'A2').length === 2, 'Ctrl+K also split music on A2 (targeted)');
  await H.shot(p, 'split');
  // --- delete middle V1 piece (lift) → gap; then click the gap and ripple-delete it
  const mid = await H.clipBox(p, { track: 'V1', idx: 1 });
  await p.mouse.click((mid.x0 + mid.x1) / 2, mid.y);
  H.ok((await p.evaluate(() => Cutline.state.selection.length)) === 2, 'clicking a linked clip selects video+audio');
  await H.key(p, 'Delete');
  cl = await H.clips(p);
  H.ok(cl.filter(c => c.track === 'V1').length === 2 && cl.filter(c => c.track === 'A1').length === 2, 'Delete lifts the A/V pair leaving a gap');
  await p.mouse.click((mid.x0 + mid.x1) / 2, mid.y);
  await H.shot(p, 'gap-selected');
  await H.key(p, 'Delete');
  cl = await H.clips(p);
  const v1s = cl.filter(c => c.track === 'V1').sort((a, b) => a.start - b.start);
  H.ok(v1s[1] && v1s[1].start === 200, 'clicking the gap + Delete ripple-deletes it (second V1 now at ' + (v1s[1] && v1s[1].start) + ')');
  const a1s = cl.filter(c => c.track === 'A1').sort((a, b) => a.start - b.start);
  H.ok(a1s[1] && a1s[1].start === 200, 'linked audio rippled too (A1 second at ' + (a1s[1] && a1s[1].start) + ')');
  await H.shot(p, 'gap-closed');
  // --- ripple edit tool: drag end of first V1 clip left 30f → next clip follows
  await H.key(p, 'b'); await H.key(p, 's');
  let c0 = await H.clipBox(p, { track: 'V1', idx: 0 });
  await H.drag(p, c0.x1 - 2, c0.y, c0.x1 - 2 - 30 * ppf, c0.y);
  cl = await H.clips(p);
  let v1r = cl.filter(c => c.track === 'V1').sort((a, b) => a.start - b.start);
  H.ok(v1r[0].dur === 170 && v1r[1].start === 170, 'ripple trim −30f: first dur ' + v1r[0].dur + ', next starts ' + v1r[1].start);
  // --- rolling edit: drag the cut +20f
  await H.key(p, 'n');
  c0 = await H.clipBox(p, { track: 'V1', idx: 0 });
  await H.drag(p, c0.x1 - 1, c0.y, c0.x1 - 1 + 20 * ppf, c0.y);
  cl = await H.clips(p);
  v1r = cl.filter(c => c.track === 'V1').sort((a, b) => a.start - b.start);
  H.ok(v1r[0].dur === 190 && v1r[1].start === 190, 'rolling edit moves cut +20 (dur ' + v1r[0].dur + ', next ' + v1r[1].start + ')');
  // --- slip: second V1 body drag → in point changes, position same
  await H.key(p, 'y');
  let c1 = await H.clipBox(p, { track: 'V1', idx: 1 });
  const in0 = (await H.clips(p)).find(c => c.id === c1.id).in;
  await H.drag(p, (c1.x0 + c1.x1) / 2, c1.y, (c1.x0 + c1.x1) / 2 + 15 * ppf, c1.y);
  cl = await H.clips(p);
  let s1 = cl.find(c => c.id === c1.id);
  H.ok(s1.start === c1.start && s1.dur === c1.dur && Math.abs(s1.in - (in0 - 0.5)) < 0.05, 'slip keeps position, changes source in (' + in0.toFixed(2) + '→' + s1.in.toFixed(2) + ')');
  await H.shot(p, 'slip');
  // --- rate stretch on V2: drag end +40f → speed < 1
  await H.key(p, 'r');
  let v2b = await H.clipBox(p, { track: 'V2' });
  await H.drag(p, v2b.x1 - 2, v2b.y, v2b.x1 - 2 + 40 * ppf, v2b.y);
  cl = await H.clips(p);
  const v2r = cl.find(c => c.track === 'V2');
  H.ok(v2r.speed < 0.9 && Math.abs(v2r.dur - (v2b.dur + 40)) <= 1, 'rate stretch → speed ' + v2r.speed.toFixed(3) + ', dur ' + v2r.dur);
  await H.shot(p, 'rate-stretch');
  // --- slide: put still.jpg between two V1 clips? Use V1: slide middle clip needs 3 clips. Split V1 second clip again at its middle with razor
  await H.key(p, 'c');
  c1 = await H.clipBox(p, { track: 'V1', idx: 1 });
  await p.mouse.click(c1.x0 + (c1.x1 - c1.x0) * 0.5, c1.y);
  await H.key(p, 'u');
  cl = await H.clips(p);
  let before = cl.filter(c => c.track === 'V1').sort((a, b) => a.start - b.start);
  c1 = await H.clipBox(p, { track: 'V1', idx: 1 });
  await H.drag(p, (c1.x0 + c1.x1) / 2, c1.y, (c1.x0 + c1.x1) / 2 + 12 * ppf, c1.y);
  cl = await H.clips(p);
  let after = cl.filter(c => c.track === 'V1').sort((a, b) => a.start - b.start);
  H.ok(after[1].start === before[1].start + 12 && after[0].dur === before[0].dur + 12 && after[1].dur === before[1].dur && after[2].start === before[2].start + 12, 'slide moves middle clip +12, neighbours adjust: ' + JSON.stringify(before.map(c => [c.start, c.dur])) + '→' + JSON.stringify(after.map(c => [c.start, c.dur])));
  await H.shot(p, 'slide');
  // --- Alt-drag: move only the video of a linked pair
  await H.key(p, 'v'); await H.key(p, 's');
  let c2 = await H.clipBox(p, { track: 'V1', idx: 2 });
  const linkedAudio = (await H.clips(p)).find(c => c.track === 'A1' && c.start === c2.start);
  await p.keyboard.down('Alt');
  await H.drag(p, (c2.x0 + c2.x1) / 2, c2.y, (c2.x0 + c2.x1) / 2, await H.tlRowY(p, 'V3'));
  await p.keyboard.up('Alt');
  cl = await H.clips(p);
  H.ok(cl.some(c => c.track === 'V3' && c.id === c2.id) && cl.find(c => c.id === linkedAudio.id).track === 'A1', 'Alt-drag moves only the video to V3; audio stays on A1');
  // Alt-drag it sideways: the pair is now out of sync and the clips show a red offset badge
  const c3 = await H.clipBox(p, c2.id);
  await p.keyboard.down('Alt');
  await H.drag(p, (c3.x0 + c3.x1) / 2, c3.y, (c3.x0 + c3.x1) / 2 + 10 * ppf, c3.y);
  await p.keyboard.up('Alt');
  const so = await p.evaluate((id) => { const C = Cutline, s = C.P.seq(); return C.TL.syncOffset(s, C.P.clip(s, id)); }, c2.id);
  H.ok(so === 10, 'Alt-dragged video shows +10 frames out of sync (' + so + ')');
  await H.shot(p, 'alt-drag');
  await H.key(p, 'Control+z');
  // --- marquee select across V1/A1 from empty space
  await H.key(p, 'Control+Shift+a');
  const yTop = (await H.clipBox(p, { track: 'V1', idx: 0 })).top - 30;
  const xStart = await H.tlX(p, 60);
  await H.drag(p, xStart, (await H.tlRowY(p, 'V2')) , await H.tlX(p, 250), await H.tlRowY(p, 'A1'), { steps: 10 });
  const selN = await p.evaluate(() => Cutline.state.selection.length);
  H.ok(selN >= 4, 'marquee selects clips it touches (' + selN + ')');
  await H.shot(p, 'marquee');
  // --- copy/paste: select first V1 (with audio), Ctrl+C, playhead to end, Ctrl+V
  c0 = await H.clipBox(p, { track: 'V1', idx: 0 });
  await p.mouse.click((c0.x0 + c0.x1) / 2, c0.y);
  await H.key(p, 'Control+c');
  await H.key(p, 'End');
  const endF = await H.frame(p);
  const nBefore = (await H.clips(p)).length;
  await H.key(p, 'Control+v');
  cl = await H.clips(p);
  if (!(cl.length === nBefore + 2)) console.log(nBefore, JSON.stringify(cl.map(c=>[c.track,c.start,c.dur])));
  H.ok(cl.length === nBefore + 2 && cl.filter(c => c.start === endF).length >= 2, 'copy/paste A/V pair at playhead (end ' + endF + ')');
  await H.key(p, 'Backslash');
  await H.shot(p, 'pasted');
  // --- add tracks via header + buttons; delete via context menu
  await p.click('.tl-heads .ruler-spacer .icon-btn[data-tip="Add video track"]');
  await p.click('.tl-heads .ruler-spacer .icon-btn[data-tip="Add audio track"]');
  let tr = await p.evaluate(() => Cutline.P.seq().tracks.map(t => t.kind[0]).join(''));
  H.ok((tr.match(/v/g) || []).length === 4 && (tr.match(/a/g) || []).length === 4, 'added V4 and A4 (' + tr + ')');
  await H.shot(p, 'tracks-added');
  await p.click('.tl-heads .th.video:has(.lbl:text-is("V4"))', { button: 'right' });
  await p.locator('.cl-menu .item', { hasText: 'Delete Track' }).click();
  await p.waitForTimeout(150);
  tr = await p.evaluate(() => Cutline.P.seq().tracks.map(t => t.kind[0]).join(''));
  H.ok((tr.match(/v/g) || []).length === 3, 'deleted V4 via header context menu');
  // --- mute / solo / lock / hide
  await p.click('.tl-heads .th.audio:has(.lbl:text-is("A2")) .tbtn.mute');
  await p.click('.tl-heads .th.audio:has(.lbl:text-is("A1")) .tbtn.solo');
  await p.click('.tl-heads .th.video:has(.lbl:text-is("V2")) .tbtn.eye');
  await p.click('.tl-heads .th.video:has(.lbl:text-is("V3")) .tbtn.lock');
  const st = await p.evaluate(() => { const s = Cutline.P.seq(), L = (l) => s.tracks.find(t => Cutline.P.trackLabel(s, t) === l); return { m: L('A2').mute, so: L('A1').solo, hid: L('V2').hidden, lock: L('V3').lock }; });
  H.ok(st.m && st.so && st.hid && st.lock, 'mute/solo/hide/lock toggled: ' + JSON.stringify(st));
  await H.shot(p, 'track-states');
  // locked track: dragging its clip does nothing
  const v3c = await H.clipBox(p, { track: 'V3' });
  await H.drag(p, (v3c.x0 + v3c.x1) / 2, v3c.y, (v3c.x0 + v3c.x1) / 2 + 60, v3c.y);
  H.ok((await H.clipBox(p, { track: 'V3' })).start === v3c.start, 'clip on locked track does not move');
  await p.click('.tl-heads .th.video:has(.lbl:text-is("V3")) .tbtn.lock');
  await p.click('.tl-heads .th.video:has(.lbl:text-is("V2")) .tbtn.eye');
  await p.click('.tl-heads .th.audio:has(.lbl:text-is("A2")) .tbtn.mute');
  await p.click('.tl-heads .th.audio:has(.lbl:text-is("A1")) .tbtn.solo');
  // --- track height drag on V1
  const rs = await H.center(p, '.tl-heads .th.video:has(.lbl:text-is("V1")) .resize');
  const h0 = await p.evaluate(() => { const s = Cutline.P.seq(); return Cutline.P.vtracks(s)[0].h || 54; });
  await H.drag(p, rs.x, rs.y, rs.x, rs.y + 40);
  const h1 = await p.evaluate(() => { const s = Cutline.P.seq(); return Cutline.P.vtracks(s)[0].h; });
  H.ok(h1 >= h0 + 35, 'track height drag (' + h0 + '→' + h1 + ')');
  await H.shot(p, 'track-height');
  // --- zoom: ctrl+wheel in, then backslash fits
  const ppf0 = await p.evaluate(() => Cutline.TL.ppf);
  await p.mouse.move(await H.tlX(p, 100), await H.tlRowY(p, 'V1'));
  await p.keyboard.down('Control'); await p.mouse.wheel(0, -300); await p.keyboard.up('Control');
  await p.waitForTimeout(150);
  const ppf1 = await p.evaluate(() => Cutline.TL.ppf);
  H.ok(ppf1 > ppf0 * 1.3, 'Ctrl+wheel zooms in (' + ppf0.toFixed(2) + '→' + ppf1.toFixed(2) + ')');
  await H.shot(p, 'zoomed');
  await H.key(p, 'Backslash');
  const ppf2 = await p.evaluate(() => Cutline.TL.ppf);
  H.ok(Math.abs(ppf2 - ppf0) / ppf0 < 0.25, '\\ zooms to fit (' + ppf2.toFixed(2) + ')');
  // --- markers: M at playhead, double-click marker on ruler → rename
  await p.mouse.click(await H.tlX(p, 120), (await H.center(p, '#p-timeline .tl-ruler-hit')).y);
  await p.mouse.click(await H.tlX(p, 10), await H.tlRowY(p, 'V3') + 200 > 0 ? (await H.center(p, '#p-timeline .tl-scroll')).bb.y + (await H.center(p, '#p-timeline .tl-scroll')).bb.height - 20 : 0); // empty area
  const mf = await H.frame(p);
  await H.key(p, 'm');
  let mks = await p.evaluate(() => Cutline.P.seq().markers);
  H.ok(mks.length === 1 && mks[0].f === mf, 'M adds a sequence marker at playhead (' + JSON.stringify(mks.map(m => m.f)) + ' vs ' + mf + ')');
  const rul = await H.center(p, '#p-timeline .tl-ruler-hit');
  await p.mouse.dblclick(await H.tlX(p, mf), rul.y);
  await p.waitForTimeout(200);
  const dlgTitle = await p.locator('.dialog-head span').first().innerText().catch(() => '');
  H.ok(/Marker/.test(dlgTitle), 'double-click marker opens editor (' + dlgTitle + ')');
  await p.keyboard.press('Control+a'); await p.keyboard.type('Intro');
  await H.shot(p, 'marker-dialog');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(150);
  mks = await p.evaluate(() => Cutline.P.seq().markers);
  H.ok(mks[0] && mks[0].name === 'Intro', 'marker renamed to Intro');
  // drag marker on ruler +30f
  const mx = await H.tlX(p, mf);
  await H.drag(p, mx, rul.y + 3, mx + 30 * (await p.evaluate(() => Cutline.TL.ppf)), rul.y + 3);
  mks = await p.evaluate(() => Cutline.P.seq().markers);
  H.ok(Math.abs(mks[0].f - (mf + 30)) <= 2, 'drag marker on ruler (' + mf + '→' + mks[0].f + ')');
  await H.shot(p, 'marker');
  // Shift+M / Ctrl+Shift+M navigation
  await H.key(p, 'Home'); await H.key(p, 'Shift+m');
  H.ok((await H.frame(p)) === mks[0].f, 'Shift+M jumps to next marker');
  await H.finish(b, errs, 'h3_timeline');
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
