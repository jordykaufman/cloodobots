// Runs this phone as the host (it holds the game) or as a phone that has joined one.
// Either way the screens come from views.js, drawn from the model the host hands out.

import { newState, dispatch, modelFor, HOST, nextName, tidyClaims, EDITIONS, clone, validateSetup, CATS } from './engine.js';
import { draw, previewText, draftReady } from './views.js';
import { hostLink, joinLink, newCode, cleanCode } from './net.js';
import { cameraAvailable, startScanner, makeVoice } from './scan.js';
import { store, loadScript, keepAwake, lib } from './util.js';

const QR_JS = 'https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/dist/qrcode.js';
const K = { host: 'crp/host', client: 'crp/client', ui: 'crp/ui', device: 'crp/device', role: 'crp/role' };
const GAME_VIEWS = new Set(['deal', 'scan', 'hands', 'enter', 'ready', 'hand', 'whose', 'table', 'suggest', 'answer', 'accuse', 'accused', 'over']);

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');

const R = {
  role: 'host',
  state: null,
  code: null,
  link: null,
  linking: false,
  linkStatus: '',
  online: new Set(),
  M: null,
  device: store.get(K.device),
  ui: freshUi(),
  scan: freshScan(),
  qr: '',
  storageOK: store.works(),
  cameraOK: cameraAvailable(),
};
if (!R.device) { R.device = 'd' + Math.random().toString(36).slice(2, 12); store.set(K.device, R.device); }

function freshUi() { return { view: { name: 'setup' }, phase: null, logSeen: null, shownSeen: {} }; }
function freshScan() { return { running: false, state: '', progress: 0, got: 0, error: '', torch: false, torchOn: false }; }
const joinUrl = () => `${location.origin}${location.pathname}?join=${R.code}`;

/* ---------- host ---------- */
function hostBoot() {
  if (R.link) { R.link.close(); R.link = null; }
  R.role = 'host';
  store.set(K.role, 'host');
  const saved = store.get(K.host);
  R.state = saved && saved.state && saved.state.setup ? saved.state : newState();
  // A card set that no longer exists (the printed deck now has the same cards as Clue
  // 2013) falls back to the default one.
  const st = R.state.setup;
  if (st.edition !== 'custom' && !EDITIONS[st.edition]) { st.edition = 'clue2013'; st.cards = clone(EDITIONS.clue2013.cards); }
  R.code = (saved && saved.code) || newCode();
  R.M = null;
  const ui = store.get(K.ui);
  R.ui = ui && ui.role === 'host' ? ui : freshUi();
  ensureLink();
  hostRefresh();
}

function hostSave() { store.set(K.host, { state: R.state, code: R.code }); }

function hostRefresh() {
  hostSave();
  R.online = R.link ? R.link.online() : new Set();
  if (R.link) for (const d of R.online) R.link.send(d, { t: 'model', model: modelFor(R.state, d, R.online) });
  setModel(modelFor(R.state, HOST, R.online));
}

let typingTimer = null;
function hostRefreshSoon() {
  hostSave();
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    R.online = R.link ? R.link.online() : new Set();
    if (R.link) for (const d of R.online) R.link.send(d, { t: 'model', model: modelFor(R.state, d, R.online) });
    R.M = modelFor(R.state, HOST, R.online);
  }, 400);
}

function ensureLink() {
  const want = R.state.setup.phones === 'many';
  if (want && !R.link && !R.linking) {
    R.linking = true;
    R.linkStatus = 'starting';
    hostLink({
      code: R.code,
      onHello: () => hostRefresh(),
      onLeave: () => hostRefresh(),
      onAction: (device, action, id) => {
        const r = dispatch(R.state, device, action, R.link ? R.link.online() : new Set());
        if (r.error && R.link) R.link.send(device, { t: 'reply', id, error: r.error });
        hostRefresh();
      },
      onStatus: s => { R.linkStatus = s; render(); },
    }).then(link => {
      R.linking = false;
      if (R.state.setup.phones !== 'many' || R.role !== 'host') { link.close(); return; }
      R.link = link;
      hostRefresh();
    }).catch(() => { R.linking = false; R.linkStatus = 'offline'; render(); });
    makeQr();
  } else if (!want && R.link) {
    R.link.close();
    R.link = null;
    R.state.claims = {};
  }
}

