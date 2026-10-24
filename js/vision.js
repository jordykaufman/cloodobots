// Finds the card in a camera frame and cuts it out straight and enlarged, ready for
// the text reader. Everything works on plain grayscale arrays, so the same code runs
// in the browser and in the Node tests.

export function grayFromRGBA(data, w, h) {
  const g = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
  return { gray: g, w, h };
}

// Box-average down to at most maxW pixels wide.
export function shrink(img, maxW) {
  const s = Math.max(1, Math.ceil(img.w / maxW));
  const w = Math.floor(img.w / s), h = Math.floor(img.h / s);
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = 0; dy < s; dy++) {
        const row = (y * s + dy) * img.w + x * s;
        for (let dx = 0; dx < s; dx++) sum += img.gray[row + dx];
      }
      out[y * w + x] = sum / (s * s);
    }
  }
  return { gray: out, w, h, scale: s };
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
}

// Locates the card as the busiest patch of the frame (printed text, borders and the
// illustration make lots of edges; a ceiling or a wall makes few) and measures which
// way it is turned. Returns its centre, the angle of its long side and its size, in the
// coordinates of `img`, or null when nothing card-like is in view.
export function findCard(img) {
  const { gray, w, h } = img;
  const mag = new Float32Array(w * h), dir = new Float32Array(w * h);
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1] - gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1];
      const gy = gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1] - gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1];
      const m = Math.hypot(gx, gy);
      mag[i] = m; dir[i] = Math.atan2(gy, gx); sum += m; sum2 += m * m; n++;
    }
  }
  const mean = sum / n, sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  const thr = Math.max(40, mean + 1.2 * sd);
  const pts = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) if (mag[y * w + x] > thr) pts.push(y * w + x);
  if (pts.length < 0.004 * w * h) return null;

  // Keep only the card: split the frame into small cells, mark the cells busy with
  // edges, and take the biggest joined-up patch of busy cells, favouring the middle of
  // the frame. Lights on the ceiling or a sleeve at the edge form separate patches.
  const CS = 8, gw = Math.ceil(w / CS), gh = Math.ceil(h / CS);
  const cellCount = new Uint16Array(gw * gh);
  for (const i of pts) cellCount[((i / w | 0) / CS | 0) * gw + ((i % w) / CS | 0)]++;
  const busy = new Uint8Array(gw * gh);
  for (let c = 0; c < busy.length; c++) if (cellCount[c] >= 3) busy[c] = 1;
  // Bridge one-cell gaps so a card's outline and its picture join up.
  const joined = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    if (!busy[gy * gw + gx]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = gx + dx, y = gy + dy;
      if (x >= 0 && y >= 0 && x < gw && y < gh) joined[y * gw + x] = 1;
    }
  }
  const label = new Int32Array(gw * gh).fill(-1);
  let best = -1, bestScore = 0;
  const groups = [];
  for (let c = 0; c < joined.length; c++) {
    if (!joined[c] || label[c] >= 0) continue;
    const id = groups.length, stack = [c], cells = [];
    label[c] = id;
    let edges = 0, cxs = 0, cys = 0;
    while (stack.length) {
      const k = stack.pop();
      cells.push(k);
      edges += cellCount[k];
      cxs += (k % gw) * cellCount[k]; cys += (k / gw | 0) * cellCount[k];
      const kx = k % gw, ky = k / gw | 0;
      for (const [nx, ny] of [[kx + 1, ky], [kx - 1, ky], [kx, ky + 1], [kx, ky - 1]]) {
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const nk = ny * gw + nx;
        if (joined[nk] && label[nk] < 0) { label[nk] = id; stack.push(nk); }
      }
    }
    groups.push(cells);
    if (!edges) continue;
    const dx = (cxs / edges + 0.5) / gw - 0.5, dy = (cys / edges + 0.5) / gh - 0.5;
    const score = edges * (1 - Math.min(0.8, Math.hypot(dx, dy)));
    if (score > bestScore) { bestScore = score; best = id; }
  }
  if (best < 0) return null;
  const inside = pts.filter(i => label[((i / w | 0) / CS | 0) * gw + ((i % w) / CS | 0)] === best);
  if (inside.length < 30) return null;

  // A card's border and lettering run along its two axes, so edge directions pile up
  // at the card's angle (and that angle plus 90 degrees). Find that pile.
  const BINS = 90, hist = new Float32Array(BINS);
  for (const i of inside) {
    let a = dir[i] % (Math.PI / 2);
    if (a < 0) a += Math.PI / 2;
    hist[Math.min(BINS - 1, Math.floor(a / (Math.PI / 2) * BINS))] += mag[i];
  }
  let peak = 0, peakVal = -1;
  for (let b = 0; b < BINS; b++) {
    const v = hist[(b + BINS - 1) % BINS] + 2 * hist[b] + hist[(b + 1) % BINS];
    if (v > peakVal) { peakVal = v; peak = b; }
  }
  const lo = hist[(peak + BINS - 1) % BINS], mid = hist[peak], hi = hist[(peak + 1) % BINS];
  const offset = (lo - hi) / (2 * (lo - 2 * mid + hi) || 1);
  const base = (peak + 0.5 + (Number.isFinite(offset) ? Math.max(-0.5, Math.min(0.5, offset)) : 0)) / BINS * (Math.PI / 2);

  // Of the two axes at that angle, the longer spread of edges is the card's long side.
  let mx = 0, my = 0;
  for (const i of inside) { mx += i % w; my += (i / w) | 0; }
  mx /= inside.length; my /= inside.length;
  const spread = a => {
    const ux = Math.cos(a), uy = Math.sin(a), p = [], q = [];
    for (const i of inside) {
      const dx = i % w - mx, dy = ((i / w) | 0) - my;
      p.push(dx * ux + dy * uy); q.push(-dx * uy + dy * ux);
    }
    p.sort((a1, b1) => a1 - b1); q.sort((a1, b1) => a1 - b1);
    return { ux, uy, pLo: percentile(p, 0.02), pHi: percentile(p, 0.98), qLo: percentile(q, 0.02), qHi: percentile(q, 0.98) };
  };
  let s = spread(base);
  let angle = base;
  if (s.qHi - s.qLo > s.pHi - s.pLo) { angle = base + Math.PI / 2; s = spread(angle); }
  const long = s.pHi - s.pLo, short = s.qHi - s.qLo;
  if (short < 8 || long < 8) return null;
  const pm = (s.pHi + s.pLo) / 2, qm = (s.qHi + s.qLo) / 2;
  return { cx: mx + pm * s.ux - qm * s.uy, cy: my + pm * s.uy + qm * s.ux, angle, long, short };
}

