import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  world, GROUP, MASK_ALL, MAT, invInertiaAlong, applyAngularImpulse, track, untrack,
} from './physics.js';
import { headTexture, torsoTexture } from './textures.js';
import { Skeleton, BONE_COUNT } from './skeleton.js';

/*
 * Active ragdoll, v2.
 *
 * 16 rigid segments driven by per-joint muscles (velocity-level PD servos with
 * a torque cap). A balance layer keeps pelvis and chest upright and holds the
 * hips at standing height over the feet. Feet are placed with a 2-bone IK
 * stepping planner, so stairs are climbed step by step instead of floated over.
 *
 * Damage is resolved on a 206-bone anatomical model (skeleton.js). Long-bone or
 * spinal fractures switch off the muscles they would carry.
 *
 * Combat moves (Lugaru-style): punch, kick, sweep, flying kick, shove, tackle,
 * and reversals that catch an incoming attack during its wind-up.
 */

const G_EST = 12.5;
const STAND_H = 0.93;
const LEG = 0.42;

export const SEGMENT_LABEL = {
  pelvis: 'PELVIS', abdomen: 'ABDOMEN', chest: 'TÓRAX', head: 'CRÁNEO',
  upperArmL: 'BRAZO IZQ.', upperArmR: 'BRAZO DER.', lowerArmL: 'ANTEBRAZO IZQ.', lowerArmR: 'ANTEBRAZO DER.',
  handL: 'MANO IZQ.', handR: 'MANO DER.', thighL: 'MUSLO IZQ.', thighR: 'MUSLO DER.',
  shinL: 'PIERNA IZQ.', shinR: 'PIERNA DER.', footL: 'PIE IZQ.', footR: 'PIE DER.',
};

// Character-local rest pose: facing +Z, left = +X, feet on y = 0.
function partDefs() {
  const d = [
    { name: 'pelvis', kind: 'box', he: [0.16, 0.09, 0.11], pos: [0, 0.97, 0], mass: 12, mult: 1.0 },
    { name: 'abdomen', kind: 'box', he: [0.145, 0.08, 0.1], pos: [0, 1.15, 0], mass: 9, mult: 1.1 },
    { name: 'chest', kind: 'box', he: [0.18, 0.13, 0.115], pos: [0, 1.37, 0], mass: 17, mult: 1.2 },
    { name: 'head', kind: 'sphere', r: 0.115, pos: [0, 1.665, 0.01], mass: 5.5, mult: 2.2 },
  ];
  for (const [S, sx] of [['L', 1], ['R', -1]]) {
    d.push(
      { name: 'upperArm' + S, kind: 'limb', len: 0.29, r: 0.055, top: [0.25 * sx, 1.46, 0], mass: 2.7, mult: 0.8 },
      { name: 'lowerArm' + S, kind: 'limb', len: 0.26, r: 0.047, top: [0.25 * sx, 1.17, 0], mass: 1.8, mult: 0.8 },
      { name: 'hand' + S, kind: 'box', he: [0.032, 0.08, 0.045], pos: [0.25 * sx, 0.83, 0], mass: 0.6, mult: 0.7, hand: true },
      { name: 'thigh' + S, kind: 'limb', len: LEG, r: 0.075, top: [0.095 * sx, 0.92, 0], mass: 10, mult: 0.9 },
      { name: 'shin' + S, kind: 'limb', len: LEG, r: 0.06, top: [0.095 * sx, 0.5, 0], mass: 4.5, mult: 0.9 },
      { name: 'foot' + S, kind: 'box', he: [0.055, 0.035, 0.12], pos: [0.095 * sx, 0.035, 0.055], mass: 1.3, mult: 0.6, foot: true },
    );
  }
  return d;
}

function n3(x, y, z) { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; }

function jointDefs() {
  const defs = [
    { name: 'lumbar', parent: 'pelvis', child: 'abdomen', at: [0, 1.065, 0], type: 'cone', axisA: n3(0, 0.97, 0.25), axisB: [0, 1, 0], angle: 0.45, twist: 0.35, torque: 560, wn: 14 },
    { name: 'thoracic', parent: 'abdomen', child: 'chest', at: [0, 1.235, 0], type: 'cone', axisA: n3(0, 0.97, 0.2), axisB: [0, 1, 0], angle: 0.4, twist: 0.35, torque: 500, wn: 14 },
    { name: 'neck', parent: 'chest', child: 'head', at: [0, 1.53, 0], type: 'cone', axisA: n3(0, 1, 0.15), axisB: [0, 1, 0], angle: 0.75, twist: 0.9, torque: 90, wn: 13 },
  ];
  for (const [s, sx] of [['L', 1], ['R', -1]]) {
    defs.push(
      { name: 'shoulder' + s, parent: 'chest', child: 'upperArm' + s, at: [0.25 * sx, 1.46, 0], type: 'cone', axisA: n3(0.6 * sx, -0.35, 0.55), axisB: [0, -1, 0], angle: 1.65, twist: 1.0, torque: 150, wn: 13 },
      { name: 'elbow' + s, parent: 'upperArm' + s, child: 'lowerArm' + s, at: [0.25 * sx, 1.17, 0], type: 'hinge', limits: [-2.6, 0.02], torque: 100, wn: 14 },
      { name: 'wrist' + s, parent: 'lowerArm' + s, child: 'hand' + s, at: [0.25 * sx, 0.91, 0], type: 'cone', axisA: [0, -1, 0], axisB: [0, -1, 0], angle: 0.9, twist: 0.6, torque: 30, wn: 12 },
      { name: 'hip' + s, parent: 'pelvis', child: 'thigh' + s, at: [0.095 * sx, 0.92, 0], type: 'cone', axisA: n3(0.15 * sx, -0.8, 0.55), axisB: [0, -1, 0], angle: 1.25, twist: 0.5, torque: 520, wn: 15 },
      { name: 'knee' + s, parent: 'thigh' + s, child: 'shin' + s, at: [0.095 * sx, 0.5, 0], type: 'hinge', limits: [-0.02, 2.5], torque: 420, wn: 15 },
      { name: 'ankle' + s, parent: 'shin' + s, child: 'foot' + s, at: [0.095 * sx, 0.08, 0], type: 'cone', axisA: [0, -1, 0], axisB: [0, -1, 0], angle: 0.55, twist: 0.3, torque: 170, wn: 13 },
    );
  }
  return defs;
}

// Lugaru-style move set. Times in seconds. power = velocity (m/s) the strike adds.
const MOVES = {
  punch: { wind: 0.09, strike: 0.13, rec: 0.16, high: true, power: 7.5, limbs: ['hand'], dmg: 1 },
  kick: { wind: 0.13, strike: 0.16, rec: 0.24, high: true, power: 10, limbs: ['foot', 'shin'], dmg: 1.35 },
  sweep: { wind: 0.1, strike: 0.2, rec: 0.26, high: false, power: 7, limbs: ['foot', 'shin'], dmg: 0.7, sweep: true },
  flykick: { wind: 0.06, strike: 0.3, rec: 0.2, high: true, power: 12, limbs: ['foot', 'shin'], dmg: 1.6 },
  shove: { wind: 0.14, strike: 0.14, rec: 0.26, high: true, power: 6.5, limbs: ['hand', 'lowerArm'], dmg: 0.4, both: true },
  reversal: { wind: 0, strike: 0.25, rec: 0.35, high: true, power: 0, limbs: [], dmg: 0 },
};

// scratch
const qp = new THREE.Quaternion();
const qc = new THREE.Quaternion();
const qt = new THREE.Quaternion();
const qe = new THREE.Quaternion();
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const v4 = new THREE.Vector3();
const eul = new THREE.Euler();
const rayResult = new CANNON.RaycastResult();
const rayFrom = new CANNON.Vec3();
const rayTo = new CANNON.Vec3();
const RAY_OPTS = { collisionFilterMask: GROUP.STATIC | GROUP.PROP | GROUP.VEHICLE, skipBackfaces: true };
const _lp = new CANNON.Vec3();

const DARK = 0x2a2a30;
const HURT = new THREE.Color(0xc0392b);
const BRUISE = new THREE.Color(0x5b2a3a);

export const STATE_LABEL = {
  stand: 'DE PIE', stumble: 'INESTABLE', fall: 'CAYENDO', down: 'EN EL SUELO',
  ko: 'INCONSCIENTE', getup: 'INCORPORÁNDOSE', limp: 'INERTE', air: 'EN EL AIRE',
  wrecked: 'NO PUEDE LEVANTARSE', seated: 'SENTADO', crouch: 'AGACHADO', attack: 'ATACANDO', emote: 'BAILANDO',
};

function groundHit(x, z, yTop, yBot) {
  rayFrom.set(x, yTop, z);
  rayTo.set(x, yBot, z);
  rayResult.reset();
  if (!world.raycastClosest(rayFrom, rayTo, RAY_OPTS, rayResult)) return null;
  const n = rayResult.hitNormalWorld;
  return { y: rayResult.hitPointWorld.y, body: rayResult.body, normal: new THREE.Vector3(n.x, n.y, n.z) };
}

function groundAt(x, z, yTop, yBot) {
  rayFrom.set(x, yTop, z);
  rayTo.set(x, yBot, z);
  rayResult.reset();
  return world.raycastClosest(rayFrom, rayTo, RAY_OPTS, rayResult) ? rayResult.hitPointWorld.y : null;
}

export class Ragdoll {
  static all = [];

  constructor(scene, { style = 'dummy', color = 0xf2c14e, team = 0, name = 'Muñeco', isPlayer = false } = {}) {
    this.scene = scene;
    this.style = style;
    this.color = color;
    this.team = team;
    this.name = name;
    this.isPlayer = isPlayer;
    this.parts = [];
    this.partMap = {};
    this.joints = [];
    this.jointMap = {};
    this.events = [];
    this.totalMass = 0;
    this.grips = { L: null, R: null };
    this.skeleton = new Skeleton();
    this.feet = { L: null, R: null };
    this.plants = { L: null, R: null };
    this.tune = { upright: 1, runBlend: 0.32, runLead: 0.42, lean: 0.03, hipReaction: 1, trunkGain: 6 };
    this.pendingHits = [];
    this.pendingGrips = [];
    this.build();
    Ragdoll.all.push(this);
    this.reset(new THREE.Vector3(0, 0, 0), 0);
  }

