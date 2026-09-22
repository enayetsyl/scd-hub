/**
 * A syllabus states what it is out of (D-#694).
 *
 * D-#532 made Σ = 100 one universal guard, deliberately refusing a per-class-band
 * lookup — what FILLS the 100 varies, the 100 itself does not. That held until the
 * owner supplied the pre-primary papers on 2026-09-22: নার্সারি sits কুরআন and
 * আরবি out of **50**, beside a 100-mark বাংলা in the same class. So the total is
 * not a property of the class band after all — it is a property of the PAPER, and
 * a universal constant made those two syllabuses impossible to store at all rather
 * than merely awkward.
 *
 * The guard itself is unchanged in spirit: one comparison, against a number the
 * row carries. What is asserted here:
 *   default   — an omitted fullMarks is 100, so every existing row and caller is
 *               untouched. This is the compatibility claim the migration rests on.
 *   enforced  — a 50-mark paper is refused at 100 and accepted at 50, and the
 *               error names the number it wanted.
 *   gates     — submit and publish re-check against the ROW, not the constant, or
 *               a 50-mark paper could be written and then never published.
 *   approval  — changing the total clears a sign-off (§7.3): a teacher who signed
 *               a 100-mark paper has not signed a 50-mark one.
 *
 * Pure-function tests where possible: validateMarkRows is exported precisely so
 * the app can run the same check, and a test of the real function is worth more
 * than a test of a copy of it.
 */
import { readFileSync } from "fs";
import path from "path";
import {
  validateMarkRows,
  EXAM_SYLLABUS_FULL_MARKS,
  type ISyllabusMarkRow,
} from "../modules/exams/models/ExamSyllabus";

/** Source reads are CRLF-normalised — the repo checks out with Windows endings. */
const read = (rel: string): string =>
  readFileSync(path.resolve(__dirname, rel), "utf8").split("\r\n").join("\n");

const MODEL = read("../modules/exams/models/ExamSyllabus.ts");
const SERVICE = read("../modules/exams/services/ExamSyllabusService.ts");
const READ_SERVICE = read("../modules/exams/services/ExamSyllabusReadService.ts");
const RESOLVER = read("../modules/exams/resolvers/examSyllabus.ts");
const EDITOR = read("../../../app/src/screens/syllabus/SyllabusEditorScreen.tsx");
const APPROVALS = read("../../../app/src/screens/syllabus/SyllabusApprovalsScreen.tsx");

const row = (label: string, count: number, marksEach: number): ISyllabusMarkRow => ({
  seq: 1,
  label,
  count,
  marksEach,
  total: count * marksEach,
});

/** The owner's real নার্সারি কুরআন paper: 3 x 10 + 4 x 5 = 50. */
const NURSERY_QURAN: ISyllabusMarkRow[] = [
  { seq: 1, label: "মুখস্ত সূরা (তিনটি প্রশ্ন)", itemType: "oral", count: 3, marksEach: 10, total: 30 },
  { seq: 2, label: "দোয়া (চারটি প্রশ্ন)", itemType: "oral", count: 4, marksEach: 5, total: 20 },
];

/** A plain 100-mark paper. */
const HUNDRED: ISyllabusMarkRow[] = [row("সব", 10, 10)];

describe("the default is 100, so nothing that existed before changes", () => {
  test("an omitted fullMarks means 100", () => {
    expect(validateMarkRows(HUNDRED)).toBeNull();
    expect(validateMarkRows(NURSERY_QURAN)).not.toBeNull();
  });

  test("the exported constant is still 100", () => {
    expect(EXAM_SYLLABUS_FULL_MARKS).toBe(100);
  });

  test("the schema default is the constant, not a literal", () => {
    // A literal 100 here would drift the day the constant moves.
    expect(MODEL).toMatch(/fullMarks: \{ type: Number, default: SYLLABUS_FULL_MARKS, min: 1 \}/);
  });

  test("a row stored before the field existed reads as 100, not as 0", () => {
    // Every syllabus on prod predates this change and has no fullMarks at all.
    // Falling back to 0 would make all 33 of them instantly unpublishable.
    expect(READ_SERVICE).toMatch(/fullMarks: row\.fullMarks \?\? SYLLABUS_FULL_MARKS/);
  });
});

