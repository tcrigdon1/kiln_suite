// 9. Titles: New Item, T tool click, inline edit, styling, animations, lower third, credits, transformed title dragging
const H = require('./hlib');
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('h8');
  await H.boot(p);
  await H.newProjectUI(p);
  await H.importUI(p, ['still.jpg']);
  const sr = await H.center(p, '#p-timeline .tl-scroll');
  let it = await H.center(p, '#p-bin .bin-item:has(.name:text-is("still.jpg"))');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V1'));
  await H.key(p, 'Backslash');
  const ruler = async (f) => p.mouse.click(await H.tlX(p, f), (await H.center(p, '#p-timeline .tl-ruler-hit')).y);
  // --- Library New Item → Title → Lower Third
  await p.click('.bin-toolbar .icon-btn[data-tip="New item"]');
  await p.locator('.cl-menu .item', { hasText: 'Title' }).first().hover();
  await p.waitForTimeout(150);
  await H.shot(p, 'new-item-title-menu');
  await p.locator('.cl-menu').last().locator('.item', { hasText: 'Lower Third' }).click();
  await p.waitForTimeout(300);
  it = await H.center(p, '#p-bin .bin-item:has(.name:text-is("Lower Third"))');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V2'));
  await ruler(60);
  await p.waitForTimeout(300);
  await H.shot(p, 'lower-third');
  let cl = await H.clips(p);
  H.ok(cl.some(c => c.track === 'V2' && c.name === 'Lower Third'), 'lower third placed on V2');
  // --- T tool click in program monitor creates a title at that point
  await H.key(p, 't');
  const pv = await H.center(p, '#p-program canvas.overlay');
  await p.mouse.click(pv.bb.x + pv.bb.width * 0.5, pv.bb.y + pv.bb.height * 0.3);
  await p.waitForTimeout(300);
  cl = await H.clips(p);
  const tclip = await p.evaluate(() => { const c = Cutline.P.primaryClip(); return c && c.gen ? { id: c.id, x: c.gen.layers[0].x, y: c.gen.layers[0].y, text: c.gen.layers[0].text, track: Cutline.P.trackLabel(Cutline.P.seq(), Cutline.P.track(Cutline.P.seq(), c.trackId)) } : null; });
  H.ok(tclip && Math.abs(tclip.x - 50) < 2 && Math.abs(tclip.y - 30) < 2, 'T-tool click creates title at click point: ' + JSON.stringify(tclip));
  H.ok((await p.evaluate(() => Cutline.state.tool)) === 'select', 'tool returns to Selection after placing text');
  // --- inline edit: double-click text in program monitor
  await p.mouse.dblclick(pv.bb.x + pv.bb.width * 0.5, pv.bb.y + pv.bb.height * 0.3);
  await p.waitForTimeout(150);
  const ta = await p.locator('#p-program textarea').count();
  H.ok(ta === 1, 'double-click opens inline text editor');
  await p.keyboard.press('Control+a'); await p.keyboard.type('Hello World');
  await H.shot(p, 'inline-edit');
  await p.keyboard.press('Control+Enter');
  await p.waitForTimeout(200);
  const txt = await p.evaluate((id) => Cutline.P.clip(Cutline.P.seq(), id).gen.layers[0].text, tclip.id);
  H.ok(txt === 'Hello World', 'inline edit committed: ' + txt);
  // --- styling in the inspector
  await p.click('#p-right .tab[data-id="inspector"]');
  const fontSel = p.locator('.insp-scroll .cl-field:has(label:text-is("Font")) select');
  await fontSel.selectOption('Georgia');
  const size = p.locator('.insp-scroll .cl-field:has(label:text-is("Size")) input[type=number]');
  await size.click({ clickCount: 3 }); await p.keyboard.type('150'); await p.keyboard.press('Enter');
  await p.locator('.insp-scroll .cl-field:has(label:text-is("Color")) input[type=color]').first().fill('#ff3300');
  await p.locator('.insp-scroll label.cl-check:has-text("Stroke") input').first().check();
  await p.waitForTimeout(150);
  await p.locator('.insp-scroll label.cl-check:has-text("Background box") input').check();
  await p.waitForTimeout(150);
  await p.locator('.insp-scroll .cl-field:has(label:text-is("Animate In")) select').selectOption('slideUp');
  await p.waitForTimeout(150);
  const L = await p.evaluate((id) => { const l = Cutline.P.clip(Cutline.P.seq(), id).gen.layers[0]; return { font: l.font, size: l.size, color: l.color, stroke: l.stroke, box: l.box, shadow: l.shadow, anIn: l.anIn }; }, tclip.id);
  H.ok(L.font === 'Georgia' && L.size === 150 && L.color === '#ff3300' && L.stroke && L.box && L.anIn === 'slideUp', 'title styling applied: ' + JSON.stringify(L));
  await ruler(75);
  await p.waitForTimeout(300);
  await H.shot(p, 'styled-title');
  // pixel check: the styled text renders orange-red somewhere near 30% height
  // --- animation: at the clip start the slide-up title is offset/transparent vs. later
  const tc = await p.evaluate((id) => { const c = Cutline.P.clip(Cutline.P.seq(), id); return { s: c.start, d: c.dur }; }, tclip.id);
  await ruler(tc.s + 1); const hA = await H.progHash(p);
  await ruler(tc.s + 40); const hB = await H.progHash(p);
  H.ok(hA !== hB, 'slide-up animation changes the picture over time');
  // --- transformed title: scale 50%, rotate 20° via inspector, then drag the text layer in the program
  await ruler(tc.s + 40);
  const sc = p.locator('.insp-scroll .cl-field:has(label:text-is("Scale")) input[type=number]').first();
  // the title inspector has layer Scale too; use the Transform section's field
  const tfScale = p.locator('.insp-scroll .cl-section:has(.sec-title:text-is("Transform")) .cl-field:has(label:text-is("Scale")) input[type=number]');
  await tfScale.click({ clickCount: 3 }); await p.keyboard.type('50'); await p.keyboard.press('Enter');
  const tfRot = p.locator('.insp-scroll .cl-section:has(.sec-title:text-is("Transform")) .cl-field:has(label:text-is("Rotation")) input[type=number]');
  await tfRot.click({ clickCount: 3 }); await p.keyboard.type('20'); await p.keyboard.press('Enter');
  await p.waitForTimeout(250);
  void sc;
  await H.shot(p, 'transformed-title-outline');
  // compute where the text now is on screen (layer center mapped through the clip transform)
  const scr = await p.evaluate((id) => {
    const C = Cutline, s = C.P.seq(), c = C.P.clip(s, id), Ly = c.gen.layers[0];
    const Lr = C.Scene.clipLayer(s, c, C.Engine.frame, {});
    const pt = C.Scene.mapPoint(s, Lr, Ly.x / 100 * s.w, Ly.y / 100 * s.h);
    const r = C.Program.overlay.getBoundingClientRect();
    return { x: r.left + pt[0] * C.Program.sk, y: r.top + pt[1] * C.Program.sk, lx: Ly.x, ly: Ly.y };
  }, tclip.id);
  await H.drag(p, scr.x, scr.y, scr.x + 40, scr.y);
  const after = await p.evaluate((id) => { const c = Cutline.P.clip(Cutline.P.seq(), id); return { lx: c.gen.layers[0].x, ly: c.gen.layers[0].y, tx: c.tf.x, ty: c.tf.y }; }, tclip.id);
  // 40 screen px at sk, through 50% scale & 20° rotation: dx_local = 40/sk/0.5*cos20 → in %
  const k = await p.evaluate(() => Cutline.Program.sk);
  const expDx = 40 / k / 0.5 * Math.cos(20 * Math.PI / 180) / 1920 * 100, expDy = -40 / k / 0.5 * Math.sin(20 * Math.PI / 180) / 1080 * 100;
  H.ok(Math.abs((after.lx - scr.lx) - expDx) < 0.6 && Math.abs((after.ly - scr.ly) - expDy) < 0.6 && after.tx === 960, 'dragging text on a scaled+rotated title moves the layer in its own frame (Δx ' + (after.lx - scr.lx).toFixed(2) + ' exp ' + expDx.toFixed(2) + ', Δy ' + (after.ly - scr.ly).toFixed(2) + ' exp ' + expDy.toFixed(2) + '), clip transform untouched');
  await H.shot(p, 'transformed-title-dragged');
  // double-click on the moved text still opens the editor
  const scr2 = await p.evaluate((id) => {
    const C = Cutline, s = C.P.seq(), c = C.P.clip(s, id), Ly = c.gen.layers[0];
    const pt = C.Scene.mapPoint(s, C.Scene.clipLayer(s, c, C.Engine.frame, {}), Ly.x / 100 * s.w, Ly.y / 100 * s.h);
    const r = C.Program.overlay.getBoundingClientRect(); return { x: r.left + pt[0] * C.Program.sk, y: r.top + pt[1] * C.Program.sk };
  }, tclip.id);
  await p.mouse.dblclick(scr2.x, scr2.y);
  await p.waitForTimeout(150);
  H.ok(await p.locator('#p-program textarea').count() === 1, 'double-click on transformed text opens inline editor');
  await p.keyboard.press('Escape');
  // --- Ctrl+Alt+T new title at playhead; menus show the binding
  const n0 = (await H.clips(p)).length;
  await p.mouse.click(await H.tlX(p, 10), await H.tlRowY(p, 'V1') + 100); // focus timeline (audio area)
  await H.key(p, 'Control+Alt+t');
  H.ok((await H.clips(p)).length === n0 + 1, 'Ctrl+Alt+T adds a title at the playhead');
  await p.click('.menu-title:text-is("Effects")');
  await p.locator('.cl-menu .item', { hasText: 'New Title' }).hover(); await p.waitForTimeout(150);
  const kbd = await p.locator('.cl-menu').last().locator('.item:has-text("Blank Title") .kbd').innerText();
  H.ok(kbd === 'Ctrl+Alt+T', 'Effects › New Title › Blank Title shows Ctrl+Alt+T (' + kbd + ')');
  await p.keyboard.press('Escape');
  // --- credits roll via Effects menu preset; frames scroll
  await H.key(p, 'End');
  await H.menu(p, 'Effects', 'New Title', 'End Credits Roll');
  const cr = await p.evaluate(() => { const c = Cutline.P.primaryClip(); return { s: c.start, d: c.dur, roll: c.gen.roll }; });
  H.ok(cr.roll && cr.roll.on, 'credits roll title created');
  await H.key(p, 'Backslash');
  await ruler(cr.s + 5); const r1 = await H.progHash(p);
  await ruler(cr.s + Math.round(cr.d / 2)); const r2 = await H.progHash(p);
  await H.shot(p, 'credits');
  H.ok(r1 !== r2, 'credits roll scrolls over time');
  // --- Inspector title preset select switches preset
  await H.finish(b, errs, 'h8_titles');
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
