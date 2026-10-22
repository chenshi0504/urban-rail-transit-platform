# -*- coding: utf-8 -*-
"""抓取成都地铁线路关系的成员站点点位（含名称），以及站名补充信息。"""
import json
import os
import sys
import urllib.parse
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "data", "osm_chengdu_stops.json")

QUERY = """
[out:json][timeout:180];
relation["route"="subway"](29.85,103.40,31.15,104.95)->.routes;
(
  node(r.routes:"stop");
  node(r.routes:"stop_entry_only");
  node(r.routes:"stop_exit_only");
);
out body;
"""

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]


def main():
    body = urllib.parse.urlencode({"data": QUERY}).encode("utf-8")
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
            os.makedirs(os.path.dirname(OUT), exist_ok=True)
            with open(OUT, "w", encoding="utf-8") as f:
                f.write(raw)
            named = sum(1 for e in data["elements"] if e.get("tags", {}).get("name"))
            print("ok", url, "nodes:", len(data["elements"]), "named:", named)
            return 0
        except Exception as exc:  # noqa: BLE001
            print("fail", url, repr(exc)[:160])
    return 1


if __name__ == "__main__":
    sys.exit(main())
