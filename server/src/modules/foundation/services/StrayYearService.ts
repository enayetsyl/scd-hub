/**
 * Stray academic-year report + guarded delete (YC-0, docs/prd-year-change.md Q4).
 * Used by server/scripts/delete-stray-year.ts (dry run / --apply); never runs by itself.
 */
import mongoose from "mongoose";
import { AcademicYear } from "../models/AcademicYear";

// Register every model that can hold an academic-year reference (side-effect imports).
import "../../archive/models/ScriptBundle";
import "../../comments/models/ParentMeeting";
import "../../exams/models/Exam";
import "../../finance/models/BudgetLine";
import "../models/Class";
import "../../hr/models/Appraisal";
import "../../hr/models/StaffLeaveApplication";
import "../../hr/models/StaffLeaveEntitlement";
import "../../mastery/models/MasteryAction";
import "../../mastery/models/MasteryAssignment";
import "../../mastery/models/MasteryEnablement";
import "../../mastery/models/MasteryEvidence";
import "../../mastery/models/MasteryPaper";
import "../../reports/models/MonthlyReport";
import "../../routine/models/ScheduleWindow";
import "../../scholarship/models/ScholarshipPaper";
import "../../scholarship/models/ScholarshipSequence";
import "../../trackers/models/AssignmentGiftAward";
import "../../trackers/models/AssignmentItem";
import "../../trackers/models/AssignmentNilDeclaration";
import "../../trackers/models/AssignmentSchedule";
import "../../trackers/models/AssignmentSequence";
import "../../trackers/models/ClassTest";
import "../../trackers/models/ClassTestGroupSequence";
import "../../trackers/models/ClassTestQuestionRequest";
import "../../trackers/models/ClassTestSequence";
import "../../trackers/models/HomeworkItem";
import "../../trackers/models/HomeworkReconciliation";
import "../../trackers/models/HomeworkSequence";

const YEAR_PATHS = ["academicYearId", "academicYear"] as const;

export interface StrayYearCount {
  model: string;
  field: string;
  count: number;
}

export interface StrayYearReport {
  yearId: string;
  label: string;
  current: boolean;
  counts: StrayYearCount[];
  total: number;
}

/** Count rows referencing the year in every registered model that has a year path. */
export async function strayYearReport(label: string): Promise<StrayYearReport | null> {
  const year = await AcademicYear.findOne({ label });
  if (!year) return null;
  const counts: StrayYearCount[] = [];
  for (const name of mongoose.modelNames().sort()) {
    if (name === "AcademicYear") continue;
    const model = mongoose.model(name);
    for (const field of YEAR_PATHS) {
      if (!model.schema.path(field)) continue;
      counts.push({ model: name, field, count: await model.countDocuments({ [field]: year._id }) });
    }
  }
  const total = counts.reduce((a, c) => a + c.count, 0);
  return { yearId: String(year._id), label: year.label, current: year.current === true, counts, total };
}

/** Delete the year if (and only if) nothing references it. Returns the refusal reason or null. */
export async function deleteStrayYear(label: string, apply: boolean): Promise<{ refused: string | null; report: StrayYearReport | null }> {
  const report = await strayYearReport(label);
  if (!report) return { refused: `no academic year labelled "${label}"`, report };
  if (report.current) return { refused: `"${label}" is the CURRENT year — never deleted by this script`, report };
  if (report.total > 0) {
    return { refused: `"${label}" is still referenced by ${report.total} row(s) — nothing deleted`, report };
  }
  if (apply) await AcademicYear.deleteOne({ _id: report.yearId });
  return { refused: null, report };
}

