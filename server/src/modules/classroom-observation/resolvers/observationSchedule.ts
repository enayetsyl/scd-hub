/**
 * Classroom-observation REVIEW-SCHEDULER resolvers (CO-6, prd-classroom-observation
 * §CO-6). The scheduler SUGGESTS who's due — it never auto-assigns (Principal/Office
 * still assign via CO-1). All reads are DERIVED (D-#85); the only write is the admin
 * cadence config (audited).
 *
 * RBAC — `observation:manage` (Principal/Office) for the due list AND the config.
 *   Build ruling: the §CO-6 "visible to Principal/Office/observers" intent is narrowed
 *   to `observation:manage`. There is no permission that distinguishes a senior-teacher
 *   *observer* from a plain TEACHER (observation:review is held by every TEACHER and the
 *   resolver narrows it per-observation to the assigned observerId, D-#147). Gating the
 *   cross-teacher due list to `observation:read` would expose every teacher's cadence to
 *   ALL staff — the exact "not wider staff" guardrail this slice must honour. So the
 *   list rides `observation:manage` (the assigners), the safe non-leaky choice.
 *
 * Staff-internal — GUARDIAN holds no observation:* permission (§7). Identity plane
 * (names a teacherId); no corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import {
  dueForReview,
  getScheduleConfig,
  setScheduleConfig,
  type DueReviewItem,
  type DueReviewList,
  type EffectiveScheduleConfig,
} from "../services/ClassroomObservationSchedulerService";

// ---------------------------------------------------------------------------
// GraphQL shapes
// ---------------------------------------------------------------------------

const ScheduleConfigRef = builder.objectRef<EffectiveScheduleConfig>("ObservationScheduleConfig");
ScheduleConfigRef.implement({
  description:
    "The review-scheduler cadence (CO-6, §CO-6): the base (DEVELOPING) interval + the STRONG/NEEDS_SUPPORT " +
    "multipliers + the frequency cap. `isDefault` is true when no admin row exists and the working defaults apply.",
  fields: (t) => ({
    baseIntervalDays: t.exposeInt("baseIntervalDays"),
    strongMultiplier: t.exposeFloat("strongMultiplier"),
    needsSupportMultiplier: t.exposeFloat("needsSupportMultiplier"),
    minIntervalDays: t.exposeInt("minIntervalDays"),
    isDefault: t.exposeBoolean("isDefault"),
  }),
});

const DueReviewItemRef = builder.objectRef<DueReviewItem>("ObservationDueReviewItem");
DueReviewItemRef.implement({
  description:
    "One teacher on the 'due for review' list (CO-6, §CO-6): their support tier, last review, the tier-derived " +
    "interval, the due date, and how many calendar days overdue. `neverReviewed` teachers sit in the soonest bucket.",
  fields: (t) => ({
    teacherId: t.exposeString("teacherId"),
    tier: t.string({ nullable: true, resolve: (r) => r.tier }),
    lastReviewedAt: t.string({ nullable: true, resolve: (r) => r.lastReviewedAt }),
    lastObservationId: t.string({ nullable: true, resolve: (r) => r.lastObservationId }),
    intervalDays: t.exposeInt("intervalDays"),
    dueDate: t.string({ nullable: true, resolve: (r) => r.dueDate }),
    overdueDays: t.exposeInt("overdueDays"),
    neverReviewed: t.exposeBoolean("neverReviewed"),
  }),
});

const DueReviewListRef = builder.objectRef<DueReviewList>("ObservationDueReviewList");
DueReviewListRef.implement({
  description:
    "The review-scheduler's ranked 'due for review' list (CO-6, §CO-6): the cadence in force + the due/overdue " +
    "(and never-reviewed) teachers, weakest/most-overdue first. A SUGGESTION — never an automatic assignment.",
  fields: (t) => ({
    now: t.exposeString("now"),
    config: t.field({ type: ScheduleConfigRef, resolve: (r) => r.config }),
    candidateCount: t.exposeInt("candidateCount"),
    items: t.field({ type: [DueReviewItemRef], resolve: (r) => r.items }),
  }),
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

builder.queryField("observationDueList", (t) =>
  t.field({
    type: DueReviewListRef,
    description:
      "The ranked 'due for review' suggestion list over teachers with real teaching sessions (CO-6, §CO-6). " +
      "Requires observation:manage (Principal/Office). Suggestion only — never assigns.",
    authScopes: { hasPermission: "observation:manage" },
    resolve: async () => dueForReview(),
  }),
);

builder.queryField("observationScheduleConfig", (t) =>
  t.field({
    type: ScheduleConfigRef,
    description:
      "The review-scheduler cadence in force (CO-6, §CO-6) — the admin row or the working defaults. Requires " +
      "observation:manage (Principal/Office).",
    authScopes: { hasPermission: "observation:manage" },
    resolve: async () => getScheduleConfig(),
  }),
);

// ---------------------------------------------------------------------------
// Mutation — set the cadence (observation:manage; audited in the service)
// ---------------------------------------------------------------------------

builder.mutationField("setObservationScheduleConfig", (t) =>
  t.field({
    type: ScheduleConfigRef,
    description:
      "Set the review-scheduler cadence: base interval (DEVELOPING) + STRONG/NEEDS_SUPPORT multipliers + the " +
      "frequency cap (CO-6, §CO-6). Requires observation:manage (Principal/Office). Audited.",
    authScopes: { hasPermission: "observation:manage" },
    args: {
      baseIntervalDays: t.arg.int({ required: true }),
      strongMultiplier: t.arg.float({ required: true }),
      needsSupportMultiplier: t.arg.float({ required: true }),
      minIntervalDays: t.arg.int({ required: true }),
    },
    resolve: async (_root, args, ctx: AppContext) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return setScheduleConfig(
        {
          baseIntervalDays: args.baseIntervalDays,
          strongMultiplier: args.strongMultiplier,
          needsSupportMultiplier: args.needsSupportMultiplier,
          minIntervalDays: args.minIntervalDays,
        },
        ctx.auth.userId as string,
      );
    },
  }),
);
