/**
 * "View as" — the Principal opens a teacher's or guardian's account view (VA-1, D-#638).
 *
 * Why it exists: testing a bug report meant asking a teacher for her password. This mints a
 * short-lived token FOR the target account, so every resolver scopes to them with no
 * per-screen work — the app already reads `ctx.auth.userId` for sections, queues and
 * permissions.
 *
 * Two rules shape everything here:
 *
 * 1. The token carries the BORROWED account's `userId`/`role`. It must: scope checks read
 *    them directly (`Section.find({ classTeacherId: ctx.auth.userId })`), so a token minted
 *    with the Principal's id would show them their own empty list. The Principal rides
 *    along in `impersonatorId`, and the audit log is where that becomes visible (D-#638).
 *
 * 2. Nothing is subtracted. The owner's decision is that whatever the teacher or guardian
 *    can do, the Principal can do through them — no denylist, no read-only mode. The
 *    safeguard is that the log names the Principal, not that the app refuses.
 */
import { Types } from "mongoose";
import type { Role } from "@scd/shared";
import { User } from "../models/User";
import { Guardian } from "../models/Guardian";
import { GuardianLink } from "../models/GuardianLink";
import { Student } from "../models/Student";
import { Section } from "../models/Section";
import { signToken, type AuthResult } from "./AuthService";
import { writeAudit } from "../../platform/services/AuditService";

/** A borrowed session is short. Long enough to reproduce a bug, short enough that a
 *  forgotten tab is not a standing second identity. */
export const IMPERSONATION_TTL_MINUTES = 45;

export type ImpersonationKind = "STAFF" | "GUARDIAN";

export interface ImpersonationTarget {
  id: string;
  kind: ImpersonationKind;
  name: string;
  role: string;
  /** Staff: their sections. Guardian: one line per child, "<name> · <শাখা>" (owner ask). */
  lines: string[];
  /** False ⇒ the row renders locked, with `reason` saying why (G2). */
  eligible: boolean;
  reason: string | null;
}

export interface ImpersonationResult extends AuthResult {
  /** Wall-clock seconds the borrowed token is good for — drives the banner countdown. */
  expiresInSeconds: number;
}

const NOT_PRINCIPAL = "শুধু প্রধান শিক্ষক অন্য কারও ভিউ দেখতে পারেন।";
const ALREADY_VIEWING = "আপনি এখন অন্য একটি অ্যাকাউন্টের ভিউতে আছেন। আগে নিজের অ্যাকাউন্টে ফিরে যান।";
const TARGET_MISSING = "অ্যাকাউন্টটি পাওয়া যায়নি।";
const TARGET_PRINCIPAL = "প্রধান শিক্ষকের অ্যাকাউন্টের ভিউ দেখা যায় না।";
const TARGET_SELF = "এটি আপনার নিজের অ্যাকাউন্ট।";
const TARGET_INACTIVE = "অ্যাকাউন্টটি নিষ্ক্রিয়।";
const TARGET_NO_LOGIN = "এই অভিভাবকের লগইন চালু নেই।";

/**
 * The caller must be a Principal *in the database*, not merely by token claim (G3).
 *
 * Deliberately NOT a `Permission`: keeping it out of the enum keeps it out of the AC-1
 * per-user grant surface, so it can never be handed to an office account by accident —
 * and it means no `/shared/vocab.ts` edit and no two-place contract sync.
 *
 * Also deliberately the PRIMARY role, not `isAdminStaff`: an added OFFICE/PRINCIPAL
 * template widens what someone may DO in their own account (D-#468); it should not hand
 * them everyone else's account as well.
 */
async function assertPrincipal(callerUserId: string): Promise<{ id: Types.ObjectId; role: Role }> {
  if (!Types.ObjectId.isValid(callerUserId)) throw new Error(NOT_PRINCIPAL);
  const caller = await User.findById(callerUserId).select("role active").lean();
  if (!caller || caller.active === false || caller.role !== "PRINCIPAL") throw new Error(NOT_PRINCIPAL);
  return { id: caller._id as Types.ObjectId, role: caller.role as Role };
}

