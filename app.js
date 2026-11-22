'use strict';
/* Stösse zweier Wagen: Auswertung und Darstellung.
   Daten: data/messungen.csv (eine Zeile pro Messung) und data/rohdaten/Messung_<nr>.csv (t_s, x1_m, x2_m).
   Wagen 1 = stossender Wagen (Sensor 1), Wagen 2 = gestossener Wagen (Sensor 2). */

// ===================== Hilfen =====================
const $ = id => document.getElementById(id);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const ok = x => Number.isFinite(x);
const fmt = (x, d = 3) => ok(x) ? (Math.round(x * 10 ** d) / 10 ** d).toFixed(d).replace('-', '−').replace('.', ',') : '–';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DT = 0.005;           // 200 Hz
const X2_MIN = 0.199;       // Sensor 2 misst darunter nichts Sinnvolles
const SMOOTH = 31;          // Fensterbreite für Ableitungen (31 Punkte = 0,15 s)

document.querySelectorAll('[data-tex]').forEach(el => {
  try { katex.render(el.dataset.tex, el, { displayMode: true, throwOnError: false }); } catch (_) { el.textContent = el.dataset.tex; }
});

const TYPES = [
  { key: 'elastisch', label: 'Elastisch', puffer: 'Feder', color: '--c-el', shape: 'circle' },
  { key: 'teilelastisch', label: 'Teilelastisch', puffer: 'Schaumstoff', color: '--c-in', shape: 'triangle' },
  { key: 'inelastisch', label: 'Inelastisch', puffer: 'Klett', color: '--c-vi', shape: 'rectRot' },
];
const typeOf = s => {
  s = (s || '').toLowerCase().trim();
  if (s.startsWith('teil')) return TYPES[1];
  if (s.includes('inel')) return TYPES[2];
  return TYPES[0];
};
const AUFBAU = ['leicht→schwer', 'schwer→leicht', 'gleich (einer ruht)', 'gleich (gegeneinander)'];
const AUFBAU_TEXT = {
  'leicht→schwer': 'leichter Wagen stösst ruhenden schweren',
  'schwer→leicht': 'schwerer Wagen stösst ruhenden leichten',
  'gleich (einer ruht)': 'gleich schwere Wagen, einer ruht',
  'gleich (gegeneinander)': 'gleich schwere Wagen fahren aufeinander zu',
};
const EXPECTED_RATIO = { 'leicht→schwer': 2, 'schwer→leicht': 0.5, 'gleich (einer ruht)': 1, 'gleich (gegeneinander)': 1 };

// ===================== CSV =====================
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}
const num = s => { s = (s ?? '').trim(); return s === '' ? NaN : parseFloat(s); };

function parseRuns(text) {
  const [head, ...rows] = parseCSV(text);
  const k = head.map(h => h.trim().toLowerCase());
  const g = (r, name) => r[k.indexOf(name)];
  return rows.map(r => {
    const o = {
      id: g(r, 'versuch').trim(), T: typeOf(g(r, 'typ')), aufbau: (g(r, 'aufbau') || '').trim(),
      m1: num(g(r, 'm1')), m2: num(g(r, 'm2')),
      v1: num(g(r, 'v1')), v2: num(g(r, 'v2')), u1: num(g(r, 'v1_nach')), u2: num(g(r, 'v2_nach')),
      tc: num(g(r, 't_stoss')), note: (g(r, 'bemerkung') || '').trim(),
    };
    o.e = -(o.u1 - o.u2) / (o.v1 - o.v2);
    o.ratio = -(o.u1 - o.v1) / (o.u2 - o.v2);       // m2/m1, das die Impulserhaltung verlangt
    o.hasMass = ok(o.m1) && ok(o.m2);
    if (o.hasMass) {
      o.p0 = o.m1 * o.v1 + o.m2 * o.v2; o.p1 = o.m1 * o.u1 + o.m2 * o.u2;
      o.E0 = .5 * o.m1 * o.v1 ** 2 + .5 * o.m2 * o.v2 ** 2; o.E1 = .5 * o.m1 * o.u1 ** 2 + .5 * o.m2 * o.u2 ** 2;
      o.dE = (o.E1 / o.E0 - 1) * 100;
    }
    return o;
  });
}

// ===================== Rohdaten & Ableitungen =====================
// Savitzky-Golay (quadratische Anpassung im symmetrischen Fenster)
function sg(y, w, deriv) {
  const h = (w - 1) / 2, out = new Array(y.length).fill(null);
  const ks = []; for (let k = -h; k <= h; k++) ks.push(k);
  let c;
  if (deriv === 1) { const S = ks.reduce((s, k) => s + k * k, 0); c = ks.map(k => k / S / DT); }
  else { const m = h * (h + 1) / 3, S = ks.reduce((s, k) => s + (k * k - m) ** 2, 0); c = ks.map(k => 2 * (k * k - m) / S / DT ** 2); }
  for (let i = h; i < y.length - h; i++) {
    let s = 0, bad = false;
    for (let j = 0; j < w; j++) { const v = y[i - h + j]; if (v === null) { bad = true; break; } s += c[j] * v; }
    if (!bad) out[i] = s;
  }
  return out;
}