  dispose() {
    this.releaseGrip('L'); this.releaseGrip('R');
    this.unplantAll();
    for (const j of this.joints) world.removeConstraint(j.constraint);
    for (const p of this.parts) {
      world.removeBody(p.body);
      untrack(p.body);
      this.scene.remove(p.mesh);
      p.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    const i = Ragdoll.all.indexOf(this);
    if (i >= 0) Ragdoll.all.splice(i, 1);
  }

  // ---------------------------------------------------------------- build
  build() {
    const block = this.style === 'block';
    const base = new THREE.Color(this.color);
    const bodyMat = new THREE.MeshStandardMaterial({ color: base, roughness: block ? 0.75 : 0.55, metalness: 0.05 });
    const dark = new THREE.MeshStandardMaterial({ color: block ? base.clone().multiplyScalar(0.45) : DARK, roughness: 0.7 });
    const limbMat = block ? new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.8 }) : bodyMat;
    const headMat = block
      ? new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.8 })
      : new THREE.MeshStandardMaterial({ map: headTexture('#' + base.getHexString()), roughness: 0.45 });
    const chestMat = block ? bodyMat : new THREE.MeshStandardMaterial({ map: torsoTexture('#' + base.getHexString()), roughness: 0.55 });

    for (const d of partDefs()) {
      const body = new CANNON.Body({
        mass: d.mass, material: MAT.ragdoll,
        collisionFilterGroup: GROUP.RAGDOLL, collisionFilterMask: MASK_ALL,
        linearDamping: 0.01, angularDamping: 0.06, allowSleep: false,
      });
      const group = new THREE.Group();
      let center, mainMat;
      if (d.kind === 'box') {
        body.addShape(new CANNON.Box(new CANNON.Vec3(...d.he)));
        center = new THREE.Vector3(...d.pos);
        if (d.name === 'chest') mainMat = chestMat.clone();
        else if (d.foot || d.hand || d.name === 'pelvis' || d.name === 'abdomen') mainMat = (d.name === 'abdomen' && block ? bodyMat : dark).clone();
        else mainMat = bodyMat.clone();
        const geo = block
          ? new THREE.BoxGeometry(d.he[0] * 2, d.he[1] * 2, d.he[2] * 2)
          : new RoundedBoxGeometry(d.he[0] * 2, d.he[1] * 2, d.he[2] * 2, 3, Math.min(...d.he) * 0.6);
        const m = new THREE.Mesh(geo, mainMat);
        m.castShadow = true; m.receiveShadow = true;
        group.add(m);
        if (d.name === 'chest' && !block) {
          for (const sx of [1, -1]) {
            const b = new THREE.Mesh(new THREE.SphereGeometry(0.066, 16, 12), dark);
            b.position.set(0.23 * sx, 0.09, 0); b.castShadow = true; group.add(b);
          }
          const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.09, 12), dark);
          neck.position.set(0, 0.16, 0); group.add(neck);
        }
        if (d.name === 'pelvis' && !block) {
          for (const sx of [1, -1]) {
            const b = new THREE.Mesh(new THREE.SphereGeometry(0.076, 16, 12), dark);
            b.position.set(0.095 * sx, -0.05, 0); group.add(b);
          }
        }
        if (d.name === 'abdomen' && !block) {
          // ribbed spine section so the bend reads
          for (let i = -1; i <= 1; i++) {
            const r = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.012, 6, 24), dark);
            r.rotation.x = Math.PI / 2; r.scale.set(1, 0.75, 1); r.position.y = i * 0.045; group.add(r);
          }
        }
      } else if (d.kind === 'sphere') {
        center = new THREE.Vector3(...d.pos);
        if (block) {
          body.addShape(new CANNON.Box(new CANNON.Vec3(d.r * 0.95, d.r * 1.05, d.r * 0.95)));
          mainMat = headMat.clone();
          const m = new THREE.Mesh(new THREE.BoxGeometry(d.r * 1.9, d.r * 2.1, d.r * 1.9), mainMat);
          m.castShadow = true; group.add(m);
        } else {
          body.addShape(new CANNON.Sphere(d.r));
          mainMat = headMat.clone();
          const m = new THREE.Mesh(new THREE.SphereGeometry(d.r, 28, 20), mainMat);
          m.rotation.y = Math.PI / 2; m.castShadow = true; group.add(m);
          const visor = new THREE.Mesh(
            new THREE.SphereGeometry(d.r * 1.01, 24, 12, -0.9, 1.8, Math.PI * 0.36, Math.PI * 0.2),
            new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.15, metalness: 0.6 }),
          );
          group.add(visor);
        }
      } else {
        const n = Math.max(2, Math.round(d.len / d.r / 1.5));
        const y0 = -d.len / 2 + d.r * 0.6, y1 = d.len / 2 - d.r * 0.6;
        for (let i = 0; i < n; i++) body.addShape(new CANNON.Sphere(d.r), new CANNON.Vec3(0, y0 + ((y1 - y0) * i) / (n - 1), 0));
        center = new THREE.Vector3(d.top[0], d.top[1] - d.len / 2, d.top[2]);
        mainMat = limbMat.clone();
        const geo = block
          ? new THREE.BoxGeometry(d.r * 1.9, d.len, d.r * 1.9)
          : new THREE.CapsuleGeometry(d.r, d.len - d.r, 6, 14);
        const m = new THREE.Mesh(geo, mainMat);
        m.castShadow = true; m.receiveShadow = true;
        group.add(m);
        if (!block && (d.name.startsWith('lower') || d.name.startsWith('shin'))) {
          const b = new THREE.Mesh(new THREE.SphereGeometry(d.r * 1.12, 14, 10), dark);
          b.position.y = d.len / 2; group.add(b);
        }
      }
      this.scene.add(group);
      world.addBody(body);
      const part = {
        name: d.name, def: d, body, mesh: group, restPos: center, mat: mainMat,
        baseColor: mainMat.color.clone(), hurt: 0, wounds: 0, joint: null,
        bbr: d.kind === 'limb' ? d.r : d.kind === 'sphere' ? d.r : Math.max(...d.he) * 0.8,
      };
      body.userData = { ragdoll: this, part };
      track(body, group);
      this.parts.push(part);
      this.partMap[d.name] = part;
      this.totalMass += d.mass;
      body.addEventListener('collide', (e) => this.onCollide(part, e));
    }

    for (const jd of jointDefs()) {
      const P = this.partMap[jd.parent], C = this.partMap[jd.child];
      const at = new THREE.Vector3(...jd.at);
      const pivotA = new CANNON.Vec3().copy(at.clone().sub(P.restPos));
      const pivotB = new CANNON.Vec3().copy(at.clone().sub(C.restPos));
      let c;
      if (jd.type === 'cone') {
        c = new CANNON.ConeTwistConstraint(P.body, C.body, {
          pivotA, pivotB,
          axisA: new CANNON.Vec3(...jd.axisA), axisB: new CANNON.Vec3(...jd.axisB),
          angle: jd.angle, twistAngle: jd.twist, collideConnected: false, maxForce: 1e6,
        });
      } else {
        c = new CANNON.HingeConstraint(P.body, C.body, {
          pivotA, pivotB, axisA: new CANNON.Vec3(1, 0, 0), axisB: new CANNON.Vec3(1, 0, 0),
          collideConnected: false, maxForce: 1e6,
        });
      }
      world.addConstraint(c);
      const j = { ...jd, P, C, constraint: c, target: new THREE.Quaternion(), prevTarget: new THREE.Quaternion(), broken: false, weak: 1, hipJoint: jd.name.startsWith('hip') };
      this.joints.push(j);
      this.jointMap[jd.name] = j;
      C.joint = j;
    }
  }

  // ---------------------------------------------------------------- reset
  reset(pos, yaw) {
    this.unplantAll();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    for (const p of this.parts) {
      const wp = p.restPos.clone().applyQuaternion(q).add(pos);
      const b = p.body;
      b.position.set(wp.x, wp.y + 0.02, wp.z);
      b.quaternion.set(q.x, q.y, q.z, q.w);
      b.velocity.setZero(); b.angularVelocity.setZero();
      b.force.setZero(); b.torque.setZero();
      b.previousPosition.copy(b.position);
      b.interpolatedPosition.copy(b.position);
      b.collisionFilterMask = MASK_ALL;
      p.hurt = 0; p.wounds = 0;
      p.mat.color.copy(p.baseColor);
    }
    for (const j of this.joints) { j.broken = false; j.weak = 1; j.target.identity(); j.prevTarget.identity(); }
    this.releaseGrip('L'); this.releaseGrip('R');
    this.skeleton.reset();
    Object.assign(this, {
      state: 'stand', stateT: 0, balance: 1, stumble: 0, restT: 0, koT: 0, airT: 0, tiltT: 0,
      diveT: 0, jumpCd: 0, phase: 0, time: 0, yawTarget: yaw, grounded: true, nearGround: true,
      groundY: pos.y, groundRate: 0, trip: 0, hitCd: 0, grabHeld: false, crouching: false,
      act: null, actCd: 0, punchSide: 1, hp: 100, paralysed: false, burnt: 0, seat: null,
      lastSwing: 'R', swingSide: null, sinceStep: 0, groundRef: pos.y, maskRestoreT: 0,
      lastHitBy: null, comboTaken: 0, emote: null, emoteT: 0,
    });
    this.events.length = 0;
    this.pendingHits.length = 0;
    this.pendingGrips.length = 0;
    this.initFeet();
  }

  initFeet() {
    this.unplantAll();
    for (const S of ['L', 'R']) {
      const f = this.partMap['foot' + S].body.position;
      const hit = groundHit(f.x, f.z, f.y + 0.3, f.y - 1.5);
      const g = hit ? hit.y : f.y - 0.035;
      const plant = new THREE.Vector3(f.x, g + 0.075, f.z);
      this.feet[S] = {
        plant, g, swing: false, t: 0, from: plant.clone(), to: plant.clone(), gFrom: g, gTo: g, cur: plant.clone(),
        plantBody: hit ? hit.body : null, normal: hit ? hit.normal : null,
      };
    }
    this.swingSide = null;
  }

  get pelvis() { return this.partMap.pelvis.body; }
  get chest() { return this.partMap.chest.body; }
  get head() { return this.partMap.head.body; }
  get brokenCount() { return this.skeleton.count; }
  get alive() { return this.hp > 0; }

  get displayState() {
    if (this.state === 'stand') {
      if (this.emote) return 'emote';
      if (this.act && this.act.type !== 'reversal') return 'attack';
      if (this.crouching) return 'crouch';
      if (!this.grounded && this.airT > 0.15) return 'air';
      return this.stumble > 0.25 ? 'stumble' : 'stand';
    }
    if (this.state === 'fall') {
      if (this.koT > 0 || this.hp <= 0) return 'ko';
      if (this.cannotStand()) return 'wrecked';
      return this.nearGround && this.restT > 0.2 ? 'down' : 'fall';
    }
    return this.state;
  }

  legFailed(S) {
    return this.skeleton.segmentFailed('thigh' + S) || this.skeleton.segmentFailed('shin' + S);
  }

  cannotStand() {
    if (this.paralysed) return true;
    if (this.skeleton.segmentFailed('pelvis')) return true;
    return this.legFailed('L') && this.legFailed('R');
  }

  enemies() {
    return Ragdoll.all.filter((r) => r !== this && r.team !== this.team);
  }

  // ---------------------------------------------------------------- collisions & damage
  onCollide(part, e) {
    const other = e.body;
    const otherRag = other.userData && other.userData.ragdoll;
    if (otherRag === this) return;
    const c = e.contact;
    const v = Math.abs(c.getImpactVelocityAlongNormal());
    const r = c.bi === part.body ? c.ri : c.rj;
    const point = new THREE.Vector3(part.body.position.x + r.x, part.body.position.y + r.y, part.body.position.z + r.z);
    if (part.def.hand && this.grabHeld && !this.grips[part.name.slice(-1)] && !(other.userData && other.userData.noGrip) && !otherRag) {
      this.pendingGrips.push({ side: part.name.slice(-1), other, part });
    }
    // tackles knock the other fighter down
    if (otherRag && this.diveT > 0 && v > 2) otherRag.pendingKnock = { by: this, v: 6 };
    const otherMass = other.type === CANNON.Body.DYNAMIC ? other.mass : 1e9;
    const massFactor = Math.min(1, 0.35 + otherMass / 60);
    this.pendingHits.push({ part, v: v * massFactor, point, other, otherRag, focus: 1, ny: Math.abs(c.ni.y) });
  }

  processHits() {
    if (this.pendingKnock) {
      const k = this.pendingKnock; this.pendingKnock = null;
      if (this.state === 'stand' || this.state === 'getup') {
        this.goFall('tackle');
        this.lastHitBy = k.by;
      }
    }
    if (this.pendingHits.length) {
      const hits = this.pendingHits;
      this.pendingHits = [];
      for (const h of hits) this.receiveHit(h);
    }
    if (this.pendingGrips.length) {
      const grips = this.pendingGrips;
      this.pendingGrips = [];
      for (const g of grips) this.makeGrip(g.side, g.part, g.other);
    }
  }

  /**
   * Central damage entry. h: {part, v, point, focus, attacker?, otherRag?, kind?, quiet?}
   */
  receiveHit(h) {
    const { part, v, point } = h;
    const isFoot = !!part.def.foot;
    const standing = this.state === 'stand' || this.state === 'getup';
    const isLeg = isFoot || part.name.startsWith('shin') || part.name.startsWith('thigh');
    const staticHit = h.other && h.other.type !== CANNON.Body.DYNAMIC;
    if (standing && isLeg && !h.kind && staticHit && v < 9.5) {
      if (isFoot && v > 1.2) this.events.push({ type: 'step', v, point, rag: this });
      // legs clipping a step edge: a walk shrugs it off, a sprint trips over it
      if (h.ny > 0.8) return; // landing on top of something, not clipping its edge
      if (this.time - (this.legHitAt || 0) < 0.15) return; // one bump per footfall, not per contact point
      this.legHitAt = this.time;
      const hs = Math.hypot(this.pelvis.velocity.x, this.pelvis.velocity.z);
      if (v > 3) this.stumble = Math.min(1, this.stumble + (v - 3) * (hs > 4.2 ? 0.1 : 0.03));
      if (hs > 4.2 && v > 3) this.trip += 0.2;
      return;
    }
    if (isFoot && v < 6.5 && !h.kind) {
      if (v > 1.2) this.events.push({ type: 'step', v, point, rag: this });
      return;
    }
    if (standing && !h.kind && isLeg && v < 3.5) return;
    if (v < 2.2) return;
    if (h.otherRag) this.lastHitBy = h.otherRag;
    if (h.attacker) this.lastHitBy = h.attacker;

    const pts = Math.round(Math.pow(Math.max(0, v - 2.5), 1.7) * 4 * part.def.mult);
    part.hurt = Math.min(1, part.hurt + v / 14);
    const dmg = Math.pow(Math.max(0, v - 2.5), 1.25) * 1.3 * part.def.mult * (h.dmgMul || 1);
    this.hp -= dmg;

    // fractures
    let broken = [];
    if (v > 6) {
      part.body.pointToLocalFrame(new CANNON.Vec3(point.x, point.y, point.z), _lp);
      broken = this.skeleton.impact(part.name, [_lp.x, _lp.y, _lp.z], v, h.focus || 1);
      if (broken.length) this.applyFractures();
    }
    this.events.push({ type: 'hit', part, v, point, pts, rag: this, broken, focus: h.focus || 1, kind: h.kind, attacker: h.attacker });

    const isHead = part.name === 'head';
    if (standing && this.state !== 'seated') {
      const knock = h.kind === 'bullet' ? (isHead ? 0 : 99) : isHead ? 5 : 7.5;
      if (v > knock) this.goFall(isHead ? 'head' : 'impact');
      else if (v > 3.2) this.stumble = Math.min(1, this.stumble + (v - 2.5) / 5);
    }
    if (isHead && v > 13 && this.koT <= 0) { this.koT = 5; this.events.push({ type: 'ko', point, rag: this }); this.goFall('ko'); }
    if (this.hp <= 0 && this.koT < 3) {
      this.koT = 8;
      this.events.push({ type: 'ko', point, rag: this, by: this.lastHitBy });
      this.goFall('ko');
    }
  }

  applyFractures() {
    const sk = this.skeleton;
    for (const j of this.joints) {
      const failed = sk.segmentFailed(j.C.name);
      j.broken = failed;
      // a broken bone above the joint also weakens it
      j.weak = sk.segmentFailed(j.P.name) && j.P.name !== 'pelvis' && j.P.name !== 'chest' ? 0.25 : 1;
    }
    if (sk.has('cervical') && this.koT < 4) { this.koT = 6; this.jointMap.neck.broken = true; }
    if (sk.has('lumbar') || sk.has('spine')) {
      const thoracic = sk.has('spine');
      this.paralysed = sk.has('lumbar') || thoracic;
    }
    if (this.paralysed) for (const n of ['hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR']) this.jointMap[n].broken = true;
    if (this.cannotStand()) this.goFall('legs');
  }

  /** Blunt trauma across the body (explosions): breaks random bones. */
  blastTrauma(intensity) {
    const b = this.skeleton.blast(intensity);
    if (b.length) {
      this.applyFractures();
      this.events.push({ type: 'blast', broken: b, rag: this, point: new THREE.Vector3().copy(this.chest.position) });
    }
    this.hp -= intensity * 70;
    if (this.hp <= 0 && this.koT < 3) { this.koT = 8; this.events.push({ type: 'ko', point: new THREE.Vector3().copy(this.head.position), rag: this }); }
  }

  goFall(reason = '') {
    this.unplantAll();
    if (this.state === 'limp' || this.state === 'seated') return;
    if (this.state !== 'fall') {
      this.state = 'fall';
      this.stateT = 0;
      this.restT = 0;
      this.act = null;
      this.events.push({ type: 'fall', reason, rag: this });
    }
  }

  knockdown(intensity = 1) {
    if (intensity > 0.15) this.goFall('blast');
    else this.stumble = Math.min(1, this.stumble + intensity * 4);
  }

  // ---------------------------------------------------------------- grips
  makeGrip(side, part, other) {
    if (this.grips[side] || !this.grabHeld || !other.world) return;
    const hand = new CANNON.Vec3(0, -0.06, 0);
    const handWorld = part.body.pointToWorldFrame(hand, new CANNON.Vec3());
    const pivotB = other.pointToLocalFrame(handWorld, new CANNON.Vec3());
    const c = new CANNON.PointToPointConstraint(part.body, hand, other, pivotB, 2800);
    world.addConstraint(c);
    this.grips[side] = { c, other };
    this.events.push({ type: 'grip', point: new THREE.Vector3(handWorld.x, handWorld.y, handWorld.z), rag: this });
  }

  releaseGrip(side) {
    const g = this.grips[side];
    if (g) { world.removeConstraint(g.c); this.grips[side] = null; }
  }

  releaseGripsOn(body) {
    for (const s of ['L', 'R']) if (this.grips[s] && this.grips[s].other === body) this.releaseGrip(s);
  }

  // ---------------------------------------------------------------- helpers
  comVelocity(out) {
    out.set(0, 0, 0);
    for (const p of this.parts) {
      const b = p.body;
      out.x += b.velocity.x * b.mass; out.y += b.velocity.y * b.mass; out.z += b.velocity.z * b.mass;
    }
    return out.multiplyScalar(1 / this.totalMass);
  }

  comPosition(out) {
    out.set(0, 0, 0);
    for (const p of this.parts) {
      const b = p.body;
      out.x += b.position.x * b.mass; out.y += b.position.y * b.mass; out.z += b.position.z * b.mass;
    }
    return out.multiplyScalar(1 / this.totalMass);
  }

  yawOf(body) {
    const q = body.quaternion;
    qc.set(q.x, q.y, q.z, q.w);
    v1.set(0, 0, 1).applyQuaternion(qc);
    return Math.atan2(v1.x, v1.z);
  }

  upOf(body, out) {
    const q = body.quaternion;
    qc.set(q.x, q.y, q.z, q.w);
    return out.set(0, 1, 0).applyQuaternion(qc);
  }

  setJ(name, x, y = 0, z = 0) {
    this.jointMap[name].target.setFromEuler(eul.set(x, y, z, 'XYZ'));
  }

  sym(base, x, y = 0, z = 0) {
    this.setJ(base + 'L', x, y, z);
    this.setJ(base + 'R', x, -y, -z);
  }

  /** Bend split across lumbar + thoracic. */
  waist(x, y = 0, z = 0) {
    this.setJ('lumbar', x * 0.55, y * 0.5, z * 0.5);
    this.setJ('thoracic', x * 0.45, y * 0.5, z * 0.5);
  }

  // ---------------------------------------------------------------- combat
  startMove(type, input) {
    if (this.state !== 'stand' || this.act || this.actCd > 0) return;
    // reversal: catch an enemy's attack while it is still winding up
    for (const e of this.enemies()) {
      if (!e.act || e.state !== 'stand' || e.act.type === 'reversal') continue;
      const def = MOVES[e.act.type];
      if (e.act.t > def.wind + 0.05) continue;
      const dx = e.pelvis.position.x - this.pelvis.position.x, dz = e.pelvis.position.z - this.pelvis.position.z;
      if (dx * dx + dz * dz > 2.3 * 2.3) continue;
      this.reversal(e);
      return;
    }
    if (type === 'kick' && !this.grounded && this.airT > 0.04) type = 'flykick';
    if (type === 'kick' && this.crouching) type = 'sweep';
    const target = input.target || this.nearestEnemy(4.5);
    if (target) {
      this.yawTarget = Math.atan2(target.pelvis.position.x - this.pelvis.position.x, target.pelvis.position.z - this.pelvis.position.z);
    } else if (input.camYaw !== undefined && this.isPlayer) this.yawTarget = input.camYaw;
    if (type === 'punch') this.punchSide = -this.punchSide;
    this.act = { type, t: 0, hit: new Set(), side: type === 'punch' ? (this.punchSide > 0 ? 'L' : 'R') : 'R' };
    {
      // every strike steps into the target a little
      const fx = Math.sin(this.yawTarget), fz = Math.cos(this.yawTarget);
      const lunge = { punch: 1.6, kick: 1.0, sweep: 0.6, shove: 2.2, flykick: 3 }[type] || 0;
      this.addVelocity(fx * lunge, type === 'flykick' ? 1.5 : 0, fz * lunge);
    }
    this.events.push({ type: 'swing', move: type, rag: this });
  }

  reversal(enemy) {
    this.act = { type: 'reversal', t: 0, hit: new Set(), side: 'L' };
    this.yawTarget = Math.atan2(enemy.pelvis.position.x - this.pelvis.position.x, enemy.pelvis.position.z - this.pelvis.position.z);
    const fx = Math.sin(this.yawTarget), fz = Math.cos(this.yawTarget);
    enemy.act = null;
    enemy.actCd = 0.8;
    enemy.goFall('reversal');
    enemy.lastHitBy = this;
    // lift and throw over the shoulder, with a flip
    for (const p of enemy.parts) {
      const up = p.name === 'head' || p.name === 'chest' ? 7.5 : 5.5;
      p.body.velocity.set(fx * 5.5, up, fz * 5.5);
    }
    enemy.chest.angularVelocity.set(fz * 9, 0, -fx * 9);
    enemy.pelvis.angularVelocity.set(fz * 7, 0, -fx * 7);
    enemy.hp -= 12;
    this.events.push({ type: 'reversal', rag: this, victim: enemy, point: new THREE.Vector3().copy(enemy.chest.position) });
  }

  nearestEnemy(maxDist) {
    let best = null, bd = maxDist * maxDist;
    for (const e of this.enemies()) {
      const dx = e.pelvis.position.x - this.pelvis.position.x, dz = e.pelvis.position.z - this.pelvis.position.z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /** During the strike window: land hits on nearby enemy parts. */
  strikeAssist() {
    const a = this.act;
    const def = MOVES[a.type];
    const sides = def.both ? ['L', 'R'] : [a.side];
    // home the striking limb on a body part of the nearest enemy in front
    if (!a.aim) {
      const e = this.nearestEnemy(1.9);
      if (e && !a.hit.has(e)) {
        const want = def.sweep ? ['shinL', 'shinR'] : a.type === 'punch' ? (Math.random() < 0.45 ? ['head'] : ['chest']) : ['chest', 'abdomen'];
        a.aim = { e, part: e.partMap[want[(Math.random() * want.length) | 0]] };
      } else a.aim = { e: null };
    }
    if (a.aim.e && !a.hit.has(a.aim.e)) {
      const tp = a.aim.part.body.position;
      for (const S of sides) {
        const lb = this.partMap[def.limbs[0] + S].body;
        const dx = tp.x - lb.position.x, dy = tp.y - lb.position.y, dz = tp.z - lb.position.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        if (d > 1.6) continue;
        const sp = def.power * 1.1;
        lb.velocity.x += (dx / d * sp - lb.velocity.x) * 0.3;
        lb.velocity.y += (dy / d * sp - lb.velocity.y) * 0.3;
        lb.velocity.z += (dz / d * sp - lb.velocity.z) * 0.3;
      }
    }
    for (const S of sides) {
      for (const limb of def.limbs) {
        const sp = this.partMap[limb + S];
        if (!sp) continue;
        const p = sp.body.position;
        for (const e of this.enemies()) {
          if (a.hit.has(e)) continue;
          if (def.high && e.crouching && e.state === 'stand') continue; // ducked under it
          for (const ep of e.parts) {
            if (!def.sweep && ep.def.foot) continue;
            if (def.sweep && !(ep.def.foot || ep.name.startsWith('shin'))) continue;
            const q = ep.body.position;
            const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
            const reach = sp.bbr + ep.bbr + 0.18;
            if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
            a.hit.add(e);
            const fx = Math.sin(this.yawTarget), fz = Math.cos(this.yawTarget);
            const pw = def.power;
            if (def.sweep) {
              // take the legs out from under him
              for (const lp of e.parts) {
                const low = lp.def.foot || lp.name.startsWith('shin') || lp.name.startsWith('thigh');
                lp.body.velocity.x += fx * (low ? pw : -1.5);
                lp.body.velocity.z += fz * (low ? pw : -1.5);
                if (low) lp.body.velocity.y += 3;
              }
              e.goFall('sweep');
            } else {
              ep.body.velocity.x += fx * pw; ep.body.velocity.z += fz * pw; ep.body.velocity.y += pw * 0.15;
              const share = def.both ? 0.45 : 0.22;
              for (const lp of e.parts) { lp.body.velocity.x += fx * pw * share; lp.body.velocity.z += fz * pw * share; }
            }
            const point = new THREE.Vector3((p.x + q.x) / 2, (p.y + q.y) / 2, (p.z + q.z) / 2);
            const rel = pw + Math.hypot(sp.body.velocity.x, sp.body.velocity.z) * 0.3;
            e.receiveHit({ part: ep, v: rel, point, focus: 1.2, attacker: this, kind: a.type, dmgMul: def.dmg });
            if (def.both) e.stumble = Math.min(1, e.stumble + 0.4);
            this.events.push({ type: 'strike', move: a.type, rag: this, victim: e, point, v: rel });
            break;
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- main update (per physics step)
  step(dt, input) {
    this.time += dt;
    this.stateT += dt;
    if (this.hitCd > 0) this.hitCd -= dt;
    if (this.jumpCd > 0) this.jumpCd -= dt;
    if (this.koT > 0) this.koT -= dt;
    if (this.diveT > 0) this.diveT -= dt;
    if (this.actCd > 0) this.actCd -= dt;
    if (this.maskRestoreT > 0) {
      this.maskRestoreT -= dt;
      if (this.maskRestoreT <= 0) for (const p of this.parts) p.body.collisionFilterMask = MASK_ALL;
    }
    this.grabHeld = !!input.grab && this.state !== 'limp' && this.state !== 'seated';
    if (!input.grab) { this.releaseGrip('L'); this.releaseGrip('R'); }

    this.processHits();
    const pelvis = this.pelvis;
    const vel = this.comVelocity(this._vel || (this._vel = new THREE.Vector3()));
    const hSpeed = Math.hypot(vel.x, vel.z);

    // ground probe below the pelvis
    const gy = groundAt(pelvis.position.x, pelvis.position.z, pelvis.position.y, pelvis.position.y - 1.9);
    let heightAbove = 99;
    const hit = gy !== null;
    if (hit) {
      const rate = (gy - this.groundY) / dt;
      this.groundRate += (Math.max(-80, Math.min(80, rate)) - this.groundRate) * Math.min(1, dt * 6);
      this.groundY = gy;
      heightAbove = pelvis.position.y - gy;
    }
    // while walking, the planned footholds are the real support: on stairs the
    // pelvis ray sees the next step down before the feet get there
    if (this.state === 'stand' && this.groundRef > (hit ? gy : -Infinity) && pelvis.position.y - this.groundRef < STAND_H + 0.45) {
      heightAbove = Math.min(heightAbove, pelvis.position.y - this.groundRef);
    }
    this.grounded = heightAbove < STAND_H + 0.3;
    this.nearGround = hit && pelvis.position.y - gy < 0.75;
    this.airT = this.grounded ? 0 : this.airT + dt;

    const chestUp = this.upOf(this.chest, v2).y;
    const pelvisUp = this.upOf(pelvis, v1).y;

    if (input.limpToggle && this.state !== 'seated') {
      if (this.state === 'limp') { this.state = 'getup'; this.stateT = 0; }
      else { this.state = 'limp'; this.stateT = 0; this.act = null; this.events.push({ type: 'limp', rag: this }); }
    }

    // ---- state machine
    if (this.state === 'stand') {
      this.stumble = Math.max(0, this.stumble - dt * 1.2);
      if (chestUp < 0.5 || pelvisUp < 0.45) this.tiltT += dt; else this.tiltT = 0;
      if (this.tiltT > 0.12) this.goFall('tilt');
      if (this.airT > 1.0 || (!this.grounded && vel.y < -9)) this.goFall('air');
      if (this.cannotStand()) this.goFall('legs');
      // pinned at the edge of balance for too long: down he goes
      this.wobbleT = this.stumble > 0.9 ? (this.wobbleT || 0) + dt : 0;
      if (this.wobbleT > 0.45) { this.wobbleT = 0; this.goFall('stumble'); }
      if (hit && heightAbove < 2.2 && this.groundRate < -1.6 && hSpeed > 3.0) {
        this.trip += dt * (hSpeed > 5 ? 1.6 : 1);
        this.stumble = Math.min(1, this.stumble + dt * 2.5);
      } else this.trip = Math.max(0, this.trip - dt * 0.5);
      if (this.trip > 0.4) {
        this.trip = 0; this.goFall('trip');
        const fy = this.yawOf(pelvis);
        // feet stop, upper body keeps going: pitch forward
        this.chest.velocity.x += Math.sin(fy) * 2.5; this.chest.velocity.z += Math.cos(fy) * 2.5;
        this.head.velocity.x += Math.sin(fy) * 3; this.head.velocity.z += Math.cos(fy) * 3;
      }
    } else if (this.state === 'fall') {
      const settled = hSpeed < 0.8 && Math.abs(vel.y) < 0.8 && this.nearGround;
      this.restT = settled ? this.restT + dt : Math.max(0, this.restT - dt * 2);
      const need = this.koT > 0 || this.hp <= 0 ? 99 : 1.5;
      if (this.restT > need && !this.cannotStand() && this.diveT <= 0) { this.state = 'getup'; this.stateT = 0; }
      if (input.jump && this.restT > 0.4 && this.koT <= 0 && this.hp > 0 && !this.cannotStand()) { this.state = 'getup'; this.stateT = 0; }
      if (this.koT <= 0 && this.hp <= 0) this.hp = 15; // came round
    } else if (this.state === 'getup') {
      if (this.stateT > 1.5) {
        if (chestUp > 0.75 && this.grounded) { this.state = 'stand'; this.stateT = 0; this.stumble = 0.4; this.initFeet(); }
        else if (this.stateT > 3.4) { this.state = 'fall'; this.stateT = 0; this.restT = 0; }
      }
      if (this.cannotStand()) { this.state = 'fall'; this.stateT = 0; }
    }
    if (this.state === 'stand' && this.hp < 100) this.hp = Math.min(100, this.hp + dt * 3);

    // ---- actions
    this.crouching = this.state === 'stand' && !!input.crouch && !this.act;
    if (this.state === 'stand') {
      if (input.jump && this.grounded && this.jumpCd <= 0 && !this.act) {
        this.jumpCd = 0.7;
        for (const p of this.parts) p.body.velocity.y += 6.2;
        this.events.push({ type: 'jump', rag: this });
      }
      if (input.dive && !this.act) {
        const fy = this.yawTarget;
        const fx = Math.sin(fy), fz = Math.cos(fy);
        for (const p of this.parts) { p.body.velocity.x += fx * 7; p.body.velocity.z += fz * 7; p.body.velocity.y += 3.4; }
        this.chest.angularVelocity.x += fz * 4; this.chest.angularVelocity.z -= fx * 4;
        this.diveT = 0.9;
        this.goFall('dive');
      }
      if (input.punch) this.startMove(input.shoveMode ? 'shove' : 'punch', input);
      if (input.kick) this.startMove(input.sweep ? 'sweep' : 'kick', input);
    }
    if (this.act) {
      const a = this.act;
      a.t += dt;
      const d = MOVES[a.type];
      if (d.limbs.length && a.t > d.wind && a.t < d.wind + d.strike) this.strikeAssist();
      if (a.t > d.wind + d.strike + d.rec) { this.act = null; this.actCd = 0.12; }
      if (this.state !== 'stand') this.act = null;
    }

    // ---- muscle strength & balance per state
    let muscle = 1, balanceTarget = 1;
    switch (this.state) {
      case 'stand': balanceTarget = 1 - this.stumble * 0.85; break;
      case 'fall':
        balanceTarget = 0;
        muscle = this.koT > 0 || this.hp <= 0 ? 0.03 : this.diveT > 0 ? 0.8 : (this.nearGround ? 0.28 : 0.5);
        break;
      case 'getup': {
        const k = Math.min(1, this.stateT / 1.2);
        balanceTarget = k * k * (3 - 2 * k);
        break;
      }
      case 'limp': balanceTarget = 0; muscle = 0; break;
      case 'seated': balanceTarget = 0; muscle = 0.9; break;
    }
    this.balance += (balanceTarget - this.balance) * (balanceTarget < this.balance ? 0.5 : 0.07);

    // ---- desired movement
    const moveLen = Math.hypot(input.moveX || 0, input.moveZ || 0);
    const wantSpeed = moveLen > 0.01 ? (input.run ? 5.8 : 1.8) * (this.crouching ? 0.5 : 1) : 0;
    let dvx = 0, dvz = 0;
    if (moveLen > 0.01 && this.state === 'stand') {
      dvx = (input.moveX / moveLen) * wantSpeed;
      dvz = (input.moveZ / moveLen) * wantSpeed;
      if (!this.act && !input.faceTarget) this.yawTarget = Math.atan2(dvx, dvz);
    }
    if (input.faceTarget && this.state === 'stand' && !this.act) {
      const t = input.faceTarget;
      this.yawTarget = Math.atan2(t.pelvis.position.x - pelvis.position.x, t.pelvis.position.z - pelvis.position.z);
    }
    if (this.grabHeld && this.state === 'stand' && moveLen < 0.01 && input.camYaw !== undefined) this.yawTarget = input.camYaw;

    if (this.emote) {
      this.emoteT += dt;
      if (this.state !== 'stand' || moveLen > 0.01 || this.act || input.jump) this.emote = null;
    }

    // ---- feet & pose
    if (this.state === 'stand') this.updateGait(dt, vel, hSpeed);
    else if (this.plants.L || this.plants.R) this.unplantAll();
    this.computePose(dt, hSpeed, vel);

    // ---- muscles
    for (const j of this.joints) this.servo(j, dt, muscle * j.weak);
    for (const j of this.joints) if (j.type === 'hinge') this.hingeLimit(j, dt);

    // ---- balance cheats
    const b = this.balance;
    if (b > 0.01) {
      const lean = this.state === 'stand' ? this.tune.lean : 0;
      v4.set(dvx * lean, 1, dvz * lean).normalize();
      const yawStrength = this.state === 'getup' ? 0.4 : 1;
      this.upright(this.pelvis, v4, this.yawTarget, b, 1400 * this.tune.upright, yawStrength, dt, this.tune.trunkGain);
      this.upright(this.partMap.abdomen.body, v4, this.yawTarget, b * 0.6, 300, yawStrength, dt);
      this.upright(this.chest, v4, this.yawTarget, b, 900 * this.tune.upright, yawStrength, dt, this.tune.trunkGain);
      this.upright(this.head, v4, this.yawTarget, b * 0.5, 40, 0.4, dt);

      if (this.grounded) {
        let targetH = STAND_H;
        let ref = this.groundY;
        if (this.state === 'stand') {
          ref = this.groundRef;
          if (this.crouching) targetH = 0.62;
          else if (this.emote) targetH -= this.emoteBob();
          else if (this.act && this.act.type === 'sweep') targetH = 0.55;
          else if (hSpeed > 0.5) targetH -= 0.03 * Math.min(1, hSpeed / 4);
        }
        if (this.state === 'getup') targetH = 0.5 + 0.43 * Math.min(1, this.stateT / 1.1);
        if (this.cannotStand()) targetH = 0.4;
        const err = ref + targetH - pelvis.position.y;
        const wh = 9;
        const ay = wh * wh * err - 2 * 0.95 * wh * vel.y;
        let Fy = this.totalMass * (ay + G_EST) * b;
        Fy = Math.max(0, Math.min(Fy, this.totalMass * G_EST * 2.6));
        let ax = (dvx - vel.x) * 5.5, az = (dvz - vel.z) * 5.5;
        const al = Math.hypot(ax, az), amax = 11;
        if (al > amax) { ax *= amax / al; az *= amax / al; }
        const hb = this.state === 'getup' ? b * 0.3 : b;
        // lift goes through the trunk; the horizontal drive goes to every
        // segment by mass, so the legs travel with the body instead of being
        // towed behind it (which pitched him forward like he was dragged)
        const shares = [[this.pelvis, 0.45], [this.partMap.abdomen.body, 0.15], [this.chest, 0.4]];
        for (const [body, s] of shares) body.force.y += Fy * s;
        const pinnedL = this.plants.L ? this.partMap.footL.body : null;
        const pinnedR = this.plants.R ? this.partMap.footR.body : null;
        for (const p of this.parts) {
          if (p.body === pinnedL || p.body === pinnedR) continue; // a planted foot stays put
          const m = p.body.mass;
          p.body.force.x += m * ax * hb;
          p.body.force.z += m * az * hb;
        }
      } else if (this.state === 'stand') {
        const ax = (dvx - vel.x) * 1.4, az = (dvz - vel.z) * 1.4;
        this.pelvis.force.x += this.totalMass * ax * 0.5 * b;
        this.pelvis.force.z += this.totalMass * az * 0.5 * b;
      }
    }

    // heavier fall: a little extra pull once he's out of control
    if (this.state === 'fall' && !this.nearGround && vel.y < 0) {
      for (const p of this.parts) p.body.force.y -= p.body.mass * 2.5;
    }

    for (const p of this.parts) if (p.hurt > 0) p.hurt = Math.max(0, p.hurt - dt * 0.6);
  }

  // ---------------------------------------------------------------- stepping planner + leg IK
  /*
   * Each foot is either PLANTED or SWINGING.
   * - Planted: pinned to whatever it stands on (ground, a crate, a moving
   *   platform) with a force-limited joint. If that thing moves, the foot goes
   *   with it; a hard shove makes the pin give and the foot slips.
   * - Swinging: the foot body is steered along an arc to a foothold found by a
   *   ray (top of the next step, a crate lid...). It is still physical: clip a
   *   step edge and it catches.
   * The pelvis rides at leg height over the average of the two footholds.
   */
  updateGait(dt, vel, hSpeed) {
    const P = this.pelvis.position;
    const yaw = this.yawOf(this.pelvis);
    const lx = Math.cos(yaw), lz = -Math.sin(yaw); // character's left
    const fx = Math.sin(yaw), fz = Math.cos(yaw);   // forward
    const run = hSpeed > 3.2;
    const stepDur = run ? Math.max(0.24, 0.34 - (hSpeed - 3.2) * 0.03) : Math.max(0.36, 0.5 - hSpeed * 0.06);
    const moving = hSpeed > 0.3;
    this.sinceStep += dt;
    const ideal = {};
    for (const [S, sx] of [['L', 1], ['R', -1]]) {
      const w = this.crouching ? 0.17 : 0.105;
      // land the foot ahead of the hip by half a stride so the body passes over it
      // running feet land closer under the body than walking ones
      const lead = run ? stepDur * this.tune.runLead : stepDur * 0.5 + 0.03;
      ideal[S] = [P.x + lx * w * sx + vel.x * lead, P.z + lz * w * sx + vel.z * lead];
    }

    // pick the next foot to move
    if (!this.swingSide) {
      const err = {};
      for (const S of ['L', 'R']) {
        const f = this.feet[S].plant;
        err[S] = Math.hypot(f.x - ideal[S][0], f.z - ideal[S][1]);
      }
      let pick = err.L > err.R ? 'L' : 'R';
      if (moving && pick === this.lastSwing) pick = pick === 'L' ? 'R' : 'L';
      const thresh = moving ? 0.06 : 0.17;
      const rest = run ? 0.0 : 0.05; // walking has a moment of double support
      if (err[pick] > thresh && this.sinceStep > rest) {
        const f = this.feet[pick];
        f.swing = true; f.t = 0; f.from.copy(f.plant); f.gFrom = f.g;
        this.unplant(pick);
        this.swingSide = pick;
      }
    }

    let gSum = 0;
    for (const [S, sx] of [['L', 1], ['R', -1]]) {
      const f = this.feet[S];
      const foot = this.partMap['foot' + S].body;
      if (f.swing) {
        f.t += dt / stepDur;
        const hitG = groundHit(ideal[S][0], ideal[S][1], P.y + 0.5, P.y - 2.3);
        let gT = hitG ? hitG.y : f.g - 0.35;
        // too high to step onto (a wall, a tall box): keep the foot where it can go
        if (gT > f.gFrom + 0.55) gT = f.gFrom;
        f.gTo = gT;
        f.toBody = hitG ? hitG.body : null;
        f.toNormal = hitG ? hitG.normal : null;
        f.to.set(ideal[S][0], gT + 0.075, ideal[S][1]);
        const k = Math.min(1, f.t);
        const s = k * k * (3 - 2 * k);
        f.cur.lerpVectors(f.from, f.to, s);
        const clear = 0.09 + Math.min(0.1, hSpeed * 0.015) + Math.max(0, f.to.y - f.from.y);
        f.cur.y += Math.sin(Math.PI * Math.min(1, k * 1.15)) * clear;
        gSum += f.gFrom + (f.gTo - f.gFrom) * s;

        // steer the real foot along the arc (velocity blend, still collides)
        const tx = f.cur.x + fx * 0.055, ty = f.cur.y - 0.04, tz = f.cur.z + fz * 0.055;
        let vx = (tx - foot.position.x) / Math.max(dt, 0.004), vy = (ty - foot.position.y) / Math.max(dt, 0.004), vz = (tz - foot.position.z) / Math.max(dt, 0.004);
        const vm = Math.hypot(vx, vy, vz), VMAX = run ? 14 : 7;
        if (vm > VMAX) { vx *= VMAX / vm; vy *= VMAX / vm; vz *= VMAX / vm; }
        const blend = run ? this.tune.runBlend : 0.3;
        foot.velocity.x += (vx - foot.velocity.x) * blend;
        foot.velocity.y += (vy - foot.velocity.y) * blend;
        foot.velocity.z += (vz - foot.velocity.z) * blend;

        if (f.t >= 1) {
          f.swing = false; f.plant.copy(f.to); f.g = f.gTo;
          this.lastSwing = S; this.swingSide = null; this.sinceStep = 0;
          this.phase += Math.PI;
          f.plantBody = f.toBody; f.normal = f.toNormal;
          this.events.push({ type: 'footfall', side: S, rag: this });
        }
      } else {
        f.cur.copy(f.plant);
        gSum += f.g;
        if (run) {
          // running has a flight phase: the back foot toes off instead of
          // staying stuck to the ground while the body runs away from it
          if (this.plants[S]) this.unplant(S);
          const hx = P.x + lx * 0.095 * sx, hz = P.z + lz * 0.095 * sx;
          const behind = -((f.plant.x - hx) * fx + (f.plant.z - hz) * fz);
          if (behind > 0.4) {
            const ex = behind - 0.4;
            f.cur.x += fx * ex; f.cur.z += fz * ex;
            f.cur.y += Math.min(0.25, ex * 0.6);
          }
        }
        // pin the foot once it is actually on something (walking and standing)
        if (!run && !this.plants[S] && f.plantBody && foot.position.y - f.g < 0.09) this.plantFoot(S, f.plantBody);
        // a pinned foot follows what it stands on (crates, platforms)
        const pl = this.plants[S];
        if (pl && pl.body.type !== CANNON.Body.STATIC) {
          const w = pl.body.pointToWorldFrame(pl.c.pivotB, new CANNON.Vec3());
          f.plant.set(w.x, w.y + 0.04, w.z); f.g = w.y;
          // something rolling or sliding under the foot throws him off balance
          if (pl.body.type === CANNON.Body.DYNAMIC) {
            const bv = pl.body.velocity, wv = pl.body.angularVelocity;
            const spd = Math.hypot(bv.x, bv.z) + Math.hypot(wv.x, wv.z) * 0.25;
            if (spd > 0.6) {
              this.stumble = Math.min(1, this.stumble + dt * (spd - 0.6) * 3);
              if (spd > 2.2) {
                this.unplant(S);
                this.stumble = Math.min(1, this.stumble + 0.35);
                // the foot shoots out the way the thing is moving
                foot.velocity.x += bv.x * 0.8; foot.velocity.z += bv.z * 0.8;
              }
            }
          }
        }
        // shoved too hard: the pin gives and the foot slides
        if (pl) {
          let sat = 0;
          for (const eq of pl.c.equations) sat = Math.max(sat, Math.abs(eq.multiplier) / eq.maxForce);
          pl.satT = sat > 0.97 ? pl.satT + dt : 0;
          if (pl.satT > 0.12) {
            this.unplant(S);
            f.plant.set(foot.position.x, f.g + 0.075, foot.position.z);
            this.stumble = Math.min(1, this.stumble + 0.25);
          }
        }
        // sole flush with the surface (slopes, ramp edges)
        if (f.normal) this.upright(foot, f.normal, yaw, 1, 60, 1, dt);
      }
    }
    const ref = gSum / 2;
    this.groundRef += (ref - this.groundRef) * Math.min(1, dt * 14);
    const sw = this.swingSide ? this.feet[this.swingSide].t : 0;
    this.gaitPhase = this.phase + (this.swingSide ? Math.PI * Math.min(1, sw) : 0);
  }

  plantFoot(S, onBody) {
    this.unplant(S);
    if (!onBody || !onBody.world) return;
    const foot = this.partMap['foot' + S].body;
    const sole = new CANNON.Vec3(0, -0.035, 0.02);
    const w = foot.pointToWorldFrame(sole, new CANNON.Vec3());
    const pivotB = onBody.pointToLocalFrame(w, new CANNON.Vec3());
    const c = new CANNON.PointToPointConstraint(foot, sole, onBody, pivotB, 1100);
    world.addConstraint(c);
    this.plants[S] = { c, body: onBody, satT: 0 };
  }

  unplant(S) {
    const pl = this.plants[S];
    if (pl) { world.removeConstraint(pl.c); this.plants[S] = null; }
  }

  unplantAll() { this.unplant('L'); this.unplant('R'); }

  legIK(S, target) {
    const sx = S === 'L' ? 1 : -1;
    const P = this.pelvis;
    // hip in world
    _lp.set(0.095 * sx, -0.05, 0);
    const hw = P.pointToWorldFrame(_lp, new CANNON.Vec3());
    qp.set(P.quaternion.x, P.quaternion.y, P.quaternion.z, P.quaternion.w).invert();
    v3.set(target.x - hw.x, target.y - hw.y, target.z - hw.z).applyQuaternion(qp);
    const down = Math.max(0.05, -v3.y);
    const fwd = v3.z;
    const lat = v3.x * sx;
    let d = Math.hypot(down, fwd);
    d = Math.max(0.25, Math.min(LEG * 2 - 0.002, d));
    const cosK = (LEG * LEG + LEG * LEG - d * d) / (2 * LEG * LEG);
    const knee = Math.PI - Math.acos(Math.max(-1, Math.min(1, cosK)));
    const phi = Math.atan2(fwd, down);
    const cosA = (LEG * LEG + d * d - LEG * LEG) / (2 * LEG * d);
    const hipX = -(phi + Math.acos(Math.max(-1, Math.min(1, cosA))));
    const hipZ = Math.atan2(lat - 0.0, down) * 0.8 * sx;
    this.setJ('hip' + S, hipX, 0, hipZ);
    this.setJ('knee' + S, Math.max(0, knee));
    this.setJ('ankle' + S, -(hipX + knee) * 0.85, 0, 0);
  }

  // ---------------------------------------------------------------- pose generation
  computePose(dt, hSpeed, vel) {
    const t = this.time;
    const st = this.state;
    const breathe = Math.sin(t * 2.2) * 0.03;

    if (st === 'seated') {
      this.sym('hip', -1.5, 0, 0.08);
      this.sym('knee', 1.45);
      this.sym('ankle', -0.1);
      this.sym('shoulder', -1.1, 0, 0.05);
      this.sym('elbow', -0.5);
      this.sym('wrist', 0);
      this.waist(0.05);
      this.setJ('neck', -0.1);
      return;
    }

    if (st === 'stand' || (st === 'getup' && this.stateT > 1.0)) {
      const L = Math.min(1, hSpeed / 5.8);
      const walk = Math.min(1, hSpeed / 0.9);
      const ph = this.gaitPhase || 0;

      if (st === 'stand' && this.grounded) {
        this.legIK('L', this.feet.L.cur);
        this.legIK('R', this.feet.R.cur);
      } else {
        this.sym('hip', -0.12, 0, 0.03);
        this.sym('knee', 0.2);
        this.sym('ankle', -0.08);
      }
      const armAmp = (0.3 + 0.7 * L) * walk;
      const st2 = this.stumble;
      this.setJ('shoulderL', Math.cos(ph) * armAmp + 0.04, 0, 0.13 + st2 * 0.9);
      this.setJ('shoulderR', -Math.cos(ph) * armAmp + 0.04, 0, -0.13 - st2 * 0.9);
      this.sym('elbow', -0.25 - 1.0 * L * walk);
      this.sym('wrist', 0);
      this.waist(0.04 + 0.22 * L + breathe, Math.cos(ph) * 0.14 * walk, 0);
      this.setJ('neck', -0.05 - 0.12 * L, 0, 0);

      if (this.crouching) {
        this.waist(0.45);
        this.sym('shoulder', -1.2, 0, 0.25);
        this.sym('elbow', -2.0);
        this.setJ('neck', -0.3);
      }
      if (!this.grounded && this.airT > 0.05 && !this.act) {
        this.sym('hip', -0.7, 0, 0.05);
        this.sym('knee', 1.2);
        this.sym('shoulder', -0.6, 0, 0.7);
        this.sym('elbow', -0.5);
      }
      if (this.emote) this.emotePose();
      if (this.act) this.movePose(this.act);
      if (this.grabHeld) {
        this.sym('shoulder', -1.5, 0, -0.05);
        this.sym('elbow', -0.1);
      }
      return;
    }

    if (st === 'getup') {
      this.sym('hip', -1.15, 0, 0.1);
      this.sym('knee', 1.7);
      this.sym('ankle', -0.35);
      this.waist(0.5);
      this.sym('shoulder', -0.9, 0, 0.3);
      this.sym('elbow', -0.6);
      this.setJ('neck', -0.2);
      return;
    }

    if (st === 'limp') return;

    if (this.diveT > 0) {
      this.sym('shoulder', -1.6, 0, 0.12);
      this.sym('elbow', -0.05);
      this.sym('hip', 0.25, 0, 0.08);
      this.sym('knee', 0.15);
      this.waist(-0.25);
      this.setJ('neck', -0.4);
      return;
    }

    if (!this.nearGround) {
      const w = 9;
      this.setJ('shoulderL', -0.8 + Math.sin(t * w) * 1.1, 0, 0.7 + Math.cos(t * w) * 0.4);
      this.setJ('shoulderR', -0.8 + Math.sin(t * w + 2) * 1.1, 0, -0.7 - Math.cos(t * w + 2) * 0.4);
      this.sym('elbow', -0.6 + Math.sin(t * 7) * 0.4);
      this.setJ('hipL', -0.5 + Math.sin(t * 8) * 0.55, 0, 0.12);
      this.setJ('hipR', -0.5 - Math.sin(t * 8) * 0.55, 0, -0.12);
      this.setJ('kneeL', 0.9 + Math.cos(t * 8) * 0.6);
      this.setJ('kneeR', 0.9 - Math.cos(t * 8) * 0.6);
      this.waist(0.2);
      this.setJ('neck', 0.25);
      return;
    }

    if (this.restT < 0.35) {
      const fy = this.yawOf(this.chest);
      const fwd = vel.x * Math.sin(fy) + vel.z * Math.cos(fy);
      const chestUp = this.upOf(this.chest, v1);
      const leanFwd = chestUp.x * Math.sin(fy) + chestUp.z * Math.cos(fy);
      if (fwd + leanFwd * 2 > 0) {
        this.sym('shoulder', -1.35, 0, 0.3);
        this.sym('elbow', -0.35);
        this.sym('wrist', -0.6);
        this.setJ('neck', -0.45);
      } else {
        this.sym('shoulder', -0.2, 0, 1.0);
        this.sym('elbow', -0.5);
        this.setJ('neck', 0.6);
      }
      this.sym('hip', -0.5, 0, 0.1);
      this.sym('knee', 0.8);
      this.waist(0.35);
      return;
    }

    const wr = Math.sin(t * 2.6) * 0.25;
    this.setJ('hipL', -1.0 + wr, 0, 0.1);
    this.setJ('hipR', -0.8 - wr, 0, -0.1);
    this.sym('knee', 1.5);
    this.sym('ankle', -0.2);
    this.waist(0.45 + wr * 0.4);
    this.setJ('shoulderL', -1.25, 0, 0.35 + wr * 0.4);
    this.setJ('shoulderR', -1.25, 0, -0.35 + wr * 0.4);
    this.sym('elbow', -1.9);
    this.setJ('neck', 0.5);
  }

  setEmote(name) {
    if (this.state !== 'stand') return;
    this.emote = name;
    this.emoteT = 0;
  }

  /** Beat phase at 118 BPM (matches the audio loop). */
  beat() { return this.emoteT * Math.PI * 2 * (118 / 60); }

  emoteBob() {
    const b = this.beat();
    switch (this.emote) {
      case 'disco': return 0.06 * Math.abs(Math.sin(b));
      case 'pollo': return 0.08 * Math.abs(Math.sin(b));
      case 'robot': return 0.02 * (Math.floor(this.emoteT * 4) % 2);
      default: return 0;
    }
  }

  emotePose() {
    const b = this.beat();
    const t = this.emoteT;
    switch (this.emote) {
      case 'disco': {
        // Saturday Night Fever: right arm stabs up and down, left hand on hip
        const up = Math.sin(b / 2) > 0;
        this.setJ('shoulderR', up ? -1.9 : 0.25, 0, up ? -0.7 : -0.35);
        this.setJ('elbowR', up ? -0.05 : -1.4);
        this.setJ('shoulderL', 0.25, 0, 0.55);
        this.setJ('elbowL', -1.7);
        this.waist(0.04, 0.12 * Math.sin(b / 2), 0.16 * Math.sin(b));
        this.setJ('neck', 0.12 * Math.sin(b * 2), 0.25 * Math.sin(b / 2), 0);
        break;
      }
      case 'robot': {
        // hold each pose for an eighth note, snap to the next
        const k = Math.floor(t * 4) % 4;
        const poses = [[-1.4, -1.57, 0.3], [-0.2, -1.57, -0.3], [-1.4, -0.4, 0.3], [-0.6, -1.57, -0.3]];
        const [sh, el, tw] = poses[k];
        const [sh2, el2] = poses[(k + 2) % 4];
        this.setJ('shoulderL', sh, 0, 0.15); this.setJ('elbowL', el);
        this.setJ('shoulderR', sh2, 0, -0.15); this.setJ('elbowR', el2);
        this.sym('wrist', 0);
        this.waist(0, tw, 0);
        this.setJ('neck', 0, -tw * 1.2, 0);
        break;
      }
      case 'pollo': {
        // chicken dance: flap the wings, peck
        const flap = 0.25 + 0.9 * Math.abs(Math.sin(b * 2));
        this.setJ('shoulderL', -0.2, 0, flap);
        this.setJ('shoulderR', -0.2, 0, -flap);
        this.sym('elbow', -2.3);
        this.sym('wrist', -0.9);
        this.waist(0.3);
        this.setJ('neck', -0.3 + 0.45 * Math.max(0, Math.sin(b * 2)));
        break;
      }
      case 'saludo': {
        this.setJ('shoulderR', -0.2, 0, -2.05);
        this.setJ('elbowR', -0.9 + 0.45 * Math.sin(t * 9));
        this.setJ('wristR', 0, 0, 0.3 * Math.sin(t * 9));
        this.setJ('shoulderL', 0.05, 0, 0.12);
        this.setJ('elbowL', -0.2);
        this.waist(0, 0, -0.08);
        this.setJ('neck', 0, 0, -0.15);
        break;
      }
    }
  }

  movePose(a) {
    const d = MOVES[a.type];
    const wind = a.t < d.wind;
    const S = a.side, O = S === 'L' ? 'R' : 'L';
    const sx = S === 'L' ? 1 : -1;
    switch (a.type) {
      case 'punch':
        if (wind) { this.setJ('shoulder' + S, 0.35, 0, 0.25 * sx); this.setJ('elbow' + S, -2.2); }
        else { this.setJ('shoulder' + S, -1.55, 0, -0.15 * sx); this.setJ('elbow' + S, -0.05); this.waist(0.12, -0.5 * sx, 0); }
        this.setJ('shoulder' + O, -0.9, 0, 0.3 * -sx);
        this.setJ('elbow' + O, -1.9);
        break;
      case 'kick':
      case 'flykick':
        if (wind) { this.setJ('hip' + S, -1.2, 0, 0); this.setJ('knee' + S, 2.0); }
        else { this.setJ('hip' + S, -1.55, 0, 0); this.setJ('knee' + S, 0.05); this.setJ('ankle' + S, 0.3); }
        if (a.type === 'flykick') { this.setJ('hip' + O, -0.4); this.setJ('knee' + O, 1.6); }
        this.waist(-0.15);
        this.sym('shoulder', -0.4, 0, 0.6);
        break;
      case 'sweep':
        this.setJ('hip' + S, wind ? -0.3 : -0.9, 0, wind ? 0.2 * sx : -0.6 * sx);
        this.setJ('knee' + S, 0.1);
        this.setJ('hip' + O, -1.3, 0, 0);
        this.setJ('knee' + O, 2.1);
        this.waist(0.5, wind ? 0.4 * sx : -0.5 * sx, 0);
        this.sym('shoulder', -0.8, 0, 0.5);
        break;
      case 'shove':
        this.sym('shoulder', wind ? -0.9 : -1.5, 0, 0.05);
        this.sym('elbow', wind ? -1.9 : -0.05);
        this.sym('wrist', -1.0);
        this.waist(wind ? 0.05 : 0.3);
        break;
      case 'reversal':
        this.sym('shoulder', -1.6, 0, -0.2);
        this.sym('elbow', -0.4);
        this.waist(0.35, -0.4, 0);
        break;
    }
  }

  // ---------------------------------------------------------------- servos
  servo(j, dt, strength) {
    // feed-forward: how fast the target pose itself is moving (parent frame).
    // Without it a servo chasing a moving target (a leg sweeping back under a
    // runner) lags behind and brakes against the ground.
    qe.copy(j.prevTarget).invert().premultiply(j.target);
    j.prevTarget.copy(j.target);
    if (qe.w < 0) { qe.x = -qe.x; qe.y = -qe.y; qe.z = -qe.z; qe.w = -qe.w; }
    let ffx = 0, ffy = 0, ffz = 0;
    {
      const w0 = Math.min(1, qe.w), sh = Math.sqrt(Math.max(0, 1 - w0 * w0));
      if (sh > 1e-6 && dt > 0) {
        let rate = (2 * Math.acos(w0)) / dt;
        if (rate > 14) rate = 0; // a pose switch, not motion: no feed-forward
        ffx = (qe.x / sh) * rate; ffy = (qe.y / sh) * rate; ffz = (qe.z / sh) * rate;
      }
    }
    const s = j.broken ? 0 : strength;
    if (s <= 0.001) return;
    const P = j.P.body, C = j.C.body;
    qp.set(P.quaternion.x, P.quaternion.y, P.quaternion.z, P.quaternion.w);
    // parent frame -> world
    v1.set(ffx, ffy, ffz).applyQuaternion(qp);
    qc.set(C.quaternion.x, C.quaternion.y, C.quaternion.z, C.quaternion.w);
    qt.multiplyQuaternions(qp, j.target);
    qc.invert();
    qe.multiplyQuaternions(qt, qc);
    if (qe.w < 0) { qe.x = -qe.x; qe.y = -qe.y; qe.z = -qe.z; qe.w = -qe.w; }
    const w = Math.min(1, qe.w);
    const sinHalf = Math.sqrt(Math.max(0, 1 - w * w));
    let ex, ey, ez;
    if (sinHalf > 1e-5) {
      const k = (2 * Math.acos(w)) / sinHalf;
      ex = qe.x * k; ey = qe.y * k; ez = qe.z * k;
    } else { ex = qe.x * 2; ey = qe.y * 2; ez = qe.z * 2; }
    const wn = j.wn * (0.45 + 0.55 * s);
    const gain = 0.55;
    const dwx = (ex * wn + v1.x - (C.angularVelocity.x - P.angularVelocity.x)) * gain;
    const dwy = (ey * wn + v1.y - (C.angularVelocity.y - P.angularVelocity.y)) * gain;
    const dwz = (ez * wn + v1.z - (C.angularVelocity.z - P.angularVelocity.z)) * gain;
    const mag = Math.hypot(dwx, dwy, dwz);
    if (mag < 1e-6) return;
    const nx = dwx / mag, ny = dwy / mag, nz = dwz / mag;
    const invI = invInertiaAlong(C, nx, ny, nz) + invInertiaAlong(P, nx, ny, nz);
    let J = mag / invI;
    const Jmax = j.torque * s * dt;
    if (J > Jmax) J = Jmax;
    applyAngularImpulse(C, nx * J, ny * J, nz * J);
    // while balancing, the hip's push on the pelvis is soaked up by the balance
    // layer (a real body would push it into the ground through the foot)
    const react = j.hipJoint && this.balance > 0.5 ? this.tune.hipReaction : 1;
    applyAngularImpulse(P, -nx * J * react, -ny * J * react, -nz * J * react);
  }

  hingeLimit(j, dt) {
    const P = j.P.body, C = j.C.body;
    qp.set(P.quaternion.x, P.quaternion.y, P.quaternion.z, P.quaternion.w);
    qc.set(C.quaternion.x, C.quaternion.y, C.quaternion.z, C.quaternion.w);
    qt.copy(qp).invert().multiply(qc);
    v1.set(0, -1, 0).applyQuaternion(qt);
    const th = Math.atan2(-v1.z, -v1.y);
    const [lo, hi] = j.limits;
    let err = 0;
    if (th > hi) err = hi - th; else if (th < lo) err = lo - th; else return;
    v2.set(1, 0, 0).applyQuaternion(qp);
    const wrel = (C.angularVelocity.x - P.angularVelocity.x) * v2.x
      + (C.angularVelocity.y - P.angularVelocity.y) * v2.y
      + (C.angularVelocity.z - P.angularVelocity.z) * v2.z;
    const dv = err * 25 - wrel;
    if (Math.sign(dv) !== Math.sign(err)) return;
    const invI = invInertiaAlong(C, v2.x, v2.y, v2.z) + invInertiaAlong(P, v2.x, v2.y, v2.z);
    let J = dv / invI;
    const Jmax = (j.broken ? 250 : 1000) * dt;
    J = Math.max(-Jmax, Math.min(Jmax, J));
    applyAngularImpulse(C, v2.x * J, v2.y * J, v2.z * J);
    applyAngularImpulse(P, -v2.x * J, -v2.y * J, -v2.z * J);
  }

  upright(body, upDes, yawDes, strength, maxTorque, yawStrength, dt, inertiaGain = 1) {
    qc.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    const up = v2.set(0, 1, 0).applyQuaternion(qc);
    const cx = up.y * upDes.z - up.z * upDes.y;
    const cy = up.z * upDes.x - up.x * upDes.z;
    const cz = up.x * upDes.y - up.y * upDes.x;
    const sn = Math.hypot(cx, cy, cz);
    const cs = up.x * upDes.x + up.y * upDes.y + up.z * upDes.z;
    const ang = Math.atan2(sn, cs);
    let ex = 0, ey = 0, ez = 0;
    if (sn > 1e-6) { ex = (cx / sn) * ang; ey = (cy / sn) * ang; ez = (cz / sn) * ang; }
    else if (cs < 0) { ex = Math.PI; }
    const fwd = v3.set(0, 0, 1).applyQuaternion(qc);
    let yErr = yawDes - Math.atan2(fwd.x, fwd.z);
    yErr = Math.atan2(Math.sin(yErr), Math.cos(yErr));
    const yawW = Math.max(0, up.y) * yawStrength;
    const wu = 11, wy = 8;
    const dwx = (ex * wu - body.angularVelocity.x) * 0.4;
    const dwy = (ey * wu + yErr * wy * yawW - body.angularVelocity.y) * 0.4;
    const dwz = (ez * wu - body.angularVelocity.z) * 0.4;
    const mag = Math.hypot(dwx, dwy, dwz);
    if (mag < 1e-6) return;
    const nx = dwx / mag, ny = dwy / mag, nz = dwz / mag;
    // inertiaGain: the trunk segments drag the rest of the body with them, so
    // their effective inertia is several times their own
    let J = (mag / invInertiaAlong(body, nx, ny, nz)) * inertiaGain;
    const Jmax = maxTorque * strength * dt;
    if (J > Jmax) J = Jmax;
    applyAngularImpulse(body, nx * J, ny * J, nz * J);
  }

  /** Visual-only update (once per frame). */
  updateVisuals() {
    for (const p of this.parts) {
      const failed = this.skeleton.segmentFailed(p.name);
      const k = Math.min(1, p.hurt * 0.7);
      p.mat.color.copy(p.baseColor);
      if (this.burnt > 0) p.mat.color.lerp(new THREE.Color(0x1d1a17), Math.min(0.85, this.burnt));
      if (failed) p.mat.color.lerp(BRUISE, 0.45);
      if (k > 0) p.mat.color.lerp(HURT, k);
    }
  }

  addVelocity(x, y, z, spin = 0) {
    for (const p of this.parts) {
      p.body.velocity.x += x; p.body.velocity.y += y; p.body.velocity.z += z;
      if (spin) {
        p.body.angularVelocity.x += (Math.random() - 0.5) * spin;
        p.body.angularVelocity.z += (Math.random() - 0.5) * spin;
      }
    }
  }

  setCollisionMask(mask, restoreAfter = 0) {
    for (const p of this.parts) p.body.collisionFilterMask = mask;
    this.maskRestoreT = restoreAfter;
  }

  isOwnBody(b) { return !!(b.userData && b.userData.ragdoll === this); }
}

export { BONE_COUNT, MOVES };
