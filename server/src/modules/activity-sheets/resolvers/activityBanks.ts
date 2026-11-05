/**
 * Activity-sheet bank resolvers (AS-1, D-#988/#989, docs/prd-activity-sheets.md).
 *
 * Reads: `activity_sheets:view` (teacher + office — every bank, drafts too). The guardian's
 * choosing list is `activityChoices` (AS-3). The sample-image query also lets a guardian in
 * (`guardian:read_child`); the file gate checks the bank is published and suits the child.
 * Writes: `activity_sheets:manage` (Office); rules: `activity_sheets:settings`. The PDF
 * uploads are REST (routes/activityFiles.ts) under the same manage gate.
 */
import { ACTIVITY_LEVELS, type ActivityLevel } from "@scd/shared";
import { Types } from "mongoose";
import { builder } from "../../../schema";
import type { IActivitySheet } from "../models/ActivitySheet";
import {
  activityImage,
  bankSheets,
  listBanks,
  setSheetActive,
  updateBank,
  type BankView,
} from "../services/ActivityBankService";
import { ActivityBank, type IActivityBank } from "../models/ActivityBank";
import { activityRules, saveActivityRules, type ActivityRules } from "../services/ActivitySettingsService";

const ids = (list: ReadonlyArray<{ toString(): string }> | undefined) => (list ?? []).map((x) => x.toString());

interface LevelView {
  level: ActivityLevel;
  classLevels: number[];
  classText: string | null;
  sheetCount: number;
  sampleFileIds: string[];
}

const ActivityLevelRef = builder.objectRef<LevelView>("ActivityBankLevel");
ActivityLevelRef.implement({
  description: "One level (E/M/H) of a bank: the classes it suits and how many live sheets it has.",
  fields: (t) => ({
    level: t.exposeString("level"),
    classLevels: t.exposeIntList("classLevels"),
    classText: t.string({ nullable: true, resolve: (v) => v.classText }),
    sheetCount: t.exposeInt("sheetCount"),
    sampleFileIds: t.exposeStringList("sampleFileIds"),
  }),
});

const levelsOf = (v: BankView): LevelView[] =>
  ACTIVITY_LEVELS.map((level) => ({
    level,
    classLevels: v.bank.levelClasses?.[level] ?? [],
    classText: v.bank.levelClassText?.[level] ?? null,
    sheetCount: v.counts[level],
    sampleFileIds: ids(v.bank.sampleFileIds?.[level]),
  }));

const ActivityBankRef = builder.objectRef<BankView>("ActivityBank");
ActivityBankRef.implement({
  description: "An activity bank (e.g. Spot the Difference, SD) with its level → class mapping and sheet counts.",
  fields: (t) => ({
    id: t.string({ resolve: (v) => v.bank._id.toString() }),
    code: t.string({ resolve: (v) => v.bank.code }),
    bankNo: t.int({ nullable: true, resolve: (v) => v.bank.bankNo ?? null }),
    nameBn: t.string({ resolve: (v) => v.bank.nameBn }),
    nameEn: t.string({ nullable: true, resolve: (v) => v.bank.nameEn ?? null }),
    skillArea: t.string({ resolve: (v) => v.bank.skillArea }),
    status: t.string({ resolve: (v) => v.bank.status }),
    sortOrder: t.int({ resolve: (v) => v.bank.sortOrder ?? 0 }),
    hasSheetPdf: t.boolean({ resolve: (v) => !!v.bank.sheetFileId }),
    hasAnswerPdf: t.boolean({ resolve: (v) => !!v.bank.answerFileId }),
    levels: t.field({ type: [ActivityLevelRef], resolve: levelsOf }),
    retired: t.exposeInt("retired"),
    withoutPages: t.exposeInt("withoutPages"),
    answers: t.exposeInt("answers"),
  }),
});

const ActivitySheetRef = builder.objectRef<IActivitySheet>("ActivitySheet");
ActivitySheetRef.implement({
  description: "One sheet of a bank (SD-E-001): its page in the bank PDF and its answer page.",
  fields: (t) => ({
    id: t.string({ resolve: (v) => v._id.toString() }),
    itemId: t.exposeString("itemId"),
    level: t.exposeString("level"),
    seq: t.exposeInt("seq"),
    details: t.string({ nullable: true, resolve: (v) => v.details ?? null }),
    hasPage: t.boolean({ resolve: (v) => !!v.sourceFileId && !!v.page }),
    hasAnswer: t.boolean({ resolve: (v) => !!v.answerPage }),
    active: t.boolean({ resolve: (v) => v.active !== false }),
  }),
});

interface BankDetail {
  view: BankView;
  sheets: IActivitySheet[];
}
const ActivityBankDetailRef = builder.objectRef<BankDetail>("ActivityBankDetail");
ActivityBankDetailRef.implement({
  fields: (t) => ({
    bank: t.field({ type: ActivityBankRef, resolve: (v) => v.view }),
    sheets: t.field({ type: [ActivitySheetRef], resolve: (v) => v.sheets }),
  }),
});

