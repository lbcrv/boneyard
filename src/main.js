import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { world, FIXED_DT, syncAll, GROUP } from './physics.js';
import { Ragdoll, STATE_LABEL } from './ragdoll.js';
import * as lv from './level.js';
import { L } from './level.js';
import { MAPS } from './maps.js';
import * as fx from './fx.js';
import * as sfx from './audio.js';
import { ICONS } from './icons.js';

// ------------------------------------------------------------------ renderer / scene
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);
renderer.domElement.style.cursor = 'crosshair';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, Math.max(1, window.innerWidth) / Math.max(1, window.innerHeight), 0.1, 900);

const skyUniforms = { top: { value: new THREE.Color('#5d9fe0') }, bottom: { value: new THREE.Color('#dfe9f2') } };
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(700, 32, 16),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6+0.05, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.8)), 1.0); }',
  }),
);
sky.renderOrder = -1;
scene.add(sky);

const hemi = new THREE.HemisphereLight(0xdfefff, 0x6b5a48, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -28; sun.shadow.camera.right = 28;
sun.shadow.camera.top = 28; sun.shadow.camera.bottom = -28;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 160;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const sunOffset = new THREE.Vector3(30, 50, 18);

fx.initFx(scene, camera);
lv.initLevel(scene);

const ragdoll = new Ragdoll(scene);
L.ragdoll = ragdoll;

// ------------------------------------------------------------------ state
let currentMap = null;
let paused = true;
let timeScale = 1;
let slowmo = false;
let moonGravity = false;
let hitStop = 0;
let lastHitStop = -10;
let tool = 0;
let score = 0;
let best = 0;
let combo = 0;
let lastHitTime = -10;
let runTime = 0;
let runStarted = false;
let respawnTimer = 0;
let realTime = 0;

const TOOLS = [
  { id: 'grab', nm: 'Agarrar' },
  { id: 'cannon', nm: 'Cañón' },
  { id: 'bomb', nm: 'Bomba' },
  { id: 'crate', nm: 'Caja' },
  { id: 'barrel', nm: 'Barril' },
  { id: 'truck', nm: 'Camión' },
  { id: 'push', nm: 'Empujón' },
];

function store(key, val) { try { localStorage.setItem('boneyard.' + key, String(val)); } catch { /* ignore */ } }
function load(key) { try { return Number(localStorage.getItem('boneyard.' + key)) || 0; } catch { return 0; } }

// ------------------------------------------------------------------ camera
const cam = { yaw: Math.PI, pitch: 0.32, dist: 6.5, target: new THREE.Vector3(0, 1.2, 0) };
const _camPos = new THREE.Vector3();

function updateCamera(dt) {
  const c = ragdoll.chest.position;
  const desired = new THREE.Vector3(c.x, c.y + 0.25, c.z);
  cam.target.lerp(desired, 1 - Math.exp(-dt * 7));
  _camPos.set(
    Math.sin(cam.yaw) * Math.cos(cam.pitch),
    Math.sin(cam.pitch),
    Math.cos(cam.yaw) * Math.cos(cam.pitch),
  ).multiplyScalar(cam.dist).add(cam.target);
  camera.position.copy(_camPos).add(fx.getShake());
  camera.lookAt(cam.target);
  sun.position.copy(cam.target).add(sunOffset);
  sun.target.position.copy(cam.target);
  sky.position.copy(camera.position);
}

function camForward() { return { x: -Math.sin(cam.yaw), z: -Math.cos(cam.yaw) }; }

// ------------------------------------------------------------------ input
const keys = new Set();
const pending = { jump: false, dive: false, punch: false, limp: false };
const mouse = new THREE.Vector2();
let mouseClient = { x: 0, y: 0 };
let rmbDown = false;
let lastMouse = { x: 0, y: 0 };

window.addEventListener('keydown', (e) => {
  if (e.repeat && !['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) return;
  if (e.code === 'Escape') { toggleMenu(); return; }
  if (paused) return;
  keys.add(e.code);
  switch (e.code) {
    case 'Space': pending.jump = true; e.preventDefault(); break;
    case 'KeyQ': pending.dive = true; break;
    case 'KeyF': pending.punch = true; break;
    case 'KeyX': pending.limp = true; break;
    case 'KeyR': respawn(); break;
    case 'Backspace': e.preventDefault(); loadMap(currentMap); break;
    case 'KeyT': slowmo = !slowmo; sfx.blip(slowmo ? 440 : 660); updateFlags(); break;
    case 'KeyG':
      moonGravity = !moonGravity;
      world.gravity.set(0, moonGravity ? -3.2 : -9.82, 0);
      for (const b of world.bodies) b.wakeUp();
      sfx.blip(moonGravity ? 330 : 660); updateFlags();
      break;
    case 'KeyH': {
      const collapsed = document.getElementById('help').classList.toggle('collapsed');
      store('helpCollapsed', collapsed ? 1 : 0);
      break;
    }
    default:
      if (/^Digit[1-7]$/.test(e.code)) selectTool(Number(e.code.slice(5)) - 1);
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

const canvas = renderer.domElement;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  sfx.initAudio();
  setMouse(e);
  if (e.button === 2 || e.button === 1) { rmbDown = true; lastMouse = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); return; }
  if (e.button === 0 && !paused) useTool(true);
});
canvas.addEventListener('pointermove', (e) => {
  setMouse(e);
  if (rmbDown) {
    cam.yaw -= (e.clientX - lastMouse.x) * 0.006;
    cam.pitch = Math.max(-0.35, Math.min(1.35, cam.pitch + (e.clientY - lastMouse.y) * 0.005));
    lastMouse = { x: e.clientX, y: e.clientY };
  }
});
canvas.addEventListener('pointerup', (e) => {
  if (e.button === 2 || e.button === 1) { rmbDown = false; return; }
  if (e.button === 0) releaseGrab();
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (grab) { grab.dist = Math.max(1.5, Math.min(30, grab.dist - e.deltaY * 0.01)); return; }
  cam.dist = Math.max(2.5, Math.min(30, cam.dist * (1 + Math.sign(e.deltaY) * 0.1)));
}, { passive: false });

function setMouse(e) {
  mouseClient = { x: e.clientX, y: e.clientY };
  mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
}

window.addEventListener('resize', () => {
  camera.aspect = Math.max(1, window.innerWidth) / Math.max(1, window.innerHeight);
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function readInput() {
  const f = camForward();
  const r = { x: -f.z, z: f.x };
  let mx = 0, mz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) { mx += f.x; mz += f.z; }
  if (keys.has('KeyS') || keys.has('ArrowDown')) { mx -= f.x; mz -= f.z; }
  if (keys.has('KeyD') || keys.has('ArrowRight')) { mx += r.x; mz += r.z; }
  if (keys.has('KeyA') || keys.has('ArrowLeft')) { mx -= r.x; mz -= r.z; }
  return {
    moveX: mx, moveZ: mz,
    run: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    jump: pending.jump, dive: pending.dive, punch: pending.punch, limpToggle: pending.limp,
    grab: keys.has('KeyE'),
    camYaw: Math.atan2(f.x, f.z),
  };
}

// ------------------------------------------------------------------ picking
const raycaster = new THREE.Raycaster();
function pick() {
  raycaster.setFromCamera(mouse, camera);
  const objs = L.meshes.concat(ragdoll.parts.map((p) => p.mesh));
  const hits = raycaster.intersectObjects(objs, true);
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData.body) o = o.parent;
    return { point: h.point, body: o ? o.userData.body : null, distance: h.distance };
  }
  // fall back to a ground-plane hit
  const t = -raycaster.ray.origin.y / raycaster.ray.direction.y;
  if (t > 0 && t < 300) return { point: raycaster.ray.at(t, new THREE.Vector3()), body: null, distance: t };
  return null;
}

// ------------------------------------------------------------------ tools
let grab = null;
const grabAnchor = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, collisionFilterGroup: 0, collisionFilterMask: 0 });
world.addBody(grabAnchor);
const spawned = [];

