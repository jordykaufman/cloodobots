// Reads the markers printed on card backs (see tools/test_sheet.py) from one photo of
// cards lying face-down, and works out which cards lie in which row. Everything works
// on a plain grayscale array, so the same code runs in the browser and in the tests.

import { MARKERS, DECOY, REG_MARK, BEZEL, BEZEL_CODES, CARD_MARKERS } from './markers.js';

const CODES = MARKERS.map(s => Uint8Array.from(s, ch => (ch === '1' ? 1 : 0)));

// Card layout in millimetres, as printed: an 8 mm marker whose corner is 5.5 mm in
// from the card's top-left corner (and the same, turned round, at the bottom right).
export const CARD = { w: 63, h: 88, marker: 8, inset: 5.5 };
const toCentre = size => ({ right: size.w / 2 - size.inset - CARD.marker / 2, down: size.h / 2 - size.inset - CARD.marker / 2 });
const TO_CENTRE = toCentre(CARD);

// The bezel layout comes in two card sizes: the home-printed test cards, and the deck
// from MakePlayingCards in their US game size (2.2 x 3.43 in, the size of real Clue
// cards), whose narrower card brings the marks closer together.
export const CARD_SIZES = [
  { name: 'test sheet', w: 63, h: 88, inset: 5.5 },
  { name: 'US game', w: 2.2 * 25.4, h: 3.43 * 25.4, inset: 5.25 },
];

export function grayOf(rgba, w, h) {
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return { gray, w, h };
}

/* ---------- light patches that might be markers ---------- */

// Marks each pixel brighter than its surroundings. The surroundings are the average
// over a square about a twentieth of the photo across, worked out on a coarse grid
// so it stays fast on a 12-megapixel photo.
function brightSpots(img, lift = 14) {
  const { gray, w, h } = img;
  const B = Math.max(6, Math.round(Math.min(w, h) / 120)), R = 3;
  const bw = Math.ceil(w / B), bh = Math.ceil(h / B);
  const sum = new Float64Array(bw * bh), count = new Uint32Array(bw * bh);
  for (let y = 0; y < h; y++) {
    const row = (y / B | 0) * bw;
    for (let x = 0; x < w; x++) { const b = row + (x / B | 0); sum[b] += gray[y * w + x]; count[b]++; }
  }
  const local = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let s = 0, n = 0;
      for (let dy = -R; dy <= R; dy++) {
        const yy = by + dy;
        if (yy < 0 || yy >= bh) continue;
        for (let dx = -R; dx <= R; dx++) {
          const xx = bx + dx;
          if (xx < 0 || xx >= bw) continue;
          s += sum[yy * bw + xx]; n += count[yy * bw + xx];
        }
      }
      local[by * bw + bx] = s / n;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = (y / B | 0) * bw;
    for (let x = 0; x < w; x++) if (gray[y * w + x] > local[row + (x / B | 0)] + lift) out[y * w + x] = 1;
  }
  return out;
}

function hull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
const area = poly => { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };

// The four corners of a roughly square outline: the two points furthest apart are
// opposite corners, and the points furthest from the line between them on either
// side are the other two. Returns them clockwise on screen, or null.
function quadOf(h) {
  if (h.length < 4) return null;
  let best = -1, ia = 0, ib = 0;
  for (let i = 0; i < h.length; i++) for (let j = i + 1; j < h.length; j++) {
    const d = (h[i][0] - h[j][0]) ** 2 + (h[i][1] - h[j][1]) ** 2;
    if (d > best) { best = d; ia = i; ib = j; }
  }
  const a = h[ia], b = h[ib];
  let c = null, d = null, cMax = 0, dMax = 0;
  for (const q of h) {
    const s = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
    if (s > cMax) { cMax = s; c = q; }
    if (-s > dMax) { dMax = -s; d = q; }
  }
  if (!c || !d) return null;
  let quad = [a, c, b, d];
  const qa = area(quad);
  if (Math.abs(qa) < 0.85 * Math.abs(area(h))) return null;
  if (qa < 0) quad = [a, d, b, c];
  const sides = quad.map((p, i) => Math.hypot(quad[(i + 1) % 4][0] - p[0], quad[(i + 1) % 4][1] - p[1]));
  if (Math.min(...sides) < 0.45 * Math.max(...sides)) return null;
  // Hull points are pixel centres; the marker's edge is half a pixel further out.
  const cx = quad.reduce((s, p) => s + p[0], 0) / 4, cy = quad.reduce((s, p) => s + p[1], 0) / 4;
  return quad.map(([x, y]) => { const dx = x - cx, dy = y - cy, l = Math.hypot(dx, dy) || 1; return [x + 0.7 * dx / l, y + 0.7 * dy / l]; });
}

