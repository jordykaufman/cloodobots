// Every screen, drawn from the model this phone was given (see modelFor in engine.js).
// Nothing here can reveal a card this phone's players aren't allowed to see, because
// those cards were never sent to it.

import { esc } from './util.js';
import { CATS, CAT, CATS_PL, EDITIONS, dealCounts, cleanList, printedDeck } from './engine.js';
import { UPDATED } from './version.js';

let C; // the context for the screen being drawn

/* ---------- lookups ---------- */
const seat = id => C.M.seats.find(s => s.id === id);
const card = id => C.M.game.deck.find(c => c.id === id);
const ofCat = cat => C.M.game.deck.filter(c => c.cat === cat);
const mine = () => C.M.mine.map(seat).filter(Boolean);
const mineIn = () => mine().filter(s => !s.out);
const shared = () => C.M.mine.length > 1;
const isHost = () => C.role === 'host';
const suggestions = () => C.M.game.log.filter(e => e.type === 'suggest');

/* ---------- markup pieces ---------- */
const icon = (n, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${n}"></use></svg>`;
export const who = s => `<span class="who${s.robot ? ' who--bot' : ''}">${icon(s.robot ? 'robot' : 'person')}<span>${esc(s.name)}</span></span>`;
const cc = c => `<span class="cc cc--${c.cat}">${icon(c.cat)}<span>${esc(c.name)}</span></span>`;
const brand = () => `<p class="brand">${icon('glass')}<span>Cluedo Robot Players</span></p>`;
function pcard(c, mods = '') {
  if (c.art) {
    return `<span class="pcard pcard--photo pcard--${c.cat} ${mods}" role="img" aria-label="${CAT[c.cat]}: ${esc(c.name)}">
      <img src="${esc(c.art)}" alt="" loading="lazy" decoding="async"></span>`;
  }
  return `<span class="pcard pcard--${c.cat} ${mods}" role="img" aria-label="${CAT[c.cat]}: ${esc(c.name)}">
    <span class="pcard-cat" aria-hidden="true">${CAT[c.cat]}</span>
    <span class="pcard-mid" aria-hidden="true">${icon(c.cat)}<span class="pcard-name">${esc(c.name)}</span></span>
    <span class="pcard-cat pcard-cat--flip" aria-hidden="true">${CAT[c.cat]}</span>
  </span>`;
}
const radioChip = (name, key, value, label, checked, ic = '') =>
  `<label class="chip"><input type="radio" name="${name}" id="${name}-${value}" value="${value}" data-in="draft" data-key="${key}"${checked ? ' checked' : ''}><span>${ic ? icon(ic) : ''}${esc(label)}</span></label>`;
const checkChip = (c, checked) =>
  `<label class="chip"><input type="checkbox" id="hand-${c.id}" value="${c.id}" data-in="handCard"${checked ? ' checked' : ''}><span>${icon('check', 'tick')}${esc(c.name)}</span></label>`;

function curtain(s, line) {
  return `<div class="curtain" role="dialog" aria-modal="true" aria-label="Pass the phone to ${esc(s.name)}"><div class="curtain-in">
    ${icon('lock', 'curtain-lock')}
    <p class="eyebrow">Private</p>
    <h1 class="curtain-name">Pass to ${esc(s.name)}</h1>
    <p class="curtain-line">${line}</p>
    <button class="btn btn--light btn--big" data-act="open">I’m ${esc(s.name)}, show me</button>
  </div></div>`;
}
// Private screens on a phone shared by several people sit behind a curtain until the
// right person taps through. A phone with one person on it shows them straight away.
const gated = (s, line) => shared() && !C.view.open ? curtain(s, line) : null;
const band = s => shared() ? `<div class="band">${icon('lock')}<span>For ${esc(s.name)} only</span></div>` : '';
function confirmBox(text, act, label, cancel = 'Keep playing') {
  return `<div class="confirm" role="group"><p>${text}</p><div class="row2">
    <button class="btn btn--danger" data-act="${act}">${label}</button>
    <button class="btn btn--ghost" data-act="confirm" data-what="">${cancel}</button></div></div>`;
}
function sentence() {
  const sol = C.M.game.solution;
  return `It was ${esc(card(sol.suspect).name)}, in the ${esc(card(sol.room).name)}, with the ${esc(card(sol.weapon).name)}.`;
}
const phoneTag = s => {
  if (s.robot || C.M.setup.phones !== 'many') return '';
  if (s.you) return `<span class="phone phone--you">${icon('phone')}this phone</span>`;
  if (s.phone === 'own') return `<span class="phone${s.online ? '' : ' phone--off'}">${icon('phone')}${s.online ? 'own phone' : 'phone away'}</span>`;
  return `<span class="phone">${icon('phone')}host phone</span>`;
};

/* ---------- setup (host) ---------- */
function previewText(st) {
  const n = CATS.reduce((a, c) => a + cleanList(st.cards[c]).length, 0) - 3;
  if (n < st.seats.length) return '';
  const counts = dealCounts(st.seats, n);
  return `<b>${n} cards</b> to deal. ` + st.seats.map(s => `${esc(s.name.trim() || '?')} <b>${counts[s.id]}</b>`).join(' · ');
}
export { previewText };

function joinPanel() {
  const N = C.net;
  const people = C.M.seats.filter(s => !s.robot);
  const status = {
    starting: 'Getting a join code ready…',
    ready: 'Ready. Other phones can join now.',
    waiting: 'Taking back this game’s join code. This can take a few seconds after a reload.',
    offline: 'Can’t reach the connection service. Check this phone is online; it will keep trying.',
  }[N.status] || 'Getting a join code ready…';
  return `<div class="joinbox">
    <div class="joinbox-code">
      <span class="label">Join code</span>
      <span class="code" aria-label="Join code ${esc(N.code.split('').join(' '))}">${esc(N.code)}</span>
      <p class="hint">${status}</p>
    </div>
    <div class="qr" aria-label="QR code that opens the join link">${N.qr || ''}</div>
    <div class="joinbox-link">
      <p class="hint">On the other phone, scan the QR code with the camera, or open this link:</p>
      <p class="link-row"><span class="url" id="joinUrl">${esc(N.url)}</span><button class="btn btn--ghost btn--sm" data-act="copyLink">Copy</button></p>
    </div>
  </div>
  <ul class="phones">${people.map(s => `<li>${who(s)}${phoneTag(s)}${s.phone === 'own' ? `<button class="link" data-act="release" data-seat="${s.id}">Move to this phone</button>` : ''}</li>`).join('')}</ul>
  <p class="hint">Anyone who doesn’t join on their own phone shares this one.</p>`;
}

function viewSetup() {
  const st = C.setup;
  const seatRow = (s, i, n) => `<li class="seat${s.robot ? ' seat--bot' : ''}">
    <span class="seat-n" aria-hidden="true">${i + 1}</span>
    <button class="kind" data-act="toggleKind" data-i="${i}" aria-label="${s.robot ? 'Robot. Switch to a person' : 'Person. Switch to a robot'}">${icon(s.robot ? 'robot' : 'person')}<span>${s.robot ? 'Robot' : 'Person'}</span></button>
    <input class="seat-name" id="seat-${s.id}" data-in="seatName" data-i="${i}" value="${esc(s.name)}" aria-label="Seat ${i + 1} name" maxlength="24" autocomplete="off" spellcheck="false">
    <span class="seat-tools">
      <button class="icon-btn" data-act="moveSeat" data-i="${i}" data-d="-1"${i === 0 ? ' disabled' : ''} aria-label="Move ${esc(s.name)} up">↑</button>
      <button class="icon-btn" data-act="moveSeat" data-i="${i}" data-d="1"${i === n - 1 ? ' disabled' : ''} aria-label="Move ${esc(s.name)} down">↓</button>
      <button class="icon-btn" data-act="removeSeat" data-i="${i}"${n <= 2 ? ' disabled' : ''} aria-label="Remove ${esc(s.name)}">✕</button>
    </span></li>`;
  const option = (name, value, title, desc, off = '') => `<label class="opt${off ? ' opt--off' : ''}">
    <input type="radio" name="${name}" id="${name}-${value}" value="${value}" data-in="setupOpt"${st[name] === value ? ' checked' : ''}${off && st[name] !== value ? ' disabled' : ''}>
    <span class="opt-body"><span class="opt-title">${title}</span><span class="opt-desc">${desc}${off ? ` <strong>${off}</strong>` : ''}</span></span></label>`;
  const backsOff = !printedDeck(st) ? 'Needs the printed deck: choose the Clue (2013) cards below.' : !C.cameraOK ? 'Needs this phone’s camera, which this browser won’t give the page.' : '';
  return `
  <header class="masthead">
    ${brand()}
    <h1 class="display">Fill the empty chairs</h1>
    <p class="lede">Robot players are dealt cards and answer suggestions, so a two-person game plays like a full table. They don’t move or ask questions.</p>
    <p><button class="link" data-act="toJoin">Joining someone else’s game? Enter their code</button></p>
  </header>
  ${C.storageOK ? '' : '<p class="warn">This browser isn’t saving progress. Don’t reload the page during a game or the robots’ cards are lost.</p>'}
  <section class="panel">
    <h2 class="h2">Players</h2>
    <p class="hint">List everyone in seating order, going clockwise. When someone makes a suggestion, the player on their left answers first.</p>
    <ol class="seats">${st.seats.map((s, i) => seatRow(s, i, st.seats.length)).join('')}</ol>
    <div class="row">
      <button class="btn btn--ghost" data-act="addSeat" data-robot="0">${icon('person')} Add person</button>
      <button class="btn btn--ghost" data-act="addSeat" data-robot="1">${icon('robot')} Add robot</button>
    </div>
  </section>
  <section class="panel">
    <h2 class="h2">Phones</h2>
    <div class="options">
      ${option('phones', 'one', 'Just this phone', 'Pass it around whenever someone needs to see something private.')}
      ${option('phones', 'many', 'Everyone uses their own phone', 'Other phones join this game with a code. Each person sees their own cards on their own phone.')}
    </div>
    ${st.phones === 'many' ? joinPanel() : ''}
  </section>
  <section class="panel">
    <h2 class="h2">Dealing</h2>
    <div class="options">
      ${option('dealMode', 'backs', 'Real cards with the printed backs', 'Deal everyone real cards, robots and the envelope too, face-down in rows. This phone scans the backs, then you say whose each row is. Nobody sees a card.', backsOff)}
      ${option('dealMode', 'physical', 'We hold real cards', `Deal the people real cards as usual and tap them in. ${C.cameraOK ? 'This phone’s camera reads the envelope cards without anyone seeing them, so the app knows the real answer.' : 'The app picks the answer from the cards nobody holds.'}`)}
      ${option('dealMode', 'app', 'The app deals everyone', 'No paper cards. Everyone checks their hand in the app, and shows cards through it too.')}
    </div>
  </section>
  <section class="panel">
    <h2 class="h2">When a robot could show more than one card</h2>
    <div class="options">
      ${option('robotStyle', 'cagey', 'Cagey', 'Shows a card it has already shown when it can, so it gives away as little as possible. Like a careful player.')}
      ${option('robotStyle', 'random', 'Random', 'Shows any matching card.')}
    </div>
  </section>
  <section class="panel">
    <h2 class="h2">Cards</h2>
    <label class="field"><span class="label">Edition</span>
      <select id="edition" data-in="edition">
        ${Object.entries(EDITIONS).map(([k, e]) => `<option value="${k}"${st.edition === k ? ' selected' : ''}>${e.label}</option>`).join('')}
        <option value="custom"${st.edition === 'custom' ? ' selected' : ''}>Custom names</option>
      </select></label>
    <details class="edit"><summary>Edit card names</summary>
      <p class="hint">One card per line. Use the names exactly as printed on your cards, so the camera can match them.</p>
      <div class="lists">${CATS.map(cat => `<label class="field"><span class="label">${CATS_PL[cat]}</span>
        <textarea id="cards-${cat}" data-in="cards" data-cat="${cat}" rows="${Math.max(4, st.cards[cat].length)}" spellcheck="false">${esc(st.cards[cat].join('\n'))}</textarea></label>`).join('')}</div>
    </details>
  </section>
  <div class="startbar">
    <p class="preview" id="preview">${previewText(st)}</p>
    <p class="error" id="setupError" role="alert"></p>
    <button class="btn btn--primary btn--big" data-act="start">Start the game</button>
  </div>
  <p class="hint">This version of the app: ${esc(new Date(UPDATED).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))}.</p>`;
}

/* ---------- joining (other phones) ---------- */
function viewJoin() {
  const status = {
    connecting: 'Connecting…',
    reconnecting: 'Trying again…',
    missing: 'No game is using that code right now. Check the code, and that the host phone has this app open.',
    connected: 'Connected.',
  }[C.net.status] || '';
  return `<header class="masthead">${brand()}<h1 class="h1">Join a game</h1>
    <p class="lede">Type the code shown on the host phone, under Phones.</p></header>
  <form class="joinform" data-form="join">
    <label class="field"><span class="label">Join code</span>
      <input id="joinCode" class="code-input" value="${esc(C.net.code || '')}" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" aria-describedby="joinStatus"></label>
    <button class="btn btn--primary btn--big" type="submit">Join</button>
    <p class="hint" id="joinStatus" role="status">${esc(status)}</p>
  </form>
  <p><button class="link" data-act="toHost">Start a game on this phone instead</button></p>`;
}

function viewLobby() {
  const people = C.M.seats.filter(s => !s.robot);
  const me = mine()[0];
  const pickList = `<div class="stack">${people.map(s => {
    const taken = s.phone === 'own' && !s.you && s.online;
    return `<button class="btn btn--ghost btn--big btn--left seatpick${s.you ? ' is-you' : ''}" data-act="claim" data-seat="${s.id}"${taken ? ' disabled' : ''}>
      ${who(s)}<span class="meta">${s.you ? 'you' : taken ? 'on another phone' : s.phone === 'host' ? 'on the host phone' : ''}</span></button>`;
  }).join('')}</div>`;
  if (me && !C.view.changing) {
    return `<header class="masthead">${brand()}<p class="eyebrow">Joined</p><h1 class="h1">You’re ${esc(me.name)}</h1>
      <p class="lede">Waiting for the host to start the game. Keep this page open.</p></header>
    <ol class="ring">${C.M.seats.map(s => `<li><span class="place">${who(s)}</span></li>`).join('')}</ol>
    <p><button class="link" data-act="changeSeat">That’s not me</button> · <button class="link" data-act="leave">Leave this game</button></p>`;
  }
  return `<header class="masthead">${brand()}<p class="eyebrow">Joined</p><h1 class="h1">Which player are you?</h1>
    <p class="lede">Your cards will show on this phone.</p></header>
  ${pickList}
  <p><button class="link" data-act="leave">Leave this game</button></p>`;
}

function viewWaitHost() {
  return `<header class="masthead">${brand()}<h1 class="h1">Connecting to the host phone</h1>
    <p class="lede">${C.net.status === 'missing' ? 'The host phone isn’t answering. Make sure it has the app open and is online.' : 'One moment…'}</p></header>
  <p><button class="link" data-act="leave">Leave this game</button></p>`;
}

/* ---------- dealing ---------- */
function viewDeal() {
  const g = C.M.game;
  if (g.dealMode === 'backs') return g.scanned && isHost() ? viewRows() : viewDealRows();
  const people = C.M.seats.filter(s => !s.robot);
  if (!isHost()) {
    const me = mine()[0];
    return `<header class="head"><p class="eyebrow">Setting up</p><h1 class="h1">The host is dealing</h1>
      <p class="sub">${me ? `${esc(me.name)} gets ${g.counts[me.id]} cards. ` : ''}When they’re dealt, you’ll tap your cards in here.</p></header>`;
  }
  const toRobots = C.M.seats.filter(s => s.robot).reduce((a, r) => a + g.counts[r.id], 0);
  const scanStep = g.scan === 'done'
    ? `<p><strong>Envelope scanned.</strong> ${icon('check', 'ok-tick')} The app knows its three cards.</p><p><button class="link" data-act="rescan">Scan again</button></p>`
    : g.scan === 'skipped'
      ? `<p><strong>The app will pick the answer</strong> from the cards nobody is holding. Leave the paper envelope closed this game.</p>${C.cameraOK ? '<p><button class="link" data-act="rescan">Scan the envelope instead</button></p>' : ''}`
      : C.cameraOK
        ? `<p><strong>Scan the three envelope cards</strong> with this phone, face-down, so nobody sees them.</p>
           <div class="row"><button class="btn btn--primary" data-act="toScan">${icon('camera')} Scan the envelope</button><button class="btn btn--ghost" data-act="scanSkip">Let the app pick the answer</button></div>`
        : `<p>This phone can’t use its camera here, so the app will pick the answer.</p><div class="row"><button class="btn btn--primary" data-act="scanSkip">OK</button></div>`;
  return `
  <header class="head"><p class="eyebrow">Setting up</p><h1 class="h1">Deal the real cards</h1></header>
  <ol class="steps">
    <li><div><p><strong>Fill the envelope as usual</strong>, one suspect, one weapon and one room, without looking. Don’t seal it yet.</p></div></li>
    <li><div>${scanStep}</div></li>
    <li><div><p><strong>${g.scan === 'skipped' ? 'Put the envelope aside' : 'Seal the envelope'}. Shuffle the other ${g.deck.length - 3} cards and deal only to the people:</strong></p>
      <ul class="dealt">${people.map(h => `<li>${who(h)}<span class="meta">${g.counts[h.id]} cards</span></li>`).join('')}</ul></div></li>
    <li><div><p><strong>Put the ${toRobots} leftover cards in the box</strong> without looking. Those are the robots’ cards.</p></div></li>
  </ol>
  <div class="bar"><button class="btn btn--ghost" data-act="confirm" data-what="cancelGame">Back to setup</button>
    <button class="btn btn--primary" data-act="dealt"${g.scan === 'pending' ? ' disabled' : ''}>Cards are dealt</button></div>
  ${C.view.confirm === 'cancelGame' ? confirmBox('Go back to setup? The cards entered so far are cleared.', 'newGame', 'Back to setup', 'Stay here') : ''}`;
}

// A row of little face-down cards.
const cardRow = n => `<span class="minirow" aria-hidden="true">${'<span></span>'.repeat(n)}</span>`;

// Dealing by scanning the backs: everyone's cards, the robots' and the envelope's too, go
// face-down in rows; this phone scans them, then says whose each row is.
function viewDealRows() {
  const g = C.M.game, need = g.deck.length;
  if (!isHost()) {
    const me = mine()[0];
    return `<header class="head"><p class="eyebrow">Setting up</p><h1 class="h1">The host is dealing</h1>
      <p class="sub">Everyone’s cards go face-down in rows, and the host phone scans them. ${me ? `${esc(me.name)} gets ${g.counts[me.id]} cards. ` : ''}When the host has said whose row is whose, pick up yours.</p></header>`;
  }
  return `
  <header class="head"><p class="eyebrow">Setting up</p><h1 class="h1">Deal the cards in rows</h1></header>
  <ol class="steps">
    <li><div><p><strong>Make the envelope’s row.</strong> Shuffle the suspects, the weapons and the rooms separately and take the top card of each, face-down, without looking.</p></div></li>
    <li><div><p><strong>Shuffle the other ${need - 3} and deal them face-down into rows</strong>, a row for each player, robots too:</p>
      <ul class="dealt dealt--rows">${C.M.seats.map(s => `<li>${who(s)}<span class="meta">${cardRow(g.counts[s.id])}${g.counts[s.id]}</span></li>`).join('')}
        <li><span class="who">${icon('lock')}<span>The envelope</span></span><span class="meta">${cardRow(3)}3</span></li></ul></div></li>
    <li><div><p><strong>Lay each row’s cards side by side, all pointing the same way,</strong> with a gap between rows. The rows can go in any order.</p></div></li>
    <li><div><p><strong>Scan them.</strong> Hold the phone over the rows, or move it slowly along them, until it has all ${need}. It ticks each card it has read but never shows which card it is.</p></div></li>
  </ol>
  ${C.cameraOK ? '' : '<div class="alert"><p>This phone can’t use its camera here. Go back to setup and choose another way to deal.</p></div>'}
  <div class="bar"><button class="btn btn--ghost" data-act="confirm" data-what="cancelGame">Back to setup</button>
    <button class="btn btn--primary" data-act="scanRows"${C.cameraOK ? '' : ' disabled'}>${icon('camera')} Scan the cards</button></div>
  ${C.view.confirm === 'cancelGame' ? confirmBox('Go back to setup?', 'newGame', 'Back to setup', 'Stay here') : ''}`;
}

// The rows as the scan saw them, each card where it lies and numbered with its row. Parts
// of the table the scan never saw together are drawn side by side.
function rowsMap(rows) {
  const W = 56, H = 87, GAP = 40, PAD = 6;
  const corners = ({ at, axis: [ax, ay] }) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [at[0] - a * ay * W / 2 + b * ax * H / 2, at[1] + a * ax * W / 2 + b * ay * H / 2]);
  const groups = [...new Set(rows.map(r => r.group))];
  let x = PAD, height = 0;
  const parts = groups.map(gi => {
    const mine = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.group === gi);
    const pts = mine.flatMap(({ r }) => r.cards.flatMap(corners));
    const x0 = Math.min(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1]));
    const w = Math.max(...pts.map(p => p[0])) - x0, h = Math.max(...pts.map(p => p[1])) - y0;
    const dx = x - x0, dy = PAD - y0;
    x += w + GAP;
    height = Math.max(height, h);
    return mine.map(({ r, i }) => r.cards.map(c => `<polygon points="${corners(c).map(([px, py]) => `${(px + dx).toFixed(1)},${(py + dy).toFixed(1)}`).join(' ')}"/>
      <text x="${(c.at[0] + dx).toFixed(1)}" y="${(c.at[1] + dy).toFixed(1)}">${i + 1}</text>`).join('')).join('');
  });
  const width = x - GAP + PAD;
  return `<svg class="rowsmap" viewBox="0 0 ${width.toFixed(0)} ${(height + 2 * PAD).toFixed(0)}" role="img" aria-label="The cards as the scan saw them, each numbered with its row">${parts.join('')}</svg>`;
}

