"""Draws print/card-back-test-sheet.pdf: every card back at real size, plus a page of
marker sizes and shades, for a print-and-laminate test of reading cards from one photo.

Run from the project folder: python3 tools/test_sheet.py
"""
import json, math, re, pathlib
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas

ROOT = pathlib.Path(__file__).resolve().parent.parent
src = (ROOT / 'js' / 'markers.js').read_text()
MARKERS = json.loads(re.search(r'MARKERS = (\[.*?\]);', src, re.S).group(1))
CARD_MARKERS = json.loads(re.search(r'CARD_MARKERS = (\{.*?\});', src, re.S).group(1))
CORNER_MARKS = json.loads(re.search(r'CORNER_MARKS = (\[.*?\]);', src, re.S).group(1))
CARD_CORNERS = json.loads(re.search(r'CARD_CORNERS = (\{.*?\});', src, re.S).group(1))
DECOY = 0

NAVY = HexColor('#141B2A')
BRASS = HexColor('#D9B46A')
INK = HexColor('#172030')
MUTED = HexColor('#566173')
CARD_W, CARD_H, RADIUS = 63 * mm, 88 * mm, 3 * mm
MARKER = 8 * mm          # the marker's ring and squares; one more square of clear space surrounds it
MARKER_INSET = 5.5 * mm  # from the card's edge to the marker


def marker(c, x, y, size, bits, strength=1.0, upside_down=False):
    """A marker whose top-left corner is at (x, y), y measured up from the page bottom."""
    cell = size / 8
    c.setFillColor(NAVY)
    c.rect(x - cell, y - size - cell, size + 2 * cell, size + 2 * cell, stroke=0, fill=1)
    c.setFillColor(BRASS)
    c.setFillAlpha(strength)
    for r in range(8):
        for col in range(8):
            ring = r in (0, 7) or col in (0, 7)
            on = ring or bits[(r - 1) * 6 + (col - 1)] == '1'
            if not on:
                continue
            rr, cc = (7 - r, 7 - col) if upside_down else (r, col)
            c.rect(x + cc * cell, y - (rr + 1) * cell, cell, cell, stroke=0, fill=1)
    c.setFillAlpha(1)


def lattice(c, x, y, w, h):
    c.setStrokeColor(BRASS)
    c.setStrokeAlpha(0.13)
    c.setLineWidth(0.25 * mm)
    step = 2.75 * mm
    k = -h
    while k < w + h:
        c.line(x + k, y, x + k + h, y + h)
        c.line(x + k, y + h, x + k + h, y)
        k += step
    c.setStrokeAlpha(1)


