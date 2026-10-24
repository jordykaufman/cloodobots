import test from 'node:test';
import assert from 'node:assert/strict';
import { newState, dispatch, modelFor, dealCounts, validateSetup, seatsAfter, HOST } from '../js/engine.js';

const ids = g => g.seats.map(s => s.id);
const people = g => g.seats.filter(s => !s.robot);
const robots = g => g.seats.filter(s => s.robot);
const ok = r => assert.ok(r.ok, r.error);

function physicalGame({ scan = true } = {}) {
  const st = newState();
  ok(dispatch(st, HOST, { type: 'start' }));
  const g = st.game;
  const env = { suspect: 's2', weapon: 'w3', room: 'r4' };
  if (scan) ok(dispatch(st, HOST, { type: 'scanDone', envelope: env }));
  else ok(dispatch(st, HOST, { type: 'scanSkip' }));
  ok(dispatch(st, HOST, { type: 'dealt' }));
  // The envelope cards are set aside before dealing, scanned or not.
  const free = g.deck.map(c => c.id).filter(id => !Object.values(env).includes(id));
  let k = 0;
  for (const p of people(g)) {
    const n = g.counts[p.id];
    ok(dispatch(st, HOST, { type: 'hand', seat: p.id, cards: free.slice(k, k + n) }));
    k += n;
  }
  return { st, g, env };
}

test('cards are dealt evenly, extras to robots first', () => {
  const seats = [{ id: 'a' }, { id: 'b', robot: true }, { id: 'c' }, { id: 'd', robot: true }];
  assert.deepEqual(dealCounts(seats, 18), { a: 4, b: 5, c: 4, d: 5 });
  assert.deepEqual(dealCounts(seats.slice(0, 3), 18), { a: 6, b: 6, c: 6 });
});

test('setup validation catches duplicate names and empty lists', () => {
  const st = newState();
  assert.equal(validateSetup(st.setup), null);
  st.setup.seats[2].name = 'player 1';
  assert.match(validateSetup(st.setup), /Two players/);
  st.setup.seats[2].name = 'Player 2';
  st.setup.cards.weapon = ['Rope'];
  assert.match(validateSetup(st.setup), /weapons list/);
});

test('scanned envelope becomes the answer and robots get exactly the rest', () => {
  const { g, env } = physicalGame({ scan: true });
  assert.equal(g.phase, 'play');
  assert.deepEqual(g.solution, env);
  const all = g.seats.flatMap(s => s.hand).concat(Object.values(g.solution));
  assert.equal(new Set(all).size, g.deck.length);
  for (const r of robots(g)) assert.equal(r.hand.length, g.counts[r.id]);
});

test('without a scan the answer comes from cards nobody holds', () => {
  const { g } = physicalGame({ scan: false });
  assert.equal(g.phase, 'play');
  const held = people(g).flatMap(p => p.hand);
  for (const id of Object.values(g.solution)) assert.ok(!held.includes(id));
  const all = g.seats.flatMap(s => s.hand).concat(Object.values(g.solution));
  assert.equal(new Set(all).size, g.deck.length);
});

test('a hand that includes an envelope card sends everyone back to check', () => {
  const st = newState();
  ok(dispatch(st, HOST, { type: 'start' }));
  ok(dispatch(st, HOST, { type: 'scanDone', envelope: { suspect: 's0', weapon: 'w0', room: 'r0' } }));
  ok(dispatch(st, HOST, { type: 'dealt' }));
  const [p1, p2] = people(st.game);
  ok(dispatch(st, HOST, { type: 'hand', seat: p1.id, cards: ['s0', 's1', 'w1', 'r1'] }));
  ok(dispatch(st, HOST, { type: 'hand', seat: p2.id, cards: ['s2', 'w2', 'r2', 'r3'] }));
  assert.equal(st.game.phase, 'hands');
  assert.equal(st.game.dealError.kind, 'mismatch');
  assert.deepEqual(st.game.submitted, {});
  assert.deepEqual(st.game.entries[p1.id], ['s0', 's1', 'w1', 'r1']);
});

test('suggestions go clockwise and stop at the first player with a card', () => {
  const { st, g } = physicalGame();
  const [p1, b1, p2, b2] = g.seats;
  // Ask about one card held by the second person and one held by the second robot.
  const pick = (seat, cat) => seat.hand.find(id => id[0] === cat[0]);
  const s = pick(p2, 'suspect') || pick(b2, 'suspect') || g.solution.suspect;
  const w = pick(b2, 'weapon') || g.solution.weapon;
  const r = g.solution.room;
  const picks = [s, w, r];
  ok(dispatch(st, HOST, { type: 'suggest', by: p1.id, picks }));
  const e = g.log.at(-1);
  const expect = seatsAfter(g, p1.id).find(x => x.hand.some(id => picks.includes(id)));
  assert.equal(e.disprover, expect ? expect.id : null);
  assert.equal(e.steps.at(-1).can, !!expect);
  assert.ok(e.steps.slice(0, -1).every(x => !x.can));
  assert.deepEqual(ids(g).indexOf(e.steps[0].seat), 1);
});

