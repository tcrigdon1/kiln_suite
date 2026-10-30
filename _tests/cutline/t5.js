const { TMP } = require('../env.js');
const { launch, newProject, importFiles, MEDIA } = require('./lib');
function assert(c, m) { if (!c) throw new Error('ASSERT: ' + m); console.log('  ok -', m); }
(async () => {
  const { b, p, errs } = await launch();
  try {
    await newProject(p);
    await importFiles(p, ['test1.webm', 'bars.webm', 'green.png']);
    const mid = n => p.evaluate(n => Cutline.state.project.media.find(m => m.name === n).id, n);
    // source monitor: open, mark in/out, insert
    await p.dblclick(`.bin-item[data-id="${await mid('test1.webm')}"]`);
    await p.waitForTimeout(500);
    await p.evaluate(() => { Cutline.Source.seek(2); });
    await p.waitForTimeout(200);
    await p.click('#p-source .mon-view'); // focus source
    await p.keyboard.press('i');
    await p.evaluate(() => { Cutline.Source.seek(4); }); await p.waitForTimeout(200);
    await p.keyboard.press('o');
    const mk = await p.evaluate(() => Cutline.Source.marks());
    console.log('marks', JSON.stringify(mk));
    assert(Math.abs(mk.inSec - 2) < 0.05 && Math.abs(mk.outSec - 4.033) < 0.05, 'source in/out');
    await p.keyboard.press(',');
    let cl = await p.evaluate(() => Cutline.P.seq().clips.map(c => [c.kind, c.start, c.dur, +c.in.toFixed(2)]));
    console.log(JSON.stringify(cl));
    assert(cl.length === 2 && cl[0][2] === 61 && cl[0][3] === 2, 'insert from source with marks');
    await p.screenshot({ path: 'shots/30-source.png' });
    // insert again at playhead 0 -> pushes
    await p.evaluate(() => Cutline.Engine.seek(0));
    await p.keyboard.press(',');
    cl = await p.evaluate(() => Cutline.P.seq().clips.filter(c => c.kind === 'video').map(c => c.start).sort((a, b) => a - b));
    assert(cl[0] === 0 && cl[1] === 61, 'insert ripples existing clips');
    // green screen on V2 with chroma key
    await p.evaluate(() => { const C = Cutline; C.edit('g', s2 => { const m = C.state.project.media.find(x => x.name === 'green.png'); const r = C.T.placeMedia(s2, m, 0, C.P.vtracks(s2)[1].id, null, 'overwrite'); r[0].fx.push(C.FX.newInstance('chromakey')); r[0].tf.scale = 50; }); C.A.select([C.P.seq().clips.find(c => c.mediaId === C.state.project.media.find(x => x.name === 'green.png').id).id]); C.Engine.seek(20); });
    await p.waitForTimeout(500);
    // transform drag in program monitor: drag center to the right
    const ov = await p.locator('#p-program canvas.overlay').boundingBox();
    await p.mouse.move(ov.x + ov.width / 2, ov.y + ov.height / 2); await p.mouse.down();
    await p.mouse.move(ov.x + ov.width / 2 + ov.width * 0.2, ov.y + ov.height / 2, { steps: 5 }); await p.mouse.up();
    const tx = await p.evaluate(() => Cutline.P.primaryClip().tf.x);
    console.log('pos x', tx);
    assert(tx > 640 + 200, 'on-canvas move handle');
    // corner scale
    const corner = await p.evaluate(() => { const C = Cutline, s = C.P.seq(), c = C.P.primaryClip(); const L = C.Scene.clipLayer(s, c, C.Engine.frame); const q = C.Scene.quad(s, L); return q.full[2]; });
    const k = ov.width / 1280;
    await p.mouse.move(ov.x + corner[0] * k, ov.y + corner[1] * k); await p.mouse.down();
    await p.mouse.move(ov.x + corner[0] * k + 40, ov.y + corner[1] * k + 25, { steps: 5 }); await p.mouse.up();
    const sc = await p.evaluate(() => Cutline.P.primaryClip().tf.scale);
    console.log('scale', sc);
    assert(sc > 55, 'on-canvas corner scale');
    await p.waitForTimeout(400);
    await p.screenshot({ path: 'shots/31-chroma-transform.png' });
    // JKL
    await p.click('#p-timeline .tl-area', { position: { x: 5, y: 5 } }).catch(() => { });
    await p.evaluate(() => { Cutline.state.focus = 'timeline'; Cutline.Engine.seek(30); });
    await p.keyboard.press('l'); await p.keyboard.press('l');
    const rate = await p.evaluate(() => Cutline.Engine.rate);
    await p.waitForTimeout(500);
    await p.keyboard.press('k');
    const f1 = await p.evaluate(() => Cutline.Engine.frame);
    console.log('rate', rate, 'frame', f1);
    assert(rate === 2 && f1 > 45, 'JKL shuttle 2x');
    await p.keyboard.press('j'); await p.waitForTimeout(400); await p.keyboard.press('k');
    const f2 = await p.evaluate(() => Cutline.Engine.frame);
    assert(f2 <= f1, 'J plays reverse (' + f1 + '->' + f2 + ')');
    // title text edit through inspector
    await p.evaluate(() => { Cutline.Engine.seek(10); Cutline.A.addTitleAtPlayhead(null, null, 'lower'); });
    await p.waitForTimeout(300);
    await p.click('.tabs .tab[data-id="inspector"]');
    const ta = p.locator('.cl-textfield textarea').first();
    await ta.fill('Edited Name');
    await ta.press('Tab');
    const txt = await p.evaluate(() => { const c = Cutline.P.primaryClip(); return c.gen.layers.map(l => l.text).join('|'); });
    console.log('title layers', txt);
    assert(/Edited Name/.test(txt), 'title text edited via inspector');
    await p.evaluate(() => Cutline.Engine.seek(40)); await p.waitForTimeout(400);
    await p.screenshot({ path: 'shots/32-lowerthird.png' });
    // transition inspector
    await p.evaluate(() => { const C = Cutline; const s = C.P.seq(); const v = s.clips.filter(c => c.kind === 'video' && C.P.vtracks(s)[0].id === c.trackId).sort((a, b) => a.start - b.start); C.Engine.seek(v[1].start); C.edit('tr', s2 => { C.A.placeTransition(s2, C.P.clip(s2, v[1].id), 'in', 'wipe', 30); }); C.state.selTransition = C.P.seq().transitions[0].id; C.state.selection = []; C.bus.emit('selection'); C.Engine.seek(v[1].start + 3); });
    await p.waitForTimeout(400);
    await p.screenshot({ path: 'shots/33-transition.png' });
    // new sequence
    await p.evaluate(() => Cutline.A.newSequence());
    await p.waitForTimeout(200);
    await p.click('.preset[data-w="1080"][data-h="1920"]');
    await p.click('.dialog-foot .btn.primary');
    const seqs = await p.evaluate(() => Cutline.state.project.sequences.map(s => s.w + 'x' + s.h));
    assert(seqs.length === 2 && seqs[1] === '1080x1920', 'new vertical sequence');
    await p.evaluate(() => { const C = Cutline; C.edit('v', s2 => { C.T.placeMedia(s2, C.state.project.media[0], 0, C.P.vtracks(s2)[0].id, null, 'overwrite'); }); C.Engine.seek(15); });
    await p.waitForTimeout(500);
    await p.screenshot({ path: 'shots/34-vertical.png' });
    // switch back
    await p.click('.seq-tab >> nth=0');
    assert(await p.evaluate(() => Cutline.P.seq().w) === 1280, 'switch sequence tabs');
    // export via UI with download
    await p.evaluate(() => { window.showSaveFilePicker = undefined; const s = Cutline.P.seq(); Cutline.edit('io', s2 => { s2.inF = 0; s2.outF = 45; }); });
    await p.keyboard.press('Control+m'); await p.waitForTimeout(500);
    await p.selectOption('.dialog select >> nth=2', 'half');
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }), p.click('.dialog-foot .btn.primary')]);
    await dl.saveAs(TMP + '/ui-export.webm');
    console.log('  ok - export through dialog downloaded', dl.suggestedFilename());
    // autosave + recovery
    await p.evaluate(() => Cutline.IO.autosaveNow());
    await p.reload();
    await p.waitForFunction(() => window.Cutline && Cutline.ready);
    const hasRecover = await p.locator('.welcome .side button:has-text("Recover")').count();
    assert(hasRecover === 1, 'recovery offered after reload');
    await p.screenshot({ path: 'shots/35-recover.png' });
    await p.click('.welcome .side button:has-text("Recover")');
    await p.waitForTimeout(1500);
    const rec = await p.evaluate(() => ({ seqs: Cutline.state.project.sequences.length, offline: Cutline.Media.offlineMedia().length, clips: Cutline.P.seq().clips.length }));
    console.log('recovered', JSON.stringify(rec));
    assert(rec.seqs === 2 && rec.offline === 0, 'recovered project with media restored from cache');
    await p.evaluate(() => Cutline.ui.openDialogs.slice().forEach(d => d.close()));
    await p.screenshot({ path: 'shots/36-recovered.png' });
  } catch (e) { console.log('TEST ERROR', e); await p.screenshot({ path: 'shots/err.png' }); }
  console.log('ERRORS:\n' + errs.join('\n').slice(0, 3000));
  await b.close();
})();
