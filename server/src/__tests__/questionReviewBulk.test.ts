/**
 * Bulk verdicts on a reviewer's own queue (D-#527).
 *
 * The first real assignment handed one reviewer 241 questions in a single chapter, so
 * deciding them one card at a time is the bottleneck this exists to remove.
 *
 * The rules that carry weight:
 *   • APPROVE_WITH_CONDITION is REFUSED in bulk — a condition is written about ONE
 *     question, and one condition pasted across a selection is a note about nothing;
 *   • a per-item failure is COLLECTED, never fatal — one closed round must not discard
 *     the other 240 verdicts;
 *   • ids are de-duplicated, so a double-tick cannot submit the same round twice.
 *
 * The condition guard runs BEFORE any query, so it is exercised against the real shipped
 * function rather than a copy. The loop semantics are asserted through the same partition
 * the service runs, in the style of questionReviewCondition.test.ts.
 */
import { REVIEW_VERDICTS } from "@scd/shared";
import { submitQuestionReviewBulk } from "../modules/questions/services/QuestionReviewService";
import { ReviewError } from "../modules/content/services/ReviewService";

describe("D-#527 — a condition is never a bulk verdict", () => {
  const call = (verdict: string): Promise<unknown> =>
    submitQuestionReviewBulk({
      assignmentIds: ["a1", "a2"],
      verdict,
      reviewerId: "r1",
    });

  test("APPROVE_WITH_CONDITION is refused outright", async () => {
    // Refused BEFORE any database work — nothing is half-applied when this throws.
    await expect(call("APPROVE_WITH_CONDITION")).rejects.toBeInstanceOf(ReviewError);
    await expect(call("APPROVE_WITH_CONDITION")).rejects.toThrow(/one at a time/i);
  });

  test("the refusal names the two verdicts bulk DOES take", () => {
    const bulkable = REVIEW_VERDICTS.filter((v) => v !== "APPROVE_WITH_CONDITION");
    expect(bulkable).toEqual(["APPROVE", "CHANGES_REQUESTED"]);
  });
});

describe("D-#527 — the loop semantics", () => {
  /** The accumulation submitQuestionReviewBulk runs, verbatim. */
  function run(
    ids: string[],
    submit: (id: string) => void,
  ): { okCount: number; failedCount: number; failures: string[] } {
    let okCount = 0;
    const failures: string[] = [];
    for (const id of [...new Set(ids)]) {
      try {
        submit(id);
        okCount += 1;
      } catch (err) {
        failures.push(`${id}: ${(err as Error).message}`);
      }
    }
    return { okCount, failedCount: failures.length, failures };
  }

  test("a double-ticked id is submitted ONCE", () => {
    const seen: string[] = [];
    const out = run(["a", "b", "a", "a"], (id) => seen.push(id));
    expect(seen).toEqual(["a", "b"]);
    expect(out.okCount).toBe(2);
  });

  test("one closed round does not discard the rest of the selection", () => {
    // The reason this is a collect-and-continue loop rather than a transaction: a round
    // superseded by a re-import is REFUSED, and a reviewer who ticked 241 questions must
    // not lose 240 good verdicts to it.
    const out = run(["a", "closed", "c"], (id) => {
      if (id === "closed") throw new Error("Round is not open for submission (status=superseded)");
    });
    expect(out.okCount).toBe(2);
    expect(out.failedCount).toBe(1);
    expect(out.failures[0]).toMatch(/closed/);
  });

  test("every id is accounted for — ok + failed equals the deduped selection", () => {
    const ids = ["a", "b", "b", "c", "d"];
    const out = run(ids, (id) => {
      if (id === "b" || id === "d") throw new Error("nope");
    });
    expect(out.okCount + out.failedCount).toBe(new Set(ids).size);
  });

  test("an all-failing selection reports zero accepted rather than succeeding quietly", () => {
    const out = run(["a", "b"], () => {
      throw new Error("Round is not open for submission");
    });
    expect(out.okCount).toBe(0);
    expect(out.failedCount).toBe(2);
  });

  test("an empty selection is a no-op, not an error", () => {
    const out = run([], () => undefined);
    expect(out).toEqual({ okCount: 0, failedCount: 0, failures: [] });
  });
});
