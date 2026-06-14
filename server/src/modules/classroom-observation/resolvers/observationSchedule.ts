/**
 * Classroom-observation REVIEW-SCHEDULER resolvers (CO-6, prd-classroom-observation
 * §CO-6). The "due for review" SUGGESTION list + the admin-tunable cadence config. All
 * reads are DERIVED (D-#85) — the due list NEVER creates or assigns an observation
 * (suggestion only, no write side-effect). No new permission — reuses CO-1's
 * observation:read / observation:manage.
 *
 * RBAC:
 *   - observationDueList: `observation:read` at the scope layer, then RESTRICTED
 *     in-resolver to Principal/Office (observation:manage) OR a caller who actually
 *     OBSERVES (holds ≥1 observation as the assigned observer). A plain teacher with
 *     observation:read but no observer assignment is refused — the list is support
 *     framing for the review team, NOT visible to wider staff (§CO-6 guardrail).
 *   - observationScheduleConfig / setObservationScheduleConfig: `observation:manage`
 *     (Principal/Office).
 *
 * Staff-internal — GUARDIAN holds no observation:* permission, so is rejected at the
 * scope layer (§7). Identity plane (names teacherId); no corpus path (ADR-005). There is
 * deliberately NO mutation here that assigns/creates an observation from the list.
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import type { ObservationActor } from "../services/ClassroomObservationService";
import {
  observationDueList,
  getScheduleConfig,
  setScheduleConfig,
  type DueRow,
  type EffectiveScheduleConfig,
} from "../services/ObservationScheduleService";
import { ClassroomObservation } from "../models/ClassroomObservation";
import { Types } from "mongoose";

/** Build the row-scope actor from the request context (manage = Principal/Office). */
function actorOf(ctx: AppContext): ObservationActor {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  const role = ctx.auth.role;
  return { userId: ctx.auth.userId as string, canManage: role === "PRINCIPAL" || role === "OFFICE" };
}

/** Does this user actually observe (hold ≥1 observation as the assigned observer)? */
async function isObserver(userId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(userId)) return false;
  const one = await ClassroomObservation.exists({ observerId: new Types.ObjectId(userId) });
  return !!one;
}

// ---------------------------------------------------------------------------
// GraphQL shapes
// ---------------------------------------------------------------------------

const DueRowRef = builder.objectRef<DueRow>("ObservationDueRow");
DueRowRef.implement({
  description:
    "One teacher's review-due suggestion (CO-6, §CO-6): the derived support tier + last-review date + the " +
    "interval/due-date + how overdue. A SUGGESTION only — never an assignment. The tier is a support signal, " +
    "not a ranking. Identity plane (ADR-005).",
  fields: (t) => ({
    teacherId: t.exposeString("teacherId"),
    /** The derived tier, or null when never-reviewed (the soonest bucket). */
    tier: t.string({ nullable: true, resolve: (r) => r.tier }),
    lastReviewedAt: t.string({ nullable: true, resolve: (r) => r.lastReviewedAt }),
    reviewCount: t.exposeInt("reviewCount"),
    intervalDays: t.exposeInt("intervalDays"),
    dueDate: t.string({ nullable: true, resolve: (r) => r.dueDate }),
    overdueDays: t.exposeInt("overdueDays"),
    overdue: t.exposeBoolean("overdue"),
    neverReviewed: t.exposeBoolean("neverReviewed"),
  }),
});

const ScheduleConfigRef = builder.objectRef<EffectiveScheduleConfig>("ObservationScheduleConfig");
ScheduleConfigRef.implement({
  description:
    "The review-scheduler cadence (CO-6): the base (Developing) interval in days + the per-tier multipliers " +
    "(Strong = longest, Needs-support = shortest) + the frequency-cap guardrail. isDefault = no admin row, the " +
    "working defaults (30 / ×2 / ×1 / ×0.5 / cap 14) apply.",
  fields: (t) => ({
    baseIntervalDays: t.exposeInt("baseIntervalDays"),
    strongMultiplier: t.exposeFloat("strongMultiplier"),
    developingMultiplier: t.exposeFloat("developingMultiplier"),
    needsSupportMultiplier: t.exposeFloat("needsSupportMultiplier"),
    frequencyCapDays: t.exposeInt("frequencyCapDays"),
    isDefault: t.exposeBoolean("isDefault"),
  }),
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

builder.queryField("observationDueList", (t) =>
  t.field({
    type: [DueRowRef],
    description:
      "The 'due for review' SUGGESTION list (CO-6, §CO-6): teachers with real teaching sessions, ranked by " +
      "support tier (Needs-support first) then lateness; never-reviewed teachers sort most-overdue. A SUGGESTION " +
      "only — NEVER an assignment. Requires observation:read, then restricted to Principal/Office or an active " +
      "observer (not wider staff).",
    authScopes: { hasPermission: "observation:read" },
    resolve: async (_root, _args, ctx) => {
      const actor = actorOf(ctx);
      // Restrict to the review team: Principal/Office (manage) OR an actual observer.
      if (!actor.canManage && !(await isObserver(actor.userId))) {
        throw new ForbiddenError("Not permitted to read the review-due list");
      }
      return observationDueList(new Date());
    },
  }),
);

builder.queryField("observationScheduleConfig", (t) =>
  t.field({
    type: ScheduleConfigRef,
    description:
      "The current review-scheduler cadence (the admin row, else the working defaults). Requires observation:manage.",
    authScopes: { hasPermission: "observation:manage" },
    resolve: async () => getScheduleConfig(),
  }),
);

// ---------------------------------------------------------------------------
// Mutation — set the cadence (observation:manage; audited). NO assignment mutation.
// ---------------------------------------------------------------------------

builder.mutationField("setObservationScheduleConfig", (t) =>
  t.field({
    type: ScheduleConfigRef,
    description:
      "Set the review-scheduler cadence: the base (Developing) interval (days ≥ 1), the three tier multipliers " +
      "(≥ 0, ordered Strong ≥ Developing ≥ Needs-support), and the frequency-cap guardrail (days ≥ 1). Changes the " +
      "suggested intervals only — NEVER assigns a review. Requires observation:manage (Principal/Office). Audited.",
    authScopes: { hasPermission: "observation:manage" },
    args: {
      baseIntervalDays: t.arg.int({ required: true }),
      strongMultiplier: t.arg.float({ required: true }),
      developingMultiplier: t.arg.float({ required: true }),
      needsSupportMultiplier: t.arg.float({ required: true }),
      frequencyCapDays: t.arg.int({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const actor = actorOf(ctx);
      return setScheduleConfig(
        {
          baseIntervalDays: args.baseIntervalDays,
          strongMultiplier: args.strongMultiplier,
          developingMultiplier: args.developingMultiplier,
          needsSupportMultiplier: args.needsSupportMultiplier,
          frequencyCapDays: args.frequencyCapDays,
        },
        actor.userId,
      );
    },
  }),
);
