/**
 * Book-lifecycle GraphQL (docs/prd-book-lifecycle.md §7.4, §8; BL-1). Thin: every field names its
 * `book_lifecycle:*` action declaratively (static gate test) and the services re-check it. Reads are
 * `view`; writes are `manage`, and the paper-return verdict / direct-fix approve / mark final are
 * `finalize` (LOCKED). Ids of people are resolved on the MAIN connection here (D-#404: no cross-plane
 * populate). Lists that grow are paged (D-#761).
 */
import { Types } from "mongoose";
import {
  BOOK_VERSION_STATUS_BN,
  diffLines,
  formatBookVersion,
  formatBookVersionBn,
  type BookEdition,
  type BookFeedbackCategory,
  type BookFeedbackSource,
  type BookItemVerdict,
  type BookPacketScope,
  type BookRoundVerdict,
  type BookVersionBump,
} from "@scd/shared";
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { pageRef } from "../../../pageRef";
import { pageOf, queryPage } from "../../../lib/paging";
import { namesOf } from "../services/names";
import { SchoolBook, type ISchoolBook } from "../models/SchoolBook";
import { BookVersion, type IBookVersion } from "../models/BookVersion";
import { BookMemoRound, type IBookMemoRound } from "../models/BookMemoRound";
import { BookFeedback, BookDecision, BookRuleSet, BookInstruction, type IBookFeedback, type IBookDecision, type IBookRuleSet, type IBookInstruction } from "../models/BookFeedback";
import { BookEditDraft, type IBookEditDraft } from "../models/BookEditDraft";
import { BookEvent } from "../../support-book/models/BookEvent";
import { assertBookPlane, requireBookLcAny, canBookLc, requireBookLc } from "../services/access";
import { recordContentRead } from "../services/events";
import { chapterTextsBySha, loadBook, loadVersion, serverRegionContent, versionChapters, vno } from "../services/store";
import { rewriteServerRegions } from "../services/markdown";
import * as V from "../services/versionService";
import * as R from "../services/roundService";
import * as F from "../services/feedbackService";
import { BOBC } from "./shapes";

const auth = (ctx: AppContext) => {
  assertBookPlane();
  return ctx.auth!;
};
const iso = (d?: Date | null) => (d ? new Date(d).toISOString() : null);
const label = (v: { major: number; minor: number }) => formatBookVersion({ major: v.major, minor: v.minor });


// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

interface VersionSummary {
  id: string;
  label: string;
  labelBn: string;
  status: string;
  statusBn: string;
}
const vsum = (v: IBookVersion): VersionSummary => ({ id: v._id.toString(), label: label(v), labelBn: formatBookVersionBn(v), status: v.status, statusBn: BOOK_VERSION_STATUS_BN[v.status] });

const VersionSummaryRef = builder.objectRef<VersionSummary>("BookLcVersionSummary").implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    label: t.exposeString("label"),
    labelBn: t.exposeString("labelBn"),
    status: t.exposeString("status"),
    statusBn: t.exposeString("statusBn"),
  }),
});

interface BookShape {
  book: ISchoolBook;
  latest: IBookVersion | null;
  openFeedback: number;
  openRound: IBookMemoRound | null;
}
const BookRef = builder.objectRef<BookShape>("BookLcBook").implement({
  description: "A school book in the lifecycle (§5.1). listStatus is derived (§4.5).",
  fields: (t) => ({
    id: t.string({ resolve: (s) => s.book._id.toString() }),
    code: t.string({ resolve: (s) => s.book.code }),
    classLevel: t.int({ resolve: (s) => s.book.classLevel }),
    subject: t.string({ resolve: (s) => s.book.subject }),
    titleBn: t.string({ resolve: (s) => s.book.titleBn }),
    titleEn: t.string({ nullable: true, resolve: (s) => s.book.titleEn ?? null }),
    editions: t.stringList({ resolve: (s) => s.book.editions }),
    chapterHeadingLevel: t.int({ resolve: (s) => s.book.chapterHeadingLevel }),
    reviewerName: t.string({ nullable: true, resolve: (s) => s.book.reviewerName ?? null }),
    ruleSetKeys: t.stringList({ resolve: (s) => s.book.ruleSetKeys }),
    nextMemoNo: t.int({ resolve: (s) => s.book.nextMemoNo }),
    archived: t.boolean({ resolve: (s) => s.book.archived }),
    publishStudentToClassBooks: t.boolean({ resolve: (s) => s.book.publishStudentToClassBooks }),
    legacySupportBookId: t.string({ nullable: true, resolve: (s) => s.book.legacySupportBookId ?? null }),
    latest: t.field({ type: VersionSummaryRef, nullable: true, resolve: (s) => (s.latest ? vsum(s.latest) : null) }),
    finalVersionId: t.string({ nullable: true, resolve: (s) => s.book.finalVersionId?.toString() ?? null }),
    currentReleaseId: t.string({ nullable: true, resolve: (s) => s.book.currentReleaseId?.toString() ?? null }),
    listStatus: t.string({ resolve: (s) => listStatus(s.latest) }),
    openFeedback: t.int({ resolve: (s) => s.openFeedback }),
    openRoundId: t.string({ nullable: true, resolve: (s) => s.openRound?._id.toString() ?? null }),
    openRoundMemoNo: t.int({ nullable: true, resolve: (s) => s.openRound?.memoNo ?? null }),
    openRoundStatus: t.string({ nullable: true, resolve: (s) => s.openRound?.status ?? null }),
    roundOverdue: t.boolean({ resolve: (s) => !!s.openRound?.dueBy && s.openRound.status === "sent_on_paper" && s.openRound.dueBy < new Date() }),
    historyFiles: t.field({
      type: [BOBC.HistoryFileRef],
      resolve: (s) => s.book.historyFiles.map((h) => ({ fileId: h.storedFileId.toString(), label: h.label })),
    }),
  }),
});

function listStatus(v: IBookVersion | null): string {
  if (!v) return "drafting";
  switch (v.status) {
    case "draft":
    case "changes_requested":
      return "drafting";
    case "in_review":
      return "in_review";
    case "approved":
      return "approved";
    case "final":
      return "final";
    default:
      return "in_use";
  }
}

async function bookShape(book: ISchoolBook): Promise<BookShape> {
  const [latest, openFeedback, openRound] = await Promise.all([
    book.latestVersionId ? BookVersion.findById(book.latestVersionId) : null,
    BookFeedback.countDocuments({ bookId: book._id, status: { $in: ["open", "with_reviewer"] } }),
    BookMemoRound.findOne({ bookId: book._id, status: { $in: ["draft", "packet_ready", "sent_on_paper"] } }),
  ]);
  return { book, latest, openFeedback, openRound };
}

const BookPage = pageRef("BookLcBookPage", BookRef);

