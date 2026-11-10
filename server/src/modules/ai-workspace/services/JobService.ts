/**
 * JobService (AI Workspace W-4, docs/prd-ai-workspace.md §6; D-#1209 / D-#1213).
 *
 * App side: estimate (both prices, before anything starts), create (template saved as a
 * versioned AiPolicy, run time REQUIRED), list, read, cancel.
 * Worker side (`workers/aiJobWorker.ts`, a separate process): claim one queued item at a time
 * (atomic), run it on the project's cached prefix + the template with {{item}} filled in,
 * check it with the draft kind's validator (lesson plans: the import gate as a dry run; JSON
 * kinds: must parse), send the refusal back to the AI up to twice, retry a provider failure
 * twice with backoff, save the result as a draft, and when the last item ends mark the job
 * and notify the person who started it.
 */
import { Types } from "mongoose";
import { emit } from "../../notifications/services/NotificationService";
import type { AuthPayload } from "../../../context";
import { queryPage, type Page, type PageArgs } from "../../../lib/paging";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
import { saveProjectPolicyVersion } from "../../platform/services/AiPolicyService";
import { aiSend, AiFeatureOffError, AiModelOverrideError } from "../../platform/ai/aiRouter";
import { AiProviderError, type AiTurn } from "../../platform/ai/provider";
import { isPeak, priceClock, priceOf } from "../../platform/ai/aiPrices";
import { DEEPSEEK_MODELS } from "../../platform/ai/deepseekProvider";
import { reidentify, DeidentifyError, type DeidScope } from "../../platform/ai/deidentify";
import { AiCapError } from "../../platform/services/AiUsageService";
import { AiUsage } from "../../platform/models/AiUsage";
import { buildEnvelopeFromPair, runImportGate } from "../../content/services/ContentService";
import { AiProject, type IAiProject } from "../models/AiProject";
import { AiJob, type IAiJob, type IAiJobItem } from "../models/AiJob";
import { AI_DRAFT_KINDS, type AiDraftKind } from "../models/AiDraft";
import { AiWorkspaceError, contextBudgetOf, loadProject } from "./AiProjectService";
import { projectPrefix, protectParts } from "./ProjectChatService";
import { contentFromAnswer, createDraft, DRAFT_MAX_OUTPUT_TOKENS } from "./DraftService";
import { estimateTokens } from "./tokenCount";

export const MAX_JOB_ITEMS = 200;
export const ITEM_TIMEOUT_MS = 15 * 60 * 1000;
/** Provider failures: two retries, then the item fails. */
export const MAX_ATTEMPTS = 3;
/** Validator refusals sent back to the AI. */
export const MAX_FIXES = 2;
const BACKOFF_MS = [30_000, 120_000];
/** A running item whose worker stopped beating for this long is queued again. */
export const STALE_MS = 20 * 60 * 1000;

/** Expected answer size per item, for the estimate only (config, not a limit). */
export const EXPECTED_OUTPUT_TOKENS: Record<AiDraftKind, number> = {
  free: 3_000,
  lesson_plan: 8_000,
  question_bank: 8_000,
  book_chapter: 12_000,
  storybook: 6_000,
  paper: 6_000,
};

const BN = {
  notFound: "কাজটি পাওয়া যায়নি",
  title: "কাজের একটি নাম দিন",
  template: "নির্দেশে {{item}} রাখুন — প্রতিটি বিষয় সেখানে বসবে",
  items: `এক থেকে ${MAX_JOB_ITEMS}টি বিষয় দিন (প্রতি লাইনে একটি)`,
  run: "কখন চলবে — এখন না কম দামে — বেছে নিন",
  model: "এই মডেলটি কর্মক্ষেত্রে চলে না",
  thinking: "চিন্তার মাত্রা সঠিক নয়",
  kind: "খসড়ার ধরন সঠিক নয়",
  archived: "আর্কাইভ করা প্রকল্পে কাজ চালানো যায় না",
  off: "ব্যাচ কাজ এখন বন্ধ — প্রধান শিক্ষক এআই সেটিং থেকে চালু করতে পারেন",
  down: "এআই সাড়া দেয়নি",
  cancelled: "বাতিল করা হয়েছে",
} as const;

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface JobItemView {
  id: string;
  value: string;
  status: string;
  attempts: number;
  fixes: number;
  draftId: string | null;
  error: string | null;
  costUsd: number;
}

