/**
 * The permission-matrix rule, enforced (PM, docs/prd-permission-matrix.md §9, D-#799).
 *
 * A SOURCE-SCANNING test (the D-#592 posture): the code is right, the grant is right, and a
 * person is still refused or let through because a gate names the wrong string — no runtime
 * test sees that. So this reads every server and app source file and fails when:
 *   1. a gate (or any code) names a LEGACY permission (`tracker:write`, `roster:manage`, …)
 *      instead of a catalogue `feature:action`;
 *   2. a GraphQL field is open to any login (no authScopes, or `authenticated` only) and is not
 *      on the OPEN_FIELDS allow-list below, with its reason;
 *   3. a catalogue action gates nothing on the server (a dead switch: the Principal turns it
 *      off and nothing changes), unless it is SELF or declared ahead of its slice;
 *   4. a new role-based capability check appears (`isAdminStaff(`, `role === "PRINCIPAL"`, …)
 *      beyond the frozen baseline — reach is `view_all` / `edit_all`, designations stay
 *      designations;
 *   5. the app checks a permission string that is not catalogued.
 * Adding a feature? Register ALL its actions in shared/permissionCatalogue.ts and
 * docs/permission-catalogue/, gate every resolver on one, and this test stays green.
 */
import fs from "fs";
import path from "path";
import { CATALOGUE_PERMISSIONS, LEGACY_PERMISSIONS, catalogueAction } from "@scd/shared";

const SERVER_SRC = path.join(__dirname, "..");
const APP_SRC = path.join(__dirname, "../../../app/src");