interface VersionShape {
  v: IBookVersion;
  names: Map<string, string>;
}
const VersionRef = builder.objectRef<VersionShape>("BookLcVersion").implement({
  description: "One version (§5.2). Immutable once created; files may be added until final.",
  fields: (t) => ({
    id: t.string({ resolve: (s) => s.v._id.toString() }),
    bookId: t.string({ resolve: (s) => s.v.bookId.toString() }),
    label: t.string({ resolve: (s) => label(s.v) }),
    labelBn: t.string({ resolve: (s) => formatBookVersionBn(s.v) }),
    status: t.string({ resolve: (s) => s.v.status }),
    statusBn: t.string({ resolve: (s) => BOOK_VERSION_STATUS_BN[s.v.status] }),
    source: t.string({ resolve: (s) => s.v.source }),
    parentVersionId: t.string({ nullable: true, resolve: (s) => s.v.parentVersionId?.toString() ?? null }),
    changeSummaryBn: t.string({ resolve: (s) => s.v.changeSummaryBn }),
    masterHash: t.string({ resolve: (s) => s.v.masterHash }),
    createdAt: t.string({ resolve: (s) => iso(s.v.createdAt)! }),
    createdByName: t.string({ nullable: true, resolve: (s) => s.names.get(s.v.createdBy.toString()) ?? null }),
    reviewSkippedAt: t.string({ nullable: true, resolve: (s) => iso(s.v.reviewSkipped?.at) }),
    importedAt: t.string({ nullable: true, resolve: (s) => iso(s.v.imported?.at) }),
    selfReviewed: t.boolean({ resolve: (s) => s.v.selfReviewed }),
    approvalBasis: t.string({ nullable: true, resolve: (s) => s.v.approvalBasis?.kind ?? null }),
    recordedFromPaperName: t.string({ nullable: true, resolve: (s) => s.v.recordedFromPaper?.reviewerName ?? null }),
    recordedFromPaperAt: t.string({ nullable: true, resolve: (s) => iso(s.v.recordedFromPaper?.at) }),
    finalAt: t.string({ nullable: true, resolve: (s) => iso(s.v.finalAt) }),
    files: t.field({
      type: [BOBC.FileRef],
      resolve: (s) =>
        s.v.files.map((f) => ({ role: f.role, edition: f.edition ?? null, format: f.format, fileId: f.storedFileId.toString(), stale: f.fromMasterHash !== s.v.masterHash, at: iso(f.at)! })),
    }),
    chapters: t.field({
      type: [BOBC.ChapterRef],
      resolve: (s) => [...s.v.chapters].sort((a, b) => a.order - b.order).map((c) => ({ key: c.key, title: c.title, order: c.order, chars: c.chars, sha: c.textSha256 })),
    }),
    changes: t.field({ type: [BOBC.ChangeRef], resolve: (s) => s.v.changes.map((c) => ({ ...c, page: c.page ?? null, sacred: !!c.sacred })) }),
    statusHistory: t.field({
      type: [BOBC.StatusRowRef],
      resolve: (s) => s.v.statusHistory.map((h) => ({ status: h.status, at: iso(h.at)!, note: h.note ?? null, byName: s.names.get(h.by?.toString() ?? "") ?? null })),
    }),
  }),
});
async function versionShape(v: IBookVersion): Promise<VersionShape> {
  return { v, names: await namesOf([v.createdBy, ...v.statusHistory.map((h) => h.by)]) };
}
const VersionPage = pageRef("BookLcVersionPage", VersionRef);

interface RoundShape {
  r: IBookMemoRound;
  versionLabel: string;
  baseLabel: string | null;
  memoMarkdown: string;
  unchecked: number;
  names: Map<string, string>;
}
const RoundRef = builder.objectRef<RoundShape>("BookLcRound").implement({
  description: "A review round on paper (§5.5). The reviewer has no login; everything is recorded on her behalf.",
  fields: (t) => ({
    id: t.string({ resolve: (s) => s.r._id.toString() }),
    bookId: t.string({ resolve: (s) => s.r.bookId.toString() }),
    memoNo: t.int({ resolve: (s) => s.r.memoNo }),
    status: t.string({ resolve: (s) => s.r.status }),
    reviewerName: t.string({ resolve: (s) => s.r.reviewerName }),
    selfReviewed: t.boolean({ resolve: (s) => s.r.selfReviewed }),
    versionId: t.string({ resolve: (s) => s.r.versionId.toString() }),
    versionLabel: t.string({ resolve: (s) => s.versionLabel }),
    baseLabel: t.string({ nullable: true, resolve: (s) => s.baseLabel }),
    dueBy: t.string({ nullable: true, resolve: (s) => iso(s.r.dueBy) }),
    overdue: t.boolean({ resolve: (s) => !!s.r.dueBy && s.r.status === "sent_on_paper" && s.r.dueBy < new Date() }),
    sentOnPaperAt: t.string({ nullable: true, resolve: (s) => iso(s.r.sentOnPaperAt) }),
    returnedAt: t.string({ nullable: true, resolve: (s) => iso(s.r.returnedAt) }),
    recordedAt: t.string({ nullable: true, resolve: (s) => iso(s.r.recordedAt) }),
    recordedByName: t.string({ nullable: true, resolve: (s) => (s.r.recordedBy ? s.names.get(s.r.recordedBy.toString()) ?? null : null) }),
    recordedFromPaper: t.boolean({ resolve: (s) => s.r.recordedFromPaper }),
    verdict: t.string({ nullable: true, resolve: (s) => s.r.verdict ?? null }),
    reviewerNoteBn: t.string({ nullable: true, resolve: (s) => s.r.reviewerNoteBn ?? null }),
    memoMarkdown: t.string({ resolve: (s) => s.memoMarkdown }),
    memoFrozen: t.boolean({ resolve: (s) => !!s.r.memo.frozen }),
    extraNotesBn: t.string({ nullable: true, resolve: (s) => s.r.memo.extraNotesBn ?? null }),
    wordingEdits: t.field({ type: [BOBC.WordingRef], resolve: (s) => s.r.wordingEdits.map((w) => ({ code: w.code, textBn: w.textBn })) }),
    feedbackIds: t.stringList({ resolve: (s) => s.r.feedbackIds.map(String) }),
    decisionIds: t.stringList({ resolve: (s) => s.r.decisionIds.map(String) }),
    packetScope: t.string({ nullable: true, resolve: (s) => s.r.packet?.scope ?? null }),
    memoPdfFileId: t.string({ nullable: true, resolve: (s) => s.r.packet?.memoPdfFileId?.toString() ?? null }),
    bookPdfFileId: t.string({ nullable: true, resolve: (s) => s.r.packet?.bookPdfFileId?.toString() ?? null }),
    pageCount: t.int({ nullable: true, resolve: (s) => s.r.packet?.pageCount ?? null }),
    pageMapSource: t.string({ nullable: true, resolve: (s) => s.r.packet?.pageMapSource ?? null }),
    pageMap: t.field({
      type: [BOBC.PageMapRef],
      resolve: (s) => (s.r.packet?.pageMap ?? []).map((p) => ({ chapterKey: p.chapterKey, title: p.title, startPage: p.startPage ?? null, confirmed: !!p.confirmed })),
    }),
    scanFileIds: t.stringList({ resolve: (s) => s.r.scanFileIds.map(String) }),
    itemMarks: t.field({
      type: [BOBC.MarkRef],
      resolve: (s) =>
        s.r.itemMarks.map((m) => ({ targetId: m.feedbackId.toString(), value: m.verdict, noteBn: m.noteBn ?? null, scanFileId: m.scanFileId?.toString() ?? null, scanPage: m.scanPage ?? null, via: m.via, checkedAt: iso(m.checkedAgainstScan?.at), checkedByName: m.checkedAgainstScan?.by ? s.names.get(m.checkedAgainstScan.by.toString()) ?? null : null })),
    }),
    decisionMarks: t.field({
      type: [BOBC.MarkRef],
      resolve: (s) =>
        s.r.decisionMarks.map((m) => ({ targetId: m.decisionId.toString(), value: m.optionKey ?? null, noteBn: m.noteBn ?? null, scanFileId: m.scanFileId?.toString() ?? null, scanPage: m.scanPage ?? null, via: m.via, checkedAt: iso(m.checkedAgainstScan?.at), checkedByName: m.checkedAgainstScan?.by ? s.names.get(m.checkedAgainstScan.by.toString()) ?? null : null })),
    }),
    uncheckedCount: t.int({ resolve: (s) => s.unchecked }),
    history: t.field({ type: [BOBC.StatusRowRef], resolve: (s) => s.r.history.map((h) => ({ status: h.action, at: iso(h.at)!, note: h.note ?? null, byName: s.names.get(h.by?.toString() ?? "") ?? null })) }),
  }),
});
async function roundShape(r: IBookMemoRound): Promise<RoundShape> {
  const v = await BookVersion.findById(r.versionId).select("major minor").lean();
  const b = r.baseVersionId ? await BookVersion.findById(r.baseVersionId).select("major minor").lean() : null;
  const names = await namesOf([r.recordedBy, ...r.history.map((h) => h.by), ...r.itemMarks.map((m) => m.checkedAgainstScan?.by), ...r.decisionMarks.map((m) => m.checkedAgainstScan?.by)]);
  return { r, versionLabel: v ? label(v) : "?", baseLabel: b ? label(b) : null, memoMarkdown: await R.roundMemoMarkdown(r), unchecked: r.status === "sent_on_paper" ? await R.uncheckedRows(r) : 0, names };
}
const RoundPage = pageRef("BookLcRoundPage", RoundRef);