/** Anchored, case-insensitive, regex-safe contains match for the picker's search box. */
function searchClause(search: string | null | undefined): RegExp | null {
  const q = (search ?? "").trim();
  if (!q) return null;
  return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

/** "<child name> · <শাখা>" for every child linked to each guardian (owner ask: the
 *  guardian row is recognised by the শিক্ষার্থী, so the child's name carries it). */
async function childLinesByGuardian(guardianIds: Types.ObjectId[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (guardianIds.length === 0) return out;

  const links = await GuardianLink.find({ guardianId: { $in: guardianIds } })
    .select("guardianId studentId")
    .lean();
  if (links.length === 0) return out;

  const students = await Student.find({ _id: { $in: links.map((l) => l.studentId) } })
    .select("name nameBn sectionId")
    .lean();
  const studentById = new Map(students.map((s) => [s._id.toString(), s]));

  const sections = await Section.find({ _id: { $in: students.map((s) => s.sectionId) } })
    .select("nameBn code")
    .lean();
  const sectionLabelById = new Map(
    sections.map((s) => [s._id.toString(), (s as { nameBn?: string; code?: string }).nameBn || (s as { code?: string }).code || ""]),
  );

  for (const link of links) {
    const student = studentById.get(link.studentId.toString());
    if (!student) continue;
    const label = sectionLabelById.get(student.sectionId?.toString() ?? "") ?? "";
    const name = student.nameBn || student.name;
    const key = link.guardianId.toString();
    const lines = out.get(key) ?? [];
    lines.push(label ? `${name} · ${label}` : name);
    out.set(key, lines);
  }
  return out;
}

/**
 * The picker list. Ineligible accounts are RETURNED, not filtered out — a row that is
 * simply missing invites "why can't I find her", while a locked row with a reason answers
 * it. The eligibility rules here mirror `startImpersonation` exactly; that one is the gate,
 * this one is only what the UI offers.
 */
export async function listImpersonationTargets(input: {
  callerUserId: string;
  kind: ImpersonationKind;
  search?: string | null;
  limit?: number | null;
}): Promise<ImpersonationTarget[]> {
  const caller = await assertPrincipal(input.callerUserId);
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const rx = searchClause(input.search);

  if (input.kind === "STAFF") {
    const q: Record<string, unknown> = {};
    if (rx) q.$or = [{ name: rx }, { email: rx }, { phone: rx }];
    const users = await User.find(q)
      .select("name role active additionalTemplates")
      .sort({ name: 1 })
      .limit(limit)
      .lean();

    const sections = await Section.find({ classTeacherId: { $in: users.map((u) => u._id) }, active: true })
      .select("classTeacherId nameBn code")
      .lean();
    const sectionsByTeacher = new Map<string, string[]>();
    for (const s of sections as Array<{ classTeacherId?: Types.ObjectId; nameBn?: string; code?: string }>) {
      if (!s.classTeacherId) continue;
      const key = s.classTeacherId.toString();
      const list = sectionsByTeacher.get(key) ?? [];
      list.push(s.nameBn || s.code || "");
      sectionsByTeacher.set(key, list);
    }

    return users.map((u) => {
      const templates = (u.additionalTemplates ?? []) as Role[];
      const isPrincipal = u.role === "PRINCIPAL" || templates.includes("PRINCIPAL");
      const isSelf = u._id.toString() === caller.id.toString();
      const inactive = u.active === false;
      return {
        id: u._id.toString(),
        kind: "STAFF" as const,
        name: u.name,
        role: u.role as string,
        lines: (sectionsByTeacher.get(u._id.toString()) ?? []).filter(Boolean),
        eligible: !isPrincipal && !isSelf && !inactive,
        reason: isSelf ? TARGET_SELF : isPrincipal ? TARGET_PRINCIPAL : inactive ? TARGET_INACTIVE : null,
      };
    });
  }

  const q: Record<string, unknown> = {};
  if (rx) q.$or = [{ name: rx }, { phone: rx }, { identifier: rx }];
  let guardians = await Guardian.find(q)
    .select("name active loginEnabled passwordHash")
    .sort({ name: 1 })
    .limit(limit)
    .lean();

  // A search that matches no guardian by their own details may still be a search for a
  // CHILD — which is how the owner will actually look a family up. Resolve it through the
  // roster and re-fetch, so typing a শিক্ষার্থী's name finds their guardians.
  if (rx && guardians.length === 0) {
    const students = await Student.find({ $or: [{ name: rx }, { nameBn: rx }] })
      .select("_id")
      .limit(limit)
      .lean();
    if (students.length > 0) {
      const links = await GuardianLink.find({ studentId: { $in: students.map((s) => s._id) } })
        .select("guardianId")
        .lean();
      guardians = await Guardian.find({ _id: { $in: links.map((l) => l.guardianId) } })
        .select("name active loginEnabled passwordHash")
        .sort({ name: 1 })
        .limit(limit)
        .lean();
    }
  }

  const childLines = await childLinesByGuardian(guardians.map((g) => g._id));

  return guardians.map((g) => {
    const inactive = g.active === false;
    const noLogin = !g.loginEnabled || !g.passwordHash;
    return {
      id: g._id.toString(),
      kind: "GUARDIAN" as const,
      name: g.name,
      role: "GUARDIAN",
      lines: childLines.get(g._id.toString()) ?? [],
      eligible: !inactive && !noLogin,
      reason: inactive ? TARGET_INACTIVE : noLogin ? TARGET_NO_LOGIN : null,
    };
  });
}

/**
 * Mint the borrowed token.
 *
 * The refusals below are G2: no nesting (`alreadyImpersonating`), no self, no Principal
 * target, and no account its real owner could not log into either. That last one matters
 * most — "View as" must never be a way to reach an account that is switched off.
 */
export async function startImpersonation(input: {
  callerUserId: string;
  alreadyImpersonating: boolean;
  targetId: string;
  targetKind: ImpersonationKind;
}): Promise<ImpersonationResult> {
  if (input.alreadyImpersonating) throw new Error(ALREADY_VIEWING);
  const caller = await assertPrincipal(input.callerUserId);
  if (!Types.ObjectId.isValid(input.targetId)) throw new Error(TARGET_MISSING);

  const ttl = `${IMPERSONATION_TTL_MINUTES}m` as `${number}m`;
  const expiresInSeconds = IMPERSONATION_TTL_MINUTES * 60;

  if (input.targetKind === "STAFF") {
    const target = await User.findById(input.targetId)
      .select("name role active additionalTemplates grantedPermissions revokedPermissions")
      .lean();
    if (!target) throw new Error(TARGET_MISSING);
    if (target._id.toString() === caller.id.toString()) throw new Error(TARGET_SELF);
    const templates = (target.additionalTemplates ?? []) as Role[];
    if (target.role === "PRINCIPAL" || templates.includes("PRINCIPAL")) throw new Error(TARGET_PRINCIPAL);
    if (target.active === false) throw new Error(TARGET_INACTIVE);

    // Deliberately NOT LOGIN_SUCCESS (G7) — see the IMPERSONATION_START docblock on the
    // event kind. Written under the Principal's OWN token, so it is not inverted.
    await writeAudit({
      eventKind: "IMPERSONATION_START",
      actorId: caller.id,
      actorRole: caller.role,
      targetId: target._id,
      targetKind: "User",
      meta: { targetName: target.name, targetRole: target.role, ttlMinutes: IMPERSONATION_TTL_MINUTES },
    });

    return {
      token: signToken(
        {
          userId: target._id.toString(),
          role: target.role as Role,
          additionalTemplates: templates,
          grantedPermissions: target.grantedPermissions ?? [],
          revokedPermissions: target.revokedPermissions ?? [],
          impersonatorId: caller.id.toString(),
          impersonatorRole: caller.role,
        },
        ttl,
      ),
      userId: target._id.toString(),
      role: target.role as Role,
      name: target.name,
      expiresInSeconds,
    };
  }

  const target = await Guardian.findById(input.targetId).select("name active loginEnabled passwordHash").lean();
  if (!target) throw new Error(TARGET_MISSING);
  if (target.active === false) throw new Error(TARGET_INACTIVE);
  if (!target.loginEnabled || !target.passwordHash) throw new Error(TARGET_NO_LOGIN);

  await writeAudit({
    eventKind: "IMPERSONATION_START",
    actorId: caller.id,
    actorRole: caller.role,
    targetId: target._id,
    targetKind: "Guardian",
    meta: { targetName: target.name, targetRole: "GUARDIAN", ttlMinutes: IMPERSONATION_TTL_MINUTES },
  });

  return {
    // Guardian tokens carry no templates or overrides — the guardian wall (J-AC4), same as
    // `guardianLogin`. A borrowed guardian session must be exactly the family's own.
    token: signToken(
      {
        userId: target._id.toString(),
        role: "GUARDIAN",
        impersonatorId: caller.id.toString(),
        impersonatorRole: caller.role,
      },
      ttl,
    ),
    userId: target._id.toString(),
    role: "GUARDIAN",
    name: target.name,
    expiresInSeconds,
  };
}

/**
 * Close the session. Called WITH the borrowed token, so the row is inverted by
 * `writeAudit` like any other write made during the visit: actor = the Principal,
 * `onBehalfOf` = the account they were in.
 *
 * Best-effort by design — the client drops the borrowed token regardless, and an expiry
 * that nobody clicked leaves no END row. The START row plus the token's own TTL already
 * bound the session, so a missing END is a gap in convenience, not in accountability.
 */
export async function endImpersonation(input: {
  borrowedUserId: string;
  impersonatorId: string;
}): Promise<boolean> {
  if (!input.impersonatorId) return false;
  await writeAudit({
    eventKind: "IMPERSONATION_END",
    actorId: input.borrowedUserId,
    targetId: Types.ObjectId.isValid(input.borrowedUserId) ? new Types.ObjectId(input.borrowedUserId) : undefined,
    targetKind: "Session",
  });
  return true;
}
