/**
 * Storybook shelf (SB-1, D-#980/#981/#986, docs/prd-storybook-reading.md) — the series
 * catalogue guardians browse and Office manages. The PDF upload is REST
 * (lib/files.ts pickAndUploadStorybooks); everything else is here.
 */
import { gql } from "urql";

export interface StorySeriesCardT {
  id: string;
  code: string;
  nameBn: string;
  nameEn: string | null;
  ageBandCode: string;
  ageBandLabel: string;
  tagIds: string[];
  tagNamesBn: string[];
  aboutBn: string | null;
  learnPointsBn: string[];
  coverFileId: string | null;
  sortOrder: number;
  /** DRAFT | PUBLISHED | HIDDEN */
  status: string;
  bookCount: number;
  availableBooks: number;
  draftBooks: number;
  copyCount: number;
}

export interface StoryBookCardT {
  id: string;
  titleBn: string;
  titleEn: string | null;
  seriesId: string | null;
  seriesNo: number | null;
  tagIds: string[];
  tagNamesBn: string[];
  learnedPointsBn: string[];
  parentTipBn: string | null;
  coverFileId: string | null;
  previewFileIds: string[];
  draft: boolean;
  active: boolean;
  totalCopies: number;
  availableCopies: number;
  nextDueDate: string | null;
  waitingCount: number;
  childReadCount: number | null;
  childHasNow: boolean;
  /** SB-3: QUEUED | READY | null — the viewing child's wait on this book. */
  childWaitStatus: string | null;
  /** 0 = held for the child now; else the place in line. */
  childWaitPosition: number | null;
  childHoldUntil: string | null;
}

export interface StoryTagT {
  id: string;
  nameBn: string;
  nameEn: string | null;
  active: boolean;
}

export interface StoryAgeBandT {
  code: string;
  labelBn: string;
  ageMin: number;
  ageMax: number;
  classLevels: number[];
  sortOrder: number;
  active: boolean;
  isDefault: boolean;
}

const SERIES_FIELDS = `id code nameBn nameEn ageBandCode ageBandLabel tagIds tagNamesBn aboutBn learnPointsBn coverFileId sortOrder status bookCount availableBooks draftBooks copyCount`;
const BOOK_FIELDS = `id titleBn titleEn seriesId seriesNo tagIds tagNamesBn learnedPointsBn parentTipBn coverFileId previewFileIds draft active totalCopies availableCopies nextDueDate waitingCount childReadCount childHasNow childWaitStatus childWaitPosition childHoldUntil`;
const TAG_FIELDS = `id nameBn nameEn active`;
const BAND_FIELDS = `code labelBn ageMin ageMax classLevels sortOrder active isDefault`;

export const STORY_SHELF_QUERY = gql<{ storyShelf: StorySeriesCardT[] }, { studentId?: string | null }>`
  query StoryShelf($studentId: String) {
    storyShelf(studentId: $studentId) { ${SERIES_FIELDS} }
  }
`;

export const STORY_SERIES_QUERY = gql<
  { storySeries: { series: StorySeriesCardT; books: StoryBookCardT[] } },
  { seriesId: string; studentId?: string | null }
>`
  query StorySeries($seriesId: String!, $studentId: String) {
    storySeries(seriesId: $seriesId, studentId: $studentId) {
      series { ${SERIES_FIELDS} }
      books { ${BOOK_FIELDS} }
    }
  }
`;

export const STORY_BOOK_QUERY = gql<
  { storyBook: { book: StoryBookCardT; seriesNameBn: string; seriesCode: string } },
  { titleId: string; studentId?: string | null }
>`
  query StoryBook($titleId: String!, $studentId: String) {
    storyBook(titleId: $titleId, studentId: $studentId) {
      book { ${BOOK_FIELDS} }
      seriesNameBn
      seriesCode
    }
  }
`;

export const STORYBOOK_IMAGE_QUERY = gql<{ storybookImage: string }, { fileId: string }>`
  query StorybookImage($fileId: String!) {
    storybookImage(fileId: $fileId)
  }
`;

