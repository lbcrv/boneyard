/*
 * Tool wheel, GTA V style: hold Tab, the world slows down, point the mouse at
 * a slice, let go of Tab to take it (or click it). One slice per tool, the
 * slices of a category share a coloured rim, the centre names the pick.
 */

const R_OUT = 236, R_IN = 92, GAP = 0.018;

function sector(a0, a1, r0, r1) {
  const p = (r, a) => `${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(r1, a0)} A${r1} ${r1} 0 ${large} 1 ${p(r1, a1)} L${p(r0, a1)} A${r0} ${r0} 0 ${large} 0 ${p(r0, a0)} Z`;
}

export function createWheel({ tools, icons, groups, current, onPick }) {
  const root = document.getElementById('wheel');
  const n = tools.length;
  const step = (Math.PI * 2) / n;
  // slice i is centred at the top for i = 0 and goes clockwise
  const mid = (i) => -Math.PI / 2 + i * step;
  let svg = `<svg class="wh-ring" viewBox="-260 -260 520 520" aria-hidden="true">`;
  svg += `<circle r="${R_OUT + 14}" class="wh-back" />`;
  tools.forEach((t, i) => {
    const a0 = mid(i) - step / 2 + GAP, a1 = mid(i) + step / 2 - GAP;
    svg += `<path class="wh-slice" data-i="${i}" d="${sector(a0, a1, R_IN, R_OUT)}" />`;
    svg += `<path class="wh-rim g-${groups[t.id].key}" d="${sector(a0, a1, R_OUT - 7, R_OUT)}" />`;
  });
  svg += `</svg>`;
  let items = '';
  tools.forEach((t, i) => {
    const r = (R_IN + R_OUT) / 2;
    const x = Math.cos(mid(i)) * r, y = Math.sin(mid(i)) * r;
    items += `<div class="wh-item" data-i="${i}" style="left:calc(50% + ${x.toFixed(1)}px);top:calc(50% + ${y.toFixed(1)}px)">` +
      `<span class="wh-ico">${icons[t.id]}</span><span class="wh-num">${(i + 1) % 10}</span></div>`;
  });
  root.innerHTML = `<div class="wh-disc">${svg}${items}<div class="wh-center"><div class="wh-grp" id="wh-grp"></div><div class="wh-name" id="wh-name"></div><div class="wh-desc" id="wh-desc"></div></div></div><div class="wh-hint"><span class="k">Tab</span> suelta para equipar · <span class="k">Clic</span> elige · <span class="k">Esc</span> cancela</div>`;
  const slices = [...root.querySelectorAll('.wh-slice')];
  const its = [...root.querySelectorAll('.wh-item')];
  let hot = current();
  let open = false;

  function show(i) {
    hot = i;
    slices.forEach((s, j) => s.classList.toggle('hot', j === i));
    its.forEach((s, j) => s.classList.toggle('hot', j === i));
    const t = tools[i];
    root.querySelector('#wh-grp').textContent = groups[t.id].name;
    root.querySelector('#wh-name').textContent = t.nm;
    root.querySelector('#wh-desc').textContent = t.desc || '';
  }

  // clicking a slice picks it straight away
  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('[data-i]');
    if (!el || !open) return;
    e.preventDefault(); e.stopPropagation();
    show(Number(el.dataset.i));
    close(true);
  });

  function point(clientX, clientY) {
    if (!open) return;
    const r = root.querySelector('.wh-disc').getBoundingClientRect();
    const dx = clientX - (r.left + r.width / 2), dy = clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < 40) return; // in the middle: keep what is lit
    let a = Math.atan2(dy, dx) + Math.PI / 2 + step / 2;
    a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const i = Math.floor(a / step) % n;
    if (i !== hot) show(i);
  }

  function openWheel() {
    if (open) return;
    open = true;
    show(current());
    root.classList.add('open');
  }

  function close(commit) {
    if (!open) return;
    open = false;
    root.classList.remove('open');
    if (commit && hot !== current()) onPick(hot);
  }

  return { open: openWheel, close, point, isOpen: () => open };
}