export interface JobView {
  id: string;
  projectId: string;
  title: string;
  kind: string;
  template: string;
  model: string;
  thinking: string;
  runAt: "now" | "offpeak";
  status: string;
  total: number;
  done: number;
  failed: number;
  queued: number;
  running: number;
  costUsd: number;
  estimateNowUsd: number;
  estimateOffpeakUsd: number;
  cacheHitRate: number | null;
  createdByName: string | null;
  origin: "app" | "claude";
  createdAt: Date;
  finishedAt: Date | null;
  items: JobItemView[];
}

function jobView(j: IAiJob, names: Map<string, string>, withItems: boolean): JobView {
  const count = (s: string) => j.items.filter((i) => i.status === s).length;
  const hit = j.items.reduce((a, i) => a + i.cacheHitTokens, 0);
  const miss = j.items.reduce((a, i) => a + i.cacheMissTokens, 0);
  return {
    id: j._id.toString(),
    projectId: j.projectId.toString(),
    title: j.title,
    kind: j.kind,
    template: j.template,
    model: j.modelName,
    thinking: j.thinking,
    runAt: j.runAt,
    status: j.status,
    total: j.items.length,
    done: count("done"),
    failed: count("failed"),
    queued: count("queued"),
    running: count("running"),
    costUsd: Math.round(j.costUsd * 1e6) / 1e6,
    estimateNowUsd: j.estimate.nowUsd,
    estimateOffpeakUsd: j.estimate.offpeakUsd,
    cacheHitRate: hit + miss > 0 ? Math.round((hit / (hit + miss)) * 1000) / 1000 : null,
    createdByName: names.get(j.createdBy.toString()) ?? null,
    origin: j.origin,
    createdAt: j.createdAt,
    finishedAt: j.finishedAt ?? null,
    items: withItems
      ? j.items.map((i) => ({ id: i._id.toString(), value: i.value, status: i.status, attempts: i.attempts, fixes: i.fixes, draftId: i.draftId?.toString() ?? null, error: i.error ?? null, costUsd: i.costUsd }))
      : [],
  };
}

async function names(ids: Array<Types.ObjectId | null | undefined>): Promise<Map<string, string>> {
  const u = [...new Set(ids.filter(Boolean).map(String))];
  return new Map(u.length ? (await User.find({ _id: { $in: u } }).select("name").lean()).map((x) => [x._id.toString(), x.name]) : []);
}

// ---------------------------------------------------------------------------
// Estimate + create
// ---------------------------------------------------------------------------

export interface JobInput {
  title: string;
  kind: string;
  template: string;
  items: string[];
  model: string;
  thinking: string;
  runAt?: string | null;
}

export interface JobEstimate {
  items: number;
  inputTokens: number;
  outputTokens: number;
  nowUsd: number;
  offpeakUsd: number;
  /** Is it peak right now (so "now" is full price)? */
  peakNow: boolean;
  offpeakStartsAt: Date;
}

function cleanItems(raw: string[]): string[] {
  return raw.map((s) => (s ?? "").trim()).filter(Boolean);
}

function checkInput(input: JobInput, requireRun: boolean): { kind: AiDraftKind; items: string[]; template: string } {
  if ((input.title ?? "").trim().length < 2) throw new AiWorkspaceError(BN.title);
  if (!(AI_DRAFT_KINDS as readonly string[]).includes(input.kind)) throw new AiWorkspaceError(BN.kind);
  const template = (input.template ?? "").replace(/\r\n/g, "\n").trim();
  if (!template.includes("{{item}}")) throw new AiWorkspaceError(BN.template);
  const items = cleanItems(input.items ?? []);
  if (items.length < 1 || items.length > MAX_JOB_ITEMS) throw new AiWorkspaceError(BN.items);
  if (!(DEEPSEEK_MODELS as readonly string[]).includes(input.model)) throw new AiWorkspaceError(BN.model);
  if (!["off", "low", "high"].includes(input.thinking)) throw new AiWorkspaceError(BN.thinking);
  if (requireRun && input.runAt !== "now" && input.runAt !== "offpeak") throw new AiWorkspaceError(BN.run);
  return { kind: input.kind as AiDraftKind, items, template };
}

