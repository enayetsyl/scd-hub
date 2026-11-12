/**
 * Undo (YC-4, prd-year-change section 3 step 3).
 *
 *  undoPrepare  "প্রস্তুতি বাতিল": deletes every row carrying the run id (planned enrolments, admissions
 *               and their guardian links, the run's classes and sections, their class-teacher log rows)
 *               and puts back the class teacher of any pre-existing next-year section the run changed.
 *               Refused once the cut-over has started (undo that first). Leaves 0 rows with the run id.
 *  undoCutover  "পরিবর্তন ফিরিয়ে নিন": restores each Student byte for byte from the audit before-state
 *               (run record as fallback), reopens the past year's enrolments, puts the new year's back
 *               to PLANNED, restarts the improvement actions it stopped, and flips the current year
 *               back FIRST. Work created on next-year sections in between stays and is counted.
 *
 * Both take `{ dryRun: true }` to return the plan without writing.
 */
import { Types } from "mongoose";
import { AcademicYear } from "../foundation/models/AcademicYear";
import { Class } from "../foundation/models/Class";
import { Section } from "../foundation/models/Section";
import { Student } from "../foundation/models/Student";
import { Enrolment } from "../foundation/models/Enrolment";
import { GuardianLink } from "../foundation/models/GuardianLink";
import { ClassTeacherAssignment } from "../foundation/models/ClassTeacherAssignment";
import { Audit } from "../platform/models/Audit";
import { HomeworkItem } from "../trackers/models/HomeworkItem";
import { AssignmentItem } from "../trackers/models/AssignmentItem";
import { StudentAttendanceDay } from "../attendance/models/StudentAttendanceDay";
import { ImprovementAction } from "../improvement/models/ImprovementAction";
import { dayBefore } from "../foundation/services/EnrolmentService";
import { dhakaDayKey } from "../../lib/dhakaDay";
import { writeAudit } from "../platform/services/AuditService";
import { assertYearChangeRight } from "./authz";
import { improvementStopReason } from "./cutover";
import { YearChangeRun, type StudentBefore } from "./models/YearChangeRun";
import { YearChangeRefusal, type YearChangeActor } from "./types";

export interface UndoPlan {
  kind: "PREPARE" | "CUT_OVER";
  runId: string;
  counts: Record<string, number>;
  notes: string[];
  refusals: string[];
}
export interface UndoResult {
  plan: UndoPlan;
  /** Rows written/deleted (0 on a dry run). */
  total: number;
}

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

// ---------------------------------------------------------------------------------------------
// undo prepare
// ---------------------------------------------------------------------------------------------

async function planPrepareUndo(runId: string): Promise<{ plan: UndoPlan; sectionIds: Types.ObjectId[]; classIds: Types.ObjectId[]; admissionIds: Types.ObjectId[] }> {
  const refusals: string[] = [];
  const notes: string[] = [];
  const run = await YearChangeRun.findOne({ runId }).lean();
  if (!run) refusals.push(`রান ${runId} পাওয়া যায়নি (প্রস্তুতি নেই বা আগেই বাতিল)।`);
  else if (run.status !== "PREPARED") refusals.push(`রান ${runId}-এর উত্তরণ শুরু হয়েছে — আগে "পরিবর্তন ফিরিয়ে নিন" চালান।`);
  const enrolments = await Enrolment.find({ runId }).select("status").lean();
  if (enrolments.some((e) => e.status === "ACTIVE")) refusals.push("এই রানের কিছু তালিকাভুক্তি ACTIVE — প্রস্তুতি বাতিল করা যাবে না।");
  const admissions = await Student.find({ yearChangeRunId: runId }).select("active").lean();
  if (admissions.some((a) => a.active)) refusals.push("এই রানের কিছু ভর্তি-শিক্ষার্থী সক্রিয় হয়ে গেছে।");
  const sections = await Section.find({ runId }).select("_id classId").lean();
  const classes = await Class.find({ runId }).select("_id").lean();
  const sectionIds = sections.map((s) => s._id);
  const pointing = sectionIds.length ? await Student.countDocuments({ sectionId: { $in: sectionIds }, yearChangeRunId: { $ne: runId } }) : 0;
  if (pointing) refusals.push(`${pointing} জন শিক্ষার্থী এই রানের শাখায় আছে।`);
  const admissionIds = admissions.map((a) => a._id);
  const links = admissionIds.length ? await GuardianLink.countDocuments({ studentId: { $in: admissionIds } }) : 0;
  const teacherRestores = run?.teacherSets.length ?? 0;
  if (classes.length) notes.push("ক্লাস মুছবে শুধু যেগুলোতে অন্য শাখা নেই।");
  return {
    plan: {
      kind: "PREPARE",
      runId,
      counts: { enrolments: enrolments.length, admissions: admissions.length, guardianLinks: links, sections: sections.length, classes: classes.length, classTeachersRestored: teacherRestores },
      notes,
      refusals,
    },
    sectionIds,
    classIds: classes.map((c) => c._id),
    admissionIds,
  };
}

