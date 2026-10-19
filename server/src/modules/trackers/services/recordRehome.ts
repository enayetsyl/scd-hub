/**
 * Tracker records follow the student (owner report 2026-10-01, Zarir / C4 English).
 *
 * Homework and assignment student records carry the STUDENT's section, and every
 * workspace lists them by `record.sectionId`. When students change section (a
 * merge or a split), their records must move with them, or the new section's
 * teacher cannot see — let alone run the submission pass on — work issued before
 * the move. Items, hwId/asId and sequences stay where they are: one item keeps
 * serving every student it was issued to. No unique index involves
 * `record.sectionId`, so this is a plain bulk update.
 *
 * D-#770: an UNRELEASED monthly report (DRAFT / READY) follows the student too. The
 * console lists reports by `report.sectionId` and print access checks it, so the July
 * drafts left on the emptied সম্মিলিত (C3/C4/C5) were reachable from no section's
 * console. RELEASED / SUPERSEDED revisions are what the family was shown and stay
 * where they were issued.
 *
 * D-#771: a homework record that is not yet due (GIVEN) re-resolves its due date
 * against the NEW section's routine — the halves of a split class teach a subject
 * on different days, and the issue-time date was resolved on the old section.
 * Dates already reached (DUE onward, or a GIVEN whose date has passed) are kept.
 */
import { Types } from "mongoose";
import { HomeworkStudentRecord } from "../models/HomeworkStudentRecord";
import { AssignmentStudentRecord } from "../models/AssignmentStudentRecord";
import { HomeworkItem } from "../models/HomeworkItem";
import { MonthlyReport } from "../../reports/models/MonthlyReport";
import { resolveHomeworkDueDate } from "../homeworkDueDate";

/** Monthly-report statuses that have not reached the family — these follow the student. */
export const REHOMED_REPORT_STATUSES = ["DRAFT", "READY"] as const;

/** Move the given students' homework + assignment records (and unreleased monthly
 *  reports) to `toSectionId`. */
export async function rehomeStudentRecords(
  studentIds: (string | Types.ObjectId)[],
  toSectionId: string | Types.ObjectId,
): Promise<{ homework: number; assignment: number; monthlyReports: number; homeworkDueReset: number }> {
  if (studentIds.length === 0) return { homework: 0, assignment: 0, monthlyReports: 0, homeworkDueReset: 0 };
  const to = new Types.ObjectId(String(toSectionId));
  const filter = {
    studentId: { $in: studentIds.map((id) => new Types.ObjectId(String(id))) },
    sectionId: { $ne: to },
  };
  // Captured BEFORE the move: the not-yet-due homework records that change section.
  const pending = (await HomeworkStudentRecord.find({ ...filter, state: "GIVEN" })
    .select("_id hwItemId dueDate")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; hwItemId: Types.ObjectId; dueDate?: Date | null }>;

  const [hw, as, mr] = await Promise.all([
    HomeworkStudentRecord.updateMany(filter, { $set: { sectionId: to } }),
    AssignmentStudentRecord.updateMany(filter, { $set: { sectionId: to } }),
    MonthlyReport.updateMany(
      { ...filter, status: { $in: [...REHOMED_REPORT_STATUSES] } },
      { $set: { sectionId: to } },
    ),
  ]);

  const homeworkDueReset = await reresolvePendingDues(pending, to);
  return {
    homework: hw.modifiedCount ?? 0,
    assignment: as.modifiedCount ?? 0,
    monthlyReports: mr.modifiedCount ?? 0,
    homeworkDueReset,
  };
}

async function reresolvePendingDues(
  pending: Array<{ _id: Types.ObjectId; hwItemId: Types.ObjectId; dueDate?: Date | null }>,
  to: Types.ObjectId,
): Promise<number> {
  if (pending.length === 0) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const itemIds = [...new Set(pending.map((r) => r.hwItemId.toString()))];
  const items = (await HomeworkItem.find({ _id: { $in: itemIds } })
    .select("_id subject dateGiven")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; subject: string; dateGiven: Date }>;
  const dueByItem = new Map<string, Date>();
  for (const it of items) {
    dueByItem.set(it._id.toString(), await resolveHomeworkDueDate(to, it.subject, new Date(it.dateGiven)));
  }
  const ops = [];
  for (const r of pending) {
    const due = dueByItem.get(r.hwItemId.toString());
    if (!due) continue;
    // Never move a date that has already been reached, nor into the past.
    if (r.dueDate && new Date(r.dueDate) < today) continue;
    if (due < today) continue;
    if (r.dueDate && new Date(r.dueDate).getTime() === due.getTime()) continue;
    ops.push({ updateOne: { filter: { _id: r._id, state: "GIVEN" }, update: { $set: { dueDate: due } } } });
  }
  if (ops.length === 0) return 0;
  const res = await HomeworkStudentRecord.bulkWrite(ops);
  return res.modifiedCount ?? 0;
}
