import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { world, FIXED_DT, syncAll, GROUP, GRAVITY, MASK_ALL } from './physics.js';
import { Ragdoll, STATE_LABEL } from './ragdoll.js';
import { BONES_BY_SEG } from './skeleton.js';
import * as lv from './level.js';
import { L } from './level.js';
import { MAPS } from './maps.js';
import * as fx from './fx.js';
import * as sfx from './audio.js';
import * as blood from './blood.js';
import * as weapons from './weapons.js';
import { AIController } from './combat.js';
import { createMode } from './modes.js';
import { ICONS } from './icons.js';
import { initVitals, updateVitals } from './hud.js';

// ------------------------------------------------------------------ renderer / scene
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio, 2);
renderer.setPixelRatio(pixelRatio);
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

scene.add(new THREE.HemisphereLight(0xdfefff, 0x6b5a48, 1.1));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -28; sun.shadow.camera.right = 28;
sun.shadow.camera.top = 28; sun.shadow.camera.bottom = -28;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 160;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const sunOffset = new THREE.Vector3(30, 50, 18);

fx.initFx(scene, camera);
lv.initLevel(scene);
blood.initBlood(scene, renderer);
L.onExplode = (p, r) => weapons.blastMines(p, r);

let player = new Ragdoll(scene, { isPlayer: true, team: 0, name: 'Tú' });
L.ragdoll = player;
L.player = player;
const fighters = []; // { rag, ai }

// ------------------------------------------------------------------ state
let currentMap = null;
let mode = null;
let paused = true;
let timeScale = 1;
let slowmo = false;
let moonGravity = false;
let hitStop = 0;
let freeze = 0; // hit-stop: a few frames of total stillness when a blow lands
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
let smgCool = 0;
let lmbDown = false;
let emoteIdx = -1;
const recentBones = [];

const TOOLS = [
  { id: 'grab', nm: 'Agarrar' },
  { id: 'smg', nm: 'Subfusil' },
  { id: 'bazooka', nm: 'Bazuca' },
  { id: 'nuke', nm: 'Nuclear' },
  { id: 'mine', nm: 'Mina' },
  { id: 'bomb', nm: 'Bomba' },
  { id: 'cannon', nm: 'Cañón' },
  { id: 'crate', nm: 'Caja' },
  { id: 'barrel', nm: 'Barril' },
  { id: 'truck', nm: 'Camión' },
];
const EMOTES = [['disco', 'BAILE DISCO'], ['robot', 'ROBOT'], ['pollo', 'BAILE DEL POLLO'], ['saludo', 'SALUDO']];

function store(key, val) { try { localStorage.setItem('boneyard.' + key, String(val)); } catch { /* ignore */ } }
function load(key) { try { return Number(localStorage.getItem('boneyard.' + key)) || 0; } catch { return 0; } }

// ------------------------------------------------------------------ fighters (other ragdolls)
const G = {
  get player() { return player; },
  vehicle: null,
  spawnFighter({ pos, yaw, style = 'dummy', color, team = 1, ai }) {
    const rag = new Ragdoll(scene, { style, color, team, name: 'Rival' });
    rag.reset(pos, yaw);
    const f = { rag, ai: new AIController(rag, ai || {}) };
    fighters.push(f);
    return f;
  },
  removeFighter(f) {
    const i = fighters.indexOf(f);
    if (i >= 0) fighters.splice(i, 1);
    blood.clearWoundsOf(f.rag);
    f.rag.dispose();
  },
  respawnPlayer() { respawn(true); },
  addPoints: (...a) => addPoints(...a),
};

function ensurePlayerStyle(style, color) {
  if (player.style === style && player.color === color) return;
  player.dispose();
  player = new Ragdoll(scene, { isPlayer: true, team: 0, name: 'Tú', style, color });
  L.ragdoll = player;
  L.player = player;
}

// ------------------------------------------------------------------ camera
const cam = { yaw: Math.PI, pitch: 0.32, dist: 6.5, target: new THREE.Vector3(0, 1.2, 0) };
const _camPos = new THREE.Vector3();
const camRay = new CANNON.RaycastResult();
const camFrom = new CANNON.Vec3(), camTo = new CANNON.Vec3();

/*
 * Free camera (P): fly anywhere with WASD, Space up, C down, Shift fast;
 * right-drag looks around. The dummy stands still meanwhile; tools still aim
 * from the camera.
 */
let freeCam = null;
function toggleFreeCam() {
  if (freeCam) { freeCam = null; return; }
  freeCam = { pos: camera.position.clone() };
}

function updateFreeCam(dt) {
  const dir = new THREE.Vector3(
    Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch),
  );
  const fwd = dir.clone().negate();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const v = new THREE.Vector3();
  if (keys.has('KeyW') || keys.has('ArrowUp')) v.add(fwd);
  if (keys.has('KeyS') || keys.has('ArrowDown')) v.sub(fwd);
  if (keys.has('KeyD') || keys.has('ArrowRight')) v.add(right);
  if (keys.has('KeyA') || keys.has('ArrowLeft')) v.sub(right);
  if (keys.has('Space')) v.y += 1;
  if (keys.has('KeyC')) v.y -= 1;
  const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 26 : 8;
  if (v.lengthSq() > 0) freeCam.pos.addScaledVector(v.normalize(), speed * dt);
  camera.position.copy(freeCam.pos);
  camera.lookAt(_camPos.copy(freeCam.pos).add(fwd));
  sun.position.copy(freeCam.pos).add(sunOffset);
  sun.target.position.copy(freeCam.pos);
  sky.position.copy(camera.position);
}