const rawCache = {};
async function loadRaw(run) {
  if (rawCache[run.id]) return rawCache[run.id];
  const res = await fetch(`data/rohdaten/Messung_${run.id}.csv`);
  if (!res.ok) throw new Error('Rohdaten fehlen: Messung ' + run.id);
  const [, ...rows] = parseCSV(await res.text());
  const t = [], x1 = [], x2 = [];
  rows.forEach(r => { t.push(+r[0]); x1.push(+r[1]); const b = +r[2]; x2.push(b > X2_MIN ? b : null); });
  const v1 = sg(x1, SMOOTH, 1), v2 = sg(x2, SMOOTH, 1), a1 = sg(x1, SMOOTH, 2);
  const ic = Math.round(run.tc / DT);
  // Abstand der Messpunkte bei Berührung (hängt vom Puffer ab)
  let D = 0, n = 0;
  for (let i = ic - 2; i <= ic + 2; i++) if (x2[i] !== null) { D += x1[i] - x2[i]; n++; }
  D = n ? D / n : 0.45;
  // Stossfenster aus a1(t): um das Maximum, solange |a| > 10 % davon
  let ip = ic, amax = 0;
  for (let i = Math.round((run.tc - 0.2) / DT); i < Math.round((run.tc + 0.4) / DT); i++) if (a1[i] !== null && Math.abs(a1[i]) > Math.abs(amax)) { amax = a1[i]; ip = i; }
  let lo = ip, hi = ip;
  while (lo > 0 && a1[lo - 1] !== null && Math.abs(a1[lo - 1]) > 0.1 * Math.abs(amax)) lo--;
  while (hi < a1.length - 1 && a1[hi + 1] !== null && Math.abs(a1[hi + 1]) > 0.1 * Math.abs(amax)) hi++;
  let J = 0; for (let i = lo; i < hi; i++) J += (a1[i] + a1[i + 1]) / 2 * DT;   // ∫a1 dt = Δv1
  // x2 für die Animation lückenlos machen (unter 0,20 m mit letzter Geschwindigkeit weiterführen)
  const x2f = x2.slice(); let last = null, lastV = 0;
  for (let i = 0; i < x2f.length; i++) {
    if (x2[i] !== null) { last = x2[i]; lastV = v2[i] ?? lastV; continue; }
    if (last === null) continue;
    last = Math.max(0.14, last + (ok(run.u2) ? Math.min(lastV, 0) || run.u2 : lastV) * DT); x2f[i] = last;
  }
  const first = x2f.find(v => v !== null) ?? 0.28;
  for (let i = 0; i < x2f.length && x2f[i] === null; i++) x2f[i] = first;
  return rawCache[run.id] = { t, x1, x2, x2f, v1, v2, a1, D, lo: t[lo], hi: t[hi], J, amax };
}

// ===================== Fahrbahn (Canvas) =====================
const CART = 0.12;
function makeBench(canvas, getScene) {
  const ctx = canvas.getContext('2d');
  let t0 = performance.now(), W = 0, H = 0, speed = 1, raf = 0;
  function resize() { const r = canvas.getBoundingClientRect(), d = devicePixelRatio || 1; W = r.width; H = r.height; canvas.width = W * d; canvas.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0); }
  resize(); addEventListener('resize', resize);
  function draw(t) {
    const s = getScene(); if (!s) return;
    const pad = 40, sc = (W - 2 * pad) / (s.xmax - s.xmin), X = x => pad + (x - s.xmin) * sc;
    const railY = H - 46, gh = 28, wr = 4;
    ctx.clearRect(0, 0, W, H);
    const muted = css('--muted'), rail = css('--rail'), col1 = css(s.col1), col2 = css('--w2');
    // Schiene
    ctx.fillStyle = rail; ctx.fillRect(pad - 20, railY, W - 2 * pad + 40, 7);
    ctx.fillRect(pad - 10, railY + 7, 4, H - railY - 10); ctx.fillRect(W - pad + 6, railY + 7, 4, H - railY - 10);
    // Ultraschallsensoren an beiden Enden
    ctx.strokeStyle = muted; ctx.fillStyle = muted; ctx.lineWidth = 1.5;
    [[pad - 20, 1, 'Sensor 2'], [W - pad + 20, -1, 'Sensor 1']].forEach(([x, dir, lab]) => {
      ctx.fillRect(dir > 0 ? x : x - 10, railY - 26, 10, 22);
      for (let k = 1; k <= 3; k++) { ctx.beginPath(); ctx.arc(x + dir * 10, railY - 15, 5 * k, dir > 0 ? -0.6 : Math.PI - 0.6, dir > 0 ? 0.6 : Math.PI + 0.6); ctx.stroke(); }
      ctx.font = '500 13px "Barlow Condensed",sans-serif'; ctx.textAlign = dir > 0 ? 'left' : 'right'; ctx.fillText(lab, x + dir * 14, H - 4);
    });
    function cart(c, col, alpha, label, heavy) {
      const x = X(c - CART / 2), w = CART * sc, y = railY - gh - 2 * wr;
      ctx.globalAlpha = alpha;
      if (!label) { ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.roundRect(x + .7, y + .7, w - 1.4, gh - 1.4, 4); ctx.stroke(); ctx.globalAlpha = 1; return; }
      ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(x, y, w, gh, 4); ctx.fill();
      if (heavy) { ctx.beginPath(); ctx.roundRect(x + w * 0.22, y - 11, w * 0.56, 9, 2); ctx.fill(); }
      ctx.fillStyle = css('--raised'); ctx.font = '600 16px "Barlow Condensed",sans-serif'; ctx.textAlign = 'center'; ctx.fillText(label, x + w / 2, y + gh / 2 + 5);
      ctx.fillStyle = col; [x + w * 0.22, x + w * 0.78].forEach(cx => { ctx.beginPath(); ctx.arc(cx, railY - wr, wr, 0, 7); ctx.fill(); });
      ctx.globalAlpha = 1;
    }
    // Stroboskop-Spur
    let la = null, lb = null;
    for (let k = Math.floor(t / 0.1); k >= 1; k--) {
      const p = s.at(t - k * 0.1), al = Math.max(0.15, 0.6 - k * 0.025);
      if (la === null || Math.abs(p.c1 - la) > 0.012) { cart(p.c1, col1, al); la = p.c1; }
      if (lb === null || Math.abs(p.c2 - lb) > 0.012) { cart(p.c2, col2, al); lb = p.c2; }
    }
    const p = s.at(t);
    cart(p.c2, col2, 1, 'W2', s.heavy2); cart(p.c1, col1, 1, 'W1', s.heavy1);
    // Geschwindigkeitspfeile
    [[p.c1, p.v1, col1], [p.c2, p.v2, col2]].forEach(([c, v, col]) => {
      if (!ok(v) || Math.abs(v) < 0.02) return;
      const x0 = X(c), len = v * 160, y = railY + 22;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + len, y); ctx.stroke();
      const dir = Math.sign(len); ctx.beginPath(); ctx.moveTo(x0 + len + dir * 2, y); ctx.lineTo(x0 + len - dir * 7, y - 5); ctx.lineTo(x0 + len - dir * 7, y + 5); ctx.fill();
    });
  }
  function frame(now) {
    const s = getScene();
    if (s) {
      const hold = 0.8, cyc = s.dur + hold;
      const t = reduceMotion ? s.dur : Math.min(s.dur, (((now - t0) / 1000) * speed) % cyc);
      draw(t);
    }
    if (!reduceMotion) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return {
    restart() { t0 = performance.now(); if (reduceMotion) requestAnimationFrame(frame); },
    setSpeed(v) { speed = v; t0 = performance.now(); },
  };
}

