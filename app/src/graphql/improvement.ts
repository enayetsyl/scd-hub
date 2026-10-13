/**
 * Student progress board + improvement actions (docs/prd-student-progress.md, D-#734..#738).
 * One operation per surface: a caller without a permission never fires that request.
 */
import { gql } from "urql";

type NoVars = Record<string, never>;

export interface ProgressCellT {
  subject: string;
  avgPercent: number;
  tests: number;
  trend: "UP" | "DOWN" | "FLAT" | "NONE";
  falling: boolean;
  last3: number[];
  latestWeakness: string | null;
}

export interface ProgressGridStudentT {
  studentId: string;
  name: string;
  rollNumber: string | null;
  cells: ProgressCellT[];
  overall: number | null;
  atRisk: boolean;
  absent: number;
  openActions: number;
  behindActions: number;
  doneActions: number;
}

export interface SubjectValueT {
  subject: string;
  value: number | null;
}

export interface ProgressSectionBoardT {
  sectionId: string;
  classLevel: number | null;
  sectionNameBn: string;
  subjects: string[];
  highest: SubjectValueT[];
  average: SubjectValueT[];
  highestOverall: number | null;
  averageOverall: number | null;
  students: ProgressGridStudentT[];
}

const CELL = `subject avgPercent tests trend falling last3 latestWeakness`;

export const PROGRESS_SECTION_BOARD = gql<
  { progressSectionBoard: ProgressSectionBoardT },
  { sectionId: string; fromKey: string; toKey: string }
>`
  query ProgressSectionBoard($sectionId: String!, $fromKey: String!, $toKey: String!) {
    progressSectionBoard(sectionId: $sectionId, fromKey: $fromKey, toKey: $toKey) {
      sectionId classLevel sectionNameBn subjects
      highest { subject value } average { subject value }
      highestOverall averageOverall
      students {
        studentId name rollNumber overall atRisk absent openActions behindActions doneActions
        cells { ${CELL} }
      }
    }
  }
`;

export interface ProgressAttentionRowT {
  studentId: string;
  name: string;
  sectionId: string;
  classLevel: number | null;
  sectionNameBn: string;
  subject: string;
  why: "AT_RISK" | "FALLING";
  last3: number[];
  latest: number;
  actionState: "NONE" | "RUNNING" | "BEHIND" | "DONE";
  actionDelta: number | null;
}

export interface ProgressSchoolOverviewT {
  schoolAverage: number | null;
  studentsWithResults: number;
  atRisk: number;
  atRiskNoAction: number;
  actionsBehind: number;
  improved: number;
  improvedOf: number;
  attention: ProgressAttentionRowT[];
}

export const PROGRESS_SCHOOL_OVERVIEW = gql<
  { progressSchoolOverview: ProgressSchoolOverviewT },
  { fromKey: string; toKey: string }
>`
  query ProgressSchoolOverview($fromKey: String!, $toKey: String!) {
    progressSchoolOverview(fromKey: $fromKey, toKey: $toKey) {
      schoolAverage studentsWithResults atRisk atRiskNoAction actionsBehind improved improvedOf
      attention { studentId name sectionId classLevel sectionNameBn subject why last3 latest actionState actionDelta }
    }
  }
`;

export interface ImprovementActionSummaryT {
  id: string;
  scope: "STUDENT" | "CLASS";
  subject: string;
  sectionId: string;
  classLevel: number | null;
  sectionNameBn: string;
  studentId: string | null;
  studentName: string | null;
  reason: string | null;
  teacherTask: string | null;
  teacherUserId: string | null;
  teacherName: string | null;
  guardianTask: string | null;
  repeat: string;
  startKey: string;
  endKey: string;
  totalDays: number;
  state: "UPCOMING" | "RUNNING" | "ENDED" | "STOPPED";
  dayNumber: number;
  createdByName: string | null;
  createdAt: string;
  stopReason: string | null;
  teacherDone: number;
  teacherOwed: number;
  teacherNotMarked: number;
  guardianDone: number;
  guardianOwed: number;
  alertClassTeacher: boolean;
  before: number | null;
  after: number | null;
}

const SUMMARY = `
  id scope subject sectionId classLevel sectionNameBn studentId studentName reason
  teacherTask teacherUserId teacherName guardianTask repeat startKey endKey totalDays state dayNumber
  createdByName createdAt stopReason teacherDone teacherOwed teacherNotMarked guardianDone guardianOwed
  alertClassTeacher before after
`;

export interface ProgressStudentT {
  studentId: string;
  name: string;
  sectionId: string;
  classLevel: number | null;
  sectionNameBn: string;
  overall: number | null;
  classOverall: number | null;
  trajectory: string;
  atRisk: boolean;
  absent: number;
  recurringWeaknesses: string[];
  subjects: Array<ProgressCellT & { classAverage: number | null }>;
  actions: ImprovementActionSummaryT[];
}

