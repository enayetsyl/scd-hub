/**
 * STEP 3 — runs LOCALLY. No database, no network.
 *
 *   node scripts/analyze.cjs            (reads out/data.json + out/att.json)
 *
 * Writes:
 *   out/report.txt    the full numeric report — READ THIS before touching the page
 *   out/figures.json  every number the published page needs, for render.cjs
 *
 * Definitions are fixed here so a re-run is comparable with the last one:
 *   submitted     = record state in SUBMITTED | CHECKED | RESUBMIT | RETURNED
 *   not submitted = record state in CHASE | DUE
 *   excluded      = GIVEN (not yet due) and ABSENT_REDELIVER (an absence, not a
 *                   choice — counting it as a miss double-counts attendance)
 *   quality       = CORRECT 1, PARTIAL 0.5, WRONG 0
 *   result        = mean % across PRINTED tests the child sat; ABSENT rows and
 *                   CANCELLED tests excluded
 *   z             = the same score standardised WITHIN its own test, which
 *                   removes test difficulty and the section's ability. Every
 *                   headline is reported both ways; if they disagree, the z
 *                   version is the one to trust.
 */
const fs = require('fs');
const path = require('path');

const OUT = process.env.CORR_OUT || path.join(__dirname, '..', 'out');
const D = JSON.parse(fs.readFileSync(path.join(OUT, 'data.json'), 'utf8'));
const ATT = JSON.parse(fs.readFileSync(path.join(OUT, 'att.json'), 'utf8'));

/* ---------------- statistics ---------------- */
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

function pearson(x, y) {
  const n = x.length; if (n < 3) return null;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (!sxx || !syy) return null;
  return sxy / Math.sqrt(sxx * syy);
}
function ranks(a) {
  const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
  const r = new Array(a.length);
  let i = 0;
  while (i < idx.length) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}
const spearman = (x, y) => pearson(ranks(x), ranks(y));

function gammaln(z) {
  const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - gammaln(1 - z);
  z -= 1; let x = 0.99999999999980993;
  for (let i = 0; i < 8; i++) x += g[i] / (z + i + 1);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
function betacf(a, b, x) {
  const MAXIT = 200, EPS = 3e-12, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d; let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function betai(a, b, x) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
function pval(r, n) {
  if (r == null || n < 4) return null;
  const rr = Math.min(Math.abs(r), 0.999999999), df = n - 2;
  const t = rr * Math.sqrt(df / (1 - rr * rr));
  return betai(df / 2, 0.5, df / (df + t * t));
}
function ols(Y, Xcols) {
  const n = Y.length, k = Xcols.length, p = k + 1;
  const X = [];
  for (let i = 0; i < n; i++) X.push([1, ...Xcols.map((c) => c[i])]);
  const A = Array.from({ length: p }, () => new Array(p + 1).fill(0));
  for (let a = 0; a < p; a++) {
    for (let b = 0; b < p; b++) for (let i = 0; i < n; i++) A[a][b] += X[i][a] * X[i][b];
    for (let i = 0; i < n; i++) A[a][p] += X[i][a] * Y[i];
  }
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    if (Math.abs(A[c][c]) < 1e-12) return null;
    for (let r = 0; r < p; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let cc = c; cc <= p; cc++) A[r][cc] -= f * A[c][cc];
    }
  }
  const beta = A.map((row, i) => row[p] / A[i][i]);
  const my = mean(Y); let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    let yh = beta[0];
    for (let j = 0; j < k; j++) yh += beta[j + 1] * Xcols[j][i];
    ssRes += (Y[i] - yh) ** 2; ssTot += (Y[i] - my) ** 2;
  }
  const sy = sd(Y);
  return { beta, std: Xcols.map((c, j) => beta[j + 1] * sd(c) / sy), r2: 1 - ssRes / ssTot, n };
}
function welch(a, b) {
  const ma = mean(a), mb = mean(b), va = sd(a) ** 2, vb = sd(b) ** 2;
  const se = Math.sqrt(va / a.length + vb / b.length);
  const t = (ma - mb) / se;
  const df = (va / a.length + vb / b.length) ** 2 /
    ((va / a.length) ** 2 / (a.length - 1) + (vb / b.length) ** 2 / (b.length - 1));
  return { ma, mb, p: pval(t / Math.sqrt(t * t + df), df + 2) };
}

