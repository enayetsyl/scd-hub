/**
 * applyCutover (YC-4, prd-year-change section 3 step 2). One run, in this order, idempotent - a
 * re-run finishes a broken run and a re-run of a finished one writes 0:
 *
 *   0. refusals (unissued homework, DRAFT assignment weeks, an unplaced child ...) - nothing written
 *   1. before-state of every Student the run will touch is saved on the run record (FIRST, once)
 *   2. close the past year's ACTIVE enrolments: PROMOTED / REPEATED / LEFT, endKey = day before the new year
 *   3. the PLANNED enrolments become ACTIVE from the new year's first day
 *   4. Student pointers move to the new enrolment; leavers go inactive; admissions go active;
 *      the scholarship flag is cleared for children leaving Class 5 (promoted or left)
 *   5. the past year's CLASS-scope improvement actions that still run into the new year are stopped
 *   6. AcademicYear.current flips to the new year - the LAST data write
 *   7. audit YEAR_CHANGE_CUT_OVER (with every changed Student's before-state)
 *
 * Past-year sections stay `active` (owner ruling: December reports are still revised until 15 Jan);
 * `retirePastYearSections` is a separate, later step.
 */
import { Types } from "mongoose";
import { AcademicYear } from "../foundation/models/AcademicYear";
import { Class } from "../foundation/models/Class";
import { Section } from "../foundation/models/Section";
import { Student } from "../foundation/models/Student";
import { Enrolment, type IEnrolment, type EnrolmentOutcome } from "../foundation/models/Enrolment";
import { HomeworkItem } from "../trackers/models/HomeworkItem";
import { AssignmentItem } from "../trackers/models/AssignmentItem";
import { ImprovementAction } from "../improvement/models/ImprovementAction";
import { checkInvariant, closeEnrolment, dayBefore, type InvariantViolation } from "../foundation/services/EnrolmentService";
import { onSectionTeachersChangedSync } from "../chat/services/ChatGroupService";
import { Audit } from "../platform/models/Audit";
import { dhakaDayKey } from "../../lib/dhakaDay";
import { writeAudit } from "../platform/services/AuditService";
import { assertYearChangeRight } from "./authz";
import { YearChangeRun, type IYearChangeRun, type StudentBefore } from "./models/YearChangeRun";
import { YearChangeRefusal, type YearChangeActor } from "./types";

export interface CutoverOptions {
  /** Dev rehearsal: skip the "not before the last day of the old year" guard. */
  allowEarly?: boolean;
  /** Ignore the unissued-homework refusal. */
  force?: boolean;
  /** Clock override (tests): the Dhaka date key "today". */
  today?: string;
}

export interface CutoverChildRow {
  schoolId: string;
  name: string;
  fromLevel: number | null;
  fromCode: string | null;
  toLevel: number | null;
  toCode: string | null;
  outcome: "PROMOTED" | "REPEATED" | "LEFT" | "ADMITTED";
}

export interface CutoverPlan {
  children: CutoverChildRow[];
  improvement: Array<{ id: string; subject: string; lastDay: string }>;
  runId: string;
  status: string;
  fromLabel: string;
  toLabel: string;
  startKey: string;
  closeKey: string;
  promoted: number;
  repeated: number;
  left: number;
  activating: number;
  admitted: number;
  studentsChanged: number;
  scholarshipCleared: number;
  improvementToEnd: number;
  refusals: string[];
}

export interface CutoverResult {
  /** Invariant violations found AFTER the run (empty = clean). */
  invariantAfter: InvariantViolation[];
  runId: string;
  writes: {
    run: number;
    enrolmentsClosed: number;
    enrolmentsActivated: number;
    students: number;
    improvementEnded: number;
    yearFlipped: number;
  };
  total: number;
}

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);
const sid = (id: unknown): string => String(id);
/** The tag a stopped improvement action carries (the undo looks for it). */
export const improvementStopReason = (runId: string): string => `year-change:${runId}`;

interface StudentRow {
  _id: Types.ObjectId;
  schoolId: string;
  name?: string;
  classId: Types.ObjectId;
  sectionId: Types.ObjectId;
  active: boolean;
  rollNumber?: string;
  scholarshipExcluded?: boolean;
  updatedAt?: Date;
}

