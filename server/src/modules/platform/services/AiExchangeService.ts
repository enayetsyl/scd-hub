/**
 * AiExchangeService (D-#1179) — the log of every AI request and reply of the new features,
 * de-identified, for studying the model and improving the instructions / rules / standards.
 *
 *   recordAiExchange   written by `aiSend` after every call that reached a provider (never
 *                      throws: a log failure must not cost the teacher their answer)
 *   noteCheckShown     the comment check's clean-up result (issues actually shown)
 *   noteCheckSaved     the writer's choice when the checked comment is saved
 *   aiExchangesPage / aiExchangeDetail / aiExchangesExport   `ai_assist:read_ai_log` (LOCKED)
 *   deleteAiExchange / deleteAiExchanges                      `ai_assist:delete_ai_log` (LOCKED)
 *
 * Nothing is deleted automatically (owner 2026-11-09); deletion is manual and audited.
 */
import { createHash } from "crypto";
import { Types, type FilterQuery } from "mongoose";
import type { AuthPayload } from "../../../context";
import { callerHasPermission } from "@scd/shared";
import { ForbiddenError } from "../../../middleware/authz";
import { queryPage, type Page, type PageArgs } from "../../../lib/paging";
import { User } from "../../foundation/models/User";
import { AiExchange, AiPromptText, type IAiExchange, type IAiExchangeAttempt } from "../models/AiExchange";
import { writeAudit } from "./AuditService";

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const EXPORT_LIMIT = 5000;
const MAX_TEXT = 60_000;

/** AI Workspace chat (W-2) is logged in reference mode: no history copy, no prefix text (D-#1228). */
export const LOGGED_AI_FEATURES = ["comment_check", "assistant", "workspace_chat", "data_assistant", "book_edit"] as const;

export function textHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 24);
}

async function storePromptText(text: string, at: Date): Promise<string> {
  const hash = textHash(text);
  await AiPromptText.updateOne({ hash }, { $setOnInsert: { hash, text: text.slice(0, 200_000), firstAt: at } }, { upsert: true });
  return hash;
}

export interface AiExchangeInput {
  at: Date;
  feature: string;
  callId: string;
  userId?: string | null;
  role?: string | null;
  refType?: string | null;
  refId?: string | null;
  policyHash?: string | null;
  stablePrefix: string;
  context?: string | null;
  history?: Array<{ role: string; text: string }>;
  /** Reference mode (D-#1228). */
  historyRef?: string | null;
  prefixRef?: string | null;
  deidentified?: boolean;
  request: string;
  reply: string;
  attempts: IAiExchangeAttempt[];
  /** Data assistant (DA-2): tool names + swept arguments + AiDataCall ids; never results. */
  toolCalls?: Array<{ name: string; args: string; dataCallId?: string | null }>;
  impersonatorId?: string | null;
}

/** One call → one row. Never throws. */
export async function recordAiExchange(x: AiExchangeInput): Promise<void> {
  try {
    if (!(LOGGED_AI_FEATURES as readonly string[]).includes(x.feature)) return;
    // Reference mode: the prefix is named (policy hash + file ids), never stored again (D-#1228).
    const [prefixHash, contextHash] = await Promise.all([
      x.prefixRef ? Promise.resolve(`ref:${textHash(x.prefixRef)}`) : storePromptText(x.stablePrefix, x.at),
      x.context && !x.prefixRef ? storePromptText(x.context, x.at) : Promise.resolve(undefined),
    ]);
    const answered = x.attempts.find((a) => a.outcome === "ok");
    const last = answered ?? x.attempts[x.attempts.length - 1];
    await AiExchange.create({
      at: x.at,
      feature: x.feature,
      callId: x.callId,
      userId: x.userId && Types.ObjectId.isValid(x.userId) ? new Types.ObjectId(x.userId) : undefined,
      role: x.role ?? undefined,
      refType: x.refType ?? undefined,
      refId: x.refId ?? undefined,
      policyHash: x.policyHash ?? undefined,
      provider: last?.provider,
      modelName: last?.modelName,
      ok: !!answered,
      errorKind: answered ? undefined : last?.errorKind,
      latencyMs: x.attempts.reduce((s, a) => s + a.latencyMs, 0),
      costUsd: x.attempts.reduce((s, a) => s + a.costUsd, 0),
      attempts: x.attempts,
      prefixHash,
      contextHash,
      history: x.historyRef ? [] : (x.history ?? []).map((h) => ({ role: h.role, text: h.text.slice(0, MAX_TEXT) })),
      historyRef: x.historyRef ?? undefined,
      prefixRef: x.prefixRef ?? undefined,
      deidentified: x.deidentified ?? true,
      request: x.request.slice(0, MAX_TEXT) || "(empty)",
      reply: x.reply.slice(0, MAX_TEXT),
      ...(x.toolCalls?.length ? { toolCalls: x.toolCalls.slice(0, 50).map((t) => ({ name: t.name, args: t.args.slice(0, 2048), dataCallId: t.dataCallId ?? null })) } : {}),
      ...(x.impersonatorId && Types.ObjectId.isValid(x.impersonatorId) ? { impersonatorId: new Types.ObjectId(x.impersonatorId) } : {}),
    });
  } catch (err) {
    console.error("[AiExchangeService] could not log an AI exchange:", (err as Error)?.message);
  }
}

