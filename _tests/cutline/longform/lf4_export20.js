// Long-form #4 — a 20-minute edit (10 pieces spread across the 10-hour source) exported through the Export dialog at
// 640x360, streamed to disk through showSaveFilePicker (fake handle -> real file, positioned writes for the header
// patches). Checks memory stays bounded, measures speed, and verifies the file (frames, duration, A/V sync).
const L = require('./lflib');
const { execFileSync } = require('child_process');
const SEG = 150.008, FILE = process.argv[2] || 'vod10h.mp4', FMT = process.argv[3] || 'webm-vp9';
const OUTDIR = L.OUT + 'export20/';
(async () => {
  require('fs').rmSync(OUTDIR, { recursive: true, force: true });
  const { b, p, errs, cdp } = await L.launch({ fakeFS: OUTDIR });
  await L.boot(p); await L.newProjectUI(p, { w: 1280, h: 720, fps: 30 });
  await L.importUI(p, [FILE]);
  await p.waitForFunction(() => { const C = Cutline; return C.state.project.media.length === 1 && C.MRT[C.state.project.media[0].id].status === 'ready'; }, null, { timeout: 60000 });
  // 10 x 2-minute pieces from across the 10 hours (setup through the model; the hands-on test covers the UI path)
  const pieces = [5, 30, 55, 80, 105, 130, 155, 180, 205, 230].map(k => [k * SEG + 10, 120]);
  await p.evaluate((pieces) => {
    const C = Cutline, m = C.state.project.media[0];
    C.edit('Build 20 min edit', function (s) { let pos = 0; pieces.forEach(([a, len]) => { const r = C.T.placeMedia(s, m, pos, C.P.vtracks(s)[0].id, C.P.atracks(s)[0].id, 'overwrite', a, a + len); pos = r[0].start + r[0].dur; }); });
    C.bus.emit('sequence');
  }, pieces);
  const sq = await p.evaluate(() => { const s = Cutline.P.seq(); return { fps: s.fps, dur: Cutline.P.seqDuration(s), clips: s.clips.length }; });
  // the actual source in-points (placing snaps them to the source frame grid, up to half a frame from the typed times)
  const actual = await p.evaluate(() => { const s = Cutline.P.seq(); return s.clips.filter(c => c.kind === 'video').sort((x, y) => x.start - y.start).map(c => [c.in, c.dur / s.fps]); });
  actual.forEach((x, i) => { pieces[i] = x; });
  L.ok(Math.abs(sq.dur / sq.fps - 1200) < 0.05 && sq.clips === 20, 'sequence: 20:00 from 10 pieces of the 10-hour VOD (' + sq.dur + ' frames @ ' + sq.fps + ' fps)');
  // Export dialog via the keyboard shortcut; 640x360 (50%), 30 fps, Low quality
  await p.click('.tl-scroll'); await p.keyboard.press('Control+m');
  await p.waitForSelector('.dialog:has-text("Export")');
  const dlg = p.locator('.modal-backdrop').last(), sels = dlg.locator('select');
  await sels.nth(1).selectOption(FMT); await sels.nth(2).selectOption('half'); await sels.nth(4).selectOption('low'); // nth(0) = delivery Preset
  const nm = dlg.locator('input[type=text]').first(); await nm.click({ clickCount: 3 }); await p.keyboard.type('edit20');
  const summary = await dlg.locator('.export-summary').innerText();
  L.ok(/straight to disk/.test(summary), 'export dialog says the file is written straight to disk while rendering');
  const t0 = Date.now();
  let progressSeen = '';
  const mem = await L.withMem(b, cdp, async () => {
    await dlg.locator('.dialog-foot .btn.primary:has-text("Export")').click();
    await p.waitForSelector('.cl-progress-text', { timeout: 30000 });
    for (;;) {
      await p.waitForTimeout(5000);
      const st = await p.evaluate(() => { const t = document.querySelector('.cl-progress-text'); return t ? t.textContent : null; });
      if (st === null) break; // progress dialog gone (an empty text only means the first frame is still being prepared)
      if (st && !progressSeen) L.info('first progress after ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s: ' + st);
      if (st) progressSeen = st;
      if (process.env.SHOW_PROGRESS) console.log('   ', st);
    }
  }, 1000);
  const secs = (Date.now() - t0) / 1000;
  const fe = Object.values(L.fsLog.files)[0];
  L.info('20-minute export (' + FMT + ', 640x360 @ 30 fps): ' + secs.toFixed(0) + ' s = ' + (36000 / secs).toFixed(1) + ' frames/s (' + (1200 / secs).toFixed(2) + 'x real time); last progress line: "' + progressSeen + '"');
  L.info('memory during export: JS heap peak ' + mem.heap.toFixed(0) + ' MB, renderer RSS peak ' + mem.rss.toFixed(0) + ' MB; ' + L.fsLog.writes + ' writes, ' + (L.fsLog.bytes / 1048576).toFixed(1) + ' MB, ' + (fe ? fe.patches : 0) + ' positioned header patches');
  L.ok(/ETA|left/.test(progressSeen) || /Frame/.test(progressSeen), 'progress shows frames, speed and time left');
  L.ok(mem.rss < 1500, 'memory bounded while exporting 20 minutes (' + mem.rss.toFixed(0) + ' MB RSS)');
  L.ok(fe && fe.closed && fe.patches >= 2, 'output streamed to the file handle with header patches written by seeking back');
  const ext = FMT.indexOf('mp4') === 0 ? 'mp4' : 'webm', f = OUTDIR + 'edit20.' + ext;
  const pr = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height,nb_read_frames', '-count_frames', '-of', 'json', f]).toString());
  const v = pr.streams.find(s => s.width), a = pr.streams.find(s => !s.width);
  L.ok(v && v.width === 640 && v.height === 360 && +v.nb_read_frames === 36000 && a && a.codec_name === 'opus' && Math.abs(parseFloat(pr.format.duration) - 1200) < 0.05,
    'ffprobe: ' + (v && v.codec_name) + ' ' + (v && v.width) + 'x' + (v && v.height) + ', ' + (v && v.nb_read_frames) + ' frames, ' + (a && a.codec_name) + ', ' + parseFloat(pr.format.duration).toFixed(3) + ' s, ' + (require('fs').statSync(f).size / 1048576).toFixed(1) + ' MB');
  const dec = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'null', '-']).toString();
  L.ok(!dec.trim(), 'the 20-minute file decodes cleanly');
  const src = L.MEDIA + FILE, checks = [];
  for (const tOut of [5, 245.5, 601.25, 959, 1195]) {
    const i = Math.floor(tOut / 120), srcT = pieces[i][0] + (tOut - i * 120);
    const got = L.ffCode(f, tOut + 0.001, 640, 360), exp = L.ffCode(src, srcT + 0.001);
    checks.push({ tOut, d: L.frameDiff(got, exp), s: got.hour + ':' + got.frame + '/' + exp.hour + ':' + exp.frame });
  }
  L.ok(checks.every(c => c.d <= 2), 'frames at 0:05, 4:05, 10:01, 15:59, 19:55 come from the right source times: ' + checks.map(c => c.s).join(' '));
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  const pcm = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4), res = [];
  pieces.forEach(([a0], i) => { for (const off of [37, 112]) { const k = Math.floor(a0 / SEG), t = i * 120 + (L.ffVideoTimeOfCode(src, k * SEG + off, off === 37 ? 2220 : 6720) - a0); const s0 = Math.round((t - 1) * 48000); let on = -1; for (let j = s0; j < s0 + 96000; j++) if (Math.abs(pcm[j]) > 0.25) { on = j / 48000; break; } res.push(Math.abs(on - t)); } });
  L.ok(res.every(e => e < 0.005), 'A/V sync: all 20 loud bursts land on the video frames generated with them (max error ' + (Math.max(...res) * 1000).toFixed(1) + ' ms) — audio was mixed in blocks from streamed decodes');
  const n = L.done(errs);
  await b.close();
  process.exit(n ? 1 : 0);
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
