/**
 * Student support profile operations (docs/prd-child-support-profile.md §9; D-#1546–#1566).
 * Teachers: the card, the report form, "আমার রিপোর্ট", the comment prompt, the safeguarding button.
 * Principal: the review queue, batches (Mode B), versions, safeguarding referrals.
 */
import { gql } from "urql";

export interface SupportItemT {
  itemId: string;
  textBn: string;
  level: string | null;
  obsCount: number;
  teachersCount: number;
  settings: string[];
  lastEvidenceKey: string | null;
  hasGuardianInfo: boolean;
  mixed: boolean;
  kind: string | null;
  functionTag: string | null;
  insteadText: string | null;
  stale: boolean;
  dormant: boolean;
}
export interface SupportProfileViewT {
  studentId: string;
  studentName: string;
  status: string;
  versionNo: number | null;
  publishedAt: string | null;
  safeguardingBanner: boolean;
  sections: { section: string; items: SupportItemT[] }[];
  card: { strengths: SupportItemT[]; dos: SupportItemT[]; avoids: SupportItemT[]; goal: SupportItemT | null } | null;
}
export interface SupportQuestionT {
  flagId: string;
  field: string;
  severity: string;
  quote: string;
  askBn: string;
  suggestionBn: string | null;
}
export interface SupportReportT {
  id: string;
  studentId: string;
  studentName: string | null;
  authorName: string | null;
  textVisible: boolean;
  status: string;
  source: string;
  occurredOn: string;
  subject: string | null;
  periodNo: number | null;
  antecedentTags: string[];
  situation: string | null;
  settingNote: string | null;
  behaviour: string | null;
  howOften: string | null;
  tried: string | null;
  starterKeys: string[];
  result: string | null;
  resultNote: string | null;
  gotOrAvoided: string[];
  exception: string | null;
  whatWorked: string | null;
  goodThingText: string | null;
  goodThingNone: boolean;
  goodThingReasonKey: string | null;
  goodThingReasonBn: string | null;
  signs: string[];
  tone: string;
  round: number;
  safeguardingHold: string;
  checkSkipped: string;
  questions: SupportQuestionT[];
  principalEdited: boolean;
  edits: { field: string; before: string; after: string }[];
  decisionReasonBn: string | null;
  createdAt: string;
}

const ITEM = `itemId textBn level obsCount teachersCount settings lastEvidenceKey hasGuardianInfo mixed kind functionTag insteadText stale dormant`;
const REPORT = `id studentId studentName authorName textVisible status source occurredOn subject periodNo antecedentTags situation settingNote behaviour
  howOften tried starterKeys result resultNote gotOrAvoided exception whatWorked goodThingText goodThingNone goodThingReasonKey goodThingReasonBn signs tone round
  safeguardingHold checkSkipped questions { flagId field severity quote askBn suggestionBn } principalEdited edits { field before after }
  decisionReasonBn createdAt`;

export const SUPPORT_CHIPS = gql`
  query SupportProfileChips($studentIds: [String!]!) {
    supportProfileChips(studentIds: $studentIds)
  }
`;

export const SUPPORT_PROFILE_VIEW = gql`
  query SupportProfileView($studentId: String!, $surface: String!, $via: String!) {
    supportProfileView(studentId: $studentId, surface: $surface, via: $via) {
      studentId studentName status versionNo publishedAt safeguardingBanner
      sections { section items { ${ITEM} } }
      card { strengths { ${ITEM} } dos { ${ITEM} } avoids { ${ITEM} } goal { ${ITEM} } }
    }
  }
`;

export const SUBMIT_SUPPORT_REPORT = gql`
  mutation SubmitSupportReport($input: SupportReportInput!, $reportId: String, $safeguardingAnswer: String, $questionAnswers: [SupportQuestionAnswerInput!]) {
    submitSupportReport(input: $input, reportId: $reportId, safeguardingAnswer: $safeguardingAnswer, questionAnswers: $questionAnswers) {
      outcome signs balanceNudge blocked { field term kind } askHits { field term }
      report { id status }
    }
  }
`;

export const SAVE_SUPPORT_DRAFT = gql`
  mutation SaveSupportReportDraft($input: SupportReportInput!, $reportId: String) {
    saveSupportReportDraft(input: $input, reportId: $reportId) { id status signs }
  }
`;

