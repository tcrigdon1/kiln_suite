// Pass 3 — Noise Reduction worklet in the live mixer and offline export mix, Voice Polish preset, pop-out Program Monitor
const L = require('../pass2/plib.js');
const { ok, info } = L;
const path = require('path');
(async () => {
  const { b, p, errs, ctx } = await L.launch();
  await L.boot(p); await L.newProjectUI(p, { name: 'AUD' });
  const media = path.join(__dirname, 'media', 'talkcuts.webm');
  const before = await p.evaluate(() => Cutline.state.project.media.length);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('.bin-toolbar .icon-btn[data-tip^="Import media"]')]);
  await fc.setFiles([media]); await L.waitReady(p, before + 1);
  await p.evaluate(() => { const C = Cutline, m = C.state.project.media[0]; C.edit('place', (s2) => { C.T.placeMedia(s2, m, 0, s2.tracks.filter(t => t.kind === 'video')[0].id, s2.tracks.filter(t => t.kind === 'audio')[0].id, 'overwrite'); }); const s = C.P.seq(); C.state.selection = s.clips.filter(c => c.kind === 'audio').map(c => c.id); C.bus.emit('selection'); });
  // --- effect registered, worklet source registers the processor ---
  const reg = await p.evaluate(() => ({ fx: !!Cutline.FX.byId.a_denoise, src: /cutline-denoise/.test(Cutline.FX.GATE_SRC), cmdVP: !!Cutline.CMD.byId.voicePolish, cmdPop: !!Cutline.CMD.byId.popOutProgram }));
  ok(reg.fx && reg.src && reg.cmdVP && reg.cmdPop, 'Noise Reduction effect + Voice Polish + Pop Out commands registered');
  // --- offline render: noisy clip through the denoiser must come out quieter in the pauses ---
  const r = await p.evaluate(async () => {
    const C = Cutline, s = C.P.seq(), a = s.clips.filter(c => c.kind === 'audio')[0];
    // synthesize a noisy buffer and run it through the effect chain inside an OfflineAudioContext (same path the exporter uses)
    const sr = 48000, dur = 3, ctx = new OfflineAudioContext(2, sr * dur, sr);
    await C.FX.loadWorklets(ctx);
    const buf = ctx.createBuffer(2, sr * dur, sr); let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = (t > 1 && t < 2 ? 0.4 * Math.sin(2 * Math.PI * 330 * t) : 0) + 0.02 * rnd(); } }
    const src = ctx.createBufferSource(); src.buffer = buf;
    const def = C.FX.byId.a_denoise, node = def.build(ctx, { amount: 18, sens: 50, smooth: 50 });
    src.connect(node.input); node.output.connect(ctx.destination); src.start(0);
    const out = await ctx.startRendering();
    const pw = (d, s0, s1) => { let x = 0; for (let i = s0; i < s1; i++) x += d[i] * d[i]; return 10 * Math.log10(x / (s1 - s0)); };
    const i = buf.getChannelData(0), o = out.getChannelData(0);
    return { worklet: !!ctx.__gateReady, noiseIn: pw(i, sr * 0.6, sr * 0.95), noiseOut: pw(o, sr * 0.6, sr * 0.95), toneIn: pw(i, sr * 1.4, sr * 1.9), toneOut: pw(o, sr * 1.4, sr * 1.9) };
  });
  info(JSON.stringify(r));
  ok(r.worklet, 'worklet module loaded in an OfflineAudioContext');
  ok(r.noiseOut < r.noiseIn - 8, 'noise floor dropped by ' + (r.noiseIn - r.noiseOut).toFixed(1) + ' dB');
  ok(Math.abs(r.toneOut - r.toneIn) < 1, 'tone level preserved (' + (r.toneOut - r.toneIn).toFixed(2) + ' dB)');
  // --- Voice Polish via the Clip menu ---
  await L.menu(p, 'Clip', 'Voice Polish');
  const vp = await p.evaluate(() => { const c = Cutline.P.selectedClips()[0]; return c.fx.map(f => f.type); });
  info(JSON.stringify(vp));
  ok(vp.join(',') === 'a_hpf,a_denoise,a_deess,a_comp,a_eq,a_limit', 'six-effect dialogue chain added in order');
  await L.menu(p, 'Clip', 'Voice Polish');
  const vp2 = await p.evaluate(() => Cutline.P.selectedClips()[0].fx.length);
  ok(vp2 === 6, 'applying again replaces the chain instead of stacking (' + vp2 + ')');
  // the export mixer must know the chain needs worklets
  const needs = await p.evaluate(() => { const s = Cutline.P.seq(); return s.clips.some(c => (c.fx || []).some(f => f.type === 'a_denoise')); });
  ok(needs, 'sequence carries a denoise effect for the export mixer');
  // --- pop-out monitor ---
  const popP = ctx.waitForEvent('page');
  await L.menu(p, 'View', 'Pop Out Program Monitor');
  const pop = await popP; await pop.waitForLoadState(); await pop.waitForTimeout(600);
  const pv = await pop.evaluate(() => { const v = document.getElementById('v'); return { has: !!v, playing: !!(v && v.srcObject && v.srcObject.getVideoTracks().length), w: v && v.videoWidth }; });
  info(JSON.stringify(pv));
  ok(pv.has && pv.playing, 'pop-out window shows a live video of the program canvas');
  await pop.close();
  await L.finish(b, errs, 'y4_audio_popout');
})();
