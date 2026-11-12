/**
 * Statistics for the "What moves the marks" report (D-#905/#906). PURE — no model, no
 * query — so the figures can be pinned by unit test without a database.
 *
 * Ported from the term correlation study (`skills/term-correlation-study/scripts/analyze.cjs`,
 * PR #876) so the live report and the 23-Sep published page answer the same question the
 * same way. The definitions below are FROZEN to that script; changing one makes this term's
 * figures incomparable with the last, so it wants its own decision row.
 *
 *   submitted     = SUBMITTED | CHECKED | RESUBMIT | RETURNED
 *   not submitted = CHASE | DUE
 *   excluded      = GIVEN (not yet due) and ABSENT_REDELIVER (an absence, not a choice —
 *                   counting it as a miss double-counts attendance)
 *   quality       = CORRECT 1, PARTIAL 0.5, WRONG 0
 *   result        = mean % across PRINTED tests the child sat (ABSENT papers excluded),
 *                   reported only from 3 tests up
 */

export const DONE_STATES = new Set(["SUBMITTED", "CHECKED", "RESUBMIT", "RETURNED"]);
export const NOT_DONE_STATES = new Set(["CHASE", "DUE"]);
const QUALITY: Record<string, number> = { CORRECT: 1, PARTIAL: 0.5, WRONG: 0 };

/** Minimums below which a child's figure is withheld (null), as in the study. */
export const MIN_TESTS = 3;
export const MIN_ATT_DAYS = 10;
const MIN_HW = 5;
const MIN_AS = 4;
/** Below this many children a correlation is not reported at all. */
const MIN_CORR_N = 6;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const mean = (a: number[]): number => a.reduce((s, x) => s + x, 0) / a.length;
export const sd = (a: number[]): number => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};

export function pearson(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n < 3) return null;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (!sxx || !syy) return null;
  return sxy / Math.sqrt(sxx * syy);
}

function ranks(a: number[]): number[] {
  const idx = a.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
  const r = new Array<number>(a.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}
export const spearman = (x: number[], y: number[]): number | null => pearson(ranks(x), ranks(y));

function gammaln(z: number): number {
  const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - gammaln(1 - z);
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < 8; i++) x += g[i] / (z + i + 1);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-12;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Two-sided p-value of a Pearson r over n pairs (t-distribution, n − 2 df). */
export function pval(r: number | null, n: number): number | null {
  if (r == null || n < 4) return null;
  const rr = Math.min(Math.abs(r), 0.999999999);
  const df = n - 2;
  const t = rr * Math.sqrt(df / (1 - rr * rr));
  return betai(df / 2, 0.5, df / (df + t * t));
}

/** Ordinary least squares with an intercept; `beta[0]` is the intercept. */
export function ols(Y: number[], Xcols: number[][]): { beta: number[]; r2: number } | null {
  const n = Y.length;
  const k = Xcols.length;
  const p = k + 1;
  const X: number[][] = [];
  for (let i = 0; i < n; i++) X.push([1, ...Xcols.map((c) => c[i])]);
  const A = Array.from({ length: p }, () => new Array<number>(p + 1).fill(0));
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
  const my = mean(Y);
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    let yh = beta[0];
    for (let j = 0; j < k; j++) yh += beta[j + 1] * Xcols[j][i];
    ssRes += (Y[i] - yh) ** 2;
    ssTot += (Y[i] - my) ** 2;
  }
  return { beta, r2: ssTot ? 1 - ssRes / ssTot : 0 };
}

/** Welch's two-sample t-test; returns the two means and the two-sided p. */
function welch(a: number[], b: number[]): { ma: number; mb: number; p: number | null } {
  const ma = mean(a);
  const mb = mean(b);
  const va = sd(a) ** 2;
  const vb = sd(b) ** 2;
  const se = Math.sqrt(va / a.length + vb / b.length);
  if (!se) return { ma, mb, p: null };
  const t = (ma - mb) / se;
  const df = (va / a.length + vb / b.length) ** 2 /
    ((va / a.length) ** 2 / (a.length - 1) + (vb / b.length) ** 2 / (b.length - 1));
  return { ma, mb, p: pval(t / Math.sqrt(t * t + df), df + 2) };
}

// ---------------------------------------------------------------------------
// Per-child features
// ---------------------------------------------------------------------------

