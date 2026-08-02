/**
 * CO-14 rota — the PURE half (D-#426).
 *
 * The rule this file exists to enforce: **the model chooses and narrates; it never
 * computes.** Everything a rota row actually asserts — which dates are school days,
 * which of a teacher's classes exist on a given weekday, the period number, the clock
 * time — is produced here, deterministically, BEFORE any model is called. The model's
 * only output is a set of candidate ids drawn from the list this file builds, so a
 * hallucinated slot is not an error to catch: it is unrepresentable.
 *
 * The second half of the rule is that the model's answer is then checked back against
 * the same server-built set. `validateRota` is that check. It is deliberately pure and
 * exhaustive — every violation is named, because the caller shows them to a human
 * instead of a plausible-looking wrong table (there is no fallback rota by design).
 *
 * No DB, no clock, no I/O — `ObservationRotaService` supplies the data.
 */
import { dateKeyOf } from "../attendance/dates";

// ---------------------------------------------------------------------------
// Candidates — one concrete, dated, teachable session
// ---------------------------------------------------------------------------

export interface RotaCandidate {
  /** Stable within a generation: `${date}#${slotId}`. The ONLY thing the model returns. */
  id: string;
  /** YYYY-MM-DD. */
  date: string;
  dayOfWeek: string;
  teacherId: string;
  teacherName: string;
  sectionId: string | null;
  subjectGroupId: string | null;
  /** Roster class level (1–5 for an eligible row); null for a cross-grade group. */
  classLevel: number | null;
  /** Human anchor, e.g. "চতুর্থ শ্রেণি · সম্মিলিত". */
  groupLabel: string;
  subject: string;
  periodNumber: number;
  startHHMM: string;
  endHHMM: string;
}

/** What the model says it understood from the instruction — checked, and shown to the
 *  user so "did it understand me?" is answered on screen rather than assumed. */
export interface RotaConstraintEcho {
  /** A teacher reviewed on a fixed cadence, e.g. every 2nd school day. */
  intensive: Array<{ teacherName: string; everyNDays: number; rotateClasses: boolean }>;
  excluded: Array<{ teacherName: string; reason: string | null }>;
  caps: Array<{ teacherName: string; max: number; window: string | null }>;
  classLevels: number[];
  perDay: number;
}

export interface RotaRow {
  date: string;
  candidateId: string;
  reason: string | null;
}

export const EMPTY_ECHO: RotaConstraintEcho = {
  intensive: [],
  excluded: [],
  caps: [],
  classLevels: [1, 2, 3, 4, 5],
  perDay: 1,
};

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Every calendar date from `from` to `to` inclusive, as local midnights. Both bounds
 *  are YYYY-MM-DD; an inverted range yields []. */
