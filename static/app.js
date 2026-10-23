/* ============================================================
   轨道交通平台 · 成都 / 大连 / 重庆 / 昆明 / 贵阳
   Leaflet + 原生 JS
   ============================================================ */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);

  const OSM_FALLBACK = {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: 'abc',
    maxZoom: 19,
    attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  };

  // 底图全部使用免密钥源；主源不可达时自动退回 OSM，并用滤镜模拟深色/地形
  const BASEMAPS = {
    light: {
      url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
      subdomains: 'abcd',
      attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 20,
      fallback: OSM_FALLBACK,
      filter: 'saturate(0.9) brightness(1.04)',
      fallbackFilter: '',
    },
    terrain: {
      url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
      attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
      maxZoom: 17,
      fallback: OSM_FALLBACK,
      filter: '',
      fallbackFilter: 'sepia(0.45) saturate(1.3) contrast(0.92) brightness(1.02)',
    },
    standard: {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    },
    dark: {
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      subdomains: 'abcd',
      attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 20,
      fallback: OSM_FALLBACK,
      filter: '',
      fallbackFilter: 'invert(1) hue-rotate(180deg) brightness(0.86) contrast(1.08) saturate(0.7)',
    },
  };

  // 瓦片失败时用透明图占位，避免出现破图标
  const BLANK_TILE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  const STATION_MIN_ZOOM = 11;
  const LABEL_MIN_ZOOM = 13;
  const MOBILE_BREAKPOINT = 980;

  // 主题跟随本地时间：08:00–18:00 浅色，其余时段深色
  function themeByClock(date = new Date()) {
    const h = date.getHours();
    return h >= 8 && h < 18 ? 'light' : 'dark';
  }

  const CITY_SUPPORT = new Set(['chengdu', 'dalian', 'chongqing', 'kunming', 'guiyang']);

  const state = {
    city: 'chengdu',
    network: null,
    map: null,
    tileLayer: null,
    basemap: 'light',
    basemapFallback: false,
    basemapTimer: 0,
    tilesLoaded: 0,
    lineGroup: null,
    badgeGroup: null,
    lineLayers: new Map(),
    lineBadges: new Map(),
    stationLayer: null,
    stationMarkers: new Map(),
    terrainLayer: null,
    terrainLabels: [],
    stationMap: new Map(),
    lineMap: new Map(),
    hidden: new Set(),
    selectedLine: null,
    selectedStation: null,
    pulse: null,
    networkCollapsed: false,
    detailCollapsed: false,
    searchItems: [],
    searchActive: -1,
    searchToken: 0,
    tileErrorShown: false,
  };

  const el = {
    lineList: $('#line-list'),
    lineCount: $('#line-count'),
    listFade: $('#list-fade'),
    detail: $('#detail-panel'),
    searchWrap: $('#search'),
    searchInput: $('#search-input'),
    searchPanel: $('#search-panel'),
    searchClear: $('#search-clear'),
    hint: $('#hint'),
    toast: $('#toast'),
    panel: $('#network-panel'),
    panelToggle: $('#panel-toggle'),
    panelClose: $('#panel-close'),
    panelCollapse: $('#panel-collapse'),
    networkTab: $('#network-tab'),
    detailTab: $('#detail-tab'),
    detailTabLabel: $('#detail-tab-label'),
    backdrop: $('#sheet-backdrop'),
    statKm: $('#stat-km'),
    statStations: $('#stat-stations'),
    statTransfers: $('#stat-transfers'),
    statLines: $('#stat-lines'),
    toggleAll: $('#toggle-all'),
    basemap: $('#basemap-switch'),
    citySwitch: $('#city-switch'),
    cityTrigger: $('#city-trigger'),
    cityMenu: $('#city-menu'),
    cityName: $('#city-name'),
  };

  /* ---------------- 工具 ---------------- */

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function rgba(hex, alpha) {
    const h = String(hex || '#98a2b3').replace('#', '');
    const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(v, 16);
    if (Number.isNaN(n)) return `rgba(152,162,179,${alpha})`;
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }

  function luminance(hex) {
    const h = String(hex || '#000').replace('#', '');
    const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(v, 16);
    if (Number.isNaN(n)) return 0;
    const r = ((n >> 16) & 255) / 255;
    const g = ((n >> 8) & 255) / 255;
    const b = (n & 255) / 255;
    const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  function contrastText(hex) {
    return luminance(hex) > 0.58 ? '#0b1220' : '#ffffff';
  }

  function mixHex(hex, target, ratio) {
    const parse = (h) => {
      const v = String(h).replace('#', '');
      const s = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
      const n = parseInt(s, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const a = parse(hex);
    const b = parse(target);
    const c = a.map((v, i) => Math.round(v + (b[i] - v) * ratio));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  function markerColor(hex) {
    return luminance(hex) > 0.55 ? mixHex(hex, '#0b1220', 0.26) : hex;
  }

  function stationColor(st) {
    return st.status !== 'operating' ? '#98a2b3' : markerColor(lineColor(st.lines[0]));
  }

  function refLabel(ref) {
    return ref === 'S3' ? 'S3' : ref;
  }

  function refCode(ref) {
    return ref === 'S3' ? 'S3' : String(ref).padStart(2, '0');
  }

  function lineColor(ref) {
    const line = state.lineMap.get(ref);
    return line ? line.color : '#98a2b3';
  }

  function lineName(ref) {
    const line = state.lineMap.get(ref);
    return line ? line.name : ref;
  }

  function statusLabel(status) {
    if (status === 'suspended') return { cls: 'suspended', text: '暂缓开通' };
    if (status === 'reserved') return { cls: 'reserved', text: '预留车站' };
    return { cls: '', text: '运营中' };
  }

  function chips(refs) {
    return refs.map((r) => {
      const c = lineColor(r);
      return `<span class="mini-chip" style="--c:${c};background:${rgba(c, 0.12)}"><i></i>${escapeHtml(refLabel(r))}</span>`;
    }).join('');
  }

  function haversine(a, b) {
    const R = 6371008.8;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b[0] - a[0]);
    const dLon = toRad(b[1] - a[1]);
    const lat1 = toRad(a[0]);
    const lat2 = toRad(b[0]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function pointAlongShape(shape, fraction) {
    let best = null;
    let bestLen = -1;
    for (const chain of shape) {
      let len = 0;
      for (let i = 1; i < chain.length; i += 1) len += haversine(chain[i - 1], chain[i]);
      if (len > bestLen) { bestLen = len; best = chain; }
    }
    if (!best || best.length === 0) return null;
    const target = bestLen * fraction;
    let acc = 0;
    for (let i = 1; i < best.length; i += 1) {
      const d = haversine(best[i - 1], best[i]);
      if (acc + d >= target) {
        const t = d === 0 ? 0 : (target - acc) / d;
        return [
          best[i - 1][0] + (best[i][0] - best[i - 1][0]) * t,
          best[i - 1][1] + (best[i][1] - best[i - 1][1]) * t,
        ];
      }
      acc += d;
    }
    return best[best.length - 1];
  }

  function casingColor() {
    return state.basemap === 'dark' ? '#0f1520' : '#ffffff';
  }

  function lineMainWeight(ref) {
    const z = state.map ? state.map.getZoom() : 10.5;
    const t = Math.max(0, Math.min(1, (z - 9.5) / 3.5));
    const base = 2.0 + t * 2.0;
    return ref === state.selectedLine ? base + 2.0 : base;
  }

  function lineCasingWeight(ref) {
    return lineMainWeight(ref) + 3.2;
  }

  function showToast(message, ms = 3600) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { el.toast.hidden = true; }, ms);
  }

  /* ---------------- 启动 ---------------- */

  function initialCity() {
    let picked = '';
    try {
      picked = new URLSearchParams(location.search).get('city') || '';
    } catch (e) { /* ignore */ }
    if (!picked) {
      try { picked = localStorage.getItem('metro-city') || ''; } catch (e) { /* ignore */ }
    }
    return CITY_SUPPORT.has(picked) ? picked : 'chengdu';
  }

  async function fetchCity(city) {
    const res = await fetch('/api/network?city=' + encodeURIComponent(city));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  function applyNetwork(city, data) {
    state.city = city;
    state.network = data;
    state.lineMap = new Map();
    state.stationMap = new Map();
    data.lines.forEach((line) => state.lineMap.set(line.ref, line));
    data.stations.forEach((st) => state.stationMap.set(st.name, st));
    buildStationPositions();
  }

  function cityMeta() {
    return (state.network && state.network.meta) || {};
  }

  function updateCityChrome() {
    const city = cityMeta().city || '成都';
    document.title = `公共交通设施平台 · ${city}`;
    const desc = document.querySelector('meta[name="description"]');
    if (desc) {
      desc.setAttribute('content', `基于 OpenStreetMap 的公共交通设施平台，当前查看${city}轨道交通线网，可缩放查看线路、车站、换乘与运营信息。`);
    }
    const mapEl = $('#map');
    if (mapEl) mapEl.setAttribute('aria-label', `轨道交通线网地图，当前城市${city}`);
    if (el.cityName) el.cityName.textContent = city;
    if (el.cityMenu) {
      el.cityMenu.querySelectorAll('.city-option').forEach((opt) => {
        opt.setAttribute('aria-selected', opt.dataset.city === state.city ? 'true' : 'false');
      });
    }

    const examples = {
      chengdu: '天府广场',
      dalian: '青泥洼桥',
      chongqing: '解放碑',
      kunming: '东风广场',
      guiyang: '喷水池',
    };
    const example = examples[state.city] || '';
    el.searchInput.placeholder = `搜索${city}线路或车站${example ? '，如 ' + example : ''}`;
    el.searchInput.setAttribute('aria-label', el.searchInput.placeholder);

    const snap = $('#snapshot-date');
    if (snap && cityMeta().generated) snap.textContent = `数据快照 ${cityMeta().generated}`;
    const note = $('#panel-foot-note');
    if (note) note.textContent = `站点与里程核对${city}轨道运营方公开资料，仅供查看。`;

    try {
      const url = new URL(location.href);
      if (state.city === 'chengdu') url.searchParams.delete('city');
      else url.searchParams.set('city', state.city);
      history.replaceState(null, '', url.pathname + url.search + location.hash);
    } catch (e) { /* ignore */ }
    try { localStorage.setItem('metro-city', state.city); } catch (e) { /* ignore */ }
  }

  function renderCity() {
    renderStats();
    renderLineList();
    buildMapLayers();
    buildTerrainLabels();
    applyBasemap(state.basemap);
    updateCityChrome();
  }

  function clearCityLayers() {
    if (state.map) {
      [state.lineGroup, state.badgeGroup, state.stationLayer, state.terrainLayer].forEach((layer) => {
        if (layer && state.map.hasLayer(layer)) state.map.removeLayer(layer);
      });
    }
    state.lineGroup = null;
    state.badgeGroup = null;
    state.stationLayer = null;
    state.terrainLayer = null;
    state.lineLayers.clear();
    state.lineBadges.clear();
    state.stationMarkers.clear();
    state.terrainLabels = [];
    state.hidden.clear();
    state.searchItems = [];
    state.searchActive = -1;
    state.searchToken += 1;
  }

  function fitCityBounds() {
    if (!state.map || !state.network) return;
    const mobile = window.innerWidth <= MOBILE_BREAKPOINT;
    const pool = mobile
      ? state.network.stations.filter((s) => !s.lines.includes('S3'))
      : state.network.stations;
    const pts = pool.length ? pool : state.network.stations;
    if (!pts.length) return;
    const bounds = L.latLngBounds(pts.map((s) => [s.lat, s.lon]));
    state.map.fitBounds(bounds, {
      paddingTopLeft: mobile ? [18, 118] : [368, 88],
      paddingBottomRight: mobile ? [18, 78] : [56, 36],
      maxZoom: 12.5,
    });
  }

  function closeCityMenu() {
    if (!el.cityMenu || !el.cityTrigger) return;
    el.cityMenu.classList.remove('open');
    el.cityTrigger.setAttribute('aria-expanded', 'false');
  }

  let citySwitchToken = 0;

  async function switchCity(city) {
    if (!CITY_SUPPORT.has(city)) return;
    if (city === state.city) {
      if (document.body.classList.contains('city-switching')) {
        citySwitchToken += 1;
        document.body.classList.remove('city-switching');
      }
      closeCityMenu();
      return;
    }
    const token = ++citySwitchToken;
    closeCityMenu();
    document.body.classList.add('city-switching');
    let data;
    try {
      data = await fetchCity(city);
    } catch (err) {
      if (token === citySwitchToken) {
        document.body.classList.remove('city-switching');
        showToast('城市数据加载失败：' + err.message);
      }
      return;
    }
    if (token !== citySwitchToken) return;
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (token !== citySwitchToken) return;
    closeSearch();
    closeDetail({ skipHash: true });
    setHash('');
    clearCityLayers();
    applyNetwork(city, data);
    el.searchInput.value = '';
    el.searchClear.hidden = true;
    renderCity();
    fitCityBounds();
    showToast(`已切换至${cityMeta().city}线网`);
    setTimeout(() => {
      document.body.classList.remove('city-switching');
      state.map.invalidateSize({ debounceMoveend: true });
    }, 70);
  }

  async function boot() {
    const city = initialCity();
    // 进入页面即按当前时间决定明暗
    state.basemap = themeByClock();
    document.body.dataset.theme = state.basemap;
    try {
      applyNetwork(city, await fetchCity(city));
    } catch (err) {
      el.lineList.innerHTML = '<div style="padding:24px 10px;font-size:12px;color:#b54708">数据加载失败，请确认本地服务已启动。</div>';
      showToast('线网数据加载失败：' + err.message);
      return;
    }

    initMap();
    renderCity();
    bindUI();
    applyHash();

    // 跨过 08:00 / 18:00 时自动切换明暗；同一时段内保留手动选择的底图
    let clockTheme = state.basemap;
    setInterval(() => {
      const next = themeByClock();
      if (next === clockTheme) return;
      clockTheme = next;
      applyBasemap(next);
    }, 30 * 1000);

    setTimeout(() => el.hint.classList.add('hide'), 9000);
    window.__metro = state;

    if (window.innerWidth <= MOBILE_BREAKPOINT) {
      el.panel.classList.remove('mobile-open');
    }
  }

  /* ---------------- 地图 ---------------- */

  function buildStationPositions() {
    state.network.lines.forEach((line) => {
      const branchNames = new Set();
      line.branches.forEach((b) => b.stations.forEach((n) => branchNames.add(n)));
      const mainCount = line.stations.filter((n) => !branchNames.has(n)).length;
      line.stations.forEach((name, idx) => {
        const st = state.stationMap.get(name);
        if (!st || branchNames.has(name)) return;
        if (!st.positions) st.positions = [];
        st.positions.push({
          ref: line.ref,
          name: line.name,
          color: line.color,
          index: idx + 1,
          total: mainCount,
          prev: idx > 0 ? line.stations[idx - 1] : null,
          next: idx < line.stations.length - 1 ? line.stations[idx + 1] : null,
        });
      });
      line.branches.forEach((br) => {
        br.stations.forEach((name, idx) => {
          const st = state.stationMap.get(name);
          if (!st) return;
          if (!st.positions) st.positions = [];
          st.positions.push({
            ref: line.ref,
            name: line.name,
            color: line.color,
            index: idx + 1,
            total: br.stations.length,
            branch: true,
            anchor: br.anchor,
            prev: idx > 0 ? br.stations[idx - 1] : br.anchor,
            next: idx < br.stations.length - 1 ? br.stations[idx + 1] : null,
          });
        });
      });
    });
  }

  function initMap() {
    const map = L.map('map', {
      zoomControl: false,
      attributionControl: false,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 96,
      minZoom: 9,
      maxZoom: 18,
      preferCanvas: false,
      worldCopyJump: true,
      boxZoom: false,
    });
    state.map = map;

    L.control.zoom({ position: 'bottomright', zoomInTitle: '放大', zoomOutTitle: '缩小' }).addTo(map);
    L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map);

    fitCityBounds();

    map.on('zoomend', () => {
      updateZoomClass();
      updateStationVisibility();
      updateTerrainLabels();
      clearTimeout(layoutLineBadges.timer);
      layoutLineBadges.timer = setTimeout(layoutLineBadges, 120);
    });
    map.on('click', () => {
      closeMobilePanel();
      if (state.selectedLine || state.selectedStation) closeDetail();
    });
    let tileErrors = 0;
    map.on('tileload', (e) => {
      const src = e.tile && e.tile.getAttribute ? e.tile.getAttribute('src') : '';
      if (src && src.indexOf('data:image') === 0) return;
      state.tilesLoaded = (state.tilesLoaded || 0) + 1;
    });
    map.on('tileerror', () => {
      tileErrors += 1;
      const cfg = BASEMAPS[state.basemap] || {};
      // 主源连续失败时先退回 OSM 备用源（保留深色/地形滤镜），再失败只提示
      if (tileErrors >= 4 && cfg.fallback && !state.basemapFallback) {
        applyBasemap(state.basemap, { fallback: true });
        showToast('当前底图源不可用，已自动切换到备用底图。');
        return;
      }
      if (!state.tileErrorShown && tileErrors > 10) {
        state.tileErrorShown = true;
        showToast('底图瓦片加载较慢，线网数据不受影响。');
      }
    });
    updateZoomClass();

    window.addEventListener('resize', () => map.invalidateSize({ debounceMoveend: true }));
  }

  function updateZoomClass() {
    const container = state.map.getContainer();
    const z = state.map.getZoom();
    container.classList.toggle('z-low', z < STATION_MIN_ZOOM);
    container.classList.toggle('z-mid', z >= STATION_MIN_ZOOM && z < LABEL_MIN_ZOOM);
    container.classList.toggle('z-high', z >= LABEL_MIN_ZOOM);
  }

  function applyBasemap(key, opts = {}) {
    const cfg = BASEMAPS[key];
    if (!cfg || !state.map) return;
    const useFallback = !!(opts.fallback && cfg.fallback);
    const src = useFallback ? { ...cfg, ...cfg.fallback } : cfg;
    if (state.tileLayer) state.map.removeLayer(state.tileLayer);
    state.basemap = key;
    state.basemapFallback = useFallback;
    document.body.dataset.theme = key === 'dark' ? 'dark' : 'light';
    document.body.dataset.basemap = key;

    state.tilesLoaded = 0;
    state.tileLayer = L.tileLayer(src.url, {
      subdomains: src.subdomains || 'abc',
      maxZoom: src.maxZoom,
      attribution: src.attr || cfg.attr,
      errorTileUrl: BLANK_TILE,
      className: 'basemap-tiles',
    }).addTo(state.map);

    // 备用源 + CSS 滤镜模拟深色/地形
    const pane = state.map.getPane('tilePane');
    if (pane) pane.style.filter = useFallback ? (cfg.fallbackFilter || '') : (cfg.filter || '');

    // 部分网络会静默丢包（既不成功也不报错），用看门狗兜底切到备用源
    clearTimeout(state.basemapTimer);
    if (!useFallback && cfg.fallback) {
      state.basemapTimer = setTimeout(() => {
        if (state.basemap !== key || state.basemapFallback || state.tilesLoaded) return;
        applyBasemap(key, { fallback: true });
        showToast('底图源无响应，已切换到备用底图。');
      }, 5000);
    }

    el.basemap.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', b.dataset.basemap === key);
    });

    state.lineLayers.forEach((obj) => {
      obj.casing.forEach((p) => p.setStyle({ color: casingColor() }));
    });
    if (state.lineLayers.size) applyLineEmphasis();
    updateTerrainLabels();
  }

  /* ---------------- 线网图层 ---------------- */

  function buildMapLayers() {
    const map = state.map;
    const lineGroup = L.layerGroup().addTo(map);
    const badgeGroup = L.layerGroup().addTo(map);
    state.lineGroup = lineGroup;
    state.badgeGroup = badgeGroup;

    state.network.lines.forEach((line) => {
      const shape = orientShape(line.shape.map((chain) => chain.map((p) => [p[0], p[1]])), line);
      const group = L.layerGroup();
      const casing = shape.map((chain) => L.polyline(chain, {
        color: casingColor(),
        weight: 7.5,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false,
        smoothFactor: 0.6,
      }).addTo(group));
      const main = shape.map((chain) => L.polyline(chain, {
        color: line.color,
        weight: 4,
        opacity: 0.96,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false,
        smoothFactor: 0.6,
      }).addTo(group));
      const hits = shape.map((chain) => {
        const hit = L.polyline(chain, {
          color: '#000',
          weight: 18,
          opacity: 0.001,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: true,
          smoothFactor: 0.6,
        }).addTo(group);
        hit.bindTooltip(
          `<b>${escapeHtml(line.name)}</b><span>${line.loop ? '环线 · 内环 / 外环' : `${escapeHtml(line.from)} → ${escapeHtml(line.to)}`}</span>`,
          { sticky: true, direction: 'top', offset: [0, -4], className: 'line-tip', opacity: 1 }
        );
        hit.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          selectLine(line.ref);
        });
        hit.on('mouseover', () => {
          if (state.selectedLine && state.selectedLine !== line.ref) return;
          main.forEach((p) => p.setStyle({ weight: lineMainWeight(line.ref) + 1.4 }));
          map.getContainer().style.cursor = 'pointer';
        });
        hit.on('mouseout', () => {
          map.getContainer().style.cursor = '';
          applyLineEmphasis();
        });
        return hit;
      });
      lineGroup.addLayer(group);

      const pt = pointAlongShape(shape, line.loop ? 0.04 : 0.96);
      let badge = null;
      if (pt) {
        const textColor = contrastText(line.color) === '#ffffff' ? '' : ' light-text';
        const icon = L.divIcon({
          className: 'line-badge-wrap',
          html: `<div class="line-badge${textColor}" style="--c:${line.color}">${escapeHtml(refLabel(line.ref))}</div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        badge = L.marker(pt, {
          icon,
          keyboard: false,
          riseOnHover: true,
          zIndexOffset: 420,
          bubblingMouseEvents: false,
        }).addTo(badgeGroup);
        badge.bindTooltip(line.name, { direction: 'top', offset: [0, -10], className: 'line-tip' });
        badge.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          selectLine(line.ref);
        });
      }

      state.lineLayers.set(line.ref, { group, casing, main, hits, badge, line, shape });
      state.lineBadges.set(line.ref, badge);
    });

    buildStations();

    // 18 号线为共线区段的主运营线路，压在 19 号线之上
    const l18 = state.lineLayers.get('18');
    if (l18) {
      l18.casing.forEach((p) => p.bringToFront());
      l18.main.forEach((p) => p.bringToFront());
      l18.hits.forEach((p) => p.bringToFront());
    }
    updateToggleAll();
    setTimeout(layoutLineBadges, 700);
  }

  function layoutLineBadges() {
    if (!state.map) return;
    const placed = [];
    const order = [...state.network.lines].sort((a, b) => a.length - b.length);
    order.forEach((line) => {
      const obj = state.lineLayers.get(line.ref);
      if (!obj || !obj.badge || !obj.shape) return;

      let groups;
      if (line.loop) {
        groups = [{ side: 'loop', fractions: [0.04, 0.07, 0.10, 0.90, 0.93, 0.96] }];
      } else {
        groups = [
          { side: 'to', distances: [20, 28, 36] },
          { side: 'from', distances: [20, 28, 36] },
        ];
      }
      // 首次布局时在两端中选择；之后固定在同一端，避免缩放时来回跳动
      const candidates = [];
      groups.forEach((group) => {
        if (obj.badgeSide && obj.badgeSide !== group.side) return;
        if (group.fractions) {
          group.fractions.forEach((f) => candidates.push({ f, side: group.side }));
        } else {
          group.distances.forEach((dist) => candidates.push({ dist, side: group.side }));
        }
      });

      let best = null;
      let bestScore = -Infinity;
      candidates.forEach((cand, idx) => {
        let pt;
        let p;
        if (cand.side === 'loop') {
          pt = pointAlongShape(obj.shape, cand.f);
          if (!pt) return;
          p = state.map.latLngToContainerPoint(pt);
        } else {
          const endF = cand.side === 'to' ? 1 : 0;
          const nearF = cand.side === 'to' ? 0.995 : 0.005;
          const end = pointAlongShape(obj.shape, endF);
          const near = pointAlongShape(obj.shape, nearF);
          if (!end || !near) return;
          const pe = state.map.latLngToContainerPoint(end);
          const pn = state.map.latLngToContainerPoint(near);
          let dx = pe.x - pn.x;
          let dy = pe.y - pn.y;
          const len = Math.hypot(dx, dy) || 1;
          dx /= len;
          dy /= len;
          p = L.point(pe.x + dx * cand.dist, pe.y + dy * cand.dist);
          pt = state.map.containerPointToLatLng(p);
        }
        let minD = 999;
        for (const q of placed) minD = Math.min(minD, Math.hypot(p.x - q.x, p.y - q.y));
        const score = Math.min(minD, 70) - idx * 1.2;
        if (score > bestScore) {
          bestScore = score;
          best = { pt, p, side: cand.side };
        }
      });
      if (best) {
        obj.badge.setLatLng(best.pt);
        if (!obj.badgeSide) obj.badgeSide = best.side;
        placed.push(best.p);
      }
    });
  }

  function orientShape(shape, line) {
    if (line.loop || !shape.length) return shape;
    const branchNames = new Set();
    line.branches.forEach((b) => b.stations.forEach((n) => branchNames.add(n)));
    const mainStations = line.stations.filter((n) => !branchNames.has(n));
    const first = state.stationMap.get(mainStations[0]);
    const last = state.stationMap.get(mainStations[mainStations.length - 1]);
    if (!first || !last) return shape;
    let idx = 0;
    let maxLen = -1;
    shape.forEach((chain, i) => {
      let len = 0;
      for (let k = 1; k < chain.length; k += 1) len += haversine(chain[k - 1], chain[k]);
      if (len > maxLen) { maxLen = len; idx = i; }
    });
    const chain = shape[idx];
    const d1 = haversine(chain[0], [first.lat, first.lon]) + haversine(chain[chain.length - 1], [last.lat, last.lon]);
    const d2 = haversine(chain[0], [last.lat, last.lon]) + haversine(chain[chain.length - 1], [first.lat, first.lon]);
    if (d2 < d1) shape[idx] = chain.slice().reverse();
    return shape;
  }

  function buildStations() {
    state.stationLayer = L.layerGroup();
    if (!state.map.getPane('stationsPane')) {
      const pane = state.map.createPane('stationsPane');
      pane.style.zIndex = 450;
    }
    state.network.stations.forEach((st) => {
      const transfer = st.lines.length > 1;
      let marker;
      if (transfer) {
        const colors = st.lines.map((r) => lineColor(r));
        let gradient;
        if (colors.length === 2) {
          gradient = `conic-gradient(${colors[0]} 0 50%, ${colors[1]} 50% 100%)`;
        } else if (colors.length === 3) {
          gradient = `conic-gradient(${colors[0]} 0 33.3%, ${colors[1]} 33.3% 66.6%, ${colors[2]} 66.6% 100%)`;
        } else {
          const step = 100 / colors.length;
          gradient = `conic-gradient(${colors.map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`).join(',')})`;
        }
        const icon = L.divIcon({
          className: '',
          html: `<div class="st-transfer" style="--ring:${gradient}" title="${escapeHtml(st.name)}"><i></i></div>`,
          iconSize: [13, 13],
          iconAnchor: [6.5, 6.5],
        });
        marker = L.marker([st.lat, st.lon], {
          icon,
          keyboard: false,
          riseOnHover: true,
          zIndexOffset: 260,
          bubblingMouseEvents: false,
        });
      } else {
        const suspended = st.status !== 'operating';
        marker = L.circleMarker([st.lat, st.lon], {
          radius: 4.2,
          color: stationColor(st),
          weight: 2.0,
          opacity: 1,
          fillColor: '#ffffff',
          fillOpacity: 1,
          dashArray: suspended ? '1.5,1.5' : null,
          pane: 'stationsPane',
          bubblingMouseEvents: false,
        });
      }

      marker.bindTooltip(st.name, {
        permanent: true,
        direction: 'right',
        offset: transfer ? [9, 0] : [7, 0],
        className: `st-label${transfer ? ' is-transfer' : ''}${st.status !== 'operating' ? ' is-suspended' : ''}`,
        opacity: 1,
        interactive: false,
      });

      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        selectStation(st.name);
      });

      marker.on('mouseover', () => {
        const tip = marker.getTooltip();
        const node = tip && tip.getElement();
        if (node) node.classList.add('is-hover');
      });
      marker.on('mouseout', () => {
        const tip = marker.getTooltip();
        const node = tip && tip.getElement();
        if (node) node.classList.remove('is-hover');
      });

      state.stationMarkers.set(st.name, { marker, st, transfer });
      state.stationLayer.addLayer(marker);
    });

    updateStationVisibility();
  }

  function buildTerrainLabels() {
    const labels = state.network.terrain_labels || [];
    if (!labels.length) return;
    state.terrainLayer = L.layerGroup();
    state.terrainLabels = [];
    if (!state.map.getPane('terrainLabelsPane')) {
      const pane = state.map.createPane('terrainLabelsPane');
      pane.style.zIndex = 440;
    }
    labels.forEach((item) => {
      const kind = ['mountain', 'range', 'plain', 'river', 'lake'].includes(item.kind)
        ? item.kind
        : 'mountain';
      const icon = L.divIcon({
        className: 'terrain-label-wrap',
        html: `<div class="terrain-label terrain-${kind}">${escapeHtml(item.name)}</div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      const marker = L.marker([item.lat, item.lon], {
        icon,
        interactive: false,
        keyboard: false,
        zIndexOffset: 50,
        pane: 'terrainLabelsPane',
      });
      marker._terrainMinZoom = Number(item.minZoom) || 10;
      state.terrainLayer.addLayer(marker);
      state.terrainLabels.push(marker);
    });
  }

  function updateTerrainLabels() {
    if (!state.map || !state.terrainLayer) return;
    if (state.basemap !== 'terrain') {
      if (state.map.hasLayer(state.terrainLayer)) state.map.removeLayer(state.terrainLayer);
      return;
    }
    if (!state.map.hasLayer(state.terrainLayer)) state.map.addLayer(state.terrainLayer);
    const z = state.map.getZoom();
    state.terrainLabels.forEach((marker) => {
      const show = z >= marker._terrainMinZoom;
      const has = state.terrainLayer.hasLayer(marker);
      if (show && !has) state.terrainLayer.addLayer(marker);
      if (!show && has) state.terrainLayer.removeLayer(marker);
    });
  }

  function applyLineEmphasis() {
    const selected = state.selectedLine;
    const dark = document.body.dataset.theme === 'dark';
    const grayLine = dark ? '#5f6b7a' : '#c3c9d3';
    const grayStation = dark ? '#6b7280' : '#b7bfca';

    state.stationMarkers.forEach(({ marker, st }) => {
      const on = !selected || st.lines.includes(selected);
      if (marker.setStyle) {
        marker.setStyle({
          color: on ? stationColor(st) : grayStation,
          opacity: on ? 1 : 0.62,
          fillOpacity: on ? 1 : 0.62,
        });
      } else {
        marker.setOpacity(on ? 1 : 0.62);
        const node = marker.getElement();
        if (node) node.style.filter = on ? '' : 'grayscale(1)';
      }
      const tip = marker.getTooltip && marker.getTooltip();
      const label = tip && tip.getElement();
      if (label) {
        label.style.display = selected && !on ? 'none' : '';
        label.style.opacity = '';
      }
    });

    state.lineLayers.forEach((obj, ref) => {
      const active = ref === selected;
      const dim = Boolean(selected) && !active;
      obj.main.forEach((p) => p.setStyle({
        color: dim ? grayLine : lineColor(ref),
        weight: lineMainWeight(ref),
        opacity: dim ? 0.92 : 0.96,
      }));
      obj.casing.forEach((p) => p.setStyle({
        color: casingColor(),
        weight: lineCasingWeight(ref),
        opacity: dim ? 0.5 : 0.9,
      }));
      obj.hits.forEach((p) => p.setStyle({ weight: active ? 24 : 18 }));
      if (obj.badge) {
        obj.badge.setOpacity(1);
        const badgeEl = obj.badge.getElement();
        if (badgeEl) {
          badgeEl.style.filter = dim ? 'grayscale(1)' : '';
          badgeEl.style.opacity = dim ? '0.55' : '1';
        }
      }
      if (active) {
        obj.casing.forEach((p) => p.bringToFront());
        obj.main.forEach((p) => p.bringToFront());
        obj.hits.forEach((p) => p.bringToFront());
      }
    });
  }

  /* ---------------- 面板 ---------------- */

  function animateNumber(node, to, decimals = 0) {
    if (!node) return;
    const token = (node._animToken || 0) + 1;
    node._animToken = token;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = Number(String(node.textContent).replace(/[^\d.]/g, '')) || 0;
    if (reduce || !Number.isFinite(to)) {
      if (Number.isFinite(to)) node.textContent = to.toFixed(decimals);
      return;
    }
    const start = performance.now();
    const duration = 760;
    const step = (now) => {
      if (node._animToken !== token) return;
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      node.textContent = (from + (to - from) * eased).toFixed(decimals);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function renderStats() {
    const meta = state.network.meta;
    animateNumber(el.statKm, Number(meta.total_km), 1);
    animateNumber(el.statStations, Number(meta.station_count));
    animateNumber(el.statTransfers, Number(meta.transfer_count));
    animateNumber(el.statLines, Number(meta.line_count));
  }

  function eyeIcon(hidden) {
    if (hidden) {
      return '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3.2 3.2l13.6 13.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M7.1 5.5A7.7 7.7 0 0110 5c4.2 0 6.9 3.3 7.8 4.8-.4.66-.96 1.46-1.7 2.2M4.3 7.2c-.8.9-1.4 1.8-1.9 2.6 1 1.6 3.7 4.7 7.6 4.7.86 0 1.66-.14 2.4-.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M8.3 8.3a2.4 2.4 0 003.4 3.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
    }
    return '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M2.3 10S5 4.9 10 4.9 17.7 10 17.7 10 15 15.1 10 15.1 2.3 10 2.3 10z" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="10" r="2.3" stroke="currentColor" stroke-width="1.4"/></svg>';
  }

  function renderLineList() {
    el.lineList.classList.add('is-entering');
    el.lineList.innerHTML = state.network.lines.map((line, i) => {
      const hidden = state.hidden.has(line.ref);
      const active = state.selectedLine === line.ref;
      return `
        <div class="line-row${active ? ' active' : ''}${hidden ? ' is-hidden' : ''}"
             style="--i:${i}"
             role="button" tabindex="0" data-ref="${line.ref}"
             aria-label="${escapeHtml(line.name)}，${line.station_count} 站">
          <span class="line-swatch" style="--c:${line.color}"></span>
          <span class="line-no">${refCode(line.ref)}</span>
          <span class="line-name">${escapeHtml(line.name)}</span>
          <span class="line-meta">${line.station_count}站 · ${line.length.toFixed(1)}km</span>
          <button class="eye-btn" type="button" data-eye="${line.ref}" title="${hidden ? '显示' : '隐藏'}${escapeHtml(line.name)}" aria-label="${hidden ? '显示' : '隐藏'}${escapeHtml(line.name)}">
            ${eyeIcon(hidden)}
          </button>
        </div>`;
    }).join('');
    el.lineCount.textContent = state.network.lines.length;
    updateToggleAll();
    updateListFade();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => el.lineList.classList.remove('is-entering'));
    });
  }

  function updateListFade() {
    if (!el.listFade || !el.lineList) return;
    const atBottom = el.lineList.scrollTop + el.lineList.clientHeight >= el.lineList.scrollHeight - 4;
    el.listFade.classList.toggle('hide', atBottom);
  }

  function updateToggleAll() {
    const total = state.network ? state.network.lines.length : 0;
    const allHidden = total > 0 && state.hidden.size >= total;
    el.toggleAll.textContent = allHidden ? '全部显示' : '全部隐藏';
  }

  function updateLineRows() {
    el.lineList.querySelectorAll('.line-row').forEach((row) => {
      const ref = row.dataset.ref;
      row.classList.toggle('active', state.selectedLine === ref);
      row.classList.toggle('is-hidden', state.hidden.has(ref));
      const eye = row.querySelector('.eye-btn');
      if (eye) {
        const hidden = state.hidden.has(ref);
        eye.innerHTML = eyeIcon(hidden);
        eye.title = `${hidden ? '显示' : '隐藏'}${lineName(ref)}`;
        eye.setAttribute('aria-label', eye.title);
      }
    });
    updateToggleAll();
  }

  function toggleLine(ref, silent = false) {
    if (state.hidden.has(ref)) state.hidden.delete(ref);
    else state.hidden.add(ref);

    const obj = state.lineLayers.get(ref);
    if (obj) {
      if (state.hidden.has(ref)) {
        state.map.removeLayer(obj.group);
        if (obj.badge) state.map.removeLayer(obj.badge);
      } else {
        state.map.addLayer(obj.group);
        if (obj.badge) state.map.addLayer(obj.badge);
      }
    }

    if (state.hidden.has(ref) && state.selectedLine === ref) closeDetail();
    updateStationVisibility();
    updateLineRows();
    applyLineEmphasis();

    if (!silent && state.hidden.size >= state.network.lines.length) {
      showToast('已隐藏全部线路，点击“全部显示”恢复。');
    }
  }

  function updateStationVisibility() {
    if (!state.stationLayer || !state.map) return;
    state.stationMarkers.forEach(({ marker, st }) => {
      const visible = st.lines.some((r) => !state.hidden.has(r));
      if (visible) state.stationLayer.addLayer(marker);
      else state.stationLayer.removeLayer(marker);
    });
    const show = state.map.getZoom() >= STATION_MIN_ZOOM;
    if (show && !state.map.hasLayer(state.stationLayer)) state.stationLayer.addTo(state.map);
    if (!show && state.map.hasLayer(state.stationLayer)) state.map.removeLayer(state.stationLayer);
    applyLineEmphasis();
  }

  function toggleAllLines() {
    const total = state.network.lines.length;
    const hideAll = state.hidden.size < total;
    if (hideAll) {
      state.network.lines.forEach((l) => state.hidden.add(l.ref));
    } else {
      state.hidden.clear();
    }
    state.lineLayers.forEach((obj, ref) => {
      if (state.hidden.has(ref)) {
        state.map.removeLayer(obj.group);
        if (obj.badge) state.map.removeLayer(obj.badge);
      } else {
        state.map.addLayer(obj.group);
        if (obj.badge) state.map.addLayer(obj.badge);
      }
    });
    if (hideAll) closeDetail();
    updateStationVisibility();
    updateLineRows();
    applyLineEmphasis();
    if (hideAll) showToast('已隐藏全部线路，点击“全部显示”恢复。');
  }

  /* ---------------- 详情 ---------------- */

  function updateSideTabs() {
    const desktop = window.innerWidth > MOBILE_BREAKPOINT;
    const autoHidden = document.body.classList.contains('detail-open') && window.innerWidth <= 1360;
    const showNetwork = desktop && state.networkCollapsed && !autoHidden;
    el.networkTab.hidden = !showNetwork;
    el.networkTab.classList.toggle('show', showNetwork);

    const showDetail = desktop && state.detailCollapsed && el.detail.classList.contains('open');
    el.detailTab.hidden = !showDetail;
    el.detailTab.classList.toggle('show', showDetail);
    if (state.selectedLine) {
      el.detailTabLabel.textContent = lineName(state.selectedLine);
      el.detailTab.style.setProperty('--tab-color', lineColor(state.selectedLine));
    } else if (state.selectedStation) {
      const st = state.stationMap.get(state.selectedStation);
      el.detailTabLabel.textContent = state.selectedStation;
      el.detailTab.style.setProperty('--tab-color', st ? lineColor(st.lines[0]) : '#98a2b3');
    } else {
      el.detailTabLabel.textContent = '详情';
      el.detailTab.style.setProperty('--tab-color', '#98a2b3');
    }
  }

  function setNetworkCollapsed(collapsed) {
    state.networkCollapsed = collapsed;
    el.panel.classList.toggle('is-collapsed', collapsed);
    updateSideTabs();
  }

  function setDetailCollapsed(collapsed) {
    if (!el.detail.classList.contains('open')) return;
    state.detailCollapsed = collapsed;
    el.detail.classList.toggle('is-collapsed', collapsed);
    el.detail.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
    document.body.classList.toggle('detail-collapsed', collapsed);
    if (collapsed) document.body.classList.remove('detail-open');
    else document.body.classList.add('detail-open');
    updateSideTabs();
  }

  function openDetail(html) {
    el.detail.innerHTML = html;
    el.detail.classList.add('open');
    el.detail.setAttribute('aria-hidden', 'false');
    el.detail.scrollTop = 0;
    state.detailCollapsed = false;
    el.detail.classList.remove('is-collapsed');
    document.body.classList.remove('detail-collapsed');
    document.body.classList.add('detail-open');
    updateSideTabs();
    if (window.innerWidth <= MOBILE_BREAKPOINT) closeMobilePanel();
  }

  function openMobilePanel() {
    if (window.innerWidth > MOBILE_BREAKPOINT) return;
    el.panel.classList.add('mobile-open');
    el.backdrop.hidden = false;
    requestAnimationFrame(() => el.backdrop.classList.add('show'));
  }

  function closeMobilePanel() {
    if (!el.panel.classList.contains('mobile-open') && !el.backdrop.classList.contains('show')) return;
    el.panel.classList.remove('mobile-open');
    el.backdrop.classList.remove('show');
    setTimeout(() => {
      if (!el.panel.classList.contains('mobile-open')) el.backdrop.hidden = true;
    }, 260);
  }

  function closeDetail(opts = {}) {
    if (!state.selectedLine && !state.selectedStation) {
      el.detail.classList.remove('open', 'is-collapsed');
      el.detail.setAttribute('aria-hidden', 'true');
      state.detailCollapsed = false;
      document.body.classList.remove('detail-open', 'detail-collapsed');
      updateSideTabs();
      return;
    }
    state.selectedLine = null;
    state.selectedStation = null;
    state.detailCollapsed = false;
    if (state.pulse) {
      state.map.removeLayer(state.pulse);
      state.pulse = null;
    }
    el.detail.classList.remove('open', 'is-collapsed');
    el.detail.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('detail-open', 'detail-collapsed');
    updateSideTabs();
    updateLineRows();
    applyLineEmphasis();
    if (!opts.skipHash) setHash('');
  }

  function setHash(value) {
    const target = value || location.pathname + location.search;
    if (location.hash === value || (!value && !location.hash)) return;
    try {
      history.replaceState(null, '', target);
    } catch (e) {
      /* ignore */
    }
  }

  function applyHash() {
    let hash = location.hash || '';
    try {
      hash = decodeURIComponent(hash);
    } catch (e) {
      /* ignore malformed hash */
    }
    const m = hash.match(/^#\/(line|station)\/(.+)$/);
    if (!m) return;
    if (m[1] === 'line' && state.lineMap.has(m[2])) {
      selectLine(m[2], { skipHash: true, focus: true });
    } else if (m[1] === 'station' && state.stationMap.has(m[2])) {
      selectStation(m[2], { skipHash: true, focus: true });
    }
  }

  function stationRows(line) {
    const branchNames = new Set();
    line.branches.forEach((b) => b.stations.forEach((n) => branchNames.add(n)));
    const rows = [];

    const row = (name) => {
      const st = state.stationMap.get(name);
      if (!st) return '';
      const transfer = st.lines.length > 1;
      const other = st.lines.filter((r) => r !== line.ref);
      const status = statusLabel(st.status);
      return `
        <li class="station-item${st.status !== 'operating' ? ' suspended' : ''}"
            data-station="${escapeHtml(name)}" style="--c:${line.color}">
          <span class="station-node${transfer ? ' transfer' : ''}"></span>
          <div class="station-name-wrap">
            <div class="station-name">${escapeHtml(name)}</div>
            ${st.status !== 'operating' ? `<div class="station-sub">${status.text}</div>` : ''}
          </div>
          <div class="station-tags">${chips(other)}</div>
        </li>`;
    };

    line.stations.forEach((name) => {
      if (!branchNames.has(name)) rows.push(row(name));
    });
    return rows.join('');
  }

  function lineDetailHTML(line) {
    const transferCount = line.stations.filter((n) => {
      const st = state.stationMap.get(n);
      return st && st.lines.length > 1;
    }).length;
    const suspended = line.stations.filter((n) => {
      const st = state.stationMap.get(n);
      return st && st.status !== 'operating';
    }).length;
    const statusPill = suspended
      ? `<span class="status-pill suspended">含 ${suspended} 座暂缓站</span>`
      : '<span class="status-pill">运营中</span>';

    return `
      <div class="detail-hero" style="--c:${line.color}">
        <div class="detail-top">
          <div>
            <div class="detail-kicker">LINE / 运营线路</div>
            <div class="detail-code">${refCode(line.ref)}</div>
          </div>
          <div class="detail-actions">
            <button class="collapse-btn" type="button" data-collapse-detail aria-label="收起详情">
              <svg viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="close-btn" type="button" data-close aria-label="关闭详情">
              <svg viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>
        <h2 class="detail-title">${escapeHtml(line.name)}</h2>
        <div class="status-row">
          ${statusPill}
          ${line.loop ? '<span class="status-pill loop-pill">环线</span>' : ''}
        </div>
        <div class="termini${line.loop ? ' loop' : ''}">
          ${line.loop
            ? '<span class="t-name">环线运营</span><span class="t-arrow"></span><span class="t-name">内环 / 外环</span>'
            : `<span class="t-name">${escapeHtml(line.from)}</span><span class="t-arrow"></span><span class="t-name">${escapeHtml(line.to)}</span>`}
        </div>
      </div>
      <div class="detail-stats">
        <div class="detail-stat"><b>${line.length.toFixed(1)}</b><span>里程 KM</span></div>
        <div class="detail-stat"><b>${line.station_count}</b><span>车站</span></div>
        <div class="detail-stat"><b>${transferCount}</b><span>换乘站</span></div>
        <div class="detail-stat"><b>${String(line.opened).slice(0, 4)}</b><span>首通</span></div>
      </div>
      <div class="detail-body">
        <p class="detail-note">${escapeHtml(line.note)}</p>
        <div class="section-head">
          <h3>途经车站</h3>
          <span>${line.station_count} STATIONS</span>
        </div>
        <ul class="station-list">${stationRows(line)}</ul>
        ${line.branches.map((br) => `
          <div class="branch-head" style="--c:${line.color}">
            支线 · ${escapeHtml(br.anchor)} — ${escapeHtml(br.stations[br.stations.length - 1])}
          </div>
          <ul class="station-list">
            ${br.stations.map((name) => {
              const st = state.stationMap.get(name);
              const other = st ? st.lines.filter((r) => r !== line.ref) : [];
              return `
                <li class="station-item" data-station="${escapeHtml(name)}" style="--c:${line.color}">
                  <span class="station-node${other.length ? ' transfer' : ''}"></span>
                  <div class="station-name-wrap">
                    <div class="station-name">${escapeHtml(name)}</div>
                  </div>
                  <div class="station-tags">${chips(other)}</div>
                </li>`;
            }).join('')}
          </ul>
        `).join('')}
      </div>`;
  }

  function stationDetailHTML(st) {
    const firstColor = lineColor(st.lines[0]);
    const status = statusLabel(st.status);
    const positions = (st.positions || []);
    const nearby = st.nearby || [];
    const transferCount = Math.max(0, st.lines.length - 1);

    return `
      <div class="detail-hero" style="--c:${firstColor}">
        <div class="detail-top">
          <div class="detail-kicker">STATION / 车站</div>
          <div class="detail-actions">
            <button class="collapse-btn" type="button" data-collapse-detail aria-label="收起详情">
              <svg viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="close-btn" type="button" data-close aria-label="关闭详情">
              <svg viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>
        <h2 class="detail-title station-title">${escapeHtml(st.name)}</h2>
        <p class="detail-en">${escapeHtml(st.name_en || `${String(state.city).toUpperCase()} METRO STATION`)}</p>
        <div class="line-chips">
          ${st.lines.map((r) => `<button class="line-chip" type="button" data-line="${r}" style="--c:${lineColor(r)}"><i></i>${escapeHtml(lineName(r))}</button>`).join('')}
        </div>
        <div class="station-hero-meta">
          <div><b>${st.lines.length}</b><span>途经线路</span></div>
          <div><b>${transferCount}</b><span>可换乘</span></div>
          <div><b style="font-size:12px;color:${st.status === 'operating' ? '#067647' : '#b54708'}">${status.text}</b><span>运营状态</span></div>
        </div>
      </div>
      <div class="detail-body">
        <div class="section-head" style="margin-top:0;padding-top:0;border-top:0">
          <h3>沿线位置</h3>
          <span>${positions.length} LINES</span>
        </div>
        ${positions.map((p) => `
          <div class="position-row" style="--c:${p.color}">
            <span class="position-dot"></span>
            <div class="position-main">
              <div class="position-title">${escapeHtml(p.name)}${p.branch ? ' · 支线' : ''}</div>
              <div class="position-sub">${p.prev ? escapeHtml(p.prev) : '始发'} → ${p.next ? escapeHtml(p.next) : '终到'}</div>
            </div>
            <span class="position-idx">${p.index}/${p.total}</span>
          </div>
        `).join('')}

        <div class="section-head">
          <h3>邻近车站</h3>
          <span>450 M</span>
        </div>
        ${nearby.length ? nearby.map((n) => `
          <div class="nearby-row" data-station="${escapeHtml(n.name)}">
            <span class="nearby-name">${escapeHtml(n.name)}</span>
            ${chips(n.lines)}
            <span class="nearby-dist">${n.distance} m · 出站换乘</span>
          </div>
        `).join('') : '<div style="padding:8px 0;font-size:10.5px;color:#98a2b3">周边 450 米内暂无其他线路车站。</div>'}

        <button class="center-btn" type="button" data-center="${escapeHtml(st.name)}">在地图上居中查看</button>
      </div>`;
  }

  /* ---------------- 选择交互 ---------------- */

  function selectLine(ref, opts = {}) {
    const line = state.lineMap.get(ref);
    if (!line) return;

    if (state.hidden.has(ref)) {
      state.hidden.delete(ref);
      const obj = state.lineLayers.get(ref);
      if (obj) {
        state.map.addLayer(obj.group);
        if (obj.badge) state.map.addLayer(obj.badge);
      }
      updateStationVisibility();
      updateLineRows();
    }

    state.selectedLine = ref;
    state.selectedStation = null;
    if (state.pulse) {
      state.map.removeLayer(state.pulse);
      state.pulse = null;
    }

    updateLineRows();
    applyLineEmphasis();
    openDetail(lineDetailHTML(line));

    if (!opts.skipHash) setHash(`#/line/${encodeURIComponent(ref)}`);

    if (opts.focus !== false && window.innerWidth > MOBILE_BREAKPOINT) {
      const pts = [];
      line.shape.forEach((chain) => chain.forEach((p) => pts.push([p[0], p[1]])));
      if (pts.length) {
        const focusMode = window.innerWidth <= 1360;
        const detailW = el.detail.getBoundingClientRect().width || 394;
        state.map.flyToBounds(L.latLngBounds(pts), {
          paddingTopLeft: focusMode ? [24, 84] : [368, 88],
          paddingBottomRight: focusMode ? [detailW + 24, 52] : [430, 52],
          maxZoom: 13.4,
          duration: 0.65,
        });
      }
    }

    const row = el.lineList.querySelector(`.line-row[data-ref="${ref}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
    el.hint.classList.add('hide');
  }

  function selectStation(name, opts = {}) {
    const st = state.stationMap.get(name);
    if (!st) return;

    // 若站点只属于被隐藏的线路，先恢复该线路
    const visibleLine = st.lines.find((r) => !state.hidden.has(r));
    if (!visibleLine) {
      const ref = st.lines[0];
      state.hidden.delete(ref);
      const obj = state.lineLayers.get(ref);
      if (obj) {
        state.map.addLayer(obj.group);
        if (obj.badge) state.map.addLayer(obj.badge);
      }
      updateStationVisibility();
      updateLineRows();
    }

    state.selectedStation = name;
    state.selectedLine = null;
    updateLineRows();
    applyLineEmphasis();

    if (state.pulse) state.map.removeLayer(state.pulse);
    const pulseIcon = L.divIcon({
      className: '',
      html: `<div class="station-pulse" style="--c:${lineColor(st.lines[0])}"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
    state.pulse = L.marker([st.lat, st.lon], {
      icon: pulseIcon,
      interactive: false,
      keyboard: false,
      zIndexOffset: 900,
    }).addTo(state.map);

    // 局部详情需要 positions：本地网络数据不含，按需从后端取
    openDetail(stationDetailHTML(st));

    if (opts.skipHash) {
      if (!st.positions) loadStationDetail(name);
    } else {
      setHash(`#/station/${encodeURIComponent(name)}`);
      if (!st.positions) loadStationDetail(name);
    }

    if (opts.focus !== false) {
      const mobile = window.innerWidth <= MOBILE_BREAKPOINT;
      const detailW = el.detail.getBoundingClientRect().width || 394;
      const dLat = 0.0026;
      const dLon = 0.0042;
      const b = L.latLngBounds([st.lat - dLat, st.lon - dLon], [st.lat + dLat, st.lon + dLon]);
      state.map.flyToBounds(b, {
        paddingTopLeft: mobile ? [24, 110] : [60, 80],
        paddingBottomRight: mobile
          ? [24, Math.min(Math.round(window.innerHeight * 0.72) + 16, window.innerHeight - 120)]
          : [window.innerWidth <= 1360 ? detailW + 24 : 430, 80],
        maxZoom: 15.4,
        duration: 0.55,
      });
    }
    el.hint.classList.add('hide');
  }

  async function loadStationDetail(name) {
    try {
      const res = await fetch('/api/stations/' + encodeURIComponent(name) + '?city=' + encodeURIComponent(state.city));
      if (!res.ok) return;
      const detail = await res.json();
      if (state.selectedStation !== name) return;
      const base = state.stationMap.get(name);
      if (base) Object.assign(base, detail);
      openDetail(stationDetailHTML(base));
    } catch (e) {
      /* 保持基础详情 */
    }
  }

  /* ---------------- 搜索 ---------------- */

  function highlight(text, q) {
    const src = String(text || '');
    const idx = src.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return escapeHtml(src);
    return `${escapeHtml(src.slice(0, idx))}<mark>${escapeHtml(src.slice(idx, idx + q.length))}</mark>${escapeHtml(src.slice(idx + q.length))}`;
  }

  function openSearch() {
    el.searchWrap.classList.add('open');
  }

  function closeSearch() {
    el.searchPanel.hidden = true;
    state.searchItems = [];
    state.searchActive = -1;
  }

  function renderSearch(data, q) {
    const html = [];
    if (data.lines.length) {
      html.push('<div class="search-group-label">线路 / LINES</div>');
      data.lines.forEach((line) => {
        html.push(`
          <button class="search-item" type="button" data-type="line" data-ref="${line.ref}">
            <span class="si-badge" style="--c:${line.color}"></span>
            <span class="si-main">
              <span class="si-name">${highlight(line.name, q)}</span>
              <span class="si-sub">${escapeHtml(line.from)} → ${escapeHtml(line.to)} · ${line.station_count} 站 · ${line.length.toFixed(1)} km</span>
            </span>
          </button>`);
      });
    }
    if (data.stations.length) {
      html.push('<div class="search-group-label">车站 / STATIONS</div>');
      data.stations.forEach((st) => {
        html.push(`
          <button class="search-item" type="button" data-type="station" data-name="${escapeHtml(st.name)}">
            <span class="si-badge dot" style="--c:${lineColor(st.lines[0])}"></span>
            <span class="si-main">
              <span class="si-name">${highlight(st.name, q)} <span style="font-weight:400;color:#98a2b3;font-size:9px">${escapeHtml(st.name_en || '')}</span></span>
              <span class="si-sub">${st.lines.map((r) => escapeHtml(refLabel(r))).join(' · ')}${st.status !== 'operating' ? ' · 暂缓开通' : ''}</span>
            </span>
          </button>`);
      });
    }
    if (!html.length) {
      html.push('<div class="search-empty">没有找到匹配的线路或车站</div>');
    }
    el.searchPanel.innerHTML = html.join('');
    el.searchPanel.hidden = false;
    state.searchItems = Array.from(el.searchPanel.querySelectorAll('.search-item'));
    state.searchActive = -1;
  }

  async function doSearch(q) {
    const token = ++state.searchToken;
    el.searchClear.hidden = !q;
    if (!q) {
      closeSearch();
      return;
    }
    try {
      const res = await fetch('/api/search?q=' + encodeURIComponent(q) + '&city=' + encodeURIComponent(state.city));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (token !== state.searchToken) return;
      renderSearch(data, q);
    } catch (e) {
      if (token !== state.searchToken) return;
      el.searchPanel.innerHTML = '<div class="search-empty">搜索暂不可用</div>';
      el.searchPanel.hidden = false;
    }
  }

  function moveSearchActive(delta) {
    if (!state.searchItems.length) return;
    state.searchActive = (state.searchActive + delta + state.searchItems.length) % state.searchItems.length;
    state.searchItems.forEach((item, i) => item.classList.toggle('active', i === state.searchActive));
    state.searchItems[state.searchActive].scrollIntoView({ block: 'nearest' });
  }

  function activateSearchItem(item) {
    if (!item) return;
    if (item.dataset.type === 'line') selectLine(item.dataset.ref);
    if (item.dataset.type === 'station') selectStation(item.dataset.name);
    closeSearch();
    el.searchInput.blur();
    el.searchInput.value = '';
    el.searchClear.hidden = true;
  }

  /* ---------------- 事件绑定 ---------------- */

  function bindUI() {
    let searchTimer = null;
    el.searchInput.addEventListener('input', () => {
      const q = el.searchInput.value.trim();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => doSearch(q), 140);
    });

    el.searchInput.addEventListener('focus', () => {
      openSearch();
      if (el.searchInput.value.trim()) doSearch(el.searchInput.value.trim());
    });

    el.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSearchActive(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSearchActive(-1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const item = state.searchItems[state.searchActive] || state.searchItems[0];
        activateSearchItem(item);
      } else if (e.key === 'Escape') {
        closeSearch();
        el.searchInput.blur();
      }
    });

    el.searchClear.addEventListener('click', () => {
      el.searchInput.value = '';
      el.searchClear.hidden = true;
      closeSearch();
      el.searchInput.focus();
    });

    el.searchPanel.addEventListener('click', (e) => {
      const item = e.target.closest('.search-item');
      if (item) activateSearchItem(item);
    });

    document.addEventListener('click', (e) => {
      if (!el.searchWrap.contains(e.target)) closeSearch();
      if (!e.target.closest('#city-switch')) closeCityMenu();
    });

    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        el.searchInput.focus();
        el.searchInput.select();
      }
      if (e.key === 'Escape') {
        if (el.cityMenu && el.cityMenu.classList.contains('open')) closeCityMenu();
        else if (!el.searchPanel.hidden) closeSearch();
        else if (state.selectedLine || state.selectedStation) closeDetail();
        closeMobilePanel();
      }
    });

    el.lineList.addEventListener('click', (e) => {
      const eye = e.target.closest('[data-eye]');
      if (eye) {
        e.stopPropagation();
        toggleLine(eye.dataset.eye);
        return;
      }
      const row = e.target.closest('.line-row');
      if (row) selectLine(row.dataset.ref);
    });

    el.lineList.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.target.closest('.eye-btn')) return;
      const row = e.target.closest('.line-row');
      if (!row) return;
      e.preventDefault();
      selectLine(row.dataset.ref);
    });

    el.toggleAll.addEventListener('click', toggleAllLines);
    el.lineList.addEventListener('scroll', updateListFade);
    window.addEventListener('resize', updateListFade);

    el.basemap.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-basemap]');
      if (btn) applyBasemap(btn.dataset.basemap);
    });

    if (el.cityTrigger) {
      el.cityTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = el.cityMenu.classList.toggle('open');
        el.cityTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }
    if (el.cityMenu) {
      el.cityMenu.addEventListener('click', (e) => {
        const opt = e.target.closest('.city-option');
        if (!opt) return;
        closeCityMenu();
        switchCity(opt.dataset.city);
      });
    }

    el.panelToggle.addEventListener('click', () => {
      if (el.panel.classList.contains('mobile-open')) closeMobilePanel();
      else openMobilePanel();
    });

    el.backdrop.addEventListener('click', closeMobilePanel);
    el.panelClose.addEventListener('click', closeMobilePanel);
    el.panelCollapse.addEventListener('click', () => setNetworkCollapsed(true));
    el.networkTab.addEventListener('click', () => setNetworkCollapsed(false));
    el.detailTab.addEventListener('click', () => setDetailCollapsed(false));

    window.addEventListener('resize', () => {
      if (window.innerWidth > MOBILE_BREAKPOINT) closeMobilePanel();
      if (window.innerWidth <= MOBILE_BREAKPOINT && state.detailCollapsed) setDetailCollapsed(false);
      updateSideTabs();
    });

    window.addEventListener('hashchange', () => {
      if (!location.hash) {
        closeDetail({ skipHash: true });
        return;
      }
      applyHash();
    });

    el.detail.addEventListener('click', (e) => {
      if (e.target.closest('[data-collapse-detail]')) {
        setDetailCollapsed(true);
        return;
      }
      if (e.target.closest('[data-close]')) {
        closeDetail();
        return;
      }
      const stationNode = e.target.closest('[data-station]');
      if (stationNode) {
        selectStation(stationNode.dataset.station);
        return;
      }
      const lineNode = e.target.closest('[data-line]');
      if (lineNode) {
        selectLine(lineNode.dataset.line);
        return;
      }
      const center = e.target.closest('[data-center]');
      if (center) {
        const st = state.stationMap.get(center.dataset.center);
        if (st) {
          const mobile = window.innerWidth <= MOBILE_BREAKPOINT;
          state.map.flyTo([st.lat, st.lon], Math.max(state.map.getZoom(), 15.4), { duration: 0.55 });
          if (mobile) {
            setTimeout(() => {
              state.map.panBy([0, -180], { animate: true });
            }, 580);
          }
        }
      }
    });
  }

  boot();
})();
