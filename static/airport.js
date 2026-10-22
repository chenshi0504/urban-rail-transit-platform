/* ============================================================
   公共交通设施平台 · 成都天府国际机场 3D 数字孪生
   Three.js + OSM 真实几何
   ============================================================ */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const DEG = Math.PI / 180;
  const M_PER_DEG = 111320;

  const state = {
    data: null,
    base: null,
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    origin: [30.3125, 104.4415],
    groups: {},
    labels: [],
    aircraft: [],
    camTween: null,
    autoRotate: false,
    ready: false,
    needsRender: true,
    theme: 'light',
    terminalMats: [],
    airfieldMats: {},
    trackMats: null,
    lights: null,
    groundMat: null,
    groundPadMat: null,
    regionMat: null,
    coreMat: null,
    farMat: null,
    farMesh: null,
    farMeta: null,
    regionMeta: null,
    terminalEdgeMats: [],
    railMat: null,
    interiorOn: false,
    taxi: [],
    vehicles: [],
    trains: [],
    roads: null,
    roadMats: null,
    parkedCount: 0,
  };

  const THEME = {
    light: {
      bg: 0xdfe7ef, ground: 0xffffff, hemi: 0.82, sun: 0.95, fill: 0.22,
      terminalRoof: 0xf3f7fb, terminalWall: 0xc7d3e0,
      gtcRoof: 0xe6edf3, gtcWall: 0xc2ccd6,
      hotelRoof: 0xc7dbe8, hotelWall: 0x8fadc2,
      parkingRoof: 0xd3dae1, parkingWall: 0xb6bfc9,
      supportRoof: 0xe1e7ed, supportWall: 0xc5cdd6,
      runway: 0x24282e, taxi: 0x5d6772, apron: 0x98a3ae,
      trackApproach: 0x22d3ee, trackDepart: 0xfbbf24, trackOpacity: [0.26, 0.22],
      edge: 0x46525f, edgeOpacity: 0.62, band: 0x7d8fa2, bandOpacity: 0.3,
      rail: 0xe4002b, railOpacity: 0.5,
    },
    dark: {
      bg: 0x05070a, ground: 0x05080c, hemi: 0.42, sun: 0.45, fill: 0.15,
      terminalRoof: 0x1a232c, terminalWall: 0x0a0e12,
      gtcRoof: 0x121920, gtcWall: 0x080b0e,
      hotelRoof: 0x101a22, hotelWall: 0x070b0f,
      parkingRoof: 0x0f1419, parkingWall: 0x080b0e,
      supportRoof: 0x11161b, supportWall: 0x080b0e,
      runway: 0x0c1116, taxi: 0x10161c, apron: 0x151c23,
      trackApproach: 0x7defff, trackDepart: 0xffe066, trackOpacity: [0.72, 0.64],
      edge: 0xa8c2d8, edgeOpacity: 0.52, band: 0x8ea6bd, bandOpacity: 0.36,
      rail: 0xff6072, railOpacity: 0.8,
    },
  };

  // 机场周边路网配色：浅色参考苹果地图日间，深色下提亮为清晰的亮线
  const ROAD_STYLE = {
    light: {
      casing: 0xbfc9d4, motorway: 0xf0a63c, trunk: 0xf6bd63, primary: 0xffd27a,
      link: 0xffd88a, secondary: 0xffffff, tertiary: 0xf5f8fb,
      unclassified: 0xe9eef3, residential: 0xe9eef3, service: 0xe3e8ee,
    },
    dark: {
      casing: 0x0a0e13, motorway: 0xffab3d, trunk: 0xffc266, primary: 0xffe08a,
      link: 0xffcf80, secondary: 0xaebdcc, tertiary: 0x93a3b3,
      unclassified: 0x7d8a96, residential: 0x7d8a96, service: 0x6b7783,
    },
  };

  // 主干道适当加宽，保证远景下仍能看出路网骨架
  const ROAD_SCALE = {
    motorway: 1.3, trunk: 1.25, primary: 1.2,
    secondary: 1.1, tertiary: 1.02,
  };

  // 主题跟随本地时间：08:00–18:00 浅色，其余时段深色
  function themeByClock(date = new Date()) {
    const h = date.getHours();
    return h >= 8 && h < 18 ? 'light' : 'dark';
  }

  function px(lon) {
    return (lon - state.origin[1]) * M_PER_DEG * Math.cos(state.origin[0] * DEG);
  }
  function pz(lat) {
    return -(lat - state.origin[0]) * M_PER_DEG;
  }
  function v3(lat, lon, y = 0) {
    return new THREE.Vector3(px(lon), y, pz(lat));
  }

  function tile2lon(x, z) {
    return (x / Math.pow(2, z)) * 360 - 180;
  }
  function tile2lat(y, z) {
    const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }

  function centroid(poly) {
    let x = 0;
    let z = 0;
    poly.forEach((p) => {
      x += px(p[1]);
      z += pz(p[0]);
    });
    return { x: x / poly.length, z: z / poly.length };
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function toast(message, ms = 2400) {
    const el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => { el.hidden = true; }, 260);
    }, ms);
  }

  /* ---------------- 几何工具 ---------------- */

  function ribbon(points, width, y) {
    const half = width / 2;
    const verts = [];
    const idx = [];
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(points.length - 1, i + 1)];
      const ax = px(prev[1]);
      const az = pz(prev[0]);
      const bx = px(next[1]);
      const bz = pz(next[0]);
      let dx = bx - ax;
      let dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const nx = -dz;
      const nz = dx;
      const x = px(p[1]);
      const z = pz(p[0]);
      verts.push(x + nx * half, y, z + nz * half, x - nx * half, y, z - nz * half);
      if (i > 0) {
        const k = i * 2;
        idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  function offsetPolyline(points, offsetMeters) {
    // 用于跑道边线
    const out = [];
    for (let i = 0; i < points.length; i += 1) {
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(points.length - 1, i + 1)];
      const ax = px(prev[1]);
      const az = pz(prev[0]);
      const bx = px(next[1]);
      const bz = pz(next[0]);
      let dx = bx - ax;
      let dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const nx = -dz;
      const nz = dx;
      const lat = points[i][0] + (nz * offsetMeters) / M_PER_DEG;
      const lon = points[i][1] + (nx * offsetMeters) / (M_PER_DEG * Math.cos(points[i][0] * DEG));
      out.push([lat, lon]);
    }
    return out;
  }

  function shapeFromPolygon(poly) {
    const shape = new THREE.Shape();
    poly.forEach((p, i) => {
      const x = px(p[1]);
      const z = pz(p[0]);
      if (i === 0) shape.moveTo(x, -z);
      else shape.lineTo(x, -z);
    });
    shape.closePath();
    return shape;
  }

  let labelSeq = 0;

  function labelSprite(text, opts = {}) {
    const fs = opts.fontSize || 42;
    const pad = 26;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = `600 ${fs}px "PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.font = font;
    const tw = ctx.measureText(text).width;
    canvas.width = Math.ceil(tw + pad * 2);
    canvas.height = fs + pad * 1.2;
    const c = canvas.getContext('2d');
    c.font = font;
    const r = 18;
    c.fillStyle = opts.bg || 'rgba(255,255,255,0.9)';
    c.beginPath();
    c.roundRect(0, 0, canvas.width, canvas.height, r);
    c.fill();
    c.fillStyle = opts.color || '#1c1c1e';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, canvas.width / 2, canvas.height / 2 + 1);
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: false, depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    const k = opts.scale || 0.62;
    sprite.scale.set(canvas.width * k, canvas.height * k, 1);
    // 每个标签使用唯一且固定的渲染顺序，避免相机移动时相互重排
    sprite.renderOrder = 100 + (labelSeq % 800);
    labelSeq += 1;
    return sprite;
  }

  /* ---------------- 相机控制器 ---------------- */

  function createCameraRig(camera, element) {
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const rig = {
      target: new THREE.Vector3(),
      radius: 7000,
      theta: 0.9,
      phi: 1.0,
      minRadius: 42,
      maxRadius: 32000,
      minPhi: 0.035,
      maxPhi: Math.PI / 2 - 0.04,
      autoRotate: false,
      autoRotateSpeed: 0.55,
      tween: null,
      enabled: true,
      dirty: true,
    };
    const keys = new Set();
    const pointers = new Map();
    let dragging = false;
    let dragButton = 0;
    let lastX = 0;
    let lastY = 0;
    let lastTime = performance.now();
    let pinchStart = 0;
    let pinchRadius = 0;

    function pinchDistance() {
      const it = pointers.values();
      const a = it.next().value;
      const b = it.next().value;
      if (!a || !b) return 0;
      return Math.hypot(a.x - b.x, a.y - b.y) || 1;
    }

    function setByPosition(pos, target) {
      rig.dirty = true;
      rig.target.copy(target);
      const offset = pos.clone().sub(target);
      const len = offset.length() || 1;
      rig.radius = clamp(len, rig.minRadius, rig.maxRadius);
      rig.phi = clamp(Math.acos(clamp(offset.y / len, -1, 1)), rig.minPhi, rig.maxPhi);
      rig.theta = Math.atan2(offset.z, offset.x);
    }

    function tweenTo(pos, target, duration = 1100) {
      const offset = pos.clone().sub(target);
      const len = offset.length() || 1;
      rig.tween = {
        from: { target: rig.target.clone(), radius: rig.radius, theta: rig.theta, phi: rig.phi },
        to: {
          target: target.clone(),
          radius: clamp(len, rig.minRadius, rig.maxRadius),
          theta: Math.atan2(offset.z, offset.x),
          phi: clamp(Math.acos(clamp(offset.y / len, -1, 1)), rig.minPhi, rig.maxPhi),
        },
        start: performance.now(),
        duration,
      };
    }

    function update(now) {
      const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;

      if (rig.tween) {
        const p = Math.min(1, (now - rig.tween.start) / rig.tween.duration);
        const e = easeInOutCubic(p);
        const { from, to } = rig.tween;
        rig.target.lerpVectors(from.target, to.target, e);
        rig.radius = from.radius + (to.radius - from.radius) * e;
        let dTheta = ((to.theta - from.theta + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        rig.theta = from.theta + dTheta * e;
        rig.phi = from.phi + (to.phi - from.phi) * e;
        if (p >= 1) rig.tween = null;
      } else if (rig.autoRotate && !dragging) {
        rig.theta -= 0.28 * dt;
      }

      // 方向键 / WASD：平移观察位置（前后左右），步长随视距缩放
      let keyMove = false;
      if (keys.size) {
        const step = rig.radius * 0.95 * dt;
        const fx = -Math.cos(rig.theta);
        const fz = -Math.sin(rig.theta);
        const rx = -fz;
        const rz = fx;
        if (keys.has('ArrowUp') || keys.has('w')) {
          rig.target.x += fx * step; rig.target.z += fz * step; keyMove = true;
        }
        if (keys.has('ArrowDown') || keys.has('s')) {
          rig.target.x -= fx * step; rig.target.z -= fz * step; keyMove = true;
        }
        if (keys.has('ArrowRight') || keys.has('d')) {
          rig.target.x += rx * step; rig.target.z += rz * step; keyMove = true;
        }
        if (keys.has('ArrowLeft') || keys.has('a')) {
          rig.target.x -= rx * step; rig.target.z -= rz * step; keyMove = true;
        }
      }

      const sinPhi = Math.sin(rig.phi);
      camera.position.set(
        rig.target.x + rig.radius * sinPhi * Math.cos(rig.theta),
        rig.target.y + rig.radius * Math.cos(rig.phi),
        rig.target.z + rig.radius * sinPhi * Math.sin(rig.theta)
      );
      camera.lookAt(rig.target);
      const dirty = rig.dirty;
      rig.dirty = false;
      return !!rig.tween || dragging || keyMove || rig.autoRotate || dirty;
    }

    function onPointerDown(e) {
      if (!rig.enabled) return;
      if (e.button !== 0 && e.button !== 2) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        pinchStart = pinchDistance();
        pinchRadius = rig.radius;
        dragging = false;
        return;
      }
      if (pointers.size > 2) return;
      rig.tween = null;
      dragging = true;
      dragButton = e.button;
      lastX = e.clientX;
      lastY = e.clientY;
      try { element.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      element.style.cursor = 'grabbing';
      if (rig.autoRotate) {
        rig.autoRotate = false;
        const btn = document.querySelector('#orbit-btn');
        if (btn) btn.classList.remove('active');
      }
    }

    function onPointerMove(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && pinchStart) {
        rig.radius = clamp(pinchRadius * pinchStart / pinchDistance(), rig.minRadius, rig.maxRadius);
        return;
      }
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      if (dragButton === 2) {
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
        rig.target.addScaledVector(right, -dx * rig.radius * 0.00085);
        rig.target.y += dy * rig.radius * 0.00085;
        return;
      }

      const spin = 0.0042;
      if (e.ctrlKey || e.metaKey) {
        rig.phi = clamp(rig.phi - dy * spin, rig.minPhi, rig.maxPhi);
      } else {
        // 抓取式拖拽：画面内容跟随鼠标移动方向（向左拖，场景向左走）
        rig.theta -= dx * spin;
      }
    }

    function onPointerUp(e) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = 0;
      if (pointers.size === 0) {
        dragging = false;
        element.style.cursor = '';
      }
      try { element.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }

    function onWheel(e) {
      if (!rig.enabled) return;
      e.preventDefault();
      rig.tween = null;
      rig.radius = clamp(rig.radius * Math.exp(e.deltaY * 0.0009), rig.minRadius, rig.maxRadius);
      rig.dirty = true;
    }

    const PAN_KEYS = {
      ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1,
      w: 1, s: 1, a: 1, d: 1,
    };

    function onKeyDown(e) {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (PAN_KEYS[k]) {
        e.preventDefault();
        keys.add(k);
      }
    }

    function onKeyUp(e) {
      keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    }

    function onBlur() {
      keys.clear();
    }

    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerUp);
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    rig.update = update;
    rig.setByPosition = setByPosition;
    rig.tweenTo = tweenTo;
    return rig;
  }

  /* ---------------- 场景 ---------------- */

  function initScene() {
    const canvas = $('#scene');
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.NoToneMapping;
    // 固定绘制顺序，避免相机移动时透明对象按距离反复重排造成闪烁
    renderer.sortObjects = false;
    state.renderer = renderer;

    const scene = new THREE.Scene();
    // 不使用雾效：远距离拉远时保持沙盘式的清晰视野
    scene.background = new THREE.Color(0xdfe7ef);
    scene.fog = null;
    state.scene = scene;

    const camera = new THREE.PerspectiveCamera(
      46, window.innerWidth / window.innerHeight, 10, 45000
    );
    camera.position.set(6500, 5200, 7600);
    state.camera = camera;

    const controls = createCameraRig(camera, canvas);
    controls.target.set(0, 0, 0);
    controls.setByPosition(camera.position, controls.target);
    state.controls = controls;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8f9aa6, 0.82);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 0.95);
    sun.position.set(-5200, 7800, 4200);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xdfe9ff, 0.22);
    fill.position.set(5200, 3200, -4800);
    scene.add(fill);
    state.lights = { hemi, sun, fill };

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      state.needsRender = true;
    });

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
    }, false);
  }

  function basemapPlane(meta, url, y, onLoad) {
    const z = meta.zoom;
    const west = tile2lon(meta.x0, z);
    const east = tile2lon(meta.x1 + 1, z);
    const north = tile2lat(meta.y0, z);
    const south = tile2lat(meta.y1 + 1, z);
    const clat = (north + south) / 2;
    const clon = (west + east) / 2;
    const w = (east - west) * M_PER_DEG * Math.cos(clat * DEG);
    const h = (north - south) * M_PER_DEG;

    const texture = new THREE.TextureLoader().load(url, onLoad);
    texture.anisotropy = state.renderer.capabilities.getMaxAnisotropy();
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.encoding = THREE.sRGBEncoding;

    const mat = new THREE.MeshBasicMaterial({ map: texture });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(px(clon), y, pz(clat));
    state.scene.add(mesh);
    return { mesh, mat, w, h, clat, clon, texture };
  }

  /** 底图外缘柔化：拉远时像沙盘一样自然收边，而不是生硬的矩形裁切。 */
  let edgeFadeTex = null;
  function edgeFadeTexture() {
    if (edgeFadeTex) return edgeFadeTex;
    const n = 256;
    const band = Math.round(n * 0.14);
    const canvas = document.createElement('canvas');
    canvas.width = n;
    canvas.height = n;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, n, n);
    const paint = (x0, y0, x1, y1, gx0, gy0, gx1, gy1) => {
      const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(255,255,255,1)');
      ctx.fillStyle = g;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    };
    paint(0, 0, band, n, 0, 0, band, 0);
    paint(n - band, 0, n, n, n, 0, n - band, 0);
    paint(0, 0, n, band, 0, 0, 0, band);
    paint(0, n - band, n, n, 0, n, 0, n - band);
    edgeFadeTex = new THREE.CanvasTexture(canvas);
    edgeFadeTex.anisotropy = 4;
    return edgeFadeTex;
  }

  function applyEdgeFade(mat) {
    if (!mat) return;
    mat.alphaMap = edgeFadeTexture();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.needsUpdate = true;
  }

  function addGround() {
    const code = state.airport || 'tfu';
    // 远景观底图（z12，约 66 × 59 km）：拉到最大视野时仍有真实地图
    if (state.farMeta) {
      const far = basemapPlane(state.farMeta, `/static/data/${code}_far.jpg`, -5.6);
      state.farMat = far.mat;
      state.farMesh = far.mesh;
      applyEdgeFade(far.mat);
    }

    // 区域底图（z14，约 26 × 27 km）铺满视野，机场细节底图（z15）叠在其上，
    // 这样 3D 视野里的 OSM 范围与地铁线网图一样大，不会露出灰色底板。
    if (state.regionMeta) {
      const region = basemapPlane(state.regionMeta, `/static/data/${code}_region.jpg`, -3.6);
      state.regionMat = region.mat;
      state.regionTexture = region.texture;
      state.regionMesh = region.mesh;
      applyEdgeFade(region.mat);
    }

    const detail = basemapPlane(
      state.base, `/static/data/${code}_base.jpg`, -0.8, () => { state.ready = true; }
    );
    state.groundMat = detail.mat;
    state.groundMesh = detail.mesh;
    state.groundTexture = detail.texture;
    state.groundRect = { w: detail.w, h: detail.h, clat: detail.clat, clon: detail.clon };

    // 核心区高清底图，边缘径向渐隐，与外围底图融合
    if (state.coreMeta) {
      const c = state.coreMeta;
      const z = c.zoom;
      const west = tile2lon(c.x0, z);
      const east = tile2lon(c.x1 + 1, z);
      const north = tile2lat(c.y0, z);
      const south = tile2lat(c.y1 + 1, z);
      const clat = (north + south) / 2;
      const clon = (west + east) / 2;
      const cw = (east - west) * M_PER_DEG * Math.cos(clat * DEG);
      const ch = (north - south) * M_PER_DEG;
      const coreTex = new THREE.TextureLoader().load(`/static/data/${code}_core.jpg`);
      coreTex.anisotropy = state.renderer.capabilities.getMaxAnisotropy();
      coreTex.encoding = THREE.sRGBEncoding;
      const alphaTex = new THREE.TextureLoader().load('/static/data/core_alpha.png');
      const coreMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(cw, ch),
        new THREE.MeshBasicMaterial({
          map: coreTex,
          alphaMap: alphaTex,
          transparent: true,
          depthWrite: false,
        })
      );
      coreMesh.rotation.x = -Math.PI / 2;
      coreMesh.position.set(px(clon), -0.3, pz(clat));
      coreMesh.renderOrder = 1;
      state.scene.add(coreMesh);
      state.coreMesh = coreMesh;
      // 核心区底图必须跟随主题压暗，否则深色下会形成“聚光灯”亮斑
      state.coreMat = coreMesh.material;
    }

    // 大范围底色，避免纹理边缘露空（无光照，省一层 PBR 计算）
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(62000, 62000),
      new THREE.MeshBasicMaterial({ color: 0xdfe7ef })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(px(detail.clon), -7.2, pz(detail.clat));
    state.scene.add(pad);
    state.groundPadMat = pad.material;
  }

  function buildAirfield() {
    const group = new THREE.Group();
    const data = state.data;

    const runwayColors = ['#22d3ee', '#a78bfa', '#fbbf24'];
    const taxiPositions = [];
    const taxiIndices = [];

    data.taxiways.forEach((tw) => {
      const g = ribbon(tw.points, Math.max(10, tw.width || 20), 1.8);
      const pos = g.getAttribute('position').array;
      const idx = g.getIndex().array;
      const base = taxiPositions.length / 3;
      for (let i = 0; i < pos.length; i += 1) taxiPositions.push(pos[i]);
      for (let i = 0; i < idx.length; i += 1) taxiIndices.push(base + idx[i]);
    });

    const taxiGeo = new THREE.BufferGeometry();
    taxiGeo.setAttribute('position', new THREE.Float32BufferAttribute(taxiPositions, 3));
    taxiGeo.setIndex(taxiIndices);
    taxiGeo.computeVertexNormals();
    const taxiMat = new THREE.MeshStandardMaterial({
      color: 0x5d6772, roughness: 0.94, metalness: 0.02, side: THREE.DoubleSide,
    });
    const taxiMesh = new THREE.Mesh(taxiGeo, taxiMat);
    state.airfieldMats.taxi = taxiMat;
    group.add(taxiMesh);

    data.runways.forEach((rw, i) => {
      const color = runwayColors[i % runwayColors.length];
      const width = Math.max(30, rw.width || 45);
      const surfaceMat = new THREE.MeshStandardMaterial({
        color: 0x24282e, roughness: 0.9, metalness: 0.05, side: THREE.DoubleSide,
      });
      state.airfieldMats.runway = state.airfieldMats.runway || [];
      state.airfieldMats.runway.push(surfaceMat);
      const surface = new THREE.Mesh(ribbon(rw.points, width, 2.8), surfaceMat);
      group.add(surface);

      // 边线
      [-(width / 2 - 2.2), width / 2 - 2.2].forEach((off) => {
        const edge = offsetPolyline(rw.points, off);
        const mesh = new THREE.Mesh(
          ribbon(edge, 1.6, 2.95),
          new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
        );
        group.add(mesh);
      });

      // 中心虚线
      const pts = rw.points.map((p) => v3(p[0], p[1], 3.1));
      const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(
        lineGeo,
        new THREE.LineDashedMaterial({
          color: 0xf2f6fa, dashSize: 34, gapSize: 26, transparent: true, opacity: 0.92,
        })
      );
      line.computeLineDistances();
      group.add(line);

      // 端头跑道号
      [0, rw.points.length - 1].forEach((idx) => {
        const p = rw.points[idx];
        const sprite = labelSprite(rw.ref || `${String(i + 1).padStart(2, '0')}`, {
          fontSize: 38, scale: 0.5, bg: 'rgba(255,255,255,0.94)', color: '#1c1c1e',
        });
        sprite.position.copy(v3(p[0], p[1], 12));
        group.add(sprite);
      });

      // 端头标线（钢琴键）与接地带
      const va = v3(rw.points[0][0], rw.points[0][1], 3.0);
      const vb = v3(
        rw.points[rw.points.length - 1][0], rw.points[rw.points.length - 1][1], 3.0
      );
      const dir = vb.clone().sub(va).normalize();
      const yaw = Math.atan2(dir.x, dir.z);
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const markMat = new THREE.MeshBasicMaterial({ color: 0xf4f7fa });
      [-1, 1].forEach((end) => {
        const base = end < 0 ? va : vb;
        const inward = dir.clone().multiplyScalar(end < 0 ? 1 : -1);
        for (let k = 0; k < 6; k += 1) {
          const off = (k - 2.5) * (width * 0.14);
          const bar = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.16, 26), markMat);
          bar.position.copy(base).addScaledVector(inward, 30).addScaledVector(side, off);
          bar.rotation.y = yaw;
          group.add(bar);
        }
        [110, 190].forEach((dist) => {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(width * 0.62, 0.14, 4.5), markMat);
          bar.position.copy(base).addScaledVector(inward, dist).setY(3.0);
          bar.rotation.y = yaw;
          group.add(bar);
        });
      });
    });

    state.groups.airfield = group;
    state.scene.add(group);
  }

  function buildAprons() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x98a3ae, roughness: 0.96, metalness: 0.02,
      side: THREE.DoubleSide,
    });
    state.airfieldMats.apron = mat;
    state.data.aprons.forEach((ap) => {
      if (ap.polygon.length < 3) return;
      const shape = shapeFromPolygon(ap.polygon);
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = 0.9;
      group.add(mesh);
    });

    // 机位
    const standPos = [];
    state.data.stands.forEach((s) => {
      standPos.push(px(s.lon), 3.2, pz(s.lat));
    });
    if (standPos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(standPos, 3));
      const points = new THREE.Points(g, new THREE.PointsMaterial({
        color: 0x0a84ff, size: 9, sizeAttenuation: true,
        transparent: true, opacity: 0.9, depthWrite: false,
      }));
      points.renderOrder = 6;
      group.add(points);
    }

    const gatePos = [];
    state.data.gates.forEach((s) => {
      gatePos.push(px(s.lon), 3.2, pz(s.lat));
    });
    if (gatePos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(gatePos, 3));
      const points = new THREE.Points(g, new THREE.PointsMaterial({
        color: 0x34c759, size: 7, sizeAttenuation: true,
        transparent: true, opacity: 0.95, depthWrite: false,
      }));
      points.renderOrder = 7;
      group.add(points);
    }

    state.groups.aprons = group;
    state.scene.add(group);
  }

  /* ---------------- 建筑表面材质（程序化贴图） ---------------- */

  let facadeTex = null;
  let roofTex = null;
  let floorTex = null;

  function makeFacadeTexture() {
    if (facadeTex) return facadeTex;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const g = canvas.getContext('2d');
    g.fillStyle = '#fbfdff';
    g.fillRect(0, 0, size, size);
    // 每个贴图模块 7.2m：横向 4 个玻璃格，竖向 2 个楼层
    for (let y = 0; y < size; y += 64) {
      const grad = g.createLinearGradient(0, y, 0, y + 32);
      grad.addColorStop(0, 'rgba(96,124,152,0.34)');
      grad.addColorStop(1, 'rgba(196,212,226,0.06)');
      g.fillStyle = grad;
      g.fillRect(0, y + 2, size, 30);
      g.fillStyle = 'rgba(76,96,116,0.52)';
      g.fillRect(0, y, size, 2.6);
    }
    for (let x = 0; x < size; x += 32) {
      g.fillStyle = 'rgba(84,104,124,0.52)';
      g.fillRect(x, 0, 1.8, size);
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.fillRect(x + 1.8, 0, 1.2, size);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1 / 7.2, 1 / 7.2);
    tex.anisotropy = state.renderer ? state.renderer.capabilities.getMaxAnisotropy() : 1;
    facadeTex = tex;
    return tex;
  }

  function makeRoofTexture() {
    if (roofTex) return roofTex;
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, size, size);
    // 金属屋面分格（模块 12m）
    for (let i = 0; i < size; i += 64) {
      g.fillStyle = 'rgba(120,140,160,0.46)';
      g.fillRect(0, i, size, 1.6);
      g.fillRect(i, 0, 1.6, size);
    }
    for (let i = 0; i < 900; i += 1) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      g.fillStyle = `rgba(180,196,210,${0.04 + Math.random() * 0.05})`;
      g.fillRect(x, y, 1.2, 1.2);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1 / 12, 1 / 12);
    tex.anisotropy = state.renderer ? state.renderer.capabilities.getMaxAnisotropy() : 1;
    roofTex = tex;
    return tex;
  }

  function makeFloorTexture() {
    if (floorTex) return floorTex;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const g = canvas.getContext('2d');
    g.fillStyle = '#f4f7fa';
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < size; i += 32) {
      g.fillStyle = 'rgba(160,176,192,0.26)';
      g.fillRect(0, i, size, 1);
      g.fillRect(i, 0, 1, size);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1 / 7.2, 1 / 7.2);
    tex.anisotropy = state.renderer ? state.renderer.capabilities.getMaxAnisotropy() : 1;
    floorTex = tex;
    return tex;
  }

  function inPolygon(lat, lon, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const yi = poly[i][0];
      const xi = poly[i][1];
      const yj = poly[j][0];
      const xj = poly[j][1];
      if ((yi > lat) !== (yj > lat)
        && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  /** 檐口：沿屋面周边外扩的一圈金属收边，让体量更"实"。 */
  function fasciaGeometry(poly, yTop, depth, outset) {
    // 用首条边的外法向试探，决定整体外扩方向
    let sign = 1;
    {
      const a = poly[0];
      const b = poly[1 % poly.length];
      const ax = px(a[1]);
      const az = pz(a[0]);
      const bx = px(b[1]);
      const bz = pz(b[0]);
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      const mx = (ax + bx) / 2 + (dz / len) * 4;
      const mz = (az + bz) / 2 + (-dx / len) * 4;
      const lat = state.origin[0] - mz / M_PER_DEG;
      const lon = state.origin[1] + mx / (M_PER_DEG * Math.cos(state.origin[0] * DEG));
      if (inPolygon(lat, lon, poly)) sign = -1;
    }
    const pos = [];
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const ax = px(a[1]);
      const az = pz(a[0]);
      const bx = px(b[1]);
      const bz = pz(b[0]);
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      const nx = (dz / len) * sign * outset;
      const nz = (-dx / len) * sign * outset;
      const y0 = yTop - depth;
      const y1 = yTop;
      pos.push(
        ax + nx, y0, az + nz, bx + nx, y0, bz + nz, bx + nx, y1, bz + nz,
        ax + nx, y0, az + nz, bx + nx, y1, bz + nz, ax + nx, y1, az + nz
      );
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
  }

  /** 屋面羽毛状肋条：从中心向外放射，遇轮廓即止（呼应"太阳神鸟"屋面）。 */
  function buildRoofRibs(poly, yTop, count, width = 1.4) {
    const c = centroid(poly);
    const latAt = (z) => state.origin[0] - z / M_PER_DEG;
    const lonAt = (x) => state.origin[1] + x / (M_PER_DEG * Math.cos(state.origin[0] * DEG));
    const pos = [];
    for (let i = 0; i < count; i += 1) {
      const ang = (i / count) * Math.PI * 2 + 0.12;
      const dx = Math.cos(ang);
      const dz = Math.sin(ang);
      let reach = 0;
      for (let d = 10; d < 620; d += 5) {
        if (!inPolygon(latAt(c.z + dz * d), lonAt(c.x + dx * d), poly)) break;
        reach = d;
      }
      if (reach < 24) continue;
      const px2 = -dz;
      const pz2 = dx;
      const w = width / 2;
      const x0 = c.x + dx * 8;
      const z0 = c.z + dz * 8;
      const x1 = c.x + dx * reach;
      const z1 = c.z + dz * reach;
      pos.push(
        x0 + px2 * w, yTop, z0 + pz2 * w, x1 + px2 * w, yTop, z1 + pz2 * w,
        x1 - px2 * w, yTop, z1 - pz2 * w,
        x0 + px2 * w, yTop, z0 + pz2 * w, x1 - px2 * w, yTop, z1 - pz2 * w,
        x0 - px2 * w, yTop, z0 - pz2 * w
      );
    }
    if (!pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
  }

  function buildTerminals() {
    const group = new THREE.Group();
    const labels = new THREE.Group();
    // 屋面细节（羽毛肋、屋顶设备）单独成组，内部模式时隐藏
    const roofDetail = new THREE.Group();
    const palette = {
      terminal: { roof: 0xf3f7fb, wall: 0xc7d3e0, rough: 0.72, metal: 0.03 },
      gtc: { roof: 0xe6edf3, wall: 0xc2ccd6, rough: 0.75, metal: 0.03 },
      hotel: { roof: 0xc7dbe8, wall: 0x8fadc2, rough: 0.62, metal: 0.06 },
      parking: { roof: 0xd3dae1, wall: 0xb6bfc9, rough: 0.85, metal: 0.02 },
      support: { roof: 0xe1e7ed, wall: 0xc5cdd6, rough: 0.8, metal: 0.02 },
    };
    const centers = {};

    const fasciaMat = new THREE.MeshStandardMaterial({
      color: 0x74818f, roughness: 0.36, metalness: 0.62, side: THREE.DoubleSide,
    });
    const ribMat = new THREE.MeshStandardMaterial({
      color: 0xb9c9d9, roughness: 0.5, metalness: 0.34, side: THREE.DoubleSide,
    });
    const hatchMat = new THREE.MeshStandardMaterial({
      color: 0xc8d5e2, roughness: 0.72, metalness: 0.18,
    });

    state.data.terminals.forEach((t, tIndex) => {
      const style = palette[t.kind] || palette.support;
      const isMain = t.kind === 'terminal' || t.kind === 'gtc';
      const roofMat = new THREE.MeshStandardMaterial({
        color: style.roof,
        map: isMain ? makeRoofTexture() : null,
        roughness: isMain ? 0.5 : style.rough,
        metalness: isMain ? 0.26 : style.metal,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      const wallMat = new THREE.MeshStandardMaterial({
        color: style.wall,
        map: isMain ? makeFacadeTexture() : null,
        roughness: isMain ? 0.26 : Math.min(0.85, style.rough + 0.12),
        metalness: isMain ? 0.46 : style.metal,
      });
      state.terminalMats.push({ roofMat, wallMat, kind: t.kind });
      const edgeMat = new THREE.LineBasicMaterial({
        color: THEME.light.edge, transparent: true, opacity: THEME.light.edgeOpacity,
      });
      const bandMat = new THREE.LineBasicMaterial({
        color: THEME.light.band, transparent: true, opacity: THEME.light.bandOpacity,
      });
      state.terminalEdgeMats.push({ mat: edgeMat, kind: 'edge' });
      state.terminalEdgeMats.push({ mat: bandMat, kind: 'band' });
      t.polygons.forEach((poly, polyIndex) => {
        if (poly.length < 3) return;
        const shape = shapeFromPolygon(poly);
        const height = t.height || 24;
        const geo = new THREE.ExtrudeGeometry(shape, {
          depth: height, bevelEnabled: false, curveSegments: 2,
        });
        geo.rotateX(-Math.PI / 2);
        // 0 = 顶/底面（屋面），1 = 侧面（幕墙）
        group.add(new THREE.Mesh(geo, [roofMat, wallMat]));

        // 檐口金属收边
        group.add(new THREE.Mesh(fasciaGeometry(poly, height + 0.5, 2.4, 0.5), fasciaMat));

        // 屋面羽毛肋 + 屋顶设备（主航站楼大屋面）
        let polyArea = 0;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const xi = px(poly[i][1]);
          const zi = pz(poly[i][0]);
          const xj = px(poly[j][1]);
          const zj = pz(poly[j][0]);
          polyArea += xj * zi - xi * zj;
        }
        polyArea = Math.abs(polyArea / 2);
        if (t.kind === 'terminal' && polyArea > 16000) {
          const ribs = buildRoofRibs(poly, height + 0.55, 28, 2.2);
          if (ribs) roofDetail.add(new THREE.Mesh(ribs, ribMat));
        }
        if (t.kind === 'terminal' && polyArea > 26000) {
          const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), hatchMat, 16);
          const mtx = new THREE.Matrix4();
          const quat = new THREE.Quaternion();
          const scale = new THREE.Vector3();
          const posv = new THREE.Vector3();
          const cBox = centroid(poly);
          let placed = 0;
          let seed = 9301 + tIndex * 77;
          const rnd = () => {
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280;
          };
          for (let k = 0; k < 260 && placed < 16; k += 1) {
            const ox = (rnd() - 0.5) * 320;
            const oz = (rnd() - 0.5) * 280;
            const x = cBox.x + ox;
            const z = cBox.z + oz;
            const lat = state.origin[0] - z / M_PER_DEG;
            const lon = state.origin[1] + x / (M_PER_DEG * Math.cos(state.origin[0] * DEG));
            if (!inPolygon(lat, lon, poly)) continue;
            posv.set(x, height + 1.1, z);
            quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI);
            scale.set(5 + rnd() * 8, 2.2, 4 + rnd() * 6);
            mtx.compose(posv, quat, scale);
            inst.setMatrixAt(placed, mtx);
            placed += 1;
          }
          inst.count = placed;
          inst.instanceMatrix.needsUpdate = true;
          if (placed) roofDetail.add(inst);
        }

        const polyCenter = centroid(poly);
        const expand = (p, k) => {
          const x = px(p[1]);
          const z = pz(p[0]);
          return new THREE.Vector3(
            polyCenter.x + (x - polyCenter.x) * k,
            0,
            polyCenter.z + (z - polyCenter.z) * k
          );
        };

        const outline = poly.map((p) => {
          const v = expand(p, 1.004);
          v.y = (t.height || 24) + 2.0;
          return v;
        });
        const lineGeo = new THREE.BufferGeometry().setFromPoints(outline);
        group.add(new THREE.LineLoop(lineGeo, edgeMat));

        // 立面水平窗带，向外偏移避免与幕墙共面
        if (t.kind === 'terminal' || t.kind === 'gtc') {
          [0.34, 0.68].forEach((f) => {
            const y = (t.height || 24) * f;
            const bandPts = poly.map((p) => {
              const v = expand(p, 1.004);
              v.y = y;
              return v;
            });
            group.add(new THREE.LineLoop(
              new THREE.BufferGeometry().setFromPoints(bandPts), bandMat
            ));
          });
        }

        if (!centers[t.id]) centers[t.id] = centroid(poly);
      });

      if (t.kind === 'terminal') {
        const c = centers[t.id];
        if (c) {
          const name = t.name.includes('一号') ? 'T1 航站楼'
            : t.name.includes('二号') ? 'T2 航站楼' : t.name;
          const sprite = labelSprite(name, {
            fontSize: 44, scale: 0.58, bg: 'rgba(255,255,255,0.92)', color: '#1c1c1e',
          });
          sprite.position.set(c.x, (t.height || 42) + 92, c.z);
          labels.add(sprite);
        }
      }
    });

    if (centers['18562220']) state.t1 = centers['18562220'];
    if (centers['18562218']) state.t2 = centers['18562218'];

    // 通用兜底：按面积挑选主航站楼，兼容没有固定 OSM 关系 ID 的机场
    if (!state.t1 || !state.t2) {
      const ranked = state.data.terminals
        .filter((t) => t.kind === 'terminal' || t.kind === 'gtc')
        .map((t) => {
          const c = centers[t.id];
          if (!c) return null;
          let area = 0;
          (t.polygons || []).forEach((poly) => {
            let a = 0;
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i += 1) {
              a += px(poly[j][1]) * pz(poly[i][0]) - px(poly[i][1]) * pz(poly[j][0]);
            }
            area = Math.max(area, Math.abs(a / 2));
          });
          return { c, area };
        })
        .filter(Boolean)
        .sort((a, b) => b.area - a.area);
      if (!state.t1 && ranked[0]) state.t1 = ranked[0].c;
      if (!state.t2) state.t2 = (ranked[1] || ranked[0] || {}).c || state.t1;
    }

    state.groups.terminals = group;
    state.groups.labels = labels;
    state.groups.roofDetail = roofDetail;
    state.scene.add(group);
    state.scene.add(labels);
    state.scene.add(roofDetail);
  }

  function buildTracks() {
    const group = new THREE.Group();
    const data = state.data;
    const approachMat = new THREE.MeshBasicMaterial({
      color: 0x1f9fb5, side: THREE.DoubleSide,
    });
    const departMat = new THREE.MeshBasicMaterial({
      color: 0xc79a1f, side: THREE.DoubleSide,
    });
    state.trackMats = [approachMat, departMat];

    data.runways.forEach((rw, i) => {
      const n = rw.points.length;
      const a = rw.points[0];
      const b = rw.points[n - 1];
      const va = v3(a[0], a[1]);
      const vb = v3(b[0], b[1]);
      const dir = vb.clone().sub(va).normalize();

      // 进近（a 端）
      const approach = new THREE.CatmullRomCurve3([
        va.clone().addScaledVector(dir, -7600).setY(420),
        va.clone().addScaledVector(dir, -4200).setY(250),
        va.clone().addScaledVector(dir, -1500).setY(92),
        va.clone().addScaledVector(dir, -260).setY(16),
        va.clone().setY(3),
      ]);
      const approachMesh = new THREE.Mesh(
        new THREE.TubeGeometry(approach, 90, 6, 6, false), approachMat
      );
      approachMesh.renderOrder = 9;
      group.add(approachMesh);

      // 离场（b 端）
      const depart = new THREE.CatmullRomCurve3([
        vb.clone().setY(3),
        vb.clone().addScaledVector(dir, 900).setY(60),
        vb.clone().addScaledVector(dir, 3200).setY(210),
        vb.clone().addScaledVector(dir, 8200).setY(620),
      ]);
      const departMesh = new THREE.Mesh(
        new THREE.TubeGeometry(depart, 80, 5, 6, false), departMat
      );
      departMesh.renderOrder = 9;
      group.add(departMesh);

      state.aircraft.push({
        curve: approach,
        t: 0.15 + i * 0.28,
        speed: 0.028,
        mode: 'approach',
      });
      state.aircraft.push({
        curve: depart,
        t: 0.05 + i * 0.2,
        speed: 0.022,
        mode: 'depart',
      });
    });

    state.groups.tracks = group;
    state.scene.add(group);
  }

  const LIVERIES = [0x0a84ff, 0xd7263d, 0x1f7a4d, 0x8e5bd0, 0xd97706, 0x24405e];

  let shadowTex = null;
  function groundShadowTexture() {
    if (shadowTex) return shadowTex;
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(18,26,36,0.46)');
    grad.addColorStop(0.55, 'rgba(18,26,36,0.2)');
    grad.addColorStop(1, 'rgba(18,26,36,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    shadowTex = new THREE.CanvasTexture(canvas);
    return shadowTex;
  }

  /** 落地阴影：轻量伪阴影，避免开阴影贴图带来的性能开销。 */
  function addShadow(parent, w, l, localY) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, l),
      new THREE.MeshBasicMaterial({
        map: groundShadowTexture(), transparent: true, depthWrite: false,
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = localY;
    mesh.renderOrder = 2;
    parent.add(mesh);
    return mesh;
  }

  /* ---------------- 机型库（空客 / 波音，数据为真机量级） ---------------- */

  const AIRLINERS = {
    a320: { label: 'A320neo', L: 37.6, R: 1.98, span: 35.8, engines: 2, tip: 'sharklet' },
    a321: { label: 'A321neo', L: 44.5, R: 1.98, span: 35.8, engines: 2, tip: 'sharklet' },
    b738: { label: '737-800', L: 39.5, R: 1.95, span: 35.8, engines: 2, tip: 'blended' },
    a330: { label: 'A330-300', L: 63.6, R: 2.82, span: 60.3, engines: 2, tip: 'fence' },
    b789: { label: '787-9', L: 62.8, R: 2.85, span: 60.1, engines: 2, tip: 'raked' },
    a359: { label: 'A350-900', L: 66.8, R: 2.96, span: 64.75, engines: 2, tip: 'raked' },
    b748: { label: '747-8', L: 76.3, R: 3.2, span: 68.4, engines: 4, tip: 'raked', upperDeck: true },
  };

  /** 停机坪机型配比：窄体为主，少量宽体与货机。 */
  const PARKED_TYPES = [
    'a320', 'b738', 'a321', 'a320', 'b738', 'a330', 'a320', 'b789',
    'b738', 'a320', 'a321', 'b738', 'a359', 'a320', 'b748', 'b738',
    'a320', 'b789', 'a321', 'b738', 'a330', 'a320', 'b738', 'a359',
    'a320', 'b789',
  ];
  const TAXI_TYPES = ['a320', 'b738', 'a330', 'a321', 'b789'];
  const FLIGHT_TYPES = ['a320', 'b738', 'a330', 'b789', 'a359', 'b748'];

  /**
   * 客机模型（机头朝 +Z）：车削机身 + 后掠机翼 + 发动机吊挂 + 垂尾/平尾 + 起落架。
   * key 取 AIRLINERS 中的机型，尺寸均为真机米制量级。
   */
  function makeAirliner(key, opts = {}) {
    const spec = AIRLINERS[key] || AIRLINERS.a320;
    const L = spec.L;
    const R = spec.R;
    const span = spec.span;
    const g = new THREE.Group();
    const livery = opts.livery === undefined ? 0x0a84ff : opts.livery;

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xf7f9fc, roughness: 0.3, metalness: 0.3, side: THREE.DoubleSide,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: livery, roughness: 0.4, metalness: 0.25, side: THREE.DoubleSide,
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x1b222b, roughness: 0.32, metalness: 0.6,
    });
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0xc3ccd6, roughness: 0.5, metalness: 0.45,
    });

    // 机身轮廓：尾锥 → 等直段 → 机头（车削一次成型）
    const profile = [
      [0.02, -0.5], [0.22, -0.468], [0.46, -0.428], [0.7, -0.372],
      [0.87, -0.3], [0.96, -0.225], [1, -0.15], [1, 0.285],
      [0.985, 0.35], [0.93, 0.405], [0.8, 0.45], [0.6, 0.478],
      [0.34, 0.494], [0.1, 0.5],
    ];
    const fusGeo = new THREE.LatheGeometry(
      profile.map(([r, t]) => new THREE.Vector2(Math.max(0.03, r * R), t * L)), 24
    );
    const body = new THREE.Mesh(fusGeo, bodyMat);
    body.rotation.x = Math.PI / 2;
    g.add(body);

    // 747 标志性的上层客舱
    if (spec.upperDeck) {
      const hump = new THREE.Mesh(new THREE.SphereGeometry(R * 0.94, 18, 12), bodyMat);
      hump.scale.set(1, 0.78, 4.2);
      hump.position.set(0, R * 0.5, L * 0.24);
      g.add(hump);
    }

    // 舷窗带、腰线、驾驶舱风挡
    const cz0 = -L * 0.31;
    const cz1 = L * 0.34;
    const cLen = cz1 - cz0;
    [-1, 1].forEach((side) => {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.1, R * 0.24, cLen * 0.96), darkMat);
      win.position.set(side * R * 0.995, R * 0.36, (cz0 + cz1) / 2);
      g.add(win);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.1, R * 0.2, cLen), accentMat);
      stripe.position.set(side * R * 0.995, R * 0.02, (cz0 + cz1) / 2);
      g.add(stripe);
    });
    const shield = new THREE.Mesh(new THREE.BoxGeometry(R * 1.14, R * 0.3, R * 0.5), darkMat);
    shield.position.set(0, R * 0.58, L * 0.432);
    shield.rotation.x = -0.5;
    g.add(shield);

    // 机翼 / 平尾通用的后掠翼面
    const wingPanel = (spanX, rootC, tipC, sweepBack, thick, y, z, mat) => {
      const s = new THREE.Shape();
      s.moveTo(0, -rootC * 0.4);
      s.lineTo(0, rootC * 0.6);
      s.lineTo(spanX, rootC * 0.6 - sweepBack + tipC * 0.5);
      s.lineTo(spanX, rootC * 0.6 - sweepBack - tipC * 0.5);
      s.closePath();
      const geo = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false });
      geo.translate(0, 0, -thick / 2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(0, y, z);
      return mesh;
    };

    const rootC = L * 0.26;
    const tipC = L * (spec.tip === 'raked' ? 0.105 : 0.082);
    const sweepBack = span * 0.33;
    const wingY = -R * 0.12;
    const wingZ = -L * 0.03;
    [-1, 1].forEach((dir) => {
      const w = wingPanel(span / 2, rootC, tipC, sweepBack, Math.max(0.6, R * 0.32), wingY, wingZ, bodyMat);
      w.scale.x = dir;
      w.rotation.z = -dir * 0.05;
      g.add(w);

      if (spec.tip !== 'raked') {
        const h = spec.tip === 'blended' ? L * 0.075 : L * 0.055;
        const wl = new THREE.Mesh(new THREE.BoxGeometry(0.18, h, tipC * 0.95), accentMat);
        wl.position.set(
          dir * span / 2,
          wingY + h * 0.5,
          wingZ + rootC * 0.6 - sweepBack
        );
        wl.rotation.z = -dir * 0.14;
        g.add(wl);
      }
    });

    // 发动机：短舱 + 进气唇口 + 吊挂
    const engR = R * (spec.engines === 4 ? 0.56 : 0.62);
    const engFracs = spec.engines === 4 ? [0.17, 0.36] : [0.19];
    const engY = -R * 0.95;
    const engZ = -L * 0.02;
    engFracs.forEach((frac) => {
      [-1, 1].forEach((dir) => {
        const x = dir * span * frac;
        const nac = new THREE.Mesh(
          new THREE.CylinderGeometry(engR, engR * 0.9, L * 0.155, 16), metalMat
        );
        nac.rotation.x = Math.PI / 2;
        nac.position.set(x, engY, engZ);
        g.add(nac);
        const lip = new THREE.Mesh(
          new THREE.TorusGeometry(engR * 0.98, engR * 0.15, 8, 18), darkMat
        );
        lip.position.set(x, engY, engZ + L * 0.078);
        g.add(lip);
        const pylon = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, R * 0.55, L * 0.09), metalMat
        );
        pylon.position.set(x, engY + R * 0.5, engZ - L * 0.02);
        g.add(pylon);
      });
    });

    // 垂尾（航空公司涂装）
    const finH = L * 0.19;
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.lineTo(L * 0.16, 0);
    finShape.lineTo(L * 0.108, finH * 0.5);
    finShape.lineTo(L * 0.048, finH);
    finShape.lineTo(0, finH * 0.6);
    finShape.closePath();
    const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.55, bevelEnabled: false });
    finGeo.translate(0, 0, -0.275);
    const fin = new THREE.Mesh(finGeo, accentMat);
    fin.rotation.y = -Math.PI / 2;
    fin.position.set(0, R * 0.55, -L * 0.455);
    g.add(fin);

    // 平尾
    [-1, 1].forEach((dir) => {
      const hs = wingPanel(
        span * 0.19, L * 0.13, L * 0.05, span * 0.11, 0.45, R * 0.16, -L * 0.44, bodyMat
      );
      hs.scale.x = dir;
      g.add(hs);
    });

    if (opts.gear) {
      const gearMat = new THREE.MeshStandardMaterial({ color: 0x2b323a, roughness: 0.8 });
      const legGeo = new THREE.CylinderGeometry(0.24, 0.24, R * 0.9, 6);
      const wheelGeo = new THREE.CylinderGeometry(R * 0.3, R * 0.3, 0.42, 10);
      const mkGear = (x, z) => {
        const leg = new THREE.Mesh(legGeo, gearMat);
        leg.position.set(x, -R * 0.9, z);
        g.add(leg);
        const wheel = new THREE.Mesh(wheelGeo, darkMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, -R * 1.34, z);
        g.add(wheel);
      };
      mkGear(0, L * 0.2);
      mkGear(-R * 0.74, -L * 0.03);
      mkGear(R * 0.74, -L * 0.03);
    }

    g.userData.type = key;
    g.userData.label = spec.label;
    // 起落架轮底正好落在机坪面（约 y=1.0）上
    g.userData.groundY = R * 1.34 + 1.25;
    return g;
  }

  /** 兼容旧调用：未指定机型时按长度/半径映射到最接近的空客/波音机型。 */
  function makeAircraft(opts = {}) {
    if (opts.type && AIRLINERS[opts.type]) return makeAirliner(opts.type, opts);
    const L = opts.length || 38;
    const key = L >= 70 ? 'b748' : L >= 58 ? 'a330' : L >= 41 ? 'a321' : 'a320';
    return makeAirliner(key, opts);
  }

  /** 停机坪停靠的飞机：优先近机位，机头朝向最近的航站楼登机口。 */
  function buildParkedAircraft() {
    const group = state.groups.aircraft;
    const stands = state.data.stands || [];
    const gates = state.data.gates || [];
    if (!group || !stands.length) return;

    const ranked = stands.map((s) => {
      const x = px(s.lon);
      const z = pz(s.lat);
      let best = null;
      let bestD = Infinity;
      gates.forEach((gt) => {
        const gx = px(gt.lon);
        const gz = pz(gt.lat);
        const d = Math.hypot(gx - x, gz - z);
        if (d < bestD) { bestD = d; best = { x: gx, z: gz }; }
      });
      return { x, z, best, bestD };
    }).sort((a, b) => a.bestD - b.bestD);

    const picks = [];
    ranked.forEach((s) => {
      if (picks.length >= 26) return;
      const far = s.bestD > 130;
      if (picks.some((p) => Math.hypot(p.x - s.x, p.z - s.z) < (far ? 220 : 150))) return;
      picks.push(s);
    });

    picks.forEach((s, i) => {
      const type = PARKED_TYPES[i % PARKED_TYPES.length];
      const spec = AIRLINERS[type];
      const model = makeAirliner(type, { livery: LIVERIES[i % LIVERIES.length], gear: true });
      const py = model.userData.groundY;
      model.position.set(s.x, py, s.z);
      model.rotation.y = s.best ? Math.atan2(s.best.x - s.x, s.best.z - s.z) : 0;
      addShadow(model, spec.span * 0.9, spec.L * 1.05, 1.3 - py);
      group.add(model);
      state.parkedCount += 1;
    });
  }

  /** 滑行中的飞机：沿较长的滑行道往返滑行。 */
  function buildTaxiTraffic() {
    const group = state.groups.aircraft;
    const taxis = (state.data.taxiways || []).filter((t) => (t.points || []).length > 2);
    const candidates = [];
    taxis.forEach((tw) => {
      const pts = tw.points.map((p) => v3(p[0], p[1], 4.55));
      let len = 0;
      for (let i = 1; i < pts.length; i += 1) len += pts[i].distanceTo(pts[i - 1]);
      if (len > 900) candidates.push({ pts, len });
    });
    candidates.sort((a, b) => b.len - a.len);
    const picked = [];
    candidates.forEach((c) => {
      if (picked.length >= 5) return;
      const mid = c.pts[Math.floor(c.pts.length / 2)];
      if (picked.some((p) => p.mid.distanceTo(mid) < 700)) return;
      picked.push({ ...c, mid });
    });
    picked.forEach((c, i) => {
      const curve = new THREE.CatmullRomCurve3(c.pts);
      const type = TAXI_TYPES[i % TAXI_TYPES.length];
      const spec = AIRLINERS[type];
      const model = makeAirliner(type, {
        livery: LIVERIES[(i + 2) % LIVERIES.length], gear: true,
      });
      addShadow(model, spec.span * 0.92, spec.L * 1.1, 1.05 - 4.55);
      group.add(model);
      state.taxi.push({
        curve,
        len: curve.getLength(),
        t: 0.1 + i * 0.17,
        dir: i % 2 === 0 ? 1 : -1,
        speed: 7 + (i % 3) * 1.6,
        mesh: model,
      });
    });
  }

  function buildAircraft() {
    const group = new THREE.Group();
    state.aircraft.forEach((item, i) => {
      const type = FLIGHT_TYPES[i % FLIGHT_TYPES.length];
      const mesh = makeAirliner(type, { livery: LIVERIES[i % LIVERIES.length] });
      item.mesh = mesh;
      group.add(mesh);
    });
    state.groups.aircraft = group;
    state.scene.add(group);
  }

  /** 廊桥：从最近登机口伸向机位，含固定端转盘与支撑柱。 */
  function buildJetBridges() {
    const group = new THREE.Group();
    const stands = state.data.stands || [];
    const gates = state.data.gates || [];
    if (!stands.length || !gates.length) return;
    const deckMat = new THREE.MeshStandardMaterial({
      color: 0xe6edf4, roughness: 0.62, metalness: 0.16,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x9db4c9, roughness: 0.28, metalness: 0.45,
    });
    const usedStands = new Set();
    let built = 0;

    gates.forEach((gt) => {
      if (built >= 44) return;
      const gx = px(gt.lon);
      const gz = pz(gt.lat);
      let best = null;
      let bestD = Infinity;
      let bestIdx = -1;
      stands.forEach((s, idx) => {
        const sx = px(s.lon);
        const sz = pz(s.lat);
        const d = Math.hypot(sx - gx, sz - gz);
        if (d < bestD) { bestD = d; best = { x: sx, z: sz }; bestIdx = idx; }
      });
      if (!best || bestD < 26 || bestD > 150 || usedStands.has(bestIdx)) return;
      usedStands.add(bestIdx);
      built += 1;
      const ux = (best.x - gx) / bestD;
      const uz = (best.z - gz) / bestD;
      const yaw = Math.atan2(ux, uz);
      const len = Math.max(16, bestD - 18);

      const tube = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.2, len), deckMat);
      tube.position.set(gx + ux * (8 + len / 2), 7.2, gz + uz * (8 + len / 2));
      tube.rotation.y = yaw;
      group.add(tube);

      const glass = new THREE.Mesh(new THREE.BoxGeometry(3.46, 1.1, len * 0.86), glassMat);
      glass.position.set(gx + ux * (8 + len / 2), 7.9, gz + uz * (8 + len / 2));
      glass.rotation.y = yaw;
      group.add(glass);

      const cab = new THREE.Mesh(new THREE.BoxGeometry(5.6, 4.4, 5.2), deckMat);
      cab.position.set(gx + ux * (8 + len + 2), 6.8, gz + uz * (8 + len + 2));
      cab.rotation.y = yaw;
      group.add(cab);

      const rotunda = new THREE.Mesh(
        new THREE.CylinderGeometry(4.2, 4.2, 5.4, 14), deckMat
      );
      rotunda.position.set(gx + ux * 6, 6.4, gz + uz * 6);
      group.add(rotunda);

      const column = new THREE.Mesh(
        new THREE.CylinderGeometry(1.1, 1.4, 7.4, 8), deckMat
      );
      column.position.set(gx + ux * (8 + len * 0.55), 3.7, gz + uz * (8 + len * 0.55));
      group.add(column);
    });

    if (group.children.length) {
      state.groups.aprons.add(group);
      state.jetBridgeCount = built;
    }
  }

  /* ---------------- 地面服务车辆 ---------------- */

  function makeVehicle(kind, color) {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color, roughness: 0.55, metalness: 0.18,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x22282f, roughness: 0.85 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x1b2733, roughness: 0.25, metalness: 0.5,
    });

    if (kind === 'bus') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(3, 3.1, 12), bodyMat);
      body.position.y = 2.3;
      g.add(body);
      const band = new THREE.Mesh(new THREE.BoxGeometry(3.06, 1.1, 10.6), glassMat);
      band.position.y = 2.9;
      g.add(band);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.28, 11), bodyMat);
      roof.position.y = 3.95;
      g.add(roof);
    } else if (kind === 'fuel') {
      const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.1, 10.5), darkMat);
      chassis.position.y = 1.2;
      g.add(chassis);
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 7.2, 14), bodyMat);
      tank.rotation.x = Math.PI / 2;
      tank.position.set(0, 2.6, -1.2);
      g.add(tank);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.7, 2.4, 3.2), bodyMat);
      cab.position.set(0, 2.3, 4.4);
      g.add(cab);
      const wind = new THREE.Mesh(new THREE.BoxGeometry(2.76, 0.9, 3.0), glassMat);
      wind.position.set(0, 2.8, 4.5);
      g.add(wind);
    } else {
      // 行李牵引车 + 拖斗
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.2, 3.4), bodyMat);
      cab.position.set(0, 1.7, 2.4);
      g.add(cab);
      const wind = new THREE.Mesh(new THREE.BoxGeometry(2.66, 0.8, 3.2), glassMat);
      wind.position.set(0, 2.1, 2.4);
      g.add(wind);
      [-1, 1].forEach((dir) => {
        const cart = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.5, 3.2), bodyMat);
        cart.position.set(dir * 1.6, 1.3, -2.2);
        g.add(cart);
      });
    }

    const wheelGeo = new THREE.CylinderGeometry(0.85, 0.85, 0.7, 10);
    const axle = kind === 'bus' ? 3.6 : 3.0;
    [[-1.2, axle], [1.2, axle], [-1.2, -axle], [1.2, -axle]].forEach(([x, z]) => {
      const wheel = new THREE.Mesh(wheelGeo, darkMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.85, z);
      g.add(wheel);
    });
    return g;
  }

  function buildGroundVehicles() {
    const group = new THREE.Group();
    const aprons = (state.data.aprons || []).filter((a) => a.polygon && a.polygon.length >= 4);
    if (!aprons.length) return;
    const kinds = ['tug', 'bus', 'fuel', 'tug', 'bus', 'fuel', 'tug', 'bus', 'tug', 'fuel'];
    const colors = [0xf2b134, 0x2f8f4e, 0xf2f4f7, 0xe0712a, 0xf2b134, 0x2f5f9e];

    kinds.forEach((kind, i) => {
      const ap = aprons[(i * 5 + 2) % aprons.length];
      let cx = 0;
      let cz = 0;
      ap.polygon.forEach((p) => { cx += px(p[1]); cz += pz(p[0]); });
      cx /= ap.polygon.length;
      cz /= ap.polygon.length;
      let r = 40;
      ap.polygon.forEach((p) => {
        r = Math.max(r, Math.hypot(px(p[1]) - cx, pz(p[0]) - cz) * 0.45);
      });
      r = Math.min(r, 150);
      const pts = [];
      const phase = i * 0.8;
      for (let k = 0; k < 10; k += 1) {
        const a = (k / 10) * Math.PI * 2 + phase;
        pts.push(new THREE.Vector3(cx + Math.cos(a) * r, 2.4, cz + Math.sin(a) * r * 0.7));
      }
      const curve = new THREE.CatmullRomCurve3(pts, true);
      const mesh = makeVehicle(kind, colors[i % colors.length]);
      addShadow(mesh, kind === 'bus' ? 16 : 13, 8, 1.0 - 2.4);
      group.add(mesh);
      state.vehicles.push({
        curve,
        len: curve.getLength(),
        t: (i * 0.13) % 1,
        speed: kind === 'bus' ? 7.5 : 5.5,
        mesh,
      });
    });

    state.groups.vehicles = group;
    state.scene.add(group);
  }

  /* ---------------- 轨道交通列车（中国标准地铁 / 复兴号动车组） ---------------- */

  /** 车体断面：圆角矩形，用于挤出成车厢。 */
  function carBodyShape(w, h, r) {
    const s = new THREE.Shape();
    const x = w / 2;
    const y = h / 2;
    s.moveTo(-x + r, -y);
    s.lineTo(x - r, -y);
    s.quadraticCurveTo(x, -y, x, -y + r);
    s.lineTo(x, y - r);
    s.quadraticCurveTo(x, y, x - r, y);
    s.lineTo(-x + r, y);
    s.quadraticCurveTo(-x, y, -x, y - r);
    s.lineTo(-x, -y + r);
    s.quadraticCurveTo(-x, -y, -x + r, -y);
    return s;
  }

  /** 地铁动车（B 型车尺度，成都地铁涂装：银白车身 + 线路色腰带）。 */
  function makeMetroCar(color, opts = {}) {
    const g = new THREE.Group();
    const L = 21.4;
    const W = 3.0;
    const H = 3.05;
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xeef3f8, roughness: 0.3, metalness: 0.48,
    });
    // 线路色腰带：加自发光，远视距下也能看出是哪条线
    const accentMat = new THREE.MeshStandardMaterial({
      color, roughness: 0.36, metalness: 0.26,
      emissive: new THREE.Color(color).multiplyScalar(0.5),
      emissiveIntensity: 0.85,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x16232f, roughness: 0.15, metalness: 0.72,
    });
    const greyMat = new THREE.MeshStandardMaterial({
      color: 0xa9b5c1, roughness: 0.62, metalness: 0.3,
    });

    const geo = new THREE.ExtrudeGeometry(carBodyShape(W, H, 0.52), {
      depth: L - 0.7, bevelEnabled: false, curveSegments: 4,
    });
    geo.translate(0, 0, -(L - 0.7) / 2);
    const body = new THREE.Mesh(geo, bodyMat);
    body.position.y = 1.95;
    g.add(body);

    [-1, 1].forEach((side) => {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, L * 0.84), glassMat);
      win.position.set(side * (W / 2 - 0.03), 2.44, 0);
      g.add(win);
      const belt = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, L * 0.94), accentMat);
      belt.position.set(side * (W / 2 - 0.02), 1.2, 0);
      g.add(belt);
    });

    const skirt = new THREE.Mesh(new THREE.BoxGeometry(W * 0.94, 0.42, L * 0.99), greyMat);
    skirt.position.y = 0.52;
    g.add(skirt);

    // 车厢贯通道（风挡），让编组看起来是连续的一列车
    const gangMat = new THREE.MeshStandardMaterial({ color: 0x2b333a, roughness: 0.92 });
    const gang = new THREE.Mesh(new THREE.BoxGeometry(W * 0.6, H * 0.7, 1.6), gangMat);
    gang.position.set(0, 1.9, -L / 2 - 0.3);
    g.add(gang);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 0.14, L * 0.88), greyMat);
    roof.position.y = 3.54;
    g.add(roof);
    [-1, 1].forEach((s) => {
      const ac = new THREE.Mesh(new THREE.BoxGeometry(W * 0.46, 0.24, 2.6), greyMat);
      ac.position.set(0, 3.7, s * L * 0.2);
      g.add(ac);
    });

    if (opts.cab) {
      const nose = new THREE.Mesh(new THREE.SphereGeometry(W / 2, 16, 12), bodyMat);
      nose.scale.set(1, 1.02, 1.55);
      nose.position.set(0, 1.95, L / 2 - 0.55);
      g.add(nose);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(W * 0.72, 1.0, 0.34), glassMat);
      glass.position.set(0, 2.46, L / 2 + 1.5);
      glass.rotation.x = -0.22;
      g.add(glass);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.2, 0.18), accentMat);
      lamp.position.set(0, 1.2, L / 2 + 1.72);
      g.add(lamp);
    }

    if (opts.pantograph) {
      const barMat = new THREE.MeshStandardMaterial({
        color: 0x4a5560, roughness: 0.55, metalness: 0.7,
      });
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 0.6), barMat);
      base.position.set(0, 3.62, 0);
      g.add(base);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.3, 0.12), barMat);
      arm.position.set(0, 4.2, -0.2);
      arm.rotation.x = 0.42;
      g.add(arm);
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.34), barMat);
      head.position.set(0, 4.86, 0.34);
      g.add(head);
    }

    return g;
  }

  /**
   * 复兴号 CR400AF 动车组车厢（白底 + 红色腰带 + 长鼻锥）。
   * opts.cab 生成带流线型车头的头车。
   */
  function makeRailCar(color, opts = {}) {
    const g = new THREE.Group();
    const L = 25.7;
    const W = 3.36;
    const H = 3.4;
    const noseLen = opts.cab ? 4.6 : 0;
    const bodyLen = L - noseLen - 0.4;

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc, roughness: 0.24, metalness: 0.42,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color, roughness: 0.34, metalness: 0.3,
      emissive: new THREE.Color(color).multiplyScalar(0.45), emissiveIntensity: 0.8,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x16222e, roughness: 0.14, metalness: 0.74,
    });
    const greyMat = new THREE.MeshStandardMaterial({
      color: 0x9aa6b2, roughness: 0.55, metalness: 0.35,
    });

    const geo = new THREE.ExtrudeGeometry(carBodyShape(W, H, 0.66), {
      depth: bodyLen, bevelEnabled: false, curveSegments: 4,
    });
    geo.translate(0, 0, -bodyLen / 2);
    const body = new THREE.Mesh(geo, bodyMat);
    body.position.set(0, 2.02, -noseLen / 2);
    g.add(body);

    const bodyCz = -noseLen / 2;
    [-1, 1].forEach((side) => {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.92, bodyLen * 0.86), glassMat);
      win.position.set(side * (W / 2 - 0.03), 2.62, bodyCz);
      g.add(win);
      const belt = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.28, bodyLen * 0.99), accentMat);
      belt.position.set(side * (W / 2 - 0.02), 1.34, bodyCz);
      g.add(belt);
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, bodyLen * 0.99), greyMat);
      line.position.set(side * (W / 2 - 0.01), 1.02, bodyCz);
      g.add(line);
    });

    const skirt = new THREE.Mesh(new THREE.BoxGeometry(W * 0.94, 0.4, bodyLen * 0.99), greyMat);
    skirt.position.set(0, 0.6, bodyCz);
    g.add(skirt);

    const gangMat = new THREE.MeshStandardMaterial({ color: 0x2b333a, roughness: 0.92 });
    const gang = new THREE.Mesh(new THREE.BoxGeometry(W * 0.62, H * 0.72, 1.9), gangMat);
    gang.position.set(0, 1.96, -L / 2 - 0.3);
    g.add(gang);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, 0.12, bodyLen * 0.9), greyMat);
    roof.position.set(0, 3.76, bodyCz);
    g.add(roof);

    if (opts.pantograph) {
      const barMat = new THREE.MeshStandardMaterial({
        color: 0x4a5560, roughness: 0.5, metalness: 0.72,
      });
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.14, 0.7), barMat);
      base.position.set(0, 3.86, bodyCz);
      g.add(base);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.45, 0.12), barMat);
      arm.position.set(0, 4.5, bodyCz - 0.2);
      arm.rotation.x = 0.4;
      g.add(arm);
      const head = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 0.36), barMat);
      head.position.set(0, 5.2, bodyCz + 0.38);
      g.add(head);
    }

    if (opts.cab) {
      // 长鼻锥：接近 CR400AF 的流线型车头
      const prof = [
        [1.66, 0], [1.64, 0.7], [1.58, 1.5], [1.44, 2.3],
        [1.22, 3.0], [0.94, 3.6], [0.62, 4.05], [0.34, 4.4],
        [0.14, 4.58], [0.03, 4.66],
      ];
      const noseGeo = new THREE.LatheGeometry(
        prof.map(([r, y]) => new THREE.Vector2(r, y)), 22
      );
      const nose = new THREE.Mesh(noseGeo, bodyMat);
      nose.rotation.x = Math.PI / 2;
      nose.scale.y = 1.04;
      nose.position.set(0, 2.0, -noseLen / 2 + bodyLen / 2);
      g.add(nose);

      const glass = new THREE.Mesh(new THREE.BoxGeometry(W * 0.58, 0.8, 0.45), glassMat);
      glass.position.set(0, 2.92, L / 2 - 1.55);
      glass.rotation.x = -0.55;
      g.add(glass);

      const swoosh = new THREE.Mesh(new THREE.BoxGeometry(W * 0.62, 0.26, 1.7), accentMat);
      swoosh.position.set(0, 1.72, L / 2 - 2.2);
      swoosh.rotation.x = -0.34;
      g.add(swoosh);
    }

    return g;
  }

  function buildMetroTrains() {
    const group = new THREE.Group();
    const lines = (state.data.transit && state.data.transit.metro) || [];
    lines.forEach((line, li) => {
      let seg = null;
      (line.segments || []).forEach((s) => {
        if (!seg || s.length > seg.length) seg = s;
      });
      if (!seg || seg.length < 3) return;
      // 与线带一致：18 号线靠左、19 号线靠右，各自成列
      const lane = li === 0 ? -13 : 13;
      const path = offsetPolyline(seg, lane);
      const curve = new THREE.CatmullRomCurve3(path.map((p) => v3(p[0], p[1], 0.34)));
      const len = curve.getLength();
      if (len < 900) return;
      const color = new THREE.Color(line.color || '#0a84ff');
      [0, 1 / 3, 2 / 3].forEach((slot) => {
        const train = {
          curve, len, t: (0.05 + li * 0.27 + slot) % 1, speed: 19,
          spacing: 23.2, cars: [],
        };
        for (let i = 0; i < 5; i += 1) {
          const car = makeMetroCar(color, { cab: i === 0, pantograph: i === 2 });
          group.add(car);
          train.cars.push(car);
        }
        state.trains.push(train);
      });
    });

    // 成宜高铁列车（机场地下站方向）
    const railSegs = (state.data.transit && state.data.transit.rail) || [];
    let bestRail = null;
    railSegs.forEach((s) => {
      if (!bestRail || s.length > bestRail.length) bestRail = s;
    });
    if (bestRail && bestRail.length > 3) {
      const railCurve = new THREE.CatmullRomCurve3(
        bestRail.map((p) => v3(p[0], p[1], 0.34))
      );
      const railLen = railCurve.getLength();
      if (railLen > 1200) {
        const train = {
          curve: railCurve, len: railLen, t: 0.16, speed: 48,
          spacing: 27, cars: [],
        };
        const color = new THREE.Color('#d7263d');
        for (let i = 0; i < 6; i += 1) {
          const car = makeRailCar(color, { cab: i === 0, pantograph: i === 1 || i === 4 });
          group.add(car);
          train.cars.push(car);
        }
        state.trains.push(train);
      }
    }

    state.groups.metroTrains = group;
    state.scene.add(group);
  }

  /* ---------------- 塔台 ---------------- */

  function buildTower() {
    const base = state.t1 || { x: 0, z: 0 };
    const g = new THREE.Group();
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xd9e2ea, roughness: 0.6, metalness: 0.14,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x7d9cb8, roughness: 0.22, metalness: 0.5,
    });
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0xf4f7fa, roughness: 0.55, metalness: 0.1,
    });

    const baseGeo = new THREE.Mesh(new THREE.CylinderGeometry(17, 21, 32, 16), wallMat);
    baseGeo.position.y = 16;
    g.add(baseGeo);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 9.5, 62, 14), wallMat);
    shaft.position.y = 63;
    g.add(shaft);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(15, 11, 12, 18), glassMat);
    cab.position.y = 100;
    g.add(cab);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(15.6, 15.6, 2.2, 18), roofMat);
    ring.position.y = 106.5;
    g.add(ring);
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.7, 26, 6), roofMat
    );
    mast.position.y = 120;
    g.add(mast);

    g.position.set(base.x - 640, 0, base.z - 210);
    state.groups.terminals.add(g);
    state.towerPos = { x: base.x - 640, z: base.z - 210 };

    if (state.groups.labels) {
      const sprite = labelSprite('塔台 TOWER', {
        fontSize: 34, scale: 0.46, bg: 'rgba(255,255,255,0.92)', color: '#1c1c1e',
      });
      sprite.position.set(base.x - 640, 150, base.z - 210);
      state.groups.labels.add(sprite);
    }
  }

  /* ---------------- 航站楼内部 ---------------- */

  function buildInterior() {
    const group = new THREE.Group();
    const labels = new THREE.Group();
    const defs = [];

    const zoneTint = {
      checkin: 0x6fb0e6,
      security: 0xffb35c,
      baggage: 0x4f9fd4,
      transfer: 0x63bfa3,
      meet: 0x9fb0c0,
      waiting: 0x8fb8dd,
    };
    const levelTitles = {
      L1: 'L1 到达层 · 迎客 / 行李提取',
      L2: 'L2 出发层 · 值机 / 安检 / 候机',
      L3: 'L3 商业层 · 寻香里',
      L4: 'L4 出发层 · 值机大厅',
      L5: 'L5 商业层 · 拾味坊',
    };

    const floorMat = new THREE.MeshBasicMaterial({
      color: 0x5f7488,
      map: makeFloorTexture(),
      transparent: true,
      opacity: 0.97,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    // 上层楼板半透明，便于俯瞰时看到下层行李/到达层
    const floorMatUpper = new THREE.MeshBasicMaterial({
      color: 0x93a8bd,
      map: makeFloorTexture(),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const columnMat = new THREE.MeshStandardMaterial({
      color: 0x4a5a6a, roughness: 0.42, metalness: 0.1,
    });
    const islandMat = new THREE.MeshStandardMaterial({
      color: 0x35506a, roughness: 0.42, metalness: 0.16,
    });
    const deskMat = new THREE.MeshStandardMaterial({ color: 0xf4f7fa, roughness: 0.55 });
    const railMat = new THREE.MeshStandardMaterial({
      color: 0x9aa8b6, roughness: 0.4, metalness: 0.5,
    });
    const scannerMat = new THREE.MeshStandardMaterial({
      color: 0x323c46, roughness: 0.42, metalness: 0.45,
    });
    const beltMat = new THREE.MeshStandardMaterial({ color: 0x2b343d, roughness: 0.85 });
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x6f88a0, roughness: 0.72 });
    const shopMats = [0xe2805f, 0x5f9fd0, 0x7fb98a, 0xd4a85f].map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.62 })
    );

    let seed = 20210627;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const latOf = (z) => state.origin[0] - z / M_PER_DEG;
    const lonOf = (x) => state.origin[1] + x / (M_PER_DEG * Math.cos(state.origin[0] * DEG));
    const inside = (x, z, poly) => inPolygon(latOf(z), lonOf(x), poly);

    const addBox = (w, h, d, mat, x, y, z, ry = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      mesh.rotation.y = ry;
      group.add(mesh);
      return mesh;
    };

    (state.data.interior || []).forEach((t) => {
      const term = (state.data.terminals || []).find((x) => x.id === t.id);
      const footprint = term && term.polygons && term.polygons[0] ? term.polygons[0] : null;
      const center = { x: px(t.center[1]), z: pz(t.center[0]) };
      const termName = t.name.replace('航站楼', '');

      t.levels.forEach((lv) => {
        const y = lv.y;
        const isUpper = lv.name.includes('L2');

        // 楼板 + 轮廓
        if (footprint) {
          const geo = new THREE.ExtrudeGeometry(shapeFromPolygon(footprint), {
            depth: 0.7, bevelEnabled: false,
          });
          geo.rotateX(-Math.PI / 2);
          const slab = new THREE.Mesh(geo, isUpper ? floorMatUpper : floorMat);
          slab.position.y = y - 0.7;
          slab.renderOrder = 3;
          group.add(slab);

          const ring = footprint.map((p) => v3(p[0], p[1], y + 0.03));
          ring.push(ring[0].clone());
          group.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(ring),
            new THREE.LineBasicMaterial({ color: 0x5b7288, transparent: true, opacity: 0.6 })
          ));

          // 柱网
          const xs = footprint.map((p) => px(p[1]));
          const zs = footprint.map((p) => pz(p[0]));
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minZ = Math.min(...zs);
          const maxZ = Math.max(...zs);
          const pts = [];
          for (let x = minX + 17; x < maxX - 8 && pts.length < 260; x += 34) {
            for (let z = minZ + 17; z < maxZ - 8 && pts.length < 260; z += 34) {
              if (inside(x, z, footprint)) pts.push([x, z]);
            }
          }
          if (pts.length) {
            const colH = isUpper ? 7.2 : 6.0;
            const inst = new THREE.InstancedMesh(
              new THREE.CylinderGeometry(0.85, 0.85, colH, 8), columnMat, pts.length
            );
            const mtx = new THREE.Matrix4();
            pts.forEach((p, i) => {
              mtx.makeTranslation(p[0], y + colH / 2, p[1]);
              inst.setMatrixAt(i, mtx);
            });
            inst.instanceMatrix.needsUpdate = true;
            group.add(inst);
          }
        }

        // 功能分区着色
        (lv.zones || []).forEach((z, zi) => {
          if (!z.polygon || z.polygon.length < 3 || z.kind === 'waiting') return;
          const geo = new THREE.ShapeGeometry(shapeFromPolygon(z.polygon));
          geo.rotateX(-Math.PI / 2);
          const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
            color: zoneTint[z.kind] || 0x9aa7b4,
            transparent: true,
            opacity: 0.32,
            side: THREE.DoubleSide,
            depthWrite: false,
          }));
          mesh.position.y = y + 0.12;
          mesh.renderOrder = 4 + zi;
          group.add(mesh);

          const c = centroid(z.polygon);
          defs.push({
            text: z.name,
            pos: new THREE.Vector3(c.x, y + 8.5, c.z),
            opts: { fontSize: 34, scale: 0.44 },
          });
        });

        // 候机区座椅（贴在登机口两侧）、商业单元（沿长轴两侧）
        const gatesList = lv.gates || [];
        if (gatesList.length) {
          const benches = [];
          gatesList.forEach((p) => {
            const x = px(p[1]);
            const z = pz(p[0]);
            benches.push([x - 10, z + 7], [x + 1, z + 7], [x - 4, z - 9]);
          });
          const seatGeo = new THREE.BoxGeometry(6.0, 0.42, 1.0);
          const backGeo = new THREE.BoxGeometry(6.0, 0.66, 0.16);
          const seats = new THREE.InstancedMesh(seatGeo, seatMat, benches.length);
          const backs = new THREE.InstancedMesh(backGeo, seatMat, benches.length);
          const mtx = new THREE.Matrix4();
          const q = new THREE.Quaternion();
          const one = new THREE.Vector3(1, 1, 1);
          const pos = new THREE.Vector3();
          benches.forEach((b, i) => {
            q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0);
            pos.set(b[0], y + 0.45, b[1]);
            mtx.compose(pos, q, one);
            seats.setMatrixAt(i, mtx);
            q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.16));
            pos.set(b[0], y + 0.79, b[1] - 0.46);
            mtx.compose(pos, q, one);
            backs.setMatrixAt(i, mtx);
          });
          seats.instanceMatrix.needsUpdate = true;
          backs.instanceMatrix.needsUpdate = true;
          group.add(seats);
          group.add(backs);
        }

        if (footprint && isUpper) {
          for (let i = 0; i < 12; i += 1) {
            const ang = (i / 12) * Math.PI * 2 + 0.25;
            const x = center.x + Math.cos(ang) * 250;
            const z = center.z + Math.sin(ang) * 195;
            if (!inside(x, z, footprint)) continue;
            addBox(12, 4.4, 8, shopMats[i % shopMats.length], x, y + 2.2, z, ang);
          }
        }

        // 值机岛（柜台 + 传送带 + 排队栏杆）
        (lv.islands || []).forEach((poly) => {
          if (poly.length < 3) return;
          const geo = new THREE.ExtrudeGeometry(shapeFromPolygon(poly), {
            depth: 2.6, bevelEnabled: false,
          });
          geo.rotateX(-Math.PI / 2);
          const island = new THREE.Mesh(geo, islandMat);
          island.position.y = y;
          group.add(island);

          const c = centroid(poly);
          const xs = poly.map((p) => px(p[1]));
          const zs = poly.map((p) => pz(p[0]));
          const w = Math.max(...xs) - Math.min(...xs);
          const d = Math.max(...zs) - Math.min(...zs);
          addBox(w * 0.94, 0.28, Math.min(7, d * 0.5), deskMat, c.x, y + 2.74, c.z);
          addBox(w * 0.9, 0.5, 1.0, beltMat, c.x, y + 0.35, c.z - d * 0.52);
          for (let i = 0; i < 4; i += 1) {
            const rx = c.x - w * 0.36 + (i * w * 0.72) / 3;
            addBox(0.16, 1.05, 0.16, railMat, rx, y + 0.52, c.z + d * 0.55);
          }
          addBox(w * 0.72, 0.06, 0.06, railMat, c.x, y + 1.0, c.z + d * 0.55);
        });

        // 安检通道
        (lv.security || []).forEach((poly) => {
          if (poly.length < 3) return;
          const geo = new THREE.ShapeGeometry(shapeFromPolygon(poly));
          geo.rotateX(-Math.PI / 2);
          const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
            color: 0xffb35c, transparent: true, opacity: 0.45, side: THREE.DoubleSide,
          }));
          mesh.position.y = y + 0.16;
          group.add(mesh);

          const c = centroid(poly);
          addBox(2.4, 2.3, 1.2, scannerMat, c.x - 5.4, y + 1.15, c.z, 0);
          addBox(2.4, 2.3, 1.2, scannerMat, c.x + 5.4, y + 1.15, c.z, 0);
          addBox(13.2, 0.4, 1.2, scannerMat, c.x, y + 2.3, c.z, 0);
          addBox(4.6, 0.9, 1.6, deskMat, c.x, y + 0.45, c.z + 5.2, 0);
        });

        // 登机口柜台
        if ((lv.gates || []).length) {
          const gates = lv.gates;
          const inst = new THREE.InstancedMesh(
            new THREE.BoxGeometry(2.8, 1.1, 1.5), deskMat, gates.length
          );
          const mtx = new THREE.Matrix4();
          const pts = [];
          gates.forEach((p, i) => {
            const x = px(p[1]);
            const z = pz(p[0]);
            mtx.makeTranslation(x, y + 0.55, z);
            inst.setMatrixAt(i, mtx);
            pts.push(x, y + 2.2, z);
          });
          inst.instanceMatrix.needsUpdate = true;
          group.add(inst);
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
          group.add(new THREE.Points(g, new THREE.PointsMaterial({
            color: 0x0a84ff, size: 10, sizeAttenuation: true, depthWrite: false,
          })));
          // 指廊中线
          const guide = gates.map((p) => v3(p[0], p[1], y + 0.14));
          if (guide.length > 2) {
            group.add(new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(guide),
              new THREE.LineBasicMaterial({ color: 0x2f4a63, transparent: true, opacity: 0.45 })
            ));
          }
        }

        // 行李转盘
        (lv.carousels || []).forEach((c) => {
          const cx = px(c.center[1]);
          const cz = pz(c.center[0]);
          const belt = new THREE.Mesh(
            new THREE.CylinderGeometry(c.radius, c.radius, 0.6, 30, 1, true), beltMat
          );
          belt.position.set(cx, y + 0.55, cz);
          group.add(belt);
          const top = new THREE.Mesh(new THREE.RingGeometry(c.radius * 0.6, c.radius, 30), deskMat);
          top.rotation.x = -Math.PI / 2;
          top.position.set(cx, y + 0.86, cz);
          group.add(top);
        });

        // 中转柜台
        if (!isUpper) {
          const transfer = (lv.zones || []).find((z) => z.kind === 'transfer');
          if (transfer) {
            const c = centroid(transfer.polygon);
            for (let i = 0; i < 3; i += 1) {
              addBox(5.2, 1.05, 1.6, deskMat, c.x + (i - 1) * 7.5, y + 0.52, c.z - 6);
            }
          }
        }

        // 自动扶梯（L1 → L2）
        if (isUpper && footprint) {
          [-1, 1].forEach((s) => {
            const x = center.x + s * 34;
            const z = center.z + 24;
            if (!inside(x, z + 9, footprint) || !inside(x, z - 9, footprint)) return;
            const ramp = addBox(4.8, 0.45, 17, deskMat, x, (y + 1.6) / 2 + 1.4, z, 0);
            ramp.rotation.x = -Math.atan2(y - 1.6, 16);
          });
        }

        defs.push({
          text: levelTitles[lv.name] || lv.name,
          pos: new THREE.Vector3(center.x - 40, y + 15, center.z - 150),
          opts: { fontSize: 34, scale: 0.4 },
        });
      });

      defs.push({
        text: `${termName} · 内部结构`,
        pos: new THREE.Vector3(center.x, 54, center.z + 210),
        opts: { fontSize: 34, scale: 0.36 },
      });
    });

    defs.forEach((d) => {
      const sprite = labelSprite(d.text, d.opts);
      sprite.position.copy(d.pos);
      labels.add(sprite);
    });

    group.visible = false;
    labels.visible = false;
    state.groups.interior = group;
    state.groups.interiorLabels = labels;
    state.scene.add(group);
    state.scene.add(labels);
  }

  /* ---------------- 周边公共交通 ---------------- */

  function buildTransit() {
    const group = new THREE.Group();
    const labels = new THREE.Group();
    const t = state.data.transit || {};
    const seen = new Set();
    let lineSeq = 0;

    // 线路主走向（用于地铁站体的朝向）
    let lineYaw = 0;
    {
      const seg0 = t.metro && t.metro[0] && t.metro[0].segments && t.metro[0].segments[0];
      if (seg0 && seg0.length > 1) {
        const a = seg0[0];
        const b = seg0[seg0.length - 1];
        lineYaw = Math.atan2(px(b[1]) - px(a[1]), pz(b[0]) - pz(a[0]));
      }
    }

    // 18/19 号线在机场段共用走廊，画成并行双线（左右各偏移 13m），避免完全重叠
    (t.metro || []).forEach((m, mi) => {
      const lane = mi === 0 ? -13 : 13;
      (m.segments || []).forEach((seg) => {
        if (seg.length < 2) return;
        const path = offsetPolyline(seg, lane);
        const col = new THREE.Color(m.color || '#0a84ff');
        // 轨道基床
        const bed = new THREE.Mesh(ribbon(path, 9.5, 0.16), new THREE.MeshBasicMaterial({
          color: col.clone().multiplyScalar(0.74),
          transparent: true, opacity: 0.62,
          side: THREE.DoubleSide, depthWrite: false,
        }));
        bed.renderOrder = 40 + lineSeq;
        lineSeq += 1;
        group.add(bed);
        // 线路色亮芯
        const core = new THREE.Mesh(ribbon(path, 4.2, 0.25), new THREE.MeshBasicMaterial({
          color: col,
          transparent: true, opacity: 0.95,
          side: THREE.DoubleSide, depthWrite: false,
        }));
        core.renderOrder = 44 + lineSeq;
        lineSeq += 1;
        group.add(core);
      });
    });

    const railMat = new THREE.MeshBasicMaterial({
      color: THEME.light.rail, transparent: true, opacity: THEME.light.railOpacity,
      side: THREE.DoubleSide, depthWrite: false,
    });
    state.railMat = railMat;
    (t.rail || []).forEach((seg) => {
      if (seg.length < 2) return;
      const mesh = new THREE.Mesh(ribbon(seg, 9.5, 0.15), railMat);
      mesh.renderOrder = 40 + lineSeq;
      lineSeq += 1;
      group.add(mesh);
    });

    (t.stations || []).forEach((s) => {
      if (s.type === 'entrance') {
        // 地铁出入口：玻璃亭 + 18/19 号线色顶盖
        const x = px(s.lon);
        const z = pz(s.lat);
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(9.2, 4.4, 7),
          new THREE.MeshStandardMaterial({
            color: 0x30414f, roughness: 0.18, metalness: 0.62,
            transparent: true, opacity: 0.9,
          })
        );
        box.position.set(x, 2.2, z);
        group.add(box);
        const cap = new THREE.Mesh(
          new THREE.BoxGeometry(11, 0.7, 8.6),
          new THREE.MeshStandardMaterial({
            color: 0x006272, roughness: 0.5, metalness: 0.3,
            emissive: new THREE.Color(0x006272), emissiveIntensity: 0.5,
          })
        );
        cap.position.set(x, 4.75, z);
        group.add(cap);
        return;
      }
      // 地铁站：地下站体投影 + 出入口雨棚
      if (s.type === 'metro') {
        const x = px(s.lon);
        const z = pz(s.lat);
        const hall = new THREE.Mesh(
          new THREE.PlaneGeometry(58, 170),
          new THREE.MeshBasicMaterial({
            color: 0x2f4a63, transparent: true, opacity: 0.3,
            side: THREE.DoubleSide, depthWrite: false,
          })
        );
        hall.rotation.x = -Math.PI / 2;
        hall.rotation.z = -lineYaw;
        hall.position.set(x, 0.34, z);
        hall.renderOrder = 45;
        group.add(hall);

        const exitMat = new THREE.MeshStandardMaterial({
          color: 0xc3d2df, roughness: 0.36, metalness: 0.36,
        });
        const glassMat = new THREE.MeshStandardMaterial({
          color: 0x2b3f52, roughness: 0.16, metalness: 0.7,
        });
        for (let k = 0; k < 3; k += 1) {
          const ang = lineYaw + (k - 1) * 0.95;
          const ex = x + Math.sin(ang) * 66;
          const ez = z + Math.cos(ang) * 66;
          const canopy = new THREE.Mesh(new THREE.BoxGeometry(14, 0.7, 9.5), exitMat);
          canopy.position.set(ex, 4.1, ez);
          canopy.rotation.y = ang;
          group.add(canopy);
          const gl = new THREE.Mesh(new THREE.BoxGeometry(11.6, 3.4, 7.4), glassMat);
          gl.position.set(ex, 2.0, ez);
          gl.rotation.y = ang;
          group.add(gl);
        }
      } else {
        const color = s.type === 'rail' ? 0xe4002b : s.type === 'bus' ? 0x34c759 : 0x0a84ff;
        const size = s.type === 'bus' ? 5 : 8;
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(size, 12, 10),
          new THREE.MeshBasicMaterial({ color })
        );
        dot.position.copy(v3(s.lat, s.lon, size + 2));
        group.add(dot);
      }

      if (s.name && s.type !== 'bus' && !seen.has(s.name)) {
        seen.add(s.name);
        const sprite = labelSprite(s.name, { fontSize: 32, scale: 0.4 });
        sprite.position.copy(v3(s.lat, s.lon, 38));
        labels.add(sprite);
      }
    });

    state.groups.transit = group;
    state.groups.transitLabels = labels;
    state.scene.add(group);
    state.scene.add(labels);
  }

  /* ---------------- 周边道路系统 ---------------- */

  function roadKey(cls) {
    return cls && cls.endsWith('_link') ? 'link' : cls;
  }

  function roadWidth(road) {
    const k = ROAD_SCALE[roadKey(road.cls)] || 1.05;
    return Math.max(4.5, (road.w || 8) * k);
  }

  /** 把多条中心线合并成一份几何，减少 draw call。 */
  function mergeRoadRibbons(roads, widthFn, y) {
    const pos = [];
    const idx = [];
    roads.forEach((road) => {
      const g = ribbon(road.pts, widthFn(road), y);
      const p = g.getAttribute('position').array;
      const order = g.getIndex().array;
      const base = pos.length / 3;
      for (let i = 0; i < p.length; i += 1) pos.push(p[i]);
      for (let i = 0; i < order.length; i += 1) idx.push(base + order[i]);
      g.dispose();
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    return geo;
  }

  function buildRoads() {
    const group = new THREE.Group();
    const data = state.roads;
    state.groups.roads = group;
    state.scene.add(group);
    if (!data || !data.roads || !data.roads.length) return;

    const rs = ROAD_STYLE[state.theme] || ROAD_STYLE.light;
    const usable = data.roads.filter((r) => !r.tn && r.pts && r.pts.length > 1);

    // 路面外描边：统一深/浅色，突出道路轮廓
    const casingMat = new THREE.MeshBasicMaterial({
      color: rs.casing, transparent: true, opacity: 0.9,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const casing = new THREE.Mesh(
      mergeRoadRibbons(usable, (r) => roadWidth(r) + 4, 0.1), casingMat
    );
    casing.renderOrder = 2;
    group.add(casing);

    // 按等级上色
    const buckets = new Map();
    usable.forEach((r) => {
      const key = roadKey(r.cls) || 'tertiary';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(r);
    });
    const fills = {};
    buckets.forEach((list, key) => {
      const mat = new THREE.MeshBasicMaterial({
        color: rs[key] || rs.tertiary, transparent: true, opacity: 0.97,
        side: THREE.DoubleSide, depthWrite: false,
      });
      const mesh = new THREE.Mesh(mergeRoadRibbons(list, roadWidth, 0.15), mat);
      mesh.renderOrder = 3;
      group.add(mesh);
      fills[key] = mat;
    });
    state.roadMats = { casing: casingMat, fills };

    // 主要道路名称
    if (data.labels && data.labels.length) {
      const pick = new Map();
      usable.forEach((r) => {
        if (!r.name || data.labels.indexOf(r.name) < 0) return;
        const prev = pick.get(r.name);
        if (!prev || prev.len < r.len) pick.set(r.name, r);
      });
      const labels = new THREE.Group();
      [...pick.values()]
        .sort((a, b) => b.len - a.len)
        .slice(0, 12)
        .forEach((r) => {
          const mid = r.pts[Math.floor(r.pts.length / 2)];
          const sprite = labelSprite(r.name, { fontSize: 28, scale: 0.34 });
          sprite.position.copy(v3(mid[0], mid[1], 18));
          labels.add(sprite);
        });
      state.groups.roadLabels = labels;
      state.scene.add(labels);
    }
  }

  function updateGroundTone() {
    if (!state.groundMat) return;
    const p = THEME[state.theme] || THEME.light;
    const color = new THREE.Color(p.ground);
    if (state.interiorOn) color.multiplyScalar(0.56);
    state.groundMat.color.copy(color);
    if (state.regionMat) state.regionMat.color.copy(color);
    if (state.coreMat) state.coreMat.color.copy(color);
    if (state.farMat) state.farMat.color.copy(color);
  }

  function setTerminalXray(on) {
    state.terminalMats.forEach(({ roofMat, wallMat }) => {
      roofMat.transparent = on;
      roofMat.opacity = on ? 0.12 : 1;
      roofMat.depthWrite = !on;
      wallMat.transparent = on;
      wallMat.opacity = on ? 0.18 : 1;
      wallMat.depthWrite = !on;
    });
  }

  function setInteriorMode(on) {
    state.interiorOn = on;
    if (state.groundMesh) state.groundMesh.visible = !on;
    if (state.regionMesh) state.regionMesh.visible = !on;
    if (state.farMesh) state.farMesh.visible = !on;
    if (state.coreMesh) state.coreMesh.visible = !on;
    if (state.groups.roofDetail) state.groups.roofDetail.visible = !on;
    if (state.groundPadMat) {
      state.groundPadMat.color.setHex(on ? 0xeef3f8 : THEME[state.theme].bg);
    }
    if (state.groups.interior) state.groups.interior.visible = on;
    if (state.groups.interiorLabels) {
      const labelsCb = document.querySelector('[data-layer=labels]');
      state.groups.interiorLabels.visible = on && (!labelsCb || labelsCb.checked);
    }
    const transitCb = document.querySelector('[data-layer=transit]');
    const transitOn = !transitCb || transitCb.checked;
    if (state.groups.transit) state.groups.transit.visible = on ? false : transitOn;
    if (state.groups.transitLabels) state.groups.transitLabels.visible = on ? false : transitOn;
    if (state.groups.metroTrains) state.groups.metroTrains.visible = on ? false : transitOn;

    const roadsCb = document.querySelector('[data-layer=roads]');
    const roadsOn = !roadsCb || roadsCb.checked;
    if (state.groups.roads) state.groups.roads.visible = on ? false : roadsOn;
    if (state.groups.roadLabels) state.groups.roadLabels.visible = on ? false : roadsOn;

    const vehicleCb = document.querySelector('[data-layer=vehicles]');
    const vehiclesOn = !vehicleCb || vehicleCb.checked;
    if (state.groups.vehicles) state.groups.vehicles.visible = on ? false : vehiclesOn;
    const aircraftCb = document.querySelector('[data-layer=aircraft]');
    if (state.groups.aircraft) state.groups.aircraft.visible = !aircraftCb || aircraftCb.checked;
    setTerminalXray(on);
    updateGroundTone();
    state.needsRender = true;
  }

  function applyTheme(theme, silent = false) {
    const p = THEME[theme] || THEME.light;
    state.theme = theme;
    document.body.dataset.theme = theme;

    if (state.scene) {
      state.scene.background.setHex(p.bg);
    }
    updateGroundTone();
    if (state.groundPadMat) state.groundPadMat.color.setHex(p.bg);
    if (state.lights) {
      state.lights.hemi.intensity = p.hemi;
      state.lights.sun.intensity = p.sun;
      state.lights.fill.intensity = p.fill;
    }
    state.terminalMats.forEach((m) => {
      const prefix = ['terminal', 'gtc', 'hotel', 'parking', 'support'].includes(m.kind)
        ? m.kind : 'support';
      m.roofMat.color.setHex(p[`${prefix}Roof`]);
      m.wallMat.color.setHex(p[`${prefix}Wall`]);
    });
    if (state.airfieldMats.runway) {
      state.airfieldMats.runway.forEach((mat) => mat.color.setHex(p.runway));
    }
    if (state.airfieldMats.taxi) state.airfieldMats.taxi.color.setHex(p.taxi);
    if (state.airfieldMats.apron) state.airfieldMats.apron.color.setHex(p.apron);
    if (state.trackMats) {
      state.trackMats[0].color.setHex(p.trackApproach);
      state.trackMats[1].color.setHex(p.trackDepart);
      state.trackMats[0].opacity = p.trackOpacity[0];
      state.trackMats[1].opacity = p.trackOpacity[1];
    }
    // 深色下把建筑轮廓与轨道交通线整体提亮，避免黑底上“糊”成一片
    state.terminalEdgeMats.forEach(({ mat, kind }) => {
      if (kind === 'band') {
        mat.color.setHex(p.band);
        mat.opacity = p.bandOpacity;
      } else {
        mat.color.setHex(p.edge);
        mat.opacity = p.edgeOpacity;
      }
    });
    if (state.railMat) {
      state.railMat.color.setHex(p.rail);
      state.railMat.opacity = p.railOpacity;
    }
    if (state.roadMats) {
      const rs = ROAD_STYLE[theme] || ROAD_STYLE.light;
      state.roadMats.casing.color.setHex(rs.casing);
      Object.keys(state.roadMats.fills).forEach((key) => {
        state.roadMats.fills[key].color.setHex(rs[key] || rs.tertiary);
      });
    }

    state.needsRender = true;
    if (!silent) {
      toast(theme === 'dark' ? '已切换到深色模式' : '已切换到浅色模式', 1600);
    }
  }

  /* ---------------- 视角 ---------------- */

  function buildViews() {
    const b = state.sceneBounds || { cx: 0, cz: 0 };
    const t1 = state.t1 || { x: 0, z: 0 };
    const t2 = state.t2 || { x: 0, z: 0 };
    const core = new THREE.Vector3((t1.x + t2.x) / 2, 0, (t1.z + t2.z) / 2);
    const runway = state.data.runways[0];
    const mid = runway
      ? v3(
        (runway.points[0][0] + runway.points[runway.points.length - 1][0]) / 2,
        (runway.points[0][1] + runway.points[runway.points.length - 1][1]) / 2
      )
      : new THREE.Vector3(0, 0, 0);

    const portrait = window.innerWidth < 860 && window.innerHeight > window.innerWidth;
    const far = portrait ? 1.62 : 1;

    // 按机场实际占地（跑道 + 航站楼 + 停机坪）自适应取景，兼容不同规模的机场
    let minX = Infinity; let maxX = -Infinity;
    let minZ = Infinity; let maxZ = -Infinity;
    const grow = (lat, lon) => {
      const x = px(lon); const z = pz(lat);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    };
    (state.data.runways || []).forEach((rw) => rw.points.forEach((p) => grow(p[0], p[1])));
    (state.data.terminals || []).forEach((t) => t.polygons.forEach(
      (poly) => poly.forEach((p) => grow(p[0], p[1]))
    ));
    (state.data.aprons || []).forEach((ap) => (ap.polygon || []).forEach((p) => grow(p[0], p[1])));
    if (!Number.isFinite(minX)) { minX = -2000; maxX = 2000; minZ = -2000; maxZ = 2000; }
    const rectCX = (minX + maxX) / 2;
    const rectCZ = (minZ + maxZ) / 2;
    const siteSpan = Math.max(maxX - minX, maxZ - minZ, 1200);
    const topH = Math.min(7600, Math.max(3600, siteSpan * 1.45)) * far;
    const fitK = Math.min(1.05, Math.max(0.55, siteSpan / 7600));

    state.views = {
      overview: {
        pos: new THREE.Vector3(core.x + 2650 * far, 1780 * far, core.z + 3050 * far),
        target: new THREE.Vector3(core.x, 10, core.z),
      },
      top: {
        // 正北俯视：相机位于机场正上方略偏南，画面“上=北”
        pos: new THREE.Vector3(rectCX, topH, rectCZ + topH * 0.093),
        target: new THREE.Vector3(rectCX, 0, rectCZ),
      },
      t1: {
        pos: new THREE.Vector3(t1.x + 640 * fitK, 300 * fitK, t1.z + 1010 * fitK),
        target: new THREE.Vector3(t1.x + 70 * fitK, 12, t1.z + 170 * fitK),
      },
      t2: {
        pos: new THREE.Vector3(t2.x - 640 * fitK, 300 * fitK, t2.z - 1010 * fitK),
        target: new THREE.Vector3(t2.x - 70 * fitK, 12, t2.z - 170 * fitK),
      },
      runway: {
        pos: new THREE.Vector3(mid.x - 620 * fitK, 250 * fitK, mid.z + 1050 * fitK),
        target: new THREE.Vector3(mid.x, 10, mid.z),
      },
      tower: {
        pos: new THREE.Vector3(t1.x - 620 * fitK, 95 * fitK, t1.z + 760 * fitK),
        target: new THREE.Vector3(t1.x + 120 * fitK, 40, t1.z - 160 * fitK),
      },
      interior: {
        pos: new THREE.Vector3(t1.x + 900 * fitK, 1250 * fitK, t1.z + 1050 * fitK),
        target: new THREE.Vector3(t1.x + 220 * fitK, 4, t1.z),
      },
    };

    // 地铁视角：取 18 号线穿机场段的中部，正对列车运行方向
    const mseg = (((state.data.transit || {}).metro || [])[0] || {}).segments;
    if (mseg && mseg[0] && mseg[0].length > 4) {
      const pt = mseg[0][Math.floor(mseg[0].length * 0.42)];
      const mx = px(pt[1]);
      const mz = pz(pt[0]);
      state.views.metro = {
        pos: new THREE.Vector3(mx + 300, 190, mz + 360),
        target: new THREE.Vector3(mx, 8, mz),
      };
    }
  }

  function flyTo(view, instant = false) {
    let preset = state.views[view];
    // 地铁视角：直接飞到当前正在运行的 18 号线列车旁
    if (view === 'metro' && state.trains.length) {
      const tr = state.trains[0];
      const p = tr.curve.getPointAt(tr.t);
      preset = {
        pos: new THREE.Vector3(p.x + 165, 118, p.z + 225),
        target: new THREE.Vector3(p.x, 5, p.z),
      };
    }
    if (!preset) return;
    document.querySelectorAll('.seg button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
    if (instant) {
      state.controls.setByPosition(preset.pos, preset.target);
      state.controls.update(performance.now());
      return;
    }
    state.controls.tweenTo(preset.pos, preset.target, 1100);
  }

  /* ---------------- 渲染循环 ---------------- */

  function animate(now) {
    requestAnimationFrame(animate);
    const { camera, renderer, scene } = state;
    if (!renderer) return;
    const dt = Math.min(0.05, Math.max(0, (now - (animate.last || now)) / 1000));
    animate.last = now;

    const moving = state.controls ? state.controls.update(now) : false;

    // 罗盘指针：始终指向正北（Apple Maps 风格）
    const needle = state.compassNeedle;
    if (needle && state.controls) {
      let deg = ((Math.PI / 2 - state.controls.theta) * 180) / Math.PI;
      deg = (((deg + 180) % 360) + 360) % 360 - 180;
      const rounded = Math.round(deg);
      if (rounded !== animate.lastDeg) {
        animate.lastDeg = rounded;
        needle.style.transform = `rotate(${rounded}deg)`;
      }
    }
    const aircraftOn = !!(state.groups.aircraft && state.groups.aircraft.visible);
    const vehiclesOn = !!(state.groups.vehicles && state.groups.vehicles.visible);
    const trainsOn = !!(state.groups.metroTrains && state.groups.metroTrains.visible);

    if (aircraftOn) {
      state.aircraft.forEach((item) => {
        item.t = (item.t + item.speed * dt) % 1;
        const pos = item.curve.getPointAt(item.t);
        const tan = item.curve.getTangentAt(item.t);
        item.mesh.position.copy(pos);
        item.mesh.lookAt(pos.clone().add(tan));
      });
      state.taxi.forEach((item) => {
        item.t += item.dir * (item.speed / item.len) * dt;
        if (item.t > 1) { item.t = 1; item.dir = -1; } else if (item.t < 0) { item.t = 0; item.dir = 1; }
        const pos = item.curve.getPointAt(item.t);
        const tan = item.curve.getTangentAt(item.t).multiplyScalar(item.dir);
        item.mesh.position.copy(pos);
        item.mesh.lookAt(pos.clone().add(tan));
      });
    }

    if (vehiclesOn) {
      state.vehicles.forEach((v) => {
        v.t = (v.t + (v.speed / v.len) * dt) % 1;
        const pos = v.curve.getPointAt(v.t);
        const tan = v.curve.getTangentAt(v.t);
        v.mesh.position.copy(pos);
        v.mesh.lookAt(pos.clone().add(tan));
      });
    }

    if (trainsOn) {
      state.trains.forEach((tr) => {
        tr.t = (tr.t + (tr.speed / tr.len) * dt) % 1;
        tr.cars.forEach((car, i) => {
          const t = (tr.t - (i * tr.spacing) / tr.len + 1) % 1;
          const pos = tr.curve.getPointAt(t);
          const tan = tr.curve.getTangentAt(t);
          car.position.copy(pos);
          car.lookAt(pos.clone().add(tan));
        });
      });
    }

    // 按需渲染：静止时不重绘画布，避免持续合成带来的闪烁
    if (moving || aircraftOn || vehiclesOn || trainsOn || state.needsRender) {
      renderer.render(scene, camera);
      state.needsRender = false;
    }
  }

  /* ---------------- 交互 ---------------- */

  function bindUI() {
    document.querySelectorAll('.seg button').forEach((btn) => {
      btn.addEventListener('click', () => flyTo(btn.dataset.view));
    });
    $('#orbit-btn').addEventListener('click', () => {
      state.autoRotate = !state.autoRotate;
      state.controls.autoRotate = state.autoRotate;
      state.controls.autoRotateSpeed = 0.65;
      state.controls.dirty = true;
      state.needsRender = true;
      $('#orbit-btn').classList.toggle('active', state.autoRotate);
      toast(state.autoRotate ? '已开启自动环绕' : '已停止自动环绕', 1600);
    });

    // 罗盘：一键回到正北俯视
    const compassBtn = $('#compass-btn');
    if (compassBtn) {
      state.compassNeedle = compassBtn.querySelector('.compass-needle');
      compassBtn.addEventListener('click', () => {
        const c = state.controls;
        const phi = 0.05;
        const pos = new THREE.Vector3(
          c.target.x,
          c.target.y + c.radius * Math.cos(phi),
          c.target.z + c.radius * Math.sin(phi)
        );
        c.tweenTo(pos, c.target.clone(), 820);
        c.autoRotate = false;
        state.autoRotate = false;
        const orbitBtn = $('#orbit-btn');
        if (orbitBtn) orbitBtn.classList.remove('active');
        state.needsRender = true;
        toast('已回到正北俯视', 1400);
      });
    }

    const labelsOn = () => {
      const cb = document.querySelector('[data-layer=labels]');
      return !cb || cb.checked;
    };

    document.querySelectorAll('[data-layer]').forEach((input) => {
      input.addEventListener('change', () => {
        const key = input.dataset.layer;
        const on = input.checked;
        state.needsRender = true;

        if (key === 'labels') {
          ['labels', 'transitLabels', 'roadLabels', 'interiorLabels'].forEach((k) => {
            const g = state.groups[k];
            if (g) g.visible = on && (k !== 'interiorLabels' || state.interiorOn);
          });
          return;
        }

        if (key === 'interior') {
          setInteriorMode(on);
          if (on) flyTo('interior');
          else flyTo('overview');
          return;
        }

        if (key === 'transit') {
          if (state.groups.transit) state.groups.transit.visible = on;
          if (state.groups.transitLabels) {
            state.groups.transitLabels.visible = on && labelsOn();
          }
          if (state.groups.metroTrains) state.groups.metroTrains.visible = on;
          return;
        }

        if (key === 'roads') {
          if (state.groups.roads) state.groups.roads.visible = on;
          if (state.groups.roadLabels) {
            state.groups.roadLabels.visible = on && labelsOn();
          }
          return;
        }

        const group = state.groups[key];
        if (group) group.visible = on;
      });
    });

    const themeBtn = $('#theme-btn');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        applyTheme(state.theme === 'dark' ? 'light' : 'dark');
      });
    }

    // 机场切换（一级模块「机场」下的城市/机场选择）
    const citySwitch = $('#city-switch');
    const cityTrigger = $('#city-trigger');
    const cityMenu = $('#city-menu');
    if (cityTrigger && cityMenu) {
      const closeCityMenu = () => {
        cityMenu.classList.remove('open');
        cityTrigger.setAttribute('aria-expanded', 'false');
      };
      cityTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = cityMenu.classList.toggle('open');
        cityTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      cityMenu.addEventListener('click', (e) => {
        const opt = e.target.closest('.city-option');
        if (!opt) return;
        if (opt.disabled || opt.dataset.soon === '1') {
          toast('该机场正在接入 OSM 数据，敬请期待', 2200);
          return;
        }
        closeCityMenu();
        const key = opt.dataset.airport;
        if (key && key !== state.airport) window.location.href = `/airport?airport=${key}`;
      });
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#city-switch')) closeCityMenu();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeCityMenu();
      });
    }

    $('#scene').addEventListener('dblclick', () => flyTo('overview'));

    setTimeout(() => $('#hint').classList.add('hide'), 7000);
    setTimeout(() => {
      const loading = $('#loading');
      if (!loading) return;
      loading.classList.add('done');
      // 彻底移除加载层，避免隐藏的 spinner 动画继续占用合成器
      setTimeout(() => loading.remove(), 700);
    }, 420);
  }

  /* ---------------- 元信息 ---------------- */

  function applyMeta() {
    const meta = state.data.meta || {};
    const nameEl = $('#airport-name');
    if (nameEl) nameEl.textContent = meta.name || '成都天府国际机场';
    const subEl = $('#airport-sub');
    if (subEl) {
      const year = (meta.opened || '').slice(0, 4);
      subEl.textContent = [meta.iata, meta.icao].filter(Boolean).join(' / ')
        + (meta.city ? ` · ${meta.city}` : '')
        + (year ? ` · ${year} 年通航` : '');
    }

    // 顶部城市/机场切换器与菜单选中态
    const cityName = document.querySelector('#city-trigger .city-name');
    if (cityName && meta.city) {
      const short = (meta.name || '')
        .replace(meta.city, '')
        .replace('国际机场', '')
        .replace('机场', '');
      cityName.textContent = short ? `${meta.city} · ${short}` : meta.city;
    }
    document.querySelectorAll('#city-menu .city-option').forEach((opt) => {
      opt.setAttribute('aria-selected', opt.dataset.airport === state.airport ? 'true' : 'false');
    });

    // 单航站楼机场隐藏 T2 视角
    const t2Btn = document.querySelector('.seg button[data-view="t2"]');
    const terminalCount = (state.data.terminals || []).filter((t) => t.kind === 'terminal').length;
    if (t2Btn) t2Btn.hidden = terminalCount < 2;
    const spec = $('#runway-spec');
    const runwayNames = { '01/19': '西一跑道', '02/20': '东一跑道', '11/29': '北一跑道' };
    if (spec && (state.data.runways || []).length) {
      spec.innerHTML = state.data.runways.map((rw, i) => {
        const a = rw.points[0];
        const b = rw.points[rw.points.length - 1];
        const len = Math.round(Math.hypot(px(b[1]) - px(a[1]), pz(b[0]) - pz(a[0])));
        const color = ['#22d3ee', '#a78bfa', '#fbbf24'][i % 3];
        const label = `${rw.ref} ${runwayNames[rw.ref] || '跑道'}`;
        return `<div><i style="--c:${color}"></i><span>${label}</span>`
          + `<em>${len} × ${Math.round(rw.width)} m</em></div>`;
      }).join('');
    }
    const setStat = (sel, value) => {
      const el = $(sel);
      if (el) el.textContent = value;
    };
    setStat('#m-runways', (state.data.runways || []).length);
    setStat('#m-terminals', (state.data.terminals || []).filter((t) => t.kind === 'terminal').length);
    setStat('#m-gates', (state.data.gates || []).length);
    setStat('#m-stands', (state.data.stands || []).length);
    document.title = `${meta.name || '成都天府国际机场'} · 3D 数字孪生`;
  }

  /* ---------------- 启动 ---------------- */

  async function boot() {
    // 明暗只由本地时间决定：08:00–18:00 浅色，18:00 之后（含凌晨）深色
    const theme = themeByClock();
    document.body.dataset.theme = theme;
    state.theme = theme;

    initScene();
    const requested = new URLSearchParams(window.location.search).get('airport') || 'tfu';
    state.airport = ['tfu', 'dlc'].includes(requested) ? requested : 'tfu';
    const code = state.airport;
    try {
      const [data, base, region, core, roads, far] = await Promise.all([
        fetch(`/static/data/airport_${code}.json`).then((r) => r.json()),
        fetch(`/static/data/${code}_base.json`).then((r) => r.json()),
        fetch(`/static/data/${code}_region.json`).then((r) => r.json()).catch(() => null),
        fetch(`/static/data/${code}_core.json`).then((r) => r.json()).catch(() => null),
        fetch(`/static/data/${code}_roads.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`/static/data/${code}_far.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      state.data = data;
      state.base = base;
      state.regionMeta = region;
      state.coreMeta = core;
      state.roads = roads;
      state.farMeta = far;
      if (data.meta && data.meta.center) state.origin = data.meta.center;

      addGround();
      buildAirfield();
      buildAprons();
      buildJetBridges();
      buildTerminals();
      buildTower();
      buildTracks();
      buildAircraft();
      buildParkedAircraft();
      buildTaxiTraffic();
      buildGroundVehicles();
      buildMetroTrains();
      buildInterior();
      // 先铺路网，再画轨道交通线，保证轨交线始终压在道路之上
      buildRoads();
      buildTransit();
      applyMeta();

      // 场景范围
      let minX = Infinity; let maxX = -Infinity;
      let minZ = Infinity; let maxZ = -Infinity;
      data.runways.forEach((rw) => {
        rw.points.forEach((p) => {
          const x = px(p[1]);
          const z = pz(p[0]);
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        });
      });
      state.sceneBounds = { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };

      buildViews();
      // 进入机场默认：俯视 + 正北（可通过 ?view=t1/metro 等直接定位）
      const viewParam = new URLSearchParams(window.location.search).get('view');
      flyTo(state.views[viewParam] ? viewParam : 'top', true);
      applyTheme(theme, true);
      bindUI();

      // 跨过 08:00 / 18:00 时自动切换明暗
      let clockTheme = theme;
      setInterval(() => {
        const next = themeByClock();
        if (next === clockTheme) return;
        clockTheme = next;
        applyTheme(next, true);
      }, 30 * 1000);

      window.__airport = state;
      animate(performance.now());
    } catch (err) {
      $('#loading').innerHTML = '<span>机场数据加载失败，请刷新重试</span>';
      console.error(err);
    }
  }

  boot();
})();
