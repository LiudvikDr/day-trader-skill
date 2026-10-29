/*
 * Geometry primitives for the floor planner.
 * Polygons are arrays of [x, y] points. Works in the browser (window.Geo)
 * and in Node (module.exports) so the maths can be unit-tested.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Geo = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EPS = 1e-9;

  // Shoelace formula. Positive for counter-clockwise (in a y-up frame).
  function signedArea(poly) {
    let s = 0;
    for (let i = 0, n = poly.length; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return s / 2;
  }

  const area = (poly) => Math.abs(signedArea(poly));
  const ensureCCW = (poly) => (signedArea(poly) < 0 ? poly.slice().reverse() : poly);

  function bbox(poly) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of poly) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }

  const boxesOverlap = (a, b) =>
    a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

  /*
   * Sutherland–Hodgman clipping of any simple polygon (the room, which may be
   * concave) against a convex polygon (a tile or board). The result is the
   * intersection; for concave subjects it can contain zero-width bridges,
   * which do not change its area.
   */
  function clip(subject, convex) {
    const c = ensureCCW(convex);
    let out = subject;
    for (let i = 0; i < c.length && out.length; i++) {
      const a = c[i], b = c[(i + 1) % c.length];
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const side = (p) => ex * (p[1] - a[1]) - ey * (p[0] - a[0]);
      const input = out;
      out = [];
      for (let j = 0; j < input.length; j++) {
        const p = input[j], q = input[(j + 1) % input.length];
        const sp = side(p), sq = side(q);
        if (sp >= 0) out.push(p);
        if ((sp >= 0) !== (sq >= 0)) {
          const t = sp / (sp - sq);
          out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
        }
      }
    }
    return out.length >= 3 ? dedupe(out) : [];
  }

  function dedupe(poly) {
    const out = [];
    for (const p of poly) {
      const q = out[out.length - 1];
      if (!q || Math.abs(p[0] - q[0]) > 1e-7 || Math.abs(p[1] - q[1]) > 1e-7) out.push(p);
    }
    if (out.length > 1) {
      const f = out[0], l = out[out.length - 1];
      if (Math.abs(f[0] - l[0]) < 1e-7 && Math.abs(f[1] - l[1]) < 1e-7) out.pop();
    }
    return out.length >= 3 ? out : [];
  }

  // Shrink a convex polygon by distance d (used for grout / joint gaps).
  function inset(poly, d) {
    if (!(d > 0)) return poly;
    const p = ensureCCW(poly), n = p.length, lines = [];
    for (let i = 0; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      lines.push([[a[0] - (dy / len) * d, a[1] + (dx / len) * d], [dx, dy]]);
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const [p1, d1] = lines[(i + n - 1) % n], [p2, d2] = lines[i];
      const den = d1[0] * d2[1] - d1[1] * d2[0];
      if (Math.abs(den) < EPS) { out.push(p2); continue; }
      const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den;
      out.push([p1[0] + t * d1[0], p1[1] + t * d1[1]]);
    }
    return out;
  }

  function pointInPolygon(pt, poly) {
    const [x, y] = pt;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  const rotate = (p, ang) => {
    const c = Math.cos(ang), s = Math.sin(ang);
    return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
  };

  // Width of a polygon measured along and across a direction `ang`.
  function extents(poly, ang) {
    const c = Math.cos(ang), s = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of poly) {
      const u = x * c + y * s, v = -x * s + y * c;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    return [u1 - u0, v1 - v0];
  }

  // True if two non-adjacent edges of the polygon cross.
  function selfIntersects(poly) {
    const n = poly.length;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      for (let j = i + 1; j < n; j++) {
        if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
        const c = poly[j], d = poly[(j + 1) % n];
        const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
        if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
            ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))) return true;
      }
    }
    return false;
  }

  const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

  // Deterministic PRNG so "random" layouts are reproducible and shareable.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  return {
    EPS, signedArea, area, ensureCCW, bbox, boxesOverlap, clip, inset,
    pointInPolygon, rotate, extents, selfIntersects, rect, mulberry32,
  };
});
