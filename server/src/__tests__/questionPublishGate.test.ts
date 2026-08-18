/**
 * QR-3 tests — the publish gate (Q3.1/Q3.3/§5a; D-#508).
 *
 * The gate is one module (modules/questions/publishGate.ts) used by every read path, so it
 * is tested once, directly, rather than re-derived per resolver.
 *
 * Two properties matter most and are asserted explicitly:
 *   • it is a MONGO FILTER, never a post-filter — questions() is cursor-paginated, so
 *     dropping rows afterwards would silently short every page;
 *   • it constrains QUESTION rows only — plans keep D-#38's lifecycle and stimuli are
 *     deliberately never gated (§5a), because a published question's stimulus_ref must
 *     always resolve.
 */
import { PERMISSIONS, ROLE_PERMISSIONS } from "@scd/shared";
import type { AuthPayload } from "../context";
import {
  seesPublishedOnly,
  applyQuestionOnlyGate,
  applyMixedDocTypeGate,
  PUBLISHED_REVIEW_STATUS,
} from "../modules/questions/publishGate";

function auth(role: string): AuthPayload {
  return { userId: "u1", role, permissions: [] } as unknown as AuthPayload;
}

describe("seesPublishedOnly", () => {
  test("Principal and Office are UNRESTRICTED — they run the loop", () => {
    expect(seesPublishedOnly(auth("PRINCIPAL"))).toBe(false);
    expect(seesPublishedOnly(auth("OFFICE"))).toBe(false);
  });

  test("a teacher sees the vetted shelf only", () => {
    expect(seesPublishedOnly(auth("TEACHER"))).toBe(true);
  });

  test("an unknown/absent caller is gated (fail-closed)", () => {
    expect(seesPublishedOnly(auth("GUARDIAN"))).toBe(true);
    expect(seesPublishedOnly(null)).toBe(true);
    expect(seesPublishedOnly(undefined)).toBe(true);
  });
});

describe("applyQuestionOnlyGate (Q3.1 — questions / questionTopicTags)", () => {
  test("pins reviewStatus to gold for a teacher", () => {
    const filter: Record<string, unknown> = { docType: "question", current: true };
    applyQuestionOnlyGate(filter, auth("TEACHER"));
    expect(filter.reviewStatus).toBe(PUBLISHED_REVIEW_STATUS);
  });

  test("leaves an admin's filter untouched", () => {
    const filter: Record<string, unknown> = { docType: "question", current: true };
    applyQuestionOnlyGate(filter, auth("PRINCIPAL"));
    expect(filter.reviewStatus).toBeUndefined();
  });

  test("a teacher's explicit reviewStatus argument CANNOT widen the gate back open", () => {
    // The resolver sets the arg first, then calls the gate — this is that order.
    const filter: Record<string, unknown> = { docType: "question", current: true };
    filter.reviewStatus = "draft"; // as if ?reviewStatus=draft were passed
    applyQuestionOnlyGate(filter, auth("TEACHER"));
    expect(filter.reviewStatus).toBe(PUBLISHED_REVIEW_STATUS);
  });

  test("an ADMIN may still filter by draft (that is the assign workflow)", () => {
    const filter: Record<string, unknown> = { docType: "question", current: true };
    filter.reviewStatus = "draft";
    applyQuestionOnlyGate(filter, auth("PRINCIPAL"));
    expect(filter.reviewStatus).toBe("draft");
  });
});

describe("applyMixedDocTypeGate (Q3.3 — contentArtifacts / contentTree)", () => {
  test("constrains QUESTION rows only, leaving plans and stimuli visible", () => {
    const filter: Record<string, unknown> = { current: true };
    applyMixedDocTypeGate(filter, auth("TEACHER"));

    expect(filter.$and).toEqual([
      { $or: [{ docType: { $ne: "question" } }, { reviewStatus: PUBLISHED_REVIEW_STATUS }] },
    ]);
    // Never a blanket reviewStatus — that would hide draft PLANS too (D-#38 keeps them usable).
    expect(filter.reviewStatus).toBeUndefined();
  });

  test("is ANDed, so it cannot be clobbered by an existing $and", () => {
    const filter: Record<string, unknown> = { $and: [{ subject: "ENG" }] };
    applyMixedDocTypeGate(filter, auth("TEACHER"));
    expect((filter.$and as unknown[]).length).toBe(2);
    expect((filter.$and as unknown[])[0]).toEqual({ subject: "ENG" });
  });

  test("leaves an admin's filter untouched", () => {
    const filter: Record<string, unknown> = { current: true };
    applyMixedDocTypeGate(filter, auth("OFFICE"));
    expect(filter.$and).toBeUndefined();
  });
});

describe("Q5.1 — D-#508 adds NO permission", () => {
  test("the review/publish loop reuses the three permissions the plan loop already had", () => {
    // If a future change adds a question:review or question:publish permission, this fails —
    // which is the point. D-#508's whole "no vocab change, no contract sync" claim rests on
    // the loop reusing content:assign_review / content:review / content:promote_gold.
    const declared = PERMISSIONS as readonly string[];
    expect(declared).toContain("content:assign_review");
    expect(declared).toContain("content:review");
    expect(declared).toContain("content:promote_gold");
    expect(declared.filter((p) => /^question:/.test(p)).sort()).toEqual([
      "question:read",
      "question:select",
    ]);
    expect(declared).not.toContain("question:publish");
    expect(declared).not.toContain("question:assign_review");
  });

  test("publishing stays Principal-locked; Office may assign but not publish", () => {
    const principal = ROLE_PERMISSIONS.PRINCIPAL as readonly string[];
    const office = ROLE_PERMISSIONS.OFFICE as readonly string[];
    const teacher = ROLE_PERMISSIONS.TEACHER as readonly string[];

    expect(principal).toContain("content:promote_gold");
    expect(office).not.toContain("content:promote_gold");
    expect(teacher).not.toContain("content:promote_gold");

    expect(office).toContain("content:assign_review");
    expect(teacher).not.toContain("content:assign_review");
    // The reviewer's own permission.
    expect(teacher).toContain("content:review");
  });
});

describe("§5a — stimuli are never gated", () => {
  test("the mixed gate lets a DRAFT stimulus through for a teacher", () => {
    const filter: Record<string, unknown> = {};
    applyMixedDocTypeGate(filter, auth("TEACHER"));
    const clause = (filter.$and as { $or: Record<string, unknown>[] }[])[0];

    // Simulate the predicate against a draft stimulus row.
    const draftStimulus = { docType: "stimulus", reviewStatus: "draft" };
    const passes = clause.$or.some((c) => {
      if ("docType" in c) return draftStimulus.docType !== "question";
      return draftStimulus.reviewStatus === c.reviewStatus;
    });
    expect(passes).toBe(true);
  });

  test("...but a DRAFT question does not", () => {
    const filter: Record<string, unknown> = {};
    applyMixedDocTypeGate(filter, auth("TEACHER"));
    const clause = (filter.$and as { $or: Record<string, unknown>[] }[])[0];

    const draftQuestion = { docType: "question", reviewStatus: "draft" };
    const passes = clause.$or.some((c) => {
      if ("docType" in c) return draftQuestion.docType !== "question";
      return draftQuestion.reviewStatus === c.reviewStatus;
    });
    expect(passes).toBe(false);
  });
});
