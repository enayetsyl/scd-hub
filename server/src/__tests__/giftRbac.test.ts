/**
 * Who may reach the weekly gift (AG-3, D-#667 — owner ask 2026-09-14: the Office
 * desk hands out the gifts and could not see the report at all).
 *
 * The Office holds NO tracker permission and must keep holding none — D-#554 is
 * explicit that "the Office nudges and can never resolve a claim", and the vocab
 * verifier asserts it. So `gift:manage` is minted as its own permission rather than
 * widening `tracker:read`, and the three gift resolvers accept EITHER.
 *
 * Two halves:
 *   1. the role→permission map itself (a real import of shared vocab);
 *   2. a STATIC read of the resolver source, because the thing that would silently
 *      undo this is someone "tidying" `hasAnyPermission` back to a single
 *      `hasPermission: "tracker:read"` — which compiles, passes every service test,
 *      and locks the Office out again. That is the `supportBookResolverGates` posture.
 */
import { readFileSync } from "fs";
import path from "path";
import { roleHasPermission, PERMISSIONS, ROLE_PERMISSIONS, CATALOGUE_ROLE_DEFAULTS } from "@scd/shared";

const RESOLVER = path.resolve(
  __dirname,
  "../modules/trackers/resolvers/assignmentGift.ts",
);
const source = readFileSync(RESOLVER, "utf8");

describe("gift:manage — the permission", () => {
  test("exists", () => {
    expect(PERMISSIONS).toContain("gift:manage");
  });

  test("is held by PRINCIPAL and OFFICE, and by nobody else", () => {
    expect(roleHasPermission("PRINCIPAL", "gift:manage")).toBe(true);
    expect(roleHasPermission("OFFICE", "gift:manage")).toBe(true);
    expect(roleHasPermission("TEACHER", "gift:manage")).toBe(false);
    expect(roleHasPermission("GUARDIAN", "gift:manage")).toBe(false);
  });

  test("the Office STILL holds no tracker permission (D-#554 is not reopened)", () => {
    // The whole reason this permission exists. If a later change gives the Office
    // tracker:read "because the gift needs it", this is the test that says no.
    expect(ROLE_PERMISSIONS.OFFICE.some((p) => p.startsWith("tracker:"))).toBe(false);
  });

  test("the TEACHER route is unchanged — tracker:read still reaches the report", () => {
    // Teachers were never the problem; widening must not have narrowed them.
    expect(roleHasPermission("TEACHER", "tracker:read")).toBe(true);
  });
});

describe("gift resolvers — the gates", () => {
  /** Every gate declared in the file, in source order. */
  const gates = [...source.matchAll(/authScopes:\s*\{([^}]*\}?[^}]*)\}/g)].map((m) => m[1]);

  test("all three gift fields are gated", () => {
    const fields = [...source.matchAll(/builder\.(query|mutation)Field\("([^"]+)"/g)].map(
      (m) => m[2],
    );
    expect(fields.sort()).toEqual([
      "assignmentGiftReport",
      "recordGiftHandover",
      "undoGiftHandover",
    ]);
    expect(gates).toHaveLength(3);
  });

  test("PM: the report is assignment_gift:view, the ticks assignment_gift:issue", () => {
    // Was tracker:read OR gift:manage (either alone locked one caller out). The catalogue
    // actions are held by BOTH callers by default, so one action per field is enough.
    expect(gates[0]).toContain('"assignment_gift:view"');
    expect(gates[1]).toContain('"assignment_gift:issue"');
    expect(gates[2]).toContain('"assignment_gift:issue"');
    for (const g of gates) expect(g).not.toContain("tracker:");
  });

  test("PM: Teacher and Office both hold the gates' actions by default; only Office lifts the scope", () => {
    for (const r of ["TEACHER", "OFFICE"] as const) {
      expect(CATALOGUE_ROLE_DEFAULTS[r]).toContain("assignment_gift:view");
      expect(CATALOGUE_ROLE_DEFAULTS[r]).toContain("assignment_gift:issue");
    }
    // view_all replaces isAdminStaff (unscoped report + the class-teacher waiver).
    expect(CATALOGUE_ROLE_DEFAULTS.OFFICE).toContain("assignment_gift:view_all");
    expect(CATALOGUE_ROLE_DEFAULTS.TEACHER).not.toContain("assignment_gift:view_all");
    expect(source).toContain('callerHasPermission(ctx.auth, "assignment_gift:view_all")');
    expect(source).not.toContain("isAdminStaff(");
  });

  test("no gate was left as a bare single-permission check", () => {
    expect(source).not.toMatch(/authScopes:\s*\{\s*hasPermission:\s*"tracker:read"\s*\}/);
  });

  test("the handover mutations still re-derive scope in the resolver body", () => {
    // The permission opens the door; `assertCanHandOverGift` reads the section off the
    // STUDENT server-side so a teacher cannot tick someone else's class. Losing that
    // would turn a widened gate into a real privilege escalation.
    const recordBody = source.match(/recordGiftHandover[\s\S]*?resolve: async[\s\S]*?\n {4}\}/);
    expect(recordBody).not.toBeNull();
    expect(recordBody![0]).toContain("assertCanHandOverGift");
    const undoBody = source.match(/undoGiftHandover[\s\S]*?resolve: async[\s\S]*?\n {4}\}/);
    expect(undoBody![0]).toContain("assertCanHandOverGift");
  });
});
