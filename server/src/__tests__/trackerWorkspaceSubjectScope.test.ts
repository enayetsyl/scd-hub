/**
 * Invariant: the roster-pass WORKSPACE queries are subject-scoped for EVERY teacher,
 * class teacher included — they must pass `classTeacherOversight: false`.
 *
 * Owner decision 2026-07-19: a class teacher's oversight exists so they can reconcile
 * the day/week, not so they can collect and mark another teacher's subject. Homework
 * adopted this immediately; ASSIGNMENTS WERE MISSED, and a class teacher kept seeing
 * every subject's assignment cards for the section until an owner report on 2026-07-29.
 *
 * `allowedSubjectCodesForSection` itself is covered by trackerSubjectScope.test.ts.
 * What was never covered — and what actually broke — is whether each RESOLVER opts
 * out of the class-teacher shortcut. That is a property of the call site, so this is
 * a deliberate static read of the source, in the navInitialRoute.test.ts tradition:
 * the app/server wiring is the thing that regressed, not the helper.
 */
import { readFileSync } from "fs";
import path from "path";

const RESOLVERS = path.resolve(__dirname, "../modules/trackers/resolvers");

/** Query fields whose result feeds a workspace card list (or its counts). */
const SUBJECT_SCOPED_QUERIES = [
  { file: "homework.ts", field: "homeworkOpenRecords" },
  { file: "homework.ts", field: "homeworkItemTallies" },
  { file: "assignment.ts", field: "assignmentOpenRecords" },
  { file: "assignment.ts", field: "assignmentItemTallies" },
];

/** The body of `builder.queryField("<name>", ...)` up to the next queryField. */
function queryFieldBody(source: string, field: string): string {
  const start = source.indexOf(`builder.queryField("${field}"`);
  if (start === -1) throw new Error(`queryField "${field}" not found`);
  const next = source.indexOf("builder.queryField(", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

describe("roster-pass workspaces are subject-scoped for every teacher", () => {
  for (const { file, field } of SUBJECT_SCOPED_QUERIES) {
    test(`${field} passes classTeacherOversight:false`, () => {
      const source = readFileSync(path.join(RESOLVERS, file), "utf8");
      const body = queryFieldBody(source, field);

      expect(body).toContain("allowedSubjectCodesForSection");
      // Whitespace-tolerant: the option object is usually wrapped across lines.
      expect(body.replace(/\s+/g, " ")).toMatch(/classTeacherOversight:\s*false/);
    });
  }

  test("the guarded set still exists in the source (rename canary)", () => {
    for (const { file, field } of SUBJECT_SCOPED_QUERIES) {
      const source = readFileSync(path.join(RESOLVERS, file), "utf8");
      expect(source).toContain(`builder.queryField("${field}"`);
    }
  });
});
