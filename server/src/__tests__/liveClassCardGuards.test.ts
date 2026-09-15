/**
 * Live class board — the app-side rules that `tsc` cannot see (D-#674).
 *
 * Three of them would ship green and behave wrongly, and each has a precedent in this
 * repo's own history (D-#667/#668/#669 — placement, audience, and a well-typed
 * always-true guard):
 *
 *  1. The card must pick the live period from the DEVICE clock, not from the server's
 *     `phase` field. Rendering `cell.phase` is perfectly typed and freezes the card on
 *     whichever period was running when the screen was opened — the "updated as the
 *     period progresses" half of the owner's ask, silently absent.
 *  2. A cover that is only PROPOSED is not a teacher in the room: the no-teacher test
 *     must include UNASSIGNED as well as UNCOVERED, or a routine slot with no teacher
 *     reads as staffed.
 *  3. The board's "now" column must be gated on the date being TODAY, or opening
 *     yesterday's board highlights a period as live.
 *
 * Static source read, deliberately: the app workspace has no test runner (the
 * `todayCardsRendered.test.ts` / `navInitialRoute.test.ts` precedent).
 */
import { readFileSync } from "fs";
import path from "path";

const CARD = path.resolve(__dirname, "../../../app/src/components/LiveClassCard.tsx");
const BOARD = path.resolve(__dirname, "../../../app/src/screens/routine/LiveClassBoardScreen.tsx");
const cardSrc = readFileSync(CARD, "utf8");
const boardSrc = readFileSync(BOARD, "utf8");

/** Comments explain WHY the server's phase is not used and would defeat the check. */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("LiveClassCard — it follows the clock", () => {
  const code = stripComments(cardSrc);

  test("the live filter reads the cell's start/end against the DEVICE clock", () => {
    expect(code).toMatch(/c\.startTime <= hm && c\.endTime > hm/);
  });

  test("it never decides liveness from the server's `phase` field", () => {
    // The field is still fetched (other consumers read it); using it to choose the
    // rows is what freezes the card.
    expect(code).not.toMatch(/phase === "current"/);
  });

  test("a timer re-renders and refetches when the minute changes", () => {
    expect(code).toMatch(/setInterval/);
    expect(code).toMatch(/refetch(Ref\.current)?\(\{ requestPolicy: "network-only" \}\)/);
    expect(code).toMatch(/clearInterval/);
  });

  test("the tick effect has EMPTY deps — a re-created timer never fires", () => {
    // `[refetch]` is well-typed and plausible, and it resets the 30s timer on every
    // identity change of urql's execute function. The refetch goes through a ref instead.
    const effect = code.slice(code.indexOf("setInterval"));
    expect(effect).toMatch(/\}, \[\]\);/);
    expect(effect).not.toMatch(/\}, \[refetch\]\);/);
  });

  test("UNASSIGNED counts as no-teacher alongside UNCOVERED", () => {
    expect(code).toMatch(/status === "UNCOVERED" \|\| c\.status === "UNASSIGNED"/);
  });

  test("only an APPROVED cover replaces the teacher's name", () => {
    // COVERED is the only branch that prints coverTeacherName; a pending proposal is
    // printed beside the alert, never as the teacher.
    expect(code).toMatch(/status === "COVERED"[\s\S]{0,120}coverTeacherName/);
    expect(code).toMatch(/pendingCoverTeacherName/);
  });
});

describe("LiveClassBoardScreen — 'now' belongs to today only", () => {
  const code = stripComments(boardSrc);

  test("the live column is gated on the shown date being today", () => {
    expect(code).toMatch(/const liveColumn = \(start: string, end: string\): boolean =>\s*today && /);
    expect(code).toMatch(/const today = date === dateKey\(\)/);
  });

  test("the uncovered decision list and the filter use the same no-teacher rule", () => {
    expect(code).toMatch(/status === "UNCOVERED" \|\| c\.status === "UNASSIGNED"/);
    expect(code).toMatch(/filter\(noTeacher\)/);
  });
});