function updateCamera(dt) {
  if (freeCam) { updateFreeCam(dt); return; }
  const c = player.chest.position;
  const desired = new THREE.Vector3(c.x, c.y + 0.25, c.z);
  cam.target.lerp(desired, 1 - Math.exp(-dt * 8));
  const dir = new THREE.Vector3(
    Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch),
  );
  // keep the camera out of walls: one ray from the target back to the camera
  let dist = cam.dist;
  camFrom.set(cam.target.x, cam.target.y, cam.target.z);
  camTo.set(cam.target.x + dir.x * dist, cam.target.y + dir.y * dist, cam.target.z + dir.z * dist);
  camRay.reset();
  if (world.raycastClosest(camFrom, camTo, { collisionFilterMask: GROUP.STATIC, skipBackfaces: true }, camRay)) {
    dist = Math.max(1.2, camRay.distance - 0.3);
  }
  cam.curDist = cam.curDist === undefined ? dist : cam.curDist + (dist - cam.curDist) * Math.min(1, dt * (dist < cam.curDist ? 20 : 4));
  _camPos.copy(dir).multiplyScalar(cam.curDist).add(cam.target);
  camera.position.copy(_camPos).add(fx.getShake());
  camera.lookAt(cam.target);
  sun.position.copy(cam.target).add(sunOffset);
  sun.target.position.copy(cam.target);
  sky.position.copy(camera.position);
}

function camForward() { return { x: -Math.sin(cam.yaw), z: -Math.cos(cam.yaw) }; }

// ------------------------------------------------------------------ input
const keys = new Set();
const pending = { jump: false, dive: false, punch: false, kick: false, limp: false };
const mouse = new THREE.Vector2();
let rmbDown = false;
let lastMouse = { x: 0, y: 0 };

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') { toggleMenu(); return; }
  if (!menu.classList.contains('hidden')) {
    if (e.code === 'ArrowRight' || e.code === 'ArrowDown') { e.preventDefault(); pickMap(menuSel + 1, true); }
    else if (e.code === 'ArrowLeft' || e.code === 'ArrowUp') { e.preventDefault(); pickMap(menuSel - 1, true); }
    else if (e.code === 'Enter') { e.preventDefault(); startMap(menuSel); }
    return;
  }
  if (paused) return;
  if (['Space', 'Backspace', 'Tab'].includes(e.code)) e.preventDefault();
  if (e.repeat && !['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'KeyE'].includes(e.code)) return;
  keys.add(e.code);
  switch (e.code) {
    case 'Space': pending.jump = true; break;
    case 'KeyQ': pending.dive = true; break;
    case 'KeyF': pending.punch = true; break;
    case 'KeyV':
      if (mode && mode.cycleVehicle && G.vehicle && !G.vehicle.ejected) mode.cycleVehicle();
      else pending.kick = true;
      break;
    case 'KeyX': pending.limp = true; break;
    case 'KeyZ': {
      emoteIdx = (emoteIdx + 1) % (EMOTES.length + 1);
      if (emoteIdx === EMOTES.length) { player.emote = null; emoteIdx = -1; } else player.setEmote(EMOTES[emoteIdx][0]);
      break;
    }
    case 'KeyR': loadMap(currentMap); break; // a clean slate: props, wreckage, blood, vehicles
    case 'Backspace': loadMap(currentMap); break;
    case 'KeyP': toggleFreeCam(); sfx.blip(freeCam ? 600 : 420); break;
    case 'KeyT': slowmo = !slowmo; sfx.blip(slowmo ? 440 : 660); break;
    case 'KeyB': blood.setBlood(!blood.isBloodOn()); syncSettings(); sfx.blip(blood.isBloodOn() ? 500 : 400); break;
    case 'KeyG':
      moonGravity = !moonGravity;
      world.gravity.set(0, moonGravity ? -3.2 : -GRAVITY, 0);
      for (const b of world.bodies) b.wakeUp();
      sfx.blip(moonGravity ? 330 : 660);
      break;
    case 'KeyH': {
      const collapsed = document.getElementById('help').classList.toggle('collapsed');
      store('helpCollapsed', collapsed ? 1 : 0);
      break;
    }
    default: {
      const m = /^Digit(\d)$/.exec(e.code);
      if (m) selectTool(m[1] === '0' ? 9 : Number(m[1]) - 1);
    }
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); lmbDown = false; });

const canvas = renderer.domElement;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  sfx.initAudio();
  setMouse(e);
  if (e.button === 2 || e.button === 1) { rmbDown = true; lastMouse = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); return; }
  if (e.button === 0 && !paused) { lmbDown = true; canvas.setPointerCapture(e.pointerId); useTool(); }
});
canvas.addEventListener('pointermove', (e) => {
  setMouse(e);
  if (rmbDown) {
    cam.yaw -= (e.clientX - lastMouse.x) * 0.006;
    cam.pitch = Math.max(freeCam ? -1.5 : -0.35, Math.min(freeCam ? 1.5 : 1.35, cam.pitch + (e.clientY - lastMouse.y) * 0.005));
    lastMouse = { x: e.clientX, y: e.clientY };
  }
});
canvas.addEventListener('pointerup', (e) => {
  if (e.button === 2 || e.button === 1) { rmbDown = false; return; }
  if (e.button === 0) { lmbDown = false; releaseGrab(); }
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (grab) { grab.dist = Math.max(1.5, Math.min(40, grab.dist - e.deltaY * 0.012)); return; }
  cam.dist = Math.max(2.5, Math.min(30, cam.dist * (1 + Math.sign(e.deltaY) * 0.1)));
}, { passive: false });

function setMouse(e) {
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
  const inp = {
    moveX: mx, moveZ: mz,
    run: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    jump: pending.jump, dive: pending.dive, punch: pending.punch, kick: pending.kick, limpToggle: pending.limp,
    crouch: keys.has('KeyC'),
    sweep: keys.has('KeyC'),
    grab: keys.has('KeyE'),
    camYaw: Math.atan2(f.x, f.z),
  };
  if (mode) mode.input(inp, keys);
  if (freeCam) {
    inp.moveX = inp.moveZ = 0;
    inp.jump = inp.dive = inp.crouch = inp.sweep = inp.run = false;
    inp.throttle = 0; inp.steer = 0; inp.handbrake = false;
  }
  return inp;
}

