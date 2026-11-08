// Pieces the table together during a live scan. Each read sees some cards; cards
// already on the map line the read up with what's known, so the new ones can be placed
// too. Every card is unique, and every read gives a card's position, its angle and,
// from its size, the scale, so one card seen in two views is enough to line them up.
// Positions are in millimetres. Parts of the table never seen together in one view stay
// separate groups until a read shows cards from both.

import { rowsOf } from './backs.js';

// Similarity transforms q = s R p + t, as { s, c, n, tx, ty } (c and n: R's cosine and
// sine).
const apply = (T, [x, y]) => [T.s * (T.c * x - T.n * y) + T.tx, T.s * (T.n * x + T.c * y) + T.ty];
const turn = (T, [x, y]) => [T.c * x - T.n * y, T.n * x + T.c * y];
const unapply = (T, [x, y]) => { const u = (x - T.tx) / T.s, v = (y - T.ty) / T.s; return [T.c * u + T.n * v, -T.n * u + T.c * v]; };
const unturn = (T, [x, y]) => [T.c * x + T.n * y, -T.n * x + T.c * y];

// The similarity that best maps each pair's p onto its q (least squares).
function fit(pairs) {
  const k = pairs.length;
  let px = 0, py = 0, qx = 0, qy = 0;
  for (const { p, q } of pairs) { px += p[0]; py += p[1]; qx += q[0]; qy += q[1]; }
  px /= k; py /= k; qx /= k; qy /= k;
  let a = 0, b = 0, pp = 0;
  for (const { p, q } of pairs) {
    const Px = p[0] - px, Py = p[1] - py, Qx = q[0] - qx, Qy = q[1] - qy;
    a += Px * Qx + Py * Qy;
    b += Px * Qy - Py * Qx;
    pp += Px * Px + Py * Py;
  }
  const r = Math.hypot(a, b);
  if (pp < 1e-9 || r < 1e-12) return null;
  const c = a / r, n = b / r, s = r / pp;
  return { s, c, n, tx: qx - s * (c * px - n * py), ty: qy - s * (n * px + c * py) };
}

const gap = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const median = xs => { const s = xs.slice().sort((a, b) => a - b); return s[s.length >> 1]; };
const far = (T, { p, q }) => { const [x, y] = apply(T, p); return Math.hypot(x - q[0], y - q[1]); };

// How far (mm) a card may sit from where the others say it should before it's
// thought misread or moved, and how much a read's scale may differ from its cards' size.
const TOLERANCE = 10, SCALE_SLACK = 0.25;

