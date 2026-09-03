/**
 * Every notification kind the server can emit must either deep-link somewhere or be
 * DELIBERATELY listed here as not navigating (WC-6).
 *
 * `notificationTarget` ends in `default: return null`, so a kind nobody mapped is a
 * silent dead end: the row renders, marks itself read, and goes nowhere when
 * tapped. Nothing fails — not tsc (the switch takes a plain `string`), not the
 * suite, not `expo export`. Four kinds shipped that way with the guardian
 * work-claim loop, including the one telling a teacher that a parent says the work
 * is done, which is the row where acting quickly is the entire point.
 *
 * The app workspace has no test runner, so this lives here — the same reason
 * `navInitialRoute.test.ts` does. It is a static read of the source on purpose: it
 * asserts what is WRITTEN, which is where the omission was.
 */
import { readFileSync } from "fs";
import path from "path";
import { NOTIFICATION_KINDS } from "@scd/shared";

const NAV = path.resolve(__dirname, "../../../app/src/lib/notificationNav.ts");
const source = readFileSync(NAV, "utf8");

/**
 * Kinds that legitimately do not navigate. Each needs a reason — "we forgot" is not
 * one, and that is the point of making the omission explicit rather than implicit.
 * Shrinking this list is progress; adding to it should take a conscious argument.
 */
const KNOWN_UNMAPPED: Record<string, string> = {
  CLASS_TEST_UPCOMING: "informational only — the exam has no screen to act on yet",
  MONTHLY_REPORT: "the report is delivered as a document, not an in-app screen",
  TEACHING_NOTE_PUBLISHED: "TN-3 deep-link (TeachingNoteDoc) not wired yet",
  TEACHING_NOTE_COMMENT: "TN-3 deep-link (TeachingNoteDoc) not wired yet",
  TEACHING_NOTE_COMMENT_ADDRESSED: "TN-3 deep-link (TeachingNoteDoc) not wired yet",
};

const isMapped = (kind: string) => source.includes(`case "${kind}":`);

describe("notification deep-links cover every kind the server emits", () => {
  test("no kind is an accidental dead end", () => {
    const missing = NOTIFICATION_KINDS.filter((k) => !isMapped(k) && !(k in KNOWN_UNMAPPED));
    expect(missing).toEqual([]);
  });

  test("the work-claim loop navigates — the WC-6 regression itself", () => {
    for (const kind of [
      "WORK_CLAIM_FILED",
      "WORK_CLAIM_ESCALATED",
      "WORK_CLAIM_RESOLVED",
      "STUDENT_RETURNED",
    ]) {
      expect(isMapped(kind)).toBe(true);
    }
  });

  test("the exception list stays honest — nothing on it is actually mapped", () => {
    const stale = Object.keys(KNOWN_UNMAPPED).filter(isMapped);
    expect(stale).toEqual([]);
  });

  test("the exception list names only real kinds", () => {
    const unknown = Object.keys(KNOWN_UNMAPPED).filter(
      (k) => !(NOTIFICATION_KINDS as readonly string[]).includes(k),
    );
    expect(unknown).toEqual([]);
  });

  test("the reader actually found the switch (guard against a silent no-op)", () => {
    // If the file is ever restructured away from a switch, every `isMapped` call
    // returns false and the first test would fail loudly rather than pass emptily —
    // but a mapped kind proves the reader is looking at the right thing today.
    expect(isMapped("BELL_REMINDER")).toBe(true);
    expect(source).toContain("export function notificationTarget");
  });
});

