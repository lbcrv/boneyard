/*
 * Combat animation clips. A physics ragdoll can't "play" an animation, so a
 * clip is a set of keyframed joint targets that the muscles chase, with easing
 * between keys (anticipation, snap, hold, recover), a hit window, and root
 * motion (lunge, crouch, spin) applied by the balance layer.
 *
 * Joint values: [x, y, z] Euler (radians) relative to the parent segment, or a
 * number for hinges (elbow, knee). Signs, character facing +Z:
 *   shoulder/hip x < 0  -> limb swings forward
 *   shoulder z > 0 (L) / < 0 (R) -> arm out to the side
 *   elbow < 0 bends, knee > 0 bends
 *   lumbar/thoracic x > 0 leans forward, y > 0 turns the chest to his left
 *   neck x > 0 chin down
 * Orthodox stance: left side leads.
 */

// fighting guard: hands up by the chin, chest bladed, chin tucked
export const GUARD = {
  lumbar: [0.08, -0.1, 0], thoracic: [0.08, -0.2, 0], neck: [0.18, 0.25, 0],
  shoulderL: [-1.0, 0, 0.32], elbowL: -2.15, wristL: [0, 0, 0],
  shoulderR: [-0.75, 0, -0.38], elbowR: -2.4, wristR: [0, 0, 0],
};

// forearms up in front of the face
export const BLOCK = {
  lumbar: [0.12, 0, 0], thoracic: [0.12, 0, 0], neck: [0.35, 0, 0],
  shoulderL: [-1.45, 0, 0.12], elbowL: -2.5, wristL: [0, 0, 0],
  shoulderR: [-1.45, 0, -0.12], elbowR: -2.5, wristR: [0, 0, 0],
};

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeIn = (t) => t * t * t;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const EASE = { out: easeOut, in: easeIn, inOut: easeInOut, lin: (t) => t };

/*
 * Clip fields
 *   dur        total seconds
 *   hit        [start, end] window where the strike can land
 *   limb       striking segment ('handL', 'footR', ...)
 *   power      m/s pushed into the struck part
 *   aim        body parts to home on
 *   high       true: ducks/blocks stop it
 *   leg        side whose leg the clip drives (feet planner leaves it alone)
 *   heavy      can knock down a healthy fighter
 *   keys       [time, pose, ease-into-this-key]
 *   lunge      [[t, m/s forward], ...] applied as a short burst at t
 *   drop       pelvis height offset curve [[t, metres]]
 *   spin       yaw offset curve [[t, rad]] (roundhouse turns the hips)
 */