function dataScene(run, raw) {
  const tA = Math.max(0, run.tc - 1.0), tB = Math.min(raw.t[raw.t.length - 1], run.tc + 1.8);
  const n = raw.t.length - 1;
  return {
    dur: tB - tA, xmin: 0.04, xmax: 0.82, col1: run.T.color,
    heavy1: run.aufbau === 'schwer→leicht', heavy2: run.aufbau === 'leicht→schwer',
    at(t) {
      const i = Math.max(0, Math.min(n, Math.round((tA + t) / DT)));
      const c1 = raw.x1[i] - raw.D + CART / 2, c2 = raw.x2f[i] - CART / 2;
      return { c1, c2, v1: raw.v1[i], v2: raw.v2[i] ?? (i > run.tc / DT ? run.u2 : run.v2) };
    },
  };
}

// ===================== Weg-Zeit-Skizzen (Theorie) =====================
function collide(m1, m2, v1, v2, e) { const P = m1 * v1 + m2 * v2, M = m1 + m2; return [(P - m2 * e * (v1 - v2)) / M, (P + m1 * e * (v1 - v2)) / M]; }
document.querySelectorAll('[data-strobe]').forEach(svg => {
  const e = +svg.dataset.strobe, [u1, u2] = collide(1, 1, 0.6, 0, e);
  const W = 300, H = 120, l = 22, b = H - 20, T = 2, tc = 0.8;
  const px = t => l + t / T * (W - l - 6), py = x => b - x / 1.4 * (b - 8);
  const pos = (i, t) => i === 0 ? (t < tc ? 0.1 + 0.6 * t : 0.58 + u1 * (t - tc)) : (t < tc ? 0.58 : 0.58 + u2 * (t - tc));
  const line = (i, c) => `<polyline points="${[0, tc, T].map(t => px(t).toFixed(1) + ',' + py(pos(i, t)).toFixed(1)).join(' ')}" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round"/>`;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `
    <line x1="${l}" y1="${b}" x2="${W}" y2="${b}" stroke="var(--muted)"/><line x1="${l}" y1="${b}" x2="${l}" y2="2" stroke="var(--muted)"/>
    <line x1="${px(tc)}" y1="${b}" x2="${px(tc)}" y2="6" stroke="var(--rule)" stroke-dasharray="3 3"/>
    <text x="${px(tc)}" y="${b + 15}" text-anchor="middle" font-family="Barlow Condensed" font-size="13" fill="var(--muted)">Stoss</text>
    <text x="${W}" y="${b + 15}" text-anchor="end" font-family="Barlow Condensed" font-size="13" fill="var(--muted)">t</text>
    <text x="${l - 8}" y="12" text-anchor="end" font-family="Barlow Condensed" font-size="13" fill="var(--muted)">x</text>
    ${line(1, 'var(--w2)')}${line(0, 'var(--c-el)')}
    <text x="${px(0.05)}" y="${py(0.1) - 8}" font-family="Barlow Condensed" font-size="13" fill="var(--ink-2)">W1</text>
    <text x="${px(0.05)}" y="${py(0.58) - 6}" font-family="Barlow Condensed" font-size="13" fill="var(--ink-2)">W2</text>`;
});

