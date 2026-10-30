// Long-form test helpers (shared by the longform tests). Real mouse/keyboard where the hands-on tests need it.
const { ROOT } = require('../../env.js');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const MEDIA = path.join(__dirname, 'media') + '/';
const OUT = path.join(__dirname, 'out') + '/';
const SHOTS = path.join(__dirname, 'shots') + '/';
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0;
function ok(cond, msg) { if (cond) console.log('ok - ' + msg); else { failures++; console.log('ASSERT FAIL - ' + msg); } }
function info(msg) { console.log('  · ' + msg); }
async function launch(opts = {}) {
  // GL backend: the prescribed ANGLE/SwiftShader by default; LF_GL=gl selects legacy SwiftShader GL, whose canvas
  // readback (VideoFrame from a WebGL canvas) is ~6x faster in this headless VM — used only to keep the 20-minute
  // export test to a practical duration (reported as such).
  const glArg = (opts.gl || process.env.LF_GL) === 'gl' ? '--use-gl=swiftshader' : '--use-angle=swiftshader';
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', glArg, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--expose-gc'] });
  const ctx = await b.newContext({ viewport: opts.viewport || { width: 1600, height: 900 }, acceptDownloads: true });
  if (opts.init) await ctx.addInitScript(opts.init);
  if (opts.fakeFS) await installFakeFS(ctx, opts.fakeFS);
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); if (process.env.SHOW_LOG && /Cutline/.test(m.text())) console.log('LOG', m.text()); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message + '\n' + e.stack));
  p.on('dialog', d => { if (d.type() === 'beforeunload') { d.accept(); return; } errs.push('native dialog: ' + d.message()); d.dismiss(); });
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Performance.enable');
  return { b, ctx, p, errs, cdp };
}
// JS heap used (MB) via CDP Performance.getMetrics
// Fake File System Access API: showSaveFilePicker / showDirectoryPicker return handles whose createWritable()
// streams implement write({type:'write'|'seek'|'truncate'}) / seek / truncate / close / abort, backed by real files
// in `dir` (Node side, via exposeBinding). Records every write so tests can check that patches were real seeks.
const fsLog = { files: {}, writes: 0, seeks: 0, bytes: 0 };
async function installFakeFS(ctx, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const fds = {};
  let nid = 0;
  await ctx.exposeBinding('__fsOpen', (src, name) => { const id = ++nid, f = path.join(dir, name); fds[id] = { fd: fs.openSync(f, 'w'), f, max: 0, patches: 0 }; fsLog.files[name] = fds[id]; return id; });
  await ctx.exposeBinding('__fsWrite', (src, id, pos, b64) => { const e = fds[id], buf = Buffer.from(b64, 'base64'); fs.writeSync(e.fd, buf, 0, buf.length, pos); if (pos < e.max) { e.patches++; fsLog.seeks++; } e.max = Math.max(e.max, pos + buf.length); fsLog.writes++; fsLog.bytes += buf.length; return true; });
  await ctx.exposeBinding('__fsTruncate', (src, id, n) => { fs.ftruncateSync(fds[id].fd, n); return true; });
  await ctx.exposeBinding('__fsClose', (src, id) => { fs.closeSync(fds[id].fd); fds[id].closed = true; return true; });
  await ctx.exposeBinding('__fsAbort', (src, id) => { fs.closeSync(fds[id].fd); fs.unlinkSync(fds[id].f); fds[id].aborted = true; return true; });
  await ctx.addInitScript(() => {
    const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
    const handle = (name) => ({ kind: 'file', name, createWritable: async () => {
      const id = await window.__fsOpen(name); let cursor = 0;
      const toU8 = async (d) => d instanceof Blob ? new Uint8Array(await d.arrayBuffer()) : d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
      return {
        write: async (arg) => {
          if (arg instanceof Blob || arg instanceof ArrayBuffer || ArrayBuffer.isView(arg)) arg = { type: 'write', data: arg };
          if (arg.type === 'write') { const u8 = await toU8(arg.data); const pos = arg.position != null ? arg.position : cursor; await window.__fsWrite(id, pos, b64(u8)); cursor = pos + u8.length; }
          else if (arg.type === 'seek') cursor = arg.position;
          else if (arg.type === 'truncate') { await window.__fsTruncate(id, arg.size); if (cursor > arg.size) cursor = arg.size; }
        },
        seek: async (p) => { cursor = p; }, truncate: async (n) => { await window.__fsTruncate(id, n); },
        close: async () => { await window.__fsClose(id); }, abort: async () => { await window.__fsAbort(id); }
      };
    } });
    window.showSaveFilePicker = async (o) => handle((o && o.suggestedName) || 'export.bin');
    window.showDirectoryPicker = async () => ({ kind: 'directory', name: 'fake-out', getFileHandle: async (name) => handle(name) });
  });
}
async function heapMB(cdp) { const r = await cdp.send('Performance.getMetrics'); const m = r.metrics.find(x => x.name === 'JSHeapUsedSize'); return m ? m.value / 1048576 : -1; }
// samples heap every `ms` while fn runs; returns {result, peak}
async function withHeap(cdp, fn, ms = 250) {
  let peak = 0, stop = false;
  const loop = (async () => { while (!stop) { try { peak = Math.max(peak, await heapMB(cdp)); } catch (e) { } await new Promise(r => setTimeout(r, ms)); } })();
  try { const result = await fn(); return { result, peak }; } finally { stop = true; await loop; peak = Math.max(peak, await heapMB(cdp).catch(() => 0)); }
}
async function boot(p, q = '') {
  await p.goto('file://' + ROOT + '/Cutline/index.html' + q);
  await p.waitForFunction(() => window.Cutline && window.Cutline.ready);
}
async function newProjectUI(p, o = {}) {
  await p.waitForSelector('.dialog .welcome');
  await p.click(`.dialog .preset[data-w="${o.w || 1280}"][data-h="${o.h || 720}"]`);
  await p.click(`.dialog .chip-row .chip:text-is("${o.fps || 30}")`);
  await p.evaluate(() => { try { localStorage.setItem('cutline.tourDone', 'true'); } catch (e) { } }); // returning user: no welcome tour over the UI
  await p.click('.dialog-foot .btn.primary');
  await p.waitForFunction(() => !!Cutline.state.project);
  await p.waitForTimeout(300);
}
async function importUI(p, files) {
  let fc;
  try { [fc] = await Promise.all([p.waitForEvent('filechooser', { timeout: 30000 }), p.click('.bin-toolbar .icon-btn[data-tip^="Import media"]')]); }
  catch (e) {
    const diag = await p.evaluate(() => ({ dialogs: Array.from(document.querySelectorAll('.dialog')).map(d => d.textContent.slice(0, 120)), tour: !!document.querySelector('.cl-tour'), leftTab: document.querySelector('#p-bin .tab.active, #p-bin .tabs .active') && document.querySelector('#p-bin .tab.active, #p-bin .tabs .active').textContent })).catch(() => null);
    info('importUI failed: ' + e.message.split('\n')[0] + ' · ' + JSON.stringify(diag));
    await shot(p, 'importUI-failed');
    throw e;
  }
  await fc.setFiles(files.map(f => f.startsWith('/') ? f : MEDIA + f));
}
async function center(p, sel) { const bb = await p.locator(sel).first().boundingBox(); if (!bb) throw new Error('no box ' + sel); return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2, bb }; }
async function shot(p, name, opts = {}) { const f = SHOTS + name + '.png'; await p.screenshot(Object.assign({ path: f }, opts)); return f; }
function done(errs) {
  const real = errs.filter(e => !/Failed to load resource/.test(e));
  ok(real.length === 0, 'no console errors' + (real.length ? ': ' + real.join(' | ').slice(0, 800) : ''));
  console.log(failures ? 'FAILURES (' + failures + ')' : 'PASS');
  return failures;
}
module.exports = { fsLog, launch, heapMB, withHeap, boot, newProjectUI, importUI, center, shot, ok, info, done, MEDIA, OUT, SHOTS, fs, path };
// Resident memory (MB) of the busiest Chromium renderer process (includes ArrayBuffers, decoder buffers, canvases)
function rendererRSS(b) {
  const { execSync } = require('child_process');
  try {
    const root = b.process ? b.process().pid : null;
    const out = execSync("ps -eo pid,ppid,rss,args --no-headers").toString().split('\n');
    let best = 0;
    for (const line of out) { const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/); if (!m) continue; if (/--type=renderer/.test(m[4]) && /chrom/i.test(m[4])) best = Math.max(best, +m[3]); }
    return best / 1024;
  } catch (e) { return -1; }
}
module.exports.rendererRSS = rendererRSS;
// samples JS heap + renderer RSS while fn runs
module.exports.withMem = async function (b, cdp, fn, ms = 500) {
  let heap = 0, rss = 0, stop = false;
  const loop = (async () => { while (!stop) { try { heap = Math.max(heap, await module.exports.heapMB(cdp)); rss = Math.max(rss, rendererRSS(b)); } catch (e) { } await new Promise(r => setTimeout(r, ms)); } })();
  try { const result = await fn(); return { result, heap, rss }; } finally { stop = true; await loop; }
};
// ---- burned-in frame code (see gen_variant.sh): 14 bits frame-in-segment + 4 bits hour, 48x48 blocks at y=654 (1280x720)
// decode from a gray image buffer (Node, any resolution scaled from 1280x720)
module.exports.codeFromGray = function (buf, w, h) {
  const sx = w / 1280, sy = h / 720, bit = (k) => { const x = Math.round((16 + 56 * k + 24) * sx), y = Math.round((654 + 24) * sy); return buf[y * w + x] > 128 ? 1 : 0; };
  let f = 0, hr = 0; for (let k = 0; k < 14; k++) f |= bit(k) << k; for (let k = 0; k < 4; k++) hr |= bit(15 + k) << k;
  return { frame: f, hour: hr };
};
// reference: ffmpeg's frame at time t (accurate seek) -> code
module.exports.ffCode = function (file, t, w = 1280, h = 720) {
  const { execFileSync } = require('child_process');
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=' + w + ':' + h, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 64 << 20 });
  return module.exports.codeFromGray(raw, w, h);
};
// in-page helper source: reads the code from any drawable (video element / VideoFrame / canvas)
module.exports.PAGE_CODE = `window.__readCode = function (src, w, h) {
  w = w || 1280; h = h || 720;
  const c = window.__codeCv || (window.__codeCv = document.createElement('canvas')); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(src, 0, 0, w, h);
  const sx = w / 1280, sy = h / 720;
  const bit = (k) => { const d = g.getImageData(Math.round((16 + 56 * k + 24) * sx), Math.round((654 + 24) * sy), 1, 1).data; return (d[0] + d[1] + d[2]) / 3 > 128 ? 1 : 0; };
  let f = 0, hr = 0; for (let k = 0; k < 14; k++) f |= bit(k) << k; for (let k = 0; k < 4; k++) hr |= bit(15 + k) << k;
  return { frame: f, hour: hr };
};`;
// frame index difference modulo a 150 s / 60 fps segment (9000 frames)
module.exports.frameDiff = function (a, b) { let d = Math.abs(a.frame - b.frame) % 9000; d = Math.min(d, 9000 - d); return a.hour === b.hour ? d : 99999; };
// ffprobe packets as objects
module.exports.ffPackets = function (file, interval) {
  const { execFileSync } = require('child_process');
  const args = ['-v', 'error'].concat(interval ? ['-read_intervals', interval] : []).concat(['-show_entries', 'packet=stream_index,pts_time,size,pos,flags', '-of', 'csv=p=0', file]);
  return execFileSync('ffprobe', args, { maxBuffer: 256 << 20 }).toString().trim().split('\n').map(l => { const a = l.split(','); return { s: +a[0], pts: parseFloat(a[1]), size: +a[2], pos: +a[3], key: /K/.test(a[4] || '') }; });
};
// ground truth for burst timing: first sample with |x| > thr in ffmpeg's decode of `file` after time t (seconds)
module.exports.ffOnset = function (file, t, thr = 0.2) {
  const { execFileSync } = require('child_process');
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(Math.max(0, t)), '-i', file, '-t', '3', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 64 << 20 });
  const pcm = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  for (let i = 0; i < pcm.length; i++) if (Math.abs(pcm[i]) > thr) return Math.max(0, t) + i / 48000;
  return -1;
};
// A/V truth for the test media: the loud bursts are generated at the same instant as a known video frame (code
// 2220 = 37.000 s or 6720 = 112.000 s into each 150 s part), so the burst's presentation time is the pts of that
// video frame. Returns the pts (s) of the frame with frame-code `code` near time t, read from ffmpeg's decode.
module.exports.ffVideoTimeOfCode = function (file, t, code) {
  const { execFileSync } = require('child_process');
  const W = 320, H = 180, start = Math.max(0, t - 0.4);
  // -copyts keeps absolute timestamps (without it, ffmpeg's re-zeroing after an input seek can be off by a frame),
  // and the integer pts / filter time base are used because showinfo prints pts_time with only 6 significant digits
  const r = require('child_process').spawnSync('ffmpeg', ['-v', 'info', '-copyts', '-ss', String(start), '-t', '0.8', '-i', file, '-an', '-vf', 'scale=' + W + ':' + H + ',showinfo', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 64 << 20 });
  const err = r.stderr.toString(), tbm = err.match(/config in time_base:\s*(\d+)\/(\d+)/), tb = tbm ? (+tbm[1]) / (+tbm[2]) : 0;
  const pts = (err.match(/n:\s*\d+\s+pts:\s*-?\d+/g) || []).map(s => parseInt(s.split('pts:')[1], 10) * tb);
  const raw = r.stdout, fsz = W * H;
  for (let i = 0; i < pts.length && (i + 1) * fsz <= raw.length; i++) {
    const c = module.exports.codeFromGray(raw.subarray(i * fsz, (i + 1) * fsz), W, H);
    if (c.frame === code) return pts[i];
  }
  return null;
};
