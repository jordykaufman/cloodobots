"""Makes print files for a deck from MakePlayingCards in their US game size (2.2 x 3.43
in, the size of real Clue cards): one image per card front and per card back, at 600
dpi with 0.12 in of bleed past the cut line on every side, and anything important kept
inside their safe area, 0.1 in inside the cut (their template: 732 x 1101 px at 300
dpi, so 1464 x 2202 here).

    python3 tools/print_cards.py OUT_DIR [FRONTS_DIR ...]

Each FRONTS_DIR holds card fronts already trimmed to card shape, named after the cards
(scarlet.png, lead_pipe.jpg, dining_room.png). Without any, only the backs are made.
Writes OUT_DIR/fronts/NN-name.jpg, OUT_DIR/backs/NN-name.png and OUT_DIR/proof.png.
"""
import pathlib, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageStat
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from test_sheet import CARD_MARKERS, BEZEL_CODES, US_GAME, card_back  # noqa: E402

DPI = 600
TRIM_W, TRIM_H = US_GAME['w'], US_GAME['h']
BLEED, SAFE = 0.12 * inch, 0.1 * inch
PX_BLEED, PX_SAFE = round(BLEED / inch * DPI), round(SAFE / inch * DPI)   # 72, 60
PX_W, PX_H = round(TRIM_W / inch * DPI), round(TRIM_H / inch * DPI)       # 1320 x 2058, the card itself
FULL = (PX_W + 2 * PX_BLEED, PX_H + 2 * PX_BLEED)                       # 1464 x 2202, with the bleed
# The fronts were trimmed close for the screen; this much border is added back on
# every side (as a share of the card's size) so nothing important is near the cut.
MARGIN = 0.04


def stem(i, name):
    return f'{i + 1:02d}-{name.lower().replace(" ", "_")}'


def backs(out):
    """Every back as one page of a PDF the size of the card plus bleed, then 600 dpi PNGs."""
    names = list(CARD_MARKERS)
    with tempfile.TemporaryDirectory() as tmp:
        pdf = pathlib.Path(tmp) / 'backs.pdf'
        c = canvas.Canvas(str(pdf), pagesize=(TRIM_W + 2 * BLEED, TRIM_H + 2 * BLEED))
        for name in names:
            card_back(c, BLEED, BLEED, CARD_MARKERS[name], BEZEL_CODES[name], w=TRIM_W, h=TRIM_H, bleed=BLEED,
                      inset=US_GAME['inset'], frame=US_GAME['frame'])
            c.showPage()
        c.save()
        subprocess.run(['pdftoppm', '-r', str(DPI), '-png', str(pdf), str(pathlib.Path(tmp) / 'b')], check=True)
        pages = sorted(pathlib.Path(tmp).glob('b-*.png'))
        assert len(pages) == len(names)
        for i, (name, page) in enumerate(zip(names, pages)):
            im = Image.open(page).convert('RGB')
            assert im.size == FULL, im.size
            im.save(out / f'{stem(i, name)}.png', dpi=(DPI, DPI))


