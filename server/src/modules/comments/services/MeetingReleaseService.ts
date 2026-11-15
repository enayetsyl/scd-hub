/**
 * MeetingReleaseService (D-#1633, D-#1635) — the Principal publishes a parents' meeting
 * to guardians.
 *
 * Owner ruling 15 Nov 2026: per meeting, to ALL families (attended or not); the figures as
 * printed (attendance, class tests, homework, assignment) with the section-best row; and
 * ONLY the final Principal/Office comment. Never a class- or subject-teacher comment — the
 * guardian read path lives in `MeetingReleaseReadService` and cannot reach one.
 *
 *   saveMeetingReleaseSnapshots — upsert per-child number snapshots (a server script loads
 *       the PRINTED numbers through this). A printed row is never overwritten by a computed
 *       one; after publishing nothing changes unless `force`.
 *   publishMeetingToGuardians   — PRINCIPAL only. Snapshots every child on the meeting's
 *       slots that has none yet (computed from the numbers helpers — NOT `meetingBrief`,
 *       which also reads teacher comments), stamps the meeting, then ONCE per meeting
 *       tells the families (notification + pop-up). Idempotent.
 *   withdrawMeetingRelease      — PRINCIPAL; hides it again, tells nobody.
 *   meetingReleaseStatus        — the Principal card: state + how many children have a final comment.
 *
 * Identity plane; no corpus path (ADR-005).
 */
import { Types } from "mongoose";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { ParentMeeting, type IParentMeeting } from "../models/ParentMeeting";
import { ParentMeetingSlot } from "../models/ParentMeetingSlot";
import { MeetingFinalComment } from "../models/MeetingFinalComment";
import {
  ParentMeetingRelease,
  type IReleaseNumbers,
  type IReleaseClassBest,
  type ReleaseSnapshotSource,
} from "../models/ParentMeetingRelease";
import { Student } from "../../foundation/models/Student";
import { User } from "../../foundation/models/User";
import { PopupNoticeRecipient } from "../../popup-notices/models/PopupNoticeRecipient";
import { savePopupDraft, publishPopupNotice } from "../../popup-notices/services/PopupNoticeService";
import { emit } from "../../notifications/services/NotificationService";
import { writeAudit } from "../../platform/services/AuditService";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { meetingWindow, childNumbers, sectionClassBest, type BriefNumbers, type BriefClassBest } from "./MeetingBriefService";

export class MeetingReleaseError extends Error {}

/** "Tab/Screen" for the pop-up's OPEN_SCREEN button and the notification's tap (D-#1634). */
export const MEETING_RESULTS_TARGET = "GuardianHomeTab/ChildMeetingResults";
/** How long the pop-up stays available to a family that has not opened the app yet. */
const POPUP_DAYS = 10;
const DAY_MS = 86_400_000;

const str = (v: unknown): string => String(v);

// ===========================================================================
// Pure helpers
// ===========================================================================

/** PURE: the brief's numbers → the frozen snapshot shape (numbers only, no text). */
export function releaseNumbersOf(n: BriefNumbers): IReleaseNumbers {
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

export function releaseClassBestOf(b: BriefClassBest | null): IReleaseClassBest | null {
  if (!b) return null;
  return {
    withheld: b.withheld,
    attendancePresentDays: b.attendancePresentDays,
    classTestAvgPct: b.classTestAvgPct,
    homeworkPct: b.homeworkPct,
    assignmentPct: b.assignmentPct,
  };
}

/**
 * PURE: printed brief rows (`MeetingBrief`-shaped JSON: studentId + numbers + classBest) → snapshot rows.
 * Only the numbers are read; any comment text in the JSON is ignored by construction.
 * Throws a Bangla MeetingReleaseError naming the bad row.
 */
export function snapshotRowsFromBriefs(raw: unknown): ReleaseSnapshotRow[] {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { briefs?: unknown })?.briefs) ? (raw as { briefs: unknown[] }).briefs : null;
  if (!list) throw new MeetingReleaseError("ফাইলটি ব্রিফের তালিকা হতে হবে");
  return list.map((b, i) => {
    const o = b as { studentId?: string; numbers?: BriefNumbers; classBest?: BriefClassBest | null };
    if (!o?.studentId || !Types.ObjectId.isValid(o.studentId)) throw new MeetingReleaseError(`সারি ${i + 1}: studentId ঠিক নেই`);
    const n = o.numbers;
    if (!n?.attendance || !n.classTests || !n.homework || !n.assignment || !n.fromKey || !n.toKey) {
      throw new MeetingReleaseError(`সারি ${i + 1}: numbers অসম্পূর্ণ`);
    }
    return {
      studentId: o.studentId,
      window: { fromKey: n.fromKey, toKey: n.toKey },
      numbers: releaseNumbersOf(n),
      classBest: releaseClassBestOf(o.classBest ?? null),
    };
  });
}

