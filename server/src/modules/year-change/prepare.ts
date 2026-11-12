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
import { openEnrolment } from "../foundation/services/EnrolmentService";
import { writeAudit } from "../platform/services/AuditService";
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
  };
  total: number;
}

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

export async function applyPrepare(plan: YearChangePlan, runId: string, actor: YearChangeActor): Promise<PrepareResult> {
  assertYearChangeRight(actor, "prepare");
  if (!runId || !runId.trim()) throw new YearChangeRefusal(["রান আইডি লাগবে।"]);
  if (plan.refusals.length) throw new YearChangeRefusal(plan.refusals);

  const writes: PrepareResult["writes"] = { run: 0, classes: 0, sections: 0, enrolments: 0, admissions: 0, guardianLinks: 0, classTeachers: 0 };
  const actorId = oid(actor.userId);
  const toYearId = oid(plan.toYearId);

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

  // --- PLANNED enrolments for existing children ----------------------------------------------
  for (const e of plan.enrolments) {
    const secId = sectionId.get(`${e.toLevel}:${e.toSectionCode}`) as Types.ObjectId;
    const have = await Enrolment.findOne({ studentId: oid(e.studentId), academicYearId: toYearId });
    if (have) {
      if (have.status === "PLANNED" && have.runId === runId && have.sectionId.equals(secId)) continue;
      throw new YearChangeRefusal([`${e.schoolId}: ${plan.toLabel} বর্ষে অন্য একটি তালিকাভুক্তি আছে।`]);
    }
    await openEnrolment({ studentId: e.studentId, sectionId: secId, startKey: plan.startKey, status: "PLANNED", runId, createdBy: actorId });
    writes.enrolments++;
  }

  // --- admissions ----------------------------------------------------------------------------
  for (const a of plan.admissions) {
    const secId = sectionId.get(`${a.toLevel}:${a.toSectionCode}`) as Types.ObjectId;
    let st = await Student.findOne({ schoolId: a.schoolId });
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
    if (sec.runId !== runId) {
      // A pre-existing section: remember the old teacher so the undo can put them back.
      run.teacherSets = [...run.teacherSets, { sectionId: secId.toString(), previous: sec.classTeacherId ? sec.classTeacherId.toString() : null }];
      await run.save();
    }
    sec.classTeacherId = oid(t.teacherId);
    await sec.save();
    await ClassTeacherAssignment.create({ sectionId: secId, role: "class_teacher", teacherId: oid(t.teacherId), op: "assigned", actorId, at: new Date() });
    writes.classTeachers++;
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
