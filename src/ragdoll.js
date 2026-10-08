import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  world, GROUP, MASK_ALL, MAT, FIXED_DT,
  invInertiaAlong, applyAngularImpulse, track,
} from './physics.js';
import { headTexture, torsoTexture } from './textures.js';

/*
 * Active ragdoll ("Euphoria"-style).
 * - Every joint has a muscle: a velocity-level PD servo that applies equal and
 *   opposite angular impulses to parent/child, capped by a max torque. Weak
 *   muscles = floppy, strong muscles = posed.
 * - Balance is a "cheat" layer (as every active ragdoll game does): upright
 *   torques on pelvis/chest, a spring that holds the pelvis at standing height
 *   while there is ground under it, and horizontal drive for walking.
 * - Impacts reduce balance (stumble) or switch it off entirely (fall). Then the
 *   body is fully physical with low muscle tone, it braces, flails, curls up,
 *   and gets up again once it has come to rest.
 */

const D2R = Math.PI / 180;
const G = 9.82;

// Character-local rest pose: facing +Z, left = +X, feet on y = 0.
const PART_DEFS = [
  { name: 'pelvis', kind: 'box', he: [0.16, 0.10, 0.11], pos: [0, 0.97, 0], mass: 10, mult: 1.0, label: 'CADERA' },
  { name: 'chest', kind: 'box', he: [0.18, 0.17, 0.115], pos: [0, 1.255, 0], mass: 16, mult: 1.2, label: 'COSTILLAS' },
  { name: 'head', kind: 'sphere', r: 0.115, pos: [0, 1.565, 0.01], mass: 5, mult: 2.2, label: 'CABEZA' },
  { name: 'upperArmL', kind: 'limb', len: 0.30, r: 0.055, top: [0.25, 1.37, 0], mass: 2.5, mult: 0.8, label: 'HOMBRO' },
  { name: 'lowerArmL', kind: 'limb', len: 0.30, r: 0.048, top: [0.25, 1.07, 0], mass: 2.0, mult: 0.8, hand: true, label: 'BRAZO' },
  { name: 'upperArmR', kind: 'limb', len: 0.30, r: 0.055, top: [-0.25, 1.37, 0], mass: 2.5, mult: 0.8, label: 'HOMBRO' },
  { name: 'lowerArmR', kind: 'limb', len: 0.30, r: 0.048, top: [-0.25, 1.07, 0], mass: 2.0, mult: 0.8, hand: true, label: 'BRAZO' },
  { name: 'thighL', kind: 'limb', len: 0.42, r: 0.075, top: [0.095, 0.92, 0], mass: 8, mult: 0.9, label: 'FÉMUR' },
  { name: 'shinL', kind: 'limb', len: 0.42, r: 0.06, top: [0.095, 0.50, 0], mass: 4, mult: 0.9, label: 'TIBIA' },
  { name: 'footL', kind: 'box', he: [0.055, 0.035, 0.12], pos: [0.095, 0.035, 0.055], mass: 1.2, mult: 0.6, foot: true, label: 'TOBILLO' },
  { name: 'thighR', kind: 'limb', len: 0.42, r: 0.075, top: [-0.095, 0.92, 0], mass: 8, mult: 0.9, label: 'FÉMUR' },
  { name: 'shinR', kind: 'limb', len: 0.42, r: 0.06, top: [-0.095, 0.50, 0], mass: 4, mult: 0.9, label: 'TIBIA' },
  { name: 'footR', kind: 'box', he: [0.055, 0.035, 0.12], pos: [-0.095, 0.035, 0.055], mass: 1.2, mult: 0.6, foot: true, label: 'TOBILLO' },
];

function n3(x, y, z) { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; }

function jointDefs() {
  const defs = [
    { name: 'waist', parent: 'pelvis', child: 'chest', at: [0, 1.08, 0], type: 'cone', axisA: n3(0, 0.95, 0.3), axisB: [0, 1, 0], angle: 0.7, twist: 0.5, torque: 520, wn: 15 },
    { name: 'neck', parent: 'chest', child: 'head', at: [0, 1.44, 0], type: 'cone', axisA: n3(0, 1, 0.15), axisB: [0, 1, 0], angle: 0.75, twist: 0.9, torque: 90, wn: 13 },
  ];
  for (const [s, sx] of [['L', 1], ['R', -1]]) {
    defs.push(
      { name: 'shoulder' + s, parent: 'chest', child: 'upperArm' + s, at: [0.25 * sx, 1.37, 0], type: 'cone', axisA: n3(0.6 * sx, -0.35, 0.55), axisB: [0, -1, 0], angle: 1.65, twist: 1.0, torque: 130, wn: 13, side: sx },
      { name: 'elbow' + s, parent: 'upperArm' + s, child: 'lowerArm' + s, at: [0.25 * sx, 1.07, 0], type: 'hinge', limits: [-2.6, 0.02], torque: 90, wn: 14, side: sx },
      { name: 'hip' + s, parent: 'pelvis', child: 'thigh' + s, at: [0.095 * sx, 0.92, 0], type: 'cone', axisA: n3(0.15 * sx, -0.8, 0.55), axisB: [0, -1, 0], angle: 1.25, twist: 0.5, torque: 420, wn: 15, side: sx },
      { name: 'knee' + s, parent: 'thigh' + s, child: 'shin' + s, at: [0.095 * sx, 0.50, 0], type: 'hinge', limits: [-0.02, 2.5], torque: 340, wn: 15, side: sx },
      { name: 'ankle' + s, parent: 'shin' + s, child: 'foot' + s, at: [0.095 * sx, 0.08, 0], type: 'cone', axisA: [0, -1, 0], axisB: [0, -1, 0], angle: 0.55, twist: 0.3, torque: 140, wn: 13, side: sx },
    );
  }
  return defs;
}

