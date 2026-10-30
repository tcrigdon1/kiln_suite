#!/usr/bin/env node
/* ImageFX test-suite: correctness, mask handling, extreme params, timing, PNG proof sheets.
 * Usage: node test.js [--no-timing] [--no-png] [--only=id1,id2]
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');

const LIB = path.resolve(__dirname, '../../shared/imagefx.js');
const OUT = path.join(__dirname, 'out');
const args = process.argv.slice(2);
const NO_TIMING = args.includes('--no-timing'), NO_PNG = args.includes('--no-png');
const ONLY = (args.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);

// ---- load library in a sandbox with no `window` (exercises the globalThis path) ----
// (runInThisContext: a separate vm context routes every global lookup such as `Math`
//  through an interceptor, which makes timings 5-10x slower than a real browser.)
if (typeof globalThis.window !== 'undefined') throw new Error('unexpected window');
vm.runInThisContext(fs.readFileSync(LIB, 'utf8'), { filename: 'imagefx.js' });
const FX = globalThis.ImageFX;
if (!FX) throw new Error('ImageFX not defined on globalThis');

// ---- tiny PNG encoder ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function encodePNG(img) {
  const { width: w, height: h, data } = img, raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(data.buffer, data.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = ihdr[11] = ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---- synthetic test images ----
function mk(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
function hash(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
/** Photo-like scene: sky gradient, sun, textured hills, colour discs, colour wheel, gray ramp, alpha corner. */
function scene(w, h, transparentCorner = true) {
  const img = mk(w, h), d = img.data, s = Math.min(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, u = x / w, v = y / h;
    let r = 70 + 120 * v, g = 120 + 90 * v, b = 230 - 40 * v;                        // sky
    const sx = x - w * 0.72, sy = y - h * 0.22, sd = Math.sqrt(sx * sx + sy * sy) / s;   // sun
    if (sd < 0.06) { r = 255; g = 250; b = 225; } else { const gl = Math.exp(-(sd - 0.06) * 14) * 0.7; r += (255 - r) * gl; g += (240 - g) * gl; b += (200 - b) * gl; }
    const hill = 0.55 + 0.08 * Math.sin(u * 7.0) + 0.05 * Math.sin(u * 17 + 1.3);
    if (v > hill) {                                                                         // hills w/ texture
      const t = vnoise(x / (s * 0.02), y / (s * 0.02)) * 0.6 + vnoise(x / (s * 0.006), y / (s * 0.006)) * 0.4;
      r = 40 + 70 * t + 30 * (v - hill); g = 90 + 90 * t; b = 40 + 30 * t;
    }
    // colour discs (R,G,B,C,M,Y)
    const cols = [[230, 40, 40], [40, 200, 60], [40, 70, 230], [40, 210, 220], [220, 50, 200], [240, 220, 40]];
    for (let k = 0; k < 6; k++) {
      const cx = w * (0.08 + k * 0.075), cy = h * 0.72 + (k % 2) * h * 0.08, dd = Math.hypot(x - cx, y - cy);
      if (dd < s * 0.07) { r = cols[k][0]; g = cols[k][1]; b = cols[k][2]; }
    }
    // colour wheel
    const wx = x - w * 0.18, wy = y - h * 0.28, wr = Math.hypot(wx, wy);
    if (wr < s * 0.16) {
      const hh = (Math.atan2(wy, wx) / Math.PI * 180 + 360) % 360, sat = wr / (s * 0.16);
      const c = FX.util.hsvToRgb(hh, sat, 1); r = c[0]; g = c[1]; b = c[2];
    }
    // fine detail stripes (for sharpen / moire checks)
    if (u > 0.42 && u < 0.56 && v > 0.08 && v < 0.4) { const st = ((x >> 1) + (y >> 3)) % 2; r = g = b = st ? 235 : 25; if (((x >> 3) + (y >> 3)) % 2) { r *= 0.9; b *= 0.6; } }
    // gray ramp at bottom
    if (v > 0.93) { r = g = b = u * 255; }
    let a = 255;
    if (transparentCorner && u > 0.86 && v < 0.5) { a = Math.max(0, Math.min(255, (1 - (u - 0.86) / 0.14) * 255 + (v < 0.12 ? -255 : 0))); }
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
  }
  return img;
}
function noisyPhoto(w, h) { const img = scene(w, h, false), d = img.data; for (let i = 0; i < d.length; i += 4) { const n = (hash(i, 7) - 0.5) * 50; d[i] += n; d[i + 1] += n * 0.8 + (hash(i, 9) - 0.5) * 20; d[i + 2] += n; } return img; }
function clone(img) { return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) }; }

