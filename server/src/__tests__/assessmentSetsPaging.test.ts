/**
 * D-#761 — assessmentSetsPage: the section's sets one page at a time, with the set-type
 * filter on the SERVER (the list screen used to filter it client-side, which a paged list
 * cannot do). Executes the real GraphQL field against the built schema; the model and the
 * section read-scope check are mocked. DB-free.
 */
import mongoose from "mongoose";
import { graphql, type ExecutionResult } from "graphql";

const oid = () => new mongoose.Types.ObjectId();

const mockCalls: { find?: unknown; sort?: unknown; skip?: number; limit?: number; count?: unknown } = {};
const mockDocs: unknown[] = [];
jest.mock("../modules/assessment/models/AssessmentSet", () => {
  const chain: Record<string, unknown> = {};
  chain.sort = (s: unknown) => { mockCalls.sort = s; return chain; };
  chain.skip = (n: number) => { mockCalls.skip = n; return chain; };
  chain.limit = (n: number) => { mockCalls.limit = n; return chain; };
  chain.lean = async () => mockDocs;
  return {
    AssessmentSet: {
      find: (q: unknown) => { mockCalls.find = q; return chain; },
      countDocuments: async (q: unknown) => { mockCalls.count = q; return 64; },
    },
  };
});

class FakeForbidden extends Error {
  constructor(msg = "Forbidden") {
    super(msg);
    this.name = "ForbiddenError";
  }
}
const mockAssertCanRead = jest.fn();
jest.mock("../middleware/authz", () => ({
  ForbiddenError: FakeForbidden,
  assertCanRead: (...a: unknown[]) => mockAssertCanRead(...a),
  assertCanWrite: jest.fn(),
}));

import { builder } from "../schema";
import "../modules/assessment/resolvers/assessment";

const schema = builder.toSchema();

const run = (source: string, role: string | null): Promise<ExecutionResult> =>
  graphql({
    schema,
    source,
    contextValue: { auth: role ? { role, userId: oid().toString() } : null },
  }) as Promise<ExecutionResult>;

const SECTION = oid().toString();
const CLASS = oid().toString();
const Q = (extra = "") =>
  `query { assessmentSetsPage(sectionId: "${SECTION}", classId: "${CLASS}"${extra}) { rows { id setType status } total page pageSize } }`;

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(mockCalls)) delete (mockCalls as Record<string, unknown>)[k];
  mockDocs.length = 0;
  mockAssertCanRead.mockResolvedValue(undefined);
});

describe("assessmentSetsPage", () => {
  test("status + setType filter on the server; newest first, skip/limit in the database", async () => {
    mockDocs.push({
      _id: oid(), setType: "CLASS_TEST", name: null, sectionId: oid(), classId: oid(), status: "draft",
      basketItems: [], createdBy: oid(), createdAt: new Date(),
    });
    const r = await run(Q(`, status: "draft", setType: "CLASS_TEST", page: 2, pageSize: 50`), "PRINCIPAL");
    expect(r.errors).toBeUndefined();
    expect(mockCalls.find).toEqual({ sectionId: SECTION, status: "draft", setType: "CLASS_TEST" });
    expect(mockCalls).toMatchObject({ sort: { createdAt: -1, _id: -1 }, skip: 50, limit: 50 });
    const page = (r.data as { assessmentSetsPage: { rows: { setType: string }[]; total: number; page: number } })
      .assessmentSetsPage;
    expect(page).toMatchObject({ total: 64, page: 2, pageSize: 50 });
    expect(page.rows[0].setType).toBe("CLASS_TEST");
  });

  test("the section read-scope runs first: out of scope → denied, no read", async () => {
    mockAssertCanRead.mockRejectedValue(new FakeForbidden("out of scope"));
    const r = await run(Q(), "TEACHER");
    expect(r.errors?.length).toBeGreaterThan(0);
    expect(mockCalls.find).toBeUndefined();
  });

  test("unauthenticated is denied at the scope layer", async () => {
    const r = await run(Q(), null);
    expect(r.errors?.length).toBeGreaterThan(0);
  });
});