// ------------------------------------------------------------------ picking
const raycaster = new THREE.Raycaster();
const _nm = new THREE.Matrix3();
function pick() {
  raycaster.setFromCamera(mouse, camera);
  const objs = L.meshes.concat(player.parts.map((p) => p.mesh), ...fighters.map((f) => f.rag.parts.map((p) => p.mesh)));
  const hits = raycaster.intersectObjects(objs, true);
  for (const h of hits) {
    let o = h.object;
    if (o.isInstancedMesh) continue;
    const normal = h.face ? h.face.normal.clone().applyMatrix3(_nm.getNormalMatrix(h.object.matrixWorld)).normalize() : new THREE.Vector3(0, 1, 0);
    while (o && !o.userData.body) o = o.parent;
    return { point: h.point, body: o ? o.userData.body : null, distance: h.distance, normal };
  }
  const t = -raycaster.ray.origin.y / raycaster.ray.direction.y;
  if (t > 0 && t < 400) return { point: raycaster.ray.at(t, new THREE.Vector3()), body: null, distance: t, normal: new THREE.Vector3(0, 1, 0) };
  return null;
}

// ------------------------------------------------------------------ tools
let grab = null;
const spawned = [];

function trackSpawn(b) {
  spawned.push(b);
  while (spawned.length > 45) lv.removeBody(spawned.shift());
}

function selectTool(i) {
  tool = i;
  document.querySelectorAll('.tool').forEach((el, j) => el.classList.toggle('active', j === i));
  sfx.blip(520 + i * 30);
}

function muzzlePoint(dir) {
  const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
  return camera.position.clone().addScaledVector(dir, 0.6).addScaledVector(right, 0.28).add(new THREE.Vector3(0, -0.22, 0));
}

function useTool() {
  const T = TOOLS[tool].id;
  const h = pick();
  const dir = raycaster.ray.direction.clone();
  switch (T) {
    case 'grab': {
      if (!h || !h.body || h.body.type !== CANNON.Body.DYNAMIC) return;
      const b = h.body;
      const rag = b.userData && b.userData.ragdoll;
      const local = b.pointToLocalFrame(new CANNON.Vec3(h.point.x, h.point.y, h.point.z), new CANNON.Vec3());
      grab = { body: b, local, dist: h.distance, rag };
      b.wakeUp();
      if (rag) rag.goFall('grab');
      sfx.blip(300);
      break;
    }
    case 'smg': smgCool = 0; break; // fired continuously in the loop
    case 'bazooka': weapons.fireRocket(muzzlePoint(dir), dir); fx.shake(0.15); break;
    case 'nuke':
      if (!h) return;
      if (weapons.dropNuke(h.point)) fx.banner('NUCLEAR', 'DETONACIÓN EN 2 SEGUNDOS');
      break;
    case 'mine':
      if (!h) return;
      weapons.placeMine(h.point, h.normal);
      break;
    case 'bomb':
      if (!h) return;
      lv.explode(h.point.clone().addScaledVector(dir, -0.2), 6, 20);
      break;
    case 'cannon': {
      const p = camera.position.clone().addScaledVector(dir, 1.2);
      const v = dir.clone().multiplyScalar(36);
      v.y += 1.2;
      lv.cannonball(p, v);
      sfx.shot();
      fx.shake(0.25);
      break;
    }
    case 'crate': {
      if (!h) return;
      const s = 0.6 + Math.random() * 0.5;
      trackSpawn(lv.crate([h.point.x, h.point.y + 3.5, h.point.z], s, [Math.random() * 3, Math.random() * 3, 0]));
      sfx.blip(400);
      break;
    }
    case 'barrel':
      if (!h) return;
      trackSpawn(lv.barrel([h.point.x, h.point.y + 3, h.point.z]));
      sfx.blip(360);
      break;
    case 'truck': {
      // fired like the cannon: out of the camera, along the aim, nose first
      const p = camera.position.clone().addScaledVector(dir, 5);
      const gp = groundBelow(p.x, p.y + 1, p.z);
      if (gp !== null && p.y < gp + 1.5) p.y = gp + 1.5;
      trackSpawn(lv.truck(p, dir, 32));
      sfx.shot();
      sfx.whoosh();
      fx.shake(0.45);
      break;
    }
  }
}

const _gb = new CANNON.RaycastResult();
function groundBelow(x, y, z) {
  _gb.reset();
  const ok = world.raycastClosest(new CANNON.Vec3(x, y, z), new CANNON.Vec3(x, y - 60, z), { collisionFilterMask: GROUP.STATIC, skipBackfaces: true }, _gb);
  return ok ? _gb.hitPointWorld.y : null;
}

function releaseGrab() {
  if (!grab) return;
  if (grab.rag) {
    for (const p of grab.rag.parts) {
      const v = p.body.velocity, sp = v.length();
      if (sp > 38) v.scale(38 / sp, v);
    }
  }
  grab = null;
}

const _gp = new CANNON.Vec3();
const _gf = new CANNON.Vec3();
const _gr = new CANNON.Vec3();
/**
 * Mouse grab as a stiff spring on the grabbed point. On a ragdoll most of the
 * pull is spread over the whole body (weighted by mass) so you can yank him
 * hard and slam him into things without stretching his joints apart.
 */
