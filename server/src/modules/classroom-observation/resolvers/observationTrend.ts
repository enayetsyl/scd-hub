/**
 * Classroom-observation TREND resolvers (CO-4, prd-classroom-observation §CO-4, REF-11
 * §2.2/§8). All reads are DERIVED (D-#85) — nothing stored, no mutation, no new audit
 * kind, no new permission (reuses CO-1's observation:read / observation:manage).
 *
 * RBAC:
 *   - teacherObservationTrend: `observation:read`, then ROW-SCOPED — a caller with
 *     observation:manage (Principal/Office) may read ANY teacher's trend; otherwise the
 *     caller may read ONLY their own (teacherId === ctx.auth.userId), else ForbiddenError.
 *     An observer gets NO arbitrary teacher's trend (manage or self only).
 *   - schoolObservationPatterns: `observation:manage` (Principal/Office only) — the
 *     school-wide weakest-domain training-need signal (a staff aggregate, §8).
 *
 * Staff-internal — GUARDIAN holds no observation:* permission, so is rejected at the
 * scope layer (§7). Identity plane (names teacherId); no corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import type { ObservationActor } from "../services/ClassroomObservationService";
import {
  teacherDomainTrend,
  schoolObservationPatterns,
  type TeacherDomainTrend,
  type DomainTrendRow,
  type DomainTrendPoint,
  type SchoolObservationPatterns,
  type DomainSignalRow,
} from "../services/ClassroomObservationTrendService";

/** Build the row-scope actor from the request context (manage = Principal/Office). */
function actorOf(ctx: AppContext): ObservationActor {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  const role = ctx.auth.role;
  return { userId: ctx.auth.userId as string, canManage: role === "PRINCIPAL" || role === "OFFICE" };
}

// ---------------------------------------------------------------------------
// GraphQL shapes — per-domain trend (no total/average across domains)
// ---------------------------------------------------------------------------

const DomainTrendPointRef = builder.objectRef<DomainTrendPoint>("ObservationDomainTrendPoint");
DomainTrendPointRef.implement({
  description: "One data point in a domain's level series: the class date, the recorded level (1–4), and the observation id.",
  fields: (t) => ({
    classDate: t.exposeString("classDate"),
    level: t.exposeInt("level"),
    observationId: t.exposeString("observationId"),
  }),
});

const DomainTrendRowRef = builder.objectRef<DomainTrendRow>("ObservationDomainTrendRow");
DomainTrendRowRef.implement({
  description:
    "One REF-11 domain's chronological level trend (§2.2): the series + latest/previous level + a ↑/↓/→ " +
    "indicator. The trend is per-domain — there is NO total/average across domains.",
  fields: (t) => ({
    domain: t.exposeString("domain"),
    series: t.field({ type: [DomainTrendPointRef], resolve: (r) => r.series }),
    latestLevel: t.int({ nullable: true, resolve: (r) => r.latestLevel }),
    previousLevel: t.int({ nullable: true, resolve: (r) => r.previousLevel }),
    trend: t.exposeString("trend"),
  }),
});

const TeacherDomainTrendRef = builder.objectRef<TeacherDomainTrend>("TeacherObservationTrend");
TeacherDomainTrendRef.implement({
  description:
    "One teacher's per-domain (D1..D5) level trend over their released REF-11 observations (CO-4, REF-11 §2.2): " +
    "observation count + date range + one trend row per domain. No average across domains. Identity plane (ADR-005).",
  fields: (t) => ({
    teacherId: t.exposeString("teacherId"),
    observationCount: t.exposeInt("observationCount"),
    firstClassDate: t.string({ nullable: true, resolve: (r) => r.firstClassDate }),
    lastClassDate: t.string({ nullable: true, resolve: (r) => r.lastClassDate }),
    domains: t.field({ type: [DomainTrendRowRef], resolve: (r) => r.domains }),
  }),
});

// ---------------------------------------------------------------------------
// GraphQL shapes — the school-wide weakest-domain signal (§8)
// ---------------------------------------------------------------------------

const DomainSignalRowRef = builder.objectRef<DomainSignalRow>("ObservationDomainSignal");
DomainSignalRowRef.implement({
  description:
    "One domain's school-wide mean level (a staff aggregate signal, §8): the mean recorded level + the sample " +
    "count. A signal, never an individual's score.",
  fields: (t) => ({
    domain: t.exposeString("domain"),
    meanLevel: t.float({ nullable: true, resolve: (r) => r.meanLevel }),
    sampleCount: t.exposeInt("sampleCount"),
  }),
});

const SchoolObservationPatternsRef = builder.objectRef<SchoolObservationPatterns>("SchoolObservationPatterns");
SchoolObservationPatternsRef.implement({
  description:
    "The school-wide weakest-domain training-need signal (CO-4, REF-11 §8): per-domain mean level (weakest " +
    "first) over staff-wide released REF-11 observations + the weakest-domain code(s). A staff aggregate — " +
    "never attached to an individual. Identity plane (ADR-005).",
  fields: (t) => ({
    observationCount: t.exposeInt("observationCount"),
    domains: t.field({ type: [DomainSignalRowRef], resolve: (r) => r.domains }),
    weakestDomains: t.exposeStringList("weakestDomains"),
  }),
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

builder.queryField("teacherObservationTrend", (t) =>
  t.field({
    type: TeacherDomainTrendRef,
    description:
      "One teacher's per-domain REF-11 level trend over their released observations (CO-4, §2.2). Requires " +
      "observation:read, then ROW-SCOPED: observation:manage (Principal/Office) may read any teacher's trend; " +
      "otherwise only your own. No average across domains.",
    authScopes: { hasPermission: "observation:read" },
    args: { teacherId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const actor = actorOf(ctx);
      // ROW-SCOPE: manager reads any teacher; otherwise self only (an observer does NOT
      // get an arbitrary teacher's trend). Bangla/English deny, matching CO-1's style.
      if (!actor.canManage && args.teacherId !== actor.userId) {
        throw new ForbiddenError("Not permitted to read this teacher's observation trend");
      }
      return teacherDomainTrend(args.teacherId);
    },
  }),
);

builder.queryField("schoolObservationPatterns", (t) =>
  t.field({
    type: SchoolObservationPatternsRef,
    description:
      "The school-wide weakest-domain training-need signal over staff-wide released REF-11 observations " +
      "(CO-4, REF-11 §8). A staff aggregate — never an individual score. Requires observation:manage " +
      "(Principal/Office).",
    authScopes: { hasPermission: "observation:manage" },
    resolve: async () => schoolObservationPatterns(),
  }),
);
