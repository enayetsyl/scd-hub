/**
 * Book lifecycle (docs/prd-book-lifecycle.md) — বই, সংস্করণ, কাগজে পর্যালোচনা, মতামত, সিদ্ধান্ত,
 * নিয়ম-সংকলন, খসড়া. Uploads and downloads are REST (lib/bookLcFiles.ts); everything else is here.
 */
import { gql } from "urql";

export interface BlVersionSummaryT {
  id: string;
  label: string;
  labelBn: string;
  status: string;
  statusBn: string;
}
export interface BlBookT {
  id: string;
  code: string;
  classLevel: number;
  subject: string;
  titleBn: string;
  titleEn: string | null;
  editions: string[];
  chapterHeadingLevel: number;
  reviewerName: string | null;
  ruleSetKeys: string[];
  nextMemoNo: number;
  archived: boolean;
  publishStudentToClassBooks: boolean;
  latest: BlVersionSummaryT | null;
  finalVersionId: string | null;
  currentReleaseId: string | null;
  listStatus: string;
  openFeedback: number;
  openRoundId: string | null;
  openRoundMemoNo: number | null;
  openRoundStatus: string | null;
  roundOverdue: boolean;
  historyFiles: { fileId: string; label: string }[];
}
const BOOK = `id code classLevel subject titleBn titleEn editions chapterHeadingLevel reviewerName ruleSetKeys nextMemoNo archived publishStudentToClassBooks
  latest { id label labelBn status statusBn } finalVersionId currentReleaseId listStatus openFeedback openRoundId openRoundMemoNo openRoundStatus roundOverdue
  historyFiles { fileId label }`;

export interface BlFileT {
  role: string;
  edition: string | null;
  format: string;
  fileId: string;
  stale: boolean;
  at: string;
}
export interface BlChangeT {
  chapterKey: string;
  where: string;
  page: string | null;
  beforeExcerpt: string;
  afterExcerpt: string;
  reason: string;
  refs: string[];
  route: string;
  sacred: boolean;
}
export interface BlVersionT {
  id: string;
  bookId: string;
  label: string;
  labelBn: string;
  status: string;
  statusBn: string;
  source: string;
  parentVersionId: string | null;
  changeSummaryBn: string;
  masterHash: string;
  createdAt: string;
  createdByName: string | null;
  reviewSkippedAt: string | null;
  importedAt: string | null;
  selfReviewed: boolean;
  approvalBasis: string | null;
  recordedFromPaperName: string | null;
  recordedFromPaperAt: string | null;
  finalAt: string | null;
  files: BlFileT[];
  chapters: { key: string; title: string; order: number; chars: number; sha: string }[];
  changes: BlChangeT[];
  statusHistory: { status: string; at: string; note: string | null; byName: string | null }[];
}
const CHANGE = `chapterKey where page beforeExcerpt afterExcerpt reason refs route sacred`;
const VERSION = `id bookId label labelBn status statusBn source parentVersionId changeSummaryBn masterHash createdAt createdByName reviewSkippedAt importedAt selfReviewed
  approvalBasis recordedFromPaperName recordedFromPaperAt finalAt
  files { role edition format fileId stale at } chapters { key title order chars sha } changes { ${CHANGE} } statusHistory { status at note byName }`;

export interface BlMarkT {
  targetId: string;
  value: string | null;
  noteBn: string | null;
  scanFileId: string | null;
  scanPage: number | null;
  via: string;
  checkedAt: string | null;
  checkedByName: string | null;
}
export interface BlRoundT {
  id: string;
  bookId: string;
  memoNo: number;
  status: string;
  reviewerName: string;
  selfReviewed: boolean;
  versionId: string;
  versionLabel: string;
  baseLabel: string | null;
  dueBy: string | null;
  overdue: boolean;
  sentOnPaperAt: string | null;
  returnedAt: string | null;
  recordedAt: string | null;
  recordedByName: string | null;
  recordedFromPaper: boolean;
  verdict: string | null;
  reviewerNoteBn: string | null;
  memoMarkdown: string;
  memoFrozen: boolean;
  extraNotesBn: string | null;
  wordingEdits: { code: string; textBn: string }[];
  feedbackIds: string[];
  decisionIds: string[];
  packetScope: string | null;
  memoPdfFileId: string | null;
  bookPdfFileId: string | null;
  pageCount: number | null;
  pageMapSource: string | null;
  pageMap: { chapterKey: string; title: string; startPage: number | null; confirmed: boolean }[];
  scanFileIds: string[];
  itemMarks: BlMarkT[];
  decisionMarks: BlMarkT[];
  uncheckedCount: number;
  history: { status: string; at: string; note: string | null; byName: string | null }[];
}
const MARK = `targetId value noteBn scanFileId scanPage via checkedAt checkedByName`;
const ROUND = `id bookId memoNo status reviewerName selfReviewed versionId versionLabel baseLabel dueBy overdue sentOnPaperAt returnedAt recordedAt recordedByName
  recordedFromPaper verdict reviewerNoteBn memoMarkdown memoFrozen extraNotesBn wordingEdits { code textBn } feedbackIds decisionIds packetScope memoPdfFileId
  bookPdfFileId pageCount pageMapSource pageMap { chapterKey title startPage confirmed } scanFileIds itemMarks { ${MARK} } decisionMarks { ${MARK} } uncheckedCount
  history { status at note byName }`;

