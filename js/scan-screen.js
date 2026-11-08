// The full-screen live scanner, shared by the card test page and the game: the camera
// with a mark on each card, a map of the table so far, a line of advice at the top and
// the count. live-scan.js does the reading; table-map.js pieces the table together.
//
// The screen is a `.scanner` element laid out like this (see index.html):
//   .scanner-status, .scanner-count     what it says, and how many it has
//   video, canvas.scanner-marks         the camera, and the marks drawn over it
//   canvas.minimap, .scanner-key        the map of the table, and what its marks mean
//   .settle span, .scanner-info         a progress bar, and the camera's details
//   [data-scan=cancel], [data-scan=done]

import { startLiveScan } from './live-scan.js';
import { keepAwake } from './util.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/* ---------- the map ---------- */

// Draws the table as a live scan has pieced it together: each group's cards as card
// shapes, groups side by side, scaled to fit the cards. While scanning, identified cards
// are green, cards seen but not read yet are red outlines, and a white box shows where
// the camera is (cut off where it runs past the cards, so the map doesn't jump about as
// the phone moves). With `label` (a card's id to its name), it draws the finished table
// instead, each card named. `width` and `height` are in CSS pixels; without `height`, the
// canvas takes the map's own shape.
export const MAP_CARD = { w: 56, h: 87 };
export const cardCorners = c => {
  const [ax, ay] = c.axis, px = -ay, py = ax;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [
    c.centre[0] + a * px * MAP_CARD.w / 2 + b * ax * MAP_CARD.h / 2,
    c.centre[1] + a * py * MAP_CARD.w / 2 + b * ay * MAP_CARD.h / 2]);
};
export function paintMap(cv, map, { label = null, width = cv.clientWidth, height = null } = {}) {
  const dpr = window.devicePixelRatio || 1, GAP = 40, PAD = 8, names = !!label;
  const groups = map ? map.groups.filter(g => g.cards.length || g.waiting.length) : [];
  const boxes = groups.map(g => {
    const pts = g.cards.concat(g.waiting).flatMap(cardCorners);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  });
  const totalW = boxes.reduce((t, b) => t + b.x1 - b.x0, 0) + GAP * Math.max(0, boxes.length - 1);
  const maxH = Math.max(1, ...boxes.map(b => b.y1 - b.y0));
  const h = height || Math.min(Math.max(120, (width - 2 * PAD) * maxH / Math.max(1, totalW) + 2 * PAD), 1.4 * width);
  cv.width = Math.round(width * dpr);
  cv.height = Math.round(h * dpr);
  if (!height) cv.style.height = `${Math.round(h)}px`;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, h);
  if (!groups.length) return;
  // While only a few cards are found, they're drawn no bigger than this.
  const k = Math.min((width - 2 * PAD) / Math.max(1, totalW), (h - 2 * PAD) / maxH, names ? Infinity : (h - 2 * PAD) / (2.5 * MAP_CARD.h));
  let ox = (width - totalW * k) / 2;
  groups.forEach((g, gi) => {
    const b = boxes[gi], oy = (h - (b.y1 - b.y0) * k) / 2;
    const P = ([x, y]) => [ox + (x - b.x0) * k, oy + (y - b.y0) * k];
    const path = pts => { ctx.beginPath(); pts.map(P).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
    for (const c of g.cards) {
      path(cardCorners(c));
      ctx.fillStyle = names ? '#141B2A' : '#3DDC84';
      ctx.fill();
      if (names) { ctx.strokeStyle = '#D9B46A'; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
    for (const c of g.waiting) {
      path(cardCorners(c));
      ctx.setLineDash(names ? [4, 3] : []);
      ctx.strokeStyle = '#FF5A4E';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (g.current && map.view && !names) {
      path(map.view);
      ctx.strokeStyle = 'rgba(255, 255, 255, .85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    if (names) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#E8C478';
      // Each name as large as fits across its card.
      for (const c of g.cards) {
        const text = label(c.id), [x, y] = P(c.centre);
        ctx.font = '700 10px Figtree, system-ui, sans-serif';
        const size = Math.max(6, Math.min(14, 10 * 0.86 * MAP_CARD.w * k / ctx.measureText(text).width));
        ctx.font = `700 ${size.toFixed(1)}px Figtree, system-ui, sans-serif`;
        ctx.fillText(text, x, y);
      }
      ctx.fillStyle = '#FF5A4E';
      ctx.font = '800 14px Figtree, system-ui, sans-serif';
      for (const c of g.waiting) ctx.fillText('?', ...P(c.centre));
      if (groups.length > 1) {
        ctx.fillStyle = '#566173';
        ctx.font = '700 12px Figtree, system-ui, sans-serif';
        ctx.fillText(`Group ${gi + 1}`, ox + (b.x1 - b.x0) * k / 2, Math.max(10, oy - 10));
      }
    }
    ox += (b.x1 - b.x0 + GAP) * k;
  });
}

/* ---------- the marks on the cards ---------- */

// Draws one mark on each card in the camera view: a green tick once the card is
// identified (with `label(id)` after it, its name, where the screen may show it), grey
// "…" while it's still being read, red "?" when it can't be read (glare or blur) and
// isn't one already identified. Identified cards keep their tick wherever the map puts
// them in this view, whether or not this read saw them. A read describes a frame from a
// moment ago, so while the phone moves the marks trail the cards: they fade unless a
// fresh read replaces them, after a bit longer than reads take. A read that made out no
// card at all (a frame blurred as the phone moved) leaves the marks of the read before to
// fade, rather than wiping them.
export function makeMarks(cv, video) {
  let readGap = 300, lastRead = 0;
  function draw(res, fw, fh, verdict = null, label = () => '') {
    const now = performance.now();
    if (res && lastRead) readGap = 0.7 * readGap + 0.3 * Math.min(2000, now - lastRead);
    lastRead = res ? now : 0;
    const strays = verdict ? verdict.strays : [];
    if (res && !res.cards.length && !strays.length) return;
    const counted = new Set(verdict ? verdict.ids : []), map = verdict && verdict.map;
    cv.style.transition = 'none';
    cv.style.opacity = '1';
    if (res) {
      void cv.offsetWidth;
      cv.style.transition = `opacity .4s linear ${Math.round(Math.max(350, 1.5 * readGap))}ms`;
      cv.style.opacity = '0';
    }
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
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // A rounded badge, sized to suit the card it sits on.
    const badge = (text, [x, y], fill, mm) => {
      const size = Math.max(9, Math.min(15, 60 * mm * s / 7));
      ctx.font = `800 ${size.toFixed(1)}px Figtree, system-ui, sans-serif`;
      const w = Math.max(ctx.measureText(text).width + size * 1.3, size * 1.9), h = size * 1.9;
      ctx.fillStyle = fill;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2); else ctx.rect(x - w / 2, y - h / 2, w, h);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(text, x, y + 1);
    };
    const GREEN = '#1F9D55', GREY = 'rgba(55, 62, 74, .92)', RED = '#D93A2B';
    const tick = id => { const name = label(id); return name ? `✓ ${name}` : '✓'; };
    for (const c of res.cards) badge(counted.has(c.id) ? tick(c.id) : '…', P(c.centre), counted.has(c.id) ? GREEN : GREY, c.mm);
    for (const u of strays) badge('?', P(u.centre), RED, u.mm);
    // Identified cards this read didn't see, where the map says they are. (`frame` is
    // there only when this read was placed, so `current` is this read's group.)
    const group = map && map.frame && map.groups.find(g => g.current);
    if (group) {
      const here = new Set(res.cards.map(c => c.id)), ppm = map.frame.ppm;
      for (const c of group.cards) {
        if (here.has(c.id)) continue;
        const [x, y] = map.frame.toFrame(c.centre);
        if (x < 0 || y < 0 || x > fw || y > fh) continue;
        badge(tick(c.id), P([x, y]), GREEN, ppm);
      }
    }
  }
  return { draw, clear: () => draw(null) };
}

/* ---------- the line at the top ---------- */

// The line at the top says what most of the last few reads made of the view, and stays
// up for at least HOLD_MS: one read that misses a card, or catches a reflection,
// shouldn't make it flicker. A read that finds a new card has its say at once.
export function makeSteady() {
  const HOLD_MS = 800, LATELY_MS = 700;
  let said = null, lately = [];
  const steady = (v, now) => {
    const kind = v.state === 'unclear' ? `unclear ${!v.unread ? 'steady' : v.small ? 'small' : 'light'}` : v.state;
    lately.push({ kind, v, t: now });
    while (now - lately[0].t > LATELY_MS) lately.shift();
    if (v.state === 'locked' || !said || v.count > said.v.count) { said = { kind, v, at: now }; return v; }
    // The commonest lately, as of its latest read; a tie goes to the latest.
    const n = new Map();
    for (const r of lately) n.set(r.kind, (n.get(r.kind) || 0) + 1);
    const best = lately.reduce((a, b) => (n.get(b.kind) >= n.get(a.kind) ? b : a));
    if (best.kind === said.kind) said.v = best.v;
    else if (now - said.at >= HOLD_MS) said = { kind: best.kind, v: best.v, at: now };
    return { ...said.v, count: v.count, ids: v.ids };
  };
  steady.reset = () => { said = null; lately = []; };
  return steady;
}

// What the line at the top says, for a scan looking for `expected` cards (0: however
// many there are). `toGo(v)` adds what's left to find, if anything.
export function describeScan(v, expected, toGo = () => '') {
  switch (v.state) {
    case 'partial': return 'I can see card corners. Get whole cards in view.';
    case 'unclear':
      if (!v.unread) return 'Hold steady…';
      return v.small ? `Can’t read ${plural(v.unread, 'card')} yet: move a little closer.`
        : `Can’t read ${plural(v.unread, 'card')}: tilt away from the light, or hold steadier.`;
    case 'collecting': return 'Reading the cards…';
    case 'settling': return expected ? `Got the cards in view.${toGo(v)} Move on to the rest.` : 'Got the cards in view. Hold still to finish, or move on to more.';
    case 'locked': return 'Done.';
    default: return v.count ? `No cards in view.${toGo(v) || ' Point at the ones not counted yet.'}` : 'Point the camera at the cards, lying face-down. Each gets a green tick once it’s identified.';
  }
}

/* ---------- sounds and problems ---------- */

// A buzz where the phone can, and a two-note chime.
export function chime(audio) {
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

export function cameraProblem(e) {
  if (e && e.name === 'NotAllowedError') return 'The camera wasn’t allowed. Allow it for this site in the browser’s settings, then try again.';
  if (e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError')) return 'This phone’s camera couldn’t be opened.';
  return `The camera stopped: ${(e && e.message) || 'something went wrong'}.`;
}

/* ---------- the screen ---------- */

let audio = null;

// Opens the scanner in `root` and scans until it has `expected` cards (0: until it's
// held still with nothing new turning up), or Done is tapped. Each identified card's tick
// says `label(id)` (nothing, where the screen must give nothing away); `describe(v)` is
// the line at the top for a verdict. onLock({ found, map, last, canvas, w, h, early })
// comes once, after the screen has closed (`early` when Done ended it); onCancel(why)
// when it's cancelled, or stopped because the page was hidden. Call it from a tap, so
// the chime can play. Returns { stop() }.
export function openScanner(root, { expected = 0, label = () => '', describe, onLock, onCancel = () => {} }) {
  const $ = sel => root.querySelector(sel);
  const status = $('.scanner-status'), count = $('.scanner-count'), video = $('video'), minimap = $('.minimap');
  const key = $('.scanner-key'), waitingKey = $('.scanner-key .waiting'), bar = $('.settle span'), info = $('.scanner-info');
  const marks = makeMarks($('.scanner-marks'), video), steady = makeSteady();
  // The chime needs sound started from a tap, so it starts here.
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.resume) audio.resume();
  } catch (e) { audio = null; }
  root.hidden = false;
  document.documentElement.classList.add('scanning');
  status.textContent = 'Starting the camera…';
  count.textContent = '';
  info.textContent = '';
  bar.style.width = '0';
  key.hidden = true;
  marks.clear();
  paintMap(minimap, null, { width: minimap.clientWidth || 300, height: minimap.clientHeight || 84 });
  keepAwake();

  let live = null, open = true;
  const ac = new AbortController();
  const close = () => {
    if (!open) return;
    open = false;
    ac.abort();
    if (live) live.stop();
    live = null;
    root.hidden = true;
    document.documentElement.classList.remove('scanning');
    marks.clear();
  };
  const cancel = why => { close(); onCancel(why); };
  $('[data-scan=cancel]').addEventListener('click', () => cancel('cancelled'), { signal: ac.signal });
  $('[data-scan=done]').addEventListener('click', () => { if (live) live.finish(); else cancel('cancelled'); }, { signal: ac.signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel('hidden'); }, { signal: ac.signal });

  startLiveScan({
    video,
    expected,
    onRead({ verdict, res, w, h, fps, camera }) {
      if (!open) return;
      marks.draw(res, w, h, verdict, label);
      status.textContent = describe(steady(verdict, performance.now()));
      const groups = verdict.map ? verdict.map.groups.length : 0;
      count.textContent = (expected ? `${verdict.count} of ${expected}` : verdict.count ? plural(verdict.count, 'card') : '') + (groups > 1 ? ` · ${groups} groups` : '');
      paintMap(minimap, verdict.map, { width: minimap.clientWidth, height: minimap.clientHeight });
      key.hidden = !(verdict.map && verdict.map.groups.length);
      waitingKey.hidden = !(verdict.map && verdict.map.groups.some(g => g.waiting.length));
      // The bar: how many of the cards it's looking for it has, or how long it's been
      // held still when it doesn't know how many.
      const done = expected ? Math.min(1, verdict.count / expected) : verdict.settle || (verdict.state === 'locked' ? 1 : 0);
      bar.style.width = `${Math.round(done * 100)}%`;
      info.textContent = `Camera ${camera[0]} × ${camera[1]} · ${fps ? fps.toFixed(1) : '…'} reads a second`;
    },
    onLock(result) {
      close();
      if (!result.early) chime(audio);
      onLock(result);
    },
    onError(e) {
      live = null;
      if (open) status.textContent = cameraProblem(e);
    },
  }).then(l => { if (open) live = l; else l.stop(); })
    .catch(e => { live = null; if (open) status.textContent = cameraProblem(e); });

  return { stop: close };
}
