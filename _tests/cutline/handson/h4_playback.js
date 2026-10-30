// 4. Playback: Space, JKL, arrows, Home/End, Up/Down; program frames change; meters move
const H = require('./hlib');
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('h4');
  await H.boot(p);
  await H.newProjectUI(p);
  await H.importUI(p, ['main1080.webm', 'silent.webm']);
  const it = await H.center(p, '#p-bin .bin-item:has(.name:text-is("main1080.webm"))');
  const sr = await H.center(p, '#p-timeline .tl-scroll');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V1'));
  await H.key(p, 'Backslash');
  const it2 = await H.center(p, '#p-bin .bin-item:has(.name:text-is("silent.webm"))');
  await H.dnd(p, it2.x, it2.y, await H.tlX(p, 600), await H.tlRowY(p, 'V1'));
  await H.key(p, 'Backslash');
  H.info(JSON.stringify(await H.clips(p)));
  // focus timeline by clicking empty area of V3
  await p.mouse.click(await H.tlX(p, 50), await H.tlRowY(p, 'V3'));
  await H.key(p, 'Home');
  const hA = await H.progHash(p);
  await H.shot(p, 'frame0');
  await p.keyboard.press('Space');
  const t0 = Date.now();
  let maxLevel = 0;
  for (let i = 0; i < 10; i++) { await p.waitForTimeout(120); const lv = await p.evaluate(() => { const l = Cutline.Mixer.levels(Cutline.P.seq()); return l ? Math.max(l.master[0], l.master[1]) : 0; }); maxLevel = Math.max(maxLevel, lv); }
  await H.shot(p, 'playing');
  await p.keyboard.press('Space');
  const el = (Date.now() - t0) / 1000;
  const f1 = await H.frame(p);
  H.ok(f1 > 15 && f1 < el * 30 + 10, 'Space plays and pauses: advanced ' + f1 + ' frames in ' + el.toFixed(2) + 's');
  H.ok(maxLevel > 0.02, 'master meter level during playback ' + maxLevel.toFixed(3));
  const playing = await p.evaluate(() => Cutline.Engine.playing);
  H.ok(!playing, 'paused after second Space');
  const hB = await H.progHash(p);
  H.ok(hA !== hB, 'program monitor shows a different frame after playback');
  // meters fall back to silence after stopping
  await p.waitForTimeout(1500);
  const idle = await p.evaluate(() => { const l = Cutline.Mixer.levels(Cutline.P.seq()); return l ? Math.max(l.master[0], l.master[1]) : 0; });
  H.ok(idle < 0.01, 'meters idle after stop (' + idle.toFixed(4) + ')');
  // arrows
  const fa = await H.frame(p);
  await H.key(p, 'ArrowRight', 3);
  H.ok((await H.frame(p)) === fa + 3, 'Right arrow steps 3 frames');
  await H.key(p, 'Shift+ArrowLeft');
  H.ok((await H.frame(p)) === fa - 2, 'Shift+Left steps back 5');
  // L, L (2x), K
  await H.key(p, 'Home');
  await p.keyboard.press('l'); await p.waitForTimeout(300); await p.keyboard.press('l');
  await p.waitForTimeout(700);
  const rate = await p.evaluate(() => Cutline.Engine.rate);
  await H.shot(p, 'shuttle-2x');
  await p.keyboard.press('k');
  const fL = await H.frame(p);
  H.ok(rate === 2, 'L L shuttles at 2x (rate ' + rate + ')');
  H.ok(fL > 30, 'shuttle advanced to ' + fL);
  // J reverse
  await p.keyboard.press('j'); await p.waitForTimeout(600); await p.keyboard.press('k');
  const fJ = await H.frame(p);
  H.ok(fJ < fL - 5, 'J plays in reverse (' + fL + '→' + fJ + ')');
  // K+L / K+J nudge? (hold K, tap L) - common editor gesture
  await p.keyboard.down('k'); await p.keyboard.press('l'); await p.keyboard.up('k');
  await p.waitForTimeout(150);
  H.ok((await H.frame(p)) === fJ + 1 && !(await p.evaluate(() => Cutline.Engine.playing)), 'hold K + tap L steps one frame (' + fJ + '→' + (await H.frame(p)) + ')');
  await p.keyboard.down('k'); await p.keyboard.press('j'); await p.keyboard.up('k');
  H.ok((await H.frame(p)) === fJ, 'hold K + tap J steps back one frame');
  // Up/Down edit points
  await H.key(p, 'Home');
  await H.key(p, 'ArrowDown');
  const e1 = await H.frame(p);
  H.ok(e1 === 600, 'Down jumps to next edit (600): ' + e1);
  await H.key(p, 'ArrowDown');
  const e2 = await H.frame(p);
  H.ok(e2 === 750, 'Down again → sequence end 750: ' + e2);
  await H.key(p, 'ArrowUp');
  H.ok((await H.frame(p)) === 600, 'Up → previous edit');
  await H.key(p, 'End');
  H.ok((await H.frame(p)) === 750, 'End → sequence end');
  // two different times show different pixels
  await H.key(p, 'Home');
  for (let i = 0; i < 6; i++) await p.keyboard.press('Shift+ArrowRight');
  const pxA = await H.progPixels(p, [[0.5, 0.5], [0.2, 0.8], [0.9, 0.1]]);
  await H.key(p, 'ArrowDown'); // 600: silent.webm
  await H.key(p, 'ArrowRight', 10);
  const pxB = await H.progPixels(p, [[0.5, 0.5], [0.2, 0.8], [0.9, 0.1]]);
  H.ok(JSON.stringify(pxA) !== JSON.stringify(pxB), 'pixels differ between frame 30 and frame 610: ' + JSON.stringify(pxA) + ' vs ' + JSON.stringify(pxB));
  await H.shot(p, 'frame610');
  // play across the cut from 590 and stop on silent clip
  for (let i = 0; i < 4; i++) await p.keyboard.press('Shift+ArrowLeft');
  await p.keyboard.press('Space'); await p.waitForTimeout(900); await p.keyboard.press('Space');
  const fc = await H.frame(p);
  H.ok(fc > 600, 'played across cut to ' + fc);
  // play button in program monitor
  await p.click('#p-program .icon-btn.play');
  await p.waitForTimeout(500);
  H.ok(await p.evaluate(() => Cutline.Engine.playing), 'program Play button starts playback');
  await p.click('#p-program .icon-btn.play');
  // play to end stops at end
  await H.key(p, 'End'); await H.key(p, 'ArrowLeft', 5);
  await p.keyboard.press('Space'); await p.waitForTimeout(800);
  H.ok(!(await p.evaluate(() => Cutline.Engine.playing)) && (await H.frame(p)) >= 745, 'playback stops at sequence end (' + (await H.frame(p)) + ')');
  // Space at end restarts from beginning
  await p.keyboard.press('Space'); await p.waitForTimeout(400); await p.keyboard.press('Space');
  const fr = await H.frame(p);
  H.ok(fr < 30, 'Space at end restarts from start (' + fr + ')');
  await H.finish(b, errs, 'h4_playback');
  function info(m) { H.info(m); }
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