export const PROGRESS_STUDENT = gql<
  { progressStudent: ProgressStudentT },
  { studentId: string; fromKey: string; toKey: string }
>`
  query ProgressStudent($studentId: String!, $fromKey: String!, $toKey: String!) {
    progressStudent(studentId: $studentId, fromKey: $fromKey, toKey: $toKey) {
      studentId name sectionId classLevel sectionNameBn overall classOverall trajectory atRisk absent recurringWeaknesses
      subjects { ${CELL} classAverage }
      actions { ${SUMMARY} }
    }
  }
`;

export const IMPROVEMENT_SUGGEST = gql<
  { improvementSuggest: { reason: string; teacherUserId: string | null } },
  { sectionId: string; subject: string; studentId?: string | null }
>`
  query ImprovementSuggest($sectionId: String!, $subject: String!, $studentId: String) {
    improvementSuggest(sectionId: $sectionId, subject: $subject, studentId: $studentId) { reason teacherUserId }
  }
`;

export interface ImprovementDayCellT {
  dayKey: string;
  status: "DONE" | "COULDNT" | null;
  reason: string | null;
  by: "SELF" | "COVER" | "OFFICE" | "GUARDIAN" | null;
  byName: string | null;
  future: boolean;
}

export interface ImprovementFamilyRowT {
  studentId: string;
  name: string;
  done: number;
  owed: number;
  last3: Array<string | null>;
}

export interface ImprovementActionDetailT {
  summary: ImprovementActionSummaryT;
  teacherDays: ImprovementDayCellT[];
  guardianDays: ImprovementDayCellT[];
  families: ImprovementFamilyRowT[];
  todayResponsibleName: string | null;
  todayResponsibleSource: string | null;
}

const DAY = `dayKey status reason by byName future`;

export const IMPROVEMENT_ACTION = gql<{ improvementAction: ImprovementActionDetailT }, { id: string }>`
  query ImprovementAction($id: String!) {
    improvementAction(id: $id) {
      summary { ${SUMMARY} }
      teacherDays { ${DAY} }
      guardianDays { ${DAY} }
      families { studentId name done owed last3 }
      todayResponsibleName todayResponsibleSource
    }
  }
`;

export interface ImprovementTaskT {
  actionId: string;
  part: "TEACHER" | "GUARDIAN";
  dayKey: string;
  dayNumber: number;
  totalDays: number;
  scope: "STUDENT" | "CLASS";
  subject: string;
  sectionId: string;
  classLevel: number | null;
  sectionNameBn: string;
  studentId: string | null;
  studentName: string | null;
  task: string;
  responsibleUserId: string | null;
  responsibleName: string | null;
  responsibleSource: "OVERRIDE" | "COVER" | "ASSIGNED" | "NONE" | null;
  assignedTeacherName: string | null;
  doneSoFar: number;
  daysSoFar: number;
  status: "DONE" | "COULDNT" | null;
  reason: string | null;
  markedByName: string | null;
  onBehalf: boolean;
  markedByMe: boolean;
}

const TASK = `
  actionId part dayKey dayNumber totalDays scope subject sectionId classLevel sectionNameBn studentId studentName task
  responsibleUserId responsibleName responsibleSource assignedTeacherName doneSoFar daysSoFar
  status reason markedByName onBehalf markedByMe
`;

export const MY_IMPROVEMENT_TASKS = gql<{ myImprovementTasks: ImprovementTaskT[] }, NoVars>`
  query MyImprovementTasks { myImprovementTasks { ${TASK} } }
`;

export const IMPROVEMENT_DAY_TASKS = gql<{ improvementDayTasks: ImprovementTaskT[] }, NoVars>`
  query ImprovementDayTasks { improvementDayTasks { ${TASK} } }
`;

export const CHILD_IMPROVEMENT_TASKS = gql<{ childImprovementTasks: ImprovementTaskT[] }, { studentId: string }>`
  query ChildImprovementTasks($studentId: String!) { childImprovementTasks(studentId: $studentId) { ${TASK} } }
`;

export const CHILD_IMPROVEMENT_STREAK = gql<
  { childImprovementStreak: Array<{ dayKey: string; status: string | null }> },
  { actionId: string; studentId: string }
>`
  query ChildImprovementStreak($actionId: String!, $studentId: String!) {
    childImprovementStreak(actionId: $actionId, studentId: $studentId) { dayKey status }
  }
`;