export const STORY_TAGS_QUERY = gql<{ storyTags: StoryTagT[] }, { includeInactive?: boolean | null }>`
  query StoryTags($includeInactive: Boolean) {
    storyTags(includeInactive: $includeInactive) { ${TAG_FIELDS} }
  }
`;

export const STORY_AGE_BANDS_QUERY = gql<{ storyAgeBands: StoryAgeBandT[] }>`
  query StoryAgeBands {
    storyAgeBands { ${BAND_FIELDS} }
  }
`;

export const SAVE_STORY_AGE_BAND = gql<
  { saveStoryAgeBand: StoryAgeBandT },
  { code: string; labelBn: string; ageMin: number; ageMax: number; classLevels: number[]; active?: boolean | null }
>`
  mutation SaveStoryAgeBand($code: String!, $labelBn: String!, $ageMin: Int!, $ageMax: Int!, $classLevels: [Int!]!, $active: Boolean) {
    saveStoryAgeBand(code: $code, labelBn: $labelBn, ageMin: $ageMin, ageMax: $ageMax, classLevels: $classLevels, active: $active) { ${BAND_FIELDS} }
  }
`;

export const CREATE_STORY_TAG = gql<{ createStoryTag: StoryTagT }, { nameBn: string; nameEn?: string | null }>`
  mutation CreateStoryTag($nameBn: String!, $nameEn: String) {
    createStoryTag(nameBn: $nameBn, nameEn: $nameEn) { ${TAG_FIELDS} }
  }
`;

export const UPDATE_STORY_TAG = gql<
  { updateStoryTag: StoryTagT },
  { tagId: string; nameBn?: string | null; nameEn?: string | null; active?: boolean | null }
>`
  mutation UpdateStoryTag($tagId: String!, $nameBn: String, $nameEn: String, $active: Boolean) {
    updateStoryTag(tagId: $tagId, nameBn: $nameBn, nameEn: $nameEn, active: $active) { ${TAG_FIELDS} }
  }
`;

export const MERGE_STORY_TAGS = gql<{ mergeStoryTags: StoryTagT }, { fromTagId: string; intoTagId: string }>`
  mutation MergeStoryTags($fromTagId: String!, $intoTagId: String!) {
    mergeStoryTags(fromTagId: $fromTagId, intoTagId: $intoTagId) { ${TAG_FIELDS} }
  }
`;

export const BULK_TAG_STORY_BOOKS = gql<
  { bulkTagStoryBooks: number },
  { titleIds: string[]; addTagIds?: string[] | null; removeTagIds?: string[] | null }
>`
  mutation BulkTagStoryBooks($titleIds: [String!]!, $addTagIds: [String!], $removeTagIds: [String!]) {
    bulkTagStoryBooks(titleIds: $titleIds, addTagIds: $addTagIds, removeTagIds: $removeTagIds)
  }
`;

export interface SeriesInputT {
  nameBn?: string | null;
  nameEn?: string | null;
  ageBandCode?: string | null;
  tagIds?: string[] | null;
  aboutBn?: string | null;
  learnPointsBn?: string[] | null;
  sortOrder?: number | null;
}

export const CREATE_STORY_SERIES = gql<
  { createStorySeries: StorySeriesCardT },
  SeriesInputT & { code: string; nameBn: string; ageBandCode: string }
>`
  mutation CreateStorySeries($code: String!, $nameBn: String!, $nameEn: String, $ageBandCode: String!, $tagIds: [String!], $aboutBn: String, $learnPointsBn: [String!], $sortOrder: Int) {
    createStorySeries(code: $code, nameBn: $nameBn, nameEn: $nameEn, ageBandCode: $ageBandCode, tagIds: $tagIds, aboutBn: $aboutBn, learnPointsBn: $learnPointsBn, sortOrder: $sortOrder) { ${SERIES_FIELDS} }
  }
`;

export const UPDATE_STORY_SERIES = gql<
  { updateStorySeries: StorySeriesCardT },
  SeriesInputT & { seriesId: string; status?: string | null }
