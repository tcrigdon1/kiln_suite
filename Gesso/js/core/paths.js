/* =========================================================================
   Gesso — vector path model and shape generators.
   A path: { subpaths: [ { closed, nodes: [ {x,y, ix,iy, ox,oy} ] } ] }
   (ix,iy) = incoming bezier handle, (ox,oy) = outgoing handle, absolute coords.
   A handle equal to its anchor means a sharp corner / straight segment.
   ========================================================================= */
(function () {
  'use strict';
  const S = window.Gesso;
  const K = 0.5522847498; // circle bezier constant

  const node = (x, y, ix, iy, ox, oy) => ({ x, y, ix: ix ?? x, iy: iy ?? y, ox: ox ?? x, oy: oy ?? y });

  const Paths = (S.Paths = {
    node,
    clone(p) { return { subpaths: (p.subpaths || []).map((sp) => ({ closed: !!sp.closed, nodes: sp.nodes.map((n) => ({ ...n })) })) }; },
    empty() { return { subpaths: [] }; },

    /** Build a Path2D (optionally transforming every point with fn) */
    toPath2D(p, fn) {
      const P = new Path2D();
      const T = fn || ((x, y) => [x, y]);
      for (const sp of p.subpaths || []) {
        const n = sp.nodes;
        if (!n.length) continue;
        let a = T(n[0].x, n[0].y);
        P.moveTo(a[0], a[1]);
        const seg = (A, B) => {
          const c1 = T(A.ox, A.oy), c2 = T(B.ix, B.iy), e = T(B.x, B.y);
          if (A.ox === A.x && A.oy === A.y && B.ix === B.x && B.iy === B.y) P.lineTo(e[0], e[1]);
          else P.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], e[0], e[1]);
        };
        for (let i = 1; i < n.length; i++) seg(n[i - 1], n[i]);
        if (sp.closed && n.length > 1) { seg(n[n.length - 1], n[0]); P.closePath(); }
      }
      return P;
    },

    transform(p, fn) {
      const out = Paths.clone(p);
      for (const sp of out.subpaths) for (const n of sp.nodes) {
        [n.x, n.y] = fn(n.x, n.y); [n.ix, n.iy] = fn(n.ix, n.iy); [n.ox, n.oy] = fn(n.ox, n.oy);
      }
      return out;
    },
    translate(p, dx, dy) { return Paths.transform(p, (x, y) => [x + dx, y + dy]); },

    bounds(p) {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const sp of p.subpaths || []) for (const n of sp.nodes) {
        for (const [x, y] of [[n.x, n.y], [n.ix, n.iy], [n.ox, n.oy]]) {
          if (x < x1) x1 = x; if (y < y1) y1 = y; if (x > x2) x2 = x; if (y > y2) y2 = y;
        }
      }
      if (x1 === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    },

    /* ---------- Shape generators (return path objects) ---------- */
    /** rounded rectangle; r is one radius or [topLeft, topRight, bottomRight, bottomLeft] (per-corner) */
    rect(x, y, w, h, r = 0) {
      if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
      const rs = (Array.isArray(r) ? [r[0], r[1], r[2], r[3]] : [r, r, r, r]).map((v) => Math.max(0, +v || 0));
      // scale radii down together when adjacent corners would overlap (as SVG / CSS do)
      let f = 1;
      for (const [a, b, len] of [[0, 1, w], [1, 2, h], [2, 3, w], [3, 0, h]]) { const sum = rs[a] + rs[b]; if (sum > len) f = Math.min(f, len / sum); }
      const [tl, tr, br, bl] = rs.map((v) => v * f);
      if (!(tl || tr || br || bl)) return { subpaths: [{ closed: true, nodes: [node(x, y), node(x + w, y), node(x + w, y + h), node(x, y + h)] }] };
      const nodes = [], kk = 1 - K;
      // clockwise from the end of the top-left arc (same node order as a uniform radius): each rounded corner
      // contributes its arc start + arc end node, a square corner one sharp node
      if (tl) nodes.push(node(x + tl, y, x + tl * kk, y, x + tl, y)); else nodes.push(node(x, y));
      if (tr) { const k = tr * kk; nodes.push(node(x + w - tr, y, x + w - tr, y, x + w - k, y)); nodes.push(node(x + w, y + tr, x + w, y + k, x + w, y + tr)); } else nodes.push(node(x + w, y));
      if (br) { const k = br * kk; nodes.push(node(x + w, y + h - br, x + w, y + h - br, x + w, y + h - k)); nodes.push(node(x + w - br, y + h, x + w - k, y + h, x + w - br, y + h)); } else nodes.push(node(x + w, y + h));
      if (bl) { const k = bl * kk; nodes.push(node(x + bl, y + h, x + bl, y + h, x + k, y + h)); nodes.push(node(x, y + h - bl, x, y + h - k, x, y + h - bl)); } else nodes.push(node(x, y + h));
      if (tl) nodes.push(node(x, y + tl, x, y + tl, x, y + tl * kk));
      return { subpaths: [{ closed: true, nodes }] };
    },
    ellipse(cx, cy, rx, ry) {
      rx = Math.abs(rx); ry = Math.abs(ry);
      const kx = rx * K, ky = ry * K;
      return { subpaths: [{ closed: true, nodes: [
        node(cx, cy - ry, cx - kx, cy - ry, cx + kx, cy - ry),
        node(cx + rx, cy, cx + rx, cy - ky, cx + rx, cy + ky),
        node(cx, cy + ry, cx + kx, cy + ry, cx - kx, cy + ry),
        node(cx - rx, cy, cx - rx, cy + ky, cx - rx, cy - ky),
      ] }] };
    },
    polygon(cx, cy, rx, ry, sides, rot = -Math.PI / 2) {
      sides = Math.max(3, sides | 0);
      const nodes = [];
      for (let i = 0; i < sides; i++) { const a = rot + (i / sides) * Math.PI * 2; nodes.push(node(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry)); }
      return { subpaths: [{ closed: true, nodes }] };
    },
    star(cx, cy, rx, ry, points, inner = 0.5, rot = -Math.PI / 2) {
      points = Math.max(3, points | 0);
      const nodes = [];
      for (let i = 0; i < points * 2; i++) {
        const a = rot + (i / (points * 2)) * Math.PI * 2, f = i % 2 ? inner : 1;
        nodes.push(node(cx + Math.cos(a) * rx * f, cy + Math.sin(a) * ry * f));
      }
      return { subpaths: [{ closed: true, nodes }] };
    },
    line(x1, y1, x2, y2, width = 4, arrowStart = false, arrowEnd = false, head = 3) {
      // A line is drawn as a filled polygon so it renders like any shape
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len, nx = -uy, ny = ux, hw = width / 2;
      const hl = Math.min(len / 2, width * head), hwid = width * head * 0.55;
      const pts = [];
      const sx = arrowStart ? x1 + ux * hl : x1, sy = arrowStart ? y1 + uy * hl : y1;
      const ex = arrowEnd ? x2 - ux * hl : x2, ey = arrowEnd ? y2 - uy * hl : y2;
      pts.push([sx + nx * hw, sy + ny * hw], [ex + nx * hw, ey + ny * hw]);
      if (arrowEnd) pts.push([ex + nx * hwid, ey + ny * hwid], [x2, y2], [ex - nx * hwid, ey - ny * hwid]);
      pts.push([ex - nx * hw, ey - ny * hw], [sx - nx * hw, sy - ny * hw]);
      if (arrowStart) pts.push([sx - nx * hwid, sy - ny * hwid], [x1, y1], [sx + nx * hwid, sy + ny * hwid]);
      return { subpaths: [{ closed: true, nodes: pts.map((p) => node(p[0], p[1])) }] };
    },

    /** Built-in custom shapes, defined in a unit box 0..1 then mapped into x,y,w,h */
    CUSTOM: {
      heart: { label: 'Heart', icon: 'heart', unit: () => ({ subpaths: [{ closed: true, nodes: [
        node(0.5, 0.28, 0.5, 0.28, 0.58, 0.08), node(0.78, 0.02, 0.66, 0.02, 0.95, 0.02),
        node(1.0, 0.32, 1.0, 0.16, 1.0, 0.55), node(0.5, 1.0, 0.86, 0.72, 0.5, 1.0),
        node(0.0, 0.32, 0.14, 0.72, 0.0, 0.55), node(0.22, 0.02, 0.0, 0.16, 0.34, 0.02),
      ] }] }) },
      bubble: { label: 'Speech Bubble', icon: 'bubble', unit: () => {
        const p = Paths.rect(0, 0, 1, 0.75, 0.14); const n = p.subpaths[0].nodes;
        // insert tail between bottom-right and bottom-left corner nodes (index 4 -> 5)
        n.splice(5, 0, node(0.42, 0.75), node(0.2, 1.0), node(0.26, 0.75));
        return p;
      } },
      arrow: { label: 'Block Arrow', icon: 'arrow', unit: () => ({ subpaths: [{ closed: true, nodes: [
        node(0, 0.32), node(0.58, 0.32), node(0.58, 0.05), node(1, 0.5), node(0.58, 0.95), node(0.58, 0.68), node(0, 0.68),
      ] }] }) },
      check: { label: 'Check Mark', icon: 'check', unit: () => ({ subpaths: [{ closed: true, nodes: [
        node(0, 0.55), node(0.14, 0.41), node(0.36, 0.63), node(0.86, 0.1), node(1, 0.24), node(0.36, 0.9),
      ] }] }) },
      cross: { label: 'Plus Sign', icon: 'plus', unit: () => ({ subpaths: [{ closed: true, nodes: [
        node(0.35, 0), node(0.65, 0), node(0.65, 0.35), node(1, 0.35), node(1, 0.65), node(0.65, 0.65), node(0.65, 1), node(0.35, 1), node(0.35, 0.65), node(0, 0.65), node(0, 0.35), node(0.35, 0.35),
      ] }] }) },
      ring: { label: 'Ring', icon: 'ellipse', unit: () => {
        const a = Paths.ellipse(0.5, 0.5, 0.5, 0.5), b = Paths.ellipse(0.5, 0.5, 0.3, 0.3);
        b.subpaths[0].nodes.reverse().forEach((n) => { [n.ix, n.iy, n.ox, n.oy] = [n.ox, n.oy, n.ix, n.iy]; });
        return { subpaths: [a.subpaths[0], b.subpaths[0]] };
      } },
    },
    custom(name, x, y, w, h) {
      const def = Paths.CUSTOM[name] || Paths.CUSTOM.heart;
      return Paths.transform(def.unit(), (u, v) => [x + u * w, y + v * h]);
    },

    /** Find nearest anchor/handle within tol (doc units). Returns {sp, i, part:'anchor'|'in'|'out'} */
    hitTest(p, x, y, tol) {
      let best = null, bd = tol * tol;
      (p.subpaths || []).forEach((sp, si) => sp.nodes.forEach((n, i) => {
        const test = (px, py, part) => { const d = (px - x) ** 2 + (py - y) ** 2; if (d <= bd) { bd = d; best = { sp: si, i, part }; } };
        test(n.x, n.y, 'anchor');
        if (n.ix !== n.x || n.iy !== n.y) test(n.ix, n.iy, 'in');
        if (n.ox !== n.x || n.oy !== n.y) test(n.ox, n.oy, 'out');
      }));
      return best;
    },

    /** Point on a cubic segment, used to insert anchors. */
    splitSegment(A, B, t) {
      const L = (p, q) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      const p0 = [A.x, A.y], p1 = [A.ox, A.oy], p2 = [B.ix, B.iy], p3 = [B.x, B.y];
      const a = L(p0, p1), b = L(p1, p2), c = L(p2, p3), d = L(a, b), e = L(b, c), f = L(d, e);
      return { a, d, f, e, c };
    },
    /** Approximate distance from point to path segments; returns {sp, i (segment start), t, d} */
    nearestSegment(p, x, y) {
      let best = null;
      (p.subpaths || []).forEach((sp, si) => {
        const n = sp.nodes, cnt = sp.closed ? n.length : n.length - 1;
        for (let i = 0; i < cnt; i++) {
          const A = n[i], B = n[(i + 1) % n.length];
          for (let k = 0; k <= 24; k++) {
            const t = k / 24, mt = 1 - t;
            const px = mt * mt * mt * A.x + 3 * mt * mt * t * A.ox + 3 * mt * t * t * B.ix + t * t * t * B.x;
            const py = mt * mt * mt * A.y + 3 * mt * mt * t * A.oy + 3 * mt * t * t * B.iy + t * t * t * B.y;
            const d = Math.hypot(px - x, py - y);
            if (!best || d < best.d) best = { sp: si, i, t, d };
          }
        }
      });
      return best;
    },
  });
})();