// Which row of the scan is whose. The envelope's row is filled in when it's the only row
// of three and no player was dealt three.
function rowsGuess(g, rows) {
  const to = rows.map(() => '');
  const threes = rows.map((r, i) => (r.cards.length === 3 ? i : -1)).filter(i => i >= 0);
  if (threes.length === 1 && !C.M.seats.some(s => g.counts[s.id] === 3)) to[threes[0]] = 'envelope';
  return to;
}

function viewRows() {
  const g = C.M.game, rows = g.scanned.rows, need = g.deck.length, seats = C.M.seats;
  const found = rows.reduce((t, r) => t + r.cards.length, 0);
  const again = primary => `<button class="btn ${primary ? 'btn--primary' : 'btn--ghost'}" data-act="rescanRows">${icon('camera')} Scan again</button>`;
  const back = `<button class="btn btn--ghost" data-act="confirm" data-what="cancelGame">Back to setup</button>`;
  const cancelBox = C.view.confirm === 'cancelGame' ? confirmBox('Go back to setup?', 'newGame', 'Back to setup', 'Stay here') : '';
  const problem = found < need
    ? `The scan found ${found} of the ${need} cards. Scan again, slowly over every row, until it has them all.`
    : rows.length !== seats.length + 1
      ? `The scan found ${rows.length} rows, but there are ${seats.length} players and the envelope, so there should be ${seats.length + 1}. Check each row’s cards lie side by side with a gap between rows, then scan again.`
      : '';
  if (problem) {
    return `<header class="head"><p class="eyebrow">Setting up</p><h1 class="h1">Scan the cards again</h1></header>
    <div class="alert"><p>${problem}</p></div>
    ${found ? rowsMap(rows) : ''}
    <div class="bar">${back}${again(true)}</div>${cancelBox}`;
  }
  const to = C.view.assign || rowsGuess(g, rows);
  const targets = [...seats.map(s => ({ id: s.id, label: s.robot ? `${s.name} (robot)` : s.name, want: g.counts[s.id] })), { id: 'envelope', label: 'The envelope', want: 3 }];
  const note = (r, t) => {
    if (!t) return '';
    if (t.id === 'envelope') return r.cards.length === 3 ? '' : '<p class="rownote rownote--bad">The envelope has 3 cards.</p>';
    return r.cards.length === t.want ? '' : `<p class="rownote">${esc(t.label)} was meant to get ${t.want}. Fine, if that’s how they were dealt.</p>`;
  };
  const items = rows.map((r, i) => {
    const t = targets.find(x => x.id === to[i]);
    return `<li class="rowpick"><label class="rowpick-line" for="row-${i}"><span class="rowpick-n">Row ${i + 1}</span><span class="meta">${cardRow(r.cards.length)}${r.cards.length} cards</span></label>
      <select id="row-${i}" data-in="rowTo" data-i="${i}"><option value="">Whose row?</option>${targets.map(x => `<option value="${x.id}"${to[i] === x.id ? ' selected' : to.includes(x.id) ? ' disabled' : ''}>${esc(x.label)}</option>`).join('')}</select>
      ${note(r, t)}</li>`;
  }).join('');
  const ready = to.every(Boolean) && targets.every(t => to.filter(x => x === t.id).length === 1) && rows[to.indexOf('envelope')].cards.length === 3;
  return `<header class="head"><p class="eyebrow">Setting up</p><h1 class="h1">Whose row is which?</h1>
    <p class="sub">All ${need} cards scanned. Here are the rows as the phone saw them, row 1 at the top.</p></header>
  ${rowsMap(rows)}
  <ol class="rowpicks">${items}</ol>
  <div class="bar">${again(false)}<button class="btn btn--primary" data-act="assignRows"${ready ? '' : ' disabled'}>These are right</button></div>
  <p><button class="link" data-act="confirm" data-what="cancelGame">Back to setup</button></p>${cancelBox}`;
}

