#!/usr/bin/env python3
"""
EA Migrate Pro logo generator.

Reconstructs the bull-head emblem (two symmetric horns + shield face) as a
transparent background asset in brand green #2E5A0B:

  public/logo.png      1024px master, transparent
  public/favicon.png    512px, transparent
  public/logo.svg       true vector, transparent

White is never drawn — the canvas is alpha-zero and only the mark is painted,
so there is no white background to remove.
"""

import math
import os

from PIL import Image, ImageDraw

GREEN = (46, 90, 11, 255)  # #2E5A0B

S = 4  # supersample factor for smooth antialiased edges
INNER = 1024.0  # coordinate space of the mark itself
MARGIN = 40.0  # breathing room inside the final canvas
SIZE = int(INNER + MARGIN * 2)  # 1104 logical units


def mirror(points):
    """Mirror a polyline around the vertical center of the mark."""
    return [(INNER - x, y) for (x, y) in points]


def draw_half(draw, pts):
    """Draw one horn/face half as a filled polygon."""
    draw.polygon([(MARGIN + x * S / 4, MARGIN + y * S / 4) for x, y in pts], fill=GREEN)


def horn_left():
    """Left half: horn arc, central head stem, cheek hook, jaw spike."""
    return [
        (168.0, 270.0),   # horn tip (upper left)
        (300.0, 372.0),   # upper edge sweeping to the crown
        (420.0, 408.0),   # rising into the crown
        (505.0, 428.0),   # crown apex (center of the head)
        (509.0, 520.0),   # central stem, slight taper
        (517.0, 636.0),   # neck
        (527.0, 756.0),   # mid face, gentle flare
        (531.0, 848.0),   # approaching snout tip
        (502.0, 872.0),   # snout bottom right
        (462.0, 852.0),   # snout bottom left
        (450.0, 758.0),   # face left edge going up
        (444.0, 640.0),   # narrow waist
        (438.0, 552.0),   # upper cheek
        (400.0, 558.0),   # cheek underside step
        (336.0, 648.0),   # descending toward the hook tip
        (302.0, 692.0),   # hook tip (points down-left)
        (346.0, 596.0),   # inner hook return
        (372.0, 548.0),   # inner cheek
        (384.0, 662.0),   # jaw block descending right
        (352.0, 742.0),   # jaw spike tip
        (408.0, 596.0),   # back up the inner edge
        (424.0, 508.0),   # inner horn underside
        (428.0, 452.0),   # inner horn top
        (322.0, 424.0),   # under the horn arc
        (206.0, 352.0),   # closing the horn arc
    ]


def main():
    canvas = Image.new("RGBA", (SIZE * S // 4 * 4, SIZE * S // 4 * 4), (0, 0, 0, 0))
    # Work at S* logical resolution for crisp edges, then downsample.
    big = Image.new("RGBA", (int(SIZE * S), int(SIZE * S)), (0, 0, 0, 0))
    draw = ImageDraw.Draw(big)

    scale = S  # logical unit -> device pixel
    left = horn_left()
    right = mirror(left)

    def poly(points):
        draw.polygon([(int((MARGIN + x) * scale), int((MARGIN + y) * scale)) for x, y in points], fill=GREEN)

    poly(left)
    poly(right)

    # Antialiased masters
    master = big.resize((SIZE, SIZE), Image.LANCZOS)  # 1104
    logo = master.resize((1024, 1024), Image.LANCZOS)
    favicon = master.resize((512, 512), Image.LANCZOS)

    os.makedirs("public", exist_ok=True)
    logo.save("public/logo.png")
    favicon.save("public/favicon.png")

    # True vector SVG (same coordinates as the raster, exact brand green).
    def path_of(points):
        d = f"M {MARGIN + points[0][0]:.0f} {MARGIN + points[0][1]:.0f} "
        d += " ".join(f"L {MARGIN + x:.0f} {MARGIN + y:.0f}" for x, y in points[1:])
        return d + " Z"

    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1104 1104">'
        f'<path fill="#2E5A0B" d="{path_of(left)}"/>'
        f'<path fill="#2E5A0B" d="{path_of(right)}"/>'
        "</svg>\n"
    )
    with open("public/logo.svg", "w") as fh:
        fh.write(svg)

    # Transparency audit: every fully-white-adjacent pixel must be alpha 0.
    px = logo.load()
    opaque = sum(1 for y in range(0, 1024, 8) for x in range(0, 1024, 8) if px[x, y][3] > 250)
    transparent = sum(1 for y in range(0, 1024, 8) for x in range(0, 1024, 8) if px[x, y][3] == 0)
    corners = [px[0, 0], px[1023, 0], px[0, 1023], px[1023, 1023]]
    print(f"opaque sample px: {opaque}, transparent sample px: {transparent}")
    print("corners alpha (must all be 0):", [c[3] for c in corners])
    assert all(c[3] == 0 for c in corners), "background is not transparent!"
    print("OK — public/logo.png, public/favicon.png, public/logo.svg written (transparent)")


if __name__ == "__main__":
    main()
