/**
 * Student support profile — শিক্ষার্থী সহায়তা প্রোফাইল (docs/prd-child-support-profile.md, CSP-1).
 *
 *   saveSupportReportDraft / submitSupportReport / withdrawSupportReport   support_profile:report
 *   raiseSafeguardingConcern (the always-present button)                  support_profile:report
 *   mySupportReportsPage                                                  support_profile:report (own)
 *   supportReport                                                         report (own) | approve | view_all
 *   supportCard / supportProfileView                                      support_profile:view | view_all
 *   supportProfileChips (existence only, not audited)                     support_profile:view | view_all
 *   supportQueuePage / decideSupportReport / resolveSupportSafeguardingHold  support_profile:approve
 *   supportProfilesPage                                                   support_profile:view_all
 *   openSupportProfile / closeSupportProfile / reopenSupportProfile       support_profile:manage
 *   supportProfileSetting / setSupportProfileSwitch                       support_profile:manage
 *
 * Every resolver also passes `supportCaller` (OFFICE / GUARDIAN refused whatever is stored; "view as"
 * refused unless the real person holds view_all) and the per-child reader check (§8.2).
 */
import { builder } from "../../../schema";
import { pageRef } from "../../../pageRef";
import { SUPPORT_TEXT_FIELDS, type SupportTextField } from "@scd/shared";
import type { ISupportReport } from "../models/SupportReport";
import type { SupportItem } from "../models/SupportProfileVersion";
import {
  decideSupportReport,
  myReportsPage,
  queuePage,
  raiseSafeguardingConcern,
  readReport,
  resolveSafeguardingHold,
  saveSupportDraft,
  submitSupportReport,
  withdrawSupportReport,
  type ReportView,
  type SubmitOutcome,
  type SupportReportInput,
} from "../services/SupportReportService";
import { chipStudentIds, openProfile, profilesPage, readProfile, setProfileStatus, setSwitch, type ProfileView } from "../services/SupportProfileService";
import { getSupportSetting, supportCaller } from "../services/supportAccess";

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

const TermHitRef = builder.objectRef<{ field: string; term: string; kind?: string }>("SupportTermHit").implement({
  fields: (t) => ({
    field: t.exposeString("field"),
    term: t.exposeString("term"),
    kind: t.string({ nullable: true, resolve: (h) => h.kind ?? null }),
  }),
});

const QuestionRef = builder
  .objectRef<{ flagId: string; field: string; severity: string; quote: string; askBn: string; suggestionBn?: string | null }>("SupportReportQuestion")
  .implement({
    description: "A question a batch sent back (§6.12) — never a category code, never 'bias'.",
    fields: (t) => ({
      flagId: t.exposeString("flagId"),
      field: t.exposeString("field"),
      severity: t.exposeString("severity"),
      quote: t.exposeString("quote"),
      askBn: t.exposeString("askBn"),
      suggestionBn: t.string({ nullable: true, resolve: (q) => q.suggestionBn ?? null }),
    }),
  });

const EditRef = builder.objectRef<{ field: string; before: string; after: string }>("SupportReportEdit").implement({
  description: "The Principal's wording change on one field, shown to the author as আগে → পরে (Q-10).",
  fields: (t) => ({ field: t.exposeString("field"), before: t.exposeString("before"), after: t.exposeString("after") }),
});

const txt = (v: ReportView, s: string | null | undefined): string | null => (v.textVisible ? (s ?? "") : null);

function editsOf(r: ISupportReport): { field: string; before: string; after: string }[] {
  if (!r.principalEdited || !r.submittedText || !r.approvedText) return [];
  const s = r.submittedText as unknown as Record<SupportTextField, string>;
  const a = r.approvedText as unknown as Record<SupportTextField, string>;
  return SUPPORT_TEXT_FIELDS.filter((f) => (s[f] ?? "") !== (a[f] ?? "")).map((f) => ({ field: f, before: s[f] ?? "", after: a[f] ?? "" }));
}

