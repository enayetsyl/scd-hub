/**
 * AS-T2 tests — delivery + collection lifecycle on the shared engine (PRD §5).
 *
 * AJ-3 — delivery pass: holiday-rolled delivery date, per-student GIVEN /
 *        ABSENT_REDELIVER, derived counts (never typed)
 * AJ-4 — collection pass: holiday-rolled due date, SUBMITTED per student,
 *        past-due non-submitted → CHASE, missing list derived per student
 * Plus: redelivery keeps the ITEM due date; chase sweep; lifecycle edges only
 *       via the shared engine (illegal moves rejected).
 *
 * DB-free: models mocked; the shared lifecycle engine + cadence calendar are real.
 */
import mongoose from "mongoose";

const mockScheduleFindOne = jest.fn();
const mockItemCreate = jest.fn();
const mockItemFindOne = jest.fn();
const mockItemFindById = jest.fn();
const mockItemFind = jest.fn();
const mockRecInsertMany = jest.fn();
const mockRecFindById = jest.fn();
const mockRecFind = jest.fn();
const mockSeqUpdate = jest.fn();
const mockHolidayFind = jest.fn();

jest.mock("../modules/trackers/models/AssignmentSchedule", () => ({
  AssignmentSchedule: { findOne: (q: unknown) => mockScheduleFindOne(q) },
}));
jest.mock("../modules/trackers/models/AssignmentItem", () => ({
  AssignmentItem: {
    create: (a: unknown) => mockItemCreate(a),
    findOne: (q: unknown) => ({ lean: () => mockItemFindOne(q) }),
    // findById() supports both `await findById(id)` (trim — a savable doc) and
    // `findById(id).lean()` (scope checks — a plain row).
    findById: (id: unknown) => {
      const result = mockItemFindById(id);
      return Object.assign(Promise.resolve(result), { lean: () => Promise.resolve(result) });
    },
    // find() supports both `await find(q)` (confirm — docs with .save()) and
    // `find(q).sort().lean()` (weekLoad — plain rows).
    find: (q: unknown) => {
      const result = mockItemFind(q);
      return Object.assign(Promise.resolve(result), {
        sort: () => ({ lean: () => Promise.resolve(result) }),
        lean: () => Promise.resolve(result),
      });
    },
  },
}));
jest.mock("../modules/trackers/models/AssignmentStudentRecord", () => ({
  AssignmentStudentRecord: {
    insertMany: (docs: unknown) => mockRecInsertMany(docs),
    findById: (id: unknown) => mockRecFindById(id),
    find: (q: unknown) => {
      const result = mockRecFind(q);
      return Object.assign(Promise.resolve(result), { lean: () => Promise.resolve(result) });
    },
  },
}));
jest.mock("../modules/trackers/models/AssignmentSequence", () => ({
  AssignmentSequence: { findOneAndUpdate: (...a: unknown[]) => mockSeqUpdate(...a) },
}));
jest.mock("../modules/routine/models/HolidayException", () => ({
  HolidayException: { find: (q: unknown) => ({ lean: () => mockHolidayFind(q) }) },
}));

// Delivery-pass attachments (D-#298): the kind check queries StoredFile.
const mockStoredFind = jest.fn();
jest.mock("../modules/platform/models/StoredFile", () => ({
  StoredFile: {
    find: (q: unknown) => ({ select: () => ({ lean: () => mockStoredFind(q) }) }),
  },
}));

import {
  generateAsId,
  deliverAssignmentItem,
  redeliverAssignmentRecord,
  collectAssignment,
  sweepAssignmentChases,
  transitionAssignmentRecord,
  assignmentItemCounts,
  confirmAssignmentWeek,
  assignmentWeekLoad,
  setAssignmentItemMinutes,
} from "../modules/trackers/services/AssignmentService";

const oid = () => new mongoose.Types.ObjectId();
const YEAR = oid().toString();
const ACTOR = oid().toString();
const TERM_START = new Date(2026, 0, 4); // Sunday

const ENTRY_ID = oid();
const SECTION = oid();
const CLASS = oid();
const TEACHER = oid();

