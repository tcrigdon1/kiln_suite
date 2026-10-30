// C12 — vector: per-corner radius, distribute, Combine Shapes (traced), SVG import (open + place) and SVG export.
const { launch, assert, near } = require('./lib');
const path = require('path');
const fs = require('fs');
const DL = path.join(__dirname, 'downloads'); fs.mkdirSync(DL, { recursive: true });

const SVG = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs>
  <rect id="bg" x="0" y="0" width="400" height="300" fill="#ffffff"/>
  <g id="shapes" transform="translate(20 20)">
    <rect id="r1" x="0" y="0" width="100" height="60" rx="12" fill="#d33" stroke="#000" stroke-width="4"/>
    <circle id="c1" cx="200" cy="40" r="30" fill="url(#g1)"/>
    <path id="p1" d="M 250 0 L 350 0 A 50 50 0 0 1 350 100 L 250 100 Z" fill="#3a3" fill-opacity="0.5"/>
    <polygon id="tri" points="0,120 60,120 30,180" fill="none" stroke="#06c" stroke-width="6" stroke-linejoin="round"/>
    <ellipse id="e1" cx="200" cy="150" rx="60" ry="25" fill="#fc0" transform="rotate(30 200 150)"/>
  </g>
  <text id="t1" x="20" y="270" font-family="Arial" font-size="32" font-weight="bold" fill="#222">Hello SVG</text>
  <foreignObject x="0" y="0" width="1" height="1"/>