// Cuts the card out of `img`, turned so its long side runs top to bottom, then turned a
// further `turn` radians. The result is `outShort` pixels across the card's short side,
// with the contrast stretched.
export function cutOut(img, card, turn = 0, outShort = 520, margin = 1.18) {
  const { gray, w, h } = img;
  const a = card.angle;
  // Output axes in source coordinates: Y follows the long side, X the short side.
  let Xx = Math.sin(a), Xy = -Math.cos(a), Yx = Math.cos(a), Yy = Math.sin(a);
  const c = Math.cos(turn), s = Math.sin(turn);
  [Xx, Xy, Yx, Yy] = [c * Xx + s * Yx, c * Xy + s * Yy, -s * Xx + c * Yx, -s * Xy + c * Yy];
  const sideways = Math.abs(Math.sin(turn)) > 0.5;
  const srcW = (sideways ? card.long : card.short) * margin;
  const srcH = (sideways ? card.short : card.long) * margin;
  const ow = Math.round(sideways ? outShort * card.long / card.short : outShort);
  const oh = Math.round(ow * srcH / srcW);
  const k = srcW / ow;
  const out = new Uint8ClampedArray(ow * oh);
  let fill = 0;
  for (let i = 0; i < gray.length; i += 97) fill += gray[i];
  fill = fill / Math.ceil(gray.length / 97);
  for (let oy = 0; oy < oh; oy++) {
    const v = (oy - oh / 2) * k;
    for (let ox = 0; ox < ow; ox++) {
      const u = (ox - ow / 2) * k;
      const x = card.cx + u * Xx + v * Yx, y = card.cy + u * Xy + v * Yy;
      const x0 = Math.floor(x), y0 = Math.floor(y);
      if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) { out[oy * ow + ox] = fill; continue; }
      const fx = x - x0, fy = y - y0, i = y0 * w + x0;
      out[oy * ow + ox] = (gray[i] * (1 - fx) + gray[i + 1] * fx) * (1 - fy) + (gray[i + w] * (1 - fx) + gray[i + w + 1] * fx) * fy;
    }
  }
  return stretch({ gray: out, w: ow, h: oh });
}

// Spreads the darkest 1% to black and the brightest 1% to white.
export function stretch(img) {
  const hist = new Uint32Array(256);
  for (const v of img.gray) hist[v]++;
  const total = img.gray.length;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > total * 0.01) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > total * 0.01) { hi = v; break; } }
  const range = Math.max(1, hi - lo);
  const out = new Uint8ClampedArray(total);
  for (let i = 0; i < total; i++) out[i] = (img.gray[i] - lo) * 255 / range;
  return { gray: out, w: img.w, h: img.h };
}

// A horizontal band of the image, from `top` to `bottom` as fractions of its height.
export function band(img, top, bottom) {
  const y0 = Math.max(0, Math.floor(img.h * top)), y1 = Math.min(img.h, Math.ceil(img.h * bottom));
  return { gray: img.gray.slice(y0 * img.w, y1 * img.w), w: img.w, h: y1 - y0 };
}

// What to read, cheapest and most likely first. Card names are printed in a band at the
// bottom (or on some editions the top), so read a narrow band at each end of the card,
// both ways up, then wider bands; then the narrow bands with the card turned sideways,
// in case its long side was misjudged; then the whole card as a last resort. `mode` is
// the text reader's layout setting: 6 reads one block of text, 11 hunts for scattered
// text. The reader copes with light lettering on a dark banner by itself.
const NARROW = [[0.75, 1], [0, 0.25]], WIDE = [[0.6, 1], [0, 0.4]];
const both = (turns, bands, mode) => turns.flatMap(turn => bands.map(([top, bottom]) => ({ turn, top, bottom, mode })));
export const READ_PLAN = [
  ...both([0, Math.PI], NARROW, '6'),
  ...both([0, Math.PI], WIDE, '6'),
  ...both([Math.PI / 2, -Math.PI / 2], NARROW, '6'),
  ...both([0, Math.PI], [[0, 1]], '11'),
];
