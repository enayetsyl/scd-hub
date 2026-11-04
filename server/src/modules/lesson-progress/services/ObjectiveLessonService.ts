/**
 * OT-5 — lesson plans carry objective codes (docs/prd-objective-tree.md §8.3, D-#949–#951).
 *
 *  - `deliveredCodes`          — the codes one marked session taught: its marking snapshot, else the
 *                                CURRENT plan's codes for the same stable key (D-#949), so classes marked
 *                                before a plan was re-imported with codes (OT-6) still count.
 *  - `sectionObjectiveRows`    — one শাখা × subject, per tagged row: the days it was taught (or not yet)
 *                                and who on that day's roster was absent (mock 6 "শাখার অবস্থা").
 *  - `studentObjectiveLessons` — one child × subject, per code: TAUGHT / MISSED / UNKNOWN / NOT_TAUGHT.
 *                                It is what splits a WEAK row into "taught, not yet learnt" vs "missed
 *                                that class" vs "not taught yet" (D-#950).
 *
 * Presence reads the attendance units each delivery snapshotted (D-#823 — C1–5 day attendance is on
 * the Quran group), never raw section attendance. Every gate is the caller's.
 *
 * Operational plane (names students); no corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { MASTERY_CLASS_TOKENS } from "@scd/shared";
import { personName } from "../../../lib/personName";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";
import { Student } from "../../foundation/models/Student";
import { StudentAttendanceDay } from "../../attendance/models/StudentAttendanceDay";
import { resolveUnitsForIds } from "../../attendance/attendanceUnit";
import { MasteryOutcome } from "../../mastery/models/MasteryOutcome";
import { LessonDelivery, type ILessonDelivery, type ILessonDeliverySession } from "../models/LessonDelivery";
import { LessonProgressError, sessionKey, sessionPlansFor, type PlanSession } from "./LessonDeliveryService";
import { dayRecords, presenceOf } from "./StudentLessonService";

/** True when a session that taught `taught` covers the row `code`: the code itself, or one of its
 *  `.N` sub-objectives (an untagged objective row is covered by its children). Pure. */
export function codeCovers(code: string, taught: string): boolean {
  return taught === code || taught.startsWith(`${code}.`);
}

/** Per stable key, the plan's current codes. */
function planCodeMap(plan: PlanSession[]): Map<string, string[]> {
  return new Map(plan.map((p) => [p.key, p.loCodes]));
}

/** The codes one delivered session taught (D-#949): the snapshot, else the current plan's. Pure. */
export function deliveredCodes(s: Pick<ILessonDeliverySession, "chapter" | "sessionIndex" | "loCodes">, planCodes: Map<string, string[]>): string[] {
  if (s.loCodes && s.loCodes.length) return s.loCodes;
  return planCodes.get(sessionKey(s.chapter, s.sessionIndex)) ?? [];
}

const numericCompare = (a: string, b: string): number => a.localeCompare(b, "en", { numeric: true });

// ---------------------------------------------------------------------------
// One শাখা × subject
// ---------------------------------------------------------------------------

export interface ObjectiveDay {
  dateKey: string;
  /** false = some attendance unit had no record that day — nobody beyond the listed names is known absent. */
  attendanceTaken: boolean;
  absent: Array<{ studentId: string; name: string }>;
}

export interface SectionObjectiveRow {
  code: string;
  /** null = the code is not in the catalogue (yet). */
  labelBn: string | null;
  chapterNumber: number | null;
  inCatalogue: boolean;
  /** The plan sessions that carry this code, in book order. */
  sessions: Array<{ key: string; chapter: string; anchorWord: string; sessionIndex: number; sessionOf: number; titleBn: string }>;
  /** Days this শাখা was taught it, oldest first; [] = not taught yet. */
  taught: ObjectiveDay[];
  /** Distinct students absent on at least one of those days. */
  absentCount: number;
}

type DeliveryRow = Pick<ILessonDelivery, "noteId" | "dateKey" | "sessions" | "rosterStudentIds" | "attendanceUnits">;

/**
 * Who on each delivery's roster was listed absent, from the units it snapshotted (an older row with
 * no snapshot reads its roster's CURRENT units). `recorded` = every unit had a record that day.
 */
