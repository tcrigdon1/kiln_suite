// 15. Export: WebM VP9 entire + in→out, progress & cancel, ffprobe checks, frame match; WAV; PNG frame; H.264 handling
const H = require('./hlib');
const { execSync } = require('child_process');
const OUT = H.path.join(__dirname, 'out') + '/';
H.fs.mkdirSync(OUT, { recursive: true });
function probe(f) { return JSON.parse(execSync(`ffprobe -v error -show_entries format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels -of json "${f}"`).toString()); }
function frameAt(f, t, w, h) { // decode one frame with ffmpeg, return raw RGB buffer
  return execSync(`ffmpeg -v error -ss ${t} -i "${f}" -frames:v 1 -f rawvideo -pix_fmt rgb24 -s ${w}x${h} -`, { maxBuffer: 64 << 20 });
}
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('h12');
  await H.boot(p);
  await H.newProjectUI(p, { name: 'Export Test' });
  await H.importUI(p, ['main1080.webm']);
  const sr = await H.center(p, '#p-timeline .tl-scroll');
  const it = await H.center(p, '#p-bin .bin-item:has(.name:text-is("main1080.webm"))');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V1'));
  await H.key(p, 'Backslash');
  const ruler = async (f) => p.mouse.click(await H.tlX(p, f), (await H.center(p, '#p-timeline .tl-ruler-hit')).y);
  // keep 5 s: playhead 150, select V1 clip, W (ripple trim end to playhead)
  await ruler(150);
  await p.mouse.click(await H.tlX(p, 10), await H.tlRowY(p, 'V3'));
  await H.key(p, 'w');
  await H.key(p, 'Backslash');
  let cl = await H.clips(p);
  H.ok(cl.every(c => c.start === 0 && c.dur === 150), 'W trimmed A/V to 5 s: ' + JSON.stringify(cl.map(c => c.dur)));
  // add a title (Effects menu preset) and an effect (Invert at 50%) via the effects browser
  await ruler(0);
  await H.menu(p, 'Effects', 'New Title', 'Subtitle');
  await p.waitForTimeout(200);
  const v1 = await H.clipBox(p, { track: 'V1' });
  await p.click('#p-right .tab[data-id="effects"]');
  await p.click('.fxb-search input'); await p.keyboard.type('invert');
  const src = await H.center(p, '.fxb-item:has(span:text-is("Invert"))');
  await H.dnd(p, src.x, src.y, (v1.x0 + v1.x1) / 2, v1.y);
  await p.click('#p-right .tab[data-id="inspector"]');
  const amt = p.locator('.insp-scroll .fx-item .cl-field:has(label:text-is("Amount")) input[type=number]');
  await amt.click({ clickCount: 3 }); await p.keyboard.type('100'); await p.keyboard.press('Enter');
  await ruler(60);
  await p.waitForTimeout(800);
  const progPx = await H.progPixels(p, [[0.1, 0.3], [0.3, 0.3], [0.5, 0.3], [0.7, 0.3], [0.9, 0.3], [0.5, 0.88]]);
  await H.shot(p, 'before-export');
  // --- Export dialog via File menu
  await H.menu(p, 'File', 'Export Media');
  await p.waitForTimeout(600);
  await H.shot(p, 'export-dialog');
  const fmt = await p.locator('.dialog .form-grid select').nth(1).inputValue();
  H.ok(fmt === 'webm-vp9', 'export dialog defaults to WebM VP9 (' + fmt + ')');
  const summary = await p.locator('.dialog .export-summary').innerText();
  H.ok(/1920×1080 @ 30 fps/.test(summary) && /WebCodecs/.test(summary), 'summary: ' + summary.replace(/\n/g, ' | '));
  // check MP4 H.264 handling
  await p.locator('.dialog .form-grid select').nth(1).selectOption('mp4-h264');
  await p.waitForTimeout(300);
  const s264 = await p.locator('.dialog .export-summary').innerText();
  const go264 = await p.locator('.dialog-foot .btn.primary').isDisabled();
  H.info('H.264 summary: ' + s264.replace(/\n/g, ' | ') + ' · Export disabled=' + go264);
  await H.shot(p, 'export-h264');
  H.ok(/H\.264 encoding is not available/.test(s264) && go264 && /not available/.test(await p.locator(".dialog .form-grid select option[value=mp4-h264]").innerText()), 'H.264 unsupported → clear message and Export disabled');
  await p.locator('.dialog .form-grid select').nth(1).selectOption('webm-vp9');
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 240000 }), (async () => {
    await p.click('.dialog-foot .btn.primary');
    await p.waitForSelector('.cl-progress', { timeout: 5000 });
    await p.waitForTimeout(1500);
    await H.shot(p, 'export-progress');
    const pct = await p.evaluate(() => parseFloat(document.querySelector('.cl-progress-fill').style.width));
    H.ok(pct > 0, 'progress bar advancing (' + pct + '%)');
  })()]);
  const f1 = OUT + 'full.webm';
  await dl.saveAs(f1);
  H.ok(dl.suggestedFilename() === 'Export Test.webm', 'download named ' + dl.suggestedFilename());
  let pr = probe(f1);
  const vs = pr.streams.find(s => s.codec_type === 'video'), as = pr.streams.find(s => s.codec_type === 'audio');
  const dur = parseFloat(pr.format.duration);
  H.ok(vs && vs.codec_name === 'vp9' && vs.width === 1920 && vs.height === 1080, 'ffprobe video: ' + JSON.stringify(vs));
  H.ok(as && as.codec_name === 'opus' && +as.sample_rate === 48000, 'ffprobe audio: ' + JSON.stringify(as));
  H.ok(Math.abs(dur - 5.0) <= 1 / 30 + 0.03, 'duration ' + dur + ' ≈ 5.000 s (±1 frame)');
  const nf = parseInt(execSync(`ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "${f1}"`).toString());
  H.ok(nf === 150, 'decoded frame count ' + nf + ' == 150');
  // compare the exported frame at 2.0 s (seq frame 60) with what the program monitor showed
  const raw = frameAt(f1, 2.0, 320, 180);
  const samp = (fx, fy) => { const x = Math.floor(fx * 319), y = Math.floor(fy * 179), i = (y * 320 + x) * 3; return [raw[i], raw[i + 1], raw[i + 2]]; };
  const expPx = [[0.1, 0.3], [0.3, 0.3], [0.5, 0.3], [0.7, 0.3], [0.9, 0.3], [0.5, 0.88]].map(([x, y]) => samp(x, y));
  const diff = progPx.map((c, i) => Math.max(...c.map((v, k) => Math.abs(v - expPx[i][k]))));
  H.ok(diff.slice(0, 5).every(d => d < 40), 'exported frame @2s matches program monitor (inverted bars): prog ' + JSON.stringify(progPx.slice(0, 5)) + ' vs file ' + JSON.stringify(expPx.slice(0, 5)));
  execSync(`ffmpeg -v error -y -ss 2.0 -i "${f1}" -frames:v 1 "${OUT}frame2s.png"`);
  // the Subtitle title (white text on a dark box) is burned into the export
  let white = 0, dark = 0;
  for (let y = Math.floor(0.84 * 180); y < Math.floor(0.93 * 180); y++) for (let x = Math.floor(0.36 * 320); x < Math.floor(0.64 * 320); x++) { const i = (y * 320 + x) * 3; if (raw[i] > 215 && raw[i + 1] > 215 && raw[i + 2] > 215) white++; if (raw[i] + raw[i + 1] + raw[i + 2] < 200) dark++; }
  H.ok(white > 10 && dark > 100, 'subtitle title text + box present in the exported frame (white ' + white + ', dark ' + dark + ')');
  // --- In→Out export: I at 30, O at 89 (O marks through the end of that frame → 60 frames)
  await ruler(30); await p.mouse.click(await H.tlX(p, 10), await H.tlRowY(p, 'V3') - 300 < 0 ? await H.tlRowY(p, 'V3') : await H.tlRowY(p, 'V3'));
  await H.key(p, 'i');
  await ruler(89); await p.mouse.click(await H.tlX(p, 10), await H.tlRowY(p, 'V3'));
  await H.key(p, 'o');
  const io = await p.evaluate(() => [Cutline.P.seq().inF, Cutline.P.seq().outF]);
  H.ok(io[0] === 30 && io[1] === 90, 'In/Out set to 30..90 (' + io + ')');
  await H.key(p, 'Control+m');
  await p.waitForTimeout(400);
  const range = await p.locator('.dialog .form-grid select').nth(6).inputValue();
  H.ok(range === 'inout', 'range defaults to In → Out when marks exist (' + range + ')');
  const [dl2] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }), p.click('.dialog-foot .btn.primary')]);
  const f2 = OUT + 'inout.webm';
  await dl2.saveAs(f2);
  pr = probe(f2);
  const d2 = parseFloat(pr.format.duration);
  H.ok(Math.abs(d2 - 2.0) <= 1 / 30 + 0.03, 'In→Out export duration ' + d2 + ' ≈ 2.000 s');
  // first exported frame of the range == sequence frame 30 → compare with frame 30 of the full export
  const a = frameAt(f2, 0, 160, 90), bfull = frameAt(f1, 1.0, 160, 90);
  let md = 0; for (let i = 0; i < a.length; i += 97) md = Math.max(md, Math.abs(a[i] - bfull[i]));
  H.ok(md < 60, 'In→Out export starts at the In frame (max sample diff ' + md + ')');
  // --- cancel: start a full export and cancel from the progress dialog
  await H.key(p, 'Alt+x'); // clear in/out
  await H.key(p, 'Control+m');
  await p.waitForTimeout(300);
  let dlFired = false; const onDl = () => { dlFired = true; }; p.on('download', onDl);
  await p.click('.dialog-foot .btn.primary');
  await p.waitForSelector('.cl-progress', { timeout: 5000 });
  await p.waitForTimeout(1200);
  await p.click('.dialog-foot .btn:text-is("Cancel")');
  await p.waitForTimeout(300);
  await H.shot(p, 'after-cancel-click');
  for (let i = 0; i < 40 && await p.locator('.cl-progress').count(); i++) await p.waitForTimeout(250);
  const toasts = await p.locator('.toast').allInnerTexts();
  H.ok(toasts.some(t => /Export cancelled/.test(t)) && !dlFired && !(await p.locator('.cl-progress').count()), 'cancel stops the export without a download (' + toasts.join(' | ') + ') dl=' + dlFired + ' prog=' + (await p.locator('.cl-progress').count()));
  p.off('download', onDl);
  // --- WAV export via File menu
  await H.menu(p, 'File', 'Export Audio (WAV)');
  await p.waitForTimeout(300);
  const [dl3] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), p.click('.dialog-foot .btn.primary')]);
  const f3 = OUT + 'mix.wav';
  await dl3.saveAs(f3);
  pr = probe(f3);
  H.ok(pr.streams[0].codec_name === 'pcm_s16le' && +pr.streams[0].sample_rate === 48000 && pr.streams[0].channels === 2 && Math.abs(parseFloat(pr.format.duration) - 5) < 0.01, 'WAV: ' + JSON.stringify(pr.streams[0]) + ' dur ' + pr.format.duration);
  const vol = execSync(`ffmpeg -v info -i "${f3}" -af volumedetect -f null - 2>&1 | grep max_volume || true`).toString().trim();
  H.info('WAV ' + vol);
  // --- PNG frame export via the program monitor camera button
  await ruler(60); await p.waitForTimeout(500);
  const [dl4] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click('#p-program .icon-btn[data-tip="Export frame (PNG)"]')]);
  const f4 = OUT + 'frame.png';
  await dl4.saveAs(f4);
  pr = probe(f4);
  H.ok(pr.streams[0].codec_name === 'png' && pr.streams[0].width === 1920 && pr.streams[0].height === 1080, 'PNG frame 1920×1080: ' + JSON.stringify(pr.streams[0]));
  const praw = execSync(`ffmpeg -v error -i "${f4}" -f rawvideo -pix_fmt rgb24 -s 320x180 -`, { maxBuffer: 1 << 24 });
  const pp = [[0.1, 0.3], [0.5, 0.3], [0.9, 0.3]].map(([x, y]) => { const i = (Math.floor(y * 179) * 320 + Math.floor(x * 319)) * 3; return [praw[i], praw[i + 1], praw[i + 2]]; });
  H.ok(pp.every((c, i) => Math.max(...c.map((v, k) => Math.abs(v - progPx[[0, 2, 4][i]][k]))) < 40), 'PNG frame matches program monitor ' + JSON.stringify(pp));
  await H.finish(b, errs, 'h12_export');
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
