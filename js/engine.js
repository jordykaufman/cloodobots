// Game rules and state. This runs only on the host phone, the one place that knows the
// robots' cards and the answer. Every phone, the host included, draws its screens from
// modelFor(), which leaves out anything that phone's players shouldn't see.

import { CARD_MARKERS } from './markers.js';

export const CATS = ['suspect', 'weapon', 'room'];
export const CAT = { suspect: 'Suspect', weapon: 'Weapon', room: 'Room' };
export const CATS_PL = { suspect: 'Suspects', weapon: 'Weapons', room: 'Rooms' };
const ROOMS = ['Kitchen', 'Ballroom', 'Conservatory', 'Dining Room', 'Billiard Room', 'Library', 'Lounge', 'Hall', 'Study'];
export const EDITIONS = {
  clue2013: { label: 'Clue (2013)', art: 'cards/clue2013/', cards: {
    suspect: ['Scarlet', 'Mustard', 'White', 'Green', 'Peacock', 'Plum'],
    weapon: ['Candlestick', 'Dagger', 'Lead Pipe', 'Pistol', 'Rope', 'Wrench'],
    room: ['Bathroom', 'Bedroom', 'Courtyard', 'Dining Room', 'Game Room', 'Garage', 'Kitchen', 'Living Room', 'Office'] } },
  cluedo: { label: 'Cluedo (classic)', cards: {
    suspect: ['Miss Scarlett', 'Colonel Mustard', 'Mrs White', 'Reverend Green', 'Mrs Peacock', 'Professor Plum'],
    weapon: ['Candlestick', 'Dagger', 'Lead Piping', 'Revolver', 'Rope', 'Spanner'],
    room: ROOMS } },
  clue: { label: 'Clue (classic US)', cards: {
    suspect: ['Miss Scarlet', 'Colonel Mustard', 'Mrs. White', 'Mr. Green', 'Mrs. Peacock', 'Professor Plum'],
    weapon: ['Candlestick', 'Knife', 'Lead Pipe', 'Revolver', 'Rope', 'Wrench'],
    room: ROOMS } },
};
// Photos of a deck's cards, where we have them: cards/<deck>/<type>_<name>.jpg, e.g.
// cards/clue2013/room_dining_room.jpg. Every 2013 card has one, beach rooms included.
const ART_FILES = {
  'cards/clue2013/': ['Scarlet', 'Mustard', 'White', 'Green', 'Peacock', 'Plum', 'Candlestick', 'Dagger', 'Lead Pipe', 'Pistol', 'Rope', 'Wrench',
    'Arcade', 'Bathroom', 'Beach', 'Beach House', 'Bedroom', 'Courtyard', 'Dining Room', 'Ferris Wheel', 'Game Room', 'Garage', 'Jet Ski Rental', 'Kitchen', 'Living Room', 'Office', 'Surf Shop'],
};
function artFor(edition, card) {
  const dir = EDITIONS[edition] && EDITIONS[edition].art;
  if (!dir || !ART_FILES[dir].includes(card.name)) return null;
  return `${dir}${card.cat}_${card.name.toLowerCase().replace(/[^a-z]+/g, '_')}.jpg`;
}

export const ROBOT_NAMES = ['Butler Bot', 'Lady Gigabyte', 'Sergeant Sprocket', 'Professor Pixel', 'Madame Modem', 'Captain Circuit'];
export const HOST = 'host';

/* ---------- small helpers ---------- */
export function rand(n) {
  try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; }
  catch (e) { return Math.floor(Math.random() * n); }
}
const pick = a => a[rand(a.length)];
export function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export const uid = () => Math.random().toString(36).slice(2, 9);
export const clone = o => JSON.parse(JSON.stringify(o));
export const cleanList = l => (l || []).map(x => String(x).trim()).filter(Boolean);

/* ---------- setup ---------- */
export function freshSetup() {
  return {
    edition: 'clue2013',
    cards: clone(EDITIONS.clue2013.cards),
    seats: [
      { id: uid(), name: 'Player 1', robot: false },
      { id: uid(), name: ROBOT_NAMES[0], robot: true },
      { id: uid(), name: 'Player 2', robot: false },
      { id: uid(), name: ROBOT_NAMES[1], robot: true },
    ],
    dealMode: 'physical',
    robotStyle: 'cagey',
    phones: 'one',
  };
}

