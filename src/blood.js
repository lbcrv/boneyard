import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { world, GROUP } from './physics.js';
import * as fluid from './bloodfluid.js';

/*
 * Optional blood. Off by default; the player turns it on in the menu (or B).
 *
 * Wounds have a severity:
 *   minor  - blunt trauma: a stain soaks into the surface, nothing more
 *   open   - a bullet hole or a compound fracture: bleeds, drips for a while
 *   severe - head/neck/artery shots, amputations: pulsing jets in time with
 *            the heartbeat, and a pool once the body lies still
 *
 * - On the body: the part's material paints blood on the surface (shader), so
 *   it wraps around curved limbs, soaks outward and trickles downward.
 * - On flat fixed ground: a real liquid (bloodfluid.js). Drops land in it,
 *   merge, spread into puddles, get stepped in (bloody footprints) and smeared
 *   by bodies dragged through them.
 * - On walls, props and anything that moves: splash decals. Before placing
 *   one, rays check there is surface under its whole outline, so nothing
 *   overhangs an edge; on a moving body the decal is attached and travels
 *   with it. Big splashes on walls run down in drips.
 */

let enabled = false;
let scene;
let drops;
const splatSets = [];   // { mesh, cursor, count, attached: Map }
let runners;
const MAX_DROPS = 700, MAX_SPLATS_EACH = 150, MAX_RUNNERS = 60, MAX_STAINS = 8;
const dropItems = [];
let dropCursor = 0;
const runList = [];
let runCursor = 0;
const stained = new Set();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const ray = new CANNON.RaycastResult();
const rf = new CANNON.Vec3(), rt = new CANNON.Vec3();
const RAY = { collisionFilterMask: GROUP.STATIC | GROUP.PROP | GROUP.VEHICLE, skipBackfaces: true };

// ------------------------------------------------------------------ textures (metaballs)
function rnd(a, b) { return a + Math.random() * (b - a); }

function liquidTexture(kind, size = 256) {
  const balls = [];
  const c = size / 2;
  if (kind === 'pool') {
    balls.push([c, c, rnd(34, 42)]);
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2, d = rnd(20, 62);
      balls.push([c + Math.cos(a) * d, c + Math.sin(a) * d, rnd(12, 30)]);
    }
  } else if (kind === 'drip') {
    // a run down a wall: wide where it started, thinning, a bead at the end
    const x = c + rnd(-4, 4);
    for (let y = 18; y < size - 30; y += 5) {
      const k = y / size;
      balls.push([x + Math.sin(y * 0.05) * 2, y, 9 * (1 - k) + 3]);
    }
    balls.push([x, size - 26, 10]);
  } else if (kind === 'drops') {
    for (let i = 0; i < 16; i++) balls.push([rnd(30, size - 30), rnd(30, size - 30), rnd(3, 9)]);
  } else {
    balls.push([c, c, rnd(30, 38)]);
    for (let i = 0; i < 5; i++) balls.push([c + rnd(-16, 16), c + rnd(-16, 16), rnd(14, 22)]);
    const rays = 7 + ((Math.random() * 5) | 0);
    for (let i = 0; i < rays; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = rnd(45, 105);
      const r = rnd(3, 8);
      for (let k = 0.45; k < 1; k += 0.12) balls.push([c + Math.cos(a) * d * k, c + Math.sin(a) * d * k, r * (1.25 - k) + 1.5]);
      balls.push([c + Math.cos(a) * d, c + Math.sin(a) * d, r]);
    }
  }
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let f = 0;
      for (const [bx, by, r] of balls) {
        const dx = x - bx, dy = y - by;
        f += (r * r) / (dx * dx + dy * dy + 1);
      }
      const a = Math.min(1, Math.max(0, (f - 0.85) / 0.3));
      const depth = Math.min(1, Math.max(0, (f - 1) / 3));
      const shade = 0.8 + 0.2 * depth;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(shade * 255);
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function wetMaterial(tex, offset) {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff, map: tex, transparent: true, depthWrite: false,
    roughness: 0.08, metalness: 0.15,
    polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset,
  });
}

