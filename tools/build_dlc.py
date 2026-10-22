# -*- coding: utf-8 -*-
"""把大连周水子国际机场 OSM 数据整理为 3D 场景数据，并生成各级底图。

输出:
    static/data/airport_dlc.json
    static/data/dlc_base.jpg / dlc_base.json      z15 机场细节
    static/data/dlc_region.jpg / dlc_region.json  z14 区域
    static/data/dlc_core.jpg / dlc_core.json      z16 核心区
    static/data/dlc_alpha.png                     核心区渐隐
    static/data/dlc_far.jpg / dlc_far.json        z12 远景观
"""
import json
import math
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_airport as tfu  # noqa: E402  复用分类、多边形、室内示意等工具

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")
OUT_DIR = os.path.join(BASE, "static", "data")

RAW = os.path.join(DATA, "osm_dlc_airport.json")
TERMINALS_RAW = os.path.join(DATA, "osm_dlc_terminals.json")

BASE_BBOX = (38.936, 121.480, 38.996, 121.600)    # z15
BASE_ZOOM = 15
REGION_BBOX = (38.860, 121.400, 39.085, 121.700)  # z14
REGION_ZOOM = 14
CORE_BBOX = (38.945, 121.505, 38.988, 121.580)    # z16
CORE_ZOOM = 16
FAR_BBOX = (38.700, 121.150, 39.250, 121.950)     # z12
FAR_ZOOM = 12

BG = (232, 238, 243)
UA = "TransitFacilityAtlas/1.0 (local research tool)"
# 优先用德国镜像（本地网络下更稳定），失败再回退官方瓦片
TILE_HOSTS = [
    "https://tile.openstreetmap.de/{z}/{x}/{y}.png",
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
]

META = {
    "name": "大连周水子国际机场",
    "name_en": "Dalian Zhoushuizi International Airport",
    "iata": "DLC",
    "icao": "ZYTL",
    "city": "大连",
    "opened": "1927",
    "center": [38.9657, 121.5386],
    "runway_spec": "单跑道 10/28 · 3300 m × 45 m",
    "terminal_area": "T1 约 5.6 万㎡",
    "source": "OpenStreetMap",
}