export function makeTableMap() {
  // Each group: its cards (id -> position and summed axis, as a doubled angle so that a
  // card lying the other way up agrees), the turn of the last read lined up with it, and
  // the order it began in.
  const groups = [], home = new Map();
  let begun = 0, view = null;
  const axisOf = e => { const a = Math.atan2(e.s2, e.c2) / 2; return [Math.cos(a), Math.sin(a)]; };

  // Lines a read up with a group from the cards they share: { T, out }, where `out`
  // holds cards that disagree with the rest (misread, or moved), to be left alone; or
  // null if the cards can't be squared, and the read is better left out.
  function lineUp(group, anchors) {
    const pairs = anchors.map(c => { const e = group.cards.get(c.id); return { c, p: c.centre, q: [e.x, e.y] }; });
    const out = new Set();
    if (pairs.length >= 2) {
      let T = fit(pairs);
      while (T && pairs.length >= 3) {
        const worst = pairs.reduce((w, pr, i) => (far(T, pr) > far(T, pairs[w]) ? i : w), 0);
        if (far(T, pairs[worst]) <= TOLERANCE) break;
        out.add(pairs[worst].c.id);
        pairs.splice(worst, 1);
        T = fit(pairs);
      }
      if (!T || pairs.some(pr => far(T, pr) > TOLERANCE)) return null;
      if (Math.abs(T.s * median(pairs.map(pr => pr.c.mm)) - 1) > SCALE_SLACK) return null;
      return { T, out };
    }
    // One card: its position, its angle and its size.
    const { c } = pairs[0], e = group.cards.get(c.id), [ax, ay] = axisOf(e);
    let th = Math.atan2(ay, ax) - Math.atan2(c.axis[1], c.axis[0]);
    // An axis is a line, not an arrow, so two turns fit; take the one nearer the group's
    // last, as the phone turns little between reads.
    if (gap(th + Math.PI, group.theta) < gap(th, group.theta)) th += Math.PI;
    const s = 1 / c.mm, cos = Math.cos(th), sin = Math.sin(th);
    return { T: { s, c: cos, n: sin, tx: e.x - s * (cos * c.centre[0] - sin * c.centre[1]), ty: e.y - s * (sin * c.centre[0] + cos * c.centre[1]) }, out };
  }

  function put(group, card, T) {
    const [x, y] = apply(T, card.centre), [ax, ay] = turn(T, card.axis), phi = 2 * Math.atan2(ay, ax);
    const e = group.cards.get(card.id);
    if (!e) {
      group.cards.set(card.id, { x, y, c2: Math.cos(phi), s2: Math.sin(phi), n: 1 });
      home.set(card.id, group);
      return;
    }
    // Later sightings refine the position, up to a point, so the map settles.
    const k = Math.min(e.n, 7);
    e.x = (e.x * k + x) / (k + 1);
    e.y = (e.y * k + y) / (k + 1);
    e.c2 += Math.cos(phi);
    e.s2 += Math.sin(phi);
    e.n++;
  }

  return {
    // Places a read's cards (each { id, centre, axis, mm } in the read's pixels). `size`
    // is the frame's [w, h], for where the view was. Returns false when the read couldn't
    // be lined up with what's known.
    add(cards, size) {
      view = null;
      if (!cards.length) return true;
      const shared = new Map();
      for (const c of cards) {
        const g = home.get(c.id);
        if (g) { if (!shared.has(g)) shared.set(g, []); shared.get(g).push(c); }
      }
      const fits = [];
      const out = new Set();
      for (const [g, anchors] of shared) {
        const lined = lineUp(g, anchors);
        if (!lined) continue;
        fits.push({ g, T: lined.T, n: anchors.length - lined.out.size });
        lined.out.forEach(id => out.add(id));
      }
      if (shared.size && !fits.length) return false;
      if (!fits.length) {
        // Nothing known in view: a new group, in this view's own frame.
        const g = { cards: new Map(), theta: 0, begun: begun++ };
        groups.push(g);
        fits.push({ g, T: { s: 1 / median(cards.map(c => c.mm)), c: 1, n: 0, tx: 0, ty: 0 }, n: 0 });
      }
      fits.sort((a, b) => b.n - a.n || a.g.begun - b.g.begun);
      const main = fits[0];
      // A read with cards from two groups shows how they lie together: join them.
      for (const f of fits.slice(1)) {
        for (const [id, e] of f.g.cards) {
          const [x, y] = apply(main.T, unapply(f.T, [e.x, e.y]));
          const half = Math.atan2(e.s2, e.c2) / 2, w = Math.hypot(e.c2, e.s2);
          const [ax, ay] = turn(main.T, unturn(f.T, [Math.cos(half), Math.sin(half)])), phi = 2 * Math.atan2(ay, ax);
          main.g.cards.set(id, { x, y, c2: w * Math.cos(phi), s2: w * Math.sin(phi), n: e.n });
          home.set(id, main.g);
        }
        groups.splice(groups.indexOf(f.g), 1);
        main.g.begun = Math.min(main.g.begun, f.g.begun);
      }
      for (const c of cards) if (!out.has(c.id)) put(main.g, c, main.T);
      main.g.theta = Math.atan2(main.T.n, main.T.c);
      // Where the view was: the frame, or without its size, the area its cards cover.
      const xs = cards.map(c => c.centre[0]), ys = cards.map(c => c.centre[1]);
      const [x0, y0, x1, y1] = size ? [0, 0, size[0], size[1]] : [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      view = { group: main.g, T: main.T, outline: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(p => apply(main.T, p)) };
      return true;
    },
    // Where the last view was: its group (by when the group began) and the view's centre
    // in millimetres; null if the last read wasn't placed.
    where() {
      if (!view) return null;
      const o = view.outline;
      return { group: view.group.begun, centre: [(o[0][0] + o[2][0]) / 2, (o[0][1] + o[2][1]) / 2] };
    },
    // The groups, in the order they began: each card's position and axis in millimetres,
    // the group's rows of card ids (across the cards' short sides, as in a photo), and
    // whether the last view was in it; plus that view's outline, and `frame`, to find a
    // point of the view's group in the view's own pixels (toFrame) and the view's pixels
    // per millimetre (ppm).
    snapshot() {
      return {
        groups: groups.slice().sort((a, b) => a.begun - b.begun).map(g => {
          const cards = [...g.cards].map(([id, e]) => ({ id, centre: [e.x, e.y], axis: axisOf(e), mm: 1 }));
          return { cards, rows: rowsOf(cards).map(r => r.map(c => c.id)), current: !!view && view.group === g };
        }),
        view: view ? view.outline : null,
        frame: view ? { toFrame: (T => p => unapply(T, p))(view.T), ppm: 1 / view.T.s } : null,
      };
    },
  };
}
