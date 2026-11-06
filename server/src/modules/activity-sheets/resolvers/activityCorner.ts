/**
 * Activity corner resolvers (AS-2, D-#988): trays, stock print runs, desk take / return.
 *   - Trays + desk lookups + take / cancel: `activity_sheets:issue` (Office desk).
 *   - Return check: `activity_sheets:check` (Office + class teachers).
 *   - Print a restock run / mark a copy lost: `activity_sheets:manage`.
 * The run's PDF is REST: GET /files/activity-print?runId=… (routes/activityFiles.ts).
 * Identity plane; no corpus path (ADR-005).
 */
import { ACTIVITY_LEVELS, type ActivityLevel } from "@scd/shared";
import { builder } from "../../../schema";
import { copyCode } from "../models/ActivityCopy";
import type { IActivityIssue } from "../models/ActivityIssue";
import {
  cancelTake,
  deskCopy,
  deskReturn,
  deskTake,
  findCornerStudents,
  markCopyLost,
  printStock,
  trayView,
  type CornerStudent,
  type DeskCopyView,
  type TrayLevel,
  type TrayView,
} from "../services/ActivityCornerService";
import { ActivityError } from "../services/ActivityBankService";

export const ActivityStudentRef = builder.objectRef<CornerStudent>("ActivityStudent");
ActivityStudentRef.implement({
  description: "A child at the activity desk: who, which class, how many sheets are open.",
  fields: (t) => ({
    id: t.exposeString("id"),
    name: t.exposeString("name"),
    schoolId: t.exposeString("schoolId"),
    rollNumber: t.string({ nullable: true, resolve: (v) => v.rollNumber }),
    classLevel: t.int({ nullable: true, resolve: (v) => v.classLevel }),
    classLabelBn: t.exposeString("classLabelBn"),
    sectionNameBn: t.string({ nullable: true, resolve: (v) => v.sectionNameBn }),
    openSheets: t.exposeInt("openSheets"),
  }),
});

export const ActivityIssueRef = builder.objectRef<IActivityIssue>("ActivityIssue");
ActivityIssueRef.implement({
  description: "One sheet in one child's hands (TRAY / GUARDIAN / DESK_PRINT) and how it came back.",
  fields: (t) => ({
    id: t.string({ resolve: (v) => v._id.toString() }),
    studentId: t.string({ resolve: (v) => v.studentId.toString() }),
    path: t.exposeString("path"),
    status: t.exposeString("status"),
    result: t.string({ nullable: true, resolve: (v) => v.result ?? null }),
    repeat: t.boolean({ resolve: (v) => v.repeat === true }),
    unscannedTake: t.boolean({ resolve: (v) => v.unscannedTake === true }),
    stickerGiven: t.boolean({ resolve: (v) => v.stickerGiven === true }),
    stickerOwed: t.boolean({ resolve: (v) => v.stickerOwed === true }),
    requestedAt: t.string({ resolve: (v) => new Date(v.requestedAt).toISOString() }),
    handedAt: t.string({ nullable: true, resolve: (v) => (v.handedAt ? new Date(v.handedAt).toISOString() : null) }),
    returnedAt: t.string({ nullable: true, resolve: (v) => (v.returnedAt ? new Date(v.returnedAt).toISOString() : null) }),
  }),
});

const TrayLevelRef = builder.objectRef<TrayLevel>("ActivityTrayLevel");
TrayLevelRef.implement({
  fields: (t) => ({
    level: t.exposeString("level"),
    inTray: t.exposeInt("inTray"),
    out: t.exposeInt("out"),
    low: t.exposeBoolean("low"),
    printable: t.exposeInt("printable"),
  }),
});

const TrayRef = builder.objectRef<TrayView>("ActivityTray");
TrayRef.implement({
  description: "One published bank's tray stock per level (pre-printed copies waiting at the corner).",
  fields: (t) => ({
    bankId: t.string({ resolve: (v) => v.bank._id.toString() }),
    code: t.string({ resolve: (v) => v.bank.code }),
    nameBn: t.string({ resolve: (v) => v.bank.nameBn }),
    skillArea: t.string({ resolve: (v) => v.bank.skillArea }),
    levels: t.field({ type: [TrayLevelRef], resolve: (v) => v.levels }),
  }),
});

const TraysRef = builder.objectRef<{ trays: TrayView[]; lowTray: number; busyMode: boolean }>("ActivityTrays");
TraysRef.implement({
  fields: (t) => ({
    trays: t.field({ type: [TrayRef], resolve: (v) => v.trays }),
    lowTray: t.exposeInt("lowTray"),
    busyMode: t.exposeBoolean("busyMode"),
  }),
});

