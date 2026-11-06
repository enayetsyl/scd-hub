import type { Permission } from "@scd/shared";

/** Every part's switch — holding any one opens the daily report (the parts are filtered inside).
 *  Written out (not derived from DAILY_REPORT_SECTION_PERMISSION) so the D-#799 gate scan sees
 *  each switch gating something; dailyReport.test.ts keeps the two equal. */
export const ANY_PART: Permission[] = [
  "reports:daily_attendance",
  "reports:daily_staff",
  "reports:daily_teaching",
  "reports:daily_homework",
  "reports:daily_assignment",
  "reports:daily_class_test",
  "reports:daily_mistakes",
  "reports:daily_work_board",
  "reports:daily_office",
  "reports:daily_guardians",
  "reports:daily_finance",
  "reports:daily_system",
];
