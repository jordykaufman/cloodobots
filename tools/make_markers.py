"""Makes the set of card-back markers and writes them to js/markers.js.

Each marker is a 6x6 grid of squares inside a solid ring. The codes are picked so
that any two differ in at least MIN_APART squares however either one is turned, and
no code looks like itself turned, so a reader can tell which way up a card lies and
a few misread squares can't turn one card into another. Re-running gives the same
codes (the random seed is fixed).

The bezel layout's corner mark must also give nothing away to a person: no shapes, no
mirror symmetry and no heavier side, so nobody can see which way up a card lies. And
its card codes are rings of 72 ticks, long or short, any two rings differing in at
least BEZEL_APART ticks even when one card lies the other way up.
"""
import json, random, pathlib

N_CODES = 34        # 0 = decoy, 1-21 = cards, 22-33 = sizes on the test sheet
N_CORNER = 1        # 34 = the mark in every corner of the bezel layout
BEZEL_TICKS = 72
BEZEL_APART = 24
MIN_APART = 10
MIN_SELF = 8
random.seed(20261103)

def rot(bits):  # turn a 6x6 grid a quarter turn clockwise
    return tuple(bits[(5 - c) * 6 + r] for r in range(6) for c in range(6))

def turns(bits):
    out = [bits]
    for _ in range(3): out.append(rot(out[-1]))
    return out

def apart(a, b):
    return sum(x != y for x, y in zip(a, b))

codes = []
while len(codes) < N_CODES:
    c = tuple(random.randint(0, 1) for _ in range(36))
    if not 13 <= sum(c) <= 23: continue
    t = turns(c)
    if min(apart(c, x) for x in t[1:]) < MIN_SELF: continue
    if any(apart(x, o) < MIN_APART for o in codes for x in t): continue
    codes.append(c)


# A corner mark that looks like noise. A mark gives away which way up it is when it
# looks like a thing: a big joined-up patch of either colour makes a shape, mirror
# symmetry reads as an upright object, and a heavier half looks like a base.
def flips(b):
    return [tuple(b[r * 6 + 5 - c] for r in range(6) for c in range(6)),      # left-right
            tuple(b[(5 - r) * 6 + c] for r in range(6) for c in range(6)),    # top-bottom
            tuple(b[c * 6 + r] for r in range(6) for c in range(6)),          # the diagonals
            tuple(b[(5 - c) * 6 + 5 - r] for r in range(6) for c in range(6))]

def biggest_patch(b, colour):
    seen, best = set(), 0
    for i in range(36):
        if b[i] != colour or i in seen: continue
        stack, n = [i], 0
        seen.add(i)
        while stack:
            j = stack.pop(); n += 1; r, c = divmod(j, 6)
            for rr, cc in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
                k = rr * 6 + cc
                if 0 <= rr < 6 and 0 <= cc < 6 and b[k] == colour and k not in seen:
                    seen.add(k); stack.append(k)
        best = max(best, n)
    return best

def looks_like_noise(b):
    top, left = sum(b[:18]), sum(b[r * 6 + c] for r in range(6) for c in range(3))
    solid = any(len({b[(r + dr) * 6 + c + dc] for dr in (0, 1) for dc in (0, 1)}) == 1 for r in range(5) for c in range(5))
    return (16 <= sum(b) <= 20 and abs(2 * top - sum(b)) <= 1 and abs(2 * left - sum(b)) <= 1 and not solid
            and min(apart(b, f) for f in flips(b)) >= 14 and min(apart(b, t) for t in turns(b)[1:]) >= 14
            and biggest_patch(b, 1) <= 4 and biggest_patch(b, 0) <= 4)

while len(codes) < N_CODES + N_CORNER:
    c = tuple(random.randint(0, 1) for _ in range(36))
    if not looks_like_noise(c): continue
    if any(apart(x, o) < MIN_APART for o in codes for x in turns(c)): continue
    codes.append(c)

DECK = ['Scarlet', 'Mustard', 'White', 'Green', 'Peacock', 'Plum',
        'Candlestick', 'Dagger', 'Lead Pipe', 'Pistol', 'Rope', 'Wrench',
        'Bathroom', 'Bedroom', 'Courtyard', 'Dining Room', 'Game Room', 'Garage', 'Kitchen', 'Living Room', 'Office']

# The bezel codes: 72 ticks, about half of them long on every card so the rings all
# look equally busy, and any two rings at least BEZEL_APART ticks apart however the
# cards lie (a card the other way up shows its ring turned by 36 ticks).
rng = random.Random(20261106)
half = BEZEL_TICKS // 2
turn_ring = lambda c: c[half:] + c[:half]
rings = []
while len(rings) < len(DECK):
    c = tuple(rng.randint(0, 1) for _ in range(BEZEL_TICKS))
    if not 32 <= sum(c) <= 40 or apart(c, turn_ring(c)) < BEZEL_APART:
        continue
    if any(apart(c, o) < BEZEL_APART or apart(c, turn_ring(o)) < BEZEL_APART for o in rings):
        continue
    rings.append(c)
root = pathlib.Path(__file__).resolve().parent.parent
js = f"""// Card-back markers, made by tools/make_markers.py. Don't edit by hand.
// Each is 36 squares (6 rows of 6, top row first; 1 = ink) inside a solid ring.
// Any two differ in at least {MIN_APART} squares however they are turned.
export const MARKERS = {json.dumps([''.join(map(str, c)) for c in codes], indent=0)};

// Marker 0 is the decoy printed in two corners of every card.
export const DECOY = 0;

// Which marker each card of our printed deck carries: the cards of Clue (2013), house
// rooms only. Markers 22-33 are only used on the size test page.
export const CARD_MARKERS = {json.dumps({name: i + 1 for i, name in enumerate(DECK)}, indent=2)};

// The bezel layout: every card carries this one mark in each corner, the bottom two
// turned round, so the back is the same picture either way up. It only tells the
// camera where the card lies; it's chosen to look like noise so a person can't see
// which way up the card is.
export const REG_MARK = 34;

// The card's code is the ring of graduations round the compass rose: a tick every 5
// degrees, clockwise from the card's top, each long or short. Sizes in millimetres
// from the card's centre: the brass circle, the faint ring the ticks hang from, and
// where short and long ticks end; `width` is a tick's thickness.
export const BEZEL = {json.dumps({'ticks': BEZEL_TICKS, 'circle': 16, 'ring': 14.6, 'short': 13.4, 'long': 12.3, 'width': 0.3})};

// Each card's ring, tick 0 first; 1 is a long tick. Any two rings differ in at least
// {BEZEL_APART} ticks, even against a ring turned by 36 (a card the other way up).
export const BEZEL_CODES = {json.dumps({name: ''.join(map(str, r)) for name, r in zip(DECK, rings)}, indent=2)};
"""
(root / 'js' / 'markers.js').write_text(js)
print(len(codes), 'codes; closest pair differs in',
      min(apart(x, b) for i, a in enumerate(codes) for b in codes[i + 1:] for x in turns(a)), 'squares')
