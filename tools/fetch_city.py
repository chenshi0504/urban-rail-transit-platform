# -*- coding: utf-8 -*-
"""抓取指定城市的轨道交通线路关系（含几何）与站点节点。

用法:
    python tools/fetch_city.py chongqing "29.15,105.90,30.05,106.95"
    python tools/fetch_city.py kunming "24.70,102.55,25.15,103.00"

同时抓取 route=subway 与 route=monorail（重庆 2/3 号线为跨座式单轨）。
输出 data/osm_<city>_subway.json 与 data/osm_<city>_stops.json。
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

CITY = sys.argv[1]
BBOX = sys.argv[2]

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")
REL_OUT = os.path.join(DATA, f"osm_{CITY}_subway.json")
STOP_OUT = os.path.join(DATA, f"osm_{CITY}_stops.json")

REL_QUERY = f"""
[out:json][timeout:300];
(
  relation["route"="subway"]({BBOX});
  relation["route"="monorail"]({BBOX});
);
out body geom;
"""

STOP_QUERY = f"""
[out:json][timeout:200];
(
  node["subway"="yes"]({BBOX});
  node["railway"="station"]["station"="subway"]({BBOX});
  node["public_transport"="station"]["subway"="yes"]({BBOX});
  node["railway"="stop"]["subway"="yes"]({BBOX});
);
out body;
"""

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]


def fetch(query, out_path, label):
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    last = None
    for round_no in range(3):
        for url in ENDPOINTS:
            try:
                req = urllib.request.Request(
                    url,
                    data=body,
                    headers={
                        "User-Agent": f"RailAtlas-{CITY}/1.0 (local research tool)",
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
                print("ok", label, url, "elements:", len(data.get("elements", [])),
                      "bytes:", len(raw))
                return True
            except Exception as exc:  # noqa: BLE001
                last = exc
                print("fail", label, url, repr(exc)[:150])
                time.sleep(2)
        time.sleep(8)
    print("all endpoints failed:", label, last)
    return False


def main():
    ok1 = fetch(REL_QUERY, REL_OUT, "relations")
    ok2 = fetch(STOP_QUERY, STOP_OUT, "stops")
    return 0 if ok1 and ok2 else 1


if __name__ == "__main__":
    sys.exit(main())