export function newState() {
  return { setup: freshSetup(), game: null, claims: {}, rev: 1 };
}

export function nextName(setup, robot) {
  const used = new Set(setup.seats.map(s => s.name.trim().toLowerCase()));
  if (robot) { const n = ROBOT_NAMES.find(x => !used.has(x.toLowerCase())); if (n) return n; }
  for (let i = 1; ; i++) { const n = robot ? `Robot ${i}` : `Player ${i}`; if (!used.has(n.toLowerCase())) return n; }
}

// How many cards each seat is dealt. The people always get the same number as each
// other when there are robots to take up the difference, and the hands are kept as even
// as that allows: the people get whichever of the two nearest even shares leaves the
// hands most even (on a tie, the smaller), and the robots share out the rest, each
// getting at least one card. With 2 people and 2 robots that's 4 each and 5 each; with
// 4 people and 1 robot, 4 each and 2. With no robots, the first seats get the extra cards.
export function dealCounts(seats, nCards) {
  const people = seats.filter(s => !s.robot), robots = seats.filter(s => s.robot);
  const base = Math.floor(nCards / seats.length), counts = {};
  if (!people.length || !robots.length) {
    let extra = nCards % seats.length;
    seats.forEach(s => { counts[s.id] = base + (extra-- > 0 ? 1 : 0); });
    return counts;
  }
  const even = nCards / seats.length;
  let best = null;
  for (const each of [base, base + 1]) {
    const rest = nCards - each * people.length;
    if (rest < robots.length) continue;
    const bot = i => Math.floor(rest / robots.length) + (i < rest % robots.length ? 1 : 0);
    const spread = people.length * (each - even) ** 2 + robots.reduce((t, r, i) => t + (bot(i) - even) ** 2, 0);
    if (!best || spread < best.spread - 1e-9) best = { each, bot, spread };
  }
  people.forEach(p => { counts[p.id] = best.each; });
  robots.forEach((r, i) => { counts[r.id] = best.bot(i); });
  return counts;
}

// Whether the game's cards are the printed deck, whose backs the camera can read
// (markers.js): Clue 2013's cards, with the dagger and pistol.
export function printedDeck(setup) {
  const names = CATS.flatMap(cat => cleanList(setup.cards[cat]));
  const want = Object.keys(CARD_MARKERS);
  return names.length === want.length && want.every(n => names.includes(n));
}

export function deckSize(setup) {
  return CATS.reduce((a, c) => a + cleanList(setup.cards[c]).length, 0);
}

// Plain-text problem with the setup, or null when it's ready to start.
export function validateSetup(setup) {
  const seats = setup.seats;
  if (seats.length < 2) return 'Add at least two players.';
  if (!seats.some(s => !s.robot)) return 'Add at least one person. Robots can’t play on their own yet.';
  if (seats.length > 10) return 'That’s more than ten players. Remove a few.';
  const names = seats.map(s => s.name.trim());
  if (names.some(n => !n)) return 'Give every player a name.';
  const lower = names.map(n => n.toLowerCase());
  const dupName = names.find((n, i) => lower.indexOf(n.toLowerCase()) !== i);
  if (dupName) return `Two players are called “${dupName}”. Give each one a different name.`;
  const all = [];
  for (const cat of CATS) {
    const l = cleanList(setup.cards[cat]);
    if (l.length < 2) return `The ${CATS_PL[cat].toLowerCase()} list needs at least two cards.`;
    all.push(...l);
  }
  const allLower = all.map(x => x.toLowerCase());
  const dupCard = all.find((n, i) => allLower.indexOf(n.toLowerCase()) !== i);
  if (dupCard) return `“${dupCard}” is in the card lists twice. Each card needs its own name.`;
  if (all.length - 3 < seats.length) return `There aren’t enough cards for ${seats.length} players. Remove a player or add cards.`;
  if (setup.dealMode === 'backs' && !printedDeck(setup)) return 'Scanning the card backs needs the printed deck. Choose the Clue (2013) cards, or another way to deal.';
  return null;
}

