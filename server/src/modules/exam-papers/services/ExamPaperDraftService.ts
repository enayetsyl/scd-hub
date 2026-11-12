/**
 * ExamPaperDraftService — draft papers reviewed item by item (D-#1031–#1034,
 * docs/prd-exam-paper-bank.md §5).
 *
 * Who does what:
 *   exam_papers:manage  — import drafts, choose the reviewer, accept / reject suggestions,
 *                         mark a paper final (Principal by default).
 *   exam_papers:view    — read every draft and every suggestion (Office by default).
 *   the paper's reviewer — (exam_papers:review is SELF) confirm each item matches the
 *                         syllabus, suggest an edit / a deletion / a new question, and
 *                         say the review is done. A reviewer sees only their own papers.
 *
 * A suggestion never changes the paper by itself; accepting it does, and the item keeps
 * its old wording in `history`.
 */
import crypto from "node:crypto";
import { Types } from "mongoose";
import { EXAM_TERMS, ROSTER_CLASS_LABELS_BN, ROSTER_CLASS_LEVEL_MAX, ROSTER_CLASS_LEVEL_MIN, callerHasPermission } from "@scd/shared";
import type { RosterClassLevel } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
import { emit } from "../../notifications/services/NotificationService";
import {
  ExamPaperDraft,
  EXAM_ITEM_SOURCES,
  EXAM_SECTION_KINDS,
  type IExamPaperDraft,
  type IExamPaperItem,
  type IExamPaperSection,
} from "../models/ExamPaperDraft";
import {
  ExamPaperSuggestion,
  EXAM_SUGGESTION_KINDS,
  type IExamPaperSuggestion,
  type ExamSuggestionKind,
} from "../models/ExamPaperSuggestion";

export const EXAM_PAPER_ERRORS_BN = {
  forbidden: "এই প্রশ্নপত্র দেখার অনুমতি নেই",
  notFound: "প্রশ্নপত্রটি পাওয়া যায়নি",
  notReviewer: "এই প্রশ্নপত্রের রিভিউয়ার আপনি নন",
  final: "প্রশ্নপত্রটি চূড়ান্ত হয়ে গেছে — আর পরিবর্তন করা যাবে না",
  noItem: "প্রশ্নটি পাওয়া যায়নি",
  noSection: "অংশটি পাওয়া যায়নি",
  needText: "প্রস্তাবিত প্রশ্নটি লিখুন",
  needChange: "কী বদলাতে হবে লিখুন",
  needReason: "কেন মুছতে হবে লিখুন",
  noSuggestion: "প্রস্তাবটি পাওয়া যায়নি",
  notOpen: "প্রস্তাবটির সিদ্ধান্ত আগেই হয়ে গেছে",
  notAuthor: "শুধু যিনি প্রস্তাব দিয়েছেন তিনিই ফিরিয়ে নিতে পারেন",
  badReviewer: "রিভিউয়ার হিসেবে একজন সক্রিয় স্টাফ বাছাই করুন",
  noReviewer: "আগে একজন রিভিউয়ার ঠিক করুন",
  exists: "এই প্রশ্নপত্রটি আগেই যোগ করা হয়েছে",
  badPayload: "প্রশ্নপত্রের ফাইলটি সঠিক নয়",
} as const;