>`
  mutation UpdateStorySeries($seriesId: String!, $status: String, $nameBn: String, $nameEn: String, $ageBandCode: String, $tagIds: [String!], $aboutBn: String, $learnPointsBn: [String!], $sortOrder: Int) {
    updateStorySeries(seriesId: $seriesId, status: $status, nameBn: $nameBn, nameEn: $nameEn, ageBandCode: $ageBandCode, tagIds: $tagIds, aboutBn: $aboutBn, learnPointsBn: $learnPointsBn, sortOrder: $sortOrder) { ${SERIES_FIELDS} }
  }
`;

export const UPDATE_STORY_BOOK = gql<
  { updateStoryBook: StoryBookCardT },
  {
    titleId: string;
    titleBn?: string | null;
    titleEn?: string | null;
    seriesNo?: number | null;
    tagIds?: string[] | null;
    learnedPointsBn?: string[] | null;
    parentTipBn?: string | null;
  }
>`
  mutation UpdateStoryBook($titleId: String!, $titleBn: String, $titleEn: String, $seriesNo: Int, $tagIds: [String!], $learnedPointsBn: [String!], $parentTipBn: String) {
    updateStoryBook(titleId: $titleId, titleBn: $titleBn, titleEn: $titleEn, seriesNo: $seriesNo, tagIds: $tagIds, learnedPointsBn: $learnedPointsBn, parentTipBn: $parentTipBn) { ${BOOK_FIELDS} }
  }
`;

export const SET_STORY_BOOK_PUBLISHED = gql<{ setStoryBookPublished: StoryBookCardT }, { titleId: string; published: boolean }>`
  mutation SetStoryBookPublished($titleId: String!, $published: Boolean!) {
    setStoryBookPublished(titleId: $titleId, published: $published) { ${BOOK_FIELDS} }
  }
`;

// ---------------------------------------------------------------------------
// SB-2 — the desk (D-#982/#983/#985): codes, children, issue / return, copies, holiday rules.
// The sticker PDF is REST (lib/pdf.ts openPdf → /files/storybook-stickers).
// ---------------------------------------------------------------------------

export interface StoryDeskStudentT {
  id: string;
  name: string;
  schoolId: string;
  rollNumber: string | null;
  classLabelBn: string;
  sectionNameBn: string | null;
  activeLoans: number;
  maxLoans: number;
  overdue: boolean;
}

export interface StoryCopyLookupT {
  copyId: string;
  code: string;
  /** AVAILABLE | ON_LOAN | ON_HOLD | LOST | DAMAGED | WITHDRAWN */
  status: string;
  titleId: string;
  titleBn: string;
  titleEn: string | null;
  seriesNo: number | null;
  coverFileId: string | null;
  seriesNameBn: string | null;
  loanId: string | null;
  issuedAt: string | null;
  dueDate: string | null;
  borrower: StoryDeskStudentT | null;
  heldFor: StoryDeskStudentT | null;
  waitingCount: number;
}

export interface LibraryHolidayRuleT {
  id: string;
  nameBn: string;
  fromDay: string;
  toDay: string;
  dueDay: string;
  maxConcurrent: number;
  active: boolean;
}

const DESK_STUDENT_FIELDS = `id name schoolId rollNumber classLabelBn sectionNameBn activeLoans maxLoans overdue`;
const HOLIDAY_FIELDS = `id nameBn fromDay toDay dueDay maxConcurrent active`;

export const STORY_COPY_BY_CODE = gql<{ storyCopyByCode: StoryCopyLookupT }, { code: string }>`
  query StoryCopyByCode($code: String!) {
    storyCopyByCode(code: $code) {
      copyId code status titleId titleBn titleEn seriesNo coverFileId seriesNameBn loanId issuedAt dueDate waitingCount
      borrower { ${DESK_STUDENT_FIELDS} }
      heldFor { ${DESK_STUDENT_FIELDS} }
    }
  }
`;

export const STORY_DESK_STUDENTS = gql<{ storyDeskStudents: StoryDeskStudentT[] }, { search: string }>`
  query StoryDeskStudents($search: String!) {
    storyDeskStudents(search: $search) { ${DESK_STUDENT_FIELDS} }
  }
`;

export const STORY_DESK_TODAY = gql<{ storyDeskToday: StoryDeskStudentT[] }>`
  query StoryDeskToday {
    storyDeskToday { ${DESK_STUDENT_FIELDS} }
  }
`;

