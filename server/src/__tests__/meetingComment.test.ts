/**
 * Meeting Comments CM-5 tests (prd-comments-meetings §3/§6/§8, J-CM6/J-CM7/J-CM8, D-#124).
 *
 * Pure      — rollupByType (per-type counts over ALL COMMENT_TYPES, zeros included).
 * Service   — saveMeetingComment (upsert + audit; both-empty rejected; meeting-not-found);
 *             studentCommentTimeline (chronological notes + rollup since the last meeting);
 *             meetingComparison (current + prior + rollup since the previous meeting);
 *             childComments (DELIVERED only + guardian shape structurally omits staff fields,
 *             J-CM8); childMeetingSlot (guardian shape omits familyKey/studentIds/remark).
 * RBAC      — J-CM6: assertIsClassTeacher denies a non-class-teacher (Office/Principal);
 *             the reps gate composes tracker:read OR roster:manage; guardian:read_child.
 *
 * DB-free (the repo convention): models + audit are mocked.
 */
import mongoose from "mongoose";
import { roleHasPermission, COMMENT_TYPES } from "@scd/shared";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the modules under test)
// ---------------------------------------------------------------------------

const chain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.lean = async () => val;
  o.exec = async () => val;
  return o;
};

const mockMCFind = jest.fn();
const mockMCUpsert = jest.fn();
jest.mock("../modules/comments/models/MeetingComment", () => ({
  MeetingComment: {
    find: (q: unknown) => mockMCFind(q),
    findOneAndUpdate: (q: unknown, u: unknown, o: unknown) => mockMCUpsert(q, u, o),
  },
}));

const mockSCFind = jest.fn();
jest.mock("../modules/comments/models/StudentComment", () => ({
  StudentComment: { find: (q: unknown) => mockSCFind(q) },
}));

const mockPMFindById = jest.fn();
const mockPMFind = jest.fn();
const mockPMFindOne = jest.fn();
jest.mock("../modules/comments/models/ParentMeeting", () => ({
  ParentMeeting: {
    findById: (id: unknown) => mockPMFindById(id),
    find: (q: unknown) => mockPMFind(q),
    findOne: (q: unknown) => mockPMFindOne(q),
  },
}));

const mockSlotFindOne = jest.fn();
jest.mock("../modules/comments/models/ParentMeetingSlot", () => ({
  ParentMeetingSlot: { findOne: (q: unknown) => mockSlotFindOne(q) },
}));

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (e: unknown) => mockWriteAudit(e),
}));

// assertIsClassTeacher reads only the Section model — mock it for the J-CM6 deny test.
const mockSectionFindById = jest.fn();
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { findById: (id: unknown) => mockSectionFindById(id) },
}));

// Import AFTER mocks
import {
  rollupByType,
  saveMeetingComment,
  studentCommentTimeline,
  meetingComparison,
  childComments,
  childMeetingSlot,
  MeetingCommentError,
} from "../modules/comments/services/MeetingCommentService";
import { assertIsClassTeacher, ForbiddenError } from "../middleware/authz";
import type { AppContext } from "../context";

const STUDENT = oid();
const M1 = oid(); // earlier meeting
const M2 = oid(); // later meeting
const D1 = new Date("2026-03-01T00:00:00Z");
const D2 = new Date("2026-07-01T00:00:00Z");
const TEACHER = oid().toString();

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteAudit.mockResolvedValue(undefined);
});

// ===========================================================================
// Pure: rollupByType (J-CM7)
// ===========================================================================

describe("rollupByType", () => {
  test("counts per type over ALL COMMENT_TYPES (zeros included)", () => {
    const r = rollupByType(["STUDY_HOMEWORK", "STUDY_HOMEWORK", "BEHAVIOUR", "BEHAVIOUR", "BEHAVIOUR"]);
    expect(r).toHaveLength(COMMENT_TYPES.length);
    const byType = Object.fromEntries(r.map((x) => [x.type, x.count]));
    expect(byType.STUDY_HOMEWORK).toBe(2);
    expect(byType.BEHAVIOUR).toBe(3);
    expect(byType.GENERAL).toBe(0);
  });
});

// ===========================================================================
// saveMeetingComment (upsert one per student × meeting)
// ===========================================================================

