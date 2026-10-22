# -*- coding: utf-8 -*-
"""把大连地铁 OSM 原始数据整理为前端可直接消费的线网数据。

复用成都 build_data.py 的站序整理、几何合并与简化算法，替换线路配置与站名清洗：
- OSM 为区分换乘站的不同线路节点，站名带「（N号线）」后缀，这里统一清洗合并
- 3 号线九里支线单独标注
- 计算换乘站、邻近车站、去重站点
"""
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")
OUT = os.path.join(DATA, "network_dalian.json")

RAW = json.load(open(os.path.join(DATA, "osm_dalian_subway.json"), encoding="utf-8"))
STOP_RAW = json.load(open(os.path.join(DATA, "osm_dalian_stops.json"), encoding="utf-8"))
STOPS = {e["id"]: e for e in STOP_RAW["elements"]}
RELATIONS = {e["id"]: e for e in RAW["elements"]}

LINES = [
    dict(ref="1", main=6185548, length=28.34, opened="2015-10-30",
         from_="姚家", to="河口", color="#42B227",
         note="大连首条地铁，纵贯主城南北，串联大连北站、西安路与星海广场。"),
    dict(ref="2", main=5491623, length=37.30, opened="2015-05-22",
         from_="海之韵", to="大连北站", color="#0066A1",
         note="东西向骨干线，连接东港、青泥洼桥、西安路、机场与大连北站。"),
    dict(ref="3", main=7908038, branch=[3123050], length=63.45, opened="2002-11-08",
         from_="大连站", to="金石滩", color="#DD00BB",
         note="大连最早的轨道交通线，主线至金石滩，开发区—九里为支线。"),
    dict(ref="5", main=15611185, length=24.48, opened="2023-03-17",
         from_="虎滩新区", to="后关", color="#E60012",
         note="跨海穿城骨干线，串联虎滩新区、劳动公园、大连站与后关。"),
    dict(ref="12", main=5492211, length=40.35, opened="2014-05-01",
         from_="河口", to="旅顺新港", color="#523E98",
         note="连接主城与旅顺口的市域快线，沿黄海海岸西行。"),
    dict(ref="13", main=13633352, length=43.15, opened="2021-12-28",
         from_="九里", to="普兰店振兴街", color="#FFE400",
         note="金普城际铁路，北接 3 号线九里支线，服务金州与普兰店。"),
]

LINE_NAME = {c["ref"]: f'{c["ref"]}号线' for c in LINES}
LINE_NAME["12"] = "12号线"

EXTRA_COORDS = {}
EXTRAS = {}
SUSPENDED = {}

NAME_SUFFIX = re.compile(r"（[^）]*）\s*$")


def clean_name(name):
    if not name:
        return name
    return NAME_SUFFIX.sub("", name).strip()


def stop_name(node_id):
    node = STOPS.get(node_id)
    if not node:
        return None
    return clean_name(node.get("tags", {}).get("name"))


def relation_stops(rel, role_prefixes=("stop",)):
    names = []
    for m in rel.get("members", []):
        if m["type"] == "node" and str(m.get("role", "")).startswith(role_prefixes):
            n = stop_name(m["ref"])
            if n:
                names.append(n)
    return names


def dedupe_sequence(names):
    out = []
    for n in names:
        if not out or out[-1] != n:
            out.append(n)
    if len(out) > 2 and out[0] == out[-1]:
        out.pop()
    return out


def orient(names, from_, to):
    if not names or from_ == to:
        return names
    if names[0] == from_ and names[-1] == to:
        return names
    if names[0] == to and names[-1] == from_:
        return list(reversed(names))
    i = names.index(from_) if from_ in names else None
    j = names.index(to) if to in names else None
    if i is not None and j is not None:
        return names if i < j else list(reversed(names))
    return names


def insert_extras(names, pairs):
    for name, anchor in pairs:
        if name in names:
            continue
        if anchor in names:
            names.insert(names.index(anchor) + 1, name)
        else:
            names.append(name)
    return names


