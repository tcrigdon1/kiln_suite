// Part 2 hands-on: gradient fills/strokes on shape layers, editable rotation (Free Transform keeps shapes
// parametric), radial repeat, save/reload, old-file compatibility.
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
  const shape = () => H.ev(() => JSON.parse(JSON.stringify(Gesso.app.doc.activeLayer().shape)));

  await H.step('draw a star and give it a radial gradient fill from Properties', async () => {
    await H.tool('star');
    await H.dragDoc([[290, 290], [790, 790]], { steps: 10 });
    await page.locator('.dock-tabs .tab[title="Properties"]').first().click();
    await H.wait(200);
    await field(props.locator('.paint-fill'), 'Fill type').locator('select').selectOption('radial');
    await H.wait(250);
    // pick a preset in the gradient editor that appeared
    await props.locator('.paint-fill select.grad-presets').selectOption({ label: 'Ember' });
    await H.wait(250);
    const s = await shape();
    assert(s.kind === 'star' && s.fill.type === 'radial' && s.fill.stops.length === 4, JSON.stringify(s.fill));
    const c = await H.px(540, 540), e = await H.px(540, 330);
    assert(c[0] < 80 && e[0] > 200, 'radial: dark centre, light rim ' + c + ' / ' + e);
    await H.shot('p2-01-star-radial');
  });

  await H.step('gradient stroke (linear) via Properties', async () => {
    const st = props.locator('.paint-stroke');
    await st.locator('.check-row', { hasText: 'Stroke' }).first().locator('input').check();
    await H.wait(150);
    await field(props.locator('.paint-stroke'), 'Stroke type').locator('select').selectOption('linear');
    await H.wait(250);
    const w = field(props.locator('.paint-stroke'), 'Stroke width').locator('input[type=number]');
    await w.fill('14'); await w.press('Enter');
    await H.wait(200);
    const s = await shape();
    assert(s.stroke.enabled && s.stroke.type === 'linear' && s.stroke.width === 14, JSON.stringify(s.stroke));
    await H.shot('p2-02-gradient-stroke');
  });

  await H.step('options bar shows the gradient swatch and its popup edits the fill', async () => {
    await H.tool('star');
    await H.wait(200);
    const sw = page.locator('#optionsbar .grad-swatch').first();
    assert(await sw.count(), 'no gradient swatch in options bar');
    await sw.click();
    await H.wait(250);
    await H.shot('p2-03-options-popup');
    const ang = page.locator('.gesso-dialog .field', { hasText: 'Scale' }).locator('input[type=number]');
    await ang.fill('60'); await ang.press('Tab');
    await H.wait(150);
    await H.dialogBtn('OK');
    const s = await shape();
    assert(s.fill.scale === 60, 'popup scale ' + s.fill.scale);
    const n = await H.ev(() => Gesso.app.doc.history.entries[Gesso.app.doc.history.index].name);
    assert(n === 'Shape Gradient', n);
  });

  await H.step('Free Transform rotate (Shift snaps) keeps the star parametric', async () => {
    await H.key('Control+t');
    const b = await H.ev(() => Gesso.Transform.active.corners);
    const cx = (b[0].x + b[2].x) / 2, cy = (b[0].y + b[2].y) / 2;
    // drag outside the box from the right, around to the lower right → about +30°
    await H.dragDoc([[cx + 330, cy], [cx + 330 * Math.cos(0.52), cy + 330 * Math.sin(0.52)]], { mods: ['Shift'], steps: 12 });
    await H.key('Enter');
    const s = await shape();
    assert(s.kind === 'star' && s.points === 5, 'still a star: ' + s.kind);
    const rot = await H.ev(() => Gesso.Shape.rotation(Gesso.app.doc.activeLayer().shape));
    assert(Math.abs(rot - 30) < 0.01, 'rotation ' + rot);
    await H.wait(300);
    const shown = await field(props, 'Rotation').locator('input').inputValue();
    assert(Math.abs(+shown - 30) < 0.01, 'Properties shows rotation ' + shown);
    await H.shot('p2-04-rotated');
  });

  await H.step('after rotating, star points are still editable (Properties) and stay rotated', async () => {
    const pts = field(props, 'Points').locator('input[type=number]');
    await pts.fill('7'); await pts.press('Enter');
    await H.wait(200);
    const s = await shape();
    const nodes = await H.ev(() => Gesso.Shape.localPath(Gesso.app.doc.activeLayer().shape).subpaths[0].nodes.length);
    assert(s.points === 7 && nodes === 14 && s.matrix, 'points ' + s.points + ' nodes ' + nodes);
    await H.shot('p2-05-seven-points');
  });

  await H.step('Rotation field rotates about the centre; scale via transform bakes into W/H', async () => {
    const c0 = await H.ev(() => Gesso.Shape.center(Gesso.app.doc.activeLayer().shape));
    const rf = field(props, 'Rotation').locator('input');
    await rf.fill('45'); await rf.press('Enter');
    await H.wait(200);
    let rot = await H.ev(() => Gesso.Shape.rotation(Gesso.app.doc.activeLayer().shape));
    assert(Math.abs(rot - 45) < 0.01, 'rotation ' + rot);
    const c1 = await H.ev(() => Gesso.Shape.center(Gesso.app.doc.activeLayer().shape));
    assert(Math.abs(c1[0] - c0[0]) < 0.5 && Math.abs(c1[1] - c0[1]) < 0.5, 'star centre kept ' + JSON.stringify([c0, c1]));
    // scale 50% with the numeric W field of Free Transform
    await H.key('Control+t');
    const wInp = page.locator('#optionsbar .opt-num', { has: page.locator('.opt-label', { hasText: /^W$/ }) }).locator('input');
    await wInp.fill('50'); await wInp.press('Enter');
    await H.key('Enter');
    const s = await shape();
    rot = await H.ev(() => Gesso.Shape.rotation(Gesso.app.doc.activeLayer().shape));
    assert(Math.abs(s.w - 250) < 1.5 && Math.abs(s.h - 250) < 1.5 && Math.abs(rot - 45) < 0.05, 'scaled params ' + s.w + '×' + s.h + ' rot ' + rot);
    const sc = await H.ev(() => Gesso.Affine.decompose(Gesso.app.doc.activeLayer().shape.matrix));
    assert(Math.abs(sc.sx - 1) < 1e-6 && Math.abs(sc.sy - 1) < 1e-6, 'matrix keeps no scale ' + JSON.stringify(sc));
    await H.shot('p2-06-rotate-field-scaled');
  });

  await H.step('gradient follows the rotation (sampled along the rotated axis)', async () => {
    // switch to a linear fill at angle 0 (left→right in shape space): dark on the shape's local left
    await field(props.locator('.paint-fill'), 'Fill type').locator('select').selectOption('linear');
    await H.wait(250);
    const ang = props.locator('.paint-fill .field', { hasText: 'Angle' }).locator('input[type=number]');
    await ang.fill('0'); await ang.press('Enter');
    await H.wait(250);
    const c = await H.ev(() => { const l = Gesso.app.doc.activeLayer(), lb = Gesso.Paths.bounds(Gesso.Shape.localPath(l.shape)); return Gesso.Affine.apply(l.shape.matrix, lb.x + lb.w / 2, lb.y + lb.h / 2); });
    const r = 40, a = Math.PI / 4; // local +x axis is rotated by 45°
    const pL = await H.px(c[0] - Math.cos(a) * r, c[1] - Math.sin(a) * r), pR = await H.px(c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r);
    assert(pL[0] + pL[1] + pL[2] < pR[0] + pR[1] + pR[2] - 60, 'rotated gradient ' + pL + ' vs ' + pR);
    await H.shot('p2-07-linear-rotated');
  });

  await H.step('Node Selection (A) on the rotated star converts it to an editable path in place', async () => {
    const b0 = await H.ev(() => Gesso.layerBounds(Gesso.app.doc.activeLayer(), Gesso.app.doc));
    await H.key('a');
    const n = await H.ev(() => { const p = Gesso.Shape.editPath(Gesso.app.doc.activeLayer().shape); return p.subpaths[0].nodes[0]; });
    await H.dragDoc([[n.x, n.y], [n.x + 20, n.y - 20]], { steps: 6 });
    const s = await shape();
    assert(s.kind === 'path' && !s.matrix, 'converted ' + s.kind);
    const b1 = await H.ev(() => Gesso.layerBounds(Gesso.app.doc.activeLayer(), Gesso.app.doc));
    assert(Math.abs(b1.x + b1.w / 2 - (b0.x + b0.w / 2)) < 25, 'stayed in place');
    await H.key('Control+z');
    const s2 = await shape(); assert(s2.kind === 'star' && s2.matrix, 'undo back to star');
  });

  await H.step('rotated star: transform handles are rotated, Ctrl-click thumbnail selects its pixels, effects follow', async () => {
    await H.key('Control+t');
    const c = await H.ev(() => Gesso.Transform.active.corners);
    const a = Math.atan2(c[1].y - c[0].y, c[1].x - c[0].x) * 180 / Math.PI;
    assert(Math.abs(a - 45) < 0.05, 'handles rotated ' + a);
    await H.key('Escape');
    const row = page.locator('.layer-row', { hasText: 'Star' });
    await row.locator('.lthumb').first().click({ modifiers: ['Control'] });
    await H.wait(200);
    const sel = (await H.state()).sel, b = await H.ev(() => Gesso.layerBounds(Gesso.app.doc.activeLayer(), Gesso.app.doc));
    assert(sel && Math.abs(sel.x - b.x) < 4 && Math.abs(sel.w - b.w) < 8, 'selection from layer ' + JSON.stringify([sel, b]));
    await H.key('Control+d');
    // drop shadow via the Layer Effects dialog (double-click the row)
    await row.dblclick({ position: { x: 200, y: 12 } });
    await H.wait(300);
    await page.locator('.gesso-dialog .fx-item', { hasText: 'Drop Shadow' }).click();
    const dist = page.locator('.gesso-dialog .field', { hasText: 'Distance' }).locator('input[type=number]'); await dist.fill('30'); await dist.press('Enter');
    await H.wait(100);
    if (await H.dialogOpen()) await H.dialogBtn('OK');
    await H.wait(200);
    await H.shot('p2-07b-rotated-shadow');
    const fx = await H.ev(() => !!Gesso.app.doc.activeLayer().effects.items.dropShadow.on);
    assert(fx, 'drop shadow on');
  });

  await H.step('Image ▸ Rotate Canvas 90° keeps the star parametric; undo restores', async () => {
    await H.menu('Image', 'Rotate Canvas', '90° Clockwise');
    await H.wait(300);
    const s = await shape();
    const rot = await H.ev(() => Gesso.Shape.rotation(Gesso.app.doc.activeLayer().shape));
    assert(s.kind === 'star' && s.points === 7 && Math.abs(rot - 135) < 0.05, 'after canvas rotate ' + s.kind + ' ' + rot);
    await H.key('Control+z');
    const rot2 = await H.ev(() => Gesso.Shape.rotation(Gesso.app.doc.activeLayer().shape));
    assert(Math.abs(rot2 - 45) < 0.05, 'undo ' + rot2);
  });

  await H.step('radial repeat: one small rectangle becomes 12 hour markers', async () => {
    await H.tool('rect');
    await H.dragDoc([[525, 120], [555, 200]], { steps: 6 });
    const r0 = await shape(); assert(Math.abs(r0.w - 30) < 1 && Math.abs(r0.h - 80) < 1, 'marker size ' + r0.w + '×' + r0.h);
    await page.locator('.dock-tabs .tab[title="Properties"]').first().click();
    await H.wait(200);
    await props.locator('.repeat-ui .check-row', { hasText: 'Radial repeat' }).locator('input').check();
    await H.wait(250);
    const cx = field(props.locator('.repeat-ui'), 'Centre X').locator('input'); await cx.fill('540'); await cx.press('Enter');
    await H.wait(200);
    const cy = field(props.locator('.repeat-ui'), 'Centre Y').locator('input'); await cy.fill('540'); await cy.press('Enter');
    await H.wait(200);
    const s = await shape();
    assert(s.repeat.enabled && s.repeat.count === 12, JSON.stringify(s.repeat));
    // marker at 3 o'clock: rotated 90° about the centre → around (540+380, 540)
    const p3 = await H.px(540 + 380, 540), p6 = await H.px(540, 540 + 380), gap = await H.px(540 + 270, 540 + 270);
    const dark = (p) => p[0] < 60 && p[1] < 60 && p[2] < 60;
    assert(dark(p3) && dark(p6) && !dark(gap), '3 and 6 o\'clock markers ' + p3 + ' ' + p6 + ' gap ' + gap);
    await H.shot('p2-08-radial-repeat');
    const cnt = field(props.locator('.repeat-ui'), 'Copies').locator('input[type=number]'); await cnt.fill('60'); await cnt.press('Enter');
    await H.wait(200);
    const p1 = await H.px(540 + 380 * Math.sin(Math.PI / 30), 540 - 380 * Math.cos(Math.PI / 30));
    assert(p1[0] < 60, 'minute marker ' + p1);
    await H.shot('p2-09-sixty');
  });

  await H.step('Move tool moves the whole ring (centre follows)', async () => {
    await H.key('v');
    await H.dragDoc([[540, 160], [580, 190]], { steps: 6 });
    const s = await shape();
    assert(Math.abs(s.repeat.cx - 580) < 1 && Math.abs(s.repeat.cy - 570) < 1, 'centre ' + s.repeat.cx + ',' + s.repeat.cy);
    await H.key('Control+z');
  });

  let proj, snap;
  await H.step('save project and reopen: gradients, rotation, repeat all preserved', async () => {
    snap = await H.ev(() => Gesso.app.doc.allLayers().filter((l) => l.type === 'shape').map((l) => JSON.stringify(l.shape)));
    const px0 = await H.ev(() => { const d = Gesso.app.doc; Gesso.Compositor.update(d); return Array.from(d.composite.getContext('2d').getImageData(0, 0, d.width, d.height).data.filter((v, i) => i % 4096 === 0)); });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
    proj = path.join(DL, 'p2-shapes.kgesso'); await dl.saveAs(proj);
    await H.wait(300);
    const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15000 }), H.menu('File', 'Open…')]);
    await fc.setFiles(proj);
    await H.wait(1200);
    const snap2 = await H.ev(() => Gesso.app.doc.allLayers().filter((l) => l.type === 'shape').map((l) => JSON.stringify(l.shape)));
    assert(JSON.stringify(snap2) === JSON.stringify(snap), 'shape params differ after reload');
    const px1 = await H.ev(() => { const d = Gesso.app.doc; Gesso.Compositor.update(d); return Array.from(d.composite.getContext('2d').getImageData(0, 0, d.width, d.height).data.filter((v, i) => i % 4096 === 0)); });
    let diff = 0; for (let i = 0; i < px0.length; i++) diff = Math.max(diff, Math.abs(px0[i] - px1[i]));
    assert(diff <= 2, 'pixels differ after reload: ' + diff);
    await H.shot('p2-10-reloaded');
  });

  await H.step('old project with solid-only shapes (no type/matrix fields) still opens', async () => {
    const old = { format: 'kgesso', version: 1, name: 'old-file', width: 400, height: 300, dpi: 72, guides: [], paths: [], activePathId: null, selection: null,
      layers: [{ id: 'L_old1', type: 'shape', name: 'Old Star', visible: true, opacity: 1, fillOpacity: 1, blend: 'normal', clip: false, locks: {}, effects: null, version: 1,
        shape: { kind: 'star', x: 100, y: 50, w: 200, h: 200, radius: 16, sides: 6, inner: 0.5, points: 5, x1: 0, y1: 0, x2: 100, y2: 100, lineWidth: 6, arrowStart: false, arrowEnd: false, custom: 'heart', path: null,
          fill: { enabled: true, color: '#ff0000' }, stroke: { enabled: true, color: '#000000', width: 4, align: 'center', dash: 'solid', cap: 'round', join: 'round' } } }] };
    const f = path.join(DL, 'old-file.kgesso'); fs.writeFileSync(f, JSON.stringify(old));
    await H.wait(300);
    const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15000 }), H.menu('File', 'Open…')]);
    await fc.setFiles(f);
    await H.wait(800);
    const p = await H.px(200, 160);
    assert(near(p, [255, 0, 0, 255], 3), 'old star renders red ' + p);
    await page.locator('.layer-row', { hasText: 'Old Star' }).click();
    await H.wait(250);
    const ft = await field(props.locator('.paint-fill'), 'Fill type').locator('select').inputValue();
    assert(ft === 'solid', 'fill type ' + ft);
    await H.shot('p2-11-old-file');
  });

  await H.finish();
})();
