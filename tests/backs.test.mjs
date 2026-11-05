import test from 'node:test';
import assert from 'node:assert/strict';
import { findMarkers, readLayout, cardsFromCorners, CARD, CORNER_SIZES } from '../js/backs.js';
import { MARKERS, DECOY, CARD_MARKERS, CORNER_MARKS, CARD_CORNERS } from '../js/markers.js';

// Paints card backs into a grayscale image: a dark card with its code top left and,
// turned round, bottom right, and the decoy in the other corners. Each card can be
// turned by `angle` degrees about its centre.
function paint(cards, w, h, pxPerMm) {
  const gray = new Uint8ClampedArray(w * h).fill(170);
  for (const { id, cx, cy, angle } of cards) {
    const a = angle * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
    const half = Math.hypot(CARD.w, CARD.h) / 2 * pxPerMm;
    for (let y = Math.max(0, Math.floor(cy - half)); y < Math.min(h, cy + half); y++) {
      for (let x = Math.max(0, Math.floor(cx - half)); x < Math.min(w, cx + half); x++) {
        // Into card millimetres, measured from the card's top-left corner.
        const dx = (x - cx) / pxPerMm, dy = (y - cy) / pxPerMm;
        const u = dx * cos + dy * sin + CARD.w / 2, v = -dx * sin + dy * cos + CARD.h / 2;
        if (u < 0 || v < 0 || u > CARD.w || v > CARD.h) continue;
        let value = 28;
        for (const [mx, my, code, flip] of [[CARD.inset, CARD.inset, id, false], [CARD.w - CARD.inset - CARD.marker, CARD.h - CARD.inset - CARD.marker, id, true],
          [CARD.w - CARD.inset - CARD.marker, CARD.inset, DECOY, false], [CARD.inset, CARD.h - CARD.inset - CARD.marker, DECOY, true]]) {
          let c = Math.floor(u - mx), r = Math.floor(v - my);
          if (c < 0 || r < 0 || c > 7 || r > 7) continue;
          if (flip) { c = 7 - c; r = 7 - r; }
          const ring = r === 0 || r === 7 || c === 0 || c === 7;
          if (ring || MARKERS[code][(r - 1) * 6 + c - 1] === '1') value = 200;
        }
        gray[y * w + x] = value;
      }
    }
  }
  return { gray, w, h };
}

test('reads a marker however the card is turned', () => {
  for (const angle of [0, 33, 90, 180, 251]) {
    const img = paint([{ id: 5, cx: 300, cy: 380, angle }], 600, 760, 6);
    const ids = findMarkers(img).map(m => m.id).sort();
    assert.deepEqual(ids, [DECOY, DECOY, 5, 5], `at ${angle} degrees`);
  }
});

test('finds which cards lie in which row, top to bottom and left to right', () => {
  const P = 5.5, ids = Object.values(CARD_MARKERS);
  const layout = [[ids[0], ids[7], ids[14]], [ids[3], ids[20]], [ids[9], ids[1], ids[18], ids[12]]];
  const cards = [];
  layout.forEach((row, r) => row.forEach((id, c) => cards.push({
    id, cx: (60 + c * 72 + 31.5) * P, cy: (40 + r * 108 + 44) * P, angle: (r * 7 + c * 13) % 9 - 4 + (c % 2 ? 180 : 0),
  })));
  const res = readLayout(paint(cards, Math.round(380 * P), Math.round(400 * P), P));
  assert.deepEqual(res.rows.map(r => r.map(c => c.id)), layout);
  assert.deepEqual(res.doubles, []);
});

test('plain noise is never read as a card', () => {
  const w = 500, h = 400, gray = new Uint8ClampedArray(w * h);
  let s = 12345;
  for (let i = 0; i < gray.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; gray[i] = (s >> 8) & 255; }
  assert.equal(findMarkers({ gray, w, h }).length, 0);
});