/** Both prices, before anything starts (PRD §6 "pre-flight estimate"). */
export async function estimateFor(project: IAiProject, input: { kind: AiDraftKind; template: string; items: string[]; model: string }, now: Date = new Date()): Promise<JobEstimate> {
  const budget = await contextBudgetOf(project, now);
  const price = priceOf("deepseek", input.model);
  const prefix = budget.totalTokens + estimateTokens(input.template);
  const perItemOut = EXPECTED_OUTPUT_TOKENS[input.kind];
  let full = 0;
  let inputTokens = 0;
  input.items.forEach((item, i) => {
    const own = estimateTokens(item);
    // The first item writes the cache; the rest read the prefix from it.
    const hit = i === 0 ? 0 : budget.totalTokens;
    const miss = i === 0 ? prefix + own : prefix - budget.totalTokens + own;
    inputTokens += hit + miss;
    full += (hit * price.cacheHit + miss * price.cacheMiss + perItemOut * price.output) / 1_000_000;
  });
  const clock = priceClock("deepseek", now);
  const round = (n: number) => Math.round(n * 10_000) / 10_000;
  return {
    items: input.items.length,
    inputTokens,
    outputTokens: perItemOut * input.items.length,
    nowUsd: round(full * (clock.peak ? 1 : 0.5)),
    offpeakUsd: round(full * 0.5),
    peakNow: clock.peak,
    offpeakStartsAt: clock.peak ? clock.changesAt : now,
  };
}

export async function estimateJob(authIn: AuthPayload | null, projectId: string, input: JobInput): Promise<JobEstimate> {
  const { project } = await loadProject(authIn, projectId, "editor");
  const c = checkInput(input, false);
  return estimateFor(project, { kind: c.kind, template: c.template, items: c.items, model: input.model });
}

export async function createJob(authIn: AuthPayload | null, projectId: string, input: JobInput & { origin?: "app" | "claude" }): Promise<JobView> {
  const { auth, project } = await loadProject(authIn, projectId, "editor");
  if (project.archived) throw new AiWorkspaceError(BN.archived);
  const c = checkInput(input, true);
  const est = await estimateFor(project, { kind: c.kind, template: c.template, items: c.items, model: input.model });
  const jobId = new Types.ObjectId();
  const templateKey = `project:${project._id.toString()}:template:job-${jobId.toString()}`;
  const policy = await saveProjectPolicyVersion({ key: templateKey, body: c.template, note: input.title.trim().slice(0, 200), actorId: auth.userId, actorRole: auth.role });
  const job = await AiJob.create({
    _id: jobId,
    projectId: project._id,
    title: input.title.trim().slice(0, 200),
    kind: c.kind,
    template: c.template,
    templateKey,
    policyHash: policy.hash,
    items: c.items.map((value) => ({ value })),
    modelName: input.model,
    thinking: input.thinking,
    runAt: input.runAt,
    status: "queued",
    estimate: { nowUsd: est.nowUsd, offpeakUsd: est.offpeakUsd, inputTokens: est.inputTokens, outputTokens: est.outputTokens },
    createdBy: new Types.ObjectId(auth.userId),
    origin: input.origin ?? "app",
  });
  await writeAudit({ eventKind: "AI_JOB_CHANGED", actorId: auth.userId, actorRole: auth.role, targetKind: "AiJob", targetId: job._id.toString(), meta: { action: "create", items: c.items.length, runAt: input.runAt, model: input.model, estimateUsd: input.runAt === "offpeak" ? est.offpeakUsd : est.nowUsd } });
  return jobView(job, await names([job.createdBy]), true);
}

export async function jobsPage(authIn: AuthPayload | null, projectId: string, args: PageArgs): Promise<Page<JobView>> {
  const { project } = await loadProject(authIn, projectId, "viewer");
  return queryPage(AiJob, { projectId: project._id }, { createdAt: -1 }, args, async (docs) => {
    const js = docs as unknown as IAiJob[];
    const n = await names(js.map((j) => j.createdBy));
    return js.map((j) => jobView(j, n, false));
  }, 20);
}

export async function job(authIn: AuthPayload | null, jobId: string): Promise<JobView> {
  const j = Types.ObjectId.isValid(jobId) ? await AiJob.findById(jobId) : null;
  if (!j) throw new AiWorkspaceError(BN.notFound);
  await loadProject(authIn, j.projectId.toString(), "viewer");
  return jobView(j, await names([j.createdBy]), true);
}

