/**
 * Per-item review comments (SB-3b, D-#440).
 *
 * What has to hold: a comment anchors to an ITEM; resolving edits no lesson field;
 * re-resolving is refused rather than silently overwriting who closed it; and — the
 * load-bearing one — **an unresolved comment blocks sign-off**, exactly as an open
 * escalation does. That last rule is the entire reason comments are resolvable at all;
 * without a test it is one `if` away from quietly not being true.
 *
 * DB-free — in-memory stores behind the model mocks (the supportBookReview.test.ts
 * pattern; `mock`-prefixed for jest hoisting).
 */
import { Types } from "mongoose";

interface Row { [k: string]: unknown }
const mockComments: Row[] = [];
const mockEvents: Row[] = [];
const mockRounds: Row[] = [];
const mockEscalations: Row[] = [];
const mockLessons: Row[] = [];
const mockPatches: Row[] = [];

const oid = (): Types.ObjectId => new Types.ObjectId();

function matches(row: Row, q: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(q)) {
    if (v && typeof v === "object" && "$in" in (v as Record<string, unknown>)) {
      if (!(v as { $in: unknown[] }).$in.includes(row[k])) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

function docify(row: Row): Row {
  return Object.assign(row, { save: () => Promise.resolve(row) });
}

jest.mock("../modules/support-book/models/BookItemComment", () => ({
  BookItemComment: {
    find: (q: Record<string, unknown>) => ({
      sort: () => ({ lean: () => Promise.resolve(mockComments.filter((c) => matches(c, q))) }),
    }),
    findById: (id: unknown) => Promise.resolve(
      (() => { const hit = mockComments.find((c) => String(c._id) === String(id)); return hit ? docify(hit) : null; })(),
    ),
    create: (doc: Row) => {
      const c = docify({ _id: oid(), createdAt: new Date(), ...doc });
      mockComments.push(c);
      return Promise.resolve(c);
    },
  },
}));

jest.mock("../modules/support-book/models/BookEvent", () => ({
  writeBookEvent: (e: Row) => { mockEvents.push(e); return Promise.resolve(); },
}));

jest.mock("../modules/support-book/models/BookReviewRound", () => ({
  BookReviewRound: {
    findOne: (q: Record<string, unknown>) => {
      const hit = mockRounds.find((r) => matches(r, q)) ?? null;
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
        limit: () => ({ lean: () => Promise.resolve(mockRounds.filter((r) => matches(r, q)).slice(0, 1)) }),
        lean: () => Promise.resolve(mockRounds.filter((r) => matches(r, q))),
      }),
    }),
    create: (doc: Row) => { const r = docify({ _id: oid(), ...doc }); mockRounds.push(r); return Promise.resolve(r); },
  },
}));

