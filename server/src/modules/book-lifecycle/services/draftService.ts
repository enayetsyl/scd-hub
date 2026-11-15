/**
 * The edit pipeline's core (docs/prd-book-lifecycle.md §12; D-#1601): every door — the AI job (Path A),
 * MCP (`start_book_edit` / `edit_chapter` / `put_chapter` / `submit_book_version`) and the bundle —
 * writes CHAPTERS into a `BookEditDraft`; the same validator runs; a person accepts chapter by chapter
 * in S11 (`acceptDraft`). Submitting never creates a version (VR-15).
 */
import { Types } from "mongoose";
import { randomBytes } from "crypto";
import { BOOK_EDIT_REASONS, BOOK_LC_LIMITS, type BookEditDraftSource } from "@scd/shared";
import type { AuthPayload } from "../../../context";
import { BookEditDraft, type DraftChapter, type DraftFinding, type IBookEditDraft } from "../models/BookEditDraft";
import { BookFeedback, BookInstruction, BookDecision, type IBookFeedback } from "../models/BookFeedback";
import type { BookChange } from "../models/BookVersion";
import { takeCounter } from "../models/SchoolBook";
import { requireBookLc, uid, oid } from "./access";
import { BookLcError } from "./errors";
import { lcEvent } from "./events";
import { chapterTextsBySha, loadBook, loadVersion, putChapterTexts, versionChapters, vlabel } from "./store";
import { activeRuleSetsFor } from "./feedbackService";
import { applyOps, ChapterEditSchema, ChangeListRowSchema, schemaFindings, type ChangeListRow } from "./editOps";
import { coverageFindings, validateChapter, type ValidationContext } from "./validator";
import { assertDraftBaseFresh, assertNoLiveJob, loadDraft, resolveRefs } from "./versionService";
import { methodText } from "./method";
import { sha256 } from "./markdown";
import { writeAudit } from "../../platform/services/AuditService";

const OPEN = ["open", "submitted", "ready"];

export interface OpenDraftInput {
  source: Exclude<BookEditDraftSource, "upload">;
  baseVersion?: string | null;
  /** Item ids or codes (F-n). */
  feedback?: string[] | null;
  instructionIds?: string[] | null;
  instructions?: { text: string; needsReview?: boolean | null }[] | null;
  scopeChapterKeys?: string[] | null;
  purposeBn?: string | null;
  origin?: "app" | "claude";
  jobId?: Types.ObjectId;
}