const ReportRef = builder.objectRef<ReportView>("SupportReport").implement({
  description: "One support report (§5.3). Text fields are null when the viewer may see only its status.",
  fields: (t) => ({
    id: t.string({ resolve: (v) => String(v.r._id) }),
    studentId: t.string({ resolve: (v) => String(v.r.studentId) }),
    studentName: t.string({ nullable: true, resolve: (v) => v.studentName }),
    authorName: t.string({ nullable: true, description: "Principal-only.", resolve: (v) => v.authorName }),
    textVisible: t.boolean({ resolve: (v) => v.textVisible }),
    status: t.string({ resolve: (v) => v.r.status }),
    source: t.string({ resolve: (v) => v.r.source }),
    authorVia: t.string({ resolve: (v) => v.r.authorVia }),
    occurredOn: t.string({ resolve: (v) => (v.metaVisible === false ? "" : v.r.occurredOn) }),
    subject: t.string({ nullable: true, resolve: (v) => (v.textVisible ? v.r.subject : null) }),
    periodNo: t.int({ nullable: true, resolve: (v) => (v.textVisible ? v.r.periodNo : null) }),
    context: t.string({ nullable: true, resolve: (v) => (v.textVisible ? v.r.context : null) }),
    antecedentTags: t.stringList({ resolve: (v) => (v.textVisible ? v.r.antecedentTags : []) }),
    situation: t.string({ nullable: true, resolve: (v) => txt(v, v.r.situation) }),
    settingNote: t.string({ nullable: true, resolve: (v) => txt(v, v.r.settingNote) }),
    behaviour: t.string({ nullable: true, resolve: (v) => txt(v, v.r.behaviour) }),
    howOften: t.string({ nullable: true, resolve: (v) => (v.textVisible ? v.r.howOften : null) }),
    minutes: t.int({ nullable: true, resolve: (v) => (v.textVisible ? v.r.minutes : null) }),
    tried: t.string({ nullable: true, resolve: (v) => txt(v, v.r.tried) }),
    starterKeys: t.stringList({ resolve: (v) => (v.textVisible ? v.r.starterKeys : []) }),
    result: t.string({ nullable: true, resolve: (v) => (v.textVisible ? v.r.result : null) }),
    resultNote: t.string({ nullable: true, resolve: (v) => txt(v, v.r.resultNote) }),
    gotOrAvoided: t.stringList({ resolve: (v) => (v.textVisible ? v.r.gotOrAvoided : []) }),
    exception: t.string({ nullable: true, resolve: (v) => txt(v, v.r.exception) }),
    whatWorked: t.string({ nullable: true, resolve: (v) => txt(v, v.r.whatWorked) }),
    goodThingText: t.string({ nullable: true, resolve: (v) => (v.textVisible ? (v.r.goodThing?.textBn ?? null) : null) }),
    goodThingNone: t.boolean({ resolve: (v) => !!v.r.goodThing?.none }),
    goodThingReasonKey: t.string({ nullable: true, resolve: (v) => (v.textVisible ? (v.r.goodThing?.reasonKey ?? null) : null) }),
    goodThingReasonBn: t.string({ nullable: true, resolve: (v) => (v.textVisible ? (v.r.goodThing?.reasonBn ?? null) : null) }),
    tone: t.string({ resolve: (v) => (v.metaVisible === false ? "" : v.r.tone) }),
    signs: t.stringList({ description: "Draft save only: safeguarding signs found (the app asks the question).", resolve: (v) => v.signs ?? [] }),
    round: t.int({ resolve: (v) => v.r.round }),
    safeguardingHold: t.string({ resolve: (v) => v.r.safeguardingHold }),
    checkSkipped: t.string({ resolve: (v) => v.r.checkSkipped }),
    askHits: t.field({ type: [TermHitRef], resolve: (v) => (v.textVisible ? v.r.askHits : []) }),
    questions: t.field({ type: [QuestionRef], resolve: (v) => (v.textVisible ? v.r.returnQuestions : []) }),
    principalEdited: t.boolean({ resolve: (v) => v.r.principalEdited }),
    edits: t.field({ type: [EditRef], resolve: (v) => (v.textVisible ? editsOf(v.r) : []) }),
    decisionReasonBn: t.string({ nullable: true, resolve: (v) => (v.textVisible ? v.r.decisionReasonBn : null) }),
    createdAt: t.string({ resolve: (v) => v.r.createdAt.toISOString() }),
  }),
});
const ReportPageRef = pageRef("SupportReportPage", ReportRef);

