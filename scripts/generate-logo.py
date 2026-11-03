#!/usr/bin/env python3
"""Regenerate every TARGET logo / icon file from one source: the tree silhouette in
scripts/assets/tree-mark.png (alpha = the tree, colour ignored).

Brand: stucco tree (#eeede4) on teal-black (#0b1414). Larger logos add "Vikash" in Great Vibes
(the site's font-script) in gold (#e6c487) under the roots, as in the approved design.
  - Small icons (favicon, app icons, apple icon, header/offline badge): tree only.
  - public/logo-512.png, public/logo-120.png, public/logo.svg: tree + "Vikash".
At small sizes the branches are thickened slightly (dilated before downscaling) so the tree
stays legible.

Run from the repo root:  python3 scripts/generate-logo.py
Needs: Pillow, numpy, fontTools, potracer  (pip install pillow numpy fonttools potracer)
"""
from io import BytesIO

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

TREE_SRC = "scripts/assets/tree-mark.png"
FONT = "scripts/assets/GreatVibes-Regular.ttf"  # SIL OFL, see scripts/assets/GreatVibes-OFL.txt
BG = (11, 20, 20, 255)        # #0b1414
STUCCO = (238, 237, 228, 255)  # #eeede4
GOLD = (230, 196, 135, 255)    # #e6c487
HEX = {"bg": "#0b1414", "stucco": "#eeede4", "gold": "#e6c487"}
SS = 8  # supersampling factor for raster output

# Approved design, in a 1024 box: tree ink 128..719 tall, centred; "Vikash" ink 419 wide, top at 741.
DESIGN = dict(tree_top=128 / 1024, tree_h=591 / 1024, text_w=419 / 1024, text_top=741 / 1024)


def load_tree():
    a = Image.open(TREE_SRC).convert("RGBA").getchannel("A")
    return a.crop(a.point(lambda v: 255 if v >= 128 else 0).getbbox())


TREE = load_tree()


def tree_alpha(height_px, grow=0.0):
    """Tree alpha scaled to `height_px` (supersampled px). `grow` thickens strokes by that many
    *final* pixels on each side (dilation in source pixels before downscaling)."""
    src = TREE
    if grow > 0:
        r = round(grow * src.height / (height_px / SS))
        if r > 0:
            src = src.filter(ImageFilter.MaxFilter(2 * r + 1))
    w = round(height_px * src.width / src.height)
    return src.resize((w, round(height_px)), Image.LANCZOS)


def canvas(size, shape):
    n = size * SS
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if shape == "square":
        d.rectangle([0, 0, n - 1, n - 1], fill=BG)
    elif shape == "rounded":
        d.rounded_rectangle([0, 0, n - 1, n - 1], radius=0.2 * n, fill=BG)
    return im


