// Procedural sound effects with WebAudio: no assets to download.
let ctx = null;
let master = null;
let noiseBuf = null;
let lastThud = 0;
let lastGrunt = 0;
let lastCrack = 0;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch { return; }
  master = ctx.createDynamicsCompressor();
  master.threshold.value = -14;
  master.ratio.value = 6;
  const out = ctx.createGain();
  out.gain.value = 0.8;
  master.connect(out).connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

function noise(t, dur) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.start(t, Math.random() * 1.5, dur + 0.05);
  return src;
}

function env(gainNode, t, peak, attack, decay) {
  gainNode.gain.setValueAtTime(0.0001, t);
  gainNode.gain.exponentialRampToValueAtTime(peak, t + attack);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

/** Body impact: low thump + filtered noise. v = impact speed (m/s). */
export function thud(v, soft = true) {
  if (!ctx) return;
  const now = ctx.currentTime;
  if (now - lastThud < 0.035) return;
  lastThud = now;
  const k = Math.min(1, v / 14);
  const t = now;
  const n = noise(t, 0.25);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = (soft ? 350 : 900) + k * 1400;
  const g = ctx.createGain();
  env(g, t, 0.15 + k * 0.6, 0.004, 0.12 + k * 0.18);
  n.connect(f).connect(g).connect(master);

  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(110 + Math.random() * 40, t);
  o.frequency.exponentialRampToValueAtTime(40, t + 0.18);
  const og = ctx.createGain();
  env(og, t, 0.2 + k * 0.6, 0.003, 0.18);
  o.connect(og).connect(master);
  o.start(t); o.stop(t + 0.3);
}

/** Wood/metal prop knock. */
export function knock(v, pitch = 1) {
  if (!ctx) return;
  const now = ctx.currentTime;
  if (now - lastThud < 0.03) return;
  lastThud = now;
  const k = Math.min(1, v / 12);
  const n = noise(now, 0.15);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 500 * pitch + Math.random() * 200;
  f.Q.value = 3;
  const g = ctx.createGain();
  env(g, now, 0.1 + k * 0.5, 0.002, 0.1);
  n.connect(f).connect(g).connect(master);
}

/** Bone crack: sharp clicks. */
export function crack() {
  if (!ctx) return;
  const now = ctx.currentTime;
  if (now - lastCrack < 0.08) return;
  lastCrack = now;
  for (let i = 0; i < 4; i++) {
    const t = now + i * 0.012 + Math.random() * 0.01;
    const n = noise(t, 0.04);
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1800 + Math.random() * 2500;
    const g = ctx.createGain();
    env(g, t, 0.5, 0.001, 0.03 + Math.random() * 0.03);
    n.connect(f).connect(g).connect(master);
  }
}

/** Cartoon "oof" from the dummy. */
export function grunt(intensity = 1) {
  if (!ctx) return;
  const now = ctx.currentTime;
  if (now - lastGrunt < 0.45) return;
  lastGrunt = now;
  const t = now;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  const base = 150 + Math.random() * 60;
  o.frequency.setValueAtTime(base * 1.25, t);
  o.frequency.exponentialRampToValueAtTime(base * 0.7, t + 0.28);
  const mix = ctx.createGain();
  mix.gain.value = 1;
  const g = ctx.createGain();
  env(g, t, 0.18 * Math.min(1.4, intensity), 0.02, 0.26);
  for (const [freq, q] of [[620, 6], [1050, 8], [2400, 10]]) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq * (0.9 + Math.random() * 0.2); bp.Q.value = q;
    o.connect(bp).connect(mix);
  }
  mix.connect(g).connect(master);
  o.start(t); o.stop(t + 0.35);
}

export function boom(size = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const n = noise(t, 1.6);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(2200, t);
  f.frequency.exponentialRampToValueAtTime(70, t + 1.4);
  const g = ctx.createGain();
  env(g, t, 1.0 * size, 0.005, 1.4);
  n.connect(f).connect(g).connect(master);
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(90, t);
  o.frequency.exponentialRampToValueAtTime(28, t + 0.8);
  const og = ctx.createGain();
  env(og, t, 0.9 * size, 0.005, 0.9);
  o.connect(og).connect(master);
  o.start(t); o.stop(t + 1);
}

export function shot() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const n = noise(t, 0.3);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(3000, t);
  f.frequency.exponentialRampToValueAtTime(200, t + 0.25);
  const g = ctx.createGain();
  env(g, t, 0.45, 0.002, 0.25);
  n.connect(f).connect(g).connect(master);
}

export function whoosh() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const n = noise(t, 0.6);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.Q.value = 2;
  f.frequency.setValueAtTime(300, t);
  f.frequency.exponentialRampToValueAtTime(2400, t + 0.45);
  const g = ctx.createGain();
  env(g, t, 0.35, 0.05, 0.5);
  n.connect(f).connect(g).connect(master);
}

export function blip(freq = 660) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.08);
  const g = ctx.createGain();
  env(g, t, 0.12, 0.005, 0.12);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + 0.2);
}

export function fanfare() {
  if (!ctx) return;
  const notes = [523, 659, 784, 1046];
  notes.forEach((fr, i) => {
    const t = ctx.currentTime + i * 0.11;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = fr;
    const g = ctx.createGain();
    env(g, t, 0.08, 0.01, i === notes.length - 1 ? 0.6 : 0.12);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + 0.8);
  });
}
