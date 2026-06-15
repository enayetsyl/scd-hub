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

const GuardianJuzMistakesRef = builder.objectRef<GuardianRevisionEntry["juzRecords"][number]["mistakes"]>(
  "GuardianRevisionJuzMistakes",
);
GuardianJuzMistakesRef.implement({
  fields: (t) => ({
    harf: t.exposeInt("harf"),
    ghunnah: t.exposeInt("ghunnah"),
    madd: t.exposeInt("madd"),
    other: t.exposeInt("other"),
  }),
});

const GuardianJuzRecordRef = builder.objectRef<GuardianRevisionEntry["juzRecords"][number]>("GuardianRevisionJuzRecord");
GuardianJuzRecordRef.implement({
  fields: (t) => ({
    juz: t.exposeInt("juz"),
    category: t.exposeString("category"),
    amountJuz: t.exposeFloat("amountJuz"),
    tanbih: t.exposeInt("tanbih"),
    fath: t.exposeInt("fath"),
    mistakes: t.field({ type: GuardianJuzMistakesRef, resolve: (r) => r.mistakes }),
    note: t.string({ nullable: true, resolve: (r) => r.note }),
  }),
});

const GuardianRevisionEntryRef = builder.objectRef<GuardianRevisionEntry>("GuardianRevisionEntry");
GuardianRevisionEntryRef.implement({
  description:
    "A linked child's DELIVERED Saturday revision entry — read-only (SR-4, J-SR4-4). Staff fields " +
    "(teacherUserId / deliveryChannels) are structurally absent. Identity plane (ADR-005).",
  fields: (t) => ({
    id: t.exposeString("id"),
    date: t.exposeString("date"),
    present: t.exposeBoolean("present"),
    juzRecords: t.field({ type: [GuardianJuzRecordRef], resolve: (r) => r.juzRecords }),
    teacherComment: t.string({ nullable: true, resolve: (r) => r.teacherComment }),
    deliveredAt: t.exposeString("deliveredAt"),
  }),
});

builder.queryField("childRevision", (t) =>
  t.field({
    type: [GuardianRevisionEntryRef],
    description:
      "The linked child's DELIVERED Saturday revision entries, newest first — read-only (SR-4, J-SR4-4). " +
      "Gated by the guardian-link row scope (D-#68); delivered-only (D-#155).",
    authScopes: { hasPermission: "guardian:read_child" },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      return childRevision(args.studentId);
    },
  }),
);
