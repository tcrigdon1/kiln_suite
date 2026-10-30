// Long-form #3 — hands-on "4 x 20-minute edits from one 10-hour VOD" workflow with real mouse/keyboard input:
// import the 10-hour file, scrub the Source monitor at far-apart times (frame checked against ffmpeg), Find
// Highlights (markers within 1 s of the known loud bursts), Markers list jump, subclips at 3 places, two sequences
// built from subclips, duration readout + target, playback across a cut, batch export of both sequences streamed to
// disk (fake File System Access handles -> real files), then ffprobe + frame/audio checks of the outputs.
const L = require('./lflib');
const { execFileSync } = require('child_process');
const SEG = 150.008, FILE = process.argv[2] || 'vod10h.mp4';
const OUTDIR = L.OUT + 'batch/';
function tc60(sec) { const f = Math.round(sec * 60), ff = f % 60, s = Math.floor(f / 60), p = (n) => String(n).padStart(2, '0'); return p(Math.floor(s / 3600)) + ':' + p(Math.floor(s / 60) % 60) + ':' + p(s % 60) + ':' + p(ff); }
function nearestBurst(t) { const k = Math.round((t - 37) / SEG), k2 = Math.round((t - 112) / SEG); const a = k * SEG + 37, b = k2 * SEG + 112; return Math.abs(t - a) < Math.abs(t - b) ? { t: a, kind: 'spike' } : { t: b, kind: 'sustained' }; }
(async () => {
  require('fs').rmSync(OUTDIR, { recursive: true, force: true });
  const { b, p, errs, cdp } = await L.launch({ fakeFS: OUTDIR });
  await L.boot(p); await L.newProjectUI(p, { w: 1280, h: 720, fps: 30 });
  await p.evaluate(L.PAGE_CODE);
  await L.importUI(p, [FILE]);
  await p.waitForFunction(() => { const C = Cutline; return C.state.project.media.length === 1 && C.MRT[C.state.project.media[0].id].status === 'ready'; }, null, { timeout: 60000 });
  const mid = await p.evaluate(() => Cutline.state.project.media[0].id);
  const src = L.MEDIA + FILE;

  // ---- Source monitor: open + scrub far-apart times by typing timecodes; check the displayed frame
  await p.dblclick('.bin-item[data-id="' + mid + '"]');
  await p.waitForFunction(() => Cutline.state.sourceMedia && Cutline.Source.video.readyState >= 2, null, { timeout: 30000 });
  const tcSel = '#p-source .mon-bar .tc:not(.dur)';
  for (const T of [10, 4 * 3600 + 59 * 60 + 30, 9 * 3600 + 58 * 60]) {
    const t0 = Date.now();
    await p.click(tcSel); await p.keyboard.type(tc60(T)); await p.keyboard.press('Enter');
    await p.waitForFunction((T) => { const v = Cutline.Source.video; return !v.seeking && v.readyState >= 2 && Math.abs(v.currentTime - T) < 0.02; }, T, { timeout: 20000 });
    const ms = Date.now() - t0;
    await p.waitForTimeout(150);
    const app = await p.evaluate(() => window.__readCode(Cutline.Source.video));
    const ref = L.ffCode(src, T), shown = await p.evaluate(() => Cutline.Source.tc.textContent);
    L.ok(L.frameDiff(app, ref) <= 1, 'Source monitor at ' + tc60(T) + ' shows the right frame (code ' + app.hour + ':' + app.frame + ' vs ffmpeg ' + ref.hour + ':' + ref.frame + ', TC field ' + shown + ', seek ' + ms + ' ms)');
  }
  await L.shot(p, '3-source-9h58');
  // drag-scrub across the whole 10 hours: seeks must be coalesced and a key-frame preview shown while dragging
  await p.evaluate(() => { const v = Cutline.Source.video; window.__seeks = 0; window.__kfShown = 0; v.addEventListener('seeking', () => window.__seeks++); new MutationObserver(() => { if (Cutline.Source.kfPrev.style.display !== 'none') window.__kfShown++; }).observe(Cutline.Source.kfPrev, { attributes: true }); });
  const sb = await L.center(p, '#p-source .mon-scrub');
  const x0 = sb.bb.x + 10 + (sb.bb.width - 20) * 0.1, x1 = sb.bb.x + 10 + (sb.bb.width - 20) * 0.9;
  const tDrag = Date.now();
  await p.mouse.move(x0, sb.y); await p.mouse.down();
  for (let i = 1; i <= 60; i++) { await p.mouse.move(x0 + (x1 - x0) * i / 60, sb.y); await p.waitForTimeout(16); }
  await p.mouse.up();
  await p.waitForFunction(() => !Cutline.Source.video.seeking && Cutline.Source.pendingSeek == null, null, { timeout: 20000 });
  const drag = await p.evaluate(() => ({ seeks: window.__seeks, kf: window.__kfShown, t: Cutline.Source.video.currentTime, dur: Cutline.Source.duration() }));
  L.ok(drag.seeks < 40 && Math.abs(drag.t / drag.dur - 0.9) < 0.01, 'drag-scrub over 10 h: 61 pointer moves → ' + drag.seeks + ' element seeks (coalesced), lands at ' + (drag.t / 3600).toFixed(2) + ' h in ' + ((Date.now() - tDrag) / 1000).toFixed(1) + ' s');
  L.ok(drag.kf > 0, 'key-frame preview shown while dragging (' + drag.kf + ' updates)');
  const app2 = await p.evaluate(() => window.__readCode(Cutline.Source.video));
  const ref2 = L.ffCode(src, drag.t);
  L.ok(L.frameDiff(app2, ref2) <= 1, 'after the drag the element shows the exact frame for ' + drag.t.toFixed(2) + ' s');

  // ---- Find Highlights from the Library context menu
  const bi = await L.center(p, '.bin-item[data-id="' + mid + '"]');
  await p.mouse.click(bi.x, bi.y, { button: 'right' });
  await p.click('.cl-menu .item:has-text("Find Highlights")');
  await p.waitForSelector('.dialog:has-text("Find Highlights")');
  const nums = p.locator('.dialog input[type=number]');
  await nums.nth(0).click({ clickCount: 3 }); await p.keyboard.type('60');
  await nums.nth(1).click({ clickCount: 3 }); await p.keyboard.type('40');
  const hl0 = Date.now();
  await p.click('.dialog-foot .btn.primary:has-text("Find Highlights")');
  await p.waitForFunction(() => !Cutline.ui.openDialogs.length, null, { timeout: 1500000, polling: 1000 });
  const hlS = (Date.now() - hl0) / 1000;
  const mk = await p.evaluate((mid) => (Cutline.P.media(mid).markers || []).map(m => ({ t: m.t, s: m.strength, name: m.name, auto: m.auto })), mid);
  const offs = mk.map(m => { const nb = nearestBurst(m.t); return Math.abs(m.t - nb.t); });
  const within = offs.filter(d => d <= 1).length;
  L.info('Find Highlights (incl. the shared waveform pass) took ' + hlS.toFixed(0) + ' s; ' + mk.length + ' markers; worst offset ' + Math.max(...offs).toFixed(2) + ' s; e.g. ' + mk.slice(0, 3).map(m => tc60(m.t).slice(0, 8) + ' "' + m.name + '" s=' + m.s).join(', '));
  L.ok(mk.length === 40 && within === mk.length && mk.every(m => m.auto && /dB/.test(m.name)), 'Find Highlights dropped 40 suggested markers, all within 1 s of the known loud bursts');
  const gaps = mk.slice(1).map((m, i) => m.t - mk[i].t);
  L.ok(gaps.every(g => g >= 60), 'markers respect the minimum spacing (60 s)');

  // ---- Markers list: sort by strength, click → Source monitor jumps
  await p.click('#p-bin .tab[data-id="markers"]');
  await p.selectOption('#p-bin .pane-toolbar select >> nth=1', 'strength');
  await p.waitForTimeout(200);
  const rows = await p.locator('#p-bin .lrow.src-mk').count();
  const firstRowTc = await p.locator('#p-bin .lrow.src-mk .tcs').nth(3).textContent();
  await p.locator('#p-bin .lrow.src-mk').nth(3).click();
  await p.waitForFunction(() => !Cutline.Source.video.seeking, null, { timeout: 20000 });
  const jump = await p.evaluate(() => ({ t: Cutline.Source.video.currentTime, tc: Cutline.Source.tc.textContent, focus: Cutline.state.focus }));
  const strengths = await p.evaluate(() => Array.from(document.querySelectorAll('#p-bin .lrow.src-mk .mk-strength')).map(e => +e.textContent));
  L.ok(rows === 40 && strengths.every((s, i) => i === 0 || s <= strengths[i - 1]), 'Markers list shows the 40 source markers sorted by strength');
  L.ok(jump.tc === firstRowTc && jump.focus === 'source', 'clicking a marker row jumps the Source monitor to it (' + jump.tc + ')');
  await L.shot(p, '3-markers-by-strength');

  // ---- Subclips at 3 places spread across the 10 hours (I / O / Ctrl+U, all keyboard)
  const subs = [[12 * SEG + 20, 40], [120 * SEG + 100, 40], [228 * SEG + 30, 50]];
  for (const [a, len] of subs) {
    await p.click(tcSel); await p.keyboard.type(tc60(a)); await p.keyboard.press('Enter');
    await p.waitForFunction((a) => Math.abs(Cutline.Source.video.currentTime - a) < 0.02, a, { timeout: 20000 });
    await p.keyboard.press('i');
    await p.click(tcSel); await p.keyboard.type(tc60(a + len - 1 / 60)); await p.keyboard.press('Enter');
    await p.waitForFunction((t) => Math.abs(Cutline.Source.video.currentTime - t) < 0.02, a + len - 1 / 60, { timeout: 20000 });
    await p.keyboard.press('o');
    await p.keyboard.press('Control+u');
    await p.waitForTimeout(250);
  }
  const subInfo = await p.evaluate(() => Cutline.state.project.media.filter(m => m.sub).map(m => ({ id: m.id, name: m.name, a: m.sub.in, b: m.sub.out })));
  L.ok(subInfo.length === 3 && subInfo.every((s, i) => Math.abs(s.a - subs[i][0]) < 0.02 && Math.abs(s.b - (subs[i][0] + subs[i][1])) < 0.02), 'three subclips made from In/Out with Ctrl+U: ' + subInfo.map(s => '"' + s.name + '"').join(', '));

  // ---- Sequence 1 = sub1 + sub2, Sequence 2 = sub2 + sub3 (Library selection → context menu)
  await p.click('#p-bin .tab[data-id="library"]'); await p.waitForTimeout(150);
  async function seqFrom(ids) {
    await p.click('.bin-item[data-id="' + ids[0] + '"]');
    for (const id of ids.slice(1)) await p.click('.bin-item[data-id="' + id + '"]', { modifiers: ['Control'] });
    const c = await L.center(p, '.bin-item[data-id="' + ids[0] + '"]');
    await p.mouse.click(c.x, c.y, { button: 'right' });
    await p.click('.cl-menu .item:has-text("New Sequence from Selected Items")');
    await p.waitForTimeout(400);
    return p.evaluate(() => { const s = Cutline.P.seq(); return { id: s.id, name: s.name, fps: s.fps, dur: Cutline.P.seqDuration(s), clips: s.clips.map(c => ({ kind: c.kind, start: c.start, dur: c.dur, in: c.in, mediaId: c.mediaId })) }; });
  }
  const s1 = await seqFrom([subInfo[0].id, subInfo[1].id]);
  L.ok(s1.clips.length === 4 && Math.abs(s1.dur / s1.fps - 80) < 0.05, 'Sequence 1 from two subclips: ' + (s1.dur / s1.fps).toFixed(2) + ' s, ' + s1.clips.length + ' clips at ' + s1.fps + ' fps');
  // duration readout + target
  await p.click('.tl-target'); await p.keyboard.type('1:30'); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
  const r1 = await p.evaluate(() => ({ val: Cutline.TL.durVal.textContent, delta: Cutline.TL.durDelta.textContent, cls: Cutline.TL.durDelta.className, target: Cutline.P.seq().target }));
  L.ok(r1.target === 90 && /under/.test(r1.cls) && r1.delta === '0:10 to go' && r1.val === '00:01:20:00', 'duration readout ' + r1.val + ' with target 1:30 → "' + r1.delta + '"');
  await p.click('.tl-target', { clickCount: 3 }); await p.keyboard.type('1:15'); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
  const r1b = await p.evaluate(() => ({ delta: Cutline.TL.durDelta.textContent, cls: Cutline.TL.durDelta.className }));
  L.ok(/over/.test(r1b.cls) && r1b.delta === '0:05 over', 'target 1:15 → "' + r1b.delta + '" (over)');
  await L.shot(p, '3-seq1-target');
  // Sequence 2: start from subclip 2, then drag subclip 3 from the Library to the end of the timeline (real mouse)
  await seqFrom([subInfo[1].id]);
  await p.waitForTimeout(300);
  const endX = await p.evaluate(() => { const C = Cutline, TL = C.TL; return TL.scroller.getBoundingClientRect().left + TL.f2x(C.P.seqDuration(C.P.seq())) + 4; });
  const v1Y = await p.evaluate(() => { const C = Cutline, TL = C.TL, r = TL.rows.find(r => r.track && C.P.trackLabel(C.P.seq(), r.track) === 'V1'); return TL.scroller.getBoundingClientRect().top + r.y - TL.scrollY + r.h / 2; });
  const it3 = await L.center(p, '.bin-item[data-id="' + subInfo[2].id + '"]');
  await p.mouse.move(it3.x, it3.y); await p.mouse.down();
  for (let i = 1; i <= 24; i++) { await p.mouse.move(it3.x + (endX - it3.x) * i / 24, it3.y + (v1Y - it3.y) * i / 24); await p.waitForTimeout(15); }
  await p.mouse.up(); await p.waitForTimeout(400);
  const s2 = await p.evaluate(() => { const s = Cutline.P.seq(); return { id: s.id, name: s.name, fps: s.fps, dur: Cutline.P.seqDuration(s), clips: s.clips.map(c => ({ kind: c.kind, start: c.start, dur: c.dur, in: c.in, mediaId: c.mediaId })) }; });
  const dropped = s2.clips.filter(c => c.mediaId === subInfo[2].id);
  L.ok(s2.clips.length === 4 && Math.abs(s2.dur / s2.fps - 90) < 0.05 && dropped.length === 2 && dropped[0].start === 40 * s2.fps && Math.abs(dropped[0].in - subs[2][0]) < 0.02, 'Sequence 2: subclip 2 + subclip 3 dragged from the Library (snapped to the end, uses the subclip range): ' + (s2.dur / s2.fps).toFixed(2) + ' s');
  await p.click('.tl-target'); await p.keyboard.type('1:30'); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
  const r2 = await p.evaluate(() => ({ delta: Cutline.TL.durDelta.textContent, cls: Cutline.TL.durDelta.className }));
  L.ok(/ on/.test(' ' + r2.cls) && r2.delta === 'on target', 'Sequence 2 hits its 1:30 target → "' + r2.delta + '"');

  // ---- playback across the cut between two pieces of the same 10-hour source (sequence 1)
  await p.click('.seq-tab:has-text("' + s1.name + '")'); await p.waitForTimeout(300);
  await p.click('.tl-tc'); await p.keyboard.type('00:00:38:00'); await p.keyboard.press('Enter');
  await p.waitForTimeout(800);
  await p.click('#p-program .mon-view'); // program focus
  const pb0 = await p.evaluate(() => ({ f: Cutline.Engine.frame }));
  await p.keyboard.press('Space');
  await p.waitForTimeout(4000);
  const mid4 = await p.evaluate(() => ({ playing: Cutline.Engine.playing, f: Cutline.Engine.frame, srcs: Cutline.Mixer.sources.length, jobs: Cutline.Mixer.streamJobs.length, els: Object.keys(Cutline.Engine.provider.vids).length, code: window.__readCode(Cutline.Program.canvas), chunks: Cutline.AudioStream.stats() }));
  await p.keyboard.press('Space');
  const fps1 = s1.fps;
  const played = (mid4.f - pb0.f) / fps1;
  // after the cut the program shows sub2 (copy 120, hour 5) at about 100 + (played - 2) s into the copy
  L.ok(mid4.playing && played > 3 && played < 4.6, 'playback ran across the cut (' + played.toFixed(2) + ' s of sequence time in 4 s)');
  L.ok(mid4.code.hour === 5 && mid4.els <= 3, 'after the cut the program shows the second piece (hour ' + mid4.code.hour + ', frame code ' + mid4.code.frame + ') using ' + mid4.els + ' pooled video elements for the source');
  L.ok(mid4.srcs > 0 && mid4.chunks.chunks > 0, 'streamed audio played from decoded chunks (' + mid4.srcs + ' chunk sources scheduled, ' + mid4.chunks.chunks + ' chunks cached, ' + (mid4.chunks.bytes / 1048576).toFixed(0) + ' MB)');

  // ---- Batch export: queue both sequences with their own settings, run unattended, stream to disk
  await p.click('.menu-title:has-text("File")');
  await p.click('.cl-menu .item:has-text("Batch Export Queue")');
  await p.waitForSelector('.dialog:has-text("Batch Export Queue")');
  async function queueSeq(name, fmt, fileName) {
    await p.click('.dialog button:has-text("Add Sequence…")');
    await p.click('.cl-menu .item:has-text("' + name + '")');
    await p.waitForSelector('.dialog:has-text("Add to Batch Export")');
    const dlg = p.locator('.modal-backdrop').last();
    const sels = dlg.locator('select');
    await sels.nth(1).selectOption(fmt);   // nth(0) is the delivery Preset select
    await sels.nth(2).selectOption('half');
    await sels.nth(3).selectOption('30');
    await sels.nth(4).selectOption('low');
    const nm = dlg.locator('input[type=text]').first();
    await nm.click({ clickCount: 3 }); await p.keyboard.type(fileName);
    await dlg.locator('.dialog-foot .btn.primary:has-text("Add to Queue")').click();
    await p.waitForTimeout(250);
  }
  await queueSeq(s1.name, 'webm-vp9', 'edit1');
  await queueSeq(s2.name, 'mp4-vp9', 'edit2');
  const qn = await p.locator('.batch-row').count();
  L.ok(qn === 2, 'two sequences queued with their own file names / formats (WebM + MP4), 640x360 @ 30 fps');
  await L.shot(p, '3-batch-queued');
  const be0 = Date.now();
  const bx = await L.withMem(b, cdp, async () => {
    await p.click('.dialog-foot .btn:has-text("Start Queue")');
    // headless SwiftShader renders + VideoFrame readback run at ~15-25 fps on this VM depending on host load: allow 25 min for 170 s of video
    await p.waitForFunction(() => Cutline.Export.queue.every(q => q.status === 'done' || q.status === 'failed'), null, { timeout: 1500000, polling: 500 });
  }, 500);
  const beS = (Date.now() - be0) / 1000;
  await L.shot(p, '3-batch-done');
  const q = await p.evaluate(() => Cutline.Export.queue.map(x => ({ status: x.status, msg: x.msg, size: x.result && x.result.size, file: x.result && x.result.file })));
  L.info('batch export: ' + beS.toFixed(1) + ' s for 170 s of video; ' + q.map(x => x.msg).join(' | ') + '; RSS peak ' + bx.rss.toFixed(0) + ' MB');
  L.ok(q.every(x => x.status === 'done' && x.file), 'batch queue finished both items unattended, streamed to disk');
  const patched = Object.entries(L.fsLog.files).map(([n, e]) => n + ':' + e.patches + ' patches').join(', ');
  L.ok(Object.values(L.fsLog.files).every(e => e.closed && e.patches >= 1), 'header fields were patched with positioned writes after streaming (' + patched + ')');
  await p.click('.dialog-foot .btn:has-text("Close")');

  // ---- verify the outputs
  // pieces = the actual source in-point and length of each video clip (the In/Out marks snap to the source's frame
  // grid, so these differ from the typed times by up to half a frame)
  const piecesOf = (sq) => sq.clips.filter(c => c.kind === 'video').sort((x, y) => x.start - y.start).map(c => [c.in, c.dur / sq.fps]);
  const outs = [['edit1.webm', s1, 80, piecesOf(s1)], ['edit2.mp4', s2, 90, piecesOf(s2)]];
  for (const [fn, sq, dur, pieces] of outs) {
    const f = OUTDIR + fn;
    const pr = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height,r_frame_rate,nb_read_frames', '-count_frames', '-of', 'json', f]).toString());
    const v = pr.streams.find(s => s.width), a = pr.streams.find(s => !s.width), d = parseFloat(pr.format.duration);
    L.ok(v && v.codec_name === 'vp9' && v.width === 640 && v.height === 360 && a && a.codec_name === 'opus', fn + ': VP9 640x360 + Opus');
    L.ok(Math.abs(+v.nb_read_frames - dur * 30) <= 1 && Math.abs(d - dur) < 0.05, fn + ': ' + v.nb_read_frames + ' frames (expected ' + dur * 30 + '), duration ' + d.toFixed(3) + ' s');
    const errOut = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'null', '-']).toString();
    L.ok(!errOut.trim(), fn + ': decodes cleanly with ffmpeg');
    // frames come from the right source times (60 fps source conformed to 30 fps)
    const checks = [];
    for (const tOut of [2.0, 25.5, pieces[0][1] + 3.0, dur - 1.5]) {
      const pi = tOut < pieces[0][1] ? 0 : 1, srcT = pieces[pi][0] + (tOut - (pi ? pieces[0][1] : 0));
      const got = L.ffCode(f, tOut + 0.001, 640, 360), exp = L.ffCode(src, srcT + 0.001);
      checks.push({ tOut, d: L.frameDiff(got, exp), got: got.hour + ':' + got.frame, exp: exp.hour + ':' + exp.frame });
    }
    L.ok(checks.every(c => c.d <= 2), fn + ': output frames match the source frames at the mapped times (≤2 source frames at 60→30 fps): ' + checks.map(c => c.tOut + 's ' + c.got + '/' + c.exp).join(' '));
    // A/V sync: loud bursts appear in the exported audio exactly where the source puts them
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
    const pcm = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
    const expOn = [];
    // expected onset = presentation time of the video frame generated at the same instant as the burst, mapped through the edit (true A/V sync)
    pieces.forEach(([a, len], i) => { const base = i ? pieces[0][1] : 0; for (let k = Math.floor(a / SEG) - 1; k <= Math.floor((a + len) / SEG) + 1; k++) for (const off of [37, 112]) { const t = k * SEG + off; if (t > a + 0.5 && t < a + len - 0.5) expOn.push(base + L.ffVideoTimeOfCode(src, t, off === 37 ? 2220 : 6720) - a); } });
    const found = expOn.map(t => { const s0 = Math.round((t - 1) * 48000); for (let i = s0; i < s0 + 96000 && i < pcm.length; i++) if (Math.abs(pcm[i]) > 0.25) return i / 48000; return -1; });
    const errs2 = expOn.map((t, i) => Math.abs(found[i] - t));
    L.ok(expOn.length >= 1 && errs2.every(e => e < 0.005), fn + ': A/V sync — audio bursts expected with their video frames at ' + expOn.map(t => t.toFixed(3)).join(', ') + ' s found at ' + found.map(t => t.toFixed(3)).join(', ') + ' (< 5 ms)');
  }
  const n = L.done(errs);
  await b.close();
  process.exit(n ? 1 : 0);
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