function scheduleWithEntry(over: Record<string, unknown> = {}) {
  const entry = {
    _id: ENTRY_ID,
    // TERM_START is Sun 2026-01-04; week 1 (Jan 4–10) is the 2nd calendar week of
    // January → weekOfMonth 2 → cycleWeek 2 (D-#275).
    cycleWeek: 2,
    classId: CLASS,
    classLevel: 2,
    sectionId: SECTION,
    subject: "BAN",
    teacherId: TEACHER,
    ...over,
  };
  const entries = Object.assign([entry], {
    id: (id: string) => (id === ENTRY_ID.toString() ? entry : null),
  });
  return {
    academicYearId: YEAR,
    termStartDate: TERM_START,
    deliveryDayOfWeek: 4,
    dueDayOfWeek: 0,
    entries,
  };
}

function rec(over: Record<string, unknown> = {}) {
  return {
    _id: oid(),
    asItemId: oid(),
    asId: "AS-C2-BAN-0001",
    studentId: oid(),
    sectionId: SECTION,
    classId: CLASS,
    state: "GIVEN",
    stateDates: [{ state: "GIVEN", at: new Date(2026, 0, 8) }] as Array<{ state: string; at: Date }>,
    dueDate: new Date(2026, 0, 11),
    chaseCount: 0,
    save: jest.fn().mockResolvedValue(true),
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHolidayFind.mockResolvedValue([]);
  mockItemFindOne.mockResolvedValue(null);
  mockSeqUpdate.mockResolvedValue({ seq: 1 });
  mockItemCreate.mockImplementation((a: Record<string, unknown>) =>
    Promise.resolve({ _id: oid(), ...a }),
  );
  mockRecInsertMany.mockResolvedValue([]);
});

// ===========================================================================
// AS_ID generation (D-#34 pattern)
// ===========================================================================

describe("AS_ID generation", () => {
  test("AS-C{class}-{SUBJECT}-{nnnn}, 4-digit zero-padded", async () => {
    mockSeqUpdate.mockResolvedValue({ seq: 7 });
    expect(await generateAsId(YEAR, 2, "BAN")).toBe("AS-C2-BAN-0007");
    mockSeqUpdate.mockResolvedValue({ seq: 1234 });
    expect(await generateAsId(YEAR, 5, "MATH")).toBe("AS-C5-MATH-1234");
  });
});

// ===========================================================================
// AJ-3 — delivery pass
// ===========================================================================