</svg>`;

(async () => {
  const H = await launch();
  const { page } = H;
  const svgFile = path.join(DL, 'c12-input.svg'); fs.writeFileSync(svgFile, SVG);

  await H.step('open an .svg: shapes, group, gradient, arc path, rotated ellipse and text become editable layers', async () => {
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), H.menu('File', 'Open…')]);
    await fc.setFiles(svgFile);
    await H.wait(500);
    const st = await H.state();
    assert(st && st.w === 400 && st.h === 300, 'document 400×300: ' + JSON.stringify(st && [st.w, st.h]));
    const types = st.layers.map((l) => l.type + ':' + l.name).join(',');
    assert(types.includes('text:t1') && types.includes('group:shapes') && types.includes('shape:r1') && types.includes('shape:c1') && types.includes('shape:p1') && types.includes('shape:tri') && types.includes('shape:e1'), 'layers ' + types);
    const info = await H.ev(() => { const d = Gesso.app.doc; const f = (n) => d.allLayers().find((l) => l.name === n); return { r1: f('r1').shape, c1: f('c1').shape, p1: f('p1'), e1: f('e1').shape, t1: f('t1').text }; });
    assert(info.r1.kind === 'roundRect' && info.r1.radius === 12 && info.r1.x === 20 && info.r1.y === 20 && info.r1.stroke.enabled && info.r1.stroke.width === 4, 'rounded rect ' + JSON.stringify([info.r1.kind, info.r1.radius, info.r1.x, info.r1.y, info.r1.stroke]));
    assert(info.c1.kind === 'ellipse' && info.c1.fill.type === 'linear' && info.c1.fill.stops.length === 2 && info.c1.fill.angle === 0, 'gradient circle ' + JSON.stringify(info.c1.fill));
    assert(info.p1.shape.kind === 'path' && Math.abs(info.p1.opacity - 0.5) < 0.01, 'arc path with fill-opacity ' + info.p1.opacity);
    assert(info.e1.kind === 'ellipse' && Math.abs(Gesso_rot(info.e1) - 30) < 0.5, 'ellipse rotation ' + Gesso_rot(info.e1));
    assert(info.t1.text === 'Hello SVG' && info.t1.size === 32 && info.t1.weight === 700 && info.t1.font === 'Arial', 'text ' + JSON.stringify(info.t1));
    // pixels: red rect, blue right half of the circle, dark text
    let p = await H.px(60, 50); assert(p[0] > 180 && p[1] < 90, 'red rect ' + p);
    p = await H.px(245, 60); assert(p[2] > 150 && p[0] < 110, 'blue side of the gradient circle ' + p);
    p = await H.px(330, 70); assert(p[1] > p[0] + 20, 'green arc path ' + p);
    await H.shot('c12-01-svg-import');
    function Gesso_rot(s) { if (!s.matrix) return 0; return Math.abs((Math.atan2(s.matrix[1], s.matrix[0]) * 180) / Math.PI); }
  });

  await H.step('per-corner radius from the Properties panel renders two square and two round corners (undoable)', async () => {
    await H.ev(() => { const d = Gesso.app.doc; const l = d.allLayers().find((x) => x.name === 'r1'); d.setActive(l.id); });
    await page.locator('.dock-tabs .tab[title="Properties"]').first().click();
    await H.wait(200);
    const props = page.locator('.panel-properties');
    const field = (label) => props.locator('.field, .check-row', { hasText: label }).first();
    const cb = field('Separate corners').locator('input[type=checkbox]');
    assert(await cb.count(), 'Separate corners checkbox present');
    await cb.click(); await H.wait(150);
    const tr = field('Top right').locator('input[type=number]');
    assert(await tr.count(), 'per-corner fields appear');
    await tr.fill('0'); await tr.press('Enter'); await H.wait(100);
    const bl = field('Bottom left').locator('input[type=number]');
    await bl.fill('0'); await bl.press('Enter'); await H.wait(150);
    const radii = await H.ev(() => Gesso.app.doc.activeLayer().shape.radii);
    assert(JSON.stringify(radii) === '[12,0,12,0]', 'radii ' + JSON.stringify(radii));
    // top-right corner pixel is now red (square), top-left stays white-ish (rounded away)
    let p = await H.px(115, 25); assert(p[0] > 150 && p[1] < 120, 'top-right corner filled (square) ' + p);
    p = await H.px(21, 21); assert(p[0] > 200 && p[1] > 200, 'top-left corner stays rounded (background shows) ' + p);
    const rt = await H.ev(async () => { const j = JSON.stringify(await Gesso.FileIO.serialize(Gesso.app.doc)); return JSON.parse(j).layers.flatMap((l) => (l.children || [l])).find((l) => l.name === 'r1').shape.radii; });
    assert(JSON.stringify(rt) === '[12,0,12,0]', 'per-corner radii serialize into the project ' + JSON.stringify(rt));
    await H.key('Control+z'); await H.wait(100);
    const r2 = await H.ev(() => Gesso.app.doc.activeLayer().shape.radii);
    assert(JSON.stringify(r2) === '[12,0,12,12]', 'undo restores the previous corner ' + JSON.stringify(r2));
    await H.key('Control+Shift+z');
  });

  await H.step('Distribute Horizontal Centers spaces three selected shapes evenly', async () => {
    await H.ev(() => { const d = Gesso.app.doc; const ids = ['r1', 'c1', 'tri'].map((n) => d.allLayers().find((x) => x.name === n).id); d.selectedIds = new Set(ids); d.activeId = ids[0]; Gesso.bus.emit('layers:changed', d); });
    await H.menu('Layer', 'Distribute', 'Horizontal Centers');
    const cs = await H.ev(() => { const d = Gesso.app.doc; return ['r1', 'c1', 'tri'].map((n) => { const b = Gesso.layerBounds(d.allLayers().find((x) => x.name === n), d); return b.x + b.w / 2; }).sort((a, b) => a - b); });
    const gap1 = cs[1] - cs[0], gap2 = cs[2] - cs[1];
    assert(Math.abs(gap1 - gap2) <= 1.5, 'even centre spacing ' + JSON.stringify(cs));
    assert((await H.state()).histName === 'Distribute', 'history entry');
    await H.key('Control+z');
  });

  await H.step('Combine Shapes ▸ Subtract: rect minus circle leaves a bite; result is one editable path layer; undo restores both', async () => {
    await H.ev(() => {
      const d = Gesso.app.doc;
      d.commit('setup', () => {
        const a = Gesso.Layers.shape(d, { kind: 'rect', x: 40, y: 200, w: 120, h: 80, fill: { enabled: true, color: '#8040c0', type: 'solid' } }); a.name = 'A';
        const b = Gesso.Layers.shape(d, { kind: 'ellipse', x: 120, y: 190, w: 80, h: 80, fill: { enabled: true, color: '#20a0a0', type: 'solid' } }); b.name = 'B';
        d.layers.push(a, b); d.selectedIds = new Set([a.id, b.id]); d.activeId = b.id;
      });
    });
    await H.wait(100);
    const before = (await H.state()).layers.length;
    await H.menu('Layer', 'Combine Shapes', 'Subtract Front Shapes');
    await H.wait(200);
    const st = await H.state();
    assert(st.layers.length === before - 1, 'one layer fewer');
    const sh = await H.ev(() => { const l = Gesso.app.doc.activeLayer(); return { kind: l.shape.kind, n: l.shape.path.subpaths.length, nodes: l.shape.path.subpaths[0].nodes.length, color: l.shape.fill.color, name: l.name }; });
    assert(sh.kind === 'path' && sh.n >= 1 && sh.color === '#8040c0', 'path shape with A\'s paint ' + JSON.stringify(sh));
    let p = await H.px(60, 240); assert(p[0] > 100 && p[2] > 150 && p[1] < 120, 'purple remains on the left ' + p);
    p = await H.px(150, 230); assert(p[0] > 200 && p[1] > 200 && p[2] > 200, 'bite where the circle was (white background) ' + p);
    await H.shot('c12-02-combine');
    await H.key('Control+z'); await H.wait(100);
    assert((await H.state()).layers.length === before, 'undo brings both shapes back');
    const names = (await H.state()).layers.map((l) => l.name);
    assert(names.includes('A') && names.includes('B'), 'A and B restored: ' + names);
  });

  await H.step('Combine ▸ Unite + Exclude work; smoothing keeps the node count sane', async () => {
    await H.ev(() => { const d = Gesso.app.doc; const ids = ['A', 'B'].map((n) => d.allLayers().find((x) => x.name === n).id); d.selectedIds = new Set(ids); d.activeId = ids[0]; });
    await H.menu('Layer', 'Combine Shapes', 'Unite');
    let sh = await H.ev(() => { const l = Gesso.app.doc.activeLayer(); return { n: l.shape.path.subpaths.length, nodes: l.shape.path.subpaths.reduce((a, s) => a + s.nodes.length, 0) }; });
    assert(sh.n === 1 && sh.nodes < 120 && sh.nodes > 6, 'united into one outline with ' + sh.nodes + ' nodes');
    let p = await H.px(150, 230); assert(p[0] > 100 && p[2] > 150, 'union covers the circle area with A\'s colour ' + p);
    await H.key('Control+z'); await H.wait(100);
    await H.ev(() => { const d = Gesso.app.doc; const ids = ['A', 'B'].map((n) => d.allLayers().find((x) => x.name === n).id); d.selectedIds = new Set(ids); d.activeId = ids[0]; });
    await H.menu('Layer', 'Combine Shapes', 'Exclude Overlap');
    p = await H.px(150, 230); assert(p[0] > 200 && p[1] > 200 && p[2] > 200, 'overlap excluded ' + p);
    p = await H.px(185, 230); assert(p[0] > 100 && p[2] > 150, 'circle-only part kept ' + p);
    await H.key('Control+z');
  });

  await H.step('Export as SVG downloads a file whose shapes stay vector (path / gradient / text)', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), H.menu('File', 'Export as SVG…')]);
    const out = path.join(DL, dl.suggestedFilename()); await dl.saveAs(out);
    const svg = fs.readFileSync(out, 'utf8');
    assert(svg.startsWith('<?xml') && svg.includes('<svg') && svg.includes('</svg>'), 'well-formed wrapper');
    assert((svg.match(/<path /g) || []).length >= 5, 'paths exported: ' + (svg.match(/<path /g) || []).length);
    assert(svg.includes('<linearGradient') && svg.includes('url(#g1)'), 'gradient fill exported');
    assert(svg.includes('<text') && svg.includes('Hello SVG') && svg.includes('font-family="Arial"'), 'text exported as text');
    assert(svg.includes('data-name="shapes"') && svg.includes('<g'), 'group exported');
    // re-import the export in a new document: same number of shape/text layers, same pixels at a few probes
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), H.menu('File', 'Open…')]);
    await fc.setFiles(out); await H.wait(500);
    const st = await H.state();
    assert(st.name.endsWith('.svg') === false && st.w === 400, 'reopened export: ' + st.name + ' ' + st.w);
    const counts = st.layers.reduce((a, l) => { a[l.type] = (a[l.type] || 0) + 1; return a; }, {});
    assert(counts.shape >= 7 && counts.text === 1, 'layer counts ' + JSON.stringify(counts));
    let p = await H.px(60, 50); assert(p[0] > 180 && p[1] < 90, 'red rect survives the round trip ' + p);
    p = await H.px(245, 60); assert(p[2] > 150 && p[0] < 110, 'gradient survives ' + p);
    await H.shot('c12-03-svg-roundtrip');
  });

  await H.step('Place SVG as Layer puts the artwork in a group inside the current document', async () => {
    await H.ev(() => Gesso.App.createDoc({ name: 'Target', w: 600, h: 400, dpi: 72, bg: 'white' }));
    await H.wait(200);
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), H.menu('File', 'Place Image / SVG as Layer…')]);
    await fc.setFiles(svgFile); await H.wait(500);
    const st = await H.state();
    assert(st.name === 'Target' && st.layers[0].type === 'group' && st.layers[0].name === 'c12-input', 'group placed: ' + JSON.stringify(st.layers.slice(0, 2)));
    assert(st.histName === 'Place SVG', 'history entry ' + st.histName);
    const p = await H.px(60, 50); assert(p[0] > 180 && p[1] < 90, 'placed red rect ' + p);
  });

  await H.finish();
})();
