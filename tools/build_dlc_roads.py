# -*- coding: utf-8 -*-
"""生成大连周水子机场周边路网数据（复用通用路网整理逻辑）。

输出:
    static/data/dlc_roads.json
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_tfu_roads as R  # noqa: E402

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R.RAW = os.path.join(BASE, "data", "osm_dlc_roads.json")
R.OUT = os.path.join(BASE, "static", "data", "dlc_roads.json")
R.BBOX = (38.900, 121.430, 39.020, 121.640)
R.LAT0 = 38.9657

if __name__ == "__main__":
    R.main()