export interface ImprovementLeaveTaskT {
  actionId: string;
  dayKey: string;
  scope: "STUDENT" | "CLASS";
  subject: string;
  classLevel: number | null;
  sectionNameBn: string;
  studentName: string | null;
  task: string;
  dayNumber: number;
  totalDays: number;
  responsibleUserId: string | null;
  responsibleName: string | null;
  source: "OVERRIDE" | "COVER" | "ASSIGNED" | "NONE";
}

export const LEAVE_IMPROVEMENT_TASKS = gql<
  { leaveImprovementTasks: ImprovementLeaveTaskT[] },
  { leaveApplicationId: string }
>`
  query LeaveImprovementTasks($leaveApplicationId: String!) {
    leaveImprovementTasks(leaveApplicationId: $leaveApplicationId) {
      actionId dayKey scope subject classLevel sectionNameBn studentName task dayNumber totalDays
      responsibleUserId responsibleName source
    }
  }
`;

export interface CreateImprovementActionInputT {
  scope: "STUDENT" | "CLASS";
  sectionId: string;
  studentId?: string | null;
  subject: string;
  reason?: string | null;
  teacherTask?: string | null;
  teacherUserId?: string | null;
  guardianTask?: string | null;
  startKey: string;
  days: number;
  repeat: "EVERY_SCHOOL_DAY" | "SUBJECT_DAYS";
  alertClassTeacher?: boolean | null;
}

export const CREATE_IMPROVEMENT_ACTION = gql<
  { createImprovementAction: ImprovementActionSummaryT },
  { input: CreateImprovementActionInputT }
>`
  mutation CreateImprovementAction($input: CreateImprovementActionInput!) {
    createImprovementAction(input: $input) { ${SUMMARY} }
  }
`;

export const STOP_IMPROVEMENT_ACTION = gql<
  { stopImprovementAction: ImprovementActionSummaryT },
  { id: string; reason?: string | null }
>`
  mutation StopImprovementAction($id: String!, $reason: String) {
    stopImprovementAction(id: $id, reason: $reason) { ${SUMMARY} }
  }
`;

export const EXTEND_IMPROVEMENT_ACTION = gql<
  { extendImprovementAction: ImprovementActionSummaryT },
  { id: string; days: number }
>`
  mutation ExtendImprovementAction($id: String!, $days: Int!) {
    extendImprovementAction(id: $id, days: $days) { ${SUMMARY} }
  }
`;

export const SET_IMPROVEMENT_DAY_ASSIGNEE = gql<
  { setImprovementDayAssignee: boolean },
  { actionId: string; dayKey: string; userId?: string | null }
>`
  mutation SetImprovementDayAssignee($actionId: String!, $dayKey: String!, $userId: String) {
    setImprovementDayAssignee(actionId: $actionId, dayKey: $dayKey, userId: $userId)
  }
`;

export const TICK_IMPROVEMENT_TASK = gql<
  { tickImprovementTask: boolean },
  { actionId: string; dayKey: string; status: "DONE" | "COULDNT"; reason?: string | null }
>`
  mutation TickImprovementTask($actionId: String!, $dayKey: String!, $status: String!, $reason: String) {
    tickImprovementTask(actionId: $actionId, dayKey: $dayKey, status: $status, reason: $reason)
  }
`;

export const UNTICK_IMPROVEMENT_TASK = gql<{ untickImprovementTask: boolean }, { actionId: string; dayKey: string }>`
  mutation UntickImprovementTask($actionId: String!, $dayKey: String!) {
    untickImprovementTask(actionId: $actionId, dayKey: $dayKey)
  }
`;

export const TICK_CHILD_IMPROVEMENT_TASK = gql<
  { tickChildImprovementTask: boolean },
  { actionId: string; studentId: string; dayKey: string; status: "DONE" | "COULDNT"; reason?: string | null }
>`
  mutation TickChildImprovementTask($actionId: String!, $studentId: String!, $dayKey: String!, $status: String!, $reason: String) {
    tickChildImprovementTask(actionId: $actionId, studentId: $studentId, dayKey: $dayKey, status: $status, reason: $reason)
  }
`;

export const UNTICK_CHILD_IMPROVEMENT_TASK = gql<
  { untickChildImprovementTask: boolean },
  { actionId: string; studentId: string; dayKey: string }
>`
  mutation UntickChildImprovementTask($actionId: String!, $studentId: String!, $dayKey: String!) {
    untickChildImprovementTask(actionId: $actionId, studentId: $studentId, dayKey: $dayKey)
  }
`;

/** Every mutation here invalidates these, via urql's typename-based cache. */
export const IMPROVEMENT_TYPENAMES = ["ImprovementTask", "ImprovementActionSummary", "ProgressSectionBoard", "ProgressStudent", "ImprovementActionDetail"];