// ===================== Diagramme =====================
const shapeSVG = {
  circle: c => `<svg viewBox="0 0 16 12" aria-hidden="true"><circle cx="8" cy="6" r="5.5" fill="${c}"/></svg>`,
  triangle: c => `<svg viewBox="0 0 16 12" aria-hidden="true"><path d="M8 .5 14 11.5H2Z" fill="${c}"/></svg>`,
  rectRot: c => `<svg viewBox="0 0 16 12" aria-hidden="true"><path d="M8 0 14 6 8 12 2 6Z" fill="${c}"/></svg>`,
  line: (c, dash) => `<svg viewBox="0 0 16 12" aria-hidden="true"><line x1="0" y1="6" x2="16" y2="6" stroke="${c}" stroke-width="2.5" ${dash ? 'stroke-dasharray="4 3"' : ''}/></svg>`,
  dots: c => `<svg viewBox="0 0 16 12" aria-hidden="true"><circle cx="3" cy="6" r="1.8" fill="${c}"/><circle cx="8" cy="6" r="1.8" fill="${c}"/><circle cx="13" cy="6" r="1.8" fill="${c}"/></svg>`,
};
const legend = (id, items) => { $(id).innerHTML = items.map(([svg, label]) => `<span>${svg}${label}</span>`).join(''); };

// Markiert das Stossfenster und den Stossbeginn
const markPlugin = {
  id: 'mark',
  beforeDatasetsDraw(chart, _, o) {
    if (!o || !o.band) return;
    const { ctx, chartArea: a, scales: { x } } = chart;
    ctx.save(); ctx.fillStyle = o.fill;
    const x0 = Math.max(a.left, x.getPixelForValue(o.band[0])), x1 = Math.min(a.right, x.getPixelForValue(o.band[1]));
    ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
    ctx.fillStyle = o.text; ctx.font = '500 13px "Barlow Condensed",sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Stoss', (x0 + x1) / 2, a.top + 12);
    ctx.restore();
  },
};
Chart.register(markPlugin);

let charts = {};
function chart(id, cfg) { if (charts[id]) charts[id].destroy(); charts[id] = new Chart($(id), cfg); return charts[id]; }
function baseOpts() {
  const ink = css('--ink'), surface = css('--raised'), rule = css('--rule');
  Chart.defaults.font.family = '"Barlow Condensed",sans-serif'; Chart.defaults.font.size = 14;
  Chart.defaults.color = css('--muted'); Chart.defaults.borderColor = rule; Chart.defaults.locale = 'de-CH';
  return {
    tooltip: { backgroundColor: ink, titleColor: surface, bodyColor: surface, titleFont: { weight: '600', size: 15 }, bodyFont: { size: 14 }, padding: 10, cornerRadius: 4, displayColors: false },
    grid: { color: rule, drawTicks: false }, ticks: { padding: 8 }, anim: reduceMotion ? false : { duration: 400 },
    axisTitle: text => ({ display: true, text, color: css('--ink-2') }),
  };
}
const deNum = d => v => fmt(v, d);

// ===================== Zustand =====================
let RUNS = [], current = null, modelRun = null, heroScene = null, detailScene = null;
const heroBench = makeBench($('hero'), () => heroScene);
const detailBench = makeBench($('detailBench'), () => detailScene);

// ===================== Versuchsmatrix & Tabelle =====================
function renderMatrix() {
  $('matrix').querySelector('thead').innerHTML = `<tr><th></th>${TYPES.map(T => `<th style="text-align:left"><span class="swatch" style="background:var(${T.color});margin-right:8px"></span>${T.label}<small>${T.puffer}</small></th>`).join('')}</tr>`;
  $('matrix').querySelector('tbody').innerHTML = AUFBAU.map(a => `<tr><th scope="row">${AUFBAU_TEXT[a]}</th>${TYPES.map(T =>
    `<td>${RUNS.filter(r => r.T === T && r.aufbau === a).map(r => `<button class="run" data-run="${r.id}" aria-pressed="false">Nr. ${r.id}</button>`).join('')}</td>`).join('')}</tr>`).join('');
  $('matrix').querySelectorAll('[data-run]').forEach(b => b.addEventListener('click', () => selectRun(b.dataset.run, true)));
}

function renderTable() {
  const missing = '<span class="missing">fehlt</span>';
  $('table').querySelector('tbody').innerHTML = RUNS.map(r => `<tr data-run="${r.id}">
    <td>${r.id}</td><td><span class="swatch" style="background:var(${r.T.color})"></span>${r.T.label}</td><td>${r.aufbau}</td>
    <td>${fmt(r.v1)}</td><td>${fmt(r.v2)}</td><td>${fmt(r.u1)}</td><td>${fmt(r.u2)}</td>
    <td class="calc">${fmt(Math.max(r.e, 0), 2)}</td><td class="calc">${fmt(r.ratio, 2)}</td>
    <td>${ok(r.m1) ? fmt(r.m1) : missing}</td><td>${ok(r.m2) ? fmt(r.m2) : missing}</td>
    <td class="calc">${fmt(r.p0)}</td><td class="calc">${fmt(r.p1)}</td><td class="calc">${fmt(r.dE, 1)}</td></tr>`).join('');
  $('table').querySelectorAll('tbody tr').forEach(tr => tr.addEventListener('click', () => selectRun(tr.dataset.run, true)));
  $('massNote').style.display = RUNS.every(r => r.hasMass) ? 'none' : '';
}

