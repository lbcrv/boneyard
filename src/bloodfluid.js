import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { world, GROUP } from './physics.js';

/*
 * Blood on fixed surfaces as a liquid, not as stickers.
 *
 * Any flat static surface (floor, wall, ramp, step) is covered lazily, only
 * where blood lands, by tiles of a fine grid laid in the plane of that
 * surface. Each cell holds a thickness. Every tick:
 * - liquid above a thin film thickness flows to its neighbours, so drops that
 *   land close together merge and a steady source grows a puddle that spreads
 *   and slows down on its own;
 * - on anything that is not level, gravity pulls the excess downhill: blood
 *   on a wall runs down in streaks that leave a film behind, and drips off
 *   the bottom edge;
 * - a cell only takes liquid once a ray has confirmed there is surface under
 *   it in that plane, so nothing hangs over an edge.
 * Each tile is drawn from its grid: soft noisy outline, darker where deep,
 * and a glossy surface whose normal comes from the thickness gradient, so it
 * catches the light like real liquid. Old blood slowly dries dark brown.
 */

const TILE = 3;                 // metres per tile side
const RES = 96;                 // cells per side (3.1 cm)
const CELL = TILE / RES;
const MAX_TILES = 28;
const FILM = 0.12;              // a puddle stops spreading at this thickness
const FILM_SLOPE = 0.075;       // what stays stuck to a wall as a run goes past
const K = 0.16;                 // flow rate per tick (stable below 0.25)
const RUN = 0.5;                // downhill share per tick on a vertical wall
const TICK = 1 / 30;
const RAYS_PER_TICK = 240;
const DRY_TIME = 140;           // seconds for blood to dry dark

const KERNEL = [[1, 0, 0.11], [-1, 0, 0.11], [0, 1, 0.11], [0, -1, 0.11], [1, 1, 0.05], [-1, 1, 0.05], [1, -1, 0.05], [-1, -1, 0.05]];
const planes = new Map();
const tiles = new Map();
const tileList = [];
let scene, envMap = null;
let acc = 0;
let rayBudget = RAYS_PER_TICK;
let clock = 0;
let onDrip = null;
const ray = new CANNON.RaycastResult();
const rf = new CANNON.Vec3(), rt = new CANNON.Vec3();
const STATIC_ONLY = { collisionFilterMask: GROUP.STATIC, skipBackfaces: true };
const _p = new THREE.Vector3();

const geo = new THREE.PlaneGeometry(TILE, TILE);

const FLUID_DECL = /* glsl */`
uniform sampler2D uFluid;
uniform vec3 uO;
uniform vec3 uT1;
uniform vec3 uT2;
uniform vec3 uN;
varying vec3 vFW;
float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fNoise(vec2 x) {
  vec2 i = floor(x); vec2 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fHash(i), fHash(i + vec2(1, 0)), f.x), mix(fHash(i + vec2(0, 1)), fHash(i + vec2(1, 1)), f.x), f.y);
}
`;

function makeMaterial(tex, t) {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff, transparent: true, depthWrite: false, roughness: 0.1, metalness: 0.0,
    envMap, envMapIntensity: 0.35,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFluid = { value: tex };
    sh.uniforms.uO = { value: t.origin };
    sh.uniforms.uT1 = { value: t.plane.t1 };
    sh.uniforms.uT2 = { value: t.plane.t2 };
    sh.uniforms.uN = { value: t.plane.n };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FLUID_DECL)
      .replace('#include <map_fragment>', /* glsl */`
        vec3 frel = vFW - uO;
        vec2 fp = vec2(dot(frel, uT1), dot(frel, uT2));
        vec2 fuv = fp / ${TILE.toFixed(1)};
        vec4 fd = texture2D(uFluid, fuv);
        float fh = fd.r * 2.0;
        float fn = fNoise(fp * 22.0) * 0.6 + fNoise(fp * 70.0) * 0.4;
        float fedge = 0.04 + (fn - 0.5) * 0.035;
        float fa = smoothstep(fedge, fedge + 0.03, fh);
        if (fa < 0.01) discard;
        float fthick = smoothstep(0.05, 0.45, fh);
        float fage = fd.g;
        vec3 fresh = mix(vec3(0.13, 0.003, 0.006), vec3(0.03, 0.0006, 0.0015), fthick); // thin films let light through: redder
        vec3 dried = mix(vec3(0.045, 0.01, 0.007), vec3(0.016, 0.004, 0.003), fthick);
        diffuseColor.rgb = mix(fresh, dried, fage) * (0.9 + fn * 0.2);
        diffuseColor.a = fa * mix(0.9, 1.0, fthick);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.16, 0.65, fage) + (1.0 - fthick) * 0.15;`)
      .replace('#include <normal_fragment_maps>', /* glsl */`#include <normal_fragment_maps>
        {
          float tx = ${(1 / RES).toFixed(6)};
          float hx = texture2D(uFluid, fuv + vec2(tx, 0.0)).r - texture2D(uFluid, fuv - vec2(tx, 0.0)).r;
          float hz = texture2D(uFluid, fuv + vec2(0.0, tx)).r - texture2D(uFluid, fuv - vec2(0.0, tx)).r;
          float bump = (fNoise(fp * 40.0) - 0.5) * 0.04 * (1.0 - fage);
          vec3 nw = normalize(uN - uT1 * (hx * 3.5 - bump) - uT2 * (hz * 3.5 - bump));
          normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
        }`);
  };
  m.customProgramCacheKey = () => 'boneyard-fluid2';
  return m;
}