def plain_colour(band, line):
    """The colour of a plain border along one edge, or None if the edge isn't plain.
    `line` is the outermost row or column and decides whether it's plain. The colour
    comes from `band`, a strip a few pixels deep, because the outermost pixels are
    often a shade off, but only from its pixels close to the edge's colour, so a line
    of the design running near the edge doesn't tint it."""
    if max(ImageStat.Stat(line).stddev) >= 14:
        return None
    edge = ImageStat.Stat(line).median
    px = [q for q in (band.get_flattened_data() if hasattr(band, 'get_flattened_data') else band.getdata())
          if sum(abs(a - b) for a, b in zip(q, edge)) < 40]
    if len(px) < 10:
        return tuple(round(v) for v in edge)
    return tuple(sorted(q[i] for q in px)[len(px) // 2] for i in range(3))


def extend(card, mx, my, depth=16, soften=0):
    """The card with mx pixels added left and right and my above and below: a plain
    border is continued in its own colour, and anything busier has its edge pixels
    stretched. With `soften`, that many pixels of the card next to a plain border are
    faded into the border colour so no join shows."""
    w, h = card.size
    W, H = w + 2 * mx, h + 2 * my
    full = Image.new('RGB', (W, H))
    full.paste(card, (mx, my))
    sides = [  # band, outermost line, where the margin goes, its size
        ((0, 0, depth, h), (0, 0, 1, h), (0, my), (mx, h)),
        ((w - depth, 0, w, h), (w - 1, 0, w, h), (w + mx, my), (mx, h)),
    ]
    for band, line, at, size in sides:
        colour = plain_colour(card.crop(band), card.crop(line))
        fill = Image.new('RGB', size, colour) if colour else card.crop(line).resize(size)
        full.paste(fill, at)
        if colour and soften:
            x = at[0] + (mx if at[0] == 0 else -soften)
            ramp = Image.linear_gradient('L').rotate(90 if at[0] == 0 else -90).resize((soften, h))
            full.paste(Image.new('RGB', (soften, h), colour), (x, my), Image.eval(ramp, lambda v: 255 - v))
    wide = full.crop((0, my, W, my + h))
    sides = [
        ((mx, 0, W - mx, depth), (0, 0, W, 1), (0, 0), (W, my)),
        ((mx, h - depth, W - mx, h), (0, h - 1, W, h), (0, h + my), (W, my)),
    ]
    for band, line, at, size in sides:
        colour = plain_colour(wide.crop(band), wide.crop(line))
        fill = Image.new('RGB', size, colour) if colour else wide.crop(line).resize(size)
        full.paste(fill, at)
        if colour and soften:
            y = my if at[1] == 0 else h + my - soften
            ramp = Image.linear_gradient('L').resize((W, soften))
            if at[1] != 0:
                ramp = ramp.transpose(Image.FLIP_TOP_BOTTOM)
            full.paste(Image.new('RGB', (W, soften), colour), (0, y), Image.eval(ramp, lambda v: 255 - v))
    return full


def with_bleed(card):
    """The card at print size, shrunk a little inside a border of its own edge colour,
    so names and headings keep clear of the cut, and with that border run out past
    the cut line into the bleed."""
    card = card.convert('RGB')
    card = extend(card, round(MARGIN * card.width), round(MARGIN * card.height), soften=10)
    card = card.resize((PX_W, PX_H), Image.LANCZOS)
    return extend(card, PX_BLEED, PX_BLEED)


def fronts(out, dirs):
    missing = []
    for i, name in enumerate(CARD_MARKERS):
        key = name.lower().replace(' ', '_')
        found = [p for d in dirs for p in pathlib.Path(d).iterdir() if p.stem.lower() == key and p.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp')]
        if not found:
            missing.append(name)
            continue
        card = Image.open(found[0])
        ratio = card.width / card.height
        if abs(ratio / (PX_W / PX_H) - 1) > 0.02:
            print(f'warning: {found[0].name} is {card.width} x {card.height}, not card-shaped; it will be squashed to fit')
        with_bleed(card).save(out / f'{stem(i, name)}.jpg', quality=95, subsampling=0, dpi=(DPI, DPI))
    return missing


def proof(out):
    """Every card small, fronts above backs, with the cut line (solid) and the edge of
    the safe area (dashed) drawn on, to check nothing important is near the edge."""
    names = list(CARD_MARKERS)
    groups = [names[0:6], names[6:12], names[12:21]]
    tw = 190
    th = round(tw * FULL[1] / FULL[0])
    k = tw / FULL[0]
    gap = 14
    sheet = Image.new('RGB', (9 * (tw + gap) + gap, sum(2 * (th + gap) + 30 for _ in groups) + gap), (232, 236, 240))
    d = ImageDraw.Draw(sheet)
    y = gap
    for group in groups:
        for side, folder, ext in ((0, 'fronts', 'jpg'), (1, 'backs', 'png')):
            for j, name in enumerate(group):
                i = names.index(name)
                p = out / folder / f'{stem(i, name)}.{ext}'
                x = gap + j * (tw + gap)
                if not p.exists():
                    d.rectangle([x, y, x + tw, y + th], outline=(150, 150, 150))
                    continue
                sheet.paste(Image.open(p).resize((tw, th), Image.LANCZOS), (x, y))
                cut = [x + PX_BLEED * k, y + PX_BLEED * k, x + (FULL[0] - PX_BLEED) * k, y + (FULL[1] - PX_BLEED) * k]
                d.rounded_rectangle(cut, radius=round(0.125 * DPI * k), outline=(230, 40, 60), width=1)
                s = (PX_BLEED + PX_SAFE) * k
                for yy in range(int(y + s), int(y + th - s), 6):
                    d.line([x + s, yy, x + s, yy + 3], fill=(40, 200, 255)); d.line([x + tw - s, yy, x + tw - s, yy + 3], fill=(40, 200, 255))
                for xx in range(int(x + s), int(x + tw - s), 6):
                    d.line([xx, y + s, xx + 3, y + s], fill=(40, 200, 255)); d.line([xx, y + th - s, xx + 3, y + th - s], fill=(40, 200, 255))
            y += th + gap
        y += 30
    sheet.save(out / 'proof.png')


if __name__ == '__main__':
    out = pathlib.Path(sys.argv[1])
    (out / 'backs').mkdir(parents=True, exist_ok=True)
    backs(out / 'backs')
    missing = []
    if len(sys.argv) > 2:
        (out / 'fronts').mkdir(exist_ok=True)
        missing = fronts(out / 'fronts', sys.argv[2:])
    proof(out)
    print(f'wrote {len(CARD_MARKERS)} backs' + (f' and {len(CARD_MARKERS) - len(missing)} fronts' if len(sys.argv) > 2 else '') + f' to {out}')
    if missing:
        print('no front found for: ' + ', '.join(missing))
