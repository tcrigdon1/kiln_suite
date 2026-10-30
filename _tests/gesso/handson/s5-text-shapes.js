// Hands-on session 5: Text tool, shape tools, pen tool, node edit, path → selection.
const { launch, assert, near } = require('./lib');

(async () => {
  const H = await launch();
  const { page } = H;
  await page.locator('.welcome-quick .btn', { hasText: '1920 × 1080' }).click();
  await H.wait(300);

  await H.step('text: click, type multi-line, commit with Ctrl+Enter', async () => {
    await H.key('t');
    await H.clickDoc(300, 300);
    await page.keyboard.type('Hello Gesso', { delay: 20 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('second line', { delay: 20 });
    await H.shot('s5-01-typing');
    await page.keyboard.press('Control+Enter');
    await H.wait(150);
    const st = await H.state();
    assert(st.activeType === 'text', st.activeType);
    const t = await H.ev(() => Gesso.app.doc.activeLayer().text.text);
    assert(t === 'Hello Gesso\nsecond line', JSON.stringify(t));
    await H.shot('s5-02-committed');
  });

  await H.step('text: change size / colour / font in options bar while layer active', async () => {
    const size = page.locator('#optionsbar .opt-num', { has: page.locator('.opt-label', { hasText: 'Size' }) }).locator('input');
    await size.fill('120'); await size.press('Enter');
    await page.locator('#optionsbar select.font-select').selectOption('Georgia');
    await page.locator('#optionsbar .color-chip').first().click();
    await H.wait(150);
    const hex = page.locator('.gesso-dialog .cp .hex-input').last(); await hex.fill('aa3300'); await hex.press('Enter');
    await H.wait(150);
    const t = await H.ev(() => { const x = Gesso.app.doc.activeLayer().text; return [x.size, x.font, x.color]; });
    assert(t[0] === 120 && t[1] === 'Georgia' && t[2] === '#aa3300', JSON.stringify(t));
    await H.shot('s5-03-options');
  });

  await H.step('text: Character panel size slider edits the active layer', async () => {
    const sizeRow = page.locator('.panel-character .field', { hasText: 'Size' }).first();
    if (!(await sizeRow.count())) { console.log('     character panel not found'); return; }
    const n = sizeRow.locator('input[type=number]');
    await n.fill('90'); await n.press('Enter');
    await H.wait(150);
    const sz = await H.ev(() => Gesso.app.doc.activeLayer().text.size);
    assert(sz === 90, 'size ' + sz);
  });

  await H.step('text: double-click to re-edit, then move it with the Move tool', async () => {
    const b = await H.ev(() => Gesso.layerBounds(Gesso.app.doc.activeLayer(), Gesso.app.doc));
    await H.clickDoc(b.x + 40, b.y + 40, { count: 2 });
    await H.wait(200);
    const editing = await H.ev(() => !!Gesso.TextTool.edit);
    assert(editing, 'not editing after double-click');
    await page.keyboard.press('Control+End');
    await page.keyboard.type('!');
    await page.keyboard.press('Escape');
    await H.wait(150);
    const t = await H.ev(() => Gesso.app.doc.activeLayer().text.text);
    assert(t.endsWith('!'), t);
    await H.key('v');
    await H.dragDoc([[b.x + 40, b.y + 40], [b.x + 140, b.y + 90]]);
    const b2 = await H.ev(() => Gesso.layerBounds(Gesso.app.doc.activeLayer(), Gesso.app.doc));
    assert(Math.abs(b2.x - b.x - 100) < 2 && Math.abs(b2.y - b.y - 50) < 2, JSON.stringify([b, b2]));
    await H.shot('s5-04-text-moved');
  });

  const shapes = [['rect', 'Rectangle'], ['roundRect', 'Rounded Rectangle'], ['ellipse', 'Ellipse'], ['polygon', 'Polygon'], ['star', 'Star'], ['line', 'Line'], ['customShape', 'Custom Shape']];
  await H.step('shapes: draw every shape type by drag (Shift on two of them)', async () => {
    for (const [i, [id]] of shapes.entries()) {
      await H.tool(id);
      const x = 150 + (i % 4) * 420, y = 520 + Math.floor(i / 4) * 280;
      await H.dragDoc([[x, y], [x + 300, y + 200]], { mods: i === 2 || i === 4 ? ['Shift'] : [], steps: 8 });
    }
    const st = await H.state();
    const kinds = await H.ev(() => Gesso.app.doc.allLayers().filter((l) => l.type === 'shape').map((l) => [l.shape.kind, Math.round(l.shape.w), Math.round(l.shape.h)]));
    console.log('     shapes', JSON.stringify(kinds));
    assert(kinds.length === 7, 'count ' + kinds.length);
    const ell = kinds.find((k) => k[0] === 'ellipse'); assert(ell[1] === ell[2], 'shift constrain ellipse');
    await H.shot('s5-05-shapes');
  });

  await H.step('shapes: change fill & stroke in the options bar for the active shape', async () => {
    await page.locator('.layer-row', { hasText: 'Star' }).click();
    await H.tool('star');
    const chips = page.locator('#optionsbar .color-chip');
    await chips.nth(0).click(); await H.wait(150);
    let hex = page.locator('.gesso-dialog .cp .hex-input').last(); await hex.fill('ffcc00'); await hex.press('Enter');
    await page.locator('#optionsbar .opt-check', { hasText: 'Stroke' }).locator('input').check();
    const w = page.locator('#optionsbar .opt-num', { has: page.locator('.opt-label', { hasText: /^W$/ }) }).locator('input');
    await w.fill('8'); await w.press('Enter');
    await H.wait(150);
    const s = await H.ev(() => { const l = Gesso.app.doc.activeLayer(); return [l.name, l.shape.fill.color, l.shape.stroke.enabled, l.shape.stroke.width]; });
    assert(s[1] === '#ffcc00' && s[2] && s[3] === 8, JSON.stringify(s));
    await H.shot('s5-06-shape-options');
  });

  await H.step('shapes: Properties panel edits star points', async () => {
    const pts = page.locator('.panel-properties .field', { hasText: 'Points' }).locator('input[type=number]');
    await pts.fill('8'); await pts.press('Enter');
    await H.wait(150);
    const n = await H.ev(() => Gesso.app.doc.activeLayer().shape.points);
    assert(n === 8, 'points ' + n);
    await H.shot('s5-07-star-points');
  });

  await H.step('after Enter in a Properties field, Ctrl+Z undoes the document change (focus returns)', async () => {
    const pts = page.locator('.panel-properties .field', { hasText: 'Points' }).locator('input[type=number]');
    await pts.fill('9'); await pts.press('Enter');
    await H.wait(150);
    assert((await H.ev(() => Gesso.app.doc.activeLayer().shape.points)) === 9, 'set 9');
    await page.keyboard.press('Control+z');
    await H.wait(150);
    const n = await H.ev(() => Gesso.app.doc.activeLayer().shape.points);
    assert(n === 8, 'Ctrl+Z after Enter should undo to 8, got ' + n);
  });

  await H.step('shapes: options-bar Points field follows and edits the active star', async () => {
    await H.wait(400);
    const inp = page.locator('#optionsbar .opt-num', { has: page.locator('.opt-label', { hasText: 'Points' }) }).locator('input');
    assert((await inp.inputValue()) === '8', 'options bar shows ' + (await inp.inputValue()));
    await inp.fill('12'); await inp.press('Enter');
    await H.wait(150);
    const n = await H.ev(() => Gesso.app.doc.activeLayer().shape.points);
    assert(n === 12, 'points ' + n);
    const def = await H.ev(() => Gesso.Tools.byId.star.opts.points);
    assert(def !== 12, 'tool default should be untouched');
  });

  await H.step('pen: clicks + click-drag curve, close on first point', async () => {
    await H.key('p');
    await H.clickDoc(1300, 150);
    await H.dragDoc([[1600, 150], [1700, 250]], { steps: 6 });
    await H.clickDoc(1600, 420);
    await H.clickDoc(1300, 150);
    await H.wait(100);
    const p = await H.ev(() => { const d = Gesso.app.doc; const p = d.paths.find((q) => q.id === d.activePathId); return p && p.path.subpaths.map((s) => [s.closed, s.nodes.length]); });
    assert(p && p[0][0] === true && p[0][1] === 3, JSON.stringify(p));
    await H.shot('s5-08-pen');
  });

  await H.step('node edit with A: drag an anchor', async () => {
    await H.key('a');
    await H.dragDoc([[1600, 420], [1650, 480]], { steps: 6 });
    const n = await H.ev(() => { const d = Gesso.app.doc; const p = d.paths.find((q) => q.id === d.activePathId); return p.path.subpaths[0].nodes[2]; });
    assert(Math.abs(n.x - 1650) < 2 && Math.abs(n.y - 480) < 2, JSON.stringify(n));
    await H.shot('s5-09-node-edit');
  });

  await H.step('path → selection from the Paths panel / pen options', async () => {
    await H.key('p');
    await page.locator('#optionsbar button', { hasText: 'Selection' }).click();
    await H.wait(150);
    const st = await H.state();
    assert(st.sel && st.sel.x >= 1290 && st.sel.w > 300, JSON.stringify(st.sel));
    await H.shot('s5-10-path-selection');
  });

  await H.finish();
})();