function viewScan() {
  const S = C.scan;
  const dots = CATS.map((c, i) => `<span class="dot${i < S.got ? ' is-on' : ''}" aria-hidden="true"></span>`).join('');
  if (!S.running && !S.error) {
    return `<div class="curtain curtain--scan"><div class="curtain-in">
      <p class="eyebrow">Scan the envelope</p>
      <h1 class="curtain-name">Nobody sees the cards</h1>
      ${scanDiagram()}
      <ol class="scan-steps">
        <li>Tap <strong>Start scanning</strong>, then lay this phone face-down on the table. The camera on the back now points up.</li>
        <li>Hold one envelope card face-down, about a hand’s width above the phone. Keep it still.</li>
        <li>The phone beeps and says “got it”. Do the next card.</li>
      </ol>
      <p class="curtain-line">Do it in a well-lit room. The screen never shows the cards.</p>
      <button class="btn btn--light btn--big" data-act="scanStart">Start scanning</button>
      <p class="curtain-links"><a href="scan-explained.html" target="_blank" rel="noopener">How this works</a> · <button class="link link--light" data-act="scanCancel">Not now</button></p>
    </div></div>`;
  }
  if (S.error) {
    return `<div class="curtain curtain--scan"><div class="curtain-in">
      <p class="eyebrow">Scan the envelope</p>
      <h1 class="curtain-name">The camera didn’t start</h1>
      <p class="curtain-line">${esc(S.error)}</p>
      <button class="btn btn--light btn--big" data-act="scanStart">Try again</button>
      <p class="curtain-links"><button class="link link--light" data-act="scanSkip">Let the app pick the answer</button> · <button class="link link--light" data-act="scanCancel">Back</button></p>
    </div></div>`;
  }
  const line = S.state === 'loading'
    ? `Getting the card reader ready${S.progress ? ` (${Math.round(S.progress * 100)}%)` : ''}. The first time takes a little longer.`
    : S.state === 'reading' ? 'Reading the card. Hold it still.' : 'Hold a card face-down above the phone.';
  return `<div class="curtain curtain--scan"><div class="curtain-in">
    <p class="eyebrow">Scanning · phone face-down</p>
    <h1 class="curtain-name" aria-live="polite">Card ${Math.min(S.got + 1, 3)} of 3</h1>
    <p class="dots">${dots}</p>
    <p class="curtain-line" aria-live="polite">${line}</p>
    <div class="row row--center">
      ${S.torch ? `<button class="btn btn--light" data-act="torch">${S.torchOn ? 'Light off' : 'Light on'}</button>` : ''}
      <button class="btn btn--outline" data-act="scanRestart">Start over</button>
    </div>
    <p class="curtain-links"><button class="link link--light" data-act="scanCancel">Stop scanning</button></p>
  </div></div>`;
}

