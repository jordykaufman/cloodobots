// Reads the markers printed on card backs (see tools/test_sheet.py) from one photo of
// cards lying face-down, and works out which cards lie in which row. Everything works
// on a plain grayscale array, so the same code runs in the browser and in the tests.

import { MARKERS, DECOY, CORNER_MARKS, CARD_CORNERS, CARD_MARKERS } from './markers.js';

const CODES = MARKERS.map(s => Uint8Array.from(s, ch => (ch === '1' ? 1 : 0)));

// Card layout in millimetres, as printed: an 8 mm marker whose corner is 5.5 mm in
// from the card's top-left corner (and the same, turned round, at the bottom right).
export const CARD = { w: 63, h: 88, marker: 8, inset: 5.5 };
const toCentre = size => ({ right: size.w / 2 - size.inset - CARD.marker / 2, down: size.h / 2 - size.inset - CARD.marker / 2 });
const TO_CENTRE = toCentre(CARD);

// The corner-mark layout comes in two card sizes: the home-printed test cards, and the
// deck from MakePlayingCards in their US game size (2.2 x 3.43 in, the size of real
// Clue cards), whose narrower card brings the marks closer together.
export const CORNER_SIZES = [
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
    if (m.id === DECOY || CORNER_MARKS.includes(m.id)) continue;
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

// The corner-mark layout: every card carries marks 1-4, one per corner, all facing the
// card's top, and which corner holds which number tells the cards apart. A mark on its
// own doesn't say which corner it's in, so each mark guesses all four, each guess
// putting the card's centre somewhere; the marks of one card agree on one spot. Three
// marks are enough, because the fourth corner holds whichever number is left over.
// Returns cards like cardsFrom does, using the same ids as the single-code layout,
// plus `unread`: places where marks clearly form a card that couldn't be told apart,
// and `loose`: marks that fit no card. `size` is one of CORNER_SIZES.
const CARD_BY_CORNERS = Object.fromEntries(Object.entries(CARD_CORNERS).map(([name, order]) => [order, CARD_MARKERS[name]]));

export function cardsFromCorners(markers, size = CORNER_SIZES[0]) {
  const to = toCentre(size);
  const CORNER_SPOTS = [[-1, -1], [-1, 1], [1, 1], [1, -1]].map(([x, y]) => [x * to.right, y * to.down]);
  const marks = markers.filter(m => CORNER_MARKS.includes(m.id)).map(m => {
    const { right, down, s } = mmSteps(m);
    const r = Math.hypot(...right);
    return { number: CORNER_MARKS.indexOf(m.id) + 1, right, down, s, facing: [right[0] / r, right[1] / r], centre: m.centre };
  });
  const guesses = [];
  marks.forEach((k, i) => CORNER_SPOTS.forEach(([dx, dy], corner) => guesses.push({
    i, corner, k,
    x: k.centre[0] - (k.right[0] * dx + k.down[0] * dy),
    y: k.centre[1] - (k.right[1] * dx + k.down[1] * dy),
  })));
  const taken = new Set(), cards = [], unread = [];
  for (;;) {
    let best = null;
    for (const g of guesses) {
      if (taken.has(g.i)) continue;
      // Marks of one card face the same way, sit in different corners and carry
      // different numbers.
      const members = new Map(), corners = new Set(), numbers = new Set();
      for (const h of guesses) {
        if (taken.has(h.i) || members.has(h.i)) continue;
        if (Math.hypot(h.x - g.x, h.y - g.y) > 7 * g.k.s) continue;
        if (h.k.facing[0] * g.k.facing[0] + h.k.facing[1] * g.k.facing[1] < 0.85) continue;
        if (corners.has(h.corner) || numbers.has(h.k.number)) continue;
        members.set(h.i, h); corners.add(h.corner); numbers.add(h.k.number);
      }
      if (!best || members.size > best.size) best = members;
    }
    if (!best || best.size < 2) break;
    const ms = [...best.values()];
    ms.forEach(h => taken.add(h.i));
    const order = [0, 0, 0, 0];
    for (const h of ms) order[h.corner] = h.k.number;
    const left = [1, 2, 3, 4].filter(n => !order.includes(n));
    const gaps = order.map((n, i) => (n ? -1 : i)).filter(i => i >= 0);
    // Fill the empty corners every possible way; keep the fills that name a card.
    const fills = [];
    const fill = (o, rest, at) => {
      if (at === gaps.length) { const key = o.join(''); if (CARD_BY_CORNERS[key]) fills.push(CARD_BY_CORNERS[key]); return; }
      rest.forEach((n, j) => { o[gaps[at]] = n; fill(o, rest.filter((_, q) => q !== j), at + 1); o[gaps[at]] = 0; });
    };
    fill(order.slice(), left, 0);
    const centre = [ms.reduce((t, h) => t + h.x, 0) / ms.length, ms.reduce((t, h) => t + h.y, 0) / ms.length];
    const mm = ms.reduce((t, h) => t + h.k.s, 0) / ms.length;
    const d = ms[0].k.down, dl = Math.hypot(...d);
    const card = { centre, axis: [d[0] / dl, d[1] / dl], mm, markers: ms.length };
    if (fills.length === 1) cards.push({ id: fills[0], ...card });
    else unread.push({ ...card, candidates: fills });
  }
  const loose = marks.filter((_, i) => !taken.has(i)).map(k => ({ number: k.number, centre: k.centre, mm: k.s }));
  return { cards, unread, loose };
}

// Groups cards into rows. Rows run across the cards' short side; they're listed from
// the top of the photo down, each from left to right.
export function rowsOf(cards) {
  if (!cards.length) return [];
  let c2 = 0, s2 = 0;
  for (const c of cards) { const a = Math.atan2(c.axis[1], c.axis[0]); c2 += Math.cos(2 * a); s2 += Math.sin(2 * a); }
  const a = Math.atan2(s2, c2) / 2;
  let v = [Math.cos(a), Math.sin(a)];          // across the rows
  if (v[1] < 0 || (Math.abs(v[1]) < 1e-6 && v[0] < 0)) v = [-v[0], -v[1]];
  let u = [-v[1], v[0]];                        // along a row
  if (u[0] < 0) u = [-u[0], -u[1]];
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
  // All the cards in one photo come from one deck, so read the corner marks as each
  // card size and keep the size that puts the most marks on cards.
  const score = r => [r.cards.reduce((t, c) => t + c.markers, 0), r.cards.length, -r.unread.length];
  const better = (a, b) => { const x = score(a), y = score(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
  const corner = CORNER_SIZES.map(size => cardsFromCorners(markers, size)).reduce((a, b) => (better(b, a) > 0 ? b : a));
  const cards = single.cards.concat(corner.cards);
  // A card with only two corners readable could be one of two cards. If all but one of
  // those are lying elsewhere in the photo, it's the one left.
  let unread = corner.unread;
  for (let changed = true; changed;) {
    changed = false;
    const seen = new Set(cards.map(c => c.id));
    unread = unread.filter(u => {
      const left = u.candidates.filter(id => !seen.has(id));
      if (left.length !== 1) return true;
      cards.push({ id: left[0], centre: u.centre, axis: u.axis, mm: u.mm, markers: u.markers });
      seen.add(left[0]);
      changed = true;
      return false;
    });
  }
  const counts = new Map();
  for (const c of cards) counts.set(c.id, (counts.get(c.id) || 0) + 1);
  const doubles = [...new Set([...single.doubles, ...[...counts].filter(([, n]) => n > 1).map(([id]) => id)])];
  return { markers, cards, doubles, unread, rows: rowsOf(cards) };
}
