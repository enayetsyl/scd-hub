/**
 * Teaching-note comment tests (TN-2, prd-teaching-notes, D-#520/#522).
 *
 * ANCHOR   — the load-bearing one: a comment is queried by DOCUMENT IDENTITY,
 *            so the thread survives a replacement and passing v1's OR v2's id
 *            returns the same comments. A comment written on v1 reports
 *            staleForCurrentVersion once v2 is current.
 * MULTI    — many comments per teacher and many teachers per note, on one file.
 * STATUS   — OPEN by default; the note's uploader or P/O may close it; a plain
 *            teacher may NOT close their own loop; reopening clears the closure.
 * DELETE   — soft (deletedAt), author or P/O, and excluded from reads after.
 * SCOPE    — commenting requires READ access to the note's (class × subject).
 * COUNTS   — the library badge counts total + open per identity.
 *
 * DB-free (repo convention): models + audit + scope resolution are mocked.
 */
import mongoose from "mongoose";
import type { AppContext } from "../context";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the module under test)
// ---------------------------------------------------------------------------

/** A tiny in-memory comment store so the anchor semantics are really exercised. */
interface Row {
  _id: mongoose.Types.ObjectId;
  classLevel: number;
  subject: string;
  kind: string;
  seq: number;
  noteId: mongoose.Types.ObjectId;
  versionSeen: number;
  bodyBn: string;
  anchor: string | null;
  authorId: mongoose.Types.ObjectId;
  status: string;
  addressedBy: mongoose.Types.ObjectId | null;
  addressedAt: Date | null;
  addressedNote: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  save: () => Promise<void>;
}
let store: Row[] = [];

const matches = (r: Row, q: Record<string, unknown>): boolean => {
  for (const [k, v] of Object.entries(q)) {
    if (k === "$or") {
      const ors = v as Array<Record<string, unknown>>;
      if (!ors.some((o) => matches(r, o))) return false;
      continue;
    }
    const rv = (r as unknown as Record<string, unknown>)[k];
    if (v === null) {
      if (rv !== null && rv !== undefined) return false;
    } else if (rv !== v) {
      return false;
    }
  }
  return true;
};

jest.mock("../modules/teaching-notes/models/TeachingNoteComment", () => {
  const actual = jest.requireActual("../modules/teaching-notes/models/TeachingNoteComment");
  return {
    ...actual,
    TeachingNoteComment: {
      create: async (d: Record<string, unknown>) => {
        const row = {
          _id: new mongoose.Types.ObjectId(),
          anchor: null,
          addressedBy: null,
          addressedAt: null,
          addressedNote: null,
          deletedAt: null,
          createdAt: new Date(Date.now() + store.length),
          ...d,
          save: async () => undefined,
        } as unknown as Row;
        store.push(row);
        return row;
      },
      find: (q: Record<string, unknown>) => ({
        select: () => ({ lean: async () => store.filter((r) => matches(r, q)) }),
        lean: async () => store.filter((r) => matches(r, q)),
      }),
      findById: async (id: unknown) => store.find((r) => r._id.toString() === String(id)) ?? null,
    },
  };
});

const mockNoteFindById = jest.fn();
const mockNoteFindOne = jest.fn();
const mockNoteFind = jest.fn();
jest.mock("../modules/teaching-notes/models/TeachingNote", () => {
  const actual = jest.requireActual("../modules/teaching-notes/models/TeachingNote");
  return {
    ...actual,
    TeachingNote: {
      findById: (id: unknown) => ({
        select: () => ({ lean: async () => mockNoteFindById(id) }),
        lean: async () => mockNoteFindById(id),
      }),
      findOne: (q: unknown) => ({
        select: () => ({ lean: async () => mockNoteFindOne(q) }),
        lean: async () => mockNoteFindOne(q),
      }),
      find: (q: unknown) => ({
        select: () => ({ lean: async () => mockNoteFind(q) }),
        lean: async () => mockNoteFind(q),
      }),
    },
  };
});

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (e: unknown) => mockWriteAudit(e),
}));

