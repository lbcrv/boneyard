import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { world, GROUP, MASK_ALL, MAT, track, untrack } from './physics.js';
import * as lv from './level.js';
import { L } from './level.js';
import * as fx from './fx.js';
import * as sfx from './audio.js';
import { makeConvertible, makeTrolley, makeWheel, makeCaster, paint } from './carmodels.js';

/*
 * Turbo Dismount-style vehicles: a raycast-vehicle chassis on sprung wheels,
 * the dummy strapped to the seat with breakable joints. W accelerates, S
 * brakes (and reverses once stopped), Space is the handbrake. Hit something
 * hard enough and the seat joint saturates (or the chassis decelerates too
 * fast) and he's ejected.
 *
 * Suspension: each wheel is a spring-damper (stiffness and damping are per
 * unit of chassis mass, so they read as frequencies); body roll is left in so
 * the car leans in corners and pitches under braking.
 */

export const VEHICLE_TYPES = {
  carrito: {
    name: 'CARRITO', mass: 45, he: [0.27, 0.05, 0.45], wheelR: 0.065, track: 0.25, base: 0.38, wheelY: 0,
    engine: 1300, maxSpeed: 11, reverse: 3, brake: 3.5,
    seat: [0, 0.36, -0.1], grip: [0.0, 0.62, 0.36], gripSpread: 0.24,
    seatForce: 3200, handForce: 420, susp: 0.07, stiff: 320, damp: [7, 10], roll: 0.4, friction: 1.6, stabilise: 30,
    extraShapes: [[[0.28, 0.23, 0.46], [0, 0.55, 0]]], ground: -0.105, legs: [-1.5, 2.2],
  },
  coche: {
    name: 'DESCAPOTABLE', mass: 1100, he: [0.85, 0.3, 2.0], wheelR: 0.34, track: 0.76, base: 1.35, wheelY: -0.25,
    engine: 11000, maxSpeed: 34, reverse: 7, brake: 9,
    seat: [0.4, -0.08, -0.2], grip: null, seatForce: 6500, handForce: 600,
    susp: 0.32, stiff: 22, damp: [2.2, 3.4], roll: 0.22, friction: 2.4, downforce: 1.4,
    extraShapes: [[[0.85, 0.06, 0.6], [0, 0.36, 1.4]]], ground: -0.79,
  },
  cohete: {
    name: 'TRINEO COHETE', mass: 650, he: [0.62, 0.09, 1.45], wheelR: 0.2, track: 0.62, base: 1.05, wheelY: -0.05,
    engine: 0, thrust: 15000, maxSpeed: 42, reverse: 0, brake: 8,
    seat: [0, 0.2, -0.2], grip: null, seatForce: 4800, handForce: 520,
    susp: 0.16, stiff: 75, damp: [3.4, 5.2], roll: 0.05, friction: 2.6, downforce: 2.5, stabilise: 14, yawAssist: 1.0,
    extraShapes: [], ground: -0.36, legs: [-1.5, 2.2],
  },
};
export const VEHICLE_ORDER = ['carrito', 'coche', 'cohete'];

