/**
 * Daily school report (D-#1030–#1035, docs/prd-daily-report.md) — the parts of the report
 * and the switch that shows each one. Shared so the server's builders, the share sheet and
 * the app's labels name the same keys.
 */

export const DAILY_REPORT_SECTIONS = [
  "ATTENDANCE",
  "STAFF",
  "TEACHING",
  "HOMEWORK",
  "ASSIGNMENT",
  "CLASS_TEST",
  "MISTAKES",
  "WORK_BOARD",
  "OFFICE",
  "GUARDIANS",
  "FINANCE",
  "SYSTEM",
] as const;
export type DailyReportSection = (typeof DAILY_REPORT_SECTIONS)[number];

/** Part → the catalogue switch that shows it (one switch per part, D-#1031). */
export const DAILY_REPORT_SECTION_PERMISSION: Record<DailyReportSection, `reports:daily_${string}`> = {
  ATTENDANCE: "reports:daily_attendance",
  STAFF: "reports:daily_staff",
  TEACHING: "reports:daily_teaching",
  HOMEWORK: "reports:daily_homework",
  ASSIGNMENT: "reports:daily_assignment",
  CLASS_TEST: "reports:daily_class_test",
  MISTAKES: "reports:daily_mistakes",
  WORK_BOARD: "reports:daily_work_board",
  OFFICE: "reports:daily_office",
  GUARDIANS: "reports:daily_guardians",
  FINANCE: "reports:daily_finance",
  SYSTEM: "reports:daily_system",
};

/** Parts the share sheet marks "usually Principal only" (owner 2026-11-06: shareable with a warning). */
export const DAILY_REPORT_SENSITIVE_SECTIONS: readonly DailyReportSection[] = ["MISTAKES", "GUARDIANS", "FINANCE", "SYSTEM"];

export const DAILY_REPORT_SECTION_LABELS_BN: Record<DailyReportSection, string> = {
  ATTENDANCE: "উপস্থিতি",
  STAFF: "কর্মী",
  TEACHING: "ক্লাস নোট",
  HOMEWORK: "বাড়ির কাজ",
  ASSIGNMENT: "অ্যাসাইনমেন্ট",
  CLASS_TEST: "ক্লাস টেস্ট",
  MISTAKES: "কর্মীর ভুল",
  WORK_BOARD: "কাজের বোর্ড",
  OFFICE: "অফিস ডেস্ক",
  GUARDIANS: "অভিভাবক",
  FINANCE: "অর্থ",
  SYSTEM: "সিস্টেম",
};

export const DAILY_REPORT_SECTION_LABELS_EN: Record<DailyReportSection, string> = {
  ATTENDANCE: "Attendance",
  STAFF: "Staff",
  TEACHING: "Class notes",
  HOMEWORK: "Homework",
  ASSIGNMENT: "Assignments",
  CLASS_TEST: "Class tests",
  MISTAKES: "Staff mistakes",
  WORK_BOARD: "Work board",
  OFFICE: "Office desk",
  GUARDIANS: "Guardians",
  FINANCE: "Finance",
  SYSTEM: "System",
};

/** 18:00 Dhaka (owner 2026-11-06, D-#1032). The Principal can move it in settings. */
export const DAILY_REPORT_DEFAULT_SEND_MINUTES = 18 * 60;

/** Line status: OK (no problems), WARN (some), BAD (≥ a third of the part's duties missed or
 *  a failed backup), NA (nothing due today), ERROR (the part could not be read). */
export const DAILY_REPORT_STATUSES = ["OK", "WARN", "BAD", "NA", "ERROR"] as const;
export type DailyReportStatus = (typeof DAILY_REPORT_STATUSES)[number];

/** On-time rate as a whole percent, or null when nothing was due. */
export function onTimeRate(onTime: number, problems: number): number | null {
  const total = onTime + problems;
  return total === 0 ? null : Math.round((onTime / total) * 100);
}
