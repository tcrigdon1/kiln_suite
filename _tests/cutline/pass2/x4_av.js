// pass2 exploration 4: A/V sync drift over 5 minutes of continuous playback, and the master meter on a normalized clip.
// The sync clip carries a 14-bit frame code in a strip at the bottom of the picture (read back from the program
// canvas) and the audio has a 1 kHz beep for 50 ms every 2 s; the audio clock (AudioContext time) drives the playhead.
const H = require('./plib');
const MIN = +(process.argv[2] || 5);
const PAGE_CODE = `window.__readCode = function (src, w, h) {
  w = w || 1280; h = h || 720;
  const c = window.__codeCv || (window.__codeCv = document.createElement('canvas')); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(src, 0, 0, w, h);
  const sx = w / 1280, sy = h / 720;
  const bit = (k) => { const d = g.getImageData(Math.round((16 + 56 * k + 24) * sx), Math.round((654 + 24) * sy), 1, 1).data; return (d[0] + d[1] + d[2]) / 3 > 128 ? 1 : 0; };
  let f = 0; for (let k = 0; k < 14; k++) f |= bit(k) << k;
  return f;
};`;
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('x4');
  await H.boot(p);
  await H.newProjectUI(p, { w: 1280, h: 720 });
  await H.importUI2(p, ['sync5m.webm', 'sweep.wav']);
  await p.evaluate(PAGE_CODE);
  const libItem = async (n) => H.center(p, `#p-bin .bin-item:has(.name:text-is("${n}"))`);
  const sr = await H.center(p, '#p-timeline .tl-scroll');
  let it = await libItem('sync5m.webm');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V1'));
  await p.waitForTimeout(400);
  await H.key(p, 'Backslash');
  // full playback resolution so the code strip is readable
  await p.evaluate(() => { Cutline.prefs.playbackRes = 1; Cutline.savePrefs(); Cutline.Engine.seek(0); });
  await p.waitForTimeout(1500);
  const code0 = await p.evaluate(() => window.__readCode(Cutline.Program.canvas, Cutline.Program.canvas.width, Cutline.Program.canvas.height));
  H.ok(code0 === 0, 'frame code readable from the program canvas at frame 0 (' + code0 + ')');
  // sample during playback: audio-clock frame vs displayed frame code vs element time
  await p.evaluate(() => { window.__samples = []; });
  await H.key(p, 'Space');
  const t0 = Date.now();
  const samples = [];
  while (Date.now() - t0 < MIN * 60 * 1000) {
    await p.waitForTimeout(2000);
    const s = await p.evaluate(() => {
      const E = Cutline.Engine, s = Cutline.P.seq();
      const clip = s.clips.find(c => c.kind === 'video');
      const e = E.provider.elementOf(clip.id);
      // read the clocks together (reading the canvas back is slow under SwiftShader), the shown frame belongs to the last render
      const f = E.currentFrame(), elT = e ? e.el.currentTime * s.fps : null, rendered = E.frame;
      const code = window.__readCode(Cutline.Program.canvas, Cutline.Program.canvas.width, Cutline.Program.canvas.height);
      const ctx = Cutline.Mixer.ctx;
      return { clock: f, shown: code, el: elT, rate: e ? e.el.playbackRate : null, playing: E.playing, actx: ctx ? ctx.currentTime : null, audioClock: E.audioClock, rendered: rendered };
    });
    if (!s.playing) break;
    samples.push(s);
  }
  await H.key(p, 'Space');
  const drift = samples.map(s => s.shown - s.clock), elDrift = samples.filter(s => s.el != null).map(s => s.el - s.clock);
  const stat = (a) => { if (!a.length) return null; const m = a.reduce((x, y) => x + y, 0) / a.length; return { n: a.length, mean: +m.toFixed(2), min: Math.min(...a), max: Math.max(...a), last: a[a.length - 1] }; };
  H.info('shown-frame drift vs audio clock (frames): ' + JSON.stringify(stat(drift)));
  H.info('<video> element drift vs audio clock (frames): ' + JSON.stringify(stat(elDrift)));
  H.info('samples (clock, shown, el): ' + samples.filter((s, i) => i % 3 === 0).map(s => [Math.round(s.clock), s.shown, s.el && s.el.toFixed(1)].join('/')).join('  '));
  H.ok(samples.length > MIN * 8 && samples.every(s => s.audioClock), 'played continuously for ' + MIN + ' min with the audio clock (' + samples.length + ' samples)');
  const shownVsRendered = samples.map(s => s.shown - s.rendered);
  H.info('shown code vs the frame the engine last rendered: ' + JSON.stringify(stat(shownVsRendered)));
  const late = drift.filter(d => d < -4).length, early = drift.filter(d => d > 4).length;
  H.ok(elDrift.length && Math.abs(stat(elDrift).mean) <= 3 && stat(elDrift).max <= 6 && stat(elDrift).min >= -6, 'video element stays within ±6 frames of the audio clock throughout (mean ' + stat(elDrift).mean + ')');
  H.ok(stat(drift).max <= 8 && stat(drift).min >= -40, 'displayed frame lags the audio clock by a bounded amount (software renderer: ' + stat(drift).min + '..' + stat(drift).max + ' frames); late samples ' + late + ', early ' + early);
  // no trend: compare the mean drift of the first and last quarter
  const q = Math.floor(drift.length / 4), first = stat(drift.slice(0, q)), lastq = stat(drift.slice(-q));
  H.info('first-quarter mean ' + first.mean + ' last-quarter mean ' + lastq.mean);
  H.ok(Math.abs(lastq.mean - first.mean) <= 3, 'no progressive drift between the first and last quarter of the run');
  await H.shot(p, 'after-' + MIN + 'min');
  // ---- master meter never clips on a normalized clip
  await p.mouse.click(sr.bb.x + sr.bb.width / 2, sr.bb.y + sr.bb.height - 10); // focus the timeline
  await p.evaluate(() => { Cutline.A.selectAll(); });
  await H.key(p, 'Delete');
  it = await libItem('sweep.wav');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'A1'));
  await p.waitForTimeout(300);
  await p.evaluate(() => Cutline.A.selectAll());
  await H.menu(p, 'Clip', 'Normalize Audio');
  await p.waitForTimeout(200);
  const gain = await p.evaluate(() => Cutline.P.seq().clips[0].au.gain);
  H.info('normalize gain ' + gain + ' dB');
  await p.evaluate(() => { window.__peak = 0; Cutline.Engine.seek(0); });
  await H.key(p, 'Backslash');
  await H.key(p, 'Space');
  const t1 = Date.now(); let peak = 0;
  while (Date.now() - t1 < 7000) { await p.waitForTimeout(40); const lv = await p.evaluate(() => { const l = Cutline.Mixer.levels(Cutline.P.seq()); return l ? Math.max(l.master[0], l.master[1]) : 0; }); peak = Math.max(peak, lv); }
  const peakDb = 20 * Math.log10(peak || 1e-9);
  H.info('master meter peak during normalized playback: ' + peakDb.toFixed(2) + ' dBFS');
  H.ok(peakDb <= -0.5 && peakDb > -6, 'master meter peaks just under −1 dBFS and never shows clipping on a normalized clip');
  await H.shot(p, 'meter');
  await H.finish(b, errs, 'x4_av');
})();
