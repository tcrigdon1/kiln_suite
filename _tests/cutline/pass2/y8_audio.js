// pass2 y8: audio additions — loudness normalise / match (LUFS), beat & transient markers, de-esser, limiter effect,
// master limiter (playback graph + offline render), draggable EQ graph, Source monitor waveform for video.
const { ROOT } = require('../../env.js');
const H = require('./plib');
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('y8');
  await H.boot(p, '?test=1');
  await H.importUI2(p, ['noise.wav', 'quiet.wav', 'clicks.wav', ROOT + '/_tests/cutline/handson/media/clip25.webm']);
  await p.evaluate(() => {
    const C = Cutline, P = C.P, T = C.T;
    C.edit('setup', (s, prj) => {
      const a1 = P.atracks(s)[0].id, a2 = P.atracks(s)[1].id, a3 = P.atracks(s)[2].id;
      const noise = prj.media.find(m => m.name === 'noise.wav'), quiet = prj.media.find(m => m.name === 'quiet.wav'), clicks = prj.media.find(m => m.name === 'clicks.wav');
      T.placeMedia(s, noise, 0, null, a1, 'overwrite', 0, 6);
      T.placeMedia(s, quiet, 0, null, a2, 'overwrite', 0, 6);
      T.placeMedia(s, clicks, 0, null, a3, 'overwrite', 0, 8);
    });
  });
  await p.waitForTimeout(400);
  const names = await p.evaluate(() => Cutline.P.seq().clips.map(c => c.name));
  H.info('clips: ' + names);
  // in-page LUFS of an offline render of one track (others muted)
  async function lufsOf(trackIdx, t0, t1) {
    return p.evaluate(async ([ti, a, b2]) => {
      const C = Cutline, P = C.P, s = P.seq();
      const was = P.atracks(s).map(t => t.mute);
      P.atracks(s).forEach((t, i) => { t.mute = i !== ti; });
      const buf = await C.Mixer.renderOffline(s, a, b2, 48000);
      P.atracks(s).forEach((t, i) => { t.mute = was[i]; });
      let pk = 0; const L = buf.getChannelData(0), R = buf.getChannelData(1); for (let i = 0; i < L.length; i++) { pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
      return { lufs: C.Loudness.integratedLUFS([L, R], 48000), peakDb: 20 * Math.log10(pk || 1e-9) };
    }, [trackIdx, t0, t1]);
  }
  const before = await lufsOf(0, 0, 4), beforeQ = await lufsOf(1, 0, 4);
  H.info('before: noise ' + JSON.stringify(before) + ' quiet ' + JSON.stringify(beforeQ));

  /* ---------- Normalise Loudness to -14 LUFS via the Clip menu ---------- */
  await p.evaluate(() => { const C = Cutline, s = C.P.seq(); C.A.select(s.clips.filter(c => /noise|quiet/.test(c.name)).map(c => c.id)); });
  await H.menu(p, 'Clip', 'Normalise Loudness');
  await p.waitForSelector('.dialog:has-text("Normalise Loudness")');
  await H.shot(p, 'loudness-dialog');
  await p.selectOption('.dialog select', '-14');
  await p.click('.dialog-foot .btn.primary');
  await p.waitForTimeout(300);
  const gains = await p.evaluate(() => Cutline.P.seq().clips.filter(c => /noise|quiet/.test(c.name)).map(c => [c.name, c.au.gain]));
  const afterN = await lufsOf(0, 0, 4), afterQ = await lufsOf(1, 0, 4);
  H.info('gains ' + JSON.stringify(gains) + ' after: noise ' + JSON.stringify(afterN) + ' quiet ' + JSON.stringify(afterQ));
  H.ok(Math.abs(afterN.lufs + 14) < 1 && Math.abs(afterQ.lufs + 14) < 1, 'both clips render at −14 LUFS ± 1 after Normalise Loudness (' + afterN.lufs.toFixed(1) + ', ' + afterQ.lufs.toFixed(1) + ')');
  H.ok(await p.evaluate(() => Cutline.H.undo[Cutline.H.undo.length - 1].label === 'Normalise Loudness'), 'loudness normalise is one undo step');
  // match: set the quiet clip to -20 LUFS then match the noise clip to it
  await p.evaluate(() => { const C = Cutline, s = C.P.seq(); C.edit('set', s2 => { const q = s2.clips.find(c => /quiet/.test(c.name)); q.au.gain -= 6; }); C.A.select([s.clips.find(c => /quiet/.test(c.name)).id, s.clips.find(c => /noise/.test(c.name)).id]); C.state.primaryId = null; });
  await H.menu(p, 'Clip', 'Normalise Loudness');
  await p.selectOption('.dialog select', 'match');
  await p.waitForTimeout(100);
  await p.click('.dialog-foot .btn.primary');
  await p.waitForTimeout(300);
  const m1 = await lufsOf(0, 0, 4), m2 = await lufsOf(1, 0, 4);
  H.info('after match: noise ' + m1.lufs.toFixed(2) + ' quiet ' + m2.lufs.toFixed(2));
  H.ok(Math.abs(m1.lufs - m2.lufs) < 1 && Math.abs(m2.lufs + 20) < 1.2, 'Match loudness brings the clips to the same level (reference ≈ −20 LUFS)');

  /* ---------- Beat / transient markers ---------- */
  await p.evaluate(() => { const C = Cutline, s = C.P.seq(); C.A.select([s.clips.find(c => /clicks/.test(c.name)).id]); });
  await H.menu(p, 'Markers', 'Beat / Transient Markers');
  await p.waitForSelector('.dialog:has-text("Transient")');
  const tempoTxt = await p.locator('.dialog .muted').last().textContent();
  H.info('analysis: ' + tempoTxt);
  H.ok(/tempo ≈ 120/.test(tempoTxt), 'detects the 120 BPM click track (' + tempoTxt.trim() + ')');
  await H.shot(p, 'transients-dialog');
  await p.selectOption('.dialog select >> nth=0', 'beats');
  await p.click('.dialog-foot .btn.primary');
  await p.waitForTimeout(300);
  const mk = await p.evaluate(() => { const s = Cutline.P.seq(); const f = s.markers.map(m => m.f); const d = []; for (let i = 1; i < f.length; i++) d.push(f[i] - f[i - 1]); return { n: f.length, first: f[0], spacing: d.slice(0, 5), allHalf: d.every(x => x === 15) }; });
  H.info('markers: ' + JSON.stringify(mk));
  H.ok(mk.n >= 15 && mk.allHalf && mk.first <= 1, 'beat grid markers every 15 frames (0.5 s) from the first click');
  await H.shot(p, 'beat-markers');

  /* ---------- De-esser, limiter effect ---------- */
  const fxRes = await p.evaluate(async () => {
    const C = Cutline, P = C.P, s = P.seq(), FX = C.FX;
    const noise = s.clips.find(c => /noise/.test(c.name));
    function hfRatio(buf) { // energy above ~6 kHz vs total, via a crude one-pole high-pass
      const d = buf.getChannelData(0); let hf = 0, tot = 0, prev = 0, y = 0; const a = Math.exp(-2 * Math.PI * 6000 / 48000);
      for (let i = 0; i < d.length; i++) { y = a * (y + d[i] - prev); prev = d[i]; hf += y * y; tot += d[i] * d[i]; } return hf / tot;
    }
    async function render(ti) { const was = P.atracks(s).map(t => t.mute); P.atracks(s).forEach((t, i) => { t.mute = i !== ti; }); const buf = await C.Mixer.renderOffline(s, 0, 2, 48000); P.atracks(s).forEach((t, i) => { t.mute = was[i]; }); return buf; }
    function peakDb(buf) { let pk = 0; [0, 1].forEach(ch => { const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i])); }); return 20 * Math.log10(pk || 1e-9); }
    const plain = await render(0), r0 = hfRatio(plain);
    C.edit('deess', s2 => { const c = P.clip(s2, noise.id); c.au.gain = 0; const e = FX.newInstance('a_deess'); e.p.amt = 100; e.p.th = -40; c.fx.push(e); });
    const de = await render(0), r1 = hfRatio(de);
    // limiter: boost the noise by 18 dB, limit at -3 dB
    C.edit('limit', s2 => { const c = P.clip(s2, noise.id); c.fx = []; c.au.gain = 18; });
    const hot = await render(0), pkHot = peakDb(hot);
    C.edit('limit2', s2 => { const c = P.clip(s2, noise.id); const e = FX.newInstance('a_limit'); e.p.ceil = -3; c.fx.push(e); });
    const lim = await render(0), pkLim = peakDb(lim);
    // master limiter at -6 dB with the limiter effect removed
    C.edit('master', s2 => { const c = P.clip(s2, noise.id); c.fx = []; s2.masterLimit = { on: true, ceil: -6, rel: 120 }; });
    const ml = await render(0), pkMaster = peakDb(ml);
    C.edit('master off', s2 => { s2.masterLimit = { on: false, ceil: -6, rel: 120 }; const c = P.clip(s2, noise.id); c.au.gain = 0; });
    return { r0, r1, pkHot, pkLim, pkMaster, worklet: !!C.Mixer.ctx && !!C.Mixer.ctx.__gateReady };
  });
  H.info('fx: ' + JSON.stringify(fxRes));
  H.ok(fxRes.r1 < fxRes.r0 * 0.7, 'de-esser cuts the energy above 6 kHz of white noise (' + fxRes.r0.toFixed(3) + ' → ' + fxRes.r1.toFixed(3) + ')');
  H.ok(fxRes.pkHot > -0.5 && fxRes.pkLim <= -2.7 && fxRes.pkLim > -6, 'Limiter effect holds an +18 dB signal at the −3 dB ceiling (' + fxRes.pkHot.toFixed(1) + ' → ' + fxRes.pkLim.toFixed(1) + ' dBFS)');
  H.ok(fxRes.pkMaster <= -5.7 && fxRes.pkMaster > -9, 'master limiter in the offline mix holds the peak at −6 dB (' + fxRes.pkMaster.toFixed(1) + ' dBFS)');
  // master limiter controls in the Audio panel + realtime graph
  await p.click('.tab-btn:has-text("Audio"), .tabs .tab:has-text("Audio")').catch(() => {});
  await p.evaluate(() => Cutline.ui.showTab('audio'));
  await p.waitForTimeout(300);
  const limRow = await p.locator('.strip.master .lim-row input[type=checkbox]').count();
  H.ok(limRow === 1, 'Audio panel master strip has the Limit toggle');
  await p.locator('.strip.master .lim-row input[type=checkbox]').click();
  await p.waitForTimeout(200);
  const rt = await p.evaluate(() => { const C = Cutline; C.Mixer.ensure(); C.Mixer.updateTracks(C.P.seq()); return { on: C.P.seq().masterLimit.on, node: !!C.Mixer.limNode, undo: C.H.undo[C.H.undo.length - 1].label }; });
  H.ok(rt.on && rt.undo === 'Master Limiter', 'Limit toggle sets the sequence master limiter (undoable)');
  await H.shot(p, 'audio-panel-limiter');

  /* ---------- EQ graph ---------- */
  await p.evaluate(() => { const C = Cutline, s = C.P.seq(); const n = s.clips.find(c => /noise/.test(c.name)); C.edit('eq', s2 => { C.P.clip(s2, n.id).fx.push(C.FX.newInstance('a_eq')); }); C.A.select([n.id]); C.ui.showTab('inspector'); });
  await p.waitForTimeout(400);
  const eq = await p.locator('.eq-graph').first();
  H.ok(await eq.count() === 1, 'Inspector shows the EQ response graph');
  const bb = await eq.boundingBox();
  // mid point sits at 1200 Hz, 0 dB: x = log(1200/20)/log(1000) * w, y = h/2
  const mx = bb.x + Math.log(1200 / 20) / Math.log(1000) * bb.width, my = bb.y + bb.height / 2;
  await H.drag(p, mx, my, mx + 30, my - 30, { steps: 12 });
  await p.waitForTimeout(200);
  const eqp = await p.evaluate(() => { const s = Cutline.P.seq(); const c = s.clips.find(c => /noise/.test(c.name)); return c.fx.find(f => f.type === 'a_eq').p; });
  H.info('eq params after drag: ' + JSON.stringify(eqp));
  H.ok(eqp.mid > 4 && eqp.mid < 20 && eqp.midf > 1300 && eqp.midf < 3000, 'dragging the mid point raises its gain and moves its frequency');
  const resp = await p.evaluate((pp) => [Cutline.EQGraph.response(pp, pp.midf), Cutline.EQGraph.response(pp, 60)], eqp);
  H.ok(Math.abs(resp[0] - eqp.mid) < 1.5 && Math.abs(resp[1]) < 1, 'drawn response peaks at the mid gain and is flat elsewhere (' + resp.map(v => v.toFixed(1)) + ')');
  await H.shot(p, 'eq-graph');

  /* ---------- Source monitor waveform for a video with audio ---------- */
  await p.dblclick('.bin-item:has-text("clip25")');
  await p.waitForTimeout(800);
  const wave = await p.evaluate(() => ({ cls: document.querySelector('.src-bar') && document.querySelector('#p-source .mon-scrub').className, h: document.querySelector('#p-source .mon-scrub').getBoundingClientRect().height }));
  H.info('source scrub: ' + JSON.stringify(wave));
  H.ok(/with-wave/.test(wave.cls) && wave.h > 40, 'Source monitor shows the audio waveform strip for a video clip with audio');
  await H.shot(p, 'source-waveform');
  await H.finish(b, errs, 'y8_audio');
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
