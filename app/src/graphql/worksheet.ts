/**
 * Worksheet generator operations (D-#744–#747) — Nursery/KG assignments, class tests
 * and finals generated from the published মানবন্টন, with pictures from the school's
 * own books. The paper itself arrives as `docJson` and is drawn natively
 * (components/WorksheetPaper) so the preview works on a phone, not only on web.
 */
import { gql } from "urql";

export interface WorksheetPresetRowT {
  seq: number;
  count: number;
  /** This paper only: per part, where it starts and ends ("" = automatic). */
  ranges?: Array<{ from: string; to: string }> | null;
}

export interface WorksheetPlanRowT {
  seq: number;
  label: string;
  itemType: string | null;
  count: number;
  marksEach: number;
  total: number;
  kind: string;
  axis: string | null;
  setSize: number | null;
  source: string;
  changed: boolean;
}

export interface WorksheetPlanT {
  classId: string;
  classLevel: number;
  classLabel: string;
  subject: string;
  examId: string | null;
  examName: string | null;
  finalTotal: number;
  rows: WorksheetPlanRowT[];
  assignmentPreset: WorksheetPresetRowT[];
  classTestPreset: WorksheetPresetRowT[];
  assignmentPresetSaved: boolean;
  classTestPresetSaved: boolean;
}

const PLAN_FIELDS = `
  classId classLevel classLabel subject examId examName finalTotal
  rows { seq label itemType count marksEach total kind axis setSize source changed }
  assignmentPreset { seq count }
  classTestPreset { seq count }
  assignmentPresetSaved classTestPresetSaved
`;

export const WORKSHEET_PLAN = gql<{ worksheetPlan: WorksheetPlanT }, { classId: string; subject: string }>`
  query WorksheetPlan($classId: String!, $subject: String!) {
    worksheetPlan(classId: $classId, subject: $subject) { ${PLAN_FIELDS} }
  }
`;

export interface WorksheetHeaderT {
  english: boolean;
  school: string;
  title: string;
  subtitle: string | null;
  classLine: string;
  meta: string | null;
  fullMarks: string;
  nameLabel: string;
  idLabel: string;
}

export interface WorksheetPreviewT {
  docJson: string;
  total: number;
  warnings: string[];
  header: WorksheetHeaderT;
  pictures: Array<{ id: string; dataUri: string }>;
  rows: Array<{ seq: number; count: number; marksEach: number; label: string; kind: string }>;
}

export interface WorksheetGenerateVars {
  classId: string;
  subject: string;
  kind: string;
  seed: number;
  rows?: WorksheetPresetRowT[] | null;
  letterUpTo?: number | null;
  numberUpTo?: number | null;
  /** The letters actually taught (checkboxes); null = the whole alphabet. */
  letters?: string[] | null;
  title?: string | null;
  subtitle?: string | null;
  meta?: string | null;
}

export const WORKSHEET_PREVIEW = gql<{ worksheetPreview: WorksheetPreviewT }, WorksheetGenerateVars>`
  query WorksheetPreview(
    $classId: String!
    $subject: String!
    $kind: String!
    $seed: Int!
    $rows: [WorksheetPresetRowInput!]
    $letterUpTo: Int
    $numberUpTo: Int
    $letters: [String!]
    $title: String
    $subtitle: String
    $meta: String
  ) {
    worksheetPreview(
      classId: $classId
      subject: $subject
      kind: $kind
      seed: $seed
      rows: $rows
      letterUpTo: $letterUpTo
      numberUpTo: $numberUpTo
      letters: $letters
      title: $title
      subtitle: $subtitle
      meta: $meta
    ) {
      docJson
      total
      warnings
      header { english school title subtitle classLine meta fullMarks nameLabel idLabel }
      pictures { id dataUri }
      rows { seq count marksEach label kind }
    }
  }
`;

export const SEND_WORKSHEET_TO_PRINT = gql<
  { sendWorksheetToPrint: { worksheetId: string; printRequestId: string; title: string; totalMarks: number } },
  WorksheetGenerateVars & {
    colour: string;
    sides: string;
    copies: number;
    copiesMode?: string | null;
    copiesClassId?: string | null;
    sectionId?: string | null;
    neededByKey: string;
    forTeacherId?: string | null;
  }
>`
  mutation SendWorksheetToPrint(
    $classId: String!
    $subject: String!
    $kind: String!
    $seed: Int!
    $rows: [WorksheetPresetRowInput!]
    $letterUpTo: Int
    $numberUpTo: Int
    $letters: [String!]
    $title: String
    $subtitle: String
    $meta: String
    $colour: String!
    $sides: String!
    $copies: Int!
    $copiesMode: String
    $copiesClassId: String
    $sectionId: String
    $neededByKey: String!
    $forTeacherId: String
  ) {
    sendWorksheetToPrint(
      classId: $classId
      subject: $subject
      kind: $kind
      seed: $seed
      rows: $rows
      letterUpTo: $letterUpTo
      numberUpTo: $numberUpTo
      letters: $letters
      title: $title
      subtitle: $subtitle
      meta: $meta
      colour: $colour
      sides: $sides
      copies: $copies
      copiesMode: $copiesMode
      copiesClassId: $copiesClassId
      sectionId: $sectionId
      neededByKey: $neededByKey
      forTeacherId: $forTeacherId
    ) {
      worksheetId
      printRequestId
      title
      totalMarks
    }
  }
`;

