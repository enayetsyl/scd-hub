/**
 * Activity sheets (AS-1.., D-#988/#989, docs/prd-activity-sheets.md). Bank import and sheet
 * add/replace are REST (lib/files.ts uploadActivityForm); everything else is here.
 */
import { gql } from "urql";

export interface ActivityBankLevelT {
  /** E | M | H */
  level: string;
  classLevels: number[];
  classText: string | null;
  sheetCount: number;
  sampleFileIds: string[];
}

export interface ActivityBankT {
  id: string;
  code: string;
  bankNo: number | null;
  nameBn: string;
  nameEn: string | null;
  /** HAND | LANGUAGE | MATHS | THINKING */
  skillArea: string;
  /** DRAFT | PUBLISHED | RETIRED */
  status: string;
  sortOrder: number;
  hasSheetPdf: boolean;
  hasAnswerPdf: boolean;
  levels: ActivityBankLevelT[];
  retired: number;
  withoutPages: number;
  answers: number;
}

export interface ActivitySheetT {
  id: string;
  itemId: string;
  level: string;
  seq: number;
  details: string | null;
  hasPage: boolean;
  hasAnswer: boolean;
  active: boolean;
}

export interface ActivityRulesT {
  weeklyRequests: number;
  maxOpen: number;
  monthlyTarget: number;
  levelUpAfter: number;
  notReturnedDays: number;
  restockSheets: number;
  restockCopies: number;
  lowTray: number;
  busyMode: boolean;
  isDefault: boolean;
}

const BANK_FIELDS = `
  id code bankNo nameBn nameEn skillArea status sortOrder hasSheetPdf hasAnswerPdf retired withoutPages answers
  levels { level classLevels classText sheetCount sampleFileIds }
`;

export const ACTIVITY_BANKS_QUERY = gql<{ activityBanks: ActivityBankT[] }>`
  query ActivityBanks { activityBanks { ${BANK_FIELDS} } }
`;

export const ACTIVITY_BANK_QUERY = gql<{ activityBank: { bank: ActivityBankT; sheets: ActivitySheetT[] } }, { bankId: string }>`
  query ActivityBank($bankId: String!) {
    activityBank(bankId: $bankId) {
      bank { ${BANK_FIELDS} }
      sheets { id itemId level seq details hasPage hasAnswer active }
    }
  }
`;

export const ACTIVITY_IMAGE_QUERY = gql<{ activityImage: string }, { fileId: string }>`
  query ActivityImage($fileId: String!) { activityImage(fileId: $fileId) }
`;

export const ACTIVITY_RULES_QUERY = gql<{ activityRules: ActivityRulesT }>`
  query ActivityRules {
    activityRules { weeklyRequests maxOpen monthlyTarget levelUpAfter notReturnedDays restockSheets restockCopies lowTray busyMode isDefault }
  }
`;

export const UPDATE_ACTIVITY_BANK = gql`
  mutation UpdateActivityBank(
    $bankId: String!
    $nameBn: String
    $nameEn: String
    $skillArea: String
    $status: String
    $sortOrder: Int
    $classesE: [Int!]
    $classesM: [Int!]
    $classesH: [Int!]
  ) {
    updateActivityBank(
      bankId: $bankId
      nameBn: $nameBn
      nameEn: $nameEn
      skillArea: $skillArea
      status: $status
      sortOrder: $sortOrder
      classesE: $classesE
      classesM: $classesM
      classesH: $classesH
    ) { ${BANK_FIELDS} }
  }
`;

export const SET_ACTIVITY_SHEET_ACTIVE = gql`
  mutation SetActivitySheetActive($sheetId: String!, $active: Boolean!) {
    setActivitySheetActive(sheetId: $sheetId, active: $active) { id active }
  }
`;

export const SAVE_ACTIVITY_RULES = gql`
  mutation SaveActivityRules(
    $weeklyRequests: Int
    $maxOpen: Int
    $monthlyTarget: Int
    $levelUpAfter: Int
    $notReturnedDays: Int
    $restockSheets: Int
    $restockCopies: Int
    $lowTray: Int
    $busyMode: Boolean
  ) {
    saveActivityRules(
      weeklyRequests: $weeklyRequests
      maxOpen: $maxOpen
      monthlyTarget: $monthlyTarget
      levelUpAfter: $levelUpAfter
      notReturnedDays: $notReturnedDays
      restockSheets: $restockSheets
      restockCopies: $restockCopies
      lowTray: $lowTray
      busyMode: $busyMode
    ) { weeklyRequests maxOpen monthlyTarget levelUpAfter notReturnedDays restockSheets restockCopies lowTray busyMode isDefault }
  }
`;

