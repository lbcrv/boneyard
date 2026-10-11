/*
 * The 206 bones of an adult skeleton, each mapped to the physics segment that
 * carries it and to an approximate position inside that segment (segment-local,
 * metres, rest pose). The physics body has 16 segments; fractures are resolved
 * per bone from where and how hard a segment was hit.
 *
 * tough = impact speed (m/s) a bone survives when hit right on top of it.
 */

const B = [];
let nextId = 0;
function bone(seg, name, x, y, z, tough, kind = 'other') {
  B.push({ id: nextId++, seg, name, p: [x, y, z], tough, kind });
}

// ---------------------------------------------------------------- head (29 + 7 cervical)
const cranial = [
  ['hueso frontal', 0, 0.06, 0.08], ['parietal izquierdo', 0.06, 0.09, -0.01], ['parietal derecho', -0.06, 0.09, -0.01],
  ['temporal izquierdo', 0.1, 0.0, 0.0], ['temporal derecho', -0.1, 0.0, 0.0], ['occipital', 0, 0.02, -0.1],
  ['esfenoides', 0, 0.0, 0.03], ['etmoides', 0, 0.02, 0.07],
];
for (const [n, x, y, z] of cranial) bone('head', n, x, y, z, 13, 'skull');
const facial = [
  ['nasal izquierdo', 0.01, 0.0, 0.11], ['nasal derecho', -0.01, 0.0, 0.11],
  ['maxilar izquierdo', 0.03, -0.04, 0.09], ['maxilar derecho', -0.03, -0.04, 0.09],
  ['lagrimal izquierdo', 0.025, 0.02, 0.09], ['lagrimal derecho', -0.025, 0.02, 0.09],
  ['cigomático izquierdo', 0.06, -0.01, 0.07], ['cigomático derecho', -0.06, -0.01, 0.07],
  ['palatino izquierdo', 0.01, -0.05, 0.05], ['palatino derecho', -0.01, -0.05, 0.05],
  ['cornete inferior izquierdo', 0.015, -0.02, 0.08], ['cornete inferior derecho', -0.015, -0.02, 0.08],
  ['vómer', 0, -0.02, 0.07], ['mandíbula', 0, -0.09, 0.07],
];
for (const [n, x, y, z] of facial) bone('head', n, x, y, z, n === 'mandíbula' ? 10 : 8, 'face');
for (const side of [['izquierdo', 0.09], ['derecho', -0.09]]) {
  bone('head', 'martillo ' + side[0], side[1], 0, -0.005, 18, 'ear');
  bone('head', 'yunque ' + side[0], side[1], 0, -0.01, 18, 'ear');
  bone('head', 'estribo ' + side[0], side[1] * 0.95, 0, -0.01, 18, 'ear');
}
bone('head', 'hioides', 0, -0.12, 0.04, 9, 'neck');
for (let i = 1; i <= 7; i++) bone('head', `vértebra cervical C${i}`, 0, -0.08 - i * 0.012, -0.03, 12, 'cervical');

// ---------------------------------------------------------------- chest (T1-T8, ribs, sternum, girdle)
for (let i = 1; i <= 8; i++) bone('chest', `vértebra torácica T${i}`, 0, 0.12 - i * 0.03, -0.1, 13, 'spine');
const ordinal = ['1.ª', '2.ª', '3.ª', '4.ª', '5.ª', '6.ª', '7.ª', '8.ª', '9.ª', '10.ª', '11.ª', '12.ª'];
for (let i = 0; i < 12; i++) {
  const seg = i < 9 ? 'chest' : 'abdomen';
  const y = seg === 'chest' ? 0.11 - i * 0.03 : 0.05 - (i - 9) * 0.03;
  for (const [side, sx] of [['izquierda', 1], ['derecha', -1]]) {
    bone(seg, `${ordinal[i]} costilla ${side}`, 0.15 * sx, y, 0.02, 9, 'rib');
  }
}
bone('chest', 'esternón', 0, 0.02, 0.11, 11, 'sternum');
bone('chest', 'clavícula izquierda', 0.12, 0.12, 0.07, 9, 'clavicle');
bone('chest', 'clavícula derecha', -0.12, 0.12, 0.07, 9, 'clavicle');
bone('chest', 'escápula izquierda', 0.12, 0.06, -0.1, 13, 'scapula');
bone('chest', 'escápula derecha', -0.12, 0.06, -0.1, 13, 'scapula');