interface FeedbackShape {
  f: IBookFeedback;
  showNames: boolean;
  names: Map<string, string>;
  dupCode: string | null;
}
const FeedbackRef = builder.objectRef<FeedbackShape>("BookLcFeedback").implement({
  description: "One feedback item (§5.6). Reporter names only to manage holders.",
  fields: (t) => ({
    id: t.string({ resolve: (s) => s.f._id.toString() }),
    bookId: t.string({ resolve: (s) => s.f.bookId.toString() }),
    code: t.string({ resolve: (s) => s.f.code }),
    source: t.string({ resolve: (s) => s.f.source }),
    status: t.string({ resolve: (s) => s.f.status }),
    route: t.string({ nullable: true, resolve: (s) => s.f.route ?? null }),
    category: t.string({ resolve: (s) => s.f.category }),
    textBn: t.string({ resolve: (s) => s.f.textBn }),
    chapterKey: t.string({ nullable: true, resolve: (s) => s.f.anchor?.chapterKey ?? null }),
    where: t.string({ nullable: true, resolve: (s) => s.f.anchor?.where ?? null }),
    quote: t.string({ nullable: true, resolve: (s) => s.f.anchor?.quote ?? null }),
    page: t.string({ nullable: true, resolve: (s) => s.f.anchor?.page ?? null }),
    edition: t.string({ nullable: true, resolve: (s) => s.f.anchor?.edition ?? null }),
    reporterName: t.string({ nullable: true, resolve: (s) => (s.showNames && s.f.reporterId ? s.names.get(s.f.reporterId.toString()) ?? null : null) }),
    roundId: t.string({ nullable: true, resolve: (s) => s.f.roundId?.toString() ?? null }),
    scanFileId: t.string({ nullable: true, resolve: (s) => s.f.evidence?.scanFileId?.toString() ?? null }),
    scanPage: t.int({ nullable: true, resolve: (s) => s.f.evidence?.scanPage ?? null }),
    via: t.string({ nullable: true, resolve: (s) => s.f.evidence?.via ?? null }),
    checkedAt: t.string({ nullable: true, resolve: (s) => iso(s.f.evidence?.checkedAgainstScan?.at) }),
    rulingVerdict: t.string({ nullable: true, resolve: (s) => s.f.reviewerRuling?.verdict ?? null }),
    rulingNoteBn: t.string({ nullable: true, resolve: (s) => s.f.reviewerRuling?.noteBn ?? null }),
    rulingFromPaper: t.boolean({ resolve: (s) => !!s.f.reviewerRuling?.recordedFromPaper }),
    rejectReasonBn: t.string({ nullable: true, resolve: (s) => s.f.rejectReasonBn ?? null }),
    duplicateOfCode: t.string({ nullable: true, resolve: (s) => s.dupCode }),
    appliedInVersionId: t.string({ nullable: true, resolve: (s) => s.f.appliedInVersionId?.toString() ?? null }),
    attachmentIds: t.stringList({ resolve: (s) => s.f.attachments.map(String) }),
    createdAt: t.string({ resolve: (s) => iso(s.f.createdAt)! }),
  }),
});
async function feedbackShapes(rows: IBookFeedback[], ctx: AppContext): Promise<FeedbackShape[]> {
  const showNames = canBookLc(ctx.auth, "manage");
  const names = showNames ? await namesOf(rows.map((r) => r.reporterId)) : new Map<string, string>();
  const dups = await BookFeedback.find({ _id: { $in: rows.map((r) => r.duplicateOf).filter(Boolean) } }).select("code").lean();
  const dupMap = new Map(dups.map((d) => [d._id.toString(), d.code]));
  return rows.map((f) => ({ f, showNames, names, dupCode: f.duplicateOf ? dupMap.get(f.duplicateOf.toString()) ?? null : null }));
}
const FeedbackPage = pageRef("BookLcFeedbackPage", FeedbackRef);

const DecisionRef = builder.objectRef<IBookDecision>("BookLcDecision").implement({
  description: "A decision (§5.8). Ruled decisions form the book's decision log.",
  fields: (t) => ({
    id: t.string({ resolve: (d) => d._id.toString() }),
    code: t.string({ resolve: (d) => d.code }),
    questionBn: t.string({ resolve: (d) => d.questionBn }),
    options: t.field({ type: [BOBC.OptionRef], resolve: (d) => d.options.map((o) => ({ key: o.key, textBn: o.textBn })) }),
    recommendedKey: t.string({ nullable: true, resolve: (d) => d.recommendedKey ?? null }),
    status: t.string({ resolve: (d) => d.status }),
    rulingOptionKey: t.string({ nullable: true, resolve: (d) => d.ruling?.optionKey ?? null }),
    rulingTextBn: t.string({ nullable: true, resolve: (d) => d.ruling?.textBn ?? null }),
    rulingBy: t.string({ nullable: true, resolve: (d) => d.ruling?.by ?? null }),
    rulingAt: t.string({ nullable: true, resolve: (d) => iso(d.ruling?.at) }),
    rulingFromPaper: t.boolean({ resolve: (d) => !!d.ruling?.recordedFromPaper }),
    selfRuled: t.boolean({ resolve: (d) => !!d.ruling?.selfRuled }),
  }),
});
const DecisionPage = pageRef("BookLcDecisionPage", DecisionRef);

