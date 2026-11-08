// Pieces the table together during a live scan. Each read sees some cards; cards
// already on the map line the read up with what's known, so the new ones can be placed
// too. Every card is unique, and every read gives a card's position, its angle and, from
// its size, the scale, so one card seen in two views is enough to line them up.
// Positions are in millimetres. Parts of the table never seen together in one view stay
// separate groups until a read shows cards from both.
//
// A phone held at an angle sees the far side of the table smaller than the near side, so
// one scale for a whole view won't do. Instead each card's own size in the picture says
// how many pixels a millimetre is where it lies, and the step from a card on the map to
// another card is measured at the scale of those two. The scale changes only gradually
// across a picture, so this holds wherever the phone points.

import { rowsOf } from './backs.js';

const sub = ([a, b], [c, d]) => [a - c, b - d];
const turnBy = (th, [x, y]) => [Math.cos(th) * x - Math.sin(th) * y, Math.sin(th) * x + Math.cos(th) * y];
const angle = ([x, y]) => Math.atan2(y, x);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const gap = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const median = xs => { const s = xs.slice().sort((a, b) => a - b); return s[s.length >> 1]; };
// The mean of angles (radians) given as [angle, weight].
const meanAngle = list => { let c = 0, s = 0; for (const [a, w] of list) { c += w * Math.cos(a); s += w * Math.sin(a); } return Math.atan2(s, c); };

// How far (mm) a card may sit from where the cards round it put it before it's thought
// misread, or moved since it was placed.
const TOLERANCE = 12;
// A card that couldn't be read, this close (mm) to where the map has a card, is that card.
// Cards lie at least a card's width (56 mm) apart, centre to centre.
const SAME_CARD = 30;
// Cards closer than this (mm) are too close together to tell the turn of a view from.
const MEASURABLE = 40;

// Where card c lies, from cards in the same read whose places are known (each { c, q }):
// from each of the nearest, the step to c, turned by th and measured in millimetres at
// the scale of the two cards. Nearer ones count for more.
function placeFrom(c, known, th) {
  const near = known.filter(k => k.c.id !== c.id).map(k => ({ k, d: dist(c.centre, k.c.centre) }))
    .sort((a, b) => a.d - b.d).slice(0, 3);
  if (!near.length) return null;
  let x = 0, y = 0, sum = 0;
  for (const { k, d } of near) {
    const ppm = (k.c.mm + c.mm) / 2, [dx, dy] = turnBy(th, sub(c.centre, k.c.centre)), w = 1 / (d + 30 * ppm);
    x += w * (k.q[0] + dx / ppm);
    y += w * (k.q[1] + dy / ppm);
    sum += w;
  }
  return [x / sum, y / sum];
}