// Maps (u, v) in the 0-8 square of marker cells onto the photo through the quad.
function squareToQuad(q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  let g = 0, hh = 0;
  if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / den;
    hh = (dx1 * sy - sx * dy1) / den;
  }
  const a = x1 - x0 + g * x1, b = x3 - x0 + hh * x3, c = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + hh * y3, f = y0;
  return (u, v) => {
    u /= 8; v /= 8;
    const z = g * u + hh * v + 1;
    return [(a * u + b * v + c) / z, (d * u + e * v + f) / z];
  };
}

function sample(img, x, y) {
  const { gray, w, h } = img;
  if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return -1;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
  return (gray[i] * (1 - fx) + gray[i + 1] * fx) * (1 - fy) + (gray[i + w] * (1 - fx) + gray[i + w + 1] * fx) * fy;
}

const turn = bits => { const out = new Uint8Array(36); for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) out[r * 6 + c] = bits[(5 - c) * 6 + r]; return out; };

// Reads the 8x8 cells inside a quad. Returns the marker, or null if it isn't one.
function readQuad(img, quad) {
  const at = squareToQuad(quad);
  const vals = new Float32Array(64);
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    let s = 0, n = 0;
    for (const dv of [-0.22, 0, 0.22]) for (const du of [-0.22, 0, 0.22]) {
      const [x, y] = at(c + 0.5 + du, r + 0.5 + dv);
      const v = sample(img, x, y);
      if (v < 0) return null;
      s += v; n++;
    }
    vals[r * 8 + c] = s / n;
  }
  const sorted = Array.from(vals).sort((a, b) => a - b);
  const lo = sorted.slice(0, 12).reduce((a, b) => a + b, 0) / 12, hi = sorted.slice(-20).reduce((a, b) => a + b, 0) / 20;
  if (hi - lo < 25) return null;
  const t = (lo + hi) / 2;
  let ringMisses = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if ((r === 0 || r === 7 || c === 0 || c === 7) && vals[r * 8 + c] < t) ringMisses++;
  if (ringMisses > 2) return null;
  let bits = new Uint8Array(36);
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) bits[r * 6 + c] = vals[(r + 1) * 8 + c + 1] > t ? 1 : 0;
  // Try each quarter turn; the dictionary says which way up the marker lies.
  let best = { dist: 99 }, second = 99;
  for (let k = 0; k < 4; k++) {
    for (let id = 0; id < CODES.length; id++) {
      let d = 0;
      const code = CODES[id];
      for (let i = 0; i < 36; i++) if (bits[i] !== code[i]) d++;
      if (d < best.dist) { if (best.id !== id) second = Math.min(second, best.dist); best = { id, dist: d, k }; }
      else if (id !== best.id && d < second) second = d;
    }
    bits = turn(bits);
  }
  if (best.dist > 3 || second < best.dist + 3) return null;
  // The read grid had to be turned k quarter turns clockwise to match, so the
  // marker's own top-left corner is (4 - k) corners round from the quad's first.
  const m = (4 - best.k) % 4;
  const corners = [0, 1, 2, 3].map(i => quad[(i + m) % 4]);
  const cx = corners.reduce((s, p) => s + p[0], 0) / 4, cy = corners.reduce((s, p) => s + p[1], 0) / 4;
  const side = corners.reduce((s, p, i) => s + Math.hypot(corners[(i + 1) % 4][0] - p[0], corners[(i + 1) % 4][1] - p[1]), 0) / 4;
  return { id: best.id, errors: best.dist, corners, centre: [cx, cy], side };
}

