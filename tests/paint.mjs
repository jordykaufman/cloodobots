// Draws card backs into a grayscale image for the reader's tests.

import { CARD } from '../js/backs.js';
import { MARKERS, REG_MARK, BEZEL, BEZEL_CODES } from '../js/markers.js';

// Paints bezel-layout card backs: the same mark in every corner (the bottom two turned
// round), a brass circle round the centre, and the ring of long and short ticks that
// is the card's code, drawn at `strength` (1 would be as bright as the circle). A
// card's `hide` lists corner marks to leave out: 0 top left, 1 top right, 2 bottom
// left, 3 bottom right.
export function paintBezels(cards, size, w, h, pxPerMm, strength = 0.5) {
  const gray = new Uint8ClampedArray(w * h).fill(170);
  const M = CARD.marker, i = size.inset, mark = MARKERS[REG_MARK];
  const spots = [[i, i, false], [size.w - i - M, i, false], [i, size.h - i - M, true], [size.w - i - M, size.h - i - M, true]];
  const ink = 28 + Math.round(strength * 172), stepA = 2 * Math.PI / BEZEL.ticks;
  for (const { name, cx, cy, angle, hide = [] } of cards) {
    const code = BEZEL_CODES[name];
    const a = angle * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
    const half = Math.hypot(size.w, size.h) / 2 * pxPerMm;
    for (let y = Math.max(0, Math.floor(cy - half)); y < Math.min(h, cy + half); y++) {
      for (let x = Math.max(0, Math.floor(cx - half)); x < Math.min(w, cx + half); x++) {
        const dx = (x - cx) / pxPerMm, dy = (y - cy) / pxPerMm;
        const u = dx * cos + dy * sin + size.w / 2, v = -dx * sin + dy * cos + size.h / 2;
        if (u < 0 || v < 0 || u > size.w || v > size.h) continue;
        let value = 28;
        spots.forEach(([mx, my, flip], k) => {
          if (hide.includes(k)) return;
          let c = Math.floor(u - mx), r = Math.floor(v - my);
          if (c < 0 || r < 0 || c > 7 || r > 7) return;
          if (flip) { c = 7 - c; r = 7 - r; }
          if (r === 0 || r === 7 || c === 0 || c === 7 || mark[(r - 1) * 6 + c - 1] === '1') value = 200;
        });
        const ru = u - size.w / 2, rv = v - size.h / 2, rad = Math.hypot(ru, rv);
        if (Math.abs(rad - BEZEL.circle) <= 0.25) value = 200;
        else if (Math.abs(rad - BEZEL.ring) <= 0.125) value = ink;
        else if (rad >= BEZEL.long && rad <= BEZEL.ring) {
          let t = Math.atan2(ru, -rv);
          if (t < 0) t += 2 * Math.PI;
          const k = Math.round(t / stepA) % BEZEL.ticks;
          const off = Math.abs(((t - k * stepA + Math.PI) % (2 * Math.PI)) - Math.PI) * rad;
          if (off <= BEZEL.width / 2 && rad >= (code[k] === '1' ? BEZEL.long : BEZEL.short)) value = ink;
        }
        gray[y * w + x] = value;
      }
    }
  }
  return { gray, w, h };
}
