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

// --- AS-3 guardian choose, morning batch, hand-out ----------------------------

export interface ActivityChoicesT {
  weeklyLimit: number;
  usedThisWeek: number;
  maxOpen: number;
  open: number;
  banks: Array<{
    bankId: string;
    code: string;
    nameBn: string;
    nameEn: string | null;
    skillArea: string;
    levels: Array<{ level: string; sheetCount: number; doneByChild: number; sampleFileIds: string[] }>;
  }>;
}

export interface ActivityChildSheetT {
  issue: ActivityIssueT;
  itemId: string;
  level: string;
  bankId: string;
  bankNameBn: string;
  skillArea: string;
  hasAnswer: boolean;
}

export interface ActivityBatchRowT {
  issue: ActivityIssueT;
  studentName: string;
  classLevel: number | null;
  sectionNameBn: string | null;
  itemId: string;
  bankNameBn: string;
}

const BATCH_ROW = `issue { ${ISSUE_FIELDS} } studentName classLevel sectionNameBn itemId bankNameBn`;

export const ACTIVITY_CHOICES_QUERY = gql<{ activityChoices: ActivityChoicesT }, { studentId: string }>`
  query ActivityChoices($studentId: String!) {
    activityChoices(studentId: $studentId) {
      weeklyLimit usedThisWeek maxOpen open
      banks { bankId code nameBn nameEn skillArea levels { level sheetCount doneByChild sampleFileIds } }
    }
  }
`;

export const CHILD_ACTIVITY_SHEETS_QUERY = gql<{ childActivitySheets: ActivityChildSheetT[] }, { studentId: string }>`
  query ChildActivitySheets($studentId: String!) {
    childActivitySheets(studentId: $studentId) { issue { ${ISSUE_FIELDS} } itemId level bankId bankNameBn skillArea hasAnswer }
  }
`;

export const REQUEST_ACTIVITY_SHEET = gql<{ requestActivitySheet: ActivityIssueT }>`
  mutation RequestActivitySheet($studentId: String!, $bankId: String!, $level: String!) {
    requestActivitySheet(studentId: $studentId, bankId: $bankId, level: $level) { ${ISSUE_FIELDS} }
  }
`;

export const CANCEL_ACTIVITY_REQUEST = gql`
  mutation CancelActivityRequest($issueId: String!) { cancelActivityRequest(issueId: $issueId) { id status } }
`;

export const ACTIVITY_REQUESTS_QUERY = gql<{ activityRequests: ActivityBatchRowT[] }>`
  query ActivityRequests { activityRequests { ${BATCH_ROW} } }
`;

export const PRINT_ACTIVITY_BATCH = gql<{ printActivityBatch: { runId: string; sheets: number } }>`
  mutation PrintActivityBatch($issueIds: [String!]) { printActivityBatch(issueIds: $issueIds) { runId sheets } }
`;

export const ACTIVITY_HANDOUT_ROSTER = gql<{ activityHandOutRoster: ActivityBatchRowT[] }>`
  query ActivityHandOutRoster { activityHandOutRoster { ${BATCH_ROW} } }
`;

export const ACTIVITY_HANDOUT = gql`
  mutation ActivityHandOut($issueIds: [String!]!) { activityHandOut(issueIds: $issueIds) }
`;

// --- AS-4 check & follow-up --------------------------------------------------

export interface ActivityHintT {
  bankId: string;
  bankNameBn: string;
  from: string;
  to: string;
}

export interface ActivityTodayT {
  open: number;
  owed: number;
  doneThisMonth: number;
  latest: { issue: ActivityIssueT; bankNameBn: string; itemId: string } | null;
  hint: ActivityHintT | null;
}

export const ACTIVITY_ANSWER_IMAGE = gql<{ activityAnswerImage: string }, { issueId: string }>`
  query ActivityAnswerImage($issueId: String!) { activityAnswerImage(issueId: $issueId) }
`;

export const ACTIVITY_LEVEL_UP_HINTS = gql<{ activityLevelUpHints: ActivityHintT[] }, { studentId: string }>`
  query ActivityLevelUpHints($studentId: String!) { activityLevelUpHints(studentId: $studentId) { bankId bankNameBn from to } }
`;

export const ACTIVITY_TODAY = gql<{ activityToday: ActivityTodayT }, { studentId: string }>`
  query ActivityToday($studentId: String!) {
    activityToday(studentId: $studentId) {
      open owed doneThisMonth
      latest { issue { ${ISSUE_FIELDS} } bankNameBn itemId }
      hint { bankId bankNameBn from to }
    }
  }
`;

export const ACTIVITY_STICKERS_OWED = gql<{ activityStickersOwed: Array<{ issue: ActivityIssueT; studentName: string; classLevel: number | null; sectionNameBn: string | null; bankNameBn: string }> }>`
  query ActivityStickersOwed { activityStickersOwed { issue { ${ISSUE_FIELDS} } studentName classLevel sectionNameBn bankNameBn } }
`;

export const GIVE_ACTIVITY_STICKERS = gql`
  mutation GiveActivityStickers($issueIds: [String!]!) { giveActivityStickers(issueIds: $issueIds) }
`;