def get_ways(rel):
    out = []
    seen = set()
    for m in rel.get("members", []):
        if m["type"] != "way" or m.get("role"):
            continue
        if m["ref"] in seen:
            continue
        geom = m.get("geometry")
        if not geom:
            continue
        seen.add(m["ref"])
        out.append([(p["lat"], p["lon"]) for p in geom])
    return out


def merge_chains(segments):
    chains = []
    for seg in segments:
        if len(seg) < 2:
            continue
        placed = False
        for ch in chains:
            if ch[-1] == seg[0]:
                ch.extend(seg[1:]); placed = True; break
            if ch[-1] == seg[-1]:
                ch.extend(reversed(seg[:-1])); placed = True; break
            if ch[0] == seg[-1]:
                ch[:0] = seg[:-1]; placed = True; break
            if ch[0] == seg[0]:
                ch[:0] = list(reversed(seg[1:])); placed = True; break
        if not placed:
            chains.append(list(seg))

    changed = True
    while changed and len(chains) > 1:
        changed = False
        for i in range(len(chains)):
            if changed:
                break
            for j in range(i + 1, len(chains)):
                a, b = chains[i], chains[j]
                if a[-1] == b[0]:
                    a.extend(b[1:]); del chains[j]; changed = True; break
                if a[-1] == b[-1]:
                    a.extend(reversed(b[:-1])); del chains[j]; changed = True; break
                if a[0] == b[-1]:
                    a[:0] = b[:-1]; del chains[j]; changed = True; break
                if a[0] == b[0]:
                    a[:0] = list(reversed(b[1:])); del chains[j]; changed = True; break
    return chains


def perp_dist(p, a, b):
    ax, ay = a[1], a[0]
    bx, by = b[1], b[0]
    px, py = p[1], p[0]
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def rdp(points, eps=0.00002):
    if len(points) < 3:
        return points
    dmax, index = 0.0, 0
    for i in range(1, len(points) - 1):
        d = perp_dist(points[i], points[0], points[-1])
        if d > dmax:
            dmax, index = d, i
    if dmax > eps:
        left = rdp(points[:index + 1], eps)
        right = rdp(points[index:], eps)
        return left[:-1] + right
    return [points[0], points[-1]]


def haversine(a, b):
    r = 6371008.8
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def chain_length(chains):
    return sum(sum(haversine(c[k], c[k + 1]) for k in range(len(c) - 1)) for c in chains)