async function makeQr() {
  try {
    await loadScript(lib('qrcode', QR_JS));
    const q = window.qrcode(0, 'M');
    q.addData(joinUrl());
    q.make();
    R.qr = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    render();
  } catch (e) { R.qr = ''; }
}

/* ---------- joining ---------- */
function clientBoot(code) {
  if (R.link) { R.link.close(); R.link = null; }
  R.role = 'client';
  R.code = code;
  R.M = null;
  R.linkStatus = 'connecting';
  store.set(K.role, 'client');
  store.set(K.client, { code });
  const ui = store.get(K.ui);
  R.ui = ui && ui.role === 'client' && ui.code === code ? ui : freshUi();
  R.ui.view = R.ui.view && GAME_VIEWS.has(R.ui.view.name) ? R.ui.view : { name: 'waitHost' };
  joinLink({
    code,
    device: R.device,
    onModel: m => setModel(m),
    onReply: r => { if (r.error) { toast(r.error); if (R.ui.view.sending) { R.ui.view.sending = false; render(); } } },
    onStatus: s => { R.linkStatus = s; render(); },
  }).then(link => { if (R.role === 'client' && R.code === code) R.link = link; else link.close(); })
    .catch(() => { R.linkStatus = 'missing'; render(); });
  render();
}

function showJoinForm(code = '') {
  if (R.link) { R.link.close(); R.link = null; }
  R.role = 'client';
  R.code = code;
  R.M = null;
  R.linkStatus = '';
  R.ui = freshUi();
  R.ui.view = { name: 'join' };
  render();
}

function leaveGame() {
  if (R.link) { R.link.close(); R.link = null; }
  store.remove(K.client);
  hostBoot();
}

/* ---------- doing things ---------- */
// Sends an action to the game. On the host it applies at once; from another phone it
// goes to the host, which answers with a fresh model.
function act(action) {
  if (R.role === 'host') {
    const r = dispatch(R.state, HOST, action, R.online);
    if (r.error) { toast(r.error); return false; }
    hostRefresh();
    return true;
  }
  if (!R.link || !R.link.send(action)) { toast('Not connected to the host phone yet. Trying again…'); return false; }
  return true;
}

function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { $toast.hidden = true; }, 4200);
}

/* ---------- following the game ---------- */
function setModel(m) {
  R.M = m;
  follow(m);
  render();
}

// Moves this phone to the screen the game now calls for: a new phase, a new suggestion
// or accusation, or a card that has just been shown to one of this phone's players.
function follow(m) {
  const ui = R.ui;
  if (m.phase !== ui.phase) {
    const from = ui.phase;
    ui.phase = m.phase;
    const L = m.game ? m.game.log.length : 0;
    ui.logSeen = L;
    ui.shownSeen = {};
    if (m.phase === 'setup') ui.view = { name: R.role === 'host' ? 'setup' : 'lobby' };
    else if (m.phase === 'deal') ui.view = { name: ui.view.name === 'scan' ? 'scan' : 'deal' };
    else if (m.phase === 'hands') ui.view = { name: 'hands' };
    else if (m.phase === 'play') ui.view = { name: ['setup', 'deal', 'hands'].includes(from) ? 'ready' : (GAME_VIEWS.has(ui.view.name) ? ui.view.name : 'table'), ...(['setup', 'deal', 'hands'].includes(from) ? {} : ui.view) };
    else if (m.phase === 'over' && ui.view.name !== 'accused') ui.view = { name: 'over' };
  }
  if (!m.game) return;
  const L = m.game.log.length;
  if (ui.logSeen == null || L < ui.logSeen) ui.logSeen = L;
  if (L > ui.logSeen) {
    const e = m.game.log[L - 1];
    ui.logSeen = L;
    ui.view = e.type === 'suggest' ? { name: 'answer', n: e.n, stage: 'summary' } : { name: 'accused', idx: L - 1 };
  }
  for (const id of m.mine) {
    const shown = (m.priv[id] && m.priv[id].shown) || [];
    const seen = ui.shownSeen[id];
    if (seen == null || shown.length < seen) { ui.shownSeen[id] = shown.length; continue; }
    if (shown.length > seen) {
      ui.shownSeen[id] = shown.length;
      const x = shown[shown.length - 1];
      if (!(ui.view.name === 'answer' && ui.view.n === x.n)) ui.view = { name: 'answer', n: x.n, stage: 'summary' };
    }
  }
}