function instanced(geo, mat, n) {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  m.frustumCulled = false;
  m.count = 0;
  m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------------ init / toggle
export function initBlood(s, renderer = null) {
  scene = s;
  try { enabled = localStorage.getItem('boneyard.blood') === '1'; } catch { enabled = false; }
  drops = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.1 }), MAX_DROPS);
  drops.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DROPS * 3), 3);
  drops.frustumCulled = false; drops.count = 0;
  for (let i = 0; i < MAX_DROPS; i++) dropItems.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: 0, life: 0, color: new THREE.Color() });
  const plane = new THREE.PlaneGeometry(1, 1);
  for (const kind of ['splash', 'splash', 'splash', 'drops']) {
    splatSets.push({ mesh: instanced(plane, wetMaterial(liquidTexture(kind), -2), MAX_SPLATS_EACH), cursor: 0, count: 0, kind, attached: new Map() });
  }
  const drip = new THREE.PlaneGeometry(1, 1).translate(0, -0.5, 0); // hangs from its top edge
  runners = instanced(drip, wetMaterial(liquidTexture('drip', 128), -2), MAX_RUNNERS);
  scene.add(drops, runners, ...splatSets.map((s2) => s2.mesh));
  fluid.initFluid(s, renderer);
}

export function isBloodOn() { return enabled; }
export function setBlood(on) {
  enabled = on;
  try { localStorage.setItem('boneyard.blood', on ? '1' : '0'); } catch { /* ignore */ }
  if (!on) clearBlood();
}

/** Remove every drop, splash, pool and body stain (map change, respawn). */
export function clearBlood() {
  for (const d of dropItems) d.alive = false;
  drops.count = 0;
  for (const st of splatSets) { st.mesh.count = 0; st.count = 0; st.cursor = 0; st.attached.clear(); }
  runList.length = 0; runners.count = 0; runCursor = 0;
  fluid.clearFluid();
  for (const part of stained) clearPart(part);
  stained.clear();
}

// linear RGB: dark maroon, not paint red
function bloodColor(out, dark = 1) {
  return out.setRGB((0.11 + Math.random() * 0.05) * dark, 0.002 * dark, 0.005 * dark);
}

// ------------------------------------------------------------------ surface checks
function tangents(n, a, b) {
  a.set(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0).cross(n).normalize();
  b.crossVectors(n, a).normalize();
}

/**
 * Largest radius (<= want) for which the surface under point continues all
 * round the outline, on the same body and in the same plane. 0 = no room.
 */
function fitRadius(point, normal, body, want) {
  tangents(normal, _t1, _t2);
  for (const k of [1, 0.7, 0.45, 0.25]) {
    const r = want * k;
    let ok = true;
    for (let i = 0; i < 6 && ok; i++) {
      const a = (i / 6) * Math.PI * 2;
      const ox = (_t1.x * Math.cos(a) + _t2.x * Math.sin(a)) * r;
      const oy = (_t1.y * Math.cos(a) + _t2.y * Math.sin(a)) * r;
      const oz = (_t1.z * Math.cos(a) + _t2.z * Math.sin(a)) * r;
      rf.set(point.x + ox + normal.x * 0.04, point.y + oy + normal.y * 0.04, point.z + oz + normal.z * 0.04);
      rt.set(point.x + ox - normal.x * 0.05, point.y + oy - normal.y * 0.05, point.z + oz - normal.z * 0.05);
      ray.reset();
      if (!world.raycastClosest(rf, rt, RAY, ray) || ray.body !== body || Math.abs(ray.distance - 0.04) > 0.025) ok = false;
    }
    if (ok) return r;
  }
  return 0;
}

