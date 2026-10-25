/**
 * MeetingResponseService (D-#840–#843, docs/prd-meeting-rsvp.md) — a family's answer
 * to its parents'-meeting slot, and the Principal/VP's ruling on a time-change request.
 *
 *   myMeetingSlots        — GUARDIAN read: the guardian's slots in dispatched, not-yet-
 *                           past meetings, with the answer and (for option 2) every other
 *                           timed slot's TIME. Never another family's name (ADR-005).
 *   respondToMeetingSlot  — GUARDIAN write: one final answer per family slot. The first
 *                           answer wins through a write that only lands while the slot is
 *                           unanswered (D-#840).
 *   reviewMeetingChange   — approve (= swap the two families) or decline (D-#842).
 *   meetingResponseSummary — DERIVED counts for the meeting screen (D-#843).
 *
 * A change request is keyed by the wanted TIME, not the wanted slot document: slot rows
 * belong to families and move with them on a swap, so "the slot the family picked" may
 * hold someone else by the time it is approved. The time is what the family asked for.
 *
 * RBAC is enforced by the resolvers. The guardian check here is by Guardian id: a staff
 * id finds no Guardian row and is refused. Identity plane; NO corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { ParentMeeting, type IParentMeeting } from "../models/ParentMeeting";
import {
  ParentMeetingSlot,
  MEETING_SLOT_CHOICES,
  type IParentMeetingSlot,
  type MeetingSlotChoice,
} from "../models/ParentMeetingSlot";
import { Guardian } from "../../foundation/models/Guardian";
import { GuardianLink } from "../../foundation/models/GuardianLink";
import { Student } from "../../foundation/models/Student";
import { writeAudit } from "../../platform/services/AuditService";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { ParentMeetingError, slotResponseShape, type MeetingSlotResponseShape } from "./ParentMeetingService";
import { formatSlotTime } from "./MeetingDispatchService";

export const CANT_COME_REASON_MAX = 500;

// ===========================================================================
// Pure helpers (no DB/clock — unit-tested directly)
// ===========================================================================

/** The meeting's calendar day as "YYYY-MM-DD" (stored as a plain UTC-midnight date, §10). */
export function meetingDayKey(meetingDate: Date): string {
  return new Date(meetingDate).toISOString().slice(0, 10);
}

/** A meeting is still open for answers on its own day and before (Asia/Dhaka). */
export function isMeetingOpenForAnswers(meetingDate: Date, now: Date): boolean {
  return meetingDayKey(meetingDate) >= dhakaDayKey(now);
}

/** A slot a family can ask to move to: it has a clock time (On-Call has none). */
export function isTimedSlot(s: { slotTime?: number | null; onCall?: boolean }): boolean {
  return !s.onCall && s.slotTime != null;
}

// ===========================================================================
// Shapes
// ===========================================================================

export interface MeetingTimeChoice {
  slotId: string;
  slotTime: number;
}

export interface GuardianMeetingAsk {
  slotId: string;
  meetingId: string;
  instanceLabel: string;
  meetingDate: string;
  slotTime: number | null;
  onCall: boolean;
  /** The guardian's own linked children in this slot (never a sibling they are not linked to). */
  childNames: string[];
  classLabels: string[];
  response: MeetingSlotResponseShape | null;
  rescheduledAt: string | null;
  /** Every OTHER timed slot's time — times only, no family (option 2). */
  choices: MeetingTimeChoice[];
}

// ===========================================================================
// Guardian side
// ===========================================================================

async function activeGuardianChildIds(guardianId: string): Promise<Types.ObjectId[]> {
  if (!Types.ObjectId.isValid(guardianId)) return [];
  const guardian = (await Guardian.findById(guardianId).select("active").lean()) as unknown as {
    active?: boolean;
  } | null;
  if (!guardian || guardian.active === false) return [];
  const links = (await GuardianLink.find({ guardianId: new Types.ObjectId(guardianId), active: { $ne: false } })
    .select("studentId")
    .lean()) as unknown as Array<{ studentId: Types.ObjectId }>;
  return links.map((l) => l.studentId);
}

