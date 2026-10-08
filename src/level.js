import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { world, GROUP, MASK_ALL, MAT, track, untrack, synced } from './physics.js';
import { crateTexture, barrelTexture, hazardTexture } from './textures.js';
import * as fx from './fx.js';
import * as sfx from './audio.js';

/*
 * Everything that belongs to the current map lives here so a map switch / reset
 * can wipe it cleanly. The ragdoll is owned by main.js and only referenced.
 */
export const L = {
  scene: null,
  ragdoll: null,
  bodies: [],        // all non-ragdoll bodies we created
  meshes: [],        // all meshes we created
  constraints: [],
  updaters: [],      // (dt, t) => void, per physics step
  triggers: [],
  props: [],         // dynamic props (for despawn limits)
  projectiles: [],
  barrels: new Set(),
  pendingExplosions: [],
  time: 0,
  onScore: null,     // (pts, label, pos) => void
};

export function initLevel(scene) { L.scene = scene; }

export function clearLevel() {
  for (const c of L.constraints) world.removeConstraint(c);
  for (const b of L.bodies) { world.removeBody(b); untrack(b); }
  for (const m of L.meshes) {
    L.scene.remove(m);
    m.traverse?.((o) => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); });
  }
  L.bodies.length = L.meshes.length = L.constraints.length = 0;
  L.updaters.length = L.triggers.length = L.props.length = L.projectiles.length = 0;
  L.pendingExplosions.length = 0;
  L.barrels.clear();
  L.time = 0;
}

function addMesh(m) { L.scene.add(m); L.meshes.push(m); return m; }
function addBody(b) { world.addBody(b); L.bodies.push(b); return b; }

const matCache = new Map();
export function stdMat(color, opts = {}) {
  const key = JSON.stringify([color, opts.map?.uuid, opts.emissive, opts.roughness, opts.metalness, opts.transparent]);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color, roughness: opts.roughness ?? 0.75, metalness: opts.metalness ?? 0.05,
      map: opts.map || null, emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.emissiveIntensity ?? 1,
      transparent: !!opts.transparent, opacity: opts.opacity ?? 1,
    }));
  }
  return matCache.get(key);
}

function quatFromEuler(rot) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0] || 0, rot[1] || 0, rot[2] || 0));
  return q;
}

/** Static box: size = full extents [w,h,d]. */
export function staticBox(size, pos, { rot = [0, 0, 0], color = 0x9aa0a8, map = null, material = MAT.ground, castShadow = true, mat = null, visible = true } = {}) {
  const q = quatFromEuler(rot);
  const body = new CANNON.Body({
    mass: 0, material, type: CANNON.Body.STATIC,
    collisionFilterGroup: GROUP.STATIC, collisionFilterMask: MASK_ALL,
  });
  body.addShape(new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2)));
  body.position.set(pos[0], pos[1], pos[2]);
  body.quaternion.set(q.x, q.y, q.z, q.w);
  addBody(body);
  if (visible) {
    let m2 = mat;
    if (!m2) {
      if (map) {
        const t = map.clone();
        t.needsUpdate = true;
        t.repeat.set(Math.max(1, Math.round(Math.max(size[0], size[2]) / 4)), Math.max(1, Math.round(Math.max(size[1], size[2]) / 4)));
        m2 = new THREE.MeshStandardMaterial({ color, map: t, roughness: 0.85 });
      } else m2 = stdMat(color);
    }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), m2);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.quaternion.copy(q);
    mesh.castShadow = castShadow; mesh.receiveShadow = true;
    mesh.userData.body = body;
    addMesh(mesh);
  }
  return body;
}

/** Big floor with a world-aligned grid texture. */
export function floor(size, pos, tex, color = 0xffffff, material = MAT.ground) {
  const body = staticBox(size, pos, { visible: false, material });
  const t = tex.clone();
  t.needsUpdate = true;
  t.repeat.set(size[0] / 4, size[2] / 4);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), new THREE.MeshStandardMaterial({ color, map: t, roughness: 0.9 }));
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.receiveShadow = true;
  mesh.userData.body = body;
  addMesh(mesh);
  return body;
}

