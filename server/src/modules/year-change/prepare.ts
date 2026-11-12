/**
 * applyPrepare (YC-4, prd-year-change section 3 step 1): writes the next year's Class + Section rows,
 * PLANNED enrolments, admissions (Student active:false + PLANNED enrolment + guardian link) and class
 * teachers. Every row it creates carries the `runId`. Nothing a "today" reader looks at changes:
 * pointers are untouched, PLANNED rows are never live, and the new classes belong to a year that is
 * not current.
 *
 * Idempotent: it looks each row up before writing, so a re-run of the same plan writes 0 and a broken
 * run is finished by running it again.
 */
import { Types } from "mongoose";
import { Class } from "../foundation/models/Class";
import { Section } from "../foundation/models/Section";
import { Student } from "../foundation/models/Student";
import { Enrolment } from "../foundation/models/Enrolment";
import { Guardian } from "../foundation/models/Guardian";
import { GuardianLink } from "../foundation/models/GuardianLink";
import { ClassTeacherAssignment } from "../foundation/models/ClassTeacherAssignment";
import { openEnrolment, placeOfSection } from "../foundation/services/EnrolmentService";
import { writeAudit } from "../platform/services/AuditService";
import { normSchoolId } from "./plan";
import { applyScheduleCopy, NO_COPY_WRITES, ScheduleCopyRefusal } from "./copy";
import { assertYearChangeRight } from "./authz";
import { YearChangeRun } from "./models/YearChangeRun";
import { YearChangeRefusal, SECTION_LABEL_BN, type YearChangeActor, type YearChangePlan } from "./types";

export interface PrepareResult {
  runId: string;
  writes: {
    run: number;
    classes: number;
    sections: number;
    enrolments: number;
    admissions: number;
    guardianLinks: number;
    classTeachers: number;
    enrolmentsUpdated: number;
    removed: number;
    admissionsUpdated: number;
    /** YC-6 routine + schedule copy. */
    routineSlots: number;
    routineEnded: number;
    bellWindows: number;
    assignmentSchedule: number;
    grants: number;
    grantsExpired: number;
    masteryEnablements: number;
  };
  total: number;
}

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