const QueuePageRef = builder
  .objectRef<{ rows: ReportView[]; total: number; page: number; pageSize: number; waiting: number; oldestDays: number | null; held: number }>("SupportQueuePage")
  .implement({
    fields: (t) => ({
      rows: t.field({ type: [ReportRef], resolve: (p) => p.rows }),
      total: t.exposeInt("total"),
      page: t.exposeInt("page"),
      pageSize: t.exposeInt("pageSize"),
      waiting: t.exposeInt("waiting", { description: "প্রক্রিয়ার অপেক্ষায় — TO_PROCESS count" }),
      oldestDays: t.int({ nullable: true, resolve: (p) => p.oldestDays }),
      held: t.exposeInt("held", { description: "Reports with an open safeguarding question (pinned on top)." }),
    }),
  });

const SubmitOutcomeRef = builder.objectRef<SubmitOutcome>("SupportSubmitOutcome").implement({
  description: "SAVED · BLOCKED (a blocked word or another child's name) · SAFEGUARDING_QUESTION (answer YES/NO) · ROUTED.",
  fields: (t) => ({
    outcome: t.exposeString("outcome"),
    report: t.field({ type: ReportRef, nullable: true, resolve: (o) => (o.report ? { r: o.report, textVisible: true, studentName: null, authorName: null } : null) }),
    blocked: t.field({ type: [TermHitRef], resolve: (o) => o.blocked }),
    askHits: t.field({ type: [TermHitRef], resolve: (o) => o.askHits }),
    signs: t.stringList({ resolve: (o) => o.signs }),
    balanceNudge: t.exposeBoolean("balanceNudge"),
  }),
});

const ItemRef = builder.objectRef<SupportItem & { stale?: boolean; dormant?: boolean; insteadText?: string | null }>("SupportProfileItem").implement({
  fields: (t) => ({
    itemId: t.exposeString("itemId"),
    textBn: t.exposeString("textBn"),
    level: t.string({ nullable: true, resolve: (i) => i.level }),
    obsCount: t.exposeInt("obsCount"),
    teachersCount: t.exposeInt("teachersCount"),
    settings: t.stringList({ resolve: (i) => i.settings ?? [] }),
    lastEvidenceKey: t.string({ nullable: true, resolve: (i) => i.lastEvidenceKey }),
    hasGuardianInfo: t.boolean({ resolve: (i) => !!i.hasGuardianInfo }),
    mixed: t.boolean({ resolve: (i) => !!i.mixed }),
    kind: t.string({ nullable: true, resolve: (i) => i.kind ?? null }),
    functionTag: t.string({ nullable: true, resolve: (i) => i.functionTag ?? null }),
    skillKey: t.string({ nullable: true, resolve: (i) => i.skillKey ?? null }),
    baselineBn: t.string({ nullable: true, resolve: (i) => i.baselineBn ?? null }),
    expectedBn: t.string({ nullable: true, resolve: (i) => i.expectedBn ?? null }),
    insteadText: t.string({ nullable: true, resolve: (i) => i.insteadText ?? null }),
    stale: t.boolean({ resolve: (i) => !!i.stale }),
    dormant: t.boolean({ resolve: (i) => !!i.dormant }),
  }),
});
const SectionRef = builder.objectRef<ProfileView["sections"][number]>("SupportProfileSection").implement({
  fields: (t) => ({ section: t.exposeString("section"), items: t.field({ type: [ItemRef], resolve: (s) => s.items }) }),
});
const CardRef = builder.objectRef<NonNullable<ProfileView["card"]>>("SupportCard").implement({
  fields: (t) => ({
    strengths: t.field({ type: [ItemRef], resolve: (c) => c.strengths }),
    dos: t.field({ type: [ItemRef], resolve: (c) => c.dos }),
    avoids: t.field({ type: [ItemRef], resolve: (c) => c.avoids }),
    goal: t.field({ type: ItemRef, nullable: true, resolve: (c) => c.goal }),
  }),
});
const ProfileViewRef = builder.objectRef<ProfileView>("SupportProfileView").implement({
  fields: (t) => ({
    studentId: t.string({ resolve: (v) => String(v.profile.studentId) }),
    studentName: t.exposeString("studentName"),
    status: t.string({ resolve: (v) => v.profile.status }),
    versionNo: t.int({ nullable: true, resolve: (v) => v.version?.versionNo ?? null }),
    publishedAt: t.string({ nullable: true, resolve: (v) => v.version?.publishedAt?.toISOString() ?? null }),
    safeguardingBanner: t.boolean({ resolve: (v) => !!v.profile.safeguardingBanner }),
    sections: t.field({ type: [SectionRef], resolve: (v) => v.sections }),
    card: t.field({ type: CardRef, nullable: true, resolve: (v) => v.card }),
  }),
});

