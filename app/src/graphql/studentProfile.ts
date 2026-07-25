/**
 * Student profile (SP-3, prd-student-profile §7) — one query per PANEL, so each
 * fetches independently: a slow plane never blocks the header, and a collapsed panel
 * costs nothing (the screen pauses its query until the panel is opened).
 *
 * `fullView: false` on the header/panels means the caller is a subject teacher and
 * every per-subject row is narrowed to `subjectFilter` (D-#357). Attendance and
 * comments are subject-FREE and always complete.
 */
import { gql } from "urql";

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export interface ProfileGuardianT {
  guardianId: string;
  name: string;
  relation: string;
  phone: string | null;
  primary: boolean;
}

export interface ProfileAcademicYearT {
  academicYearId: string;
  label: string;
  fromKey: string;
  toKey: string;
}

export interface ProfileHeaderT {
  studentId: string;
  name: string;
  nameBn: string | null;
  rollNumber: string | null;
  gender: string | null;
  dob: string | null;
  bloodGroup: string | null;
  phone: string | null;
  classLevel: number;
  sectionId: string;
  sectionNameBn: string | null;
  classTeacherName: string | null;
  guardians: ProfileGuardianT[];
  academicYear: ProfileAcademicYearT | null;
  fullView: boolean;
}

export const STUDENT_PROFILE_HEADER_QUERY = gql<
  { studentProfileHeader: ProfileHeaderT },
  { studentId: string }
>`
  query StudentProfileHeader($studentId: String!) {
    studentProfileHeader(studentId: $studentId) {
      studentId name nameBn rollNumber gender dob bloodGroup phone
      classLevel sectionId sectionNameBn classTeacherName fullView
      guardians { guardianId name relation phone primary }
      academicYear { academicYearId label fromKey toKey }
    }
  }
`;

// ---------------------------------------------------------------------------
// Tracker panels (homework + assignment share one shape)
// ---------------------------------------------------------------------------

export interface TrackerCountersT {
  sheets: number;
  records: number;
  received: number;
  absentAtIssue: number;
  notReceivedStill: number;
  submitted: number;
  notSubmitted: number;
  awaiting: number;
  pendingChecking: number;
  pendingReturn: number;
  chased: number;
  chaseTotal: number;
  checked: number;
  returned: number;
  resubmissions: number;
  correct: number;
  partial: number;
  wrong: number;
  qualityPct: number | null;
  submissionPct: number | null;
  graded: number;
  avgMarksPct: number | null;
}

export interface TrackerItemT {
  recordId: string;
  refId: string;
  subject: string;
  dateGiven: string;
  dueDate: string | null;
  state: string;
  result: string | null;
  marks: number | null;
  totalMarks: number | null;
  feedback: string | null;
  description: string | null;
  chaseCount: number;
  isResubmission: boolean;
  resubmissions: number;
  overdue: boolean;
}

export interface TrackerPanelT {
  studentId: string;
  fromKey: string;
  toKey: string;
  fullView: boolean;
  subjectFilter: string[];
  totals: TrackerCountersT;
  bySubject: Array<{ subject: string; counters: TrackerCountersT }>;
  items: TrackerItemT[];
}

const COUNTER_FIELDS = `
  sheets records received absentAtIssue notReceivedStill submitted notSubmitted awaiting
  pendingChecking pendingReturn chased chaseTotal checked returned resubmissions
  correct partial wrong qualityPct submissionPct graded avgMarksPct
`;

const PANEL_FIELDS = `
  studentId fromKey toKey fullView subjectFilter
  totals { ${COUNTER_FIELDS} }
  bySubject { subject counters { ${COUNTER_FIELDS} } }
  items {
    recordId refId subject dateGiven dueDate state result marks totalMarks
    feedback description chaseCount isResubmission resubmissions overdue
  }
`;

export interface PanelVars {
  studentId: string;
  fromKey: string;
  toKey: string;
}

export const STUDENT_PROFILE_HOMEWORK_QUERY = gql<{ studentProfileHomework: TrackerPanelT }, PanelVars>`
  query StudentProfileHomework($studentId: String!, $fromKey: String!, $toKey: String!) {
    studentProfileHomework(studentId: $studentId, fromKey: $fromKey, toKey: $toKey) { ${PANEL_FIELDS} }
  }
`;

