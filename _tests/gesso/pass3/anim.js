// Pass 3 — Frame Animation: frames record layer state, goto/record, tween, play, undo, serialize, GIF/APNG export
const { launch, assert } = require('../pass2/lib');
const fs = require('fs');
(async () => {
  const H = await launch();
  const { page } = H;
  await H.ev(() => Gesso.App.createDoc({ name: 'Anim', w: 200, h: 120, dpi: 72, bg: 'white' }));
  await H.wait(200);

  await H.step('panel + commands registered; creating an animation makes frame 1 from the current state', async () => {
    const r = await H.ev(() => {
      const S = window.Gesso, d = S.app.doc;
      // a red square layer at (20,20)
      const c = S.util.createCanvas(40, 40, 20, 20); c.getContext('2d').fillStyle = '#f00'; c.getContext('2d').fillRect(0, 0, 40, 40); const l = S.Layers.raster(d, 'Box', c); d.insertLayer(l, d.activeId, 'above');
      d.bump(l); S.Anim.create(d);
      const a = S.Anim.get(d);
      return { panel: !!S.Panels.defs.animation, cmd: !!S.Cmd.get('file.exportAnim'), frames: a && a.frames.length, cur: a && a.current === a.frames[0].id, hasBox: !!a.frames[0].layers[l.id] };
    });
    assert(r.panel && r.cmd && r.frames === 1 && r.cur && r.hasBox, JSON.stringify(r));
  });

  await H.step('new frame, move the layer, switch frames: each frame remembers its own position', async () => {
    const r = await H.ev(() => {
      const S = window.Gesso, d = S.app.doc, box = d.layers.find((l) => l.name === 'Box');
      S.Anim.add(d); // frame 2 (copy of 1)
      d.commit('move', () => { const c = S.util.cloneCanvas(box.canvas); c.ox = 120; c.oy = 60; box.canvas = c; box.opacity = 0.5; });
      const a = S.Anim.get(d), f1 = a.frames[0], f2 = a.frames[1];
      S.Anim.goto(d, f1.id); // records frame 2 then shows frame 1
      const b1 = d.layers.find((l) => l.name === 'Box');
      const pos1 = [b1.canvas.ox || 0, b1.canvas.oy || 0, b1.opacity];
      S.Anim.goto(d, f2.id);
      const b2 = d.layers.find((l) => l.name === 'Box');
      const pos2 = [b2.canvas.ox || 0, b2.canvas.oy || 0, b2.opacity];
      return { n: a.frames.length, pos1, pos2, rec2: f2.layers[box.id].pos.ox };
    });
    assert(r.n === 2 && r.pos1[0] === 20 && r.pos1[2] === 1 && r.pos2[0] === 120 && r.pos2[2] === 0.5 && r.rec2 === 120, JSON.stringify(r));
  });

  await H.step('tween inserts interpolated frames (position + opacity)', async () => {
    const r = await H.ev(() => {
      const S = window.Gesso, d = S.app.doc, a = S.Anim.get(d), box = d.layers.find((l) => l.name === 'Box');
      S.Anim.tween(d, a.frames[0].id, 3);
      const mids = a.frames.slice(1, 4).map((f) => [f.layers[box.id].pos.ox, Math.round(f.layers[box.id].opacity * 100) / 100]);
      return { n: a.frames.length, mids };
    });
    assert(r.n === 5, 'frames ' + r.n);
    assert(r.mids[0][0] === 45 && r.mids[1][0] === 70 && r.mids[2][0] === 95, 'x ' + JSON.stringify(r.mids));
    assert(Math.abs(r.mids[1][1] - 0.75) < 0.01, 'opacity ' + JSON.stringify(r.mids));
  });

  await H.step('undo removes the tween frames; redo brings them back', async () => {
    await H.ev(() => Gesso.Cmd.run('edit.undo'));
    const n1 = await H.ev(() => Gesso.Anim.get(Gesso.app.doc).frames.length);
    await H.ev(() => Gesso.Cmd.run('edit.redo'));
    const n2 = await H.ev(() => Gesso.Anim.get(Gesso.app.doc).frames.length);
    assert(n1 === 2 && n2 === 5, n1 + ' / ' + n2);
  });

  await H.step('the Animation panel shows 5 frame thumbnails; clicking one switches frames; play cycles', async () => {
    await H.ev(() => Gesso.Panels.show('animation'));
    await H.wait(400);
    const n = await page.locator('.anim-frame').count();
    assert(n === 5, 'thumbs ' + n);
    await page.locator('.anim-frame').nth(2).click(); await H.wait(200);
    const r = await H.ev(() => { const S = window.Gesso, d = S.app.doc, a = S.Anim.get(d); return { idx: a.frames.findIndex((f) => f.id === a.current), ox: d.layers.find((l) => l.name === 'Box').canvas.ox }; });
    assert(r.idx === 2 && r.ox === 70, JSON.stringify(r));
    await H.ev(() => { Gesso.Anim.setDelay(Gesso.app.doc, null, 40); Gesso.Anim.play(Gesso.app.doc); });
    await H.wait(260);
    const playing = await H.ev(() => Gesso.Anim.playing());
    const seen = await H.ev(async () => { const S = window.Gesso, d = S.app.doc; const set = new Set(); for (let i = 0; i < 8; i++) { set.add(S.Anim.get(d).current); await new Promise((r) => setTimeout(r, 45)); } return set.size; });
    await H.ev(() => Gesso.Anim.stop());
    assert(playing && seen >= 3, 'playing=' + playing + ' distinct=' + seen);
    const hist = await H.ev(() => Gesso.app.doc.history.entries.filter((h) => h.name === 'Play Animation').length);
    assert(hist <= 1, 'play coalesces into one history step: ' + hist);
  });

  await H.step('renderFrames restores the document; GIF and APNG encoders produce valid files', async () => {
    const r = await H.ev(async () => {
      const S = window.Gesso, d = S.app.doc, a = S.Anim.get(d);
      S.Anim.goto(d, a.frames[0].id);
      const before = d.layers.find((l) => l.name === 'Box').canvas.ox;
      const frames = await S.Anim.renderFrames(d, 0.5, { matte: '#ffffff' });
      const after = d.layers.find((l) => l.name === 'Box').canvas.ox;
      const gif = window.AnimEnc.gif(frames, { loop: 0, dither: true });
      const apng = await window.AnimEnc.apng(frames, { loop: 0 });
      const gb = new Uint8Array(await gif.arrayBuffer()), ab = new Uint8Array(await apng.arrayBuffer());
      const txt = (u, s, n) => String.fromCharCode.apply(null, u.subarray(s, s + n));
      // count GIF image descriptors (0x2C at frame starts after GCE) and APNG fcTL chunks
      let fc = 0; for (let i = 0; i < ab.length - 4; i++) if (ab[i] === 0x66 && ab[i + 1] === 0x63 && ab[i + 2] === 0x54 && ab[i + 3] === 0x4C) fc++;
      let gc = 0; for (let i = 0; i < gb.length - 1; i++) if (gb[i] === 0x21 && gb[i + 1] === 0xF9) gc++;
      return { n: frames.length, w: frames[0].data.width, h: frames[0].data.height, before, after, gifSig: txt(gb, 0, 6), gifFrames: gc, gifEnd: gb[gb.length - 1], apngSig: Array.from(ab.subarray(1, 4)).map((c) => String.fromCharCode(c)).join(''), acTL: txt(ab, 37, 4), fcTL: fc, gifBytes: gb.length, apngBytes: ab.length };
    });
    assert(r.n === 5 && r.w === 100 && r.h === 60, 'frames ' + JSON.stringify(r));
    assert(r.before === r.after, 'document restored');
    assert(r.gifSig === 'GIF89a' && r.gifFrames === 5 && r.gifEnd === 0x3B, 'gif ' + JSON.stringify(r));
    assert(r.apngSig === 'PNG' && r.acTL === 'acTL' && r.fcTL === 5, 'apng ' + JSON.stringify(r));
    // decode the GIF with the browser to prove it is readable
    const ok = await H.ev(async () => { const S = window.Gesso, d = S.app.doc; const frames = await S.Anim.renderFrames(d, 0.5, { matte: '#ffffff' }); const blob = window.AnimEnc.gif(frames, {}); const url = URL.createObjectURL(blob); const img = await S.util.loadImage(url); return img.naturalWidth === 100 && img.naturalHeight === 60; });
    assert(ok, 'browser decodes the GIF');
  });

  await H.step('export dialog from the menu downloads a .gif', async () => {
    await H.menu('File', 'Export', 'Animation');
    await H.wait(300);
    const dl = page.waitForEvent('download', { timeout: 20000 });
    await page.locator('.gesso-dialog .btn.primary, .gesso-dialog button.primary').last().click();
    const d = await dl; const p = await d.path();
    const buf = fs.readFileSync(p);
    assert(/\.gif$/.test(d.suggestedFilename()) && buf.subarray(0, 6).toString() === 'GIF89a', d.suggestedFilename() + ' ' + buf.length);
  });

  await H.step('animation survives save/load of the project', async () => {
    const r = await H.ev(async () => {
      const S = window.Gesso, d = S.app.doc;
      const json = await S.FileIO.serialize(d);
      const d2 = await S.FileIO.loadProject(JSON.parse(JSON.stringify(json)), 'x', { noAdd: true });
      const a = S.Anim.get(d2);
      return { n: a && a.frames.length, delays: a && a.frames.map((f) => f.delay), cur: a && a.current === d.anim.current };
    });
    assert(r.n === 5 && r.delays.every((x) => x === 40), JSON.stringify(r));
  });

  await H.finish();
})();