// TN-3 emitters are best-effort and reach User/Class/RoutineSlot; mocked so this
// DB-free suite never touches an unconnected model. Recipient selection has its
// own assertions below.
const mockEmitComment = jest.fn();
const mockEmitAddressed = jest.fn();
jest.mock("../modules/notifications/services/emitters", () => ({
  emitTeachingNoteComment: (e: unknown) => mockEmitComment(e),
  emitTeachingNoteCommentAddressed: (e: unknown) => mockEmitAddressed(e),
}));

const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: {
    find: (q: unknown) => ({ select: () => ({ lean: async () => mockUserFind(q) }) }),
  },
}));

const mockVisibility = jest.fn();
jest.mock("../modules/teaching-notes/services/TeachingNoteService", () => {
  const actual = jest.requireActual("../modules/teaching-notes/services/TeachingNoteService");
  return {
    ...actual,
    teachingNoteVisibility: (ctx: unknown) => mockVisibility(ctx),
  };
});

// Import AFTER mocks
import { ForbiddenError } from "../middleware/authz";
import {
  teachingNoteComments,
  openTeachingNoteComments,
  addTeachingNoteComment,
  setTeachingNoteCommentStatus,
  deleteTeachingNoteComment,
  addressTeachingNoteComments,
  commentCountsForIdentities,
} from "../modules/teaching-notes/services/TeachingNoteCommentService";
import { pairKey } from "../modules/teaching-notes/services/TeachingNoteService";

const OFFICE_ID = oid();
const T1_ID = oid();
const T2_ID = oid();
const V1_ID = oid();
const V2_ID = oid();

const IDENTITY = { classLevel: 5, subject: "BAN", kind: "ANSWER_GUIDE", seq: 1 };

const v1 = {
  _id: V1_ID,
  ...IDENTITY,
  title: "Class 5 Bangla — answer structure",
  version: 1,
  uploadedBy: OFFICE_ID,
  replacedAt: null,
};
const v2 = { ...v1, _id: V2_ID, version: 2, title: "Class 5 Bangla — answer structure" };

const ctxOf = (role: string, userId: mongoose.Types.ObjectId) =>
  ({ auth: { userId: userId.toString(), role } }) as unknown as AppContext;

/** Point the note lookups at a given "current" version. */
function setCurrent(current: typeof v1): void {
  mockNoteFindOne.mockImplementation(() => current);
  mockNoteFind.mockImplementation(() => [current]);
}

beforeEach(() => {
  jest.clearAllMocks();
  store = [];
  mockVisibility.mockResolvedValue(null); // unrestricted unless a test narrows it
  mockUserFind.mockImplementation((q: { _id: { $in: string[] } }) =>
    q._id.$in.map((id) => ({
      _id: id,
      name:
        id === T1_ID.toString()
          ? "Teacher One"
          : id === T2_ID.toString()
            ? "Teacher Two"
            : "Office",
    })),
  );
  mockNoteFindById.mockImplementation((id: unknown) =>
    String(id) === V2_ID.toString() ? v2 : String(id) === V1_ID.toString() ? v1 : null,
  );
  setCurrent(v1);
});

// ---------------------------------------------------------------------------
// The anchor (D-#522)
// ---------------------------------------------------------------------------

