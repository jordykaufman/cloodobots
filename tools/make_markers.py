"""Makes the set of card-back markers and writes them to js/markers.js.

Each marker is a 6x6 grid of squares inside a solid ring. The codes are picked so
that any two differ in at least MIN_APART squares however either one is turned, and
no code looks like itself turned, so a reader can tell which way up a card lies and
a few misread squares can't turn one card into another. Re-running gives the same
codes (the random seed is fixed).
"""
import json, random, pathlib

N_CODES = 38        # 0 = decoy, 1-21 = cards, 22-33 = sizes on the test sheet, 34-37 = corner marks 1-4
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

DECK = ['Scarlet', 'Mustard', 'White', 'Green', 'Peacock', 'Plum',
        'Candlestick', 'Knife', 'Lead Pipe', 'Revolver', 'Rope', 'Wrench',
        'Bathroom', 'Bedroom', 'Courtyard', 'Dining Room', 'Game Room', 'Garage', 'Kitchen', 'Living Room', 'Office']
# The 24 ways to put marks 1-4 in four corners; the first 21 go to the cards.
import itertools
PERMS = list(itertools.permutations([1, 2, 3, 4]))[:len(DECK)]
root = pathlib.Path(__file__).resolve().parent.parent
js = f"""// Card-back markers, made by tools/make_markers.py. Don't edit by hand.
// Each is 36 squares (6 rows of 6, top row first; 1 = ink) inside a solid ring.
// Any two differ in at least {MIN_APART} squares however they are turned.
export const MARKERS = {json.dumps([''.join(map(str, c)) for c in codes], indent=0)};

// Marker 0 is the decoy printed in two corners of every card.
export const DECOY = 0;

// Which marker each card of our printed deck carries (the Clue 2013 house rooms, with
// a Knife and a Revolver). Markers 22-33
// are only used on the size test page.
export const CARD_MARKERS = {json.dumps({name: i + 1 for i, name in enumerate(DECK)}, indent=2)};

// The corner-mark layout: every card carries the same four marks, standing for 1 to 4,
// one in each corner, and the card is told apart by which corner holds which. These
// are the markers for marks 1, 2, 3 and 4.
export const CORNER_MARKS = [34, 35, 36, 37];

// Each card's corners, read from the top-left corner going counterclockwise (top left,
// bottom left, bottom right, top right). "2413" puts mark 2 top left, 4 bottom left,
// 1 bottom right and 3 top right. The marks all face the card's top, which is how the
// reader knows where to start.
export const CARD_CORNERS = {json.dumps({name: ''.join(map(str, p)) for name, p in zip(DECK, PERMS)}, indent=2)};
"""
(root / 'js' / 'markers.js').write_text(js)
print(len(codes), 'codes; closest pair differs in',
      min(apart(x, b) for i, a in enumerate(codes) for b in codes[i + 1:] for x in turns(a)), 'squares')