const InstructionRef = builder.objectRef<IBookInstruction>("BookLcInstruction").implement({
  fields: (t) => ({
    id: t.string({ resolve: (i) => i._id.toString() }),
    code: t.string({ resolve: (i) => i.code }),
    textBn: t.string({ resolve: (i) => i.textBn }),
    needsReview: t.boolean({ resolve: (i) => i.needsReview }),
  }),
});
const InstructionPage = pageRef("BookLcInstructionPage", InstructionRef);

const RuleSetRef = builder.objectRef<IBookRuleSet>("BookLcRuleSet").implement({
  description: "A locked cross-book rule set version (§5.9).",
  fields: (t) => ({
    id: t.string({ resolve: (r) => r._id.toString() }),
    key: t.string({ resolve: (r) => r.key }),
    titleBn: t.string({ resolve: (r) => r.titleBn }),
    version: t.int({ resolve: (r) => r.version }),
    status: t.string({ resolve: (r) => r.status }),
    bookCodes: t.stringList({ resolve: (r) => r.bookCodes }),
    sha256: t.string({ resolve: (r) => r.sha256 }),
    bodyMarkdown: t.string({ resolve: (r) => r.bodyMarkdown }),
    createdAt: t.string({ resolve: (r) => iso(r.createdAt)! }),
  }),
});
const RuleSetPage = pageRef("BookLcRuleSetPage", RuleSetRef);

interface DraftShape {
  d: IBookEditDraft;
  baseLabel: string;
}
const DraftRef = builder.objectRef<DraftShape>("BookLcDraft").implement({
  description: "An edit draft (§5.12): nothing applies by itself; a person accepts chapter by chapter.",
  fields: (t) => ({
    id: t.string({ resolve: (s) => s.d._id.toString() }),
    bookId: t.string({ resolve: (s) => s.d.bookId.toString() }),
    status: t.string({ resolve: (s) => s.d.status }),
    source: t.string({ resolve: (s) => s.d.source }),
    baseVersionId: t.string({ resolve: (s) => s.d.baseVersionId.toString() }),
    baseLabel: t.string({ resolve: (s) => s.baseLabel }),
    newChapters: t.stringList({ resolve: (s) => s.d.rekey?.newChapters ?? [] }),
    missingChapters: t.stringList({ resolve: (s) => s.d.rekey?.missingChapters ?? [] }),
    rekeyConfirmed: t.boolean({ resolve: (s) => !V.needsRekeyConfirm(s.d) }),
    protectedChanged: t.boolean({ resolve: (s) => !!s.d.protectedChange?.changed }),
    protectedConfirmed: t.boolean({ resolve: (s) => !!s.d.protectedChange?.confirmedBy }),
    chapters: t.field({
      type: [BOBC.DraftChapterRef],
      resolve: (s) =>
        [...s.d.chapters]
          .sort((a, b) => a.order - b.order)
          .map((c) => ({
            key: c.key,
            title: c.title,
            status: c.status,
            mode: c.mode ?? null,
            isNew: c.baseSha == null,
            removed: c.newSha === null,
            opsCount: c.opsCount,
            findings: c.findings.map((f) => ({ code: f.code, level: f.level, messageBn: f.messageBn })),
            unexplained: c.unexplained.map((u) => ({ index: u.index, beforeText: u.beforeText, afterText: u.afterText, acked: !!u.ack?.at })),
            notApplied: c.notApplied.map((n) => ({ code: n.ref, textBn: n.reasonBn })),
          })),
    }),
    changes: t.field({ type: [BOBC.ChangeRef], resolve: (s) => s.d.changes.map((c) => ({ ...c, page: c.page ?? null, sacred: !!c.sacred })) }),
    blocking: t.field({ type: [BOBC.FindingRef], resolve: (s) => s.d.validatorReport.blocking.map((f) => ({ code: f.code, level: f.level, messageBn: f.messageBn })) }),
    warnings: t.field({ type: [BOBC.FindingRef], resolve: (s) => s.d.validatorReport.warnings.map((f) => ({ code: f.code, level: f.level, messageBn: f.messageBn })) }),
    acceptedVersionId: t.string({ nullable: true, resolve: (s) => s.d.acceptedVersionId?.toString() ?? null }),
    createdAt: t.string({ resolve: (s) => iso(s.d.createdAt)! }),
  }),
});
async function draftShape(d: IBookEditDraft): Promise<DraftShape> {
  const b = await BookVersion.findById(d.baseVersionId).select("major minor").lean();
  return { d, baseLabel: b ? label(b) : "?" };
}
const DraftPage = pageRef("BookLcDraftPage", DraftRef);

interface EventShape {
  kind: string;
  summary: string;
  at: string;
  actorName: string | null;
  origin: string | null;
}
const EventRef = builder.objectRef<EventShape>("BookLcEvent").implement({
  fields: (t) => ({
    kind: t.exposeString("kind"),
    summary: t.exposeString("summary"),
    at: t.exposeString("at"),
    actorName: t.exposeString("actorName", { nullable: true }),
    origin: t.exposeString("origin", { nullable: true }),
  }),
});
const EventPage = pageRef("BookLcEventPage", EventRef);

interface ChapterTextShape {
  key: string;
  title: string;
  text: string;
}
const ChapterTextRef = builder.objectRef<ChapterTextShape>("BookLcChapterText").implement({
  fields: (t) => ({ key: t.exposeString("key"), title: t.exposeString("title"), text: t.exposeString("text") }),
});

// ---------------------------------------------------------------------------
// Queries (view)
// ---------------------------------------------------------------------------

builder.queryField("bookLcBooksPage", (t) =>
  t.field({
    type: BookPage,
    authScopes: { hasAnyPermission: ["book_lifecycle:view", "book_lifecycle:release"] },
    args: { classLevel: t.arg.int(), subject: t.arg.string(), status: t.arg.string(), archived: t.arg.boolean(), page: t.arg.int(), pageSize: t.arg.int() },
    resolve: async (_r, a, ctx) => {
      requireBookLcAny(auth(ctx), ["view", "release"]);
      assertBookPlane();
      const filter: Record<string, unknown> = { archived: a.archived ?? false };
      if (a.classLevel != null) filter.classLevel = a.classLevel;
      if (a.subject) filter.subject = a.subject;
      const books = await SchoolBook.find(filter).sort({ classLevel: 1, code: 1 });
      const shapes = await Promise.all(books.map(bookShape));
      return pageOf(a.status ? shapes.filter((s) => listStatus(s.latest) === a.status) : shapes, a);
    },
  }),
);