export async function openEditDraft(auth: AuthPayload, bookId: string, input: OpenDraftInput): Promise<IBookEditDraft> {
  requireBookLc(auth, "manage");
  const book = await loadBook(bookId);
  if (!book.latestVersionId) throw new BookLcError("NO_VERSION", "এই বইয়ের কোনো সংস্করণ নেই");
  const base = await loadVersion(book.latestVersionId);
  if (input.baseVersion && input.baseVersion.replace(/^v?/, "v") !== vlabel(base) && input.baseVersion !== base._id.toString()) {
    throw new BookLcError("VR-1", `ভিত্তি হতে হবে সর্বশেষ সংস্করণ ${vlabel(base)} (VR-1)`);
  }
  const wanted = input.feedback ?? [];
  if (wanted.length > 200) throw new BookLcError("LIMIT", "সর্বোচ্চ ২০০টি মতামত");
  if ((input.instructions ?? []).length > 20) throw new BookLcError("LIMIT", "সর্বোচ্চ ২০টি নির্দেশনা");
  const ids = wanted.filter((x) => Types.ObjectId.isValid(x) && !/^F-/.test(x));
  const codes = wanted.filter((x) => /^F-\d+$/.test(x));
  const items = await BookFeedback.find({ bookId: book._id, $or: [{ _id: { $in: ids.map((i) => new Types.ObjectId(i)) } }, { code: { $in: codes } }] });
  if (items.length !== wanted.length) throw new BookLcError("NO_ITEM", "কিছু মতামত এই বইয়ে পাওয়া যায়নি");
  const dead = items.filter((i) => i.status === "rejected" || i.status === "duplicate");
  if (dead.length) throw new BookLcError("VR-3", `বাতিল/একই মতামত দেওয়া যায় না: ${dead.map((d) => d.code).join(", ")}`);
  const instr = input.instructionIds?.length ? await BookInstruction.find({ bookId: book._id, _id: { $in: input.instructionIds.map((i) => oid(i)) } }) : [];
  for (const t of input.instructions ?? []) {
    const text = t.text?.normalize("NFC").trim();
    if (!text) continue;
    if (text.length > 4000) throw new BookLcError("LONG", "নির্দেশনা ৪,০০০ অক্ষরের মধ্যে");
    const n = await takeCounter(book._id, "nextInstructionNo");
    instr.push(await BookInstruction.create({ bookId: book._id, code: `I-${n}`, textBn: text, needsReview: t.needsReview ?? true, createdBy: uid(auth) }));
  }
  const keys = new Set(base.chapters.map((c) => c.key));
  const scope = (input.scopeChapterKeys ?? []).filter(Boolean);
  for (const k of scope) if (!keys.has(k)) throw new BookLcError("BAD_CHAPTER", `অধ্যায় ${k} নেই`);
  const m = methodText();
  const draft = await BookEditDraft.create({
    bookId: book._id,
    baseVersionId: base._id,
    baseMasterHash: base.masterHash,
    source: input.source,
    status: "open",
    feedbackIds: items.map((i) => i._id),
    instructionIds: instr.map((i) => i._id),
    decisionIds: [],
    scopeChapterKeys: scope,
    chapters: [...base.chapters].sort((a, b) => a.order - b.order).map((c) => ({ key: c.key, title: c.title, order: c.order, baseSha: c.textSha256, status: "pending", opsCount: 0, findings: [], notApplied: [], alsoElsewhere: [], unexplained: [] })),
    methodVersion: m.version,
    methodHash: m.hash,
    bundleNonce: input.source === "bundle" ? randomBytes(12).toString("hex") : undefined,
    jobId: input.jobId,
    purposeBn: input.purposeBn?.slice(0, 1000),
    createdBy: uid(auth),
    origin: input.origin ?? "app",
  });
  await BookInstruction.updateMany({ _id: { $in: instr.map((i) => i._id) } }, { $addToSet: { usedInDraftIds: draft._id } });
  await lcEvent({ bookId: book._id, kind: "DRAFT_OPENED", actorId: uid(auth), origin: input.origin, summary: `${input.source} draft on ${vlabel(base)} (${items.length} items, ${instr.length} instructions)`, refs: { draftId: draft._id, versionId: base._id } });
  return draft;
}

/** Everything the validator needs about a draft. */
export async function validationContext(draft: IBookEditDraft): Promise<ValidationContext & { items: IBookFeedback[] }> {
  const book = await loadBook(draft.bookId);
  const base = await loadVersion(draft.baseVersionId);
  const [items, instructions, decisions, ruleSets] = await Promise.all([
    BookFeedback.find({ _id: { $in: draft.feedbackIds } }),
    BookInstruction.find({ _id: { $in: draft.instructionIds } }),
    BookDecision.find({ bookId: book._id, status: "ruled" }),
    activeRuleSetsFor(book),
  ]);
  return { draft, items, instructions, decisions, ruleSets, headingLevel: book.chapterHeadingLevel, mediaPaths: new Set([...base.media.map((m) => m.path), ...draft.media.map((m) => m.path)]) };
}

async function baseText(draft: IBookEditDraft, key: string): Promise<{ chapter: DraftChapter; text: string }> {
  const chapter = draft.chapters.find((c) => c.key === key);
  if (!chapter) throw new BookLcError("BAD_CHAPTER", `অধ্যায় ${key} এই খসড়ায় নেই`);
  if (!chapter.baseSha) throw new BookLcError("BAD_CHAPTER", `${key}: নতুন অধ্যায় — পুরো লেখা দিন`);
  const t = await chapterTextsBySha([chapter.baseSha]);
  return { chapter, text: t.get(chapter.baseSha) ?? "" };
}

async function openDraftFor(auth: AuthPayload, draftId: string): Promise<IBookEditDraft> {
  requireBookLc(auth, "manage");
  const draft = await loadDraft(draftId);
  if (!OPEN.includes(draft.status)) throw new BookLcError("DRAFT_CLOSED", "খসড়াটি আর খোলা নেই");
  await assertDraftBaseFresh(draft);
  return draft;
}

