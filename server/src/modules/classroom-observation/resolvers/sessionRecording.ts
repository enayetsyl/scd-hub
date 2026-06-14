/**
 * Session-recording resolvers (CO-2, prd-classroom-observation §5).
 *
 * RBAC:
 *   - recordSessionFootage: `observation:upload` (Principal/Office) — store the
 *     `youtubeVideoId` the client returned (the actual unlisted upload is a LATER app
 *     rider) and link it to the backing observation. Audited.
 *   - observationRecording: `observation:read`, then ROW-SCOPED via the shared
 *     `canReadObservation` predicate (observer own; observed teacher own at/after
 *     REVIEWED; Principal/Office all) — the recording follows the observation's
 *     visibility exactly.
 *
 * Staff-internal — GUARDIAN holds no observation:* permission, so is rejected at the
 * scope layer (§7). Identity plane (names teacherId/uploadedBy); no corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import {
  getObservation,
  canReadObservation,
  type ObservationActor,
} from "../services/ClassroomObservationService";
import {
  recordSessionFootage,
  recordingForObservation,
  type SessionRecordingShape,
} from "../services/SessionRecordingService";

/** Build the row-scope actor from the request context (manage = Principal/Office). */
function actorOf(ctx: AppContext): ObservationActor {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  const role = ctx.auth.role;
  return { userId: ctx.auth.userId as string, canManage: role === "PRINCIPAL" || role === "OFFICE" };
}

// ---------------------------------------------------------------------------
// GraphQL shape
// ---------------------------------------------------------------------------

const SessionRecordingRef = builder.objectRef<SessionRecordingShape>("SessionRecording");
SessionRecordingRef.implement({
  description:
    "The YouTube-unlisted footage backing a classroom observation (CO-2): the session anchor + the " +
    "client-returned youtubeVideoId. privacyStatus is always 'unlisted'. Identity plane (ADR-005).",
  fields: (t) => ({
    id: t.exposeString("id"),
    observationId: t.string({ nullable: true, resolve: (r) => r.observationId }),
    routineSlotId: t.string({ nullable: true, resolve: (r) => r.routineSlotId }),
    sectionId: t.string({ nullable: true, resolve: (r) => r.sectionId }),
    subjectGroupId: t.string({ nullable: true, resolve: (r) => r.subjectGroupId }),
    subject: t.exposeString("subject"),
    teacherId: t.exposeString("teacherId"),
    classDate: t.exposeString("classDate"),
    periodNumber: t.int({ nullable: true, resolve: (r) => r.periodNumber }),
    youtubeVideoId: t.exposeString("youtubeVideoId"),
    privacyStatus: t.exposeString("privacyStatus"),
    uploadedBy: t.exposeString("uploadedBy"),
    createdAt: t.exposeString("createdAt"),
  }),
});

// ---------------------------------------------------------------------------
// Mutation
// ---------------------------------------------------------------------------

builder.mutationField("recordSessionFootage", (t) =>
  t.field({
    type: SessionRecordingRef,
    description:
      "Link a recorded session (the client-returned YouTube videoId) to an observation, copying its session " +
      "anchor; privacyStatus is forced 'unlisted'. A re-upload relinks. Requires observation:upload " +
      "(Principal/Office). Audited.",
    authScopes: { hasPermission: "observation:upload" },
    args: {
      observationId: t.arg.string({ required: true }),
      youtubeVideoId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const actor = actorOf(ctx);
      return recordSessionFootage({
        observationId: args.observationId,
        youtubeVideoId: args.youtubeVideoId,
        actorId: actor.userId,
        actorRole: ctx.auth?.role,
      });
    },
  }),
);

// ---------------------------------------------------------------------------
// Query (observation:read, row-scoped via the backing observation)
// ---------------------------------------------------------------------------

builder.queryField("observationRecording", (t) =>
  t.field({
    type: SessionRecordingRef,
    nullable: true,
    description:
      "The footage linked to an observation, ROW-SCOPED to the backing observation's visibility (observer own; " +
      "observed teacher own only at/after REVIEWED; Principal/Office all). Requires observation:read.",
    authScopes: { hasPermission: "observation:read" },
    args: { observationId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const actor = actorOf(ctx);
      const obs = await getObservation(args.observationId);
      if (!obs) return null;
      if (!canReadObservation(actor, obs)) {
        // Hide existence from a non-reader (an observed teacher pre-REVIEWED, etc.).
        throw new ForbiddenError("Not permitted to read this observation");
      }
      return recordingForObservation(args.observationId);
    },
  }),
);