export const SAVE_WORKSHEET_PLAN = gql<
  { saveWorksheetPlan: WorksheetPlanT },
  {
    classId: string;
    subject: string;
    rows: Array<{ seq: number; kind: string; axis?: string | null; setSize?: number | null }>;
    assignmentPreset?: WorksheetPresetRowT[] | null;
    classTestPreset?: WorksheetPresetRowT[] | null;
  }
>`
  mutation SaveWorksheetPlan(
    $classId: String!
    $subject: String!
    $rows: [WorksheetPlanRowInput!]!
    $assignmentPreset: [WorksheetPresetRowInput!]
    $classTestPreset: [WorksheetPresetRowInput!]
  ) {
    saveWorksheetPlan(
      classId: $classId
      subject: $subject
      rows: $rows
      assignmentPreset: $assignmentPreset
      classTestPreset: $classTestPreset
    ) { ${PLAN_FIELDS} }
  }
`;

export interface WorksheetListRowT {
  id: string;
  title: string;
  kind: string;
  subject: string;
  classLevel: number;
  totalMarks: number;
  createdAt: string;
  printRequestId: string | null;
}

export const MY_WORKSHEETS = gql<{ myWorksheets: WorksheetListRowT[] }, { limit?: number | null }>`
  query MyWorksheets($limit: Int) {
    myWorksheets(limit: $limit) { id title kind subject classLevel totalMarks createdAt printRequestId }
  }
`;

/** D-#761: the same list, PAGED — `myWorksheets` stops at its newest N. */
export const MY_WORKSHEETS_PAGE = gql<
  { myWorksheetsPage: { rows: WorksheetListRowT[]; total: number; page: number; pageSize: number } },
  { page?: number | null; pageSize?: number | null }
>`
  query MyWorksheetsPage($page: Int, $pageSize: Int) {
    myWorksheetsPage(page: $page, pageSize: $pageSize) {
      total page pageSize
      rows { id title kind subject classLevel totalMarks createdAt printRequestId }
    }
  }
`;

export const WORKSHEET_TEACHERS = gql<
  { worksheetTeachers: Array<{ userId: string; name: string }> },
  { classId: string; subject: string }
>`
  query WorksheetTeachers($classId: String!, $subject: String!) {
    worksheetTeachers(classId: $classId, subject: $subject) { userId name }
  }
`;

export interface WorksheetPictureT {
  id: string;
  book: string;
  page: number;
  word: string | null;
  wordEn: string | null;
  letter: string | null;
  pageLetter: string | null;
  uses: string[];
  reserveForFinal: boolean;
  active: boolean;
  useCount: number;
  lastUsedAt: string | null;
  thumbUri: string;
}

const PICTURE_FIELDS = "id book page word wordEn letter pageLetter uses reserveForFinal active useCount lastUsedAt thumbUri";

export const WORKSHEET_PICTURES = gql<
  {
    worksheetPictures: {
      rows: WorksheetPictureT[];
      total: number;
      counts: Array<{ book: string; total: number; untagged: number }>;
    };
  },
  {
    book?: string | null;
    untagged?: boolean | null;
    search?: string | null;
    includeHidden?: boolean | null;
    offset?: number | null;
    limit?: number | null;
  }
>`
  query WorksheetPictures(
    $book: String
    $untagged: Boolean
    $search: String
    $includeHidden: Boolean
    $offset: Int
    $limit: Int
  ) {
    worksheetPictures(
      book: $book
      untagged: $untagged
      search: $search
      includeHidden: $includeHidden
      offset: $offset
      limit: $limit
    ) {
      rows { ${PICTURE_FIELDS} }
      total
      counts { book total untagged }
    }
  }
`;

export const UPDATE_WORKSHEET_PICTURE = gql<
  { updateWorksheetPicture: WorksheetPictureT },
  {
    id: string;
    word?: string | null;
    wordEn?: string | null;
    letter?: string | null;
    pageLetter?: string | null;
    uses?: string[] | null;
    reserveForFinal?: boolean | null;
    active?: boolean | null;
  }
>`
  mutation UpdateWorksheetPicture(
    $id: String!
    $word: String
    $wordEn: String
    $letter: String
    $pageLetter: String
    $uses: [String!]
    $reserveForFinal: Boolean
    $active: Boolean
  ) {
    updateWorksheetPicture(
      id: $id
      word: $word
      wordEn: $wordEn
      letter: $letter
      pageLetter: $pageLetter
      uses: $uses
      reserveForFinal: $reserveForFinal
      active: $active
    ) { ${PICTURE_FIELDS} }
  }
`;