const routeCache = new Map<string, Awaited<ReturnType<typeof resolveRefs>>>();
async function routeOf(bookId: Types.ObjectId, refs: string[]) {
  const k = `${bookId}:${[...refs].sort().join(",")}`;
  if (!routeCache.has(k)) routeCache.set(k, await resolveRefs(bookId, refs));
  return routeCache.get(k)!;
}

function setFindings(ch: DraftChapter, findings: DraftFinding[]): void {
  ch.findings = findings;
  ch.status = findings.some((f) => f.level === "blocking") ? "failed" : ch.status;
}

export interface ChapterEditResult {
  appliedOps: number;
  findings: DraftFinding[];
  newSha: string | null;
  status: string;
}

/**
 * Apply one `book-chapter-edit/v1` object to its chapter (always against the BASE text, so a
 * re-edit replaces the chapter's earlier edit). VR-2 schema, VR-1 baseSha, VR-4 ops, then the
 * chapter-level validator. Blocking findings mark the chapter `failed` (it cannot be accepted).
 */
export async function applyChapterEdit(auth: AuthPayload, draftId: string, edit: unknown, origin: "app" | "claude" | "ai_job" = "app"): Promise<ChapterEditResult> {
  const draft = await openDraftFor(auth, draftId);
  // The AI job writes its own draft; a person (app / MCP) waits for it or stops it first.
  if (origin !== "ai_job") await assertNoLiveJob(draft._id);
  routeCache.clear();
  const parsed = ChapterEditSchema.safeParse(edit);
  const key = (edit as { chapter?: unknown })?.chapter;
  if (!parsed.success) {
    const findings = schemaFindings(parsed.error);
    const ch = typeof key === "string" ? draft.chapters.find((c) => c.key === key) : undefined;
    if (ch) {
      ch.status = "failed";
      ch.findings = findings;
      await draft.save();
    }
    return { appliedOps: 0, findings, newSha: null, status: "failed" };
  }
  const e = parsed.data;
  if (e.draft !== draft._id.toString() && e.draft !== draft.bundleNonce) {
    return { appliedOps: 0, findings: [{ code: "VR-2", level: "blocking", messageBn: `${BOOK_EDIT_REASONS.VR2_SCHEMA}: draft` }], newSha: null, status: "failed" };
  }
  const { chapter, text } = await baseText(draft, e.chapter);
  if (e.baseSha !== chapter.baseSha) {
    chapter.status = "failed";
    chapter.findings = [{ code: "VR-1", level: "blocking", messageBn: `${e.chapter}: ${BOOK_EDIT_REASONS.VR1_BASE_SHA}` }];
    await draft.save();
    return { appliedOps: 0, findings: chapter.findings, newSha: null, status: "failed" };
  }
  const res = applyOps(text, e.ops);
  const ctx = await validationContext(draft);
  const v = validateChapter(ctx, { key: e.chapter, base: text, next: res.text, mode: "ops", applied: res.applied, changes: [] });
  const sacredOps = new Set(v.sacredRows);
  const findings: DraftFinding[] = [...res.findings.map((f) => ({ ...f, messageBn: `${e.chapter}: ${f.messageBn}` })), ...v.findings];
  const [newSha] = await putChapterTexts([res.text]);
  const changes: BookChange[] = [];
  for (const [pos, a] of res.applied.entries()) {
    const r = await routeOf(draft.bookId, a.op.refs);
    changes.push({
      chapterKey: e.chapter,
      where: chapter.title.slice(0, 200),
      beforeExcerpt: (a.removed || (a.op.op === "insert_after" ? a.op.anchor : "")).slice(0, 300),
      afterExcerpt: a.inserted.slice(0, 300),
      reason: (a.op.reasonBn ?? "").slice(0, 500),
      refs: a.op.refs,
      route: r.route,
      sacred: a.sacred || sacredOps.has(pos + 1) || r.sacred || undefined,
    });
  }
  chapter.newSha = newSha;
  chapter.mode = "ops";
  chapter.opsCount = res.applied.length;
  chapter.status = newSha === chapter.baseSha ? "unchanged" : "edited";
  chapter.notApplied = (e.notApplied ?? []).map((n) => ({ ref: n.ref, reasonBn: n.reasonBn }));
  chapter.alsoElsewhere = (e.alsoElsewhere ?? []).map((n) => ({ ref: n.ref, hintBn: n.hintBn }));
  chapter.unexplained = [];
  chapter.sacredTouched = v.sacredTouched;
  chapter.decidedBy = undefined;
  chapter.decidedAt = undefined;
  setFindings(chapter, findings);
  draft.changes = [...draft.changes.filter((c) => c.chapterKey !== e.chapter), ...changes];
  if (draft.status === "ready") draft.status = "open";
  draft.markModified("chapters");
  await draft.save();
  await lcEvent({ bookId: draft.bookId, kind: "DRAFT_CHAPTER", actorId: uid(auth), origin, summary: `${e.chapter}: ${res.applied.length} ops, ${findings.filter((f) => f.level === "blocking").length} blocking`, refs: { draftId: draft._id } });
  return { appliedOps: res.applied.length, findings, newSha, status: chapter.status };
}

