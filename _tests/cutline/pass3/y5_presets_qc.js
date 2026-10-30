// Pass 3 — effect presets, split at markers, QC finder, grade → .cube
const L = require('../pass2/plib.js');
const { ok, info } = L;
const path = require('path'), fs = require('fs');
(async () => {
  const { b, p, errs } = await L.launch();
  await L.boot(p); await L.newProjectUI(p, { name: 'PQ' });
  const media = path.join(__dirname, 'media', 'talkcuts.webm');
  const before = await p.evaluate(() => Cutline.state.project.media.length);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('.bin-toolbar .icon-btn[data-tip^="Import media"]')]);
  await fc.setFiles([media]); await L.waitReady(p, before + 1);
  await p.evaluate(() => {
    const C = Cutline, m = C.state.project.media[0];
    C.edit('place', (s2) => { const v1 = s2.tracks.filter(t => t.kind === 'video')[0].id, a1 = s2.tracks.filter(t => t.kind === 'audio')[0].id; C.T.placeMedia(s2, m, 0, v1, a1, 'overwrite', 0, 6); const c2 = C.P.newClip(s2, m, 'video', v1, 240, 2, 6); c2.name = 'flash'; s2.clips.push(c2); const c3 = C.P.newClip(s2, m, 'video', v1, 300, 60, 6); c3.name = 'late'; s2.clips.push(c3); });
    const s = C.P.seq(); C.state.selection = [s.clips[0].id]; C.bus.emit('selection');
  });
  // --- presets ---
  await p.evaluate(() => { const C = Cutline; C.edit('fx', (s2) => { const c = s2.clips[0]; const f = C.FX.newInstance('vignette'); f.p.amt = 80; c.fx.push(f); c.col = C.P.defaultColor(); c.col.exposure = -1; }); });
  await p.evaluate(() => Cutline.PresetsQC.savePreset());
  await p.waitForSelector('.dialog'); await p.fill('.dialog input[type=text]', 'Dark Vignette'); await p.click('.dialog-foot .btn.primary'); await p.waitForTimeout(200);
  const pres = await p.evaluate(() => Cutline.PresetsQC.presets().map(x => ({ name: x.name, fx: x.fx.map(f => f.type + ':' + f.p.amt), col: !!x.col })));
  info(JSON.stringify(pres));
  ok(pres.length === 1 && pres[0].name === 'Dark Vignette' && pres[0].fx[0] === 'vignette:80' && pres[0].col, 'preset saved with effect params and colour grade');
  await p.evaluate(() => { const C = Cutline, s = C.P.seq(); C.state.selection = [s.clips.filter(c => c.name === 'late')[0].id]; C.bus.emit('selection'); });
  await L.menu(p, 'Clip', 'Effect Presets', 'Dark Vignette');
  const ap = await p.evaluate(() => { const c = Cutline.P.selectedClips()[0]; return { fx: c.fx.map(f => f.type + ':' + f.p.amt), expo: c.col.exposure }; });
  ok(ap.fx[0] === 'vignette:80' && ap.expo === -1, 'preset applied from the Clip ▸ Effect Presets submenu');
  // --- split at markers ---
  await p.evaluate(() => { const C = Cutline; C.edit('mk', (s2) => { s2.markers.push({ id: 'm1', f: 60, name: 'a', color: '#fff' }, { id: 'm2', f: 120, name: 'b', color: '#fff' }); }); C.A.deselect(); });
  await L.menu(p, 'Sequence', 'Split at Markers');
  const cl = await L.clips(p);
  const firstVid = cl.filter(c => c.kind === 'video' && c.start < 180).sort((a, b) => a.start - b.start), firstAud = cl.filter(c => c.kind === 'audio').sort((a, b) => a.start - b.start);
  info(JSON.stringify(firstVid.map(c => [c.start, c.dur])));
  ok(firstVid.length === 3 && firstVid[1].start === 60 && firstVid[2].start === 120 && firstAud.length === 3, 'video and linked audio split at both markers');
  // --- QC: structural checks (gap, flash frame) + black-frame scan ---
  const qc = await p.evaluate(() => Cutline.PresetsQC.findProblems({ minClip: 3, black: true, rate: 2, threshold: 8 }));
  info(JSON.stringify(qc.map(q => [q.kind, q.f, q.end])));
  ok(qc.some(q => q.kind === 'flash' && q.f === 240), 'the 2-frame clip is reported as a flash frame');
  ok(qc.some(q => q.kind === 'gap' && q.f === 180 && q.end === 240) && qc.some(q => q.kind === 'gap' && q.f === 242 && q.end === 300), 'both video gaps found with exact bounds');
  ok(!qc.some(q => q.kind === 'black' && q.f < 180), 'no false black frames inside real footage');
  await L.menu(p, 'Sequence', 'Find Problem Frames');
  await p.waitForSelector('.dialog'); await p.evaluate(() => { const cb = document.querySelector('.dialog input[type=checkbox]'); if (cb.checked) cb.click(); });
  await p.click('.dialog-foot .btn.primary'); await p.waitForFunction(() => !document.querySelector('.dialog'), null, { timeout: 30000 }); await p.waitForTimeout(200);
  const mk = await p.evaluate(() => Cutline.P.seq().markers.filter(m => m.qc).map(m => m.name));
  ok(mk.length >= 3 && mk.includes('Gap') && mk.includes('Flash frame'), 'QC markers added: ' + mk.join(', '));
  // --- grade → .cube ---
  await p.evaluate(() => { const C = Cutline, s = C.P.seq(); C.state.selection = [s.clips.filter(c => c.name === 'late')[0].id]; C.bus.emit('selection'); C.edit('grade', (s2) => { const c = C.P.clip(s2, C.state.selection[0]); c.fx = []; c.col = C.P.defaultColor(); c.col.exposure = -1; }); });
  const dl = p.waitForEvent('download');
  await L.menu(p, 'File', 'Export Grade as .cube');
  const d = await dl; const txt = fs.readFileSync(await d.path(), 'utf8'); const lines = txt.split('\n').filter(l => /^[0-9]/.test(l));
  const last = lines[lines.length - 1].split(' ').map(Number), mid = lines[Math.floor(lines.length / 2)].split(' ').map(Number);
  info('cube lines ' + lines.length + ' last ' + JSON.stringify(last) + ' mid ' + JSON.stringify(mid));
  ok(/LUT_3D_SIZE 33/.test(txt) && lines.length === 33 * 33 * 33, 'valid 33³ cube file (' + d.suggestedFilename() + ')');
  ok(mid[0] < 0.45 && mid[0] > 0.15 && last[0] < 0.95, 'exposure −1 darkens the mid-grey node (' + mid[0] + ') and white (' + last[0] + ')');
  await L.finish(b, errs, 'y5_presets_qc');
})();
