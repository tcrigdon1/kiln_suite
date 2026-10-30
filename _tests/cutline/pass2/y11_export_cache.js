// pass2 y11: export extras verified by ffprobe/unzip — presets in the dialog, estimated size, GIF, PNG sequence ZIP,
// contact sheet PNG, HEVC/AV1 only when the encoder exists, batch queue persisting across a reload; and the
// preview render cache (Render In to Out) with its timeline render bar.
const H = require('./plib');
const fs = require('fs');
const { execSync } = require('child_process');
const OUT = H.path.join(__dirname, 'out') + '/';
function sh(cmd) { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
async function blobToFile(p, expr, file) { const b64 = await p.evaluate(expr); fs.writeFileSync(file, Buffer.from(b64, 'base64')); return fs.statSync(file).size; }
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('y11');
  await H.boot(p, '?test=1');
  await H.importUI2(p, ['track.webm']);
  await p.evaluate(() => {
    const C = Cutline, P = C.P, T = C.T;
    C.edit('setup', (s, prj) => { s.w = 640; s.h = 360; const m = prj.media.find(x => x.name === 'track.webm'); T.placeMedia(s, m, 0, P.vtracks(s)[0].id, null, 'overwrite', 0, 4); s.markers.push({ id: 'm1', f: 15, name: 'Intro', color: '#f0913a', note: '', dur: 0 }, { id: 'm2', f: 75, name: 'Mid', color: '#f0913a', note: '', dur: 0 }); s.inF = 30; s.outF = 60; });
  });
  await p.waitForTimeout(300);

  /* ---------- export dialog: presets, estimate, optional codecs ---------- */
  await p.keyboard.press('Control+m');
  await p.waitForSelector('.dialog:has-text("Export")');
  await p.waitForTimeout(700);
  const presetOpts = await p.evaluate(() => Array.from(document.querySelectorAll('.dialog select')[0].options).map(o => o.textContent));
  H.ok(presetOpts.some(t => /YouTube 1080p/.test(t)) && presetOpts.some(t => /YouTube 4K/.test(t)) && presetOpts.some(t => /Vertical short/.test(t)) && presetOpts.some(t => /Podcast/.test(t)), 'export dialog offers YouTube 1080p / 4K, vertical short and podcast presets');
  await p.selectOption('.dialog select >> nth=0', 'shorts');
  await p.waitForTimeout(600);
  const afterPreset = await p.evaluate(() => { const sel = document.querySelectorAll('.dialog select'); const sum = document.querySelector('.export-summary').textContent; return { fmt: sel[1].value, res: sel[2].options[sel[2].selectedIndex].textContent, summary: sum }; });
  H.info('after preset: ' + JSON.stringify(afterPreset));
  H.ok(/1080\s*[×x]\s*1920|Custom|1080/.test(afterPreset.res) && /Estimated size ≈ [\d.]+ (MB|KB)/.test(afterPreset.summary), 'vertical preset sets the resolution and the summary shows an estimated file size');
  const codecs = await p.evaluate(async () => { const C = Cutline; const sel = document.querySelectorAll('.dialog select')[1]; const names = Array.from(sel.options).map(o => o.textContent + (o.disabled ? ' [disabled]' : '')); const hevc = await C.Export.findVideoConfig('hevc', 1280, 720, 30, 4e6, 'variable'); const av1 = await C.Export.findVideoConfig('av1', 1280, 720, 30, 4e6, 'variable'); return { names, hevc: !!hevc, av1: !!av1 }; });
  H.info('codecs: ' + JSON.stringify(codecs));
  const hevcListed = codecs.names.some(n => /H\.265/.test(n) && !/\[disabled\]/.test(n)), av1Listed = codecs.names.some(n => /AV1/.test(n) && !/\[disabled\]/.test(n));
  H.ok(hevcListed === codecs.hevc && av1Listed === codecs.av1, 'HEVC / AV1 formats are selectable exactly when VideoEncoder.isConfigSupported allows (hevc ' + codecs.hevc + ', av1 ' + codecs.av1 + ')');
  await H.shot(p, 'export-dialog');
  // queue an item, then another from a second format; the queue survives a reload
  await p.click('.dialog-foot .btn:has-text("Add to Batch Queue")');
  await p.waitForSelector('.dialog:has-text("Batch")');
  await H.shot(p, 'batch-queue');
  await p.evaluate(() => Cutline.ui.openDialogs.slice().forEach(d => d.close()));
  const q1 = await p.evaluate(() => ({ n: Cutline.Export.queue.length, ls: Object.keys(JSON.parse(localStorage.getItem('cutline.exportQueue') || '{}')).length }));
  H.ok(q1.n === 1 && q1.ls === 1, 'batch queue item stored (queue persisted to localStorage)');
  await p.evaluate(() => { Cutline.util.lsSet('tourDone', true); Cutline.IO.autosaveNow(); });
  await H.boot(p);
  await p.click('.welcome .side button:has-text("Recover")');
  await p.waitForFunction(() => Cutline.state.project && Cutline.Export.queue.length === 1, null, { timeout: 20000 });
  await p.evaluate(() => Cutline.ui.openDialogs.slice().forEach(d => d.close()));
  const q2 = await p.evaluate(() => Cutline.Export.queue.map(x => [x.status, x.st.format, x.st.w, x.st.h]));
  H.info('restored queue: ' + JSON.stringify(q2));
  H.ok(q2.length === 1 && q2[0][0] === 'queued' && q2[0][2] === 1080 && q2[0][3] === 1920, 'batch queue restored after reload with its settings');
  await p.evaluate(() => { Cutline.Export.queue = []; Cutline.Export.persistQueue(); });

  /* ---------- GIF ---------- */
  await p.waitForFunction(() => Cutline.state.project.media.every(m => m.type === 'gen' || Cutline.Media.isOnline(m)), null, { timeout: 20000 });
  const gifSize = await blobToFile(p, async () => { const C = Cutline, s = C.P.seq(); const st = { format: 'gif', res: 'custom', w: 320, h: 180, fps: 10, quality: 'high', range: 'inout', audio: false, captions: false, name: 'y11', seqId: s.id, dither: true }; const r = await C.Export.run(st, () => { }, { v: false }, null); const ab = await r.blob.arrayBuffer(); const u = new Uint8Array(ab); let s64 = ''; for (let i = 0; i < u.length; i += 0x8000) s64 += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s64); }, OUT + 'y11.gif');
  const gifProbe = JSON.parse(sh(`ffprobe -v error -count_frames -show_entries stream=codec_name,width,height,nb_read_frames -of json ${OUT}y11.gif`)).streams[0];
  H.info('gif: ' + gifSize + ' bytes ' + JSON.stringify(gifProbe));
  H.ok(gifProbe.codec_name === 'gif' && gifProbe.width === 320 && gifProbe.height === 180 && +gifProbe.nb_read_frames === 10, 'GIF export: 1 s In→Out at 10 fps decodes as 10 frames of 320×180');
  sh(`ffmpeg -v error -y -i ${OUT}y11.gif -vf "select=eq(n\\,5)" -vframes 1 ${OUT}y11_gif5.png`);
  const raw = execSync(`ffmpeg -v error -i ${OUT}y11_gif5.png -f rawvideo -pix_fmt rgb24 -`);
  let orange = 0; for (let i = 0; i < raw.length; i += 3) if (raw[i] > 180 && raw[i + 2] < 100) orange++;
  H.ok(orange > 300, 'GIF frame contains the orange square (' + orange + ' px)');

  /* ---------- PNG sequence ZIP ---------- */
  const zipSize = await blobToFile(p, async () => { const C = Cutline, s = C.P.seq(); const st = { format: 'png-seq', res: 'custom', w: 160, h: 90, fps: 30, quality: 'high', range: 'inout', audio: false, captions: false, name: 'y11', seqId: s.id }; const r = await C.Export.run(st, () => { }, { v: false }, null); const ab = await r.blob.arrayBuffer(); const u = new Uint8Array(ab); let s64 = ''; for (let i = 0; i < u.length; i += 0x8000) s64 += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s64); }, OUT + 'y11.zip');
  const listing = sh(`cd ${OUT} && rm -rf y11seq && mkdir y11seq && cd y11seq && unzip -q ../y11.zip && ls | sort`).split('\n');
  const png0 = JSON.parse(sh(`ffprobe -v error -show_entries stream=codec_name,width,height -of json ${OUT}y11seq/${listing[0]}`)).streams[0];
  H.info('zip: ' + zipSize + ' bytes, ' + listing.length + ' files, first ' + listing[0] + ' ' + JSON.stringify(png0));
  H.ok(listing.length === 30 && png0.codec_name === 'png' && png0.width === 160 && /0*1\.png$|0+\.png$/.test(listing[0]), 'PNG sequence ZIP holds 30 numbered 160×90 PNGs');

  /* ---------- contact sheet ---------- */
  const csSize = await blobToFile(p, async () => { const C = Cutline, s = C.P.seq(); const blob = await C.ExportExtras.contactSheet(s, { cols: 3, rows: 2, tw: 160, src: 'markers' }, () => { }); const ab = await blob.arrayBuffer(); const u = new Uint8Array(ab); let s64 = ''; for (let i = 0; i < u.length; i += 0x8000) s64 += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s64); }, OUT + 'y11_sheet.png');
  const cs = JSON.parse(sh(`ffprobe -v error -show_entries stream=codec_name,width,height -of json ${OUT}y11_sheet.png`)).streams[0];
  H.info('contact sheet: ' + csSize + ' bytes ' + JSON.stringify(cs));
  H.ok(cs.codec_name === 'png' && cs.width === 3 * 170 + 10 && cs.height > 100, 'contact sheet PNG has a 3-column grid (' + cs.width + '×' + cs.height + ')');
  // YouTube chapter text from markers
  const chap = await p.evaluate(() => Cutline.A.chaptersText ? Cutline.A.chaptersText(Cutline.P.seq()) : null);
  if (chap != null) H.ok(/^0:00 /.test(chap) && /Mid/.test(chap), 'chapters text starts at 0:00 and lists the markers');

  /* ---------- render cache ---------- */
  await p.evaluate(() => { const C = Cutline; C.edit('range', s => { s.inF = 0; s.outF = 45; }); C.Engine.seek(0); });
  await H.menu(p, 'Sequence', 'Render In to Out');
  await p.waitForFunction(() => !document.querySelector('.dialog'), null, { timeout: 120000 });
  await p.waitForTimeout(400);
  const rc1 = await p.evaluate(() => { const C = Cutline; return { n: C.RenderCache.n, ranges: C.RenderCache.ranges(), bytes: C.RenderCache.bytes }; });
  H.info('render cache: ' + JSON.stringify(rc1));
  H.ok(rc1.n === 45 && rc1.ranges.length === 1 && rc1.ranges[0][0] === 0 && rc1.ranges[0][1] === 45, 'Render In to Out cached 45 frames');
  // the timeline shows a green bar under the ruler across the rendered range
  const bar = await p.evaluate(() => { const C = Cutline, TL = C.TL, cv = TL.canvas, g = cv.getContext('2d'), dpr = window.devicePixelRatio || 1; const x = Math.round((TL.f2x(20)) * dpr), y = Math.round((TL.RULER - 2) * dpr); const d = g.getImageData(x, y, 1, 1).data; const x2 = Math.round((TL.f2x(100)) * dpr); const d2 = g.getImageData(x2, y, 1, 1).data; return { on: [d[0], d[1], d[2]], off: [d2[0], d2[1], d2[2]] }; });
  H.info('render bar pixels: ' + JSON.stringify(bar));
  H.ok(bar.on[1] > 150 && bar.on[0] < 100, 'timeline render bar is green over the rendered frames');
  await H.shot(p, 'render-bar');
  // cached frame is shown (presentBitmap) and matches a live render
  const same = await p.evaluate(() => { const C = Cutline; C.Engine.seek(20); C.Engine.renderNow(); const a = Array.from(C.Engine.comp.readSmall(16, 9)); const bm = C.RenderCache.frame(C.P.seq(), 20); C.RenderCache.clear(); C.Engine.renderNow(); const b2 = Array.from(C.Engine.comp.readSmall(16, 9)); let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b2[i]); return { hadBitmap: !!bm, meanDiff: d / a.length }; });
  H.info('cached vs live: ' + JSON.stringify(same));
  H.ok(same.hadBitmap && same.meanDiff < 12, 'a cached frame looks like the live render (mean diff ' + same.meanDiff.toFixed(1) + ')');
  // an edit invalidates the cache
  await p.evaluate(() => { const C = Cutline; C.edit('range', s => { s.inF = 0; s.outF = 15; }); });
  await H.menu(p, 'Sequence', 'Render In to Out');
  await p.waitForFunction(() => !document.querySelector('.dialog'), null, { timeout: 60000 });
  const inv = await p.evaluate(() => { const C = Cutline; const before = C.RenderCache.n; C.edit('move', s => { s.clips[0].start += 1; }); return { before, after: C.RenderCache.n }; });
  H.ok(inv.before === 15 && inv.after === 0, 'editing the sequence clears the render cache (' + inv.before + ' → ' + inv.after + ')');
  await H.finish(b, errs, 'y11_export_cache');
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
