// C5 — Layer Comps: capture, switch (undoable), cycle with shortcuts, persist in the project, export all.
const { launch, assert } = require('./lib');
const path = require('path');
const fs = require('fs');

(async () => {
  const H = await launch();
  const { page } = H;
  await H.ev(() => {
    const d = Gesso.App.createDoc({ name: 'Comps', w: 500, h: 300, dpi: 72, bg: 'white' });
    const mk = (name, color, x, y) => { const c = Gesso.util.createCanvas(100, 100, x, y); const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 100, 100); return Gesso.Layers.raster(d, name, c); };
    d.commit('setup', () => { d.layers.push(mk('Red', '#d33', 50, 100), mk('Blue', '#36c', 300, 100)); d.activeId = d.layers[2].id; d.selectedIds = new Set([d.activeId]); });
  });
  await H.wait(200);

  await H.step('Comp A = Blue hidden; Comp B = Blue visible, moved and with a drop shadow; the panel lists them', async () => {
    await H.ev(() => { const d = Gesso.app.doc; d.commit('hide', () => { d.layers[2].visible = false; }); });
    await H.menu('Layer', 'Layer Comps', 'New Layer Comp…');
    await page.locator('.gesso-dialog input').fill('A hidden'); await H.dialogBtn('OK');
    await H.wait(150);
    await H.ev(() => { const d = Gesso.app.doc; d.commit('show', () => { d.layers[2].visible = true; }); });
    await H.key('v');
    await H.dragDoc([[350, 150], [400, 170]], { steps: 8 });
    await H.ev(() => { const d = Gesso.app.doc; d.commit('fx', () => { const l = d.layers[2]; l.effects = { enabled: true, items: { dropShadow: Gesso.Effects.defaults('dropShadow') } }; l.version++; }); });
    await H.menu('Layer', 'Layer Comps', 'New Layer Comp…');
    await page.locator('.gesso-dialog input').fill('B moved'); await H.dialogBtn('OK');
    await H.wait(150);
    const names = await H.ev(() => Gesso.app.doc.comps.map((c) => c.name));
    assert(names.join() === 'A hidden,B moved', 'comps ' + names);
    assert((await page.locator('.comp-row').count()) === 2, 'panel shows both');
    await H.shot('c7-01-comps');
  });

  await H.step('Clicking comp A hides and restores the layer position and effects; B brings everything back; undo works', async () => {
    await page.locator('.comp-row', { hasText: 'A hidden' }).click();
    await H.wait(150);
    let st = await H.ev(() => { const l = Gesso.app.doc.layers[2]; return { vis: l.visible, ox: l.canvas.ox, fx: !!l.effects }; });
    assert(!st.vis && st.ox === 300 && !st.fx, 'comp A applied ' + JSON.stringify(st));
    let p = await H.px(350, 150); assert(p[0] > 240 && p[2] > 240, 'blue hidden ' + p);
    await page.locator('.comp-row', { hasText: 'B moved' }).click();
    await H.wait(150);
    st = await H.ev(() => { const l = Gesso.app.doc.layers[2]; return { vis: l.visible, ox: l.canvas.ox, fx: !!l.effects }; });
    assert(st.vis && st.ox === 350 && st.fx, 'comp B applied ' + JSON.stringify(st));
    p = await H.px(420, 170); assert(p[2] > 150 && p[0] < 100, 'blue at the moved position ' + p);
    await H.key('Control+z');
    st = await H.ev(() => { const l = Gesso.app.doc.layers[2]; return { vis: l.visible, act: Gesso.app.doc.activeCompId }; });
    assert(!st.vis, 'undo returned to comp A state');
    assert((await H.state()).histName === 'Apply Layer Comp', 'history entry');
  });

  await H.step('Ctrl+Alt+] / [ cycle comps; Update comp records the current state', async () => {
    await H.key('Control+Alt+]');
    await H.wait(100);
    let act = await H.ev(() => Gesso.app.doc.comps.find((c) => c.id === Gesso.app.doc.activeCompId).name);
    assert(act === 'B moved', 'next → ' + act);
    await H.key('Control+Alt+[');
    act = await H.ev(() => Gesso.app.doc.comps.find((c) => c.id === Gesso.app.doc.activeCompId).name);
    assert(act === 'A hidden', 'prev → ' + act);
    await H.ev(() => { const d = Gesso.app.doc; d.commit('op', () => { d.layers[1].opacity = 0.5; d.layers[1].version++; }); });
    await H.menu('Layer', 'Layer Comps', 'Update Layer Comp');
    await H.wait(100);
    const rec = await H.ev(() => { const d = Gesso.app.doc; return d.comps[0].layers[d.layers[1].id].opacity; });
    assert(rec === 0.5, 'comp A now stores opacity 0.5');
  });

  await H.step('Comps survive save / reopen; Export Layer Comps writes one file per comp', async () => {
    const dl = page.waitForEvent('download');
    await H.key('Control+s');
    const d = await dl; const file = path.join(__dirname, 'downloads', 'c7-comps.kgesso'); await d.saveAs(file);
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert(json.comps.length === 2 && json.comps[0].name === 'A hidden', 'comps in the file');
    const fc = page.waitForEvent('filechooser');
    await H.key('Control+o');
    await (await fc).setFiles(file);
    await H.wait(500);
    assert((await H.ev(() => Gesso.app.doc.comps.length)) === 2, 'reopened with comps');
    const downloads = [];
    page.on('download', (x) => downloads.push(x.suggestedFilename()));
    await H.menu('File', 'Export Layer Comps as Files…');
    await H.wait(1500);
    assert(downloads.length === 2, 'two exports: ' + downloads.join(', '));
    // the document is back in its previous state afterwards
    assert((await H.state()).histName !== 'Apply Layer Comp', 'export left no history entries');
  });

  await H.finish();
})();
