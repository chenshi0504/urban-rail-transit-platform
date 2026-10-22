# -*- coding: utf-8 -*-
"""补齐 tfu_far.jpg 中下载失败留下的底色瓦片：用上一级瓦片放大填充。"""
import json
import math
import os
import time
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(BASE, "static", "data")
JPG = os.path.join(OUT_DIR, "tfu_far.jpg")
META = os.path.join(OUT_DIR, "tfu_far.json")
UA = "TransitFacilityAtlas/1.0 (local research tool)"


def fetch(z, tx, ty):
    from PIL import Image
    url = f"https://tile.openstreetmap.org/{z}/{tx}/{ty}.png"
    for host in (url, url.replace("tile.openstreetmap.org", "a.tile.openstreetmap.org")):
        for attempt in range(2):
            try:
                req = urllib.request.Request(host, headers={
                    "User-Agent": UA, "Accept": "image/png",
                })
                with urllib.request.urlopen(req, timeout=25) as resp:
                    return Image.open(resp).convert("RGB")
            except Exception:  # noqa: BLE001
                time.sleep(1.0 * (attempt + 1))
    return None


def is_blank(canvas, box):
    colors = canvas.crop(box).getcolors(maxcolors=64)
    return colors is not None and len(colors) <= 2


def main():
    from PIL import Image

    meta = json.load(open(META, encoding="utf-8"))
    z = meta["zoom"]
    x0, y0, x1, y1 = meta["x0"], meta["y0"], meta["x1"], meta["y1"]
    canvas = Image.open(JPG).convert("RGB")
    fixed = 0
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            box = ((tx - x0) * 256, (ty - y0) * 256,
                   (tx - x0) * 256 + 256, (ty - y0) * 256 + 256)
            if not is_blank(canvas, box):
                continue
            done = False
            for up in (1, 2, 3):
                parent = fetch(z - up, tx >> up, ty >> up)
                if parent is None:
                    continue
                scale = 256 >> up
                qx = (tx % (1 << up)) * scale
                qy = (ty % (1 << up)) * scale
                piece = parent.crop((qx, qy, qx + scale, qy + scale)).resize((256, 256))
                canvas.paste(piece, box[:2])
                fixed += 1
                done = True
                break
            if not done:
                print("  仍无法补齐", z, tx, ty)
    canvas.save(JPG, quality=80, optimize=True)
    print("patched", fixed, "tiles, bytes", os.path.getsize(JPG))


if __name__ == "__main__":
    main()