function buildMesh(type, def) {
  const g = new THREE.Group();
  if (type === 'carrito') {
    g.add(makeTrolley({ ground: def.ground }));
  } else if (type === 'coche') {
    g.add(makeConvertible(0x9c2a1f, { ground: def.ground, base: def.base, seat: def.seat }));
  } else {
    const [hx, hy, hz] = def.he;
    // sled: a flat deck on outriggers, the motor behind the seat, fins at the back
    const steel = lv.stdMat(0x3a3d42, { metalness: 0.7, roughness: 0.35 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), steel);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(hx * 0.95, 0.9, 4, 1).rotateX(Math.PI / 2).rotateZ(Math.PI / 4), paint(0xe0b13a));
    nose.scale.y = 0.25; nose.position.set(0, 0, hz + 0.42);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.27, 1.5, 20), paint(0xe0b13a));
    tube.rotation.x = Math.PI / 2; tube.position.set(0, 0.3, -hz + 0.3);
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.2, 0.3, 20, 1, true), lv.stdMat(0x222222, { metalness: 0.85, roughness: 0.3 }));
    bell.material.side = THREE.DoubleSide;
    bell.rotation.x = Math.PI / 2; bell.position.set(0, 0.3, -hz - 0.58);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 8), lv.stdMat(0xd8402a));
    bar.rotation.z = Math.PI / 2; bar.position.set(0, 0.62, def.seat[2] + 0.55);
    const seatM = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.5), lv.stdMat(0x2a2320, { roughness: 0.8 }));
    seatM.position.set(0, hy + 0.05, def.seat[2]);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.5, 0.08), lv.stdMat(0x2a2320, { roughness: 0.8 }));
    back.position.set(0, hy + 0.3, def.seat[2] - 0.3);
    g.add(deck, nose, tube, bell, bar, seatM, back);
    for (const sx of [1, -1]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.55), paint(0xd8402a));
      fin.position.set(sx * 0.32, 0.55, -hz + 0.1); fin.rotation.z = sx * 0.5;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, hz * 2.1), steel);
      rail.position.set(sx * (hx + 0.02), -0.02, 0);
      g.add(fin, rail);
    }
    const tailFin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.5), paint(0xd8402a));
    tailFin.position.set(0, 0.75, -hz + 0.05);
    g.add(tailFin);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// a coil spring of unit height along y, for the visible suspension
let coilGeo = null;
function coil() {
  if (!coilGeo) {
    const pts = [];
    for (let i = 0; i <= 120; i++) { const t = i / 120; const a = t * Math.PI * 2 * 7; pts.push(new THREE.Vector3(Math.cos(a) * 0.05, t, Math.sin(a) * 0.05)); }
    coilGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.009, 5, false);
  }
  return coilGeo;
}

const _v = new CANNON.Vec3(), _v2 = new CANNON.Vec3(), _v3 = new CANNON.Vec3();

export class Vehicle {
  constructor(type, pos, yaw) {
    const def = this.def = VEHICLE_TYPES[type];
    this.type = type;
    this.launched = false;
    this.rag = null;
    this.ejected = false;
    this.prevVel = new CANNON.Vec3();
    this.satT = 0;
    const [hx, hy, hz] = def.he;
    const chassis = this.chassis = new CANNON.Body({
      mass: def.mass, material: MAT.vehicle,
      collisionFilterGroup: GROUP.VEHICLE, collisionFilterMask: MASK_ALL,
      angularDamping: 0.3, linearDamping: 0.01, allowSleep: false,
    });
    chassis.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
    for (const [he, off] of def.extraShapes) chassis.addShape(new CANNON.Box(new CANNON.Vec3(...he)), new CANNON.Vec3(...off));
    if (type === 'cohete') chassis.addShape(new CANNON.Cylinder(0.24, 0.24, 1.4, 10), new CANNON.Vec3(0, 0.3, -hz + 0.3), new CANNON.Quaternion().setFromEuler(Math.PI / 2, 0, 0));
    chassis.position.set(pos.x, pos.y - def.ground + 0.05, pos.z);
    chassis.quaternion.setFromEuler(0, yaw, 0);
    chassis.userData = { kind: 'vehicle', vehicle: this };

    const rv = this.rv = new CANNON.RaycastVehicle({ chassisBody: chassis, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2 });
    const opts = {
      radius: def.wheelR, directionLocal: new CANNON.Vec3(0, -1, 0), suspensionStiffness: def.stiff,
      suspensionRestLength: def.susp, frictionSlip: def.friction, dampingRelaxation: def.damp[0], dampingCompression: def.damp[1],
      maxSuspensionForce: 1e6, rollInfluence: def.roll, axleLocal: new CANNON.Vec3(-1, 0, 0),
      chassisConnectionPointLocal: new CANNON.Vec3(), maxSuspensionTravel: def.susp,
      customSlidingRotationalSpeed: -30, useCustomSlidingRotationalSpeed: true,
    };
    for (const [x, z] of [[def.track, def.base], [-def.track, def.base], [def.track, -def.base], [-def.track, -def.base]]) {
      opts.chassisConnectionPointLocal.set(x, def.wheelY, z);
      rv.addWheel(opts);
    }
    rv.addToWorld(world);

    this.mesh = buildMesh(type, def);
    L.scene.add(this.mesh);
    L.meshes.push(this.mesh);
    this.mesh.traverse((o) => { if (o.isMesh) o.userData.body = chassis; });
    track(chassis, this.mesh);
    this.wheelMeshes = rv.wheelInfos.map(() => {
      const w = type === 'carrito' ? makeCaster(def.wheelR) : makeWheel(def.wheelR, type === 'coche' ? 0.22 : 0.14, type === 'coche' ? 5 : 6);
      L.scene.add(w); L.meshes.push(w);
      return w;
    });
    // springs between the chassis and each hub, in chassis space
    const springMat = lv.stdMat(type === 'coche' ? 0xd8402a : 0xc9cdd2, { metalness: 0.7, roughness: 0.35 });
    this.springs = rv.wheelInfos.map((wi) => {
      const s = new THREE.Mesh(coil(), springMat);
      s.position.set(wi.chassisConnectionPointLocal.x * 0.9, wi.chassisConnectionPointLocal.y, wi.chassisConnectionPointLocal.z);
      s.scale.set(def.wheelR * 4, 1, def.wheelR * 4);
      this.mesh.add(s);
      return s;
    });
    this.constraints = [];
    this.throttle = 0;
  }