export function dynamicBody(shapeList, pos, mass, mesh, { rot = [0, 0, 0], material = MAT.prop, group = GROUP.PROP, linearDamping = 0.02, angularDamping = 0.05, sleep = true } = {}) {
  const q = quatFromEuler(rot);
  const body = new CANNON.Body({
    mass, material, collisionFilterGroup: group, collisionFilterMask: MASK_ALL,
    linearDamping, angularDamping, allowSleep: sleep,
  });
  body.sleepSpeedLimit = 0.15;
  body.sleepTimeLimit = 1.2;
  for (const s of shapeList) body.addShape(s.shape, s.offset, s.orient);
  body.position.set(pos[0], pos[1], pos[2]);
  body.quaternion.set(q.x, q.y, q.z, q.w);
  addBody(body);
  mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.body = body; } });
  addMesh(mesh);
  track(body, mesh);
  body.userData = body.userData || {};
  body.userData.mesh = mesh;
  return body;
}

function boxShape(w, h, d, offset) {
  return { shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)), offset: offset ? new CANNON.Vec3(...offset) : undefined };
}

// ------------------------------------------------------------------ props
export function crate(pos, size = 0.8, rot = [0, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), stdMat(0xffffff, { map: crateTexture(), roughness: 0.8 }));
  const b = dynamicBody([boxShape(size, size, size)], pos, 22 * size * size * size / 0.512, mesh, { rot });
  b.userData.kind = 'crate';
  impactSound(b, 0.9);
  L.props.push(b);
  return b;
}

export function box(size, pos, mass, color, rot = [0, 0, 0], opts = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), stdMat(color, opts));
  const b = dynamicBody([boxShape(...size)], pos, mass, mesh, { rot });
  impactSound(b, 1.2);
  L.props.push(b);
  return b;
}

export function ball(pos, r = 0.3, mass = 5, color = 0x4fa3ff, material = MAT.prop) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), stdMat(color, { roughness: 0.35 }));
  const b = dynamicBody([{ shape: new CANNON.Sphere(r) }], pos, mass, mesh, { material, angularDamping: 0.2 });
  impactSound(b, 1.4);
  L.props.push(b);
  return b;
}

export function domino(pos, yaw = 0, color = 0xf4f1ea) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, 0.12), stdMat(color, { roughness: 0.4 }));
  const b = dynamicBody([boxShape(0.5, 1.0, 0.12)], pos, 4, mesh, { rot: [0, yaw, 0] });
  impactSound(b, 1.6);
  return b;
}

export function barrel(pos) {
  const r = 0.36, h = 1.0;
  const g = new THREE.Group();
  const side = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20, 1, true), stdMat(0xffffff, { map: barrelTexture(), roughness: 0.5, metalness: 0.2 }));
  const caps = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.98, r * 0.98, h * 0.99, 20), stdMat(0x9e2116, { roughness: 0.5, metalness: 0.3 }));
  g.add(caps, side);
  const b = dynamicBody([{ shape: new CANNON.Cylinder(r, r, h, 12) }], pos, 30, g, { angularDamping: 0.1 });
  b.userData.kind = 'barrel';
  L.barrels.add(b);
  b.addEventListener('collide', (e) => {
    const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
    if (v > 7.5) scheduleExplosion(b, 0.05);
    else if (v > 1.5) sfx.knock(v, 0.6);
  });
  return b;
}

