/* =========================================================================
   Gesso — brush engine and painting tools.

   Two stroke strategies:
   • Buffer tools (Brush, Pencil, Eraser, Clone, Healing, Spot Healing):
     dabs accumulate into a stroke buffer canvas; each frame the dirty area of
     the target is rebuilt as  snapshot + buffer·opacity  (with blend mode /
     selection / transparency lock).  This gives correct "opacity caps per
     stroke" behaviour like pro editors.
   • Pixel tools (Smudge, Blur, Sharpen, Dodge, Burn, Sponge): operate on a
     CPU copy (ImageData) of the target, flushing dirty rects to the canvas.

   Targets: layer pixels, a layer mask (grayscale stored as alpha), or the
   Quick Mask.  All strokes are undoable as pixel patches.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso, U = S.util;

  /* ======================= Brush tips ======================= */
  const B = (S.Brush = {
    PRESETS: [
      { name: 'Soft Round', tip: 'round', hardness: 0, spacing: 10 },
      { name: 'Hard Round', tip: 'round', hardness: 1, spacing: 8 },
      { name: 'Medium Round', tip: 'round', hardness: 0.6, spacing: 10 },
      { name: 'Airbrush', tip: 'round', hardness: 0, spacing: 6, flow: 12 },
      { name: 'Square', tip: 'square', hardness: 1, spacing: 10 },
      { name: 'Chalk', tip: 'chalk', hardness: 1, spacing: 18, angleJitter: 180, sizeJitter: 10 },
      { name: 'Charcoal', tip: 'charcoal', hardness: 1, spacing: 12, angleJitter: 20 },
      { name: 'Spatter', tip: 'spatter', hardness: 1, spacing: 35, angleJitter: 360, sizeJitter: 30, scatter: 30 },
      { name: 'Dry Bristle', tip: 'bristle', hardness: 1, spacing: 6, followAngle: true },
      { name: 'Grass', tip: 'grass', hardness: 1, spacing: 30, sizeJitter: 50, angleJitter: 25, scatter: 60, count: 2 },
      { name: 'Leaves', tip: 'leaf', hardness: 1, spacing: 60, sizeJitter: 45, angleJitter: 360, scatter: 120, count: 2, opacityJitter: 30 },
      { name: 'Sparkle', tip: 'sparkle', hardness: 1, spacing: 90, sizeJitter: 70, angleJitter: 45, scatter: 150, opacityJitter: 50 },
      { name: 'Snow Dots', tip: 'round', hardness: 0.7, spacing: 70, sizeJitter: 80, scatter: 200, count: 3, opacityJitter: 40 },
    ],
    _cache: new Map(),
    _textures: {},
    /** seeded RNG for repeatable procedural textures */
    rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); },
    /** user-defined tips (Edit ▸ Define Brush) and patterns (Edit ▸ Define Pattern), persisted as data URLs */
    custom: { tips: {}, patterns: {} },
    loadCustom() {
      const st = S.store.get('brushCustom', { tips: {}, patterns: {} });
      for (const kind of ['tips', 'patterns']) for (const name in st[kind] || {}) { const img = new Image(); img.onload = () => { const c = U.createCanvas(img.width, img.height); c.getContext('2d').drawImage(img, 0, 0); B.custom[kind][name] = c; if (kind === 'tips') { B._textures['custom:' + name] = c; if (!B.PRESETS.some((p) => p.tip === 'custom:' + name)) B.PRESETS.push({ name, tip: 'custom:' + name, hardness: 1, spacing: 25, custom: true }); B._cache.clear(); } S.bus.emit('brushes:changed'); }; img.src = st[kind][name]; }
    },
    saveCustom() {
      const st = { tips: {}, patterns: {} };
      for (const kind of ['tips', 'patterns']) for (const name in B.custom[kind]) st[kind][name] = B.custom[kind][name].toDataURL('image/png');
      S.store.set('brushCustom', st);
    },
    /** Define a brush tip from a canvas (luminance → alpha; transparent stays transparent) */
    defineTip(name, src) {
      const n = Math.min(512, Math.max(src.width, src.height)), k = n / Math.max(src.width, src.height);
      const c = U.createCanvas(Math.max(1, Math.round(src.width * k)), Math.max(1, Math.round(src.height * k))), x = c.getContext('2d');
      x.drawImage(src, 0, 0, c.width, c.height);
      const img = x.getImageData(0, 0, c.width, c.height), d = img.data;
      for (let i = 0; i < d.length; i += 4) { const a = (1 - U.luma(d[i], d[i + 1], d[i + 2]) / 255) * (d[i + 3] / 255); d[i] = d[i + 1] = d[i + 2] = 0; d[i + 3] = a * 255; }
      x.putImageData(img, 0, 0);
      // centre in a square
      const sq = U.createCanvas(n, n); sq.getContext('2d').drawImage(c, (n - c.width) / 2, (n - c.height) / 2);
      B.custom.tips[name] = sq; B._textures['custom:' + name] = sq;
      B.PRESETS.push({ name, tip: 'custom:' + name, hardness: 1, spacing: 25, custom: true });
      B.saveCustom(); S.bus.emit('brushes:changed');
      B._cache.clear();
    },
    definePattern(name, src) { const c = U.cloneCanvas(src); c.ox = 0; c.oy = 0; B.custom.patterns[name] = c; B.saveCustom(); S.bus.emit('brushes:changed'); },
    /** procedural paper / canvas textures used by the "Texture" brush option (tileable, 256 px) */
    paper(kind) {
      const key = 'paper:' + kind;
      if (B._textures[key]) return B._textures[key];
      const N = 256, c = U.createCanvas(N, N), x = c.getContext('2d'), img = x.createImageData(N, N), d = img.data, r = B.rng(kind.length * 311 + 5);
      const noise = new Float32Array(N * N); for (let i = 0; i < noise.length; i++) noise[i] = r();
      // tileable smoothing (wrap-around box blur)
      const sm = (src, rad) => { const o = new Float32Array(N * N); for (let y = 0; y < N; y++) for (let xx = 0; xx < N; xx++) { let s = 0, n = 0; for (let j = -rad; j <= rad; j++) for (let i = -rad; i <= rad; i++) { s += src[((y + j + N) % N) * N + ((xx + i + N) % N)]; n++; } o[y * N + xx] = s / n; } return o; };
      let v;
      if (kind === 'canvas') { v = new Float32Array(N * N); for (let y = 0; y < N; y++) for (let xx = 0; xx < N; xx++) v[y * N + xx] = 0.55 + 0.25 * Math.sin(xx * Math.PI / 2) * Math.sin(y * Math.PI / 2) + 0.2 * noise[y * N + xx]; }
      else if (kind === 'rough') { const a = sm(noise, 1), b = sm(noise, 4); v = new Float32Array(N * N); for (let i = 0; i < v.length; i++) v[i] = 0.35 + 0.5 * a[i] + 0.3 * (b[i] - 0.5); }
      else { const b = sm(noise, 2); v = new Float32Array(N * N); for (let i = 0; i < v.length; i++) v[i] = 0.6 + 0.6 * (b[i] - 0.5) + 0.15 * (noise[i] - 0.5); }
      for (let i = 0; i < v.length; i++) { d[i * 4 + 3] = U.clamp(v[i], 0, 1) * 255; }
      x.putImageData(img, 0, 0);
      B._textures[key] = c;
      return c;
    },
    /** 128px grayscale (alpha) texture for non-round tips */
    texture(tip) {
      if (B._textures[tip]) return B._textures[tip];
      if (tip.startsWith('custom:')) return B.tipMask('round', 32, 1); // not loaded (yet): fall back
      const N = 128, c = U.createCanvas(N, N), x = c.getContext('2d'), r = B.rng(tip.length * 977 + 13);
      x.fillStyle = '#000'; x.strokeStyle = '#000';
      if (tip === 'chalk') {
        const img = x.createImageData(N, N);
        for (let y = 0; y < N; y++) for (let xx = 0; xx < N; xx++) {
          const d = Math.hypot(xx - N / 2, y - N / 2) / (N / 2);
          const n = r();
          img.data[(y * N + xx) * 4 + 3] = d < 1 && n > 0.25 + d * 0.55 ? 255 * (0.6 + n * 0.4) : 0;
        }
        x.putImageData(img, 0, 0);
      } else if (tip === 'spatter') {
        for (let i = 0; i < 26; i++) { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 52; x.globalAlpha = 0.6 + r() * 0.4; x.beginPath(); x.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 2 + r() * 9, 0, Math.PI * 2); x.fill(); }
      } else if (tip === 'charcoal') {
        for (let i = 0; i < 40; i++) { const y = 20 + r() * 88; x.globalAlpha = 0.25 + r() * 0.6; x.lineWidth = 1 + r() * 4; x.beginPath(); x.moveTo(10 + r() * 20, y); x.lineTo(98 + r() * 20, y + (r() - 0.5) * 10); x.stroke(); }
      } else if (tip === 'bristle') {
        for (let i = 0; i < 34; i++) { const yy = 64 + (r() - 0.5) * 100; x.globalAlpha = 0.4 + r() * 0.6; x.beginPath(); x.arc(64 + (r() - 0.5) * 10, yy, 1.5 + r() * 3.5, 0, Math.PI * 2); x.fill(); }
      } else if (tip === 'grass') {
        for (let i = 0; i < 3; i++) { const bx = 54 + i * 10 + (r() - 0.5) * 6; x.beginPath(); x.moveTo(bx - 4, 126); x.quadraticCurveTo(bx + (r() - 0.5) * 30, 60, bx + (r() - 0.5) * 40, 4 + r() * 20); x.quadraticCurveTo(bx + 2, 70, bx + 4, 126); x.fill(); }
      } else if (tip === 'leaf') {
        x.beginPath(); x.moveTo(64, 6); x.bezierCurveTo(112, 40, 104, 96, 64, 122); x.bezierCurveTo(24, 96, 16, 40, 64, 6); x.fill();
        x.globalCompositeOperation = 'destination-out'; x.lineWidth = 3; x.beginPath(); x.moveTo(64, 14); x.lineTo(64, 116); x.stroke();
      } else if (tip === 'sparkle') {
        x.beginPath();
        for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2, rr = i % 2 ? 12 : 62; x.lineTo(64 + Math.cos(a) * rr, 64 + Math.sin(a) * rr); }
        x.closePath(); x.fill();
      }
      B._textures[tip] = c;
      return c;
    },
    /** Alpha-only tip canvas of diameter d (black with alpha), centred in a canvas of size ceil(d)+2 */
    tipMask(tip, d, hardness, aliased, wet) {
      const q = d < 6 ? Math.round(d * 4) / 4 : Math.round(d);
      const key = tip + '|' + q + '|' + (tip === 'round' || tip === 'square' ? hardness.toFixed(2) : '') + '|' + (aliased ? 1 : 0) + (wet ? '|wet' : '');
      let c = B._cache.get(key);
      if (c) return c;
      if (wet) { // wet edges: thin centre, full rim
        const base = B.tipMask(tip, d, hardness, aliased, false);
        c = U.createCanvas(base.width, base.height); const x = c.getContext('2d'); x.drawImage(base, 0, 0);
        const cx = base.width / 2, g = x.createRadialGradient(cx, cx, 0, cx, cx, q / 2);
        g.addColorStop(0, 'rgba(0,0,0,.35)'); g.addColorStop(0.7, 'rgba(0,0,0,.45)'); g.addColorStop(1, 'rgba(0,0,0,1)');
        x.globalCompositeOperation = 'destination-in'; x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
        B._cache.set(key, c); return c;
      }
      const s = Math.max(1, Math.ceil(q) + 2), r = q / 2, cx = s / 2;
      c = U.createCanvas(s, s);
      const x = c.getContext('2d');
      if (aliased) {
        const img = x.createImageData(s, s);
        const rr = Math.max(0.5, r);
        for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) {
          const inside = tip === 'square' ? Math.abs(xx + 0.5 - cx) <= rr && Math.abs(yy + 0.5 - cx) <= rr : Math.hypot(xx + 0.5 - cx, yy + 0.5 - cx) <= rr;
          if (inside) img.data[(yy * s + xx) * 4 + 3] = 255;
        }
        x.putImageData(img, 0, 0);
      } else if (tip === 'round') {
        if (q <= 1.5) { x.fillStyle = 'rgba(0,0,0,' + Math.min(1, q * q * 0.6) + ')'; x.beginPath(); x.arc(cx, cx, Math.max(0.5, r), 0, Math.PI * 2); x.fill(); }
        else {
          const g = x.createRadialGradient(cx, cx, 0, cx, cx, r);
          const h = U.clamp(hardness, 0, 1) * 0.98;
          g.addColorStop(0, 'rgba(0,0,0,1)');
          if (h > 0) g.addColorStop(h, 'rgba(0,0,0,1)');
          for (let i = 1; i <= 6; i++) {
            const t = i / 6, pos = h + (1 - h) * t;
            const a = 1 - (3 * t * t - 2 * t * t * t); // smoothstep falloff
            g.addColorStop(Math.min(1, pos), 'rgba(0,0,0,' + a.toFixed(3) + ')');
          }
          x.fillStyle = g; x.beginPath(); x.arc(cx, cx, r, 0, Math.PI * 2); x.fill();
        }
      } else if (tip === 'square') {
        const soft = (1 - hardness) * r;
        if (soft > 0.5) x.filter = 'blur(' + soft / 2 + 'px)';
        x.fillStyle = '#000'; x.fillRect(cx - r + soft / 2, cx - r + soft / 2, q - soft, q - soft);
      } else {
        x.imageSmoothingQuality = 'high';
        x.drawImage(B.texture(tip), cx - r, cx - r, q, q);
      }
      B._cache.set(key, c);
      if (B._cache.size > 160) B._cache.delete(B._cache.keys().next().value);
      return c;
    },
    /** colored tip */
    tip(tip, d, hardness, color, aliased, wet) {
      const key = 'c|' + color + '|' + tip + '|' + (d < 6 ? Math.round(d * 4) / 4 : Math.round(d)) + '|' + hardness.toFixed(2) + '|' + (aliased ? 1 : 0) + (wet ? '|wet' : '');
      let c = B._cache.get(key);
      if (c) return c;
      const m = B.tipMask(tip, d, hardness, aliased, wet);
      c = U.createCanvas(m.width, m.height);
      const x = c.getContext('2d');
      x.drawImage(m, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
      B._cache.set(key, c);
      if (B._cache.size > 160) B._cache.delete(B._cache.keys().next().value);
      return c;
    },
    /** analytic falloff for pixel tools: weight at normalized distance t (0 centre, 1 edge) */
    falloff(t, hardness) {
      if (t >= 1) return 0;
      const h = hardness * 0.98;
      if (t <= h) return 1;
      const u = (t - h) / (1 - h);
      return 1 - (3 * u * u - 2 * u * u * u);
    },
    applyPreset(opts, p) {
      opts.tip = p.tip; opts.hardness = p.hardness ?? opts.hardness; opts.spacing = p.spacing ?? 10;
      opts.scatter = p.scatter || 0; opts.sizeJitter = p.sizeJitter || 0; opts.angleJitter = p.angleJitter || 0;
      opts.opacityJitter = p.opacityJitter || 0; opts.count = p.count || 1; opts.followAngle = !!p.followAngle;
      if (p.flow) opts.flow = p.flow;
      opts.preset = p.name;
    },
    /** mirrored copies of a dab position for the symmetry option: [[x, y, flipX, flipY, rot], ...] */
    symmetry(o, x, y, W, H) {
      const mode = o.symmetry || 'none';
      if (mode === 'none') return [[x, y, 1, 1, 0]];
      const cx = o.symX != null ? o.symX : W / 2, cy = o.symY != null ? o.symY : H / 2;
      if (mode === 'v') return [[x, y, 1, 1, 0], [2 * cx - x, y, -1, 1, 0]];
      if (mode === 'h') return [[x, y, 1, 1, 0], [x, 2 * cy - y, 1, -1, 0]];
      if (mode === 'both') return [[x, y, 1, 1, 0], [2 * cx - x, y, -1, 1, 0], [x, 2 * cy - y, 1, -1, 0], [2 * cx - x, 2 * cy - y, -1, -1, 0]];
      const n = Math.max(2, Math.min(32, o.symN || 6)), out = [], dx = x - cx, dy = y - cy;
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, c = Math.cos(a), s2 = Math.sin(a); out.push([cx + dx * c - dy * s2, cy + dx * s2 + dy * c, 1, 1, a]); if (o.symMirror) out.push([cx + dx * c + dy * s2, cy + dx * s2 - dy * c, 1, -1, a]); }
      return out;
    },
    /** colour dynamics: jittered variant of a hex colour (quantised so tips stay cacheable) */
    dynamicColor(o, hex) {
      if (!(o.hueJitter || o.satJitter || o.briJitter)) return hex;
      const c = U.hexToRgb(hex), hsv = U.rgbToHsv(c.r, c.g, c.b);
      const q = (v, steps) => Math.round(v * steps) / steps;
      let h = hsv.h + (Math.random() - 0.5) * 2 * (o.hueJitter || 0) * 1.8, sv = hsv.s * (1 + (Math.random() - 0.5) * 2 * (o.satJitter || 0) / 100), v = hsv.v * (1 + (Math.random() - 0.5) * 2 * (o.briJitter || 0) / 100);
      h = ((h % 360) + 360) % 360;
      const r = U.hsvToRgb(q(h, 1 / 6) , U.clamp(q(sv, 20), 0, 1), U.clamp(q(v, 20), 0, 1));
      return U.rgbToHex(r);
    },
  });
  B.loadCustom();

  const lum255 = (hex) => { const c = U.hexToRgb(hex); return U.luma(c.r, c.g, c.b); };

  /* ======================= Shared stroke machinery ======================= */
  async function ensurePaintable(doc, tool) {
    const t = doc.paintTarget();
    if (!t) { S.toast('No layer to paint on'); return null; }
    const l = t.layer;
    if (l && (l.locks.all || (l.locks.pixels && t.kind === 'pixels'))) { S.toast('Layer “' + l.name + '” is locked'); return null; }
    if (t.kind === 'invalid') {
      if (l.type === 'group') { S.toast('Select a layer (not a group) to paint'); return null; }
      if (l.type === 'adjustment') { S.toast('Adjustment layers can only be painted on their mask'); return null; }
      const ok = await S.Dialog.confirm('“' + l.name + '” is ' + (S.Embed.is(l) ? 'an embedded object' : 'a ' + l.type + ' layer') + '. Rasterize it so it can be painted on?', 'Rasterize');
      if (ok) S.Cmd.run('layer.rasterize');
      return null;
    }
    if (!l && !doc.quickMask) return null;
    if (l && !l.visible && t.kind === 'pixels') S.toast('Note: painting on a hidden layer');
    void tool;
    return t;
  }

  /** Mixin providing pointer → dab interpolation; tool must implement dab(st, x, y, pressure, dirAngle) */
  const StrokeMixin = {
    brushCursor() { return this.opts.size; },
    brushCursorHard() { return this.opts.tip === 'round' ? this.opts.hardness : 1; },
    async onDown(info, doc) {
      if (info.alt && this.onAltClick) { this.onAltClick(info, doc); return; }
      if (this._starting) return;
      this._starting = true;
      const target = await ensurePaintable(doc, this);
      this._starting = false;
      if (!target) return;
      if (this.canStart && !this.canStart(info, doc, target)) return;
      const st = (this.st = { doc, target, edit: doc.beginPixelEdit(target), last: null, acc: 0, total: null, frame: null, sm: null, n: 0 });
      // strokes work in document space and are clipped to the document; the layer canvas grows as needed
      st.W = doc.width; st.H = doc.height;
      st.sel = doc.selection;
      this.beginStroke(st, info);
      if (info.shift && this.lastEnd && this.lastEnd.doc === doc) {
        st.last = { x: this.lastEnd.x, y: this.lastEnd.y, pr: info.pressure };
        st.sm = { ...st.last };
        this.addPoint(info, true);
      } else this.addPoint(info);
      this.flush();
    },
    onMove(info) { if (this.st) { this.addPoint(info); this.scheduleFlush(); this.airbrush(info); } },
    /** airbrush build-up: while the pointer rests, keep stamping (paint accumulates like a real spray can) */
    airbrush(info) {
      const st = this.st; if (!st || !this.opts.airbrush) return;
      clearTimeout(st.airT);
      st.airT = setTimeout(() => { if (this.st !== st) return; const p = st.pointer || info; this.dabAt(p.x, p.y, p.pr ?? p.pressure ?? 1, 0); this.scheduleFlush(); this.airbrush(info); }, 40);
    },
    onUp(info, doc) {
      const st = this.st;
      if (!st) return;
      clearTimeout(st.airT);
      // stabiliser: finish the stroke at the pointer so short strokes are not cut off
      if (this.opts.stabilize > 0 && st.pointer && st.last && !this.noCatchUp) { const o = this.opts.stabilize; this.opts.stabilize = 0; this.addPoint(st.pointer); this.opts.stabilize = o; }
      this.flush();
      if (this.endStroke) this.endStroke(st);
      this.flush(true);
      st.edit.end(this.name, st.total);
      this.lastEnd = { x: st.last ? st.last.x : info.x, y: st.last ? st.last.y : info.y, doc };
      this.st = null;
      if (st.buf) U.release(st.buf);
      S.bus.emit('layers:changed', doc);
    },
    /** the tool is switched (keyboard) in the middle of a stroke: finish the stroke so it is recorded in history */
    deactivate() { const st = this.st; if (st) this.onUp({ x: st.last ? st.last.x : 0, y: st.last ? st.last.y : 0 }, st.doc); },
    sizeAt(pr) { const o = this.opts; return Math.max(0.5, o.size * (o.pressureSize ? 0.15 + 0.85 * pr : 1)); },
    addPoint(info, noSmooth) {
      const st = this.st, o = this.opts;
      const raw = { x: info.x, y: info.y, pr: info.pressure ?? 1 };
      let p = raw;
      if (o.stabilize > 0 && st.sm && !noSmooth) {
        // string-pull stabiliser: the brush is dragged behind the pointer on a string of length R and only
        // moves when the string is taut, which straightens shaky lines without lag at the end of the stroke
        const R = o.stabilize * (o.size ? Math.max(0.5, Math.min(4, o.size / 20)) : 1) * 0.6, dx = raw.x - st.sm.x, dy = raw.y - st.sm.y, dist = Math.hypot(dx, dy);
        if (dist <= R) { st.pointer = raw; return; }
        const k = (dist - R) / dist;
        p = { x: st.sm.x + dx * k, y: st.sm.y + dy * k, pr: raw.pr };
      } else if (o.smoothing > 0 && st.sm && !noSmooth) {
        const k = 1 - Math.min(0.92, o.smoothing / 100);
        p = { x: st.sm.x + (raw.x - st.sm.x) * k, y: st.sm.y + (raw.y - st.sm.y) * k, pr: raw.pr };
      }
      st.pointer = raw;
      st.sm = p;
      if (!st.last) { this.dabAt(p.x, p.y, p.pr, 0); st.last = p; return; }
      const dx = p.x - st.last.x, dy = p.y - st.last.y, dist = Math.hypot(dx, dy);
      if (dist < 1e-3) return;
      const ang = Math.atan2(dy, dx);
      let t = 0;
      for (;;) {
        const pr = st.last.pr + (p.pr - st.last.pr) * (t / dist);
        const spacing = Math.max(0.5, (this.sizeAt(pr) * (o.spacing ?? 10)) / 100);
        const need = spacing - st.acc;
        if (t + need > dist) { st.acc += dist - t; break; }
        t += need; st.acc = 0;
        this.dabAt(st.last.x + (dx * t) / dist, st.last.y + (dy * t) / dist, pr, ang);
      }
      st.last = p;
    },
    dabAt(x, y, pr, ang) {
      const o = this.opts, st = this.st;
      const count = o.count || 1;
      for (let i = 0; i < count; i++) {
        let size = this.sizeAt(pr);
        if (o.sizeJitter) size *= 1 - (Math.random() * o.sizeJitter) / 100;
        let dx = 0, dy = 0;
        if (o.scatter) { const a = Math.random() * Math.PI * 2, d = ((Math.random() * o.scatter) / 100) * size; dx = Math.cos(a) * d; dy = Math.sin(a) * d; }
        let angle = o.followAngle ? ang : 0;
        if (o.angleJitter) angle += ((Math.random() - 0.5) * 2 * o.angleJitter * Math.PI) / 180;
        let alpha = (o.flow ?? 100) / 100;
        if (o.pressureOpacity) alpha *= pr;
        if (o.opacityJitter) alpha *= 1 - (Math.random() * o.opacityJitter) / 100;
        if (st.color && st.baseColor && (o.hueJitter || o.satJitter || o.briJitter)) st.color = B.dynamicColor(o, st.baseColor);
        for (const [sx, sy, fx, fy, rot] of B.symmetry(o, x + dx, y + dy, st.W, st.H)) {
          const r = this.dab(st, sx, sy, size, alpha, (fx * fy < 0 ? -angle : angle) + rot);
          const rect = r || { x: sx - size / 2 - 2, y: sy - size / 2 - 2, w: size + 4, h: size + 4 };
          st.frame = U.rectUnion(st.frame, rect);
          st.total = U.rectUnion(st.total, rect);
        }
        st.n++;
      }
    },
    drawOverlay(ctx, doc) {
      const o = this.opts, mode = o.symmetry || 'none'; if (mode === 'none') return;
      const cx = o.symX != null ? o.symX : doc.width / 2, cy = o.symY != null ? o.symY : doc.height / 2;
      const [sx, sy] = S.View.toScreen(cx, cy, doc);
      ctx.save(); ctx.strokeStyle = 'rgba(61,191,174,.7)'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1; ctx.beginPath();
      if (mode === 'v' || mode === 'both') { ctx.moveTo(sx, 0); ctx.lineTo(sx, S.View.h); }
      if (mode === 'h' || mode === 'both') { ctx.moveTo(0, sy); ctx.lineTo(S.View.w, sy); }
      if (mode === 'radial') { const n = Math.max(2, Math.min(32, o.symN || 6)), L = Math.max(S.View.w, S.View.h); for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 - Math.PI / 2; ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(a) * L, sy + Math.sin(a) * L); } }
      ctx.stroke(); ctx.restore();
    },
    scheduleFlush() {
      if (this._flushQueued) return;
      this._flushQueued = true;
      requestAnimationFrame(() => { this._flushQueued = false; this.flush(); S.View.redraw(); });
    },
    flush(final) {
      const st = this.st;
      if (!st || !st.frame) return;
      const R = U.rectInt(st.frame, st.W, st.H);
      st.frame = null;
      if (!R) return;
      this.composite(st, R, final);
      if (st.target.kind === 'quickmask') { st.doc.quickMask.version = (st.doc.quickMask.version || 0) + 1; }
      else if (st.target.layer) { if (st.target.kind === 'mask') st.target.layer.mask.version = (st.target.layer.mask.version || 0) + 1; st.doc.bump(st.target.layer, R); }
      S.View.redraw();
    },
  };

  /* ---- buffer-based compositing (Brush/Pencil/Eraser/Clone/Heal) ---- */
  function bufferComposite(st, R, opacity, mode, maskValue) {
    const tc = st.target.canvas;
    const snap = st.edit.snapshot;
    if (st.target.kind === 'pixels') {
      if (mode === 'erase' || mode === 'clear') {
        // erasing cannot add pixels: only the part over the existing canvas matters
        R = U.rectIntersect(R, U.rectOf(tc)); if (!R) return;
      } else S.Layers.growTo(tc, R, null, { x: 0, y: 0, w: st.W, h: st.H });
      const tctx = tc.getContext('2d');
      tctx.save();
      tctx.setTransform(1, 0, 0, 1, -(tc.ox || 0), -(tc.oy || 0));
      tctx.beginPath(); tctx.rect(R.x, R.y, R.w, R.h); tctx.clip();
      tctx.clearRect(R.x, R.y, R.w, R.h);
      U.blitRect(tctx, snap, R);
      let src = st.buf, tmp = null;
      if (st.sel) {
        tmp = U.scratch(st.W, st.H, R);
        const x = tmp.getContext('2d');
        x.drawImage(st.buf, R.x, R.y, R.w, R.h, R.x, R.y, R.w, R.h);
        x.globalCompositeOperation = 'destination-in';
        x.drawImage(S.Sel.canvas(st.sel), 0, 0);
        src = tmp;
      }
      tctx.globalAlpha = opacity;
      const l = st.target.layer;
      let op = S.blendOp(mode);
      if (mode === 'erase' || mode === 'clear') op = 'destination-out';
      else if (mode === 'behind') op = 'destination-over';
      else if (l && l.locks.alpha) op = mode === 'normal' || !mode ? 'source-atop' : op;
      tctx.globalCompositeOperation = op;
      tctx.drawImage(src, R.x, R.y, R.w, R.h, R.x, R.y, R.w, R.h);
      if (l && l.locks.alpha && op !== 'source-atop' && op !== 'destination-out') {
        // restore original coverage for non-normal blend modes with locked transparency
        tctx.globalAlpha = 1; tctx.globalCompositeOperation = 'destination-in';
        U.blitRect(tctx, snap, R);
      }
      tctx.restore();
      if (tmp) U.release(tmp);
    } else {
      // grayscale mask (sparse, offset canvas; `outside` beyond it): out = old + (value - old) * coverage
      const fill = st.target.outside || 0;
      S.Layers.growTo(tc, R, null, { x: 0, y: 0, w: st.W, h: st.H }, fill);
      const old = S.Layers.readRect(snap, R, fill).data;
      const sb = st.buf.getContext('2d').getImageData(R.x, R.y, R.w, R.h).data;
      const out = new ImageData(R.w, R.h), o = out.data;
      const sel = st.sel && st.sel.mask;
      for (let y = 0; y < R.h; y++) for (let x = 0; x < R.w; x++) {
        const i = (y * R.w + x) * 4;
        let k = (sb[i + 3] / 255) * opacity;
        if (sel) k *= sel[(y + R.y) * st.W + x + R.x] / 255;
        const a = old[i + 3];
        o[i + 3] = a + (maskValue - a) * k;
      }
      S.Layers.writeRect(tc, out, R, fill);
    }
  }

  const paintOptions = (tool, bar, extra) => {
    const ui = S.Tools.ui, o = tool.opts;
    const presetBtn = ui.button(bar, '', () => S.App.showBrushPicker(tool, presetBtn), { icon: 'brushes', tip: 'Brush presets' });
    ui.num(bar, 'Size', o, 'size', 1, 2500, { unit: 'px' });
    if (o.hardness != null) ui.num(bar, 'Hardness', o, 'hardness', 0, 100, { unit: '%', scale: 100 });
    if (extra && extra.mode !== false) ui.blend(bar, o, 'blend');
    ui.num(bar, 'Opacity', o, 'opacity', 1, 100, { unit: '%' });
    if (o.flow != null) ui.num(bar, 'Flow', o, 'flow', 1, 100, { unit: '%' });
    ui.num(bar, 'Smoothing', o, 'smoothing', 0, 100, { unit: '%' });
    ui.check(bar, 'Pressure size', o, 'pressureSize');
    const sym = (o.symmetry || 'none') !== 'none';
    const more = ui.button(bar, sym ? 'Symmetry on' : '', () => S.App.brushDynamicsPopup(tool, more, extra), { icon: 'sliders', tip: 'Stabilizer, symmetry, pressure, colour dynamics, wet edges, airbrush, texture' });
    if (sym) more.classList.add('on');
  };
  const BRUSH_DEFAULTS = () => ({ size: 24, hardness: 0.8, opacity: 100, flow: 100, spacing: 10, smoothing: 10, stabilize: 0, blend: 'normal', tip: 'round',
    pressureSize: true, pressureOpacity: false, scatter: 0, sizeJitter: 0, angleJitter: 0, opacityJitter: 0, count: 1, followAngle: false, preset: 'Medium Round',
    symmetry: 'none', symN: 6, symMirror: false, hueJitter: 0, satJitter: 0, briJitter: 0, wetEdges: false, airbrush: false, texture: 'none', textureDepth: 50, textureScale: 100 });
  /** popup with the less common brush settings */
  S.App = S.App || {};
  S.App.brushDynamicsPopup = function (tool, anchor, extra) {
    const o = tool.opts, r = anchor.getBoundingClientRect(), dyn = !extra || extra.dynamics !== false;
    const pop = U.el('div', { class: 'menu opt-pop brush-dyn' });
    pop.appendChild(S.ParamUI.build([
      { id: 'h0', type: 'header', label: 'Stroke' },
      { id: 'stabilize', label: 'Stabilizer (string pull)', type: 'range', default: o.stabilize || 0, min: 0, max: 100, unit: '%' },
      { id: 'pressureOpacity', label: 'Pen pressure controls opacity', type: 'checkbox', default: !!o.pressureOpacity },
      { id: 'symmetry', label: 'Symmetry', type: 'select', default: o.symmetry || 'none', options: [{ value: 'none', label: 'Off' }, { value: 'v', label: 'Vertical' }, { value: 'h', label: 'Horizontal' }, { value: 'both', label: 'Both' }, { value: 'radial', label: 'Radial (mandala)' }] },
      { id: 'symN', label: 'Radial segments', type: 'range', default: o.symN || 6, min: 2, max: 32, step: 1 },
      { id: 'symMirror', label: 'Mirror radial segments', type: 'checkbox', default: !!o.symMirror },
    ].concat(dyn ? [
      { id: 'h1', type: 'header', label: 'Color dynamics' },
      { id: 'hueJitter', label: 'Hue jitter', type: 'range', default: o.hueJitter || 0, min: 0, max: 100, unit: '%' },
      { id: 'satJitter', label: 'Saturation jitter', type: 'range', default: o.satJitter || 0, min: 0, max: 100, unit: '%' },
      { id: 'briJitter', label: 'Brightness jitter', type: 'range', default: o.briJitter || 0, min: 0, max: 100, unit: '%' },
      { id: 'h2', type: 'header', label: 'Tip' },
      { id: 'wetEdges', label: 'Wet edges (darker rim)', type: 'checkbox', default: !!o.wetEdges },
      { id: 'airbrush', label: 'Airbrush build-up (keeps spraying while you hold)', type: 'checkbox', default: !!o.airbrush },
      { id: 'texture', label: 'Texture', type: 'select', default: o.texture || 'none', options: [{ value: 'none', label: 'None' }, { value: 'paper', label: 'Paper' }, { value: 'canvas', label: 'Canvas' }, { value: 'rough', label: 'Rough' }].concat(Object.keys(B.custom.patterns).map((n) => ({ value: 'pattern:' + n, label: 'Pattern: ' + n }))) },
      { id: 'textureDepth', label: 'Texture depth', type: 'range', default: o.textureDepth ?? 50, min: 0, max: 100, unit: '%' },
      { id: 'textureScale', label: 'Texture scale', type: 'range', default: o.textureScale ?? 100, min: 25, max: 400, unit: '%' },
    ] : []), {}, (v, id) => { o[id] = v[id]; S.Tools.saveOpts(); if (id === 'symmetry') S.Tools.renderOptions(); }));
    pop.style.left = Math.min(r.left, innerWidth - 330) + 'px'; pop.style.top = r.bottom + 4 + 'px';
    document.body.appendChild(pop);
    const close = (ev) => { if (!pop.contains(ev.target)) { pop.remove(); removeEventListener('mousedown', close, true); } };
    setTimeout(() => addEventListener('mousedown', close, true), 0);
  };

  /** Draw a (possibly rotated) tip onto a context centred at x,y */
  function stamp(ctx, tipCanvas, x, y, angle, alpha) {
    ctx.globalAlpha = U.clamp(alpha, 0, 1);
    const s = tipCanvas.width;
    if (angle) { ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.drawImage(tipCanvas, -s / 2, -s / 2); ctx.restore(); }
    else ctx.drawImage(tipCanvas, x - s / 2, y - s / 2);
  }

  /* ======================= Brush ======================= */
  const brushBase = Object.assign({}, StrokeMixin, {
    beginStroke(st) {
      st.buf = U.scratch(st.W, st.H);
      st.color = this.strokeColor(st); st.baseColor = st.color;
    },
    /** texture pattern (document-aligned) for the Texture option */
    texturePattern(st, ctx) {
      const o = this.opts, t = o.texture || 'none';
      if (t === 'none') return null;
      const key = t + '|' + (o.textureScale || 100) + '|' + (o.textureDepth ?? 50);
      if (st.texKey === key) return st.tex;
      let src = t.startsWith('pattern:') ? B.custom.patterns[t.slice(8)] : B.paper(t);
      if (!src) return null;
      // alpha = 1 - depth * (1 - texture)
      const c = U.createCanvas(src.width, src.height), x = c.getContext('2d');
      x.fillStyle = 'rgba(0,0,0,' + (1 - (o.textureDepth ?? 50) / 100) + ')'; x.fillRect(0, 0, c.width, c.height);
      x.globalCompositeOperation = 'lighter'; x.globalAlpha = (o.textureDepth ?? 50) / 100;
      if (t.startsWith('pattern:')) { x.filter = 'grayscale(1)'; x.drawImage(src, 0, 0); } else x.drawImage(src, 0, 0);
      const pat = ctx.createPattern(c, 'repeat'); const k = (o.textureScale || 100) / 100; pat.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0]));
      st.tex = pat; st.texKey = key;
      return pat;
    },
    strokeColor(st) {
      if (st.target.kind !== 'pixels') return '#000';
      return S.app.fg;
    },
    dab(st, x, y, size, alpha, angle) {
      const o = this.opts;
      const ctx = st.buf.getContext('2d');
      const aliased = this.aliased;
      if (aliased) { x = Math.floor(x) + (Math.round(size) % 2 ? 0.5 : 0); y = Math.floor(y) + (Math.round(size) % 2 ? 0.5 : 0); }
      const tip = B.tip(o.tip || 'round', size, o.hardness ?? 1, st.color, aliased, !!o.wetEdges && st.target.kind === 'pixels');
      ctx.imageSmoothingEnabled = !aliased;
      const pat = this.texturePattern(st, ctx);
      if (pat) { // textured dab: stamp on a small temp, keep only what the (document-aligned) texture lets through
        const sz = tip.width, t = st.texTmp || (st.texTmp = document.createElement('canvas')); if (t.width !== sz) { t.width = t.height = sz; }
        const tx = t.getContext('2d'); tx.save(); tx.globalCompositeOperation = 'copy'; tx.globalAlpha = 1; tx.translate(sz / 2, sz / 2); if (angle) tx.rotate(angle); tx.drawImage(tip, -sz / 2, -sz / 2); tx.restore();
        tx.save(); tx.globalCompositeOperation = 'destination-in'; tx.translate(-(x - sz / 2), -(y - sz / 2)); tx.fillStyle = pat; tx.fillRect(x - sz / 2, y - sz / 2, sz, sz); tx.restore();
        ctx.globalAlpha = U.clamp(alpha, 0, 1); ctx.drawImage(t, x - sz / 2, y - sz / 2);
        return null;
      }
      stamp(ctx, tip, x, y, angle, alpha);
      return null;
    },
    composite(st, R) {
      const value = this.maskValue(st);
      bufferComposite(st, R, this.opts.opacity / 100, this.paintMode(), value);
    },
    paintMode() { return this.opts.blend || 'normal'; },
    maskValue() { return lum255(S.app.fg); },
  });

  S.Tools.register(Object.assign({}, brushBase, {
    id: 'brush', name: 'Brush', key: 'B', icon: 'brush', group: 'brush',
    opts: BRUSH_DEFAULTS(),
    options(bar) { paintOptions(this, bar, {}); },
    onAltClick(info, doc) { S.Tools.byId.eyedropper.sampleAt(info, doc, true); },
  }));
  S.Tools.register(Object.assign({}, brushBase, {
    id: 'pencil', name: 'Pencil', key: 'B', icon: 'pencil', group: 'brush', aliased: true,
    opts: Object.assign(BRUSH_DEFAULTS(), { size: 1, hardness: 1, spacing: 5, smoothing: 0, pressureSize: false, preset: 'Hard Round' }),
    brushCursorHard() { return 1; },
    options(bar) {
      const ui = S.Tools.ui, o = this.opts;
      ui.num(bar, 'Size', o, 'size', 1, 1000, { unit: 'px' });
      ui.blend(bar, o, 'blend');
      ui.num(bar, 'Opacity', o, 'opacity', 1, 100, { unit: '%' });
      ui.num(bar, 'Smoothing', o, 'smoothing', 0, 100, { unit: '%' });
      ui.select(bar, 'Tip', o, 'tip', [{ value: 'round', label: 'Round' }, { value: 'square', label: 'Square' }]);
      ui.check(bar, 'Pressure size', o, 'pressureSize');
    },
    onAltClick(info, doc) { S.Tools.byId.eyedropper.sampleAt(info, doc, true); },
  }));

  /* ======================= Eraser ======================= */
  S.Tools.register(Object.assign({}, brushBase, {
    id: 'eraser', name: 'Eraser', key: 'E', icon: 'eraser', group: 'eraser',
    opts: Object.assign(BRUSH_DEFAULTS(), { eraseMode: 'brush', preset: 'Medium Round' }),
    dab(st, x, y, size, alpha, angle) {
      this.aliased = this.opts.eraseMode !== 'brush';
      return brushBase.dab.call(this, st, x, y, size, alpha, angle);
    },
    beginStroke(st) {
      st.buf = U.scratch(st.W, st.H); st.color = '#000';
      if (this.opts.eraseMode === 'block') this._tipSave = this.opts.tip, this.opts.tip = 'square';
    },
    endStroke() { if (this._tipSave) { this.opts.tip = this._tipSave; this._tipSave = null; } },
    brushCursorHard() { return this.opts.eraseMode === 'brush' ? this.opts.hardness : 1; },
    paintMode() { return 'erase'; },
    maskValue() { return lum255(S.app.bg); },
    options(bar) {
      const ui = S.Tools.ui, o = this.opts;
      ui.select(bar, 'Mode', o, 'eraseMode', [{ value: 'brush', label: 'Brush' }, { value: 'pencil', label: 'Pencil' }, { value: 'block', label: 'Block' }]);
      paintOptions(this, bar, { mode: false });
    },
  }));

  /* ======================= Clone Stamp ======================= */
  const cloneBase = Object.assign({}, brushBase, {
    onAltClick(info, doc) {
      this.source = { x: info.x, y: info.y, doc };
      this.offset = null;
      S.toast('Clone source set');
    },
    canStart(info, doc) {
      if (!this.source || this.source.doc !== doc) { S.toast('Alt-click to set a source point first'); return false; }
      return true;
    },
    beginStroke(st, info) {
      st.buf = U.scratch(st.W, st.H);
      if (!this.opts.aligned || !this.offset) this.offset = { x: this.source.x - info.x, y: this.source.y - info.y };
      st.src = this.opts.sampleAll ? S.Compositor.flatten(st.doc) : st.edit.snapshot;
      st.dabTmp = U.createCanvas(4, 4);
    },
    dab(st, x, y, size, alpha, angle) {
      const o = this.opts;
      const mask = B.tipMask(o.tip || 'round', size, o.hardness ?? 1);
      const s = mask.width;
      const t = st.dabTmp;
      if (t.width !== s) { t.width = s; t.height = s; }
      const tx = t.getContext('2d');
      tx.globalCompositeOperation = 'copy';
      tx.drawImage(st.src, x + this.offset.x - s / 2 - (st.src.ox || 0), y + this.offset.y - s / 2 - (st.src.oy || 0), s, s, 0, 0, s, s);
      tx.globalCompositeOperation = 'destination-in';
      tx.drawImage(mask, 0, 0);
      const ctx = st.buf.getContext('2d');
      stamp(ctx, t, x, y, 0, alpha);
      void angle;
      return null;
    },
    drawOverlay(ctx, doc) {
      if (!this.source || this.source.doc !== doc) return;
      let sx, sy;
      if (this.st && this.offset) { [sx, sy] = S.View.toScreen(S.View.mouse.x + this.offset.x, S.View.mouse.y + this.offset.y); }
      else if (this.offset && this.opts.aligned) { [sx, sy] = S.View.toScreen(S.View.mouse.x + this.offset.x, S.View.mouse.y + this.offset.y); }
      else [sx, sy] = S.View.toScreen(this.source.x, this.source.y);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(sx - 7, sy); ctx.lineTo(sx + 7, sy); ctx.moveTo(sx, sy - 7); ctx.lineTo(sx, sy + 7); ctx.stroke();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 0.75; ctx.stroke();
      ctx.beginPath(); ctx.arc(sx, sy, (this.opts.size / 2) * doc.view.zoom, 0, Math.PI * 2); ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.stroke();
    },
  });
  S.Tools.register(Object.assign({}, cloneBase, {
    id: 'clone', name: 'Clone Brush', key: 'S', icon: 'clone', group: 'clone',
    opts: Object.assign(BRUSH_DEFAULTS(), { size: 60, hardness: 0.4, aligned: true, sampleAll: false, preset: 'Soft Round' }),
    options(bar) {
      paintOptions(this, bar, {});
      S.Tools.ui.check(bar, 'Aligned', this.opts, 'aligned');
      S.Tools.ui.check(bar, 'Sample all layers', this.opts, 'sampleAll');
    },
  }));

  /* ======================= Pattern Stamp (paints a tiled pattern through the brush tip) ======================= */
  /** built-in patterns + user patterns (Edit ▸ Define Pattern) */
  B.patternChoices = () => [{ value: 'paper', label: 'Paper' }, { value: 'canvas', label: 'Canvas' }, { value: 'rough', label: 'Rough' }, { value: 'checker', label: 'Checker' }, { value: 'stripes', label: 'Stripes' }]
    .concat(Object.keys(B.custom.patterns).map((n) => ({ value: 'pattern:' + n, label: n })));
  B.patternCanvas = (id) => {
    if (id.startsWith('pattern:')) return B.custom.patterns[id.slice(8)] || null;
    if (id === 'checker' || id === 'stripes') {
      const key = 'builtin:' + id; if (B._textures[key]) return B._textures[key];
      const c = U.createCanvas(32, 32), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 32, 32); x.fillStyle = '#000';
      if (id === 'checker') { x.fillRect(0, 0, 16, 16); x.fillRect(16, 16, 16, 16); } else { x.fillRect(0, 0, 32, 8); x.fillRect(0, 16, 32, 8); }
      return (B._textures[key] = c);
    }
    // paper textures are alpha-only: render on white → gray
    const key = 'builtinPaper:' + id; if (B._textures[key]) return B._textures[key];
    const p = B.paper(id), c = U.createCanvas(p.width, p.height), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(p, 0, 0);
    return (B._textures[key] = c);
  };
  S.Tools.register(Object.assign({}, brushBase, {
    id: 'patternStamp', name: 'Pattern Stamp', key: 'S', icon: 'pattern', group: 'clone',
    opts: Object.assign(BRUSH_DEFAULTS(), { size: 60, hardness: 0.6, pattern: 'checker', patternScale: 100, aligned: true, preset: 'Medium Round' }),
    options(bar) {
      const ui = S.Tools.ui, o = this.opts;
      paintOptions(this, bar, { dynamics: false });
      ui.select(bar, 'Pattern', o, 'pattern', B.patternChoices());
      ui.num(bar, 'Scale', o, 'patternScale', 10, 400, { unit: '%' });
      ui.check(bar, 'Aligned', o, 'aligned').title = 'Aligned: the pattern stays fixed to the document across strokes';
    },
    beginStroke(st, info) {
      st.buf = U.scratch(st.W, st.H); st.color = '#000';
      const src = B.patternCanvas(this.opts.pattern || 'checker');
      st.patSrc = src; st.dabTmp = U.createCanvas(4, 4);
      st.patOrigin = this.opts.aligned || !info ? { x: 0, y: 0 } : { x: Math.round(info.x), y: Math.round(info.y) };
      if (src) { const k = (this.opts.patternScale || 100) / 100; st.pat = st.dabTmp.getContext('2d').createPattern(src, 'repeat'); st.pat.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0])); }
    },
    dab(st, x, y, size, alpha) {
      if (!st.pat) return null;
      const o = this.opts, mask = B.tipMask(o.tip || 'round', size, o.hardness ?? 1), s = mask.width, t = st.dabTmp;
      if (t.width !== s) { t.width = s; t.height = s; }
      const tx = t.getContext('2d');
      tx.save(); tx.globalCompositeOperation = 'copy'; tx.translate(-(x - s / 2) + st.patOrigin.x, -(y - s / 2) + st.patOrigin.y); tx.fillStyle = st.pat; tx.fillRect(x - s / 2 - st.patOrigin.x, y - s / 2 - st.patOrigin.y, s, s); tx.restore();
      tx.globalCompositeOperation = 'destination-in'; tx.drawImage(mask, 0, 0);
      stamp(st.buf.getContext('2d'), t, x, y, 0, alpha);
      return null;
    },
  }));

  /* ======================= Healing (clone + low-frequency color matching) ======================= */
  /** Normalized blur: blur colors weighted by alpha (canvas blur is premultiplied → normalized on readback) */
  function normBlur(srcCanvas, rad, w, h) {
    const c = U.createCanvas(w, h), x = c.getContext('2d');
    x.filter = 'blur(' + Math.max(0.5, rad) + 'px)';
    x.drawImage(srcCanvas, 0, 0);
    return x.getImageData(0, 0, w, h).data;
  }
  /**
   * Heal region R: target pixels T (snapshot), texture source canvas `src` (R-sized, alpha = coverage).
   * result = src - blur(src) + fill(T outside stroke)   (written back into st.buf)
   */
  function healInto(st, R, srcCanvas, size) {
    const w = R.w, h = R.h;
    const coverage = srcCanvas.getContext('2d').getImageData(0, 0, w, h).data;
    // target with the stroke area knocked out
    const holed = U.createCanvas(w, h), hx = holed.getContext('2d');
    U.blitRect(hx, st.edit.snapshot, R, 0, 0);
    hx.globalCompositeOperation = 'destination-out';
    const hard = U.createCanvas(w, h), hdx = hard.getContext('2d');
    const himg = hdx.createImageData(w, h);
    for (let i = 3; i < coverage.length; i += 4) himg.data[i] = coverage[i] > 8 ? 255 : 0;
    hdx.putImageData(himg, 0, 0);
    hx.drawImage(hard, 0, 0);
    const r1 = Math.max(2, size * 0.3), r2 = Math.max(4, size * 0.9);
    const f1 = normBlur(holed, r1, w, h), f2 = normBlur(holed, r2, w, h);
    const bl = normBlur(srcCanvas, r1, w, h);
    const out = hx.createImageData(w, h), o = out.data;
    for (let i = 0; i < o.length; i += 4) {
      const a = coverage[i + 3];
      if (!a) continue;
      const useF1 = f1[i + 3] > 70;
      const F = useF1 ? f1 : f2;
      const mix = useF1 ? 1 : U.clamp(f1[i + 3] / 70, 0, 1);
      for (let k = 0; k < 3; k++) {
        const fill = F === f1 ? f1[i + k] : f1[i + k] * mix + f2[i + k] * (1 - mix);
        o[i + k] = coverage[i + k] - bl[i + k] + fill;
      }
      o[i + 3] = a;
    }
    const bctx = st.buf.getContext('2d');
    bctx.clearRect(R.x, R.y, w, h);
    bctx.putImageData(out, R.x, R.y);
  }
  S.Tools.register(Object.assign({}, cloneBase, {
    id: 'heal', name: 'Heal Brush', key: 'J', icon: 'heal', group: 'heal',
    opts: Object.assign(BRUSH_DEFAULTS(), { size: 40, hardness: 0.5, aligned: true, sampleAll: false, preset: 'Medium Round' }),
    options(bar) {
      const ui = S.Tools.ui, o = this.opts;
      ui.num(bar, 'Size', o, 'size', 1, 1000, { unit: 'px' });
      ui.num(bar, 'Hardness', o, 'hardness', 0, 100, { unit: '%', scale: 100 });
      ui.check(bar, 'Aligned', o, 'aligned');
      ui.check(bar, 'Sample all layers', o, 'sampleAll');
      bar.appendChild(U.el('span', { class: 'muted opt-hint' }, 'Alt-click to set source'));
    },
    endStroke(st) {
      if (!st.total || st.target.kind !== 'pixels') return;
      const R = U.rectInt({ x: st.total.x - this.opts.size, y: st.total.y - this.opts.size, w: st.total.w + this.opts.size * 2, h: st.total.h + this.opts.size * 2 }, st.W, st.H);
      if (!R) return;
      const src = U.createCanvas(R.w, R.h);
      src.getContext('2d').drawImage(st.buf, R.x, R.y, R.w, R.h, 0, 0, R.w, R.h);
      healInto(st, R, src, this.opts.size);
      st.frame = R; st.total = U.rectUnion(st.total, R);
    },
    composite(st, R) { bufferComposite(st, R, 1, 'normal', 0); },
  }));
  S.Tools.register(Object.assign({}, brushBase, {
    id: 'spotHeal', name: 'Spot Heal', key: 'J', icon: 'spotHeal', group: 'heal',
    opts: Object.assign(BRUSH_DEFAULTS(), { size: 30, hardness: 0.6, preset: 'Medium Round' }),
    options(bar) {
      const ui = S.Tools.ui, o = this.opts;
      ui.num(bar, 'Size', o, 'size', 1, 1000, { unit: 'px' });
      ui.num(bar, 'Hardness', o, 'hardness', 0, 100, { unit: '%', scale: 100 });
      bar.appendChild(U.el('span', { class: 'muted opt-hint' }, 'Paint over blemishes; texture is borrowed from nearby'));
    },
    beginStroke(st) { st.buf = U.scratch(st.W, st.H); st.color = '#2a1a10'; st.preview = true; },
    composite(st, R, final) {
      if (st.preview && !final) {
        // show the painted area as a translucent overlay while stroking
        const tc = st.target.canvas; S.Layers.growTo(tc, R, null, { x: 0, y: 0, w: st.W, h: st.H });
        const tctx = tc.getContext('2d');
        tctx.save(); tctx.setTransform(1, 0, 0, 1, -(tc.ox || 0), -(tc.oy || 0)); tctx.beginPath(); tctx.rect(R.x, R.y, R.w, R.h); tctx.clip();
        tctx.clearRect(R.x, R.y, R.w, R.h);
        U.blitRect(tctx, st.edit.snapshot, R);
        tctx.globalAlpha = 0.45; tctx.drawImage(st.buf, R.x, R.y, R.w, R.h, R.x, R.y, R.w, R.h);
        tctx.restore();
      } else bufferComposite(st, R, 1, 'normal', 0);
    },
    endStroke(st) {
      if (!st.total || st.target.kind !== 'pixels') return;
      const sz = this.opts.size;
      const R = U.rectInt({ x: st.total.x - sz, y: st.total.y - sz, w: st.total.w + sz * 2, h: st.total.h + sz * 2 }, st.W, st.H);
      if (!R) return;
      st.preview = false;
      // choose a nearby source offset whose surroundings look most similar
      const bw = st.total.w, bh = st.total.h;
      const cands = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].map(([a, b]) => [Math.round(a * (bw * 1.1 + 4)), Math.round(b * (bh * 1.1 + 4))]);
      const mean = (x, y, w, h) => {
        const r = U.rectInt({ x, y, w, h }, st.W, st.H); if (!r || r.w < w * 0.8 || r.h < h * 0.8) return null;
        const d = S.Layers.readRect(st.edit.snapshot, r).data; let s = [0, 0, 0], n = 0;
        for (let i = 0; i < d.length; i += 16) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; n++; }
        return s.map((v) => v / Math.max(1, n));
      };
      const ring = mean(R.x, R.y, R.w, R.h) || [128, 128, 128];
      let best = cands[0], bd = Infinity;
      for (const c of cands) {
        const m = mean(st.total.x + c[0], st.total.y + c[1], bw, bh);
        if (!m) continue;
        const d = Math.abs(m[0] - ring[0]) + Math.abs(m[1] - ring[1]) + Math.abs(m[2] - ring[2]);
        if (d < bd) { bd = d; best = c; }
      }
      const src = U.createCanvas(R.w, R.h), sx = src.getContext('2d');
      U.blitRect(sx, st.edit.snapshot, { x: R.x + best[0], y: R.y + best[1], w: R.w, h: R.h }, 0, 0);
      sx.globalCompositeOperation = 'destination-in';
      sx.drawImage(st.buf, R.x, R.y, R.w, R.h, 0, 0, R.w, R.h);
      healInto(st, R, src, sz);
      st.frame = R; st.total = U.rectUnion(st.total, R);
    },
  }));

  /* ======================= Pixel tools (CPU) ======================= */
  const pixelBase = Object.assign({}, StrokeMixin, {
    beginStroke(st) {
      // CPU copy of the document-sized view of the target (the layer canvas itself may be smaller or offset)
      st.img = S.Layers.readRect(st.target.canvas, { x: 0, y: 0, w: st.W, h: st.H }, st.target.outside || 0);
      st.d = st.img.data;
      st.maskOnly = st.target.kind !== 'pixels';
      st.selM = st.sel ? st.sel.mask : null;
    },
    composite(st, R) {
      const tc = st.target.canvas; S.Layers.growTo(tc, R, null, { x: 0, y: 0, w: st.W, h: st.H }, st.target.outside || 0);
      tc.getContext('2d').putImageData(st.img, -(tc.ox || 0), -(tc.oy || 0), R.x, R.y, R.w, R.h);
    },
    /** iterate pixels in the dab circle: fn(index4, weight) */
    each(st, x, y, size, strength, fn) {
      const r = size / 2, hard = this.opts.hardness ?? 0.5;
      const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(st.W - 1, Math.ceil(x + r));
      const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(st.H - 1, Math.ceil(y + r));
      for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
        const t = Math.hypot(xx + 0.5 - x, yy + 0.5 - y) / r;
        if (t >= 1) continue;
        let w = B.falloff(t, hard) * strength;
        if (st.selM) w *= st.selM[yy * st.W + xx] / 255;
        if (w <= 0.001) continue;
        fn((yy * st.W + xx) * 4, w, xx, yy);
      }
      return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    },
  });
  const pixelOpts = (tool, bar, strengthLabel) => {
    const ui = S.Tools.ui, o = tool.opts;
    ui.num(bar, 'Size', o, 'size', 1, 1000, { unit: 'px' });
    ui.num(bar, 'Hardness', o, 'hardness', 0, 100, { unit: '%', scale: 100 });
    ui.num(bar, strengthLabel || 'Strength', o, 'strength', 1, 100, { unit: '%' });
  };

  S.Tools.register(Object.assign({}, pixelBase, {
    id: 'smudge', name: 'Smudge', key: 'R', icon: 'smudge', group: 'blur',
    opts: { size: 40, hardness: 0.3, strength: 50, spacing: 8, smoothing: 0, pressureSize: false, fingerPaint: false },
    options(bar) { pixelOpts(this, bar); S.Tools.ui.check(bar, 'Finger painting', this.opts, 'fingerPaint'); },
    dab(st, x, y, size, alpha) {
      const s = this.opts.strength / 100;
      const r = size / 2, D = Math.ceil(size) + 1;
      if (!st.carry || st.carryD !== D) {
        st.carry = new Float32Array(D * D * 4); st.carryD = D;
        const fc = U.hexToRgb(S.app.fg);
        for (let j = 0; j < D; j++) for (let i = 0; i < D; i++) {
          const xx = U.clamp(Math.floor(x - r) + i, 0, st.W - 1), yy = U.clamp(Math.floor(y - r) + j, 0, st.H - 1), k = (yy * st.W + xx) * 4, q = (j * D + i) * 4;
          if (this.opts.fingerPaint && st.n === 0) { st.carry[q] = fc.r; st.carry[q + 1] = fc.g; st.carry[q + 2] = fc.b; st.carry[q + 3] = 255; }
          else for (let c = 0; c < 4; c++) st.carry[q + c] = st.d[k + c];
        }
        if (!this.opts.fingerPaint || st.n > 0) return null;
      }
      const ox = Math.floor(x - r), oy = Math.floor(y - r), d = st.d, carry = st.carry;
      const rect = this.each(st, x, y, size, s * alpha, (k, w, xx, yy) => {
        const q = ((yy - oy) * D + (xx - ox)) * 4;
        if (q < 0 || q >= carry.length) return;
        if (st.maskOnly) { d[k + 3] += (carry[q + 3] - d[k + 3]) * w; }
        else for (let c = 0; c < 4; c++) d[k + c] += (carry[q + c] - d[k + c]) * w;
      });
      // pick up the new pixels into the carry buffer
      for (let j = 0; j < D; j++) for (let i = 0; i < D; i++) {
        const xx = ox + i, yy = oy + j;
        if (xx < 0 || yy < 0 || xx >= st.W || yy >= st.H) continue;
        const k = (yy * st.W + xx) * 4, q = (j * D + i) * 4;
        for (let c = 0; c < 4; c++) carry[q + c] = carry[q + c] * 0.15 + d[k + c] * 0.85;
      }
      return rect;
    },
  }));

  function boxAvg(st, x, y, rad, out) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let j = -rad; j <= rad; j++) for (let i = -rad; i <= rad; i++) {
      const xx = U.clamp(x + i, 0, st.W - 1), yy = U.clamp(y + j, 0, st.H - 1), k = (yy * st.W + xx) * 4;
      r += st.src[k]; g += st.src[k + 1]; b += st.src[k + 2]; a += st.src[k + 3]; n++;
    }
    out[0] = r / n; out[1] = g / n; out[2] = b / n; out[3] = a / n;
  }
  const blurSharpenBase = Object.assign({}, pixelBase, {
    beginStroke(st) { pixelBase.beginStroke.call(this, st); st.src = new Uint8ClampedArray(st.d); },
    dab(st, x, y, size, alpha) {
      const s = (this.opts.strength / 100) * alpha, avg = [0, 0, 0, 0], sharpen = this.sharpen, d = st.d;
      const rad = Math.max(1, Math.round(size / 24));
      const rect = this.each(st, x, y, size, s, (k, w, xx, yy) => {
        boxAvg(st, xx, yy, rad, avg);
        if (st.maskOnly) { d[k + 3] += ((sharpen ? 2 * d[k + 3] - avg[3] : avg[3]) - d[k + 3]) * w; return; }
        for (let c = 0; c < 3; c++) {
          const target = sharpen ? d[k + c] + (d[k + c] - avg[c]) * 0.9 : avg[c];
          d[k + c] += (target - d[k + c]) * w * (sharpen ? 0.6 : 1);
        }
        if (!sharpen) d[k + 3] += (avg[3] - d[k + 3]) * w;
      });
      // refresh source for progressive effect
      for (let yy = rect.y; yy < rect.y + rect.h; yy++) { const o = (yy * st.W + rect.x) * 4; st.src.set(d.subarray(o, o + rect.w * 4), o); }
      return rect;
    },
  });
  S.Tools.register(Object.assign({}, blurSharpenBase, {
    id: 'blur', name: 'Blur', key: 'R', icon: 'blur', group: 'blur', sharpen: false,
    opts: { size: 40, hardness: 0.3, strength: 50, spacing: 15, smoothing: 0, pressureSize: false },
    options(bar) { pixelOpts(this, bar); },
  }));
  S.Tools.register(Object.assign({}, blurSharpenBase, {
    id: 'sharpen', name: 'Sharpen', key: 'R', icon: 'sharpen', group: 'blur', sharpen: true,
    opts: { size: 40, hardness: 0.3, strength: 30, spacing: 25, smoothing: 0, pressureSize: false },
    options(bar) { pixelOpts(this, bar); },
  }));

  const toneBase = Object.assign({}, pixelBase, {
    canStart(info, doc, target) { if (target.kind !== 'pixels') { S.toast(this.name + ' works on layer pixels only'); return false; } return true; },
    beginStroke(st) { pixelBase.beginStroke.call(this, st); st.hit = new Float32Array(st.W * st.H); },
    dab(st, x, y, size, alpha) {
      const o = this.opts, d = st.d, kind = this.kind;
      const exp = (o.exposure ?? o.strength ?? 50) / 100;
      return this.each(st, x, y, size, alpha * exp * 0.35, (k, w, xx, yy) => {
        // limit accumulation within one stroke so it behaves like a single pass
        const idx = yy * st.W + xx;
        const room = Math.max(0, 1 - st.hit[idx]);
        w = Math.min(w, room) || 0; if (w <= 0) return;
        st.hit[idx] += w * 0.5;
        const r = d[k], g = d[k + 1], b = d[k + 2];
        const L = U.luma(r, g, b) / 255;
        if (kind === 'sponge') {
          const gray = U.luma(r, g, b), f = o.spongeMode === 'saturate' ? 1 + w * 2 : 1 - w * 2;
          d[k] = gray + (r - gray) * Math.max(0, f); d[k + 1] = gray + (g - gray) * Math.max(0, f); d[k + 2] = gray + (b - gray) * Math.max(0, f);
          return;
        }
        const rw = o.range === 'shadows' ? (1 - L) * (1 - L) : o.range === 'highlights' ? L * L : 1 - (2 * L - 1) * (2 * L - 1);
        const k2 = w * (0.3 + rw * 0.9) * 1.6;
        for (let c = 0; c < 3; c++) d[k + c] = kind === 'dodge' ? d[k + c] + (255 - d[k + c]) * k2 : d[k + c] * (1 - k2);
      });
    },
  });
  const toneOptions = (tool, bar) => {
    const ui = S.Tools.ui, o = tool.opts;
    ui.num(bar, 'Size', o, 'size', 1, 1000, { unit: 'px' });
    ui.num(bar, 'Hardness', o, 'hardness', 0, 100, { unit: '%', scale: 100 });
    if (tool.kind === 'sponge') {
      ui.select(bar, 'Mode', o, 'spongeMode', [{ value: 'desaturate', label: 'Desaturate' }, { value: 'saturate', label: 'Saturate' }]);
      ui.num(bar, 'Flow', o, 'strength', 1, 100, { unit: '%' });
    } else {
      ui.select(bar, 'Range', o, 'range', [{ value: 'shadows', label: 'Shadows' }, { value: 'midtones', label: 'Midtones' }, { value: 'highlights', label: 'Highlights' }]);
      ui.num(bar, 'Exposure', o, 'exposure', 1, 100, { unit: '%' });
    }
  };
  S.Tools.register(Object.assign({}, toneBase, {
    id: 'dodge', name: 'Dodge', key: 'O', icon: 'dodge', group: 'dodge', kind: 'dodge',
    opts: { size: 60, hardness: 0.2, exposure: 50, range: 'midtones', spacing: 15, smoothing: 0, pressureSize: false },
    options(bar) { toneOptions(this, bar); },
  }));
  S.Tools.register(Object.assign({}, toneBase, {
    id: 'burn', name: 'Burn', key: 'O', icon: 'burn', group: 'dodge', kind: 'burn',
    opts: { size: 60, hardness: 0.2, exposure: 50, range: 'midtones', spacing: 15, smoothing: 0, pressureSize: false },
    options(bar) { toneOptions(this, bar); },
  }));
  S.Tools.register(Object.assign({}, toneBase, {
    id: 'sponge', name: 'Sponge', key: 'O', icon: 'sponge', group: 'dodge', kind: 'sponge',
    opts: { size: 60, hardness: 0.2, strength: 50, spongeMode: 'desaturate', spacing: 15, smoothing: 0, pressureSize: false },
    options(bar) { toneOptions(this, bar); },
  }));

  /**
   * Heal-blend an R-sized source canvas (alpha = coverage) into the paint target at document rect R:
   * the source texture keeps its detail but takes the colours of the surroundings (used by the Patch tool).
   */
  S.healBlend = function (doc, target, R, srcCanvas, size, name) {
    const st = { doc, target, edit: doc.beginPixelEdit(target), W: doc.width, H: doc.height, sel: null, buf: U.scratch(doc.width, doc.height) };
    healInto(st, R, srcCanvas, size);
    bufferComposite(st, R, 1, 'normal', 0);
    U.release(st.buf);
    st.edit.end(name || 'Patch', R);
    if (target.layer) doc.bump(target.layer, R); else doc.invalidate();
    S.bus.emit('layers:changed', doc);
  };

  /** Stroke a path / selection outline with the current brush (used by Stroke Path) */
  S.Brush.strokePolyline = function (doc, tool, points) {
    if (!points.length) return;
    const target = doc.paintTarget();
    if (!target || target.kind === 'invalid') { S.toast('Select a pixel layer to stroke'); return; }
    const fake = (p) => ({ x: p[0], y: p[1], pressure: 1, shift: false, alt: false });
    tool.st = { doc, target, edit: doc.beginPixelEdit(target), last: null, acc: 0, total: null, frame: null, sm: null, n: 0, W: doc.width, H: doc.height, sel: doc.selection };
    tool.beginStroke(tool.st, fake(points[0]));
    const sm = tool.opts.smoothing; tool.opts.smoothing = 0;
    for (const p of points) tool.addPoint(fake(p), true);
    tool.opts.smoothing = sm;
    tool.flush(); if (tool.endStroke) tool.endStroke(tool.st); tool.flush(true);
    tool.st.edit.end('Stroke Path', tool.st.total);
    if (tool.st.buf) U.release(tool.st.buf);
    tool.st = null;
  };
})();
