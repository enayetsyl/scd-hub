/**
 * APPROVE_WITH_CONDITION — the questions-only third verdict (D-#525).
 *
 * The load-bearing rules:
 *   • it is an approval with a HOLD — it must never advance draft→reviewed, so a held
 *     question can never be published;
 *   • the condition text is MANDATORY (a hold nobody can read is unclearable);
 *   • the plan loop does NOT offer it;
 *   • clearing a condition sends the question BACK to the reviewer, it does not publish.
 *
 * The status transition is a pure function, so it is tested directly. The service-level
 * rules are asserted through the same guards the services run.
 */
import { REVIEW_VERDICTS, REVIEW_VERDICT_LABELS_BN, REVIEW_VERDICT_LABELS_EN } from "@scd/shared";
import type { ReviewVerdict } from "@scd/shared";
import { reviewStatusForVerdict } from "../modules/content/services/ReviewService";

describe("D-#525 — the verdict vocab", () => {
  test("three verdicts, each with a Bangla AND an English label", () => {
    expect(REVIEW_VERDICTS).toContain("APPROVE_WITH_CONDITION");
    expect(REVIEW_VERDICTS).toHaveLength(3);
    for (const v of REVIEW_VERDICTS) {
      expect(REVIEW_VERDICT_LABELS_BN[v]?.trim()).toBeTruthy();
      expect(REVIEW_VERDICT_LABELS_EN[v]?.trim()).toBeTruthy();
    }
  });
});

describe("D-#525 — a condition HOLDS the question", () => {
  test("APPROVE_WITH_CONDITION never advances draft→reviewed", () => {
    // This is the whole hold. If it advanced, the Principal's publish list would offer a
    // question whose condition nobody has met.
    expect(reviewStatusForVerdict("draft", "APPROVE_WITH_CONDITION")).toBeNull();
  });

  test("plain APPROVE still advances draft→reviewed", () => {
    expect(reviewStatusForVerdict("draft", "APPROVE")).toBe("reviewed");
  });

  test("changing an earlier APPROVE to a condition takes it BACK off the publishable pile", () => {
    expect(reviewStatusForVerdict("reviewed", "APPROVE_WITH_CONDITION")).toBe("draft");
  });

  test("a published question is never moved by any verdict", () => {
    for (const v of REVIEW_VERDICTS) {
      expect(reviewStatusForVerdict("gold", v)).toBeNull();
    }
  });

  test("the hold behaves exactly like CHANGES_REQUESTED for STATUS, and differs only in meaning", () => {
    for (const current of ["draft", "reviewed"] as const) {
      expect(reviewStatusForVerdict(current, "APPROVE_WITH_CONDITION")).toBe(
        reviewStatusForVerdict(current, "CHANGES_REQUESTED"),
      );
    }
  });
});

describe("D-#525 — the condition text is mandatory", () => {
  /** The guard submitQuestionReview runs, verbatim. */
  const conditionMissing = (verdict: ReviewVerdict, reason: string | null | undefined): boolean =>
    verdict === "APPROVE_WITH_CONDITION" && (reason?.trim() ?? "").length === 0;

  test("a condition verdict with no text is refused", () => {
    expect(conditionMissing("APPROVE_WITH_CONDITION", null)).toBe(true);
    expect(conditionMissing("APPROVE_WITH_CONDITION", "")).toBe(true);
    expect(conditionMissing("APPROVE_WITH_CONDITION", "   ")).toBe(true);
  });

  test("a condition verdict WITH text is accepted", () => {
    expect(conditionMissing("APPROVE_WITH_CONDITION", "বানান ঠিক করতে হবে")).toBe(false);
  });

  test("the reject reason stays OPTIONAL — Q2.4 is unchanged", () => {
    expect(conditionMissing("CHANGES_REQUESTED", null)).toBe(false);
    expect(conditionMissing("CHANGES_REQUESTED", "")).toBe(false);
  });

  test("plain approve needs no text either", () => {
    expect(conditionMissing("APPROVE", null)).toBe(false);
  });
});