function track(b) {
  spawned.push(b);
  while (spawned.length > 45) lv.removeBody(spawned.shift());
}

function selectTool(i) {
  tool = i;
  document.querySelectorAll('.tool').forEach((el, j) => el.classList.toggle('active', j === i));
  sfx.blip(520 + i * 40);
}

function useTool() {
  const T = TOOLS[tool].id;
  const h = pick();
  const dir = raycaster.ray.direction.clone();
  switch (T) {
    case 'grab': {
      if (!h || !h.body || h.body.type !== CANNON.Body.DYNAMIC) return;
      const b = h.body;
      const local = b.pointToLocalFrame(new CANNON.Vec3(h.point.x, h.point.y, h.point.z), new CANNON.Vec3());
      grabAnchor.position.set(h.point.x, h.point.y, h.point.z);
      const isRag = ragdoll.isOwnBody(b);
      const c = new CANNON.PointToPointConstraint(b, local, grabAnchor, new CANNON.Vec3(0, 0, 0), isRag ? 2200 : Math.min(60000, b.mass * 120));
      world.addConstraint(c);
      b.wakeUp();
      grab = { body: b, c, dist: h.distance, isRag };
      if (isRag) ragdoll.goFall('grab');
      sfx.blip(300);
      break;
    }
    case 'cannon': {
      const p = camera.position.clone().addScaledVector(dir, 1.2);
      const v = dir.clone().multiplyScalar(36);
      v.y += 1.2;
      lv.cannonball(p, v);
      sfx.shot();
      fx.shake(0.25);
      break;
    }
    case 'bomb': {
      if (!h) return;
      lv.explode(h.point.clone().addScaledVector(dir, -0.2), 6, 20);
      break;
    }
    case 'crate': {
      if (!h) return;
      const s = 0.6 + Math.random() * 0.5;
      track(lv.crate([h.point.x, h.point.y + 3.5, h.point.z], s, [Math.random() * 3, Math.random() * 3, 0]));
      sfx.blip(400);
      break;
    }
    case 'barrel': {
      if (!h) return;
      track(lv.barrel([h.point.x, h.point.y + 3, h.point.z]));
      sfx.blip(360);
      break;
    }
    case 'truck': {
      if (!h) return;
      const f = new THREE.Vector3(dir.x, 0, dir.z).normalize();
      const p = h.point.clone().addScaledVector(f, -20);
      p.y = h.point.y + 1.3;
      track(lv.truck(p, f, 24));
      sfx.whoosh();
      break;
    }
    case 'push': {
      const origin = camera.position;
      sfx.whoosh();
      for (const b of world.bodies) {
        if (b.type !== CANNON.Body.DYNAMIC) continue;
        const d = new THREE.Vector3(b.position.x - origin.x, b.position.y - origin.y, b.position.z - origin.z);
        const dist = d.length();
        if (dist > 16 + cam.dist) continue;
        const cos = d.dot(dir) / dist;
        if (cos < 0.86) continue;
        const f = (1 - dist / (16 + cam.dist)) * 16 * (b.mass > 300 ? 300 / b.mass : 1);
        b.wakeUp();
        b.velocity.x += dir.x * f; b.velocity.y += dir.y * f + f * 0.25; b.velocity.z += dir.z * f;
        if (ragdoll.isOwnBody(b)) ragdoll.knockdown(0.5);
      }
      for (let i = 0; i < 10; i++) fx.dust(camera.position.clone().addScaledVector(dir, 2 + i * 1.2), 0.5);
      break;
    }
  }
}

