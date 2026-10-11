import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { world, GROUP } from './physics.js';

/*
 * Optional blood. Off by default; the player turns it on in the menu (or B).
 * Droplets are one InstancedMesh; splats are one InstancedMesh of decals laid
 * on the surface they hit. Wounds stick to the body part that was hit and
 * drip while the part keeps them.
 */

let enabled = false;
let scene;
let drops, splats, wounds;
const MAX_DROPS = 500, MAX_SPLATS = 400, MAX_WOUNDS = 120;
const dropItems = [];
let dropCursor = 0;
let splatCursor = 0, splatCount = 0;
const woundList = [];
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const ray = new CANNON.RaycastResult();
const rf = new CANNON.Vec3(), rt = new CANNON.Vec3();
const RAY = { collisionFilterMask: GROUP.STATIC | GROUP.PROP | GROUP.VEHICLE, skipBackfaces: true };

function splatTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  const blob = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  blob(64, 64, 30);
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2, d = 26 + Math.random() * 26;
    blob(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 3 + Math.random() * 9);
    // streak from the centre
    g.lineWidth = 3 + Math.random() * 5;
    g.strokeStyle = '#fff';
    g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * d, 64 + Math.sin(a) * d); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

export function initBlood(s) {
  scene = s;
  try { enabled = localStorage.getItem('boneyard.blood') === '1'; } catch { enabled = false; }
  drops = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0.1 }), MAX_DROPS);
  drops.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DROPS * 3), 3);
  drops.frustumCulled = false; drops.count = 0;
  for (let i = 0; i < MAX_DROPS; i++) dropItems.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: 0, life: 0 });
  const tex = splatTexture();
  splats = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({
    color: 0xffffff, alphaMap: tex, transparent: true, depthWrite: false, roughness: 0.2, metalness: 0.05,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }), MAX_SPLATS);
  splats.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPLATS * 3), 3);
  splats.frustumCulled = false; splats.count = 0;
  splats.receiveShadow = true;
  wounds = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshStandardMaterial({ color: 0x4a0606, roughness: 0.3 }), MAX_WOUNDS);
  wounds.frustumCulled = false; wounds.count = 0;
  scene.add(drops, splats, wounds);
}

export function isBloodOn() { return enabled; }
export function setBlood(on) {
  enabled = on;
  try { localStorage.setItem('boneyard.blood', on ? '1' : '0'); } catch { /* ignore */ }
  if (!on) clearBlood();
}

export function clearBlood() {
  for (const d of dropItems) d.alive = false;
  drops.count = 0; splats.count = 0; splatCount = 0; splatCursor = 0;
  woundList.length = 0; wounds.count = 0;
}

function bloodColor(out) {
  return out.setRGB(0.16 + Math.random() * 0.08, 0.005, 0.008);
}

/** Spray from a point. dir: main direction (normalized), amount ~ 1..20 */
export function spray(point, dir, amount = 8, speed = 3) {
  if (!enabled) return;
  for (let i = 0; i < amount; i++) {
    const d = dropItems[dropCursor];
    dropCursor = (dropCursor + 1) % MAX_DROPS;
    d.alive = true;
    d.pos.copy(point);
    d.vel.set(dir.x + (Math.random() - 0.5) * 0.9, dir.y + Math.random() * 0.7, dir.z + (Math.random() - 0.5) * 0.9)
      .normalize().multiplyScalar(speed * (0.4 + Math.random()));
    d.size = 0.008 + Math.random() * 0.018;
    d.life = 3;
    bloodColor(d.color || (d.color = new THREE.Color()));
  }
}

/** Lay a decal on a surface. */
export function splat(point, normal, size) {
  if (!enabled) return;
  _n.copy(normal).normalize();
  _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _n);
  const spin = new THREE.Quaternion().setFromAxisAngle(_n, Math.random() * Math.PI * 2);
  _q.premultiply(spin);
  _p.copy(point).addScaledVector(_n, 0.004 + (splatCursor % 7) * 0.0006);
  _s.set(size, size * (0.7 + Math.random() * 0.6), 1);
  _m.compose(_p, _q, _s);
  splats.setMatrixAt(splatCursor, _m);
  splats.setColorAt(splatCursor, bloodColor(_c).multiplyScalar(0.8 + Math.random() * 0.3));
  splatCursor = (splatCursor + 1) % MAX_SPLATS;
  splatCount = Math.min(MAX_SPLATS, splatCount + 1);
  splats.count = splatCount;
  splats.instanceMatrix.needsUpdate = true;
  splats.instanceColor.needsUpdate = true;
}

/** Puts a wound on a ragdoll part (local coords) that keeps dripping. */
export function wound(part, worldPoint, size = 0.02) {
  if (!enabled) return;
  const b = part.body;
  const local = b.pointToLocalFrame(new CANNON.Vec3(worldPoint.x, worldPoint.y, worldPoint.z), new CANNON.Vec3());
  // pull onto the surface a bit
  if (woundList.length >= MAX_WOUNDS) woundList.shift();
  woundList.push({ part, local: new THREE.Vector3(local.x, local.y, local.z), size, drip: 0, bleed: 6 + Math.random() * 8 });
  part.wounds++;
}

const _wp = new CANNON.Vec3();
export function update(dt) {
  if (!enabled) return;
  let n = 0;
  for (const d of dropItems) {
    if (!d.alive) continue;
    d.life -= dt;
    if (d.life <= 0) { d.alive = false; continue; }
    const px = d.pos.x, py = d.pos.y, pz = d.pos.z;
    d.vel.y -= 12.5 * dt;
    d.pos.addScaledVector(d.vel, dt);
    // swept test against the world (one short ray per drop per frame)
    rf.set(px, py, pz); rt.set(d.pos.x, d.pos.y - 0.01, d.pos.z);
    ray.reset();
    if (world.raycastClosest(rf, rt, RAY, ray)) {
      d.alive = false;
      const sp = ray.hitPointWorld, nn = ray.hitNormalWorld;
      if (Math.random() < 0.55) splat(new THREE.Vector3(sp.x, sp.y, sp.z), new THREE.Vector3(nn.x, nn.y, nn.z), 0.05 + d.size * 6 + Math.random() * 0.08);
      continue;
    }
    _q.identity();
    _s.set(d.size, d.size * 1.6, d.size);
    _m.compose(d.pos, _q, _s);
    drops.setMatrixAt(n, _m);
    drops.setColorAt(n, d.color);
    n++;
  }
  drops.count = n;
  drops.instanceMatrix.needsUpdate = true;
  if (drops.instanceColor) drops.instanceColor.needsUpdate = true;

  let w = 0;
  for (const wd of woundList) {
    const b = wd.part.body;
    _wp.set(wd.local.x, wd.local.y, wd.local.z);
    b.pointToWorldFrame(_wp, _wp);
    _p.set(_wp.x, _wp.y, _wp.z);
    _q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    _s.setScalar(wd.size);
    _m.compose(_p, _q, _s);
    wounds.setMatrixAt(w++, _m);
    if (wd.bleed > 0) {
      wd.bleed -= dt;
      wd.drip -= dt;
      if (wd.drip <= 0) {
        wd.drip = 0.15 + Math.random() * 0.5;
        spray(_p, _n.set(0, -1, 0), 1, 0.4);
      }
    }
  }
  wounds.count = w;
  wounds.instanceMatrix.needsUpdate = true;
}

/** Slowly growing pool under a body that lies still with open wounds. */
export function pool(point, size) {
  if (!enabled) return;
  splat(point, UP, size);
}
