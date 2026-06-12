import { roleHasPermission, type Role } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { LibrarianAssignment, type ILibrarianAssignment } from "../models/LibrarianAssignment";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
import { LibraryError } from "../errors";

/**
 * The librarian desk gate (prd-library §5, D-#81 — the D-#42/#64 duty
 * pattern, NO new role): Principal/Office pass via `library:manage`; a
 * TEACHER passes only while their LATEST `LibrarianAssignment` row is
 * `assign`. Everyone else (incl. an unassigned teacher and any guardian) is
 * denied with a Bangla message.
 */

/** Pure: does the latest assignment row grant the duty? */
export function latestRowGrantsDuty(latest: Pick<ILibrarianAssignment, "action"> | null): boolean {
  return latest?.action === "assign";
}

/** Is this user an actively-assigned librarian-teacher? */
export async function isAssignedLibrarian(userId: string): Promise<boolean> {
  const latest = (await LibrarianAssignment.findOne({ userId })
    .sort({ at: -1, _id: -1 })
    .lean()) as Pick<ILibrarianAssignment, "action"> | null;
  return latestRowGrantsDuty(latest);
}

/** Assert the caller may run DESK OPERATIONS (issue/return/renew/lost/holds,
 *  desk reservations). Catalog/policy/assignment mutations stay
 *  `library:manage`-only — this gate is for the circulation desk. */
export async function assertIsLibrarian(ctx: AppContext): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (roleHasPermission(ctx.auth.role as Role, "library:manage")) return;
  if (ctx.auth.role === "TEACHER" && (await isAssignedLibrarian(ctx.auth.userId))) return;
  throw new ForbiddenError("শুধুমাত্র লাইব্রেরিয়ান এই কাজটি করতে পারেন");
}

/** Assign the librarian duty to a TEACHER (append-only; audited). */
export async function assignLibrarian(
  teacherUserId: string,
  actorId: string,
): Promise<ILibrarianAssignment> {
  const teacher = await User.findById(teacherUserId).lean();
  if (!teacher || !teacher.active) throw new LibraryError("শিক্ষক অ্যাকাউন্টটি পাওয়া যায়নি বা সক্রিয় নয়");
  if (teacher.role !== "TEACHER") {
    // Principal/Office already hold library:manage — the duty log is for teachers only (D-#81).
    throw new LibraryError("লাইব্রেরিয়ান দায়িত্ব শুধুমাত্র একজন শিক্ষককে দেওয়া যায়");
  }
  if (await isAssignedLibrarian(teacherUserId)) {
    throw new LibraryError("এই শিক্ষক ইতিমধ্যে লাইব্রেরিয়ান হিসেবে নিযুক্ত আছেন");
  }
  const row = await LibrarianAssignment.create({
    userId: teacherUserId,
    action: "assign",
    actorId,
    at: new Date(),
  });
  await writeAudit({
    eventKind: "LIBRARIAN_ASSIGNED",
    actorId,
    targetId: teacherUserId,
    targetKind: "User",
    meta: { action: "assign" },
  });
  return row;
}

/** Revoke the duty (appends a `revoke` row — history preserved, ADR-008). */
export async function revokeLibrarian(
  teacherUserId: string,
  actorId: string,
): Promise<ILibrarianAssignment> {
  if (!(await isAssignedLibrarian(teacherUserId))) {
    throw new LibraryError("এই শিক্ষক বর্তমানে লাইব্রেরিয়ান হিসেবে নিযুক্ত নন");
  }
  const row = await LibrarianAssignment.create({
    userId: teacherUserId,
    action: "revoke",
    actorId,
    at: new Date(),
  });
  await writeAudit({
    eventKind: "LIBRARIAN_ASSIGNED",
    actorId,
    targetId: teacherUserId,
    targetKind: "User",
    meta: { action: "revoke" },
  });
  return row;
}

/** Full duty history, newest first. */
export async function librarianHistory(): Promise<ILibrarianAssignment[]> {
  return LibrarianAssignment.find({})
    .sort({ at: -1, _id: -1 })
    .lean() as unknown as ILibrarianAssignment[];
}

/** UserIds whose latest row is `assign` (the current librarian-teachers). */
export async function currentLibrarianIds(): Promise<string[]> {
  const rows = (await LibrarianAssignment.find({})
    .sort({ at: 1, _id: 1 })
    .lean()) as unknown as Array<{ userId: { toString(): string }; action: string }>;
  const latest = new Map<string, string>();
  for (const r of rows) latest.set(r.userId.toString(), r.action);
  return [...latest.entries()].filter(([, action]) => action === "assign").map(([id]) => id);
}
