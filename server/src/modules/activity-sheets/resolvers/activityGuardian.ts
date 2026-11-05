/**
 * Activity sheets — guardian choose, morning batch, hand-out (AS-3, D-#988/#991).
 *   - activityChoices / requestActivitySheet / cancelActivityRequest: `guardian:read_child`
 *     + the link check (assertGuardianOfStudent).
 *   - childActivitySheets: the guardian (linked) or staff with activity_sheets:view.
 *   - activityRequests / printActivityBatch: `activity_sheets:manage` (Office, morning print).
 *   - activityHandOutRoster / activityHandOut: `activity_sheets:issue` (office: every section)
 *     or `activity_sheets:check` (a class teacher: their own sections only).
 * The batch PDF is REST: GET /files/activity-print?runId=batch-… (names + cover slips).
 */
import { assertGuardianFeature } from "../../guardian-access/services/GuardianFeatureService";
import { callerHasPermission } from "@scd/shared";
import { builder } from "../../../schema";
import { ForbiddenError, assertGuardianOfStudent } from "../../../middleware/authz";
import {
  activityChoices,
  cancelRequest,
  childSheets,
  handOut,
  handOutRoster,
  pendingRequests,
  printBatch,
  requestSheet,
  type BatchRow,
  type ChildSheetRow,
  type ChoiceBank,
  type ChoiceLevel,
  type ChoicesView,
} from "../services/ActivityGuardianService";
import { ActivityIssueRef } from "./activityCorner";

const ChoiceLevelRef = builder.objectRef<ChoiceLevel>("ActivityChoiceLevel");
ChoiceLevelRef.implement({
  fields: (t) => ({
    level: t.exposeString("level"),
    sheetCount: t.exposeInt("sheetCount"),
    doneByChild: t.exposeInt("doneByChild"),
    sampleFileIds: t.stringList({ resolve: (v) => v.sampleFileIds.map((x) => x.toString()) }),
  }),
});

const ChoiceBankRef = builder.objectRef<ChoiceBank>("ActivityChoiceBank");
ChoiceBankRef.implement({
  fields: (t) => ({
    bankId: t.string({ resolve: (v) => v.bank._id.toString() }),
    code: t.string({ resolve: (v) => v.bank.code }),
    nameBn: t.string({ resolve: (v) => v.bank.nameBn }),
    nameEn: t.string({ nullable: true, resolve: (v) => v.bank.nameEn ?? null }),
    skillArea: t.string({ resolve: (v) => v.bank.skillArea }),
    levels: t.field({ type: [ChoiceLevelRef], resolve: (v) => v.levels }),
  }),
});

const ChoicesRef = builder.objectRef<ChoicesView>("ActivityChoices");
ChoicesRef.implement({
  description: "What a guardian may choose for their child: banks suiting the child's class, and the limits (D-#991).",
  fields: (t) => ({
    banks: t.field({ type: [ChoiceBankRef], resolve: (v) => v.banks }),
    weeklyLimit: t.exposeInt("weeklyLimit"),
    usedThisWeek: t.exposeInt("usedThisWeek"),
    maxOpen: t.exposeInt("maxOpen"),
    open: t.exposeInt("open"),
  }),
});

const ChildSheetRef = builder.objectRef<ChildSheetRow>("ActivityChildSheet");
ChildSheetRef.implement({
  description: "One sheet a child had: which, how it came, where it is, how it came back.",
  fields: (t) => ({
    issue: t.field({ type: ActivityIssueRef, resolve: (v) => v.issue }),
    itemId: t.string({ resolve: (v) => v.sheet.itemId }),
    level: t.string({ resolve: (v) => v.sheet.level }),
    bankId: t.string({ resolve: (v) => v.bank._id.toString() }),
    bankNameBn: t.string({ resolve: (v) => v.bank.nameBn }),
    skillArea: t.string({ resolve: (v) => v.bank.skillArea }),
    hasAnswer: t.boolean({ resolve: (v) => !!v.sheet.answerPage && !!v.bank.answerFileId }),
  }),
});

