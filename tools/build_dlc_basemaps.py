# -*- coding: utf-8 -*-
"""按需生成大连机场某一级底图：base / region / core / far / alpha。"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_dlc as B  # noqa: E402

JOBS = {
    "base": ("dlc_base", B.BASE_BBOX, B.BASE_ZOOM, 88),
    "region": ("dlc_region", B.REGION_BBOX, B.REGION_ZOOM, 84),
    "core": ("dlc_core", B.CORE_BBOX, B.CORE_ZOOM, 90),
    "far": ("dlc_far", B.FAR_BBOX, B.FAR_ZOOM, 80),
}

if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "base"
    if which == "alpha":
        B.build_core_alpha()
    else:
        name, bbox, zoom, quality = JOBS[which]
        B.build_basemap(name, bbox, zoom, quality)
