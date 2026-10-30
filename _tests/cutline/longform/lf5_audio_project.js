// Long-form #5 — streamed audio keeps every mixer feature working (volume, fades, pan, keyframes, mute/solo, effects,
// pitch-preserving speed on only the used range, reverse, block mixing == single pass, live meters), plus subclips and
// source markers surviving save/load + relink, and a cue-less live-style WebM imported through the UI.
const L = require('./lflib');
const SEG = 150.008;
(async () => {
  const { b, p, errs } = await L.launch();
  await L.boot(p); await L.newProjectUI(p, { w: 1280, h: 720, fps: 30 });
  await L.importUI(p, ['vod10h.webm']);
  await p.waitForFunction(() => { const C = Cutline; return C.state.project.media.length === 1 && C.MRT[C.state.project.media[0].id].status === 'ready'; }, null, { timeout: 60000 });
  const a0 = 3 * SEG + 30; // source window: burst (330 Hz, 1.5 s) about 7 s into the clip; sustained 220 Hz burst far outside
  const on0 = L.ffVideoTimeOfCode(L.MEDIA + 'vod10h.webm', 3 * SEG + 37, 2220) - a0; // the burst is generated at the instant of video frame 2220
  const r = await p.evaluate(async ([a0]) => {
    const C = Cutline, m = C.state.project.media[0], out = {};
    function setup(mod) {
      C.H.reset('x'); const s = C.P.seq(); s.clips = []; s.tracks.forEach(t => { t.mute = false; t.solo = false; });
      const made = C.T.placeMedia(s, m, 0, null, C.P.atracks(s)[0].id, 'overwrite', a0, a0 + 20);
      if (mod) mod(made[0], s);
      return s;
    }
    const rms = (d, a, b, sr) => { let s = 0, n = 0; for (let i = Math.round(a * sr); i < Math.round(b * sr); i++) { s += d[i] * d[i]; n++; } return Math.sqrt(s / Math.max(1, n)); };
    const onset = (d, sr, from) => { for (let i = Math.round(from * sr); i < d.length; i++) if (Math.abs(d[i]) > 0.2) return i / sr; return -1; };
    // cycles counted with hysteresis (the bursts carry noise, plain zero crossings would count it)
    const freq = (d, sr, a, b) => { let z = 0, st = 0; for (let i = Math.round(a * sr); i < Math.round(b * sr); i++) { if (st <= 0 && d[i] > 0.25) { if (st < 0) z++; st = 1; } else if (st >= 0 && d[i] < -0.25) st = -1; } return z / (b - a); };
    const render = async (s, len) => { const buf = await C.Mixer.renderOffline(s, 0, len || 20, 48000); return [buf.getChannelData(0), buf.getChannelData(1)]; };
    let s = setup(), [L0, R0] = await render(s);
    out.base = { onset: onset(L0, 48000, 5), burst: rms(L0, 7.3, 8.2, 48000), quiet: rms(L0, 2, 5, 48000), f: freq(L0, 48000, 7.3, 8.3), streamed: C.Media.isStreamed(m), hasBuffer: !!C.MRT[m.id].buffer };
    s = setup(c => { c.au.vol = -6; }); let [L1] = await render(s); out.vol = rms(L1, 7.3, 8.2, 48000) / out.base.burst;
    s = setup(c => { c.fadeIn = 90; }); let [L2] = await render(s); out.fade = [rms(L2, 0.5, 1, 48000), rms(L2, 2.4, 2.9, 48000), rms(L2, 4, 5, 48000)];
    s = setup(c => { c.au.pan = -100; }); let [L3, R3] = await render(s); out.pan = [rms(L3, 7.3, 8.2, 48000), rms(R3, 7.3, 8.2, 48000)];
    s = setup(c => { c.kf = { 'au.vol': [{ f: 0, v: 0, e: 'linear' }, { f: 599, v: -40, e: 'linear' }] }; }); let [L4] = await render(s); out.kf = [rms(L4, 1, 2, 48000), rms(L4, 10, 11, 48000), rms(L4, 18, 19, 48000)];
    s = setup((c, s2) => { C.P.track(s2, c.trackId).mute = true; }); let [L5] = await render(s); out.mute = rms(L5, 0, 20, 48000);
    s = setup((c, s2) => { C.P.atracks(s2)[1].solo = true; }); let [L6] = await render(s); out.solo = rms(L6, 0, 20, 48000);
    s = setup(c => { c.fx = [{ id: 'fx1', type: 'a_lpf', on: true, p: { f: 200, q: 0.7 } }]; }); let [L7] = await render(s); out.lpf = rms(L7, 7.3, 8.2, 48000) / out.base.burst;
    // pitch-preserving 2x: only the used range is decoded & stretched
    s = setup(c => { c.speed = 2; c.dur = 300; }); await C.Mixer.prepareStretch(m, s, s.clips[0]); let [L8] = await render(s, 10);
    out.speed = { onset: onset(L8, 48000, 2), f: freq(L8, 48000, 3.65, 4.1) };
    s = setup(c => { c.speed = 2; c.dur = 300; c.au.pitch = false; }); let [L9] = await render(s, 10); out.speedNoPitch = { onset: onset(L9, 48000, 2), f: freq(L9, 48000, 3.65, 4.1) };
    s = setup(c => { c.reverse = true; }); let [L10] = await render(s); out.reverse = onset(L10, 48000, 9);
    // long clip: block rendering (30 s blocks, 2 s pre-roll) vs single pass over a window across a block boundary
    s = setup(c => { c.dur = 30 * 60; }); // 60 s clip
    const one = await C.Mixer.renderOffline(s, 20, 60, 48000);
    const parts = []; await C.Mixer.renderBlocks(s, 20, 60, 48000, (Lb) => { parts.push(Lb.slice()); });
    const cat = new Float32Array(parts.reduce((n, x) => n + x.length, 0)); let o = 0; parts.forEach(x => { cat.set(x, o); o += x.length; });
    let maxd = 0; const od = one.getChannelData(0); for (let i = 0; i < od.length; i++) maxd = Math.max(maxd, Math.abs(od[i] - cat[i]));
    out.blocks = { n: parts.length, maxDiff: maxd, len: cat.length, expect: od.length };
    // live meters while playing over the burst
    s = setup(); C.Engine.setFrame(6.8 * 30); C.Engine.play(1); await new Promise(r => setTimeout(r, 1400));
    let pk = 0; for (let i = 0; i < 8; i++) { const lv = C.Mixer.levels(s); pk = Math.max(pk, lv ? lv.master[0] : 0); await new Promise(r => setTimeout(r, 60)); }
    C.Engine.pause(); out.meter = pk;
    out.stretchMax = C.Mixer.STRETCH_MAX;
    return out;
  }, [a0]);
  L.ok(r.base.streamed && !r.base.hasBuffer, 'long media audio is streamed (no whole-file AudioBuffer)');
  L.ok(Math.abs(r.base.onset - on0) < 0.002 && Math.abs(r.base.f - 330) < 5 && r.base.burst > 0.3 && r.base.quiet < 0.03, 'streamed decode: burst at ' + r.base.onset.toFixed(4) + ' s (its video frame: ' + on0.toFixed(4) + '), ' + r.base.f.toFixed(0) + ' Hz');
  L.ok(Math.abs(r.vol - 0.5) < 0.05, 'clip volume -6 dB applied (×' + r.vol.toFixed(3) + ')');
  L.ok(r.fade[0] < r.fade[1] && r.fade[1] < r.fade[2], 'fade-in ramps up (' + r.fade.map(x => x.toFixed(4)).join(' < ') + ')');
  L.ok(r.pan[1] < r.pan[0] * 0.02, 'pan hard left (L ' + r.pan[0].toFixed(3) + ', R ' + r.pan[1].toFixed(4) + ')');
  L.ok(r.kf[0] > r.kf[1] && r.kf[1] > r.kf[2] * 3, 'keyframed volume follows the curve (' + r.kf.map(x => x.toFixed(4)).join(' > ') + ')');
  L.ok(r.mute < 1e-5 && r.solo < 1e-5, 'track mute and solo-elsewhere silence the streamed clip');
  L.ok(r.lpf < 0.5, 'audio effect (200 Hz low-pass) processes the streamed clip (330 Hz burst ×' + r.lpf.toFixed(2) + ')');
  L.ok(Math.abs(r.speed.onset - on0 / 2) < 0.03 && Math.abs(r.speed.f - 330) < 12, '2x speed with pitch preserved (stretch of the used range only): burst at ' + r.speed.onset.toFixed(3) + ' s, ' + r.speed.f.toFixed(0) + ' Hz');
  L.ok(Math.abs(r.speedNoPitch.onset - on0 / 2) < 0.01 && Math.abs(r.speedNoPitch.f - 660) < 20, '2x speed without pitch lock: ' + r.speedNoPitch.f.toFixed(0) + ' Hz');
  L.ok(Math.abs(r.reverse - 11.5) < 0.03, 'reversed streamed clip: burst at ' + r.reverse.toFixed(3) + ' s (expected 11.5)');
  L.ok(r.blocks.n === 2 && r.blocks.len === r.blocks.expect && r.blocks.maxDiff < 1e-4, 'block mixing (30 s blocks across a boundary) equals the single-pass render (max diff ' + r.blocks.maxDiff.toExponential(1) + ')');
  L.ok(r.meter > 0.2, 'master meter shows the streamed audio during playback (peak ' + r.meter.toFixed(2) + ')');

  // ---- subclips + source markers survive save / load / relink
  const pr = await p.evaluate(async () => {
    const C = Cutline, m = C.state.project.media[0];
    C.Source.open(m.id, 1000); m.srcIn = 1000; m.srcOut = 1030; const sub = C.Source.makeSubclip('Keep me');
    C.Source.seek(1010); C.Source.addMarker();
    C.edit('seq', s => { C.T.placeMedia(s, sub, 0, C.P.vtracks(s)[0].id, C.P.atracks(s)[0].id, 'overwrite'); });
    const json = C.IO.serialize();
    C.IO.load(json, null, 'Reload');
    await new Promise(r => setTimeout(r, 500));
    C.ui.openDialogs.slice().forEach(d => d.close());
    const offline = C.Media.offlineMedia().map(x => x.name);
    return { json: json.length, offline, sub: C.state.project.media.filter(x => x.sub).map(x => ({ name: x.name, a: x.sub.in, b: x.sub.out, online: C.Media.isOnline(x) })), markers: (C.state.project.media.find(x => !x.sub).markers || []).length, clip: C.P.seq().clips[0] && C.P.seq().clips[0].in };
  });
  L.ok(pr.sub.length === 1 && pr.sub[0].name === 'Keep me' && pr.markers === 1 && pr.offline.length === 1 && pr.offline[0] === 'vod10h.webm', 'project JSON keeps the subclip (' + pr.sub[0].a + '→' + pr.sub[0].b + ') and the source marker; after load only the source file needs relinking');
  await p.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'relinkf'; document.body.appendChild(i); });
  await p.setInputFiles('#relinkf', [L.MEDIA + 'vod10h.webm']);
  const rl = await p.evaluate(async () => { const C = Cutline; const n = await C.Media.matchFiles(Array.from(document.getElementById('relinkf').files)); const sub = C.state.project.media.find(x => x.sub); return { n, subOnline: C.Media.isOnline(sub), clipIn: C.P.seq().clips[0].in, dur: C.P.seqDuration(C.P.seq()) }; });
  L.ok(rl.n === 1 && rl.subOnline && Math.abs(rl.clipIn - 1000) < 1e-6 && rl.dur === 900, 'relinking the source brings its subclip online (clip from the subclip starts at source 1000 s, 30 s long)');

  // ---- cue-less, duration-less live-style WebM through the UI
  await p.waitForTimeout(1500); // the offline check after a load may open the Relink dialog a moment later; it is moot once relinked
  await p.evaluate(() => Cutline.ui.openDialogs.slice().forEach(d => d.close()));
  const t0 = Date.now();
  await L.importUI(p, ['nocues1h.webm']);
  await p.waitForFunction(() => { const C = Cutline, m = C.state.project.media.find(x => x.name === 'nocues1h.webm'); return m && C.MRT[m.id] && C.MRT[m.id].status === 'ready'; }, null, { timeout: 120000 });
  const nc = await p.evaluate(() => { const C = Cutline, m = C.state.project.media.find(x => x.name === 'nocues1h.webm'); return { dur: m.duration, streamed: !!C.MRT[m.id].stream, ms: C.MRT[m.id].importMs }; });
  L.ok(Math.abs(nc.dur - 3600.2) < 2 && nc.streamed, 'cue-less live-style WebM (no Duration, unknown sizes) imports in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s with duration ' + nc.dur.toFixed(1) + ' s and streamed audio');
  await p.waitForFunction(() => { const C = Cutline, m = C.state.project.media.find(x => x.name === 'nocues1h.webm'); const pk = C.MRT[m.id].peaks; return pk && pk.done >= 1; }, null, { timeout: 300000, polling: 1000 });
  const ncp = await p.evaluate((SEG) => { const C = Cutline, m = C.state.project.media.find(x => x.name === 'nocues1h.webm'), pk = C.MRT[m.id].peaks; return [C.Media.peakSpan(pk, 20 * SEG + 37.2, 20 * SEG + 38.2).hi, C.Media.peakSpan(pk, 20 * SEG + 20, 20 * SEG + 21).hi]; }, SEG);
  L.ok(ncp[0] > 0.6 && ncp[1] < 0.1, 'its waveform pass completes and shows the bursts at the right times (' + ncp.map(x => x.toFixed(2)).join(' / ') + ')');
  const n = L.done(errs);
  await b.close();
  process.exit(n ? 1 : 0);
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