function renderOverviewCharts() {
  const o = baseOpts(), surface = css('--raised'), muted = css('--muted');
  const present = TYPES.filter(T => RUNS.some(r => r.T === T));
  legend('lgTypes', present.map(T => [shapeSVG[T.shape](css(T.color)), `${T.label} (${T.puffer})`]));
  const order = [...RUNS].sort((a, b) => TYPES.indexOf(a.T) - TYPES.indexOf(b.T) || AUFBAU.indexOf(a.aufbau) - AUFBAU.indexOf(b.aufbau));
  const labels = order.map(r => 'Nr. ' + r.id);
  const title = i => { const r = order[i]; return `Messung ${r.id}, ${r.T.label.toLowerCase()}`; };

  chart('chE', { type: 'bar',
    data: { labels, datasets: [{ data: order.map(r => Math.max(r.e, 0)), backgroundColor: order.map(r => css(r.T.color)), borderRadius: { topRight: 4, bottomRight: 4 }, borderSkipped: 'start', minBarLength: 3, barPercentage: .78, categoryPercentage: .92 }] },
    options: { indexAxis: 'y', maintainAspectRatio: false, animation: o.anim,
      plugins: { legend: { display: false }, tooltip: { ...o.tooltip, callbacks: { title: i => title(i[0].dataIndex), label: i => [`e = ${fmt(order[i.dataIndex].e, 2)}`, AUFBAU_TEXT[order[i.dataIndex].aufbau]] } } },
      scales: { x: { min: 0, max: 1.05, grid: o.grid, ticks: { ...o.ticks, stepSize: .25, callback: deNum(2) }, border: { display: false } }, y: { grid: { display: false }, ticks: { color: css('--ink-2'), autoSkip: false, font: { size: 13 } }, border: { color: css('--rule') } } } } });

  chart('chM', { type: 'line',
    data: { labels, datasets: [
      ...[2, 1, 0.5].map(v => ({ data: labels.map(() => v), borderColor: muted, borderDash: [5, 5], borderWidth: 1, pointRadius: 0, pointHitRadius: 0, order: 3 })),
      ...present.map(T => ({ label: T.label, data: order.map(r => r.T === T ? r.ratio : null), showLine: false, pointStyle: T.shape, backgroundColor: css(T.color), borderColor: surface, borderWidth: 2, pointRadius: 8, pointHoverRadius: 10, pointHitRadius: 12 })),
    ] },
    options: { maintainAspectRatio: false, animation: o.anim,
      plugins: { legend: { display: false }, tooltip: { ...o.tooltip, filter: i => i.datasetIndex > 2 && i.raw !== null, callbacks: { title: i => title(i[0].dataIndex), label: i => [`m₂/m₁ = ${fmt(i.raw, 2)}`, `erwartet ${fmt(EXPECTED_RATIO[order[i.dataIndex].aufbau], 1)} (${order[i.dataIndex].aufbau})`] } } },
      scales: { x: { grid: { display: false }, ticks: { ...o.ticks, autoSkip: false, maxRotation: 0, font: { size: 12 } }, border: { color: css('--rule') } },
        y: { type: 'logarithmic', min: 0.25, max: 4, grid: o.grid, border: { display: false }, title: o.axisTitle('m₂ / m₁'),
          afterBuildTicks: ax => { ax.ticks = [0.25, 0.5, 1, 2, 4].map(v => ({ value: v })); }, ticks: { ...o.ticks, callback: v => ({ 0.25: '¼', 0.5: '½', 1: '1', 2: '2', 4: '4' })[v] ?? '' } } } } });

  const withMass = RUNS.filter(r => r.hasMass);
  $('chP').parentElement.style.display = withMass.length ? '' : 'none';
  $('pSub').textContent = withMass.length ? 'Gestrichelt: perfekte Impulserhaltung p′ = p' : 'Erscheint, sobald die Massen in data/messungen.csv eingetragen sind.';
  if (withMass.length) {
    const lim = Math.max(...withMass.flatMap(r => [Math.abs(r.p0), Math.abs(r.p1)])) * 1.15;
    chart('chP', { type: 'scatter',
      data: { datasets: [
        { data: [{ x: -lim, y: -lim }, { x: lim, y: lim }], type: 'line', borderColor: muted, borderDash: [5, 5], borderWidth: 1, pointRadius: 0, pointHitRadius: 0 },
        ...present.map(T => ({ data: withMass.filter(r => r.T === T).map(r => ({ x: r.p0, y: r.p1, r })), pointStyle: T.shape, backgroundColor: css(T.color), borderColor: surface, borderWidth: 2, pointRadius: 8, pointHoverRadius: 10 })),
      ] },
      options: { maintainAspectRatio: false, animation: o.anim,
        plugins: { legend: { display: false }, tooltip: { ...o.tooltip, filter: i => !!i.raw.r, callbacks: { title: i => `Messung ${i[0].raw.r.id}`, label: i => [`p = ${fmt(i.raw.x)} kg·m/s`, `p′ = ${fmt(i.raw.y)} kg·m/s`] } } },
        scales: { x: { min: -lim, max: lim, grid: o.grid, ticks: { ...o.ticks, callback: deNum(2) }, title: o.axisTitle('p vorher in kg·m/s') }, y: { min: -lim, max: lim, grid: o.grid, ticks: { ...o.ticks, callback: deNum(2) }, title: o.axisTitle('p nachher in kg·m/s') } } } });
  }
}