function assertPrincipal(ctx: AppContext): string {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (ctx.auth.role !== "PRINCIPAL") throw new ForbiddenError("শুধু প্রধান শিক্ষক সভার ফলাফল অভিভাবকদের জন্য প্রকাশ করতে পারেন");
  return ctx.auth.userId;
}

async function mustMeeting(meetingId: string): Promise<IParentMeeting> {
  if (!Types.ObjectId.isValid(meetingId)) throw new MeetingReleaseError("ভুল আইডি");
  const m = (await ParentMeeting.findById(meetingId).lean()) as IParentMeeting | null;
  if (!m) throw new MeetingReleaseError("সভা পাওয়া যায়নি");
  return m;
}

/** Every child on the meeting's slots — all families, attended or not (still-enrolled only). */
async function meetingStudentIds(meetingId: Types.ObjectId): Promise<Types.ObjectId[]> {
  const slots = (await ParentMeetingSlot.find({ meetingId }).select("studentIds").lean()) as unknown as Array<{ studentIds: Types.ObjectId[] }>;
  const ids = [...new Set(slots.flatMap((s) => s.studentIds.map(str)))].map((s) => new Types.ObjectId(s));
  if (ids.length === 0) return [];
  const live = (await Student.find({ _id: { $in: ids }, active: { $ne: false } }).select("_id").lean()) as unknown as Array<{ _id: Types.ObjectId }>;
  return live.map((s) => s._id);
}

// ===========================================================================
// Snapshots
// ===========================================================================

export interface ReleaseSnapshotRow {
  studentId: string;
  window: { fromKey: string; toKey: string };
  numbers: IReleaseNumbers;
  classBest: IReleaseClassBest | null;
}

/**
 * Upsert snapshot rows. `source` "printed" overwrites; "computed" never overwrites a
 * "printed" row (the printed pack is what the family was told). Refuses once the meeting
 * is published unless `force`. Returns how many rows were written.
 */
export async function saveMeetingReleaseSnapshots(
  meetingId: string,
  rows: ReleaseSnapshotRow[],
  source: ReleaseSnapshotSource,
  opts: { force?: boolean } = {},
): Promise<number> {
  const meeting = await mustMeeting(meetingId);
  if (meeting.guardianPublishedAt && !meeting.guardianWithdrawnAt && !opts.force) {
    throw new MeetingReleaseError("সভাটি অভিভাবকদের জন্য প্রকাশিত — আগে প্রকাশ ফিরিয়ে নিন (অথবা force দিন)");
  }
  let written = 0;
  for (const r of rows) {
    if (!Types.ObjectId.isValid(r.studentId)) throw new MeetingReleaseError(`ভুল শিক্ষার্থী আইডি: ${r.studentId}`);
    const filter: Record<string, unknown> = { meetingId: meeting._id, studentId: new Types.ObjectId(r.studentId) };
    const doc = { window: r.window, numbers: r.numbers, classBest: r.classBest, snapshotSource: source };
    if (source === "computed") {
      // Insert only — an existing row (printed OR an earlier computed one) stays.
      const res = await ParentMeetingRelease.updateOne(filter, { $setOnInsert: doc }, { upsert: true });
      written += res.upsertedCount ?? 0;
    } else {
      await ParentMeetingRelease.updateOne(filter, { $set: doc }, { upsert: true });
      written += 1;
    }
  }
  return written;
}

