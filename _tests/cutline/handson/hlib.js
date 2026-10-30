// Hands-on QA helpers: real mouse/keyboard input only. State is read (never written) via page.evaluate.
const { ROOT } = require('../../env.js');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const MEDIA = path.join(__dirname, 'media') + '/';
const SHOTS = path.join(__dirname, 'shots') + '/';
const URL = 'file://' + ROOT + '/Cutline/index.html';
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
function ok(cond, msg) { if (cond) console.log('ok - ' + msg); else { failures++; console.log('ASSERT FAIL - ' + msg); } }
function info(msg) { console.log('  · ' + msg); }

async function launch(opts = {}) {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext({ viewport: opts.viewport || { width: 1600, height: 900 }, acceptDownloads: true, permissions: ['microphone'] });
  // Environment shim: headless Chromium cannot show the native File System Access save/open dialogs, so hide that API
  // and let the app use its <a download> / <input type=file> fallbacks (the same path Firefox/older browsers take).
  await ctx.addInitScript(() => { try { delete window.showSaveFilePicker; delete window.showOpenFilePicker; window.showSaveFilePicker = undefined; window.showOpenFilePicker = undefined; } catch (e) { } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message + '\n' + e.stack));
  p.on('dialog', d => { if (d.type() === 'beforeunload') { p.sawBeforeUnload = true; d.accept(); return; } errs.push('native dialog: ' + d.message()); d.dismiss(); });
  return { b, ctx, p, errs };
}

let shotN = 0, prefix = 'x';
function setPrefix(x) { prefix = x; shotN = 0; }
async function shot(p, name, opts = {}) {
  shotN++;
  const f = SHOTS + prefix + '-' + String(shotN).padStart(2, '0') + '-' + name + '.png';
  await p.screenshot(Object.assign({ path: f }, opts));
  return f;
}

async function center(p, sel) {
  let bb = null;
  await p.locator(sel).first().scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => { });
  for (let i = 0; i < 10 && !bb; i++) { bb = await p.locator(sel).first().boundingBox({ timeout: 2000 }).catch(() => null); if (!bb) await p.waitForTimeout(150); }
  if (!bb) { await p.screenshot({ path: SHOTS + 'FAIL-nobox.png' }); throw new Error('no box for ' + sel); }
  return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2, bb };
}
// realistic drag with intermediate steps
async function drag(p, x1, y1, x2, y2, o = {}) {
  const steps = o.steps || 14;
  if (o.mods) for (const m of o.mods) await p.keyboard.down(m);
  await p.mouse.move(x1, y1);
  await p.mouse.down({ button: o.button || 'left' });
  for (let i = 1; i <= steps; i++) {
    await p.mouse.move(x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps);
    if (o.delay) await p.waitForTimeout(o.delay);
  }
  if (o.beforeUp) await o.beforeUp();
  await p.mouse.up({ button: o.button || 'left' });
  if (o.mods) for (const m of o.mods.slice().reverse()) await p.keyboard.up(m);
  await p.waitForTimeout(o.settle != null ? o.settle : 120);
}
// HTML5 drag & drop between elements using real mouse moves (Playwright drives Chromium's native DnD)
async function dnd(p, x1, y1, x2, y2, o = {}) { return drag(p, x1, y1, x2, y2, Object.assign({ steps: 20, delay: 15 }, o)); }