// ---- assertions ----
let failures = 0, checks = 0;
function fail(msg) { failures++; console.log('  FAIL ' + msg); }
function ok(cond, msg) { checks++; if (!cond) fail(msg); }
function validOut(out, src, label) {
  ok(out && out.width === src.width && out.height === src.height, label + ': dimensions changed');
  ok(out && out.data && out.data.length === src.width * src.height * 4, label + ': bad data length');
  if (out && out.data) for (let i = 0; i < out.data.length; i++) { const v = out.data[i]; if (!(v >= 0 && v <= 255) || v !== Math.round(v)) { fail(label + ': value out of range/NaN at ' + i); break; } }
}
function maxDiff(a, b, rgbOnly) { let m = 0; for (let i = 0; i < a.data.length; i++) { if (rgbOnly && i % 4 === 3) continue; const d = Math.abs(a.data[i] - b.data[i]); if (d > m) m = d; } return m; }
function meanDiff(a, b) { let s = 0; for (let i = 0; i < a.data.length; i++) s += Math.abs(a.data[i] - b.data[i]); return s / a.data.length; }

// Probe for NaN generation: wrap Uint8ClampedArray writes is impossible, so test via Float detection —
// we run each effect on an image and also check the effect does not output large all-zero regions
// that are not present in the input (typical NaN symptom).
function zeroFrac(img) { let z = 0; for (let i = 0; i < img.data.length; i += 4) if (!img.data[i] && !img.data[i + 1] && !img.data[i + 2]) z++; return z / (img.data.length / 4); }

const ALL = [];
for (const id in FX.adjustments) ALL.push({ kind: 'adjustment', e: FX.adjustments[id] });
for (const id in FX.filters) ALL.push({ kind: 'filter', e: FX.filters[id] });
const LIST = ONLY.length ? ALL.filter(x => ONLY.includes(x.e.id)) : ALL;

