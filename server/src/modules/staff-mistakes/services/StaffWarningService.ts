/**
 * The warning ladder (D-#940–#942, docs/prd-staff-mistakes.md §9).
 *
 *   evaluateLadder     after a mistake is counted: has the person reached a rung?
 *   myOpenWarning      the person's unseen warning (the pop-up)
 *   acknowledgeWarning "বুঝেছি", or "অন্য সময় চাই" for a booked meeting
 *   scheduleMeeting    Office / the Principal book the face-to-face talk
 *   recordMeeting      …and write down what was said and agreed
 *   staffMistakeSummary  the per-person table (screen 7)
 *
 * A rung is reached when the WEIGHTED count of COUNTED mistakes decided inside its window
 * meets it (tier weights from the settings). Each rung fires at most once per window per
 * person. Nothing here opens a conduct step: CONDUCT only tells the Principal.
 */
import { Types } from "mongoose";
import type { StaffMistakeKind, StaffWarningStep } from "@scd/shared";
import { personName } from "../../../lib/personName";
import { StaffMistake } from "../models/StaffMistake";
import { StaffWarning, type IStaffWarning } from "../models/StaffWarning";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
import { holderIdsOf } from "../../access-control/services/holders";
import { ownedByPrincipal, warningAudience } from "./principalPrivacy";
import {
  emitStaffWarningMeeting,
  emitStaffWarningReached,
  emitStaffWarningStep,
} from "../../notifications/services/emitters";
import { getStaffMistakeSettings } from "./StaffMistakeSettingsService";

const DAY_MS = 86_400_000;
const STEP_ORDER: Record<StaffWarningStep, number> = { WARNING: 0, MEETING: 1, CONDUCT: 2 };
const TEXT_MAX = 2000;

/** A refusal the reviewer or person can act on. */
export class StaffWarningError extends Error {}

const oid = (id: string): Types.ObjectId => {
  if (!Types.ObjectId.isValid(id)) throw new StaffWarningError("ভুল আইডি।");
  return new Types.ObjectId(id);
};