/* ---------- who controls which seat ---------- */
// A person's seat belongs to the phone that claimed it, or to the host phone if nobody did.
export function controls(state, deviceId, seatId) {
  const owner = state.claims[seatId];
  return owner ? owner === deviceId : deviceId === HOST;
}
function seatList(state) {
  return state.game ? state.game.seats : state.setup.seats;
}
export function seatsOf(state, deviceId) {
  return seatList(state).filter(s => !s.robot && controls(state, deviceId, s.id)).map(s => s.id);
}
// Drop claims on seats that no longer exist or have become robots.
export function tidyClaims(state) {
  const people = new Set(seatList(state).filter(s => !s.robot).map(s => s.id));
  for (const id of Object.keys(state.claims)) if (!people.has(id)) delete state.claims[id];
}

/* ---------- dealing ---------- */
export function startGame(state) {
  const st = state.setup;
  const deck = [];
  CATS.forEach(cat => cleanList(st.cards[cat]).forEach((name, i) => deck.push({ id: cat[0] + i, name, cat })));
  for (const c of deck) { const art = artFor(st.edition, c); if (art) c.art = art; }
  const seats = st.seats.map(s => ({ id: s.id, name: s.name.trim(), robot: s.robot, hand: [], out: false }));
  const g = {
    deck, seats, counts: dealCounts(seats, deck.length - 3),
    dealMode: st.dealMode, robotStyle: st.robotStyle,
    phase: 'deal', scan: 'pending', envelope: null, solution: null, scanned: null,
    entries: {}, submitted: {}, dealError: null,
    log: [], shown: [], lastBy: null, winner: null,
  };
  state.game = g;
  tidyClaims(state);
  if (g.dealMode === 'app') dealEverything(g);
}

function sortHand(g, ids) {
  const order = g.deck.map(c => c.id);
  return ids.slice().sort((x, y) => order.indexOf(x) - order.indexOf(y));
}

// The app deals: pick the envelope, then deal the rest around the table.
function dealEverything(g) {
  const sol = {};
  CATS.forEach(cat => { sol[cat] = pick(g.deck.filter(c => c.cat === cat)).id; });
  g.solution = sol;
  const solIds = Object.values(sol);
  const rest = shuffle(g.deck.map(c => c.id).filter(id => !solIds.includes(id)));
  let k = 0;
  g.seats.forEach(s => { const n = g.counts[s.id]; s.hand = sortHand(g, rest.slice(k, k + n)); k += n; });
  g.phase = 'play';
}

// Real cards: the people have typed in their hands. If the envelope was scanned, the
// robots get exactly the cards that are neither in it nor in anyone's hand. If it wasn't,
// the app picks the answer from the cards nobody holds; that gives the same odds as the
// paper envelope, which could only ever hold cards nobody was dealt.
function finishHands(g) {
  const people = g.seats.filter(s => !s.robot);
  const held = people.flatMap(p => g.entries[p.id] || []);
  const env = g.envelope ? Object.values(g.envelope) : [];
  const fail = err => {
    g.dealError = err;
    g.submitted = {};
  };
  if (new Set(held).size !== held.length || held.some(id => env.includes(id))) return fail({ kind: 'mismatch' });
  const free = g.deck.filter(c => !held.includes(c.id) && !env.includes(c.id));
  let sol = g.envelope;
  if (!sol) {
    sol = {};
    for (const cat of CATS) {
      const opts = free.filter(c => c.cat === cat);
      if (!opts.length) return fail({ kind: 'missing', cat });
      sol[cat] = pick(opts).id;
    }
  }
  const solIds = Object.values(sol);
  const rest = shuffle(free.map(c => c.id).filter(id => !solIds.includes(id)));
  const robots = g.seats.filter(s => s.robot);
  if (rest.length !== robots.reduce((a, r) => a + g.counts[r.id], 0)) return fail({ kind: 'mismatch' });
  g.solution = { ...sol };
  people.forEach(p => { p.hand = sortHand(g, g.entries[p.id]); });
  let k = 0;
  robots.forEach(r => { const n = g.counts[r.id]; r.hand = sortHand(g, rest.slice(k, k + n)); k += n; });
  g.dealError = null;
  g.phase = 'play';
}

/* ---------- robots ---------- */
// A robot that can disprove shows one matching card. "Cagey" robots reuse a card they've
// already shown (to this asker first, then to anyone) so they give away as little as possible.
export function robotChoice(g, bot, matches, to) {
  if (g.robotStyle === 'cagey') {
    const mine = g.shown.filter(x => x.from === bot.id);
    const again = matches.filter(id => mine.some(x => x.to === to && x.card === id));
    if (again.length) return pick(again);
    const before = matches.filter(id => mine.some(x => x.card === id));
    if (before.length) return pick(before);
  }
  return pick(matches);
}

