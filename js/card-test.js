// The card back reader test page: a live scan with the camera, or one photo, and what
// the reader found out.

import { grayOf, readLayout } from './backs.js';
import { CARD_MARKERS, DECOY, REG_MARK } from './markers.js';
import { openScanner, paintMap, describeScan } from './scan-screen.js';
import { esc } from './util.js';
import { UPDATED } from './version.js';

const NAME = Object.fromEntries(Object.entries(CARD_MARKERS).map(([n, id]) => [id, n]));
const FIRST_TEST = 22, SIZES = [6, 8, 10, 12], SHADES = [100, 75, 50];
const isTest = id => id >= FIRST_TEST && id !== REG_MARK;
// Phones take photos of up to 48 megapixels; 12 is plenty, and browsers on phones
// refuse canvases much bigger than that.
const MAX_SIDE = 4032;

const $ = id => document.getElementById(id);

// The photo last read and what the page said about it, for the save button.
let last = null;

async function loadPhoto(file) {
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That file isn’t a photo this browser can open.'));
      img.src = URL.createObjectURL(file);
    });
  }
  const sw = source.width || source.naturalWidth, sh = source.height || source.naturalHeight;
  const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const w = Math.round(sw * scale), h = Math.round(sh * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  return { canvas, ctx, w, h };
}