function scanDiagram() {
  return `<svg class="scan-figure" viewBox="0 0 300 150" role="img" aria-label="Side view: the phone lies face-down on the table and you hold the card face-down above it.">
    <polygon class="d-cone" points="96,124 70,58 170,58"/>
    <rect class="d-table" x="6" y="132" width="288" height="8" rx="2"/>
    <rect class="d-phone" x="80" y="120" width="96" height="12" rx="4"/>
    <rect class="d-phone" x="88" y="115" width="16" height="6" rx="2"/>
    <rect class="d-back" x="62" y="52" width="114" height="3.5" rx="1"/>
    <rect class="d-face" x="62" y="55.5" width="114" height="3.5" rx="1"/>
    <circle class="d-skin" cx="34" cy="26" r="14"/>
    <line class="d-sight" x1="42" y1="32" x2="120" y2="50"/>
    <text class="d-label" x="190" y="50">card face-down</text>
    <text class="d-label" x="190" y="122">phone face-down</text>
  </svg>`;
}

/* ---------- entering hands ---------- */
function countLine(have, need) {
  if (have > need) return `${have} picked. That’s ${have - need} too many.`;
  if (have === need) return `${need} of ${need}. Ready.`;
  return `${have} of ${need} picked`;
}

function viewHands() {
  const g = C.M.game;
  const people = C.M.seats.filter(s => !s.robot);
  const todo = mine().filter(s => !g.submitted[s.id]);
  const err = g.dealError;
  const errBox = !err ? '' : err.kind === 'missing'
    ? `<div class="alert"><p><strong>There’s no ${CAT[err.cat].toLowerCase()} left for the answer.</strong> Between you, the people hold every ${CAT[err.cat].toLowerCase()} card. That happens when the envelope wasn’t filled before dealing, or a card was tapped by mistake. Check your cards and save them again.</p></div>`
    : `<div class="alert"><p><strong>Something doesn’t add up.</strong> A card was entered twice, or a card someone entered is in the envelope. Everyone check what you tapped against your real cards and save again.</p></div>`;
  if (todo.length === 1 && !shared()) return viewEnter(todo[0], errBox);
  const waiting = people.filter(s => !g.submitted[s.id]);
  return `<header class="head"><p class="eyebrow">Setting up</p><h1 class="h1">${todo.length ? 'Tap in your cards' : 'Waiting for everyone’s cards'}</h1></header>
  ${errBox}
  ${todo.length ? `<div class="stack">${todo.map(s => `<button class="btn btn--primary btn--big btn--left" data-act="enter" data-seat="${s.id}">${icon('lock')} Enter ${esc(s.name)}’s cards</button>`).join('')}</div>` : ''}
  <ul class="dealt">${people.map(s => `<li>${who(s)}<span class="meta">${g.submitted[s.id] ? 'cards saved' : 'not yet'}</span></li>`).join('')}</ul>
  ${waiting.length && !todo.length ? `<p class="sub">Still waiting for ${waiting.map(s => esc(s.name)).join(' and ')}.</p>` : ''}
  ${mine().some(s => g.submitted[s.id]) ? `<p>${mine().filter(s => g.submitted[s.id]).map(s => `<button class="link" data-act="unsubmit" data-seat="${s.id}">Change ${esc(s.name)}’s cards</button>`).join(' · ')}</p>` : ''}`;
}