def deg2num(lat, lon, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    lat_r = math.radians(lat)
    y = (1.0 - math.log(math.tan(lat_r) + 1.0 / math.cos(lat_r)) / math.pi) / 2.0 * n
    return x, y


def fetch_tile(z, tx, ty):
    from PIL import Image
    for host in TILE_HOSTS:
        url = host.format(z=z, x=tx, y=ty)
        for attempt in range(2):
            try:
                req = urllib.request.Request(url, headers={
                    "User-Agent": UA, "Accept": "image/png",
                })
                with urllib.request.urlopen(req, timeout=12) as resp:
                    return Image.open(resp).convert("RGB")
            except Exception:  # noqa: BLE001
                time.sleep(0.6)
    return None


def build_basemap(name, bbox, z, quality=85):
    from PIL import Image
    lat_min, lon_min, lat_max, lon_max = bbox
    x0f, y0f = deg2num(lat_max, lon_min, z)
    x1f, y1f = deg2num(lat_min, lon_max, z)
    x0, y0 = int(math.floor(x0f)), int(math.floor(y0f))
    x1, y1 = int(math.floor(x1f)), int(math.floor(y1f))
    w, h = x1 - x0 + 1, y1 - y0 + 1
    print(f"{name}: {w}x{h} tiles z{z}")
    canvas = Image.new("RGB", (w * 256, h * 256), BG)
    failed = []
    ok = 0
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            tile = fetch_tile(z, tx, ty)
            if tile is None:
                failed.append((tx, ty))
                continue
            canvas.paste(tile, ((tx - x0) * 256, (ty - y0) * 256))
            ok += 1
            time.sleep(0.02)
    for attempt in range(3):
        if not failed:
            break
        rest = []
        for tx, ty in failed:
            tile = fetch_tile(z, tx, ty)
            if tile is None:
                rest.append((tx, ty))
                continue
            canvas.paste(tile, ((tx - x0) * 256, (ty - y0) * 256))
            ok += 1
        failed = rest
        time.sleep(1.0)
    jpg = os.path.join(OUT_DIR, f"{name}.jpg")
    canvas.save(jpg, quality=quality, optimize=True)
    with open(os.path.join(OUT_DIR, f"{name}.json"), "w", encoding="utf-8") as f:
        json.dump({
            "zoom": z, "x0": x0, "y0": y0, "x1": x1, "y1": y1,
            "bbox": list(bbox), "size": [w * 256, h * 256],
            "ok_tiles": ok, "source": "OpenStreetMap",
        }, f)
    print(f"  -> {jpg} {os.path.getsize(jpg) // 1024} KB, missed {len(failed)}")


def build_core_alpha():
    from PIL import Image
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
    alpha.save(os.path.join(OUT_DIR, "dlc_alpha.png"))


def meter(a, b):
    return math.hypot((b[1] - a[1]) * 111320.0 * math.cos(math.radians(38.96)),
                      (b[0] - a[0]) * 111320.0)


def merge_runways(runways):
    """OSM 常把一条跑道拆成多段，按 ref 串成一条，避免重复绘制。"""
    groups = {}
    for rw in runways:
        groups.setdefault(rw["ref"] or "RWY", []).append(rw)

    merged = []
    for ref, segs in groups.items():
        segs = sorted(segs, key=lambda s: -len(s["points"]))
        chains = []
        for seg in segs:
            pts = list(seg["points"])
            placed = False
            for ch in chains:
                if meter(ch[-1], pts[0]) < 40:
                    ch.extend(pts[1:])
                    placed = True
                    break
                if meter(ch[-1], pts[-1]) < 40:
                    ch.extend(list(reversed(pts))[1:])
                    placed = True
                    break
                if meter(ch[0], pts[-1]) < 40:
                    ch[:0] = pts[:-1]
                    placed = True
                    break
                if meter(ch[0], pts[0]) < 40:
                    ch[:0] = list(reversed(pts))[:-1]
                    placed = True
                    break
            if not placed:
                chains.append(pts)
        chains.sort(key=lambda c: -len(c))
        for ch in chains:
            if len(ch) < 2:
                continue
            item = dict(segs[0])
            item["points"] = ch
            item["length_m"] = round(sum(meter(ch[i - 1], ch[i]) for i in range(1, len(ch))))
            merged.append(item)
    merged.sort(key=lambda r: -r.get("length_m", 0))
    return merged


def build_transit():
    net = json.load(open(os.path.join(DATA, "network_dalian.json"), encoding="utf-8"))
    lat_min, lon_min, lat_max, lon_max = 38.930, 121.470, 39.000, 121.610

    def inside(p):
        return lat_min <= p[0] <= lat_max and lon_min <= p[1] <= lon_max

    metro = []
    for line in net["lines"]:
        if line["ref"] != "2":
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
        if inside([s["lat"], s["lon"]]) and "2" in s["lines"]:
            stations.append({
                "name": s["name"], "type": "metro",
                "lat": s["lat"], "lon": s["lon"], "lines": s["lines"],
            })

    rail = []
    rail_path = os.path.join(DATA, "osm_dlc_rail.json")
    if os.path.exists(rail_path):
        raw = json.load(open(rail_path, encoding="utf-8"))
        for e in raw.get("elements", []):
            t = e.get("tags", {})
            if t.get("railway") != "rail" or t.get("service"):
                continue
            pts = [[round(p["lat"], 6), round(p["lon"], 6)]
                   for p in (e.get("geometry") or []) if inside([p["lat"], p["lon"]])]
            if len(pts) > 1:
                rail.append(pts)

    nodes = []
    node_path = os.path.join(DATA, "osm_dlc_transit.json")
    if os.path.exists(node_path):
        raw = json.load(open(node_path, encoding="utf-8"))
        for e in raw.get("elements", []):
            if "lat" not in e:
                continue
            t = e.get("tags", {})
            kind = None
            if t.get("railway") == "subway_entrance":
                kind = "entrance"
            elif t.get("railway") == "station" and t.get("subway") == "yes":
                kind = "metro"
            elif t.get("railway") == "station":
                kind = "rail"
            elif t.get("amenity") == "bus_station":
                kind = "bus"
            if not kind:
                continue
            # 出入口与公交站只在机场周边 3 km 内建模，避免城市要素淹没机场
            if kind in ("entrance", "bus"):
                if abs(e["lat"] - 38.9657) > 0.028 or abs(e["lon"] - 121.5386) > 0.035:
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


def main():
    raw = json.load(open(RAW, encoding="utf-8"))
    els = raw.get("elements", [])
    runways, taxiways, aprons, gates, stands = [], [], [], [], []
    terminals = []
    seen_terminal = set()

    term_raw = json.load(open(TERMINALS_RAW, encoding="utf-8"))
    for rel in term_raw.get("elements", []):
        if rel.get("type") != "relation":
            continue
        t = rel.get("tags", {})
        if t.get("aeroway") != "terminal" and t.get("building") not in ("transportation", "parking"):
            continue
        polys = tfu.relation_polygons(rel)
        if not polys:
            continue
        name = (t.get("name") or "").strip() or "T1 航站楼"
        terminals.append({
            "id": rel["id"],
            "name": name,
            "kind": "terminal",
            "height": 26.0,
            "polygons": [[[round(a, 7), round(b, 7)] for a, b in poly] for poly in polys],
        })
        seen_terminal.add(rel["id"])

    for el in els:
        kind = tfu.classify(el)
        if not kind:
            continue
        t = el.get("tags", {})
        if kind in ("gate", "stand"):
            if "lat" in el:
                lat, lon = el["lat"], el["lon"]
            elif el.get("geometry"):
                g = el["geometry"]
                lat = sum(p["lat"] for p in g) / len(g)
                lon = sum(p["lon"] for p in g) / len(g)
            else:
                continue
            item = {
                "id": el["id"],
                "ref": t.get("ref") or t.get("name") or "",
                "lat": round(lat, 7),
                "lon": round(lon, 7),
            }
            if kind == "gate":
                item["width"] = tfu.num(t.get("width")) or 8.0
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
                "width": tfu.num(t.get("width")) or 45.0,
                "surface": t.get("surface", ""),
                "closed": False,
                "points": [[round(a, 7), round(b, 7)] for a, b in pts],
            })
        elif kind == "taxiway":
            taxiways.append({
                "id": el["id"],
                "ref": t.get("ref") or "",
                "width": tfu.num(t.get("width")) or 20.0,
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
            terminals.append({
                "id": el["id"],
                "name": t.get("name") or "T1 航站楼",
                "kind": "terminal",
                "height": 26.0,
                "polygons": [[[round(a, 7), round(b, 7)] for a, b in pts]],
            })

    runways = merge_runways(runways)
    terminals = [
        x for x in terminals if any(tfu.poly_area(p) > 1e-7 for p in x["polygons"])
    ]
    # 老航站楼按配套建筑处理，避免与现用 T1 混淆
    for t in terminals:
        n = (t["name"] or "").lower()
        if "old terminal" in n or "旧航站楼" in n:
            t["name"] = "旧航站楼"
            t["kind"] = "support"
            t["height"] = 18.0

    meta = dict(META)
    meta.update({
        "runway_count": len(runways),
        "terminal_count": len([t for t in terminals if t["kind"] == "terminal"]),
        "gate_count": len(gates),
        "stand_count": len(stands),
    })

    network = {
        "meta": meta,
        "runways": runways,
        "taxiways": taxiways,
        "aprons": aprons,
        "terminals": terminals,
        "gates": gates,
        "stands": stands,
        "interior": tfu.build_interior(terminals),
        "transit": build_transit(),
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "airport_dlc.json"), "w", encoding="utf-8") as f:
        json.dump(network, f, ensure_ascii=False, separators=(",", ":"))

    print(f"runways={len(runways)} taxiways={len(taxiways)} aprons={len(aprons)} "
          f"terminals={len(terminals)} gates={len(gates)} stands={len(stands)}")
    for rw in runways:
        print("  runway", rw["ref"], rw.get("length_m"), "m", rw["width"])

    if "no-basemap" not in sys.argv:
        build_basemap("dlc_base", BASE_BBOX, BASE_ZOOM, 88)
        build_basemap("dlc_region", REGION_BBOX, REGION_ZOOM, 84)
        build_basemap("dlc_core", CORE_BBOX, CORE_ZOOM, 90)
        build_basemap("dlc_far", FAR_BBOX, FAR_ZOOM, 80)
        build_core_alpha()


if __name__ == "__main__":
    main()
