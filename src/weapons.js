import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { world, GROUP, MASK_ALL } from './physics.js';
import { Ragdoll } from './ragdoll.js';
import * as lv from './level.js';
import { L } from './level.js';
import * as fx from './fx.js';
import * as sfx from './audio.js';
import * as blood from './blood.js';

const ray = new CANNON.RaycastResult();
const rf = new CANNON.Vec3(), rt = new CANNON.Vec3();
const HIT_ALL = { collisionFilterMask: MASK_ALL, skipBackfaces: true };
const _v = new THREE.Vector3();

const rockets = [];
const mines = [];
const shocks = [];
let pendingNuke = null;

export function clearWeapons() {
  for (const r of rockets) L.scene.remove(r.mesh);
  for (const m of mines) L.scene.remove(m.mesh);
  rockets.length = mines.length = shocks.length = 0;
  pendingNuke = null;
}

function rayHit(from, to) {
  rf.set(from.x, from.y, from.z); rt.set(to.x, to.y, to.z);
  ray.reset();
  if (!world.raycastClosest(rf, rt, HIT_ALL, ray)) return null;
  return {
    body: ray.body,
    point: new THREE.Vector3(ray.hitPointWorld.x, ray.hitPointWorld.y, ray.hitPointWorld.z),
    normal: new THREE.Vector3(ray.hitNormalWorld.x, ray.hitNormalWorld.y, ray.hitNormalWorld.z),
  };
}

// ------------------------------------------------------------------ SMG
export function fireSMG(origin, dir, muzzle) {
  const d = dir.clone();
  d.x += (Math.random() - 0.5) * 0.025; d.y += (Math.random() - 0.5) * 0.025; d.z += (Math.random() - 0.5) * 0.025;
  d.normalize();
  const end = origin.clone().addScaledVector(d, 250);
  const h = rayHit(origin, end);
  const to = h ? h.point : end;
  fx.tracer(muzzle, to);
  fx.muzzle(muzzle, d);
  sfx.gun();
  if (!h) return;
  const b = h.body;
  const rag = b.userData && b.userData.ragdoll;
  if (rag) {
    const part = b.userData.part;
    // bullet: small mass, very high speed -> concentrated trauma
    b.applyImpulse(new CANNON.Vec3(d.x * 14, d.y * 14, d.z * 14), new CANNON.Vec3(h.point.x - b.position.x, h.point.y - b.position.y, h.point.z - b.position.z));
    rag.receiveHit({ part, v: 15, point: h.point, focus: 2, kind: 'bullet', dmgMul: 1.4 });
    rag.stumble = Math.min(1, rag.stumble + 0.25);
    if (blood.isBloodOn()) {
      blood.spray(h.point, _v.copy(d).negate(), 5, 2.2);
      blood.spray(h.point, d, 9, 4.5);
      // head, neck and the femoral artery bleed out; everywhere else is a hole that drips
      const local = b.pointToLocalFrame(new CANNON.Vec3(h.point.x, h.point.y, h.point.z), new CANNON.Vec3());
      const neck = part.name === 'chest' && local.y > 0.08;
      const artery = part.name.startsWith('thigh') && Math.random() < 0.4;
      blood.wound(part, h.point, 0.012 + Math.random() * 0.01, part.name === 'head' || neck || artery ? 'severe' : 'open');
      // spatter on whatever is behind
      const back = rayHit(h.point.clone().addScaledVector(d, 0.35), h.point.clone().addScaledVector(d, 3));
      if (back && !(back.body.userData && back.body.userData.ragdoll)) blood.splat(back.point, back.normal, 0.15 + Math.random() * 0.25);
    } else fx.debris(h.point, 0xf2c14e, 3, 2, 0.025);
  } else {
    if (b.type === CANNON.Body.DYNAMIC) {
      b.wakeUp();
      b.applyImpulse(new CANNON.Vec3(d.x * 18, d.y * 18, d.z * 18), new CANNON.Vec3(h.point.x - b.position.x, h.point.y - b.position.y, h.point.z - b.position.z));
      if (L.barrels.has(b) && Math.random() < 0.3) lv.scheduleExplosion(b, 0.05);
    }
    fx.sparks(h.point, 5, 0xffc060, 5);
  }
  hitMineByRay(h.point);
}