describe("AJ-3 — deliverAssignmentItem", () => {
  const roster = [
    { studentId: oid().toString(), present: true },
    { studentId: oid().toString(), present: true },
    { studentId: oid().toString(), present: false },
  ];

  test("AS-T6: deliver DRAFTS the item — previous-open date, roster stored, estMinutes set, NO records spawned", async () => {
    mockScheduleFindOne.mockResolvedValue(scheduleWithEntry());
    // Week 1 THU = Jan 8 — a holiday; expect delivery Wed Jan 7
    mockHolidayFind.mockResolvedValue([
      { fromDate: new Date(2026, 0, 8), toDate: new Date(2026, 0, 8, 23, 59) },
    ]);

    const res = await deliverAssignmentItem({
      academicYearId: YEAR,
      weekNumber: 1,
      entryId: ENTRY_ID.toString(),
      roster,
      totalMarks: 10,
      estMinutes: 45,
      actorId: ACTOR,
    });

    expect(res.deliveryDate.slice(0, 10)).toBe("2026-01-07"); // rolled back
    expect(res.dueDate.slice(0, 10)).toBe("2026-01-11"); // Sun unchanged
    expect(res.asId).toBe("AS-C2-BAN-0001");
    expect(res.status).toBe("DRAFT");
    expect(res.estMinutes).toBe(45);
    expect(res.presentCount).toBe(2); // from the roster, never typed
    expect(res.absentCount).toBe(1);

    // No student records at deliver — the item is a DRAFT carrying the roster.
    expect(mockRecInsertMany).not.toHaveBeenCalled();
    const created = mockItemCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(created.status).toBe("DRAFT");
    expect(created.estMinutes).toBe(45);
    expect(created.draftRoster).toHaveLength(3);
  });

  test("estMinutes defaults to 20 when omitted", async () => {
    mockScheduleFindOne.mockResolvedValue(scheduleWithEntry());
    const res = await deliverAssignmentItem({
      academicYearId: YEAR, weekNumber: 1, entryId: ENTRY_ID.toString(), roster, actorId: ACTOR,
    });
    expect(res.estMinutes).toBe(20);
  });

  // --- D-#298: delivery-pass attachments (≤5, assignment_attachment kind) ----

  test("D-#298: binds ≤5 assignment_attachment files on the created item", async () => {
    mockScheduleFindOne.mockResolvedValue(scheduleWithEntry());
    const ids = [oid().toString(), oid().toString()];
    mockStoredFind.mockResolvedValue(ids.map((id) => ({ _id: id })));
    await deliverAssignmentItem({
      academicYearId: YEAR, weekNumber: 1, entryId: ENTRY_ID.toString(), roster,
      attachmentIds: ids, actorId: ACTOR,
    });
    expect(mockStoredFind).toHaveBeenCalledWith({ _id: { $in: ids }, kind: "assignment_attachment" });
    const created = mockItemCreate.mock.calls[0][0] as { attachmentIds: mongoose.Types.ObjectId[] };
    expect(created.attachmentIds.map(String)).toEqual(ids);
  });

  test("D-#298: no attachments → StoredFile never queried", async () => {
    mockScheduleFindOne.mockResolvedValue(scheduleWithEntry());
    await deliverAssignmentItem({
      academicYearId: YEAR, weekNumber: 1, entryId: ENTRY_ID.toString(), roster, actorId: ACTOR,
    });
    expect(mockStoredFind).not.toHaveBeenCalled();
  });

  test("D-#298: rejects more than 5 attachments", async () => {
    mockScheduleFindOne.mockResolvedValue(scheduleWithEntry());
    const ids = Array.from({ length: 6 }, () => oid().toString());
    await expect(
      deliverAssignmentItem({
        academicYearId: YEAR, weekNumber: 1, entryId: ENTRY_ID.toString(), roster,
        attachmentIds: ids, actorId: ACTOR,
      }),
    ).rejects.toThrow(/At most 5 attachments/);
  });

  test("D-#298: rejects when any id is not an existing assignment_attachment file", async () => {
    mockScheduleFindOne.mockResolvedValue(scheduleWithEntry());
    const ids = [oid().toString(), oid().toString()];
    mockStoredFind.mockResolvedValue([{ _id: ids[0] }]); // the 2nd is some other kind
    await expect(
      deliverAssignmentItem({
        academicYearId: YEAR, weekNumber: 1, entryId: ENTRY_ID.toString(), roster,
        attachmentIds: ids, actorId: ACTOR,
      }),
    ).rejects.toThrow(/uploaded assignment file/);
  });

  test("double delivery of the same (week × section × subject) is rejected", async () => {
    mockScheduleFindOne.mockResolvedValue(scheduleWithEntry());
    mockItemFindOne.mockResolvedValue({ _id: oid() });
    await expect(
      deliverAssignmentItem({ academicYearId: YEAR, weekNumber: 1, entryId: ENTRY_ID.toString(), roster, actorId: ACTOR }),
    ).rejects.toThrow(/already delivered/);
  });

  test("a suspended (vacation) week rejects delivery", async () => {
    mockScheduleFindOne.mockResolvedValue(scheduleWithEntry());
    mockHolidayFind.mockResolvedValue([
      { fromDate: new Date(2026, 0, 4), toDate: new Date(2026, 0, 10, 23, 59) },
    ]);
    await expect(
      deliverAssignmentItem({ academicYearId: YEAR, weekNumber: 1, entryId: ENTRY_ID.toString(), roster, actorId: ACTOR }),
    ).rejects.toThrow(/suspended/);
  });

  test("week whose cycle week doesn't match the entry is rejected", async () => {
    // week 1 resolves to cycleWeek 2; an entry on cycleWeek 1 must not match.
    mockScheduleFindOne.mockResolvedValue(scheduleWithEntry({ cycleWeek: 1 }));
    await expect(
      deliverAssignmentItem({ academicYearId: YEAR, weekNumber: 1, entryId: ENTRY_ID.toString(), roster, actorId: ACTOR }),
    ).rejects.toThrow(/cycle week/);
  });

  test("an empty roster is rejected (counts must derive from records)", async () => {
    mockScheduleFindOne.mockResolvedValue(scheduleWithEntry());
    await expect(
      deliverAssignmentItem({ academicYearId: YEAR, weekNumber: 1, entryId: ENTRY_ID.toString(), roster: [], actorId: ACTOR }),
    ).rejects.toThrow(/roster/);
  });
});

