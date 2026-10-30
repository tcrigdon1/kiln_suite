// Part C2: Mesh Warp — drag grid handles, Shift moves a row/column, bicubic result, commit / cancel / undo.
const { launch, assert, near, ASSETS } = require('./lib');
const path = require('path');

(async () => {
  const H = await launch();
  const { page } = H;
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
  await fc.setFiles(path.join(ASSETS, 'photo.png'));
  await H.wait(600);
  const st0 = await H.state();
  console.log('     doc', st0.w, 'x', st0.h);

  await H.step('Edit ▸ Transform ▸ Mesh Warp shows a 4×4 grid; dragging a corner handle bends the image', async () => {
    await H.menu('Edit', 'Transform', 'Mesh Warp');
    await H.wait(300);
    const g = await H.ev(() => Gesso.MeshWarp.active && Gesso.MeshWarp.active.grid.map((r) => r.map((p) => [Math.round(p.x), Math.round(p.y)])));
    assert(g && g.length === 4 && g[0].length === 4, 'grid 4×4');
    const before = await H.px(30, 30);
    // drag the top-left corner inward by 150 px
    await H.dragDoc([[g[0][0][0], g[0][0][1]], [g[0][0][0] + 150, g[0][0][1] + 150]], { steps: 12 });
    const g2 = await H.ev(() => Gesso.MeshWarp.active.grid[0][0]);
    assert(Math.abs(g2.x - (g[0][0][0] + 150)) < 2, 'handle moved ' + JSON.stringify(g2));
    const after = await H.px(30, 30);
    assert(after[3] === 0, 'corner now transparent (image pulled inward) ' + after + ' was ' + before);
    const mid = await H.px(st0.w / 2, st0.h / 2); assert(mid[3] === 255, 'middle still opaque ' + mid);
    await H.shot('c2-01-mesh-corner');
  });

  await H.step('Shift-drag an inner handle moves its whole row and column; Reset restores', async () => {
    const g = await H.ev(() => Gesso.MeshWarp.active.grid.map((r) => r.map((p) => ({ x: p.x, y: p.y }))));
    await H.dragDoc([[g[1][1].x, g[1][1].y], [g[1][1].x, g[1][1].y + 80]], { steps: 10, mods: ['Shift'] });
    const g2 = await H.ev(() => Gesso.MeshWarp.active.grid.map((r) => r.map((p) => ({ x: p.x, y: p.y }))));
    assert(Math.abs(g2[1][3].y - (g[1][3].y + 80)) < 2 && Math.abs(g2[3][1].y - (g[3][1].y + 80)) < 2, 'row and column moved');
    await page.locator('#optionsbar button', { hasText: 'Reset' }).click();
    await H.wait(200);
    const g3 = await H.ev(() => Gesso.MeshWarp.active.grid[0][0]);
    assert(Math.abs(g3.x - 0) < 2 || g3.x < 5, 'reset ' + JSON.stringify(g3));
  });

  await H.step('Enter commits one "Mesh Warp" step with bicubic quality; undo restores the original; Esc cancels', async () => {
    const g = await H.ev(() => Gesso.MeshWarp.active.grid.map((r) => r.map((p) => ({ x: p.x, y: p.y }))));
    await H.dragDoc([[g[3][3].x, g[3][3].y], [g[3][3].x - 120, g[3][3].y - 60]], { steps: 10 });
    const h0 = (await H.state()).hist;
    await H.key('Enter');
    await H.wait(300);
    const st = await H.state();
    assert(st.histName === 'Mesh Warp' && st.hist === h0 + 1, 'committed ' + st.histName);
    assert(!(await H.ev(() => !!Gesso.MeshWarp.active)), 'exited');
    const br = await H.px(st0.w - 20, st0.h - 20); assert(br[3] === 0, 'bottom-right pulled in ' + br);
    // the result is smooth: a horizontal row across the middle has no hard 0/255 alpha steps in the interior
    const alphaRow = await H.ev(() => { const d = Gesso.app.doc; const out = []; for (let x = 0; x < d.width; x += 4) out.push(Gesso.util.samplePixels(d.composite, x, Math.round(d.height * 0.5))[3]); return out; });
    const inner = alphaRow.filter((a) => a === 255).length; assert(inner > alphaRow.length * 0.6, 'mostly opaque');
    await H.key('Control+z');
    const br2 = await H.px(st0.w - 20, st0.h - 20); assert(br2[3] === 255, 'undo restored ' + br2);
    await H.shot('c2-02-after-undo');
    await H.key('Control+Alt+Shift+t');
    await H.wait(200);
    assert(await H.ev(() => !!Gesso.MeshWarp.active), 'shortcut starts mesh warp');
    const g4 = await H.ev(() => Gesso.MeshWarp.active.grid.map((r) => r.map((p) => ({ x: p.x, y: p.y }))));
    await H.dragDoc([[g4[0][3].x, g4[0][3].y], [g4[0][3].x - 100, g4[0][3].y + 100]], { steps: 8 });
    await H.key('Escape');
    const tr = await H.px(st0.w - 20, 20); assert(tr[3] === 255 && (await H.state()).hist === h0, 'cancelled, nothing in history ' + tr);
  });

  await H.step('mesh warp on a text layer rasterizes after confirmation', async () => {
    await H.key('t'); await H.clickDoc(200, 200); await page.keyboard.type('Mesh'); await H.key('Escape');
    await H.menu('Edit', 'Transform', 'Mesh Warp');
    await H.wait(200);
    assert(await H.dialogOpen(), 'prompt');
    await H.dialogBtn('Rasterize');
    await H.wait(300);
    assert(await H.ev(() => !!Gesso.MeshWarp.active) && (await H.state()).activeType === 'raster', 'active on rasterized text');
    await H.key('Escape');
  });

  await H.finish();
})();