interface Ctx {
  run: IYearChangeRun;
  fromYear: { _id: Types.ObjectId; label: string };
  toYear: { _id: Types.ObjectId; label: string; startDate: Date; current: boolean };
  startKey: string;
  closeKey: string;
  /** studentId -> planned (new-year) enrolment, any status. */
  planned: Map<string, IEnrolment>;
  /** studentId -> the past-year enrolment (ACTIVE, or CLOSED at the close key by a half-done run). */
  past: Map<string, IEnrolment>;
  leavers: string[];
  admissionIds: Set<string>;
  students: Map<string, StudentRow>;
  refusals: string[];
  fromSectionIds: Types.ObjectId[];
}

function outcomeOf(ctx: Ctx, studentId: string): EnrolmentOutcome {
  if (ctx.leavers.includes(studentId)) return "LEFT";
  const to = ctx.planned.get(studentId)!;
  const from = ctx.past.get(studentId)!;
  return to.classLevel > from.classLevel ? "PROMOTED" : "REPEATED";
}

/** True when a child leaves Class 5 (moves up or goes): the scholarship flag is cleared. */
function clearsScholarship(ctx: Ctx, studentId: string): boolean {
  const from = ctx.past.get(studentId);
  if (!from || from.classLevel !== 5) return false;
  const o = outcomeOf(ctx, studentId);
  return o === "PROMOTED" || o === "LEFT";
}

async function load(runId: string, opts: CutoverOptions = {}): Promise<Ctx | { refusals: string[] }> {
  const run = await YearChangeRun.findOne({ runId });
  if (!run) return { refusals: [`রান ${runId} পাওয়া যায়নি।`] };
  const [fromYear, toYear] = await Promise.all([AcademicYear.findById(run.fromYearId).lean(), AcademicYear.findById(run.toYearId).lean()]);
  if (!fromYear || !toYear) return { refusals: ["শিক্ষাবর্ষ পাওয়া যায়নি।"] };
  const startKey = dhakaDayKey(toYear.startDate);
  const closeKey = dayBefore(startKey);
  const refusals: string[] = [];

  const plannedRows = await Enrolment.find({ runId, academicYearId: toYear._id });
  const planned = new Map(plannedRows.map((e) => [sid(e.studentId), e]));
  const admissionDocs = await Student.find({ yearChangeRunId: runId }).select("_id").lean();
  const admissionIds = new Set(admissionDocs.map((s) => sid(s._id)));
  const leavers = run.leaverIds;

  const ids = [...new Set([...planned.keys(), ...leavers])];
  const students = new Map(
    (await Student.find({ _id: { $in: ids.map(oid) } }).select("schoolId name classId sectionId active rollNumber scholarshipExcluded updatedAt").lean()).map((s) => [sid(s._id), s as unknown as StudentRow]),
  );
  const pastRows = await Enrolment.find({ academicYearId: fromYear._id, studentId: { $in: ids.filter((i) => !admissionIds.has(i)).map(oid) } });
  const past = new Map<string, IEnrolment>();
  for (const e of pastRows) {
    const k = sid(e.studentId);
    const cur = past.get(k);
    const usable = e.status === "ACTIVE" || (e.status === "CLOSED" && e.endKey === closeKey);
    if (usable && (!cur || e.status === "ACTIVE" || (e.startKey > cur.startKey && cur.status !== "ACTIVE"))) past.set(k, e);
  }

  const fromClasses = await Class.find({ academicYearId: fromYear._id }).select("_id").lean();
  const fromSections = await Section.find({ classId: { $in: fromClasses.map((c) => c._id) } }).select("_id").lean();
  const fromSectionIds = fromSections.map((s) => s._id);

  const ctx: Ctx = { run, fromYear, toYear, startKey, closeKey, planned, past, leavers, admissionIds, students, refusals, fromSectionIds };

  // --- refusals ---------------------------------------------------------------------------
  const tag = (id: string): string => students.get(id)?.schoolId ?? id;
  for (const id of ids) {
    if (admissionIds.has(id)) continue;
    const st = students.get(id);
    if (!st) refusals.push(`${id}: শিক্ষার্থী পাওয়া যায়নি।`);
    else if (!past.has(id)) refusals.push(`${tag(id)}: ${fromYear.label} বর্ষে সক্রিয় তালিকাভুক্তি নেই (আগে ব্যাকফিল চালান)।`);
    else if (!st.active && !leavers.includes(id)) refusals.push(`${tag(id)}: শিক্ষার্থী সক্রিয় নয়।`);
  }
  const secIds = [...new Set(plannedRows.map((e) => sid(e.sectionId)))];
  const inactiveSecs = await Section.find({ _id: { $in: secIds.map(oid) }, active: false }).select("_id").lean();
  if (inactiveSecs.length) refusals.push(`${inactiveSecs.length} টি নতুন শাখা বন্ধ আছে।`);

  // A run that already started (CUTTING_OVER) is being finished: its preconditions held when it began
  // and the half-moved state would trip them now, so they are skipped on a resume.
  if (run.status === "PREPARED") {
    const today = opts.today ?? dhakaDayKey(new Date());
    if (!opts.allowEarly && today < closeKey) {
      refusals.push(`উত্তরণ ${closeKey}-এর আগে চালানো যাবে না (আজ ${today})। রিহার্সালে allowEarly দিন।`);
    }
    if (!opts.force) {
      const since = new Date(Date.now() - 60 * 86400000);
      const unissued = await HomeworkItem.find({ sectionId: { $in: fromSectionIds }, status: { $ne: "issued" }, $or: [{ dateGiven: { $gte: since } }, { dateGiven: { $exists: false } }] }).select("hwId").limit(11).lean();
      if (unissued.length) {
        refusals.push(`গত ৬০ দিনের ${unissued.length > 10 ? "১০+" : unissued.length} টি বাড়ির কাজ এখনো ইস্যু হয়নি: ${unissued.slice(0, 10).map((h) => h.hwId).join(", ")}`);
      }
    }
    const draftAs = await AssignmentItem.countDocuments({ sectionId: { $in: fromSectionIds }, status: "DRAFT" });
    if (draftAs) refusals.push(`${draftAs} টি অ্যাসাইনমেন্ট সপ্তাহ DRAFT অবস্থায় আছে।`);

    const fromClassIds = fromClasses.map((c) => c._id);
    const unplaced = await Student.find({ active: true, classId: { $in: fromClassIds }, _id: { $nin: ids.map(oid) } }).select("schoolId").lean();
    for (const u of unplaced.slice(0, 20)) refusals.push(`${u.schoolId}: তালিকায় নেই (প্রস্তুতির পরে ভর্তি?) — প্রস্তুতি আবার চালান।`);
    if (unplaced.length > 20) refusals.push(`... আরও ${unplaced.length - 20} জন তালিকায় নেই।`);

    const bad = await checkInvariant();
    for (const v of bad.slice(0, 20)) refusals.push(`অসঙ্গতি ${v.schoolId}: ${v.kind} (${v.detail})`);
    if (bad.length > 20) refusals.push(`... আরও ${bad.length - 20} টি অসঙ্গতি।`);
  }
  return ctx;
}

