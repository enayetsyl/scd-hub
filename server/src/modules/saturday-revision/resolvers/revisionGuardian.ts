/**
 * Saturday-Revision guardian read (SR-4 guardian card, prd-sr4 §2/§4, D-#68/#155).
 *
 * The linked child's DELIVERED revision entries — read-only, structurally omitting the
 * staff fields (teacherUserId, deliveryChannels). Gated `guardian:read_child` +
 * `assertGuardianOfStudent` (the guardian-link row scope, D-#68); delivered-only is the
 * guardian-release boundary (D-#155). The matching staff reads live in SR-1/SR-3.
 *
 * Note: SR-2 deferred this guardian read to "SR-4's guardian card" (prd-sr2 §2); it
 * ships here so the module is complete server + app. Identity plane; no corpus path.
 */
import { builder } from "../../../schema";
import { assertGuardianOfStudent } from "../../../middleware/authz";
import { childRevision, type GuardianRevisionEntry } from "../services/RevisionService";
import { RevisionPortionRef } from "./revision";

const GuardianRevisionEntryRef = builder.objectRef<GuardianRevisionEntry>("GuardianRevisionEntry");
GuardianRevisionEntryRef.implement({
  description:
    "A linked child's DELIVERED Saturday revision entry — read-only (SR-4, J-SR4-4). Staff fields " +
    "(teacherUserId / deliveryChannels) are structurally absent. Identity plane (ADR-005).",
  fields: (t) => ({
    id: t.exposeString("id"),
    date: t.exposeString("date"),
    present: t.exposeBoolean("present"),
    portions: t.field({ type: [RevisionPortionRef], resolve: (r) => r.portions }),
    teacherComment: t.string({ nullable: true, resolve: (r) => r.teacherComment }),
    deliveredAt: t.exposeString("deliveredAt"),
  }),
});

builder.queryField("childRevision", (t) =>
  t.field({
    type: [GuardianRevisionEntryRef],
    description:
      "The linked child's DELIVERED Saturday revision entries, newest first — read-only (SR-4, J-SR4-4). " +
      "Gated by the guardian-link row scope (D-#68); delivered-only (D-#155). limit (D-#761) = the " +
      "newest N only; omitted = the whole history, as before.",
    authScopes: { hasPermission: "guardian:read_child" },
    args: { studentId: t.arg.string({ required: true }), limit: t.arg.int({ required: false }) },
    resolve: async (_root, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      return childRevision(args.studentId, args.limit);
    },
  }),
);