export async function applyPrepare(plan: YearChangePlan, runId: string, actor: YearChangeActor): Promise<PrepareResult> {
  assertYearChangeRight(actor, "prepare");
  if (!runId || !runId.trim()) throw new YearChangeRefusal(["রান আইডি লাগবে।"]);
  if (plan.refusals.length) throw new YearChangeRefusal(plan.refusals);

  const writes: PrepareResult["writes"] = { run: 0, classes: 0, sections: 0, enrolments: 0, admissions: 0, guardianLinks: 0, classTeachers: 0, enrolmentsUpdated: 0, removed: 0, admissionsUpdated: 0, ...NO_COPY_WRITES };
  const actorId = oid(actor.userId);
  const toYearId = oid(plan.toYearId);

  // One prepared run per year pair: a second runId is refused (reuse the first, or undo it).
  const other = await YearChangeRun.findOne({ fromYearId: oid(plan.fromYearId), toYearId, runId: { $ne: runId } }).select("runId").lean();
  if (other) throw new YearChangeRefusal([`এই শিক্ষাবর্ষ জোড়ার জন্য রান ${other.runId} আগেই আছে — সেটিই ব্যবহার করুন বা আগে বাতিল করুন।`]);
  if (plan.runId && plan.runId !== runId) throw new YearChangeRefusal([`রান আইডি ${plan.runId} হতে হবে।`]);

  // The run record first: a crash later leaves a run the next call picks up and finishes.
  let run = await YearChangeRun.findOne({ runId });
  if (run && run.status !== "PREPARED") throw new YearChangeRefusal([`রান ${runId} আগেই উত্তরণ শুরু করেছে — প্রস্তুতি আর চালানো যাবে না।`]);
  if (run && (!run.fromYearId.equals(plan.fromYearId) || !run.toYearId.equals(plan.toYearId))) {
    throw new YearChangeRefusal([`রান ${runId} অন্য শিক্ষাবর্ষ জোড়ার জন্য তৈরি।`]);
  }
  const leaverIds = plan.leavers.map((l) => l.studentId);
  if (!run) {
    run = await YearChangeRun.create({ runId, fromYearId: oid(plan.fromYearId), toYearId, status: "PREPARED", leaverIds, preparedBy: actorId });
    writes.run++;
  } else if ([...leaverIds].sort().join() !== [...run.leaverIds].sort().join()) {
    run.leaverIds = leaverIds;
    await run.save();
    writes.run++;
  }

  // --- classes + sections --------------------------------------------------------------------
  const classId = new Map<number, Types.ObjectId>();
  const sectionId = new Map<string, Types.ObjectId>();
  for (const c of plan.classes) {
    let cls = await Class.findOne({ level: c.level, academicYearId: toYearId });
    if (!cls) {
      cls = await Class.create({ level: c.level, nameBn: c.nameBn, academicYearId: toYearId, active: true, runId });
      writes.classes++;
    }
    classId.set(c.level, cls._id);
    for (const s of c.sections) {
      let sec = await Section.findOne({ classId: cls._id, code: s.code });
      if (!sec) {
        sec = await Section.create({ classId: cls._id, code: s.code, nameBn: s.nameBn || SECTION_LABEL_BN[s.code], active: true, runId });
        writes.sections++;
      }
      sectionId.set(`${c.level}:${s.code}`, sec._id);
    }
  }

  // --- reconcile: rows of this run the plan no longer contains ----------------------------------
  for (const r of plan.reconcile.removeEnrolments) {
    writes.removed += (await Enrolment.deleteMany({ runId, studentId: oid(r.studentId), status: "PLANNED" })).deletedCount ?? 0;
  }
  for (const a of plan.reconcile.removeAdmissions) {
    const st = await Student.findById(a.studentId).select("active yearChangeRunId").lean();
    if (!st || st.yearChangeRunId !== runId || st.active) continue;
    await GuardianLink.deleteMany({ studentId: st._id });
    await Enrolment.deleteMany({ runId, studentId: st._id, status: "PLANNED" });
    await Student.deleteOne({ _id: st._id });
    writes.removed++;
  }

  // --- PLANNED enrolments for existing children ----------------------------------------------
  for (const e of plan.enrolments) {
    const secId = sectionId.get(`${e.toLevel}:${e.toSectionCode}`) as Types.ObjectId;
    const have = await Enrolment.findOne({ studentId: oid(e.studentId), academicYearId: toYearId });
    if (have) {
      if (have.status === "PLANNED" && have.runId === runId && have.sectionId.equals(secId)) continue;
      if (have.status === "PLANNED" && have.runId === runId) {
        const place = await placeOfSection(secId);
        await Enrolment.updateOne({ _id: have._id }, { $set: { sectionId: secId, classId: place.classId, classLevel: place.classLevel } });
        writes.enrolmentsUpdated++;
        continue;
      }
      throw new YearChangeRefusal([`${e.schoolId}: ${plan.toLabel} বর্ষে অন্য একটি তালিকাভুক্তি আছে।`]);
    }
    await openEnrolment({ studentId: e.studentId, sectionId: secId, startKey: plan.startKey, status: "PLANNED", runId, createdBy: actorId });
    writes.enrolments++;
  }

  // --- admissions ----------------------------------------------------------------------------
  for (const a of plan.admissions) {
    const secId = sectionId.get(`${a.toLevel}:${a.toSectionCode}`) as Types.ObjectId;
    let st = await Student.findOne({ schoolId: a.schoolId });
    let wanted: typeof a | null = null;
    if (!st) {
      // the same child under another spelling of the number ("0104" / "104") is an edit, not a new one
      const mine = await Student.find({ yearChangeRunId: runId }).select("schoolId").lean();
      const hit = mine.find((m) => normSchoolId(m.schoolId) === normSchoolId(a.schoolId));
      if (hit) st = await Student.findById(hit._id);
    }
    wanted = a;
    if (st && st.yearChangeRunId !== runId) throw new YearChangeRefusal([`ভর্তি ${a.schoolId}: এই আইডি আগে থেকেই ব্যবহৃত।`]);
    if (!st) {
      st = await Student.create({
        schoolId: a.schoolId,
        name: a.name,
        ...(a.nameBn ? { nameBn: a.nameBn } : {}),
        gender: a.gender,
        phone: a.guardianPhone,
        classId: classId.get(a.toLevel),
        sectionId: secId,
        active: false,
        yearChangeRunId: runId,
      });
      writes.admissions++;
    }
    else if (wanted) {
      const sameSpot = st.classId.equals(classId.get(a.toLevel) as Types.ObjectId) && st.sectionId.equals(secId);
      if (st.schoolId !== a.schoolId || st.name !== a.name || (st.nameBn ?? "") !== (a.nameBn ?? "") || st.gender !== a.gender || (st.phone ?? "") !== a.guardianPhone || !sameSpot) {
        const phoneChanged = (st.phone ?? "") !== a.guardianPhone;
        await Student.updateOne({ _id: st._id }, { $set: { schoolId: a.schoolId, name: a.name, gender: a.gender, phone: a.guardianPhone, classId: classId.get(a.toLevel), sectionId: secId }, ...(a.nameBn ? {} : { $unset: { nameBn: 1 } }) });
        if (a.nameBn) await Student.updateOne({ _id: st._id }, { $set: { nameBn: a.nameBn } });
        const place = await placeOfSection(secId);
        await Enrolment.updateMany({ runId, studentId: st._id, status: "PLANNED" }, { $set: { sectionId: secId, classId: place.classId, classLevel: place.classLevel } });
        if (phoneChanged) await GuardianLink.deleteMany({ studentId: st._id });
        writes.admissionsUpdated++;
      }
    }
    if (!(await Enrolment.exists({ studentId: st._id, academicYearId: toYearId }))) {
      await openEnrolment({ studentId: st._id, sectionId: secId, startKey: plan.startKey, status: "PLANNED", runId, createdBy: actorId });
      writes.enrolments++;
    }
    // A guardian who already has a login (a sibling's family) is linked now; a new family is
    // provisioned by the Office once the child is active (provisioning links active students only).
    const g = await Guardian.findOne({ $or: [{ phone: a.guardianPhone }, { identifier: a.guardianPhone }] }).select("_id").lean();
    if (g && !(await GuardianLink.exists({ guardianId: g._id, studentId: st._id }))) {
      await GuardianLink.create({ guardianId: g._id, studentId: st._id, relation: "guardian", active: true });
      writes.guardianLinks++;
    }
  }

  // --- class teachers ------------------------------------------------------------------------
  for (const t of plan.classTeachers) {
    const secId = sectionId.get(`${t.level}:${t.sectionCode}`) as Types.ObjectId;
    const sec = await Section.findById(secId);
    if (!sec || (sec.classTeacherId && sec.classTeacherId.toString() === t.teacherId)) continue;
    if (sec.runId !== runId && !run.teacherSets.some((x) => x.sectionId === secId.toString())) {
      // A pre-existing section: remember the old teacher so the undo can put them back.
      run.teacherSets = [...run.teacherSets, { sectionId: secId.toString(), previous: sec.classTeacherId ? sec.classTeacherId.toString() : null }];
      await run.save();
    }
    sec.classTeacherId = oid(t.teacherId);
    await sec.save();
    await ClassTeacherAssignment.create({ sectionId: secId, role: "class_teacher", teacherId: oid(t.teacherId), op: "assigned", actorId, at: new Date() });
    writes.classTeachers++;
  }

  // --- YC-6: routine + schedule copy (future-dated / next-year rows only) ----------------------
  try {
    Object.assign(writes, await applyScheduleCopy(plan, runId, actorId));
  } catch (e) {
    if (e instanceof ScheduleCopyRefusal) throw new YearChangeRefusal(e.reasons);
    throw e;
  }

  const total = Object.values(writes).reduce((n, v) => n + v, 0);
  if (total > 0) {
    await writeAudit({
      eventKind: "YEAR_CHANGE_PREPARED",
      actorId: actor.userId,
      targetId: toYearId,
      targetKind: "AcademicYear",
      meta: { runId, fromYearId: plan.fromYearId, toYearId: plan.toYearId, writes, leavers: leaverIds.length },
    });
  }
  return { runId, writes, total };
}
