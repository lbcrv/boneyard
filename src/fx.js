import * as THREE from 'three';

/*
 * Particle effects built for many simultaneous explosions:
 * - every particle kind is ONE InstancedMesh with a fixed pool (one draw call each)
 * - a fixed pool of point lights lives in the scene from the start, so an
 *   explosion never changes the light count (which would recompile every shader)
 * - a per-frame budget scales particle counts down when lots happen at once
 */

let scene, camera;
let shakeAmt = 0;
const shakeOffset = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

class Pool {
  constructor(geo, mat, max) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.items = [];
    for (let i = 0; i < max; i++) {
      this.items.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Vector3(), spin: 0, size: 0, life: 0, maxLife: 1, grav: 0, drag: 0, grow: 0, color: new THREE.Color(), fade: 0, stretch: 0 });
    }
    this.cursor = 0;
    this.live = 0;
  }

  spawn() {
    // ring buffer: oldest particle is recycled when full
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;
    if (!it.alive) this.live++;
    it.alive = true;
    return it;
  }

  clear() { for (const it of this.items) it.alive = false; this.live = 0; this.mesh.count = 0; }

  update(dt) {
    let n = 0;
    for (const it of this.items) {
      if (!it.alive) continue;
      it.life -= dt;
      if (it.life <= 0) { it.alive = false; this.live--; continue; }
      it.vel.y -= it.grav * dt;
      if (it.drag) it.vel.multiplyScalar(Math.max(0, 1 - it.drag * dt));
      it.pos.addScaledVector(it.vel, dt);
      if (it.floor !== undefined && it.pos.y < it.floor) { it.pos.y = it.floor; it.vel.y *= -0.3; it.vel.x *= 0.6; it.vel.z *= 0.6; }
      it.rot.x += it.spin * dt; it.rot.y += it.spin * 0.7 * dt;
      const k = it.life / it.maxLife;
      let sc = it.size;
      if (it.grow) sc *= 1 + (1 - k) * it.grow;
      else if (k < 0.3) sc *= k / 0.3;
      if (it.stretch) {
        // velocity-aligned streak
        _v.copy(it.vel).normalize();
        _q.setFromUnitVectors(UP, _v);
        _s.set(sc, it.stretch, sc);
      } else {
        _q.setFromEuler(_e.set(it.rot.x, it.rot.y, it.rot.z));
        _s.set(sc, sc, sc);
      }
      _m.compose(it.pos, _q, _s);
      this.mesh.setMatrixAt(n, _m);
      if (it.fade) _c.copy(it.color).multiplyScalar(Math.pow(k, it.fade));
      else _c.copy(it.color);
      this.mesh.setColorAt(n, _c);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}

let chunks, smoke, glow, fire, streaks;
const lights = [];
let ring, ringT = -1, ringR = 0;
let budget = 1;
let recentBlasts = 0;

export function initFx(s, c) {
  scene = s; camera = c;
  const box = new THREE.BoxGeometry(1, 1, 1);
  const ball = new THREE.IcosahedronGeometry(1, 1);
  chunks = new Pool(box, new THREE.MeshStandardMaterial({ roughness: 0.85 }), 700);
  chunks.mesh.castShadow = true;
  smoke = new Pool(ball, new THREE.MeshStandardMaterial({ roughness: 1, transparent: true, opacity: 0.55, depthWrite: false }), 700);
  glow = new Pool(ball, new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }), 900);
  fire = new Pool(ball, new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }), 80);
  streaks = new Pool(new THREE.CylinderGeometry(0.5, 0.5, 1, 5, 1, true), new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }), 200);
  for (const p of [chunks, smoke, glow, fire, streaks]) scene.add(p.mesh);
  for (let i = 0; i < 4; i++) {
    const l = new THREE.PointLight(0xffa040, 0, 40, 1.6);
    l.userData = { t: 1, dur: 1, i0: 0 };
    scene.add(l);
    lights.push(l);
  }
  ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 96), new THREE.MeshBasicMaterial({ color: 0xfff0d0, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);
}

export function clearFx() {
  for (const p of [chunks, smoke, glow, fire, streaks]) p.clear();
  for (const l of lights) { l.intensity = 0; l.userData.t = 1; }
  ring.visible = false; ringT = -1;
}

function n(count) { return Math.max(1, Math.round(count * budget)); }

function rnd(sc = 1) { return (Math.random() - 0.5) * sc; }

