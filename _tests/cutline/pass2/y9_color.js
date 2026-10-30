// pass2 y9: colour additions — .cube LUT import (Color panel button → file chooser), LUT in render + intensity +
// .kcut round trip, HSL secondary (+ mask view), Match Color, halation, neutral-pick white balance, false-colour scope.
const H = require('./plib');
const fs = require('fs');
const OUT = H.path.join(__dirname, 'out') + '/';
// a 2-point LUT that swaps red and blue, and a 3-point one that inverts
function cube(name, N, fn) { let s = 'TITLE "' + name + '"\nLUT_3D_SIZE ' + N + '\n'; for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) { const o = fn(r / (N - 1), g / (N - 1), b / (N - 1)); s += o.map(v => v.toFixed(4)).join(' ') + '\n'; } return s; }
fs.writeFileSync(OUT + 'swap.cube', cube('swap rb', 2, (r, g, b) => [b, g, r]));
fs.writeFileSync(OUT + 'invert.cube', cube('invert', 3, (r, g, b) => [1 - r, 1 - g, 1 - b]));
fs.writeFileSync(OUT + 'bad.cube', 'LUT_1D_SIZE 4\n0 0 0\n1 1 1\n');
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('y9');
  await H.boot(p, '?test=1');
  await p.evaluate(() => {
    const C = Cutline, P = C.P, T = C.T;
    C.edit('setup', (s, prj) => {
      s.w = 640; s.h = 360;
      const red = C.Media.newGen('solid'); red.gen.color = '#c83c28'; red.name = 'red';
      const warm = C.Media.newGen('solid'); warm.gen.color = '#8c7a6e'; warm.name = 'warm grey';
      const v1 = P.vtracks(s)[0].id;
      T.placeMedia(s, red, 0, v1, null, 'overwrite', 0, 2);     // 0..60
      T.placeMedia(s, warm, 60, v1, null, 'overwrite', 0, 2);   // 60..120
    });
    C.A.select([P.seq().clips[0].id]); C.Engine.seek(10); C.ui.showTab('color');
  });
  await p.waitForTimeout(500);

  /* ---------- LUT import through the Color panel ---------- */
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('.cl-section:has(.sec-title:text-is("LUT")) button:has-text("Import .cube")')]);
  await fc.setFiles([OUT + 'swap.cube', OUT + 'invert.cube', OUT + 'bad.cube']);
  await p.waitForTimeout(800);
  const lutInfo = await p.evaluate(() => { const C = Cutline, s = C.P.seq(), c = s.clips[0]; return { luts: (C.state.project.luts || []).map(l => [l.name, l.size]), applied: c.col && c.col.lut && C.LUT.get(c.col.lut).name, dialog: !!document.querySelector('.dialog') }; });
  H.info('luts: ' + JSON.stringify(lutInfo));
  H.ok(lutInfo.luts.length === 2 && lutInfo.applied === 'swap', 'two .cube LUTs imported into the project, the first applied to the clip; the 1D LUT rejected');
  if (lutInfo.dialog) { await H.shot(p, 'lut-error'); await p.evaluate(() => Cutline.ui.openDialogs.slice().forEach(d => d.close())); }
  await p.waitForTimeout(300);
  let px = await H.progPixels(p, [[0.5, 0.5]]);
  H.info('red through swap LUT: ' + px[0]);
  H.ok(px[0][2] > 170 && px[0][0] < 70, 'swap LUT renders the red solid as blue (' + px[0] + ')');
  await H.shot(p, 'lut-applied');
  // intensity 50 %
  await p.evaluate(() => { const C = Cutline, c = C.P.seq().clips[0]; C.edit('amt', s2 => { C.P.clip(s2, c.id).col.lutAmt = 50; }); });
  await p.waitForTimeout(300);
  px = await H.progPixels(p, [[0.5, 0.5]]);
  H.ok(Math.abs(px[0][0] - px[0][2]) < 30 && px[0][0] > 90 && px[0][0] < 160, 'LUT at 50 % intensity mixes half-way (' + px[0] + ')');
  // .kcut round trip keeps the LUT and the clip reference
  const rt = await p.evaluate(() => { const C = Cutline; const json = C.IO.serialize(); C.IO.load(json, null, 'roundtrip'); const s = C.P.seq(), c = s.clips[0]; return { luts: (C.state.project.luts || []).length, ref: !!(c.col && C.LUT.get(c.col.lut)), amt: c.col.lutAmt, bytes: json.length }; });
  H.ok(rt.luts === 2 && rt.ref && rt.amt === 50, 'LUTs and the clip\'s LUT reference survive a .kcut save/load (' + rt.bytes + ' bytes)');
  await p.evaluate(() => { const C = Cutline; C.A.select([C.P.seq().clips[0].id]); C.Engine.seek(10); });
  await p.waitForTimeout(300);
  // CPU sampler agrees with the GPU (invert LUT on pure colours)
  const samp = await p.evaluate(() => { const C = Cutline, inv = C.state.project.luts.find(l => l.name === 'invert'); return [C.LUT.sample(inv, 1, 0, 0), C.LUT.sample(inv, 0.5, 0.5, 0.5)]; });
  H.ok(Math.abs(samp[0][0]) < 0.01 && Math.abs(samp[0][1] - 1) < 0.01 && Math.abs(samp[1][0] - 0.5) < 0.02, 'trilinear CPU sampler reproduces the invert LUT');

  /* ---------- HSL secondary ---------- */
  const hsl = await p.evaluate(async () => {
    const C = Cutline, P = C.P, s = P.seq(), c = s.clips[0];
    C.edit('hsl', s2 => { const cc = P.clip(s2, c.id); cc.col = null; const e = C.FX.newInstance('hslsec'); e.p.hue = 8; e.p.hw = 30; e.p.dh = 120; cc.fx.push(e); });
    await new Promise(r => setTimeout(r, 300)); C.Engine.renderNow();
    const a = C.Engine.comp.readSmall(8, 4); const g1 = [a[0], a[1], a[2]];
    C.edit('mask', s2 => { P.clip(s2, c.id).fx[0].p.mask = true; }); C.Engine.renderNow();
    const m = C.Engine.comp.readSmall(8, 4); const m1 = [m[0], m[1], m[2]];
    C.edit('miss', s2 => { const e = P.clip(s2, c.id).fx[0]; e.p.mask = false; e.p.hue = 200; }); C.Engine.renderNow();
    const n = C.Engine.comp.readSmall(8, 4); const n1 = [n[0], n[1], n[2]];
    return { shifted: g1, mask: m1, outside: n1 };
  });
  H.info('hsl: ' + JSON.stringify(hsl));
  H.ok(hsl.shifted[1] > hsl.shifted[0] + 60 && hsl.shifted[1] > hsl.shifted[2] + 60, 'HSL secondary qualifies the red and shifts it 120° to green');
  H.ok(hsl.mask[0] > 240 && hsl.mask[1] > 240 && hsl.mask[2] > 240, 'Show Mask renders the qualified area white');
  H.ok(hsl.outside[0] > 150 && hsl.outside[1] < 90, 'a hue centre away from red leaves the red alone');

  /* ---------- Halation ---------- */
  const hal = await p.evaluate(async () => {
    const C = Cutline, P = C.P, s = P.seq(), c = s.clips[0];
    C.edit('hal', (s2, prj) => {
      const cc = P.clip(s2, c.id); cc.fx = [];
      const white = C.Media.newGen('solid'); white.gen.color = '#ffffff'; white.name = 'white';
      const v2 = P.vtracks(s2)[1].id;
      const w = C.T.placeMedia(s2, white, 0, v2, null, 'overwrite', 0, 2)[0]; w.fit = false; w.tf.scale = 30; // small white square in the middle
      const adj = C.Media.newGen('adjust'); const a = C.T.placeMedia(s2, adj, 0, P.vtracks(s2)[2].id, null, 'overwrite', 0, 2)[0];
      const e = C.FX.newInstance('halation'); e.p.r = 90; e.p.amt = 200; e.p.th = 50; a.fx.push(e);
    });
    await new Promise(r => setTimeout(r, 300)); C.Engine.renderNow();
    const sm = C.Engine.comp.readSmall(64, 36);
    const at = (x, y) => { const i = (y * 64 + x) * 4; return [sm[i], sm[i + 1], sm[i + 2]]; };
    // the square covers x 22..41 (30 % of 640 → 192 px → 19 cells); sample just outside its right edge and far away
    return { edge: at(43, 18), far: at(62, 2), inside: at(32, 18) };
  });
  H.info('halation: ' + JSON.stringify(hal));
  H.ok(hal.edge[0] > hal.far[0] + 15 && hal.edge[0] - hal.far[0] > hal.edge[2] - hal.far[2] && hal.inside[0] === 255, 'warm halation bleeds around the white square (edge ' + hal.edge + ' vs far ' + hal.far + ')');

  /* ---------- Match Color ---------- */
  const mc = await p.evaluate(() => { const C = Cutline, s = C.P.seq(); C.edit('clear', s2 => { s2.clips = s2.clips.filter(c => c.trackId === C.P.vtracks(s2)[0].id); }); C.A.select(s.clips.map(c => c.id)); return s.clips.map(c => c.name); });
  H.info('match clips: ' + mc);
  await H.menu(p, 'Clip', 'Match Color');
  await p.waitForSelector('.dialog:has-text("Match Color")');
  await p.selectOption('.dialog select', (await p.evaluate(() => Cutline.P.seq().clips[0].id)));
  await H.shot(p, 'match-dialog');
  await p.click('.dialog-foot .btn.primary');
  await p.waitForFunction(() => !document.querySelector('.dialog'), null, { timeout: 30000 });
  await p.waitForTimeout(400);
  const matched = await p.evaluate(() => { const C = Cutline, c = C.P.seq().clips[0]; const e = c.fx.find(f => f.type === 'colormatch'); C.Engine.seek(10); C.Engine.renderNow(); const a = C.Engine.comp.readSmall(8, 4); C.Engine.seek(70); C.Engine.renderNow(); const b2 = C.Engine.comp.readSmall(8, 4); return { p: e && e.p, fixed: [a[0], a[1], a[2]], ref: [b2[0], b2[1], b2[2]] }; });
  H.info('matched: ' + JSON.stringify(matched));
  H.ok(matched.p && matched.fixed.every((v, i) => Math.abs(v - matched.ref[i]) < 14), 'Color Match brings the red solid to the warm grey reference (' + matched.fixed + ' vs ' + matched.ref + ')');

  /* ---------- Neutral pick white balance ---------- */
  await p.evaluate(() => { const C = Cutline; C.A.select([C.P.seq().clips[1].id]); C.Engine.seek(70); C.ui.showTab('color'); });
  await p.waitForTimeout(400);
  await p.click('.cl-section button:has-text("Pick Neutral")');
  const pc = await H.center(p, '#p-program .overlay, #p-program canvas.overlay');
  await p.mouse.click(pc.x, pc.y);
  await p.waitForTimeout(400);
  const wb = await p.evaluate(() => { const C = Cutline, c = C.P.seq().clips[1]; C.Engine.renderNow(); const a = C.Engine.comp.readSmall(8, 4); return { temp: c.col.temp, tint: c.col.tint, px: [a[0], a[1], a[2]] }; });
  H.info('white balance: ' + JSON.stringify(wb));
  H.ok(wb.temp < -5 && Math.max(...wb.px) - Math.min(...wb.px) < 12, 'picking the warm grey sets a cooler temperature and renders it neutral (' + wb.px + ')');
  await H.shot(p, 'white-balance');

  /* ---------- False colour scope ---------- */
  await p.selectOption('.scope-bar select', 'false');
  await p.evaluate(() => Cutline.Engine.renderNow());
  await p.waitForTimeout(500);
  const fcs = await p.evaluate(() => { const cv = document.querySelector('.scopes canvas'); const g = cv.getContext('2d'); const d = g.getImageData(Math.round(cv.width * 0.35), Math.round(cv.height / 2), 1, 1).data; return { px: [d[0], d[1], d[2]], w: cv.width }; });
  H.info('false colour scope centre: ' + JSON.stringify(fcs));
  // the neutral grey (~0.47 luma) lands in the 18 % grey band → green
  H.ok(fcs.px[1] > 150 && fcs.px[0] < 110 && fcs.px[2] < 110, 'false-colour scope paints the mid-grey picture green (18 % band)');
  await H.shot(p, 'false-color');
  await H.finish(b, errs, 'y9_color');
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
