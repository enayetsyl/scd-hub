/**
 * YC-6 - routine + schedule copy into the new year, a part of the year-change Prepare
 * (docs/prd-year-change.md section 3 step 1 items 6-7, owner rulings in brief 11).
 *
 * Five copies, each on by default with a Principal opt-out flag (`PlanInput.copy`):
 *   routine             every 2026 section's live slots -> the matching 2027 section (same level + section
 *                       code), `effectiveFrom` 2027-01-03; the copied 2026 rows get `effectiveTo` 2027-01-02.
 *                       Quran/Arabic GROUP slots stay exactly as they are. The conflict engine runs over
 *                       the copied set; any clash refuses the prepare and is listed.
 *   bell windows        the year's `ScheduleWindow` rows, dates shifted into the new year
 *   assignment schedule the new year's `AssignmentSchedule` (term start 2027-01-03, the rotation entries
 *                       mapped to the 2027 sections, dated)
 *   grants              routine teaching grants for the 2027 slots (the existing routine binding);
 *                       2026 routine grants lapse 2027-01-03; supervisory + delegation grants on a 2026
 *                       class are re-pointed to the same-level 2027 class (a 2027 copy + a lapse on the
 *                       2026 one, so nothing changes before the cut-over)
 *   mastery switches    `MasteryEnablement` rows for the new year, only where the tree is LOCKED
 *
 * Every row created carries the run's `runId`; `undoPrepare` removes them and puts the `effectiveTo` /
 * `expiresAt` it stamped back (recorded on the run). Nothing a "today" reader looks at changes: the
 * copies are future-dated or sit on next-year sections, and the stamped ends fall on the first day.
 *
 * Idempotent: a re-run of the same plan writes 0, and a changed 2026 routine is reconciled (copies
 * updated, added, or removed).
 */
import { Types } from "mongoose";
import { AcademicYear } from "../foundation/models/AcademicYear";
import { Class } from "../foundation/models/Class";
import { Section } from "../foundation/models/Section";
import { Subject } from "../foundation/models/Subject";
import { ScopeGrant } from "../foundation/models/ScopeGrant";
import { User } from "../foundation/models/User";
import { RoutineSlot, type IRoutineSlot } from "../routine/models/RoutineSlot";
import { ScheduleWindow } from "../routine/models/ScheduleWindow";
import { AssignmentSchedule } from "../trackers/models/AssignmentSchedule";
import { MasteryEnablement } from "../mastery/models/MasteryEnablement";
import { MasteryOutcome } from "../mastery/models/MasteryOutcome";
import { switchBlockedByReview } from "../mastery/services/MasteryReviewService";
import { detectConflicts, type SlotLite } from "../routine/conflicts";
import { routineGrantPlan, ROUTINE_GRANT_SUBJECTS } from "../routine/binding";
import { endOfDay, endOfDayBefore, liveWindow, startOfDay } from "../routine/liveWindow";
import { atMidnight, entryActiveOn } from "../trackers/assignmentCalendar";
import { dhakaDayKey } from "../../lib/dhakaDay";
import { YearChangeRun } from "./models/YearChangeRun";
import {
  LEVEL_NAME_BN,
  SECTION_LABEL_BN,
  type CopyOptions,
  type ScheduleCopyPlan,
  type SectionCode,
  type YearChangePlan,
} from "./types";
import type { DayOfWeek, MasteryClassToken, MasterySubject, PeriodTrack, RoutineSubject } from "@scd/shared";

interface GrantLite {
  _id: Types.ObjectId;
  teacherId: Types.ObjectId;
  sectionId: Types.ObjectId;
  subjectId: Types.ObjectId;
  expiresAt?: Date | null;
}
const sid = (id: unknown): string => String(id);
const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

export function resolveCopyOptions(o?: CopyOptions): Required<CopyOptions> {
  return {
    routine: o?.routine !== false,
    bellWindows: o?.bellWindows !== false,
    assignmentSchedule: o?.assignmentSchedule !== false,
    grants: o?.grants !== false,
    mastery: o?.mastery !== false,
  };
}

export function emptyScheduleCopy(o?: CopyOptions): ScheduleCopyPlan {
  return {
    options: resolveCopyOptions(o),
    fromKey: "",
    endKey: "",
    routine: { slotsToCreate: 0, slotsExisting: 0, slotsToUpdate: 0, slotsToRemove: 0, pastToEnd: 0, sections: [], unmapped: [], conflicts: [] },
    bellWindows: { toCreate: 0, existing: 0, toRemove: 0, skipped: null },
    assignment: { entries: 0, existing: false, skipped: null },
    grants: { routineTeachingToCreate: 0, routineTeachingExisting: 0, pastRoutineToExpire: 0, repointToCreate: 0, repointExisting: 0, pastRepointedToExpire: 0 },
    mastery: { toCreate: 0, existing: 0, skippedUnlocked: [] },
  };
}

interface YearLite {
  _id: Types.ObjectId;
  label: string;
  startDate: Date;
}

const keyDate = (key: string): Date => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
const labelOf = (level: number, code: string): string => `${LEVEL_NAME_BN[level] ?? `শ্রেণি ${level}`} ${SECTION_LABEL_BN[code as SectionCode] ?? code}`;

