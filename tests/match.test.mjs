import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, substringDistance, matchCard, isSure } from '../js/match.js';

const cards = ['Miss Scarlett', 'Colonel Mustard', 'Mrs White', 'Rope', 'Lead Piping', 'Ballroom', 'Hall', 'Billiard Room', 'Dining Room', 'Study']
  .map((name, i) => ({ id: 'c' + i, name }));
const read = t => matchCard(t, cards)?.card.name ?? null;

test('normalize keeps letters and fixes look-alike digits', () => {
  assert.equal(normalize('COLONEL\nMUSTARD!'), 'colonelmustard');
  assert.equal(normalize('R0PE'), 'rope');
});

test('substring distance', () => {
  assert.equal(substringDistance('rope', 'xxropexx'), 0);
  assert.equal(substringDistance('hall', 'ballroom'), 1);
});

test('reads names through line breaks, noise and small slips', () => {
  assert.equal(read('SUSPECT\nCOLONEL\nMUSTARD'), 'Colonel Mustard');
  assert.equal(read('| wswhite |'), 'Mrs White');
  assert.equal(read('WEAPON @® & J ROPE'), 'Rope');
  assert.equal(read('Lead Pipinq'), 'Lead Piping');
});

test('short names must be exact, so Ballroom is never Hall', () => {
  assert.equal(read('BALLROOM'), 'Ballroom');
  assert.equal(read('HALL'), 'Hall');
  assert.equal(read('BALL'), null);
});

test('garbage reads as nothing', () => {
  for (const t of ['', 'cea', 'Ia oll', '39. ®', 'EE', '[~F)', 'LATavys gop, L3asng']) assert.equal(read(t), null);
});

test('a short name read with low confidence is ignored', () => {
  const rooms = [{ id: 'r7', name: 'Hall' }, { id: 'w1', name: 'Lead Pipe' }];
  assert.equal(matchCard('[hall', rooms, [{ text: '[hall', confidence: 55 }]), null);
  assert.equal(matchCard('Hall', rooms, [{ text: 'Hall', confidence: 96 }]).card.name, 'Hall');
  assert.equal(matchCard('Lead Pipe', rooms, [{ text: 'Lead', confidence: 96 }, { text: 'Pipe', confidence: 92 }]).card.name, 'Lead Pipe');
});

test('only exact, confident reads of longer names are trusted on their own', () => {
  const deck = [{ id: 'w0', name: 'Candlestick' }, { id: 'w1', name: 'Rope' }];
  assert.ok(isSure(matchCard('Candlestick', deck, [{ text: 'Candlestick', confidence: 95 }])));
  assert.ok(!isSure(matchCard('Candlestlck', deck, [{ text: 'Candlestlck', confidence: 95 }])));
  assert.ok(!isSure(matchCard('Rope', deck, [{ text: 'Rope', confidence: 96 }])));
  assert.ok(!isSure(matchCard('Candlestick', deck)));
});