export const STORY_ISSUE = gql<{ issueBook: { id: string; dueDate: string } }, { accessionNo: string; borrowerId: string }>`
  mutation StoryIssue($accessionNo: String!, $borrowerId: String!) {
    issueBook(accessionNo: $accessionNo, borrowerType: "STUDENT", borrowerId: $borrowerId) { id dueDate }
  }
`;

export const STORY_RETURN = gql<{ returnBook: { id: string } }, { loanId: string; read: boolean; sticker: boolean }>`
  mutation StoryReturn($loanId: String!, $read: Boolean, $sticker: Boolean) {
    returnBook(loanId: $loanId, read: $read, sticker: $sticker) { id }
  }
`;

export const ADD_STORY_COPIES = gql<{ addStoryCopies: string[] }, { seriesId: string; copiesEach: number; seriesNos?: number[] | null }>`
  mutation AddStoryCopies($seriesId: String!, $copiesEach: Int!, $seriesNos: [Int!]) {
    addStoryCopies(seriesId: $seriesId, copiesEach: $copiesEach, seriesNos: $seriesNos)
  }
`;

export const LIBRARY_HOLIDAY_RULES = gql<{ libraryHolidayRules: LibraryHolidayRuleT[] }, { includeInactive?: boolean | null }>`
  query LibraryHolidayRules($includeInactive: Boolean) {
    libraryHolidayRules(includeInactive: $includeInactive) { ${HOLIDAY_FIELDS} }
  }
`;

export const SAVE_LIBRARY_HOLIDAY_RULE = gql<
  { saveLibraryHolidayRule: LibraryHolidayRuleT },
  { ruleId?: string | null; nameBn: string; fromDay: string; toDay: string; dueDay: string; maxConcurrent: number; active?: boolean | null }
>`
  mutation SaveLibraryHolidayRule($ruleId: String, $nameBn: String!, $fromDay: String!, $toDay: String!, $dueDay: String!, $maxConcurrent: Int!, $active: Boolean) {
    saveLibraryHolidayRule(ruleId: $ruleId, nameBn: $nameBn, fromDay: $fromDay, toDay: $toDay, dueDay: $dueDay, maxConcurrent: $maxConcurrent, active: $active) { ${HOLIDAY_FIELDS} }
  }
`;

// ---------------------------------------------------------------------------
// SB-3 — the waitlist (D-#982/#990): join / leave, the child's waits, a book's queue.
// ---------------------------------------------------------------------------

export interface StoryChildWaitT {
  titleId: string;
  titleBn: string;
  seriesNo: number | null;
  seriesNameBn: string | null;
  coverFileId: string | null;
  /** QUEUED | READY */
  status: string;
  /** 0 = held at the office now. */
  position: number;
  holdUntil: string | null;
}

export interface StoryQueueRowT {
  studentId: string;
  name: string;
  classLabelBn: string;
  status: string;
  position: number;
  holdUntil: string | null;
}

export const JOIN_STORY_WAITLIST = gql<{ joinStoryWaitlist: boolean }, { studentId: string; titleId: string }>`
  mutation JoinStoryWaitlist($studentId: String!, $titleId: String!) {
    joinStoryWaitlist(studentId: $studentId, titleId: $titleId)
  }
`;

export const LEAVE_STORY_WAITLIST = gql<{ leaveStoryWaitlist: boolean }, { studentId: string; titleId: string }>`
  mutation LeaveStoryWaitlist($studentId: String!, $titleId: String!) {
    leaveStoryWaitlist(studentId: $studentId, titleId: $titleId)
  }
`;

export const CHILD_STORY_WAITS = gql<{ childStoryWaits: StoryChildWaitT[] }, { studentId: string }>`
  query ChildStoryWaits($studentId: String!) {
    childStoryWaits(studentId: $studentId) { titleId titleBn seriesNo seriesNameBn coverFileId status position holdUntil }
  }
`;

export const STORY_TITLE_QUEUE = gql<{ storyTitleQueue: StoryQueueRowT[] }, { titleId: string }>`
  query StoryTitleQueue($titleId: String!) {
    storyTitleQueue(titleId: $titleId) { studentId name classLabelBn status position holdUntil }
  }
`;
