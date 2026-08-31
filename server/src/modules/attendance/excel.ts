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
 * ✘ not present (LEAVE-vs-ABSENT is resolved by the service, AT1.4) · ℞ LEAVE,
 * with ◑/◐ marking half a day (D-#611 — AT-1 read this as "regular" and dropped it).
 *
 * The same layout is exported year-to-date, with one dated column per day;
 * `parseAttendanceGridRange` reads all of them (D-#610).
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
export type ParsedMark = "PRESENT" | "LATE" | "LEAVE" | "CROSS" | "SKIP";

export interface ParsedAttendanceRow {
  name: string;
  shift?: string;
  mark: ParsedMark;
  punchIn?: string;
  punchOut?: string;
  /** ℞◑ / ℞◐ — half a day's leave. The report's own totals carry the .5 (D-#611). */
  halfDay?: boolean;
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
// ◑ / ◐ beside the leave mark — the report's way of writing half a day.
const HALF_DAY_RE = /[◑◐]/;

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
export function parseDayCell(
  cellText: string,
): Pick<ParsedAttendanceRow, "mark" | "punchIn" | "punchOut" | "halfDay"> {
  /**
   * ℞ IS LEAVE, not "regular" (D-#611).
   *
   * AT-1 read the legend as "℞ ignored" and mapped it to SKIP, so a leave day was
   * dropped at parse and never stored — not even as an absence. The owner found it
   * from the other end: "does the leave are recorded accurately?" No. On imported
   * days, the staff marked ℞ had NO ROW AT ALL while 22 colleagues did, which also
   * quietly removed them from the month's denominator, and ছুটিতে could only ever
   * read zero because nothing could write it.
   *
   * The year-to-date export settles what the symbol means: ℞ carries half-day marks
   * (◑/◐) that only reconcile against the report's own totals as 0.5, and 106 of its
   * 117 ℞ cells have no punch of any kind. A "regular" day is not half a day and does
   * not lack a punch. The owner confirmed it directly — Tanjila's 30 ℞ days are her
   * unpaid leave for 2026.
   *
   * 𝓛 wins over ✔ defensively — the date cell carries one symbol, but the Summary
   * column shows both for a late day, so precedence guards against layout drift.
   */
  let mark: ParsedMark;
  if (cellText.includes("℞")) mark = "LEAVE";
  else if (cellText.includes("𝓛")) mark = "LATE";
  else if (cellText.includes("✔")) mark = "PRESENT";
  else if (cellText.includes("✘")) mark = "CROSS";
  else mark = "SKIP";

  const punches = cellText.match(PUNCH_RE) ?? [];
  return {
    mark,
    punchIn: punches[0] ? collapse(punches[0]) : undefined,
    punchOut: punches[1] ? collapse(punches[1]) : undefined,
    halfDay: mark === "LEAVE" && HALF_DAY_RE.test(cellText) ? true : undefined,
  };
}

/**
 * Pure grid parser. `grid` is the worksheet rendered to trimmed-ish strings
 * (empty string for blank cells); `reference` anchors the year inference.
 */
export function parseAttendanceGrid(grid: string[][], reference: Date): ParsedSheet {
  const sheets = parseAttendanceGridRange(grid, reference);
  if (sheets.length > 1) {
    throw new AttendanceParseError("Multiple dated columns found — expected a single-day snapshot export");
  }
  return sheets[0];
}

/**
 * Every dated column in the sheet, oldest first (D-#610).
 *
 * The daily upload path stays exactly as it was — `parseAttendanceGrid` still refuses
 * anything but a single-day export, because a day's snapshot replacing a day's rows is
 * the contract the whole importer rests on (AT1.5).
 *
 * This exists because the school also exports a YEAR-TO-DATE report — the same layout
 * with 243 dated columns — and there was no way to get it in. Attendance in the app
 * began on 4 June 2026 purely because that is when someone started uploading daily;
 * January to May existed only in the biometric system. Backfilling meant either this or
 * 154 separate uploads.
 *
 * Each column's year is inferred independently against `reference`, so a report that
 * straddles a year boundary resolves each date to its own year rather than smearing the
 * whole range across one.
 */
export function parseAttendanceGridRange(grid: string[][], reference: Date): ParsedSheet[] {
  // Locate the header row: the one carrying a "Name" cell.
  const headerIdx = grid.findIndex((row) => row.some((c) => collapse(c) === "Name"));
  if (headerIdx === -1) {
    throw new AttendanceParseError("Header row not found (no 'Name' column) — is this the Employee Attendance Report?");
  }
  const header = grid[headerIdx];
  const nameCol = header.findIndex((c) => collapse(c) === "Name");
  const shiftCol = header.findIndex((c) => collapse(c) === "Shift");

  // Every "<Mon> <day> <Dow>" column. The summary columns (WD / ✔ / ✘ / 𝓛 / ℞) do not
  // match the pattern, so they fall out here rather than needing a position rule.
  const dated: Array<{ col: number; date: Date }> = [];
  for (let i = 0; i < header.length; i++) {
    const m = collapse(header[i]).match(DATE_HEADER_RE);
    if (!m) continue;
    const monthIndex = MONTHS[m[1].toLowerCase()];
    if (monthIndex === undefined) continue;
    dated.push({ col: i, date: inferSheetDate(monthIndex, Number(m[2]), reference) });
  }
  if (dated.length === 0) {
    throw new AttendanceParseError("Dated column not found in the header (expected e.g. 'Jun 11 Thu')");
  }

  // The employee rows, read once — the same people appear in every column.
  const people: Array<{ name: string; shift?: string; row: string[] }> = [];
  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r];
    const name = collapse(row[nameCol] ?? "");
    if (!name) continue; // totals/blank row
    const shift = collapse(row[shiftCol] ?? "");
    people.push({ name, shift: shift || undefined, row });
  }
  if (people.length === 0) {
    throw new AttendanceParseError("No employee rows found under the header");
  }

  const sheets = dated.map(({ col, date }) => ({
    dateKey: dateKeyOf(date),
    rows: people.map((p) => ({
      name: p.name,
      shift: p.shift,
      ...parseDayCell(p.row[col] ?? ""),
    })),
  }));

  // The export orders columns oddly (the school's runs Jan 27 → Aug 31, then Jan 1 →
  // Jan 26). Callers want chronological order, and a duplicate date would mean two
  // columns disagreeing about one day — worth refusing rather than picking one.
  sheets.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  for (let i = 1; i < sheets.length; i++) {
    if (sheets[i].dateKey === sheets[i - 1].dateKey) {
      throw new AttendanceParseError(`The sheet has two columns for ${sheets[i].dateKey}`);
    }
  }
  return sheets;
}

/** Render an uploaded workbook to a string grid. */
async function gridOf(buffer: Buffer): Promise<string[][]> {
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
  return grid;
}

/** Render an uploaded workbook to a string grid and parse it (single-day upload). */
export async function parseEmployeeAttendanceXlsx(
  buffer: Buffer,
  reference: Date = new Date(),
): Promise<ParsedSheet> {
  return parseAttendanceGrid(await gridOf(buffer), reference);
}

/** Every dated column of a year-to-date export, oldest first (D-#610). */
export async function parseEmployeeAttendanceXlsxRange(
  buffer: Buffer,
  reference: Date = new Date(),
): Promise<ParsedSheet[]> {
  return parseAttendanceGridRange(await gridOf(buffer), reference);
}
