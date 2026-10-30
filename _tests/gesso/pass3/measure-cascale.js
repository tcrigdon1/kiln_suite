// Pass 3 — Ruler/Straighten, Perspective Crop, Content-Aware Scale
const { launch, assert } = require('../pass2/lib');
(async () => {
  const H = await launch();
  const { page } = H;
  // a 400×300 doc with a tilted dark bar (5°) on white
  await H.ev(() => {
    const S = window.Gesso, d = S.App.createDoc({ name: 'M', w: 400, h: 300, dpi: 72, bg: 'white' });
    const l = d.layers[0], x = l.canvas.getContext('2d');
    x.save(); x.translate(200, 150); x.rotate(-5 * Math.PI / 180); x.fillStyle = '#222'; x.fillRect(-150, -6, 300, 12); x.restore(); d.bump(l);
  });
  await H.wait(200);

  await H.step('tools registered (Ruler in the eyedropper group, Perspective Crop in the crop group) and menu command present', async () => {
    const r = await H.ev(() => ({ ruler: !!Gesso.Tools.byId.ruler, pcrop: !!Gesso.Tools.byId.pcrop, cmd: !!Gesso.Cmd.get('image.caScale'), grp: Gesso.Tools.byId.ruler.group + '/' + Gesso.Tools.byId.pcrop.group }));
    assert(r.ruler && r.pcrop && r.cmd, JSON.stringify(r));
  });

  await H.step('Ruler: drag along the tilted bar with the real mouse → angle ≈ 5°, Straighten levels it and crops', async () => {
    await H.ev(() => Gesso.Tools.select('ruler'));
    const a = [200 - 150 * Math.cos(5 * Math.PI / 180), 150 + 150 * Math.sin(5 * Math.PI / 180)], b = [200 + 150 * Math.cos(5 * Math.PI / 180), 150 - 150 * Math.sin(5 * Math.PI / 180)];
    await H.dragDoc([a, b]);
    const ang = await H.ev(() => Gesso.app.tool.angle());
    assert(Math.abs(ang - 5) < 0.4, 'measured ' + ang);
    const txt = await page.locator('.opt-readout').allInnerTexts();
    assert(txt.some((t) => /A\s*5/.test(t.replace(/\n/g, ''))) || txt.join(' ').indexOf('5') >= 0, 'readouts ' + txt.join(' | '));
    await page.locator('.btn.primary', { hasText: 'Straighten Image' }).click();
    await H.wait(300);
    const r = await H.ev(() => {
      const d = Gesso.app.doc, f = Gesso.Compositor.flatten(d), x = f.getContext('2d');
      // the bar should now be horizontal: sample dark pixels along the centre row vs. rows above/below
      const dark = (yy) => { let n = 0; const id = x.getImageData(0, yy, f.width, 1).data; for (let i = 0; i < id.length; i += 4) if (id[i] < 80) n++; return n; };
      const cy = Math.round(f.height / 2);
      return { w: d.width, h: d.height, mid: dark(cy), up: dark(cy - 14), down: dark(cy + 14), undoName: d.history.entries[d.history.index].name };
    });
    assert(r.w < 400 && r.h < 300 && r.w > 300, 'cropped to the largest level rectangle: ' + r.w + '×' + r.h);
    assert(r.mid > 200 && r.up < 10 && r.down < 10, 'bar is level after straighten: ' + JSON.stringify(r));
    assert(r.undoName === 'Straighten', 'one undo step: ' + r.undoName);
  });

  await H.step('Perspective Crop: a trapezoid becomes a rectangle of the drawn size (real mouse: box + corner drags + Enter)', async () => {
    await H.ev(() => {
      const S = window.Gesso; for (const d of S.app.docs.slice()) { d.modified = false; S.App.closeDoc(d); }
      const d = S.App.createDoc({ name: 'P', w: 400, h: 300, dpi: 72, bg: 'white' });
      const x = d.layers[0].canvas.getContext('2d');
      // a "sign" drawn in perspective: trapezoid with a red top band and blue bottom band
      x.fillStyle = '#c00'; x.beginPath(); x.moveTo(120, 60); x.lineTo(280, 90); x.lineTo(280, 150); x.lineTo(120, 150); x.closePath(); x.fill();
      x.fillStyle = '#00c'; x.beginPath(); x.moveTo(120, 150); x.lineTo(280, 150); x.lineTo(280, 210); x.lineTo(120, 240); x.closePath(); x.fill();
      d.bump(d.layers[0]);
    });
    await H.wait(200);
    await H.ev(() => Gesso.Tools.select('pcrop'));
    await H.dragDoc([[120, 60], [280, 240]]); // box
    // move the top-right corner down to (280,90) and the bottom-right up to (280,210)
    await H.dragDoc([[280, 60], [280, 90]]);
    await H.dragDoc([[280, 240], [280, 210]]);
    const c = await H.ev(() => Gesso.app.tool.corners.map((p) => p.map(Math.round)));
    assert(JSON.stringify(c) === JSON.stringify([[120, 60], [280, 90], [280, 210], [120, 240]]), 'corners ' + JSON.stringify(c));
    const sz = await H.ev(() => Gesso.app.tool.outSize());
    await H.key('Enter'); await H.wait(400);
    const r = await H.ev(() => {
      const d = Gesso.app.doc, f = Gesso.Compositor.flatten(d), x = f.getContext('2d');
      const px = (X, Y) => Array.from(x.getImageData(X, Y, 1, 1).data).slice(0, 3);
      return { w: d.width, h: d.height, tl: px(3, 3), tr: px(d.width - 4, 3), bl: px(3, d.height - 4), br: px(d.width - 4, d.height - 4), mid: px(Math.round(d.width / 2), Math.round(d.height / 2)) };
    });
    assert(r.w === sz[0] && r.h === sz[1] && Math.abs(r.w - 163) <= 3 && Math.abs(r.h - 150) <= 3, 'output size ' + JSON.stringify(r));
    const red = (p) => p[0] > 150 && p[2] < 80, blue = (p) => p[2] > 150 && p[0] < 80;
    assert(red(r.tl) && red(r.tr) && blue(r.bl) && blue(r.br), 'corners rectified: ' + JSON.stringify(r));
  });

  await H.step('Content-Aware Scale: a protected square keeps its width while the flat background is carved away', async () => {
    await H.ev(() => {
      const S = window.Gesso; for (const d of S.app.docs.slice()) { d.modified = false; S.App.closeDoc(d); }
      const d = S.App.createDoc({ name: 'C', w: 600, h: 200, dpi: 72, bg: 'white' });
      const x = d.layers[0].canvas.getContext('2d');
      const g = x.createLinearGradient(0, 0, 0, 200); g.addColorStop(0, '#eee'); g.addColorStop(1, '#bbb'); x.fillStyle = g; x.fillRect(0, 0, 600, 200);
      x.fillStyle = '#d33'; x.fillRect(250, 50, 100, 100); // the subject
      d.bump(d.layers[0]);
      d.selection = S.Sel.make(S.Sel.rectMask(600, 200, 240, 40, 120, 120), 600, 200);
    });
    await H.wait(100);
    await H.ev(() => { const S = window.Gesso, d = S.app.doc; return S.CAScale.apply(d, d.activeLayer(), 400, 200, { protect: true, skin: false, canvas: true }); });
    await H.wait(200);
    const r = await H.ev(() => {
      const d = Gesso.app.doc, f = Gesso.Compositor.flatten(d), x = f.getContext('2d');
      const id = x.getImageData(0, 100, f.width, 1).data; let first = -1, last = -1, n = 0;
      for (let i = 0; i < f.width; i++) { const o = i * 4; if (id[o] > 180 && id[o + 1] < 90) { n++; if (first < 0) first = i; last = i; } }
      return { w: d.width, h: d.height, redRun: n, first, last, name: d.history.entries[d.history.index].name };
    });
    assert(r.w === 400 && r.h === 200, 'canvas 400×200: ' + JSON.stringify(r));
    assert(r.redRun >= 96 && r.redRun <= 104, 'red square keeps ~100 px of its width (' + r.redRun + ')');
    assert(r.name === 'Content-Aware Scale', 'undo step');
    await H.ev(() => Gesso.Cmd.run('edit.undo'));
    const w = await H.ev(() => Gesso.app.doc.width);
    assert(w === 600, 'undo restores 600 px');
  });

  await H.step('Content-Aware Scale enlarge (120 % width) keeps the subject width and grows the canvas', async () => {
    await H.ev(() => { const S = window.Gesso, d = S.app.doc; d.selection = S.Sel.make(S.Sel.rectMask(600, 200, 240, 40, 120, 120), 600, 200); return S.CAScale.apply(d, d.activeLayer(), 720, 200, { protect: true, skin: false, canvas: true }); });
    const r = await H.ev(() => { const d = Gesso.app.doc, f = Gesso.Compositor.flatten(d), x = f.getContext('2d'); const id = x.getImageData(0, 100, f.width, 1).data; let n = 0; for (let i = 0; i < f.width; i++) { const o = i * 4; if (id[o] > 180 && id[o + 1] < 90) n++; } return { w: d.width, red: n }; });
    assert(r.w === 720 && r.red >= 96 && r.red <= 110, JSON.stringify(r));
  });

  await H.finish();
})();