const CATALOGUE = new Set<string>(CATALOGUE_PERMISSIONS);
/** Permission strings a gate may name besides the catalogue: the guardian plane. */
const NON_CATALOGUE_OK = new Set(["guardian:read_child"]);
/** Legacy names that are ALSO catalogue actions (same string, same meaning). */
const LEGACY_FORBIDDEN = new Set<string>(LEGACY_PERMISSIONS.filter((p) => !CATALOGUE.has(p) && !NON_CATALOGUE_OK.has(p)));

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && e.name !== "__tests__") walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Source with block comments and comment-only lines removed (line numbers kept). */
function code(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((l) => (/^\s*\/\//.test(l) ? "" : l))
    .join("\n");
}

const rel = (f: string, base: string) => path.relative(base, f).split(path.sep).join("/");
const serverFiles = walk(SERVER_SRC).map((f) => ({ f: rel(f, SERVER_SRC), s: code(f) }));
const appFiles = walk(APP_SRC).map((f) => ({ f: rel(f, APP_SRC), s: code(f) }));

/** Fields open to any login, each with the reason it needs no catalogue action. */
const OPEN_FIELDS: Record<string, string> = {
  // Sign-in and the caller's own session / profile / access (SELF; a guardian uses them too).
  staffLogin: "sign-in", guardianLogin: "sign-in", refreshSession: "own session", endImpersonation: "end own View-as",
  me: "own profile", myPermissions: "own access", myTemplates: "own templates", myScopes: "own scope grants",
  // Own notifications, push registration and announcement (SELF, guardian included).
  myNotifications: "own inbox", myNotificationsPage: "own inbox", myNotification: "own inbox",
  myUnreadNotificationCount: "own inbox", markNotificationRead: "own inbox", markNotificationsRead: "own inbox",
  markAllNotificationsRead: "own inbox", myAnnouncement: "own announcement", webPushPublicKey: "push key",
  // Own pop-up notices (D-#855): the caller's own queue, events and আমার বার্তা — guardian included.
  myPopupQueue: "own pop-ups", recordPopupEvent: "own pop-up progress", myPopupHistoryPage: "own pop-ups",
  registerWebPush: "own push", unregisterWebPush: "own push", registerPushDevice: "own push",
  unregisterPushDevice: "own push",
  // Shared reference data every screen needs (no person data).
  classes: "reference: classes", subjects: "reference: subjects", academicYears: "reference: years",
  // Staff pickers: the resolver refuses a guardian login (F-1/F-2); names for every staff screen.
  studentsInSection: "staff roster picker, guardian refused in the resolver",
  teachers: "staff name picker, guardian refused in the resolver",
  staffDirectory: "staff directory, row/field gated in the resolver",
  // The caller's own work, scoped to themselves inside the resolver.
  mySectionsAsClassTeacher: "own class-teacher sections", amILibrarian: "own librarian duty",
  myDay: "own Today; each card self-gates on its action", myReviewQuota: "own observation quota",
  myResultEntryTarget: "own result-entry target", myWorkClaims: "own claims (SELF)",
  homeworkLifecyclePending: "self, or homework:view_reports checked in the body",
  ctQuestionCounts: "counts scoped to the caller's actions in the body",
  classTestOverdueCounts: "counts scoped to the caller's actions in the body",
  planReviewThread: "reviewer/assigner of THIS round, checked in the body",
  questionReviewThread: "reviewer/assigner of THIS round, checked in the body",
  // Guardian plane (guardian:read_child is checked in the body).
  childLibraryLoans: "guardian plane",
};

/** Catalogue actions declared ahead of the slice that will gate them. */
const DECLARED_AHEAD: Record<string, string> = {};

/** Role-based checks that remain on purpose (frozen; the count may only go DOWN):
 *  target-protection guards (whose login is touched), recipient routing splits, the book
 *  self-review stamp, and the pre-matrix fallback inside the scope helpers (used only when
 *  a call site passes no reach). */
const ROLE_CHECK_BASELINE: Record<string, number> = {
  "middleware/authz.ts": 6,
  "modules/attendance/services/AttendanceReminderService.ts": 1,
  "modules/foundation/services/ImpersonationService.ts": 2,
  "modules/foundation/services/ProvisioningService.ts": 2,
  "modules/foundation/services/RoleScope.ts": 3,
  "modules/support-book/resolvers/supportBookReview.ts": 1,
  "modules/trackers/classTestAnchor.ts": 3,
  "modules/trackers/resolvers/classTestSummary.ts": 1,
  "modules/workboard/services/OfficeCoverService.ts": 1,
};
const ROLE_CHECK_RE = /isAdminStaff\(|isPrincipalStaff\(|actsAsRole\(|role === "(?:PRINCIPAL|OFFICE|TEACHER)"/g;

const literals = (s: string) => [...s.matchAll(/"([a-z_]+:[a-z_]+)"/g)].map((m) => m[1]);

describe("permission catalogue gates (D-#799)", () => {
  test("no server code names a legacy permission", () => {
    const hits = serverFiles.flatMap(({ f, s }) => literals(s).filter((p) => LEGACY_FORBIDDEN.has(p)).map((p) => `${f}: ${p}`));
    expect(hits).toEqual([]);
  });

  test("no app code names a legacy permission", () => {
    const hits = appFiles.flatMap(({ f, s }) => literals(s).filter((p) => LEGACY_FORBIDDEN.has(p)).map((p) => `${f}: ${p}`));
    expect(hits).toEqual([]);
  });

  test("every permission named in an authScopes gate is catalogued", () => {
    const bad: string[] = [];
    for (const { f, s } of serverFiles) {
      for (const m of s.matchAll(/authScopes:\s*\{([^}]*)\}/g)) {
        for (const p of literals(m[1])) if (!CATALOGUE.has(p) && !NON_CATALOGUE_OK.has(p)) bad.push(`${f}: ${p}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("every app can(...) check names a catalogued action", () => {
    const bad: string[] = [];
    for (const { f, s } of appFiles) {
      for (const m of s.matchAll(/\bcan\(\s*"([^"]+)"\s*\)/g)) {
        if (!CATALOGUE.has(m[1]) && !NON_CATALOGUE_OK.has(m[1])) bad.push(`${f}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("a field open to any login is on the OPEN_FIELDS allow-list (and the list has no stale names)", () => {
    const open = new Set<string>();
    for (const { s } of serverFiles) {
      const re = /(?:queryField|mutationField|subscriptionField)\(\s*"([A-Za-z0-9_]+)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s))) {
        const body = s.slice(m.index, m.index + 1500);
        const next = body.slice(1).search(/(?:queryField|mutationField|subscriptionField)\(/);
        const own = next >= 0 ? body.slice(0, next + 1) : body;
        const scope = own.match(/authScopes:\s*(\{[^}]*\}|[A-Za-z_][\w.]*(?:\([^)]*\))?)/);
        const isOpen = !scope || (/^\{/.test(scope[1]) && /authenticated:\s*true/.test(scope[1]) && !/Permission/.test(scope[1]));
        if (isOpen) open.add(m[1]);
      }
    }
    const unexpected = [...open].filter((n) => !(n in OPEN_FIELDS));
    const stale = Object.keys(OPEN_FIELDS).filter((n) => !open.has(n));
    expect({ unexpected, stale }).toEqual({ unexpected: [], stale: [] });
  });

  test("every switchable catalogue action gates something on the server (no dead switch)", () => {
    const named = new Set<string>();
    for (const { s } of serverFiles) for (const p of literals(s)) named.add(p);
    const dead = CATALOGUE_PERMISSIONS.filter(
      (p) => !named.has(p) && !catalogueAction(p).flags.includes("SELF") && !(p in DECLARED_AHEAD),
    );
    expect(dead).toEqual([]);
    // A declared-ahead action that is now gated must leave the list.
    expect(Object.keys(DECLARED_AHEAD).filter((p) => named.has(p))).toEqual([]);
  });

  test("no new role-based capability check (frozen baseline; reach is view_all / edit_all)", () => {
    const counts: Record<string, number> = {};
    for (const { f, s } of serverFiles) {
      const n = (s.match(ROLE_CHECK_RE) ?? []).length;
      if (n > 0) counts[f] = n;
    }
    const grown = Object.entries(counts).filter(([f, n]) => n > (ROLE_CHECK_BASELINE[f] ?? 0)).map(([f, n]) => `${f}: ${n}`);
    expect(grown).toEqual([]);
  });
});
