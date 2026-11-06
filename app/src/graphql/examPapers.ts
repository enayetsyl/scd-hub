/**
 * Exam paper bank (D-#1030–#1034, docs/prd-exam-paper-bank.md):
 *  - reference papers — another branch's (Mohammadpur's) past papers, page by page, plus the
 *    original file; the upload is REST (lib/files.ts pickAndUploadReferencePaper);
 *  - draft papers — this branch's drafts, reviewed item by item by the assigned reviewer.
 */
import { gql } from "urql";

// ---------------------------------------------------------------------------
// Reference papers
// ---------------------------------------------------------------------------

export interface ReferencePaperT {
  id: string;
  branch: string;
  /** HALF_YEARLY | ANNUAL */
  term: string;
  year: number;
  classLevel: number | null;
  classLabelBn: string | null;
  subject: string;
  title: string;
  /** PROCESSING | READY | FAILED */
  status: string;
  error: string | null;
  pageCount: number;
  pageAspect: number;
  sourceFileId: string | null;
  sourceName: string;
  createdAt: string;
}

const REF_FIELDS = `id branch term year classLevel classLabelBn subject title status error pageCount pageAspect sourceFileId sourceName createdAt`;

export const REFERENCE_PAPERS_QUERY = gql<
  { referencePapers: ReferencePaperT[] },
  { year?: number | null; term?: string | null; classLevel?: number | null }
>`
  query ReferencePapers($year: Int, $term: String, $classLevel: Int) {
    referencePapers(year: $year, term: $term, classLevel: $classLevel) { ${REF_FIELDS} }
  }
`;

export interface ReferencePaperPageT {
  paperId: string;
  page: number;
  pageCount: number;
  dataUri: string;
}

export const REFERENCE_PAPER_PAGE_QUERY = gql<{ referencePaperPage: ReferencePaperPageT }, { paperId: string; page: number }>`
  query ReferencePaperPage($paperId: String!, $page: Int!) {
    referencePaperPage(paperId: $paperId, page: $page) { paperId page pageCount dataUri }
  }
`;

export const UPDATE_REFERENCE_PAPER = gql<
  { updateReferencePaper: ReferencePaperT },
  {
    id: string;
    term?: string | null;
    year?: number | null;
    classLevel?: number | null;
    clearClass?: boolean | null;
    subject?: string | null;
    title?: string | null;
  }
>`
  mutation UpdateReferencePaper($id: String!, $term: String, $year: Int, $classLevel: Int, $clearClass: Boolean, $subject: String, $title: String) {
    updateReferencePaper(id: $id, term: $term, year: $year, classLevel: $classLevel, clearClass: $clearClass, subject: $subject, title: $title) { ${REF_FIELDS} }
  }
`;

export const DELETE_REFERENCE_PAPER = gql<{ deleteReferencePaper: boolean }, { id: string }>`
  mutation DeleteReferencePaper($id: String!) {
    deleteReferencePaper(id: $id)
  }
`;

// ---------------------------------------------------------------------------
// Draft papers
// ---------------------------------------------------------------------------

export interface ExamPaperSummaryT {
  id: string;
  key: string;
  term: string;
  year: number;
  examNameBn: string;
  classLevel: number;
  classLabelBn: string;
  subject: string;
  titleBn: string;
  fullMarks: number;
  /** DRAFT | IN_REVIEW | REVIEWED | FINAL */
  status: string;
  reviewerUserId: string | null;
  reviewerName: string | null;
  reviewSubmittedAt: string | null;
  updatedAt: string;
  itemCount: number;
  confirmedCount: number;
  openSuggestions: number;
  acceptedSuggestions: number;
  rejectedSuggestions: number;
}

const SUMMARY_FIELDS = `id key term year examNameBn classLevel classLabelBn subject titleBn fullMarks status
  reviewerUserId reviewerName reviewSubmittedAt updatedAt itemCount confirmedCount openSuggestions acceptedSuggestions rejectedSuggestions`;

