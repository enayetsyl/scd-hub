/**
 * Personas of the realistic term (docs/dev-test-scenarios-2027.md sections 1 and 3). Pure: no database, no clock.
 *
 * A child persona (TYPICAL, C1..C7) fixes the child's absence, homework / assignment miss and class-test ability; a teacher persona
 * (T1..T4) fixes how often class notes are made, how late homework and assignments are marked and how often the teacher is on
 * leave. The numbers come from the 2026 read in section 1: absence mean 10.8 % (Sun 13.4, Mon 13.2, Tue 11.7, Wed 10.0, Thu 12.4),
 * homework non-submission p50 19 % / p90 47 %, assignment miss p50 8 %, class tests mean 68 % (C3 weakest, 53 %).
 */

export type ChildPersona = "TYPICAL" | "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C7";
export type TeacherPersona = "T1" | "T2" | "T3" | "T4";

export interface ChildSpec {
  code: ChildPersona;
  label: string;
  /** Chance of being absent on an ordinary day (before the weekday factor). */
  absence: number;
  /** Chance of not handing in a homework / not doing a weekly assignment. */
  hwMiss: number;
  asMiss: number;
  /** Share of the marks the child gets right in class (0..1); C3 climbs over the term (see `abilityOn`). */
  ability: number;
}

export const CHILD_PERSONAS: Record<ChildPersona, ChildSpec> = {
  TYPICAL: { code: "TYPICAL", label: "typical child", absence: 0.105, hwMiss: 0.2, asMiss: 0.07, ability: 0.72 },
  C1: { code: "C1", label: "steady child", absence: 0.05, hwMiss: 0.05, asMiss: 0.03, ability: 0.88 },
  C2: { code: "C2", label: "struggling child", absence: 0.12, hwMiss: 0.25, asMiss: 0.15, ability: 0.4 },
  C3: { code: "C3", label: "improver", absence: 0.09, hwMiss: 0.12, asMiss: 0.07, ability: 0.45 },
  C4: { code: "C4", label: "long illness (one 2-3 week streak)", absence: 0.07, hwMiss: 0.12, asMiss: 0.07, ability: 0.7 },
  C5: { code: "C5", label: "chronic absentee", absence: 0.32, hwMiss: 0.35, asMiss: 0.25, ability: 0.55 },
  C6: { code: "C6", label: "homework skipper", absence: 0.1, hwMiss: 0.45, asMiss: 0.3, ability: 0.7 },
  C7: { code: "C7", label: "outside help at home", absence: 0.08, hwMiss: 0.08, asMiss: 0.04, ability: 0.48 },
};

/** Sun..Thu absence factors: the 2026 weekday means (13.4, 13.2, 11.7, 10.0, 12.4 %) over THEIR OWN mean (12.14 %), so a persona's rate stays its mean. */
export const WEEKDAY_ABSENCE_FACTOR = [13.4, 13.2, 11.7, 10.0, 12.4].map((x) => x / 12.14);

/** Class-level difficulty (C3 is the weakest level of 2026: mean 53 % against 68 % overall). */
export const LEVEL_ABILITY_FACTOR: Record<number, number> = { [-1]: 1.2, 0: 1.1, 1: 1.0, 2: 1.0, 3: 0.78, 4: 1.0, 5: 0.96 };

/** Homework share per subject (uneven on purpose: ENG most, BAN rarely in C2/C3, ISLAM seldom). Weight = chance a section gives one that day. */
export const SUBJECT_HW_WEIGHT: Record<string, number> = { ENG: 0.5, MATH: 0.35, BAN: 0.18, ISLAM: 0.08, SCI: 0.12, BGS: 0.1, ICT: 0.05 };
/** C2 / C3 BAN got only 8-10 homeworks a year in 2026. */
export const hwWeight = (subject: string, level: number): number => {
  const base = SUBJECT_HW_WEIGHT[subject] ?? 0.1;
  return subject === "BAN" && (level === 2 || level === 3) ? 0.04 : base;
};

export interface TeacherSpec {
  code: TeacherPersona;
  label: string;
  /** Chance a taught period gets its class note the same day. */
  noteRate: number;
  /** Homework marking (the confirm): school days after the hand-in, [min, max]; `skipRate` = chance it is never confirmed. */
  hwDelay: [number, number];
  hwSkipRate: number;
  /** Weekly assignment marking: school days after the due day, [min, max] (a late marker goes past Tuesday). */
  asDelay: [number, number];
  /** Finalise the Wednesday draft: school days after the draft, [min, max] (Thu = 1). */
  finaliseDelay: [number, number];
  /** Expected leave days over the term (the 2026 spread: p50 6, p90 21 per year). */
  leaveDays: number;
  /** Chance the teacher edits a draft sheet (swap / remove / add) before finalising. */
  editRate: number;
}