function viewEnter(s, errBox = '') {
  const g = C.M.game;
  s = s || seat(C.view.seat);
  const gate = gated(s, `${esc(s.name)} is about to tap in their cards. Everyone else, look away.`);
  if (gate) return gate;
  const need = g.counts[s.id];
  const sel = C.view.sel || C.M.priv[s.id].entry;
  return `${band(s)}
  <header class="head"><p class="eyebrow">${esc(s.name)}</p><h1 class="h1">Tap the ${need} cards in your hand</h1></header>
  ${errBox}
  ${CATS.map(cat => `<fieldset class="group group--${cat}"><legend class="label">${icon(cat)} ${CATS_PL[cat]}</legend>
    <div class="chips">${ofCat(cat).map(c => checkChip(c, sel.includes(c.id))).join('')}</div></fieldset>`).join('')}
  <div class="bar bar--sticky">
    <span class="count${sel.length > need ? ' count--over' : ''}" id="count" aria-live="polite">${countLine(sel.length, need)}</span>
    <button class="btn btn--primary" id="saveHand" data-act="saveHand" data-seat="${s.id}"${sel.length === need ? '' : ' disabled'}>Save my cards</button>
  </div>`;
}

/* ---------- the answer is sealed ---------- */
function viewReady() {
  const g = C.M.game;
  const line = g.dealMode === 'app'
    ? 'Everyone has a hand. Look at your own cards before you start.'
    : g.dealMode === 'backs'
      ? 'The app knows every hand and what’s in the envelope. Pick up your own row. Put the robots’ rows in the box and the envelope’s row in the envelope, without looking. Make accusations in the app; it checks them against the envelope.'
      : g.scan === 'done'
      ? 'The robots have their cards, and the app knows what’s in the envelope. Make accusations in the app; it checks them against the envelope.'
      : 'The robots have their cards and the app holds the answer. Leave the paper envelope closed. Make accusations in the app.';
  const look = g.dealMode === 'app' && mine().length;
  return `<header class="head"><p class="eyebrow">All dealt</p><h1 class="h1">The answer is sealed</h1></header>
  <ul class="dealt">${C.M.seats.map(s => `<li>${who(s)}<span class="meta">${s.cards} cards</span></li>`).join('')}</ul>
  <p class="sub">${line}</p>
  <div class="bar">${look ? `<button class="btn btn--ghost" data-act="toTable">Skip</button><button class="btn btn--primary" data-act="peekAll">Look at ${shared() ? 'hands' : 'my cards'}</button>` : `<button class="btn btn--primary btn--big" data-act="toTable">Start playing</button>`}</div>`;
}

