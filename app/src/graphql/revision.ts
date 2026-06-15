/**
 * Typed GraphQL operations for the Saturday Qur'an-Hifz Revision module (SR-4 app
 * surfaces over the SR-1..SR-3 server resolvers + the SR-4 guardian read —
 * server/src/modules/revision/*). Hand-authored to mirror the resolvers exactly;
 * no server change. Kept in its own module to avoid bloating the 4.7k-line
 * operations.ts (the same convention as observation.ts / comments.ts).
 *
 * Server convention: ISO dates are String; juz numbers / counts are Int; amountJuz
 * is Float. Category enum = SABAQ|SABQI|MANZIL; mistake keys = harf|ghunnah|madd|other.
 */
import { gql } from "urql";

type NoVars = Record<string, never>;

// ---------------------------------------------------------------------------
// Core revision entry (SR-1) — the per-student Saturday record
// ---------------------------------------------------------------------------

export interface RevisionJuzMistakesT {
  harf: number;
  ghunnah: number;
  madd: number;
  other: number;
}
export interface RevisionJuzRecordT {
  juz: number;
  category: string;
  amountJuz: number;
  tanbih: number;
  fath: number;
  mistakes: RevisionJuzMistakesT;
  note: string | null;
}
export interface RevisionEntryT {
  id: string;
  groupId: string;
  studentId: string;
  date: string;
  present: boolean;
  juzRecords: RevisionJuzRecordT[];
  teacherComment: string | null;
  teacherUserId: string | null;
  deliveredAt: string | null;
  deliveryChannels: string[];
  createdAt: string;
  updatedAt: string;
}

const JUZ_RECORD_FIELDS = `juz category amountJuz tanbih fath mistakes { harf ghunnah madd other } note`;
const REVISION_ENTRY_FIELDS = `id groupId studentId date present juzRecords { ${JUZ_RECORD_FIELDS} } teacherComment teacherUserId deliveredAt deliveryChannels createdAt updatedAt`;

export interface RevisionGroupT {
  id: string;
  code: string;
  nameBn: string;
  level: number;
  gender: string;
}

export const MY_REVISION_GROUPS_QUERY = gql<{ myRevisionGroups: RevisionGroupT[] }, NoVars>`
  query MyRevisionGroups {
    myRevisionGroups { id code nameBn level gender }
  }
`;

export interface RevisionGridRowT {
  studentId: string;
  studentName: string;
  entry: RevisionEntryT | null;
}

export const GROUP_REVISION_SATURDAY_QUERY = gql<
  { groupRevisionSaturday: RevisionGridRowT[] },
  { groupId: string; date: string }
>`
  query GroupRevisionSaturday($groupId: String!, $date: String!) {
    groupRevisionSaturday(groupId: $groupId, date: $date) {
      studentId studentName
      entry { ${REVISION_ENTRY_FIELDS} }
    }
  }
`;

export const STUDENT_REVISION_HISTORY_QUERY = gql<
  { studentRevisionHistory: RevisionEntryT[] },
  { studentId: string }
>`
  query StudentRevisionHistory($studentId: String!) {
    studentRevisionHistory(studentId: $studentId) { ${REVISION_ENTRY_FIELDS} }
  }
`;

// --- Inputs (SR-1) ---------------------------------------------------------

export interface RevisionJuzMistakesInput {
  harf?: number | null;
  ghunnah?: number | null;
  madd?: number | null;
  other?: number | null;
}
export interface RevisionJuzRecordInput {
  juz: number;
  category: string;
  amountJuz: number;
  tanbih?: number | null;
  fath?: number | null;
  mistakes?: RevisionJuzMistakesInput | null;
  note?: string | null;
}

export const RECORD_REVISION_ENTRY = gql<
  { recordRevisionEntry: RevisionEntryT },
  {
    groupId: string;
    studentId: string;
    date: string;
    present: boolean;
    juzRecords?: RevisionJuzRecordInput[] | null;
    teacherComment?: string | null;
  }
>`
  mutation RecordRevisionEntry(
    $groupId: String!, $studentId: String!, $date: String!, $present: Boolean!,
    $juzRecords: [RevisionJuzRecordInput!], $teacherComment: String
  ) {
    recordRevisionEntry(
      groupId: $groupId, studentId: $studentId, date: $date, present: $present,
      juzRecords: $juzRecords, teacherComment: $teacherComment
    ) { ${REVISION_ENTRY_FIELDS} }
  }
`;

export const EDIT_REVISION_ENTRY = gql<
  { editRevisionEntry: RevisionEntryT },
  {
    entryId: string;
    groupId: string;
    present: boolean;
    juzRecords?: RevisionJuzRecordInput[] | null;
    teacherComment?: string | null;
  }
