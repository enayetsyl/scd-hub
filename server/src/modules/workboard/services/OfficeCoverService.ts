/**
 * OfficeCoverService (WB-5, D-#702) — who the OFFICE-queue cards belong to today.
 *
 *   normally      → the desk: every active PRIMARY-role OFFICE login (Akmol)
 *   desk on leave → the desk (still) + the BACKUPS: logins that act as OFFICE by
 *                   template or as PRINCIPAL — they may PULL a card to themselves
 *   pulled        → the puller alone, until the source closes
 *
 * "On leave" = an APPROVED StaffLeaveApplication covering today, joined User →
 * StaffProfile by normalised phone (the staffMatch rule). The pure halves are
 * exported for the DB-free test; the DB half reads three small collections.
 */
import { Types } from "mongoose";
import { callerHasPermission } from "@scd/shared";
import type { AuthPayload } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { dateKeyOf } from "../../attendance/dates";
import { User } from "../../foundation/models/User";
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { normalizePhone } from "../../foundation/services/credentials";
import { StaffLeaveApplication } from "../../hr/models/StaffLeaveApplication";
import { PrintRequest } from "../../printing/models/PrintRequest";
import { writeAudit } from "../../platform/services/AuditService";
import { WorkCardPull } from "../models/WorkCardPull";

/** The card kinds a backup may pull. */
export const PULLABLE_KINDS = ["PRINT_JOB", "LEAVE_APPROVAL"] as const;
export type PullableKind = (typeof PULLABLE_KINDS)[number];

export interface CoverUser {
  _id: { toString(): string };
  role: string;
  additionalTemplates?: string[];
}

export const isDesk = (u: CoverUser): boolean => u.role === "OFFICE";
export const isBackup = (u: CoverUser): boolean =>
  !isDesk(u) && (u.role === "PRINCIPAL" || (u.additionalTemplates ?? []).some((t) => t === "OFFICE" || t === "PRINCIPAL"));

/** Pure: the desk is uncovered when there is no desk login at all, or every one is absent. */
export function deskUncovered(deskIds: string[], absentIds: Set<string>): boolean {
  return deskIds.length === 0 || deskIds.every((id) => absentIds.has(id));
}

/** Pure: which of `users` receive the office-queue cards today. */
export function officeRecipients<T extends CoverUser>(users: T[], uncovered: boolean): T[] {
  return users.filter((u) => isDesk(u) || (uncovered && isBackup(u)));
}

/** Every active PRIMARY-role OFFICE login school-wide, with phone for the leave join. */
async function deskLogins(): Promise<Array<{ _id: Types.ObjectId; phone?: string }>> {
  return (await User.find({ active: true, role: "OFFICE" }).select("phone").lean()) as unknown as Array<{ _id: Types.ObjectId; phone?: string }>;
}

/** Ids of desk logins on approved leave covering `todayKey`. */
async function absentDeskIds(desk: Array<{ _id: Types.ObjectId; phone?: string }>, todayKey: string): Promise<Set<string>> {
  const out = new Set<string>();
  const withPhone = desk.filter((d) => d.phone);
  if (withPhone.length === 0) return out;
  const profiles = (await StaffProfile.find({ active: true, phone: { $ne: null } }).select("phone").lean()) as unknown as Array<{ _id: Types.ObjectId; phone?: string }>;
  const profileByPhone = new Map<string, Types.ObjectId>();
  for (const p of profiles) if (p.phone) profileByPhone.set(normalizePhone(p.phone), p._id);
  const userByProfile = new Map<string, string>();
  for (const d of withPhone) {
    const pid = profileByPhone.get(normalizePhone(d.phone!));
    if (pid) userByProfile.set(pid.toString(), d._id.toString());
  }
  if (userByProfile.size === 0) return out;
  const leaves = (await StaffLeaveApplication.find({
    staffProfileId: { $in: [...userByProfile.keys()].map((id) => new Types.ObjectId(id)) },
    status: "approved",
    fromKey: { $lte: todayKey },
    toKey: { $gte: todayKey },
  })
    .select("staffProfileId")
    .lean()) as unknown as Array<{ staffProfileId: Types.ObjectId }>;
  for (const l of leaves) {
    const uid = userByProfile.get(l.staffProfileId.toString());
    if (uid) out.add(uid);
  }
  return out;
}