/** Everything the plan and the apply both need, computed once per call from the live rows. */
interface Computed {
  opts: Required<CopyOptions>;
  fromKey: string;
  endKey: string;
  /** Instant a 2026 grant lapses: the first routine day at Dhaka midnight. */
  expiryAt: Date;
  fromDate: Date;
  /** `effectiveTo` stamped on a copied 2026 slot. */
  endDate: Date;
  fromYear: YearLite;
  toYear: YearLite;
  fromClasses: Array<{ _id: Types.ObjectId; level: number }>;
  fromSectionInfo: Map<string, { level: number; code: string; classId: Types.ObjectId }>;
  toClassId: (level: number) => string | null;
  toSectionId: (level: number, code: string) => string;
  toSectionExists: (level: number, code: string) => boolean;
  shapeHas: (level: number, code: string) => boolean;
  summary: ScheduleCopyPlan;
  // routine
  desired: Array<{
    key: string;
    level: number;
    code: string;
    targetSectionId: string;
    src: IRoutineSlot;
  }>;
  ownCopies: Map<string, IRoutineSlot>;
  toEnd: IRoutineSlot[];
  // bell windows
  windowsDesired: Array<{ fromDate: Date; toDate: Date; season: string; dayStartMinutes: number; label: string }>;
  windowsOwned: Array<{ _id: Types.ObjectId; k: string }>;
  windowsBlocked: boolean;
  // assignment
  assignmentEntries: Array<{ cycleWeek: number; classId: string; classLevel: number; sectionId: string; subject: string; teacherId: string; effectiveFrom: string; effectiveTo: null }>;
  fromSchedule: { termStartDate: Date; deliveryDayOfWeek: number; dueDayOfWeek: number } | null;
  toScheduleDoc: { _id: Types.ObjectId; runId?: string } | null;
  // grants
  routineGrantsDesired: Array<{ teacherId: string; sectionId: string; classId: string; subjectId: Types.ObjectId; subjectCode: string }>;
  pastRoutineGrants: Array<{ _id: Types.ObjectId; previous: Date | null }>;
  repoints: Array<{ orig: Record<string, unknown> & { _id: Types.ObjectId }; clone: Record<string, unknown> | null }>;
  pastRepointExpire: Array<{ _id: Types.ObjectId; previous: Date | null }>;
  // mastery
  masteryDesired: Array<{ classToken: MasteryClassToken; subject: MasterySubject }>;
}

const dayName = (d: string): string => d;