const ProfileRowRef = builder
  .objectRef<{ id: string; studentId: string; studentName: string; classId: string; status: string; published: boolean; nextReviewDueKey: string | null }>("SupportProfileRow")
  .implement({
    fields: (t) => ({
      id: t.exposeString("id"),
      studentId: t.exposeString("studentId"),
      studentName: t.exposeString("studentName"),
      classId: t.exposeString("classId"),
      status: t.exposeString("status"),
      published: t.exposeBoolean("published"),
      nextReviewDueKey: t.string({ nullable: true, resolve: (r) => r.nextReviewDueKey }),
    }),
  });
const ProfileRowPageRef = pageRef("SupportProfileRowPage", ProfileRowRef);

const SettingRef = builder
  .objectRef<{ switchedOnKey: string | null; defaultMode: string; approvalLoadReviewDueKey: string | null; packBudgetTokens: number; batchReminderDays: number }>("SupportProfileSetting")
  .implement({
    fields: (t) => ({
      switchedOn: t.boolean({ resolve: (s) => !!s.switchedOnKey }),
      switchedOnKey: t.string({ nullable: true, resolve: (s) => s.switchedOnKey }),
      defaultMode: t.exposeString("defaultMode"),
      approvalLoadReviewDueKey: t.string({ nullable: true, resolve: (s) => s.approvalLoadReviewDueKey }),
      packBudgetTokens: t.exposeInt("packBudgetTokens"),
      batchReminderDays: t.exposeInt("batchReminderDays"),
    }),
  });

const ReportInput = builder.inputType("SupportReportInput", {
  description: "A support report (§5.3, §9.3): before → what the child did → after, + the good thing (OA-2).",
  fields: (t) => ({
    studentId: t.string({ required: true }),
    source: t.string({ required: false }),
    seedCommentId: t.string({ required: false }),
    occurredOn: t.string({ required: true }),
    groupType: t.string({ required: false }),
    groupId: t.string({ required: false }),
    subject: t.string({ required: false }),
    periodNo: t.int({ required: false }),
    context: t.string({ required: false }),
    antecedentTags: t.stringList({ required: false }),
    situation: t.string({ required: false }),
    settingNote: t.string({ required: false }),
    behaviour: t.string({ required: false }),
    howOften: t.string({ required: false }),
    minutes: t.int({ required: false }),
    tried: t.string({ required: false }),
    starterKeys: t.stringList({ required: false }),
    result: t.string({ required: false }),
    resultNote: t.string({ required: false }),
    gotOrAvoided: t.stringList({ required: false }),
    exception: t.string({ required: false }),
    whatWorked: t.string({ required: false }),
    goodThingText: t.string({ required: false }),
    goodThingNone: t.boolean({ required: false }),
    goodThingReasonKey: t.string({ required: false }),
    goodThingReasonBn: t.string({ required: false }),
    tone: t.string({ required: true }),
  }),
});

const QuestionAnswerInput = builder.inputType("SupportQuestionAnswerInput", {
  fields: (t) => ({
    flagId: t.string({ required: true }),
    answer: t.string({ required: true, description: "REWRITTEN · USED_SUGGESTION · DISAGREE · DONT_REMEMBER" }),
    reasonBn: t.string({ required: false }),
  }),
});

const EditedTextInput = builder.inputType("SupportEditedTextInput", {
  fields: (t) => Object.fromEntries(SUPPORT_TEXT_FIELDS.map((f) => [f, t.string({ required: false })])) as never,
});