export function truck(pos, dir, speed = 22) {
  const g = new THREE.Group();
  const yaw = Math.atan2(dir.x, dir.z);
  const red = stdMat(0xd8402a, { roughness: 0.4, metalness: 0.3 });
  const gray = stdMat(0xd9d9d9, { roughness: 0.6 });
  const black = stdMat(0x1c1c1c, { roughness: 0.9 });
  const glass = stdMat(0x7fc6ff, { roughness: 0.1, metalness: 0.6 });
  const cargo = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.9, 3.2), gray); cargo.position.set(0, 0.25, -0.75);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 1.3), red); cab.position.set(0, 0.0, 1.55);
  const win = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.55, 0.05), glass); win.position.set(0, 0.35, 2.21);
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.3, 0.2), black); bumper.position.set(0, -0.6, 2.25);
  g.add(cargo, cab, win, bumper);
  for (const [x, z] of [[1.05, 1.5], [-1.05, 1.5], [1.05, -1.4], [-1.05, -1.4]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 16), black);
    w.rotation.z = Math.PI / 2; w.position.set(x, -0.75, z); g.add(w);
  }
  const b = dynamicBody([
    boxShape(2.2, 1.9, 3.2, [0, 0.25, -0.75]),
    boxShape(2.2, 1.4, 1.3, [0, 0.0, 1.55]),
    boxShape(2.2, 0.5, 4.6, [0, -0.7, 0.1]),
  ], [pos.x, pos.y, pos.z], 1600, g, { rot: [0, yaw, 0], material: MAT.vehicle, sleep: false });
  b.velocity.set(dir.x * speed, 0, dir.z * speed);
  b.userData.kind = 'truck';
  b.userData.noGrip = false;
  impactSound(b, 0.5);
  let t = 0;
  L.updaters.push((dt) => {
    t += dt;
    if (t < 2.5 && b.world) {
      // keep the engine pushing for a bit
      const v = b.velocity;
      const along = v.x * dir.x + v.z * dir.z;
      if (along < speed) { b.force.x += dir.x * 1600 * 14; b.force.z += dir.z * 1600 * 14; }
    }
  });
  L.props.push(b);
  return b;
}

export function cannonball(pos, vel) {
  const r = 0.22;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), stdMat(0x24262b, { roughness: 0.3, metalness: 0.7 }));
  const b = dynamicBody([{ shape: new CANNON.Sphere(r) }], [pos.x, pos.y, pos.z], 14, mesh, { group: GROUP.PROJ, angularDamping: 0.3 });
  b.velocity.set(vel.x, vel.y, vel.z);
  b.userData.projectile = true;
  b.userData.born = L.time;
  impactSound(b, 0.7);
  L.projectiles.push(b);
  if (L.projectiles.length > 28) removeBody(L.projectiles.shift());
  return b;
}

function impactSound(b, pitch) {
  b.addEventListener('collide', (e) => {
    if (e.body.userData && e.body.userData.ragdoll) return; // ragdoll plays its own
    const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
    if (v > 2) sfx.knock(v, pitch);
    if (v > 9) fx.dust(new THREE.Vector3(b.position.x, b.position.y, b.position.z), 0.6);
  });
}

export function limitProps(max = 70) {
  while (L.props.length > max) removeBody(L.props.shift());
}

export function removeBody(b) {
  if (!b) return;
  L.ragdoll?.releaseGripsOn(b);
  world.removeBody(b);
  untrack(b);
  const m = b.userData && b.userData.mesh;
  if (m) { L.scene.remove(m); const i = L.meshes.indexOf(m); if (i >= 0) L.meshes.splice(i, 1); }
  let i = L.bodies.indexOf(b); if (i >= 0) L.bodies.splice(i, 1);
  i = L.props.indexOf(b); if (i >= 0) L.props.splice(i, 1);
  i = L.projectiles.indexOf(b); if (i >= 0) L.projectiles.splice(i, 1);
  L.barrels.delete(b);
}

// ------------------------------------------------------------------ explosions
export function scheduleExplosion(barrelBody, delay) {
  if (barrelBody.userData.exploding) return;
  barrelBody.userData.exploding = true;
  L.pendingExplosions.push({ body: barrelBody, t: delay });
}