export async function myMeetingSlots(guardianId: string, now: Date = new Date()): Promise<GuardianMeetingAsk[]> {
  const childIds = await activeGuardianChildIds(guardianId);
  if (childIds.length === 0) return [];

  const meetings = (await ParentMeeting.find({
    status: "scheduled",
    meetingDate: { $gte: new Date(`${dhakaDayKey(now)}T00:00:00.000Z`) },
  }).lean()) as unknown as IParentMeeting[];
  if (meetings.length === 0) return [];
  const meetingIds = meetings.map((m) => m._id);

  const mine = (await ParentMeetingSlot.find({
    meetingId: { $in: meetingIds },
    studentIds: { $in: childIds },
  }).lean()) as unknown as IParentMeetingSlot[];
  if (mine.length === 0) return [];

  // Every timed slot of those meetings, for the option-2 time list (one query).
  const timed = (await ParentMeetingSlot.find({
    meetingId: { $in: [...new Set(mine.map((s) => s.meetingId.toString()))].map((id) => new Types.ObjectId(id)) },
    onCall: { $ne: true },
    slotTime: { $ne: null },
  })
    .select("meetingId slotTime")
    .sort({ slotTime: 1 })
    .lean()) as unknown as Array<{ _id: Types.ObjectId; meetingId: Types.ObjectId; slotTime: number }>;

  const linked = new Set(childIds.map((id) => id.toString()));
  const ownChildIds = [...new Set(mine.flatMap((s) => s.studentIds.map((id) => id.toString())))].filter((id) =>
    linked.has(id),
  );
  const students = (await Student.find({ _id: { $in: ownChildIds.map((id) => new Types.ObjectId(id)) } })
    .select("name")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; name: string }>;
  const nameById = new Map(students.map((s) => [s._id.toString(), s.name]));
  const meetingById = new Map(meetings.map((m) => [m._id.toString(), m]));

  return mine
    .map((s): GuardianMeetingAsk => {
      const meeting = meetingById.get(s.meetingId.toString())!;
      const idx = s.studentIds.map((id, i) => ({ id: id.toString(), i })).filter((x) => linked.has(x.id));
      return {
        slotId: s._id.toString(),
        meetingId: s.meetingId.toString(),
        instanceLabel: meeting.instanceLabel,
        meetingDate: new Date(meeting.meetingDate).toISOString(),
        slotTime: s.slotTime ?? null,
        onCall: !!s.onCall,
        childNames: idx.map((x) => nameById.get(x.id) ?? ""),
        classLabels: idx.map((x) => s.classLabels?.[x.i] ?? ""),
        response: slotResponseShape(s.response),
        rescheduledAt: s.rescheduledAt ? new Date(s.rescheduledAt).toISOString() : null,
        choices: timed
          .filter((t) => t.meetingId.toString() === s.meetingId.toString() && t._id.toString() !== s._id.toString())
          .map((t) => ({ slotId: t._id.toString(), slotTime: t.slotTime })),
      };
    })
    .sort((a, b) => a.meetingDate.localeCompare(b.meetingDate));
}

export interface RespondInput {
  slotId: string;
  guardianId: string;
  choice: string;
  preferredSlotId?: string | null;
  reason?: string | null;
  now?: Date;
}

