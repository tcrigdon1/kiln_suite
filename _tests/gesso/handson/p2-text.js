// Part 2 hands-on: text on a circle / on a path, text rotation field; save/reload.
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
  const text = () => H.ev(() => JSON.parse(JSON.stringify(Gesso.app.doc.activeLayer().text)));
  const glyphs = () => H.ev(() => { const t = Gesso.app.doc.activeLayer().text; const lay = Gesso.Text.layout(t); return lay.curve ? lay.curve.glyphs.map((g) => ({ ch: g.ch, x: g.x, y: g.y, rot: g.rot })) : null; });

  await H.step('type a text layer, then Curve: Circle in Properties', async () => {
    await H.key('t');
    await H.clickDoc(300, 300);
    await page.keyboard.type('STRATA WATCH CO');
    await page.keyboard.press('Control+Enter');
    await H.wait(150);
    const before = await H.ev(() => Gesso.layerBounds(Gesso.app.doc.activeLayer(), Gesso.app.doc));
    await page.locator('.dock-tabs .tab[title="Properties"]').first().click();
    await H.wait(200);
    await field(props.locator('.curve-ui'), 'Curve').locator('select').selectOption('circle');
    await H.wait(300);
    const t = await text();
    assert(t.curve && t.curve.type === 'circle' && t.curve.radius > 50, JSON.stringify(t.curve));
    const g = await glyphs();
    assert(g && g.length === 15, 'glyphs ' + (g && g.length));
    // every glyph's baseline sits on the circle
    for (const q of g) { const r = Math.hypot(q.x - t.x, q.y - t.y); assert(Math.abs(r - t.curve.radius) < 0.01, 'off circle ' + r); }
    // and the arc stays roughly where the text was
    const after = await H.ev(() => Gesso.layerBounds(Gesso.app.doc.activeLayer(), Gesso.app.doc));
    assert(Math.abs(after.x + after.w / 2 - (before.x + before.w / 2)) < 5 && Math.abs(after.y - before.y) < 40, 'jumped ' + JSON.stringify([before, after]));
    await H.shot('p2t-01-circle');
  });

  await H.step('radius / start angle / centre / inside direction', async () => {
    const r = field(props.locator('.curve-ui'), 'Radius').locator('input[type=number]');
    await r.fill('320'); await r.press('Enter'); await H.wait(150);
    const cx = field(props.locator('.curve-ui'), 'Centre X').locator('input'); await cx.fill('540'); await cx.press('Enter'); await H.wait(150);
    const cy = field(props.locator('.curve-ui'), 'Centre Y').locator('input'); await cy.fill('540'); await cy.press('Enter'); await H.wait(150);
    let t = await text();
    assert(t.curve.radius === 320 && t.x === 540 && t.y === 540, JSON.stringify([t.curve, t.x, t.y]));
    // centred on 12 o'clock: middle glyph straight above the centre
    let g = await glyphs();
    const mid = g[7];
    assert(Math.abs(mid.x - 540) < 25 && mid.y < 540 - 300, 'centred at top ' + JSON.stringify(mid));
    await H.shot('p2t-02-radius');
    await field(props.locator('.curve-ui'), 'Direction').locator('select').selectOption('inside');
    await H.wait(200);
    const st = field(props.locator('.curve-ui'), 'Start angle').locator('input[type=number]');
    await st.fill('180'); await st.press('Enter'); await H.wait(200);
    g = await glyphs();
    t = await text();
    // bottom arc, reading left→right (first glyph left of the last), upright (rotation ≈ 0 at the bottom)
    assert(g[0].x < g[g.length - 1].x && g[7].y > 540 + 300 && Math.abs(Math.cos(g[7].rot) - 1) < 0.02, 'inside bottom ' + JSON.stringify([g[0], g[7]]));
    await H.shot('p2t-03-inside-bottom');
  });

  await H.step('re-edit curved text on canvas (double-click), type, commit — still on the circle', async () => {
    const g = await glyphs();
    await H.key('t');
    await H.clickDoc(g[3].x - Math.sin(g[3].rot) * 20, g[3].y + Math.cos(g[3].rot) * -20, { count: 2 });
    await H.wait(200);
    assert(await H.ev(() => !!Gesso.TextTool.edit), 'editing');
    await H.shot('p2t-04-editing-curve');
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' 1924');
    await page.keyboard.press('Escape');
    await H.wait(150);
    const t = await text();
    assert(t.text === 'STRATA WATCH CO 1924' && t.curve.type === 'circle', JSON.stringify(t.text));
    await H.shot('p2t-05-edited');
  });

  await H.step('text tool click in the empty middle of a text ring creates new text (does not grab the ring)', async () => {
    await H.key('t');
    await H.clickDoc(540, 540);
    const edit = await H.ev(() => Gesso.TextTool.edit && Gesso.TextTool.edit.layer.text.text);
    assert(edit === '', 'should start a new empty text, got ' + JSON.stringify(edit));
    await page.keyboard.press('Escape');
    await H.wait(150);
    await page.locator('.layer-row', { hasText: 'STRATA WATCH CO' }).click();
    await page.locator('.dock-tabs .tab[title="Properties"]').first().click();
    await H.wait(200);
  });

  await H.step('tracking & size apply glyph-by-glyph (arc grows)', async () => {
    const g0 = await glyphs();
    const arc = (g) => { let a = 0; for (let i = 1; i < g.length; i++) { let d = g[i].rot - g[i - 1].rot; d = Math.atan2(Math.sin(d), Math.cos(d)); a += Math.abs(d); } return a; };
    const span0 = arc(g0);
    const tr = field(props, 'Tracking').locator('input[type=number]'); await tr.fill('200'); await tr.press('Enter');
    await H.wait(200);
    const g1 = await glyphs();
    const span1 = arc(g1);
    assert(span1 > span0 * 1.15, 'tracking widened the arc ' + span0 + ' → ' + span1);
  });

  await H.step('text Rotation field rotates the (curved) text about its centre', async () => {
    const rf = field(props.locator('.prop-section').first(), 'Rotation').locator('input');
    await rf.fill('20'); await rf.press('Enter');
    await H.wait(200);
    const t = await text();
    const rot = await H.ev(() => Gesso.Affine.decompose(Gesso.app.doc.activeLayer().text.matrix).rot * 180 / Math.PI);
    assert(Math.abs(rot - 20) < 0.01, 'rot ' + rot);
    await H.shot('p2t-06-rotated');
    await rf.fill('0'); await rf.press('Enter');
    await H.wait(200);
    assert(!(await text()).matrix, 'rotation 0 clears the matrix');
  });

  await H.step('text on a path: draw a pen path, then Curve: Path', async () => {
    await H.key('p');
    await H.clickDoc(150, 900);
    await H.dragDoc([[540, 760], [700, 760]], { steps: 6 });
    await H.clickDoc(930, 900);
    await H.key('Enter');
    // a new straight text layer
    await H.key('t');
    await H.clickDoc(200, 1000);
    await page.keyboard.type('along the path');
    await page.keyboard.press('Control+Enter');
    await H.wait(200);
    await page.locator('.dock-tabs .tab[title="Properties"]').first().click();
    await H.wait(200);
    await field(props.locator('.curve-ui'), 'Curve').locator('select').selectOption('path');
    await H.wait(300);
    const t = await text();
    assert(t.curve && t.curve.type === 'path', JSON.stringify(t.curve && t.curve.type));
    const g = await glyphs();
    assert(g[0].x < 300 && g[0].y > 800 && g[Math.floor(g.length / 2)].y < g[0].y, 'follows the arch ' + JSON.stringify([g[0], g[7]]));
    await H.shot('p2t-07-on-path');
    const so = field(props.locator('.curve-ui'), 'Start offset').locator('input[type=number]'); await so.fill('120'); await so.press('Enter');
    await H.wait(200);
    const g2 = await glyphs();
    assert(g2[0].x > g[0].x + 50, 'start offset moved text along the path');
    await props.locator('.curve-ui .check-row', { hasText: 'Flip' }).locator('input').check();
    await H.wait(200);
    await H.shot('p2t-08-path-flipped');
  });

  await H.step('back to straight restores the original position', async () => {
    await field(props.locator('.curve-ui'), 'Curve').locator('select').selectOption('none');
    await H.wait(250);
    const t = await text();
    assert(!t.curve && Math.abs(t.x - 200) < 2, JSON.stringify([t.x, t.y]));
  });

  await H.step('save & reopen keeps curved text', async () => {
    const snap = await H.ev(() => Gesso.app.doc.allLayers().filter((l) => l.type === 'text').map((l) => JSON.stringify(l.text)));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
    const f = path.join(DL, 'p2-text.kgesso'); await dl.saveAs(f);
    await H.wait(300);
    const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15000 }), H.menu('File', 'Open…')]);
    await fc.setFiles(f);
    await H.wait(1000);
    const snap2 = await H.ev(() => Gesso.app.doc.allLayers().filter((l) => l.type === 'text').map((l) => JSON.stringify(l.text)));
    assert(JSON.stringify(snap) === JSON.stringify(snap2), 'text params differ');
    await H.shot('p2t-09-reloaded');
  });

  await H.finish();
})();
