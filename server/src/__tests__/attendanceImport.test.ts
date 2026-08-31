/**
 * AT-1 — teacher-attendance Excel import (prd-attendance §4/§6, D-#63/#67).
 *
 * Pure layers (grid parser, legend mapping, year inference, name reconciliation,
 * summary roll-up) are exercised directly; the import service runs against
 * mocked Mongoose models (DB-free, like sectionMerge.test.ts). One round-trip
 * test builds a real in-memory .xlsx through exceljs to execute the workbook
 * path the upload uses.
 */
import mongoose from "mongoose";
import ExcelJS from "exceljs";
import {
  parseAttendanceGrid,
  parseAttendanceGridRange,
  parseDayCell,
  inferSheetDate,
  parseEmployeeAttendanceXlsx,
  AttendanceParseError,
} from "../modules/attendance/excel";
import { normalizeName, matchName, indexProfilesByName } from "../modules/attendance/reconcile";
import { dateKeyOf, parseDateKey, dateKeysBetween } from "../modules/attendance/dates";

// ---------------------------------------------------------------------------
// Service-layer mocks
// ---------------------------------------------------------------------------

const mockStaffFind = jest.fn();
const mockStaffFindById = jest.fn();
const mockAliasFind = jest.fn();
const mockAliasUpdateOne = jest.fn().mockResolvedValue({});
const mockDayCount = jest.fn();
const mockDayDeleteMany = jest.fn().mockResolvedValue({});
const mockDayInsertMany = jest.fn().mockResolvedValue([]);
const mockWriteAudit = jest.fn().mockResolvedValue(undefined);

