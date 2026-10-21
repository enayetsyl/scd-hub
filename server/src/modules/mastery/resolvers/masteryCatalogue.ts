/**
 * Mastery tracker — catalogue resolvers (M-0, docs/prd-mastery.md §5.1).
 *
 *   masteryCoverage          — mastery:read; class × subject rows with catalogue counts
 *   masteryCatalogue         — mastery:read; chapters + outcomes + question types for one pair
 *   masteryTags              — mastery:read; the diagnosis tags (seeds the defaults on first read)
 *   masteryPolicy            — mastery:read; resolved policy for the school or one pair
 *   masteryEnablements       — mastery:read; the switch rows for one academic year
 *   importMasteryCatalogue   — mastery:manage; dry run (apply=false) or apply a catalogue file's JSON
 *   lockMasteryCatalogue     — mastery:manage; DRAFT → LOCKED for one pair (D-#776)
 *   saveMasteryOutcome       — mastery:manage; label / home tip / source text / question types
 *   retireMasteryOutcome     — mastery:manage; LOCKED → RETIRED (a DRAFT is removed)
 *   saveMasteryQuestionType  — mastery:manage; marks with history (D-#777)
 *   saveMasteryTag           — mastery:manage; incl. routing tags (D-#787)
 *   saveMasteryPolicy        — mastery:manage; school row or a pair override
 *   setMasteryEnablement     — mastery:manage; the add-on switch (D-#775)
 *
 * The catalogue is curriculum reference data — not row-scoped: every holder of
 * mastery:read sees every class's list, exactly like the bank's chapter list.
 */
import { builder } from "../../../schema";
import { MASTERY_POLICY_DEFAULTS } from "@scd/shared";
import type {
  MasteryClassToken,
  MasteryRouteLevel,
  MasterySubject,
  MasteryTagApplies,
  MasteryTagEffect,
} from "@scd/shared";
import {
  getCatalogue,
  getPolicy,
  importCatalogue,
  listCoverage,
  listEnablements,
  listTags,
  lockCatalogue,
  retireOutcome,
  saveOutcome,
  savePolicy,
  saveQuestionType,
  saveTag,
  setEnablement,
  type CatalogueView,
  type ChapterView,
  type CoverageRow,
  type EnablementView,
  type ImportReport,
  type OutcomeView,
  type PolicyView,
  type QuestionTypeView,
  type TagView,
} from "../services/MasteryCatalogueService";
import { POLICY_KEYS } from "../catalogue";

