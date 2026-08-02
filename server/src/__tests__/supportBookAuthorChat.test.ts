/**
 * In-app authoring chat (SB-6, D-#403/#408/#412).
 *
 * Two things here are worth real tests and would otherwise be discovered on an invoice
 * or in a bad book:
 *
 *   1. THE POLICY PREFIX MUST NOT DRIFT between turns. Prompt caching is a strict
 *      prefix match, so a prefix that varies still WORKS — it just quietly costs full
 *      price every turn. Nothing fails; the bill grows.
 *   2. A patch turn must go through the SAME validator as a Desktop upload (D-#408),
 *      and a RED must come back as findings rather than as a merge.
 *
 * The provider is injected, so no test touches a network or spends a token.
 */
import { Types } from "mongoose";

interface Row { [k: string]: unknown }
const mockSessions: Row[] = [];
const mockBooks: Row[] = [];
const mockLessons: Row[] = [];
const mockEvents: Row[] = [];
const mockPolicyDocs: Row[] = [];
let mockSubmitResult: Row = { merged: true, patchId: new Types.ObjectId(), report: { redCount: 0, greyCount: 0, findings: [], passed: true, skipped: [] } };
const mockSubmitCalls: Row[] = [];

const oid = (): Types.ObjectId => new Types.ObjectId();

function docify(r: Row): Row {
  return Object.assign(r, { save: () => Promise.resolve(r) });
}

jest.mock("../modules/support-book/models/BookAuthorSession", () => ({
  BookAuthorSession: {
    findOne: (q: Record<string, unknown>) =>
      Promise.resolve(
        (() => {
          const hit = mockSessions.find((s) => s.bookId === q.bookId && s.lessonNo === q.lessonNo && s.state === q.state);
          return hit ? docify(hit) : null;
        })(),
      ),
    find: () => ({ select: () => ({ lean: () => Promise.resolve(mockSessions) }) }),
    create: (d: Row) => { const s = docify({ _id: oid(), ...d }); mockSessions.push(s); return Promise.resolve(s); },
  },
}));

jest.mock("../modules/support-book/models/SupportBook", () => ({
  SupportBook: { findOne: () => ({ lean: () => Promise.resolve(mockBooks[0] ?? null) }) },
}));

jest.mock("../modules/support-book/models/SupportBookLesson", () => ({
  SupportBookLesson: { findOne: () => ({ lean: () => Promise.resolve(mockLessons[0] ?? null) }) },
}));

jest.mock("../modules/support-book/models/PolicyDoc", () => ({
  PolicyDoc: {
    find: () => ({ lean: () => Promise.resolve(mockPolicyDocs) }),
    findOne: () => ({ sort: () => ({ lean: () => Promise.resolve(null) }), lean: () => Promise.resolve(null) }),
    updateMany: () => Promise.resolve({}),
    create: (d: Row) => Promise.resolve(d),
  },
}));

jest.mock("../modules/support-book/models/PolicySetSnapshot", () => ({
  PolicySetSnapshot: {
    updateOne: () => Promise.resolve({}),
    findOne: () => ({ lean: () => Promise.resolve(null) }),
  },
}));

jest.mock("../modules/support-book/services/MergeService", () => ({
  submitPatch: (i: Row) => { mockSubmitCalls.push(i); return Promise.resolve(mockSubmitResult); },
}));

jest.mock("../modules/support-book/models/BookEvent", () => ({
  writeBookEvent: (e: Row) => { mockEvents.push(e); return Promise.resolve(); },
}));

import {
  runTurn, monthlySpend, AuthorChatError, AUTHOR_CHAT_ERRORS_BN,
  type AuthorProvider, type ProviderReply,
} from "../modules/support-book/services/BookAuthorChatService";
import { assemblePrompt, buildPolicyPrefix, PROMPT_VERSION } from "../modules/support-book/services/BookAuthorPromptService";

const BOOK = "C1-BAN";
const AUTHOR = oid();

/** Records every prompt it is sent, so prefix stability is observable. */
class SpyProvider implements AuthorProvider {
  readonly model = "test-model";
  readonly prefixes: string[] = [];
  readonly variables: string[] = [];
  constructor(private readonly reply: Partial<ProviderReply> = {}) {}
  send(i: { policyPrefix: string; variablePart: string; expectPatch: boolean }): Promise<ProviderReply> {
    this.prefixes.push(i.policyPrefix);
    this.variables.push(i.variablePart);
    return Promise.resolve({
      text: this.reply.text ?? "drafted",
      patch: i.expectPatch ? (this.reply.patch ?? { book_id: BOOK, patch_id: "p1", task: "CONTENT", lessons: [{ lesson_no: 1 }] }) : null,
      resolvedModel: "test-model-2026-08",
      inputTokens: this.reply.inputTokens ?? 100,
      outputTokens: this.reply.outputTokens ?? 20,
      cached: this.reply.cached ?? false,
    });
  }
}

