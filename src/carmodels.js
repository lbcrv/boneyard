import * as THREE from 'three';

/*
 * Car bodies built from side profiles: the outline of the car seen from the
 * side is extruded across its width with rounded edges, wheel arches cut into
 * it; the cabin is a second profile with glass set into it. Wheels have a
 * tyre, a rim with spokes and a hub, so they read as wheels when they spin.
 * Everything is in metres with the ground at y = 0 and the nose toward +z,
 * unless `ground` says otherwise.
 */

const mats = new Map();
function mat(key, make) {
  if (!mats.has(key)) mats.set(key, make());
  return mats.get(key);
}
export const paint = (color) => mat('paint' + color, () => new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.45 }));
const glass = () => mat('glass', () => new THREE.MeshStandardMaterial({ color: 0x18222b, roughness: 0.06, metalness: 0.85 }));
const glassBoth = () => mat('glass2', () => new THREE.MeshStandardMaterial({ color: 0x18222b, roughness: 0.06, metalness: 0.85, side: THREE.DoubleSide }));
const trim = () => mat('trim', () => new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.65, metalness: 0.1 }));
const chrome = () => mat('chrome', () => new THREE.MeshStandardMaterial({ color: 0xcfd3d8, roughness: 0.18, metalness: 1 }));
const tyre = () => mat('tyre', () => new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.92 }));
const rim = () => mat('rim', () => new THREE.MeshStandardMaterial({ color: 0xa9adb3, roughness: 0.3, metalness: 0.9 }));
const head = () => mat('head', () => new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff1cc, emissiveIntensity: 0.5, roughness: 0.1 }));
const tail = () => mat('tail', () => new THREE.MeshStandardMaterial({ color: 0x8a0d0d, emissive: 0xc0140e, emissiveIntensity: 0.45, roughness: 0.2 }));
const seatMat = () => mat('seat', () => new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.75 }));

/** Extrude a closed side outline (drawn by fn on a Shape, x = length, y = height) across `width`. */
function extrudeSide(draw, width, bevel, material) {
  const s = new THREE.Shape();
  draw(s);
  const depth = Math.max(0.01, width - bevel * 2);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 12 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2); // outline x -> world z, extrusion -> world x
  const m = new THREE.Mesh(g, material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function box(w, h, l, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** A wheel whose axle is the x axis. */
export function makeWheel(r, w, spokes = 5) {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 24).rotateZ(Math.PI / 2), tyre());
  const side = new THREE.Mesh(new THREE.TorusGeometry(r * 0.86, r * 0.14, 6, 24).rotateY(Math.PI / 2), tyre());
  const side2 = side.clone();
  side.position.x = w / 2 - 0.01; side2.position.x = -w / 2 + 0.01;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.66, r * 0.66, w * 1.02, 20).rotateZ(Math.PI / 2), rim());
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.18, r * 0.18, w * 1.1, 10).rotateZ(Math.PI / 2), chrome());
  g.add(t, side, side2, disc, hub);
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    for (const sx of [1, -1]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.012, r * 0.5, r * 0.12), trim());
      s.position.set(sx * w * 0.52, Math.cos(a) * r * 0.36, Math.sin(a) * r * 0.36);
      s.rotation.x = -a;
      g.add(s);
    }
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/*
 * Lower body outline with wheel arches. o: { len, sill, belt, nose, tail,
 * hoodEnd, deckStart, zF, zR, R } (z of front/rear axle, R = arch radius,
 * wheel centre at height wc).
 */
function lowerOutline(o) {
  return (s) => {
    const zb = -o.len / 2, zf = o.len / 2;
    s.moveTo(zb + 0.15, o.sill);
    for (const zw of [o.zR, o.zF]) {
      s.lineTo(zw - o.R, o.sill);
      s.lineTo(zw - o.R, o.wc);
      s.absarc(zw, o.wc, o.R, Math.PI, 0, true);
      s.lineTo(zw + o.R, o.sill);
    }
    s.lineTo(zf - 0.15, o.sill);
    s.quadraticCurveTo(zf + 0.03, o.sill, zf + 0.02, o.nose);         // front bumper
    s.quadraticCurveTo(zf, o.hood + 0.02, zf - 0.32, o.hood);           // round onto the bonnet
    s.lineTo(o.hoodEnd, o.belt);                                       // bonnet rises to the scuttle
    s.lineTo(o.deckStart, o.belt);
    s.lineTo(zb + 0.3, o.deck);
    s.quadraticCurveTo(zb - 0.02, o.deck, zb - 0.01, o.tail);          // boot lid round
    s.quadraticCurveTo(zb, o.sill, zb + 0.15, o.sill);                // rear bumper
  };
}