jest.mock("../modules/support-book/models/BookEscalation", () => ({
  BookEscalation: {
    find: (q: Record<string, unknown>) => ({ lean: () => Promise.resolve(mockEscalations.filter((e) => matches(e, q))) }),
    findById: () => Promise.resolve(null),
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

import {
  addComment, resolveComment, openComments, listComments,
  CommentRuleError, COMMENT_ERRORS_BN,
} from "../modules/support-book/services/BookCommentService";
import { signOffLesson, REVIEW_ERRORS_BN } from "../modules/support-book/services/BookReviewService";

const BOOK = "C1-BAN";
const REVIEWER = oid();
const AUTHOR = oid();
const SENIOR = oid();

beforeEach(() => {
  mockComments.length = 0; mockEvents.length = 0; mockRounds.length = 0;
  mockEscalations.length = 0; mockLessons.length = 0; mockPatches.length = 0;
  mockLessons.push({ bookId: BOOK, lessonNo: 12, state: "CONTENT_DRAFT", reviewerSignoff: {} });
});

describe("leaving a note", () => {
  it("anchors to the ITEM, not just the lesson", async () => {
    const c = await addComment({
      bookId: BOOK, lessonNo: 12, target: "BLOCK", targetId: "b-07",
      body: "  এই বাক্যটি পাঠ ৩-এর পুনরাবৃত্তি  ", authorId: REVIEWER,
    });
    expect(c.target).toBe("BLOCK");
    expect(c.targetId).toBe("b-07");
    expect(c.resolved).toBe(false);
    // Trimmed on the way in — trailing whitespace in a note is never meaningful.
    expect(c.body).toBe("এই বাক্যটি পাঠ ৩-এর পুনরাবৃত্তি");
  });

  it("writes to the ITEM's timeline, which is what makes 'why does this read this way' answerable", async () => {
    await addComment({ bookId: BOOK, lessonNo: 12, target: "IMAGE_SLOT", targetId: "L012-img-03", body: "পোশাক ভুল", authorId: REVIEWER });
    const ev = mockEvents.at(-1)!;
    expect(ev.kind).toBe("COMMENT_ADDED");
    expect(ev.targetType).toBe("IMAGE_SLOT");
    expect(ev.targetId).toBe("L012-img-03");
  });

  it("refuses an empty note rather than storing a blank row", async () => {
    await expect(
      addComment({ bookId: BOOK, lessonNo: 12, target: "LESSON", body: "   ", authorId: REVIEWER }),
    ).rejects.toThrow(COMMENT_ERRORS_BN.emptyBody);
    expect(mockComments).toHaveLength(0);
  });

  it("allows a whole-lesson note with no targetId", async () => {
    const c = await addComment({ bookId: BOOK, lessonNo: 12, target: "LESSON", body: "সব ঠিক আছে", authorId: REVIEWER });
    expect(c.targetId).toBeNull();
  });
});

describe("resolving", () => {
  it("stamps who closed it and when, and CHANGES NO LESSON FIELD", async () => {
    const c = await addComment({ bookId: BOOK, lessonNo: 12, target: "BLOCK", targetId: "b-07", body: "ভুল", authorId: REVIEWER });
    const before = JSON.stringify(mockLessons[0]);

    const r = await resolveComment({ commentId: c._id, resolvedBy: AUTHOR, resolutionNote: "প্যাচ p-12-এ ঠিক করা হয়েছে" });

    expect(r.resolved).toBe(true);
    expect(String(r.resolvedBy)).toBe(String(AUTHOR));
    expect(r.resolvedAt).toBeInstanceOf(Date);
    expect(r.resolutionNote).toBe("প্যাচ p-12-এ ঠিক করা হয়েছে");
    // D-#410/#440: the text moves only through a validated patch. Resolving records
    // that the point was handled — it does not handle it.
    expect(JSON.stringify(mockLessons[0])).toBe(before);
  });

  it("refuses a SECOND resolve rather than overwriting who closed it", async () => {
    const c = await addComment({ bookId: BOOK, lessonNo: 12, target: "BLOCK", targetId: "b-07", body: "ভুল", authorId: REVIEWER });
    await resolveComment({ commentId: c._id, resolvedBy: AUTHOR });
    await expect(resolveComment({ commentId: c._id, resolvedBy: SENIOR })).rejects.toThrow(
      COMMENT_ERRORS_BN.alreadyResolved,
    );
    expect(String(mockComments[0].resolvedBy)).toBe(String(AUTHOR));
  });

  it("refuses an unknown id", async () => {
    await expect(resolveComment({ commentId: oid(), resolvedBy: AUTHOR })).rejects.toThrow(
      COMMENT_ERRORS_BN.notFound,
    );
  });

  it("is a CommentRuleError, so it is an expected denial and never pages anyone", async () => {
    await expect(
      addComment({ bookId: BOOK, lessonNo: 12, target: "LESSON", body: "", authorId: REVIEWER }),
    ).rejects.toBeInstanceOf(CommentRuleError);
  });
});

describe("reading", () => {
  it("open-only by default; the rest is history", async () => {
    const a = await addComment({ bookId: BOOK, lessonNo: 12, target: "BLOCK", targetId: "b-1", body: "one", authorId: REVIEWER });
    await addComment({ bookId: BOOK, lessonNo: 12, target: "BLOCK", targetId: "b-2", body: "two", authorId: REVIEWER });
    await resolveComment({ commentId: a._id, resolvedBy: AUTHOR });

    expect(await listComments({ bookId: BOOK, lessonNo: 12 })).toHaveLength(1);
    expect(await listComments({ bookId: BOOK, lessonNo: 12, openOnly: false })).toHaveLength(2);
  });
});

describe("the sign-off gate", () => {
  /** A পাঠ whose review passed the checklist — everything sign-off needs EXCEPT a
   *  clean comment list. */
  function seedPassedReview(): void {
    mockRounds.push({
      _id: oid(), bookId: BOOK, lessonNo: 12, status: "SUBMITTED",
      checklistPassed: true, selfReviewed: false, submittedAt: new Date(),
    });
  }

  it("REFUSES while a comment is unresolved — the whole reason comments are resolvable", async () => {
    seedPassedReview();
    await addComment({ bookId: BOOK, lessonNo: 12, target: "BLOCK", targetId: "b-07", body: "ভুল", authorId: REVIEWER });

    await expect(signOffLesson({ bookId: BOOK, lessonNo: 12, seniorId: SENIOR })).rejects.toThrow(
      REVIEW_ERRORS_BN.openComment,
    );
    expect(mockLessons[0].state).toBe("CONTENT_DRAFT");
  });

  it("passes once the note is resolved", async () => {
    seedPassedReview();
    const c = await addComment({ bookId: BOOK, lessonNo: 12, target: "BLOCK", targetId: "b-07", body: "ভুল", authorId: REVIEWER });
    await resolveComment({ commentId: c._id, resolvedBy: AUTHOR });

    await signOffLesson({ bookId: BOOK, lessonNo: 12, seniorId: SENIOR });
    expect(mockLessons[0].state).toBe("CONTENT_APPROVED");
  });

  it("a note on ANOTHER পাঠ does not block this one", async () => {
    seedPassedReview();
    await addComment({ bookId: BOOK, lessonNo: 13, target: "BLOCK", targetId: "b-01", body: "ভুল", authorId: REVIEWER });

    await signOffLesson({ bookId: BOOK, lessonNo: 12, seniorId: SENIOR });
    expect(mockLessons[0].state).toBe("CONTENT_APPROVED");
  });

  it("openComments returns only this পাঠ's unresolved notes", async () => {
    await addComment({ bookId: BOOK, lessonNo: 12, target: "BLOCK", targetId: "b-1", body: "a", authorId: REVIEWER });
    await addComment({ bookId: BOOK, lessonNo: 13, target: "BLOCK", targetId: "b-2", body: "b", authorId: REVIEWER });
    const open = await openComments(BOOK, 12);
    expect(open).toHaveLength(1);
    expect(open[0].lessonNo).toBe(12);
  });
});
