/**
 * D-#290 — reconciliationReport: the Principal/Office "who didn't reconcile?"
 * oversight read. Homework misses per (class, day) — declared items whose day was
 * never confirmed (lockstep with the pendingHomeworkSections rule); assignment
 * misses per (section, week) — delivered items still DRAFT. Rows name the
 * accountable confirmer (homework delegate ?? class teacher).
 *
 * DB-free: models are mocked; the bucketing/enrichment logic is real.
 */
const mockHwItemFind = jest.fn();
const mockHwReconFind = jest.fn();
const mockAsItemFind = jest.fn();
const mockSectionFind = jest.fn();
const mockClassFind = jest.fn();
const mockUserFind = jest.fn();
const mockSlotFind = jest.fn();
const mockHolidayFind = jest.fn();

const chain = (fn: jest.Mock) => (f: unknown) => ({
  lean: () => fn(f),
  select: () => ({ lean: () => fn(f) }),
});

jest.mock("../modules/trackers/models/HomeworkItem", () => ({
  HomeworkItem: { find: (f: unknown) => chain(mockHwItemFind)(f) },
}));
jest.mock("../modules/trackers/models/HomeworkReconciliation", () => ({
  HomeworkReconciliation: { find: (f: unknown) => chain(mockHwReconFind)(f) },
  reconDayKey: (date: Date) => {
    const d = new Date(date.getTime());
    d.setHours(0, 0, 0, 0);
    return d;
  },
}));
jest.mock("../modules/trackers/models/AssignmentItem", () => ({
  AssignmentItem: { find: (f: unknown) => chain(mockAsItemFind)(f) },
}));
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { find: (f: unknown) => chain(mockSectionFind)(f) },
}));
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { find: (f: unknown) => chain(mockClassFind)(f) },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (f: unknown) => chain(mockUserFind)(f) },
}));
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: { find: (f: unknown) => chain(mockSlotFind)(f) },
}));
const mockSubFind = jest.fn();
jest.mock("../modules/routine/models/RoutineSubstitution", () => ({
  RoutineSubstitution: { find: (f: unknown) => chain(mockSubFind)(f) },
}));
jest.mock("../modules/routine/models/HolidayException", () => ({
  HolidayException: { find: (f: unknown) => chain(mockHolidayFind)(f) },
}));
// D-#299 — explicit "no homework today" markers.
const mockNilFind = jest.fn();
jest.mock("../modules/trackers/models/HomeworkNilDeclaration", () => ({
  HomeworkNilDeclaration: { find: (f: unknown) => chain(mockNilFind)(f) },
}));
const mockAsNilFind = jest.fn();
jest.mock("../modules/trackers/models/AssignmentNilDeclaration", () => ({
  AssignmentNilDeclaration: { find: (f: unknown) => chain(mockAsNilFind)(f) },
}));
// D-#309 — assignment declare-pending: schedules enumerate weeks; the expected
// grid itself is the AssignmentScheduleService's (already covered there).
const mockScheduleFind = jest.fn();
jest.mock("../modules/trackers/models/AssignmentSchedule", () => ({
  AssignmentSchedule: { find: (f: unknown) => chain(mockScheduleFind)(f) },
}));
const mockExpectedWeek = jest.fn();
jest.mock("../modules/trackers/services/AssignmentScheduleService", () => ({
  expectedItemsForWeek: (ay: string, w: number) => mockExpectedWeek(ay, w),
}));
// D-#459 — assignment print-gap: which (section, subject) already have a live
// ASSIGNMENT print request for the week's delivery date.
const mockPrintReqFind = jest.fn();
jest.mock("../modules/printing/models/PrintRequest", () => ({
  PrintRequest: { find: (f: unknown) => chain(mockPrintReqFind)(f) },
}));

import { reconciliationReport } from "../modules/trackers/services/ReconReportService";

const SEC = "sec-1";
const CLS = "cls-1";

beforeEach(() => {
  jest.clearAllMocks();
  mockHwItemFind.mockResolvedValue([]);
  mockHwReconFind.mockResolvedValue([]);
  mockAsItemFind.mockResolvedValue([]);
  mockSectionFind.mockResolvedValue([]);
  mockClassFind.mockResolvedValue([]);
  mockUserFind.mockResolvedValue([]);
  mockSlotFind.mockResolvedValue([]);
  mockSubFind.mockResolvedValue([]);
  mockHolidayFind.mockResolvedValue([]);
  mockNilFind.mockResolvedValue([]);
  mockAsNilFind.mockResolvedValue([]);
  mockScheduleFind.mockResolvedValue([]);
  mockExpectedWeek.mockResolvedValue({ suspended: true, deliveryDate: null, items: [] });
  mockPrintReqFind.mockResolvedValue([]);
});