function updateGrab(dt) {
  if (!grab) return;
  const b = grab.body;
  if (!b.world) { grab = null; return; }
  raycaster.setFromCamera(mouse, camera);
  const T = raycaster.ray.at(grab.dist, new THREE.Vector3());
  b.pointToWorldFrame(grab.local, _gp);
  const ex = T.x - _gp.x, ey = T.y - _gp.y, ez = T.z - _gp.z;
  const k = 22; // 1/s: how hard the point chases the cursor
  let vx = ex * k, vy = ey * k, vz = ez * k;
  const sp = Math.hypot(vx, vy, vz), MAX = 42;
  if (sp > MAX) { vx *= MAX / sp; vy *= MAX / sp; vz *= MAX / sp; }
  // a torn-off piece is pulled on its own, not with the body it came from
  if (grab.rag && !(b.userData.part && b.userData.part.detached)) {
    const R = grab.rag;
    R.restT = 0;
    if (R.state !== 'limp' && R.state !== 'fall') R.goFall('grab');
    const com = R.comVelocity(new THREE.Vector3());
    const M = R.liveMass || R.totalMass;
    const gain = 9;
    let fx_ = (vx - com.x) * gain * M, fy = (vy - com.y) * gain * M + M * (moonGravity ? 3.2 : GRAVITY), fz = (vz - com.z) * gain * M;
    const fm = Math.hypot(fx_, fy, fz), FMAX = M * 160;
    if (fm > FMAX) { fx_ *= FMAX / fm; fy *= FMAX / fm; fz *= FMAX / fm; }
    // 35% through the grabbed point, the rest spread by mass
    _gr.set(_gp.x - b.position.x, _gp.y - b.position.y, _gp.z - b.position.z);
    _gf.set(fx_ * 0.35, fy * 0.35, fz * 0.35);
    b.applyForce(_gf, _gr);
    for (const p of R.parts) {
      if (p.detached) continue;
      const s = 0.65 * p.body.mass / M;
      p.body.force.x += fx_ * s; p.body.force.y += fy * s; p.body.force.z += fz * s;
    }
  } else {
    const m = b.mass;
    const gain = 12;
    const v = b.velocity;
    let fx_ = (vx - v.x) * gain * m, fy = (vy - v.y) * gain * m + m * GRAVITY, fz = (vz - v.z) * gain * m;
    const fm = Math.hypot(fx_, fy, fz), FMAX = Math.min(m * 200, 4e5);
    if (fm > FMAX) { fx_ *= FMAX / fm; fy *= FMAX / fm; fz *= FMAX / fm; }
    _gr.set(_gp.x - b.position.x, _gp.y - b.position.y, _gp.z - b.position.z);
    _gf.set(fx_, fy, fz);
    b.applyForce(_gf, _gr);
    b.angularVelocity.scale(1 - Math.min(0.5, dt * 4), b.angularVelocity);
  }
}

// ------------------------------------------------------------------ score & feedback
const elScore = document.getElementById('score');
const elScoreLabel = document.getElementById('score-label');
const elBest = document.getElementById('best');
const elBones = document.getElementById('bones');
const elCombo = document.getElementById('combo');
const elState = document.getElementById('state');
const elTimer = document.getElementById('timer');
const elFlags = document.getElementById('flags');
const elModeStatus = document.getElementById('mode-status');
const elXrLast = document.getElementById('xr-last');

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

/** Which ragdoll's pain counts as score depends on the mode. */
function scores(rag) {
  const k = mode ? mode.kind : 'sandbox';
  if (k === 'dojo' || k === 'sumo') return rag !== player;
  return rag === player;
}
L.onScore = (pts, label, pos, rag) => { if (!rag || scores(rag)) addPoints(pts, label, pos, 'big'); };

const _bd = new THREE.Vector3();
function bleed(e) {
  if (!blood.isBloodOn() || e.kind === 'bullet') return; // bullets open their own wounds
  // Blunt trauma bleeds only when it breaks the skin: a long bone snapping
  // through it, or an impact violent enough to split it open. A knock or a
  // punch leaves a bruise, not blood.
  const compound = e.broken.some((b) => b.kind === 'long' || b.kind === 'femur') && e.v > 16;
  const split = e.v > 18;
  if (!compound && !split) return;
  const part = e.part;
  const c = part.body.position;
  _bd.set(e.point.x - c.x, e.point.y - c.y, e.point.z - c.z).normalize();
  _bd.y += 0.4;
  blood.spray(e.point, _bd, Math.min(14, Math.round((e.v - 14) * 1.2)), 1.5 + e.v * 0.12);
  blood.wound(part, e.point, 0.015 + Math.min(0.03, e.v * 0.0012), 'open');
}

function noteBones(rag, list) {
  if (!list.length || rag !== player) return;
  for (const b of list) recentBones.unshift(b.name);
  recentBones.length = Math.min(recentBones.length, 4);
}

