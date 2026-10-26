/**
 * Reports that sat elsewhere join the Reports hub (D-#861, owner 2026-10-26): "Attendance
 * ranking and Guardian reports — unresolved are reports but sit in Admin… all reports in one
 * place, and all report permissions given from one place."
 *
 *   - Each moved report opens on its own `reports:*` switch for a TEACHER who holds nothing else
 *     (Sajeda: Guardian reports — unresolved), and the module read that opened it before
 *     still does.
 *   - Without either, the field still refuses.
 *   - The guardian-claims switch reads the queue without the digest designation; reminding is
 *     NOT part of it.
 * Executes the real GraphQL fields; the services are mocked, the DB is never reached. Only the
 * auth gate is asserted: anything past it (a mocked service's empty answer) counts as "opened".
 */
import mongoose from "mongoose";
import { graphql, type ExecutionResult } from "graphql";

jest.mock("../modules/attendance/services/AttendanceRankingService");
jest.mock("../modules/routine/services/LiveClassBoardService");
jest.mock("../modules/engagement/services/GuardianEngagementService");
jest.mock("../modules/lesson-progress/services/LessonProgressService");

import { builder } from "../schema";
import "../modules/attendance/resolvers/attendanceRanking";
import "../modules/routine/resolvers/liveClassBoard";
import "../modules/engagement/resolvers/guardianEngagement";
import "../modules/lesson-progress/resolvers/lessonProgress";
import { canWatchClaims } from "../modules/trackers/services/WorkClaimDigestService";

builder.mutationField("zzMovedReportsNoop", (t) => t.boolean({ resolve: () => true }));
const schema = builder.toSchema();

// A stray model read must fail fast, never hang on mongoose's buffer.
mongoose.set("bufferCommands", false);

const ME = new mongoose.Types.ObjectId().toString();
const run = (source: string, granted: string[] = []): Promise<ExecutionResult> =>
  graphql({ schema, source, contextValue: { auth: { role: "TEACHER", userId: ME, grantedPermissions: granted } } }) as Promise<ExecutionResult>;
const refusedByGate = (r: ExecutionResult): boolean => (r.errors ?? []).some((e) => /Not authorized/i.test(e.message));

const FIELDS: Array<{ name: string; query: string; switch: string; moduleRead: string }> = [
  {
    name: "student attendance ranking",
    query: `query { studentAttendanceRanking(window: "month", anchorKey: "2026-10-26", axis: "school") { __typename } }`,
    switch: "reports:attendance_ranking",
    moduleRead: "attendance:view_all",
  },
  {
    name: "staff attendance ranking",
    query: `query { staffAttendanceRanking(window: "month", anchorKey: "2026-10-26") { __typename } }`,
    switch: "reports:attendance_ranking",
    moduleRead: "staff_attendance:view_all",
  },
  {
    name: "today's class board",
    query: `query { liveClassBoard(date: "2026-10-26") { __typename } }`,
    switch: "reports:live_classes",
    moduleRead: "routine:view_all",
  },
  {
    name: "guardian engagement",
    query: `query { guardianEngagement { __typename } }`,
    switch: "reports:guardian_engagement",
    moduleRead: "guardian_engagement:view",
  },
  {
    name: "lesson-plan progress (whole school)",
    query: `query { lessonProgressOverview { __typename } }`,
    switch: "reports:lesson_progress",
    moduleRead: "lesson_progress:view_all",
  },
];

describe("moved reports open on their own switch (D-#861)", () => {
  for (const f of FIELDS) {
    it(`${f.name}: the switch alone opens it`, async () => {
      expect(refusedByGate(await run(f.query, [f.switch]))).toBe(false);
    });
    it(`${f.name}: the module read still opens it`, async () => {
      expect(refusedByGate(await run(f.query, [f.moduleRead]))).toBe(false);
    });
    it(`${f.name}: a plain teacher is refused`, async () => {
      expect(refusedByGate(await run(f.query))).toBe(true);
    });
  }
});

describe("guardian reports — unresolved (Sajeda's grant)", () => {
  const ctx = (granted: string[]) => ({ auth: { role: "TEACHER", userId: ME, grantedPermissions: granted } }) as never;

  it("the switch reads the queue without the digest designation", async () => {
    expect(await canWatchClaims(ctx(["reports:guardian_claims"]))).toBe(true);
  });

  it("the switch is not a licence to remind", async () => {
    // Remind still walks the designation/waiver path (a digest-list read, which fails here with
    // no DB) — the switch never short-circuits it to true.
    const remind = canWatchClaims(ctx(["reports:guardian_claims"]), "work_claim:remind").catch(() => false);
    await expect(remind).resolves.toBe(false);
  });
});