// ------------------------------------------------------------------ body staining (shader)
const STAIN_DECL = /* glsl */`
uniform vec4 uBlood[${MAX_STAINS}];
uniform int uBloodN;
varying vec3 vBW;
varying vec3 vBO;
float bHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float bNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(bHash(i), bHash(i + vec3(1,0,0)), f.x), mix(bHash(i + vec3(0,1,0)), bHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(bHash(i + vec3(0,0,1)), bHash(i + vec3(1,0,1)), f.x), mix(bHash(i + vec3(0,1,1)), bHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float bloodMask() {
  if (uBloodN == 0) return 0.0;
  float n = bNoise(vBO * 40.0) * 0.6 + bNoise(vBO * 110.0) * 0.4;
  float m = 0.0;
  for (int i = 0; i < ${MAX_STAINS}; i++) {
    if (i >= uBloodN) break;
    vec3 d = vBW - uBlood[i].xyz;
    float r = uBlood[i].w;
    float soak = 1.0 - smoothstep(0.5, 1.0, length(d) / r + (n - 0.5) * 0.7);
    float below = -d.y;
    float lateral = length(d.xz);
    float run = (1.0 - smoothstep(r * 0.12, r * 0.3 * (0.6 + n), lateral))
              * smoothstep(-0.005, 0.01, below)
              * (1.0 - smoothstep(r * 0.6, r * 2.8 * (0.6 + n * 0.8), below));
    m = max(m, max(soak, run * 0.85));
  }
  return clamp(m, 0.0, 1.0);
}
`;

