/**
 * Absent at delivery vs the attendance register (D-#1004). A child the teacher marked ABSENT
 * when homework / an assignment was given, while the day's register says the child was in
 * school, got no work and the family is told it was an absence. Tier 2 for whoever gave the
 * work (caught by the app). Only that direction counts: register-absent but given is a late
 * arrival, which is normal. A unit whose register is not marked yet proves nothing and is
 * skipped. Never throws.
 */
import { Types } from "mongoose";
import { Student } from "../../foundation/models/Student";
import { StudentAttendanceDay } from "../../attendance/models/StudentAttendanceDay";
import { resolveUnits, unitKey, type StudentLite } from "../../attendance/attendanceUnit";
import { recordPlaceMistake } from "../../staff-mistakes/services/StaffMistakeNoteService";

export interface AbsentAtDeliveryInput {
  /** "hw" | "as" — keeps the two trackers' notes apart. */
  tracker: "hw" | "as";
  itemId: string;
  /** hwId / asId, for the card line. */
  label: string;
  absentStudentIds: string[];
  dateKey: string;
  ownerId: string | Types.ObjectId | null | undefined;
  at: Date;
}

/** Students the register shows PRESENT that day (their unit is marked and they are not on it). */
export async function presentOnRegister(studentIds: string[], dateKey: string): Promise<string[]> {
  const ids = studentIds.filter((id) => Types.ObjectId.isValid(id));
  if (ids.length === 0) return [];
  const students = (await Student.find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
    .select("_id sectionId classId")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; sectionId: Types.ObjectId; classId: Types.ObjectId }>;
  if (students.length === 0) return [];
  const days = (await StudentAttendanceDay.find({ dateKey }).select("sectionId subjectGroupId absentStudentIds").lean()) as unknown as Array<{
    sectionId?: Types.ObjectId | null;
    subjectGroupId?: Types.ObjectId | null;
    absentStudentIds: Types.ObjectId[];
  }>;
  const marked = new Set(days.map((d) => (d.sectionId ? `section:${d.sectionId}` : `subjectgroup:${d.subjectGroupId}`)));
  const absent = new Set(days.flatMap((d) => d.absentStudentIds.map(String)));
  const lites: StudentLite[] = students.map((s) => ({ id: String(s._id), sectionId: String(s.sectionId), classId: String(s.classId) }));
  const units = await resolveUnits(lites, dateKey);
  return lites
    .filter((s) => {
      const u = units.get(s.id);
      return !!u && marked.has(unitKey(u)) && !absent.has(s.id);
    })
    .map((s) => s.id);
}

export async function recordAbsentAtDelivery(input: AbsentAtDeliveryInput): Promise<boolean> {
  try {
    if (input.absentStudentIds.length === 0 || !input.ownerId || !input.dateKey) return false;
    const present = await presentOnRegister(input.absentStudentIds, input.dateKey);
    if (present.length === 0) return false;
    const names = (await Student.find({ _id: { $in: present.map((id) => new Types.ObjectId(id)) } })
      .select("name nameBn")
      .lean()) as unknown as Array<{ name: string; nameBn?: string }>;
    const shown = names.slice(0, 5).map((s) => s.nameBn || s.name);
    const more = names.length > shown.length ? ` ও আরও ${names.length - shown.length} জন` : "";
    return await recordPlaceMistake({
      kind: "ABSENT_AT_DELIVERY",
      tier: 2,
      refKey: `${input.tracker}:${input.itemId}`,
      ownerId: input.ownerId,
      correctedBy: "system",
      at: input.at,
      line: `${input.label} (${input.dateKey}): উপস্থিতির খাতায় উপস্থিত, কিন্তু কাজ দেওয়ার সময় অনুপস্থিত — ${shown.join(", ")}${more}`,
    });
  } catch (err) {
    console.error("[deliveryAttendanceCheck] the register cross-check failed (the work was given):", err);
    return false;
  }
}