def main():
    station_occ = defaultdict(list)
    station_en = defaultdict(Counter)
    station_lines = defaultdict(set)
    line_objects = []

    for cfg in LINES:
        ref = cfg["ref"]
        rel = RELATIONS[cfg["main"]]
        color = (rel.get("tags", {}).get("colour") or cfg.get("color") or "#888888").upper()
        names = dedupe_sequence(relation_stops(rel))
        names = orient(names, cfg["from_"], cfg["to"])
        names = insert_extras(names, EXTRAS.get(ref, []))

        branches = []
        if cfg.get("branch"):
            main_set = set(names)
            for bid in cfg["branch"]:
                bnames = dedupe_sequence(relation_stops(RELATIONS[bid]))
                run, start = [], None
                best, best_len = None, 0
                for i, n in enumerate(bnames):
                    if n not in main_set:
                        if not run:
                            start = i
                        run.append(n)
                        if len(run) > best_len:
                            best_len = len(run)
                            best = (start, list(run))
                    else:
                        run = []
                if best:
                    start, seq = best
                    if start == 0:
                        seq = list(reversed(seq))
                        anchor = bnames[len(seq)] if len(bnames) > len(seq) else names[-1]
                    else:
                        anchor = bnames[start - 1]
                    branches.append({"anchor": anchor, "stations": seq})
                    names = names + [s for s in seq if s not in names]

        ways = get_ways(rel)
        main_way_ids = {m["ref"] for m in rel.get("members", [])
                        if m["type"] == "way" and not m.get("role")}
        for br in branches:
            brel = None
            for bid in cfg.get("branch", []):
                if any(n in relation_stops(RELATIONS[bid]) for n in br["stations"]):
                    brel = RELATIONS[bid]
                    break
            if not brel:
                continue
            # 支线轨道全量并入，仅剔除与主线重复的 way
            for m in brel.get("members", []):
                if m["type"] != "way" or m.get("role") or m["ref"] in main_way_ids:
                    continue
                geom = m.get("geometry")
                if geom:
                    ways.append([(p["lat"], p["lon"]) for p in geom])
        chains = merge_chains(ways)
        chains = [rdp(c) for c in chains]
        computed = chain_length(chains) / 1000.0

        rel_ids = [cfg["main"]] + cfg.get("branch", [])
        for n in names:
            station_lines[n].add(ref)
            if n in EXTRA_COORDS:
                lat, lon, en = EXTRA_COORDS[n]
                station_occ[n].append((lat, lon))
                station_en[n][en] += 1
            else:
                found = False
                for rid in rel_ids:
                    for m in RELATIONS[rid].get("members", []):
                        if m["type"] == "node" and str(m.get("role", "")).startswith("stop"):
                            node = STOPS.get(m["ref"])
                            if node and clean_name(node.get("tags", {}).get("name")) == n:
                                station_occ[n].append((node["lat"], node["lon"]))
                                en = clean_name(node.get("tags", {}).get("name:en") or "")
                                if en:
                                    station_en[n][en] += 1
                                found = True
                                break
                    if found:
                        break

        line_objects.append({
            "ref": ref,
            "name": LINE_NAME[ref],
            "color": color,
            "length": cfg["length"],
            "computed_length": round(computed, 2),
            "opened": cfg["opened"],
            "from": cfg["from_"],
            "to": cfg["to"],
            "loop": bool(cfg.get("loop")),
            "note": cfg["note"],
            "stations": names,
            "branches": branches,
            "station_count": len(names),
            "shape": [[[round(p[0], 6), round(p[1], 6)] for p in c] for c in chains],
            "sort": len(line_objects),
        })
        print(f'{ref:>3} stops={len(names):>2} chains={len(chains):>2} '
              f'computed={computed:6.1f}km official={cfg["length"]:6.2f}km'
              + (f' branches={branches}' if branches else ""))

    stations = []
    for name, occ in station_occ.items():
        lat = sum(o[0] for o in occ) / len(occ)
        lon = sum(o[1] for o in occ) / len(occ)
        lines = sorted(station_lines[name], key=lambda r: [c["ref"] for c in LINES].index(r))
        status = "suspended" if any(name in SUSPENDED.get(r, set()) for r in lines) else "operating"
        stations.append({
            "name": name,
            "name_en": (station_en[name].most_common(1)[0][0] if station_en[name] else ""),
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "lines": lines,
            "status": status,
        })
    stations.sort(key=lambda s: s["name"])

    for s in stations:
        near = []
        for t in stations:
            if s is t or set(s["lines"]) & set(t["lines"]):
                continue
            d = haversine((s["lat"], s["lon"]), (t["lat"], t["lon"]))
            if d <= 450:
                near.append({"name": t["name"], "lines": t["lines"], "distance": int(round(d))})
        near.sort(key=lambda x: x["distance"])
        s["nearby"] = near[:2]

    transfer_count = sum(1 for s in stations if len(s["lines"]) > 1)
    total_km = round(sum(l["length"] for l in line_objects), 2)
    network = {
        "meta": {
            "city": "大连",
            "generated": "2026-10-19",
            "source": "OpenStreetMap",
            "line_count": len(line_objects),
            "station_count": len(stations),
            "transfer_count": transfer_count,
            "total_km": total_km,
        },
        "lines": line_objects,
        "stations": stations,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(network, f, ensure_ascii=False, separators=(",", ":"))

    print(f'\nlines={len(line_objects)} stations={len(stations)} transfers={transfer_count} total={total_km}km')
    print("size:", os.path.getsize(OUT), "bytes")

    names = {s["name"] for s in stations}
    for cfg in LINES:
        missing = [n for n in (cfg["from_"], cfg["to"]) if n not in names]
        if missing:
            print("WARN missing terminus", cfg["ref"], missing)
    for n, occ in station_occ.items():
        if len(occ) > 1:
            dmax = max(haversine(occ[i], occ[j]) for i in range(len(occ)) for j in range(i + 1, len(occ)))
            if dmax > 500:
                print("WARN spread", n, round(dmax), "m", len(occ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
