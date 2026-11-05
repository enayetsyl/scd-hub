/**
 * Activity sheets — check & follow-up (AS-4, D-#988/#991).
 *   - activityAnswerImage: the guardian (linked; the sheet must be back) or staff (view).
 *   - activityLevelUpHints / activityToday: the guardian (linked) or staff (view).
 *   - activityStickersOwed / giveActivityStickers: a class teacher's own sections
 *     (activity_sheets:check) or every section (activity_sheets:issue).
 */
import { callerHasPermission } from "@scd/shared";
import { builder } from "../../../schema";
import { assertGuardianOfStudent } from "../../../middleware/authz";
import type { AppContext } from "../../../context";
import {
  activityToday,
  answerImage,
  giveOwedStickers,
  levelUpHints,
  stickersOwed,
  type ActivityToday,
  type LevelUpHint,
  type OwedRow,
} from "../services/ActivityFollowUpService";
import { ActivityIssueRef } from "./activityCorner";

async function childGate(ctx: AppContext, studentId: string): Promise<void> {
  if (!callerHasPermission(ctx.auth!, "activity_sheets:view")) await assertGuardianOfStudent(ctx, studentId);
}

const HintRef = builder.objectRef<LevelUpHint>("ActivityLevelUpHint");
HintRef.implement({
  description: "Enough সব ঠিক at one level → a harder level suiting the child's class is worth a try.",
  fields: (t) => ({
    bankId: t.exposeString("bankId"),
    bankNameBn: t.exposeString("bankNameBn"),
    from: t.exposeString("from"),
    to: t.exposeString("to"),
  }),
});

const LatestRef = builder.objectRef<NonNullable<ActivityToday["latest"]>>("ActivityTodayLatest");
LatestRef.implement({
  fields: (t) => ({
    issue: t.field({ type: ActivityIssueRef, resolve: (v) => v.issue }),
    bankNameBn: t.exposeString("bankNameBn"),
    itemId: t.exposeString("itemId"),
  }),
});

const TodayRef = builder.objectRef<ActivityToday>("ActivityToday");
TodayRef.implement({
  description: "The guardian Today card: open sheets, the latest checked one (7 days), a hint, owed stickers.",
  fields: (t) => ({
    open: t.exposeInt("open"),
    latest: t.field({ type: LatestRef, nullable: true, resolve: (v) => v.latest }),
    hint: t.field({ type: HintRef, nullable: true, resolve: (v) => v.hint }),
    owed: t.exposeInt("owed"),
    doneThisMonth: t.exposeInt("doneThisMonth"),
  }),
});

const OwedRef = builder.objectRef<OwedRow>("ActivityOwedSticker");
OwedRef.implement({
  fields: (t) => ({
    issue: t.field({ type: ActivityIssueRef, resolve: (v) => v.issue }),
    studentName: t.exposeString("studentName"),
    classLevel: t.int({ nullable: true, resolve: (v) => v.classLevel }),
    sectionNameBn: t.string({ nullable: true, resolve: (v) => v.sectionNameBn }),
    bankNameBn: t.exposeString("bankNameBn"),
  }),
});

builder.queryField("activityAnswerImage", (t) =>
  t.string({
    description: "A returned sheet's answer page as a JPEG data URI (guardian: only after it came back).",
    authScopes: { hasAnyPermission: ["guardian:read_child", "activity_sheets:view"] },
    args: { issueId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => answerImage(ctx, args.issueId),
  }),
);

builder.queryField("activityLevelUpHints", (t) =>
  t.field({
    type: [HintRef],
    authScopes: { hasAnyPermission: ["guardian:read_child", "activity_sheets:view"] },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await childGate(ctx, args.studentId);
      return levelUpHints(args.studentId);
    },
  }),
);

builder.queryField("activityToday", (t) =>
  t.field({
    type: TodayRef,
    authScopes: { hasAnyPermission: ["guardian:read_child", "activity_sheets:view"] },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await childGate(ctx, args.studentId);
      return activityToday(args.studentId);
    },
  }),
);

builder.queryField("activityStickersOwed", (t) =>
  t.field({
    type: [OwedRef],
    description: "Stickers owed for sheets returned through the box (a class teacher: their own sections).",
    authScopes: { hasAnyPermission: ["activity_sheets:issue", "activity_sheets:check"] },
    resolve: async (_root, _args, ctx) => stickersOwed(ctx),
  }),
);

builder.mutationField("giveActivityStickers", (t) =>
  t.int({
    description: "Tick off owed stickers handed over. Returns how many.",
    authScopes: { hasAnyPermission: ["activity_sheets:issue", "activity_sheets:check"] },
    args: { issueIds: t.arg.stringList({ required: true }) },
    resolve: async (_root, args, ctx) => giveOwedStickers(ctx, args.issueIds),
  }),
);
