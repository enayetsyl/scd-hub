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
import { roleHasPermission, PERMISSIONS, ROLE_PERMISSIONS } from "@scd/shared";

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

  test("every gate accepts BOTH tracker:read and gift:manage", () => {
    // Either alone is a bug: tracker:read alone locks the Office out (the reported
    // problem); gift:manage alone locks the class teacher out of her own section.
    for (const g of gates) {
      expect(g).toContain("hasAnyPermission");
      expect(g).toContain("tracker:read");
      expect(g).toContain("gift:manage");
    }
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