// Every marker in the photo: { id, corners (its own top-left first), centre, side }.
export function findMarkers(img) {
  const { w, h } = img;
  const on = brightSpots(img);
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  const minSide = 14, maxSide = Math.min(w, h) / 4;
  const found = [];
  for (let start = 0; start < w * h; start++) {
    if (!on[start] || seen[start]) continue;
    let head = 0, tail = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    queue[tail++] = start; seen[start] = 1;
    while (head < tail) {
      const i = queue[head++], x = i % w, y = (i / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && on[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; queue[tail++] = i - 1; }
      if (x < w - 1 && on[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; queue[tail++] = i + 1; }
      if (y > 0 && on[i - w] && !seen[i - w]) { seen[i - w] = 1; queue[tail++] = i - w; }
      if (y < h - 1 && on[i + w] && !seen[i + w]) { seen[i + w] = 1; queue[tail++] = i + w; }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bw < minSide || bh < minSide || bw > maxSide || bh > maxSide) continue;
    if (tail < 0.25 * bw * bh || bw > 2.2 * bh || bh > 2.2 * bw) continue;
    // The outline: leftmost and rightmost pixel of each row.
    const left = new Int32Array(bh).fill(w), right = new Int32Array(bh).fill(-1);
    for (let k = 0; k < tail; k++) {
      const i = queue[k], x = i % w, r = ((i / w) | 0) - y0;
      if (x < left[r]) left[r] = x;
      if (x > right[r]) right[r] = x;
    }
    const pts = [];
    for (let r = 0; r < bh; r++) if (right[r] >= 0) { pts.push([left[r], y0 + r]); if (right[r] !== left[r]) pts.push([right[r], y0 + r]); }
    const quad = quadOf(hull(pts));
    if (!quad) continue;
    const m = readQuad(img, quad);
    if (m) found.push(m);
  }
  return found;
}

/* ---------- from markers to cards and rows ---------- */

// One millimetre along the card's right and down directions, in photo pixels, taken
// from a marker's edges. Measuring each direction on its own copes with a photo taken
// at an angle, which squashes marks more one way than the other.
function mmSteps(m) {
  const [tl, tr, br, bl] = m.corners, k = 2 * CARD.marker;
  const right = [(tr[0] - tl[0] + br[0] - bl[0]) / k, (tr[1] - tl[1] + br[1] - bl[1]) / k];
  const down = [(bl[0] - tl[0] + br[0] - tr[0]) / k, (bl[1] - tl[1] + br[1] - tr[1]) / k];
  return { right, down, s: (Math.hypot(...right) + Math.hypot(...down)) / 2 };
}

// Each card's code is printed twice; the decoy is ignored. A marker's size and which
// way it faces say where the middle of its card is, so a card is found from either
// marker. Returns cards { id, centre, axis (along the card's long side), mm (pixels
// per millimetre) } and any ids seen on two separate cards.
export function cardsFrom(markers) {
  const byId = new Map();
  for (const m of markers) {
    if (m.id === DECOY || m.id === REG_MARK) continue;
    const { right, down, s } = mmSteps(m);
    const centre = [m.centre[0] + right[0] * TO_CENTRE.right + down[0] * TO_CENTRE.down, m.centre[1] + right[1] * TO_CENTRE.right + down[1] * TO_CENTRE.down];
    if (!byId.has(m.id)) byId.set(m.id, []);
    byId.get(m.id).push({ centre, down, s });
  }
  const cards = [], doubles = [];
  for (const [id, list] of byId) {
    const groups = [];
    for (const p of list) {
      const g = groups.find(g => Math.hypot(g[0].centre[0] - p.centre[0], g[0].centre[1] - p.centre[1]) < 20 * p.s);
      if (g) g.push(p); else groups.push([p]);
    }
    if (groups.length > 1) doubles.push(id);
    const g = groups.sort((a, b) => b.length - a.length)[0];
    const n = g.length;
    // Long-side direction, ignoring which end is up (the two markers face opposite ways).
    let c2 = 0, s2 = 0;
    for (const p of g) { const a = Math.atan2(p.down[1], p.down[0]); c2 += Math.cos(2 * a); s2 += Math.sin(2 * a); }
    const a = Math.atan2(s2, c2) / 2;
    cards.push({
      id,
      centre: [g.reduce((t, p) => t + p.centre[0], 0) / n, g.reduce((t, p) => t + p.centre[1], 0) / n],
      axis: [Math.cos(a), Math.sin(a)],
      mm: g.reduce((t, p) => t + p.s, 0) / n,
      markers: n,
    });
  }
  return { cards, doubles };
}

/* ---------- the bezel layout ---------- */

// Every card carries the same mark in each corner, the bottom two turned round, so the
// back is the same picture either way up. The marks only say where the card lies. The
// card's code is the ring of graduations round the compass rose: a tick every 5
// degrees, each long or short.
const RINGS = Object.entries(BEZEL_CODES).map(([name, bits]) => ({ id: CARD_MARKERS[name], bits: Uint8Array.from(bits, ch => (ch === '1' ? 1 : 0)) }));
const HALF_TURN = BEZEL.ticks / 2;
const R_LONG_ONLY = (BEZEL.short + BEZEL.long) / 2;   // only long ticks reach this far in
const R_ALL = (BEZEL.ring + BEZEL.short) / 2;         // every tick has ink here

// A frame maps card millimetres (x right, y down from the card's centre) to pixels:
// px = c + M (u, v).
const at = (f, u, v) => [f.c[0] + f.M[0] * u + f.M[1] * v, f.c[1] + f.M[2] * u + f.M[3] * v];
const dir = t => [Math.sin(t), -Math.cos(t)];     // the card-frame direction t radians clockwise from the card's top
const ppmOf = f => (Math.hypot(f.M[0], f.M[2]) + Math.hypot(f.M[1], f.M[3])) / 2;

// The brightest pixel within r of (x, y), and the average there; -1 off the photo.
function peak(img, [x, y], r) {
  let best = -1;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const v = sample(img, x + dx, y + dy); if (v > best) best = v; }
  return best;
}
function mean(img, [x, y], r) {
  let s = 0, n = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const v = sample(img, x + dx, y + dy); if (v < 0) return -1; s += v; n++; }
  return s / n;
}