/* ---------- play ---------- */
export function seatsAfter(g, id) {
  const i = g.seats.findIndex(s => s.id === id);
  return g.seats.slice(i + 1).concat(g.seats.slice(0, i));
}

function runSuggestion(g, by, picks) {
  const steps = [];
  let disprover = null, matches = [];
  for (const s of seatsAfter(g, by)) {
    const m = s.hand.filter(id => picks.includes(id));
    steps.push({ seat: s.id, can: m.length > 0 });
    if (m.length) { disprover = s.id; matches = m; break; }
  }
  const n = g.log.filter(e => e.type === 'suggest').length + 1;
  g.log.push({ type: 'suggest', n, by, picks, steps, disprover });
  g.lastBy = by;
  const d = disprover && g.seats.find(s => s.id === disprover);
  if (d && d.robot) g.shown.push({ n, from: d.id, to: by, card: robotChoice(g, d, matches, by) });
  return n;
}

// A suggestion this person has to answer by choosing a card (only when the app dealt).
function pendingPick(g, seatId) {
  if (g.dealMode !== 'app') return null;
  const e = g.log.find(x => x.type === 'suggest' && x.disprover === seatId && !g.shown.some(s => s.n === x.n));
  if (!e) return null;
  const seat = g.seats.find(s => s.id === seatId);
  return { n: e.n, to: e.by, matches: seat.hand.filter(id => e.picks.includes(id)) };
}

function validPicks(g, picks) {
  return Array.isArray(picks) && picks.length === 3 &&
    CATS.every((cat, i) => g.deck.some(c => c.id === picks[i] && c.cat === cat));
}