// ---------------------------------------------------------------------------
// Payload validation — the server twin of server/scripts/exam-papers/validate-drafts.mjs
// ---------------------------------------------------------------------------

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** Returns the list of problems with a `scd.exam-paper-draft/v1` payload (empty = valid). */
export function validateDraftPayload(p: any): string[] {
  const errors: string[] = [];
  const e = (m: string) => errors.push(m);
  if (!p || typeof p !== "object") return ["not an object"];
  if (p.schema !== "scd.exam-paper-draft/v1") e("schema must be scd.exam-paper-draft/v1");
  if (typeof p.key !== "string" || !/^[a-z0-9-]+$/i.test(p.key)) e("key missing/invalid");
  if (!Number.isInteger(p.classLevel) || p.classLevel < ROSTER_CLASS_LEVEL_MIN || p.classLevel > ROSTER_CLASS_LEVEL_MAX)
    e(`classLevel must be ${ROSTER_CLASS_LEVEL_MIN}..${ROSTER_CLASS_LEVEL_MAX}`);
  if (typeof p.subject !== "string" || !p.subject) e("subject missing");
  if (!(p.fullMarks > 0)) e("fullMarks missing");
  if (!p.exam || !(EXAM_TERMS as readonly string[]).includes(p.exam.term) || !Number.isInteger(p.exam.year)) e("exam {term, year} missing");
  if (typeof p.titleBn !== "string" || !p.titleBn.trim()) e("titleBn missing");
  const rows: any[] = Array.isArray(p.syllabusRows) ? p.syllabusRows : [];
  const sections: any[] = Array.isArray(p.sections) ? p.sections : [];
  if (!sections.length) e("sections missing");
  const rowBySeq = new Map(rows.map((r) => [r.seq, r]));
  const keys = new Set<string>();
  let sum = 0;
  sections.forEach((s, i) => {
    const where = `section ${s?.seq ?? i + 1}`;
    if (!Number.isInteger(s?.seq)) e(`${where}: seq missing`);
    if (!(EXAM_SECTION_KINDS as readonly string[]).includes(s?.kind)) e(`${where}: kind must be WRITTEN|ORAL`);
    if (typeof s?.instructionBn !== "string" || !s.instructionBn.trim()) e(`${where}: instructionBn missing`);
    if (!(s?.total >= 0)) e(`${where}: total missing`);
    const rowSeqs = Array.isArray(s?.syllabusRowSeq) ? s.syllabusRowSeq : s?.syllabusRowSeq != null ? [s.syllabusRowSeq] : [];
    if (rows.length) for (const rs of rowSeqs) if (!rowBySeq.has(rs)) e(`${where}: syllabusRowSeq ${rs} not in syllabusRows`);
    sum += Number(s?.total) || 0;
    const items: any[] = Array.isArray(s?.items) ? s.items : [];
    if (s?.kind === "WRITTEN" && !items.length) e(`${where}: no items`);
    items.forEach((it, j) => {
      const iw = `${where} item ${j + 1}`;
      if (typeof it?.key !== "string" || !it.key) e(`${iw}: key missing`);
      else if (keys.has(it.key)) e(`${iw}: duplicate key ${it.key}`);
      else keys.add(it.key);
      if (typeof it?.text !== "string" || !it.text.trim()) e(`${iw}: text missing`);
      if (!(EXAM_ITEM_SOURCES as readonly string[]).includes(it?.source)) e(`${iw}: source ${it?.source} unknown`);
    });
  });
  if (p.fullMarks > 0 && !near(sum, p.fullMarks)) e(`sections sum ${sum} ≠ fullMarks ${p.fullMarks}`);
  return errors;
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

function canManage(ctx: AppContext): boolean {
  return !!ctx.auth && callerHasPermission(ctx.auth, "exam_papers:manage");
}
function canViewAll(ctx: AppContext): boolean {
  return !!ctx.auth && (canManage(ctx) || callerHasPermission(ctx.auth, "exam_papers:view"));
}
function isReviewer(ctx: AppContext, p: Pick<IExamPaperDraft, "reviewerUserId">): boolean {
  return !!ctx.auth && !!p.reviewerUserId && p.reviewerUserId.toString() === ctx.auth.userId;
}
function assertCanRead(ctx: AppContext, p: IExamPaperDraft): void {
  if (canViewAll(ctx) || isReviewer(ctx, p)) return;
  throw new ForbiddenError(EXAM_PAPER_ERRORS_BN.forbidden);
}
/** Reviewer of this paper, or a manager, while the paper is not FINAL. */
function assertCanReview(ctx: AppContext, p: IExamPaperDraft): void {
  if (!(isReviewer(ctx, p) || canManage(ctx))) throw new ForbiddenError(EXAM_PAPER_ERRORS_BN.notReviewer);
  if (p.status === "FINAL") throw new Error(EXAM_PAPER_ERRORS_BN.final);
}
function assertManage(ctx: AppContext): void {
  if (!canManage(ctx)) throw new ForbiddenError(EXAM_PAPER_ERRORS_BN.forbidden);
}

async function loadPaper(id: string): Promise<IExamPaperDraft> {
  if (!Types.ObjectId.isValid(id)) throw new Error(EXAM_PAPER_ERRORS_BN.notFound);
  const p = await ExamPaperDraft.findById(id);
  if (!p) throw new Error(EXAM_PAPER_ERRORS_BN.notFound);
  return p;
}

function findItem(p: IExamPaperDraft, key: string): { section: IExamPaperSection; item: IExamPaperItem } | null {
  for (const section of p.sections) {
    const item = section.items.find((i) => i.key === key);
    if (item) return { section, item };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface ExamPaperProgress {
  itemCount: number;
  confirmedCount: number;
  openSuggestions: number;
  acceptedSuggestions: number;
  rejectedSuggestions: number;
}

export interface ExamPaperSummaryShape extends ExamPaperProgress {
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
  status: string;
  reviewerUserId: string | null;
  reviewerName: string | null;
  reviewSubmittedAt: string | null;
  updatedAt: string;
}

export interface ExamPaperItemShape {
  key: string;
  text: string;
  options: string[];
  answer: string | null;
  marks: number | null;
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

export interface ExamPaperSectionShape {
  seq: number;
  syllabusRowSeq: number[];
  syllabusLabel: string | null;
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
  items: ExamPaperItemShape[];
}

export interface ExamPaperSuggestionShape {
  id: string;
  kind: string;
  sectionSeq: number;
  itemKey: string | null;
  proposedText: string | null;
  proposedAnswer: string | null;
  proposedOptions: string[];
  reason: string | null;
  status: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
  resolvedByName: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdItemKey: string | null;
}

export interface ExamPaperDetailShape extends ExamPaperSummaryShape {
  durationBn: string | null;
  authorNotes: string | null;
  reviewSummary: string | null;
  sections: ExamPaperSectionShape[];
  suggestions: ExamPaperSuggestionShape[];
  /** What the viewer may do on this paper — the screen draws buttons from these. */
  viewerIsReviewer: boolean;
  viewerCanManage: boolean;
}

async function namesOf(ids: (Types.ObjectId | string | null | undefined)[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean).map(String))];
  if (!uniq.length) return new Map();
  const users = await User.find({ _id: { $in: uniq } }).select("name").lean();
  return new Map(users.map((u) => [String(u._id), u.name]));
}

function progressOf(p: IExamPaperDraft, sugg: Pick<IExamPaperSuggestion, "status">[]): ExamPaperProgress {
  let itemCount = 0;
  let confirmedCount = 0;
  for (const s of p.sections)
    for (const i of s.items) {
      if (i.removed) continue;
      itemCount++;
      if (i.syllabusConfirmedAt) confirmedCount++;
    }
  return {
    itemCount,
    confirmedCount,
    openSuggestions: sugg.filter((x) => x.status === "OPEN").length,
    acceptedSuggestions: sugg.filter((x) => x.status === "ACCEPTED").length,
    rejectedSuggestions: sugg.filter((x) => x.status === "REJECTED").length,
  };
}

function summaryOf(p: IExamPaperDraft, sugg: Pick<IExamPaperSuggestion, "status">[], names: Map<string, string>): ExamPaperSummaryShape {
  return {
    id: p._id.toString(),
    key: p.key,
    term: p.term,
    year: p.year,
    examNameBn: p.examNameBn,
    classLevel: p.classLevel,
    classLabelBn: ROSTER_CLASS_LABELS_BN[p.classLevel as RosterClassLevel] ?? String(p.classLevel),
    subject: p.subject,
    titleBn: p.titleBn,
    fullMarks: p.fullMarks,
    status: p.status,
    reviewerUserId: p.reviewerUserId ? p.reviewerUserId.toString() : null,
    reviewerName: p.reviewerUserId ? (names.get(p.reviewerUserId.toString()) ?? null) : null,
    reviewSubmittedAt: p.reviewSubmittedAt ? new Date(p.reviewSubmittedAt).toISOString() : null,
    updatedAt: new Date(p.updatedAt).toISOString(),
    ...progressOf(p, sugg),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ExamPaperListFilter {
  year?: number | null;
  term?: string | null;
  classLevel?: number | null;
  /** Only papers the viewer reviews. Forced on for a viewer without view/manage. */
  mine?: boolean | null;
}

export async function examPaperDrafts(ctx: AppContext, filter: ExamPaperListFilter = {}): Promise<ExamPaperSummaryShape[]> {
  if (!ctx.auth) throw new ForbiddenError(EXAM_PAPER_ERRORS_BN.forbidden);
  const q: Record<string, unknown> = {};
  if (filter.year) q.year = filter.year;
  if (filter.term) q.term = filter.term;
  if (filter.classLevel !== undefined && filter.classLevel !== null) q.classLevel = filter.classLevel;
  if (filter.mine || !canViewAll(ctx)) q.reviewerUserId = new Types.ObjectId(ctx.auth.userId);
  const papers = (await ExamPaperDraft.find(q).lean()) as unknown as IExamPaperDraft[];
  if (!papers.length) return [];
  const sugg = await ExamPaperSuggestion.find({ paperId: { $in: papers.map((p) => p._id) } })
    .select("paperId status")
    .lean();
  const byPaper = new Map<string, { status: string }[]>();
  for (const s of sugg) {
    const k = String(s.paperId);
    if (!byPaper.has(k)) byPaper.set(k, []);
    byPaper.get(k)!.push({ status: s.status });
  }
  const names = await namesOf(papers.map((p) => p.reviewerUserId));
  return papers
    .sort((a, b) => b.year - a.year || a.classLevel - b.classLevel || a.subject.localeCompare(b.subject))
    .map((p) => summaryOf(p, (byPaper.get(String(p._id)) ?? []) as IExamPaperSuggestion[], names));
}

function suggestionShape(s: IExamPaperSuggestion, names: Map<string, string>): ExamPaperSuggestionShape {
  return {
    id: s._id.toString(),
    kind: s.kind,
    sectionSeq: s.sectionSeq,
    itemKey: s.itemKey ?? null,
    proposedText: s.proposedText ?? null,
    proposedAnswer: s.proposedAnswer ?? null,
    proposedOptions: s.proposedOptions ?? [],
    reason: s.reason ?? null,
    status: s.status,
    createdById: s.createdBy.toString(),
    createdByName: names.get(s.createdBy.toString()) ?? "—",
    createdAt: new Date(s.createdAt).toISOString(),
    resolvedByName: s.resolvedBy ? (names.get(s.resolvedBy.toString()) ?? null) : null,
    resolvedAt: s.resolvedAt ? new Date(s.resolvedAt).toISOString() : null,
    resolutionNote: s.resolutionNote ?? null,
    createdItemKey: s.createdItemKey ?? null,
  };
}

export async function examPaperDraft(ctx: AppContext, id: string): Promise<ExamPaperDetailShape> {
  const p = await loadPaper(id);
  assertCanRead(ctx, p);
  return detailOf(ctx, p);
}

async function detailOf(ctx: AppContext, p: IExamPaperDraft): Promise<ExamPaperDetailShape> {
  const sugg = (await ExamPaperSuggestion.find({ paperId: p._id }).sort({ createdAt: 1 }).lean()) as unknown as IExamPaperSuggestion[];
  const confirmers = p.sections.flatMap((s) => s.items.map((i) => i.syllabusConfirmedBy));
  const names = await namesOf([
    p.reviewerUserId,
    ...confirmers,
    ...sugg.map((s) => s.createdBy),
    ...sugg.map((s) => s.resolvedBy),
  ]);
  const rowLabel = new Map(p.syllabusRows.map((r) => [r.seq, r.label]));
  return {
    ...summaryOf(p, sugg, names),
    durationBn: p.durationBn ?? null,
    authorNotes: p.authorNotes ?? null,
    reviewSummary: p.reviewSummary ?? null,
    viewerIsReviewer: isReviewer(ctx, p),
    viewerCanManage: canManage(ctx),
    sections: p.sections.map((s) => ({
      seq: s.seq,
      syllabusRowSeq: s.syllabusRowSeq ?? [],
      syllabusLabel: (s.syllabusRowSeq ?? []).map((n) => rowLabel.get(n)).filter(Boolean).join(" + ") || null,
      kind: s.kind,
      instructionBn: s.instructionBn,
      count: s.count ?? null,
      marksEach: s.marksEach ?? null,
      total: s.total,
      choiceNoteBn: s.choiceNoteBn ?? null,
      splitMarks: !!s.splitMarks,
      stimulusMd: s.stimulusMd ?? null,
      matchRight: s.matchRight ?? [],
      activeItemCount: s.items.filter((i) => !i.removed).length,
      items: s.items.map((i) => ({
        key: i.key,
        text: i.text,
        options: i.options ?? [],
        answer: i.answer ?? null,
        marks: i.marks ?? null,
        source: i.source,
        sourceRef: i.sourceRef ?? null,
        bookRef: i.bookRef ?? null,
        needsPicture: !!i.needsPicture,
        note: i.note ?? null,
        removed: !!i.removed,
        syllabusConfirmed: !!i.syllabusConfirmedAt,
        syllabusConfirmedByName: i.syllabusConfirmedBy ? (names.get(i.syllabusConfirmedBy.toString()) ?? null) : null,
        syllabusConfirmedAt: i.syllabusConfirmedAt ? new Date(i.syllabusConfirmedAt).toISOString() : null,
        editedCount: (i.history ?? []).length,
      })),
    })),
    suggestions: sugg.map((s) => suggestionShape(s, names)),
  };
}

export interface ReviewerOption {
  id: string;
  name: string;
  role: string;
}

/** Active staff a manager can pick as the reviewer. */
export async function examPaperReviewerOptions(): Promise<ReviewerOption[]> {
  const users = await User.find({ active: true, role: { $in: ["TEACHER", "OFFICE", "PRINCIPAL"] } })
    .select("name role")
    .lean();
  return users
    .map((u) => ({ id: String(u._id), name: u.name, role: u.role as string }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Writes — manager
// ---------------------------------------------------------------------------

export async function importExamPaperDraft(ctx: AppContext, payload: unknown): Promise<ExamPaperSummaryShape> {
  assertManage(ctx);
  const p = payload as any;
  const problems = validateDraftPayload(p);
  if (problems.length) throw new Error(`${EXAM_PAPER_ERRORS_BN.badPayload}: ${problems.slice(0, 5).join("; ")}`);
  if (await ExamPaperDraft.exists({ key: p.key })) throw new Error(EXAM_PAPER_ERRORS_BN.exists);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  const doc = await ExamPaperDraft.create({
    key: p.key,
    term: p.exam.term,
    year: p.exam.year,
    examNameBn: str(p.exam.nameBn) ?? `${p.exam.term === "ANNUAL" ? "বার্ষিক" : "অর্ধ-বার্ষিক"} পরীক্ষা ${p.exam.year}`,
    classLevel: p.classLevel,
    subject: p.subject,
    titleBn: p.titleBn,
    fullMarks: p.fullMarks,
    durationBn: str(p.durationBn),
    authorNotes: str(p.authorNotes),
    syllabusRows: (p.syllabusRows ?? []).map((r: any) => ({
      seq: r.seq,
      label: String(r.label ?? ""),
      itemType: r.itemType ?? null,
      component: r.component ?? null,
      count: r.count ?? null,
      marksEach: r.marksEach ?? null,
      total: Number(r.total) || 0,
    })),
    sections: p.sections.map((s: any) => ({
      seq: s.seq,
      syllabusRowSeq: Array.isArray(s.syllabusRowSeq) ? s.syllabusRowSeq : s.syllabusRowSeq != null ? [s.syllabusRowSeq] : [],
      kind: s.kind,
      instructionBn: s.instructionBn,
      count: s.count ?? null,
      marksEach: s.marksEach ?? null,
      total: s.total,
      choiceNoteBn: str(s.choiceNoteBn),
      splitMarks: !!s.splitMarks,
      stimulusMd: str(s.stimulusMd),
      matchRight: Array.isArray(s.matchRight) ? s.matchRight.map(String) : [],
      items: (s.items ?? []).map((it: any) => ({
        key: it.key,
        text: it.text,
        options: Array.isArray(it.options) ? it.options.map(String) : [],
        answer: it.answer == null ? null : String(it.answer),
        marks: typeof it.marks === "number" ? it.marks : null,
        source: it.source,
        sourceRef: str(it.sourceRef),
        bookRef: str(it.bookRef),
        needsPicture: !!it.needsPicture,
        note: str(it.note),
      })),
    })),
    status: "DRAFT",
    importedBy: new Types.ObjectId(ctx.auth!.userId),
  });
  await writeAudit({
    eventKind: "EXAM_PAPER_DRAFT_IMPORTED",
    actorId: ctx.auth!.userId,
    targetId: doc._id,
    targetKind: "ExamPaperDraft",
    meta: { key: doc.key, classLevel: doc.classLevel, subject: doc.subject },
  });
  return summaryOf(doc, [], new Map());
}

/** Choose (or change) the reviewer of one or more papers; the reviewer gets ONE notification. */
export async function assignExamPaperReviewer(ctx: AppContext, paperIds: string[], reviewerUserId: string): Promise<ExamPaperSummaryShape[]> {
  assertManage(ctx);
  if (!Types.ObjectId.isValid(reviewerUserId)) throw new Error(EXAM_PAPER_ERRORS_BN.badReviewer);
  const reviewer = await User.findOne({ _id: reviewerUserId, active: true, role: { $in: ["TEACHER", "OFFICE", "PRINCIPAL"] } })
    .select("name")
    .lean();
  if (!reviewer) throw new Error(EXAM_PAPER_ERRORS_BN.badReviewer);
  const ids = [...new Set(paperIds)].filter((x) => Types.ObjectId.isValid(x));
  const papers = await ExamPaperDraft.find({ _id: { $in: ids } });
  if (!papers.length) throw new Error(EXAM_PAPER_ERRORS_BN.notFound);
  const now = new Date();
  const changed: IExamPaperDraft[] = [];
  for (const p of papers) {
    if (p.status === "FINAL") throw new Error(EXAM_PAPER_ERRORS_BN.final);
    const same = p.reviewerUserId?.toString() === reviewerUserId;
    p.reviewerUserId = new Types.ObjectId(reviewerUserId);
    if (!same) {
      p.reviewerAssignedAt = now;
      p.reviewSubmittedAt = null;
      changed.push(p);
    }
    if (p.status === "DRAFT" || !same) p.status = "IN_REVIEW";
    await p.save();
  }
  await writeAudit({
    eventKind: "EXAM_PAPER_REVIEWER_ASSIGNED",
    actorId: ctx.auth!.userId,
    targetId: papers[0]._id,
    targetKind: "ExamPaperDraft",
    meta: { reviewerUserId, paperIds: papers.map((p) => String(p._id)), keys: papers.map((p) => p.key) },
  });
  if (changed.length) {
    const digest = crypto.createHash("sha1").update(changed.map((p) => String(p._id)).sort().join(",")).digest("hex").slice(0, 16);
    const one = changed.length === 1 ? changed[0] : null;
    await emit({
      recipientUserId: reviewerUserId,
      kind: "REVIEW_ASSIGNED",
      titleBn: "প্রশ্নপত্র রিভিউ করতে দেওয়া হয়েছে",
      bodyBn: one
        ? `${one.titleBn} — প্রতিটি প্রশ্ন সিলেবাসের সাথে মিলিয়ে দেখুন, দরকার হলে সম্পাদনা/মুছে ফেলা/নতুন প্রশ্নের প্রস্তাব দিন।`
        : `${changed.length}টি প্রশ্নপত্র — প্রতিটি প্রশ্ন সিলেবাসের সাথে মিলিয়ে দেখুন, দরকার হলে সম্পাদনা/মুছে ফেলা/নতুন প্রশ্নের প্রস্তাব দিন।`,
      refs: one ? { examPaperId: String(one._id) } : { examPaperId: "list" },
      dedupeKey: `exam-paper-review:${reviewerUserId}:${digest}:${now.toISOString().slice(0, 10)}`,
    }).catch((err) => console.warn("exam paper review notice failed:", (err as Error)?.message));
  }
  const names = new Map([[reviewerUserId, reviewer.name]]);
  return papers.map((p) => summaryOf(p, [], names));
}

export async function finalizeExamPaper(ctx: AppContext, paperId: string, final: boolean): Promise<ExamPaperDetailShape> {
  assertManage(ctx);
  const p = await loadPaper(paperId);
  if (final) {
    p.status = "FINAL";
    p.finalizedBy = new Types.ObjectId(ctx.auth!.userId);
    p.finalizedAt = new Date();
  } else {
    p.status = p.reviewerUserId ? "IN_REVIEW" : "DRAFT";
    p.finalizedBy = null;
    p.finalizedAt = null;
  }
  await p.save();
  await writeAudit({
    eventKind: final ? "EXAM_PAPER_FINALIZED" : "EXAM_PAPER_REOPENED",
    actorId: ctx.auth!.userId,
    targetId: p._id,
    targetKind: "ExamPaperDraft",
    meta: { key: p.key },
  });
  return detailOf(ctx, p);
}

export interface ResolveSuggestionInput {
  accept: boolean;
  note?: string | null;
  /** Manager's own wording when accepting an EDIT / ADD (falls back to the proposal). */
  text?: string | null;
  answer?: string | null;
  options?: string[] | null;
}

export async function resolveExamPaperSuggestion(ctx: AppContext, suggestionId: string, input: ResolveSuggestionInput): Promise<ExamPaperDetailShape> {
  assertManage(ctx);
  if (!Types.ObjectId.isValid(suggestionId)) throw new Error(EXAM_PAPER_ERRORS_BN.noSuggestion);
  const s = await ExamPaperSuggestion.findById(suggestionId);
  if (!s) throw new Error(EXAM_PAPER_ERRORS_BN.noSuggestion);
  if (s.status !== "OPEN") throw new Error(EXAM_PAPER_ERRORS_BN.notOpen);
  const p = await loadPaper(s.paperId.toString());
  if (p.status === "FINAL") throw new Error(EXAM_PAPER_ERRORS_BN.final);
  const actor = new Types.ObjectId(ctx.auth!.userId);
  const now = new Date();
  if (input.accept) {
    const text = (input.text ?? s.proposedText ?? "").trim();
    const answer = input.answer !== undefined && input.answer !== null ? input.answer : s.proposedAnswer;
    const options = input.options ?? (s.proposedOptions?.length ? s.proposedOptions : null);
    if (s.kind === "EDIT" || s.kind === "DELETE") {
      const hit = findItem(p, s.itemKey ?? "");
      if (!hit) throw new Error(EXAM_PAPER_ERRORS_BN.noItem);
      const { item } = hit;
      if (s.kind === "DELETE") {
        item.removed = true;
      } else {
        item.history.push({ text: item.text, answer: item.answer ?? null, options: item.options ?? [], at: now, by: actor, suggestionId: s._id });
        if (text) item.text = text;
        if (answer !== null && answer !== undefined) item.answer = answer;
        if (options) item.options = options;
        // The wording changed: the old confirmation no longer speaks for it.
        item.syllabusConfirmedAt = null;
        item.syllabusConfirmedBy = null;
      }
    } else {
      const section = p.sections.find((x) => x.seq === s.sectionSeq);
      if (!section) throw new Error(EXAM_PAPER_ERRORS_BN.noSection);
      if (!text) throw new Error(EXAM_PAPER_ERRORS_BN.needText);
      let n = 1;
      const used = new Set(p.sections.flatMap((x) => x.items.map((i) => i.key)));
      while (used.has(`s${section.seq}-r${n}`)) n++;
      const key = `s${section.seq}-r${n}`;
      const newItem: IExamPaperItem = {
        key,
        text,
        options: options ?? [],
        answer: answer ?? null,
        marks: null,
        source: "REVIEWER",
        sourceRef: null,
        bookRef: null,
        needsPicture: false,
        note: s.reason ?? null,
        removed: false,
        syllabusConfirmedBy: null,
        syllabusConfirmedAt: null,
        history: [],
      };
      const after = s.itemKey ? section.items.findIndex((i) => i.key === s.itemKey) : -1;
      if (after >= 0) section.items.splice(after + 1, 0, newItem);
      else section.items.push(newItem);
      s.createdItemKey = key;
    }
    p.markModified("sections");
    await p.save();
  }
  s.status = input.accept ? "ACCEPTED" : "REJECTED";
  s.resolvedBy = actor;
  s.resolvedAt = now;
  s.resolutionNote = (input.note ?? "").trim() || null;
  await s.save();
  await writeAudit({
    eventKind: "EXAM_PAPER_SUGGESTION_RESOLVED",
    actorId: ctx.auth!.userId,
    targetId: s._id,
    targetKind: "ExamPaperSuggestion",
    meta: { paperId: String(p._id), kind: s.kind, itemKey: s.itemKey, accepted: input.accept },
  });
  return detailOf(ctx, p);
}

// ---------------------------------------------------------------------------
// Writes — reviewer (or manager)
// ---------------------------------------------------------------------------

export async function setExamItemSyllabusMatch(ctx: AppContext, paperId: string, itemKey: string, confirmed: boolean): Promise<ExamPaperDetailShape> {
  const p = await loadPaper(paperId);
  assertCanReview(ctx, p);
  const hit = findItem(p, itemKey);
  if (!hit || hit.item.removed) throw new Error(EXAM_PAPER_ERRORS_BN.noItem);
  hit.item.syllabusConfirmedAt = confirmed ? new Date() : null;
  hit.item.syllabusConfirmedBy = confirmed ? new Types.ObjectId(ctx.auth!.userId) : null;
  p.markModified("sections");
  await p.save();
  return detailOf(ctx, p);
}

/** Confirm every not-yet-confirmed item in one section (the reviewer read the whole section). */
export async function confirmExamSectionSyllabus(ctx: AppContext, paperId: string, sectionSeq: number): Promise<ExamPaperDetailShape> {
  const p = await loadPaper(paperId);
  assertCanReview(ctx, p);
  const section = p.sections.find((s) => s.seq === sectionSeq);
  if (!section) throw new Error(EXAM_PAPER_ERRORS_BN.noSection);
  const now = new Date();
  const by = new Types.ObjectId(ctx.auth!.userId);
  for (const i of section.items) {
    if (i.removed || i.syllabusConfirmedAt) continue;
    i.syllabusConfirmedAt = now;
    i.syllabusConfirmedBy = by;
  }
  p.markModified("sections");
  await p.save();
  return detailOf(ctx, p);
}

export interface SuggestInput {
  paperId: string;
  kind: string;
  sectionSeq: number;
  itemKey?: string | null;
  proposedText?: string | null;
  proposedAnswer?: string | null;
  proposedOptions?: string[] | null;
  reason?: string | null;
}

export async function suggestExamPaperChange(ctx: AppContext, input: SuggestInput): Promise<ExamPaperDetailShape> {
  const p = await loadPaper(input.paperId);
  assertCanReview(ctx, p);
  if (!(EXAM_SUGGESTION_KINDS as readonly string[]).includes(input.kind)) throw new Error(EXAM_PAPER_ERRORS_BN.badPayload);
  const kind = input.kind as ExamSuggestionKind;
  const text = (input.proposedText ?? "").trim() || null;
  const answer = (input.proposedAnswer ?? "").trim() || null;
  const options = (input.proposedOptions ?? []).map((o) => o.trim()).filter(Boolean);
  const reason = (input.reason ?? "").trim() || null;
  let sectionSeq = input.sectionSeq;
  if (kind === "EDIT" || kind === "DELETE") {
    const hit = findItem(p, input.itemKey ?? "");
    if (!hit || hit.item.removed) throw new Error(EXAM_PAPER_ERRORS_BN.noItem);
    sectionSeq = hit.section.seq;
    if (kind === "EDIT" && !text && !answer && !options.length) throw new Error(EXAM_PAPER_ERRORS_BN.needChange);
    if (kind === "DELETE" && !reason) throw new Error(EXAM_PAPER_ERRORS_BN.needReason);
  } else {
    if (!p.sections.some((s) => s.seq === sectionSeq)) throw new Error(EXAM_PAPER_ERRORS_BN.noSection);
    if (!text) throw new Error(EXAM_PAPER_ERRORS_BN.needText);
  }
  const s = await ExamPaperSuggestion.create({
    paperId: p._id,
    kind,
    sectionSeq,
    itemKey: input.itemKey ?? null,
    proposedText: text,
    proposedAnswer: answer,
    proposedOptions: options,
    reason,
    status: "OPEN",
    createdBy: new Types.ObjectId(ctx.auth!.userId),
  });
  await writeAudit({
    eventKind: "EXAM_PAPER_SUGGESTION_MADE",
    actorId: ctx.auth!.userId,
    targetId: s._id,
    targetKind: "ExamPaperSuggestion",
    meta: { paperId: String(p._id), kind, sectionSeq, itemKey: input.itemKey ?? null },
  });
  return detailOf(ctx, p);
}

export async function withdrawExamPaperSuggestion(ctx: AppContext, suggestionId: string): Promise<ExamPaperDetailShape> {
  if (!ctx.auth) throw new ForbiddenError(EXAM_PAPER_ERRORS_BN.forbidden);
  if (!Types.ObjectId.isValid(suggestionId)) throw new Error(EXAM_PAPER_ERRORS_BN.noSuggestion);
  const s = await ExamPaperSuggestion.findById(suggestionId);
  if (!s) throw new Error(EXAM_PAPER_ERRORS_BN.noSuggestion);
  if (s.createdBy.toString() !== ctx.auth.userId) throw new ForbiddenError(EXAM_PAPER_ERRORS_BN.notAuthor);
  if (s.status !== "OPEN") throw new Error(EXAM_PAPER_ERRORS_BN.notOpen);
  const p = await loadPaper(s.paperId.toString());
  assertCanReview(ctx, p);
  s.status = "WITHDRAWN";
  s.resolvedAt = new Date();
  s.resolvedBy = new Types.ObjectId(ctx.auth.userId);
  await s.save();
  return detailOf(ctx, p);
}

/** The reviewer says the review is done (they can still add suggestions until FINAL). */
export async function submitExamPaperReview(ctx: AppContext, paperId: string, summary?: string | null): Promise<ExamPaperDetailShape> {
  const p = await loadPaper(paperId);
  if (!isReviewer(ctx, p)) throw new ForbiddenError(EXAM_PAPER_ERRORS_BN.notReviewer);
  if (p.status === "FINAL") throw new Error(EXAM_PAPER_ERRORS_BN.final);
  p.status = "REVIEWED";
  p.reviewSubmittedAt = new Date();
  p.reviewSummary = (summary ?? "").trim() || null;
  await p.save();
  await writeAudit({
    eventKind: "EXAM_PAPER_REVIEW_SUBMITTED",
    actorId: ctx.auth!.userId,
    targetId: p._id,
    targetKind: "ExamPaperDraft",
    meta: { key: p.key },
  });
  return detailOf(ctx, p);
}