export async function planUndoPrepare(runId: string, actor?: YearChangeActor): Promise<UndoPlan> {
  if (actor) assertYearChangeRight(actor, "view");
  return (await planPrepareUndo(runId)).plan;
}

export async function undoPrepare(runId: string, actor: YearChangeActor, opts: { dryRun?: boolean } = {}): Promise<UndoResult> {
  assertYearChangeRight(actor, "undo");
  const { plan, sectionIds, classIds, admissionIds } = await planPrepareUndo(runId);
  if (opts.dryRun) return { plan, total: 0 };
  if (plan.refusals.length) throw new YearChangeRefusal(plan.refusals);
  const run = await YearChangeRun.findOne({ runId });
  const actorId = oid(actor.userId);
  let total = 0;

  // Class teachers the run set on sections it did not create go back to what they were.
  for (const t of run?.teacherSets ?? []) {
    const sec = await Section.findById(t.sectionId);
    if (!sec || sec.runId === runId) continue;
    const before = t.previous;
    if (before) await Section.updateOne({ _id: sec._id }, { $set: { classTeacherId: oid(before) } });
    else await Section.updateOne({ _id: sec._id }, { $unset: { classTeacherId: 1 } });
    await ClassTeacherAssignment.create({ sectionId: sec._id, role: "class_teacher", teacherId: before ? oid(before) : undefined, op: before ? "assigned" : "cleared", actorId, at: new Date() });
    total++;
  }
  total += (await Enrolment.deleteMany({ runId })).deletedCount ?? 0;
  if (admissionIds.length) {
    total += (await GuardianLink.deleteMany({ studentId: { $in: admissionIds } })).deletedCount ?? 0;
    total += (await Student.deleteMany({ _id: { $in: admissionIds }, yearChangeRunId: runId })).deletedCount ?? 0;
  }
  if (sectionIds.length) {
    total += (await ClassTeacherAssignment.deleteMany({ sectionId: { $in: sectionIds } })).deletedCount ?? 0;
    total += (await Section.deleteMany({ _id: { $in: sectionIds }, runId })).deletedCount ?? 0;
  }
  for (const cid of classIds) {
    if (await Section.exists({ classId: cid })) continue;
    total += (await Class.deleteOne({ _id: cid, runId })).deletedCount ?? 0;
  }
  if (run) {
    await YearChangeRun.deleteOne({ _id: run._id });
    total++;
  }
  await writeAudit({
    eventKind: "YEAR_CHANGE_PREPARE_UNDONE",
    actorId: actor.userId,
    targetKind: "YearChangeRun",
    meta: { runId, counts: plan.counts, total },
  });
  return { plan, total };
}

// ---------------------------------------------------------------------------------------------
// undo cut-over
// ---------------------------------------------------------------------------------------------

async function beforeStateOf(runId: string): Promise<StudentBefore[] | null> {
  const audit = (await Audit.findOne({ eventKind: "YEAR_CHANGE_CUT_OVER", "meta.runId": runId }).sort({ eventAt: -1 }).lean()) as unknown as { meta?: { before?: StudentBefore[] } } | null;
  if (audit?.meta?.before?.length) return audit.meta.before;
  const run = await YearChangeRun.findOne({ runId }).select("before").lean();
  return run?.before?.length ? run.before : null;
}

async function planCutoverUndo(runId: string) {
  const refusals: string[] = [];
  const notes: string[] = [];
  const run = await YearChangeRun.findOne({ runId });
  if (!run) refusals.push(`রান ${runId} পাওয়া যায়নি।`);
  else if (run.status === "PREPARED") refusals.push("এই রানের উত্তরণ এখনো হয়নি।");
  const before = run ? await beforeStateOf(runId) : null;
  if (run && !before) refusals.push("অডিট ও রান — কোথাও আগের অবস্থা সংরক্ষিত নেই।");
  const fromYear = run ? await AcademicYear.findById(run.fromYearId).lean() : null;
  const toYear = run ? await AcademicYear.findById(run.toYearId).lean() : null;
  const startKey = toYear ? dhakaDayKey(toYear.startDate) : "";
  const closeKey = startKey ? dayBefore(startKey) : "";
  const newRows = run ? await Enrolment.find({ runId, status: "ACTIVE" }).select("sectionId").lean() : [];
  const newSectionIds = [...new Set(newRows.map((e) => e.sectionId.toString()))].map(oid);
  const studentIds = (before ?? []).map((b) => oid(b.studentId));
  const reopen = fromYear ? await Enrolment.countDocuments({ academicYearId: fromYear._id, studentId: { $in: studentIds }, status: "CLOSED", endKey: closeKey, outcome: { $in: ["PROMOTED", "REPEATED", "LEFT"] } }) : 0;
  const homework = newSectionIds.length ? await HomeworkItem.countDocuments({ sectionId: { $in: newSectionIds } }) : 0;
  const assignments = newSectionIds.length ? await AssignmentItem.countDocuments({ sectionId: { $in: newSectionIds } }) : 0;
  const attendance = newSectionIds.length ? await StudentAttendanceDay.countDocuments({ sectionId: { $in: newSectionIds } }) : 0;
  if (homework + assignments + attendance > 0) {
    notes.push(`নতুন শাখায় তৈরি কাজ থেকে যাবে: বাড়ির কাজ ${homework}, অ্যাসাইনমেন্ট ${assignments}, উপস্থিতির দিন ${attendance}।`);
  }
  const plan: UndoPlan = {
    kind: "CUT_OVER",
    runId,
    counts: {
      studentsRestored: before?.length ?? 0,
      pastEnrolmentsReopened: reopen,
      newEnrolmentsToPlanned: newRows.length,
      improvementRestarted: run?.improvementEndedIds.length ?? 0,
      homeworkOnNewSections: homework,
      assignmentsOnNewSections: assignments,
      attendanceDaysOnNewSections: attendance,
    },
    notes,
    refusals,
  };
  return { plan, run, before, fromYear, toYear, closeKey };
}

