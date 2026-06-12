/**
 * Employee Attendance Report parser (AT-1, D-#63). The daily biometric export is
 * an Excel snapshot with NO staff-ID column — layout LOCKED from source
 * inspection (prd-attendance §4):
 *
 *   row 1: title
 *   row 2: header — Branch | Shift | Name | Summary | "<Mon> <day> <Dow>" | WD | ✔ | ✘ | 𝓛 | ℞
 *   rows 3..n: one row per employee; the DATED column cell carries the day's
 *              symbol + up to two punch times ("06:53 AM")
 *   last row:  totals (Name empty) — skipped
 *
 * Legend (§4): ✔ present · 𝓛 late (read the symbol — no grace computation) ·
 * ✘ not present (LEAVE-vs-ABSENT is resolved by the service, AT1.4) · ℞ ignored.
 *
 * The DATE comes from the sheet header, not "today" (AT1.1). The header omits the
 * year, so it's inferred against a reference date (upload time): the latest
 * occurrence of that month/day not materially in the future.
 *
 * `parseAttendanceGrid` is PURE (string grid in, parsed rows out) — the unit
 * tests exercise it directly; `parseEmployeeAttendanceXlsx` is the thin exceljs
 * wrapper that renders the workbook to that grid.
 */
import ExcelJS from "exceljs";
import { dateKeyOf } from "./dates";

/** Raw per-row mark before LEAVE/ABSENT resolution: ✘ stays CROSS here. */
export type ParsedMark = "PRESENT" | "LATE" | "CROSS" | "SKIP";

export interface ParsedAttendanceRow {
  name: string;
  shift?: string;
  mark: ParsedMark;
  punchIn?: string;
  punchOut?: string;
}

export interface ParsedSheet {
  /** Local date key read from the sheet header. */
  dateKey: string;
  rows: ParsedAttendanceRow[];
}

export class AttendanceParseError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "AttendanceParseError";
  }
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// "Jun                         11                         Thu" → month + day
const DATE_HEADER_RE = /^([A-Za-z]{3})\s+(\d{1,2})\s+[A-Za-z]{3}$/;
const PUNCH_RE = /\d{1,2}:\d{2}\s*(?:AM|PM)/g;

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Infer the full date for a year-less "<Mon> <day>" header: the most recent
 *  occurrence relative to `reference` (a snapshot is never materially future —
 *  one day of slack tolerates timezone/clock skew at upload). */
export function inferSheetDate(monthIndex: number, day: number, reference: Date): Date {
  const candidate = new Date(reference.getFullYear(), monthIndex, day);
  const slackMs = 24 * 60 * 60 * 1000;
  if (candidate.getTime() > reference.getTime() + slackMs) {
    return new Date(reference.getFullYear() - 1, monthIndex, day);
  }
  return candidate;
}

/** Read one date-column cell into a mark + punch times. Exported for tests. */
export function parseDayCell(cellText: string): Pick<ParsedAttendanceRow, "mark" | "punchIn" | "punchOut"> {
  // ℞ ("regular") rows are ignored per the legend; 𝓛 wins over ✔ defensively —
  // the date cell carries one symbol, but the Summary column shows both for a
  // late day, so precedence guards against layout drift.
  let mark: ParsedMark;
  if (cellText.includes("℞")) mark = "SKIP";
  else if (cellText.includes("𝓛")) mark = "LATE";
  else if (cellText.includes("✔")) mark = "PRESENT";
  else if (cellText.includes("✘")) mark = "CROSS";
  else mark = "SKIP";

  const punches = cellText.match(PUNCH_RE) ?? [];
  return {
    mark,
    punchIn: punches[0] ? collapse(punches[0]) : undefined,
    punchOut: punches[1] ? collapse(punches[1]) : undefined,
  };
}

/**
 * Pure grid parser. `grid` is the worksheet rendered to trimmed-ish strings
 * (empty string for blank cells); `reference` anchors the year inference.
 */
export function parseAttendanceGrid(grid: string[][], reference: Date): ParsedSheet {
  // Locate the header row: the one carrying a "Name" cell.
  const headerIdx = grid.findIndex((row) => row.some((c) => collapse(c) === "Name"));
  if (headerIdx === -1) {
    throw new AttendanceParseError("Header row not found (no 'Name' column) — is this the Employee Attendance Report?");
  }
  const header = grid[headerIdx];
  const nameCol = header.findIndex((c) => collapse(c) === "Name");
  const shiftCol = header.findIndex((c) => collapse(c) === "Shift");

  // The dated column: "<Mon> <day> <Dow>". Exactly one expected (daily snapshot).
  let dateCol = -1;
  let sheetDate: Date | null = null;
  for (let i = 0; i < header.length; i++) {
    const m = collapse(header[i]).match(DATE_HEADER_RE);
    if (!m) continue;
    const monthIndex = MONTHS[m[1].toLowerCase()];
    if (monthIndex === undefined) continue;
    if (dateCol !== -1) {
      throw new AttendanceParseError("Multiple dated columns found — expected a single-day snapshot export");
    }
    dateCol = i;
    sheetDate = inferSheetDate(monthIndex, Number(m[2]), reference);
  }
  if (dateCol === -1 || !sheetDate) {
    throw new AttendanceParseError("Dated column not found in the header (expected e.g. 'Jun 11 Thu')");
  }

  const rows: ParsedAttendanceRow[] = [];
  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r];
    const name = collapse(row[nameCol] ?? "");
    if (!name) continue; // totals/blank row
    const shift = collapse(row[shiftCol] ?? "");
    rows.push({
      name,
      shift: shift || undefined,
      ...parseDayCell(row[dateCol] ?? ""),
    });
  }
  if (rows.length === 0) {
    throw new AttendanceParseError("No employee rows found under the header");
  }

  return { dateKey: dateKeyOf(sheetDate), rows };
}

/** Render an uploaded workbook to a string grid and parse it. */
export async function parseEmployeeAttendanceXlsx(
  buffer: Buffer,
  reference: Date = new Date(),
): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new AttendanceParseError("File is not a readable .xlsx workbook");
  }
  const ws = workbook.worksheets[0];
  if (!ws) throw new AttendanceParseError("Workbook has no worksheets");

  const grid: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      cells.push(typeof cell.text === "string" ? cell.text : String(cell.text ?? ""));
    });
    grid.push(cells);
  });
  return parseAttendanceGrid(grid, reference);
}