export interface BlFeedbackT {
  id: string;
  bookId: string;
  code: string;
  source: string;
  status: string;
  route: string | null;
  category: string;
  textBn: string;
  chapterKey: string | null;
  where: string | null;
  quote: string | null;
  page: string | null;
  edition: string | null;
  reporterName: string | null;
  roundId: string | null;
  scanFileId: string | null;
  scanPage: number | null;
  via: string | null;
  checkedAt: string | null;
  rulingVerdict: string | null;
  rulingNoteBn: string | null;
  rulingFromPaper: boolean;
  rejectReasonBn: string | null;
  duplicateOfCode: string | null;
  appliedInVersionId: string | null;
  attachmentIds: string[];
  createdAt: string;
}
const FEEDBACK = `id bookId code source status route category textBn chapterKey where quote page edition reporterName roundId scanFileId scanPage via checkedAt
  rulingVerdict rulingNoteBn rulingFromPaper rejectReasonBn duplicateOfCode appliedInVersionId attachmentIds createdAt`;

export interface BlDecisionT {
  id: string;
  code: string;
  questionBn: string;
  options: { key: string; textBn: string }[];
  recommendedKey: string | null;
  status: string;
  rulingOptionKey: string | null;
  rulingTextBn: string | null;
  rulingBy: string | null;
  rulingAt: string | null;
  rulingFromPaper: boolean;
  selfRuled: boolean;
}
const DECISION = `id code questionBn options { key textBn } recommendedKey status rulingOptionKey rulingTextBn rulingBy rulingAt rulingFromPaper selfRuled`;

export interface BlRuleSetT {
  id: string;
  key: string;
  titleBn: string;
  version: number;
  status: string;
  bookCodes: string[];
  sha256: string;
  bodyMarkdown: string;
  createdAt: string;
}
export interface BlFindingT {
  code: string;
  level: string;
  messageBn: string;
}
export interface BlDraftT {
  id: string;
  bookId: string;
  status: string;
  source: string;
  baseVersionId: string;
  baseLabel: string;
  newChapters: string[];
  missingChapters: string[];
  rekeyConfirmed: boolean;
  protectedChanged: boolean;
  protectedConfirmed: boolean;
  chapters: {
    key: string;
    title: string;
    status: string;
    mode: string | null;
    newSha: string | null;
    isNew: boolean;
    removed: boolean;
    opsCount: number;
    findings: BlFindingT[];
    unexplained: { index: number; beforeText: string; afterText: string; runHash: string | null; acked: boolean }[];
    notApplied: { code: string; textBn: string }[];
  }[];
  changes: BlChangeT[];
  blocking: BlFindingT[];
  warnings: BlFindingT[];
  acceptedVersionId: string | null;
  createdAt: string;
}
const DRAFT = `id bookId status source baseVersionId baseLabel newChapters missingChapters rekeyConfirmed protectedChanged protectedConfirmed
  chapters { key newSha title status mode isNew removed opsCount findings { code level messageBn } unexplained { index beforeText afterText runHash acked } notApplied { code textBn } }
  changes { ${CHANGE} } blocking { code level messageBn } warnings { code level messageBn } acceptedVersionId createdAt`;

export interface BlDiffChapterT {
  key: string;
  title: string;
  status: string;
  hunks: { aStart: number; aLines: number; bStart: number; bLines: number; words: { op: string; text: string }[] }[];
}
const DIFF = `key title status hunks { aStart aLines bStart bLines words { op text } }`;

