# -*- coding: utf-8 -*-
"""抓取大连周水子国际机场及周边 OSM 数据（原始 JSON）。

输出:
    data/osm_dlc_airport.json     机场航空要素（跑道/滑行道/停机坪/机位/登机口）
    data/osm_dlc_terminals.json   航站楼等多边形关系
    data/osm_dlc_rail.json        铁路/地铁轨道
    data/osm_dlc_transit.json     地铁站/出入口/火车站/公交站节点
    data/osm_dlc_roads.json       周边道路网络
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")

BBOX = (38.930, 121.480, 38.995, 121.600)          # 机场及紧邻区域
TERM_BBOX = (38.940, 121.490, 38.992, 121.590)     # 航站楼关系
ROAD_BBOX = (38.900, 121.430, 39.020, 121.640)     # 周边路网

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
UA = "TransitFacilityAtlas/1.0 (local research tool)"


def bbox_str(b):
    return ",".join(str(v) for v in b)


def fetch(query, out_path, label):
    # 用 GET 提交查询（部分网络环境下 POST 会被中断）
    qs = urllib.parse.urlencode({"data": query})
    last = None
    for endpoint in ENDPOINTS:
        for attempt in range(3):
            try:
                req = urllib.request.Request(f"{endpoint}?{qs}", headers={
                    "User-Agent": UA, "Accept": "application/json",
                })
                with urllib.request.urlopen(req, timeout=240) as resp:
                    raw = json.load(resp)
                with open(out_path, "w", encoding="utf-8") as f:
                    json.dump(raw, f, ensure_ascii=False, separators=(",", ":"))
                print(f"{label}: {len(raw.get('elements', []))} 要素 -> {out_path}")
                return raw
            except Exception as exc:  # noqa: BLE001
                last = exc
                print(f"  {label} 失败 ({endpoint}): {exc}")
                time.sleep(2 + attempt * 3)
    raise SystemExit(f"{label} 抓取失败: {last}")


def main():
    os.makedirs(DATA, exist_ok=True)
    only = set(sys.argv[1:])

    def want(name):
        return not only or name in only

    if want("airport"):
        fetch(f"""
[out:json][timeout:180];
(
  way["aeroway"~"^(runway|taxiway|apron|gate|parking_position|terminal)$"]({bbox_str(BBOX)});
  node["aeroway"~"^(gate|parking_position)$"]({bbox_str(BBOX)});
);
out tags geom;
""", os.path.join(DATA, "osm_dlc_airport.json"), "airport")

    if want("terminals"):
        fetch(f"""
[out:json][timeout:180];
(
  relation["aeroway"="terminal"]({bbox_str(TERM_BBOX)});
  relation["building"~"^(transportation|parking)$"]({bbox_str(TERM_BBOX)});
);
out body geom;
""", os.path.join(DATA, "osm_dlc_terminals.json"), "terminals")

    if want("rail"):
        fetch(f"""
[out:json][timeout:120];
(
  way["railway"~"^(rail|subway|light_rail)$"]({bbox_str(BBOX)});
);
out tags geom;
""", os.path.join(DATA, "osm_dlc_rail.json"), "rail")

    if want("transit"):
        fetch(f"""
[out:json][timeout:120];
(
  node["railway"~"^(subway_entrance|station)$"]({bbox_str(BBOX)});
  node["train"="yes"]({bbox_str(BBOX)});
  node["highway"="bus_stop"]({bbox_str(BBOX)});
  node["amenity"="bus_station"]({bbox_str(BBOX)});
);
out;
""", os.path.join(DATA, "osm_dlc_transit.json"), "transit")

    if want("roads"):
        fetch(f"""
[out:json][timeout:240];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]({bbox_str(ROAD_BBOX)});
  way["highway"~"^(residential|unclassified|service)$"]["name"]({bbox_str(ROAD_BBOX)});
);
out tags geom;
""", os.path.join(DATA, "osm_dlc_roads.json"), "roads")


if __name__ == "__main__":
    main()
