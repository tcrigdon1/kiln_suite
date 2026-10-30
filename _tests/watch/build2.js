// Concept 02 — "Kiln Lattice": an original open-worked (skeleton) hand-wound watch, built in Gesso.
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
    const S = window.Gesso, L = S.Layers, P = S.Paths, FX = S.Effects;
    const W = 2400, H = 1800, CX = 1200, CY = 900;
    const doc = new S.Document({ name: 'Kiln Lattice Concept', width: W, height: H });
    const rad = (d) => (d * Math.PI) / 180;
    const at = (dx, dy) => [CX + dx, CY + dy];

    // ---------- helpers ----------
    const fx = (items) => { const o = { enabled: true, items: {} }; for (const k in items) o.items[k] = Object.assign(FX.defaults(k), items[k]); return o; };
    const poly = (pts, closed = true) => ({ closed, nodes: pts.map(([x, y]) => P.node(x, y)) });
    const smooth = (pts, closed = false) => { // Catmull-Rom → bezier nodes
      const n = pts.length;
      return { closed, nodes: pts.map((p, i) => {
        const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
        if (!closed && (i === 0 || i === n - 1)) return P.node(p[0], p[1]);
        const tx = (b[0] - a[0]) / 6, ty = (b[1] - a[1]) / 6;
        return P.node(p[0], p[1], p[0] - tx, p[1] - ty, p[0] + tx, p[1] + ty);
      }) };
    };
    const rot = (pts, deg, cx, cy) => { const a = rad(deg), c = Math.cos(a), s = Math.sin(a); return pts.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]); };
    const radialBar = (deg, r1, r2, w) => poly(rot([[-w / 2, -r2], [w / 2, -r2], [w / 2, -r1], [-w / 2, -r1]], deg, CX, CY));
    const pathLayer = (name, subpaths, fill, extra) => { const l = L.shape(doc, { kind: 'path', path: { subpaths }, fill: { enabled: !!fill, color: fill || '#000' } }); l.name = name; return Object.assign(l, extra || {}); };
    const strokeLayer = (name, subpaths, color, width, extra) => {
      const l = L.shape(doc, { kind: 'path', path: { subpaths }, fill: { enabled: false, color: '#000' }, stroke: { enabled: true, color, width, align: 'center', dash: 'solid', cap: 'round', join: 'round' } });
      l.name = name; return Object.assign(l, extra || {});
    };
    const ellipse = (name, x, y, r, fill, extra) => { const l = L.shape(doc, { kind: 'ellipse', x: x - r, y: y - r, w: r * 2, h: r * 2, fill: { enabled: true, color: fill } }); l.name = name; return Object.assign(l, extra || {}); };
    const ring = (name, x, y, r, color, width, extra) => { const l = L.shape(doc, { kind: 'ellipse', x: x - r, y: y - r, w: r * 2, h: r * 2, fill: { enabled: false, color: '#000' }, stroke: { enabled: true, color, width, align: 'center', dash: 'solid' } }); l.name = name; return Object.assign(l, extra || {}); };
    const rrect = (name, x, y, w, h, r, fill, extra) => { const l = L.shape(doc, { kind: 'roundRect', x, y, w, h, radius: r, fill: { enabled: true, color: fill } }); l.name = name; return Object.assign(l, extra || {}); };
    const text = (name, str, x, baseline, size, o) => { const l = L.text(doc, Object.assign({ text: str, x, y: baseline - size * 0.92, size, font: 'Georgia', weight: 400, color: '#eef1f4', align: 'center' }, o || {})); l.name = name; return l; };
    const raster = (name, draw, extra) => { const l = L.raster(doc, name); draw(l.canvas.getContext('2d')); return Object.assign(l, extra || {}); };
    const group = (name, children) => { const g = L.group(doc, name); g.children = children; return g; };

    // gear outline (+ spoked cut-outs wound the opposite way so they punch through)
    const gear = (cx, cy, r, teeth, opt = {}) => {
      const depth = opt.depth || Math.max(3, r * 0.07), rr = r - depth, sp = [];
      const step = (Math.PI * 2) / teeth, pts = [];
      for (let i = 0; i < teeth; i++) {
        const a = i * step;
        if (opt.club) { // escape-wheel style hooked teeth
          pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
          pts.push([cx + Math.cos(a + step * 0.55) * r, cy + Math.sin(a + step * 0.55) * r]);
          pts.push([cx + Math.cos(a + step * 0.75) * (r - depth * 0.35), cy + Math.sin(a + step * 0.75) * (r - depth * 0.35)]);
          pts.push([cx + Math.cos(a + step * 0.8) * rr, cy + Math.sin(a + step * 0.8) * rr]);
        } else {
          for (const [f, R] of [[0, rr], [0.18, r], [0.5, r], [0.68, rr]]) pts.push([cx + Math.cos(a + step * f) * R, cy + Math.sin(a + step * f) * R]);
        }
      }
      sp.push(poly(pts));
      const spokes = opt.spokes || 0;
      if (spokes) {
        const rim = rr - Math.max(4, r * 0.1), hub = Math.max(5, r * (opt.hub || 0.2)), half = (opt.spokeW || Math.max(3, r * 0.07)) / r;
        for (let s = 0; s < spokes; s++) {
          const a1 = (s / spokes) * Math.PI * 2 + half + (opt.phase || 0), a2 = ((s + 1) / spokes) * Math.PI * 2 - half + (opt.phase || 0), win = [];
          const N = 18;
          for (let k = 0; k <= N; k++) { const a = a2 - ((a2 - a1) * k) / N; win.push([cx + Math.cos(a) * rim, cy + Math.sin(a) * rim]); }
          const hubHalf = (half * r) / hub;
          for (let k = 0; k <= N; k++) { const a = a1 + hubHalf + ((a2 - a1 - 2 * hubHalf) * k) / N; win.push([cx + Math.cos(a) * hub, cy + Math.sin(a) * hub]); }
          sp.push(poly(win));
        }
      }
      return sp;
    };

    const STEEL = [{ pos: 0, color: '#4f545b' }, { pos: 0.17, color: '#eef2f6' }, { pos: 0.36, color: '#7d848c' }, { pos: 0.55, color: '#fafcfd' }, { pos: 0.76, color: '#6a7078' }, { pos: 1, color: '#4f545b' }];
    const STEEL_LIN = [{ pos: 0, color: '#f4f7fa' }, { pos: 0.5, color: '#9aa1a9' }, { pos: 1, color: '#50565d' }];
    const GOLD = [{ pos: 0, color: '#fff1c4' }, { pos: 0.5, color: '#d2a253' }, { pos: 1, color: '#7f5a20' }];
    const RUTH = [{ pos: 0, color: '#26282c' }, { pos: 0.5, color: '#5b6067' }, { pos: 1, color: '#25272b' }];
    const metal = (stops, angle, more) => fx(Object.assign({ gradientOverlay: { gradient: stops, angle, style: 'linear' } }, more || {}));
    const goldWheel = () => metal(GOLD, 120, { dropShadow: { opacity: 65, size: 8, distance: 6, angle: 115 } });

    // ---------- backdrop + strap ----------
    const bg = L.fill(doc, { kind: 'gradient', gtype: 'radial', stops: [{ pos: 0, color: '#272a2e' }, { pos: 0.6, color: '#141518' }, { pos: 1, color: '#08090a' }], angle: 90, scale: 100 });
    bg.name = 'Backdrop';
    const strapFx = () => fx({ gradientOverlay: { gradient: [{ pos: 0, color: '#0d0e10' }, { pos: 0.5, color: '#2a2d32' }, { pos: 1, color: '#0d0e10' }], angle: 0, style: 'linear' }, innerShadow: { opacity: 55, size: 18, distance: 4 } });
    const stitch = (name, x, y, w, h) => { const l = L.shape(doc, { kind: 'roundRect', x, y, w, h, radius: 50, fill: { enabled: false, color: '#000' }, stroke: { enabled: true, color: '#3dbfae', width: 3, align: 'center', dash: 'dash', cap: 'butt' } }); l.name = name; l.opacity = 0.7; return l; };
    const strap = group('Strap', [
      rrect('Strap — top', CX - 215, -60, 430, 560, 64, '#1f2125', { effects: strapFx() }),
      rrect('Strap — bottom', CX - 215, 1300, 430, 560, 64, '#1f2125', { effects: strapFx() }),
      stitch('Stitching — top', CX - 190, -40, 380, 520), stitch('Stitching — bottom', CX - 190, 1340, 380, 520),
    ]);

    // ---------- case ----------
    const lugs = pathLayer('Lugs', [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => {
      const x = CX + sx * 195, y = CY + sy * 385;
      return poly([[x - 36, y - 70 * sy], [x + 36, y - 70 * sy], [x + 28, y + 85 * sy], [x - 28, y + 85 * sy]]);
    }), '#a9b0b8', { effects: metal(STEEL_LIN, 160, { innerShadow: { opacity: 40, size: 10, distance: 3 }, dropShadow: { opacity: 65, size: 18, distance: 10 } }) });
    const stem = rrect('Winding stem', CX + 300, CY - 7, 150, 14, 6, '#c9ced4', { effects: metal(STEEL_LIN, 90) });
    const crown = rrect('Crown', CX + 430, CY - 50, 74, 100, 16, '#a9b0b8', { effects: metal([{ pos: 0, color: '#4f545b' }, { pos: 0.35, color: '#f4f7fa' }, { pos: 0.6, color: '#8a9199' }, { pos: 1, color: '#3e4248' }], 90, { dropShadow: { opacity: 60, size: 10, distance: 6 } }) });
    const crownFlutes = raster('Crown fluting', (x) => { x.strokeStyle = 'rgba(30,32,36,0.55)'; x.lineWidth = 2; for (let i = 0; i < 9; i++) { const yy = CY - 40 + i * 10; x.beginPath(); x.moveTo(CX + 458, yy); x.lineTo(CX + 498, yy); x.stroke(); } });
    const caseBody = ellipse('Case', CX, CY, 440, '#a9b0b8', { effects: fx({ gradientOverlay: { gradient: STEEL, angle: 25, style: 'angle' }, dropShadow: { opacity: 80, size: 70, distance: 34, angle: 110 } }) });
    const bezel = ellipse('Bezel', CX, CY, 414, '#a9b0b8', { effects: metal(STEEL_LIN, 135) });
    const bezelStep = ellipse('Bezel step', CX, CY, 394, '#6a7078', { effects: metal([{ pos: 0, color: '#3b3f45' }, { pos: 0.5, color: '#9aa1a9' }, { pos: 1, color: '#f0f3f6' }], 135) });
    const caseGroup = group('Case', [lugs, stem, crown, crownFlutes, caseBody, bezel, bezelStep]);

    // ---------- movement ----------
    const cavity = ellipse('Movement cavity', CX, CY, 384, '#0b0b0c', { effects: fx({ innerShadow: { opacity: 95, size: 40, distance: 10 } }) });
    // wheel positions (relative to centre)
    const BAR = at(30, -170), CEN = at(0, 0), THI = at(-175, 55), FOU = at(-50, 210), ESC = at(85, 235), BAL = at(205, 140), CRW = at(175, -40);
    const mainspring = raster('Mainspring', (x) => {
      x.strokeStyle = '#3d6fd0'; x.lineWidth = 3.2; x.beginPath();
      for (let t = 0; t < 7 * Math.PI * 2; t += 0.04) { const r = 18 + t * 1.95; x.lineTo(BAR[0] + Math.cos(t) * r, BAR[1] + Math.sin(t) * r); }
      x.stroke();
      x.strokeStyle = 'rgba(170,200,255,0.35)'; x.lineWidth = 1; x.stroke();
    });
    const plateRing = ring('Main plate ring', CX, CY, 340, '#3c4046', 30, { effects: metal(RUTH, 120, { innerShadow: { opacity: 60, size: 8, distance: 3 } }) });
    const barrel = pathLayer('Mainspring barrel', gear(BAR[0], BAR[1], 112, 96, { spokes: 4, hub: 0.18, spokeW: 9, depth: 6, phase: 0.4 }), '#d2a253', { effects: goldWheel() });
    const center = pathLayer('Centre wheel', gear(CEN[0], CEN[1], 98, 80, { spokes: 5, hub: 0.16, spokeW: 7 }), '#d2a253', { effects: goldWheel() });
    const third = pathLayer('Third wheel', gear(THI[0], THI[1], 66, 60, { spokes: 4, hub: 0.2, spokeW: 6, phase: 0.3 }), '#d2a253', { effects: goldWheel() });
    const fourth = pathLayer('Fourth wheel', gear(FOU[0], FOU[1], 58, 56, { spokes: 4, hub: 0.2, spokeW: 5, phase: 0.6 }), '#d2a253', { effects: goldWheel() });
    const escape = pathLayer('Escape wheel', gear(ESC[0], ESC[1], 36, 15, { club: true, spokes: 3, hub: 0.28, spokeW: 4, depth: 9 }), '#c8ced6', { effects: metal(STEEL_LIN, 120, { dropShadow: { opacity: 65, size: 6, distance: 5 } }) });
    const pinions = group('Pinions', [[CEN, 14], [THI, 11], [FOU, 10], [ESC, 8]].map(([p, r], i) => pathLayer('Pinion ' + (i + 1), gear(p[0], p[1], r, 8, { depth: 4 }), '#dfe3e8', { effects: metal(STEEL_LIN, 120) })));
    // pallet fork
    const fork = strokeLayer('Pallet fork', [poly([at(80, 196), at(176, 160)], false), poly([at(56, 214), at(80, 196), at(100, 203)], false), poly([at(168, 152), at(178, 160), at(170, 170)], false)], '#cfd5dc', 9, { effects: metal(STEEL_LIN, 120, { dropShadow: { opacity: 60, size: 5, distance: 4 } }) });
    const stones = pathLayer('Pallet stones', [poly(rot([[-4, -8], [4, -8], [4, 8], [-4, 8]], 55, ...at(56, 214))), poly(rot([[-4, -8], [4, -8], [4, 8], [-4, 8]], -15, ...at(100, 203)))], '#c3102b', { effects: fx({ gradientOverlay: { gradient: [{ pos: 0, color: '#ff7b8c' }, { pos: 1, color: '#7a0616' }], angle: 120, style: 'linear' } }) });
    // balance
    const hairspring = raster('Hairspring', (x) => {
      x.strokeStyle = 'rgba(205,220,240,0.9)'; x.lineWidth = 1.3; x.beginPath();
      for (let t = 0; t < 9 * Math.PI * 2; t += 0.03) { const r = 9 + t * 0.92; x.lineTo(BAL[0] + Math.cos(t) * r, BAL[1] + Math.sin(t) * r); }
      x.stroke();
    });
    const balRim = ring('Balance wheel', BAL[0], BAL[1], 70, '#d2a253', 11, { effects: goldWheel() });
    const balArms = strokeLayer('Balance arms', [0, 1, 2].map((k) => { const a = rad(k * 120 + 20); return poly([BAL, [BAL[0] + Math.cos(a) * 66, BAL[1] + Math.sin(a) * 66]], false); }), '#d2a253', 6, { effects: metal(GOLD, 120) });
    const screwsArr = [];
    for (let k = 0; k < 12; k++) { const a = rad(k * 30 + 5); screwsArr.push(ellipse('Timing screw ' + (k + 1), BAL[0] + Math.cos(a) * 79, BAL[1] + Math.sin(a) * 79, 5, '#e9c77a', { effects: metal(GOLD, 120) })); }
    const balance = group('Balance', [hairspring, balRim, balArms, ...screwsArr]);
    // keyless works
    const crownWheel = pathLayer('Crown wheel', gear(CRW[0], CRW[1], 40, 30, { spokes: 3, hub: 0.3, spokeW: 5 }), '#c8ced6', { effects: metal(STEEL_LIN, 120, { dropShadow: { opacity: 60, size: 6, distance: 5 } }) });
    const ratchet = pathLayer('Ratchet wheel', gear(BAR[0], BAR[1], 74, 64, { spokes: 6, hub: 0.24, spokeW: 6, depth: 5 }), '#c8ced6', { effects: metal(STEEL_LIN, 135, { dropShadow: { opacity: 70, size: 8, distance: 6 } }) });
    const click = strokeLayer('Click spring', [smooth([at(-42, -222), at(-56, -188), at(-46, -150)])], '#9fb4d8', 4, { effects: metal([{ pos: 0, color: '#bcd0f5' }, { pos: 1, color: '#2d4f9a' }], 90) });

    // bridges — thick stroked paths in dark ruthenium with bright bevelled edges
    const bridgeFx = () => fx({ gradientOverlay: { gradient: RUTH, angle: 120, style: 'linear' }, innerGlow: { color: '#dfe5ec', opacity: 55, size: 4, blend: 'screen' }, dropShadow: { opacity: 75, size: 14, distance: 9, angle: 115 } });
    const bridges = group('Bridges', [
      strokeLayer('Barrel bridge', [smooth([at(-300, -150), at(-150, -215), BAR, at(150, -200), at(285, -175)])], '#3c4046', 30, { effects: bridgeFx() }),
      strokeLayer('Train bridge', [smooth([at(-318, 95), THI, at(-120, 150), FOU, at(30, 270), at(70, 318)])], '#3c4046', 26, { effects: bridgeFx() }),
      strokeLayer('Centre bridge', [smooth([at(-180, -60), at(-90, -30), CEN, at(90, -40), CRW, at(300, -95)])], '#3c4046', 24, { effects: bridgeFx() }),
      strokeLayer('Pallet bridge', [poly([at(10, 320), ESC, at(150, 176)], false)], '#3c4046', 16, { effects: bridgeFx() }),
      strokeLayer('Balance cock', [smooth([at(318, 40), at(270, 90), BAL])], '#3c4046', 26, { effects: bridgeFx() }),
      ellipse('Balance cock pad', BAL[0], BAL[1], 22, '#3c4046', { effects: bridgeFx() }),
    ]);
    // jewels in gold chatons
    const jewelPts = [BAR, CEN, THI, FOU, ESC, BAL, at(150, 176)];
    const chatons = jewelPts.map((p, i) => ellipse('Chaton ' + (i + 1), p[0], p[1], i === 0 ? 14 : 11, '#d9b066', { effects: metal(GOLD, 135) }));
    const jewels = jewelPts.map((p, i) => ellipse('Jewel ' + (i + 1), p[0], p[1], i === 0 ? 8 : 6, '#b3122a', { effects: fx({ gradientOverlay: { gradient: [{ pos: 0, color: '#ff96a6' }, { pos: 0.5, color: '#c4142f' }, { pos: 1, color: '#55040f' }], angle: 130, style: 'radial' } }) }));
    // blued screws
    const screwPts = [at(-300, -150), at(285, -175), at(-318, 95), at(70, 318), at(-180, -60), at(300, -95), at(10, 320), at(318, 40), at(-150, -215), at(-120, 150)];
    const screws = screwPts.map((p, i) => ellipse('Screw ' + (i + 1), p[0], p[1], 10, '#2f5fb8', { effects: fx({ gradientOverlay: { gradient: [{ pos: 0, color: '#9cc0ff' }, { pos: 0.5, color: '#2f5fb8' }, { pos: 1, color: '#10265a' }], angle: 130, style: 'radial' } }) }));
    const slots = pathLayer('Screw slots', screwPts.map((p, i) => poly(rot([[-8, -1.6], [8, -1.6], [8, 1.6], [-8, 1.6]], i * 37, p[0], p[1]))), '#0b1630');

    const innerStem = rrect('Winding stem (inner)', CX + 200, CY - 7, 160, 14, 6, '#c9ced4', { effects: metal(STEEL_LIN, 90, { dropShadow: { opacity: 60, size: 6, distance: 4 } }) });
    const movement = group('Movement', [cavity, mainspring, plateRing, innerStem, barrel, center, third, fourth, escape, pinions, fork, stones, balance, crownWheel, ratchet, click, bridges, group('Jewels', [...chatons, ...jewels]), group('Screws', [...screws, slots])]);

    // ---------- flange / chapter ring ----------
    const flange = ring('Flange', CX, CY, 372, '#1d1f23', 36, { effects: fx({ innerShadow: { opacity: 80, size: 12, distance: 5 } }) });
    const minute = []; for (let i = 0; i < 60; i++) if (i % 5) minute.push(radialBar(i * 6, 378, 388, 2.5));
    const minuteTrack = pathLayer('Minute track', minute, '#d9dee4', { opacity: 0.85 });
    const idx = []; for (let h = 0; h < 12; h++) { if (h === 6) continue; if (h === 0) { idx.push(radialBar(-2.6, 356, 388, 9)); idx.push(radialBar(2.6, 356, 388, 9)); } else idx.push(radialBar(h * 30, 356, 388, 11)); }
    const indices = pathLayer('Indices', idx, '#e4e8ec', { effects: metal(STEEL_LIN, 120, { dropShadow: { opacity: 70, size: 4, distance: 3 } }) });
    const brand = text('Wordmark', 'KILN', CX, CY + 375, 18, { font: 'Segoe UI', weight: 600, tracking: 600, color: '#e4e8ec' });
    const flangeGroup = group('Flange', [flange, minuteTrack, indices, brand]);

    // ---------- skeleton hands at 10:08:40 ----------
    const handShape = (deg, len, w, tail) => rot([[0, -len], [w, -len * 0.82], [w, tail * 0.2], [0, tail], [-w, tail * 0.2], [-w, -len * 0.82]], deg, CX, CY);
    const lume = (deg, len, w) => rot([[0, -len + 18], [w - 5, -len * 0.8], [w - 5, -len * 0.35], [-w + 5, -len * 0.35], [-w + 5, -len * 0.8]], deg, CX, CY);
    const handFx = () => fx({ gradientOverlay: { gradient: STEEL_LIN, angle: 135, style: 'linear' }, dropShadow: { opacity: 65, size: 12, distance: 16, angle: 110 } });
    const hourA = 10 * 30 + 8 * 0.5, minA = 8 * 6 + 40 * 0.1;
    const hands = group('Hands', [
      strokeLayer('Hour hand', [poly(handShape(hourA, 215, 13, 30))], '#e4e8ec', 4, { effects: handFx() }),
      pathLayer('Hour lume', [poly(lume(hourA, 215, 13))], '#bdf2e4', { effects: fx({ outerGlow: { color: '#3dbfae', opacity: 35, size: 10 } }) }),
      strokeLayer('Minute hand', [poly(handShape(minA, 330, 10, 36))], '#e4e8ec', 4, { effects: handFx() }),
      pathLayer('Minute lume', [poly(lume(minA, 330, 10))], '#bdf2e4', { effects: fx({ outerGlow: { color: '#3dbfae', opacity: 35, size: 10 } }) }),
      ellipse('Cannon', CX, CY, 16, '#dfe3e8', { effects: metal(STEEL_LIN, 135) }),
      ellipse('Cannon jewel', CX, CY, 5, '#1b1d21'),
    ]);

    // ---------- crystal ----------
    const glare = raster('Crystal reflection', (x) => {
      x.save(); x.beginPath(); x.arc(CX, CY, 392, 0, 7); x.clip();
      const g = x.createLinearGradient(CX - 300, CY - 340, CX + 60, CY + 40);
      g.addColorStop(0, 'rgba(255,255,255,0.5)'); g.addColorStop(0.45, 'rgba(255,255,255,0.06)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.beginPath(); x.ellipse(CX - 100, CY - 130, 330, 220, rad(-35), 0, 7); x.fill(); x.restore();
    }, { blend: 'screen', opacity: 0.3 });

    // ---------- callouts ----------
    const LEFT = [['Ratchet wheel', at(55, -230)], ['Mainspring barrel', at(-70, -140)], ['Centre wheel', at(-70, -45)], ['Third wheel', at(-205, 25)], ['Bridges', at(-280, 86)], ['Fourth wheel', at(-90, 235)]];
    const RIGHT = [['Crown wheel', at(205, -40)], ['Winding stem', at(300, 0)], ['Balance wheel', at(270, 115)], ['Hairspring', at(220, 160)], ['Pallet fork', at(130, 178)], ['Escape wheel', at(100, 262)]];
    const DESC = {
      'Ratchet wheel': 'Locks the wound mainspring', 'Mainspring barrel': 'Stores the energy', 'Centre wheel': 'Turns once an hour, drives the minutes',
      'Third wheel': 'Steps up the gear train', 'Bridges': 'Hold every wheel in place', 'Fourth wheel': 'Turns once a minute',
      'Crown wheel': 'Passes winding from the crown', 'Winding stem': 'Wind and set from the crown', 'Balance wheel': 'Swings back and forth to keep time',
      'Hairspring': 'Gives the balance its rhythm', 'Pallet fork': 'Locks and releases the escape wheel', 'Escape wheel': 'Lets energy out tooth by tooth',
    };
    const callouts = [];
    const mk = (list, side) => list.forEach(([name, pt], i) => {
      const ly = 470 + i * 160, elbowX = side < 0 ? 690 : 1710, labX = side < 0 ? 660 : 1740;
      callouts.push(strokeLayer('Leader — ' + name, [poly([pt, [elbowX, ly], [labX, ly]], false)], '#cfc6bb', 1.8, { opacity: 0.85, effects: fx({ dropShadow: { opacity: 80, size: 3, distance: 1 } }) }));
      callouts.push(ellipse('Dot — ' + name, pt[0], pt[1], 6, '#f0913a', { effects: fx({ stroke: { size: 2, color: '#1a120a', position: 'outside' } }) }));
      const align = side < 0 ? 'right' : 'left', tx = side < 0 ? labX - 14 : labX + 14;
      callouts.push(text('Label — ' + name, name, tx, ly + 7, 26, { align, font: 'Segoe UI', weight: 600, color: '#f2ebe3' }));
      callouts.push(text('Note — ' + name, DESC[name], tx, ly + 40, 18, { align, font: 'Segoe UI', color: '#9a9086' }));
    });
    mk(LEFT, -1); mk(RIGHT, 1);
    const calloutGroup = group('Callouts', callouts);

    const pres = group('Presentation', [
      text('Label — concept', 'CONCEPT 02', 90, 110, 18, { align: 'left', font: 'Segoe UI', weight: 600, tracking: 500, color: '#3dbfae' }),
      text('Label — title', 'Kiln Lattice', 90, 182, 60, { align: 'left', color: '#f2ebe3' }),
      text('Label — subtitle', 'Open-worked · Hand-wound', 90, 226, 24, { align: 'left', font: 'Segoe UI', color: '#a99a8c' }),
      text('Spec', '44 mm steel case  ·  21,600 vph  ·  7 jewels shown  ·  heat-blued screws', 90, 1720, 20, { align: 'left', font: 'Segoe UI', color: '#8d8277' }),
    ]);

    doc.layers = [bg, strap, caseGroup, movement, flangeGroup, hands, glare, calloutGroup, pres];
    doc.activeId = movement.id; doc.selectedIds = new Set([movement.id]);
    S.App.addDoc(doc, 'Kiln Lattice concept');
    await new Promise((r) => setTimeout(r, 800));
    const png = S.Compositor.flatten(doc).toDataURL('image/png');
    const proj = JSON.stringify(await S.FileIO.serialize(doc));
    let count = 0; doc.walk(() => { count++; });
    return { png, proj, count };
  });

  fs.writeFileSync(OUT + '/Kiln Lattice Concept.png', Buffer.from(result.png.split(',')[1], 'base64'));
  fs.writeFileSync(OUT + '/Kiln Lattice Concept.kgesso', result.proj);
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + '/in-editor-2.png' });
  const p2 = await browser.newPage();
  p2.on('pageerror', (e) => errors.push('reload: ' + e.message));
  await p2.goto('file://' + ROOT + '/Gesso/index.html');
  await p2.waitForTimeout(600);
  const n = await p2.evaluate(async (txt) => { const d = await Gesso.FileIO.loadProject(JSON.parse(txt), 'x'); let c = 0; d.walk(() => { c++; }); return c; }, result.proj);
  console.log('layers built:', result.count, 'reloaded:', n);
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO ERRORS');
  await browser.close();
})();
