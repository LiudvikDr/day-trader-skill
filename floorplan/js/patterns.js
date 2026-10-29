/*
 * Pattern library + layout engine.
 *
 * Every pattern generates an infinite tiling in its own "pattern frame",
 * restricted to a bounding box. The engine maps the room into that frame
 * (rotation + shift), clips every piece against the room and measures the
 * cuts. Pieces are generated at pitch size (piece + joint) and shrunk by
 * half a joint on every side, so grout gaps fall out of the geometry.
 */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./geometry.js') : root.Geo);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Patterns = api;
})(typeof self !== 'undefined' ? self : this, function (Geo) {
  'use strict';

  const { rect } = Geo;
  const DEG = Math.PI / 180;

  // Courses of pieces Lp long and Wp wide, course j shifted by offset(j).
  function courses(b, Lp, Wp, offset) {
    const out = [];
    const j0 = Math.floor(b.minY / Wp) - 1, j1 = Math.ceil(b.maxY / Wp) + 1;
    for (let j = j0; j <= j1; j++) {
      const s = offset(j);
      const i0 = Math.floor((b.minX - s) / Lp) - 1, i1 = Math.ceil((b.maxX - s) / Lp) + 1;
      for (let i = i0; i <= i1; i++) {
        out.push({ poly: rect(s + i * Lp, j * Wp, Lp, Wp), ang: 0, i, j });
      }
    }
    return out;
  }

  /*
   * Repeat a motif on the lattice {s·a + t·c}. The coefficient range is found
   * by expressing the bounding box corners in lattice coordinates, padded by
   * how far the motif reaches outside its cell.
   */
  function lattice(b, a, c, motif) {
    const det = a[0] * c[1] - a[1] * c[0];
    let reach = 0;
    for (const m of motif) for (const p of m.poly) reach = Math.max(reach, Math.hypot(p[0], p[1]));
    const padS = Math.ceil((reach * Math.hypot(c[0], c[1])) / Math.abs(det)) + 1;
    const padT = Math.ceil((reach * Math.hypot(a[0], a[1])) / Math.abs(det)) + 1;
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const [x, y] of [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]]) {
      const s = (x * c[1] - y * c[0]) / det, t = (a[0] * y - a[1] * x) / det;
      s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t);
    }
    const out = [];
    for (let s = Math.floor(s0) - padS; s <= Math.ceil(s1) + padS; s++) {
      for (let t = Math.floor(t0) - padT; t <= Math.ceil(t1) + padT; t++) {
        const ox = s * a[0] + t * c[0], oy = s * a[1] + t * c[1];
        motif.forEach((m, k) => {
          out.push({ ...m, poly: m.poly.map(([x, y]) => [x + ox, y + oy]), i: s, j: t, k });
        });
      }
    }
    return out;
  }

  /*
   * Herringbone: a zig-zag strip of horizontal (H) and vertical (V) pieces
   * stepping by (W, W); neighbouring strips are offset by (-L, L).
   * Lattice determinant = 2·L·W = area of the two pieces in the motif.
   */
  function herringbone(b, Lp, Wp) {
    return lattice(b, [Wp, Wp], [-Lp, Lp], [
      { poly: rect(0, 0, Lp, Wp), ang: 0 },
      { poly: rect(Lp, Wp - Lp, Wp, Lp), ang: 90 * DEG },
    ]);
  }

  /*
   * Chevron: parallelogram boards with ends mitred at angle θ so the seams
   * form a straight centre line. Horizontal reach c = L·cosθ, vertical
   * course height h = W / cosθ, so each piece still has area L·W.
   */
  function chevron(b, Lp, Wp, theta) {
    const c = Lp * Math.cos(theta), h = Wp / Math.cos(theta), rise = c * Math.tan(theta);
    return lattice(b, [2 * c, 0], [0, h], [
      { poly: [[0, 0], [c, rise], [c, rise + h], [0, h]], ang: theta },
      { poly: [[c, rise], [2 * c, 0], [2 * c, h], [c, rise + h]], ang: -theta },
    ]);
  }

  // Basketweave: square blocks of n pieces, alternating direction.
  function basketweave(b, Lp, Wp) {
    const n = Math.max(2, Math.round(Lp / Wp)), S = n * Wp, motif = [];
    for (let bx = 0; bx < 2; bx++) {
      for (let by = 0; by < 2; by++) {
        const horizontal = (bx + by) % 2 === 0;
        for (let k = 0; k < n; k++) {
          motif.push(horizontal
            ? { poly: rect(bx * S, by * S + k * Wp, S, Wp), ang: 0, L: S }
            : { poly: rect(bx * S + k * Wp, by * S, Wp, S), ang: 90 * DEG, L: S });
        }
      }
    }
    return lattice(b, [2 * S, 0], [0, 2 * S], motif);
  }

  // Random stagger with installer rules: joints in adjacent rows at least
  // `minStagger` apart and no aligned joints two rows apart ("H-joints").
  function staggerOffsets(j0, j1, Lp, seed) {
    const rnd = Geo.mulberry32(seed), minStagger = Lp * 0.25, offsets = {};
    const dist = (a, b) => { const d = Math.abs(a - b) % Lp; return Math.min(d, Lp - d); };
    let p1 = null, p2 = null;
    for (let j = j0; j <= j1; j++) {
      let s = rnd() * Lp;
      for (let tries = 0; tries < 40 && p1 !== null; tries++) {
        if (dist(s, p1) >= minStagger && (p2 === null || dist(s, p2) >= minStagger * 0.5)) break;
        s = rnd() * Lp;
      }
      offsets[j] = s;
      p2 = p1; p1 = s;
    }
    return offsets;
  }

  const PATTERNS = [
    {
      id: 'stack', name: 'Stack bond', materials: ['tile'], base: 0, waste: 0.10,
      desc: 'A crisp modern grid with every joint aligned. Calm, architectural and fast to lay.',
      build: (b, L, W) => courses(b, L, W, () => 0),
      period: (L, W) => [L, W],
    },
    {
      id: 'checker', name: 'Checkerboard', materials: ['tile'], base: 0, waste: 0.10, twoTone: true,
      desc: 'Classic two-tone grid — think Parisian bistros and retro kitchens.',
      build: (b, L, W) => courses(b, L, W, () => 0),
      period: (L, W) => [2 * L, 2 * W],
    },
    {
      id: 'brick', name: 'Running bond ½', materials: ['tile', 'wood'], base: 0, waste: 0.10,
      desc: 'Each row offset by half a piece, like brickwork. Timeless and forgiving.',
      build: (b, L, W) => courses(b, L, W, (j) => (j * L) / 2),
      period: (L, W) => [L, 2 * W],
    },
    {
      id: 'third', name: 'Third offset', materials: ['tile', 'wood'], base: 0, waste: 0.10,
      desc: 'Rows offset by a third — the recommended stagger for long large-format tiles (less lippage).',
      build: (b, L, W) => courses(b, L, W, (j) => (j * L) / 3),
      period: (L, W) => [L, 3 * W],
    },
    {
      id: 'random', name: 'Random stagger', materials: ['wood'], base: 0, waste: 0.07,
      desc: 'Natural plank look with randomised joints that obey installer rules (≥ ¼ board stagger, no H-joints).',
      build: (b, L, W, o) => {
        const j0 = Math.floor(b.minY / W) - 1, j1 = Math.ceil(b.maxY / W) + 1;
        const offsets = staggerOffsets(j0, j1, L, o.seed);
        return courses(b, L, W, (j) => offsets[j]);
      },
      period: (L, W) => [L, W],
    },
    {
      id: 'diagonal', name: 'Diagonal grid', materials: ['tile'], base: 45, waste: 0.15,
      desc: 'A grid turned 45°. Makes small rooms feel wider and hides out-of-square walls.',
      build: (b, L, W) => courses(b, L, W, () => 0),
      period: (L, W) => [L, W],
    },
    {
      id: 'diagonal-plank', name: 'Diagonal planks', materials: ['wood'], base: 45, waste: 0.15,
      desc: 'Planks run at 45° for movement and a sense of depth.',
      build: (b, L, W, o) => {
        const j0 = Math.floor(b.minY / W) - 1, j1 = Math.ceil(b.maxY / W) + 1;
        const offsets = staggerOffsets(j0, j1, L, o.seed);
        return courses(b, L, W, (j) => offsets[j]);
      },
      period: (L, W) => [L, W],
    },
    {
      id: 'herringbone', name: 'Herringbone', materials: ['tile', 'wood'], base: -45, waste: 0.15,
      minRatio: 1.5,
      desc: 'The zig-zag runs along the room, pieces at 45° to the walls. Elegant and endlessly popular.',
      build: (b, L, W) => herringbone(b, L, W),
      period: (L, W) => [L + W, L + W],
    },
    {
      id: 'herringbone-90', name: 'Herringbone 90°', materials: ['tile', 'wood'], base: 0, waste: 0.12,
      minRatio: 1.5,
      desc: 'Pieces square to the walls, zig-zag running diagonally. A subtler, more graphic herringbone.',
      build: (b, L, W) => herringbone(b, L, W),
      period: (L, W) => [L + W, L + W],
    },
    {
      id: 'chevron', name: 'Chevron', materials: ['wood', 'tile'], base: 0, waste: 0.15,
      minRatio: 2,
      desc: 'Mitred 45° ends meet in a clean centre line — the classic French "point de Hongrie".',
      build: (b, L, W) => chevron(b, L, W, 45 * DEG),
      period: (L, W) => [2 * L * Math.cos(45 * DEG), W / Math.cos(45 * DEG)],
    },
    {
      id: 'basketweave', name: 'Basketweave', materials: ['tile', 'wood'], base: 0, waste: 0.12,
      minRatio: 1.8,
      desc: 'Square blocks of parallel pieces alternate direction, like woven parquet.',
      build: (b, L, W) => basketweave(b, L, W),
      period: (L, W) => { const S = Math.max(2, Math.round(L / W)) * W; return [2 * S, 2 * S]; },
    },
  ];

  const byId = Object.fromEntries(PATTERNS.map((p) => [p.id, p]));

  function available(material, L, W) {
    const ratio = Math.max(L, W) / Math.min(L, W);
    return PATTERNS.filter((p) => p.materials.includes(material) && (!p.minRatio || ratio >= p.minRatio - 1e-9));
  }

  // Pattern frame <-> room ("world") frame.
  function makeTransform(room, pattern, opts) {
    const bb = Geo.bbox(room);
    const c = [bb.minX + bb.w / 2, bb.minY + bb.h / 2];
    const theta = ((pattern.base + (opts.rotation || 0)) * DEG);
    const d = opts.shift || [0, 0];
    return {
      c, theta, d,
      toLocal: (p) => {
        const r = Geo.rotate([p[0] - c[0], p[1] - c[1]], -theta);
        return [r[0] - d[0], r[1] - d[1]];
      },
      toWorld: (p) => {
        const r = Geo.rotate([p[0] + d[0], p[1] + d[1]], theta);
        return [r[0] + c[0], r[1] + c[1]];
      },
    };
  }

  /*
   * Lay `pattern` in `room`. opts: { L, W, gap, rotation (deg), shift [u,v],
   * seed, sliverRatio }. Returns the clipped pieces (in pattern frame) plus
   * statistics.
   */
  function layout(room, pattern, opts) {
    const L = Math.max(opts.L, opts.W), W = Math.min(opts.L, opts.W);
    const gap = opts.gap || 0, Lp = L + gap, Wp = W + gap;
    const sliverRatio = opts.sliverRatio ?? 0.25;
    const tf = makeTransform(room, pattern, opts);
    const roomLocal = tf.toLocal ? room.map(tf.toLocal) : room;
    const rb = Geo.bbox(roomLocal);
    const raw = pattern.build(rb, Lp, Wp, opts);
    const pieces = [];
    for (const r of raw) {
      const nominalL = (r.L ?? Lp) - gap, nominalW = W;
      const actual = Geo.inset(r.poly, gap / 2);
      if (!Geo.boxesOverlap(Geo.bbox(actual), rb)) continue;
      const clipped = Geo.clip(roomLocal, actual);
      if (!clipped.length) continue;
      const a = Geo.area(clipped);
      const full = Geo.area(actual);
      if (a < full * 1e-4) continue;
      const isFull = a >= full * 0.999;
      const [eu, ev] = Geo.extents(clipped, r.ang);
      const fu = Math.min(1, eu / nominalL), fv = Math.min(1, ev / nominalW);
      const angled = !isFull && a < eu * ev * 0.98;
      pieces.push({
        poly: clipped, outline: actual, ang: r.ang, L: nominalL, W: nominalW,
        full: isFull, frac: a / full, eu, ev, angled,
        sliver: !isFull && Math.min(fu, fv) < sliverRatio,
        i: r.i, j: r.j, k: r.k || 0,
      });
    }

    const roomArea = Geo.area(room);
    const pitchArea = (L + gap) * (W + gap);
    const cut = pieces.filter((p) => !p.full);
    const minCut = cut.length ? Math.min(...cut.map((p) => Math.min(p.eu / p.L, p.ev / p.W))) : 1;
    return {
      pieces, transform: tf, L, W, gap,
      stats: {
        roomArea,
        count: pieces.length,
        full: pieces.length - cut.length,
        cut: cut.length,
        slivers: cut.filter((p) => p.sliver).length,
        minCut,
        unitArea: L * W,
        minUnits: roomArea / pitchArea,
        waste: pattern.waste,
      },
    };
  }

  // Lower is better: slivers are heavily penalised, then number of cuts.
  const score = (s) => s.slivers * 100 + s.cut + (1 - s.minCut) * 5;

  /*
   * Search shifts across one period of the pattern for the layout with the
   * fewest slivers and cuts: a coarse grid, then a refinement around the best.
   */
  function optimizeShift(room, pattern, opts) {
    const L = Math.max(opts.L, opts.W), W = Math.min(opts.L, opts.W), gap = opts.gap || 0;
    const [pu, pv] = pattern.period(L + gap, W + gap);
    const probe = layout(room, pattern, { ...opts, shift: [0, 0] });
    const n = probe.pieces.length > 1500 ? 6 : probe.pieces.length > 400 ? 9 : 14;
    let best = { shift: [0, 0], score: score(probe.stats), stats: probe.stats };
    const tryShift = (u, v) => {
      const res = layout(room, pattern, { ...opts, shift: [u, v] });
      const sc = score(res.stats);
      if (sc < best.score - 1e-9) best = { shift: [u, v], score: sc, stats: res.stats };
    };
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) tryShift((a / n) * pu, (b / n) * pv);
    const [cu, cv] = best.shift, du = pu / n, dv = pv / n;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) tryShift(cu + (a * du) / 3, cv + (b * dv) / 3);
    return best;
  }

  return { PATTERNS, byId, available, layout, optimizeShift, makeTransform, score };
});
