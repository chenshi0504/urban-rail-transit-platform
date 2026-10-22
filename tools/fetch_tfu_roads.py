# -*- coding: utf-8 -*-
"""从 Overpass API 抓取天府机场周边道路网络（含几何），保存原始 JSON。

输出:
    data/osm_tfu_roads.json
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "data", "osm_tfu_roads.json")

# 机场周边约 17 × 19 km（南, 西, 北, 东）
BBOX = (30.240, 104.360, 30.390, 104.550)

QUERY = """
[out:json][timeout:180];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](%(bbox)s);
  way["highway"~"^(residential|unclassified|service)$"]["name"](%(bbox)s);
);
out tags geom;
"""

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
UA = "TransitFacilityAtlas/1.0 (local research tool)"


def fetch():
    data = urllib.parse.urlencode({
        "data": QUERY % {"bbox": ",".join(str(v) for v in BBOX)},
    }).encode()
    last = None
    for endpoint in ENDPOINTS:
        for attempt in range(2):
            try:
                req = urllib.request.Request(endpoint, data=data, headers={
                    "User-Agent": UA, "Accept": "application/json",
                })
                with urllib.request.urlopen(req, timeout=240) as resp:
                    return json.load(resp)
            except Exception as exc:  # noqa: BLE001
                last = exc
                print(f"  {endpoint} 失败: {exc}", file=sys.stderr)
                time.sleep(2 + attempt * 3)
    raise SystemExit(f"Overpass 请求失败: {last}")


def main():
    raw = fetch()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(raw, f, ensure_ascii=False, separators=(",", ":"))

    counts = {}
    for el in raw.get("elements", []):
        cls = el.get("tags", {}).get("highway", "?")
        counts[cls] = counts.get(cls, 0) + 1
    print("ways=", len(raw.get("elements", [])), counts)
    print("->", OUT, os.path.getsize(OUT) // 1024, "KB")


if __name__ == "__main__":
    main()
