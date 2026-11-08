import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTableMap } from '../js/table-map.js';

// A table of cards laid in rows: id -> centre (mm) and long-side axis. `at` moves the
// whole block.
function table(cols, rows, { gx = 12, gy = 16, w = 56, h = 87, at = [0, 0], first = 1 } = {}) {
  const t = new Map();
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    t.set(first + r * cols + c, { p: [at[0] + c * (w + gx) + w / 2, at[1] + r * (h + gy) + h / 2], axis: [0, 1] });
  }
  return t;
}
const rowsOfTable = (cols, rows, first = 1) => Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => first + r * cols + c));

// A view of the table: centred on `at` (mm), turned by `angle` degrees, at `ppm` pixels
// per millimetre, in a frame of `size` pixels. Returns the cards wholly in the frame, as
// the reader gives them, and the frame size.
let seed = 7;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
function look(tbl, { at, angle = 0, ppm = 6, size = [1440, 2160], flip = 0, jitter = 0.4 }) {
  const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const cards = [];
  for (const [id, { p, axis }] of tbl) {
    const dx = p[0] - at[0], dy = p[1] - at[1];
    const x = size[0] / 2 + ppm * (c * dx - s * dy) + (rand() - 0.5) * 2 * jitter, y = size[1] / 2 + ppm * (s * dx + c * dy) + (rand() - 0.5) * 2 * jitter;
    const m = 45 * ppm;
    if (x < m || y < m || x > size[0] - m || y > size[1] - m) continue;
    let ax = c * axis[0] - s * axis[1], ay = s * axis[0] + c * axis[1];
    // The reader can't tell which end of a card is up: sometimes the axis comes back turned round.
    if (rand() < flip) { ax = -ax; ay = -ay; }
    cards.push({ id, centre: [x, y], axis: [ax, ay], mm: ppm * (1 + (rand() - 0.5) * 0.04) });
  }
  return { cards, size };
}

// Every pair of cards on the map should be as far apart as on the table.
function worstSpacing(snapshot, tbl) {
  const pos = new Map(snapshot.cards.map(c => [c.id, c.centre]));
  let worst = 0;
  const ids = [...pos.keys()];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const [a, b] = [ids[i], ids[j]];
    const dm = Math.hypot(pos.get(a)[0] - pos.get(b)[0], pos.get(a)[1] - pos.get(b)[1]);
    const dt = Math.hypot(tbl.get(a).p[0] - tbl.get(b).p[0], tbl.get(a).p[1] - tbl.get(b).p[1]);
    worst = Math.max(worst, Math.abs(dm - dt));
  }
  return worst;
}

test('pieces a long table together from a slow sweep, turning and rising as it goes', () => {
  const tbl = table(3, 7), map = makeTableMap();
  for (let i = 0; i <= 30; i++) {
    const v = look(tbl, { at: [96, 150 + i * 14], angle: i * 0.5, ppm: 5.2 - i * 0.025, flip: 0.3 });
    assert.ok(map.add(v.cards, v.size), `view ${i}`);
  }
  const snap = map.snapshot();
  assert.equal(snap.groups.length, 1);
  assert.equal(snap.groups[0].cards.length, 21);
  assert.ok(worstSpacing(snap.groups[0], tbl) < 3, `spacing off by ${worstSpacing(snap.groups[0], tbl).toFixed(1)} mm`);
  assert.deepEqual(snap.groups[0].rows, rowsOfTable(3, 7));
  assert.ok(snap.view && snap.groups[0].current);
});

test('carries on from one shared card at a time, even when its axis comes back turned round', () => {
  // A single row of cards, seen two at a time.
  const tbl = table(8, 1), map = makeTableMap();
  for (let i = 0; i < 7; i++) {
    const v = look(tbl, { at: [i * 68 + 62, 43.5], ppm: 6, size: [1300, 900], flip: 0.5 });
    assert.equal(v.cards.length, 2);
    assert.ok(map.add(v.cards, v.size));
  }
  const g = map.snapshot().groups;
  assert.equal(g.length, 1);
  assert.ok(worstSpacing(g[0], tbl) < 4, `spacing off by ${worstSpacing(g[0], tbl).toFixed(1)} mm`);
  assert.deepEqual(g[0].rows, rowsOfTable(8, 1));
});

test('keeps parts never seen together as separate groups, and joins them when a view shows both', () => {
  const left = table(2, 2), right = table(2, 2, { at: [700, 40], first: 5 });
  const both = new Map([...left, ...right]), map = makeTableMap();
  for (let i = 0; i < 3; i++) { const v = look(left, { at: [62, 103 + i], ppm: 6 }); map.add(v.cards, v.size); }
  for (let i = 0; i < 3; i++) { const v = look(right, { at: [762, 143 + i], angle: 20, ppm: 5 }); map.add(v.cards, v.size); }
  let snap = map.snapshot();
  assert.equal(snap.groups.length, 2);
  assert.deepEqual(snap.groups.map(g => g.cards.map(c => c.id).sort()), [[1, 2, 3, 4], [5, 6, 7, 8]]);
  assert.ok(snap.groups[1].current, 'the last view was in the second group');
  // One view far enough up to see both.
  const v = look(both, { at: [412, 123], angle: 5, ppm: 1.5 });
  assert.equal(v.cards.length, 8);
  map.add(v.cards, v.size);
  snap = map.snapshot();
  assert.equal(snap.groups.length, 1);
  // The joining view is from far up and spans 70 cm, so a fraction of a pixel is a few
  // millimetres at the far side: plenty to tell rows apart.
  assert.ok(worstSpacing(snap.groups[0], both) < 8, `spacing off by ${worstSpacing(snap.groups[0], both).toFixed(1)} mm`);
});

test('a card misread or moved in one view doesn’t throw the map', () => {
  const tbl = table(3, 2), map = makeTableMap();
  const v1 = look(tbl, { at: [102, 103], ppm: 6, jitter: 0 });
  map.add(v1.cards, v1.size);
  const before = new Map(map.snapshot().groups[0].cards.map(c => [c.id, c.centre]));
  const v2 = look(tbl, { at: [110, 100], ppm: 6, jitter: 0 });
  v2.cards.find(c => c.id === 5).centre[0] += 40 * 6;   // 40 mm out
  assert.ok(map.add(v2.cards, v2.size));
  for (const c of map.snapshot().groups[0].cards) {
    const [x, y] = before.get(c.id);
    assert.ok(Math.hypot(c.centre[0] - x, c.centre[1] - y) < 1, `card ${c.id} moved on the map`);
  }
});

test('leaves out a read whose only shared cards disagree', () => {
  const tbl = table(2, 1), map = makeTableMap();
  const v1 = look(tbl, { at: [62, 43.5], ppm: 6, size: [1000, 800], jitter: 0 });
  map.add(v1.cards, v1.size);
  const v2 = look(tbl, { at: [62, 43.5], ppm: 6, size: [1000, 800], jitter: 0 });
  v2.cards[1].centre[0] += 60 * 6;
  assert.equal(map.add(v2.cards, v2.size), false);
  assert.equal(map.snapshot().groups[0].cards.length, 2);
});
