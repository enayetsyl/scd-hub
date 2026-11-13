/**
 * Path A — the AI edit job (docs/prd-book-lifecycle.md §14; owner Q9, D-#1603).
 *
 *  - feature `book_edit` (OFF at ship): Claude Opus 5.5 by default; $10 a month, $3 per job (cap);
 *  - S10 asks for an ESTIMATE first (`previewEditJob`, nothing written); starting opens a `BookEditDraft`
 *    (source ai_job) and a `BookEditJob` that PINS provider + model; every call passes the pinned model
 *    as `modelOverride` on a route with NO fallback (a configured fallback is ignored — no
 *    cross-provider switch inside a job);
 *  - the AI worker takes chapters one at a time, in reading order (keeps the prefix cache warm);
 *    a chapter over the part limit goes in parts, whose ops are applied to the chapter together;
 *  - each answer is `book-chapter-edit/v1`, validated and applied into the draft; blocking findings go
 *    back to the model (≤ 2 fix rounds), then the chapter fails; a provider error retries the SAME
 *    provider twice with backoff, then the chapter fails;
 *  - the job stops as `partial` before a call whose estimate would pass the cap, `stopped` when the
 *    feature is switched off or the person stops it, `stale_base` when a new version appears;
 *  - prompt (cache-ordered): stablePrefix = the method's common sections + book header + active rule
 *    sets (key order) + ruled decision log (code order); context = instructions + items anchored to no
 *    chapter; variablePart = the chapter (key, baseSha, text), its items and the method's output
 *    contract. Feedback text is de-identified per item (fail-closed);
 *  - logging: one `AiUsage` row per attempt; one `AiExchange` row per call with `deidentified: false`
 *    and `prefixRef` (method + rules + decisions hashes). The request/reply TEXT is replaced by a
 *    hashed reference to the job + chapter: book text stays in the book plane (D-#1631);
 *  - BOOK_EDIT_READY to the starter when the job ends. Nothing applies by itself (VR-15).
 */
import { createHash } from "crypto";
import { Types } from "mongoose";
import { callerHasPermission } from "@scd/shared";
import type { AuthPayload } from "../../../context";
import { BookEditJob, type IBookEditJob } from "../models/BookEditJob";
import { BookEditDraft } from "../models/BookEditDraft";
import { BookFeedback, BookInstruction, BookDecision } from "../models/BookFeedback";
import { SchoolBook } from "../models/SchoolBook";
import { requireBookLc, uid } from "./access";
import { BookLcError } from "./errors";
import { lcEvent } from "./events";
import { loadBook, loadVersion, versionChapters } from "./store";
import { activeRuleSetsFor } from "./feedbackService";
import { applyChapterEdit, openEditDraft } from "./draftService";
import { assertDraftBaseFresh } from "./versionService";
import { apiMethodParts, methodText } from "./method";
import { chapterParts, sha256 } from "./markdown";
import { deidentifiedItems, extractJson } from "./bundle";
import { activeAuthOf } from "./names";
import { aiSend, AiFeatureOffError, defaultLedger, type AiLedger, type AiSendOutcome } from "../../platform/ai/aiRouter";
import { aiRouteFor } from "../../platform/services/AiSettingService";
import { providerOfModel, WORKSPACE_MODELS } from "../../platform/ai/models";
import { priceOf, costUsd } from "../../platform/ai/aiPrices";
import { emit } from "../../notifications/services/NotificationService";

export const BOOK_EDIT_FEATURE = "book_edit";
export const JOB_CAP_DEFAULT_USD = 3;
export const STALE_MS = 20 * 60 * 1000;
export const LARGE_UNITS = 60;
const OUTPUT_TOKENS = 16_000;
const EXPECTED_OUT = 2_500;
const UNIT_OVERHEAD_TOKENS = 600;
const MAX_FIXES = 2;
const RETRIES = 2;
const RUNNING_JOB = ["queued", "running"];

/** ≈ tokens (the workspace estimator's rule of thumb: Bangla ~2 chars/token, Latin ~4). */
export function estimateTokens(text: string): number {
  let bn = 0;
  for (const ch of text) if (/[ঀ-৿]/.test(ch)) bn++;
  return Math.ceil(bn / 2 + (text.length - bn) / 4);
}

