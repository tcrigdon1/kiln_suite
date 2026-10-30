// Long-form #6 — variable-frame-rate source conformed to the sequence rate on export (every output frame is the
// source frame on screen at that time), and Cancel during a streamed export (file handle aborted, UI recovers).
const L = require('./lflib');
const { execFileSync } = require('child_process');
const OUTDIR = L.OUT + 'vfr/';
(async () => {
  require('fs').rmSync(OUTDIR, { recursive: true, force: true });
  const { b, p, errs } = await L.launch({ fakeFS: OUTDIR });
  await L.boot(p); await L.newProjectUI(p, { w: 1280, h: 720, fps: 30 });
  await L.importUI(p, ['vfr.webm']);
  await p.waitForFunction(() => { const C = Cutline; return C.state.project.media.length === 1 && C.MRT[C.state.project.media[0].id].status === 'ready'; }, null, { timeout: 60000 });
  const m = await p.evaluate(() => { const m = Cutline.state.project.media[0]; return { fps: m.fps, vfr: !!m.vfr, avg: m.fpsAvg }; });
  L.ok(m.vfr && m.fps === 60, 'variable frame rate detected (nominal ' + m.fps + ' fps, average ' + m.avg + ' fps; dropped frames)');
  await p.evaluate(() => { const C = Cutline, md = C.state.project.media[0]; C.edit('x', s => { C.T.placeMedia(s, md, 0, C.P.vtracks(s)[0].id, C.P.atracks(s)[0].id, 'overwrite', 0, 10); }); });
  // export through the dialog (streams to the fake file handle)
  await p.click('.tl-scroll'); await p.keyboard.press('Control+m');
  await p.waitForSelector('.dialog:has-text("Export")');
  let dlg = p.locator('.modal-backdrop').last(), sels = dlg.locator('select');
  await sels.nth(2).selectOption('half'); await sels.nth(4).selectOption('low'); // nth(0) = delivery Preset, nth(1) = format
  let nm = dlg.locator('input[type=text]').first(); await nm.click({ clickCount: 3 }); await p.keyboard.type('vfr30');
  await dlg.locator('.dialog-foot .btn.primary:has-text("Export")').click();
  await p.waitForFunction(() => !document.querySelector('.cl-progress-text') && !Cutline.ui.openDialogs.length, null, { timeout: 300000, polling: 500 });
  const f = OUTDIR + 'vfr30.webm';
  const nf = +JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=nb_read_frames,width', '-of', 'json', f]).toString()).streams.find(s => s.width).nb_read_frames;
  L.ok(nf === 300, 'export at 30 fps of 10 s of the VFR source has exactly ' + nf + ' frames (constant frame rate)');
  // expected: for output frame k (t = k/30) the last source frame with pts <= t; its burned-in code = round(pts * 60)
  const pts = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', L.MEDIA + 'vfr.webm']).toString().trim().split('\n').map(Number).sort((a, b) => a - b);
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 30 });
  const W = 640, H = 360, fsz = W * H; let bad = 0, dropsCovered = 0; const ex = [];
  for (let k = 0; k < 300; k++) {
    const t = k / 30; let j = 0; while (j + 1 < pts.length && pts[j + 1] <= t + 0.0011) j++;
    const exp = Math.round(pts[j] * 60) % 9000, got = L.codeFromGray(raw.subarray(k * fsz, (k + 1) * fsz), W, H).frame;
    if (Math.round(t * 60) !== exp) dropsCovered++;
    if (got !== exp) { bad++; if (ex.length < 4) ex.push(k + ':' + got + '/' + exp); }
  }
  L.ok(bad === 0, 'every output frame shows the source frame on screen at that time — ' + dropsCovered + ' output frames fell on dropped source frames and repeat the previous one' + (bad ? ' (mismatches ' + ex.join(' ') + ')' : ''));
  // ---- Cancel a streamed export
  await p.click('.tl-scroll'); await p.keyboard.press('Control+m');
  await p.waitForSelector('.dialog:has-text("Export")');
  dlg = p.locator('.modal-backdrop').last(); sels = dlg.locator('select');
  await sels.nth(2).selectOption('seq'); await sels.nth(4).selectOption('max');
  nm = dlg.locator('input[type=text]').first(); await nm.click({ clickCount: 3 }); await p.keyboard.type('cancelme');
  await dlg.locator('.dialog-foot .btn.primary:has-text("Export")').click();
  await p.waitForSelector('.cl-progress-text'); await p.waitForTimeout(2500);
  await p.click('.dialog-foot .btn:has-text("Cancel")');
  await p.waitForFunction(() => !document.querySelector('.cl-progress-text'), null, { timeout: 60000 });
  await p.waitForTimeout(500);
  const fe = L.fsLog.files['cancelme.webm'];
  const toast = await p.evaluate(() => Array.from(document.querySelectorAll('.toast')).map(t => t.textContent).join(' | '));
  L.info('cancel: file ' + JSON.stringify(fe && { aborted: fe.aborted, closed: fe.closed, max: fe.max }) + ', toasts: ' + toast);
  L.ok(fe && fe.aborted && !require('fs').existsSync(OUTDIR + 'cancelme.webm') && /cancelled/i.test(toast), 'Cancel stops the export, aborts the file handle (partial file discarded) and reports "Export cancelled"');
  const still = await p.evaluate(() => ({ dialogs: Cutline.ui.openDialogs.length, clips: Cutline.P.seq().clips.length }));
  L.ok(still.dialogs === 0 && still.clips === 2, 'editor usable after cancelling');
  const n = L.done(errs);
  await b.close();
  process.exit(n ? 1 : 0);
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
