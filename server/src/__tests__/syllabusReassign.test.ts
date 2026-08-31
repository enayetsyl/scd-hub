/**
 * Moving a syllabus from one teacher to another (D-#613).
 *
 * Before this existed the only route was ফেরত দিন → খসড়া → re-submit. That works,
 * but it records an ordinary staffing change as a REJECTION of the first
 * teacher's work, and a send-back demands a mandatory reason, so the row ends up
 * carrying a criticism that was never meant.
 *
 * The two rules that matter are both refusals, and both are about accountability
 * rather than convenience:
 *
 *   stage   TEACHER_REVIEW only. DRAFT has no holder to move (submit is where the
 *           teacher is chosen), and once the teacher has signed off, re-pointing
 *           the row would credit their approval to somebody who never read it.
 *   person  a routine holder of the pair, the same check submit runs. D-#366
 *           forbids silently seating an accountable teacher, and a reassign that
 *           skipped it would be the back door around a rule the front door keeps.
 *
 * Static reads: the guards are plain control flow that tsc cannot judge, and the
 * question here is whether the REFUSALS exist at all, not how they are worded.
 */
import { readFileSync } from "fs";
import path from "path";

/**
 * Read a source file with its line endings NORMALISED.
 *
 * Not cosmetic: a Windows checkout gives CRLF, so a pattern written with `\n`
 * silently stops matching and the suite fails on the developer's machine while
 * passing in CI. Learned the hard way — the D-#609 suite did exactly that.
 */
const read = (rel: string): string =>
  readFileSync(path.resolve(__dirname, rel), "utf8").split("\r\n").join("\n");

const SERVICE = read("../modules/exams/services/ExamSyllabusService.ts");
const RESOLVER = read("../modules/exams/resolvers/examSyllabus.ts");
const AUDIT = read("../modules/platform/models/Audit.ts");
const SCREEN = read("../../../app/src/screens/syllabus/SyllabusApprovalsScreen.tsx");

/** The reassign function body alone — the guards must be ITS guards. */
const FN = SERVICE.match(
  /export async function reassignSyllabusApprover[\s\S]*?\n\}/,
)?.[0];

describe("the reassign service", () => {
  test("exists", () => {
    expect(FN).toBeDefined();
  });

  test("is refused unless the row is with a teacher right now", () => {
    // Not `!== "DRAFT"`: the point is that PRINCIPAL_REVIEW and PUBLISHED are
    // refused too, which a not-draft check would let through.
    expect(FN).toMatch(/doc\.status !== "TEACHER_REVIEW"/);
    expect(FN).toMatch(/ForbiddenError/);
  });

  test("only a routine holder of the pair can be seated (D-#366)", () => {
    expect(FN).toMatch(/isRoutineHolder\(approverUserId, doc\.classId, doc\.subject\)/);
  });

  test("it is exam:manage, so Office can do it and not only the Principal", () => {
    expect(FN).toMatch(/assertCanManage\(ctx\)/);
    expect(RESOLVER).toMatch(
      /reassignExamSyllabus[\s\S]{0,900}?authScopes: \{ hasPermission: "exam:manage" \}/,
    );
  });

  test("it writes an audit row naming BOTH ends of the move", () => {
    // "who has it now" survives on the row; "who was it taken from" exists
    // nowhere else the moment approverUserId is overwritten.
    expect(FN).toMatch(/eventKind: "EXAM_SYLLABUS_REASSIGNED"/);
    expect(FN).toMatch(/fromUserId: previous/);
    expect(FN).toMatch(/toUserId: approverUserId/);
    expect(AUDIT).toMatch(/"EXAM_SYLLABUS_REASSIGNED"/);
  });

  test("the previous holder is captured BEFORE the field is overwritten", () => {
    // Reading it after the assignment would log the move as from-self-to-self.
    const readAt = FN!.indexOf("const previous");
    const writeAt = FN!.indexOf("doc.approverUserId = new Types.ObjectId");
    expect(readAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(-1);
    expect(readAt).toBeLessThan(writeAt);
  });

  test("moving a row to the teacher it is already with is a no-op, not an error", () => {
    expect(FN).toMatch(/previous === approverUserId/);
    expect(FN).toMatch(/return doc;/);
  });

  test("the stage is NOT changed — a reassign is not a re-submission", () => {
    // Setting status here would restart a review the row is already in, and
    // would silently un-do a send-back's DRAFT if it ever ran on one.
    expect(FN).not.toMatch(/doc\.status = /);
  });
});

describe("the approvals screen", () => {
  test("shows who a row is with", () => {
    expect(SCREEN).toMatch(/row\.approverUserId/);
    expect(SCREEN).toMatch(/STR\.syHeldBy/);
  });

  test("offers the move only while the row is with a teacher", () => {
    expect(SCREEN).toMatch(/row\.status === "TEACHER_REVIEW" \? \([\s\S]{0,900}?STR\.syReassign/);
  });

  test("the teacher list comes from the ROUTINE, never free text", () => {
    // A typed name is exactly what the server refuses; offering one would be a
    // control whose only outcome is a refusal.
    expect(SCREEN).toMatch(/holders\.map\(\(h\) => \(\{/);
    expect(SCREEN).toMatch(/EXAM_SYLLABUS_APPROVER/);
  });

  test("Office reaches the board, but publish still rides the PRINCIPAL role", () => {
    expect(SCREEN).toMatch(/const canManage = can\("exam:manage"\)/);
    expect(SCREEN).toMatch(/canPublish=\{isPrincipal\}/);
    // The publish button must actually consult it, not merely receive it.
    expect(SCREEN).toMatch(/disabled=\{row\.status === "TEACHER_REVIEW" \|\| !balanced \|\| !canPublish\}/);
  });

  test("the manage-only reads are paused on a teacher's card", () => {
    // examSyllabusApprover requires exam:manage; firing it for a teacher would
    // put a guaranteed refusal on a screen that must never show an error.
    expect(SCREEN).toMatch(/pause: !isManage/);
  });
});