/* ---------------- features ---------------- */
const DONE = new Set(['SUBMITTED', 'CHECKED', 'RESUBMIT', 'RETURNED']);
const NOTDONE = new Set(['CHASE', 'DUE']);
const SCORE = { CORRECT: 1, PARTIAL: 0.5, WRONG: 0 };

const stu = new Map(D.students.map((s) => [s.s, s]));
const testById = new Map(D.tests.map((t) => [t.t, t]));

const testStats = new Map();
const byTest = new Map();
for (const r of D.tres) {
  if (!byTest.has(r.t)) byTest.set(r.t, []);
  byTest.get(r.t).push(r);
}
for (const [tid, rs] of byTest) {
  const t = testById.get(tid);
  if (!t || t.status !== 'PRINTED' || !t.total) continue;
  const pcts = rs.filter((r) => r.st === 'PRESENT' && r.m != null).map((r) => 100 * r.m / t.total);
  if (pcts.length < 3) continue;
  testStats.set(tid, { m: mean(pcts), s: sd(pcts) || 0, n: pcts.length });
}

const res = new Map([...stu.keys()].map((k) => [k, { pcts: [], zs: [], nP: 0, nA: 0 }]));
for (const r of D.tres) {
  const t = testById.get(r.t); if (!t || t.status !== 'PRINTED') continue;
  const rec = res.get(r.s); if (!rec) continue;
  if (r.st === 'ABSENT') { rec.nA++; continue; }
  if (r.m == null || !t.total) continue;
  rec.nP++;
  const pct = 100 * r.m / t.total;
  rec.pcts.push(pct);
  const ts = testStats.get(r.t);
  if (ts && ts.s > 0) rec.zs.push((pct - ts.m) / ts.s);
}

function rollup(records) {
  const m = new Map([...stu.keys()].map((k) => [k, {
    n: 0, done: 0, notDone: 0, absentRe: 0, chased: 0, scores: [],
  }]));
  for (const r of records) {
    const rec = m.get(r.s); if (!rec) continue;
    rec.n++;
    if (DONE.has(r.st)) rec.done++;
    else if (NOTDONE.has(r.st)) rec.notDone++;
    else if (r.st === 'ABSENT_REDELIVER') rec.absentRe++;
    if (r.ch > 0) rec.chased++;
    if (r.r) rec.scores.push(SCORE[r.r]);
  }
  return m;
}
const hw = rollup(D.hwr), as = rollup(D.asr);
const attBy = new Map(ATT.rows.map((r) => [r.s, r]));

const rows = [];
for (const [sid, s] of stu) {
  const t = res.get(sid), h = hw.get(sid), g = as.get(sid), a = attBy.get(sid);
  rows.push({
    sid, lvl: s.lvl, sec: s.sec, gender: s.g,
    marked: a ? a.marked : 0,
    absDays: a ? a.absent : 0,
    leaveDays: a ? a.leaveCovered : 0,
    att: a && a.marked >= 10 ? a.pct / 100 : null,
    nTests: t.nP, testAbsent: t.nA,
    testAbsRate: (t.nP + t.nA) >= 4 ? t.nA / (t.nP + t.nA) : null,
    pct: t.pcts.length >= 3 ? mean(t.pcts) : null,
    z: t.zs.length >= 3 ? mean(t.zs) : null,
    hwN: h.n,
    hwDone: (h.done + h.notDone) >= 5 ? h.done / (h.done + h.notDone) : null,
    hwChase: h.n >= 5 ? h.chased / h.n : null,
    hwAbsent: h.n >= 5 ? h.absentRe / h.n : null,
    hwQual: h.scores.length >= 5 ? mean(h.scores) : null,
    asN: g.n,
    asDone: (g.done + g.notDone) >= 4 ? g.done / (g.done + g.notDone) : null,
    asChase: g.n >= 4 ? g.chased / g.n : null,
    asQual: g.scores.length >= 4 ? mean(g.scores) : null,
  });
}

/* ---------------- report ---------------- */
const L = [];
const say = (...a) => L.push(a.join(' '));
const f = (v, d = 1) => (v == null || Number.isNaN(v) ? '-' : v.toFixed(d));