/** A closed car (sedan, hatch, van). Returns a Group with userData.wheels. */
export function makeCar(kind = 'sedan', color = 0x8a2a22, { ground = 0, wheels = true } = {}) {
  const P = {
    sedan: { len: 4.4, wid: 1.8, R: 0.38, r: 0.33, sill: 0.28, belt: 0.98, nose: 0.66, hood: 0.86, tail: 0.86, deck: 0.98, roof: 1.45, zF: 1.35, zR: -1.4, wsF: 0.85, rfF: 0.05, rfR: -0.95, wsR: -1.45, hoodEnd: 0.9, deckStart: -1.5 },
    hatch: { len: 3.9, wid: 1.74, R: 0.36, r: 0.31, sill: 0.27, belt: 0.95, nose: 0.62, hood: 0.84, tail: 0.95, deck: 0.98, roof: 1.48, zF: 1.25, zR: -1.25, wsF: 0.75, rfF: -0.05, rfR: -1.55, wsR: -1.8, hoodEnd: 0.8, deckStart: -1.75 },
    van: { len: 4.9, wid: 1.95, R: 0.4, r: 0.35, sill: 0.32, belt: 1.12, nose: 0.75, hood: 1.0, tail: 1.1, deck: 1.12, roof: 2.05, zF: 1.65, zR: -1.55, wsF: 1.55, rfF: 0.95, rfR: -2.4, wsR: -2.42, hoodEnd: 1.6, deckStart: -2.42 },
  }[kind];
  const g = new THREE.Group();
  const wc = P.r;
  const body = extrudeSide(lowerOutline({ ...P, wc, R: P.R }), P.wid, 0.06, paint(color));
  g.add(body);
  // cabin: painted shell, glass set into its sides and ends
  const cab = (s) => {
    s.moveTo(P.wsF, P.belt - 0.01);
    s.lineTo(P.rfF, P.roof);
    s.lineTo(P.rfR, P.roof);
    s.lineTo(P.wsR, P.belt - 0.01);
  };
  const cw = P.wid * 0.86;
  g.add(extrudeSide(cab, cw, 0.05, paint(color)));
  // side windows: the cabin outline shrunk by the pillars
  const inset = 0.08;
  const win = new THREE.Shape();
  const lerp = (a, b, t) => a + (b - a) * t;
  const yTop = P.roof - inset, yBot = P.belt + 0.04;
  const tF = (yTop - P.belt) / (P.roof - P.belt), tB = (yBot - P.belt) / (P.roof - P.belt);
  win.moveTo(lerp(P.wsF, P.rfF, tB) - inset, yBot);
  win.lineTo(lerp(P.wsF, P.rfF, tF) - inset * 0.6, yTop);
  win.lineTo(lerp(P.wsR, P.rfR, tF) + inset * 0.6, yTop);
  win.lineTo(lerp(P.wsR, P.rfR, tB) + inset, yBot);
  const wg = new THREE.ShapeGeometry(win);
  wg.rotateY(-Math.PI / 2);
  for (const sx of [1, -1]) {
    const w = new THREE.Mesh(wg, glassBoth());
    w.position.x = sx * (cw / 2 + 0.051);
    g.add(w);
  }
  // B pillar
  for (const sx of [1, -1]) g.add(box(0.02, P.roof - P.belt - 0.12, 0.09, trim(), sx * (cw / 2 + 0.055), (P.roof + P.belt) / 2, (P.rfF + P.rfR) / 2 + 0.1));
  // windscreen and rear window: quads on the sloped faces
  const pane = (z0, y0, z1, y1, w) => {
    const len = Math.hypot(z1 - z0, y1 - y0);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len - 0.1), glass());
    m.position.set(0, (y0 + y1) / 2, (z0 + z1) / 2);
    const n = new THREE.Vector3(0, z1 - z0, -(y1 - y0)).normalize(); // outward
    if (z1 < z0) n.negate();
    m.lookAt(m.position.clone().add(n.multiplyScalar(z0 > 0 ? 1 : -1)));
    m.position.add(m.getWorldDirection(new THREE.Vector3()).multiplyScalar(0.055));
    return m;
  };
  g.add(pane(P.wsF, P.belt, P.rfF, P.roof, cw - 0.12));
  g.add(pane(P.wsR, P.belt, P.rfR, P.roof, cw - 0.12));
  addLights(g, P, kind);
  if (wheels) addWheels(g, P);
  g.position.y = ground;
  const root = new THREE.Group();
  root.add(g);
  root.userData.wheels = g.userData.wheels || [];
  root.userData.wheelR = P.r;
  return root;
}

