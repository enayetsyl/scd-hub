/**
 * OfficeCoverService (WB-5, D-#702) — who the OFFICE-queue cards belong to today.
 *
 *   normally      → the desk: every active login that HOLDS the card's action
 *                   (PRINT_JOB → printing:process, LEAVE_APPROVAL → leave:approve) and
 *                   is not a backup by role (Akmol)
 *   desk on leave → the desk (still) + the BACKUPS: holders of the card's action who act
 *                   as OFFICE by template or as PRINCIPAL and hold work_board:cover_desk
 *                   — they may PULL a card to themselves
 *   pulled        → the puller alone, until the source closes
 *
 * PM (D-#790..#801, §5.5): recipients follow the ACTION, not the role — a teacher granted
 * printing:process is on the desk; an Office login with it switched off is not. With
 * default switches the desk is exactly the primary-role OFFICE logins, as before. The
 * role/template split that remains only decides desk-vs-backup ROUTING (who sees the
 * card always vs while the desk is absent), never who may act.
 *
 * "On leave" = an APPROVED StaffLeaveApplication covering today, joined User →
 * StaffProfile by normalised phone (the staffMatch rule). The pure halves are
 * exported for the DB-free test; the DB half reads three small collections.
 */
import { Types } from "mongoose";
import { callerHasPermission, type Permission, type Role } from "@scd/shared";
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
  grantedPermissions?: string[];
  revokedPermissions?: string[];
}

/** The action an office-queue card asks of whoever holds it (PM §5.5). */
export const CARD_ACTION: Record<PullableKind, Permission> = {
  PRINT_JOB: "printing:process",
  LEAVE_APPROVAL: "leave:approve",
};

const holds = (u: CoverUser, perm: Permission): boolean =>
  callerHasPermission(
    {
      role: u.role as Role,
      additionalTemplates: (u.additionalTemplates ?? []) as Role[],
      grantedPermissions: (u.grantedPermissions ?? []) as Permission[],
      revokedPermissions: (u.revokedPermissions ?? []) as Permission[],
    },
    perm,
  );

/** ROUTING only: the Principal and OFFICE/PRINCIPAL-template logins are the backups, so
 *  they see the queue while the desk is away rather than always (WB-5). */
const backupByRole = (u: CoverUser): boolean =>
  u.role === "PRINCIPAL" || (u.additionalTemplates ?? []).some((t) => t === "OFFICE" || t === "PRINCIPAL");

/** The desk for `perm`: holds it and is not a backup by role (default: primary OFFICE). */
export const isDesk = (u: CoverUser, perm: Permission): boolean => !backupByRole(u) && holds(u, perm);
/** A backup for `perm`: not the desk, holds it, and holds work_board:cover_desk. */
export const isBackup = (u: CoverUser, perm: Permission): boolean =>
  !isDesk(u, perm) && backupByRole(u) && holds(u, perm) && holds(u, "work_board:cover_desk");

/** Pure: the desk is uncovered when there is no desk login at all, or every one is absent. */
export function deskUncovered(deskIds: string[], absentIds: Set<string>): boolean {
  return deskIds.length === 0 || deskIds.every((id) => absentIds.has(id));
}

/** Pure: which of `users` receive the office-queue cards for `perm` today. */
export function officeRecipients<T extends CoverUser>(users: T[], uncovered: boolean, perm: Permission): T[] {
  return users.filter((u) => isDesk(u, perm) || (uncovered && isBackup(u, perm)));
}

/** Every active desk login for `perm` school-wide, with phone for the leave join. */
async function deskLogins(perm: Permission): Promise<Array<{ _id: Types.ObjectId; phone?: string }>> {
  const users = (await User.find({ active: true, role: { $ne: "GUARDIAN" } })
    .select("phone role additionalTemplates grantedPermissions revokedPermissions")
    .lean()) as unknown as Array<CoverUser & { _id: Types.ObjectId; phone?: string }>;
  return users.filter((u) => isDesk(u, perm));
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

/** Is the desk for `perm` uncovered today (so backups see those office cards)? */
export async function officeUncoveredToday(todayKey: string, perm: Permission): Promise<boolean> {
  const desk = await deskLogins(perm);
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

/** PM: work_board:cover_desk (was: role/template PRINCIPAL|OFFICE, or tasks:assign —
 *  exactly the default holders of the action). */
const canPullAtAll = (auth: AuthPayload): boolean => callerHasPermission(auth, "work_board:cover_desk");

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

/** Take an office-queue card onto MY board. A work_board:cover_desk holder. */
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

/** Give a pulled card back to the queue. The puller, or work_board:assign. */
export async function releaseWorkCard(authIn: AuthPayload | null, kind: string, sourceId: string): Promise<boolean> {
  if (!authIn) throw new ForbiddenError("Unauthenticated");
  if (!Types.ObjectId.isValid(sourceId)) throw new Error("কাজটি পাওয়া যায়নি");
  const row = await WorkCardPull.findOne({ kind, sourceId: new Types.ObjectId(sourceId) }).lean();
  if (!row) return false;
  if (row.userId.toString() !== authIn.userId && !callerHasPermission(authIn, "work_board:assign")) {
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