// ---------------------------------------------------------------- abdomen (T9-T12, L1-L5)
for (let i = 9; i <= 12; i++) bone('abdomen', `vértebra torácica T${i}`, 0, 0.07 - (i - 9) * 0.025, -0.09, 13, 'spine');
for (let i = 1; i <= 5; i++) bone('abdomen', `vértebra lumbar L${i}`, 0, -0.03 - (i - 1) * 0.012, -0.09, 14, 'lumbar');

// ---------------------------------------------------------------- pelvis
bone('pelvis', 'sacro', 0, 0.0, -0.09, 15, 'pelvis');
bone('pelvis', 'cóccix', 0, -0.07, -0.08, 9, 'pelvis');
bone('pelvis', 'coxal izquierdo', 0.12, 0.0, 0.0, 16, 'pelvis');
bone('pelvis', 'coxal derecho', -0.12, 0.0, 0.0, 16, 'pelvis');

// ---------------------------------------------------------------- arms (30 per side)
const carpals = ['escafoides', 'semilunar', 'piramidal', 'pisiforme', 'trapecio', 'trapezoide', 'grande', 'ganchoso'];
const fingers = ['pulgar', 'índice', 'medio', 'anular', 'meñique'];
for (const [S, side, sx] of [['L', 'izquierdo', 1], ['R', 'derecho', -1]]) {
  const sideF = side === 'izquierdo' ? 'izquierda' : 'derecha';
  bone('upperArm' + S, `húmero ${side}`, 0, 0, 0, 15, 'long');
  bone('lowerArm' + S, `radio ${side}`, 0.015 * sx, 0, 0.01, 12, 'long');
  bone('lowerArm' + S, `cúbito ${side}`, -0.015 * sx, 0, -0.01, 12, 'long');
  carpals.forEach((n, i) => bone('hand' + S, `${n} ${side}`, (i % 4 - 1.5) * 0.012 * sx, 0.06 - Math.floor(i / 4) * 0.015, 0, 9, 'carpal'));
  fingers.forEach((f, i) => {
    const fx = (i - 2) * 0.014 * sx;
    bone('hand' + S, `metacarpiano del ${f} ${sideF === 'izquierda' ? 'izquierdo' : 'derecho'}`, fx, 0.02, 0, 8, 'metacarpal');
    bone('hand' + S, `falange proximal del ${f} ${side}`, fx, -0.02, 0, 7, 'phalanx');
    if (f !== 'pulgar') bone('hand' + S, `falange media del ${f} ${side}`, fx, -0.045, 0, 6, 'phalanx');
    bone('hand' + S, `falange distal del ${f} ${side}`, fx, -0.07, 0, 6, 'phalanx');
  });
}

// ---------------------------------------------------------------- legs (30 per side)
const tarsals = ['astrágalo', 'calcáneo', 'navicular', 'cuboides', 'cuneiforme medial', 'cuneiforme intermedio', 'cuneiforme lateral'];
const toes = ['dedo gordo', 'segundo dedo', 'tercer dedo', 'cuarto dedo', 'dedo pequeño'];
for (const [S, side, sx] of [['L', 'izquierdo', 1], ['R', 'derecho', -1]]) {
  const sideF = side === 'izquierdo' ? 'izquierda' : 'derecha';
  bone('thigh' + S, `fémur ${side}`, 0, 0.02, 0, 17, 'femur');
  bone('thigh' + S, `rótula ${sideF}`, 0, -0.2, 0.06, 10, 'patella');
  bone('shin' + S, `tibia ${sideF}`, 0.01 * sx, 0, 0.02, 14, 'long');
  bone('shin' + S, `peroné ${side}`, -0.03 * sx, 0, -0.01, 11, 'long');
  tarsals.forEach((n, i) => bone('foot' + S, `${n} ${side}`, (i % 3 - 1) * 0.02, 0.0, -0.08 + i * 0.02, 11, 'tarsal'));
  toes.forEach((t, i) => {
    const tx = (2 - i) * 0.016 * sx;
    bone('foot' + S, `metatarsiano del ${t} ${side}`, tx, 0, 0.04, 9, 'metatarsal');
    bone('foot' + S, `falange proximal del ${t} ${side}`, tx, 0, 0.085, 7, 'phalanx');
    if (i !== 0) bone('foot' + S, `falange media del ${t} ${side}`, tx, 0, 0.1, 6, 'phalanx');
    bone('foot' + S, `falange distal del ${t} ${side}`, tx, 0, 0.115, 6, 'phalanx');
  });
}

