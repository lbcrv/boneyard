import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export const GROUP = {
  STATIC: 1,
  RAGDOLL: 2,
  PROP: 4,
  PROJ: 8,
  NONE: 0,
};
export const MASK_ALL = GROUP.STATIC | GROUP.RAGDOLL | GROUP.PROP | GROUP.PROJ;

export const FIXED_DT = 1 / 120;

export const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
world.solver.iterations = 18;
world.solver.tolerance = 1e-7;
world.quatNormalizeFast = false;
world.quatNormalizeSkip = 0;

export const MAT = {
  ground: new CANNON.Material('ground'),
  ragdoll: new CANNON.Material('ragdoll'),
  prop: new CANNON.Material('prop'),
  bouncy: new CANNON.Material('bouncy'),
  ice: new CANNON.Material('ice'),
  vehicle: new CANNON.Material('vehicle'),
};

world.defaultContactMaterial.friction = 0.5;
world.defaultContactMaterial.restitution = 0.05;

function cm(a, b, friction, restitution) {
  world.addContactMaterial(new CANNON.ContactMaterial(a, b, { friction, restitution }));
}
cm(MAT.ragdoll, MAT.ground, 0.85, 0.08);
cm(MAT.ragdoll, MAT.ragdoll, 0.4, 0.05);
cm(MAT.ragdoll, MAT.prop, 0.6, 0.1);
cm(MAT.prop, MAT.ground, 0.55, 0.15);
cm(MAT.prop, MAT.prop, 0.45, 0.2);
cm(MAT.ragdoll, MAT.bouncy, 0.6, 0.95);
cm(MAT.prop, MAT.bouncy, 0.5, 0.95);
cm(MAT.ragdoll, MAT.ice, 0.02, 0.05);
cm(MAT.prop, MAT.ice, 0.02, 0.05);
cm(MAT.vehicle, MAT.ground, 0.06, 0.05);
cm(MAT.vehicle, MAT.ragdoll, 0.5, 0.15);
cm(MAT.vehicle, MAT.prop, 0.4, 0.15);

// ---- Small math helpers shared across modules ----
export const _v = new CANNON.Vec3();
export const tmpQ = new CANNON.Quaternion();

export function toThreeQ(cq, out = new THREE.Quaternion()) {
  return out.set(cq.x, cq.y, cq.z, cq.w);
}
export function toThreeV(cv, out = new THREE.Vector3()) {
  return out.set(cv.x, cv.y, cv.z);
}

/** Inverse inertia of a body around a world-space unit axis n. */
export function invInertiaAlong(body, nx, ny, nz) {
  if (body.type !== CANNON.Body.DYNAMIC) return 0;
  const q = body.quaternion;
  // rotate n into body local frame with p = conj(q): v' = v + w*t + p x t, t = 2 p x v
  const px = -q.x, py = -q.y, pz = -q.z, pw = q.w;
  const tx = 2 * (py * nz - pz * ny);
  const ty = 2 * (pz * nx - px * nz);
  const tz = 2 * (px * ny - py * nx);
  const lx = nx + pw * tx + (py * tz - pz * ty);
  const ly = ny + pw * ty + (pz * tx - px * tz);
  const lz = nz + pw * tz + (px * ty - py * tx);
  const I = body.invInertia;
  return lx * lx * I.x + ly * ly * I.y + lz * lz * I.z;
}

const _loc = new CANNON.Vec3();
const _qc = new CANNON.Quaternion();
/** Apply an angular impulse (world space) to a body. */
export function applyAngularImpulse(body, jx, jy, jz) {
  if (body.type !== CANNON.Body.DYNAMIC) return;
  const q = body.quaternion;
  q.conjugate(_qc);
  _loc.set(jx, jy, jz);
  _qc.vmult(_loc, _loc);
  const I = body.invInertia;
  _loc.x *= I.x; _loc.y *= I.y; _loc.z *= I.z;
  q.vmult(_loc, _loc);
  body.angularVelocity.x += _loc.x;
  body.angularVelocity.y += _loc.y;
  body.angularVelocity.z += _loc.z;
}

/** Registry of physics<->render pairs that must be synced each frame. */
export const synced = [];

export function syncAll() {
  for (let i = 0; i < synced.length; i++) {
    const s = synced[i];
    const b = s.body;
    s.mesh.position.set(b.position.x, b.position.y, b.position.z);
    s.mesh.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
  }
}

export function track(body, mesh) {
  mesh.userData.body = body;
  body.userData = body.userData || {};
  body.userData.mesh = mesh;
  synced.push({ body, mesh });
}

export function untrack(body) {
  const i = synced.findIndex((s) => s.body === body);
  if (i >= 0) synced.splice(i, 1);
}