/* ---------- actions ---------- */
// Applies one action from one phone. Returns { ok: true } or { error: 'what went wrong' }.
// `online` is the set of phones currently connected, so a seat held by a phone that has
// gone away can be picked up by another.
export function dispatch(state, deviceId, a, online = new Set()) {
  const g = state.game;
  const isHost = deviceId === HOST;
  const seat = id => g && g.seats.find(s => s.id === id);
  const own = id => controls(state, deviceId, id);
  const done = () => { state.rev = (state.rev || 0) + 1; return { ok: true }; };
  const no = error => ({ error });

  switch (a && a.type) {
    case 'claim': {
      if (isHost) return no('The host phone already holds every unclaimed seat.');
      const s = seatList(state).find(x => x.id === a.seat && !x.robot);
      if (!s) return no('That seat isn’t a person’s seat.');
      const holder = state.claims[a.seat];
      if (holder && holder !== deviceId && online.has(holder)) return no(`${s.name} is already on another phone.`);
      for (const [id, d] of Object.entries(state.claims)) if (d === deviceId) delete state.claims[id];
      state.claims[a.seat] = deviceId;
      return done();
    }
    case 'release': {
      if (!isHost && state.claims[a.seat] !== deviceId) return no('That seat isn’t on this phone.');
      delete state.claims[a.seat];
      return done();
    }
    case 'start': {
      if (!isHost) return no('Only the host phone can start the game.');
      if (g && g.phase !== 'over') return no('A game is already running.');
      const err = validateSetup(state.setup);
      if (err) return no(err);
      startGame(state);
      return done();
    }
    case 'scanDone': {
      if (!isHost || !g || g.phase !== 'deal') return no('The envelope can’t be scanned now.');
      const env = a.envelope || {};
      if (!CATS.every(cat => g.deck.some(c => c.id === env[cat] && c.cat === cat))) return no('The envelope needs one suspect, one weapon and one room.');
      g.envelope = { suspect: env.suspect, weapon: env.weapon, room: env.room };
      g.scan = 'done';
      return done();
    }
    case 'scanSkip': {
      if (!isHost || !g || g.phase !== 'deal') return no('Too late to change that.');
      g.envelope = null; g.scan = 'skipped';
      return done();
    }
    case 'scanReset': {
      if (!isHost || !g || g.phase !== 'deal') return no('Too late to change that.');
      g.envelope = null; g.scan = 'pending';
      return done();
    }
    // Dealing by scanning the backs: the host phone scans the rows of cards dealt face-down
    // (`groups`, each with its rows of { id, centre, axis }, as the scan pieced the table
    // together), then says whose each row is.
    case 'scanned': {
      if (!isHost || !g || g.phase !== 'deal' || g.dealMode !== 'backs') return no('The cards can’t be scanned now.');
      const rows = [];
      (Array.isArray(a.groups) ? a.groups : []).forEach((gr, gi) => (gr.rows || []).forEach(row => rows.push({ group: gi, cards: row })));
      const ids = rows.flatMap(r => r.cards.map(c => c.id));
      if (!ids.every(id => g.deck.some(c => c.id === id)) || new Set(ids).size !== ids.length) return no('That scan didn’t make sense. Scan the cards again.');
      const num = v => (Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) ? [v[0], v[1]] : [0, 0]);
      g.scanned = { rows: rows.map(r => ({ group: r.group, cards: r.cards.map(c => ({ id: c.id, at: num(c.centre), axis: num(c.axis) })) })) };
      return done();
    }
    case 'rescan': {
      if (!isHost || !g || g.phase !== 'deal' || g.dealMode !== 'backs') return no('Too late to change that.');
      g.scanned = null;
      return done();
    }
    case 'assign': {
      if (!isHost || !g || g.phase !== 'deal' || g.dealMode !== 'backs' || !g.scanned) return no('Scan the cards first.');
      const rows = g.scanned.rows, to = Array.isArray(a.to) ? a.to : [];
      const found = rows.reduce((t, r) => t + r.cards.length, 0);
      if (found < g.deck.length) return no(`The scan found ${found} of the ${g.deck.length} cards. Scan them again.`);
      if (rows.length !== g.seats.length + 1) return no(`The scan found ${rows.length} rows, but there are ${g.seats.length} players and the envelope. Lay the rows out again and scan them.`);
      if (to.length !== rows.length || to.some(x => !x)) return no('Say whose each row is.');
      for (const s of g.seats) {
        const n = to.filter(x => x === s.id).length;
        if (n !== 1) return no(n ? `Two rows are both ${s.name}’s.` : `None of the rows is ${s.name}’s.`);
      }
      const e = to.filter(x => x === 'envelope').length;
      if (e !== 1) return no(e ? 'Only one row can be the envelope.' : 'Which row is the envelope?');
      const env = rows[to.indexOf('envelope')].cards.map(c => g.deck.find(d => d.id === c.id));
      if (env.length !== 3 || !CATS.every(cat => env.filter(c => c.cat === cat).length === 1)) {
        return no('The envelope’s row has to be one suspect, one weapon and one room, and that row isn’t. Check which row is the envelope.');
      }
      g.solution = Object.fromEntries(CATS.map(cat => [cat, env.find(c => c.cat === cat).id]));
      g.envelope = { ...g.solution };
      g.scan = 'done';
      rows.forEach((r, i) => {
        const s = seat(to[i]);
        if (!s) return;
        s.hand = sortHand(g, r.cards.map(c => c.id));
        g.counts[s.id] = s.hand.length;
      });
      g.scanned = null;
      g.phase = 'play';
      return done();
    }
    case 'dealt': {
      if (!isHost || !g || g.phase !== 'deal') return no('The cards can’t be dealt now.');
      if (g.scan === 'pending') return no('Scan the envelope first, or choose to let the app pick the answer.');
      g.phase = 'hands';
      return done();
    }
    case 'hand': {
      if (!g || g.phase !== 'hands') return no('It’s not time to enter cards.');
      const s = seat(a.seat);
      if (!s || s.robot || !own(s.id)) return no('That hand isn’t on this phone.');
      const cards = Array.isArray(a.cards) ? [...new Set(a.cards)] : [];
      if (!cards.every(id => g.deck.some(c => c.id === id))) return no('One of those cards isn’t in this game.');
      if (cards.length !== g.counts[s.id]) return no(`Pick exactly ${g.counts[s.id]} cards.`);
      g.entries[s.id] = cards;
      g.submitted[s.id] = true;
      g.dealError = null;
      if (g.seats.filter(x => !x.robot).every(x => g.submitted[x.id])) finishHands(g);
      return done();
    }
    case 'unsubmit': {
      if (!g || g.phase !== 'hands' || !own(a.seat)) return no('That hand isn’t on this phone.');
      delete g.submitted[a.seat];
      return done();
    }
    case 'suggest': {
      if (!g || g.phase !== 'play') return no('The game isn’t running.');
      const s = seat(a.by);
      if (!s || s.robot || !own(s.id)) return no('That player isn’t on this phone.');
      if (s.out) return no(`${s.name} is out of the running and can’t make suggestions.`);
      if (!validPicks(g, a.picks)) return no('Choose one suspect, one weapon and one room.');
      runSuggestion(g, s.id, a.picks);
      return done();
    }
    case 'pick': {
      if (!g || g.phase !== 'play') return no('The game isn’t running.');
      const e = g.log.find(x => x.type === 'suggest' && x.n === a.n);
      if (!e || !e.disprover || !own(e.disprover)) return no('That question isn’t yours to answer.');
      if (g.shown.some(x => x.n === e.n)) return no('A card was already shown for that suggestion.');
      const d = seat(e.disprover);
      if (!d.hand.includes(a.card) || !e.picks.includes(a.card)) return no('Show one of the cards that was asked about.');
      g.shown.push({ n: e.n, from: d.id, to: e.by, card: a.card });
      return done();
    }
    case 'accuse': {
      if (!g || g.phase !== 'play') return no('The game isn’t running.');
      const s = seat(a.by);
      if (!s || s.robot || !own(s.id)) return no('That player isn’t on this phone.');
      if (s.out) return no(`${s.name} has already made an accusation.`);
      if (!validPicks(g, a.picks)) return no('Choose one suspect, one weapon and one room.');
      const correct = CATS.every((c, i) => a.picks[i] === g.solution[c]);
      g.log.push({ type: 'accuse', by: s.id, picks: a.picks, correct });
      if (correct) { g.phase = 'over'; g.winner = s.id; }
      else {
        s.out = true;
        if (!g.seats.some(x => !x.robot && !x.out)) g.phase = 'over';
      }
      return done();
    }
    case 'giveUp': {
      if (!isHost || !g || g.phase !== 'play') return no('Only the host phone can end the game.');
      g.phase = 'over';
      return done();
    }
    case 'newGame': {
      if (!isHost) return no('Only the host phone can start a new game.');
      state.game = null;
      tidyClaims(state);
      return done();
    }
    default:
      return no('The app didn’t recognise that request.');
  }
}