function releaseGrab() {
  if (!grab) return;
  world.removeConstraint(grab.c);
  grabAnchor.velocity.setZero();
  if (grab.isRag) {
    // keep throws fun but not orbital
    for (const p of ragdoll.parts) {
      const v = p.body.velocity, sp = v.length();
      if (sp > 20) v.scale(20 / sp, v);
    }
  }
  grab = null;
}

function updateGrab(dt) {
  if (!grab) return;
  if (!grab.body.world) { releaseGrab(); return; }
  raycaster.setFromCamera(mouse, camera);
  const target = raycaster.ray.at(grab.dist, new THREE.Vector3());
  const p = grabAnchor.position;
  const k = Math.min(1, dt * 25);
  const nx = p.x + (target.x - p.x) * k, ny = p.y + (target.y - p.y) * k, nz = p.z + (target.z - p.z) * k;
  let vx = (nx - p.x) / dt, vy = (ny - p.y) / dt, vz = (nz - p.z) / dt;
  const sp = Math.hypot(vx, vy, vz), MAX = 16;
  if (sp > MAX) { vx *= MAX / sp; vy *= MAX / sp; vz *= MAX / sp; }
  grabAnchor.velocity.set(vx, vy, vz);
  if (grab.isRag) { ragdoll.restT = 0; if (ragdoll.state !== 'limp') ragdoll.goFall('grab'); }
}

