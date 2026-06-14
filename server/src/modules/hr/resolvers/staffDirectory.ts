/**
 * StaffDirectory resolver (HR-G2, prd-hr §H8.2/H8.3, D-#216/#217).
 *
 * `staffDirectory(observableOnly: Boolean = false, category: String)` → a PII-free
 * `StaffDirectoryEntry { id, name, nameBn, designation, category }` (a distinct shape
 * that STRUCTURALLY omits every sensitive/bio field — the CT-3 GuardianClassTestResult
 * precedent). Unblocks the H5.2 supervisor observation picker + the chat staff-list.
 *
 * Gate = `authenticated: true`, **GUARDIAN rejected in-resolver** (staff-internal;
 * guardians are a walled login plane, ADR-005). **NO new permission** — the staff
 * analog of the student roster: reading "who works here, by name + role" is discovery;
 * the capability (`submitObservation`) stays scope-gated. observableOnly:true narrows to
 * the caller's supervisory-covered teachers (Principal/Office get all); the set logic +
 * the fail-closed phone-join live in `StaffDirectoryService`.
 *
 * Identity plane only; NO corpus path (ADR-005) — a non-mutating read, so no audit kind.
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import { callerHasPermission } from "@scd/shared";
import type { AppContext } from "../../../context";
import { listStaffDirectory, type StaffDirectoryEntryShape } from "../services/StaffDirectoryService";

const StaffDirectoryEntryRef = builder.objectRef<StaffDirectoryEntryShape>("StaffDirectoryEntry");
StaffDirectoryEntryRef.implement({
  description:
    "A PII-free staff directory entry (HR-G2) — name + designation + category only. " +
    "STRUCTURALLY omits every H1.4 sensitive row and all personal bio/contact; the full " +
    "record stays on the `staff` query (staff:manage).",
  fields: (t) => ({
    id: t.exposeString("id"),
    name: t.exposeString("name"),
    nameBn: t.exposeString("nameBn", { nullable: true }),
    designation: t.exposeString("designation", { nullable: true }),
    category: t.exposeString("category"),
  }),
});

/** Principal/Office reach (everyone, both modes) — the H8.3 `performance:manage`/`staff:manage` gate. */
function isManager(ctx: AppContext): boolean {
  return (
    ctx.auth !== null &&
    (callerHasPermission(ctx.auth, "performance:manage") || callerHasPermission(ctx.auth, "staff:manage"))
  );
}

builder.queryField("staffDirectory", (t) =>
  t.field({
    type: [StaffDirectoryEntryRef],
    description:
      "PII-free staff directory (HR-G2). observableOnly:false → every active staff member " +
      "(discovery; any non-Guardian staff caller). observableOnly:true → only the staff the " +
      "caller may observe (Principal/Office all; a bounded supervisor → their supervisory-" +
      "covered teachers, fail-closed phone-join). GUARDIAN denied. No new permission.",
    authScopes: { authenticated: true },
    args: {
      observableOnly: t.arg.boolean({ required: false, defaultValue: false }),
      category: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      if (ctx.auth.role === "GUARDIAN") {
        // The directory is staff-internal — guardians are a walled login plane (ADR-005, J-AC4).
        throw new ForbiddenError("স্টাফ ডিরেক্টরি দেখার অনুমতি নেই");
      }
      return listStaffDirectory({
        callerUserId: ctx.auth.userId,
        isManage: isManager(ctx),
        observableOnly: args.observableOnly ?? false,
        category: args.category ?? null,
      });
    },
  }),
);
