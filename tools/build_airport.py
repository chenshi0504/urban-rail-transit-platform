# -*- coding: utf-8 -*-
"""把天府机场 OSM 航空要素整理为 3D 场景数据，并拼接 OSM 底图纹理。

输出:
    static/data/airport_tfu.json
    static/data/tfu_base.jpg
"""
import json
import math
import os
import time
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")
OUT_DIR = os.path.join(BASE, "static", "data")
RAW = os.path.join(DATA, "osm_tfu_airport.json")
TERMINALS_RAW = os.path.join(DATA, "osm_tfu_terminals.json")
OUT = os.path.join(OUT_DIR, "airport_tfu.json")

# 机场细节底图（z15，约 9 × 8 km）；更大范围的区域底图由 build_airport_region.py 生成
BASE_BBOX = (30.272, 104.400, 30.352, 104.496)
ZOOM = 15

# 核心区高清底图（叠加在外围底图之上，边缘径向渐隐）
CORE_BBOX = (30.288, 104.405, 30.342, 104.482)
CORE_ZOOM = 16


def num(v):
    try:
        return float(str(v).replace("m", "").strip())
    except (TypeError, ValueError):
        return None


def is_closed(points):
    return len(points) > 3 and points[0] == points[-1]


def poly_area(points):
    a = 0.0
    for i in range(len(points) - 1):
        lat1, lon1 = points[i]
        lat2, lon2 = points[i + 1]
        a += (lon1 * lat2 - lon2 * lat1)
    return abs(a) / 2


def classify(el):
    t = el.get("tags", {})
    aero = t.get("aeroway", "")
    building = t.get("building", "")
    name = (t.get("name") or "").strip()
    if aero == "runway":
        return "runway"
    if aero == "taxiway":
        return "taxiway"
    if aero == "apron":
        return "apron"
    if aero == "terminal" or building == "terminal":
        return "terminal"
    if aero == "gate":
        return "gate"
    if aero == "parking_position":
        return "stand"
    return None


def terminal_height(name):
    n = (name or "").upper()
    if "T1" in n or "T2" in n or "航站楼" in n:
        return 42.0
    if "GTC" in n or "换乘" in n:
        return 24.0
    if "停车" in n:
        return 15.0
    if "酒店" in n:
        return 45.0
    return 24.0


def relation_polygons(rel):
    """把 multipolygon relation 的 outer way 拼成闭合多边形。"""
    segs = []
    for m in rel.get("members", []):
        if m["type"] != "way" or m.get("role") != "outer" or not m.get("geometry"):
            continue
        pts = [(p["lat"], p["lon"]) for p in m["geometry"]]
        if len(pts) >= 2:
            segs.append(pts)
    chains = []
    for seg in segs:
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
    polys = []
    for ch in chains:
        if len(ch) < 3:
            continue
        if ch[0] != ch[-1]:
            ch.append(ch[0])
        polys.append(ch[:-1])
    return polys


def load_terminal_relations():
    if not os.path.exists(TERMINALS_RAW):
        return []
    raw = json.load(open(TERMINALS_RAW, encoding="utf-8"))
    out = []
    for rel in raw.get("elements", []):
        if rel.get("type") != "relation":
            continue
        t = rel.get("tags", {})
        name = (t.get("name") or "").strip()
        aero = t.get("aeroway", "")
        building = t.get("building", "")
        if aero != "terminal" and building not in ("transportation", "parking", "hotel", "yes"):
            continue
        polys = relation_polygons(rel)
        if not polys:
            continue
        kind = "terminal"
        if "换乘" in name or "GTC" in name.upper():
            kind = "gtc"
        elif building == "parking" or "停车" in name:
            kind = "parking"
        elif "酒店" in name:
            kind = "hotel"
        elif aero != "terminal":
            kind = "support"
        out.append({
            "id": rel["id"],
            "name": name or ("航站楼" if aero == "terminal" else "配套建筑"),
            "kind": kind,
            "height": terminal_height(name),
            "polygons": [[[round(a, 7), round(b, 7)] for a, b in poly] for poly in polys],
        })
    out.sort(key=lambda x: (x["kind"] != "terminal", -sum(len(p) for p in x["polygons"])))
    return out


M_PER_DEG = 111320.0


def to_xy(p, lat0, lon0):
    return ((p[1] - lon0) * M_PER_DEG * math.cos(math.radians(lat0)),
            -(p[0] - lat0) * M_PER_DEG)


def to_ll(x, z, lat0, lon0):
    return [round(lat0 - z / M_PER_DEG, 7),
            round(lon0 + x / (M_PER_DEG * math.cos(math.radians(lat0))), 7)]