/* ---------- drawing ---------- */
let lastKey = '';
function render() {
  const ui = R.ui;
  let v = ui.view;
  // Fall back to a screen that makes sense for what this phone knows.
  if (R.role === 'host' && R.M && !R.M.game && v.name !== 'setup' && v.name !== 'join') v = ui.view = { name: 'setup' };
  if (R.role === 'client' && v.name !== 'join') {
    if (!R.M) v = ui.view = { name: 'waitHost' };
    else if (!R.M.game) { if (v.name !== 'lobby') v = ui.view = { name: 'lobby' }; }
    else if (!GAME_VIEWS.has(v.name)) v = ui.view = { name: 'table' };
  }
  if (R.M && R.M.game && R.M.phase === 'over' && v.name === 'table') v = ui.view = { name: 'over' };

  const net = { code: R.code, status: R.linkStatus, qr: R.qr, url: R.code ? joinUrl() : '' };
  let netChip = '';
  if (R.role === 'host' && R.M && R.M.setup.phones === 'many') {
    const n = R.online.size;
    netChip = `<span class="netchip">${n} other phone${n === 1 ? '' : 's'} · code ${R.code}</span>`;
  }
  const lost = R.role === 'client' && R.M && R.linkStatus !== 'connected'
    ? `<p class="lostbar" role="status">Reconnecting to the host phone…</p>` : '';
  $app.innerHTML = lost + draw({
    M: R.M, view: v, role: R.role, setup: R.state && R.state.setup, net, netChip,
    scan: R.scan, storageOK: R.storageOK, cameraOK: R.cameraOK,
  });
  store.set(K.ui, { ...ui, role: R.role, code: R.role === 'client' ? R.code : null });

  const key = [v.name, v.stage, v.seat, v.n, v.i, v.open, v.idx].join('|');
  if (key !== lastKey) {
    lastKey = key;
    window.scrollTo(0, 0);
    const h = $app.querySelector('.curtain button') || $app.querySelector('h1');
    if (h) {
      if (h.tagName === 'H1') h.setAttribute('tabindex', '-1');
      try { h.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
  }
}

/* ---------- scanning the envelope ---------- */
let scanner = null;
const voice = makeVoice();
let slots = {}, lastSeen = { id: null, at: 0 };

async function scanStart() {
  voice.unlock();
  keepAwake();
  if (scanner) scanner.stop();
  scanner = null;
  slots = {};
  lastSeen = { id: null, at: 0 };
  R.scan = { ...freshScan(), running: true, state: 'loading' };
  render();
  try {
    const s = await startScanner({
      cards: R.state.game.deck,
      onStatus: (state, progress) => {
        if (!R.scan.running) return;
        const changed = state !== R.scan.state || (progress != null && Math.round(progress * 20) !== Math.round(R.scan.progress * 20));
        R.scan.state = state;
        if (progress != null) R.scan.progress = progress;
        if (changed && R.ui.view.name === 'scan') render();
      },
      onCard: scanned,
    });
    if (!R.scan.running) { s.stop(); return; }
    scanner = s;
    R.scan.torch = s.torch.available;
    if (s.torch.available) R.scan.torchOn = await s.torch.set(true);
    voice.say('Scanning. Lay the phone face down.');
    render();
  } catch (e) {
    R.scan.running = false;
    R.scan.error = e && e.name === 'NotAllowedError'
      ? 'Camera access was blocked. Allow the camera for this site in your browser’s settings, then try again.'
      : e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError')
        ? 'This phone doesn’t have a camera the browser can use.'
        : 'The camera or the card reader didn’t start. Check this phone is online, then try again.';
    render();
  }
}

function scanned(c) {
  const now = Date.now();
  const repeat = lastSeen.id === c.id && now - lastSeen.at < 6000;
  lastSeen = { id: c.id, at: now };
  if (Object.values(slots).includes(c.id)) { if (!repeat) voice.oops('Already scanned that one. Try the next card.'); return; }
  if (slots[c.cat]) { if (!repeat) voice.oops('That one doesn’t fit. The envelope needs one suspect, one weapon and one room.'); return; }
  slots[c.cat] = c.id;
  R.scan.got = Object.keys(slots).length;
  if (R.scan.got < 3) {
    voice.got(R.scan.got === 1 ? 'Got it. Two to go.' : 'Got it. One more.');
    render();
    return;
  }
  voice.done('All three scanned. Put them in the envelope and seal it.');
  const envelope = { ...slots };
  scanStop();
  slots = {};
  R.ui.view = { name: 'deal' };
  act({ type: 'scanDone', envelope });
}

function scanStop() {
  if (scanner) scanner.stop();
  scanner = null;
  R.scan = freshScan();
}

/* ---------- buttons ---------- */
const seatOf = d => R.M.seats.find(s => s.id === d.seat);
const mineIn = () => R.M.mine.map(id => R.M.seats.find(s => s.id === id)).filter(s => s && !s.out);
function defaultAsker() {
  const act = mineIn();
  if (!act.length) return null;
  const order = R.M.seats.map(s => s.id);
  const last = R.M.game.lastBy;
  if (last && act.length > 1) {
    const i = order.indexOf(last);
    const next = order.slice(i + 1).concat(order.slice(0, i + 1)).find(id => act.some(s => s.id === id));
    if (next) return next;
  }
  return act[0].id;
}
function setupChanged() {
  tidyClaims(R.state);
  R.state.rev++;
  hostRefresh();
}

const A = {
  open() { R.ui.view.open = true; },
  confirm(d) { R.ui.view.confirm = d.what || null; },

  // setup (host)
  addSeat(d) {
    const st = R.state.setup, robot = d.robot === '1';
    if (st.seats.length >= 10) return toast('Ten players is the most this app handles.');
    st.seats.push({ id: Math.random().toString(36).slice(2, 9), name: nextName(st, robot), robot });
    setupChanged();
  },
  toggleKind(d) {
    const s = R.state.setup.seats[+d.i];
    s.robot = !s.robot;
    const name = s.name.trim();
    if (s.robot && /^Player \d+$/.test(name)) s.name = nextName(R.state.setup, true);
    else if (!s.robot && (/^Robot \d+$/.test(name) || EDITIONS && ['Butler Bot', 'Lady Gigabyte', 'Sergeant Sprocket', 'Professor Pixel', 'Madame Modem', 'Captain Circuit'].includes(name))) s.name = nextName(R.state.setup, false);
    setupChanged();
  },
  moveSeat(d) {
    const a = R.state.setup.seats, i = +d.i, j = i + Number(d.d);
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    setupChanged();
  },
  removeSeat(d) {
    if (R.state.setup.seats.length > 2) R.state.setup.seats.splice(+d.i, 1);
    setupChanged();
  },
  start() {
    const err = validateSetup(R.state.setup);
    if (err) { const el = document.getElementById('setupError'); if (el) el.textContent = err; return; }
    keepAwake();
    act({ type: 'start' });
  },
  copyLink() {
    const done = () => toast('Join link copied.');
    try {
      navigator.clipboard.writeText(joinUrl()).then(done, () => selectLink());
    } catch (e) { selectLink(); }
  },
  release(d) { act({ type: 'release', seat: d.seat }); },
  toJoin() { showJoinForm(); },
  toHost() { leaveGame(); },

  // joining
  claim(d) { R.ui.view.changing = false; act({ type: 'claim', seat: d.seat }); render(); },
  changeSeat() { R.ui.view.changing = true; },
  leave() { leaveGame(); },

  // dealing
  toScan() { R.scan = freshScan(); R.ui.view = { name: 'scan' }; },
  scanStart() { scanStart(); },
  scanRestart() { scanStart(); },
  scanCancel() { scanStop(); R.ui.view = { name: 'deal' }; },
  scanSkip() { scanStop(); R.ui.view = { name: 'deal' }; act({ type: 'scanSkip' }); },
  rescan() { act({ type: 'scanReset' }); },
  async torch() {
    if (!scanner) return;
    R.scan.torchOn = (await scanner.torch.set(!R.scan.torchOn)) ? !R.scan.torchOn : R.scan.torchOn;
    render();
  },
  dealt() { act({ type: 'dealt' }); },
  newGame() { scanStop(); R.ui.view = { name: 'setup' }; act({ type: 'newGame' }); },

  // hands
  enter(d) { R.ui.view = { name: 'enter', seat: d.seat, open: false }; },
  saveHand(d) {
    const sel = R.ui.view.sel || R.M.priv[d.seat].entry;
    if (act({ type: 'hand', seat: d.seat, cards: sel }) && R.M.phase === 'hands') R.ui.view = { name: 'hands' };
  },
  unsubmit(d) { act({ type: 'unsubmit', seat: d.seat }); R.ui.view = { name: 'hands' }; },

  // looking at cards
  peekAll() {
    const seats = R.M.mine;
    R.ui.view = { name: 'hand', seat: seats[0], initial: true, i: 0, open: false };
  },
  hideHand() {
    const v = R.ui.view, seats = R.M.mine;
    if (v.initial && v.i + 1 < seats.length) R.ui.view = { name: 'hand', seat: seats[v.i + 1], initial: true, i: v.i + 1, open: false };
    else R.ui.view = { name: 'table' };
  },
  toWhose() {
    const seats = R.M.mine;
    R.ui.view = seats.length === 1 ? { name: 'hand', seat: seats[0], open: false } : { name: 'whose' };
  },
  viewHand(d) { R.ui.view = { name: 'hand', seat: d.seat, open: false }; },
  toTable() { R.ui.view = { name: 'table' }; },
  toOver() { R.ui.view = { name: 'over' }; },

  // suggestions
  toSuggest() { if (mineIn().length) R.ui.view = { name: 'suggest', draft: { by: defaultAsker() } }; },
  askTable() {
    const d = R.ui.view.draft;
    if (!draftReady(d) || R.ui.view.sending) return;
    R.ui.view.sending = true;
    if (!act({ type: 'suggest', by: d.by, picks: CATS.map(c => d[c]) })) R.ui.view.sending = false;
  },
  stage(d) { R.ui.view.stage = d.stage; R.ui.view.open = false; },
  showCard(d) {
    const n = Number(d.n);
    const e = R.M.game.log.find(x => x.type === 'suggest' && x.n === n);
    if (!act({ type: 'pick', n, card: d.card })) return;
    if (R.M.mine.includes(e.by)) R.ui.view = { name: 'answer', n, stage: 'reveal', open: false };
    else { R.ui.view = { name: 'table' }; toast(`Shown to ${R.M.seats.find(s => s.id === e.by).name}.`); }
  },

  // accusations
  toAccuse() {
    const last = R.M.game.lastBy;
    const by = last && mineIn().some(s => s.id === last) ? last : defaultAsker();
    if (by) R.ui.view = { name: 'accuse', draft: { by }, confirming: false };
  },
  accuseCheck() { if (draftReady(R.ui.view.draft)) R.ui.view.confirming = true; },
  accuseBack() { R.ui.view.confirming = false; },
  accuseFinal() {
    const d = R.ui.view.draft;
    act({ type: 'accuse', by: d.by, picks: CATS.map(c => d[c]) });
  },
  giveUp() { act({ type: 'giveUp' }); },
};

function selectLink() {
  const el = document.getElementById('joinUrl');
  if (!el) return;
  const r = document.createRange();
  r.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  toast('Copy the selected link.');
}

$app.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled || !$app.contains(b)) return;
  const fn = A[b.dataset.act];
  if (!fn) return;
  const before = R.ui.view;
  const r = fn(b.dataset);
  if (r && typeof r.then === 'function') return;
  // Actions that went through act() have already redrawn; this covers screen-only changes.
  if (R.ui.view === before || R.role === 'client' || !['start', 'dealt'].includes(b.dataset.act)) render();
});