function handleEvents(rag) {
  const isP = rag === player;
  for (const e of rag.events) {
    switch (e.type) {
      case 'hit': {
        if (scores(rag)) {
          const readout = e.v > 6 ? `${e.part.def.label || ''}`.trim() : '';
          const label = e.v > 6 ? `${partLabel(e.part)} ${e.v.toFixed(1).replace('.', ',')} m/s` : readout;
          addPoints(e.pts + e.broken.length * 40, label, e.point, e.part.name === 'head' ? 'head' : '');
        }
        sfx.thud(e.v, true);
        if (e.v > 5.5) sfx.grunt(e.v / 8);
        if (e.v > 7 && e.kind !== 'bullet') fx.dust(e.point, Math.min(1.6, e.v / 10));
        if (e.v > 6) bleed(e);
        if (isP && e.v > 8) { fx.shake(Math.min(1.2, e.v / 22)); fx.flash(Math.min(0.8, (e.v - 6) / 16)); }
        if (isP && e.v > 13 && realTime - lastHitStop > 1.2) { hitStop = 0.35; lastHitStop = realTime; }
        if (e.broken.length) {
          sfx.crack();
          noteBones(rag, e.broken);
          if (isP || scores(rag)) fx.banner('FRACTURA', e.broken[0].name.toUpperCase() + (e.broken.length > 1 ? `  +${e.broken.length - 1}` : ''));
          fx.debris(e.point, 0xf3eee2, 3 + e.broken.length, 2.5, 0.03);
          if (isP) fx.flash(0.9);
        }
        break;
      }
      case 'sever': {
        const j = e.joint;
        // both stumps pump blood: on the body side and on the limb that came off
        for (const [part, piv] of [[j.P, j.constraint.pivotA], [j.C, j.constraint.pivotB]]) {
          const lp = new THREE.Vector3(piv.x, piv.y, piv.z);
          const nrm = lp.lengthSq() > 1e-6 ? lp.clone().normalize() : new THREE.Vector3(0, 1, 0);
          blood.wound(part, null, 0.05, 'severe', lp, nrm);
        }
        blood.spray(e.point, new THREE.Vector3(0, 1, 0), 16, 4, 1.1);
        sfx.crack(); sfx.thud(22, true); sfx.grunt(1.4);
        if (isP || scores(rag)) {
          fx.banner('AMPUTACIÓN', partLabel(j.C));
          addPoints(600, 'AMPUTACIÓN', e.point, 'head');
        }
        break;
      }
      case 'blast':
        noteBones(rag, e.broken);
        sfx.crack();
        if (scores(rag)) addPoints(e.broken.length * 40, `${e.broken.length} FRACTURAS`, e.point, 'head');
        break;
      case 'ko':
        if (isP) fx.banner('K.O.', 'INCONSCIENTE');
        else fx.popup(e.point, 'K.O.', 'head', 34);
        if (scores(rag)) addPoints(500, 'K.O.', e.point, 'big');
        // winners dance
        if (isP) for (const f of fighters) if (f.rag.state === 'stand' && Math.random() < 0.7) f.rag.setEmote(Math.random() < 0.5 ? 'disco' : 'robot');
        break;
      case 'death':
        if (isP) fx.banner('MUERTO', 'R PARA REINICIAR');
        else fx.popup(e.point, 'MUERTO', 'head', 34);
        if (scores(rag)) addPoints(1000, 'LETAL', e.point, 'big');
        if (isP) for (const f of fighters) if (f.rag.state === 'stand' && Math.random() < 0.7) f.rag.setEmote(Math.random() < 0.5 ? 'disco' : 'robot');
        break;
      case 'landfeet':
        fx.popup(e.point, 'CAE DE PIE', '', 22);
        break;
      case 'reversal':
        sfx.whoosh(); sfx.grunt(1.2);
        if (isP) { fx.banner('CONTRAATAQUE'); addPoints(250, 'CONTRAATAQUE', e.point, 'big'); }
        else if (e.victim === player) fx.banner('TE CONTRAATACAN');
        break;
      case 'strike': {
        const mine = rag === player || e.victim === player;
        sfx.punch(e.v, e.blocked);
        fx.sparks(e.point, e.blocked ? 4 : 7, e.blocked ? 0xd9d6cf : 0xfff2d0, e.blocked ? 2 : 3.5);
        if (mine) {
          freeze = Math.max(freeze, e.blocked ? 0.035 : e.heavy ? 0.09 : 0.055);
          fx.shake(e.heavy ? 0.45 : 0.22);
        }
        break;
      }
      case 'block':
        if (isP) fx.popup(e.point, 'BLOQUEO', '', 18);
        break;
      case 'swing': sfx.whoosh(); break;
      case 'eject': {
        const kmh = Math.round(e.speed * 3.6);
        fx.banner('EYECCIÓN', `${kmh} km/h`);
        if (isP) addPoints(kmh * 8, 'EYECCIÓN', e.point, 'big');
        break;
      }
      case 'step': if (isP || Math.random() < 0.3) sfx.knock(e.v * 0.4, 0.35); break;
      case 'footfall': if (isP) sfx.knock(2.2, 0.32); blood.footstep(rag, e.side); break;
      case 'jump': if (isP) sfx.whoosh(); break;
      case 'grip': sfx.blip(250); break;
    }
  }
  rag.events.length = 0;
}

function partLabel(part) {
  const n = part.name;
  const map = {
    head: 'CRÁNEO', chest: 'TÓRAX', abdomen: 'ABDOMEN', pelvis: 'PELVIS',
    upperArmL: 'HÚMERO', upperArmR: 'HÚMERO', lowerArmL: 'ANTEBRAZO', lowerArmR: 'ANTEBRAZO',
    handL: 'MANO', handR: 'MANO', thighL: 'FÉMUR', thighR: 'FÉMUR', shinL: 'TIBIA', shinR: 'TIBIA', footL: 'PIE', footR: 'PIE',
  };
  return map[n] || n.toUpperCase();
}

// ------------------------------------------------------------------ x-ray HUD
const XR = {
  head: ['circle', 30, 9, 7], chest: ['rect', 21, 17, 18, 13], abdomen: ['rect', 22.5, 31, 15, 7], pelvis: ['rect', 21.5, 39, 17, 7],
  upperArmR: ['rect', 14, 18, 5.5, 15], upperArmL: ['rect', 40.5, 18, 5.5, 15],
  lowerArmR: ['rect', 14.2, 34, 5, 13], lowerArmL: ['rect', 40.8, 34, 5, 13],
  handR: ['rect', 14.5, 48, 4.5, 6], handL: ['rect', 41, 48, 4.5, 6],
  thighR: ['rect', 22.5, 47, 6.5, 20], thighL: ['rect', 31, 47, 6.5, 20],
  shinR: ['rect', 23, 68, 5.5, 20], shinL: ['rect', 31.5, 68, 5.5, 20],
  footR: ['rect', 20.5, 89, 8, 4], footL: ['rect', 31.5, 89, 8, 4],
};
const xrEls = {};
(function buildXray() {
  const svg = document.getElementById('xray-fig');
  const NS = 'http://www.w3.org/2000/svg';
  for (const [seg, d] of Object.entries(XR)) {
    const el = document.createElementNS(NS, d[0]);
    if (d[0] === 'circle') { el.setAttribute('cx', d[1]); el.setAttribute('cy', d[2]); el.setAttribute('r', d[3]); }
    else { el.setAttribute('x', d[1]); el.setAttribute('y', d[2]); el.setAttribute('width', d[3]); el.setAttribute('height', d[4]); el.setAttribute('rx', 1.2); }
    const t = document.createElementNS(NS, 'title');
    t.textContent = `${seg}: ${BONES_BY_SEG[seg].length} huesos`;
    el.appendChild(t);
    svg.appendChild(el);
    xrEls[seg] = el;
  }
})();
const _xc = new THREE.Color();
const XR_OK = new THREE.Color(0x4a4a4a), XR_MID = new THREE.Color(0xf2c14e), XR_BAD = new THREE.Color(0xe5432f);
let lastXrKey = '';
function updateXray() {
  const sk = player.skeleton;
  const key = sk.count + ':' + recentBones.join('|');
  if (key === lastXrKey) return;
  lastXrKey = key;
  for (const seg in xrEls) {
    const r = sk.ratio(seg);
    const failed = sk.segmentFailed(seg);
    if (failed) _xc.copy(XR_BAD);
    else if (r > 0) _xc.copy(XR_MID).lerp(XR_BAD, Math.min(1, r * 2));
    else _xc.copy(XR_OK);
    xrEls[seg].setAttribute('fill', '#' + _xc.getHexString());
  }
  elBones.textContent = sk.count;
  elXrLast.innerHTML = '';
  for (const n of recentBones.slice(0, 3)) {
    const li = document.createElement('li');
    li.textContent = n;
    elXrLast.appendChild(li);
  }
}