/** Cancels every item not started yet; running items finish. Editors. */
export async function cancelJob(authIn: AuthPayload | null, jobId: string): Promise<JobView> {
  const j = Types.ObjectId.isValid(jobId) ? await AiJob.findById(jobId) : null;
  if (!j) throw new AiWorkspaceError(BN.notFound);
  const { auth } = await loadProject(authIn, j.projectId.toString(), "editor");
  await AiJob.updateOne({ _id: j._id }, { $set: { "items.$[q].status": "cancelled", "items.$[q].error": BN.cancelled } }, { arrayFilters: [{ "q.status": "queued" }] });
  await finishIfDone(j._id);
  await writeAudit({ eventKind: "AI_JOB_CHANGED", actorId: auth.userId, actorRole: auth.role, targetKind: "AiJob", targetId: jobId, meta: { action: "cancel" } });
  return job(auth, jobId);
}

// ---------------------------------------------------------------------------
// The worker side
// ---------------------------------------------------------------------------

export interface JobDeps {
  send?: typeof aiSend;
  scope?: () => Promise<DeidScope>;
  /** The lesson-plan validator (default: build_envelope + validate_import, dry run). */
  validate?: (kind: AiDraftKind, content: { body: string; planJson: string | null }) => Promise<string[]>;
  now?: () => Date;
}

/** Claims one item that may run now (atomic). Null when there is nothing to do. */
export async function claimNextItem(now: Date = new Date()): Promise<{ jobId: Types.ObjectId; itemId: Types.ObjectId } | null> {
  const peak = isPeak("deepseek", now);
  const candidates = await AiJob.find({
    status: { $in: ["queued", "running"] },
    ...(peak ? { runAt: "now" } : {}),
    items: { $elemMatch: { status: "queued", $or: [{ nextTryAt: null }, { nextTryAt: { $lte: now } }] } },
  })
    .sort({ createdAt: 1 })
    .limit(5)
    .select("_id items._id items.status items.nextTryAt")
    .lean();
  for (const j of candidates) {
    const item = j.items.find((i) => i.status === "queued" && (!i.nextTryAt || i.nextTryAt <= now));
    if (!item) continue;
    const res = await AiJob.updateOne(
      { _id: j._id, items: { $elemMatch: { _id: item._id, status: "queued" } } },
      { $set: { "items.$.status": "running", "items.$.startedAt": now, status: "running", heartbeatAt: now } },
    );
    if (res.modifiedCount === 1) return { jobId: j._id, itemId: item._id };
  }
  return null;
}

/** Items left running by a stopped worker go back to the queue. */
export async function requeueStaleItems(now: Date = new Date()): Promise<number> {
  const res = await AiJob.updateMany(
    { status: "running", heartbeatAt: { $lt: new Date(now.getTime() - STALE_MS) } },
    { $set: { "items.$[r].status": "queued", "items.$[r].error": "কাজটি থেমে গিয়েছিল — আবার চলবে" } },
    { arrayFilters: [{ "r.status": "running" }] },
  );
  return res.modifiedCount;
}

async function setItem(jobId: Types.ObjectId, itemId: Types.ObjectId, set: Partial<Record<keyof IAiJobItem, unknown>>, inc?: Partial<Record<keyof IAiJobItem, number>>): Promise<void> {
  const $set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(set)) $set[`items.$.${k}`] = v;
  const $inc: Record<string, number> = {};
  for (const [k, v] of Object.entries(inc ?? {})) $inc[`items.$.${k}`] = v as number;
  if (inc?.costUsd) $inc.costUsd = inc.costUsd;
  await AiJob.updateOne({ _id: jobId, "items._id": itemId }, { $set, ...(Object.keys($inc).length ? { $inc } : {}) });
}

/** The lesson-plan validator: build the envelope and run the import gate without saving. */
async function defaultValidate(kind: AiDraftKind, content: { body: string; planJson: string | null }): Promise<string[]> {
  if (kind !== "lesson_plan") return [];
  const built = await buildEnvelopeFromPair("aiws-job-check", content.planJson ?? "", content.body, "aiws-job-check.json", "AI Workspace");
  if (!built.ok || !built.envelope) return [built.error ?? "the plan could not be wrapped into an envelope"];
  const gate = await runImportGate(built.envelope);
  return gate.verdict === "PASS" ? [] : gate.failChecks;
}

