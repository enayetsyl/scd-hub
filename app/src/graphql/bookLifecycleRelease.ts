/**
 * Book lifecycle, BL-2 (docs/prd-book-lifecycle.md §8 S6/S8/S9): print releases, errata, আমার বই, ভুল জানান.
 * Release files and report photos upload over REST (lib/bookLcFiles.ts).
 */
import { gql } from "urql";

export interface BlReleaseT {
  id: string;
  bookId: string;
  releaseNo: number;
  labelBn: string;
  status: string;
  versionId: string;
  versionLabel: string;
  recordedAt: string | null;
  pressNameBn: string | null;
  sentToPressAt: string | null;
  printedAt: string | null;
  copies: number | null;
  distributedAt: string | null;
  classBookId: string | null;
  files: { edition: string; kind: string; fileId: string }[];
}
const RELEASE = `id bookId releaseNo labelBn status versionId versionLabel recordedAt pressNameBn sentToPressAt printedAt copies distributedAt classBookId files { edition kind fileId }`;

export interface BlErratumT {
  id: string;
  code: string;
  status: string;
  releaseId: string;
  editions: string[];
  page: string | null;
  whereBn: string;
  wrongText: string;
  correctText: string;
  instructionBn: string;
  announcedAt: string | null;
  carried: boolean;
  ackCount: number;
  readerCount: number;
  ackNames: string[];
  acked: boolean;
}
const ERRATUM = `id code status releaseId editions page whereBn wrongText correctText instructionBn announcedAt carried ackCount readerCount ackNames acked`;

export interface BlMyBookT {
  bookId: string;
  code: string;
  titleBn: string;
  classLevel: number;
  subject: string;
  releaseLabelBn: string;
  versionLabel: string;
  teacherFileIds: string[];
  errata: BlErratumT[];
}
export interface BlMyReportT {
  code: string;
  bookId: string;
  status: string;
  category: string;
  textBn: string;
  page: string | null;
  rejectReasonBn: string | null;
  appliedInVersionId: string | null;
  createdAt: string;
}
const MY_REPORT = `code bookId status category textBn page rejectReasonBn appliedInVersionId createdAt`;
type Page<T> = { rows: T[]; total: number; page: number; pageSize: number };

