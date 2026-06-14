/**
 * Parents' Meeting CM-3 tests (prd-comments-meetings §3/§6, D-#123, J-CM3/J-CM4).
 *
 * Pure      — groupFamilies (sibling-collapse by Student.phone, phone-less each-own-
 *             family, default class→section→name order, parallel classLabels);
 *             assignSlotTimes (sequential timing from dayStart, On-Call skipped → null).
 * Service   — createParentMeeting (validation + default current-year + audit);
 *             generateSlots (DRAFT-only guard, wholesale delete+relay, reachable/
 *             unreachable counts, audit); setSlotOnCall (flip + re-time, draft guard);
 *             reorderSlots (membership validation, re-time, audit).
 * RBAC      — the admin gate composes the EXISTING roster:manage permission (D-#17/#94):
 *             Principal + Office hold it; Teacher + Guardian do not.
 *
 * DB-free (the repo convention): models + audit are mocked.
 */
import mongoose from "mongoose";
import { roleHasPermission } from "@scd/shared";

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

const mockMeetingCreate = jest.fn();
const mockMeetingFindById = jest.fn();
const mockMeetingFind = jest.fn();
jest.mock("../modules/comments/models/ParentMeeting", () => ({
  ParentMeeting: {
    create: (doc: unknown) => mockMeetingCreate(doc),
    findById: (id: unknown) => mockMeetingFindById(id),
    find: (q: unknown) => mockMeetingFind(q),
  },
  // re-export the literal union constant the service imports
  PARENT_MEETING_STATUSES: ["draft", "scheduled", "closed"],
}));

const mockSlotDeleteMany = jest.fn();
const mockSlotInsertMany = jest.fn();
const mockSlotFind = jest.fn();
const mockSlotFindById = jest.fn();
const mockSlotUpdateOne = jest.fn();
jest.mock("../modules/comments/models/ParentMeetingSlot", () => ({
  ParentMeetingSlot: {
    deleteMany: (q: unknown) => mockSlotDeleteMany(q),
    insertMany: (docs: unknown) => mockSlotInsertMany(docs),
    find: (q: unknown) => mockSlotFind(q),
    findById: (id: unknown) => mockSlotFindById(id),
    updateOne: (q: unknown, u: unknown) => mockSlotUpdateOne(q, u),
  },
}));

const mockStudentFind = jest.fn();
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { find: (q: unknown) => mockStudentFind(q) },
}));

const mockClassFind = jest.fn();
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { find: (q: unknown) => mockClassFind(q) },
}));

const mockSectionFind = jest.fn();
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { find: (q: unknown) => mockSectionFind(q) },
}));

const mockYearFindOne = jest.fn();
jest.mock("../modules/foundation/models/AcademicYear", () => ({
  AcademicYear: { findOne: (q: unknown) => mockYearFindOne(q) },
}));

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (e: unknown) => mockWriteAudit(e),
}));

// Import AFTER mocks
import {
  groupFamilies,
  assignSlotTimes,
  createParentMeeting,
  generateSlots,
  setSlotOnCall,
  reorderSlots,
  ParentMeetingError,
  type StudentForSlot,
} from "../modules/comments/services/ParentMeetingService";

const YEAR_OID = oid();
const MEETING_OID = oid();
const ACTOR = oid().toString();

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteAudit.mockResolvedValue(undefined);
});

// ===========================================================================
// Pure: groupFamilies
// ===========================================================================

const stu = (over: Partial<StudentForSlot> & { id: string }): StudentForSlot => ({
  name: "X",
  phone: null,
  classLevel: 0,
  classLabel: "",
  sectionCode: "A",
  ...over,
});