function corr(set, kx, ky) {
  const p = set.filter((r) => r[kx] != null && r[ky] != null);
  if (p.length < 6) return { n: p.length };
  const x = p.map((r) => r[kx]), y = p.map((r) => r[ky]);
  const r = pearson(x, y);
  return { n: p.length, r, rho: spearman(x, y), p: pval(r, p.length) };
}
function line(label, c) {
  if (c.r == null) return say('  ' + label.padEnd(34), 'n=' + c.n, '(too few)');
  say('  ' + label.padEnd(34), 'n=' + String(c.n).padStart(3),
    'r=' + (c.r >= 0 ? ' ' : '') + f(c.r, 3),
    'rho=' + (c.rho >= 0 ? ' ' : '') + f(c.rho, 3),
    'p=' + (c.p < 0.001 ? '<0.001' : f(c.p, 3)), c.p < 0.01 ? '**' : c.p < 0.05 ? '*' : '');
}

say('=== WINDOW & COVERAGE ===');
say('window:', ATT.from, '->', ATT.to);
say('students:', rows.length, '| with >=3 scored tests:', rows.filter((r) => r.pct != null).length);
const mk = rows.map((r) => r.marked).sort((a, b) => a - b);
say('attendance days marked per student: min', mk[0], 'median', mk[Math.floor(mk.length / 2)], 'max', mk[mk.length - 1]);
const unitCount = {};
for (const r of ATT.rows) unitCount[r.unit] = (unitCount[r.unit] || 0) + 1;
say('capture unit:', JSON.stringify(unitCount));
say('printed tests:', D.tests.filter((t) => t.status === 'PRINTED').length,
  '| scored papers:', D.tres.filter((r) => r.st === 'PRESENT' && r.m != null).length);
say('homework records:', D.hwr.length, '| assignment records:', D.asr.length);

say('');
say('=== SANITY CHECK ON THE ATTENDANCE READ ===');
const sanity = corr(rows, 'att', 'hwAbsent');
line('attendance x hw ABSENT_REDELIVER', sanity);
say('  expect about -0.95. Much weaker means the WRONG ATTENDANCE UNIT was read —');
say('  see the header of attendance.cjs before believing any attendance result below.');

const MEASURES = [
  ['hwQual', 'homework quality'], ['asQual', 'assignment quality'],
  ['hwDone', 'homework submitted'], ['asDone', 'assignments submitted'],
  ['att', 'attendance'],
];
say('');
say('=== CORRELATION WITH RESULT (raw mean %) ===');
for (const [k, lab] of MEASURES) line(lab, corr(rows, k, 'pct'));
line('homework chase rate', corr(rows, 'hwChase', 'pct'));
line('assignment chase rate', corr(rows, 'asChase', 'pct'));
say('');
say('=== SAME, ON WITHIN-TEST z (difficulty + section removed) ===');
for (const [k, lab] of MEASURES) line(lab, corr(rows, k, 'z'));

say('');
say('=== ARE THE PREDICTORS THE SAME THING? ===');
line('homework x assignment submission', corr(rows, 'hwDone', 'asDone'));
line('attendance x homework submission', corr(rows, 'att', 'hwDone'));
line('attendance x class-test absence', corr(rows, 'att', 'testAbsRate'));

function tert(key) {
  const use = rows.filter((r) => r[key] != null && r.pct != null).sort((a, b) => a[key] - b[key]);
  if (use.length < 12) return null;
  const c = Math.floor(use.length / 3);
  return [use.slice(0, c), use.slice(c, use.length - c), use.slice(use.length - c)]
    .map((g) => ({ cut: mean(g.map((r) => r[key])), res: mean(g.map((r) => r.pct)), n: g.length }));
}
say('');
say('=== TERTILES (average result of the bottom / middle / top third) ===');
const tertiles = {};
for (const [k, lab] of [['hwDone', 'homework submitted'], ['asDone', 'assignments submitted'], ['att', 'attendance']]) {
  const t = tert(k); tertiles[k] = t;
  if (!t) { say('  ' + lab, '(too few)'); continue; }
  say('  ' + lab.padEnd(24), t.map((g) => f(g.res) + ' (n=' + g.n + ')').join('  ->  '));
}

const BANDS = [[0, 0.70], [0.70, 0.80], [0.80, 0.85], [0.85, 0.90], [0.90, 0.95], [0.95, 1.001]];
say('');
say('=== ATTENDANCE BANDS ===');
const bands = [];
for (const [lo, hi] of BANDS) {
  const g = rows.filter((r) => r.att != null && r.pct != null && r.att >= lo && r.att < hi);
  bands.push({ lo, hi, n: g.length, mean: g.length ? mean(g.map((r) => r.pct)) : null });
  say('  ' + String(Math.round(lo * 100)).padStart(3) + '-' + String(Math.round(hi * 100)).padStart(3) + '%',
    'n=' + String(g.length).padStart(2), 'mean result=' + f(g.length ? mean(g.map((r) => r.pct)) : null));
}