// --- AS-2 the activity corner -------------------------------------------------

export interface ActivityStudentT {
  id: string;
  name: string;
  schoolId: string;
  rollNumber: string | null;
  classLevel: number | null;
  classLabelBn: string;
  sectionNameBn: string | null;
  openSheets: number;
}

export interface ActivityIssueT {
  id: string;
  studentId: string;
  /** TRAY | GUARDIAN | DESK_PRINT */
  path: string;
  status: string;
  result: string | null;
  repeat: boolean;
  unscannedTake: boolean;
  stickerGiven: boolean;
  stickerOwed: boolean;
  requestedAt: string;
  handedAt: string | null;
  returnedAt: string | null;
}

export interface ActivityTrayT {
  bankId: string;
  code: string;
  nameBn: string;
  skillArea: string;
  levels: Array<{ level: string; inTray: number; out: number; low: boolean; printable: number }>;
}

export interface ActivityDeskCopyT {
  code: string;
  kind: string;
  /** IN_TRAY | TAKEN | RETURNED | LOST */
  status: string;
  itemId: string;
  level: string;
  details: string | null;
  bankCode: string;
  bankNameBn: string;
  issue: ActivityIssueT | null;
  holder: ActivityStudentT | null;
  busyMode: boolean;
}

const ISSUE_FIELDS = "id studentId path status result repeat unscannedTake stickerGiven stickerOwed requestedAt handedAt returnedAt";
const STUDENT_FIELDS = "id name schoolId rollNumber classLevel classLabelBn sectionNameBn openSheets";

export const ACTIVITY_TRAYS_QUERY = gql<{ activityTrays: { trays: ActivityTrayT[]; lowTray: number; busyMode: boolean } }>`
  query ActivityTrays {
    activityTrays { lowTray busyMode trays { bankId code nameBn skillArea levels { level inTray out low printable } } }
  }
`;

export const ACTIVITY_DESK_COPY_QUERY = gql<{ activityDeskCopy: ActivityDeskCopyT }, { code: string }>`
  query ActivityDeskCopy($code: String!) {
    activityDeskCopy(code: $code) {
      code kind status itemId level details bankCode bankNameBn busyMode
      issue { ${ISSUE_FIELDS} }
      holder { ${STUDENT_FIELDS} }
    }
  }
`;

export const ACTIVITY_STUDENTS_QUERY = gql<{ activityStudents: ActivityStudentT[] }, { search: string }>`
  query ActivityStudents($search: String!) { activityStudents(search: $search) { ${STUDENT_FIELDS} } }
`;

export const PRINT_ACTIVITY_STOCK = gql<{ printActivityStock: { runId: string; copies: number; sheets: number } }>`
  mutation PrintActivityStock($picks: [String!], $sheets: Int, $copies: Int) {
    printActivityStock(picks: $picks, sheets: $sheets, copies: $copies) { runId copies sheets }
  }
`;

export const ACTIVITY_TAKE = gql<{ activityTake: ActivityIssueT }>`
  mutation ActivityTake($code: String!, $studentId: String!) { activityTake(code: $code, studentId: $studentId) { ${ISSUE_FIELDS} } }
`;

export const ACTIVITY_CANCEL_TAKE = gql`
  mutation ActivityCancelTake($code: String!) { activityCancelTake(code: $code) }
`;

export const ACTIVITY_RETURN = gql<{ activityReturn: ActivityIssueT }>`
  mutation ActivityReturn($code: String!, $result: String!, $viaBox: Boolean, $studentId: String) {
    activityReturn(code: $code, result: $result, viaBox: $viaBox, studentId: $studentId) { ${ISSUE_FIELDS} }
  }
`;

export const ACTIVITY_COPY_LOST = gql`
  mutation ActivityCopyLost($code: String!) { activityCopyLost(code: $code) }
`;