/** One child's raw inputs, already windowed. Ids never leave the service. */
export interface ChildInput {
  level: number;
  /** Attendance over the window, or null when the child's unit marked no day. */
  attendance: { held: number; absent: number } | null;
  /** One entry per printed test the child has a result row for. */
  tests: Array<{ status: string; marks: number | null; totalMarks: number }>;
  homework: Array<{ state: string; result: string | null; chaseCount: number }>;
  assignments: Array<{ state: string; result: string | null; chaseCount: number }>;
}

/** Every measure the report correlates against the result. Fractions 0–1; result 0–100. */
export interface ChildRow {
  level: number;
  heldDays: number;
  absentDays: number;
  att: number | null;
  pct: number | null;
  hwDone: number | null;
  hwQual: number | null;
  hwAbsent: number | null;
  asDone: number | null;
  asQual: number | null;
}

function rollup(records: ChildInput["homework"]): { n: number; done: number; notDone: number; absentRe: number; scores: number[] } {
  const out = { n: 0, done: 0, notDone: 0, absentRe: 0, scores: [] as number[] };
  for (const r of records) {
    out.n++;
    if (DONE_STATES.has(r.state)) out.done++;
    else if (NOT_DONE_STATES.has(r.state)) out.notDone++;
    else if (r.state === "ABSENT_REDELIVER") out.absentRe++;
    if (r.result && r.result in QUALITY) out.scores.push(QUALITY[r.result]);
  }
  return out;
}

