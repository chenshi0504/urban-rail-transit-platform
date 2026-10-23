# -*- coding: utf-8 -*-
"""轨道交通平台 · 本地服务

开放城市：成都、大连、重庆、昆明、贵阳。Flask + SQLite，首次启动时从各城市
network JSON 建库。
"""
import base64
import json
import os
import sqlite3
import urllib.request
from flask import Flask, Response, jsonify, render_template, request, send_file

BASE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "8007"))

CITIES = {
    "chengdu": {
        "name": "成都",
        "db": os.path.join(BASE, "chengdu_metro.db"),
        "network": os.path.join(BASE, "data", "network.json"),
        "terrain": os.path.join(BASE, "data", "terrain_labels.json"),
        "operator": "成都轨道集团",
    },
    "dalian": {
        "name": "大连",
        "db": os.path.join(BASE, "dalian_metro.db"),
        "network": os.path.join(BASE, "data", "network_dalian.json"),
        "terrain": os.path.join(BASE, "data", "terrain_labels_dalian.json"),
        "operator": "大连地铁",
    },
    "chongqing": {
        "name": "重庆",
        "db": os.path.join(BASE, "chongqing_metro.db"),
        "network": os.path.join(BASE, "data", "network_chongqing.json"),
        "terrain": os.path.join(BASE, "data", "terrain_labels_chongqing.json"),
        "operator": "重庆轨道交通",
    },
    "kunming": {
        "name": "昆明",
        "db": os.path.join(BASE, "kunming_metro.db"),
        "network": os.path.join(BASE, "data", "network_kunming.json"),
        "terrain": os.path.join(BASE, "data", "terrain_labels_kunming.json"),
        "operator": "昆明轨道交通",
    },
    "guiyang": {
        "name": "贵阳",
        "db": os.path.join(BASE, "guiyang_metro.db"),
        "network": os.path.join(BASE, "data", "network_guiyang.json"),
        "terrain": os.path.join(BASE, "data", "terrain_labels_guiyang.json"),
        "operator": "贵阳轨道交通",
    },
}
DEFAULT_CITY = "chengdu"

app = Flask(__name__, static_folder="static", template_folder="templates")
if hasattr(app, "json"):
    app.json.ensure_ascii = False

# ---------------------------------------------------------------- 底图瓦片代理
# 本机浏览器受系统代理影响时常常取不到境外瓦片；这里由服务端直接取图并落盘缓存，
# 浏览器只访问 127.0.0.1，稳定且可离线复用。
TILE_DIR = os.path.join(BASE, "static", "tilecache")
# 每个样式给一组候选源，按顺序尝试；{s} 会替换为 a/b/c 子域
TILE_SOURCES = {
    "light": [
        "https://tile.openstreetmap.jp/{z}/{x}/{y}.png",
        "https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png",
    ],
    "terrain": [
        "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
        "https://tile.openstreetmap.jp/{z}/{x}/{y}.png",
    ],
    "standard": [
        "https://tile.openstreetmap.jp/{z}/{x}/{y}.png",
        "https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png",
    ],
    "dark": [
        "https://tile.openstreetmap.jp/{z}/{x}/{y}.png",
        "https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png",
    ],
}
TILE_SUBDOMAINS = "abc"
TILE_UA = "TransitFacilityAtlas/1.0 (local research tool)"
# 关键：Windows 下 urllib 会读系统代理，而本机系统代理对境外瓦片不可用，这里强制直连
TILE_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
BLANK_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


@app.route("/tiles/<style>/<int:z>/<int:x>/<int:y>.png")
def basemap_tile(style, z, x, y):
    sources = TILE_SOURCES.get(style)
    if not sources or not (0 <= z <= 19) or x < 0 or y < 0:
        return Response(BLANK_PNG, mimetype="image/png", status=404)

    path = os.path.join(TILE_DIR, style, str(z), str(x), "%d.png" % y)
    if os.path.exists(path):
        return send_file(path, mimetype="image/png", max_age=86400)

    data = None
    for tpl in sources:
        for sub in TILE_SUBDOMAINS:
            url = (tpl.replace("{s}", sub)
                   .replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y)))
            try:
                req = urllib.request.Request(url, headers={
                    "User-Agent": TILE_UA, "Accept": "image/png",
                })
                with TILE_OPENER.open(req, timeout=8) as resp:
                    data = resp.read()
                if data and len(data) > 100:
                    break
                data = None
            except Exception:  # noqa: BLE001
                data = None
        if data:
            break

    if not data:
        return Response(BLANK_PNG, mimetype="image/png", status=404)

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(data)
    return Response(data, mimetype="image/png",
                    headers={"Cache-Control": "public, max-age=86400"})