def poly_xy(poly, lat0, lon0):
    return [to_xy(p, lat0, lon0) for p in poly]


def area_xy(pts):
    a = 0.0
    for i in range(len(pts)):
        x1, z1 = pts[i]
        x2, z2 = pts[(i + 1) % len(pts)]
        a += x1 * z2 - x2 * z1
    return abs(a) / 2


def centroid_xy(pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def scale_xy(pts, c, k):
    return [(c[0] + (x - c[0]) * k, c[1] + (z - c[1]) * k) for x, z in pts]


def circle_xy(c, r, n=28):
    return [(c[0] + r * math.cos(2 * math.pi * i / n),
             c[1] + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def rect_xy(c, u, length, width):
    ux, uz = u
    vx, vz = -uz, ux
    hl, hw = length / 2, width / 2
    return [
        (c[0] + ux * hl + vx * hw, c[1] + uz * hl + vz * hw),
        (c[0] + ux * hl - vx * hw, c[1] + uz * hl - vz * hw),
        (c[0] - ux * hl - vx * hw, c[1] - uz * hl - vz * hw),
        (c[0] - ux * hl + vx * hw, c[1] - uz * hl + vz * hw),
    ]


def principal_axis(pts):
    cx, cz = centroid_xy(pts)
    sxx = sum((x - cx) ** 2 for x, z in pts)
    szz = sum((z - cz) ** 2 for x, z in pts)
    sxz = sum((x - cx) * (z - cz) for x, z in pts)
    th = 0.5 * math.atan2(2 * sxz, sxx - szz)
    return (math.cos(th), math.sin(th))


def convex_hull(points):
    pts = sorted(set(points))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def sample_closed(pts, n):
    segs = []
    total = 0.0
    for i in range(len(pts)):
        a = pts[i]
        b = pts[(i + 1) % len(pts)]
        d = math.hypot(b[0] - a[0], b[1] - a[1])
        segs.append((a, b, d, total))
        total += d
    out = []
    for k in range(n):
        target = total * k / n
        for idx, (a, b, d, start) in enumerate(segs):
            if target <= start + d or idx == len(segs) - 1:
                r = (target - start) / d if d else 0
                out.append((a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r))
                break
    return out


def build_interior(terminals):
    """基于航站楼真实轮廓生成示意性内部功能分区（OSM 无室内数据）。"""
    out = []
    for t in terminals:
        if t.get("kind") != "terminal":
            continue
        poly = t["polygons"][0]
        lat0 = sum(p[0] for p in poly) / len(poly)
        lon0 = sum(p[1] for p in poly) / len(poly)
        pts = poly_xy(poly, lat0, lon0)
        radius = math.sqrt(area_xy(pts) / math.pi)
        c = centroid_xy(pts)
        u = principal_axis(pts)
        hull = convex_hull(pts)
        base = scale_xy(hull, c, 0.985)
        inner = scale_xy(hull, c, 0.84)
        inner2 = scale_xy(hull, c, 0.78)

        islands = []
        for i in (-1, 0, 1):
            ic = (c[0] + u[0] * i * radius * 0.17, c[1] + u[1] * i * radius * 0.17)
            islands.append(rect_xy(ic, u, radius * 0.62, radius * 0.055))
        security = []
        for i in range(8):
            ang = 2 * math.pi * i / 8
            d = (math.cos(ang), math.sin(ang))
            sc = (c[0] + d[0] * radius * 0.34, c[1] + d[1] * radius * 0.34)
            security.append(rect_xy(sc, (-d[1], d[0]), radius * 0.11, radius * 0.035))
        carousels = []
        for i in (-1, 0, 1):
            cc = (c[0] + u[0] * i * radius * 0.22, c[1] + u[1] * i * radius * 0.22)
            carousels.append({
                "center": to_ll(cc[0], cc[1], lat0, lon0),
                "radius": round(radius * 0.055, 1),
            })

        def ll(rows):
            return [[to_ll(x, z, lat0, lon0) for x, z in row] for row in rows]

        out.append({
            "id": t["id"],
            "name": t["name"],
            "center": [round(lat0, 7), round(lon0, 7)],
            "radius": round(radius, 1),
            "levels": [
                {
                    "name": "L1 到达层", "y": 1.6,
                    "zones": [
                        {"name": "迎客大厅", "kind": "meet", "color": "#dfeefa",
                         "polygon": [to_ll(x, z, lat0, lon0) for x, z in base]},
                        {"name": "行李提取", "kind": "baggage", "color": "#9fcbea",
                         "polygon": [to_ll(x, z, lat0, lon0) for x, z in circle_xy(c, radius * 0.26)]},
                        {"name": "中转区", "kind": "transfer", "color": "#bfe0d6",
                         "polygon": [to_ll(x, z, lat0, lon0) for x, z in circle_xy(
                             (c[0] + u[0] * radius * 0.3, c[1] + u[1] * radius * 0.3), radius * 0.1)]},
                    ],
                    "islands": [], "security": [], "gates": [],
                    "carousels": carousels,
                },
                {
                    "name": "L2 出发层", "y": 9.2,
                    "zones": [
                        {"name": "候机区", "kind": "waiting", "color": "#e8f2fc",
                         "polygon": [to_ll(x, z, lat0, lon0) for x, z in inner]},
                        {"name": "值机大厅", "kind": "checkin", "color": "#c9e1fa",
                         "polygon": [to_ll(x, z, lat0, lon0) for x, z in circle_xy(c, radius * 0.3)]},
                        {"name": "安检区", "kind": "security", "color": "#ffe2c2",
                         "polygon": [to_ll(x, z, lat0, lon0) for x, z in circle_xy(c, radius * 0.36)]},
                    ],
                    "islands": ll(islands),
                    "security": ll(security),
                    "gates": [to_ll(x, z, lat0, lon0) for x, z in sample_closed(inner2, 26)],
                    "carousels": [],
                },
            ],
        })
    return out


def build_transit():
    net = json.load(open(os.path.join(DATA, "network.json"), encoding="utf-8"))
    lat_min, lon_min, lat_max, lon_max = 30.265, 104.365, 30.375, 104.525

    def inside(p):
        return lat_min <= p[0] <= lat_max and lon_min <= p[1] <= lon_max

    metro = []
    for line in net["lines"]:
        if line["ref"] not in ("18", "19"):
            continue
        segs = []
        for chain in line["shape"]:
            cur = []
            for p in chain:
                if inside(p):
                    cur.append([round(p[0], 6), round(p[1], 6)])
                else:
                    if len(cur) > 1:
                        segs.append(cur)
                    cur = []
            if len(cur) > 1:
                segs.append(cur)
        metro.append({
            "ref": line["ref"], "name": line["name"],
            "color": line["color"], "segments": segs,
        })

    stations = []
    for s in net["stations"]:
        if inside([s["lat"], s["lon"]]) and set(s["lines"]) & {"18", "19"}:
            stations.append({
                "name": s["name"], "type": "metro",
                "lat": s["lat"], "lon": s["lon"], "lines": s["lines"],
            })

    rail = []
    rail_path = os.path.join(DATA, "osm_tfu_rail.json")
    if os.path.exists(rail_path):
        raw = json.load(open(rail_path, encoding="utf-8"))
        for e in raw.get("elements", []):
            t = e.get("tags", {})
            if t.get("railway") != "rail":
                continue
            pts = [[round(p["lat"], 6), round(p["lon"], 6)]
                   for p in (e.get("geometry") or []) if inside([p["lat"], p["lon"]])]
            if len(pts) > 1:
                rail.append(pts)

    nodes = []
    node_path = os.path.join(DATA, "osm_tfu_transit.json")
    if os.path.exists(node_path):
        raw = json.load(open(node_path, encoding="utf-8"))
        els = raw if isinstance(raw, list) else raw.get("elements", [])
        for e in els:
            if "lat" not in e:
                continue
            t = e.get("tags", {})
            kind = None
            if t.get("railway") == "subway_entrance":
                kind = "entrance"
            elif t.get("train") == "yes":
                kind = "rail"
            elif t.get("railway") == "station" and t.get("subway") == "yes":
                kind = "metro"
            elif t.get("highway") == "bus_stop" or t.get("amenity") == "bus_station":
                kind = "bus"
            if not kind:
                continue
            nodes.append({
                "name": t.get("name") or "", "type": kind,
                "lat": round(e["lat"], 7), "lon": round(e["lon"], 7),
            })

    grouped = []
    for n in stations + nodes:
        dup = False
        for g in grouped:
            if (g["name"] == n["name"]
                    and abs(g["lat"] - n["lat"]) < 0.0009
                    and abs(g["lon"] - n["lon"]) < 0.0009):
                dup = True
                break
        if not dup:
            grouped.append(n)

    return {"metro": metro, "rail": rail, "stations": grouped}


def build_core_basemap():
    from PIL import Image
    existing = os.path.join(OUT_DIR, "tfu_core.jpg")
    if os.path.exists(existing) and os.path.getsize(existing) > 100000:
        print("core basemap exists, skip download")
        return
    lat_min, lon_min, lat_max, lon_max = CORE_BBOX
    x0f, y0f = deg2num(lat_max, lon_min, CORE_ZOOM)
    x1f, y1f = deg2num(lat_min, lon_max, CORE_ZOOM)
    x0, y0 = int(math.floor(x0f)), int(math.floor(y0f))
    x1, y1 = int(math.floor(x1f)), int(math.floor(y1f))
    w, h = x1 - x0 + 1, y1 - y0 + 1
    print(f"core basemap tiles {w}x{h} z{CORE_ZOOM} -> {w*256}x{h*256}")
    canvas = Image.new("RGB", (w * 256, h * 256), (238, 242, 246))
    ok = 0
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            url = f"https://tile.openstreetmap.org/{CORE_ZOOM}/{tx}/{ty}.png"
            for attempt in range(2):
                try:
                    req = urllib.request.Request(url, headers={
                        "User-Agent": "TransitFacilityAtlas/1.0 (local research)",
                        "Accept": "image/png",
                    })
                    with urllib.request.urlopen(req, timeout=30) as resp:
                        tile = Image.open(resp).convert("RGB")
                    canvas.paste(tile, ((tx - x0) * 256, (ty - y0) * 256))
                    ok += 1
                    break
                except Exception:  # noqa: BLE001
                    time.sleep(0.5)
    canvas.save(existing, quality=88, optimize=True)
    with open(os.path.join(OUT_DIR, "tfu_core.json"), "w", encoding="utf-8") as f:
        json.dump({
            "zoom": CORE_ZOOM,
            "x0": x0, "y0": y0, "x1": x1, "y1": y1,
            "size": [w * 256, h * 256],
            "ok_tiles": ok,
        }, f)

    # 径向渐变 alpha，边缘与外围底图融合
    size = 256
    alpha = Image.new("L", (size, size), 0)
    pix = alpha.load()
    for y in range(size):
        for x in range(size):
            dx = (x - size / 2) / (size / 2)
            dy = (y - size / 2) / (size / 2)
            d = math.hypot(dx, dy)
            v = max(0.0, min(1.0, (1.0 - d) / 0.32))
            pix[x, y] = int(v * 255)
    alpha.save(os.path.join(OUT_DIR, "tfu_alpha.png"))
    print("core basemap:", existing, os.path.getsize(existing), "tiles ok", ok, "/", w * h)


def main():
    raw = json.load(open(RAW, encoding="utf-8"))
    els = raw.get("elements", [])
    runways, taxiways, aprons, gates, stands = [], [], [], [], []
    terminals = load_terminal_relations()
    seen_terminal = {t["id"] for t in terminals}

    for el in els:
        kind = classify(el)
        if not kind:
            continue
        t = el.get("tags", {})
        if kind in ("gate", "stand"):
            if "lat" not in el:
                continue
            item = {
                "id": el["id"],
                "ref": t.get("ref") or t.get("name") or "",
                "lat": round(el["lat"], 7),
                "lon": round(el["lon"], 7),
            }
            if kind == "gate":
                item["width"] = num(t.get("width")) or 8.0
                gates.append(item)
            else:
                stands.append(item)
            continue

        geom = el.get("geometry") or []
        if len(geom) < 2:
            continue
        pts = [(p["lat"], p["lon"]) for p in geom]
        if pts[0] == pts[-1]:
            pts = pts[:-1]
        if len(pts) < 2:
            continue

        if kind == "runway":
            runways.append({
                "id": el["id"],
                "ref": t.get("ref") or t.get("name") or "",
                "name": t.get("name") or "",
                "width": num(t.get("width")) or 60.0,
                "surface": t.get("surface", ""),
                "closed": is_closed(geom),
                "points": [[round(a, 7), round(b, 7)] for a, b in pts],
            })
        elif kind == "taxiway":
            taxiways.append({
                "id": el["id"],
                "ref": t.get("ref") or "",
                "width": num(t.get("width")) or 20.0,
                "points": [[round(a, 7), round(b, 7)] for a, b in pts],
            })
        elif kind == "apron":
            if len(pts) < 3:
                continue
            aprons.append({
                "id": el["id"],
                "name": t.get("name") or "",
                "polygon": [[round(a, 7), round(b, 7)] for a, b in pts],
            })
        elif kind == "terminal":
            if el["id"] in seen_terminal or len(pts) < 3:
                continue
            seen_terminal.add(el["id"])
            name = t.get("name") or t.get("ref") or ""
            terminals.append({
                "id": el["id"],
                "name": name,
                "kind": "terminal",
                "height": terminal_height(name),
                "polygons": [[[round(a, 7), round(b, 7)] for a, b in pts]],
            })

    # 面积过小的航站楼碎片丢弃（OSM 中偶有重复轮廓）
    terminals = [
        x for x in terminals
        if any(poly_area(p) > 1e-7 for p in x["polygons"])
    ]

    meta = {
        "name": "成都天府国际机场",
        "name_en": "Chengdu Tianfu International Airport",
        "iata": "TFU",
        "icao": "ZUTF",
        "city": "成都",
        "opened": "2021-06-27",
        "center": [30.3125, 104.4415],
        "runway_count": len(runways),
        "terminal_count": len(terminals),
        "gate_count": len(gates),
        "stand_count": len(stands),
        "runway_spec": "两纵一横 · 4000m/3800m/3200m",
        "terminal_area": "T1 39 万㎡ · T2 32 万㎡",
        "source": "OpenStreetMap",
    }
    interior = build_interior(terminals)
    transit = build_transit()
    network = {
        "meta": meta,
        "runways": runways,
        "taxiways": taxiways,
        "aprons": aprons,
        "terminals": terminals,
        "gates": gates,
        "stands": stands,
        "interior": interior,
        "transit": transit,
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(network, f, ensure_ascii=False, separators=(",", ":"))

    print(f"runways={len(runways)} taxiways={len(taxiways)} aprons={len(aprons)} "
          f"terminals={len(terminals)} gates={len(gates)} stands={len(stands)}")
    for r in runways:
        print("  runway", r["ref"], r["width"], "m", r["points"][0], "->", r["points"][-1])
    for t in terminals[:10]:
        print("  terminal", t["name"], t["kind"], "height", t["height"],
              "polys", len(t["polygons"]), "pts", sum(len(p) for p in t["polygons"]))

    build_basemap()
    build_core_basemap()
    print("size:", os.path.getsize(OUT), "bytes")


def deg2num(lat, lon, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    lat_r = math.radians(lat)
    y = (1.0 - math.log(math.tan(lat_r) + 1.0 / math.cos(lat_r)) / math.pi) / 2.0 * n
    return x, y


def build_basemap():
    from PIL import Image
    existing = os.path.join(OUT_DIR, "tfu_base.jpg")
    if os.path.exists(existing) and os.path.getsize(existing) > 100000:
        print("basemap exists, skip download")
        return
    lat_min, lon_min, lat_max, lon_max = BASE_BBOX
    x0f, y0f = deg2num(lat_max, lon_min, ZOOM)
    x1f, y1f = deg2num(lat_min, lon_max, ZOOM)
    x0, y0 = int(math.floor(x0f)), int(math.floor(y0f))
    x1, y1 = int(math.floor(x1f)), int(math.floor(y1f))
    w, h = x1 - x0 + 1, y1 - y0 + 1
    print(f"basemap tiles {w}x{h} z{ZOOM} -> {w*256}x{h*256}")
    canvas = Image.new("RGB", (w * 256, h * 256), (238, 242, 246))
    ok = 0
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            url = f"https://tile.openstreetmap.org/{ZOOM}/{tx}/{ty}.png"
            for attempt in range(2):
                try:
                    req = urllib.request.Request(url, headers={
                        "User-Agent": "TransitFacilityAtlas/1.0 (local research)",
                        "Accept": "image/png",
                    })
                    with urllib.request.urlopen(req, timeout=30) as resp:
                        tile = Image.open(resp).convert("RGB")
                    canvas.paste(tile, ((tx - x0) * 256, (ty - y0) * 256))
                    ok += 1
                    break
                except Exception:  # noqa: BLE001
                    time.sleep(0.6)
    out = os.path.join(OUT_DIR, "tfu_base.jpg")
    canvas.save(out, quality=84, optimize=True)
    # 记录底图与经纬度的映射，供前端贴图对齐
    meta_path = os.path.join(OUT_DIR, "tfu_base.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump({
            "zoom": ZOOM,
            "x0": x0, "y0": y0, "x1": x1, "y1": y1,
            "bbox": [lat_min, lon_min, lat_max, lon_max],
            "tile_range": [[x0f, y0f], [x1f, y1f]],
            "size": [w * 256, h * 256],
            "ok_tiles": ok,
        }, f)
    print("basemap:", out, os.path.getsize(out), "bytes", "tiles ok", ok, "/", w * h)


if __name__ == "__main__":
    main()