def icon(size, *, frac=0.84, grow=0.0, shape="rounded", colour=STUCCO):
    """Tree only, centred. `frac` = tree height as a share of the canvas."""
    im = canvas(size, shape)
    n = size * SS
    a = tree_alpha(frac * n, grow)
    im.paste(Image.new("RGBA", a.size, colour), ((n - a.width) // 2, (n - a.height) // 2), a)
    return im.resize((size, size), Image.LANCZOS)


# ---------------------------------------------------------------- "Vikash" text layout
def text_layout(box):
    """Font size, origin x and baseline y (in a `box`-px square) so the ink of "Vikash" matches
    the approved design. Advances only (no kerning), identical for the SVG and the PNGs."""
    from fontTools.pens.boundsPen import BoundsPen
    from fontTools.ttLib import TTFont

    f = TTFont(FONT)
    upm = f["head"].unitsPerEm
    cmap, gs, hmtx = f.getBestCmap(), f.getGlyphSet(), f["hmtx"]
    glyphs, x, inks = [], 0, []
    for ch in "Vikash":
        g = cmap[ord(ch)]
        bp = BoundsPen(gs)
        gs[g].draw(bp)
        if bp.bounds:
            x0, y0, x1, y1 = bp.bounds
            inks.append((x + x0, y0, x + x1, y1))
        glyphs.append((g, x))
        x += hmtx[g][0]
    ix0 = min(b[0] for b in inks); ix1 = max(b[2] for b in inks)
    iy1 = max(b[3] for b in inks)  # top of ink (font units, y up)
    scale = DESIGN["text_w"] * box / (ix1 - ix0)
    ox = (box - (ix1 - ix0) * scale) / 2 - ix0 * scale
    baseline = DESIGN["text_top"] * box + iy1 * scale
    return dict(font=f, gs=gs, glyphs=glyphs, scale=scale, ox=ox, baseline=baseline, px=upm * scale)


def logo(size):
    """Tree + "Vikash" on the square background (approved design)."""
    im = canvas(size, "square")
    n = size * SS
    a = tree_alpha(DESIGN["tree_h"] * n, grow=0.04 if size < 200 else 0.0)
    im.paste(Image.new("RGBA", a.size, STUCCO), ((n - a.width) // 2, round(DESIGN["tree_top"] * n)), a)
    L = text_layout(n)
    font = ImageFont.truetype(FONT, round(L["px"]), layout_engine=ImageFont.Layout.BASIC)
    ImageDraw.Draw(im).text((L["ox"], L["baseline"]), "Vikash", font=font, fill=GOLD, anchor="ls")
    return im.resize((size, size), Image.LANCZOS)


# ---------------------------------------------------------------- vectors
def tree_path():
    """Potrace the tree (bitmap px units, viewBox = TREE.size)."""
    import potrace

    mask = np.array(TREE) >= 128
    # potracer's Bitmap traces the zero pixels, so hand it the inverted mask.
    curves = potrace.Bitmap(~mask).trace(turdsize=4, alphamax=1.0, opticurve=True, opttolerance=0.2)
    out = []
    for c in curves:
        s = c.start_point
        d = [f"M{s.x:.1f} {s.y:.1f}"]
        for g in c.segments:
            if g.is_corner:
                d.append(f"L{g.c.x:.1f} {g.c.y:.1f}L{g.end_point.x:.1f} {g.end_point.y:.1f}")
            else:
                d.append(f"C{g.c1.x:.1f} {g.c1.y:.1f} {g.c2.x:.1f} {g.c2.y:.1f} {g.end_point.x:.1f} {g.end_point.y:.1f}")
        out.append("".join(d) + "Z")
    return "".join(out)


def text_path(box):
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen

    L = text_layout(box)
    s = L["scale"]
    out = []
    for g, x in L["glyphs"]:
        pen = SVGPathPen(L["gs"], ntos=lambda v: f"{v:.1f}")
        L["gs"][g].draw(TransformPen(pen, (s, 0, 0, -s, L["ox"] + x * s, L["baseline"])))
        out.append(pen.getCommands())
    return "".join(out)


def mark_svg(d, *, stroke):
    """Tree-only SVG: rounded square + tree. `stroke` (tree px) thickens it for tab/badge sizes."""
    w, h = TREE.size
    box = round(h / 0.84)
    tx, ty = (box - w) / 2, (box - h) / 2
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {box} {box}" role="img" aria-label="TARGET">'
        f'<rect width="{box}" height="{box}" rx="{0.2 * box:.0f}" fill="{HEX["bg"]}"/>'
        f'<path transform="translate({tx:.1f} {ty:.1f})" fill="{HEX["stucco"]}" stroke="{HEX["stucco"]}" '
        f'stroke-width="{stroke}" stroke-linejoin="round" fill-rule="evenodd" d="{d}"/></svg>\n'
    )


def logo_svg(d):
    """Tree + "Vikash" on a square, 1024 box (same layout as logo-512.png)."""
    box = 1024
    w, h = TREE.size
    k = DESIGN["tree_h"] * box / h
    tx = (box - w * k) / 2
    ty = DESIGN["tree_top"] * box
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {box} {box}" role="img" aria-label="TARGET">'
        f'<rect width="{box}" height="{box}" fill="{HEX["bg"]}"/>'
        f'<path transform="translate({tx:.1f} {ty:.1f}) scale({k:.5f})" fill="{HEX["stucco"]}" fill-rule="evenodd" d="{d}"/>'
        f'<path fill="{HEX["gold"]}" d="{text_path(box)}"/></svg>\n'
    )


def save_png(im, path):
    im.save(path, optimize=True)


if __name__ == "__main__":
    d = tree_path()
    mark = mark_svg(d, stroke=5)
    open("src/app/icon.svg", "w").write(mark)       # browser tab icon (scalable)
    open("public/logo-mark.svg", "w").write(mark)   # share header badge, offline page, manifest
    open("public/logo.svg", "w").write(logo_svg(d))  # full logo with "Vikash"

    save_png(logo(512), "public/logo-512.png")
    save_png(logo(120), "public/logo-120.png")
    save_png(icon(192, frac=0.80, grow=0.04), "public/app-icon-192.png")
    # Maskable: full-bleed square, tree's bounding box inside the 80% safe circle (needs <= ~63% tall).
    save_png(icon(512, frac=0.62, shape="square"), "public/app-icon-maskable-512.png")
    # Apple touch icon: opaque full-bleed square (iOS rounds the corners itself).
    icon(180, frac=0.78, grow=0.04, shape="square").convert("RGB").save("src/app/apple-icon.png", optimize=True)
    # Push notification badge: Android uses only the alpha, so a white tree on transparent.
    save_png(icon(96, frac=0.92, grow=0.08, shape="none", colour=(255, 255, 255, 255)), "public/app-badge-96.png")

    # favicon.ico with a hand-tuned image per size (thicker strokes at 16/32).
    ico = {16: icon(16, frac=0.88, grow=0.15), 32: icon(32, frac=0.88, grow=0.10),
           48: icon(48, frac=0.86, grow=0.06), 256: icon(256, frac=0.84)}
    ico[256].save("src/app/favicon.ico", sizes=[(s, s) for s in ico], append_images=[ico[s] for s in (16, 32, 48)])