builder.queryField("bookLcBook", (t) =>
  t.field({
    type: BookRef,
    authScopes: { hasAnyPermission: ["book_lifecycle:view", "book_lifecycle:release"] },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireBookLcAny(auth(ctx), ["view", "release"]);
      assertBookPlane();
      return bookShape(await loadBook(a.id));
    },
  }),
);

builder.queryField("bookLcVersionsPage", (t) =>
  t.field({
    type: VersionPage,
    authScopes: { hasPermission: "book_lifecycle:view" },
    args: { bookId: t.arg.string({ required: true }), page: t.arg.int(), pageSize: t.arg.int() },
    resolve: async (_r, a, ctx) => {
      requireBookLc(auth(ctx), "view");
      assertBookPlane();
      return queryPage(BookVersion, { bookId: new Types.ObjectId(a.bookId) }, { major: -1, minor: -1 }, a, async (docs) => Promise.all(docs.map((d) => versionShape(BookVersion.hydrate(d)))));
    },
  }),
);

builder.queryField("bookLcVersion", (t) =>
  t.field({
    type: VersionRef,
    authScopes: { hasPermission: "book_lifecycle:view" },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireBookLc(auth(ctx), "view");
      assertBookPlane();
      return versionShape(await loadVersion(a.id));
    },
  }),
);

builder.queryField("bookLcChapter", (t) =>
  t.field({
    type: ChapterTextRef,
    authScopes: { hasPermission: "book_lifecycle:view" },
    description: "One chapter's Markdown (the reader). Audited as a content read (one per user/version/day).",
    args: { versionId: t.arg.string({ required: true }), key: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      const au = requireBookLc(auth(ctx), "view");
      assertBookPlane();
      const v = await loadVersion(a.versionId);
      const c = (await versionChapters(v)).find((x) => x.key === a.key);
      if (!c) throw new Error("অধ্যায় পাওয়া যায়নি");
      await recordContentRead({ bookId: v.bookId, versionId: v._id, userId: au.userId, surface: "app" });
      // A final version shows the server's "চূড়ান্ত" version line (rewritten at read time, D-#1617).
      const final = v.status === "final" || v.status === "print_released";
      const text = final ? rewriteServerRegions(c.text, await serverRegionContent(v.bookId, vno(v), true)) : c.text;
      return { key: c.key, title: c.title, text };
    },
  }),
);

builder.queryField("bookLcDiff", (t) =>
  t.field({
    type: [BOBC.DiffChapterRef],
    authScopes: { hasPermission: "book_lifecycle:view" },
    description: "Chapter-by-chapter, word-level diff between two versions of a book (S3 তুলনা).",
    args: { fromVersionId: t.arg.string({ required: true }), toVersionId: t.arg.string({ required: true }), chapterKey: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      const au = requireBookLc(auth(ctx), "view");
      assertBookPlane();
      const [from, to] = await Promise.all([loadVersion(a.fromVersionId), loadVersion(a.toVersionId)]);
      if (!from.bookId.equals(to.bookId)) throw new Error("দুটি সংস্করণ একই বইয়ের নয়");
      await recordContentRead({ bookId: to.bookId, versionId: to._id, userId: au.userId, surface: "app" });
      return diffVersions(from, to, a.chapterKey ?? null);
    },
  }),
);

builder.queryField("bookLcDraftDiff", (t) =>
  t.field({
    type: [BOBC.DiffChapterRef],
    authScopes: { hasPermission: "book_lifecycle:view" },
    description: "The draft's diff against its base, per chapter (S11).",
    args: { draftId: t.arg.string({ required: true }), chapterKey: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      const au = requireBookLc(auth(ctx), "view");
      assertBookPlane();
      const d = await V.loadDraft(a.draftId);
      await recordContentRead({ bookId: d.bookId, versionId: d.baseVersionId, userId: au.userId, surface: "app", what: "draft diff" });
      const chapters = d.chapters.filter((c) => (!a.chapterKey || c.key === a.chapterKey) && c.status !== "unchanged" && c.status !== "pending");
      const texts = await chapterTextsBySha(chapters.flatMap((c) => [c.baseSha, c.newSha]).filter((x): x is string => !!x));
      return chapters.map((c) => ({
        key: c.key,
        title: c.title,
        status: c.baseSha == null ? "added" : c.newSha === null ? "removed" : "changed",
        hunks: diffLines(c.baseSha ? texts.get(c.baseSha) ?? "" : "", c.newSha ? texts.get(c.newSha) ?? "" : "").map(hunkShape),
      }));
    },
  }),
);

function hunkShape(h: ReturnType<typeof diffLines>[number]) {
  return { aStart: h.aStart, aLines: h.aLines, bStart: h.bStart, bLines: h.bLines, words: h.words.map((w) => ({ op: w.op, text: w.text })) };
}

async function diffVersions(from: IBookVersion, to: IBookVersion, only: string | null) {
  const [a, b] = await Promise.all([versionChapters(from), versionChapters(to)]);
  const am = new Map(a.map((c) => [c.key, c]));
  const out: { key: string; title: string; status: string; hunks: ReturnType<typeof hunkShape>[] }[] = [];
  for (const c of b) {
    if (only && c.key !== only) continue;
    const old = am.get(c.key);
    if (old && old.sha === c.sha) {
      out.push({ key: c.key, title: c.title, status: "same", hunks: [] });
      continue;
    }
    out.push({ key: c.key, title: c.title, status: old ? "changed" : "added", hunks: diffLines(old?.text ?? "", c.text).map(hunkShape) });
  }
  for (const c of a) if (!b.some((x) => x.key === c.key) && (!only || only === c.key)) out.push({ key: c.key, title: c.title, status: "removed", hunks: diffLines(c.text, "").map(hunkShape) });
  return out;
}

builder.queryField("bookLcRoundsPage", (t) =>
  t.field({
    type: RoundPage,
    authScopes: { hasPermission: "book_lifecycle:view" },
    args: { bookId: t.arg.string({ required: true }), page: t.arg.int(), pageSize: t.arg.int() },
    resolve: async (_r, a, ctx) => {
      requireBookLc(auth(ctx), "view");
      assertBookPlane();
      return queryPage(BookMemoRound, { bookId: new Types.ObjectId(a.bookId) }, { memoNo: -1 }, a, async (docs) => Promise.all(docs.map((d) => roundShape(BookMemoRound.hydrate(d)))));
    },
  }),
);

builder.queryField("bookLcRound", (t) =>
  t.field({
    type: RoundRef,
    authScopes: { hasPermission: "book_lifecycle:view" },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireBookLc(auth(ctx), "view");
      assertBookPlane();
      return roundShape(await R.loadRound(a.id));
    },
  }),
);

