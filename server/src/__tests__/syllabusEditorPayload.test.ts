/**
 * The syllabus editor must not send cache metadata back as mutation input.
 *
 * Found on prod by saving a syllabus a SECOND time:
 *
 *   Variable "$marks" got invalid value { __typename: "SyllabusMarkRow", ... }
 *   Field "__typename" is not defined by type "SyllabusMarkRowInput"
 *
 * urql's cacheExchange stamps `__typename` onto every object it returns. The
 * editor hydrated its rows with `{ ...m }` and sent them back with `{ ...r }`,
 * so the marker travelled from the query result into local state and out again
 * as input — and GraphQL rejects the whole mutation when an input object carries
 * a field its type does not define.
 *
 * The FIRST save of a new subject always worked, because those rows come from
 * emptyRow() and never touched the cache. Only a save-reopen-save cycle failed,
 * which is why it survived the walkthrough: every subject was written once.
 *
 * A static read of the screen, because this is invisible to tsc — `__typename`
 * is a perfectly legal extra property on a spread.
 */
import { readFileSync } from "fs";
import path from "path";

const SRC = readFileSync(
  path.resolve(__dirname, "../../../app/src/screens/syllabus/SyllabusEditorScreen.tsx"),
  "utf8",
);

/** The exact fields SyllabusMarkRowInput accepts. */
const INPUT_FIELDS = ["seq", "label", "itemType", "component", "count", "marksEach", "total"];

describe("the mark-row payload is built explicitly", () => {
  test("rows are NOT hydrated by spreading the query result", () => {
    // `stored.marks.map((m) => ({ ...m }))` is what carried __typename in.
    expect(SRC).not.toMatch(/stored\.marks\.map\(\(m\) => \(\{ \.\.\.m \}\)\)/);
  });

  test("the mutation payload is NOT a bare spread of local rows", () => {
    expect(SRC).not.toMatch(/marks: rows\.map\(\(r, i\) => \(\{ \.\.\.r, seq: i \+ 1 \}\)\)/);
  });

  test("a narrowing helper exists and lists every input field, and only those", () => {
    const i = SRC.indexOf("function toDraft");
    expect(i).toBeGreaterThan(-1);
    const body = SRC.slice(i, SRC.indexOf("\n}", i));
    for (const f of INPUT_FIELDS) {
      expect(body.includes(f + ":")).toBe(true);
    }
    // Nothing else may be copied across — least of all the cache marker.
    expect(body).not.toMatch(/__typename/);
    const assigned = [...body.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]);
    expect(assigned.sort()).toEqual([...INPUT_FIELDS].sort());
  });

  test("both the hydrate and the save path go through the helper", () => {
    expect(SRC).toMatch(/setRows\(stored\.marks\.length \? stored\.marks\.map\(toDraft\)/);
    expect(SRC).toMatch(/marks: rows\.map\(\(r, i\) => \(\{ \.\.\.toDraft\(r\), seq: i \+ 1 \}\)\)/);
  });
});
