/**
 * Question CATEGORY axis (D-#511) — the exercise family a bank item belongs to
 * (শব্দার্থ / বিপরীত শব্দ / এক কথায় প্রকাশ …), carried in the question payload's
 * optional free-text `lesson_ref` and exposed as its own filter.
 *
 * DB-free: the ordering helper is pure (server/src/modules/questions/search.ts,
 * dependency-free by design), and the filter/shape rules are asserted against the
 * same expressions the resolver uses.
 */
import { QUESTION_CATEGORIES, QUESTION_CATEGORY_LABELS_BN, QUESTION_CATEGORY_LABELS_EN } from "@scd/shared";
import { orderQuestionCategories } from "../modules/questions/search";

describe("D-#511 — category vocab", () => {
  test("every code has a Bangla AND an English label", () => {
    for (const code of QUESTION_CATEGORIES) {
      expect(QUESTION_CATEGORY_LABELS_BN[code]?.trim()).toBeTruthy();
      expect(QUESTION_CATEGORY_LABELS_EN[code]?.trim()).toBeTruthy();
    }
    expect(Object.keys(QUESTION_CATEGORY_LABELS_BN)).toHaveLength(QUESTION_CATEGORIES.length);
    expect(Object.keys(QUESTION_CATEGORY_LABELS_EN)).toHaveLength(QUESTION_CATEGORIES.length);
  });

  test("codes are unique and namespaced, so a lesson handle can never collide with one", () => {
    expect(new Set(QUESTION_CATEGORIES).size).toBe(QUESTION_CATEGORIES.length);
    for (const code of QUESTION_CATEGORIES) expect(code.startsWith("QCAT-")).toBe(true);
  });

  test("বিপরীত and সমার্থক are SEPARATE codes — the whole point of the axis", () => {
    // They share one REF-19 slug (BAN-WORDREL) and are identical on every other
    // axis (short_answer · short · 1 mark), so if these two ever merged the filter
    // would stop answering the question it was built for.
    expect(QUESTION_CATEGORIES).toContain("QCAT-BIPORIT");
    expect(QUESTION_CATEGORIES).toContain("QCAT-SOMARTHOK");
    expect(QUESTION_CATEGORY_LABELS_BN["QCAT-BIPORIT"]).not.toBe(
      QUESTION_CATEGORY_LABELS_BN["QCAT-SOMARTHOK"],
    );
  });
});

describe("D-#511 — orderQuestionCategories", () => {
  test("returns vocab order, not the order Mongo's distinct handed back", () => {
    const scrambled = ["QCAT-MULBHAV", "QCAT-SOBDARTH", "QCAT-MCQ", "QCAT-SHORT"];
    expect(orderQuestionCategories(scrambled, QUESTION_CATEGORIES)).toEqual([
      "QCAT-SHORT",
      "QCAT-MCQ",
      "QCAT-SOBDARTH",
      "QCAT-MULBHAV",
    ]);
  });

  test("returns only the codes the slice actually has", () => {
    const out = orderQuestionCategories(["QCAT-BIPORIT", "QCAT-SOMARTHOK"], QUESTION_CATEGORIES);
    expect(out).toEqual(["QCAT-BIPORIT", "QCAT-SOMARTHOK"]);
    expect(out).not.toContain("QCAT-MCQ");
  });

  test("an empty slice yields [] — this is how the client knows to hide the group", () => {
    expect(orderQuestionCategories([], QUESTION_CATEGORIES)).toEqual([]);
  });

  test("a code this build has no label for is APPENDED, never dropped", () => {
    // A newer import introduced a category; a server that is behind must still offer
    // it rather than silently hiding those questions from the filter.
    const out = orderQuestionCategories(
      ["QCAT-FUTURE-B", "QCAT-MCQ", "QCAT-FUTURE-A"],
      QUESTION_CATEGORIES,
    );
    expect(out[0]).toBe("QCAT-MCQ");
    expect(out.slice(1)).toEqual(["QCAT-FUTURE-A", "QCAT-FUTURE-B"]);
  });

  test("blank, whitespace and non-string values are discarded", () => {
    const out = orderQuestionCategories(
      ["QCAT-MCQ", "", "   ", null, undefined, 7, { code: "x" }],
      QUESTION_CATEGORIES,
    );
    expect(out).toEqual(["QCAT-MCQ"]);
  });

  test("duplicates collapse", () => {
    expect(orderQuestionCategories(["QCAT-MCQ", "QCAT-MCQ"], QUESTION_CATEGORIES)).toEqual([
      "QCAT-MCQ",
    ]);
  });

  test("surrounding whitespace is trimmed before matching the vocab", () => {
    expect(orderQuestionCategories([" QCAT-MCQ "], QUESTION_CATEGORIES)).toEqual(["QCAT-MCQ"]);
  });
});

describe("D-#511 — filter + shape", () => {
  const QUESTION_DOC = {
    docType: "question",
    subject: "BAN",
    classLevel: 5,
    current: true,
    envelopeJson: {
      tags: { topic_tag: "TOP-BAN-C5-02", bloom_level: "Remember", difficulty: "easy", paper_role: "short" },
      payload: {
        qid: "QP-BAN-C5-U02-Q05007",
        question_type: "short_answer",
        paper_role: "short",
        lesson_ref: "QCAT-BIPORIT",
        marks: 1,
      },
    },
  };

  test("the category filter reads payload.lesson_ref, NOT a tag", () => {
    // lesson_ref is payload-only: build_question_envelopes.py lifts just the four
    // indexed copies (topic_tag/bloom_level/difficulty/paper_role) into envelope tags,
    // so filtering on tags.lesson_ref would match nothing.
    const filter: Record<string, unknown> = { docType: "question", current: true };
    filter["envelopeJson.payload.lesson_ref"] = "QCAT-BIPORIT";

    const payload = QUESTION_DOC.envelopeJson.payload as Record<string, unknown>;
    expect(payload.lesson_ref).toBe(filter["envelopeJson.payload.lesson_ref"]);
    expect((QUESTION_DOC.envelopeJson.tags as Record<string, unknown>).lesson_ref).toBeUndefined();
  });

  test("category narrows within a type+role that cannot distinguish it", () => {
    // শব্দার্থ, বিপরীত and এক কথায় are all short_answer + short + 1 mark.
    const sameOnEveryOtherAxis = [
      { lesson_ref: "QCAT-SOBDARTH", question_type: "short_answer", paper_role: "short", marks: 1 },
      { lesson_ref: "QCAT-BIPORIT", question_type: "short_answer", paper_role: "short", marks: 1 },
      { lesson_ref: "QCAT-EKKOTHAY", question_type: "short_answer", paper_role: "short", marks: 1 },
    ];
    const byTypeAndRole = sameOnEveryOtherAxis.filter(
      (p) => p.question_type === "short_answer" && p.paper_role === "short" && p.marks === 1,
    );
    expect(byTypeAndRole).toHaveLength(3); // indistinguishable before the axis existed

    const byCategory = sameOnEveryOtherAxis.filter((p) => p.lesson_ref === "QCAT-BIPORIT");
    expect(byCategory).toHaveLength(1);
    expect(byCategory[0].lesson_ref).toBe("QCAT-BIPORIT");
  });

  test("a question imported before the axis existed carries no category and simply never matches", () => {
    const legacy = { qid: "QP-BAN-C5-U01-Q01", question_type: "mcq" } as Record<string, unknown>;
    expect((legacy.lesson_ref as string | undefined) ?? null).toBeNull();
    expect(legacy.lesson_ref === "QCAT-MCQ").toBe(false);
  });
});
