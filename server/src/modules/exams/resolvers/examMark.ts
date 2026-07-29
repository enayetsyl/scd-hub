/**
 * Mark-entry resolvers — EX-3 (docs/prd-exams.md §6, D-#377/#378).
 *
 * Two gates stack here and BOTH must pass:
 *   1. `exam:mark` + an ExamAssignment CHECKER row for THIS paper (EX-2). The flat
 *      permission grants nothing on its own.
 *   2. For ADAB only — the caller must be the routine's subject teacher (§9.6).
 * Office/Principal (`exam:manage`) bypass both; someone has to be able to fix a record.
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import { callerHasPermission, EXAM_COMPONENTS, MARK_ENTRY_STATUSES } from "@scd/shared";
import type { AppContext } from "../../../context";
import {
  enterMarks,
  proposeCtMarks,
  applyCtPull,
  marksForPaper,
  componentValueOf,
  entryScaleFor,
  assertCanEnterComponent,
  type MarkEntryInput,
} from "../services/ExamMarkService";
import { ExamError } from "../services/ExamService";
import { assertAssignedTo } from "../services/ExamAssignmentService";
import { ExamPaper } from "../models/ExamPaper";
import type { IExamMark } from "../models/ExamMark";

const isManager = (ctx: AppContext): boolean =>
  ctx.auth !== null && callerHasPermission(ctx.auth, "exam:manage");

function assertExamReader(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(ctx.auth, "exam:read")) {
    throw new ForbiddenError("পরীক্ষার তথ্য দেখার অনুমতি নেই");
  }
}

/** `exam:mark` + assignment, unless the caller manages exams. */
async function assertMarker(ctx: AppContext, paperId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (isManager(ctx)) return;
  if (!callerHasPermission(ctx.auth, "exam:mark")) {
    throw new ForbiddenError("খাতা মূল্যায়নের অনুমতি নেই");
  }
  try {
    await assertAssignedTo(paperId, ctx.auth.userId, ["CHECKER"]);
  } catch (err) {
    if (err instanceof ExamError) throw new ForbiddenError(err.message);
    throw err;
  }
}

function rethrow(err: unknown): never {
  if (err instanceof ExamError) throw new ForbiddenError(err.message);
  throw err;
}

interface MarkView {
  doc: IExamMark;
  /** The component-scale value — DERIVED here, never stored (D-#85). */
  componentValue: number;
  entryScale: number | null;
}

const ExamMarkRef = builder.objectRef<MarkView>("ExamMark");
ExamMarkRef.implement({
  description:
    "One student's mark for ONE component. `rawMark` is on the ENTRY scale (FINAL = the " +
    "script's own full marks); `componentValue` is the derived, nearest-0.5 value that " +
    "reaches the report card. ABSENT contributes 0 but prints \"Ab\".",
  fields: (t) => ({
    id: t.string({ resolve: (v) => v.doc._id.toString() }),
    paperId: t.string({ resolve: (v) => v.doc.paperId.toString() }),
    studentId: t.string({ resolve: (v) => v.doc.studentId.toString() }),
    component: t.string({ resolve: (v) => v.doc.component }),
    status: t.string({ resolve: (v) => v.doc.status }),
    rawMark: t.float({ nullable: true, resolve: (v) => v.doc.rawMark ?? null }),
    entryScale: t.float({ nullable: true, resolve: (v) => v.entryScale }),
    componentValue: t.float({ resolve: (v) => v.componentValue }),
    source: t.string({ resolve: (v) => v.doc.source }),
    overrideReason: t.string({ nullable: true, resolve: (v) => v.doc.overrideReason ?? null }),
    recheckRawMark: t.float({ nullable: true, resolve: (v) => v.doc.recheckRawMark ?? null }),
    resolvedRawMark: t.float({ nullable: true, resolve: (v) => v.doc.resolvedRawMark ?? null }),
  }),
});

const CtProposalRef = builder.objectRef<{
  studentId: string; value: number | null; testsCounted: number; mode: string; bestN: number;
}>("ExamCtProposal");
CtProposalRef.implement({
  description:
    "A proposed CT mark pulled from the class-test tracker. `value` is NULL when the " +
    "student has no class-test history — blank, never 0 (D-#378).",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    value: t.float({ nullable: true, resolve: (p) => p.value }),
    testsCounted: t.exposeInt("testsCounted"),
    mode: t.exposeString("mode"),
    bestN: t.exposeInt("bestN"),
  }),
});