export const BONES = B;
export const BONE_COUNT = B.length; // 206

export const BONES_BY_SEG = {};
for (const b of B) (BONES_BY_SEG[b.seg] = BONES_BY_SEG[b.seg] || []).push(b);

/**
 * Per-ragdoll fracture state.
 */
export class Skeleton {
  constructor() {
    this.broken = new Uint8Array(BONE_COUNT);
    this.count = 0;
    this.segBroken = {};
    for (const s in BONES_BY_SEG) this.segBroken[s] = 0;
  }

  reset() {
    this.broken.fill(0);
    this.count = 0;
    for (const s in this.segBroken) this.segBroken[s] = 0;
  }

  /**
   * Resolve an impact on a segment.
   * local: impact point in segment-local coordinates (rest-pose frame)
   * v: impact speed in m/s, focus: 1 = blunt, >1 concentrated (bullets)
   * Returns the list of newly broken bones.
   */
  impact(seg, local, v, focus = 1) {
    const list = BONES_BY_SEG[seg];
    if (!list) return [];
    const out = [];
    const reach = 0.05 + Math.max(0, v - 6) * 0.012 / focus;
    // concentrated hits (bullets) break the one or two bones they go through;
    // blunt hits break more the harder they are
    const maxBreaks = focus > 1.5 ? 2 : Math.max(1, Math.ceil((v - 5) / 3));
    const cand = [];
    for (const b of list) {
      if (this.broken[b.id]) continue;
      const dx = b.p[0] - local[0], dy = b.p[1] - local[1], dz = b.p[2] - local[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > reach * 2.2) continue;
      const need = b.tough * (1 + d / reach) / focus;
      if (v > need && Math.random() < 0.55 + (v - need) * 0.08) cand.push([d, b]);
    }
    cand.sort((x, y) => x[0] - y[0]);
    for (let i = 0; i < cand.length && i < maxBreaks; i++) {
      const b = cand[i][1];
      this.broken[b.id] = 1;
      this.count++;
      this.segBroken[seg]++;
      out.push(b);
    }
    return out;
  }

  /** Break random bones across the body (explosions, nuke). */
  blast(intensity) {
    const out = [];
    const n = Math.round(intensity * 40);
    for (let i = 0; i < n; i++) {
      const b = B[(Math.random() * BONE_COUNT) | 0];
      if (this.broken[b.id]) continue;
      if (Math.random() < intensity) {
        this.broken[b.id] = 1; this.count++; this.segBroken[b.seg]++;
        out.push(b);
      }
    }
    return out;
  }

  has(kindOrName) {
    for (const b of B) if (this.broken[b.id] && (b.kind === kindOrName || b.name === kindOrName)) return true;
    return false;
  }

  /** Structural failure of a segment: a long bone or enough small bones gone. */
  segmentFailed(seg) {
    const list = BONES_BY_SEG[seg];
    if (!list) return false;
    for (const b of list) {
      if (!this.broken[b.id]) continue;
      if (b.kind === 'long' || b.kind === 'femur' || b.kind === 'cervical' || b.kind === 'lumbar') return true;
    }
    return this.segBroken[seg] >= Math.max(3, list.length * 0.4);
  }

  ratio(seg) {
    const list = BONES_BY_SEG[seg];
    return list ? this.segBroken[seg] / list.length : 0;
  }
}
