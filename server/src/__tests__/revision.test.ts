/**
 * Saturday-Revision SR-1 tests (prd-sr1 §3/§4/§6, D-#241/#242).
 *
 * Vocab     — REVISION_CATEGORIES / REVISION_MISTAKE_CATEGORIES label totality (BN + EN).
 * Service   — recordEntry (group/date/membership validation; present⇒records /
 *             absent⇒none — J-SR1-2; per-juz split — J-SR1-3; juz/amount/count
 *             validation; immutable-after-deliver — J-SR1-4; audited SR_REVISION_RECORDED);
 *             editEntry (refused once delivered); the grid + history reads.
 * RBAC      — teacherTeachesGroup / teacherCanReadStudent scope (the J-SR1-5 deny basis).
 *
 * DB-free (the repo convention): models, the calendar resolver, and audit are mocked.
 */
import mongoose from "mongoose";
import {
  REVISION_CATEGORIES,
  REVISION_CATEGORY_LABELS_BN,
  REVISION_CATEGORY_LABELS_EN,
  REVISION_MISTAKE_CATEGORIES,
  REVISION_MISTAKE_CATEGORY_LABELS_BN,
  REVISION_MISTAKE_CATEGORY_LABELS_EN,
} from "@scd/shared";

const oid = () => new mongoose.Types.ObjectId();

const leanChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.lean = async () => val;
  return o;
};

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the modules under test)
// ---------------------------------------------------------------------------

const mockEntryFindOne = jest.fn();
const mockEntryFindById = jest.fn();
const mockEntryFind = jest.fn();
const mockEntryCreate = jest.fn();
jest.mock("../modules/saturday-revision/models/RevisionEntry", () => ({
  RevisionEntry: {
    findOne: (q: unknown) => mockEntryFindOne(q),
    findById: (id: unknown) => mockEntryFindById(id),
    find: (q: unknown) => mockEntryFind(q),
    create: (doc: unknown) => mockEntryCreate(doc),
  },
}));

const mockGroupFindById = jest.fn();
const mockGroupFind = jest.fn();
jest.mock("../modules/routine/models/SubjectGroup", () => ({
  SubjectGroup: {
    findById: (id: unknown) => mockGroupFindById(id),
    find: (q: unknown) => mockGroupFind(q),
  },
}));

const mockMembershipFindOne = jest.fn();
const mockMembershipFind = jest.fn();
const mockMembershipExists = jest.fn();
jest.mock("../modules/routine/models/SubjectGroupMembership", () => ({
  SubjectGroupMembership: {
    findOne: (q: unknown) => mockMembershipFindOne(q),
    find: (q: unknown) => mockMembershipFind(q),
    exists: (q: unknown) => mockMembershipExists(q),
  },
}));

const mockSlotFind = jest.fn();
const mockSlotExists = jest.fn();
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: {
    find: (q: unknown) => mockSlotFind(q),
    exists: (q: unknown) => mockSlotExists(q),
  },
}));

const mockStudentFindById = jest.fn();
const mockStudentFind = jest.fn();
jest.mock("../modules/foundation/models/Student", () => ({
  Student: {
    findById: (id: unknown) => mockStudentFindById(id),
    find: (q: unknown) => mockStudentFind(q),
  },
}));

const mockResolveDayType = jest.fn();
jest.mock("../modules/routine/calendar", () => ({
  resolveDayType: (d: unknown) => mockResolveDayType(d),
}));

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (e: unknown) => mockWriteAudit(e),
}));

// Import AFTER mocks
import {
  recordEntry,
  editEntry,
  groupSaturday,
  studentRevisionHistory,
  myRevisionGroups,
  teacherTeachesGroup,
  teacherCanReadStudent,
  isHifzLevel,
  RevisionError,
} from "../modules/saturday-revision/services/RevisionService";

const GROUP_OID = oid();
const STUDENT_OID = oid();
const TEACHER_ID = oid().toString();
const SAT = new Date("2026-06-13T00:00:00Z"); // a Saturday