function addLights(g, P, kind) {
  const zf = P.len / 2, zb = -P.len / 2;
  for (const sx of [1, -1]) {
    const hl = box(0.34, 0.12, 0.06, head(), sx * P.wid * 0.33, P.nose + 0.08, zf - 0.01);
    hl.rotation.x = -0.2;
    g.add(hl);
    g.add(box(0.3, 0.1, 0.05, tail(), sx * P.wid * 0.36, P.tail - 0.06, zb - 0.01));
    // mirrors
    const mr = box(0.16, 0.1, 0.07, paint(0x1b1c1f), sx * (P.wid * 0.5 + 0.07), P.belt + 0.08, P.wsF - 0.1);
    g.add(mr);
  }
  g.add(box(P.wid * 0.46, 0.14, 0.05, trim(), 0, P.nose - 0.02, zf + 0.0)); // grille
  g.add(box(P.wid * 0.98, 0.12, 0.12, trim(), 0, P.sill + 0.1, zf - 0.02)); // bumpers
  g.add(box(P.wid * 0.98, 0.12, 0.12, trim(), 0, P.sill + 0.1, zb + 0.02));
  if (kind !== 'van') g.add(box(0.36, 0.11, 0.02, mat('plate', () => new THREE.MeshStandardMaterial({ color: 0xf2f0e8, roughness: 0.6 })), 0, P.tail - 0.22, zb - 0.005));
  // sills, door shut line
  for (const sx of [1, -1]) {
    g.add(box(0.02, 0.06, P.len * 0.55, trim(), sx * (P.wid / 2 + 0.002), P.sill + 0.05, (P.zF + P.zR) / 2));
    g.add(box(0.01, P.belt - P.sill - 0.2, 0.012, trim(), sx * (P.wid / 2 + 0.003), (P.belt + P.sill) / 2 + 0.05, (P.rfF + P.rfR) / 2 + 0.1));
  }
}

function addWheels(g, P) {
  g.userData.wheels = [];
  for (const z of [P.zF, P.zR]) {
    for (const sx of [1, -1]) {
      const w = makeWheel(P.r, 0.22);
      w.position.set(sx * (P.wid / 2 - 0.12), P.r, z);
      g.add(w);
      g.userData.wheels.push(w);
    }
  }
}