/** A whole-text replacement with its change list (`book-change-list/v1`); VR-7 coverage. */
export async function putChapter(auth: AuthPayload, draftId: string, key: string, markdown: string, changesIn: unknown[], origin: "app" | "claude" | "ai_job" = "app"): Promise<{ findings: DraftFinding[]; unexplained: number; newSha: string; status: string }> {
  const draft = await openDraftFor(auth, draftId);
  if (origin !== "ai_job") await assertNoLiveJob(draft._id);
  routeCache.clear();
  const rows: ChangeListRow[] = [];
  const schemaErr: DraftFinding[] = [];
  for (const r of changesIn ?? []) {
    const p = ChangeListRowSchema.safeParse(r);
    if (p.success) rows.push(p.data);
    else schemaErr.push(...schemaFindings(p.error));
  }
  if (markdown.length > BOOK_LC_LIMITS.chapterChars) throw new BookLcError("VR-11", `${key}: ${BOOK_EDIT_REASONS.VR11_MAX}`);
  const next = markdown.replace(/\r\n/g, "\n").normalize("NFC");
  const { chapter, text } = await baseText(draft, key);
  const ctx = await validationContext(draft);
  const mine = rows.filter((r) => r.chapterKey === key);
  const v = validateChapter(ctx, { key, base: text, next, mode: "whole", changes: mine });
  const [newSha] = await putChapterTexts([next]);
  const changes: BookChange[] = [];
  const sacredRows = new Set(v.sacredRows);
  for (const [pos, r] of mine.entries()) {
    const route = await routeOf(draft.bookId, r.refs);
    // A row that covers a hunk touching sacred text is flagged, so the next memo shows it.
    changes.push({ chapterKey: key, where: r.where ?? chapter.title, page: r.page, beforeExcerpt: r.beforeExcerpt, afterExcerpt: r.afterExcerpt, reason: r.reason ?? "", refs: r.refs, route: route.route, sacred: route.sacred || sacredRows.has(pos + 1) || undefined });
  }
  chapter.newSha = newSha;
  chapter.mode = "whole";
  chapter.opsCount = 0;
  chapter.status = newSha === chapter.baseSha ? "unchanged" : "edited";
  chapter.unexplained = v.unexplained;
  chapter.sacredTouched = v.sacredTouched;
  chapter.decidedBy = undefined;
  chapter.decidedAt = undefined;
  setFindings(chapter, [...schemaErr, ...v.findings]);
  draft.changes = [...draft.changes.filter((c) => c.chapterKey !== key), ...changes];
  if (draft.status === "ready") draft.status = "open";
  draft.markModified("chapters");
  await draft.save();
  await lcEvent({ bookId: draft.bookId, kind: "DRAFT_CHAPTER", actorId: uid(auth), origin, summary: `${key}: whole text, ${v.unexplained.length} unexplained`, refs: { draftId: draft._id } });
  return { findings: chapter.findings, unexplained: v.unexplained.length, newSha, status: chapter.status };
}

/**
 * submit_book_version / the bundle's last step: draft-level validation (VR-1, VR-14) + every
 * chapter's blocking findings. Returns `ready` or `refused`; NEVER creates a version (VR-15).
 */
