import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTracker, slim, unslim, SETTLE_MS, CONFIRM_WITHIN, SURE_ERRORS } from '../js/live-scan.js';
import { readLayout, CARD_SIZES } from '../js/backs.js';
import { CARD_MARKERS } from '../js/markers.js';
import { paintBezels } from './paint.mjs';

// A card where the reader would see it: each in its own place, the same in every read.
const card = (id, mm = 7) => ({ id, centre: [100 + (id % 5) * 70 * mm, 120 + Math.floor(id / 5) * 100 * mm], axis: [0, 1], mm, markers: 4, ring: { c: [0, 0], M: [mm, 0, 0, mm] } });
const read = ({ cards = [], unread = [], markers = [{ id: 34 }], doubles = [], loose = [] } = {}) => ({ cards, unread, markers, doubles, loose, rows: [cards], size: [1440, 2160] });
const seen = (...ids) => read({ cards: ids.map(id => card(id)) });
const counted = tracker => [...tracker.found.keys()].sort((a, b) => a - b);
// A verdict without the map and the list of cards it carries.
const plain = ({ map, ids, ...v }) => v;

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
  assert.deepEqual(plain(t.add(seen(3, 8), 0)), { state: 'collecting', count: 0 });
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
  assert.deepEqual(plain(t.add(blurred, 5000)), { state: 'unclear', count: 2, unread: 1, small: false });
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

test('doesn’t lock while the phone is moving, even with nothing new in view', () => {
  const t = makeTracker();
  feed(t, [seen(3, 8), seen(3, 8)]);
  // The same two cards, sliding across the picture as the phone moves: 7 mm a read.
  let v;
  for (let i = 1; i <= 10; i++) {
    const moved = seen(3, 8);
    moved.cards.forEach(c => { c.centre = [c.centre[0], c.centre[1] - i * 7 * 7]; });
    v = t.add(moved, 400 + i * 200);
  }
  assert.equal(v.state, 'settling');
  assert.ok(v.settle < 0.5, `settle ${v.settle}`);
  // Held still: it locks a second later.
  const held = seen(3, 8);
  held.cards.forEach(c => { c.centre = [c.centre[0], c.centre[1] - 70 * 7]; });
  assert.equal(t.add(held, 2600).state, 'settling');
  assert.equal(t.add(held, 2600 + SETTLE_MS).state, 'locked');
});

test('counts a card on one clean read, but needs two when its ring read roughly', () => {
  const t = makeTracker();
  const clean = card(3), rough = card(8);
  clean.errors = SURE_ERRORS;
  rough.errors = SURE_ERRORS + 4;
  const v = t.add(read({ cards: [clean, rough] }), 0);
  assert.deepEqual(v.ids, [3]);
  assert.deepEqual(t.add(read({ cards: [clean, rough] }), 200).ids, [3, 8]);
});

test('told how many cards to find, stops the moment it has them, moving or not', () => {
  const t = makeTracker({ expected: 3 });
  feed(t, [seen(1, 2), seen(1, 2)]);
  const v = t.add(seen(2, 9), 400);
  assert.equal(v.state, 'collecting');
  // The third card counts on its second read: done, though the view has just moved and
  // there's a card it can't read at the edge.
  const last = read({ cards: [card(9), card(2)], unread: [{ centre: [0, 0], mm: 7, ring: {} }] });
  last.cards.forEach(c => { c.centre = [c.centre[0] + 300, c.centre[1]]; });
  assert.deepEqual(plain(t.add(last, 600)), { state: 'locked', count: 3, complete: true });
  // Looking for more than are there, holding still doesn't end it.
  const short = makeTracker({ expected: 5 });
  const v2 = feed(short, Array.from({ length: 20 }, () => seen(1, 2)));
  assert.equal(v2.state, 'settling');
});
