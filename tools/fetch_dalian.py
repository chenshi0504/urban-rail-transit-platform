# -*- coding: utf-8 -*-
"""从 Overpass API 抓取大连地铁线路关系（含几何）与站点节点，保存原始 JSON。"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")
REL_OUT = os.path.join(DATA, "osm_dalian_subway.json")
STOP_OUT = os.path.join(DATA, "osm_dalian_stops.json")

BBOX = "38.60,120.90,39.50,122.40"

REL_QUERY = f"""
[out:json][timeout:300];
(
  relation["route"="subway"]({BBOX});
);
out body geom;
"""

STOP_QUERY = f"""
[out:json][timeout:240];
relation["route"="subway"]({BBOX})->.routes;
(
  node(r.routes:"stop");
  node(r.routes:"stop_entry_only");
  node(r.routes:"stop_exit_only");
);
out body;
"""

ENDPOINTS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]


def fetch(query, out_path):
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    last = None
    for url in ENDPOINTS:
        try:
            req = urllib.request.Request(
                url,
                data=body,
                headers={
                    "User-Agent": "DalianMetroAtlas/1.0 (local research tool)",
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            )
            with urllib.request.urlopen(req, timeout=300) as resp:
                raw = resp.read().decode("utf-8")
            data = json.loads(raw)
            os.makedirs(DATA, exist_ok=True)
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(raw)
            print("ok", url, os.path.basename(out_path),
                  "elements:", len(data.get("elements", [])), "bytes:", len(raw))
            return True
        except Exception as exc:  # noqa: BLE001
            last = exc
            print("fail", url, repr(exc)[:180])
            time.sleep(3)
    print("all endpoints failed:", last)
    return False


def main():
    ok1 = fetch(REL_QUERY, REL_OUT)
    ok2 = fetch(STOP_QUERY, STOP_OUT)
    return 0 if ok1 and ok2 else 1


if __name__ == "__main__":
    sys.exit(main())
