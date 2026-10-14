"""Download Magnific renders and turn them into trimmed game sprites.

Usage: python -I tools/sprites.py manifest.json raw_dir out_dir
manifest.json: {"sprite_name": "https://...render.png", ...}
Images with real alpha keep it; images on a white background get the
background removed by flood-filling from the borders.
"""
import json
import sys
import urllib.request
from collections import deque
from pathlib import Path

from PIL import Image

MAX_SIDE = {"p_": 256, "e_": 256, "w_": 192, "d_": 96}


def has_alpha_bg(im):
    if im.mode != "RGBA":
        return False
    w, h = im.size
    a = im.getchannel("A")
    return all(a.getpixel(p) < 10 for p in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)])


def remove_white(im, tol=38):
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        q.append((x, 0)); q.append((x, h - 1))
    for y in range(h):
        q.append((0, y)); q.append((w - 1, y))

    def bg(c):
        return c[0] > 255 - tol and c[1] > 255 - tol and c[2] > 255 - tol

    while q:
        x, y = q.popleft()
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        if not bg(px[x, y]):
            continue
        px[x, y] = (255, 255, 255, 0)
        if x > 0: q.append((x - 1, y))
        if x < w - 1: q.append((x + 1, y))
        if y > 0: q.append((x, y - 1))
        if y < h - 1: q.append((x, y + 1))
    # soften the near-white fringe next to removed pixels
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            r, g, b, a = px[x, y]
            if a and min(r, g, b) > 200:
                if any(px[nx, ny][3] == 0 for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))):
                    px[x, y] = (r, g, b, 90)
    return im


def main(manifest, raw_dir, out_dir):
    raw_dir, out_dir = Path(raw_dir), Path(out_dir)
    raw_dir.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, url in json.loads(Path(manifest).read_text()).items():
        raw = raw_dir / f"{name}.png"
        if not raw.exists():
            urllib.request.urlretrieve(url, raw)
        im = Image.open(raw)
        im = im.convert("RGBA") if has_alpha_bg(im) else remove_white(im.convert("RGB"))
        a = im.getchannel("A").point(lambda v: 255 if v > 24 else 0)
        bbox = a.getbbox()
        if bbox:
            im = im.crop(bbox)
        side = MAX_SIDE.get(name[:2], 256)
        im.thumbnail((side, side), Image.LANCZOS)
        im.save(out_dir / f"{name}.png", optimize=True)
        print(name, im.size)


if __name__ == "__main__":
    main(*sys.argv[1:4])