type Page<T> = { rows: T[]; total: number; page: number; pageSize: number };
type PageVars = { page?: number | null; pageSize?: number | null };

// ---- queries --------------------------------------------------------------

export const BL_BOOKS = gql<{ bookLcBooksPage: Page<BlBookT> }, PageVars & { classLevel?: number | null; subject?: string | null; status?: string | null; archived?: boolean | null }>`
  query BookLcBooks($classLevel: Int, $subject: String, $status: String, $archived: Boolean, $page: Int, $pageSize: Int) {
    bookLcBooksPage(classLevel: $classLevel, subject: $subject, status: $status, archived: $archived, page: $page, pageSize: $pageSize) { rows { ${BOOK} } total page pageSize }
  }
`;
export const BL_BOOK = gql<{ bookLcBook: BlBookT }, { id: string }>`
  query BookLcBook($id: String!) { bookLcBook(id: $id) { ${BOOK} } }
`;
export const BL_VERSIONS = gql<{ bookLcVersionsPage: Page<BlVersionT> }, PageVars & { bookId: string }>`
  query BookLcVersions($bookId: String!, $page: Int, $pageSize: Int) {
    bookLcVersionsPage(bookId: $bookId, page: $page, pageSize: $pageSize) { rows { ${VERSION} } total page pageSize }
  }
`;
export const BL_VERSION = gql<{ bookLcVersion: BlVersionT }, { id: string }>`
  query BookLcVersion($id: String!) { bookLcVersion(id: $id) { ${VERSION} } }
`;
export const BL_CHAPTER = gql<{ bookLcChapter: { key: string; title: string; text: string } }, { versionId: string; key: string }>`
  query BookLcChapter($versionId: String!, $key: String!) { bookLcChapter(versionId: $versionId, key: $key) { key title text } }
`;
export const BL_DIFF = gql<{ bookLcDiff: BlDiffChapterT[] }, { fromVersionId: string; toVersionId: string; chapterKey?: string | null }>`
  query BookLcDiff($fromVersionId: String!, $toVersionId: String!, $chapterKey: String) {
    bookLcDiff(fromVersionId: $fromVersionId, toVersionId: $toVersionId, chapterKey: $chapterKey) { ${DIFF} }
  }
`;
export const BL_DRAFT_DIFF = gql<{ bookLcDraftDiff: BlDiffChapterT[] }, { draftId: string; chapterKey?: string | null }>`
  query BookLcDraftDiff($draftId: String!, $chapterKey: String) { bookLcDraftDiff(draftId: $draftId, chapterKey: $chapterKey) { ${DIFF} } }
`;
export const BL_ROUNDS = gql<{ bookLcRoundsPage: Page<BlRoundT> }, PageVars & { bookId: string }>`
  query BookLcRounds($bookId: String!, $page: Int, $pageSize: Int) {
    bookLcRoundsPage(bookId: $bookId, page: $page, pageSize: $pageSize) { rows { ${ROUND} } total page pageSize }
  }
`;
export const BL_ROUND = gql<{ bookLcRound: BlRoundT }, { id: string }>`
  query BookLcRound($id: String!) { bookLcRound(id: $id) { ${ROUND} } }
`;
export const BL_FEEDBACK = gql<
  { bookLcFeedbackPage: Page<BlFeedbackT> },
  PageVars & { bookId?: string | null; status?: string | null; source?: string | null; route?: string | null; chapterKey?: string | null; roundId?: string | null }