builder.queryField("bookLcFeedbackPage", (t) =>
  t.field({
    type: FeedbackPage,
    authScopes: { hasPermission: "book_lifecycle:view" },
    args: {
      bookId: t.arg.string(),
      status: t.arg.string(),
      source: t.arg.string(),
      route: t.arg.string(),
      chapterKey: t.arg.string(),
      roundId: t.arg.string(),
      page: t.arg.int(),
      pageSize: t.arg.int(),
    },
    resolve: async (_r, a, ctx) => {
      requireBookLc(auth(ctx), "view");
      assertBookPlane();
      const filter: Record<string, unknown> = {};
      if (a.bookId) filter.bookId = new Types.ObjectId(a.bookId);
      if (a.status) filter.status = a.status === "active" ? { $in: ["open", "with_reviewer", "accepted"] } : a.status;
      if (a.source) filter.source = a.source;
      if (a.route) filter.route = a.route;
      if (a.chapterKey) filter["anchor.chapterKey"] = a.chapterKey;
      if (a.roundId) filter.roundId = new Types.ObjectId(a.roundId);
      return queryPage(BookFeedback, filter, { createdAt: 1 }, a, async (docs) => feedbackShapes(docs.map((d) => BookFeedback.hydrate(d)), ctx));
    },
  }),
);

builder.queryField("bookLcDecisionsPage", (t) =>
  t.field({
    type: DecisionPage,
    authScopes: { hasPermission: "book_lifecycle:view" },
    args: { bookId: t.arg.string({ required: true }), status: t.arg.string(), page: t.arg.int(), pageSize: t.arg.int() },
    resolve: async (_r, a, ctx) => {
      requireBookLc(auth(ctx), "view");
      assertBookPlane();
      const filter: Record<string, unknown> = { bookId: new Types.ObjectId(a.bookId) };
      if (a.status) filter.status = a.status;
      return queryPage(BookDecision, filter, { code: 1 }, a, (docs) => docs.map((d) => BookDecision.hydrate(d)));
    },
  }),
);

builder.queryField("bookLcInstructionsPage", (t) =>
  t.field({
    type: InstructionPage,
    authScopes: { hasPermission: "book_lifecycle:view" },
    args: { bookId: t.arg.string({ required: true }), page: t.arg.int(), pageSize: t.arg.int() },
    resolve: async (_r, a, ctx) => {
      requireBookLc(auth(ctx), "view");
      assertBookPlane();
      return queryPage(BookInstruction, { bookId: new Types.ObjectId(a.bookId) }, { createdAt: 1 }, a, (docs) => docs.map((d) => BookInstruction.hydrate(d)));
    },
  }),
);

builder.queryField("bookLcRuleSetsPage", (t) =>
  t.field({
    type: RuleSetPage,
    authScopes: { hasPermission: "book_lifecycle:view" },
    args: { key: t.arg.string(), status: t.arg.string(), page: t.arg.int(), pageSize: t.arg.int() },
    resolve: async (_r, a, ctx) => {
      requireBookLc(auth(ctx), "view");
      assertBookPlane();
      const filter: Record<string, unknown> = {};
      if (a.key) filter.key = a.key;
      if (a.status) filter.status = a.status;
      return queryPage(BookRuleSet, filter, { key: 1, version: -1 }, a, (docs) => docs.map((d) => BookRuleSet.hydrate(d)));
    },
  }),
);

builder.queryField("bookLcDraftsPage", (t) =>
  t.field({
    type: DraftPage,
    authScopes: { hasPermission: "book_lifecycle:view" },
    args: { bookId: t.arg.string({ required: true }), page: t.arg.int(), pageSize: t.arg.int() },
    resolve: async (_r, a, ctx) => {
      requireBookLc(auth(ctx), "view");
      assertBookPlane();
      return queryPage(BookEditDraft, { bookId: new Types.ObjectId(a.bookId) }, { createdAt: -1 }, a, async (docs) => Promise.all(docs.map((d) => draftShape(BookEditDraft.hydrate(d)))));
    },
  }),
);

builder.queryField("bookLcDraft", (t) =>
  t.field({
    type: DraftRef,
    authScopes: { hasPermission: "book_lifecycle:view" },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireBookLc(auth(ctx), "view");
      assertBookPlane();
      return draftShape(await V.loadDraft(a.id));
    },
  }),
);

builder.queryField("bookLcEventsPage", (t) =>
  t.field({
    type: EventPage,
    authScopes: { hasPermission: "book_lifecycle:view" },
    args: { bookId: t.arg.string({ required: true }), page: t.arg.int(), pageSize: t.arg.int() },
    resolve: async (_r, a, ctx) => {
      requireBookLc(auth(ctx), "view");
      assertBookPlane();
      return queryPage(BookEvent, { bookId: a.bookId, flow: "LIFECYCLE", kind: { $ne: "CONTENT_READ" } }, { at: -1 }, a, async (docs) => {
        const names = await namesOf(docs.map((d) => d.actorId));
        return docs.map((d) => ({ kind: d.kind, summary: d.summary, at: iso(d.at)!, actorName: names.get(d.actorId.toString()) ?? null, origin: d.origin ?? null }));
      });
    },
  }),
);

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const ChangeRowInput = builder.inputType("BookLcChangeRowInput", {
  fields: (t) => ({
    chapterKey: t.string({ required: true }),
    where: t.string(),
    page: t.string(),
    beforeExcerpt: t.string(),
    afterExcerpt: t.string(),
    reason: t.string(),
    refs: t.stringList({ required: true }),
  }),
});
const PageEntryInput = builder.inputType("BookLcPageEntryInput", {
  fields: (t) => ({ chapterKey: t.string({ required: true }), startPage: t.int({ required: true }) }),
});
const WordingInput = builder.inputType("BookLcWordingInput", {
  fields: (t) => ({ code: t.string({ required: true }), textBn: t.string({ required: true }) }),
});
const ItemMarkInput = builder.inputType("BookLcItemMarkInput", {
  fields: (t) => ({ feedbackId: t.string({ required: true }), verdict: t.string({ required: true }), noteBn: t.string(), scanFileId: t.string(), scanPage: t.int() }),
});
const DecisionMarkInput = builder.inputType("BookLcDecisionMarkInput", {
  fields: (t) => ({ decisionId: t.string({ required: true }), optionKey: t.string(), noteBn: t.string(), scanFileId: t.string(), scanPage: t.int() }),
});
const PointInput = builder.inputType("BookLcReviewerPointInput", {
  fields: (t) => ({ chapterKey: t.string(), where: t.string(), page: t.string(), quote: t.string(), category: t.string({ required: true }), textBn: t.string({ required: true }), scanPage: t.int() }),
});
const FeedbackInput = builder.inputType("BookLcFeedbackInput", {
  fields: (t) => ({
    versionId: t.string(),
    releaseId: t.string(),
    chapterKey: t.string(),
    where: t.string(),
    quote: t.string(),
    page: t.string(),
    edition: t.string(),
    category: t.string({ required: true }),
    textBn: t.string({ required: true }),
    attachments: t.stringList(),
  }),
});
const date = (s?: string | null) => (s ? new Date(s) : null);

// ---------------------------------------------------------------------------
// Mutations — manage
// ---------------------------------------------------------------------------

