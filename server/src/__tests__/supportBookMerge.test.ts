/**
 * MergeService — the single write path into a book's content (SB-1, D-#406/#408).
 *
 * DB-free: the five book models are mocked with small in-memory stores, the pattern
 * accessControl.test.ts already uses. Everything referenced inside a jest.mock()
 * factory is `mock`-prefixed so babel-plugin-jest-hoist allows the out-of-scope
 * reference.
 *
 * The behaviours worth pinning are the ones that would be expensive to discover
 * later: that a refused patch is still STORED, that a merge replaces a lesson
 * WHOLESALE rather than field-merging, and that merging content does not move a
 * lesson's workflow state — which would silently undo a reviewer's sign-off.
 */
import { Types } from "mongoose";

// --------------------------------------------------------------------------
// In-memory stores
// --------------------------------------------------------------------------
interface MockRow { [k: string]: unknown }
const mockBooks: MockRow[] = [];
const mockLessons: MockRow[] = [];
const mockPatches: MockRow[] = [];
const mockEvents: MockRow[] = [];
const mockPolicyDocs: MockRow[] = [];

const mockOid = (): Types.ObjectId => new Types.ObjectId();

function mockMatch(row: MockRow, q: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(q)) {
    if (k === "$or") continue;
    if (row[k] !== v) return false;
  }
  return true;
}

jest.mock("../modules/support-book/models/SupportBook", () => ({
  SupportBook: {
    findOne: (q: Record<string, unknown>) =>
      Promise.resolve(mockBooks.find((b) => mockMatch(b, q)) ?? null),
    updateOne: (q: Record<string, unknown>, u: Record<string, unknown>) => {
      const b = mockBooks.find((x) => x._id === q._id);
      if (b) Object.assign(b, (u.$set ?? {}) as MockRow);
      return Promise.resolve({ acknowledged: true });
    },
  },
}));

jest.mock("../modules/support-book/models/SupportBookLesson", () => ({
  SupportBookLesson: {
    find: (q: Record<string, unknown>) => ({
      sort: () => ({
        lean: () =>
          Promise.resolve(
            mockLessons.filter((l) => mockMatch(l, q)).sort((a, b) => (a.lessonNo as number) - (b.lessonNo as number)),
          ),
      }),
    }),
    findOne: (q: Record<string, unknown>) => Promise.resolve(mockLessons.find((l) => mockMatch(l, q)) ?? null),
    findOneAndUpdate: (q: Record<string, unknown>, u: Record<string, unknown>) => {
      const existing = mockLessons.find((l) => mockMatch(l, q));
      if (existing) {
        // WHOLESALE: $set carries the complete lesson, so the row becomes the patch.
        Object.assign(existing, (u.$set ?? {}) as MockRow);
        return Promise.resolve(existing);
      }
      const row: MockRow = { _id: mockOid(), ...(u.$setOnInsert ?? {}), ...(u.$set ?? {}) };
      mockLessons.push(row);
      return Promise.resolve(row);
    },
  },
}));

jest.mock("../modules/support-book/models/LessonPatch", () => ({
  LessonPatch: {
    create: (doc: MockRow) => {
      const row = { _id: mockOid(), ...doc };
      mockPatches.push(row);
      return Promise.resolve(row);
    },
    updateOne: (q: Record<string, unknown>, u: Record<string, unknown>) => {
      const p = mockPatches.find((x) => String(x._id) === String(q._id));
      if (p) Object.assign(p, (u.$set ?? {}) as MockRow);
      return Promise.resolve({ acknowledged: true });
    },
  },
}));

jest.mock("../modules/support-book/models/BookEvent", () => ({
  writeBookEvent: (e: MockRow) => {
    mockEvents.push(e);
    return Promise.resolve();
  },
}));

jest.mock("../modules/support-book/models/PolicyDoc", () => ({
  PolicyDoc: {
    find: (q: Record<string, unknown>) => ({
      lean: () => Promise.resolve(mockPolicyDocs.filter((d) => d.active === (q.active ?? true))),
    }),
    findOne: () => ({ sort: () => ({ lean: () => Promise.resolve(null) }) }),
    updateMany: () => Promise.resolve({ acknowledged: true }),
    create: (d: MockRow) => Promise.resolve({ _id: mockOid(), ...d }),
  },
}));