// Solves the 3x3 system A x = b (Cramer's rule).
function solve3(A, b) {
  const det = m => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  const D = det(A);
  if (Math.abs(D) < 1e-9) return null;
  return [0, 1, 2].map(i => { const m = A.slice(); m[i] = b[0]; m[3 + i] = b[1]; m[6 + i] = b[2]; return det(m) / D; });
}

// Fits the brass circle round the rose. Starting from a rough frame (the card's centre
// and pixels per millimetre, from its corner marks), it looks along 48 spokes for the
// circle's bright line, fits the frame to where the line is, and repeats more closely.
// Returns the fitted frame with the circle's contrast against the navy either side of
// it, or null if there's no circle there, which is how a card is told from marks of
// neighbouring cards that happen to line up like one.
function fitCircle(img, frame) {
  const R = BEZEL.circle;
  let f = frame, rms = 0;
  for (const reach of [3.5, 1.5, 1]) {
    const step = Math.min(0.25, 0.5 / ppmOf(f));
    const pts = [];
    for (let k = 0; k < 48; k++) {
      const d = dir(k * Math.PI / 24);
      let bestR = 0, bestV = -1, sum = 0, n = 0;
      for (let r = R - reach; r <= R + reach; r += step) {
        const v = sample(img, ...at(f, r * d[0], r * d[1]));
        if (v < 0) { n = 0; break; }
        sum += v; n++;
        if (v > bestV) { bestV = v; bestR = r; }
      }
      if (n && bestV - sum / n >= 12) pts.push({ d, p: at(f, bestR * d[0], bestR * d[1]) });
    }
    if (pts.length < 16) return null;
    // Least squares for each of x and y: p = c + M (R d).
    const A = [0, 0, 0, 0, 0, 0, 0, 0, 0], bx = [0, 0, 0], by = [0, 0, 0];
    for (const { d, p } of pts) {
      const row = [1, R * d[0], R * d[1]];
      for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) A[i * 3 + j] += row[i] * row[j]; bx[i] += row[i] * p[0]; by[i] += row[i] * p[1]; }
    }
    const X = solve3(A, bx), Y = solve3(A, by);
    if (!X || !Y) return null;
    f = { c: [X[0], Y[0]], M: [X[1], X[2], Y[1], Y[2]] };
    const ppm = ppmOf(f);
    rms = Math.sqrt(pts.reduce((t, { d, p }) => { const q = at(f, R * d[0], R * d[1]); return t + ((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2) / (ppm * ppm); }, 0) / pts.length);
    if (ppm < 2 || rms > 1.5) return null;
  }
  let on = 0, off = 0;
  for (let k = 0; k < 48; k++) {
    const d = dir(k * Math.PI / 24);
    const a = sample(img, ...at(f, R * d[0], R * d[1])), b = sample(img, ...at(f, (R - 1.1) * d[0], (R - 1.1) * d[1])), e = sample(img, ...at(f, (R + 1.2) * d[0], (R + 1.2) * d[1]));
    if (a < 0 || b < 0 || e < 0) return null;
    on += a; off += (b + e) / 2;
  }
  const contrast = (on - off) / 48;
  return contrast >= 15 && rms <= 0.5 ? { ...f, contrast, rms } : null;
}

