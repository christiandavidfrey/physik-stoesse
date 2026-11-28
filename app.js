'use strict';
/* Stösse zweier Wagen: Auswertung und Darstellung.
   Daten: data/messungen.csv (eine Zeile pro Messung) und data/rohdaten/Messung_<nr>.csv (t_s, x1_m, x2_m).
   Wagen 1 = Wagen auf der Seite von Sensor 1, Wagen 2 = Wagen auf der Seite von Sensor 2. */

// ===================== Hilfen =====================
const $ = id => document.getElementById(id);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const ok = x => Number.isFinite(x);
const fmt = (x, d = 3) => ok(x) ? (Math.round(x * 10 ** d) / 10 ** d).toFixed(d).replace('-', '−').replace('.', ',') : '–';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DT = 0.005;           // 200 Hz
const X2_MIN = 0.199;       // Sensor 2 misst darunter nichts Sinnvolles
const RAIL2 = 0.01, RAIL1 = 1.19;   // Schienenenden (Anschläge) in Sensorkoordinaten, aus dem Abprallen in Messung 1 geschätzt
const X1_MAX = 1.021;       // Sensor 1 entsprechend: Wagen 1 näher als ~20 cm an Sensor 1 (Rohwert klebt bei 1,0226 m)
const SMOOTH = 31;          // Fensterbreite für Ableitungen (31 Punkte = 0,15 s)

document.querySelectorAll('[data-tex]').forEach(el => {
  try { katex.render(el.dataset.tex, el, { displayMode: true, throwOnError: false }); } catch (_) { el.textContent = el.dataset.tex; }
});

const TYPES = [
  { key: 'elastisch', label: 'Elastisch', puffer: 'Feder', color: '--c-el', shape: 'circle' },
  { key: 'teilelastisch', label: 'Teilelastisch', puffer: 'Schaumstoffkeil', color: '--c-in', shape: 'triangle' },
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
const EXPECTED_RATIO = { 'leicht→schwer': 541.4 / 291.9, 'schwer→leicht': 291.9 / 541.4, 'gleich (einer ruht)': 1, 'gleich (gegeneinander)': 1 };

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
      uns: (g(r, 'unsicher') || '').trim().split(/\s+/).filter(Boolean),
    };
    o.e = -(o.u1 - o.u2) / (o.v1 - o.v2);
    o.ratio = -(o.u1 - o.v1) / (o.u2 - o.v2);       // m2/m1, das die Impulserhaltung verlangt
    o.hasMass = ok(o.m1) && ok(o.m2);
    o.ph = /platzhalter/i.test(g(r, 'm_quelle') || '');   // vorläufige Massen, noch nicht gewogen
    if (o.hasMass) {
      o.p0 = o.m1 * o.v1 + o.m2 * o.v2; o.p1 = o.m1 * o.u1 + o.m2 * o.u2;
      o.E0 = .5 * o.m1 * o.v1 ** 2 + .5 * o.m2 * o.v2 ** 2; o.E1 = .5 * o.m1 * o.u1 ** 2 + .5 * o.m2 * o.u2 ** 2;
      o.dE = (o.E1 / o.E0 - 1) * 100;
    }
    return o;
  });
}