describe("saveMeetingComment", () => {
  test("upserts the note + audits MEETING_COMMENT_SAVED", async () => {
    mockPMFindById.mockReturnValue(chain({ instanceLabel: "2026 — 1st", meetingDate: D2 }));
    mockMCUpsert.mockResolvedValue({
      _id: oid(),
      meetingId: M2,
      studentId: STUDENT,
      authorUserId: new mongoose.Types.ObjectId(TEACHER),
      positiveText: "Reads well",
      concernText: "Talks in class",
      createdAt: D2,
      updatedAt: D2,
    });
    const res = await saveMeetingComment({
      meetingId: M2.toString(),
      studentId: STUDENT.toString(),
      positiveText: "Reads well",
      concernText: "Talks in class",
      actorId: TEACHER,
    });
    expect(res).toMatchObject({ positiveText: "Reads well", concernText: "Talks in class", instanceLabel: "2026 — 1st" });
    // upsert true
    expect(mockMCUpsert).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ upsert: true, new: true }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "MEETING_COMMENT_SAVED", targetKind: "MeetingComment" }),
    );
  });

  test("rejects a note with neither positive nor concern text", async () => {
    mockPMFindById.mockReturnValue(chain({ instanceLabel: "x", meetingDate: D2 }));
    await expect(
      saveMeetingComment({ meetingId: M2.toString(), studentId: STUDENT.toString(), positiveText: "  ", concernText: "", actorId: TEACHER }),
    ).rejects.toThrow(/positive or a concern/);
    expect(mockMCUpsert).not.toHaveBeenCalled();
  });

  test("rejects a missing meeting", async () => {
    mockPMFindById.mockReturnValue(chain(null));
    await expect(
      saveMeetingComment({ meetingId: M2.toString(), studentId: STUDENT.toString(), positiveText: "x", actorId: TEACHER }),
    ).rejects.toBeInstanceOf(MeetingCommentError);
  });
});

// ===========================================================================
// J-CM6 — only the section's class teacher may save (Office/Principal denied)
// ===========================================================================

describe("J-CM6 (saveMeetingComment is class-teacher-only)", () => {
  const ctxOf = (userId: string, role = "TEACHER"): AppContext =>
    ({ auth: { userId, role } } as unknown as AppContext);
  const SECTION = oid().toString();

  test("the section's class teacher passes assertIsClassTeacher", async () => {
    mockSectionFindById.mockReturnValue(chain({ classTeacherId: new mongoose.Types.ObjectId(TEACHER) }));
    await expect(assertIsClassTeacher(ctxOf(TEACHER), SECTION)).resolves.toBeUndefined();
  });

  test("a different teacher is denied", async () => {
    mockSectionFindById.mockReturnValue(chain({ classTeacherId: new mongoose.Types.ObjectId(TEACHER) }));
    await expect(assertIsClassTeacher(ctxOf(oid().toString()), SECTION)).rejects.toThrow(ForbiddenError);
  });

  test("Office/Principal (not the class teacher) are denied", async () => {
    mockSectionFindById.mockReturnValue(chain({ classTeacherId: new mongoose.Types.ObjectId(TEACHER) }));
    await expect(assertIsClassTeacher(ctxOf(oid().toString(), "OFFICE"), SECTION)).rejects.toThrow(ForbiddenError);
    await expect(assertIsClassTeacher(ctxOf(oid().toString(), "PRINCIPAL"), SECTION)).rejects.toThrow(ForbiddenError);
  });
});

// ===========================================================================
// studentCommentTimeline (J-CM7)
// ===========================================================================

const note = (meetingId: mongoose.Types.ObjectId) => ({
  _id: oid(),
  meetingId,
  studentId: STUDENT,
  authorUserId: new mongoose.Types.ObjectId(TEACHER),
  positiveText: "p",
  concernText: "c",
  createdAt: D1,
  updatedAt: D1,
});

describe("studentCommentTimeline", () => {
  test("returns prior notes chronological + rollup since the last meeting", async () => {
    // notes returned out of order; service sorts by meeting date
    mockMCFind.mockReturnValue(chain([note(M2), note(M1)]));
    mockPMFind.mockReturnValue(
      chain([
        { _id: M1, instanceLabel: "2026 — 1st", meetingDate: D1 },
        { _id: M2, instanceLabel: "2026 — 2nd", meetingDate: D2 },
      ]),
    );
    mockPMFindOne.mockReturnValue(chain({ _id: M2, meetingDate: D2 })); // last meeting
    mockSCFind.mockReturnValue(chain([{ type: "STUDY_HOMEWORK" }, { type: "STUDY_HOMEWORK" }, { type: "BEHAVIOUR" }]));

    const res = await studentCommentTimeline(STUDENT.toString());
    expect(res.meetingComments.map((m) => m.meetingId)).toEqual([M1.toString(), M2.toString()]); // chronological
    expect(res.sinceMeetingId).toBe(M2.toString());
    const byType = Object.fromEntries(res.rollupSinceLastMeeting.map((x) => [x.type, x.count]));
    expect(byType.STUDY_HOMEWORK).toBe(2);
    expect(byType.BEHAVIOUR).toBe(1);
  });
});

// ===========================================================================
// meetingComparison
// ===========================================================================

