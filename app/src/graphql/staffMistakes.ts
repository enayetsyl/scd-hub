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