function draw(photo, res) {
  const shot = $('shot');
  shot.style.height = '';
  const scale = Math.min(1, 1600 / Math.max(photo.w, photo.h));
  shot.width = Math.round(photo.w * scale);
  shot.height = Math.round(photo.h * scale);
  const ctx = shot.getContext('2d');
  ctx.drawImage(photo.canvas, 0, 0, shot.width, shot.height);
  const lw = Math.max(2, shot.width / 400);
  for (const m of res.markers) {
    ctx.strokeStyle = m.id === DECOY ? '#9AA4B2' : isTest(m.id) ? '#3A7BD5' : m.id === REG_MARK ? '#C9A24A' : '#2D9C5B';
    ctx.lineWidth = lw;
    ctx.beginPath();
    m.corners.forEach(([x, y], i) => (i ? ctx.lineTo(x * scale, y * scale) : ctx.moveTo(x * scale, y * scale)));
    ctx.closePath();
    ctx.stroke();
  }
  // The circle the reader fitted round each card's bezel: green when the ring named
  // the card, red when it didn't.
  for (const [list, colour] of [[res.cards, '#2D9C5B'], [res.unread || [], '#C8402E']]) {
    for (const card of list) {
      if (!card.ring) continue;
      const { c, M } = card.ring, R = 16;
      ctx.strokeStyle = colour;
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (let k = 0; k <= 48; k++) {
        const t = k * Math.PI / 24, u = R * Math.sin(t), v = -R * Math.cos(t);
        const x = (c[0] + M[0] * u + M[1] * v) * scale, y = (c[1] + M[2] * u + M[3] * v) * scale;
        if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
  }
  ctx.font = `700 ${Math.round(shot.width / 45)}px Figtree, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  res.rows.forEach((row, r) => row.forEach((card, i) => {
    if (!NAME[card.id] || !card.centre) return;
    const [x, y] = card.centre;
    const label = `${r + 1}·${i + 1}`;
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    const tw = ctx.measureText(label).width + 14;
    ctx.fillRect(x * scale - tw / 2, y * scale - shot.width / 60, tw, shot.width / 30);
    ctx.fillStyle = '#172030';
    ctx.fillText(label, x * scale, y * scale);
  }));
}

// Shows what was found. `res.groups`, from a live scan, holds the table's separate
// groups of cards, each with its rows; with `map`, the picture is the table as the scan
// pieced it together instead of the photo.
function show(photo, res, how, map) {
  const cards = res.cards.filter(c => NAME[c.id]);
  const tests = new Set(res.markers.map(m => m.id).filter(isTest));
  const groups = (res.groups || [{ rows: res.rows }])
    .map(g => ({ ...g, rows: g.rows.map(r => r.filter(c => NAME[c.id])).filter(r => r.length) })).filter(g => g.rows.length);
  const rows = groups.flatMap(g => g.rows), placed = groups.filter(g => !g.unplaced).length;

  let summary;
  if (cards.length) {
    summary = `Found ${cards.length} of ${Object.keys(CARD_MARKERS).length} cards` +
      (rows.length > 1 ? `, in ${rows.length} rows` : '') + (placed > 1 ? ` across ${placed} separate groups` : '') + '.';
  }
  else if (tests.size) summary = `Read ${tests.size} of ${SIZES.length * SHADES.length} size test markers.`;
  else summary = 'No markers found. Try again closer, with the cards filling most of the photo.';
  $('summary').textContent = summary;

  // Problems, in red; which cards haven't been seen at all is in the tally. Once every
  // card in the deck has been found, cards a picture couldn't read are no problem. A live
  // scan says which cards it saw but never identified (`waiting`, from its map) rather
  // than what its last frame couldn't read.
  const notes = [];
  const everything = cards.length >= Object.keys(CARD_MARKERS).length;
  if (everything) {
    res = { ...res, unread: [], loose: [], waiting: res.waiting && [] };
    if (map) map = { ...map, groups: map.groups.map(g => ({ ...g, waiting: [] })) };
  }
  if (res.waiting) {
    if (res.waiting.length) notes.push(`${res.waiting.length} card${res.waiting.length === 1 ? '' : 's'} seen but never identified: marked ? on the table below.`);
  } else {
    if (res.unread && res.unread.length) notes.push(`${res.unread.length} card${res.unread.length === 1 ? '' : 's'} seen but not named: the ring didn’t match any card.`);
    const hidden = Math.ceil((res.loose || []).filter(m => m.whole).length / 4 - 0.25);
    if (hidden) notes.push(`${hidden} card${hidden === 1 ? '' : 's'} with corner marks but no compass the reader could find, probably under glare.`);
  }
  if (res.doubles.length) notes.push(`Seen twice in different places: ${res.doubles.map(id => NAME[id] || `marker ${id}`).join(', ')}.`);
  $('missing').textContent = notes.join(' ');
  $('missing').hidden = !notes.length;
  // How well the rings read, for judging the printing.
  const rings = cards.filter(c => c.ring);
  const quality = rings.length ? `Rings matched with at most ${Math.max(...rings.map(c => c.errors))} of 72 ticks misread; the faintest ticks stood ${Math.round(Math.min(...rings.map(c => c.contrast)))} grey levels above the navy (above 20 is comfortable).` : '';
  $('quality').textContent = quality;
  $('quality').hidden = !quality;

  $('rowsBox').hidden = !rows.length;
  $('rowsTitle').textContent = res.groups ? 'Rows on the table' : rows.length > 1 ? 'Rows, from the top of the photo' : 'Cards found';
  const rowName = (g, gi, r) => g.unplaced ? 'Counted, not placed on the map' : `${placed > 1 ? `Group ${gi + 1} · row` : 'Row'} ${r + 1}`;
  $('rows').innerHTML = groups.map((g, gi) => g.rows.map((row, r) => `<li><p class="label">${rowName(g, gi, r)} · ${row.length} card${row.length === 1 ? '' : 's'}</p>
    <p class="entry-cards">${row.map(c => `<span class="cc"><span>${esc(NAME[c.id])}</span></span>`).join('')}</p></li>`).join('')).join('');

  $('sizesBox').hidden = !tests.size;
  $('sizes').innerHTML = `<tr><th scope="col"></th>${SIZES.map(s => `<th scope="col">${s} mm</th>`).join('')}</tr>` +
    SHADES.map((sh, r) => `<tr><th scope="row">${sh}%</th>${SIZES.map((s, c) => tests.has(FIRST_TEST + r * SIZES.length + c)
      ? '<td class="yes">read</td>' : '<td class="no">–</td>').join('')}</tr>`).join('');

  $('results').hidden = false;
  $('shotTitle').textContent = map ? 'The table, as the scan pieced it together' : 'What the reader saw';
  $('shotKey').hidden = !!map;
  if (map) paintMap($('shot'), map, { label: id => NAME[id] || `#${id}`, width: $('shot').parentElement.clientWidth });
  else draw(photo, res);
  $('status').textContent = how;
  return [summary, ...notes, quality, ...groups.flatMap((g, gi) => g.rows.map((row, r) => `${rowName(g, gi, r)}: ${row.map(c => NAME[c.id]).join(', ')}`))].join('\n');
}

const stamp = () => {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

// Hands the photo on, untouched, with what the page said about it: through the phone's
// share sheet where there is one (to Google Drive, a message, an email), otherwise as
// a download.
async function save() {
  if (!last) return;
  const ext = (last.file.name.match(/\.(\w+)$/) || [, last.file.type.split('/')[1] || 'jpg'])[1].replace(/^jpeg$/i, 'jpg');
  const file = new File([last.file], `card-test-${stamp()}.${ext}`, { type: last.file.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Card back test photo', text: last.text });
    } catch (e) {
      if (e.name !== 'AbortError') $('status').textContent = `Couldn’t share the photo: ${e.message}`;
    }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

async function handle(file) {
  if (!file) return;
  $('status').textContent = 'Reading the photo…';
  $('results').hidden = true;
  await new Promise(r => setTimeout(r, 30));
  try {
    const photo = await loadPhoto(file);
    const t0 = performance.now();
    const data = photo.ctx.getImageData(0, 0, photo.w, photo.h).data;
    const res = readLayout(grayOf(data, photo.w, photo.h));
    last = { file, text: show(photo, res, `Read a ${photo.w} × ${photo.h} photo in ${((performance.now() - t0) / 1000).toFixed(1)} s.`) };
    addToTally(res);
  } catch (e) {
    $('status').textContent = e.message || 'Something went wrong reading that photo.';
  }
}

/* ---------- the tally across scans ---------- */

// Every card seen since the page opened or Start over, so a deck can be scanned a few
// cards at a time.
const tally = new Set();
let scans = 0;

function addToTally(res) {
  const ids = res.cards.map(c => c.id).filter(id => NAME[id]);
  if (!ids.length) return;
  ids.forEach(id => tally.add(id));
  scans++;
  const all = Object.keys(CARD_MARKERS).length;
  const missing = Object.entries(CARD_MARKERS).filter(([, id]) => !tally.has(id)).map(([n]) => n);
  $('tally').textContent = `So far: ${tally.size} of ${all} cards, from ${scans} scan${scans === 1 ? '' : 's'}. ` +
    (missing.length ? `Not seen yet: ${missing.join(', ')}.` : 'Every card seen.');
  $('tally').hidden = false;
}

function startOver() {
  tally.clear();
  scans = 0;
  last = null;
  $('tally').hidden = true;
  $('results').hidden = true;
  $('status').textContent = 'Started over.';
}

/* ---------- live scan ---------- */

let live = null;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const DECK_SIZE = Object.keys(CARD_MARKERS).length;
const nameOf = id => NAME[id] || `#${id}`;

// How many cards the scan should find before it stops: the whole deck, a number, or
// however many there are (0), when it stops once the phone is held still.
const EXPECT_KEY = 'crp/cardtest-expect';
function setupExpect() {
  const sel = $('expect');
  const options = [[DECK_SIZE, `all ${DECK_SIZE} cards`], ...Array.from({ length: DECK_SIZE - 1 }, (_, i) => [DECK_SIZE - 1 - i, plural(DECK_SIZE - 1 - i, 'card')]), [0, 'however many there are']];
  sel.innerHTML = options.map(([v, label]) => `<option value="${v}">${label}</option>`).join('');
  let saved = null;
  try { saved = localStorage.getItem(EXPECT_KEY); } catch (e) { /* not kept */ }
  sel.value = saved !== null && options.some(([v]) => String(v) === saved) ? saved : String(DECK_SIZE);
  sel.addEventListener('change', () => { try { localStorage.setItem(EXPECT_KEY, sel.value); } catch (e) { /* not kept */ } });
}
const expected = () => Number($('expect').value) || 0;

// The cards still to find, named while there are only a few, when scanning the whole deck.
function toGo(v) {
  const want = expected();
  if (!want || v.count >= want) return '';
  const left = want - v.count;
  if (want !== DECK_SIZE) return ` ${left} to go.`;
  const have = new Set(v.ids), names = Object.entries(CARD_MARKERS).filter(([, id]) => !have.has(id)).map(([n]) => n);
  return names.length <= 4 ? ` Still to find: ${names.join(', ')}.` : ` ${left} to go.`;
}

function stopLive(message) {
  if (live) live.stop();
  live = null;
  if (message) $('status').textContent = message;
}

// What the scan found, laid out for the results: the groups of cards on the map, each
// with its rows, any card counted but never placed on the map, and the cards it saw but
// never identified (none when it found all it was looking for).
function scanResult(found, final, map, complete) {
  const byId = new Map(found.map(c => [c.id, c]));
  const groups = (map ? map.groups : []).map(g => ({ rows: g.rows.map(r => r.filter(id => byId.has(id)).map(id => byId.get(id))).filter(r => r.length) }))
    .filter(g => g.rows.length);
  const placed = new Set(groups.flatMap(g => g.rows.flat().map(c => c.id)));
  const unplaced = found.filter(c => !placed.has(c.id));
  if (unplaced.length) groups.push({ rows: [unplaced], unplaced: true });
  const waiting = complete || !map ? [] : map.groups.flatMap(g => g.waiting);
  return { markers: final ? final.markers : [], cards: found, unread: [], loose: [], waiting, doubles: [], rows: groups.flatMap(g => g.rows), groups };
}

function startLive() {
  if (live) return;
  $('results').hidden = true;
  const want = expected();
  live = openScanner($('live'), {
    expected: want,
    label: nameOf,
    describe: v => describeScan(v, want, toGo),
    onLock({ found, map, last: final, canvas, w, h, early }) {
      live = null;
      // Cards found means frames were read, so there is a last frame to show.
      if (!found.length || !final) { $('status').textContent = 'No cards were counted. Try again a little closer.'; return; }
      last = null;
      const complete = want > 0 && found.length >= want;
      const res = scanResult(found, final, map, complete);
      const text = show({ canvas, w, h }, res, early ? `Finished by hand with ${plural(found.length, 'card')} counted.`
        : complete ? `Found all ${plural(want, 'card')} it was looking for.`
          : 'Stopped: you held still with every card in view read and nothing new turning up.', map);
      addToTally(res);
      canvas.toBlob(b => { if (b) last = { file: new File([b], 'live-scan.jpg', { type: 'image/jpeg' }), text }; }, 'image/jpeg', 0.92);
      $('results').scrollIntoView({ block: 'start', behavior: 'smooth' });
    },
    onCancel(why) {
      live = null;
      $('status').textContent = why === 'hidden' ? 'Scanning stopped when the page was hidden. Tap Scan live to carry on.' : 'Cancelled.';
    },
  });
}

if (!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
  $('scanLive').disabled = true;
  $('status').textContent = 'Live scanning needs the camera, which this browser won’t give this page. Take a photo instead.';
}
setupExpect();
// Which version of the page this is, as when it was last updated, in local time.
$('version').textContent = `This page was last updated ${new Date(UPDATED).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.`;
$('scanLive').addEventListener('click', startLive);
$('scanMore').addEventListener('click', startLive);
$('startOver').addEventListener('click', startOver);

for (const id of ['camera', 'library']) {
  $(id).addEventListener('change', e => { stopLive(); handle(e.target.files[0]); e.target.value = ''; });
}
$('save').addEventListener('click', save);
