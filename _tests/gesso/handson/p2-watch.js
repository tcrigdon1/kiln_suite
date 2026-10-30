// Part 2 end-to-end: build a watch face through the UI only — gradient dial + bezel, 60 + 12 markers from two
// radially repeated rectangles, curved brand text, rotated rounded-rectangle hands in a group with a shadow.
const { launch, assert, near, ROOT } = require('./lib');
const path = require('path');
const fs = require('fs');
const DL = path.join(ROOT, 'downloads'); fs.mkdirSync(DL, { recursive: true });

(async () => {
  const H = await launch();
  const { page } = H;
  await page.locator('.welcome-quick .btn', { hasText: '1080 × 1080' }).click();
  await H.wait(300);
  const props = page.locator('.panel-properties');
  const field = (scope, label) => scope.locator('.field', { has: page.locator('label', { hasText: new RegExp('^' + label) }) }).first();
  const setNum = async (scope, label, v) => { const i = field(scope, label).locator('input').last(); await i.fill(String(v)); await i.press('Enter'); await H.wait(150); };
  const setFg = async (hex) => { await page.locator('.swatch-fg').click(); await H.wait(120); const h = page.locator('.gesso-dialog .cp .hex-input').last(); await h.fill(hex); await h.press('Enter'); await H.wait(120); };
  const showProps = async () => { await page.locator('.dock-tabs .tab[title="Properties"]').first().click(); await H.wait(150); };
  await H.key('Control+Shift+;'); // snapping off for precise small shapes

  await H.step('dial: gradient circle with a chrome bezel stroke', async () => {
    await setFg('#14161b'); await H.key('Alt+Backspace');
    await H.tool('ellipse');
    await H.dragDoc([[540, 540], [960, 960]], { mods: ['Shift', 'Alt'], steps: 10 });
    await showProps();
    await field(props.locator('.paint-fill'), 'Fill type').locator('select').selectOption('radial');
    await H.wait(200);
    await props.locator('.paint-fill select.grad-presets').selectOption({ label: 'Lagoon' });
    await H.wait(150);
    await props.locator('.paint-stroke .check-row', { hasText: 'Stroke' }).first().locator('input').check();
    await H.wait(150);
    await field(props.locator('.paint-stroke'), 'Stroke type').locator('select').selectOption('linear');
    await H.wait(200);
    await props.locator('.paint-stroke select.grad-presets').selectOption({ label: 'Chrome' });
    await H.wait(150);
    await setNum(props.locator('.paint-stroke'), 'Stroke width', 30);
    await field(props.locator('.paint-stroke'), 'Stroke align').locator('select').selectOption('outside');
    await H.wait(200);
    const s = await H.ev(() => Gesso.app.doc.activeLayer().shape);
    assert(Math.abs(s.w - 840) < 2 && s.fill.type === 'radial' && s.stroke.type === 'linear', JSON.stringify([s.w, s.fill.type, s.stroke.type]));
  });

  await H.step('60 minute markers + 12 hour markers from two repeated rectangles', async () => {
    await H.tool('rect');
    await setFg('#e9eef2');
    await H.dragDoc([[537, 140], [543, 168]], { steps: 4 });
    await showProps();
    await props.locator('.repeat-ui .check-row', { hasText: 'Radial repeat' }).locator('input').check();
    await H.wait(200);
    await setNum(props.locator('.repeat-ui'), 'Copies', 60);
    await setNum(props.locator('.repeat-ui'), 'Centre X', 540);
    await setNum(props.locator('.repeat-ui'), 'Centre Y', 540);
    await H.tool('rect');
    await setFg('#e8c27a');
    await H.dragDoc([[528, 140], [552, 215]], { steps: 4 });
    await showProps();
    await props.locator('.repeat-ui .check-row', { hasText: 'Radial repeat' }).locator('input').check();
    await H.wait(200);
    await setNum(props.locator('.repeat-ui'), 'Centre X', 540);
    await setNum(props.locator('.repeat-ui'), 'Centre Y', 540);
    const reps = await H.ev(() => Gesso.app.doc.allLayers().filter((l) => l.type === 'shape' && l.shape.repeat && l.shape.repeat.enabled).map((l) => l.shape.repeat.count));
    assert(JSON.stringify(reps) === '[60,12]', JSON.stringify(reps));
    // new shapes take the current foreground colour (gold hour marker at 3 o'clock)
    const p = await H.px(540 + 362, 540);
    assert(near(p, [0xe8, 0xc2, 0x7a, 255], 6), 'hour marker colour ' + p);
  });

  await H.step('curved brand text (top) and model text (bottom, inside)', async () => {
    await setFg('#ffffff');
    await H.key('t');
    await H.clickDoc(400, 400);
    await page.keyboard.type('STRATA');
    await page.keyboard.press('Control+Enter');
    const size = page.locator('#optionsbar .opt-num', { has: page.locator('.opt-label', { hasText: 'Size' }) }).locator('input');
    await size.fill('58'); await size.press('Enter');
    await page.locator('#optionsbar select').nth(1).selectOption('700');
    const tr = page.locator('#optionsbar .opt-num', { has: page.locator('.opt-label', { hasText: 'Tracking' }) }).locator('input');
    await tr.fill('120'); await tr.press('Enter');
    await showProps();
    await field(props.locator('.curve-ui'), 'Curve').locator('select').selectOption('circle');
    await H.wait(200);
    await setNum(props.locator('.curve-ui'), 'Radius', 290);
    await setNum(props.locator('.curve-ui'), 'Centre X', 540);
    await setNum(props.locator('.curve-ui'), 'Centre Y', 540);
    await H.key('t');
    await H.clickDoc(400, 800);
    await page.keyboard.type('AUTOMATIC · 1924');
    await page.keyboard.press('Control+Enter');
    await size.fill('34'); await size.press('Enter');
    await showProps();
    await field(props.locator('.curve-ui'), 'Curve').locator('select').selectOption('circle');
    await H.wait(200);
    await field(props.locator('.curve-ui'), 'Direction').locator('select').selectOption('inside');
    await H.wait(150);
    await setNum(props.locator('.curve-ui'), 'Start angle', 180);
    await setNum(props.locator('.curve-ui'), 'Radius', 300);
    await setNum(props.locator('.curve-ui'), 'Centre X', 540);
    await setNum(props.locator('.curve-ui'), 'Centre Y', 540);
    const curves = await H.ev(() => Gesso.app.doc.allLayers().filter((l) => l.type === 'text').map((l) => l.text.curve.dir + '@' + l.text.curve.start));
    assert(JSON.stringify(curves) === '["outside@0","inside@180"]', JSON.stringify(curves));
  });

  await H.step('hands: rounded rectangles rotated with the Rotation field, grouped, shadowed', async () => {
    await H.tool('roundRect');
    await setFg('#f4f4f4');
    await H.dragDoc([[526, 330], [554, 560]], { steps: 6 });
    await showProps();
    await setNum(props, 'Corner radius', 14);
    await setNum(props, 'Rotation', -60);
    // move so that the hand's tail sits on the centre: tail (540,560) rotated −60° about (540,445) → (639.6,502.5)
    await H.key('v');
    await H.dragDoc([[540, 445], [440.4, 482.5]], { steps: 8 });
    await H.tool('roundRect');
    await H.dragDoc([[531, 180], [549, 560]], { steps: 6 });
    await showProps();
    await setNum(props, 'Corner radius', 9);
    await setNum(props, 'Rotation', 60);
    await H.key('v');
    await H.dragDoc([[540, 370], [704.5, 445]], { steps: 8 });
    // group the two hands and add a drop shadow on the group
    const rows = page.locator('.layer-row', { hasText: 'Rounded Rectangle' });
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Control'] });
    await H.key('Control+g');
    await page.locator('.layer-row.active').dblclick({ position: { x: 230, y: 12 } });
    await H.wait(300);
    await page.locator('.gesso-dialog .fx-item', { hasText: 'Drop Shadow' }).click();
    await H.wait(100);
    await H.dialogBtn('OK');
    // centre cap
    await H.tool('ellipse');
    await setFg('#e8c27a');
    await H.dragDoc([[540, 540], [566, 566]], { mods: ['Shift', 'Alt'], steps: 4 });
    const hands = await H.ev(() => Gesso.app.doc.allLayers().filter((l) => l.type === 'shape' && l.shape.kind === 'roundRect').map((l) => [Math.round(Gesso.Shape.rotation(l.shape)), l.shape.radius]));
    assert(JSON.stringify(hands.map((h) => h[0]).sort()) === '[-60,60]', JSON.stringify(hands));
    await H.wait(300);
    await H.shot('p2w-01-watch');
  });

  await H.step('watch survives save → reopen pixel-for-pixel', async () => {
    const grab = () => H.ev(() => { const d = Gesso.app.doc; Gesso.Compositor.update(d); return Array.from(d.composite.getContext('2d').getImageData(0, 0, d.width, d.height).data.filter((v, i) => i % 1024 === 0)); });
    const a = await grab();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
    const f = path.join(DL, 'p2-watch.kgesso'); await dl.saveAs(f);
    await H.wait(300);
    const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15000 }), H.menu('File', 'Open…')]);
    await fc.setFiles(f);
    await H.wait(1500);
    const b = await grab();
    let diff = 0; for (let i = 0; i < a.length; i++) diff = Math.max(diff, Math.abs(a[i] - b[i]));
    assert(diff <= 2, 'max pixel diff ' + diff);
    const [dl2] = await Promise.all([page.waitForEvent('download'), (async () => { await page.keyboard.press('Control+Alt+s'); await H.wait(400); await H.dialogBtn('Export'); })()]);
    await dl2.saveAs(path.join(ROOT, 'shots', 'p2w-02-export.png'));
  });

  await H.finish();
})();