export async function planCutover(runId: string, actor?: YearChangeActor, opts: CutoverOptions = {}): Promise<CutoverPlan> {
  if (actor) assertYearChangeRight(actor, "view");
  const ctx = await load(runId, opts);
  if (!("run" in ctx)) {
    return { children: [], improvement: [], runId, status: "NONE", fromLabel: "", toLabel: "", startKey: "", closeKey: "", promoted: 0, repeated: 0, left: 0, activating: 0, admitted: 0, studentsChanged: 0, scholarshipCleared: 0, improvementToEnd: 0, refusals: ctx.refusals };
  }
  const real = [...ctx.planned.keys()].filter((id) => !ctx.admissionIds.has(id));
  let promoted = 0;
  let repeated = 0;
  let scholarship = 0;
  if (ctx.refusals.length === 0) {
    for (const id of real) {
      if (outcomeOf(ctx, id) === "PROMOTED") promoted++;
      else repeated++;
    }
    for (const id of [...real, ...ctx.leavers]) if (clearsScholarship(ctx, id) && ctx.students.get(id)?.scholarshipExcluded !== undefined) scholarship++;
  }
  const improvementRows = await ImprovementAction.find({ scope: "CLASS", sectionId: { $in: ctx.fromSectionIds }, stoppedAt: null, dayKeys: { $gte: ctx.startKey } }).select("subject dayKeys").lean();
  const improvement = improvementRows.length;
  const secs = await Section.find({ _id: { $in: [...ctx.planned.values()].map((e) => e.sectionId) } }).select("code").lean();
  const codeOfSec = new Map(secs.map((x) => [sid(x._id), x.code]));
  const pastSecs = await Section.find({ _id: { $in: [...ctx.past.values()].map((e) => e.sectionId) } }).select("code").lean();
  const pastCode = new Map(pastSecs.map((x) => [sid(x._id), x.code]));
  const children: CutoverChildRow[] = [];
  for (const id of [...ctx.planned.keys(), ...ctx.leavers]) {
    const st = ctx.students.get(id);
    const to = ctx.planned.get(id);
    const from = ctx.past.get(id);
    if (!st) continue;
    const adm = ctx.admissionIds.has(id);
    children.push({
      schoolId: st.schoolId,
      name: st.name ?? "",
      fromLevel: adm ? null : from?.classLevel ?? null,
      fromCode: adm || !from ? null : pastCode.get(sid(from.sectionId)) ?? null,
      toLevel: to ? to.classLevel : null,
      toCode: to ? codeOfSec.get(sid(to.sectionId)) ?? null : null,
      outcome: adm ? "ADMITTED" : !to ? "LEFT" : from && to.classLevel > from.classLevel ? "PROMOTED" : "REPEATED",
    });
  }
  children.sort((x, y) => x.schoolId.localeCompare(y.schoolId));
  return {
    children,
    improvement: improvementRows.map((r) => ({ id: sid(r._id), subject: r.subject, lastDay: r.dayKeys[r.dayKeys.length - 1] })),
    runId,
    status: ctx.run.status,
    fromLabel: ctx.fromYear.label,
    toLabel: ctx.toYear.label,
    startKey: ctx.startKey,
    closeKey: ctx.closeKey,
    promoted,
    repeated,
    left: ctx.leavers.length,
    activating: [...ctx.planned.values()].filter((e) => e.status === "PLANNED").length,
    admitted: ctx.admissionIds.size,
    studentsChanged: ctx.planned.size + ctx.leavers.length,
    scholarshipCleared: scholarship,
    improvementToEnd: improvement,
    refusals: ctx.refusals,
  };
}