describe("groupFamilies (sibling collapse by Student.phone — J-CM3)", () => {
  test("two siblings on one phone collapse into ONE family with combined ids + labels", () => {
    const a = stu({ id: "a", name: "Asila", phone: "01711-000111", classLevel: 0, classLabel: "KG", sectionCode: "A" });
    const b = stu({ id: "b", name: "Arham", phone: "01711000111", classLevel: 2, classLabel: "Two", sectionCode: "A" });
    const fams = groupFamilies([a, b]);
    expect(fams).toHaveLength(1);
    expect(fams[0].familyKey).toBe("01711000111"); // digits-only, both formats collapse
    expect(fams[0].studentIds).toEqual(["a", "b"]); // sorted class→section→name (KG before Two)
    expect(fams[0].classLabels).toEqual(["KG", "Two"]);
    expect(fams[0].hasPhone).toBe(true);
  });

  test("phone-less students each form their OWN single-student family (D-#174)", () => {
    const a = stu({ id: "a", name: "Nadia", phone: "", classLevel: 1 });
    const b = stu({ id: "b", name: "Omar", phone: null, classLevel: 1 });
    const fams = groupFamilies([a, b]);
    expect(fams).toHaveLength(2);
    expect(fams.every((f) => !f.hasPhone)).toBe(true);
    expect(fams.map((f) => f.familyKey).sort()).toEqual(["nophone:a", "nophone:b"]);
  });

  test("families sort by lead child class→section→name (default order)", () => {
    const f1 = stu({ id: "1", name: "Zaid", phone: "111", classLevel: 3, sectionCode: "A" });
    const f2 = stu({ id: "2", name: "Bilal", phone: "222", classLevel: 0, sectionCode: "B" });
    const f3 = stu({ id: "3", name: "Amin", phone: "333", classLevel: 0, sectionCode: "A" });
    const fams = groupFamilies([f1, f2, f3]);
    // class 0/sec A (Amin) → class 0/sec B (Bilal) → class 3 (Zaid)
    expect(fams.map((f) => f.familyKey)).toEqual(["333", "222", "111"]);
  });
});

// ===========================================================================
// Pure: assignSlotTimes
// ===========================================================================

describe("assignSlotTimes (sequential from dayStart; On-Call → null)", () => {
  test("timed slots step by slotMinutes from dayStartMinutes", () => {
    const times = assignSlotTimes([{ onCall: false }, { onCall: false }, { onCall: false }], 600, 15);
    expect(times).toEqual([600, 615, 630]);
  });

  test("On-Call slots get null and DO NOT consume a time step (J-CM4)", () => {
    const times = assignSlotTimes(
      [{ onCall: false }, { onCall: true }, { onCall: false }],
      600,
      15,
    );
    expect(times).toEqual([600, null, 615]); // the On-Call slot is skipped, not timed
  });
});

// ===========================================================================
// createParentMeeting
// ===========================================================================

describe("createParentMeeting", () => {
  beforeEach(() => {
    mockMeetingCreate.mockImplementation(async (doc: Record<string, unknown>) => ({
      _id: MEETING_OID,
      ...doc,
      createdAt: new Date("2026-06-14T00:00:00Z"),
      updatedAt: new Date("2026-06-14T00:00:00Z"),
    }));
  });

  test("creates a draft meeting; defaults to the current academic year; audited", async () => {
    mockYearFindOne.mockReturnValue(chain({ _id: YEAR_OID }));
    const res = await createParentMeeting({
      instanceLabel: "2026 — 1st",
      meetingDate: "2026-07-01",
      slotMinutes: 15,
      dayStartMinutes: 600,
      actorId: ACTOR,
    });
    expect(res).toMatchObject({
      instanceLabel: "2026 — 1st",
      slotMinutes: 15,
      dayStartMinutes: 600,
      status: "draft",
      academicYearId: YEAR_OID.toString(),
    });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "PARENT_MEETING_CREATED", targetKind: "ParentMeeting" }),
    );
  });

  test("rejects an empty label / bad slotMinutes / out-of-range dayStart", async () => {
    mockYearFindOne.mockReturnValue(chain({ _id: YEAR_OID }));
    await expect(
      createParentMeeting({ instanceLabel: "  ", meetingDate: "2026-07-01", slotMinutes: 15, dayStartMinutes: 600, actorId: ACTOR }),
    ).rejects.toThrow(/label is required/);
    await expect(
      createParentMeeting({ instanceLabel: "x", meetingDate: "2026-07-01", slotMinutes: 0, dayStartMinutes: 600, actorId: ACTOR }),
    ).rejects.toThrow(/slotMinutes/);
    await expect(
      createParentMeeting({ instanceLabel: "x", meetingDate: "2026-07-01", slotMinutes: 15, dayStartMinutes: 9999, actorId: ACTOR }),
    ).rejects.toThrow(/dayStartMinutes/);
    expect(mockMeetingCreate).not.toHaveBeenCalled();
  });

  test("throws when no current academic year is set and none given", async () => {
    mockYearFindOne.mockReturnValue(chain(null));
    await expect(
      createParentMeeting({ instanceLabel: "x", meetingDate: "2026-07-01", slotMinutes: 15, dayStartMinutes: 600, actorId: ACTOR }),
    ).rejects.toThrow(/current academic year/);
  });
});

