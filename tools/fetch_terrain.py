# -*- coding: utf-8 -*-
"""Fetch named terrain features (peaks, ridges, rivers, lakes) for the Chengdu region."""
import json
import os
import time
import urllib.parse
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "data", "osm_terrain_raw.json")
BBOX = "29.55,102.75,31.45,105.35"
QUERY = f"""
[out:json][timeout:240];
(
  node["natural"="peak"]["name"]({BBOX});
  way["natural"="ridge"]["name"]({BBOX});
  relation["natural"="ridge"]["name"]({BBOX});
  way["natural"="water"]["name"]({BBOX});
  relation["natural"="water"]["name"]({BBOX});
  way["waterway"="river"]["name"]({BBOX});
  relation["waterway"="river"]["name"]({BBOX});
  way["water"="reservoir"]["name"]({BBOX});
  relation["water"="reservoir"]["name"]({BBOX});
  way["natural"="wood"]["name"]({BBOX});
);
out center tags;
"""

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]


def fetch(endpoint):
    data = urllib.parse.urlencode({"data": QUERY}).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=data,
        headers={"User-Agent": "ChengduTerrainLabels/1.0", "Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    last = None
    for endpoint in ENDPOINTS:
        try:
            print("fetching", endpoint, flush=True)
            payload = fetch(endpoint)
            with open(OUT, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=1)
            print("elements", len(payload.get("elements", [])), "->", OUT, flush=True)
            return
        except Exception as exc:  # noqa: BLE001
            last = exc
            print("failed", repr(exc)[:200], flush=True)
            time.sleep(2)
    raise SystemExit(f"all endpoints failed: {last}")


if __name__ == "__main__":
    main()