export function childRow(c: ChildInput): ChildRow {
  const pcts: number[] = [];
  for (const t of c.tests) {
    if (t.status !== "PRESENT" || t.marks == null || !t.totalMarks) continue;
    pcts.push((100 * t.marks) / t.totalMarks);
  }
  const h = rollup(c.homework);
  const g = rollup(c.assignments);
  const held = c.attendance?.held ?? 0;
  const absent = c.attendance?.absent ?? 0;
  return {
    level: c.level,
    heldDays: held,
    absentDays: absent,
    att: held >= MIN_ATT_DAYS ? (held - absent) / held : null,
    pct: pcts.length >= MIN_TESTS ? mean(pcts) : null,
    hwDone: h.done + h.notDone >= MIN_HW ? h.done / (h.done + h.notDone) : null,
    hwQual: h.scores.length >= MIN_HW ? mean(h.scores) : null,
    hwAbsent: h.n >= MIN_HW ? h.absentRe / h.n : null,
    asDone: g.done + g.notDone >= MIN_AS ? g.done / (g.done + g.notDone) : null,
    asQual: g.scores.length >= MIN_AS ? mean(g.scores) : null,
  };
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export type MeasureKey = "hwQual" | "asQual" | "hwDone" | "asDone" | "att";
export const MEASURES: MeasureKey[] = ["hwQual", "asQual", "hwDone", "asDone", "att"];

export interface Correlation {
  key: MeasureKey;
  n: number;
  r: number | null;
  p: number | null;
  /** p < 0.05 and at least MIN_CORR_N children. */
  significant: boolean;
}
export interface Tertile {
  key: "hwDone" | "asDone" | "att";
  /** Mean result of the bottom, middle and top third; null when fewer than 12 children. */
  bottom: number | null;
  middle: number | null;
  top: number | null;
  /** Children per outer third. */
  n: number;
}
export interface AttendanceBand {
  /** Percent bounds, e.g. 85 → 90. The top band's `hi` is 100 inclusive. */
  lo: number;
  hi: number;
  n: number;
  meanResult: number | null;
}
export interface LevelRow {
  level: number;
  n: number;
  att: number | null;
  hwDone: number | null;
  asDone: number | null;
  result: number | null;
  rAtt: number | null;
  rHw: number | null;
}
export interface EffectRow {
  key: MeasureKey;
  /** Marks between a child at the 10th and the 90th percentile of the measure. */
  marks: number;
}
export interface Below85 {
  nBelow: number;
  nAbove: number;
  below: number | null;
  above: number | null;
  p: number | null;
  hwBelow: number | null;
  hwAbove: number | null;
  /** The chronic-absence gap once homework + assignment submission are held equal. */
  controlledGap: number | null;
}
export interface ScatterPoint {
  level: number;
  att: number | null;
  hwDone: number | null;
  result: number;
}
export interface MarksDriversFigures {
  students: number;
  withResult: number;
  attMedian: number | null;
  correlations: Correlation[];
  tertiles: Tertile[];
  bands: AttendanceBand[];
  below85: Below85;
  levels: LevelRow[];
  /** Class 4–6 pooled (Class 6 joins from 2027, owner ruling Q32) — where the study found attendance biting. */
  senior: { n: number; r: number | null; p: number | null };
  effects: EffectRow[];
  /** Attendance × homework ABSENT_REDELIVER share. About −0.95 when the right
   *  attendance unit was read; much weaker means the attendance read is wrong. */
  sanityR: number | null;
  /** Children absent on more than half of 30+ marked days. */
  longAbsent: number;
  absenceDays: number;
  points: ScatterPoint[];
}

// ---------------------------------------------------------------------------
// Outliers (D-#910, owner 2026-11-02: "long-absent + extreme values")
// ---------------------------------------------------------------------------

/** Absent on more than half of at least this many marked days = long-absent. */
const LONG_ABSENT_MIN_DAYS = 30;
/** A value further than this many standard deviations from the school mean is extreme. */
const EXTREME_Z = 3;
/** The measures the extreme-value rule looks at: result, homework, attendance. */
const EXTREME_KEYS = ["pct", "hwDone", "att"] as const;

export const isLongAbsent = (r: ChildRow): boolean =>
  r.heldDays >= LONG_ABSENT_MIN_DAYS && r.absentDays / r.heldDays > 0.5;

/**
 * Split the children into kept / left out. A child is left out when long-absent, or when
 * their result, homework submission or attendance sits more than 3 SD from the mean of
 * everyone's (long-absent children excluded from that mean, so one ghost cannot widen the
 * band that would otherwise catch another). Counted once even when both rules match.
 */
export function splitOutliers(rows: ChildRow[]): { kept: ChildRow[]; longAbsent: number; extreme: number } {
  const base = rows.filter((r) => !isLongAbsent(r));
  const bounds = EXTREME_KEYS.map((k) => {
    const v = base.map((r) => r[k]).filter((x): x is number => x != null);
    if (v.length < 3) return null;
    const m = mean(v);
    const s = sd(v);
    return s > 0 ? { k, lo: m - EXTREME_Z * s, hi: m + EXTREME_Z * s } : null;
  });
  let longAbsent = 0;
  let extreme = 0;
  const kept: ChildRow[] = [];
  for (const r of rows) {
    if (isLongAbsent(r)) {
      longAbsent++;
      continue;
    }
    const out = bounds.some((b) => b && r[b.k] != null && ((r[b.k] as number) < b.lo || (r[b.k] as number) > b.hi));
    if (out) extreme++;
    else kept.push(r);
  }
  return { kept, longAbsent, extreme };
}

/** The side-by-side card: the same headline figures over the children who are kept. */
export interface OutlierComparison {
  longAbsent: number;
  extreme: number;
  withResult: number;
  correlations: Correlation[];
  tertiles: Tertile[];
  below85: Below85;
  senior: { n: number; r: number | null; p: number | null };
}

export function computeWithoutOutliers(rows: ChildRow[]): OutlierComparison {
  const { kept, longAbsent, extreme } = splitOutliers(rows);
  const f = computeFigures(kept);
  return {
    longAbsent,
    extreme,
    withResult: f.withResult,
    correlations: f.correlations,
    tertiles: f.tertiles,
    below85: f.below85,
    senior: f.senior,
  };
}

const BANDS: Array<[number, number]> =[[0, 0.7], [0.7, 0.8], [0.8, 0.85], [0.85, 0.9], [0.9, 0.95], [0.95, 1.001]];

const avgOf = (rows: ChildRow[], k: keyof ChildRow): number | null => {
  const v = rows.map((r) => r[k]).filter((x): x is number => typeof x === "number");
  return v.length ? mean(v) : null;
};

function corr(rows: ChildRow[], kx: keyof ChildRow, ky: keyof ChildRow): { n: number; r: number | null; p: number | null } {
  const use = rows.filter((r) => r[kx] != null && r[ky] != null);
  if (use.length < MIN_CORR_N) return { n: use.length, r: null, p: null };
  const r = pearson(use.map((x) => x[kx] as number), use.map((x) => x[ky] as number));
  return { n: use.length, r, p: pval(r, use.length) };
}

export function computeFigures(rows: ChildRow[]): MarksDriversFigures {
  const withRes = rows.filter((r) => r.pct != null);

  const correlations: Correlation[] = MEASURES.map((key) => {
    const c = corr(rows, key, "pct");
    return { key, ...c, significant: c.r != null && c.p != null && c.p < 0.05 };
  });

  const tertiles: Tertile[] = (["hwDone", "asDone", "att"] as const).map((key) => {
    const use = rows.filter((r) => r[key] != null && r.pct != null).sort((a, b) => (a[key] as number) - (b[key] as number));
    if (use.length < 12) return { key, bottom: null, middle: null, top: null, n: use.length };
    const c = Math.floor(use.length / 3);
    const res = (g: ChildRow[]) => mean(g.map((r) => r.pct as number));
    return { key, bottom: res(use.slice(0, c)), middle: res(use.slice(c, use.length - c)), top: res(use.slice(use.length - c)), n: c };
  });

  const bands: AttendanceBand[] = BANDS.map(([lo, hi]) => {
    const g = withRes.filter((r) => r.att != null && r.att >= lo && r.att < hi);
    return { lo: Math.round(lo * 100), hi: Math.min(100, Math.round(hi * 100)), n: g.length, meanResult: g.length ? mean(g.map((r) => r.pct as number)) : null };
  });

  const lo85 = withRes.filter((r) => r.att != null && r.att < 0.85);
  const hi85 = withRes.filter((r) => r.att != null && r.att >= 0.85);
  const w = lo85.length >= 4 && hi85.length >= 4 ? welch(lo85.map((r) => r.pct as number), hi85.map((r) => r.pct as number)) : null;
  const ctl = withRes.filter((r) => r.att != null && r.hwDone != null && r.asDone != null);
  const mChronic = ctl.length >= 10 && lo85.length >= 4
    ? ols(ctl.map((r) => r.pct as number), [ctl.map((r) => ((r.att as number) < 0.85 ? 1 : 0)), ctl.map((r) => r.hwDone as number), ctl.map((r) => r.asDone as number)])
    : null;
  const below85: Below85 = {
    nBelow: lo85.length,
    nAbove: hi85.length,
    below: w ? w.ma : null,
    above: w ? w.mb : null,
    p: w ? w.p : null,
    hwBelow: avgOf(lo85, "hwDone"),
    hwAbove: avgOf(hi85, "hwDone"),
    controlledGap: mChronic ? mChronic.beta[1] : null,
  };

  const levels: LevelRow[] = [...new Set(rows.map((r) => r.level))].sort((a, b) => a - b).map((level) => {
    const g = rows.filter((r) => r.level === level);
    return {
      level,
      n: g.length,
      att: avgOf(g, "att"),
      hwDone: avgOf(g, "hwDone"),
      asDone: avgOf(g, "asDone"),
      result: avgOf(g, "pct"),
      rAtt: corr(g, "att", "pct").r,
      rHw: corr(g, "hwDone", "pct").r,
    };
  });

  const seniorC = corr(rows.filter((r) => r.level >= 4), "att", "pct");

  const effects: EffectRow[] = [];
  for (const key of MEASURES) {
    const use = withRes.filter((r) => r[key] != null);
    if (use.length < 10) continue;
    const x = use.map((r) => r[key] as number);
    const m = ols(use.map((r) => r.pct as number), [x]);
    if (!m) continue;
    const s = x.slice().sort((a, b) => a - b);
    const marks = (s[Math.floor(x.length * 0.9)] - s[Math.floor(x.length * 0.1)]) * m.beta[1];
    effects.push({ key, marks });
  }

  const attSorted = withRes.map((r) => r.att).filter((v): v is number => v != null).sort((a, b) => a - b);

  return {
    students: rows.length,
    withResult: withRes.length,
    attMedian: attSorted.length ? attSorted[Math.floor(attSorted.length / 2)] : null,
    correlations,
    tertiles,
    bands,
    below85,
    levels,
    senior: seniorC,
    effects,
    sanityR: corr(rows, "att", "hwAbsent").r,
    longAbsent: rows.filter(isLongAbsent).length,
    absenceDays: rows.reduce((s, r) => s + r.absentDays, 0),
    points: withRes.map((r) => ({ level: r.level, att: r.att, hwDone: r.hwDone, result: r.pct as number })),
  };
}
