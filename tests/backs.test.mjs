import test from 'node:test';
import assert from 'node:assert/strict';
import { findMarkers, readLayout, CARD, CARD_SIZES } from '../js/backs.js';
import { MARKERS, DECOY, CARD_MARKERS, REG_MARK, BEZEL, BEZEL_CODES } from '../js/markers.js';

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

// Paints bezel-layout card backs: the same mark in every corner (the bottom two turned
// round), a brass circle round the centre, and the ring of long and short ticks that
// is the card's code, drawn at `strength` (1 would be as bright as the circle). A
// card's `hide` lists corner marks to leave out: 0 top left, 1 top right, 2 bottom
// left, 3 bottom right.
function paintBezels(cards, size, w, h, pxPerMm, strength = 0.5) {
  const gray = new Uint8ClampedArray(w * h).fill(170);
  const M = CARD.marker, i = size.inset, mark = MARKERS[REG_MARK];
  const spots = [[i, i, false], [size.w - i - M, i, false], [i, size.h - i - M, true], [size.w - i - M, size.h - i - M, true]];
  const ink = 28 + Math.round(strength * 172), stepA = 2 * Math.PI / BEZEL.ticks;
  for (const { name, cx, cy, angle, hide = [] } of cards) {
    const code = BEZEL_CODES[name];
    const a = angle * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
    const half = Math.hypot(size.w, size.h) / 2 * pxPerMm;
    for (let y = Math.max(0, Math.floor(cy - half)); y < Math.min(h, cy + half); y++) {
      for (let x = Math.max(0, Math.floor(cx - half)); x < Math.min(w, cx + half); x++) {
        const dx = (x - cx) / pxPerMm, dy = (y - cy) / pxPerMm;
        const u = dx * cos + dy * sin + size.w / 2, v = -dx * sin + dy * cos + size.h / 2;
        if (u < 0 || v < 0 || u > size.w || v > size.h) continue;
        let value = 28;
        spots.forEach(([mx, my, flip], k) => {
          if (hide.includes(k)) return;
          let c = Math.floor(u - mx), r = Math.floor(v - my);
          if (c < 0 || r < 0 || c > 7 || r > 7) return;
          if (flip) { c = 7 - c; r = 7 - r; }
          if (r === 0 || r === 7 || c === 0 || c === 7 || mark[(r - 1) * 6 + c - 1] === '1') value = 200;
        });
        const ru = u - size.w / 2, rv = v - size.h / 2, rad = Math.hypot(ru, rv);
        if (Math.abs(rad - BEZEL.circle) <= 0.25) value = 200;
        else if (Math.abs(rad - BEZEL.ring) <= 0.125) value = ink;
        else if (rad >= BEZEL.long && rad <= BEZEL.ring) {
          let t = Math.atan2(ru, -rv);
          if (t < 0) t += 2 * Math.PI;
          const k = Math.round(t / stepA) % BEZEL.ticks;
          const off = Math.abs(((t - k * stepA + Math.PI) % (2 * Math.PI)) - Math.PI) * rad;
          if (off <= BEZEL.width / 2 && rad >= (code[k] === '1' ? BEZEL.long : BEZEL.short)) value = ink;
        }
        gray[y * w + x] = value;
      }
    }
  }
  return { gray, w, h };
}

const NAME_OF = Object.fromEntries(Object.entries(CARD_MARKERS).map(([n, id]) => [id, n]));
const NAMES = Object.keys(CARD_MARKERS);
const LAYOUT = [NAMES.slice(0, 5), NAMES.slice(5, 9), NAMES.slice(9, 14), NAMES.slice(14, 18), NAMES.slice(18)];

function table(size, P, gap, angleOf, strength) {
  const cards = [];
  LAYOUT.forEach((row, r) => row.forEach((name, c) => cards.push({
    name, cx: (20 + c * (size.w + gap) + size.w / 2) * P, cy: (20 + r * (size.h + 12) + size.h / 2) * P, angle: angleOf(r, c),
  })));
  return paintBezels(cards, size, Math.round((40 + 5 * size.w + 4 * gap) * P), Math.round((40 + 5 * size.h + 48) * P), P, strength);
}

for (const size of CARD_SIZES) {
  test(`reads every card of the bezel layout on ${size.name} cards, in rows, some lying the other way up`, () => {
    const res = readLayout(table(size, 5.5, 4, (r, c) => (r * 7 + c * 13) % 9 - 4 + ((r + c) % 3 === 0 ? 180 : 0), 0.5));
    assert.deepEqual(res.rows.map(row => row.map(c => NAME_OF[c.id])), LAYOUT);
    assert.deepEqual(res.doubles, []);
    assert.equal(res.unread.length, 0);
  });

  // The hardest spacing: cards all facing the same way, with gaps just wide enough that
  // one card's right-hand marks and the next card's left-hand marks line up exactly
  // like the corners of a card lying between them.
  test(`isn't fooled by marks of neighbouring ${size.name} cards lining up like a card between them`, () => {
    const gap = size.w - 4 * size.inset - 2 * CARD.marker;
    const res = readLayout(table(size, 5.5, gap, () => 0, 0.5));
    assert.deepEqual(res.rows.map(row => row.map(c => NAME_OF[c.id])), LAYOUT);
    assert.deepEqual(res.doubles, []);
    assert.equal(res.unread.length, 0);
  });
}

test('reads the ring when its ticks are faint', () => {
  const res = readLayout(table(CARD_SIZES[1], 6, 6, (r, c) => (r + c) % 2 ? 3 : -2, 0.22));
  assert.deepEqual(res.rows.map(row => row.map(c => NAME_OF[c.id])), LAYOUT);
  assert.ok(Math.max(...res.cards.map(c => c.errors)) <= 6, `up to ${Math.max(...res.cards.map(c => c.errors))} ticks misread`);
});

test('reads a card from the two marks down one side, placing it by its circle', () => {
  const size = CARD_SIZES[1], P = 6;
  for (const hide of [[1, 3], [0, 2], [2, 3], [0, 1]]) {
    const img = paintBezels([{ name: 'Rope', cx: 60 * P, cy: 70 * P, angle: 5, hide }], size, Math.round(120 * P), Math.round(140 * P), P);
    const res = readLayout(img);
    assert.deepEqual(res.cards.map(c => NAME_OF[c.id]), ['Rope'], `hiding corners ${hide}`);
    assert.equal(res.cards[0].markers, 2);
    assert.ok(Math.hypot(res.cards[0].centre[0] - 60 * P, res.cards[0].centre[1] - 70 * P) < 1.5 * P, 'centre within 1.5 mm');
  }
});

test('plain noise holds no cards', () => {
  const w = 600, h = 500, gray = new Uint8ClampedArray(w * h);
  let s = 777;
  for (let i = 0; i < gray.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; gray[i] = (s >> 8) & 255; }
  const res = readLayout({ gray, w, h });
  assert.equal(res.cards.length + res.unread.length, 0);
});
