/**
 * Monthly progress report (MR-5b, prd-monthly-report §7) — the release console's
 * documents.
 *
 * `snapshotJson` arrives as a STRING on purpose: the snapshot is a frozen, versioned
 * document, and typing it in the schema would freeze its shape twice. The screen
 * parses it into `MonthlySnapshotT` below, which is a READ-ONLY view — nothing here
 * recomputes a number, because the number a family saw is the one in that blob.
 */
import { gql } from "urql";

export interface MonthlyReportT {
  id: string;
  studentId: string;
  studentName: string;
  rollNumber: string | null;
  sectionId: string;
  periodKey: string;
  revision: number;
  status: "DRAFT" | "READY" | "RELEASED" | "SUPERSEDED";
  provisional: boolean;
  dataAsOf: string;
  coverageHomework: number | null;
  coverageAssignment: number | null;
  coverageClassTest: number | null;
  comment: string | null;
  commentDraft: string | null;
  commentIsFallback: boolean;
  commentFallbackReason: string | null;
  commentModel: string | null;
  /** MODEL or IMPORT (MR-8) — which lane wrote the draft. */
  commentSource: string | null;
  reviewedAt: string | null;
  releasedAt: string | null;
  releaseBatchId: string | null;
  isRerelease: boolean;
  changeLog: string[];
  fullView: boolean;
  subjectFilter: string[];
  lockState: "OPEN" | "WINDOW_CLOSED" | "HARD_LOCKED";
  releasable: boolean;
  blockedReason: string | null;
  requiresPrincipal: boolean;
  snapshotJson: string;
}

const REPORT_FIELDS = `
  id studentId studentName rollNumber sectionId periodKey revision status provisional dataAsOf
  coverageHomework coverageAssignment coverageClassTest
  comment commentDraft commentIsFallback commentFallbackReason commentModel commentSource reviewedAt
  releasedAt releaseBatchId isRerelease changeLog
  fullView subjectFilter lockState releasable blockedReason requiresPrincipal
  snapshotJson
`;

// ---------------------------------------------------------------------------
// The parsed snapshot (read-only view of the frozen blob)
// ---------------------------------------------------------------------------

export interface TrendT {
  state: "UP" | "STEADY" | "DOWN" | "NOT_COMPARABLE";
  delta: number | null;
  threshold: number;
  minSample: number;
}

export interface SubjectRowT {
  subject: string;
  issued: number;
  expectedWhilePresent: number;
  submitted: number;
  submissionRate: number | null;
  checked: number;
  correct: number;
  partial: number;
  wrong: number;
  qualityRate: number | null;
}

/** Homework and assignment are the SAME shape, computed separately (§5.4/§5.5). */
export interface TrackerBlockT {
  issued: number;
  expectedWhilePresent: number;
  submitted: number;
  submissionRate: number | null;
  checked: number;
  correct: number;
  partial: number;
  wrong: number;
  qualityRate: number | null;
  resubmissions: number;
  notSubmittedDueToAbsence: number;
  remindersSent: number;
  coverage: { settled: number; total: number; pct: number | null };
  bySubject: SubjectRowT[];
}

export interface MonthlySnapshotT {
  metrics?: {
    periodKey?: string;
    attendance?: {
      schoolDays: number; present: number; absent: number;
      absentLeaveCovered: number; absentUncovered: number; absentStreakMax: number;
      rate: number | null;
      weekdayPattern: { weekday: number; absences: number } | null;
    };
    homework?: TrackerBlockT;
    assignment?: TrackerBlockT;
    classTest?: { testsHeld: number; attended: number; absent: number; marksObtained: number; marksFull: number; rate: number | null; unmarked: number; coverage: { pct: number | null }; bySubject: Array<{ subject: string; testsHeld: number; attended: number; absent: number; marksObtained: number; marksFull: number; rate: number | null; unmarked: number }> };
    hifz?: { sessions: number; present: number; absent: number; juzHeard: number; tanbih: number; fath: number; mistakes: number; latestNote: string | null };
    concerns?: { concern: number; positive: number; seriousMatters: number; byType: Array<{ type: string; count: number }> };
    library?: { taken: number; returned: number; returnedOnTime: number; returnedLate: number; overdue: number; stillHeld: number };
    participation?: { remindersSent: number; noticesSent: number; phoneOnFile: boolean };
    fees?: { paidTotal: number; paidYearToDate: number; latestPaymentKey: string | null; byHead: Array<{ head: string; amount: number }>; supportHeads: string[] };
  };
  cohort?: {
    rosterSize: number;
    attendanceRate?: { avg: number | null; best: number | null; bestWithheld: boolean };
    attendancePresentDays?: { avg: number | null; best: number | null };
    homeworkSubmission?: { avg: number | null; best: number | null };
    classTestRate?: { avg: number | null; best: number | null };
  } | null;
  schoolBestPresentDays?: number | null;
  trends?: Record<string, TrendT>;
  flags?: Array<{ flag: string; value: number; threshold: number }>;
  config?: { coverageGatePct: number; showFees: boolean; showClassBest: boolean };
}