export function debris(pos, color = 0xcccccc, count = 8, speed = 4, size = 0.06) {
  for (let i = 0, k = n(count); i < k; i++) {
    const it = chunks.spawn();
    it.pos.copy(pos);
    it.vel.set(rnd(), Math.random() * 0.9 + 0.3, rnd()).normalize().multiplyScalar(speed * (0.4 + Math.random()));
    it.rot.set(Math.random() * 6, Math.random() * 6, 0);
    it.spin = rnd(14);
    it.size = size * (0.6 + Math.random() * 0.8);
    it.life = it.maxLife = 0.8 + Math.random() * 0.8;
    it.grav = 12.5; it.drag = 0.3; it.grow = 0; it.fade = 0; it.stretch = 0;
    it.color.set(color);
    it.floor = pos.y - 3;
  }
}

export function dust(pos, scale = 1) {
  for (let i = 0, k = n(4 + scale * 6); i < k; i++) {
    const it = smoke.spawn();
    it.vel.set(rnd(), Math.random() * 0.4, rnd()).normalize().multiplyScalar(1.2 * scale * (0.5 + Math.random()));
    it.pos.copy(pos).addScaledVector(it.vel, 0.1);
    it.size = 0.12 * scale; it.grow = 1.8; it.drag = 2.5; it.grav = -0.6; it.fade = 0; it.stretch = 0; it.spin = 0;
    it.life = it.maxLife = 0.7 + Math.random() * 0.4;
    it.color.set(0xd2ccbe);
    it.floor = undefined;
  }
}

export function sparks(pos, count = 10, color = 0xffb030, speed = 9) {
  for (let i = 0, k = n(count); i < k; i++) {
    const it = glow.spawn();
    it.pos.copy(pos);
    it.vel.set(rnd(), Math.random(), rnd()).normalize().multiplyScalar(speed * (0.6 + Math.random() * 0.8));
    it.size = 0.025; it.stretch = 0.25; it.grav = 12; it.drag = 0.5; it.grow = 0; it.fade = 1.2;
    it.life = it.maxLife = 0.25 + Math.random() * 0.3;
    it.color.set(color);
    it.floor = undefined;
  }
}

function useLight(pos, intensity, range, color = 0xffa040, dur = 0.6) {
  // reuse the light closest to finishing; never add or remove lights
  let best = lights[0];
  for (const l of lights) if (l.userData.t / l.userData.dur > best.userData.t / best.userData.dur) best = l;
  best.position.copy(pos).add(_p.set(0, 0.8, 0));
  best.color.set(color);
  best.distance = range;
  best.userData = { t: 0, dur, i0: intensity };
  best.intensity = intensity;
}

export function explosion(pos, radius = 5) {
  recentBlasts += 1;
  const r = radius;
  // fireball: a few additive spheres
  for (let i = 0; i < 3; i++) {
    const it = fire.spawn();
    it.pos.copy(pos).add(_p.set(rnd(r * 0.2), rnd(r * 0.15) + 0.2, rnd(r * 0.2)));
    it.vel.set(0, 1.2, 0);
    it.size = r * 0.18; it.grow = 2.2; it.grav = 0; it.drag = 1; it.fade = 1.5; it.stretch = 0; it.spin = 0;
    it.life = it.maxLife = 0.35 + i * 0.08;
    it.color.setRGB(1.0, 0.62 - i * 0.12, 0.25);
    it.floor = undefined;
  }
  useLight(pos, 70, r * 6);
  for (let i = 0, k = n(26); i < k; i++) {
    const it = glow.spawn();
    it.pos.copy(pos);
    it.vel.set(rnd(), Math.random() * 0.8 + 0.2, rnd()).normalize().multiplyScalar(5 + Math.random() * 11);
    it.size = 0.05 + Math.random() * 0.05; it.stretch = 0.3; it.grav = 7; it.drag = 0.6; it.grow = 0; it.fade = 1;
    it.life = it.maxLife = 0.4 + Math.random() * 0.5;
    it.color.set(Math.random() < 0.5 ? 0xff7a1a : 0xffc640);
    it.floor = undefined;
  }
  for (let i = 0, k = n(14); i < k; i++) {
    const it = smoke.spawn();
    it.pos.copy(pos);
    it.vel.set(rnd(), Math.random() * 0.6 + 0.3, rnd()).normalize().multiplyScalar(1.5 + Math.random() * 3);
    it.size = 0.35 + Math.random() * 0.3; it.grow = 2.4; it.drag = 1.8; it.grav = -1.2; it.fade = 0; it.stretch = 0; it.spin = 0;
    it.life = it.maxLife = 1.3 + Math.random() * 0.9;
    it.color.setRGB(0.22, 0.2, 0.19);
    it.floor = undefined;
  }
  debris(pos, 0x3a3532, 8, 7, 0.07);
  shake(Math.min(1.4, r * 0.22));
}

