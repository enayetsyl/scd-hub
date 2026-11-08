/**
 * D-#1110 — an objective with sub-objectives takes Question / Rubric from its tagged children
 * (childAssessMix, shared/objectiveTree.ts). The review screen shows this instead of the
 * objective's own single value, which no longer applies once it has children.
 * DB-free.
 */
import fs from "node:fs";
import path from "node:path";
import { childAssessMix, readTreeFile } from "@scd/shared";

describe("childAssessMix (D-#1110)", () => {
  it("splits tagged children by Question / Rubric and flags a mix", () => {
    const mix = childAssessMix([
      { code: "A.1", assess: "RUBRIC", tagged: true },
      { code: "A.2", assess: "RUBRIC", tagged: true },
      { code: "A.3", assess: "QUESTION", tagged: true },
    ]);
    expect(mix).toEqual({ question: ["A.3"], rubric: ["A.1", "A.2"], mixed: true });
  });

  it("is not mixed when every child is one kind", () => {
    expect(childAssessMix([{ code: "B.1", assess: "QUESTION", tagged: true }, { code: "B.2", assess: "QUESTION", tagged: true }]).mixed).toBe(false);
    expect(childAssessMix([]).mixed).toBe(false);
  });

  it("leaves out untagged (grouping) children and reads a missing assess as Question", () => {
    const mix = childAssessMix([
      { code: "C.1", assess: "RUBRIC", tagged: false },
      { code: "C.2", assess: null, tagged: true },
    ]);
    expect(mix).toEqual({ question: ["C.2"], rubric: [], mixed: false });
  });

  it("the C1 Math draft already mixes both kinds on the objectives the reviewer named", () => {
    const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../docs/mastery/objective-tree/C1_MATH.tree.json"), "utf8"));
    const read = readTreeFile(raw);
    if (!read.ok) throw new Error(read.errors.join("\n"));
    const nodes = read.tree.nodes;
    const mixOf = (code: string) =>
      childAssessMix(nodes.filter((n) => n.parentCode === code).map((n) => ({ code: n.code, assess: n.assess, tagged: n.tagged })));
    for (const code of ["LO-C1-MATH-06-01", "LO-C1-MATH-10-01", "LO-C1-MATH-11-01", "LO-C1-MATH-12-01", "LO-C1-MATH-12-05"]) {
      expect(mixOf(code).mixed).toBe(true);
    }
  });
});