export const CLIPS = {
  jab: {
    dur: 0.3, hit: [0.08, 0.17], limb: 'handL', power: 3.4, dmg: 0.8, aim: ['head', 'chest'], high: true,
    keys: [
      [0, GUARD],
      [0.05, { shoulderL: [-1.1, 0, 0.26], elbowL: -1.9 }, 'out'],
      [0.11, { shoulderL: [-1.62, 0, -0.02], elbowL: -0.05, thoracic: [0.1, -0.38, 0], lumbar: [0.1, -0.16, 0], neck: [0.18, 0.4, 0] }, 'out'],
      [0.17, { shoulderL: [-1.6, 0, 0], elbowL: -0.1, thoracic: [0.1, -0.36, 0], lumbar: [0.1, -0.15, 0], neck: [0.18, 0.4, 0] }, 'lin'],
      [0.3, GUARD, 'inOut'],
    ],
    lunge: [[0.04, 1.1]],
  },
  cross: {
    dur: 0.42, hit: [0.12, 0.24], limb: 'handR', power: 4.6, dmg: 1.15, aim: ['head', 'chest'], high: true,
    keys: [
      [0, GUARD],
      [0.08, { thoracic: [0.04, -0.4, 0], lumbar: [0.04, -0.22, 0], shoulderR: [-0.7, 0, -0.45], elbowR: -2.45 }, 'inOut'],
      [0.16, { shoulderR: [-1.62, 0, 0.06], elbowR: -0.04, thoracic: [0.14, 0.5, 0], lumbar: [0.12, 0.32, 0], shoulderL: [-0.85, 0, 0.4], elbowL: -2.35, neck: [0.18, -0.45, 0] }, 'out'],
      [0.23, { shoulderR: [-1.58, 0, 0.04], elbowR: -0.1, thoracic: [0.14, 0.48, 0], lumbar: [0.12, 0.3, 0], shoulderL: [-0.85, 0, 0.4], elbowL: -2.35, neck: [0.18, -0.45, 0] }, 'lin'],
      [0.42, GUARD, 'inOut'],
    ],
    lunge: [[0.1, 1.5]],
  },
  hook: {
    dur: 0.45, hit: [0.13, 0.25], limb: 'handL', power: 5, dmg: 1.3, aim: ['head'], high: true,
    keys: [
      [0, GUARD],
      [0.08, { thoracic: [0.06, 0.25, 0], lumbar: [0.06, 0.12, 0], shoulderL: [-0.85, 0, 0.95], elbowL: -1.75 }, 'inOut'],
      [0.17, { shoulderL: [-1.3, 0, 1.0], elbowL: -1.6, thoracic: [0.12, -0.65, 0], lumbar: [0.1, -0.35, 0], neck: [0.18, 0.6, 0] }, 'out'],
      [0.25, { shoulderL: [-1.35, 0, 0.85], elbowL: -1.65, thoracic: [0.12, -0.7, 0], lumbar: [0.1, -0.38, 0], neck: [0.18, 0.6, 0] }, 'lin'],
      [0.45, GUARD, 'inOut'],
    ],
    lunge: [[0.1, 0.8]],
  },
  uppercut: {
    dur: 0.52, hit: [0.15, 0.28], limb: 'handR', power: 5.6, dmg: 1.45, aim: ['head'], high: true, heavy: true, lift: 2.6,
    keys: [
      [0, GUARD],
      [0.11, { shoulderR: [0.15, 0, -0.3], elbowR: -1.9, lumbar: [0.38, -0.1, 0], thoracic: [0.22, -0.25, 0], neck: [0.3, 0, 0] }, 'inOut'],
      [0.2, { shoulderR: [-2.0, 0, -0.08], elbowR: -1.65, lumbar: [-0.08, 0.32, 0], thoracic: [-0.12, 0.42, 0], neck: [0.05, -0.3, 0] }, 'out'],
      [0.28, { shoulderR: [-2.05, 0, -0.06], elbowR: -1.7, lumbar: [-0.1, 0.3, 0], thoracic: [-0.12, 0.4, 0], neck: [0.05, -0.3, 0] }, 'lin'],
      [0.52, GUARD, 'inOut'],
    ],
    drop: [[0, 0], [0.11, -0.13], [0.22, 0.03], [0.52, 0]],
    lunge: [[0.13, 1.0]],
  },
  frontKick: {
    dur: 0.55, hit: [0.15, 0.3], limb: 'footR', power: 6, dmg: 1.4, aim: ['chest', 'abdomen'], high: true, leg: 'R', heavy: true,
    keys: [
      [0, GUARD],
      [0.11, { hipR: [-1.45, 0, 0.02], kneeR: 2.15, ankleR: [0.2, 0, 0], lumbar: [0.02, 0, 0] }, 'out'],
      [0.19, { hipR: [-1.6, 0, 0], kneeR: 0.05, ankleR: [0.45, 0, 0], lumbar: [-0.2, 0, 0], thoracic: [-0.08, 0, 0] }, 'out'],
      [0.3, { hipR: [-1.55, 0, 0], kneeR: 0.08, ankleR: [0.45, 0, 0], lumbar: [-0.2, 0, 0], thoracic: [-0.08, 0, 0] }, 'lin'],
      [0.38, { hipR: [-1.3, 0, 0], kneeR: 1.9, ankleR: [0.1, 0, 0] }, 'inOut'],
      [0.55, { ...GUARD, hipR: [-0.1, 0, 0], kneeR: 0.3 }, 'inOut'],
    ],
    lunge: [[0.15, 0.9]],
  },
  roundhouse: {
    // the leg is heavy and the servos lag it by ~0.15 s, so the keys lead the hit window
    dur: 0.7, hit: [0.2, 0.44], limb: 'footR', power: 7, dmg: 1.7, aim: ['chest', 'abdomen', 'head'], high: true, leg: 'R', heavy: true,
    keys: [
      [0, GUARD],
      [0.09, { hipR: [-1.1, 0, -0.9], kneeR: 2.1, ankleR: [0.3, 0, 0], lumbar: [0.05, 0.55, 0], thoracic: [0, 0.3, 0], shoulderL: [-0.6, 0, 0.8], elbowL: -1.4 }, 'out'],
      [0.18, { hipR: [-1.45, 0, -1.1], kneeR: 0.1, ankleR: [0.45, 0, 0], lumbar: [-0.15, 0.75, 0], thoracic: [-0.05, 0.4, 0], shoulderL: [-0.3, 0, 1.1], elbowL: -0.8 }, 'out'],
      [0.4, { hipR: [-1.4, 0, -1.05], kneeR: 0.15, ankleR: [0.45, 0, 0], lumbar: [-0.15, 0.7, 0], thoracic: [-0.05, 0.4, 0], shoulderL: [-0.3, 0, 1.1], elbowL: -0.8 }, 'lin'],
      [0.53, { hipR: [-0.8, 0, -0.5], kneeR: 1.8, lumbar: [0.05, 0.2, 0] }, 'inOut'],
      [0.7, { ...GUARD, hipR: [-0.1, 0, 0], kneeR: 0.3 }, 'inOut'],
    ],
    spin: [[0, 0], [0.1, -0.5], [0.3, 0.55], [0.7, 0]],
    lunge: [[0.16, 0.9]],
  },
  knee: {
    dur: 0.46, hit: [0.12, 0.26], limb: 'thighR', power: 5, dmg: 1.3, aim: ['abdomen', 'chest'], high: true, leg: 'R',
    keys: [
      [0, GUARD],
      [0.08, { shoulderL: [-1.5, 0, 0.1], elbowL: -1.2, shoulderR: [-1.5, 0, -0.1], elbowR: -1.2 }, 'out'],
      [0.17, { hipR: [-2.0, 0, 0], kneeR: 2.3, ankleR: [0.3, 0, 0], lumbar: [0.25, 0, 0], thoracic: [0.15, 0, 0], shoulderL: [-1.2, 0, 0.1], elbowL: -1.6, shoulderR: [-1.2, 0, -0.1], elbowR: -1.6 }, 'out'],
      [0.26, { hipR: [-1.9, 0, 0], kneeR: 2.3, lumbar: [0.25, 0, 0], thoracic: [0.15, 0, 0] }, 'lin'],
      [0.46, { ...GUARD, hipR: [-0.1, 0, 0], kneeR: 0.3 }, 'inOut'],
    ],
    lunge: [[0.1, 1.2]],
  },
  sweep: {
    dur: 0.62, hit: [0.16, 0.36], limb: 'footR', power: 6.5, dmg: 0.7, aim: ['shinL', 'shinR'], high: false, leg: 'R', sweep: true,
    keys: [
      [0, GUARD],
      [0.12, { hipL: [-1.3, 0, 0.1], kneeL: 2.1, hipR: [-0.2, 0, -0.5], kneeR: 0.3, lumbar: [0.5, 0.4, 0], thoracic: [0.2, 0.2, 0] }, 'inOut'],
      [0.28, { hipR: [-0.9, 0, 0.35], kneeR: 0.1, ankleR: [0.3, 0, 0], lumbar: [0.5, -0.55, 0], thoracic: [0.2, -0.3, 0] }, 'out'],
      [0.62, { ...GUARD, hipR: [-0.1, 0, 0], kneeR: 0.3 }, 'inOut'],
    ],
    drop: [[0, 0], [0.12, -0.38], [0.45, -0.38], [0.62, 0]],
    spin: [[0, 0], [0.12, 0.4], [0.36, -0.6], [0.62, 0]],
  },
  flykick: {
    dur: 0.6, hit: [0.08, 0.38], limb: 'footR', power: 7.5, dmg: 1.7, aim: ['head', 'chest'], high: true, leg: 'R', heavy: true,
    keys: [
      [0, GUARD],
      [0.08, { hipR: [-1.5, 0, 0], kneeR: 0.05, ankleR: [0.45, 0, 0], hipL: [-0.5, 0, 0], kneeL: 1.8, lumbar: [-0.25, 0, 0], shoulderL: [-0.4, 0, 0.9], shoulderR: [-0.4, 0, -0.9] }, 'out'],
      [0.38, { hipR: [-1.5, 0, 0], kneeR: 0.05, ankleR: [0.45, 0, 0], hipL: [-0.5, 0, 0], kneeL: 1.8, lumbar: [-0.25, 0, 0] }, 'lin'],
      [0.6, GUARD, 'inOut'],
    ],
    lunge: [[0.02, 3.2]],
  },
  shove: {
    dur: 0.42, hit: [0.13, 0.26], limb: 'handL', both: true, power: 6.5, dmg: 0.4, aim: ['chest'], high: true,
    keys: [
      [0, GUARD],
      [0.12, { shoulderL: [-0.9, 0, 0.1], elbowL: -1.9, shoulderR: [-0.9, 0, -0.1], elbowR: -1.9, wristL: [-1, 0, 0], wristR: [-1, 0, 0] }, 'inOut'],
      [0.2, { shoulderL: [-1.5, 0, 0.05], elbowL: -0.05, shoulderR: [-1.5, 0, -0.05], elbowR: -0.05, wristL: [-1, 0, 0], wristR: [-1, 0, 0], lumbar: [0.3, 0, 0] }, 'out'],
      [0.42, GUARD, 'inOut'],
    ],
    lunge: [[0.12, 2.2]],
  },
  // caught an attack in its wind-up: grab and throw over the shoulder
  reversal: {
    dur: 0.6, hit: [9, 9], limb: null, power: 0, dmg: 0, aim: [],
    keys: [
      [0, GUARD],
      [0.12, { shoulderL: [-1.6, 0, -0.2], elbowL: -0.4, shoulderR: [-1.6, 0, 0.2], elbowR: -0.4, lumbar: [0.35, -0.4, 0], thoracic: [0.2, -0.3, 0] }, 'out'],
      [0.35, { shoulderL: [-2.0, 0, 0.4], elbowL: -0.8, shoulderR: [-2.0, 0, -0.4], elbowR: -0.8, lumbar: [0.5, 0.5, 0], thoracic: [0.3, 0.4, 0] }, 'inOut'],
      [0.6, GUARD, 'inOut'],
    ],
    drop: [[0, 0], [0.15, -0.2], [0.4, -0.1], [0.6, 0]],
  },
};

