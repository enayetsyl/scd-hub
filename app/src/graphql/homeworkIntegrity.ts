/**
 * Homework-honesty check (GH-3, D-#1522; AL-12 outside-help extensions, D-#1676). `homework_integrity:view` / `:view_all` /
 * `:record` / `:settings`. The queue is ROW-SCOPED server-side: Office + Principal see every case, a class teacher or the
 * subject teacher only their own. `childHintSteps` is the teacher's read-only hint count (mastery:view).
 * The ONE guardian-facing read is `childHomeworkHelpNotes`: a subject code and a fixed gentle sentence - no case, no number.
 */
import { gql } from "urql";

const ROW = `
  id studentId studentName studentSchoolId classToken classNameBn sectionId sectionNameBn subject loCode loLabelBn
  hwPct ctPct gap status outcome note openedAt closedAt recurring tagActive tagUntil
`;

export type IntegrityRowT = {
  id: string;
  studentId: string;
  studentName: string;
  studentSchoolId: string;
  classToken: string;
  classNameBn: string;
  sectionId: string;
  sectionNameBn: string;
  subject: string;
  loCode: string;
  loLabelBn: string;
  hwPct: number;
  ctPct: number;
  gap: number;
  status: "OPEN" | "CLOSED";
  outcome: string | null;
  note: string | null;
  openedAt: string;
  closedAt: string | null;
  recurring: boolean;
  /** AL-12: the term tag is on (outcome "guardian did it" / "unclear"). */
  tagActive: boolean;
  tagUntil: string | null;
};

export type IntegrityItemT = {
  paperId: string;
  qid: string | null;
  itemNo: number | null;
  earned: number;
  available: number;
  date: string;
  hintStep: number;
};

export type IntegrityDetailT = {
  row: IntegrityRowT;
  hwItems: IntegrityItemT[];
  ctItems: IntegrityItemT[];
  history: { at: string; hwPct: number; ctPct: number }[];
  investigatorNames: string[];
  notes: { byName: string; at: string; text: string; mine: boolean }[];
};

export type IntegritySettingsT = { gapPoints: number; recurringCases: number };

/** A live term tag on a child's objective (staff views). */
export type OutsideHelpTagT = {
  caseId: string;
  studentId: string;
  subject: string;
  loCode: string;
  loLabelBn: string;
  outcome: string;
  tagUntil: string;
  recurring: boolean;
  markBn: string;
};

export type HomeworkHelpNoteT = { subject: string; noteBn: string };

export const HOMEWORK_INTEGRITY_CASES = gql`
  query HomeworkIntegrityCases($status: String, $classToken: String, $sectionId: String, $subject: String) {
    homeworkIntegrityCases(status: $status, classToken: $classToken, sectionId: $sectionId, subject: $subject) { ${ROW} }
  }
`;

export const HOMEWORK_INTEGRITY_CASE = gql`
  query HomeworkIntegrityCase($id: String!) {
    homeworkIntegrityCase(id: $id) {
      row { ${ROW} }
      hwItems { paperId qid itemNo earned available date hintStep }
      ctItems { paperId qid itemNo earned available date hintStep }
      history { at hwPct ctPct }
      investigatorNames
      notes { byName at text mine }
    }
  }
`;

export const ADD_HOMEWORK_INTEGRITY_NOTE = gql`
  mutation AddHomeworkIntegrityNote($id: String!, $text: String!) {
    addHomeworkIntegrityNote(id: $id, text: $text) {
      row { ${ROW} }
      hwItems { paperId qid itemNo earned available date hintStep }
      ctItems { paperId qid itemNo earned available date hintStep }
      history { at hwPct ctPct }
      investigatorNames
      notes { byName at text mine }
    }
  }
`;

export const HOMEWORK_INTEGRITY_SETTINGS = gql`
  query HomeworkIntegritySettings {
    homeworkIntegritySettings { gapPoints recurringCases }
  }
`;

export const SAVE_HOMEWORK_INTEGRITY_SETTINGS = gql`
  mutation SaveHomeworkIntegritySettings($gapPoints: Float!, $recurringCases: Int!) {
    saveHomeworkIntegritySettings(gapPoints: $gapPoints, recurringCases: $recurringCases) { gapPoints recurringCases }
  }
`;

/** The live tags on one section x subject - the marks grid marks a tagged objective's HW/AS marks with `markBn`. */
export const SECTION_OUTSIDE_HELP_TAGS = gql`
  query SectionOutsideHelpTags($sectionId: String!, $subject: String!) {
    sectionOutsideHelpTags(sectionId: $sectionId, subject: $subject) { caseId studentId subject loCode loLabelBn outcome tagUntil recurring markBn }
  }
`;

/** One child's live tags (mastery student / trail screens); `subject` / `loCode` narrow it. */
export const STUDENT_OUTSIDE_HELP_TAGS = gql`
  query StudentOutsideHelpTags($studentId: String!, $subject: String, $loCode: String) {
    studentOutsideHelpTags(studentId: $studentId, subject: $subject, loCode: $loCode) { caseId studentId subject loCode loLabelBn outcome tagUntil recurring markBn }
  }
`;

/** Guardian plane: the gentle note per subject for the caller's own child (after "guardian did it", until the term ends). */
export const CHILD_HOMEWORK_HELP_NOTES = gql`
  query ChildHomeworkHelpNotes($studentId: String!) {
    childHomeworkHelpNotes(studentId: $studentId) { subject noteBn }
  }
`;

export const RECORD_HOMEWORK_INTEGRITY_OUTCOME = gql`
  mutation RecordHomeworkIntegrityOutcome($id: String!, $outcome: String!, $note: String) {
    recordHomeworkIntegrityOutcome(id: $id, outcome: $outcome, note: $note) { ${ROW} }
  }
`;

export const RECOMPUTE_HOMEWORK_INTEGRITY = gql`
  mutation RecomputeHomeworkIntegrity {
    recomputeHomeworkIntegrity { checked opened updated reopened }
  }
`;

export const CHILD_HINT_STEPS = gql`
  query ChildHintSteps($studentId: String!, $assignmentId: String!, $qids: [String!]!) {
    childHintSteps(studentId: $studentId, assignmentId: $assignmentId, qids: $qids) { qid step }
  }
`;