/** Reached rungs become warnings; returns the new ones (none = nothing changed). */
export async function evaluateLadder(staffUserId: string, now: Date = new Date()): Promise<IStaffWarning[]> {
  const settings = await getStaffMistakeSettings();
  const person = new Types.ObjectId(staffUserId);
  const created: IStaffWarning[] = [];
  for (const rung of settings.rungs) {
    const since = new Date(now.getTime() - rung.windowDays * DAY_MS);
    const rows = await StaffMistake.find({ staffUserId: person, status: "COUNTED", decidedAt: { $gte: since } })
      .select("_id tier")
      .lean();
    const weighted = rows.reduce((sum, r) => sum + (settings.tierWeights[r.tier as 1 | 2 | 3] ?? 1), 0);
    if (weighted < rung.count) continue;
    const already = await StaffWarning.exists({ staffUserId: person, step: rung.step, createdAt: { $gte: since } });
    if (already) continue;
    created.push(
      await StaffWarning.create({
        staffUserId: person,
        step: rung.step,
        threshold: rung.count,
        windowDays: rung.windowDays,
        weightedCount: weighted,
        mistakeIds: rows.map((r) => r._id),
      }),
    );
  }
  if (created.length === 0) return created;

  const top = [...created].sort((a, b) => STEP_ORDER[b.step] - STEP_ORDER[a.step])[0]!;
  const user = await User.findById(person).select("name nameBn").lean();
  const name = personName(user, "একজন কর্মী");
  // The person hears once (the highest step); the pop-up shows on their next app open.
  await emitStaffWarningReached({ warningId: top._id, recipientUserId: person, step: top.step, count: top.weightedCount, windowDays: top.windowDays });
  for (const w of created) {
    await writeAudit({
      eventKind: "STAFF_WARNING_REACHED",
      targetId: w._id.toString(),
      targetKind: "StaffWarning",
      meta: { staffUserId, step: w.step, weightedCount: w.weightedCount, windowDays: w.windowDays },
    });
    const recipients = await warningAudience(await holderIdsOf(w.step === "CONDUCT" ? "conduct:create" : "staff_mistakes:meetings"), staffUserId);
    await emitStaffWarningStep({ warningId: w._id, recipientUserIds: recipients, staffName: name, step: w.step, count: w.weightedCount, windowDays: w.windowDays, variant: "REACHED" });
  }
  return created;
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface WarningMistakeLine {
  dateKey: string;
  kind: StaffMistakeKind;
  tier: number;
}

export interface StaffWarningShape {
  id: string;
  staffUserId: string;
  staffName: string;
  step: StaffWarningStep;
  threshold: number;
  windowDays: number;
  weightedCount: number;
  mistakes: WarningMistakeLine[];
  acknowledgedAt: Date | null;
  otherTimeAskedAt: Date | null;
  meetingAt: Date | null;
  meetingPlace: string | null;
  meetingSetByName: string | null;
  meetingHeldAt: Date | null;
  meetingRecordedByName: string | null;
  meetingWho: string | null;
  meetingDiscussion: string | null;
  meetingActions: string | null;
  followUpDateKey: string | null;
  createdAt: Date;
}

async function shape(rows: IStaffWarning[]): Promise<StaffWarningShape[]> {
  if (rows.length === 0) return [];
  const mistakeIds = rows.flatMap((w) => w.mistakeIds);
  const mistakes = await StaffMistake.find({ _id: { $in: mistakeIds } }).select("dateKey kind tier").lean();
  const byId = new Map(mistakes.map((m) => [String(m._id), m]));
  const userIds = new Set<string>();
  for (const w of rows) {
    userIds.add(String(w.staffUserId));
    if (w.meetingSetBy) userIds.add(String(w.meetingSetBy));
    if (w.meetingRecordedBy) userIds.add(String(w.meetingRecordedBy));
  }
  const users = await User.find({ _id: { $in: [...userIds] } }).select("name nameBn").lean();
  const name = new Map(users.map((u) => [String(u._id), personName(u)]));
  return rows.map((w) => ({
    id: String(w._id),
    staffUserId: String(w.staffUserId),
    staffName: name.get(String(w.staffUserId)) ?? "",
    step: w.step,
    threshold: w.threshold,
    windowDays: w.windowDays,
    weightedCount: w.weightedCount,
    mistakes: w.mistakeIds
      .map((id) => byId.get(String(id)))
      .filter((m): m is NonNullable<typeof m> => !!m)
      .map((m) => ({ dateKey: m.dateKey, kind: m.kind, tier: m.tier }))
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey)),
    acknowledgedAt: w.acknowledgedAt ?? null,
    otherTimeAskedAt: w.otherTimeAskedAt ?? null,
    meetingAt: w.meetingAt ?? null,
    meetingPlace: w.meetingPlace ?? null,
    meetingSetByName: w.meetingSetBy ? (name.get(String(w.meetingSetBy)) ?? null) : null,
    meetingHeldAt: w.meetingHeldAt ?? null,
    meetingRecordedByName: w.meetingRecordedBy ? (name.get(String(w.meetingRecordedBy)) ?? null) : null,
    meetingWho: w.meetingWho ?? null,
    meetingDiscussion: w.meetingDiscussion ?? null,
    meetingActions: w.meetingActions ?? null,
    followUpDateKey: w.followUpDateKey ?? null,
    createdAt: w.createdAt,
  }));
}

/** The person's newest unseen warning (the pop-up), or null. */
export async function myOpenWarning(userId: string): Promise<StaffWarningShape | null> {
  const w = await StaffWarning.findOne({ staffUserId: oid(userId), acknowledgedAt: null }).sort({ createdAt: -1 });
  return w ? ((await shape([w]))[0] ?? null) : null;
}

/** "বুঝেছি" closes every open warning of the person; `otherTime` asks to move the meeting. */
export async function acknowledgeWarning(input: { warningId: string; userId: string; otherTime?: boolean; now?: Date }): Promise<boolean> {
  const now = input.now ?? new Date();
  const w = await StaffWarning.findById(oid(input.warningId));
  if (!w || String(w.staffUserId) !== input.userId) throw new StaffWarningError("এই সতর্কবার্তা আপনার নয়।");
  await StaffWarning.updateMany({ staffUserId: w.staffUserId, acknowledgedAt: null }, { $set: { acknowledgedAt: now } });
  if (input.otherTime && w.meetingAt) {
    w.otherTimeAskedAt = now;
    await StaffWarning.updateOne({ _id: w._id }, { $set: { otherTimeAskedAt: now } });
    const user = await User.findById(w.staffUserId).select("name nameBn").lean();
    const recipients = await warningAudience(await holderIdsOf("staff_mistakes:meetings"), input.userId);
    await emitStaffWarningStep({
      warningId: w._id, recipientUserIds: recipients, staffName: personName(user, "একজন কর্মী"),
      step: w.step, count: w.weightedCount, windowDays: w.windowDays, variant: "OTHER_TIME",
    });
  }
  return true;
}

