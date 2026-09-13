/**
 * `delegatedClassReach` — the class picker's view of an ACS-1 delegation (D-#484).
 *
 * Owner report from prod: a teacher was given a whole-school duty grant (declare/submit/
 * check homework and assignment, "Whole school (all classes & subjects)") and still had
 * no submit control anywhere. Permissions were not the cause — Read/Write trackers were
 * both on, from the Teacher template. The cause was navigation: a delegation reaches its
 * work through an EXTENT and carries no `sectionId`, while every source the picker read
 * keyed on one, so the class list came back empty. The server would have accepted the
 * writes the whole time (`assertCanRead`/`assertCanWrite` honour the extent, D-#485/#486)
 * — the duty was real, enforceable, and unreachable.
 *
 * The two rules worth a test are the ones a later edit would "tidy away":
 *
 *  - `subject_dept` must NOT be in reach. `extentCovers` answers it
 *    `!!subjectId && s.subjectId === subjectId`, and the tracker reads call
 *    `assertCanRead(sectionId, classId)` with no subject, so the grant fails the read
 *    gate on every section. Including it would replace an empty picker with one whose
 *    every entry 403s on open — a worse failure, because it looks like it should work.
 *  - Expiry must be re-checked even though `active` is true. A lapsed delegation stays
 *    active on purpose: it survives as history and the window is enforced at request
 *    time (D-#488).
 *
 * Unit-tested from the server suite because the app workspace has no test runner — the
 * route homeworkText.ts / nameList.ts / attachRows.ts already take.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { delegatedClassReach } = require("../../../app/src/lib/delegatedExtent") as {
  delegatedClassReach: (
    grants: readonly ExtentGrantLike[],
    now?: number,
  ) => { wholeSchool: boolean; classIds: Set<string> };
};

interface ExtentGrantLike {
  kind: string;
  active: boolean;
  extent: string | null;
  classId: string | null;
  explicitSet: readonly { classId: string }[] | null;
  expiresAt: string | null;
}

const NOW = Date.parse("2026-09-13T06:00:00.000Z");

/** A delegation grant with everything irrelevant defaulted away. */
function grant(over: Partial<ExtentGrantLike> = {}): ExtentGrantLike {
  return {
    kind: "delegation",
    active: true,
    extent: "whole_school",
    classId: null,
    explicitSet: null,
    expiresAt: null,
    ...over,
  };
}

describe("delegatedClassReach", () => {
  test("the reported case: a live whole-school delegation reaches every class", () => {
    const r = delegatedClassReach([grant()], NOW);
    expect(r.wholeSchool).toBe(true);
  });

  test("no grants at all reaches nothing (the pre-existing behaviour is unchanged)", () => {
    const r = delegatedClassReach([], NOW);
    expect(r.wholeSchool).toBe(false);
    expect(r.classIds.size).toBe(0);
  });

  test("grade_class reaches exactly its own class", () => {
    const r = delegatedClassReach(
      [grant({ extent: "grade_class", classId: "c3" })],
      NOW,
    );
    expect(r.wholeSchool).toBe(false);
    expect([...r.classIds]).toEqual(["c3"]);
  });

  test("explicit_set reaches every class it names, de-duplicated across subjects", () => {
    const r = delegatedClassReach(
      [
        grant({
          extent: "explicit_set",
          explicitSet: [{ classId: "c1" }, { classId: "c2" }, { classId: "c1" }],
        }),
      ],
      NOW,
    );
    expect([...r.classIds].sort()).toEqual(["c1", "c2"]);
  });

  test("subject_dept reaches NOTHING — the subject-less read gate would refuse it", () => {
    const r = delegatedClassReach([grant({ extent: "subject_dept" })], NOW);
    expect(r.wholeSchool).toBe(false);
    expect(r.classIds.size).toBe(0);
  });

  test("an EXPIRED delegation is ignored even though `active` is still true", () => {
    const r = delegatedClassReach(
      [grant({ expiresAt: "2026-09-12T23:59:00.000Z", active: true })],
      NOW,
    );
    expect(r.wholeSchool).toBe(false);
  });

  test("a delegation expiring later today is still live", () => {
    const r = delegatedClassReach([grant({ expiresAt: "2026-09-13T18:00:00.000Z" })], NOW);
    expect(r.wholeSchool).toBe(true);
  });

  test("an unparseable expiry is treated as live, never as a silent revoke", () => {
    const r = delegatedClassReach([grant({ expiresAt: "not-a-date" })], NOW);
    expect(r.wholeSchool).toBe(true);
  });

  test("a deactivated delegation is ignored", () => {
    const r = delegatedClassReach([grant({ active: false })], NOW);
    expect(r.wholeSchool).toBe(false);
  });

  test("the other grant kinds are not extents — teaching/proxy/supervisory reach nothing", () => {
    // supervisory shares the extent vocabulary and the same READ, but carries no write:
    // surfacing it would hand an oversight-only holder controls the write gate refuses.
    for (const kind of ["teaching", "proxy", "supervisory"]) {
      const r = delegatedClassReach([grant({ kind })], NOW);
      expect(r.wholeSchool).toBe(false);
      expect(r.classIds.size).toBe(0);
    }
  });

  test("whole_school wins over class-shaped grants and empties classIds", () => {
    // The caller branches on `wholeSchool` first; leaving ids behind invites a reader
    // that checks only `classIds` and silently narrows a school-wide duty.
    const r = delegatedClassReach(
      [grant({ extent: "grade_class", classId: "c3" }), grant()],
      NOW,
    );
    expect(r.wholeSchool).toBe(true);
    expect(r.classIds.size).toBe(0);
  });

  test("several class-shaped grants union rather than overwrite", () => {
    const r = delegatedClassReach(
      [
        grant({ extent: "grade_class", classId: "c1" }),
        grant({ extent: "explicit_set", explicitSet: [{ classId: "c2" }] }),
      ],
      NOW,
    );
    expect([...r.classIds].sort()).toEqual(["c1", "c2"]);
  });
});