/** Shape check for the kind (JSON must parse; a lesson plan needs both parts). */
function shapeErrors(kind: AiDraftKind, c: { body: string; planJson: string | null }): string[] {
  if (!c.body.trim()) return ["the answer was empty"];
  if (kind === "lesson_plan") {
    if (!c.planJson) return ["a lesson plan needs its plan JSON in one ```json block, then the Markdown"];
    try {
      JSON.parse(c.planJson);
    } catch (e) {
      return [`the plan JSON does not parse: ${(e as Error).message}`];
    }
  }
  if (kind === "question_bank" || kind === "book_chapter") {
    try {
      JSON.parse(c.body);
    } catch (e) {
      return [`the JSON does not parse: ${(e as Error).message}`];
    }
  }
  return [];
}

async function authOf(userId: Types.ObjectId): Promise<AuthPayload> {
  const u = await User.findById(userId).select("role additionalTemplates grantedPermissions revokedPermissions").lean();
  if (!u) throw new AiWorkspaceError("কাজটি যিনি শুরু করেছিলেন তাঁকে পাওয়া যায়নি");
  return { userId: userId.toString(), role: u.role, additionalTemplates: u.additionalTemplates ?? [], grantedPermissions: u.grantedPermissions ?? [], revokedPermissions: u.revokedPermissions ?? [] } as AuthPayload;
}

/** Runs one claimed item to an end state (done / queued for a retry / failed). Never throws. */
export async function runItem(jobId: Types.ObjectId, itemId: Types.ObjectId, deps: JobDeps = {}): Promise<void> {
  const j = await AiJob.findById(jobId);
  const item = j?.items.find((i) => i._id.equals(itemId));
  if (!j || !item) return;
  const now = deps.now?.() ?? new Date();
  const fail = async (error: string) => {
    await setItem(jobId, itemId, { status: "failed", error, finishedAt: now });
  };
  try {
    const project = await AiProject.findById(j.projectId);
    if (!project) return void (await fail(BN.notFound));
    const prefix = await projectPrefix(project);
    const task = j.template.split("{{item}}").join(item.value);
    let parts = [prefix.stablePrefix, task];
    let map: Record<string, string> = {};
    if (project.nameProtection) {
      try {
        const p = await protectParts(parts, deps.scope);
        parts = p.texts;
        map = p.map;
      } catch (e) {
        if (e instanceof DeidentifyError) return void (await fail(e.message));
        throw e;
      }
    }
    const send = deps.send ?? aiSend;
    const validate = deps.validate ?? defaultValidate;
    const history: AiTurn[] = [];
    let ask = parts[1];
    for (let round = 0; ; round++) {
      await AiJob.updateOne({ _id: jobId }, { $set: { heartbeatAt: new Date() } });
      const out = await send(
        "workspace_job",
        { stablePrefix: parts[0], history, variablePart: ask, maxOutputTokens: DRAFT_MAX_OUTPUT_TOKENS, reasoning: j.thinking, timeoutMs: ITEM_TIMEOUT_MS },
        {
          userId: j.createdBy.toString(),
          refType: "AiJob",
          refId: jobId.toString(),
          policyHash: prefix.policy?.hash ?? j.policyHash,
          projectId: project._id.toString(),
          projectMonthlyUsd: project.monthlyCapUsd ?? null,
          modelOverride: j.modelName,
        },
      );
      const cost = (await AiUsage.find({ callId: out.callId }).select("costUsd").lean()).reduce((s, r) => s + (r.costUsd ?? 0), 0);
      await setItem(jobId, itemId, {}, { costUsd: cost, cacheHitTokens: out.result.usage.cacheHitTokens, cacheMissTokens: out.result.usage.cacheMissTokens, outputTokens: out.result.usage.outputTokens });
      const raw = out.result.text;
      const content = contentFromAnswer(j.kind as AiDraftKind, project.nameProtection ? reidentify(raw, map) : raw);
      const errors = [...shapeErrors(j.kind as AiDraftKind, content), ...(shapeErrors(j.kind as AiDraftKind, content).length ? [] : await validate(j.kind as AiDraftKind, content))];
      if (errors.length === 0) {
        const draft = await createDraft(await authOf(j.createdBy), project._id.toString(), {
          title: `${j.title} — ${item.value.slice(0, 80)}`,
          kind: j.kind,
          body: content.body,
          planJson: content.planJson,
          note: `ব্যাচ কাজ: ${j.title}`,
          origin: j.origin,
          jobId: jobId.toString(),
          source: "job",
          policyHash: prefix.policy?.hash ?? null,
        });
        await setItem(jobId, itemId, { status: "done", draftId: new Types.ObjectId(draft.id), error: null, finishedAt: new Date() });
        return;
      }
      const fixes = item.fixes + round;
      if (fixes >= MAX_FIXES) return void (await fail(`যাচাইয়ে আটকেছে: ${errors.slice(0, 5).join(" · ")}`.slice(0, 1000)));
      await setItem(jobId, itemId, {}, { fixes: 1 });
      // Back to the AI with its own answer and the refusal (D-#1213: up to twice).
      history.push({ role: "user", text: ask }, { role: "assistant", text: raw });
      ask = `Your answer above was refused by the school's validator:\n- ${errors.slice(0, 20).join("\n- ")}\n\nFix these and return the WHOLE answer again, in the same format.`;
    }
  } catch (e) {
    if (e instanceof AiFeatureOffError) return void (await fail(BN.off));
    if (e instanceof AiCapError) return void (await fail(e.message));
    if (e instanceof AiModelOverrideError) return void (await fail(BN.model));
    if (e instanceof AiWorkspaceError) return void (await fail(e.message));
    const attempts = item.attempts + 1;
    if (e instanceof AiProviderError && e.kind !== "truncated" && attempts < MAX_ATTEMPTS) {
      await setItem(jobId, itemId, { status: "queued", attempts, nextTryAt: new Date(now.getTime() + BACKOFF_MS[attempts - 1]), error: `${BN.down} — আবার চেষ্টা হবে` });
      return;
    }
    if (!(e instanceof AiProviderError)) console.warn("[ai-job] item failed:", (e as Error)?.message);
    await setItem(jobId, itemId, { attempts }, {});
    await fail(e instanceof AiProviderError && e.kind === "truncated" ? "উত্তর সীমা ছাড়িয়েছে — বিষয়টি ছোট করুন" : BN.down);
  }
}