async function absencesByNote(deliveries: DeliveryRow[]): Promise<Map<string, { absent: Set<string>; recorded: boolean }>> {
  const out = new Map<string, { absent: Set<string>; recorded: boolean }>();
  if (deliveries.length === 0) return out;
  const unitsOf = new Map<string, string[]>();
  const legacy = deliveries.filter((d) => !d.attendanceUnits?.length);
  if (legacy.length) {
    const now = await resolveUnitsForIds([...new Set(legacy.flatMap((d) => d.rosterStudentIds.map(String)))]);
    for (const d of legacy) {
      const units = d.rosterStudentIds.map((s) => now.get(String(s))).filter((u): u is NonNullable<typeof u> => !!u);
      unitsOf.set(String(d.noteId), [...new Set(units.map((u) => `${u.unitType}:${u.unitId}`))]);
    }
  }
  for (const d of deliveries) if (d.attendanceUnits?.length) unitsOf.set(String(d.noteId), d.attendanceUnits);

  const daysByUnit = new Map<string, Set<string>>();
  for (const d of deliveries) for (const u of unitsOf.get(String(d.noteId)) ?? []) daysByUnit.set(u, (daysByUnit.get(u) ?? new Set()).add(d.dateKey));
  const or = [...daysByUnit.entries()].flatMap(([u, days]) => {
    const [type, id] = u.split(":");
    if (!Types.ObjectId.isValid(id)) return [];
    return [{ [type === "subjectgroup" ? "subjectGroupId" : "sectionId"]: new Types.ObjectId(id), dateKey: { $in: [...days] } }];
  });
  const recs = or.length
    ? ((await StudentAttendanceDay.find({ $or: or }).select("sectionId subjectGroupId dateKey absentStudentIds").lean()) as unknown as Array<{
        sectionId?: Types.ObjectId;
        subjectGroupId?: Types.ObjectId;
        dateKey: string;
        absentStudentIds: Types.ObjectId[];
      }>)
    : [];
  const byKey = new Map(recs.map((r) => [`${r.subjectGroupId ? `subjectgroup:${r.subjectGroupId}` : `section:${r.sectionId}`}|${r.dateKey}`, r]));
  for (const d of deliveries) {
    const units = unitsOf.get(String(d.noteId)) ?? [];
    const roster = new Set(d.rosterStudentIds.map(String));
    const absent = new Set<string>();
    let recorded = units.length > 0;
    for (const u of units) {
      const r = byKey.get(`${u}|${d.dateKey}`);
      if (!r) {
        recorded = false;
        continue;
      }
      for (const s of r.absentStudentIds) if (roster.has(String(s))) absent.add(String(s));
    }
    out.set(String(d.noteId), { absent, recorded });
  }
  return out;
}

async function levelOfSection(sectionId: string): Promise<number> {
  const sec = await Section.findById(sectionId).select("classId").lean();
  const cls = sec ? await Class.findById(sec.classId).select("level").lean() : null;
  if (!sec || typeof cls?.level !== "number") throw new LessonProgressError("শাখা পাওয়া যায়নি।");
  return cls.level;
}

/**
 * Per objective row of one শাখা × subject. Rows = every code the plan carries, plus (unless
 * `planOnly`) every tagged, unretired catalogue row of the class × subject and any code a past mark
 * snapshotted; `codes` narrows to those (and their children's marks).
 */