>`
  mutation EditRevisionEntry(
    $entryId: String!, $groupId: String!, $present: Boolean!,
    $juzRecords: [RevisionJuzRecordInput!], $teacherComment: String
  ) {
    editRevisionEntry(
      entryId: $entryId, groupId: $groupId, present: $present,
      juzRecords: $juzRecords, teacherComment: $teacherComment
    ) { ${REVISION_ENTRY_FIELDS} }
  }
`;

// ---------------------------------------------------------------------------
// Delivery + escalation (SR-2)
// ---------------------------------------------------------------------------

export interface RevisionDeliveryOutcomeT {
  entryId: string;
  studentId: string;
  studentName: string;
  present: boolean;
  kind: string;
  messageBn: string;
  waLink: string | null;
  unreachableByWa: boolean;
  deliveryChannels: string[];
  deliveredAt: string | null;
  escalatedStreak: number | null;
}

const DELIVERY_OUTCOME_FIELDS = `entryId studentId studentName present kind messageBn waLink unreachableByWa deliveryChannels deliveredAt escalatedStreak`;

export const DELIVER_REVISION_ENTRY = gql<
  { deliverRevisionEntry: RevisionDeliveryOutcomeT },
  { entryId: string }
>`
  mutation DeliverRevisionEntry($entryId: String!) {
    deliverRevisionEntry(entryId: $entryId) { ${DELIVERY_OUTCOME_FIELDS} }
  }
`;

export const DELIVER_GROUP_REVISION_SATURDAY = gql<
  { deliverGroupRevisionSaturday: RevisionDeliveryOutcomeT[] },
  { groupId: string; date: string }
>`
  mutation DeliverGroupRevisionSaturday($groupId: String!, $date: String!) {
    deliverGroupRevisionSaturday(groupId: $groupId, date: $date) { ${DELIVERY_OUTCOME_FIELDS} }
  }
`;

export interface RevisionEscalationConfigT {
  consecutiveAbsenceThreshold: number;
  isDefault: boolean;
}

export const REVISION_ESCALATION_CONFIG_QUERY = gql<
  { revisionEscalationConfig: RevisionEscalationConfigT },
  NoVars
>`
  query RevisionEscalationConfig {
    revisionEscalationConfig { consecutiveAbsenceThreshold isDefault }
  }
`;

export const SET_REVISION_ESCALATION_CONFIG = gql<
  { setRevisionEscalationConfig: RevisionEscalationConfigT },
  { consecutiveAbsenceThreshold: number }
>`
  mutation SetRevisionEscalationConfig($consecutiveAbsenceThreshold: Int!) {
    setRevisionEscalationConfig(consecutiveAbsenceThreshold: $consecutiveAbsenceThreshold) {
      consecutiveAbsenceThreshold isDefault
    }
  }
`;

// ---------------------------------------------------------------------------
// Analytics / dashboards (SR-3)
// ---------------------------------------------------------------------------

export interface RevisionJuzWeaknessT {
  juz: number;
  tanbih: number;
  fath: number;
  harf: number;
  ghunnah: number;
  madd: number;
  other: number;
  total: number;
}

export const STUDENT_JUZ_WEAKNESS_QUERY = gql<
  { studentJuzWeakness: RevisionJuzWeaknessT[] },
  { studentId: string; asOf?: string | null }
>`
  query StudentJuzWeakness($studentId: String!, $asOf: String) {
    studentJuzWeakness(studentId: $studentId, asOf: $asOf) {
      juz tanbih fath harf ghunnah madd other total
    }
  }
`;

export interface RevisionCoverageRowT {
  studentId: string;
  studentName: string;
  juz: number;
  lastRevised: string | null;
  daysSince: number | null;
  overdue: boolean;
}

export const REVISION_GROUP_COVERAGE_QUERY = gql<
  { revisionGroupCoverage: RevisionCoverageRowT[] },
  { groupId: string; asOf?: string | null; windowDays?: number | null }
>`
  query RevisionGroupCoverage($groupId: String!, $asOf: String, $windowDays: Int) {
    revisionGroupCoverage(groupId: $groupId, asOf: $asOf, windowDays: $windowDays) {
      studentId studentName juz lastRevised daysSince overdue
    }
  }
`;

export interface RevisionTrendPointT {
  date: string;
  tanbih: number;
  fath: number;
  mistakes: number;
  total: number;
}
export interface RevisionWeeklyTrendT {
  points: RevisionTrendPointT[];
  trend: string;
}

export const REVISION_WEEKLY_TREND_QUERY = gql<
  { revisionWeeklyTrend: RevisionWeeklyTrendT },
  { studentId?: string | null; groupId?: string | null; asOf?: string | null }
