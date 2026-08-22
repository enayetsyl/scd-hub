/**
 * Multi-select filter axes + the chapter axis (D-#524).
 *
 * DB-free: every helper under test lives in the dependency-free
 * server/src/modules/questions/search.ts, so nothing loads the Pothos schema.
 */
import {
  applyMultiFilter,
  orderQuestionChapters,
  chapterMatchValues,
} from "../modules/questions/search";

describe("D-#524 — applyMultiFilter", () => {
  const PATH = "envelopeJson.payload.question_type";

  test("a non-empty list becomes $in", () => {
    const f: Record<string, unknown> = {};
    applyMultiFilter(f, PATH, ["mcq", "short_answer"], null);
    expect(f[PATH]).toEqual({ $in: ["mcq", "short_answer"] });
  });

  test("an EMPTY list is no constraint — clearing the last chip must widen, not blank", () => {
    // The client sends [] the moment the teacher deselects everything. A literal
    // `$in: []` matches nothing, which would empty the bank and read as a bug.
    const f: Record<string, unknown> = {};
    applyMultiFilter(f, PATH, [], null);
    expect(f).toEqual({});
  });

  test("with no list at all the single value still applies — an un-updated app keeps working", () => {
    const f: Record<string, unknown> = {};
    applyMultiFilter(f, PATH, null, "mcq");
    expect(f[PATH]).toBe("mcq");

    const g: Record<string, unknown> = {};
    applyMultiFilter(g, PATH, undefined, "mcq");
    expect(g[PATH]).toBe("mcq");
  });

  test("a non-empty list WINS over the single value", () => {
    const f: Record<string, unknown> = {};
    applyMultiFilter(f, PATH, ["matching"], "mcq");
    expect(f[PATH]).toEqual({ $in: ["matching"] });
  });

  test("an empty list falls back to the single value rather than blanking", () => {
    const f: Record<string, unknown> = {};
    applyMultiFilter(f, PATH, [], "mcq");
    expect(f[PATH]).toBe("mcq");
  });

  test("blank and non-string entries are dropped from the list", () => {
    const f: Record<string, unknown> = {};
    applyMultiFilter(f, PATH, ["mcq", "", "   ", null, undefined], null);
    expect(f[PATH]).toEqual({ $in: ["mcq"] });
  });

  test("a list of ONLY blanks is treated as empty, not as $in:[]", () => {
    const f: Record<string, unknown> = {};
    applyMultiFilter(f, PATH, ["", "  "], null);
    expect(f).toEqual({});
  });

  test("neither form given leaves the axis unconstrained", () => {
    const f: Record<string, unknown> = {};
    applyMultiFilter(f, PATH, null, null);
    expect(f).toEqual({});
  });
});

describe("D-#524 — orderQuestionChapters", () => {
  test("sorts NUMERICALLY — 10 must not come before 9", () => {
    // address.number is Mixed, so a naive string sort would give 1, 10, 2, 9.
    expect(orderQuestionChapters([9, 10, 1, 2])).toEqual([1, 2, 9, 10]);
    expect(orderQuestionChapters(["9", "10", "1", "2"])).toEqual([1, 2, 9, 10]);
  });

  test("string and number forms of one chapter collapse to a single chip", () => {
    expect(orderQuestionChapters([4, "4", " 4 "])).toEqual([4]);
  });

  test("non-chapters are dropped rather than rendered", () => {
    expect(orderQuestionChapters([null, undefined, "", "  ", "abc", 0, -3, 2.5, {}, []])).toEqual([]);
  });

  test("booleans are dropped — Number(true) would otherwise become chapter 1", () => {
    expect(orderQuestionChapters([true, false])).toEqual([]);
  });

  test("an empty slice yields [] — this is how the client knows to hide the group", () => {
    expect(orderQuestionChapters([])).toEqual([]);
  });
});

describe("D-#524 — chapterMatchValues", () => {
  test("matches BOTH stored forms, so a string-numbered import is not silently dropped", () => {
    expect(chapterMatchValues([4])).toEqual([4, "4"]);
    expect(chapterMatchValues([1, 12])).toEqual([1, "1", 12, "12"]);
  });

  test("non-integers never reach the query", () => {
    expect(chapterMatchValues([2.5, NaN])).toEqual([]);
  });

  test("an empty selection produces no values, so the caller can skip the clause", () => {
    expect(chapterMatchValues([])).toEqual([]);
  });
});

describe("D-#524 — the axes compose", () => {
  test("chapter + type + topic narrow together, each on its own path", () => {
    const filter: Record<string, unknown> = { docType: "question", current: true };
    applyMultiFilter(filter, "envelopeJson.tags.topic_tag", ["TOP-BAN-C5-04"], null);
    applyMultiFilter(filter, "envelopeJson.payload.question_type", ["mcq", "short_answer"], null);
    filter["address.number"] = { $in: chapterMatchValues([4, 5]) };

    expect(filter).toEqual({
      docType: "question",
      current: true,
      "envelopeJson.tags.topic_tag": { $in: ["TOP-BAN-C5-04"] },
      "envelopeJson.payload.question_type": { $in: ["mcq", "short_answer"] },
      "address.number": { $in: [4, "4", 5, "5"] },
    });
  });

  test("a chapter pick alone returns every TYPE in that chapter", () => {
    // The owner's ask: clicking a chapter shows all question types of that chapter.
    // Nothing constrains question_type, so no type is excluded.
    const filter: Record<string, unknown> = { docType: "question", current: true };
    applyMultiFilter(filter, "envelopeJson.payload.question_type", [], null);
    filter["address.number"] = { $in: chapterMatchValues([7]) };

    expect(filter["envelopeJson.payload.question_type"]).toBeUndefined();
    expect(filter["address.number"]).toEqual({ $in: [7, "7"] });
  });
});
