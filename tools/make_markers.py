"""Makes the set of card-back markers and writes them to js/markers.js.

Each marker is a 6x6 grid of squares inside a solid ring. The codes are picked so
that any two differ in at least MIN_APART squares however either one is turned, and
no code looks like itself turned, so a reader can tell which way up a card lies and
a few misread squares can't turn one card into another. Re-running gives the same
codes (the random seed is fixed).

The four corner marks must also give nothing away to a person: no shapes, no mirror
symmetry and no heavier side, so nobody can see which way up a card lies. And the
cards' corner orders are spread so that no single corner hints at a card's type.
"""
import itertools, json, math, random, pathlib
from collections import Counter

N_CODES = 34        # 0 = decoy, 1-21 = cards, 22-33 = sizes on the test sheet
N_CORNER = 4        # 34-37 = corner marks 1-4
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


# Corner marks that look like noise. A mark gives away which way up it is when it
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
TYPES = ['suspect'] * 6 + ['weapon'] * 6 + ['room'] * 9


# The cards' corner orders: 21 of the 24 ways to put marks 1-4 in the four corners,
# shared out so that within each type every corner holds each mark about equally
# often. Then no corner on its own says anything about a card's type.
def type_info(seen):
    """How much what's seen tells about the type (mutual information, in bits)."""
    pairs = list(zip(TYPES, seen))
    n, joint, a, b = len(pairs), Counter(pairs), Counter(TYPES), Counter(seen)
    return sum(k / n * math.log2(k * n / (a[t] * b[s])) for (t, s), k in joint.items())

def leak(orders):
    single = [type_info([o[k] for o in orders]) for k in range(4)]
    pairs = [type_info([(o[j], o[k]) for o in orders]) for j, k in itertools.combinations(range(4), 2)]
    return 10 * max(single) + sum(single) + 0.2 * sum(pairs)

rng = random.Random(20261105)
orders = list(itertools.permutations([1, 2, 3, 4]))
rng.shuffle(orders)
cur, spare, best = orders[:len(DECK)], orders[len(DECK):], None
best = leak(cur)
for _ in range(40000):
    new, sp = cur[:], spare[:]
    if rng.random() < 0.7:
        i, j = rng.sample(range(len(new)), 2); new[i], new[j] = new[j], new[i]
    else:
        i, j = rng.randrange(len(new)), rng.randrange(len(sp)); new[i], sp[j] = sp[j], new[i]
    score = leak(new)
    if score <= best:
        cur, spare, best = new, sp, score
PERMS = cur
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

// The corner-mark layout: every card carries the same four marks, standing for 1 to 4,
// one in each corner, and the card is told apart by which corner holds which. These
// are the markers for marks 1, 2, 3 and 4, chosen to look like noise so a person
// can't see which way up a card lies.
export const CORNER_MARKS = [34, 35, 36, 37];

// Each card's corners, read from the top-left corner going counterclockwise (top left,
// bottom left, bottom right, top right). "2413" puts mark 2 top left, 4 bottom left,
// 1 bottom right and 3 top right. The marks all face the card's top, which is how the
// reader knows where to start. The orders are shared out so that no single corner
// hints at whether a card is a suspect, weapon or room.
export const CARD_CORNERS = {json.dumps({name: ''.join(map(str, p)) for name, p in zip(DECK, PERMS)}, indent=2)};
"""
(root / 'js' / 'markers.js').write_text(js)
print(len(codes), 'codes; closest pair differs in',
      min(apart(x, b) for i, a in enumerate(codes) for b in codes[i + 1:] for x in turns(a)), 'squares')