test('a cagey robot shows the same card again when it can', () => {
  const { st, g } = physicalGame();
  const [p1, bot] = g.seats;
  const two = bot.hand.filter(id => id[0] === 'w' || id[0] === 'r').slice(0, 2);
  if (two.length < 2) return; // deal didn't give this robot two usable cards
  const sus = g.solution.suspect;
  const picksFor = ids2 => {
    const w = ids2.find(id => id[0] === 'w') || g.solution.weapon;
    const r = ids2.find(id => id[0] === 'r') || g.solution.room;
    return [sus, w, r];
  };
  ok(dispatch(st, HOST, { type: 'suggest', by: p1.id, picks: picksFor([two[0]]) }));
  const first = g.shown.at(-1).card;
  ok(dispatch(st, HOST, { type: 'suggest', by: p1.id, picks: picksFor(two) }));
  if (two.includes(first)) assert.equal(g.shown.at(-1).card, first);
});

test('a wrong accusation puts a player out; a right one ends the game', () => {
  const { st, g } = physicalGame();
  const [p1, , p2] = g.seats;
  const sol = [g.solution.suspect, g.solution.weapon, g.solution.room];
  const wrongW = g.deck.find(c => c.cat === 'weapon' && c.id !== g.solution.weapon).id;
  ok(dispatch(st, HOST, { type: 'accuse', by: p2.id, picks: [sol[0], wrongW, sol[2]] }));
  assert.ok(p2.out);
  assert.ok(dispatch(st, HOST, { type: 'suggest', by: p2.id, picks: sol }).error);
  ok(dispatch(st, HOST, { type: 'accuse', by: p1.id, picks: sol }));
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, p1.id);
});

test('another phone only sees its own hand, and never the answer mid-game', () => {
  const st = newState();
  st.setup.dealMode = 'app';
  const [p1, , p2] = st.setup.seats;
  ok(dispatch(st, 'phone-b', { type: 'claim', seat: p2.id }));
  ok(dispatch(st, HOST, { type: 'start' }));
  const online = new Set(['phone-b']);
  const m = modelFor(st, 'phone-b', online);
  assert.deepEqual(m.mine, [p2.id]);
  assert.deepEqual(Object.keys(m.priv), [p2.id]);
  assert.equal(m.game.solution, null);
  assert.equal(m.game.hands, null);
  const text = JSON.stringify(m);
  for (const s of st.game.seats.filter(x => x.id !== p2.id)) for (const id of s.hand) {
    assert.ok(!text.includes(`"hand":["${id}`) && !m.priv[p2.id].hand.includes(id));
  }
  const hostView = modelFor(st, HOST, online);
  assert.deepEqual(hostView.mine, [p1.id]);
  // Seat control is enforced.
  assert.ok(dispatch(st, HOST, { type: 'suggest', by: p2.id, picks: ['s0', 'w0', 'r0'] }).error);
});

test('a person who has to show a card chooses it when the app dealt', () => {
  const st = newState();
  st.setup.dealMode = 'app';
  ok(dispatch(st, HOST, { type: 'start' }));
  const g = st.game;
  const [p1, b1, p2] = g.seats;
  const card = p2.hand.find(id => !b1.hand.includes(id));
  const cat = g.deck.find(c => c.id === card).cat;
  const picks = ['suspect', 'weapon', 'room'].map(c => c === cat ? card : g.solution[c]);
  ok(dispatch(st, HOST, { type: 'suggest', by: p1.id, picks }));
  const e = g.log.at(-1);
  if (e.disprover !== p2.id) return; // the robot between them held a card too
  const m = modelFor(st, HOST);
  assert.equal(m.priv[p2.id].pick.n, e.n);
  ok(dispatch(st, HOST, { type: 'pick', n: e.n, card }));
  assert.equal(modelFor(st, HOST).priv[p1.id].shown.at(-1).card, card);
  assert.ok(dispatch(st, HOST, { type: 'pick', n: e.n, card }).error);
});

test('a seat held by a phone that has gone away can be claimed by another', () => {
  const st = newState();
  const p2 = st.setup.seats[2];
  ok(dispatch(st, 'phone-a', { type: 'claim', seat: p2.id }));
  assert.ok(dispatch(st, 'phone-b', { type: 'claim', seat: p2.id }, new Set(['phone-a'])).error);
  ok(dispatch(st, 'phone-b', { type: 'claim', seat: p2.id }, new Set(['phone-b'])));
  assert.equal(st.claims[p2.id], 'phone-b');
});