let lastHudT = 0;
function updateHUD() {
  elScore.textContent = score.toLocaleString('es');
  elBest.textContent = best.toLocaleString('es');
  const k = mode ? mode.kind : 'sandbox';
  elScoreLabel.textContent = k === 'dojo' || k === 'sumo' ? 'FACTURA · DAÑOS A TERCEROS' : 'FACTURA · URGENCIAS';
  // the bedside monitor follows the dummy
  const hdt = Math.min(0.1, Math.max(0, realTime - lastHudT));
  lastHudT = realTime;
  const pv = player.pelvis.velocity;
  const st = player.state;
  const stress = Math.min(1, player.stumble * 0.7 + Math.hypot(pv.x, pv.z) / 9 + (st === 'fall' ? 0.45 : 0) + (player.act ? 0.25 : 0) + (100 - Math.max(0, player.hp)) / 250);
  const out = !player.dead && (player.koT > 0 || player.hp <= 0);
  const alarmed = player.dead || out || (player.bloodLeft ?? 1) < 0.55;
  updateVitals(hdt, { alive: !player.dead, out, stress, blood: Math.max(0, player.bloodLeft ?? 1), consc: player.dead ? 0 : Math.min(100, player.hp), sound: alarmed && !paused }, realTime);
  const mult = 1 + Math.min(20, combo) * 0.1;
  const comboLive = realTime - lastHitTime < 1.3 && combo > 0;
  elCombo.classList.toggle('hidden', !comboLive);
  if (comboLive) elCombo.textContent = '×' + mult.toFixed(1).replace('.', ',');
  const ds = player.displayState;
  const cls = { stand: 'stand', air: 'stand', stumble: 'stumble', fall: 'fall', down: 'fall', ko: 'ko', dead: 'ko', crawl: 'fall', wrecked: 'ko', getup: 'getup', limp: 'limp', seated: 'stand', crouch: 'stand', attack: 'stumble', emote: 'getup', block: 'stand' }[ds] || 'fall';
  elState.className = 'state ' + cls;
  elState.textContent = ds === 'emote' && emoteIdx >= 0 ? EMOTES[emoteIdx][1] : (STATE_LABEL[ds] || ds);
  if (currentMap?.timed) {
    elTimer.classList.remove('hidden');
    elTimer.textContent = runTime.toFixed(2) + ' s';
  } else elTimer.classList.add('hidden');
  elModeStatus.textContent = mode ? mode.status() : '';
  const f = [];
  if (slowmo) f.push('CÁMARA LENTA ×0,3');
  if (moonGravity) f.push('GRAVEDAD 3,2 m/s²');
  if (blood.isBloodOn()) f.push('SANGRE');
  if (weapons.nukePending()) f.push('NUCLEAR ARMADA');
  if (lowQuality) f.push('CALIDAD REDUCIDA');
  elFlags.textContent = f.join(' · ');
  updateXray();
}

// ------------------------------------------------------------------ maps
function applyEnv(env) {
  skyUniforms.top.value.set(env.skyTop);
  skyUniforms.bottom.value.set(env.skyBottom);
  scene.fog = new THREE.Fog(env.fog, env.fogNear, env.fogFar);
  sunOffset.set(...env.sun);
}

function placeMapMines(map) {
  if (!map.mines) return;
  const up = new THREE.Vector3(0, 1, 0);
  if (map.mines === 'field') {
    let n = 0, guard = 0;
    while (n < 70 && guard++ < 500) {
      const x = (Math.random() - 0.5) * 21, z = -27 + Math.random() * 57;
      if (Math.hypot(x - map.spawn.pos[0], z - map.spawn.pos[2]) < 3) continue;
      const m = weapons.placeMine(new THREE.Vector3(x, 0, z), up);
      m.arm = 0;
      n++;
    }
  } else {
    for (const [x, z] of map.mines) weapons.placeMine(new THREE.Vector3(x, 0, z), up).arm = 0;
  }
}

function loadMap(map) {
  releaseGrab();
  freeCam = null;
  if (mode) { mode.dispose(); mode = null; }
  for (const f of fighters.slice()) G.removeFighter(f);
  spawned.length = 0;
  weapons.clearWeapons();
  lv.clearLevel();
  fx.clearFx();
  blood.clearBlood();
  sfx.setBeat(false);
  recentBones.length = 0;
  L.checkpoint = null;
  L.finished = false;
  currentMap = map;
  const m = map.mode || {};
  ensurePlayerStyle(m.style || 'dummy', m.playerColor || 0xf2c14e);
  applyEnv(map.env);
  map.build();
  placeMapMines(map);
  best = load('best.' + map.id);
  document.getElementById('map-name').textContent = map.code + ' · ' + map.name.toUpperCase();
  respawn(true);
  for (let i = 0; i < 30; i++) world.step(FIXED_DT);
  for (const b of world.bodies) if (!(b.userData && b.userData.ragdoll) && b.type === CANNON.Body.DYNAMIC) b.velocity.setZero();
  respawn(true);
  mode = createMode(map, G);
}

function spawnPos() {
  const s = L.checkpoint || currentMap.spawn.pos;
  return new THREE.Vector3(...s);
}