export interface JobDeps {
  /** Passed to aiSend (tests: a scripted fake provider, a route, a ledger). The job wraps the route
   *  so it never has a fallback, and the ledger so the exchange row holds no book text. */
  ai?: Parameters<typeof aiSend>[3];
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export interface StartJobInput {
  /** Item ids or codes (F-n). */
  feedback?: string[] | null;
  instructions?: { text: string; needsReview?: boolean | null }[] | null;
  instructionIds?: string[] | null;
  scopeChapterKeys?: string[] | null;
  model?: string | null;
  reasoning?: "off" | "low" | "high" | null;
  capUsd?: number | null;
  /** Needed when the estimate passes the cap or the job has more than 60 parts. */
  confirmLarge?: boolean | null;
}

/** What a job works from — a draft's fields, or (for the S10 estimate) the same built in memory. */
interface Plan {
  bookId: Types.ObjectId;
  baseVersionId: Types.ObjectId;
  feedbackIds: Types.ObjectId[];
  instructions: { code: string; textBn: string }[];
  scopeChapterKeys: string[];
}

interface Unit {
  key: string;
  parts: { key: string; text: string }[];
}

async function planOfDraft(draftId: Types.ObjectId): Promise<Plan> {
  const d = await BookEditDraft.findById(draftId);
  if (!d) throw new BookLcError("NO_DRAFT", "খসড়া পাওয়া যায়নি");
  const instr = await BookInstruction.find({ _id: { $in: d.instructionIds } }).sort({ createdAt: 1 }).lean();
  return { bookId: d.bookId, baseVersionId: d.baseVersionId, feedbackIds: d.feedbackIds, instructions: instr.map((i) => ({ code: i.code, textBn: i.textBn })), scopeChapterKeys: d.scopeChapterKeys };
}

/** Chapters the job touches (S10 "auto"): scope if given; else the chapters the items anchor, or
 *  every chapter when an instruction or an unanchored item is global. */
async function unitsFor(plan: Plan): Promise<Unit[]> {
  const book = await loadBook(plan.bookId);
  const chapters = await versionChapters(await loadVersion(plan.baseVersionId));
  const items = await BookFeedback.find({ _id: { $in: plan.feedbackIds } }).select("anchor").lean();
  let keys: Set<string>;
  if (plan.scopeChapterKeys.length) keys = new Set(plan.scopeChapterKeys);
  else if (plan.instructions.length || items.some((i) => !i.anchor?.chapterKey)) keys = new Set(chapters.map((c) => c.key));
  else keys = new Set(items.map((i) => i.anchor!.chapterKey!));
  return chapters.filter((c) => keys.has(c.key) && c.text.trim()).map((c) => ({ key: c.key, parts: chapterParts(c.key, c.text, book.chapterHeadingLevel) }));
}

interface Prompt {
  stablePrefix: string;
  context: string;
  prefixRef: string;
  itemsByChapter: Map<string, string>;
  excluded: { code: string; reasonBn: string }[];
}

async function promptOf(plan: Plan): Promise<Prompt> {
  const book = await loadBook(plan.bookId);
  const { common } = apiMethodParts();
  const rules = await activeRuleSetsFor(book);
  const decisions = await BookDecision.find({ bookId: book._id, status: "ruled" }).sort({ code: 1 }).lean();
  const header = `# BOOK\ncode: ${book.code}\nclass: ${book.classLevel}\nsubject: ${book.subject}\ntitle: ${book.titleBn}\n`;
  const rulesText = rules.map((r) => `# RULES ${r.key} v${r.version}\n${r.bodyMarkdown}\n`).join("\n");
  const ruling = (d: (typeof decisions)[number]) => {
    const opt = d.ruling?.optionKey ? `${d.ruling.optionKey}) ${d.options.find((o) => o.key === d.ruling?.optionKey)?.textBn ?? ""}` : "";
    return `${d.code}: ${d.questionBn} → ${opt}${d.ruling?.textBn ? ` — ${d.ruling.textBn}` : ""}`;
  };
  const decText = `# RULED DECISIONS\n${decisions.map(ruling).join("\n")}\n`;
  const stablePrefix = `${common}\n${header}\n${rulesText}\n${decText}`;
  const items = await BookFeedback.find({ _id: { $in: plan.feedbackIds } }).sort({ createdAt: 1 });
  const { kept, excluded } = await deidentifiedItems(items);
  const line = (k: (typeof kept)[number]) => {
    const ruled = k.item.reviewerRuling?.verdict ? `; ruled ${k.item.reviewerRuling.verdict}${k.item.reviewerRuling.noteBn ? `: ${k.item.reviewerRuling.noteBn}` : ""}` : "";
    return `- ${k.item.code} [${k.item.category}${ruled}] ${k.item.anchor?.where ? `(${k.item.anchor.where}) ` : ""}${k.quote ? `quote «${k.quote}» — ` : ""}${k.textBn}`;
  };
  const global = kept.filter((k) => !k.item.anchor?.chapterKey);
  const context = `# INSTRUCTIONS\n${plan.instructions.map((i) => `- ${i.code}: ${i.textBn}`).join("\n") || "-"}\n\n# FEEDBACK FOR THE WHOLE BOOK\n${global.map(line).join("\n") || "-"}\n`;
  const itemsByChapter = new Map<string, string>();
  for (const k of kept.filter((x) => x.item.anchor?.chapterKey)) {
    const key = k.item.anchor!.chapterKey!;
    itemsByChapter.set(key, `${itemsByChapter.get(key) ?? ""}${line(k)}\n`);
  }
  const prefixRef = `method:${methodText().hash.slice(0, 16)}|rules:${sha256(rulesText).slice(0, 16)}|decisions:${sha256(decText).slice(0, 16)}`;
  return { stablePrefix, context, prefixRef, itemsByChapter, excluded };
}

export interface JobEstimate {
  chapters: number;
  units: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  /** Items left out of the prompt because they name a child or guardian (fail-closed, §9.6). */
  leftOut: { code: string; reasonBn: string }[];
}

/** Pre-flight estimate (§14.1): tokens and dollars for the model; the first unit writes the cache. */
async function estimatePlan(plan: Plan, model: string): Promise<JobEstimate> {
  const units = await unitsFor(plan);
  const p = await promptOf(plan);
  const provider = providerOfModel(model) ?? "anthropic";
  const price = priceOf(provider, model);
  const prefix = estimateTokens(p.stablePrefix) + estimateTokens(p.context);
  let usd = 0;
  let inputTokens = 0;
  let n = 0;
  for (const u of units) {
    for (const part of u.parts) {
      const own = estimateTokens(part.text) + estimateTokens(p.itemsByChapter.get(u.key) ?? "") + UNIT_OVERHEAD_TOKENS;
      const hit = n === 0 ? 0 : prefix;
      const miss = n === 0 ? prefix + own : own;
      usd += (hit * price.cacheHit + miss * price.cacheMiss + EXPECTED_OUT * price.output) / 1_000_000;
      inputTokens += hit + miss;
      n++;
    }
  }
  return { chapters: units.length, units: n, inputTokens, outputTokens: n * EXPECTED_OUT, usd: Math.round(usd * 10_000) / 10_000, leftOut: p.excluded };
}

function checkModelAndCap(auth: AuthPayload, model: string, capIn?: number | null): { cap: number } {
  if (!WORKSPACE_MODELS.includes(model) || !providerOfModel(model)) throw new BookLcError("BAD_MODEL", "এই মডেল চলে না");
  const cap = capIn ?? JOB_CAP_DEFAULT_USD;
  if (!(cap > 0)) throw new BookLcError("BAD_CAP", "খরচের সীমা ০-এর বেশি হতে হবে");
  if (cap > JOB_CAP_DEFAULT_USD && !callerHasPermission(auth, "system_health:ai_key")) throw new BookLcError("CAP_RAISE", `$${JOB_CAP_DEFAULT_USD}-এর বেশি সীমা শুধু এআই চাবির দায়িত্বপ্রাপ্ত ব্যক্তি দিতে পারেন`);
  return { cap };
}

/** S10 "সব অধ্যায়" arrives as "*": every chapter of the latest version. */
async function expandScope(bookId: Types.ObjectId, keys: string[] | null | undefined): Promise<string[]> {
  const list = (keys ?? []).filter(Boolean);
  if (!list.includes("*")) return list;
  const book = await loadBook(bookId);
  if (!book.latestVersionId) return [];
  return (await loadVersion(book.latestVersionId)).chapters.map((c) => c.key);
}

/** S10 estimate: the plan built in memory from the choices — NOTHING is written. */
export async function previewEditJob(auth: AuthPayload, bookId: string, input: StartJobInput): Promise<JobEstimate & { model: string; capUsd: number; large: boolean }> {
  requireBookLc(auth, "ai_edit");
  requireBookLc(auth, "manage");
  const route = await aiRouteFor(BOOK_EDIT_FEATURE);
  if (!route.enabled) throw new AiFeatureOffError(BOOK_EDIT_FEATURE);
  const model = input.model ?? route.primary.model;
  const { cap } = checkModelAndCap(auth, model, input.capUsd);
  const book = await loadBook(bookId);
  if (!book.latestVersionId) throw new BookLcError("NO_VERSION", "এই বইয়ের কোনো সংস্করণ নেই");
  const wanted = input.feedback ?? [];
  const ids = wanted.filter((x) => Types.ObjectId.isValid(x) && !/^F-/.test(x)).map((x) => new Types.ObjectId(x));
  const codes = wanted.filter((x) => /^F-\d+$/.test(x));
  const items = wanted.length ? await BookFeedback.find({ bookId: book._id, $or: [{ _id: { $in: ids } }, { code: { $in: codes } }] }).select("_id").lean() : [];
  const saved = input.instructionIds?.length ? await BookInstruction.find({ bookId: book._id, _id: { $in: input.instructionIds.filter((i) => Types.ObjectId.isValid(i)) } }).lean() : [];
  const typed = (input.instructions ?? []).map((t) => t.text?.normalize("NFC").trim()).filter(Boolean) as string[];
  const plan: Plan = {
    bookId: book._id,
    baseVersionId: book.latestVersionId,
    feedbackIds: items.map((i) => i._id),
    instructions: [...saved.map((i) => ({ code: i.code, textBn: i.textBn })), ...typed.map((t, n) => ({ code: `I-new${n + 1}`, textBn: t }))],
    scopeChapterKeys: await expandScope(book._id, input.scopeChapterKeys),
  };
  const est = await estimatePlan(plan, model);
  return { ...est, model, capUsd: cap, large: est.units > LARGE_UNITS || est.usd > cap };
}

export async function startEditJob(auth: AuthPayload, bookId: string, input: StartJobInput): Promise<{ job: IBookEditJob; estimate: JobEstimate }> {
  const pre = await previewEditJob(auth, bookId, input);
  if (pre.large && !input.confirmLarge) throw new BookLcError("CONFIRM_LARGE", `বড় কাজ: ${pre.units}টি অংশ, আনুমানিক $${pre.usd} (সীমা $${pre.capUsd}) — আবার নিশ্চিত করুন`);
  const book = await loadBook(bookId);
  const draft = await openEditDraft(auth, bookId, { source: "ai_job", feedback: input.feedback, instructions: input.instructions, instructionIds: input.instructionIds, scopeChapterKeys: await expandScope(book._id, input.scopeChapterKeys) });
  const plan = await planOfDraft(draft._id);
  const units = await unitsFor(plan);
  const estimate = await estimatePlan(plan, pre.model);
  const job = await BookEditJob.create({
    bookId: draft.bookId,
    draftId: draft._id,
    provider: providerOfModel(pre.model)!,
    modelName: pre.model,
    reasoning: input.reasoning ?? "low",
    status: "queued",
    chapters: units.map((u) => ({ key: u.key, status: "queued", attempts: 0, fixes: 0, costUsd: 0, cacheHitTokens: 0, cacheMissTokens: 0, outputTokens: 0 })),
    capUsd: pre.capUsd,
    estimateUsd: estimate.usd,
    spentUsd: 0,
    leftOut: estimate.leftOut,
    startedBy: uid(auth),
  });
  await BookEditDraft.updateOne({ _id: draft._id }, { $set: { jobId: job._id } });
  await lcEvent({ bookId: draft.bookId, kind: "JOB_STARTED", actorId: uid(auth), summary: `AI edit job: ${units.length} chapters, ${pre.model}, cap $${pre.capUsd}, est $${estimate.usd}`, refs: { jobId: job._id, draftId: draft._id } });
  return { job, estimate };
}

/** §14.1 step 5: the failed chapters of a finished job run again as a NEW job on the SAME draft (still open,
 *  base still the latest). Same pinned model; the cap and the large-job confirm as for a new job. */
export async function rerunFailedChapters(auth: AuthPayload, jobId: string, input: { capUsd?: number | null; confirmLarge?: boolean | null } = {}): Promise<IBookEditJob> {
  requireBookLc(auth, "ai_edit");
  requireBookLc(auth, "manage");
  const prev = Types.ObjectId.isValid(jobId) ? await BookEditJob.findById(jobId) : null;
  if (!prev) throw new BookLcError("NO_JOB", "কাজ পাওয়া যায়নি");
  if (RUNNING_JOB.includes(prev.status)) throw new BookLcError("JOB_RUNNING", "কাজটি এখনো চলছে");
  const failed = prev.chapters.filter((c) => c.status === "failed").map((c) => c.key);
  if (!failed.length) throw new BookLcError("NO_FAILED", "ব্যর্থ কোনো অধ্যায় নেই");
  if (await BookEditJob.exists({ rerunOf: prev._id })) throw new BookLcError("ALREADY_RERUN", "এই কাজের ব্যর্থ অধ্যায় আগেই আবার চালানো হয়েছে");
  const draft = await BookEditDraft.findById(prev.draftId);
  if (!draft || !["open", "submitted", "ready"].includes(draft.status)) throw new BookLcError("DRAFT_CLOSED", "খসড়াটি আর খোলা নেই — নতুন কাজ শুরু করুন");
  await assertDraftBaseFresh(draft);
  const route = await aiRouteFor(BOOK_EDIT_FEATURE);
  if (!route.enabled) throw new AiFeatureOffError(BOOK_EDIT_FEATURE);
  const { cap } = checkModelAndCap(auth, prev.modelName, input.capUsd);
  const plan = { ...(await planOfDraft(draft._id)), scopeChapterKeys: failed };
  const est = await estimatePlan(plan, prev.modelName);
  if ((est.units > LARGE_UNITS || est.usd > cap) && !input.confirmLarge) throw new BookLcError("CONFIRM_LARGE", `বড় কাজ: ${est.units}টি অংশ, আনুমানিক $${est.usd} (সীমা $${cap}) — আবার নিশ্চিত করুন`);
  const job = await BookEditJob.create({
    bookId: draft.bookId,
    draftId: draft._id,
    provider: prev.provider,
    modelName: prev.modelName,
    reasoning: prev.reasoning,
    status: "queued",
    chapters: failed.map((key) => ({ key, status: "queued", attempts: 0, fixes: 0, costUsd: 0, cacheHitTokens: 0, cacheMissTokens: 0, outputTokens: 0 })),
    capUsd: cap,
    estimateUsd: est.usd,
    spentUsd: 0,
    leftOut: est.leftOut,
    startedBy: uid(auth),
    rerunOf: prev._id,
  });
  await BookEditDraft.updateOne({ _id: draft._id }, { $set: { jobId: job._id } });
  await lcEvent({ bookId: draft.bookId, kind: "JOB_STARTED", actorId: uid(auth), summary: `AI edit job re-run of ${failed.length} failed chapters (${failed.join(", ")}), ${prev.modelName}, cap $${cap}`, refs: { jobId: job._id, draftId: draft._id } });
  return job;
}

export async function stopEditJob(auth: AuthPayload, jobId: string): Promise<IBookEditJob> {
  requireBookLc(auth, "ai_edit");
  const job = await BookEditJob.findById(Types.ObjectId.isValid(jobId) ? jobId : null);
  if (!job) throw new BookLcError("NO_JOB", "কাজ পাওয়া যায়নি");
  if (["queued", "running"].includes(job.status)) {
    job.stopRequested = true;
    if (job.status === "queued") {
      job.status = "stopped";
      job.finishedAt = new Date();
    }
    await job.save();
    await lcEvent({ bookId: job.bookId, kind: "JOB_FINISHED", actorId: uid(auth), summary: "AI edit job stop requested", refs: { jobId: job._id, draftId: job.draftId } });
  }
  return job;
}

export async function loadJob(auth: AuthPayload, jobId: string): Promise<IBookEditJob> {
  requireBookLc(auth, "view");
  const job = Types.ObjectId.isValid(jobId) ? await BookEditJob.findById(jobId) : null;
  if (!job) throw new BookLcError("NO_JOB", "কাজ পাওয়া যায়নি");
  return job;
}

/** A book's jobs, newest first, paged (D-#761). */
export async function jobsPage(auth: AuthPayload, bookId: string, page = 1, pageSize = 20): Promise<{ rows: IBookEditJob[]; total: number; page: number; pageSize: number }> {
  requireBookLc(auth, "view");
  const book = await loadBook(bookId);
  const size = Math.max(1, Math.min(50, pageSize));
  const p = Math.max(1, page);
  const [rows, total] = await Promise.all([BookEditJob.find({ bookId: book._id }).sort({ createdAt: -1 }).skip((p - 1) * size).limit(size), BookEditJob.countDocuments({ bookId: book._id })]);
  return { rows, total, page: p, pageSize: size };
}

function chapterCost(o: AiSendOutcome, now: Date): { cost: number; hit: number; miss: number; out: number } {
  let cost = 0;
  let hit = 0;
  let miss = 0;
  let out = 0;
  for (const a of o.attempts) {
    if (!a.result) continue;
    cost += costUsd(a.provider, a.model, a.result.usage, now);
    hit += a.result.usage.cacheHitTokens;
    miss += a.result.usage.cacheMissTokens;
    out += a.result.usage.outputTokens;
  }
  return { cost, hit, miss, out };
}

async function setChapter(jobId: Types.ObjectId, key: string, set: Record<string, unknown>, inc: Record<string, number> = {}): Promise<void> {
  const $set: Record<string, unknown> = { heartbeatAt: new Date() };
  for (const [k, v] of Object.entries(set)) $set[`chapters.$.${k}`] = v;
  const $inc: Record<string, number> = {};
  for (const [k, v] of Object.entries(inc)) $inc[`chapters.$.${k}`] = v;
  if (inc.costUsd) $inc.spentUsd = inc.costUsd;
  await BookEditJob.updateOne({ _id: jobId, "chapters.key": key }, { $set, ...(Object.keys($inc).length ? { $inc } : {}) });
}

type Answer = { ops?: unknown[]; notApplied?: unknown[]; alsoElsewhere?: unknown[] };
function parseAnswer(text: string): Answer | null {
  try {
    const v = extractJson(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Answer) : null;
  } catch {
    return null;
  }
}

const hashOf = (t: string) => createHash("sha256").update(t, "utf8").digest("hex").slice(0, 32);

/** The ledger the job uses: usage and caps unchanged; the exchange row names the job + chapter and the
 *  text's hash instead of storing book text in the main database (D-#1631). */
function jobLedger(base: AiLedger, ref: string): AiLedger {
  return {
    ...base,
    exchange: base.exchange
      ? (x) => base.exchange!({ ...x, request: `${ref} · request sha256:${hashOf(x.request)}`, reply: `${ref} · reply sha256:${hashOf(x.reply)}`, history: [] })
      : undefined,
  };
}

/** Run one job to its end (the worker calls this for one claimed job at a time). */
export async function runEditJob(jobId: Types.ObjectId, deps: JobDeps = {}): Promise<IBookEditJob> {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let job = (await BookEditJob.findById(jobId))!;
  const finish = async (status: IBookEditJob["status"], note?: string): Promise<IBookEditJob> => {
    await BookEditJob.updateOne({ _id: jobId, status: { $in: ["queued", "running"] } }, { $set: { status, finishedAt: now(), ...(note ? { note } : {}) } });
    job = (await BookEditJob.findById(jobId))!;
    const book = await SchoolBook.findById(job.bookId);
    await lcEvent({ bookId: job.bookId, kind: "JOB_FINISHED", actorId: job.startedBy, summary: `AI edit job ${job.status} ($${job.spentUsd.toFixed(4)})`, refs: { jobId: job._id, draftId: job.draftId } });
    if (book) {
      await emit({
        recipientUserId: job.startedBy.toString(),
        kind: "BOOK_EDIT_READY",
        titleBn: `এআই সংশোধন শেষ: ${book.titleBn}`,
        bodyBn: `অবস্থা: ${job.status}। খসড়া দেখে অধ্যায় ধরে ধরে গ্রহণ করুন।`,
        refs: { bookId: book._id.toString(), bookDraftId: job.draftId.toString() },
        dedupeKey: `BOOK_EDIT_READY:${job._id}`,
      }).catch(() => undefined);
    }
    return job;
  };
  // The starter is re-read: a person who lost ai_edit / manage since starting stops the job.
  const starter = await activeAuthOf(job.startedBy);
  if (!starter || !callerHasPermission(starter, "book_lifecycle:ai_edit") || !callerHasPermission(starter, "book_lifecycle:manage")) return finish("failed", "starter has no access");
  await BookEditJob.updateOne({ _id: jobId, status: "queued" }, { $set: { status: "running", heartbeatAt: now() } });
  const draft = (await BookEditDraft.findById(job.draftId))!;
  const plan = await planOfDraft(draft._id);
  const units = await unitsFor(plan);
  const p = await promptOf(plan);
  const contract = apiMethodParts().outputContract;
  // A configured fallback is IGNORED: whatever route is in force, the job's copy has none, and the
  // pinned model is the override.
  const baseRoute = deps.ai?.route ?? aiRouteFor;
  const route = async (f: string) => ({ ...(await baseRoute(f)), fallback: null });
  for (const unit of units) {
    job = (await BookEditJob.findById(jobId))!;
    if (job.stopRequested || job.status === "stopped") return finish("stopped", "stopped by a person");
    const row = job.chapters.find((c) => c.key === unit.key);
    if (!row || ["done", "failed", "unchanged"].includes(row.status)) continue;
    const book = await SchoolBook.findById(draft.bookId).select("latestVersionId").lean();
    if (!book?.latestVersionId?.equals(draft.baseVersionId)) return finish("stale_base");
    // Cap: stop BEFORE a call whose estimate would pass it.
    const price = priceOf(job.provider, job.modelName);
    const prefixTokens = estimateTokens(p.stablePrefix + p.context);
    const unitEst = unit.parts.reduce((s, part) => s + ((estimateTokens(part.text) + UNIT_OVERHEAD_TOKENS) * price.cacheMiss + prefixTokens * price.cacheHit + EXPECTED_OUT * price.output) / 1_000_000, 0);
    if (job.spentUsd + unitEst > job.capUsd) return finish("partial", "cap");
    await setChapter(jobId, unit.key, { status: "running", startedAt: now() });
    const baseSha = draft.chapters.find((c) => c.key === unit.key)!.baseSha!;
    const ledger = jobLedger(deps.ai?.ledger ?? defaultLedger, `BookEditJob ${job._id} ${unit.key}`);
    const ops: unknown[] = [];
    const notApplied: unknown[] = [];
    const alsoElsewhere: unknown[] = [];
    let failure: string | null = null;
    for (const part of unit.parts) {
      let findings: string[] = [];
      let done = false;
      for (let fix = 0; fix <= MAX_FIXES && !done && !failure; fix++) {
        const variablePart = [
          `# CHAPTER ${unit.key}${part.key !== unit.key ? ` (part ${part.key})` : ""}`,
          `draft: ${draft._id.toString()}`,
          `chapter: ${unit.key}`,
          `baseSha: ${baseSha}`,
          "",
          "```markdown",
          part.text,
          "```",
          "",
          `# FEEDBACK FOR THIS CHAPTER\n${p.itemsByChapter.get(unit.key) ?? "-"}`,
          findings.length ? `\n# YOUR LAST ANSWER WAS REFUSED — fix these and answer again\n${findings.join("\n")}` : "",
          "",
          contract,
        ].join("\n");
        let outcome: AiSendOutcome | null = null;
        for (let attempt = 0; attempt <= RETRIES && !outcome; attempt++) {
          try {
            await setChapter(jobId, unit.key, {}, { attempts: 1 });
            outcome = await aiSend(
              BOOK_EDIT_FEATURE,
              { stablePrefix: p.stablePrefix, context: p.context, variablePart, json: true, maxOutputTokens: OUTPUT_TOKENS, reasoning: job.reasoning, timeoutMs: 240_000 },
              { userId: job.startedBy.toString(), role: starter.role, refType: "BookEditJob", refId: job._id.toString(), modelOverride: job.modelName, exchange: { prefixRef: p.prefixRef, deidentified: false } },
              { ...(deps.ai ?? {}), route, ledger },
            );
          } catch (e) {
            if (e instanceof AiFeatureOffError) return finish("stopped", "feature off");
            if ((e as Error).name === "AiCapError") return finish("partial", (e as Error).message);
            if (attempt < RETRIES) await sleep(1000 * 2 ** attempt);
            else failure = `provider: ${(e as Error).message}`.slice(0, 300);
          }
        }
        if (!outcome) break;
        const c = chapterCost(outcome, now());
        await setChapter(jobId, unit.key, {}, { costUsd: c.cost, cacheHitTokens: c.hit, cacheMissTokens: c.miss, outputTokens: c.out });
        const parsed = parseAnswer(outcome.result.text);
        if (!parsed) {
          findings = ["VR-2: the answer is not one JSON object"];
          if (fix < MAX_FIXES) await setChapter(jobId, unit.key, {}, { fixes: 1 });
          continue;
        }
        // Validate this part's ops (with the parts before it) against the chapter's base before keeping them.
        const trial = await applyChapterEdit(starter, draft._id.toString(), { schema: "book-chapter-edit/v1", draft: draft._id.toString(), chapter: unit.key, baseSha, ops: [...ops, ...((parsed.ops ?? []))], notApplied: [...notApplied, ...((parsed.notApplied ?? []))], alsoElsewhere: [...alsoElsewhere, ...((parsed.alsoElsewhere ?? []))] });
        const blocking = trial.findings.filter((f) => f.level === "blocking");
        if (blocking.length) {
          findings = blocking.map((f) => `${f.code}: ${f.messageBn}`);
          if (fix < MAX_FIXES) await setChapter(jobId, unit.key, {}, { fixes: 1 });
          continue;
        }
        ops.push(...((parsed.ops ?? [])));
        notApplied.push(...((parsed.notApplied ?? [])));
        alsoElsewhere.push(...((parsed.alsoElsewhere ?? [])));
        done = true;
      }
      if (!done) {
        failure = failure ?? `validator: ${findings.join("; ")}`.slice(0, 500);
        break;
      }
    }
    if (failure) {
      // The chapter goes back to the base: a refused trial must not stay in the draft.
      await applyChapterEdit(starter, draft._id.toString(), { schema: "book-chapter-edit/v1", draft: draft._id.toString(), chapter: unit.key, baseSha, ops: [] }).catch(() => undefined);
      await setChapter(jobId, unit.key, { status: "failed", errorBn: failure, finishedAt: now() });
      await lcEvent({ bookId: draft.bookId, kind: "DRAFT_CHAPTER", actorId: job.startedBy, summary: `${unit.key}: AI edit failed`, refs: { jobId: job._id, draftId: draft._id } });
      continue;
    }
    const res = await applyChapterEdit(starter, draft._id.toString(), { schema: "book-chapter-edit/v1", draft: draft._id.toString(), chapter: unit.key, baseSha, ops, notApplied, alsoElsewhere });
    await setChapter(jobId, unit.key, { status: res.status === "unchanged" ? "unchanged" : "done", finishedAt: now() });
  }
  job = (await BookEditJob.findById(jobId))!;
  return finish(job.chapters.some((c) => c.status === "failed") ? "partial" : "done");
}

/** One worker pass: re-queue a job left running > 20 minutes (its running chapter too), then claim
 *  queued jobs up to `concurrency`. One job runs its chapters strictly one at a time (concurrency 1
 *  per job): a job already in flight is never claimed twice. `wait: false` (the worker) returns at
 *  once and lets the claimed jobs run on, so workspace items are not held up behind a long book. */
export async function bookEditWorkerTick(deps: JobDeps = {}, inFlight: Set<string> = new Set(), concurrency = 1, opts: { wait?: boolean } = {}): Promise<number> {
  const now = deps.now?.() ?? new Date();
  await BookEditJob.updateMany(
    { status: "running", heartbeatAt: { $lt: new Date(now.getTime() - STALE_MS) }, _id: { $nin: [...inFlight].map((x) => new Types.ObjectId(x)) } },
    { $set: { status: "queued", "chapters.$[r].status": "queued" } },
    { arrayFilters: [{ "r.status": "running" }] },
  );
  let started = 0;
  const runs: Promise<unknown>[] = [];
  while (inFlight.size < concurrency) {
    const job = await BookEditJob.findOneAndUpdate({ status: "queued", _id: { $nin: [...inFlight].map((x) => new Types.ObjectId(x)) } }, { $set: { status: "running", heartbeatAt: now } }, { sort: { createdAt: 1 }, new: true });
    if (!job) break;
    const key = job._id.toString();
    inFlight.add(key);
    started++;
    runs.push(runEditJob(job._id, deps).catch((e) => console.error("[book-edit] job failed:", (e as Error)?.message)).finally(() => inFlight.delete(key)));
  }
  if (opts.wait !== false) await Promise.all(runs);
  return started;
}