def city_key():
    key = (request.args.get("city") or DEFAULT_CITY).strip().lower()
    return key if key in CITIES else DEFAULT_CITY


def get_db(city="chengdu"):
    conn = sqlite3.connect(CITIES[city]["db"])
    conn.row_factory = sqlite3.Row
    return conn


def init_db(city="chengdu"):
    cfg = CITIES[city]
    network_path = cfg["network"]
    if not os.path.exists(network_path):
        print(f"skip {city}: missing {network_path}")
        return
    conn = get_db(city)
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS lines (
            ref TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            color TEXT NOT NULL,
            length REAL NOT NULL,
            opened TEXT,
            from_station TEXT,
            to_station TEXT,
            is_loop INTEGER DEFAULT 0,
            note TEXT,
            stations TEXT NOT NULL,
            branches TEXT NOT NULL,
            shape TEXT NOT NULL,
            station_count INTEGER NOT NULL,
            sort INTEGER NOT NULL
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS stations (
            name TEXT PRIMARY KEY,
            name_en TEXT,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            lines TEXT NOT NULL,
            status TEXT NOT NULL,
            nearby TEXT NOT NULL
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_stations_latlon ON stations(lat, lon)")
    cur.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
    cur.execute("SELECT COUNT(*) AS n FROM lines")
    has_rows = cur.fetchone()["n"] > 0
    mtime = str(int(os.path.getmtime(network_path)))
    stored = cur.execute("SELECT value FROM meta WHERE key = 'network_mtime'").fetchone()
    if has_rows and stored and stored["value"] == mtime:
        conn.commit()
        conn.close()
        return
    if has_rows:
        cur.execute("DELETE FROM lines")
        cur.execute("DELETE FROM stations")
        conn.commit()

    with open(network_path, encoding="utf-8") as f:
        net = json.load(f)
    for line in net["lines"]:
        cur.execute(
            """INSERT OR REPLACE INTO lines
               (ref, name, color, length, opened, from_station, to_station, is_loop,
                note, stations, branches, shape, station_count, sort)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                line["ref"], line["name"], line["color"], line["length"], line["opened"],
                line["from"], line["to"], 1 if line.get("loop") else 0, line.get("note", ""),
                json.dumps(line["stations"], ensure_ascii=False),
                json.dumps(line["branches"], ensure_ascii=False),
                json.dumps(line["shape"], ensure_ascii=False, separators=(",", ":")),
                line["station_count"], line["sort"],
            ),
        )
    for st in net["stations"]:
        cur.execute(
            """INSERT OR REPLACE INTO stations
               (name, name_en, lat, lon, lines, status, nearby)
               VALUES (?,?,?,?,?,?,?)""",
            (
                st["name"], st.get("name_en", ""), st["lat"], st["lon"],
                json.dumps(st["lines"]), st.get("status", "operating"),
                json.dumps(st.get("nearby", []), ensure_ascii=False),
            ),
        )
    cur.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('network_mtime', ?)", (mtime,))
    conn.commit()
    conn.close()


def row_to_line(row):
    return {
        "ref": row["ref"],
        "name": row["name"],
        "color": row["color"],
        "length": row["length"],
        "opened": row["opened"],
        "from": row["from_station"],
        "to": row["to_station"],
        "loop": bool(row["is_loop"]),
        "note": row["note"],
        "stations": json.loads(row["stations"]),
        "branches": json.loads(row["branches"]),
        "shape": json.loads(row["shape"]),
        "station_count": row["station_count"],
        "sort": row["sort"],
    }


def row_to_station(row):
    return {
        "name": row["name"],
        "name_en": row["name_en"] or "",
        "lat": row["lat"],
        "lon": row["lon"],
        "lines": json.loads(row["lines"]),
        "status": row["status"],
        "nearby": json.loads(row["nearby"]),
    }


def fetch_meta(city):
    with open(CITIES[city]["network"], encoding="utf-8") as f:
        meta = json.load(f)["meta"]
    return meta


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/airport")
def airport():
    return render_template("airport.html")


def load_terrain_labels(city):
    try:
        with open(CITIES[city]["terrain"], encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return []


@app.route("/api/network")
def api_network():
    city = city_key()
    conn = get_db(city)
    lines = [row_to_line(r) for r in conn.execute("SELECT * FROM lines ORDER BY sort")]
    stations = [row_to_station(r) for r in conn.execute("SELECT * FROM stations ORDER BY name")]
    meta = fetch_meta(city)
    conn.close()
    return jsonify({
        "city": city,
        "meta": meta,
        "lines": lines,
        "stations": stations,
        "terrain_labels": load_terrain_labels(city),
    })


@app.route("/api/lines/<ref>")
def api_line(ref):
    city = city_key()
    conn = get_db(city)
    row = conn.execute("SELECT * FROM lines WHERE ref = ?", (ref,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "not_found"}), 404
    line = row_to_line(row)
    stations = {}
    for r in conn.execute("SELECT * FROM stations"):
        st = row_to_station(r)
        stations[st["name"]] = st
    conn.close()
    line["station_details"] = [stations.get(n) for n in line["stations"] if n in stations]
    for br in line["branches"]:
        br["station_details"] = [stations.get(n) for n in br["stations"] if n in stations]
    return jsonify(line)


@app.route("/api/stations/<path:name>")
def api_station(name):
    city = city_key()
    conn = get_db(city)
    row = conn.execute("SELECT * FROM stations WHERE name = ?", (name,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "not_found"}), 404
    station = row_to_station(row)
    positions = []
    for r in conn.execute("SELECT * FROM lines ORDER BY sort"):
        line = row_to_line(r)
        branch_names = {n for br in line["branches"] for n in br["stations"]}
        main_stations = [n for n in line["stations"] if n not in branch_names]
        if name in main_stations:
            idx = main_stations.index(name)
            positions.append({
                "ref": line["ref"], "name": line["name"], "color": line["color"],
                "index": idx + 1, "total": len(main_stations),
                "prev": main_stations[idx - 1] if idx > 0 else None,
                "next": main_stations[idx + 1] if idx < len(main_stations) - 1 else None,
            })
        for br in line["branches"]:
            if name in br["stations"]:
                idx = br["stations"].index(name)
                positions.append({
                    "ref": line["ref"], "name": line["name"], "color": line["color"],
                    "index": idx + 1, "total": len(br["stations"]), "branch": True,
                    "anchor": br["anchor"],
                    "prev": br["stations"][idx - 1] if idx > 0 else br["anchor"],
                    "next": br["stations"][idx + 1] if idx < len(br["stations"]) - 1 else None,
                })
    station["positions"] = positions
    conn.close()
    return jsonify(station)


@app.route("/api/search")
def api_search():
    q = (request.args.get("q") or "").strip().lower()
    if not q:
        return jsonify({"lines": [], "stations": []})
    city = city_key()
    conn = get_db(city)
    lines = []
    for r in conn.execute("SELECT * FROM lines ORDER BY sort"):
        line = row_to_line(r)
        hay = f"{line['ref']} {line['name']} {line['from']} {line['to']}".lower()
        if q in hay:
            lines.append({
                "type": "line", "ref": line["ref"], "name": line["name"],
                "color": line["color"], "from": line["from"], "to": line["to"],
                "station_count": line["station_count"], "length": line["length"],
            })
    stations = []
    for r in conn.execute("SELECT * FROM stations ORDER BY name"):
        st = row_to_station(r)
        hay = f"{st['name']} {st['name_en']}".lower()
        if q in hay:
            stations.append({
                "type": "station", "name": st["name"], "name_en": st["name_en"],
                "lines": st["lines"], "status": st["status"],
            })
    conn.close()

    def score(item):
        label = item.get("name", "")
        if label.lower().startswith(q):
            return 0
        if q in label.lower():
            return 1
        return 2

    lines.sort(key=score)
    stations.sort(key=score)
    return jsonify({"lines": lines[:6], "stations": stations[:10]})


@app.route("/api/health")
def health():
    return jsonify({
        "ok": True,
        "port": PORT,
        "cities": {key: cfg["name"] for key, cfg in CITIES.items()},
    })


for _city in CITIES:
    init_db(_city)


if __name__ == "__main__":
    print(f"Rail Transit Atlas (5 cities) -> http://127.0.0.1:{PORT}")
    app.run(host=os.environ.get("HOST", "0.0.0.0"), port=PORT, debug=False)