describe("the guard runs against the number the paper declares", () => {
  test("the নার্সারি কুরআন paper is accepted at 50", () => {
    expect(validateMarkRows(NURSERY_QURAN, 50)).toBeNull();
  });

  test("...and refused at 100, naming the total it wanted", () => {
    const err = validateMarkRows(NURSERY_QURAN, 100);
    expect(err).not.toBeNull();
    // Both numbers, so the reader can see WHICH of the two is wrong. ASCII digits
    // inside a Bangla sentence is the pre-existing shape of this message — noted,
    // not changed here, because it is every mark-distribution error, not just this.
    expect(err).toContain("50");
    expect(err).toContain("100");
  });

  test("a 100-mark paper is refused at 50 — the guard cuts both ways", () => {
    expect(validateMarkRows(HUNDRED, 50)).not.toBeNull();
  });

  test("the per-row arithmetic check is unaffected by the total", () => {
    const bad: ISyllabusMarkRow[] = [{ seq: 1, label: "ভুল", count: 3, marksEach: 10, total: 50 }];
    expect(validateMarkRows(bad, 50)).toContain("কিন্তু মোট লেখা আছে");
  });

  test("a nonsense total is refused rather than silently accepted", () => {
    // Without this, fullMarks: 0 would make an empty-ish paper "balanced".
    expect(validateMarkRows(HUNDRED, 0)).not.toBeNull();
    expect(validateMarkRows(HUNDRED, -50)).not.toBeNull();
    expect(validateMarkRows(HUNDRED, 33.5)).not.toBeNull();
  });

  test("an empty table is still refused whatever the total", () => {
    expect(validateMarkRows([], 50)).not.toBeNull();
  });
});

describe("every gate measures the row against itself", () => {
  test("submit and publish pass the row's own fullMarks, not the constant", () => {
    // Three call sites: save (the input's), submit and publish (the row's). If
    // either gate kept the constant, a 50-mark paper could be written and then
    // never sent or never released — worse than refusing it at the door.
    const calls = SERVICE.match(/validateMarkRows\([^)]*\)/g) ?? [];
    expect(calls).toHaveLength(3);
    expect(calls.filter((c) => c.includes("doc.fullMarks"))).toHaveLength(2);
    expect(calls.filter((c) => c.includes("input.marks, fullMarks"))).toHaveLength(1);
  });

  test("the save path defaults an omitted total to 100", () => {
    expect(SERVICE).toMatch(/const fullMarks = input\.fullMarks \?\? SYLLABUS_FULL_MARKS/);
  });

  test("changing the total clears a sign-off, like any other content change (§7.3)", () => {
    // A teacher who signed off a 100-mark paper has not signed off a 50-mark one.
    const block = SERVICE.slice(SERVICE.indexOf("const contentChanged ="), 300 +
      SERVICE.indexOf("const contentChanged ="));
    expect(block).toMatch(/existing\.fullMarks \?\? SYLLABUS_FULL_MARKS\) !== fullMarks/);
  });

  test("...but a stored row with NO fullMarks is not treated as changed", () => {
    // Caught by an existing test, not by design: every row on prod predates this
    // field, so a bare `existing.fullMarks !== fullMarks` reads undefined vs 100
    // as a change and clears the sign-off on the first save of ANY of them. The
    // coalesce is the whole reason this comparison is safe to add.
    const block = SERVICE.slice(SERVICE.indexOf("const contentChanged ="), 300 +
      SERVICE.indexOf("const contentChanged ="));
    expect(block).not.toMatch(/[^?]\s*existing\.fullMarks !== fullMarks/);
  });

  test("the new total is actually persisted on an update", () => {
    expect(SERVICE).toMatch(/existing\.fullMarks = fullMarks;/);
  });
});

describe("the app compares against the same number the server does", () => {
  test("the editor badge and submit gate use the paper's total", () => {
    // Two independent ideas of "balanced" is how the button says green and the
    // server says no — the failure validateMarkRows is exported to prevent.
    expect(EDITOR).toMatch(/const balanced = sum === fullMarks;/);
    expect(EDITOR).not.toMatch(/sum === SYLLABUS_FULL_MARKS/);
  });

  test("the editor sends the total it displayed", () => {
    expect(EDITOR).toMatch(/fullMarks,\s*\n\s*bodyMd,/);
  });

  test("the publish gate uses the row's total", () => {
    expect(APPROVALS).toMatch(/row\.totalMarks === \(row\.fullMarks \|\| SYLLABUS_FULL_MARKS\)/);
  });

  test("it is on the wire in both directions", () => {
    expect(RESOLVER).toMatch(/fullMarks: t\.exposeInt\("fullMarks"\)/);
    expect(RESOLVER).toMatch(/fullMarks: t\.arg\.int\(\{ required: false \}\)/);
  });
});