// scratch
const qp = new THREE.Quaternion();
const qc = new THREE.Quaternion();
const qt = new THREE.Quaternion();
const qe = new THREE.Quaternion();
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const eul = new THREE.Euler();
const rayResult = new CANNON.RaycastResult();
const rayFrom = new CANNON.Vec3();
const rayTo = new CANNON.Vec3();

const BODY_COLOR = 0xf2c14e;
const DARK = 0x2a2a30;
const HURT = new THREE.Color(0xe0553a);

export const STATE_LABEL = {
  stand: 'DE PIE', stumble: 'TAMBALEANDO', fall: 'CAYENDO', down: 'EN EL SUELO',
  ko: 'K.O.', getup: 'LEVANTÁNDOSE', limp: 'HACIÉNDOSE EL MUERTO', air: 'EN EL AIRE', wrecked: 'DESTROZADO',
};

export class Ragdoll {
  constructor(scene) {
    this.scene = scene;
    this.parts = [];
    this.partMap = {};
    this.joints = [];
    this.jointMap = {};
    this.events = [];
    this.totalMass = 0;
    this.grips = { L: null, R: null };
    this.build();
    this.reset(new THREE.Vector3(0, 0, 0), 0);
  }

  // ---------------------------------------------------------------- build
  build() {
    const yellow = new THREE.MeshStandardMaterial({ color: BODY_COLOR, roughness: 0.55, metalness: 0.05 });
    const dark = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.7 });
    const headMat = new THREE.MeshStandardMaterial({ map: headTexture(), roughness: 0.45 });
    const chestMat = new THREE.MeshStandardMaterial({ map: torsoTexture(), roughness: 0.55 });

    for (const d of PART_DEFS) {
      const body = new CANNON.Body({
        mass: d.mass,
        material: MAT.ragdoll,
        collisionFilterGroup: GROUP.RAGDOLL,
        collisionFilterMask: MASK_ALL,
        linearDamping: 0.02,
        angularDamping: 0.12,
        allowSleep: false,
      });
      let center;
      const group = new THREE.Group();
      let mainMat;
      if (d.kind === 'box') {
        body.addShape(new CANNON.Box(new CANNON.Vec3(...d.he)));
        center = new THREE.Vector3(...d.pos);
        const isChest = d.name === 'chest';
        mainMat = (isChest ? chestMat : (d.foot || d.name === 'pelvis' ? dark : yellow)).clone();
        const geo = new RoundedBoxGeometry(d.he[0] * 2, d.he[1] * 2, d.he[2] * 2, 3, Math.min(...d.he) * 0.6);
        const m = new THREE.Mesh(geo, mainMat);
        m.castShadow = true; m.receiveShadow = true;
        group.add(m);
        if (isChest) {
          // shoulder balls
          for (const sx of [1, -1]) {
            const b = new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 12), dark);
            b.position.set(0.23 * sx, 0.11, 0); b.castShadow = true;
            group.add(b);
          }
          const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.08, 12), dark);
          neck.position.set(0, 0.2, 0); group.add(neck);
        }
        if (d.name === 'pelvis') {
          for (const sx of [1, -1]) {
            const b = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), dark);
            b.position.set(0.095 * sx, -0.05, 0); group.add(b);
          }
        }
      } else if (d.kind === 'sphere') {
        body.addShape(new CANNON.Sphere(d.r));
        center = new THREE.Vector3(...d.pos);
        mainMat = headMat.clone();
        const m = new THREE.Mesh(new THREE.SphereGeometry(d.r, 28, 20), mainMat);
        m.rotation.y = Math.PI / 2;
        m.castShadow = true;
        group.add(m);
        // visor
        const visor = new THREE.Mesh(
          new THREE.SphereGeometry(d.r * 1.01, 24, 12, -0.9, 1.8, Math.PI * 0.36, Math.PI * 0.2),
          new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.15, metalness: 0.6 }),
        );
        visor.rotation.y = 0; // faces +Z
        group.add(visor);
      } else {
        const n = Math.max(2, Math.round(d.len / d.r / 1.5));
        const y0 = -d.len / 2 + d.r * 0.6, y1 = d.len / 2 - d.r * 0.6;
        for (let i = 0; i < n; i++) {
          const y = y0 + ((y1 - y0) * i) / (n - 1);
          body.addShape(new CANNON.Sphere(d.r), new CANNON.Vec3(0, y, 0));
        }
        if (d.hand) body.addShape(new CANNON.Sphere(0.055), new CANNON.Vec3(0, -d.len / 2 - 0.035, 0));
        center = new THREE.Vector3(d.top[0], d.top[1] - d.len / 2, d.top[2]);
        mainMat = yellow.clone();
        const m = new THREE.Mesh(new THREE.CapsuleGeometry(d.r, d.len - d.r, 6, 14), mainMat);
        m.castShadow = true; m.receiveShadow = true;
        group.add(m);
        // joint ball at the top for knees/elbows
        if (d.name.startsWith('lower') || d.name.startsWith('shin')) {
          const b = new THREE.Mesh(new THREE.SphereGeometry(d.r * 1.12, 14, 10), dark);
          b.position.y = d.len / 2; group.add(b);
        }
        if (d.hand) {
          const h = new THREE.Mesh(new THREE.SphereGeometry(0.058, 16, 12), dark);
          h.position.y = -d.len / 2 - 0.035; h.scale.set(0.9, 1.15, 0.8); h.castShadow = true;
          group.add(h);
        }
      }
      this.scene.add(group);
      world.addBody(body);
      const part = {
        name: d.name, def: d, body, mesh: group, restPos: center, mat: mainMat,
        baseColor: mainMat.color.clone(), hurt: 0, lastHit: 0,
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
      const j = {
        ...jd, P, C, constraint: c, target: new THREE.Quaternion(), broken: false,
      };
      this.joints.push(j);
      this.jointMap[jd.name] = j;
      C.joint = j;
    }
  }

  // ---------------------------------------------------------------- reset
  reset(pos, yaw) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    for (const p of this.parts) {
      const wp = p.restPos.clone().applyQuaternion(q).add(pos);
      p.body.position.set(wp.x, wp.y + 0.02, wp.z);
      p.body.quaternion.set(q.x, q.y, q.z, q.w);
      p.body.velocity.setZero();
      p.body.angularVelocity.setZero();
      p.body.force.setZero();
      p.body.torque.setZero();
      p.body.previousPosition.copy(p.body.position);
      p.body.interpolatedPosition.copy(p.body.position);
      p.hurt = 0;
      p.mat.color.copy(p.baseColor);
    }
    for (const j of this.joints) { j.broken = false; j.target.identity(); }
    this.releaseGrip('L'); this.releaseGrip('R');
    this.state = 'stand';
    this.stateT = 0;
    this.balance = 1;
    this.stumble = 0;
    this.restT = 0;
    this.koT = 0;
    this.airT = 0;
    this.tiltT = 0;
    this.diveT = 0;
    this.punchT = 0;
    this.punchSide = 1;
    this.punchFired = false;
    this.jumpCd = 0;
    this.phase = 0;
    this.time = 0;
    this.yawTarget = yaw;
    this.grounded = true;
    this.groundY = pos.y;
    this.groundRate = 0;
    this.trip = 0;
    this.brokenCount = 0;
    this.hitCd = 0;
    this.grabHeld = false;
    this.events.length = 0;
    this.speedSmoothed = 0;
    this.fallReason = '';
  }

  get pelvis() { return this.partMap.pelvis.body; }
  get chest() { return this.partMap.chest.body; }
  get head() { return this.partMap.head.body; }

  /** Rich state name for the HUD. */
  get displayState() {
    if (this.state === 'stand') {
      if (!this.grounded && this.airT > 0.15) return 'air';
      return this.stumble > 0.25 ? 'stumble' : 'stand';
    }
    if (this.state === 'fall') {
      if (this.koT > 0) return 'ko';
      if (this.cannotStand()) return 'wrecked';
      return this.grounded && this.restT > 0.2 ? 'down' : 'fall';
    }
    return this.state;
  }

  cannotStand() {
    let L = 0, R = 0;
    for (const n of ['hipL', 'kneeL']) if (this.jointMap[n].broken) L++;
    for (const n of ['hipR', 'kneeR']) if (this.jointMap[n].broken) R++;
    return L > 0 && R > 0;
  }

  // ---------------------------------------------------------------- collisions
  onCollide(part, e) {
    const other = e.body;
    if (other.userData && other.userData.ragdoll === this) return;
    const c = e.contact;
    const v = Math.abs(c.getImpactVelocityAlongNormal());
    const r = c.bi === part.body ? c.ri : c.rj;
    const point = new THREE.Vector3(
      part.body.position.x + r.x, part.body.position.y + r.y, part.body.position.z + r.z,
    );
    // Grip with hands
    if (part.def.hand && this.grabHeld) {
      const side = part.name.endsWith('L') ? 'L' : 'R';
      if (!this.grips[side] && !(other.userData && other.userData.noGrip)) this.pendingGrips = (this.pendingGrips || []).concat([{ side, other, part }]);
    }
    const otherMass = other.type === CANNON.Body.DYNAMIC ? other.mass : 1e9;
    const isProjectile = !!(other.userData && other.userData.projectile);
    // light objects hit less hard
    const massFactor = Math.min(1, 0.35 + otherMass / 60);
    this.pendingHits = this.pendingHits || [];
    this.pendingHits.push({ part, v: v * massFactor, rawV: v, point, other, isProjectile });
  }

  processHits() {
    const hits = this.pendingHits;
    this.pendingHits = [];
    if (hits) for (const h of hits) this.handleHit(h);
    const grips = this.pendingGrips;
    this.pendingGrips = [];
    if (grips) for (const g of grips) this.makeGrip(g.side, g.part, g.other);
  }

  handleHit({ part, v, point, isProjectile }) {
    const isFoot = !!part.def.foot;
    const standing = this.state === 'stand' || this.state === 'getup';
    if (isFoot && v < 6) {
      if (v > 1.2) this.events.push({ type: 'step', v, point });
      return;
    }
    // While standing, the lower legs brushing stuff while walking shouldn't hurt
    if (standing && (part.name.startsWith('shin') || part.name.startsWith('thigh')) && v < 3.5 && !isProjectile) return;
    if (v < 2.2) return;

    const pts = Math.round(Math.pow(Math.max(0, v - 2.5), 1.7) * 4 * part.def.mult);
    this.events.push({ type: 'hit', part, v, point, pts });
    part.hurt = Math.min(1, part.hurt + v / 14);

    const isHead = part.name === 'head';
    if (standing) {
      const knock = isHead ? 5 : 7.5;
      if (v > knock) {
        this.goFall(isHead ? 'head' : 'impact');
      } else if (v > 3.2) {
        this.stumble = Math.min(1, this.stumble + (v - 2.5) / 5);
      }
    }

    // Bone breaks & knockouts
    if (v > 14 && this.hitCd <= 0) {
      if (isHead) {
        if (this.koT <= 0) this.events.push({ type: 'ko', point });
        this.koT = 4.5;
        this.goFall('ko');
      }
      const j = part.joint;
      if (j && !j.broken && j.name !== 'waist') {
        j.broken = true;
        this.brokenCount++;
        this.events.push({ type: 'break', part, joint: j, point });
        this.hitCd = 0.15;
      }
      if (part.name === 'chest' || part.name === 'pelvis') {
        // ribs/pelvis: break a random attached limb instead for drama
        const cand = this.joints.filter((jj) => jj.P === part && !jj.broken && jj.name !== 'waist');
        if (cand.length && Math.random() < 0.5) {
          const jj = cand[(Math.random() * cand.length) | 0];
          jj.broken = true;
          this.brokenCount++;
          this.events.push({ type: 'break', part: jj.C, joint: jj, point });
          this.hitCd = 0.15;
        }
      }
    }
  }

  goFall(reason = '') {
    if (this.state === 'limp') return;
    if (this.state !== 'fall') {
      this.state = 'fall';
      this.stateT = 0;
      this.restT = 0;
      this.fallReason = reason;
      this.events.push({ type: 'fall', reason });
    }
  }

  knockdown(intensity = 1) {
    if (intensity > 0.15) this.goFall('blast');
    else this.stumble = Math.min(1, this.stumble + intensity * 4);
  }

  // ---------------------------------------------------------------- grips
  makeGrip(side, part, other) {
    if (this.grips[side] || !this.grabHeld) return;
    const hand = new CANNON.Vec3(0, -part.def.len / 2 - 0.035, 0);
    const handWorld = part.body.pointToWorldFrame(hand, new CANNON.Vec3());
    const pivotB = other.pointToLocalFrame(handWorld, new CANNON.Vec3());
    const c = new CANNON.PointToPointConstraint(part.body, hand, other, pivotB, 2600);
    world.addConstraint(c);
    this.grips[side] = { c, other };
    this.events.push({ type: 'grip', point: new THREE.Vector3(handWorld.x, handWorld.y, handWorld.z) });
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

  /** Mirror helper: values are for the LEFT side; right gets y/z negated. */
  sym(base, x, y = 0, z = 0) {
    this.setJ(base + 'L', x, y, z);
    this.setJ(base + 'R', x, -y, -z);
  }

  // ---------------------------------------------------------------- main update (per physics step)
  step(dt, input) {
    this.time += dt;
    this.stateT += dt;
    if (this.hitCd > 0) this.hitCd -= dt;
    if (this.jumpCd > 0) this.jumpCd -= dt;
    if (this.koT > 0) this.koT -= dt;
    if (this.diveT > 0) this.diveT -= dt;
    this.grabHeld = !!input.grab && this.state !== 'limp';
    if (!input.grab) { this.releaseGrip('L'); this.releaseGrip('R'); }

    this.processHits();
    const pelvis = this.pelvis;
    const vel = this.comVelocity(this._vel || (this._vel = new THREE.Vector3()));
    const hSpeed = Math.hypot(vel.x, vel.z);

    // ground probe below the pelvis
    rayFrom.copy(pelvis.position);
    rayTo.set(pelvis.position.x, pelvis.position.y - 1.7, pelvis.position.z);
    rayResult.reset();
    const hit = world.raycastClosest(rayFrom, rayTo, {
      collisionFilterMask: GROUP.STATIC | GROUP.PROP, skipBackfaces: true,
    }, rayResult);
    const STAND_H = 0.95;
    let heightAbove = 99;
    if (hit) {
      const gy = rayResult.hitPointWorld.y;
      const rate = (gy - this.groundY) / dt;
      this.groundRate += (Math.max(-80, Math.min(80, rate)) - this.groundRate) * Math.min(1, dt * 6);
      this.groundY = gy;
      heightAbove = pelvis.position.y - this.groundY;
    }
    this.grounded = hit && heightAbove < STAND_H + 0.28;
    this.nearGround = hit && heightAbove < 0.75;
    this.airT = this.grounded ? 0 : this.airT + dt;

    const chestUp = this.upOf(this.chest, v2).y;
    const pelvisUp = this.upOf(pelvis, v1).y;

    // --- input-driven actions
    if (input.limpToggle) {
      if (this.state === 'limp') { this.state = 'getup'; this.stateT = 0; }
      else { this.state = 'limp'; this.stateT = 0; this.events.push({ type: 'limp' }); }
    }

    // --- state machine
    if (this.state === 'stand') {
      this.stumble = Math.max(0, this.stumble - dt * 1.4);
      if (chestUp < 0.5 || pelvisUp < 0.45) this.tiltT += dt; else this.tiltT = 0;
      if (this.tiltT > 0.12) this.goFall('tilt');
      if (this.airT > 1.1 || (!this.grounded && vel.y < -9)) this.goFall('air');
      if (this.cannotStand()) this.goFall('legs');
      // running down steep stuff (stairs!) makes him trip
      if (hit && heightAbove < 2.2 && this.groundRate < -1.6 && hSpeed > 3.0) {
        this.trip += dt;
        this.stumble = Math.min(1, this.stumble + dt * 2.5);
      } else this.trip = Math.max(0, this.trip - dt * 0.5);
      if (this.trip > 0.45) { this.trip = 0; this.goFall('trip'); this.addVelocity(0, 1.2, 0, 4); }
    } else if (this.state === 'fall') {
      const settled = hSpeed < 0.8 && Math.abs(vel.y) < 0.8 && this.nearGround;
      this.restT = settled ? this.restT + dt : Math.max(0, this.restT - dt * 2);
      const need = this.koT > 0 ? 99 : 1.4;
      if (this.restT > need && !this.cannotStand() && this.diveT <= 0) {
        this.state = 'getup'; this.stateT = 0;
      }
      if (input.jump && this.restT > 0.4 && this.koT <= 0 && !this.cannotStand()) { this.state = 'getup'; this.stateT = 0; }
    } else if (this.state === 'getup') {
      if (this.stateT > 1.5) {
        if (chestUp > 0.75 && this.grounded) { this.state = 'stand'; this.stateT = 0; this.stumble = 0.4; }
        else if (this.stateT > 3.2) { this.state = 'fall'; this.stateT = 0; this.restT = 0; }
      }
      if (this.cannotStand()) { this.state = 'fall'; this.stateT = 0; }
    }

    // actions only while standing
    if (this.state === 'stand') {
      if (input.jump && this.grounded && this.jumpCd <= 0) {
        this.jumpCd = 0.7;
        for (const p of this.parts) p.body.velocity.y += 5.4;
        this.events.push({ type: 'jump' });
      }
      if (input.dive) {
        const fy = this.yawTarget;
        const fx = Math.sin(fy), fz = Math.cos(fy);
        for (const p of this.parts) {
          p.body.velocity.x += fx * 6.5; p.body.velocity.z += fz * 6.5; p.body.velocity.y += 3.2;
        }
        this.chest.angularVelocity.x += fz * 4; this.chest.angularVelocity.z -= fx * 4;
        this.diveT = 0.9;
        this.goFall('dive');
      }
      if (input.punch && this.punchT <= 0) {
        this.punchT = 0.34;
        this.punchSide = -this.punchSide;
        this.punchFired = false;
        this.yawTarget = input.camYaw;
      }
    }
    if (this.punchT > 0) this.punchT -= dt;

    // --- muscle strength & balance per state
    let muscle = 1, balanceTarget = 1;
    switch (this.state) {
      case 'stand': balanceTarget = 1 - this.stumble * 0.85; muscle = 1; break;
      case 'fall':
        balanceTarget = 0;
        muscle = this.koT > 0 ? 0.04 : this.diveT > 0 ? 0.8 : (this.nearGround ? 0.32 : 0.55);
        break;
      case 'getup': {
        const k = Math.min(1, this.stateT / 1.1);
        balanceTarget = k * k * (3 - 2 * k);
        muscle = 1;
        break;
      }
      case 'limp': balanceTarget = 0; muscle = 0; break;
    }
    // balance snaps down fast, recovers smoothly
    this.balance += (balanceTarget - this.balance) * (balanceTarget < this.balance ? 0.5 : 0.08);

    // --- desired movement
    const moveLen = Math.hypot(input.moveX, input.moveZ);
    const wantSpeed = moveLen > 0.01 ? (input.run ? 5.4 : 2.7) : 0;
    let dvx = 0, dvz = 0;
    if (moveLen > 0.01 && this.state === 'stand') {
      dvx = (input.moveX / moveLen) * wantSpeed;
      dvz = (input.moveZ / moveLen) * wantSpeed;
      if (this.punchT <= 0) this.yawTarget = Math.atan2(dvx, dvz);
    }
    if (this.grabHeld && this.state === 'stand' && moveLen < 0.01) this.yawTarget = input.camYaw;

    // --- pose
    this.computePose(dt, hSpeed, vel);

    // --- muscles
    for (const j of this.joints) this.servo(j, dt, muscle);
    for (const j of this.joints) if (j.type === 'hinge') this.hingeLimit(j, dt);

    // --- punch impulse
    if (this.punchT > 0 && this.punchT < 0.27 && !this.punchFired) {
      this.punchFired = true;
      const arm = this.partMap[this.punchSide > 0 ? 'lowerArmL' : 'lowerArmR'].body;
      const fy = this.yawTarget;
      arm.velocity.x += Math.sin(fy) * 9; arm.velocity.z += Math.cos(fy) * 9; arm.velocity.y += 1.0;
      this.events.push({ type: 'punch' });
    }

    // --- balance cheats
    const b = this.balance;
    if (b > 0.01) {
      const lean = this.state === 'stand' ? 0.035 : 0;
      v1.set(dvx * lean, 1, dvz * lean).normalize();
      const yawStrength = this.state === 'getup' ? 0.4 : 1;
      this.upright(this.pelvis, v1, this.yawTarget, b, 700, yawStrength, dt);
      this.upright(this.chest, v1, this.yawTarget, b, 620, yawStrength, dt);
      this.upright(this.head, v1, this.yawTarget, b * 0.5, 40, 0.4, dt);

      if (this.grounded) {
        let targetH = STAND_H;
        if (this.state === 'getup') targetH = 0.55 + 0.4 * Math.min(1, this.stateT / 1.0);
        if (hSpeed > 0.5) targetH -= 0.035 * Math.abs(Math.sin(this.phase * 2)) * Math.min(1, hSpeed / 4);
        if (this.cannotStand()) targetH = 0.4;
        const err = this.groundY + targetH - pelvis.position.y;
        const wh = 11;
        let ay = wh * wh * err - 2 * 0.9 * wh * vel.y;
        let Fy = this.totalMass * (ay + G) * b;
        Fy = Math.max(0, Math.min(Fy, this.totalMass * G * 3.2));
        // horizontal drive
        let ax = (dvx - vel.x) * 7, az = (dvz - vel.z) * 7;
        const al = Math.hypot(ax, az), amax = 14;
        if (al > amax) { ax *= amax / al; az *= amax / al; }
        const hb = this.state === 'getup' ? b * 0.3 : b;
        const Fx = this.totalMass * ax * hb, Fz = this.totalMass * az * hb;
        this.pelvis.force.x += Fx * 0.55; this.pelvis.force.y += Fy * 0.55; this.pelvis.force.z += Fz * 0.55;
        this.chest.force.x += Fx * 0.45; this.chest.force.y += Fy * 0.45; this.chest.force.z += Fz * 0.45;
      } else if (this.state === 'stand') {
        // a little air control
        const ax = (dvx - vel.x) * 1.5, az = (dvz - vel.z) * 1.5;
        this.pelvis.force.x += this.totalMass * ax * 0.5 * b;
        this.pelvis.force.z += this.totalMass * az * 0.5 * b;
      }
    }

    // hurt colour fade
    for (const p of this.parts) {
      if (p.hurt > 0) p.hurt = Math.max(0, p.hurt - dt * 0.9);
    }
  }

  /** Visual-only update (once per frame). */
  updateVisuals() {
    for (const p of this.parts) {
      const broken = p.joint && p.joint.broken;
      const k = Math.min(1, p.hurt * 0.8 + (broken ? 0.55 : 0));
      p.mat.color.copy(p.baseColor).lerp(HURT, k);
    }
  }

  // ---------------------------------------------------------------- pose generation
  computePose(dt, hSpeed, vel) {
    const t = this.time;
    const st = this.state;
    const breathe = Math.sin(t * 2.2) * 0.03;

    if (st === 'stand' || (st === 'getup' && this.stateT > 0.9)) {
      // gait driven by real ground speed, so being shoved makes him step
      const fy = this.yawOf(this.pelvis);
      const fwd = vel.x * Math.sin(fy) + vel.z * Math.cos(fy);
      const spd = this.grounded ? hSpeed : 0;
      this.speedSmoothed += (spd - this.speedSmoothed) * Math.min(1, dt * 8);
      const s = this.speedSmoothed;
      const L = Math.min(1, s / 5.4);
      const dir = fwd >= -0.3 ? 1 : -1;
      this.phase += dt * (5 + s * 1.9) * dir * (s > 0.25 ? 1 : 0);
      const walk = Math.min(1, s / 0.9);
      const ph = this.phase;

      // legs
      const hipAmp = (0.38 + 0.5 * L) * walk;
      const kneeAmp = (0.7 + 0.8 * L) * walk;
      for (const [side, off] of [['L', 0], ['R', Math.PI]]) {
        const p = ph + off;
        const swing = Math.max(0, Math.cos(p));
        const hip = -Math.sin(p) * hipAmp - 0.06 - 0.12 * L;
        const knee = 0.12 + swing * kneeAmp + 0.1 * L;
        const sx = side === 'L' ? 1 : -1;
        this.setJ('hip' + side, hip, 0, 0.03 * sx);
        this.setJ('knee' + side, knee);
        this.setJ('ankle' + side, -0.08 + Math.sin(p) * 0.25 * walk, 0, 0);
      }
      // arms swing opposite to legs
      const armAmp = (0.3 + 0.6 * L) * walk;
      this.setJ('shoulderL', Math.sin(ph) * armAmp + 0.04, 0, 0.13 + this.stumble * 0.9);
      this.setJ('shoulderR', -Math.sin(ph) * armAmp + 0.04, 0, -0.13 - this.stumble * 0.9);
      this.sym('elbow', -0.25 - 0.9 * L * walk);
      this.setJ('waist', 0.05 + 0.18 * L + breathe, Math.sin(ph) * 0.12 * walk, 0);
      this.setJ('neck', -0.05 - 0.1 * L, 0, 0);

      if (!this.grounded && this.airT > 0.05) {
        // jumping / airborne tuck
        this.sym('hip', -0.65, 0, 0.05);
        this.sym('knee', 1.1);
        this.sym('shoulder', -0.6, 0, 0.7);
        this.sym('elbow', -0.5);
      }
      if (this.punchT > 0) {
        const side = this.punchSide > 0 ? 'L' : 'R';
        const sx = this.punchSide;
        const wind = this.punchT > 0.27;
        if (wind) {
          this.setJ('shoulder' + side, 0.35, 0, 0.25 * sx);
          this.setJ('elbow' + side, -2.2);
        } else {
          this.setJ('shoulder' + side, -1.55, 0, -0.15 * sx);
          this.setJ('elbow' + side, -0.05);
          this.setJ('waist', 0.12, -0.45 * sx, 0);
        }
        const other = side === 'L' ? 'R' : 'L';
        this.setJ('shoulder' + other, -0.9, 0, 0.3 * -sx);
        this.setJ('elbow' + other, -1.9);
      }
      if (this.grabHeld) {
        this.sym('shoulder', -1.5, 0, -0.05);
        this.sym('elbow', -0.1);
      }
      return;
    }

    if (st === 'getup') {
      // crouch, push up with arms
      this.sym('hip', -1.1, 0, 0.1);
      this.sym('knee', 1.6);
      this.sym('ankle', -0.3);
      this.setJ('waist', 0.45);
      this.sym('shoulder', -0.9, 0, 0.3);
      this.sym('elbow', -0.6);
      this.setJ('neck', -0.2);
      return;
    }

    if (st === 'limp') return; // muscles are off anyway

    // ---- fall behaviours
    if (this.diveT > 0) {
      // superman dive
      this.sym('shoulder', -1.6, 0, 0.12);
      this.sym('elbow', -0.05);
      this.sym('hip', 0.25, 0, 0.08);
      this.sym('knee', 0.15);
      this.setJ('waist', -0.25);
      this.setJ('neck', -0.4);
      return;
    }

    if (!this.nearGround) {
      // airborne: windmill arms, pedal legs (classic Euphoria flail)
      const w = 9;
      this.setJ('shoulderL', -0.8 + Math.sin(t * w) * 1.1, 0, 0.7 + Math.cos(t * w) * 0.4);
      this.setJ('shoulderR', -0.8 + Math.sin(t * w + 2) * 1.1, 0, -0.7 - Math.cos(t * w + 2) * 0.4);
      this.sym('elbow', -0.6 + Math.sin(t * 7) * 0.4);
      this.setJ('hipL', -0.5 + Math.sin(t * 8) * 0.55, 0, 0.12);
      this.setJ('hipR', -0.5 - Math.sin(t * 8) * 0.55, 0, -0.12);
      this.setJ('kneeL', 0.9 + Math.cos(t * 8) * 0.6);
      this.setJ('kneeR', 0.9 - Math.cos(t * 8) * 0.6);
      this.setJ('waist', 0.2);
      this.setJ('neck', 0.25);
      return;
    }

    if (this.restT < 0.35) {
      // about to land / sliding: brace toward the fall direction
      const fy = this.yawOf(this.chest);
      const fwd = vel.x * Math.sin(fy) + vel.z * Math.cos(fy);
      const chestUp = this.upOf(this.chest, v1);
      const leanFwd = chestUp.x * Math.sin(fy) + chestUp.z * Math.cos(fy);
      if (fwd + leanFwd * 2 > 0) {
        this.sym('shoulder', -1.35, 0, 0.3);
        this.sym('elbow', -0.35);
        this.setJ('neck', -0.45); // head back, away from the ground
      } else {
        this.sym('shoulder', -0.2, 0, 1.0);
        this.sym('elbow', -0.5);
        this.setJ('neck', 0.6); // chin tucked
      }
      this.sym('hip', -0.5, 0, 0.1);
      this.sym('knee', 0.8);
      this.setJ('waist', 0.35);
      return;
    }

    // on the ground: curl up and writhe a little
    const wr = Math.sin(t * 2.6) * 0.25;
    this.setJ('hipL', -1.0 + wr, 0, 0.1);
    this.setJ('hipR', -0.8 - wr, 0, -0.1);
    this.sym('knee', 1.5);
    this.sym('ankle', -0.2);
    this.setJ('waist', 0.45 + wr * 0.4, 0, 0);
    this.setJ('shoulderL', -1.25, 0, 0.35 + wr * 0.4);
    this.setJ('shoulderR', -1.25, 0, -0.35 + wr * 0.4);
    this.sym('elbow', -1.9);
    this.setJ('neck', 0.5);
  }

  // ---------------------------------------------------------------- servos
  servo(j, dt, strength) {
    const s = j.broken ? 0 : strength;
    if (s <= 0.001) return;
    const P = j.P.body, C = j.C.body;
    qp.set(P.quaternion.x, P.quaternion.y, P.quaternion.z, P.quaternion.w);
    qc.set(C.quaternion.x, C.quaternion.y, C.quaternion.z, C.quaternion.w);
    qt.multiplyQuaternions(qp, j.target);
    qc.invert();
    qe.multiplyQuaternions(qt, qc);
    if (qe.w < 0) { qe.x = -qe.x; qe.y = -qe.y; qe.z = -qe.z; qe.w = -qe.w; }
    const w = Math.min(1, qe.w);
    const sinHalf = Math.sqrt(Math.max(0, 1 - w * w));
    let ex, ey, ez;
    if (sinHalf > 1e-5) {
      const ang = 2 * Math.acos(w);
      const k = ang / sinHalf;
      ex = qe.x * k; ey = qe.y * k; ez = qe.z * k;
    } else { ex = qe.x * 2; ey = qe.y * 2; ez = qe.z * 2; }

    const wn = j.wn * (0.45 + 0.55 * s);
    const gain = 0.55;
    const dwx = (ex * wn - (C.angularVelocity.x - P.angularVelocity.x)) * gain;
    const dwy = (ey * wn - (C.angularVelocity.y - P.angularVelocity.y)) * gain;
    const dwz = (ez * wn - (C.angularVelocity.z - P.angularVelocity.z)) * gain;
    const mag = Math.hypot(dwx, dwy, dwz);
    if (mag < 1e-6) return;
    const nx = dwx / mag, ny = dwy / mag, nz = dwz / mag;
    const invI = invInertiaAlong(C, nx, ny, nz) + invInertiaAlong(P, nx, ny, nz);
    let J = mag / invI;
    const Jmax = j.torque * s * dt;
    if (J > Jmax) J = Jmax;
    applyAngularImpulse(C, nx * J, ny * J, nz * J);
    applyAngularImpulse(P, -nx * J, -ny * J, -nz * J);
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
    const desired = err * 25;
    const dv = desired - wrel;
    if (Math.sign(dv) !== Math.sign(err)) return;
    const invI = invInertiaAlong(C, v2.x, v2.y, v2.z) + invInertiaAlong(P, v2.x, v2.y, v2.z);
    let J = dv / invI;
    const Jmax = 900 * dt;
    J = Math.max(-Jmax, Math.min(Jmax, J));
    applyAngularImpulse(C, v2.x * J, v2.y * J, v2.z * J);
    applyAngularImpulse(P, -v2.x * J, -v2.y * J, -v2.z * J);
  }

  upright(body, upDes, yawDes, strength, maxTorque, yawStrength, dt) {
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
    // yaw
    const fwd = v3.set(0, 0, 1).applyQuaternion(qc);
    const yawCur = Math.atan2(fwd.x, fwd.z);
    let yErr = yawDes - yawCur;
    yErr = Math.atan2(Math.sin(yErr), Math.cos(yErr));
    const yawW = Math.max(0, up.y) * yawStrength;
    const wu = 11, wy = 9;
    const dwx = (ex * wu - body.angularVelocity.x) * 0.4;
    const dwy = (ey * wu + yErr * wy * yawW - body.angularVelocity.y) * 0.4;
    const dwz = (ez * wu - body.angularVelocity.z) * 0.4;
    const mag = Math.hypot(dwx, dwy, dwz);
    if (mag < 1e-6) return;
    const nx = dwx / mag, ny = dwy / mag, nz = dwz / mag;
    let J = mag / invInertiaAlong(body, nx, ny, nz);
    const Jmax = maxTorque * strength * dt;
    if (J > Jmax) J = Jmax;
    applyAngularImpulse(body, nx * J, ny * J, nz * J);
  }

  /** Apply a velocity change to the whole body (explosions, launch pads). */
  addVelocity(x, y, z, spin = 0) {
    for (const p of this.parts) {
      p.body.velocity.x += x; p.body.velocity.y += y; p.body.velocity.z += z;
      if (spin) {
        p.body.angularVelocity.x += (Math.random() - 0.5) * spin;
        p.body.angularVelocity.z += (Math.random() - 0.5) * spin;
      }
    }
  }

  isOwnBody(b) { return !!(b.userData && b.userData.ragdoll === this); }
}

export { D2R, FIXED_DT };
