import test from 'node:test';
import assert from 'node:assert/strict';
import { judge, slim, unslim, LOCK_READS } from '../js/live-scan.js';
import { readLayout, CARD_SIZES } from '../js/backs.js';
import { CARD_MARKERS } from '../js/markers.js';
import { paintBezels } from './paint.mjs';

const card = (id, mm = 7) => ({ id, centre: [0, 0], mm, markers: 4, ring: { c: [0, 0], M: [mm, 0, 0, mm] } });
const read = ({ cards = [], unread = [], markers = [], doubles = [], loose = [] } = {}) => ({ cards, unread, markers, doubles, loose, rows: [cards] });
const seen = (...ids) => read({ cards: ids.map(id => card(id)), markers: [{ id: 34 }] });

test('says when there is nothing to see, or only card corners', () => {
  assert.equal(judge([]).state, 'nothing');
  assert.equal(judge([read()]).state, 'nothing');
  assert.equal(judge([read({ markers: [{ id: 34 }] })]).state, 'partial');
});

test('locks once the same cards have read the same way, read after read', () => {
  const reads = [];
  for (let i = 1; i < LOCK_READS; i++) {
    reads.push(seen(3, 8, 15));
    assert.deepEqual([judge(reads).state, judge(reads).run], ['steadying', i]);
  }
  reads.push(seen(15, 3, 8));
  assert.equal(judge(reads).state, 'locked');
});

test('starts counting again when the cards change', () => {
  const reads = [seen(3, 8), seen(3, 8), seen(3, 8, 15)];
  assert.deepEqual([judge(reads).state, judge(reads).run], ['steadying', 1]);
});

test('never locks while a card in view can’t be read, and says how to fix it', () => {
  const blurred = read({ cards: [card(3), card(8)], unread: [{ centre: [0, 0], mm: 7, ring: {} }], markers: [{ id: 34 }] });
  const reads = [seen(3, 8), seen(3, 8), blurred];
  assert.deepEqual(judge(reads), { state: 'unclear', cards: blurred.cards, unread: 1, small: false });
  // A clear read after that starts the count from one.
  reads.push(seen(3, 8));
  assert.deepEqual([judge(reads).state, judge(reads).run], ['steadying', 1]);
  // Cards too small in the picture: move closer.
  const far = read({ unread: [{ centre: [0, 0], mm: 3.2, ring: {} }], markers: [{ id: 34 }] });
  assert.equal(judge([far]).small, true);
});

test('never locks while corner marks show a card it couldn’t read', () => {
  const mark = (whole, mm = 7) => ({ centre: [0, 0], mm, whole });
  // Two or more marks where a whole card would be in view: a card whose circle was lost.
  const hidden = read({ cards: [card(3)], markers: [{ id: 34 }], loose: [mark(true), mark(true), mark(true)] });
  assert.deepEqual([judge([hidden]).state, judge([hidden]).unread], ['unclear', 1]);
  const two = read({ cards: [card(3)], markers: [{ id: 34 }], loose: [mark(true), mark(true), mark(true), mark(true), mark(true), mark(true), mark(true), mark(true)] });
  assert.equal(judge([two]).unread, 2);
  // Marks of a card cut off by the edge of the picture don't hold the scan up.
  const edge = read({ cards: [card(3)], markers: [{ id: 34 }], loose: [mark(false), mark(false), mark(true)] });
  assert.equal(judge([edge, edge, edge]).state, 'locked');
});

test('never locks while a card seems to be in two places', () => {
  const twice = read({ cards: [card(3), card(3)], markers: [{ id: 34 }], doubles: [3] });
  assert.equal(judge([seen(3), seen(3), twice]).state, 'unclear');
});

test('a reading survives the trip from the worker, and locks', () => {
  const size = CARD_SIZES[1], P = 6, names = Object.keys(CARD_MARKERS).slice(4, 10);
  const cards = names.map((name, i) => ({ name, cx: (20 + (i % 3) * 64 + size.w / 2) * P, cy: (20 + Math.floor(i / 3) * 96 + size.h / 2) * P, angle: i * 7 - 18 }));
  const img = paintBezels(cards, size, Math.round(230 * P), Math.round(230 * P), P);
  const res = readLayout(img);
  // postMessage copies with the structured clone algorithm.
  const back = unslim(structuredClone(slim(res)));
  assert.deepEqual(back.rows.map(r => r.map(c => c.id)), res.rows.map(r => r.map(c => c.id)));
  assert.ok(back.cards.every(c => c.ring && typeof c.errors === 'number'));
  const verdict = judge([back, back, back]);
  assert.equal(verdict.state, 'locked');
  const nameOf = Object.fromEntries(Object.entries(CARD_MARKERS).map(([n, id]) => [id, n]));
  assert.deepEqual(verdict.cards.map(c => nameOf[c.id]).sort(), names.slice().sort());
});