>`
  query BookLcFeedback($bookId: String, $status: String, $source: String, $route: String, $chapterKey: String, $roundId: String, $page: Int, $pageSize: Int) {
    bookLcFeedbackPage(bookId: $bookId, status: $status, source: $source, route: $route, chapterKey: $chapterKey, roundId: $roundId, page: $page, pageSize: $pageSize) {
      rows { ${FEEDBACK} } total page pageSize
    }
  }
`;
export const BL_DECISIONS = gql<{ bookLcDecisionsPage: Page<BlDecisionT> }, PageVars & { bookId: string; status?: string | null }>`
  query BookLcDecisions($bookId: String!, $status: String, $page: Int, $pageSize: Int) {
    bookLcDecisionsPage(bookId: $bookId, status: $status, page: $page, pageSize: $pageSize) { rows { ${DECISION} } total page pageSize }
  }
`;
export const BL_RULESETS = gql<{ bookLcRuleSetsPage: Page<BlRuleSetT> }, PageVars & { key?: string | null; status?: string | null }>`
  query BookLcRuleSets($key: String, $status: String, $page: Int, $pageSize: Int) {
    bookLcRuleSetsPage(key: $key, status: $status, page: $page, pageSize: $pageSize) { rows { id key titleBn version status bookCodes sha256 bodyMarkdown createdAt } total page pageSize }
  }
`;
export const BL_DRAFTS = gql<{ bookLcDraftsPage: Page<BlDraftT> }, PageVars & { bookId: string }>`
  query BookLcDrafts($bookId: String!, $page: Int, $pageSize: Int) {
    bookLcDraftsPage(bookId: $bookId, page: $page, pageSize: $pageSize) { rows { ${DRAFT} } total page pageSize }
  }
`;
export const BL_DRAFT = gql<{ bookLcDraft: BlDraftT }, { id: string }>`
  query BookLcDraft($id: String!) { bookLcDraft(id: $id) { ${DRAFT} } }
`;
export const BL_EVENTS = gql<{ bookLcEventsPage: Page<{ kind: string; summary: string; at: string; actorName: string | null; origin: string | null }> }, PageVars & { bookId: string }>`
  query BookLcEvents($bookId: String!, $page: Int, $pageSize: Int) {
    bookLcEventsPage(bookId: $bookId, page: $page, pageSize: $pageSize) { rows { kind summary at actorName origin } total page pageSize }
  }
`;

// ---- mutations ------------------------------------------------------------

export const BL_UPDATE_BOOK = gql<{ updateBookLc: BlBookT }, { id: string; titleBn?: string | null; reviewerName?: string | null; editions?: string[] | null; archived?: boolean | null }>`
  mutation UpdateBookLc($id: String!, $titleBn: String, $reviewerName: String, $editions: [String!], $archived: Boolean) {
    updateBookLc(id: $id, titleBn: $titleBn, reviewerName: $reviewerName, editions: $editions, archived: $archived) { ${BOOK} }
  }
`;
export const BL_OPEN_ROUND = gql<{ openBookLcRound: BlRoundT }, { bookId: string; reviewerName?: string | null; selfReview?: boolean | null; dueBy?: string | null }>`
  mutation OpenBookLcRound($bookId: String!, $reviewerName: String, $selfReview: Boolean, $dueBy: String) {
    openBookLcRound(bookId: $bookId, reviewerName: $reviewerName, selfReview: $selfReview, dueBy: $dueBy) { ${ROUND} }
  }
`;
export const BL_UPDATE_ROUND = gql<
  { updateBookLcRound: BlRoundT },
  { id: string; reviewerName?: string | null; dueBy?: string | null; extraNotesBn?: string | null; feedbackIds?: string[] | null; decisionIds?: string[] | null; wordingEdits?: { code: string; textBn: string }[] | null }
>`
  mutation UpdateBookLcRound($id: String!, $reviewerName: String, $dueBy: String, $extraNotesBn: String, $feedbackIds: [String!], $decisionIds: [String!], $wordingEdits: [BookLcWordingInput!]) {
    updateBookLcRound(id: $id, reviewerName: $reviewerName, dueBy: $dueBy, extraNotesBn: $extraNotesBn, feedbackIds: $feedbackIds, decisionIds: $decisionIds, wordingEdits: $wordingEdits) { ${ROUND} }
  }
`;
export const BL_DETECT_PAGES = gql<{ detectBookLcPageMap: BlRoundT }, { roundId: string }>`
  mutation DetectBookLcPageMap($roundId: String!) { detectBookLcPageMap(roundId: $roundId) { ${ROUND} } }
`;
export const BL_SET_PAGES = gql<{ setBookLcPageMap: BlRoundT }, { roundId: string; entries: { chapterKey: string; startPage: number }[] }>`
  mutation SetBookLcPageMap($roundId: String!, $entries: [BookLcPageEntryInput!]!) { setBookLcPageMap(roundId: $roundId, entries: $entries) { ${ROUND} } }
`;
export const BL_MAKE_PACKET = gql<{ makeBookLcPacket: BlRoundT }, { roundId: string; scope: string }>`
  mutation MakeBookLcPacket($roundId: String!, $scope: String!) { makeBookLcPacket(roundId: $roundId, scope: $scope) { ${ROUND} } }
`;
export const BL_MARK_SENT = gql<{ markBookLcRoundSent: BlRoundT }, { roundId: string; sentAt?: string | null; dueBy?: string | null }>`
  mutation MarkBookLcRoundSent($roundId: String!, $sentAt: String, $dueBy: String) { markBookLcRoundSent(roundId: $roundId, sentAt: $sentAt, dueBy: $dueBy) { ${ROUND} } }
`;
export const BL_WITHDRAW = gql<{ withdrawBookLcRound: BlRoundT }, { roundId: string; reasonBn?: string | null }>`
  mutation WithdrawBookLcRound($roundId: String!, $reasonBn: String) { withdrawBookLcRound(roundId: $roundId, reasonBn: $reasonBn) { ${ROUND} } }
`;
export const BL_ITEM_MARKS = gql<
  { setBookLcItemMarks: BlRoundT },
  { roundId: string; marks: { feedbackId: string; verdict: string; noteBn?: string | null; scanFileId?: string | null; scanPage?: number | null }[] }