export async function sectionObjectiveRows(
  sectionId: string,
  subject: string,
  opts: { classLevel?: number | null; codes?: string[] | null; planOnly?: boolean } = {},
): Promise<SectionObjectiveRow[]> {
  if (!Types.ObjectId.isValid(sectionId)) throw new LessonProgressError("শাখা পাওয়া যায়নি।");
  const level = opts.classLevel ?? (await levelOfSection(sectionId));
  const plan = await sessionPlansFor(level, subject);
  const planCodes = planCodeMap(plan);
  const planCodeSet = new Set(plan.flatMap((p) => p.loCodes));
  if (opts.planOnly && planCodeSet.size === 0) return [];

  const token = `C${level}`;
  const catalogue = (MASTERY_CLASS_TOKENS as readonly string[]).includes(token)
    ? ((await MasteryOutcome.find({ classToken: token, subject, status: { $ne: "RETIRED" } })
        .select("code labelBn chapterNumber tagged order")
        .lean()) as unknown as Array<{ code: string; labelBn: string; chapterNumber: number | null; tagged?: boolean; order: number }>)
    : [];
  const catBy = new Map(catalogue.map((o) => [o.code, o]));

  const deliveries = (await LessonDelivery.find({ sectionId: new Types.ObjectId(sectionId), subject, "sessions.0": { $exists: true } })
    .select("noteId dateKey sessions rosterStudentIds attendanceUnits")
    .sort({ dateKey: 1 })
    .lean()) as unknown as DeliveryRow[];
  const taughtBy = new Map<string, DeliveryRow[]>();
  for (const d of deliveries) {
    const codes = new Set(d.sessions.flatMap((s) => deliveredCodes(s, planCodes)));
    for (const c of codes) taughtBy.set(c, [...(taughtBy.get(c) ?? []), d]);
  }

  let universe = new Set<string>(planCodeSet);
  if (!opts.planOnly) {
    for (const o of catalogue) if (o.tagged !== false) universe.add(o.code);
    for (const c of taughtBy.keys()) universe.add(c);
  }
  if (opts.codes) {
    const want = new Set(opts.codes);
    universe = new Set([...universe].filter((c) => want.has(c)));
    for (const c of want) if (catBy.has(c) || planCodeSet.has(c)) universe.add(c);
  }
  if (universe.size === 0) return [];

  const rowDeliveries = new Map<string, DeliveryRow[]>();
  for (const code of universe) {
    const seen = new Set<string>();
    const list: DeliveryRow[] = [];
    for (const [taught, ds] of taughtBy) {
      if (!codeCovers(code, taught)) continue;
      for (const d of ds) {
        if (seen.has(String(d.noteId))) continue;
        seen.add(String(d.noteId));
        list.push(d);
      }
    }
    rowDeliveries.set(code, list.sort((a, b) => a.dateKey.localeCompare(b.dateKey)));
  }
  const used = [...new Map([...rowDeliveries.values()].flat().map((d) => [String(d.noteId), d])).values()];
  const absences = await absencesByNote(used);
  const absentIds = [...new Set([...absences.values()].flatMap((a) => [...a.absent]))];
  const names = new Map(
    ((await Student.find({ _id: { $in: absentIds.map((id) => new Types.ObjectId(id)) } }).select("name nameBn").lean()) as unknown as Array<{
      _id: Types.ObjectId;
      name?: string;
      nameBn?: string;
    }>).map((s) => [String(s._id), personName(s)]),
  );

  const rows: SectionObjectiveRow[] = [...universe].map((code) => {
    const cat = catBy.get(code);
    const byDay = new Map<string, { absent: Set<string>; recorded: boolean }>();
    for (const d of rowDeliveries.get(code) ?? []) {
      const a = absences.get(String(d.noteId)) ?? { absent: new Set<string>(), recorded: false };
      const day = byDay.get(d.dateKey) ?? { absent: new Set<string>(), recorded: true };
      for (const s of a.absent) day.absent.add(s);
      day.recorded = day.recorded && a.recorded;
      byDay.set(d.dateKey, day);
    }
    const taught: ObjectiveDay[] = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateKey, v]) => ({
        dateKey,
        attendanceTaken: v.recorded,
        absent: [...v.absent].map((id) => ({ studentId: id, name: names.get(id) ?? "" })).sort((x, y) => x.name.localeCompare(y.name)),
      }));
    return {
      code,
      labelBn: cat?.labelBn ?? null,
      chapterNumber: cat?.chapterNumber ?? null,
      inCatalogue: !!cat,
      sessions: plan
        .filter((p) => p.loCodes.some((c) => codeCovers(code, c)))
        .map((p) => ({ key: p.key, chapter: p.chapter, anchorWord: p.anchorWord, sessionIndex: p.sessionIndex, sessionOf: p.sessionOf, titleBn: p.titleBn })),
      taught,
      absentCount: new Set(taught.flatMap((t) => t.absent.map((a) => a.studentId))).size,
    };
  });
  // Catalogue order (chapter, then the file's order); codes the catalogue does not know go last by code.
  return rows.sort((a, b) => {
    const ca = catBy.get(a.code);
    const cb = catBy.get(b.code);
    if (ca && cb) return (ca.chapterNumber ?? 9999) - (cb.chapterNumber ?? 9999) || ca.order - cb.order || numericCompare(a.code, b.code);
    if (ca !== cb) return ca ? -1 : 1;
    return numericCompare(a.code, b.code);
  });
}