builder.mutationField("createBookLc", (t) =>
  t.field({
    type: BookRef,
    authScopes: { hasPermission: "book_lifecycle:manage" },
    args: {
      code: t.arg.string({ required: true }),
      classLevel: t.arg.int({ required: true }),
      subject: t.arg.string({ required: true }),
      titleBn: t.arg.string({ required: true }),
      titleEn: t.arg.string(),
      editions: t.arg.stringList(),
      chapterHeadingLevel: t.arg.int(),
      reviewerName: t.arg.string(),
      nextMemoNo: t.arg.int(),
    },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return bookShape(await V.createBook(auth(ctx), { ...a, code: a.code.trim().toUpperCase(), editions: (a.editions as BookEdition[] | null) ?? null }));
    },
  }),
);

builder.mutationField("updateBookLc", (t) =>
  t.field({
    type: BookRef,
    authScopes: { hasPermission: "book_lifecycle:manage" },
    args: { id: t.arg.string({ required: true }), titleBn: t.arg.string(), titleEn: t.arg.string(), reviewerName: t.arg.string(), editions: t.arg.stringList(), ruleSetKeys: t.arg.stringList(), archived: t.arg.boolean(), legacySupportBookId: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return bookShape(await V.updateBook(auth(ctx), a.id, { ...a, editions: (a.editions as BookEdition[] | null) ?? null }));
    },
  }),
);

builder.mutationField("openBookLcRound", (t) =>
  t.field({
    type: RoundRef,
    authScopes: { hasPermission: "book_lifecycle:manage" },
    args: { bookId: t.arg.string({ required: true }), reviewerName: t.arg.string(), selfReview: t.arg.boolean(), feedbackIds: t.arg.stringList(), decisionIds: t.arg.stringList(), dueBy: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return roundShape(await R.openRound(auth(ctx), a.bookId, { ...a, dueBy: date(a.dueBy) }));
    },
  }),
);

builder.mutationField("updateBookLcRound", (t) =>
  t.field({
    type: RoundRef,
    authScopes: { hasPermission: "book_lifecycle:manage" },
    args: {
      id: t.arg.string({ required: true }),
      reviewerName: t.arg.string(),
      selfReview: t.arg.boolean(),
      dueBy: t.arg.string(),
      extraNotesBn: t.arg.string(),
      wordingEdits: t.arg({ type: [WordingInput] }),
      feedbackIds: t.arg.stringList(),
      decisionIds: t.arg.stringList(),
    },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return roundShape(await R.updateRound(auth(ctx), a.id, { ...a, dueBy: a.dueBy === undefined ? undefined : date(a.dueBy) }));
    },
  }),
);

builder.mutationField("detectBookLcPageMap", (t) =>
  t.field({
    type: RoundRef,
    authScopes: { hasPermission: "book_lifecycle:manage" },
    args: { roundId: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return roundShape(await R.detectPageMap(auth(ctx), a.roundId));
    },
  }),
);