// ------------------------------------------------------------------ bazooka
export function fireRocket(origin, dir) {
  const mesh = new THREE.Group();
  const bodyM = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 10), lv.stdMat(0x3d4a35, { roughness: 0.6 }));
  bodyM.rotation.x = Math.PI / 2;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 10), lv.stdMat(0x8a2a22));
  tip.rotation.x = Math.PI / 2; tip.position.z = 0.38;
  mesh.add(bodyM, tip);
  mesh.position.copy(origin);
  mesh.lookAt(origin.clone().add(dir));
  L.scene.add(mesh);
  rockets.push({ pos: origin.clone(), vel: dir.clone().multiplyScalar(42), mesh, life: 6, trailT: 0 });
  sfx.rocket();
  if (rockets.length > 12) { const r = rockets.shift(); L.scene.remove(r.mesh); }
}

// ------------------------------------------------------------------ nuke
export function dropNuke(point) {
  if (pendingNuke) return false;
  pendingNuke = { point: point.clone(), t: 2.2, beep: 0 };
  return true;
}

function detonateNuke(p) {
  const R = 70;
  fx.nuke(p, R);
  sfx.nukeBoom();
  shocks.push({ center: p.clone(), t: 0, R, speed: 70, done: new Set() });
  // the ground zero mess: big immediate kick at the centre
  lv.explode(p, 10, 35, { silent: true, fxScale: 0 });
}

// ------------------------------------------------------------------ mines
const mineGeo = new THREE.CylinderGeometry(0.22, 0.26, 0.08, 18);
const mineMat = new THREE.MeshStandardMaterial({ color: 0x4b5240, roughness: 0.7, metalness: 0.3 });
const lampGeo = new THREE.SphereGeometry(0.03, 8, 6);

export function placeMine(point, normal) {
  const mesh = new THREE.Group();
  const disc = new THREE.Mesh(mineGeo, mineMat);
  disc.castShadow = true; disc.receiveShadow = true;
  const lamp = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0x330000 }));
  lamp.position.y = 0.05;
  mesh.add(disc, lamp);
  mesh.position.copy(point).addScaledVector(normal, 0.04);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal.clone().normalize());
  L.scene.add(mesh);
  const m = { pos: mesh.position.clone(), mesh, lamp, arm: 1.0, trig: -1, blink: 0 };
  mines.push(m);
  if (mines.length > 90) removeMine(mines[0]);
  sfx.blip(900);
  return m;
}

function removeMine(m) {
  L.scene.remove(m.mesh);
  m.lamp.material.dispose();
  const i = mines.indexOf(m);
  if (i >= 0) mines.splice(i, 1);
}

function triggerMine(m, delay = 0.22) {
  if (m.trig >= 0) return;
  m.trig = delay;
  sfx.mineClick();
}

function hitMineByRay(p) {
  for (const m of mines) if (m.pos.distanceToSquared(p) < 0.09) triggerMine(m, 0.02);
}

/** Called by level.explode so blasts set off nearby mines. */
export function blastMines(p, radius) {
  for (const m of mines) if (m.trig < 0 && m.pos.distanceTo(p) < radius * 0.8) triggerMine(m, 0.1 + Math.random() * 0.15);
}