// ---------------------------------------------------------------------------
// One child × subject
// ---------------------------------------------------------------------------

/**
 * TAUGHT     taught while the child was on the roster, present (no recorded absence on those days)
 * MISSED     absent on at least one day it was taught (D-#950 — mirrors D-#825's "missed a session")
 * UNKNOWN    taught, but attendance was not taken on any of those days — never assumed present
 * NOT_TAUGHT no marked class of the child's শাখা taught it (while they were on its roster)
 */
export type ObjectiveLessonStatus = "TAUGHT" | "MISSED" | "UNKNOWN" | "NOT_TAUGHT";

export interface StudentObjectiveLesson {
  loCode: string;
  status: ObjectiveLessonStatus;
  taughtOn: string[];
  absentOn: string[];
  /** Every absence leave-covered (ছুটিতে). */
  onLeave: boolean;
}

/** Status from the presence of the taught days. Pure. */
export function objectiveStatusOf(p: { presence: string; absentOn: string[] }, taughtOn: string[]): ObjectiveLessonStatus {
  if (taughtOn.length === 0) return "NOT_TAUGHT";
  if (p.absentOn.length > 0) return "MISSED";
  return p.presence === "UNKNOWN" ? "UNKNOWN" : "TAUGHT";
}

/**
 * The child's lesson status for each of `codes` (one subject). A delivery counts only when its
 * roster snapshot holds the child (a moved child keeps the old শাখা's classes, D-#823).
 */
export async function studentObjectiveLessons(studentId: string, subject: string, codes: string[]): Promise<StudentObjectiveLesson[]> {
  if (!Types.ObjectId.isValid(studentId) || codes.length === 0) return [];
  const deliveries = (await LessonDelivery.find({ rosterStudentIds: new Types.ObjectId(studentId), subject, "sessions.0": { $exists: true } })
    .select("classLevel dateKey sessions attendanceUnits")
    .lean()) as unknown as Array<Pick<ILessonDelivery, "classLevel" | "dateKey" | "sessions" | "attendanceUnits">>;

  // The current plan only matters for sessions marked without a snapshot.
  const planCodes = new Map<number, Map<string, string[]>>();
  for (const level of new Set(deliveries.filter((d) => d.sessions.some((s) => !s.loCodes?.length)).map((d) => d.classLevel))) {
    planCodes.set(level, planCodeMap(await sessionPlansFor(level, subject)));
  }
  const daysBy = new Map<string, Set<string>>();
  for (const d of deliveries) {
    const map = planCodes.get(d.classLevel) ?? new Map<string, string[]>();
    for (const s of d.sessions) for (const c of deliveredCodes(s, map)) daysBy.set(c, (daysBy.get(c) ?? new Set()).add(d.dateKey));
  }
  const taughtFor = (code: string): string[] => {
    const days = new Set<string>();
    for (const [c, ds] of daysBy) if (codeCovers(code, c)) for (const k of ds) days.add(k);
    return [...days].sort();
  };
  const perCode = codes.map((code) => ({ code, taughtOn: taughtFor(code) }));
  const allDays = [...new Set(perCode.flatMap((p) => p.taughtOn))].sort();
  const records = allDays.length ? await dayRecords(studentId, allDays, deliveries) : new Map();
  return perCode.map(({ code, taughtOn }) => {
    const p = presenceOf(taughtOn, records);
    return { loCode: code, status: objectiveStatusOf(p, taughtOn), taughtOn, absentOn: p.absentOn, onLeave: p.onLeave };
  });
}