def card_back(c, x, y, code, corners=None, w=CARD_W, h=CARD_H, bleed=0):
    """A card back with its bottom-left corner at (x, y). A print service's cards can
    be a little bigger than ours (w, h) and need the background to run past the cut
    line (bleed); the marks then stay where the reader expects them, measured from
    the card's centre."""
    if bleed:
        c.setFillColor(NAVY)
        c.rect(x - bleed, y - bleed, w + 2 * bleed, h + 2 * bleed, stroke=0, fill=1)
        lattice(c, x - bleed, y - bleed, w + 2 * bleed, h + 2 * bleed)
    else:
        path = c.beginPath()
        path.roundRect(x, y, w, h, RADIUS)
        c.saveState()
        c.clipPath(path, stroke=0, fill=0)
        c.setFillColor(NAVY)
        c.rect(x, y, w, h, stroke=0, fill=1)
        lattice(c, x, y, w, h)
        c.restoreState()

    c.setStrokeColor(BRASS)
    c.setLineWidth(0.4 * mm)
    c.roundRect(x + 2.5 * mm, y + 2.5 * mm, w - 5 * mm, h - 5 * mm, 2 * mm, stroke=1, fill=0)
    c.setStrokeAlpha(0.45)
    c.setLineWidth(0.25 * mm)
    c.roundRect(x + 3.75 * mm, y + 3.75 * mm, w - 7.5 * mm, h - 7.5 * mm, 1.25 * mm, stroke=1, fill=0)
    c.setStrokeAlpha(1)

    cx, cy = x + w / 2, y + h / 2
    x, y = cx - CARD_W / 2, cy - CARD_H / 2
    c.setFillColor(NAVY)
    c.setLineWidth(0.5 * mm)
    c.circle(cx, cy, 16 * mm, stroke=1, fill=1)
    if corners:
        # A compass rose, which looks the same whichever way up the card lies, so the
        # back gives no hint of where the corner order starts.
        pts = []
        for i in range(16):
            a = math.pi / 2 + i * math.pi / 8
            r = (10.5 if i % 4 == 0 else 6.5 if i % 2 == 0 else 2.2) * mm
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
        path = c.beginPath()
        path.moveTo(*pts[0])
        for q in pts[1:]:
            path.lineTo(*q)
        path.close()
        c.setLineWidth(0.4 * mm)
        c.setLineJoin(1)
        c.drawPath(path, stroke=1, fill=0)
        c.circle(cx, cy, 1.1 * mm, stroke=1, fill=0)
    else:
        # The magnifying glass.
        k = 16 * mm / 24
        c.setLineWidth(1.3 * k)
        c.setLineCap(1)
        c.circle(cx + (10 - 12) * k, cy - (10 - 12) * k, 6 * k, stroke=1, fill=0)
        c.line(cx + 2.5 * k, cy - 2.5 * k, cx + 8.5 * k, cy - 8.5 * k)
        c.setLineCap(0)

    left, right = x + MARKER_INSET, x + CARD_W - MARKER_INSET - MARKER
    top, bottom = y + CARD_H - MARKER_INSET, y + MARKER_INSET + MARKER
    if corners:
        # Corner layout: marks 1-4 placed by the card's order, read counterclockwise
        # from the top left, all facing the card's top.
        for (mx, my), n in zip([(left, top), (left, bottom), (right, bottom), (right, top)], corners):
            marker(c, mx, my, MARKER, MARKERS[CORNER_MARKS[int(n) - 1]])
        return
    # Single-code layout: the card's code top-left and bottom-right (turned, so the back
    # reads the same either way up); the decoy in the other two corners.
    marker(c, left, top, MARKER, MARKERS[code])
    marker(c, right, bottom, MARKER, MARKERS[code], upside_down=True)
    marker(c, right, top, MARKER, MARKERS[DECOY])
    marker(c, left, bottom, MARKER, MARKERS[DECOY], upside_down=True)


CATEGORY = [('Suspect', HexColor('#8B1C2D'))] * 6 + [('Weapon', HexColor('#2C5888'))] * 6 + [('Room', HexColor('#4B6A2C'))] * 9


def card_front(c, x, y, name, index):
    """A plain front: the card's type at both ends and its name in the middle."""
    kind, colour = CATEGORY[index]
    c.setStrokeColor(HexColor('#B8C0CC'))
    c.setLineWidth(0.3)
    c.roundRect(x, y, CARD_W, CARD_H, RADIUS, stroke=1, fill=0)
    c.setStrokeColor(colour)
    c.setLineWidth(0.6 * mm)
    c.roundRect(x + 3 * mm, y + 3 * mm, CARD_W - 6 * mm, CARD_H - 6 * mm, 2 * mm, stroke=1, fill=0)
    c.setFillColor(colour)
    c.setFont('Helvetica-Bold', 8)
    c.drawCentredString(x + CARD_W / 2, y + CARD_H - 10 * mm, kind.upper())
    c.saveState()
    c.translate(x + CARD_W / 2, y + 10 * mm)
    c.rotate(180)
    c.drawCentredString(0, -2.8, kind.upper())
    c.restoreState()
    c.setFillColor(INK)
    size = 17
    while c.stringWidth(name, 'Helvetica-Bold', size) > CARD_W - 14 * mm:
        size -= 1
    c.setFont('Helvetica-Bold', size)
    c.drawCentredString(x + CARD_W / 2, y + CARD_H / 2 - size * 0.35, name)


def heading(c, text, sub, top):
    c.setFillColor(INK)
    c.setFont('Helvetica-Bold', 20)
    c.drawString(18 * mm, top, text)
    c.setFillColor(MUTED)
    c.setFont('Helvetica', 10.5)
    c.drawString(18 * mm, top - 7 * mm, sub)


