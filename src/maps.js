import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import * as lv from './level.js';
import { L } from './level.js';
import { gridTexture, buildingTexture, hazardTexture } from './textures.js';
import { MAT } from './physics.js';
import * as fx from './fx.js';
import * as sfx from './audio.js';
import { makeCar, makeBus, makeTruck } from './carmodels.js';

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
    name: 'Patio',
    code: 'P-01',
    desc: 'Rampas, dominó, balancín, un tronco colgante y una cama elástica. Dos plataformas de lanzamiento.',
    env: { skyTop: '#7f9cb8', skyBottom: '#dcdfe0', fog: 0xdcdfe0, fogNear: 60, fogFar: 170, sun: [30, 50, 18] },
    spawn: { pos: [0, 0, 0], yaw: 0 },
    killY: -30,
    build() {
      lv.floor([180, 1, 180], [0, -0.5, 0], gridTexture('#8f8c86', '#76736d'), 0xffffff);

      // ramp up to a platform
      lv.staticBox([4, 0.4, 10], [-9, 1.35, 9.8], { rot: [-0.3, 0, 0], color: 0xe0b13a });
      toeWedge(-9, 4, 5.02, 0.065, 1, 0xe0b13a);
      lv.staticBox([6, 3, 6], [-9, 1.5, 17.6], { color: 0x6f6c66 });
      for (let i = 0; i < 3; i++) lv.barrel([-10.8 + i * 1.8, 3.6, 19.5]);
      lv.launchPad([-7, 3, 15.5], [0, 12, -9]);

      // stairs to a diving board
      for (let i = 0; i < 10; i++) {
        const h = 0.4 * (i + 1);
        lv.staticBox([3.2, h, 0.8], [18, h / 2, 2 + i * 0.8], { color: i % 2 ? 0xa8a49b : 0x99958c });
      }
      lv.staticBox([3.2, 4, 3], [18, 2, 11.1], { color: 0x86827a });
      lv.staticBox([1.2, 0.2, 4], [18, 4.1, 14.4], { color: 0xe0b13a });
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
        lv.domino([x, 0.5, z], yaw, i % 2 ? 0xe8e4da : 0x2a2a2e);
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
      for (let i = 0; i < 5; i++) lv.ball([-2 + i * 1.2, 0.6, 6 + (i % 2)], 0.45, 2, [0xd9682b, 0xe8e4da, 0xe0b13a, 0x3a3d42, 0xd9682b][i], MAT.bouncy);
      lv.ball([2, 0.3, -4], 0.26, 9, 0x23252b);
      lv.ball([2.8, 0.3, -4.4], 0.26, 9, 0x5a5650);

      // barrels cluster
      for (const [x, z] of [[-2, -18], [-1.1, -18.6], [-2.5, -19.3], [-1.6, -19.8]]) lv.barrel([x, 0.5, z]);

      // big ramp to fly off
      lv.staticBox([5, 0.4, 14], [-26, 2.0, 2], { rot: [0.3, 0, 0], color: 0xd9682b });
      toeWedge(-26, 5, 8.69, 0.125, -1, 0xd9682b);
      lv.staticBox([5, 6, 4], [-26, 3, -6.5], { color: 0x6f6c66 });
      for (let i = 0; i < 6; i++) lv.staticBox([5, 0.6 * (i + 1), 0.7], [-26, 0.3 * (i + 1), -9.0 - i * 0.7 + 0.0 * i], { color: 0x99958c });
    },
  },

  // ======================================================================
  {
    id: 'escalera',
    name: 'Escalera',
    code: 'P-02',
    desc: '40 escalones y 18 metros de desnivel. Si baja corriendo, tropieza.',
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
    name: 'Picadora',
    code: 'P-03',
    desc: '92 metros de pista sobre el vacío con barredoras, martillos y pistones. Cronometrada.',
    env: { skyTop: '#2f343c', skyBottom: '#b98a63', fog: 0x86705f, fogNear: 40, fogFar: 140, sun: [20, 40, -30] },
    spawn: { pos: [0, 0, 2], yaw: 0 },
    killY: -18,
    timed: true,
    mode: { kind: 'timed' },
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
      lv.flag([-3.6, 0, 90], 0xe8e4da);

      // checkpoints
      for (const z of [30, 55, 68]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 8, 24), lv.stdMat(0xe8e4da, { emissive: 0xe8e4da, emissiveIntensity: 0.6 }));
        ring.position.set(0, 2.6, z);
        lv.decoMesh(ring);
        lv.trigger([0, 1, z], [4, 2, 0.6], (who) => {
          if (!who.isPlayer || L.checkpoint?.[2] >= z) return;
          L.checkpoint = [0, 0, z];
          ring.material = lv.stdMat(0xe0b13a, { emissive: 0xe0b13a, emissiveIntensity: 1.2 });
          fx.banner('PUNTO DE CONTROL');
          sfx.blip(880);
        }, { cooldown: 2 });
      }
      lv.trigger([0, 1, 90], [4, 2, 1.4], (who) => {
        if (!who.isPlayer || L.finished) return;
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
    name: 'Tejados',
    code: 'P-04',
    desc: 'Cuatro azoteas, la más alta a 30 metros. Una bola de demolición y coches aparcados abajo.',
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
      lv.launchPad([3.2, hA, -3], [9.4, 7.5, 0], 0xd9682b);
      lv.staticBox([2, 1.2, 1.5], [-3, hA + 0.6, -3], { color: 0xb8bcc4 });
      lv.staticBox([1.5, 1.6, 1.5], [-3, hA + 0.8, 1], { color: 0xb8bcc4 });
      lv.crate([2.5, hA + 0.4, -1]); lv.crate([2.5, hA + 1.2, -1]);
      lv.barrel([-3.5, hA + 0.5, 3.8]);

      // B roof: crate fort, barrels
      cratePyramid(0, 25, 4, 0.8, hB);
      for (const x of [-3.5, 3.5]) lv.barrel([x, hB + 0.5, 19.5]);
      lv.launchPad([-3, hB, 25], [8, 9, 0], 0xd9682b);

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
      const carColors = [0x8a2a22, 0x3a4a5c, 0xb8b4aa, 0x2a2a2e, 0xe8e4da];
      for (let i = 0; i < 6; i++) car([8.5, 0.75, -14 + i * 7.5], carColors[i % carColors.length], i % 2 ? 0 : PI);
      lv.trampoline([6.5, 0, 6], [3.4, 3.4]);
      cratePyramid(-8, -12, 4);
      for (const [x, z] of [[-8, 34], [-7, 35], [-8.6, 35.6]]) lv.barrel([x, 0.5, z]);
      crateWall(15, 34, 6, 3, 0.8, PI / 2);
    },
  },
  // ======================================================================
  {
    id: 'dohyo',
    name: 'Dohyō',
    code: 'P-05',
    desc: 'Sumo uno contra uno, a lo Sumotori Dreams. Sácalo del círculo o tíralo al suelo. Gana el primero en llegar a 3.',
    env: { skyTop: '#9fb3c4', skyBottom: '#e9e2d3', fog: 0xe9e2d3, fogNear: 40, fogFar: 140, sun: [20, 45, 25] },
    spawn: { pos: [0, 0.6, -1.7], yaw: 0 },
    killY: -30,
    mode: { kind: 'sumo', ring: { x: 0, z: 0, r: 4.55, top: 0.6 }, style: 'block', playerColor: 0xd8402a, rivals: [{ color: 0x2f5d8a, pos: [0, 0.6, 1.7], yaw: PI }], winScore: 3 },
    build() {
      lv.floor([160, 1, 160], [0, -0.5, 0], gridTexture('#c9b48a', '#b9a47a'), 0xffffff);
      lv.staticCylinder(5.3, 5.9, 0.6, [0, 0.3, 0], 0xb59a6a);
      // straw bales on the ring line
      const straw = new THREE.Mesh(new THREE.TorusGeometry(4.55, 0.09, 8, 64), lv.stdMat(0xd8c48a, { roughness: 1 }));
      straw.rotation.x = -PI / 2; straw.position.y = 0.62;
      lv.decoMesh(straw);
      for (const z of [-0.9, 0.9]) lv.decoMesh(at(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.02, 0.06), lv.stdMat(0xf2f2f2)), 0, 0.61, z));
      // hanging roof (decor only)
      const wood = lv.stdMat(0x4a3424, { roughness: 0.9 });
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 8.5, 2.2, 4, 1), wood);
      roof.position.y = 9.5; roof.rotation.y = PI / 4;
      lv.decoMesh(roof);
      lv.decoMesh(at(new THREE.Mesh(new THREE.BoxGeometry(11.6, 0.5, 11.6), lv.stdMat(0x5a1f2a, { roughness: 0.8 })), 0, 8.2, 0));
      for (const [x, z, c] of [[5.8, 5.8, 0x2a5a3a], [-5.8, 5.8, 0xe8e4da], [-5.8, -5.8, 0x8a2a22], [5.8, -5.8, 0x111111]]) {
        lv.decoMesh(at(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.05, 1.4, 8), lv.stdMat(c)), x, 7.3, z));
      }
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * PI * 2;
        lv.staticBox([0.8, 0.12, 0.8], [Math.cos(a) * 9.5, 0.06, Math.sin(a) * 9.5], { color: i % 2 ? 0x5a1f2a : 0x2f5d8a, rot: [0, -a, 0] });
      }
    },
  },

  // ======================================================================
  {
    id: 'plataforma',
    name: 'Plataforma',
    code: 'P-06',
    desc: 'Cuatro luchadores de bloques sobre una losa en el agua. El último que quede arriba gana la ronda.',
    env: { skyTop: '#6f8fae', skyBottom: '#cfd8de', fog: 0xcfd8de, fogNear: 40, fogFar: 150, sun: [-20, 40, 15] },
    spawn: { pos: [-2.8, 0, -2.8], yaw: PI / 4 },
    killY: -20,
    mode: {
      kind: 'sumo4', bounds: { half: 5, top: 0 }, style: 'block', playerColor: 0xd8402a,
      rivals: [
        { color: 0x2f5d8a, pos: [2.8, 0, 2.8], yaw: -PI * 0.75 },
        { color: 0x3c6b3a, pos: [2.8, 0, -2.8], yaw: -PI / 4 },
        { color: 0xd9a92b, pos: [-2.8, 0, 2.8], yaw: PI * 0.75 },
      ],
      winScore: 3,
    },
    build() {
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x2b4d6a, roughness: 0.15, metalness: 0.4 }));
      sea.rotation.x = -PI / 2; sea.position.y = -6;
      lv.decoMesh(sea);
      lv.staticBox([10, 2, 10], [0, -1, 0], { mat: new THREE.MeshStandardMaterial({ map: gridTexture('#b8b4aa', '#a29e94', [3, 3]), roughness: 0.9 }) });
      const edge = new THREE.MeshStandardMaterial({ map: hazardTexture([12, 1]), roughness: 0.7 });
      for (const [x, z, w, d] of [[0, 5.05, 10.2, 0.1], [0, -5.05, 10.2, 0.1], [5.05, 0, 0.1, 10.2], [-5.05, 0, 0.1, 10.2]]) {
        lv.decoMesh(at(new THREE.Mesh(new THREE.BoxGeometry(w, 2.02, d), edge), x, -1, z));
      }
      lv.staticBox([3, 6, 3], [0, -5, 0], { color: 0x5e5a54 });
    },
  },

  // ======================================================================
  {
    id: 'muro',
    name: 'Muro',
    code: 'P-07',
    desc: 'Pista de choque a lo Turbo Dismount. Elige vehículo, baja la rampa y estréllate contra el muro. Hay minas a medio camino.',
    env: { skyTop: '#7f9cb8', skyBottom: '#e3e1da', fog: 0xe3e1da, fogNear: 80, fogFar: 260, sun: [30, 60, -20] },
    spawn: { pos: [0, 8, -36], yaw: 0 },
    killY: -30,
    mode: { kind: 'crash' },
    build() {
      lv.floor([200, 1, 320], [0, -0.5, 60], gridTexture('#55585e', '#4a4d52'), 0xffffff);
      lv.staticBox([8, 8, 10], [0, 4, -36], { color: 0x6f6c66 });
      curvedRamp(0, 8, -31, 8, 5);
      for (let z = 0; z < 125; z += 6) lv.decoMesh(at(new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.02, 3), lv.stdMat(0xf2f2f2)), 0, 0.01, z));
      for (let z = 4; z < 118; z += 4.2) {
        for (const x of [-7.5, 7.5]) lv.staticBox([0.6, 0.9, 4], [x, 0.45, z], { color: 0xb8b4aa });
      }
      kicker(-3.2, 4, 53, 6, 1.4);
      for (let i = 0; i < 8; i++) lv.box([0.35, 0.6, 0.35], [3.5 - (i % 2) * 1.2, 0.3, 40 + i * 3], 2, 0xd9682b);
      lv.staticBox([14, 5, 2], [0, 2.5, 126], { color: 0x8f8c86 });
      lv.decoMesh(at(new THREE.Mesh(new THREE.BoxGeometry(14.02, 0.6, 2.02), new THREE.MeshStandardMaterial({ map: hazardTexture([10, 1]) })), 0, 4.4, 126));
      crateWall(0, 120, 9, 4, 0.8);
      for (const x of [-4, 4]) lv.barrel([x, 0.5, 117]);
      cratePyramid(-5, 100, 3);
    },
    mines: [[1.5, 84], [-1.5, 86], [2.5, 89], [-2.8, 91], [0, 93], [3.2, 95], [-1, 97]],
  },

  // ======================================================================
  {
    id: 'cruce',
    name: 'Cruce',
    code: 'P-08',
    desc: 'Un cruce con tráfico que no frena. Calcula cuándo bajar la rampa. O no.',
    env: { skyTop: '#86a3bf', skyBottom: '#ece5d6', fog: 0xece5d6, fogNear: 80, fogFar: 260, sun: [-30, 55, 20] },
    spawn: { pos: [0, 8, -36], yaw: 0 },
    killY: -30,
    mode: { kind: 'crash' },
    build() {
      lv.floor([260, 1, 320], [0, -0.5, 60], gridTexture('#6a6c66', '#5d5f59'), 0xffffff);
      const asphalt = lv.stdMat(0x3f4246, { roughness: 0.95 });
      lv.staticBox([12, 0.04, 180], [0, 0.02, 50], { mat: asphalt, castShadow: false });
      lv.staticBox([220, 0.04, 14], [0, 0.03, 70], { mat: asphalt, castShadow: false });
      for (let z = 0; z < 140; z += 6) if (Math.abs(z - 70) > 8) lv.decoMesh(at(new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.02, 3), lv.stdMat(0xf2f2f2)), 0, 0.05, z));
      for (let x = -100; x < 100; x += 6) if (Math.abs(x) > 8) lv.decoMesh(at(new THREE.Mesh(new THREE.BoxGeometry(3, 0.02, 0.25), lv.stdMat(0xe0b13a)), x, 0.06, 70));
      lv.staticBox([8, 8, 10], [0, 4, -36], { color: 0x6f6c66 });
      curvedRamp(0, 8, -31, 8, 5);
      // cross traffic that loops forever: buses, box trucks, vans and cars
      const fleet = [
        ['bus', 0xd9a92b, 11], ['sedan', 0x8a2a22], ['truck', 0x3a4a5c, 7.2], ['van', 0xe8e4da],
        ['hatch', 0x2f6f8f], ['bus', 0xb8b4aa, 10], ['sedan', 0x1f1f22], ['truck', 0x8a2a22, 6.5],
      ];
      fleet.forEach(([kind, color, len], i) => {
        const dir = i % 2 ? 1 : -1;
        const lane = dir > 0 ? 66.8 : 73.2;
        const speed = kind === 'bus' || kind === 'truck' ? 12 + (i % 3) : 15 + (i % 3) * 2;
        trafficVehicle(kind, color, len, dir, lane, speed, i * 29);
      });
      lv.staticBox([10, 0.3, 8], [16, 0.15, 84], { color: 0xb8b4aa });
      for (const [x, z] of [[13, 82], [14, 83], [13.5, 84], [18, 86], [19, 85]]) lv.barrel([x, 0.8, z]);
      lv.staticBox([0.3, 4, 0.3], [12, 2, 80], { color: 0xd8402a });
      lv.staticBox([0.3, 4, 0.3], [20, 2, 80], { color: 0xd8402a });
      lv.staticBox([9, 0.3, 7], [16, 4.1, 83], { color: 0xe8e4da });
      lv.staticBox([4, 0.1, 1.6], [-8, 2.6, 60], { color: 0x3a3d42 });
      lv.staticBox([0.1, 2.6, 1.6], [-10, 1.3, 60], { color: 0x3a3d42 });
      for (let i = 0; i < 4; i++) car([-9, 0.76, 90 + i * 6], [0x8a2a22, 0x3a4a5c, 0xb8b4aa, 0x2a2a2e][i], 0, i % 2 ? 'hatch' : 'sedan');
      lv.staticBox([30, 12, 4], [0, 6, 142], { mat: new THREE.MeshStandardMaterial({ map: buildingTexture('#8a8f96', [6, 3]), roughness: 0.85 }) });
      crateWall(0, 136, 8, 3, 0.8);
    },
  },

  // ======================================================================
  {
    id: 'dojo',
    name: 'Dojo',
    code: 'P-09',
    desc: 'Combate cuerpo a cuerpo por oleadas. Golpes, patadas, barridos y contraataques en el momento justo.',
    env: { skyTop: '#41506a', skyBottom: '#d6a77a', fog: 0xb08a6c, fogNear: 30, fogFar: 110, sun: [25, 35, -15] },
    spawn: { pos: [0, 0, -4], yaw: 0 },
    killY: -30,
    mode: { kind: 'dojo' },
    build() {
      lv.floor([120, 1, 120], [0, -0.5, 0], gridTexture('#6f6a5e', '#625d52'), 0xffffff);
      lv.staticBox([22, 0.02, 22], [0, 0.01, 0], { mat: new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: 0.75 }), castShadow: false });
      const stone = lv.stdMat(0x7a756b, { roughness: 1 });
      for (const [x, z, w, d] of [[0, 12, 24, 1], [0, -12, 24, 1], [12, 0, 1, 24], [-12, 0, 1, 24]]) lv.staticBox([w, 2.4, d], [x, 1.2, z], { mat: stone });
      const tile = lv.stdMat(0x3a3330, { roughness: 0.8 });
      for (const [x, z, w, d] of [[0, 12, 25, 2.2], [0, -12, 25, 2.2], [12, 0, 2.2, 25], [-12, 0, 2.2, 25]]) lv.decoMesh(at(new THREE.Mesh(new THREE.BoxGeometry(w, 0.25, d), tile), x, 2.55, z));
      for (const [x, z] of [[9, 9], [-9, 9], [9, -9], [-9, -9]]) {
        lv.staticBox([0.3, 1.6, 0.3], [x, 0.8, z], { color: 0x5e5a54 });
        lv.decoMesh(at(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), lv.stdMat(0xf2d6a0, { emissive: 0xf2b060, emissiveIntensity: 0.8 })), x, 1.9, z));
      }
      for (const [x, z] of [[-7, 5], [7, 5]]) lv.staticBox([0.25, 2, 0.25], [x, 1, z], { color: 0x6b4a2a });
      for (const [x, z] of [[-8, -6], [8, -6]]) lv.box([0.5, 1.2, 0.5], [x, 0.6, z], 25, 0x8a6a3a);
      for (const [x, z] of [[16, 8], [-17, -5], [15, -14], [-14, 15]]) {
        lv.staticBox([0.5, 4, 0.5], [x, 2, z], { color: 0x4a3424 });
        const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4, 1), lv.stdMat(0xd8a0b0, { roughness: 0.9 }));
        crown.position.set(x, 5, z);
        crown.castShadow = true;
        lv.decoMesh(crown);
      }
    },
  },

  // ======================================================================
  {
    id: 'minas',
    name: 'Campo minado',
    code: 'P-10',
    desc: '60 metros de campo con 70 minas enterradas. Crúzalo hasta la bandera. Cronometrado.',
    env: { skyTop: '#8a9aa8', skyBottom: '#d9d4c4', fog: 0xcfc9b6, fogNear: 50, fogFar: 160, sun: [15, 40, 30] },
    spawn: { pos: [0, 0, -34], yaw: 0 },
    killY: -30,
    timed: true,
    mode: { kind: 'timed' },
    build() {
      lv.floor([160, 1, 160], [0, -0.5, 0], gridTexture('#6f7458', '#646a4e'), 0xffffff);
      for (let z = -30; z <= 32; z += 4) {
        for (const x of [-12, 12]) {
          lv.staticBox([0.12, 1.3, 0.12], [x, 0.65, z], { color: 0x5a4632 });
          lv.decoMesh(at(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 4), lv.stdMat(0x777777, { metalness: 0.7 })), x, 1.1, z + 2));
        }
      }
      for (const x of [-3, 3]) {
        lv.staticBox([0.08, 1.4, 0.08], [x, 0.7, -31], { color: 0x5a4632 });
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshStandardMaterial({ map: mineSignTexture(), side: THREE.DoubleSide }));
        sign.position.set(x, 1.5, -31); sign.rotation.z = PI / 4;
        lv.decoMesh(sign);
      }
      lv.box([1.9, 1.3, 4.2], [-6, 0.65, 4], 900, 0x4a4f3a, [0, 0.4, 0]);
      for (const [x, z] of [[5, -12], [-4, 18], [7, 22]]) lv.barrel([x, 0.5, z]);
      lv.staticBox([8, 0.1, 4], [0, 0.05, 34], { mat: new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.6 }) });
      lv.flag([3, 0, 34]);
      lv.flag([-3, 0, 34], 0xe8e4da);
      lv.trigger([0, 1, 34], [4, 2, 2], (who) => {
        if (!who.isPlayer || L.finished) return;
        L.finished = true;
        L.onFinish?.();
      }, { cooldown: 5 });
    },
    mines: 'field',
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