export async function respondToMeetingSlot(input: RespondInput): Promise<GuardianMeetingAsk> {
  const now = input.now ?? new Date();
  if (!(MEETING_SLOT_CHOICES as string[]).includes(input.choice)) {
    throw new ParentMeetingError("উত্তরটি সঠিক নয়");
  }
  const choice = input.choice as MeetingSlotChoice;
  if (!Types.ObjectId.isValid(input.slotId)) throw new ParentMeetingError("সভার সময়টি পাওয়া যায়নি");
  const slot = (await ParentMeetingSlot.findById(input.slotId).lean()) as unknown as IParentMeetingSlot | null;
  if (!slot) throw new ParentMeetingError("সভার সময়টি পাওয়া যায়নি");

  const childIds = new Set((await activeGuardianChildIds(input.guardianId)).map((id) => id.toString()));
  if (!slot.studentIds.some((id) => childIds.has(id.toString()))) {
    throw new ParentMeetingError("এই শিক্ষার্থীর তথ্য দেখার অনুমতি নেই");
  }

  const meeting = (await ParentMeeting.findById(slot.meetingId).lean()) as unknown as IParentMeeting | null;
  if (!meeting || meeting.status !== "scheduled" || !isMeetingOpenForAnswers(meeting.meetingDate, now)) {
    throw new ParentMeetingError("এই সভার উত্তর দেওয়ার সময় শেষ");
  }
  if (slot.response) throw new ParentMeetingError("ইতিমধ্যে উত্তর দেওয়া হয়েছে");

  const response: Record<string, unknown> = {
    choice,
    respondedAt: now,
    respondedByGuardianId: new Types.ObjectId(input.guardianId),
  };
  if (choice === "CHANGE_REQUESTED") {
    if (!input.preferredSlotId || !Types.ObjectId.isValid(input.preferredSlotId)) {
      throw new ParentMeetingError("পছন্দের সময় বেছে নিন");
    }
    const wanted = (await ParentMeetingSlot.findById(input.preferredSlotId)
      .select("meetingId slotTime onCall")
      .lean()) as unknown as IParentMeetingSlot | null;
    if (
      !wanted ||
      wanted.meetingId.toString() !== slot.meetingId.toString() ||
      wanted._id.toString() === slot._id.toString() ||
      !isTimedSlot(wanted)
    ) {
      throw new ParentMeetingError("পছন্দের সময়টি সঠিক নয়");
    }
    response.preferredSlotId = wanted._id;
    response.preferredSlotTime = wanted.slotTime;
  }
  if (choice === "CANT_COME") {
    const reason = (input.reason ?? "").trim();
    if (reason.length > CANT_COME_REASON_MAX) {
      throw new ParentMeetingError("কারণ ৫০০ অক্ষরের মধ্যে লিখুন"); // = CANT_COME_REASON_MAX
    }
    if (reason) response.reason = reason;
  }

  // First answer wins: the write lands only while the slot is still unanswered.
  const updated = await ParentMeetingSlot.findOneAndUpdate(
    { _id: slot._id, response: { $exists: false } },
    { $set: { response } },
    { new: true },
  ).lean();
  if (!updated) throw new ParentMeetingError("ইতিমধ্যে উত্তর দেওয়া হয়েছে");

  await writeAudit({
    eventKind: "MEETING_SLOT_RESPONDED",
    actorId: input.guardianId,
    actorRole: "GUARDIAN",
    targetId: slot._id,
    targetKind: "ParentMeetingSlot",
    meta: {
      meetingId: slot.meetingId.toString(),
      choice,
      ...(response.preferredSlotTime != null ? { preferredSlotTime: response.preferredSlotTime } : {}),
    },
  });

  const asks = await myMeetingSlots(input.guardianId, now);
  const ask = asks.find((a) => a.slotId === slot._id.toString());
  if (!ask) throw new ParentMeetingError("সভার সময়টি পাওয়া যায়নি");
  return ask;
}

/**
 * The family has seen the outcome of its change request (D-#844) — stamps
 * `review.seenAt` so the outcome pop-up stops. Idempotent: a second call (the other
 * parent's phone) leaves the first stamp and returns the same ask.
 */
export async function acknowledgeMeetingChange(
  slotId: string,
  guardianId: string,
  now: Date = new Date(),
): Promise<GuardianMeetingAsk> {
  if (!Types.ObjectId.isValid(slotId)) throw new ParentMeetingError("সভার সময়টি পাওয়া যায়নি");
  const slot = (await ParentMeetingSlot.findById(slotId).lean()) as unknown as IParentMeetingSlot | null;
  if (!slot) throw new ParentMeetingError("সভার সময়টি পাওয়া যায়নি");
  const childIds = new Set((await activeGuardianChildIds(guardianId)).map((id) => id.toString()));
  if (!slot.studentIds.some((id) => childIds.has(id.toString()))) {
    throw new ParentMeetingError("এই শিক্ষার্থীর তথ্য দেখার অনুমতি নেই");
  }
  if (!slot.response?.review) throw new ParentMeetingError("এই অনুরোধের এখনো কোনো সিদ্ধান্ত হয়নি");

  const stamped = await ParentMeetingSlot.updateOne(
    { _id: slot._id, "response.review": { $exists: true }, "response.review.seenAt": { $exists: false } },
    { $set: { "response.review.seenAt": now } },
  );
  if (stamped.modifiedCount === 1) {
    await writeAudit({
      eventKind: "MEETING_CHANGE_OUTCOME_SEEN",
      actorId: guardianId,
      actorRole: "GUARDIAN",
      targetId: slot._id,
      targetKind: "ParentMeetingSlot",
      meta: { meetingId: slot.meetingId.toString(), outcome: slot.response.review.outcome },
    });
  }

  const ask = (await myMeetingSlots(guardianId, now)).find((a) => a.slotId === slot._id.toString());
  if (!ask) throw new ParentMeetingError("সভার সময়টি পাওয়া যায়নি");
  return ask;
}