export const TEACHER_PERSONAS: Record<TeacherPersona, TeacherSpec> = {
  T1: { code: "T1", label: "diligent", noteRate: 0.95, hwDelay: [0, 0], hwSkipRate: 0.02, asDelay: [0, 0], finaliseDelay: [1, 1], leaveDays: 3, editRate: 0.12 },
  T2: { code: "T2", label: "late marker", noteRate: 0.85, hwDelay: [2, 4], hwSkipRate: 0.1, asDelay: [2, 5], finaliseDelay: [1, 2], leaveDays: 3, editRate: 0.1 },
  T3: { code: "T3", label: "notes skipper", noteRate: 0.55, hwDelay: [0, 2], hwSkipRate: 0.08, asDelay: [0, 2], finaliseDelay: [1, 1], leaveDays: 4, editRate: 0.05 },
  T4: { code: "T4", label: "leave-prone", noteRate: 0.9, hwDelay: [0, 1], hwSkipRate: 0.04, asDelay: [0, 1], finaliseDelay: [1, 1], leaveDays: 12, editRate: 0.1 },
};

export type Rng = () => number;

const shuffled = <T>(rng: Rng, items: T[]): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

/**
 * The persona of every child. Per class level (children = ids of that level): how many get each special persona scales with the
 * roster (a level with 3 children gets none), C2 is heavier at level 3 (the weak level), and the whole roster is then topped up so
 * every special persona exists at least once when the school is big enough. The rest are TYPICAL.
 */
export function assignChildPersonas(rng: Rng, byLevel: Map<number, string[]>): Map<string, ChildPersona> {
  const out = new Map<string, ChildPersona>();
  const levels = [...byLevel.keys()].sort((a, b) => a - b);
  for (const level of levels) {
    const kids = shuffled(rng, byLevel.get(level) ?? []);
    const n = kids.length;
    const want: Array<[ChildPersona, number]> = [
      ["C1", Math.round(n * 0.14)],
      ["C2", Math.round(n * (level === 3 ? 0.3 : 0.1))],
      ["C3", n >= 6 ? 1 : 0],
      ["C4", n >= 12 ? 2 : n >= 4 ? 1 : 0],
      ["C5", n >= 8 ? 1 : 0],
      ["C6", n >= 8 ? 1 : 0],
      ["C7", n >= 6 ? 1 : 0],
    ];
    let i = 0;
    for (const [p, k] of want) for (let j = 0; j < k && i < n; j++) out.set(kids[i++]!, p);
    while (i < n) out.set(kids[i++]!, "TYPICAL");
  }
  // every special persona at least once across the school (a small school may have missed one): take a TYPICAL child of a level
  const have = new Set(out.values());
  for (const p of ["C1", "C2", "C3", "C4", "C5", "C6", "C7"] as ChildPersona[]) {
    if (have.has(p)) continue;
    const spare = shuffled(rng, [...out.entries()].filter(([, v]) => v === "TYPICAL")).find(() => true);
    if (spare) out.set(spare[0], p);
  }
  return out;
}

/** Teachers by persona: about 45 % T1, 20 % T2, 20 % T3, 15 % T4, and each persona at least once when there are 4+ teachers. */
export function assignTeacherPersonas(rng: Rng, teacherIds: string[]): Map<string, TeacherPersona> {
  const out = new Map<string, TeacherPersona>();
  const ids = shuffled(rng, [...new Set(teacherIds)].sort());
  const n = ids.length;
  const t4 = n >= 4 ? Math.max(1, Math.round(n * 0.15)) : 0;
  const t3 = n >= 4 ? Math.max(1, Math.round(n * 0.2)) : 0;
  const t2 = n >= 4 ? Math.max(1, Math.round(n * 0.2)) : 0;
  let i = 0;
  for (const [p, k] of [["T4", t4], ["T3", t3], ["T2", t2]] as Array<[TeacherPersona, number]>) for (let j = 0; j < k && i < n; j++) out.set(ids[i++]!, p);
  while (i < n) out.set(ids[i++]!, "T1");
  return out;
}

/** The child's chance of being absent on this school day (0 = Sun .. 4 = Thu). `ctDay` lifts it to the 2026 class-test-day rate (14 %). */
export function absenceChance(spec: ChildSpec, weekday: number, ctDay = false): number {
  const base = spec.absence * (WEEKDAY_ABSENCE_FACTOR[weekday] ?? 1);
  return Math.min(0.9, ctDay ? base * 1.3 : base);
}

/** The ability on a day: C3 (the improver) climbs from the persona's 0.45 to 0.9 over the term; every other child keeps hers. */
export function abilityOn(spec: ChildSpec, termFraction: number): number {
  if (spec.code !== "C3") return spec.ability;
  return Math.min(0.92, spec.ability + (0.9 - spec.ability) * Math.max(0, Math.min(1, termFraction)));
}

/** Marks earned on one item of `available` for a child with this success chance (`p`): full, half (about a fifth of the misses) or none. */
export function itemMarks(rng: Rng, p: number, available: number): number {
  if (rng() < p) return available;
  return available >= 2 && rng() < 0.2 ? Math.floor(available / 2) : 0;
}

/** A whole number in [min, max] (inclusive) from `rng`. */
export const between = (rng: Rng, min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));

const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i]!;
};
export const pct = (values: number[], p: number): number => percentile([...values].sort((a, b) => a - b), p);