// ------------------------------------------------------------------ score & feedback
const elScore = document.getElementById('score');
const elBest = document.getElementById('best');
const elBones = document.getElementById('bones');
const elCombo = document.getElementById('combo');
const elState = document.getElementById('state');
const elTimer = document.getElementById('timer');
const elFlags = document.getElementById('flags');

function addPoints(pts, label, pos, cls = '') {
  if (pts <= 0) return;
  if (realTime - lastHitTime < 1.3) combo++; else combo = 0;
  lastHitTime = realTime;
  const mult = 1 + Math.min(20, combo) * 0.1;
  const total = Math.round(pts * mult);
  score += total;
  if (score > best) { best = score; store('best.' + currentMap.id, best); }
  if (pos) {
    const p = pos.isVector3 ? pos : new THREE.Vector3(pos.x, pos.y, pos.z);
    const size = 16 + Math.min(30, total / 14);
    if (total >= 8 || label) fx.popup(p, (label ? label + ' ' : '') + '+' + total, cls, size);
  }
  elScore.classList.add('bump');
  setTimeout(() => elScore.classList.remove('bump'), 90);
}
L.onScore = (pts, label, pos) => addPoints(pts, label, pos, 'big');

function handleRagdollEvents() {
  for (const e of ragdoll.events) {
    switch (e.type) {
      case 'hit': {
        const head = e.part.name === 'head';
        addPoints(e.pts, head && e.pts > 40 ? '¡CABEZA!' : '', e.point, head ? 'head' : '');
        sfx.thud(e.v, true);
        if (e.v > 5.5) sfx.grunt(e.v / 8);
        if (e.v > 7) fx.dust(e.point, Math.min(1.6, e.v / 10));
        if (e.v > 8) { fx.shake(Math.min(1.2, e.v / 22)); fx.flash(Math.min(0.8, (e.v - 6) / 16)); }
        if (e.v > 13 && realTime - lastHitStop > 1.2) { hitStop = 0.35; lastHitStop = realTime; }
        break;
      }
      case 'break':
        sfx.crack();
        fx.banner('¡CRACK!', e.part.def.label + ' ROTO');
        fx.debris(e.point, 0xf3eee2, 7, 3, 0.04);
        fx.flash(0.9);
        addPoints(250, '¡HUESO ROTO!', e.point, 'head');
        break;
      case 'ko':
        fx.banner('K.O.', 'fuera de combate');
        addPoints(500, 'K.O.', e.point, 'big');
        break;
      case 'step':
        sfx.knock(e.v * 0.4, 0.35);
        break;
      case 'punch':
      case 'jump':
        sfx.whoosh();
        break;
      case 'grip':
        sfx.blip(250);
        break;
    }
  }
  ragdoll.events.length = 0;
}

function updateHUD() {
  elScore.textContent = score.toLocaleString('es');
  elBest.textContent = best.toLocaleString('es');
  elBones.textContent = ragdoll.brokenCount;
  const mult = 1 + Math.min(20, combo) * 0.1;
  const comboLive = realTime - lastHitTime < 1.3 && combo > 0;
  elCombo.classList.toggle('hidden', !comboLive);
  if (comboLive) elCombo.textContent = 'x' + mult.toFixed(1);
  const ds = ragdoll.displayState;
  const cls = { stand: 'stand', air: 'stand', stumble: 'stumble', fall: 'fall', down: 'fall', ko: 'ko', wrecked: 'ko', getup: 'getup', limp: 'limp' }[ds] || 'fall';
  elState.className = 'state ' + cls;
  elState.textContent = STATE_LABEL[ds] || ds;
  if (currentMap?.timed) {
    elTimer.classList.remove('hidden');
    elTimer.textContent = runTime.toFixed(2) + ' s';
  } else elTimer.classList.add('hidden');
}