// ===========================================================================
// Principal / VP side
// ===========================================================================

export interface ReviewMeetingChangeResult {
  /** The requesting family's slot after the ruling. */
  slotId: string;
  outcome: "APPROVED" | "DECLINED";
  /** The family moved by an approved swap (null on decline). */
  movedSlotId: string | null;
  /** True when the moved family had asked for this family's time (both approved). */
  mutual: boolean;
}

export async function reviewMeetingChange(
  slotId: string,
  approve: boolean,
  note: string | undefined | null,
  actorId: string,
  now: Date = new Date(),
): Promise<ReviewMeetingChangeResult> {
  if (!Types.ObjectId.isValid(slotId)) throw new ParentMeetingError("Slot not found");
  const slot = (await ParentMeetingSlot.findById(slotId).lean()) as unknown as IParentMeetingSlot | null;
  if (!slot) throw new ParentMeetingError("Slot not found");
  const r = slot.response;
  if (!r || r.choice !== "CHANGE_REQUESTED" || r.review) {
    throw new ParentMeetingError("এই পরিবারের কোনো অপেক্ষমাণ সময় পরিবর্তনের অনুরোধ নেই");
  }
  const meeting = (await ParentMeeting.findById(slot.meetingId).select("status").lean()) as unknown as {
    status: string;
  } | null;
  if (!meeting || meeting.status !== "scheduled") {
    throw new ParentMeetingError("শুধু পাঠানো (চলমান) সভার অনুরোধ নিষ্পত্তি করা যায়");
  }
  const trimmed = (note ?? "").trim();
  const reviewer = new Types.ObjectId(actorId);

  if (!approve) {
    const done = await ParentMeetingSlot.updateOne(
      { _id: slot._id, "response.choice": "CHANGE_REQUESTED", "response.review": { $exists: false } },
      {
        $set: {
          "response.review": {
            outcome: "DECLINED",
            ...(trimmed ? { note: trimmed } : {}),
            fromSlotTime: slot.slotTime ?? null,
            reviewedAt: now,
            reviewedBy: reviewer,
          },
        },
      },
    );
    if (done.modifiedCount !== 1) throw new ParentMeetingError("অনুরোধটি ইতিমধ্যে নিষ্পত্তি হয়েছে");
    await writeAudit({
      eventKind: "MEETING_CHANGE_DECLINED",
      actorId,
      targetId: slot._id,
      targetKind: "ParentMeetingSlot",
      meta: { meetingId: slot.meetingId.toString(), slotTime: slot.slotTime ?? null, wanted: r.preferredSlotTime ?? null },
    });
    return { slotId: slot._id.toString(), outcome: "DECLINED", movedSlotId: null, mutual: false };
  }

  // The family wanted a TIME; find whoever holds it now (see the header).
  const wantedTime = r.preferredSlotTime;
  if (wantedTime == null) throw new ParentMeetingError("পছন্দের সময়টি সঠিক নয়");
  const target = (await ParentMeetingSlot.findOne({
    meetingId: slot.meetingId,
    slotTime: wantedTime,
    onCall: { $ne: true },
  }).lean()) as unknown as IParentMeetingSlot | null;
  if (!target) throw new ParentMeetingError(`${formatSlotTime(wantedTime)} সময়টি এই সভায় আর নেই`);
  if (target._id.toString() === slot._id.toString()) {
    throw new ParentMeetingError("পরিবারটি ইতিমধ্যে ওই সময়েই আছে");
  }

  const tr = target.response;
  const targetPending = !!tr && tr.choice === "CHANGE_REQUESTED" && !tr.review;
  const mutual = targetPending && tr!.preferredSlotTime === (slot.slotTime ?? null) && isTimedSlot(slot);
  if (targetPending && !mutual) {
    throw new ParentMeetingError(
      `${formatSlotTime(wantedTime)} সময়ের পরিবারেরও একটি পরিবর্তনের অনুরোধ অপেক্ষমাণ — আগে সেটি নিষ্পত্তি করুন`,
    );
  }

  const mine = { order: slot.order, slotTime: slot.slotTime ?? null, onCall: !!slot.onCall };
  const theirs = { order: target.order, slotTime: target.slotTime ?? null, onCall: !!target.onCall };

  // The moved family: a mutual request is approved too; a CANT_COME answer still holds;
  // any other answer was about the old time, so it is cleared and the family is asked again.
  const targetSet: Record<string, unknown> = { ...mine };
  const targetUnset: Record<string, ""> = {};
  if (mutual) {
    targetSet["response.review"] = { outcome: "APPROVED", fromSlotTime: theirs.slotTime, reviewedAt: now, reviewedBy: reviewer };
  } else {
    targetSet.rescheduledAt = now;
    if (tr && tr.choice !== "CANT_COME") targetUnset.response = "";
  }
  const movedTarget = await ParentMeetingSlot.updateOne(
    { _id: target._id, order: theirs.order, slotTime: theirs.slotTime },
    { $set: targetSet, ...(Object.keys(targetUnset).length ? { $unset: targetUnset } : {}) },
  );
  if (movedTarget.modifiedCount !== 1) throw new ParentMeetingError("সময়সূচি বদলে গেছে — আবার চেষ্টা করুন");

  const movedMine = await ParentMeetingSlot.updateOne(
    { _id: slot._id, order: mine.order, "response.review": { $exists: false } },
    {
      $set: {
        ...theirs,
        "response.review": {
          outcome: "APPROVED",
          ...(trimmed ? { note: trimmed } : {}),
          fromSlotTime: mine.slotTime,
          reviewedAt: now,
          reviewedBy: reviewer,
        },
      },
    },
  );
  if (movedMine.modifiedCount !== 1) {
    // Someone ruled on it first — put the other family back exactly as it was.
    await ParentMeetingSlot.replaceOne({ _id: target._id }, target);
    throw new ParentMeetingError("অনুরোধটি ইতিমধ্যে নিষ্পত্তি হয়েছে");
  }

  await writeAudit({
    eventKind: "MEETING_CHANGE_APPROVED",
    actorId,
    targetId: slot._id,
    targetKind: "ParentMeetingSlot",
    meta: {
      meetingId: slot.meetingId.toString(),
      from: mine.slotTime,
      to: theirs.slotTime,
      movedSlotId: target._id.toString(),
      movedResponseCleared: !mutual && !!tr && tr.choice !== "CANT_COME",
      mutual,
    },
  });

  return { slotId: slot._id.toString(), outcome: "APPROVED", movedSlotId: target._id.toString(), mutual };
}