const DeskCopyRef = builder.objectRef<DeskCopyView>("ActivityDeskCopy");
DeskCopyRef.implement({
  description: "A scanned copy: which sheet, where it is (tray / with a child / back / lost), and who has it.",
  fields: (t) => ({
    code: t.exposeString("code"),
    kind: t.string({ resolve: (v) => v.copy.kind }),
    status: t.string({ resolve: (v) => v.copy.status }),
    itemId: t.string({ resolve: (v) => v.sheet.itemId }),
    level: t.string({ resolve: (v) => v.sheet.level }),
    details: t.string({ nullable: true, resolve: (v) => v.sheet.details ?? null }),
    bankCode: t.string({ resolve: (v) => v.bank.code }),
    bankNameBn: t.string({ resolve: (v) => v.bank.nameBn }),
    issue: t.field({ type: ActivityIssueRef, nullable: true, resolve: (v) => v.issue }),
    holder: t.field({ type: ActivityStudentRef, nullable: true, resolve: (v) => v.holder }),
    busyMode: t.exposeBoolean("busyMode"),
  }),
});

const StockRunRef = builder.objectRef<{ runId: string; copies: number; sheets: number }>("ActivityStockRun");
StockRunRef.implement({
  fields: (t) => ({ runId: t.exposeString("runId"), copies: t.exposeInt("copies"), sheets: t.exposeInt("sheets") }),
});

// ---------------------------------------------------------------------------

builder.queryField("activityTrays", (t) =>
  t.field({
    type: TraysRef,
    description: "Tray stock per published bank × level, with the low flag (A9).",
    authScopes: { hasAnyPermission: ["activity_sheets:issue", "activity_sheets:manage"] },
    resolve: async () => trayView(),
  }),
);

builder.queryField("activityDeskCopy", (t) =>
  t.field({
    type: DeskCopyRef,
    description: "Look up a scanned / typed copy code (AS-000231 or 231).",
    authScopes: { hasAnyPermission: ["activity_sheets:issue", "activity_sheets:check"] },
    args: { code: t.arg.string({ required: true }) },
    resolve: async (_root, args) => deskCopy(args.code),
  }),
);

builder.queryField("activityStudents", (t) =>
  t.field({
    type: [ActivityStudentRef],
    description: "Desk search: digits = school ID (103 = 0103), else a name or roll.",
    authScopes: { hasAnyPermission: ["activity_sheets:issue", "activity_sheets:check"] },
    args: { search: t.arg.string({ required: true }) },
    resolve: async (_root, args) => findCornerStudents(args.search),
  }),
);

builder.mutationField("printActivityStock", (t) =>
  t.field({
    type: StockRunRef,
    description: "Make a tray restock run (copies with QR serials). picks: 'bankId:E' — none = every low tray. Open the PDF by runId.",
    authScopes: { hasPermission: "activity_sheets:manage" },
    args: {
      picks: t.arg.stringList({ required: false }),
      sheets: t.arg.int({ required: false }),
      copies: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const picks = (args.picks ?? []).map((p) => {
        const [bankId, level] = p.split(":");
        if (!(ACTIVITY_LEVELS as readonly string[]).includes(level)) throw new ActivityError("স্তর ঠিক নয়");
        return { bankId, level: level as ActivityLevel };
      });
      if (args.sheets != null && (args.sheets < 1 || args.sheets > 50)) throw new ActivityError("শিটের সংখ্যা ১–৫০");
      if (args.copies != null && (args.copies < 1 || args.copies > 10)) throw new ActivityError("কপির সংখ্যা ১–১০");
      return printStock(picks, ctx.auth!.userId, { sheets: args.sheets, copies: args.copies });
    },
  }),
);

builder.mutationField("activityTake", (t) =>
  t.field({
    type: ActivityIssueRef,
    description: "A child takes a tray sheet: the copy is registered to the child (repeat flagged, open limit enforced).",
    authScopes: { hasPermission: "activity_sheets:issue" },
    args: { code: t.arg.string({ required: true }), studentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => deskTake(args.code, args.studentId, ctx.auth!.userId),
  }),
);

builder.mutationField("activityCancelTake", (t) =>
  t.field({
    type: "String",
    description: "Undo a wrong take — the copy goes back to the tray.",
    authScopes: { hasPermission: "activity_sheets:issue" },
    args: { code: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => copyCode((await cancelTake(args.code, ctx.auth!.userId)).serial),
  }),
);

builder.mutationField("activityReturn", (t) =>
  t.field({
    type: ActivityIssueRef,
    description: "A finished sheet comes back: result + sticker (unless অসম্পূর্ণ; owed when via the return box).",
    authScopes: { hasPermission: "activity_sheets:check" },
    args: {
      code: t.arg.string({ required: true }),
      result: t.arg.string({ required: true }),
      viaBox: t.arg.boolean({ required: false }),
      studentId: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => deskReturn({ code: args.code, result: args.result, viaBox: args.viaBox, studentId: args.studentId }, ctx.auth!.userId),
  }),
);

builder.mutationField("activityCopyLost", (t) =>
  t.field({
    type: "String",
    description: "A copy that will never come back — off the tray counts; an open sheet is closed as not returned.",
    authScopes: { hasPermission: "activity_sheets:manage" },
    args: { code: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => copyCode((await markCopyLost(args.code, ctx.auth!.userId)).serial),
  }),
);