export function explode(pos, radius = 6, power = 20) {
  const p = new THREE.Vector3(pos.x, pos.y, pos.z);
  fx.explosion(p, radius);
  sfx.boom(Math.min(1.3, radius / 6));
  let hitRagdoll = 0;
  const all = world.bodies.slice();
  for (const b of all) {
    if (b.type !== CANNON.Body.DYNAMIC) continue;
    const dx = b.position.x - p.x, dy = b.position.y - p.y + 0.4, dz = b.position.z - p.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > radius) continue;
    const f = 1 - d / radius;
    const inv = 1 / Math.max(0.3, d);
    const massScale = b.mass > 300 ? 300 / b.mass : 1;
    const isRag = b.userData && b.userData.ragdoll;
    if (isRag) { hitRagdoll = Math.max(hitRagdoll, f); continue; }
    b.wakeUp();
    b.velocity.x += dx * inv * power * f * massScale;
    b.velocity.y += (dy * inv * power * f + 5 * f) * massScale;
    b.velocity.z += dz * inv * power * f * massScale;
    b.angularVelocity.x += (Math.random() - 0.5) * 12 * f;
    b.angularVelocity.y += (Math.random() - 0.5) * 12 * f;
    b.angularVelocity.z += (Math.random() - 0.5) * 12 * f;
    if (L.barrels.has(b) && b !== undefined && d > 0.05) scheduleExplosion(b, 0.12 + Math.random() * 0.15);
  }
  const R = L.ragdoll;
  if (R && hitRagdoll > 0) {
    // push every part individually from the blast centre: looks great
    for (const part of R.parts) {
      const b = part.body;
      const dx = b.position.x - p.x, dy = b.position.y - p.y + 0.4, dz = b.position.z - p.z;
      const d = Math.max(0.3, Math.hypot(dx, dy, dz));
      const f = Math.max(0, 1 - d / radius);
      b.velocity.x += (dx / d) * power * f * 0.9;
      b.velocity.y += ((dy / d) * power * f + 6 * f) * 0.9;
      b.velocity.z += (dz / d) * power * f * 0.9;
    }
    R.knockdown(hitRagdoll);
    const pts = Math.round(80 + hitRagdoll * 420);
    L.onScore?.(pts, 'EXPLOSIÓN', R.chest.position);
  }
}

// ------------------------------------------------------------------ kinematic / animated
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

/** Kinematic compound body whose ORIGIN is the pivot. pose(t) -> {pos:[x,y,z], quat:THREE.Quaternion} */
export function kinematic(shapes, mesh, pose, { material = MAT.ground } = {}) {
  const body = new CANNON.Body({
    mass: 0, type: CANNON.Body.KINEMATIC, material,
    collisionFilterGroup: GROUP.STATIC, collisionFilterMask: MASK_ALL,
  });
  for (const s of shapes) body.addShape(s.shape, s.offset, s.orient);
  const p0 = pose(0);
  body.position.set(...p0.pos);
  body.quaternion.set(p0.quat.x, p0.quat.y, p0.quat.z, p0.quat.w);
  addBody(body);
  mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.body = body; } });
  addMesh(mesh);
  track(body, mesh);
  let t = 0;
  L.updaters.push((dt) => {
    // teleport to the exact pose at t, and set velocities that reach pose(t+dt)
    const cur = pose(t);
    t += dt;
    const nxt = pose(t);
    body.position.set(...cur.pos);
    body.quaternion.set(cur.quat.x, cur.quat.y, cur.quat.z, cur.quat.w);
    body.velocity.set((nxt.pos[0] - cur.pos[0]) / dt, (nxt.pos[1] - cur.pos[1]) / dt, (nxt.pos[2] - cur.pos[2]) / dt);
    _q.copy(nxt.quat).multiply(_q2.copy(cur.quat).invert());
    if (_q.w < 0) { _q.x = -_q.x; _q.y = -_q.y; _q.z = -_q.z; _q.w = -_q.w; }
    const s = Math.sqrt(Math.max(0, 1 - _q.w * _q.w));
    if (s > 1e-6) {
      const ang = 2 * Math.acos(Math.min(1, _q.w)) / dt;
      body.angularVelocity.set((_q.x / s) * ang, (_q.y / s) * ang, (_q.z / s) * ang);
    } else body.angularVelocity.set(0, 0, 0);
  });
  return body;
}

export { boxShape };

