import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import * as lv from './level.js';
import { L } from './level.js';
import { gridTexture, buildingTexture, hazardTexture } from './textures.js';
import { MAT } from './physics.js';
import * as fx from './fx.js';
import * as sfx from './audio.js';

const PI = Math.PI;

function at(mesh, x, y, z) { mesh.position.set(x, y, z); return mesh; }

function cratePyramid(x, z, rows, size = 0.8, y0 = 0) {
  for (let r = 0; r < rows; r++) {
    const n = rows - r;
    for (let i = 0; i < n; i++) {
      lv.crate([x + (i - (n - 1) / 2) * (size + 0.02), y0 + size / 2 + r * size, z], size);
    }
  }
}

function crateWall(x, z, cols, rows, size = 0.8, yaw = 0, y0 = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < cols; i++) {
      const off = (i - (cols - 1) / 2) * (size + 0.01) + (r % 2 ? size * 0.25 : 0);
      lv.crate([x + c * off, y0 + size / 2 + r * size, z - s * off], size, [0, yaw, 0]);
    }
  }
}

// ======================================================================
export const MAPS = [
  {
    id: 'patio',
    name: 'El Patio',
    emoji: '🛝',
    desc: 'Sandbox clásico: rampas, dominó, balancín, tronco colgante, cama elástica y plataformas de lanzamiento.',
    env: { skyTop: '#5d9fe0', skyBottom: '#dfe9f2', fog: 0xdfe9f2, fogNear: 60, fogFar: 170, sun: [30, 50, 18] },
    spawn: { pos: [0, 0, 0], yaw: 0 },
    killY: -30,
    build() {
      lv.floor([180, 1, 180], [0, -0.5, 0], gridTexture('#9aa3ad', '#7d8794'), 0xffffff);

      // ramp up to a platform
      lv.staticBox([4, 0.4, 10], [-9, 1.35, 9.8], { rot: [-0.3, 0, 0], color: 0x5c8fd6 });
      lv.staticBox([6, 3, 6], [-9, 1.5, 17.6], { color: 0x7b8594 });
      for (let i = 0; i < 3; i++) lv.barrel([-10.8 + i * 1.8, 3.6, 19.5]);
      lv.launchPad([-7, 3, 15.5], [0, 12, -9]);

      // stairs to a diving board
      for (let i = 0; i < 10; i++) {
        const h = 0.4 * (i + 1);
        lv.staticBox([3.2, h, 0.8], [18, h / 2, 2 + i * 0.8], { color: i % 2 ? 0xc7ccd4 : 0xb3b9c3 });
      }
      lv.staticBox([3.2, 4, 3], [18, 2, 11.1], { color: 0x9da4ae });
      lv.staticBox([1.2, 0.2, 4], [18, 4.1, 14.4], { color: 0x2f88ff });
      lv.trampoline([18, 0, 19.5], [3.2, 3.2]);

      // crate pyramid + loose crates
      cratePyramid(6, 9, 5);
      lv.crate([9, 0.4, 5]); lv.crate([9.9, 0.4, 5.3]);

      // launch pad aimed at a crate wall
      lv.launchPad([12, 0, -4], [0, 12.5, -6.5]);
      crateWall(12, -20.5, 7, 4, 0.8);

      // dominoes on an arc
      for (let i = 0; i < 32; i++) {
        const a = i * 0.09;
        const r = 9;
        const x = -6 - Math.sin(a) * r * 0.9 + 0;
        const z = -6 - (1 - Math.cos(a)) * r - i * 0.45;
        const yaw = -a * 0.9;
        lv.domino([x, 0.5, z], yaw, i % 2 ? 0xf4f1ea : 0xff6b4a);
      }

      // seesaw with a crate on one end
      lv.seesaw([4, 0, -12], 6.5);
      lv.crate([6.6, 1.8, -12], 0.7);

      // swinging log
      const posts = lv.stdMat(0x5a4632, { roughness: 0.9 });
      for (const x of [-16.2, -11.8]) lv.staticBox([0.3, 5.6, 0.3], [x, 2.8, -6], { mat: posts });
      lv.staticBox([4.7, 0.3, 0.3], [-14, 5.6, -6], { mat: posts });
      const log = lv.swingLog([-14, 5.4, -6], 4.0, [0.32, 3.4], 120);
      log.velocity.set(0, 0, 7);

      // balls
      for (let i = 0; i < 5; i++) lv.ball([-2 + i * 1.2, 0.6, 6 + (i % 2)], 0.45, 2, [0xff5b5b, 0x4fa3ff, 0xffd24a, 0x59e08b, 0xc48bff][i], MAT.bouncy);
      lv.ball([2, 0.3, -4], 0.26, 9, 0x23252b);
      lv.ball([2.8, 0.3, -4.4], 0.26, 9, 0x8a2be2);

      // barrels cluster
      for (const [x, z] of [[-2, -18], [-1.1, -18.6], [-2.5, -19.3], [-1.6, -19.8]]) lv.barrel([x, 0.5, z]);

      // big ramp to fly off
      lv.staticBox([5, 0.4, 14], [-26, 2.0, 2], { rot: [0.3, 0, 0], color: 0xff8a3d });
      lv.staticBox([5, 6, 4], [-26, 3, -6.5], { color: 0x7b8594 });
      for (let i = 0; i < 6; i++) lv.staticBox([5, 0.6 * (i + 1), 0.7], [-26, 0.3 * (i + 1), -9.0 - i * 0.7 + 0.0 * i], { color: 0xb3b9c3 });
    },
  },

  // ======================================================================
  {
    id: 'escalera',
    name: 'Escalera del Dolor',
    emoji: '🪜',
    desc: '40 escalones de puro sufrimiento. Empújalo, dispárale o tírate tú mismo. Cada golpe suma.',
    env: { skyTop: '#2c3e66', skyBottom: '#e8a26b', fog: 0xd99a6a, fogNear: 50, fogFar: 160, sun: [-25, 40, 30] },
    spawn: { pos: [0, 18, 1.5], yaw: 0 },
    killY: -30,
    build() {
      lv.floor([160, 1, 160], [0, -0.5, 20], gridTexture('#a99a8a', '#8c7d6e'), 0xffffff);
      const stone = lv.stdMat(0xc9bba8, { roughness: 0.95 });
      const stone2 = lv.stdMat(0xb6a893, { roughness: 0.95 });
      lv.staticBox([10, 18, 8], [0, 9, -1], { color: 0x8c7f70 });
      let z = 3;
      let h = 18;
      for (let i = 0; i < 40; i++) {
        if (i === 20) {
          // mid landing
          lv.staticBox([6, h, 3], [0, h / 2, z + 1.5], { mat: stone2 });
          lv.barrel([2.2, h + 0.5, z + 1.6]);
          z += 3;
        }
        h -= 0.45;
        lv.staticBox([6, h, 0.8], [0, h / 2, z + 0.4], { mat: i % 2 ? stone : stone2 });
        z += 0.8;
      }
      // pillars along the sides
      for (let i = 0; i < 6; i++) {
        const zz = 5 + i * 6;
        const top = 18 - (zz - 3) * 0.55;
        lv.staticBox([0.5, Math.max(1, top + 1.5), 0.5], [3.6, Math.max(1, top + 1.5) / 2, zz], { color: 0x6e6255 });
        lv.staticBox([0.5, Math.max(1, top + 1.5), 0.5], [-3.6, Math.max(1, top + 1.5) / 2, zz], { color: 0x6e6255 });
      }
      // stuff at the bottom
      cratePyramid(0, z + 6, 4);
      for (const x of [-4, -3, 3.5, 4.4]) lv.barrel([x, 0.5, z + 3]);
      crateWall(0, z + 12, 9, 3, 0.8);
      // something to roll down the stairs
      lv.ball([1.5, 18.6, -2], 0.5, 40, 0x2b2b30);
      lv.crate([-2.5, 18.4, -2.5]);
      lv.crate([-2.5, 19.2, -2.5]);
    },
  },

  // ======================================================================
  {
    id: 'picadora',
    name: 'La Picadora',
    emoji: '⚙️',
    desc: 'Pista de obstáculos sobre el vacío: barredoras, martillos y pistones. Llega a la meta… si puedes.',
    env: { skyTop: '#3b2a5c', skyBottom: '#ff9c7a', fog: 0xb07a8a, fogNear: 40, fogFar: 140, sun: [20, 40, -30] },
    spawn: { pos: [0, 0, 2], yaw: 0 },
    killY: -18,
    timed: true,
    build() {
      // the void: a far-away sea
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x2b5b8a, roughness: 0.2, metalness: 0.3 }));
      sea.rotation.x = -PI / 2; sea.position.y = -32;
      lv.decoMesh(sea);

      const track = lv.stdMat(0x3c4150, { roughness: 0.85 });
      const edge = new THREE.MeshStandardMaterial({ map: hazardTexture([30, 1]), roughness: 0.7 });
      const seg = (z0, z1, w = 8) => {
        const len = z1 - z0;
        lv.staticBox([w, 1, len], [0, -0.5, z0 + len / 2], { mat: track });
        for (const s of [1, -1]) lv.decoMesh(at(new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.02, len), edge), s * (w / 2 - 0.15), -0.49, z0 + len / 2));
      };
      seg(-4, 54);
      seg(54, 66, 1.4);
      seg(66, 92);

      lv.spinner([0, 0, 12], 7.6, 0.55, 1.7);

      lv.hammer([0, 7.2, 21], 6.2, 1.05, 0.42, 0);
      lv.hammer([0, 7.2, 26], 6.2, 1.05, 0.42, PI);

      // side walls with pistons
      for (const [s, z, ph] of [[1, 32, 0], [-1, 35.5, 0.5], [1, 39, 0.25]]) {
        lv.staticBox([1, 3, 3], [s * 4.5, 1.5, z], { color: 0x2d3038 });
        lv.piston([s * 3.5, 0.9, z], [-s, 0, 0], [2.2, 1.5, 2.2], 4.2, 0.55, ph);
      }

      lv.spinner([0, 0, 45], 7.6, 1.35, -2.0);
      lv.spinner([0, 0, 50.5], 7.6, 0.5, 2.5);

      for (let i = 0; i < 3; i++) lv.hammer([0, 7.2, 71 + i * 4.5], 6.2, 1.1, 0.48, i * 2.1);

      lv.spinner([0, 0, 85], 7.6, 0.9, 1.4);

      // finish
      lv.staticBox([8, 0.1, 3], [0, 0.05, 90], { color: 0xffffff, mat: new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.6 }) });
      lv.flag([3.6, 0, 90]);
      lv.flag([-3.6, 0, 90], 0x59e08b);

      // checkpoints
      for (const z of [30, 55, 68]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 8, 24), lv.stdMat(0x5cc8ff, { emissive: 0x5cc8ff, emissiveIntensity: 1.2 }));
        ring.position.set(0, 2.6, z);
        lv.decoMesh(ring);
        lv.trigger([0, 1, z], [4, 2, 0.6], (who) => {
          if (who !== 'ragdoll' || L.checkpoint?.[2] >= z) return;
          L.checkpoint = [0, 0, z];
          ring.material = lv.stdMat(0x59e08b, { emissive: 0x59e08b, emissiveIntensity: 1.4 });
          fx.banner('CHECKPOINT');
          sfx.blip(880);
        }, { cooldown: 2 });
      }
      lv.trigger([0, 1, 90], [4, 2, 1.4], (who) => {
        if (who !== 'ragdoll' || L.finished) return;
        L.finished = true;
        L.onFinish?.();
      }, { cooldown: 5 });

      // crates to knock off
      for (const z of [16, 41, 60, 80]) lv.crate([1.5, 0.4, z], 0.7);
    },
  },

  // ======================================================================
  {
    id: 'tejados',
    name: 'Los Tejados',
    emoji: '🏙️',
    desc: 'Azoteas a 30 metros, plataformas de lanzamiento entre edificios, una bola de demolición y una calle llena de coches.',
    env: { skyTop: '#7fb6ea', skyBottom: '#f3e6d0', fog: 0xe9e0d0, fogNear: 70, fogFar: 230, sun: [40, 70, 20] },
    spawn: { pos: [0, 30, -2], yaw: 0 },
    killY: -30,
    build() {
      lv.floor([240, 1, 240], [0, -0.5, 10], gridTexture('#55585e', '#45484d', [1, 1]), 0xffffff);
      // street lines
      for (let i = -10; i < 12; i++) lv.decoMesh(at(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 2), lv.stdMat(0xf2f2f2)), 12, 0.01, i * 5));

      const bld = (x, z, w, d, h, color) => {
        const tex = buildingTexture(color, [Math.round(w / 3), Math.round(h / 3)]);
        lv.staticBox([w, h, d], [x, h / 2, z], { mat: new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }) });
        lv.staticBox([w + 0.4, 0.5, d + 0.4], [x, h + 0.25, z], { color: 0x5b5f68 });
        return h + 0.5;
      };
      const hA = bld(0, 0, 10, 10, 29.5, '#8a93a3');
      const hB = bld(0, 22, 10, 10, 21.5, '#a3887a');
      const hC = bld(24, 22, 10, 10, 25.5, '#7a8fa3');
      const hD = bld(24, 0, 10, 10, 17.5, '#93a37a');
      bld(-22, 10, 10, 26, 12, '#a39a7a');
      bld(48, 10, 12, 30, 34, '#7d8592');

      // A roof: launch pad to B, AC units, crates
      lv.launchPad([0, hA, 3.2], [0, 8.5, 8.5]);
      lv.launchPad([3.2, hA, -3], [9.4, 7.5, 0], 0xffb02e);
      lv.staticBox([2, 1.2, 1.5], [-3, hA + 0.6, -3], { color: 0xb8bcc4 });
      lv.staticBox([1.5, 1.6, 1.5], [-3, hA + 0.8, 1], { color: 0xb8bcc4 });
      lv.crate([2.5, hA + 0.4, -1]); lv.crate([2.5, hA + 1.2, -1]);
      lv.barrel([-3.5, hA + 0.5, 3.8]);

      // B roof: crate fort, barrels
      cratePyramid(0, 25, 4, 0.8, hB);
      for (const x of [-3.5, 3.5]) lv.barrel([x, hB + 0.5, 19.5]);
      lv.launchPad([-3, hB, 25], [8, 9, 0], 0xffb02e);

      // C roof: more pads back to A
      lv.launchPad([24, hC, 20], [-7.2, 7, -6.5]);
      lv.crate([22, hC + 0.4, 25]); lv.crate([26, hC + 0.4, 25]);

      // D roof (lowest): trampoline
      lv.trampoline([24, hD, 0], [3.4, 3.4]);
      lv.launchPad([20.5, hD, -3], [-6.5, 11, 0.5]);

      // wrecking ball crane over B
      const mast = lv.stdMat(0xf2b31f, { roughness: 0.5, metalness: 0.3 });
      lv.staticBox([0.8, 16, 0.8], [-6.5, hB + 8, 22], { mat: mast });
      lv.staticBox([7.4, 0.8, 0.8], [-3, hB + 16, 22], { mat: mast });
      wreckingBall([0, hB + 16, 22], 13.2, 0.95, 0.2);

      // street: parked cars, trampoline, crates, barrels
      const carColors = [0xd8402a, 0x2f88ff, 0x59e08b, 0xf2c12e, 0xeeeeee];
      for (let i = 0; i < 6; i++) car([8.5, 0.75, -14 + i * 7.5], carColors[i % carColors.length], i % 2 ? 0 : PI);
      lv.trampoline([6.5, 0, 6], [3.4, 3.4]);
      cratePyramid(-8, -12, 4);
      for (const [x, z] of [[-8, 34], [-7, 35], [-8.6, 35.6]]) lv.barrel([x, 0.5, z]);
      crateWall(15, 34, 6, 3, 0.8, PI / 2);
    },
  },
];

