import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { world, GROUP, MASK_ALL, MAT, track, untrack } from './physics.js';
import * as lv from './level.js';
import { L } from './level.js';
import * as fx from './fx.js';
import * as sfx from './audio.js';

/*
 * Turbo Dismount-style vehicles: a raycast-vehicle chassis, the dummy strapped
 * to the seat with a breakable joint. Hit something hard enough and the seat
 * joint saturates (or the chassis decelerates too fast) and he's ejected.
 */

export const VEHICLE_TYPES = {
  carrito: {
    name: 'CARRITO', mass: 90, he: [0.32, 0.12, 0.5], wheelR: 0.1, track: 0.3, base: 0.42, wheelY: -0.12,
    engine: 1100, maxSpeed: 16, seat: [0, 0.55, -0.05], seatForce: 4000, handForce: 450, susp: 0.12, stiff: 60, grip: 1.8,
  },
  coche: {
    name: 'DESCAPOTABLE', mass: 1100, he: [0.85, 0.3, 2.0], wheelR: 0.34, track: 0.78, base: 1.35, wheelY: -0.25,
    engine: 5200, maxSpeed: 31, seat: [0.4, 0.42, -0.2], seatForce: 6500, handForce: 600, susp: 0.3, stiff: 28, grip: 2.2,
  },
  cohete: {
    name: 'TRINEO COHETE', mass: 260, he: [0.55, 0.12, 1.3], wheelR: 0.16, track: 0.5, base: 1.0, wheelY: -0.1,
    engine: 0, thrust: 9500, maxSpeed: 36, seat: [0, 0.3, -0.3], seatForce: 4200, handForce: 450, susp: 0.15, stiff: 45, grip: 1.2,
  },
};
export const VEHICLE_ORDER = ['carrito', 'coche', 'cohete'];

