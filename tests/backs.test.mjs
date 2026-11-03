import test from 'node:test';
import assert from 'node:assert/strict';
import { findMarkers, readLayout, CARD } from '../js/backs.js';
import { MARKERS, DECOY, CARD_MARKERS } from '../js/markers.js';

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