// ===========================================================================
// generateSlots (wholesale; DRAFT-only)
// ===========================================================================

const draftMeeting = (over: Record<string, unknown> = {}) => ({
  _id: MEETING_OID,
  academicYearId: YEAR_OID,
  instanceLabel: "2026 — 1st",
  meetingDate: new Date("2026-07-01T00:00:00Z"),
  slotMinutes: 15,
  dayStartMinutes: 600,
  status: "draft",
  includeScope: { classIds: [], sectionIds: [] },
  createdAt: new Date("2026-06-14T00:00:00Z"),
  updatedAt: new Date("2026-06-14T00:00:00Z"),
  ...over,
});

describe("generateSlots", () => {
  beforeEach(() => {
    mockSlotDeleteMany.mockResolvedValue({ deletedCount: 0 });
    mockSlotInsertMany.mockImplementation(async (docs: Record<string, unknown>[]) =>
      docs.map((d) => ({
        _id: oid(),
        ...d,
        createdAt: new Date("2026-06-14T00:00:00Z"),
        updatedAt: new Date("2026-06-14T00:00:00Z"),
      })),
    );
  });

  test("groups by phone, times the slots, deletes-then-relays, counts reachable/unreachable", async () => {
    mockMeetingFindById.mockResolvedValue(draftMeeting());
    const classA = oid();
    const secA = oid();
    const sib1 = oid();
    const sib2 = oid();
    const lone = oid();
    // two siblings on one phone + one phone-less child
    mockStudentFind.mockReturnValue(
      chain([
        { _id: sib1, name: "Asila", phone: "01711000111", classId: classA, sectionId: secA },
        { _id: sib2, name: "Arham", phone: "01711000111", classId: classA, sectionId: secA },
        { _id: lone, name: "Lone", phone: "", classId: classA, sectionId: secA },
      ]),
    );
    mockClassFind.mockReturnValue(chain([{ _id: classA, level: 0, nameBn: "কেজি" }]));
    mockSectionFind.mockReturnValue(chain([{ _id: secA, code: "A" }]));

    const res = await generateSlots(MEETING_OID.toString(), ACTOR);
    expect(res.familyCount).toBe(2); // siblings collapsed + one lone child
    expect(res.reachableCount).toBe(1);
    expect(res.unreachableCount).toBe(1);
    expect(mockSlotDeleteMany).toHaveBeenCalledWith({ meetingId: MEETING_OID }); // wholesale
    expect(res.slots.every((s) => s.onCall === false)).toBe(true);
    // both families timed sequentially from dayStart 600 step 15
    expect(res.slots.map((s) => s.slotTime).sort((x, y) => (x ?? 0) - (y ?? 0))).toEqual([600, 615]);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "PARENT_MEETING_SLOTS_GENERATED" }),
    );
  });

  test("refuses to (re)generate once the meeting is no longer a draft (D-#175)", async () => {
    mockMeetingFindById.mockResolvedValue(draftMeeting({ status: "scheduled" }));
    await expect(generateSlots(MEETING_OID.toString(), ACTOR)).rejects.toThrow(/draft/);
    expect(mockSlotDeleteMany).not.toHaveBeenCalled();
  });

  test("a missing meeting throws", async () => {
    mockMeetingFindById.mockResolvedValue(null);
    await expect(generateSlots(MEETING_OID.toString(), ACTOR)).rejects.toBeInstanceOf(ParentMeetingError);
  });
});

// ===========================================================================
// setSlotOnCall (flip + re-time)
// ===========================================================================