>`
  mutation SetBookLcItemMarks($roundId: String!, $marks: [BookLcItemMarkInput!]!) { setBookLcItemMarks(roundId: $roundId, marks: $marks) { ${ROUND} } }
`;
export const BL_DECISION_MARKS = gql<
  { setBookLcDecisionMarks: BlRoundT },
  { roundId: string; marks: { decisionId: string; optionKey?: string | null; noteBn?: string | null; scanFileId?: string | null; scanPage?: number | null }[] }
>`
  mutation SetBookLcDecisionMarks($roundId: String!, $marks: [BookLcDecisionMarkInput!]!) { setBookLcDecisionMarks(roundId: $roundId, marks: $marks) { ${ROUND} } }
`;
export const BL_ADD_POINTS = gql<
  { addBookLcReviewerPoints: BlFeedbackT[] },
  { roundId: string; scanFileId?: string | null; items: { chapterKey?: string | null; where?: string | null; page?: string | null; quote?: string | null; category: string; textBn: string; scanPage?: number | null }[] }
>`
  mutation AddBookLcReviewerPoints($roundId: String!, $scanFileId: String, $items: [BookLcReviewerPointInput!]!) {
    addBookLcReviewerPoints(roundId: $roundId, scanFileId: $scanFileId, items: $items) { ${FEEDBACK} }
  }
`;
export const BL_CHECK_ROW = gql<{ checkBookLcRow: BlRoundT }, { roundId: string; kind: string; id: string }>`
  mutation CheckBookLcRow($roundId: String!, $kind: String!, $id: String!) { checkBookLcRow(roundId: $roundId, kind: $kind, id: $id) { ${ROUND} } }
`;
export const BL_RECORD_RETURN = gql<{ recordBookLcReturn: BlRoundT }, { roundId: string; verdict: string; returnedAt?: string | null; reviewerNoteBn?: string | null }>`
  mutation RecordBookLcReturn($roundId: String!, $verdict: String!, $returnedAt: String, $reviewerNoteBn: String) {
    recordBookLcReturn(roundId: $roundId, verdict: $verdict, returnedAt: $returnedAt, reviewerNoteBn: $reviewerNoteBn) { ${ROUND} }
  }
`;
export const BL_FILE_FEEDBACK = gql<
  { fileBookLcFeedback: BlFeedbackT },
  { bookId: string; source: string; input: { chapterKey?: string | null; where?: string | null; quote?: string | null; page?: string | null; category: string; textBn: string } }