function car(pos, color, yaw, kind = 'sedan') {
  // body origin sits 0.76 m above the ground (the old box car's centre)
  const g = makeCar(kind, color, { ground: -0.76 });
  const len = kind === 'hatch' ? 3.9 : 4.4;
  const b = lv.dynamicBody([
    lv.boxShape(1.8, 0.72, len - 0.1, [0, -0.12, 0]),
    lv.boxShape(1.55, 0.5, len * 0.45, [0, 0.47, -0.25]),
    lv.boxShape(1.6, 0.36, len - 0.6, [0, -0.58, 0]),
  ], pos, 1100, g, { rot: [0, yaw, 0], material: MAT.vehicle });
  L.props.push(b);
  return b;
}

/*
 * Smooth ramp from a platform edge down to the ground: the profile eases out
 * of the flat top and into the flat ground (no lip, no kink), so wheels roll
 * over it instead of bouncing. Physics: overlapping thin slabs along the
 * curve; visuals: one extruded profile.
 */
function curvedRamp(x, width, zTop, yTop, zEnd) {
  const N = 44, span = zEnd - zTop;
  const yAt = (z) => { const u = Math.min(1, Math.max(0, (z - zTop) / span)); return yTop * (1 - u * u * (3 - 2 * u)); };
  for (let i = 0; i < N; i++) {
    const za = zTop + (span * i) / N, zb = zTop + (span * (i + 1)) / N;
    const ya = yAt(za), yb = yAt(zb);
    const len = Math.hypot(zb - za, yb - ya) + 0.12;
    const ang = Math.atan2(ya - yb, zb - za);
    const t = 0.5;
    lv.staticBox([width, t, len], [x, (ya + yb) / 2 - Math.cos(ang) * t / 2, (za + zb) / 2 - Math.sin(ang) * t / 2], { rot: [ang, 0, 0], visible: false });
  }
  const shape = new THREE.Shape();
  shape.moveTo(zTop - 0.01, 0);
  shape.lineTo(zTop - 0.01, yTop);
  for (let i = 1; i <= 80; i++) { const z = zTop + (span * i) / 80; shape.lineTo(z, yAt(z)); }
  shape.lineTo(zEnd, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 1 });
  geo.translate(0, 0, -width / 2);
  geo.rotateY(-PI / 2);
  const tex = gridTexture('#93908a', '#86837d');
  tex.repeat.set(width / 2, span / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.9 }));
  m.position.x = x;
  m.castShadow = true; m.receiveShadow = true;
  lv.decoMesh(m);
}

