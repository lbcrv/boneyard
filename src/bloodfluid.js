import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { world, GROUP } from './physics.js';

/*
 * Blood on the floor as a liquid, not as stickers.
 *
 * Flat static ground is covered (lazily, only where blood lands) by tiles of
 * a fine grid. Each cell holds a thickness. Every tick the liquid above a thin
 * film thickness flows to its neighbours, so drops that land close together
 * merge, a steady source grows a puddle that spreads and slows down on its
 * own, and liquid stops at edges (a cell only takes liquid once a ray has
 * confirmed there is floor under it at the same height). The tile is drawn
 * from that grid: soft noisy outline, darker where it is deep, and a glossy
 * surface whose normal comes from the thickness gradient, so puddles catch
 * the light with a rim like real liquid. Old blood slowly dries dark brown.
 */

const TILE = 3;                 // metres per tile side
const RES = 96;                 // cells per side (3.1 cm)
const CELL = TILE / RES;
const MAX_TILES = 20;
const FILM = 0.12;              // a puddle stops spreading at this thickness
const K = 0.16;                 // flow rate per tick (stable below 0.25)
const TICK = 1 / 30;
const RAYS_PER_TICK = 220;
const DRY_TIME = 140;           // seconds for blood to dry dark

const KERNEL = [[1, 0, 0.11], [-1, 0, 0.11], [0, 1, 0.11], [0, -1, 0.11], [1, 1, 0.05], [-1, 1, 0.05], [1, -1, 0.05], [-1, -1, 0.05]];
const tiles = new Map();
const tileList = [];
let scene, envMap = null;
let acc = 0;
let rayBudget = RAYS_PER_TICK;
const ray = new CANNON.RaycastResult();
const rf = new CANNON.Vec3(), rt = new CANNON.Vec3();
const STATIC_ONLY = { collisionFilterMask: GROUP.STATIC, skipBackfaces: true };
let clock = 0;

const geo = new THREE.PlaneGeometry(TILE, TILE).rotateX(-Math.PI / 2);

const FLUID_DECL = /* glsl */`
uniform sampler2D uFluid;
uniform vec2 uOrigin;
varying vec3 vFW;
float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fNoise(vec2 x) {
  vec2 i = floor(x); vec2 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fHash(i), fHash(i + vec2(1, 0)), f.x), mix(fHash(i + vec2(0, 1)), fHash(i + vec2(1, 1)), f.x), f.y);
}
`;

function makeMaterial(tex, origin) {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff, transparent: true, depthWrite: false, roughness: 0.1, metalness: 0.0,
    envMap, envMapIntensity: 0.35,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFluid = { value: tex };
    sh.uniforms.uOrigin = { value: origin };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FLUID_DECL)
      .replace('#include <map_fragment>', /* glsl */`
        vec2 fuv = (vFW.xz - uOrigin) / ${TILE.toFixed(1)};
        vec4 fd = texture2D(uFluid, fuv);
        float fh = fd.r * 2.0;
        float fn = fNoise(vFW.xz * 22.0) * 0.6 + fNoise(vFW.xz * 70.0) * 0.4;
        float fedge = 0.05 + (fn - 0.5) * 0.045;
        float fa = smoothstep(fedge, fedge + 0.03, fh);
        if (fa < 0.01) discard;
        float fthick = smoothstep(0.05, 0.45, fh);
        float fage = fd.g;
        vec3 fresh = mix(vec3(0.085, 0.0015, 0.004), vec3(0.028, 0.0006, 0.0015), fthick);
        vec3 dried = mix(vec3(0.045, 0.01, 0.007), vec3(0.016, 0.004, 0.003), fthick);
        diffuseColor.rgb = mix(fresh, dried, fage) * (0.9 + fn * 0.2);
        diffuseColor.a = fa * mix(0.8, 1.0, fthick);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.16, 0.65, fage) + (1.0 - fthick) * 0.15;`)
      .replace('#include <normal_fragment_maps>', /* glsl */`#include <normal_fragment_maps>
        {
          float tx = ${(1 / RES).toFixed(6)};
          float hx = texture2D(uFluid, fuv + vec2(tx, 0.0)).r - texture2D(uFluid, fuv - vec2(tx, 0.0)).r;
          float hz = texture2D(uFluid, fuv + vec2(0.0, tx)).r - texture2D(uFluid, fuv - vec2(0.0, tx)).r;
          float bump = (fNoise(vFW.xz * 40.0) - 0.5) * 0.04 * (1.0 - fage);
          vec3 nw = normalize(vec3(-hx * 3.5 + bump, 1.0, -hz * 3.5 + bump));
          normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
        }`);
  };
  m.customProgramCacheKey = () => 'boneyard-fluid';
  return m;
}

