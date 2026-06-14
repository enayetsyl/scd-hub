/**
 * MeetingDispatchService (CM-4, prd-comments-meetings §4.1/§6, J-CM4/J-CM5, D-#176) —
 * the parents'-meeting timing dispatch + present/absent capture over the CM-3
 * `ParentMeeting` / `ParentMeetingSlot` arrangement. NO new model (CM-3 owns them).
 *
 *   dispatchMeetingSchedule — flips the meeting `draft → scheduled` and, per slot,
 *                             builds the Bangla timing message ONCE (the slot time, or
 *                             "ডাকা হলে আসবেন" (On Call)), stamps `dispatchedAt`, builds
 *                             a `wa.me` link for every family with a phone (the
 *                             `familyKey` IS the digits-only number from CM-3;
 *                             phone-less → `unreachableCount`), and emits
 *                             `MEETING_SCHEDULE` kind-gated (→ inbox + push for
 *                             login-enabled guardians ONCE the kind is activated; today
 *                             a no-op → wa.me only, the §4.1/D-#94 path).
 *   setSlotAttendance        — captures present/absent (+ optional remark) per family
 *                             slot at the meeting.
 *   meetingAttendanceSummary — DERIVED present/absent/total/pending aggregates (read-
 *                             side; replaces the Office-Copy hand-typed counts).
 *
 * VOCAB-FREE (CO-1 holds the vocab lock): `MEETING_SCHEDULE` is NOT registered, so the
 * emitter no-ops and the message is **INLINE Bangla** here (not an MT key — a
 * `meeting_schedule.*` key would touch shared/vocab.ts). Activation follow-up: when the
 * lock frees, add `MEETING_SCHEDULE` to `NOTIFICATION_KINDS` (+BN/EN, verifier §C.5) and
 * migrate this inline message to a `meeting_schedule.*` MT key (D-#131) — no logic change.
 *
 * Role RBAC (`roster:manage`, the D-#94 admin gate) is enforced by the RESOLVER.
 * Identity-plane (slots name studentIds + the family phone); NO corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { ParentMeeting, type IParentMeeting } from "../models/ParentMeeting";
import { ParentMeetingSlot, type IParentMeetingSlot } from "../models/ParentMeetingSlot";
import { emitMeetingSchedule } from "../../notifications/services/emitters";
import { writeAudit } from "../../platform/services/AuditService";
import { ParentMeetingError, type ParentMeetingSlotShape } from "./ParentMeetingService";

// ===========================================================================
// Pure formatters (no DB/clock — unit-tested directly)
// ===========================================================================

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Minutes-from-midnight → "HH:MM" (24h). Null/invalid → "—". */
export function formatSlotTime(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min) || min < 0) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

/** A meeting date → "DD/MM/YYYY" from its UTC parts (deterministic; the stored date
 *  is a plain calendar day, §10). */