export async function scheduleMeeting(input: { warningId: string; actorId: string; mayHandlePrincipal?: boolean; at: string; place: string; now?: Date }): Promise<StaffWarningShape> {
  const w = await StaffWarning.findById(oid(input.warningId));
  if (!w) throw new StaffWarningError("সতর্কবার্তাটি পাওয়া যায়নি।");
  await assertMayHandle(String(w.staffUserId), !!input.mayHandlePrincipal);
  if (String(w.staffUserId) === input.actorId) throw new StaffWarningError("নিজের আলোচনা নিজে ঠিক করা যায় না।");
  const at = new Date(input.at);
  if (Number.isNaN(at.getTime())) throw new StaffWarningError("ভুল সময়।");
  const place = input.place.trim();
  if (!place || place.length > 200) throw new StaffWarningError("জায়গা লিখুন (২০০ অক্ষরের মধ্যে)।");
  w.meetingAt = at;
  w.meetingPlace = place;
  w.meetingSetBy = new Types.ObjectId(input.actorId);
  w.otherTimeAskedAt = null;
  w.acknowledgedAt = null; // the pop-up comes back with the time
  await w.save();
  await writeAudit({ eventKind: "STAFF_WARNING_MEETING_SET", actorId: input.actorId, targetId: w._id.toString(), targetKind: "StaffWarning", meta: { at: at.toISOString(), place } });
  await emitStaffWarningMeeting({ warningId: w._id, recipientUserId: w.staffUserId, at, place, stamp: Date.now() });
  return (await shape([w]))[0]!;
}

export async function recordMeeting(input: {
  warningId: string;
  actorId: string;
  mayHandlePrincipal?: boolean;
  who: string;
  discussion: string;
  actions: string;
  followUpDateKey?: string | null;
  sendSummary: boolean;
  now?: Date;
}): Promise<StaffWarningShape> {
  const now = input.now ?? new Date();
  const w = await StaffWarning.findById(oid(input.warningId));
  if (!w) throw new StaffWarningError("সতর্কবার্তাটি পাওয়া যায়নি।");
  await assertMayHandle(String(w.staffUserId), !!input.mayHandlePrincipal);
  if (String(w.staffUserId) === input.actorId) throw new StaffWarningError("নিজের আলোচনা নিজে লেখা যায় না।");
  const who = input.who.trim();
  const discussion = input.discussion.trim();
  const actions = input.actions.trim();
  if (!discussion) throw new StaffWarningError("কী আলোচনা হলো লিখুন।");
  if ([who, discussion, actions].some((t) => t.length > TEXT_MAX)) throw new StaffWarningError(`প্রতিটি ঘর ${TEXT_MAX} অক্ষরের মধ্যে লিখুন।`);
  const follow = input.followUpDateKey?.trim() || null;
  if (follow && !/^\d{4}-\d{2}-\d{2}$/.test(follow)) throw new StaffWarningError("আবার দেখার তারিখ ঠিক নেই।");
  w.meetingHeldAt = now;
  w.meetingRecordedBy = new Types.ObjectId(input.actorId);
  w.meetingWho = who || null;
  w.meetingDiscussion = discussion;
  w.meetingActions = actions || null;
  w.followUpDateKey = follow;
  await w.save();
  await writeAudit({ eventKind: "STAFF_WARNING_MEETING_RECORDED", actorId: input.actorId, targetId: w._id.toString(), targetKind: "StaffWarning", meta: { followUpDateKey: follow, sentSummary: input.sendSummary } });
  if (input.sendSummary) {
    await emitStaffWarningMeeting({ warningId: w._id, recipientUserId: w.staffUserId, summary: actions || discussion, stamp: Date.now() });
  }
  return (await shape([w]))[0]!;
}