export const WITHDRAW_SUPPORT_REPORT = gql`
  mutation WithdrawSupportReport($reportId: String!) {
    withdrawSupportReport(reportId: $reportId) { id status }
  }
`;

export const RAISE_SAFEGUARDING = gql`
  mutation RaiseSafeguardingConcern($studentId: String!, $textBn: String!) {
    raiseSafeguardingConcern(studentId: $studentId, textBn: $textBn)
  }
`;

export const MY_SUPPORT_REPORTS = gql`
  query MySupportReportsPage($page: Int, $pageSize: Int) {
    mySupportReportsPage(page: $page, pageSize: $pageSize) { total page pageSize rows { ${REPORT} } }
  }
`;

export const SUPPORT_REPORT = gql`
  query SupportReport($reportId: String!, $via: String) {
    supportReport(reportId: $reportId, via: $via) {
      ${REPORT}
      quickApprovable compareJson openFlags { flagId field severity quote askBn suggestionBn } disagreements dontRememberCount sectionHints
      evidencePreviewJson recordsJson
    }
  }
`;

export const MY_SUPPORT_SEED_PROMPTS = gql`
  query MySupportSeedPrompts {
    mySupportSeedPrompts { commentId studentId state expiresKey studentName offeredOn }
  }
`;

export const OFFER_SUPPORT_SEED = gql`
  mutation OfferSupportSeed($commentId: String!) {
    offerSupportSeed(commentId: $commentId) { offered safeguardingFirst praise state studentId }
  }
`;

export const ANSWER_SUPPORT_SEED = gql`
  mutation AnswerSupportSeed($commentId: String!, $choice: String!) {
    answerSupportSeed(commentId: $commentId, choice: $choice) { state draft { id studentId } }
  }
`;

export const SUPPORT_QUEUE = gql`
  query SupportQueuePage($status: String, $page: Int, $pageSize: Int) {
    supportQueuePage(status: $status, page: $page, pageSize: $pageSize) {
      total page pageSize waiting oldestDays held
      rows { id studentId studentName authorName status source occurredOn tone safeguardingHold checkSkipped quickApprovable }
    }
  }
`;

export const DECIDE_SUPPORT_REPORT = gql`
  mutation DecideSupportReport($reportId: String!, $decision: String!, $reasonBn: String) {
    decideSupportReport(reportId: $reportId, decision: $decision, reasonBn: $reasonBn) { id status }
  }
`;

export const RESOLVE_SUPPORT_HOLD = gql`
  mutation ResolveSupportSafeguardingHold($reportId: String!, $answer: String!) {
    resolveSupportSafeguardingHold(reportId: $reportId, answer: $answer) { id status safeguardingHold }
  }
`;

export const SAFEGUARDING_REFERRALS = gql`
  query SafeguardingReferralsPage($open: Boolean, $page: Int, $pageSize: Int) {
    safeguardingReferralsPage(open: $open, page: $page, pageSize: $pageSize) {
      total page pageSize rows { id studentId studentName raisedAt source signs textBn status seenAt noteBn }
    }
  }
`;

export const MARK_SAFEGUARDING_REFERRAL = gql`
  mutation MarkSafeguardingReferral($id: String!, $action: String!, $noteBn: String) {
    markSafeguardingReferral(id: $id, action: $action, noteBn: $noteBn)
  }
`;

export const SUPPORT_BATCHES = gql`
  query SupportBatchesPage($page: Int, $pageSize: Int) {
    supportBatchesPage(page: $page, pageSize: $pageSize) {
      total page pageSize rows { id code mode status reportCount childCount methodVersion producer downloads createdAt expiresKey backToQueue }
    }
  }
`;

export const CREATE_SUPPORT_BATCH = gql`
  mutation CreateSupportBatch($mode: String, $stages: [String!], $childIds: [String!]) {
    createSupportBatch(mode: $mode, stages: $stages, childIds: $childIds) { id code status reportCount childCount }
  }
`;

export const CANCEL_SUPPORT_BATCH = gql`
  mutation CancelSupportBatch($batchId: String!) {
    cancelSupportBatch(batchId: $batchId) { id status }
  }
`;

export const DOWNLOAD_SUPPORT_PACK = gql`
  mutation DownloadSupportPack($batchId: String!) {
    downloadSupportPack(batchId: $batchId) { fileName content sha256 sizeBytes }
  }
`;