builder.queryField("examMarks", (t) =>
  t.field({
    type: [ExamMarkRef],
    description: "Every stored mark on a paper, with the derived component value.",
    authScopes: { authenticated: true },
    args: { paperId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertExamReader(ctx);
      const paper = await ExamPaper.findById(args.paperId);
      if (!paper) throw new ForbiddenError("বিষয়পত্র পাওয়া যায়নি");
      const rows = await marksForPaper(args.paperId);
      return rows.map((doc) => ({
        doc,
        componentValue: componentValueOf(doc, paper),
        entryScale: entryScaleFor(paper, doc.component),
      }));
    },
  }),
);

builder.queryField("examCtProposals", (t) =>
  t.field({
    type: [CtProposalRef],
    description:
      "What a CT pull WOULD write, without writing it — shown beside the manual field so " +
      "the checker can see which rule produced the number (D-#378).",
    authScopes: { authenticated: true },
    args: { paperId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertExamReader(ctx);
      try {
        return await proposeCtMarks(args.paperId);
      } catch (err) { rethrow(err); }
    },
  }),
);

builder.mutationField("enterExamMarks", (t) =>
  t.field({
    type: [ExamMarkRef],
    description:
      "Enter/replace the checker's marks for a paper, one entry per student × component. " +
      "Requires an ExamAssignment CHECKER row for this paper (or exam:manage). ADAB " +
      "additionally requires the caller to be the routine's subject teacher. Audited.",
    authScopes: { authenticated: true },
    args: {
      paperId: t.arg.string({ required: true }),
      studentIds: t.arg.stringList({ required: true }),
      components: t.arg.stringList({ required: true }),
      statuses: t.arg.stringList({ required: true }),
      rawMarks: t.arg.floatList({ required: false }),
      overrideReason: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      await assertMarker(ctx, args.paperId);

      const n = args.studentIds.length;
      if (args.components.length !== n || args.statuses.length !== n) {
        throw new ForbiddenError("শিক্ষার্থী, অংশ ও উপস্থিতির সংখ্যা মিলছে না");
      }
      if (args.rawMarks && args.rawMarks.length !== n) {
        throw new ForbiddenError("নম্বরের সংখ্যা মিলছে না");
      }
      for (const c of args.components) {
        if (!EXAM_COMPONENTS.includes(c as never)) throw new ForbiddenError(`অজানা অংশ: ${c}`);
      }
      for (const s of args.statuses) {
        if (!MARK_ENTRY_STATUSES.includes(s as never)) throw new ForbiddenError(`অজানা উপস্থিতি: ${s}`);
      }

      const paper = await ExamPaper.findById(args.paperId);
      if (!paper) throw new ForbiddenError("বিষয়পত্র পাওয়া যায়নি");

      // The ADAB gate, once per distinct component in the batch.
      for (const component of new Set(args.components)) {
        try {
          await assertCanEnterComponent(paper, component as never, ctx.auth!.userId, isManager(ctx));
        } catch (err) { rethrow(err); }
      }

      const entries: MarkEntryInput[] = args.studentIds.map((studentId, i) => ({
        studentId,
        component: args.components[i] as never,
        status: args.statuses[i] as never,
        rawMark: args.rawMarks?.[i] ?? null,
        overrideReason: args.overrideReason ?? null,
      }));

      try {
        const rows = await enterMarks(args.paperId, entries, ctx.auth!.userId);
        return rows.map((doc) => ({
          doc,
          componentValue: componentValueOf(doc, paper),
          entryScale: entryScaleFor(paper, doc.component),
        }));
      } catch (err) { rethrow(err); }
    },
  }),
);

builder.mutationField("applyExamCtPull", (t) =>
  t.int({
    description:
      "Write the CT proposals as marks. Students with no class-test history are SKIPPED, " +
      "never zeroed; an existing MANUAL value is never clobbered. Returns rows written.",
    authScopes: { authenticated: true },
    args: { paperId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertMarker(ctx, args.paperId);
      try {
        return await applyCtPull(args.paperId, ctx.auth!.userId);
      } catch (err) { rethrow(err); }
    },
  }),
);