describe("the anchor survives replacement", () => {
  test("a comment written on v1 is still on the note after v2 replaces it", async () => {
    await addTeachingNoteComment(ctxOf("TEACHER", T1_ID), {
      noteId: V1_ID.toString(),
      bodyBn: "টাইপ ৩-এ উদাহরণ কম",
    });

    // v2 lands and becomes current.
    setCurrent(v2);

    // Reading through the NEW version's id returns the old comment.
    const thread = await teachingNoteComments(ctxOf("TEACHER", T1_ID), V2_ID.toString());
    expect(thread).toHaveLength(1);
    expect(thread[0].bodyBn).toBe("টাইপ ৩-এ উদাহরণ কম");
    // ...and it is flagged as written against an older version.
    expect(thread[0].versionSeen).toBe(1);
    expect(thread[0].currentVersion).toBe(2);
    expect(thread[0].staleForCurrentVersion).toBe(true);
  });

  test("either version's id returns the SAME thread", async () => {
    await addTeachingNoteComment(ctxOf("TEACHER", T1_ID), {
      noteId: V1_ID.toString(),
      bodyBn: "এক",
    });
    setCurrent(v2);
    const viaV1 = await teachingNoteComments(ctxOf("TEACHER", T1_ID), V1_ID.toString());
    const viaV2 = await teachingNoteComments(ctxOf("TEACHER", T1_ID), V2_ID.toString());
    expect(viaV1.map((c) => c.id)).toEqual(viaV2.map((c) => c.id));
  });

  test("a comment on the CURRENT version is not stale", async () => {
    await addTeachingNoteComment(ctxOf("TEACHER", T1_ID), {
      noteId: V1_ID.toString(),
      bodyBn: "ঠিক আছে",
    });
    const thread = await teachingNoteComments(ctxOf("TEACHER", T1_ID), V1_ID.toString());
    expect(thread[0].staleForCurrentVersion).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Many comments, many teachers (the owner's explicit ask)
// ---------------------------------------------------------------------------

describe("multiple comments and commenters", () => {
  test("one teacher may comment repeatedly and several teachers on one note", async () => {
    await addTeachingNoteComment(ctxOf("TEACHER", T1_ID), { noteId: V1_ID.toString(), bodyBn: "এক" });
    await addTeachingNoteComment(ctxOf("TEACHER", T1_ID), { noteId: V1_ID.toString(), bodyBn: "দুই" });
    await addTeachingNoteComment(ctxOf("TEACHER", T2_ID), { noteId: V1_ID.toString(), bodyBn: "তিন" });

    const thread = await teachingNoteComments(ctxOf("PRINCIPAL", OFFICE_ID), V1_ID.toString());
    expect(thread.map((c) => c.bodyBn)).toEqual(["এক", "দুই", "তিন"]);
    expect(thread.map((c) => c.authorName)).toEqual(["Teacher One", "Teacher One", "Teacher Two"]);
  });

  test("an optional anchor names the part of the note", async () => {
    const c = await addTeachingNoteComment(ctxOf("TEACHER", T1_ID), {
      noteId: V1_ID.toString(),
      bodyBn: "উদাহরণ যোগ করুন",
      anchor: "Type 5 — তুলনা / পার্থক্য",
    });
    expect(c.anchor).toBe("Type 5 — তুলনা / পার্থক্য");
  });

  test("an empty body is refused and a mojibake body is refused", async () => {
    await expect(
      addTeachingNoteComment(ctxOf("TEACHER", T1_ID), { noteId: V1_ID.toString(), bodyBn: "  " }),
    ).rejects.toThrow("মন্তব্য লিখুন");
    await expect(
      addTeachingNoteComment(ctxOf("TEACHER", T1_ID), {
        noteId: V1_ID.toString(),
        bodyBn: "à¦à¦¦à¦¾à¦¹à¦°à¦£",
      }),
    ).rejects.toThrow(/এনকোডিং/);
    expect(store).toHaveLength(0);
  });

  test("a new comment notifies the uploader + Principal, never its own author", async () => {
    const c = await addTeachingNoteComment(ctxOf("TEACHER", T1_ID), {
      noteId: V1_ID.toString(),
      bodyBn: "এক",
    });
    expect(mockEmitComment).toHaveBeenCalledWith(
      expect.objectContaining({
        commentId: expect.anything(),
        authorId: expect.anything(),
        authorName: "Teacher One",
        subjectLabel: "বাংলা",
      }),
    );
    // The emitter itself drops the author; the event carries them so it can.
    expect(mockEmitComment.mock.calls[0][0].authorId.toString()).toBe(T1_ID.toString());
    expect(c.status).toBe("OPEN");
  });

  test("closing a comment notifies its author; reopening says nothing", async () => {
    const c = await addTeachingNoteComment(ctxOf("TEACHER", T1_ID), {
      noteId: V1_ID.toString(),
      bodyBn: "এক",
    });
    await setTeachingNoteCommentStatus(ctxOf("PRINCIPAL", OFFICE_ID), {
      commentId: c.id,
      status: "ADDRESSED",
    });
    expect(mockEmitAddressed).toHaveBeenCalledTimes(1);
    expect(mockEmitAddressed.mock.calls[0][0].authorId.toString()).toBe(T1_ID.toString());

    mockEmitAddressed.mockClear();
    await setTeachingNoteCommentStatus(ctxOf("PRINCIPAL", OFFICE_ID), {
      commentId: c.id,
      status: "OPEN",
    });
    expect(mockEmitAddressed).not.toHaveBeenCalled();
  });

  test("commenting is audited", async () => {
    await addTeachingNoteComment(ctxOf("TEACHER", T1_ID), { noteId: V1_ID.toString(), bodyBn: "এক" });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "TEACHING_NOTE_COMMENTED" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

describe("scope", () => {
  test("a teacher outside the note's (class × subject) cannot read or comment", async () => {
    mockVisibility.mockResolvedValue(new Set([pairKey(3, "MATH")]));
    await expect(
      teachingNoteComments(ctxOf("TEACHER", T1_ID), V1_ID.toString()),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      addTeachingNoteComment(ctxOf("TEACHER", T1_ID), { noteId: V1_ID.toString(), bodyBn: "এক" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("a teacher inside the pair may comment", async () => {
    mockVisibility.mockResolvedValue(new Set([pairKey(5, "BAN")]));
    const c = await addTeachingNoteComment(ctxOf("TEACHER", T1_ID), {
      noteId: V1_ID.toString(),
      bodyBn: "এক",
    });
    expect(c.status).toBe("OPEN");
  });
});

// ---------------------------------------------------------------------------
// Status (D-#520)
// ---------------------------------------------------------------------------

describe("status", () => {
  test("a new comment is OPEN", async () => {
    const c = await addTeachingNoteComment(ctxOf("TEACHER", T1_ID), {
      noteId: V1_ID.toString(),
      bodyBn: "এক",
    });
    expect(c.status).toBe("OPEN");
  });

  test("the AUTHOR cannot close their own feedback loop", async () => {
    const c = await addTeachingNoteComment(ctxOf("TEACHER", T1_ID), {
      noteId: V1_ID.toString(),
      bodyBn: "এক",
    });
    await expect(
      setTeachingNoteCommentStatus(ctxOf("TEACHER", T1_ID), {
        commentId: c.id,
        status: "ADDRESSED",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("the note's UPLOADER may close it, with a note, and it is audited", async () => {
    const c = await addTeachingNoteComment(ctxOf("TEACHER", T1_ID), {
      noteId: V1_ID.toString(),
      bodyBn: "এক",
    });
    const closed = await setTeachingNoteCommentStatus(ctxOf("TEACHER", OFFICE_ID), {
      commentId: c.id,
      status: "ADDRESSED",
      addressedNote: "v২-তে ঠিক করা হয়েছে",
    });
    expect(closed.status).toBe("ADDRESSED");
    expect(closed.addressedNote).toBe("v২-তে ঠিক করা হয়েছে");
    expect(closed.addressedByName).toBe("Office");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "TEACHING_NOTE_COMMENT_ADDRESSED" }),
    );
  });

  test("reopening clears the closure — no stale 'fixed in v3' on an open comment", async () => {
    const c = await addTeachingNoteComment(ctxOf("TEACHER", T1_ID), {
      noteId: V1_ID.toString(),
      bodyBn: "এক",
    });
    await setTeachingNoteCommentStatus(ctxOf("PRINCIPAL", OFFICE_ID), {
      commentId: c.id,
      status: "ADDRESSED",
      addressedNote: "done",
    });
    const reopened = await setTeachingNoteCommentStatus(ctxOf("PRINCIPAL", OFFICE_ID), {
      commentId: c.id,
      status: "OPEN",
    });
    expect(reopened.status).toBe("OPEN");
    expect(reopened.addressedNote).toBeNull();
    expect(reopened.addressedAt).toBeNull();
    expect(reopened.addressedByName).toBeNull();
  });

  test("an unknown status is refused", async () => {
    const c = await addTeachingNoteComment(ctxOf("TEACHER", T1_ID), {
      noteId: V1_ID.toString(),
      bodyBn: "এক",
    });
    await expect(
      setTeachingNoteCommentStatus(ctxOf("PRINCIPAL", OFFICE_ID), {
        commentId: c.id,
        status: "MAYBE",
      }),
    ).rejects.toThrow("অবস্থা সঠিক নয়");
  });

  test("bulk-address closes several at once", async () => {
    const a = await addTeachingNoteComment(ctxOf("TEACHER", T1_ID), {
      noteId: V1_ID.toString(),
      bodyBn: "এক",
    });
    const b = await addTeachingNoteComment(ctxOf("TEACHER", T2_ID), {
      noteId: V1_ID.toString(),
      bodyBn: "দুই",
    });
    const n = await addressTeachingNoteComments(ctxOf("PRINCIPAL", OFFICE_ID), {
      commentIds: [a.id, b.id, a.id], // duplicate is de-duped
      addressedNote: "v২",
    });
    expect(n).toBe(2);
    expect(store.every((r) => r.status === "ADDRESSED")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The Principal's outstanding list
// ---------------------------------------------------------------------------

describe("outstanding list", () => {
  test("lists only OPEN comments and needs roster:manage", async () => {
    const a = await addTeachingNoteComment(ctxOf("TEACHER", T1_ID), {
      noteId: V1_ID.toString(),
      bodyBn: "খোলা",
    });
    const b = await addTeachingNoteComment(ctxOf("TEACHER", T2_ID), {
      noteId: V1_ID.toString(),
      bodyBn: "বন্ধ",
    });
    await setTeachingNoteCommentStatus(ctxOf("PRINCIPAL", OFFICE_ID), {
      commentId: b.id,
      status: "ADDRESSED",
    });

    const open = await openTeachingNoteComments(ctxOf("PRINCIPAL", OFFICE_ID));
    expect(open.map((c) => c.id)).toEqual([a.id]);
    // The row carries what the Principal needs to find the file.
    expect(open[0].noteTitle).toBe("Class 5 Bangla — answer structure");
    expect(open[0].subject).toBe("BAN");
    expect(open[0].classLevel).toBe(5);

    await expect(openTeachingNoteComments(ctxOf("TEACHER", T1_ID))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

// ---------------------------------------------------------------------------
// Delete + counts
// ---------------------------------------------------------------------------

describe("delete and counts", () => {
  test("the author may soft-delete their own; it leaves the read but keeps the row", async () => {
    const c = await addTeachingNoteComment(ctxOf("TEACHER", T1_ID), {
      noteId: V1_ID.toString(),
      bodyBn: "এক",
    });
    await deleteTeachingNoteComment(ctxOf("TEACHER", T1_ID), c.id);
    const thread = await teachingNoteComments(ctxOf("PRINCIPAL", OFFICE_ID), V1_ID.toString());
    expect(thread).toHaveLength(0);
    expect(store).toHaveLength(1); // retained, not dropped
    expect(store[0].deletedAt).toBeInstanceOf(Date);
  });

  test("another teacher may NOT delete someone else's comment", async () => {
    const c = await addTeachingNoteComment(ctxOf("TEACHER", T1_ID), {
      noteId: V1_ID.toString(),
      bodyBn: "এক",
    });
    await expect(
      deleteTeachingNoteComment(ctxOf("TEACHER", T2_ID), c.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("counts report total and open per identity", async () => {
    await addTeachingNoteComment(ctxOf("TEACHER", T1_ID), { noteId: V1_ID.toString(), bodyBn: "এক" });
    const b = await addTeachingNoteComment(ctxOf("TEACHER", T2_ID), {
      noteId: V1_ID.toString(),
      bodyBn: "দুই",
    });
    await setTeachingNoteCommentStatus(ctxOf("PRINCIPAL", OFFICE_ID), {
      commentId: b.id,
      status: "ADDRESSED",
    });
    const counts = await commentCountsForIdentities([IDENTITY]);
    expect(counts.get("5:BAN:ANSWER_GUIDE:1")).toEqual({ total: 2, open: 1 });
  });

  test("a deleted comment leaves the counts", async () => {
    const c = await addTeachingNoteComment(ctxOf("TEACHER", T1_ID), {
      noteId: V1_ID.toString(),
      bodyBn: "এক",
    });
    await deleteTeachingNoteComment(ctxOf("PRINCIPAL", OFFICE_ID), c.id);
    const counts = await commentCountsForIdentities([IDENTITY]);
    expect(counts.get("5:BAN:ANSWER_GUIDE:1")).toBeUndefined();
  });
});
