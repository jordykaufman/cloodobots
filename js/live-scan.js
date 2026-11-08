// Live scanning of card backs. The camera runs; each frame is read off the main thread;
// what was found is handed back after every read; and once the same cards have read the
// same way a few reads in a row, with every card's ring read, the scan locks and hands
// back the frame it locked on. Nothing leaves the phone.

import { grayOf, readLayout } from './backs.js';

// How many reads in a row must agree before the scan locks.
export const LOCK_READS = 3;

// The reader's result made small enough to post between threads: its working parts
// dropped, and rows given as positions in the card list (the cards appear in both).
export function slim(res) {
  return {
    markers: res.markers.map(m => ({ id: m.id, corners: m.corners, centre: m.centre })),
    cards: res.cards.map(c => ({ id: c.id, centre: c.centre, axis: c.axis, mm: c.mm, markers: c.markers, ring: c.ring, contrast: c.contrast, errors: c.errors })),
    unread: (res.unread || []).map(u => ({ centre: u.centre, axis: u.axis, mm: u.mm, markers: u.markers, ring: u.ring, contrast: u.contrast })),
    loose: (res.loose || []).map(m => ({ centre: m.centre, mm: m.mm, whole: m.whole })),
    doubles: res.doubles,
    rows: res.rows.map(row => row.map(c => res.cards.indexOf(c))),
  };
}

export const unslim = s => ({ ...s, rows: s.rows.map(row => row.map(i => s.cards[i])) });

const median = xs => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
const key = r => r.cards.map(c => c.id).sort((a, b) => a - b).join(',');
// Cards in view that couldn't be read: rings that matched no card, and corner marks
// with no card read round them where a whole card would be in the picture (glare can
// wash out a card's circle and leave its corners; two such marks make one card).
const unreadable = r => (r.unread || []).length + Math.ceil((r.loose || []).filter(m => m.whole).length / 4 - 0.25);
const clear = r => !unreadable(r) && !r.doubles.length;

// Where a scan stands, from its reads so far (the latest last):
//   nothing   - nothing like a card in view
//   partial   - card marks in view, but no whole card
//   unclear   - cards in view that couldn't be read (through glare, blur or distance);
//               `unread` counts them, and `small` says the cards look too small to read
//   steadying - every card in view read; `run` reads in a row have agreed so far
//   locked    - LOCK_READS reads in a row found the same cards, with every card read
export function judge(reads) {
  const last = reads[reads.length - 1];
  if (!last) return { state: 'nothing', cards: [] };
  const cards = last.cards, unread = last.unread || [];
  if (!clear(last)) {
    const mm = median(cards.concat(unread, (last.loose || []).filter(m => m.whole)).map(c => c.mm));
    return { state: 'unclear', cards, unread: unreadable(last), small: mm > 0 && mm < 4.5 };
  }
  if (!cards.length) return { state: last.markers.length ? 'partial' : 'nothing', cards };
  const k = key(last);
  let run = 0;
  for (let i = reads.length - 1; i >= 0 && run < LOCK_READS; i--) {
    if (!clear(reads[i]) || key(reads[i]) !== k) break;
    run++;
  }
  return { state: run >= LOCK_READS ? 'locked' : 'steadying', cards, run };
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

// Starts the camera in `video` and reads frames until the scan locks or is stopped.
// onRead({ verdict, res, w, h, ms, fps, camera }) comes after every read, with the
// result in the coordinates of the frame read (w x h, which can be smaller than the
// camera's own frames). onLock({ res, canvas, w, h }) comes once, with the frame the
// scan locked on. onError(error) if the camera or reader fails. Returns { stop() }.
export async function startLiveScan({ video, onRead, onLock, onError }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
  });
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.srcObject = stream;
  await video.play().catch(() => {});
  const reader = makeReader();
  const frame = document.createElement('canvas');
  const fctx = frame.getContext('2d', { willReadFrequently: true });
  let running = true, scale = 1;
  const reads = [], times = [];
  const halt = () => {
    running = false;
    for (const t of stream.getTracks()) t.stop();
    video.srcObject = null;
    reader.close();
  };

  (async () => {
    while (running) {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) { await sleep(100); continue; }
      const w = Math.round(vw * scale), h = Math.round(vh * scale);
      if (frame.width !== w || frame.height !== h) { frame.width = w; frame.height = h; }
      fctx.drawImage(video, 0, 0, w, h);
      const out = await reader.read(fctx.getImageData(0, 0, w, h));
      if (!running) break;
      if (!out) continue;
      const res = unslim(out.res);
      reads.push(res);
      if (reads.length > 8) reads.shift();
      times.push(performance.now());
      if (times.length > 6) times.shift();
      const fps = times.length > 1 ? (times.length - 1) * 1000 / (times[times.length - 1] - times[0]) : 0;
      const verdict = judge(reads);
      onRead({ verdict, res, w, h, ms: out.ms, fps, camera: [vw, vh] });
      if (verdict.state === 'locked') {
        halt();
        onLock({ res, canvas: frame, w, h });
        break;
      }
      // Read the frames at about 7 pixels per millimetre of card: enough for the rings,
      // and no more pixels than that to get through. Only change for a real difference,
      // so reads stay comparable.
      const mms = res.cards.concat(res.unread).map(c => c.mm);
      const want = mms.length ? Math.min(1, Math.max(0.35, scale * 7 / median(mms))) : 1;
      if (Math.abs(want - scale) / scale > 0.2) scale = want;
    }
  })().catch(e => { if (running) { halt(); onError(e); } });

  return { stop: halt };
}