// ---- interface checks ----
console.log('ImageFX', FX.version, '-', Object.keys(FX.adjustments).length, 'adjustments,', Object.keys(FX.filters).length, 'filters');
ok(FX.version === '1.0', 'version');
for (const { e, kind } of ALL) {
  ok(typeof e.id === 'string' && typeof e.name === 'string' && typeof e.category === 'string', e.id + ': id/name/category');
  if (kind === 'filter') ok(FX.categories.filters.includes(e.category), e.id + ': unknown category ' + e.category);
  ok(Array.isArray(e.params), e.id + ': params');
  for (const p of e.params) {
    ok(['range', 'number', 'checkbox', 'select', 'color', 'angle', 'curve', 'levels', 'gradient'].includes(p.type), e.id + '.' + p.id + ': type');
    if (p.type === 'range' || p.type === 'angle') ok(p.default >= p.min && p.default <= p.max, e.id + '.' + p.id + ': default out of range');
    if (p.type === 'select') ok(p.options.some(o => o.value === p.default), e.id + '.' + p.id + ': default not in options');
  }
  const d1 = FX.defaults(e); d1.__x = 1; ok(!('__x' in FX.defaults(e)), e.id + ': defaults not cloned');
}
// util checks
{
  const U = FX.util, lut = U.buildCurveLUT([[0, 0], [255, 255]]);
  ok(lut.length === 256 && lut.every((v, i) => v === i), 'identity curve');
  const l2 = U.buildCurveLUT([[0, 0], [64, 40], [192, 220], [255, 255]]); let mono = true; for (let i = 1; i < 256; i++) if (l2[i] < l2[i - 1]) mono = false; ok(mono, 'curve monotone');
  ok(U.rgbToHex(...U.hexToRgb('#3a7bd5')) === '#3a7bd5', 'hex roundtrip');
  const h = U.rgbToHsl(200, 100, 50), b = U.hslToRgb(h[0], h[1], h[2]); ok(Math.abs(b[0] - 200) < 1 && Math.abs(b[1] - 100) < 1 && Math.abs(b[2] - 50) < 1, 'hsl roundtrip');
  const hv = U.rgbToHsv(20, 200, 90), bv = U.hsvToRgb(hv[0], hv[1], hv[2]); ok(Math.abs(bv[1] - 200) < 1, 'hsv roundtrip');
  const g = U.gradientLUT([{ pos: 0, color: '#000000' }, { pos: 1, color: '#ff0000' }]); ok(g.length === 1024 && g[255 * 4] === 255 && g[0] === 0, 'gradient LUT');
  const im = scene(64, 48), s = U.sampleBilinear(im, 10, 10); ok(s.length === 4 && Math.abs(s[0] - im.data[(10 * 64 + 10) * 4]) < 1, 'sampleBilinear');
  const hist = FX.histogram(im); ok(hist.r.length === 256 && hist.a.reduce((a, b) => a + b, 0) === 64 * 48, 'histogram');
}

// ---- per-effect correctness on a small image ----
const SMALL = scene(160, 112), NOISY = noisyPhoto(160, 112);
const IDENTITY = ['brightnessContrast', 'levels', 'curves', 'exposure', 'hueSaturation', 'colorBalance', 'vibrance', 'channelMixer', 'selectiveColor', 'temperatureTint'];
const W = SMALL.width, H = SMALL.height, mask = new Uint8ClampedArray(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) mask[y * W + x] = x < W * 0.4 ? 0 : (x > W * 0.6 ? 255 : Math.round((x - W * 0.4) / (W * 0.2) * 255));