/** The comment check's issues as actually shown (after overlap / addition clean-up). */
export async function noteCheckShown(callId: string, issuesShown: number, issueTypes: Record<string, number>): Promise<void> {
  await AiExchange.updateOne({ callId }, { $set: { "outcome.issuesShown": issuesShown, "outcome.issueTypes": issueTypes } }).catch(() => undefined);
}

/** The writer's choice, recorded when the checked comment is saved. */
export async function noteCheckSaved(callId: string, issuesAccepted: number, teacherOverrode: boolean): Promise<void> {
  await AiExchange.updateOne(
    { callId },
    { $set: { "outcome.saved": true, "outcome.issuesAccepted": issuesAccepted, "outcome.teacherOverrode": teacherOverrode, "outcome.savedAt": new Date() } },
  ).catch(() => undefined);
}

// ---------------------------------------------------------------------------------------
// The Principal's log viewer
// ---------------------------------------------------------------------------------------

function assertRead(auth: AuthPayload | null): AuthPayload {
  if (!auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(auth, "ai_assist:read_ai_log")) throw new ForbiddenError("এআই-এর লগ দেখার অনুমতি নেই");
  return auth;
}

function assertDelete(auth: AuthPayload | null): AuthPayload {
  if (!auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(auth, "ai_assist:delete_ai_log")) throw new ForbiddenError("এআই-এর লগ মুছে ফেলার অনুমতি নেই");
  return auth;
}

/** "2026-11" → [start, end) of that Dhaka month. */
export function monthRange(month: string): { from: Date; to: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? "");
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error("মাস সঠিক নয় (যেমন 2026-11)");
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  return { from: new Date(Date.UTC(y, mo, 1) - DHAKA_OFFSET_MS), to: new Date(Date.UTC(y, mo + 1, 1) - DHAKA_OFFSET_MS) };
}

export interface AiExchangeFilter {
  feature?: string | null;
  /** Dhaka month "YYYY-MM"; absent = all time. */
  month?: string | null;
}

function filterOf(f: AiExchangeFilter): FilterQuery<IAiExchange> {
  const q: FilterQuery<IAiExchange> = {};
  if (f.feature) {
    if (!(LOGGED_AI_FEATURES as readonly string[]).includes(f.feature)) throw new Error("সুবিধা সঠিক নয়");
    q.feature = f.feature;
  }
  if (f.month) {
    const { from, to } = monthRange(f.month);
    q.at = { $gte: from, $lt: to };
  }
  return q;
}

export interface AiExchangeRow {
  id: string;
  at: Date;
  feature: string;
  userId: string | null;
  userName: string | null;
  role: string | null;
  modelName: string | null;
  ok: boolean;
  errorKind: string | null;
  latencyMs: number;
  costUsd: number;
  fellBack: boolean;
  policyHash: string | null;
  issuesShown: number | null;
  issuesAccepted: number | null;
  teacherOverrode: boolean | null;
  saved: boolean;
  /** The first 160 characters of the request. */
  preview: string;
}

async function rowsOf(docs: IAiExchange[]): Promise<AiExchangeRow[]> {
  const ids = [...new Set(docs.map((d) => d.userId?.toString()).filter((x): x is string => !!x))];
  const names = new Map((await User.find({ _id: { $in: ids } }).select("name").lean()).map((u) => [u._id.toString(), u.name as string]));
  return docs.map((d) => ({
    id: d._id.toString(),
    at: d.at,
    feature: d.feature,
    userId: d.userId?.toString() ?? null,
    userName: d.userId ? names.get(d.userId.toString()) ?? null : null,
    role: d.role ?? null,
    modelName: d.modelName ?? null,
    ok: d.ok,
    errorKind: d.errorKind ?? null,
    latencyMs: d.latencyMs,
    costUsd: d.costUsd,
    fellBack: (d.attempts ?? []).some((a) => a.fallback && a.outcome === "ok"),
    policyHash: d.policyHash ?? null,
    issuesShown: d.outcome?.issuesShown ?? null,
    issuesAccepted: d.outcome?.issuesAccepted ?? null,
    teacherOverrode: d.outcome?.teacherOverrode ?? null,
    saved: !!d.outcome?.saved,
    preview: previewOf(d.feature, d.request),
  }));
}