export function formatMeetingDate(date: Date): string {
  const d = new Date(date);
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/**
 * The per-slot timing message — **INLINE Bangla (CM-4, vocab-locked)**; migrates to a
 * `meeting_schedule.*` MT key once the vocab lock frees (D-#131). On-Call slots read
 * "ডাকা হলে আসবেন (On Call)" with no fixed time (J-CM4); timed slots carry HH:MM.
 */
export function meetingSlotMessageBn(opts: {
  instanceLabel: string;
  meetingDate: Date;
  slotTime: number | null;
  onCall: boolean;
}): string {
  const dateStr = formatMeetingDate(opts.meetingDate);
  const timePart = opts.onCall ? "ডাকা হলে আসবেন (On Call)" : formatSlotTime(opts.slotTime);
  return (
    `আসসালামু আলাইকুম। অভিভাবক সভা (${opts.instanceLabel}) — তারিখ: ${dateStr}। ` +
    `আপনার নির্ধারিত সময়: ${timePart}। অনুগ্রহ করে সময়মতো উপস্থিত থাকবেন।`
  );
}

/** The meeting-notice title — INLINE Bangla (CM-4); migrates to the MT key on activation. */
export const MEETING_NOTICE_TITLE_BN = "অভিভাবক সভার সময়সূচি";

/**
 * wa.me click-to-send link from a slot's `familyKey` (ADR-003 — always a MANUAL send).
 * The CM-3 `familyKey` IS the digits-only family phone for reachable families and
 * `nophone:<id>` for phone-less ones, so this needs no Student re-query; null ⇒ the
 * family is counted in `unreachableCount`.
 */
export function meetingSlotWaLink(familyKey: string, message: string): string | null {
  if (!familyKey || familyKey.startsWith("nophone:")) return null;
  const digits = familyKey.replace(/\D/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function toSlotShape(d: IParentMeetingSlot): ParentMeetingSlotShape {
  return {
    id: d._id.toString(),
    meetingId: d.meetingId.toString(),
    familyKey: d.familyKey,
    studentIds: (d.studentIds ?? []).map((x) => x.toString()),
    classLabels: d.classLabels ?? [],
    order: d.order,
    slotTime: d.slotTime ?? null,
    onCall: !!d.onCall,
    dispatchedAt: d.dispatchedAt ? new Date(d.dispatchedAt).toISOString() : null,
    attended: d.attended ?? null,
    attendanceRemark: d.attendanceRemark ?? null,
    createdAt: new Date(d.createdAt).toISOString(),
    updatedAt: new Date(d.updatedAt).toISOString(),
  };
}

async function loadMeetingOrThrow(meetingId: string): Promise<IParentMeeting> {
  if (!Types.ObjectId.isValid(meetingId)) throw new ParentMeetingError("Invalid meeting id");
  const meeting = (await ParentMeeting.findById(meetingId)) as IParentMeeting | null;
  if (!meeting) throw new ParentMeetingError("Meeting not found");
  return meeting;
}

// ===========================================================================
// dispatchMeetingSchedule (per-meeting fan-out — J-CM5)
// ===========================================================================

export interface MeetingDispatchOutcome {
  slotId: string;
  familyKey: string;
  slotTime: number | null;
  onCall: boolean;
  /** The Bangla timing message (the wa.me + inbox body). */
  messageBn: string;
  /** wa.me link for the family phone (null when phone-less → unreachable). */
  waLink: string | null;
  unreachableByWa: boolean;
  /** Login-enabled guardian ids that got an inbox row (empty until the kind is activated). */
  notifiedGuardianIds: string[];
  dispatchedAt: string;
}

export interface MeetingDispatchResult {
  meetingId: string;
  status: string;
  slotCount: number;
  /** Families with a wa.me link (a phone). */
  reachableCount: number;
  /** Phone-less families (no wa.me; D-#174 — counted, never dropped). */
  unreachableCount: number;
  /** Slots that wrote ≥1 inbox row (0 today — the kind-gated no-op; non-zero post-activation). */
  notifiedCount: number;
  outcomes: MeetingDispatchOutcome[];
}

/**
 * Dispatch every slot's timing notice and flip the meeting to `scheduled` (J-CM5).
 * Idempotent on re-run: re-dispatch re-stamps `dispatchedAt` + re-builds wa.me links,
 * and the per-(slot,guardian) dedupeKey makes the inbox emit a no-op for the same slot.
 * A closed meeting cannot be dispatched.
 *
 * N+1 guard: the message is rendered ONCE per slot (here) and the pre-rendered text is
 * passed to `emitMeetingSchedule` — never re-rendered inside the per-guardian loop.
 */
export async function dispatchMeetingSchedule(meetingId: string, actorId: string): Promise<MeetingDispatchResult> {
  const meeting = await loadMeetingOrThrow(meetingId);
  if (meeting.status === "closed") {
    throw new ParentMeetingError("A closed meeting cannot be dispatched");
  }

  const slots = (await ParentMeetingSlot.find({ meetingId: meeting._id })
    .sort({ order: 1 })
    .exec()) as IParentMeetingSlot[];

  const now = new Date();
  const outcomes: MeetingDispatchOutcome[] = [];
  let reachableCount = 0;
  let notifiedCount = 0;

  for (const slot of slots) {
    // N+1 guard — render the slot message ONCE (not per guardian).
    const messageBn = meetingSlotMessageBn({
      instanceLabel: meeting.instanceLabel,
      meetingDate: meeting.meetingDate,
      slotTime: slot.slotTime ?? null,
      onCall: !!slot.onCall,
    });
    const waLink = meetingSlotWaLink(slot.familyKey, messageBn);
    if (waLink) reachableCount += 1;

    slot.dispatchedAt = now;
    await slot.save();

    const notifiedGuardianIds = await emitMeetingSchedule({
      meetingId: meeting._id,
      slotId: slot._id,
      studentIds: slot.studentIds ?? [],
      titleBn: MEETING_NOTICE_TITLE_BN,
      messageBn,
    });
    if (notifiedGuardianIds.length > 0) notifiedCount += 1;

    outcomes.push({
      slotId: slot._id.toString(),
      familyKey: slot.familyKey,
      slotTime: slot.slotTime ?? null,
      onCall: !!slot.onCall,
      messageBn,
      waLink,
      unreachableByWa: !waLink,
      notifiedGuardianIds,
      dispatchedAt: now.toISOString(),
    });
  }

  // Flip draft → scheduled (idempotent — a re-dispatch of a scheduled meeting is fine).
  meeting.status = "scheduled";
  await meeting.save();

  const unreachableCount = slots.length - reachableCount;

  await writeAudit({
    eventKind: "PARENT_MEETING_SCHEDULED",
    actorId,
    targetId: meeting._id,
    targetKind: "ParentMeeting",
    meta: { slotCount: slots.length, reachableCount, unreachableCount, notifiedCount },
  });

  return {
    meetingId: meeting._id.toString(),
    status: meeting.status,
    slotCount: slots.length,
    reachableCount,
    unreachableCount,
    notifiedCount,
    outcomes,
  };
}

// ===========================================================================
// setSlotAttendance (present / absent per family slot)
// ===========================================================================

export async function setSlotAttendance(
  slotId: string,
  attended: boolean,
  remark: string | undefined,
  actorId: string,
): Promise<ParentMeetingSlotShape> {
  if (!Types.ObjectId.isValid(slotId)) throw new ParentMeetingError("Invalid slot id");
  const slot = (await ParentMeetingSlot.findById(slotId)) as IParentMeetingSlot | null;
  if (!slot) throw new ParentMeetingError("Slot not found");

  const meeting = await loadMeetingOrThrow(slot.meetingId.toString());
  // Attendance is captured at the meeting — only after it has been dispatched.
  if (meeting.status === "draft") {
    throw new ParentMeetingError("Dispatch the meeting before capturing attendance");
  }

  slot.attended = attended;
  const trimmed = (remark ?? "").trim();
  slot.attendanceRemark = trimmed ? trimmed : undefined;
  await slot.save();

  await writeAudit({
    eventKind: "MEETING_SLOT_ATTENDANCE_SET",
    actorId,
    targetId: slot._id,
    targetKind: "ParentMeetingSlot",
    meta: { meetingId: slot.meetingId.toString(), attended },
  });

  return toSlotShape(slot);
}

// ===========================================================================
// meetingAttendanceSummary (DERIVED — replaces the Office-Copy counts)
// ===========================================================================

export interface MeetingAttendanceSummary {
  meetingId: string;
  /** Total family slots. */
  total: number;
  present: number;
  absent: number;
  /** Attendance not yet captured. */
  pending: number;
  /** Slots flagged On-Call (a subset of total). */
  onCall: number;
  /** Slots a timing notice has been dispatched for. */
  dispatched: number;
  /** Families reachable by wa.me (a phone). */
  reachable: number;
  /** Phone-less families (D-#174). */
  unreachable: number;
}

export async function meetingAttendanceSummary(meetingId: string): Promise<MeetingAttendanceSummary> {
  if (!Types.ObjectId.isValid(meetingId)) throw new ParentMeetingError("Invalid meeting id");
  const slots = (await ParentMeetingSlot.find({ meetingId: new Types.ObjectId(meetingId) })
    .select("attended onCall dispatchedAt familyKey")
    .lean()) as unknown as Array<{
    attended?: boolean;
    onCall?: boolean;
    dispatchedAt?: Date;
    familyKey: string;
  }>;

  let present = 0;
  let absent = 0;
  let pending = 0;
  let onCall = 0;
  let dispatched = 0;
  let unreachable = 0;
  for (const s of slots) {
    if (s.attended === true) present += 1;
    else if (s.attended === false) absent += 1;
    else pending += 1;
    if (s.onCall) onCall += 1;
    if (s.dispatchedAt) dispatched += 1;
    if (!s.familyKey || s.familyKey.startsWith("nophone:")) unreachable += 1;
  }

  return {
    meetingId,
    total: slots.length,
    present,
    absent,
    pending,
    onCall,
    dispatched,
    reachable: slots.length - unreachable,
    unreachable,
  };
}