export interface ExamPaperItemT {
  key: string;
  text: string;
  options: string[];
  answer: string | null;
  marks: number | null;
  /** MP2026 | MP2026_ADAPTED | MP_OTHER | MP_OTHER_ADAPTED | NEW | REVIEWER */
  source: string;
  sourceRef: string | null;
  bookRef: string | null;
  needsPicture: boolean;
  note: string | null;
  removed: boolean;
  syllabusConfirmed: boolean;
  syllabusConfirmedByName: string | null;
  syllabusConfirmedAt: string | null;
  editedCount: number;
}

export interface ExamPaperSectionT {
  seq: number;
  syllabusRowSeq: number[];
  syllabusLabel: string | null;
  /** WRITTEN | ORAL */
  kind: string;
  instructionBn: string;
  count: number | null;
  marksEach: number | null;
  total: number;
  choiceNoteBn: string | null;
  splitMarks: boolean;
  stimulusMd: string | null;
  matchRight: string[];
  activeItemCount: number;
  items: ExamPaperItemT[];
}

export interface ExamPaperSuggestionT {
  id: string;
  /** EDIT | DELETE | ADD */
  kind: string;
  sectionSeq: number;
  itemKey: string | null;
  proposedText: string | null;
  proposedAnswer: string | null;
  proposedOptions: string[];
  reason: string | null;
  /** OPEN | ACCEPTED | REJECTED | WITHDRAWN */
  status: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
  resolvedByName: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdItemKey: string | null;
}

export interface ExamPaperDetailT extends ExamPaperSummaryT {
  durationBn: string | null;
  authorNotes: string | null;
  reviewSummary: string | null;
  viewerIsReviewer: boolean;
  viewerCanManage: boolean;
  sections: ExamPaperSectionT[];
  suggestions: ExamPaperSuggestionT[];
}

const DETAIL_FIELDS = `${SUMMARY_FIELDS} durationBn authorNotes reviewSummary viewerIsReviewer viewerCanManage
  sections { seq syllabusRowSeq syllabusLabel kind instructionBn count marksEach total choiceNoteBn splitMarks stimulusMd matchRight activeItemCount
    items { key text options answer marks source sourceRef bookRef needsPicture note removed syllabusConfirmed syllabusConfirmedByName syllabusConfirmedAt editedCount } }
  suggestions { id kind sectionSeq itemKey proposedText proposedAnswer proposedOptions reason status createdById createdByName createdAt resolvedByName resolvedAt resolutionNote createdItemKey }`;

export const EXAM_PAPER_DRAFTS_QUERY = gql<
  { examPaperDrafts: ExamPaperSummaryT[] },
  { year?: number | null; term?: string | null; classLevel?: number | null; mine?: boolean | null }
>`
  query ExamPaperDrafts($year: Int, $term: String, $classLevel: Int, $mine: Boolean) {
    examPaperDrafts(year: $year, term: $term, classLevel: $classLevel, mine: $mine) { ${SUMMARY_FIELDS} }
  }
`;

export const EXAM_PAPER_DRAFT_QUERY = gql<{ examPaperDraft: ExamPaperDetailT }, { id: string }>`
  query ExamPaperDraft($id: String!) {
    examPaperDraft(id: $id) { ${DETAIL_FIELDS} }
  }
`;

export const EXAM_PAPER_REVIEWER_OPTIONS = gql<{ examPaperReviewerOptions: { id: string; name: string; role: string }[] }>`
  query ExamPaperReviewerOptions {
    examPaperReviewerOptions { id name role }
  }
`;

export const ASSIGN_EXAM_PAPER_REVIEWER = gql<
  { assignExamPaperReviewer: ExamPaperSummaryT[] },
  { paperIds: string[]; reviewerUserId: string }
>`
  mutation AssignExamPaperReviewer($paperIds: [String!]!, $reviewerUserId: String!) {
    assignExamPaperReviewer(paperIds: $paperIds, reviewerUserId: $reviewerUserId) { ${SUMMARY_FIELDS} }
  }
`;