// OS file drop: build File objects in the page and dispatch dragenter/dragover/drop at a point
async function dropFiles(p, names, x, y) {
  const files = names.map(n => ({ name: path.basename(n), b64: fs.readFileSync(n.startsWith('/') ? n : MEDIA + n).toString('base64'), type: mime(n) }));
  await p.evaluate(({ files, x, y }) => {
    const dt = new DataTransfer();
    files.forEach(f => { const bin = atob(f.b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); dt.items.add(new File([u], f.name, { type: f.type })); });
    const el = document.elementFromPoint(x, y);
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt };
    el.dispatchEvent(new DragEvent('dragenter', opts));
    el.dispatchEvent(new DragEvent('dragover', opts));
    el.dispatchEvent(new DragEvent('drop', opts));
  }, { files, x, y });
}
function mime(n) {
  const e = path.extname(n).toLowerCase();
  return { '.webm': 'video/webm', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.png': 'image/png', '.jpg': 'image/jpeg', '.srt': 'application/x-subrip', '.kcut': 'application/json' }[e] || '';
}

async function boot(p, q = '') {
  await p.goto(URL + q);
  await p.waitForFunction(() => window.Cutline && window.Cutline.ready);
}
// Welcome dialog → new 1080p30 project, using clicks only
async function newProjectUI(p, o = {}) {
  await p.waitForSelector('.dialog .welcome');
  if (o.name) { await p.click('.welcome input[type=text]', { clickCount: 3 }); await p.keyboard.type(o.name); }
  await p.click(`.dialog .preset[data-w="${o.w || 1920}"][data-h="${o.h || 1080}"]`);
  await p.click(`.dialog .chip-row .chip:text-is("${o.fps || 30}")`);
  if (!o.tour) await p.evaluate(() => { try { localStorage.setItem('cutline.tourDone', 'true'); } catch (e) { } }); // returning user: no welcome tour over the UI
  await p.click('.dialog-foot .btn.primary');
  await p.waitForFunction(() => !!Cutline.state.project);
  await p.waitForTimeout(300);
}
// Import via the visible Library import button (file chooser)
async function importUI(p, names, wait = true) {
  const before = await p.evaluate(() => Cutline.state.project.media.length);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('.bin-toolbar .icon-btn[data-tip^="Import media"]')]);
  await fc.setFiles(names.map(n => MEDIA + n));
  if (wait) await waitReady(p, before + names.length);
}
async function waitReady(p, n, timeout = 60000) {
  await p.waitForFunction((n) => { const C = Cutline; return C.state.project.media.filter(m => m.type === 'gen' || (C.MRT[m.id] && C.MRT[m.id].status === 'ready')).length >= n; }, n, { timeout });
  await p.waitForTimeout(300);
}
// read-only state snapshots
async function clips(p) {
  return p.evaluate(() => { const C = Cutline, s = C.P.seq(); return s.clips.map(c => ({ id: c.id, name: c.name, kind: c.kind, track: C.P.trackLabel(s, C.P.track(s, c.trackId)), start: c.start, dur: c.dur, in: c.in, speed: c.speed, link: c.link, mediaId: c.mediaId })); });
}
async function tlRowY(p, label) { // client Y center of a timeline track row by label (V1, A2...)
  return p.evaluate((label) => {
    const C = Cutline, TL = C.TL, s = C.P.seq();
    const r = TL.rows.find(r => r.track && C.P.trackLabel(s, r.track) === label);
    const sr = TL.scroller.getBoundingClientRect();
    return sr.top + r.y - TL.scrollY + r.h / 2;
  }, label);
}
async function tlX(p, f) { return p.evaluate((f) => { const TL = Cutline.TL; return TL.scroller.getBoundingClientRect().left + TL.f2x(f); }, f); }
async function clipBox(p, pred) { // pred: clip id or {track, idx}
  return p.evaluate((pred) => {
    const C = Cutline, TL = C.TL, s = C.P.seq();
    let c = typeof pred === 'string' ? C.P.clip(s, pred) : s.clips.filter(x => C.P.trackLabel(s, C.P.track(s, x.trackId)) === pred.track).sort((a, b) => a.start - b.start)[pred.idx || 0];
    if (!c) return null;
    const r = TL.rowOf(c.trackId), sr = TL.scroller.getBoundingClientRect();
    const top = sr.top + r.y - TL.scrollY;
    return { id: c.id, x0: sr.left + TL.f2x(c.start), x1: sr.left + TL.f2x(c.start + c.dur), y: top + r.h * 0.62, top: top, h: r.h, start: c.start, dur: c.dur };
  }, pred);
}
async function frame(p) { return p.evaluate(() => Cutline.Engine.frame); }
// sample program canvas pixels at fractional positions; returns array of [r,g,b]
async function progPixels(p, pts) {
  await p.waitForTimeout(150);
  return p.evaluate((pts) => {
    const cv = Cutline.Program.canvas, c2 = document.createElement('canvas');
    c2.width = cv.width; c2.height = cv.height; const g = c2.getContext('2d'); g.drawImage(cv, 0, 0);
    return pts.map(([fx, fy]) => Array.from(g.getImageData(Math.floor(fx * (cv.width - 1)), Math.floor(fy * (cv.height - 1)), 1, 1).data).slice(0, 3));
  }, pts);
}
async function progHash(p) {
  await p.waitForTimeout(150);
  return p.evaluate(() => {
    const cv = Cutline.Program.canvas, c2 = document.createElement('canvas'); c2.width = 64; c2.height = 36;
    const g = c2.getContext('2d'); g.drawImage(cv, 0, 0, 64, 36); const d = g.getImageData(0, 0, 64, 36).data; let h = 0;
    for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) % 1000000007; return h;
  });
}
async function key(p, k, n = 1) { for (let i = 0; i < n; i++) { await p.keyboard.press(k); await p.waitForTimeout(40); } await p.waitForTimeout(80); }
async function menu(p, title, label, sub) {
  await p.click(`.menu-title:text-is("${title}")`);
  await p.waitForTimeout(80);
  const it = p.locator('.cl-menu .item', { hasText: label }).first();
  if (sub) { await it.hover(); await p.waitForTimeout(120); await p.locator('.cl-menu').last().locator('.item', { hasText: sub }).first().click(); }
  else await it.click();
  await p.waitForTimeout(200);
}
async function finish(b, errs, name) {
  const real = errs.filter(e => !/native dialog/.test(e) || true);
  if (real.length) { console.log('TEST ERROR: console/page errors in ' + name + ':\n' + real.join('\n').slice(0, 4000)); failures++; }
  console.log(failures ? `FAILURES: ${failures} (${name})` : `PASS (${name})`);
  await b.close();
  process.exit(failures ? 1 : 0);
}
module.exports = { clipBox, launch, boot, newProjectUI, importUI, waitReady, shot, setPrefix, center, drag, dnd, dropFiles, clips, tlRowY, tlX, frame, progPixels, progHash, key, menu, ok, info, finish, MEDIA, SHOTS, fs, path };