$app.addEventListener('submit', e => {
  const f = e.target.closest('[data-form="join"]');
  if (!f) return;
  e.preventDefault();
  const code = cleanCode(document.getElementById('joinCode').value);
  if (code.length !== 5) { toast('Join codes are five letters and numbers.'); return; }
  clientBoot(code);
});

$app.addEventListener('input', e => {
  const t = e.target, k = t.dataset.in;
  if (R.role !== 'host' || !R.state) return;
  const st = R.state.setup;
  if (k === 'seatName') st.seats[+t.dataset.i].name = t.value;
  else if (k === 'cards') {
    st.cards[t.dataset.cat] = t.value.split('\n');
    st.edition = 'custom';
    const sel = document.getElementById('edition');
    if (sel) sel.value = 'custom';
  } else return;
  const p = document.getElementById('preview');
  if (p) p.innerHTML = previewText(st);
  const err = document.getElementById('setupError');
  if (err) err.textContent = '';
  R.state.rev++;
  hostRefreshSoon();
});

$app.addEventListener('change', e => {
  const t = e.target, k = t.dataset.in, v = R.ui.view;
  if (k === 'edition' && R.role === 'host') {
    R.state.setup.edition = t.value;
    if (EDITIONS[t.value]) R.state.setup.cards = clone(EDITIONS[t.value].cards);
    setupChanged();
  } else if (k === 'setupOpt' && R.role === 'host') {
    R.state.setup[t.name] = t.value;
    if (t.name === 'phones') ensureLink();
    setupChanged();
  } else if (k === 'draft') {
    v.draft[t.dataset.key] = t.value;
    if (v.confirming) { v.confirming = false; render(); return; }
    const go = document.getElementById('go');
    if (go) go.disabled = !draftReady(v.draft);
  } else if (k === 'handCard') {
    const btn = document.getElementById('saveHand');
    const seatId = btn && btn.dataset.seat;
    if (!seatId) return;
    const set = new Set(v.sel || R.M.priv[seatId].entry);
    if (t.checked) set.add(t.value); else set.delete(t.value);
    v.sel = [...set];
    const need = R.M.game.counts[seatId];
    const c = document.getElementById('count');
    if (c) {
      c.textContent = set.size > need ? `${set.size} picked. That’s ${set.size - need} too many.` : set.size === need ? `${need} of ${need}. Ready.` : `${set.size} of ${need} picked`;
      c.classList.toggle('count--over', set.size > need);
    }
    btn.disabled = set.size !== need;
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && R.M && R.M.game && R.M.phase !== 'over') keepAwake();
});

/* ---------- start ---------- */
function boot() {
  const params = new URLSearchParams(location.search);
  const join = cleanCode(params.get('join'));
  if (join) {
    history.replaceState(null, '', location.pathname);
    clientBoot(join);
    return;
  }
  const saved = store.get(K.client);
  if (store.get(K.role) === 'client' && saved && saved.code) { clientBoot(saved.code); return; }
  hostBoot();
  // After a reload, close any private screen that was left open.
  if (R.ui.view.open) { R.ui.view.open = false; render(); }
}
boot();
