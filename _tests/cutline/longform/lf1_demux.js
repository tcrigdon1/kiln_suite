// Long-form #1 — demuxer correctness on real files (compared with ffprobe), big-file parsing speed/memory,
// key-frame accurate decode at far-apart times (compared with ffmpeg), friendly errors for unplayable files.
const L = require('./lflib');
const fs = require('fs');
(async () => {
  const { b, p, errs, cdp } = await L.launch();
  await L.boot(p, '?test=1');
  await p.evaluate(L.PAGE_CODE);
  await p.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'tf'; i.multiple = true; document.body.appendChild(i); });
  const files = ['h264_aac_moovend.mp4', 'vod10h.mp4', 'vod10h.webm', 'nocues1h.webm'].map(f => L.MEDIA + f);
  await p.setInputFiles('#tf', files);

  // ---- 1. short real H.264/AAC MP4 (moov at end): every packet vs ffprobe
  const ref = L.ffPackets(files[0]);
  const t264 = await p.evaluate(async () => {
    const f = document.getElementById('tf').files[0], pi = await Cutline.Demux.probe(f);
    const dump = (tr) => { const t = tr.table, o = []; for (let i = 0; i < t.n; i++) o.push([t.off[i], t.size[i], t.pts[i] / 1e6, t.key[i]]); return o; };
    return { v: dump(pi.video), a: dump(pi.audio), vcodec: pi.video.codec, acodec: pi.audio.codec, vsup: !!pi.video.config, asup: !!pi.audio.config, sr: pi.audio.sampleRate, ch: pi.audio.channels };
  });
  function compare(ours, refs, label) {
    const byPos = new Map(ours.map(s => [s[0], s])); let bad = 0, n = 0;
    for (const r of refs) { n++; const s = byPos.get(r.pos); if (!s || s[1] !== r.size || Math.abs(s[2] - r.pts) > 0.0011 || !!s[3] !== r.key) { if (bad < 3) L.info(label + ' mismatch ' + JSON.stringify(r) + ' vs ' + JSON.stringify(s)); bad++; } }
    return { bad, n };
  }
  const cv = compare(t264.v, ref.filter(r => r.s === 0), 'h264'), ca = compare(t264.a, ref.filter(r => r.s === 1), 'aac');
  L.ok(cv.bad === 0 && cv.n === 600 && t264.v.length === 600, 'H.264 MP4: all ' + cv.n + ' video packets match ffprobe (offset, size, pts incl. B-frame ctts, key flags)');
  L.ok(ca.bad === 0 && ca.n === t264.a.length, 'AAC: all ' + ca.n + ' audio packets match ffprobe (pts include the edit-list priming offset)');
  L.ok(/^avc1\.64/.test(t264.vcodec) && /^mp4a\.40\.2$/.test(t264.acodec) && t264.sr === 44100 && t264.ch === 1, 'codec strings parsed: ' + t264.vcodec + ' / ' + t264.acodec + ' ' + t264.sr + ' Hz ' + t264.ch + ' ch');
  L.info('this browser can decode H.264: ' + t264.vsup + ', AAC: ' + t264.asup + ' (headless Chromium has neither)');

  // ---- 2. 10-hour VP9/Opus MP4, moov at end, co64, 2.16 M video samples
  const big = await L.withMem(b, cdp, () => p.evaluate(async () => {
    const f = document.getElementById('tf').files[1], t0 = performance.now(), pi = await Cutline.Demux.probe(f), ms = performance.now() - t0;
    window.__pi = pi;
    const v = pi.video.table, a = pi.audio.table;
    return { ms, dur: pi.duration, vn: v.n, an: a.n, keys: v.keys.length, maxOff: v.off[v.n - 1], vcfg: !!pi.video.config, acfg: !!pi.audio.config };
  }));
  L.info('10 h MP4 probe ' + big.result.ms.toFixed(0) + ' ms, ' + big.result.vn + ' video + ' + big.result.an + ' audio samples, ' + big.result.keys + ' key frames; JS heap peak ' + big.heap.toFixed(0) + ' MB, renderer RSS peak ' + big.rss.toFixed(0) + ' MB');
  L.ok(big.result.vn === 2160000 && big.result.an === 1800240, '10 h MP4 sample counts match ffprobe (2,160,000 video / 1,800,240 audio)');
  L.ok(big.result.maxOff > 4294967296, 'chunk offsets beyond 4 GiB parsed from co64 (last ' + (big.result.maxOff / 1073741824).toFixed(2) + ' GiB)');
  L.ok(big.result.ms < 8000, 'moov (65 MB, at the end of a 4.75 GB file) parsed in ' + (big.result.ms / 1000).toFixed(1) + ' s');
  for (const [iv, label] of [['0%+0.4', 'start'], ['18000%+0.4', '5 h'], ['35999%+0.4', 'end']]) {
    const refs = L.ffPackets(files[1], iv);
    const ours = await p.evaluate((poss) => { const pi = window.__pi, out = []; for (const pos of poss) { for (const tr of [pi.video, pi.audio]) { const t = tr.table; let lo = 0, hi = t.n - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (t.off[mid] < pos) lo = mid + 1; else hi = mid; } if (t.off[lo] === pos) { out.push([t.off[lo], t.size[lo], t.pts[lo] / 1e6, t.key[lo]]); break; } } } return out; }, refs.map(r => r.pos));
    const c = compare(ours, refs, 'vod10h.mp4 ' + label);
    L.ok(c.bad === 0 && c.n > 20, 'vod10h.mp4 @' + label + ': ' + c.n + ' packets match ffprobe (incl. offsets > 4 GiB at 5 h/end)');
  }

  // ---- 3. 10-hour WebM with Cues
  const wb = await p.evaluate(async () => {
    const f = document.getElementById('tf').files[2], t0 = performance.now(), pi = await Cutline.Demux.probe(f), ms = performance.now() - t0;
    window.__pw = pi;
    return { ms, dur: pi.duration, cues: pi.index.pos.length, fromCues: !!pi.index.fromCues, vcodec: pi.video.codec, acodec: pi.audio.codec };
  });
  L.ok(wb.fromCues && wb.cues > 10000 && Math.abs(wb.dur - 36001.94) < 0.1 && wb.ms < 3000, '10 h WebM (2.6 GB) indexed from Cues in ' + wb.ms.toFixed(0) + ' ms: ' + wb.cues + ' cue clusters, duration ' + wb.dur.toFixed(2) + ' s');
  for (const [t, label] of [[18000, '5 h'], [35990, 'end']]) {
    const refs = L.ffPackets(files[2], (t - 1) + '%+6');
    const ours = await p.evaluate(async (t) => {
      const pi = window.__pw, out = [];
      for (const [si, tr] of [[0, pi.video], [1, pi.audio]]) { const cd = (tr.codecDelayUs || 0) / 1e6; const cur = await tr.cursor(t * 1e6); for (let k = 0; k < 600; k++) { const s = await cur.next(); if (!s) break; out.push({ s: si, pts: s.pts / 1e6 - cd, size: s.data.length, key: s.key }); if (s.pts / 1e6 > t + 0.5) break; } }
      return out;
    }, t);
    let bad = 0, n = 0;
    for (const r of refs.filter(r => r.pts >= t && r.pts < t + 0.3)) { n++; const o = ours.find(x => x.s === r.s && Math.abs(x.pts - r.pts) < 0.0011); if (!o || o.size !== r.size || o.key !== r.key) { bad++; if (bad < 3) L.info('webm mismatch ' + JSON.stringify(r) + ' ' + JSON.stringify(o)); } }
    L.ok(bad === 0 && n > 10, 'vod10h.webm @' + label + ': ' + n + ' packets via cue seek match ffprobe (Opus times compared after the 6.5 ms CodecDelay that ffprobe subtracts)');
  }

  // ---- 4. 1-hour WebM with no Cues, unknown sizes, no Duration (live/recorded style)
  const nc = await p.evaluate(async () => {
    const f = document.getElementById('tf').files[3], t0 = performance.now(), pi = await Cutline.Demux.probe(f);
    window.__pn = pi;
    const cur = await pi.video.cursor(1800e6), s = await cur.next(), ms = performance.now() - t0;
    return { ms, dur: pi.duration, clusters: pi.index.pos.length, complete: pi.index.complete, scanMs: pi.index.scanMs, firstAt: s.pts / 1e6, key: s.key };
  });
  L.ok(Math.abs(nc.dur - 3600.2) < 1.5, 'no-Cues WebM: duration recovered from the last cluster (' + nc.dur.toFixed(2) + ' s; file has no Duration element and unknown sizes)');
  L.ok(nc.key && nc.firstAt <= 1800 && nc.firstAt > 1795 && nc.ms < 5000, 'no-Cues WebM: seek to 30:00 lands on the key frame at ' + nc.firstAt.toFixed(3) + ' s (byte-offset bisection, no full scan; probe+seek ' + nc.ms.toFixed(0) + ' ms)');

  // ---- 5. frame-exact decode at far-apart times vs ffmpeg (burned-in frame code)
  for (const [fi, name] of [[1, 'vod10h.mp4'], [2, 'vod10h.webm']]) {
    let worst = 0; const rows = [];
    for (const t of [10, 4 * 3600 + 59 * 60 + 30, 9 * 3600 + 58 * 60, 7200.5, 33333.3]) {
      const app = await p.evaluate(async ([fi, t]) => { const f = document.getElementById('tf').files[fi], info = await Cutline.Demux.open(f); const fd = new Cutline.FrameDecoder(f, info); const fr = await fd.getFrame(t); const c = window.__readCode(fr); const ts = fr.timestamp / 1e6; fd.close(); return Object.assign(c, { ts }); }, [fi, t]);
      const refc = L.ffCode(files[fi], t);
      const d = L.frameDiff(app, refc); worst = Math.max(worst, d); rows.push(t + 's→' + app.hour + ':' + app.frame + '/' + refc.hour + ':' + refc.frame);
    }
    L.ok(worst <= 1, name + ': WebCodecs frames at 0:10, 4:59:30, 9:58:00, … match ffmpeg\'s frame (≤1 frame) — ' + rows.join(' '));
  }

  // ---- 6. friendly errors: raw .ts and an H.264 file this browser can't play
  await p.evaluate(() => { Cutline.ui.openDialogs.slice().forEach(d => d.close()); });
  await p.setInputFiles('#cl-import-input', [L.MEDIA + 'segment.ts']);
  await p.waitForSelector('.dialog .code-snip', { timeout: 5000 });
  const tsMsg = await p.evaluate(() => document.querySelector('.dialog').innerText);
  L.ok(/transport stream/.test(tsMsg) && /ffmpeg -i "segment\.ts" -c copy "segment\.mp4"/.test(tsMsg) && /yt-dlp/.test(tsMsg), '.ts import shows the remux fix (ffmpeg -c copy, yt-dlp)');
  await p.evaluate(() => { Cutline.ui.openDialogs.slice().forEach(d => d.close()); });
  await p.setInputFiles('#cl-import-input', [L.MEDIA + 'h264_aac_moovend.mp4']);
  const h264Msg = await p.waitForSelector('.dialog .code-snip', { timeout: 30000 }).then(() => p.evaluate(() => document.querySelector('.dialog').innerText)).catch(() => '');
  const h264Ok = await p.evaluate(() => Cutline.state.project.media.some(m => m.name === 'h264_aac_moovend.mp4'));
  if (h264Ok) L.info('this browser played the H.264 file (decoder present) — no error expected');
  else L.ok(/avc1/.test(h264Msg) && /H\.264 decoder/.test(h264Msg) && /ffmpeg/.test(h264Msg), 'H.264/AAC file that this browser cannot decode: clear message naming the codecs and the fix');
  await p.evaluate(() => { Cutline.ui.openDialogs.slice().forEach(d => d.close()); });
  const n = L.done(errs.filter(e => !/media error|DEMUXER_ERROR|Failed to load|PIPELINE_ERROR|cannot play/i.test(e)));
  await b.close();
  process.exit(n ? 1 : 0);
})().catch(e => { console.log('TEST ERROR', e); process.exit(1); });
