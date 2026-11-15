/**
 * Parents'-meeting results for guardians (D-#1633–#1635).
 *
 *   publishMeetingToGuardians / withdrawMeetingRelease — PRINCIPAL only (the service
 *     checks the role; the gate here is the meeting read permission, which the Principal holds).
 *   meetingReleaseStatus — `parents_meeting:view`: the Principal card (state + final-comment counts).
 *   guardianMeetingResults — the child's own guardian, or staff with `parents_meeting:view`.
 *
 * The guardian type carries NO field for a class- or subject-teacher comment — the only
 * comment text is the final Principal/Office comment. Identity plane; no corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import {
  publishMeetingToGuardians,
  withdrawMeetingRelease,
  meetingReleaseStatus,
  type MeetingReleaseStatus,
  type PublishMeetingResult,
} from "../services/MeetingReleaseService";
import {
  guardianMeetingResults,
  type GuardianMeetingResult,
  type GuardianResultNumbers,
  type GuardianResultClassBest,
  type GuardianResultFinal,
} from "../services/MeetingReleaseReadService";

const MeetingReleaseStatusRef = builder.objectRef<MeetingReleaseStatus>("MeetingReleaseStatus");
MeetingReleaseStatusRef.implement({
  description: "Whether a meeting's results are published to guardians, and how many children have a final comment (D-#1633).",
  fields: (t) => ({
    meetingId: t.exposeString("meetingId"),
    published: t.exposeBoolean("published"),
    publishedAt: t.string({ nullable: true, resolve: (s) => s.publishedAt }),
    publishedByName: t.string({ nullable: true, resolve: (s) => s.publishedByName }),
    withdrawnAt: t.string({ nullable: true, resolve: (s) => s.withdrawnAt }),
    notifiedAt: t.string({ nullable: true, resolve: (s) => s.notifiedAt }),
    totalChildren: t.exposeInt("totalChildren"),
    withFinal: t.exposeInt("withFinal"),
    withoutFinal: t.exposeInt("withoutFinal"),
    snapshots: t.exposeInt("snapshots"),
  }),
});

const PublishMeetingResultRef = builder.objectRef<PublishMeetingResult>("PublishMeetingResult");
PublishMeetingResultRef.implement({
  fields: (t) => ({
    status: t.field({ type: MeetingReleaseStatusRef, resolve: (r) => r.status }),
    computed: t.exposeInt("computed"),
    notified: t.exposeBoolean("notified"),
  }),
});

const ResultNumbersRef = builder.objectRef<GuardianResultNumbers>("GuardianResultNumbers");
ResultNumbersRef.implement({
  fields: (t) => ({
    presentDays: t.int({ resolve: (n) => n.attendance.presentDays }),
    markedDays: t.int({ resolve: (n) => n.attendance.markedDays }),
    absentDays: t.int({ resolve: (n) => n.attendance.absentDays }),
    leaveDays: t.int({ resolve: (n) => n.attendance.leaveDays }),
    classTestAvgPercent: t.float({ nullable: true, resolve: (n) => n.classTests.avgPercent }),
    classTestsSat: t.int({ resolve: (n) => n.classTests.sat }),
    classTestsHeld: t.int({ resolve: (n) => n.classTests.held }),
    homeworkSubmitted: t.int({ resolve: (n) => n.homework.submitted }),
    homeworkReceived: t.int({ resolve: (n) => n.homework.received }),
    assignmentSubmitted: t.int({ resolve: (n) => n.assignment.submitted }),
    assignmentReceived: t.int({ resolve: (n) => n.assignment.received }),
  }),
});

const ResultClassBestRef = builder.objectRef<GuardianResultClassBest>("GuardianResultClassBest");
ResultClassBestRef.implement({
  description: "The best figure in the child's section, bare numbers (no child named); withheld in a tiny section.",
  fields: (t) => ({
    withheld: t.exposeBoolean("withheld"),
    attendancePresentDays: t.int({ nullable: true, resolve: (b) => b.attendancePresentDays }),
    classTestAvgPct: t.float({ nullable: true, resolve: (b) => b.classTestAvgPct }),
    homeworkPct: t.float({ nullable: true, resolve: (b) => b.homeworkPct }),
    assignmentPct: t.float({ nullable: true, resolve: (b) => b.assignmentPct }),
  }),
});

const ResultFinalRef = builder.objectRef<GuardianResultFinal>("GuardianResultFinal");
ResultFinalRef.implement({
  description: "The final Principal/Office comment — the only comment text a guardian ever receives.",
  fields: (t) => ({
    strengths: t.exposeString("strengths"),
    concerns: t.exposeString("concerns"),
    updatedAt: t.exposeString("updatedAt"),
  }),
});

const GuardianMeetingResultRef = builder.objectRef<GuardianMeetingResult>("GuardianMeetingResult");
GuardianMeetingResultRef.implement({
  description: "One published parents' meeting for one child (D-#1634): frozen figures + section best + the current final comment.",
  fields: (t) => ({
    meetingId: t.exposeString("meetingId"),
    instanceLabel: t.exposeString("instanceLabel"),
    meetingDateKey: t.exposeString("meetingDateKey"),
    publishedAt: t.exposeString("publishedAt"),
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    fromKey: t.exposeString("fromKey"),
    toKey: t.exposeString("toKey"),
    numbers: t.field({ type: ResultNumbersRef, resolve: (r) => r.numbers }),
    classBest: t.field({ type: ResultClassBestRef, nullable: true, resolve: (r) => r.classBest }),
    final: t.field({ type: ResultFinalRef, nullable: true, resolve: (r) => r.final }),
  }),
});

const principalCtx = (ctx: { auth: unknown }) => {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
};

builder.mutationField("publishMeetingToGuardians", (t) =>
  t.field({
    type: PublishMeetingResultRef,
    description:
      "PRINCIPAL only. Publish a meeting's figures + final comment to every family on it (attended or not). " +
      "Tells the families once (notification + pop-up); a repeat is a no-op. Audited (D-#1635).",
    authScopes: { hasPermission: "parents_meeting:view" },
    args: { meetingId: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => {
      principalCtx(ctx);
      return publishMeetingToGuardians(ctx, a.meetingId);
    },
  }),
);

builder.mutationField("withdrawMeetingRelease", (t) =>
  t.field({
    type: MeetingReleaseStatusRef,
    description: "PRINCIPAL only. Hide a published meeting from guardians again (nobody is messaged). Audited.",
    authScopes: { hasPermission: "parents_meeting:view" },
    args: { meetingId: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => {
      principalCtx(ctx);
      return withdrawMeetingRelease(ctx, a.meetingId);
    },
  }),
);

builder.queryField("meetingReleaseStatus", (t) =>
  t.field({
    type: MeetingReleaseStatusRef,
    description: "Release state + how many children have a final comment. parents_meeting:view.",
    authScopes: { hasPermission: "parents_meeting:view" },
    args: { meetingId: t.arg.string({ required: true }) },
    resolve: (_r, a) => meetingReleaseStatus(a.meetingId),
  }),
);

builder.queryField("guardianMeetingResults", (t) =>
  t.field({
    type: [GuardianMeetingResultRef],
    description:
      "The published, not-withdrawn parents' meetings for one child. The child's own guardian, or staff with " +
      "parents_meeting:view. Carries the final Principal/Office comment only — never a teacher comment (D-#1634).",
    authScopes: { authenticated: true },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => guardianMeetingResults(ctx, a.studentId),
  }),
);
