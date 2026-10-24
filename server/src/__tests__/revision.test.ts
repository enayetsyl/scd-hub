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
const mockEntryAggregate = jest.fn();
jest.mock("../modules/saturday-revision/models/RevisionEntry", () => ({
  RevisionEntry: {
    findOne: (q: unknown) => mockEntryFindOne(q),
    findById: (id: unknown) => mockEntryFindById(id),
    find: (q: unknown) => mockEntryFind(q),
    create: (doc: unknown) => mockEntryCreate(doc),
    aggregate: (p: unknown) => mockEntryAggregate(p),
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
  childRevision,
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
  mockEntryAggregate.mockResolvedValue([]);
  mockEntryCreate.mockImplementation(async (doc: Record<string, unknown>) => ({
    _id: oid(),
    ...doc,
    portions: doc.portions ?? [],
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
  test("stores a present entry with surah:ayah portions + audits SR_REVISION_RECORDED", async () => {
    happyContext();
    mockEntryFindOne.mockResolvedValue(null);
    const res = await recordEntry({
      groupId: GROUP_OID.toString(),
      studentId: STUDENT_OID.toString(),
      date: SAT,
      present: true,
      portions: [
        { category: "SABAQ", status: "COMPLETED", fromSurah: 2, fromAyah: 247, toSurah: 2, toAyah: 259, tanbih: 2, fath: 1, mistakes: { harf: 1 } },
        { category: "MANZIL", status: "PARTIAL", fromSurah: 78, fromAyah: 1, toSurah: 79, toAyah: 46 },
      ],
      teacherComment: "ভালো",
      actorId: TEACHER_ID,
    });
    expect(res.present).toBe(true);
    expect(res.portions).toHaveLength(2);
    // Baqara 247–259 crosses into juz 3 at ayah 253 — the juz are derived, never stored.
    expect(res.portions[0]).toMatchObject({ category: "SABAQ", status: "COMPLETED", ayahs: 13, juzs: [2, 3], tanbih: 2, fath: 1 });
    expect(res.portions[0].rangeBn).toBe("বাকারা ২৪৭–২৫৯");
    expect(res.portions[0].mistakes).toEqual({ harf: 1, ghunnah: 0, madd: 0, other: 0 });
    expect(res.portions[1]).toMatchObject({ ayahs: 86, juzs: [30], rangeBn: "নাবা ১ – নাযিয়াত ৪৬" });
    expect(res.deliveredAt).toBeNull();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "SR_REVISION_RECORDED", targetKind: "RevisionEntry" }),
    );
  });

  test("an absent student stores no portions (J-SR1-2)", async () => {
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
    expect(res.portions).toHaveLength(0);
  });

  test("rejects portions on an absent student", async () => {
    happyContext();
    mockEntryFindOne.mockResolvedValue(null);
    await expect(
      recordEntry({
        groupId: GROUP_OID.toString(), studentId: STUDENT_OID.toString(), date: SAT, present: false,
        portions: [{ category: "SABAQ", status: "COMPLETED", fromSurah: 1, fromAyah: 1, toSurah: 1, toAyah: 7 }], actorId: TEACHER_ID,
      }),
    ).rejects.toThrow(/absent student carries no portions/i);
  });

  test("rejects a bad category / status / range (SR-5)", async () => {
    happyContext();
    mockEntryFindOne.mockResolvedValue(null);
    const base = { groupId: GROUP_OID.toString(), studentId: STUDENT_OID.toString(), date: SAT, present: true, actorId: TEACHER_ID };
    const ok = { fromSurah: 2, fromAyah: 1, toSurah: 2, toAyah: 5 };
    await expect(recordEntry({ ...base, portions: [{ category: "NOPE", status: "COMPLETED", ...ok }] })).rejects.toThrow(/category must be/i);
    await expect(recordEntry({ ...base, portions: [{ category: "SABAQ", status: "MAYBE", ...ok }] })).rejects.toThrow(/status must be/i);
    // Baqara has 286 ayahs — 287 is out of range.
    await expect(recordEntry({ ...base, portions: [{ category: "SABAQ", status: "COMPLETED", fromSurah: 2, fromAyah: 280, toSurah: 2, toAyah: 287 }] })).rejects.toThrow(/out of range/i);
    await expect(recordEntry({ ...base, portions: [{ category: "SABAQ", status: "COMPLETED", fromSurah: 3, fromAyah: 1, toSurah: 2, toAyah: 5 }] })).rejects.toThrow(/end comes before the start/i);
    await expect(recordEntry({ ...base, portions: [{ category: "SABAQ", status: "COMPLETED", fromSurah: 2, fromAyah: 1 }] })).rejects.toThrow(/both the start and the end/i);
    await expect(recordEntry({ ...base, portions: [{ category: "SABAQ", status: "COMPLETED" }] })).rejects.toThrow(/needs its start and end/i);
  });

  test("a NOT_DONE portion may carry no range (the bare সবক হয়নি)", async () => {
    happyContext();
    mockEntryFindOne.mockResolvedValue(null);
    const res = await recordEntry({
      groupId: GROUP_OID.toString(), studentId: STUDENT_OID.toString(), date: SAT, present: true,
      portions: [{ category: "SABAQ", status: "NOT_DONE", tanbih: 1 }], actorId: TEACHER_ID,
    });
    expect(res.portions[0]).toMatchObject({ status: "NOT_DONE", fromSurah: null, rangeBn: null, ayahs: 0, juzs: [], tanbih: 1 });
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
      portions: [], deliveryChannels: [], deliveredAt: undefined,
      createdAt: new Date("2026-06-13T01:00:00Z"), updatedAt: new Date("2026-06-13T01:00:00Z"),
    };
    doc.save = jest.fn(async () => doc);
    mockEntryFindOne.mockResolvedValue(doc);
    const res = await recordEntry({
      groupId: GROUP_OID.toString(), studentId: STUDENT_OID.toString(), date: SAT, present: true,
      portions: [{ category: "SABQI", status: "COMPLETED", fromSurah: 4, fromAyah: 24, toSurah: 4, toAyah: 30 }], actorId: TEACHER_ID,
    });
    expect((doc.save as jest.Mock)).toHaveBeenCalled();
    expect(res.portions).toHaveLength(1);
    expect(mockEntryCreate).not.toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ meta: expect.objectContaining({ edited: true }) }));
  });

  test("a DELIVERED entry is immutable (D-#242)", async () => {
    happyContext();
    mockEntryFindOne.mockResolvedValue({ _id: oid(), deliveredAt: new Date("2026-06-13T02:00:00Z") });
    await expect(
      recordEntry({ groupId: GROUP_OID.toString(), studentId: STUDENT_OID.toString(), date: SAT, present: true, portions: [], actorId: TEACHER_ID }),
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
      { _id: oid(), groupId: GROUP_OID, studentId: s1, date: SAT, present: true, portions: [], teacherUserId: new mongoose.Types.ObjectId(TEACHER_ID), deliveryChannels: [], createdAt: SAT, updatedAt: SAT },
    ]));
    const EARLIER = new Date("2026-06-06T00:00:00Z");
    mockEntryAggregate.mockResolvedValue([
      { _id: s2, doc: { _id: oid(), groupId: GROUP_OID, studentId: s2, date: EARLIER, present: true,
        portions: [{ category: "SABAQ", status: "COMPLETED", fromSurah: 2, fromAyah: 173, toSurah: 2, toAyah: 181, tanbih: 0, fath: 0, mistakes: { harf: 0, ghunnah: 0, madd: 0, other: 0 } }],
        teacherUserId: new mongoose.Types.ObjectId(TEACHER_ID), deliveryChannels: [], createdAt: EARLIER, updatedAt: EARLIER } },
    ]);
    const rows = await groupSaturday(GROUP_OID.toString(), SAT);
    expect(rows).toHaveLength(2);
    const byId = Object.fromEntries(rows.map((r) => [r.studentId, r]));
    expect(byId[s1.toString()].entry).not.toBeNull();
    expect(byId[s2.toString()].entry).toBeNull();
    // The prefill source: the latest earlier entry, else null (SR-5).
    expect(byId[s1.toString()].previous).toBeNull();
    expect(byId[s2.toString()].previous?.portions[0]).toMatchObject({ category: "SABAQ", rangeBn: "বাকারা ১৭৩–১৮১" });
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
        portions: [{ category: "SABAQ", status: "COMPLETED", fromSurah: 3, fromAyah: 93, toSurah: 3, toAyah: 100, tanbih: 0, fath: 0, mistakes: { harf: 0, ghunnah: 0, madd: 0, other: 0 } }],
        teacherUserId: new mongoose.Types.ObjectId(TEACHER_ID), deliveryChannels: ["wa"], deliveredAt: SAT, createdAt: SAT, updatedAt: SAT },
    ]));
    const rows = await studentRevisionHistory(STUDENT_OID.toString());
    expect(rows).toHaveLength(1);
    expect(rows[0].portions[0]).toMatchObject({ category: "SABAQ", juzs: [4] });
    expect(rows[0].deliveredAt).toBe(SAT.toISOString());
  });
});

describe("childRevision (SR-4 guardian card)", () => {
  test("returns DELIVERED entries only, structurally omitting staff fields", async () => {
    mockEntryFind.mockReturnValue(leanChain([
      { _id: oid(), studentId: STUDENT_OID, groupId: GROUP_OID, date: SAT, present: true,
        portions: [{ category: "SABAQ", status: "COMPLETED", fromSurah: 1, fromAyah: 1, toSurah: 1, toAyah: 7, tanbih: 0, fath: 0, mistakes: { harf: 0, ghunnah: 0, madd: 0, other: 0 } }],
        teacherUserId: new mongoose.Types.ObjectId(TEACHER_ID), teacherComment: "ভালো",
        deliveryChannels: ["wa"], deliveredAt: SAT, createdAt: SAT, updatedAt: SAT },
    ]));
    const rows = await childRevision(STUDENT_OID.toString());
    expect(rows).toHaveLength(1);
    expect(rows[0].deliveredAt).toBe(SAT.toISOString());
    expect(rows[0].teacherComment).toBe("ভালো");
    // staff fields are structurally absent (D-#68)
    expect(rows[0]).not.toHaveProperty("teacherUserId");
    expect(rows[0]).not.toHaveProperty("deliveryChannels");
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
