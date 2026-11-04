/**
 * StaffMistakeService (D-#936–#939, docs/prd-staff-mistakes.md) — the general mistake log.
 *
 *   recordMistakeFromSource  a source (the same-day mark correction today) caught a mistake
 *   explainMistake           the person gives a reason (a button + optional text)
 *   decideMistake            Office / the Principal: excuse, count, or move to someone else
 *   listStaffMistakes        reads; settles overdue explanations first
 *
 * Status rules (§2): a reason given by the person themselves at the moment of correction is
 * applied at once — "MINE" counts, any other reason waits for review. No reason → the person
 * has until 17:00 on the next school day; after that it counts on its own (settled lazily on
 * every read — no scheduler family).
 */
import { Types } from "mongoose";
import {
  staffMistakeReason,
  staffMistakeReasonError,
  STAFF_MISTAKE_TEXT_MAX,
  type StaffMistakeDecision,
  type StaffMistakeKind,
  type StaffMistakeStatus,
} from "@scd/shared";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { personName } from "../../../lib/personName";
import { StaffMistake, type IStaffMistake } from "../models/StaffMistake";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
import { emitStaffMistakeDecided, emitStaffMistakeExplain } from "../../notifications/services/emitters";
import type { CorrectionReason } from "./correctionReasonContext";
import type { StaffMistakeDeadline } from "@scd/shared";
import { getStaffMistakeSettings } from "./StaffMistakeSettingsService";
import { evaluateLadder } from "./StaffWarningService";

import { StaffMistakeError } from "./errors";
export { StaffMistakeError };

const oid = (id: string): Types.ObjectId => {
  if (!Types.ObjectId.isValid(id)) throw new StaffMistakeError("ভুল আইডি।");
  return new Types.ObjectId(id);
};

/** Sun–Thu are school days (trackers/calendar.ts), counted on the Dhaka calendar. */
const SCHOOL_WEEKDAYS = new Set([0, 1, 2, 3, 4]);

/**
 * The explanation deadline (§2; the Principal picks the rule, D-#943): 17:00 Dhaka on the
 * next school day (default), 24 hours, or 17:00 on the third school day.
 */
export function explainDeadline(now: Date, rule: StaffMistakeDeadline = "NEXT_SCHOOL_DAY"): Date {
  if (rule === "HOURS_24") return new Date(now.getTime() + 24 * 3600 * 1000);
  const d = new Date(`${dhakaDayKey(now)}T00:00:00Z`);
  let left = rule === "SCHOOL_DAYS_3" ? 3 : 1;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (SCHOOL_WEEKDAYS.has(d.getUTCDay())) left -= 1;
  }
  return new Date(`${d.toISOString().slice(0, 10)}T17:00:00+06:00`);
}

/** A mistake just became COUNTED: check the warning ladder (D-#940). Never throws. */
async function afterCounted(staffUserId: string, now: Date): Promise<void> {
  try {
    await evaluateLadder(staffUserId, now);
  } catch (err) {
    console.error("[StaffMistakeService] warning ladder failed (the mistake is still recorded):", err);
  }
}

/**
 * Overdue explanations become counted mistakes, and each person affected is checked against
 * the ladder. Runs on every read and from the scheduler tick (D-#940). Returns how many.
 */
export async function settleOverdueMistakes(now: Date = new Date()): Promise<number> {
  const due = { status: "EXPLANATION_DUE", explainDueAt: { $lte: now } };
  const people = (await StaffMistake.distinct("staffUserId", due)).map(String);
  if (people.length === 0) return 0;
  const res = await StaffMistake.updateMany(due, { $set: { status: "COUNTED", autoCounted: true, decidedAt: now } });
  for (const id of people) await afterCounted(id, now);
  return res.modifiedCount ?? 0;
}

/** Apply a reason to a row in memory — the status follows the reason (§2). True = counted. */
function applyReason(row: IStaffMistake, reason: CorrectionReason, now: Date): boolean {
  const r = staffMistakeReason(row.kind, reason.code)!;
  row.reasonCode = r.code;
  row.reasonText = reason.text || null;
  row.explainedAt = now;
  if (r.selfCounts) {
    row.status = "COUNTED";
    row.decidedAt = now;
    row.decidedBy = null;
    return true;
  }
  row.status = "PENDING_REVIEW";
  return false;
}

