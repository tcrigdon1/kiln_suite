// pass2 y4: playback sync with mixed frame rates and speed changes. A 30 fps sequence plays a 60 fps clip at 50%,
// a 25 fps clip at 150% and a 29.97 clip at 100%, looping for ~40 s. At every sample the <video> element's
// currentTime is compared with the source time the engine wants for the audio-clock frame. Also: adaptive
// resolution drop under load (Auto), scrub cancellation (fast seeks must settle on the last target), and the
// JKL shuttle rates.
const H = require('./plib');
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('y4');
  await H.boot(p, '?test=1');
  await H.importUI2(p, ['clip60.webm', 'clip25.webm', 'ntsc2997.webm', 'music.mp3']);
  await p.evaluate(() => {
    const C = Cutline, P = C.P, T = C.T;
    C.edit('setup', (s, prj) => {
      const m60 = prj.media.find(m => m.name === 'clip60.webm'), m25 = prj.media.find(m => m.name === 'clip25.webm'), mn = prj.media.find(m => m.name === 'ntsc2997.webm'), mu = prj.media.find(m => m.name === 'music.mp3');
      const v1 = P.vtracks(s)[0].id, a1 = P.atracks(s)[0].id, a2 = P.atracks(s)[1].id;
      const a = T.placeMedia(s, m60, 0, v1, a1, 'overwrite'); T.setSpeed(s, a[0], 0.5, false); T.setSpeed(s, a[1], 0.5, false);
      let e = a[0].start + a[0].dur;
      const bcl = T.placeMedia(s, m25, e, v1, a1, 'overwrite'); T.setSpeed(s, bcl[0], 1.5, false); T.setSpeed(s, bcl[1], 1.5, false);
      e = bcl[0].start + bcl[0].dur;
      const c = T.placeMedia(s, mn, e, v1, a1, 'overwrite');
      e = c[0].start + c[0].dur;
      T.placeMedia(s, mu, 0, null, a2, 'overwrite', 0, e / s.fps);
    });
    Cutline.Engine.loop = true;
  });
  const layout = await p.evaluate(() => Cutline.P.seq().clips.filter(c => c.kind === 'video').map(c => [c.name, c.start, c.dur, c.speed]));
  H.info('timeline: ' + JSON.stringify(layout));
  await H.key(p, 'Backslash');
  await p.evaluate(() => { Cutline.prefs.playbackRes = 'auto'; Cutline.savePrefs(); Cutline.Engine.seek(0); });
  await p.waitForTimeout(800);
  await H.key(p, 'Space');
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    await p.waitForTimeout(1000);
    const smp = await p.evaluate(() => {
      const C = Cutline, E = C.Engine, s = C.P.seq();
      const f = E.currentFrame(), clip = s.clips.find(c => c.kind === 'video' && f >= c.start && f < c.start + c.dur);
      if (!clip) return { playing: E.playing, noClip: true, f: f };
      const e = E.provider.elementOf(clip.id);
      const want = C.P.sourceSec(s, clip, f);
      return { playing: E.playing, f: Math.round(f), clip: clip.name, speed: clip.speed, want: want, el: e ? e.el.currentTime : null, rate: e ? e.el.playbackRate : null, paused: e ? e.el.paused : null, dyn: E.dynDrop, out: E.outputSize(), audioClock: E.audioClock };
    });
    samples.push(smp);
    if (!smp.playing) break;
  }
  await H.key(p, 'Space');
  const valid = samples.filter(s => s.el != null);
  const drift = valid.map(s => ({ clip: s.clip, d: +(s.el - s.want).toFixed(3), rate: s.rate, speed: s.speed, f: s.f, dyn: s.dyn }));
  H.info('samples: ' + JSON.stringify(drift));
  H.ok(samples.length >= 30 && samples.every(s => s.playing && s.audioClock), 'played for 40 s on the audio clock (' + samples.length + ' samples)');
  const worst = Math.max(...drift.map(x => Math.abs(x.d)));
  H.ok(worst < 0.25, 'video elements stay within 250 ms of the engine\'s source time across 50% / 150% / 29.97 clips (worst ' + worst.toFixed(3) + ' s)');
  const byClip = {}; drift.forEach(x => { (byClip[x.clip] = byClip[x.clip] || []).push(Math.abs(x.d)); });
  Object.keys(byClip).forEach(k => H.info(k + ': mean |drift| ' + (byClip[k].reduce((a, b) => a + b, 0) / byClip[k].length).toFixed(3) + ' s over ' + byClip[k].length + ' samples'));
  const settled = drift.filter(x => x.f % 1000 > 0 && samples.find(s => s.f === x.f) && (x.f - (layout.find(l => l[0] === x.clip) || [0, 0])[1]) > 10);
  H.ok(settled.filter(x => x.speed === 0.5).every(x => Math.abs(x.rate - 0.5) < 0.2) && settled.filter(x => x.speed === 1.5).every(x => Math.abs(x.rate - 1.5) < 0.4), 'element playbackRate follows the clip speed (0.5 / 1.5) once a clip has started');
  const dropped = samples.some(s => s.dyn);
  H.info('adaptive resolution drop engaged under the software renderer: ' + dropped + ' (output sizes seen: ' + JSON.stringify(Array.from(new Set(samples.map(s => JSON.stringify(s.out))))) + ')');
  const afterStop = await p.evaluate(() => ({ dyn: Cutline.Engine.dynDrop, out: Cutline.Engine.outputSize() }));
  H.ok(!afterStop.dyn, 'resolution drop is lifted when playback stops (' + JSON.stringify(afterStop) + ')');
  await H.shot(p, 'playback');
  // ---- scrub cancellation: 40 rapid seeks, the last one must win and no stale frame may be shown
  const codeAt = async (f) => p.evaluate((f) => { Cutline.Engine.seek(f); }, f);
  for (let i = 0; i < 40; i++) await codeAt(10 + i * 7);
  await p.waitForTimeout(1500);
  const final = await p.evaluate(() => { const E = Cutline.Engine, s = Cutline.P.seq(); const clip = s.clips.find(c => c.kind === 'video' && E.frame >= c.start && E.frame < c.start + c.dur); const e = clip && E.provider.elementOf(clip.id); return { frame: E.frame, want: clip && Cutline.P.sourceSec(s, clip, E.frame), el: e && e.el.currentTime, seeking: e && e.el.seeking, pend: E.pendSince }; });
  H.info('after 40 rapid seeks: ' + JSON.stringify(final));
  H.ok(final.frame === 10 + 39 * 7 && Math.abs(final.el - final.want) < 0.05 && !final.seeking, 'rapid seeks settle on the last target frame');
  // ---- JKL shuttle: L L -> 2x, J -> reverse 1x, K stops
  await p.mouse.click(await H.tlX(p, 5), await H.tlRowY(p, 'V3'));
  await H.key(p, 'Home');
  await H.key(p, 'l'); await p.waitForTimeout(300); await H.key(p, 'l'); await p.waitForTimeout(1500);
  const sh = await p.evaluate(() => ({ rate: Cutline.Engine.rate, f: Math.round(Cutline.Engine.currentFrame()) }));
  H.ok(sh.rate === 2 && sh.f > 50, 'L L shuttles at 2x (' + JSON.stringify(sh) + ')');
  await H.key(p, 'j'); await p.waitForTimeout(1000);
  const sj = await p.evaluate(() => ({ rate: Cutline.Engine.rate, f: Math.round(Cutline.Engine.currentFrame()) }));
  await H.key(p, 'k');
  const sk = await p.evaluate(() => ({ playing: Cutline.Engine.playing, f: Cutline.Engine.frame }));
  H.ok(sj.rate === -1 && sj.f < sh.f && !sk.playing, 'J reverses, K stops (' + JSON.stringify(sj) + ' -> ' + JSON.stringify(sk) + ')');
  await H.finish(b, errs, 'y4_playback');
})();
