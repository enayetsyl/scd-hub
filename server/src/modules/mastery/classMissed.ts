/**
 * "ক্লাস মিস" (AL-10, PRD §5 E3, R11, AC-E1) — a display over D-#950's missed lessons.
 *
 * An objective the child was ABSENT for on a day it was taught (`ObjectiveLessonStatus` MISSED) and that has no
 * evidence since the first missed day reads "ক্লাস মিস" — not WEAK, not "not assessed". After the child's first
 * live evidence row on it (confirmed homework / assignment / class-test / in-class item, on or after the missed day)
 * the normal state shows. A DISPLAY rule only: it changes no mastery state, no suggestion and no policy.
 *
 * Release switch (§3.6): with `academicLoop2027On` OFF nothing is marked (the 2026 views are byte-for-byte unchanged).
 */
import { Types } from "mongoose";
import { MasteryEvidence } from "./models/MasteryEvidence";
import { isLoop2027On } from "../assessment/services/QuestionUseService";
import { dhakaDayKey } from "../../lib/dhakaDay";

/** The ONE state rule (guardian and staff): "ক্লাস মিস" replaces only a state that says "not known / weak yet". */
export const CLASS_MISSED_STATES: ReadonlySet<string> = new Set(["WEAK", "NOT_ASSESSED", "INSUFFICIENT"]);

/** The minimum of a lesson row the rule reads. */
export interface MissedLessonLike {
  loCode: string;
  status: string;
  absentOn: string[];
}

/**
 * Pure rule. `evidenceDays` = the Dhaka day keys of the child's live evidence on the objective (own code or its
 * sub-objectives). True when the child missed a taught day and no evidence is dated on / after the FIRST missed day.
 */
export function isClassMissed(lesson: Pick<MissedLessonLike, "status" | "absentOn">, evidenceDays: readonly string[]): boolean {
  if (lesson.status !== "MISSED" || lesson.absentOn.length === 0) return false;
  const first = [...lesson.absentOn].sort()[0]!;
  return !evidenceDays.some((d) => d >= first);
}

/**
 * The codes (of `lessons`) that read "ক্লাস মিস" for this child. `evidenceCodesOf` maps a lesson code to every code whose
 * evidence counts for it (the objective itself plus its sub-objectives); omitted = just itself.
 */
export async function classMissedCodes(
  studentId: string,
  lessons: readonly MissedLessonLike[],
  evidenceCodesOf?: (code: string) => readonly string[],
  /** The objective's mastery state for this child; with it only a CLASS_MISSED_STATES row can read "ক্লাস মিস". */
  stateOf?: (code: string) => string | undefined,
): Promise<Set<string>> {
  const out = new Set<string>();
  const candidates = lessons.filter(
    (l) => l.status === "MISSED" && l.absentOn.length > 0 && (!stateOf || CLASS_MISSED_STATES.has(stateOf(l.loCode) ?? "NOT_ASSESSED")),
  );
  if (candidates.length === 0 || !Types.ObjectId.isValid(studentId)) return out;
  if (!(await isLoop2027On())) return out;
  const codesFor = (c: string) => (evidenceCodesOf ? [...new Set([c, ...evidenceCodesOf(c)])] : [c]);
  const all = [...new Set(candidates.flatMap((l) => codesFor(l.loCode)))];
  const rows = await MasteryEvidence.find({
    studentId: new Types.ObjectId(studentId),
    loCode: { $in: all },
    supersededAt: null,
    excludedAt: null,
    // Routed strand rows count too (same as the diagnosis): practice on a skill strand is evidence.
  })
    .select("loCode at")
    .lean();
  const daysBy = new Map<string, string[]>();
  for (const r of rows) daysBy.set(r.loCode, [...(daysBy.get(r.loCode) ?? []), dhakaDayKey(r.at)]);
  for (const l of candidates) {
    const days = codesFor(l.loCode).flatMap((c) => daysBy.get(c) ?? []);
    if (isClassMissed(l, days)) out.add(l.loCode);
  }
  return out;
}
