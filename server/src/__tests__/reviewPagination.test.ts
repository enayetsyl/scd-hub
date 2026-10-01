/**
 * Server-side paging for the two plan lists (owner 2026-10-01: "pagination not applied").
 *
 *   pagePlans        — the plan-review board: filter (subject/class/type/state/reviewer) then
 *                      slice; total counts every match; a page past the end clamps.
 *   pageContentTree  — Lesson Plans: pages by CHAPTER, so a chapter's chapter plan and its
 *                      sessions are never split across pages; subject×class grouping kept.
 */
import { pagePlans, planBoardStateOf, type AssignablePlanDTO } from "../modules/content/services/ReviewService";
import { pageContentTree } from "../modules/content/resolvers/content";

function plan(i: number, over: Partial<AssignablePlanDTO> = {}): AssignablePlanDTO {
  return {
    artifactId: `a${i}`,
    docType: "chapter_plan",
    subject: "BAN",
    classLevel: 1,
    anchorWord: "পাঠ",
    addressNumber: String(i),
    title: null,
    reviewStatus: "draft",
    currentReviewerId: null,
    currentReviewerName: null,
    currentAssignmentId: null,
    roundStatus: null,
    sessionIndex: null,
    roundNumber: null,
    verdict: null,
    assignedAt: null,
    submittedAt: null,
    ...over,
  };
}

describe("pagePlans (plan-review board)", () => {
  const all = Array.from({ length: 120 }, (_, i) => plan(i + 1));

  test("slices one page and reports the full total", () => {
    const p2 = pagePlans(all, {}, 2, 50);
    expect(p2.total).toBe(120);
    expect(p2.page).toBe(2);
    expect(p2.rows.map((r) => r.artifactId)).toEqual(all.slice(50, 100).map((r) => r.artifactId));
    expect(pagePlans(all, {}, 3, 50).rows).toHaveLength(20);
  });

  test("a page past the end clamps to the last page; nonsense page sizes are bounded", () => {
    expect(pagePlans(all, {}, 99, 50).page).toBe(3);
    expect(pagePlans(all, {}, 0, 50).page).toBe(1);
    expect(pagePlans(all, {}, 1, 10_000).pageSize).toBe(200);
    expect(pagePlans([], {}, 5, 50)).toMatchObject({ rows: [], total: 0, page: 1 });
  });

  test("filters run before paging, so total and pages describe the filtered set", () => {
    const mixed = [
      plan(1, { subject: "MATH" }),
      plan(2, { currentAssignmentId: "r2", currentReviewerId: "u1", roundStatus: "assigned" }),
      plan(3, { currentAssignmentId: "r3", currentReviewerId: "u2", roundStatus: "submitted" }),
      plan(4, { reviewStatus: "gold" }),
      plan(5, { docType: "session_plan", sessionIndex: 1, classLevel: 2 }),
    ];
    expect(pagePlans(mixed, { subject: "MATH" }, 1, 50).total).toBe(1);
    expect(pagePlans(mixed, { state: "awaiting" }, 1, 50).rows.map((r) => r.artifactId)).toEqual(["a2"]);
    expect(pagePlans(mixed, { state: "reviewed" }, 1, 50).rows.map((r) => r.artifactId)).toEqual(["a3"]);
    expect(pagePlans(mixed, { state: "signed" }, 1, 50).rows.map((r) => r.artifactId)).toEqual(["a4"]);
    // a1 + a5; the signed-off a4 has no round either, but "signed" wins over "unassigned".
    expect(pagePlans(mixed, { state: "unassigned" }, 1, 50).rows.map((r) => r.artifactId)).toEqual(["a1", "a5"]);
    expect(pagePlans(mixed, { reviewerId: "u2" }, 1, 50).rows.map((r) => r.artifactId)).toEqual(["a3"]);
    expect(pagePlans(mixed, { docType: "session_plan", classLevel: 2 }, 1, 50).total).toBe(1);
  });

  test("board state: signed wins over an open round; unassigned/awaiting/reviewed by the round", () => {
    expect(planBoardStateOf({ reviewStatus: "gold", currentAssignmentId: "r", roundStatus: "assigned" })).toBe("signed");
    expect(planBoardStateOf({ reviewStatus: "draft", currentAssignmentId: null, roundStatus: null })).toBe("unassigned");
    expect(planBoardStateOf({ reviewStatus: "draft", currentAssignmentId: "r", roundStatus: "assigned" })).toBe("awaiting");
    expect(planBoardStateOf({ reviewStatus: "reviewed", currentAssignmentId: "r", roundStatus: "submitted" })).toBe("reviewed");
  });
});

describe("pageContentTree (Lesson Plans)", () => {
  type Node = Parameters<typeof pageContentTree>[0][number];
  const chapter = (n: number, plans: number) => ({
    anchorWord: "পাঠ",
    number: String(n),
    title: null,
    artifacts: Array.from({ length: plans }, (_, i) => ({ id: `c${n}-${i}` })),
  });
  const tree = (): Node[] =>
    [
      { subject: "BAN", classLevel: 1, chapters: [chapter(1, 3), chapter(2, 1), chapter(3, 6)] },
      { subject: "BAN", classLevel: 2, chapters: [chapter(1, 2), chapter(2, 2)] },
      { subject: "MATH", classLevel: 1, chapters: [chapter(1, 1)] },
    ] as unknown as Node[];

  test("pages by chapter and never splits a chapter's plans", () => {
    const p1 = pageContentTree(tree(), 1, 2);
    expect(p1.totalChapters).toBe(6);
    expect(p1.totalPlans).toBe(15);
    expect(p1.nodes).toHaveLength(1);
    expect(p1.nodes[0].chapters.map((c) => c.number)).toEqual(["1", "2"]);
    expect(p1.nodes[0].chapters[0].artifacts).toHaveLength(3);
  });

  test("a page spanning two subject×class groups keeps both headers, in order", () => {
    const p2 = pageContentTree(tree(), 2, 2);
    expect(p2.nodes.map((n) => `${n.subject}${n.classLevel}:${n.chapters.map((c) => c.number).join(",")}`)).toEqual([
      "BAN1:3",
      "BAN2:1",
    ]);
    expect(p2.nodes[0].chapters[0].artifacts).toHaveLength(6); // session-heavy chapter stays whole
  });

  test("the last page and a page past the end", () => {
    expect(pageContentTree(tree(), 3, 2).nodes.map((n) => n.subject)).toEqual(["BAN", "MATH"]);
    expect(pageContentTree(tree(), 50, 2).page).toBe(3);
    expect(pageContentTree([], 1, 15)).toMatchObject({ nodes: [], totalChapters: 0, totalPlans: 0, page: 1 });
  });
});
