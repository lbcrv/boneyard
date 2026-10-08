import * as THREE from 'three';

let scene, camera;
const particles = [];
const fireballs = [];
const lights = [];
let shakeAmt = 0;
const shakeOffset = new THREE.Vector3();

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const sphereGeo = new THREE.IcosahedronGeometry(1, 1);
const matCache = new Map();
function mat(color, emissive = 0) {
  const key = color + ':' + emissive;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color, roughness: 0.8, emissive: emissive ? color : 0x000000, emissiveIntensity: emissive,
      transparent: true,
    }));
  }
  return matCache.get(key);
}

export function initFx(s, c) { scene = s; camera = c; }

export function clearFx() {
  for (const p of particles) scene.remove(p.mesh);
  for (const f of fireballs) scene.remove(f.mesh);
  for (const l of lights) scene.remove(l.light);
  particles.length = fireballs.length = lights.length = 0;
}

function spawnParticle(pos, vel, size, color, life, { gravity = 9.8, sphere = false, emissive = 0, grow = 0, drag = 0.5 } = {}) {
  if (particles.length > 380) {
    const old = particles.shift();
    scene.remove(old.mesh);
  }
  const m = new THREE.Mesh(sphere ? sphereGeo : boxGeo, emissive || grow ? mat(color, emissive).clone() : mat(color, emissive));
  m.position.copy(pos);
  m.scale.setScalar(size);
  m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
  m.castShadow = !sphere;
  scene.add(m);
  particles.push({ mesh: m, vel: vel.clone(), life, maxLife: life, size, gravity, grow, drag, spin: (Math.random() - 0.5) * 12, ownMat: !!(emissive || grow) });
}

const _p = new THREE.Vector3();
const _vv = new THREE.Vector3();

export function debris(pos, color = 0xcccccc, count = 8, speed = 4, size = 0.06) {
  for (let i = 0; i < count; i++) {
    _vv.set(Math.random() - 0.5, Math.random() * 0.9 + 0.3, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random()));
    spawnParticle(pos, _vv, size * (0.6 + Math.random() * 0.8), color, 0.6 + Math.random() * 0.7);
  }
}

export function dust(pos, scale = 1) {
  const n = Math.round(4 + scale * 6);
  for (let i = 0; i < n; i++) {
    _vv.set(Math.random() - 0.5, Math.random() * 0.4, Math.random() - 0.5).normalize().multiplyScalar(1.2 * scale * (0.5 + Math.random()));
    _p.copy(pos).add(_vv.clone().multiplyScalar(0.1));
    spawnParticle(_p, _vv, 0.12 * scale, 0xd8d2c4, 0.7 + Math.random() * 0.4, { gravity: -0.6, sphere: true, grow: 1.8, drag: 2.5 });
  }
}

export function sparks(pos, count = 10) {
  for (let i = 0; i < count; i++) {
    _vv.set(Math.random() - 0.5, Math.random(), Math.random() - 0.5).normalize().multiplyScalar(6 + Math.random() * 6);
    spawnParticle(pos, _vv, 0.04, 0xffb030, 0.35 + Math.random() * 0.3, { emissive: 3, gravity: 12 });
  }
}

export function explosion(pos, radius = 5) {
  const fm = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 1, depthWrite: false }));
  fm.position.copy(pos);
  fm.scale.setScalar(0.4);
  scene.add(fm);
  fireballs.push({ mesh: fm, t: 0, dur: 0.45, r: radius * 0.55 });

  const light = new THREE.PointLight(0xffa040, 60, radius * 6, 1.6);
  light.position.copy(pos).add(new THREE.Vector3(0, 0.8, 0));
  scene.add(light);
  lights.push({ light, t: 0, dur: 0.6, i0: 60 });

  for (let i = 0; i < 22; i++) {
    _vv.set(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(4 + Math.random() * 9);
    spawnParticle(pos, _vv, 0.08 + Math.random() * 0.08, Math.random() < 0.5 ? 0xff7a1a : 0xffc640, 0.5 + Math.random() * 0.5, { emissive: 2.5, gravity: 6 });
  }
  for (let i = 0; i < 16; i++) {
    _vv.set(Math.random() - 0.5, Math.random() * 0.6 + 0.3, Math.random() - 0.5).normalize().multiplyScalar(1.5 + Math.random() * 3);
    spawnParticle(pos, _vv, 0.35 + Math.random() * 0.3, 0x3b3633, 1.4 + Math.random() * 0.8, { gravity: -1.2, sphere: true, grow: 2.2, drag: 1.8 });
  }
  shake(Math.min(1.4, radius * 0.22));
}

export function update(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      scene.remove(p.mesh);
      if (p.ownMat) p.mesh.material.dispose();
      particles.splice(i, 1);
      continue;
    }
    p.vel.y -= p.gravity * dt;
    p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
    p.mesh.position.addScaledVector(p.vel, dt);
    if (p.gravity > 0 && p.mesh.position.y < -50) p.life = 0;
    p.mesh.rotation.x += p.spin * dt;
    p.mesh.rotation.y += p.spin * dt * 0.7;
    const k = p.life / p.maxLife;
    if (p.grow) {
      p.mesh.scale.setScalar(p.size * (1 + (1 - k) * p.grow));
      p.mesh.material.opacity = k * 0.55;
    } else if (k < 0.3) {
      p.mesh.scale.setScalar(p.size * (k / 0.3));
    }
  }
  for (let i = fireballs.length - 1; i >= 0; i--) {
    const f = fireballs[i];
    f.t += dt;
    const k = f.t / f.dur;
    if (k >= 1) { scene.remove(f.mesh); f.mesh.material.dispose(); fireballs.splice(i, 1); continue; }
    f.mesh.scale.setScalar(0.4 + (f.r - 0.4) * Math.sqrt(k));
    f.mesh.material.opacity = 1 - k;
    f.mesh.material.color.setHSL(0.1 - k * 0.08, 1, 0.65 - k * 0.3);
  }
  for (let i = lights.length - 1; i >= 0; i--) {
    const l = lights[i];
    l.t += dt;
    const k = l.t / l.dur;
    if (k >= 1) { scene.remove(l.light); l.light.dispose(); lights.splice(i, 1); continue; }
    l.light.intensity = l.i0 * (1 - k) * (1 - k);
  }
  shakeAmt = Math.max(0, shakeAmt - dt * 2.2);
  const s = shakeAmt * shakeAmt * 0.35;
  shakeOffset.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
}

export function shake(a) { shakeAmt = Math.min(1.6, Math.max(shakeAmt, a)); }
export function getShake() { return shakeOffset; }

// ---------- DOM feedback ----------
const popLayer = () => document.getElementById('popups');
const _proj = new THREE.Vector3();

export function popup(worldPos, text, cls = '', size = 22) {
  _proj.copy(worldPos).project(camera);
  if (_proj.z > 1) return;
  const x = (_proj.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-_proj.y * 0.5 + 0.5) * window.innerHeight;
  const el = document.createElement('div');
  el.className = 'pop ' + cls;
  el.textContent = text;
  el.style.left = x + (Math.random() - 0.5) * 40 + 'px';
  el.style.top = y + 'px';
  el.style.fontSize = size + 'px';
  popLayer().appendChild(el);
  setTimeout(() => el.remove(), 1150);
  const layer = popLayer();
  while (layer.children.length > 24) layer.firstChild.remove();
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
