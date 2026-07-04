/**
 * teacherAvailability gate widening (PXG-1, D-#268): routine:manage → any
 * authenticated staff, guardians still excluded. Executes a real GraphQL query
 * against the built schema with each role's context, mirroring
 * classTestSummaryRbac.test.ts's pattern — the whole routineSlots.ts resolver
 * file's dependency surface is mocked to import it (it registers many fields on
 * the shared builder singleton); gate behavior, not the availability algorithm
 * itself (already covered by routineCover.test.ts), is under test here.
 *
 * DB-free.
 */
import { graphql, type ExecutionResult } from "graphql";

jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: { find: jest.fn(() => ({ sort: () => ({ lean: async () => [] }) })) },
}));
jest.mock("../modules/routine/services/RoutineSlotService", () => ({
  createRoutineSlot: jest.fn(),
  updateRoutineSlot: jest.fn(),
  deleteRoutineSlot: jest.fn(),
  routineForDate: jest.fn(async () => []),
}));
const mockTeacherAvailability = jest.fn((..._a: unknown[]) =>
  Promise.resolve([{ teacherId: "t1", name: "Karim", classCount: 2, free: true }]),
);
jest.mock("../modules/routine/services/RoutineCoverService", () => ({
  teacherAvailability: (...a: unknown[]) => mockTeacherAvailability(...a),
  assignCover: jest.fn(),
  cancelCover: jest.fn(),
  coversForDate: jest.fn(async () => []),
}));
jest.mock("../modules/routine/slotView", () => ({ enrichRoutineSlots: (s: unknown) => s }));
jest.mock("../modules/routine/routineMaster", () => ({
  routineMasterGrid: jest.fn(),
  routineMasterWeek: jest.fn(),
}));

import { builder } from "../schema";
import "../modules/routine/resolvers/routineSlots";

builder.mutationField("_teacherAvailabilityGateTestNoop", (t) => t.boolean({ resolve: () => true }));
const schema = builder.toSchema();

type Ctx = { auth: { role: string; userId: string } | null };
const ctxOf = (role: string | null): Ctx => ({ auth: role ? { role, userId: "u1" } : null });

const run = (role: string | null): Promise<ExecutionResult> =>
  graphql({
    schema,
    source: `query { teacherAvailability(date: "2026-06-14", periodNumber: 2) { teacherId free } }`,
    contextValue: ctxOf(role),
  }) as Promise<ExecutionResult>;

const ok = (r: ExecutionResult) => !r.errors || r.errors.length === 0;
const denied = (r: ExecutionResult) => (r.errors?.length ?? 0) > 0;

beforeEach(() => jest.clearAllMocks());

describe("teacherAvailability — widened gate (D-#268)", () => {
  test("a plain TEACHER (no routine:manage) is now allowed", async () => {
    const r = await run("TEACHER");
    expect(ok(r)).toBe(true);
    expect(mockTeacherAvailability).toHaveBeenCalled();
  });

  test("OFFICE/PRINCIPAL are allowed", async () => {
    expect(ok(await run("OFFICE"))).toBe(true);
    expect(ok(await run("PRINCIPAL"))).toBe(true);
  });

  test("GUARDIAN is still denied (plane isolation)", async () => {
    const r = await run("GUARDIAN");
    expect(denied(r)).toBe(true);
    expect(mockTeacherAvailability).not.toHaveBeenCalled();
  });

  test("unauthenticated is denied", async () => {
    expect(denied(await run(null))).toBe(true);
  });
});
