# 轨道交通平台 · 五城线网与机场数字孪生

成都、大连、重庆、昆明、贵阳五座城市的地铁线网，加天府与周水子机场的 3D 场景。
Flask + SQLite，默认端口 **8007**。

## 功能

- **五城线网**：按城市切换，线路走向、站点位置、换乘关系
- **站点检索**：定位到站，查看所属线路
- **三套底图**：地形（Terrarium 高程瓦片本地渲染）、暗色、浅色，均带压黄路 / 提绿的调色处理后端
- **本地瓦片代理**：底图瓦片由本机服务端代理并落盘缓存，浏览器只访问 `127.0.0.1`
- **机场 3D**：天府国际机场、大连周水子机场的建筑与跑道场景

## 运行

```bash
pip install flask numpy pillow
python app.py
```

打开 <http://127.0.0.1:8007>。Windows 可双击 `start.bat`。

首次启动会从 `data/network*.json` 建 SQLite 库；仓库里已附带建好的
`chengdu_metro.db`、`dalian_metro.db`、`chongqing_metro.db`、`kunming_metro.db`、`guiyang_metro.db`，
想重建直接删掉对应 `.db` 重启即可。

> **依赖缺失会直接退出**，这是刻意设计：缺 numpy / Pillow 时底图调色与地形渲染无法工作，
> 暗色会变浅色、地形会退回 Esri 栅格（放大后出现 "Map data not yet available"），
> 与其静默降级显示错的东西，不如起不来。

## 目录结构

```
app.py              服务端：线网查询、瓦片代理、页面渲染
map_style.py        底图调色（压黄路、提绿、暗色变换），依赖 numpy + Pillow
terrain_render.py   Terrarium 高程瓦片 → 分层设色 + 山体晕渲
data/               五城线网 network*.json 与地形注记
*.db                各城市建好的 SQLite 库
static/             前端资源与本地底图
templates/          页面模板
tools/              数据整理脚本
```

## 数据来源

- 线网与站点：各市公开的地铁线路资料整理
- 底图与注记：© OpenStreetMap contributors，ODbL
- 高程瓦片：Terrarium（AWS Open Data / Mapzen 系）

商用或再分发前请自行核对各数据源的许可条款。

## 已知限制

- 线网为静态快照，不接实时客流或运行数据
- `static/tilecache/` 瓦片缓存不纳入仓库，首次浏览需联网
- 机场 3D 为概览级模型，不做仿真与调度
