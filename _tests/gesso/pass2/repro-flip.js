// Repro of the user's report: lasso-cut a region to a new layer, rotate canvas 180° twice, flip horizontal,
// then paint on the cut-out layer. Checks that (a) the cut-out pixels sit where the composite shows them and
// (b) a brush stroke lands where the mouse went, on the right layer, without disturbing other pixels.
const { ROOT } = require('../../env.js');
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto('file://' + ROOT + '/Gesso/index.html'); await p.waitForTimeout(800);
  const r = await p.evaluate(async () => {
    const S = window.Gesso, U = S.util, L = S.Layers, O = S.Ops;
    const doc = S.App.createDoc({ name: 'Repro', w: 800, h: 600, dpi: 72, bg: 'white' });
    await new Promise(r => setTimeout(r, 200));
    // photo-like content: a gradient with a distinct "face" blob at (200,150)-(360,330)
    const base = doc.layers[0], bx = base.canvas.getContext('2d');
    const g = bx.createLinearGradient(0, 0, 800, 600); g.addColorStop(0, '#3a6'); g.addColorStop(1, '#a36');
    bx.fillStyle = g; bx.fillRect(-base.canvas.ox || 0, -base.canvas.oy || 0, 800, 600);
    bx.fillStyle = '#ffd37a'; bx.beginPath(); bx.ellipse(280 - (base.canvas.ox || 0), 240 - (base.canvas.oy || 0), 80, 90, 0, 0, 7); bx.fill();
    bx.fillStyle = '#000'; bx.fillRect(250 - (base.canvas.ox || 0), 210 - (base.canvas.oy || 0), 12, 12); // left eye
    doc.bump(base);
    // lasso-ish selection around the face, cut to a new layer
    const sel = S.Sel.fromRect ? S.Sel.fromRect(doc, { x: 190, y: 140, w: 180, h: 200 }) : null;
    if (sel) doc.selection = sel; else { const c = U.createCanvas(800, 600); const x = c.getContext('2d'); x.fillRect(190, 140, 180, 200); doc.selection = S.Sel.make(S.Sel.alphaOf(c), 800, 600); }
    doc.activeId = base.id; doc.selectedIds = new Set([base.id]);
    S.App.layerVia(true);
    await new Promise(r => setTimeout(r, 200));
    const cut = doc.activeLayer(); const cutName = cut.name;
    const sample = () => { const f = S.Compositor.flatten(doc); const x = f.getContext('2d'); const px = (X, Y) => Array.from(x.getImageData(X, Y, 1, 1).data).slice(0, 3); return { eye: px(256, 216), faceC: px(280, 240), mirrorEye: px(800 - 256, 216), mirrorFaceC: px(800 - 280, 240) }; };
    const s0 = sample();
    // rotate 180 twice, then flip H (what the user did)
    doc.commit('Rot', () => O.rotateCanvas(doc, 180)); doc.commit('Rot', () => O.rotateCanvas(doc, 180)); doc.commit('Flip', () => O.flipCanvas(doc, 'h'));
    const s1 = sample();
    // the cut layer's own canvas: where does it think the eye is?
    const cc = cut.canvas, cx = cc.getContext('2d');
    const eyeInLayer = (X, Y) => { const lx = X - (cc.ox || 0), ly = Y - (cc.oy || 0); if (lx < 0 || ly < 0 || lx >= cc.width || ly >= cc.height) return null; return Array.from(cx.getImageData(lx, ly, 1, 1).data).slice(0, 4); };
    const layerAtMirror = eyeInLayer(800 - 256, 216), layerAtOrig = eyeInLayer(256, 216);
    // now paint a red dot on the cut layer at the mirrored face centre with the real brush pipeline
    doc.activeId = cut.id; doc.selectedIds = new Set([cut.id]); doc.selection = null;
    S.app.fg = '#ff0000';
    return { cutName, ox: cc.ox, oy: cc.oy, cw: cc.width, ch: cc.height, s0, s1, layerAtMirror, layerAtOrig, layers: doc.layers.map(l => l.name) };
  });
  console.log(JSON.stringify(r, null, 1));
  // real mouse stroke with the brush tool at the mirrored face centre
  await p.evaluate(() => {
    const S = window.Gesso, L = S.Layers; window.__log = [];
    const d = S.app.doc, cut = d.activeLayer();
    window.__log.push('before stroke: canvas ' + JSON.stringify([cut.canvas.ox, cut.canvas.oy, cut.canvas.width, cut.canvas.height]) + ' _empty=' + !!cut.canvas._empty);
    const g = L.growTo; L.growTo = function (c, r, pad, limit, fill) { const b = [c.ox, c.oy, c.width, c.height]; const res = g.apply(this, arguments); window.__log.push('growTo r=' + JSON.stringify(r) + ' from ' + JSON.stringify(b) + ' to ' + JSON.stringify([c.ox, c.oy, c.width, c.height]) + ' changed=' + res); return res; };
    const be = d.beginPixelEdit.bind(d); d.beginPixelEdit = function (t) { window.__log.push('beginPixelEdit target canvas ' + JSON.stringify([t.canvas.ox, t.canvas.oy, t.canvas.width, t.canvas.height]) + ' same as layer.canvas=' + (t.canvas === d.activeLayer().canvas)); return be(t); };
  });
  await p.keyboard.press('b'); await p.waitForTimeout(100);
  const vp = await p.$('#viewport canvas, .viewport canvas, canvas.view');
  const info = await p.evaluate(() => { const V = Gesso.View; const d = Gesso.app.doc; const r0 = V.canvas.getBoundingClientRect(); const q = V.toScreen(800 - 280, 240, d); const pt = [q[0] + r0.left, q[1] + r0.top]; return { pt, zoom: d.view.zoom }; });
  console.log('screen pt for mirrored face centre', info);
  if (info.pt) {
    await p.mouse.move(info.pt[0] - 20, info.pt[1]); await p.mouse.down();
    for (let i = 0; i <= 20; i++) { await p.mouse.move(info.pt[0] - 20 + i * 2, info.pt[1]); await p.waitForTimeout(8); }
    await p.mouse.up(); await p.waitForTimeout(300);
  }
  console.log((await p.evaluate(() => window.__log.join('\n'))));
  const after = await p.evaluate(() => {
    const S = window.Gesso, d = S.app.doc, f = S.Compositor.flatten(d), x = f.getContext('2d');
    const px = (X, Y) => Array.from(x.getImageData(X, Y, 1, 1).data).slice(0, 3);
    const cut = d.activeLayer(), cc = cut.canvas, cx = cc.getContext('2d');
    let reds = 0; const id = cx.getImageData(0, 0, cc.width, cc.height).data; for (let i = 0; i < id.length; i += 4) if (id[i] > 200 && id[i + 1] < 60 && id[i + 2] < 60 && id[i + 3] > 100) reds++;
    let minx=1e9,miny=1e9,maxx=-1,maxy=-1; for (let i = 0; i < id.length; i += 4) if (id[i] > 200 && id[i + 1] < 60 && id[i + 2] < 60 && id[i + 3] > 100) { const k=i/4, lx=k%cc.width, ly=(k/cc.width)|0; minx=Math.min(minx,lx);maxx=Math.max(maxx,lx);miny=Math.min(miny,ly);maxy=Math.max(maxy,ly); }
    const redDoc = { x1: minx + cc.ox, y1: miny + cc.oy, x2: maxx + cc.ox, y2: maxy + cc.oy };
    const cf = S.Compositor.flatten(d).getContext('2d'); const compRed = (X,Y)=>Array.from(cf.getImageData(X,Y,1,1).data).slice(0,3);
    return { atMirrorFace: px(800 - 280, 240), atOrigFace: px(280, 240), redPixelsOnCutLayer: reds, cutOffset: [cc.ox, cc.oy, cc.width, cc.height], redDoc, compAtRedCentre: compRed(((minx+maxx)/2+cc.ox)|0, ((miny+maxy)/2+cc.oy)|0), expectedStroke: { x1: 800-280-20, x2: 800-280+20, y: 240 } };
  });
  console.log(JSON.stringify(after));
  await p.screenshot({ path: __dirname + '/shots/repro-flip.png' });
  console.log(errs.length ? 'ERRORS\n' + errs.join('\n') : 'NO ERRORS'); await b.close();
})();