function updateFlags() {
  const f = [];
  if (slowmo) f.push('CÁMARA LENTA ×0.3');
  if (moonGravity) f.push('GRAVEDAD 3.2 m/s²');
  elFlags.textContent = f.join(' · ');
}

// ------------------------------------------------------------------ maps
function applyEnv(env) {
  skyUniforms.top.value.set(env.skyTop);
  skyUniforms.bottom.value.set(env.skyBottom);
  scene.fog = new THREE.Fog(env.fog, env.fogNear, env.fogFar);
  sunOffset.set(...env.sun);
}

function loadMap(map) {
  releaseGrab();
  spawned.length = 0;
  lv.clearLevel();
  fx.clearFx();
  L.checkpoint = null;
  L.finished = false;
  currentMap = map;
  applyEnv(map.env);
  map.build();
  best = load('best.' + map.id);
  document.getElementById('map-name').textContent = map.code + ' · ' + map.name.toUpperCase();
  respawn(true);
  // let props settle without the player noticing
  for (let i = 0; i < 30; i++) world.step(FIXED_DT);
  for (const b of world.bodies) if (!ragdoll.isOwnBody(b)) b.velocity.setZero();
  ragdoll.reset(spawnPos(), map.spawn.yaw);
}

function spawnPos() {
  const s = L.checkpoint || currentMap.spawn.pos;
  return new THREE.Vector3(...s);
}

function respawn(silent = false) {
  releaseGrab();
  const yaw = currentMap.spawn.yaw;
  ragdoll.reset(spawnPos(), yaw);
  cam.yaw = yaw + Math.PI;
  cam.target.copy(spawnPos()).add(new THREE.Vector3(0, 1.5, 0));
  score = 0;
  combo = 0;
  respawnTimer = 0;
  if (!L.checkpoint) { runTime = 0; runStarted = false; L.finished = false; }
  if (!silent) sfx.blip(700);
}

L.onFinish = () => {
  runStarted = false;
  sfx.fanfare();
  const prev = load('time.' + currentMap.id);
  const record = !prev || runTime < prev;
  if (record) store('time.' + currentMap.id, runTime.toFixed(2));
  fx.banner('¡META!', runTime.toFixed(2) + ' s' + (record ? ' · ¡RÉCORD!' : ''));
  const p = ragdoll.chest.position;
  for (let i = 0; i < 4; i++) fx.debris(new THREE.Vector3(p.x, p.y + 1, p.z), [0xff4d3a, 0xffc22e, 0x59e08b, 0x5cc8ff][i], 14, 7, 0.06);
  addPoints(1000, '¡META!', p, 'big');
};

// ------------------------------------------------------------------ menu & toolbar
const menu = document.getElementById('menu');
function buildMenu() {
  const list = document.getElementById('map-list');
  list.innerHTML = '';
  for (const m of MAPS) {
    const b = document.createElement('button');
    b.className = 'map-row';
    const bestScore = load('best.' + m.id);
    const bestTime = load('time.' + m.id);
    b.innerHTML = '<span class="code"></span><span class="what"><span class="nm"></span><span class="spec"></span></span><span class="rec"></span>';
    b.querySelector('.code').textContent = m.code;
    b.querySelector('.nm').textContent = m.name;
    b.querySelector('.spec').textContent = m.desc;
    const rec = b.querySelector('.rec');
    rec.textContent = bestScore ? bestScore.toLocaleString('es') : '—';
    if (bestTime) {
      const t = document.createElement('small');
      t.textContent = bestTime.toFixed(2) + ' s';
      rec.appendChild(t);
    }
    b.addEventListener('click', () => {
      sfx.initAudio();
      sfx.blip(660);
      loadMap(m);
      menu.classList.add('hidden');
      paused = false;
    });
    list.appendChild(b);
  }
}