export function datesInRange(from: string, to: string): Date[] {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const start = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  const out: Date[] = [];
  for (let d = start; d.getTime() <= end.getTime(); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    out.push(d);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Candidate construction (pure — the caller supplies resolved slots + times)
// ---------------------------------------------------------------------------

/** A routine slot flattened to what candidate-building needs. */
export interface SlotForRota {
  slotId: string;
  teacherId: string | null;
  teacherName: string;
  sectionId: string | null;
  subjectGroupId: string | null;
  classLevel: number | null;
  groupLabel: string;
  subject: string;
  periodNumber: number;
  isBreak: boolean;
}

export interface PeriodClock {
  number: number;
  startHHMM: string;
  endHHMM: string;
}

export interface CandidateFilter {
  /** Roster levels a review may target. Nursery (-1) and KG (0) are excluded by
   *  passing [1,2,3,4,5] — the owner's rule, not a default of this function. */
  classLevels: number[];
  excludeTeacherIds: string[];
}

/**
 * Build the candidates for ONE date. A slot becomes a candidate only when it teaches,
 * has a teacher, sits in an allowed class level, that teacher is not excluded, and the
 * period grid actually has a clock time for its period number — an unmatched period is
 * dropped rather than guessed, since a rota row without a real time is worse than a
 * missing option.
 */
export function candidatesForDate(
  date: Date,
  dayOfWeek: string,
  slots: SlotForRota[],
  periods: PeriodClock[],
  filter: CandidateFilter,
): RotaCandidate[] {
  const dateKey = dateKeyOf(date);
  const clock = new Map(periods.map((p) => [p.number, p]));
  const out: RotaCandidate[] = [];
  for (const s of slots) {
    if (s.isBreak) continue;
    if (!s.teacherId) continue;
    if (filter.excludeTeacherIds.includes(s.teacherId)) continue;
    if (s.classLevel === null || !filter.classLevels.includes(s.classLevel)) continue;
    const c = clock.get(s.periodNumber);
    if (!c) continue;
    out.push({
      id: `${dateKey}#${s.slotId}`,
      date: dateKey,
      dayOfWeek,
      teacherId: s.teacherId,
      teacherName: s.teacherName,
      sectionId: s.sectionId,
      subjectGroupId: s.subjectGroupId,
      classLevel: s.classLevel,
      groupLabel: s.groupLabel,
      subject: s.subject,
      periodNumber: s.periodNumber,
      startHHMM: c.startHHMM,
      endHHMM: c.endHHMM,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation — the model's answer, checked against the server's own set
// ---------------------------------------------------------------------------

/**
 * Check a proposed rota. Returns a list of human-readable violations; empty means the
 * rota is usable. Every check is against data the SERVER produced (`candidates`,
 * `schoolDays`) or the model's own restatement (`echo`) — never against the prose
 * instruction, which is not machine-checkable.
 *
 * Ordering matters: id/date integrity first, because a row pointing at a candidate that
 * does not exist makes every later check meaningless for that row.
 */
export function validateRota(
  rows: RotaRow[],
  candidates: RotaCandidate[],
  schoolDays: string[],
  echo: RotaConstraintEcho,
): string[] {
  const problems: string[] = [];
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const resolved: Array<{ row: RotaRow; cand: RotaCandidate }> = [];

  // --- 1. every id exists, and its date agrees with the row's -----------------
  for (const r of rows) {
    const cand = byId.get(r.candidateId);
    if (!cand) {
      problems.push(`${r.date}: no such session "${r.candidateId}" — it is not in the candidate list.`);
      continue;
    }
    if (cand.date !== r.date) {
      problems.push(`${r.date}: that session is on ${cand.date}, not ${r.date}.`);
      continue;
    }
    resolved.push({ row: r, cand });
  }

  // --- 2. exactly perDay per school day, none missing, none doubled -----------
  const perDay = echo.perDay > 0 ? echo.perDay : 1;
  const byDate = new Map<string, number>();
  for (const { cand } of resolved) byDate.set(cand.date, (byDate.get(cand.date) ?? 0) + 1);
  for (const day of schoolDays) {
    const n = byDate.get(day) ?? 0;
    if (n < perDay) problems.push(`${day}: ${n} session(s) scheduled, expected ${perDay}.`);
    if (n > perDay) problems.push(`${day}: ${n} sessions scheduled, expected ${perDay}.`);
  }
  for (const [day] of byDate) {
    if (!schoolDays.includes(day)) problems.push(`${day} is not a school day in this range.`);
  }

  // --- 3. class levels --------------------------------------------------------
  for (const { cand } of resolved) {
    if (cand.classLevel === null || !echo.classLevels.includes(cand.classLevel)) {
      problems.push(`${cand.date}: ${cand.groupLabel} is outside the allowed classes.`);
    }
  }

  // --- 4. excluded teachers ---------------------------------------------------
  for (const ex of echo.excluded) {
    const hit = resolved.filter(({ cand }) => sameName(cand.teacherName, ex.teacherName));
    for (const h of hit) problems.push(`${h.cand.date}: ${ex.teacherName} is excluded${ex.reason ? ` (${ex.reason})` : ""}.`);
  }

  // --- 5. caps ----------------------------------------------------------------
  for (const cap of echo.caps) {
    const mine = resolved.filter(({ cand }) => sameName(cand.teacherName, cap.teacherName));
    if (mine.length > cap.max) {
      problems.push(`${cap.teacherName} has ${mine.length} sessions, capped at ${cap.max}.`);
    }
    if (cap.window === "first-half" && mine.length) {
      const late = mine.filter(({ cand }) => Number(cand.date.slice(8, 10)) > 15);
      for (const l of late) {
        problems.push(`${cap.teacherName}: ${l.cand.date} is outside the first half of the month.`);
      }
    }
  }

  // --- 6. the intensive teacher's cadence + class rotation --------------------
  for (const it of echo.intensive) {
    const mine = resolved
      .filter(({ cand }) => sameName(cand.teacherName, it.teacherName))
      .sort((a, b) => a.cand.date.localeCompare(b.cand.date));
    if (!mine.length) {
      problems.push(`${it.teacherName} was to be reviewed every ${it.everyNDays} school days but has no sessions.`);
      continue;
    }
    // Spacing is measured in SCHOOL days, not calendar days — a weekend is not a gap.
    const idx = mine.map(({ cand }) => schoolDays.indexOf(cand.date)).filter((i) => i >= 0);
    for (let i = 1; i < idx.length; i++) {
      const gap = idx[i] - idx[i - 1];
      if (gap !== it.everyNDays) {
        problems.push(
          `${it.teacherName}: ${mine[i].cand.date} is ${gap} school day(s) after the previous one, expected ${it.everyNDays}.`,
        );
      }
    }
    if (it.rotateClasses) {
      const counts = new Map<string, number>();
      for (const { cand } of mine) counts.set(cand.groupLabel + "|" + cand.subject, (counts.get(cand.groupLabel + "|" + cand.subject) ?? 0) + 1);
      const values = [...counts.values()];
      if (values.length > 1 && Math.max(...values) - Math.min(...values) > 1) {
        problems.push(
          `${it.teacherName}: classes are not evenly rotated (${[...counts.entries()].map(([k, v]) => `${k.split("|")[0]} ×${v}`).join(", ")}).`,
        );
      }
    }
  }

  return problems;
}

/** Loose name match — the model echoes the name it was shown, but casing/extra spaces
 *  should not turn a real constraint into a silent no-op. */
function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Normalise whatever the model returned into the echo shape, filling defaults. A
 *  missing/garbled echo must not crash validation — it degrades to "no constraints
 *  claimed", and the day-coverage checks still bite. */
export function normalizeEcho(raw: unknown): RotaConstraintEcho {
  const o = (raw ?? {}) as Record<string, unknown>;
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  return {
    intensive: arr(o.intensive).map((x) => {
      const r = x as Record<string, unknown>;
      return {
        teacherName: String(r.teacherName ?? ""),
        everyNDays: Number(r.everyNDays ?? 0) || 1,
        rotateClasses: Boolean(r.rotateClasses),
      };
    }).filter((x) => x.teacherName),
    excluded: arr(o.excluded).map((x) => {
      const r = x as Record<string, unknown>;
      return { teacherName: String(r.teacherName ?? ""), reason: r.reason ? String(r.reason) : null };
    }).filter((x) => x.teacherName),
    caps: arr(o.caps).map((x) => {
      const r = x as Record<string, unknown>;
      return {
        teacherName: String(r.teacherName ?? ""),
        max: Number(r.max ?? 0) || 0,
        window: r.window ? String(r.window) : null,
      };
    }).filter((x) => x.teacherName && x.max > 0),
    classLevels: arr(o.classLevels).map(Number).filter((n) => Number.isFinite(n)).length
      ? arr(o.classLevels).map(Number).filter((n) => Number.isFinite(n))
      : [1, 2, 3, 4, 5],
    perDay: Number(o.perDay ?? 1) || 1,
  };
}