/**
 * The low end of a tilted slab stands a few cm proud of the floor: a lip that
 * catches running feet. A thin wedge from the floor up to that edge smooths it.
 * dir: +1 if the ramp climbs toward +z, -1 toward -z.
 */
function toeWedge(x, width, zLip, yLip, dir, color) {
  const L = 1.1;
  const ang = Math.atan2(yLip, L) * dir;
  const t = 0.08;
  lv.staticBox([width, t, L + 0.1], [x, yLip / 2 - t / 2, zLip - dir * L / 2], { rot: [-ang, 0, 0], color });
}

/** A launch kicker with a curved face: zero height at its toe, steepest at the lip. */
function kicker(x, width, zStart, len, h) {
  const N = 16;
  const yAt = (z) => { const u = (z - zStart) / len; return h * u * u; };
  for (let i = 0; i < N; i++) {
    const za = zStart + (len * i) / N, zb = zStart + (len * (i + 1)) / N;
    const ya = yAt(za), yb = yAt(zb);
    const seg = Math.hypot(zb - za, yb - ya) + 0.06;
    const ang = Math.atan2(ya - yb, zb - za);
    const t = 0.3;
    lv.staticBox([width, t, seg], [x, (ya + yb) / 2 - Math.cos(ang) * t / 2, (za + zb) / 2 - Math.sin(ang) * t / 2], { rot: [ang, 0, 0], visible: false });
  }
  const shape = new THREE.Shape();
  shape.moveTo(zStart, 0);
  for (let i = 1; i <= 40; i++) { const z = zStart + (len * i) / 40; shape.lineTo(z, yAt(z)); }
  shape.lineTo(zStart + len, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geo.translate(0, 0, -width / 2);
  geo.rotateY(-PI / 2);
  const m = new THREE.Mesh(geo, lv.stdMat(0xe0b13a));
  m.position.x = x;
  m.castShadow = true; m.receiveShadow = true;
  lv.decoMesh(m);
}

/** One looping vehicle of the cross traffic; wheels turn with the distance driven. */
function trafficVehicle(kind, color, len, dir, lane, speed, offset) {
  let g, shapes;
  if (kind === 'bus') {
    g = makeBus(color, len);
    shapes = [lv.boxShape(2.5, 2.8, len, [0, 1.75, 0])];
  } else if (kind === 'truck') {
    g = makeTruck(color, len);
    shapes = [lv.boxShape(2.35, 2.7, len - 2.1, [0, 2.15, -1.05]), lv.boxShape(2.3, 2.3, 2.0, [0, 1.6, len / 2 - 1.0]), lv.boxShape(2.0, 0.6, len, [0, 0.7, 0])];
  } else {
    g = makeCar(kind, color);
    const l = kind === 'van' ? 4.9 : kind === 'hatch' ? 3.9 : 4.4, h = kind === 'van' ? 2.0 : 1.4;
    shapes = [lv.boxShape(1.85, h - 0.3, l, [0, (h + 0.3) / 2, 0])];
  }
  const wheels = g.userData.wheels || [];
  const r = g.userData.wheelR || 0.35;
  const span = 220;
  const yaw = dir > 0 ? PI / 2 : -PI / 2;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  lv.kinematic(shapes, g, (t) => {
    const d = offset + t * speed;
    const x = (d % span) - span / 2;
    for (const w of wheels) w.rotation.x = d / r;
    return { pos: [x * dir, 0, lane], quat: q };
  });
}

function plankTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  for (let i = 0; i < 8; i++) {
    g.fillStyle = ['#9c7a52', '#a8845a', '#94724c', '#a07d55'][i % 4];
    g.fillRect(0, i * 32, 256, 32);
    g.fillStyle = 'rgba(40,25,10,.45)'; g.fillRect(0, i * 32 + 31, 256, 1);
    g.fillRect(((i * 97) % 200) + 20, i * 32, 1, 32);
  }
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(60,40,20,${Math.random() * 0.08})`; g.fillRect(Math.random() * 256, Math.random() * 256, 30, 1); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 5);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function mineSignTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#d8402a'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#f4f1ea'; g.fillRect(8, 8, 112, 112);
  g.fillStyle = '#111'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.save(); g.translate(64, 64); g.rotate(-Math.PI / 4); g.fillText('MINAS', 0, 0); g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
