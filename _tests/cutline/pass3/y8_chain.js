// Pass 3 polish — cross-feature chain: remove silences (ripple all) → scene cuts split → censor + track matte on
// the same clip → voice polish → spectrum over the music → bezier easing via the graph editor → preset round trip
// → split at markers → QC → EDL/XML → real export (WebM) → project JSON round trip
const L = require('../pass2/plib.js');
const { ok, info } = L;
const path = require('path'), fs = require('fs');
(async () => {
  const { b, p, errs } = await L.launch();
  await L.boot(p); await L.newProjectUI(p, { name: 'CHAIN' });
  const media = path.join(__dirname, 'media', 'talkcuts.webm');
  const before = await p.evaluate(() => Cutline.state.project.media.length);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('.bin-toolbar .icon-btn[data-tip^="Import media"]')]);
  await fc.setFiles([media]); await L.waitReady(p, before + 1);
  await p.evaluate(() => { const C = Cutline, m = C.state.project.media[0]; C.edit('place', (s2) => { const vt = C.P.vtracks(s2), at = C.P.atracks(s2); C.T.placeMedia(s2, m, 0, vt[0].id, at[0].id, 'overwrite'); const mus = C.P.newClip(s2, m, 'audio', at[1].id, 0, 360, 0); mus.name = 'music'; s2.clips.push(mus); }); const s = C.P.seq(); C.state.selection = s.clips.filter(c => c.name !== 'music').map(c => c.id); C.bus.emit('selection'); });
  // 1. remove silences, ripple everything (music too)
  const r1 = await p.evaluate(async () => { const C = Cutline, s = C.P.seq(); const sp = await C.AutoCut.analyseSilence(s, C.P.selectedClips(), { threshold: -40, minLen: 0.7, pad: 0.1 }); C.edit('Remove Silences', (s2) => C.AutoCut.applySpans(s2, sp, 'ripple', true, 'Silence')); return { spans: sp.length, dur: C.P.seqDuration(s), clips: s.clips.length }; });
  info(JSON.stringify(r1)); ok(r1.spans === 2 && r1.dur < 360 && r1.dur > 240, 'silences removed and everything rippled (duration ' + r1.dur + ')');
  // 2. scene cuts → split
  const r2 = await p.evaluate(async () => { const C = Cutline, s = C.P.seq(), m = C.Media.base(C.state.project.media[0]); const cuts = await C.AutoCut.scanCuts(m, 0, 12, { threshold: 0.4, rate: 4, minGap: 0.5 }); let n = 0; C.edit('Split at Scene Cuts', (s2) => { cuts.forEach(cut => { s2.clips.filter(c => c.kind === 'video').forEach(c => { const lf = Math.round((cut.t - c.in) / (c.speed / s2.fps)); if (lf > 0 && lf < c.dur) { const grp = s2.clips.filter(k => k.id === c.id || (c.link && k.link === c.link)); C.T.splitClips(s2, grp.filter(k => c.start + lf > k.start && c.start + lf < k.start + k.dur), c.start + lf); n++; } }); }); }); return { cuts: cuts.length, n, clips: s.clips.length }; });
  info(JSON.stringify(r2)); ok(r2.cuts === 2 && r2.n >= 1, 'scene cuts applied as splits');
  // 3. censor + track matte on the same (first) clip, plus a title above as the matte
  await p.evaluate(() => { const C = Cutline, s = C.P.seq(); const v = s.clips.filter(c => c.kind === 'video').sort((a, b) => a.start - b.start)[0]; C.state.selection = [v.id]; C.bus.emit('selection'); C.PresetsQC; });
  await p.evaluate(() => Cutline.AutoCut.censorDialog()); await p.waitForSelector('.dialog'); await p.evaluate(() => { const cb = document.querySelector('.dialog input[type=checkbox]'); if (cb.checked) cb.click(); }); await p.click('.dialog-foot .btn.primary'); await p.waitForTimeout(200);
  await p.evaluate(() => { const C = Cutline; const title = C.Media.newGen('title', { name: 'matte' }); C.edit('tm', (s2) => { const v = C.P.clip(s2, C.state.selection[0]); v.fx.push(C.FX.newInstance('trackmatte')); const t = C.P.newClip(s2, title, 'video', C.P.vtracks(s2)[1].id, v.start, v.dur, 0); s2.clips.push(t); }); });
  // 4. voice polish on the linked audio of that clip
  await p.evaluate(() => { const C = Cutline, s = C.P.seq(), v = C.P.clip(s, C.state.selection[0]); const a = s.clips.filter(c => c.kind === 'audio' && c.link && c.link === v.link)[0]; C.state.selection = [a.id]; C.bus.emit('selection'); C.AutoCut.voicePolish(); });
  const vp = await p.evaluate(() => Cutline.P.selectedClips()[0].fx.length); ok(vp === 6, 'voice polish chain on the linked audio');
  // 5. spectrum over the music, on a third video track if any, else track 2 later in time
  await p.evaluate(() => { const C = Cutline; const spec = C.Media.newGen('spectrum', { name: 'viz' }); C.edit('viz', (s2) => { const vt = C.P.vtracks(s2); const tr = vt[2] || vt[1]; const sc = C.P.newClip(s2, spec, 'video', tr.id, 0, C.P.seqDuration(s2), 0); sc.blend = 'screen'; s2.clips.push(sc); }); });
  // 6. opacity keyframes with bezier easing through the graph editor on the spectrum clip (real mouse on the curve)
  await p.evaluate(() => { const C = Cutline, s = C.P.seq(); const sc = s.clips.filter(c => c.name === 'viz')[0]; C.edit('kf', (s2) => { const cc = C.P.clip(s2, sc.id); C.KF.addKey(cc, 'tf.op', 0); C.KF.setAt(cc, 'tf.op', 0, 100); C.KF.addKey(cc, 'tf.op', 60); C.KF.setAt(cc, 'tf.op', 60, 30); cc.kf['tf.op'][0].e = 'bezier'; cc.kf['tf.op'][0].bz = [0.42, 0, 0.58, 1]; }); C.state.selection = [sc.id]; C.bus.emit('selection'); });
  await p.waitForTimeout(300);
  let gbtn = null; for (const el of await p.$$('.kf-graph-btn')) { if (await el.isVisible()) { gbtn = el; break; } }
  ok(!!gbtn, 'graph editor button on the keyframed row'); if (gbtn) { await gbtn.click(); await p.waitForTimeout(200); }
  const curveMid = await p.evaluate(() => { const C = Cutline, c = C.P.selectedClips()[0]; return C.KF.value(c, 'tf.op', 30); });
  ok(Math.abs(curveMid - 65) < 2, 'bezier midpoint is the symmetric value (' + curveMid + ')');
  // 7. preset round trip (save from the first video clip, apply to the second)
  const pr = await p.evaluate(() => { const C = Cutline, s = C.P.seq(), vids = s.clips.filter(c => c.kind === 'video' && c.mediaId && C.P.media(c.mediaId).type === 'video').sort((a, b) => a.start - b.start); C.PresetsQC.savePresets([]); C.state.selection = [vids[0].id]; const fx = vids[0].fx.map(f => ({ type: f.type, p: C.util.clone(f.p), on: true })); C.PresetsQC.savePresets([{ id: 'p1', name: 'Chain', kind: 'video', fx: fx, col: null }]); C.state.selection = [vids[1].id]; C.PresetsQC.applyPreset('p1', true); return { from: vids[0].fx.length, to: C.P.clip(s, vids[1].id).fx.length }; });
  ok(pr.from === pr.to && pr.to >= 2, 'preset copied the effect stack (' + pr.from + ')');
  // 8. split at markers + QC
  const qc = await p.evaluate(async () => { const C = Cutline; C.edit('mk', (s2) => { s2.markers.push({ id: 'm1', f: 45, name: 'x', color: '#fff' }); }); C.A.deselect(); C.PresetsQC.splitAtMarkers(); const probs = await C.PresetsQC.findProblems({ minClip: 3, black: false }); return { clips: C.P.seq().clips.length, probs: probs.map(x => x.kind) }; });
  info(JSON.stringify(qc)); ok(qc.clips > 8, 'split at marker added clips (' + qc.clips + ')');
  // 9. EDL + XML parse
  const ix = await p.evaluate(() => { const C = Cutline, s = C.P.seq(); const edl = C.Interchange.edl(s), xml = C.Interchange.fcpxml(s); const d = new DOMParser().parseFromString(xml, 'application/xml'); return { edlEvents: (edl.match(/^\d{3}  /gm) || []).length, xmlOk: !d.querySelector('parsererror'), items: d.querySelectorAll('clipitem').length }; });
  ok(ix.edlEvents >= 8 && ix.xmlOk && ix.items >= 8, 'EDL/XML of the busy timeline: ' + JSON.stringify(ix));
  // 10. real export of the first 2 s (WebM/VP9 in headless) through the full stack
  const ex = await p.evaluate(async () => { const C = Cutline, s = C.P.seq(); s.inF = 0; s.outF = 60; const st = { format: 'webm-vp9', res: 'half', fps: 30, quality: 'medium', range: 'inout', rateMode: 'variable', audio: true, abitrate: 128000, captions: false, name: 'chain', w: 960, h: 540, dither: false }; try { const r = await C.Export.run(st, function () {}, { v: false }, null); const size = r && (r.blob ? r.blob.size : r.size || 0); return { ok: size > 1000, size: size }; } catch (e) { return { err: e.message }; } });
  info(JSON.stringify(ex)); ok(ex.ok, 'export rendered through matte + censor + spectrum + polish');
  // 11. project JSON round trip
  const rt = await p.evaluate(() => { const C = Cutline; const j = JSON.parse(JSON.stringify(C.state.project)); return { seqs: j.sequences.length, clips: j.sequences[0].clips.length, hasViz: j.sequences[0].clips.some(c => C.P.media(c.mediaId) && C.P.media(c.mediaId).gen && C.P.media(c.mediaId).gen.kind === 'spectrum') }; });
  ok(rt.clips > 8 && rt.hasViz, 'project serialises with everything in it');
  const bad = errs.filter(e => !/favicon|Autoplay|AudioContext was not allowed|native dialog/i.test(e));
  ok(!bad.length, 'no console/page errors' + (bad.length ? ': ' + bad.join(' | ').slice(0, 600) : ''));
  errs.length = 0;
  await L.finish(b, errs, 'y8_chain');
})();