describe("meetingComparison", () => {
  test("splits current vs prior + rolls up daily comments since the previous meeting", async () => {
    mockPMFindById.mockReturnValue(chain({ _id: M2, instanceLabel: "2026 — 2nd", meetingDate: D2 }));
    mockMCFind.mockReturnValue(chain([note(M1), note(M2)]));
    mockPMFind.mockReturnValue(
      chain([
        { _id: M1, instanceLabel: "2026 — 1st", meetingDate: D1 },
        { _id: M2, instanceLabel: "2026 — 2nd", meetingDate: D2 },
      ]),
    );
    mockPMFindOne.mockReturnValue(chain({ _id: M1, meetingDate: D1 })); // previous meeting
    mockSCFind.mockReturnValue(chain([{ type: "BEHAVIOUR" }]));

    const res = await meetingComparison(M2.toString(), STUDENT.toString());
    expect(res.current?.meetingId).toBe(M2.toString());
    expect(res.prior.map((p) => p.meetingId)).toEqual([M1.toString()]);
    expect(res.previousMeetingId).toBe(M1.toString());
    expect(Object.fromEntries(res.rollupSincePrevious.map((x) => [x.type, x.count])).BEHAVIOUR).toBe(1);
  });
});

// ===========================================================================
// Guardian reads (J-CM8) — delivered only + structural omission
// ===========================================================================

describe("childComments (J-CM8 — delivered only, no staff fields)", () => {
  test("returns delivered comments in a shape with NO author/section/channel fields", async () => {
    mockSCFind.mockReturnValue(
      chain([
        {
          _id: oid(),
          studentId: STUDENT,
          sectionId: oid(),
          authorUserId: new mongoose.Types.ObjectId(TEACHER),
          type: "ATTENDANCE",
          sentiment: "CONCERN",
          text: "Late again",
          attachmentIds: [],
          deliveryChannels: ["wa"],
          deliveredAt: D2,
          createdAt: D1,
          updatedAt: D2,
        },
      ]),
    );
    const res = await childComments(STUDENT.toString());
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ type: "ATTENDANCE", sentiment: "CONCERN", text: "Late again" });
    // structural omission — staff-only fields can never reach a guardian
    expect(res[0]).not.toHaveProperty("authorUserId");
    expect(res[0]).not.toHaveProperty("sectionId");
    expect(res[0]).not.toHaveProperty("deliveryChannels");
    expect(Object.keys(res[0]).sort()).toEqual(
      ["attachmentIds", "createdAt", "deliveredAt", "id", "sentiment", "text", "type"].sort(),
    );
  });
});

describe("childMeetingSlot (J-CM8 — family slot, no staff fields)", () => {
  test("returns the family's slot WITHOUT familyKey/studentIds/attendanceRemark", async () => {
    mockPMFindById.mockReturnValue(chain({ instanceLabel: "2026 — 1st", meetingDate: D2 }));
    mockSlotFindOne.mockReturnValue(
      chain({
        _id: oid(),
        meetingId: M2,
        familyKey: "01711000111",
        studentIds: [STUDENT],
        classLabels: ["KG"],
        order: 3,
        slotTime: 615,
        onCall: false,
        dispatchedAt: D2,
        attended: true,
        attendanceRemark: "came",
      }),
    );
    const res = await childMeetingSlot(M2.toString(), STUDENT.toString());
    expect(res).toMatchObject({ slotTime: 615, onCall: false, order: 3, attended: true, classLabels: ["KG"] });
    expect(res).not.toHaveProperty("familyKey");
    expect(res).not.toHaveProperty("studentIds");
    expect(res).not.toHaveProperty("attendanceRemark");
  });

  test("returns null when the child has no slot", async () => {
    mockPMFindById.mockReturnValue(chain({ instanceLabel: "x", meetingDate: D2 }));
    mockSlotFindOne.mockReturnValue(chain(null));
    expect(await childMeetingSlot(M2.toString(), STUDENT.toString())).toBeNull();
  });
});

// ===========================================================================
// RBAC — composes existing permissions (§8, D-#17)
// ===========================================================================

describe("RBAC (composes existing perms — no new permission)", () => {
  test("reps comparison gate = tracker:read OR roster:manage; guardian denied", () => {
    const reps = (role: string) =>
      roleHasPermission(role as never, "tracker:read") || roleHasPermission(role as never, "roster:manage");
    expect(reps("TEACHER")).toBe(true); // tracker:read
    expect(reps("OFFICE")).toBe(true); // roster:manage
    expect(reps("PRINCIPAL")).toBe(true);
    expect(reps("GUARDIAN")).toBe(false);
  });

  test("guardian reads ride the existing guardian:read_child permission", () => {
    expect(roleHasPermission("GUARDIAN", "guardian:read_child")).toBe(true);
    expect(roleHasPermission("TEACHER", "guardian:read_child")).toBe(false);
  });
});