/** Nuclear detonation visuals: flash, rising fireball, mushroom cloud, ground ring. */
export function nuke(pos, radius) {
  whiteFlash(1);
  useLight(pos, 4000, radius * 8, 0xfff0d0, 3.5);
  for (let i = 0; i < 8; i++) {
    const it = fire.spawn();
    it.pos.copy(pos).add(_p.set(rnd(6), 2 + i * 1.5, rnd(6)));
    it.vel.set(rnd(2), 9 + i, rnd(2));
    it.size = 4 + Math.random() * 3; it.grow = 3; it.grav = 0; it.drag = 0.5; it.fade = 1.2; it.stretch = 0; it.spin = 0;
    it.life = it.maxLife = 2.5 + Math.random();
    it.color.setRGB(1, 0.75 - Math.random() * 0.3, 0.35);
    it.floor = undefined;
  }
  // stem and cap
  for (let i = 0; i < 160; i++) {
    const it = smoke.spawn();
    const cap = i > 60;
    const a = Math.random() * Math.PI * 2, rr = cap ? 6 + Math.random() * 14 : Math.random() * 4;
    it.pos.set(pos.x + Math.cos(a) * rr * 0.3, pos.y + (cap ? 20 : Math.random() * 10), pos.z + Math.sin(a) * rr * 0.3);
    it.vel.set(Math.cos(a) * (cap ? rr * 0.35 : 0.5), cap ? 7 + Math.random() * 4 : 9 + Math.random() * 6, Math.sin(a) * (cap ? rr * 0.35 : 0.5));
    it.size = cap ? 3 + Math.random() * 3 : 2 + Math.random() * 1.5;
    it.grow = 1.6; it.drag = 0.35; it.grav = -0.4; it.fade = 0; it.stretch = 0; it.spin = 0;
    it.life = it.maxLife = 7 + Math.random() * 4;
    const warm = Math.random();
    it.color.setRGB(0.42 + warm * 0.25, 0.36 + warm * 0.12, 0.32);
    it.floor = undefined;
  }
  // ground skirt
  for (let i = 0; i < 90; i++) {
    const it = smoke.spawn();
    const a = Math.random() * Math.PI * 2;
    it.pos.set(pos.x + Math.cos(a) * 3, pos.y + 0.5, pos.z + Math.sin(a) * 3);
    it.vel.set(Math.cos(a) * (25 + Math.random() * 20), 1 + Math.random() * 2, Math.sin(a) * (25 + Math.random() * 20));
    it.size = 2 + Math.random() * 2; it.grow = 2; it.drag = 0.9; it.grav = 0; it.fade = 0; it.stretch = 0; it.spin = 0;
    it.life = it.maxLife = 4 + Math.random() * 3;
    it.color.setRGB(0.55, 0.5, 0.45);
    it.floor = undefined;
  }
  ring.position.set(pos.x, pos.y + 0.3, pos.z);
  ring.visible = true; ringT = 0; ringR = radius;
  shake(1.6);
}

export function muzzle(pos, dir) {
  const it = glow.spawn();
  it.pos.copy(pos); it.vel.copy(dir).multiplyScalar(2);
  it.size = 0.09; it.stretch = 0; it.grav = 0; it.drag = 0; it.grow = 1; it.fade = 2;
  it.life = it.maxLife = 0.05;
  it.color.setRGB(1, 0.8, 0.45);
  it.floor = undefined;
}

export function tracer(from, to) {
  const it = streaks.spawn();
  it.pos.lerpVectors(from, to, 0.5);
  it.vel.subVectors(to, from);
  const len = it.vel.length();
  it.vel.multiplyScalar(0.0001); // only used for orientation
  it.size = 0.012; it.stretch = len; it.grav = 0; it.drag = 0; it.grow = 0; it.fade = 1;
  it.life = it.maxLife = 0.06;
  it.color.setRGB(1, 0.85, 0.55);
  it.floor = undefined;
}