export function initFluid(s, renderer, drip = null) {
  scene = s;
  onDrip = drip;
  if (renderer) {
    // a small studio environment just for the wet sheen
    import('three/addons/environments/RoomEnvironment.js').then(({ RoomEnvironment }) => {
      const pm = new THREE.PMREMGenerator(renderer);
      envMap = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      pm.dispose();
      for (const t of tileList) { t.mesh.material.envMap = envMap; t.mesh.material.needsUpdate = true; }
    }).catch(() => {});
  }
}

export function getEnvMap() { return envMap; }

// ------------------------------------------------------------------ planes and tiles
/** The plane a surface lies in, with axes: t2 points downhill (or +z on level ground). */
function planeFor(n, point) {
  const qx = Math.round(n.x * 24), qy = Math.round(n.y * 24), qz = Math.round(n.z * 24);
  const nn = new THREE.Vector3(qx, qy, qz).normalize();
  const d = nn.dot(point);
  const key = qx + ',' + qy + ',' + qz + ',' + Math.round(d / 0.05);
  let pl = planes.get(key);
  if (pl) return pl;
  const t2 = nn.y > 0.97 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, -1, 0).addScaledVector(nn, nn.y).normalize();
  const t1 = new THREE.Vector3().crossVectors(t2, nn).normalize();
  t2.crossVectors(nn, t1).normalize();
  pl = { key, n: nn, t1, t2, d, slope: nn.y > 0.97 ? 0 : Math.sqrt(Math.max(0, 1 - nn.y * nn.y)) };
  planes.set(key, pl);
  return pl;
}