import { submitPatch, PatchShapeError, type PatchEnvelope } from "../modules/support-book/services/MergeService";

const ACTOR = new Types.ObjectId();

const lessonObj = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  lesson_no: 1,
  nctb_pages: [3],
  action: "retain",
  competency_codes: ["১.১"],
  outcome_codes: ["১.১.১"],
  bw_treatment: "native_safe",
  blocks: [{ id: "L001-b01", type: "heading", source: "school", text_bn: "নতুন" }],
  image_slots: [],
  ...over,
});

const envelope = (lessons: Array<Record<string, unknown>>, patchId = "patch_T1_L001_v1"): PatchEnvelope => ({
  schema_version: "1.0",
  book_id: "T1-BAN",
  patch_id: patchId,
  task: "CONTENT",
  lessons,
});

beforeEach(() => {
  mockBooks.length = 0; mockLessons.length = 0; mockPatches.length = 0;
  mockEvents.length = 0; mockPolicyDocs.length = 0;
  mockBooks.push({
    _id: mockOid(), bookId: "T1-BAN", bookType: "SUPPORT_BOOK", classLevel: 3,
    subject: "BAN", mode: "R", titleBn: "পরীক্ষা", hasTextEn: false, status: "content-draft",
  });
});

describe("submitPatch — envelope shape", () => {
  it("rejects a patch with no lessons", async () => {
    await expect(submitPatch({ patch: envelope([]), source: "DESKTOP_UPLOAD", actorId: ACTOR }))
      .rejects.toBeInstanceOf(PatchShapeError);
  });

  it("rejects a lesson without a numeric lesson_no", async () => {
    await expect(submitPatch({ patch: envelope([{ blocks: [] }]), source: "DESKTOP_UPLOAD", actorId: ACTOR }))
      .rejects.toBeInstanceOf(PatchShapeError);
  });

  it("rejects an unknown book", async () => {
    const p = { ...envelope([lessonObj()]), book_id: "NOPE" };
    await expect(submitPatch({ patch: p, source: "DESKTOP_UPLOAD", actorId: ACTOR }))
      .rejects.toBeInstanceOf(PatchShapeError);
  });
});

describe("submitPatch — the validator is the gate", () => {
  it("merges a clean patch and stamps the policy-set hash", async () => {
    const r = await submitPatch({ patch: envelope([lessonObj()]), source: "DESKTOP_UPLOAD", actorId: ACTOR });
    expect(r.merged).toBe(true);
    expect(r.report.redCount).toBe(0);
    expect(mockLessons).toHaveLength(1);
    expect(mockLessons[0].policySetHash).toBe(r.policySetHash);
    expect(mockEvents.some((e) => e.kind === "PATCH_MERGED")).toBe(true);
  });

  it("REFUSES a patch with a RED — and still stores it, findings and all", async () => {
    // Arabic script trips the script guard (C8).
    const bad = lessonObj({ blocks: [{ id: "b1", text_bn: "সাল্লাল্লাহু ﷺ" }] });
    const r = await submitPatch({ patch: envelope([bad]), source: "DESKTOP_UPLOAD", actorId: ACTOR });
    expect(r.merged).toBe(false);
    expect(mockLessons).toHaveLength(0);              // nothing written to the book
    expect(mockPatches).toHaveLength(1);              // but the attempt is evidence
    expect(mockPatches[0].status).toBe("REJECTED");
    expect((mockPatches[0].findings as unknown[]).length).toBeGreaterThan(0);
    expect(mockEvents.some((e) => e.kind === "PATCH_REJECTED")).toBe(true);
  });

  it("merges despite GREY findings — a warning never blocks", async () => {
    const grey = lessonObj({
      image_slots: [{ id: "s1", contains_living_being: false, filename: "a.png", status: "draft" }],
    });
    const r = await submitPatch({ patch: envelope([grey]), source: "DESKTOP_UPLOAD", actorId: ACTOR });
    expect(r.merged).toBe(true);
    expect(r.report.greyCount).toBeGreaterThan(0);
  });
});