/* ---------- my cards ---------- */
function viewHand() {
  const g = C.M.game, v = C.view, s = seat(v.seat);
  const gate = gated(s, 'Everyone else, look away.');
  if (gate) return gate;
  const p = C.M.priv[s.id];
  const people = mine();
  const last = !v.initial || v.i + 1 >= people.length;
  return `${band(s)}
  <header class="head">${v.initial && shared() ? `<p class="eyebrow">Person ${v.i + 1} of ${people.length}</p>` : ''}<h1 class="h1">${shared() ? 'Your cards' : `${esc(s.name)}’s cards`}</h1></header>
  <div class="hand">${CATS.map(cat => {
    const cs = p.hand.filter(id => card(id).cat === cat);
    return cs.length ? `<div class="hand-group"><h2 class="label">${CATS_PL[cat]}</h2><p class="entry-cards">${cs.map(id => cc(card(id))).join('')}</p></div>` : '';
  }).join('')}</div>
  <section class="notes"><h2 class="h2">Shown to you</h2>${p.shown.length
    ? `<ul class="shown">${p.shown.map(x => `<li><span class="num">No. ${x.n}</span>${who(seat(x.from))}<span class="sub">showed</span>${cc(card(x.card))}</li>`).join('')}</ul>`
    : `<p class="empty">Nothing yet. ${g.dealMode !== 'app' ? 'Cards a robot shows you are listed here.' : 'Cards other players show you are listed here.'}</p>`}</section>
  <div class="bar"><button class="btn btn--primary btn--big" data-act="hideHand">${shared() ? (last ? 'Hide my cards' : 'Hide and pass on') : 'Back to the table'}</button></div>`;
}

function viewWhose() {
  return `<header class="head"><p class="eyebrow">My cards</p><h1 class="h1">Whose cards?</h1>
    <p class="sub">The screen asks you to pass the phone before anything is shown.</p></header>
  <div class="stack">${mine().map(h => `<button class="btn btn--ghost btn--big btn--left" data-act="viewHand" data-seat="${h.id}">${who(h)}</button>`).join('')}</div>
  <div class="bar"><button class="btn btn--ghost" data-act="toTable">Back</button></div>`;
}

/* ---------- the table ---------- */
function logHtml() {
  const g = C.M.game;
  if (!g.log.length) return `<p class="empty">No suggestions yet. Each one lands here with who answered it, so everyone can keep their detective notes straight.</p>`;
  return `<ol class="log">${g.log.slice().reverse().map(e => {
    const by = seat(e.by);
    const cards = `<p class="entry-cards">${e.picks.map(id => cc(card(id))).join('')}</p>`;
    if (e.type === 'accuse') {
      return `<li class="entry entry--acc"><p class="entry-head">${who(by)}<span class="verb">accused</span></p>${cards}
        <p class="entry-trail"><span class="${e.correct ? 'yes' : 'no'}">${e.correct ? 'Correct. Case closed.' : 'Wrong. Out of the running.'}</span></p></li>`;
    }
    const trail = e.steps.map(st => `<span class="${st.can ? 'yes' : 'no'}">${esc(seat(st.seat).name)} ${st.can ? 'showed a card' : 'no card'}</span>`).join('<span aria-hidden="true">→</span>');
    return `<li class="entry"><p class="entry-head"><span class="num">No. ${e.n}</span>${who(by)}<span class="verb">suggested</span></p>${cards}
      <p class="entry-trail">${trail}${e.disprover ? '' : `${e.steps.length ? '<span aria-hidden="true">→</span>' : ''}<span class="none">nobody showed a card</span>`}</p></li>`;
  }).join('')}</ol>`;
}

