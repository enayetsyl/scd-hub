/**
 * The syllabus editor's submit gate (SY-4) — a STATIC read of the screen source.
 *
 * Why a source read rather than a rendered test: the app workspace has no test
 * runner, and the bug this pins was invisible to `tsc` and to `expo export`
 * because it was a perfectly well-typed boolean that happened to be wrong.
 *
 * The bug, found on prod by pressing the button: submit was gated on
 * `!stored?.id`. `stored` is the saved row, and a subject being written for the
 * FIRST time has no row — it is a placeholder with a null id. So the primary
 * action was permanently dead on exactly the case it exists for: a fresh
 * syllabus, balanced at 100, with an approver named from the routine, and a grey
 * button saying nothing about why.
 *
 * Two invariants are asserted here, both of which the shipped code broke:
 *   1. the gate depends only on things the CALLER can act on;
 *   2. every disabled state explains itself.
 */
import { readFileSync } from "fs";
import path from "path";

const SRC = readFileSync(
  path.resolve(__dirname, "../../../app/src/screens/syllabus/SyllabusEditorScreen.tsx"),
  "utf8",
);

/** The `disabled={…}` expression on the submit button. */
function submitDisabledExpr(): string {
  const i = SRC.indexOf("STR.sySubmitToTeacher");
  expect(i).toBeGreaterThan(-1);
  const after = SRC.slice(i, i + 1200);
  const m = /disabled=\{([^}]*)\}/.exec(after);
  expect(m).not.toBeNull();
  return m![1];
}

describe("submit gate", () => {
  test("does NOT depend on the stored row existing — that is what save creates", () => {
    expect(submitDisabledExpr()).not.toMatch(/stored/);
  });

  test("depends on the rows balancing and on the routine naming an approver", () => {
    const expr = submitDisabledExpr();
    expect(expr).toMatch(/!balanced/);
    expect(expr).toMatch(/holders\.length === 0/);
  });

  test("every disabled reason is explained on screen", () => {
    // An unbalanced sheet says so, and a subject the routine has no teacher for
    // says so. A grey primary action with no reason is the state this shipped in.
    expect(SRC).toMatch(/!balanced \? <Muted>\{STR\.syMustBe100\}/);
    expect(SRC).toMatch(/holders\.length === 0 \? <Muted>\{STR\.syNoApprover\}/);
  });
});

describe("submit flow", () => {
  test("submits with the id SAVE returned, never one read back off `stored`", () => {
    const i = SRC.indexOf("async function onSubmit");
    const body = SRC.slice(i, SRC.indexOf("\n  }", i));
    // `stored` is the previous query result in this render's closure; right after
    // a save it is still null for a new subject, so submitting off it did nothing.
    expect(body).not.toMatch(/stored\??\.id/);
    expect(body).toMatch(/const id = await onSave\(\)/);
    expect(body).toMatch(/submit\(\{ id,/);
  });

  test("onSave hands back the id so a first write can save-and-submit in one press", () => {
    expect(SRC).toMatch(/async function onSave\(\): Promise<string \| null>/);
    expect(SRC).toMatch(/return res\.data\?\.saveExamSyllabus\.id/);
  });

  test("a refused save aborts the submit rather than sending a half-written row", () => {
    const i = SRC.indexOf("async function onSubmit");
    const body = SRC.slice(i, SRC.indexOf("\n  }", i));
    expect(body).toMatch(/if \(!id\) return;/);
  });
});
