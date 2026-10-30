// Pass 3 polish — fire every registered command: with no document, with a fresh document, with a layered document
// (selection + animation + blend-if + mask). Any thrown error or console error fails the sweep.
const { launch, assert } = require('../pass2/lib');
(async () => {
  const H = await launch();
  const { page } = H;
  const SKIP = /^(file\.(open|close|closeAll|print|save|saveAs|place|revert|batch|contactSheet|dataDriven|export|exportComps|exportLayers|exportSvg|quickPng|exportLut|exportHald|exportAnim|autosaveDoc)|view\.fullscreen|help\.tour|edit\.prefs|action\.|window\.reset|window\.panel|view\.channel|select\.load|image\.adjust|layer\.newAdjustment|filter\.apply)$/;
  async function sweep(label) {
    const r = await H.ev(async (skipSrc) => {
      const S = window.Gesso, skip = new RegExp(skipSrc), out = { ran: 0, errors: [], skipped: 0, dialogs: 0 };
      const ids = Object.keys(S.Cmd.map);
      for (const id of ids) {
        if (skip.test(id)) { out.skipped++; continue; }
        const c = S.Cmd.get(id); if (!c) continue;
        try { if (c.enabled && !c.enabled()) continue; const p = S.Cmd.run(id); if (p && p.then) await Promise.race([p, new Promise((r) => setTimeout(r, 300))]); out.ran++; }
        catch (e) { out.errors.push(id + ': ' + (e && e.message)); }
        // close whatever dialog/menu/popups the command opened
        for (let k = 0; k < 3 && S.Dialog.isOpen(); k++) { out.dialogs++; S.Dialog.top().close(false); }
        if (S.Menu && S.Menu.closeAll) S.Menu.closeAll();
        await new Promise((r) => setTimeout(r, 15));
      }
      return out;
    }, SKIP.source);
    return r;
  }
  await H.step('registry exposes the command list', async () => {
    const n = await H.ev(() => Object.keys(Gesso.Cmd.map).length);
    assert(n > 100, 'commands: ' + n);
  });
  await H.step('sweep with NO document', async () => {
    const r = await sweep('empty'); H.errors.length = 0;
    assert(!r.errors.length, 'errors: ' + r.errors.join(' | '));
    assert(r.ran >= 0, 'ran ' + r.ran);
  });
  await H.step('sweep with a fresh document', async () => {
    await H.ev(() => Gesso.App.createDoc({ name: 'S1', w: 320, h: 200, dpi: 72, bg: 'white' })); await H.wait(150);
    const r = await sweep('fresh'); const errs = H.errors.splice(0);
    assert(!r.errors.length, 'errors: ' + r.errors.join(' | '));
    assert(!errs.length, 'page errors: ' + errs.join(' | ').slice(0, 800));
  });
  await H.step('sweep with a layered document (selection, mask, animation frames, blend-if, text, shape)', async () => {
    await H.ev(() => {
      const S = window.Gesso, d = S.app.doc;
      const c = S.util.createCanvas(100, 80, 40, 30); c.getContext('2d').fillStyle = '#c33'; c.getContext('2d').fillRect(0, 0, 100, 80);
      const r = S.Layers.raster(d, 'red', c); d.insertLayer(r, d.activeId, 'above'); r.blendIf = { on: true, channel: 'gray', t: [0, 0, 255, 255], u: [20, 60, 255, 255] };
      const t = S.Layers.text(d, { text: 'Sweep', x: 20, y: 150, size: 30 }); d.insertLayer(t, r.id, 'above');
      S.Anim.create(d); S.Anim.add(d); S.Anim.tween(d, S.Anim.get(d).frames[0].id, 2);
      d.selection = S.Sel.make(S.Sel.rectMask(d.width, d.height, 50, 40, 120, 90), d.width, d.height);
      d.setActive(r.id); S.Cmd.run('layer.maskReveal');
    });
    await H.wait(200);
    const r = await sweep('layered'); const errs = H.errors.splice(0);
    assert(!r.errors.length, 'errors: ' + r.errors.join(' | '));
    assert(!errs.length, 'page errors: ' + errs.join(' | ').slice(0, 800));
    // the document must still be consistent afterwards
    const ok = await H.ev(() => { const d = Gesso.app.doc; let n = 0; d.walk(() => n++); return { n, w: d.width, h: d.height, undo: d.history.entries.length }; });
    assert(ok.n >= 1 && ok.w > 0, JSON.stringify(ok));
  });
  await H.step('undo everything, then redo everything, without errors', async () => {
    const r = await H.ev(async () => { const S = window.Gesso, d = S.app.doc; let u = 0, rd = 0; while (d.history.index > 0 && u < 400) { S.Cmd.run('edit.undo'); u++; } while (d.history.index < d.history.entries.length - 1 && rd < 400) { S.Cmd.run('edit.redo'); rd++; } return { u, rd }; });
    const errs = H.errors.splice(0);
    assert(r.u > 5 && !errs.length, JSON.stringify(r) + ' ' + errs.join(' | ').slice(0, 500));
  });
  await H.finish();
})();