export const BL_RELEASES = gql<{ bookLcReleasesPage: Page<BlReleaseT> }, { bookId: string; page?: number | null; pageSize?: number | null }>`
  query BookLcReleases($bookId: String!, $page: Int, $pageSize: Int) { bookLcReleasesPage(bookId: $bookId, page: $page, pageSize: $pageSize) { rows { ${RELEASE} } total page pageSize } }
`;
export const BL_ERRATA = gql<{ bookLcErrataPage: Page<BlErratumT> }, { bookId: string; releaseId?: string | null; page?: number | null; pageSize?: number | null }>`
  query BookLcErrata($bookId: String!, $releaseId: String, $page: Int, $pageSize: Int) {
    bookLcErrataPage(bookId: $bookId, releaseId: $releaseId, page: $page, pageSize: $pageSize) { rows { ${ERRATUM} } total page pageSize }
  }
`;
export const BL_MY_BOOKS = gql<{ myBookLcBooks: BlMyBookT[] }>`
  query MyBookLcBooks { myBookLcBooks { bookId code titleBn classLevel subject releaseLabelBn versionLabel teacherFileIds errata { ${ERRATUM} } } }
`;
export const BL_MY_REPORTS = gql<{ myBookLcReports: BlMyReportT[] }>`
  query MyBookLcReports { myBookLcReports { ${MY_REPORT} } }
`;
export const BL_CREATE_RELEASE = gql<{ createBookLcRelease: BlReleaseT }, { versionId: string; labelBn: string; pressNameBn?: string | null }>`
  mutation CreateBookLcRelease($versionId: String!, $labelBn: String!, $pressNameBn: String) { createBookLcRelease(versionId: $versionId, labelBn: $labelBn, pressNameBn: $pressNameBn) { ${RELEASE} } }
`;
export const BL_RECORD_RELEASE = gql<{ recordBookLcRelease: BlReleaseT }, { id: string }>`
  mutation RecordBookLcRelease($id: String!) { recordBookLcRelease(id: $id) { ${RELEASE} } }
`;
export const BL_RELEASE_STATUS = gql<{ setBookLcReleaseStatus: BlReleaseT }, { id: string; status: string; at?: string | null; pressNameBn?: string | null; copies?: number | null }>`
  mutation SetBookLcReleaseStatus($id: String!, $status: String!, $at: String, $pressNameBn: String, $copies: Int) {
    setBookLcReleaseStatus(id: $id, status: $status, at: $at, pressNameBn: $pressNameBn, copies: $copies) { ${RELEASE} }
  }
`;
export const BL_NOTIFY_RELEASE = gql<{ notifyBookLcRelease: BlReleaseT }, { id: string }>`
  mutation NotifyBookLcRelease($id: String!) { notifyBookLcRelease(id: $id) { ${RELEASE} } }
`;
export const BL_PUBLISH_CLASSBOOKS = gql<{ publishBookLcToClassBooks: BlReleaseT }, { id: string }>`
  mutation PublishBookLcToClassBooks($id: String!) { publishBookLcToClassBooks(id: $id) { ${RELEASE} } }
`;
export const BL_CLASSBOOKS_SWITCH = gql<{ setBookLcClassBooksSwitch: boolean }, { bookId: string; on: boolean }>`
  mutation SetBookLcClassBooksSwitch($bookId: String!, $on: Boolean!) { setBookLcClassBooksSwitch(bookId: $bookId, on: $on) }
`;
export const BL_UPDATE_ERRATUM = gql<
  { updateBookLcErratum: BlErratumT },
  { id: string; page?: string | null; editions?: string[] | null; whereBn?: string | null; wrongText?: string | null; correctText?: string | null; instructionBn?: string | null }
>`
  mutation UpdateBookLcErratum($id: String!, $page: String, $editions: [String!], $whereBn: String, $wrongText: String, $correctText: String, $instructionBn: String) {
    updateBookLcErratum(id: $id, page: $page, editions: $editions, whereBn: $whereBn, wrongText: $wrongText, correctText: $correctText, instructionBn: $instructionBn) { ${ERRATUM} }
  }
`;
export const BL_ANNOUNCE_ERRATUM = gql<{ announceBookLcErratum: BlErratumT }, { id: string }>`
  mutation AnnounceBookLcErratum($id: String!) { announceBookLcErratum(id: $id) { ${ERRATUM} } }
`;
export const BL_WITHDRAW_ERRATUM = gql<{ withdrawBookLcErratum: BlErratumT }, { id: string }>`
  mutation WithdrawBookLcErratum($id: String!) { withdrawBookLcErratum(id: $id) { ${ERRATUM} } }
`;
export const BL_ACK_ERRATUM = gql<{ ackBookLcErratum: BlErratumT }, { id: string }>`
  mutation AckBookLcErratum($id: String!) { ackBookLcErratum(id: $id) { ${ERRATUM} } }
`;
export const BL_TEACHER_REPORT = gql<
  { fileBookLcTeacherReport: BlMyReportT },
  { bookId: string; edition?: string | null; page?: string | null; quote?: string | null; textBn: string; category: string; photoFileIds?: string[] | null }
>`
  mutation FileBookLcTeacherReport($bookId: String!, $edition: String, $page: String, $quote: String, $textBn: String!, $category: String!, $photoFileIds: [String!]) {
    fileBookLcTeacherReport(bookId: $bookId, edition: $edition, page: $page, quote: $quote, textBn: $textBn, category: $category, photoFileIds: $photoFileIds) { ${MY_REPORT} }
  }
`;
