// pass2 y6: time remapping frame blending, mask paths (smooth / transform / animated points), mask tracking,
// Steady Cam. Synthetic clips: track.webm (orange square moving right on testsrc2), shaky.webm (jittered crop).
const H = require('./plib');
const fs = require('fs');
const { execSync } = require('child_process');
const OUT = H.path.join(__dirname, 'out') + '/';
function sh(cmd) { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('y6');
  await H.boot(p, '?test=1');
  await H.importUI2(p, ['track.webm', 'shaky.webm']);
  await p.evaluate(() => {
    const C = Cutline, P = C.P, T = C.T;
    C.edit('setup', (s, prj) => {
      s.w = 640; s.h = 360;
      const tr = prj.media.find(m => m.name === 'track.webm');
      const v1 = P.vtracks(s)[0].id;
      const c = T.placeMedia(s, tr, 0, v1, null, 'overwrite', 0, 4)[0];
      c.fit = true;
    });
  });
  await p.waitForTimeout(400);

  /* ---------- mask tracking through the Inspector ---------- */
  // select the clip, add an ellipse mask over the square (frame 0: square at 120..180 x 100..160 of 640x360)
  await p.evaluate(() => { const C = Cutline, s = C.P.seq(); C.A.select([s.clips[0].id]); C.Engine.seek(0); });
  await p.waitForTimeout(300);
  await p.click('.cl-section:has(.sec-title:text-is("Masks")) .sec-tools .icon-btn');
  await p.click('.cl-menu .item:has-text("Ellipse")');
  await p.waitForTimeout(300);
  await p.evaluate(() => { const C = Cutline, s = C.P.seq(), c = s.clips[0], m = c.masks[0]; C.edit('place', s2 => { const mm = C.Masks.byId(C.P.clip(s2, c.id), m.id); mm.cx = 23.4; mm.cy = 36.1; mm.w = 12; mm.h = 20; mm.feather = 4; }); });
  await p.waitForTimeout(300);
  await H.shot(p, 'mask-before-track');
  await p.click('.insp-scroll button:has-text("Forward")');
  await p.waitForFunction(() => !Array.from(document.querySelectorAll(".dialog")).some(d => /Tracking mask/.test(d.textContent)), null, { timeout: 120000 });
  await p.waitForTimeout(300);
  const tk = await p.evaluate(() => {
    const C = Cutline, s = C.P.seq(), c = s.clips[0], m = c.masks[0];
    const at = (lf) => { const e = C.Masks.eval(c, lf)[0]; return [Math.round(e.cx * 10) / 10, Math.round(e.cy * 10) / 10]; };
    return { keys: (c.kf['mk.' + m.id + '.cx'] || []).length, f0: at(0), f45: at(45), f90: at(90), f110: at(110) };
  });
  H.info('track: ' + JSON.stringify(tk));
  // expected centre: x = 150 + 60 t px, y = 130 + 30 sin(2t)  →  percent of 640x360
  const exp = (t) => [(150 + 60 * t) / 640 * 100, (130 + 30 * Math.sin(2 * t)) / 360 * 100];
  const near = (a, e, tol) => Math.abs(a[0] - e[0]) < tol && Math.abs(a[1] - e[1]) < tol;
  H.ok(tk.keys >= 60, 'tracking wrote Center keyframes along the clip (' + tk.keys + ')');
  H.ok(near(tk.f45, exp(1.5), 2.5) && near(tk.f90, exp(3), 2.5) && near(tk.f110, exp(110 / 30), 3), 'tracked mask centre follows the moving square within 2.5% (' + JSON.stringify([tk.f45, exp(1.5).map(v => v.toFixed(1)), tk.f90, exp(3).map(v => v.toFixed(1))]) + ')');
  await p.evaluate(() => Cutline.Engine.seek(90)); await p.waitForTimeout(500);
  await H.shot(p, 'mask-tracked-f90');
  // the masked clip at frame 90 shows the square inside the mask and nothing (black) far outside it
  const px = await H.progPixels(p, [[330 / 640, 122 / 360], [60 / 640, 300 / 360]]);
  H.info('pixels inside/outside mask at f90: ' + JSON.stringify(px));
  H.ok(px[0][0] > 150 && px[0][1] > 80 && px[0][2] < 90, 'tracked ellipse mask still contains the orange square at frame 90');
  H.ok(px[1][0] + px[1][1] + px[1][2] < 60, 'outside the tracked mask the frame is cut out');

  /* ---------- path masks: smooth curve, transform offset, animated points ---------- */
  const pm = await p.evaluate(() => {
    const C = Cutline, P = C.P, s = P.seq(), c = s.clips[0];
    const m = C.Masks.newMask('path', { pts: [[20, 20], [80, 20], [80, 80], [20, 80]], feather: 0 });
    C.edit('add path', s2 => { const cc = P.clip(s2, c.id); cc.masks = [m]; });
    const sw = 640, sh = 360, out = {};
    const cover = (mk) => { const cv = C.Masks.canvas([mk], 64, 36, sw, sh); const d = cv.getContext('2d').getImageData(0, 0, 64, 36).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++; return n / (64 * 36); };
    out.square = cover(m);
    const m2 = Object.assign({}, m, { smooth: true }); out.smooth = cover(m2);
    const m3 = Object.assign({}, m, { cx: 70 }); out.shifted = cover(m3);
    const o3 = C.Masks.outline(m3, sw, sh); out.shiftedMinX = Math.round(Math.min(...o3.map(q => q[0])) / sw * 100);
    // animate points: key point 1 at frame 0, move it at frame 60
    C.edit('anim', s2 => { const cc = P.clip(s2, c.id); C.Masks.animatePoints(cc, m.id, true, 0); C.Masks.setPointAt(cc, m.id, 1, 60, [95, 20]); });
    const cc = P.clip(s, c.id);
    out.p1at0 = C.Masks.eval(cc, 0)[0].pts[1]; out.p1at30 = C.Masks.eval(cc, 30)[0].pts[1]; out.p1at60 = C.Masks.eval(cc, 60)[0].pts[1];
    out.animated = C.Masks.pointsAnimated(cc, m.id);
    // bake at frame 30: static points take the interpolated value, keys removed
    C.edit('bake', s2 => { C.Masks.animatePoints(P.clip(s2, c.id), m.id, false, 30); });
    const c3 = P.clip(P.seq(), c.id); out.baked = c3.masks[0].pts[1]; out.bakedKeys = C.Masks.pointsAnimated(c3, m.id);
    return out;
  });
  H.info('path masks: ' + JSON.stringify(pm));
  H.ok(Math.abs(pm.square - 0.36) < 0.03, 'straight path covers its 60%×60% square (' + pm.square.toFixed(3) + ')');
  H.ok(pm.smooth > pm.square + 0.03 && pm.smooth < 0.57, 'smooth curve through the square\'s corners bulges between them (area between the square 0.36 and its circumcircle 0.565: ' + pm.smooth.toFixed(3) + ')');
  H.ok(Math.abs(pm.shifted - pm.square) < 0.01 && pm.shiftedMinX === 40, 'Offset X moves the whole path without changing its area (min x ' + pm.shiftedMinX + '%)');
  H.ok(pm.animated && pm.p1at0[0] === 80 && Math.abs(pm.p1at30[0] - 87.5) < 0.01 && pm.p1at60[0] === 95, 'animated point interpolates between its keys (' + JSON.stringify([pm.p1at0, pm.p1at30, pm.p1at60]) + ')');
  H.ok(!pm.bakedKeys && Math.abs(pm.baked[0] - 87.5) < 0.01, 'turning point animation off bakes the current shape');

  /* ---------- frame blending at 50% (decoder path, as export uses) ---------- */
  const fb = await p.evaluate(async () => {
    const C = Cutline, P = C.P, s = P.seq(), c = s.clips[0];
    C.edit('clean', s2 => { const cc = P.clip(s2, c.id); cc.masks = []; cc.kf = {}; C.T.setSpeed(s2, cc, 0.5, false); cc.tm = { speed: 100, blend: false }; });
    const cv = document.createElement('canvas'), comp = C.createCompositor(cv), prov = new C.SourceProvider('export'); prov.useDecoders = true;
    async function rowAt(f) { const scene = C.Scene.build(P.seq(), f); await prov.prepare(scene); comp.render(scene, 640, 360, prov, { captions: false }); const px = comp.readFull().data; const out = []; for (let x = 100; x < 400; x++) { const i = (130 * 640 + x) * 4; out.push(px[i]); } return out; }
    // seq frame 61 at 50% = source frame 30.5: without blending the nearest frame, with blending the mix of 30 and 31
    const plain = await rowAt(61);
    C.edit('blend', s2 => { P.clip(s2, c.id).tm.blend = true; });
    const blended = await rowAt(61);
    // reference: average of source frames 30 and 31 drawn at 100% (seq frames 30 and 31)
    C.edit('ref', s2 => { const cc = P.clip(s2, c.id); cc.tm.blend = false; C.T.setSpeed(s2, cc, 1, false); });
    const a = await rowAt(30), bb = await rowAt(31);
    prov.dropAll(); if (comp.destroy) comp.destroy();
    const made = window.__vf ? window.__vf.made : -1;
    let dPlain = 0, dBlend = 0, edges = 0; for (let x = 0; x < plain.length; x++) { const ref = (a[x] + bb[x]) / 2; dPlain += Math.abs(plain[x] - ref); dBlend += Math.abs(blended[x] - ref); if (Math.abs(a[x] - bb[x]) > 60) edges++; }
    const uniqueMid = blended.filter((v, x) => Math.abs(a[x] - bb[x]) > 60 && Math.abs(v - (a[x] + bb[x]) / 2) < 25).length;
    return { dPlain: Math.round(dPlain / plain.length), dBlend: Math.round(dBlend / plain.length), edges, uniqueMid, made };
  });
  H.info('frame blending: ' + JSON.stringify(fb));
  H.ok(fb.edges >= 2 && fb.uniqueMid >= Math.max(1, fb.edges - 2), 'with frame blending the 50% clip shows mid values where the two source frames differ (' + fb.uniqueMid + '/' + fb.edges + ' edge pixels)');
  H.ok(fb.dBlend < fb.dPlain * 0.5, 'blended frame is much closer to the average of its two source frames than the nearest-frame render (' + fb.dBlend + ' vs ' + fb.dPlain + ')');
  // export a short range with blending through the real exporter and check frames with ffmpeg
  const ex = await p.evaluate(async () => {
    const C = Cutline, P = C.P, s = P.seq(), c = s.clips[0];
    C.edit('blend2', s2 => { const cc = P.clip(s2, c.id); C.T.setSpeed(s2, cc, 0.5, false); cc.tm.blend = true; s2.inF = 60; s2.outF = 66; });
    const st = { format: 'webm-vp9', res: 'seq', w: 640, h: 360, fps: 30, quality: 'high', range: 'inout', audio: false, captions: false, name: 'y6', seqId: s.id };
    const r = await C.Export.run(st, () => { }, { v: false }, null);
    const ab = await r.blob.arrayBuffer(); const buf = new Uint8Array(ab); let s64 = ''; for (let i = 0; i < buf.length; i += 0x8000) s64 += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { b64: btoa(s64), vf: window.__vf };
  });
  fs.writeFileSync(OUT + 'y6.webm', Buffer.from(ex.b64, 'base64'));
  const nfr = +sh(`ffprobe -v error -count_frames -select_streams v -show_entries stream=nb_read_frames -of csv=p=0 ${OUT}y6.webm`);
  H.ok(nfr === 6, 'blended 50% export has 6 frames (' + nfr + ')');
  sh(`ffmpeg -v error -y -i ${OUT}y6.webm -vf "select=eq(n\\,1)" -vframes 1 ${OUT}y6_f1.png`);
  const raw = execSync(`ffmpeg -v error -i ${OUT}y6_f1.png -f rawvideo -pix_fmt rgb24 -`);
  // exported frame 1 = seq 61 = source 30.5: the square's leading edge (x ≈ 120+60*1.0167+60 ≈ 241) is a half-mix
  let mids = 0, strong = 0; for (let x = 200; x < 280; x++) { const i = (130 * 640 + x) * 3, r = raw[i], g = raw[i + 1], bl = raw[i + 2]; if (r > 185 && bl < 90) strong++; }
  for (let x = 236; x <= 246; x++) { const i = (130 * 640 + x) * 3; const r = raw[i], g = raw[i + 1]; if (r > 60 && !(r > 185)) mids++; }
  H.info('exported frame 1 row 130: orange ' + strong + ' px, in-between ' + mids + ' px near the leading edge');
  H.ok(strong > 30 && mids >= 1, 'export contains the frame-blended edge');

  /* ---------- Steady Cam ---------- */
  await p.evaluate(() => {
    const C = Cutline, P = C.P, T = C.T;
    C.edit('shaky', (s, prj) => {
      s.inF = null; s.outF = null;
      s.clips = []; s.transitions = [];
      const sh = prj.media.find(m => m.name === 'shaky.webm'), v1 = P.vtracks(s)[0].id;
      T.placeMedia(s, sh, 0, v1, null, 'overwrite', 0, 4)[0].fit = true;
    });
    C.A.select([P.seq().clips[0].id]); C.Engine.seek(0);
  });
  await p.waitForTimeout(300);
  await H.menu(p, 'Clip', 'Steady Cam (Stabilise)…');
  await p.waitForSelector('.dialog:has-text("Steady Cam")');
  await H.shot(p, 'steadycam-dialog');
  await p.click('.dialog-foot .btn.primary');
  await p.waitForFunction(() => !document.querySelector('.dialog'), null, { timeout: 180000 });
  await p.waitForTimeout(300);
  const sc = await p.evaluate(() => {
    const C = Cutline, s = C.P.seq(), c = s.clips[0];
    const xs = (c.kf['tf.x'] || []).map(k => k.v), ys = (c.kf['tf.y'] || []).map(k => k.v);
    const range = (a) => a.length ? Math.max(...a) - Math.min(...a) : 0;
    // jitter of the correction path (frame-to-frame differences) vs its range: a real stabiliser's correction mirrors the shake
    let jit = 0; for (let i = 1; i < xs.length; i++) jit += Math.abs(xs[i] - xs[i - 1]);
    return { keys: xs.length, rangeX: Math.round(range(xs)), rangeY: Math.round(range(ys)), jitter: Math.round(jit), stab: c.stab, scale: c.tf.scale, undoName: C.H.undo[C.H.undo.length - 1] && C.H.undo[C.H.undo.length - 1].label };
  });
  H.info('steady cam: ' + JSON.stringify(sc));
  H.ok(sc.keys >= 100 && sc.stab && sc.stab.zoom > 100, 'Steady Cam wrote Position keyframes on every sampled frame and zoomed in (' + sc.keys + ' keys, zoom ' + (sc.stab && sc.stab.zoom) + '%)');
  // the synthetic shake is ±20 px x / ±15 px y in source px → the correction must move at least ~15 px in x
  H.ok(sc.rangeX >= 15 && sc.rangeY >= 10 && sc.jitter > sc.rangeX, 'correction path has the amplitude and frame-to-frame motion of the shake (x range ' + sc.rangeX + ', y range ' + sc.rangeY + ')');
  H.ok(Math.round(sc.scale) === Math.round(100 * sc.stab.zoom / 100), 'Scale carries the auto-zoom');
  await p.evaluate(() => Cutline.Engine.seek(45)); await p.waitForTimeout(500);
  await H.shot(p, 'steadycam-result');
  // measure residual shake: phase-correlate consecutive stabilised program frames vs the raw ones
  const resid = await p.evaluate(async () => {
    const C = Cutline, P = C.P, s = P.seq(), c = s.clips[0], TK = C.Tracker;
    const cv = document.createElement('canvas'), comp = C.createCompositor(cv), prov = new C.SourceProvider('export'); prov.useDecoders = true;
    async function tileAt(f) { const scene = C.Scene.build(P.seq(), f); await prov.prepare(scene); comp.render(scene, 320, 180, prov, { captions: false }); return TK.tile(cv, 32, 18, 256, 144, 64); }
    async function motion() { let tot = 0, prev = null; for (let f = 30; f < 60; f += 1) { const t = await tileAt(f); if (prev) { const r = TK.phaseCorr(prev, t, 64); tot += Math.hypot(r.dx, r.dy); } prev = t; } return tot / 29; }
    const stab = await motion();
    C.H.doUndo(); // remove Steady Cam
    const raw = await motion();
    C.H.doRedo();
    prov.dropAll(); if (comp.destroy) comp.destroy();
    return { stab: +stab.toFixed(2), raw: +raw.toFixed(2) };
  });
  H.info('mean frame-to-frame motion (64px tiles of a 320px render): stabilised ' + resid.stab + ' vs raw ' + resid.raw);
  H.ok(resid.stab < resid.raw * 0.6, 'stabilised picture moves much less frame to frame than the raw clip');
  const removed = await p.evaluate(() => { const C = Cutline; C.A.removeSteadyCam(); const c = C.P.seq().clips[0]; return { stab: !!c.stab, keys: !!(c.kf && c.kf['tf.x']), scale: c.tf.scale }; });
  H.ok(!removed.stab && !removed.keys && removed.scale === 100, 'Remove Steady Cam restores the transform');
  await H.finish(b, errs, 'y6_motion');
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
