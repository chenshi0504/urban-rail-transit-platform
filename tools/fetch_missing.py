# -*- coding: utf-8 -*-
"""补充 30 号线、6 号线在 OSM 线路关系中缺失的站点坐标。"""
import json
import os
import sys
import urllib.parse
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "data", "osm_missing_stations.json")

NAMES = ["府城桥", "金融城北", "益州大道", "新园大道", "石羊东", "大同", "青岛路", "芦角",
         "白仁店", "文翁石室", "人民公园"]
NAME_RE = "|".join(NAMES)

QUERY = f"""
[out:json][timeout:90];
(
  node["name"~"^({NAME_RE})$"](30.2,103.5,31.0,104.7);
  way["name"~"^({NAME_RE})$"](30.2,103.5,31.0,104.7);
  relation["name"~"^({NAME_RE})$"](30.2,103.5,31.0,104.7);
);
out center tags;
"""

ENDPOINTS = [
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]


def main():
    body = urllib.parse.urlencode({"data": QUERY}).encode("utf-8")
    for url in ENDPOINTS:
        try:
            req = urllib.request.Request(
                url,
                data=body,
                headers={
                    "User-Agent": "ChengduMetroAtlas/1.0",
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            )
            with urllib.request.urlopen(req, timeout=180) as resp:
                raw = resp.read().decode("utf-8")
            data = json.loads(raw)
            os.makedirs(os.path.dirname(OUT), exist_ok=True)
            with open(OUT, "w", encoding="utf-8") as f:
                f.write(raw)
            for e in data["elements"]:
                print(e["type"], e["id"], e.get("tags", {}).get("name"),
                      e.get("lat") or e.get("center", {}).get("lat"),
                      e.get("lon") or e.get("center", {}).get("lon"))
            return 0
        except Exception as exc:  # noqa: BLE001
            print("fail", url, repr(exc)[:160])
    return 1


if __name__ == "__main__":
    sys.exit(main())
