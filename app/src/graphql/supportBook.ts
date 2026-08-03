/**
 * Support-book production (SB-1..SB-6) — the app's read/write surface.
 *
 * Everything here is gated server-side on a `book:*` permission (D-#405/#424). The
 * screens do not re-derive any of it: staleness, gate reasons and validator findings
 * are computed on the server and rendered verbatim, because a second implementation
 * of "is this stale" is exactly how the two drift.
 */
import { gql } from "urql";

export interface SupportBookT {
  bookId: string;
  bookType: string;
  classLevel: number;
  subject: string;
  titleBn: string;
  status: string;
  lessonCount: number;
}

export const SUPPORT_BOOKS = gql`
  query SupportBooks {
    supportBooks { bookId bookType classLevel subject titleBn status lessonCount }
  }
`;

/** One image slot as the illustrator works it. `complianceNote` is deliberately absent
 *  from the server type — stripe language must never reach a prompt (README §5). */
export interface SupportBookSlotT {
  bookId: string;
  lessonNo: number;
  slotId: string;
  sceneDescription: string | null;
  imageClass: string | null;
  action: string | null;
  containsLivingBeing: boolean | null;
  aspect: string | null;
  refs: string[];
  prompt: string | null;
  slotStatus: string | null;
  approved: string;
  cropped: string;
  upscaled: string;
  compliant: string;
  hasStale: boolean;
}

export const SUPPORT_BOOK_SLOTS = gql`
  query SupportBookSlots($bookId: String!, $lessonNo: Int) {
    supportBookSlots(bookId: $bookId, lessonNo: $lessonNo) {
      bookId lessonNo slotId
      sceneDescription imageClass action containsLivingBeing aspect refs prompt slotStatus
      approved cropped upscaled compliant hasStale
    }
  }
`;

export interface SupportBookAssetT {
  assetId: string;
  stage: string;
  fileId: string;
  source: string | null;
  generatorTool: string | null;
  current: boolean;
  uploadedAt: string;
  uploadedBy: string;
}

export const SUPPORT_BOOK_SLOT_HISTORY = gql`
  query SupportBookSlotHistory($bookId: String!, $slotId: String!) {
    supportBookSlotHistory(bookId: $bookId, slotId: $slotId) {
      assetId stage fileId source generatorTool current uploadedAt uploadedBy
    }
  }
`;

export interface StaleArtifactT { slotId: string; lessonNo: number; stage: string }

export const SUPPORT_BOOK_STALENESS = gql`
  query SupportBookStaleness($bookId: String!) {
    supportBookStaleness(bookId: $bookId) {
      blocksAssembly
      stale { slotId lessonNo stage }
    }
  }
`;

// ---------------------------------------------------------------------------
// SB-3: review + escalation
// ---------------------------------------------------------------------------

export interface SupportBookLessonT {
  bookId: string;
  lessonNo: number;
  nctbTitleBn: string | null;
  state: string;
  action: string | null;
  severity: string | null;
  bwTreatment: string | null;
  blockCount: number;
  slotCount: number;
  checklistPassed: boolean;
  selfReviewed: boolean;
}

export const SUPPORT_BOOK_LESSONS = gql`
  query SupportBookLessons($bookId: String!) {
    supportBookLessons(bookId: $bookId) {
      bookId lessonNo nctbTitleBn state action severity bwTreatment
      blockCount slotCount checklistPassed selfReviewed
    }
  }
`;

export interface SupportBookReviewRoundT {
  roundId: string;
  bookId: string;
  lessonNo: number;
  roundNumber: number;
  status: string;
  reviewerId: string;
  verdict: string | null;
  feedback: string | null;
  checklist: string[];
  checklistPassed: boolean;
  selfReviewed: boolean;
  assignedAt: string;
}

export const SUPPORT_BOOK_REVIEW_ROUNDS = gql`
  query SupportBookReviewRounds($bookId: String!, $lessonNo: Int) {
    supportBookReviewRounds(bookId: $bookId, lessonNo: $lessonNo) {
      roundId bookId lessonNo roundNumber status reviewerId
      verdict feedback checklist checklistPassed selfReviewed assignedAt
    }
  }
`;

/** `checklistPassed` goes true ONLY on APPROVE with every item ticked — the server
 *  derives it, so the screen never computes its own version of "passed". */
export const SUBMIT_SUPPORT_BOOK_REVIEW = gql`
  mutation SubmitSupportBookReview(
    $bookId: String!, $lessonNo: Int!, $verdict: String!, $checklist: [String!]!, $feedback: String
  ) {
    submitSupportBookReview(
      bookId: $bookId, lessonNo: $lessonNo, verdict: $verdict, checklist: $checklist, feedback: $feedback
    ) {
      roundId lessonNo roundNumber status verdict feedback checklist checklistPassed selfReviewed
    }
  }
`;

export interface SupportBookEscalationMessageT {
  authorId: string;
  body: string;
  attachments: string[];
  createdAt: string;
}

export interface SupportBookEscalationT {
  escalationId: string;
  bookId: string;
  lessonNo: number;
  target: string;
  targetId: string | null;
  subject: string;
  state: string;
  raisedBy: string;
  resolution: string | null;
  messages: SupportBookEscalationMessageT[];
  createdAt: string;
}

const ESCALATION_FIELDS = `
  escalationId bookId lessonNo target targetId subject state raisedBy resolution createdAt
  messages { authorId body attachments createdAt }
`;

