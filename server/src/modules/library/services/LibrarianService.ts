import { callerHasPermission, type Permission } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { LibrarianAssignment, type ILibrarianAssignment } from "../models/LibrarianAssignment";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
import { LibraryError } from "../errors";

/**
 * The librarian desk gate (prd-library §5, D-#81 — the D-#42/#64 duty
 * pattern, NO new role; PM catalogue D-#790–#801): the caller must hold the
 * desk ACTION (`library:lend` / `library:return` / `library:remind`) AND either
 * hold `library:edit_all` ("run the desk without a duty" — Principal/Office by
 * default, the old `library:manage` branch) or be an actively-assigned librarian
 * (their LATEST `LibrarianAssignment` row is `assign`). Everyone else (incl. an
 * unassigned teacher and any guardian) is denied with a Bangla message.
 */

/** The desk actions the librarian designation qualifies. */
export type LibraryDeskAction = Extract<Permission, "library:lend" | "library:return" | "library:remind">;

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

/** May the caller run the desk for `action`? The action (role default or per-person
 *  grant) AND (`library:edit_all` OR the librarian duty). The old `role === "TEACHER"`
 *  conjunct is dropped — the duty can only be assigned to a teacher anyway. */
export async function canRunLibraryDesk(
  ctx: AppContext,
  action: LibraryDeskAction = "library:lend",
): Promise<boolean> {
  if (!ctx.auth) return false;
  if (!callerHasPermission(ctx.auth, action)) return false;
  if (callerHasPermission(ctx.auth, "library:edit_all")) return true;
  return isAssignedLibrarian(ctx.auth.userId);
}

/** Assert the caller may run DESK OPERATIONS (issue/return/renew/lost/holds,
 *  desk reservations, the overdue chase). Catalog/policy/assignment mutations
 *  are their own actions (`library:edit` / `:settings` / `:assign`) — this gate
 *  is for the circulation desk. */
export async function assertIsLibrarian(
  ctx: AppContext,
  action: LibraryDeskAction = "library:lend",
): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (await canRunLibraryDesk(ctx, action)) return;
  throw new ForbiddenError("শুধুমাত্র লাইব্রেরিয়ান এই কাজটি করতে পারেন");
}

/** Assign the librarian duty to a TEACHER (append-only; audited). */
export async function assignLibrarian(
  teacherUserId: string,
  actorId: string,
): Promise<ILibrarianAssignment> {
  const teacher = await User.findById(teacherUserId).lean();
  if (!teacher || !teacher.active) throw new LibraryError("শিক্ষক অ্যাকাউন্টটি পাওয়া যায়নি বা সক্রিয় নয়");
  // PM: the target must hold `library:lend` (the action the duty qualifies). The
  // TEACHER-role conjunct stays so ship day changes nobody's access: Principal/Office
  // hold `library:lend` + `library:edit_all` by default and already run the desk
  // without a duty — the duty log is for teachers only (D-#81).
  if (
    teacher.role !== "TEACHER" ||
    !callerHasPermission(
      {
        role: teacher.role,
        additionalTemplates: teacher.additionalTemplates ?? [],
        grantedPermissions: teacher.grantedPermissions ?? [],
        revokedPermissions: teacher.revokedPermissions ?? [],
      },
      "library:lend",
    )
  ) {
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
