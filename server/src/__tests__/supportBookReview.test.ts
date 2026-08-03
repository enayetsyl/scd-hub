/**
 * Review rounds + the escalation chain (SB-3, D-#410/#424).
 *
 * The prd acceptance: reviewer ≠ author except the stamped Principal; one open round
 * at a time; the checklist IS the sign-off; three-plus exchanges preserved in order
 * with attachments; **a resolution changes no lesson field**; and a lesson cannot be
 * signed off while an escalation is unresolved.
 *
 * DB-free — in-memory stores behind the model mocks (the accessControl.test.ts
 * pattern; `mock`-prefixed for jest hoisting).
 */
import { Types } from "mongoose";

interface Row { [k: string]: unknown }
const mockRounds: Row[] = [];
const mockEscalations: Row[] = [];
const mockLessons: Row[] = [];
const mockPatches: Row[] = [];
const mockEvents: Row[] = [];
const mockComments: Row[] = [];

const oid = (): Types.ObjectId => new Types.ObjectId();

function matches(row: Row, q: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(q)) {
    if (v && typeof v === "object" && "$in" in (v as Record<string, unknown>)) {
      const list = (v as { $in: unknown[] }).$in;
      if (!list.includes(row[k])) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

/** A mongoose-ish doc: mutable, with save(). */
function docify(row: Row): Row {
  return Object.assign(row, { save: () => Promise.resolve(row) });
}

jest.mock("../modules/support-book/models/BookReviewRound", () => ({
  BookReviewRound: {
    findOne: (q: Record<string, unknown>) => {
      const hit = mockRounds.find((r) => matches(r, q)) ?? null;
      // The service calls findOne() two ways — awaited directly (needs a doc with
      // save()) and .sort().lean() (needs a plain row) — so the stub is a thenable
      // that also carries the chain methods.
      const p = Promise.resolve(hit ? docify(hit) : null) as Promise<Row | null> & {
        sort?: () => { lean: () => Promise<Row | null> };
        lean?: () => Promise<Row | null>;
      };
      p.sort = () => ({ lean: () => Promise.resolve(hit) });
      p.lean = () => Promise.resolve(hit);
      return p;
    },
    find: (q: Record<string, unknown>) => ({
      sort: () => ({
        limit: () => ({
          lean: () => Promise.resolve(
            [...mockRounds].filter((r) => matches(r, q)).sort((a, b) => (b.roundNumber as number) - (a.roundNumber as number)).slice(0, 1),
          ),
        }),
        lean: () => Promise.resolve(mockRounds.filter((r) => matches(r, q))),
      }),
    }),
    create: (doc: Row) => { const r = docify({ _id: oid(), ...doc }); mockRounds.push(r); return Promise.resolve(r); },
  },
}));

jest.mock("../modules/support-book/models/BookEscalation", () => ({
  BookEscalation: {
    findById: (id: unknown) => Promise.resolve(
      (() => { const hit = mockEscalations.find((e) => String(e._id) === String(id)); return hit ? docify(hit) : null; })(),
    ),
    find: (q: Record<string, unknown>) => ({ lean: () => Promise.resolve(mockEscalations.filter((e) => matches(e, q))) }),
    create: (doc: Row) => { const e = docify({ _id: oid(), ...doc }); mockEscalations.push(e); return Promise.resolve(e); },
  },
}));

jest.mock("../modules/support-book/models/SupportBookLesson", () => ({
  SupportBookLesson: {
    findOne: (q: Record<string, unknown>) => ({ lean: () => Promise.resolve(mockLessons.find((l) => matches(l, q)) ?? null) }),
    updateOne: (q: Record<string, unknown>, u: Record<string, unknown>) => {
      const l = mockLessons.find((x) => matches(x, q));
      if (l) for (const [k, v] of Object.entries((u.$set ?? {}) as Row)) l[k] = v;
      return Promise.resolve({ acknowledged: true });
    },
  },
}));

jest.mock("../modules/support-book/models/LessonPatch", () => ({
  LessonPatch: {
    findById: (id: unknown) => ({ lean: () => Promise.resolve(mockPatches.find((p) => String(p._id) === String(id)) ?? null) }),
  },
}));

jest.mock("../modules/support-book/models/BookItemComment", () => ({
  BookItemComment: {
    find: (q: Record<string, unknown>) => ({
      sort: () => ({ lean: () => Promise.resolve(mockComments.filter((c) => matches(c, q))) }),
    }),
    findById: (id: unknown) => Promise.resolve(
      (() => { const hit = mockComments.find((c) => String(c._id) === String(id)); return hit ? docify(hit) : null; })(),
    ),
    create: (doc: Row) => { const c = docify({ _id: oid(), ...doc }); mockComments.push(c); return Promise.resolve(c); },
  },
}));

jest.mock("../modules/support-book/models/BookEvent", () => ({
  writeBookEvent: (e: Row) => { mockEvents.push(e); return Promise.resolve(); },
}));

import {
  assignReview, submitReview, signOffLesson, raiseEscalation, replyToEscalation,
  resolveEscalation, openEscalations, ReviewRuleError, REVIEW_ERRORS_BN,
} from "../modules/support-book/services/BookReviewService";
import { BOOK_REVIEW_CHECKLIST } from "@scd/shared";

const BOOK = "C1-BAN";
const AUTHOR = oid();
const REVIEWER = oid();
const SENIOR = oid();
const OFFICE = oid();
const ALL = [...BOOK_REVIEW_CHECKLIST];

/** Lesson 12, authored by AUTHOR. */
function seedLesson(lessonNo = 12): void {
  const patchId = oid();
  mockPatches.push({ _id: patchId, submittedBy: AUTHOR });
  mockLessons.push({ bookId: BOOK, lessonNo, currentPatchId: patchId, state: "CONTENT_DRAFT", reviewerSignoff: {} });
}

beforeEach(() => {
  mockRounds.length = 0; mockEscalations.length = 0; mockLessons.length = 0;
  mockPatches.length = 0; mockEvents.length = 0; mockComments.length = 0;
  seedLesson();
});

describe("assigning a review round", () => {
  it("opens round 1 and snapshots what the reviewer is looking at", async () => {
    const r = await assignReview({ bookId: BOOK, lessonNo: 12, reviewerId: REVIEWER, assignedBy: OFFICE, callerIsPrincipal: false });
    expect(r.roundNumber).toBe(1);
    expect(r.status).toBe("ASSIGNED");
    // Without the snapshot, a re-merge mid-review silently changes the thing under review.
    expect(r.artifactPatchId).toBeDefined();
    expect(r.selfReviewed).toBe(false);
  });

  it("refuses a SECOND open round on the same পাঠ (D-#40 pattern)", async () => {
    await assignReview({ bookId: BOOK, lessonNo: 12, reviewerId: REVIEWER, assignedBy: OFFICE, callerIsPrincipal: false });
    await expect(
      assignReview({ bookId: BOOK, lessonNo: 12, reviewerId: SENIOR, assignedBy: OFFICE, callerIsPrincipal: false }),
    ).rejects.toThrow(REVIEW_ERRORS_BN.openRound);
  });

  it("refuses self-review for a non-Principal", async () => {
    await expect(
      assignReview({ bookId: BOOK, lessonNo: 12, reviewerId: AUTHOR, assignedBy: OFFICE, callerIsPrincipal: false }),
    ).rejects.toBeInstanceOf(ReviewRuleError);
  });

  it("ALLOWS the Principal to self-review, and STAMPS it (D-#424)", async () => {
    // The rule's purpose is that a later reader can tell whether a second pair of eyes
    // saw the lesson. A stamp answers that; a refusal answers nothing at all.
    const r = await assignReview({ bookId: BOOK, lessonNo: 12, reviewerId: AUTHOR, assignedBy: AUTHOR, callerIsPrincipal: true });
    expect(r.selfReviewed).toBe(true);
    expect(String(mockEvents[0].summary)).toContain("SELF-REVIEW");
  });

  it("numbers rounds upward across re-reviews", async () => {
    await assignReview({ bookId: BOOK, lessonNo: 12, reviewerId: REVIEWER, assignedBy: OFFICE, callerIsPrincipal: false });
    await submitReview({ bookId: BOOK, lessonNo: 12, reviewerId: REVIEWER, verdict: "CHANGES_REQUESTED", checklist: [] });
    const r2 = await assignReview({ bookId: BOOK, lessonNo: 12, reviewerId: REVIEWER, assignedBy: OFFICE, callerIsPrincipal: false });
    expect(r2.roundNumber).toBe(2);
  });
});

describe("the checklist IS the sign-off", () => {
  beforeEach(async () => {
    await assignReview({ bookId: BOOK, lessonNo: 12, reviewerId: REVIEWER, assignedBy: OFFICE, callerIsPrincipal: false });
  });

  it("passes only when EVERY README §7 item is ticked", async () => {
    const r = await submitReview({ bookId: BOOK, lessonNo: 12, reviewerId: REVIEWER, verdict: "APPROVE", checklist: ALL });
    expect(r.checklistPassed).toBe(true);
  });

  it("a partially-ticked list does NOT pass, even on APPROVE", async () => {
    // Otherwise the checklist is decorative — the failure mode of every checklist that
    // is not mechanically enforced.
    const r = await submitReview({ bookId: BOOK, lessonNo: 12, reviewerId: REVIEWER, verdict: "APPROVE", checklist: ALL.slice(0, 3) });
    expect(r.checklistPassed).toBe(false);
  });

  it("CHANGES_REQUESTED never passes, however complete the list", async () => {
    const r = await submitReview({ bookId: BOOK, lessonNo: 12, reviewerId: REVIEWER, verdict: "CHANGES_REQUESTED", checklist: ALL });
    expect(r.checklistPassed).toBe(false);
  });

  it("refuses a verdict from someone who is not the assigned reviewer", async () => {
    await expect(
      submitReview({ bookId: BOOK, lessonNo: 12, reviewerId: SENIOR, verdict: "APPROVE", checklist: ALL }),
    ).rejects.toThrow(REVIEW_ERRORS_BN.notReviewer);
  });
});

describe("the escalation chain", () => {
  it("anchors to an ITEM, not to the book", async () => {
    const e = await raiseEscalation({
      bookId: BOOK, lessonNo: 12, target: "BLOCK", targetId: "L012-b03",
      subject: "narration provenance", body: "is this hadith well-known enough?", raisedBy: REVIEWER,
    });
    expect(e.target).toBe("BLOCK");
    expect(e.targetId).toBe("L012-b03");
    expect(e.state).toBe("OPEN");
  });

  it("preserves three-plus exchanges in order, with attachments", async () => {
    const att = oid();
    const e = await raiseEscalation({
      bookId: BOOK, lessonNo: 12, target: "IMAGE_SLOT", targetId: "L012-img-01",
      subject: "dress", body: "sleeve length?", raisedBy: REVIEWER, attachments: [att],
    });
    await replyToEscalation({ escalationId: e._id, authorId: SENIOR, body: "acceptable, but check the hem", isSenior: true });
    await replyToEscalation({ escalationId: e._id, authorId: REVIEWER, body: "hem is above the ankle", isSenior: false });
    await replyToEscalation({ escalationId: e._id, authorId: SENIOR, body: "then it passes", isSenior: true });

    const stored = mockEscalations[0];
    const msgs = stored.messages as Array<Record<string, unknown>>;
    expect(msgs).toHaveLength(4);
    expect(msgs.map((m) => m.body)).toEqual([
      "sleeve length?", "acceptable, but check the hem", "hem is above the ankle", "then it passes",
    ]);
    expect((msgs[0].attachments as unknown[])[0]).toBe(att);
  });

  it("a senior reply ANSWERS; a further reply re-OPENS", async () => {
    const e = await raiseEscalation({
      bookId: BOOK, lessonNo: 12, target: "BLOCK", targetId: "b1", subject: "s", body: "b", raisedBy: REVIEWER,
    });
    await replyToEscalation({ escalationId: e._id, authorId: SENIOR, body: "answer", isSenior: true });
    expect(mockEscalations[0].state).toBe("ANSWERED");
    await replyToEscalation({ escalationId: e._id, authorId: REVIEWER, body: "follow-up", isSenior: false });
    expect(mockEscalations[0].state).toBe("OPEN");
  });

  it("refuses a reply to a closed thread", async () => {
    const e = await raiseEscalation({
      bookId: BOOK, lessonNo: 12, target: "BLOCK", targetId: "b1", subject: "s", body: "b", raisedBy: REVIEWER,
    });
    await resolveEscalation({ escalationId: e._id, resolution: "settled", resolvedBy: SENIOR });
    await expect(
      replyToEscalation({ escalationId: e._id, authorId: REVIEWER, body: "more", isSenior: false }),
    ).rejects.toBeInstanceOf(ReviewRuleError);
  });

  it("A RESOLUTION CHANGES NO LESSON FIELD (D-#410)", async () => {
    // The load-bearing rule: the senior writes the ruling; the AUTHOR then submits a
    // patch citing it, through the same validator as any other write. One write path.
    const before = JSON.parse(JSON.stringify(mockLessons[0]));
    const e = await raiseEscalation({
      bookId: BOOK, lessonNo: 12, target: "BLOCK", targetId: "L012-b03",
      subject: "wording", body: "too advanced", raisedBy: REVIEWER,
    });
    await resolveEscalation({ escalationId: e._id, resolution: "simplify to the taught inventory", resolvedBy: SENIOR });
    expect(JSON.parse(JSON.stringify(mockLessons[0]))).toEqual(before);
  });

  it("counts an ANSWERED escalation as still unresolved", async () => {
    const e = await raiseEscalation({
      bookId: BOOK, lessonNo: 12, target: "BLOCK", targetId: "b1", subject: "s", body: "b", raisedBy: REVIEWER,
    });
    await replyToEscalation({ escalationId: e._id, authorId: SENIOR, body: "answer", isSenior: true });
    // Answered is not settled — someone still has to apply the ruling.
    expect(await openEscalations(BOOK, 12)).toHaveLength(1);
  });
});

describe("sign-off", () => {
  async function approvedRound(): Promise<void> {
    await assignReview({ bookId: BOOK, lessonNo: 12, reviewerId: REVIEWER, assignedBy: OFFICE, callerIsPrincipal: false });
    await submitReview({ bookId: BOOK, lessonNo: 12, reviewerId: REVIEWER, verdict: "APPROVE", checklist: ALL });
  }

  it("advances the lesson to CONTENT_APPROVED and records who signed", async () => {
    await approvedRound();
    await signOffLesson({ bookId: BOOK, lessonNo: 12, seniorId: SENIOR });
    expect(mockLessons[0].state).toBe("CONTENT_APPROVED");
    expect(mockLessons[0]["reviewerSignoff.checklistPassed"]).toBe(true);
    expect(String(mockLessons[0]["reviewerSignoff.by"])).toBe(String(SENIOR));
  });

  it("REFUSES while an escalation is unresolved", async () => {
    await approvedRound();
    await raiseEscalation({
      bookId: BOOK, lessonNo: 12, target: "BLOCK", targetId: "b1", subject: "s", body: "b", raisedBy: REVIEWER,
    });
    await expect(signOffLesson({ bookId: BOOK, lessonNo: 12, seniorId: SENIOR }))
      .rejects.toThrow(REVIEW_ERRORS_BN.openEscalation);
    expect(mockLessons[0].state).toBe("CONTENT_DRAFT");
  });

  it("REFUSES on an incomplete checklist", async () => {
    await assignReview({ bookId: BOOK, lessonNo: 12, reviewerId: REVIEWER, assignedBy: OFFICE, callerIsPrincipal: false });
    await submitReview({ bookId: BOOK, lessonNo: 12, reviewerId: REVIEWER, verdict: "APPROVE", checklist: ALL.slice(0, 2) });
    await expect(signOffLesson({ bookId: BOOK, lessonNo: 12, seniorId: SENIOR }))
      .rejects.toThrow(REVIEW_ERRORS_BN.checklistIncomplete);
  });

  it("carries the self-review stamp onto the lesson (D-#424)", async () => {
    await assignReview({ bookId: BOOK, lessonNo: 12, reviewerId: AUTHOR, assignedBy: AUTHOR, callerIsPrincipal: true });
    await submitReview({ bookId: BOOK, lessonNo: 12, reviewerId: AUTHOR, verdict: "APPROVE", checklist: ALL });
    await signOffLesson({ bookId: BOOK, lessonNo: 12, seniorId: AUTHOR });
    expect(mockLessons[0]["reviewerSignoff.selfReviewed"]).toBe(true);
  });
});