function toggleMenu() {
  if (!currentMap) return;
  if (menu.classList.contains('hidden')) {
    buildMenu();
    menu.classList.remove('hidden');
    paused = true;
    keys.clear();
    releaseGrab();
  } else {
    menu.classList.add('hidden');
    paused = false;
  }
}

function buildToolbar() {
  const bar = document.getElementById('toolbar');
  TOOLS.forEach((t, i) => {
    const el = document.createElement('div');
    el.className = 'tool' + (i === tool ? ' active' : '');
    el.innerHTML = `<span class="num">${i + 1}</span><span class="ico">${ICONS[t.id]}</span><span class="nm">${t.nm}</span>`;
    el.title = `${t.nm} (${i + 1})`;
    el.addEventListener('pointerdown', (e) => { e.stopPropagation(); selectTool(i); });
    bar.appendChild(el);
  });
}

// ------------------------------------------------------------------ main loop
const clock = new THREE.Clock();
let acc = 0;

function frame() {
  requestAnimationFrame(frame);
  tick(Math.min(clock.getDelta(), 0.05));
}

function tick(dt, render = true) {
  realTime += dt;

  if (hitStop > 0) hitStop -= dt;
  const targetScale = hitStop > 0 ? 0.22 : slowmo ? 0.3 : 1;
  timeScale += (targetScale - timeScale) * Math.min(1, dt * (hitStop > 0 ? 30 : 5));

  if (!paused) {
    acc += dt;
    let steps = 0;
    while (acc >= FIXED_DT && steps < 6) {
      const sdt = FIXED_DT * timeScale;
      const input = readInput();
      pending.jump = pending.dive = pending.punch = pending.limp = false;
      updateGrab(sdt);
      ragdoll.step(sdt, input);
      lv.stepLevel(sdt);
      world.step(sdt);
      acc -= FIXED_DT;
      steps++;
    }
    if (steps === 6) acc = 0;

    lv.checkTriggers();
    handleRagdollEvents();

    // gauntlet timer
    if (currentMap.timed && !L.finished) {
      if (!runStarted && ragdoll.pelvis.position.z > currentMap.spawn.pos[2] + 1.5) runStarted = true;
      if (runStarted) runTime += dt * timeScale;
    }

    // fell into the void
    if (ragdoll.pelvis.position.y < currentMap.killY) {
      if (respawnTimer === 0) {
        addPoints(300, '¡AL VACÍO!', ragdoll.chest.position, 'big');
        respawnTimer = 0.0001;
      }
    }
    if (respawnTimer > 0) {
      respawnTimer += dt;
      if (respawnTimer > 1.2) respawn();
    }
  } else {
    // idle orbit behind the menu
    cam.yaw += dt * 0.08;
  }

  // keep the dummy centred in the free area to the right of the menu panel
  const W = Math.max(1, window.innerWidth), H = Math.max(1, window.innerHeight);
  const menuVisible = !menu.classList.contains('hidden');
  document.body.classList.toggle('menu-open', menuVisible);
  const menuOpen = menuVisible && W > 760;
  if (menuOpen) camera.setViewOffset(W, H, -Math.min(540, W) / 2, 0, W, H);
  else if (camera.view && camera.view.enabled) camera.clearViewOffset();

  syncAll();
  ragdoll.updateVisuals();
  fx.update(dt * Math.max(0.35, timeScale));
  updateCamera(dt);
  updateHUD();
  if (render) renderer.render(scene, camera);
}

// ------------------------------------------------------------------ boot
buildToolbar();
buildMenu();
document.getElementById('help').classList.toggle('collapsed', load('helpCollapsed') === 1);
loadMap(MAPS[0]);
document.getElementById('loading').classList.add('hidden');
updateFlags();
frame();

// debug handle for testing from the console
window.__boneyard = {
  advance(sec, render = false) { for (let i = 0; i < Math.round(sec * 60); i++) tick(1 / 60, render); },
  keys, pending, ragdoll, lv, camera, THREE, world, L, loadMap, MAPS, cam, selectTool, useTool: () => useTool(), mouse };