beforeEach(() => {
  mockSessions.length = 0; mockBooks.length = 0; mockLessons.length = 0;
  mockEvents.length = 0; mockPolicyDocs.length = 0; mockSubmitCalls.length = 0;
  mockSubmitResult = { merged: true, patchId: oid(), report: { redCount: 0, greyCount: 0, findings: [], passed: true, skipped: [] } };
  mockBooks.push({ bookId: BOOK, classLevel: 1, subject: "BAN", mode: "R", titleBn: "সহায়িকা", hasTextEn: false });
  mockLessons.push({ bookId: BOOK, lessonNo: 1, nctbPages: [3], competencyCodes: ["১.১"], outcomeCodes: [] });
  mockPolicyDocs.push(
    { docKey: "README", bookId: null, version: 2, body: "the writing rules", sha256: "a", active: true },
    { docKey: "REF2_REGISTER", bookId: null, version: 1, body: "the name bank", sha256: "b", active: true },
  );
  delete process.env.BOOK_AUTHOR_MONTHLY_TOKEN_CEILING;
});

describe("the policy prefix — cacheability is the feature", () => {
  it("is IDENTICAL across turns of a session", async () => {
    // A prefix that varies still works. It just silently stops caching and costs full
    // price every turn — a bug that shows up on an invoice months later.
    const p = new SpyProvider();
    await runTurn({ bookId: BOOK, lessonNo: 1, authorId: AUTHOR, instruction: "first", provider: p });
    await runTurn({ bookId: BOOK, lessonNo: 1, authorId: AUTHOR, instruction: "second", provider: p });
    expect(p.prefixes).toHaveLength(2);
    expect(p.prefixes[0]).toBe(p.prefixes[1]);
  });

  it("carries the governance VERBATIM, not a summary", async () => {
    // The whole reason policy is stored as DATA is that a paraphrase drifts from what
    // the Principal approved.
    const p = new SpyProvider();
    await runTurn({ bookId: BOOK, lessonNo: 1, authorId: AUTHOR, instruction: "go", provider: p });
    expect(p.prefixes[0]).toContain("the writing rules");
    expect(p.prefixes[0]).toContain("the name bank");
  });

  it("keeps the lesson OUT of the prefix — it varies, so it must come after", async () => {
    const p = new SpyProvider();
    await runTurn({ bookId: BOOK, lessonNo: 1, authorId: AUTHOR, instruction: "go", provider: p });
    expect(p.prefixes[0]).not.toContain("lesson_no");
    expect(p.variables[0]).toContain("lesson_no: 1");
  });

  it("grows the VARIABLE part with history while the prefix stays put", async () => {
    const p = new SpyProvider();
    await runTurn({ bookId: BOOK, lessonNo: 1, authorId: AUTHOR, instruction: "first", provider: p });
    await runTurn({ bookId: BOOK, lessonNo: 1, authorId: AUTHOR, instruction: "second", provider: p });
    expect(p.variables[1].length).toBeGreaterThan(p.variables[0].length);
    expect(p.variables[1]).toContain("first");
  });

  it("states which governance documents were MISSING rather than hiding a thin set", () => {
    const prefix = buildPolicyPrefix({ docs: [], hash: "x", missing: ["README", "REF2_REGISTER"] } as never);
    expect(prefix).toContain("were NOT available");
    expect(prefix).toContain("README");
  });

  it("tells the model the validator is the gate, not itself", () => {
    const prefix = buildPolicyPrefix({ docs: [], hash: "x", missing: [] } as never);
    // A model that believes its output ships argues with the validator instead of
    // fixing the text.
    expect(prefix).toContain("YOU ARE NOT THE GATE");
    expect(prefix).toContain("FLAG UNCERTAINTY");
  });

  it("hashes the prefix so drift is detectable, not merely hoped against", () => {
    const set = { docs: [{ docKey: "README", version: 1, body: "x" }], hash: "h", missing: [] } as never;
    const a = assemblePrompt({ set, book: mockBooks[0] as never, instruction: "one" });
    const b = assemblePrompt({ set, book: mockBooks[0] as never, instruction: "two" });
    expect(a.prefixHash).toBe(b.prefixHash);
    expect(a.promptVersion).toBe(PROMPT_VERSION);
  });
});