/** Drive resolveRevisionContext down the happy path. */
function happyContext() {
  mockGroupFindById.mockReturnValue(leanChain({ track: "quran", level: "Hifz 1", active: true }));
  mockResolveDayType.mockResolvedValue("QURAN_ONLY");
  mockMembershipFindOne.mockReturnValue(leanChain({ _id: oid() }));
  mockStudentFindById.mockReturnValue(leanChain({ active: true }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteAudit.mockResolvedValue(undefined);
  mockEntryCreate.mockImplementation(async (doc: Record<string, unknown>) => ({
    _id: oid(),
    ...doc,
    juzRecords: doc.juzRecords ?? [],
    deliveryChannels: doc.deliveryChannels ?? [],
    createdAt: new Date("2026-06-13T01:00:00Z"),
    updatedAt: new Date("2026-06-13T01:00:00Z"),
  }));
});

// ===========================================================================
// Vocab label totality (§4)
// ===========================================================================

describe("REVISION_* vocab", () => {
  test("every revision category has a BN + EN label", () => {
    for (const k of REVISION_CATEGORIES) {
      expect(REVISION_CATEGORY_LABELS_BN[k]).toBeTruthy();
      expect(REVISION_CATEGORY_LABELS_EN[k]).toBeTruthy();
    }
    expect(Object.keys(REVISION_CATEGORY_LABELS_BN).sort()).toEqual([...REVISION_CATEGORIES].sort());
    expect(Object.keys(REVISION_CATEGORY_LABELS_EN).sort()).toEqual([...REVISION_CATEGORIES].sort());
  });

  test("every mistake category has a BN + EN label", () => {
    for (const k of REVISION_MISTAKE_CATEGORIES) {
      expect(REVISION_MISTAKE_CATEGORY_LABELS_BN[k]).toBeTruthy();
      expect(REVISION_MISTAKE_CATEGORY_LABELS_EN[k]).toBeTruthy();
    }
    expect(Object.keys(REVISION_MISTAKE_CATEGORY_LABELS_BN).sort()).toEqual([...REVISION_MISTAKE_CATEGORIES].sort());
  });

  test("isHifzLevel matches Hifz levels, not Qaida/Najera", () => {
    expect(isHifzLevel("Hifz 1")).toBe(true);
    expect(isHifzLevel("hifz 3")).toBe(true);
    expect(isHifzLevel("Qaida")).toBe(false);
    expect(isHifzLevel("Najera")).toBe(false);
  });
});

// ===========================================================================
// recordEntry
// ===========================================================================

describe("recordEntry", () => {
  test("stores a present entry with per-juz records + audits SR_REVISION_RECORDED", async () => {
    happyContext();
    mockEntryFindOne.mockResolvedValue(null);
    const res = await recordEntry({
      groupId: GROUP_OID.toString(),
      studentId: STUDENT_OID.toString(),
      date: SAT,
      present: true,
      juzRecords: [
        { juz: 1, category: "MANZIL", amountJuz: 0.5, tanbih: 2, fath: 1, mistakes: { harf: 1 } },
        { juz: 2, category: "MANZIL", amountJuz: 1 },
      ],
      teacherComment: "ভালো",
      actorId: TEACHER_ID,
    });
    expect(res.present).toBe(true);
    expect(res.juzRecords).toHaveLength(2); // J-SR1-3 per-juz split
    expect(res.juzRecords[0]).toMatchObject({ juz: 1, category: "MANZIL", amountJuz: 0.5, tanbih: 2, fath: 1 });
    expect(res.juzRecords[0].mistakes).toEqual({ harf: 1, ghunnah: 0, madd: 0, other: 0 });
    expect(res.deliveredAt).toBeNull();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "SR_REVISION_RECORDED", targetKind: "RevisionEntry" }),
    );
  });

  test("an absent student stores no juz records (J-SR1-2)", async () => {
    happyContext();
    mockEntryFindOne.mockResolvedValue(null);
    const res = await recordEntry({
      groupId: GROUP_OID.toString(),
      studentId: STUDENT_OID.toString(),
      date: SAT,
      present: false,
      actorId: TEACHER_ID,
    });
    expect(res.present).toBe(false);
    expect(res.juzRecords).toHaveLength(0);
  });

  test("rejects juz records on an absent student", async () => {
    happyContext();
    mockEntryFindOne.mockResolvedValue(null);
    await expect(
      recordEntry({
        groupId: GROUP_OID.toString(), studentId: STUDENT_OID.toString(), date: SAT, present: false,
        juzRecords: [{ juz: 1, category: "SABAQ", amountJuz: 1 }], actorId: TEACHER_ID,
      }),
    ).rejects.toThrow(/absent student carries no juz records/i);
  });

  test("rejects a bad juz / category / amount", async () => {
    happyContext();
    mockEntryFindOne.mockResolvedValue(null);
    const base = { groupId: GROUP_OID.toString(), studentId: STUDENT_OID.toString(), date: SAT, present: true, actorId: TEACHER_ID };
    await expect(recordEntry({ ...base, juzRecords: [{ juz: 31, category: "SABAQ", amountJuz: 1 }] })).rejects.toThrow(/juz must be/i);
    await expect(recordEntry({ ...base, juzRecords: [{ juz: 1, category: "NOPE", amountJuz: 1 }] })).rejects.toThrow(/category must be/i);
    await expect(recordEntry({ ...base, juzRecords: [{ juz: 1, category: "SABAQ", amountJuz: 0 }] })).rejects.toThrow(/amountJuz must be greater than 0/i);
  });

  test("rejects a non-QURAN_ONLY date", async () => {
    happyContext();
    mockResolveDayType.mockResolvedValue("FULL");
    await expect(
      recordEntry({ groupId: GROUP_OID.toString(), studentId: STUDENT_OID.toString(), date: SAT, present: false, actorId: TEACHER_ID }),
    ).rejects.toThrow(/QURAN_ONLY Saturday/i);
  });

  test("rejects a non-Hifz group", async () => {
    happyContext();
    mockGroupFindById.mockReturnValue(leanChain({ track: "quran", level: "Qaida", active: true }));
    await expect(
      recordEntry({ groupId: GROUP_OID.toString(), studentId: STUDENT_OID.toString(), date: SAT, present: false, actorId: TEACHER_ID }),
    ).rejects.toThrow(/Hifz Qur'an group/i);
  });

  test("rejects a student who is not a member", async () => {
    happyContext();
    mockMembershipFindOne.mockReturnValue(leanChain(null));
    await expect(
      recordEntry({ groupId: GROUP_OID.toString(), studentId: STUDENT_OID.toString(), date: SAT, present: false, actorId: TEACHER_ID }),
    ).rejects.toThrow(/not a member/i);
  });

  test("updates an existing UNDELIVERED entry (pre-delivery edit, J-SR1-4)", async () => {
    happyContext();
    const doc: Record<string, unknown> = {
      _id: oid(), groupId: GROUP_OID, studentId: STUDENT_OID, date: SAT, present: true,
      juzRecords: [], deliveryChannels: [], deliveredAt: undefined,
      createdAt: new Date("2026-06-13T01:00:00Z"), updatedAt: new Date("2026-06-13T01:00:00Z"),
    };
    doc.save = jest.fn(async () => doc);
    mockEntryFindOne.mockResolvedValue(doc);
    const res = await recordEntry({
      groupId: GROUP_OID.toString(), studentId: STUDENT_OID.toString(), date: SAT, present: true,
      juzRecords: [{ juz: 5, category: "SABQI", amountJuz: 0.25 }], actorId: TEACHER_ID,
    });
    expect((doc.save as jest.Mock)).toHaveBeenCalled();
    expect(res.juzRecords).toHaveLength(1);
    expect(mockEntryCreate).not.toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ meta: expect.objectContaining({ edited: true }) }));
  });

  test("a DELIVERED entry is immutable (D-#242)", async () => {
    happyContext();
    mockEntryFindOne.mockResolvedValue({ _id: oid(), deliveredAt: new Date("2026-06-13T02:00:00Z") });
    await expect(
      recordEntry({ groupId: GROUP_OID.toString(), studentId: STUDENT_OID.toString(), date: SAT, present: true, juzRecords: [], actorId: TEACHER_ID }),
    ).rejects.toThrow(/immutable/i);
  });
});

