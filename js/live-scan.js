// Live scanning of card backs. The camera runs and each frame is read off the main
// thread. Cards are remembered across frames, so the phone can be held over all of them
// at once or moved across the table: a card counts once it has been read twice within a
// few reads, and goes on a map of the table pieced together from the views (see
// table-map.js). Once no new card has turned up for a second, with every card in view
// read, the scan locks and hands back the cards, the map and the last frame. Nothing
// leaves the phone.

import { grayOf, readLayout } from './backs.js';
import { makeTableMap } from './table-map.js';

// A card counts at once when its ring read cleanly, with no more than SURE_ERRORS of its
// 72 ticks wrong (any two cards differ in at least 25, so it's still at least 19 from any
// other card);
// otherwise once it has been read twice within CONFIRM_WITHIN reads, so one misread
// frame can't add a card.
export const SURE_ERRORS = 6;
export const CONFIRM_WITHIN = 5;
// Told how many cards to find, the scan stops as soon as it has them. Otherwise it stops
// once no new card has turned up for SETTLE_MS, with the phone held still: the view not
// moving more than STILL_MM across the table.
export const SETTLE_MS = 700;
export const STILL_MM = 15;

// The reader's result made small enough to post between threads: its working parts
// dropped, and rows given as positions in the card list (the cards appear in both).
export function slim(res) {
  return {
    markers: res.markers.map(m => ({ id: m.id, corners: m.corners, centre: m.centre })),
    cards: res.cards.map(c => ({ id: c.id, centre: c.centre, axis: c.axis, mm: c.mm, markers: c.markers, ring: c.ring, contrast: c.contrast, errors: c.errors })),
    unread: (res.unread || []).map(u => ({ centre: u.centre, axis: u.axis, mm: u.mm, markers: u.markers, ring: u.ring, contrast: u.contrast })),
    loose: (res.loose || []).map(m => (m.card ? { centre: m.centre, mm: m.mm, whole: m.whole, card: m.card } : { centre: m.centre, mm: m.mm, whole: m.whole })),
    doubles: res.doubles,
    rows: res.rows.map(row => row.map(c => res.cards.indexOf(c))),
  };
}

export const unslim = s => ({ ...s, rows: s.rows.map(row => row.map(i => s.cards[i])) });

const median = xs => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };

// Cards in view that couldn't be read, each { centre, axis, mm } in the read's pixels:
// rings that matched no card, and corner marks with no card read round them where a
// whole card would be in the picture (glare can wash out a card's circle and leave its
// corners), one for each card those marks make.
export function straysOf(r) {
  const out = (r.unread || []).map(u => ({ centre: u.centre, axis: u.axis || null, mm: u.mm }));
  const washed = [];
  for (const m of (r.loose || []).filter(m => m.whole)) {
    const at = m.card ? m.card.centre : m.centre;
    const same = washed.find(s => Math.hypot(s.centre[0] - at[0], s.centre[1] - at[1]) < 20 * m.mm);
    if (same) { same.marks++; continue; }
    washed.push({ centre: at, axis: m.card ? m.card.axis : null, mm: m.mm, marks: 1 });
  }
  // Without the card's place, four marks to a card.
  for (const s of washed) {
    const n = s.marks > 4 ? Math.ceil(s.marks / 4 - 0.25) : 1;
    for (let i = 0; i < n; i++) out.push({ centre: s.centre, axis: s.axis, mm: s.mm });
  }
  return out;
}
export const unreadable = r => straysOf(r).length;

