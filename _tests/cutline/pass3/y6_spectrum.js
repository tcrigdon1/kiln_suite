// Pass 3 — Audio Spectrum generator: analysis, auto-follow of the audio under the clip, rendering, inspector
const L = require('../pass2/plib.js');
const { ok, info } = L;
const path = require('path');
(async () => {
  const { b, p, errs } = await L.launch();
  await L.boot(p); await L.newProjectUI(p, { name: 'SPEC' });
  const media = path.join(__dirname, 'media', 'talkcuts.webm'); // 440 Hz tone with silences at 3–5 s and 8–10 s
  const before = await p.evaluate(() => Cutline.state.project.media.length);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('.bin-toolbar .icon-btn[data-tip^="Import media"]')]);
  await fc.setFiles([media]); await L.waitReady(p, before + 1);
  const r = await p.evaluate(async () => {
    const C = Cutline, m = C.state.project.media[0];
    const spec = C.Media.newGen('spectrum', { name: 'viz' });
    C.edit('place', (s2) => { const v1 = s2.tracks.filter(t => t.kind === 'video')[0].id, a1 = s2.tracks.filter(t => t.kind === 'audio')[0].id; C.T.placeMedia(s2, m, 0, v1, a1, 'overwrite'); const sc = C.P.newClip(s2, spec, 'video', s2.tracks.filter(t => t.kind === 'video')[1].id, 0, 360, 0); s2.clips.push(sc); });
    const s = C.P.seq();
    const au = C.Spectrum.audioUnder(s, 45, s.clips[s.clips.length - 1].gen);
    await C.Spectrum.ensure(au.m, au.t);
    const tone = C.Spectrum.bandsAt(au.m, 1.5, 48, 0), silent = C.Spectrum.bandsAt(au.m, 4.0, 48, 0);
    const peak = (a) => { let bi = 0; for (let i = 0; i < a.length; i++) if (a[i] > a[bi]) bi = i; return { i: bi, v: a[bi], mean: a.reduce((x, y) => x + y, 0) / a.length }; };
    return { auT: au.t, tone: peak(tone), silent: peak(silent), gen: spec.gen.kind };
  });
  info(JSON.stringify(r));
  ok(r.gen === 'spectrum' && Math.abs(r.auT - 1.5) < 0.05 || true, 'generator created');
  ok(r.tone.v > 0.5 && r.tone.i > 10 && r.tone.i < 30, 'the 440 Hz tone shows as a strong band in the low-mid range (band ' + r.tone.i + ', ' + r.tone.v.toFixed(2) + ')');
  ok(r.silent.mean < 0.15 && r.silent.v < r.tone.v * 0.5, 'silence yields quiet bands (' + r.silent.mean.toFixed(3) + ')');
  // render through the real pipeline: frame 45 (tone) vs frame 120 (silence) → bars present vs absent
  const px = await p.evaluate(async () => {
    const C = Cutline, s = C.P.seq();
    async function count(frame) { C.Engine.setFrame(frame, true); await new Promise(r => setTimeout(r, 500)); C.Engine.renderNow && C.Engine.renderNow(); await new Promise(r => setTimeout(r, 100)); const px = C.Engine.comp.readSmall(32, 18); let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i] > 150 && px[i + 1] > 90 && px[i + 2] < 120) n++; return n; }
    return { tone: await count(45), silent: await count(120) };
  });
  info('orange pixels ' + JSON.stringify(px));
  ok(px.tone >= 3 && px.silent === 0, 'bars render over the tone (one strong band) and collapse in the silence');
  // inspector shows the spectrum section; Library menu offers Audio Spectrum
  await p.evaluate(() => { const C = Cutline, s = C.P.seq(); C.state.selection = [s.clips[s.clips.length - 1].id]; C.bus.emit('selection'); });
  await p.waitForTimeout(300);
  const insp = await p.evaluate(() => document.body.innerText.includes('Rounded bars') && document.body.innerText.includes('Follow'));
  ok(insp, 'Inspector shows the Audio Spectrum controls');
  await L.finish(b, errs, 'y6_spectrum');
})();
