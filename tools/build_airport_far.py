# -*- coding: utf-8 -*-
"""拼接机场远景观底图（z12，约 66 × 59 km）。

配合 tfu_region.jpg（z14，约 27 km）使用：拉远到最大视野时仍有真实地图，
不再依赖雾效遮挡边缘。

输出:
    static/data/tfu_far.jpg
    static/data/tfu_far.json
"""
import json
import math
import os
import time
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(BASE, "static", "data")

# 覆盖最大缩放视野（约 43 × 27 km），边缘再向外留出余量
FAR_BBOX = (30.050, 104.100, 30.580, 104.790)
ZOOM = 12
OUT_JPG = os.path.join(OUT_DIR, "tfu_far.jpg")
OUT_META = os.path.join(OUT_DIR, "tfu_far.json")
BG = (232, 238, 243)
UA = "TransitFacilityAtlas/1.0 (local research tool)"


def deg2num(lat, lon, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    lat_r = math.radians(lat)
    y = (1.0 - math.log(math.tan(lat_r) + 1.0 / math.cos(lat_r)) / math.pi) / 2.0 * n
    return x, y


def fetch(tx, ty):
    from PIL import Image
    url = f"https://tile.openstreetmap.org/{ZOOM}/{tx}/{ty}.png"
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA, "Accept": "image/png",
            })
            with urllib.request.urlopen(req, timeout=30) as resp:
                return Image.open(resp).convert("RGB")
        except Exception:  # noqa: BLE001
            time.sleep(0.9 * (attempt + 1))
    return None


def build():
    from PIL import Image

    lat_min, lon_min, lat_max, lon_max = FAR_BBOX
    x0f, y0f = deg2num(lat_max, lon_min, ZOOM)
    x1f, y1f = deg2num(lat_min, lon_max, ZOOM)
    x0, y0 = int(math.floor(x0f)), int(math.floor(y0f))
    x1, y1 = int(math.floor(x1f)), int(math.floor(y1f))
    w, h = x1 - x0 + 1, y1 - y0 + 1
    canvas = Image.new("RGB", (w * 256, h * 256), BG)
    print(f"far tiles {w}x{h} z{ZOOM}")

    ok = 0
    failed = []
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            tile = fetch(tx, ty)
            if tile is None:
                failed.append((tx, ty))
                continue
            canvas.paste(tile, ((tx - x0) * 256, (ty - y0) * 256))
            ok += 1
            time.sleep(0.02)
        print(f"  row {ty - y0 + 1}/{h} ok {ok}", flush=True)

    # 失败瓦片补抓，避免远景观出现底色方块
    for attempt in range(3):
        if not failed:
            break
        time.sleep(1.2 * (attempt + 1))
        rest = []
        for tx, ty in failed:
            tile = fetch(tx, ty)
            if tile is None:
                rest.append((tx, ty))
                continue
            canvas.paste(tile, ((tx - x0) * 256, (ty - y0) * 256))
            ok += 1
        print(f"  retry {attempt + 1}: left {len(rest)}", flush=True)
        failed = rest
    blank = len(failed)

    canvas.save(OUT_JPG, quality=80, optimize=True)
    with open(OUT_META, "w", encoding="utf-8") as f:
        json.dump({
            "zoom": ZOOM,
            "x0": x0, "y0": y0, "x1": x1, "y1": y1,
            "bbox": [lat_min, lon_min, lat_max, lon_max],
            "size": [w * 256, h * 256],
            "ok_tiles": ok,
            "source": "OpenStreetMap",
        }, f)
    print("far basemap bytes", os.path.getsize(OUT_JPG), "blank", blank)


if __name__ == "__main__":
    build()
