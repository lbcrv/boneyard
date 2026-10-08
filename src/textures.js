import * as THREE from 'three';

const cache = new Map();

function canvasTex(key, w, h, draw, { repeat = [1, 1], srgb = true } = {}) {
  const ck = key + repeat.join(',');
  if (cache.has(ck)) return cache.get(ck);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  cache.set(ck, t);
  return t;
}

function noise(g, w, h, amount, alpha = 0.06) {
  for (let i = 0; i < amount; i++) {
    const v = Math.random() > 0.5 ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${Math.random() * alpha})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
}

export function gridTexture(base = '#8a8f98', line = '#6f747d', repeat = [20, 20]) {
  return canvasTex('grid' + base + line, 256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    noise(g, w, h, 900, 0.05);
    g.strokeStyle = line; g.lineWidth = 4;
    g.strokeRect(0, 0, w, h);
    g.lineWidth = 1.5; g.globalAlpha = 0.6;
    g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    g.globalAlpha = 1;
  }, { repeat });
}

export function crateTexture() {
  return canvasTex('crate', 256, 256, (g, w, h) => {
    g.fillStyle = '#b07a3e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) {
      g.fillStyle = i % 2 ? '#a26f37' : '#b9854a';
      g.fillRect(0, (i * h) / 6, w, h / 6 - 3);
      g.fillStyle = 'rgba(60,35,10,.5)'; g.fillRect(0, ((i + 1) * h) / 6 - 3, w, 3);
    }
    noise(g, w, h, 500, 0.08);
    g.strokeStyle = '#6b4520'; g.lineWidth = 26;
    g.strokeRect(13, 13, w - 26, h - 26);
    g.lineWidth = 22;
    g.beginPath(); g.moveTo(20, 20); g.lineTo(w - 20, h - 20); g.stroke();
    g.fillStyle = '#c9c2b2';
    for (const [x, y] of [[13, 13], [w - 13, 13], [13, h - 13], [w - 13, h - 13]]) {
      g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
    }
  });
}

export function barrelTexture() {
  return canvasTex('barrel', 256, 128, (g, w, h) => {
    g.fillStyle = '#d6311f'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.fillRect(0, 14, w, 6); g.fillRect(0, h - 20, w, 6);
    noise(g, w, h, 300, 0.1);
    // hazard diamond
    for (const cx of [w * 0.25, w * 0.75]) {
      g.save(); g.translate(cx, h / 2); g.rotate(Math.PI / 4);
      g.fillStyle = '#ffd21f'; g.fillRect(-22, -22, 44, 44);
      g.strokeStyle = '#111'; g.lineWidth = 4; g.strokeRect(-22, -22, 44, 44);
      g.restore();
      g.fillStyle = '#111'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('!', cx, h / 2 + 2);
    }
  });
}

export function hazardTexture(repeat = [4, 1]) {
  return canvasTex('hazard', 128, 128, (g, w, h) => {
    g.fillStyle = '#f2c12e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1d1d1d';
    for (let i = -2; i < 4; i++) {
      g.beginPath();
      g.moveTo(i * 64, 0); g.lineTo(i * 64 + 32, 0); g.lineTo(i * 64 + 32 + 128, h); g.lineTo(i * 64 + 128, h);
      g.closePath(); g.fill();
    }
    noise(g, w, h, 200, 0.08);
  }, { repeat });
}

export function buildingTexture(base = '#7d8592', repeat = [3, 8]) {
  return canvasTex('bld' + base, 256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    noise(g, w, h, 600, 0.06);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const lit = Math.random() < 0.25;
        g.fillStyle = lit ? '#ffe7a8' : '#2c3c52';
        g.fillRect(x * 64 + 12, y * 64 + 14, 40, 38);
        g.fillStyle = 'rgba(255,255,255,.12)';
        g.fillRect(x * 64 + 12, y * 64 + 14, 40, 6);
      }
    }
  }, { repeat });
}

export function headTexture() {
  return canvasTex('head', 256, 128, (g, w, h) => {
    g.fillStyle = '#f2c14e'; g.fillRect(0, 0, w, h);
    // crash test dummy quadrant markers on the sides
    for (const cx of [w * 0.25, w * 0.75]) {
      const cy = h * 0.5, r = 26;
      g.fillStyle = '#fff'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#111';
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, r, 0, Math.PI / 2); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, r, Math.PI, Math.PI * 1.5); g.closePath(); g.fill();
      g.strokeStyle = '#111'; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    }
    // a seam line over the top
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, h * 0.5 - 1, w, 2);
  });
}

export function torsoTexture() {
  return canvasTex('torso', 128, 128, (g, w, h) => {
    g.fillStyle = '#f2c14e'; g.fillRect(0, 0, w, h);
    noise(g, w, h, 150, 0.05);
    g.fillStyle = '#1d1d1d';
    g.fillRect(0, h * 0.42, w, 10);
  });
}

export function skyTexture(top, bottom) {
  return canvasTex('sky' + top + bottom, 4, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, top); gr.addColorStop(0.55, bottom); gr.addColorStop(1, bottom);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}