/** D-#974: only review_principal handles a Principal's warning. */
async function assertMayHandle(ownerId: string, mayHandlePrincipal: boolean): Promise<void> {
  if (!mayHandlePrincipal && (await ownedByPrincipal(ownerId))) {
    throw new StaffWarningError("প্রধান শিক্ষকের আলোচনা শুধু প্রধান শিক্ষক ঠিক করতে পারেন।");
  }
}

export async function listWarnings(staffUserId: string): Promise<StaffWarningShape[]> {
  const rows = await StaffWarning.find({ staffUserId: oid(staffUserId) }).sort({ createdAt: -1 }).limit(100);
  return shape(rows);
}

// ---------------------------------------------------------------------------
// Summary (screen 7)
// ---------------------------------------------------------------------------

export interface MistakeSummaryRow {
  staffUserId: string;
  staffName: string;
  counted: number;
  weighted: number;
  pending: number;
  excused: number;
  topKind: string | null;
  /** The highest rung reached inside the period, and its meeting time. */
  warningStep: StaffWarningStep | null;
  meetingAt: Date | null;
  /** Weighted count toward the first rung, for "near the limit". */
  nextThreshold: number;
}

export interface MistakeSummary {
  days: number;
  rows: MistakeSummaryRow[];
  byKind: { kind: string; counted: number }[];
  totals: { counted: number; pending: number; excused: number; warnings: number };
}

export async function staffMistakeSummary(days: number, now: Date = new Date(), hideStaffUserIds: readonly string[] = []): Promise<MistakeSummary> {
  const period = Math.min(Math.max(Math.round(days), 1), 365);
  const since = new Date(now.getTime() - period * DAY_MS);
  const settings = await getStaffMistakeSettings();
  const hidden = { $nin: hideStaffUserIds.map(oid) };
  const mistakes = await StaffMistake.find({ createdAt: { $gte: since }, status: { $ne: "MOVED" }, staffUserId: hidden })
    .select("staffUserId status kind tier")
    .lean();
  const warnings = await StaffWarning.find({ createdAt: { $gte: since }, staffUserId: hidden }).select("staffUserId step meetingAt").lean();

  const per = new Map<string, MistakeSummaryRow & { kinds: Map<string, number> }>();
  const row = (id: string) => {
    let r = per.get(id);
    if (!r) {
      r = { staffUserId: id, staffName: "", counted: 0, weighted: 0, pending: 0, excused: 0, topKind: null, warningStep: null, meetingAt: null, nextThreshold: settings.rungs[0]!.count, kinds: new Map() };
      per.set(id, r);
    }
    return r;
  };
  const byKind = new Map<string, number>();
  for (const m of mistakes) {
    const r = row(String(m.staffUserId));
    if (m.status === "COUNTED") {
      r.counted += 1;
      r.weighted += settings.tierWeights[m.tier as 1 | 2 | 3] ?? 1;
      r.kinds.set(m.kind, (r.kinds.get(m.kind) ?? 0) + 1);
      byKind.set(m.kind, (byKind.get(m.kind) ?? 0) + 1);
    } else if (m.status === "EXCUSED") r.excused += 1;
    else r.pending += 1;
  }
  for (const w of warnings) {
    const r = row(String(w.staffUserId));
    if (!r.warningStep || STEP_ORDER[w.step] > STEP_ORDER[r.warningStep]) {
      r.warningStep = w.step;
      r.meetingAt = w.meetingAt ?? null;
    }
  }
  const users = await User.find({ _id: { $in: [...per.keys()] } }).select("name nameBn").lean();
  const name = new Map(users.map((u) => [String(u._id), personName(u)]));
  const rows = [...per.values()].map(({ kinds, ...r }) => ({
    ...r,
    staffName: name.get(r.staffUserId) ?? "",
    topKind: [...kinds.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
  }));
  rows.sort((a, b) => b.weighted - a.weighted || b.pending - a.pending || a.staffName.localeCompare(b.staffName));
  return {
    days: period,
    rows,
    byKind: [...byKind.entries()].map(([kind, counted]) => ({ kind, counted })).sort((a, b) => b.counted - a.counted),
    totals: {
      counted: rows.reduce((s, r) => s + r.counted, 0),
      pending: rows.reduce((s, r) => s + r.pending, 0),
      excused: rows.reduce((s, r) => s + r.excused, 0),
      warnings: warnings.length,
    },
  };
}