const seedSection = (over: Record<string, unknown> = {}): void => {
  mockSectionFind.mockResolvedValue([
    { _id: SEC, nameBn: "মূল", classId: CLS, classTeacherId: "u-ct", homeworkConfirmerId: null, ...over },
  ]);
  mockClassFind.mockResolvedValue([{ _id: CLS, level: -1 }]);
  mockUserFind.mockResolvedValue([
    { _id: "u-ct", name: "Sajeda Jannat" },
    { _id: "u-del", name: "Delegate D" },
  ]);
};

describe("reconciliationReport (D-#290)", () => {
  test("empty world → empty report, range echoed back", async () => {
    const r = await reconciliationReport("2026-07-07", "2026-07-13");
    expect(r).toEqual({
      fromKey: "2026-07-07",
      toKey: "2026-07-13",
      hwMisses: [],
      asMisses: [],
      hwNotDeclared: [],
      hwNilDeclared: [],
      asNilDeclared: [],
      asNotDeclared: [],
      asNotPrinted: [],
    });
  });

  test("from after to is rejected", async () => {
    await expect(reconciliationReport("2026-07-13", "2026-07-07")).rejects.toThrow("from must not be after to");
  });

  test("declared-but-unconfirmed homework buckets per (class, day) with confirmer name", async () => {
    seedSection();
    mockHwItemFind.mockResolvedValue([
      { classId: CLS, sectionId: SEC, dateGiven: new Date(2026, 6, 9), timeDecl: 60 },
      { classId: CLS, sectionId: SEC, dateGiven: new Date(2026, 6, 9), timeDecl: 20 },
      { classId: CLS, sectionId: SEC, dateGiven: new Date(2026, 6, 12), timeDecl: 30 },
    ]);
    const r = await reconciliationReport("2026-07-07", "2026-07-13");
    expect(r.hwMisses).toHaveLength(2);
    // Newest day first.
    expect(r.hwMisses[0]).toMatchObject({
      dateKey: "2026-07-12",
      sectionNameBn: "মূল",
      classLevel: -1,
      confirmerName: "Sajeda Jannat",
      declaredItems: 1,
      declaredMinutes: 30,
    });
    expect(r.hwMisses[1]).toMatchObject({ dateKey: "2026-07-09", declaredItems: 2, declaredMinutes: 80 });
  });

  test("a reconciled day drops out (lockstep with the reminder ladder)", async () => {
    seedSection();
    mockHwItemFind.mockResolvedValue([
      { classId: CLS, sectionId: SEC, dateGiven: new Date(2026, 6, 9), timeDecl: 60 },
      { classId: CLS, sectionId: SEC, dateGiven: new Date(2026, 6, 12), timeDecl: 30 },
    ]);
    mockHwReconFind.mockResolvedValue([{ classId: CLS, reconDate: new Date(2026, 6, 9) }]);
    const r = await reconciliationReport("2026-07-07", "2026-07-13");
    expect(r.hwMisses).toHaveLength(1);
    expect(r.hwMisses[0].dateKey).toBe("2026-07-12");
  });

  test("the homework delegate outranks the class teacher as the named confirmer", async () => {
    seedSection({ homeworkConfirmerId: "u-del" });
    mockHwItemFind.mockResolvedValue([
      { classId: CLS, sectionId: SEC, dateGiven: new Date(2026, 6, 9), timeDecl: 60 },
    ]);
    const r = await reconciliationReport("2026-07-07", "2026-07-13");
    expect(r.hwMisses[0].confirmerName).toBe("Delegate D");
  });

  test("DRAFT assignment items bucket per (section, week); confirmer = class teacher", async () => {
    seedSection();
    mockAsItemFind.mockResolvedValue([
      { sectionId: SEC, weekNumber: 5, deliveryDate: new Date(2026, 6, 8), estMinutes: 40 },
      { sectionId: SEC, weekNumber: 5, deliveryDate: new Date(2026, 6, 8), estMinutes: 20 },
    ]);
    const r = await reconciliationReport("2026-07-07", "2026-07-13");
    expect(r.asMisses).toHaveLength(1);
    expect(r.asMisses[0]).toMatchObject({
      weekNumber: 5,
      deliveryDateKey: "2026-07-08",
      sectionNameBn: "মূল",
      confirmerName: "Sajeda Jannat",
      draftItems: 2,
      draftMinutes: 60,
    });
  });

  test("a section with NO class teacher reports a null confirmer (the report's point)", async () => {
    mockSectionFind.mockResolvedValue([
      { _id: SEC, nameBn: "মূল", classId: CLS, classTeacherId: null, homeworkConfirmerId: null },
    ]);
    mockClassFind.mockResolvedValue([{ _id: CLS, level: -1 }]);
    mockHwItemFind.mockResolvedValue([
      { classId: CLS, sectionId: SEC, dateGiven: new Date(2026, 6, 9), timeDecl: 60 },
    ]);
    const r = await reconciliationReport("2026-07-07", "2026-07-13");
    expect(r.hwMisses[0].confirmerName).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// D-#293 — homework never DECLARED (routine-expected, per class × subject × day)
// ---------------------------------------------------------------------------

describe("hwNotDeclared (D-#293)", () => {
  const NOW = new Date(2026, 6, 13); // Mon 2026-07-13
  const sciSlot = (over: Record<string, unknown> = {}) => ({
    _id: "slot-sci",
    groupId: SEC,
    dayOfWeek: "THU",
    periodNumber: 5,
    subject: "SCI",
    teacherId: "u-sci",
    effectiveFrom: new Date(2026, 0, 1),
    effectiveTo: null,
    ...over,
  });

  test("a routine-expected subject with NO declaration that day is reported with its teacher", async () => {
    seedSection();
    mockSlotFind.mockResolvedValue([sciSlot()]);
    mockUserFind.mockResolvedValue([{ _id: "u-sci", name: "Husne ara Rahman Fida" }]);

    const r = await reconciliationReport("2026-07-07", "2026-07-13", NOW);
    // Thu 2026-07-09 is the only FULL day in range with a SCI period and no declaration.
    expect(r.hwNotDeclared).toHaveLength(1);
    expect(r.hwNotDeclared[0]).toMatchObject({
      dateKey: "2026-07-09",
      sectionId: SEC,
      subject: "SCI",
      teacherName: "Husne ara Rahman Fida",
      classLevel: -1,
    });
  });

  test("an active cover for that DATE is named instead of the absent routine teacher", async () => {
    // Owner report 2026-08-03: Fida was on approved leave with Tamany as her approved
    // proxy, and the red row still chased Fida. Whoever taught the period owes the
    // declaration, so the cover must win for that date.
    seedSection();
    mockSlotFind.mockResolvedValue([sciSlot()]);
    mockSubFind.mockResolvedValue([
      { slotId: "slot-sci", date: new Date(2026, 6, 9), coverTeacherId: "u-cover" },
    ]);
    mockUserFind.mockResolvedValue([
      { _id: "u-sci", name: "Husne ara Rahman Fida" },
      { _id: "u-cover", name: "Nuha Kalam Tamany" },
    ]);

    const r = await reconciliationReport("2026-07-07", "2026-07-13", NOW);
    expect(r.hwNotDeclared).toHaveLength(1);
    expect(r.hwNotDeclared[0]).toMatchObject({
      dateKey: "2026-07-09",
      subject: "SCI",
      teacherName: "Nuha Kalam Tamany",
    });
  });

  test("a cover on a DIFFERENT date leaves the routine teacher named", async () => {
    // The cover is per-date, not standing — a Thursday substitution must not rewrite
    // who owes a different day's declaration.
    seedSection();
    mockSlotFind.mockResolvedValue([sciSlot()]);
    mockSubFind.mockResolvedValue([
      { slotId: "slot-sci", date: new Date(2026, 6, 2), coverTeacherId: "u-cover" },
    ]);
    mockUserFind.mockResolvedValue([
      { _id: "u-sci", name: "Husne ara Rahman Fida" },
      { _id: "u-cover", name: "Nuha Kalam Tamany" },
    ]);

    const r = await reconciliationReport("2026-07-07", "2026-07-13", NOW);
    expect(r.hwNotDeclared[0]).toMatchObject({ dateKey: "2026-07-09", teacherName: "Husne ara Rahman Fida" });
  });

  test("D-#299: an explicit nil declaration moves the cell out of the red list into hwNilDeclared", async () => {
    seedSection();
    mockSlotFind.mockResolvedValue([sciSlot()]);
    mockUserFind.mockResolvedValue([{ _id: "u-sci", name: "Husne ara Rahman Fida" }]);
    mockNilFind.mockResolvedValue([
      {
        sectionId: SEC,
        classId: CLS,
        subject: "SCI",
        dateKey: "2026-07-09",
        reason: "EXAM",
        declaredBy: "u-sci",
      },
    ]);
    const r = await reconciliationReport("2026-07-07", "2026-07-13", NOW);
    expect(r.hwNotDeclared).toEqual([]); // deliberately none — never red
    expect(r.hwNilDeclared).toHaveLength(1);
    expect(r.hwNilDeclared[0]).toMatchObject({
      dateKey: "2026-07-09",
      sectionId: SEC,
      subject: "SCI",
      reason: "EXAM",
      teacherName: "Husne ara Rahman Fida",
      classLevel: -1,
    });
  });

  test("a declaration that day clears the cell (any status)", async () => {
    seedSection();
    mockSlotFind.mockResolvedValue([sciSlot()]);
    mockHwItemFind.mockResolvedValue([
      { classId: CLS, sectionId: SEC, subject: "SCI", dateGiven: new Date(2026, 6, 9), timeDecl: 30 },
    ]);
    const r = await reconciliationReport("2026-07-07", "2026-07-13", NOW);
    expect(r.hwNotDeclared).toEqual([]);
  });

  test("non-FULL days owe nothing (a Friday period never reports)", async () => {
    seedSection();
    mockSlotFind.mockResolvedValue([sciSlot({ dayOfWeek: "FRI" })]); // 2026-07-10 is a Friday
    const r = await reconciliationReport("2026-07-07", "2026-07-13", NOW);
    expect(r.hwNotDeclared).toEqual([]);
  });

  test("future days are never reported", async () => {
    seedSection();
    mockSlotFind.mockResolvedValue([sciSlot()]);
    // "Today" is Wed 07-08 — the Thu 07-09 period is still in the future.
    const r = await reconciliationReport("2026-07-07", "2026-07-13", new Date(2026, 6, 8));
    expect(r.hwNotDeclared).toEqual([]);
  });

  test("a teacherless slot reports the cell with a null teacher", async () => {
    seedSection();
    mockSlotFind.mockResolvedValue([sciSlot({ teacherId: null })]);
    const r = await reconciliationReport("2026-07-07", "2026-07-13", NOW);
    expect(r.hwNotDeclared).toHaveLength(1);
    expect(r.hwNotDeclared[0].teacherName).toBeNull();
  });

  test("D-#308: ARABIC is never routine-EXPECTED — the slot query excludes it", async () => {
    seedSection();
    await reconciliationReport("2026-07-07", "2026-07-13", NOW);
    const [filter] = mockSlotFind.mock.calls[0] as [{ subject: { $in: string[] } }];
    expect(filter.subject.$in).not.toContain("ARABIC");
    // Every other HW subject stays expected.
    expect(filter.subject.$in).toEqual(expect.arrayContaining(["BAN", "ENG", "MATH", "SCI", "BGS", "ISLAM"]));
  });
});

// ---------------------------------------------------------------------------
// D-#309 — assignment declare-pending (rotation-expected, per section × subject × week)
// ---------------------------------------------------------------------------

describe("asNotDeclared (D-#309)", () => {
  const NOW = new Date(2026, 6, 13); // Mon 2026-07-13
  const TERM = new Date(2026, 6, 5); // Sun 2026-07-05 → week 1 = Jul 5–11, week 2 = Jul 12–18

  const expectedWeek = (weekNumber: number, over: Record<string, unknown> = {}) => ({
    weekNumber,
    weekStart: weekNumber === 1 ? "2026-07-05" : "2026-07-12",
    suspended: false,
    deliveryDate: weekNumber === 1 ? "2026-07-09" : "2026-07-16",
    items: [] as unknown[],
    ...over,
  });

  test("a rotation cell with no item reports once the week's delivery date passed", async () => {
    seedSection();
    mockUserFind.mockResolvedValue([{ _id: "u-as", name: "Tanjila Akter Jerin" }]);
    mockScheduleFind.mockResolvedValue([{ academicYearId: "ay-1", termStartDate: TERM }]);
    mockExpectedWeek.mockImplementation((_ay: string, w: number) =>
      Promise.resolve(
        expectedWeek(w, {
          items: [
            { delivered: false, sectionId: SEC, classLevel: -1, subject: "ENG", teacherId: "u-as" },
            { delivered: true, sectionId: SEC, classLevel: -1, subject: "MATH", teacherId: "u-as" },
          ],
        }),
      ),
    );
    const r = await reconciliationReport("2026-07-07", "2026-07-13", NOW);
    // Week 1 (delivery 07-09, past) reports the undeclared ENG cell; the delivered
    // MATH cell and week 2 (delivery 07-16, not late yet) stay silent.
    expect(r.asNotDeclared).toHaveLength(1);
    expect(r.asNotDeclared[0]).toMatchObject({
      weekNumber: 1,
      weekStartKey: "2026-07-05",
      deliveryDateKey: "2026-07-09",
      sectionId: SEC,
      sectionNameBn: "মূল",
      classLevel: -1,
      subject: "ENG",
      teacherName: "Tanjila Akter Jerin",
    });
  });

  // Regression (owner finding 2026-07-23): the real expectedItemsForWeek returns
  // dateOnlyISO() — a FULL instant — while these mocks used a bare date key, so the
  // "not late yet" string compare ("2026-07-23T00:00:00.000Z" > "2026-07-23" === true)
  // silently hid every undelivered cell on its own delivery day. These two pin the
  // real format down.
  const isoWeek = (w: number, over: Record<string, unknown> = {}) =>
    expectedWeek(w, {
      deliveryDate: w === 1 ? "2026-07-09T00:00:00.000Z" : "2026-07-16T00:00:00.000Z",
      ...over,
    });

  test("the DELIVERY DAY itself reports (full-ISO delivery instant vs date key)", async () => {
    seedSection();
    mockUserFind.mockResolvedValue([{ _id: "u-as", name: "Tanjila Akter Jerin" }]);
    mockScheduleFind.mockResolvedValue([{ academicYearId: "ay-1", termStartDate: TERM }]);
    mockExpectedWeek.mockImplementation((_ay: string, w: number) =>
      Promise.resolve(
        isoWeek(w, {
          items: [{ delivered: false, sectionId: SEC, classLevel: -1, subject: "ARABIC", teacherId: "u-as" }],
        }),
      ),
    );
    const DELIVERY_DAY = new Date(2026, 6, 16); // Thu 2026-07-16 — week 2's delivery date
    const r = await reconciliationReport("2026-07-16", "2026-07-16", DELIVERY_DAY);

    expect(r.asNotDeclared).toHaveLength(1);
    expect(r.asNotDeclared[0]).toMatchObject({
      weekNumber: 2,
      subject: "ARABIC",
      deliveryDateKey: "2026-07-16", // a KEY, never the raw instant
    });
  });

  test("a delivery date still in the FUTURE stays silent", async () => {
    seedSection();
    mockScheduleFind.mockResolvedValue([{ academicYearId: "ay-1", termStartDate: TERM }]);
    mockExpectedWeek.mockImplementation((_ay: string, w: number) =>
      Promise.resolve(
        isoWeek(w, {
          items: [{ delivered: false, sectionId: SEC, classLevel: -1, subject: "ARABIC", teacherId: "u-as" }],
        }),
      ),
    );
    // Mon 2026-07-13 sits inside week 2, whose delivery is Thu 2026-07-16.
    const r = await reconciliationReport("2026-07-13", "2026-07-13", new Date(2026, 6, 13));
    expect(r.asNotDeclared).toEqual([]);
  });

  test("an explicit no-assignment declaration moves the cell out of the red list into asNilDeclared", async () => {
    seedSection();
    mockUserFind.mockResolvedValue([{ _id: "u-as", name: "Tanjila Akter Jerin" }]);
    mockScheduleFind.mockResolvedValue([{ academicYearId: "ay-1", termStartDate: TERM }]);
    mockAsNilFind.mockResolvedValue([
      {
        weekNumber: 1,
        weekStartKey: "2026-07-05",
        deliveryDateKey: "2026-07-09",
        sectionId: SEC,
        classLevel: -1,
        subject: "ENG",
        declaredBy: "u-as",
        reason: "REVISION",
      },
    ]);
    mockExpectedWeek.mockImplementation((_ay: string, w: number) =>
      Promise.resolve(
        expectedWeek(w, {
          items: [
            {
              delivered: false,
              nilDeclared: true,
              sectionId: SEC,
              classLevel: -1,
              subject: "ENG",
              teacherId: "u-as",
            },
          ],
        }),
      ),
    );

    const r = await reconciliationReport("2026-07-07", "2026-07-13", NOW);
    expect(r.asNotDeclared).toEqual([]);
    expect(r.asNilDeclared).toHaveLength(1);
    expect(r.asNilDeclared[0]).toMatchObject({
      weekNumber: 1,
      deliveryDateKey: "2026-07-09",
      sectionId: SEC,
      subject: "ENG",
      teacherName: "Tanjila Akter Jerin",
      reason: "REVISION",
    });
  });

  test("suspended weeks owe nothing", async () => {
    seedSection();
    mockScheduleFind.mockResolvedValue([{ academicYearId: "ay-1", termStartDate: TERM }]);
    mockExpectedWeek.mockResolvedValue(
      expectedWeek(1, {
        suspended: true,
        deliveryDate: null,
        items: [{ delivered: false, sectionId: SEC, classLevel: -1, subject: "ENG", teacherId: "u-as" }],
      }),
    );
    const r = await reconciliationReport("2026-07-07", "2026-07-13", NOW);
    expect(r.asNotDeclared).toEqual([]);
  });

  test("no schedule → no expectation (never throws)", async () => {
    seedSection();
    mockScheduleFind.mockResolvedValue([]);
    const r = await reconciliationReport("2026-07-07", "2026-07-13", NOW);
    expect(r.asNotDeclared).toEqual([]);
    expect(mockExpectedWeek).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// D-#459 — assignment print-gap (rotation-expected, per section × subject × week,
// no matching ASSIGNMENT print request)
// ---------------------------------------------------------------------------

describe("asNotPrinted (D-#459)", () => {
  const NOW = new Date(2026, 6, 13); // Mon 2026-07-13
  const TERM = new Date(2026, 6, 5); // week 1 = Jul 5–11 (delivery 07-09), week 2 = Jul 12–18 (delivery 07-16)

  const expectedWeek = (weekNumber: number, over: Record<string, unknown> = {}) => ({
    weekNumber,
    weekStart: weekNumber === 1 ? "2026-07-05" : "2026-07-12",
    suspended: false,
    deliveryDate: weekNumber === 1 ? "2026-07-09" : "2026-07-16",
    items: [] as unknown[],
    ...over,
  });
  const engItem = (over: Record<string, unknown> = {}) => ({
    delivered: true, // D-#459: printing is checked regardless of the declared flag
    nilDeclared: false,
    classId: CLS,
    sectionId: SEC,
    classLevel: -1,
    subject: "ENG",
    teacherId: "u-as",
    ...over,
  });

  beforeEach(() => {
    seedSection();
    mockUserFind.mockResolvedValue([{ _id: "u-as", name: "Tanjila Akter Jerin" }]);
    mockScheduleFind.mockResolvedValue([{ academicYearId: "ay-1", termStartDate: TERM }]);
  });

  test("a rotation cell with NO matching print request reports once the delivery date passed", async () => {
    mockExpectedWeek.mockImplementation((_ay: string, w: number) =>
      Promise.resolve(expectedWeek(w, { items: w === 1 ? [engItem()] : [] })),
    );
    mockPrintReqFind.mockResolvedValue([]);
    const r = await reconciliationReport("2026-07-07", "2026-07-13", NOW);
    expect(r.asNotPrinted).toHaveLength(1);
    expect(r.asNotPrinted[0]).toMatchObject({
      weekNumber: 1,
      deliveryDateKey: "2026-07-09",
      sectionId: SEC,
      sectionNameBn: "মূল",
      classLevel: -1,
      subject: "ENG",
      teacherName: "Tanjila Akter Jerin",
    });
  });

  test("delivered=true does NOT suppress the gap — printing is a separate obligation", async () => {
    // The AssignmentItem was declared (delivered: true), yet no print request exists.
    // asNotDeclared would stay silent here; asNotPrinted must still report it.
    mockExpectedWeek.mockImplementation((_ay: string, w: number) =>
      Promise.resolve(expectedWeek(w, { items: w === 1 ? [engItem({ delivered: true })] : [] })),
    );
    mockPrintReqFind.mockResolvedValue([]);
    const r = await reconciliationReport("2026-07-07", "2026-07-13", NOW);
    expect(r.asNotDeclared).toEqual([]);
    expect(r.asNotPrinted).toHaveLength(1);
  });

  test("a matching non-cancelled ASSIGNMENT print request clears the gap", async () => {
    mockExpectedWeek.mockImplementation((_ay: string, w: number) =>
      Promise.resolve(expectedWeek(w, { items: w === 1 ? [engItem()] : [] })),
    );
    mockPrintReqFind.mockResolvedValue([{ sectionId: SEC, subject: "ENG" }]);
    const r = await reconciliationReport("2026-07-07", "2026-07-13", NOW);
    expect(r.asNotPrinted).toEqual([]);
  });

  test("a print request tagged to a DIFFERENT section leaves the gap open", async () => {
    mockExpectedWeek.mockImplementation((_ay: string, w: number) =>
      Promise.resolve(expectedWeek(w, { items: w === 1 ? [engItem()] : [] })),
    );
    mockPrintReqFind.mockResolvedValue([{ sectionId: "sec-other", subject: "ENG" }]);
    const r = await reconciliationReport("2026-07-07", "2026-07-13", NOW);
    expect(r.asNotPrinted).toHaveLength(1);
  });

  test("a print request tagged to a DIFFERENT subject leaves the gap open", async () => {
    mockExpectedWeek.mockImplementation((_ay: string, w: number) =>
      Promise.resolve(expectedWeek(w, { items: w === 1 ? [engItem()] : [] })),
    );
    mockPrintReqFind.mockResolvedValue([{ sectionId: SEC, subject: "MATH" }]);
    const r = await reconciliationReport("2026-07-07", "2026-07-13", NOW);
    expect(r.asNotPrinted).toHaveLength(1);
  });

  test("the query scopes to ASSIGNMENT, the delivery date, and excludes CANCELLED", async () => {
    mockExpectedWeek.mockImplementation((_ay: string, w: number) =>
      Promise.resolve(expectedWeek(w, { items: w === 1 ? [engItem()] : [] })),
    );
    mockPrintReqFind.mockResolvedValue([]);
    await reconciliationReport("2026-07-07", "2026-07-13", NOW);
    const [filter] = mockPrintReqFind.mock.calls[0] as [Record<string, unknown>];
    expect(filter).toMatchObject({ purpose: "ASSIGNMENT", neededByKey: "2026-07-09", status: { $ne: "CANCELLED" } });
  });

  test("an explicit no-assignment declaration owes no print either — never a gap", async () => {
    mockExpectedWeek.mockImplementation((_ay: string, w: number) =>
      Promise.resolve(expectedWeek(w, { items: w === 1 ? [engItem({ nilDeclared: true })] : [] })),
    );
    const r = await reconciliationReport("2026-07-07", "2026-07-13", NOW);
    expect(r.asNotPrinted).toEqual([]);
  });

  test("suspended weeks owe nothing", async () => {
    mockExpectedWeek.mockResolvedValue(
      expectedWeek(1, { suspended: true, deliveryDate: null, items: [engItem()] }),
    );
    const r = await reconciliationReport("2026-07-07", "2026-07-13", NOW);
    expect(r.asNotPrinted).toEqual([]);
  });

  test("a delivery date still in the FUTURE stays silent", async () => {
    mockExpectedWeek.mockImplementation((_ay: string, w: number) =>
      Promise.resolve(expectedWeek(w, { items: [engItem()] })),
    );
    // Mon 2026-07-13 sits inside week 2, whose delivery is Thu 2026-07-16.
    const r = await reconciliationReport("2026-07-13", "2026-07-13", new Date(2026, 6, 13));
    expect(r.asNotPrinted).toEqual([]);
  });

  test("no schedule → no expectation (never throws)", async () => {
    mockScheduleFind.mockResolvedValue([]);
    const r = await reconciliationReport("2026-07-07", "2026-07-13", NOW);
    expect(r.asNotPrinted).toEqual([]);
    expect(mockPrintReqFind).not.toHaveBeenCalled();
  });
});
