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
 */
import { Types } from "mongoose";
import { HomeworkStudentRecord } from "../models/HomeworkStudentRecord";
import { AssignmentStudentRecord } from "../models/AssignmentStudentRecord";

/** Move the given students' homework + assignment records to `toSectionId`. */
export async function rehomeStudentRecords(
  studentIds: (string | Types.ObjectId)[],
  toSectionId: string | Types.ObjectId,
): Promise<{ homework: number; assignment: number }> {
  if (studentIds.length === 0) return { homework: 0, assignment: 0 };
  const to = new Types.ObjectId(String(toSectionId));
  const filter = {
    studentId: { $in: studentIds.map((id) => new Types.ObjectId(String(id))) },
    sectionId: { $ne: to },
  };
  const [hw, as] = await Promise.all([
    HomeworkStudentRecord.updateMany(filter, { $set: { sectionId: to } }),
    AssignmentStudentRecord.updateMany(filter, { $set: { sectionId: to } }),
  ]);
  return { homework: hw.modifiedCount ?? 0, assignment: as.modifiedCount ?? 0 };
}