type RulesView = ActivityRules & { isDefault: boolean };
const ActivityRulesRef = builder.objectRef<RulesView>("ActivityRules");
ActivityRulesRef.implement({
  description: "Activity-sheet rules (D-#991 defaults until Office saves them).",
  fields: (t) => ({
    weeklyRequests: t.exposeInt("weeklyRequests"),
    maxOpen: t.exposeInt("maxOpen"),
    monthlyTarget: t.exposeInt("monthlyTarget"),
    levelUpAfter: t.exposeInt("levelUpAfter"),
    notReturnedDays: t.exposeInt("notReturnedDays"),
    restockSheets: t.exposeInt("restockSheets"),
    restockCopies: t.exposeInt("restockCopies"),
    lowTray: t.exposeInt("lowTray"),
    busyMode: t.exposeBoolean("busyMode"),
    isDefault: t.exposeBoolean("isDefault"),
  }),
});

async function viewOf(bank: IActivityBank): Promise<BankView> {
  const all = await listBanks();
  const v = all.find((x) => x.bank._id.toString() === bank._id.toString());
  if (!v) throw new Error("bank vanished");
  return v;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

builder.queryField("activityBanks", (t) =>
  t.field({
    type: [ActivityBankRef],
    description: "Every activity bank (drafts too) with sheet counts — the staff list and the bank manager (A12).",
    authScopes: { hasPermission: "activity_sheets:view" },
    resolve: async () => listBanks(),
  }),
);

builder.queryField("activityBank", (t) =>
  t.field({
    type: ActivityBankDetailRef,
    description: "One bank with all its sheets (retired ones too).",
    authScopes: { hasPermission: "activity_sheets:view" },
    args: { bankId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => {
      const bank = Types.ObjectId.isValid(args.bankId) ? ((await ActivityBank.findById(args.bankId).lean()) as unknown as IActivityBank | null) : null;
      if (!bank) throw new Error("ব্যাংকটি পাওয়া যায়নি");
      return { view: await viewOf(bank), sheets: await bankSheets(args.bankId) };
    },
  }),
);

builder.queryField("activityImage", (t) =>
  t.string({
    description: "A bank's sample page as a JPEG data URI (never the bank PDF).",
    authScopes: { hasAnyPermission: ["activity_sheets:view", "guardian:read_child"] },
    args: { fileId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => activityImage(ctx, args.fileId),
  }),
);

builder.queryField("activityRules", (t) =>
  t.field({
    type: ActivityRulesRef,
    authScopes: { hasPermission: "activity_sheets:view" },
    resolve: async () => activityRules(),
  }),
);

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

builder.mutationField("updateActivityBank", (t) =>
  t.field({
    type: ActivityBankRef,
    description: "Edit a bank: names, skill area, status (DRAFT / PUBLISHED / RETIRED), order, which classes each level suits. Audited.",
    authScopes: { hasPermission: "activity_sheets:manage" },
    args: {
      bankId: t.arg.string({ required: true }),
      nameBn: t.arg.string({ required: false }),
      nameEn: t.arg.string({ required: false }),
      skillArea: t.arg.string({ required: false }),
      status: t.arg.string({ required: false }),
      sortOrder: t.arg.int({ required: false }),
      classesE: t.arg.intList({ required: false }),
      classesM: t.arg.intList({ required: false }),
      classesH: t.arg.intList({ required: false }),
    },
    resolve: async (_root, a, ctx) => {
      const bank = await updateBank(
        a.bankId,
        {
          nameBn: a.nameBn,
          nameEn: a.nameEn,
          skillArea: a.skillArea,
          status: a.status,
          sortOrder: a.sortOrder,
          levelClasses: a.classesE || a.classesM || a.classesH ? { E: a.classesE, M: a.classesM, H: a.classesH } : null,
        },
        ctx.auth!.userId,
      );
      return viewOf(bank);
    },
  }),
);

builder.mutationField("setActivitySheetActive", (t) =>
  t.field({
    type: ActivitySheetRef,
    description: "Retire a sheet (never printed or chosen again; its history stays) or bring it back.",
    authScopes: { hasPermission: "activity_sheets:manage" },
    args: { sheetId: t.arg.string({ required: true }), active: t.arg.boolean({ required: true }) },
    resolve: async (_root, args, ctx) => setSheetActive(args.sheetId, args.active, ctx.auth!.userId),
  }),
);

builder.mutationField("saveActivityRules", (t) =>
  t.field({
    type: ActivityRulesRef,
    description: "Save the activity-sheet rules (weekly requests, open limit, monthly target, tray restock, busy mode). Audited.",
    authScopes: { hasPermission: "activity_sheets:settings" },
    args: {
      weeklyRequests: t.arg.int({ required: false }),
      maxOpen: t.arg.int({ required: false }),
      monthlyTarget: t.arg.int({ required: false }),
      levelUpAfter: t.arg.int({ required: false }),
      notReturnedDays: t.arg.int({ required: false }),
      restockSheets: t.arg.int({ required: false }),
      restockCopies: t.arg.int({ required: false }),
      lowTray: t.arg.int({ required: false }),
      busyMode: t.arg.boolean({ required: false }),
    },
    resolve: async (_root, args, ctx) => saveActivityRules(args, ctx.auth!.userId),
  }),
);