say('');
say('=== THRESHOLD TESTS ===');
const thresholds = {};
for (const cut of [0.75, 0.80, 0.85, 0.90]) {
  const lo = rows.filter((r) => r.att != null && r.pct != null && r.att < cut);
  const hi = rows.filter((r) => r.att != null && r.pct != null && r.att >= cut);
  if (lo.length < 4 || hi.length < 4) { say('  cut', cut, '(too few)'); continue; }
  const w = welch(lo.map((r) => r.pct), hi.map((r) => r.pct));
  thresholds[cut] = { nLo: lo.length, nHi: hi.length, lo: w.ma, hi: w.mb, p: w.p,
    hwLo: mean(lo.filter((r) => r.hwDone != null).map((r) => r.hwDone)),
    hwHi: mean(hi.filter((r) => r.hwDone != null).map((r) => r.hwDone)) };
  say('  below ' + (cut * 100) + '%: n=' + String(lo.length).padStart(2), 'mean=' + f(w.ma),
    '| at/above: n=' + String(hi.length).padStart(2), 'mean=' + f(w.mb),
    '| gap=' + f(w.ma - w.mb), 'p=' + (w.p < 0.001 ? '<0.001' : f(w.p, 3)), w.p < 0.05 ? '*' : '');
}

say('');
say('=== REGRESSION (standardized betas, outcome = raw result %) ===');
function fit(keys, label) {
  const use = rows.filter((r) => r.pct != null && keys.every((k) => r[k] != null));
  if (use.length < keys.length + 6) return say('  ' + label, '(too few)');
  const m = ols(use.map((r) => r.pct), keys.map((k) => use.map((r) => r[k])));
  if (!m) return say('  ' + label, 'singular');
  say('  ' + label.padEnd(44), 'n=' + use.length, 'R2=' + f(m.r2, 3),
    '|', keys.map((k, i) => k + '=' + f(m.std[i], 2)).join('  '));
  return m;
}
fit(['att'], 'attendance alone');
fit(['hwDone'], 'homework submitted alone');
fit(['att', 'hwDone', 'asDone'], 'attendance + hw submit + as submit');
fit(['att', 'hwQual', 'asQual'], 'attendance + hw quality + as quality');
const chronicCut = 0.85;
const u2 = rows.filter((r) => r.pct != null && r.hwDone != null && r.asDone != null && r.att != null);
const mChronic = ols(u2.map((r) => r.pct), [u2.map((r) => (r.att < chronicCut ? 1 : 0)), u2.map((r) => r.hwDone), u2.map((r) => r.asDone)]);
if (mChronic) say('  chronic absence (<85%) controlled for written work: ' + f(mChronic.beta[1], 1) + ' marks');

say('');
say('=== EFFECT SIZE: p10 -> p90 IN MARKS ===');
const effect = [];
for (const [k, lab] of MEASURES) {
  const use = rows.filter((r) => r.pct != null && r[k] != null);
  if (use.length < 10) continue;
  const x = use.map((r) => r[k]);
  const m = ols(use.map((r) => r.pct), [x]);
  const s = x.slice().sort((a, b) => a - b);
  const lo = s[Math.floor(x.length * 0.1)], hi = s[Math.floor(x.length * 0.9)];
  const marks = (hi - lo) * m.beta[1];
  effect.push({ key: k, label: lab, marks, lo, hi });
  say('  ' + lab.padEnd(24), 'p10->p90 (' + f(lo, 2) + '->' + f(hi, 2) + ') =', f(marks), 'marks');
}

say('');
say('=== BY CLASS LEVEL ===');
const levels = {};
for (const lv of [...new Set(rows.map((r) => r.lvl))].sort((a, b) => a - b)) {
  const g = rows.filter((r) => r.lvl === lv);
  const av = (k) => { const v = g.map((x) => x[k]).filter((x) => x != null); return v.length ? mean(v) : null; };
  const pa = g.filter((r) => r.att != null && r.pct != null);
  const ph = g.filter((r) => r.hwDone != null && r.pct != null);
  levels[lv] = {
    n: g.length, att: av('att'), hw: av('hwDone'), as: av('asDone'), res: av('pct'),
    rAtt: pa.length >= 6 ? pearson(pa.map((r) => r.att), pa.map((r) => r.pct)) : null,
    rHw: ph.length >= 6 ? pearson(ph.map((r) => r.hwDone), ph.map((r) => r.pct)) : null,
  };
  say('  level', String(lv).padStart(2), 'n=' + String(g.length).padStart(2),
    'att=' + f(av('att') * 100), 'hwDone=' + f(av('hwDone'), 2), 'result=' + f(av('pct')),
    'r(att,res)=' + f(levels[lv].rAtt, 2), 'r(hw,res)=' + f(levels[lv].rHw, 2));
}
const senior = rows.filter((r) => r.lvl >= 4 && r.att != null && r.pct != null);
const c45 = senior.length >= 6
  ? { n: senior.length, r: pearson(senior.map((r) => r.att), senior.map((r) => r.pct)),
      rho: spearman(senior.map((r) => r.att), senior.map((r) => r.pct)) }
  : null;
