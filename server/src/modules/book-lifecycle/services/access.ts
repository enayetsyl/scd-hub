/**
 * Book-lifecycle gates (docs/prd-book-lifecycle.md §7, D-#1596). Services re-check their own
 * action on the caller's AuthPayload: resolvers gate declaratively too, but the MCP tools and the
 * upload routes call these services directly, so the service is the gate that cannot be skipped.
 */
import { Types } from "mongoose";
import { callerHasPermission, type Permission } from "@scd/shared";
import type { AuthPayload } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { isBookDbReady } from "../../../bookDb";
import { BookLcError } from "./errors";

export type BookLcAction = "view" | "manage" | "finalize" | "release" | "ai_edit" | "teacher_view" | "report";

export const BOOK_LC_FORBIDDEN_BN = "এই কাজের অনুমতি নেই";

export function canBookLc(auth: AuthPayload | null | undefined, action: BookLcAction): boolean {
  if (!auth || auth.role === "GUARDIAN") return false;
  return callerHasPermission(auth, `book_lifecycle:${action}` as Permission);
}

/** Throws ForbiddenError unless the caller holds `book_lifecycle:<action>`. Guardians never pass. */
export function requireBookLc(auth: AuthPayload | null | undefined, action: BookLcAction): AuthPayload {
  if (!auth || !canBookLc(auth, action)) throw new ForbiddenError(`${BOOK_LC_FORBIDDEN_BN} (book_lifecycle:${action})`);
  return auth;
}

/** The book plane is optional at boot (D-#404): answer plainly instead of hanging. */
export function assertBookPlane(): void {
  if (!isBookDbReady()) throw new ForbiddenError("বই-ডেটাবেস কনফিগার করা হয়নি (BOOK_MONGODB_URI)");
}

export function uid(auth: AuthPayload): Types.ObjectId {
  return new Types.ObjectId(auth.userId);
}

export function oid(id: string | Types.ObjectId, what = "id"): Types.ObjectId {
  if (id instanceof Types.ObjectId) return id;
  if (!Types.ObjectId.isValid(id)) throw new BookLcError("BAD_ID", `ভুল ${what}`);
  return new Types.ObjectId(id);
}

/** Passes when the caller holds ANY of these actions (an Office login with only `release` may read
 *  the book header, versions list and the release / errata lists it works on). */
export function requireBookLcAny(auth: AuthPayload | null | undefined, actions: BookLcAction[]): AuthPayload {
  if (!auth || !actions.some((a) => canBookLc(auth, a))) throw new ForbiddenError(`${BOOK_LC_FORBIDDEN_BN} (${actions.map((a) => `book_lifecycle:${a}`).join(" / ")})`);
  return auth;
}
