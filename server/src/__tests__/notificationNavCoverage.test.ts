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
