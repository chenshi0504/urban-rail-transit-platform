# -*- coding: utf-8 -*-
"""拼接机场周边区域 OSM 底图（z14），作为 3D 场景的大范围地面。

机场细节底图（z15）由 build_airport.py 生成；本脚本只补齐更大的区域背景，
让 3D 视野像地铁线网图一样看到完整的城市环境，而不是灰色的空白底板。

支持断点续跑：已存在 tfu_region.jpg 时只补下载仍为底色的瓦片。

输出:
    static/data/tfu_region.jpg
    static/data/tfu_region.json
"""
import json
import math
import os
import time
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(BASE, "static", "data")

# 区域底图覆盖约 26 x 27 km，超出部分由雾效与底色兜住
REGION_BBOX = (30.200, 104.300, 30.432, 104.580)
ZOOM = 14
OUT_JPG = os.path.join(OUT_DIR, "tfu_region.jpg")
OUT_META = os.path.join(OUT_DIR, "tfu_region.json")
BG = (232, 238, 243)
UA = "TransitFacilityAtlas/1.0 (local research tool)"


def deg2num(lat, lon, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    lat_r = math.radians(lat)
    y = (1.0 - math.log(math.tan(lat_r) + 1.0 / math.cos(lat_r)) / math.pi) / 2.0 * n
    return x, y


def is_blank(canvas, box):
    """底色瓦片（下载失败留下的空缺）只有极少种颜色。"""
    colors = canvas.crop(box).getcolors(maxcolors=4096)
    return colors is not None and len(colors) <= 2


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
            time.sleep(0.8 * (attempt + 1))
    return None


def build():
    from PIL import Image

    lat_min, lon_min, lat_max, lon_max = REGION_BBOX
    x0f, y0f = deg2num(lat_max, lon_min, ZOOM)
    x1f, y1f = deg2num(lat_min, lon_max, ZOOM)
    x0, y0 = int(math.floor(x0f)), int(math.floor(y0f))
    x1, y1 = int(math.floor(x1f)), int(math.floor(y1f))
    w, h = x1 - x0 + 1, y1 - y0 + 1
    size = (w * 256, h * 256)
    print(f"region tiles {w}x{h} z{ZOOM} -> {size[0]}x{size[1]}")

    if os.path.exists(OUT_JPG):
        canvas = Image.open(OUT_JPG).convert("RGB")
        if canvas.size != size:
            canvas = Image.new("RGB", size, BG)
    else:
        canvas = Image.new("RGB", size, BG)

    ok = 0
    blank = 0
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            box = ((tx - x0) * 256, (ty - y0) * 256,
                   (tx - x0) * 256 + 256, (ty - y0) * 256 + 256)
            if not is_blank(canvas, box):
                ok += 1
                continue
            tile = fetch(tx, ty)
            if tile is None:
                blank += 1
                continue
            canvas.paste(tile, box[:2])
            ok += 1
            time.sleep(0.02)
        print(f"  row {ty - y0 + 1}/{h} filled {ok}/{w * h}", flush=True)

    canvas.save(OUT_JPG, quality=82, optimize=True)
    with open(OUT_META, "w", encoding="utf-8") as f:
        json.dump({
            "zoom": ZOOM,
            "x0": x0, "y0": y0, "x1": x1, "y1": y1,
            "bbox": [lat_min, lon_min, lat_max, lon_max],
            "tile_range": [[x0f, y0f], [x1f, y1f]],
            "size": [w * 256, h * 256],
            "ok_tiles": ok,
            "source": "OpenStreetMap",
        }, f)
    print("region basemap bytes", os.path.getsize(OUT_JPG),
          "tiles", ok, "/", w * h, "blank", blank)


if __name__ == "__main__":
    build()
