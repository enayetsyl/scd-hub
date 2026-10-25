/**
 * One switch per report (D-#846, owner 2026-10-25): "I want teacher Shahida to see some of the
 * reports — homework not declared / not issued, assignment not delivered, class note pending,
 * homework not submitted — given to her individually."
 *
 *   - Each Reports-hub report opens on its own `reports:*` action and shows the WHOLE school.
 *   - The shared reconciliation payload returns ONLY the parts the caller was given: a teacher
 *     handed "homework not issued" never receives the assignment lists.
 *   - Office keeps every report by default; the Principal can hand one to one teacher, or
 *     switch one off for the whole Office role.
 * Executes the real GraphQL fields; the services are mocked. DB-free.
 */
import mongoose from "mongoose";
import { graphql, type ExecutionResult } from "graphql";
import { setRoleTemplateOverrides } from "@scd/shared";

jest.mock("../modules/trackers/services/ReconReportService");
jest.mock("../modules/trackers/services/HomeworkLifecycleReportService", () => ({
  homeworkLifecycleReport: jest.fn(),
  homeworkLifecyclePending: jest.fn(),
  isHwPendingStage: () => true,
}));
jest.mock("../modules/routine/services/TeacherClassLoadService", () => ({ teacherClassLoad: jest.fn() }));

import { builder } from "../schema";
import "../modules/trackers/resolvers/reconReport";
import "../modules/trackers/resolvers/hwLifecycleReport";
import "../modules/routine/resolvers/teacherClassLoad";

// These resolvers define only queries; a schema needs at least one mutation to build.
builder.mutationField("zzReportSwitchesNoop", (t) => t.boolean({ resolve: () => true }));

const schema = builder.toSchema();
const recon = jest.requireMock("../modules/trackers/services/ReconReportService") as Record<string, jest.Mock>;
const life = jest.requireMock("../modules/trackers/services/HomeworkLifecycleReportService") as Record<string, jest.Mock>;
const load = jest.requireMock("../modules/routine/services/TeacherClassLoadService") as Record<string, jest.Mock>;

const ME = new mongoose.Types.ObjectId().toString();
const OTHER = new mongoose.Types.ObjectId().toString();
const run = (source: string, role: string, extra: Record<string, unknown> = {}): Promise<ExecutionResult> =>
  graphql({ schema, source, contextValue: { auth: { role, userId: ME, ...extra } } }) as Promise<ExecutionResult>;
const refused = (r: ExecutionResult) => (r.errors ?? []).length > 0;

const PARTS = ["hwNotDeclared", "hwNilDeclared", "hwMisses", "asNotDeclared", "asNilDeclared", "asMisses", "asNotPrinted"] as const;
const RECON = `query { reconciliationReport(from: "2026-10-01", to: "2026-10-21") { ${PARTS.map((p) => `${p} { __typename }`).join(" ")} } }`;
const LIFE = `query { homeworkLifecycleReport(from: "2026-10-01", to: "2026-10-21") { __typename } }`;
const PENDING = (teacherId: string) =>
  `query { homeworkLifecyclePending(from: "2026-10-01", to: "2026-10-21", teacherId: "${teacherId}", stage: "SUBMIT") { __typename } }`;
const LOAD_ALL = `query { teacherClassLoad(month: "2026-10") { __typename } }`;

/** Which parts of the reconciliation payload came back non-empty. */
const nonEmpty = (r: ExecutionResult) =>
  PARTS.filter((p) => ((r.data?.reconciliationReport as Record<string, unknown[]> | undefined)?.[p] ?? []).length > 0);

beforeEach(() => {
  jest.clearAllMocks();
  const row = { dateKey: "2026-10-05" };
  recon.reconciliationReport.mockResolvedValue(Object.fromEntries(PARTS.map((p) => [p, [row]])));
  life.homeworkLifecycleReport.mockResolvedValue({ rows: [], backlog: [] });
  life.homeworkLifecyclePending.mockResolvedValue([]);
  load.teacherClassLoad.mockResolvedValue([]);
});
afterEach(() => setRoleTemplateOverrides({}));

describe("reconciliation payload — only the parts you were given", () => {
  test("Principal and Office get every part by default; a plain teacher is refused", async () => {
    expect(nonEmpty(await run(RECON, "PRINCIPAL"))).toEqual([...PARTS]);
    expect(nonEmpty(await run(RECON, "OFFICE"))).toEqual([...PARTS]);
    expect(refused(await run(RECON, "TEACHER"))).toBe(true);
  });

  test("Shahida given 'homework not issued' alone sees only that list", async () => {
    const r = await run(RECON, "TEACHER", { grantedPermissions: ["reports:hw_issue_pending"] });
    expect(refused(r)).toBe(false);
    expect(nonEmpty(r)).toEqual(["hwMisses"]);
  });

  test("'homework not declared' + 'assignment not delivered' give exactly those parts", async () => {
    const r = await run(RECON, "TEACHER", {
      grantedPermissions: ["reports:hw_declare_pending", "reports:as_deliver_pending"],
    });
    expect(nonEmpty(r)).toEqual(["hwNotDeclared", "hwNilDeclared", "asMisses"]);
  });

  test("the combined reconciliation switch opens every part", async () => {
    const r = await run(RECON, "TEACHER", { grantedPermissions: ["reports:reconciliation"] });
    expect(nonEmpty(r)).toEqual([...PARTS]);
  });

  test("switching a report off for the Office role empties just that part", async () => {
    // The combined reconciliation switch shows every part, so both must be off for this list to go.
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["reports:hw_issue_pending", "reports:reconciliation"] } });
    expect(nonEmpty(await run(RECON, "OFFICE"))).toEqual(PARTS.filter((p) => p !== "hwMisses"));
  });
});

describe("homework lifecycle report + its drill", () => {
  test("Office by default; a teacher only with the switch", async () => {
    expect(refused(await run(LIFE, "OFFICE"))).toBe(false);
    expect(refused(await run(LIFE, "TEACHER"))).toBe(true);
    expect(refused(await run(LIFE, "TEACHER", { grantedPermissions: ["reports:hw_lifecycle"] }))).toBe(false);
  });

  test("the drill into ANOTHER teacher needs the switch; your own never does", async () => {
    expect(refused(await run(PENDING(ME), "TEACHER"))).toBe(false);
    expect(refused(await run(PENDING(OTHER), "TEACHER"))).toBe(true);
    expect(refused(await run(PENDING(OTHER), "TEACHER", { grantedPermissions: ["reports:hw_lifecycle"] }))).toBe(false);
  });

  test("a per-person grant stored under the retired name still works (translation)", async () => {
    expect(refused(await run(LIFE, "TEACHER", { grantedPermissions: ["homework:view_reports"] }))).toBe(false);
  });
});

describe("teacher class load — every teacher's load", () => {
  test("Office by default; a teacher with only the report switch sees everyone, nothing else", async () => {
    expect(refused(await run(LOAD_ALL, "OFFICE"))).toBe(false);
    expect(refused(await run(LOAD_ALL, "TEACHER"))).toBe(true);
    expect(refused(await run(LOAD_ALL, "TEACHER", { grantedPermissions: ["reports:class_load"] }))).toBe(false);
  });
});
