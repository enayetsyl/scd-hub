/**
 * Staff mistake record operations (D-#936–#939, docs/prd-staff-mistakes.md): the person's
 * own entries and explanations, the reviewer's queue and decisions.
 */
import { gql } from "urql";
import type { MarkCorrectionNoteT } from "./markSubmission";

export type StaffMistakeStatusT = "EXPLANATION_DUE" | "PENDING_REVIEW" | "COUNTED" | "EXCUSED" | "MOVED";

export interface StaffMistakeT {
  id: string;
  staffUserId: string;
  staffName: string;
  kind: "MARK_CORRECTION";
  tier: number;
  dateKey: string;
  status: StaffMistakeStatusT;
  reasonCode: string | null;
  reasonText: string | null;
  explainedAt: string | null;
  explainDueAt: string;
  autoCounted: boolean;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  movedFromName: string | null;
  movedToName: string | null;
  createdAt: string;
  markNote: MarkCorrectionNoteT | null;
}

const FIELDS = `
  id staffUserId staffName kind tier dateKey status reasonCode reasonText explainedAt explainDueAt
  autoCounted decidedByName decidedAt decisionNote movedFromName movedToName createdAt
  markNote {
    id tracker itemCode subject dateKey sectionLabel staffUserId staffName createdAt
    students { studentId studentName chasedAt correctedAt correctedByName via }
  }
`;

export const MY_STAFF_MISTAKES = gql<{ myStaffMistakes: StaffMistakeT[] }>`
  query MyStaffMistakes { myStaffMistakes { ${FIELDS} } }
`;

export const STAFF_MISTAKE_QUEUE = gql<{ staffMistakeQueue: StaffMistakeT[] }>`
  query StaffMistakeQueue { staffMistakeQueue { ${FIELDS} } }
`;

export const STAFF_MISTAKES = gql<{ staffMistakes: StaffMistakeT[] }, { staffProfileId?: string | null }>`
  query StaffMistakes($staffProfileId: String) { staffMistakes(staffProfileId: $staffProfileId) { ${FIELDS} } }
`;

export const STAFF_MISTAKE_MOVE_TARGETS = gql<{ staffMistakeMoveTargets: { userId: string; name: string }[] }>`
  query StaffMistakeMoveTargets { staffMistakeMoveTargets { userId name } }
`;

export const EXPLAIN_STAFF_MISTAKE = gql<
  { explainStaffMistake: StaffMistakeT },
  { id: string; reasonCode: string; reasonText?: string | null }
>`
  mutation ExplainStaffMistake($id: String!, $reasonCode: String!, $reasonText: String) {
    explainStaffMistake(id: $id, reasonCode: $reasonCode, reasonText: $reasonText) { ${FIELDS} }
  }
`;

export const DECIDE_STAFF_MISTAKE = gql<
  { decideStaffMistake: StaffMistakeT },
  { id: string; decision: string; note?: string | null; moveToUserId?: string | null }
>`
  mutation DecideStaffMistake($id: String!, $decision: String!, $note: String, $moveToUserId: String) {
    decideStaffMistake(id: $id, decision: $decision, note: $note, moveToUserId: $moveToUserId) { ${FIELDS} }
  }
`;

// ---------------------------------------------------------------------------
// MR-2 (D-#940–#942, #1005): warnings, meetings, the summary and the rules
// ---------------------------------------------------------------------------

export type StaffWarningStepT = "WARNING" | "MEETING" | "CONDUCT";

export interface StaffWarningT {
  id: string;
  staffUserId: string;
  staffName: string;
  step: StaffWarningStepT;
  threshold: number;
  windowDays: number;
  weightedCount: number;
  mistakes: { dateKey: string; kind: string; tier: number }[];
  acknowledgedAt: string | null;
  otherTimeAskedAt: string | null;
  meetingAt: string | null;
  meetingPlace: string | null;
  meetingSetByName: string | null;
  meetingHeldAt: string | null;
  meetingRecordedByName: string | null;
  meetingWho: string | null;
  meetingDiscussion: string | null;
  meetingActions: string | null;
  followUpDateKey: string | null;
  createdAt: string;
}

const WARNING_FIELDS = `
  id staffUserId staffName step threshold windowDays weightedCount
  mistakes { dateKey kind tier }
  acknowledgedAt otherTimeAskedAt meetingAt meetingPlace meetingSetByName meetingHeldAt
  meetingRecordedByName meetingWho meetingDiscussion meetingActions followUpDateKey createdAt
`;

export const MY_STAFF_WARNING = gql<{ myStaffWarning: StaffWarningT | null }>`
  query MyStaffWarning { myStaffWarning { ${WARNING_FIELDS} } }
`;