/* ---------- what each phone gets to see ---------- */
export function modelFor(state, deviceId, online = new Set()) {
  const g = state.game;
  const mine = seatsOf(state, deviceId);
  const seats = seatList(state).map(s => {
    const holder = state.claims[s.id];
    return {
      id: s.id, name: s.name.trim(), robot: s.robot, out: !!s.out,
      cards: g ? g.counts[s.id] : null,
      phone: s.robot ? null : holder ? 'own' : 'host',
      you: !s.robot && controls(state, deviceId, s.id),
      online: s.robot ? null : holder ? online.has(holder) : true,
    };
  });
  const over = !!g && g.phase === 'over';
  return {
    rev: state.rev,
    phase: g ? g.phase : 'setup',
    seats,
    mine,
    setup: { dealMode: state.setup.dealMode, robotStyle: state.setup.robotStyle, deckSize: deckSize(state.setup), phones: state.setup.phones },
    game: g && {
      deck: g.deck, counts: g.counts, dealMode: g.dealMode, robotStyle: g.robotStyle,
      scan: g.scan, submitted: { ...g.submitted }, dealError: g.dealError,
      scanned: g.scanned && { rows: g.scanned.rows.map(r => ({ group: r.group, cards: r.cards.map(c => ({ at: c.at, axis: c.axis })) })) },
      log: g.log, lastBy: g.lastBy, winner: g.winner,
      answered: g.shown.map(x => x.n),
      solution: over ? g.solution : null,
      hands: over ? Object.fromEntries(g.seats.map(s => [s.id, s.hand])) : null,
    },
    priv: g ? Object.fromEntries(mine.map(id => {
      const s = g.seats.find(x => x.id === id);
      return [id, {
        hand: s.hand.slice(),
        entry: (g.entries[id] || []).slice(),
        shown: g.shown.filter(x => x.to === id),
        pick: pendingPick(g, id),
      }];
    })) : {},
  };
}
