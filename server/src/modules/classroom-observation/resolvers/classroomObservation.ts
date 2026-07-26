/**
 * Classroom-observation resolvers (CO-1, prd-classroom-observation §5/§6, D-#147/#191).
 *
 * RBAC — the FOUR new app-native permissions (the sensitive part):
 *   - uploadClassroomObservation / assignClassroomObserver / reRequestClassroomObservation:
 *     `observation:upload` (Principal/Office). The conflict guard (observer ≠ observed
 *     teacher) is enforced in the service.
 *   - reviewClassroomObservation: `observation:review` (a TEACHER base perm) AND the
 *     service gates it to the ASSIGNED observerId — a different teacher with the perm
 *     is refused. On submit the observation is REVIEWED and released to the observed
 *     teacher (developmental — NO Principal sign-off, REF-11 §1.3).
 *   - reads (`classroomObservation` / `teacherClassroomObservations`): `observation:read`,
 *     ROW-SCOPED via the pure `canReadObservation` predicate (observer own; observed
 *     teacher own at/after REVIEWED; Principal/Office all). `myObservationReviewQueue`
 *     is the observer's own ASSIGNED queue (`observation:review`); `myObservationReviews`
 *     (CO-11, D-#363) is their own FULL history — same filter engine as the oversight
 *     read with `observerId` forced to the caller, so there is no peer path.
 *   - `observationPriorFocusContext` (CO-10, D-#363): `observation:read` + a SECOND gate
 *     (`canReadPriorContext` — the row's assigned observer, or a manager). It is the one
 *     read that shows a slice of ANOTHER observer's row, so the returned field set is
 *     itself the visibility rule — see `PriorFocusContextRef` below.
 *
 * Staff-internal — GUARDIAN holds no observation:* permission (§7). Identity plane
 * (names teacherId/observerId); no corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import {
  uploadObservation,
  assignObserver,
  reviewObservation,
  publishObservation,
  requestReReview,
  requestCoReview,
  respondToObservation,
  getObservation,
  observationsForTeacher,
  observationsForRecording,
  allObservationsPaged,
  observerReviewsPaged,
  myReviewQueue,
  canReadObservation,
  priorObservationContext,
  canReadPriorContext,
  type ObservationActor,
  type ClassroomObservationShape,
  type ObservationPageShape,
  type PriorFocusContextShape,
} from "../services/ClassroomObservationService";
import {
  getEscalationConfig,
  setEscalationConfig,
  type EffectiveEscalationConfig,
} from "../services/ObservationEscalationService";

/** Build the row-scope actor from the request context (manage = Principal/Office). */
function actorOf(ctx: AppContext): ObservationActor {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  const role = ctx.auth.role;
  return { userId: ctx.auth.userId as string, canManage: role === "PRINCIPAL" || role === "OFFICE" };
}

// ---------------------------------------------------------------------------
// GraphQL shapes
// ---------------------------------------------------------------------------

const DomainScoreRef = builder.objectRef<ClassroomObservationShape["domains"][number]>("ObservationDomainScore");
DomainScoreRef.implement({
  description: "One REF-11 domain score: the domain code, level 1–4, and a note. No total/average.",
  fields: (t) => ({
    domain: t.exposeString("domain"),
    level: t.exposeInt("level"),
    note: t.exposeString("note"),
  }),
});

const GateScoreRef = builder.objectRef<ClassroomObservationShape["gates"][number]>("ObservationGateScore");
GateScoreRef.implement({
  description: "One REF-11 gate result: PASS/BREACH (+ optional breach note). A BREACH stands on its own (§2.1).",
  fields: (t) => ({
    gate: t.exposeString("gate"),
    result: t.exposeString("result"),
    breachNote: t.string({ nullable: true, resolve: (r) => r.breachNote }),
  }),
});

// --- Quran (ClassEcho) form payload shapes (CO-5) -------------------------------
type QuranPayloadShape = NonNullable<ClassroomObservationShape["quran"]>;

