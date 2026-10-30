// Concept 03 — "Kiln Aster": an original constellation watch with gem-set bezel, aventurine dial,
// moon phase at 12 and tourbillon at 6. Built with Gesso's layer engine.
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
    const W = 1800, H = 2200, CX = 900, CY = 1060;
    const doc = new S.Document({ name: 'Kiln Aster Concept', width: W, height: H });
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

    const WG = [{ pos: 0, color: '#5d6470' }, { pos: 0.16, color: '#f4f7fb' }, { pos: 0.34, color: '#8e96a3' }, { pos: 0.52, color: '#ffffff' }, { pos: 0.74, color: '#727a87' }, { pos: 1, color: '#5d6470' }];
    const WG_LIN = [{ pos: 0, color: '#ffffff' }, { pos: 0.5, color: '#aab2be' }, { pos: 1, color: '#5a616c' }];
    const GOLD = [{ pos: 0, color: '#fff4cf' }, { pos: 0.5, color: '#e0b25e' }, { pos: 1, color: '#8a6222' }];
    const metal = (stops, angle, more) => fx(Object.assign({ gradientOverlay: { gradient: stops, angle, style: 'linear' } }, more || {}));
    // seeded random so the design is reproducible
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

    // ---------- night backdrop ----------
    const bg = L.fill(doc, { kind: 'gradient', gtype: 'radial', stops: [{ pos: 0, color: '#1a2140' }, { pos: 0.55, color: '#0b0f22' }, { pos: 1, color: '#04050c' }], angle: 90, scale: 105, oy: -40 });
    bg.name = 'Night sky';
    const nebula = raster('Nebula glow', (x) => {
      for (const [nx, ny, r, c] of [[CX - 380, CY - 520, 520, 'rgba(120,70,200,0.35)'], [CX + 420, CY + 380, 560, 'rgba(40,160,190,0.28)'], [CX - 300, CY + 700, 420, 'rgba(200,90,160,0.18)']]) {
        const g = x.createRadialGradient(nx, ny, 0, nx, ny, r); g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g; x.fillRect(0, 0, W, H);
      }
    }, { blend: 'screen' });
    const starfield = raster('Starfield', (x) => {
      for (let i = 0; i < 900; i++) {
        const sx = rnd() * W, sy = rnd() * H, b = rnd(), r = b > 0.97 ? 1.8 : b > 0.85 ? 1.1 : 0.6;
        x.fillStyle = 'rgba(230,236,255,' + (0.25 + b * 0.6) + ')'; x.beginPath(); x.arc(sx, sy, r, 0, 7); x.fill();
      }
    });

    // ---------- strap (navy, textured) ----------
    const strapFx = () => fx({ gradientOverlay: { gradient: [{ pos: 0, color: '#050916' }, { pos: 0.5, color: '#1b2a52' }, { pos: 1, color: '#050916' }], angle: 0, style: 'linear' }, innerShadow: { opacity: 60, size: 20, distance: 4 } });
    const scales = (y0, y1) => raster('Strap texture', (x) => {
      x.strokeStyle = 'rgba(0,0,0,0.55)'; x.lineWidth = 2;
      for (let y = y0; y < y1; y += 34) for (let xx = CX - 230; xx < CX + 230; xx += 46) {
        const off = (Math.round((y - y0) / 34) % 2) * 23, w = 40 - Math.abs(xx + off - CX) / 12;
        x.beginPath(); x.roundRect(xx + off, y, w, 30, 9); x.stroke();
      }
    }, { clip: true, blend: 'multiply', opacity: 0.6 });
    const stitch = (name, x, y, w, h) => { const l = L.shape(doc, { kind: 'roundRect', x, y, w, h, radius: 50, fill: { enabled: false, color: '#000' }, stroke: { enabled: true, color: '#e0b25e', width: 3, align: 'center', dash: 'dash', cap: 'butt' } }); l.name = name; l.opacity = 0.8; return l; };
    const strap = group('Strap', [
      rrect('Strap — top', CX - 215, -60, 430, 700, 64, '#14203f', { effects: strapFx() }), scales(-60, 640),
      rrect('Strap — bottom', CX - 215, 1470, 430, 800, 64, '#14203f', { effects: strapFx() }), scales(1470, 2270),
      stitch('Stitching — top', CX - 190, -40, 380, 660), stitch('Stitching — bottom', CX - 190, 1510, 380, 760),
    ]);

    // ---------- case ----------
    const lugs = pathLayer('Lugs', [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => {
      const x = CX + sx * 198, y = CY + sy * 395;
      return poly([[x - 38, y - 72 * sy], [x + 38, y - 72 * sy], [x + 30, y + 88 * sy], [x - 30, y + 88 * sy]]);
    }), '#c9d0da', { effects: metal(WG_LIN, 160, { innerShadow: { opacity: 40, size: 10, distance: 3 }, dropShadow: { opacity: 70, size: 20, distance: 10 } }) });
    const crown = rrect('Crown', CX + 440, CY - 52, 76, 104, 16, '#c9d0da', { effects: metal([{ pos: 0, color: '#5a616c' }, { pos: 0.35, color: '#ffffff' }, { pos: 0.6, color: '#98a0ac' }, { pos: 1, color: '#454b55' }], 90, { dropShadow: { opacity: 60, size: 10, distance: 6 } }) });
    const cabochon = ellipse('Crown sapphire', CX + 516, CY, 24, '#1d4fd6', { effects: fx({ gradientOverlay: { gradient: [{ pos: 0, color: '#9fc4ff' }, { pos: 0.45, color: '#1d4fd6' }, { pos: 1, color: '#061a5c' }], style: 'radial', angle: 120 }, stroke: { size: 3, color: '#e9edf3', position: 'outside' } }) });
    const caseBody = ellipse('Case', CX, CY, 452, '#c9d0da', { effects: fx({ gradientOverlay: { gradient: WG, angle: 25, style: 'angle' }, dropShadow: { opacity: 85, size: 80, distance: 36, angle: 110 }, outerGlow: { color: '#6f8cff', opacity: 18, size: 60 } }) });
    const bezelBase = ellipse('Bezel', CX, CY, 446, '#d7dde6', { effects: metal(WG_LIN, 135) });
    const gemSeat = ring('Gem channel', CX, CY, 424, '#2a2f38', 36, { effects: fx({ innerShadow: { opacity: 80, size: 6, distance: 2 } }) });
    // brilliant-cut stones, drawn individually
    const gems = raster('Bezel stones', (x) => {
      const N = 72, R = 424, r = 13.2;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2, gx = CX + Math.cos(a) * R, gy = CY + Math.sin(a) * R;
        const g = x.createRadialGradient(gx - r * 0.3, gy - r * 0.3, 0, gx, gy, r);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, '#dfeaff'); g.addColorStop(0.8, '#8fa2bf'); g.addColorStop(1, '#3b4658');
        x.fillStyle = g; x.beginPath(); x.arc(gx, gy, r, 0, 7); x.fill();
        for (let f = 0; f < 8; f++) { // facets
          const a1 = (f / 8) * Math.PI * 2 + a, a2 = a1 + Math.PI / 8;
          x.fillStyle = f % 2 ? 'rgba(255,255,255,0.35)' : 'rgba(40,55,90,0.28)';
          x.beginPath(); x.moveTo(gx, gy); x.lineTo(gx + Math.cos(a1) * r, gy + Math.sin(a1) * r); x.lineTo(gx + Math.cos(a2) * r, gy + Math.sin(a2) * r); x.closePath(); x.fill();
        }
        x.fillStyle = 'rgba(255,255,255,0.75)'; x.beginPath();
        for (let k = 0; k < 8; k++) { const aa = (k / 8) * Math.PI * 2 + Math.PI / 8; x.lineTo(gx + Math.cos(aa) * r * 0.42, gy + Math.sin(aa) * r * 0.42); }
        x.closePath(); x.fill();
        // prongs
        const pa = a + Math.PI / N; x.fillStyle = '#eef2f7';
        for (const pr of [R - 14, R + 14]) { x.beginPath(); x.arc(CX + Math.cos(pa) * pr, CY + Math.sin(pa) * pr, 3, 0, 7); x.fill(); }
      }
    }, { effects: fx({ dropShadow: { opacity: 50, size: 3, distance: 2 } }) });
    const caseGroup = group('Case', [lugs, crown, cabochon, caseBody, bezelBase, gemSeat, gems]);

    // ---------- aventurine dial ----------
    const flange = ring('Flange', CX, CY, 390, '#0d1328', 32, { effects: fx({ innerShadow: { opacity: 85, size: 12, distance: 5 } }) });
    const dial = ellipse('Dial', CX, CY, 374, '#0f1838', { effects: fx({ gradientOverlay: { gradient: [{ pos: 0, color: '#203a86' }, { pos: 0.55, color: '#0e1a46' }, { pos: 1, color: '#04081c' }], style: 'radial', angle: 90, scale: 100 }, innerShadow: { opacity: 75, size: 34, distance: 8 } }) });
    const glitter = raster('Aventurine glitter', (x) => {
      for (let i = 0; i < 5000; i++) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 374, b = rnd();
        x.fillStyle = b > 0.985 ? 'rgba(255,255,255,0.95)' : 'rgba(200,215,255,' + (0.15 + b * 0.5) + ')';
        x.fillRect(CX + Math.cos(a) * r, CY + Math.sin(a) * r, b > 0.97 ? 2 : 1, b > 0.97 ? 2 : 1);
      }
    }, { clip: true });
    const dialNebula = raster('Dial nebula', (x) => {
      for (const [nx, ny, r, c] of [[CX - 120, CY - 80, 260, 'rgba(150,90,255,0.5)'], [CX + 160, CY + 120, 240, 'rgba(60,200,230,0.35)']]) {
        const g = x.createRadialGradient(nx, ny, 0, nx, ny, r); g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g; x.beginPath(); x.arc(CX, CY, 380, 0, 7); x.fill();
      }
    }, { clip: true, blend: 'screen', opacity: 0.75 });
    // degree scale on the flange
    const deg = []; for (let i = 0; i < 120; i++) deg.push(radialBar(i * 3, i % 10 === 0 ? 378 : 384, 400, i % 10 === 0 ? 2.4 : 1.4));
    const degScale = pathLayer('Degree scale', deg, '#e0b25e', { opacity: 0.85 });
    const ecliptic = strokeLayer('Ecliptic', [smooth(Array.from({ length: 48 }, (_, i) => { const t = (i / 48) * Math.PI * 2; return rot([[Math.cos(t) * 330, Math.sin(t) * 120]], -18, CX, CY)[0]; }), true)], '#e0b25e', 1.6, { opacity: 0.4 });
    ecliptic.shape.stroke.dash = 'dash';
    // star indices
    const idxStars = [];
    for (let h = 0; h < 12; h++) {
      const a = rad(h * 30), r = 338, s = h % 3 === 0 ? 34 : 24;
      const l = L.shape(doc, { kind: 'star', x: CX + Math.sin(a) * r - s / 2, y: CY - Math.cos(a) * r - s / 2, w: s, h: s, points: 4, inner: 0.32, fill: { enabled: true, color: '#e0b25e' } });
      l.name = 'Star index ' + (h || 12); l.effects = metal(GOLD, 135, { dropShadow: { opacity: 70, size: 4, distance: 3 } }); idxStars.push(l);
    }

    // ---------- constellations (real asterism shapes, stylised positions) ----------
    const CONST = [
      { name: 'ORION', label: [-205, 140], stars: [[-252, -62, 6], [-168, -72, 4.5], [-226, 8, 4], [-206, 14, 4], [-186, 20, 4], [-246, 92, 4], [-158, 86, 6]], lines: [[0, 1], [0, 2], [1, 4], [2, 3], [3, 4], [2, 5], [4, 6]] },
      { name: 'URSA MAJOR', label: [168, -148], stars: [[62, -108, 4], [108, -124, 4], [150, -116, 4.5], [190, -100, 4], [202, -55, 4], [256, -50, 4.5], [266, -96, 5]], lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]] },
      { name: 'CASSIOPEIA', label: [242, 118], stars: [[188, 38, 4.5], [214, 70, 4], [240, 48, 5], [266, 86, 4], [292, 60, 4.5]], lines: [[0, 1], [1, 2], [2, 3], [3, 4]] },
      { name: 'CYGNUS', label: [-240, 214], stars: [[-186, 186, 5.5], [-150, 222, 4], [-102, 266, 4.5], [-196, 248, 3.5], [-106, 198, 3.5]], lines: [[0, 1], [1, 2], [3, 1], [1, 4]] },
      { name: 'LYRA', label: [182, 262], stars: [[148, 168, 6], [174, 194, 3], [196, 190, 3], [190, 226, 3], [168, 230, 3]], lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 1]] },
    ];
    const constLayers = [];
    for (const c of CONST) {
      const pts = c.stars.map(([x, y]) => at(x, y));
      const lines = strokeLayer(c.name + ' — lines', c.lines.map(([a, b]) => poly([pts[a], pts[b]], false)), '#f1cf86', 1.6, { opacity: 0.75, effects: fx({ outerGlow: { color: '#f1cf86', opacity: 35, size: 6 } }) });
      const stars = pathLayer(c.name + ' — stars', c.stars.map(([x, y, r]) => P.ellipse(CX + x, CY + y, r, r).subpaths[0]), '#fbf6e9', { effects: fx({ outerGlow: { color: '#bcd2ff', opacity: 90, size: 14 } }) });
      const label = text(c.name + ' — name', c.name, CX + c.label[0], CY + c.label[1], 12, { font: 'Georgia', italic: true, tracking: 300, color: '#d9bd84' });
      label.opacity = 0.85;
      constLayers.push(group(c.name[0] + c.name.slice(1).toLowerCase(), [lines, stars, label]));
    }
    const flares = raster('Star flares', (x) => {
      const flare = (fx_, fy, len, alpha) => {
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const g = x.createLinearGradient(fx_ - dx * len, fy - dy * len, fx_ + dx * len, fy + dy * len);
          g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,' + alpha + ')'); g.addColorStop(1, 'rgba(255,255,255,0)');
          x.fillStyle = g; x.fillRect(fx_ - (dx ? len : 1), fy - (dy ? len : 1), dx ? len * 2 : 2, dy ? len * 2 : 2);
        }
      };
      for (const [sx, sy] of [[-252, -62], [-158, 86], [266, -96], [240, 48], [-186, 186], [148, 168]]) flare(CX + sx, CY + sy, 26, 0.9);
    }, { blend: 'screen' });

    // ---------- moon phase at 12 ----------
    const M = at(0, -192);
    const moonBase = ellipse('Moon window', M[0], M[1], 64, '#0a1336', { effects: fx({ gradientOverlay: { gradient: [{ pos: 0, color: '#1e3a8a' }, { pos: 1, color: '#050a24' }], style: 'radial', angle: 90 }, innerShadow: { opacity: 85, size: 14, distance: 4 } }) });
    const moonStars = raster('Moon-disc stars', (x) => { for (let i = 0; i < 40; i++) { const a = rnd() * 7, r = rnd() * 60; x.fillStyle = 'rgba(255,255,255,' + (0.4 + rnd() * 0.6) + ')'; x.beginPath(); x.arc(M[0] + Math.cos(a) * r, M[1] + Math.sin(a) * r, rnd() * 1.4 + 0.4, 0, 7); x.fill(); } }, { clip: true });
    const moon = ellipse('Moon', M[0] + 8, M[1] + 2, 40, '#e8c472', { clip: true, effects: fx({ gradientOverlay: { gradient: [{ pos: 0, color: '#fff2c8' }, { pos: 0.6, color: '#e0b25e' }, { pos: 1, color: '#9a6d26' }], style: 'radial', angle: 135 } }) });
    const craters = raster('Moon craters', (x) => { for (const [dx, dy, r] of [[14, -10, 7], [-2, 10, 5], [22, 14, 4], [4, -20, 3.5], [26, -2, 3]]) { x.fillStyle = 'rgba(140,95,30,0.35)'; x.beginPath(); x.arc(M[0] + 8 + dx, M[1] + 2 + dy, r, 0, 7); x.fill(); } }, { clip: true });
    const moonShadow = ellipse('Moon shadow', M[0] - 26, M[1] - 2, 42, '#0b1538', { clip: true, opacity: 0.94 });
    const moonRing = ring('Moon window ring', M[0], M[1], 66, '#e0b25e', 6, { effects: metal(GOLD, 120, { dropShadow: { opacity: 60, size: 5, distance: 3 } }) });
    const moonGroup = group('Moon phase', [moonBase, moonStars, moon, craters, moonShadow, moonRing]);

    // ---------- tourbillon at 6 ----------
    const T = at(0, 196), TR = 88;
    const tBase = ellipse('Tourbillon aperture', T[0], T[1], TR, '#05070e', { effects: fx({ innerShadow: { opacity: 95, size: 20, distance: 6 } }) });
    const fixedWheel = pathLayer('Fixed wheel', gear(T[0], T[1], 84, 90, { depth: 4 }), '#e0b25e', { clip: true, effects: metal(GOLD, 120) });
    const tCageRing = ring('Cage ring', T[0], T[1], 62, '#dfe4ea', 7, { effects: metal(WG_LIN, 120, { dropShadow: { opacity: 70, size: 6, distance: 4 } }) });
    const tArms = strokeLayer('Cage arms', [0, 1, 2].map((k) => { const a = rad(k * 120 - 90); return poly([T, [T[0] + Math.cos(a) * 62, T[1] + Math.sin(a) * 62]], false); }), '#dfe4ea', 6, { effects: metal(WG_LIN, 120) });
    const tEsc = pathLayer('Escape wheel', gear(T[0] + 34, T[1] + 30, 15, 15, { club: true, depth: 4 }), '#dfe4ea', { effects: metal(WG_LIN, 120) });
    const tHair = raster('Hairspring', (x) => { x.strokeStyle = 'rgba(210,225,245,0.9)'; x.lineWidth = 1.1; x.beginPath(); for (let t = 0; t < 7 * Math.PI * 2; t += 0.03) { const r = 6 + t * 0.7; x.lineTo(T[0] + Math.cos(t) * r, T[1] + Math.sin(t) * r); } x.stroke(); });
    const tBal = ring('Balance wheel', T[0], T[1], 42, '#e0b25e', 6, { effects: metal(GOLD, 120, { dropShadow: { opacity: 60, size: 4, distance: 3 } }) });
    const tBridge = strokeLayer('Tourbillon bridge', [smooth([at(-112, 238), at(-50, 214), T, at(50, 214), at(112, 238)])], '#e0b25e', 14, { effects: metal(GOLD, 120, { dropShadow: { opacity: 70, size: 8, distance: 5 } }) });
    const tJewel = ellipse('Tourbillon jewel', T[0], T[1], 8, '#c4142f', { effects: fx({ gradientOverlay: { gradient: [{ pos: 0, color: '#ff96a6' }, { pos: 1, color: '#55040f' }], style: 'radial', angle: 130 }, stroke: { size: 3, color: '#f3d58e', position: 'outside' } }) });
    const tRing = ring('Tourbillon ring', T[0], T[1], TR + 3, '#e0b25e', 7, { effects: metal(GOLD, 120) });
    const tGems = raster('Tourbillon stones', (x) => {
      const N = 30, R = TR + 16, r = 5.2;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2, gx = T[0] + Math.cos(a) * R, gy = T[1] + Math.sin(a) * R;
        const g = x.createRadialGradient(gx - 1.5, gy - 1.5, 0, gx, gy, r);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.6, '#cfdcf5'); g.addColorStop(1, '#4a5670');
        x.fillStyle = g; x.beginPath(); x.arc(gx, gy, r, 0, 7); x.fill();
      }
    }, { effects: fx({ dropShadow: { opacity: 60, size: 2, distance: 1 } }) });
    const tourbillon = group('Tourbillon', [tBase, fixedWheel, tCageRing, tArms, tEsc, tHair, tBal, tBridge, tJewel, tRing, tGems]);

    // ---------- branding ----------
    const brand = text('Wordmark', 'KILN', CX, CY - 92, 24, { tracking: 500, color: '#f1d79c' });
    const model = text('Model', 'ASTER  ·  TOURBILLON', CX, CY + 76, 10, { font: 'Segoe UI', weight: 600, tracking: 400, color: '#c9ad73' });

    // ---------- hands at 10:10:35 ----------
    const leaf = (deg, len, w) => [smooth(rot([[0, -len], [w * 0.7, -len * 0.6], [w, -len * 0.25], [w * 0.5, 0], [0, 26], [-w * 0.5, 0], [-w, -len * 0.25], [-w * 0.7, -len * 0.6]], deg, CX, CY), true)];
    const handFx = () => fx({ gradientOverlay: { gradient: GOLD, angle: 135, style: 'linear' }, dropShadow: { opacity: 70, size: 12, distance: 16, angle: 110 } });
    const hourA = 10 * 30 + 10 * 0.5, minA = 10 * 6 + 35 * 0.1, secA = 50 * 6;
    const secTip = rot([[0, -318]], secA, CX, CY)[0], secTail = rot([[0, 70]], secA, CX, CY)[0];
    const sStar = L.shape(doc, { kind: 'star', x: secTail[0] - 14, y: secTail[1] - 14, w: 28, h: 28, points: 4, inner: 0.3, fill: { enabled: true, color: '#e0b25e' } });
    sStar.name = 'Seconds star'; sStar.effects = metal(GOLD, 135, { outerGlow: { color: '#ffe3a0', opacity: 40, size: 10 } });
    const hands = group('Hands', [
      pathLayer('Hour hand', leaf(hourA, 205, 16), '#e0b25e', { effects: handFx() }),
      pathLayer('Minute hand', leaf(minA, 318, 12), '#e0b25e', { effects: handFx() }),
      strokeLayer('Seconds hand', [poly([secTail, secTip], false)], '#e0b25e', 2.5, { effects: fx({ dropShadow: { opacity: 60, size: 6, distance: 16, angle: 110 } }) }),
      sStar,
      ellipse('Centre cap', CX, CY, 15, '#e0b25e', { effects: metal(GOLD, 135) }),
      ellipse('Centre stone', CX, CY, 6, '#ffffff', { effects: fx({ outerGlow: { color: '#cfe0ff', opacity: 80, size: 6 } }) }),
    ]);

    // ---------- crystal + sparkle ----------
    const glare = raster('Crystal reflection', (x) => {
      x.save(); x.beginPath(); x.arc(CX, CY, 406, 0, 7); x.clip();
      const g = x.createLinearGradient(CX - 320, CY - 360, CX + 60, CY + 40);
      g.addColorStop(0, 'rgba(255,255,255,0.45)'); g.addColorStop(0.5, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.beginPath(); x.ellipse(CX - 110, CY - 140, 340, 220, rad(-35), 0, 7); x.fill(); x.restore();
    }, { blend: 'screen', opacity: 0.28 });
    const glints = raster('Gem glints', (x) => {
      const glint = (gx, gy, len, alpha) => {
        for (const ang of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
          const L2 = ang % (Math.PI / 2) ? len * 0.45 : len, dx = Math.cos(ang) * L2, dy = Math.sin(ang) * L2;
          const g = x.createLinearGradient(gx - dx, gy - dy, gx + dx, gy + dy);
          g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,' + alpha + ')'); g.addColorStop(1, 'rgba(255,255,255,0)');
          x.strokeStyle = g; x.lineWidth = 2; x.beginPath(); x.moveTo(gx - dx, gy - dy); x.lineTo(gx + dx, gy + dy); x.stroke();
        }
        const g2 = x.createRadialGradient(gx, gy, 0, gx, gy, len * 0.35); g2.addColorStop(0, 'rgba(255,255,255,' + alpha + ')'); g2.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g2; x.beginPath(); x.arc(gx, gy, len * 0.35, 0, 7); x.fill();
      };
      for (const [deg_, len] of [[-130, 70], [-115, 40], [-60, 34], [20, 46], [160, 38], [205, 56], [250, 30]]) { const a = rad(deg_); glint(CX + Math.cos(a) * 424, CY + Math.sin(a) * 424, len, 0.95); }
      glint(T[0] - 60, T[1] + 80, 26, 0.9);
    }, { blend: 'screen' });

    // ---------- presentation ----------
    const pres = group('Presentation', [
      text('Label — concept', 'CONCEPT 03', 90, 120, 18, { align: 'left', font: 'Segoe UI', weight: 600, tracking: 500, color: '#e0b25e' }),
      text('Label — title', 'Kiln Aster', 90, 196, 64, { align: 'left', color: '#f4efe6' }),
      text('Label — subtitle', 'Constellation Tourbillon · Moon Phase', 90, 242, 24, { align: 'left', font: 'Segoe UI', color: '#9fa8c9' }),
      text('Spec 1', '43 mm white-gold case', 90, 1900, 20, { align: 'left', font: 'Segoe UI', color: '#b9c0da' }),
      text('Spec 2', '72 brilliant-cut stones on the bezel, 30 around the tourbillon', 90, 1934, 20, { align: 'left', font: 'Segoe UI', color: '#b9c0da' }),
      text('Spec 3', 'Aventurine dial · Orion, Ursa Major, Cassiopeia, Cygnus, Lyra', 90, 1968, 20, { align: 'left', font: 'Segoe UI', color: '#b9c0da' }),
      text('Spec 4', 'Sapphire cabochon crown · navy textured strap', 90, 2002, 20, { align: 'left', font: 'Segoe UI', color: '#b9c0da' }),
    ]);

    const dialGroup = group('Dial', [flange, dial, glitter, dialNebula, degScale, ecliptic, ...idxStars, group('Constellations', [...constLayers, flares]), moonGroup, tourbillon, brand, model]);
    doc.layers = [bg, nebula, starfield, strap, caseGroup, dialGroup, hands, glare, glints, pres];
    doc.activeId = dialGroup.id; doc.selectedIds = new Set([dialGroup.id]);
    S.App.addDoc(doc, 'Kiln Aster concept');
    await new Promise((r) => setTimeout(r, 900));
    const png = S.Compositor.flatten(doc).toDataURL('image/png');
    const proj = JSON.stringify(await S.FileIO.serialize(doc));
    let count = 0; doc.walk(() => { count++; });
    return { png, proj, count };
  });

  fs.writeFileSync(OUT + '/Kiln Aster Concept.png', Buffer.from(result.png.split(',')[1], 'base64'));
  fs.writeFileSync(OUT + '/Kiln Aster Concept.kgesso', result.proj);
  const p2 = await browser.newPage();
  p2.on('pageerror', (e) => errors.push('reload: ' + e.message));
  await p2.goto('file://' + ROOT + '/Gesso/index.html');
  await p2.waitForTimeout(600);
  const n = await p2.evaluate(async (txt) => { const d = await Gesso.FileIO.loadProject(JSON.parse(txt), 'x'); let c = 0; d.walk(() => { c++; }); return c; }, result.proj);
  console.log('layers built:', result.count, 'reloaded:', n);
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO ERRORS');
  await browser.close();
})();