/** Bus: tall rounded box, a band of windows, doors, wheels at the ends. */
export function makeBus(color = 0xd9a92b, len = 10) {
  const g = new THREE.Group();
  const wid = 2.5, roof = 3.1, R = 0.55, r = 0.5;
  const zF = len / 2 - 1.6, zR = -len / 2 + 2.2;
  const outline = (s) => {
    const zb = -len / 2, zf = len / 2, sill = 0.38;
    s.moveTo(zb + 0.2, sill);
    for (const zw of [zR, zF]) { s.lineTo(zw - R, sill); s.lineTo(zw - R, r); s.absarc(zw, r, R, Math.PI, 0, true); s.lineTo(zw + R, sill); }
    s.lineTo(zf - 0.2, sill);
    s.quadraticCurveTo(zf, sill, zf, sill + 0.3);
    s.lineTo(zf, roof - 0.35);
    s.quadraticCurveTo(zf, roof, zf - 0.35, roof);
    s.lineTo(zb + 0.35, roof);
    s.quadraticCurveTo(zb, roof, zb, roof - 0.35);
    s.lineTo(zb, sill + 0.3);
    s.quadraticCurveTo(zb, sill, zb + 0.2, sill);
  };
  g.add(extrudeSide(outline, wid, 0.08, paint(color)));
  // window band and windscreen
  for (const sx of [1, -1]) {
    g.add(box(0.02, 0.95, len - 1.4, glass(), sx * (wid / 2 + 0.005), 2.15, -0.2));
    for (let z = -len / 2 + 1.2; z < len / 2 - 1; z += 1.25) g.add(box(0.03, 0.95, 0.07, paint(color), sx * (wid / 2 + 0.012), 2.15, z));
    g.add(box(0.02, 1.9, 0.9, glass(), sx * (wid / 2 + 0.006), 1.4, len / 2 - 0.75)); // door
  }
  g.add(box(wid - 0.2, 1.5, 0.02, glass(), 0, 2.0, len / 2 + 0.01));
  g.add(box(wid - 0.4, 0.3, 0.03, mat('dest', () => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffa31a, emissiveIntensity: 0.6 })), 0, 2.88, len / 2 + 0.02));
  for (const sx of [1, -1]) {
    g.add(box(0.3, 0.16, 0.04, head(), sx * 0.85, 0.75, len / 2 + 0.02));
    g.add(box(0.2, 0.3, 0.04, tail(), sx * 1.0, 0.9, -len / 2 - 0.02));
  }
  g.add(box(wid, 0.25, 0.14, trim(), 0, 0.45, len / 2 + 0.04));
  g.add(box(wid, 0.25, 0.14, trim(), 0, 0.45, -len / 2 - 0.04));
  g.userData.wheels = [];
  for (const z of [zF, zR]) for (const sx of [1, -1]) {
    const w = makeWheel(r, 0.32, 8);
    w.position.set(sx * (wid / 2 - 0.2), r, z);
    g.add(w); g.userData.wheels.push(w);
  }
  g.userData.wheelR = r;
  return g;
}

/** Box truck: a cab and a cargo box. */
export function makeTruck(color = 0x3a4a5c, len = 7) {
  const g = new THREE.Group();
  const wid = 2.3, r = 0.48, R = 0.54;
  const cabLen = 2.0, zF = len / 2 - 1.0, zR = -len / 2 + 1.4;
  const cab = (s) => {
    const zb = len / 2 - cabLen, zf = len / 2;
    s.moveTo(zb, 0.45);
    s.lineTo(zF - R, 0.45); s.lineTo(zF - R, r); s.absarc(zF, r, R, Math.PI, 0, true); s.lineTo(zF + R, 0.45);
    s.lineTo(zf - 0.15, 0.45);
    s.quadraticCurveTo(zf, 0.45, zf, 0.7);
    s.lineTo(zf, 1.55);
    s.lineTo(zf - 0.45, 2.75);
    s.lineTo(zb, 2.75);
  };
  g.add(extrudeSide(cab, wid, 0.07, paint(color)));
  g.add(box(wid - 0.25, 0.85, 0.02, glass(), 0, 2.12, len / 2 - 0.22)).rotation.x = -0.36;
  for (const sx of [1, -1]) g.add(box(0.02, 0.7, 0.9, glass(), sx * (wid / 2 + 0.005), 2.0, len / 2 - 0.9));
  const cargoLen = len - cabLen - 0.15;
  const cargo = box(wid + 0.05, 2.6, cargoLen, mat('cargo', () => new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.7 })), 0, 0.85 + 1.3, -len / 2 + cargoLen / 2);
  g.add(cargo);
  g.add(box(wid + 0.07, 0.2, cargoLen, paint(color), 0, 1.0, -len / 2 + cargoLen / 2));
  g.add(box(wid * 0.8, 0.22, cargoLen + cabLen - 0.4, trim(), 0, 0.62, -0.1)); // chassis rail
  // rear axle arches on the cargo side, under the box
  for (const sx of [1, -1]) {
    g.add(box(0.3, 0.16, 0.04, head(), sx * 0.8, 0.85, len / 2 + 0.01));
    g.add(box(0.18, 0.28, 0.04, tail(), sx * 1.0, 1.0, -len / 2 - 0.01));
  }
  g.add(box(wid, 0.22, 0.12, trim(), 0, 0.5, len / 2 + 0.03));
  g.userData.wheels = [];
  for (const z of [zF, zR, zR + 1.05]) for (const sx of [1, -1]) {
    const w = makeWheel(r, 0.3, 8);
    w.position.set(sx * (wid / 2 - 0.2), r, z);
    g.add(w); g.userData.wheels.push(w);
  }
  g.userData.wheelR = r;
  return g;
}

