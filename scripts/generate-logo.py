#!/usr/bin/env python3
"""Regenerate TARGET's logo files from one geometry: a solid black circle with a centred white
equilateral triangle pointing up (same proportions as src/app/favicon.ico).
Run from the repo root: python3 scripts/generate-logo.py  (needs Pillow)."""
from PIL import Image, ImageDraw

# Geometry in a 256-unit box (measured from favicon.ico: triangle x 65..191, apex y 63.5).
APEX_Y, HALF_W = 63.5, 63.0
BASE_Y = APEX_Y + HALF_W * 2 * 3 ** 0.5 / 2  # equilateral
TRI = [(128.0, APEX_Y), (128.0 + HALF_W, BASE_Y), (128.0 - HALF_W, BASE_Y)]

SVG = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="TARGET">
  <circle cx="128" cy="128" r="128" fill="#000"/>
  <polygon points="{' '.join(f'{x:.1f},{y:.1f}' for x, y in TRI)}" fill="#fff"/>
</svg>
"""

def mark(size, *, scale=1.0, bg=None, circle=True, ss=8):
    """Render the mark at `size` px. `scale` = mark diameter as a share of the canvas (padding for
    maskable icons); `bg` fills the whole square (full-bleed icons); `circle=False` skips the circle
    when bg is already black."""
    n = size * ss
    im = Image.new("RGBA", (n, n), bg or (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    dia = n * scale
    off = (n - dia) / 2
    k = dia / 256
    if circle:
        d.ellipse([off, off, off + dia - 1, off + dia - 1], fill=(0, 0, 0, 255))
    d.polygon([(off + x * k, off + y * k) for x, y in TRI], fill=(255, 255, 255, 255))
    return im.resize((size, size), Image.LANCZOS)

if __name__ == "__main__":
    open("public/logo.svg", "w").write(SVG)
    open("src/app/icon.svg", "w").write(SVG)
    mark(120).save("public/logo-120.png", optimize=True)
    mark(512).save("public/logo-512.png", optimize=True)
    mark(192).save("public/app-icon-192.png", optimize=True)
    # Maskable: full black square, mark inside the 80% safe zone.
    mark(512, scale=0.8, bg=(0, 0, 0, 255)).save("public/app-icon-maskable-512.png", optimize=True)
    # Apple touch icon: opaque (iOS fills transparency with black anyway), mark full-bleed.
    mark(180, bg=(0, 0, 0, 255)).convert("RGB").save("src/app/apple-icon.png", optimize=True)
    big = mark(256)
    big.save("src/app/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (256, 256)])