function respawn(silent = false) {
  releaseGrab();
  const yaw = currentMap.spawn.yaw;
  player.reset(spawnPos(), yaw);
  blood.clearBlood(); // a fresh run starts clean (and keeps the decal pools small)
  player.out = false;
  cam.yaw = yaw + Math.PI;
  cam.target.copy(spawnPos()).add(new THREE.Vector3(0, 1.5, 0));
  score = 0;
  combo = 0;
  respawnTimer = 0;
  recentBones.length = 0;
  emoteIdx = -1;
  if (!L.checkpoint) { runTime = 0; runStarted = false; L.finished = false; }
  if (mode && !silent) mode.onRespawn();
  else if (mode && mode.kind === 'crash') mode.onRespawn();
  if (!silent) sfx.blip(700);
}

L.onFinish = () => {
  runStarted = false;
  sfx.fanfare();
  const prev = load('time.' + currentMap.id);
  const record = !prev || runTime < prev;
  if (record) store('time.' + currentMap.id, runTime.toFixed(2));
  fx.banner('META', runTime.toFixed(2) + ' s' + (record ? ' · RÉCORD' : ''));
  const p = player.chest.position;
  for (let i = 0; i < 4; i++) fx.debris(new THREE.Vector3(p.x, p.y + 1, p.z), [0xe5432f, 0xf2c14e, 0xe8e4da, 0x3a3d42][i], 14, 7, 0.06);
  addPoints(1000, 'META', p, 'big');
  player.setEmote('disco');
};

// ------------------------------------------------------------------ menu, settings & toolbar
const menu = document.getElementById('menu');
let menuSel = 0;
function buildMenu() {
  const list = document.getElementById('map-list');
  list.innerHTML = '';
  MAPS.forEach((m, i) => {
    const b = document.createElement('button');
    b.className = 'card';
    b.type = 'button';
    b.setAttribute('role', 'option');
    b.innerHTML = '<img alt="" /><span class="c-code"></span><span class="c-name"></span>';
    b.querySelector('img').src = 'assets/maps/' + m.id + '.jpg';
    b.querySelector('img').draggable = false;
    b.querySelector('.c-code').textContent = m.code;
    b.querySelector('.c-name').textContent = m.name;
    b.addEventListener('mouseenter', () => pickMap(i));
    b.addEventListener('focus', () => pickMap(i));
    b.addEventListener('click', () => startMap(i));
    list.appendChild(b);
  });
  const cur = currentMap ? MAPS.indexOf(currentMap) : 0;
  pickMap(cur < 0 ? 0 : cur, true);
}

function pickMap(i, scroll = false) {
  menuSel = (i + MAPS.length) % MAPS.length;
  const m = MAPS[menuSel];
  document.querySelectorAll('#map-list .card').forEach((el, j) => {
    el.classList.toggle('sel', j === menuSel);
    el.setAttribute('aria-selected', String(j === menuSel));
    if (j === menuSel && scroll) el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  });
  document.getElementById('md-code').textContent = m.code;
  document.getElementById('md-name').textContent = m.name;
  document.getElementById('md-desc').textContent = m.desc;
  const bestScore = load('best.' + m.id), bestTime = load('time.' + m.id);
  document.getElementById('md-rec').textContent = bestScore ? 'L ' + bestScore.toLocaleString('es') : '—';
  document.getElementById('md-time').textContent = bestTime ? 'MEJOR TIEMPO ' + bestTime.toFixed(2) + ' s' : '';
  const detail = document.getElementById('map-detail');
  detail.classList.remove('swap'); void detail.offsetWidth; detail.classList.add('swap');
}

function startMap(i) {
  sfx.initAudio();
  sfx.blip(660);
  loadMap(MAPS[(i + MAPS.length) % MAPS.length]);
  menu.classList.add('hidden');
  paused = false;
}
document.getElementById('md-go').addEventListener('click', () => startMap(menuSel));

// the card row scrolls by dragging it with the mouse (or a finger) and with the wheel
{
  const row = document.getElementById('map-list');
  let drag = null;
  row.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, left: row.scrollLeft, moved: false, id: e.pointerId };
  });
  row.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) > 6) { drag.moved = true; row.setPointerCapture(drag.id); row.classList.add('dragging'); }
    if (drag.moved) row.scrollLeft = drag.left - dx;
  });
  const end = () => {
    if (!drag) return;
    // a drag is not a click: swallow the click that follows it
    if (drag.moved) {
      const eat = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      row.addEventListener('click', eat, { capture: true, once: true });
      setTimeout(() => row.removeEventListener('click', eat, { capture: true }), 0);
    }
    drag = null;
    row.classList.remove('dragging');
  };
  row.addEventListener('pointerup', end);
  row.addEventListener('pointercancel', end);
  row.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { row.scrollLeft += e.deltaY; e.preventDefault(); }
  }, { passive: false });
}

const optBlood = document.getElementById('opt-blood');
const optQuality = document.getElementById('opt-quality');
let qualityMode = load('quality') || 0; // 0 auto, 1 high, 2 low
function syncSettings() {
  const on = blood.isBloodOn();
  optBlood.setAttribute('aria-pressed', String(on));
  optBlood.querySelector('.opt-val').textContent = on ? 'SÍ' : 'NO';
  optQuality.querySelector('.opt-val').textContent = ['AUTO', 'ALTA', 'BAJA'][qualityMode];
}
optBlood.addEventListener('click', () => { blood.setBlood(!blood.isBloodOn()); syncSettings(); sfx.initAudio(); sfx.blip(500); });
optQuality.addEventListener('click', () => {
  qualityMode = (qualityMode + 1) % 3;
  store('quality', qualityMode);
  applyQuality(qualityMode === 2);
  syncSettings();
});

function toggleMenu() {
  if (!currentMap) return;
  if (menu.classList.contains('hidden')) {
    buildMenu();
    syncSettings();
    menu.classList.remove('hidden');
    paused = true;
    keys.clear();
    lmbDown = false;
    releaseGrab();
    sfx.setBeat(false);
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
    el.innerHTML = `<span class="num">${(i + 1) % 10}</span><span class="ico">${ICONS[t.id]}</span><span class="nm">${t.nm}</span>`;
    el.title = `${t.nm} (${(i + 1) % 10})`;
    el.addEventListener('pointerdown', (e) => { e.stopPropagation(); selectTool(i); });
    bar.appendChild(el);
  });
}

