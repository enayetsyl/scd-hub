/**
 * Guardian child-vocab rider (VC-4; prd-vocabulary-tracker §6/J7, D-#68/#155).
 *
 * ONE read query: a linked guardian sees their child's vocab results, read-only, and
 * ONLY from `marked` tests (vocab has no separate publish step — marking IS the
 * guardian-release boundary, D-#155). RBAC: `guardian:read_child` (GUARDIAN-only,
 * default-deny) + row-scope `assertGuardianOfStudent` (active GuardianLink, D-#68).
 * Guardians get NO vocab mutation. Identity-plane; NO corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import { assertGuardianOfStudent } from "../../../middleware/authz";
import { childVocab, type ChildVocabResult } from "../services/VocabSummaryService";
import { DerivedStudentResultRef } from "./vocabResult";

const ChildVocabResultRef = builder.objectRef<ChildVocabResult>("ChildVocabResult");
ChildVocabResultRef.implement({
  description: "A child's vocab test result as the guardian portal shows it — read-only (VC-4, J7).",
  fields: (t) => ({
    testId: t.string({ resolve: (v) => v.test.testId }),
    program: t.string({ resolve: (v) => v.test.program }),
    label: t.string({ resolve: (v) => v.test.label }),
    testDate: t.string({ resolve: (v) => v.test.testDate }),
    classLevel: t.int({ resolve: (v) => v.test.classLevel }),
    result: t.field({ type: DerivedStudentResultRef, resolve: (v) => v.result }),
  }),
});

builder.queryField("childVocab", (t) =>
  t.field({
    type: [ChildVocabResultRef],
    description:
      "The linked child's vocab results — read-only, marked tests only (VC-4, J7). Gated by the " +
      "guardian-link row scope (D-#68/#155). No mutations exist for guardians.",
    authScopes: { hasPermission: "guardian:read_child" },
    args: {
      studentId: t.arg.string({ required: true }),
      program: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      return childVocab(args.studentId, { program: args.program ?? null });
    },
  }),
);