/** When no item is queued or running: done / partial / failed, then notify the starter once. */
export async function finishIfDone(jobId: Types.ObjectId): Promise<boolean> {
  const j = await AiJob.findById(jobId);
  if (!j) return false;
  if (j.items.some((i) => i.status === "queued" || i.status === "running")) return false;
  if (["done", "partial", "failed", "cancelled"].includes(j.status) && j.notifiedAt) return true;
  const done = j.items.filter((i) => i.status === "done").length;
  const cancelled = j.items.filter((i) => i.status === "cancelled").length;
  const status = done === j.items.length ? "done" : done > 0 ? "partial" : cancelled === j.items.length ? "cancelled" : "failed";
  const claimed = await AiJob.findOneAndUpdate({ _id: j._id, notifiedAt: null }, { $set: { status, finishedAt: new Date(), notifiedAt: new Date() } }, { new: true });
  if (!claimed) return true;
  await emit({
    kind: "AI_JOB_FINISHED",
    recipientUserId: j.createdBy.toString(),
    titleBn: `এআই ব্যাচ কাজ শেষ: ${j.title}`.slice(0, 200),
    bodyBn: `${j.items.length}টির মধ্যে ${done}টি খসড়া তৈরি হয়েছে${j.items.length - done - cancelled > 0 ? `, ${j.items.length - done - cancelled}টি হয়নি` : ""}। খরচ $${claimed.costUsd.toFixed(4)}।`,
    refs: {},
    dedupeKey: `ai-job-finished:${j._id.toString()}`,
  }).catch((e) => console.warn("[ai-job] notify failed:", (e as Error)?.message));
  return true;
}

/** One pass of the worker: requeue stale items, then fill up to `concurrency` running items. */
export async function workerTick(concurrency = 2, deps: JobDeps = {}, inFlight: Set<string> = new Set()): Promise<number> {
  const now = deps.now?.() ?? new Date();
  await requeueStaleItems(now);
  let started = 0;
  const runs: Promise<void>[] = [];
  while (inFlight.size < concurrency) {
    const claim = await claimNextItem(now);
    if (!claim) break;
    const key = claim.itemId.toString();
    inFlight.add(key);
    started++;
    runs.push(
      runItem(claim.jobId, claim.itemId, deps)
        .then(() => finishIfDone(claim.jobId).then(() => undefined))
        .finally(() => inFlight.delete(key)),
    );
  }
  await Promise.all(runs);
  return started;
}
