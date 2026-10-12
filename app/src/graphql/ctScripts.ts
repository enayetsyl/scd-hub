/**
 * Class-test script operations (CS-1..CS-3, docs/prd-ct-scripts.md, D-#715–#719) —
 * mirror server/src/modules/trackers/resolvers/classTestScripts.ts.
 */
import { gql } from "urql";
import type { CtScriptStage } from "@scd/shared";

type NoVars = Record<string, never>;

export interface CtScriptRowT {
  testId: string;
  ctId: string;
  subject: string;
  subjectBn: string;
  testNumber: number;
  examDate: string;
  classLevel: number | null;
  sectionId: string | null;
  subjectGroupId: string | null;
  unitLabelBn: string;
  teacherId: string;
  teacherName: string;
  stage: CtScriptStage;
  dueDateKey: string;
  returnDueDateKey: string | null;
  presentCount: number;
  resolvedCount: number;
  pageCount: number;
  receivedCount: number | null;
  receivedAt: string | null;
  publishedAt: string | null;
  handedBackAt: string | null;
  returnedAt: string | null;
  waivedAt: string | null;
  waiveReason: string | null;
  backfilled: boolean;
}

const ROW_FIELDS = `
  testId ctId subject subjectBn testNumber examDate classLevel sectionId subjectGroupId unitLabelBn
  teacherId teacherName stage dueDateKey returnDueDateKey presentCount resolvedCount pageCount
  receivedCount receivedAt publishedAt handedBackAt returnedAt waivedAt waiveReason backfilled
`;

export interface CtScriptPageT {
  fileId: string;
  mime: string;
  originalName: string;
}

export interface CtScriptStudentT {
  studentId: string;
  name: string;
  nameBn: string | null;
  rollNumber: string | null;
  status: string;
  marks: number | null;
  pages: CtScriptPageT[];
  missing: boolean;
  missingReason: string | null;
}

export interface CtScriptSheetT {
  test: CtScriptRowT;
  totalMarks: number;
  students: CtScriptStudentT[];
}

const SHEET_FIELDS = `
  test { ${ROW_FIELDS} }
  totalMarks
  students { studentId name nameBn rollNumber status marks missing missingReason pages { fileId mime originalName } }
`;

export const MY_CT_SCRIPT_TASKS_QUERY = gql<{ myClassTestScriptTasks: CtScriptRowT[] }, NoVars>`
  query MyClassTestScriptTasks { myClassTestScriptTasks { ${ROW_FIELDS} } }
`;

export const CT_SCRIPT_QUEUE_QUERY = gql<{ classTestScriptQueue: CtScriptRowT[] }, NoVars>`
  query ClassTestScriptQueue { classTestScriptQueue { ${ROW_FIELDS} } }
`;

export const CT_SCRIPT_SHEET_QUERY = gql<{ classTestScriptSheet: CtScriptSheetT }, { testId: string }>`
  query ClassTestScriptSheet($testId: String!) { classTestScriptSheet(testId: $testId) { ${SHEET_FIELDS} } }
`;

export const RECEIVE_CT_SCRIPTS = gql<{ receiveClassTestScripts: CtScriptRowT }, { testId: string; count: number }>`
  mutation ReceiveClassTestScripts($testId: String!, $count: Int!) {
    receiveClassTestScripts(testId: $testId, count: $count) { ${ROW_FIELDS} }
  }
`;

export const UNDO_RECEIVE_CT_SCRIPTS = gql<{ undoReceiveClassTestScripts: CtScriptRowT }, { testId: string }>`
  mutation UndoReceiveClassTestScripts($testId: String!) { undoReceiveClassTestScripts(testId: $testId) { ${ROW_FIELDS} } }
`;

export const WAIVE_CT_SCRIPTS = gql<{ waiveClassTestScripts: CtScriptRowT }, { testId: string; reason: string }>`
  mutation WaiveClassTestScripts($testId: String!, $reason: String!) {
    waiveClassTestScripts(testId: $testId, reason: $reason) { ${ROW_FIELDS} }
  }
`;

export const UNWAIVE_CT_SCRIPTS = gql<{ unwaiveClassTestScripts: CtScriptRowT }, { testId: string }>`
  mutation UnwaiveClassTestScripts($testId: String!) { unwaiveClassTestScripts(testId: $testId) { ${ROW_FIELDS} } }
`;

export const ATTACH_CT_SCRIPT_PAGES = gql<
  { attachClassTestScriptPages: CtScriptSheetT },
  { testId: string; studentId: string; fileIds: string[] }
>`
  mutation AttachClassTestScriptPages($testId: String!, $studentId: String!, $fileIds: [String!]!) {
    attachClassTestScriptPages(testId: $testId, studentId: $studentId, fileIds: $fileIds) { ${SHEET_FIELDS} }
  }
`;

export const REMOVE_CT_SCRIPT_PAGE = gql<
  { removeClassTestScriptPage: CtScriptSheetT },
  { testId: string; studentId: string; fileId: string }
>`
  mutation RemoveClassTestScriptPage($testId: String!, $studentId: String!, $fileId: String!) {
    removeClassTestScriptPage(testId: $testId, studentId: $studentId, fileId: $fileId) { ${SHEET_FIELDS} }
  }
`;

export const SET_CT_SCRIPT_MISSING = gql<
  { setClassTestScriptMissing: CtScriptSheetT },
  { testId: string; studentId: string; missing: boolean; reason?: string | null }
>`
  mutation SetClassTestScriptMissing($testId: String!, $studentId: String!, $missing: Boolean!, $reason: String) {
    setClassTestScriptMissing(testId: $testId, studentId: $studentId, missing: $missing, reason: $reason) { ${SHEET_FIELDS} }
  }
`;

export const PUBLISH_CT_SCRIPTS = gql<
  { publishClassTestScripts: { test: CtScriptRowT; notifiedGuardianCount: number } },
  { testId: string }
>`
  mutation PublishClassTestScripts($testId: String!) {
    publishClassTestScripts(testId: $testId) { notifiedGuardianCount test { ${ROW_FIELDS} } }
  }
`;

export const UNPUBLISH_CT_SCRIPTS = gql<{ unpublishClassTestScripts: CtScriptRowT }, { testId: string }>`
  mutation UnpublishClassTestScripts($testId: String!) { unpublishClassTestScripts(testId: $testId) { ${ROW_FIELDS} } }
`;

export const HAND_BACK_CT_SCRIPTS = gql<{ handBackClassTestScripts: CtScriptRowT }, { testId: string }>`
  mutation HandBackClassTestScripts($testId: String!) { handBackClassTestScripts(testId: $testId) { ${ROW_FIELDS} } }
`;

export const MARK_CT_SCRIPTS_RETURNED = gql<{ markClassTestScriptsReturned: CtScriptRowT }, { testId: string }>`
  mutation MarkClassTestScriptsReturned($testId: String!) { markClassTestScriptsReturned(testId: $testId) { ${ROW_FIELDS} } }
`;