function buildMesh(type, def) {
  const g = new THREE.Group();
  const [hx, hy, hz] = def.he;
  if (type === 'carrito') {
    const wire = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.8, roughness: 0.35, wireframe: true });
    const basket = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, 0.5, hz * 2, 6, 4, 8), wire);
    basket.position.y = 0.37;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, 0.03, hz * 2), lv.stdMat(0x8a8e94, { metalness: 0.7, roughness: 0.4 }));
    floor.position.y = 0.12;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, hx * 2.1, 8), lv.stdMat(0xd8402a, { roughness: 0.5 }));
    handle.rotation.z = Math.PI / 2; handle.position.set(0, 0.72, -hz - 0.12);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(hx * 1.6, 0.04, hz * 2), lv.stdMat(0x8a8e94, { metalness: 0.7 }));
    g.add(basket, floor, handle, frame);
  } else if (type === 'coche') {
    const paint = lv.stdMat(0x8a2a22, { roughness: 0.3, metalness: 0.5 });
    const lower = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), paint);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, 0.12, 1.2), paint);
    hood.position.set(0, hy + 0.06, hz - 0.6);
    const trunk = hood.clone(); trunk.position.z = -hz + 0.5; trunk.scale.z = 0.8;
    const glass = new THREE.Mesh(new THREE.BoxGeometry(hx * 1.9, 0.4, 0.05), lv.stdMat(0x9fd3ff, { roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.45 }));
    glass.position.set(0, hy + 0.32, hz - 1.3); glass.rotation.x = -0.45;
    const seatM = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.5), lv.stdMat(0x1c1c1c));
    seatM.position.set(def.seat[0], hy + 0.02, def.seat[2]);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.1), lv.stdMat(0x1c1c1c));
    back.position.set(def.seat[0], hy + 0.3, def.seat[2] - 0.3);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 6, 20), lv.stdMat(0x1c1c1c));
    wheel.position.set(def.seat[0], hy + 0.35, def.seat[2] + 0.55); wheel.rotation.x = -0.9;
    g.add(lower, hood, trunk, glass, seatM, back, wheel);
  } else {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), lv.stdMat(0x3a3d42, { metalness: 0.6, roughness: 0.4 }));
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 1.3, 16), lv.stdMat(0xe0b13a, { metalness: 0.4, roughness: 0.4 }));
    tube.rotation.x = Math.PI / 2; tube.position.set(0, 0.32, -hz + 0.2);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.25, 16), lv.stdMat(0x222222, { metalness: 0.8 }));
    nozzle.rotation.x = Math.PI / 2; nozzle.position.set(0, 0.32, -hz - 0.5);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 8), lv.stdMat(0xd8402a));
    bar.rotation.z = Math.PI / 2; bar.position.set(0, 0.55, def.seat[2] + 0.55);
    g.add(deck, tube, nozzle, bar);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

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
    if (type === 'coche') {
      chassis.addShape(new CANNON.Box(new CANNON.Vec3(hx, 0.06, 0.6)), new CANNON.Vec3(0, hy + 0.06, hz - 0.6));
    }
    if (type === 'cohete') chassis.addShape(new CANNON.Cylinder(0.24, 0.24, 1.3, 10), new CANNON.Vec3(0, 0.32, -hz + 0.2), new CANNON.Quaternion().setFromEuler(Math.PI / 2, 0, 0));
    chassis.position.set(pos.x, pos.y + def.wheelR + def.susp + hy + 0.1, pos.z);
    chassis.quaternion.setFromEuler(0, yaw, 0);
    chassis.userData = { kind: 'vehicle', vehicle: this };

    const rv = this.rv = new CANNON.RaycastVehicle({ chassisBody: chassis, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2 });
    const opts = {
      radius: def.wheelR, directionLocal: new CANNON.Vec3(0, -1, 0), suspensionStiffness: def.stiff,
      suspensionRestLength: def.susp, frictionSlip: def.grip, dampingRelaxation: 2.3, dampingCompression: 4.4,
      maxSuspensionForce: 1e6, rollInfluence: 0.02, axleLocal: new CANNON.Vec3(-1, 0, 0),
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
      const w = new THREE.Mesh(new THREE.CylinderGeometry(def.wheelR, def.wheelR, def.wheelR * 0.7, 16), lv.stdMat(0x1a1a1a, { roughness: 0.9 }));
      w.geometry.rotateZ(Math.PI / 2);
      w.castShadow = true;
      L.scene.add(w); L.meshes.push(w);
      return w;
    });
    this.constraints = [];
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
    const pelvis = rag.pelvis;
    const c = new CANNON.PointToPointConstraint(pelvis, new CANNON.Vec3(0, -0.06, 0), ch, new CANNON.Vec3(def.seat[0], def.seat[1], def.seat[2]), def.seatForce);
    world.addConstraint(c);
    this.seatC = c;
    this.constraints.push(c);
    // hands on the wheel / bar
    for (const [S, sx] of [['L', 1], ['R', -1]]) {
      const hand = rag.partMap['hand' + S].body;
      const grip = new CANNON.Vec3(def.seat[0] + 0.17 * sx, def.seat[1] + 0.3, def.seat[2] + 0.5);
      const hc = new CANNON.PointToPointConstraint(hand, new CANNON.Vec3(0, -0.04, 0), ch, grip, def.handForce);
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
    rag.maskRestoreT = 0.35;
    rag.events.push({ type: 'eject', rag, reason, point: new THREE.Vector3().copy(rag.chest.position), speed: this.chassis.velocity.length() });
  }

  step(dt, input) {
    const def = this.def;
    const ch = this.chassis;
    const v = ch.velocity;
    // forward speed
    const fwd = ch.vectorToWorldFrame(new CANNON.Vec3(0, 0, 1), new CANNON.Vec3());
    const speed = v.x * fwd.x + v.y * fwd.y + v.z * fwd.z;
    if (input.launch && !this.launched) { this.launched = true; sfx.whoosh(); }
    const steer = (input.steer || 0) * (0.5 - Math.min(0.35, Math.abs(speed) / 80));
    this.rv.setSteeringValue(steer, 0);
    this.rv.setSteeringValue(steer, 1);
    if (this.launched && !this.ejected) {
      if (def.thrust) {
        if (speed < def.maxSpeed) { ch.force.x += fwd.x * def.thrust; ch.force.y += fwd.y * def.thrust; ch.force.z += fwd.z * def.thrust; }
      } else {
        const f = speed < def.maxSpeed ? def.engine : 0;
        for (let i = 0; i < 4; i++) this.rv.applyEngineForce(-f, i);
      }
    } else {
      for (let i = 0; i < 4; i++) this.rv.applyEngineForce(0, i);
    }

    this.age = (this.age || 0) + dt;
    if (this.rag && !this.ejected && this.launched && this.age > 1) {
      // ejection: violent deceleration, saturated seat joint, or upside down
      // forward speed lost over the last ~0.1 s: a wall eats 10+ m/s, a ramp barely 1
      this.speedHist = this.speedHist || [];
      const mag = Math.hypot(v.x, v.y, v.z);
      this.speedHist.push(mag);
      if (this.speedHist.length > 12) this.speedHist.shift();
      const peak = Math.max(...this.speedHist);
      const drop = peak - mag;
      const dropLimit = Math.max(5.5, peak * 0.22);
      // how far the pelvis has been dragged off the seat: the strap is giving way
      const def2 = this.def;
      const seatW = ch.pointToWorldFrame(new CANNON.Vec3(def2.seat[0], def2.seat[1], def2.seat[2]), new CANNON.Vec3());
      const pv = this.rag.pelvis.pointToWorldFrame(new CANNON.Vec3(0, -0.06, 0), new CANNON.Vec3());
      const sep = Math.hypot(seatW.x - pv.x, seatW.y - pv.y, seatW.z - pv.z);
      this.satT = sep > 0.45 ? this.satT + dt : 0;
      const up = ch.vectorToWorldFrame(new CANNON.Vec3(0, 1, 0), new CANNON.Vec3());
      if (drop > dropLimit || this.satT > 0.06) this.eject('impact');
      this.rollT = up.y < 0.1 ? (this.rollT || 0) + dt : 0;
      if (this.rollT > 0.3) this.eject('roll');
    }
    this.prevVel.copy(v);
  }

  frame() {
    for (let i = 0; i < this.rv.wheelInfos.length; i++) {
      this.rv.updateWheelTransform(i);
      const t = this.rv.wheelInfos[i].worldTransform;
      this.wheelMeshes[i].position.set(t.position.x, t.position.y, t.position.z);
      this.wheelMeshes[i].quaternion.set(t.quaternion.x, t.quaternion.y, t.quaternion.z, t.quaternion.w);
    }
    if (this.def.thrust && this.launched && !this.ejected) {
      const p = this.chassis.pointToWorldFrame(new CANNON.Vec3(0, 0.32, -this.def.he[2] - 0.7), new CANNON.Vec3());
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
