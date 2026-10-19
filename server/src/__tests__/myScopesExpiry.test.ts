/**
 * D-#770 — `myScopes` leaves out grants authz no longer honours.
 *
 * A dated routine retirement (the combined section's grants at a gender split) stamps
 * `expiresAt` and leaves the row `active: true`; an expired delegation does the same
 * (D-#488). composeTeacherScope skips both at request time, but myScopes listed them,
 * so the emptied section came back into the teacher's pickers. One predicate
 * (`isGrantLapsed`) now serves both.
 *
 * DB-free: the ScopeGrant model is mocked; the real schema executes.
 */
import mongoose from "mongoose";
import { graphql, type ExecutionResult } from "graphql";

const oid = () => new mongoose.Types.ObjectId();

const mockGrantFind = jest.fn();
jest.mock("../modules/foundation/models/ScopeGrant", () => ({
  ...jest.requireActual("../modules/foundation/models/ScopeGrant"),
  ScopeGrant: { find: (q: unknown) => ({ lean: async () => mockGrantFind(q) }) },
}));

import { builder } from "../schema";
import "../modules/foundation/resolvers/scopeGrants";
import { isGrantLapsed } from "../modules/foundation/services/ScopeGrantService";

const schema = builder.toSchema();
const TEACHER = oid().toString();
const run = (): Promise<ExecutionResult> =>
  graphql({
    schema,
    source: "{ myScopes { id kind sectionId } }",
    contextValue: { auth: { role: "TEACHER", userId: TEACHER } },
  }) as Promise<ExecutionResult>;

const HOUR = 3_600_000;

describe("isGrantLapsed — the authz expiry rule", () => {
  const now = new Date("2026-10-25T00:00:00+06:00");
  test("teaching + delegation lapse at expiresAt (inclusive), not before", () => {
    expect(isGrantLapsed({ kind: "teaching", expiresAt: now }, now)).toBe(true);
    expect(isGrantLapsed({ kind: "teaching", expiresAt: new Date(now.getTime() - HOUR) }, now)).toBe(true);
    expect(isGrantLapsed({ kind: "teaching", expiresAt: new Date(now.getTime() + HOUR) }, now)).toBe(false);
    expect(isGrantLapsed({ kind: "delegation", expiresAt: new Date(now.getTime() - HOUR) }, now)).toBe(true);
    expect(isGrantLapsed({ kind: "teaching", expiresAt: null }, now)).toBe(false);
    expect(isGrantLapsed({ kind: "teaching" }, now)).toBe(false);
  });

  test("supervisory and proxy grants are never lapsed by expiresAt (authz ignores it for them)", () => {
    const past = new Date(now.getTime() - HOUR);
    expect(isGrantLapsed({ kind: "supervisory", expiresAt: past }, now)).toBe(false);
    expect(isGrantLapsed({ kind: "proxy", expiresAt: past }, now)).toBe(false);
  });
});

describe("myScopes (D-#770)", () => {
  test("drops a teaching grant whose expiresAt has passed; keeps live and future-dated ones", async () => {
    const lapsed = { _id: oid(), kind: "teaching", active: true, teacherId: TEACHER, classId: oid(), sectionId: oid(), subjectId: oid(), expiresAt: new Date(Date.now() - HOUR) };
    const live = { _id: oid(), kind: "teaching", active: true, teacherId: TEACHER, classId: oid(), sectionId: oid(), subjectId: oid() };
    const lapsingLater = { ...live, _id: oid(), sectionId: oid(), expiresAt: new Date(Date.now() + 24 * HOUR) };
    const expiredDelegation = { _id: oid(), kind: "delegation", active: true, teacherId: TEACHER, extent: "whole_school", actions: ["declare_assignment"], expiresAt: new Date(Date.now() - HOUR) };
    mockGrantFind.mockResolvedValue([lapsed, live, lapsingLater, expiredDelegation]);

    const r = await run();
    expect(r.errors).toBeUndefined();
    const ids = (r.data as { myScopes: Array<{ id: string }> }).myScopes.map((g) => g.id);
    expect(ids).toEqual([live._id.toString(), lapsingLater._id.toString()]);
    expect(mockGrantFind).toHaveBeenCalledWith({ teacherId: TEACHER, active: true });
  });
});
