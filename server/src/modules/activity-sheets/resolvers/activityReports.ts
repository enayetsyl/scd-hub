/**
 * Activity-sheet reports (AS-5) — each tab its own Reports-hub switch (D-#861 pattern):
 * reports:activity_skills / reports:activity_sheets / reports:activity_students.
 */
import { builder } from "../../../schema";
import {
  activityBankReport,
  activityChildrenReport,
  activitySkillReport,
  type BankLevelRow,
  type BankRow,
  type ChildRow,
  type ChildrenReport,
  type SectionTotal,
  type SkillCell,
  type SkillReport,
  type SkillRow,
} from "../services/ActivityReportService";

const SkillRowRef = builder.objectRef<SkillRow>("ActivitySkillRow");
SkillRowRef.implement({
  fields: (t) => ({
    skill: t.exposeString("skill"),
    labelBn: t.exposeString("labelBn"),
    finished: t.exposeInt("finished"),
    allCorrectPct: t.exposeInt("allCorrectPct"),
    children: t.exposeInt("children"),
  }),
});
const SkillCellRef = builder.objectRef<SkillCell>("ActivitySkillCell");
SkillCellRef.implement({
  fields: (t) => ({ classLabelBn: t.exposeString("classLabelBn"), skill: t.exposeString("skill"), finished: t.exposeInt("finished") }),
});
const SkillReportRef = builder.objectRef<SkillReport>("ActivitySkillReport");
SkillReportRef.implement({
  fields: (t) => ({
    rows: t.field({ type: [SkillRowRef], resolve: (r) => r.rows }),
    grid: t.field({ type: [SkillCellRef], resolve: (r) => r.grid }),
  }),
});

const BankLevelRef = builder.objectRef<BankLevelRow>("ActivityBankLevelRow");
BankLevelRef.implement({
  fields: (t) => ({
    level: t.exposeString("level"),
    given: t.exposeInt("given"),
    back: t.exposeInt("back"),
    allCorrectPct: t.exposeInt("allCorrectPct"),
    tooHard: t.exposeBoolean("tooHard"),
  }),
});
const BankRowRef = builder.objectRef<BankRow>("ActivityBankRow");
BankRowRef.implement({
  fields: (t) => ({
    bankId: t.exposeString("bankId"),
    code: t.exposeString("code"),
    nameBn: t.exposeString("nameBn"),
    skill: t.exposeString("skill"),
    given: t.exposeInt("given"),
    back: t.exposeInt("back"),
    allCorrectPct: t.exposeInt("allCorrectPct"),
    notReturned: t.exposeInt("notReturned"),
    repeats: t.exposeInt("repeats"),
    viaTray: t.exposeInt("viaTray"),
    viaGuardian: t.exposeInt("viaGuardian"),
    neverTaken: t.exposeBoolean("neverTaken"),
    levels: t.field({ type: [BankLevelRef], resolve: (r) => r.levels }),
  }),
});

const ChildRowRef = builder.objectRef<ChildRow>("ActivityChildRow");
ChildRowRef.implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    classLabelBn: t.exposeString("classLabelBn"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    finished: t.exposeInt("finished"),
    allCorrect: t.exposeInt("allCorrect"),
    open: t.exposeInt("open"),
    notReturned: t.exposeInt("notReturned"),
    favouriteSkillBn: t.string({ nullable: true, resolve: (r) => r.favouriteSkillBn }),
    last: t.string({ nullable: true, resolve: (r) => (r.last ? r.last.toISOString() : null) }),
  }),
});
const SectionTotalRef = builder.objectRef<SectionTotal>("ActivitySectionTotal");
SectionTotalRef.implement({
  fields: (t) => ({
    classLabelBn: t.exposeString("classLabelBn"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    children: t.exposeInt("children"),
    finished: t.exposeInt("finished"),
  }),
});
const ChildrenRef = builder.objectRef<ChildrenReport>("ActivityChildrenReport");
ChildrenRef.implement({
  fields: (t) => ({
    children: t.field({ type: [ChildRowRef], resolve: (r) => r.children }),
    sections: t.field({ type: [SectionTotalRef], resolve: (r) => r.sections }),
  }),
});

builder.queryField("activitySkillReport", (t) =>
  t.field({
    type: SkillReportRef,
    description: "Activity sheets by skill area over d30 / d90 / year, with a class × skill grid. Requires reports:activity_skills.",
    authScopes: { hasPermission: "reports:activity_skills" },
    args: { window: t.arg.string({ required: true }) },
    resolve: async (_root, args) => activitySkillReport(args.window),
  }),
);

builder.queryField("activityBankReport", (t) =>
  t.field({
    type: [BankRowRef],
    description: "Activity sheets by bank and level: given, back, all-correct rate, too-hard levels, banks nobody took. Requires reports:activity_sheets.",
    authScopes: { hasPermission: "reports:activity_sheets" },
    args: { window: t.arg.string({ required: true }) },
    resolve: async (_root, args) => activityBankReport(args.window),
  }),
);

builder.queryField("activityChildrenReport", (t) =>
  t.field({
    type: ChildrenRef,
    description: "Activity sheets per child (names children) and per section. Requires reports:activity_students.",
    authScopes: { hasPermission: "reports:activity_students" },
    args: { window: t.arg.string({ required: true }) },
    resolve: async (_root, args) => activityChildrenReport(args.window),
  }),
);
