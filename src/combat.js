import { Ragdoll } from './ragdoll.js';

/*
 * AI for other ragdolls. It produces the same input object the keyboard does,
 * so bots play by the same physics and the same move set as the player.
 *
 * mode 'fighter': Lugaru-style. Closes in, circles, mixes punches, kicks and
 *   sweeps, ducks high attacks, and tries reversals on your wind-ups.
 * mode 'sumo': Sumotori-style. Charges and shoves, tries to stay in the ring.
 */
export class AIController {
  constructor(rag, { mode = 'fighter', skill = 0.35, ring = null } = {}) {
    this.rag = rag;
    this.mode = mode;
    this.skill = skill;
    this.ring = ring; // {x, z, r}
    this.cool = 1 + Math.random();
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.strafeT = 0;
    this.seenAct = null;
    this.duckT = 0;
    this.tauntT = 0;
    this.target = null;
    this.combo = null;
    this.comboT = 0;
    this.avoidT = 0;
    this.avoidSide = 1;
    this.stuckT = 0;
  }

  pickTarget() {
    let best = null, bd = Infinity;
    const p = this.rag.pelvis.position;
    for (const e of Ragdoll.all) {
      if (e === this.rag || e.team === this.rag.team) continue;
      if (e.state === 'fall' && (e.koT > 0 || e.hp <= 0) && this.mode === 'fighter') continue;
      if (e.out) continue;
      const dx = e.pelvis.position.x - p.x, dz = e.pelvis.position.z - p.z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  input(dt) {
    const r = this.rag;
    const inp = { moveX: 0, moveZ: 0, run: false, jump: false, punch: false, kick: false, sweep: false, crouch: false, shoveMode: this.mode === 'sumo' };
    if (r.out) return inp;
    if (r.state === 'fall') {
      // mash to get up sooner, like a player would
      if (r.restT > 0.6 && Math.random() < dt * 2) inp.jump = true;
      return inp;
    }
    if (r.state !== 'stand') return inp;

    this.cool -= dt;
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafeT = 0.8 + Math.random() * 1.5; this.strafe = -this.strafe; }

    const t = this.target = this.pickTarget();
    if (!t) {
      // nobody left: victory dance
      this.tauntT += dt;
      if (!r.emote && this.tauntT > 0.6) r.setEmote(['disco', 'robot', 'pollo'][(Math.random() * 3) | 0]);
      return inp;
    }
    this.tauntT = 0;
    const p = r.pelvis.position, q = t.pelvis.position;
    let dx = q.x - p.x, dz = q.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    inp.faceTarget = t;
    inp.target = t;

    if (this.mode === 'sumo') return this.sumo(inp, t, d, dx, dz, dt);

    // react to the opponent's attack once per attack
    if (t.act && t.act !== this.seenAct && d < 2.4) {
      this.seenAct = t.act;
      const roll = Math.random();
      if (roll < this.skill * 0.55) inp.punch = true; // reversal attempt (only works in the wind-up)
      else if (roll < this.skill && t.act.type !== 'sweep') this.duckT = 0.45;
    }
    if (this.duckT > 0) { this.duckT -= dt; inp.crouch = true; }

    const ideal = 1.0;
    if (this.avoidT > 0) {
      // sidestep whatever is blocking the way
      this.avoidT -= dt;
      inp.moveX = -dz * this.avoidSide + dx * 0.35; inp.moveZ = dx * this.avoidSide + dz * 0.35;
      inp.run = true;
    } else if (d > ideal + 0.3) {
      inp.moveX = dx; inp.moveZ = dz;
      inp.run = d > 5;
      const v = r.pelvis.velocity;
      this.stuckT = Math.hypot(v.x, v.z) < 0.35 ? (this.stuckT || 0) + dt : 0;
      if (this.stuckT > 0.5) { this.stuckT = 0; this.avoidT = 0.9; this.avoidSide = Math.random() < 0.5 ? 1 : -1; }
    } else if (d < ideal - 0.3) {
      inp.moveX = -dx * 0.6; inp.moveZ = -dz * 0.6;
    } else {
      // circle
      inp.moveX = -dz * this.strafe * 0.5; inp.moveZ = dx * this.strafe * 0.5;
    }
    // combos: the first press now, the rest timed to land in the chain window
    if (this.combo && this.combo.length) {
      this.comboT -= dt;
      if (this.comboT <= 0) {
        const k = this.combo.shift();
        if (k === 'sweep') { inp.kick = true; inp.crouch = true; } else inp[k] = true;
        this.comboT = 0.17;
      }
    } else if (d < 1.45 && this.cool <= 0 && !inp.crouch) {
      this.cool = (0.7 + Math.random() * 1.0) * (1.3 - this.skill * 0.6);
      const patterns = [['punch'], ['punch', 'punch'], ['punch', 'punch', 'punch'], ['kick'], ['punch', 'kick'], ['kick', 'kick'], ['sweep'], ['punch', 'punch', 'punch', 'punch']];
      const pick = patterns[Math.min(patterns.length - 1, (Math.random() * (4 + this.skill * 5)) | 0)];
      this.combo = pick.slice();
      this.comboT = 0;
    }
    if (d < 3 && this.cool <= 0 && Math.random() < dt * 0.4) inp.dive = true; // the odd tackle
    return inp;
  }

  sumo(inp, t, d, dx, dz, dt) {
    const r = this.rag;
    const ring = this.ring;
    let mx = dx, mz = dz;
    if (ring) {
      const p = r.pelvis.position;
      const cx = p.x - ring.x, cz = p.z - ring.z;
      const fromC = Math.hypot(cx, cz);
      // near the edge and the opponent is outward of us: get back to the middle
      if (fromC > ring.r - 1.2) {
        const out = (cx * dx + cz * dz) / (fromC || 1);
        if (out > -0.2) { mx = -cx / fromC * 0.8 + dx * 0.4; mz = -cz / fromC * 0.8 + dz * 0.4; }
      }
    }
    inp.moveX = mx; inp.moveZ = mz;
    inp.run = d > 1.2 && d < 6;
    if (d < 1.5 && this.cool <= 0) {
      this.cool = 0.7 + Math.random() * 0.8 * (1.2 - this.skill);
      inp.punch = true; // shove
    }
    return inp;
  }
}