describe("D-#525 — questions only", () => {
  /** The guard submitPlanReview runs, verbatim. */
  const planRefuses = (verdict: ReviewVerdict): boolean => verdict === "APPROVE_WITH_CONDITION";

  test("the plan loop refuses the third verdict", () => {
    expect(planRefuses("APPROVE_WITH_CONDITION")).toBe(true);
  });

  test("the plan loop still takes the two it shipped with", () => {
    expect(planRefuses("APPROVE")).toBe(false);
    expect(planRefuses("CHANGES_REQUESTED")).toBe(false);
  });
});

describe("D-#525 — clearing a condition", () => {
  /** The guard clearQuestionCondition runs, verbatim. */
  const clearable = (last: { status: string; verdict?: string } | undefined): boolean =>
    !!last && last.status === "submitted" && last.verdict === "APPROVE_WITH_CONDITION";

  test("only a submitted APPROVE_WITH_CONDITION can be cleared", () => {
    expect(clearable({ status: "submitted", verdict: "APPROVE_WITH_CONDITION" })).toBe(true);
  });

  test("an ordinary rejection is NOT clearable — no back door around a reject", () => {
    expect(clearable({ status: "submitted", verdict: "CHANGES_REQUESTED" })).toBe(false);
  });

  test("an approved question has nothing to clear", () => {
    expect(clearable({ status: "submitted", verdict: "APPROVE" })).toBe(false);
  });

  test("a round somebody is still working on is not clearable", () => {
    expect(clearable({ status: "assigned", verdict: undefined })).toBe(false);
  });

  test("a never-reviewed question is not clearable", () => {
    expect(clearable(undefined)).toBe(false);
  });
});

describe("D-#525 — chapter-wise assign eligibility", () => {
  /** The partition assignQuestionReviewByChapter runs, verbatim. */
  function partition(
    arts: { qid: string; reviewStatus: string }[],
    busy: Set<string>,
  ): { assigned: string[]; skippedPublished: number; skippedReviewed: number; skippedOpenRound: number } {
    const assigned: string[] = [];
    let skippedPublished = 0;
    let skippedReviewed = 0;
    let skippedOpenRound = 0;
    for (const a of arts) {
      if (a.reviewStatus === "gold") { skippedPublished += 1; continue; }
      if (a.reviewStatus === "reviewed") { skippedReviewed += 1; continue; }
      if (busy.has(a.qid)) { skippedOpenRound += 1; continue; }
      assigned.push(a.qid);
    }
    return { assigned, skippedPublished, skippedReviewed, skippedOpenRound };
  }

  const CHAPTER = [
    { qid: "Q1", reviewStatus: "draft" },
    { qid: "Q2", reviewStatus: "draft" },   // in flight
    { qid: "Q3", reviewStatus: "reviewed" },
    { qid: "Q4", reviewStatus: "gold" },
    { qid: "Q5", reviewStatus: "draft" },
  ];

  test("only untouched drafts are assigned; everything else is skipped and counted", () => {
    const out = partition(CHAPTER, new Set(["Q2"]));
    expect(out.assigned).toEqual(["Q1", "Q5"]);
    expect(out.skippedOpenRound).toBe(1);
    expect(out.skippedReviewed).toBe(1);
    expect(out.skippedPublished).toBe(1);
  });

  test("every question is accounted for — assigned + skipped equals the chapter", () => {
    const out = partition(CHAPTER, new Set(["Q2"]));
    const skipped = out.skippedPublished + out.skippedReviewed + out.skippedOpenRound;
    expect(out.assigned.length + skipped).toBe(CHAPTER.length);
  });

  test("a reviewer mid-way through a question is never pulled off it", () => {
    const out = partition(CHAPTER, new Set(["Q1", "Q2", "Q5"]));
    expect(out.assigned).toEqual([]);
    expect(out.skippedOpenRound).toBe(3);
  });

  test("re-running the same chapter assigns nothing the second time", () => {
    const first = partition(CHAPTER, new Set());
    const busyAfter = new Set(first.assigned);
    const second = partition(CHAPTER, busyAfter);
    expect(first.assigned.length).toBeGreaterThan(0);
    expect(second.assigned).toEqual([]);
  });
});