export interface RecordMistakeInput {
  kind: StaffMistakeKind;
  tier: number;
  sourceId: Types.ObjectId | string;
  staffUserId: Types.ObjectId | string;
  /** Who made the correction that revealed it — may be someone else. */
  correctedBy: string;
  at: Date;
  reason?: CorrectionReason | null;
}

/**
 * One row per (kind × source × person). The reason counts only when the person corrected
 * their own mark; otherwise they are asked to explain. A later correction on the same source
 * may still bring the first reason. Best-effort callers wrap this.
 */
export async function recordMistakeFromSource(input: RecordMistakeInput): Promise<IStaffMistake | null> {
  const settings = await getStaffMistakeSettings();
  // A place the Principal switched off records nothing (D-#943).
  if (settings.disabledKinds.includes(input.kind)) return null;
  const staffUserId = new Types.ObjectId(input.staffUserId.toString());
  const sourceId = new Types.ObjectId(input.sourceId.toString());
  const self = input.correctedBy === staffUserId.toString();
  const reason =
    self && input.reason && !staffMistakeReasonError(input.kind, input.reason.code, input.reason.text)
      ? input.reason
      : null;

  const existing = await StaffMistake.findOne({ kind: input.kind, sourceId, staffUserId });
  if (existing) {
    if (reason && existing.status === "EXPLANATION_DUE") {
      const nowCounted = applyReason(existing, reason, input.at);
      await existing.save();
      await auditExplained(existing, staffUserId.toString());
      if (nowCounted) await afterCounted(staffUserId.toString(), input.at);
    }
    return existing;
  }

  const row = new StaffMistake({
    staffUserId,
    kind: input.kind,
    tier: input.tier,
    sourceId,
    dateKey: dhakaDayKey(input.at),
    status: "EXPLANATION_DUE",
    explainDueAt: explainDeadline(input.at, settings.deadline),
  });
  if (reason) applyReason(row, reason, input.at);
  try {
    await row.save();
  } catch (err) {
    // Two corrections racing the insert: the loser reads the winner's row.
    if ((err as { code?: number }).code !== 11000) throw err;
    return StaffMistake.findOne({ kind: input.kind, sourceId, staffUserId });
  }
  if (reason) await auditExplained(row, staffUserId.toString());
  else await emitStaffMistakeExplain({ mistakeId: row._id, recipientUserId: staffUserId, kind: row.kind, explainDueAt: row.explainDueAt });
  if (row.status === "COUNTED") await afterCounted(staffUserId.toString(), input.at);
  return row;
}

async function auditExplained(row: IStaffMistake, actorId: string): Promise<void> {
  await writeAudit({
    eventKind: "STAFF_MISTAKE_EXPLAINED",
    actorId,
    targetId: row._id.toString(),
    targetKind: "StaffMistake",
    meta: { kind: row.kind, reasonCode: row.reasonCode, status: row.status },
  });
}

/** The person explains their own entry (§2). Re-explaining before a decision replaces it. */
export async function explainMistake(input: {
  mistakeId: string;
  actorId: string;
  reasonCode: string;
  reasonText: string;
  now?: Date;
}): Promise<IStaffMistake> {
  const now = input.now ?? new Date();
  await settleOverdueMistakes(now);
  const row = await StaffMistake.findById(oid(input.mistakeId));
  if (!row) throw new StaffMistakeError("এন্ট্রিটি পাওয়া যায়নি।");
  if (row.staffUserId.toString() !== input.actorId) throw new StaffMistakeError("শুধু নিজের ভুলের ব্যাখ্যা দেওয়া যায়।");
  if (row.status !== "EXPLANATION_DUE" && row.status !== "PENDING_REVIEW") {
    throw new StaffMistakeError(
      row.autoCounted ? "ব্যাখ্যা দেওয়ার সময় পেরিয়ে গেছে।" : "এই এন্ট্রির সিদ্ধান্ত হয়ে গেছে — আর বদলানো যায় না।",
    );
  }
  const text = input.reasonText.trim();
  const bad = staffMistakeReasonError(row.kind, input.reasonCode, text);
  if (bad) throw new StaffMistakeError(bad);
  const nowCounted = applyReason(row, { code: input.reasonCode, text }, now);
  await row.save();
  await auditExplained(row, input.actorId);
  if (nowCounted) await afterCounted(input.actorId, now);
  return row;
}

