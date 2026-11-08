// The card back reader test page: a live scan with the camera, or one photo, and what
// the reader found out.

import { grayOf, readLayout } from './backs.js';
import { CARD_MARKERS, DECOY, REG_MARK } from './markers.js';
import { startLiveScan, LOCK_READS } from './live-scan.js';
import { esc, keepAwake } from './util.js';

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
    if (!NAME[card.id]) return;
    const [x, y] = card.centre;
    const label = `${r + 1}·${i + 1}`;
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    const tw = ctx.measureText(label).width + 14;
    ctx.fillRect(x * scale - tw / 2, y * scale - shot.width / 60, tw, shot.width / 30);
    ctx.fillStyle = '#172030';
    ctx.fillText(label, x * scale, y * scale);
  }));
}

function show(photo, res, how) {
  const cards = res.cards.filter(c => NAME[c.id]);
  const tests = new Set(res.markers.map(m => m.id).filter(isTest));
  const rows = res.rows.map(r => r.filter(c => NAME[c.id])).filter(r => r.length);

  let summary;
  if (cards.length) summary = `Found ${cards.length} of ${Object.keys(CARD_MARKERS).length} cards, in ${rows.length} row${rows.length === 1 ? '' : 's'}.`;
  else if (tests.size) summary = `Read ${tests.size} of ${SIZES.length * SHADES.length} size test markers.`;
  else summary = 'No markers found. Try again closer, with the cards filling most of the photo.';
  $('summary').textContent = summary;

  // Problems, in red; which cards haven't been seen at all is in the tally.
  const notes = [];
  if (res.unread && res.unread.length) notes.push(`${res.unread.length} card${res.unread.length === 1 ? '' : 's'} seen but not named: the ring didn’t match any card.`);
  const hidden = Math.ceil((res.loose || []).filter(m => m.whole).length / 4 - 0.25);
  if (hidden) notes.push(`${hidden} card${hidden === 1 ? '' : 's'} with corner marks but no compass the reader could find, probably under glare.`);
  if (res.doubles.length) notes.push(`Seen twice in different places: ${res.doubles.map(id => NAME[id] || `marker ${id}`).join(', ')}.`);
  $('missing').textContent = notes.join(' ');
  $('missing').hidden = !notes.length;
  // How well the rings read, for judging the printing.
  const rings = cards.filter(c => c.ring);
  const quality = rings.length ? `Rings matched with at most ${Math.max(...rings.map(c => c.errors))} of 72 ticks misread; the faintest ticks stood ${Math.round(Math.min(...rings.map(c => c.contrast)))} grey levels above the navy (above 20 is comfortable).` : '';
  $('quality').textContent = quality;
  $('quality').hidden = !quality;

  $('rowsBox').hidden = !rows.length;
  $('rows').innerHTML = rows.map((row, r) => `<li><p class="label">Row ${r + 1} · ${row.length} card${row.length === 1 ? '' : 's'}</p>
    <p class="entry-cards">${row.map(c => `<span class="cc"><span>${esc(NAME[c.id])}</span></span>`).join('')}</p></li>`).join('');

  $('sizesBox').hidden = !tests.size;
  $('sizes').innerHTML = `<tr><th scope="col"></th>${SIZES.map(s => `<th scope="col">${s} mm</th>`).join('')}</tr>` +
    SHADES.map((sh, r) => `<tr><th scope="row">${sh}%</th>${SIZES.map((s, c) => tests.has(FIRST_TEST + r * SIZES.length + c)
      ? '<td class="yes">read</td>' : '<td class="no">–</td>').join('')}</tr>`).join('');

  $('results').hidden = false;
  draw(photo, res);
  $('status').textContent = how;
  return [summary, ...notes, quality, ...rows.map((row, r) => `Row ${r + 1}: ${row.map(c => NAME[c.id]).join(', ')}`)].join('\n');
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

let live = null, starting = false, audio = null;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function describe(v) {
  switch (v.state) {
    case 'partial': return 'I can see card corners. Get whole cards in view.';
    case 'unclear':
      if (!v.unread) return 'Hold steady…';
      return v.small ? `Can’t read ${plural(v.unread, 'card')} yet: move a little closer.`
        : `Can’t read ${plural(v.unread, 'card')}: tilt away from the light, or hold steadier.`;
    case 'steadying': return `Reading ${plural(v.cards.length, 'card')}: hold still…`;
    case 'locked': return `Got ${plural(v.cards.length, 'card')}.`;
    default: return 'Point the camera at the cards, lying face-down.';
  }
}

function setSteady(n) {
  [...$('steady').children].forEach((el, i) => el.classList.toggle('on', i < n));
}

// Draws what the last read found over the camera view: each card's corner marks, its
// circle (green when read, red when its ring couldn't be read) and its name.
function drawOverlay(res, fw, fh) {
  const video = $('video'), cv = $('overlay');
  const cw = video.clientWidth, ch = video.clientHeight, dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(cw * dpr);
  cv.height = Math.round(ch * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  if (!res) return;
  // The video is shown whole, so work out where the frame sits in its box.
  const s = Math.min(cw / fw, ch / fh), ox = (cw - fw * s) / 2, oy = (ch - fh * s) / 2;
  const P = ([x, y]) => [ox + x * s, oy + y * s];
  const path = pts => { ctx.beginPath(); pts.forEach((p, i) => { const [x, y] = P(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); };
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(232, 196, 120, .95)';
  for (const m of res.markers) { path(m.corners); ctx.stroke(); }
  const circle = ({ c, M }) => path(Array.from({ length: 48 }, (_, k) => {
    const t = k * Math.PI / 24, u = 16 * Math.sin(t), v = -16 * Math.cos(t);
    return [c[0] + M[0] * u + M[1] * v, c[1] + M[2] * u + M[3] * v];
  }));
  ctx.lineWidth = 3;
  for (const [list, colour] of [[res.cards, '#3DDC84'], [res.unread, '#FF5A4E']]) {
    ctx.strokeStyle = colour;
    for (const card of list) if (card.ring) { circle(card.ring); ctx.stroke(); }
  }
  ctx.font = '700 13px Figtree, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = (text, [x, y], colour) => {
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = 'rgba(14, 19, 27, .85)';
    ctx.fillRect(x - w / 2, y - 11, w, 22);
    ctx.fillStyle = colour;
    ctx.fillText(text, x, y + 1);
  };
  for (const c of res.cards) label(NAME[c.id] || `#${c.id}`, P(c.centre), '#3DDC84');
  for (const u of res.unread) label('?', P(u.centre), '#FF5A4E');
}

// A buzz where the phone can, and a two-note chime.
function chime() {
  try { if (navigator.vibrate) navigator.vibrate([60, 40, 120]); } catch (e) { /* no buzz */ }
  if (!audio) return;
  try {
    const t = audio.currentTime;
    for (const [freq, at] of [[880, 0], [1320, 0.13]]) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = freq;
      o.connect(g);
      g.connect(audio.destination);
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(0.25, t + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.12);
      o.start(t + at);
      o.stop(t + at + 0.13);
    }
  } catch (e) { /* no chime */ }
}

function cameraProblem(e) {
  if (e && e.name === 'NotAllowedError') return 'The camera wasn’t allowed. Allow it for this site in the browser’s settings, then try again.';
  if (e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError')) return 'This phone’s camera couldn’t be opened.';
  return `The camera stopped: ${(e && e.message) || 'something went wrong'}.`;
}

function stopLive(message) {
  if (live) live.stop();
  live = null;
  $('live').hidden = true;
  drawOverlay(null);
  if (message) $('status').textContent = message;
}

async function startLive() {
  if (live || starting) return;
  starting = true;
  // The chime needs sound started from a tap, so it starts here.
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.resume) audio.resume();
  } catch (e) { audio = null; }
  $('results').hidden = true;
  $('live').hidden = false;
  $('liveStatus').textContent = 'Starting the camera…';
  $('liveInfo').textContent = '';
  setSteady(0);
  drawOverlay(null);
  $('live').scrollIntoView({ block: 'start', behavior: 'smooth' });
  keepAwake();
  try {
    live = await startLiveScan({
      video: $('video'),
      onRead({ verdict, res, w, h, fps, camera }) {
        drawOverlay(res, w, h);
        $('liveStatus').textContent = describe(verdict);
        setSteady(verdict.state === 'steadying' ? verdict.run : verdict.state === 'locked' ? LOCK_READS : 0);
        $('liveInfo').textContent = `Camera ${camera[0]} × ${camera[1]} · ${fps ? fps.toFixed(1) : '…'} reads a second`;
      },
      onLock({ res, canvas, w, h }) {
        live = null;
        chime();
        $('live').hidden = true;
        last = null;
        const text = show({ canvas, w, h }, res, `Locked on the cards: ${LOCK_READS} reads in a row agreed.`);
        addToTally(res);
        canvas.toBlob(b => { if (b) last = { file: new File([b], 'live-scan.jpg', { type: 'image/jpeg' }), text }; }, 'image/jpeg', 0.92);
        $('results').scrollIntoView({ block: 'start', behavior: 'smooth' });
      },
      onError(e) {
        live = null;
        $('liveStatus').textContent = cameraProblem(e);
      },
    });
  } catch (e) {
    live = null;
    $('liveStatus').textContent = cameraProblem(e);
  } finally {
    starting = false;
  }
}

if (!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
  $('scanLive').disabled = true;
  $('status').textContent = 'Live scanning needs the camera, which this browser won’t give this page. Take a photo instead.';
}
$('scanLive').addEventListener('click', startLive);
$('scanMore').addEventListener('click', startLive);
$('stopLive').addEventListener('click', () => stopLive('Stopped.'));
$('startOver').addEventListener('click', startOver);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && live) stopLive('Scanning stopped when the page was hidden. Tap Scan live to carry on.');
});

for (const id of ['camera', 'library']) {
  $(id).addEventListener('change', e => { stopLive(); handle(e.target.files[0]); e.target.value = ''; });
}
$('save').addEventListener('click', save);