// Reads the ring. For each tick: its brightness along the stretch only long ticks
// reach, against the navy just inside that on the same line (nothing else is near
// there, whereas between ticks the neighbours' ink blurs in) and against the tick's
// own ink nearer the ring. Brightness is averaged along the tick (and takes the best
// of three lines across it, in case the frame is a little off), which lifts faint ticks
// out of the noise. The dividing line between long and short is found from the ring
// itself, since about half its ticks are long. A tick whose ink can't be seen at all
// is left unknown. Returns the ticks (1 long, 0 short, -1 unknown) and the ticks'
// typical contrast.
function readTicks(img, f) {
  const step = Math.min(0.2, 0.5 / ppmOf(f)), across = [-0.12, 0, 0.12];
  const zone = (t, r0, r1) => {
    const d = dir(t), n = [-d[1], d[0]];
    let s = 0, k = 0;
    for (let r = r0; r <= r1 + 1e-9; r += step) {
      let best = -1;
      for (const w of across) { const v = sample(img, ...at(f, r * d[0] + w * n[0], r * d[1] + w * n[1])); if (v > best) best = v; }
      if (best < 0) return -1;
      s += best; k++;
    }
    return s / k;
  };
  const N = BEZEL.ticks, far = [], ink = [], bg = [];
  const longOnly = [BEZEL.long + 0.15, BEZEL.short - 0.15], all = [BEZEL.short + 0.15, BEZEL.ring - 0.25], navy = [BEZEL.long - 1, BEZEL.long - 0.5];
  for (let i = 0; i < N; i++) {
    const t = i * 2 * Math.PI / N;
    far.push(zone(t, ...longOnly));
    ink.push(zone(t, ...all));
    bg.push(zone(t, ...navy));
  }
  // Each tick's ink contrast, smoothed over its neighbours so one noisy tick doesn't
  // throw its own reading.
  const contrast = [], v = [];
  for (let i = 0; i < N; i++) {
    let s = 0, k = 0;
    for (let j = -2; j <= 2; j++) { const q = (i + j + N) % N; if (ink[q] >= 0 && bg[q] >= 0) { s += ink[q] - bg[q]; k++; } }
    contrast.push(k ? s / k : -1);
    v.push(far[i] < 0 || bg[i] < 0 || contrast[i] < 6 ? NaN : (far[i] - bg[i]) / contrast[i]);
  }
  // Split the known ticks into long and short: two means, starting from short and long.
  const known = v.filter(x => !Number.isNaN(x));
  let lo = 0.1, hi = 0.9;
  for (let it = 0; it < 10 && known.length; it++) {
    let sl = 0, nl = 0, sh = 0, nh = 0;
    for (const x of known) { if (Math.abs(x - lo) < Math.abs(x - hi)) { sl += x; nl++; } else { sh += x; nh++; } }
    if (nl) lo = sl / nl; if (nh) hi = sh / nh;
  }
  const cut = hi - lo >= 0.3 ? Math.min(0.7, Math.max(0.3, (lo + hi) / 2)) : 0.5;
  const bits = new Int8Array(N);
  for (let i = 0; i < N; i++) bits[i] = Number.isNaN(v[i]) ? -1 : v[i] > cut ? 1 : 0;
  const seen = contrast.filter(c => c >= 0).sort((a, b) => a - b);
  return { bits, contrast: seen.length ? seen[seen.length >> 1] : 0 };
}

// Which card a ring is, tried both ways up, judged on the ticks that could be read:
// at least 36 of them, at most a sixth of those wrong, and the runner-up at least a
// tenth of them further off. Returns { id, dist } with how many ticks were wrong.
function nameRing(bits) {
  const known = []; bits.forEach((b, i) => { if (b >= 0) known.push(i); });
  if (known.length < 36) return null;
  let best = null, second = Infinity;
  for (const { id, bits: code } of RINGS) {
    for (const shift of [0, HALF_TURN]) {
      let d = 0;
      for (const i of known) if (bits[i] !== code[(i + shift) % BEZEL.ticks]) d++;
      if (!best || d < best.dist) { if (best && best.id !== id) second = Math.min(second, best.dist); best = { id, dist: d }; }
      else if (id !== best.id && d < second) second = d;
    }
  }
  return best.dist <= known.length / 6 && second - best.dist >= Math.max(3, known.length / 10) ? best : null;
}