// Keeps track of a scan, read by read; `expected` is how many cards to find (0: not
// known). add(res, t) takes each read (t in milliseconds) and says where the scan stands:
//   nothing    - nothing like a card in view
//   partial    - card marks in view, but no whole card
//   unclear    - cards in view that couldn't be read (through glare, blur or distance),
//                other than cards already found; `unread` counts them, and `small` says
//                the cards look too small to read
//   collecting - cards in view, some not yet read twice
//   settling   - every card in view counted; not knowing how many to find, `settle`
//                runs from 0 to 1 over SETTLE_MS while the phone is held still (it starts
//                again when the view moves, so passing over empty table mid-sweep doesn't
//                end the scan)
//   locked     - every card expected found (`complete`); or, not knowing how many,
//                no new card and the phone held still for SETTLE_MS, with every card in
//                view counted
// Every verdict has `count` and `ids`, the cards found so far, `strays`, the cards in
// view that couldn't be read and aren't among those found ({ centre, axis, mm } in the
// read's pixels), and `map`, the table so far (a snapshot from table-map.js). `found`
// maps each card's id to where it was last seen in a frame; `map` places the cards on the
// table. A read's `size` ([w, h]) lets the map show where the view was.
export function makeTracker({ expected = 0 } = {}) {
  const sightings = new Map(), found = new Map(), map = makeTableMap();
  let reads = 0, grewAt = null, still = null, strays = [];
  return {
    found,
    map,
    add(res, t) {
      const verdict = judge(res, t);
      verdict.ids = [...found.keys()];
      verdict.strays = strays;
      verdict.map = map.snapshot();
      return verdict;
    },
  };

  function judge(res, t) {
    reads++;
    const doubled = new Set(res.doubles);
    for (const c of res.cards) {
      if (doubled.has(c.id)) continue;
      const s = sightings.get(c.id) || [];
      const counts = found.has(c.id) || (typeof c.errors === 'number' && c.errors <= SURE_ERRORS) || s.some(n => reads - n < CONFIRM_WITHIN);
      if (counts && !found.has(c.id)) grewAt = t;
      if (counts) found.set(c.id, c);
      s.push(reads);
      while (s.length && reads - s[0] >= CONFIRM_WITHIN) s.shift();
      sightings.set(c.id, s);
    }
    // Cards that count go on the map, which also says whether the view has moved, and
    // which of the cards that couldn't be read are ones already found.
    const all = straysOf(res);
    map.add(res.cards.filter(c => !doubled.has(c.id) && found.has(c.id) && c.centre && c.axis), res.size, all);
    strays = map.unknown(all);
    const here = map.where();
    if (!here || !still || here.group !== still.group || Math.hypot(here.centre[0] - still.centre[0], here.centre[1] - still.centre[1]) > STILL_MM) {
      still = here && { ...here, since: t };
    }
    const count = found.size, unread = strays.length;
    if (expected && count >= expected) return { state: 'locked', count, complete: true };
    if (unread || res.doubles.length) {
      const mm = median(res.cards.concat(res.unread || [], (res.loose || []).filter(m => m.whole)).map(c => c.mm));
      return { state: 'unclear', count, unread, small: mm > 0 && mm < 3.2 };
    }
    if (!res.cards.length) return { state: res.markers.length ? 'partial' : 'nothing', count };
    if (grewAt === null || res.cards.some(c => !found.has(c.id))) return { state: 'collecting', count };
    // Told how many to find, it carries on until it has them (or Done is tapped).
    if (expected) return { state: 'settling', count, settle: 0 };
    const settle = still ? Math.min(1, (t - Math.max(grewAt, still.since)) / SETTLE_MS) : 0;
    return { state: settle >= 1 ? 'locked' : 'settling', count, settle };
  }
}

