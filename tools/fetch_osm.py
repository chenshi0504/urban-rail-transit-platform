# -*- coding: utf-8 -*-
"""从 Overpass API 抓取成都地铁线路关系（含几何与站点），保存原始 JSON。"""
import json
import os
import sys
import urllib.parse
import urllib.request

CACHE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "osm_chengdu_subway.json")

QUERY = """
[out:json][timeout:180];
(
  relation["route"="subway"](29.85,103.40,31.15,104.95);
);
out body geom;
"""

ENDPOINTS = [
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]


def main():
    body = urllib.parse.urlencode({"data": QUERY}).encode("utf-8")
    last = None
    for url in ENDPOINTS:
        try:
            req = urllib.request.Request(
                url,
                data=body,
                headers={
                    "User-Agent": "ChengduMetroAtlas/1.0 (local research tool)",
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            )
            with urllib.request.urlopen(req, timeout=240) as resp:
                raw = resp.read().decode("utf-8")
            data = json.loads(raw)
            os.makedirs(os.path.dirname(CACHE), exist_ok=True)
            with open(CACHE, "w", encoding="utf-8") as f:
                f.write(raw)
            print("ok", url, "elements:", len(data.get("elements", [])), "bytes:", len(raw))
            return 0
        except Exception as exc:  # noqa: BLE001
            last = exc
            print("fail", url, repr(exc)[:200])
    print("all endpoints failed:", last)
    return 1


if __name__ == "__main__":
    sys.exit(main())
