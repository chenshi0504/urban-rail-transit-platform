# -*- coding: utf-8 -*-
"""把 OSM 原始线路/站点数据整理为前端可直接消费的线网数据。

- 合并上下行关系、抽取主线站点顺序
- 1 号线支线单独标注
- 补齐 OSM 线路关系中缺失的站点（30 号线 6 站、6 号线芦角、27 号线白仁店）
- 计算换乘站、邻近车站、去重站点
"""
import json
import math
import os
import sys
from collections import Counter, defaultdict

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")
OUT = os.path.join(DATA, "network.json")

RAW = json.load(open(os.path.join(DATA, "osm_chengdu_subway.json"), encoding="utf-8"))
STOP_RAW = json.load(open(os.path.join(DATA, "osm_chengdu_stops.json"), encoding="utf-8"))
STOPS = {e["id"]: e for e in STOP_RAW["elements"]}
RELATIONS = {e["id"]: e for e in RAW["elements"]}

LINES = [
    dict(ref="1", main=8297247, branch=[2381768], length=41.0, opened="2010-09-27",
         from_="韦家碾", to="科学城", color=None,
         note="成都首条地铁，贯穿南北中轴线；含四河—五根松支线。"),
    dict(ref="2", main=2474349, length=42.0, opened="2012-09-16",
         from_="犀浦", to="龙泉驿", color=None,
         note="东西向骨干线，串联犀浦、春熙路、成都东客站与龙泉驿。"),
    dict(ref="3", main=6517083, length=50.0, opened="2016-07-31",
         from_="成都医学院", to="双流西站", color=None,
         note="南北向骨干线，连接新都、市中心与双流。"),
    dict(ref="4", main=6385133, length=43.0, opened="2015-12-26",
         from_="万盛", to="西河", color=None,
         note="东西向骨干线，串联温江、宽窄巷子、成都东客站与西河。"),
    dict(ref="5", main=9627905, length=49.0, opened="2019-12-27",
         from_="华桂路", to="回龙", color=None,
         note="南北向干线，贯穿新都、市中心、金融城与大源。"),
    dict(ref="6", main=9627850, length=68.76, opened="2020-12-18",
         from_="望丛祠", to="兰家沟", color=None,
         note="全国单线车站数最多的地铁线路之一；芦角站于 2025 年 8 月启用。"),
    dict(ref="7", main=7913593, length=39.0, opened="2017-12-06",
         from_="环线", to="环线", color=None, loop=True,
         note="成都首条环线，分内环、外环双向运营，环绕二环至三环之间。"),
    dict(ref="8", main=9761272, length=36.71, opened="2020-12-18",
         from_="桂龙路", to="龙港", color=None,
         note="西南—东北向干线；二期于 2024 年 12 月开通。"),
    dict(ref="9", main=9627519, length=22.0, opened="2020-12-18",
         from_="金融城东", to="黄田坝", color=None,
         note="首期开通西南半环，规划为完整环线。"),
    dict(ref="10", main=7913594, length=41.54, opened="2017-09-06",
         from_="武侯祠", to="新平", color=None,
         note="连接市中心、双流机场与新津的市域快线；文翁石室、人民公园两站暂缓开通。"),
    dict(ref="13", main=11528274, length=29.07, opened="2025-12-16",
         from_="龙安", to="瓦窑滩", color=None,
         note="2025 年 12 月开通的全自动运行快线，横贯中心城区。"),
    dict(ref="17", main=9851799, length=31.47, opened="2020-12-18",
         from_="九江北", to="高洪", color=None,
         note="西部横向快线；二期于 2025 年 9 月开通。"),
    dict(ref="18", main=9869750, length=66.83, opened="2020-09-27",
         from_="火车南站", to="天府机场北", color=None,
         note="连接火车南站、天府新区与天府国际机场的市域快线，另开行大站快车；天府站—天府机场北与 19 号线共线。"),
    dict(ref="19", main=16764492, length=100.59, opened="2020-12-18",
         from_="金星", to="天府机场北", color=None,
         note="连接温江、双流机场与天府新区；部分车次贯通至天府机场北，与 18 号线共线运营。"),
    dict(ref="27", main=12123402, length=24.86, opened="2024-12-19",
         from_="石佛", to="蜀鑫路", color=None,
         note="北部横向线路，串联新都、金牛与青羊；白仁店站暂缓开通。"),
    dict(ref="30", main=19970753, length=27.96, opened="2025-12-16",
         from_="龙泉驿火车站南", to="双流机场2航站楼东", color=None,
         note="2025 年 12 月开通的南部横向线路；玉虹路、分水两站暂缓开通。"),
    dict(ref="S3", main=11516374, length=38.7, opened="2024-09-29",
         from_="福田", to="资阳北站", color=None,
         note="成都都市圈市域铁路，连接天府新区福田与资阳北站；芦葭为预留站。"),
]

