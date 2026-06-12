/* One-off executed verification: parse the REAL Employee Attendance Report
 * through the AT-1 parser and print every row (run: npx tsx scripts/try-parse-attendance.ts <file>). */
import * as fs from "fs";
import { parseEmployeeAttendanceXlsx } from "../src/modules/attendance/excel";

(async () => {
  const file = process.argv[2];
  const buf = fs.readFileSync(file);
  const parsed = await parseEmployeeAttendanceXlsx(buf, new Date(2026, 5, 12));
  console.log("dateKey:", parsed.dateKey, "| rows:", parsed.rows.length);
  for (const r of parsed.rows) {
    console.log(
      r.mark.padEnd(8),
      (r.punchIn ?? "--:--").padEnd(9),
      (r.punchOut ?? "--:--").padEnd(9),
      r.name,
      "|",
      r.shift ?? "(no shift)",
    );
  }
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
