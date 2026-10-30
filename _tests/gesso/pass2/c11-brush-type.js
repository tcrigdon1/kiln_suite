// C11 — brush upgrades (symmetry, stabilizer, colour jitter, airbrush build-up, Define Brush / Pattern,
// Pattern Stamp) and type upgrades (justify, small caps, warp presets, Convert Text to Shape), all through the UI.
const { launch, assert } = require('./lib');

(async () => {
  const H = await launch();
  const { page } = H;
  await H.ev(() => Gesso.App.createDoc({ name: 'BrushType', w: 600, h: 400, dpi: 72, bg: 'white' }));
  await H.wait(200);
  const props = page.locator('.panel-properties');
  const field = (label) => props.locator('.field, .check-row', { hasText: label }).first();

  await H.step('Brush options bar: the sliders popup holds stabilizer / symmetry; vertical symmetry mirrors a stroke', async () => {
    await H.tool('brush');
    await H.ev(() => { const o = Gesso.Tools.byId.brush.opts; o.size = 20; o.hardness = 1; o.opacity = 100; o.flow = 100; });
    await H.ev(() => Gesso.Cmd.run('layer.new'));
    await H.wait(150);
    assert((await H.state()).tool === 'brush', 'brush tool active: ' + (await H.state()).tool);
    const pop = page.locator('#optionsbar button[data-tip*="Stabilizer"]');
    assert(await pop.count(), 'popup button present');
    await pop.click(); await H.wait(150);
    const sym = page.locator('.brush-dyn .field', { hasText: 'Symmetry' }).locator('select');
    await sym.selectOption('v'); await H.wait(150);
    assert((await H.ev(() => Gesso.Tools.byId.brush.opts.symmetry)) === 'v', 'symmetry = v');
    const stab = page.locator('.brush-dyn .field', { hasText: 'Stabilizer' }).locator('input[type=range]');
    await stab.fill('40');
    assert((await H.ev(() => Gesso.Tools.byId.brush.opts.stabilize)) === 40, 'stabilizer = 40');
    await page.mouse.click(700, 500); await H.wait(100); // close popup (click on the canvas area is swallowed by the closer)
    assert(!(await page.locator('.brush-dyn').count()), 'popup closed');
    assert(await page.locator('#optionsbar .btn.on', { hasText: 'Symmetry on' }).count(), 'bar shows symmetry is on');
    await H.dragDoc([[100, 100], [220, 180]], { steps: 20 });
    let p = await H.lpx(160, 140); assert(p[3] > 200, 'stroke painted ' + p);
    p = await H.lpx(600 - 160, 140); assert(p[3] > 200, 'mirrored stroke painted ' + p);
    await H.shot('c11-01-symmetry');
    assert((await H.state()).histName.startsWith('Brush'), 'undoable: ' + (await H.state()).histName);
    await H.key('Control+z');
    await pop.click(); await H.wait(100);
    await page.locator('.brush-dyn .field', { hasText: 'Symmetry' }).locator('select').selectOption('none');
    await page.locator('.brush-dyn .field', { hasText: 'Stabilizer' }).locator('input[type=range]').fill('0');
    await page.mouse.click(700, 500); await H.wait(100);
  });

  await H.step('Colour dynamics (hue jitter) varies dab colours; airbrush build-up keeps painting while the pointer rests', async () => {
    await H.ev(() => { const o = Gesso.Tools.byId.brush.opts; o.hueJitter = 100; o.spacing = 25; Gesso.app.fg = '#ff0000'; });
    await H.dragDoc([[60, 300], [540, 300]], { steps: 40 });
    const hues = await H.ev(() => { const l = Gesso.app.doc.activeLayer(); const set = new Set(); for (let x = 70; x < 530; x += 4) { const d = Gesso.Layers.readRect(l.canvas, { x, y: 300, w: 1, h: 1 }).data; if (d[3] > 100) set.add(Math.round(d[0] / 32) + ',' + Math.round(d[1] / 32) + ',' + Math.round(d[2] / 32)); } return set.size; });
    assert(hues >= 4, 'several distinct colours along the stroke: ' + hues);
    await H.key('Control+z');
    await H.ev(() => { const o = Gesso.Tools.byId.brush.opts; o.hueJitter = 0; o.airbrush = true; o.opacity = 100; o.flow = 10; o.hardness = 0.5; o.size = 60; });
    const [px, py] = await H.pt(300, 200);
    await page.mouse.move(px, py); await page.mouse.down(); await page.mouse.move(px + 2, py + 1); await H.wait(60);
    const a0 = (await H.lpx(300, 200))[3];
    await H.wait(900);
    await page.mouse.up(); await H.wait(150);
    const a1 = (await H.lpx(300, 200))[3];
    assert(a1 > a0 + 40, 'alpha builds up while holding: ' + a0 + ' → ' + a1);
    await H.key('Control+z');
    await H.ev(() => { const o = Gesso.Tools.byId.brush.opts; o.airbrush = false; o.flow = 100; o.hardness = 1; o.size = 20; });
  });

  await H.step('Edit ▸ Define Brush from Selection creates a preset; painting with it stamps the custom tip', async () => {
    await H.ev(() => { const d = Gesso.app.doc, l = d.activeLayer(); const c = Gesso.util.createCanvas(40, 40, 20, 20); const x = c.getContext('2d'); x.fillStyle = '#000'; x.beginPath(); x.moveTo(20, 0); x.lineTo(40, 40); x.lineTo(0, 40); x.closePath(); x.fill(); l.canvas = c; l.version++; d.invalidate(); });
    await H.key('m'); await H.dragDoc([[20, 20], [60, 60]]);
    await H.menu('Edit', 'Define Brush from Selection…');
    await page.locator('.gesso-dialog input').fill('Tri tip'); await H.dialogBtn('OK'); await H.wait(200);
    const preset = await H.ev(() => Gesso.Brush.PRESETS.find((p) => p.name === 'Tri tip'));
    assert(preset && preset.tip === 'custom:Tri tip', 'preset registered ' + JSON.stringify(preset));
    await H.key('Control+d');
    await H.ev(() => { Gesso.Tools.select('brush'); const o = Gesso.Tools.byId.brush.opts; o.tip = 'custom:Tri tip'; o.size = 80; o.hardness = 1; o.spacing = 200; Gesso.app.fg = '#000000'; Gesso.Cmd.run('layer.new'); });
    await H.clickDoc(300, 200);
    const top = (await H.lpx(300, 170))[3], bottomL = (await H.lpx(270, 235))[3], bottomR = (await H.lpx(330, 235))[3], topL = (await H.lpx(270, 170))[3];
    assert(bottomL > 150 && bottomR > 150 && topL < 60, 'triangle tip: base corners painted, top-left corner empty ' + [top, bottomL, bottomR, topL]);
    await H.shot('c11-02-custom-tip');
    assert((await H.ev(() => !!Gesso.store.get('brushCustom').tips['Tri tip'])), 'persisted in storage');
  });

  await H.step('Edit ▸ Define Pattern; Pattern Stamp paints it tiled; the pattern is listed in the stamp options', async () => {
    await H.ev(() => { const d = Gesso.app.doc; const l = Gesso.Layers.raster(d, 'Pat'); const c = Gesso.util.createCanvas(16, 16, 0, 0); const x = c.getContext('2d'); x.fillStyle = '#20c020'; x.fillRect(0, 0, 8, 16); x.fillStyle = '#2020c0'; x.fillRect(8, 0, 8, 16); l.canvas = c; d.commit('pat', () => { d.layers.push(l); d.activeId = l.id; d.selectedIds = new Set([l.id]); }); });
    await H.key('m'); await H.dragDoc([[0, 0], [16, 16]]);
    await H.menu('Edit', 'Define Pattern from Selection…');
    await page.locator('.gesso-dialog input').fill('Stripes GB'); await H.dialogBtn('OK'); await H.wait(200);
    assert(await H.ev(() => !!Gesso.Brush.custom.patterns['Stripes GB']), 'pattern stored');
    await H.key('Control+d');
    await H.tool('patternStamp');
    const sel = page.locator('#optionsbar .opt-sel', { hasText: 'Pattern' }).locator('select').first();
    await sel.selectOption('pattern:Stripes GB'); await H.wait(100);
    await H.ev(() => { const o = Gesso.Tools.byId.patternStamp.opts; o.size = 120; o.hardness = 1; o.opacity = 100; o.flow = 100; o.patternScale = 100; Gesso.Cmd.run('layer.new'); });
    await H.dragDoc([[200, 150], [400, 150]], { steps: 10 });
    let g = 0, b = 0;
    for (let x = 240; x < 360; x++) { const p = await H.lpx(x, 150); if (p[3] > 100) { if (p[1] > 150 && p[2] < 100) g++; else if (p[2] > 150 && p[1] < 100) b++; } }
    assert(g > 30 && b > 30, 'both pattern colours stamped: green ' + g + ', blue ' + b);
    await H.shot('c11-03-pattern-stamp');
  });

  await H.step('Paragraph text: Justify spreads the word gaps on all but the last line; Small caps toggles', async () => {
    await H.ev(() => { const d = Gesso.app.doc; const l = Gesso.Layers.text(d, { text: 'the quick brown fox jumps over the lazy dog and keeps on running far away', x: 40, y: 40, box: { w: 300, h: 200 }, size: 24, font: 'Arial', color: '#000000' }); d.commit('txt', () => { d.layers.push(l); d.activeId = l.id; d.selectedIds = new Set([l.id]); }); });
    await page.locator('.dock-tabs .tab[title="Properties"]').first().click(); await H.wait(200);
    await field('Align').locator('select').selectOption('justify'); await H.wait(200);
    const lay = await H.ev(() => { const l = Gesso.app.doc.activeLayer(); const L = Gesso.Text.layout(l.text); return L.lines.map((x) => ({ w: Math.round(x.w), ws: +x.ws.toFixed(2) })); });
    assert(lay.length >= 3, 'wrapped into lines ' + JSON.stringify(lay));
    assert(lay.slice(0, -1).every((x) => x.w === 300 && x.ws > 0), 'full lines justified to 300 px ' + JSON.stringify(lay));
    assert(lay[lay.length - 1].ws === 0, 'last line ragged');
    // the right edge of the first line is inked right at the box edge
    const right = await H.ev(() => { const d = Gesso.app.doc, l = d.activeLayer(); Gesso.Layers.ensure(l, d); let maxX = 0; for (let x = 300; x < 345; x++) for (let y = 42; y < 66; y += 2) { const p = Gesso.Layers.readRect(l.canvas, { x, y, w: 1, h: 1 }).data; if (p[3] > 60) maxX = Math.max(maxX, x); } return maxX; });
    assert(right >= 334 && right <= 341, 'first line reaches the box edge (' + right + ')');
    assert((await H.state()).histName === 'Text Properties', 'undoable');
    const before = await H.ev(() => { const d = Gesso.app.doc, l = d.activeLayer(); Gesso.Layers.ensure(l, d); return Gesso.Layers.contentBounds(l.canvas); });
    await field('Small caps').locator('input[type=checkbox]').click(); await H.wait(200);
    const sc = await H.ev(() => { const d = Gesso.app.doc, l = d.activeLayer(); Gesso.Layers.ensure(l, d); return { on: l.text.smallCaps, b: Gesso.Layers.contentBounds(l.canvas) }; });
    assert(sc.on && JSON.stringify(sc.b) !== JSON.stringify(before), 'small caps rendered differently ' + JSON.stringify([before, sc.b]));
    await H.shot('c11-04-justify-smallcaps');
    await field('Small caps').locator('input[type=checkbox]').click(); await H.wait(100);
  });

  await H.step('Text Warp ▸ Arc bends point text (bounds grow, middle rises, undoable); Flag / Bulge render too', async () => {
    await H.ev(() => { const d = Gesso.app.doc; const l = Gesso.Layers.text(d, { text: 'WARPED TEXT', x: 80, y: 300, size: 48, font: 'Arial', weight: 700, color: '#c02020' }); d.commit('txt2', () => { d.layers.push(l); d.activeId = l.id; d.selectedIds = new Set([l.id]); }); });
    await H.wait(200);
    const b0 = await H.ev(() => Gesso.layerBounds(Gesso.app.doc.activeLayer(), Gesso.app.doc));
    const top0 = await H.ev(() => { const d = Gesso.app.doc, l = d.activeLayer(); Gesso.Layers.ensure(l, d); const cb = Gesso.Layers.contentBounds(l.canvas); return cb.y + (l.canvas.oy || 0); });
    const warp = props.locator('.warp-ui');
    await warp.locator('.field', { hasText: 'Style' }).locator('select').selectOption('arc'); await H.wait(250);
    const bend = props.locator('.warp-ui .field', { hasText: 'Bend' }).locator('input[type=range]');
    assert(await bend.count(), 'bend slider appears');
    await bend.fill('60'); await H.wait(250); // fill() fires input + change like a real drag
    const w = await H.ev(() => Gesso.app.doc.activeLayer().text.warp);
    assert(w && w.style === 'arc' && w.bend === 60, 'warp stored ' + JSON.stringify(w));
    const b1 = await H.ev(() => Gesso.layerBounds(Gesso.app.doc.activeLayer(), Gesso.app.doc));
    assert(b1.y < b0.y - 5 && b1.h > b0.h + 5, 'bounds grew upward ' + JSON.stringify([b0, b1]));
    // the middle of the text is inked higher than its ends (top-of-ink profile across the layer)
    const prof = await H.ev(() => { const d = Gesso.app.doc, l = d.activeLayer(); Gesso.Layers.ensure(l, d); const c = l.canvas, b = Gesso.layerBounds(l, d); const out = []; for (let x = Math.floor(b.x); x < b.x + b.w; x += 4) { let t = null; for (let y = Math.floor(b.y); y < b.y + b.h; y++) { const p = Gesso.Layers.readRect(c, { x, y, w: 1, h: 1 }).data; if (p[3] > 60) { t = y; break; } } out.push(t); } return out; });
    const n = prof.length, mn = (a) => Math.min(...a.filter((v) => v != null));
    const ends = mn(prof.slice(0, Math.ceil(n / 12)).concat(prof.slice(-Math.ceil(n / 12)))), mid = mn(prof.slice(Math.floor(n * 0.42), Math.ceil(n * 0.58)));
    assert(mid < ends - 8, 'arc: middle higher than the ends ' + mid + ' vs ' + ends);
    assert(mid < top0 - 8, 'middle rose above the straight rendering ' + mid + ' vs ' + top0);
    await H.shot('c11-05-text-warp');
    assert((await H.state()).histName === 'Text Warp', 'undoable');
    await H.ev(() => document.activeElement && document.activeElement.blur()); // leave the slider so Ctrl+Z reaches the app
    await H.key('Control+z'); await H.wait(100);
    const w2 = await H.ev(() => Gesso.app.doc.activeLayer().text.warp);
    assert(w2 && w2.bend === 50, 'undo steps back to the style change (default bend) ' + JSON.stringify(w2));
    await H.key('Control+z'); await H.wait(100);
    assert(!(await H.ev(() => Gesso.app.doc.activeLayer().text.warp)), 'second undo removes the warp');
    for (const st of ['flag', 'bulge', 'wave', 'rise', 'arcLower', 'arcUpper']) {
      await H.ev((st) => { const d = Gesso.app.doc, l = d.activeLayer(); d.commit('w', () => { l.text.warp = { style: st, bend: 70 }; l.version++; }); }, st);
      await H.wait(80);
      const ok = await H.ev(() => { const d = Gesso.app.doc, l = d.activeLayer(); Gesso.Layers.ensure(l, d); const cb = Gesso.Layers.contentBounds(l.canvas); return cb && cb.w > 200 && cb.h > 30; });
      assert(ok, st + ' renders');
    }
  });

  await H.step('Project round-trip keeps justify / small caps / warp; Convert Text to Shape traces the warped outline', async () => {
    const json = await H.ev(async () => JSON.stringify(await Gesso.FileIO.serialize(Gesso.app.doc)));
    const data = JSON.parse(json);
    const texts = data.layers.filter((l) => l.type === 'text').map((l) => l.text);
    assert(texts.some((t) => t.align === 'justify') && texts.some((t) => t.warp && t.warp.style), 'serialized ' + JSON.stringify(texts.map((t) => [t.align, t.warp])));
    const d2 = await H.ev(async (j) => { const d = await Gesso.FileIO.loadProject(JSON.parse(j), 'Reload'); return d.allLayers().filter((l) => l.type === 'text').map((l) => [l.text.align, l.text.warp && l.text.warp.style]); }, json);
    assert(JSON.stringify(d2).includes('justify') && JSON.stringify(d2).includes('arcUpper'), 'reloaded ' + JSON.stringify(d2) + ' from ' + JSON.stringify(texts.map((t) => t.warp)));
    await H.ev(() => { const d = Gesso.app.doc; const l = d.allLayers().find((x) => x.type === 'text' && x.text.warp); d.setActive(l.id); });
    const n0 = (await H.state()).layers.length;
    await H.menu('Layer', 'Convert Text to Shape (traced)');
    await H.wait(300);
    const st = await H.state();
    assert(st.layers.length === n0 && st.activeType === 'shape' && st.active.endsWith('(shape)'), 'text replaced by a shape layer ' + st.active);
    const sh = await H.ev(() => { const l = Gesso.app.doc.activeLayer(); return { n: l.shape.path.subpaths.length, color: l.shape.fill.color }; });
    assert(sh.n >= 8 && sh.color === '#c02020', 'one subpath per glyph part, text colour kept ' + JSON.stringify(sh));
    await H.key('Control+z'); await H.wait(100);
    assert((await H.state()).activeType === 'text', 'undo restores the text layer');
    await H.shot('c11-06-text-to-shape');
  });

  await H.finish();
})();