export function makeTableMap() {
  // Each group: its cards (id -> position and summed axis, as a doubled angle so that a
  // card lying the other way up agrees), the cards seen there that couldn't be read yet
  // (`waiting`, positions and axes the same way, with how often each was seen), the turn
  // of the last read lined up with it, and the order it began in.
  const groups = [], home = new Map();
  // The last read's view, if it was placed; and the last view placed, which the map keeps
  // showing through a few reads that couldn't be (a frame blurred as the phone moves).
  let begun = 0, view = null, shown = null, since = 0;
  const SHOW_FOR = 3;
  const axisOf = e => { const a = Math.atan2(e.s2, e.c2) / 2; return [Math.cos(a), Math.sin(a)]; };
  const nearest = (list, q) => list.reduce((best, e) => { const d = Math.hypot(e.x - q[0], e.y - q[1]); return d < best.d ? { e, d } : best; }, { e: null, d: Infinity });

  // Where points of the last read lie on its group's map, from the cards read in it.
  const placed = (v, points) => {
    const known = v.here.map(h => ({ c: { id: h.id, centre: h.p, mm: h.mm }, q: h.q }));
    return points.map(p => placeFrom({ id: null, centre: p.centre, mm: p.mm }, known, v.th));
  };

  // The turn from a read's pixels to a group's millimetres: from the directions between
  // known cards far enough apart to measure; with only one, or close ones, from the
  // cards' own axes (a line, not an arrow, so of the two turns that fit, the one nearer
  // the group's last, as the phone turns little between reads).
  function turnOf(known, group) {
    const pairs = [];
    for (let i = 0; i < known.length; i++) for (let j = i + 1; j < known.length; j++) {
      const a = known[i], b = known[j], d = dist(a.c.centre, b.c.centre) / ((a.c.mm + b.c.mm) / 2);
      if (d > MEASURABLE) pairs.push([angle(sub(b.q, a.q)) - angle(sub(b.c.centre, a.c.centre)), d]);
    }
    if (pairs.length) return meanAngle(pairs);
    const th = meanAngle(known.map(k => [2 * (angle(axisOf(group.cards.get(k.c.id))) - angle(k.c.axis)), 1])) / 2;
    return gap(th + Math.PI, group.theta) < gap(th, group.theta) ? th + Math.PI : th;
  }

  // Lines a read up with a group from the cards they share: { th, known, out }, the
  // turn, the shared cards with their places, and `out`, cards that disagree with the
  // rest (misread, or moved), to be left alone; or null if the shared cards can't be
  // squared, and the read is better left out.
  function lineUp(group, cards) {
    let known = cards.map(c => { const e = group.cards.get(c.id); return { c, q: [e.x, e.y] }; });
    const out = new Set();
    for (;;) {
      const th = turnOf(known, group);
      if (known.length < 2) return { th, known, out };
      const off = known.map(k => dist(placeFrom(k.c, known, th), k.q));
      const worst = off.indexOf(Math.max(...off));
      if (off[worst] <= TOLERANCE) return { th, known, out };
      // Two that disagree: no telling which is wrong.
      if (known.length === 2) return null;
      out.add(known[worst].c.id);
      known = known.filter((_, i) => i !== worst);
    }
  }

  function put(group, c, q, th) {
    const phi = 2 * angle(turnBy(th, c.axis)), e = group.cards.get(c.id);
    if (!e) {
      group.cards.set(c.id, { x: q[0], y: q[1], c2: Math.cos(phi), s2: Math.sin(phi), n: 1 });
      home.set(c.id, group);
      return;
    }
    // Later sightings refine the position, up to a point, so the map settles.
    const k = Math.min(e.n, 7);
    e.x = (e.x * k + q[0]) / (k + 1);
    e.y = (e.y * k + q[1]) / (k + 1);
    e.c2 += Math.cos(phi);
    e.s2 += Math.sin(phi);
    e.n++;
  }

  return {
    // Places a read's cards (each { id, centre, axis, mm } in the read's pixels). `size`
    // is the frame's [w, h], for where the view was. `strays` are cards in view that
    // couldn't be read ({ centre, axis, mm }, axis null if not known), kept as waiting
    // cards where the map has none. Returns false when the read couldn't be lined up with
    // what's known.
    add(cards, size, strays = []) {
      view = null;
      since++;
      if (!cards.length) return true;
      const shared = new Map();
      for (const c of cards) {
        const g = home.get(c.id);
        if (g) { if (!shared.has(g)) shared.set(g, []); shared.get(g).push(c); }
      }
      const lined = [], out = new Set();
      for (const [g, list] of shared) {
        const l = lineUp(g, list);
        if (l) { lined.push({ g, ...l }); l.out.forEach(id => out.add(id)); }
      }
      if (shared.size && !lined.length) return false;
      let main;
      if (!lined.length) {
        // Nothing known in view: a new group, measured from the card nearest the middle.
        const g = { cards: new Map(), waiting: [], theta: 0, begun: begun++ };
        groups.push(g);
        const mid = size ? [size[0] / 2, size[1] / 2] : [median(cards.map(c => c.centre[0])), median(cards.map(c => c.centre[1]))];
        const first = cards.reduce((a, b) => (dist(a.centre, mid) <= dist(b.centre, mid) ? a : b));
        put(g, first, [0, 0], 0);
        main = { g, th: 0 };
      } else {
        lined.sort((a, b) => b.known.length - a.known.length || a.g.begun - b.g.begun);
        main = lined[0];
        // A read with cards from two groups shows how they lie together: join them.
        // Placed from the main group's cards, the other group's cards in view say where
        // that group's map sits on the main one; it's turned by the difference of the two
        // groups' turns from this read.
        for (const f of lined.slice(1)) {
          const R = main.th - f.th, shift = [0, 0];
          for (const k of f.known) {
            const to = placeFrom(k.c, main.known, main.th), r = turnBy(R, k.q);
            shift[0] += (to[0] - r[0]) / f.known.length;
            shift[1] += (to[1] - r[1]) / f.known.length;
          }
          const moved = e => {
            const [x, y] = turnBy(R, [e.x, e.y]), w = Math.hypot(e.c2, e.s2), phi = Math.atan2(e.s2, e.c2) + 2 * R;
            return { ...e, x: x + shift[0], y: y + shift[1], c2: w * Math.cos(phi), s2: w * Math.sin(phi) };
          };
          for (const [id, e] of f.g.cards) {
            main.g.cards.set(id, moved(e));
            home.set(id, main.g);
          }
          main.g.waiting.push(...f.g.waiting.map(moved));
          groups.splice(groups.indexOf(f.g), 1);
          main.g.begun = Math.min(main.g.begun, f.g.begun);
        }
      }
      // The cards in view the map knows, then the others placed from them; known cards
      // are refined from the cards round them.
      const known = cards.filter(c => home.get(c.id) === main.g && !out.has(c.id)).map(c => { const e = main.g.cards.get(c.id); return { c, q: [e.x, e.y] }; });
      const places = [];
      for (const c of cards) {
        if (out.has(c.id)) continue;
        const q = placeFrom(c, known, main.th);
        if (q) places.push([c, q]);
      }
      for (const [c, q] of places) put(main.g, c, q, main.th);
      main.g.theta = main.th;

      // Where the view was, roughly: one scale and turn through the middle of its cards.
      const here = cards.filter(c => home.get(c.id) === main.g && !out.has(c.id)).map(c => { const e = main.g.cards.get(c.id); return { id: c.id, p: c.centre, q: [e.x, e.y], mm: c.mm }; });
      const s = 1 / median(here.map(h => h.mm)), pm = [0, 1].map(i => here.reduce((t, h) => t + h.p[i], 0) / here.length);
      const qm = [0, 1].map(i => here.reduce((t, h) => t + h.q[i], 0) / here.length);
      const toMap = p => { const [dx, dy] = turnBy(main.th, sub(p, pm)); return [qm[0] + s * dx, qm[1] + s * dy]; };
      const xs = cards.map(c => c.centre[0]), ys = cards.map(c => c.centre[1]);
      const [x0, y0, x1, y1] = size ? [0, 0, size[0], size[1]] : [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      view = { group: main.g, th: main.th, here, ppm: 1 / s, outline: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(toMap) };
      shown = view;
      since = 0;

      // Cards in view that couldn't be read, other than ones the map already has, wait on
      // the map until they're read; a card read at last takes the place of its waiting one.
      const cardsHere = [...main.g.cards.values()];
      placed(view, strays).forEach((q, i) => {
        if (!q || nearest(cardsHere, q).d <= SAME_CARD) return;
        const st = strays[i], axis = st.axis || cards.reduce((a, b) => (dist(a.centre, st.centre) <= dist(b.centre, st.centre) ? a : b)).axis;
        const phi = 2 * angle(turnBy(main.th, axis)), { e, d } = nearest(main.g.waiting, q);
        if (e && d <= SAME_CARD) {
          const k = Math.min(e.n, 7);
          e.x = (e.x * k + q[0]) / (k + 1);
          e.y = (e.y * k + q[1]) / (k + 1);
          e.c2 += Math.cos(phi);
          e.s2 += Math.sin(phi);
          e.n++;
        } else main.g.waiting.push({ x: q[0], y: q[1], c2: Math.cos(phi), s2: Math.sin(phi), n: 1 });
      });
      main.g.waiting = main.g.waiting.filter(e => nearest(cardsHere, [e.x, e.y]).d > SAME_CARD);
      return true;
    },
    // Of `points` in the last read's pixels (each { centre, mm }), the ones not lying on a
    // card the map already has: a card it knows, whose ring didn't read in this read, is
    // no card it can't read. All of them when the last read couldn't be placed.
    unknown(points) {
      if (!view || !points.length) return points.slice();
      const cardsHere = [...view.group.cards.values()];
      return points.filter((p, i) => { const q = placed(view, [p])[0]; return !q || nearest(cardsHere, q).d > SAME_CARD; });
    },
    // Where the last view was: its group (by when the group began) and the view's centre
    // in millimetres; null if the last read wasn't placed.
    where() {
      if (!view) return null;
      const o = view.outline;
      return { group: view.group.begun, centre: [(o[0][0] + o[2][0]) / 2, (o[0][1] + o[2][1]) / 2] };
    },
    // The groups, in the order they began: each card's position and axis in millimetres,
    // the group's rows of card ids (across the cards' short sides, as in a photo), the
    // cards seen there that couldn't be read yet (`waiting`: position and axis, once seen
    // in two reads, so one misread frame doesn't add one), and whether the view is in it;
    // plus the view's outline (the last read's, or, through a few reads that couldn't be
    // placed, the last placed), and `frame`, for the last read only if it was placed, to
    // find a point of its group in the read's own pixels (toFrame, from the nearest card in
    // view) and its pixels per millimetre (ppm).
    snapshot() {
      const v = view, seen = shown && since <= SHOW_FOR && groups.includes(shown.group) ? shown : null;
      return {
        groups: groups.slice().sort((a, b) => a.begun - b.begun).map(g => {
          const cards = [...g.cards].map(([id, e]) => ({ id, centre: [e.x, e.y], axis: axisOf(e), mm: 1 }));
          const waiting = g.waiting.filter(e => e.n >= 2).map(e => ({ centre: [e.x, e.y], axis: axisOf(e) }));
          return { cards, rows: rowsOf(cards).map(r => r.map(c => c.id)), waiting, current: !!seen && seen.group === g };
        }),
        view: seen ? seen.outline : null,
        frame: v ? {
          toFrame: q => {
            const k = v.here.reduce((a, b) => (dist(a.q, q) <= dist(b.q, q) ? a : b));
            const [dx, dy] = turnBy(-v.th, sub(q, k.q));
            return [k.p[0] + dx * k.mm, k.p[1] + dy * k.mm];
          },
          ppm: v.ppm,
        } : null,
      };
    },
  };
}