// ===================== Messung im Detail =====================
async function selectRun(id, scroll) {
  const run = RUNS.find(r => r.id === id); if (!run) return;
  current = run;
  document.querySelectorAll('.run').forEach(b => b.setAttribute('aria-pressed', b.dataset.run === id));
  if (scroll) $('detail').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  $('dTitle').textContent = `Messung ${run.id}`;
  $('dSub').textContent = `${run.T.label} mit ${run.T.puffer}, ${AUFBAU_TEXT[run.aufbau] || run.aufbau}${run.note && run.id.includes('.') ? ', ' + run.note.toLowerCase() : ''}`;
  let raw;
  try { raw = await loadRaw(run); } catch (err) { $('dFigures').innerHTML = `<div class="fig"><div>${err.message}</div></div>`; return; }
  if (current !== run) return;
  detailScene = dataScene(run, raw); detailBench.restart();
  renderDetail(run, raw);
}

function renderDetail(run, raw) {
  const o = baseOpts(), c1 = css(run.T.color), c2 = css('--w2');
  const dv = run.u1 - run.v1, dt = raw.hi - raw.lo, dev = (raw.J / dv - 1) * 100;
  const m1 = run.m1, hasM = ok(m1);
  const miss = what => `<strong class="missing">fehlt</strong><small>braucht ${what}</small>`;
  const figs = [
    ['Wagen 1: v₁ → v₁′', `<strong>${fmt(run.v1)} → ${fmt(run.u1)}</strong><small>m/s</small>`],
    ['Wagen 2: v₂ → v₂′', `<strong>${fmt(run.v2)} → ${fmt(run.u2)}</strong><small>m/s, v₂′ unsicherer</small>`],
    ['Stosszahl e', `<strong>${fmt(Math.max(run.e, 0), 2)}</strong><small>aus den Geschwindigkeiten</small>`],
    ['m₂/m₁ aus Impulserhaltung', `<strong>${fmt(run.ratio, 2)}</strong><small>erwartet ${fmt(EXPECTED_RATIO[run.aufbau] ?? NaN, 1)}</small>`],
    ['Stossdauer Δt', `<strong>≈ ${fmt(dt, 2)} s</strong><small>|a₁| über 10 % des Maximums</small>`],
    ['∫a₁ dt (Kraftstoss pro Masse)', `<strong>${fmt(raw.J)} m/s</strong><small>Δv₁ aus Fits ${fmt(dv)} m/s, ${dev >= 0 ? '+' : ''}${fmt(dev, 0)} %</small>`],
    ['Mittlere Kraft F̄ = m₁·Δv₁/Δt', hasM ? `<strong>${fmt(m1 * raw.J / dt, 2)} N</strong><small>Spitze ${fmt(m1 * raw.amax, 2)} N</small>` : miss('m₁')],
    ['Kraftstoss ∫F dt und Δp₁', hasM ? `<strong>${fmt(m1 * raw.J)} N·s</strong><small>Δp₁ = ${fmt(m1 * dv)} kg·m/s</small>` : miss('m₁')],
  ];
  $('dFigures').innerHTML = figs.map(([k, v]) => `<div class="fig"><div>${k}</div>${v}</div>`).join('');

  const pts = arr => arr.map((y, i) => ({ x: raw.t[i], y }));   // null-Werte unterbrechen die Linie
  const band = { band: [raw.lo, raw.hi], fill: css('--rule') + '88', text: css('--muted') };
  const xs = { type: 'linear', min: 0, max: 5, grid: o.grid, ticks: { ...o.ticks, callback: deNum(1) }, title: o.axisTitle('t in s') };

  legend('lgX', [[shapeSVG.dots(c1), 'Wagen 1'], [shapeSVG.dots(c2), 'Wagen 2']]);
  chart('chX', { type: 'scatter', data: { datasets: [
      { label: 'Wagen 1', data: pts(raw.x1), backgroundColor: c1, borderWidth: 0, pointRadius: 1.4, pointHoverRadius: 3 },
      { label: 'Wagen 2', data: pts(raw.x2), backgroundColor: c2, borderWidth: 0, pointRadius: 1.4, pointHoverRadius: 3 }] },
    options: { maintainAspectRatio: false, animation: false, parsing: false,
      plugins: { legend: { display: false }, mark: band, tooltip: { ...o.tooltip, callbacks: { title: i => `t = ${fmt(i[0].raw.x, 3)} s`, label: i => `${i.dataset.label}: x = ${fmt(i.raw.y)} m` } } },
      scales: { x: xs, y: { grid: o.grid, ticks: { ...o.ticks, callback: deNum(2) }, border: { display: false }, title: o.axisTitle('x in m') } } } });

  legend('lgV', [[shapeSVG.line(c1), 'Wagen 1'], [shapeSVG.line(c2), 'Wagen 2']]);
  chart('chV', { type: 'line', data: { datasets: [
      { label: 'Wagen 1', data: pts(raw.v1), borderColor: c1, borderWidth: 2, pointRadius: 0, spanGaps: false },
      { label: 'Wagen 2', data: pts(raw.v2), borderColor: c2, borderWidth: 2, pointRadius: 0, spanGaps: false }] },
    options: { maintainAspectRatio: false, animation: false, parsing: false, interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: { legend: { display: false }, mark: band, tooltip: { ...o.tooltip, callbacks: { title: i => `t = ${fmt(i[0].raw.x, 3)} s`, label: i => `${i.dataset.label}: v = ${fmt(i.raw.y)} m/s` } } },
      scales: { x: xs, y: { grid: o.grid, ticks: { ...o.ticks, callback: deNum(2) }, border: { display: false }, title: o.axisTitle('v in m/s') } } } });

  const k = hasM ? m1 : 1, from = run.tc - 0.4, to = run.tc + 0.7;
  const fpts = raw.a1.map((a, i) => (a === null || raw.t[i] < from || raw.t[i] > to) ? null : { x: raw.t[i], y: a * k }).filter(Boolean);
  const area = fpts.filter(p => p.x >= raw.lo && p.x <= raw.hi);
  $('chFTitle').textContent = hasM ? 'Kraftstoss an Wagen 1: F(t)' : 'Kraftstoss an Wagen 1: a(t)';
  $('chFSub').textContent = hasM ? 'F = m₁·a₁. Die Fläche unter der Kurve ist der Kraftstoss ∫F dt und sollte Δp₁ entsprechen.'
    : 'Beschleunigung von Wagen 1. Die Fläche ist ∫a₁ dt = Δv₁, der Kraftstoss pro Masse. Mit m₁ wird daraus die Kraft F(t).';
  chart('chF', { type: 'line', data: { datasets: [
      { data: area, borderWidth: 0, pointRadius: 0, fill: 'origin', backgroundColor: c1 + '33' },
      { label: hasM ? 'F' : 'a₁', data: fpts, borderColor: c1, borderWidth: 2, pointRadius: 0 }] },
    options: { maintainAspectRatio: false, animation: false, parsing: false, interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: { legend: { display: false }, tooltip: { ...o.tooltip, filter: i => i.datasetIndex === 1, callbacks: { title: i => `t = ${fmt(i[0].raw.x, 3)} s`, label: i => hasM ? `F = ${fmt(i.raw.y, 2)} N` : `a₁ = ${fmt(i.raw.y, 2)} m/s²` } } },
      scales: { x: { type: 'linear', min: from, max: to, grid: o.grid, ticks: { ...o.ticks, callback: deNum(2) }, title: o.axisTitle('t in s') },
        y: { grid: o.grid, ticks: { ...o.ticks, callback: deNum(1) }, border: { display: false }, title: o.axisTitle(hasM ? 'F in N' : 'a₁ in m/s²') } } } });
}
$('dReplay').addEventListener('click', () => detailBench.restart());
$('dSlow').addEventListener('click', e => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', on); detailBench.setSpeed(on ? 0.3 : 1); });

// ===================== Federmodell =====================
const mk = $('mk'), mm1 = $('mm1'), mm2 = $('mm2');
function defaultMasses(run) {
  if (run.hasMass) return [run.m1, run.m2];
  return { 'leicht→schwer': [0.25, 0.5], 'schwer→leicht': [0.5, 0.25] }[run.aufbau] || [0.25, 0.25];
}
async function selectModelRun(id) {
  const run = RUNS.find(r => r.id === id); if (!run) return;
  modelRun = run;
  document.querySelectorAll('[data-mrun]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mrun === id));
  const [a, b] = defaultMasses(run); mm1.value = a; mm2.value = b;
  $('modelMassNote').style.display = run.hasMass ? 'none' : '';
  await loadRaw(run); renderModel();
}
function simulate(run, raw, k, m1, m2) {
  const t0 = Math.max(0, run.tc - 0.5), t1 = Math.min(5, run.tc + 1.3), i0 = Math.round(t0 / DT);
  const avg = (arr, i) => { let s = 0, n = 0; for (let j = i - 4; j <= i + 4; j++) if (arr[j] !== null && arr[j] !== undefined) { s += arr[j]; n++; } return s / n; };
  let x1 = avg(raw.x1, i0), x2 = avg(raw.x2, i0), v1 = run.v1, v2 = run.v2;
  if (!ok(x2)) x2 = raw.x2f[i0];
  const h = 1e-4, every = Math.round(DT / h), out = [];
  for (let s = 0, t = t0; t <= t1; s++, t += h) {
    const d = raw.D - (x1 - x2), F = d > 0 ? k * d : 0;
    if (s % every === 0) out.push({ t, x1, x2, E1: .5 * m1 * v1 * v1, E2: .5 * m2 * v2 * v2, Ef: d > 0 ? .5 * k * d * d : 0 });
    v1 += F / m1 * h; v2 -= F / m2 * h; x1 += v1 * h; x2 += v2 * h;   // semi-implizites Euler-Verfahren
  }
  return { out, t0, t1 };
}
function renderModel() {
  const run = modelRun, raw = run && rawCache[run.id]; if (!raw) return;
  const k = +mk.value, m1 = +mm1.value, m2 = +mm2.value;
  $('o_k').textContent = k; $('o_mm1').textContent = fmt(m1, 2); $('o_mm2').textContent = fmt(m2, 2);
  const o = baseOpts(), c1 = css(run.T.color), c2 = css('--w2'), ink = css('--ink'), muted = css('--muted');
  const { out, t0, t1 } = simulate(run, raw, k, m1, m2);
  const meas = arr => arr.map((y, i) => (y === null || raw.t[i] < t0 || raw.t[i] > t1 || i % 2) ? null : { x: raw.t[i], y }).filter(Boolean);
  const xs = { type: 'linear', min: t0, max: t1, grid: o.grid, ticks: { ...o.ticks, callback: deNum(1) }, title: o.axisTitle('t in s') };
  legend('lgMX', [[shapeSVG.dots(c1), 'Wagen 1 gemessen'], [shapeSVG.line(c1), 'Wagen 1 Modell'], [shapeSVG.dots(c2), 'Wagen 2 gemessen'], [shapeSVG.line(c2), 'Wagen 2 Modell']]);
  chart('chMX', { type: 'scatter', data: { datasets: [
      { label: 'Wagen 1 gemessen', data: meas(raw.x1), backgroundColor: c1 + '99', borderWidth: 0, pointRadius: 1.5 },
      { label: 'Wagen 2 gemessen', data: meas(raw.x2), backgroundColor: c2 + '99', borderWidth: 0, pointRadius: 1.5 },
      { label: 'Wagen 1 Modell', type: 'line', data: out.map(p => ({ x: p.t, y: p.x1 })), borderColor: c1, borderWidth: 2, pointRadius: 0 },
      { label: 'Wagen 2 Modell', type: 'line', data: out.map(p => ({ x: p.t, y: p.x2 })), borderColor: c2, borderWidth: 2, pointRadius: 0 }] },
    options: { maintainAspectRatio: false, animation: false, parsing: false,
      plugins: { legend: { display: false }, tooltip: { ...o.tooltip, callbacks: { title: i => `t = ${fmt(i[0].raw.x, 3)} s`, label: i => `${i.dataset.label}: ${fmt(i.raw.y)} m` } } },
      scales: { x: xs, y: { min: 0, grid: o.grid, ticks: { ...o.ticks, callback: deNum(2) }, border: { display: false }, title: o.axisTitle('x in m') } } } });
  legend('lgME', [[shapeSVG.line(c1), 'Wagen 1'], [shapeSVG.line(c2), 'Wagen 2'], [shapeSVG.line(ink), 'Summe E_kin'], [shapeSVG.line(muted, true), 'E_kin + Federenergie']]);
  const ds = (label, f, color, extra = {}) => ({ label, data: out.map(p => ({ x: p.t, y: f(p) * 1000 })), borderColor: color, borderWidth: 2, pointRadius: 0, ...extra });
  chart('chME', { type: 'line', data: { datasets: [
      ds('Wagen 1', p => p.E1, c1), ds('Wagen 2', p => p.E2, c2), ds('Summe E_kin', p => p.E1 + p.E2, ink, { borderWidth: 2.5 }),
      ds('E_kin + Federenergie', p => p.E1 + p.E2 + p.Ef, muted, { borderDash: [5, 4], borderWidth: 1.5 })] },
    options: { maintainAspectRatio: false, animation: false, parsing: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { ...o.tooltip, callbacks: { title: i => `t = ${fmt(i[0].raw.x, 3)} s`, label: i => `${i.dataset.label}: ${fmt(i.raw.y, 1)} mJ` } } },
      scales: { x: xs, y: { beginAtZero: true, grid: o.grid, ticks: { ...o.ticks, callback: deNum(0) }, border: { display: false }, title: o.axisTitle('E in mJ') } } } });
}
[mk, mm1, mm2].forEach(el => el.addEventListener('input', renderModel));

// ===================== Start =====================
async function heroCycle() {
  // je Stossart die Messung mit gleich schweren Wagen, einer ruht
  const picks = TYPES.map(T => RUNS.find(r => r.T === T && r.aufbau === 'gleich (einer ruht)') || RUNS.find(r => r.T === T)).filter(Boolean);
  const loaded = await Promise.all(picks.map(r => loadRaw(r).then(raw => [r, raw]).catch(() => null)));
  const list = loaded.filter(Boolean); if (!list.length) return;
  let i = 0;
  const show = () => {
    const [r, raw] = list[i]; heroScene = dataScene(r, raw); heroBench.restart();
    $('heroType').textContent = `Messung ${r.id}: ${r.T.label.toLowerCase()}`;
    $('heroSub').textContent = `${r.T.puffer}, ${AUFBAU_TEXT[r.aufbau]}, e = ${fmt(Math.max(r.e, 0), 2)}`;
  };
  show();
  if (!reduceMotion && list.length > 1) setInterval(() => { i = (i + 1) % list.length; show(); }, (heroScene.dur + 0.8) * 1000);
}

function renderAll() {
  renderOverviewCharts();
  if (current && rawCache[current.id]) renderDetail(current, rawCache[current.id]);
  renderModel();
}

fetch('data/messungen.csv').then(r => r.ok ? r.text() : Promise.reject(new Error(r.status)))
  .then(text => {
    RUNS = parseRuns(text);
    renderMatrix(); renderTable();
    const elastic = RUNS.filter(r => r.T === TYPES[0]);
    $('modelRuns').innerHTML = 'Messung ' + elastic.map(r => `<button class="run" data-mrun="${r.id}" aria-pressed="false">Nr. ${r.id}</button>`).join('');
    $('modelRuns').querySelectorAll('[data-mrun]').forEach(b => b.addEventListener('click', () => selectModelRun(b.dataset.mrun)));
    return document.fonts.ready.then(() => {
      renderOverviewCharts();
      heroCycle();
      selectRun(RUNS[0].id, false);
      if (elastic.length) selectModelRun(elastic[0].id);
    });
  })
  .catch(() => {
    $('massNote').innerHTML = '<b>Daten nicht geladen</b><span>Die Messdaten konnten nicht gelesen werden. Wird die Seite direkt vom Rechner geöffnet, bitte einen kleinen Webserver starten (siehe README).</span>';
  });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => RUNS.length && renderAll());
