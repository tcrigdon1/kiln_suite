// 16. Mixed media on a 1080p30 sequence: 4K, vertical, 60fps, 25fps, no-audio, transparent PNG; mismatch prompt; conform on export
const H = require('./hlib');
const { execSync } = require('child_process');
const OUT = H.path.join(__dirname, 'out') + '/';
H.fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const { b, p, errs } = await H.launch();
  H.setPrefix('h13');
  await H.boot(p);
  await H.newProjectUI(p, { name: 'Mixed' });
  await H.importUI(p, ['clip60.webm', 'clip4k.webm', 'vertical.webm', 'clip25.webm', 'silent.webm', 'logo_alpha.png', 'main1080.webm', 'ntsc2997.webm']);
  await p.click('.bin-toolbar .icon-btn[data-tip="List view"]');
  await p.waitForTimeout(200);
  const rows = await p.$$eval('#p-bin table.bin-list tr.bin-item', trs => trs.map(tr => Array.from(tr.children).map(td => td.innerText.trim())));
  const fpsOf = (n) => (rows.find(r => r[0].includes(n)) || [])[4];
  H.ok(fpsOf('clip60') === '60' && fpsOf('clip25') === '25' && fpsOf('clip4k') === '30' && fpsOf('vertical') === '30' && fpsOf('main1080') === '30' && fpsOf('ntsc2997') === '29.97', 'detected frame rates in list view: ' + ['clip60', 'clip25', 'clip4k', 'vertical', 'main1080', 'silent', 'ntsc2997'].map(n => n + '=' + fpsOf(n)).join(' '));
  await H.shot(p, 'library-mixed');
  await p.click('.bin-toolbar .icon-btn[data-tip="Grid view"]');
  await p.waitForTimeout(200);
  const lib = async (n) => H.center(p, `#p-bin .bin-item:has(.name:text-is("${n}"))`);
  const sr = await H.center(p, '#p-timeline .tl-scroll');
  // first clip into the empty sequence: the 60 fps 720p clip → mismatch prompt
  let it = await lib('clip60.webm');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V1'));
  await p.waitForTimeout(300);
  const t = await p.locator('.dialog-head span').allInnerTexts();
  H.ok(t.some(x => /Clip format differs/.test(x)), 'mismatch prompt for 1280×720@60 on a 1920×1080@30 sequence');
  const body = await p.locator('.dialog-body').innerText();
  H.ok(/1280×720 @ 60 fps/.test(body) && /1920×1080 @ 30 fps/.test(body), 'prompt names both formats: ' + body.replace(/\n/g, ' '));
  await H.shot(p, 'mismatch-prompt');
  await p.click('.dialog-foot .btn:text-is("Keep Sequence Settings")');
  let s = await p.evaluate(() => { const s = Cutline.P.seq(); return [s.w, s.h, s.fps]; });
  H.ok(s.join() === '1920,1080,30', 'sequence kept at 1920×1080@30');
  let cl = await H.clips(p);
  const c60 = cl.find(c => c.name === 'clip60.webm' && c.kind === 'video');
  H.ok(c60 && c60.dur === 120, '4 s of 60 fps footage = 120 sequence frames (' + (c60 && c60.dur) + ')');
  await H.key(p, 'Backslash');
  // append others at the end with the Library context menu "Overwrite at Playhead"? use drag to keep it real
  const endF = async () => p.evaluate(() => Cutline.P.seqDuration(Cutline.P.seq()));
  for (const n of ['clip4k.webm', 'vertical.webm', 'clip25.webm', 'silent.webm']) {
    await H.key(p, 'End');
    const e = await endF();
    await H.key(p, 'Backslash');
    it = await lib(n);
    // drop slightly right of the end; snapping pulls it onto the end
    await H.dnd(p, it.x, it.y, await H.tlX(p, e) + 4, await H.tlRowY(p, 'V1'));
    await p.waitForTimeout(300);
  }
  await H.key(p, 'Backslash');
  cl = await H.clips(p);
  const v = cl.filter(c => c.kind === 'video' && c.track === 'V1').sort((a, b) => a.start - b.start);
  H.ok(v.map(c => c.name).join() === 'clip60.webm,clip4k.webm,vertical.webm,clip25.webm,silent.webm', 'clips appended in order: ' + v.map(c => c.name + '@' + c.start + '+' + c.dur).join(' '));
  H.ok(v.every((c, i) => i === 0 || c.start === v[i - 1].start + v[i - 1].dur), 'appended clips butt together (snapped)');
  H.ok(v.find(c => c.name === 'clip25.webm').dur === 120, '4 s of 25 fps = 120 frames at 30 fps');
  H.ok(!cl.some(c => c.kind === 'audio' && c.name === 'silent.webm'), 'no-audio clip has no audio clip');
  await H.shot(p, 'mixed-timeline');
  const ruler = async (f) => p.mouse.click(await H.tlX(p, f), (await H.center(p, '#p-timeline .tl-ruler-hit')).y);
  const corner = async () => H.progPixels(p, [[0.02, 0.02], [0.98, 0.98], [0.5, 0.5], [0.05, 0.5], [0.95, 0.5]]);
  const isBlack = (c) => c[0] + c[1] + c[2] < 30;
  // 60fps 720p scaled to frame: fills corners
  await ruler(30); await p.waitForTimeout(600);
  let px = await corner();
  H.ok(!isBlack(px[0]) && !isBlack(px[1]), '720p clip scaled to fill the frame ' + JSON.stringify(px.slice(0, 2)));
  // 4K scaled to frame (not cropped to its center)
  const c4k = v.find(c => c.name === 'clip4k.webm');
  await ruler(c4k.start + 20); await p.waitForTimeout(800);
  const fit4k = await p.evaluate((id) => { const C = Cutline, s = C.P.seq(), c = C.P.clip(s, id); const q = C.Scene.quad(s, C.Scene.clipLayer(s, c, C.Engine.frame, {})); return { fit: c.fit, x0: Math.round(q.full[0][0]), x1: Math.round(q.full[1][0]), y0: Math.round(q.full[0][1]), y1: Math.round(q.full[2][1]) }; }, c4k.id);
  H.ok(fit4k.x0 === 0 && fit4k.x1 === 1920 && fit4k.y0 === 0 && fit4k.y1 === 1080, '4K clip fits the 1080p frame: ' + JSON.stringify(fit4k));
  await H.shot(p, '4k-fit');
  // vertical: pillarboxed (black at left/right edges, picture in the middle)
  const cv = v.find(c => c.name === 'vertical.webm');
  await ruler(cv.start + 20); await p.waitForTimeout(800);
  px = await corner();
  H.ok(isBlack(px[3]) && isBlack(px[4]) && !isBlack(px[2]), 'vertical clip is pillarboxed: ' + JSON.stringify(px.slice(2)));
  await H.shot(p, 'vertical-pillarbox');
  // 25fps clip: program shows distinct frames when stepping through
  const c25 = v.find(c => c.name === 'clip25.webm');
  await ruler(c25.start + 10); await p.waitForTimeout(600); const hA = await H.progHash(p);
  await H.key(p, 'ArrowRight', 6); await p.waitForTimeout(600); const hB = await H.progHash(p);
  H.ok(hA !== hB, '25 fps clip advances when stepping on a 30 fps timeline');
  // transparent PNG over video on V2
  it = await lib('logo_alpha.png');
  await H.dnd(p, it.x, it.y, sr.bb.x + 3, await H.tlRowY(p, 'V2'));
  await ruler(30); await p.waitForTimeout(800);
  const logo = await p.evaluate(() => { const C = Cutline, s = C.P.seq(), c = s.clips.find(c => c.name === 'logo_alpha.png'); return { fit: c.fit, dur: c.dur }; });
  px = await H.progPixels(p, [[0.5, 0.5], [0.05, 0.05]]);
  H.info('logo: ' + JSON.stringify(logo) + ' px ' + JSON.stringify(px));
  H.ok(px[0][0] > 200 && px[0][1] > 200 && px[0][2] < 60, 'opaque part of the PNG (yellow) shows at the centre');
  H.ok(!(px[1][0] > 200 && px[1][1] > 200 && px[1][2] < 60) && !isBlack(px[1]), 'transparent part shows the video underneath ' + JSON.stringify(px[1]));
  await H.shot(p, 'transparent-png');
  // export the 60fps → 25fps transition region and compare a frame with the program monitor
  const inF = c25.start - 15, outF = c25.start + 15;
  await ruler(inF); await p.mouse.click(await H.tlX(p, 10), await H.tlRowY(p, 'V3')); await H.key(p, 'i');
  await ruler(outF - 1); await p.mouse.click(await H.tlX(p, 10), await H.tlRowY(p, 'V3')); await H.key(p, 'o');
  await ruler(c25.start + 5); await p.waitForTimeout(800);
  const progPx = await H.progPixels(p, [[0.2, 0.2], [0.5, 0.5], [0.8, 0.7]]);
  await H.key(p, 'Control+m'); await p.waitForTimeout(400);
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 180000 }), p.click('.dialog-foot .btn.primary')]);
  const f = OUT + 'mixed-range.webm';
  await dl.saveAs(f);
  const pr = JSON.parse(execSync(`ffprobe -v error -show_entries format=duration:stream=codec_type,width,height,r_frame_rate -of json "${f}"`).toString());
  const vs = pr.streams.find(x => x.codec_type === 'video');
  H.ok(vs.width === 1920 && vs.height === 1080 && vs.r_frame_rate === '30/1' && Math.abs(parseFloat(pr.format.duration) - 1.0) < 0.07, 'range export 1920×1080@30, ~1.0 s: ' + JSON.stringify(vs) + ' ' + pr.format.duration);
  const raw = execSync(`ffmpeg -v error -ss ${(20 / 30).toFixed(4)} -i "${f}" -frames:v 1 -f rawvideo -pix_fmt rgb24 -s 320x180 -`, { maxBuffer: 1 << 24 });
  const ex = [[0.2, 0.2], [0.5, 0.5], [0.8, 0.7]].map(([x, y]) => { const i = (Math.floor(y * 179) * 320 + Math.floor(x * 319)) * 3; return [raw[i], raw[i + 1], raw[i + 2]]; });
  const d = progPx.map((c, i) => Math.max(...c.map((vv, k) => Math.abs(vv - ex[i][k]))));
  H.ok(d.every(x => x < 50), '25 fps material conformed identically in export and preview: ' + JSON.stringify(progPx) + ' vs ' + JSON.stringify(ex));
  await b.close();
  // --- second project: Match Clip on a vertical first clip
  const r2 = await H.launch();
  await H.boot(r2.p);
  await H.newProjectUI(r2.p);
  await H.importUI(r2.p, ['vertical.webm']);
  it = await H.center(r2.p, '#p-bin .bin-item:has(.name:text-is("vertical.webm"))');
  const sr2 = await H.center(r2.p, '#p-timeline .tl-scroll');
  await H.dnd(r2.p, it.x, it.y, sr2.bb.x + 3, await H.tlRowY(r2.p, 'V1'));
  await r2.p.waitForTimeout(300);
  await r2.p.click('.dialog-foot .btn:text-is("Match Clip")');
  await r2.p.waitForTimeout(500);
  s = await r2.p.evaluate(() => { const s = Cutline.P.seq(); return [s.w, s.h, s.fps]; });
  H.ok(s.join() === '1080,1920,30', 'Match Clip switches the sequence to 1080×1920@30 (' + s + ')');
  const px2 = await H.progPixels(r2.p, [[0.05, 0.5], [0.95, 0.5]]);
  H.ok(!isBlack(px2[0]) && !isBlack(px2[1]), 'vertical clip now fills the vertical frame');
  H.setPrefix('h13b');
  await H.shot(r2.p, 'match-clip-vertical');
  errs.push(...r2.errs);
  await r2.b.close();
  await H.finish({ close: async () => { } }, errs, 'h13_mixed');
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