const QuranRatingRef = builder.objectRef<QuranPayloadShape["ratings"][number]>("ObservationQuranRating");
QuranRatingRef.implement({
  description: "One Quran (ClassEcho) rating: the criterion, a score 1–5, and an optional note. No total/average.",
  fields: (t) => ({
    criterion: t.exposeString("criterion"),
    score: t.exposeInt("score"),
    note: t.string({ nullable: true, resolve: (r) => r.note }),
  }),
});

const QuranComplianceRef = builder.objectRef<QuranPayloadShape["compliance"][number]>("ObservationQuranCompliance");
QuranComplianceRef.implement({
  description: "One Quran-form compliance item: the item code and its yes/no answer.",
  fields: (t) => ({
    item: t.exposeString("item"),
    yesNo: t.exposeBoolean("yesNo"),
  }),
});

const QuranPayloadRef = builder.objectRef<QuranPayloadShape>("ObservationQuranPayload");
QuranPayloadRef.implement({
  description:
    "The Quran (ClassEcho) form payload (CO-5): 8 ratings (1–5) + 7 yes/no compliance items + strengths / " +
    "improvements / suggestions. Set on a QURAN-form observation only; null on a REF-11 one.",
  fields: (t) => ({
    ratings: t.field({ type: [QuranRatingRef], resolve: (r) => r.ratings }),
    compliance: t.field({ type: [QuranComplianceRef], resolve: (r) => r.compliance }),
    strengths: t.exposeString("strengths"),
    improvements: t.exposeString("improvements"),
    suggestions: t.exposeString("suggestions"),
  }),
});

const ObservationRef = builder.objectRef<ClassroomObservationShape>("ClassroomObservation");
ObservationRef.implement({
  description:
    "A classroom observation on the REF-11 form (CO-1): session anchor + the assigned observer's scoring. " +
    "Since CO-8 (D-#271) REVIEWED is observer/Principal-only; a Principal/Office PUBLISH (publishedAt) releases " +
    "it to the observed teacher. Identity plane (ADR-005).",
  fields: (t) => ({
    id: t.exposeString("id"),
    form: t.exposeString("form"),
    routineSlotId: t.string({ nullable: true, resolve: (r) => r.routineSlotId }),
    sectionId: t.string({ nullable: true, resolve: (r) => r.sectionId }),
    subjectGroupId: t.string({ nullable: true, resolve: (r) => r.subjectGroupId }),
    subject: t.exposeString("subject"),
    teacherId: t.exposeString("teacherId"),
    classDate: t.exposeString("classDate"),
    periodNumber: t.int({ nullable: true, resolve: (r) => r.periodNumber }),
    observerId: t.string({ nullable: true, resolve: (r) => r.observerId }),
    state: t.exposeString("state"),
    createdBy: t.exposeString("createdBy"),
    assignedAt: t.string({ nullable: true, resolve: (r) => r.assignedAt }),
    reviewedAt: t.string({ nullable: true, resolve: (r) => r.reviewedAt }),
    publishedAt: t.string({ nullable: true, resolve: (r) => r.publishedAt }),
    publishedBy: t.string({ nullable: true, resolve: (r) => r.publishedBy }),
    domains: t.field({ type: [DomainScoreRef], resolve: (r) => r.domains }),
    gates: t.field({ type: [GateScoreRef], resolve: (r) => r.gates }),
    oneStrength: t.string({ nullable: true, resolve: (r) => r.oneStrength }),
    growthFocus: t.string({ nullable: true, resolve: (r) => r.growthFocus }),
    prevObservationId: t.string({ nullable: true, resolve: (r) => r.prevObservationId }),
    priorFocusProgress: t.string({ nullable: true, resolve: (r) => r.priorFocusProgress }),
    priorFocusNote: t.string({ nullable: true, resolve: (r) => r.priorFocusNote }),
    quran: t.field({ type: QuranPayloadRef, nullable: true, resolve: (r) => r.quran }),
    // CO-7 privacy: the actual scores are visible only to observation:manage (Principal/Office) so the
    // rated OBSERVER never sees their per-observation fairness score. hasFairnessRating is a safe
    // boolean flag for all readers — lets the observed teacher confirm their rating was recorded without
    // revealing the score, and lets the Principal see whether a rating exists.
    hasFairnessRating: t.boolean({ resolve: (r) => r.fairnessRating !== null }),
    fairnessRating: t.int({
      nullable: true,
      resolve: (r, _args, ctx: AppContext) => {
        const role = ctx.auth?.role;
        return role === "PRINCIPAL" || role === "OFFICE" ? r.fairnessRating : null;
      },
    }),
    usefulnessRating: t.int({
      nullable: true,
      resolve: (r, _args, ctx: AppContext) => {
        const role = ctx.auth?.role;
        return role === "PRINCIPAL" || role === "OFFICE" ? r.usefulnessRating : null;
      },
    }),
    recordingId: t.string({ nullable: true, resolve: (r) => r.recordingId }),
    teacherResponse: t.string({ nullable: true, resolve: (r) => r.teacherResponse }),
    supersededById: t.string({ nullable: true, resolve: (r) => r.supersededById }),
    createdAt: t.exposeString("createdAt"),
    updatedAt: t.exposeString("updatedAt"),
  }),
});

