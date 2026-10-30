// Pass 3 — easing presets + custom bezier, graph editor (real mouse), Track Matte Key, Censor preset
const L = require('../pass2/plib.js');
const { ok, info } = L;
(async () => {
  const { b, p, errs } = await L.launch();
  await L.boot(p); await L.newProjectUI(p, { name: 'KF' });
  // --- easing math ---
  const e = await p.evaluate(() => {
    const KF = Cutline.KF, keys = [{ f: 0, v: 0, e: 'bezier', bz: [0.42, 0, 0.58, 1] }, { f: 100, v: 100 }];
    const mid = KF.evalKeys(keys, 50), q = KF.evalKeys(keys, 25);
    const back = KF.evalKeys([{ f: 0, v: 0, e: 'back' }, { f: 100, v: 100 }], 80);
    const bounce = KF.evalKeys([{ f: 0, v: 0, e: 'bounce' }, { f: 100, v: 100 }], 100);
    const el = KF.evalKeys([{ f: 0, v: 0, e: 'elastic' }, { f: 100, v: 100 }], 50);
    const ids = KF.EASINGS.map(x => x.id);
    return { mid, q, back, bounce, el, ids, cb: KF.cubicBezier(0.5, 0, 0, 1, 1) };
  });
  info(JSON.stringify(e));
  ok(Math.abs(e.mid - 50) < 0.5, 'symmetric bezier gives 50 at the midpoint');
  ok(e.q < 25 && e.q > 5, 'ease-in-out bezier is slow at the start (' + e.q.toFixed(1) + ')');
  ok(e.back > 100, 'Overshoot goes past the target (' + e.back.toFixed(1) + ')');
  ok(Math.abs(e.bounce - 100) < 1e-6, 'Bounce lands exactly on the end key');
  ok(e.el > 90 && e.el < 110, 'Elastic settles near the target by the midpoint');
  ok(e.ids.includes('bezier') && e.ids.includes('bounce') && e.ids.includes('hold'), 'easing list has the new presets');
  ok(Math.abs(e.cb - 0.5) < 1e-6, 'linear control points give identity');
  // --- place generated clips: a solid on V1 with a keyframed opacity, a title on V2 as a matte ---
  await p.evaluate(() => {
    const C = Cutline, s = C.P.seq();
    const red = C.Media.newGen('solid', { name: 'red' }); red.gen.color = '#ff0000';
    const white = C.Media.newGen('solid', { name: 'white' }); white.gen.color = '#ffffff';
    C.edit('setup', (s2) => {
      const v1 = s2.tracks.filter(t => t.kind === 'video')[0], v2 = s2.tracks.filter(t => t.kind === 'video')[1];
      const solid = C.P.newClip(s2, red, 'video', v1.id, 0, 90, 0); solid.name = 'solid'; s2.clips.push(solid);
      const gen2 = C.P.newClip(s2, white, 'video', v2.id, 0, 90, 0); gen2.name = 'matte'; s2.clips.push(gen2);
      // matte = white solid scaled to the left half of the frame
      gen2.tf.sx = 50; gen2.tf.sy = 100; gen2.tf.x = -480; gen2.fit = false;
      C.KF.addKey(solid, 'tf.op', 0); C.KF.setAt(solid, 'tf.op', 0, 100); C.KF.addKey(solid, 'tf.op', 60); C.KF.setAt(solid, 'tf.op', 60, 20);
    });
    C.state.selection = [s.clips[0].id]; C.bus.emit('selection');
  });
  await p.waitForTimeout(400);
  const hasGen = await p.evaluate(() => { const s = Cutline.P.seq(); return s.clips.map(c => c.gen && c.gen.type); });
  info('gen ' + JSON.stringify(hasGen));
  // --- graph editor: open it from the Opacity row and drag a key ---
  let gbtn = null; for (const el of await p.$$('.kf-graph-btn')) { if (await el.isVisible()) { gbtn = el; break; } }
  ok(!!gbtn, 'graph button visible on the keyframed Opacity row');
  if (gbtn) {
    await gbtn.click(); await p.waitForTimeout(250);
    const cvb = await p.$('.kf-graph');
    ok(!!cvb, 'graph canvas opens');
    const box = await cvb.boundingBox();
    // the end key (f=60, v=20) sits at x ≈ pad + 60/89 * (w-2pad); drag it up by 30 px → value increases
    const before = await p.evaluate(() => Cutline.KF.keys(Cutline.P.selectedClips()[0], 'tf.op').map(k => [k.f, k.v]));
    const W = box.width, PAD = 8, x = box.x + PAD + 60 / 89 * (W - 2 * PAD);
    // find the key's y by probing: value 20 in range [~-6.4,~106.4] (min 0,max 100 ±8%)
    const H = 110, lo = -8, hi = 108, y = box.y + (H - PAD) - (20 - lo) / (hi - lo) * (H - 2 * PAD);
    await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x, y - 30, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(200);
    const after = await p.evaluate(() => Cutline.KF.keys(Cutline.P.selectedClips()[0], 'tf.op').map(k => [k.f, k.v]));
    info('keys ' + JSON.stringify(before) + ' → ' + JSON.stringify(after));
    const k2 = after.filter(k => k[0] !== 0)[0];
    ok(k2 && k2[1] > 20 + 10, 'dragging the key upward raised its value (' + (k2 && k2[1]) + ')');
    ok(await p.evaluate(() => Cutline.H.undo[Cutline.H.undo.length - 1].label === 'Move Keyframe'), 'graph drag commits one "Move Keyframe" step');
    // right-click the first key → Custom Curve
    const y0 = box.y + (H - PAD) - (100 - lo) / (hi - lo) * (H - 2 * PAD), x0 = box.x + PAD;
    await p.mouse.click(x0 + 1, y0, { button: 'right' }); await p.waitForTimeout(150);
    const item = p.locator('.cl-menu .item', { hasText: 'Custom Curve' }).first();
    ok(await item.count() > 0, 'context menu offers Custom Curve');
    await item.click(); await p.waitForTimeout(200);
    const bz = await p.evaluate(() => { const k = Cutline.KF.keys(Cutline.P.selectedClips()[0], 'tf.op')[0]; return [k.e, k.bz]; });
    ok(bz[0] === 'bezier' && Array.isArray(bz[1]) && bz[1].length === 4, 'first key is now a custom bezier with handles ' + JSON.stringify(bz[1]));
  }
  // --- Track Matte Key: V1 red solid keyed by the white half-frame on V2 ---
  await p.evaluate(() => {
    const C = Cutline; C.edit('tm', (s2) => { const solid = s2.clips.filter(c => c.name === 'solid')[0]; solid.kf = {}; solid.tf.op = 100; solid.fx.push(C.FX.newInstance('trackmatte')); });
    C.Engine.seek(10);
  });
  await p.waitForTimeout(500);
  info('scene ' + JSON.stringify(await p.evaluate(() => { const C = Cutline, s = C.P.seq(); const sc = C.Scene.build(s, 10); return { comp: C.Program && C.Program.comp && C.Program.comp.constructor.name, layers: sc.layers.map(l => ({ n: l.clip && l.clip.name, lfx: (l.lfx || []).map(e => e.def.id + ':' + !!e.def.trackMatte), fx: (l.fx || []).map(e => e.def.id) })) }; })));
  const px = await L.progPixels(p, [[0.25, 0.5], [0.75, 0.5]]);
  info('program pixels ' + JSON.stringify(px));
  const left = px[0], right = px[1];
  ok(left && left[0] > 150 && left[1] < 80, 'left half shows the red clip through the matte');
  ok(right && right[0] < 40 && right[1] < 40 && right[2] < 40, 'right half is cut out (black background) and the white matte itself is hidden');
  // invert
  await p.evaluate(() => { const C = Cutline; C.edit('inv', (s2) => { const solid = s2.clips.filter(c => c.name === 'solid')[0]; solid.fx[0].p.inv = true; }); C.Engine.seek(11); });
  await p.waitForTimeout(400);
  info('inv ' + JSON.stringify(await p.evaluate(() => { const C = Cutline, s = C.P.seq(); const sc = C.Scene.build(s, 11); return sc.layers[0].lfx.map(e => e.p); })));
  await p.evaluate(() => { Cutline.Engine.setFrame(12, true); }); await p.waitForTimeout(400);
  const px2 = await L.progPixels(p, [[0.25, 0.5], [0.75, 0.5]]);
  info('px2 ' + JSON.stringify(px2));
  ok(px2[0][0] < 40 && px2[1][0] > 150, 'Invert Matte flips which half shows');
  // --- Censor preset ---
  await p.evaluate(() => { const C = Cutline, s = C.P.seq(); C.state.selection = [s.clips.filter(c => c.name === 'solid')[0].id]; C.bus.emit('selection'); });
  await L.menu(p, 'Clip', 'Censor Region');
  await p.waitForSelector('.dialog');
  await p.evaluate(() => { const cb = document.querySelector('.dialog input[type=checkbox]'); if (cb.checked) cb.click(); });
  await p.click('.dialog-foot .btn.primary'); await p.waitForTimeout(300);
  const cz = await p.evaluate(() => { const c = Cutline.P.selectedClips()[0]; const fx = c.fx[c.fx.length - 1], m = c.masks[c.masks.length - 1]; return { fx: fx.type, size: fx.p.size, mask: m.type, target: m.fx === fx.id, name: m.name }; });
  info(JSON.stringify(cz));
  ok(cz.fx === 'pixelate' && cz.mask === 'ellipse' && cz.target, 'Censor adds a pixelate effect driven by an ellipse mask');
  await L.shot(p, 'kf-matte');
  await L.finish(b, errs, 'y2_keyframes_matte');
})();
