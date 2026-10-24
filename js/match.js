// Turns whatever the text reader saw into one of the known cards.
// Names are compared as runs of letters, so line breaks, spacing and stray
// punctuation in the reader's output don't matter.

const LOOKALIKE = { '0': 'o', '1': 'l', '5': 's', '8': 'b', '|': 'l', '$': 's' };

export function normalize(s) {
  return String(s || '').toLowerCase()
    .replace(/[0158|$]/g, c => LOOKALIKE[c] || c)
    .replace(/[^a-z]/g, '');
}

// Fewest single-letter edits needed to turn `pat` into some stretch of `text`.
export function substringDistance(pat, text) {
  const m = pat.length;
  let prev = Array.from({ length: m + 1 }, (_, i) => i);
  let best = m;
  for (let j = 1; j <= text.length; j++) {
    const cur = new Array(m + 1);
    cur[0] = 0;
    for (let i = 1; i <= m; i++) {
      const cost = pat[i - 1] === text[j - 1] ? 0 : 1;
      cur[i] = Math.min(prev[i - 1] + cost, prev[i] + 1, cur[i - 1] + 1);
    }
    if (cur[m] < best) best = cur[m];
    prev = cur;
  }
  return best;
}

// Short names must be read exactly: "hall" is one letter away from "ball".
export function allowedErrors(len) {
  if (len <= 4) return 0;
  if (len <= 6) return 1;
  if (len <= 9) return 2;
  return 3;
}

// How sure the text reader must be of the words that make up a name. Short names have
// to be spelled exactly, and a garbled picture can still come out as an exact "hall", so
// they also need a confident read. Longer names already need a near spelling match.
export const minConfidence = len => (len <= 5 ? 75 : 30);

// Best card for this text, or null. Longer, cleaner matches win, and a near-tie between
// two different cards counts as no answer. `words` (the reader's words with their
// confidence, 0-100) is optional; when given, a name read with too little confidence
// doesn't count.
export function matchCard(text, cards, words = null) {
  const t = normalize(text);
  if (!t) return null;
  const hits = [];
  for (const c of cards) {
    const p = normalize(c.name);
    if (!p) continue;
    const d = substringDistance(p, t);
    if (d > allowedErrors(p.length)) continue;
    hits.push({ card: c, score: p.length - 3 * d, dist: d });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => b.score - a.score);
  const [best, next] = hits;
  const key = normalize(best.card.name);
  if (next && next.score >= best.score - 1 && !key.includes(normalize(next.card.name))) return null;
  if (words) {
    const parts = words.filter(w => {
      const wt = normalize(w.text);
      return wt.length >= 2 && (key.includes(wt) || wt.includes(key) || (wt.length >= 3 && substringDistance(wt, key) <= allowedErrors(wt.length)));
    });
    best.conf = parts.length ? Math.min(...parts.map(w => w.confidence)) : null;
    if (!parts.length) { if (key.length <= 5) return null; }
    else if (best.conf < minConfidence(key.length)) return null;
  }
  return best;
}

// A read good enough to trust on its own: a longer name, spelled exactly, read with high
// confidence. Anything less has to be read the same way twice in a row.
export const isSure = m => !!m && m.dist === 0 && m.conf != null && m.conf >= 90 && normalize(m.card.name).length >= 6;