// --- CO-10 prior-focus carry-forward slice (D-#363) -----------------------------
// This type IS the visibility decision: it is the exact set of fields an observer may
// see of ANOTHER observer's row. No domains, no gates, no teacher response, no fairness
// rating, and no observerId — peer scores and peer identity stay private (D-#28).
// Adding a field here widens a decided rule; do not, without a new ADR row.
const PriorFocusContextRef = builder.objectRef<PriorFocusContextShape>("ObservationPriorFocusContext");
PriorFocusContextRef.implement({
  description:
    "The prior observation whose growth focus this review carries forward (CO-10, D-#363) — a NARROW slice: what " +
    "focus was set, when, in which subject, and how the prior review judged its own predecessor. Deliberately " +
    "carries NO scores, NO teacher response and NO observer identity.",
  fields: (t) => ({
    observationId: t.exposeString("observationId"),
    classDate: t.exposeString("classDate"),
    subject: t.exposeString("subject"),
    form: t.exposeString("form"),
    growthFocus: t.string({ nullable: true, resolve: (r) => r.growthFocus }),
    oneStrength: t.string({ nullable: true, resolve: (r) => r.oneStrength }),
    priorFocusProgress: t.string({ nullable: true, resolve: (r) => r.priorFocusProgress }),
    sameSubject: t.exposeBoolean("sameSubject"),
    isReReview: t.exposeBoolean("isReReview"),
  }),
});

const ObservationPageRef = builder.objectRef<ObservationPageShape>("ClassroomObservationPage");
ObservationPageRef.implement({
  description:
    "A page of classroom observations (oversight view): the items plus the UNPAGED total and a hasMore flag (WS1).",
  fields: (t) => ({
    items: t.field({ type: [ObservationRef], resolve: (r) => r.items }),
    total: t.exposeInt("total"),
    hasMore: t.exposeBoolean("hasMore"),
  }),
});

const DomainInputType = builder.inputType("Ref11DomainInput", {
  description: "One REF-11 domain score: domain code (D1..D5), level 1–4, and a note.",
  fields: (t) => ({
    domain: t.string({ required: true }),
    level: t.int({ required: true }),
    note: t.string({ required: true }),
  }),
});

const GateInputType = builder.inputType("Ref11GateInput", {
  description: "One REF-11 gate result: gate code (G1,G2), PASS/BREACH, and an optional breach note.",
  fields: (t) => ({
    gate: t.string({ required: true }),
    result: t.string({ required: true }),
    breachNote: t.string({ required: false }),
  }),
});

// --- Quran (ClassEcho) form review input (CO-5) ---------------------------------
const QuranRatingInputType = builder.inputType("QuranRatingInput", {
  description: "One Quran (ClassEcho) rating: criterion code, a score 1–5, and an optional note.",
  fields: (t) => ({
    criterion: t.string({ required: true }),
    score: t.int({ required: true }),
    note: t.string({ required: false }),
  }),
});

const QuranComplianceInputType = builder.inputType("QuranComplianceInput", {
  description: "One Quran-form compliance item: the item code and its yes/no answer.",
  fields: (t) => ({
    item: t.string({ required: true }),
    yesNo: t.boolean({ required: true }),
  }),
});