// ===========================================================================
// editEntry
// ===========================================================================

describe("editEntry", () => {
  test("a DELIVERED entry is refused", async () => {
    mockEntryFindById.mockReturnValue(
      leanChain({ groupId: GROUP_OID, studentId: STUDENT_OID, date: SAT, deliveredAt: new Date("2026-06-13T02:00:00Z") }),
    );
    await expect(
      editEntry({ entryId: oid().toString(), present: true, actorId: TEACHER_ID }),
    ).rejects.toThrow(/immutable/i);
  });

  test("a missing entry throws", async () => {
    mockEntryFindById.mockReturnValue(leanChain(null));
    await expect(editEntry({ entryId: oid().toString(), present: true, actorId: TEACHER_ID })).rejects.toBeInstanceOf(RevisionError);
  });
});

// ===========================================================================
// Reads
// ===========================================================================

describe("groupSaturday (the grid)", () => {
  test("returns a row per active student, joined to that Saturday's entry", async () => {
    const s1 = oid();
    const s2 = oid();
    mockMembershipFind.mockReturnValue(leanChain([{ studentId: s1 }, { studentId: s2 }]));
    mockStudentFind.mockReturnValue(leanChain([
      { _id: s1, nameBn: "আমিনা" },
      { _id: s2, nameBn: "বিলাল" },
    ]));
    mockEntryFind.mockReturnValue(leanChain([
      { _id: oid(), groupId: GROUP_OID, studentId: s1, date: SAT, present: true, juzRecords: [], teacherUserId: new mongoose.Types.ObjectId(TEACHER_ID), deliveryChannels: [], createdAt: SAT, updatedAt: SAT },
    ]));
    const rows = await groupSaturday(GROUP_OID.toString(), SAT);
    expect(rows).toHaveLength(2);
    const byId = Object.fromEntries(rows.map((r) => [r.studentId, r]));
    expect(byId[s1.toString()].entry).not.toBeNull();
    expect(byId[s2.toString()].entry).toBeNull();
  });

  test("an empty group returns no rows", async () => {
    mockMembershipFind.mockReturnValue(leanChain([]));
    expect(await groupSaturday(GROUP_OID.toString(), SAT)).toEqual([]);
  });
});