// ===========================================================================
// AS-T6 — weekly ceiling: confirm gate + reconcile load + trim (AJ-9 / AJ-10)
// ===========================================================================

function draftItem(over: Record<string, unknown> = {}) {
  return {
    _id: oid(),
    asId: "AS-C2-BAN-0001",
    subject: "BAN",
    sectionId: SECTION,
    classId: CLASS,
    dueDate: new Date(2026, 0, 11),
    status: "DRAFT",
    estMinutes: 60,
    draftRoster: [
      { studentId: oid(), present: true },
      { studentId: oid(), present: false },
    ],
    save: jest.fn().mockResolvedValue(true),
    ...over,
  };
}

describe("AJ-9 — confirmAssignmentWeek (360-min weekly gate)", () => {
  const args = { academicYearId: YEAR, sectionId: SECTION.toString(), weekNumber: 1, actorId: ACTOR };

  test("over 360 → HARD-BLOCKED (trim required); no records issued, nothing flipped", async () => {
    const items = [draftItem({ estMinutes: 150 }), draftItem({ estMinutes: 150 }), draftItem({ estMinutes: 90 })]; // 390
    mockItemFind.mockReturnValue(items);
    await expect(confirmAssignmentWeek(args)).rejects.toThrow(/exceeds the 360-min weekly ceiling/);
    expect(mockRecInsertMany).not.toHaveBeenCalled();
    expect(items[0].save).not.toHaveBeenCalled();
  });

  test("≤360 → issues each DRAFT's per-student records (GIVEN/ABSENT_REDELIVER) + flips ISSUED", async () => {
    const a = draftItem({ estMinutes: 60 });
    const b = draftItem({ estMinutes: 60 });
    mockItemFind.mockReturnValue([a, b]); // 120
    const res = await confirmAssignmentWeek(args);
    expect(res.totalMinutes).toBe(120);
    expect(res.itemsIssued).toBe(2);
    expect(res.recordsIssued).toBe(4); // 2 roster rows each
    expect(a.status).toBe("ISSUED");
    expect(a.save).toHaveBeenCalled();
    const docs = mockRecInsertMany.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(docs.some((d) => d.state === "GIVEN")).toBe(true);
    expect(docs.some((d) => d.state === "ABSENT_REDELIVER")).toBe(true);
  });

  test("the cap counts DRAFT + already-ISSUED — it can't be split across confirm batches", async () => {
    mockItemFind.mockReturnValue([draftItem({ status: "ISSUED", estMinutes: 300 }), draftItem({ status: "DRAFT", estMinutes: 75 })]); // 375
    await expect(confirmAssignmentWeek(args)).rejects.toThrow(/exceeds/);
  });

  test("no drafts (already confirmed) and no items (nothing delivered) are rejected clearly", async () => {
    mockItemFind.mockReturnValue([draftItem({ status: "ISSUED" })]);
    await expect(confirmAssignmentWeek(args)).rejects.toThrow(/already confirmed/);
    mockItemFind.mockReturnValue([]);
    await expect(confirmAssignmentWeek(args)).rejects.toThrow(/No assignments delivered/);
  });
});