export function trail(pos) {
  const it = smoke.spawn();
  it.pos.copy(pos).add(_p.set(rnd(0.1), rnd(0.1), rnd(0.1)));
  it.vel.set(rnd(0.6), 0.4, rnd(0.6));
  it.size = 0.12; it.grow = 3; it.drag = 1.5; it.grav = -0.3; it.fade = 0; it.stretch = 0; it.spin = 0;
  it.life = it.maxLife = 1.2;
  it.color.setRGB(0.75, 0.73, 0.7);
  it.floor = undefined;
  const g = glow.spawn();
  g.pos.copy(pos); g.vel.set(0, 0, 0);
  g.size = 0.1; g.stretch = 0; g.grav = 0; g.drag = 0; g.grow = 0; g.fade = 1;
  g.life = g.maxLife = 0.08; g.color.setRGB(1, 0.6, 0.2); g.floor = undefined;
}

export function update(dt) {
  // budget: more blasts recently -> fewer particles per blast
  recentBlasts = Math.max(0, recentBlasts - dt * 6);
  budget = recentBlasts > 3 ? Math.max(0.2, 3 / recentBlasts) : 1;
  for (const p of [chunks, smoke, glow, fire, streaks]) p.update(dt);
  for (const l of lights) {
    const u = l.userData;
    if (u.t >= u.dur) { l.intensity = 0; continue; }
    u.t += dt;
    const k = Math.min(1, u.t / u.dur);
    l.intensity = u.i0 * (1 - k) * (1 - k);
  }
  if (ringT >= 0) {
    ringT += dt;
    const R = Math.min(ringR, ringT * 70);
    ring.scale.setScalar(Math.max(0.01, R));
    ring.material.opacity = Math.max(0, 0.7 * (1 - ringT / (ringR / 70 + 0.5)));
    if (ringT > ringR / 70 + 0.6) { ring.visible = false; ringT = -1; }
  }
  shakeAmt = Math.max(0, shakeAmt - dt * 2.2);
  const s = shakeAmt * shakeAmt * 0.35;
  shakeOffset.set(rnd(s), rnd(s), rnd(s));
}

export function shake(a) { shakeAmt = Math.min(1.8, Math.max(shakeAmt, a)); }
export function getShake() { return shakeOffset; }
export function particleLoad() { return chunks.live + smoke.live + glow.live + fire.live + streaks.live; }

// ---------- DOM feedback ----------
const popLayer = () => document.getElementById('popups');
const _proj = new THREE.Vector3();
let popsThisFrame = 0;

export function resetFrame() { popsThisFrame = 0; }

export function popup(worldPos, text, cls = '', size = 22) {
  if (popsThisFrame > 6) return;
  _proj.copy(worldPos).project(camera);
  if (_proj.z > 1) return;
  popsThisFrame++;
  const x = (_proj.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-_proj.y * 0.5 + 0.5) * window.innerHeight;
  const el = document.createElement('div');
  el.className = 'pop ' + cls;
  el.textContent = text;
  el.style.left = x + rnd(40) + 'px';
  el.style.top = y + 'px';
  el.style.fontSize = size + 'px';
  const layer = popLayer();
  layer.appendChild(el);
  setTimeout(() => el.remove(), 1150);
  while (layer.children.length > 18) layer.firstChild.remove();
}

let bannerTimer = 0;
export function banner(text, sub = '') {
  const el = document.getElementById('banner');
  el.innerHTML = '';
  el.append(text);
  if (sub) { const s = document.createElement('small'); s.textContent = sub; el.append(s); }
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.remove('show'), 1700);
}

let vigTimer = 0;
export function flash(intensity = 1) {
  const el = document.getElementById('vignette');
  el.style.transition = 'none';
  el.style.opacity = String(Math.min(1, intensity));
  clearTimeout(vigTimer);
  vigTimer = setTimeout(() => { el.style.transition = 'opacity .6s'; el.style.opacity = '0'; }, 60);
}

let wfTimer = 0;
export function whiteFlash(intensity = 1) {
  const el = document.getElementById('whiteout');
  if (!el) return;
  el.style.transition = 'none';
  el.style.opacity = String(intensity);
  clearTimeout(wfTimer);
  wfTimer = setTimeout(() => { el.style.transition = 'opacity 2.4s ease-out'; el.style.opacity = '0'; }, 120);
}
