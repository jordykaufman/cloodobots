import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTracker, slim, unslim, SETTLE_MS, CONFIRM_WITHIN } from '../js/live-scan.js';
import { readLayout, CARD_SIZES } from '../js/backs.js';
import { CARD_MARKERS } from '../js/markers.js';
import { paintBezels } from './paint.mjs';

const card = (id, mm = 7) => ({ id, centre: [0, 0], mm, markers: 4, ring: { c: [0, 0], M: [mm, 0, 0, mm] } });
const read = ({ cards = [], unread = [], markers = [{ id: 34 }], doubles = [], loose = [] } = {}) => ({ cards, unread, markers, doubles, loose, rows: [cards] });
const seen = (...ids) => read({ cards: ids.map(id => card(id)) });
const counted = tracker => [...tracker.found.keys()].sort((a, b) => a - b);

// Feeds reads to a tracker, one every `gap` ms, and returns the last verdict.
function feed(tracker, reads, start = 0, gap = 200) {
  let v;
  reads.forEach((r, i) => { v = tracker.add(r, start + i * gap); });
  return v;
}

test('says when there is nothing to see, or only card corners', () => {
  const t = makeTracker();
  assert.equal(t.add(read({ markers: [] }), 0).state, 'nothing');
  assert.equal(t.add(read(), 100).state, 'partial');
});

test('counts a card once it has been read twice, then locks when nothing new turns up for a second', () => {
  const t = makeTracker();
  assert.deepEqual(t.add(seen(3, 8), 0), { state: 'collecting', count: 0 });
  assert.equal(t.add(seen(3, 8), 200).state, 'settling');
  assert.deepEqual(counted(t), [3, 8]);
  const v = t.add(seen(3, 8), 200 + SETTLE_MS / 2);
  assert.deepEqual([v.state, v.settle], ['settling', 0.5]);
  assert.equal(t.add(seen(3, 8), 200 + SETTLE_MS).state, 'locked');
});

test('a card read only once, or twice too far apart, doesn’t count', () => {
  const t = makeTracker();
  const reads = [seen(3, 15), seen(3), seen(3), seen(3), seen(3), seen(3), seen(3, 15)];
  assert.equal(reads.length - 1, CONFIRM_WITHIN + 1);
  feed(t, reads);
  assert.deepEqual(counted(t), [3]);
});

test('keeps counting across views, so the phone can move over the table', () => {
  const t = makeTracker();
  feed(t, [seen(1, 2, 3), seen(1, 2, 3), seen(3, 4, 5), seen(3, 4, 5), seen(6), seen(6)]);
  assert.deepEqual(counted(t), [1, 2, 3, 4, 5, 6]);
  // A new card restarts the wait.
  assert.equal(t.add(seen(6), 5 * 200 + SETTLE_MS - 1).state, 'settling');
  assert.equal(t.add(seen(6), 5 * 200 + SETTLE_MS).state, 'locked');
});

test('waits while a card in view hasn’t been counted yet', () => {
  const t = makeTracker();
  feed(t, [seen(3), seen(3)]);
  assert.equal(t.add(seen(3, 9), 5000).state, 'collecting');
  assert.equal(t.add(seen(3, 9), 5200).state, 'settling');
});

test('never locks while a card in view can’t be read, and says how to fix it', () => {
  const t = makeTracker();
  feed(t, [seen(3, 8), seen(3, 8)]);
  const blurred = read({ cards: [card(3)], unread: [{ centre: [0, 0], mm: 7, ring: {} }] });
  assert.deepEqual(t.add(blurred, 5000), { state: 'unclear', count: 2, unread: 1, small: false });
  // Corner marks of a card whose compass glare has washed out.
  const mark = whole => ({ centre: [0, 0], mm: 7, whole });
  const washed = read({ cards: [card(3), card(8)], loose: [mark(true), mark(true), mark(true), mark(true)] });
  assert.deepEqual([t.add(washed, 5200).state, t.add(washed, 5400).unread], ['unclear', 1]);
  // Marks of a card cut off by the edge of the picture don't hold the scan up.
  const edge = read({ cards: [card(3), card(8)], loose: [mark(false), mark(false)] });
  assert.equal(t.add(edge, 5600).state, 'locked');
  // Cards too small in the picture: move closer.
  const far = read({ unread: [{ centre: [0, 0], mm: 2.5, ring: {} }] });
  assert.equal(makeTracker().add(far, 0).small, true);
});

test('a card seen in two places at once doesn’t count from that read', () => {
  const t = makeTracker();
  const twice = read({ cards: [card(3), card(3)], doubles: [3] });
  assert.equal(feed(t, [twice, twice, twice]).state, 'unclear');
  assert.deepEqual(counted(t), []);
});

test('a reading survives the trip from the worker, and counts', () => {
  const size = CARD_SIZES[1], P = 6, names = Object.keys(CARD_MARKERS).slice(4, 10);
  const cards = names.map((name, i) => ({ name, cx: (20 + (i % 3) * 64 + size.w / 2) * P, cy: (20 + Math.floor(i / 3) * 96 + size.h / 2) * P, angle: i * 7 - 18 }));
  const img = paintBezels(cards, size, Math.round(230 * P), Math.round(230 * P), P);
  const res = readLayout(img);
  // postMessage copies with the structured clone algorithm.
  const back = unslim(structuredClone(slim(res)));
  assert.deepEqual(back.rows.map(r => r.map(c => c.id)), res.rows.map(r => r.map(c => c.id)));
  assert.ok(back.cards.every(c => c.ring && typeof c.errors === 'number'));
  const t = makeTracker();
  assert.equal(feed(t, [back, back, back, back, back, back, back]).state, 'locked');
  const nameOf = Object.fromEntries(Object.entries(CARD_MARKERS).map(([n, id]) => [id, n]));
  assert.deepEqual(counted(t).map(id => nameOf[id]).sort(), names.slice().sort());
});