builder.mutationField("setBookLcPageMap", (t) =>
  t.field({
    type: RoundRef,
    authScopes: { hasPermission: "book_lifecycle:manage" },
    args: { roundId: t.arg.string({ required: true }), entries: t.arg({ type: [PageEntryInput], required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return roundShape(await R.setPageMap(auth(ctx), a.roundId, a.entries));
    },
  }),
);

builder.mutationField("makeBookLcPacket", (t) =>
  t.field({
    type: RoundRef,
    authScopes: { hasPermission: "book_lifecycle:manage" },
    args: { roundId: t.arg.string({ required: true }), scope: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      if (a.scope !== "whole" && a.scope !== "changed") throw new Error("পুরো বই / শুধু বদলানো অধ্যায়");
      return roundShape(await R.makePacket(auth(ctx), a.roundId, a.scope as BookPacketScope));
    },
  }),
);

builder.mutationField("markBookLcRoundSent", (t) =>
  t.field({
    type: RoundRef,
    authScopes: { hasPermission: "book_lifecycle:manage" },
    args: { roundId: t.arg.string({ required: true }), sentAt: t.arg.string(), dueBy: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return roundShape(await R.markSentOnPaper(auth(ctx), a.roundId, { sentAt: date(a.sentAt), dueBy: a.dueBy === undefined ? undefined : date(a.dueBy) }));
    },
  }),
);

builder.mutationField("withdrawBookLcRound", (t) =>
  t.field({
    type: RoundRef,
    authScopes: { hasPermission: "book_lifecycle:manage" },
    args: { roundId: t.arg.string({ required: true }), reasonBn: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return roundShape(await R.withdrawRound(auth(ctx), a.roundId, a.reasonBn));
    },
  }),
);

builder.mutationField("setBookLcItemMarks", (t) =>
  t.field({
    type: RoundRef,
    authScopes: { hasPermission: "book_lifecycle:manage" },
    args: { roundId: t.arg.string({ required: true }), marks: t.arg({ type: [ItemMarkInput], required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return roundShape(await R.setItemMarks(auth(ctx), a.roundId, a.marks.map((m) => ({ ...m, verdict: m.verdict as BookItemVerdict }))));
    },
  }),
);

builder.mutationField("setBookLcDecisionMarks", (t) =>
  t.field({
    type: RoundRef,
    authScopes: { hasPermission: "book_lifecycle:manage" },
    args: { roundId: t.arg.string({ required: true }), marks: t.arg({ type: [DecisionMarkInput], required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return roundShape(await R.setDecisionMarks(auth(ctx), a.roundId, a.marks));
    },
  }),
);

builder.mutationField("addBookLcReviewerPoints", (t) =>
  t.field({
    type: [FeedbackRef],
    authScopes: { hasPermission: "book_lifecycle:manage" },
    args: { roundId: t.arg.string({ required: true }), scanFileId: t.arg.string(), items: t.arg({ type: [PointInput], required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      const rows = await R.addReviewerPoints(auth(ctx), a.roundId, { scanFileId: a.scanFileId, items: a.items.map((i) => ({ ...i, category: i.category as BookFeedbackCategory })) });
      return feedbackShapes(rows, ctx);
    },
  }),
);

builder.mutationField("checkBookLcRow", (t) =>
  t.field({
    type: RoundRef,
    authScopes: { hasPermission: "book_lifecycle:manage" },
    description: "স্ক্যানের সাথে মিলিয়েছি — kind: item | decision | point.",
    args: { roundId: t.arg.string({ required: true }), kind: t.arg.string({ required: true }), id: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      if (!["item", "decision", "point"].includes(a.kind)) throw new Error("ভুল সারি");
      return roundShape(await R.checkAgainstScan(auth(ctx), a.roundId, { kind: a.kind as "item" | "decision" | "point", id: a.id }));
    },
  }),
);

builder.mutationField("fileBookLcFeedback", (t) =>
  t.field({
    type: FeedbackRef,
    authScopes: { hasPermission: "book_lifecycle:manage" },
    args: { bookId: t.arg.string({ required: true }), source: t.arg.string({ required: true }), input: t.arg({ type: FeedbackInput, required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      const f = await F.fileFeedback(auth(ctx), a.bookId, a.source as BookFeedbackSource, { ...a.input, category: a.input.category as BookFeedbackCategory, edition: (a.input.edition as BookEdition | null) ?? null });
      return (await feedbackShapes([f], ctx))[0];
    },
  }),
);

builder.mutationField("triageBookLcFeedback", (t) =>
  t.field({
    type: [FeedbackRef],
    authScopes: { hasPermission: "book_lifecycle:manage" },
    description: "action: needs_reviewer | direct_fix | verbal_errata | reject | duplicate.",
    args: { ids: t.arg.stringList({ required: true }), action: t.arg.string({ required: true }), reasonBn: t.arg.string(), duplicateOfCode: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      const act: F.TriageAction =
        a.action === "reject"
          ? { kind: "reject", reasonBn: a.reasonBn ?? "" }
          : a.action === "duplicate"
            ? { kind: "duplicate", ofCode: a.duplicateOfCode ?? "" }
            : { kind: "route", route: a.action as "needs_reviewer" | "direct_fix" | "verbal_errata" };
      if (act.kind === "route" && !["needs_reviewer", "direct_fix", "verbal_errata"].includes(act.route)) throw new Error("ভুল বাছাই");
      return feedbackShapes(await F.triageFeedback(auth(ctx), a.ids, act), ctx);
    },
  }),
);

builder.mutationField("openBookLcDecision", (t) =>
  t.field({
    type: DecisionRef,
    authScopes: { hasPermission: "book_lifecycle:manage" },
    args: { bookId: t.arg.string({ required: true }), questionBn: t.arg.string({ required: true }), options: t.arg.stringList({ required: true }), recommendedIndex: t.arg.int(), fromFeedbackId: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return F.openDecision(auth(ctx), a.bookId, a);
    },
  }),
);

builder.mutationField("addBookLcInstruction", (t) =>
  t.field({
    type: InstructionRef,
    authScopes: { hasPermission: "book_lifecycle:manage" },
    args: { bookId: t.arg.string({ required: true }), textBn: t.arg.string({ required: true }), needsReview: t.arg.boolean() },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return F.addInstruction(auth(ctx), a.bookId, a);
    },
  }),
);

builder.mutationField("uploadBookLcRuleSet", (t) =>
  t.field({
    type: RuleSetRef,
    authScopes: { hasPermission: "book_lifecycle:manage" },
    args: { key: t.arg.string({ required: true }), titleBn: t.arg.string({ required: true }), bodyMarkdown: t.arg.string({ required: true }), bookCodes: t.arg.stringList() },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return F.uploadRuleSet(auth(ctx), a);
    },
  }),
);

builder.mutationField("setBookLcDraftChanges", (t) =>
  t.field({
    type: DraftRef,
    authScopes: { hasPermission: "book_lifecycle:manage" },
    args: { draftId: t.arg.string({ required: true }), rows: t.arg({ type: [ChangeRowInput], required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return draftShape(await V.setDraftChanges(auth(ctx), a.draftId, a.rows));
    },
  }),
);

builder.mutationField("confirmBookLcRekey", (t) =>
  t.field({
    type: DraftRef,
    authScopes: { hasPermission: "book_lifecycle:manage" },
    args: { draftId: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return draftShape(await V.confirmDraftRekey(auth(ctx), a.draftId));
    },
  }),
);

builder.mutationField("decideBookLcDraftChapter", (t) =>
  t.field({
    type: DraftRef,
    authScopes: { hasPermission: "book_lifecycle:manage" },
    args: { draftId: t.arg.string({ required: true }), chapterKey: t.arg.string({ required: true }), accept: t.arg.boolean({ required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return draftShape(await V.decideDraftChapter(auth(ctx), a.draftId, a.chapterKey, a.accept));
    },
  }),
);

builder.mutationField("acceptBookLcDraft", (t) =>
  t.field({
    type: VersionRef,
    authScopes: { hasPermission: "book_lifecycle:manage" },
    description: "VR-15: creates a DRAFT version from the accepted chapters.",
    args: { draftId: t.arg.string({ required: true }), bump: t.arg.string(), summaryBn: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return versionShape(await V.acceptDraft(auth(ctx), a.draftId, { bump: (a.bump as BookVersionBump | null) ?? "minor", summaryBn: a.summaryBn }));
    },
  }),
);

builder.mutationField("rejectBookLcDraft", (t) =>
  t.field({
    type: DraftRef,
    authScopes: { hasPermission: "book_lifecycle:manage" },
    args: { draftId: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return draftShape(await V.rejectDraft(auth(ctx), a.draftId));
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutations — finalize (LOCKED, Principal only)
// ---------------------------------------------------------------------------

builder.mutationField("recordBookLcReturn", (t) =>
  t.field({
    type: RoundRef,
    authScopes: { hasPermission: "book_lifecycle:finalize" },
    description: "Her overall verdict, recorded on her behalf from the paper copy (§10.3).",
    args: { roundId: t.arg.string({ required: true }), verdict: t.arg.string({ required: true }), returnedAt: t.arg.string(), reviewerNoteBn: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return roundShape(await R.recordReturn(auth(ctx), a.roundId, { verdict: a.verdict as BookRoundVerdict, returnedAt: date(a.returnedAt), reviewerNoteBn: a.reviewerNoteBn }));
    },
  }),
);

builder.mutationField("correctBookLcReturn", (t) =>
  t.field({
    type: RoundRef,
    authScopes: { hasPermission: "book_lifecycle:finalize" },
    args: { roundId: t.arg.string({ required: true }), itemMarks: t.arg({ type: [ItemMarkInput] }), decisionMarks: t.arg({ type: [DecisionMarkInput] }), reviewerNoteBn: t.arg.string(), noteBn: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return roundShape(
        await R.correctReturn(auth(ctx), a.roundId, { itemMarks: a.itemMarks?.map((m) => ({ ...m, verdict: m.verdict as BookItemVerdict })) ?? null, decisionMarks: a.decisionMarks ?? null, reviewerNoteBn: a.reviewerNoteBn, noteBn: a.noteBn }),
      );
    },
  }),
);

builder.mutationField("approveBookLcDirectFix", (t) =>
  t.field({
    type: VersionRef,
    authScopes: { hasPermission: "book_lifecycle:finalize" },
    args: { versionId: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return versionShape(await V.approveDirectFix(auth(ctx), a.versionId));
    },
  }),
);

builder.mutationField("markBookLcFinal", (t) =>
  t.field({
    type: VersionRef,
    authScopes: { hasPermission: "book_lifecycle:finalize" },
    args: { versionId: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return versionShape(await V.markFinal(auth(ctx), a.versionId));
    },
  }),
);

builder.mutationField("confirmBookLcProtectedChange", (t) =>
  t.field({
    type: DraftRef,
    authScopes: { hasPermission: "book_lifecycle:finalize" },
    args: { draftId: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return draftShape(await V.confirmProtectedChange(auth(ctx), a.draftId));
    },
  }),
);

builder.mutationField("ruleBookLcDecision", (t) =>
  t.field({
    type: DecisionRef,
    authScopes: { hasPermission: "book_lifecycle:finalize" },
    description: "The Principal rules a decision himself (no reviewer for it) — stamped selfRuled.",
    args: { decisionId: t.arg.string({ required: true }), optionKey: t.arg.string(), textBn: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return F.ruleDecisionSelf(auth(ctx), a.decisionId, a);
    },
  }),
);