def lines(c, x, y, items, size=10.5, gap=5.6 * mm, numbered=False, width=170 * mm):
    """Simple wrapped text. Returns the y below the last line."""
    c.setFont('Helvetica', size)
    for i, text in enumerate(items):
        prefix = f'{i + 1}.  ' if numbered else ''
        words, line = text.split(), prefix
        indent = c.stringWidth(prefix, 'Helvetica', size)
        first = True
        for w in words:
            trial = (line + ' ' + w).strip() if line.strip() else line + w
            if c.stringWidth(trial, 'Helvetica', size) > width:
                c.drawString(x + (0 if first else indent), y, line)
                y -= gap * 0.82
                line, first = w, False
            else:
                line = trial
        c.drawString(x + (0 if first else indent), y, line)
        y -= gap
    return y


def page_one(c, pages, corner_layout=False):
    W, H = A4
    if corner_layout:
        heading(c, 'Card back test sheet: corner marks', 'Cluedo Robot Players: 21 card backs, each with the same four corner marks in its own order.', H - 24 * mm)
    else:
        heading(c, 'Card back test sheet', 'Cluedo Robot Players: 21 card backs with corner markers, and a marker size test.', H - 24 * mm)
    c.setFillColor(INK)
    c.setFont('Helvetica-Bold', 12)
    c.drawString(18 * mm, H - 46 * mm, 'Printing')
    c.setFillColor(INK)
    y = lines(c, 18 * mm, H - 54 * mm, [
        ('Print pages 2 to 4' if corner_layout else 'Print pages 2 to 5') + ' at actual size: 100%, with "fit to page" turned off.',
        'Check the bar at the bottom of this page measures exactly 100 mm. If it doesn’t, the cards are the wrong size.',
        'Laminate the sheets. Cut out the cards on pages 2 to 4 along their edges.',
        'Write each card’s name, printed under it, on its blank front.' + ('' if corner_layout else ' Keep page 5 in one piece.'),
    ], numbered=True)
    c.setFont('Helvetica-Bold', 12)
    c.drawString(18 * mm, y - 6 * mm, 'Taking the test photo')
    y = lines(c, 18 * mm, y - 14 * mm, [
        'Lay the cards face-down in rows: one row per player, and one for the envelope. Leave a finger’s width between cards and a wider gap between rows.',
        'Hold the phone about 40 cm above the cards, tilted a little away from straight down so the ceiling light’s reflection misses them. No flash.',
    ] + ([] if corner_layout else ['Photograph page 5 as well. The app will say which marker sizes and shades it could read.']), numbered=True)
    c.setFont('Helvetica-Bold', 12)
    c.drawString(18 * mm, y - 6 * mm, 'Where each card is')
    y -= 14 * mm
    c.setFont('Helvetica', 10.5)
    for n, names in pages:
        rows = [names[i:i + 3] for i in range(0, len(names), 3)]
        c.setFillColor(INK)
        c.drawString(18 * mm, y, f'Page {n}')
        c.setFillColor(MUTED)
        for r, row in enumerate(rows):
            c.drawString(40 * mm, y - r * 5 * mm, '   ·   '.join(row))
        y -= max(1, len(rows)) * 5 * mm + 3 * mm
    c.setFillColor(MUTED)
    lines(c, 18 * mm, y - 4 * mm, [
        ('Every card carries the same four 8 mm marks, standing for 1 to 4, one in each corner. Which corner holds which number tells the cards apart. The marks all face the card’s top, so the reader knows where to start.'
         if corner_layout else 'Each card carries its code in two corners, 8 mm across: top left, and bottom right turned upside down. The other two corners hold a decoy that is the same on every card.'),
    ], size=9.5)

    # The 100 mm check.
    x0, yb = 18 * mm, 22 * mm
    c.setStrokeColor(INK)
    c.setLineWidth(0.6)
    c.line(x0, yb, x0 + 100 * mm, yb)
    c.setFont('Helvetica', 7.5)
    c.setFillColor(INK)
    for i in range(11):
        h = 3 * mm if i % 5 == 0 else 1.8 * mm
        c.line(x0 + i * 10 * mm, yb, x0 + i * 10 * mm, yb + h)
        if i % 5 == 0:
            c.drawCentredString(x0 + i * 10 * mm, yb + 4.2 * mm, f'{i * 10}')
    c.setFont('Helvetica', 9)
    c.drawString(x0 + 104 * mm, yb - 1, 'This bar should measure 100 mm.')