export function initFluid(s, renderer) {
  scene = s;
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

function tileKey(ix, iz, y) { return ix + ',' + iz + ',' + Math.round(y / 0.1); }

function getTile(ix, iz, y, create) {
  const key = tileKey(ix, iz, y);
  let t = tiles.get(key);
  if (t || !create) return t || null;
  if (tileList.length >= MAX_TILES) {
    // recycle the tile that was touched longest ago
    let old = tileList[0];
    for (const o of tileList) if (o.used < old.used) old = o;
    dropTile(old);
  }
  const data = new Uint8Array(RES * RES * 4);
  const tex = new THREE.DataTexture(data, RES, RES, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const origin = new THREE.Vector2(ix * TILE, iz * TILE);
  const mesh = new THREE.Mesh(geo, makeMaterial(tex, origin));
  mesh.position.set(origin.x + TILE / 2, y + 0.002, origin.y + TILE / 2);
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  scene.add(mesh);
  t = {
    key, ix, iz, y, mesh, tex, data,
    h: new Float32Array(RES * RES), d: new Float32Array(RES * RES), born: new Float32Array(RES * RES),
    valid: new Uint8Array(RES * RES), pending: [],
    x0: RES, x1: -1, z0: RES, z1: -1, awake: 0, dirty: true, used: clock, nb: {},
  };
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
}

/** Is there flat static floor under this cell, at the tile's height? */
function checkCell(t, i) {
  const cx = i % RES, cz = (i / RES) | 0;
  const x = t.ix * TILE + (cx + 0.5) * CELL, z = t.iz * TILE + (cz + 0.5) * CELL;
  rf.set(x, t.y + 0.06, z); rt.set(x, t.y - 0.06, z);
  ray.reset();
  const ok = world.raycastClosest(rf, rt, STATIC_ONLY, ray) && ray.hitNormalWorld.y > 0.9 && Math.abs(ray.hitPointWorld.y - t.y) < 0.02;
  t.valid[i] = ok ? 1 : 2;
  return ok;
}

/** Cell (tile, index) for a world point on the floor at height y; null if none. */
function locate(x, y, z, create) {
  const ix = Math.floor(x / TILE), iz = Math.floor(z / TILE);
  const t = getTile(ix, iz, y, create);
  if (!t) return null;
  const cx = Math.min(RES - 1, Math.max(0, Math.floor((x - ix * TILE) / CELL)));
  const cz = Math.min(RES - 1, Math.max(0, Math.floor((z - iz * TILE) / CELL)));
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

/**
 * Add blood at a point already known to be on the floor (a ray hit).
 * vel: impact velocity, used to throw a few satellite droplets ahead.
 */
export function deposit(point, amount, vel = null, checked = true) {
  const c = locate(point.x, point.y, point.z, true);
  if (!c) return false;
  if (!c.t.valid[c.i]) {
    if (checked) c.t.valid[c.i] = 1;
    else checkCell(c.t, c.i);
  }
  if (c.t.valid[c.i] !== 1) return false;
  // a small round blot rather than one square cell
  let rest = amount;
  for (const [dx, dz, w] of KERNEL) {
    const cc = locate(point.x + dx * CELL, point.y, point.z + dz * CELL, false);
    if (!cc) continue;
    if (!cc.t.valid[cc.i]) { if (rayBudget-- <= 0) continue; checkCell(cc.t, cc.i); }
    if (cc.t.valid[cc.i] !== 1) continue;
    addAt(cc.t, cc.i, amount * w);
    rest -= amount * w;
  }
  addAt(c.t, c.i, rest);
  if (vel) {
    const sp = Math.hypot(vel.x, vel.z);
    if (sp > 1.5) {
      // a fast drop smears forward and flicks a few beads ahead
      const ux = vel.x / sp, uz = vel.z / sp;
      const n = Math.min(5, (sp * 0.8) | 0);
      for (let k = 1; k <= n; k++) {
        const d = k * CELL * (0.8 + Math.random() * 0.9) * Math.min(3, sp * 0.5);
        const x = point.x + ux * d + (Math.random() - 0.5) * CELL * 1.5;
        const z = point.z + uz * d + (Math.random() - 0.5) * CELL * 1.5;
        const cc = locate(x, point.y, z, false);
        if (!cc) continue;
        if (!cc.t.valid[cc.i]) checkCell(cc.t, cc.i);
        if (cc.t.valid[cc.i] === 1) addAt(cc.t, cc.i, amount * (k === 1 ? 0.5 : 0.25) * Math.random());
      }
    }
  }
  return true;
}

/** Paint a thin layer over an oriented ellipse (footprints, smears). */
export function stamp(x, y, z, yaw, len, wid, amount, shape = null) {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const R = Math.max(len, wid);
  let any = false;
  for (let ox = -R; ox <= R; ox += CELL) {
    for (let oz = -R; oz <= R; oz += CELL) {
      // local frame: f along yaw, s across
      const f = ox * sn + oz * cs, s = ox * cs - oz * sn;
      const w = shape ? shape(f / len, s / wid) : 1 - ((f / len) ** 2 + (s / wid) ** 2);
      if (w <= 0) continue;
      const c = locate(x + ox, y, z + oz, true);
      if (!c) continue;
      if (!c.t.valid[c.i]) checkCell(c.t, c.i); // a print is small: always worth the rays
      if (c.t.valid[c.i] !== 1) continue;
      addAt(c.t, c.i, amount * Math.min(1, w * 2.5) * (0.7 + Math.random() * 0.6));
      any = true;
    }
  }
  return any;
}

/** Thickness of fresh blood around a point on the floor (0 if none). */
export function sample(x, y, z, radius = 0.06) {
  let m = 0;
  for (let ox = -radius; ox <= radius; ox += CELL * 1.5) {
    for (let oz = -radius; oz <= radius; oz += CELL * 1.5) {
      const c = locate(x + ox, y, z + oz, false);
      if (!c) continue;
      const fresh = clock - c.t.born[c.i] < DRY_TIME * 0.5;
      if (fresh) m = Math.max(m, c.t.h[c.i]);
    }
  }
  return m;
}

/** Take some liquid away around a point (a foot stepping in it). */
export function take(x, y, z, frac = 0.25, radius = 0.06) {
  for (let ox = -radius; ox <= radius; ox += CELL) {
    for (let oz = -radius; oz <= radius; oz += CELL) {
      const c = locate(x + ox, y, z + oz, false);
      if (!c) continue;
      c.t.h[c.i] *= 1 - frac;
      touch(c.t, c.cx, c.cz);
    }
  }
}

function neighbour(t, dx, dz) {
  const k = dx + ',' + dz;
  if (t.nb[k] && tiles.has(t.nb[k].key)) return t.nb[k];
  const n = getTile(t.ix + dx, t.iz + dz, t.y, true);
  t.nb[k] = n;
  return n;
}

// flow from cell i of tile t to the cell at (cx, cz), which may be in a neighbouring tile
function flowTo(t, i, ex, cx, cz) {
  let nt = t;
  if (cx < 0) { nt = neighbour(t, -1, 0); cx += RES; } else if (cx >= RES) { nt = neighbour(t, 1, 0); cx -= RES; }
  if (cz < 0) { nt = neighbour(t, 0, -1); cz += RES; } else if (cz >= RES) { nt = neighbour(t, 0, 1); cz -= RES; }
  const j = cz * RES + cx;
  const v = nt.valid[j];
  if (v === 2) return 0;
  if (v === 0) {
    if (rayBudget <= 0) return 0;
    rayBudget--;
    if (!checkCell(nt, j)) return 0;
  }
  const ej = Math.max(0, nt.h[j] - FILM);
  if (ex <= ej) return 0;
  const f = K * (ex - ej) * (0.75 + Math.random() * 0.5); // uneven, so edges are not perfect diamonds
  nt.d[j] += f;
  if (nt.h[j] <= 0.001) nt.born[j] = clock;
  if (nt !== t) touch(nt, cx, cz);
  else { if (cx < t.nx0) t.nx0 = cx; if (cx > t.nx1) t.nx1 = cx; if (cz < t.nz0) t.nz0 = cz; if (cz > t.nz1) t.nz1 = cz; }
  return f;
}

function simTile(t) {
  if (t.awake <= 0 || t.x1 < 0) return;
  t.nx0 = t.x0; t.nx1 = t.x1; t.nz0 = t.z0; t.nz1 = t.z1;
  let moved = 0;
  for (let cz = t.z0; cz <= t.z1; cz++) {
    for (let cx = t.x0; cx <= t.x1; cx++) {
      const i = cz * RES + cx;
      const ex = t.h[i] - FILM;
      if (ex <= 0.002) continue;
      let out = 0;
      out += flowTo(t, i, ex, cx + 1, cz);
      out += flowTo(t, i, ex, cx - 1, cz);
      out += flowTo(t, i, ex, cx, cz + 1);
      out += flowTo(t, i, ex, cx, cz - 1);
      t.d[i] -= out;
      moved += out;
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

/** Is this a surface the liquid grid can live on? */
export function isFloor(body, normal) {
  return body && body.type === CANNON.Body.STATIC && normal.y > 0.9;
}
