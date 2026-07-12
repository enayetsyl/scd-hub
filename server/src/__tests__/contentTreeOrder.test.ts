/**
 * contentTree ordering (the 32 MB-sort fix).
 *
 * The tree used to be sorted BY MONGO on `envelopeJson.payload.session_plan.period_index`
 * — a path inside a Mixed blob that no index can serve. Mongo therefore sorted the FULL
 * documents in memory and, once the collection grew (prod: 6591 artifacts / ~29 MB), blew
 * its 32 MB ceiling: "Sort exceeded memory limit of 33554432 bytes". Lesson Plans died for
 * every user, intermittently, because the collection sat right on the line.
 *
 * The sort now happens in JS over PROJECTED rows. These tests pin the ordering so it
 * cannot silently drift back — the ordering is the whole reason the Mongo sort existed.
 */
import { compareForTree } from "../modules/content/resolvers/content";

type Art = Parameters<typeof compareForTree>[0];

/** Minimal artifact with only the fields the comparator reads. */
function art(over: Partial<Record<string, unknown>> = {}): Art {
  return {
    docType: "chapter_plan",
    subject: "BAN",
    classLevel: 1,
    address: { anchorWord: "পাঠ", number: 1 },
    importedAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  } as unknown as Art;
}

/** A session plan carrying a period index inside the envelope. */
function session(periodIndex: number | undefined, over: Partial<Record<string, unknown>> = {}): Art {
  return art({
    docType: "session_plan",
    envelopeJson:
      periodIndex === undefined
        ? {}
        : { payload: { session_plan: { period_index: periodIndex } } },
    ...over,
  });
}

const sorted = (xs: Art[]): Art[] => [...xs].sort(compareForTree);

describe("compareForTree — the ordering Mongo used to give", () => {
  test("docType, then subject, then classLevel", () => {
    const a = art({ docType: "chapter_plan", subject: "BAN", classLevel: 2 });
    const b = art({ docType: "chapter_plan", subject: "BAN", classLevel: 1 });
    const c = art({ docType: "chapter_plan", subject: "ARA", classLevel: 5 });
    const d = art({ docType: "session_plan", subject: "ARA", classLevel: 1 });
    expect(sorted([a, b, c, d])).toEqual([c, b, a, d]);
  });

  test("chapter numbers sort NUMERICALLY, not as strings", () => {
    // The bug this guards: a lexicographic sort puts "10" before "2".
    const two = art({ address: { anchorWord: "পাঠ", number: 2 } });
    const ten = art({ address: { anchorWord: "পাঠ", number: 10 } });
    expect(sorted([ten, two])).toEqual([two, ten]);
  });

  test("`number` is Mixed — a numeric STRING still sorts numerically", () => {
    const two = art({ address: { anchorWord: "পাঠ", number: "2" } });
    const ten = art({ address: { anchorWord: "পাঠ", number: "10" } });
    expect(sorted([ten, two])).toEqual([two, ten]);
  });

  test("a non-numeric chapter number falls back to a string compare (never throws)", () => {
    const a = art({ address: { anchorWord: "পাঠ", number: "3ক" } });
    const b = art({ address: { anchorWord: "পাঠ", number: "3খ" } });
    expect(() => sorted([b, a])).not.toThrow();
    expect(sorted([b, a])).toEqual([a, b]);
  });

  test("within a chapter, sessions order by period_index", () => {
    const p1 = session(1);
    const p2 = session(2);
    const p3 = session(3);
    expect(sorted([p3, p1, p2])).toEqual([p1, p2, p3]);
  });

  test("a plan with NO period_index sorts first, as a missing key did in Mongo", () => {
    const none = session(undefined);
    const p1 = session(1);
    expect(sorted([p1, none])).toEqual([none, p1]);
  });

  test("ties fall back to importedAt, oldest first", () => {
    const older = session(1, { importedAt: new Date("2026-01-01T00:00:00Z") });
    const newer = session(1, { importedAt: new Date("2026-06-01T00:00:00Z") });
    expect(sorted([newer, older])).toEqual([older, newer]);
  });

  test("is stable and total — sorting an already-sorted list is a no-op", () => {
    const xs = [art({ subject: "ARA" }), art({ subject: "BAN" }), session(1, { subject: "BAN" })];
    expect(sorted(sorted(xs))).toEqual(sorted(xs));
  });
});
