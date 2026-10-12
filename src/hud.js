import * as sfx from './audio.js';

/*
 * The vitals monitor in the corner of the ER: a phosphor ECG trace written
 * left to right by a sweeping head that erases just ahead of itself, like a
 * real bedside monitor. The heart rate follows what is happening to the
 * dummy: it climbs when he stumbles, runs or bleeds, slows when he is out,
 * and the trace goes flat when he dies.
 */

let cv, g, W, H;
let x = 0, prevY = 0;
let phase = 0;
let hr = 72;
let lastBeep = 0;
let flatSince = -1;
const els = {};

const SPEED = 70; // px per second of sweep

export function initVitals() {
  cv = document.getElementById('ecg');
  if (!cv) return;
  g = cv.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  W = cv.clientWidth || 300; H = cv.clientHeight || 72;
  cv.width = W * dpr; cv.height = H * dpr;
  g.scale(dpr, dpr);
  g.clearRect(0, 0, W, H);
  prevY = H * 0.62;
  for (const id of ['hr', 'blood-pct', 'consc', 'vitals', 'alarm']) els[id] = document.getElementById(id);
}

// one heartbeat, p in [0, 1): P wave, QRS spike, T wave
function pqrst(p) {
  const bump = (c, w, a) => a * Math.exp(-((p - c) * (p - c)) / (2 * w * w));
  return bump(0.16, 0.025, 0.12) - bump(0.285, 0.008, 0.16) + bump(0.31, 0.009, 1.0) - bump(0.335, 0.01, 0.32) + bump(0.56, 0.05, 0.26);
}

/**
 * s: { alive, out (unconscious), stress 0..1, blood 0..1, consc 0..100 }
 * Called once per rendered frame.
 */
export function updateVitals(dt, s, now) {
  if (!g) return;
  // heart rate drifts toward what the body is going through
  let target = s.alive ? 66 + s.stress * 70 + (1 - s.blood) * 95 : 0;
  if (s.alive && s.out) target = Math.max(38, target * 0.6);
  hr += (target - hr) * Math.min(1, dt * (s.alive ? 1.5 : 6));
  if (!s.alive && hr < 2) hr = 0;

  const prevPhase = phase;
  phase += (hr / 60) * dt;
  const beat = Math.floor(phase) !== Math.floor(prevPhase);
  if (beat && s.alive && now - lastBeep > 0.2) { lastBeep = now; if (s.sound) sfx.monitorBeep(); }
  if (!s.alive) {
    if (flatSince < 0) { flatSince = now; if (s.sound) sfx.monitorBeep(true); }
  } else flatSince = -1;

  // sweep: draw from the previous point to the new one, erase a gap ahead
  const amp = H * 0.48 * (s.alive ? Math.min(1, 0.55 + s.blood * 0.45) : 0);
  const steps = Math.max(1, Math.round(SPEED * dt));
  g.lineWidth = 1.6;
  g.lineJoin = 'round';
  const col = !s.alive ? '#ff3b2e' : s.blood < 0.55 || hr > 150 ? '#ff8a1f' : '#ffd21f';
  g.strokeStyle = col;
  g.shadowColor = col;
  g.shadowBlur = 6;
  for (let i = 0; i < steps; i++) {
    const nx = x + SPEED * dt / steps;
    const p = (phase - (hr / 60) * dt * (1 - (i + 1) / steps)) % 1;
    const noise = (Math.random() - 0.5) * (s.alive ? 1.2 : 0.6);
    const ny = H * 0.62 - (s.alive && hr > 0 ? pqrst((p + 1) % 1) * amp : 0) + noise;
    g.clearRect(nx, 0, 14, H);
    g.beginPath();
    g.moveTo(x, prevY);
    g.lineTo(nx, ny);
    g.stroke();
    x = nx; prevY = ny;
    if (x >= W) { x = 0; }
  }
  g.shadowBlur = 0;

  // readouts
  if (els.hr) els.hr.textContent = s.alive ? Math.round(hr) : '0';
  if (els['blood-pct']) els['blood-pct'].textContent = Math.round(s.blood * 100);
  if (els.consc) els.consc.textContent = Math.max(0, Math.round(s.consc));
  if (els.vitals) {
    els.vitals.classList.toggle('arrest', !s.alive);
    els.vitals.classList.toggle('warn', s.alive && (s.blood < 0.55 || hr > 150 || s.out));
  }
  if (els.alarm) {
    els.alarm.textContent = !s.alive ? 'ASISTOLIA' : s.out ? 'INCONSCIENTE' : s.blood < 0.55 ? 'HEMORRAGIA' : hr > 150 ? 'TAQUICARDIA' : 'ESTABLE';
  }
}
