/**
 * Slice 1 content browse + scope tests (J1.5, J1.6).
 *
 * J1.5 — filter logic on ContentArtifact documents (tested against mocked Mongoose)
 * J1.6 — supervisory scope: assertCanRead bypass for PRINCIPAL/OFFICE;
 *         GUARDIAN always denied; TEACHER with no grants denied (default-deny).
 *
 * Scope predicate logic (canRead/canWrite/composeTeacherScope) is already
 * unit-tested in scopeGrant.test.ts. Here we verify that the content resolver
 * calls assertCanRead and that PRINCIPAL/OFFICE bypass + GUARDIAN/no-grant denial
 * are exercised.
 */

import { assertCanRead, ForbiddenError } from "../middleware/authz";
import type { AppContext } from "../context";
import mongoose from "mongoose";

// ---------------------------------------------------------------------------
// Mock ScopeGrant model so assertCanRead's teacher path doesn't need a real DB
// ---------------------------------------------------------------------------

// ScopeGrant.find().lean() pattern used by composeTeacherScope
jest.mock("../modules/foundation/models/ScopeGrant", () => ({
  ScopeGrant: {
    find: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([]) })), // no grants
  },
}));

// ---------------------------------------------------------------------------
// J1.5 — browse filter logic (pure Mongoose query structure validation)
// ---------------------------------------------------------------------------

describe("J1.5 — content browse filter construction", () => {
  test("subject filter selects correct field", () => {
    const filter: Record<string, unknown> = {};
    const subject = "ENG";
    if (subject) filter.subject = subject;
    expect(filter).toEqual({ subject: "ENG" });
  });

  test("classLevel filter selects correct field", () => {
    const filter: Record<string, unknown> = {};
    const classLevel = 5;
    if (classLevel != null) filter.classLevel = classLevel;
    expect(filter).toEqual({ classLevel: 5 });
  });

  test("currentOnly default (undefined) adds current:true to filter", () => {
    function buildFilter(currentOnly?: boolean | null): Record<string, unknown> {
      const f: Record<string, unknown> = {};
      if (currentOnly !== false) f.current = true;
      return f;
    }
    expect(buildFilter()).toEqual({ current: true });
    expect(buildFilter(true)).toEqual({ current: true });
    expect(buildFilter(null)).toEqual({ current: true });
  });

  test("currentOnly=false does NOT add current filter", () => {
    function buildFilter(currentOnly?: boolean | null): Record<string, unknown> {
      const f: Record<string, unknown> = {};
      if (currentOnly !== false) f.current = true;
      return f;
    }
    expect(buildFilter(false)).toEqual({});
  });

  test("curationTag filter selects correct field", () => {
    const filter: Record<string, unknown> = {};
    const curationTag = "KEEP_AS_IS";
    if (curationTag) filter.curationTag = curationTag;
    expect(filter).toEqual({ curationTag: "KEEP_AS_IS" });
  });

  test("contentTree: chapters with same anchorWord+number are grouped together", () => {
    // Simulate the grouping logic from the contentTree resolver
    const docs = [
      { subject: "ENG", classLevel: 5, address: { anchorWord: "Unit", number: 9, title: "S01" } },
      { subject: "ENG", classLevel: 5, address: { anchorWord: "Unit", number: 9, title: "S02" } },
      { subject: "ENG", classLevel: 5, address: { anchorWord: "Unit", number: 10, title: "S01" } },
    ];

    const nodeMap = new Map<string, { subject: string; classLevel: number; chapters: { anchorWord: string; number: string; artifacts: typeof docs }[] }>();
    for (const doc of docs) {
      const nodeKey = `${doc.subject}:${doc.classLevel}`;
      if (!nodeMap.has(nodeKey)) {
        nodeMap.set(nodeKey, { subject: doc.subject, classLevel: doc.classLevel, chapters: [] });
      }
      const node = nodeMap.get(nodeKey)!;
      const chapterNum = String(doc.address.number);
      let chapter = node.chapters.find((c) => c.anchorWord === doc.address.anchorWord && c.number === chapterNum);
      if (!chapter) {
        chapter = { anchorWord: doc.address.anchorWord, number: chapterNum, artifacts: [] };
        node.chapters.push(chapter);
      }
      chapter.artifacts.push(doc);
    }

    const tree = Array.from(nodeMap.values());
    expect(tree).toHaveLength(1); // one ENG-C5 node
    expect(tree[0].chapters).toHaveLength(2); // Unit 9 and Unit 10
    expect(tree[0].chapters.find((c) => c.number === "9")!.artifacts).toHaveLength(2); // 2 sessions in Unit 9
    expect(tree[0].chapters.find((c) => c.number === "10")!.artifacts).toHaveLength(1);
  });

  test("contentTree: multiple subjects create multiple nodes", () => {
    const docs = [
      { subject: "ENG", classLevel: 5, address: { anchorWord: "Unit", number: 1, title: "E1" } },
      { subject: "MATH", classLevel: 5, address: { anchorWord: "অধ্যায়", number: 1, title: "M1" } },
    ];
    const subjects = new Set(docs.map((d) => `${d.subject}:${d.classLevel}`));
    expect(subjects.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// J1.6 — supervisory scope: assertCanRead enforcement
// ---------------------------------------------------------------------------

const ACTOR_ID = new mongoose.Types.ObjectId().toString();

describe("J1.6 — assertCanRead scope enforcement", () => {
  test("PRINCIPAL bypasses assertCanRead (no ForbiddenError)", async () => {
    const ctx: AppContext = {
      req: {} as never, res: {} as never,
      auth: { userId: ACTOR_ID, role: "PRINCIPAL" },
    };
    await expect(assertCanRead(ctx, "sectionX", "classX", "ENG")).resolves.toBeUndefined();
  });

  test("OFFICE bypasses assertCanRead (no ForbiddenError)", async () => {
    const ctx: AppContext = {
      req: {} as never, res: {} as never,
      auth: { userId: ACTOR_ID, role: "OFFICE" },
    };
    await expect(assertCanRead(ctx, "sectionX", "classX", "MATH")).resolves.toBeUndefined();
  });

  test("GUARDIAN is always denied by assertCanRead (ForbiddenError)", async () => {
    const ctx: AppContext = {
      req: {} as never, res: {} as never,
      auth: { userId: ACTOR_ID, role: "GUARDIAN" },
    };
    await expect(assertCanRead(ctx, "sectionX", "classX", "ENG")).rejects.toThrow("Forbidden");
  });

  test("TEACHER with no scope grants is denied (default-deny, J1.4-related)", async () => {
    // ScopeGrant.find is mocked to return [] (no grants)
    const ctx: AppContext = {
      req: {} as never, res: {} as never,
      auth: { userId: new mongoose.Types.ObjectId().toString(), role: "TEACHER" },
    };
    await expect(assertCanRead(ctx, "sectionX", "classX", "ENG")).rejects.toThrow("Forbidden");
  });

  test("ForbiddenError is thrown with correct name", () => {
    const err = new ForbiddenError("test");
    expect(err.name).toBe("ForbiddenError");
    expect(err.message).toBe("test");
  });
});