function viewTable() {
  const v = C.view;
  const canAct = mineIn().length > 0;
  let foot;
  if (isHost()) {
    if (v.confirm === 'reveal') foot = confirmBox('Show the answer and everyone’s cards? This ends the game.', 'giveUp', 'Show the answer');
    else if (v.confirm === 'new') foot = confirmBox('Start a new game? This one ends without showing the answer.', 'newGame', 'Start a new game');
    else foot = `<button class="link" data-act="confirm" data-what="reveal">Give up and show the answer</button><button class="link" data-act="confirm" data-what="new">New game</button>`;
  } else {
    foot = v.confirm === 'leave'
      ? confirmBox('Leave this game? You can rejoin with the code.', 'leave', 'Leave')
      : `<button class="link" data-act="confirm" data-what="leave">Leave this game</button>`;
  }
  return `
  <header class="topbar">${brand()}${C.netChip || ''}</header>
  <section class="seating">
    <h2 class="label">Seating, clockwise</h2>
    <ol class="ring">${C.M.seats.map(s => `<li class="${s.out ? 'is-out' : ''}"><span class="place">${who(s)}<span class="meta">${s.cards} cards${s.out ? ' · out' : ''}</span>${phoneTag(s)}</span></li>`).join('')}</ol>
  </section>
  <section class="actions">
    ${canAct ? `<button class="btn btn--primary btn--big" data-act="toSuggest">Make a suggestion</button>` : ''}
    <div class="row2">
      ${mine().length ? `<button class="btn btn--ghost" data-act="toWhose">${icon('lock')} My cards</button>` : ''}
      ${canAct ? `<button class="btn btn--ghost" data-act="toAccuse">Make an accusation</button>` : ''}
    </div>
    ${!mine().length ? '<p class="sub">Everyone is on their own phone. This screen follows the game.</p>' : ''}
  </section>
  <section class="notes"><h2 class="h2">Case notes</h2>${logHtml()}</section>
  <footer class="foot">${foot}</footer>`;
}

function pickers(prefix, d, whoLabel, isSuggestion) {
  const askers = mineIn();
  const whoPart = askers.length === 1
    ? `<p class="asker">${who(askers[0])}</p>`
    : `<fieldset class="group"><legend class="label">${whoLabel}</legend>
        <div class="chips">${askers.map(h => radioChip(prefix + '-by', 'by', h.id, h.name, d.by === h.id, 'person')).join('')}</div></fieldset>`;
  return whoPart + CATS.map(cat => `<fieldset class="group group--${cat}"><legend class="label">${icon(cat)} ${CAT[cat]}${isSuggestion && cat === 'room' ? ' <span class="hint-inline">· the room you’re in</span>' : ''}</legend>
      <div class="chips">${ofCat(cat).map(c => radioChip(prefix + '-' + cat, cat, c.id, c.name, d[cat] === c.id)).join('')}</div></fieldset>`).join('');
}
export const draftReady = d => !!(d.by && CATS.every(c => d[c]));

function viewSuggest() {
  const d = C.view.draft;
  return `<header class="head"><p class="eyebrow">Suggestion No. ${suggestions().length + 1}</p><h1 class="h1">Make a suggestion</h1></header>
  ${pickers('sg', d, 'Who’s asking?', true)}
  <div class="bar bar--sticky">
    <button class="btn btn--ghost" data-act="toTable">Cancel</button>
    <button class="btn btn--primary" id="go" data-act="askTable"${draftReady(d) ? '' : ' disabled'}>Ask the table</button>
  </div>`;
}

function viewAnswer() {
  const g = C.M.game, v = C.view;
  const e = suggestions().find(x => x.n === v.n);
  if (!e) return viewTable();
  const asker = seat(e.by), d = e.disprover ? seat(e.disprover) : null;
  const askerMine = C.M.mine.includes(e.by);
  const shownToAsker = askerMine ? C.M.priv[e.by].shown.find(x => x.n === e.n) : null;
  const pick = d && C.M.mine.includes(d.id) ? C.M.priv[d.id].pick : null;
  const pickPending = pick && pick.n === e.n;

  if (v.stage === 'pick' && pickPending) {
    const gate = gated(d, `${esc(asker.name)} asked about cards you hold. Everyone else, look away.`);
    if (gate) return gate;
    return `${band(d)}
    <header class="head"><p class="eyebrow">Suggestion No. ${e.n}</p><h1 class="h1">Choose a card to show ${esc(asker.name)}</h1>
      <p class="sub">You hold ${pick.matches.length === 1 ? 'one' : pick.matches.length} of the cards ${esc(asker.name)} named. Only ${esc(asker.name)} will see the one you choose.</p></header>
    <div class="pick-list">${pick.matches.map(id => `<button class="pick" data-act="showCard" data-n="${e.n}" data-card="${id}">${pcard(card(id), 'pcard--sm')}<span class="pick-cta">Show this one</span></button>`).join('')}</div>`;
  }
  if (v.stage === 'reveal' && shownToAsker) {
    const gate = gated(asker, `${esc(d.name)} has a card for you. Everyone else, look away.`);
    if (gate) return gate;
    return `<div class="curtain" role="dialog" aria-modal="true" aria-label="Card shown to ${esc(asker.name)}"><div class="curtain-in">
      <p class="eyebrow">Suggestion No. ${e.n}${shared() ? '' : ` · for ${esc(asker.name)}`}</p>
      <h1 class="reveal-line">${who(d)} <span>shows you</span></h1>
      ${pcard(card(shownToAsker.card), 'pcard--reveal')}
      <p class="curtain-line">Mark it in your detective notes. It’s also saved under My cards.</p>
      <button class="btn btn--light btn--big" data-act="toTable">Got it, hide</button>
    </div></div>`;
  }

  const trail = e.steps.map((st, k) => `<li class="${st.can ? 'has' : ''}" style="--k:${k}">${who(seat(st.seat))}<span class="pill${st.can ? ' pill--yes' : ''}">${st.can ? 'Has a card' : 'No card'}</span></li>`).join('');
  const back = `<div class="bar"><button class="btn btn--${askerMine || pickPending ? 'ghost' : 'primary btn--big'}" data-act="toTable">Back to the table</button></div>`;
  let result;
  if (!d) {
    result = `<h2 class="h2">Nobody could show a card</h2>
      <p class="sub">Either these cards are the answer, or ${esc(asker.name)} is holding some of them.</p>
      <div class="bar"><button class="btn btn--primary btn--big" data-act="toTable">Back to the table</button></div>`;
  } else if (d.robot || (g.dealMode === 'app' && !pickPending)) {
    if (askerMine && shownToAsker) {
      result = `<h2 class="h2">${esc(d.name)} has a card for ${esc(asker.name)}</h2>
        <div class="bar"><button class="btn btn--primary btn--big" data-act="stage" data-stage="reveal">${shared() ? `Pass to ${esc(asker.name)} to see it` : 'See the card'}</button></div>`;
    } else if (askerMine) {
      result = `<h2 class="h2">Waiting for ${esc(d.name)} to choose a card</h2><p class="sub">It will appear here.</p>${back}`;
    } else {
      result = `<h2 class="h2">${esc(d.name)} ${g.answered.includes(e.n) ? 'showed' : 'is choosing'} a card for ${esc(asker.name)}</h2>${back}`;
    }
  } else if (g.dealMode !== 'app') {
    result = `<h2 class="h2">${esc(d.name)}, show ${esc(asker.name)} a card</h2>
      <p class="sub">Secretly show ${esc(asker.name)} one of your matching cards.</p>
      <div class="bar"><button class="btn btn--primary btn--big" data-act="toTable">Done</button></div>`;
  } else {
    result = `<h2 class="h2">${esc(d.name)} has a card for ${esc(asker.name)}</h2>
      <div class="bar"><button class="btn btn--primary btn--big" data-act="stage" data-stage="pick">${shared() ? `Pass to ${esc(d.name)} to choose` : 'Choose a card to show'}</button></div>`;
  }
  return `<header class="head"><p class="eyebrow">Suggestion No. ${e.n}</p><h1 class="h1">${esc(asker.name)} suggests</h1></header>
  <div class="trio">${e.picks.map(id => pcard(card(id), 'pcard--sm')).join('')}</div>
  <section class="notes"><h2 class="label">Around the table</h2><ol class="trail">${trail}</ol></section>
  <div class="result" style="--k:${e.steps.length}">${result}</div>`;
}