describe("a patch turn goes through the SAME gate (D-#408)", () => {
  it("hands the envelope to submitPatch with source IN_APP_CHAT", async () => {
    const p = new SpyProvider();
    const r = await runTurn({
      bookId: BOOK, lessonNo: 1, authorId: AUTHOR, instruction: "emit",
      provider: p, expectPatch: true, autoMerge: true,
    });
    expect(r.patchEmitted).toBe(true);
    expect(mockSubmitCalls).toHaveLength(1);
    expect(mockSubmitCalls[0].source).toBe("IN_APP_CHAT");
    expect(mockSubmitCalls[0].chatSessionId).toBeDefined();
    expect(r.merged).toBe(true);
  });

  it("returns the findings and does NOT merge on a RED", async () => {
    mockSubmitResult = {
      merged: false, patchId: oid(),
      report: { redCount: 2, greyCount: 0, passed: false, skipped: [], findings: [{ check: "C4_LETTER_AUDIT", severity: "RED", message: "বর্ণ not taught" }] },
    };
    const p = new SpyProvider();
    const r = await runTurn({
      bookId: BOOK, lessonNo: 1, authorId: AUTHOR, instruction: "emit",
      provider: p, expectPatch: true, autoMerge: true,
    });
    expect(r.merged).toBe(false);
    expect(r.report!.redCount).toBe(2);
    expect(mockSessions[0].state).toBe("OPEN"); // still open — the author tries again
  });

  it("does not merge when autoMerge is off, even with a patch in hand", async () => {
    const p = new SpyProvider();
    const r = await runTurn({
      bookId: BOOK, lessonNo: 1, authorId: AUTHOR, instruction: "draft it",
      provider: p, expectPatch: true,
    });
    expect(r.patchEmitted).toBe(true);
    expect(mockSubmitCalls).toHaveLength(0);
  });

  it("a prose turn emits no patch and touches the merge path not at all", async () => {
    const p = new SpyProvider();
    const r = await runTurn({ bookId: BOOK, lessonNo: 1, authorId: AUTHOR, instruction: "what codes apply?", provider: p });
    expect(r.patchEmitted).toBe(false);
    expect(mockSubmitCalls).toHaveLength(0);
  });
});

describe("provenance and cost", () => {
  it("records model, RESOLVED model, policy hash, prompt version and usage per turn", async () => {
    // An alias resolves to a dated model, and THAT is what a bad batch is traced to.
    const p = new SpyProvider();
    await runTurn({ bookId: BOOK, lessonNo: 1, authorId: AUTHOR, instruction: "go", provider: p });
    const modelTurn = (mockSessions[0].turns as Row[])[1];
    expect(modelTurn.model).toBe("test-model");
    expect(modelTurn.resolvedModel).toBe("test-model-2026-08");
    expect(modelTurn.promptVersion).toBe(PROMPT_VERSION);
    expect(modelTurn.policySetHash).toBeTruthy();
    expect(modelTurn.inputTokens).toBe(100);
  });

  it("accumulates spend on the session", async () => {
    const p = new SpyProvider();
    await runTurn({ bookId: BOOK, lessonNo: 1, authorId: AUTHOR, instruction: "a", provider: p });
    await runTurn({ bookId: BOOK, lessonNo: 1, authorId: AUTHOR, instruction: "b", provider: p });
    expect(mockSessions[0].totalInputTokens).toBe(200);
    expect(mockSessions[0].totalOutputTokens).toBe(40);
    expect(await monthlySpend(BOOK)).toBe(240);
  });

  it("REFUSES once the monthly ceiling is reached", async () => {
    // The check runs BEFORE a turn, so one turn can overshoot — the cost is not
    // knowable until the call returns. That is deliberate: the alternative is
    // refusing work on an estimate, and an estimate that is wrong in the safe
    // direction still stops an author mid-chapter for no reason.
    process.env.BOOK_AUTHOR_MONTHLY_TOKEN_CEILING = "100";
    const p = new SpyProvider();
    await runTurn({ bookId: BOOK, lessonNo: 1, authorId: AUTHOR, instruction: "a", provider: p });
    expect(await monthlySpend(BOOK)).toBe(120); // overshot the 100 ceiling
    await expect(
      runTurn({ bookId: BOOK, lessonNo: 1, authorId: AUTHOR, instruction: "b", provider: p }),
    ).rejects.toThrow(AUTHOR_CHAT_ERRORS_BN.ceiling);
  });

  it("allows a turn while spend is still UNDER the ceiling", async () => {
    process.env.BOOK_AUTHOR_MONTHLY_TOKEN_CEILING = "1000";
    const p = new SpyProvider();
    await runTurn({ bookId: BOOK, lessonNo: 1, authorId: AUTHOR, instruction: "a", provider: p });
    await expect(
      runTurn({ bookId: BOOK, lessonNo: 1, authorId: AUTHOR, instruction: "b", provider: p }),
    ).resolves.toBeDefined();
  });

  it("refuses in Bangla when no provider is configured", async () => {
    await expect(
      runTurn({ bookId: BOOK, lessonNo: 1, authorId: AUTHOR, instruction: "a", provider: null }),
    ).rejects.toBeInstanceOf(AuthorChatError);
  });

  it("reuses the OPEN session for a পাঠ rather than starting a new one each turn", async () => {
    const p = new SpyProvider();
    await runTurn({ bookId: BOOK, lessonNo: 1, authorId: AUTHOR, instruction: "a", provider: p });
    await runTurn({ bookId: BOOK, lessonNo: 1, authorId: AUTHOR, instruction: "b", provider: p });
    expect(mockSessions).toHaveLength(1);
    expect((mockSessions[0].turns as Row[])).toHaveLength(4); // 2 user + 2 model
  });
});