/** Compute and insert a snapshot for every child on the meeting that has none. Returns the count added. */
async function fillMissingSnapshots(meeting: IParentMeeting, now: Date): Promise<number> {
  const ids = await meetingStudentIds(meeting._id);
  if (ids.length === 0) return 0;
  const have = new Set(
    ((await ParentMeetingRelease.find({ meetingId: meeting._id, studentId: { $in: ids } }).select("studentId").lean()) as unknown as Array<{ studentId: Types.ObjectId }>).map((r) => str(r.studentId)),
  );
  const missing = ids.filter((id) => !have.has(str(id)));
  if (missing.length === 0) return 0;

  const window = await meetingWindow(meeting, now); // ends at the meeting day, not "now"
  const students = (await Student.find({ _id: { $in: missing } }).select("sectionId").lean()) as unknown as Array<{ _id: Types.ObjectId; sectionId?: Types.ObjectId }>;
  let added = 0;
  for (let i = 0; i < students.length; i += 5) {
    const chunk = students.slice(i, i + 5);
    const rows = await Promise.all(
      chunk.map(async (s): Promise<ReleaseSnapshotRow> => {
        const [numbers, best] = await Promise.all([
          childNumbers(str(s._id), window.fromKey, window.toKey, null, now),
          // A comparator must never sink the release — no section best beats no release.
          s.sectionId ? sectionClassBest(str(s.sectionId), window.fromKey, window.toKey, now).catch(() => null) : Promise.resolve(null),
        ]);
        return {
          studentId: str(s._id),
          window: { fromKey: window.fromKey, toKey: window.toKey },
          numbers: releaseNumbersOf(numbers),
          classBest: releaseClassBestOf(best),
        };
      }),
    );
    added += await saveMeetingReleaseSnapshots(str(meeting._id), rows, "computed", { force: true });
  }
  return added;
}

// ===========================================================================
// Publish / withdraw
// ===========================================================================

export interface MeetingReleaseStatus {
  meetingId: string;
  published: boolean;
  publishedAt: string | null;
  publishedByName: string | null;
  withdrawnAt: string | null;
  notifiedAt: string | null;
  totalChildren: number;
  withFinal: number;
  withoutFinal: number;
  snapshots: number;
}

export async function meetingReleaseStatus(meetingId: string): Promise<MeetingReleaseStatus> {
  const m = await mustMeeting(meetingId);
  const ids = await meetingStudentIds(m._id);
  const [finals, snapshots, by] = await Promise.all([
    MeetingFinalComment.find({ meetingId: m._id, studentId: { $in: ids } }).select("strengths concerns").lean(),
    ParentMeetingRelease.countDocuments({ meetingId: m._id, studentId: { $in: ids } }),
    m.guardianPublishedBy ? User.findById(m.guardianPublishedBy).select("name").lean() : Promise.resolve(null),
  ]);
  const withFinal = finals.filter((f) => f.strengths.trim() !== "" || f.concerns.trim() !== "").length;
  return {
    meetingId,
    published: !!m.guardianPublishedAt && !m.guardianWithdrawnAt,
    publishedAt: m.guardianPublishedAt ? new Date(m.guardianPublishedAt).toISOString() : null,
    publishedByName: (by as { name?: string } | null)?.name ?? null,
    withdrawnAt: m.guardianWithdrawnAt ? new Date(m.guardianWithdrawnAt).toISOString() : null,
    notifiedAt: m.guardianNotifiedAt ? new Date(m.guardianNotifiedAt).toISOString() : null,
    totalChildren: ids.length,
    withFinal,
    withoutFinal: ids.length - withFinal,
    snapshots,
  };
}