// hit reactions: the struck fighter snaps away from the blow
export const REACTIONS = {
  head: (sx) => ({ neck: [-0.65, 0.45 * sx, 0], thoracic: [-0.3, 0.35 * sx, 0], lumbar: [-0.1, 0.1 * sx, 0], shoulderL: [-0.4, 0, 0.7], elbowL: -1.2, shoulderR: [-0.4, 0, -0.7], elbowR: -1.2 }),
  body: () => ({ lumbar: [0.6, 0, 0], thoracic: [0.45, 0, 0], neck: [0.4, 0, 0], shoulderL: [-0.9, 0, 0.15], elbowL: -1.9, shoulderR: [-0.9, 0, -0.15], elbowR: -1.9 }),
  low: () => ({ lumbar: [0.3, 0, 0], neck: [0.2, 0, 0], shoulderL: [-0.3, 0, 0.9], shoulderR: [-0.3, 0, -0.9] }),
};

// player/AI combos: pressing the same button again inside the chain window
export const CHAINS = {
  punch: ['jab', 'cross', 'hook', 'uppercut'],
  kick: ['frontKick', 'roundhouse'],
};

function curve(points, t) {
  if (!points) return 0;
  if (t <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (t <= points[i][0]) {
      const [t0, v0] = points[i - 1], [t1, v1] = points[i];
      return v0 + (v1 - v0) * easeInOut((t - t0) / Math.max(1e-6, t1 - t0));
    }
  }
  return points[points.length - 1][1];
}

/** Pose of a clip at time t: { joint: [x,y,z] | number } (GUARD fills gaps). */
export function sampleClip(clip, t, out = {}) {
  const keys = clip.keys;
  let i = 1;
  while (i < keys.length - 1 && t > keys[i][0]) i++;
  const [t0, p0raw] = keys[i - 1];
  const [t1, p1raw, ez] = keys[i];
  const k = Math.max(0, Math.min(1, (t - t0) / Math.max(1e-6, t1 - t0)));
  const e = (EASE[ez] || easeInOut)(k);
  const p0 = { ...GUARD, ...p0raw }, p1 = { ...GUARD, ...p1raw };
  for (const j of new Set([...Object.keys(p0), ...Object.keys(p1)])) {
    const a = p0[j], b = p1[j];
    if (a === undefined) { out[j] = b; continue; }
    if (b === undefined) { out[j] = a; continue; }
    out[j] = typeof a === 'number' ? a + (b - a) * e : [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e];
  }
  return out;
}

export function clipDrop(clip, t) { return curve(clip.drop, t); }
export function clipSpin(clip, t) { return curve(clip.spin, t); }
