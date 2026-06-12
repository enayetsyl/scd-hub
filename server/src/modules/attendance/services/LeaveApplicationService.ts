/**
 * LeaveApplicationService (AT-3, D-#66) — RECORDED-ONLY student leave. No
 * approval workflow (CT-3 stays deferred): the record exists so reports can
 * split "absent with application" from "absent with NO application" (AT3.2/§8).
 * Office/Principal record on the guardian's behalf today; the guardian portal
 * submits directly later (rides guardian:read_child — pipeline).
 */
import { Types } from "mongoose";
import { parseDateKey } from "../dates";
import {
  StudentLeaveApplication,
  type IStudentLeaveApplication,
} from "../models/StudentLeaveApplication";
import { Student } from "../../foundation/models/Student";
import { writeAudit } from "../../platform/services/AuditService";
import { AttendanceError } from "./StudentAttendanceService";

/** Pure: does any application for this student cover the date? (AT3.2) */
export function applicationCovers(
  applications: Array<Pick<IStudentLeaveApplication, "fromKey" | "toKey"> & { studentId: { toString(): string } }>,
  studentId: string,
  dateKey: string,
): boolean {
  return applications.some(
    (a) => a.studentId.toString() === studentId && a.fromKey <= dateKey && dateKey <= a.toKey,
  );
}

export async function submitLeaveApplication(
  studentId: string,
  fromKey: string,
  toKey: string,
  reason: string,
  actorId: string,
): Promise<IStudentLeaveApplication> {
  parseDateKey(fromKey);
  parseDateKey(toKey);
  if (fromKey > toKey) throw new AttendanceError("fromDate must not be after toDate");
  if (!reason.trim()) throw new AttendanceError("A reason is required");
  const student = await Student.findById(studentId).lean();
  if (!student || !student.active) throw new AttendanceError("Student not found");

  const application = await StudentLeaveApplication.create({
    studentId: new Types.ObjectId(studentId),
    fromKey,
    toKey,
    reason: reason.trim(),
    submittedBy: new Types.ObjectId(actorId),
    submittedAt: new Date(),
  });
  await writeAudit({
    eventKind: "LEAVE_APPLICATION_SUBMITTED",
    actorId,
    targetId: application._id,
    targetKind: "StudentLeaveApplication",
    meta: { studentId, fromKey, toKey },
  });
  return application;
}

/** Applications overlapping [fromKey, toKey] for the section's students —
 *  visible to the class teacher and Office (AT3.1). */
export async function leaveApplicationsForSection(
  sectionId: string,
  fromKey: string,
  toKey: string,
): Promise<IStudentLeaveApplication[]> {
  const students = await Student.find({ sectionId, active: true }).select("_id").lean();
  return StudentLeaveApplication.find({
    studentId: { $in: students.map((s) => s._id) },
    fromKey: { $lte: toKey },
    toKey: { $gte: fromKey },
  })
    .sort({ fromKey: -1 })
    .lean() as unknown as Promise<IStudentLeaveApplication[]>;
}

/** All applications overlapping a range for one student (history view). */
export async function leaveApplicationsForStudent(
  studentId: string,
  fromKey: string,
  toKey: string,
): Promise<IStudentLeaveApplication[]> {
  return StudentLeaveApplication.find({
    studentId,
    fromKey: { $lte: toKey },
    toKey: { $gte: fromKey },
  })
    .sort({ fromKey: -1 })
    .lean() as unknown as Promise<IStudentLeaveApplication[]>;
}
