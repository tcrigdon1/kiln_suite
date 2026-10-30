// Hands-on session 2: selections, copy/paste, move tool on pixels, nudges, delete.
const { launch, assert, near, ASSETS } = require('./lib');
const path = require('path');

(async () => {
  const H = await launch();
  const { page } = H;
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
  await fc.setFiles(path.join(ASSETS, 'face.jpg'));
  await H.wait(700);

  await H.step('rect marquee (M) drag + Shift constrains square', async () => {
    await H.key('m');
    await H.dragDoc([[100, 100], [300, 220]], { steps: 10, modsAfterMove: [] });
    let st = await H.state();
    assert(st.sel && Math.abs(st.sel.w - 200) <= 1 && Math.abs(st.sel.h - 120) <= 1, JSON.stringify(st.sel));
    // shift pressed *after* the drag starts → square
    const a = await H.pt(400, 100), b = await H.pt(560, 180);
    await page.mouse.move(a[0], a[1]); await page.mouse.down();
    await page.mouse.move(a[0] + 20, a[1] + 10, { steps: 3 });
    await page.keyboard.down('Shift');
    await page.mouse.move(b[0], b[1], { steps: 8 });
    await page.mouse.up(); await page.keyboard.up('Shift');
    await H.wait(100);
    st = await H.state();
    console.log('     after shift-drag sel', JSON.stringify(st.sel));
    await H.shot('s2-01-marquee');
  });

  await H.step('Shift at mousedown adds; Alt subtracts; Alt-drag ellipse from centre', async () => {
    await H.key('Control+d');
    await H.dragDoc([[100, 100], [300, 300]]);
    await H.dragDoc([[250, 250], [400, 400]], { mods: ['Shift'] });
    let st = await H.state();
    assert(st.sel.w >= 299 && st.sel.h >= 299, 'add ' + JSON.stringify(st.sel));
    await H.dragDoc([[90, 90], [200, 200]], { mods: ['Alt'] });
    st = await H.state();
    const m = await H.ev(() => { const s = Gesso.app.doc.selection; return [s.mask[150 * s.w + 150], s.mask[280 * s.w + 280]]; });
    assert(m[0] === 0 && m[1] > 0, 'subtract mask ' + m);
    await H.shot('s2-02-add-sub');
    await H.key('Control+d');
    await H.tool('marqueeEllipse');
    const c = await H.pt(600, 400), e = await H.pt(700, 470);
    await page.mouse.move(c[0], c[1]); await page.mouse.down();
    await page.mouse.move(c[0] + 10, c[1] + 10, { steps: 2 });
    await page.keyboard.down('Alt');
    await page.mouse.move(e[0], e[1], { steps: 8 });
    await page.mouse.up(); await page.keyboard.up('Alt');
    await H.wait(100);
    st = await H.state();
    assert(st.sel && Math.abs(st.sel.x - 500) <= 2 && Math.abs(st.sel.w - 200) <= 3, 'ellipse from centre ' + JSON.stringify(st.sel));
    await H.shot('s2-03-ellipse');
  });

  await H.step('lasso freehand', async () => {
    await H.key('l');
    const pts = []; for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2; pts.push([300 + Math.cos(a) * 120, 400 + Math.sin(a) * 80]); }
    await H.dragDoc(pts, { steps: 3 });
    const st = await H.state();
    assert(st.sel && Math.abs(st.sel.w - 240) < 8, JSON.stringify(st.sel));
    await H.shot('s2-04-lasso');
  });

  await H.step('polygonal lasso clicks + Enter', async () => {
    await H.tool('polyLasso');
    for (const p of [[700, 100], [900, 120], [950, 300], [720, 280]]) await H.clickDoc(p[0], p[1], { after: 60 });
    await H.shot('s2-05-polylasso-open');
    await H.key('Enter');
    const st = await H.state();
    assert(st.sel && Math.abs(st.sel.x - 700) <= 2 && Math.abs(st.sel.w - 250) <= 3, JSON.stringify(st.sel));
  });

  await H.step('magic wand click and shift-click add', async () => {
    await H.key('w');
    let st = await H.state(); if (st.tool !== 'wand') await H.tool('wand');
    await H.clickDoc(600, 300);  // the face
    st = await H.state();
    const faceSel = st.sel;
    assert(faceSel && faceSel.w > 300 && faceSel.w < 420, 'face ' + JSON.stringify(faceSel));
    await H.clickDoc(100, 750, { mods: ['Shift'] }); // grass
    st = await H.state();
    assert(st.sel.w > 1000, 'grass add ' + JSON.stringify(st.sel));
    await H.shot('s2-06-wand');
  });

  await H.step('select brush paints a selection', async () => {
    await H.key('Control+d');
    await H.tool('quickSelect');
    await H.dragDoc([[560, 260], [640, 380]]);
    const st = await H.state();
    assert(st.sel && st.sel.w > 50, JSON.stringify(st.sel));
    await H.shot('s2-07-selbrush');
  });

  await H.step('Ctrl+A / Ctrl+D / Shift+Ctrl+I', async () => {
    await H.key('Control+a');
    let st = await H.state(); assert(st.sel && st.sel.w === 1200, 'all');
    await H.key('Control+d');
    st = await H.state(); assert(!st.sel, 'deselect');
    await H.tool('marqueeRect');
    await H.dragDoc([[0, 0], [600, 800]]);
    await H.key('Control+Shift+i');
    st = await H.state(); assert(st.sel && st.sel.x === 600, 'inverse ' + JSON.stringify(st.sel));
  });

  await H.step('feather dialog from menu', async () => {
    await H.menu('Select', 'Modify', 'Feather…');
    await H.wait(200);
    await H.shot('s2-08-feather-dialog');
    assert(await H.dialogOpen(), 'no dialog');
    const inp = page.locator('.gesso-dialog input[type=number]').first();
    await inp.fill('12'); await inp.press('Enter');
    await H.wait(300);
    const m = await H.ev(() => { const s = Gesso.app.doc.selection; return [s.mask[400 * s.w + 595], s.mask[400 * s.w + 605]]; });
    assert(m[0] > 0 && m[0] < 255 && m[1] > 0, 'feathered ' + m);
  });

  await H.step('copy / paste into a new layer and move it with the Move tool', async () => {
    await H.key('Control+d');
    await H.key('m');
    await H.dragDoc([[450, 250], [750, 400]]);
    await H.key('Control+c');
    await H.wait(200);
    // Ctrl+V fires a real paste event (system clipboard may be denied in headless → internal fallback)
    await page.keyboard.press('Control+v');
    await H.wait(400);
    let st = await H.state();
    console.log('     layers after paste:', st.layers.map((l) => l.name).join(', '));
    assert(st.layers.length === 2, 'paste did not create layer');
    await H.key('v');
    await H.dragDoc([[600, 330], [700, 380]]);
    st = await H.state();
    await H.shot('s2-09-paste-move');
  });

  await H.step('move selected pixels on Background, arrow nudges, delete', async () => {
    await page.locator('.layer-row', { hasText: 'Background' }).click();
    await H.key('m');
    await H.dragDoc([[100, 100], [200, 200]]);
    await H.key('v');
    await H.dragDoc([[150, 150], [250, 180]]);
    let st = await H.state();
    assert(st.sel && Math.abs(st.sel.x - 200) <= 1 && Math.abs(st.sel.y - 130) <= 1, 'sel moved with pixels ' + JSON.stringify(st.sel));
    await H.key('ArrowRight', 5);
    await H.key('Shift+ArrowDown');
    st = await H.state();
    assert(Math.abs(st.sel.x - 205) <= 1 && Math.abs(st.sel.y - 140) <= 1, 'nudged ' + JSON.stringify(st.sel));
    const histN = await H.ev(() => Gesso.app.doc.history.entries.slice(-3).map((e) => e.name));
    console.log('     history', histN.join(' | '));
    await H.key('Delete');
    const p = await H.lpx(250, 190);
    console.log('     after delete px', p);
    await H.shot('s2-10-move-nudge-delete');
  });

  await H.finish();
})();