// Reads the bezel layout. A mark on its own doesn't say which corner it's in, but it
// can only be a top-left or a top-right mark of a card the way up that makes the mark
// upright (a bottom mark, printed turned round, is a top mark of the card turned
// round, which is the same picture), so each mark guesses the card's centre twice.
// The marks of one card agree on a spot, and there is a brass circle round it. Returns
// cards { id, centre, axis, mm, markers, ring, contrast, errors }, `unread`: cards
// whose ring matched no code, and `loose`: marks that fit no card { centre, mm, whole },
// with `card` { centre, axis } on `whole` marks, where their card would be.
// `size` is one of CARD_SIZES.
export function cardsFromBezels(markers, img, size = CARD_SIZES[0]) {
  const to = toCentre(size);
  const marks = markers.filter(m => m.id === REG_MARK).map(m => {
    const { right, down, s } = mmSteps(m);
    const r = Math.hypot(...right);
    return { right, down, s, facing: [right[0] / r, right[1] / r], centre: m.centre };
  });
  const guesses = [];
  marks.forEach((k, i) => [[1, 0], [-1, 1]].forEach(([sx, slot]) => guesses.push({
    i, slot, k,
    x: k.centre[0] + sx * k.right[0] * to.right + k.down[0] * to.down,
    y: k.centre[1] + sx * k.right[1] * to.right + k.down[1] * to.down,
  })));
  const keys = new Set(), candidates = [];
  for (const g of guesses) {
    // Marks of one card lie the same way or opposite ways, and sit in different
    // corners: 0 top left, 1 top right, 2 bottom right, 3 bottom left, seen the way up
    // that makes the first mark upright.
    const members = new Map(), corners = new Set();
    for (const h of guesses) {
      if (members.has(h.i) || Math.hypot(h.x - g.x, h.y - g.y) > 7 * g.k.s) continue;
      const dot = h.k.facing[0] * g.k.facing[0] + h.k.facing[1] * g.k.facing[1];
      if (Math.abs(dot) < 0.85) continue;
      const corner = dot > 0 ? h.slot : 2 + h.slot;
      if (corners.has(corner)) continue;
      members.set(h.i, { h, corner, flip: dot < 0 });
      corners.add(corner);
    }
    const key = [...members.values()].map(m => `${m.h.i}:${m.corner}`).sort().join(' ');
    if (keys.has(key)) continue;
    keys.add(key);
    const ms = [...members.values()], n = ms.length;
    const M = [0, 0, 0, 0];
    for (const { h, flip } of ms) {
      const sg = flip ? -1 : 1;
      M[0] += sg * h.k.right[0] / n; M[2] += sg * h.k.right[1] / n; M[1] += sg * h.k.down[0] / n; M[3] += sg * h.k.down[1] / n;
    }
    const rough = { c: [ms.reduce((t, m) => t + m.h.x, 0) / n, ms.reduce((t, m) => t + m.h.y, 0) / n], M };
    const ring = fitCircle(img, rough);
    if (ring) candidates.push({ members, ring, n });
  }
  candidates.sort((p, q) => q.n - p.n || q.ring.contrast - p.ring.contrast);
  const taken = new Set(), cards = [], unread = [];
  for (const cand of candidates) {
    if ([...cand.members.keys()].some(i => taken.has(i))) continue;
    for (const i of cand.members.keys()) taken.add(i);
    const f = cand.ring;
    const { bits, contrast } = readTicks(img, f);
    const dl = Math.hypot(f.M[1], f.M[3]);
    const card = { centre: f.c, axis: [f.M[1] / dl, f.M[3] / dl], mm: ppmOf(f), markers: cand.n, ring: { c: f.c, M: f.M }, contrast };
    const named = nameRing(bits);
    if (named) cards.push({ id: named.id, errors: named.dist, ...card }); else unread.push(card);
  }
  // Marks that fit no card. `whole` says the mark is one of at least three that agree on
  // a card lying wholly in the picture, but no card could be read there: glare can wash
  // out a card's circle and leave its corners. Marks of a card cut off by the edge of
  // the picture don't count.
  const free = marks.map((_, i) => i).filter(i => !taken.has(i));
  const inside = ([x, y]) => x >= 0 && y >= 0 && x <= img.w && y <= img.h;
  const hidden = new Map();
  for (const g of guesses) {
    if (taken.has(g.i) || hidden.has(g.i)) continue;
    const members = new Set([g.i]), corners = new Set([g.slot]);
    for (const h of guesses) {
      if (taken.has(h.i) || members.has(h.i) || Math.hypot(h.x - g.x, h.y - g.y) > 7 * g.k.s) continue;
      const dot = h.k.facing[0] * g.k.facing[0] + h.k.facing[1] * g.k.facing[1];
      if (Math.abs(dot) < 0.85) continue;
      const corner = dot > 0 ? h.slot : 2 + h.slot;
      if (corners.has(corner)) continue;
      members.add(h.i);
      corners.add(corner);
    }
    if (members.size < 3) continue;
    const k = g.k, half = [k.right.map(v => v * size.w / 2), k.down.map(v => v * size.h / 2)];
    const whole = [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([a, b]) => inside([g.x + a * half[0][0] + b * half[1][0], g.y + a * half[0][1] + b * half[1][1]]));
    const d = Math.hypot(...k.down), card = { centre: [g.x, g.y], axis: [k.down[0] / d, k.down[1] / d] };
    if (whole) members.forEach(i => hidden.set(i, card));
  }
  const loose = free.map(i => (hidden.has(i) ? { centre: marks[i].centre, mm: marks[i].s, whole: true, card: hidden.get(i) } : { centre: marks[i].centre, mm: marks[i].s, whole: false }));
  return { cards, unread, loose };
}