if (c45) {
  c45.p = pval(c45.r, c45.n);
  say('  CLASS 4+5 together: n=' + c45.n, 'r(att,result)=' + f(c45.r, 3), 'p=' + f(c45.p, 3));
}

say('');
say('=== LEAVE APPLICATIONS ===');
const totAbs = rows.reduce((s, r) => s + r.absDays, 0);
const totLeave = rows.reduce((s, r) => s + r.leaveDays, 0);
say('  absence-days:', totAbs, '| covered by an approved leave application:', totLeave);
const ghosts = ATT.rows.filter((r) => r.marked >= 30 && r.absent / r.marked > 0.5);
say('  students absent for more than half their marked days:', ghosts.length);

/* ---------------- figures.json ---------------- */
const withRes = rows.filter((r) => r.pct != null);
const attSorted = withRes.map((r) => r.att).filter((v) => v != null).sort((a, b) => a - b);
const hwSorted = rows.map((r) => r.hwDone).filter((v) => v != null).sort((a, b) => a - b);
const cutRow = thresholds[0.85];

const figures = {
  generatedAt: new Date().toISOString().slice(0, 10),
  window: { from: ATT.from, to: ATT.to },
  counts: {
    students: rows.length,
    tests: D.tests.filter((t) => t.status === 'PRINTED').length,
    papers: D.tres.filter((r) => r.st === 'PRESENT' && r.m != null).length,
    trackerRecords: D.hwr.length + D.asr.length,
    attDays: mk[Math.floor(mk.length / 2)],
    withResult: withRes.length,
  },
  corr: MEASURES.map(([k, lab]) => {
    const c = corr(rows, k, 'pct');
    const cz = corr(rows, k, 'z');
    return { key: k, label: lab, r: c.r, p: c.p, sig: c.p != null && c.p < 0.05, rz: cz.r, pz: cz.p };
  }),
  tertiles,
  tertileDiff: Object.fromEntries(Object.entries(tertiles).map(
    ([k, t]) => [k, t ? t[2].res - t[0].res : null])),
  bands,
  thresholds,
  effect,
  effectMarks: Object.fromEntries(effect.map((e) => [e.key, e.marks])),
  levels,
  c45: c45 || { n: 0, r: null, rho: null, p: null },
  headline: {
    attMedian: attSorted.length ? attSorted[Math.floor(attSorted.length / 2)] : null,
    attP90: attSorted.length ? attSorted[Math.floor(attSorted.length * 0.9)] : null,
    hwMin: hwSorted.length ? hwSorted[0] : null,
    hwMax: hwSorted.length ? hwSorted[hwSorted.length - 1] : null,
    below85: cutRow || { nLo: 0, nHi: 0, lo: null, hi: null, p: null, hwLo: null, hwHi: null },
    chronicControlled: mChronic ? mChronic.beta[1] : null,
    chronicCost: mChronic ? Math.abs(mChronic.beta[1]) : null,
    absenceDays: totAbs,
    leaveCovered: totLeave,
    ghosts: ghosts.length,
    sanityR: sanity.r,
  },
  students: withRes.map((r) => [
    r.lvl,
    r.att != null ? +(r.att * 100).toFixed(1) : null,
    r.hwDone != null ? +(r.hwDone * 100).toFixed(1) : null,
    r.asDone != null ? +(r.asDone * 100).toFixed(1) : null,
    +r.pct.toFixed(1),
  ]),
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'report.txt'), L.join('\n'));
fs.writeFileSync(path.join(OUT, 'figures.json'), JSON.stringify(figures, null, 1));
console.log(L.join('\n'));
console.log('\nwrote ' + path.join(OUT, 'report.txt') + ' and figures.json');