/** Spinning bar sweeping around a vertical post. */
export function spinner(center, length, height, speed, color = 0xf2c12e) {
  const g = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.BoxGeometry(length, 0.35, 0.35), new THREE.MeshStandardMaterial({ map: hazardTexture([6, 1]), roughness: 0.6 }));
  bar.position.y = height;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, height + 0.2, 16), stdMat(0x2d3038, { metalness: 0.5, roughness: 0.4 }));
  post.position.y = (height + 0.2) / 2 - 0.1;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.5, 16), stdMat(color, { metalness: 0.4, roughness: 0.4 }));
  hub.position.y = height;
  g.add(bar, post, hub);
  const axis = new THREE.Vector3(0, 1, 0);
  return kinematic([
    boxShape(length, 0.35, 0.35, [0, height, 0]),
    boxShape(0.6, height, 0.6, [0, height / 2, 0]),
  ], g, (t) => ({ pos: [center[0], center[1], center[2]], quat: new THREE.Quaternion().setFromAxisAngle(axis, t * speed) }));
}

/** Pendulum hammer swinging across the track (pivot at top). */
export function hammer(pivot, armLen, amp, freq, phase = 0, axis = new THREE.Vector3(0, 0, 1)) {
  const g = new THREE.Group();
  const rod = new THREE.Mesh(new THREE.BoxGeometry(0.16, armLen, 0.16), stdMat(0x2d3038, { metalness: 0.6, roughness: 0.3 }));
  rod.position.y = -armLen / 2;
  const headM = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.6, 20), new THREE.MeshStandardMaterial({ map: hazardTexture([3, 1]), roughness: 0.5, metalness: 0.2 }));
  headM.position.y = -armLen;
  headM.rotation.z = Math.PI / 2;
  if (Math.abs(axis.z) > 0.5) headM.rotation.set(0, 0, Math.PI / 2);
  else headM.rotation.set(Math.PI / 2, 0, 0);
  g.add(rod, headM);
  return kinematic([
    boxShape(0.16, armLen, 0.16, [0, -armLen / 2, 0]),
    Math.abs(axis.z) > 0.5 ? boxShape(1.6, 1.3, 1.3, [0, -armLen, 0]) : boxShape(1.3, 1.3, 1.6, [0, -armLen, 0]),
  ], g, (t) => ({ pos: pivot, quat: new THREE.Quaternion().setFromAxisAngle(axis, amp * Math.sin(t * freq * Math.PI * 2 + phase)) }));
}

/** Piston that punches out of a wall along dir. */
export function piston(base, dir, size, travel, freq, phase = 0) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ map: hazardTexture([2, 1]), roughness: 0.6 }));
  g.add(m);
  return kinematic([boxShape(...size)], g, (t) => {
    // sharp punch, slow retract
    const c = (t * freq + phase) % 1;
    const e = c < 0.15 ? c / 0.15 : c < 0.45 ? 1 : 1 - (c - 0.45) / 0.55;
    const k = e * e * (3 - 2 * e);
    return { pos: [base[0] + dir[0] * travel * k, base[1] + dir[1] * travel * k, base[2] + dir[2] * travel * k], quat: new THREE.Quaternion() };
  });
}

/** Free pendulum (dynamic) hanging from a static anchor. */
export function swingLog(anchor, len, size, mass, color = 0x8b5a2b) {
  const anchorBody = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC });
  anchorBody.position.set(...anchor);
  addBody(anchorBody);
  const mesh = new THREE.Group();
  const log = new THREE.Mesh(new THREE.CylinderGeometry(size[0], size[0], size[1], 18), stdMat(color, { roughness: 0.9 }));
  log.rotation.z = Math.PI / 2;
  const rope1 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 6), stdMat(0x3a2f25));
  rope1.position.set(size[1] * 0.35, len / 2, 0);
  const rope2 = rope1.clone(); rope2.position.x = -size[1] * 0.35;
  mesh.add(log, rope1, rope2);
  const q = new CANNON.Quaternion().setFromEuler(0, 0, Math.PI / 2);
  const b = dynamicBody([{ shape: new CANNON.Cylinder(size[0], size[0], size[1], 12), orient: q }], [anchor[0], anchor[1] - len, anchor[2]], mass, mesh, { sleep: false, angularDamping: 0.3, linearDamping: 0.01 });
  const hinge = new CANNON.HingeConstraint(anchorBody, b, {
    pivotA: new CANNON.Vec3(0, 0, 0), axisA: new CANNON.Vec3(1, 0, 0),
    pivotB: new CANNON.Vec3(0, len, 0), axisB: new CANNON.Vec3(1, 0, 0),
  });
  world.addConstraint(hinge); L.constraints.push(hinge);
  impactSound(b, 0.5);
  return b;
}