const slotDoc = (over: Record<string, unknown> = {}) => {
  const d: Record<string, unknown> = {
    _id: oid(),
    meetingId: MEETING_OID,
    familyKey: "111",
    studentIds: [],
    classLabels: [],
    order: 0,
    slotTime: 600,
    onCall: false,
    createdAt: new Date("2026-06-14T00:00:00Z"),
    updatedAt: new Date("2026-06-14T00:00:00Z"),
    ...over,
  };
  d.save = jest.fn(async () => d);
  return d;
};

describe("setSlotOnCall", () => {
  test("flags On-Call (null time) and re-times the remaining slots; audited", async () => {
    const target = slotDoc({ order: 0, slotTime: 600 });
    const other = slotDoc({ familyKey: "222", order: 1, slotTime: 615 });
    mockSlotFindById.mockResolvedValue(target);
    mockMeetingFindById.mockResolvedValue(draftMeeting());
    // retimeAndReturn loads BOTH slots in order
    mockSlotFind.mockReturnValue(chain([target, other]));

    const res = await setSlotOnCall((target._id as mongoose.Types.ObjectId).toString(), true, ACTOR);
    expect(target.onCall).toBe(true);
    // On-Call → null; the other timed slot resets to dayStart 600 (it is now first timed)
    expect(res.find((s) => s.onCall)?.slotTime).toBeNull();
    expect(res.find((s) => !s.onCall)?.slotTime).toBe(600);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "PARENT_MEETING_SLOTS_REORDERED" }),
    );
  });

  test("refuses when the meeting is not a draft", async () => {
    const target = slotDoc();
    mockSlotFindById.mockResolvedValue(target);
    mockMeetingFindById.mockResolvedValue(draftMeeting({ status: "closed" }));
    await expect(
      setSlotOnCall((target._id as mongoose.Types.ObjectId).toString(), true, ACTOR),
    ).rejects.toThrow(/draft/);
  });
});

// ===========================================================================
// reorderSlots (membership validation + re-time)
// ===========================================================================

describe("reorderSlots", () => {
  test("reorders, re-times by the new order, and audits", async () => {
    const s1 = slotDoc({ order: 0, slotTime: 600 });
    const s2 = slotDoc({ familyKey: "222", order: 1, slotTime: 615 });
    const id1 = (s1._id as mongoose.Types.ObjectId).toString();
    const id2 = (s2._id as mongoose.Types.ObjectId).toString();
    mockMeetingFindById.mockResolvedValue(draftMeeting());
    // membership read (select _id .lean)
    mockSlotFind
      .mockReturnValueOnce(chain([{ _id: s1._id }, { _id: s2._id }]))
      // retime read returns them in the NEW order (s2 first)
      .mockReturnValueOnce(chain([s2, s1]));
    mockSlotUpdateOne.mockResolvedValue({ matchedCount: 1 });

    const res = await reorderSlots(MEETING_OID.toString(), [id2, id1], ACTOR);
    expect(mockSlotUpdateOne).toHaveBeenCalledTimes(2);
    // s2 is now first → 600, s1 second → 615
    expect(res[0].slotTime).toBe(600);
    expect(res[1].slotTime).toBe(615);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "PARENT_MEETING_SLOTS_REORDERED", meta: expect.objectContaining({ action: "reorder" }) }),
    );
  });

  test("rejects a reorder list that is not exactly the meeting's slots", async () => {
    const s1 = slotDoc();
    mockMeetingFindById.mockResolvedValue(draftMeeting());
    mockSlotFind.mockReturnValueOnce(chain([{ _id: s1._id }, { _id: oid() }]));
    await expect(
      reorderSlots(MEETING_OID.toString(), [(s1._id as mongoose.Types.ObjectId).toString()], ACTOR),
    ).rejects.toThrow(/exactly the meeting's slots/);
    expect(mockSlotUpdateOne).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// RBAC — the admin gate composes the existing roster:manage permission (D-#17/#94)
// ===========================================================================

describe("RBAC (roster:manage admin gate — no new permission)", () => {
  test("Principal + Office hold roster:manage; Teacher + Guardian do not", () => {
    expect(roleHasPermission("PRINCIPAL", "roster:manage")).toBe(true);
    expect(roleHasPermission("OFFICE", "roster:manage")).toBe(true);
    expect(roleHasPermission("TEACHER", "roster:manage")).toBe(false);
    expect(roleHasPermission("GUARDIAN", "roster:manage")).toBe(false);
  });
});