/*
 * The player's convertible, in chassis space: ground at `ground`, axles at
 * ±base, wheels supplied by the vehicle (they move with the suspension). The
 * cockpit is an open tub with two seats.
 */
export function makeConvertible(color, { ground, base, seat }) {
  const g = new THREE.Group();
  const len = 4.15, wid = 1.74, R = 0.4, r = 0.34;
  const P = { len, wid, R, r, wc: r, sill: 0.26, belt: 0.92, nose: 0.6, hood: 0.8, tail: 0.84, deck: 0.92, zF: base, zR: -base, hoodEnd: 0.55, deckStart: -1.0 };
  // full-width bonnet and rear deck, side walls along the cockpit
  const front = (s) => {
    const zc = P.hoodEnd - 0.05;
    s.moveTo(zc, P.sill);
    s.lineTo(P.zF - R, P.sill); s.lineTo(P.zF - R, r); s.absarc(P.zF, r, R, Math.PI, 0, true); s.lineTo(P.zF + R, P.sill);
    s.lineTo(len / 2 - 0.15, P.sill);
    s.quadraticCurveTo(len / 2 + 0.03, P.sill, len / 2 + 0.02, P.nose);
    s.quadraticCurveTo(len / 2, P.hood + 0.02, len / 2 - 0.32, P.hood);
    s.lineTo(zc, P.belt);
  };
  const rear = (s) => {
    const zc = P.deckStart + 0.05, zb = -len / 2;
    s.moveTo(zc, P.belt);
    s.lineTo(zb + 0.3, P.deck);
    s.quadraticCurveTo(zb - 0.02, P.deck, zb - 0.01, P.tail);
    s.quadraticCurveTo(zb, P.sill, zb + 0.15, P.sill);
    s.lineTo(P.zR - R, P.sill); s.lineTo(P.zR - R, r); s.absarc(P.zR, r, R, Math.PI, 0, true); s.lineTo(P.zR + R, P.sill);
    s.lineTo(zc, P.sill);
  };
  const side = (s) => {
    s.moveTo(P.deckStart, P.sill);
    s.lineTo(P.hoodEnd, P.sill);
    s.lineTo(P.hoodEnd, P.belt);
    s.lineTo(P.deckStart, P.belt);
  };
  g.add(extrudeSide(front, wid, 0.06, paint(color)));
  g.add(extrudeSide(rear, wid, 0.06, paint(color)));
  for (const sx of [1, -1]) {
    const sm = extrudeSide(side, 0.1, 0.03, paint(color));
    sm.position.x = sx * (wid / 2 - 0.06);
    g.add(sm);
    // door top trim
    g.add(box(0.11, 0.03, P.hoodEnd - P.deckStart, trim(), sx * (wid / 2 - 0.06), P.belt + 0.01, (P.hoodEnd + P.deckStart) / 2));
  }
  // cockpit tub floor and dashboard
  g.add(box(wid - 0.2, 0.06, P.hoodEnd - P.deckStart, trim(), 0, P.sill + 0.12, (P.hoodEnd + P.deckStart) / 2));
  g.add(box(wid - 0.22, 0.22, 0.25, trim(), 0, P.belt - 0.08, P.hoodEnd - 0.1));
  // windscreen frame and glass
  const ws = new THREE.Group();
  ws.add(box(wid - 0.16, 0.42, 0.02, glass(), 0, 0.21, 0));
  ws.add(box(wid - 0.1, 0.04, 0.05, chrome(), 0, 0.43, 0));
  for (const sx of [1, -1]) ws.add(box(0.04, 0.46, 0.05, chrome(), sx * (wid / 2 - 0.06), 0.22, 0));
  ws.position.set(0, P.belt, P.hoodEnd + 0.02);
  ws.rotation.x = -0.45;
  g.add(ws);
  // seats (driver at seat[0])
  for (const sx of [seat[0], -seat[0]]) {
    g.add(box(0.48, 0.14, 0.5, seatMat(), sx, P.sill + 0.27, seat[2] + 0.02));
    const back = box(0.46, 0.62, 0.12, seatMat(), sx, P.sill + 0.6, seat[2] - 0.26);
    back.rotation.x = -0.18;
    g.add(back);
    g.add(box(0.26, 0.16, 0.1, seatMat(), sx, P.sill + 0.98, seat[2] - 0.34));
  }
  // steering wheel
  const sw = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 8, 24), trim());
  sw.position.set(seat[0], P.belt + 0.02, seat[2] + 0.5);
  sw.rotation.x = -1.0;
  g.add(sw);
  // roll hoops behind the seats
  for (const sx of [seat[0], -seat[0]]) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 8, 16, Math.PI), chrome());
    hoop.position.set(sx, P.belt + 0.02, P.deckStart + 0.12);
    g.add(hoop);
  }
  addLights(g, { ...P, wsF: P.hoodEnd }, 'convertible');
  g.position.y = ground;
  return g;
}