export async function applyCutover(runId: string, actor: YearChangeActor, opts: CutoverOptions = {}): Promise<CutoverResult> {
  assertYearChangeRight(actor, "cut_over");
  const writes: CutoverResult["writes"] = { run: 0, enrolmentsClosed: 0, enrolmentsActivated: 0, students: 0, improvementEnded: 0, yearFlipped: 0 };
  let invariantAfter: InvariantViolation[] = [];
  const done = (): CutoverResult => ({ runId, writes, total: Object.values(writes).reduce((n, v) => n + v, 0), invariantAfter });

  const existing = await YearChangeRun.findOne({ runId }).lean();
  if (existing?.status === "CUT_OVER") {
    const to = await AcademicYear.findById(existing.toYearId).lean();
    if (to?.current) return done();
  }
  const ctx = await load(runId, opts);
  if (!("run" in ctx)) throw new YearChangeRefusal(ctx.refusals);
  if (ctx.refusals.length) throw new YearChangeRefusal(ctx.refusals);
  const { run } = ctx;
  const actorId = oid(actor.userId);

  // --- 1. before-state, once, first -------------------------------------------------------
  if (!run.before || run.before.length === 0) {
    const before: StudentBefore[] = [];
    for (const id of [...new Set([...ctx.planned.keys(), ...ctx.leavers])]) {
      const s = ctx.students.get(id);
      if (!s) continue;
      before.push({
        studentId: id,
        classId: sid(s.classId),
        sectionId: sid(s.sectionId),
        active: s.active,
        ...(s.updatedAt ? { updatedAt: s.updatedAt.toISOString() } : {}),
        ...(s.rollNumber !== undefined ? { rollNumber: s.rollNumber } : {}),
        ...(s.scholarshipExcluded !== undefined ? { scholarshipExcluded: s.scholarshipExcluded } : {}),
      });
    }
    run.before = before;
    run.status = "CUTTING_OVER";
    run.cutOverBy = actorId;
    await run.save();
    writes.run++;
  } else if (run.status === "PREPARED") {
    run.status = "CUTTING_OVER";
    await run.save();
    writes.run++;
  }

  // --- 2. close the past year -------------------------------------------------------------
  for (const [id, row] of ctx.past) {
    if (row.status !== "ACTIVE") continue;
    await closeEnrolment(row._id, { endKey: ctx.closeKey, outcome: outcomeOf(ctx, id) });
    writes.enrolmentsClosed++;
  }

  // --- 3. activate the new year's rows ----------------------------------------------------
  for (const row of ctx.planned.values()) {
    if (row.status !== "PLANNED") continue;
    await Enrolment.updateOne({ _id: row._id }, { $set: { status: "ACTIVE", startKey: ctx.startKey } });
    writes.enrolmentsActivated++;
  }

  // --- 4. Student pointers ----------------------------------------------------------------
  for (const id of [...new Set([...ctx.planned.keys(), ...ctx.leavers])]) {
    const cur = ctx.students.get(id);
    if (!cur) continue;
    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    const to = ctx.planned.get(id);
    if (to) {
      if (!cur.classId.equals(to.classId)) set.classId = to.classId;
      if (!cur.sectionId.equals(to.sectionId)) set.sectionId = to.sectionId;
      if (!cur.active) set.active = true;
    } else if (cur.active) set.active = false; // a leaver
    if (!ctx.admissionIds.has(id) && clearsScholarship(ctx, id) && cur.scholarshipExcluded !== undefined) unset.scholarshipExcluded = 1;
    if (Object.keys(set).length === 0 && Object.keys(unset).length === 0) continue;
    await Student.updateOne({ _id: cur._id }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    writes.students++;
  }

  // --- 5. CLASS-scope improvement actions that still run ----------------------------------
  const running = await ImprovementAction.find({ scope: "CLASS", sectionId: { $in: ctx.fromSectionIds }, stoppedAt: null, dayKeys: { $gte: ctx.startKey } }).select("_id").lean();
  if (running.length) {
    await ImprovementAction.updateMany({ _id: { $in: running.map((r) => r._id) } }, { $set: { stoppedAt: new Date(), stoppedBy: actorId, stopReason: improvementStopReason(runId) } });
    run.improvementEndedIds = [...run.improvementEndedIds, ...running.map((r) => sid(r._id))];
    await run.save();
    writes.improvementEnded += running.length;
  }

  // --- 6. flip the current year - the last write ------------------------------------------
  // ONE write (a pipeline update), so there is never zero or two current years.
  const currents = await AcademicYear.find({ current: true }).select("_id").lean();
  if (!(currents.length === 1 && currents[0]._id.equals(ctx.toYear._id))) {
    await AcademicYear.updateMany({}, [{ $set: { current: { $eq: ["$_id", ctx.toYear._id] } } }]);
    writes.yearFlipped++;
  }

  // --- 7. audit + done --------------------------------------------------------------------
  if (run.status !== "CUT_OVER") {
    const lastUndo = (await Audit.findOne({ eventKind: "YEAR_CHANGE_CUT_OVER_UNDONE", "meta.runId": runId }).sort({ eventAt: -1 }).select("eventAt").lean()) as unknown as { eventAt: Date } | null;
    const have = await Audit.exists({ eventKind: "YEAR_CHANGE_CUT_OVER", "meta.runId": runId, ...(lastUndo ? { eventAt: { $gt: lastUndo.eventAt } } : {}) });
    if (!have) await writeAudit({
      eventKind: "YEAR_CHANGE_CUT_OVER",
      actorId: actor.userId,
      targetId: ctx.toYear._id,
      targetKind: "AcademicYear",
      meta: { runId, fromYearId: sid(ctx.fromYear._id), toYearId: sid(ctx.toYear._id), writes, leavers: ctx.leavers.length, before: run.before ?? [] },
    });
    run.status = "CUT_OVER";
    run.cutOverAt = new Date();
    await run.save();
    writes.run++;
    // the new year's section chat groups follow their class teachers (never blocks)
    const newSecs = await Section.find({ _id: { $in: [...ctx.planned.values()].map((e) => e.sectionId) }, classTeacherId: { $exists: true } }).select("_id").lean();
    for (const sec of newSecs) await onSectionTeachersChangedSync(sid(sec._id));
  }
  invariantAfter = await checkInvariant();
  return done();
}
