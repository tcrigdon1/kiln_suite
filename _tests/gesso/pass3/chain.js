// Pass 3 polish — cross-feature chain on the real photo: lasso cut → animation + tween → blend-if → content-aware
// scale → GIF export → perspective crop → history brush → undo/redo everything → save/load round trip
const { launch, assert } = require('../pass2/lib');
const fs = require('fs');
(async () => {
  const H = await launch();
  const { page } = H;
  const dataUrl = 'data:image/png;base64,' + fs.readFileSync(require('path').join(__dirname, '..', '..', 'assets', 'sample.png')).toString('base64');
  await page.evaluate(async (u) => { const img = await Gesso.util.loadImage(u); const d = Gesso.FileIO.docFromImage(img, 'Chain'); Gesso.app.doc.commit('shrink', () => Gesso.Ops.resizeImage(Gesso.app.doc, 960, 540, 'bilinear')); }, dataUrl);
  await H.wait(500);
  const errsAt = () => H.errors.splice(0);

  await H.step('lasso cut to a layer, animate it sliding with a tween, blend-if on it', async () => {
    await H.ev(() => Gesso.Tools.select('lasso'));
    await H.dragDoc([[260, 180], [480, 170], [500, 420], [300, 500], [250, 350]], { steps: 10 });
    await H.key('Control+Shift+j'); await H.wait(300);
    const r = await H.ev(() => {
      const S = window.Gesso, d = S.app.doc, cut = d.activeLayer();
      S.Anim.create(d); S.Anim.add(d);
      d.commit('move', () => { const c = S.util.cloneCanvas(cut.canvas); c.ox = (c.ox || 0) + 120; cut.canvas = c; cut.opacity = 0.6; });
      S.Anim.tween(d, S.Anim.get(d).frames[0].id, 3);
      d.commit('bi', () => { cut.blendIf = { on: true, channel: 'gray', t: [0, 0, 255, 255], u: [0, 40, 255, 255] }; cut.version++; });
      return { layers: d.layers.length, frames: S.Anim.get(d).frames.length, cutName: cut.name };
    });
    assert(r.layers === 2 && r.frames === 5, JSON.stringify(r));
    const e = errsAt(); assert(!e.length, e.join(' | ').slice(0, 400));
  });

  await H.step('content-aware scale to 75 % width while frames exist, then GIF export of the frames', async () => {
    await H.ev(() => { const S = window.Gesso, d = S.app.doc; d.setActive(d.layers[0].id); return S.CAScale.apply(d, d.layers[0], 720, 540, { protect: false, skin: true, canvas: true }); });
    const w = await H.ev(() => Gesso.app.doc.width); assert(w === 720, 'width ' + w);
    const frames = await H.ev(async () => { const S = window.Gesso, d = S.app.doc; const fr = await S.Anim.renderFrames(d, 0.5, { matte: '#fff' }); return fr.length + ':' + fr[0].data.width; });
    assert(frames === '5:360', 'frames ' + frames);
    const gif = await H.ev(async () => { const S = window.Gesso, d = S.app.doc; const fr = await S.Anim.renderFrames(d, 0.25, {}); const b = window.AnimEnc.gif(fr, { loop: 0 }); return b.size; });
    assert(gif > 2000, 'gif bytes ' + gif);
    const e = errsAt(); assert(!e.length, e.join(' | ').slice(0, 400));
  });

  await H.step('perspective crop the whole thing (frames still attached), history brush restores pixels', async () => {
    await H.ev(() => { const S = window.Gesso, d = S.app.doc; d.commit('Perspective Crop', () => S.Ops.perspectiveCrop(d, [{ x: 40, y: 30 }, { x: 680, y: 60 }, { x: 700, y: 520 }, { x: 20, y: 500 }], 640, 480)); });
    const sz = await H.ev(() => [Gesso.app.doc.width, Gesso.app.doc.height]); assert(sz[0] === 640 && sz[1] === 480, 'size ' + sz);
    await H.ev(() => { Gesso.Tools.select('historyBrush'); const t = Gesso.app.tool; t.opts.size = 60; t.opts.source = 'open'; Gesso.app.doc.setActive(Gesso.app.doc.layers[0].id); });
    await H.dragDoc([[100, 100], [300, 120]], { steps: 12 });
    const hist = await H.ev(() => Gesso.app.doc.history.entries[Gesso.app.doc.history.index].name);
    assert(hist === 'History Brush', 'stroke recorded: ' + hist);
    // switching animation frames still works after the crop (positions no longer match but must not throw)
    await H.ev(() => { const S = window.Gesso, d = S.app.doc, a = S.Anim.get(d); S.Anim.goto(d, a.frames[2].id); S.Anim.goto(d, a.frames[0].id); });
    const e = errsAt(); assert(!e.length, e.join(' | ').slice(0, 400));
  });

  await H.step('undo to the beginning and redo to the end without errors; document ends consistent', async () => {
    const r = await H.ev(() => { const S = window.Gesso, d = S.app.doc; let u = 0, rd = 0; while (d.history.index > 0 && u < 200) { S.Cmd.run('edit.undo'); u++; } const w0 = d.width; while (d.history.index < d.history.entries.length - 1 && rd < 200) { S.Cmd.run('edit.redo'); rd++; } return { u, rd, w0, w: d.width, h: d.height, frames: S.Anim.get(d) ? S.Anim.get(d).frames.length : 0, layers: d.layers.length }; });
    assert(r.u >= 8 && r.rd === r.u && r.w0 === 1600 && r.w === 640 && r.h === 480 && r.frames === 5 && r.layers === 2, JSON.stringify(r));
    const e = errsAt(); assert(!e.length, e.join(' | ').slice(0, 400));
  });

  await H.step('save/load round trip keeps layers, animation, blend-if', async () => {
    const r = await H.ev(async () => { const S = window.Gesso, d = S.app.doc; const j = await S.FileIO.serialize(d); const d2 = await S.FileIO.loadProject(JSON.parse(JSON.stringify(j)), 'x', { noAdd: true }); return { layers: d2.layers.length, frames: d2.anim.frames.length, bi: !!d2.layers.find((l) => l.blendIf && l.blendIf.on), w: d2.width }; });
    assert(r.layers === 2 && r.frames === 5 && r.bi && r.w === 640, JSON.stringify(r));
  });
  await H.finish();
})();