function viewAccuse() {
  const v = C.view, d = v.draft;
  const name = d.by ? esc(seat(d.by).name) : '';
  const bar = v.confirming
    ? `<div class="bar bar--sticky bar--confirm"><p>Final answer? If it’s wrong, ${name} is out of the running.</p>
        <div class="row2"><button class="btn btn--ghost" data-act="accuseBack">Change it</button><button class="btn btn--danger" data-act="accuseFinal">Check the answer</button></div></div>`
    : `<div class="bar bar--sticky"><button class="btn btn--ghost" data-act="toTable">Cancel</button>
        <button class="btn btn--primary" id="go" data-act="accuseCheck"${draftReady(d) ? '' : ' disabled'}>Accuse</button></div>`;
  return `<header class="head"><p class="eyebrow">Accusation</p><h1 class="h1">Make an accusation</h1>
    <p class="sub">Name the murderer, the weapon and the room. Get it right and you win. Get it wrong and you’re out, though you still show cards when asked.</p></header>
  ${pickers('ac', d, 'Who’s accusing?', false)}
  ${bar}`;
}

function viewAccused() {
  const g = C.M.game, e = g.log[C.view.idx];
  if (!e) return viewTable();
  const s = seat(e.by);
  if (e.correct) {
    return `<div class="curtain"><div class="curtain-in curtain-in--wide">
      <p class="eyebrow">Case closed</p>
      <h1 class="curtain-name">${esc(s.name)} solved it</h1>
      <div class="trio">${CATS.map(c => pcard(card(g.solution[c]), 'pcard--sm pcard--reveal')).join('')}</div>
      <p class="curtain-line">${sentence()}</p>
      <button class="btn btn--light btn--big" data-act="toOver">See who held what</button>
    </div></div>`;
  }
  const left = C.M.seats.some(x => !x.robot && !x.out);
  return `<header class="head"><p class="eyebrow">Accusation</p><h1 class="h1">Not quite, ${esc(s.name)}</h1>
    <p class="sub">That isn’t the answer. ${esc(s.name)} is out of the running but still shows cards when asked.</p></header>
  <div class="trio">${e.picks.map(id => pcard(card(id), 'pcard--sm')).join('')}</div>
  <div class="bar">${left
    ? `<button class="btn btn--primary btn--big" data-act="toTable">Back to the table</button>`
    : `<p class="sub">Nobody is left to solve it.</p><button class="btn btn--primary btn--big" data-act="toOver">Show the answer</button>`}</div>`;
}

function viewOver() {
  const g = C.M.game;
  if (!g.solution) return viewTable();
  const w = g.winner ? seat(g.winner) : null;
  return `<header class="head head--center">${brand()}<p class="eyebrow">Case closed</p><h1 class="display">${w ? `${esc(w.name)} solved it` : 'The answer'}</h1></header>
  <div class="trio">${CATS.map(c => pcard(card(g.solution[c]), 'pcard--sm')).join('')}</div>
  <p class="sentence">${sentence()}</p>
  <section class="notes"><h2 class="h2">Who held what</h2>
    <ul class="holdings">${C.M.seats.map(s => `<li><p>${who(s)}</p><p class="entry-cards">${g.hands[s.id].map(id => cc(card(id))).join('')}</p></li>`).join('')}</ul></section>
  <div class="bar">${isHost() ? `<button class="btn btn--primary btn--big" data-act="newGame">New game</button>` : '<p class="sub">The host phone can start a new game.</p>'}</div>`;
}

const VIEWS = {
  setup: viewSetup, join: viewJoin, lobby: viewLobby, waitHost: viewWaitHost,
  deal: viewDeal, scan: viewScan, hands: viewHands, enter: () => viewEnter(), ready: viewReady,
  hand: viewHand, whose: viewWhose, table: viewTable, suggest: viewSuggest, answer: viewAnswer,
  accuse: viewAccuse, accused: viewAccused, over: viewOver,
};

export function draw(ctx) {
  C = ctx;
  return (VIEWS[ctx.view.name] || viewTable)();
}