/** Is the desk uncovered today (so backups see the office cards)? */
export async function officeUncoveredToday(todayKey: string): Promise<boolean> {
  const desk = await deskLogins();
  const absent = await absentDeskIds(desk, todayKey);
  return deskUncovered(desk.map((d) => d._id.toString()), absent);
}

export interface PullRow {
  kind: string;
  sourceId: string;
  userId: string;
}

export async function pullsFor(kinds: readonly string[]): Promise<PullRow[]> {
  const rows = (await WorkCardPull.find({ kind: { $in: [...kinds] } }).select("kind sourceId userId").lean()) as unknown as Array<{ kind: string; sourceId: Types.ObjectId; userId: Types.ObjectId }>;
  return rows.map((r) => ({ kind: r.kind, sourceId: r.sourceId.toString(), userId: r.userId.toString() }));
}

const canPullAtAll = (auth: AuthPayload): boolean =>
  auth.role === "PRINCIPAL" ||
  auth.role === "OFFICE" ||
  (auth.additionalTemplates ?? []).some((t) => t === "OFFICE" || t === "PRINCIPAL") ||
  callerHasPermission(auth, "tasks:assign");

async function assertSourceOpen(kind: PullableKind, sourceId: string): Promise<void> {
  if (!Types.ObjectId.isValid(sourceId)) throw new Error("কাজটি পাওয়া যায়নি");
  if (kind === "PRINT_JOB") {
    const job = await PrintRequest.findById(sourceId).select("status").lean();
    if (!job || job.status !== "REQUESTED") throw new Error("এই প্রিন্ট কাজটি আর খোলা নেই");
    return;
  }
  const app = await StaffLeaveApplication.findById(sourceId).select("status").lean();
  if (!app || app.status !== "applied") throw new Error("এই ছুটির আবেদনটি আর খোলা নেই");
}

/** Take an office-queue card onto MY board. A desk login, a backup, or tasks:assign. */
export async function pullWorkCard(authIn: AuthPayload | null, kind: string, sourceId: string): Promise<boolean> {
  if (!authIn) throw new ForbiddenError("Unauthenticated");
  if (!(PULLABLE_KINDS as readonly string[]).includes(kind)) throw new Error("এই ধরনের কাজ নেওয়া যায় না");
  if (!canPullAtAll(authIn)) throw new ForbiddenError("এই কাজ নেওয়ার অনুমতি নেই");
  await assertSourceOpen(kind as PullableKind, sourceId);
  await WorkCardPull.updateOne(
    { kind, sourceId: new Types.ObjectId(sourceId) },
    { $set: { userId: new Types.ObjectId(authIn.userId), pulledBy: new Types.ObjectId(authIn.userId), pulledAt: new Date() } },
    { upsert: true },
  );
  await writeAudit({
    eventKind: "TASK_WRITE",
    actorId: authIn.userId,
    actorRole: authIn.role,
    targetId: sourceId,
    targetKind: kind,
    meta: { action: "pull", dateKey: dateKeyOf(new Date()) },
  });
  return true;
}

/** Give a pulled card back to the queue. The puller, or tasks:assign. */
export async function releaseWorkCard(authIn: AuthPayload | null, kind: string, sourceId: string): Promise<boolean> {
  if (!authIn) throw new ForbiddenError("Unauthenticated");
  if (!Types.ObjectId.isValid(sourceId)) throw new Error("কাজটি পাওয়া যায়নি");
  const row = await WorkCardPull.findOne({ kind, sourceId: new Types.ObjectId(sourceId) }).lean();
  if (!row) return false;
  if (row.userId.toString() !== authIn.userId && !callerHasPermission(authIn, "tasks:assign")) {
    throw new ForbiddenError("যিনি নিয়েছেন কেবল তিনিই ফেরত দিতে পারেন");
  }
  await WorkCardPull.deleteOne({ _id: row._id });
  await writeAudit({
    eventKind: "TASK_WRITE",
    actorId: authIn.userId,
    actorRole: authIn.role,
    targetId: sourceId,
    targetKind: kind,
    meta: { action: "release", from: row.userId.toString() },
  });
  return true;
}