const DECIDED_STATUS: Record<Exclude<StaffMistakeDecision, "MOVE">, StaffMistakeStatus> = {
  EXCUSE: "EXCUSED",
  COUNT: "COUNTED",
};

/**
 * A reviewer decides (§5). Any row but a MOVED one may be (re)decided — a reviewer can undo
 * their own wrong call. Nobody decides their own entry.
 */
export async function decideMistake(input: {
  mistakeId: string;
  actorId: string;
  actorRole?: string;
  decision: string;
  note?: string | null;
  moveToUserId?: string | null;
  now?: Date;
}): Promise<IStaffMistake> {
  const now = input.now ?? new Date();
  if (input.decision !== "EXCUSE" && input.decision !== "COUNT" && input.decision !== "MOVE") {
    throw new StaffMistakeError("অজানা সিদ্ধান্ত।");
  }
  const note = (input.note ?? "").trim();
  if (note.length > STAFF_MISTAKE_TEXT_MAX) throw new StaffMistakeError(`মন্তব্য ${STAFF_MISTAKE_TEXT_MAX} অক্ষরের মধ্যে লিখুন।`);
  await settleOverdueMistakes(now);
  const row = await StaffMistake.findById(oid(input.mistakeId));
  if (!row) throw new StaffMistakeError("এন্ট্রিটি পাওয়া যায়নি।");
  if (row.staffUserId.toString() === input.actorId) throw new StaffMistakeError("নিজের ভুলের সিদ্ধান্ত নিজে দেওয়া যায় না।");
  if (row.status === "MOVED") throw new StaffMistakeError("এই এন্ট্রি অন্যের কাছে সরানো হয়েছে — সেখানে সিদ্ধান্ত দিন।");

  let moved: IStaffMistake | null = null;
  if (input.decision === "MOVE") {
    const target = input.moveToUserId ? oid(input.moveToUserId) : null;
    if (!target) throw new StaffMistakeError("কার কাছে সরাবেন, বেছে নিন।");
    if (target.equals(row.staffUserId)) throw new StaffMistakeError("একই ব্যক্তির কাছে সরানো যায় না।");
    const user = await User.findOne({ _id: target, active: true, role: { $ne: "GUARDIAN" } }).select("_id").lean();
    if (!user) throw new StaffMistakeError("এই কর্মীকে পাওয়া যায়নি।");
    try {
      moved = await StaffMistake.create({
        staffUserId: target,
        kind: row.kind,
        tier: row.tier,
        sourceId: row.sourceId,
        dateKey: row.dateKey,
        status: "EXPLANATION_DUE",
        explainDueAt: explainDeadline(now, (await getStaffMistakeSettings()).deadline),
        movedFromId: row._id,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new StaffMistakeError("এই ভুল আগেই ওই কর্মীর নামে আছে।");
      }
      throw err;
    }
    row.status = "MOVED";
    row.movedToId = moved._id;
  } else {
    row.status = DECIDED_STATUS[input.decision];
  }
  const nowCounted = row.status === "COUNTED";
  row.autoCounted = false;
  row.decidedBy = new Types.ObjectId(input.actorId);
  row.decidedAt = now;
  row.decisionNote = note || null;
  await row.save();

  await writeAudit({
    eventKind: "STAFF_MISTAKE_DECIDED",
    actorId: input.actorId,
    actorRole: input.actorRole,
    targetId: row._id.toString(),
    targetKind: "StaffMistake",
    meta: { kind: row.kind, decision: input.decision, movedToUserId: moved ? moved.staffUserId.toString() : undefined },
  });
  await emitStaffMistakeDecided({
    mistakeId: row._id,
    recipientUserId: row.staffUserId,
    decision: input.decision,
    note: row.decisionNote ?? "",
  });
  if (nowCounted) await afterCounted(row.staffUserId.toString(), now);
  if (moved) {
    await emitStaffMistakeExplain({
      mistakeId: moved._id,
      recipientUserId: moved.staffUserId,
      kind: moved.kind,
      explainDueAt: moved.explainDueAt,
    });
  }
  return row;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface StaffMistakeShape {
  id: string;
  staffUserId: string;
  staffName: string;
  kind: StaffMistakeKind;
  tier: number;
  sourceId: string;
  dateKey: string;
  status: StaffMistakeStatus;
  reasonCode: string | null;
  reasonText: string | null;
  explainedAt: Date | null;
  explainDueAt: Date;
  autoCounted: boolean;
  decidedByName: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  movedFromName: string | null;
  movedToName: string | null;
  createdAt: Date;
}

/** Newest first. Settles overdue explanations before reading. */
export async function listStaffMistakes(opts: {
  staffUserId?: string | null;
  statuses?: readonly StaffMistakeStatus[];
  excludeStaffUserId?: string | null;
  limit?: number;
  now?: Date;
}): Promise<StaffMistakeShape[]> {
  await settleOverdueMistakes(opts.now ?? new Date());
  const filter: Record<string, unknown> = {};
  if (opts.staffUserId) filter.staffUserId = oid(opts.staffUserId);
  else if (opts.excludeStaffUserId) filter.staffUserId = { $ne: oid(opts.excludeStaffUserId) };
  if (opts.statuses?.length) filter.status = { $in: opts.statuses };
  const rows = await StaffMistake.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(opts.limit ?? 200, 1), 500))
    .lean();
  if (rows.length === 0) return [];

  // Names: the person, the reviewer, and whoever a MOVE links to.
  const linked = await StaffMistake.find({
    _id: { $in: rows.flatMap((r) => [r.movedFromId, r.movedToId]).filter(Boolean) },
  })
    .select("staffUserId")
    .lean();
  const linkedOwner = new Map(linked.map((l) => [String(l._id), String(l.staffUserId)]));
  const userIds = new Set<string>();
  for (const r of rows) {
    userIds.add(String(r.staffUserId));
    if (r.decidedBy) userIds.add(String(r.decidedBy));
  }
  for (const id of linkedOwner.values()) userIds.add(id);
  const users = await User.find({ _id: { $in: [...userIds] } }).select("name nameBn").lean();
  const name = new Map(users.map((u) => [String(u._id), personName(u)]));
  const linkName = (id: unknown): string | null => {
    if (!id) return null;
    const owner = linkedOwner.get(String(id));
    return owner ? (name.get(owner) ?? null) : null;
  };

  return rows.map((r) => ({
    id: String(r._id),
    staffUserId: String(r.staffUserId),
    staffName: name.get(String(r.staffUserId)) ?? "",
    kind: r.kind,
    tier: r.tier,
    sourceId: String(r.sourceId),
    dateKey: r.dateKey,
    status: r.status,
    reasonCode: r.reasonCode ?? null,
    reasonText: r.reasonText ?? null,
    explainedAt: r.explainedAt ?? null,
    explainDueAt: r.explainDueAt,
    autoCounted: !!r.autoCounted,
    decidedByName: r.decidedBy ? (name.get(String(r.decidedBy)) ?? null) : null,
    decidedAt: r.decidedAt ?? null,
    decisionNote: r.decisionNote ?? null,
    movedFromName: linkName(r.movedFromId),
    movedToName: linkName(r.movedToId),
    createdAt: r.createdAt,
  }));
}

/** Active staff a mistake may be moved to (the reviewer's picker). */
export async function listMoveTargets(): Promise<{ userId: string; name: string }[]> {
  const users = await User.find({ active: true, role: { $ne: "GUARDIAN" } }).select("name nameBn").lean();
  return users
    .map((u) => ({ userId: String(u._id), name: personName(u) }))
    .filter((u) => u.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}
