/**
 * AttendanceCorrectionService (D-#944) — a submitted absent list changed: record which
 * children flipped, on the day's marker's note, and make it a StaffMistake for them.
 *
 * The marker's own re-submit may carry a reason (correctionReasonContext, kind
 * ATTENDANCE_CORRECTION); a correction by Office / the Principal asks the marker to explain.
 * "শিক্ষার্থী দেরিতে এসেছে" / "অন্য কাজে বাইরে ছিল" are accepted at once (autoExcuses).
 *
 * Best-effort: a failure is logged and NEVER fails the attendance save.
 */
import { Types } from "mongoose";
import { personName } from "../../../lib/personName";
import {
  AttendanceCorrectionNote,
  type AttendanceCorrectionChange,
  type IAttendanceCorrectionNote,
} from "../models/AttendanceCorrectionNote";
import { Student } from "../../foundation/models/Student";
import { User } from "../../foundation/models/User";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { SubjectGroup } from "../../routine/models/SubjectGroup";
import { currentCorrectionReason } from "../../staff-mistakes/services/correctionReasonContext";
import { recordMistakeFromSource } from "../../staff-mistakes/services/StaffMistakeService";
import { StaffMistake } from "../../staff-mistakes/models/StaffMistake";

export interface AttendanceCorrectionInput {
  unitType: "section" | "subjectGroup";
  unitId: string;
  dateKey: string;
  /** The day's marker before this save — the note's owner. */
  ownerId: Types.ObjectId | string;
  correctedBy: string;
  before: readonly (Types.ObjectId | string)[];
  after: readonly (Types.ObjectId | string)[];
  at: Date;
}

/** The children whose mark changed between two absent lists. */
export function attendanceDiff(
  before: readonly (Types.ObjectId | string)[],
  after: readonly (Types.ObjectId | string)[],
): { studentId: string; from: "ABSENT" | "PRESENT"; to: "ABSENT" | "PRESENT" }[] {
  const b = new Set(before.map(String));
  const a = new Set(after.map(String));
  return [
    ...[...b].filter((id) => !a.has(id)).map((studentId) => ({ studentId, from: "ABSENT" as const, to: "PRESENT" as const })),
    ...[...a].filter((id) => !b.has(id)).map((studentId) => ({ studentId, from: "PRESENT" as const, to: "ABSENT" as const })),
  ];
}

/** Returns true when something changed and was recorded. */
export async function recordAttendanceCorrection(ev: AttendanceCorrectionInput): Promise<boolean> {
  try {
    const diff = attendanceDiff(ev.before, ev.after);
    if (diff.length === 0) return false;
    const owner = new Types.ObjectId(ev.ownerId.toString());
    const base = { unitType: ev.unitType, unitId: new Types.ObjectId(ev.unitId), dateKey: ev.dateKey, staffUserId: owner };
    // The open episode keeps collecting changes while its entry still waits for a reason;
    // once explained or decided, this change starts the next one.
    const last = await AttendanceCorrectionNote.findOne(base).sort({ episode: -1 }).select("_id episode").lean();
    let episode = last?.episode ?? 1;
    if (last) {
      const entry = await StaffMistake.findOne({ kind: "ATTENDANCE_CORRECTION", sourceId: last._id, staffUserId: owner }).select("status").lean();
      if (entry && entry.status !== "EXPLANATION_DUE") episode += 1;
    }
    const key = { ...base, episode };
    const changes: AttendanceCorrectionChange[] = diff.map((d) => ({
      studentId: new Types.ObjectId(d.studentId),
      from: d.from,
      to: d.to,
      at: ev.at,
      by: new Types.ObjectId(ev.correctedBy),
    }));
    let note: IAttendanceCorrectionNote | null;
    try {
      note = await AttendanceCorrectionNote.findOneAndUpdate(
        key,
        { $setOnInsert: key, $push: { changes: { $each: changes } } },
        { upsert: true, new: true },
      );
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      note = await AttendanceCorrectionNote.findOneAndUpdate(key, { $push: { changes: { $each: changes } } }, { new: true });
    }
    if (!note) return false;
    await recordMistakeFromSource({
      kind: "ATTENDANCE_CORRECTION",
      tier: 1,
      sourceId: note._id,
      staffUserId: owner,
      correctedBy: ev.correctedBy,
      at: ev.at,
      reason: currentCorrectionReason(),
    });
    return true;
  } catch (err) {
    console.error("[AttendanceCorrectionService] recording a correction failed (save unaffected):", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Reads — the detail behind a staff mistake entry
// ---------------------------------------------------------------------------

export interface AttendanceCorrectionNoteShape {
  id: string;
  unitLabel: string;
  dateKey: string;
  changes: { studentId: string; studentName: string; from: string; to: string; at: Date; byName: string }[];
}

export async function attendanceCorrectionNotesByIds(ids: readonly string[]): Promise<Map<string, AttendanceCorrectionNoteShape>> {
  const valid = ids.filter((id) => Types.ObjectId.isValid(id));
  if (valid.length === 0) return new Map();
  const notes = await AttendanceCorrectionNote.find({ _id: { $in: valid } }).lean();
  const sectionIds = notes.filter((n) => n.unitType === "section").map((n) => n.unitId);
  const groupIds = notes.filter((n) => n.unitType === "subjectGroup").map((n) => n.unitId);
  const studentIds = notes.flatMap((n) => n.changes.map((c) => c.studentId));
  const userIds = notes.flatMap((n) => n.changes.map((c) => c.by));
  const [sections, groups, students, users] = await Promise.all([
    Section.find({ _id: { $in: sectionIds } }).select("nameBn classId").lean(),
    SubjectGroup.find({ _id: { $in: groupIds } }).select("nameBn").lean(),
    Student.find({ _id: { $in: studentIds } }).select("name nameBn").lean(),
    User.find({ _id: { $in: userIds } }).select("name nameBn").lean(),
  ]);
  const classes = await Class.find({ _id: { $in: sections.map((s) => s.classId) } }).select("nameBn").lean();
  const className = new Map(classes.map((c) => [String(c._id), c.nameBn]));
  const unitLabel = new Map<string, string>([
    ...sections.map((s) => [String(s._id), [className.get(String(s.classId)), s.nameBn].filter(Boolean).join(" · ")] as [string, string]),
    ...groups.map((g) => [String(g._id), g.nameBn] as [string, string]),
  ]);
  const studentName = new Map(students.map((s) => [String(s._id), personName(s)]));
  const userName = new Map(users.map((u) => [String(u._id), personName(u)]));
  return new Map(
    notes.map((n) => [
      String(n._id),
      {
        id: String(n._id),
        unitLabel: unitLabel.get(String(n.unitId)) ?? "",
        dateKey: n.dateKey,
        changes: n.changes.map((c) => ({
          studentId: String(c.studentId),
          studentName: studentName.get(String(c.studentId)) ?? "",
          from: c.from,
          to: c.to,
          at: c.at,
          byName: userName.get(String(c.by)) ?? "",
        })),
      },
    ]),
  );
}
