/**
 * Year-change operations (YC-5, docs/prd-year-change.md section 5) - mirror of
 * server/src/modules/year-change/resolvers/yearChange.ts. Principal only: every field is gated
 * `year_change:view | prepare | cut_over | undo` on the server.
 *
 * No roll numbers anywhere (D-#1463): a child is listed and ordered by school ID.
 */
import { gql } from "urql";

type NoVars = Record<string, never>;

export type SectionCodeT = "Main" | "Boys" | "Girls";
export type DecisionT = "PROMOTE" | "REPEAT" | "LEFT";
export type UndoKindT = "PREPARE" | "CUTOVER";

// ---------------------------------------------------------------------------
// Input (the draft the screen keeps in component state)
// ---------------------------------------------------------------------------

export interface YcCopyOptionsInput {
  routine?: boolean;
  bellWindows?: boolean;
  assignmentSchedule?: boolean;
  grants?: boolean;
  mastery?: boolean;
}
export interface YcPlanInput {
  fromYearId: string;
  toYearId: string;
  copy?: YcCopyOptionsInput;
  classPlan?: Array<{ level: number; sections: SectionCodeT[] }>;
  promotions?: Array<{ studentId: string; decision: DecisionT; toSectionCode?: SectionCodeT }>;
  admissions?: Array<{
    schoolId: string;
    name: string;
    nameBn?: string;
    gender: "male" | "female" | "other";
    level: number;
    sectionCode?: SectionCodeT;
    guardianPhone: string;
  }>;
  classTeachers?: Array<{ level: number; sectionCode: SectionCodeT; teacherId: string | null }>;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export interface YcSetupT {
  fromYearId: string | null;
  toYearId: string | null;
  years: Array<{ id: string; label: string; current: boolean }>;
  classes: Array<{ id: string; level: number; nameBn: string; sections: Array<{ code: string; classTeacherId: string | null }> }>;
  children: Array<{
    studentId: string;
    schoolId: string;
    name: string;
    nameBn: string | null;
    gender: string | null;
    level: number;
    sectionCode: string;
    decision: DecisionT;
    toSectionCode: string | null;
  }>;
  teachers: Array<{ id: string; name: string }>;
  classPlan: Array<{ level: number; nameBn: string; sections: string[] }>;
  classTeachers: Array<{ level: number; sectionCode: string; teacherId: string }>;
  /** The prepared run of this pair: the lists above are ITS choices (null = first prepare). */
  preparedRunId: string | null;
  admissions: Array<{ schoolId: string; name: string; nameBn: string | null; gender: string; level: number; sectionCode: string; guardianPhone: string }>;
  copy: Array<{ key: string; value: boolean }> | null;
}

export const YEAR_CHANGE_SETUP_QUERY = gql<
  { yearChangeSetup: YcSetupT },
  { fromYearId?: string | null; toYearId?: string | null }
>`
  query YearChangeSetup($fromYearId: String, $toYearId: String) {
    yearChangeSetup(fromYearId: $fromYearId, toYearId: $toYearId) {
      fromYearId
      toYearId
      years { id label current }
      classes { id level nameBn sections { code classTeacherId } }
      children { studentId schoolId name nameBn gender level sectionCode decision toSectionCode }
      teachers { id name }
      classPlan { level nameBn sections }
      classTeachers { level sectionCode teacherId }
      preparedRunId
      admissions { schoolId name nameBn gender level sectionCode guardianPhone }
      copy { key value }
    }
  }
`;

// ---------------------------------------------------------------------------
// Prepare dry run + apply
// ---------------------------------------------------------------------------

export interface YcPlanT {
  fromLabel: string;
  toLabel: string;
  startKey: string;
  closeKey: string;
  runId: string | null;
  classes: Array<{
    level: number;
    nameBn: string;
    existingId: string | null;
    promotedIn: number;
    repeaters: number;
    admissions: number;
    total: number;
    left: number;
    sections: Array<{ code: string; nameBn: string; existingId: string | null; children: number }>;
  }>;
  counts: {
    classesToCreate: number;
    sectionsToCreate: number;
    enrolmentsToCreate: number;
    enrolmentsExisting: number;
    promoted: number;
    repeaters: number;
    left: number;
    admissionsToCreate: number;
    admissionsExisting: number;
    classTeachersToSet: number;
    enrolmentsToUpdate: number;
    enrolmentsToRemove: number;
    admissionsToUpdate: number;
    admissionsToRemove: number;
  };
  /** Rows of the earlier preparation this plan changes or deletes (the apply reconciles to this input). */
  enrolments: Array<{ schoolId: string; name: string; update: boolean }>;
  admissions: Array<{ schoolId: string; name: string; changed: boolean }>;
  removeEnrolments: Array<{ schoolId: string; reason: string | null }>;
  removeAdmissions: Array<{ schoolId: string }>;
  refusals: string[];
  warnings: string[];
  printText: string;
}

export const YEAR_CHANGE_PLAN_QUERY = gql<{ yearChangePlan: YcPlanT }, { input: YcPlanInput }>`
  query YearChangePlan($input: YearChangePlanInput!) {
    yearChangePlan(input: $input) {
      fromLabel
      toLabel
      startKey
      closeKey
      runId
      classes {
        level nameBn existingId promotedIn repeaters admissions total left
        sections { code nameBn existingId children }
      }
      counts {
        classesToCreate sectionsToCreate enrolmentsToCreate enrolmentsExisting promoted repeaters left
        admissionsToCreate admissionsExisting classTeachersToSet enrolmentsToUpdate enrolmentsToRemove
        admissionsToUpdate admissionsToRemove
      }
      enrolments { schoolId name update }
      admissions { schoolId name changed }
      removeEnrolments { schoolId reason }
      removeAdmissions { schoolId }
      refusals
      warnings
      printText
    }
  }
`;

export const APPLY_YEAR_CHANGE_PREPARE = gql<
  { applyYearChangePrepare: { runId: string; total: number } },
  { input: YcPlanInput }
>`
  mutation ApplyYearChangePrepare($input: YearChangePlanInput!) {
    applyYearChangePrepare(input: $input) { runId total }
  }
`;

// ---------------------------------------------------------------------------
// Runs, cut-over, undo
// ---------------------------------------------------------------------------

export interface YcRunT {
  runId: string;
  fromYearId: string;
  toYearId: string;
  fromLabel: string;
  toLabel: string;
  /** PREPARED | CUTTING_OVER | CUT_OVER */
  status: string;
  createdAt: string;
  cutOverAt: string | null;
}

export const YEAR_CHANGE_RUNS_QUERY = gql<{ yearChangeRuns: YcRunT[] }, NoVars>`
  query YearChangeRuns {
    yearChangeRuns { runId fromYearId toYearId fromLabel toLabel status createdAt cutOverAt }
  }
`;

export interface YcCutoverPlanT {
  runId: string;
  status: string;
  fromLabel: string;
  toLabel: string;
  startKey: string;
  closeKey: string;
  promoted: number;
  repeated: number;
  left: number;
  activating: number;
  admitted: number;
  studentsChanged: number;
  scholarshipCleared: number;
  improvementToEnd: number;
  copyLines: string[];
  refusals: string[];
  printText: string;
}

export const YEAR_CHANGE_CUTOVER_PLAN_QUERY = gql<{ yearChangeCutoverPlan: YcCutoverPlanT }, { runId: string }>`
  query YearChangeCutoverPlan($runId: String!) {
    yearChangeCutoverPlan(runId: $runId) {
      runId status fromLabel toLabel startKey closeKey promoted repeated left activating admitted
      studentsChanged scholarshipCleared improvementToEnd copyLines refusals printText
    }
  }
`;

export const APPLY_YEAR_CHANGE_CUTOVER = gql<{ applyYearChangeCutover: { runId: string; total: number; invariantAfter: string[] } }, { runId: string }>`
  mutation ApplyYearChangeCutover($runId: String!) {
    applyYearChangeCutover(runId: $runId) { runId total invariantAfter }
  }
`;

export interface YcUndoPlanT {
  kind: string;
  runId: string;
  counts: Array<{ key: string; value: number }>;
  changedAfter: string[];
  createdAfter: string[];
  notes: string[];
  refusals: string[];
  printText: string;
}

export const YEAR_CHANGE_UNDO_PLAN_QUERY = gql<{ yearChangeUndoPlan: YcUndoPlanT }, { runId: string; kind: UndoKindT }>`
  query YearChangeUndoPlan($runId: String!, $kind: YearChangeUndoKind!) {
    yearChangeUndoPlan(runId: $runId, kind: $kind) {
      kind runId counts { key value } changedAfter createdAfter notes refusals printText
    }
  }
`;

export const UNDO_YEAR_CHANGE = gql<{ undoYearChange: { runId: string; total: number } }, { runId: string; kind: UndoKindT }>`
  mutation UndoYearChange($runId: String!, $kind: YearChangeUndoKind!) {
    undoYearChange(runId: $runId, kind: $kind) { runId total }
  }
`;
