// Breaking attempts: structural commands during live sessions, tool switch mid-stroke, Esc in every modal
// tool, window resize mid-transform, pen pressure, HiDPI viewport, paste on a locked layer, same file twice,
// closing a document with a modeless dialog open, zero-size shape, huge brush.
const { launch, assert, near, ASSETS } = require('./lib');
const path = require('path');

(async () => {
  const H = await launch();
  const { page } = H;
  await H.ev(() => Gesso.App.createDoc({ name: 'Sess', w: 600, h: 400, dpi: 72, bg: 'white' }));
  await H.wait(200);

  await H.step('Layer ▸ Delete Layer from the menu during Free Transform commits the transform first; undo brings the layer back', async () => {
    await H.menu('Layer', 'New', 'New Layer');
    await H.key('b');
    await H.ev(() => { const o = Gesso.Tools.byId.brush.opts; o.size = 40; o.opacity = 100; o.pressureSize = false; Gesso.App.setFg('#cc2222'); });
    await H.dragDoc([[100, 100], [300, 100]]);
    await H.key('Control+t');
    await H.wait(100);
    assert(await H.ev(() => !!Gesso.Transform.active), 'transform live');
    await H.menu('Layer', 'Delete Layer');
    await H.wait(150);
    const st = await H.state();
    assert(!(await H.ev(() => !!Gesso.Transform.active)), 'transform ended');
    assert(st.layers.length === 1 && st.active === 'Background', 'layer deleted ' + JSON.stringify(st.layers.map((l) => l.name)));
    await H.key('Control+z');
    const st2 = await H.state();
    assert(st2.layers.length === 2, 'undo restored the layer');
    const p = await H.px(200, 100); assert(p[0] > 150 && p[1] < 100, 'its pixels are intact ' + p);
  });

  await H.step('Deleting the active layer (panel trash button) while editing text commits the text first — no stale editor, no errors', async () => {
    await H.key('t');
    await H.clickDoc(100, 250);
    await page.keyboard.type('Hello');
    await H.wait(100);
    assert(await H.ev(() => !!Gesso.TextTool.edit), 'editing');
    await page.locator('.layers-bottom .icon-btn').last().click(); // trash
    await H.wait(200);
    assert(!(await H.ev(() => !!Gesso.TextTool.edit)), 'edit ended');
    assert(!(await H.ev(() => document.querySelector('.text-ime'))), 'hidden textarea removed');
    const st = await H.state(); assert(!st.layers.some((l) => l.type === 'text'), 'text layer gone');
    await H.key('Control+z');
    const st2 = await H.state(); assert(st2.layers.some((l) => l.type === 'text' && l.name === 'Hello'), 'undo brings the committed text back ' + JSON.stringify(st2.layers.map((l) => l.name)));
    await H.key('Control+z'); // undo the text creation
    await H.key('Escape');
  });

  await H.step('Pressing a tool letter in the middle of a brush stroke does not switch tools; the stroke is one history entry', async () => {
    await H.ev(() => { const d = Gesso.app.doc; d.setActive(d.layers[1].id); });
    await H.key('b');
    const h0 = (await H.state()).hist;
    const [a, b] = await H.pt(100, 300), [c, e] = await H.pt(400, 300);
    await page.mouse.move(a, b); await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(a + ((c - a) * i) / 10, b);
    await page.keyboard.press('e'); await page.keyboard.press('v');
    for (let i = 1; i <= 10; i++) await page.mouse.move(c, b + i * 3);
    await page.mouse.up();
    await H.wait(150);
    const st = await H.state();
    assert(st.tool === 'brush', 'still the brush: ' + st.tool);
    assert(st.hist === h0 + 1 && st.histName === 'Brush', 'one Brush entry ' + st.histName);
    const p = await H.px(400, 325); assert(p[0] > 150 && p[1] < 100, 'second half of the stroke painted ' + p);
    await H.key('Control+z');
    const p2 = await H.px(400, 325); assert(p2[0] > 240 && p2[1] > 240, 'undo removed the whole stroke ' + p2);
  });

  await H.step('Esc cancels: marquee drag, crop box, polygon lasso, pen path, transform, mesh warp, text', async () => {
    await H.key('m');
    const [a, b] = await H.pt(50, 50), [c, e] = await H.pt(200, 200);
    await page.mouse.move(a, b); await page.mouse.down(); await page.mouse.move(c, e, { steps: 5 });
    await page.keyboard.press('Escape'); await page.mouse.up(); await H.wait(100);
    assert(!(await H.state()).sel, 'marquee cancelled by Esc');
    await H.key('c');
    await H.dragDoc([[50, 50], [300, 300]]);
    await H.key('Escape');
    const crop = await H.ev(() => Gesso.Tools.byId.crop.rect);
    assert(crop.w === 600 && crop.h === 400, 'crop box reset ' + JSON.stringify(crop));
    await H.tool('polyLasso');
    await H.clickDoc(50, 50); await H.clickDoc(200, 50); await H.clickDoc(200, 200);
    await H.key('Escape');
    assert(!(await H.ev(() => !!Gesso.Tools.byId.polyLasso.pts)), 'poly lasso cancelled');
    await H.key('p');
    await H.clickDoc(50, 350); await H.clickDoc(150, 380);
    await H.key('Escape');
    assert(!(await H.ev(() => !!Gesso.Tools.byId.pen.cur)), 'pen finished');
    await H.ev(() => { const d = Gesso.app.doc; d.commit('x', () => { d.paths = []; d.activePathId = null; }); });
    await H.key('Control+t'); await H.wait(100);
    await H.ev(() => { const st = Gesso.Transform.active; st.corners = st.corners.map((p) => ({ x: p.x + 50, y: p.y })); Gesso.Transform.render(); });
    await H.key('Escape');
    assert(!(await H.ev(() => !!Gesso.Transform.active)), 'transform cancelled');
    const p = await H.px(100, 100); assert(p[0] > 150 && p[1] < 100, 'pixels back in place after cancel ' + p);
    await H.menu('Edit', 'Transform', 'Mesh Warp (grid)');
    await H.wait(200);
    assert(await H.ev(() => !!Gesso.MeshWarp.active), 'mesh warp live');
    await H.key('Escape');
    assert(!(await H.ev(() => !!Gesso.MeshWarp.active)), 'mesh warp cancelled');
    await H.key('t'); await H.clickDoc(300, 350); await page.keyboard.type('x'); await H.key('Escape');
    assert(!(await H.ev(() => !!Gesso.TextTool.edit)), 'text committed by Esc');
    await H.key('Control+z');
    await H.shot('a6-01-after-escapes');
  });

  await H.step('Resizing the window in the middle of a Free Transform keeps the box consistent; commit works', async () => {
    await H.key('v');
    await H.key('Control+t'); await H.wait(100);
    const [hx, hy] = await H.ev(() => { const st = Gesso.Transform.active; const c = st.corners[2]; return Gesso.View.toScreen(c.x, c.y); });
    const r = await H.ev(() => { const r = Gesso.View.canvas.getBoundingClientRect(); return [r.left, r.top]; });
    await page.mouse.move(r[0] + hx, r[1] + hy); await page.mouse.down(); await page.mouse.move(r[0] + hx + 40, r[1] + hy + 40, { steps: 5 });
    await page.setViewportSize({ width: 1366, height: 768 });
    await H.wait(200);
    await page.mouse.move(r[0] + hx + 60, r[1] + hy + 60, { steps: 3 }); await page.mouse.up();
    await H.wait(100);
    const corners = await H.ev(() => Gesso.Transform.active.corners.map((p) => [Math.round(p.x), Math.round(p.y)]));
    assert(corners.every((c) => isFinite(c[0]) && isFinite(c[1])), 'corners finite ' + JSON.stringify(corners));
    await H.key('Enter');
    await H.wait(100);
    assert(!(await H.ev(() => !!Gesso.Transform.active)), 'committed');
    await H.shot('a6-02-1366-after-resize');
    await H.key('Control+z');
    await page.setViewportSize({ width: 1600, height: 900 });
    await H.wait(200);
  });

  await H.step('Pen input: pressure changes the stroke width (pressure size on); eraser-end switches to the Eraser', async () => {
    await H.key('b');
    await H.ev(() => { const o = Gesso.Tools.byId.brush.opts; o.size = 60; o.pressureSize = true; o.hardness = 1; o.smoothing = 0; Gesso.App.setFg('#2222cc'); });
    const dispatch = async (type, x, y, pressure, buttons, extra) => {
      const [px, py] = await H.pt(x, y);
      await page.evaluate(([type, px, py, pressure, buttons, extra]) => {
        const c = Gesso.View.canvas;
        c.dispatchEvent(new PointerEvent(type, Object.assign({ pointerId: 7, pointerType: 'pen', isPrimary: true, clientX: px, clientY: py, pressure, buttons, button: type === 'pointermove' ? -1 : 0, bubbles: true, cancelable: true }, extra || {})));
      }, [type, px, py, pressure, buttons, extra]);
    };
    await dispatch('pointerdown', 100, 150, 0.15, 1);
    for (let i = 1; i <= 20; i++) await dispatch('pointermove', 100 + i * 15, 150, 0.15 + (0.85 * i) / 20, 1);
    await dispatch('pointerup', 400, 150, 0, 0);
    await H.wait(150);
    // width at the start (low pressure) vs the end (full pressure)
    const widthAt = async (x) => { let n = 0; for (let y = 100; y < 200; y++) { const p = await H.lpx(x, y); if (p[3] > 128 && p[2] > 150 && p[0] < 100) n++; } return n; };
    const w0 = await widthAt(130), w1 = await widthAt(380);
    assert(w0 > 2 && w0 < 30 && w1 > 45, 'thin start (' + w0 + ') → thick end (' + w1 + ')');
    // eraser end of the stylus (buttons bit 32)
    await dispatch('pointerdown', 380, 150, 0.9, 32);
    assert((await H.state()).tool === 'eraser', 'temporarily the eraser');
    for (let i = 1; i <= 5; i++) await dispatch('pointermove', 380, 150 + i * 2, 0.9, 32);
    await dispatch('pointerup', 380, 160, 0, 0);
    await H.wait(150);
    assert((await H.state()).tool === 'brush', 'back to the brush after the stroke');
    const erased = await H.lpx(380, 150); assert(erased[3] < 128, 'erased at the pen eraser spot ' + erased);
    await H.shot('a6-03-pen-pressure');
  });

  await H.step('Paste while the active layer is locked creates a new layer above it; the locked layer is untouched', async () => {
    await H.ev(() => { const d = Gesso.app.doc; d.commit('lock', () => { d.activeLayer().locks.all = true; }); });
    await H.ev(() => { const d = Gesso.app.doc; const sel = Gesso.Sel.make(Gesso.Sel.rectMask(d.width, d.height, 100, 100, 100, 100), d.width, d.height); d.setSelection(sel, 'sel'); });
    await H.key('Control+c');
    await H.wait(200);
    const n0 = (await H.state()).layers.length;
    await H.menu('Edit', 'Paste');
    await H.wait(300);
    const st = await H.state();
    assert(st.layers.length === n0 + 1 && st.active === 'Pasted Layer', 'pasted as a new layer ' + JSON.stringify(st.layers.map((l) => l.name)));
    await H.ev(() => { const d = Gesso.app.doc; d.commit('unlock', () => d.allLayers().forEach((l) => (l.locks.all = false))); });
  });

  await H.step('Opening the same image file twice gives two independent documents', async () => {
    for (let i = 0; i < 2; i++) { const fc = page.waitForEvent('filechooser'); await H.key('Control+o'); await (await fc).setFiles(path.join(ASSETS, 'photo.png')); await H.wait(400); }
    const names = await H.ev(() => Gesso.app.docs.map((d) => d.name));
    assert(names.filter((n) => n === 'photo').length === 2, 'two photo docs ' + names);
    await H.key('b'); await H.dragDoc([[50, 50], [150, 50]]);
    const other = await H.ev(() => { const ds = Gesso.app.docs.filter((d) => d.name === 'photo'); return ds[0].history.index + ':' + ds[1].history.index; });
    assert(other === '0:1', 'only the active copy changed ' + other);
    await H.key('Control+w'); await H.dialogBtn("Don’t Save"); await H.wait(150);
    await H.key('Control+w'); await H.wait(150);
  });

  await H.step('Closing the document while the modeless Color Range dialog is open closes the dialog; no errors', async () => {
    await H.menu('Select', 'Color Range…');
    await H.wait(200);
    assert(await H.dialogOpen(), 'dialog open');
    await H.ev(() => Gesso.App.createDoc({ name: 'Other', w: 300, h: 200, dpi: 72, bg: 'white' }));
    await H.wait(200);
    assert(!(await H.dialogOpen()), 'dialog dismissed on document switch');
    assert(!(await H.ev(() => !!Gesso.app.pickHook)), 'sampling hook cleared');
    await H.key('Control+w'); await H.wait(150);
  });

  await H.step('Dragging a group onto itself / into its own child is refused; zero-size shape click opens the size dialog and Esc leaves no layer', async () => {
    await H.ev(() => { const d = Gesso.app.doc; d.commit('grp', () => { const g = Gesso.Layers.group(d, 'G'); const inner = Gesso.Layers.group(d, 'Inner'); g.children.push(inner); d.layers.push(g); d.activeId = g.id; d.selectedIds = new Set([g.id]); }); });
    await H.wait(150);
    const rowG = page.locator('.layer-row', { hasText: 'G' }).first(), rowInner = page.locator('.layer-row', { hasText: 'Inner' }).first();
    const bb = await rowInner.boundingBox();
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await rowG.dispatchEvent('dragstart', { dataTransfer: dt });
    await rowInner.dispatchEvent('dragover', { dataTransfer: dt, clientX: bb.x + 40, clientY: bb.y + bb.height / 2 });
    await rowInner.dispatchEvent('drop', { dataTransfer: dt, clientX: bb.x + 40, clientY: bb.y + bb.height / 2 });
    await rowG.dispatchEvent('dragend', { dataTransfer: dt });
    await H.wait(150);
    const st = await H.state();
    assert(st.layers.find((l) => l.name === 'G').depth === 0 && st.layers.find((l) => l.name === 'Inner').depth === 1, 'structure unchanged ' + JSON.stringify(st.layers.map((l) => l.name + '@' + l.depth)));
    const n0 = st.layers.length;
    await H.tool('rect');
    await H.clickDoc(300, 300);
    await H.wait(150);
    assert(await H.dialogOpen(), 'size dialog for a click without drag');
    await H.key('Escape');
    assert((await H.state()).layers.length === n0, 'no layer created');
  });

  await H.step('A 2500-px brush stroke on the small document finishes quickly and stays inside the document', async () => {
    await H.ev(() => { const d = Gesso.app.doc; d.setActive(d.layers[1].id); });
    await H.key('b');
    await H.ev(() => { const o = Gesso.Tools.byId.brush.opts; o.size = 2500; o.pressureSize = false; o.hardness = 0.5; });
    const t0 = Date.now();
    await H.dragDoc([[100, 200], [500, 200]], { steps: 6 });
    const ms = Date.now() - t0;
    const li = await H.ev(() => { const c = Gesso.app.doc.activeLayer().canvas; return [c.width, c.height, c.ox || 0, c.oy || 0]; });
    assert(li[0] <= 600 && li[1] <= 400, 'canvas stayed document-sized ' + li);
    assert(ms < 6000, 'stroke took ' + ms + ' ms');
    await H.key('Control+z');
  });

  await H.finish();
})();
