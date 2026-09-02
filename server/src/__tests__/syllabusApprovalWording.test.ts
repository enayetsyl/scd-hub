/**
 * The approval card must say WHETHER the teacher has signed, not just who.
 *
 * Owner report, 2026-09-02, looking at a row sitting at PRINCIPAL_REVIEW:
 *
 *   যার কাছে আছে: Kawsar Hossain
 *   শিক্ষক অনুমোদন করে ফেললে আর বদলানো যাবে না।
 *
 * Kawsar had ALREADY approved it — that is why it had reached the Principal at
 * all — yet the first line says the row is *with* him, i.e. still waiting. The
 * second line is conditional ("once the teacher approves…") and so does not
 * settle it either. The card stated the opposite of the truth and then declined
 * to correct itself.
 *
 * The cause was a category error in my own D-#613 change: `approverUserId` is
 * who the row was SENT TO. Whether the sign-off has HAPPENED is a different
 * fact, held in `teacherApprovedBy` / `teacherApprovedAt` — both stored since
 * SY-5 and neither exposed, so the screen could not have said it correctly even
 * if the label had been right.
 *
 * Static reads: a label applied to the wrong stage is well-typed, renders
 * cleanly, and is wrong only to a person who knows what the row is doing.
 */
import { readFileSync } from "fs";
import path from "path";

const read = (rel: string): string =>
  readFileSync(path.resolve(__dirname, rel), "utf8").split("\r\n").join("\n");

const SCREEN = read("../../../app/src/screens/syllabus/SyllabusApprovalsScreen.tsx");
const LABELS = read("../../../app/src/lib/labels.ts");
const RESOLVER = read("../modules/exams/resolvers/examSyllabus.ts");
const READ_SERVICE = read("../modules/exams/services/ExamSyllabusReadService.ts");
const APP_GQL = read("../../../app/src/graphql/examSyllabus.ts");

describe("the approval facts reach the client", () => {
  test("the shape carries who signed, when, and whether it was a bypass", () => {
    expect(READ_SERVICE).toMatch(/teacherApprovedBy: string \| null;/);
    expect(READ_SERVICE).toMatch(/teacherApprovedAt: string \| null;/);
    expect(READ_SERVICE).toMatch(/teacherBypass: boolean;/);
  });

  test("a placeholder claims no approval — nothing is stored for it yet", () => {
    const ph = READ_SERVICE.match(/function placeholder\([\s\S]*?\n\}/)?.[0];
    expect(ph).toMatch(/teacherApprovedBy: null/);
    expect(ph).toMatch(/teacherBypass: false/);
  });

  test("all three are exposed and selected", () => {
    expect(RESOLVER).toMatch(/teacherApprovedBy: t\.string/);
    expect(RESOLVER).toMatch(/teacherApprovedAt: t\.string/);
    expect(RESOLVER).toMatch(/teacherBypass: t\.exposeBoolean/);
    // Exposing without asking would leave the card exactly as wrong as before.
    expect(APP_GQL).toMatch(
      /const SYLLABUS_FIELDS = `[\s\S]*?teacherApprovedBy teacherApprovedAt teacherBypass/,
    );
  });
});

describe("the card's wording", () => {
  test("an approved row says who APPROVED it, not who it is with", () => {
    // teacherApprovedBy is tested FIRST — the approved branch must win over the
    // sent-to branch, which is precisely the ordering that was wrong.
    expect(SCREEN).toMatch(
      /row\.teacherApprovedBy \?[\s\S]{0,400}?STR\.syApprovedBy[\s\S]{0,400}?row\.approverUserId \?[\s\S]{0,200}?STR\.syAwaitingTeacherFrom/,
    );
  });

  test('"যার কাছে আছে" is no longer used for every stage', () => {
    expect(SCREEN).not.toMatch(/STR\.syHeldBy/);
  });

  test("a Principal bypass is named as such, never attributed to a teacher", () => {
    // §7.2: the Principal signed IN THE TEACHER'S PLACE. Rendering that as
    // "approved by <Principal>" would read as the subject teacher having signed.
    expect(SCREEN).toMatch(/row\.teacherBypass[\s\S]{0,120}?STR\.syApprovedByBypass/);
  });

  test("the approval time is shown when it is known", () => {
    expect(SCREEN).toMatch(/row\.teacherApprovedAt[\s\S]{0,120}?isoDateTimeLabel/);
  });

  test("the reassign notice states a fact rather than a condition", () => {
    // "once the teacher approves it cannot be changed" does not tell the reader
    // whether that has happened; on this stage it has.
    const bn = LABELS.match(/syReassignOnlyTeacherStage: "([^"]+)"/)?.[1] ?? "";
    expect(bn).toContain("অনুমোদন হয়ে গেছে");
    expect(bn).not.toContain("করে ফেললে");
  });

  test("both languages carry every new label", () => {
    for (const k of ["syApprovedBy", "syApprovedByBypass", "syAwaitingTeacherFrom"]) {
      expect(LABELS.match(new RegExp(k + ":", "g"))?.length).toBe(2);
    }
  });
});