/** Oldest first — the thread waiting longest is the one blocking a lesson. */
export const SUPPORT_BOOK_ESCALATIONS = gql`
  query SupportBookEscalations($bookId: String, $openOnly: Boolean) {
    supportBookEscalations(bookId: $bookId, openOnly: $openOnly) { ${ESCALATION_FIELDS} }
  }
`;

export const RAISE_SUPPORT_BOOK_ESCALATION = gql`
  mutation RaiseSupportBookEscalation(
    $bookId: String!, $lessonNo: Int!, $target: String!, $subject: String!, $body: String!, $targetId: String
  ) {
    raiseSupportBookEscalation(
      bookId: $bookId, lessonNo: $lessonNo, target: $target, subject: $subject, body: $body, targetId: $targetId
    ) { ${ESCALATION_FIELDS} }
  }
`;

export const REPLY_SUPPORT_BOOK_ESCALATION = gql`
  mutation ReplySupportBookEscalation($escalationId: String!, $body: String!) {
    replySupportBookEscalation(escalationId: $escalationId, body: $body) { ${ESCALATION_FIELDS} }
  }
`;

/** Resolving changes NO lesson field — the author then submits a patch citing the
 *  ruling, through the same validator (D-#410). */
export const RESOLVE_SUPPORT_BOOK_ESCALATION = gql`
  mutation ResolveSupportBookEscalation($escalationId: String!, $resolution: String!) {
    resolveSupportBookEscalation(escalationId: $escalationId, resolution: $resolution) { ${ESCALATION_FIELDS} }
  }
`;

// ---------------------------------------------------------------------------
// SB-4: the assembly gate + render jobs
// ---------------------------------------------------------------------------

/** Every blocker at once, not one at a time — being told about the next blocker only
 *  after fixing the last one is the worst version of a gate. */
export interface SupportBookGateT {
  ok: boolean;
  reasons: string[];
}

export const SUPPORT_BOOK_ASSEMBLY_GATE = gql`
  query SupportBookAssemblyGate($bookId: String!, $lessonNos: [Int!]) {
    supportBookAssemblyGate(bookId: $bookId, lessonNos: $lessonNos) { ok reasons }
  }
`;

export interface SupportBookBuildJobT {
  jobId: string;
  bookId: string;
  scope: string;
  lessonNos: number[];
  profiles: string[];
  state: string;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  failureReason: string | null;
  outputFileIds: string[];
  log: string;
}

export const SUPPORT_BOOK_BUILD_JOBS = gql`
  query SupportBookBuildJobs($bookId: String!, $limit: Int) {
    supportBookBuildJobs(bookId: $bookId, limit: $limit) {
      jobId bookId scope lessonNos profiles state
      queuedAt startedAt finishedAt failureReason outputFileIds log
    }
  }
`;

export const QUEUE_SUPPORT_BOOK_BUILD = gql`
  mutation QueueSupportBookBuild($bookId: String!, $scope: String!, $lessonNos: [Int!], $force: Boolean) {
    queueSupportBookBuild(bookId: $bookId, scope: $scope, lessonNos: $lessonNos, force: $force) {
      jobId state scope lessonNos profiles queuedAt failureReason
    }
  }
`;

/** The export escape hatch (D-#406): the app must never become the only way to build
 *  a book. Returns `book.json` as text. */
export const SUPPORT_BOOK_EXPORT_JSON = gql`
  query SupportBookExportJson($bookId: String!, $lessonNos: [Int!]) {
    supportBookExportJson(bookId: $bookId, lessonNos: $lessonNos)
  }
`;

// ---------------------------------------------------------------------------
// SB-1: create a book, submit a patch
// ---------------------------------------------------------------------------

export const CREATE_SUPPORT_BOOK = gql`
  mutation CreateSupportBook(
    $bookId: String!, $bookType: String!, $classLevel: Int!, $subject: String!,
    $titleBn: String!, $mode: String, $hasTextEn: Boolean
  ) {
    createSupportBook(
      bookId: $bookId, bookType: $bookType, classLevel: $classLevel, subject: $subject,
      titleBn: $titleBn, mode: $mode, hasTextEn: $hasTextEn
    ) { bookId bookType classLevel subject titleBn status lessonCount }
  }
`;

/** One validator finding. RED refuses the merge; GREY merges with a warning. */
export interface SupportBookFindingT {
  check: string;
  severity: string;
  message: string;
  lessonNo: number | null;
  blockId: string | null;
  slotId: string | null;
  unit: string | null;
}

/** A RED result is NOT an error — it comes back with its findings for the author to
 *  act on, and the patch is stored either way. The screen renders it as an outcome. */
export interface SupportBookMergeResultT {
  merged: boolean;
  patchId: string;
  redCount: number;
  greyCount: number;
  lessonNos: number[];
  policySetHash: string;
  policyMissing: string[];
  findings: SupportBookFindingT[];
}

export const SUBMIT_SUPPORT_BOOK_PATCH = gql`
  mutation SubmitSupportBookPatch($patchJson: String!, $source: String) {
    submitSupportBookPatch(patchJson: $patchJson, source: $source) {
      merged patchId redCount greyCount lessonNos policySetHash policyMissing
      findings { check severity message lessonNo blockId slotId unit }
    }
  }
`;