export function makeStainable(material, part) {
  const u = {
    uBlood: { value: Array.from({ length: MAX_STAINS }, () => new THREE.Vector4()) },
    uBloodN: { value: 0 },
  };
  part.stainU = u;
  part.stains = [];
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBlood = u.uBlood;
    shader.uniforms.uBloodN = u.uBloodN;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBW;\nvarying vec3 vBO;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBO = transformed;\nvBW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + STAIN_DECL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float bm = bloodMask();
        vec3 bcol = mix(vec3(0.09, 0.002, 0.005), vec3(0.24, 0.006, 0.01), bNoise(vBO * 70.0) * 0.6 + bm * 0.3);
        diffuseColor.rgb = mix(diffuseColor.rgb, bcol, bm * 0.96);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.1, bm);`);
  };
  material.customProgramCacheKey = () => 'boneyard-stain';
}

function clearPart(part) {
  if (!part.stains) return;
  part.stains.length = 0;
  part.stainU.uBloodN.value = 0;
  part.wounds = 0;
}

/** Outward normal of a segment's surface at a local point. */
function localNormal(part, lp) {
  const d = part.def;
  const n = new THREE.Vector3().copy(lp);
  if (d.kind === 'limb') n.y = 0;
  else if (d.kind === 'box') {
    const he = d.he;
    const ax = Math.abs(lp.x) / he[0], ay = Math.abs(lp.y) / he[1], az = Math.abs(lp.z) / he[2];
    if (ax >= ay && ax >= az) n.set(Math.sign(lp.x) || 1, 0, 0);
    else if (ay >= az) n.set(0, Math.sign(lp.y) || 1, 0);
    else n.set(0, 0, Math.sign(lp.z) || 1);
  }
  if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
  return n.normalize();
}

const SEVERITY = { minor: 0, open: 1, severe: 2 };

/**
 * Open a wound. severity: 'minor' | 'open' | 'severe'.
 * local: optional point in the part's frame (amputation stumps), normal too.
 */
export function wound(part, worldPoint, size = 0.02, severity = 'open', local = null, normal = null) {
  if (!enabled || !part.stains) return;
  let lp;
  if (local) lp = local.clone();
  else {
    const l = part.body.pointToLocalFrame(new CANNON.Vec3(worldPoint.x, worldPoint.y, worldPoint.z), new CANNON.Vec3());
    lp = new THREE.Vector3(l.x, l.y, l.z);
  }
  const sev = SEVERITY[severity] ?? 1;
  const r = (sev === 0 ? 0.03 : 0.04) + size * 2.4;
  const bleed = sev === 0 ? 0 : sev === 1 ? 6 + Math.random() * 6 : 18 + Math.random() * 10;
  for (const st of part.stains) {
    if (st.local.distanceTo(lp) < st.r * 0.8) {
      st.r = Math.min(0.16, st.r + r * 0.3);
      st.sev = Math.max(st.sev, sev);
      st.bleed = Math.max(st.bleed, bleed);
      stained.add(part);
      return;
    }
  }
  if (part.stains.length >= MAX_STAINS) part.stains.shift();
  part.stains.push({ local: lp, normal: normal ? normal.clone() : localNormal(part, lp), r, cur: r * 0.3, sev, bleed, beat: Math.random(), jetT: 0 });
  part.wounds = part.stains.length;
  stained.add(part);
}

export function clearWoundsOf(rag) {
  for (const part of [...stained]) {
    if (part.body.userData.ragdoll === rag) { clearPart(part); stained.delete(part); }
  }
}

// ------------------------------------------------------------------ droplets, splashes, pools
export function spray(point, dir, amount = 8, speed = 3, spread = 0.9) {
  if (!enabled) return;
  for (let i = 0; i < amount; i++) {
    const d = dropItems[dropCursor];
    dropCursor = (dropCursor + 1) % MAX_DROPS;
    d.alive = true;
    d.pos.copy(point);
    d.vel.set(dir.x + (Math.random() - 0.5) * spread, dir.y + (Math.random() - 0.3) * spread * 0.7, dir.z + (Math.random() - 0.5) * spread)
      .normalize().multiplyScalar(speed * (0.55 + Math.random() * 0.6));
    d.size = 0.006 + Math.random() * 0.012;
    d.life = 3;
    bloodColor(d.color);
  }
}

export function splat(point, normal, size, kind = null, body = null, vel = null) {
  if (!enabled) return;
  const want = size * 0.5;
  const r = body ? fitRadius(point, normal, body, want) : want;
  if (r < 0.012) return;
  const set = kind === 'drops' ? splatSets[3] : splatSets[(Math.random() * 3) | 0];
  _n.copy(normal).normalize();
  _q.setFromUnitVectors(Z, _n);
  // stretched along the direction the blood was travelling when it hit
  let stretch = 1;
  let ang = Math.random() * Math.PI * 2;
  if (vel) {
    _t1.copy(vel).addScaledVector(_n, -vel.dot(_n));
    const vt = _t1.length();
    if (vt > 0.6) {
      _t1.multiplyScalar(1 / vt);
      _t2.set(1, 0, 0).applyQuaternion(_q);
      ang = Math.atan2(_v3.crossVectors(_t2, _t1).dot(_n), _t2.dot(_t1));
      stretch = 1 + Math.min(1.6, vt * 0.22);
    }
  }
  _q.premultiply(_q2.setFromAxisAngle(_n, ang));
  _p.copy(point).addScaledVector(_n, 0.003 + (set.cursor % 9) * 0.0004);
  _s.set(r * 2 * stretch, r * 2 * (0.8 + Math.random() * 0.2) / Math.sqrt(stretch), 1);
  _m.compose(_p, _q, _s);
  const idx = set.cursor;
  set.mesh.setMatrixAt(idx, _m);
  set.mesh.setColorAt(idx, bloodColor(_c, 0.8 + Math.random() * 0.3));
  // anything that moves carries its blood with it
  if (body && body.type !== CANNON.Body.STATIC) {
    const bodyM = _m2.compose(_t1.set(body.position.x, body.position.y, body.position.z), _q2.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w), _s.set(1, 1, 1));
    set.attached.set(idx, { body, local: bodyM.clone().invert().multiply(_m) });
  } else set.attached.delete(idx);
  set.cursor = (set.cursor + 1) % MAX_SPLATS_EACH;
  set.count = Math.min(MAX_SPLATS_EACH, set.count + 1);
  set.mesh.count = set.count;
  set.mesh.instanceMatrix.needsUpdate = true;
  set.mesh.instanceColor.needsUpdate = true;
  // a big splash on a wall runs down it
  if (body && body.type === CANNON.Body.STATIC && Math.abs(_n.y) < 0.6 && r > 0.04) addRunner(point, _n, body, r);
}

const _v3 = new THREE.Vector3();
const _down = new THREE.Vector3();
function addRunner(point, n, body, r) {
  _down.set(0, -1, 0).addScaledVector(n, n.y).normalize();
  // how far down the wall continues
  let maxLen = 0;
  for (const L of [0.7, 0.45, 0.25, 0.12]) {
    const x = point.x + _down.x * L, y = point.y + _down.y * L, z = point.z + _down.z * L;
    rf.set(x + n.x * 0.04, y + n.y * 0.04, z + n.z * 0.04); rt.set(x - n.x * 0.05, y - n.y * 0.05, z - n.z * 0.05);
    ray.reset();
    if (world.raycastClosest(rf, rt, RAY, ray) && ray.body === body) { maxLen = L; break; }
  }
  if (maxLen < 0.1) return;
  const run = runList.length >= MAX_RUNNERS ? runList.shift() : {};
  run.idx = runCursor;
  runCursor = (runCursor + 1) % MAX_RUNNERS;
  run.pos = point.clone().addScaledVector(n, 0.0035);
  // plane: +Z out of the wall, -Y down the wall
  const yAx = _down.clone().negate();
  const xAx = new THREE.Vector3().crossVectors(yAx, n).normalize();
  run.q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAx, yAx, n));
  run.w = Math.min(0.05, r * 0.45) * (0.7 + Math.random() * 0.5);
  run.len = 0.01;
  run.max = maxLen * (0.45 + Math.random() * 0.55) * Math.min(1, r * 8);
  run.v = 0.22 + Math.random() * 0.2;
  run.tint = 0.75 + Math.random() * 0.3;
  run.drawn = false;
  runList.push(run);
}

/** A pool of blood at a point on the floor (explosions, gibs). */
export function pool(point, size) {
  if (!enabled) return;
  rf.set(point.x, point.y + 0.2, point.z); rt.set(point.x, point.y - 0.3, point.z);
  ray.reset();
  if (world.raycastClosest(rf, rt, RAY, ray) && fluid.isFloor(ray.body, ray.hitNormalWorld)) {
    const hp = ray.hitPointWorld;
    fluid.deposit(new THREE.Vector3(hp.x, hp.y, hp.z), size * 40);
  }
}

/** A foot coming down: picks blood up from a puddle, or prints what it carries. */
export function footstep(rag, S) {
  if (!enabled) return;
  const foot = rag.partMap['foot' + S];
  if (!foot || !rag.attached('foot' + S)) return;
  const b = foot.body;
  rf.set(b.position.x, b.position.y + 0.05, b.position.z); rt.set(b.position.x, b.position.y - 0.15, b.position.z);
  ray.reset();
  if (!world.raycastClosest(rf, rt, RAY, ray) || !fluid.isFloor(ray.body, ray.hitNormalWorld)) return;
  const y = ray.hitPointWorld.y;
  const load = rag.bloodFeet || (rag.bloodFeet = { L: 0, R: 0 });
  _t1.set(0, 0, 1).applyQuaternion(_q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w));
  const yaw = Math.atan2(_t1.x, _t1.z);
  const wet = fluid.sample(b.position.x, y, b.position.z, 0.09);
  if (wet > 0.08) {
    // stepped in it: the sole soaks up blood, the puddle gets a dent
    load[S] = 1;
    fluid.take(b.position.x, y, b.position.z, 0.25, 0.07);
    wound(foot, new THREE.Vector3(b.position.x, b.position.y - 0.03, b.position.z), 0.01, 'minor');
    if (Math.random() < 0.6) spray(new THREE.Vector3(b.position.x, y + 0.02, b.position.z), new THREE.Vector3(0, 1, 0), 3, 1.1, 1.6);
    return;
  }
  if (load[S] < 0.05) return;
  fluid.stamp(b.position.x, y, b.position.z, yaw, 0.125, 0.052, 0.32 * load[S], SOLE);
  load[S] *= 0.72;
}

// sole print: heel pad and the ball of the foot, a thin strip at the outer arch
function SOLE(f, s) {
  const heel = 1 - ((f + 0.62) / 0.36) ** 2 - (s / 0.72) ** 2;
  const ball = 1 - ((f - 0.3) / 0.62) ** 2 - (s / 0.98) ** 2;
  const arch = 1 - ((f + 0.15) / 0.3) ** 2 - ((s + 0.45) / 0.5) ** 2;
  return Math.max(heel, ball, arch * 0.6) * (0.6 + Math.random() * 0.6);
}

const _wp = new CANNON.Vec3();
const _wn = new CANNON.Vec3();
let poolScanT = 0;
let smearT = 0;

export function update(dt, ragdolls = []) {
  if (!enabled) return;

  // droplets
  let n = 0;
  for (const d of dropItems) {
    if (!d.alive) continue;
    d.life -= dt;
    if (d.life <= 0) { d.alive = false; continue; }
    const px = d.pos.x, py = d.pos.y, pz = d.pos.z;
    d.vel.y -= 12.5 * dt;
    d.pos.addScaledVector(d.vel, dt);
    rf.set(px, py, pz); rt.set(d.pos.x, d.pos.y - 0.01, d.pos.z);
    ray.reset();
    if (world.raycastClosest(rf, rt, RAY, ray)) {
      d.alive = false;
      const sp = ray.hitPointWorld, nn = ray.hitNormalWorld;
      const fast = d.vel.length() > 3;
      if (fluid.isFloor(ray.body, nn)) fluid.deposit(_p.set(sp.x, sp.y, sp.z), 0.12 + d.size * 14, d.vel);
      else if (Math.random() < 0.4) splat(new THREE.Vector3(sp.x, sp.y, sp.z), new THREE.Vector3(nn.x, nn.y, nn.z), fast ? 0.07 + d.size * 8 : 0.03 + d.size * 4, fast ? null : 'drops', ray.body, d.vel);
      continue;
    }
    _n.copy(d.vel).normalize();
    _q.setFromUnitVectors(UP, _n);
    _s.set(d.size, d.size * (1 + Math.min(2.5, d.vel.length() * 0.25)), d.size);
    _m.compose(d.pos, _q, _s);
    drops.setMatrixAt(n, _m);
    drops.setColorAt(n, d.color);
    n++;
  }
  drops.count = n;
  drops.instanceMatrix.needsUpdate = true;
  if (drops.instanceColor) drops.instanceColor.needsUpdate = true;

  // splats stuck to moving things follow them
  for (const set of splatSets) {
    if (!set.attached.size) continue;
    for (const [idx, a] of set.attached) {
      const b = a.body;
      if (!b.world) { set.attached.delete(idx); _m.makeScale(0, 0, 0); set.mesh.setMatrixAt(idx, _m); continue; }
      _m2.compose(_t1.set(b.position.x, b.position.y, b.position.z), _q2.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w), _s.set(1, 1, 1));
      _m.multiplyMatrices(_m2, a.local);
      set.mesh.setMatrixAt(idx, _m);
    }
    set.mesh.instanceMatrix.needsUpdate = true;
  }

  // body stains: soak, push to the shader, drip, and pulse jets on severe wounds
  for (const part of stained) {
    const b = part.body;
    const u = part.stainU;
    part.stains.forEach((st, i) => {
      if (st.bleed > 0) st.bleed -= dt;
      if (st.cur < st.r) st.cur = Math.min(st.r, st.cur + dt * st.r * (st.bleed > 0 ? 0.35 : 0.08));
      _wp.set(st.local.x, st.local.y, st.local.z);
      b.pointToWorldFrame(_wp, _wp);
      u.uBlood.value[i].set(_wp.x, _wp.y, _wp.z, st.cur);
      if (st.bleed <= 0 || st.sev === 0) return;
      if (st.sev === 2) {
        // arterial: a jet every heartbeat (~1.4 Hz), weakening as the blood runs out
        st.beat += dt * 1.4;
        const phase = st.beat % 1;
        const strength = Math.min(1, st.bleed / 12);
        if (phase < 0.22) {
          st.jetT -= dt;
          if (st.jetT <= 0) {
            st.jetT = 0.018;
            _wn.set(st.normal.x, st.normal.y, st.normal.z);
            b.vectorToWorldFrame(_wn, _wn);
            const pulse = Math.sin((phase / 0.22) * Math.PI);
            spray(_p.set(_wp.x, _wp.y, _wp.z), _n.set(_wn.x, _wn.y, _wn.z), 2, (1.6 + 3.2 * pulse) * (0.4 + 0.6 * strength), 0.25);
          }
        }
      } else {
        st.jetT -= dt;
        if (st.jetT <= 0) {
          st.jetT = 0.15 + Math.random() * 0.4;
          spray(_p.set(_wp.x, _wp.y - 0.02, _wp.z), _n.set(0, -1, 0), 1, 0.3);
        }
      }
    });
    u.uBloodN.value = part.stains.length;
  }

  // pools only under still bodies with a severe wound still bleeding
  poolScanT -= dt;
  if (poolScanT <= 0) {
    poolScanT = 0.2;
    for (const rag of ragdolls) {
      for (const part of rag.parts) {
        if (!part.stains) continue;
        let flow = 0;
        for (const st of part.stains) if (st.sev === 2 && st.bleed > 0) flow += Math.min(1, st.bleed / 12);
        if (flow <= 0) continue;
        const b = part.body;
        if (b.velocity.lengthSquared() > 0.25) continue;
        rf.set(b.position.x, b.position.y + 0.05, b.position.z);
        rt.set(b.position.x, b.position.y - 0.45, b.position.z);
        ray.reset();
        if (!world.raycastClosest(rf, rt, RAY, ray)) continue;
        const sp = ray.hitPointWorld, nn = ray.hitNormalWorld;
        if (fluid.isFloor(ray.body, nn)) fluid.deposit(_p.set(sp.x + (Math.random() - 0.5) * 0.04, sp.y, sp.z + (Math.random() - 0.5) * 0.04), 0.9 * flow);
      }
    }
  }

  // runs down walls
  if (runList.length) {
    let changed = false;
    for (const run of runList) {
      if (run.len >= run.max && run.drawn) continue;
      run.len = Math.min(run.max, run.len + run.v * dt);
      run.v *= 1 - dt * 0.6;
      if (run.v < 0.02) run.max = run.len;
      _s.set(run.w, run.len, 1);
      _m.compose(run.pos, run.q, _s);
      runners.setMatrixAt(run.idx, _m);
      runners.setColorAt(run.idx, _c.setRGB(0.12 * run.tint, 0.002, 0.005));
      run.drawn = true;
      changed = true;
    }
    if (changed) {
      let top = 0;
      for (const r of runList) top = Math.max(top, r.idx + 1);
      runners.count = Math.max(runners.count, top);
      runners.instanceMatrix.needsUpdate = true;
      if (runners.instanceColor) runners.instanceColor.needsUpdate = true;
    }
  }

  // bodies on the floor: bleeding or bloodied parts smear it, puddles soak them
  smearT -= dt;
  if (smearT <= 0) {
    smearT = 0.1;
    for (const rag of ragdolls) {
      for (const part of rag.parts) {
        if (part.def.foot || !part.stains) continue;
        const b = part.body;
        let bleeding = false;
        for (const st of part.stains) if (st.sev > 0 && st.bleed > 0) bleeding = true;
        if (bleeding) part.bloodWet = 1;
        rf.set(b.position.x, b.position.y, b.position.z);
        rt.set(b.position.x, b.position.y - part.bbr - 0.06, b.position.z);
        ray.reset();
        if (!world.raycastClosest(rf, rt, RAY, ray) || !fluid.isFloor(ray.body, ray.hitNormalWorld)) continue;
        if (ray.distance > part.bbr + 0.04) continue;
        const hp = ray.hitPointWorld;
        // lying in a puddle soaks the part that touches it
        const wet = fluid.sample(hp.x, hp.y, hp.z, Math.min(0.08, part.bbr * 0.6));
        if (wet > 0.1) {
          part.bloodWet = 1;
          if ((part.soakT || -9) < rag.time - 0.8) {
            part.soakT = rag.time;
            wound(part, new THREE.Vector3(hp.x, hp.y + 0.01, hp.z), 0.012, 'minor');
          }
        }
        const sp = Math.hypot(b.velocity.x, b.velocity.z);
        if (!part.bloodWet || part.bloodWet < 0.05 || sp < 0.35) continue;
        const yaw = Math.atan2(b.velocity.x, b.velocity.z);
        const len = Math.max(part.bbr * 0.5, sp * 0.06);
        fluid.stamp(hp.x - b.velocity.x * 0.05, hp.y, hp.z - b.velocity.z * 0.05, yaw, len, part.bbr * 0.55, 0.16 * part.bloodWet);
        if (!bleeding) part.bloodWet *= 1 - Math.min(0.5, sp * 0.06);
      }
    }
  }

  fluid.updateFluid(dt);
}
