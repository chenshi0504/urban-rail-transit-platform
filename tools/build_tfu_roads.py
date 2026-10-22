# -*- coding: utf-8 -*-
"""把天府机场周边 OSM 道路要素整理为 3D 场景用的路网数据。

输出:
    static/data/tfu_roads.json
"""
import json
import math
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(BASE, "data", "osm_tfu_roads.json")
OUT = os.path.join(BASE, "static", "data", "tfu_roads.json")

# 与抓取脚本一致的覆盖范围（南, 西, 北, 东）
BBOX = (30.240, 104.360, 30.390, 104.550)
LAT0 = 30.3125

# 车道宽度按等级估算（米），用于生成带状路面
WIDTH = {
    "motorway": 26.0,
    "trunk": 24.0,
    "primary": 20.0,
    "secondary": 15.0,
    "tertiary": 12.0,
    "unclassified": 9.0,
    "residential": 8.0,
    "service": 6.0,
}
LINK_WIDTH = {"motorway_link": 9.0, "trunk_link": 9.0, "primary_link": 7.5,
              "secondary_link": 7.0, "tertiary_link": 6.0}
DROP = {"footway", "path", "cycleway", "steps", "pedestrian", "track"}
KEEP = {
    "motorway", "trunk", "primary", "secondary", "tertiary",
    "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
    "unclassified", "residential", "service",
}


def meter_dist(a, b):
    dx = (b[1] - a[1]) * 111320.0 * math.cos(math.radians(LAT0))
    dy = (b[0] - a[0]) * 111320.0
    return math.hypot(dx, dy)


def inside(p, pad=0.002):
    return (BBOX[0] - pad <= p[0] <= BBOX[2] + pad
            and BBOX[1] - pad <= p[1] <= BBOX[3] + pad)


def simplify(pts, min_dist=11.0):
    """按最小间距抽稀，去掉几乎共线的点。"""
    out = []
    for p in pts:
        if not out:
            out.append(p)
            continue
        if meter_dist(out[-1], p) < min_dist:
            continue
        out.append(p)
    if len(out) > 2:
        # 端点保留
        if meter_dist(out[-1], pts[-1]) > 3:
            out.append(pts[-1])
    return out


def clip_runs(pts):
    """把落在范围外的点断开，只保留范围内的连续段。"""
    runs, cur = [], []
    for p in pts:
        if inside(p):
            cur.append(p)
        else:
            if len(cur) > 1:
                runs.append(cur)
            cur = []
    if len(cur) > 1:
        runs.append(cur)
    return runs


def main():
    raw = json.load(open(RAW, encoding="utf-8"))
    roads = []
    named = {}
    for el in raw.get("elements", []):
        tags = el.get("tags", {})
        cls = tags.get("highway", "")
        if cls not in KEEP or cls in DROP:
            continue
        if tags.get("area") == "yes":
            continue
        geom = el.get("geometry") or []
        if len(geom) < 2:
            continue
        pts = [(p["lat"], p["lon"]) for p in geom if "lat" in p]
        width = LINK_WIDTH.get(cls) or WIDTH.get(cls) or 8.0
        for run in clip_runs(pts):
            run = simplify(run)
            if len(run) < 2:
                continue
            length = sum(meter_dist(run[i - 1], run[i]) for i in range(1, len(run)))
            if length < 30:
                continue
            name = (tags.get("name") or "").strip()
            road = {
                "id": f'{el.get("id")}-{len(roads)}',
                "cls": cls,
                "w": round(width, 1),
                "len": round(length),
                "pts": [[round(p[0], 5), round(p[1], 5)] for p in run],
            }
            if name:
                road["name"] = name
            if tags.get("bridge") in ("yes", "viaduct"):
                road["br"] = 1
            if tags.get("tunnel") == "yes":
                road["tn"] = 1
            if tags.get("oneway") == "yes" or cls in ("motorway", "trunk"):
                road["ow"] = 1
            roads.append(road)
            if name and cls not in ("service", "residential", "unclassified"):
                named[name] = named.get(name, 0.0) + length

    # 标签只保留较长的主干道名称，避免密集重名
    labels = [k for k, v in sorted(named.items(), key=lambda kv: -kv[1]) if v > 1200][:40]
    roads.sort(key=lambda r: (r["cls"] in ("service", "residential", "unclassified"), -r["len"]))

    data = {
        "meta": {
            "source": "OpenStreetMap",
            "bbox": list(BBOX),
            "count": len(roads),
            "length_km": round(sum(r["len"] for r in roads) / 1000, 1),
        },
        "labels": labels,
        "roads": roads,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    counts = {}
    for r in roads:
        counts[r["cls"]] = counts.get(r["cls"], 0) + 1
    print("roads=", len(roads), counts)
    print("length=", data["meta"]["length_km"], "km")
    print("->", OUT, os.path.getsize(OUT) // 1024, "KB")


if __name__ == "__main__":
    main()