describe("studentRevisionHistory", () => {
  test("returns the child's entries newest-first shape", async () => {
    mockEntryFind.mockReturnValue(leanChain([
      { _id: oid(), groupId: GROUP_OID, studentId: STUDENT_OID, date: SAT, present: true,
        juzRecords: [{ juz: 3, category: "SABAQ", amountJuz: 1, tanbih: 0, fath: 0, mistakes: { harf: 0, ghunnah: 0, madd: 0, other: 0 } }],
        teacherUserId: new mongoose.Types.ObjectId(TEACHER_ID), deliveryChannels: ["wa"], deliveredAt: SAT, createdAt: SAT, updatedAt: SAT },
    ]));
    const rows = await studentRevisionHistory(STUDENT_OID.toString());
    expect(rows).toHaveLength(1);
    expect(rows[0].juzRecords[0]).toMatchObject({ juz: 3, category: "SABAQ" });
    expect(rows[0].deliveredAt).toBe(SAT.toISOString());
  });
});

// ===========================================================================
// RBAC scope (the J-SR1-5 deny basis)
// ===========================================================================

describe("Quran-group scope", () => {
  test("teacherTeachesGroup is true when a quran slot exists, false otherwise", async () => {
    mockSlotExists.mockResolvedValue({ _id: oid() });
    expect(await teacherTeachesGroup(TEACHER_ID, GROUP_OID.toString())).toBe(true);
    mockSlotExists.mockResolvedValue(null);
    expect(await teacherTeachesGroup(TEACHER_ID, GROUP_OID.toString())).toBe(false);
  });

  test("teacherCanReadStudent is false when the teacher leads no group", async () => {
    mockSlotFind.mockReturnValue(leanChain([]));
    expect(await teacherCanReadStudent(TEACHER_ID, STUDENT_OID.toString())).toBe(false);
  });

  test("teacherCanReadStudent checks membership across the teacher's groups", async () => {
    mockSlotFind.mockReturnValue(leanChain([{ groupId: GROUP_OID }]));
    mockMembershipExists.mockResolvedValue({ _id: oid() });
    expect(await teacherCanReadStudent(TEACHER_ID, STUDENT_OID.toString())).toBe(true);
  });
});

describe("myRevisionGroups", () => {
  test("a teacher sees only the Hifz groups they lead", async () => {
    mockSlotFind.mockReturnValue(leanChain([{ groupId: GROUP_OID }]));
    mockGroupFind.mockReturnValue(leanChain([
      { _id: GROUP_OID, code: "HIFZ1B", nameBn: "হিফজ ১", level: "Hifz 1", gender: "boys" },
      { _id: oid(), code: "QAIDA", nameBn: "কায়দা", level: "Qaida", gender: "boys" },
    ]));
    const groups = await myRevisionGroups(TEACHER_ID, false);
    expect(groups).toHaveLength(1); // Qaida filtered out (Hifz-only)
    expect(groups[0].code).toBe("HIFZ1B");
  });

  test("an admin (P/O) sees all active Hifz groups without a slot lookup", async () => {
    mockGroupFind.mockReturnValue(leanChain([
      { _id: GROUP_OID, code: "HIFZ1B", nameBn: "হিফজ ১", level: "Hifz 1", gender: "boys" },
    ]));
    const groups = await myRevisionGroups(oid().toString(), true);
    expect(groups).toHaveLength(1);
    expect(mockSlotFind).not.toHaveBeenCalled();
  });
});