const QuranPayloadInputType = builder.inputType("QuranReviewInput", {
  description:
    "The Quran (ClassEcho) form review payload (CO-5): 8 ratings + 7 yes/no compliance items + strengths / " +
    "improvements / suggestions. Provide ONLY when reviewing a QURAN-form observation.",
  fields: (t) => ({
    ratings: t.field({ type: [QuranRatingInputType], required: true }),
    compliance: t.field({ type: [QuranComplianceInputType], required: true }),
    strengths: t.string({ required: true }),
    improvements: t.string({ required: true }),
    suggestions: t.string({ required: true }),
  }),
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

builder.mutationField("uploadClassroomObservation", (t) =>
  t.field({
    type: ObservationRef,
    description:
      "Upload a recorded session + (optionally) assign a senior-teacher observer in one step (J1). " +
      "The observer can NOT be the observed teacher (refused). Requires observation:upload (Principal/Office). Audited.",
    authScopes: { hasPermission: "observation:upload" },
    args: {
      form: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      teacherId: t.arg.string({ required: true }),
      classDate: t.arg.string({ required: true }),
      sectionId: t.arg.string({ required: false }),
      subjectGroupId: t.arg.string({ required: false }),
      routineSlotId: t.arg.string({ required: false }),
      periodNumber: t.arg.int({ required: false }),
      recordingId: t.arg.string({ required: false }),
      observerId: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const actor = actorOf(ctx);
      return uploadObservation({
        form: args.form,
        subject: args.subject,
        teacherId: args.teacherId,
        classDate: args.classDate,
        sectionId: args.sectionId ?? undefined,
        subjectGroupId: args.subjectGroupId ?? undefined,
        routineSlotId: args.routineSlotId ?? undefined,
        periodNumber: args.periodNumber ?? undefined,
        recordingId: args.recordingId ?? undefined,
        observerId: args.observerId ?? undefined,
        actorId: actor.userId,
      });
    },
  }),
);

builder.mutationField("assignClassroomObserver", (t) =>
  t.field({
    type: ObservationRef,
    description:
      "(Re)assign the observer on an uploaded/assigned observation → ASSIGNED. Observer ≠ observed teacher " +
      "(refused). Requires observation:upload (Principal/Office). Audited.",
    authScopes: { hasPermission: "observation:upload" },
    args: {
      observationId: t.arg.string({ required: true }),
      observerId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const actor = actorOf(ctx);
      return assignObserver({ observationId: args.observationId, observerId: args.observerId, actorId: actor.userId });
    },
  }),
);

builder.mutationField("reviewClassroomObservation", (t) =>
  t.field({
    type: ObservationRef,
    description:
      "The assigned observer scores + comments. REF-11 form: exactly 5 domain levels + notes, 2 gate results, " +
      "1 strength, 1 growth focus — no average. QURAN form (CO-5): pass `quran` (8 ratings 1–5 + 7 yes/no + " +
      "strengths/improvements/suggestions). The form decides which payload is required. → REVIEWED, released to " +
      "the observed teacher (no Principal sign-off). Requires observation:review AND being the assigned observer. Audited.",
    authScopes: { hasPermission: "observation:review" },
    args: {
      observationId: t.arg.string({ required: true }),
      // REF-11 payload (optional at the GraphQL layer; the service requires it for a
      // REF-11 row + refuses it on a QURAN row by validating per the row's form).
      domains: t.arg({ type: [DomainInputType], required: false }),
      gates: t.arg({ type: [GateInputType], required: false }),
      oneStrength: t.arg.string({ required: false }),
      growthFocus: t.arg.string({ required: false }),
      priorFocusProgress: t.arg.string({ required: false }),
      priorFocusNote: t.arg.string({ required: false }),
      // Quran (ClassEcho) payload — provide ONLY for a QURAN-form observation (CO-5).
      quran: t.arg({ type: QuranPayloadInputType, required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const actor = actorOf(ctx);
      return reviewObservation({
        observationId: args.observationId,
        domains: (args.domains ?? []).map((d) => ({ domain: d.domain, level: d.level, note: d.note })),
        gates: (args.gates ?? []).map((g) => ({ gate: g.gate, result: g.result, breachNote: g.breachNote ?? null })),
        oneStrength: args.oneStrength ?? "",
        growthFocus: args.growthFocus ?? "",
        priorFocusProgress: args.priorFocusProgress ?? undefined,
        priorFocusNote: args.priorFocusNote ?? undefined,
        quran: args.quran
          ? {
              ratings: args.quran.ratings.map((r) => ({ criterion: r.criterion, score: r.score, note: r.note ?? null })),
              compliance: args.quran.compliance.map((c) => ({ item: c.item, yesNo: c.yesNo })),
              strengths: args.quran.strengths,
              improvements: args.quran.improvements,
              suggestions: args.quran.suggestions,
            }
          : undefined,
        actorId: actor.userId,
      });
    },
  }),
);

builder.mutationField("reRequestClassroomObservation", (t) =>
  t.field({
    type: ObservationRef,
    description:
      "Re-review a reviewed observation: creates a NEW assigned observation on the same recording/anchor and " +
      "marks the prior SUPERSEDED (enables CO-7 calibration). Observer ≠ observed teacher. Requires " +
      "observation:upload (Principal/Office). Audited.",
    authScopes: { hasPermission: "observation:upload" },
    args: {
      priorObservationId: t.arg.string({ required: true }),
      observerId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const actor = actorOf(ctx);
      return requestReReview({
        priorObservationId: args.priorObservationId,
        observerId: args.observerId,
        actorId: actor.userId,
      });
    },
  }),
);

builder.mutationField("requestCoReviewObservation", (t) =>
  t.field({
    type: ObservationRef,
    description:
      "Add a PARALLEL co-reviewer to a recording (CO-9, D-#272): creates a NEW independent ASSIGNED observation on " +
      "the same recording/anchor as the source WITHOUT superseding it (unlike re-review). The source must have a " +
      "recording; the co-observer ≠ observed teacher and must not already be reviewing this recording. Requires " +
      "observation:upload (Principal/Office). Audited.",
    authScopes: { hasPermission: "observation:upload" },
    args: {
      sourceObservationId: t.arg.string({ required: true }),
      observerId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const actor = actorOf(ctx);
      return requestCoReview({
        sourceObservationId: args.sourceObservationId,
        observerId: args.observerId,
        actorId: actor.userId,
      });
    },
  }),
);

builder.mutationField("respondToClassroomObservation", (t) =>
  t.field({
    type: ObservationRef,
    description:
      "The OBSERVED teacher acknowledges a released (REVIEWED) observation: records the response text and " +
      "transitions REVIEWED → TEACHER_RESPONDED. Scores are NOT editable here. Notifies the observer + " +
      "Principal. Requires observation:read AND being the observed teacher (a non-observed caller is refused). Audited.",
    authScopes: { hasPermission: "observation:read" },
    args: {
      observationId: t.arg.string({ required: true }),
      responseText: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const actor = actorOf(ctx);
      return respondToObservation({
        observationId: args.observationId,
        responseText: args.responseText,
        actorId: actor.userId,
      });
    },
  }),
);

builder.mutationField("publishClassroomObservation", (t) =>
  t.field({
    type: ObservationRef,
    description:
      "Publish a REVIEWED observation to the observed teacher (CO-8, D-#271): stamps publishedAt/publishedBy and " +
      "releases + notifies the teacher. Only a REVIEWED, not-yet-published row (an already-published row is refused). " +
      "Requires observation:manage (Principal/Office). Audited.",
    authScopes: { hasPermission: "observation:manage" },
    args: { observationId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const actor = actorOf(ctx);
      return publishObservation({ observationId: args.observationId, actorId: actor.userId });
    },
  }),
);

// ---------------------------------------------------------------------------
// Escalation cadence config (observation:manage — admin-tunable, D-#97 defaults)
// ---------------------------------------------------------------------------

const EscalationConfigRef = builder.objectRef<EffectiveEscalationConfig>("ObservationEscalationConfig");
EscalationConfigRef.implement({
  description:
    "The teacher-response escalation cadence (CALENDAR days since release): 1st reminder / 2nd reminder / " +
    "Principal flag. isDefault = no admin row, the working defaults (2/4/7) apply.",
  fields: (t) => ({
    reminderDays1: t.exposeInt("reminderDays1"),
    reminderDays2: t.exposeInt("reminderDays2"),
    principalFlagDays: t.exposeInt("principalFlagDays"),
    isDefault: t.exposeBoolean("isDefault"),
  }),
});

builder.queryField("observationEscalationConfig", (t) =>
  t.field({
    type: EscalationConfigRef,
    description:
      "The current response-escalation cadence (the admin row, else the 2/4/7 defaults). Requires observation:manage.",
    authScopes: { hasPermission: "observation:manage" },
    resolve: async () => getEscalationConfig(),
  }),
);

builder.mutationField("setObservationEscalationConfig", (t) =>
  t.field({
    type: EscalationConfigRef,
    description:
      "Set the response-escalation cadence (CALENDAR days, strictly increasing: 1st < 2nd < flag). " +
      "Requires observation:manage (Principal/Office). Audited.",
    authScopes: { hasPermission: "observation:manage" },
    args: {
      reminderDays1: t.arg.int({ required: true }),
      reminderDays2: t.arg.int({ required: true }),
      principalFlagDays: t.arg.int({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const actor = actorOf(ctx);
      return setEscalationConfig(
        {
          reminderDays1: args.reminderDays1,
          reminderDays2: args.reminderDays2,
          principalFlagDays: args.principalFlagDays,
        },
        actor.userId,
      );
    },
  }),
);

// ---------------------------------------------------------------------------
// Queries (observation:read, row-scoped) + the observer queue
// ---------------------------------------------------------------------------

builder.queryField("classroomObservation", (t) =>
  t.field({
    type: ObservationRef,
    nullable: true,
    description:
      "One observation by id, ROW-SCOPED: the observer sees their own; the observed teacher sees their own " +
      "only at/after REVIEWED; Principal/Office see all. Requires observation:read.",
    authScopes: { hasPermission: "observation:read" },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const actor = actorOf(ctx);
      const obs = await getObservation(args.id);
      if (!obs) return null;
      if (!canReadObservation(actor, obs)) {
        // Hide existence from a non-reader (an observed teacher pre-REVIEWED, etc.).
        throw new ForbiddenError("Not permitted to read this observation");
      }
      return obs;
    },
  }),
);

builder.queryField("teacherClassroomObservations", (t) =>
  t.field({
    type: [ObservationRef],
    description:
      "Observations about a teacher, newest first, ROW-SCOPED per row (the observed teacher sees only their " +
      "own released rows; an observer sees only rows they observed; Principal/Office see all). Requires observation:read.",
    authScopes: { hasPermission: "observation:read" },
    args: { teacherId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const actor = actorOf(ctx);
      const rows = await observationsForTeacher(args.teacherId);
      return rows.filter((r) => canReadObservation(actor, r));
    },
  }),
);

builder.queryField("observationPriorFocusContext", (t) =>
  t.field({
    type: PriorFocusContextRef,
    nullable: true,
    description:
      "The prior growth focus this observation carries forward (CO-10, D-#363), so the observer answers the " +
      "prior-focus question from the screen instead of memory. Resolves `prevObservationId` when set, else the " +
      "newest settled REF-11 observation of the same teacher before this one, preferring the same subject; null " +
      "for a first-ever observation or a QURAN row (which has no growth focus). Gated to the row's ASSIGNED " +
      "OBSERVER or observation:manage — it exposes one narrow slice of another observer's row, so it is not open " +
      "to the observed teacher. Requires observation:read.",
    authScopes: { hasPermission: "observation:read" },
    args: { observationId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const actor = actorOf(ctx);
      const obs = await getObservation(args.observationId);
      if (!obs) return null;
      if (!canReadPriorContext(actor, obs)) {
        throw new ForbiddenError("Not permitted to read this observation's prior focus");
      }
      return priorObservationContext(args.observationId);
    },
  }),
);

builder.queryField("myObservationReviewQueue", (t) =>
  t.field({
    type: [ObservationRef],
    description:
      "The signed-in observer's open review queue (ASSIGNED observations assigned to them). Requires observation:review.",
    authScopes: { hasPermission: "observation:review" },
    resolve: async (_root, _args, ctx) => {
      const actor = actorOf(ctx);
      return myReviewQueue(actor.userId);
    },
  }),
);

builder.queryField("allClassroomObservations", (t) =>
  t.field({
    type: ObservationPageRef,
    description:
      "All observations, newest first — Principal/Office oversight view, filtered + paginated (WS1). Filters " +
      "AND-combine; `search` matches the observed-teacher OR observer name. `published` true/false filters on the " +
      "CO-8 publish gate (D-#324); `sectionId` filters by class/section (CO-11, D-#363). omit for either. limit " +
      "defaults 20 (max 100). Requires observation:upload.",
    authScopes: { hasPermission: "observation:upload" },
    args: {
      teacherId: t.arg.string({ required: false }),
      observerId: t.arg.string({ required: false }),
      state: t.arg.string({ required: false }),
      form: t.arg.string({ required: false }),
      subject: t.arg.string({ required: false }),
      sectionId: t.arg.string({ required: false }),
      published: t.arg.boolean({ required: false }),
      dateFrom: t.arg.string({ required: false }),
      dateTo: t.arg.string({ required: false }),
      search: t.arg.string({ required: false }),
      limit: t.arg.int({ required: false }),
      offset: t.arg.int({ required: false }),
    },
    resolve: async (_root, args) =>
      allObservationsPaged({
        teacherId: args.teacherId ?? undefined,
        observerId: args.observerId ?? undefined,
        state: args.state ?? undefined,
        form: args.form ?? undefined,
        subject: args.subject ?? undefined,
        sectionId: args.sectionId ?? undefined,
        published: args.published ?? undefined,
        dateFrom: args.dateFrom ?? undefined,
        dateTo: args.dateTo ?? undefined,
        search: args.search ?? undefined,
        limit: args.limit ?? undefined,
        offset: args.offset ?? undefined,
      }),
  }),
);

builder.queryField("myObservationReviews", (t) =>
  t.field({
    type: ObservationPageRef,
    description:
      "The signed-in observer's OWN review history (CO-11, D-#363) — every observation they were assigned, not just " +
      "the open ones, filtered + paginated exactly like the oversight view. There is deliberately NO observerId " +
      "argument: it is forced to the caller server-side, so this cannot be pointed at a peer's reviews. Requires " +
      "observation:review.",
    authScopes: { hasPermission: "observation:review" },
    args: {
      teacherId: t.arg.string({ required: false }),
      state: t.arg.string({ required: false }),
      form: t.arg.string({ required: false }),
      subject: t.arg.string({ required: false }),
      sectionId: t.arg.string({ required: false }),
      published: t.arg.boolean({ required: false }),
      dateFrom: t.arg.string({ required: false }),
      dateTo: t.arg.string({ required: false }),
      search: t.arg.string({ required: false }),
      limit: t.arg.int({ required: false }),
      offset: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const actor = actorOf(ctx);
      return observerReviewsPaged(actor.userId, {
        teacherId: args.teacherId ?? undefined,
        state: args.state ?? undefined,
        form: args.form ?? undefined,
        subject: args.subject ?? undefined,
        sectionId: args.sectionId ?? undefined,
        published: args.published ?? undefined,
        dateFrom: args.dateFrom ?? undefined,
        dateTo: args.dateTo ?? undefined,
        search: args.search ?? undefined,
        limit: args.limit ?? undefined,
        offset: args.offset ?? undefined,
      });
    },
  }),
);

builder.queryField("classroomObservationsForRecording", (t) =>
  t.field({
    type: [ObservationRef],
    description:
      "Every observation on a recording — the CO-9 co-review group for the Principal compare view (each reviewer's " +
      "row, oldest first). Requires observation:upload (Principal/Office).",
    authScopes: { hasPermission: "observation:upload" },
    args: { recordingId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => observationsForRecording(args.recordingId),
  }),
);
