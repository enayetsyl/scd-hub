/**
 * Where the subject boundary actually lives for the roster-pass workspaces.
 *
 * D-#388 (owner, 2026-07-29) settled a rule that had flip-flopped twice in ten days:
 *
 *   READS  — the class teacher sees the WHOLE section. The workspace folds other
 *            subjects away (SubjectFold) and renders them read-only, so oversight
 *            costs nothing and "where does my section stand?" is answerable. The read
 *            resolvers therefore must NOT pass `classTeacherOversight: false`; doing so
 *            starves the fold of input and the coordinator sees only their own subject.
 *   WRITES — unchanged and unchanged-able by any UI: `assertCanWrite` → `canWrite`
 *            honours only `teaching`/`proxy` grants matching section AND subject, with
 *            no class-teacher or supervisory escape. Oversight can never become
 *            authorship, whatever the client renders.
 *
 * This file guards BOTH halves, because the previous version of it asserted the exact
 * opposite of the read rule (D-#386, superseded hours later) — a guard pinning the
 * wrong invariant is worse than none, so it is pinned here to the decision that
 * survived, with the write gate asserted alongside so the pair cannot drift apart.
 *
 * Static reads of the source, in the navInitialRoute.test.ts tradition: the wiring is
 * what regressed, not the helper (which trackerSubjectScope.test.ts covers).
 */
import { readFileSync } from "fs";
import path from "path";

const RESOLVERS = path.resolve(__dirname, "../modules/trackers/resolvers");

/** Read queries feeding a workspace card list (or its counts). */
const WORKSPACE_READS = [
  { file: "homework.ts", field: "homeworkOpenRecords" },
  { file: "homework.ts", field: "homeworkItemTallies" },
  { file: "assignment.ts", field: "assignmentOpenRecords" },
  { file: "assignment.ts", field: "assignmentItemTallies" },
];

/** Lifecycle mutations — each must assert a WRITE scope before touching anything. */
const WORKSPACE_WRITES = [
  { file: "homework.ts", field: "homeworkSubmitPass", gate: "assertItemWriteScope" },
  { file: "homework.ts", field: "homeworkReturnPass", gate: "assertItemWriteScope" },
];

/** Body of `builder.queryField("<name>", ...)` / mutationField, to the next one. */
function fieldBody(source: string, field: string): string {
  const start = source.search(new RegExp(`builder\\.(query|mutation)Field\\("${field}"`));
  if (start === -1) throw new Error(`field "${field}" not found`);
  const next = source.slice(start + 1).search(/builder\.(query|mutation)Field\("/);
  return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next);
}

describe("workspace subject boundary (D-#388)", () => {
  describe("reads — the class teacher keeps oversight, the fold does the hiding", () => {
    for (const { file, field } of WORKSPACE_READS) {
      test(`${field} does NOT disable classTeacherOversight`, () => {
        const body = fieldBody(readFileSync(path.join(RESOLVERS, file), "utf8"), field);
        expect(body).toContain("allowedSubjectCodesForSection");
        expect(body.replace(/\s+/g, " ")).not.toMatch(/classTeacherOversight:\s*false/);
      });
    }
  });

  describe("writes — the real boundary, independent of anything the client renders", () => {
    for (const { file, field, gate } of WORKSPACE_WRITES) {
      test(`${field} asserts write scope via ${gate}`, () => {
        const body = fieldBody(readFileSync(path.join(RESOLVERS, file), "utf8"), field);
        expect(body).toContain(gate);
      });
    }

    test("assertItemWriteScope resolves the ITEM's subject, not just the section", () => {
      const src = readFileSync(path.join(RESOLVERS, "homework.ts"), "utf8");
      const fn = src.slice(src.indexOf("async function assertItemWriteScope"));
      const body = fn.slice(0, fn.indexOf("\n}") + 2).replace(/\s+/g, " ");
      // A section-only assertCanWrite would let any teacher on the section write any
      // subject — the subject id must be derived from the item and passed through.
      expect(body).toMatch(/assertCanWrite\(.*subject/s);
    });
  });

  test("the guarded fields still exist (rename canary)", () => {
    for (const { file, field } of [...WORKSPACE_READS, ...WORKSPACE_WRITES]) {
      const src = readFileSync(path.join(RESOLVERS, file), "utf8");
      expect(src).toMatch(new RegExp(`builder\\.(query|mutation)Field\\("${field}"`));
    }
  });
});
