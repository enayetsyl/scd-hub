/**
 * AssignmentLoadReportService (D-#329) — the Principal/Office oversight read:
 * assignments PLANNED (the rotation template) vs GIVEN (actually delivered items,
 * across all weeks), broken down BY SUBJECT and BY TEACHER.
 *
 *   planned   — rotation cells (schedule.entries) for that subject/teacher (the
 *               4-week cycle template).
 *   delivered — AssignmentItems materialized so far (DRAFT + ISSUED), all weeks.
 *   issued    — of those, the ones confirmed/issued to students.
 *
 * Teacher attribution uses the item's assigned teacherId (copied from the rotation
 * entry at delivery), so it lines up with the planned column. Identity/operational
 * plane; NO corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { AssignmentSchedule } from "../models/AssignmentSchedule";
import { AssignmentItem } from "../models/AssignmentItem";
import { User } from "../../foundation/models/User";

export interface AssignmentLoadRow {
  /** subject code (subject rows) or teacherId (teacher rows). */
  key: string;
  /** subject code (app localizes) or the teacher's name. */
  label: string;
  planned: number;
  delivered: number;
  issued: number;
}
export interface AssignmentLoadReport {
  bySubject: AssignmentLoadRow[];
  byTeacher: AssignmentLoadRow[];
}

interface Tally {
  planned: number;
  delivered: number;
  issued: number;
}
const blank = (): Tally => ({ planned: 0, delivered: 0, issued: 0 });
const bump = (m: Map<string, Tally>, k: string): Tally => {
  const cur = m.get(k) ?? blank();
  m.set(k, cur);
  return cur;
};

export async function assignmentLoadReport(academicYearId: string): Promise<AssignmentLoadReport> {
  const schedule = (await AssignmentSchedule.findOne({ academicYearId })
    .select("entries")
    .lean()) as unknown as { entries?: Array<{ subject: string; teacherId: { toString(): string } }> } | null;
  const entries = schedule?.entries ?? [];

  const items = (await AssignmentItem.find({ academicYearId: new Types.ObjectId(academicYearId) })
    .select("subject teacherId status")
    .lean()) as unknown as Array<{ subject: string; teacherId: { toString(): string }; status: string }>;

  const bySubject = new Map<string, Tally>();
  const byTeacher = new Map<string, Tally>();

  for (const e of entries) {
    bump(bySubject, e.subject).planned += 1;
    bump(byTeacher, e.teacherId.toString()).planned += 1;
  }
  for (const it of items) {
    const s = bump(bySubject, it.subject);
    s.delivered += 1;
    if (it.status === "ISSUED") s.issued += 1;
    const t = bump(byTeacher, it.teacherId.toString());
    t.delivered += 1;
    if (it.status === "ISSUED") t.issued += 1;
  }

  const users = (await User.find({ _id: { $in: [...byTeacher.keys()] } })
    .select("name")
    .lean()) as unknown as Array<{ _id: { toString(): string }; name: string }>;
  const nameById = new Map(users.map((u) => [u._id.toString(), u.name]));

  const subjectRows: AssignmentLoadRow[] = [...bySubject.entries()]
    .map(([subject, v]) => ({ key: subject, label: subject, ...v }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const teacherRows: AssignmentLoadRow[] = [...byTeacher.entries()]
    .map(([tid, v]) => ({ key: tid, label: nameById.get(tid) ?? tid, ...v }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return { bySubject: subjectRows, byTeacher: teacherRows };
}
