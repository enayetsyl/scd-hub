/**
 * PM (trackers-classtest.md): `setResultEntryTarget` was a primary-role
 * `role === "PRINCIPAL"` check; it is now the `class_test:settings` action
 * (PRINCIPAL_DEFAULT). Ship day: the Principal sets targets, nobody else does. After a
 * role edit or a per-person grant the action decides — template-aware (D-#467).
 *
 * Executed through the real built schema so the Pothos scope layer runs. DB-free:
 * the service is mocked.
 */
import mongoose from "mongoose";
import { graphql, type ExecutionResult } from "graphql";

const mockSetTarget = jest.fn(async (_i: unknown) => undefined);
jest.mock("../modules/trackers/services/ResultEntryTargetService", () => ({
  resultEntryTargetProgress: jest.fn(async () => null),
  setResultEntryTarget: (i: unknown) => mockSetTarget(i),
}));

import { builder } from "../schema";
import "../modules/trackers/resolvers/resultEntryTarget";
import { setRoleTemplateOverrides } from "@scd/shared";

const schema = builder.toSchema();

const SET = `mutation { setResultEntryTarget(userId: "u", subject: "MATH", lines: [], startKey: "2026-10-01", dueKey: "2026-10-31") }`;

const run = (role: string, grantedPermissions: string[] = []): Promise<ExecutionResult> =>
  graphql({
    schema,
    source: SET,
    contextValue: { auth: { role, userId: new mongoose.Types.ObjectId().toString(), grantedPermissions } },
  }) as Promise<ExecutionResult>;
const denied = (r: ExecutionResult) => (r.errors?.length ?? 0) > 0;

beforeEach(() => jest.clearAllMocks());
afterEach(() => setRoleTemplateOverrides({}));

describe("setResultEntryTarget = class_test:settings", () => {
  test("default switches: PRINCIPAL yes; OFFICE, TEACHER, GUARDIAN no", async () => {
    expect(denied(await run("PRINCIPAL"))).toBe(false);
    expect(mockSetTarget).toHaveBeenCalledTimes(1);
    expect(denied(await run("OFFICE"))).toBe(true);
    expect(denied(await run("TEACHER"))).toBe(true);
    expect(denied(await run("GUARDIAN"))).toBe(true);
    expect(mockSetTarget).toHaveBeenCalledTimes(1);
  });

  test("OFFICE switched on by a role edit may set targets", async () => {
    setRoleTemplateOverrides({ OFFICE: { granted: ["class_test:settings"], revoked: [] } });
    expect(denied(await run("OFFICE"))).toBe(false);
  });

  test("a TEACHER granted class_test:settings per person may set targets", async () => {
    expect(denied(await run("TEACHER", ["class_test:settings"]))).toBe(false);
  });
});
