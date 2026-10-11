import * as THREE from 'three';
import { Vehicle, VEHICLE_TYPES, VEHICLE_ORDER } from './vehicles.js';
import * as fx from './fx.js';
import * as sfx from './audio.js';

/*
 * Map rules. Each mode gets the game API (G) from main.js and returns
 * { update(dt), status(), input(inp), onRespawn(), dispose() }.
 */

const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

export function createMode(map, G) {
  const cfg = map.mode || { kind: 'sandbox' };
  switch (cfg.kind) {
    case 'sumo': return sumo(cfg, G, false);
    case 'sumo4': return sumo(cfg, G, true);
    case 'dojo': return dojo(cfg, G);
    case 'crash': return crash(map, cfg, G);
    default: return { kind: cfg.kind, update() {}, status: () => '', input() {}, onRespawn() {}, dispose() {} };
  }
}

// ------------------------------------------------------------------ sumo (1v1 and free-for-all)
function sumo(cfg, G, ffa) {
  const rivals = cfg.rivals.map((r, i) => G.spawnFighter({
    pos: V3(r.pos), yaw: r.yaw, style: cfg.style, color: r.color, team: i + 1,
    ai: { mode: 'sumo', skill: 0.45 + i * 0.1, ring: cfg.ring || null },
  }));
  let wins = 0, losses = 0;
  let roundOver = 0;
  let matchOver = false;
  let round = 1;
  let startT = 1.8; // tachiai: nobody moves until the call

  const isOut = (r) => {
    const p = r.pelvis.position;
    if (cfg.ring) {
      const R = cfg.ring;
      const d = Math.hypot(p.x - R.x, p.z - R.z);
      // sumo rules: out of the ring, or anything but the feet touching down
      return d > R.r + 0.1 || r.state === 'fall' || p.y < R.top - 0.2;
    }
    const b = cfg.bounds;
    return p.y < b.top - 1.3 || Math.abs(p.x) > b.half + 1.5 || Math.abs(p.z) > b.half + 1.5;
  };

  function resetRound() {
    G.respawnPlayer();
    cfg.rivals.forEach((r, i) => { rivals[i].rag.reset(V3(r.pos), r.yaw); rivals[i].rag.out = false; });
    G.player.out = false;
    roundOver = 0;
    startT = 1.8;
    fx.banner(`RONDA ${round}`, ffa ? 'EL ÚLTIMO EN PIE GANA' : 'FUERA DEL CÍRCULO O AL SUELO, PIERDES');
  }
  setTimeout(() => fx.banner('RONDA 1', ffa ? 'EL ÚLTIMO EN PIE GANA' : 'FUERA DEL CÍRCULO O AL SUELO, PIERDES'), 300);

  return {
    kind: 'sumo',
    frozen: () => startT > 0,
    update(dt) {
      if (startT > 0) {
        startT -= dt;
        if (startT <= 0) { fx.banner('HAKKEYOI'); sfx.blip(880); }
        return;
      }
      if (roundOver > 0) {
        roundOver -= dt;
        if (roundOver <= 0) {
          if (matchOver) { wins = losses = 0; round = 1; matchOver = false; }
          resetRound();
        }
        return;
      }
      const all = [G.player, ...rivals.map((f) => f.rag)];
      for (const r of all) if (!r.out && isOut(r)) { r.out = true; if (ffa && r !== G.player) sfx.blip(300); }
      const playerOut = G.player.out;
      const alive = all.filter((r) => !r.out);
      let decided = false, won = false;
      if (ffa) {
        if (playerOut) { decided = true; won = false; }
        else if (alive.length === 1) { decided = true; won = true; }
      } else if (playerOut || rivals[0].rag.out) {
        decided = true;
        won = !playerOut || (playerOut && rivals[0].rag.out && G.player.pelvis.position.y > rivals[0].rag.pelvis.position.y);
      }
      if (!decided) return;
      round++;
      if (won) { wins++; G.player.setEmote('disco'); sfx.fanfare(); } else { losses++; for (const f of rivals) if (!f.rag.out) f.rag.setEmote('pollo'); }
      const target = cfg.winScore;
      if (wins >= target || losses >= target) {
        matchOver = true;
        fx.banner(wins >= target ? 'GANAS EL COMBATE' : 'PIERDES EL COMBATE', `${wins} – ${losses}`);
        roundOver = 4.5;
      } else {
        fx.banner(won ? 'GANAS LA RONDA' : 'PIERDES LA RONDA', `${wins} – ${losses}`);
        roundOver = 2.8;
      }
      if (won) G.addPoints(500, 'RONDA', G.player.chest.position, 'big');
    },
    status: () => `Ronda ${round} · ${wins} – ${losses}`,
    input(inp) { inp.shoveMode = true; },
    onRespawn() {},
    dispose() {},
  };
}

