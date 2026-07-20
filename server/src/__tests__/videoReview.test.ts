/**
 * Video-review tests (owner ask 2026-07-20) — the simple class-video self-review
 * loop on the EXISTING observation permissions.
 *
 * RBAC    — createVideoReview/videoReviewOverview ride observation:upload /
 *           observation:manage (Principal+Office only); the teacher surface rides
 *           observation:review (TEACHER only). No new permission was added.
 * Create  — YouTube-link + date validation; assignee must be an active TEACHER;
 *           starts PENDING; audited.
 * Review  — row-gated to the assigned teacher; NOT_OK requires a comment; OK
 *           clears it; a completed row refuses a second verdict.
 * Overview— per-teacher pending/ok/not-ok counts.
 *
 * DB-free (repo convention): the model + User + audit are mocked.
 */
import mongoose from "mongoose";
import { roleHasPermission, ROLES } from "@scd/shared";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the module under test)
// ---------------------------------------------------------------------------

const mockCreate = jest.fn();
const mockFindById = jest.fn();
const mockFind = jest.fn();
jest.mock("../modules/classroom-observation/models/VideoReviewAssignment", () => {
  const actual = jest.requireActual("../modules/classroom-observation/models/VideoReviewAssignment");
  return {
    VIDEO_REVIEW_STATUSES: actual.VIDEO_REVIEW_STATUSES,
    VideoReviewAssignment: {
      create: (doc: unknown) => mockCreate(doc),
      findById: (id: unknown) => mockFindById(id),
      find: (q: unknown) => mockFind(q),
    },
  };
});

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (e: unknown) => mockWriteAudit(e),
}));

const mockUserFindById = jest.fn();
const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: {
    findById: (id: unknown) => ({ lean: async () => mockUserFindById(id) }),
    find: (q: unknown) => ({ select: () => ({ lean: async () => mockUserFind(q) }) }),
  },
}));

// Import AFTER mocks
import {
  createVideoReview,
  myVideoReviews,
  reviewVideo,
  videoReviewOverview,
} from "../modules/classroom-observation/services/VideoReviewService";

const TEACHER_ID = oid();
const OFFICE_ID = oid();

const validInput = () => ({
  youtubeUrl: "https://www.youtube.com/watch?v=abc123",
  classDate: "2026-07-20",
  timeLabel: "৩য় পিরিয়ড 09:40–10:15",
  classLabel: "Class 3",
  room: "Room 2",
  teacherId: TEACHER_ID.toString(),
  actorId: OFFICE_ID.toString(),
  actorRole: "OFFICE",
});

const madeDoc = (over: Record<string, unknown> = {}) => ({
  _id: oid(),
  youtubeUrl: "https://youtu.be/abc",
  classDate: "2026-07-20",
  timeLabel: "t",
  classLabel: "c",
  room: "r",
  teacherId: TEACHER_ID,
  status: "PENDING",
  comment: null,
  reviewedAt: null,
  active: true,
  createdAt: new Date(),
  save: jest.fn(async () => undefined),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUserFindById.mockReturnValue({ _id: TEACHER_ID, role: "TEACHER", active: true, name: "T" });
  mockCreate.mockImplementation(async (doc: Record<string, unknown>) => madeDoc(doc));
  mockUserFind.mockReturnValue([{ _id: TEACHER_ID, name: "T" }]);
});

// ---------------------------------------------------------------------------
// RBAC — no new permission: the loop rides the observation perms exactly
// ---------------------------------------------------------------------------

describe("RBAC — rides the existing observation permissions", () => {
  test("observation:upload + observation:manage = Principal/Office only", () => {
    for (const perm of ["observation:upload", "observation:manage"] as const) {
      const holders = ROLES.filter((r) => roleHasPermission(r, perm));
      expect(holders.sort()).toEqual(["OFFICE", "PRINCIPAL"]);
    }
  });
  test("observation:review = TEACHER only (guardian never)", () => {
    const holders = ROLES.filter((r) => roleHasPermission(r, "observation:review"));
    expect(holders).toEqual(["TEACHER"]);
  });
});

// ---------------------------------------------------------------------------
// createVideoReview
// ---------------------------------------------------------------------------