  seat(rag) {
    this.rag = rag;
    const def = this.def;
    const ch = this.chassis;
    const seatW = ch.pointToWorldFrame(new CANNON.Vec3(...def.seat), new CANNON.Vec3());
    const yaw = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(ch.quaternion.x, ch.quaternion.y, ch.quaternion.z, ch.quaternion.w), 'YXZ').y;
    // reset so the pelvis lands on the seat; legs fold into place in a few frames
    rag.reset(new THREE.Vector3(seatW.x, seatW.y - 0.97 + 0.12, seatW.z), yaw);
    rag.state = 'seated';
    rag.seat = this;
    rag.setCollisionMask(MASK_ALL & ~GROUP.VEHICLE);
    // legs fold into the footwell over a few frames: until ejected they must
    // not stand on the road and lift the car off its wheels
    for (const p of rag.parts) if (/^(thigh|shin|foot)/.test(p.name)) p.body.collisionFilterMask = MASK_ALL & ~GROUP.VEHICLE & ~GROUP.STATIC;
    const pelvis = rag.pelvis;
    const c = new CANNON.PointToPointConstraint(pelvis, new CANNON.Vec3(0, -0.06, 0), ch, new CANNON.Vec3(def.seat[0], def.seat[1], def.seat[2]), def.seatForce);
    world.addConstraint(c);
    this.seatC = c;
    this.constraints.push(c);
    // a second strap point at the front of the hips: one point alone let the
    // pelvis roll back, and the legs hung down through the road
    const c2 = new CANNON.PointToPointConstraint(pelvis, new CANNON.Vec3(0, -0.06, 0.14), ch, new CANNON.Vec3(def.seat[0], def.seat[1], def.seat[2] + 0.14), def.seatForce * 0.6);
    world.addConstraint(c2);
    this.constraints.push(c2);
    // hands on the wheel / bar / basket rim
    const grip = def.grip || [def.seat[0], def.seat[1] + 0.3, def.seat[2] + 0.5];
    const spread = def.gripSpread || 0.17;
    for (const [S, sx] of [['L', 1], ['R', -1]]) {
      const hand = rag.partMap['hand' + S].body;
      const hc = new CANNON.PointToPointConstraint(hand, new CANNON.Vec3(0, -0.04, 0), ch, new CANNON.Vec3(grip[0] + spread * sx, grip[1], grip[2]), def.handForce);
      world.addConstraint(hc);
      this.constraints.push(hc);
    }
    // upright torso: chest tied loosely to the seat back
    const back = new CANNON.PointToPointConstraint(rag.chest, new CANNON.Vec3(0, 0, -0.12), ch, new CANNON.Vec3(def.seat[0], def.seat[1] + 0.42, def.seat[2] - 0.12), def.seatForce * 0.35);
    world.addConstraint(back);
    this.constraints.push(back);
  }

  eject(reason = 'impact') {
    if (this.ejected || !this.rag) return;
    this.ejected = true;
    for (const c of this.constraints) world.removeConstraint(c);
    this.constraints.length = 0;
    const rag = this.rag;
    rag.seat = null;
    rag.state = 'fall';
    rag.stateT = 0; rag.restT = 0;
    rag.maskRestoreT = 0.6;
    rag.events.push({ type: 'eject', rag, reason, point: new THREE.Vector3().copy(rag.chest.position), speed: this.chassis.velocity.length() });
  }

  step(dt, input) {
    const def = this.def;
    const ch = this.chassis;
    const v = ch.velocity;
    const fwd = ch.vectorToWorldFrame(_v.set(0, 0, 1), _v2);
    const speed = v.x * fwd.x + v.y * fwd.y + v.z * fwd.z;
    const driving = !this.ejected;
    const th = driving ? (input.throttle || 0) : 0;
    if (th !== 0 && !this.launched) { this.launched = true; if (def.thrust) sfx.whoosh(); }
    // the throttle eases in and out instead of snapping
    this.throttle += (th - this.throttle) * Math.min(1, dt * 6);

    const steer = (driving ? input.steer || 0 : 0) * (0.5 - Math.min(0.34, Math.abs(speed) / 70));
    this.rv.setSteeringValue(steer, 0);
    this.rv.setSteeringValue(steer, 1);

    // Braking is a force against the motion through the tyres, so the tyres'
    // grip limits it like any other (cannon's own brake ignores grip and can
    // stop a car dead from 120 km/h, flipping it over its nose).
    let engine = 0, hold = 0;
    const T = this.throttle;
    const brakeF = (def.mass + 75) * def.brake;
    if (!this.launched) hold = 1;                                   // parked until you touch the throttle
    else if (T > 0.05) {
      if (speed < -0.5) engine = -brakeF * T;                       // rolling back: W brakes first
      else if (!def.thrust && speed < def.maxSpeed) engine = def.engine * T;
    } else if (T < -0.05) {
      if (speed > 0.5) engine = -brakeF * -T;                       // S brakes...
      else if (def.reverse && speed > -def.reverse) engine = def.engine * 0.6 * T; // ...then reverses
      else hold = 1;
    }
    if (speed < 0 && engine < 0 && T > 0.05) engine = brakeF * T;     // braking a backward roll pushes forward
    for (let i = 0; i < 4; i++) {
      this.rv.applyEngineForce(-engine / 4, i);
      this.rv.setBrake(hold ? def.mass * 2 : 0, i);
    }
    if (driving && input.handbrake && this.launched) {
      // rear wheels lock: they slide and the tail steps out
      const f = Math.sign(speed) * brakeF * 0.35;
      this.rv.applyEngineForce(f / 2, 2); this.rv.applyEngineForce(f / 2, 3);
      this.rv.wheelInfos[2].frictionSlip = this.rv.wheelInfos[3].frictionSlip = def.friction * 0.45;
    } else {
      this.rv.wheelInfos[2].frictionSlip = this.rv.wheelInfos[3].frictionSlip = def.friction;
    }

    // rocket thrust
    if (def.thrust && driving && T > 0.05 && speed < def.maxSpeed) {
      const f = def.thrust * T;
      ch.force.x += fwd.x * f; ch.force.y += fwd.y * f; ch.force.z += fwd.z * f;
    }
    // aero: downforce grows with speed and keeps the wheels planted
    if (def.downforce) {
      const up = ch.vectorToWorldFrame(_v.set(0, 1, 0), _v3);
      const df = def.downforce * speed * speed;
      ch.force.x -= up.x * df; ch.force.y -= up.y * df; ch.force.z -= up.z * df;
    }
    // fins: resist rolling over and help the nose follow the steering
    if (def.stabilise) {
      const up = ch.vectorToWorldFrame(_v.set(0, 1, 0), _v3);
      const m = def.mass;
      const k = def.stabilise * m * Math.min(1, 0.3 + Math.abs(speed) / 15);
      // torque = k * (up x worldUp) = k * (-up.z, 0, up.x), damped on roll/pitch rate
      const w = ch.angularVelocity;
      ch.torque.x += -up.z * k - w.x * m * 0.8;
      ch.torque.z += up.x * k - w.z * m * 0.8;
      if (driving && def.yawAssist) ch.torque.y += (input.steer || 0) * m * def.yawAssist * Math.min(1, Math.abs(speed) / 6) * Math.sign(speed || 1) - w.y * m * 0.3;
    }

    // seated legs ride with the car (they rest on its floor and seat): through
    // bumps and the bottom of the ramp they would otherwise lag and dip
    if (this.rag && !this.ejected) {
      const w = ch.angularVelocity;
      for (const p of this.rag.parts) {
        if (p.detached || !/^(thigh|shin|foot)/.test(p.name)) continue;
        const b = p.body;
        const rx = b.position.x - ch.position.x, ry = b.position.y - ch.position.y, rz = b.position.z - ch.position.z;
        const px = v.x + w.y * rz - w.z * ry, py = v.y + w.z * rx - w.x * rz, pz = v.z + w.x * ry - w.y * rx;
        b.velocity.x += (px - b.velocity.x) * 0.15;
        b.velocity.y += (py - b.velocity.y) * 0.15;
        b.velocity.z += (pz - b.velocity.z) * 0.15;
      }
    }

    this.age = (this.age || 0) + dt;
    if (this.rag && !this.ejected && this.launched && this.age > 1) {
      // ejection: violent deceleration, saturated seat joint, or upside down
      // forward speed lost over the last ~0.1 s: a wall eats 10+ m/s, braking barely 1
      this.speedHist = this.speedHist || [];
      const mag = Math.hypot(v.x, v.y, v.z);
      this.speedHist.push(mag);
      if (this.speedHist.length > 12) this.speedHist.shift();
      const peak = Math.max(...this.speedHist);
      const drop = peak - mag;
      const dropLimit = Math.max(5.5, peak * 0.22);
      // how far the pelvis has been dragged off the seat: the strap is giving way
      const seatW = ch.pointToWorldFrame(_v.set(def.seat[0], def.seat[1], def.seat[2]), new CANNON.Vec3());
      const pv = this.rag.pelvis.pointToWorldFrame(_v.set(0, -0.06, 0), new CANNON.Vec3());
      const sep = Math.hypot(seatW.x - pv.x, seatW.y - pv.y, seatW.z - pv.z);
      this.satT = sep > 0.45 ? this.satT + dt : 0;
      const up = ch.vectorToWorldFrame(_v.set(0, 1, 0), new CANNON.Vec3());
      if (drop > dropLimit || this.satT > 0.06) this.eject('impact');
      this.rollT = up.y < 0.1 ? (this.rollT || 0) + dt : 0;
      if (this.rollT > 0.3) this.eject('roll');
    }
    this.prevVel.copy(v);
  }

  frame() {
    const def = this.def;
    for (let i = 0; i < this.rv.wheelInfos.length; i++) {
      this.rv.updateWheelTransform(i);
      const wi = this.rv.wheelInfos[i];
      const t = wi.worldTransform;
      this.wheelMeshes[i].position.set(t.position.x, t.position.y, t.position.z);
      this.wheelMeshes[i].quaternion.set(t.quaternion.x, t.quaternion.y, t.quaternion.z, t.quaternion.w);
      // spring from its mount down to the hub
      const s = this.springs[i];
      s.position.y = wi.chassisConnectionPointLocal.y - wi.suspensionLength;
      s.scale.y = Math.max(0.03, wi.suspensionLength + def.wheelR * 0.4);
    }
    if (def.thrust && this.launched && !this.ejected && this.throttle > 0.05) {
      const p = this.chassis.pointToWorldFrame(new CANNON.Vec3(0, 0.3, -def.he[2] - 0.75), new CANNON.Vec3());
      fx.trail(new THREE.Vector3(p.x, p.y, p.z));
    }
  }

  dispose() {
    for (const c of this.constraints) world.removeConstraint(c);
    this.rv.removeFromWorld(world);
    untrack(this.chassis);
    L.scene.remove(this.mesh);
    for (const w of this.wheelMeshes) L.scene.remove(w);
  }
}