describe("submitPatch — wholesale by lesson_no (SCHEMA §5)", () => {
  it("REPLACES the lesson entire rather than field-merging it", async () => {
    await submitPatch({ patch: envelope([lessonObj({ notes: "first" })]), source: "DESKTOP_UPLOAD", actorId: ACTOR });
    expect(mockLessons[0].notes).toBe("first");

    // The second patch omits `notes` entirely. Field-merging would leave "first"
    // behind; wholesale replacement must not.
    const second = lessonObj({ blocks: [{ id: "L001-b01", type: "heading", source: "school", text_bn: "বদল" }] });
    delete (second as Record<string, unknown>).notes;
    const r = await submitPatch({ patch: envelope([second], "patch_T1_L001_v2"), source: "DESKTOP_UPLOAD", actorId: ACTOR });

    expect(r.merged).toBe(true);
    expect(mockLessons).toHaveLength(1);
    expect(mockLessons[0].notes).toBe("");
    expect((mockLessons[0].blocks as Array<Record<string, unknown>>)[0].text_bn).toBe("বদল");
  });

  it("marks the prior patch SUPERSEDED and links the chain", async () => {
    await submitPatch({ patch: envelope([lessonObj()]), source: "DESKTOP_UPLOAD", actorId: ACTOR });
    const first = mockPatches[0];
    await submitPatch({ patch: envelope([lessonObj()], "patch_T1_L001_v2"), source: "DESKTOP_UPLOAD", actorId: ACTOR });
    expect(first.status).toBe("SUPERSEDED");
    expect(String(mockPatches[1].supersedes)).toBe(String(first._id));
  });

  it("does NOT move a lesson's workflow state — a merge changes content, not position", async () => {
    // Undoing a reviewer's sign-off by re-merging text would be a silent, expensive
    // bug: the lesson would quietly re-enter the queue as a draft.
    await submitPatch({ patch: envelope([lessonObj()]), source: "DESKTOP_UPLOAD", actorId: ACTOR });
    mockLessons[0].state = "CONTENT_APPROVED";
    await submitPatch({ patch: envelope([lessonObj()], "patch_T1_L001_v2"), source: "DESKTOP_UPLOAD", actorId: ACTOR });
    expect(mockLessons[0].state).toBe("CONTENT_APPROVED");
  });

  it("adds a পাঠ the book does not have yet", async () => {
    await submitPatch({ patch: envelope([lessonObj()]), source: "DESKTOP_UPLOAD", actorId: ACTOR });
    await submitPatch({
      patch: envelope([lessonObj({ lesson_no: 2 })], "patch_T1_L002_v1"),
      source: "DESKTOP_UPLOAD", actorId: ACTOR,
    });
    expect(mockLessons.map((l) => l.lessonNo).sort()).toEqual([1, 2]);
  });
});

describe("submitPatch — one path downstream (D-#408)", () => {
  it("an IN_APP_CHAT patch is indistinguishable from an uploaded one except for source", async () => {
    const a = await submitPatch({ patch: envelope([lessonObj()]), source: "DESKTOP_UPLOAD", actorId: ACTOR });
    const lessonAfterUpload = JSON.parse(JSON.stringify(mockLessons[0]));

    mockLessons.length = 0; mockPatches.length = 0; mockEvents.length = 0;

    const b = await submitPatch({
      patch: envelope([lessonObj()], "patch_T1_L001_chat"),
      source: "IN_APP_CHAT", actorId: ACTOR, chatSessionId: new Types.ObjectId(),
    });
    const lessonAfterChat = JSON.parse(JSON.stringify(mockLessons[0]));

    expect(a.merged).toBe(b.merged);
    expect(a.report.redCount).toBe(b.report.redCount);
    // The lesson rows differ only by generated ids and the patch pointer.
    for (const k of ["lessonNo", "blocks", "action", "bwTreatment", "notes"]) {
      expect(lessonAfterChat[k]).toEqual(lessonAfterUpload[k]);
    }
    expect(mockPatches[0].source).toBe("IN_APP_CHAT");
    expect(mockPatches[0].chatSessionId).toBeDefined();
  });

  it("reports missing policy documents rather than silently generating against a partial set", async () => {
    const r = await submitPatch({ patch: envelope([lessonObj()]), source: "DESKTOP_UPLOAD", actorId: ACTOR });
    expect(r.policyMissing.length).toBeGreaterThan(0);
    expect(r.policyMissing).toContain("README");
  });
});