export async function submitDraft(auth: AuthPayload, draftId: string, input: { summaryBn?: string | null; bump?: "minor" | "major" | null }, origin: "app" | "claude" = "app"): Promise<{ status: "ready" | "refused"; blocking: DraftFinding[]; warnings: DraftFinding[] }> {
  requireBookLc(auth, "manage");
  const draft = await loadDraft(draftId);
  // A stale draft may still be submitted: the answer is `refused` with VR-1, so the caller learns why.
  if (!OPEN.includes(draft.status) && draft.status !== "stale") throw new BookLcError("DRAFT_CLOSED", "খসড়াটি আর খোলা নেই");
  const blocking: DraftFinding[] = [];
  const warnings: DraftFinding[] = [];
  try {
    await assertDraftBaseFresh(draft);
  } catch (e) {
    blocking.push({ code: "VR-1", level: "blocking", messageBn: (e as Error).message });
  }
  for (const c of draft.chapters) for (const f of c.findings) (f.level === "blocking" ? blocking : warnings).push(f);
  const ctx = await validationContext(draft);
  const cited = new Set(draft.changes.flatMap((c) => c.refs));
  const notApplied = new Set(draft.chapters.flatMap((c) => c.notApplied.map((n) => n.ref)));
  warnings.push(...coverageFindings(ctx, cited, notApplied));
  if (!draft.chapters.some((c) => c.status === "edited")) blocking.push({ code: "VR-15", level: "blocking", messageBn: "কোনো অধ্যায়ে পরিবর্তন নেই" });
  const status = blocking.length ? "refused" : "ready";
  const fresh = await BookEditDraft.findById(draft._id);
  if (!fresh) throw new BookLcError("NO_DRAFT", "খসড়া পাওয়া যায়নি");
  fresh.validatorReport = { blocking, warnings, at: new Date() };
  if (input.summaryBn) fresh.summaryBn = input.summaryBn.slice(0, 2000);
  if (input.bump) fresh.bump = input.bump;
  fresh.submittedBy = uid(auth);
  if (fresh.status !== "stale") fresh.status = status === "ready" ? "ready" : "submitted";
  await fresh.save();
  await lcEvent({ bookId: draft.bookId, kind: "DRAFT_SUBMITTED", actorId: uid(auth), origin, summary: `draft submitted: ${status} (${blocking.length} blocking, ${warnings.length} warnings)`, refs: { draftId: draft._id } });
  return { status, blocking, warnings };
}

/** VR-7: a finalize holder ticks an unexplained hunk "আমি দেখেছি" (stamped). */
export async function ackUnexplained(auth: AuthPayload, draftId: string, key: string, index: number, runHash?: string | null): Promise<IBookEditDraft> {
  requireBookLc(auth, "finalize");
  const draft = await loadDraft(draftId);
  if (!OPEN.includes(draft.status)) throw new BookLcError("DRAFT_CLOSED", "খসড়াটি আর খোলা নেই");
  const ch = draft.chapters.find((c) => c.key === key);
  const u = ch?.unexplained.find((x) => x.index === index);
  if (!ch || !u) throw new BookLcError("NO_HUNK", "পরিবর্তনটি পাওয়া যায়নি");
  // The tick is for the run the person SAW: a re-edit that reorders the list cannot move it to another run.
  if (runHash && u.runHash !== runHash) throw new BookLcError("CHANGED", "পরিবর্তনটি বদলে গেছে — আবার দেখে টিক দিন");
  u.ack = { by: uid(auth), at: new Date() };
  draft.markModified("chapters");
  await draft.save();
  await lcEvent({ bookId: draft.bookId, kind: "DRAFT_CHAPTER", actorId: uid(auth), summary: `${key}: unexplained run ${u.runHash ?? index} seen`, refs: { draftId: draft._id } });
  const book = await loadBook(draft.bookId);
  await writeAudit({ eventKind: "BOOK_LC_FINALIZED", actorId: auth.userId, actorRole: auth.role, targetKind: "BookEditDraft", targetId: draft._id.toString(), meta: { action: "ack_unexplained", bookCode: book.code, chapter: key, run: u.runHash ?? String(index) } });
  return draft;
}

/* The accept-time guard (no blocking finding, no unseen unexplained change) is built into acceptDraft itself. */

export function draftMasterHashOf(texts: string[]): string {
  return sha256(texts.join(""));
}

export async function draftChapterText(draft: IBookEditDraft, key: string): Promise<string | null> {
  const ch = draft.chapters.find((c) => c.key === key);
  const sha = ch?.newSha ?? ch?.baseSha;
  if (!sha) return null;
  return (await chapterTextsBySha([sha])).get(sha) ?? null;
}

export { versionChapters };