// ---------------------------------------------------------------------------------------------
// Teacher: intake
// ---------------------------------------------------------------------------------------------

builder.mutationField("saveSupportReportDraft", (t) =>
  t.field({
    type: ReportRef,
    description: "খসড়া রাখুন — a draft (≤ 3 open per child).",
    authScopes: { hasPermission: "support_profile:report" },
    args: { input: t.arg({ type: ReportInput, required: true }), reportId: t.arg.string({ required: false }) },
    resolve: async (_r, a, ctx) => {
      const d = await saveSupportDraft(ctx, a.input as SupportReportInput, a.reportId);
      return { r: d.report, textVisible: true, studentName: null, authorName: null, signs: d.signs };
    },
  }),
);

builder.mutationField("submitSupportReport", (t) =>
  t.field({
    type: SubmitOutcomeRef,
    description: "জমা দিন — saved as TO_PROCESS with no AI (§6.9). Also the rewrite of a returned / questioned report.",
    authScopes: { hasPermission: "support_profile:report" },
    args: {
      input: t.arg({ type: ReportInput, required: true }),
      reportId: t.arg.string({ required: false }),
      safeguardingAnswer: t.arg.string({ required: false, description: "YES · NO — the answer to the safeguarding question" }),
      questionAnswers: t.arg({ type: [QuestionAnswerInput], required: false }),
    },
    resolve: (_r, a, ctx) =>
      submitSupportReport(ctx, a.input as SupportReportInput, {
        reportId: a.reportId,
        safeguardingAnswer: a.safeguardingAnswer === "YES" || a.safeguardingAnswer === "NO" ? a.safeguardingAnswer : null,
        questionAnswers: a.questionAnswers ?? null,
      }),
  }),
);