export const IMPORT_EXAM_PAPER_DRAFT = gql<{ importExamPaperDraft: ExamPaperSummaryT }, { json: string }>`
  mutation ImportExamPaperDraft($json: String!) {
    importExamPaperDraft(json: $json) { ${SUMMARY_FIELDS} }
  }
`;

export const SET_EXAM_ITEM_SYLLABUS_MATCH = gql<
  { setExamItemSyllabusMatch: ExamPaperDetailT },
  { paperId: string; itemKey: string; confirmed: boolean }
>`
  mutation SetExamItemSyllabusMatch($paperId: String!, $itemKey: String!, $confirmed: Boolean!) {
    setExamItemSyllabusMatch(paperId: $paperId, itemKey: $itemKey, confirmed: $confirmed) { ${DETAIL_FIELDS} }
  }
`;

export const CONFIRM_EXAM_SECTION_SYLLABUS = gql<{ confirmExamSectionSyllabus: ExamPaperDetailT }, { paperId: string; sectionSeq: number }>`
  mutation ConfirmExamSectionSyllabus($paperId: String!, $sectionSeq: Int!) {
    confirmExamSectionSyllabus(paperId: $paperId, sectionSeq: $sectionSeq) { ${DETAIL_FIELDS} }
  }
`;

export const SUGGEST_EXAM_PAPER_CHANGE = gql<
  { suggestExamPaperChange: ExamPaperDetailT },
  {
    paperId: string;
    kind: string;
    sectionSeq: number;
    itemKey?: string | null;
    proposedText?: string | null;
    proposedAnswer?: string | null;
    proposedOptions?: string[] | null;
    reason?: string | null;
  }
>`
  mutation SuggestExamPaperChange($paperId: String!, $kind: String!, $sectionSeq: Int!, $itemKey: String, $proposedText: String, $proposedAnswer: String, $proposedOptions: [String!], $reason: String) {
    suggestExamPaperChange(paperId: $paperId, kind: $kind, sectionSeq: $sectionSeq, itemKey: $itemKey, proposedText: $proposedText, proposedAnswer: $proposedAnswer, proposedOptions: $proposedOptions, reason: $reason) { ${DETAIL_FIELDS} }
  }
`;

export const WITHDRAW_EXAM_PAPER_SUGGESTION = gql<{ withdrawExamPaperSuggestion: ExamPaperDetailT }, { suggestionId: string }>`
  mutation WithdrawExamPaperSuggestion($suggestionId: String!) {
    withdrawExamPaperSuggestion(suggestionId: $suggestionId) { ${DETAIL_FIELDS} }
  }
`;

export const RESOLVE_EXAM_PAPER_SUGGESTION = gql<
  { resolveExamPaperSuggestion: ExamPaperDetailT },
  { suggestionId: string; accept: boolean; note?: string | null; text?: string | null; answer?: string | null; options?: string[] | null }
>`
  mutation ResolveExamPaperSuggestion($suggestionId: String!, $accept: Boolean!, $note: String, $text: String, $answer: String, $options: [String!]) {
    resolveExamPaperSuggestion(suggestionId: $suggestionId, accept: $accept, note: $note, text: $text, answer: $answer, options: $options) { ${DETAIL_FIELDS} }
  }
`;

export const SUBMIT_EXAM_PAPER_REVIEW = gql<{ submitExamPaperReview: ExamPaperDetailT }, { paperId: string; summary?: string | null }>`
  mutation SubmitExamPaperReview($paperId: String!, $summary: String) {
    submitExamPaperReview(paperId: $paperId, summary: $summary) { ${DETAIL_FIELDS} }
  }
`;

export const FINALIZE_EXAM_PAPER = gql<{ finalizeExamPaper: ExamPaperDetailT }, { paperId: string; final: boolean }>`
  mutation FinalizeExamPaper($paperId: String!, $final: Boolean!) {
    finalizeExamPaper(paperId: $paperId, final: $final) { ${DETAIL_FIELDS} }
  }
`;