/** Tell every reachable guardian of the meeting's children — pop-up first (it can refuse), then the notification. */
async function notifyFamilies(ctx: AppContext, meeting: IParentMeeting, studentIds: Types.ObjectId[], now: Date): Promise<void> {
  const label = meeting.instanceLabel;
  const draft = await savePopupDraft(ctx, null, {
    titleBn: "অভিভাবক সভার ফলাফল প্রকাশ হয়েছে",
    bodyBn: `${label} — {সন্তান}-এর সংখ্যা ও প্রধান শিক্ষকের মন্তব্য এখন অ্যাপে দেখা যাবে। নিচের বোতাম চাপলে খুলবে।`,
    tone: "info",
    audience: { studentIds: studentIds.map(str) },
    rules: { closeButton: true },
    actions: [{ kind: "OPEN_SCREEN", labelBn: "ফলাফল দেখুন", labelEn: "See the result", target: MEETING_RESULTS_TARGET }],
    endsOn: dhakaDayKey(new Date(now.getTime() + POPUP_DAYS * DAY_MS)),
    repeat: "once",
  });
  const published = await publishPopupNotice(ctx, draft.id, now);

  // The notification goes to the notice's FROZEN guardian recipients (never a second audience
  // resolve), and its key carries the RECIPIENT, never the meeting alone.
  const rows = await PopupNoticeRecipient.find({ noticeId: new Types.ObjectId(published.id), recipientKind: "GUARDIAN", reachable: true, test: { $ne: true } })
    .select({ recipientId: 1, vars: 1 })
    .lean();
  for (const r of rows) {
    const kids = (r.vars?.childNames ?? []).join(" ও ");
    await emit({
      recipientGuardianId: str(r.recipientId),
      kind: "SCHOOL_NOTICE",
      titleBn: "অভিভাবক সভার ফলাফল প্রকাশ হয়েছে",
      bodyBn: `${label} — ${kids ? `${kids}-এর ` : ""}সংখ্যা ও প্রধান শিক্ষকের মন্তব্য দেখুন।`,
      refs: { screenTarget: MEETING_RESULTS_TARGET },
      dedupeKey: `meeting-release:${str(meeting._id)}:${str(r.recipientId)}`,
    });
  }
}

export interface PublishMeetingResult {
  status: MeetingReleaseStatus;
  /** Snapshots computed now (children that had no printed/earlier snapshot). */
  computed: number;
  /** True when THIS call told the families; false on a repeat. */
  notified: boolean;
}

export async function publishMeetingToGuardians(ctx: AppContext, meetingId: string, now = new Date()): Promise<PublishMeetingResult> {
  const actorId = assertPrincipal(ctx);
  const meeting = await mustMeeting(meetingId);
  const computed = await fillMissingSnapshots(meeting, now);

  const alreadyLive = !!meeting.guardianPublishedAt && !meeting.guardianWithdrawnAt;
  if (!alreadyLive) {
    await ParentMeeting.updateOne(
      { _id: meeting._id },
      { $set: { guardianPublishedAt: now, guardianPublishedBy: new Types.ObjectId(actorId), guardianWithdrawnAt: null } },
    );
    await writeAudit({
      eventKind: "PARENT_MEETING_RELEASED",
      actorId,
      actorRole: ctx.auth!.role,
      targetId: meeting._id,
      targetKind: "ParentMeeting",
      meta: { instanceLabel: meeting.instanceLabel, computed, republished: !!meeting.guardianNotifiedAt },
    });
  }

  // ONCE per meeting: claim the stamp first so a double tap or a second Principal never re-notifies.
  let notified = false;
  const claimed = await ParentMeeting.findOneAndUpdate(
    { _id: meeting._id, guardianNotifiedAt: null },
    { $set: { guardianNotifiedAt: now } },
  );
  if (claimed) {
    try {
      await notifyFamilies(ctx, meeting, await meetingStudentIds(meeting._id), now);
      notified = true;
    } catch (e) {
      // Release the claim so the next publish can tell them; the release itself stands.
      await ParentMeeting.updateOne({ _id: meeting._id }, { $set: { guardianNotifiedAt: null } });
      console.warn("meeting release: families not notified:", (e as Error)?.message);
    }
  }
  return { status: await meetingReleaseStatus(meetingId), computed, notified };
}

export async function withdrawMeetingRelease(ctx: AppContext, meetingId: string, now = new Date()): Promise<MeetingReleaseStatus> {
  const actorId = assertPrincipal(ctx);
  const meeting = await mustMeeting(meetingId);
  if (!meeting.guardianPublishedAt || meeting.guardianWithdrawnAt) return meetingReleaseStatus(meetingId);
  await ParentMeeting.updateOne({ _id: meeting._id }, { $set: { guardianWithdrawnAt: now } });
  await writeAudit({
    eventKind: "PARENT_MEETING_RELEASE_WITHDRAWN",
    actorId,
    actorRole: ctx.auth!.role,
    targetId: meeting._id,
    targetKind: "ParentMeeting",
    meta: { instanceLabel: meeting.instanceLabel },
  });
  return meetingReleaseStatus(meetingId);
}