describe("AS-T6 — assignmentWeekLoad + setAssignmentItemMinutes (reconcile + trim)", () => {
  test("weekLoad sums estMinutes vs the 360 ceiling and flags over-by", async () => {
    mockItemFind.mockReturnValue([
      { _id: oid(), asId: "a", subject: "BAN", estMinutes: 300, status: "ISSUED" },
      { _id: oid(), asId: "b", subject: "MATH", estMinutes: 75, status: "DRAFT" },
    ]);
    const load = await assignmentWeekLoad(YEAR, SECTION.toString(), 1);
    expect(load.totalMinutes).toBe(375);
    expect(load.draftMinutes).toBe(75);
    expect(load.overBy).toBe(15);
    expect(load.withinCeiling).toBe(false);
    expect(load.hasDrafts).toBe(true);
    expect(load.items).toHaveLength(2);
  });

  test("trim lowers a DRAFT item's minutes; an ISSUED item is frozen", async () => {
    const draft = draftItem({ estMinutes: 75 });
    mockItemFindById.mockResolvedValue(draft);
    const r = await setAssignmentItemMinutes(draft._id.toString(), 45);
    expect(r.estMinutes).toBe(45);
    expect(draft.estMinutes).toBe(45);
    expect(draft.save).toHaveBeenCalled();

    mockItemFindById.mockResolvedValue(draftItem({ status: "ISSUED" }));
    await expect(setAssignmentItemMinutes(oid().toString(), 30)).rejects.toThrow(/already issued/);
  });
});

// ===========================================================================
// Redelivery (engine edge ABSENT_REDELIVER → GIVEN)
// ===========================================================================

describe("redeliverAssignmentRecord", () => {
  test("absent student receives later: → GIVEN with the ITEM's due date (item-wide)", async () => {
    const r = rec({ state: "ABSENT_REDELIVER", stateDates: [{ state: "ABSENT_REDELIVER", at: new Date() }], dueDate: undefined });
    mockRecFindById.mockResolvedValue(r);
    mockItemFindById.mockResolvedValue({ _id: r.asItemId, dueDate: new Date(2026, 0, 11) });
    const res = await redeliverAssignmentRecord(r._id.toString(), ACTOR, new Date(2026, 0, 9));
    expect(res.state).toBe("GIVEN");
    expect(res.dueDate!.slice(0, 10)).toBe("2026-01-11"); // NOT next-school-day
  });

  test("redelivering a GIVEN record is rejected (illegal edge)", async () => {
    mockRecFindById.mockResolvedValue(rec({ state: "GIVEN" }));
    await expect(redeliverAssignmentRecord(oid().toString(), ACTOR)).rejects.toThrow(/Illegal lifecycle transition/);
  });
});

// ===========================================================================
// AJ-4 — collection pass + chase
// ===========================================================================

describe("AJ-4 — collectAssignment", () => {
  const ITEM_ID = oid();
  const item = { _id: ITEM_ID, asId: "AS-C2-BAN-0001", dueDate: new Date(2026, 0, 11) };

  test("on the due day: submitted → SUBMITTED; non-submitted stay DUE (not yet past)", async () => {
    mockItemFindById.mockResolvedValue(item);
    const r1 = rec({ asItemId: ITEM_ID });
    const r2 = rec({ asItemId: ITEM_ID });
    mockRecFindById.mockImplementation((id: unknown) =>
      Promise.resolve(id === r1._id.toString() ? r1 : r2),
    );

    const res = await collectAssignment(
      ITEM_ID.toString(),
      [
        { recordId: r1._id.toString(), submitted: true },
        { recordId: r2._id.toString(), submitted: false },
      ],
      ACTOR,
      new Date(2026, 0, 11, 10), // the due day itself
    );

    expect(r1.state).toBe("SUBMITTED");
    expect(r1.stateDates.map((s) => s.state)).toEqual(["GIVEN", "DUE", "SUBMITTED"]); // engine path, stamped
    expect(r2.state).toBe("DUE"); // not past due yet
    expect(res.submittedCount).toBe(1);
    expect(res.chaseCount).toBe(0);
    expect(res.pendingCount).toBe(1);
  });

  test("past the due date: non-submitted → CHASE (chaseCount 1); late submit from CHASE works", async () => {
    mockItemFindById.mockResolvedValue(item);
    const missing = rec({ asItemId: ITEM_ID });
    mockRecFindById.mockResolvedValue(missing);

    const res = await collectAssignment(
      ITEM_ID.toString(),
      [{ recordId: missing._id.toString(), submitted: false }],
      ACTOR,
      new Date(2026, 0, 12, 10), // past due
    );
    expect(missing.state).toBe("CHASE");
    expect(missing.chaseCount).toBe(1);
    expect(res.chaseCount).toBe(1);

    // The chased student submits late: CHASE → SUBMITTED (engine edge)
    const late = await collectAssignment(
      ITEM_ID.toString(),
      [{ recordId: missing._id.toString(), submitted: true }],
      ACTOR,
      new Date(2026, 0, 13, 10),
    );
    expect(missing.state).toBe("SUBMITTED");
    expect(late.submittedCount).toBe(1);
  });

  test("a record from another item is rejected", async () => {
    mockItemFindById.mockResolvedValue(item);
    const foreign = rec({ asItemId: oid() });
    mockRecFindById.mockResolvedValue(foreign);
    await expect(
      collectAssignment(ITEM_ID.toString(), [{ recordId: foreign._id.toString(), submitted: true }], ACTOR),
    ).rejects.toThrow(/does not belong/);
  });
});

