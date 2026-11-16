/**
 * MeetingReleaseReadService (D-#1634) — what a FAMILY reads of a published parents' meeting.
 *
 *   guardianMeetingResults(ctx, studentId) — GUARDIAN (own child, active link) or a staff
 *     caller holding `parents_meeting:view`: every PUBLISHED, not-withdrawn meeting for
 *     that child — label, date, window, the frozen numbers, the section-best row, and the
 *     CURRENT final Principal/Office comment (read live, so a later correction shows).
 *
 * STRUCTURAL SAFETY — this file is the whole guardian read path, and it reads exactly four
 * collections: ParentMeeting, ParentMeetingRelease (numbers only, no text field exists),
 * MeetingFinalComment, Student (the child's name). It does NOT import, and must never
 * import, `MeetingComment` (class-teacher summary), `MeetingSubjectNote`, `StudentComment`,
 * or `MeetingBriefService` (which reads all of them). The returned DTO is built field by
 * field — nothing is spread from a document — so a new field on a model cannot leak out.
 * `meetingRelease.test.ts` asserts both (source scan + marker strings in the JSON).
 *
 * Identity plane; no corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { callerHasPermission } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError, assertGuardianOfStudent } from "../../../middleware/authz";
import { ParentMeeting, type IParentMeeting } from "../models/ParentMeeting";
import { ParentMeetingRelease, type IParentMeetingRelease } from "../models/ParentMeetingRelease";
import { MeetingFinalComment } from "../models/MeetingFinalComment";
import { Student } from "../../foundation/models/Student";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { personName } from "../../../lib/personName";

export interface GuardianResultNumbers {
  attendance: { presentDays: number; markedDays: number; absentDays: number; leaveDays: number };
  classTests: { avgPercent: number | null; sat: number; held: number };
  homework: { submitted: number; received: number };
  assignment: { submitted: number; received: number };
}

export interface GuardianResultClassBest {
  withheld: boolean;
  attendancePresentDays: number | null;
  classTestAvgPct: number | null;
  homeworkPct: number | null;
  assignmentPct: number | null;
}

/** The final Principal/Office comment — the ONLY comment text a guardian is ever given. */
export interface GuardianResultFinal {
  strengths: string;
  concerns: string;
  updatedAt: string;
}

export interface GuardianMeetingResult {
  meetingId: string;
  instanceLabel: string;
  meetingDateKey: string;
  publishedAt: string;
  studentId: string;
  studentName: string;
  fromKey: string;
  toKey: string;
  numbers: GuardianResultNumbers;
  classBest: GuardianResultClassBest | null;
  final: GuardianResultFinal | null;
}

const str = (v: unknown): string => String(v);

function numbersOf(r: IParentMeetingRelease): GuardianResultNumbers {
  const n = r.numbers;
  return {
    attendance: {
      presentDays: n.attendance.presentDays,
      markedDays: n.attendance.markedDays,
      absentDays: n.attendance.absentDays,
      leaveDays: n.attendance.leaveDays,
    },
    classTests: { avgPercent: n.classTests.avgPercent ?? null, sat: n.classTests.sat, held: n.classTests.held },
    homework: { submitted: n.homework.submitted, received: n.homework.received },
    assignment: { submitted: n.assignment.submitted, received: n.assignment.received },
  };
}

function classBestOf(r: IParentMeetingRelease): GuardianResultClassBest | null {
  const c = r.classBest;
  if (!c) return null;
  return {
    withheld: !!c.withheld,
    attendancePresentDays: c.attendancePresentDays ?? null,
    classTestAvgPct: c.classTestAvgPct ?? null,
    homeworkPct: c.homeworkPct ?? null,
    assignmentPct: c.assignmentPct ?? null,
  };
}

/** Who may ask: the child's own linked guardian, or staff with the existing meeting read permission. */
async function assertMayRead(ctx: AppContext, studentId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (ctx.auth.role === "GUARDIAN") {
    await assertGuardianOfStudent(ctx, studentId);
    return;
  }
  if (!callerHasPermission(ctx.auth, "parents_meeting:view")) {
    throw new ForbiddenError("সভার ফলাফল দেখার অনুমতি আপনার নেই");
  }
}

export async function guardianMeetingResults(ctx: AppContext, studentId: string): Promise<GuardianMeetingResult[]> {
  if (!Types.ObjectId.isValid(studentId)) throw new ForbiddenError("ভুল আইডি");
  await assertMayRead(ctx, studentId);

  const sid = new Types.ObjectId(studentId);
  // Only a published, not-withdrawn meeting is visible at all.
  const meetings = (await ParentMeeting.find({ guardianPublishedAt: { $ne: null }, guardianWithdrawnAt: null })
    .select("instanceLabel meetingDate guardianPublishedAt")
    .sort({ meetingDate: -1 })
    .lean()) as unknown as Array<Pick<IParentMeeting, "_id" | "instanceLabel" | "meetingDate" | "guardianPublishedAt">>;
  if (meetings.length === 0) return [];
  const ids = meetings.map((m) => m._id);

  const [releases, finals, student] = await Promise.all([
    ParentMeetingRelease.find({ meetingId: { $in: ids }, studentId: sid }).lean() as unknown as Promise<IParentMeetingRelease[]>,
    MeetingFinalComment.find({ meetingId: { $in: ids }, studentId: sid }).select("meetingId strengths concerns updatedAt").lean(),
    Student.findById(sid).select("name nameBn").lean() as unknown as Promise<{ name?: string; nameBn?: string } | null>,
  ]);
  const releaseOf = new Map(releases.map((r) => [str(r.meetingId), r]));
  const finalOf = new Map(finals.map((f) => [str(f.meetingId), f]));
  const studentName = personName(student, "শিক্ষার্থী");

  const out: GuardianMeetingResult[] = [];
  for (const m of meetings) {
    const r = releaseOf.get(str(m._id));
    if (!r) continue; // no snapshot for this child (e.g. enrolled after publishing) → nothing to show
    const f = finalOf.get(str(m._id));
    const hasFinal = !!f && (f.strengths.trim() !== "" || f.concerns.trim() !== "");
    out.push({
      meetingId: str(m._id),
      instanceLabel: m.instanceLabel,
      meetingDateKey: dhakaDayKey(new Date(m.meetingDate)),
      publishedAt: new Date(m.guardianPublishedAt as Date).toISOString(),
      studentId,
      studentName,
      fromKey: r.window.fromKey,
      toKey: r.window.toKey,
      numbers: numbersOf(r),
      classBest: classBestOf(r),
      final: hasFinal && f ? { strengths: f.strengths, concerns: f.concerns, updatedAt: new Date(f.updatedAt).toISOString() } : null,
    });
  }
  return out;
}