// ===================== Rohdaten & Ableitungen =====================
// Savitzky-Golay: quadratische Anpassung in einem Fenster von w Punkten. Im Innern symmetrisch;
// am Rand eines Messabschnitts (Datenbeginn/-ende, Lücke unter 0,20 m) wird das Fenster in den Abschnitt
// hineingeschoben und die Parabel am Randpunkt ausgewertet, damit v und a bis zum letzten Messpunkt reichen.
function sg(y, w, deriv) {
  const h = (w - 1) / 2, out = new Array(y.length).fill(null);
  let s = 0;
  while (s < y.length) {
    while (s < y.length && y[s] === null) s++;
    let e = s; while (e + 1 < y.length && y[e + 1] !== null) e++;
    const len = e - s + 1;
    if (s < y.length && len >= 9) {
      const ww = Math.min(w, len);
      for (let i = s; i <= e; i++) {
        const j0 = Math.max(s, Math.min(i - Math.floor(ww / 2), e - ww + 1));
        // Normalgleichungen für y ≈ c0 + c1·k + c2·k², k = j − i
        let S0 = 0, S1 = 0, S2 = 0, S3 = 0, S4 = 0, T0 = 0, T1 = 0, T2 = 0;
        for (let j = j0; j < j0 + ww; j++) { const k = j - i, k2 = k * k, v = y[j]; S0++; S1 += k; S2 += k2; S3 += k2 * k; S4 += k2 * k2; T0 += v; T1 += k * v; T2 += k2 * v; }
        const M = [[S0, S1, S2], [S1, S2, S3], [S2, S3, S4]], R = [T0, T1, T2];
        const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
        const D = det(M); if (!D) continue;
        const col = c => det(M.map((r, ri) => r.map((x, ci) => ci === c ? R[ri] : x))) / D;
        out[i] = deriv === 0 ? col(0) : deriv === 1 ? col(1) / DT : 2 * col(2) / DT ** 2;
      }
    }
    s = e + 1;
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
  rows.forEach(r => { t.push(+r[0]); const q = +r[1]; x1.push(q < X1_MAX ? q : null); const b = +r[2]; x2.push(b > X2_MIN ? b : null); });
  const v1 = sg(x1, SMOOTH, 1), v2 = sg(x2, SMOOTH, 1), a1 = sg(x1, SMOOTH, 2), a2 = sg(x2, SMOOTH, 2), s1 = sg(x1, SMOOTH, 0), s2 = sg(x2, SMOOTH, 0);
  const ic = Math.round(run.tc / DT);
  // Abstand der Messpunkte bei Berührung (hängt vom Puffer ab)
  let D = 0, n = 0;
  for (let i = ic - 2; i <= ic + 2; i++) if (x2[i] !== null && x1[i] !== null) { D += x1[i] - x2[i]; n++; }
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
    last = Math.max(RAIL2, last + (ok(run.u2) ? Math.min(lastV, 0) || run.u2 : lastV) * DT); x2f[i] = last;
  }
  // Lücke mitten in der Messung (Wagen fährt aus der Totzone wieder heraus, z. B. nach Abprallen am Schienenende):
  // vom Wiedereintritt rückwärts mit der dortigen Geschwindigkeit ergänzen, damit der Wagen nicht springt
  const backfill = (xs, xf, vs, sign, end) => {
    for (let k = 1; k < xs.length; k++) {
      if (xs[k] === null || xs[k - 1] !== null || xf[k - 1] === null) continue;
      const w = sign * Math.max(0, sign * (vs[k] ?? 0)); let b = xs[k];
      for (let j = k - 1; j >= 0 && xs[j] === null; j--) {
        b = sign > 0 ? Math.max(end, b - w * DT) : Math.min(end, b - w * DT);
        xf[j] = sign > 0 ? Math.max(xf[j], b) : Math.min(xf[j], b);
      }
    }
  };
  backfill(x2, x2f, v2, 1, RAIL2);
  // x1 ebenso lückenlos: in der Totzone von Sensor 1 mit der letzten bzw. ersten gemessenen Geschwindigkeit
  const X1_END = RAIL1, x1f = x1.slice();
  { let l = null, lv = 0;
    for (let i = 0; i < x1f.length; i++) {
      if (x1[i] !== null) { l = x1[i]; lv = v1[i] ?? lv; continue; }
      if (l === null) continue;
      l = Math.min(X1_END, l + Math.max(lv, 0) * DT); x1f[i] = l;
    }
    backfill(x1, x1f, v1, -1, X1_END);
    const j0 = x1f.findIndex(v => v !== null);
    if (j0 < 0) x1f.fill(1.0);
    else { const w = j0 > 0 ? Math.min(0, v1[j0] ?? 0) : 0; for (let i = j0 - 1; i >= 0; i--) x1f[i] = Math.min(1.08, x1f[i + 1] - w * DT); }   // Startposition in der Totzone unbekannt, ~14 cm vor dem Sensor
  }
  const s1f = sg(x1f, SMOOTH, 0), v1f = sg(x1f, SMOOTH, 1);
  // Wagen 2 darf Wagen 1 nie durchdringen: Abstand der Messpunkte mindestens D.
  // Inelastisch kleben die Wagen zusammen, Wagen 2 folgt also Wagen 1 im festen Abstand.
  const inel = run.T && run.T.key === 'inelastisch';
  for (let i = 0; i < x2f.length; i++) {
    if (x2[i] !== null || x2f[i] === null) continue;
    const lim = (s1f[i] ?? x1f[i]) - D;
    x2f[i] = inel && t[i] > run.tc ? lim : Math.min(x2f[i], lim);
  }
  // Startet Wagen 2 unter 0,20 m (fährt aus der Sensor-Totzone heraus), rückwärts mit der ersten gemessenen Geschwindigkeit ergänzen
  const i0 = x2f.findIndex(v => v !== null);
  if (i0 < 0) x2f.fill(0.28);
  else { const w0 = i0 > 0 ? Math.max(0, v2[i0] ?? 0) : 0; for (let i = i0 - 1; i >= 0; i--) x2f[i] = Math.max(0.14, x2f[i + 1] - w0 * DT); }
  const s2f = sg(x2f, SMOOTH, 0), v2f = sg(x2f, SMOOTH, 1);
  return rawCache[run.id] = { t, x1, x1f, s1f, v1f, x2, x2f, s2f, v2f, v1, v2, a1, a2, s1, s2, D, lo: t[lo], hi: t[hi], J, amax };
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

// ===================== Schalter: Simulation ein/aus =====================
let SIM_ON = true;
try { SIM_ON = localStorage.getItem('simOn') !== '0'; } catch (e) {}
function applySim() {
  document.body.classList.toggle('no-sim', !SIM_ON);
  document.querySelectorAll('[data-sim]').forEach(b => { b.setAttribute('aria-pressed', SIM_ON); b.textContent = 'Simulation: ' + (SIM_ON ? 'ein' : 'aus'); });
}
document.querySelectorAll('[data-sim]').forEach(b => b.addEventListener('click', () => {
  SIM_ON = !SIM_ON; try { localStorage.setItem('simOn', SIM_ON ? '1' : '0'); } catch (e) {}
  applySim(); if (SIM_ON) renderModel();
}));
applySim();

// ===================== Versuchsaufbau: gewählte Messung abspielen =====================
// Gefüllte Wagen: geglättete Messwerte (Savitzky-Golay, kein Rohrauschen). Umriss: Federmodell mit denselben Startwerten.
const SIM = { L: 1.2, cart: 0.16, buf: 0.018 };   // buf: Aufsatz je Wagen, beide Wagen tragen denselben
const ani = { run: null, raw: null, model: null, tA: 0, tB: 0, start: 0, speed: 1, playing: false, frozen: 0 };
function setupLoad(run, raw) {
  Object.assign(ani, { run, raw, tA: 0, tB: raw.t[raw.t.length - 1] });   // volle Messdauer
  fillSetupFigures();
  // erst abspielen, wenn die Grafik im Bild ist
  // läuft erst nach Klick auf Start
  ani.playing = false; ani.frozen = ani.tA; $('sPlay').textContent = 'Start';
}
function playSetup() { ani.start = performance.now(); ani.playing = true; ani.frozen = ani.tA; $('sPlay').textContent = 'Läuft …'; }
function setupTime() {
  if (!ani.playing) return ani.frozen;
  const t = ani.tA + (performance.now() - ani.start) / 1000 * ani.speed;
  if (t >= ani.tB) { ani.playing = false; ani.frozen = ani.tB; $('sPlay').textContent = 'Nochmals abspielen'; }
  return Math.min(t, ani.tB);
}
function fillSetupFigures() {
  const r = ani.run; if (!r) return;
  const m = ani.model, eM = m ? m.e : NaN;
  const set = (id, html) => { $(id).innerHTML = html; };
  set('r_v1', `${fmt(r.v1, 2)} <span>→</span> ${fmt(r.u1, 2)}<span class="u">m/s, Wagen 1</span>`);
  set('r_v2', `${fmt(r.v2, 2)} <span>→</span> ${fmt(r.u2, 2)}${r.uns.includes('v2_nach') ? '*' : ''}<span class="u">m/s, Wagen 2${r.uns.includes('v2_nach') ? ' · * v₂′ unsicher, nach dem Stoss nur kurz messbar' : ''}</span>`);
  set('r_ratio', `${fmt(r.ratio, 2)}<span class="u">erwartet ${fmt(EXPECTED_RATIO[r.aufbau], 2)} (${r.aufbau})</span>`);
}
document.querySelectorAll('[data-speed]').forEach(b => b.addEventListener('click', () => {
  ani.speed = +b.dataset.speed; document.querySelectorAll('[data-speed]').forEach(x => x.setAttribute('aria-pressed', x === b)); if (ani.playing) playSetup();
}));
$('sPlay').addEventListener('click', () => playSetup());

(function setupCanvas() {
  const canvas = $('setupCanvas'), ctx = canvas.getContext('2d');
  let W = 0, H = 0;
  function resize() { const r = canvas.getBoundingClientRect(), d = devicePixelRatio || 1; W = r.width; H = r.height; canvas.width = W * d; canvas.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0); }
  resize(); new ResizeObserver(resize).observe(canvas);
  const font = (w, s) => `${w} ${s}px Calibri, Carlito, sans-serif`;
  function arrow(x0, x1, y, col) {
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    const d = Math.sign(x1 - x0) || 1; ctx.beginPath(); ctx.moveTo(x1 + d * 2, y); ctx.lineTo(x1 - d * 7, y - 5); ctx.lineTo(x1 - d * 7, y + 5); ctx.fill();
  }
  function draw() {
    if ($('viewDetail').hidden) return;
    const run = ani.run, raw = ani.raw; if (!run || !raw || !W) return;
    const k = Math.min(1, H / 250), padL = 64 * Math.max(.7, k), padR = 64 * Math.max(.7, k), sc = (W - padL - padR) / SIM.L, X = x => padL + x * sc;
    const railY = H - 52 * k, bodyH = 30 * k, wr = 5 * k, bodyTop = railY - 2 * wr - bodyH;
    const muted = css('--muted'), ink = css('--ink'), ink2 = css('--ink-2'), rail = css('--rail'), raised = css('--raised');
    const col1 = css('--ink'), col2 = css('--w2');
    const C = SIM.cart, gap = C + 2 * SIM.buf;
    // Sensorwert → Wagenmitte: x2 misst die Heckplatte links, bei Berührung ist x1 − x2 = D
    const off1 = raw.D - C / 2 - gap, c1of = x => x - off1, c2of = x => x + C / 2;
    const t = setupTime(), i = Math.min(raw.t.length - 1, Math.max(0, Math.round(t / DT)));
    const x1 = raw.s1f[i] ?? raw.x1f[i];
    let x2 = raw.s2f[i] ?? raw.x2f[i];
    // keine Überlappung: ungemessen mindestens Kontaktabstand, gemessen dürfen nur die Puffer gestaucht werden
    x2 = Math.min(x2, x1 - raw.D + (raw.x2[i] === null ? 0 : 2 * SIM.buf));
    const p = { c1: c1of(x1), c2: c2of(x2), u1: raw.v1f[i] ?? 0, u2: raw.v2f[i] ?? 0 };
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
    // Zeit und Stossphase
    ctx.font = font(700, 15); ctx.fillStyle = ink; ctx.textAlign = 'left';
    ctx.fillText(`t = ${fmt(t, 2)} s`, 4, 18);
    // Ultraschallsensoren: links Sensor 2 (misst Wagen 2), rechts Sensor 1 (misst Wagen 1)
    const plateTop = bodyTop - 40 * k, beam = plateTop + 12 * k, sw = 22 * k, sh = 18 * k;
    ctx.fillStyle = ink2;
    ctx.beginPath(); ctx.roundRect(X(0) - sw - 10, beam - sh / 2, sw, sh, 3); ctx.fill();
    ctx.beginPath(); ctx.roundRect(X(SIM.L) + 10, beam - sh / 2, sw, sh, 3); ctx.fill();
    ctx.fillRect(X(0) - sw / 2 - 11, beam + sh / 2, 2, railY - beam - sh / 2); ctx.fillRect(X(SIM.L) + sw / 2 + 9, beam + sh / 2, 2, railY - beam - sh / 2);
    ctx.fillStyle = muted; ctx.font = font(500, 13); ctx.textAlign = 'center';
    ctx.fillText('Sensor 2', X(0) - sw / 2 - 10, beam - sh / 2 - 8); ctx.fillText('Sensor 1', X(SIM.L) + sw / 2 + 10, beam - sh / 2 - 8);
    // Wagen
    const [w1, w2] = defaultMasses(run);   // nur für die Höhe des Zusatzgewichts (leicht/schwer)
    const by = bodyTop + bodyH * .2, bh = bodyH * .6, bl = SIM.buf * sc, ti = TYPES.indexOf(run.T);
    function buffer(face, dir, col) {   // dir = −1: Aufsatz zeigt nach links, +1: nach rechts
      const tip = face + dir * bl, a = Math.min(face, tip), b = Math.max(face, tip);
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.6;
      if (ti === 0) { ctx.beginPath(); ctx.moveTo(face, by + bh / 2); const n = 5; for (let j = 1; j <= n; j++) ctx.lineTo(face + dir * bl * j / n, by + (j % 2 ? 0 : bh)); ctx.stroke(); ctx.fillRect(dir < 0 ? tip - 2 : tip, by, 2, bh); }
      else if (ti === 1) { ctx.globalAlpha = .55; ctx.beginPath(); ctx.moveTo(face, by - 2); ctx.lineTo(tip, by + bh * .25); ctx.lineTo(tip, by + bh * .75); ctx.lineTo(face, by + bh + 2); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; }
      else { ctx.fillRect(a, by - 2, b - a, bh + 4); ctx.strokeStyle = raised; ctx.lineWidth = 1; for (let yy = by; yy < by + bh; yy += 4) { ctx.beginPath(); ctx.moveTo(a, yy); ctx.lineTo(b, yy + 3); ctx.stroke(); } }
    }
    function cart(c, col, label, mRel, mText, rear) {   // rear = −1: Heck links, +1: Heck rechts
      const x = X(c - C / 2), w = C * sc;
      ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(x, bodyTop, w, bodyH, 4); ctx.fill();
      [x + w * .2, x + w * .8].forEach(cx => { ctx.beginPath(); ctx.arc(cx, railY - wr, wr, 0, 7); ctx.fill(); });
      const wh = (4 + 24 * mRel / Math.max(w1, w2)) * k;   // Zusatzgewicht: schwerer Wagen höher
      ctx.fillStyle = ink2; ctx.globalAlpha = .85; ctx.beginPath(); ctx.roundRect(x + w * .3, bodyTop - wh, w * .45, wh, 2); ctx.fill(); ctx.globalAlpha = 1;
      // Reflektorplatte am Heck, ragt nach oben
      ctx.fillStyle = col; ctx.fillRect(rear < 0 ? x : x + w - 5, plateTop, 5, bodyTop - plateTop + 2);
      ctx.fillStyle = raised; ctx.font = font(600, w > 70 ? 16 : 11); ctx.textAlign = 'center'; ctx.fillText(label, x + w / 2, bodyTop + bodyH / 2 + (w > 70 ? 5 : 4));
      if (w > 70) { ctx.fillStyle = mText.miss ? muted : ink; ctx.font = font(mText.miss ? 500 : 600, 13); ctx.fillText(mText.s, x + w * .52, bodyTop - wh - 5); }
      buffer(rear < 0 ? x + w : x, -rear, col);
    }
    function ghost(c, col) {   // Modell als gestrichelter Umriss
      const x = X(c - C / 2), w = C * sc;
      ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = col; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.roundRect(x, bodyTop - 4, w, bodyH + 8, 5); ctx.stroke(); ctx.restore();
    }
    // Ultraschall zur Heckplatte des jeweiligen Wagens
    ctx.setLineDash([4, 4]); ctx.strokeStyle = muted; ctx.lineWidth = 1;
    const plate2 = X(p.c2 - C / 2), plate1 = X(p.c1 + C / 2);
    ctx.beginPath(); ctx.moveTo(X(0) - 10, beam); ctx.lineTo(plate2, beam); ctx.moveTo(X(SIM.L) + 10, beam); ctx.lineTo(plate1, beam); ctx.stroke(); ctx.setLineDash([]);
    const mt = (m, n) => ok(m) ? { s: fmt(m * 1000, 1) + ' g' + (run.ph ? ' (vorläufig)' : ''), miss: run.ph } : { s: `m${n} fehlt`, miss: true };
    cart(p.c2, col2, 'W2', w2, mt(run.m2, '₂'), -1);
    cart(p.c1, col1, 'W1', w1, mt(run.m1, '₁'), 1);
    // Modell: nur im simulierten Zeitfenster
    const M = ani.model;
    if (SIM_ON && M && t >= M.t0 && t <= M.t1) {
      const q = M.out[Math.min(M.out.length - 1, Math.round((t - M.t0) / DT))];
      const cl = c => Math.min(SIM.L - C / 2, Math.max(C / 2, c));   // Modell kennt keine Schienenenden
      ghost(cl(c2of(q.x2)), muted); ghost(cl(c1of(q.x1)), muted);
    }
    // Geschwindigkeitspfeile oben (gemessen)
    const ay = 16 * k + 8;
    [[p.c1, p.u1, col1, 'v₁'], [p.c2, p.u2, col2, 'v₂']].forEach(([c, v, col, lab]) => {
      const x0 = X(c); ctx.font = font(600, 14); ctx.fillStyle = col; ctx.textAlign = 'center';
      if (Math.abs(v) < 0.01) { if (W > 700) ctx.fillText(`${lab} = 0`, x0, ay + 4); return; }
      arrow(x0, x0 + v * 140 * Math.max(.6, k), ay + 14 * k, col);
      ctx.fillText(W > 700 ? `${lab} = ${fmt(v, 2)} m/s` : lab, x0, ay);
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

// Markiert, ab wann Wagen 2 näher als 20 cm am Sensor ist und nicht mehr gemessen wird
const cutPlugin = {
  id: 'cut',
  afterDatasetsDraw(chart, _, o) {
    if (!o || !o.ts || !o.ts.length) return;
    const { ctx, chartArea: a, scales: { x } } = chart;
    ctx.save(); ctx.strokeStyle = o.color; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
    for (const t of o.ts) { const q = x.getPixelForValue(t); if (q < a.left || q > a.right) continue; ctx.beginPath(); ctx.moveTo(q, a.top); ctx.lineTo(q, a.bottom); ctx.stroke(); }
    ctx.setLineDash([]); ctx.restore();
    const px = x.getPixelForValue(o.ts[0]);
    if (px < a.left || px > a.right) return;
    ctx.save();
    if (o.label) {
      ctx.font = '600 13px Calibri, Carlito, sans-serif'; ctx.textBaseline = 'top';
      const lines = o.label, w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 14, h = lines.length * 16 + 8;
      const right = px + 6 + w < a.right, bx = right ? px + 6 : px - 6 - w, by = a.top + 2;
      ctx.fillStyle = o.bg; ctx.strokeStyle = o.color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(bx, by, w, h, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = o.text; ctx.textAlign = 'left';
      lines.forEach((l, i) => { ctx.font = (i ? '400 ' : '700 ') + '13px Calibri, Carlito, sans-serif'; ctx.fillText(l, bx + 7, by + 5 + i * 16); });
    }
    ctx.restore();
  },
};
Chart.register(cutPlugin);

// Schraffiert den Bereich unter 0,20 m: dort messen die Ultraschallsensoren nicht mehr
const zonePlugin = {
  id: 'zone',
  beforeDatasetsDraw(chart, _, o) {
    if (!o || !ok(o.below)) return;
    const { ctx, chartArea: a, scales: { y } } = chart;
    const top = Math.max(a.top, y.getPixelForValue(o.below)); if (top >= a.bottom) return;
    ctx.save(); ctx.beginPath(); ctx.rect(a.left, top, a.right - a.left, a.bottom - top); ctx.clip();
    ctx.strokeStyle = o.color; ctx.lineWidth = 1;
    for (let x = a.left - (a.bottom - top); x < a.right; x += 7) { ctx.beginPath(); ctx.moveTo(x, a.bottom); ctx.lineTo(x + (a.bottom - top), top); ctx.stroke(); }
    ctx.restore();
  },
};
Chart.register(zonePlugin);

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
let ORDER = [];   // Tabellenreihenfolge: nach Stossart, dann Aufbau
function renderTable() {
  const missing = '<span class="missing">fehlt</span>';
  ORDER = [...RUNS].sort((a, b) => TYPES.indexOf(a.T) - TYPES.indexOf(b.T) || AUFBAU.indexOf(a.aufbau) - AUFBAU.indexOf(b.aufbau) || parseFloat(a.id) - parseFloat(b.id));
  const U = (r, key, v) => r.uns.includes(key) ? `<span class="uns" title="unsicher: Wagen 2 nach dem Stoss nur kurz messbar">${fmt(v)}*</span>` : fmt(v);
  $('table').querySelector('tbody').innerHTML = TYPES.map(T => {
    const rs = ORDER.filter(r => r.T === T); if (!rs.length) return '';
    return `<tr class="grp"><th colspan="13"><span class="swatch" style="background:var(${T.color})"></span>${T.label}<small>beide Wagen mit ${T.puffer}, ${rs.length} Messungen</small></th></tr>` + rs.map(r => `<tr data-run="${r.id}" tabindex="0" title="Stoss ${r.id} öffnen">
    <td>${r.id}</td><td>${r.aufbau}</td>
    <td>${U(r, 'v1', r.v1)}</td><td>${U(r, 'v2', r.v2)}</td><td>${U(r, 'v1_nach', r.u1)}</td><td>${U(r, 'v2_nach', r.u2)}</td>
    <td class="calc">${fmt(Math.max(r.e, 0), 2)}</td><td class="calc">${fmt(r.ratio, 2)}</td>
    <td>${ok(r.m1) ? (r.ph ? `<span class="ph">${fmt(r.m1, 4)}*</span>` : fmt(r.m1, 4)) : missing}</td><td>${ok(r.m2) ? (r.ph ? `<span class="ph">${fmt(r.m2, 4)}*</span>` : fmt(r.m2, 4)) : missing}</td>
    <td class="calc">${fmt(r.p0)}</td><td class="calc">${fmt(r.p1)}</td><td class="calc">${fmt(r.dE, 1)}</td></tr>`).join('');
  }).join('');
  $('table').querySelectorAll('tbody tr[data-run]').forEach(tr => {
    tr.addEventListener('click', () => openRun(tr.dataset.run));
    tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRun(tr.dataset.run); } });
  });
  const PH = RUNS.some(r => r.ph);
  $('massNote').style.display = RUNS.every(r => r.hasMass) && !PH ? 'none' : '';
  if (PH) $('massNote').innerHTML = '<b>Massen vorläufig.</b> Leicht 100 g, schwer 200 g sind Platzhalter (mit * markiert), bis die gewogenen Werte da sind. Das Verhältnis 1 : 2 passt zu dem, was die Impulserhaltung aus euren Geschwindigkeiten verlangt (Spalte m₂/m₁, Mittel ≈ 1,9); die absoluten Werte sind geschätzt.';
}

function renderOverviewCharts() {
  $('massFact').style.display = RUNS.every(r => r.hasMass) && !RUNS.some(r => r.ph) ? 'none' : '';
  if (RUNS.some(r => r.ph)) $('massFact').innerHTML = 'Massen <b>vorläufig</b>';
}

// ===================== Von x(t) zu v(t) und a(t): beide Wagen =====================
let dRun = null, dWin = [0, 5];
async function selectDeriv(id) {
  const run = RUNS.find(r => r.id === id); if (!run) return;
  dRun = run;
  $('dSub').textContent = `Stoss ${run.id}: ${run.T.label}, beide Wagen mit ${run.T.puffer}, ${AUFBAU_TEXT[run.aufbau] || run.aufbau}`;
  const raw = await loadRaw(run); if (dRun !== run) return;
  dWin = [0, raw.t[raw.t.length - 1]];   // volle Messdauer, 0 bis 5 s
  renderDeriv();
}
function renderDeriv() {
  const run = dRun, raw = run && rawCache[run.id]; if (!raw) return;
  const o = baseOpts(), c1 = css('--ink'), c2 = css('--w2');
  const inWin = arr => arr.map((y, i) => ({ x: raw.t[i], y })).filter(p => p.x >= dWin[0] - 1e-9 && p.x <= dWin[1] + 1e-9);
  const xs = { type: 'linear', min: dWin[0], max: dWin[1], grid: o.grid, ticks: { ...o.ticks, stepSize: 0.5, callback: deNum(1) } };
  const tip = (unit, d) => ({ ...o.tooltip, callbacks: { title: i => `t = ${fmt(i[0].raw.x, 3)} s`, label: i => `${i.dataset.label}: ${fmt(i.raw.y, d)} ${unit}` } });
  const common = { maintainAspectRatio: false, animation: false, parsing: false, interaction: { mode: 'nearest', axis: 'x', intersect: false } };
  const yAx = (title, d, extra = {}) => ({ afterFit: ax => { ax.width = 64; }, grace: '8%', grid: o.grid, ticks: { ...o.ticks, callback: deNum(d) }, border: { display: false }, title: o.axisTitle(title), ...extra });
  const pts = (label, arr, col) => ({ label, data: inWin(arr), backgroundColor: col + 'aa', borderWidth: 0, pointRadius: 1.6, pointHoverRadius: 3 });
  const ln = (label, arr, col) => ({ label, data: inWin(arr), borderColor: col, borderWidth: 2, pointRadius: 0, pointHoverRadius: 3 });
  // Zeitabschnitte, in denen ein Wagen in der Totzone seines Sensors ist (mind. 0,05 s); nur als Text über den Diagrammen
  const gaps = arr => { const g = []; let i = 0;
    while (i < arr.length) { if (arr[i] !== null) { i++; continue; } let k = i; while (k < arr.length && arr[k] === null) k++;
      if (k - i >= 10) { const prev = g[g.length - 1]; if (prev && i - prev[1] < 60) prev[1] = k - 1; else g.push([i, k - 1]); } i = k; }
    return g.map(([p, q]) => `${fmt(raw.t[p], 2)} bis ${fmt(raw.t[q], 2)} s`); };
  const g1 = gaps(raw.x1), g2 = gaps(raw.x2);
  const ext = [];
  const parts = [];
  if (g2.length) parts.push(`Wagen 2 von ${g2.join(' und von ')}`);
  if (g1.length) parts.push(`Wagen 1 von ${g1.join(' und von ')}`);
  $('cutNote').hidden = !parts.length;
  if (parts.length) $('cutNote').innerHTML = `<span><b>Gilt für alle drei Diagramme:</b> Ist ein Wagen näher als etwa 20 cm an seinem Sensor, misst dieser nicht (Wagen 2: x unter 0,20 m, Wagen 1: x über 1,02 m). In dieser Messung fehlen deshalb ${parts.join(', ')}. Dort enden die Kurven. Die Werte direkt am Rand einer Lücke (0,07 s) sind mit einem einseitigen Glättungsfenster berechnet und etwas unsicherer.</span>`;
  chart('chX', { type: 'scatter', data: { datasets: [pts('Wagen 1', raw.x1, c1), pts('Wagen 2', raw.x2, c2)] },
    options: { ...common, plugins: { legend: { display: false }, tooltip: tip('m', 3) }, scales: { x: xs, y: yAx('x in m', 2, { min: 0, max: 1.2, grace: 0 }) } } });
  legend('lgD', [[shapeSVG.line(c1), 'Wagen 1 (Seite Sensor 1)'], [shapeSVG.line(c2), 'Wagen 2 (Seite Sensor 2)']].concat(ext.length ? [[shapeSVG.line(c2, true), 'Wagen 2 nicht gemessen, angenommen v₂′ aus Fit']] : []));
  chart('chV', { type: 'line', data: { datasets: [ln('Wagen 1', raw.v1, c1), ln('Wagen 2', raw.v2, c2)].concat(ext.length ? [{ label: 'Wagen 2 angenommen', data: ext, borderColor: c2, borderDash: [6, 4], borderWidth: 2, pointRadius: 0, pointHoverRadius: 3 }] : []) },
    options: { ...common, plugins: { legend: { display: false }, tooltip: tip('m/s', 3) }, scales: { x: xs, y: yAx('v in m/s', 2) } } });
  chart('chA', { type: 'line', data: { datasets: [ln('Wagen 1', raw.a1, c1), ln('Wagen 2', raw.a2, c2)] },
    options: { ...common, plugins: { legend: { display: false }, tooltip: tip('m/s²', 2) }, scales: { x: { ...xs, title: o.axisTitle('t in s') }, y: yAx('a in m/s²', 1) } } });
  // Kraftstoss je Wagen: m · Fläche unter a(t) im Stoss gegen Δp = m·Δv aus den Fits
  const lo = Math.round(raw.lo / DT), hi = Math.round(raw.hi / DT);
  const area = a => { let J = 0; for (let j = lo; j < hi; j++) { if (a[j] === null || a[j + 1] === null) return NaN; J += (a[j] + a[j + 1]) / 2 * DT; } return J; };
  const J1 = area(raw.a1), J2 = area(raw.a2);
  const dt = raw.hi - raw.lo, M = run.hasMass;
  const cell = (k, J, dv, m) => `<div class="fig"><div>${k}</div>${ok(J) ? (M ? `<strong>${fmt(m * J, 3)} N·s</strong><small>Δp aus Fits ${fmt(m * dv, 3)} kg·m/s</small>` : `<strong>${fmt(J)} m/s</strong><small>Δv aus Fits ${fmt(dv)} m/s</small>`) : `<strong>–</strong><small>im Stoss teils nicht messbar (unter 0,20 m)</small>`}</div>`;
  $('dFigures').innerHTML = cell('Kraftstoss ∫F dt, Wagen 1', J1, run.u1 - run.v1, run.m1) + cell('Kraftstoss ∫F dt, Wagen 2', J2, run.u2 - run.v2, run.m2)
    + `<div class="fig"><div>Stossdauer Δt</div><strong>${fmt(dt, 2)} s</strong><small>solange |a₁| über 10 % des Maximums</small></div>`
    + (M ? `<div class="fig"><div>Mittlere Kraft F̄ = Δp₁/Δt</div><strong>${fmt(Math.abs(run.m1 * (run.u1 - run.v1)) / dt, 2)} N</strong><small>grösste Kraft ${fmt(Math.abs(run.m1 * raw.amax), 2)} N (Wagen 1)</small></div>`
         : `<div class="fig"><div>Grösste Beschleunigung Wagen 1</div><strong>${fmt(Math.abs(raw.amax), 1)} m/s²</strong><small>im Stoss</small></div>`);
}

// ===================== Federmodell =====================
const mk = $('mk'), mc = $('mc'), mm1 = $('mm1'), mm2 = $('mm2');
function defaultMasses(run) {
  if (run.hasMass) return [run.m1, run.m2];
  return { 'leicht→schwer': [0.2919, 0.5414], 'schwer→leicht': [0.5414, 0.2919] }[run.aufbau] || [0.2919, 0.2919];
}
async function selectModelRun(id) {
  const run = RUNS.find(r => r.id === id); if (!run) return;
  modelRun = run;
  const [a, b] = defaultMasses(run); mm1.value = a; mm2.value = b;
  $('modelMassNote').style.display = run.hasMass && !run.ph ? 'none' : '';
  if (run.ph) $('modelMassNote').textContent = 'Massen vorläufig (Platzhalter 100 g / 200 g), bis die gewogenen Werte in der CSV stehen.';
  await loadRaw(run); renderModel();
}
// Modellparameter je Stossart: k aus der gemessenen Stossdauer (Halbschwingung, 10-%-Schwelle ≈ 0,936·T/2),
// elastisch reine Feder (Berkeley-Madonna-Modell), teilelastisch Feder + Dämpfung c passend zur gemessenen Stosszahl,
// inelastisch Feder bis zur grössten Stauchung, danach kleben die Wagen (Klett) und fahren gemeinsam weiter.
function modelParams(run, raw, m1, m2) {
  const mu = m1 * m2 / (m1 + m2), dt = Math.max(0.05, raw.hi - raw.lo);
  const k = mu * (0.936 * Math.PI / dt) ** 2;
  const mode = run.T.key === 'inelastisch' ? 'stick' : 'spring';
  let c = 0;
  if (run.T.key === 'teilelastisch' && ok(run.e)) {
    const target = Math.min(0.99, Math.max(0.01, run.e));
    let lo = 0, hi = 4 * Math.sqrt(k * mu);
    for (let it = 0; it < 22; it++) { const mid = (lo + hi) / 2; (simulate(run, raw, k, m1, m2, mid, 'spring', true).e > target) ? lo = mid : hi = mid; }
    c = (lo + hi) / 2;
  }
  return { k, c, mode };
}
function simulate(run, raw, k, m1, m2, c = 0, mode = 'spring', quick = false) {
  const t0 = Math.max(0, run.tc - 0.3), t1 = raw.t[raw.t.length - 1], i0 = Math.round(t0 / DT);
  const avg = (arr, i) => { let s = 0, n = 0; for (let j = i - 4; j <= i + 4; j++) if (arr[j] !== null && arr[j] !== undefined) { s += arr[j]; n++; } return s / n; };
  let x1 = avg(raw.x1f, i0), x2 = avg(raw.x2, i0), v1 = run.v1, v2 = run.v2;
  if (!ok(x2)) x2 = raw.x2f[i0];
  const h = 1e-4, every = Math.round(DT / h), out = [];
  let stuck = false, touched = false, after = null;
  for (let s = 0, t = t0; t <= t1; s++, t += h) {
    // Feder F = k·Δ wie im Berkeley-Madonna-Modell; optional Dämpfung c·dΔ/dt (zieht nie, nur Druck)
    const d = raw.D - (x1 - x2);
    if (d > 0) touched = true;
    if (mode === 'stick' && !stuck && d > 0 && v2 - v1 <= 0) { const v = (m1 * v1 + m2 * v2) / (m1 + m2); v1 = v2 = v; stuck = true; }
    const F = stuck ? 0 : d > 0 ? Math.max(0, k * d + c * (v2 - v1)) : 0;
    if (!quick && s % every === 0) out.push({ t, x1, x2, E1: .5 * m1 * v1 * v1, E2: .5 * m2 * v2 * v2, Ef: d > 0 && !stuck ? .5 * k * d * d : 0 });
    v1 += F / m1 * h; v2 -= F / m2 * h; x1 += v1 * h; x2 += v2 * h;   // semi-implizites Euler-Verfahren
    if (!after && touched && (d <= 0 || stuck)) after = [v1, v2];
    if (quick && after) break;   // für die Suche nach c reicht der Stoss selbst
    // Schienenenden: Wagen bleibt am Anschlag stehen (zusammengeklebte Wagen beide)
    if (x2 < RAIL2) { x2 = RAIL2; v2 = 0; if (stuck) v1 = 0; }
    if (x1 > RAIL1) { x1 = RAIL1; v1 = 0; if (stuck) v2 = 0; }
  }
  const [w1, w2] = after || [v1, v2];
  const e = -(w1 - w2) / (run.v1 - run.v2);   // Stosszahl, die das Modell direkt nach dem Stoss liefert
  return { out, t0, t1, e: Math.max(0, e), u1: w1, u2: w2 };
}
function renderModel() {
  const run = modelRun, raw = run && rawCache[run.id]; if (!raw) return;
  const m1 = +mm1.value, m2 = +mm2.value, prm = modelParams(run, raw, m1, m2), k = prm.k, c = prm.c;
  $('o_k').textContent = fmt(k, 0); $('o_c').textContent = fmt(c, 2); $('o_mm1').textContent = fmt(m1, 4); $('o_mm2').textContent = fmt(m2, 4);
  const o = baseOpts(), c1 = css('--ink'), c2 = css('--w2'), ink = css('--ink-2'), muted = css('--muted');
  const sim = simulate(run, raw, k, m1, m2, c, prm.mode), { out, t0, t1 } = sim;
  if (ani.run === run) { ani.model = sim; fillSetupFigures(); }
  $('modelE').innerHTML = `Stosszahl gemessen <b>${fmt(Math.max(run.e, 0), 2)}</b>, im Modell <b>${fmt(sim.e, 2)}</b>. Endgeschwindigkeiten im Modell: v₁′ = ${fmt(sim.u1, 2)} m/s, v₂′ = ${fmt(sim.u2, 2)} m/s (gemessen ${fmt(run.u1, 2)} und ${fmt(run.u2, 2)} m/s).`;
  const meas = arr => arr.map((y, i) => (y === null || i % 2) ? null : { x: raw.t[i], y }).filter(Boolean);
  const xs = { type: 'linear', min: 0, max: raw.t[raw.t.length - 1], grid: o.grid, ticks: { ...o.ticks, stepSize: 0.5, callback: deNum(1) }, title: o.axisTitle('t in s') };
  // Modell kennt keine Schienenenden: Linie endet, wo der Wagen die Schiene (0 bis 1,2 m) verlässt
  const onRail = (arr, key) => { const r = []; for (const p of arr) { if (p[key] < 0 || p[key] > 1.2) break; r.push({ x: p.t, y: p[key] }); } return r; };
  legend('lgMX', [[shapeSVG.dots(c1), 'Wagen 1 gemessen'], [shapeSVG.line(c1), 'Wagen 1 Modell'], [shapeSVG.dots(c2), 'Wagen 2 gemessen'], [shapeSVG.line(c2), 'Wagen 2 Modell']]);
  chart('chMX', { type: 'scatter', data: { datasets: [
      { label: 'Wagen 1 gemessen', data: meas(raw.x1), backgroundColor: c1 + '99', borderWidth: 0, pointRadius: 1.5 },
      { label: 'Wagen 2 gemessen', data: meas(raw.x2), backgroundColor: c2 + '99', borderWidth: 0, pointRadius: 1.5 },
      { label: 'Wagen 1 Modell', type: 'line', data: onRail(out, 'x1'), borderColor: c1, borderWidth: 2, pointRadius: 0 },
      { label: 'Wagen 2 Modell', type: 'line', data: onRail(out, 'x2'), borderColor: c2, borderWidth: 2, pointRadius: 0 }] },
    options: { maintainAspectRatio: false, animation: false, parsing: false,
      plugins: { legend: { display: false }, tooltip: { ...o.tooltip, callbacks: { title: i => `t = ${fmt(i[0].raw.x, 3)} s`, label: i => `${i.dataset.label}: ${fmt(i.raw.y)} m` } } },
      scales: { x: xs, y: { min: 0, max: 1.2, grid: o.grid, ticks: { ...o.ticks, callback: deNum(2) }, border: { display: false }, title: o.axisTitle('x in m') } } } });
  legend('lgME', [[shapeSVG.line(c1), 'Wagen 1'], [shapeSVG.line(c2), 'Wagen 2'], [shapeSVG.line(ink, true), 'Summe E_kin'], [shapeSVG.line(muted, true), 'E_kin + Federenergie (lang gestrichelt)']]);
  const ds = (label, f, color, extra = {}) => ({ label, data: out.map(p => ({ x: p.t, y: f(p) * 1000 })), borderColor: color, borderWidth: 2, pointRadius: 0, ...extra });
  chart('chME', { type: 'line', data: { datasets: [
      ds('Wagen 1', p => p.E1, c1), ds('Wagen 2', p => p.E2, c2), ds('Summe E_kin', p => p.E1 + p.E2, ink, { borderWidth: 3, borderDash: [2, 3] }),
      ds('E_kin + Federenergie', p => p.E1 + p.E2 + p.Ef, muted, { borderDash: [8, 4], borderWidth: 1.5 })] },
    options: { maintainAspectRatio: false, animation: false, parsing: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { ...o.tooltip, callbacks: { title: i => `t = ${fmt(i[0].raw.x, 3)} s`, label: i => `${i.dataset.label}: ${fmt(i.raw.y, 1)} mJ` } } },
      scales: { x: xs, y: { beginAtZero: true, grace: '8%', grid: o.grid, ticks: { ...o.ticks, callback: deNum(0) }, border: { display: false }, title: o.axisTitle('E in mJ') } } } });
}
[mk, mc, mm1, mm2].forEach(el => el.addEventListener('input', renderModel));

// ===================== Ansichten: Tabelle oder ein einzelner Stoss =====================
let SEL = null, lastRun = null;
function openRun(id) { history.pushState(null, '', '#m' + id); route(true); }
function showTable() { history.pushState(null, '', location.pathname + location.search); route(true); }
function route(nav) {
  const id = (location.hash.match(/^#m([\d.]+)$/) || [])[1], run = RUNS.find(r => r.id === id);
  const tabs = !run && location.hash === '#tabellen';
  $('viewTables').hidden = !tabs;
  if (tabs) { $('viewOverview').hidden = true; $('viewDetail').hidden = true; ani.playing = false; document.documentElement.classList.remove('in-detail'); renderTables(); $('tabellen').scrollIntoView({ block: 'start' }); return; }
  $('viewOverview').hidden = !!run; $('viewDetail').hidden = !run;
  document.documentElement.classList.toggle('in-detail', !!run);
  if (run) {
    selectRun(run.id);
    if (nav) $('viewDetail').scrollIntoView({ block: 'start' });
  } else {
    ani.playing = false;
    if (nav) {
      const tr = lastRun && document.querySelector(`#table tr[data-run="${lastRun}"]`);
      if (tr) { tr.scrollIntoView({ block: 'center' }); tr.focus({ preventScroll: true }); } else $('viewOverview').scrollIntoView({ block: 'start' });
    }
  }
}
addEventListener('popstate', () => route(true));
// Kopfleiste: Home und Sprungmarken, auch aus der Einzelansicht heraus
document.querySelectorAll('.topbar [data-nav]').forEach(el => el.addEventListener('click', ev => {
  ev.preventDefault();
  if (el.dataset.nav === 'tabellen') { if (location.hash !== '#tabellen') history.pushState(null, '', '#tabellen'); route(true); return; }
  if ($('viewOverview').hidden) { history.pushState(null, '', location.pathname + location.search); route(false); }
  const id = el.dataset.nav, target = id === 'top' ? null : document.getElementById(id);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' }); else scrollTo({ top: 0, behavior: 'smooth' });
}));
$('backBtn').addEventListener('click', showTable);
async function selectRun(id) {
  const run = RUNS.find(r => r.id === id); if (!run) return;
  SEL = run; lastRun = id;
  document.querySelectorAll('#viewDetail details[open]').forEach(d => { d.open = false; });
  const k = ORDER.indexOf(run), prev = ORDER[k - 1], next = ORDER[k + 1];
  $('dhTitle').textContent = `Stoss ${run.id}`;
  $('dhInfo').innerHTML = `${run.T.label}, beide Wagen mit ${run.T.puffer}, ${AUFBAU_TEXT[run.aufbau] || run.aufbau}. ${run.hasMass ? `m₁ = ${fmt(run.m1 * 1000, 1)} g, m₂ = ${fmt(run.m2 * 1000, 1)} g${run.ph ? ' <span class="missing">(vorläufig)</span>' : ''}` : '<span class="missing">Massen fehlen noch</span>'}`;
  const nb = (b, r, txt) => { b.disabled = !r; b.textContent = r ? txt(r.id) : txt('').trim(); b.onclick = r ? () => { history.replaceState(null, '', '#m' + r.id); selectRun(r.id); } : null; };
  nb($('prevBtn'), prev, i => `‹ ${i}`); nb($('nextBtn'), next, i => `${i} ›`);
  const raw = await loadRaw(run); if (SEL !== run) return;
  ani.model = null; ani.run = run; ani.raw = raw;
  await selectModelRun(id);
  setupLoad(run, raw);
  selectDeriv(id);
}

// ===================== Start =====================
function renderAll() {
  renderOverviewCharts();
  renderDeriv();
  renderModel();
}
fetch('data/messungen.csv').then(r => r.ok ? r.text() : Promise.reject(new Error(r.status)))
  .then(text => {
    RUNS = parseRuns(text);
    renderTable();
    return document.fonts.ready.then(() => {
      renderOverviewCharts();
      route(false);
    });
  })
  .catch(err => {
    console.error(err);
    $('massNote').innerHTML = '<b>Daten nicht geladen</b><span>Die Messdaten konnten nicht gelesen werden. Wird die Seite direkt vom Rechner geöffnet, bitte einen kleinen Webserver starten (siehe README).</span>';
  });
// ===================== Fotogalerie =====================
(function gallery() {
  const g = document.querySelector('.gal'); if (!g) return;
  const track = g.querySelector('.gal-track'), slides = [...track.children], thumbs = [...g.querySelectorAll('.gal-thumbs button')];
  const prev = g.querySelector('.gal-prev'), next = g.querySelector('.gal-next');
  const cur = () => Math.round(track.scrollLeft / (track.clientWidth + 16));
  const n = slides.length, count = g.querySelector('.gal-count');
  const go = i => { i = ((i % n) + n) % n; track.scrollTo({ left: slides[i].offsetLeft - track.offsetLeft, behavior: reduceMotion ? 'auto' : 'smooth' }); };
  const update = () => { const i = Math.min(n - 1, cur()); thumbs.forEach((t, k) => t.setAttribute('aria-current', k === i)); count.textContent = `${i + 1} / ${n}`; };
  prev.addEventListener('click', () => go(cur() - 1)); next.addEventListener('click', () => go(cur() + 1));
  thumbs.forEach((t, k) => t.addEventListener('click', () => go(k)));
  track.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { e.preventDefault(); go(cur() + 1); } if (e.key === 'ArrowLeft') { e.preventDefault(); go(cur() - 1); } });
  let raf; track.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); }, { passive: true });
  update();
})();


