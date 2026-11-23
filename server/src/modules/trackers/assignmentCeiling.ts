/**
 * The weekly assignment ceiling a section's week is checked against (AS-T6, D-#274; AL-6 §3.5, D-#1671).
 *
 * Switch OFF (2026): the constant `AS_WEEKLY_CEILING_MIN` (360), exactly as before — even if the policy key was edited.
 * Switch ON: `weeklyAssignmentHoursCap` × 60 from the SCHOOL policy row (the constant is the fallback for a bad value).
 * Every reader of the old constant goes through here (`confirmAssignmentWeek`, the week-load read, the reminder text).
 */
import { AS_WEEKLY_CEILING_MIN } from "@scd/shared";
import { isLoop2027On } from "../assessment/services/QuestionUseService";
import { budgetPolicy, weekCapMinutes } from "../mastery/assignmentBudget";

export async function weeklyCeilingMinutes(): Promise<number> {
  if (!(await isLoop2027On())) return AS_WEEKLY_CEILING_MIN;
  return weekCapMinutes(await budgetPolicy());
}
