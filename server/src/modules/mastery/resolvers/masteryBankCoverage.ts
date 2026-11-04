/**
 * Question-bank coverage (prd-objective-tree §8.2, mock 5; OT-4) — one read.
 *
 *   masteryBankCoverage(classToken?, subject?) — gold questions per tagged row of one class ×
 *     subject (the first pair when none is named), the pairs to choose from, and the gaps as a
 *     brief for the next question batch.
 *
 * Gate: the Reports-hub switch `reports:bank_coverage` (every report is a switch, D-#846; Principal
 * and Office by default, handed to anyone else by grant) or the module doors `mastery:settings` (the Principal
 * who locks the list) and `mastery:review` (the reviewer). Whole school, curriculum plane only.
 */
import { builder } from "../../../schema";
import { bankCoverage, type BankCoveragePair, type BankCoverageRow, type BankCoverageView } from "../services/MasteryBankCoverageService";

const PairRef = builder.objectRef<BankCoveragePair>("MasteryBankCoveragePair");
PairRef.implement({
  fields: (t) => ({
    classToken: t.exposeString("classToken"),
    subject: t.exposeString("subject"),
    locked: t.exposeBoolean("locked"),
  }),
});

const RowRef = builder.objectRef<BankCoverageRow>("MasteryBankCoverageRow");
RowRef.implement({
  description: "One tagged, question-assessed row of the objective list and how many questions name it.",
  fields: (t) => ({
    code: t.exposeString("code"),
    labelBn: t.exposeString("labelBn"),
    level: t.exposeString("level"),
    parentCode: t.string({ nullable: true, resolve: (r) => r.parentCode }),
    parentLabelBn: t.string({ nullable: true, resolve: (r) => r.parentLabelBn }),
    chapterNumber: t.int({ nullable: true, resolve: (r) => r.chapterNumber }),
    strand: t.string({ nullable: true, resolve: (r) => r.strand }),
    status: t.exposeString("status"),
    questionTypeCodes: t.exposeStringList("questionTypeCodes"),
    exercises: t.exposeStringList("exercises"),
    goldCount: t.exposeInt("goldCount"),
    pendingCount: t.exposeInt("pendingCount"),
  }),
});

const ChapterRef = builder.objectRef<{ number: number; titleBn: string }>("MasteryBankCoverageChapter");
ChapterRef.implement({
  fields: (t) => ({ number: t.exposeInt("number"), titleBn: t.exposeString("titleBn") }),
});

const TotalsRef = builder.objectRef<BankCoverageView["totals"]>("MasteryBankCoverageTotals");
TotalsRef.implement({
  fields: (t) => ({
    rows: t.exposeInt("rows"),
    zeroRows: t.exposeInt("zeroRows"),
    gold: t.exposeInt("gold"),
    rubricRows: t.exposeInt("rubricRows"),
  }),
});

const ViewRef = builder.objectRef<BankCoverageView>("MasteryBankCoverage");
ViewRef.implement({
  fields: (t) => ({
    pairs: t.field({ type: [PairRef], resolve: (v) => v.pairs }),
    classToken: t.string({ nullable: true, resolve: (v) => v.classToken }),
    subject: t.string({ nullable: true, resolve: (v) => v.subject }),
    locked: t.exposeBoolean("locked"),
    chapters: t.field({ type: [ChapterRef], resolve: (v) => v.chapters }),
    rows: t.field({ type: [RowRef], resolve: (v) => v.rows }),
    totals: t.field({ type: TotalsRef, resolve: (v) => v.totals }),
    brief: t.exposeString("brief", { description: "The rows with no gold question, as a brief for the next question batch." }),
  }),
});

builder.queryFields((t) => ({
  masteryBankCoverage: t.field({
    type: ViewRef,
    description:
      "Question-bank coverage of one class × subject's objective list (prd-objective-tree §8.2): gold questions per tagged row, " +
      "zero rows to fill, and the gaps as a brief. Requires reports:bank_coverage, mastery:settings or mastery:review.",
    authScopes: { hasAnyPermission: ["reports:bank_coverage", "mastery:settings", "mastery:review"] },
    args: {
      classToken: t.arg.string({ required: false }),
      subject: t.arg.string({ required: false }),
    },
    resolve: async (_r, args) => bankCoverage(args.classToken ?? null, args.subject ?? null),
  }),
}));