// Groups cards into rows. Rows run across the cards' short side; they're listed from
// the top of the photo down, each from left to right.
export function rowsOf(cards) {
  if (!cards.length) return [];
  let c2 = 0, s2 = 0;
  for (const c of cards) { const a = Math.atan2(c.axis[1], c.axis[0]); c2 += Math.cos(2 * a); s2 += Math.sin(2 * a); }
  const a = Math.atan2(s2, c2) / 2;
  // Rows are listed top to bottom and each read left to right, as you'd read the table.
  // With the cards lying sideways the rows run up and down the photo, so they're listed
  // left to right and each read top to bottom. Each direction points along whichever way
  // it mostly runs, so a hair's difference in the cards' angle can't turn the order round.
  const forwards = ([x, y]) => (Math.abs(y) > Math.abs(x) ? (y < 0 ? [-x, -y] : [x, y]) : (x < 0 ? [-x, -y] : [x, y]));
  const v = forwards([Math.cos(a), Math.sin(a)]);   // across the rows
  const u = forwards([-v[1], v[0]]);                // along a row
  const mm = cards.map(c => c.mm).sort((x, y) => x - y)[cards.length >> 1];
  const items = cards.map(c => ({ c, along: c.centre[0] * u[0] + c.centre[1] * u[1], across: c.centre[0] * v[0] + c.centre[1] * v[1] }));
  items.sort((p, q) => p.across - q.across);
  const rows = [];
  let row = [items[0]];
  for (let i = 1; i < items.length; i++) {
    if (items[i].across - items[i - 1].across > 0.55 * CARD.h * mm) { rows.push(row); row = []; }
    row.push(items[i]);
  }
  rows.push(row);
  return rows.map(r => r.sort((p, q) => p.along - q.along).map(p => p.c));
}

// The whole job: a photo in, rows of card ids out. Cards of either layout can be mixed.
export function readLayout(img) {
  const markers = findMarkers(img);
  const single = cardsFrom(markers);
  // All the cards in one photo come from one deck, so read the bezel layout as each
  // card size and keep the size that puts the most marks on cards.
  const score = r => [r.cards.reduce((t, c) => t + c.markers, 0), r.cards.length, -r.unread.length];
  const better = (a, b) => { const x = score(a), y = score(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
  const bezel = CARD_SIZES.map(size => cardsFromBezels(markers, img, size)).reduce((a, b) => (better(b, a) > 0 ? b : a));
  const cards = single.cards.concat(bezel.cards);
  const counts = new Map();
  for (const c of cards) counts.set(c.id, (counts.get(c.id) || 0) + 1);
  const doubles = [...new Set([...single.doubles, ...[...counts].filter(([, n]) => n > 1).map(([id]) => id)])];
  return { markers, cards, doubles, unread: bezel.unread, loose: bezel.loose, rows: rowsOf(cards) };
}
