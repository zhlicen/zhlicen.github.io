
/* 牛牛跨栏 · 小红书小工具版 1.0.1（这一版加了音效，默认关闭） */
(() => {
  function boot() {
  'use strict';
  const stage = document.getElementById('stage');
  const statusEl = document.getElementById('status');
  const ui = {
    score: document.getElementById('score'),
    count: document.getElementById('count'),
    speed: document.getElementById('speed'),
    hint: document.getElementById('hint'),
    popup: document.getElementById('popup'),
    overlay: document.getElementById('overlay'),
    flash: document.getElementById('flash'),
    ovTitle: document.getElementById('ovTitle'),
    ovText: document.getElementById('ovText'),
    ovHint: document.getElementById('ovHint'),
  };

  // ---------- 小工具 ----------
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const TAU = Math.PI * 2;
  const DEG = 180 / Math.PI;
  const wrap = (x, r) => ((x + r) % (2 * r) + 2 * r) % (2 * r) - r;
  const pick = arr => arr[(Math.random() * arr.length) | 0];
  const pickHex = pick;

  function add(parent, geo, mat, pos, rot, scl) {
    const m = new THREE.Mesh(geo, mat);
    if (pos) m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    if (scl) m.scale.set(scl[0], scl[1], scl[2]);
    parent.add(m);
    return m;
  }
  // 把同一个刚体上的几个纯色零件合并成一个网格：每画一次都要占一次绘制，零件多的地方合并后能省不少。
  // parts: [几何体, 位置, 旋转(可省略), 缩放(可省略)]。只用于不带贴图的材质，所以只保留位置和法线。
  function mergeParts(parts) {
    const pos = [], nor = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    parts.forEach(([geo, at, rot, scl]) => {
      e.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0);
      q.setFromEuler(e);
      p.set(at ? at[0] : 0, at ? at[1] : 0, at ? at[2] : 0);
      sc.set(scl ? scl[0] : 1, scl ? scl[1] : 1, scl ? scl[2] : 1);
      m.compose(p, q, sc);
      // 球体、圆柱、圆锥这些几何体是带索引的：顶点列表只存一份，靠索引说明哪三个顶点组成一个三角形。
      // 合并前必须先展开成不带索引的形式（每三个顶点就是一个三角形），否则拼起来的顶点会被连成一堆细片，画不出东西。
      const src = geo.clone().applyMatrix4(m);
      const g = src.index ? src.toNonIndexed() : src;
      const a = g.attributes.position.array, n = g.attributes.normal.array;
      for (let i = 0; i < a.length; i++) { pos.push(a[i]); nor.push(n[i]); }
      src.dispose();
      g.dispose();
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return out;
  }
  // 摆放实例用的临时对象（每帧复用，不新建）
  const tmpC = new THREE.Color(), tmpM = new THREE.Matrix4(), tmpM2 = new THREE.Matrix4();
  const tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler();
  const Q0 = new THREE.Quaternion();
  // 一种材质配一组固定的实例（山丘）：摆好后不再变动
  function staticInstances(geo, mat, items) {
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    items.forEach((it, k) => {
      tmpP.set(it[0], it[1], it[2]); tmpS.set(it[3], it[4], it[5]);
      tmpM.compose(tmpP, Q0, tmpS);
      im.setMatrixAt(k, tmpM);
    });
    im.frustumCulled = false;                 // 实例散得很开，不能按网格自身的包围球剔除
    scene.add(im);
    return im;
  }
  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  // 有机形状的色块（用于身体花纹）
  function blob(ctx, cx, cy, rx, ry, s) {
    const n = 12;
    ctx.beginPath();
    for (let k = 0; k <= n; k++) {
      const a = k / n * TAU;
      const r = 1 + 0.12 * Math.sin(a * 3 + s * 1.7) + 0.07 * Math.sin(a * 5 + s);
      const x = cx + Math.cos(a) * rx * r, y = cy + Math.sin(a) * ry * r;
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
  }

  // ---------- 渲染器 / 场景 / 相机 ----------
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xd8f0ff, 28, 70);
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.5, 700);
  function showFatal(text) {
    statusEl.textContent = text;
    statusEl.classList.add('error');
  }
  // 启动阶段的意外错误要能被看见，而不是一直停在“正在准备”
  let ready = false;
  window.addEventListener('error', () => { if (!ready) showFatal('启动失败，请退出后重新打开。'); });

  // 手机 / 平板上阴影贴图从更小的尺寸起步；触屏设备的提示文字也不同
  const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const smallScreen = Math.min(window.screen ? window.screen.width : 4096, window.screen ? window.screen.height : 4096) < 500;
  const mobile = coarse || smallScreen;
  // 画质档：0 默认档，1 低档，2 最低档。先从默认档起步，玩的过程中持续掉帧再逐级降（见 frame 末尾）。
  let tier = 0;
  let viewW = 0, viewH = 0;                                   // 舞台在页面上的像素尺寸
  // 绘制缓冲区的像素比：默认档不超过 1.5、总像素不超过 200 万；低档起固定为 1、总像素不超过 100 万
  const pixelRatio = () => {
    if (!viewW || !viewH) return 1;
    const cap = tier === 0 ? 1.5 : 1, budget = tier === 0 ? 2000000 : 1000000;
    return Math.max(0.1, Math.min(window.devicePixelRatio || 1, cap, Math.sqrt(budget / (viewW * viewH))));
  };
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (e) {
    showFatal('当前设备无法启动 3D 场景，请退出后重新打开，或换一台设备再试。');
    return;
  }
  const cvs = renderer.domElement;
  renderer.setPixelRatio(pixelRatio());
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.appendChild(cvs);

  // ---------- 光照 ----------
  scene.add(new THREE.HemisphereLight(0xd2ecff, 0x5f8f45, 1.0));
  const sunLight = new THREE.DirectionalLight(0xfff4e0, 2.7);
  sunLight.position.set(9, 15, 8);
  sunLight.castShadow = true;
  const shadowSize = mobile ? 1024 : 2048;                // 阴影贴图是单张纹理，边长不超过 2048
  sunLight.shadow.mapSize.set(shadowSize, shadowSize);
  const sc = sunLight.shadow.camera;
  const shadowRange = mobile ? 20 : 26;
  sc.left = -shadowRange; sc.right = shadowRange; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 60;
  sc.updateProjectionMatrix();
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.03;
  scene.add(sunLight, sunLight.target);
  // 按画质档设置实时阴影：默认档按设备取贴图尺寸，低档 1024，最低档关闭
  function applyTier() {
    const size = tier === 0 ? shadowSize : 1024;
    if (sunLight.shadow.mapSize.x !== size) {
      sunLight.shadow.mapSize.set(size, size);
      if (sunLight.shadow.map) { sunLight.shadow.map.dispose(); sunLight.shadow.map = null; }
    }
    sunLight.castShadow = tier < 2;
    cloudIM.visible = tier < 2;                  // 最低档不画云
  }

  // ---------- 天空 ----------
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(400, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x3d9be8) },
        mid: { value: new THREE.Color(0x9fd6ff) },
        bottom: { value: new THREE.Color(0xe2f4ff) },
      },
      vertexShader: 'varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: [
        'uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vPos;',
        'void main() {',
        '  float h = normalize(vPos).y;',
        '  vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(mid, bottom, clamp(-h * 5.0, 0.0, 1.0));',
        '  gl_FragColor = vec4(c, 1.0);',
        '  #include <tonemapping_fragment>',
        '  #include <colorspace_fragment>',
        '}',
      ].join('\n'),
    })
  ));

  // ---------- 地面与跑道（纹理随奔跑向后滚动） ----------
  const SPH = new THREE.SphereGeometry(1, 20, 14);           // 奶牛身上的球体（离镜头近）
  const SPH_LO = new THREE.SphereGeometry(1, 12, 8);          // 远景的球体：树冠、灌木、山丘、云（面数少）
  const grassTex = canvasTex(256, 256, ctx => {
    ctx.fillStyle = '#6cba57';
    ctx.fillRect(0, 0, 256, 256);
    const cols = ['#5fae4c', '#7bc965', '#58a546', '#86d06e', '#63b350'];
    for (let i = 0; i < 1500; i++) {
      const x = Math.random() * 256, y = Math.random() * 256;
      ctx.strokeStyle = cols[(Math.random() * cols.length) | 0];
      ctx.globalAlpha = 0.35 + Math.random() * 0.45;
      ctx.lineWidth = 1 + Math.random() * 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (Math.random() - 0.5) * 4, y - 3 - Math.random() * 6);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
  grassTex.repeat.set(150, 150);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const trackTex = canvasTex(256, 256, ctx => {
    ctx.fillStyle = '#d3734d';
    ctx.fillRect(0, 0, 256, 256);
    const cols = ['#c5653f', '#e0855e', '#ba5a38', '#ea926b'];
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = cols[(Math.random() * cols.length) | 0];
      ctx.globalAlpha = 0.25 + Math.random() * 0.4;
      ctx.beginPath();
      ctx.arc(Math.random() * 256, Math.random() * 256, 0.5 + Math.random() * 1.3, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
  trackTex.wrapS = trackTex.wrapT = THREE.RepeatWrapping;
  trackTex.repeat.set(150, 2.5);
  const track = new THREE.Mesh(new THREE.PlaneGeometry(600, 10), new THREE.MeshStandardMaterial({ map: trackTex, roughness: 0.95 }));
  track.rotation.x = -Math.PI / 2;
  track.position.y = 0.02;
  track.receiveShadow = true;
  scene.add(track);
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
  [-5, -3, -1, 1, 3, 5].forEach(z => {
    const m = add(scene, new THREE.BoxGeometry(600, 0.012, 0.07), lineMat, [0, 0.03, z]);
    m.receiveShadow = true;
  });

  // ---------- 远景：山丘与云 ----------
  const hillFar = new THREE.MeshBasicMaterial({ color: 0xbfe6d6, fog: false });
  const hillNear = new THREE.MeshBasicMaterial({ color: 0xa3ddb8, fog: false });
  staticInstances(SPH_LO, hillFar, [[-190, -150, 90, 20], [-70, -165, 110, 26], [70, -155, 95, 18], [190, -160, 100, 24], [320, -150, 90, 20], [-320, -150, 90, 22]]
    .map(([x, z, r, h]) => [x, -3, z, r, h, r * 0.6]));
  staticInstances(SPH_LO, hillNear, [[-140, -105, 70, 11], [-20, -115, 80, 13], [110, -108, 75, 10], [230, -110, 70, 12], [-260, -108, 75, 11]]
    .map(([x, z, r, h]) => [x, -2, z, r, h, r * 0.6]));
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.45, roughness: 1, fog: false });
  // 每朵云由 3 ~ 5 个球组成；所有云的球放进同一个实例化网格。每朵云记下自己的位置和大小，整体慢慢往右飘。
  const clouds = [];
  let cloudN = 0;
  for (let i = 0; i < 7; i++) {
    const n = 3 + (i % 3);
    const c = { x: -170 + i * 54 + Math.random() * 20, y: 11 + Math.random() * 8, z: -40 - Math.random() * 55, s: 0.8 + Math.random() * 0.7, parts: [] };
    for (let k = 0; k < n; k++) {
      const fat = k % 2;
      c.parts.push([(k - (n - 1) / 2) * 2.3, fat * 0.6, fat ? 0.8 : -0.6, 2.6 + fat, 1.7 + fat * 0.4, 2.2]);
    }
    cloudN += n;
    clouds.push(c);
  }
  const cloudIM = new THREE.InstancedMesh(SPH_LO, cloudMat, cloudN);
  cloudIM.frustumCulled = false;
  cloudIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(cloudIM);
  function updateClouds() {
    let k = 0;
    clouds.forEach(c => c.parts.forEach(p => {
      tmpP.set(c.x + p[0] * c.s, c.y + p[1] * c.s, c.z + p[2] * c.s);
      tmpS.set(p[3] * c.s, p[4] * c.s, p[5] * c.s);
      tmpM.compose(tmpP, Q0, tmpS);
      cloudIM.setMatrixAt(k++, tmpM);
    }));
    cloudIM.instanceMatrix.needsUpdate = true;
  }
  updateClouds();

  // ---------- 场边模块（看台、观众、树木、旗帜、护栏、花丛），随跑道循环滚动 ----------
  // 跑道两侧每 12 米是一个“模块”，一共 10 个首尾相接，跑出视野的会绕回到另一头。
  // 同一种零件在 10 个模块里各有一个：全部放进同一个实例化网格，视野里有几个模块都只画一次。
  const MODS = 10;
  const GEO = {
    step: new THREE.BoxGeometry(12, 1, 1.7),
    crowdBody: new THREE.BoxGeometry(0.36, 0.44, 0.3),
    crowdHead: new THREE.SphereGeometry(0.145, 6, 4),
    wall: new THREE.BoxGeometry(12, 0.9, 0.16),
    stripe: new THREE.BoxGeometry(12, 0.2, 0.02),
    pole: new THREE.CylinderGeometry(0.035, 0.05, 3.4, 8),
    cone: new THREE.ConeGeometry(0.17, 0.48, 10),
    band: new THREE.CylinderGeometry(0.105, 0.125, 0.09, 10),
    fencePost: new THREE.BoxGeometry(0.08, 0.62, 0.08),
    rail: new THREE.BoxGeometry(12, 0.07, 0.05),
    flower: new THREE.SphereGeometry(0.06, 6, 4),
    trunk: new THREE.CylinderGeometry(0.16, 0.24, 2.6, 8),
  };
  const ENV = {
    stand: new THREE.MeshStandardMaterial({ color: 0xdfe7ee, roughness: 0.9 }),
    white: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }),
    blue: new THREE.MeshStandardMaterial({ color: 0x3b7ddd, roughness: 0.6 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xb8c2ca, roughness: 0.5, metalness: 0.3 }),
    cone: new THREE.MeshStandardMaterial({ color: 0xff8a3d, roughness: 0.7 }),
    bush: new THREE.MeshStandardMaterial({ color: 0x4f9f45, roughness: 1 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x8a6242, roughness: 1 }),
    // 下面四种是白色材质，颜色由每个实例自己带（观众的上衣和头、旗帜、树冠、花）
    crowd: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
    flower: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }),
    leaf: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
    flag: new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.8 }),
  };
  const shirtCols = [0xf6c453, 0xef7d7d, 0x7db9f0, 0x9bd98a, 0xc39be0, 0xf79c5d, 0xf4f0e6, 0x5bc0be];
  const skinCols = [0xf8d7bd, 0xecc09b, 0xd59b6f, 0xb97c50];
  const flagCols = [0xff6b6b, 0xffd93d, 0x6bcb77, 0x4d96ff, 0xff9f43];
  const flowerCols = [0xffffff, 0xffd166, 0xff9fb2, 0xbfe3ff];
  const leafA = 0x55b868, leafB = 0x6fcc7c;
  const penGeo = new THREE.BufferGeometry();
  penGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -0.5, 0, -1.1, -0.25, 0], 3));
  penGeo.computeVertexNormals();
  // 会动的三类实例：观众的身体的上下起伏、头的起伏、旗帜的摆动
  const ANIM_BODY = 1, ANIM_HEAD = 2, ANIM_PEN = 3;
  // 先把每个零件记下来，再按种类建实例化网格
  const pending = {};
  const put = (name, mod, at, scl, color, anim) => {
    (pending[name] = pending[name] || []).push({ mod, at, scl, color, anim });
  };
  for (let i = 0; i < MODS; i++) {
    // 看台三级台阶（露天看台，后面是树和远山）
    for (let r = 0; r < 3; r++) {
      const h = 0.7 * (r + 1);
      put('step', i, [0, h / 2, -13.9 - 1.7 * r], [1, h, 1]);
    }
    // 观众
    const cols = 14;
    for (let r = 0; r < 3; r++) {
      const h = 0.7 * (r + 1);
      for (let c = 0; c < cols; c++) {
        const x = -5.4 + c * (10.8 / (cols - 1)) + (Math.random() - 0.5) * 0.12, z = -13.75 - 1.7 * r;
        put('bodies', i, [x, h + 0.22, z], null, pickHex(shirtCols), ANIM_BODY);
        put('heads', i, [x, h + 0.59, z], null, pickHex(skinCols), ANIM_HEAD);
      }
    }
    // 前围墙
    put('wall', i, [0, 0.45, -12.2]);
    put('stripe', i, [0, 0.5, -12.11]);
    // 旗帜
    const px = i % 2 ? 3.5 : -3.5;
    put('pole', i, [px, 1.7, -7.9]);
    put('pen', i, [px, 3.3, -7.9], null, flagCols[i % flagCols.length], ANIM_PEN);
    // 跑道前侧：锥桶、护栏、灌木、小花
    put('cone', i, [-px, 0.24, 6.9]);
    put('band', i, [-px, 0.26, 6.9]);
    for (let k = 0; k < 4; k++) put('fencePost', i, [-6 + k * 4, 0.31, 7.7]);
    put('rail', i, [0, 0.52, 7.7]);
    for (let k = 0; k < 3; k++) {
      put('bush', i, [-4 + k * 4 + (Math.random() - 0.5) * 1.5, 0.2, 6.3 + Math.random() * 0.5], [0.5 + Math.random() * 0.25, 0.3 + Math.random() * 0.12, 0.45]);
    }
    for (let k = 0; k < 8; k++) put('flower', i, [-5.5 + Math.random() * 11, 0.16, 6.0 + Math.random() * 1.0], null, pickHex(flowerCols));
    // 看台后的树
    const tx = (i % 2 ? -4 : 4) + (Math.random() - 0.5) * 2, ts = 0.85 + Math.random() * 0.4;
    put('trunk', i, [tx, 1.3, -25]);
    put('leaf', i, [tx, 3.5, -25], [1.7 * ts, 1.5 * ts, 1.7 * ts], i % 2 ? leafA : leafB);
    put('leaf', i, [tx - 1.1, 2.9, -24.7], [1.1, 1.0, 1.1], leafB);
    put('leaf', i, [tx + 1.0, 3.0, -25.3], [1.2, 1.05, 1.2], leafA);
  }
  // 零件种类 → [几何体, 材质, 是否接收阴影]。场边这些零件都不投影：它们的影子在画面里几乎看不见，却要让阴影通道多画一遍。
  const PART = {
    step: [GEO.step, ENV.stand, true], bodies: [GEO.crowdBody, ENV.crowd, false], heads: [GEO.crowdHead, ENV.crowd, false],
    wall: [GEO.wall, ENV.white, false], stripe: [GEO.stripe, ENV.blue, false], pole: [GEO.pole, ENV.metal, false],
    pen: [penGeo, ENV.flag, false], cone: [GEO.cone, ENV.cone, false], band: [GEO.band, ENV.white, false],
    fencePost: [GEO.fencePost, ENV.white, false], rail: [GEO.rail, ENV.white, false], bush: [SPH_LO, ENV.bush, false],
    flower: [GEO.flower, ENV.flower, false], trunk: [GEO.trunk, ENV.trunk, false], leaf: [SPH_LO, ENV.leaf, false],
  };
  const scenery = [];               // [{ im: 实例化网格, items: [每个实例在模块里的摆放] }]
  Object.keys(PART).forEach(name => {
    const list = pending[name], d = PART[name];
    const im = new THREE.InstancedMesh(d[0], d[1], list.length);
    im.frustumCulled = false;       // 实例散布在整条跑道上，不能按网格自身的包围球剔除
    im.receiveShadow = d[2];
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const items = list.map((p, k) => {
      if (p.color !== undefined) im.setColorAt(k, tmpC.setHex(p.color));
      return { mod: p.mod, x: p.at[0], y: p.at[1], z: p.at[2], sx: p.scl ? p.scl[0] : 1, sy: p.scl ? p.scl[1] : 1, sz: p.scl ? p.scl[2] : 1, anim: p.anim || 0 };
    });
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    scene.add(im);
    scenery.push({ im, items });
  });
  const moduleX = [];               // 这一帧每个模块在世界里的 x
  function updateScenery() {
    for (let i = 0; i < scenery.length; i++) {
      const im = scenery[i].im, items = scenery[i].items;
      for (let k = 0; k < items.length; k++) {
        const p = items[k];
        let y = p.y, sy = p.sy, ry = 0;
        if (p.anim) {
          const b = Math.sin(time * 7 + p.mod);
          if (p.anim === ANIM_BODY) { sy *= 1 + 0.06 * b; y *= 1 + 0.06 * b; }     // 整排观众一起上下起伏
          else if (p.anim === ANIM_HEAD) y += 0.045 * b;
          else ry = 0.3 * Math.sin(time * 5 + p.mod * 1.3);                         // 旗帜来回摆
        }
        tmpP.set(p.x + moduleX[p.mod], y, p.z);
        tmpS.set(p.sx, sy, p.sz);
        if (ry) { tmpE.set(0, ry, 0); tmpQ.setFromEuler(tmpE); tmpM.compose(tmpP, tmpQ, tmpS); } else tmpM.compose(tmpP, Q0, tmpS);
        im.setMatrixAt(k, tmpM);
      }
      im.instanceMatrix.needsUpdate = true;
    }
  }

  // ---------- 栏架 ----------
  const barTex = canvasTex(256, 32, ctx => {
    for (let k = 0; k < 8; k++) {
      ctx.fillStyle = k % 2 ? '#2d3238' : '#fbfbfb';
      ctx.fillRect(k * 32, 0, 32, 32);
    }
  });
  const HG = {
    bar: new THREE.BoxGeometry(0.14, 0.14, 1.9),
    post: new THREE.BoxGeometry(0.07, 1.0, 0.07),
    foot: new THREE.BoxGeometry(0.9, 0.06, 0.09),
    low: new THREE.BoxGeometry(0.05, 0.05, 1.83),
    brace: new THREE.BoxGeometry(0.045, 1.09, 0.045),
  };
  const HM = {
    frame: new THREE.MeshStandardMaterial({ color: 0xf2f5f7, roughness: 0.45, metalness: 0.1 }),
    brace: new THREE.MeshStandardMaterial({ color: 0xcfd8de, roughness: 0.5, metalness: 0.2 }),
    bar: new THREE.MeshStandardMaterial({ map: barTex, roughness: 0.6 }),
  };
  const HURDLE_COUNT = 7;
  const hurdles = [];
  // g 只用来记每个栏架的位置和撞倒后的倾斜，不加入场景；画面由下面 5 个实例化网格负责（同种零件只画一次）
  for (let k = 0; k < HURDLE_COUNT; k++) {
    const g = new THREE.Group();
    g.visible = false;
    hurdles.push({ g, wx: 0, hit: false, tip: 0, passed: true });
  }
  // 每种零件：几何体、材质、它在栏架里的摆放 [x, y, z, 绕 z 的转角]
  const hurdleParts = [
    { geo: HG.bar, mat: HM.bar, local: [[0, 1.0, 0, 0]] },
    { geo: HG.low, mat: HM.brace, local: [[0, 0.4, 0, 0]] },
    { geo: HG.post, mat: HM.frame, local: [[0, 0.5, 0.915, 0], [0, 0.5, -0.915, 0]] },
    { geo: HG.foot, mat: HM.frame, local: [[0.42, 0.03, 0.915, 0], [0.42, 0.03, -0.915, 0]] },
    { geo: HG.brace, mat: HM.brace, local: [[0.4, 0.43, 0.915, Math.atan2(0.8, 0.74)], [0.4, 0.43, -0.915, Math.atan2(0.8, 0.74)]] },
  ];
  hurdleParts.forEach(p => {
    p.im = new THREE.InstancedMesh(p.geo, p.mat, HURDLE_COUNT * p.local.length);
    p.im.castShadow = true;
    p.im.receiveShadow = true;
    p.im.frustumCulled = false;
    p.im.count = 0;                 // 开始之前不显示栏架
    scene.add(p.im);
  });
  function updateHurdles() {
    const shown = hurdles[0].g.visible;
    hurdleParts.forEach(p => {
      p.im.count = shown ? HURDLE_COUNT * p.local.length : 0;
      if (!shown) return;
      hurdles.forEach((h, k) => {
        h.g.updateMatrix();
        p.local.forEach((l, j) => {
          tmpP.set(l[0], l[1], l[2]);
          tmpS.set(1, 1, 1);
          if (l[3]) { tmpE.set(0, 0, l[3]); tmpQ.setFromEuler(tmpE); } else tmpQ.copy(Q0);
          tmpM.compose(tmpP, tmpQ, tmpS);
          tmpM2.multiplyMatrices(h.g.matrix, tmpM);
          p.im.setMatrixAt(k * p.local.length + j, tmpM2);
        });
      });
      p.im.instanceMatrix.needsUpdate = true;
    });
  }

  // ---------- 游戏参数 ----------
  const BASE_SPEED = 6.5, MAX_SPEED = 12, ACCEL = 0.055, JOG_SPEED = 5;   // m/s、m/s²：开跑后速度线性上升
  const REST_Y = 1.08, JUMP_H = 1.7, JUMP_DIST = 6.3;                      // 站立高度、起跳高度、一次跳跃前进的距离
  const BAR_TOP = 1.07, BAR_HALF = 0.07;                                   // 横杆顶面高度与半厚
  const FIRST_HURDLE = 16, HURDLE_SPACING = 18, HURDLE_R = 63;             // 第一个栏架的距离、栏间距、循环范围
  const PERFECT_X = 3.15, PERFECT_W = 0.35;                                // 起跳瞬间栏架在这个位置 → 完美
  const CLEAR_POINTS = 10, PERFECT_POINTS = 15;                            // 每跨一栏、每次完美的加分
  const L1 = 0.52, L2 = 0.52, HIP_Y = -0.12;                               // 大腿、小腿长度与髋关节高度
  const MOOS = ['哞～', '哞！', '哞哞～', '加油！'];

  // ---------- 奶牛 ----------
  const bodyTex = canvasTex(1024, 512, ctx => {
    ctx.fillStyle = '#fffaf0';
    ctx.fillRect(0, 0, 1024, 512);
    ctx.fillStyle = '#4a3b35';
    [
      [0.20, 0.42, 0.55, 0.40], [0.31, 0.60, 0.45, 0.34], [0.13, 0.62, 0.36, 0.30],
      [0.70, 0.45, 0.50, 0.38], [0.82, 0.62, 0.42, 0.32], [0.62, 0.66, 0.34, 0.28],
      [0.40, 0.18, 0.50, 0.30], [0.47, 0.40, 0.38, 0.32], [0.04, 0.46, 0.40, 0.34], [0.95, 0.56, 0.38, 0.30],
    ].forEach(([u, v, w, h], i) => blob(ctx, u * 1024, v * 512, (w * 233 / 2) / Math.sin(Math.PI * v), h * 222 / 2, i));
  });
  const headTex = canvasTex(512, 256, ctx => {
    ctx.fillStyle = '#fffaf0';
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = '#4a3b35';
    blob(ctx, 0.28 * 512, 0.25 * 256, 70, 43, 3);
    blob(ctx, 0.80 * 512, 0.30 * 256, 34, 26, 7);
  });
  const M = {
    body: new THREE.MeshStandardMaterial({ map: bodyTex, roughness: 0.9 }),
    head: new THREE.MeshStandardMaterial({ map: headTex, roughness: 0.9 }),
    coat: new THREE.MeshStandardMaterial({ color: 0xfffaf0, roughness: 0.9 }),
    spot: new THREE.MeshStandardMaterial({ color: 0x4a3b35, roughness: 0.9 }),
    pink: new THREE.MeshStandardMaterial({ color: 0xf6b3b0, roughness: 0.8 }),
    pinkDark: new THREE.MeshStandardMaterial({ color: 0xd98280, roughness: 0.8 }),
    hoof: new THREE.MeshStandardMaterial({ color: 0x4a3b35, roughness: 0.6 }),
    horn: new THREE.MeshStandardMaterial({ color: 0xecd09a, roughness: 0.6 }),
    collar: new THREE.MeshStandardMaterial({ color: 0xe0524d, roughness: 0.6 }),
    bell: new THREE.MeshStandardMaterial({ color: 0xf6bd44, roughness: 0.3, metalness: 0.6 }),
    bellDark: new THREE.MeshStandardMaterial({ color: 0xa86d0a, roughness: 0.5 }),
    eyeWhite: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 }),
    pupil: new THREE.MeshStandardMaterial({ color: 0x241b18, roughness: 0.2 }),
    glint: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  };

  const cow = new THREE.Group();
  scene.add(cow);
  const shadowParts = [];        // 奶牛身上要投影的几个大件。小零件不投影：影子几乎看不出差别，阴影通道却要少画很多次。
  shadowParts.push(add(cow, new THREE.SphereGeometry(1, 32, 20), M.body, [0, 0, 0], null, [0.98, 0.5, 0.44]));

  // 乳房
  add(cow, SPH, M.pink, [-0.32, -0.47, 0], null, [0.26, 0.17, 0.23]);
  const teatGeo = new THREE.CylinderGeometry(0.03, 0.035, 0.11, 10);
  add(cow, mergeParts([[-0.22, 0.08], [-0.22, -0.08], [-0.42, 0.08], [-0.42, -0.08]].map(([x, z]) => [teatGeo, [x, -0.66, z]])), M.pinkDark);

  // 尾巴
  const tail = new THREE.Group();
  tail.position.set(-0.90, 0.18, 0);
  cow.add(tail);
  add(tail, new THREE.CylinderGeometry(0.05, 0.035, 0.60, 10), M.coat, [-0.125, -0.275, 0], [0, 0, -0.427]);
  add(tail, SPH, M.spot, [-0.27, -0.62, 0], [0, 0, -0.427], [0.07, 0.13, 0.07]);

  // 腿：髋关节 → 大腿 → 膝关节 → 小腿 + 蹄。
  // 大腿 = 髋关节的球 + 圆柱，小腿 = 膝关节的球 + 圆柱：各自合并成一个网格
  const HIP_GEO = mergeParts([[SPH, [0, 0.02, 0], null, [0.13, 0.13, 0.13]], [new THREE.CylinderGeometry(0.11, 0.085, L1, 14), [0, -L1 / 2, 0]]]);
  const KNEE_GEO = mergeParts([[SPH, [0, 0, 0], null, [0.09, 0.09, 0.09]], [new THREE.CylinderGeometry(0.082, 0.07, L2, 14), [0, -L2 / 2 + 0.06, 0]]]);
  const HOOF_GEO = new THREE.CylinderGeometry(0.098, 0.105, 0.13, 14);
  function makeLeg(hx, hz, lift, asym) {
    const hip = new THREE.Group();
    hip.position.set(hx, HIP_Y, hz);
    cow.add(hip);
    shadowParts.push(add(hip, HIP_GEO, M.coat));
    const knee = new THREE.Group();
    knee.position.set(0, -L1, 0);
    hip.add(knee);
    shadowParts.push(add(knee, KNEE_GEO, M.coat));
    const hoof = add(knee, HOOF_GEO, M.hoof, [0, -L2 + 0.065, 0]);
    return { hip, knee, hoof, hx, hz, lift, asym, ph: 0, type: hx > 0 ? 'front' : 'hind' };
  }
  const legs = [
    makeLeg(-0.60, 0.30, 0.26, 0.012),    // 后左
    makeLeg(-0.60, -0.30, 0.26, -0.012),  // 后右
    makeLeg(0.58, 0.30, 0.30, 0.012),     // 前左
    makeLeg(0.58, -0.30, 0.30, -0.012),   // 前右
  ];

  // 头
  const head = new THREE.Group();
  head.position.set(0.70, 0.26, 0);
  cow.add(head);
  const HC = [0.18, 0.26, 0];
  shadowParts.push(add(head, new THREE.SphereGeometry(0.38, 28, 18), M.head, HC));
  add(head, SPH, M.pink, [HC[0] + 0.30, HC[1] - 0.14, 0], null, [0.16, 0.12, 0.25]);
  add(head, mergeParts([0.095, -0.095].map(z => [SPH, [HC[0] + 0.455, HC[1] - 0.13, z], null, [0.02, 0.035, 0.028]])), M.pinkDark);
  const eyes = [];
  [0.62, -0.62].forEach(zs => {
    const dir = new THREE.Vector3(0.77, 0.16, zs).normalize();
    const eg = new THREE.Group();
    eg.position.set(HC[0] + dir.x * 0.355, HC[1] + dir.y * 0.355, dir.z * 0.355);
    head.add(eg);
    add(eg, SPH, M.eyeWhite, [0, 0, 0], null, [0.085, 0.095, 0.085]);
    add(eg, SPH, M.pupil, [dir.x * 0.055, dir.y * 0.055 + 0.005, dir.z * 0.055], null, [0.046, 0.052, 0.046]);
    add(eg, SPH, M.glint, [dir.x * 0.075 + 0.012, dir.y * 0.075 + 0.03, dir.z * 0.075 + 0.015], null, [0.015, 0.015, 0.015]);
    eyes.push(eg);
  });
  [1, -1].forEach(s => {
    const ear = new THREE.Group();
    ear.position.set(HC[0] - 0.06, HC[1] + 0.17, s * 0.44);
    ear.rotation.set(s * 0.5, 0, 0);
    head.add(ear);
    add(ear, SPH, M.coat, [0, 0, 0], null, [0.09, 0.045, 0.2]);
    add(ear, SPH, M.pink, [0.05, 0.005, 0], null, [0.045, 0.02, 0.13]);
  });
  const hornGeo = new THREE.ConeGeometry(0.055, 0.2, 12);
  add(head, mergeParts([1, -1].map(s => [hornGeo, [HC[0] + 0.02, HC[1] + 0.36, s * 0.17], [s * 0.35, 0, 0]])), M.horn);
  // 项圈与铃铛
  const collar = add(head, new THREE.TorusGeometry(0.33, 0.045, 12, 40), M.collar, [0.10, 0.10, 0]);
  collar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0.55, 0.83, 0).normalize());
  add(head, SPH, M.bell, [0.375, -0.16, 0], null, [0.09, 0.1, 0.09]);
  add(head, SPH, M.bellDark, [0.375, -0.24, 0], null, [0.032, 0.032, 0.032]);
  cow.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
  shadowParts.forEach(m => { m.castShadow = true; });

  // ---------- 撞栏判定：身体下沿 + 每条腿的膝和蹄，各用一个球去碰横杆 ----------
  const HIT_BODY = [[-0.72, -0.14, 0.2], [-0.36, -0.26, 0.22], [0, -0.3, 0.22], [0.36, -0.26, 0.22], [0.72, -0.14, 0.2], [-0.32, -0.58, 0.06]];
  const hitV = new THREE.Vector3();
  function touchesBar(x, y, r, barX) {
    return Math.abs(x - barX) < BAR_HALF + r && y - r < BAR_TOP && y + r > BAR_TOP - 0.14;
  }
  function hitsBar(barX) {
    for (let i = 0; i < HIT_BODY.length; i++) {
      const h = HIT_BODY[i];
      hitV.set(h[0], h[1], 0);
      cow.localToWorld(hitV);
      if (touchesBar(hitV.x, hitV.y, h[2], barX)) return true;
    }
    for (let i = 0; i < legs.length; i++) {
      const l = legs[i];
      l.knee.getWorldPosition(hitV);
      if (touchesBar(hitV.x, hitV.y, 0.085, barX)) return true;
      l.hoof.getWorldPosition(hitV);
      hitV.y -= 0.03;
      if (touchesBar(hitV.x, hitV.y, 0.1, barX)) return true;
    }
    return false;
  }

  // ---------- 特效：尘土与“哞～”气泡 ----------
  const glowTex = canvasTex(128, 128, ctx => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.65, 'rgba(255,255,255,0.2)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
  const dust = [];
  for (let i = 0; i < 24; i++) {                       // 每个尘土颗粒各占一次绘制，数量封顶
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xf3e6d2, transparent: true, opacity: 0, depthWrite: false }));
    s.visible = false;
    scene.add(s);
    dust.push({ s, life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r0: 0.1, r1: 0.5 });
  }
  function puff(x, z, n, big) {
    if (tier >= 2) return;
    for (let i = 0; i < n; i++) {
      const p = dust.find(d => d.life <= 0);
      if (!p) return;
      p.max = p.life = big ? 0.5 + Math.random() * 0.25 : 0.32;
      p.x = x + (Math.random() - 0.5) * 0.3;
      p.y = 0.06;
      p.z = z + (Math.random() - 0.5) * 0.3;
      p.vx = -(1 + speed * 0.3 + Math.random() * 2);
      p.vy = 0.3 + Math.random() * 0.7;
      p.vz = (Math.random() - 0.5) * 0.8;
      p.r0 = big ? 0.25 : 0.12;
      p.r1 = big ? 1.1 + Math.random() * 0.5 : 0.5;
      p.s.visible = true;
    }
  }

  const mooCanvas = document.createElement('canvas');
  mooCanvas.width = 256; mooCanvas.height = 128;     // 边长取 2 的整数次幂，WebGL 1 下才不会被缩放
  const mooCtx = mooCanvas.getContext('2d');
  const mooTex = new THREE.CanvasTexture(mooCanvas);
  mooTex.colorSpace = THREE.SRGBColorSpace;
  function drawMoo(text) {
    const c = mooCtx;
    c.clearRect(0, 0, 256, 144);
    c.fillStyle = '#fff';
    c.strokeStyle = '#4a3b35';
    c.lineWidth = 5;
    c.lineJoin = 'round';
    rr(c, 20, 10, 216, 72, 36);
    c.fill();
    c.stroke();
    c.beginPath();
    c.moveTo(98, 80); c.lineTo(72, 120); c.lineTo(134, 80);
    c.closePath();
    c.fill();
    c.beginPath();
    c.moveTo(98, 83); c.lineTo(72, 120); c.lineTo(134, 83);
    c.stroke();
    c.fillStyle = '#3b2f2f';
    c.font = '700 50px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, 128, 47);
    mooTex.needsUpdate = true;
  }
  drawMoo(MOOS[0]);
  const moo = new THREE.Sprite(new THREE.SpriteMaterial({ map: mooTex, transparent: true, depthWrite: false }));
  moo.visible = false;
  scene.add(moo);

  // ---------- 小红书容器提供的原生能力（window.xhs）。普通浏览器里没有这个对象：逐级判空，用不了就不启用对应功能 ----------
  const miniTool = () => (window.xhs && window.xhs.miniTool) || null;
  // 客户端版本号：buildVersion 的末 3 位是编译序号，比较时去掉。取不到就是“版本未知”，不能当作低版本
  function readBuildVersion(launchOptions) {
    const env = launchOptions && launchOptions.miniToolEnv;
    const value = env && env.buildVersion;
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (!/^[1-9]\d{6,}$/.test(String(value))) return null;
    const v = Number(value);
    return Number.isSafeInteger(v) ? v : null;
  }
  async function getBuildVersion() {
    const xhs = window.xhs;
    const sync = readBuildVersion(xhs && xhs.launchOptions);
    if (sync !== null) return sync;
    const mt = miniTool();
    if (!mt || typeof mt.getLaunchOptions !== 'function') return null;
    try { return readBuildVersion(await mt.getLaunchOptions()); } catch (e) { return null; }
  }
  const atLeast = (build, min) => build !== null && Math.floor(build / 1000) >= min;

  // 游戏进行中让屏幕保持常亮（客户端 9.55+），结束后撤销
  let keepOn = false;
  async function keepScreenOn(on) {
    if (on === keepOn) return;
    const mt = miniTool(), build = await getBuildVersion();
    if (!atLeast(build, 9550) || !mt || typeof mt.setKeepScreenOn !== 'function') return;
    keepOn = on;
    try { await mt.setKeepScreenOn({ keepScreenOn: on }); } catch (e) { keepOn = false; }
  }
  window.addEventListener('pagehide', () => { keepScreenOn(false); });

  // ---------- 游戏状态 ----------
  // 最高纪录存在容器的本地缓存里（客户端 9.46+）。版本未知、缺少接口或读写失败时都不改用浏览器存储，只是不显示、不保存纪录。
  const BEST_KEY = 'nainiu-hurdle-best';
  const STORAGE_MIN = 9460;                 // 客户端 9.46.0
  let bestOk = false;                       // 是否已经成功读到容器里的纪录
  // 返回容器里的纪录；读不到（不可用或失败）返回 null —— 读失败不代表没有旧纪录
  async function readBest() {
    const mt = miniTool(), build = await getBuildVersion();
    if (!atLeast(build, STORAGE_MIN) || !mt || typeof mt.getStorage !== 'function') return null;
    try {
      const r = await mt.getStorage({ key: BEST_KEY });
      if (!r || typeof r.errMsg !== 'string' || r.errMsg.indexOf(':ok') < 0) return null;
      if (r.data === null || r.data === undefined) return 0;
      const v = Number(JSON.parse(r.data));
      return isFinite(v) && v > 0 ? Math.floor(v) : 0;
    } catch (e) { return null; }
  }
  async function saveBest(v) {
    const mt = miniTool(), build = await getBuildVersion();
    if (!atLeast(build, STORAGE_MIN) || !mt || typeof mt.setStorage !== 'function') return;
    if (!bestOk) {                          // 之前没读到旧纪录：先再读一次，免得用一个更低的分数把它盖掉
      const old = await readBest();
      if (old === null) return;
      bestOk = true;
      if (old > v) { best = old; return; }
    }
    try {
      const r = await mt.setStorage({ key: BEST_KEY, data: JSON.stringify(v) });
      bestOk = !!r && r.errMsg === 'setStorage:ok';
    } catch (e) { bestOk = false; }         // 没保存成功：这次打开期间仍显示这一局的纪录，下次打开可能就没有了
  }
  // ---------- 音效（audio.js 里的 NainiuAudio，默认关闭）----------
  const SOUND_KEY = 'nainiu-hurdle-sound';
  // audio.js 没有加载时用一组空函数顶替，游戏照常运行
  const sound = window.NainiuAudio || {
    isEnabled: () => false, setEnabled: () => {}, toggle: () => {}, onChange: () => {}, unlock: () => {}, sfx: () => {}, music: () => {}, pause: () => {},
  };
  // 读写一个设置项（和最高纪录一样存在容器缓存里；存不了就只是这次打开期间有效）
  async function readPref(key) {
    const mt = miniTool(), build = await getBuildVersion();
    if (!atLeast(build, STORAGE_MIN) || !mt || typeof mt.getStorage !== 'function') return null;
    try {
      const r = await mt.getStorage({ key });
      if (!r || typeof r.errMsg !== 'string' || r.errMsg.indexOf(':ok') < 0) return null;
      return r.data === null || r.data === undefined ? null : JSON.parse(r.data);
    } catch (e) { return null; }
  }
  async function writePref(key, value) {
    const mt = miniTool(), build = await getBuildVersion();
    if (!atLeast(build, STORAGE_MIN) || !mt || typeof mt.setStorage !== 'function') return false;
    try {
      const r = await mt.setStorage({ key, data: JSON.stringify(value) });
      return !!r && r.errMsg === 'setStorage:ok';
    } catch (e) { return false; }
  }
  const sndBtn = document.getElementById('sndBtn'), sndText = document.getElementById('sndText');
  function syncSndBtn() {
    const v = sound.isEnabled();
    sndBtn.setAttribute('aria-pressed', v ? 'true' : 'false');
    sndBtn.setAttribute('aria-label', v ? '音效：开' : '音效：关');
    sndText.textContent = v ? '音效 开' : '音效 关';
  }
  sound.onChange(v => {
    syncSndBtn();
    writePref(SOUND_KEY, v ? 1 : 0);
    if (v) sound.music(state === 'playing');       // 游戏中途打开音效：音乐马上跟进
  });
  if (sndBtn) {
    // 不保留焦点：否则之后按空格会再次切换音效
    sndBtn.addEventListener('click', () => { sound.toggle(); sndBtn.blur(); });
    syncSndBtn();
  }
  readPref(SOUND_KEY).then(v => { if (v === 1) sound.setEnabled(true); });   // 上次打开过就沿用；声音仍要等用户操作之后才会真正响

  // ---------- 界面尺寸：避开容器的顶部按钮，并按舞台大小算出各处字号和留白 ----------
  let hostTop = 0, hostLeft = 0;            // 容器顶部按钮的下沿、左侧侧滑返回热区的右沿（相对舞台，像素）
  const probe = document.createElement('div');   // 用它读出系统安全区的实际像素值
  probe.style.cssText = 'position:absolute;top:0;left:0;visibility:hidden;pointer-events:none;' +
    'padding-top:var(--safe-t);padding-right:var(--safe-r);padding-bottom:var(--safe-b);padding-left:var(--safe-l);';
  stage.appendChild(probe);
  const rootStyle = document.documentElement.style;
  function updateUiVars() {
    if (!viewW || !viewH) return;
    const ps = window.getComputedStyle(probe);
    const safeT = parseFloat(ps.paddingTop) || 0, safeR = parseFloat(ps.paddingRight) || 0;
    const safeB = parseFloat(ps.paddingBottom) || 0, safeL = parseFloat(ps.paddingLeft) || 0;
    const w = viewW / 100, h = viewH / 100;                     // 舞台宽、高的 1%
    const u = (a, b, lo, hi) => clamp(Math.min(a * w, b * h), lo, hi) + 'px';   // 取宽、高两个方向上较小的那个，再限制在 lo ~ hi
    const vars = {
      '--w': w + 'px', '--h': h + 'px',
      '--pad-t': Math.max(1.5 * w, safeT + 8, hostTop) + 'px',
      '--pad-r': Math.max(1.6 * w, safeR + 8) + 'px',
      '--pad-b': Math.max(1.5 * w, safeB + 8) + 'px',
      '--pad-l': Math.max(1.6 * w, safeL + 8, hostLeft) + 'px',
      '--hud-pad-v': u(1.5, 1.3, 6, 11), '--hud-pad-h': u(3.2, 2.6, 10, 22),
      '--fs-title': u(3.6, 2.9, 13, 20), '--fs-score': u(4.2, 3.2, 15, 22), '--fs-hint': u(2.6, 2, 11, 14),
      '--fs-popup': u(7, 6, 18, 38),
      '--panel-pad-v': u(3.4, 3, 12, 22), '--panel-pad-h': u(3.4, 3, 16, 26),
      '--fs-ov-title': u(6.5, 7.5, 22, 40), '--fs-ov-text': u(3.8, 3.6, 13, 18), '--fs-ov-hint': u(3.6, 3.4, 13, 17),
      '--panel-radius': clamp(2 * w, 12, 22) + 'px',
    };
    for (const k in vars) rootStyle.setProperty(k, vars[k]);
  }
  // 顶部的标题和得分不能压在容器的返回 / 分享按钮或胶囊按钮上：读到它们的位置后把界面整体下移
  async function applyWindowInfo() {
    const mt = miniTool(), build = await getBuildVersion();
    if (!atLeast(build, 9490) || !mt || typeof mt.getWindowInfo !== 'function') return;
    try {
      const info = await mt.getWindowInfo();
      const shown = r => !!r && r.width > 0 && r.height > 0;
      const mb = info.menuButtons || {};
      const buttons = shown(mb.capsule) ? [mb.capsule] : [mb.back, mb.me, mb.share].filter(shown);
      let top = (info.safeArea && info.safeArea.top) || 0;
      buttons.forEach(r => { top = Math.max(top, r.bottom); });
      hostTop = top + 8;
      hostLeft = shown(info.gestureArea) ? info.gestureArea.right + 8 : 0;
      updateUiVars();
    } catch (e) { /* 读不到就只按系统安全区排布 */ }
  }
  applyWindowInfo();

  const TAP = coarse ? '点按屏幕' : '按 <kbd>空格</kbd> 或点击屏幕';
  ui.hint.textContent = coarse
    ? '点按 跳跃 · 双指拖动 旋转视角 · 双指张合 缩放'
    : '空格 / 点击 跳跃 · 拖拽旋转视角 · 滚轮缩放';

  let state = 'ready';                      // ready（待开始）| playing | crash（摔倒中）| over
  let speed = JOG_SPEED, dist = 0, runDist = 0, time = 0, timeScale = 1, shake = 0;
  let score = 0, cleared = 0, perfects = 0, best = 0;
  let jumping = false, jt = 0, jumpT = 1, jumpY0 = REST_Y, jumpHurdle = null, jumpPerfect = false, jumpBuffer = 0, landT = 9;
  let runPh = 0, bodyY = REST_Y, mooT = -9, blinkT = -1, nextBlink = 2;
  let crashT = 0, crashFrom = null, overAt = 0;
  const hudCache = { score: -1, count: -1, speed: '' };
  readBest().then(v => {                    // 读到旧纪录后，如果还停在开始面板上，就把纪录补进去
    bestOk = v !== null;
    if (v !== null && v > best) { best = v; if (state === 'ready') showReady(); }
  });

  // 步态节奏随速度变化：支撑期变短，步频变快
  function gait() {
    const st = Math.min(0.095, 0.66 / speed);
    const sw = Math.max(0.2, 0.27 - 0.012 * (speed - 7));
    return { st, sw, cyc: st + sw };
  }
  const gauss = (x, c, w) => {
    const d = ((x - c + 0.5) % 1 + 1) % 1 - 0.5;
    return Math.exp(-(d / w) * (d / w));
  };
  // 腾空时的腿部姿势关键帧：u → [髋关节角, 膝关节角]（弧度；髋为正=大腿前摆，膝为负=折叠）
  const POSE = {
    front: [[0, 0.85, -0.35], [0.05, 0.85, -0.35], [0.2, 1.75, -2.1], [0.68, 1.75, -2.1], [0.88, 0.45, -0.12], [1, 0.45, -0.12]],
    hind: [[0, -0.80, -0.15], [0.05, -0.80, -0.15], [0.2, -0.87, -2.0], [0.78, -0.87, -2.0], [0.96, -0.5, -0.6], [1, -0.5, -0.6]],
  };
  // 摔倒后四肢摊开趴地的姿势（后左、后右、前左、前右）
  const CRASH_LEGS = [[-0.9, -0.05], [-0.82, -0.12], [1.4, 0], [1.32, -0.06]];
  function evalPose(keys, u) {
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (u <= b[0]) {
        const e = smooth((u - a[0]) / (b[0] - a[0]));
        return [lerp(a[1], b[1], e), lerp(a[2], b[2], e)];
      }
    }
    const k = keys[keys.length - 1];
    return [k[1], k[2]];
  }
  // 奔跑时蹄子的落点（支撑期贴地后移，摆动期抬起前摆）
  function footPos(l, ph, g) {
    const hs = speed * g.st / 2;
    if (ph < g.st) return { x: l.hx + hs - speed * ph, y: 0 };
    const s = (ph - g.st) / g.sw;
    return { x: l.hx - hs + 2 * hs * smooth(s), y: l.lift * Math.sin(Math.PI * s) };
  }

  function resetCow() {
    const g = gait();
    jumping = false; landT = 9; jumpBuffer = 0; runPh = 0;
    crashFrom = null;
    legs[0].ph = g.st + 0.5 * g.sw;
    legs[1].ph = g.st + 0.5 * g.sw + 0.04;
    legs[2].ph = 0;
    legs[3].ph = g.cyc - 0.04;
  }

  function startGame() {
    state = 'playing';
    keepScreenOn(true);
    sound.music(true);
    speed = BASE_SPEED;
    runDist = 0; score = 0; cleared = 0; perfects = 0;
    hurdles.forEach((h, k) => {
      h.wx = dist + FIRST_HURDLE + k * HURDLE_SPACING;
      h.hit = false; h.tip = 0;
      h.passed = wrap(h.wx - dist, HURDLE_R) < 1.5;   // 一开始就在身后或身下的不算成绩
      h.g.rotation.z = 0;
      h.g.visible = true;
    });
    resetCow();
    timeScale = 1; shake = 0;
    ui.overlay.classList.add('hide');
    if (ui.flash.animate) ui.flash.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 380, easing: 'ease-out' });
  }

  function doJump() {
    jumping = true; jt = 0; jumpT = JUMP_DIST / speed; jumpY0 = bodyY; landT = 9; jumpBuffer = 0;
    jumpHurdle = null;
    let bx = Infinity;
    hurdles.forEach(h => {
      const x = h.g.position.x;
      if (!h.hit && !h.passed && x > 1.5 && x < 9 && x < bx) { bx = x; jumpHurdle = h; }
    });
    jumpPerfect = !!jumpHurdle && Math.abs(bx - PERFECT_X) <= PERFECT_W;
    puff(-0.9, 0.3, 4, true);
    puff(-0.9, -0.3, 4, true);
    sound.sfx('jump');
    if (Math.random() < 0.6) { drawMoo(pick(MOOS)); mooT = time; sound.sfx('moo'); }   // 冒出“哞～”气泡的同时出声
  }

  function landCow(g) {
    jumping = false; landT = 0; runPh = 0;
    legs[0].ph = g.st + 0.5 * g.sw;
    legs[1].ph = g.st + 0.5 * g.sw + 0.04;
    legs[2].ph = 0;
    legs[3].ph = g.cyc - 0.04;
    puff(0.9, 0.3, 4, true);
    puff(0.9, -0.3, 4, true);
    if (jumpBuffer > 0) doJump();     // 落地前按下的跳跃缓存：一落地立刻再跳
  }

  function crash(h) {
    state = 'crash'; crashT = 0;
    h.hit = true; h.tip = 0;
    jumping = false; jumpBuffer = 0;
    crashFrom = { y: bodyY, pitch: cow.rotation.z, tailZ: tail.rotation.z, tailX: tail.rotation.x, nod: head.rotation.z, legs: legs.map(l => [l.hip.rotation.z, l.knee.rotation.z]) };
    timeScale = 0.22; shake = 1;
    puff(0.6, 0.3, 5, true);
    puff(0.6, -0.3, 5, true);
    puff(h.g.position.x, 0, 4, true);
    sound.sfx('crash');
    sound.music(false);                           // 摔倒了，音乐停
  }

  function gameOver() {
    state = 'over'; overAt = time;
    keepScreenOn(false);
    const isNew = score > best;
    if (isNew) { best = score; saveBest(best); }
    ui.ovTitle.textContent = isNew ? '新纪录！' : '撞栏啦！';
    ui.ovText.innerHTML = '得分 <b>' + score + '</b>　跨栏 <b>' + cleared + '</b> 个<br>最高纪录 <b>' + best + '</b>';
    ui.ovHint.innerHTML = TAP + ' 再来一局';
    ui.overlay.classList.remove('hide');
  }

  function showReady() {
    ui.ovTitle.textContent = '牛牛跨栏';
    ui.ovText.innerHTML = '看准时机起跳，跨过栏架；撞栏就结束，速度会越来越快。' + (best > 0 ? '<br>最高纪录 <b>' + best + '</b>' : '');
    ui.ovHint.innerHTML = TAP + ' 开始';
    ui.overlay.classList.remove('hide');
  }

  function popup(text) {
    ui.popup.textContent = text;
    ui.popup.animate([
      { opacity: 1, transform: 'translate(-50%, -40%) scale(0.6)' },
      { opacity: 1, transform: 'translate(-50%, -80%) scale(1.15)', offset: 0.25 },
      { opacity: 0, transform: 'translate(-50%, -150%) scale(1)' },
    ], { duration: 950, easing: 'ease-out' });
  }

  // 唯一的输入入口：开始 / 起跳 / 再来一局
  function action() {
    sound.unlock();                               // 浏览器要求声音由用户的操作触发
    if (state === 'ready') startGame();
    else if (state === 'playing') { if (!jumping) doJump(); else jumpBuffer = 0.12; }
    else if (state === 'over' && time - overAt > 0.5) startGame();
  }

  // ---------- 每帧更新 ----------
  function updateWorld(dt) {
    if (state === 'ready') speed += (JOG_SPEED - speed) * Math.min(1, dt * 2);
    else if (state === 'playing') speed = Math.min(MAX_SPEED, speed + ACCEL * dt);
    else speed += (0 - speed) * Math.min(1, dt * 4);
    dist += speed * dt;
    if (state === 'playing') runDist += speed * dt;

    const off = -((dist / 4) % 1);
    grassTex.offset.x = off;
    trackTex.offset.x = off;
    for (let i = 0; i < MODS; i++) moduleX[i] = wrap((i - 5) * 12 - dist, 60);
    updateScenery();
    hurdles.forEach(h => {
      const nx = wrap(h.wx - dist, HURDLE_R);
      if (nx - h.g.position.x > HURDLE_R) { h.hit = false; h.tip = 0; h.passed = false; h.g.rotation.z = 0; }
      h.g.position.x = nx;
      if (h.hit) { h.tip = Math.min(1, h.tip + dt / 0.7); h.g.rotation.z = -1.45 * h.tip * h.tip; }
    });
    updateHurdles();
    clouds.forEach(c => {
      c.x += 0.7 * dt;
      if (c.x > 190) c.x = -190;
    });
    if (cloudIM.visible) updateClouds();
  }

  function updateCow(dt) {
    const g = gait();
    const crashed = state === 'crash' || state === 'over';
    legs.forEach(l => {
      l.ph += dt;
      if (l.ph >= g.cyc) {
        l.ph %= g.cyc;
        if (!crashed) puff(footPos(l, l.ph, g).x, l.hz, 1, false);
      }
    });

    let pitch = 0, roll = 0, k = 0, w = 0, u = 1, tailZ = 0, tailX = 0, nod = 0;
    const q = runPh / g.cyc;

    if (crashed) {
      // 摔倒：向前扑倒，四肢摊开趴在地上，落地后轻轻回弹
      crashT += dt;
      const p = clamp(crashT / 0.45, 0, 1), f = 1 - (1 - p) * (1 - p);
      const rest = crashT - 0.45;
      const bounce = rest > 0 ? 0.05 * Math.sin(rest * 20) * Math.exp(-rest * 7) : 0;
      bodyY = lerp(crashFrom.y, 0.58, f) + bounce;
      pitch = lerp(crashFrom.pitch, -0.15, f);
      k = -0.5 * Math.sin(Math.PI * p);
      tailZ = lerp(crashFrom.tailZ, -1.2, f) + 0.12 * Math.sin(time * 9) * (1 - f);
      tailX = lerp(crashFrom.tailX, 0, f) + 0.25 * Math.sin(time * 7) * (1 - f);
      nod = lerp(crashFrom.nod, -0.25, f) + (p >= 1 ? 0.07 * Math.sin(time * 3) : 0);
      legs.forEach((l, i) => {
        l.hip.rotation.z = lerp(crashFrom.legs[i][0], CRASH_LEGS[i][0], f);
        l.knee.rotation.z = lerp(crashFrom.legs[i][1], CRASH_LEGS[i][1], f);
      });
      if (state === 'crash' && crashT > 1.0) gameOver();
    } else {
      if (jumping) {
        jt += dt;
        u = clamp(jt / jumpT, 0, 1);
        bodyY = lerp(jumpY0, REST_Y, u) + JUMP_H * 4 * u * (1 - u);
        const bump = Math.min(1, Math.sin(Math.PI * u) / Math.sin(Math.PI * 0.15));
        pitch = lerp(0.25, -0.19, smooth((u - 0.15) / 0.7)) * bump;   // 起跳抬头，落地前低头
        k = Math.sin(Math.PI * Math.min(1, u / 0.35));                // 起跳拉伸
        w = smooth(u / 0.05);
        tailZ = lerp(-0.12 + 0.1 * Math.sin(TAU * q + 1), -1.15 + 0.15 * Math.sin(u * 14), w);
        tailX = 0.1 * Math.sin(u * 20);
        nod = lerp(0.04 * Math.sin(TAU * q + 2.1), -0.12 * Math.sin(Math.PI * u), w);
        if (u >= 1) landCow(g);
      }
      if (!jumping) {
        landT += dt;
        runPh = (runPh + dt) % g.cyc;
        const q2 = runPh / g.cyc;
        const lk = landT < 0.22 ? Math.sin(Math.PI * landT / 0.22) * (1 - landT / 0.22) * 1.2 : 0;   // 落地缓冲
        const c1 = (g.st + 0.25 * g.sw) / g.cyc, c2 = (1.5 * g.st + 0.75 * g.sw) / g.cyc;
        bodyY = REST_Y - 0.012 + 0.06 * (gauss(q2, c1, 0.16) + gauss(q2, c2, 0.15)) - 0.05 * lk;
        k = -lk;                                                      // 落地压扁
        w = landT < 0.12 ? 1 - smooth(landT / 0.12) : 0;
        pitch = 0.028 * Math.sin(TAU * q2 - 1.2);
        roll = 0.018 * Math.sin(TAU * q2 + 0.4);
        tailZ = lerp(-0.12 + 0.1 * Math.sin(TAU * q2 + 1), -0.9, w);
        tailX = 0.3 * Math.sin(time * 4.3);
        nod = lerp(0.04 * Math.sin(TAU * q2 + 2.1), 0.05, w);
      }
    }

    const sy = 1 + 0.06 * k, sxz = 1 - 0.035 * k;
    cow.position.set(0, bodyY, 0);
    cow.rotation.set(roll, 0, pitch);
    cow.scale.set(sxz, sy, sxz);
    tail.rotation.set(tailX, 0, tailZ);
    head.rotation.z = nod;

    // 两段式 IK：让蹄子落在目标点上，再与腾空姿势按 w 混合
    if (!crashed) {
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      legs.forEach(l => {
        const f = footPos(l, l.ph, g);
        const rx = f.x, ry = f.y - bodyY;
        const tx = (cp * rx + sp * ry) / sxz, ty = (-sp * rx + cp * ry) / sy;
        const dx = tx - l.hx, dy = ty - HIP_Y;
        const D = clamp(Math.hypot(dx, dy), 0.05, L1 + L2 - 0.005);
        const alpha = Math.atan2(dx, -dy), gamma = Math.acos(Math.min(1, D / (2 * L1)));
        const j = evalPose(POSE[l.type], clamp(u + l.asym, 0, 1));
        l.hip.rotation.z = lerp(alpha + gamma, j[0], w);
        l.knee.rotation.z = lerp(-2 * gamma, j[1], w);
      });
    }
    cow.updateMatrixWorld(true);

    // 眨眼
    if (time > nextBlink) { blinkT = 0; nextBlink = time + 2.4 + Math.random() * 2.8; }
    if (blinkT >= 0) {
      blinkT += dt;
      const bq = blinkT / 0.14;
      let e = 1;
      if (bq < 1) e = 1 - 0.9 * Math.sin(Math.PI * bq); else blinkT = -1;
      eyes.forEach(eg => { eg.scale.y = e; });
    }

    // 哞～
    const mt = time - mooT;
    if (mt < 1.0) {
      const s = 0.6 + 0.4 * smooth(mt / 0.15);
      moo.position.set(1.0, bodyY + 1.5 + mt * 0.25, 0.15);
      moo.scale.set(1.7 * s, 0.85 * s, 1);   // 贴图是 2:1，气泡按同样的比例显示
      moo.material.opacity = Math.min(1, mt / 0.1) * (1 - smooth((mt - 0.7) / 0.3));
      moo.visible = true;
    } else {
      moo.visible = false;
    }

    // 尘土
    dust.forEach(p => {
      if (p.life <= 0) return;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; return; }
      const dq = 1 - p.life / p.max;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const r = lerp(p.r0, p.r1, dq);
      p.s.position.set(p.x, p.y + r * 0.3, p.z);
      p.s.scale.set(r, r, 1);
      p.s.material.opacity = 0.55 * (1 - dq);
    });
  }

  function updateHud() {
    if (hudCache.score !== score) { hudCache.score = score; ui.score.textContent = score; }
    if (hudCache.count !== cleared) { hudCache.count = cleared; ui.count.textContent = cleared; }
    const sp = speed.toFixed(1);
    if (hudCache.speed !== sp) { hudCache.speed = sp; ui.speed.textContent = sp; }
  }

  // ---------- 相机：按屏幕比例自动取景 ----------
  // 启动就是侧面视角：镜头在跑道侧面，奶牛从左往右跑、栏架从右边过来，最容易判断起跳时机。
  // 注视点放在奶牛前上方 → 奶牛位于画面左侧偏下，右边留给迎面来的栏架。
  // 竖屏画面窄：镜头退得更远、视野更宽，才能同时装下奶牛和前方的跑道；两头随屏幕比例平滑过渡。
  let aspect = 16 / 9;
  function rigFor(a) {
    const s = smooth((a - 0.6) / 0.9);                 // 0 = 竖屏，1 = 宽屏
    // 先定画面宽度：要装下奶牛（约 3.3 m）和它前方至少 8 m 的跑道。竖屏取下限，宽屏放宽一些让奶牛更大。
    const width = lerp(10.8, 15.3, s);
    const hvis = width / a;                             // 注视点处的画面高度（米）= 画面宽度 ÷ 屏幕宽高比
    return {
      phi: 1.45,                                        // 镜头相对注视点的方位角（弧度）：0 在奶牛正后方，π/2 在正侧面
      pitch: lerp(0.26, 0.14, s),                       // 俯角
      dist: lerp(19, 12.5, s),                          // 镜头到注视点的距离
      tx: lerp(3.0, 3.9, s),                            // 注视点在奶牛前方的距离：奶牛位于画面中线偏左约一半处
      ty: 1.1 + lerp(0.3, 0.19, s) * hvis / 2,          // 注视点比奶牛高这么多 → 奶牛位于画面中线偏下
      hvis,
    };
  }
  const cam = { yaw: 0, pitch: 0, zoom: 1, tYaw: 0, tPitch: 0, tZoom: 1 };   // 拖拽、缩放产生的偏移（缩放倍率大于 1 是放大）
  let followY = 0;
  let swayK = 1;              // 呼吸式摆动的幅度系数：拖动视角时平滑淡出，松手后平滑恢复
  let fitK = 1;               // 缩放倍率的限制：奶牛放不下时自动把倍率压低（不超过 1）
  let pullK = 1;              // 镜头后退的倍数：转到侧面等视角时，前方露出的地方不够，就把镜头往后拉
  const camTarget = new THREE.Vector3();
  const camRight = new THREE.Vector3(), camUp = new THREE.Vector3(), camFwd = new THREE.Vector3(), vTmp = new THREE.Vector3();
  const LOOKAHEAD = 8;        // 栏架至少在离奶牛这么远（米）时就要出现在画面里，才来得及起跳
  const PULL_MAX = 24;        // 镜头最多后退到离注视点这么远：再远奶牛就会落进雾里发白，那时改为扩大视野

  // 奶牛全身的代表点（相对身体中心，米）：躯干轮廓、头、耳朵、牛角、铃铛、四蹄、乳房、尾巴。
  // 每一帧都用它们检查奶牛是否完整留在画面里——不管把视角转到哪、俯仰多少、放多大、屏幕多窄。
  const COW_PTS = [];
  [-0.98, -0.75, -0.4, 0, 0.4, 0.75, 0.98].forEach((x) => {          // 躯干椭球的几个截面
    const k = Math.sqrt(Math.max(0, 1 - (x / 0.98) * (x / 0.98)));
    for (let i = 0; i < 8; i++) COW_PTS.push([x, 0.5 * k * Math.cos(i * Math.PI / 4), 0.44 * k * Math.sin(i * Math.PI / 4)]);
  });
  [
    [1.36, 0.39, 0], [1.36, 0.39, 0.1], [1.36, 0.39, -0.1], [1.18, 0.38, 0.26], [1.18, 0.38, -0.26], [1.18, 0.26, 0], [1.18, 0.5, 0],   // 口鼻
    [0.88, 0.9, 0], [0.88, 0.52, 0.38], [0.88, 0.52, -0.38], [0.7, 0.3, 0], [0.7, 0.8, 0],                                         // 头顶和头的两侧
    [0.82, 0.6, 0.66], [0.82, 0.6, -0.66], [0.82, 0.69, 0.46], [0.82, 0.69, -0.46], [0.82, 0.55, 0.5], [0.82, 0.55, -0.5],         // 耳朵
    [0.9, 0.98, 0.21], [0.9, 0.98, -0.21], [0.9, 0.8, 0.17], [0.9, 0.8, -0.17],                                                     // 牛角
    [1.08, 0, 0], [1.08, 0.1, 0.1], [1.08, 0.1, -0.1],                                                                             // 铃铛
    [-0.32, -0.64, 0.1], [-0.32, -0.64, -0.1], [-0.22, -0.72, 0.08], [-0.42, -0.72, -0.08],                                         // 乳房
    [-1.62, 0.2, 0.2], [-1.62, 0.2, -0.2], [-1.2, -0.5, 0.2], [-1.2, -0.5, -0.2], [-1.45, -0.15, 0],                                 // 尾巴
  ].forEach((p) => COW_PTS.push(p));
  // 四蹄和膝盖在奔跑、腾空、趴地时可能到达的位置；每个点向四周扩 0.14 米，把腿的粗细算进去
  [[1.3, -0.9], [1.1, 0.05], [1.0, -1.1], [0.3, -1.1], [1.62, -0.19], [-1.45, -0.75], [-1.2, 0.05], [-1.1, -1.1], [-0.3, -1.1]].forEach(([x, y]) => {
    [[0, 0], [0.14, 0], [-0.14, 0], [0, 0.14], [0, -0.14]].forEach(([mx, my]) => COW_PTS.push([x + mx, y + my, 0.42], [x + mx, y + my, -0.42]));
  });
  const SAFE = 0.88;          // 奶牛必须留在画面中央这么大的范围里（整个画面是 -1 ~ 1）

  // 按方位角、俯角、距离摆好镜头并看向注视点
  function placeCamera(pit, phi, dist) {
    camera.position.set(
      camTarget.x - dist * Math.cos(pit) * Math.cos(phi),
      camTarget.y + dist * Math.sin(pit),
      camTarget.z + dist * Math.cos(pit) * Math.sin(phi)
    );
    camera.lookAt(camTarget);
    camera.updateMatrixWorld(true);
    const m = camera.matrixWorld.elements;
    camRight.set(m[0], m[1], m[2]);
    camUp.set(m[4], m[5], m[6]);
    camFwd.set(-m[8], -m[9], -m[10]);
  }
  // 奶牛相对画面中央安全区的越界情况：
  //   span  —— 奶牛占的范围是安全区的几倍（大于 1 表示整个安全区都装不下，需要缩小画面里的奶牛）
  //   shift —— 奶牛整体偏向哪边、偏了多少（米，沿镜头的右、上方向；平移注视点即可把它拉回来）
  function cowOverflow() {
    const tanV = Math.tan(camera.fov * 0.5 / DEG), tanH = tanV * aspect;
    const ox = camera.position.x, oy = camera.position.y, oz = camera.position.z;
    const depth = Math.max(0.3, -ox * camFwd.x + (bodyY - oy) * camFwd.y - oz * camFwd.z);     // 奶牛身体中心的深度
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < COW_PTS.length; i++) {
      const c = COW_PTS[i];
      const dx = c[0] - ox, dy = bodyY + c[1] - oy, dz = c[2] - oz;
      const zc = dx * camFwd.x + dy * camFwd.y + dz * camFwd.z;
      if (zc < 0.3) { x0 = Math.min(x0, -9); x1 = Math.max(x1, 9); y0 = Math.min(y0, -9); y1 = Math.max(y1, 9); continue; }   // 跑到了镜头背后
      const px = (dx * camRight.x + dy * camRight.y + dz * camRight.z) / (zc * tanH);
      const py = (dx * camUp.x + dy * camUp.y + dz * camUp.z) / (zc * tanV);
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
    }
    return {
      span: Math.max((x1 - x0) / (2 * SAFE), (y1 - y0) / (2 * SAFE)),
      shiftX: ((x1 > SAFE ? x1 - SAFE : 0) + (x0 < -SAFE ? x0 + SAFE : 0)) * depth * tanH,
      shiftY: ((y1 > SAFE ? y1 - SAFE : 0) + (y0 < -SAFE ? y0 + SAFE : 0)) * depth * tanV,
      left: x0,                 // 奶牛最左侧在画面上的位置（负数表示在画面中线左边）
    };
  }
  // 前方 LOOKAHEAD 米处（栏架的高度）在画面上的横向位置：大于 0.95 就算“栏架要很晚才看得见”
  function lookAheadX() {
    return vTmp.set(LOOKAHEAD, 1.1, 0).project(camera).x;
  }

  function updateCamera(dt, follow) {
    const r = rigFor(aspect);
    // 缩小有下限：视野角不超过约 75°，再宽画面边缘会严重变形。竖屏默认视野角本来就大，所以能缩小的幅度更小。
    cam.tZoom = clamp(cam.tZoom, clamp(r.hvis / 2 / r.dist / 0.767, 0.5, 1), 2);
    const ease = Math.min(1, dt * 8);
    cam.yaw += (cam.tYaw - cam.yaw) * ease;
    cam.pitch += (cam.tPitch - cam.pitch) * ease;
    cam.zoom += (cam.tZoom - cam.zoom) * Math.min(1, dt * 4);
    followY += (follow - followY) * Math.min(1, dt * 4);
    const intro = 1 - smooth(time / 2.4);              // 开场从稍远处缓缓推近
    // 只在“真正拖动视角”时才让摆动淡出，而且必须平滑过渡：
    // 如果随着按下、松开瞬间开关，每次点击镜头都会先跳过去、再跳回来，看起来就是抖一下。
    const first = pointers.values().next().value;
    const orbiting = pointers.size > 1 || (pointers.size === 1 && first.type !== 'touch' && moved >= DRAG_START);
    swayK += ((orbiting ? 0 : 1) - swayK) * Math.min(1, dt * 3);
    const phi = clamp(r.phi + cam.yaw + swayK * 0.035 * Math.sin(time * 0.3), 0.12, 1.5);
    const pit = clamp(r.pitch + cam.pitch + swayK * 0.02 * Math.sin(time * 0.23), 0.04, 1.25);
    const introK = 1 + intro * 0.45;                    // 开场时镜头远 45%，随后推近
    const dist = r.dist * introK;
    const hvis = r.hvis * (1 + 0.12 * clamp((speed - JOG_SPEED) / (MAX_SPEED - JOG_SPEED), 0, 1));   // 速度越快画面越宽
    // 画面大小 = 注视点处的画面高度 hvis ÷ 倍率。倍率来自用户的缩放（只改变视野角，镜头位置不动）；
    // 如果放得这么大奶牛就装不下，就自动把倍率压低。限制只在必要时立刻生效，放宽时平滑恢复，转动视角时画面不会一顿一顿。
    fitK = Math.min(1, fitK + (1 - fitK) * Math.min(1, dt * 4));
    pullK = 1 + (pullK - 1) * (1 - Math.min(1, dt * 4));
    let tanHalf = hvis / 2 / dist / (cam.zoom * fitK) * introK;   // 乘回 introK：推近过程中视野角保持不变
    const setFov = () => { camera.fov = 2 * Math.atan(tanHalf) * DEG; camera.updateProjectionMatrix(); };
    const place = () => placeCamera(pit, phi, dist * pullK);
    camTarget.set(r.tx, r.ty + 0.3 * followY, 0);
    setFov();
    place();
    let f = cowOverflow();
    for (let i = 0; i < 6 && f.span > 1; i++) {        // 装不下：扩大视野，直到奶牛放得进安全区
      tanHalf *= f.span * 1.02;
      setFov();
      f = cowOverflow();
    }
    fitK = Math.min(fitK, introK * hvis / 2 / dist / (tanHalf * cam.zoom));
    for (let i = 0; i < 3 && (Math.abs(f.shiftX) > 1e-4 || Math.abs(f.shiftY) > 1e-4); i++) {   // 偏出去了：平移注视点（镜头随之平移，朝向不变）
      camTarget.addScaledVector(camRight, f.shiftX).addScaledVector(camUp, f.shiftY);
      place();
      f = cowOverflow();
    }
    // 前方要露出足够长的跑道：栏架至少在 LOOKAHEAD 米外就能看见。
    // 先在奶牛不出安全区的前提下把注视点往前挪（奶牛往画面左侧让），让不动了再把镜头往后拉。
    for (let i = 0, laX = lookAheadX(); i < 40 && laX > 0.95; i++, laX = lookAheadX()) {
      const room = f.left + SAFE;                      // 奶牛左侧还能让出多少
      if (room > 0.004) {
        const depth = Math.max(0.3, vTmp.set(LOOKAHEAD, 1.1, 0).sub(camera.position).dot(camFwd));
        camTarget.addScaledVector(camRight, Math.min(laX - 0.95, room) * depth * Math.tan(camera.fov * 0.5 / DEG) * aspect);
        place();
        f = cowOverflow();
      } else {
        // 画面上的位置大致与距离、与视野角的正切成反比；按超出多少放大，每一步最多 1.6 倍，避免过冲
        const k = Math.min(1.6, 1 + (laX - 0.95) * 0.6);
        if (dist * pullK < PULL_MAX - 0.05) {         // 留一点容差：到了上限时乘积可能算成 23.999…，会被误判成还没到
          pullK = Math.min(PULL_MAX / dist, pullK * k);
          place();
        } else {
          tanHalf *= k;                               // 退到头了：改为扩大视野
          setFov();
        }
        f = cowOverflow();
      }
    }
    if (shake > 0) {
      shake = Math.max(0, shake - dt * 1.6);
      const s = shake * shake * 0.18;
      camera.position.x += Math.sin(time * 61) * s;
      camera.position.y += Math.cos(time * 53) * s * 0.7;
      camera.position.z += Math.sin(time * 47) * s * 0.5;
      camera.lookAt(camTarget);
    }
  }

  // ---------- 输入 ----------
  const KEYS = ['Space', 'ArrowUp', 'KeyW', 'Enter'];
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' || e.code === 'ArrowUp') e.preventDefault();
    if (e.repeat || KEYS.indexOf(e.code) < 0) return;
    action();
  });
  cvs.addEventListener('contextmenu', e => { e.preventDefault(); });
  // 指针：鼠标轻点 = 跳跃、拖动 = 旋转视角、滚轮 = 缩放；
  //       触屏一按下就跳（比等手指抬起反应快），双指一起拖动 = 旋转视角，双指张合 = 缩放
  const pointers = new Map();
  const DRAG_START = 3;       // 鼠标移动超过这么多像素才算拖动（点击时手轻微抖动不算）
  let px = 0, py = 0, downX = 0, downY = 0, moved = 0, pinchDist = 0;
  const pair = () => {
    const p = [...pointers.values()];
    return { cx: (p[0].x + p[1].x) / 2, cy: (p[0].y + p[1].y) / 2, d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) };
  };
  cvs.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    cvs.setPointerCapture(e.pointerId);
    moved = 0;
    if (pointers.size === 1) {
      px = downX = e.clientX; py = downY = e.clientY;
      if (e.pointerType === 'touch') action();
    } else if (pointers.size === 2) {
      const q = pair();
      px = q.cx; py = q.cy; pinchDist = q.d;
    }
  });
  cvs.addEventListener('pointermove', e => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 1) {
      if (p.type === 'touch') return;                 // 单指移动不做任何事
      moved = Math.max(moved, Math.hypot(e.clientX - downX, e.clientY - downY));
      if (moved >= DRAG_START) {
        cam.tYaw -= (e.clientX - px) * 0.006;
        cam.tPitch = clamp(cam.tPitch + (e.clientY - py) * 0.005, -0.5, 1.1);
      }
      px = e.clientX; py = e.clientY;
    } else if (pointers.size === 2) {
      const q = pair();
      cam.tYaw -= (q.cx - px) * 0.006;
      cam.tPitch = clamp(cam.tPitch + (q.cy - py) * 0.005, -0.5, 1.1);
      px = q.cx; py = q.cy;
      if (pinchDist > 0 && q.d > 0) cam.tZoom = clamp(cam.tZoom * q.d / pinchDist, 0.5, 2);     // 张开 = 放大
      pinchDist = q.d;
      moved = Infinity;
    }
  });
  cvs.addEventListener('pointerup', e => {
    const tap = pointers.size === 1 && e.pointerType !== 'touch' && moved < 8;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) moved = Infinity;
    if (tap) action();
  });
  cvs.addEventListener('pointercancel', e => {
    pointers.delete(e.pointerId);
    pinchDist = 0;
    moved = Infinity;
  });
  cvs.addEventListener('wheel', e => {
    e.preventDefault();
    cam.tZoom = clamp(cam.tZoom * Math.exp(-e.deltaY * 0.0015), 0.5, 2);     // 向上滚动 = 放大
  }, { passive: false });

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    aspect = w / h; viewW = w; viewH = h;
    renderer.setPixelRatio(pixelRatio());   // 窗口换到不同像素比的屏幕、或系统缩放变化时跟着更新
    renderer.setSize(w, h, false);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    updateUiVars();
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(resize).observe(stage);   // 较新的内核：舞台尺寸一变就重算
  window.addEventListener('resize', resize);                                            // 旧内核的兜底
  window.addEventListener('orientationchange', () => { setTimeout(resize, 200); });
  resize();

  // ---------- 主循环 ----------
  // 目标 30 帧：一帧约 33 毫秒，留一些余量给输入和页面自身的开销
  const FRAME_BUDGET = 1 / 27;
  let frameCount = 0, frameAvg = 1 / 60, slow = 0;
  let hidden = document.hidden === true, contextLost = false, lostCount = 0, stopped = false, running = false;
  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden === true;
    sound.pause(hidden);
    if (!hidden) {                           // 回到前台：重置计时，不让它在后台攒下的时间补算一大段
      last = performance.now(); frameAvg = 1 / 60; slow = 0;
      if (!running) { running = true; requestAnimationFrame(frame); }
    }
  });
  cvs.addEventListener('webglcontextlost', e => {
    e.preventDefault();                      // 不阻止默认行为的话，浏览器不会再尝试恢复
    contextLost = true; lostCount++;
    if (lostCount > 3) { stopped = true; showFatal('3D 画面多次中断，请退出后重新打开。'); return; }
    statusEl.textContent = '画面暂时中断，正在恢复…';
    statusEl.style.display = '';
  });
  cvs.addEventListener('webglcontextrestored', () => {
    if (stopped) return;
    contextLost = false; last = performance.now();
    statusEl.style.display = 'none';
  });
  let last = performance.now();
  function frame(now) {
    if (stopped) return;
    if (hidden) { running = false; return; } // 隐藏期间不再申请下一帧，回到前台时由上面的 visibilitychange 重新启动
    requestAnimationFrame(frame);
    if (contextLost) { last = now; return; } // 上下文丢失期间不更新、不绘制，游戏停在原地等恢复
    const real = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    frameAvg += (real - frameAvg) * 0.02;    // 帧耗时的滑动平均
    timeScale += (1 - timeScale) * Math.min(1, real * 2.5);   // 撞栏瞬间是慢动作，随后恢复
    const dt = real * timeScale;
    time += dt;
    if (renderer.getPixelRatio() !== pixelRatio()) resize();   // 窗口换到像素比不同的屏幕上时，尺寸没变但清晰度要跟上

    updateWorld(dt);
    updateCow(dt);

    if (state === 'playing') {
      score = Math.floor(runDist) + cleared * CLEAR_POINTS + perfects * PERFECT_POINTS;
      for (let i = 0; i < hurdles.length; i++) {
        const h = hurdles[i], x = h.g.position.x;
        if (h.passed) continue;
        if (x < -1.7) {
          h.passed = true;
          cleared++;
          if (h === jumpHurdle && jumpPerfect) { perfects++; popup('完美！+' + PERFECT_POINTS); sound.sfx('perfect'); }
          else sound.sfx('cheer');                // 观众欢呼
        } else if (x < 2.6 && hitsBar(x)) {
          crash(h);
          break;
        }
      }
      jumpBuffer = Math.max(0, jumpBuffer - dt);
    }

    updateHud();
    updateCamera(real, clamp((bodyY - REST_Y) / JUMP_H, 0, 1));
    renderer.render(scene, camera);
    if (!ready) { ready = true; statusEl.style.display = 'none'; }

    // 运行时降档：只在玩的时候统计，每 120 帧看一次平均帧耗时；连续两次超过预算才降一档，不因为一次卡顿就降画质
    if (++frameCount % 120 === 0) {
      if (state === 'playing' && frameAvg > FRAME_BUDGET) slow++; else slow = 0;
      if (slow >= 2 && tier < 2) { tier++; applyTier(); resize(); slow = 0; frameAvg = 1 / 60; }
    }
  }

  resetCow();
  showReady();
  running = true;
  requestAnimationFrame(frame);
  }
  requestAnimationFrame(() => { setTimeout(boot, 0); });
})();