/** A readable one-line preview: a check shows its comment text, the assistant its question. */
export function previewOf(feature: string, request: string): string {
  let s = request;
  if (feature === "comment_check") {
    try {
      const o = JSON.parse(request) as { fields?: Record<string, string> };
      s = Object.values(o.fields ?? {}).join(" · ");
    } catch {
      /* keep the raw text */
    }
  }
  s = s.replace(/\s+/g, " ").trim();
  return s.length > 160 ? `${s.slice(0, 159)}…` : s;
}

export async function aiExchangesPage(authIn: AuthPayload | null, args: PageArgs & AiExchangeFilter): Promise<Page<AiExchangeRow>> {
  assertRead(authIn);
  return queryPage(AiExchange, filterOf(args), { at: -1 }, args, (docs) => rowsOf(docs as unknown as IAiExchange[]), 25);
}

export interface AiExchangeDetail extends AiExchangeRow {
  refType: string | null;
  refId: string | null;
  attempts: IAiExchangeAttempt[];
  /** The fixed instructions + the standard / rules exactly as sent. */
  prefix: string;
  /** The chapter plan (assistant) as sent; null when none. */
  context: string | null;
  history: Array<{ role: string; text: string }>;
  request: string;
  reply: string;
  issueTypes: Record<string, number> | null;
}

export async function aiExchangeDetail(authIn: AuthPayload | null, id: string): Promise<AiExchangeDetail> {
  assertRead(authIn);
  if (!Types.ObjectId.isValid(id)) throw new Error("লগটি পাওয়া যায়নি");
  const d = (await AiExchange.findById(id).lean()) as unknown as IAiExchange | null;
  if (!d) throw new Error("লগটি পাওয়া যায়নি");
  const hashes = [d.prefixHash, d.contextHash].filter((h): h is string => !!h);
  const texts = new Map((await AiPromptText.find({ hash: { $in: hashes } }).lean()).map((t) => [t.hash, t.text]));
  const [row] = await rowsOf([d]);
  return {
    ...row,
    refType: d.refType ?? null,
    refId: d.refId ?? null,
    attempts: d.attempts ?? [],
    prefix: texts.get(d.prefixHash) ?? "",
    context: d.contextHash ? texts.get(d.contextHash) ?? null : null,
    history: d.history ?? [],
    request: d.request,
    reply: d.reply,
    issueTypes: (d.outcome?.issueTypes as Record<string, number> | undefined) ?? null,
  };
}

export interface AiExchangeExportRow extends AiExchangeRow {
  request: string;
  reply: string;
}

/** The filtered log with full request / reply text (newest first, at most 5,000 rows). */
export async function aiExchangesExport(authIn: AuthPayload | null, f: AiExchangeFilter): Promise<AiExchangeExportRow[]> {
  assertRead(authIn);
  const docs = (await AiExchange.find(filterOf(f)).sort({ at: -1 }).limit(EXPORT_LIMIT).lean()) as unknown as IAiExchange[];
  const rows = await rowsOf(docs);
  return rows.map((r, i) => ({ ...r, request: docs[i].request, reply: docs[i].reply }));
}

export async function deleteAiExchange(authIn: AuthPayload | null, id: string): Promise<boolean> {
  const auth = assertDelete(authIn);
  if (!Types.ObjectId.isValid(id)) throw new Error("লগটি পাওয়া যায়নি");
  const d = await AiExchange.findByIdAndDelete(id).lean();
  if (!d) return false;
  await writeAudit({ eventKind: "AI_EXCHANGES_DELETED", actorId: auth.userId, actorRole: auth.role, targetKind: "AiExchange", targetId: id, meta: { count: 1, feature: d.feature, at: d.at } });
  return true;
}

/** Deletes every row matching the filter (feature and / or month; at least one is required). */
export async function deleteAiExchanges(authIn: AuthPayload | null, f: AiExchangeFilter): Promise<number> {
  const auth = assertDelete(authIn);
  if (!f.feature && !f.month) throw new Error("মুছে ফেলার আগে একটি মাস বা একটি সুবিধা বাছাই করুন");
  const res = await AiExchange.deleteMany(filterOf(f));
  const count = res.deletedCount ?? 0;
  if (count > 0) {
    await writeAudit({ eventKind: "AI_EXCHANGES_DELETED", actorId: auth.userId, actorRole: auth.role, targetKind: "AiExchange", meta: { count, feature: f.feature ?? null, month: f.month ?? null } });
  }
  return count;
}