async function compute(plan: YearChangePlan, optsIn: CopyOptions | undefined, fromYear: YearLite, toYear: YearLite, runId: string | null): Promise<Computed> {
  const opts = resolveCopyOptions(optsIn);
  const toYearNum = dhakaDayKey(toYear.startDate).slice(0, 4);
  const fromKey = `${toYearNum}-01-03`;
  const endKey = `${toYearNum}-01-02`;
  const fromDate = new Date(fromKey);
  const endDate = endOfDayBefore(keyDate(fromKey));
  const expiryAt = new Date(`${fromKey}T00:00:00+06:00`);
  const summary = emptyScheduleCopy(optsIn);
  summary.fromKey = fromKey;
  summary.endKey = endKey;

  const fromClasses = (await Class.find({ academicYearId: fromYear._id }).select("level").lean()) as Array<{ _id: Types.ObjectId; level: number }>;
  const fromLevelOf = new Map(fromClasses.map((c) => [sid(c._id), c.level]));
  const fromSections = await Section.find({ classId: { $in: fromClasses.map((c) => c._id) } }).select("classId code").lean();
  const fromSectionInfo = new Map(fromSections.map((s) => [sid(s._id), { level: fromLevelOf.get(sid(s.classId)) as number, code: s.code as string, classId: s.classId as Types.ObjectId }]));

  const toClasses = (await Class.find({ academicYearId: toYear._id }).select("level").lean()) as Array<{ _id: Types.ObjectId; level: number }>;
  const toClassByLevel = new Map(toClasses.map((c) => [c.level, sid(c._id)]));
  const toSections = await Section.find({ classId: { $in: toClasses.map((c) => c._id) } }).select("classId code").lean();
  const levelOfTo = new Map(toClasses.map((c) => [sid(c._id), c.level]));
  const toSectionBy = new Map(toSections.map((s) => [`${levelOfTo.get(sid(s.classId))}:${s.code}`, sid(s._id)]));
  const shape = new Map<number, Set<string>>(plan.classes.map((c) => [c.level, new Set(c.sections.map((s) => s.code))]));

  const c: Computed = {
    opts,
    fromKey,
    endKey,
    expiryAt,
    fromDate,
    endDate,
    fromYear,
    toYear,
    fromClasses,
    fromSectionInfo,
    toClassId: (level) => toClassByLevel.get(level) ?? null,
    toSectionId: (level, code) => toSectionBy.get(`${level}:${code}`) ?? `pending:${level}:${code}`,
    toSectionExists: (level, code) => toSectionBy.has(`${level}:${code}`),
    shapeHas: (level, code) => !!shape.get(level)?.has(code),
    summary,
    desired: [],
    ownCopies: new Map(),
    toEnd: [],
    windowsDesired: [],
    windowsOwned: [],
    windowsBlocked: false,
    assignmentEntries: [],
    fromSchedule: null,
    toScheduleDoc: null,
    routineGrantsDesired: [],
    pastRoutineGrants: [],
    repoints: [],
    pastRepointExpire: [],
    masteryDesired: [],
  };
  const classIdFor = (level: number): string => toClassByLevel.get(level) ?? `pending:${level}`;

  // ---- routine -------------------------------------------------------------------------------
  if (opts.routine) {
    const closeDate = keyDate(endKey);
    const srcs = (await RoutineSlot.find({
      groupType: "section",
      groupId: { $in: [...fromSectionInfo.keys()].map(oid) },
      active: true,
      ...liveWindow(closeDate),
    }).lean()) as unknown as IRoutineSlot[];
    const perSection = new Map<string, number>();
    const unmapped = new Set<string>();
    const seen = new Set<string>();
    for (const s of srcs) {
      const info = fromSectionInfo.get(sid(s.groupId));
      if (!info) continue;
      if (!c.shapeHas(info.level, info.code)) {
        unmapped.add(labelOf(info.level, info.code));
        continue;
      }
      const targetSectionId = c.toSectionId(info.level, info.code);
      const key = `${targetSectionId}|${s.dayOfWeek}|${s.periodNumber}`;
      if (seen.has(key)) continue; // an overlapping duplicate in 2026 is copied once
      seen.add(key);
      c.desired.push({ key, level: info.level, code: info.code, targetSectionId, src: s });
      perSection.set(`${info.level}:${info.code}`, (perSection.get(`${info.level}:${info.code}`) ?? 0) + 1);
      const to = s.effectiveTo ? new Date(s.effectiveTo) : null;
      if (!to || to.getTime() > endOfDay(closeDate).getTime()) c.toEnd.push(s);
    }
    summary.routine.sections = [...perSection.entries()]
      .map(([k, slots]) => ({ level: Number(k.split(":")[0]), code: k.split(":")[1] as SectionCode, slots }))
      .sort((a, b) => a.level - b.level || a.code.localeCompare(b.code));
    summary.routine.unmapped = [...unmapped].sort();
    summary.routine.pastToEnd = c.toEnd.length;

    if (runId) {
      const own = (await RoutineSlot.find({ runId }).lean()) as unknown as IRoutineSlot[];
      for (const o of own) c.ownCopies.set(`${sid(o.groupId)}|${o.dayOfWeek}|${o.periodNumber}`, o);
    }
    const sameRow = (o: IRoutineSlot, d: Computed["desired"][number]): boolean =>
      o.subject === d.src.subject &&
      o.track === d.src.track &&
      !!o.isBreak === !!d.src.isBreak &&
      sid(o.teacherId ?? "") === sid(d.src.teacherId ?? "") &&
      sid(o.roomId ?? "") === sid(d.src.roomId ?? "") &&
      new Date(o.effectiveFrom).getTime() === fromDate.getTime() &&
      !o.effectiveTo;
    const wanted = new Set<string>();
    for (const d of c.desired) {
      wanted.add(d.key);
      const o = c.ownCopies.get(d.key);
      if (!o) summary.routine.slotsToCreate++;
      else if (sameRow(o, d)) summary.routine.slotsExisting++;
      else summary.routine.slotsToUpdate++;
    }
    summary.routine.slotsToRemove = [...c.ownCopies.keys()].filter((k) => !wanted.has(k)).length;

    // ---- the conflict engine over the copied set (2026 rows modelled as ended on endKey) ----
    const copying = new Set(c.desired.map((d) => sid(d.src._id)));
    const own = new Set([...c.ownCopies.values()].map((o) => sid(o._id)));
    const others = (await RoutineSlot.find({
      active: true,
      $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: null }, { effectiveTo: { $gte: startOfDay(fromDate) } }],
    }).lean()) as unknown as IRoutineSlot[];
    const bySpot = new Map<string, SlotLite[]>();
    const push = (l: SlotLite): void => {
      const k = `${l.dayOfWeek}|${l.periodNumber}`;
      const arr = bySpot.get(k);
      if (arr) arr.push(l);
      else bySpot.set(k, [l]);
    };
    for (const o of others) {
      if (own.has(sid(o._id))) continue;
      push({
        id: sid(o._id),
        dayOfWeek: o.dayOfWeek,
        periodNumber: o.periodNumber,
        groupType: o.groupType,
        groupId: sid(o.groupId),
        teacherId: o.teacherId ? sid(o.teacherId) : null,
        roomId: o.roomId ? sid(o.roomId) : null,
        effectiveFrom: new Date(o.effectiveFrom),
        effectiveTo: copying.has(sid(o._id)) ? endDate : o.effectiveTo ? new Date(o.effectiveTo) : null,
      });
    }
    const cands: Array<SlotLite & { label: string }> = c.desired.map((d, i) => ({
      id: `copy:${i}`,
      dayOfWeek: d.src.dayOfWeek,
      periodNumber: d.src.periodNumber,
      groupType: "section",
      groupId: d.targetSectionId,
      teacherId: d.src.teacherId ? sid(d.src.teacherId) : null,
      roomId: d.src.roomId ? sid(d.src.roomId) : null,
      effectiveFrom: fromDate,
      effectiveTo: null,
      label: labelOf(d.level, d.code),
    }));
    for (const x of cands) push(x);
    const teacherIds = new Set<string>();
    const found: Array<{ day: string; period: number; what: "teacher" | "group" | "room"; label: string; teacherId: string | null; otherId: string }> = [];
    const pairSeen = new Set<string>();
    const labelByCand = new Map(cands.map((x) => [x.id, x.label]));
    const groupLabel = new Map<string, string>();
    for (const [gid, info] of fromSectionInfo) groupLabel.set(gid, labelOf(info.level, info.code));
    for (const x of cands) {
      const r = detectConflicts(x, bySpot.get(`${x.dayOfWeek}|${x.periodNumber}`) ?? []);
      for (const what of ["teacher", "group", "room"] as const) {
        const e = r[what];
        if (!e) continue;
        const pair = [x.id, e.id].sort().join("~") + what;
        if (pairSeen.has(pair)) continue;
        pairSeen.add(pair);
        if (x.teacherId) teacherIds.add(x.teacherId);
        found.push({ day: x.dayOfWeek, period: x.periodNumber, what, label: x.label, teacherId: what === "teacher" ? x.teacherId ?? null : null, otherId: e.id });
      }
    }
    if (found.length) {
      const names = new Map((await User.find({ _id: { $in: [...teacherIds].map(oid) } }).select("name").lean()).map((u) => [sid(u._id), u.name as string]));
      const groupOfSlot = new Map(others.map((o) => [sid(o._id), sid(o.groupId)]));
      const otherLabel = (id: string): string => labelByCand.get(id) ?? groupLabel.get(groupOfSlot.get(id) ?? "") ?? "অন্য রুটিন";
      for (const f of found) {
        const kind = f.what === "teacher" ? `শিক্ষক ${names.get(f.teacherId ?? "") ?? f.teacherId} দুই জায়গায়` : f.what === "group" ? "একই শাখা দুইবার" : "একই কক্ষ দুইবার";
        summary.routine.conflicts.push(`${dayName(f.day)} ${f.period}ম পিরিয়ড: ${kind} (${f.label} ও ${otherLabel(f.otherId)})`);
      }
    }
  }

  // ---- bell windows ----------------------------------------------------------------------------
  if (opts.bellWindows) {
    const fromWins = await ScheduleWindow.find({ academicYearId: fromYear._id, active: true }).sort({ fromDate: 1 }).lean();
    const diff = Number(toYearNum) - Number(dhakaDayKey(fromYear.startDate).slice(0, 4));
    const shift = (d: Date): Date => {
      const x = new Date(d);
      x.setUTCFullYear(x.getUTCFullYear() + diff);
      return x;
    };
    c.windowsDesired = fromWins.map((w) => ({ fromDate: shift(w.fromDate), toDate: shift(w.toDate), season: w.season as string, dayStartMinutes: w.dayStartMinutes as number, label: w.label as string }));
    const toWins = await ScheduleWindow.find({ academicYearId: toYear._id }).lean();
    const winKey = (w: { fromDate: Date; toDate: Date; season: string; dayStartMinutes: number; label: string }): string => `${new Date(w.fromDate).getTime()}|${new Date(w.toDate).getTime()}|${w.season}|${w.dayStartMinutes}|${w.label}`;
    c.windowsOwned = toWins.filter((w) => runId && w.runId === runId).map((w) => ({ _id: w._id, k: winKey(w as never) }));
    const foreign = toWins.filter((w) => !(runId && w.runId === runId));
    if (c.windowsOwned.length === 0 && foreign.length > 0) {
      c.windowsBlocked = true;
      summary.bellWindows.skipped = `${toYear.label} বর্ষে ${foreign.length}টি ঘণ্টার সময়সূচি আগে থেকেই আছে — কপি হবে না।`;
    } else if (fromWins.length === 0) {
      summary.bellWindows.skipped = `${fromYear.label} বর্ষে কপি করার ঘণ্টার সময়সূচি নেই।`;
    } else {
      const have = new Set(c.windowsOwned.map((o) => o.k));
      const want = new Set(c.windowsDesired.map(winKey));
      summary.bellWindows.toCreate = c.windowsDesired.filter((w) => !have.has(winKey(w))).length;
      summary.bellWindows.existing = c.windowsDesired.filter((w) => have.has(winKey(w))).length;
      summary.bellWindows.toRemove = c.windowsOwned.filter((o) => !want.has(o.k)).length;
    }
  }

  // ---- assignment schedule ---------------------------------------------------------------------
  if (opts.assignmentSchedule) {
    const fromSched = await AssignmentSchedule.findOne({ academicYearId: fromYear._id }).lean();
    const toSched = await AssignmentSchedule.findOne({ academicYearId: toYear._id }).select("runId").lean();
    c.toScheduleDoc = toSched ? { _id: toSched._id, runId: toSched.runId } : null;
    if (!fromSched) summary.assignment.skipped = `${fromYear.label} বর্ষের অ্যাসাইনমেন্ট সূচি নেই।`;
    else if (toSched && !(runId && toSched.runId === runId)) {
      summary.assignment.skipped = `${toYear.label} বর্ষের অ্যাসাইনমেন্ট সূচি আগে থেকেই আছে — কপি হবে না।`;
      summary.assignment.existing = true;
    } else {
      c.fromSchedule = { termStartDate: fromSched.termStartDate, deliveryDayOfWeek: fromSched.deliveryDayOfWeek, dueDayOfWeek: fromSched.dueDayOfWeek };
      let dropped = 0;
      for (const e of fromSched.entries) {
        if (!entryActiveOn(e, endKey)) continue;
        const info = fromSectionInfo.get(sid(e.sectionId));
        if (!info || !c.shapeHas(info.level, info.code)) {
          dropped++;
          continue;
        }
        c.assignmentEntries.push({
          cycleWeek: e.cycleWeek,
          classId: classIdFor(info.level),
          classLevel: e.classLevel,
          sectionId: c.toSectionId(info.level, info.code),
          subject: e.subject,
          teacherId: sid(e.teacherId),
          effectiveFrom: fromKey,
          effectiveTo: null,
        });
      }
      summary.assignment.entries = c.assignmentEntries.length;
      summary.assignment.existing = !!toSched;
      if (dropped) summary.assignment.skipped = `${dropped}টি এন্ট্রির শাখা নতুন বছরে নেই — বাদ।`;
    }
  }

  // ---- grants ----------------------------------------------------------------------------------
  if (opts.grants) {
    // routine teaching grants for the copied 2027 slots (the existing binding rules)
    if (opts.routine) {
      const codes = [...new Set(c.desired.map((d) => d.src.subject as string))];
      const subjects = await Subject.find({ code: { $in: codes } }).select("code").lean();
      const subjectOf = new Map(subjects.map((s) => [s.code as string, s._id as Types.ObjectId]));
      const seen = new Set<string>();
      for (const d of c.desired) {
        const gp = routineGrantPlan({ groupType: "section", isBreak: !!d.src.isBreak, teacherId: d.src.teacherId ? sid(d.src.teacherId) : null, subject: d.src.subject }, ROUTINE_GRANT_SUBJECTS);
        if (!gp.bind || !d.src.teacherId) continue;
        const subjectId = subjectOf.get(d.src.subject);
        if (!subjectId) continue;
        const k = `${sid(d.src.teacherId)}|${d.targetSectionId}|${sid(subjectId)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        c.routineGrantsDesired.push({ teacherId: sid(d.src.teacherId), sectionId: d.targetSectionId, classId: classIdFor(d.level), subjectId, subjectCode: d.src.subject });
      }
      const realIds = c.routineGrantsDesired.filter((g) => !g.sectionId.startsWith("pending:")).map((g) => oid(g.sectionId));
      const have = (realIds.length ? await ScopeGrant.find({ kind: "teaching", source: "routine", sectionId: { $in: realIds } }).select("teacherId sectionId subjectId").lean() : []) as unknown as GrantLite[];
      const haveKeys = new Set(have.map((g) => `${sid(g.teacherId)}|${sid(g.sectionId)}|${sid(g.subjectId)}`));
      for (const g of c.routineGrantsDesired) {
        if (haveKeys.has(`${g.teacherId}|${g.sectionId}|${sid(g.subjectId)}`)) summary.grants.routineTeachingExisting++;
        else summary.grants.routineTeachingToCreate++;
      }
    }

    // 2026 routine teaching grants lapse on the first routine day
    const fromSecOids = [...fromSectionInfo.keys()].map(oid);
    const pastRoutine = (await ScopeGrant.find({ kind: "teaching", source: "routine", active: true, sectionId: { $in: fromSecOids } }).select("expiresAt").lean()) as unknown as GrantLite[];
    c.pastRoutineGrants = pastRoutine
      .filter((g) => !g.expiresAt || new Date(g.expiresAt).getTime() > expiryAt.getTime())
      .map((g) => ({ _id: g._id as Types.ObjectId, previous: g.expiresAt ? new Date(g.expiresAt) : null }));
    summary.grants.pastRoutineToExpire = c.pastRoutineGrants.length;

    // supervisory + delegation grants on a 2026 class -> the same-level 2027 class
    const fromClassOids = fromClasses.map((x) => x._id);
    const wide = (await ScopeGrant.find({
      kind: { $in: ["supervisory", "delegation"] },
      active: true,
      runId: { $exists: false },
      $or: [{ classId: { $in: fromClassOids } }, { "explicitSet.classId": { $in: fromClassOids } }],
    }).lean()) as unknown as Array<Record<string, unknown> & { _id: Types.ObjectId }>;
    const levelOfFromClass = new Map(fromClasses.map((x) => [sid(x._id), x.level]));
    const existingClones = runId ? ((await ScopeGrant.find({ runId, repointedFrom: { $exists: true } }).lean()) as unknown as Array<Record<string, unknown> & { _id: Types.ObjectId }>) : [];
    const cloneOf = new Map(existingClones.map((g) => [sid(g.repointedFrom), g]));
    const stampedPrev = new Map<string, string | null>();
    if (runId) for (const e of (await YearChangeRun.findOne({ runId }).select("grantExpiries").lean())?.grantExpiries ?? []) stampedPrev.set(e.grantId, e.previous);
    for (const g of wide) {
      let prevExp = g.expiresAt ? new Date(g.expiresAt as Date) : null;
      // already stamped by THIS run: the grant's own previous expiry is on the run record
      const alreadyStamped = !!prevExp && prevExp.getTime() === expiryAt.getTime() && stampedPrev.has(sid(g._id));
      if (alreadyStamped) {
        const p = stampedPrev.get(sid(g._id));
        prevExp = p ? new Date(p) : null;
      } else if (prevExp && prevExp.getTime() <= expiryAt.getTime()) continue; // already ends by then
      const mapClass = (cid: unknown): string | null => {
        const lvl = levelOfFromClass.get(sid(cid));
        return lvl === undefined ? null : classIdFor(lvl);
      };
      let clone: Record<string, unknown> | null = null;
      const base = {
        teacherId: g.teacherId,
        kind: g.kind,
        extent: g.extent,
        ...(g.subjectId ? { subjectId: g.subjectId } : {}),
        ...(g.kind === "delegation" ? { actions: g.actions } : {}),
        ...(prevExp ? { expiresAt: prevExp } : {}),
      };
      if (g.classId && levelOfFromClass.has(sid(g.classId))) {
        const t = mapClass(g.classId);
        if (t) clone = { ...base, classId: t };
      } else if (Array.isArray(g.explicitSet)) {
        const pairs = (g.explicitSet as Array<{ classId: unknown; subjectId: unknown }>).map((p) => ({ classId: levelOfFromClass.has(sid(p.classId)) ? mapClass(p.classId) : sid(p.classId), subjectId: p.subjectId }));
        if (pairs.some((p, i) => levelOfFromClass.has(sid((g.explicitSet as Array<{ classId: unknown }>)[i].classId)) && p.classId)) {
          clone = { ...base, explicitSet: pairs.filter((p) => p.classId) };
        }
      }
      c.repoints.push({ orig: g, clone });
      if (!alreadyStamped) c.pastRepointExpire.push({ _id: g._id, previous: prevExp });
      if (clone) {
        if (cloneOf.has(sid(g._id))) summary.grants.repointExisting++;
        else summary.grants.repointToCreate++;
      }
    }
    summary.grants.pastRepointedToExpire = c.pastRepointExpire.length;
  }

  // ---- mastery switches ------------------------------------------------------------------------
  if (opts.mastery) {
    const fromRows = await MasteryEnablement.find({ academicYearId: fromYear._id, enabled: true }).lean();
    const toRows = await MasteryEnablement.find({ academicYearId: toYear._id }).lean();
    const toKeys = new Map(toRows.map((r) => [`${r.classToken}|${r.subject}`, r]));
    for (const r of fromRows) {
      const k = `${r.classToken}|${r.subject}`;
      const have = toKeys.get(k);
      if (have && !(runId && have.runId === runId)) {
        summary.mastery.existing++;
        continue;
      }
      const locked = await MasteryOutcome.countDocuments({ classToken: r.classToken, subject: r.subject, status: "LOCKED" });
      const blocked = locked === 0 ? "লক করা তালিকা নেই" : await switchBlockedByReview(r.classToken as MasteryClassToken, r.subject as MasterySubject);
      if (blocked) {
        summary.mastery.skippedUnlocked.push(`${r.classToken} ${r.subject}`);
        continue;
      }
      c.masteryDesired.push({ classToken: r.classToken as MasteryClassToken, subject: r.subject as MasterySubject });
      if (have) summary.mastery.existing++;
      else summary.mastery.toCreate++;
    }
  }
  return c;
}

/** The dry run: reads only. */
export async function planScheduleCopy(plan: YearChangePlan, optsIn: CopyOptions | undefined, fromYear: YearLite, toYear: YearLite): Promise<ScheduleCopyPlan> {
  const c = await compute(plan, optsIn, fromYear, toYear, plan.runId);
  return c.summary;
}

export interface ScheduleCopyWrites {
  routineSlots: number;
  routineEnded: number;
  bellWindows: number;
  assignmentSchedule: number;
  grants: number;
  grantsExpired: number;
  masteryEnablements: number;
}
export const NO_COPY_WRITES: ScheduleCopyWrites = { routineSlots: 0, routineEnded: 0, bellWindows: 0, assignmentSchedule: 0, grants: 0, grantsExpired: 0, masteryEnablements: 0 };

export class ScheduleCopyRefusal extends Error {
  constructor(public readonly reasons: string[]) {
    super(reasons.join("; "));
  }
}

/** The write. Runs after the next year's classes + sections exist. Idempotent. */
export async function applyScheduleCopy(plan: YearChangePlan, runId: string, actorId: Types.ObjectId): Promise<ScheduleCopyWrites> {
  const w: ScheduleCopyWrites = { ...NO_COPY_WRITES };
  const [fromYear, toYear] = (await Promise.all([
    AcademicYear.findById(plan.fromYearId).select("label startDate").lean(),
    AcademicYear.findById(plan.toYearId).select("label startDate").lean(),
  ])) as [YearLite, YearLite];
  const c = await compute(plan, plan.scheduleCopy.options, fromYear, toYear, runId);
  if (c.summary.routine.conflicts.length) throw new ScheduleCopyRefusal(c.summary.routine.conflicts.map((x) => `রুটিন কপি: ${x}`));
  const run = await YearChangeRun.findOne({ runId });
  if (!run) throw new ScheduleCopyRefusal([`রান ${runId} পাওয়া যায়নি।`]);

  // ---- routine ---------------------------------------------------------------------------------
  if (c.opts.routine) {
    const wanted = new Set<string>();
    for (const d of c.desired) {
      wanted.add(d.key);
      const o = c.ownCopies.get(d.key);
      const fields = {
        subject: d.src.subject as RoutineSubject,
        track: d.src.track as PeriodTrack,
        isBreak: !!d.src.isBreak,
        effectiveFrom: c.fromDate,
      };
      if (!o) {
        await RoutineSlot.create({
          groupType: "section",
          groupId: oid(d.targetSectionId),
          classId: oid(c.toClassId(d.level) as string),
          dayOfWeek: d.src.dayOfWeek as DayOfWeek,
          periodNumber: d.src.periodNumber,
          ...fields,
          ...(d.src.teacherId ? { teacherId: d.src.teacherId } : {}),
          ...(d.src.roomId ? { roomId: d.src.roomId } : {}),
          active: true,
          createdBy: actorId,
          runId,
        });
        w.routineSlots++;
        continue;
      }
      const same =
        o.subject === d.src.subject &&
        o.track === d.src.track &&
        !!o.isBreak === !!d.src.isBreak &&
        sid(o.teacherId ?? "") === sid(d.src.teacherId ?? "") &&
        sid(o.roomId ?? "") === sid(d.src.roomId ?? "") &&
        new Date(o.effectiveFrom).getTime() === c.fromDate.getTime() &&
        !o.effectiveTo;
      if (same) continue;
      await RoutineSlot.updateOne(
        { _id: o._id },
        {
          $set: { ...fields, ...(d.src.teacherId ? { teacherId: d.src.teacherId } : {}), ...(d.src.roomId ? { roomId: d.src.roomId } : {}) },
          $unset: { effectiveTo: 1, ...(d.src.teacherId ? {} : { teacherId: 1 }), ...(d.src.roomId ? {} : { roomId: 1 }) },
        },
      );
      w.routineSlots++;
    }
    for (const [k, o] of c.ownCopies) {
      if (wanted.has(k)) continue;
      await RoutineSlot.deleteOne({ _id: o._id, runId });
      w.routineSlots++;
    }
    // End the copied 2026 rows: record the previous value on the run FIRST (undo restores it).
    if (c.toEnd.length) {
      const known = new Set(run.routineEnds.map((e) => e.slotId));
      const add = c.toEnd.filter((s) => !known.has(sid(s._id))).map((s) => ({ slotId: sid(s._id), previous: s.effectiveTo ? new Date(s.effectiveTo).toISOString() : null }));
      if (add.length) {
        run.routineEnds = [...run.routineEnds, ...add];
        run.markModified("routineEnds");
        await run.save();
      }
      for (const s of c.toEnd) {
        await RoutineSlot.updateOne({ _id: s._id }, { $set: { effectiveTo: c.endDate } });
        w.routineEnded++;
      }
    }
  }

  // ---- bell windows ----------------------------------------------------------------------------
  if (c.opts.bellWindows && !c.windowsBlocked && c.windowsDesired.length + c.windowsOwned.length > 0) {
    const key = (x: { fromDate: Date; toDate: Date; season: string; dayStartMinutes: number; label: string }): string => `${new Date(x.fromDate).getTime()}|${new Date(x.toDate).getTime()}|${x.season}|${x.dayStartMinutes}|${x.label}`;
    const have = new Set(c.windowsOwned.map((o) => o.k));
    const want = new Set(c.windowsDesired.map(key));
    for (const o of c.windowsOwned) {
      if (want.has(o.k)) continue;
      await ScheduleWindow.deleteOne({ _id: o._id, runId });
      w.bellWindows++;
    }
    for (const d of c.windowsDesired) {
      if (have.has(key(d))) continue;
      await ScheduleWindow.create({ academicYearId: c.toYear._id, ...d, active: true, runId });
      w.bellWindows++;
    }
  }

  // ---- assignment schedule ---------------------------------------------------------------------
  if (c.opts.assignmentSchedule && c.fromSchedule) {
    const entries = c.assignmentEntries.map((e) => ({ ...e, classId: oid(e.classId), sectionId: oid(e.sectionId), teacherId: oid(e.teacherId) }));
    const termStartDate = atMidnight(keyDate(c.fromKey));
    if (!c.toScheduleDoc) {
      await AssignmentSchedule.create({
        academicYearId: c.toYear._id,
        termStartDate,
        deliveryDayOfWeek: c.fromSchedule.deliveryDayOfWeek,
        dueDayOfWeek: c.fromSchedule.dueDayOfWeek,
        entries,
        runId,
      });
      w.assignmentSchedule++;
    } else {
      const cur = await AssignmentSchedule.findById(c.toScheduleDoc._id);
      const sig = (list: Array<{ cycleWeek: number; sectionId: unknown; subject: string; teacherId: unknown; classId: unknown }>): string =>
        list
          .map((e) => `${e.cycleWeek}|${sid(e.sectionId)}|${e.subject}|${sid(e.teacherId)}|${sid(e.classId)}`)
          .sort()
          .join(",");
      if (cur && (sig(cur.entries) !== sig(entries) || cur.termStartDate.getTime() !== termStartDate.getTime() || cur.deliveryDayOfWeek !== c.fromSchedule.deliveryDayOfWeek || cur.dueDayOfWeek !== c.fromSchedule.dueDayOfWeek)) {
        await AssignmentSchedule.updateOne(
          { _id: cur._id },
          { $set: { termStartDate, deliveryDayOfWeek: c.fromSchedule.deliveryDayOfWeek, dueDayOfWeek: c.fromSchedule.dueDayOfWeek, entries } },
        );
        w.assignmentSchedule++;
      }
    }
  }

  // ---- grants ----------------------------------------------------------------------------------
  if (c.opts.grants) {
    if (c.opts.routine) {
      const wantKeys = new Set<string>();
      for (const g of c.routineGrantsDesired) {
        wantKeys.add(`${g.teacherId}|${g.sectionId}|${sid(g.subjectId)}`);
        const have = await ScopeGrant.findOne({ teacherId: oid(g.teacherId), kind: "teaching", sectionId: oid(g.sectionId), subjectId: g.subjectId, source: "routine" }).select("_id").lean();
        if (have) continue;
        await ScopeGrant.create({ teacherId: oid(g.teacherId), kind: "teaching", classId: oid(g.classId), sectionId: oid(g.sectionId), subjectId: g.subjectId, source: "routine", active: true, createdBy: actorId, runId });
        w.grants++;
      }
      for (const old of (await ScopeGrant.find({ runId, kind: "teaching", source: "routine" }).select("teacherId sectionId subjectId").lean()) as unknown as GrantLite[]) {
        if (wantKeys.has(`${sid(old.teacherId)}|${sid(old.sectionId)}|${sid(old.subjectId)}`)) continue;
        await ScopeGrant.deleteOne({ _id: old._id, runId });
        w.grants++;
      }
    }
    // record the previous expiries on the run BEFORE stamping (undo restores them)
    const stamp = [...c.pastRoutineGrants, ...c.pastRepointExpire];
    if (stamp.length) {
      const fresh = await YearChangeRun.findOne({ runId });
      if (fresh) {
        const known = new Set(fresh.grantExpiries.map((e) => e.grantId));
        const add = stamp.filter((g) => !known.has(sid(g._id))).map((g) => ({ grantId: sid(g._id), previous: g.previous ? g.previous.toISOString() : null }));
        if (add.length) {
          fresh.grantExpiries = [...fresh.grantExpiries, ...add];
          fresh.markModified("grantExpiries");
          await fresh.save();
        }
      }
      for (const g of stamp) {
        await ScopeGrant.updateOne({ _id: g._id }, { $set: { expiresAt: c.expiryAt } });
        w.grantsExpired++;
      }
    }
    // the 2027 copies of re-pointed supervisory / delegation grants
    const keep = new Set<string>();
    for (const r of c.repoints) {
      keep.add(sid(r.orig._id));
      if (!r.clone) continue;
      const have = await ScopeGrant.findOne({ runId, repointedFrom: r.orig._id }).select("_id").lean();
      if (have) continue;
      const doc = { ...r.clone } as Record<string, unknown>;
      if (typeof doc.classId === "string") doc.classId = oid(doc.classId);
      if (Array.isArray(doc.explicitSet)) doc.explicitSet = (doc.explicitSet as Array<{ classId: unknown; subjectId: unknown }>).map((p) => ({ classId: typeof p.classId === "string" ? oid(p.classId) : p.classId, subjectId: p.subjectId }));
      await ScopeGrant.create({ ...doc, active: true, source: "manual", createdBy: actorId, runId, repointedFrom: r.orig._id });
      w.grants++;
    }
    for (const old of await ScopeGrant.find({ runId, repointedFrom: { $exists: true } }).select("repointedFrom").lean()) {
      if (keep.has(sid(old.repointedFrom))) continue;
      await ScopeGrant.deleteOne({ _id: old._id, runId });
      w.grants++;
    }
  }

  // ---- mastery switches ------------------------------------------------------------------------
  if (c.opts.mastery) {
    const wantKeys = new Set(c.masteryDesired.map((m) => `${m.classToken}|${m.subject}`));
    for (const m of c.masteryDesired) {
      const have = await MasteryEnablement.findOne({ academicYearId: c.toYear._id, classToken: m.classToken, subject: m.subject }).select("_id").lean();
      if (have) continue;
      await MasteryEnablement.create({ academicYearId: c.toYear._id, classToken: m.classToken, subject: m.subject, enabled: true, changedBy: actorId, changedAt: new Date(), runId });
      w.masteryEnablements++;
    }
    for (const old of await MasteryEnablement.find({ academicYearId: c.toYear._id, runId }).select("classToken subject").lean()) {
      if (wantKeys.has(`${old.classToken}|${old.subject}`)) continue;
      await MasteryEnablement.deleteOne({ _id: old._id, runId });
      w.masteryEnablements++;
    }
  }
  return w;
}