builder.mutationField("withdrawSupportReport", (t) =>
  t.field({
    type: ReportRef,
    authScopes: { hasPermission: "support_profile:report" },
    args: { reportId: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => ({ r: await withdrawSupportReport(ctx, a.reportId), textVisible: false, studentName: null, authorName: null }),
  }),
);

builder.mutationField("raiseSafeguardingConcern", (t) =>
  t.boolean({
    description: "শিশুর নিরাপত্তা নিয়ে উদ্বেগ — a referral straight to the Principal (§16.5 SG-2). Works with the AI off.",
    authScopes: { hasPermission: "support_profile:report" },
    args: { studentId: t.arg.string({ required: true }), textBn: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => raiseSafeguardingConcern(ctx, a.studentId, a.textBn),
  }),
);

builder.queryField("mySupportReportsPage", (t) =>
  t.field({
    type: ReportPageRef,
    description: "আমার রিপোর্ট — own reports, at once, with their status.",
    authScopes: { hasPermission: "support_profile:report" },
    args: { page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: (_r, a, ctx) => myReportsPage(ctx, a),
  }),
);

builder.queryField("supportReport", (t) =>
  t.field({
    type: ReportRef,
    authScopes: { hasAnyPermission: ["support_profile:report", "support_profile:approve", "support_profile:view_all"] },
    args: { reportId: t.arg.string({ required: true }), via: t.arg.string({ required: false }) },
    resolve: (_r, a, ctx) => readReport(ctx, a.reportId, a.via ?? "QUEUE"),
  }),
);

// ---------------------------------------------------------------------------------------------
// Readers: the card and the full profile
// ---------------------------------------------------------------------------------------------

builder.queryField("supportProfileView", (t) =>
  t.field({
    type: ProfileViewRef,
    nullable: true,
    description: "The card (surface CARD) or the full profile (FULL) of a child — audited on every open.",
    authScopes: { hasAnyPermission: ["support_profile:view", "support_profile:view_all"] },
    args: { studentId: t.arg.string({ required: true }), surface: t.arg.string({ required: true }), via: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => readProfile(ctx, a.studentId, a.surface === "FULL" ? "FULL" : "CARD", a.via),
  }),
);

builder.queryField("supportProfileChips", (t) =>
  t.stringList({
    description: "Which of these children have a published profile this caller may read (no content; not audited).",
    authScopes: { hasAnyPermission: ["support_profile:view", "support_profile:view_all"] },
    args: { studentIds: t.arg.stringList({ required: true }) },
    resolve: (_r, a, ctx) => chipStudentIds(ctx, a.studentIds),
  }),
);

// ---------------------------------------------------------------------------------------------
// The Principal
// ---------------------------------------------------------------------------------------------

builder.queryField("supportQueuePage", (t) =>
  t.field({
    type: QueuePageRef,
    description: "Waiting (TO_PROCESS) and processed reports; a safeguarding question pinned on top.",
    authScopes: { hasPermission: "support_profile:approve" },
    args: { status: t.arg.string({ required: false }), page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: (_r, a, ctx) => queuePage(ctx, a),
  }),
);

builder.mutationField("decideSupportReport", (t) =>
  t.field({
    type: ReportRef,
    description: "অনুমোদন · সম্পাদনা করে অনুমোদন · ফেরত পাঠান · প্রোফাইলে যাবে না — also directly on a waiting report (§6.7).",
    authScopes: { hasPermission: "support_profile:approve" },
    args: {
      reportId: t.arg.string({ required: true }),
      decision: t.arg.string({ required: true }),
      reasonBn: t.arg.string({ required: false }),
      edited: t.arg({ type: EditedTextInput, required: false }),
    },
    resolve: async (_r, a, ctx) => {
      const d = a.decision as "APPROVED" | "APPROVED_EDITED" | "RETURNED" | "NOT_USED";
      const r = await decideSupportReport(ctx, { reportId: a.reportId, decision: d, reasonBn: a.reasonBn, edited: (a.edited ?? null) as never });
      return { r, textVisible: false, studentName: null, authorName: null };
    },
  }),
);

builder.mutationField("resolveSupportSafeguardingHold", (t) =>
  t.field({
    type: ReportRef,
    description: "হ্যাঁ, সুরক্ষার বিষয় (YES → referral, report routed) · না, সাধারণ ঘটনা (NO → hold cleared).",
    authScopes: { hasPermission: "support_profile:approve" },
    args: { reportId: t.arg.string({ required: true }), answer: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => ({ r: await resolveSafeguardingHold(ctx, a.reportId, a.answer === "YES" ? "YES" : "NO"), textVisible: false, studentName: null, authorName: null }),
  }),
);

builder.queryField("supportProfilesPage", (t) =>
  t.field({
    type: ProfileRowPageRef,
    description: "Profiles by class and name — never ordered by concern (§9.5).",
    authScopes: { hasPermission: "support_profile:view_all" },
    args: { status: t.arg.string({ required: false }), page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: (_r, a, ctx) => profilesPage(ctx, a),
  }),
);

builder.mutationField("openSupportProfile", (t) =>
  t.boolean({
    authScopes: { hasPermission: "support_profile:manage" },
    args: { studentId: t.arg.string({ required: true }), reasonBn: t.arg.string({ required: false }) },
    resolve: async (_r, a, ctx) => !!(await openProfile(ctx, a.studentId, a.reasonBn)),
  }),
);
builder.mutationField("closeSupportProfile", (t) =>
  t.boolean({
    authScopes: { hasPermission: "support_profile:manage" },
    args: { studentId: t.arg.string({ required: true }), reasonBn: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => !!(await setProfileStatus(ctx, a.studentId, "CLOSED", a.reasonBn)),
  }),
);
builder.mutationField("reopenSupportProfile", (t) =>
  t.boolean({
    authScopes: { hasPermission: "support_profile:manage" },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => !!(await setProfileStatus(ctx, a.studentId, "OPEN")),
  }),
);

builder.queryField("supportProfileSetting", (t) =>
  t.field({
    type: SettingRef,
    authScopes: { hasPermission: "support_profile:manage" },
    resolve: async (_r, _a, ctx) => {
      await supportCaller(ctx);
      return getSupportSetting();
    },
  }),
);
builder.mutationField("setSupportProfileSwitch", (t) =>
  t.field({
    type: SettingRef,
    description: "Switch the feature on for all classes and teachers (CSP-6) — ships OFF.",
    authScopes: { hasPermission: "support_profile:manage" },
    args: { on: t.arg.boolean({ required: true }) },
    resolve: (_r, a, ctx) => setSwitch(ctx, a.on),
  }),
);