export const UPLOAD_SUPPORT_RESULT = gql`
  mutation UploadSupportResult($batchId: String!, $text: String!, $chatLabel: String) {
    uploadSupportResult(batchId: $batchId, text: $text, chatLabel: $chatLabel) {
      importId batchCode status warnings backToQueue
      ok { reportId studentName occurredOn } returns { reportId studentName occurredOn questions } safeguarding { reportId studentName occurredOn }
      drafts { studentName items } rejected { itemRef reasonCode reasonBn text }
    }
  }
`;

export const APPLY_SUPPORT_IMPORT = gql`
  mutation ApplySupportImport($importId: String!, $untickReportIds: [String!]) {
    applySupportImport(importId: $importId, untickReportIds: $untickReportIds) { id status backToQueue }
  }
`;

export const DISCARD_SUPPORT_IMPORT = gql`
  mutation DiscardSupportImport($importId: String!) {
    discardSupportImport(importId: $importId)
  }
`;

export const DOWNLOAD_SUPPORT_EVAL_PACK = gql`
  mutation DownloadSupportEvalPack {
    downloadSupportEvalPack { fileName content sha256 sizeBytes }
  }
`;

export const RECORD_SUPPORT_EVALUATION = gql`
  mutation RecordSupportEvaluation($kind: String!, $chatLabel: String, $resultText: String!, $suggestionsChecked: Boolean!) {
    recordSupportEvaluation(kind: $kind, chatLabel: $chatLabel, resultText: $resultText, suggestionsChecked: $suggestionsChecked) { passed marksJson suggestions }
  }
`;

export const SUPPORT_METHOD_INFO = gql`
  query SupportMethodInfo {
    supportMethodInfo { version sha256 passedChats }
  }
`;

export const SUPPORT_VERSIONS = gql`
  query SupportVersionsPage($studentId: String!, $page: Int, $pageSize: Int) {
    supportVersionsPage(studentId: $studentId, page: $page, pageSize: $pageSize) {
      total page pageSize rows { id versionNo status mode producer changeNoteBn droppedItems itemCount provisionalCount publishedAt createdAt }
    }
  }
`;

export const PUBLISH_SUPPORT_VERSION = gql`
  mutation PublishSupportVersion($versionId: String!, $changeNoteBn: String) {
    publishSupportVersion(versionId: $versionId, changeNoteBn: $changeNoteBn) { id status versionNo }
  }
`;

export const DISCARD_SUPPORT_VERSION = gql`
  mutation DiscardSupportVersion($versionId: String!) {
    discardSupportVersion(versionId: $versionId) { id status }
  }
`;

export const SUPPORT_PROFILES = gql`
  query SupportProfilesPage($status: String, $page: Int, $pageSize: Int) {
    supportProfilesPage(status: $status, page: $page, pageSize: $pageSize) {
      total page pageSize rows { id studentId studentName classId status published nextReviewDueKey safeguardingBanner }
    }
  }
`;

export const SUPPORT_SETTING = gql`
  query SupportProfileSetting {
    supportProfileSetting { switchedOn switchedOnKey defaultMode approvalLoadReviewDueKey packBudgetTokens batchReminderDays }
  }
`;

export const SET_SUPPORT_SWITCH = gql`
  mutation SetSupportProfileSwitch($on: Boolean!) {
    setSupportProfileSwitch(on: $on) { switchedOn switchedOnKey approvalLoadReviewDueKey }
  }
`;

export const SUPPORT_ENABLED = gql`
  query SupportProfileEnabled {
    supportProfileEnabled
  }
`;

export const SUPPORT_REPORTABLE_STUDENTS = gql`
  query SupportReportableStudents($search: String!) {
    supportReportableStudents(search: $search) { id name }
  }
`;

export const SUPPORT_APPROVAL_LOAD = gql`
  query SupportApprovalLoadJson {
    supportApprovalLoadJson
  }
`;

export const RECORD_APPROVAL_LOAD_CHOICE = gql`
  mutation RecordSupportApprovalLoadChoice($choice: String!, $nextInDays: Int) {
    recordSupportApprovalLoadChoice(choice: $choice, nextInDays: $nextInDays)
  }
`;