function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4'; g.fillRect(x * 16, y * 16, 16, 16); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 1.5);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

function wreckingBall(pivot, len, amp, freq) {
  const g = new THREE.Group();
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, len, 6), lv.stdMat(0x333333, { metalness: 0.8, roughness: 0.3 }));
  chain.position.y = -len / 2;
  const ballM = new THREE.Mesh(new THREE.SphereGeometry(1.15, 24, 18), lv.stdMat(0x2b2d33, { metalness: 0.7, roughness: 0.35 }));
  ballM.position.y = -len;
  g.add(chain, ballM);
  const axis = new THREE.Vector3(1, 0, 0);
  lv.kinematic([{ shape: new CANNON.Sphere(1.15), offset: new CANNON.Vec3(0, -len, 0) }], g,
    (t) => ({ pos: pivot, quat: new THREE.Quaternion().setFromAxisAngle(axis, amp * Math.sin(t * freq * PI * 2)) }));
}

function car(pos, color, yaw) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.8, 4.2), lv.stdMat(color, { roughness: 0.35, metalness: 0.4 }));
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.65, 2.2), lv.stdMat(0x9fd3ff, { roughness: 0.1, metalness: 0.6 }));
  top.position.set(0, 0.7, -0.2);
  g.add(body, top);
  for (const [x, z] of [[0.9, 1.3], [-0.9, 1.3], [0.9, -1.3], [-0.9, -1.3]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.28, 14), lv.stdMat(0x1a1a1a));
    w.rotation.z = PI / 2; w.position.set(x, -0.38, z); g.add(w);
  }
  const b = lv.dynamicBody([
    lv.boxShape(1.9, 0.8, 4.2),
    lv.boxShape(1.7, 0.65, 2.2, [0, 0.7, -0.2]),
    lv.boxShape(1.9, 0.4, 3.6, [0, -0.4, 0]),
  ], pos, 900, g, { rot: [0, yaw, 0], material: MAT.vehicle });
  L.props.push(b);
  return b;
}
