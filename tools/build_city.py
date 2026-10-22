# -*- coding: utf-8 -*-
"""构建城市线网数据（昆明 / 重庆 / 贵阳）。

复用大连 build_dalian.py 的站序整理、几何合并与简化算法，按城市配置生成
data/network_<city>.json。用法:

    python tools/build_city.py kunming
    python tools/build_city.py chongqing
    python tools/build_city.py guiyang
"""
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")

CONFIGS = {
    "kunming": {
        "city": "昆明",
        "lines": [
            dict(ref="1", main=5456208, branch=[7909745], length=34.3, opened="2013-05-20",
                 from_="环城南路", to="大学城南", color="#BF3334",
                 note="昆明首条地铁，纵贯主城南北；昆明南火车站方向为支线，与 2 号线在环城南路贯通运营。"),
            dict(ref="2", main=4508011, length=12.3, opened="2014-04-28",
                 from_="环城南路", to="北部汽车站", color="#235A99",
                 note="南北向骨干线，串联东风广场、火车北站与北部汽车站。"),
            dict(ref="3", main=5456210, length=23.35, opened="2017-08-29",
                 from_="西山公园", to="东部汽车站", color="#FE4998",
                 note="东西向骨干线，横穿主城，连接西山片区与东部汽车站。"),
            dict(ref="4", main=7957933, length=43.38, opened="2020-09-23",
                 from_="昆明南火车站", to="金川路", color="#DD8800",
                 note="昆明最长地铁线路，连接昆明南站、呈贡新城与主城西北。"),
            dict(ref="5", main=14317127, length=26.45, opened="2022-06-29",
                 from_="宝丰", to="世博园", color="#2AA844",
                 note="串联滇池会展片区、主城核心区与世博园。"),
            dict(ref="6", main=5456211, length=25.28, opened="2012-06-28",
                 from_="机场中心", to="塘子巷", color="#0290A4",
                 note="机场快线，连接长水国际机场与主城塘子巷。"),
        ],
        "suffix": None,
        "extra_coords": {},
        "extras": {},
        "suspended": {},
    },
    "chongqing": {
        "city": "重庆",
        "lines": [
            dict(ref="1", main=2336456, length=45.34, opened="2011-07-28",
                 from_="璧山", to="朝天门", color="#E4002B",
                 note="重庆首条地铁，串联璧山、大学城、沙坪坝、两路口与朝天门。"),
            dict(ref="2", main=444083, length=31.36, opened="2005-06-18",
                 from_="鱼洞", to="较场口", color="#007A33",
                 note="中国首条跨座式单轨，沿嘉陵江与长江穿行，途经李子坝穿楼段。"),
            dict(ref="3", main=2341149, branch=[9597502], length=67.09, opened="2011-09-29",
                 from_="鱼洞", to="江北机场T2航站楼", color="#003DA5",
                 note="贯通南北的单轨骨干线，北端接空港支线至举人坝。"),
            dict(ref="4", main=7677819, length=60.40, opened="2018-12-28",
                 from_="石马河立交", to="黄岭", color="#DC8633",
                 note="东西向骨干线，串联重庆北站、唐家沱与龙兴、石船片区。"),
            dict(ref="5", main=7676337, length=48.70, opened="2017-12-28",
                 from_="跳磴", to="悦港北路", color="#00A3E0",
                 note="南北向骨干线，连接重庆西站、石桥铺、冉家坝与中央公园。"),
            dict(ref="6", main=2768660, branch=[3474487, 19293565], length=89.90,
                 opened="2012-09-28", from_="北碚", to="茶园", color="#F67599",
                 note="纵贯主城南北，含国博支线（礼嘉—沙河坝）与重庆东站支线。"),
            dict(ref="9", main=14004562, length=39.80, opened="2022-01-25",
                 from_="花石沟", to="高滩岩", color="#862041",
                 note="连接中央公园、观音桥、化龙桥与沙坪坝的南北向线路。"),
            dict(ref="10", main=7913721, length=43.30, opened="2017-12-28",
                 from_="王家庄", to="兰花路", color="#3C1053",
                 note="机场快线，串联悦来、江北机场、重庆北站与南坪。"),
            dict(ref="18", main=15749312, length=29.00, opened="2023-12-28",
                 from_="跳磴南", to="富华路", color="#2CD5C4",
                 note="沿长江南岸运行，连接跳磴、李家沱、杨家坪与富华路。"),
            dict(ref="环", name="环线", main=7662492, loop=True, length=50.90, opened="2018-12-28",
                 from_="重庆西站", to="重庆西站", color="#F2A900",
                 note="环形线路，串联重庆西站、沙坪坝、冉家坝、五里店与谢家湾。"),
            dict(ref="JT", name="江跳线", main=10176833, length=26.30, opened="2022-08-06",
                 from_="跳磴", to="圣泉寺", color="#7B68EE",
                 note="市郊铁路，连接主城跳磴与江津圣泉寺，部分车次与 5 号线直通。"),
            dict(ref="BT", name="璧铜线", main=17135614, length=37.50, opened="2024-12-26",
                 from_="铜梁西", to="璧山", color="#0057B8",
                 note="市郊铁路，连接铜梁城区与璧山，与 1 号线在璧山换乘。"),
        ],
        "suffix": None,
        "extra_coords": {},
        "extras": {},
        "suspended": {},
    },
    "guiyang": {
        "city": "贵阳",
        "lines": [
            dict(ref="1", main=10149268, length=35.11, opened="2017-12-28",
                 from_="窦官", to="小孟工业园", color="#00A650",
                 note="贵阳首条地铁，纵贯观山湖、云岩、南明至小孟工业园。"),
            dict(ref="2", main=12791163, length=40.60, opened="2021-04-28",
                 from_="白云北路", to="中兴路", color="#1E5AA8",
                 note="南北向骨干线，连接白云、观山湖、老城与龙洞堡机场。"),
            dict(ref="3", main=16843975, length=43.03, opened="2023-12-16",
                 from_="洛湾", to="桐木岭（省委党校）", color="#E60012",
                 note="贯穿乌当、云岩、南明与花溪的南北向线路，串联黔灵山与花溪公园。"),
            dict(ref="S1", name="S1线", main=18482300, length=30.32, opened="2024-12-28",
                 from_="皂角坝", to="望城坡", color="#7B2D8E",
                 note="贵阳贵安互联互通的市域快线，连接贵安新区与南明区。"),
        ],
        "suffix": None,
        "extra_coords": {},
        "extras": {},
        "suspended": {},
    },
}