// ------------------------------------------------------------------ dojo waves (Lugaru-style)
const ENEMY_COLORS = [0x8a2a22, 0x3a4a5c, 0x4a4f3a, 0x5a4a6a, 0x2a2a2e];
const GATES = [[0, 0, 9], [8, 0, 6], [-8, 0, 6], [7, 0, -7], [-7, 0, -7]];

function dojo(cfg, G) {
  let wave = 0;
  let enemies = [];
  let between = 1.2;
  let defeat = 0;
  let kos = 0;

  function startWave() {
    wave++;
    for (const e of enemies) G.removeFighter(e);
    enemies = [];
    const n = Math.min(4, wave);
    for (let i = 0; i < n; i++) {
      const g = GATES[(i + wave) % GATES.length];
      const yaw = Math.atan2(-g[0], -g[2]);
      enemies.push(G.spawnFighter({
        pos: V3(g), yaw, style: 'dummy', color: ENEMY_COLORS[(i + wave) % ENEMY_COLORS.length], team: 1,
        ai: { mode: 'fighter', skill: Math.min(0.8, 0.2 + wave * 0.08) },
      }));
    }
    fx.banner(`OLEADA ${wave}`, n === 1 ? '1 RIVAL' : `${n} RIVALES`);
    sfx.blip(520);
  }

  return {
    kind: 'dojo',
    update(dt) {
      if (defeat > 0) {
        defeat -= dt;
        if (defeat <= 0) { wave = Math.max(0, wave - 1); G.respawnPlayer(); between = 0.5; }
        return;
      }
      if (between > 0) { between -= dt; if (between <= 0) startWave(); return; }
      const P = G.player;
      if (P.hp <= 0 || P.koT > 0 && P.hp < 10) {
        defeat = 4;
        fx.banner('DERROTA', `OLEADA ${wave}`);
        return;
      }
      let down = 0;
      for (const e of enemies) {
        const r = e.rag;
        if (!r.defeated && (r.hp <= 0 || r.koT > 1.5)) { r.defeated = true; kos++; G.addPoints(300 + wave * 50, 'K.O.', r.chest.position, 'big'); }
        if (r.defeated) down++;
      }
      if (enemies.length && down === enemies.length) {
        fx.banner(`OLEADA ${wave} SUPERADA`, `${kos} K.O. EN TOTAL`);
        P.setEmote('disco');
        between = 3.5;
      }
    },
    status: () => {
      const left = enemies.filter((e) => !e.rag.defeated).length;
      return wave ? `Oleada ${wave} · rivales en pie ${left}/${enemies.length} · K.O. ${kos}` : 'Preparando…';
    },
    input() {},
    onRespawn() { if (defeat <= 0 && wave > 0) { wave--; between = 0.5; } },
    dispose() { for (const e of enemies) G.removeFighter(e); },
  };
}

// ------------------------------------------------------------------ crash (Turbo Dismount-style)
function crash(map, cfg, G) {
  let typeIdx = 0;
  let vehicle = null;

  function spawn() {
    if (vehicle) vehicle.dispose();
    const s = map.spawn;
    vehicle = new Vehicle(VEHICLE_ORDER[typeIdx], V3(s.pos), s.yaw);
    vehicle.seat(G.player);
    G.vehicle = vehicle;
  }
  spawn();
  setTimeout(() => fx.banner(VEHICLE_TYPES[VEHICLE_ORDER[typeIdx]].name, 'ESPACIO ARRANCA · V CAMBIA DE VEHÍCULO'), 300);

  return {
    kind: 'crash',
    vehicle: () => vehicle,
    step(dt, inp) {
      if (!vehicle) return;
      vehicle.step(dt, inp);
    },
    update() {
      if (vehicle) vehicle.frame();
    },
    status: () => {
      if (!vehicle) return '';
      const v = vehicle.chassis.velocity;
      const kmh = Math.round(Math.hypot(v.x, v.z) * 3.6);
      return `${vehicle.def.name} · ${kmh} km/h${vehicle.ejected ? ' · EYECTADO' : vehicle.launched ? '' : ' · ESPACIO PARA ARRANCAR'}`;
    },
    input(inp, keys) {
      const seated = vehicle && !vehicle.ejected;
      inp.steer = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
      inp.launch = inp.jump && seated;
      if (seated) { inp.moveX = 0; inp.moveZ = 0; inp.jump = false; }
    },
    cycleVehicle() {
      if (vehicle && vehicle.launched && !vehicle.ejected) return;
      typeIdx = (typeIdx + 1) % VEHICLE_ORDER.length;
      spawn();
      fx.banner(VEHICLE_TYPES[VEHICLE_ORDER[typeIdx]].name, 'ESPACIO ARRANCA');
    },
    onRespawn() { spawn(); },
    dispose() { if (vehicle) vehicle.dispose(); vehicle = null; G.vehicle = null; },
  };
}