describe("sweepAssignmentChases", () => {
  test("every DUE record past its due date → CHASE", async () => {
    const r1 = rec({ state: "DUE", stateDates: [{ state: "GIVEN", at: new Date() }, { state: "DUE", at: new Date() }] });
    const r2 = rec({ state: "DUE", stateDates: [{ state: "GIVEN", at: new Date() }, { state: "DUE", at: new Date() }] });
    mockRecFind.mockReturnValue([r1, r2]);
    const n = await sweepAssignmentChases(new Date(2026, 0, 13));
    expect(n).toBe(2);
    expect(r1.state).toBe("CHASE");
    expect(r2.chaseCount).toBe(1);
    // the filter asked only for past-due DUE records
    const filter = mockRecFind.mock.calls[0][0] as Record<string, unknown>;
    expect(filter.state).toBe("DUE");
  });
});

// ===========================================================================
// Lifecycle edges only via the shared engine (acceptance #3)
// ===========================================================================

describe("transitionAssignmentRecord — engine-guarded", () => {
  test("legal move RETURNED from CHECKED", async () => {
    const r = rec({ state: "CHECKED" });
    mockRecFindById.mockResolvedValue(r);
    const res = await transitionAssignmentRecord(r._id.toString(), "RETURNED", ACTOR);
    expect(res.state).toBe("RETURNED");
  });

  test("illegal move is rejected by the engine", async () => {
    const r = rec({ state: "GIVEN" });
    mockRecFindById.mockResolvedValue(r);
    await expect(
      transitionAssignmentRecord(r._id.toString(), "CHECKED", ACTOR),
    ).rejects.toThrow(/Illegal lifecycle transition/);
  });
});

// ===========================================================================
// Derived counts (acceptance #2 — no count-entry field anywhere)
// ===========================================================================

describe("assignmentItemCounts — derived, never typed", () => {
  test("delivered / not-received / submitted / missing all derive from records", async () => {
    const ITEM_ID = oid();
    mockItemFindById.mockResolvedValue({ _id: ITEM_ID, asId: "AS-C2-BAN-0001" });
    const sMissing = oid();
    mockRecFind.mockReturnValue([
      // delivered + submitted + returned
      rec({ stateDates: [{ state: "GIVEN", at: new Date() }, { state: "DUE", at: new Date() }, { state: "SUBMITTED", at: new Date() }], state: "RETURNED" }),
      // delivered, now chased → on the missing list
      rec({ studentId: sMissing, stateDates: [{ state: "GIVEN", at: new Date() }, { state: "DUE", at: new Date() }, { state: "CHASE", at: new Date() }], state: "CHASE" }),
      // never received yet
      rec({ state: "ABSENT_REDELIVER", stateDates: [{ state: "ABSENT_REDELIVER", at: new Date() }] }),
    ]);
    const c = await assignmentItemCounts(ITEM_ID.toString());
    expect(c.rosterCount).toBe(3);
    expect(c.deliveredCount).toBe(2);
    expect(c.notReceivedCount).toBe(1);
    expect(c.submittedCount).toBe(1);
    expect(c.missingStudentIds).toEqual([sMissing.toString()]); // per student, by id — names join in the resolver
  });
});