// ===========================================================================
// meetingResponseSummary (DERIVED — D-#843)
// ===========================================================================

export interface MeetingResponseSummary {
  meetingId: string;
  total: number;
  confirmed: number;
  changePending: number;
  changeApproved: number;
  changeDeclined: number;
  cantCome: number;
  noAnswer: number;
}

export async function meetingResponseSummary(meetingId: string): Promise<MeetingResponseSummary> {
  if (!Types.ObjectId.isValid(meetingId)) throw new ParentMeetingError("Invalid meeting id");
  const slots = (await ParentMeetingSlot.find({ meetingId: new Types.ObjectId(meetingId) })
    .select("response")
    .lean()) as unknown as Array<Pick<IParentMeetingSlot, "response">>;
  const out: MeetingResponseSummary = {
    meetingId,
    total: slots.length,
    confirmed: 0,
    changePending: 0,
    changeApproved: 0,
    changeDeclined: 0,
    cantCome: 0,
    noAnswer: 0,
  };
  for (const { response: r } of slots) {
    if (!r) out.noAnswer += 1;
    else if (r.choice === "CONFIRMED") out.confirmed += 1;
    else if (r.choice === "CANT_COME") out.cantCome += 1;
    else if (!r.review) out.changePending += 1;
    else if (r.review.outcome === "APPROVED") out.changeApproved += 1;
    else out.changeDeclined += 1;
  }
  return out;
}
