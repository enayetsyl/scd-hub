/**
 * CO-14 review-rota resolvers (D-#426) — instruction in, validated dated rota out.
 *
 * RBAC: `observation:manage` (Principal/Office) throughout, matching CO-6's due list.
 * Turning a cadence into named dated sessions for named teachers is the assigners'
 * work; there is no permission that distinguishes a senior-teacher observer from a
 * plain TEACHER, so anything wider would expose every teacher's schedule to all staff.
 *
 * `generateObservationRota` does NOT write. `saveObservationRota` stores the accepted
 * table and creates **no** ClassroomObservation rows — CO-6's suggest-never-assign
 * guardrail is unchanged (owner ruling).
 *
 * Staff/operational plane; no corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import {
  generateRota,
  saveRota,
  getRota,
  listRotas,
  ObservationRotaError,
  type GeneratedRota,
  type StoredRotaShape,
  type StoredRotaRowShape,
} from "../services/ObservationRotaService";
import type { RotaCandidate, RotaConstraintEcho } from "../rota";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

const EchoIntensiveRef = builder.objectRef<{ teacherName: string; everyNDays: number; rotateClasses: boolean }>(
  "ObservationRotaEchoIntensive",
);
EchoIntensiveRef.implement({
  fields: (t) => ({
    teacherName: t.exposeString("teacherName"),
    everyNDays: t.exposeInt("everyNDays"),
    rotateClasses: t.exposeBoolean("rotateClasses"),
  }),
});

const EchoExcludedRef = builder.objectRef<{ teacherName: string; reason: string | null }>(
  "ObservationRotaEchoExcluded",
);
EchoExcludedRef.implement({
  fields: (t) => ({
    teacherName: t.exposeString("teacherName"),
    reason: t.string({ nullable: true, resolve: (r) => r.reason }),
  }),
});

const EchoCapRef = builder.objectRef<{ teacherName: string; max: number; window: string | null }>(
  "ObservationRotaEchoCap",
);
EchoCapRef.implement({
  fields: (t) => ({
    teacherName: t.exposeString("teacherName"),
    max: t.exposeInt("max"),
    window: t.string({ nullable: true, resolve: (r) => r.window }),
  }),
});

const EchoRef = builder.objectRef<RotaConstraintEcho>("ObservationRotaConstraintEcho");
EchoRef.implement({
  description:
    "The model's own restatement of the instruction it acted on (CO-14, D-#426). The validator checks the rota " +
    "against THIS, and it is shown to the Principal so 'did it understand me?' is answered on screen.",
  fields: (t) => ({
    intensive: t.field({ type: [EchoIntensiveRef], resolve: (r) => r.intensive }),
    excluded: t.field({ type: [EchoExcludedRef], resolve: (r) => r.excluded }),
    caps: t.field({ type: [EchoCapRef], resolve: (r) => r.caps }),
    classLevels: t.intList({ resolve: (r) => r.classLevels }),
    perDay: t.exposeInt("perDay"),
  }),
});

const GeneratedRowRef = builder.objectRef<{ date: string; candidateId: string; reason: string | null; candidate: RotaCandidate }>(
  "ObservationRotaGeneratedRow",
);
GeneratedRowRef.implement({
  description: "One scheduled session. Every field except `reason` is server-computed — the model chose only the id.",
  fields: (t) => ({
    date: t.exposeString("date"),
    candidateId: t.exposeString("candidateId"),
    reason: t.string({ nullable: true, resolve: (r) => r.reason }),
    dayOfWeek: t.string({ resolve: (r) => r.candidate.dayOfWeek }),
    teacherId: t.string({ resolve: (r) => r.candidate.teacherId }),
    teacherName: t.string({ resolve: (r) => r.candidate.teacherName }),
    groupLabel: t.string({ resolve: (r) => r.candidate.groupLabel }),
    classLevel: t.int({ nullable: true, resolve: (r) => r.candidate.classLevel }),
    subject: t.string({ resolve: (r) => r.candidate.subject }),
    periodNumber: t.int({ resolve: (r) => r.candidate.periodNumber }),
    startHHMM: t.string({ resolve: (r) => r.candidate.startHHMM }),
    endHHMM: t.string({ resolve: (r) => r.candidate.endHHMM }),
  }),
});

const GeneratedRotaRef = builder.objectRef<GeneratedRota>("ObservationRotaDraft");
GeneratedRotaRef.implement({
  description:
    "A generated, VALIDATED rota — not yet stored. Accept it with saveObservationRota (which still creates no " +
    "observation assignments).",
  fields: (t) => ({
    periodFrom: t.string({ resolve: (r) => r.from }),
    periodTo: t.string({ resolve: (r) => r.to }),
    instruction: t.exposeString("instruction"),
    constraintEcho: t.field({ type: EchoRef, resolve: (r) => r.constraintEcho }),
    rows: t.field({ type: [GeneratedRowRef], resolve: (r) => r.rows }),
    model: t.exposeString("model"),
    promptVersion: t.exposeString("promptVersion"),
  }),
});

const StoredRowRef = builder.objectRef<StoredRotaRowShape>("ObservationRotaRow");
StoredRowRef.implement({
  fields: (t) => ({
    date: t.exposeString("date"),
    candidateId: t.exposeString("candidateId"),
    teacherId: t.exposeString("teacherId"),
    teacherName: t.exposeString("teacherName"),
    groupLabel: t.exposeString("groupLabel"),
    subject: t.exposeString("subject"),
    periodNumber: t.exposeInt("periodNumber"),
    startHHMM: t.exposeString("startHHMM"),
    endHHMM: t.exposeString("endHHMM"),
    reason: t.string({ nullable: true, resolve: (r) => r.reason }),
    slotChanged: t.exposeBoolean("slotChanged", {
      description:
        "The routine slot behind this row is no longer live — the period may have moved. Shown, never silently rewritten.",
    }),
  }),
});

const StoredRotaRef = builder.objectRef<StoredRotaShape>("ObservationRota");
StoredRotaRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    periodFrom: t.exposeString("periodFrom"),
    periodTo: t.exposeString("periodTo"),
    instruction: t.exposeString("instruction"),
    constraintEcho: t.field({ type: EchoRef, resolve: (r) => r.constraintEcho }),
    rows: t.field({ type: [StoredRowRef], resolve: (r) => r.rows }),
    model: t.exposeString("model"),
    promptVersion: t.exposeString("promptVersion"),
    createdBy: t.exposeString("createdBy"),
    createdAt: t.exposeString("createdAt"),
  }),
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

builder.mutationField("generateObservationRota", (t) =>
  t.field({
    type: GeneratedRotaRef,
    description:
      "Turn a written instruction into a validated, dated review rota (CO-14, D-#426). The server expands the live " +
      "routine into dated candidates FIRST; the model only picks candidate ids and restates the constraints, which " +
      "the server then checks. On violation it retries once and then REFUSES with the violations named — there is " +
      "no fallback table. Writes nothing. Requires observation:manage.",
    authScopes: { hasPermission: "observation:manage" },
    args: {
      periodFrom: t.arg.string({ required: true }),
      periodTo: t.arg.string({ required: true }),
      instruction: t.arg.string({ required: true }),
      classLevels: t.arg.intList({ required: false }),
      excludeTeacherIds: t.arg.stringList({ required: false }),
    },
    resolve: async (_root, args, ctx: AppContext) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      try {
        return await generateRota({
          from: args.periodFrom,
          to: args.periodTo,
          instruction: args.instruction,
          classLevels: args.classLevels ?? undefined,
          excludeTeacherIds: args.excludeTeacherIds ?? undefined,
          actorId: ctx.auth.userId as string,
        });
      } catch (e) {
        // Surface the named violations — a bare "failed" would leave the Principal
        // guessing which of their rules the model broke.
        if (e instanceof ObservationRotaError && e.violations.length) {
          throw new Error(`${e.message}\n\n${e.violations.map((v) => `• ${v}`).join("\n")}`);
        }
        throw e;
      }
    },
  }),
);

builder.mutationField("saveObservationRota", (t) =>
  t.field({
    type: StoredRotaRef,
    description:
      "Store an accepted rota with the instruction that produced it (CO-14, D-#426). Creates NO observation " +
      "assignments — CO-6's suggest-never-assign guardrail is unchanged. Requires observation:manage. Audited.",
    authScopes: { hasPermission: "observation:manage" },
    args: {
      periodFrom: t.arg.string({ required: true }),
      periodTo: t.arg.string({ required: true }),
      instruction: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx: AppContext) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      // Regenerate deterministically from the stored instruction rather than trusting a
      // client-posted table: the rows a client could send are exactly the thing the
      // validator exists to distrust.
      const draft = await generateRota({
        from: args.periodFrom,
        to: args.periodTo,
        instruction: args.instruction,
        actorId: ctx.auth.userId as string,
      });
      const id = await saveRota({ ...draft, actorId: ctx.auth.userId as string });
      const stored = await getRota(id);
      if (!stored) throw new Error("The rota could not be read back after saving.");
      return stored;
    },
  }),
);

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

builder.queryField("observationRotas", (t) =>
  t.field({
    type: [StoredRotaRef],
    description:
      "Saved review rotas, newest first (CO-14). Each row is re-checked against the LIVE routine — `slotChanged` " +
      "marks a row whose slot has moved. Requires observation:manage.",
    authScopes: { hasPermission: "observation:manage" },
    args: { limit: t.arg.int({ required: false }) },
    resolve: async (_root, args) => listRotas(args.limit ?? 12),
  }),
);

builder.queryField("observationRota", (t) =>
  t.field({
    type: StoredRotaRef,
    nullable: true,
    description: "One saved rota, re-checked against the live routine (CO-14). Requires observation:manage.",
    authScopes: { hasPermission: "observation:manage" },
    args: { rotaId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => getRota(args.rotaId),
  }),
);