describe("createVideoReview", () => {
  test("rejects a non-YouTube link", async () => {
    await expect(
      createVideoReview({ ...validInput(), youtubeUrl: "https://vimeo.com/123" }),
    ).rejects.toThrow(/ইউটিউব/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("accepts watch, short and youtu.be links", async () => {
    for (const url of [
      "https://www.youtube.com/watch?v=x1",
      "https://youtube.com/shorts/x2",
      "https://youtu.be/x3",
    ]) {
      await expect(createVideoReview({ ...validInput(), youtubeUrl: url })).resolves.toBeTruthy();
    }
  });

  test("rejects a malformed date", async () => {
    await expect(
      createVideoReview({ ...validInput(), classDate: "20-07-2026" }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  test("assignee must be an active TEACHER", async () => {
    mockUserFindById.mockReturnValue({ _id: TEACHER_ID, role: "OFFICE", active: true });
    await expect(createVideoReview(validInput())).rejects.toThrow(/শিক্ষক/);
    mockUserFindById.mockReturnValue(null);
    await expect(createVideoReview(validInput())).rejects.toThrow(/শিক্ষক/);
  });

  test("creates PENDING and audits", async () => {
    const out = await createVideoReview(validInput());
    expect(out.status).toBe("PENDING");
    expect(out.teacherName).toBe("T");
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ status: "PENDING" }));
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "VIDEO_REVIEW_ASSIGNED" }),
    );
  });
});

// ---------------------------------------------------------------------------
// reviewVideo — row gate + verdicts
// ---------------------------------------------------------------------------

describe("reviewVideo", () => {
  test("only the assigned teacher may review", async () => {
    mockFindById.mockResolvedValue(madeDoc());
    await expect(
      reviewVideo({ id: "x", ok: true, actorId: oid().toString() }),
    ).rejects.toThrow(/নির্ধারিত শিক্ষক/);
  });

  test("NOT_OK without a comment is rejected", async () => {
    mockFindById.mockResolvedValue(madeDoc());
    await expect(
      reviewVideo({ id: "x", ok: false, comment: "  ", actorId: TEACHER_ID.toString() }),
    ).rejects.toThrow(/মন্তব্য/);
  });

  test("OK closes the row, clears the comment and stamps reviewedAt", async () => {
    const doc = madeDoc();
    mockFindById.mockResolvedValue(doc);
    const out = await reviewVideo({ id: "x", ok: true, comment: "ignored", actorId: TEACHER_ID.toString() });
    expect(out.status).toBe("OK");
    expect(out.comment).toBeNull();
    expect(out.reviewedAt).toBeTruthy();
    expect(doc.save).toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "VIDEO_REVIEW_REVIEWED" }),
    );
  });

  test("NOT_OK stores the comment", async () => {
    mockFindById.mockResolvedValue(madeDoc());
    const out = await reviewVideo({
      id: "x",
      ok: false,
      comment: "শব্দ শোনা যায় না",
      actorId: TEACHER_ID.toString(),
    });
    expect(out.status).toBe("NOT_OK");
    expect(out.comment).toBe("শব্দ শোনা যায় না");
  });

  test("a completed row refuses a second verdict", async () => {
    mockFindById.mockResolvedValue(madeDoc({ status: "OK" }));
    await expect(
      reviewVideo({ id: "x", ok: false, comment: "c", actorId: TEACHER_ID.toString() }),
    ).rejects.toThrow(/আগেই সম্পন্ন/);
  });
});

// ---------------------------------------------------------------------------
// Lists + overview
// ---------------------------------------------------------------------------

describe("myVideoReviews / videoReviewOverview", () => {
  test("teacher list sorts PENDING first, newest date first", async () => {
    mockFind.mockReturnValue({
      lean: async () => [
        madeDoc({ status: "OK", classDate: "2026-07-19" }),
        madeDoc({ status: "PENDING", classDate: "2026-07-10" }),
        madeDoc({ status: "PENDING", classDate: "2026-07-18" }),
      ],
    });
    const rows = await myVideoReviews(TEACHER_ID.toString());
    expect(rows.map((r) => r.status)).toEqual(["PENDING", "PENDING", "OK"]);
    expect(rows[0].classDate).toBe("2026-07-18");
  });

  test("overview counts pending/ok/not-ok per teacher", async () => {
    const t2 = oid();
    mockUserFind.mockReturnValue([
      { _id: TEACHER_ID, name: "T1" },
      { _id: t2, name: "T2" },
    ]);
    mockFind.mockReturnValue({
      lean: async () => [
        madeDoc({ status: "PENDING" }),
        madeDoc({ status: "PENDING" }),
        madeDoc({ status: "NOT_OK", comment: "c" }),
        madeDoc({ teacherId: t2, status: "OK" }),
      ],
    });
    const { rows, summary } = await videoReviewOverview();
    expect(rows).toHaveLength(4);
    expect(rows[0].teacherName).toBe("T1");
    const t1 = summary.find((s) => s.teacherId === TEACHER_ID.toString())!;
    expect({ pending: t1.pending, ok: t1.ok, notOk: t1.notOk }).toEqual({ pending: 2, ok: 0, notOk: 1 });
    // Most pending first — the teachers the office should nudge.
    expect(summary[0].teacherId).toBe(TEACHER_ID.toString());
  });
});
