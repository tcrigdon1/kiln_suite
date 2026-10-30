// pass2 exploration 1: edge cases around trims, transitions, speed, keyframes, undo across sequences, tracks
const H = require('./plib');
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('x1');
  await H.boot(p);
  await H.newProjectUI(p);
  await H.importUI(p, ['main1080.webm', 'clip25.webm', 'silent.webm']);
  const libItem = async (n) => H.center(p, `#p-bin .bin-item:has(.name:text-is("${n}"))`);
  const sr = await H.center(p, '#p-timeline .tl-scroll');
  let it = await libItem('main1080.webm');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V1'));
  await p.waitForTimeout(200);
  await H.key(p, 'Backslash');
  const ppf = () => p.evaluate(() => Cutline.TL.ppf);
  // ---- 1. trim end past start
  let bx = await H.clipBox(p, { track: 'V1' });
  await H.key(p, 's');
  await H.drag(p, bx.x1 - 2, bx.y, bx.x0 - 60, bx.y);
  let cl = await H.clips(p);
  H.info('after trimming end past start: ' + JSON.stringify(cl.map(c => [c.track, c.start, c.dur, c.in])));
  H.ok(cl.every(c => c.dur >= 1), 'trim end past start leaves clips with dur>=1');
  await H.shot(p, 'trim-past-start');
  await H.key(p, 'Control+z');
  // trim start past end
  bx = await H.clipBox(p, { track: 'V1' });
  await H.drag(p, bx.x0 + 2, bx.y, bx.x1 + 60, bx.y);
  cl = await H.clips(p);
  H.info('after trimming start past end: ' + JSON.stringify(cl.map(c => [c.track, c.start, c.dur, c.in])));
  H.ok(cl.every(c => c.dur >= 1 && c.in >= 0), 'trim start past end leaves dur>=1');
  await H.key(p, 'Control+z');
  // ---- 2. split a 20s clip into a 10-frame piece, drop a 30f cross dissolve on it
  await p.mouse.click(await H.tlX(p, 100), (await H.center(p, '#p-timeline .tl-ruler-hit')).y);
  await H.key(p, 'Control+k');
  await p.mouse.click(await H.tlX(p, 110), (await H.center(p, '#p-timeline .tl-ruler-hit')).y);
  await H.key(p, 'Control+k');
  cl = await H.clips(p);
  const tiny = cl.find(c => c.track === 'V1' && c.start === 100);
  H.ok(tiny && tiny.dur === 10, 'made a 10-frame piece');
  // Effects tab → drag Cross Dissolve to the start of the tiny clip
  await p.click('#p-right .tab[data-id="effects"]');
  await p.fill('.fxb-search input', 'cross');
  await p.waitForTimeout(100);
  const fxi = await H.center(p, '.fxb-item:has-text("Cross Dissolve")');
  let tb = await H.clipBox(p, tiny.id);
  await H.dnd(p, fxi.x, fxi.y, tb.x0 + 2, tb.y);
  await p.waitForTimeout(200);
  let trs = await p.evaluate(() => Cutline.P.seq().transitions.map(t => ({ a: t.a, b: t.b, dur: t.dur, align: t.align })));
  H.info('transition on 10f clip: ' + JSON.stringify(trs));
  H.ok(trs.length === 1 && trs[0].dur <= 20, 'cross dissolve duration clamped for 10-frame clip (dur=' + (trs[0] && trs[0].dur) + ')');
  await H.shot(p, 'short-clip-transition');
  // drag it at the end too
  await H.dnd(p, fxi.x, fxi.y, tb.x1 - 2, tb.y);
  await p.waitForTimeout(200);
  trs = await p.evaluate(() => Cutline.P.seq().transitions.map(t => ({ a: t.a, b: t.b, dur: t.dur, align: t.align })));
  H.info('two transitions on 10f clip: ' + JSON.stringify(trs));
  await H.shot(p, 'short-clip-two-transitions');
  // render frames across the tiny clip and check nothing throws; scrub
  for (let f = 95; f <= 115; f += 2) { await p.evaluate((f) => Cutline.Engine.seek(f), f); await p.waitForTimeout(60); }
  // ---- 3. transition at sequence start and end (single sided)
  await p.click('#p-right .tab[data-id="effects"]');
  await p.fill('.fxb-search input', 'dip to black');
  const dip = await H.center(p, '.fxb-item:has-text("Dip to Black")');
  const first = await H.clipBox(p, { track: 'V1', idx: 0 });
  await H.dnd(p, dip.x, dip.y, first.x0 + 2, first.y);
  await p.waitForTimeout(200);
  const last = await H.clipBox(p, { track: 'V1', idx: 2 });
  await H.dnd(p, dip.x, dip.y, last.x1 - 2, last.y);
  await p.waitForTimeout(200);
  trs = await p.evaluate(() => Cutline.P.seq().transitions.map(t => ({ a: t.a, b: t.b, dur: t.dur, align: t.align, type: t.type })));
  H.info('transitions: ' + JSON.stringify(trs));
  H.ok(trs.some(t => !t.a && t.b) && trs.some(t => t.a && !t.b), 'fade-in at start and fade-out at end exist');
  // frame 0 should be near black with dip to black at 0
  await p.evaluate(() => Cutline.Engine.seek(0)); await p.waitForTimeout(300);
  let px = await H.progPixels(p, [[0.5, 0.5]]);
  H.info('frame 0 pixel after 300ms ' + px[0]);
  if (px[0][0] + px[0][1] + px[0][2] >= 60) { await p.waitForTimeout(2500); px = await H.progPixels(p, [[0.5, 0.5]]); H.info('frame 0 pixel after 2.8s ' + px[0] + ' ' + JSON.stringify(await p.evaluate(() => { const E = Cutline.Engine, v = E.provider.vids; return { pend: E.pendSince, vids: Object.keys(v).map(k => [k, v[k].el.readyState, v[k].clipId, v[k].el.currentTime]), assign: E.provider.assign, lastFrame: E.lastScene && E.lastScene.frame }; }))); }
  H.ok(px[0][0] + px[0][1] + px[0][2] < 60, 'frame 0 is dark (dip to black fade-in)');
  const endF = await p.evaluate(() => Cutline.P.seqDuration(Cutline.P.seq()));
  await p.evaluate((f) => Cutline.Engine.seek(f), endF - 1); await p.waitForTimeout(300);
  px = await H.progPixels(p, [[0.5, 0.5]]);
  H.info('last frame pixel ' + px[0]);
  H.ok(px[0][0] + px[0][1] + px[0][2] < 60, 'last frame is dark (dip to black fade-out)');
  await H.shot(p, 'fades-start-end');
  // ---- 4. move the last clip (with fade-out transition) away: transition should follow the clip
  const lastB = await H.clipBox(p, { track: 'V1', idx: 2 });
  await H.key(p, 's');
  await H.drag(p, lastB.x0 + 40, lastB.y, lastB.x0 + 40 + 120 * (await ppf()), lastB.y);
  trs = await p.evaluate(() => Cutline.P.seq().transitions.map(t => ({ a: t.a, b: t.b, dur: t.dur, align: t.align, type: t.type, tr: t.trackId })));
  cl = await H.clips(p);
  H.info('after moving last clip: ' + JSON.stringify(trs) + ' clips ' + JSON.stringify(cl.filter(c => c.track === 'V1').map(c => [c.start, c.dur])));
  H.ok(trs.some(t => t.a && !t.b && t.type === 'dipblack'), 'fade-out transition survived moving its clip');
  const r2 = await p.evaluate(() => { const s = Cutline.P.seq(); return s.transitions.map(t => Cutline.P.transitionRange(s, t)).map(r => [r.start, r.end]); });
  H.info('transition ranges: ' + JSON.stringify(r2));
  await H.shot(p, 'moved-clip-with-fade');
  // move it back next to the previous clip: cross dissolve between tiny and last was two-sided before. The tiny→last dissolve was set at tiny end.
  await H.key(p, 'Control+z');
  // ---- 5. razor exactly on a transition (center of the dissolve between tiny and last)
  await H.key(p, 'c');
  const mid = await p.evaluate(() => { const s = Cutline.P.seq(); const t = s.transitions.find(t => t.a && t.b); if (!t) return null; const r = Cutline.P.transitionRange(s, t); return { f: Math.round((r.start + r.end) / 2), cut: r.cut, id: t.id, s: r.start, e: r.end }; });
  H.info('two-sided transition: ' + JSON.stringify(mid));
  if (mid) {
    const rowY = await H.tlRowY(p, 'V1');
    await p.mouse.click(await H.tlX(p, mid.f + 0.4), rowY + 18); // below the transition bar? bar sits at 42% of row; click near bottom of row
    await p.waitForTimeout(200);
    trs = await p.evaluate(() => Cutline.P.seq().transitions.map(t => ({ id: t.id, a: t.a, b: t.b, dur: t.dur })));
    cl = await H.clips(p);
    H.info('after razor on transition: ' + JSON.stringify(trs) + ' V1 ' + JSON.stringify(cl.filter(c => c.track === 'V1').map(c => [c.id, c.start, c.dur])));
    // validity: every two-sided transition's a must end where b starts
    const valid = await p.evaluate(() => { const s = Cutline.P.seq(); return s.transitions.every(t => { const a = t.a && Cutline.P.clip(s, t.a), bb = t.b && Cutline.P.clip(s, t.b); if (a && bb) return a.start + a.dur === bb.start && a.trackId === bb.trackId; return true; }); });
    H.ok(valid, 'transitions consistent after razor through a transition');
    await H.shot(p, 'razor-on-transition');
  }
  await H.key(p, 'v');
  // ---- 6. speed change on a clip with keyframes and a transition
  await H.key(p, 'Control+z'); await H.key(p, 'Control+z');
  // select tiny... instead use the first clip (has fade-in). Add 2 opacity keyframes by inspector
  const f0 = await H.clipBox(p, { track: 'V1', idx: 0 });
  await p.mouse.click(f0.x0 + 30, f0.y);
  await p.click('#p-right .tab[data-id="inspector"]');
  await p.evaluate(() => Cutline.Engine.seek(10));
  await p.waitForTimeout(100);
  const opRow = p.locator('.cl-field:has(label.scrub:text-is("Opacity"))').first();
  await opRow.locator('.kf-btn').first().click(); // stopwatch
  await p.evaluate(() => Cutline.Engine.seek(60));
  await p.waitForTimeout(150);
  const opNum = opRow.locator('input[type=number]');
  await opNum.click({ clickCount: 3 }); await p.keyboard.type('20'); await p.keyboard.press('Enter');
  await p.waitForTimeout(150);
  let kf = await p.evaluate(() => { const c = Cutline.P.selectedClips()[0]; return c.kf['tf.op']; });
  H.info('keyframes before speed: ' + JSON.stringify(kf));
  H.ok(kf && kf.length === 2 && kf[1].f === 60, 'two opacity keyframes at 10 and 60');
  await H.key(p, 'Control+r');
  await p.waitForSelector('.dialog:has-text("Clip Speed")');
  const spIn = p.locator('.dialog input[type=number]').first();
  await spIn.click({ clickCount: 3 }); await p.keyboard.type('200');
  await p.click('.dialog .btn.primary');
  await p.waitForTimeout(200);
  kf = await p.evaluate(() => { const c = Cutline.P.selectedClips()[0]; return { kf: c.kf['tf.op'], dur: c.dur, speed: c.speed }; });
  H.info('after 200%: ' + JSON.stringify(kf));
  H.ok(kf.kf[1].f === 30 && kf.dur === 50, 'keyframes scaled with speed (60→30), dur 100→50');
  trs = await p.evaluate(() => { const s = Cutline.P.seq(); return s.transitions.map(t => { const r = Cutline.P.transitionRange(s, t); return { a: !!t.a, b: !!t.b, dur: t.dur, s: r.start, e: r.end }; }); });
  H.info('transitions after speed: ' + JSON.stringify(trs));
  H.ok(trs.every(t => t.dur >= 1), 'transitions still valid after speed change');
  await H.shot(p, 'speed-with-kf');
  // reverse + speed + freeze on the same clip
  await p.click('.cl-check:has-text("Reverse") input');
  await p.waitForTimeout(100);
  await p.evaluate(() => Cutline.Engine.seek(20));
  await H.key(p, 'Shift+f'); // freeze frame insert
  await p.waitForTimeout(300);
  cl = await H.clips(p);
  H.info('after reverse+freeze: ' + JSON.stringify(cl.filter(c => c.track === 'V1').map(c => [c.name, c.start, c.dur, c.speed])));
  const frz = await p.evaluate(() => Cutline.P.seq().clips.filter(c => c.freeze != null).map(c => ({ freeze: c.freeze, dur: c.dur, start: c.start, rev: c.reverse })));
  H.info('freeze clips: ' + JSON.stringify(frz));
  H.ok(frz.length === 1 && frz[0].freeze >= 0 && frz[0].freeze <= 20.1, 'freeze frame of reversed 200% clip has sane source time');
  // the frame shown in the freeze must equal source frame at that time: compare program at freeze start vs the end of clip before it
  await p.evaluate((f) => Cutline.Engine.seek(f), frz[0].start - 1); await p.waitForTimeout(400);
  const hBefore = await H.progHash(p);
  await p.evaluate((f) => Cutline.Engine.seek(f), frz[0].start + 5); await p.waitForTimeout(400);
  const hFreeze = await H.progHash(p);
  H.info('hash before freeze ' + hBefore + ' freeze ' + hFreeze);
  await H.shot(p, 'reverse-speed-freeze');
  // ---- 7. keyframes outside the trimmed range: trim start past the first keyframe
  await H.key(p, 'Control+z'); // undo freeze
  await H.key(p, 'Control+z'); // undo reverse
  const c0 = await H.clipBox(p, { track: 'V1', idx: 0 });
  await H.drag(p, c0.x0 + 2, c0.y, c0.x0 + 2 + 20 * (await ppf()), c0.y);
  kf = await p.evaluate(() => { const c = Cutline.P.selectedClips()[0] || Cutline.P.seq().clips[0]; return { kf: c.kf && c.kf['tf.op'], dur: c.dur, start: c.start }; });
  H.info('after trimming start past first key: ' + JSON.stringify(kf));
  await p.mouse.click(c0.x0 + 20 * (await ppf()) + 30, c0.y);
  await p.waitForTimeout(200);
  await H.shot(p, 'kf-outside-range');
  const laneDias = await p.evaluate(() => Array.from(document.querySelectorAll('.kf-lane .dia')).map(d => d.style.left));
  H.info('lane diamonds: ' + JSON.stringify(laneDias));
  H.ok(!laneDias.some(l => parseFloat(l) < 0), 'no keyframe diamond drawn at negative lane position');
  // ---- 8. drag keyframe past another in the timeline (clip body diamonds)
  // ---- 9. undo across sequence switch
  await H.key(p, 'Control+Alt+Shift+n');
  await p.waitForSelector('.dialog:has-text("New Sequence")');
  await p.click('.dialog .btn.primary');
  await p.waitForTimeout(200);
  let seqs = await p.evaluate(() => Cutline.state.project.sequences.map(s => s.name));
  H.ok(seqs.length === 2, 'second sequence created: ' + seqs);
  it = await libItem('clip25.webm');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V1'));
  await p.waitForTimeout(300);
  if (await p.$('.dialog:has-text("Clip format differs")')) await p.click('.dialog .btn:text-is("Keep Sequence Settings")');
  await p.waitForTimeout(200);
  // switch back to sequence 1 via tab, then undo
  await p.click('.seq-tab:text-is("Sequence 1")');
  await p.waitForTimeout(200);
  const active1 = await p.evaluate(() => Cutline.P.seq().name);
  await H.key(p, 'Control+z');
  await p.waitForTimeout(200);
  const after = await p.evaluate(() => ({ name: Cutline.P.seq().name, tab: document.querySelector('.seq-tab.active') && document.querySelector('.seq-tab.active').textContent, n2: Cutline.state.project.sequences[1].clips.length, frame: Cutline.Engine.frame, prog: Cutline.Program.title.textContent }));
  H.info('undo after switching from Seq2→Seq1: ' + JSON.stringify(after) + ' (was on ' + active1 + ')');
  H.ok(after.name === after.tab && after.name === after.prog, 'sequence tab / program title agree with the active sequence after undo');
  await H.shot(p, 'undo-across-seq');
  // ---- 10. delete a track that has clips and is targeted
  await p.click('.seq-tab:text-is("Sequence 1")');
  await p.waitForTimeout(200);
  const v1head = await H.center(p, '.th.video:has(.lbl:text-is("V1"))');
  await p.mouse.click(v1head.x, v1head.y, { button: 'right' });
  await p.click('.cl-menu .item:has-text("Delete Track")');
  await p.waitForTimeout(300);
  const dlg = await p.$('.dialog');
  H.info('delete track with clips: dialog shown? ' + !!dlg);
  if (dlg) { await H.shot(p, 'delete-track-confirm'); await p.click('.dialog .btn.primary'); await p.waitForTimeout(200); }
  cl = await H.clips(p);
  const tracks = await p.evaluate(() => Cutline.P.seq().tracks.map(t => Cutline.P.trackLabel(Cutline.P.seq(), t)));
  H.info('after delete V1: tracks ' + tracks + ' clips ' + cl.length);
  H.ok(tracks.filter(t => t[0] === 'V').length === 2, 'V1 deleted');
  await H.shot(p, 'track-deleted');
  await H.key(p, 'Control+z');
  // ---- 11. rename sequence with a duplicate name
  await p.dblclick('.seq-tab:text-is("Sequence 2")');
  await p.waitForSelector('.dialog');
  await p.fill('.dialog input[type=text]', 'Sequence 1');
  await p.click('.dialog .btn.primary');
  await p.waitForTimeout(200);
  seqs = await p.evaluate(() => Cutline.state.project.sequences.map(s => s.name));
  H.info('names after duplicate rename: ' + seqs);
  await H.shot(p, 'dup-names');
  // click the second tab: which sequence gets activated?
  await p.locator('.seq-tab').nth(1).click();
  await p.waitForTimeout(100);
  const act = await p.evaluate(() => Cutline.state.project.sequences.indexOf(Cutline.P.seq()));
  H.ok(act === 1, 'second tab activates second sequence even with duplicate names (' + act + ')');
  await H.finish(b, errs, 'x1_edges');
})();
