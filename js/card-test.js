// The card back reader test page: one photo in, what the reader found out.

import { grayOf, readLayout } from './backs.js';
import { CARD_MARKERS, DECOY, REG_MARK } from './markers.js';
import { esc } from './util.js';

const NAME = Object.fromEntries(Object.entries(CARD_MARKERS).map(([n, id]) => [id, n]));
const FIRST_TEST = 22, SIZES = [6, 8, 10, 12], SHADES = [100, 75, 50];
const isTest = id => id >= FIRST_TEST && id !== REG_MARK;
// Phones take photos of up to 48 megapixels; 12 is plenty, and browsers on phones
// refuse canvases much bigger than that.
const MAX_SIDE = 4032;

const $ = id => document.getElementById(id);

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

function show(photo, res, ms) {
  const cards = res.cards.filter(c => NAME[c.id]);
  const tests = new Set(res.markers.map(m => m.id).filter(isTest));
  const rows = res.rows.map(r => r.filter(c => NAME[c.id])).filter(r => r.length);

  let summary;
  if (cards.length) summary = `Found ${cards.length} of ${Object.keys(CARD_MARKERS).length} cards, in ${rows.length} row${rows.length === 1 ? '' : 's'}.`;
  else if (tests.size) summary = `Read ${tests.size} of ${SIZES.length * SHADES.length} size test markers.`;
  else summary = 'No markers found. Try again closer, with the cards filling most of the photo.';
  $('summary').textContent = summary;

  const found = new Set(cards.map(c => c.id));
  const missing = Object.entries(CARD_MARKERS).filter(([, id]) => !found.has(id)).map(([n]) => n);
  const notes = [];
  if (cards.length && missing.length && missing.length < Object.keys(CARD_MARKERS).length) notes.push(`Not found: ${missing.join(', ')}.`);
  if (res.unread && res.unread.length) notes.push(`${res.unread.length} card${res.unread.length === 1 ? '' : 's'} seen but not named: the ring didn’t match any card.`);
  const rings = cards.filter(c => c.ring);
  if (rings.length) {
    const worst = Math.max(...rings.map(c => c.errors)), faintest = Math.min(...rings.map(c => c.contrast));
    notes.push(`Rings matched with at most ${worst} of 72 ticks misread; the faintest ticks stood ${Math.round(faintest)} grey levels above the navy.`);
  }
  if (res.doubles.length) notes.push(`Seen twice in different places: ${res.doubles.map(id => NAME[id] || `marker ${id}`).join(', ')}.`);
  $('missing').textContent = notes.join(' ');
  $('missing').hidden = !notes.length;

  $('rowsBox').hidden = !rows.length;
  $('rows').innerHTML = rows.map((row, r) => `<li><p class="label">Row ${r + 1} · ${row.length} card${row.length === 1 ? '' : 's'}</p>
    <p class="entry-cards">${row.map(c => `<span class="cc"><span>${esc(NAME[c.id])}</span></span>`).join('')}</p></li>`).join('');

  $('sizesBox').hidden = !tests.size;
  $('sizes').innerHTML = `<tr><th scope="col"></th>${SIZES.map(s => `<th scope="col">${s} mm</th>`).join('')}</tr>` +
    SHADES.map((sh, r) => `<tr><th scope="row">${sh}%</th>${SIZES.map((s, c) => tests.has(FIRST_TEST + r * SIZES.length + c)
      ? '<td class="yes">read</td>' : '<td class="no">–</td>').join('')}</tr>`).join('');

  $('results').hidden = false;
  draw(photo, res);
  $('status').textContent = `Read a ${photo.w} × ${photo.h} photo in ${(ms / 1000).toFixed(1)} s.`;
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
    show(photo, res, performance.now() - t0);
  } catch (e) {
    $('status').textContent = e.message || 'Something went wrong reading that photo.';
  }
}

for (const id of ['camera', 'library']) {
  $(id).addEventListener('change', e => { handle(e.target.files[0]); e.target.value = ''; });
}
