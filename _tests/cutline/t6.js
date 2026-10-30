const { launch, newProject, importFiles } = require('./lib');
const fs = require('fs');
function assert(c, m) { if (!c) throw new Error('ASSERT: ' + m); console.log('  ok -', m); }
(async () => {
  const { b, p, errs } = await launch();
  try {
    await newProject(p);
    await importFiles(p, ['tone.wav', 'noise.mp3', 'test1.webm']);
    // audio crossfade: tone [0,120) + noise [120,240) on A1 with constant power transition
    const r = await p.evaluate(async () => {
      const C = Cutline, m = C.state.project.media;
      C.edit('a', s2 => { const a1 = C.P.atracks(s2)[0].id; C.T.placeMedia(s2, m[0], 0, null, a1, 'overwrite', 0, 4); C.T.placeMedia(s2, m[1], 120, null, a1, 'overwrite', 0, 4); });
      const s = C.P.seq(); const cl = s.clips.sort((a, b) => a.start - b.start);
      C.edit('tr', s2 => { C.A.placeTransition(s2, C.P.clip(s2, cl[1].id), 'in', 'a_power', 30); });
      const buf = await C.Mixer.renderOffline(C.P.seq(), 0, 8, 48000);
      const d = buf.getChannelData(0); const rms = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += d[i] * d[i]; return Math.sqrt(s / (b - a)); };
      const at = t => rms(Math.floor(t * 48000), Math.floor((t + 0.05) * 48000));
      return { before: at(3.2), mid: at(3.97), after: at(4.7), end: at(7.9) };
    });
    console.log('crossfade rms', JSON.stringify(r));
    assert(r.before > 0.01 && r.mid > 0.01 && r.after > 0.01, 'no gap across audio crossfade');
    // speed 2x with pitch preservation (offline)
    const r2 = await p.evaluate(async () => {
      const C = Cutline;
      C.edit('clear', s2 => { s2.clips = []; s2.transitions = []; C.T.placeMedia(s2, C.state.project.media[0], 0, null, C.P.atracks(s2)[0].id, 'overwrite'); });
      C.edit('speed', s2 => { C.T.setSpeed(s2, s2.clips[0], 2, false); });
      const s = C.P.seq(); const dur = s.clips[0].dur;
      const buf = await C.Mixer.renderOffline(s, 0, dur / s.fps, 48000);
      // estimate frequency by zero crossings (tone.wav is 220 Hz)
      const d = buf.getChannelData(0); let zc = 0; const a = 48000, bb = 48000 * 2;
      for (let i = a + 1; i < bb; i++) if ((d[i - 1] < 0) !== (d[i] < 0)) zc++;
      return { dur, freq: zc / 2 / 1 };
    });
    console.log('2x speed', JSON.stringify(r2));
    assert(r2.dur === 120 && Math.abs(r2.freq - 220) < 15, 'speed 2x keeps pitch (≈220 Hz)');
    const r3 = await p.evaluate(async () => {
      const C = Cutline;
      C.edit('pitchoff', s2 => { s2.clips[0].au.pitch = false; });
      const s = C.P.seq(); const buf = await C.Mixer.renderOffline(s, 0, 3, 48000);
      const d = buf.getChannelData(0); let zc = 0; for (let i = 48001; i < 96000; i++) if ((d[i - 1] < 0) !== (d[i] < 0)) zc++;
      return zc / 2;
    });
    console.log('2x speed, no pitch preserve freq', r3);
    assert(Math.abs(r3 - 440) < 20, 'speed 2x without pitch lock doubles pitch');
    // reverse video clip renders
    await p.evaluate(async () => {
      const C = Cutline;
      C.edit('rev', s2 => { s2.clips = []; const m = C.state.project.media[2]; const r = C.T.placeMedia(s2, m, 0, C.P.vtracks(s2)[0].id, null, 'overwrite'); r[0].reverse = true; });
      C.Engine.seek(0); C.Engine.renderNow(); await new Promise(r => setTimeout(r, 600)); C.Engine.renderNow();
    });
    const srcT = await p.evaluate(() => { const C = Cutline, s = C.P.seq(); return C.P.sourceSec(s, s.clips[0], 0); });
    assert(srcT > 9.9, 'reverse clip starts at source end (' + srcT.toFixed(2) + ')');
    // ctrl-drag insert
    await p.evaluate(() => { const C = Cutline; C.edit('two', s2 => { s2.clips = []; const m = C.state.project.media[2]; const v = C.P.vtracks(s2)[0].id; C.T.placeMedia(s2, m, 0, v, null, 'overwrite', 0, 2); C.T.placeMedia(s2, m, 60, v, null, 'overwrite', 2, 4); C.T.placeMedia(s2, m, 120, v, null, 'overwrite', 4, 6); }); C.TL.zoomFit(); });
    const tl = await p.locator('.tl-scroll').boundingBox();
    const rowY = await p.evaluate(() => Cutline.TL.rowOf(Cutline.P.vtracks(Cutline.P.seq())[0].id).y + 30);
    const x3 = await p.evaluate(() => Cutline.TL.f2x(130)), x0 = await p.evaluate(() => Cutline.TL.f2x(0));
    await p.mouse.move(tl.x + x3, tl.y + rowY); await p.mouse.down();
    await p.keyboard.down('Control');
    await p.mouse.move(tl.x + x0 + 20 * (await p.evaluate(() => Cutline.TL.ppf)) + 1, tl.y + rowY, { steps: 8 });
    await p.mouse.up(); await p.keyboard.up('Control');
    const ins = await p.evaluate(() => Cutline.P.seq().clips.sort((a, b) => a.start - b.start).map(c => [c.start, c.dur, +c.in.toFixed(2)]));
    console.log('ctrl insert', JSON.stringify(ins));
    assert(ins.length === 4 && ins[1][2] === 4, 'ctrl-drag insert splits and ripples');
    // gap select + delete closes gap
    await p.evaluate(() => { const C = Cutline; C.edit('gap', s2 => { s2.clips = []; const m = C.state.project.media[2]; const v = C.P.vtracks(s2)[0].id; C.T.placeMedia(s2, m, 0, v, null, 'overwrite', 0, 1); C.T.placeMedia(s2, m, 90, v, null, 'overwrite', 1, 2); }); C.TL.zoomFit(); });
    const xg = await p.evaluate(() => Cutline.TL.f2x(60));
    await p.mouse.click(tl.x + xg, tl.y + rowY);
    await p.keyboard.press('Delete');
    const g = await p.evaluate(() => Cutline.P.seq().clips.map(c => c.start).sort((a, b) => a - b));
    assert(g[1] === 30, 'ripple delete gap');
    // track select forward
    await p.keyboard.press('a');
    await p.mouse.click(tl.x + await p.evaluate(() => Cutline.TL.f2x(5)), tl.y + rowY);
    const nsel = await p.evaluate(() => Cutline.state.selection.length);
    assert(nsel === 2, 'track select forward selects following clips');
    await p.keyboard.press('v');
    // nudge
    await p.evaluate(() => { const C = Cutline; C.A.select([C.P.seq().clips.sort((a, b) => a.start - b.start)[1].id]); });
    await p.keyboard.press('Alt+ArrowRight');
    const nd = await p.evaluate(() => Cutline.P.seq().clips.sort((a, b) => a.start - b.start)[1].start);
    assert(nd === 31, 'nudge right');
    // voiceover-less: markers dialog edit
    await p.evaluate(() => { Cutline.Engine.seek(10); Cutline.state.focus = 'timeline'; Cutline.A.deselect(); });
    await p.keyboard.press('m'); await p.keyboard.press('m');
    await p.waitForTimeout(200);
    const dlg = await p.locator('.dialog-head:has-text("Marker")').count();
    assert(dlg === 1, 'pressing M on existing marker opens marker editor');
    await p.fill('.dialog input[type=text] >> nth=0', 'Chapter A');
    await p.click('.dialog-foot .btn.primary');
    assert(await p.evaluate(() => Cutline.P.seq().markers[0].name) === 'Chapter A', 'marker renamed');
  } catch (e) { console.log('TEST ERROR', e); await p.screenshot({ path: 'shots/err.png' }); }
  console.log('ERRORS:\n' + errs.join('\n').slice(0, 3000));
  await b.close();
})();