// Paints corner-layout card backs: marks 1-4 placed by each card's order, read
// counterclockwise from the top left, all facing the card's top.
function paintCorners(cards, size, w, h, pxPerMm) {
  const gray = new Uint8ClampedArray(w * h).fill(170);
  const M = CARD.marker, i = size.inset;
  const spots = [[i, i], [i, size.h - i - M], [size.w - i - M, size.h - i - M], [size.w - i - M, i]];
  for (const { name, cx, cy, angle } of cards) {
    const a = angle * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
    const marks = spots.map(([mx, my], k) => [mx, my, MARKERS[CORNER_MARKS[+CARD_CORNERS[name][k] - 1]]]);
    const half = Math.hypot(size.w, size.h) / 2 * pxPerMm;
    for (let y = Math.max(0, Math.floor(cy - half)); y < Math.min(h, cy + half); y++) {
      for (let x = Math.max(0, Math.floor(cx - half)); x < Math.min(w, cx + half); x++) {
        const dx = (x - cx) / pxPerMm, dy = (y - cy) / pxPerMm;
        const u = dx * cos + dy * sin + size.w / 2, v = -dx * sin + dy * cos + size.h / 2;
        if (u < 0 || v < 0 || u > size.w || v > size.h) continue;
        let value = 28;
        for (const [mx, my, bits] of marks) {
          const c = Math.floor(u - mx), r = Math.floor(v - my);
          if (c < 0 || r < 0 || c > 7 || r > 7) continue;
          if (r === 0 || r === 7 || c === 0 || c === 7 || bits[(r - 1) * 6 + c - 1] === '1') value = 200;
        }
        gray[y * w + x] = value;
      }
    }
  }
  return { gray, w, h };
}

for (const size of CORNER_SIZES) {
  test(`reads every card of the corner layout on ${size.name} cards, in rows`, () => {
    const P = 5.5, names = Object.keys(CARD_MARKERS), gap = 4;
    const layout = [names.slice(0, 5), names.slice(5, 9), names.slice(9, 14), names.slice(14, 18), names.slice(18)];
    const cards = [];
    layout.forEach((row, r) => row.forEach((name, c) => cards.push({
      name, cx: (20 + c * (size.w + gap) + size.w / 2) * P, cy: (20 + r * (size.h + 12) + size.h / 2) * P,
      angle: (r * 7 + c * 13) % 9 - 4 + ((r + c) % 3 === 0 ? 180 : 0),
    })));
    const img = paintCorners(cards, size, Math.round((40 + 5 * size.w + 4 * gap) * P), Math.round((40 + 5 * size.h + 48) * P), P);
    const res = readLayout(img);
    const nameOf = Object.fromEntries(Object.entries(CARD_MARKERS).map(([n, id]) => [id, n]));
    assert.deepEqual(res.rows.map(row => row.map(c => nameOf[c.id])), layout);
    assert.deepEqual(res.doubles, []);
  });
}

// The hardest spacing: two cards facing the same way, with a gap just wide enough
// that the left card's right-hand marks and the right card's left-hand marks line up
// exactly like the corners of a card lying between them. The marks are built directly
// and listed with those four first, so the phantom is the first card the reader can
// form. Every pair of cards, at both sizes.
test("isn't fooled by marks of neighbouring cards lining up like a card between them", () => {
  const names = Object.keys(CARD_MARKERS), nameOf = Object.fromEntries(Object.entries(CARD_MARKERS).map(([n, id]) => [id, n]));
  const P = 6, M = CARD.marker, fooled = [];
  for (const size of CORNER_SIZES) {
    const i = size.inset, gap = size.w - 4 * i - 2 * M;
    const spots = [[i, i], [i, size.h - i - M], [size.w - i - M, size.h - i - M], [size.w - i - M, i]];
    for (const a of names) for (const b of names) {
      if (a === b) continue;
      const marks = [];
      [a, b].forEach((name, c) => spots.forEach(([mx, my], k) => {
        const x = (c * (size.w + gap) + mx) * P, y = my * P, s = M * P;
        const first = (c === 0 && k >= 2) || (c === 1 && k <= 1);
        marks.push({ first, id: CORNER_MARKS[+CARD_CORNERS[name][k] - 1], centre: [x + s / 2, y + s / 2], corners: [[x, y], [x + s, y], [x + s, y + s], [x, y + s]] });
      }));
      marks.sort((p, q) => q.first - p.first);
      const got = cardsFromCorners(marks, size).cards.map(c => nameOf[c.id]).sort();
      if (got.join() !== [a, b].sort().join()) fooled.push(`${size.name}: ${a} + ${b} read as ${got.join(' + ') || 'nothing'}`);
    }
  }
  assert.deepEqual(fooled, []);
});
