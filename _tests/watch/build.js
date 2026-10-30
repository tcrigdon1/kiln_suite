// Builds an original watch concept ("Kiln Ember") inside Gesso using its own layer engine,
// then saves a .kgesso project, a flattened PNG, and an in-editor screenshot.
const { ROOT } = require('../env.js');
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = __dirname + '/out';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + ROOT + '/Gesso/index.html');
  await page.waitForTimeout(800);

  const result = await page.evaluate(async () => {
    const S = window.Gesso, U = S.util, L = S.Layers, P = S.Paths, FX = S.Effects;
    const W = 1600, H = 2000, CX = 800, CY = 900;
    const doc = new S.Document({ name: 'Kiln Ember Concept', width: W, height: H });
    const rad = (d) => (d * Math.PI) / 180;

    // ---------- helpers ----------
    const fx = (items) => {
      const out = { enabled: true, items: {} };
      for (const k in items) out.items[k] = Object.assign(FX.defaults(k), items[k]);
      return out;
    };
    const poly = (pts) => ({ closed: true, nodes: pts.map(([x, y]) => P.node(x, y)) });
    const rot = (pts, deg, cx, cy) => {
      const a = rad(deg), c = Math.cos(a), s = Math.sin(a);
      return pts.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
    };
    // rectangle centred on the radial line at angle deg (0 = 12 o'clock), from r1 to r2
    const radialBar = (deg, r1, r2, w) => poly(rot([[-w / 2, -r2], [w / 2, -r2], [w / 2, -r1], [-w / 2, -r1]], deg, CX, CY));
    const shapePath = (name, subpaths, fill, extra) => {
      const l = L.shape(doc, { kind: 'path', path: { subpaths }, fill: { enabled: true, color: fill } });
      l.name = name; return Object.assign(l, extra || {});
    };
    const ellipse = (name, cx, cy, r, fill, extra) => {
      const l = L.shape(doc, { kind: 'ellipse', x: cx - r, y: cy - r, w: r * 2, h: r * 2, fill: { enabled: true, color: fill } });
      l.name = name; return Object.assign(l, extra || {});
    };
    const rrect = (name, x, y, w, h, r, fill, extra) => {
      const l = L.shape(doc, { kind: 'roundRect', x, y, w, h, radius: r, fill: { enabled: true, color: fill } });
      l.name = name; return Object.assign(l, extra || {});
    };
    const text = (name, str, x, baseline, size, o) => {
      const t = Object.assign({ text: str, x, y: baseline - size * 0.92, size, font: 'Georgia', weight: 400, color: '#f3d2b3', align: 'center' }, o || {});
      const l = L.text(doc, t); l.name = name; return l;
    };
    const raster = (name, draw, extra) => {
      const l = L.raster(doc, name); draw(l.canvas.getContext('2d')); return Object.assign(l, extra || {});
    };
    const group = (name, children) => { const g = L.group(doc, name); g.children = children; return g; };

    const ROSE = [{ pos: 0, color: '#6e3b28' }, { pos: 0.18, color: '#f6c8a8' }, { pos: 0.36, color: '#a8664a' }, { pos: 0.55, color: '#ffe0c8' }, { pos: 0.75, color: '#94553b' }, { pos: 1, color: '#6e3b28' }];
    const ROSE_LIN = [{ pos: 0, color: '#ffe3cc' }, { pos: 0.45, color: '#d0906f' }, { pos: 1, color: '#7a4330' }];

    // ---------- background ----------
    const bg = L.fill(doc, { kind: 'gradient', gtype: 'radial', stops: [{ pos: 0, color: '#2c2521' }, { pos: 0.6, color: '#161210' }, { pos: 1, color: '#080706' }], angle: 90, scale: 110, oy: -100 });
    bg.name = 'Backdrop';

    // ---------- strap ----------
    const strapFx = () => fx({ gradientOverlay: { gradient: [{ pos: 0, color: '#1c100a' }, { pos: 0.25, color: '#4b2d1d' }, { pos: 0.5, color: '#5a3622' }, { pos: 0.75, color: '#4b2d1d' }, { pos: 1, color: '#1c100a' }], angle: 0, style: 'linear' }, innerShadow: { opacity: 50, size: 20, distance: 4 } });
    const strapTop = rrect('Strap — top', CX - 225, -60, 450, 600, 70, '#3a2216', { effects: strapFx() });
    const strapBot = rrect('Strap — bottom', CX - 225, 1260, 450, 800, 70, '#3a2216', { effects: strapFx() });
    const stitch = (name, x, y, w, h) => {
      const l = L.shape(doc, { kind: 'roundRect', x, y, w, h, radius: 55, fill: { enabled: false, color: '#000' },
        stroke: { enabled: true, color: '#d6b08a', width: 3, align: 'center', dash: 'dash', cap: 'butt', join: 'round' } });
      l.name = name; l.opacity = 0.75; return l;
    };
    const strap = group('Strap', [strapTop, strapBot, stitch('Stitching — top', CX - 200, -40, 400, 560), stitch('Stitching — bottom', CX - 200, 1300, 400, 740)]);

    // ---------- case ----------
    const metal = (angle) => fx({ gradientOverlay: { gradient: ROSE_LIN, angle, style: 'linear' } });
    const lugs = shapePath('Lugs', [
      ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => {
        const x = CX + sx * 205, y = CY + sy * 390;
        return poly([[x - 38, y - 70 * sy], [x + 38, y - 70 * sy], [x + 30, y + 80 * sy], [x - 30, y + 80 * sy]]);
      }),
    ], '#c4846a', { effects: fx({ gradientOverlay: { gradient: ROSE_LIN, angle: 160, style: 'linear' }, innerShadow: { opacity: 45, size: 10, distance: 3 }, dropShadow: { opacity: 60, size: 18, distance: 10 } }) });
    const crownGuard = rrect('Crown', CX + 425, CY - 48, 70, 96, 14, '#c4846a', { effects: fx({ gradientOverlay: { gradient: [{ pos: 0, color: '#7a4330' }, { pos: 0.35, color: '#ffe3cc' }, { pos: 0.6, color: '#b5714f' }, { pos: 1, color: '#5e3123' }], angle: 90, style: 'linear' }, dropShadow: { opacity: 60, size: 10, distance: 6 } }) });
    const crownRidges = raster('Crown fluting', (x) => {
      x.strokeStyle = 'rgba(60,25,15,0.55)'; x.lineWidth = 2;
      for (let i = 0; i < 9; i++) { const yy = CY - 40 + i * 10; x.beginPath(); x.moveTo(CX + 452, yy); x.lineTo(CX + 492, yy); x.stroke(); }
    });
    const caseBody = ellipse('Case', CX, CY, 440, '#c4846a', { effects: fx({ gradientOverlay: { gradient: ROSE, angle: 30, style: 'angle' }, dropShadow: { opacity: 75, size: 70, distance: 34, angle: 110 } }) });
    const bezel = ellipse('Bezel', CX, CY, 412, '#c4846a', { effects: metal(135) });
    const bezelEdge = ellipse('Bezel step', CX, CY, 392, '#8a4d38', { effects: fx({ gradientOverlay: { gradient: [{ pos: 0, color: '#5a2e20' }, { pos: 0.5, color: '#b97a5c' }, { pos: 1, color: '#ffd9bf' }], angle: 135, style: 'linear' } }) });
    const caseGroup = group('Case', [lugs, crownGuard, crownRidges, caseBody, bezel, bezelEdge]);

    // ---------- dial ----------
    const chapter = ellipse('Chapter ring', CX, CY, 380, '#1b120e', { effects: fx({ innerShadow: { opacity: 85, size: 18, distance: 6 } }) });
    const dial = ellipse('Dial', CX, CY, 352, '#4a2210', { effects: fx({ gradientOverlay: { gradient: [{ pos: 0, color: '#b0571c' }, { pos: 0.45, color: '#5c2a0f' }, { pos: 1, color: '#160905' }], style: 'radial', angle: 90, scale: 100 }, innerShadow: { opacity: 70, size: 34, distance: 8 } }) });
    const sunburst = raster('Sunburst brushing', (x) => {
      for (let i = 0; i < 720; i++) {
        const a = (i / 720) * Math.PI * 2;
        x.strokeStyle = i % 2 ? 'rgba(255,220,180,0.55)' : 'rgba(0,0,0,0.45)'; x.lineWidth = 1.4;
        x.beginPath(); x.moveTo(CX, CY); x.lineTo(CX + Math.cos(a) * 360, CY + Math.sin(a) * 360); x.stroke();
      }
    }, { clip: true, blend: 'overlay', opacity: 0.35 });
    const sheen = raster('Dial sheen', (x) => {
      const g = x.createConicGradient(rad(-60), CX, CY);
      [[0, 0.0], [0.12, 0.5], [0.25, 0.0], [0.5, 0.0], [0.62, 0.35], [0.75, 0.0], [1, 0.0]].forEach(([p, a]) => g.addColorStop(p, 'rgba(255,200,150,' + a + ')'));
      x.fillStyle = g; x.beginPath(); x.arc(CX, CY, 360, 0, Math.PI * 2); x.fill();
    }, { clip: true, blend: 'soft-light', opacity: 0.8 });
    const minuteTicks = [];
    for (let i = 0; i < 60; i++) if (i % 5) minuteTicks.push(radialBar(i * 6, 338, 360, 3));
    const ticks = shapePath('Minute track', minuteTicks, '#f2dcc6', { opacity: 0.8 });
    const fiveTicks = [];
    for (let i = 0; i < 12; i++) fiveTicks.push(radialBar(i * 30, 332, 362, 5));
    const ticks5 = shapePath('Five-minute marks', fiveTicks, '#f6c8a8');
    const idx = [];
    for (let h = 0; h < 12; h++) {
      if (h === 6) continue; // aperture at six
      if (h === 0) { idx.push(radialBar(-3.2, 236, 316, 15)); idx.push(radialBar(3.2, 236, 316, 15)); continue; }
      if (h === 3) { idx.push(radialBar(90, 290, 316, 15)); continue; } // shortened for the date window
      idx.push(radialBar(h * 30, 246, 316, 16));
    }
    const indices = shapePath('Applied indices', idx, '#e8b08c', { effects: fx({ gradientOverlay: { gradient: ROSE_LIN, angle: 120, style: 'linear' }, dropShadow: { opacity: 70, size: 6, distance: 4 } }) });

    // date window at 3
    const dateFrame = rrect('Date frame', CX + 196, CY - 28, 82, 56, 8, '#c4846a', { effects: metal(100) });
    const dateWin = rrect('Date window', CX + 201, CY - 23, 72, 46, 5, '#f4ece2', { effects: fx({ innerShadow: { opacity: 60, size: 6, distance: 3 } }) });
    const dateTxt = text('Date', '27', CX + 237, CY + 12, 32, { font: 'Georgia', color: '#1b120e', weight: 700 });

    // open balance aperture at 6
    const AX = CX, AY = CY + 205, AR = 92;
    const aperture = ellipse('Aperture', AX, AY, AR, '#0c0807', { effects: fx({ innerShadow: { opacity: 90, size: 22, distance: 6 } }) });
    const movement = raster('Movement', (x) => {
      // bridge plate with perlage
      x.fillStyle = '#34302d'; x.fillRect(AX - AR, AY - AR, AR * 2, AR * 2);
      for (let i = 0; i < 80; i++) {
        const px = AX - AR + ((i * 37) % (AR * 2)), py = AY - AR + ((i * 53) % (AR * 2));
        const g = x.createRadialGradient(px, py, 0, px, py, 14);
        g.addColorStop(0, 'rgba(255,255,255,0.07)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.beginPath(); x.arc(px, py, 14, 0, 7); x.fill();
      }
      // escape wheel (toothed)
      const gear = (gx, gy, r, teeth, col) => {
        x.fillStyle = col; x.beginPath();
        for (let t = 0; t < teeth * 2; t++) { const a = (t / (teeth * 2)) * Math.PI * 2, rr = t % 2 ? r : r * 0.86; x.lineTo(gx + Math.cos(a) * rr, gy + Math.sin(a) * rr); }
        x.closePath(); x.fill();
        x.fillStyle = 'rgba(0,0,0,0.45)'; x.beginPath(); x.arc(gx, gy, r * 0.62, 0, 7); x.fill();
        x.strokeStyle = col; x.lineWidth = 3;
        for (let s = 0; s < 4; s++) { const a = (s / 4) * Math.PI * 2 + 0.3; x.beginPath(); x.moveTo(gx, gy); x.lineTo(gx + Math.cos(a) * r * 0.8, gy + Math.sin(a) * r * 0.8); x.stroke(); }
      };
      gear(AX + 48, AY + 46, 34, 20, '#c9a46a');
      gear(AX - 56, AY + 40, 26, 15, '#b8955e');
      // balance wheel
      x.strokeStyle = '#e2c08a'; x.lineWidth = 7; x.beginPath(); x.arc(AX, AY - 6, 52, 0, 7); x.stroke();
      x.lineWidth = 4;
      for (let s = 0; s < 3; s++) { const a = (s / 3) * Math.PI * 2 + 0.5; x.beginPath(); x.moveTo(AX, AY - 6); x.lineTo(AX + Math.cos(a) * 50, AY - 6 + Math.sin(a) * 50); x.stroke(); }
      // hairspring
      x.strokeStyle = 'rgba(210,225,240,0.85)'; x.lineWidth = 1.2; x.beginPath();
      for (let t = 0; t < 6 * Math.PI * 2; t += 0.05) { const r = 6 + t * 0.85; x.lineTo(AX + Math.cos(t) * r, AY - 6 + Math.sin(t) * r); }
      x.stroke();
      // balance bridge
      x.fillStyle = '#7d756d'; x.beginPath(); x.moveTo(AX - 95, AY - 70); x.quadraticCurveTo(AX - 40, AY - 20, AX - 12, AY - 12); x.arc(AX, AY - 6, 13, Math.PI * 1.15, Math.PI * 0.85, true); x.quadraticCurveTo(AX - 50, AY + 10, AX - 95, AY - 34); x.closePath(); x.fill();
      x.fillStyle = '#d8d2ca'; x.beginPath(); x.arc(AX - 62, AY - 40, 4, 0, 7); x.fill();
      // jewels
      for (const [jx, jy, jr] of [[AX, AY - 6, 7], [AX + 48, AY + 46, 5], [AX - 56, AY + 40, 4.5]]) {
        const g = x.createRadialGradient(jx - 1.5, jy - 1.5, 0, jx, jy, jr);
        g.addColorStop(0, '#ff8a9a'); g.addColorStop(0.5, '#c0162e'); g.addColorStop(1, '#5a0612');
        x.fillStyle = g; x.beginPath(); x.arc(jx, jy, jr, 0, 7); x.fill();
      }
    }, { clip: true });
    const apRing = L.shape(doc, { kind: 'ellipse', x: AX - AR - 4, y: AY - AR - 4, w: (AR + 4) * 2, h: (AR + 4) * 2, fill: { enabled: false, color: '#000' }, stroke: { enabled: true, color: '#d79a78', width: 8, align: 'center', dash: 'solid' } });
    apRing.name = 'Aperture ring'; apRing.effects = metal(120);

    // branding (fictional brand)
    const brand = text('Wordmark', 'KILN', CX, CY - 128, 54, { tracking: 380, color: '#f6d5b6' });
    const model = text('Model', 'EMBER', CX, CY - 94, 18, { tracking: 700, color: '#e3ab84', font: 'Segoe UI', weight: 600 });
    const spec = text('Calibre', 'AUTOMATIC  ·  72H', CX, CY + 100, 15, { tracking: 400, color: '#d79f78', font: 'Segoe UI', weight: 600 });
    brand.effects = fx({ dropShadow: { opacity: 60, size: 4, distance: 3 } });

    const dialGroup = group('Dial', [chapter, dial, sunburst, sheen, ticks, ticks5, indices, dateFrame, dateWin, dateTxt, aperture, movement, apRing, brand, model, spec]);

    // ---------- hands at 10:09:36 ----------
    const dauphine = (name, deg, len, w, tail, colA, colB) => {
      const full = rot([[0, -len], [w, -len * 0.18], [0, tail], [-w, -len * 0.18]], deg, CX, CY);
      const half = rot([[0, -len], [w, -len * 0.18], [0, tail]], deg, CX, CY);
      const a = shapePath(name, [poly(full)], colA, { effects: fx({ dropShadow: { opacity: 60, size: 12, distance: 14, angle: 110 } }) });
      const b = shapePath(name + ' — facet', [poly(half)], colB);
      return [a, b];
    };
    const [hrA, hrB] = dauphine('Hour hand', 304.5, 205, 15, 32, '#a8664a', '#ffd9bf');
    const [mnA, mnB] = dauphine('Minute hand', 57.6, 318, 12, 36, '#a8664a', '#ffd9bf');
    const secPts = rot([[-1.6, -330], [1.6, -330], [2.6, 70], [-2.6, 70]], 252, CX, CY);
    const sec = shapePath('Seconds hand', [poly(secPts)], '#f0913a', { effects: fx({ dropShadow: { opacity: 55, size: 8, distance: 16, angle: 110 } }) });
    const secTail = ellipse('Seconds counterweight', CX + Math.sin(rad(252)) * -58, CY + Math.cos(rad(252)) * 58, 9, '#f0913a');
    const cap = ellipse('Centre cap', CX, CY, 18, '#c4846a', { effects: metal(135) });
    const capDot = ellipse('Centre jewel', CX, CY, 6, '#3a1d12');
    const hands = group('Hands', [hrA, hrB, mnA, mnB, sec, secTail, cap, capDot]);

    // ---------- crystal glare ----------
    const glare = raster('Crystal reflection', (x) => {
      x.save(); x.beginPath(); x.arc(CX, CY, 385, 0, 7); x.clip();
      const g = x.createLinearGradient(CX - 300, CY - 340, CX + 60, CY + 40);
      g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.45, 'rgba(255,255,255,0.08)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.beginPath(); x.ellipse(CX - 90, CY - 120, 330, 230, rad(-35), 0, 7); x.fill();
      x.restore();
    }, { blend: 'screen', opacity: 0.35 });

    // ---------- presentation text ----------
    const lbl = (name, str, y, size, o) => text(name, str, 90, y, size, Object.assign({ align: 'left' }, o));
    const pres = group('Presentation', [
      lbl('Label — concept', 'CONCEPT 01', 120, 16, { font: 'Segoe UI', weight: 600, tracking: 500, color: '#f0913a' }),
      lbl('Label — title', 'Kiln Ember', 182, 54, { color: '#f2e8de' }),
      lbl('Label — subtitle', 'Automatic · Open Balance', 222, 22, { font: 'Segoe UI', color: '#a99a8c' }),
      lbl('Spec 1', '44 mm rose-gold case', 1700, 20, { font: 'Segoe UI', color: '#c8bdb1' }),
      lbl('Spec 2', 'Smoked amber sunburst dial', 1734, 20, { font: 'Segoe UI', color: '#c8bdb1' }),
      lbl('Spec 3', 'Visible balance wheel at six', 1768, 20, { font: 'Segoe UI', color: '#c8bdb1' }),
      lbl('Spec 4', 'Date at three · 72-hour reserve', 1802, 20, { font: 'Segoe UI', color: '#c8bdb1' }),
    ]);

    doc.layers = [bg, strap, caseGroup, dialGroup, hands, glare, pres];
    doc.activeId = hands.id; doc.selectedIds = new Set([hands.id]);
    S.App.addDoc(doc, 'Kiln Ember concept');
    await new Promise((r) => setTimeout(r, 600));
    const flat = S.Compositor.flatten(doc);
    const png = flat.toDataURL('image/png');
    const proj = JSON.stringify(await S.FileIO.serialize(doc));
    let count = 0; doc.walk(() => { count++; });
    return { png, proj, count };
  });

  fs.writeFileSync(OUT + '/Kiln Ember Concept.png', Buffer.from(result.png.split(',')[1], 'base64'));
  fs.writeFileSync(OUT + '/Kiln Ember Concept.kgesso', result.proj);
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + '/in-editor.png' });

  // round-trip check: reopen the saved project in a fresh page
  const p2 = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  p2.on('pageerror', (e) => errors.push('reload: ' + e.message));
  await p2.goto('file://' + ROOT + '/Gesso/index.html');
  await p2.waitForTimeout(600);
  const n = await p2.evaluate(async (txt) => { const d = await Gesso.FileIO.loadProject(JSON.parse(txt), 'x'); let c = 0; d.walk(() => { c++; }); return c; }, result.proj);
  console.log('layers built:', result.count, 'reloaded:', n);
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO ERRORS');
  await browser.close();
})();