export function seesaw(pos, length = 6, color = 0x4f86c6) {
  const baseMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.0, 0.6, 0.9, 4), stdMat(0x3a3d45));
  baseMesh.position.set(pos[0], pos[1] + 0.45, pos[2]);
  baseMesh.castShadow = true;
  addMesh(baseMesh);
  const anchorBody = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC });
  anchorBody.position.set(pos[0], pos[1] + 0.95, pos[2]);
  addBody(anchorBody);
  const plank = new THREE.Mesh(new THREE.BoxGeometry(length, 0.16, 1.2), stdMat(color, { roughness: 0.5 }));
  const b = dynamicBody([boxShape(length, 0.16, 1.2)], [pos[0], pos[1] + 1.05, pos[2]], 40, plank, { sleep: false });
  const hinge = new CANNON.HingeConstraint(anchorBody, b, {
    pivotA: new CANNON.Vec3(0, 0, 0), axisA: new CANNON.Vec3(0, 0, 1),
    pivotB: new CANNON.Vec3(0, -0.1, 0), axisB: new CANNON.Vec3(0, 0, 1),
  });
  world.addConstraint(hinge); L.constraints.push(hinge);
  return b;
}

// ------------------------------------------------------------------ triggers
/** Axis-aligned trigger volume. kind: 'pad' | 'finish' | 'checkpoint' */
export function trigger(center, half, onEnter, { cooldown = 1, props = false } = {}) {
  const tr = { min: new THREE.Vector3(center[0] - half[0], center[1] - half[1], center[2] - half[2]), max: new THREE.Vector3(center[0] + half[0], center[1] + half[1], center[2] + half[2]), onEnter, cooldown, last: new Map(), props };
  L.triggers.push(tr);
  return tr;
}

export function launchPad(pos, vel, color = 0x37e3a0) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 0.2, 28), stdMat(0x2d3038, { metalness: 0.4, roughness: 0.4 }));
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.06, 28), stdMat(color, { emissive: color, emissiveIntensity: 1.4 }));
  glow.position.y = 0.12;
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.5, 4), stdMat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.6 }));
  arrow.position.y = 0.5;
  const dirH = Math.hypot(vel[0], vel[2]);
  arrow.rotation.x = Math.atan2(dirH, vel[1]);
  const wrap = new THREE.Group(); wrap.add(arrow);
  wrap.rotation.y = Math.atan2(vel[0], vel[2]);
  g.add(base, glow, wrap);
  g.position.set(pos[0], pos[1] + 0.1, pos[2]);
  addMesh(g);
  L.updaters.push((dt) => { arrow.position.y = 0.5 + Math.sin(L.time * 5) * 0.12; });
  staticBox([2.2, 0.2, 2.2], [pos[0], pos[1] + 0.1, pos[2]], { visible: false });
  trigger([pos[0], pos[1] + 0.8, pos[2]], [1.0, 0.7, 1.0], (who) => {
    sfx.whoosh();
    fx.sparks(new THREE.Vector3(pos[0], pos[1] + 0.3, pos[2]), 14);
    if (who === 'ragdoll') {
      const R = L.ragdoll;
      const com = R.comVelocity(new THREE.Vector3());
      R.addVelocity(vel[0] - com.x, vel[1] - com.y, vel[2] - com.z, 3);
      R.goFall('launch');
    } else {
      who.wakeUp();
      who.velocity.set(vel[0], vel[1], vel[2]);
    }
  }, { cooldown: 1.2, props: true });
}

