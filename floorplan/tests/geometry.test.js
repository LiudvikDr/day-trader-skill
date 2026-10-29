// Run with: node floorplan/tests/geometry.test.js
'use strict';

const assert = require('assert');
const Geo = require('../js/geometry.js');
const P = require('../js/patterns.js');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ok  ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

const rectRoom = Geo.rect(0, 0, 400, 300);
const lRoom = [[0, 0], [500, 0], [500, 250], [300, 250], [300, 400], [0, 400]];

test('shoelace area of rectangle and L-shape', () => {
  near(Geo.area(rectRoom), 120000, 1e-9, 'rect');
  near(Geo.area(lRoom), 500 * 400 - 200 * 150, 1e-9, 'L');
});

test('clipping a concave room by a convex piece', () => {
  const piece = Geo.rect(250, 200, 100, 100); // straddles the inner corner
  near(Geo.area(Geo.clip(lRoom, piece)), 100 * 100 - 50 * 50, 1e-6, 'area');
  assert.deepStrictEqual(Geo.clip(lRoom, Geo.rect(400, 300, 50, 50)), []);
});

test('inset shrinks a rectangle by d on every side', () => {
  near(Geo.area(Geo.inset(Geo.rect(0, 0, 10, 4), 0.5)), 9 * 3, 1e-9, 'area');
});

test('self-intersection detection', () => {
  assert.ok(Geo.selfIntersects([[0, 0], [10, 10], [10, 0], [0, 10]]));
  assert.ok(!Geo.selfIntersects(lRoom));
});

// With zero gap every pattern must tile the room exactly: no holes, no overlaps.
for (const room of [['rectangle', rectRoom], ['L-shape', lRoom]]) {
  for (const pat of P.PATTERNS) {
    for (const rotation of [0, 17]) {
      test(`${pat.name} tiles the ${room[0]} exactly (rotation ${rotation}°)`, () => {
        const res = P.layout(room[1], pat, { L: 60, W: 20, gap: 0, rotation, shift: [7, 3], seed: 42 });
        const total = res.pieces.reduce((s, p) => s + Geo.area(p.poly), 0);
        near(total, Geo.area(room[1]), Geo.area(room[1]) * 1e-6, 'covered area');
        const rnd = Geo.mulberry32(7), bb = Geo.bbox(room[1]);
        for (let k = 0; k < 300; k++) {
          const w = [bb.minX + rnd() * bb.w, bb.minY + rnd() * bb.h];
          if (!Geo.pointInPolygon(w, room[1])) continue;
          const l = res.transform.toLocal(w);
          const hits = res.pieces.filter((p) => Geo.pointInPolygon(l, p.outline)).length;
          assert.strictEqual(hits, 1, `point ${w} covered ${hits} times`);
        }
      });
    }
  }
}

test('grout reduces covered area by the joint fraction', () => {
  const res = P.layout(Geo.rect(0, 0, 300, 300), P.byId.stack, { L: 30, W: 30, gap: 1, shift: [0.5, 0.5] });
  const total = res.pieces.reduce((s, p) => s + Geo.area(p.poly), 0);
  near(total / 90000, (30 * 30) / (31 * 31), 0.01, 'coverage');
});

test('aligned grid has no cuts and the expected count', () => {
  const res = P.layout(Geo.rect(0, 0, 300, 240), P.byId.stack, { L: 60, W: 30, gap: 0, shift: [30, 0] }); // origin sits at the room centre
  assert.strictEqual(res.stats.cut, 0);
  assert.strictEqual(res.stats.count, 40);
});

test('optimiser never makes a layout worse', () => {
  const opts = { L: 60, W: 30, gap: 0.3, rotation: 0, shift: [0, 0] };
  for (const id of ['stack', 'brick', 'herringbone']) {
    const before = P.score(P.layout(lRoom, P.byId[id], opts).stats);
    const best = P.optimizeShift(lRoom, P.byId[id], opts);
    assert.ok(best.score <= before, `${id}: ${best.score} > ${before}`);
  }
});

test('random stagger respects the minimum joint stagger', () => {
  const res = P.layout(Geo.rect(0, 0, 600, 400), P.byId.random, { L: 120, W: 20, gap: 0, shift: [0, 0], seed: 3 });
  const joints = {};
  for (const p of res.pieces) {
    const x = Math.min(...p.outline.map((q) => q[0]));
    (joints[p.j] = joints[p.j] || []).push(((x % 120) + 120) % 120);
  }
  const rows = Object.keys(joints).map(Number).sort((a, b) => a - b);
  for (let r = 1; r < rows.length; r++) {
    const d = Math.abs(joints[rows[r]][0] - joints[rows[r - 1]][0]);
    assert.ok(Math.min(d, 120 - d) >= 30 - 1e-6, `rows ${rows[r - 1]}/${rows[r]} stagger ${d}`);
  }
});

console.log(failures ? `\n${failures} test(s) failed` : '\nall tests passed');
process.exit(failures ? 1 : 0);