export async function planUndoCutover(runId: string, actor?: YearChangeActor): Promise<UndoPlan> {
  if (actor) assertYearChangeRight(actor, "view");
  return (await planCutoverUndo(runId)).plan;
}

export async function undoCutover(runId: string, actor: YearChangeActor, opts: { dryRun?: boolean } = {}): Promise<UndoResult> {
  assertYearChangeRight(actor, "undo");
  const { plan, run, before, fromYear, toYear, closeKey } = await planCutoverUndo(runId);
  if (opts.dryRun) return { plan, total: 0 };
  if (plan.refusals.length || !run || !before || !fromYear || !toYear) throw new YearChangeRefusal(plan.refusals.length ? plan.refusals : ["রান অসম্পূর্ণ।"]);
  let total = 0;

  // 1. flip the current year back first
  if (!fromYear.current || toYear.current) {
    await AcademicYear.updateMany({ _id: { $ne: fromYear._id } }, { $set: { current: false } });
    await AcademicYear.updateOne({ _id: fromYear._id }, { $set: { current: true } });
    total++;
  }
  // 2. Students byte for byte (updatedAt included)
  for (const b of before) {
    const cur = await Student.findById(b.studentId).lean();
    if (!cur) continue;
    const same =
      cur.classId.toString() === b.classId &&
      cur.sectionId.toString() === b.sectionId &&
      cur.active === b.active &&
      cur.rollNumber === b.rollNumber &&
      cur.scholarshipExcluded === b.scholarshipExcluded &&
      (b.updatedAt === undefined || cur.updatedAt.toISOString() === b.updatedAt);
    if (same) continue;
    const set: Record<string, unknown> = { classId: oid(b.classId), sectionId: oid(b.sectionId), active: b.active };
    const unset: Record<string, 1> = {};
    if (b.updatedAt !== undefined) set.updatedAt = new Date(b.updatedAt);
    if (b.rollNumber !== undefined) set.rollNumber = b.rollNumber;
    else unset.rollNumber = 1;
    if (b.scholarshipExcluded !== undefined) set.scholarshipExcluded = b.scholarshipExcluded;
    else unset.scholarshipExcluded = 1;
    await Student.updateOne({ _id: cur._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { timestamps: false });
    total++;
  }
  // 3. past-year enrolments active again
  const studentIds = before.map((b) => oid(b.studentId));
  total += (
    await Enrolment.updateMany(
      { academicYearId: fromYear._id, studentId: { $in: studentIds }, status: "CLOSED", endKey: closeKey, outcome: { $in: ["PROMOTED", "REPEATED", "LEFT"] } },
      { $set: { status: "ACTIVE" }, $unset: { endKey: 1, outcome: 1 } },
    )
  ).modifiedCount;
  // 4. new-year rows back to PLANNED
  total += (await Enrolment.updateMany({ runId, status: "ACTIVE" }, { $set: { status: "PLANNED" } })).modifiedCount;
  // 5. improvement actions the cut-over stopped
  if (run.improvementEndedIds.length) {
    total += (
      await ImprovementAction.updateMany(
        { _id: { $in: run.improvementEndedIds.map(oid) }, stopReason: improvementStopReason(runId) },
        { $set: { stoppedAt: null, stoppedBy: null, stopReason: null } },
      )
    ).modifiedCount;
  }
  // 6. the run is a prepared run again (a new cut-over captures a fresh before-state)
  await YearChangeRun.updateOne({ _id: run._id }, { $set: { status: "PREPARED", improvementEndedIds: [] }, $unset: { before: 1, cutOverBy: 1, cutOverAt: 1 } });
  total++;
  await writeAudit({
    eventKind: "YEAR_CHANGE_CUT_OVER_UNDONE",
    actorId: actor.userId,
    targetId: fromYear._id,
    targetKind: "AcademicYear",
    meta: { runId, counts: plan.counts, notes: plan.notes, total },
  });
  return { plan, total };
}