function getTile(pl, iu, iv, create) {
  const key = pl.key + '|' + iu + ',' + iv;
  let t = tiles.get(key);
  if (t || !create) return t || null;
  if (tileList.length >= MAX_TILES) {
    let old = tileList[0];
    for (const o of tileList) if (o.used < old.used) old = o;
    dropTile(old);
  }
  const data = new Uint8Array(RES * RES * 4);
  const tex = new THREE.DataTexture(data, RES, RES, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const origin = new THREE.Vector3().copy(pl.n).multiplyScalar(pl.d).addScaledVector(pl.t1, iu * TILE).addScaledVector(pl.t2, iv * TILE);
  t = {
    key, plane: pl, iu, iv, origin, tex, data,
    h: new Float32Array(RES * RES), d: new Float32Array(RES * RES), born: new Float32Array(RES * RES),
    valid: new Uint8Array(RES * RES),
    x0: RES, x1: -1, z0: RES, z1: -1, awake: 0, dirty: true, used: clock, nb: {},
  };
  const mesh = new THREE.Mesh(geo, makeMaterial(tex, t));
  const c = origin.clone().addScaledVector(pl.t1, TILE / 2).addScaledVector(pl.t2, TILE / 2).addScaledVector(pl.n, 0.002);
  mesh.matrixAutoUpdate = false;
  mesh.matrix.makeBasis(pl.t1, pl.t2, pl.n).setPosition(c);
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  scene.add(mesh);
  t.mesh = mesh;
  tiles.set(key, t);
  tileList.push(t);
  return t;
}

function dropTile(t) {
  scene.remove(t.mesh);
  t.mesh.material.dispose();
  t.tex.dispose();
  tiles.delete(t.key);
  tileList.splice(tileList.indexOf(t), 1);
  for (const o of tileList) for (const k in o.nb) if (o.nb[k] === t) delete o.nb[k];
}

export function clearFluid() {
  while (tileList.length) dropTile(tileList[0]);
  planes.clear();
}

function cellWorld(t, i, out) {
  const cx = i % RES, cz = (i / RES) | 0;
  return out.copy(t.origin).addScaledVector(t.plane.t1, (cx + 0.5) * CELL).addScaledVector(t.plane.t2, (cz + 0.5) * CELL);
}

/** Is there fixed surface under this cell, in the tile's plane? */
function checkCell(t, i) {
  const n = t.plane.n;
  cellWorld(t, i, _p);
  rf.set(_p.x + n.x * 0.06, _p.y + n.y * 0.06, _p.z + n.z * 0.06);
  rt.set(_p.x - n.x * 0.06, _p.y - n.y * 0.06, _p.z - n.z * 0.06);
  ray.reset();
  const hn = ray.hitNormalWorld;
  const ok = world.raycastClosest(rf, rt, STATIC_ONLY, ray) && hn.x * n.x + hn.y * n.y + hn.z * n.z > 0.95 && Math.abs(ray.distance - 0.06) < 0.02;
  t.valid[i] = ok ? 1 : 2;
  return ok;
}

/** Cell for a world point on a surface with normal n; null if none. */
function locate(p, n, create, pl = null) {
  pl = pl || planeFor(n, p);
  const u = p.x * pl.t1.x + p.y * pl.t1.y + p.z * pl.t1.z;
  const v = p.x * pl.t2.x + p.y * pl.t2.y + p.z * pl.t2.z;
  const iu = Math.floor(u / TILE), iv = Math.floor(v / TILE);
  const t = getTile(pl, iu, iv, create);
  if (!t) return null;
  const cx = Math.min(RES - 1, Math.max(0, Math.floor((u - iu * TILE) / CELL)));
  const cz = Math.min(RES - 1, Math.max(0, Math.floor((v - iv * TILE) / CELL)));
  return { t, i: cz * RES + cx, cx, cz };
}

function touch(t, cx, cz) {
  if (cx < t.x0) t.x0 = cx; if (cx > t.x1) t.x1 = cx;
  if (cz < t.z0) t.z0 = cz; if (cz > t.z1) t.z1 = cz;
  t.awake = 1.5; t.dirty = true; t.used = clock;
}

function addAt(t, i, amount) {
  if (t.h[i] <= 0.001) t.born[i] = clock;
  t.h[i] += amount;
  touch(t, i % RES, (i / RES) | 0);
}

function ensure(c, force) {
  if (!c.t.valid[c.i]) {
    if (!force && rayBudget-- <= 0) return false;
    checkCell(c.t, c.i);
  }
  return c.t.valid[c.i] === 1;
}

/** Can the liquid live on this surface? Fixed bodies, anything but a ceiling. */
export function accepts(body, normal) {
  return !!body && body.type === CANNON.Body.STATIC && normal.y > -0.2;
}
/** Level enough to stand on (footprints, bodies lying in it). */
export function isFloor(body, normal) {
  return !!body && body.type === CANNON.Body.STATIC && normal.y > 0.9;
}

const _n = new THREE.Vector3(), _q = new THREE.Vector3();
function asV(v, out) { return out.set(v.x, v.y, v.z); }

/**
 * Add blood at a point known to be on a fixed surface (a ray hit), normal n.
 * vel: impact velocity, smears the blot forward and flicks beads ahead.
 */
export function deposit(point, amount, vel = null, normal = null) {
  const n = normal ? asV(normal, _n).normalize() : _n.set(0, 1, 0);
  const pl = planeFor(n, point);
  const c = locate(point, n, true, pl);
  if (!c) return false;
  if (!c.t.valid[c.i]) c.t.valid[c.i] = 1; // the ray that found the point already proved it
  if (c.t.valid[c.i] !== 1) return false;
  // a small round blot rather than one square cell
  let rest = amount;
  for (const [du, dv, w] of KERNEL) {
    _q.copy(point).addScaledVector(pl.t1, du * CELL).addScaledVector(pl.t2, dv * CELL);
    const cc = locate(_q, n, false, pl);
    if (!cc || !ensure(cc, false)) continue;
    addAt(cc.t, cc.i, amount * w);
    rest -= amount * w;
  }
  addAt(c.t, c.i, rest);
  if (vel) {
    // velocity along the surface
    const vn = vel.x * n.x + vel.y * n.y + vel.z * n.z;
    const vx = vel.x - n.x * vn, vy = vel.y - n.y * vn, vz = vel.z - n.z * vn;
    const sp = Math.hypot(vx, vy, vz);
    if (sp > 1.5) {
      const k = Math.min(5, (sp * 0.8) | 0);
      for (let j = 1; j <= k; j++) {
        const d = j * CELL * (0.8 + Math.random() * 0.9) * Math.min(3, sp * 0.5);
        _q.set(point.x + (vx / sp) * d, point.y + (vy / sp) * d, point.z + (vz / sp) * d)
          .addScaledVector(pl.t1, (Math.random() - 0.5) * CELL * 1.5).addScaledVector(pl.t2, (Math.random() - 0.5) * CELL * 1.5);
        const cc = locate(_q, n, false, pl);
        if (!cc || !ensure(cc, true)) continue;
        addAt(cc.t, cc.i, amount * (j === 1 ? 0.5 : 0.25) * Math.random());
      }
    }
  }
  return true;
}

/**
 * Paint a thin layer over an oriented shape on a surface (prints, smears).
 * dir: direction along the surface for the shape's length axis.
 */
export function stamp(point, normal, dir, len, wid, amount, shape = null) {
  const n = asV(normal, new THREE.Vector3()).normalize();
  const pl = planeFor(n, point);
  const dn = dir.x * n.x + dir.y * n.y + dir.z * n.z;
  const F = new THREE.Vector3(dir.x - n.x * dn, dir.y - n.y * dn, dir.z - n.z * dn);
  if (F.lengthSq() < 1e-6) F.copy(pl.t2);
  F.normalize();
  const S = new THREE.Vector3().crossVectors(n, F);
  const R = Math.max(len, wid);
  let any = false;
  for (let a = -R; a <= R; a += CELL) {
    for (let b = -R; b <= R; b += CELL) {
      const w = shape ? shape(a / len, b / wid) : 1 - ((a / len) ** 2 + (b / wid) ** 2);
      if (w <= 0) continue;
      _q.copy(point).addScaledVector(F, a).addScaledVector(S, b);
      const c = locate(_q, n, true, pl);
      if (!c || !ensure(c, true)) continue; // a print is small: always worth the rays
      addAt(c.t, c.i, amount * Math.min(1, w * 2.5) * (0.7 + Math.random() * 0.6));
      any = true;
    }
  }
  return any;
}

/** Thickness of fresh blood around a point on a surface (0 if none). */
export function sample(point, normal, radius = 0.06) {
  const n = asV(normal, _n).normalize();
  const pl = planeFor(n, point);
  let m = 0;
  for (let a = -radius; a <= radius; a += CELL * 1.5) {
    for (let b = -radius; b <= radius; b += CELL * 1.5) {
      _q.copy(point).addScaledVector(pl.t1, a).addScaledVector(pl.t2, b);
      const c = locate(_q, n, false, pl);
      if (!c) continue;
      if (clock - c.t.born[c.i] < DRY_TIME * 0.5) m = Math.max(m, c.t.h[c.i]);
    }
  }
  return m;
}

/** Take some liquid away around a point (a foot stepping in it). */
export function take(point, normal, frac = 0.25, radius = 0.06) {
  const n = asV(normal, _n).normalize();
  const pl = planeFor(n, point);
  for (let a = -radius; a <= radius; a += CELL) {
    for (let b = -radius; b <= radius; b += CELL) {
      _q.copy(point).addScaledVector(pl.t1, a).addScaledVector(pl.t2, b);
      const c = locate(_q, n, false, pl);
      if (!c) continue;
      c.t.h[c.i] *= 1 - frac;
      touch(c.t, c.cx, c.cz);
    }
  }
}

// ------------------------------------------------------------------ simulation
function neighbour(t, du, dv) {
  const k = du + ',' + dv;
  if (t.nb[k] && tiles.has(t.nb[k].key)) return t.nb[k];
  const n = getTile(t.plane, t.iu + du, t.iv + dv, true);
  t.nb[k] = n;
  return n;
}

// resolve (cx, cz), which may fall in a neighbouring tile, into _rt/_ri; false if no surface there
let _rt = null, _ri = 0;
function resolve(t, cx, cz) {
  let nt = t;
  if (cx < 0) { nt = neighbour(t, -1, 0); cx += RES; } else if (cx >= RES) { nt = neighbour(t, 1, 0); cx -= RES; }
  if (cz < 0) { nt = neighbour(nt, 0, -1); cz += RES; } else if (cz >= RES) { nt = neighbour(nt, 0, 1); cz -= RES; }
  const j = cz * RES + cx;
  const v = nt.valid[j];
  if (v === 2) return false;
  if (v === 0) {
    if (rayBudget <= 0) return false;
    rayBudget--;
    if (!checkCell(nt, j)) return false;
  }
  _rt = nt; _ri = j;
  return true;
}

function give(t, f) {
  const nt = _rt, j = _ri;
  nt.d[j] += f;
  if (nt.h[j] <= 0.001) nt.born[j] = clock;
  if (nt !== t) touch(nt, j % RES, (j / RES) | 0);
  else {
    const x = j % RES, z = (j / RES) | 0;
    if (x < t.nx0) t.nx0 = x; if (x > t.nx1) t.nx1 = x; if (z < t.nz0) t.nz0 = z; if (z > t.nz1) t.nz1 = z;
  }
}

function spread(t, ex, cx, cz) {
  if (!resolve(t, cx, cz)) return 0;
  const ej = Math.max(0, _rt.h[_ri] - FILM);
  if (ex <= ej) return 0;
  const f = K * (ex - ej) * (0.75 + Math.random() * 0.5); // uneven, so edges are not perfect diamonds
  give(t, f);
  return f;
}

function simTile(t) {
  if (t.awake <= 0 || t.x1 < 0) return;
  t.nx0 = t.x0; t.nx1 = t.x1; t.nz0 = t.z0; t.nz1 = t.z1;
  const slope = t.plane.slope;
  let moved = 0;
  for (let cz = t.z0; cz <= t.z1; cz++) {
    for (let cx = t.x0; cx <= t.x1; cx++) {
      const i = cz * RES + cx;
      const h = t.h[i];
      let out = 0;
      // gravity: on a slope the excess runs downhill (cz + 1), wobbling a little sideways
      if (slope > 0.15 && h > FILM_SLOPE) {
        const f = RUN * slope * (h - FILM_SLOPE);
        const side = Math.random() < 0.12 ? (Math.random() < 0.5 ? -1 : 1) : 0;
        if (resolve(t, cx + side, cz + 1)) { give(t, f); out += f; }
        else if (f > 0.004) {
          // nothing below: it drips off the edge
          out += f;
          if (onDrip && f > 0.02 && Math.random() < 0.5) onDrip(cellWorld(t, i, new THREE.Vector3()), f, t.plane.n);
        }
      }
      const ex = h - out - FILM;
      if (ex > 0.002) {
        out += spread(t, ex, cx + 1, cz);
        out += spread(t, ex, cx - 1, cz);
        out += spread(t, ex, cx, cz + 1);
        out += spread(t, ex, cx, cz - 1);
      }
      if (out) { t.d[i] -= out; moved += out; }
    }
  }
  t.x0 = t.nx0; t.x1 = t.nx1; t.z0 = t.nz0; t.z1 = t.nz1;
  if (moved > 0.0005) { t.awake = 1.5; t.dirty = true; }
}

function applyTile(t) {
  if (t.x1 < 0) return;
  for (let cz = t.z0; cz <= t.z1; cz++) {
    for (let cx = t.x0; cx <= t.x1; cx++) {
      const i = cz * RES + cx;
      if (t.d[i] !== 0) { t.h[i] = Math.max(0, t.h[i] + t.d[i]); t.d[i] = 0; }
    }
  }
}

let ageT = 0;
export function updateFluid(dt) {
  if (!tileList.length) return;
  clock += dt;
  acc = Math.min(acc + dt, TICK * 3);
  while (acc >= TICK) {
    acc -= TICK;
    rayBudget = RAYS_PER_TICK;
    for (const t of tileList) simTile(t);
    for (const t of tileList) { applyTile(t); t.awake -= TICK; }
  }
  // drying is slow: refresh the age channel a few times a second
  ageT -= dt;
  const reAge = ageT <= 0;
  if (reAge) ageT = 0.5;
  for (const t of tileList) {
    if (!t.dirty && !reAge) continue;
    if (t.x1 < 0) continue;
    const data = t.data;
    for (let cz = t.z0; cz <= t.z1; cz++) {
      for (let cx = t.x0; cx <= t.x1; cx++) {
        const i = cz * RES + cx;
        const h = t.h[i];
        data[i * 4] = Math.min(255, (h * 0.5 * 255) | 0);
        data[i * 4 + 1] = h > 0 ? Math.min(255, (((clock - t.born[i]) / DRY_TIME) * 255) | 0) : 0;
        data[i * 4 + 3] = 255;
      }
    }
    t.tex.needsUpdate = true;
    t.dirty = false;
  }
}