// Reads frames in a worker, so the camera view stays smooth, or on this thread where
// the browser can't run the worker.
function makeReader() {
  let worker = null, seq = 0;
  const pending = new Map();
  const fail = () => {
    if (worker) worker.terminate();
    worker = null;
    for (const p of pending.values()) p.reject(new Error('The reader stopped.'));
    pending.clear();
  };
  try {
    worker = new Worker(new URL('./backs-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => { const p = pending.get(e.data.seq); if (p) { pending.delete(e.data.seq); p.resolve(e.data); } };
    worker.onerror = fail;
  } catch (e) {
    worker = null;
  }
  return {
    // Resolves { res (slim), ms }, or null for a frame lost when the worker failed.
    async read(image) {
      if (worker) {
        try {
          return await new Promise((resolve, reject) => {
            const s = ++seq;
            pending.set(s, { resolve, reject });
            worker.postMessage({ seq: s, w: image.width, h: image.height, buf: image.data.buffer }, [image.data.buffer]);
          });
        } catch (e) {
          return null;
        }
      }
      const t0 = performance.now();
      const res = readLayout(grayOf(image.data, image.width, image.height));
      return { res: slim(res), ms: performance.now() - t0 };
    },
    close() { if (worker) worker.terminate(); worker = null; },
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Starts the camera in `video` and reads frames until the scan locks or is stopped;
// `expected` is how many cards to find, if known.
// onRead({ verdict, res, w, h, ms, fps, camera }) comes after every read, with the
// result in the coordinates of the frame read (w x h, which can be smaller than the
// camera's own frames). onLock({ found, map, last, canvas, w, h, early }) comes once:
// the cards found (each where it was last seen in a frame), the table map, the last
// read and the frame it was read from; `early` when finish() ended the scan before it
// locked. onError(error) if the camera or reader fails. Returns { stop(), finish() }.
export async function startLiveScan({ video, expected = 0, onRead, onLock, onError }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
  });
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.srcObject = stream;
  await video.play().catch(() => {});
  const reader = makeReader(), tracker = makeTracker({ expected });
  // Two canvases, taking turns: one holds the frame being read, the other the frame
  // the last result came from.
  const frames = [0, 1].map(() => { const c = document.createElement('canvas'); return { canvas: c, ctx: c.getContext('2d', { willReadFrequently: true }) }; });
  let running = true, scale = 1, turn = 0, last = null;
  const times = [];
  const halt = () => {
    running = false;
    for (const t of stream.getTracks()) t.stop();
    video.srcObject = null;
    reader.close();
  };
  const hand = early => onLock({ found: [...tracker.found.values()], map: tracker.map.snapshot(), last: last && last.res, canvas: last && last.canvas, w: last && last.w, h: last && last.h, early });

  (async () => {
    while (running) {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) { await sleep(100); continue; }
      const w = Math.round(vw * scale), h = Math.round(vh * scale);
      const f = frames[turn];
      if (f.canvas.width !== w || f.canvas.height !== h) { f.canvas.width = w; f.canvas.height = h; }
      f.ctx.drawImage(video, 0, 0, w, h);
      const out = await reader.read(f.ctx.getImageData(0, 0, w, h));
      if (!running) break;
      if (!out) continue;
      const res = unslim(out.res);
      res.size = [w, h];
      last = { res, canvas: f.canvas, w, h };
      turn = 1 - turn;
      const now = performance.now();
      times.push(now);
      if (times.length > 6) times.shift();
      const fps = times.length > 1 ? (times.length - 1) * 1000 / (times[times.length - 1] - times[0]) : 0;
      const verdict = tracker.add(res, now);
      onRead({ verdict, res, w, h, ms: out.ms, fps, camera: [vw, vh] });
      if (verdict.state === 'locked') {
        halt();
        hand(false);
        break;
      }
      // Read the frames at no more than about 7 pixels per millimetre of card: plenty
      // for the rings, and no more pixels than that to get through. Only change for a
      // real difference, so reads stay comparable.
      const mms = res.cards.concat(res.unread).map(c => c.mm);
      const want = mms.length ? Math.min(1, Math.max(0.35, scale * 7 / median(mms))) : 1;
      if (Math.abs(want - scale) / scale > 0.2) scale = want;
    }
  })().catch(e => { if (running) { halt(); onError(e); } });

  return {
    stop: halt,
    // Ends the scan now with whatever has been found.
    finish() { if (!running) return; halt(); hand(true); },
  };
}