LINE_NAME = {c["ref"]: ("资阳线" if c["ref"] == "S3" else f'{c["ref"]}号线') for c in LINES}

EXTRA_COORDS = {
    "府城桥": (30.5912769, 104.0731875, "Fuchengqiao"),
    "金融城北": (30.5910068, 104.0672093, "Financial City North"),
    "益州大道": (30.5910484, 104.0579647, "Yizhou Avenue"),
    "新园大道": (30.5904794, 104.0372783, "Xinyuan Avenue"),
    "石羊东": (30.586455, 104.0306541, "Shiyang East"),
    "大同": (30.5752522, 104.0146206, "Datong"),
    "芦角": (30.4341, 104.0353, "Lujiao"),
    "白仁店": (30.7432, 104.0904, "Bairendian"),
}

# 在指定站之后插入（按顺序）
EXTRAS = {
    "6": [("芦角", "松林")],
    "27": [("白仁店", "鲤鱼湾")],
    "30": [
        ("府城桥", "金石路"), ("金融城北", "府城桥"), ("益州大道", "金融城北"),
        ("新园大道", "市一医院"), ("石羊东", "新园大道"), ("大同", "石羊东"),
    ],
}

SUSPENDED = {"30": {"玉虹路", "分水"}, "27": {"白仁店"}}


def stop_name(node_id):
    node = STOPS.get(node_id)
    if not node:
        return None
    return node.get("tags", {}).get("name")


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
    # 端点不完全匹配时，按首站到起点/终点的最近距离判断
    def idx(name):
        return names.index(name) if name in names else None
    i, j = idx(from_), idx(to)
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
    station_occ = defaultdict(list)  # name -> [(lat, lon)]
    station_en = defaultdict(Counter)
    station_lines = defaultdict(set)
    line_objects = []

    for cfg in LINES:
        ref = cfg["ref"]
        rel = RELATIONS[cfg["main"]]
        color = (rel.get("tags", {}).get("colour") or "#888888").upper()
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
        # 支线只取与支线独有车站相连的轨道，避免把共线区段重复绘制
        for br in branches:
            brel = None
            for bid in cfg.get("branch", []):
                if any(n in relation_stops(RELATIONS[bid]) for n in br["stations"]):
                    brel = RELATIONS[bid]
                    break
            if not brel:
                continue
            anchors = br["stations"]
            anchor_pts = []
            for m in brel.get("members", []):
                if m["type"] == "node" and str(m.get("role", "")).startswith("stop"):
                    node = STOPS.get(m["ref"])
                    if node and node.get("tags", {}).get("name") in anchors:
                        anchor_pts.append((node["lat"], node["lon"]))
            branch_ways = []
            for w in get_ways(brel):
                if any(haversine(p, q) < 350 for p in (w[0], w[-1]) for q in anchor_pts):
                    branch_ways.append(w)
            ways += branch_ways or get_ways(brel)
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
                # 从线路（含支线）关系中取该站的 stop 节点坐标
                found = False
                for rid in rel_ids:
                    for m in RELATIONS[rid].get("members", []):
                        if m["type"] == "node" and str(m.get("role", "")).startswith("stop"):
                            node = STOPS.get(m["ref"])
                            if node and node.get("tags", {}).get("name") == n:
                                station_occ[n].append((node["lat"], node["lon"]))
                                en = node.get("tags", {}).get("name:en")
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

    # 出站换乘 / 邻近车站
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
            "city": "成都",
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

    # 诊断
    names = {s["name"] for s in stations}
    for cfg in LINES:
        missing = [n for n in (cfg["from_"], cfg["to"]) if n not in names]
        if missing:
            print("WARN missing terminus", cfg["ref"], missing)
    for n, occ in station_occ.items():
        if len(occ) > 1:
            dmax = max(haversine(occ[i], occ[j]) for i in range(len(occ)) for j in range(i + 1, len(occ)))
            if dmax > 800:
                print("WARN spread", n, round(dmax), "m", len(occ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