const BatchRowRef = builder.objectRef<BatchRow>("ActivityBatchRow");
BatchRowRef.implement({
  fields: (t) => ({
    issue: t.field({ type: ActivityIssueRef, resolve: (v) => v.issue }),
    studentName: t.exposeString("studentName"),
    classLevel: t.int({ nullable: true, resolve: (v) => v.classLevel }),
    sectionNameBn: t.string({ nullable: true, resolve: (v) => v.sectionNameBn }),
    itemId: t.exposeString("itemId"),
    bankNameBn: t.exposeString("bankNameBn"),
  }),
});

const BatchRunRef = builder.objectRef<{ runId: string; sheets: number }>("ActivityBatchRun");
BatchRunRef.implement({ fields: (t) => ({ runId: t.exposeString("runId"), sheets: t.exposeInt("sheets") }) });

// ---------------------------------------------------------------------------

builder.queryField("activityChoices", (t) =>
  t.field({
    type: ChoicesRef,
    description: "Banks + levels a guardian can choose for their child, with the week's limit (A1).",
    authScopes: { hasPermission: "guardian:read_child" },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      await assertGuardianFeature(ctx, "ACTIVITY_SHEETS");
      return activityChoices(args.studentId);
    },
  }),
);

builder.queryField("childActivitySheets", (t) =>
  t.field({
    type: [ChildSheetRef],
    description: "A child's activity sheets, newest first: open, back, how they did (A3).",
    authScopes: { hasAnyPermission: ["guardian:read_child", "activity_sheets:view"] },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!callerHasPermission(ctx.auth!, "activity_sheets:view")) await assertGuardianOfStudent(ctx, args.studentId);
      await assertGuardianFeature(ctx, "ACTIVITY_SHEETS");
      return childSheets(args.studentId);
    },
  }),
);

builder.mutationField("requestActivitySheet", (t) =>
  t.field({
    type: ActivityIssueRef,
    description: "A guardian asks for the next sheet of a bank + level for their child (printed with the name next morning).",
    authScopes: { hasPermission: "guardian:read_child" },
    args: { studentId: t.arg.string({ required: true }), bankId: t.arg.string({ required: true }), level: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertGuardianFeature(ctx, "ACTIVITY_SHEETS");
      return requestSheet(ctx, args.studentId, args.bankId, args.level);
    },
  }),
);

builder.mutationField("cancelActivityRequest", (t) =>
  t.field({
    type: ActivityIssueRef,
    description: "Withdraw a request before it is printed.",
    authScopes: { hasPermission: "guardian:read_child" },
    args: { issueId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertGuardianFeature(ctx, "ACTIVITY_SHEETS");
      return cancelRequest(ctx, args.issueId);
    },
  }),
);

builder.queryField("activityRequests", (t) =>
  t.field({
    type: [BatchRowRef],
    description: "Guardian requests waiting for the morning print (A8).",
    authScopes: { hasPermission: "activity_sheets:manage" },
    resolve: async () => pendingRequests(),
  }),
);

builder.mutationField("printActivityBatch", (t) =>
  t.field({
    type: BatchRunRef,
    description: "Print every waiting request (or the chosen ones) with the child's name; open the PDF by runId.",
    authScopes: { hasPermission: "activity_sheets:manage" },
    args: { issueIds: t.arg.stringList({ required: false }) },
    resolve: async (_root, args, ctx) => printBatch(args.issueIds ?? null, ctx.auth!.userId),
  }),
);

builder.queryField("activityHandOutRoster", (t) =>
  t.field({
    type: [BatchRowRef],
    description: "Printed sheets to hand out: a class teacher's own sections, or every section for the office.",
    authScopes: { hasAnyPermission: ["activity_sheets:issue", "activity_sheets:check"] },
    resolve: async (_root, _args, ctx) => handOutRoster(ctx),
  }),
);

builder.mutationField("activityHandOut", (t) =>
  t.int({
    description: "Mark printed sheets as handed to the children (roster tap). Returns how many.",
    authScopes: { hasAnyPermission: ["activity_sheets:issue", "activity_sheets:check"] },
    args: { issueIds: t.arg.stringList({ required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("অনুমতি নেই");
      return handOut(ctx, args.issueIds);
    },
  }),
);