export function trampoline(pos, size = [3, 3]) {
  const frame = new THREE.Mesh(new THREE.CylinderGeometry(size[0] / 2 + 0.15, size[0] / 2 + 0.15, 0.5, 32), stdMat(0x2b2e36, { metalness: 0.3 }));
  frame.position.set(pos[0], pos[1] + 0.25, pos[2]); frame.castShadow = true; frame.receiveShadow = true;
  const mat = new THREE.Mesh(new THREE.CylinderGeometry(size[0] / 2, size[0] / 2, 0.52, 32), stdMat(0x1f6fff, { roughness: 0.4 }));
  mat.position.copy(frame.position); mat.position.y += 0.01;
  addMesh(frame); addMesh(mat);
  staticBox([size[0], 0.5, size[1]], [pos[0], pos[1] + 0.25, pos[2]], { visible: false, material: MAT.bouncy });
  trigger([pos[0], pos[1] + 0.9, pos[2]], [size[0] / 2, 0.5, size[1] / 2], (who) => {
    if (who === 'ragdoll') {
      const R = L.ragdoll;
      const com = R.comVelocity(new THREE.Vector3());
      if (com.y < -1) { R.addVelocity(0, Math.min(16, -com.y * 0.6 + 7) - com.y * 0.0, 0, 2); R.goFall('bounce'); sfx.whoosh(); }
    }
  }, { cooldown: 0.4 });
}

export function flag(pos, color = 0xff4d3a) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 8), stdMat(0xdddddd, { metalness: 0.6 }));
  pole.position.set(pos[0], pos[1] + 2, pos[2]);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9, 8, 4), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.8 }));
  cloth.position.set(pos[0] + 0.7, pos[1] + 3.45, pos[2]);
  addMesh(pole); addMesh(cloth);
  const base = cloth.geometry.attributes.position.array.slice();
  L.updaters.push(() => {
    const a = cloth.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) {
      const x = base[i * 3];
      a.array[i * 3 + 2] = Math.sin(L.time * 6 + x * 3) * 0.12 * (x + 0.7);
    }
    a.needsUpdate = true;
  });
}

export function decoMesh(mesh) { addMesh(mesh); return mesh; }

// ------------------------------------------------------------------ per-step & per-frame
export function stepLevel(dt) {
  L.time += dt;
  for (const u of L.updaters) u(dt, L.time);
  for (let i = L.pendingExplosions.length - 1; i >= 0; i--) {
    const e = L.pendingExplosions[i];
    e.t -= dt;
    if (e.t <= 0) {
      L.pendingExplosions.splice(i, 1);
      if (e.body.world) {
        const p = e.body.position.clone();
        removeBody(e.body);
        explode(p, 6.5, 22);
      }
    }
  }
}

const _tp = new THREE.Vector3();
export function checkTriggers() {
  const R = L.ragdoll;
  for (const tr of L.triggers) {
    // ragdoll: any of pelvis / feet inside
    let inside = false;
    for (const name of ['pelvis', 'footL', 'footR', 'chest']) {
      const p = R.partMap[name].body.position;
      _tp.set(p.x, p.y, p.z);
      if (_tp.x > tr.min.x && _tp.x < tr.max.x && _tp.y > tr.min.y && _tp.y < tr.max.y && _tp.z > tr.min.z && _tp.z < tr.max.z) { inside = true; break; }
    }
    if (inside) fire(tr, 'ragdoll');
    if (tr.props) {
      for (const b of L.props) {
        const p = b.position;
        if (p.x > tr.min.x && p.x < tr.max.x && p.y > tr.min.y && p.y < tr.max.y && p.z > tr.min.z && p.z < tr.max.z) fire(tr, b);
      }
    }
  }
  // despawn old projectiles / fallen stuff
  for (let i = L.projectiles.length - 1; i >= 0; i--) {
    const b = L.projectiles[i];
    if (L.time - b.userData.born > 20 || b.position.y < -60) removeBody(b);
  }
  for (let i = L.props.length - 1; i >= 0; i--) {
    if (L.props[i].position.y < -80) removeBody(L.props[i]);
  }
}

function fire(tr, who) {
  const last = tr.last.get(who) || -99;
  if (L.time - last < tr.cooldown) return;
  tr.last.set(who, L.time);
  tr.onEnter(who);
}

export function isSynced(b) { return synced.some((s) => s.body === b); }