>`
  mutation FileBookLcFeedback($bookId: String!, $source: String!, $input: BookLcFeedbackInput!) { fileBookLcFeedback(bookId: $bookId, source: $source, input: $input) { ${FEEDBACK} } }
`;
export const BL_TRIAGE = gql<{ triageBookLcFeedback: BlFeedbackT[] }, { ids: string[]; action: string; reasonBn?: string | null; duplicateOfCode?: string | null }>`
  mutation TriageBookLcFeedback($ids: [String!]!, $action: String!, $reasonBn: String, $duplicateOfCode: String) {
    triageBookLcFeedback(ids: $ids, action: $action, reasonBn: $reasonBn, duplicateOfCode: $duplicateOfCode) { ${FEEDBACK} }
  }
`;
export const BL_OPEN_DECISION = gql<{ openBookLcDecision: BlDecisionT }, { bookId: string; questionBn: string; options: string[]; recommendedIndex?: number | null; fromFeedbackId?: string | null }>`
  mutation OpenBookLcDecision($bookId: String!, $questionBn: String!, $options: [String!]!, $recommendedIndex: Int, $fromFeedbackId: String) {
    openBookLcDecision(bookId: $bookId, questionBn: $questionBn, options: $options, recommendedIndex: $recommendedIndex, fromFeedbackId: $fromFeedbackId) { ${DECISION} }
  }
`;
export const BL_RULE_DECISION = gql<{ ruleBookLcDecision: BlDecisionT }, { decisionId: string; optionKey?: string | null; textBn?: string | null }>`
  mutation RuleBookLcDecision($decisionId: String!, $optionKey: String, $textBn: String) { ruleBookLcDecision(decisionId: $decisionId, optionKey: $optionKey, textBn: $textBn) { ${DECISION} } }
`;
export const BL_UPLOAD_RULESET = gql<{ uploadBookLcRuleSet: BlRuleSetT }, { key: string; titleBn: string; bodyMarkdown: string; bookCodes?: string[] | null }>`
  mutation UploadBookLcRuleSet($key: String!, $titleBn: String!, $bodyMarkdown: String!, $bookCodes: [String!]) {
    uploadBookLcRuleSet(key: $key, titleBn: $titleBn, bodyMarkdown: $bodyMarkdown, bookCodes: $bookCodes) { id key titleBn version status bookCodes sha256 bodyMarkdown createdAt }
  }
`;
export const BL_SET_CHANGES = gql<
  { setBookLcDraftChanges: BlDraftT },
  { draftId: string; rows: { chapterKey: string; where?: string | null; page?: string | null; beforeExcerpt?: string | null; afterExcerpt?: string | null; reason?: string | null; refs: string[] }[] }
>`
  mutation SetBookLcDraftChanges($draftId: String!, $rows: [BookLcChangeRowInput!]!) { setBookLcDraftChanges(draftId: $draftId, rows: $rows) { ${DRAFT} } }
`;
export const BL_CONFIRM_REKEY = gql<{ confirmBookLcRekey: BlDraftT }, { draftId: string }>`
  mutation ConfirmBookLcRekey($draftId: String!) { confirmBookLcRekey(draftId: $draftId) { ${DRAFT} } }
`;
export const BL_CONFIRM_PROTECTED = gql<{ confirmBookLcProtectedChange: BlDraftT }, { draftId: string }>`
  mutation ConfirmBookLcProtectedChange($draftId: String!) { confirmBookLcProtectedChange(draftId: $draftId) { ${DRAFT} } }
`;
export const BL_DECIDE_CHAPTER = gql<{ decideBookLcDraftChapter: BlDraftT }, { draftId: string; chapterKey: string; accept: boolean; expectedNewSha?: string | null }>`
  mutation DecideBookLcDraftChapter($draftId: String!, $chapterKey: String!, $accept: Boolean!, $expectedNewSha: String) {
    decideBookLcDraftChapter(draftId: $draftId, chapterKey: $chapterKey, accept: $accept, expectedNewSha: $expectedNewSha) { ${DRAFT} }
  }
`;
export const BL_ACCEPT_DRAFT = gql<{ acceptBookLcDraft: BlVersionT }, { draftId: string; bump?: string | null; summaryBn: string }>`
  mutation AcceptBookLcDraft($draftId: String!, $bump: String, $summaryBn: String!) { acceptBookLcDraft(draftId: $draftId, bump: $bump, summaryBn: $summaryBn) { ${VERSION} } }
`;
export const BL_REJECT_DRAFT = gql<{ rejectBookLcDraft: BlDraftT }, { draftId: string }>`
  mutation RejectBookLcDraft($draftId: String!) { rejectBookLcDraft(draftId: $draftId) { ${DRAFT} } }
`;
export const BL_DIRECT_FIX = gql<{ approveBookLcDirectFix: BlVersionT }, { versionId: string }>`
  mutation ApproveBookLcDirectFix($versionId: String!) { approveBookLcDirectFix(versionId: $versionId) { ${VERSION} } }
`;
export const BL_MARK_FINAL = gql<{ markBookLcFinal: BlVersionT }, { versionId: string }>`
  mutation MarkBookLcFinal($versionId: String!) { markBookLcFinal(versionId: $versionId) { ${VERSION} } }
`;