>`
  query RevisionWeeklyTrend($studentId: String, $groupId: String, $asOf: String) {
    revisionWeeklyTrend(studentId: $studentId, groupId: $groupId, asOf: $asOf) {
      trend
      points { date tanbih fath mistakes total }
    }
  }
`;

export interface RevisionMistakesAggT {
  harf: number;
  ghunnah: number;
  madd: number;
  other: number;
}
export interface RevisionPortionsByCategoryT {
  SABAQ: number;
  SABQI: number;
  MANZIL: number;
}
export interface RevisionDashboardT {
  scopeId: string;
  entries: number;
  present: number;
  absent: number;
  portionsByCategory: RevisionPortionsByCategoryT;
  totalTanbih: number;
  totalFath: number;
  mistakes: RevisionMistakesAggT;
  weakestJuz: RevisionJuzWeaknessT | null;
}

const DASH_FIELDS = `scopeId entries present absent portionsByCategory { SABAQ SABQI MANZIL } totalTanbih totalFath mistakes { harf ghunnah madd other } weakestJuz { juz tanbih fath harf ghunnah madd other total }`;

export const REVISION_LEVEL_DASHBOARD_QUERY = gql<
  { revisionLevelDashboard: RevisionDashboardT },
  { groupId: string; asOf?: string | null }
>`
  query RevisionLevelDashboard($groupId: String!, $asOf: String) {
    revisionLevelDashboard(groupId: $groupId, asOf: $asOf) { ${DASH_FIELDS} }
  }
`;

export const REVISION_STUDENT_DASHBOARD_QUERY = gql<
  { revisionStudentDashboard: RevisionDashboardT },
  { studentId: string; asOf?: string | null }
>`
  query RevisionStudentDashboard($studentId: String!, $asOf: String) {
    revisionStudentDashboard(studentId: $studentId, asOf: $asOf) { ${DASH_FIELDS} }
  }
`;

export const REVISION_MISTAKE_BREAKDOWN_QUERY = gql<
  { revisionMistakeBreakdown: RevisionMistakesAggT },
  { studentId?: string | null; groupId?: string | null; asOf?: string | null }
>`
  query RevisionMistakeBreakdown($studentId: String, $groupId: String, $asOf: String) {
    revisionMistakeBreakdown(studentId: $studentId, groupId: $groupId, asOf: $asOf) {
      harf ghunnah madd other
    }
  }
`;

// ---------------------------------------------------------------------------
// Completeness / chase (SR-3) — which level groups still owe a Saturday entry
// ---------------------------------------------------------------------------

export interface RevisionCompletenessRowT {
  groupId: string;
  code: string;
  nameBn: string;
  level: number;
}

export const REVISION_COMPLETENESS_STATUS_QUERY = gql<
  { revisionCompletenessStatus: RevisionCompletenessRowT[] },
  { date: string }
>`
  query RevisionCompletenessStatus($date: String!) {
    revisionCompletenessStatus(date: $date) { groupId code nameBn level }
  }
`;

export interface RevisionCompletenessChaseRowT {
  groupId: string;
  code: string;
  nameBn: string;
  level: number;
  teacherId: string | null;
  teacherName: string | null;
  unreachableByWa: boolean;
  messageBn: string;
  waLink: string | null;
}

export const REVISION_COMPLETENESS_CHASE_QUERY = gql<
  { revisionCompletenessChase: RevisionCompletenessChaseRowT[] },
  { date: string }
>`
  query RevisionCompletenessChase($date: String!) {
    revisionCompletenessChase(date: $date) {
      groupId code nameBn level teacherId teacherName unreachableByWa messageBn waLink
    }
  }
`;

// ---------------------------------------------------------------------------
// Guardian child read (SR-4) — delivered Saturdays only
// ---------------------------------------------------------------------------

export interface GuardianRevisionMistakesT {
  harf: number;
  ghunnah: number;
  madd: number;
  other: number;
}
export interface GuardianRevisionJuzRecordT {
  juz: number;
  category: string;
  amountJuz: number;
  tanbih: number;
  fath: number;
  mistakes: GuardianRevisionMistakesT;
  note: string | null;
}
export interface GuardianRevisionEntryT {
  id: string;
  date: string;
  present: boolean;
  juzRecords: GuardianRevisionJuzRecordT[];
  teacherComment: string | null;
  deliveredAt: string | null;
}

export const CHILD_REVISION_QUERY = gql<
  { childRevision: GuardianRevisionEntryT[] },
  { studentId: string }
>`
  query ChildRevision($studentId: String!) {
    childRevision(studentId: $studentId) {
      id date present
      juzRecords { ${JUZ_RECORD_FIELDS} }
      teacherComment deliveredAt
    }
  }
`;