/** A malformed blob must never crash the console — an unreadable snapshot renders as
 *  an empty report, which is honest, rather than taking the whole list down. */
export function parseSnapshot(json: string): MonthlySnapshotT {
  try {
    return JSON.parse(json) as MonthlySnapshotT;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const MONTHLY_REPORTS_FOR_SECTION_QUERY = gql<
  { monthlyReportsForSection: MonthlyReportT[] },
  { sectionId: string; periodKey: string }
>`
  query MonthlyReportsForSection($sectionId: String!, $periodKey: String!) {
    monthlyReportsForSection(sectionId: $sectionId, periodKey: $periodKey) { ${REPORT_FIELDS} }
  }
`;

export const MONTHLY_REPORT_QUERY = gql<{ monthlyReport: MonthlyReportT }, { reportId: string }>`
  query MonthlyReport($reportId: String!) {
    monthlyReport(reportId: $reportId) { ${REPORT_FIELDS} }
  }
`;

export interface PendingGroupT {
  key: string;
  items: number;
  toCheck: number;
  awaiting: number;
  notSubmitted: number;
}

export interface PendingClassTestT {
  ctId: string;
  sectionLabel: string;
  subject: string;
  dateKey: string;
  status: string;
  teacherName: string;
  results: number;
  unmarked: number;
  submitted: boolean;
}

export interface PendingRowT {
  kind: string;
  teacherName: string;
  sectionLabel: string;
  subject: string;
  dateKey: string;
  ref: string;
  toCheck: number;
  awaiting: number;
  notSubmitted: number;
}

export interface PendingWorkT {
  periodKey: string;
  homeworkItems: number;
  homeworkToCheck: number;
  homeworkAwaiting: number;
  homeworkNotSubmitted: number;
  assignmentItems: number;
  assignmentToCheck: number;
  assignmentAwaiting: number;
  assignmentNotSubmitted: number;
  classTestsNoResults: number;
  classTestsUnmarked: number;
  classTestsNotSubmitted: number;
  byTeacher: PendingGroupT[];
  bySection: PendingGroupT[];
  classTests: PendingClassTestT[];
  rows: PendingRowT[];
}

export const MONTHLY_PENDING_WORK_QUERY = gql<{ monthlyPendingWork: PendingWorkT }, { periodKey: string }>`
  query MonthlyPendingWork($periodKey: String!) {
    monthlyPendingWork(periodKey: $periodKey) {
      periodKey
      homeworkItems homeworkToCheck homeworkAwaiting homeworkNotSubmitted
      assignmentItems assignmentToCheck assignmentAwaiting assignmentNotSubmitted
      classTestsNoResults classTestsUnmarked classTestsNotSubmitted
      byTeacher { key items toCheck awaiting notSubmitted }
      bySection { key items toCheck awaiting notSubmitted }
      classTests { ctId sectionLabel subject dateKey status teacherName results unmarked submitted }
      rows { kind teacherName sectionLabel subject dateKey ref toCheck awaiting notSubmitted }
    }
  }
`;

export interface TeacherChaseT {
  teacherId: string;
  teacherName: string;
  phone: string | null;
  messageBn: string;
  waLink: string | null;
  unreachable: boolean;
  classTests: number;
  homeworkItems: number;
  assignmentItems: number;
  toCheck: number;
  awaiting: number;
  notSubmitted: number;
}

export const MONTHLY_TEACHER_CHASE_QUERY = gql<{ monthlyTeacherChase: TeacherChaseT[] }, { periodKey: string }>`
  query MonthlyTeacherChase($periodKey: String!) {
    monthlyTeacherChase(periodKey: $periodKey) {
      teacherId teacherName phone messageBn waLink unreachable
      classTests homeworkItems assignmentItems toCheck awaiting notSubmitted
    }
  }
`;

export interface MonthlyReportConfigT {
  attendanceThresholdPp: number;
  attendanceMinDays: number;
  homeworkThresholdPp: number;
  homeworkMinSheets: number;
  assignmentThresholdPp: number;
  assignmentMinItems: number;
  qualityThresholdPp: number;
  qualityMinChecked: number;
  classTestThresholdPp: number;
  classTestMinTests: number;
  concernThreshold: number;
  coverageGatePct: number;
  minSectionSizeForClassBest: number;
  showClassBest: boolean;
  showFees: boolean;
  revisionWindowDays: number;
  hardLockDays: number;
}

export const MONTHLY_REPORT_CONFIG_QUERY = gql<{ monthlyReportConfig: MonthlyReportConfigT }, Record<string, never>>`
  query MonthlyReportConfig {
    monthlyReportConfig {
      attendanceThresholdPp attendanceMinDays homeworkThresholdPp homeworkMinSheets
      assignmentThresholdPp assignmentMinItems qualityThresholdPp qualityMinChecked
      classTestThresholdPp classTestMinTests concernThreshold coverageGatePct
      minSectionSizeForClassBest showClassBest showFees revisionWindowDays hardLockDays
    }
  }
`;

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const BUILD_MONTHLY_REPORTS_MUTATION = gql<
  { buildMonthlyReports: number },
  { sectionId: string; periodKey: string }
>`
  mutation BuildMonthlyReports($sectionId: String!, $periodKey: String!) {
    buildMonthlyReports(sectionId: $sectionId, periodKey: $periodKey)
  }
`;

export const DRAFT_MONTHLY_COMMENT_MUTATION = gql<
  { draftMonthlyReportComment: MonthlyReportT },
  { reportId: string }
>`
  mutation DraftMonthlyReportComment($reportId: String!) {
    draftMonthlyReportComment(reportId: $reportId) { ${REPORT_FIELDS} }
  }
`;

export interface DraftOutcomeT {
  reportId: string;
  drafted: boolean;
  fallback: boolean;
  error: string | null;
}

export const DRAFT_MONTHLY_COMMENTS_MUTATION = gql<
  { draftMonthlyReportComments: DraftOutcomeT[] },
  { reportIds: string[] }
>`
  mutation DraftMonthlyReportComments($reportIds: [String!]!) {
    draftMonthlyReportComments(reportIds: $reportIds) { reportId drafted fallback error }
  }
`;

/** MR-8: one row's verdict from the pasted envelope. A refusal names the row. */
export interface CommentImportOutcomeT {
  reportId: string;
  imported: boolean;
  reason: string | null;
}

export const IMPORT_MONTHLY_COMMENTS_MUTATION = gql<
  { importMonthlyComments: CommentImportOutcomeT[] },
  { payload: string }
>`
  mutation ImportMonthlyComments($payload: String!) {
    importMonthlyComments(payload: $payload) { reportId imported reason }
  }
`;

export const REVIEW_MONTHLY_COMMENT_MUTATION = gql<
  { reviewMonthlyReportComment: MonthlyReportT },
  { reportId: string; text: string }
>`
  mutation ReviewMonthlyReportComment($reportId: String!, $text: String!) {
    reviewMonthlyReportComment(reportId: $reportId, text: $text) { ${REPORT_FIELDS} }
  }
`;

export const RELEASE_MONTHLY_REPORT_MUTATION = gql<
  { releaseMonthlyReport: MonthlyReportT },
  { reportId: string; overrideReason?: string | null }
>`
  mutation ReleaseMonthlyReport($reportId: String!, $overrideReason: String) {
    releaseMonthlyReport(reportId: $reportId, overrideReason: $overrideReason) { ${REPORT_FIELDS} }
  }
`;

export interface ReleaseOutcomeT {
  reportId: string;
  released: boolean;
  error: string | null;
}

export const BULK_RELEASE_MUTATION = gql<
  { bulkReleaseMonthlyReports: ReleaseOutcomeT[] },
  { reportIds: string[]; overrideReason?: string | null }
>`
  mutation BulkReleaseMonthlyReports($reportIds: [String!]!, $overrideReason: String) {
    bulkReleaseMonthlyReports(reportIds: $reportIds, overrideReason: $overrideReason) {
      reportId released error
    }
  }
`;

export const REVOKE_MONTHLY_REPORT_MUTATION = gql<
  { revokeMonthlyReport: boolean },
  { reportId: string; reason: string }
>`
  mutation RevokeMonthlyReport($reportId: String!, $reason: String!) {
    revokeMonthlyReport(reportId: $reportId, reason: $reason)
  }
`;