// ===================== Tabellen (wie im Bericht) =====================
let tablesDone = false;
async function renderTables() {
  if (tablesDone) return;
  const runs = RUNS.slice().sort((p, q) => +p.id - +q.id);
  const raws = {}; for (const r of runs) raws[r.id] = await loadRaw(r);
  const f = (x, d = 3) => ok(x) ? fmt(x, d) : '–', pc = x => ok(x) ? `${x > 0 ? '+' : ''}${fmt(x, 0)} %` : '–';
  const U = (r, key, v) => r.uns.includes(key) ? `<span class="uns">${f(v)}*</span>` : f(v);
  const tbl = (id, title, cap, head, rows, note = '', cls = '') => `<div class="tblock" id="${id}"><h3>${title}</h3><p class="tcap">${cap}</p><div class="tablewrap"><table class="${cls}"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${note ? `<p class="tnote">${note}</p>` : ''}</div>`;
  const base = r => [r.id, r.T.label, r.aufbau];
  const gaps = (arr, t) => { const g = []; let i = 0;
    while (i < arr.length) { if (arr[i] !== null) { i++; continue; } let k = i; while (k < arr.length && arr[k] === null) k++;
      if (k - i >= 10) { const prev = g[g.length - 1]; if (prev && i - prev[1] < 60) prev[1] = k - 1; else g.push([i, k - 1]); } i = k; }
    return g.map(([p, q]) => `${fmt(t[p], 2)} – ${fmt(t[q], 2)} s`).join('; ') || '–'; };
  const H = [];
  H.push(tbl('tA', 'Tabelle A: Massen und Geschwindigkeiten', 'Lineare Fits an die Rohdaten über 0,3 s, die 0,03 s vor dem Stossbeginn enden bzw. 0,03 s nach dem Stossende beginnen. v vor, u nach dem Stoss, in m/s.',
    ['Nr.', 'Stossart', 'Aufbau', 'm₁ / g', 'm₂ / g', 'v₁', 'v₂', 'u₁', 'u₂'],
    runs.map(r => [...base(r), f(r.m1 * 1000, 1), f(r.m2 * 1000, 1), U(r, 'v1', r.v1), U(r, 'v2', r.v2), U(r, 'v1_nach', r.u1), U(r, 'v2_nach', r.u2)]),
    '* unsicher: Wagen 2 ist nach dem Stoss weniger als 0,2 s messbar. In Stoss 3 liegt das Fenster noch im Stoss, der Wert ist zu klein.'));
  H.push(tbl('tB', 'Tabelle B: Impuls vor und nach dem Stoss', 'Gesamtimpuls p = m₁v₁ + m₂v₂ in g·m/s. Bei Gesamtimpuls nahe null ist eine Prozentangabe nicht sinnvoll.',
    ['Nr.', 'Stossart', 'Aufbau', 'p vor', 'p nach', 'Δp', 'relativ'],
    runs.map(r => [...base(r), f(r.p0 * 1000, 1), f(r.p1 * 1000, 1), f((r.p1 - r.p0) * 1000, 1), Math.abs(r.p0) > 0.03 ? pc((r.p1 - r.p0) / Math.abs(r.p0) * 100) : '(p ≈ 0)'])));
  H.push(tbl('tC', 'Tabelle C: Kinetische Energie vor und nach dem Stoss', 'E = ½m₁v₁² + ½m₂v₂² in mJ.',
    ['Nr.', 'Stossart', 'Aufbau', 'E vor', 'E nach', 'ΔE', 'relativ'],
    runs.map(r => [...base(r), f(r.E0 * 1000, 1), f(r.E1 * 1000, 1), f((r.E1 - r.E0) * 1000, 1), pc(r.dE)])));
  H.push(tbl('tD', 'Tabelle D: Kraftstoss, Stossdauer und Kraft', 'Kraftstoss ∫F dt = m∫a dt über die Stossdauer (|a₁| über 10 % des Maximums) im Vergleich zur Impulsänderung Δp = m(u − v) aus den Fits.',
    ['Nr.', 'Stossart', 'Aufbau', '∫F₁ dt / N·s', 'Δp₁ / kg·m/s', 'Abw.', '∫F₂ dt / N·s', 'Δp₂ / kg·m/s', 'Δt / s', 'F̄ / N', 'F_max / N'],
    runs.map(r => { const raw = raws[r.id], lo = Math.round(raw.lo / DT), hi = Math.round(raw.hi / DT);
      const area = a => { let J = 0; for (let j = lo; j < hi; j++) { if (a[j] === null || a[j + 1] === null) return NaN; J += (a[j] + a[j + 1]) / 2 * DT; } return J; };
      const J1 = r.m1 * area(raw.a1), J2 = r.m2 * area(raw.a2), d1 = r.m1 * (r.u1 - r.v1), d2 = r.m2 * (r.u2 - r.v2), dt = raw.hi - raw.lo;
      return [...base(r), f(J1), f(d1), pc((J1 - d1) / Math.abs(d1) * 100), f(J2), f(d2), f(dt, 2), f(Math.abs(d1) / dt, 2), f(Math.abs(r.m1 * raw.amax), 2)]; })));
  H.push(tbl('tE', 'Tabelle E: Vergleich mit der Theorie', 'Elastisch: u aus Impuls- und Energieerhaltung. Inelastisch: gemeinsame Geschwindigkeit v_s = (m₁v₁ + m₂v₂)/(m₁ + m₂). Stosszahl k = (u₂ − u₁)/(v₁ − v₂).',
    ['Nr.', 'Stossart', 'Aufbau', 'u₁ gemessen', 'u₁ Theorie', 'u₂ gemessen', 'u₂ Theorie', 'Stosszahl k'],
    runs.map(r => { const M = r.m1 + r.m2, P = r.p0; let t1 = NaN, t2 = NaN;
      if (r.T.key === 'elastisch') { t1 = (P - r.m2 * (r.v1 - r.v2)) / M; t2 = (P + r.m1 * (r.v1 - r.v2)) / M; } else if (r.T.key === 'inelastisch') t1 = t2 = P / M;
      const k = (r.u2 - r.u1) / (r.v1 - r.v2);
      return [...base(r), U(r, 'v1_nach', r.u1), f(t1), U(r, 'v2_nach', r.u2), f(t2), fmt(Math.abs(k) < 0.005 ? 0 : k, 2)]; })));
  H.push(tbl('tF', 'Tabelle F: Totzone der Sensoren', 'Zeitabschnitte, in denen ein Wagen näher als etwa 20 cm an seinem Sensor war (Sensor 2 zeigt dann fest 0,196 m, Sensor 1 fest 1,023 m). Diese Werte sind verworfen.',
    ['Nr.', 'Stossart', 'Aufbau', 'Wagen 2 nicht messbar', 'Wagen 1 nicht messbar'],
    runs.map(r => { const raw = raws[r.id]; return [...base(r), gaps(raw.x2, raw.t), gaps(raw.x1, raw.t)]; })));
  H.push(tbl('tG', 'Tabelle G: Messzeit von Wagen 2 nach dem Stoss', 'Wie lange Wagen 2 nach dem Stossende noch gemessen wird, bevor er in die Totzone seines Sensors fährt. Unter etwa 0,2 s ist u₂ unsicher.',
    ['Nr.', 'Stossart', 'Aufbau', 'Stossende', 'Wagen 2 in Totzone ab', 'messbare Zeit'],
    runs.map(r => { const raw = raws[r.id], hi = Math.round(raw.hi / DT); let j = hi; while (j < raw.x2.length && raw.x2[j] !== null) j++;
      const end = j < raw.x2.length ? raw.t[j] : NaN; return [...base(r), `${fmt(raw.hi, 2)} s`, ok(end) ? `${fmt(end, 2)} s` : 'bis Messende', ok(end) ? `${fmt(end - raw.hi, 2)} s` : `> ${fmt(raw.t[raw.t.length - 1] - raw.hi, 1)} s`]; })));
  H.push(tbl('tH', 'Tabelle H: Stoss 3, u₂ je nach Fitbeginn', 'Wagen 2 ist nur bis 1,645 s messbar, der Federkontakt dauert bis 1,60 s. Je später der Fit beginnt, desto grösser der Betrag; aus der Impulserhaltung folgen −0,416 m/s.',
    ['Fitbeginn', 'Punkte', 'u₂ / m/s'], [['1,40 s', '51', '−0,341'], ['1,46 s', '39', '−0,367'], ['1,50 s', '31', '−0,378'], ['1,55 s', '21', '−0,395'], ['1,60 s (Stossende)', '11', '−0,313 (zu wenig Punkte)']], '', 'left'));
  H.push(tbl('tI', 'Tabelle I: Fehlerquellen', 'Übersicht der Fehlerquellen und ihrer Auswirkung.',
    ['Fehlerquelle', 'betroffen', 'Auswirkung'], [
      ['Sensorrauschen (0,5 bis 2 mm)', 'alle', 'v ± 0,002 bis 0,005 m/s, vernachlässigbar'],
      ['Totzone der Sensoren (Grenzwerte 0,196 / 1,023 m)', 'alle', 'Daten fehlen; ohne Korrektur scheinbarer Stillstand'],
      ['Kurze Messzeit von Wagen 2 nach dem Stoss', '1, 2, 3, 11 (stark: 1, 3)', 'u₂ unsicher (Stoss 3: 12 % zu klein, Stoss 1: eher zu gross)'],
      ['Fitfenster reichte in den Stoss', '1, 2, 4, 8, 10, 12 (korrigiert); 3 (nicht korrigierbar)', 'Geschwindigkeiten bis 16 % zu klein'],
      ['Reibung, Schienenneigung', 'alle', 'Impulsverlust von einigen Prozent'],
      ['Gesamtimpuls ≈ 0', '4, 8, 12', 'Prozentangaben nicht sinnvoll'],
      ['Massenannahme bei gleichen Massen', '3, 4, 7, 8, 11, 12', 'absolute Werte unsicher, Verhältnisse nicht'],
      ['Glättung, Schwelle für Δt', 'alle (stark: inelastisch, 6, 10)', 'F_max und F̄ unsicher, ∫F dt kaum'],
      ['Abprallen am Schienenende, zweiter Stoss', '1, 3, 11', 'kein Einfluss auf die Auswertung']], '', 'left'));
  $('tablesBox').innerHTML = H.join('');
  tablesDone = true;
}