def card_pages(c, names, corner_layout=False, fronts=False):
    """A page of card backs, or with `fronts` the page to print on its other side:
    the same cards with columns swapped, because turning the sheet over on its long
    edge swaps left and right."""
    W, H = A4
    gap_x, gap_y = 3 * mm, 6 * mm
    left = (W - (3 * CARD_W + 2 * gap_x)) / 2
    top = H - (H - (3 * CARD_H + 2 * gap_y)) / 2
    order = list(CARD_MARKERS)
    for i, name in enumerate(names):
        r, col = divmod(i, 3)
        if fronts:
            col = 2 - col
            x = left + col * (CARD_W + gap_x)
            y = top - (r + 1) * CARD_H - r * gap_y
            card_front(c, x, y, name, order.index(name))
            continue
        x = left + col * (CARD_W + gap_x)
        y = top - (r + 1) * CARD_H - r * gap_y
        card_back(c, x, y, CARD_MARKERS[name], CARD_CORNERS[name] if corner_layout else None)
        c.setFillColor(MUTED)
        c.setFont('Helvetica', 7)
        c.drawCentredString(x + CARD_W / 2, y - 3.8 * mm, name)


def size_page(c):
    W, H = A4
    heading(c, 'Marker size test', 'Keep this page whole. Each square holds a different marker; the app reports which ones it can read.', H - 24 * mm)
    sizes = [6, 8, 10, 12]
    shades = [1.0, 0.75, 0.5]
    cell_w, cell_h = 40 * mm, 46 * mm
    left = (W - 4 * cell_w - 3 * 4 * mm) / 2
    top = H - 48 * mm
    code = 22
    for r, shade in enumerate(shades):
        for col, s in enumerate(sizes):
            x = left + col * (cell_w + 4 * mm)
            y = top - (r + 1) * cell_h - r * 6 * mm
            path = c.beginPath()
            path.roundRect(x, y + 6 * mm, cell_w, cell_h - 6 * mm, 2.5 * mm)
            c.saveState()
            c.clipPath(path, stroke=0, fill=0)
            c.setFillColor(NAVY)
            c.rect(x, y + 6 * mm, cell_w, cell_h - 6 * mm, stroke=0, fill=1)
            lattice(c, x, y + 6 * mm, cell_w, cell_h - 6 * mm)
            c.restoreState()
            size = s * mm
            marker(c, x + (cell_w - size) / 2, y + 6 * mm + (cell_h - 6 * mm + size) / 2, size, MARKERS[code], shade)
            c.setFillColor(INK)
            c.setFont('Helvetica', 8.5)
            c.drawCentredString(x + cell_w / 2, y + 1.6 * mm, f'{s} mm  ·  {round(shade * 100)}% strength')
            code += 1


def build(out, corner_layout):
    order = list(CARD_MARKERS)
    pages = [(n + 2, order[i:i + 9]) for n, i in enumerate(range(0, len(order), 9))]
    c = canvas.Canvas(str(out), pagesize=A4)
    c.setTitle('Card back test sheet' + (': corner marks' if corner_layout else ''))
    c.setAuthor('Cluedo Robot Players')
    page_one(c, pages, corner_layout)
    c.showPage()
    for _, names in pages:
        card_pages(c, names, corner_layout)
        c.showPage()
    if not corner_layout:
        size_page(c)
        c.showPage()
    c.save()
    print('wrote', out)


def build_double_sided(out):
    """Just the card pages, each followed by its fronts, for printing double-sided."""
    order = list(CARD_MARKERS)
    c = canvas.Canvas(str(out), pagesize=A4)
    c.setTitle('Card back test sheet: corner marks, double-sided')
    c.setAuthor('Cluedo Robot Players')
    for i in range(0, len(order), 9):
        names = order[i:i + 9]
        card_pages(c, names, True)
        c.showPage()
        card_pages(c, names, True, fronts=True)
        c.showPage()
    c.save()
    print('wrote', out)


if __name__ == '__main__':
    build(ROOT / 'print' / 'card-back-test-sheet.pdf', False)
    build(ROOT / 'print' / 'card-back-test-sheet-corners.pdf', True)
    build_double_sided(ROOT / 'print' / 'card-back-test-sheet-corners-double-sided.pdf')