// ------------------------------------------------------------------ performance guard
let lowQuality = false;
let slowFrames = 0;
function applyQuality(low) {
  if (low === lowQuality) return;
  lowQuality = low;
  pixelRatio = low ? 1 : Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  sun.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
}
function perfGuard(dt) {
  if (qualityMode !== 0) return;
  slowFrames = dt > 0.028 ? slowFrames + 1 : Math.max(0, slowFrames - 0.5);
  if (!lowQuality && slowFrames > 90) applyQuality(true);
}

const NO_INPUT = { moveX: 0, moveZ: 0 };

// ------------------------------------------------------------------ main loop
const clock = new THREE.Clock();
let acc = 0;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!window.__boneyardHold) tick(dt);
}

function tick(dt, render = true) {
  realTime += dt;
  fx.resetFrame();
  perfGuard(dt);

  if (hitStop > 0) hitStop -= dt;
  const targetScale = hitStop > 0 ? 0.22 : slowmo ? 0.3 : 1;
  timeScale += (targetScale - timeScale) * Math.min(1, dt * (hitStop > 0 ? 30 : 5));

  if (freeze > 0) { freeze -= dt; acc = 0; }
  if (!paused && freeze <= 0) {
    acc += dt;
    let steps = 0;
    // lots awake (big explosions): fewer solver iterations keeps the frame rate up
    const awake = world.bodies.reduce((n, b) => n + (b.type === 1 && b.sleepState !== 2 ? 1 : 0), 0);
    world.solver.iterations = awake > 140 ? 8 : awake > 90 ? 10 : 14;
    const maxSteps = awake > 140 ? 3 : 5;
    while (acc >= FIXED_DT && steps < maxSteps) {
      const sdt = FIXED_DT * timeScale;
      const input = readInput();
      pending.jump = pending.dive = pending.punch = pending.kick = pending.limp = false;
      updateGrab(sdt);
      if (mode && mode.step) mode.step(sdt, input);
      const frozen = mode && mode.frozen && mode.frozen();
      if (frozen) { input.moveX = input.moveZ = 0; input.punch = input.kick = input.dive = input.jump = false; }
      player.step(sdt, input);
      for (const f of fighters) f.rag.step(sdt, frozen ? NO_INPUT : f.ai.input(sdt));
      weapons.stepWeapons(sdt);
      lv.stepLevel(sdt);
      world.step(sdt);
      acc -= FIXED_DT;
      steps++;
    }
    if (steps === maxSteps) acc = 0;

    // SMG: hold to fire
    if (lmbDown && TOOLS[tool].id === 'smg') {
      smgCool -= dt * timeScale;
      while (smgCool <= 0) {
        smgCool += 1 / 13;
        raycaster.setFromCamera(mouse, camera);
        const dir = raycaster.ray.direction.clone();
        weapons.fireSMG(camera.position.clone(), dir, muzzlePoint(dir));
        fx.shake(0.06);
      }
    }

    lv.checkTriggers();
    handleEvents(player);
    for (const f of fighters) handleEvents(f.rag);
    if (mode) mode.update(dt);

    if (currentMap.timed && !L.finished) {
      if (!runStarted && player.pelvis.position.distanceTo(new CANNON.Vec3(...currentMap.spawn.pos)) > 1.5) runStarted = true;
      if (runStarted) runTime += dt * timeScale;
    }

    if (player.pelvis.position.y < currentMap.killY) {
      if (respawnTimer === 0) {
        if (mode?.kind !== 'sumo') addPoints(300, 'CAÍDA AL VACÍO', player.chest.position, 'big');
        respawnTimer = 0.0001;
      }
    }
    if (respawnTimer > 0 && mode?.kind !== 'sumo') {
      respawnTimer += dt;
      if (respawnTimer > 1.2) respawn();
    }
    // fighters that fell far out of the world just stop simulating
    for (const f of fighters) if (f.rag.pelvis.position.y < currentMap.killY - 20) f.rag.out = true;

    sfx.setBeat(!!player.emote);
  } else {
    cam.yaw += dt * 0.08;
  }

  const menuVisible = !menu.classList.contains('hidden');
  document.body.classList.toggle('menu-open', menuVisible);
  if (camera.view && camera.view.enabled) camera.clearViewOffset();

  syncAll();
  player.updateVisuals();
  for (const f of fighters) f.rag.updateVisuals();
  const fdt = dt * Math.max(0.35, timeScale);
  fx.update(fdt);
  blood.update(fdt, Ragdoll.all);
  weapons.updateWeaponVisuals(dt);
  updateCamera(dt);
  updateHUD();
  if (render) renderer.render(scene, camera);
}

// ------------------------------------------------------------------ boot
buildToolbar();
buildMenu();
syncSettings();
if (qualityMode === 2) applyQuality(true);
document.getElementById('help').classList.toggle('collapsed', load('helpCollapsed') === 1);
loadMap(MAPS[0]);
document.getElementById('loading').classList.add('hidden');
initVitals();
frame();

// debug handle for testing from the console
window.__boneyard = {
  advance(sec, render = false) { for (let i = 0; i < Math.round(sec * 60); i++) tick(1 / 60, render); },
  keys, pending, get ragdoll() { return player; }, get player() { return player; }, fighters, lv, weapons, blood, camera, THREE, world, L,
  loadMap, MAPS, cam, selectTool, useTool: () => useTool(), mouse, get mode() { return mode; }, setLmb(v) { lmbDown = v; },
  /** render from another camera angle without stepping anything */
  view(yaw, pitch = cam.pitch, dist = cam.dist) {
    const s = { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist, cd: cam.curDist };
    Object.assign(cam, { yaw, pitch, dist, curDist: dist });
    cam.target.copy(player.chest.position).add(new THREE.Vector3(0, -0.3, 0));
    updateCamera(0); syncAll(); renderer.render(scene, camera);
    Object.assign(cam, { yaw: s.yaw, pitch: s.pitch, dist: s.dist, curDist: s.cd });
  },
};
