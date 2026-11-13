/**
 * The records pack for COMPARE (docs/prd-child-support-profile.md §6.4; the D-#399 posture): NUMBERS
 * ONLY — attendance %, homework completion %, assignment marks %, class-test average and trend, counts
 * of CONCERN / POSITIVE comments this term by type (and how many of them seeded a report, so one event
 * is not counted twice), the age band and `youngForClass`. Never a comment's text, never a rank.
 * Read through the existing services with the Principal's reach.
 */
import { Types } from "mongoose";
import { wholePicture } from "../../trackers/services/WholePictureService";
import { StudentComment } from "../../comments/models/StudentComment";
import { Student } from "../../foundation/models/Student";
import { SupportReport } from "../models/SupportReport";

export interface RecordsPack {
  attendancePct: number | null;
  attendanceTrend: string | null;
  homeworkCompletionPct: number | null;
  assignmentMarksPct: number | null;
  classTestAvgPct: number | null;
  classTestTrend: string | null;
  comments: { concern: Record<string, number>; positive: Record<string, number>; seededReports: number };
  youngForClass: boolean | null;
}

const whole = (n: number | null | undefined): number | null => (n == null || Number.isNaN(n) ? null : Math.round(n));

/** The youngest quarter of the section by date of birth; null when the child has no date of birth. */
export async function youngForClass(studentId: string): Promise<boolean | null> {
  const st = await Student.findById(studentId).select("sectionId dob").lean();
  if (!st?.dob) return null;
  const mates = await Student.find({ sectionId: st.sectionId, dob: { $ne: null } }).select("dob").lean();
  const dobs = mates.map((m) => new Date(m.dob as Date).getTime()).sort((a, b) => b - a); // youngest first
  const cut = Math.max(1, Math.floor(dobs.length / 4));
  return new Date(st.dob).getTime() >= dobs[cut - 1];
}

export async function recordsPack(studentId: string, now: Date = new Date()): Promise<RecordsPack> {
  let wp: Awaited<ReturnType<typeof wholePicture>> | null = null;
  try {
    wp = await wholePicture(studentId, now);
  } catch {
    wp = null; // a child with no tracker data yet: the numbers are simply unknown
  }
  const since = wp?.fromKey ? new Date(`${wp.fromKey}T00:00:00+06:00`) : new Date(now.getTime() - 120 * 86_400_000);
  const comments = await StudentComment.find({ studentId: new Types.ObjectId(studentId), createdAt: { $gte: since }, discardedAt: null })
    .select("_id type sentiment")
    .lean();
  const concern: Record<string, number> = {};
  const positive: Record<string, number> = {};
  for (const c of comments) {
    const bucket = c.sentiment === "CONCERN" ? concern : positive;
    bucket[c.type] = (bucket[c.type] ?? 0) + 1;
  }
  const seededReports = comments.length
    ? await SupportReport.countDocuments({ seedCommentId: { $in: comments.map((c) => c._id) }, status: { $nin: ["DRAFT", "WITHDRAWN"] } })
    : 0;
  return {
    attendancePct: whole(wp?.attendance.markedDays ? wp.attendance.presentPct : null),
    attendanceTrend: wp?.attendance.trajectory && wp.attendance.trajectory !== "na" ? wp.attendance.trajectory : null,
    homeworkCompletionPct: whole(wp?.homework.completionPct ?? null),
    assignmentMarksPct: whole(wp?.assignment.avgMarksPct ?? null),
    classTestAvgPct: whole(wp?.classTest.avgPercent ?? null),
    classTestTrend: wp?.classTest.trajectory && wp.classTest.trajectory !== "na" ? wp.classTest.trajectory : null,
    comments: { concern, positive, seededReports },
    youngForClass: await youngForClass(studentId),
  };
}