/** Shopping trolley in chassis space (ground at `ground`). */
export function makeTrolley({ ground }) {
  const g = new THREE.Group();
  const wire = mat('wire', () => new THREE.MeshStandardMaterial({ color: 0xc4c8cd, metalness: 0.85, roughness: 0.3 }));
  const red = mat('trolleyRed', () => new THREE.MeshStandardMaterial({ color: 0xc8352a, roughness: 0.45 }));
  const rod = (len, x, y, z, rx = 0, rz = 0, r = 0.008) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), wire);
    m.position.set(x, y, z); m.rotation.set(rx, 0, rz);
    g.add(m);
    return m;
  };
  // basket: tapered (narrower and lower at the front), open on top
  const bw = 0.56, bl = 0.92, by = 0.42, bh = 0.46;
  const front = bl / 2, back = -bl / 2;
  for (let i = 0; i <= 10; i++) {
    const z = back + (bl * i) / 10;
    const k = i / 10, w = bw * (1 - k * 0.12), h = bh * (1 - k * 0.15);
    rod(h, w / 2, by + h / 2, z); rod(h, -w / 2, by + h / 2, z);
    rod(w, 0, by, z, 0, Math.PI / 2);
  }
  for (let j = 0; j <= 6; j++) {
    const y = by + (bh * j) / 6;
    for (const sx of [1, -1]) {
      const m = rod(bl, sx * bw * 0.47, y, 0, Math.PI / 2);
      m.rotation.y = sx * 0.06;
    }
  }
  for (let i = 0; i <= 6; i++) {
    const x = -bw / 2 + (bw * i) / 6;
    rod(bh * 0.85, x * 0.88, by + bh * 0.42, front);
    rod(bh, x, by + bh / 2, back);
    rod(bl, x * 0.94, by, 0, Math.PI / 2);
  }
  // top rails
  for (const sx of [1, -1]) rod(bl, sx * bw / 2, by + bh, 0, Math.PI / 2, 0, 0.012);
  // handle
  const h = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, bw + 0.06, 10).rotateZ(Math.PI / 2), red);
  h.position.set(0, by + bh + 0.12, back - 0.18);
  g.add(h);
  for (const sx of [1, -1]) rod(0.26, sx * bw / 2, by + bh + 0.05, back - 0.09, -0.9, 0, 0.012);
  // lower frame and legs to the casters
  for (const sx of [1, -1]) {
    rod(bl + 0.1, sx * 0.24, 0.13, 0, Math.PI / 2, 0, 0.014);
    rod(0.32, sx * 0.24, 0.27, back + 0.02, 0, 0, 0.014);
    rod(0.32, sx * 0.2, 0.27, front - 0.04, 0, 0, 0.014);
  }
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.012, bl * 0.8), wire);
  tray.position.y = 0.14;
  g.add(tray);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.position.y = ground;
  return g;
}

/** A small caster wheel (axle = x). */
export function makeCaster(r) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.04, 16).rotateZ(Math.PI / 2), tyre()));
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.45, 0.045, 10).rotateZ(Math.PI / 2), mat('caster', () => new THREE.MeshStandardMaterial({ color: 0x5a6068, metalness: 0.6, roughness: 0.4 }))));
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