export const STUDENT_PROFILE_ASSIGNMENT_QUERY = gql<{ studentProfileAssignment: TrackerPanelT }, PanelVars>`
  query StudentProfileAssignment($studentId: String!, $fromKey: String!, $toKey: String!) {
    studentProfileAssignment(studentId: $studentId, fromKey: $fromKey, toKey: $toKey) { ${PANEL_FIELDS} }
  }
`;

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export interface ProfileAttendanceT {
  studentId: string;
  fromKey: string;
  toKey: string;
  markedDays: number;
  absentDays: number;
  presentPct: number;
  absentUncoveredDays: number;
  absentStreakMax: number;
  recentPresentPct: number | null;
  earlierPresentPct: number | null;
  trajectory: string;
  monthly: Array<{ monthKey: string; markedDays: number; absentDays: number; presentPct: number | null }>;
  days: Array<{ dateKey: string; absent: boolean; leaveCovered: boolean }>;
  leaves: Array<{
    leaveId: string;
    fromKey: string;
    toKey: string;
    reason: string;
    submittedAt: string;
    daysInWindow: number;
  }>;
}

export const STUDENT_PROFILE_ATTENDANCE_QUERY = gql<
  { studentProfileAttendance: ProfileAttendanceT },
  PanelVars
>`
  query StudentProfileAttendance($studentId: String!, $fromKey: String!, $toKey: String!) {
    studentProfileAttendance(studentId: $studentId, fromKey: $fromKey, toKey: $toKey) {
      studentId fromKey toKey markedDays absentDays presentPct
      absentUncoveredDays absentStreakMax recentPresentPct earlierPresentPct trajectory
      monthly { monthKey markedDays absentDays presentPct }
      days { dateKey absent leaveCovered }
      leaves { leaveId fromKey toKey reason submittedAt daysInWindow }
    }
  }
`;

// ---------------------------------------------------------------------------
// Comments + meetings
// ---------------------------------------------------------------------------

export interface ProfileCommentsT {
  studentId: string;
  fromKey: string;
  toKey: string;
  tally: { total: number; concern: number; positive: number; undelivered: number };
  comments: Array<{
    id: string;
    type: string;
    sentiment: string;
    text: string;
    authorName: string | null;
    deliveredAt: string | null;
    createdAt: string;
  }>;
  meetingNotes: Array<{
    id: string;
    meetingId: string;
    instanceLabel: string;
    meetingDate: string;
    positiveText: string;
    concernText: string;
    createdAt: string;
  }>;
  sinceMeetingDate: string | null;
}

export const STUDENT_PROFILE_COMMENTS_QUERY = gql<{ studentProfileComments: ProfileCommentsT }, PanelVars>`
  query StudentProfileComments($studentId: String!, $fromKey: String!, $toKey: String!) {
    studentProfileComments(studentId: $studentId, fromKey: $fromKey, toKey: $toKey) {
      studentId fromKey toKey
      tally { total concern positive undelivered }
      comments { id type sentiment text authorName deliveredAt createdAt }
      meetingNotes { id meetingId instanceLabel meetingDate positiveText concernText createdAt }
      sinceMeetingDate
    }
  }
`;

// ---------------------------------------------------------------------------
// Class test (the existing CT-4 shape, served through the profile's gate)
// ---------------------------------------------------------------------------

export interface ProfileClassTestT {
  studentId: string;
  studentName: string;
  results: Array<{
    testId: string;
    ctId: string;
    subject: string;
    testNumber: number;
    examDate: string;
    status: string;
    marks: number | null;
    totalMarks: number;
    percent: number | null;
    pass: boolean | null;
    weakness: string | null;
    teacherAction: string | null;
    guardianAction: string | null;
  }>;
  bySubject: Array<{
    subject: string;
    examsTaken: number;
    avgPercent: number | null;
    latestPercent: number | null;
    previousPercent: number | null;
    trend: string;
  }>;
  analytics: {
    examsPresent: number;
    avgPercent: number | null;
    consistency: number | null;
    trajectory: string;
    atRisk: boolean;
    streakKind: string | null;
    streakLength: number;
    bestSubject: string | null;
    weakestSubject: string | null;
    recurringWeaknesses: Array<{ tag: string; count: number }>;
    latestRank: number | null;
    latestRankOf: number | null;
  };
}

export const STUDENT_PROFILE_CLASS_TEST_QUERY = gql<
  { studentProfileClassTest: ProfileClassTestT },
  { studentId: string }
>`
  query StudentProfileClassTest($studentId: String!) {
    studentProfileClassTest(studentId: $studentId) {
      studentId studentName
      results {
        testId ctId subject testNumber examDate status marks totalMarks percent pass
        weakness teacherAction guardianAction
      }
      bySubject { subject examsTaken avgPercent latestPercent previousPercent trend }
      analytics {
        examsPresent avgPercent consistency trajectory atRisk streakKind streakLength
        bestSubject weakestSubject latestRank latestRankOf
        recurringWeaknesses { tag count }
      }
    }
  }
`;
