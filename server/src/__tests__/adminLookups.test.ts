/**
 * Slice-4 follow-up lookups — myScopes enrichment + admin users/proxyGrants.
 *
 * grantView — the pure lean-doc → client-view mapper behind myScopes and
 *             proxyGrants: ObjectIds stringified, dates ISO, non-applicable
 *             fields null (a teaching grant carries no proxy detail and vice
 *             versa).
 * RBAC      — the new `users` + `proxyGrants` queries are gated by the EXISTING
 *             user:manage permission (no new permission, no scope change):
 *             Principal-only, same as createUser/assignProxy.
 *
 * DB-free: grantView is pure; RBAC posture reads the shared vocab directly.
 */
import mongoose from "mongoose";
import { roleHasPermission } from "@scd/shared";
import { grantView } from "../modules/foundation/services/ScopeGrantService";

const oid = () => new mongoose.Types.ObjectId();

describe("grantView (lean grant → client view)", () => {
  test("teaching grant exposes class/section/subject ids as strings, proxy fields null", () => {
    const classId = oid();
    const sectionId = oid();
    const subjectId = oid();
    const _id = oid();
    const v = grantView({
      _id,
      kind: "teaching",
      active: true,
      classId,
      sectionId,
      subjectId,
    });
    expect(v).toEqual({
      id: _id.toString(),
      kind: "teaching",
      active: true,
      teacherId: null,
      classId: classId.toString(),
      sectionId: sectionId.toString(),
      subjectId: subjectId.toString(),
      coveringTeacherId: null,
      absentTeacherId: null,
      startDate: null,
      durationDays: null,
      proxyStatus: null,
      extent: null,
      explicitSet: null,
    });
  });

  test("supervisory grant exposes extent + explicitSet, proxy/teaching detail null", () => {
    const classId = oid();
    const subjectId = oid();
    const v = grantView({
      _id: oid(),
      kind: "supervisory",
      active: true,
      extent: "explicit_set",
      explicitSet: [{ classId, subjectId }],
    });
    expect(v.kind).toBe("supervisory");
    expect(v.extent).toBe("explicit_set");
    expect(v.explicitSet).toEqual([{ classId: classId.toString(), subjectId: subjectId.toString() }]);
    expect(v.coveringTeacherId).toBeNull();
    expect(v.proxyStatus).toBeNull();
  });

  test("teaching grant exposes teacherId (subject-teacher roster relies on it)", () => {
    const teacherId = oid();
    const v = grantView({
      _id: oid(),
      kind: "teaching",
      active: true,
      teacherId,
      classId: oid(),
      sectionId: oid(),
      subjectId: oid(),
    });
    expect(v.teacherId).toBe(teacherId.toString());
  });

  test("proxy grant exposes cover detail with ISO startDate", () => {
    const covering = oid();
    const absent = oid();
    const start = new Date("2026-06-09T00:00:00+06:00");
    const v = grantView({
      _id: oid(),
      kind: "proxy",
      active: true,
      classId: oid(),
      sectionId: oid(),
      coveringTeacherId: covering,
      absentTeacherId: absent,
      startDate: start,
      durationDays: 3,
      proxyStatus: "active",
    });
    expect(v.kind).toBe("proxy");
    expect(v.coveringTeacherId).toBe(covering.toString());
    expect(v.absentTeacherId).toBe(absent.toString());
    expect(v.startDate).toBe(start.toISOString());
    expect(v.durationDays).toBe(3);
    expect(v.proxyStatus).toBe("active");
    expect(v.subjectId).toBeNull(); // a proxy grant has no subject binding
  });

  test("supervisory whole-school grant maps with all id fields null", () => {
    const v = grantView({ _id: oid(), kind: "supervisory", active: true });
    expect(v.kind).toBe("supervisory");
    expect(v.classId).toBeNull();
    expect(v.sectionId).toBeNull();
    expect(v.subjectId).toBeNull();
    expect(v.startDate).toBeNull();
  });

  test("inactive (revoked) proxy grant keeps active=false + proxyStatus for history rows", () => {
    const v = grantView({
      _id: oid(),
      kind: "proxy",
      active: false,
      classId: oid(),
      sectionId: oid(),
      coveringTeacherId: oid(),
      startDate: new Date("2026-06-01T00:00:00+06:00"),
      durationDays: 2,
      proxyStatus: "revoked",
    });
    expect(v.active).toBe(false);
    expect(v.proxyStatus).toBe("revoked");
  });
});

describe("users / proxyGrants RBAC posture (existing user:manage — no new permission)", () => {
  test("PRINCIPAL holds user:manage (sees the admin lookups)", () => {
    expect(roleHasPermission("PRINCIPAL", "user:manage")).toBe(true);
  });

  test("OFFICE does NOT hold user:manage (lookups stay Principal-only, like createUser)", () => {
    expect(roleHasPermission("OFFICE", "user:manage")).toBe(false);
  });

  test("TEACHER and GUARDIAN do NOT hold user:manage", () => {
    expect(roleHasPermission("TEACHER", "user:manage")).toBe(false);
    expect(roleHasPermission("GUARDIAN", "user:manage")).toBe(false);
  });
});