export const ACK_STAFF_WARNING = gql<{ acknowledgeStaffWarning: boolean }, { id: string; otherTime?: boolean | null }>`
  mutation AcknowledgeStaffWarning($id: String!, $otherTime: Boolean) { acknowledgeStaffWarning(id: $id, otherTime: $otherTime) }
`;

export const MY_STAFF_WARNINGS = gql<{ myStaffWarnings: StaffWarningT[] }>`
  query MyStaffWarnings { myStaffWarnings { ${WARNING_FIELDS} } }
`;

export const STAFF_WARNINGS = gql<{ staffWarnings: StaffWarningT[] }, { staffUserId: string }>`
  query StaffWarnings($staffUserId: String!) { staffWarnings(staffUserId: $staffUserId) { ${WARNING_FIELDS} } }
`;

export const STAFF_MISTAKES_OF = gql<{ staffMistakes: StaffMistakeT[] }, { staffUserId: string }>`
  query StaffMistakesOf($staffUserId: String!) { staffMistakes(staffUserId: $staffUserId) { ${FIELDS} } }
`;

export const SCHEDULE_STAFF_WARNING_MEETING = gql<
  { scheduleStaffWarningMeeting: StaffWarningT },
  { id: string; at: string; place: string }
>`
  mutation ScheduleStaffWarningMeeting($id: String!, $at: String!, $place: String!) {
    scheduleStaffWarningMeeting(id: $id, at: $at, place: $place) { ${WARNING_FIELDS} }
  }
`;

export const RECORD_STAFF_WARNING_MEETING = gql<
  { recordStaffWarningMeeting: StaffWarningT },
  { id: string; who?: string | null; discussion: string; actions?: string | null; followUpDateKey?: string | null; sendSummary?: boolean | null }
>`
  mutation RecordStaffWarningMeeting($id: String!, $who: String, $discussion: String!, $actions: String, $followUpDateKey: String, $sendSummary: Boolean) {
    recordStaffWarningMeeting(id: $id, who: $who, discussion: $discussion, actions: $actions, followUpDateKey: $followUpDateKey, sendSummary: $sendSummary) { ${WARNING_FIELDS} }
  }
`;

export interface StaffMistakeSummaryRowT {
  staffUserId: string;
  staffName: string;
  counted: number;
  weighted: number;
  pending: number;
  excused: number;
  topKind: string | null;
  warningStep: StaffWarningStepT | null;
  meetingAt: string | null;
  nextThreshold: number;
}

export const STAFF_MISTAKE_SUMMARY = gql<
  {
    staffMistakeSummary: {
      days: number;
      rows: StaffMistakeSummaryRowT[];
      byKind: { kind: string; counted: number }[];
      totals: { counted: number; pending: number; excused: number; warnings: number };
    };
  },
  { days?: number | null }
>`
  query StaffMistakeSummary($days: Int) {
    staffMistakeSummary(days: $days) {
      days
      rows { staffUserId staffName counted weighted pending excused topKind warningStep meetingAt nextThreshold }
      byKind { kind counted }
      totals { counted pending excused warnings }
    }
  }
`;

export interface StaffMistakeSettingsT {
  rungs: { step: StaffWarningStepT; count: number; windowDays: number }[];
  tier1Weight: number;
  tier2Weight: number;
  tier3Weight: number;
  deadline: "NEXT_SCHOOL_DAY" | "HOURS_24" | "SCHOOL_DAYS_3";
  disabledKinds: string[];
}

const SETTINGS_FIELDS = `rungs { step count windowDays } tier1Weight tier2Weight tier3Weight deadline disabledKinds`;

export const STAFF_MISTAKE_SETTINGS = gql<{ staffMistakeSettings: StaffMistakeSettingsT }>`
  query StaffMistakeSettings { staffMistakeSettings { ${SETTINGS_FIELDS} } }
`;

export const SET_STAFF_MISTAKE_SETTINGS = gql<
  { setStaffMistakeSettings: StaffMistakeSettingsT },
  {
    rungs: { step: string; count: number; windowDays: number }[];
    tier1Weight: number;
    tier2Weight: number;
    tier3Weight: number;
    deadline: string;
    disabledKinds: string[];
  }
>`
  mutation SetStaffMistakeSettings($rungs: [StaffMistakeRungInput!]!, $tier1Weight: Float!, $tier2Weight: Float!, $tier3Weight: Float!, $deadline: String!, $disabledKinds: [String!]!) {
    setStaffMistakeSettings(rungs: $rungs, tier1Weight: $tier1Weight, tier2Weight: $tier2Weight, tier3Weight: $tier3Weight, deadline: $deadline, disabledKinds: $disabledKinds) { ${SETTINGS_FIELDS} }
  }
`;
