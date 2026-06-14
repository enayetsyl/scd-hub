/**
 * Session-recording resolvers (CO-2, prd-classroom-observation §CO-2, D-#149).
 *
 * Footage = a YouTube-UNLISTED video uploaded CLIENT-SIDE (web Google Identity
 * Services + YouTube Data API v3). The server only persists the resulting
 * `youtubeVideoId` + the session anchor — no Google secret ever reaches it.
 *
 * RBAC:
 *   - recordSessionRecording: `observation:upload` (Principal/Office) — the same
 *     gate as uploadClassroomObservation (footage is the upload step's payload).
 *   - sessionRecording (id): `observation:upload` (Principal/Office) — the manage/
 *     upload plane re-fetch. NON-admins (the observer, the observed teacher) read
 *     footage through the row-scoped `recording` field on ClassroomObservation, NOT
 *     this query — so an unlisted id is never exposed outside an observation they
 *     may already read.
 *
 * `SessionRecordingRef` is consumed by ClassroomObservation's `recording` field
 * (defined in classroomObservation.ts) — kept here to avoid a circular import.
 * Identity plane (names teacherId/uploadedBy); no corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import {
  recordSessionRecording,
  getSessionRecording,
  type SessionRecordingShape,
} from "../services/SessionRecordingService";

export const SessionRecordingRef = builder.objectRef<SessionRecordingShape>("SessionRecording");
SessionRecordingRef.implement({
  description:
    "CO-2 footage: a YouTube-unlisted recording of one taught session, linked to a session anchor. " +
    "Watching needs only youtubeVideoId (unlisted = link-viewable, no auth) so playback works on web AND native.",
  fields: (t) => ({
    id: t.exposeString("id"),
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
    updatedAt: t.exposeString("updatedAt"),
  }),
});

function actorId(ctx: AppContext): string {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  return ctx.auth.userId as string;
}

// ---------------------------------------------------------------------------
// Mutation — record a client-uploaded YouTube-unlisted video against an anchor
// ---------------------------------------------------------------------------

builder.mutationField("recordSessionRecording", (t) =>
  t.field({
    type: SessionRecordingRef,
    description:
      "Persist a client-uploaded YouTube-unlisted recording (youtubeVideoId) against a session anchor " +
      "(exactly one of sectionId/subjectGroupId). Pass the returned id as recordingId to " +
      "uploadClassroomObservation. Requires observation:upload (Principal/Office). Audited.",
    authScopes: { hasPermission: "observation:upload" },
    args: {
      subject: t.arg.string({ required: true }),
      teacherId: t.arg.string({ required: true }),
      classDate: t.arg.string({ required: true }),
      youtubeVideoId: t.arg.string({ required: true }),
      sectionId: t.arg.string({ required: false }),
      subjectGroupId: t.arg.string({ required: false }),
      routineSlotId: t.arg.string({ required: false }),
      periodNumber: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) =>
      recordSessionRecording({
        subject: args.subject,
        teacherId: args.teacherId,
        classDate: args.classDate,
        youtubeVideoId: args.youtubeVideoId,
        sectionId: args.sectionId ?? undefined,
        subjectGroupId: args.subjectGroupId ?? undefined,
        routineSlotId: args.routineSlotId ?? undefined,
        periodNumber: args.periodNumber ?? undefined,
        actorId: actorId(ctx),
      }),
  }),
);

// ---------------------------------------------------------------------------
// Query — Principal/Office re-fetch a recording (manage/upload plane)
// ---------------------------------------------------------------------------

builder.queryField("sessionRecording", (t) =>
  t.field({
    type: SessionRecordingRef,
    nullable: true,
    description:
      "One session recording by id (Principal/Office manage plane). Observers/observed teachers read " +
      "footage through the row-scoped ClassroomObservation.recording field instead. Requires observation:upload.",
    authScopes: { hasPermission: "observation:upload" },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args) => getSessionRecording(args.id),
  }),
);
