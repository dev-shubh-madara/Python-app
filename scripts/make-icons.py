"""Generates the Android launcher icons (dark navy + neon cyan triangle) into resources/android/res."""
import os
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), "..", "resources", "android", "res")
BG = (11, 16, 32, 255)
CYAN = (34, 211, 238, 255)
PURPLE = (167, 139, 250, 255)

def draw_mark(size, scale=1.0):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    s = size * scale
    cx, cy = size / 2, size / 2 + s * 0.03
    def tri(r):
        return [(cx, cy - r), (cx + r * 0.866, cy + r * 0.5), (cx - r * 0.866, cy + r * 0.5)]
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.polygon(tri(s * 0.36), outline=CYAN, width=max(2, int(s * 0.07)))
    glow = glow.filter(ImageFilter.GaussianBlur(s * 0.04))
    img.alpha_composite(glow)
    d = ImageDraw.Draw(img)
    d.polygon(tri(s * 0.36), outline=CYAN, width=max(2, int(s * 0.055)))
    d.polygon(tri(s * 0.16), outline=PURPLE, width=max(1, int(s * 0.04)))
    return img

def full_icon(size, round_=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    if round_:
        md.ellipse([0, 0, size - 1, size - 1], fill=255)
    else:
        md.rounded_rectangle([0, 0, size - 1, size - 1], radius=size * 0.22, fill=255)
    bg = Image.new("RGBA", (size, size), BG)
    img.paste(bg, (0, 0), mask)
    img.alpha_composite(draw_mark(size, 0.9))
    return img

DENS = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
for name, px in DENS.items():
    d = os.path.join(OUT, f"mipmap-{name}")
    os.makedirs(d, exist_ok=True)
    full_icon(px).save(os.path.join(d, "ic_launcher.png"))
    full_icon(px, round_=True).save(os.path.join(d, "ic_launcher_round.png"))
    fg = int(px * 108 / 48)  # adaptive icon foreground is 108dp; content in the middle 72dp
    draw_mark(fg, 0.62).save(os.path.join(d, "ic_launcher_foreground.png"))

vals = os.path.join(OUT, "values")
os.makedirs(vals, exist_ok=True)
with open(os.path.join(vals, "ic_launcher_background.xml"), "w") as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0B1020</color>\n</resources>\n')
full_icon(512).save(os.path.join(OUT, "..", "..", "icon-512.png"))
print("icons written")