console.log('\nCorrectness checks...');
for (const { e } of LIST) {
  const label = e.id;
  try {
    const src = clone(SMALL), out = FX.apply(e.id, src, {});
    ok(maxDiff(src, SMALL) === 0, label + ': ImageFX.apply mutated input');
    validOut(out, SMALL, label + ' default');
    if (IDENTITY.includes(e.id)) { const md = maxDiff(out, SMALL); ok(md <= 1, label + ': default not identity (maxDiff ' + md + ')'); }
    else if (e.params.length || ['invert', 'desaturate'].includes(e.id)) {
      const md = meanDiff(out, SMALL); if (md < 0.3) console.log('  note: ' + label + ' default changes little (meanDiff ' + md.toFixed(2) + ')');
    }
    if (zeroFrac(out) > zeroFrac(SMALL) + 0.6 && !['threshold', 'findEdges', 'glowingEdges', 'highPass', 'mezzotint'].includes(e.id)) console.log('  warn: ' + label + ' produced many black pixels (possible NaN)');
    // mask honoured
    const full = FX.apply(e.id, SMALL, {}, { seed: 3 });
    const masked = FX.apply(e.id, SMALL, {}, { selectionMask: mask, seed: 3 });
    let leftOk = true, rightOk = true;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      for (let c = 0; c < 4; c++) {
        if (x < W * 0.4 && masked.data[i + c] !== SMALL.data[i + c]) leftOk = false;
        if (x > W * 0.6 + 1 && masked.data[i + c] !== full.data[i + c]) rightOk = false;
      }
    }
    ok(leftOk, label + ': mask=0 region changed');
    if (!/^auto/.test(e.id)) ok(rightOk, label + ': mask=255 region differs from unmasked result'); // auto* use the masked histogram by design
    // zero mask -> unchanged
    const zm = FX.apply(e.id, SMALL, {}, { selectionMask: new Uint8ClampedArray(W * H) }); ok(maxDiff(zm, SMALL) === 0, label + ': zero mask changed image');
    // determinism
    const again = FX.apply(e.id, SMALL, {}, { seed: 3 }); ok(maxDiff(again, full) === 0, label + ': not deterministic');
    // extreme params: all numeric at min, then at max; each select option; each checkbox flipped
    const tiny = scene(72, 50);
    for (const which of ['min', 'max']) {
      const p = FX.defaults(e);
      for (const d of e.params) if (d.min !== undefined && (d.type === 'range' || d.type === 'angle' || d.type === 'number')) p[d.id] = d[which];
      validOut(FX.apply(e.id, tiny, p), tiny, label + ' ' + which);
    }
    for (const d of e.params) {
      if (d.type === 'select') for (const o of d.options) { const p = FX.defaults(e); p[d.id] = o.value; validOut(FX.apply(e.id, tiny, p), tiny, label + ' ' + d.id + '=' + o.value); }
      if (d.type === 'checkbox') { const p = FX.defaults(e); p[d.id] = !d.default; validOut(FX.apply(e.id, tiny, p), tiny, label + ' ' + d.id + '=' + !d.default); }
    }
    validOut(FX.apply(e.id, NOISY, {}), NOISY, label + ' noisy');
    // 1x1 and thin images
    validOut(FX.apply(e.id, scene(1, 1), {}), scene(1, 1), label + ' 1x1');
    validOut(FX.apply(e.id, scene(3, 40), {}), scene(3, 40), label + ' 3x40');
  } catch (err) { fail(label + ': threw ' + (err && err.stack || err)); }
}
// structured param checks
{
  const lv = FX.apply('levels', SMALL, { levels: { rgb: { inBlack: 30, inWhite: 220, gamma: 1.3, outBlack: 0, outWhite: 255 } } });
  validOut(lv, SMALL, 'levels partial'); ok(meanDiff(lv, SMALL) > 2, 'levels partial has effect');
  const cv = FX.apply('curves', SMALL, { curve: { rgb: [[0, 0], [128, 160], [255, 255]] } });
  validOut(cv, SMALL, 'curves partial'); ok(meanDiff(cv, SMALL) > 2, 'curves partial has effect');
  const gm = FX.apply('gradientMap', SMALL, { gradient: [{ pos: 0, color: '#200040' }, { pos: 0.5, color: '#e04060' }, { pos: 1, color: '#ffe080' }] });
  validOut(gm, SMALL, 'gradientMap custom');
  const ac = FX.apply('autoTone', SMALL, {}, { selectionMask: mask }); validOut(ac, SMALL, 'autoTone masked');
}
// alpha-correct blurs: an opaque red disc on transparent BLACK must not get dark fringes
{
  const im = mk(120, 90);
  for (let y = 0; y < 90; y++) for (let x = 0; x < 120; x++) { const i = (y * 120 + x) * 4; if (Math.hypot(x - 60, y - 45) < 25) { im.data[i] = 255; im.data[i + 3] = 255; } }
  for (const [id, p] of [['gaussianBlur', { radius: 1 }], ['gaussianBlur', { radius: 2.5 }], ['gaussianBlur', { radius: 8 }], ['gaussianBlur', { radius: 40 }], ['boxBlur', { radius: 6 }], ['motionBlur', {}], ['radialBlur', {}], ['bokehBlur', {}], ['twirl', {}], ['tiltShift', {}]]) {
    const o = FX.apply(id, im, p); let worst = 0;
    for (let i = 0; i < o.data.length; i += 4) if (o.data[i + 3] > 8) worst = Math.max(worst, 255 - o.data[i], o.data[i + 1], o.data[i + 2]);
    ok(worst <= 6, id + ' ' + JSON.stringify(p) + ': dark/colour fringe on transparent edge (worst ' + worst + ')');
  }
}
console.log(`\n${checks} checks, ${failures} failures`);