// ------------------------------------------------------------------ per physics step
export function stepWeapons(dt) {
  // rockets: swept raycast each step so they never tunnel
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i];
    r.life -= dt;
    const from = r.pos.clone();
    r.vel.y -= 2.5 * dt;
    r.pos.addScaledVector(r.vel, dt);
    const h = rayHit(from, r.pos);
    if (h || r.life <= 0) {
      L.scene.remove(r.mesh);
      rockets.splice(i, 1);
      const p = h ? h.point.addScaledVector(r.vel.clone().normalize(), -0.2) : r.pos;
      lv.explode(p, 7, 25);
      continue;
    }
    r.mesh.position.copy(r.pos);
    r.mesh.lookAt(_v.copy(r.pos).add(r.vel));
    r.trailT -= dt;
    if (r.trailT <= 0) { r.trailT = 0.012; fx.trail(r.pos); }
  }

  // nuke countdown
  if (pendingNuke) {
    pendingNuke.t -= dt;
    pendingNuke.beep -= dt;
    if (pendingNuke.beep <= 0) { pendingNuke.beep = Math.max(0.08, pendingNuke.t * 0.18); sfx.siren(); }
    if (pendingNuke.t <= 0) { const p = pendingNuke.point; pendingNuke = null; detonateNuke(p); }
  }

  // shock waves: bodies get kicked when the front reaches them
  for (let i = shocks.length - 1; i >= 0; i--) {
    const s = shocks[i];
    s.t += dt;
    const front = s.t * s.speed;
    for (const b of world.bodies) {
      if (b.type !== CANNON.Body.DYNAMIC || s.done.has(b)) continue;
      const dx = b.position.x - s.center.x, dy = b.position.y - s.center.y, dz = b.position.z - s.center.z;
      const d = Math.hypot(dx, dz);
      if (d > front) continue;
      s.done.add(b);
      if (d > s.R) continue;
      const f = Math.pow(1 - d / s.R, 1.3);
      const rag = b.userData && b.userData.ragdoll;
      if (rag) continue;
      const inv = 1 / Math.max(1, Math.hypot(dx, dy, dz));
      const scale = b.mass > 400 ? 400 / b.mass : 1;
      b.wakeUp();
      b.velocity.x += dx * inv * 45 * f * scale;
      b.velocity.y += (12 + Math.max(0, dy) * inv * 20) * f * scale;
      b.velocity.z += dz * inv * 45 * f * scale;
      b.angularVelocity.x += (Math.random() - 0.5) * 20 * f;
      b.angularVelocity.z += (Math.random() - 0.5) * 20 * f;
      if (L.barrels.has(b) && Math.random() < f) lv.scheduleExplosion(b, 0.1 + Math.random() * 0.4);
    }
    for (const rag of Ragdoll.all) {
      if (s.done.has(rag)) continue;
      const c = rag.chest.position;
      const dx = c.x - s.center.x, dz = c.z - s.center.z;
      const d = Math.hypot(dx, dz);
      if (d > front) continue;
      s.done.add(rag);
      if (d > s.R) continue;
      const f = Math.pow(1 - d / s.R, 1.2);
      const inv = 1 / Math.max(1, d);
      rag.addVelocity(dx * inv * 40 * f, 10 + 18 * f, dz * inv * 40 * f, 14 * f);
      rag.goFall('nuke');
      rag.blastTrauma(Math.min(1, f * 1.4));
      rag.burnt = Math.max(rag.burnt, f * 1.3);
      L.onScore?.(Math.round(2000 * f), 'ONDA EXPANSIVA', rag.chest.position, rag);
    }
    for (const m of mines) if (m.trig < 0 && m.pos.distanceTo(s.center) < Math.min(front, s.R)) triggerMine(m, Math.random() * 0.3);
    if (front > s.R * 1.2) shocks.splice(i, 1);
  }

  // mines
  for (let i = mines.length - 1; i >= 0; i--) {
    const m = mines[i];
    if (m.arm > 0) { m.arm -= dt; continue; }
    if (m.trig >= 0) {
      m.trig -= dt;
      if (m.trig < 0) {
        const p = m.pos.clone();
        removeMine(m);
        // mines throw everything up
        lv.explode(p, 5.5, 24, { up: 9 });
        continue;
      }
    } else {
      // pressure plate: anything heavy enough on top
      for (const b of world.bodies) {
        if (b.type !== CANNON.Body.DYNAMIC || b.mass < 0.5 || b.sleepState === 2) continue;
        const dx = b.position.x - m.pos.x, dy = b.position.y - m.pos.y, dz = b.position.z - m.pos.z;
        if (dx * dx + dz * dz < 0.5 * 0.5 && dy > -0.2 && dy < 0.6) { triggerMine(m); break; }
      }
    }
  }
}

/** Per frame (visual). */
export function updateWeaponVisuals(dt) {
  for (const m of mines) {
    m.blink += dt;
    const on = m.trig >= 0 ? (m.blink * 20) % 1 < 0.5 : m.arm > 0 ? false : (m.blink * 1.2) % 1 < 0.12;
    m.lamp.material.color.setHex(on ? 0xff2a1a : 0x330000);
  }
}

export function nukePending() { return !!pendingNuke; }
export function mineCount() { return mines.length; }