describe("a work-claim tap can reach the right list", () => {
  test("the guardian answer branches on the tracker, not on a guess", () => {
    // WORK_CLAIM_RESOLVED is one kind for both trackers; without `workClaimTracker`
    // a homework answer would open the assignment tab.
    expect(source).toContain('refs?.workClaimTracker === "ASSIGNMENT"');
  });

  test("the app asks the server for the claim refs it now maps on", () => {
    const ops = readFileSync(
      path.resolve(__dirname, "../../../app/src/graphql/operations.ts"),
      "utf8",
    );
    expect(ops).toContain("workClaimId workClaimTracker");
  });

  test("the server exposes those refs — a stored ref nobody selects is invisible", () => {
    const resolver = readFileSync(
      path.resolve(__dirname, "../modules/notifications/resolvers/notifications.ts"),
      "utf8",
    );
    expect(resolver).toContain("workClaimId: t.string(");
    expect(resolver).toContain("workClaimTracker: t.string(");
  });

  test("and the schema stores it — mongoose silently strips a ref it does not declare", () => {
    const model = readFileSync(
      path.resolve(__dirname, "../modules/notifications/models/Notification.ts"),
      "utf8",
    );
    expect(model).toContain("workClaimTracker: { type: String }");
  });
});

describe("a ref the deep-link reads must survive the whole wire", () => {
  // The CT-8 submit notice repeated WC-6 exactly: `classTestId`/`ctId` were written
  // onto the row and stored, but neither the GraphQL type nor the app's selection
  // named them — so the approver's tap fell through to the dashboard and they had to
  // re-find the exam by hand. Rather than assert one more kind by name, assert the
  // RULE: every ref the switch branches on is selected by the app and exposed by the
  // server. A ref nobody selects is always `null`, and a `null` ref silently takes
  // the fallback branch — which is why both bugs looked like a working deep-link.
  const ops = readFileSync(path.resolve(__dirname, "../../../app/src/graphql/operations.ts"), "utf8");
  const resolver = readFileSync(
    path.resolve(__dirname, "../modules/notifications/resolvers/notifications.ts"),
    "utf8",
  );
  const model = readFileSync(
    path.resolve(__dirname, "../modules/notifications/models/Notification.ts"),
    "utf8",
  );
  const refsRead = [...new Set([...source.matchAll(/\brefs\??\.(\w+)/g)].map((m) => m[1]))];
  const selection = ops.slice(ops.indexOf("const NOTIFICATION_FIELDS"), ops.indexOf("MY_NOTIFICATIONS_QUERY"));

  test("the reader found some refs at all (guard against an empty sweep)", () => {
    expect(refsRead).toContain("classTestId");
    expect(refsRead.length).toBeGreaterThan(4);
  });

  test("the app selects every ref it navigates on", () => {
    expect(refsRead.filter((r) => !selection.includes(r))).toEqual([]);
  });

  test("the server exposes every ref the app navigates on", () => {
    expect(refsRead.filter((r) => !resolver.includes(`${r}: t.`))).toEqual([]);
  });

  test("and mongoose declares them — an undeclared ref is stripped on write", () => {
    expect(refsRead.filter((r) => !model.includes(`${r}: { type:`))).toEqual([]);
  });

  test("the CT-8 submit notice opens the exam's RESULTS, not the dashboard", () => {
    // D-#637: the approver's first act is to read the marks, and the results screen
    // carries the publish button through to approval. The publish screen alone shows
    // অনুমোদন / ফেরত with the marks nowhere in sight. The dashboard is only the
    // fallback for a row with no exam id. Asserted INSIDE the arm, so the string
    // cannot be satisfied by some other case further down the switch.
    const arm = source.slice(source.indexOf('case "CT_RESULT_SUBMITTED":'));
    expect(arm.slice(0, arm.indexOf("case ", 1))).toContain('screen: "ClassTestResults"');
  });

  test("the CT-8 publish notice opens the exam's results, not the tab home", () => {
    // The teacher is being told the marks reached guardians; ClassTestResultsView is
    // the screen that shows what was released. ClassTestHome stays the fallback.
    expect(source).toContain('screen: "ClassTestResultsView"');
  });

  test("both halves of the loop are id-driven, not kind-driven", () => {
    // Guards the shape rather than the destination: if either arm is ever flattened
    // back to a bare `return {tab, screen}`, the recipient silently lands on a list
    // again — which is the whole bug, twice.
    for (const kind of ["CT_RESULT_SUBMITTED", "CT_RESULT_PUBLISHED"]) {
      const arm = source.slice(source.indexOf(`case "${kind}":`));
      expect(arm.slice(0, arm.indexOf("case ", 1))).toContain("refs?.classTestId");
    }
  });
});