jest.mock("../modules/foundation/models/StaffProfile", () => ({
  StaffProfile: {
    find: (f: unknown) => mockStaffFind(f),
    findById: (id: unknown) => ({ lean: () => mockStaffFindById(id) }),
  },
}));
jest.mock("../modules/attendance/models/StaffNameAlias", () => ({
  StaffNameAlias: {
    find: (f: unknown) => mockAliasFind(f),
    updateOne: (f: unknown, u: unknown, o: unknown) => mockAliasUpdateOne(f, u, o),
  },
}));
jest.mock("../modules/attendance/models/TeacherAttendanceDay", () => ({
  TeacherAttendanceDay: {
    countDocuments: (f: unknown) => mockDayCount(f),
    deleteMany: (f: unknown) => mockDayDeleteMany(f),
    insertMany: (d: unknown) => mockDayInsertMany(d),
  },
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));

import {
  commitImport,
  summarizeStatuses,
  AttendanceImportError,
} from "../modules/attendance/services/TeacherAttendanceService";

const selectLean = (rows: unknown[]) => ({
  select: () => ({ lean: () => Promise.resolve(rows) }),
  lean: () => Promise.resolve(rows),
});

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// Pure: date keys
// ---------------------------------------------------------------------------

describe("date keys", () => {
  test("round-trips a local date", () => {
    expect(dateKeyOf(new Date(2026, 5, 11))).toBe("2026-06-11");
    expect(parseDateKey("2026-06-11").getDate()).toBe(11);
  });

  test("rejects malformed and impossible keys", () => {
    expect(() => parseDateKey("2026-6-11")).toThrow();
    expect(() => parseDateKey("2026-02-31")).toThrow();
  });

  test("dateKeysBetween is inclusive", () => {
    expect(dateKeysBetween("2026-06-09", "2026-06-11")).toEqual([
      "2026-06-09",
      "2026-06-10",
      "2026-06-11",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Pure: legend + punches (§4)
// ---------------------------------------------------------------------------

describe("parseDayCell — the §4 legend", () => {
  test("✔ with one punch → PRESENT", () => {
    const r = parseDayCell("\n ✔ \n 06:53 AM \n");
    expect(r).toEqual({ mark: "PRESENT", punchIn: "06:53 AM", punchOut: undefined });
  });

  test("✔ with both punches stores in AND out", () => {
    const r = parseDayCell("✔ 06:39 AM 08:37 AM");
    expect(r.punchIn).toBe("06:39 AM");
    expect(r.punchOut).toBe("08:37 AM");
  });

  test("𝓛 → LATE straight from the symbol (no grace computation, AT1.3)", () => {
    expect(parseDayCell("𝓛 07:05 AM").mark).toBe("LATE");
  });

  test("✘ → CROSS (LEAVE/ABSENT resolved later, AT1.4)", () => {
    expect(parseDayCell("✘").mark).toBe("CROSS");
  });

  /**
   * D-#609. This test used to assert `℞ → SKIP` on the reading that ℞ meant "regular",
   * and it is why the bug survived: the mistake was in the legend, so a test written
   * from the same legend agreed with it. What settled it was the year-to-date export —
   * ℞ carries half-day marks that only reconcile against the report's own totals as
   * 0.5, and 106 of its 117 ℞ cells have no punch at all — plus the owner confirming
   * that one person's 30 ℞ days were her unpaid leave.
   */
  test("℞ → LEAVE, and ℞◑ / ℞◐ is half a day", () => {
    expect(parseDayCell("℞").mark).toBe("LEAVE");
    expect(parseDayCell("℞ 07:00 AM").mark).toBe("LEAVE");
    expect(parseDayCell("℞").halfDay).toBeUndefined();
    expect(parseDayCell("℞◑ 06:45 AM 07:30 PM").halfDay).toBe(true);
    expect(parseDayCell("℞◐ 06:00 AM 03:45 PM").halfDay).toBe(true);
    // A half-day mark on anything else is not a half day of leave.
    expect(parseDayCell("✔◑ 07:00 AM").halfDay).toBeUndefined();
  });

  test("an empty cell still SKIPs — no school that day", () => {
    expect(parseDayCell("").mark).toBe("SKIP");
    expect(parseDayCell("‌").mark).toBe("SKIP");
  });
});

describe("inferSheetDate — year-less header (AT1.1)", () => {
  test("same year when the sheet date is past/today", () => {
    expect(dateKeyOf(inferSheetDate(5, 11, new Date(2026, 5, 12)))).toBe("2026-06-11");
  });

  test("previous year when the month/day would be in the future (Dec sheet in Jan)", () => {
    expect(dateKeyOf(inferSheetDate(11, 30, new Date(2026, 0, 2)))).toBe("2025-12-30");
  });

  test("one day of slack tolerates clock skew", () => {
    expect(dateKeyOf(inferSheetDate(5, 12, new Date(2026, 5, 11)))).toBe("2026-06-12");
  });
});

// ---------------------------------------------------------------------------
// Pure: grid parser (LOCKED layout, §4)
// ---------------------------------------------------------------------------

const HEADER = ["Branch", "Shift", "Name", "Summary", "Jun     11     Thu", "WD", "✔", "✘", "𝓛", "℞"];
const grid = (rows: string[][]) => [
  ["Employee Attendance Report - School for Community Development"],
  HEADER,
  ...rows,
];

describe("parseAttendanceGrid", () => {
  const REF = new Date(2026, 5, 12);

  test("reads the date from the SHEET header, not the reference (AT1.1)", () => {
    const sheet = parseAttendanceGrid(
      grid([["Sylhet", "Syl Morning Shift 7:00-12:00", "Afia Loskor", "…", "✔ 06:43 AM", "1"]]),
      REF,
    );
    expect(sheet.dateKey).toBe("2026-06-11");
    expect(sheet.rows).toEqual([
      {
        name: "Afia Loskor",
        shift: "Syl Morning Shift 7:00-12:00",
        mark: "PRESENT",
        punchIn: "06:43 AM",
        punchOut: undefined,
      },
    ]);
  });

  test("skips the totals row (empty Name) and keeps ✘/𝓛 rows", () => {
    const sheet = parseAttendanceGrid(
      grid([
        ["Sylhet", "", "Tahia Tuz Chara", "…", "✘", "1"],
        ["Sylhet", "Syl Morning Shift 7:00-12:00", "Hamida Akter", "…", "𝓛 07:05 AM", "1"],
        ["", "", "", "20 (87%) …", "1"],
      ]),
      REF,
    );
    expect(sheet.rows.map((r) => r.mark)).toEqual(["CROSS", "LATE"]);
  });

  test("rejects a sheet without a Name header / dated column / data rows", () => {
    expect(() => parseAttendanceGrid([["nope"]], REF)).toThrow(AttendanceParseError);
    expect(() =>
      parseAttendanceGrid([["Branch", "Shift", "Name", "Summary", "NotADate"]], REF),
    ).toThrow(AttendanceParseError);
    expect(() => parseAttendanceGrid(grid([]), REF)).toThrow(AttendanceParseError);
  });
});

describe("parseEmployeeAttendanceXlsx — exceljs round-trip", () => {
  test("parses a workbook built in memory", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["Employee Attendance Report - School for Community Development"]);
    ws.addRow(HEADER);
    ws.addRow(["Sylhet", "Syl Both Shift 7:00-5:30", "Akter Hossen", "…", "✔ 06:53 AM", "1"]);
    ws.addRow(["Sylhet", "", "Shah Mahfuj Ahmed", "…", "✘", "1"]);
    ws.addRow(["", "", "", "totals", "1"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const sheet = await parseEmployeeAttendanceXlsx(buf, new Date(2026, 5, 12));
    expect(sheet.dateKey).toBe("2026-06-11");
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[0]).toMatchObject({ name: "Akter Hossen", mark: "PRESENT", punchIn: "06:53 AM" });
    expect(sheet.rows[1]).toMatchObject({ name: "Shah Mahfuj Ahmed", mark: "CROSS" });
  });

  test("rejects a non-xlsx buffer", async () => {
    await expect(parseEmployeeAttendanceXlsx(Buffer.from("not an xlsx"))).rejects.toThrow(
      AttendanceParseError,
    );
  });
});

// ---------------------------------------------------------------------------
// Pure: the year-to-date range parser (D-#610)
// ---------------------------------------------------------------------------

/** The same locked layout, with one dated column per day. */
const RANGE_HEADER = [
  "Branch", "Shift", "Name", "Summary",
  "Jan     27     Tue", "Jun     11     Thu", "Jan     2     Fri",
  "WD", "✔", "✘", "𝓛", "℞",
];
const rangeGrid = (rows: string[][]) => [
  ["Employee Attendance Report - School for Community Development"],
  RANGE_HEADER,
  ...rows,
];

describe("parseAttendanceGridRange — the year-to-date export", () => {
  const REF = new Date(2026, 5, 12);

  test("reads EVERY dated column, oldest first", () => {
    const sheets = parseAttendanceGridRange(
      rangeGrid([["Sylhet", "", "Afia Loskor", "…", "✔ 06:43 AM", "℞", "✘", "1"]]),
      REF,
    );
    expect(sheets.map((s) => s.dateKey)).toEqual(["2026-01-02", "2026-01-27", "2026-06-11"]);
    // The export orders its columns oddly — the school's runs Jan 27 → Aug 31 and then
    // wraps back to Jan 1 → Jan 26 — so the sort is what makes a backfill sequential.
    expect(sheets.map((s) => s.rows[0].mark)).toEqual(["CROSS", "PRESENT", "LEAVE"]);
  });

  test("the summary columns (WD / ✔ / ✘ / 𝓛 / ℞) are not mistaken for dates", () => {
    const sheets = parseAttendanceGridRange(
      rangeGrid([["Sylhet", "", "Afia Loskor", "…", "✔", "✔", "✔", "131", "128", "5", "28", "9.5"]]),
      REF,
    );
    expect(sheets).toHaveLength(3);
  });

  test("each column's year is inferred on its own, so a range can straddle December", () => {
    const header = ["Branch", "Shift", "Name", "Summary", "Dec     30     Tue", "Jan     2     Fri"];
    const sheets = parseAttendanceGridRange(
      [["title"], header, ["Sylhet", "", "Afia Loskor", "…", "✔", "✔"]],
      new Date(2026, 0, 5),
    );
    expect(sheets.map((s) => s.dateKey)).toEqual(["2025-12-30", "2026-01-02"]);
  });

  test("two columns for one date is refused rather than silently picking one", () => {
    const header = ["Branch", "Shift", "Name", "Summary", "Jun     11     Thu", "Jun     11     Thu"];
    expect(() =>
      parseAttendanceGridRange([["t"], header, ["Sylhet", "", "Afia Loskor", "…", "✔", "✘"]], REF),
    ).toThrow(AttendanceParseError);
  });

  test("the DAILY path still refuses a multi-day file — the snapshot contract is unchanged", () => {
    // AT1.5 rests on one upload replacing one day; a year-to-date file must not go
    // through the daily door and quietly overwrite whichever date it happened to pick.
    expect(() => parseAttendanceGrid(rangeGrid([["Sylhet", "", "A", "…", "✔", "✔", "✔"]]), REF)).toThrow(
      /single-day snapshot/,
    );
  });

  test("a single-column file parses identically through both doors", () => {
    const one = grid([["Sylhet", "", "Afia Loskor", "…", "✔ 06:43 AM", "1"]]);
    expect(parseAttendanceGridRange(one, REF)).toEqual([parseAttendanceGrid(one, REF)]);
  });
});

// ---------------------------------------------------------------------------
// Pure: name reconciliation (AT1.2)
// ---------------------------------------------------------------------------

describe("name reconciliation", () => {
  const profiles = [
    { id: "p1", name: "Afia Loskor" },
    { id: "p2", name: "Hamida  Akter" },
    { id: "p3", name: "Hamida Akter" }, // duplicate name → ambiguous
  ];
  const byName = indexProfilesByName(profiles);

  test("normalizeName collapses whitespace + case", () => {
    expect(normalizeName("  Afia   LOSKOR ")).toBe("afia loskor");
  });

  test("unique name match resolves; duplicates are ambiguous; unknown is held", () => {
    expect(matchName("afia loskor", byName, new Map())).toEqual({
      kind: "matched",
      staffProfileId: "p1",
      via: "name",
    });
    expect(matchName("hamida akter", byName, new Map()).kind).toBe("ambiguous");
    expect(matchName("ghost teacher", byName, new Map()).kind).toBe("unknown");
  });

  test("a remembered alias overrides ambiguity (AT1.2)", () => {
    const aliases = new Map([["hamida akter", "p2"]]);
    expect(matchName("hamida akter", byName, aliases)).toEqual({
      kind: "matched",
      staffProfileId: "p2",
      via: "alias",
    });
  });
});

// ---------------------------------------------------------------------------
// Service: commit (mocked models)
// ---------------------------------------------------------------------------

const P1 = new mongoose.Types.ObjectId();
const P2 = new mongoose.Types.ObjectId();
const ACTOR = new mongoose.Types.ObjectId().toString();

async function buildFileBase64(rows: string[][]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(["Employee Attendance Report"]);
  ws.addRow(HEADER);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer()).toString("base64");
}

describe("commitImport (AT1.2/AT1.4/AT1.5)", () => {
  beforeEach(() => {
    mockStaffFind.mockReturnValue(
      selectLean([
        { _id: P1, name: "Afia Loskor" },
        { _id: P2, name: "Akter Hossen" },
      ]),
    );
    mockAliasFind.mockReturnValue({ lean: () => Promise.resolve([]) });
    mockDayCount.mockResolvedValue(0);
  });

  test("persists matched rows; ✘ maps to ABSENT until a staff-leave source exists (AT1.4)", async () => {
    const file = await buildFileBase64([
      ["Sylhet", "Syl Morning Shift 7:00-12:00", "Afia Loskor", "…", "✔ 06:43 AM", "1"],
      ["Sylhet", "", "Akter Hossen", "…", "✘", "1"],
    ]);
    const res = await commitImport(file, [], [], ACTOR, new Date(2026, 5, 12));

    expect(res).toMatchObject({ dateKey: "2026-06-11", imported: 2, skipped: 0, ignored: 0, replaced: false });
    const docs = mockDayInsertMany.mock.calls[0][0] as Array<{ status: string; punchIn?: string }>;
    expect(docs.map((d) => d.status).sort()).toEqual(["ABSENT", "PRESENT"]);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "ATTENDANCE_IMPORTED" }),
    );
  });

  test("aborts on an unmatched name — no silent drop (AT1.2)", async () => {
    const file = await buildFileBase64([
      ["Sylhet", "", "Ghost Teacher", "…", "✔ 07:00 AM", "1"],
    ]);
    await expect(commitImport(file, [], [], ACTOR)).rejects.toThrow(AttendanceImportError);
    expect(mockDayInsertMany).not.toHaveBeenCalled();
  });

  test("a mapping is remembered as an alias; an ignoreName is explicitly dropped", async () => {
    mockStaffFindById.mockResolvedValue({ _id: P1, name: "Afia Loskor" });
    // After the mapping upsert, the alias index resolves the odd spelling
    mockAliasFind.mockReturnValue({
      lean: () => Promise.resolve([{ aliasNorm: "afia loskor (new)", staffProfileId: P1 }]),
    });
    const file = await buildFileBase64([
      ["Sylhet", "", "Afia Loskor (new)", "…", "✔ 06:43 AM", "1"],
      ["Sylhet", "", "Leaver Person", "…", "✘", "1"],
    ]);
    const res = await commitImport(
      file,
      [{ name: "Afia Loskor (new)", staffProfileId: P1.toString() }],
      ["Leaver Person"],
      ACTOR,
      new Date(2026, 5, 12),
    );
    expect(mockAliasUpdateOne).toHaveBeenCalledWith(
      { aliasNorm: "afia loskor (new)" },
      expect.anything(),
      { upsert: true },
    );
    expect(res).toMatchObject({ imported: 1, ignored: 1 });
  });

  test("re-upload replaces the date wholesale (AT1.5 snapshot)", async () => {
    mockDayCount.mockResolvedValue(23);
    const file = await buildFileBase64([
      ["Sylhet", "", "Afia Loskor", "…", "✔ 06:43 AM", "1"],
    ]);
    const res = await commitImport(file, [], [], ACTOR, new Date(2026, 5, 12));
    expect(mockDayDeleteMany).toHaveBeenCalledWith({ dateKey: "2026-06-11" });
    expect(res.replaced).toBe(true);
  });

  /**
   * The prod symptom of D-#609, kept as a regression: on a day that WAS imported, the
   * person marked ℞ had no row at all while 22 colleagues did — dropped so completely
   * that they left the month's denominator too, and ছুটিতে could only read zero.
   */
  test("℞ rows are STORED as LEAVE, not dropped (D-#609)", async () => {
    const file = await buildFileBase64([
      ["Sylhet", "", "Afia Loskor", "…", "℞", "1"],
      ["Sylhet", "", "Akter Hossen", "…", "✔ 06:53 AM", "1"],
    ]);
    const res = await commitImport(file, [], [], ACTOR, new Date(2026, 5, 12));
    expect(res).toMatchObject({ imported: 2, skipped: 0 });
    const stored = mockDayInsertMany.mock.calls.at(-1)![0] as Array<{ status: string }>;
    expect(stored.map((d) => d.status).sort()).toEqual(["LEAVE", "PRESENT"]);
  });

  test("a half-day leave carries halfDay through to the stored row", async () => {
    const file = await buildFileBase64([
      ["Sylhet", "", "Afia Loskor", "…", "℞◑ 07:30 AM 09:00 AM", "1"],
    ]);
    await commitImport(file, [], [], ACTOR, new Date(2026, 5, 12));
    const stored = mockDayInsertMany.mock.calls.at(-1)![0] as Array<{ status: string; halfDay?: boolean }>;
    expect(stored[0]).toMatchObject({ status: "LEAVE", halfDay: true });
  });
});

// ---------------------------------------------------------------------------
// Pure: summary roll-up (§8/O4)
// ---------------------------------------------------------------------------

describe("summarizeStatuses", () => {
  test("counts statuses; late still counts as attended in presentPct", () => {
    expect(
      summarizeStatuses(["PRESENT", "PRESENT", "LATE", "ABSENT", "LEAVE"]),
    ).toEqual({ days: 5, present: 2, late: 1, leave: 1, absent: 1, presentPct: 60 });
  });

  test("empty period → 0%", () => {
    expect(summarizeStatuses([]).presentPct).toBe(0);
  });
});