// ---- PNG proof sheets ----
const VISUAL_PARAMS = {
  brightnessContrast: { brightness: 40, contrast: 40 }, levels: { levels: { rgb: { inBlack: 25, inWhite: 225, gamma: 1.25, outBlack: 0, outWhite: 255 } } },
  curves: { curve: { rgb: [[0, 0], [64, 48], [192, 215], [255, 255]], b: [[0, 20], [255, 235]] } }, exposure: { exposure: 0.8 }, hueSaturation: { hue: 60, saturation: 30 },
  colorBalance: { shadowsYB: 40, midtonesCR: 40, highlightsYB: -40 }, vibrance: { vibrance: 80 }, channelMixer: { redR: 60, redG: 40, blueB: 60, blueR: 40 },
  selectiveColor: { colors: 'reds', cyan: 100, yellow: -60 }, temperatureTint: { temperature: 60 }, shadowsHighlights: { shadows: 70, highlights: 50 },
  gradientMap: { gradient: [{ pos: 0, color: '#1a0b3b' }, { pos: 0.5, color: '#d1495b' }, { pos: 1, color: '#fbe7a1' }] }
};
if (!NO_PNG) {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.unlinkSync(path.join(OUT, f));
  const VIS = scene(480, 320);
  fs.writeFileSync(path.join(OUT, '000_original.png'), encodePNG(VIS));
  let idx = 1;
  const manifest = [];
  for (const { e, kind } of LIST) {
    const out = FX.apply(e.id, VIS, VISUAL_PARAMS[e.id] || {});
    const name = String(idx++).padStart(3, '0') + '_' + (kind === 'adjustment' ? 'adj' : e.category) + '_' + e.id + '.png';
    fs.writeFileSync(path.join(OUT, name), encodePNG(out));
    manifest.push(name);
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log('Wrote', manifest.length + 1, 'PNGs to', OUT);
}

// ---- timing ----
if (!NO_TIMING) {
  const BIG = scene(2000, 1500);
  console.log('\nTiming on 2000x1500 (default params):');
  const rows = [];
  for (const { e } of LIST) {
    const t0 = process.hrtime.bigint();
    FX.apply(e.id, BIG, {});
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    rows.push([e.id, ms]);
  }
  rows.sort((a, b) => b[1] - a[1]);
  for (const [id, ms] of rows) console.log('  ' + id.padEnd(22) + ms.toFixed(0).padStart(7) + ' ms' + (ms > 1500 ? '   <-- SLOW' : ''));
  console.log('\nWorst-case params on 2000x1500:');
  for (const [id, p] of [['median', { radius: 50 }], ['oilPaint', { radius: 10 }], ['surfaceBlur', { radius: 100 }], ['bokehBlur', { radius: 100 }], ['radialBlur', { amount: 100 }],
    ['radialBlur', { amount: 100, mode: 'spin' }], ['motionBlur', { distance: 1000 }], ['reduceNoise', { strength: 10 }], ['gaussianBlur', { radius: 250 }], ['maximum', { radius: 100 }], ['tiltShift', { blur: 100 }], ['colorHalftone', { maxRadius: 2 }]]) {
    const t0 = Date.now(); FX.apply(id, BIG, p); console.log('  ' + (id + ' ' + JSON.stringify(p)).padEnd(44) + String(Date.now() - t0).padStart(7) + ' ms');
  }
  for (const [w, h] of [[3840, 2160], [4000, 3000]]) {
    const k4 = scene(w, h);
    for (const r of [1, 4, 20, 250]) { const t0 = Date.now(); FX.apply('gaussianBlur', k4, { radius: r }); console.log(`  ${w}x${h} gaussianBlur r=${r}: ${Date.now() - t0} ms`); }
  }
}
process.exitCode = failures ? 1 : 0;