def load_config(city):
    cfg = CONFIGS[city]
    raw = json.load(open(os.path.join(DATA, f"osm_{city}_subway.json"), encoding="utf-8"))
    stop_raw = json.load(open(os.path.join(DATA, f"osm_{city}_stops.json"), encoding="utf-8"))
    return cfg, raw, stop_raw


def build(city):
    cfg = CONFIGS[city]
    raw, stop_raw = None, None
    try:
        cfg2, raw, stop_raw = load_config(city)
        cfg = cfg2
    except FileNotFoundError as exc:
        print("missing data:", exc)
        return 1

    stops = {e["id"]: e for e in stop_raw["elements"]}
    relations = {e["id"]: e for e in raw["elements"]}
    suffix = re.compile(cfg["suffix"]) if cfg.get("suffix") else None

    def clean_name(name):
        if not name:
            return name
        if suffix:
            name = suffix.sub("", name)
        return name.strip()

    def stop_name(node_id):
        node = stops.get(node_id)
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

    def dedupe(names):
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

    def get_way_geoms(rel):
        out = []
        seen = set()
        for m in rel.get("members", []):
            if m["type"] != "way" or m.get("role") or m["ref"] in seen:
                continue
            geom = m.get("geometry")
            if not geom:
                continue
            seen.add(m["ref"])
            out.append(((m["ref"], [(p["lat"], p["lon"]) for p in geom])))
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

    station_occ = defaultdict(list)
    station_en = defaultdict(Counter)
    station_lines = defaultdict(set)
    line_objects = []

    for line_cfg in cfg["lines"]:
        ref = line_cfg["ref"]
        rel = relations[line_cfg["main"]]
        color = (rel.get("tags", {}).get("colour") or line_cfg.get("color") or "#888888").upper()
        names = dedupe(relation_stops(rel))
        names = orient(names, line_cfg["from_"], line_cfg["to"])
        names = insert_extras(names, cfg["extras"].get(ref, []))

        branches = []
        if line_cfg.get("branch"):
            main_set = set(names)
            for bid in line_cfg["branch"]:
                bnames = dedupe(relation_stops(relations[bid]))
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

        ways = [geom for _, geom in get_way_geoms(rel)]
        main_way_ids = {m["ref"] for m in rel.get("members", [])
                        if m["type"] == "way" and not m.get("role")}
        for br in branches:
            brel = None
            for bid in line_cfg.get("branch", []):
                if any(n in relation_stops(relations[bid]) for n in br["stations"]):
                    brel = relations[bid]
                    break
            if not brel:
                continue
            for wid, geom in get_way_geoms(brel):
                if wid not in main_way_ids:
                    ways.append(geom)

        chains = [rdp(c) for c in merge_chains(ways)]
        computed = chain_length(chains) / 1000.0

        rel_ids = [line_cfg["main"]] + line_cfg.get("branch", [])
        for n in names:
            station_lines[n].add(ref)
            if n in cfg["extra_coords"]:
                lat, lon, en = cfg["extra_coords"][n]
                station_occ[n].append((lat, lon))
                station_en[n][en] += 1
            else:
                found = False
                for rid in rel_ids:
                    for m in relations[rid].get("members", []):
                        if m["type"] == "node" and str(m.get("role", "")).startswith("stop"):
                            node = stops.get(m["ref"])
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
            "name": line_cfg.get("name") or f"{ref}号线",
            "color": color,
            "length": line_cfg["length"],
            "computed_length": round(computed, 2),
            "opened": line_cfg["opened"],
            "from": line_cfg["from_"],
            "to": line_cfg["to"],
            "loop": bool(line_cfg.get("loop")),
            "note": line_cfg["note"],
            "stations": names,
            "branches": branches,
            "station_count": len(names),
            "shape": [[[round(p[0], 6), round(p[1], 6)] for p in c] for c in chains],
            "sort": len(line_objects),
        })
        print(f'{ref:>4} stops={len(names):>2} chains={len(chains):>2} '
              f'computed={computed:6.1f}km official={line_cfg["length"]:6.2f}km'
              + (f' branches={[(b["anchor"], len(b["stations"])) for b in branches]}' if branches else ""))

    stations = []
    for name, occ in station_occ.items():
        lat = sum(o[0] for o in occ) / len(occ)
        lon = sum(o[1] for o in occ) / len(occ)
        lines = sorted(station_lines[name], key=lambda r: [c["ref"] for c in cfg["lines"]].index(r))
        status = "suspended" if any(name in cfg["suspended"].get(r, set()) for r in lines) else "operating"
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
            "city": cfg["city"],
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
    out = os.path.join(DATA, f"network_{city}.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(network, f, ensure_ascii=False, separators=(",", ":"))
    print(f"\n{city}: lines={len(line_objects)} stations={len(stations)} "
          f"transfers={transfer_count} total={total_km}km")
    print("size:", os.path.getsize(out), "bytes")

    all_names = {s["name"] for s in stations}
    for line_cfg in cfg["lines"]:
        missing = [n for n in (line_cfg["from_"], line_cfg["to"]) if n not in all_names]
        if missing:
            print("WARN missing terminus", line_cfg["ref"], missing)
    for n, occ in station_occ.items():
        if len(occ) > 1:
            dmax = max(haversine(occ[i], occ[j]) for i in range(len(occ)) for j in range(i + 1, len(occ)))
            if dmax > 600:
                print("WARN spread", n, round(dmax), "m", len(occ))
    return 0


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "kunming"
    sys.exit(build(target))
