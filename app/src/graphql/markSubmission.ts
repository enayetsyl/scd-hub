/**
 * Mark-submission guard operations (D-#889–#893, docs/prd-mark-submission-guard.md):
 * the teacher's Sunday pop-ups, the 09:30 list for Office + Principal, and the staff
 * file's "নম্বর জমায় ভুল" notes.
 */
import { gql } from "urql";

export interface MarkDueItemT {
  asItemId: string;
  asId: string;
  subject: string;
  sectionLabel: string;
  marked: boolean;
}

export interface MyMarkReminderT {
  stage: "MORNING" | "NINE";
  dateKey: string;
  items: MarkDueItemT[];
}

export const MY_MARK_REMINDER = gql<{ myMarkReminder: MyMarkReminderT | null }>`
  query MyMarkReminder {
    myMarkReminder { stage dateKey items { asItemId asId subject sectionLabel marked } }
  }
`;

export const ACK_MARK_REMINDER = gql<{ acknowledgeMarkReminder: boolean }, { stage: string }>`
  mutation AcknowledgeMarkReminder($stage: String!) { acknowledgeMarkReminder(stage: $stage) }
`;

export interface MarkEscalationRowT {
  asItemId: string;
  asId: string;
  subject: string;
  sectionLabel: string;
  teacherNames: string[];
  markedNow: boolean;
}

export const MY_MARK_ESCALATION = gql<{
  myMarkEscalation: { dateKey: string; createdAt: string; rows: MarkEscalationRowT[] } | null;
}>`
  query MyMarkEscalation {
    myMarkEscalation { dateKey createdAt rows { asItemId asId subject sectionLabel teacherNames markedNow } }
  }
`;

export const ACK_MARK_ESCALATION = gql<{ acknowledgeMarkEscalation: boolean }>`
  mutation AcknowledgeMarkEscalation { acknowledgeMarkEscalation }
`;

export interface MarkCorrectionNoteT {
  id: string;
  tracker: "HOMEWORK" | "ASSIGNMENT";
  itemCode: string;
  subject: string;
  dateKey: string;
  sectionLabel: string;
  staffUserId: string;
  staffName: string;
  createdAt: string;
  students: {
    studentId: string;
    studentName: string;
    chasedAt: string;
    correctedAt: string;
    correctedByName: string;
    via: "FLIP" | "UNDO";
  }[];
}

export const MARK_CORRECTION_NOTES = gql<
  { markCorrectionNotes: MarkCorrectionNoteT[] },
  { staffProfileId?: string | null; all?: boolean | null }
>`
  query MarkCorrectionNotes($staffProfileId: String, $all: Boolean) {
    markCorrectionNotes(staffProfileId: $staffProfileId, all: $all) {
      id tracker itemCode subject dateKey sectionLabel staffUserId staffName createdAt
      students { studentId studentName chasedAt correctedAt correctedByName via }
    }
  }
`;
