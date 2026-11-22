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
  if (deriv === 0) { const den = (2 * h - 1) * (2 * h + 1) * (2 * h + 3); c = ks.map(k => (3 * (3 * h * h + 3 * h - 1) - 15 * k * k) / den); }
  else if (deriv === 1) { const S = ks.reduce((s, k) => s + k * k, 0); c = ks.map(k => k / S / DT); }
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
  const v1 = sg(x1, SMOOTH, 1), v2 = sg(x2, SMOOTH, 1), a1 = sg(x1, SMOOTH, 2), a2 = sg(x2, SMOOTH, 2), s1 = sg(x1, SMOOTH, 0), s2 = sg(x2, SMOOTH, 0);
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
  return rawCache[run.id] = { t, x1, x2, x2f, v1, v2, a1, a2, s1, s2, D, lo: t[lo], hi: t[hi], J, amax };
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
    <text x="${px(tc)}" y="${b + 15}" text-anchor="middle" font-family="Calibri, Carlito, sans-serif" font-size="13" fill="var(--muted)">Stoss</text>
    <text x="${W}" y="${b + 15}" text-anchor="end" font-family="Calibri, Carlito, sans-serif" font-size="13" fill="var(--muted)">t</text>
    <text x="${l - 8}" y="12" text-anchor="end" font-family="Calibri, Carlito, sans-serif" font-size="13" fill="var(--muted)">x</text>
    ${line(1, 'var(--w2)')}${line(0, 'var(--c-el)')}
    <text x="${px(0.05)}" y="${py(0.1) - 8}" font-family="Calibri, Carlito, sans-serif" font-size="13" fill="var(--ink-2)">W1</text>
    <text x="${px(0.05)}" y="${py(0.58) - 6}" font-family="Calibri, Carlito, sans-serif" font-size="13" fill="var(--ink-2)">W2</text>`;
});

// ===================== Versuchsaufbau (Simulation) =====================
// Ruhige, berechnete Animation: keine Messdaten, kein Rauschen.
const SIM = { L: 1.2, cart: 0.16, buf: 0.025, e: [1, 0.55, 0] };   // e für Schaumstoff ≈ Mittel unserer Messungen 9 bis 12
const sEl = { m1: $('sm1'), m2: $('sm2'), v1: $('sv1'), v2: $('sv2') };
let simType = 0, simTraj = [], simT0 = performance.now();
function simParams() { return { m1: +sEl.m1.value, m2: +sEl.m2.value, v1: +sEl.v1.value, v2: +sEl.v2.value, e: SIM.e[simType] }; }
function buildTraj() {
  const { m1, m2, v1, v2, e } = simParams(), C = SIM.cart, gap = C + SIM.buf;
  const lo = C / 2 + 0.02, hi = SIM.L - C / 2 - 0.02, h = 1 / 120;
  let c1 = 0.92, c2 = 0.42, u1 = v1, u2 = v2, stuck = false, endAt = Infinity; const pts = [];
  for (let t = 0; t <= 5 && t <= endAt; t += h) {
    pts.push({ c1, c2, u1, u2 });
    c1 += u1 * h; c2 += u2 * h;
    if (stuck) c1 = c2 + gap;
    if (!stuck && c1 - c2 <= gap && u1 - u2 < 0) {
      [u1, u2] = collide(m1, m2, u1, u2, e); c1 = c2 + gap;
      if (e === 0) stuck = true;
    }
    // Anschläge an den Schienenenden: Wagen bleibt stehen, Animation läuft noch kurz aus
    if (c2 < lo) { c2 = lo; u2 = 0; if (stuck) { u1 = 0; c1 = c2 + gap; } if (endAt === Infinity) endAt = t + 0.7; }
    if (c1 > hi) { c1 = hi; u1 = 0; if (stuck) { u2 = 0; c2 = c1 - gap; } if (endAt === Infinity) endAt = t + 0.7; }
    if (Math.abs(u1) < 1e-4 && Math.abs(u2) < 1e-4 && t > 0.3 && endAt === Infinity) endAt = t + 0.5;
  }
  simTraj = pts;
}
function updateSetup(restart = true) {
  const { m1, m2, v1, v2, e } = simParams();
  $('o_sm1').textContent = fmt(m1, 2); $('o_sm2').textContent = fmt(m2, 2);
  $('o_sv1').textContent = fmt(v1, 2); $('o_sv2').textContent = fmt(v2, 2);
  document.querySelectorAll('[data-type]').forEach(b => b.setAttribute('aria-pressed', +b.dataset.type === simType));
  const approach = v1 - v2 < 0;
  const [u1, u2] = approach ? collide(m1, m2, v1, v2, e) : [v1, v2];
  const p0 = m1 * v1 + m2 * v2, p1 = m1 * u1 + m2 * u2;
  const E0 = .5 * m1 * v1 ** 2 + .5 * m2 * v2 ** 2, E1 = .5 * m1 * u1 ** 2 + .5 * m2 * u2 ** 2, keep = E0 > 0 ? E1 / E0 : 1;
  $('r_p').innerHTML = `${fmt(p0)} <span>→</span> ${fmt(p1)}<span class="u">kg·m/s</span>`;
  $('r_E').innerHTML = `${fmt(E0 * 1000, 1)} <span>→</span> ${fmt(E1 * 1000, 1)}<span class="u">mJ</span>`;
  $('r_kept').style.width = keep * 100 + '%'; $('r_lost').style.width = (1 - keep) * 100 + '%';
  $('r_keep').textContent = fmt(keep * 100, 0) + ' %'; $('r_loss').textContent = fmt((1 - keep) * 100, 0) + ' %'; $('r_e').textContent = fmt(e, 2);
  buildTraj();
  if (restart) simT0 = performance.now();
}
Object.values(sEl).forEach(el => el.addEventListener('input', () => updateSetup()));
document.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => { simType = +b.dataset.type; updateSetup(); }));
$('sPlay').addEventListener('click', () => { simT0 = performance.now(); });

(function setupCanvas() {
  const canvas = $('setupCanvas'), ctx = canvas.getContext('2d');
  let W = 0, H = 0;
  function resize() { const r = canvas.getBoundingClientRect(), d = devicePixelRatio || 1; W = r.width; H = r.height; canvas.width = W * d; canvas.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0); }
  resize(); addEventListener('resize', resize);
  const font = (w, s) => `${w} ${s}px Calibri, Carlito, sans-serif`;
  function arrow(x0, x1, y, col) {
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    const d = Math.sign(x1 - x0) || 1; ctx.beginPath(); ctx.moveTo(x1 + d * 2, y); ctx.lineTo(x1 - d * 7, y - 5); ctx.lineTo(x1 - d * 7, y + 5); ctx.fill();
  }
  function draw() {
    if (!simTraj.length) return;
    const k = Math.min(1, H / 250), padL = 64 * Math.max(.7, k), padR = 24, sc = (W - padL - padR) / SIM.L, X = x => padL + x * sc;
    const railY = H - 52 * k, bodyH = 30 * k, wr = 5 * k, bodyTop = railY - 2 * wr - bodyH;
    const { m1, m2 } = simParams();
    const t = reduceMotion ? 0 : (performance.now() - simT0) / 1000;
    const i = Math.min(simTraj.length - 1, Math.floor(t * 120)), p = simTraj[i];
    const muted = css('--muted'), ink = css('--ink'), ink2 = css('--ink-2'), rail = css('--rail'), raised = css('--raised');
    const col1 = css('--ink'), col2 = css('--w2');
    ctx.clearRect(0, 0, W, H);
    // Schiene, Anschläge, Massstab
    ctx.fillStyle = rail; ctx.fillRect(X(0), railY, SIM.L * sc, 7 * k);
    ctx.fillRect(X(0) - 4, railY - 16 * k, 4, 16 * k); ctx.fillRect(X(SIM.L), railY - 16 * k, 4, 16 * k);
    ctx.fillStyle = muted; ctx.strokeStyle = muted; ctx.lineWidth = 1; ctx.font = font(500, 13); ctx.textAlign = 'center';
    for (let x = 0; x <= SIM.L + 1e-6; x += 0.1) {
      const px = X(x), major = Math.round(x * 10) % 2 === 0;
      ctx.beginPath(); ctx.moveTo(px, railY + 10 * k); ctx.lineTo(px, railY + (major ? 18 : 14) * k); ctx.stroke();
      if (major) ctx.fillText(fmt(x, 1), px, railY + 32 * k);
    }
    ctx.textAlign = 'left'; ctx.fillText('x in m', X(SIM.L) - 30, railY + 46 * k > H - 2 ? H - 2 : railY + 46 * k);
    // Ultraschallsensoren links
    const flagTop = bodyTop - 62 * k, beam1 = flagTop + 8 * k, beam2 = bodyTop + bodyH / 2;
    ctx.fillStyle = ink2; ctx.beginPath(); ctx.roundRect(X(0) - 30 * k - 8, beam1 - 9 * k, 22 * k, 18 * k, 3); ctx.fill();
    ctx.beginPath(); ctx.roundRect(X(0) - 30 * k - 8, beam2 - 9 * k, 22 * k, 18 * k, 3); ctx.fill();
    ctx.fillStyle = muted; ctx.font = font(500, 13); ctx.textAlign = 'left';
    ctx.fillText('Sensoren', 4, flagTop - 14 * k);
    // Wagen
    const C = SIM.cart;
    function cart(c, col, label, m, flag) {
      const x = X(c - C / 2), w = C * sc;
      ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(x, bodyTop, w, bodyH, 4); ctx.fill();
      [x + w * .2, x + w * .8].forEach(cx => { ctx.beginPath(); ctx.arc(cx, railY - wr, wr, 0, 7); ctx.fill(); });
      // Zusatzgewicht: Höhe wächst mit der Masse
      const wh = (6 + 26 * (m - 0.1) / 0.9) * k;
      ctx.fillStyle = ink2; ctx.globalAlpha = .85; ctx.beginPath(); ctx.roundRect(x + w * .3, bodyTop - wh, w * .45, wh, 2); ctx.fill(); ctx.globalAlpha = 1;
      if (flag) { ctx.fillStyle = col; ctx.fillRect(x + w * .12, flagTop, 4, bodyTop - flagTop); ctx.fillRect(x + w * .12, flagTop, w * .16, 14 * k); }
      ctx.fillStyle = raised; ctx.font = font(600, 16); ctx.textAlign = 'center'; ctx.fillText(label, x + w / 2, bodyTop + bodyH / 2 + 5);
      ctx.fillStyle = ink; ctx.font = font(600, 14); ctx.fillText(fmt(m, 2) + ' kg', x + w * .52, bodyTop - wh - 5);
    }
    // Abstandslinien x1, x2
    ctx.setLineDash([4, 4]); ctx.strokeStyle = muted; ctx.lineWidth = 1;
    const x2face = X(p.c2 - C / 2), x1flag = X(p.c1 - C / 2) + C * sc * .12;
    ctx.beginPath(); ctx.moveTo(X(0) - 8, beam2); ctx.lineTo(x2face, beam2); ctx.moveTo(X(0) - 8, beam1); ctx.lineTo(x1flag, beam1); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = muted; ctx.font = font(500, 14); ctx.textAlign = 'center';
    ctx.fillText('x₂', (X(0) + x2face) / 2, beam2 - 5); ctx.fillText('x₁', (X(0) + x1flag) / 2, beam1 - 5);
    cart(p.c2, col2, 'W2', m2, false);
    cart(p.c1, col1, 'W1', m1, true);
    // Puffer vorne an Wagen 1
    const bx1 = X(p.c1 - C / 2), bx0 = bx1 - SIM.buf * sc, by = bodyTop + bodyH * .2, bh = bodyH * .6;
    ctx.strokeStyle = col1; ctx.fillStyle = col1; ctx.lineWidth = 1.6;
    if (simType === 0) { ctx.beginPath(); ctx.moveTo(bx1, by + bh / 2); const n = 6; for (let j = 1; j <= n; j++) ctx.lineTo(bx1 - (bx1 - bx0) * j / n, by + (j % 2 ? 0 : bh)); ctx.stroke(); ctx.fillRect(bx0 - 2, by, 2, bh); }
    else if (simType === 1) { ctx.globalAlpha = .5; ctx.beginPath(); ctx.roundRect(bx0, by - 2, bx1 - bx0, bh + 4, 4); ctx.fill(); ctx.globalAlpha = 1; }
    else { ctx.fillRect(bx0, by - 2, bx1 - bx0, bh + 4); ctx.strokeStyle = raised; ctx.lineWidth = 1; for (let yy = by; yy < by + bh; yy += 4) { ctx.beginPath(); ctx.moveTo(bx0, yy); ctx.lineTo(bx1, yy + 3); ctx.stroke(); } }
    // Geschwindigkeitspfeile oben
    const ay = 16 * k + 8;
    [[p.c1, p.u1, col1, 'v₁'], [p.c2, p.u2, col2, 'v₂']].forEach(([c, v, col, lab]) => {
      const x0 = X(c); ctx.font = font(600, 14); ctx.fillStyle = col; ctx.textAlign = 'center';
      if (Math.abs(v) < 0.005) { ctx.fillText(`${lab} = 0`, x0, ay + 4); return; }
      arrow(x0, x0 + v * 140 * Math.max(.6, k), ay + 14 * k, col);
      ctx.fillText(`${lab} = ${fmt(v, 2)} m/s`, x0, ay);
    });
  }
  function frame() { draw(); requestAnimationFrame(frame); }
  requestAnimationFrame(frame);
})();

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
    ctx.fillStyle = o.text; ctx.font = '500 13px Calibri, Carlito, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Stoss', (x0 + x1) / 2, a.top + 12);
    ctx.restore();
  },
};
Chart.register(markPlugin);

let charts = {};
function chart(id, cfg) { if (charts[id]) charts[id].destroy(); charts[id] = new Chart($(id), cfg); return charts[id]; }
function baseOpts() {
  const ink = css('--ink'), surface = css('--raised'), rule = css('--rule');
  Chart.defaults.font.family = 'Calibri, Carlito, sans-serif'; Chart.defaults.font.size = 13;
  Chart.defaults.color = css('--muted'); Chart.defaults.borderColor = rule; Chart.defaults.locale = 'de-CH';
  return {
    tooltip: { backgroundColor: ink, titleColor: surface, bodyColor: surface, titleFont: { weight: '600', size: 15 }, bodyFont: { size: 14 }, padding: 10, cornerRadius: 4, displayColors: false },
    grid: { color: rule, drawTicks: false }, ticks: { padding: 8 }, anim: reduceMotion ? false : { duration: 400 },
    axisTitle: text => ({ display: true, text, color: css('--ink-2') }),
  };
}
const deNum = d => v => fmt(v, d);

// ===================== Zustand =====================
let RUNS = [], modelRun = null;

// ===================== Versuchsmatrix & Tabelle =====================
function renderTable() {
  const missing = '<span class="missing">fehlt</span>';
  $('table').querySelector('tbody').innerHTML = RUNS.map(r => `<tr data-run="${r.id}">
    <td>${r.id}</td><td><span class="swatch" style="background:var(${r.T.color})"></span>${r.T.label}</td><td>${r.aufbau}</td>
    <td>${fmt(r.v1)}</td><td>${fmt(r.v2)}</td><td>${fmt(r.u1)}</td><td>${fmt(r.u2)}</td>
    <td class="calc">${fmt(Math.max(r.e, 0), 2)}</td><td class="calc">${fmt(r.ratio, 2)}</td>
    <td>${ok(r.m1) ? fmt(r.m1) : missing}</td><td>${ok(r.m2) ? fmt(r.m2) : missing}</td>
    <td class="calc">${fmt(r.p0)}</td><td class="calc">${fmt(r.p1)}</td><td class="calc">${fmt(r.dE, 1)}</td></tr>`).join('');
  $('table').querySelectorAll('tbody tr').forEach(tr => tr.addEventListener('click', () => selectDeriv(tr.dataset.run, true)));
  $('massNote').style.display = RUNS.every(r => r.hasMass) ? 'none' : '';
}

function renderOverviewCharts() {
  const o = baseOpts(), surface = css('--raised'), muted = css('--muted');
  const present = TYPES.filter(T => RUNS.some(r => r.T === T));
  legend('lgTypes', present.map(T => [shapeSVG[T.shape](css(T.color)), `${T.label} (${T.puffer})`]));
  const order = [...RUNS].sort((a, b) => TYPES.indexOf(a.T) - TYPES.indexOf(b.T) || AUFBAU.indexOf(a.aufbau) - AUFBAU.indexOf(b.aufbau));
  const labels = order.map(r => 'Nr. ' + r.id);
  const title = i => { const r = order[i]; return `Messung ${r.id}, ${r.T.label.toLowerCase()}`; };

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
  $('pFigure').style.display = withMass.length ? '' : 'none'; $('massFact').style.display = RUNS.every(r => r.hasMass) ? 'none' : '';
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

// ===================== Von x(t) zu v(t) und a(t) =====================
// Zeichnet Zeitcursor, Tangente und Punkt in ein Diagramm
const cursorPlugin = {
  id: 'cursor',
  afterDatasetsDraw(chart, _, o) {
    if (!o || !ok(o.t)) return;
    const { ctx, chartArea: a, scales: { x, y } } = chart;
    ctx.save(); ctx.beginPath(); ctx.rect(a.left, a.top, a.right - a.left, a.bottom - a.top); ctx.clip();
    const px = x.getPixelForValue(o.t);
    ctx.strokeStyle = o.muted; ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke(); ctx.setLineDash([]);
    if (ok(o.y)) {
      if (ok(o.slope)) {
        const s = o.span;
        ctx.strokeStyle = o.ink; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x.getPixelForValue(o.t - s), y.getPixelForValue(o.y - o.slope * s)); ctx.lineTo(x.getPixelForValue(o.t + s), y.getPixelForValue(o.y + o.slope * s)); ctx.stroke();
      }
      ctx.fillStyle = o.color; ctx.strokeStyle = o.ring; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, y.getPixelForValue(o.y), 5.5, 0, 7); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  },
};
Chart.register(cursorPlugin);

const DEMO = ['3', '11', '7'];   // je Stossart eine Beispielmessung: gleich schwere Wagen, einer ruht
let dRun = null, dCart = 1, dTime = 1, dWin = [0, 5];
function cartSeries(raw) {
  return dCart === 1 ? { x: raw.x1, xs: raw.s1, v: raw.v1, a: raw.a1 } : { x: raw.x2, xs: raw.s2, v: raw.v2, a: raw.a2 };
}
function renderTabs() {
  $('dTabs').innerHTML = TYPES.map((T, i) => {
    const r = RUNS.find(r => r.id === DEMO[i]) || RUNS.find(r => r.T === T); if (!r) return '';
    return `<button class="btn" data-drun="${r.id}"><span class="swatch" style="background:var(${T.color})"></span>${T.label} <small>Messung ${r.id}</small></button>`;
  }).join('') + `<label style="display:inline-flex;gap:8px;align-items:center;font-size:14px;color:var(--ink-2)">Andere Messung <select id="dSelect" style="font:inherit">${RUNS.map(r => `<option value="${r.id}">Nr. ${r.id}, ${r.T.label.toLowerCase()}</option>`).join('')}</select></label>`;
  $('dTabs').querySelectorAll('[data-drun]').forEach(b => b.addEventListener('click', () => selectDeriv(b.dataset.drun)));
  $('dSelect').addEventListener('change', e => selectDeriv(e.target.value));
}
async function selectDeriv(id, scroll) {
  const run = RUNS.find(r => r.id === id); if (!run) return;
  dRun = run;
  document.querySelectorAll('[data-drun]').forEach(b => b.setAttribute('aria-pressed', b.dataset.drun === id));
  $('dSelect').value = id;
  if (scroll) $('ableitung').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  $('dSub').textContent = `Messung ${run.id}: ${run.T.label} mit ${run.T.puffer}, ${AUFBAU_TEXT[run.aufbau] || run.aufbau}`;
  const raw = await loadRaw(run); if (dRun !== run) return;
  dWin = [Math.max(0, run.tc - 1.0), Math.min(raw.t[raw.t.length - 1], run.tc + 1.4)];
  $('dT').min = dWin[0]; $('dT').max = dWin[1];
  dTime = Math.max(dWin[0], run.tc - 0.2); $('dT').value = dTime;
  renderDeriv();
}
function renderDeriv() {
  const run = dRun, raw = run && rawCache[run.id]; if (!raw) return;
  const o = baseOpts(), col = dCart === 1 ? css('--ink') : css('--w2'), S = cartSeries(raw);
  const inWin = (arr) => arr.map((y, i) => ({ x: raw.t[i], y })).filter(p => p.x >= dWin[0] - 1e-9 && p.x <= dWin[1] + 1e-9);
  const xs = { type: 'linear', min: dWin[0], max: dWin[1], grid: o.grid, ticks: { ...o.ticks, stepSize: 0.25, callback: deNum(2) } };
  const cur = { muted: css('--muted'), ink: css('--ink'), ring: css('--raised'), color: col, span: 0.3 };
  const band = { band: [raw.lo, raw.hi], fill: css('--rule') + '88', text: css('--muted') };
  const hover = (evt, _, ch) => { const t = ch.scales.x.getValueForPixel(evt.x); if (ok(t)) setTime(t); };
  const common = { maintainAspectRatio: false, animation: false, parsing: false, events: ['mousemove', 'click', 'touchstart', 'touchmove'], onHover: hover, onClick: hover };
  const yAx = (title, d) => ({ afterFit: ax => { ax.width = 64; }, grid: o.grid, ticks: { ...o.ticks, callback: deNum(d) }, border: { display: false }, title: o.axisTitle(title) });
  chart('chX', { type: 'scatter', data: { datasets: [{ data: inWin(S.x), backgroundColor: col + 'aa', borderWidth: 0, pointRadius: 1.8, pointHoverRadius: 1.8 }] },
    options: { ...common, plugins: { legend: { display: false }, tooltip: { enabled: false }, mark: band, cursor: { ...cur } }, scales: { x: xs, y: yAx('x in m', 2) } } });
  chart('chV', { type: 'line', data: { datasets: [{ data: inWin(S.v), borderColor: col, borderWidth: 2, pointRadius: 0 }] },
    options: { ...common, plugins: { legend: { display: false }, tooltip: { enabled: false }, mark: band, cursor: { ...cur } }, scales: { x: xs, y: yAx('v in m/s', 2) } } });
  const aPts = inWin(S.a);
  chart('chA', { type: 'line', data: { datasets: [
      { data: aPts.filter(p => p.x >= raw.lo && p.x <= raw.hi && p.y !== null), borderWidth: 0, pointRadius: 0, fill: 'origin', backgroundColor: col + '33' },
      { data: aPts, borderColor: col, borderWidth: 2, pointRadius: 0 }] },
    options: { ...common, plugins: { legend: { display: false }, tooltip: { enabled: false }, mark: band, cursor: { ...cur } }, scales: { x: { ...xs, title: o.axisTitle('t in s') }, y: yAx('a in m/s²', 1) } } });
  setTime(dTime);
}
function setTime(t) {
  const run = dRun, raw = run && rawCache[run.id]; if (!raw) return;
  t = Math.min(dWin[1], Math.max(dWin[0], t));
  const i = Math.round(t / DT); dTime = raw.t[i]; $('dT').value = dTime;
  const S = cartSeries(raw), x = S.xs[i], v = S.v[i], a = S.a[i];
  const set = (id, y, slope) => { const c = charts[id]; if (!c) return; Object.assign(c.options.plugins.cursor, { t: dTime, y: y ?? NaN, slope: slope ?? NaN }); c.update('none'); };
  set('chX', x, v); set('chV', v, a); set('chA', a, null);
  $('o_dt').textContent = fmt(dTime, 3) + ' s';
  // Kraftstoss pro Masse für den gewählten Wagen
  let J = 0, good = true; const lo = Math.round(raw.lo / DT), hi = Math.round(raw.hi / DT);
  for (let j = lo; j < hi; j++) { if (S.a[j] === null || S.a[j + 1] === null) { good = false; break; } J += (S.a[j] + S.a[j + 1]) / 2 * DT; }
  const dv = dCart === 1 ? run.u1 - run.v1 : run.u2 - run.v2;
  const na = '<strong>–</strong><small>hier nicht messbar</small>';
  $('dFigures').innerHTML = [
    ['Ort x', ok(x) && x !== null ? `<strong>${fmt(x)} m</strong><small>bei t = ${fmt(dTime, 2)} s</small>` : na],
    ['v = Steigung der Tangente an x(t)', v !== null ? `<strong>${fmt(v)} m/s</strong><small>dx/dt</small>` : na],
    ['a = Steigung der Tangente an v(t)', a !== null ? `<strong>${fmt(a, 2)} m/s²</strong><small>dv/dt</small>` : na],
    ['Fläche unter a(t) im Stoss', good ? `<strong>${fmt(J)} m/s</strong><small>Δv aus Fits ${fmt(dv)} m/s, Stossdauer ≈ ${fmt(raw.hi - raw.lo, 2)} s</small>` : '<strong>–</strong><small>Wagen 2 im Stoss teils nicht messbar</small>'],
  ].map(([k, val]) => `<div class="fig"><div>${k}</div>${val}</div>`).join('');
}
$('dT').addEventListener('input', e => setTime(+e.target.value));
document.querySelectorAll('[data-cart]').forEach(b => b.addEventListener('click', () => {
  dCart = +b.dataset.cart; document.querySelectorAll('[data-cart]').forEach(x => x.setAttribute('aria-pressed', x === b)); renderDeriv();
}));

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
  const o = baseOpts(), c1 = css('--ink'), c2 = css('--w2'), ink = css('--ink-2'), muted = css('--muted');
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
  legend('lgME', [[shapeSVG.line(c1), 'Wagen 1'], [shapeSVG.line(c2), 'Wagen 2'], [shapeSVG.line(ink, true), 'Summe E_kin'], [shapeSVG.line(muted, true), 'E_kin + Federenergie (lang gestrichelt)']]);
  const ds = (label, f, color, extra = {}) => ({ label, data: out.map(p => ({ x: p.t, y: f(p) * 1000 })), borderColor: color, borderWidth: 2, pointRadius: 0, ...extra });
  chart('chME', { type: 'line', data: { datasets: [
      ds('Wagen 1', p => p.E1, c1), ds('Wagen 2', p => p.E2, c2), ds('Summe E_kin', p => p.E1 + p.E2, ink, { borderWidth: 3, borderDash: [2, 3] }),
      ds('E_kin + Federenergie', p => p.E1 + p.E2 + p.Ef, muted, { borderDash: [8, 4], borderWidth: 1.5 })] },
    options: { maintainAspectRatio: false, animation: false, parsing: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { ...o.tooltip, callbacks: { title: i => `t = ${fmt(i[0].raw.x, 3)} s`, label: i => `${i.dataset.label}: ${fmt(i.raw.y, 1)} mJ` } } },
      scales: { x: xs, y: { beginAtZero: true, grid: o.grid, ticks: { ...o.ticks, callback: deNum(0) }, border: { display: false }, title: o.axisTitle('E in mJ') } } } });
}
[mk, mm1, mm2].forEach(el => el.addEventListener('input', renderModel));

// ===================== Start =====================
updateSetup();
function renderAll() {
  renderOverviewCharts();
  renderDeriv();
  renderModel();
}
fetch('data/messungen.csv').then(r => r.ok ? r.text() : Promise.reject(new Error(r.status)))
  .then(text => {
    RUNS = parseRuns(text);
    renderTable(); renderTabs();
    const elastic = RUNS.filter(r => r.T === TYPES[0]);
    $('modelRuns').innerHTML = 'Messung ' + elastic.map(r => `<button class="run" data-mrun="${r.id}" aria-pressed="false">Nr. ${r.id}</button>`).join('');
    $('modelRuns').querySelectorAll('[data-mrun]').forEach(b => b.addEventListener('click', () => selectModelRun(b.dataset.mrun)));
    return document.fonts.ready.then(() => {
      renderOverviewCharts();
      selectDeriv(DEMO[0], false);
      if (elastic.length) selectModelRun(elastic[0].id);
    });
  })
  .catch(err => {
    console.error(err);
    $('massNote').innerHTML = '<b>Daten nicht geladen</b><span>Die Messdaten konnten nicht gelesen werden. Wird die Seite direkt vom Rechner geöffnet, bitte einen kleinen Webserver starten (siehe README).</span>';
  });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => RUNS.length && renderAll());