function actorOf(ctx: { auth: { userId: string; role: string } | null }): { userId: string; role: string } {
  if (!ctx.auth) throw new Error("লগইন প্রয়োজন।");
  return { userId: ctx.auth.userId, role: ctx.auth.role };
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

const CoverageRef = builder.objectRef<CoverageRow>("MasteryCoverageRow");
CoverageRef.implement({
  description: "One class × subject that has a catalogue: counts by status and how many question types are defined.",
  fields: (t) => ({
    classToken: t.exposeString("classToken"),
    subject: t.exposeString("subject"),
    draftCount: t.exposeInt("draftCount"),
    lockedCount: t.exposeInt("lockedCount"),
    retiredCount: t.exposeInt("retiredCount"),
    questionTypeCount: t.exposeInt("questionTypeCount"),
  }),
});

const OutcomeRef = builder.objectRef<OutcomeView>("MasteryOutcome");
OutcomeRef.implement({
  description:
    "One learning outcome (D-#776). `chapterNumber` null ⇔ `strand` set: a skill that spans chapters " +
    "(LO-…-SK-<STRAND>-NN). A LOCKED code is permanent; RETIRED rows only appear when asked for.",
  fields: (t) => ({
    code: t.exposeString("code"),
    classToken: t.exposeString("classToken"),
    subject: t.exposeString("subject"),
    chapterNumber: t.int({ nullable: true, resolve: (o) => o.chapterNumber }),
    strand: t.string({ nullable: true, resolve: (o) => o.strand }),
    labelBn: t.exposeString("labelBn"),
    labelEn: t.string({ nullable: true, resolve: (o) => o.labelEn }),
    sourceText: t.exposeString("sourceText"),
    nctbCode: t.string({ nullable: true, resolve: (o) => o.nctbCode }),
    assess: t.exposeString("assess"),
    questionTypeCodes: t.exposeStringList("questionTypeCodes"),
    homeTipBn: t.string({ nullable: true, resolve: (o) => o.homeTipBn }),
    order: t.exposeInt("order"),
    status: t.exposeString("status"),
  }),
});

const ChapterRef = builder.objectRef<ChapterView>("MasteryChapter");
ChapterRef.implement({
  fields: (t) => ({
    number: t.exposeInt("number"),
    titleBn: t.exposeString("titleBn"),
    termNote: t.string({ nullable: true, resolve: (c) => c.termNote }),
    outcomeCount: t.exposeInt("outcomeCount"),
  }),
});

const MarksHistoryRef = builder.objectRef<{ marks: number; from: string }>("MasteryMarksHistory");
MarksHistoryRef.implement({
  fields: (t) => ({
    marks: t.exposeFloat("marks"),
    from: t.exposeString("from"),
  }),
});

const QuestionTypeRef = builder.objectRef<QuestionTypeView>("MasteryQuestionType");
QuestionTypeRef.implement({
  description:
    "What one question type is worth in this class × subject (D-#777). Items copy `marks` when created, " +
    "so a change never rewrites a past result. Null marks = the book gives none (classwork-only type).",
  fields: (t) => ({
    code: t.exposeString("code"),
    labelBn: t.exposeString("labelBn"),
    marks: t.float({ nullable: true, resolve: (q) => q.marks }),
    answerForm: t.string({ nullable: true, resolve: (q) => q.answerForm }),
    notes: t.string({ nullable: true, resolve: (q) => q.notes }),
    active: t.exposeBoolean("active"),
    history: t.field({ type: [MarksHistoryRef], resolve: (q) => q.history }),
  }),
});

const CatalogueRef = builder.objectRef<CatalogueView>("MasteryCatalogue");
CatalogueRef.implement({
  fields: (t) => ({
    classToken: t.exposeString("classToken"),
    subject: t.exposeString("subject"),
    chapters: t.field({ type: [ChapterRef], resolve: (c) => c.chapters }),
    outcomes: t.field({ type: [OutcomeRef], resolve: (c) => c.outcomes }),
    questionTypes: t.field({ type: [QuestionTypeRef], resolve: (c) => c.questionTypes }),
    draftCount: t.exposeInt("draftCount"),
    lockedCount: t.exposeInt("lockedCount"),
    retiredCount: t.exposeInt("retiredCount"),
  }),
});

const DiffChangeRef = builder.objectRef<{ code: string; fields: string[] }>("MasteryDiffChange");
DiffChangeRef.implement({
  fields: (t) => ({ code: t.exposeString("code"), fields: t.exposeStringList("fields") }),
});

const MarksChangeRef = builder.objectRef<{ code: string; from: number | null; to: number | null }>("MasteryMarksChange");
MarksChangeRef.implement({
  fields: (t) => ({
    code: t.exposeString("code"),
    from: t.float({ nullable: true, resolve: (m) => m.from }),
    to: t.float({ nullable: true, resolve: (m) => m.to }),
  }),
});

type Diff = NonNullable<ImportReport["diff"]>;
const DiffRef = builder.objectRef<Diff>("MasteryCatalogueDiff");
DiffRef.implement({
  description: "What an import would change. Any `errors` entry blocks the apply.",
  fields: (t) => ({
    added: t.exposeStringList("added"),
    changed: t.field({ type: [DiffChangeRef], resolve: (d) => d.changed }),
    unchanged: t.exposeInt("unchanged"),
    removedDrafts: t.exposeStringList("removedDrafts"),
    retired: t.exposeStringList("retired"),
    qtAdded: t.exposeStringList("qtAdded"),
    qtMarksChanged: t.field({ type: [MarksChangeRef], resolve: (d) => d.qtMarksChanged }),
    qtLabelChanged: t.exposeStringList("qtLabelChanged"),
    errors: t.exposeStringList("errors"),
  }),
});

const ImportReportRef = builder.objectRef<ImportReport>("MasteryImportReport");
ImportReportRef.implement({
  fields: (t) => ({
    ok: t.exposeBoolean("ok"),
    applied: t.exposeBoolean("applied"),
    classToken: t.string({ nullable: true, resolve: (r) => r.classToken }),
    subject: t.string({ nullable: true, resolve: (r) => r.subject }),
    status: t.string({ nullable: true, resolve: (r) => r.status }),
    errors: t.exposeStringList("errors"),
    diff: t.field({ type: DiffRef, nullable: true, resolve: (r) => r.diff }),
  }),
});

const TagScopeRef = builder.objectRef<{ classToken: string; subject: string }>("MasteryTagScope");
TagScopeRef.implement({
  fields: (t) => ({ classToken: t.exposeString("classToken"), subject: t.exposeString("subject") }),
});

const TagRef = builder.objectRef<TagView>("MasteryTag");
TagRef.implement({
  description:
    "A diagnosis tag (D-#778). ROUTE_STRAND tags feed a cross-chapter skill (D-#787): tagged ⇒ weak " +
    "evidence for the strand, an eligible untagged item/work ⇒ good evidence, and the routed deduction " +
    "is not counted against the item's own outcome.",
  fields: (t) => ({
    code: t.exposeString("code"),
    labelBn: t.exposeString("labelBn"),
    appliesTo: t.exposeString("appliesTo"),
    effect: t.exposeString("effect"),
    routeStrand: t.string({ nullable: true, resolve: (x) => x.routeStrand }),
    routeSeq: t.int({ nullable: true, resolve: (x) => x.routeSeq }),
    level: t.string({ nullable: true, resolve: (x) => x.level }),
    questionTypeCodes: t.exposeStringList("questionTypeCodes"),
    deductionMarks: t.float({ nullable: true, resolve: (x) => x.deductionMarks }),
    allScopes: t.exposeBoolean("allScopes"),
    scopes: t.field({ type: [TagScopeRef], resolve: (x) => x.scopes }),
    system: t.exposeBoolean("system"),
    active: t.exposeBoolean("active"),
    order: t.exposeInt("order"),
  }),
});

type PolicyValues = PolicyView["resolved"];
const PolicyValuesRef = builder.objectRef<PolicyValues>("MasteryPolicyValues");
PolicyValuesRef.implement({
  description: "Every threshold the engine and the assignment builder use (D-#779/#780/#781).",
  fields: (t) => {
    const out: Record<string, unknown> = {};
    for (const k of POLICY_KEYS) {
      const isBool = typeof MASTERY_POLICY_DEFAULTS[k] === "boolean";
      out[k] = isBool
        ? t.boolean({ resolve: (p) => p[k] as boolean })
        : t.float({ resolve: (p) => p[k] as number });
    }
    return out as never;
  },
});

const PolicyRef = builder.objectRef<PolicyView>("MasteryPolicy");
PolicyRef.implement({
  fields: (t) => ({
    scopeKey: t.exposeString("scopeKey"),
    resolved: t.field({ type: PolicyValuesRef, resolve: (p) => p.resolved }),
    ownKeys: t.exposeStringList("ownKeys"),
  }),
});

const EnablementRef = builder.objectRef<EnablementView>("MasteryEnablement");
EnablementRef.implement({
  fields: (t) => ({
    academicYearId: t.exposeString("academicYearId"),
    classToken: t.exposeString("classToken"),
    subject: t.exposeString("subject"),
    enabled: t.exposeBoolean("enabled"),
    changedAt: t.exposeString("changedAt"),
  }),
});

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const TagScopeInput = builder.inputType("MasteryTagScopeInput", {
  fields: (t) => ({
    classToken: t.string({ required: true }),
    subject: t.string({ required: true }),
  }),
});

const TagInputRef = builder.inputType("MasteryTagInput", {
  fields: (t) => ({
    code: t.string({ required: true }),
    labelBn: t.string({ required: true }),
    appliesTo: t.string({ required: true }),
    effect: t.string({ required: true }),
    routeStrand: t.string({ required: false }),
    routeSeq: t.int({ required: false }),
    level: t.string({ required: false }),
    questionTypeCodes: t.stringList({ required: false }),
    deductionMarks: t.float({ required: false }),
    allScopes: t.boolean({ required: true }),
    scopes: t.field({ type: [TagScopeInput], required: true }),
    active: t.boolean({ required: true }),
    order: t.int({ required: false }),
  }),
});

const PolicyInput = builder.inputType("MasteryPolicyInput", {
  description: "Only the keys this scope sets; omitted keys are inherited (school → defaults).",
  fields: (t) => {
    const out: Record<string, unknown> = {};
    for (const k of POLICY_KEYS) {
      out[k] = typeof MASTERY_POLICY_DEFAULTS[k] === "boolean" ? t.boolean({ required: false }) : t.float({ required: false });
    }
    return out as never;
  },
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

builder.queryFields((t) => ({
  masteryCoverage: t.field({
    type: [CoverageRef],
    description: "Every class × subject that has a catalogue, with counts by status.",
    authScopes: { hasPermission: "mastery:view" },
    resolve: async () => listCoverage(),
  }),

  masteryCatalogue: t.field({
    type: CatalogueRef,
    description: "Chapters, learning outcomes (incl. skill strands) and question-type marks for one class × subject.",
    authScopes: { hasPermission: "mastery:view" },
    args: {
      classToken: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      includeRetired: t.arg.boolean({ required: false }),
    },
    resolve: async (_r, args) =>
      getCatalogue(args.classToken as MasteryClassToken, args.subject as MasterySubject, args.includeRetired ?? false),
  }),

  masteryTags: t.field({
    type: [TagRef],
    description: "The diagnosis tags, in display order. The seed tags are created on first read.",
    authScopes: { hasPermission: "mastery:view" },
    resolve: async () => listTags(),
  }),

  masteryPolicy: t.field({
    type: PolicyRef,
    description: "The resolved policy for the school (no args) or one class × subject (both args).",
    authScopes: { hasPermission: "mastery:view" },
    args: {
      classToken: t.arg.string({ required: false }),
      subject: t.arg.string({ required: false }),
    },
    resolve: async (_r, args) =>
      getPolicy((args.classToken ?? null) as MasteryClassToken | null, (args.subject ?? null) as MasterySubject | null),
  }),

  masteryEnablements: t.field({
    type: [EnablementRef],
    description: "The add-on switch rows for one academic year (D-#775).",
    authScopes: { hasPermission: "mastery:view" },
    args: { academicYearId: t.arg.string({ required: true }) },
    resolve: async (_r, args) => listEnablements(args.academicYearId),
  }),
}));

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

builder.mutationFields((t) => ({
  importMasteryCatalogue: t.field({
    type: ImportReportRef,
    description:
      "Dry run (apply=false) or apply a class × subject catalogue converted from its locked file. " +
      "The dry run is the same computation the apply uses.",
    authScopes: { hasPermission: "mastery:settings" },
    args: {
      catalogueJson: t.arg.string({ required: true }),
      apply: t.arg.boolean({ required: true }),
    },
    resolve: async (_r, args, ctx) => importCatalogue(args.catalogueJson, args.apply, actorOf(ctx)),
  }),

  lockMasteryCatalogue: t.field({
    type: "Int",
    description: "DRAFT → LOCKED for one class × subject; returns how many outcomes were locked (D-#776).",
    authScopes: { hasPermission: "mastery:settings" },
    args: {
      classToken: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
    },
    resolve: async (_r, args, ctx) =>
      lockCatalogue(args.classToken as MasteryClassToken, args.subject as MasterySubject, actorOf(ctx)),
  }),

  saveMasteryOutcome: t.field({
    type: OutcomeRef,
    description: "Edit an outcome's label, home tip, source text or question types (never its code or assessment mode).",
    authScopes: { hasPermission: "mastery:settings" },
    args: {
      code: t.arg.string({ required: true }),
      labelBn: t.arg.string({ required: false }),
      labelEn: t.arg.string({ required: false }),
      homeTipBn: t.arg.string({ required: false }),
      sourceText: t.arg.string({ required: false }),
      questionTypeCodes: t.arg.stringList({ required: false }),
    },
    resolve: async (_r, args, ctx) =>
      saveOutcome(
        args.code,
        {
          labelBn: args.labelBn,
          labelEn: args.labelEn,
          homeTipBn: args.homeTipBn,
          sourceText: args.sourceText,
          questionTypeCodes: args.questionTypeCodes,
        },
        actorOf(ctx),
      ),
  }),

  retireMasteryOutcome: t.field({
    type: "String",
    description: "LOCKED → RETIRED (kept for old evidence); a DRAFT is removed. Returns RETIRED or DELETED.",
    authScopes: { hasPermission: "mastery:delete" },
    args: { code: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => retireOutcome(args.code, actorOf(ctx)),
  }),

  saveMasteryQuestionType: t.field({
    type: QuestionTypeRef,
    description: "Create or edit a question type's marks for one class × subject; a marks change is kept in history (D-#777).",
    authScopes: { hasPermission: "mastery:settings" },
    args: {
      classToken: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      code: t.arg.string({ required: true }),
      labelBn: t.arg.string({ required: true }),
      marks: t.arg.float({ required: false }),
      answerForm: t.arg.string({ required: false }),
      notes: t.arg.string({ required: false }),
      active: t.arg.boolean({ required: false }),
    },
    resolve: async (_r, args, ctx) =>
      saveQuestionType(
        {
          classToken: args.classToken as MasteryClassToken,
          subject: args.subject as MasterySubject,
          code: args.code,
          labelBn: args.labelBn,
          marks: args.marks ?? null,
          answerForm: args.answerForm,
          notes: args.notes,
          active: args.active,
        },
        actorOf(ctx),
      ),
  }),

  saveMasteryTag: t.field({
    type: TagRef,
    description: "Add or edit a diagnosis tag, including routing tags (D-#787: the strand must exist in every scope).",
    authScopes: { hasPermission: "mastery:settings" },
    args: { input: t.arg({ type: TagInputRef, required: true }) },
    resolve: async (_r, { input }, ctx) =>
      saveTag(
        {
          code: input.code.trim(),
          labelBn: input.labelBn,
          appliesTo: input.appliesTo as MasteryTagApplies,
          effect: input.effect as MasteryTagEffect,
          routeStrand: input.routeStrand,
          routeSeq: input.routeSeq,
          level: (input.level ?? null) as MasteryRouteLevel | null,
          questionTypeCodes: input.questionTypeCodes,
          deductionMarks: input.deductionMarks,
          allScopes: input.allScopes,
          scopes: input.scopes.map((s) => ({
            classToken: s.classToken as MasteryClassToken,
            subject: s.subject as MasterySubject,
          })),
          active: input.active,
          order: input.order,
        },
        actorOf(ctx),
      ),
  }),

  saveMasteryPolicy: t.field({
    type: PolicyRef,
    description:
      "Save the school policy (no class/subject) or one class × subject override. `values` replaces the " +
      "scope's own keys; validated on the resolved result.",
    authScopes: { hasPermission: "mastery:settings" },
    args: {
      classToken: t.arg.string({ required: false }),
      subject: t.arg.string({ required: false }),
      values: t.arg({ type: PolicyInput, required: true }),
    },
    resolve: async (_r, args, ctx) =>
      savePolicy(
        (args.classToken ?? null) as MasteryClassToken | null,
        (args.subject ?? null) as MasterySubject | null,
        args.values as Record<string, unknown>,
        actorOf(ctx),
      ),
  }),

  setMasteryEnablement: t.field({
    type: EnablementRef,
    description: "Switch the add-on on/off for a year × class × subject (D-#775). On requires a LOCKED catalogue.",
    authScopes: { hasPermission: "mastery:settings" },
    args: {
      academicYearId: t.arg.string({ required: true }),
      classToken: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      enabled: t.arg.boolean({ required: true }),
    },
    resolve: async (_r, args, ctx) =>
      setEnablement(
        args.academicYearId,
        args.classToken as MasteryClassToken,
        args.subject as MasterySubject,
        args.enabled,
        actorOf(ctx),
      ),
  }),
}));
