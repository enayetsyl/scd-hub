/**
 * CommentCheckService (AI-5) — the AI comment checker.
 *
 *   checkComment   the teacher's text → issues + a corrected version. Nothing is saved and
 *                  nothing reaches a guardian here (D-#1095): the teacher then accepts all,
 *                  some, or none, and saves through the usual mutation.
 *   aiCheckStamp   at save time, turns the client's claim into the stored `aiCheck` stamp.
 *                  A CHECKED stamp needs a server-signed token from `checkComment`, so a
 *                  client cannot mark unchecked text as checked.
 *
 * Fail-open (D-#1100): a switched-off feature, no active standard, a cap, the AI being
 * down, or a name the de-identification could not hide all return NOT_CHECKED with a
 * Bangla reason — never an error the teacher has to get past.
 *
 * Prompt (D-#1090 cache order): stable prefix = the fixed instructions + the active
 * standard(s) (identical for every call under one policy version) → the variable part =
 * this comment, de-identified (D-#1094), with the mark % for a class test (never a name).
 */
import { createHmac, timingSafeEqual } from "crypto";
import type { AuthPayload } from "../../../context";
import { callerHasPermission } from "@scd/shared";
import { ForbiddenError } from "../../../middleware/authz";
import { aiSend, AiFeatureOffError } from "../ai/aiRouter";
import { AiProviderError } from "../ai/provider";
import { assertDeidentified, deidentify, DeidentifyError, reidentify } from "../ai/deidentify";
import { scopeForStudent } from "./DeidScopeService";
import { activeAiPolicy } from "./AiPolicyService";
import { aiFeatureConfig } from "./AiSettingService";
import { AiCapError } from "./AiUsageService";
import type { IAiCheck } from "../models/aiCheckSchema";

export type CheckKind = "DAILY" | "CT";
export const CT_FIELDS = ["weakness", "guardianAction", "teacherAction"] as const;
export const ISSUE_TYPES = ["punctuation", "tone", "honorific", "structure", "standard", "marks", "spelling"] as const;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_FIELD = 4000;

/** The fixed instructions — part of the stable prefix, so they never vary per call. */
export const CHECKER_INSTRUCTIONS = `You check comments that teachers of a Bangladeshi school write about a child. The comment is in Bangla (sometimes with English words). Check it against THE STANDARD below and reply ONLY with one JSON object:

{"issues":[{"field":"<field key>","type":"punctuation|tone|honorific|structure|standard|marks|spelling","quote":"<the exact words from the comment>","suggestion":"<the better words, in Bangla>"}],"corrected":{"<field key>":"<the whole field rewritten>"}}

Rules:
- Tokens like [S], [S1], [G1], [T1], [PHONE], [NUM], [ID] stand for hidden names and numbers. Keep every token exactly as written, in the same place. Never invent a name.
- Keep the teacher's meaning and facts. Never add a fact, a date, a number or a promise the teacher did not write.
- "quote" must be copied exactly from the field it is in. Give at most 8 issues, the most important first.
- "corrected" holds every field you were given, rewritten to follow the standard (unchanged if it already does).
- For a class test, "markPct" is the child's mark. Flag text that does not fit the mark (type "marks").
- A line flagged as a school consequence (refusing entry, expulsion): report it as type "standard" and leave it unchanged in "corrected".
- If the comment already follows the standard, return {"issues":[],"corrected":{...the fields unchanged...}}.

THE STANDARD:
`;

export interface CheckIssue {
  field: string;
  type: string;
  quote: string;
  suggestion: string;
}

export interface CheckResult {
  status: "CHECKED" | "NOT_CHECKED";
  /** NOT_CHECKED: FEATURE_OFF · NO_STANDARD · CAPPED · AI_ERROR · NAMES_LEFT · NO_PERMISSION */
  reason: string | null;
  /** A Bangla sentence for the teacher when NOT_CHECKED. */
  message: string | null;
  policyHash: string | null;
  model: string | null;
  issues: CheckIssue[];
  corrected: Array<{ field: string; text: string }>;
  /** Pass back on save to stamp the comment CHECKED. */
  token: string | null;
}

export interface CheckInput {
  kind: CheckKind;
  studentId: string;
  fields: Array<{ field: string; text: string }>;
  /** Class test only: the child's mark as a percentage (0–100). */
  markPct?: number | null;
  /** Daily only: the comment's type / sentiment, for context. */
  commentType?: string | null;
  sentiment?: string | null;
}

const notChecked = (reason: string, message: string): CheckResult => ({
  status: "NOT_CHECKED",
  reason,
  message,
  policyHash: null,
  model: null,
  issues: [],
  corrected: [],
  token: null,
});

function secret(): string {
  return process.env.SETTINGS_SECRET || process.env.JWT_SECRET || "dev-secret";
}

interface TokenClaims {
  sid: string;
  kind: CheckKind;
  policyHash: string;
  model: string;
  issuesFound: number;
  at: number;
}

export function signCheckToken(c: TokenClaims): string {
  const body = Buffer.from(JSON.stringify(c)).toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readCheckToken(token: string | null | undefined, studentId: string, kind: CheckKind, now = Date.now()): TokenClaims | null {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const want = createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenClaims;
    if (c.sid !== studentId || c.kind !== kind || now - c.at > TOKEN_TTL_MS) return null;
    return c;
  } catch {
    return null;
  }
}

function policyKeys(kind: CheckKind): Array<"comment_standard" | "ct_comment_standard"> {
  return kind === "DAILY" ? ["comment_standard"] : ["comment_standard", "ct_comment_standard"];
}

/** Whether the checker can run now for each kind (the composer shows its button only then). */
export async function commentCheckAvailability(auth: AuthPayload | null): Promise<{ daily: boolean; ct: boolean }> {
  if (!auth || !callerHasPermission(auth, "ai_assist:check_comment")) return { daily: false, ct: false };
  const cfg = await aiFeatureConfig("comment_check");
  if (!cfg.enabled) return { daily: false, ct: false };
  const [cs, ct] = await Promise.all([activeAiPolicy("comment_standard"), activeAiPolicy("ct_comment_standard")]);
  return { daily: !!cs, ct: !!cs && !!ct };
}

export function parseReply(json: unknown, allowed: Set<string>): { issues: CheckIssue[]; corrected: Record<string, string> } {
  const o = (json ?? {}) as { issues?: unknown; corrected?: unknown };
  const issues: CheckIssue[] = [];
  if (Array.isArray(o.issues)) {
    for (const raw of o.issues.slice(0, 12)) {
      const i = raw as Record<string, unknown>;
      const field = typeof i.field === "string" && allowed.has(i.field) ? i.field : [...allowed][0];
      const type = typeof i.type === "string" && (ISSUE_TYPES as readonly string[]).includes(i.type) ? i.type : "standard";
      const quote = typeof i.quote === "string" ? i.quote.slice(0, 500) : "";
      const suggestion = typeof i.suggestion === "string" ? i.suggestion.slice(0, 1000) : "";
      if (quote || suggestion) issues.push({ field, type, quote, suggestion });
    }
  }
  const corrected: Record<string, string> = {};
  if (o.corrected && typeof o.corrected === "object") {
    for (const [k, v] of Object.entries(o.corrected as Record<string, unknown>)) {
      if (allowed.has(k) && typeof v === "string") corrected[k] = v.slice(0, MAX_FIELD);
    }
  }
  return { issues, corrected };
}

/** A check ready to send: the de-identified prompt plus what is needed to read the answer. */
export interface PreparedCheck {
  kind: CheckKind;
  studentId: string;
  fields: Array<{ field: string; text: string }>;
  deid: Array<{ field: string; text: string }>;
  map: Record<string, string>;
  policyHash: string;
  stablePrefix: string;
  variablePart: string;
}

/**
 * Everything before the AI call: the active standard(s), the de-identified fields, the
 * fail-closed gate, the prompt. Shared by the live checker and the AI-8 bake-off, so the
 * bake-off measures exactly what teachers will get.
 */
export async function prepareCheck(input: CheckInput): Promise<PreparedCheck | CheckResult> {
  const kind: CheckKind = input.kind === "CT" ? "CT" : "DAILY";
  const allowedFields = kind === "DAILY" ? ["text"] : [...CT_FIELDS];
  const fields = input.fields
    .filter((f) => allowedFields.includes(f.field) && typeof f.text === "string" && f.text.trim().length > 0)
    .map((f) => ({ field: f.field, text: f.text.trim().slice(0, MAX_FIELD) }));
  if (fields.length === 0) return notChecked("EMPTY", "যাচাই করার মতো কোনো লেখা নেই");

  const policies = await Promise.all(policyKeys(kind).map((k) => activeAiPolicy(k)));
  if (policies.some((p) => !p)) return notChecked("NO_STANDARD", "মন্তব্যের মানদণ্ড এখনো চালু হয়নি — যাচাই ছাড়াই সংরক্ষণ করুন");
  const policyHash = policies.map((p) => p!.hash).join("+");
  const stablePrefix = CHECKER_INSTRUCTIONS + policies.map((p) => p!.body).join("\n\n---\n\n");

  let scope;
  try {
    scope = await scopeForStudent(input.studentId);
  } catch {
    return notChecked("AI_ERROR", "শিক্ষার্থী পাওয়া যায়নি");
  }
  const deid = fields.map((f) => ({ field: f.field, ...deidentify(f.text, scope) }));
  const map: Record<string, string> = Object.assign({}, ...deid.map((d) => d.map));
  try {
    for (const d of deid) assertDeidentified(d.text, scope);
  } catch (e) {
    if (e instanceof DeidentifyError) return notChecked("NAMES_LEFT", e.message);
    throw e;
  }

  const variable: Record<string, unknown> = {
    kind: kind === "DAILY" ? "daily comment to the guardian" : "class-test result comment",
    fields: Object.fromEntries(deid.map((d) => [d.field, d.text])),
  };
  if (kind === "DAILY") {
    if (input.commentType) variable.commentType = input.commentType;
    if (input.sentiment) variable.sentiment = input.sentiment;
  } else if (typeof input.markPct === "number" && Number.isFinite(input.markPct)) {
    variable.markPct = Math.max(0, Math.min(100, Math.round(input.markPct)));
    variable.note = "teacherAction is INTERNAL (the guardian never sees it); weakness and guardianAction reach the guardian.";
  }
  return {
    kind,
    studentId: input.studentId,
    fields,
    deid: deid.map((d) => ({ field: d.field, text: d.text })),
    map,
    policyHash,
    stablePrefix,
    variablePart: JSON.stringify(variable),
  };
}

export const isPrepared = (p: PreparedCheck | CheckResult): p is PreparedCheck => (p as PreparedCheck).stablePrefix !== undefined;

/** The send settings every comment check uses (D-#1132). */
export const CHECK_SEND = { json: true, maxOutputTokens: 800, reasoning: "off" as const };

/** Reads the AI's JSON answer into issues + corrected text, names restored. */
export function finishCheck(p: PreparedCheck, json: unknown, model: string): CheckResult {
  const parsed = parseReply(json, new Set(p.fields.map((f) => f.field)));
  const issues = parsed.issues.map((i) => ({ ...i, quote: reidentify(i.quote, p.map), suggestion: reidentify(i.suggestion, p.map) }));
  const corrected = p.fields.map((f) => ({ field: f.field, text: reidentify(parsed.corrected[f.field] ?? p.deid.find((d) => d.field === f.field)!.text, p.map) }));
  return {
    status: "CHECKED",
    reason: null,
    message: null,
    policyHash: p.policyHash,
    model,
    issues,
    corrected,
    token: signCheckToken({ sid: p.studentId, kind: p.kind, policyHash: p.policyHash, model, issuesFound: issues.length, at: Date.now() }),
  };
}

export async function checkComment(auth: AuthPayload | null, input: CheckInput): Promise<CheckResult> {
  if (!auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(auth, "ai_assist:check_comment")) throw new ForbiddenError("মন্তব্য যাচাইয়ের অনুমতি নেই");
  const p = await prepareCheck(input);
  if (!isPrepared(p)) return p;

  let out;
  try {
    out = await aiSend(
      "comment_check",
      { stablePrefix: p.stablePrefix, variablePart: p.variablePart, ...CHECK_SEND },
      { userId: auth.userId, role: auth.role, refType: p.kind === "DAILY" ? "StudentComment" : "ClassTestResult", refId: p.studentId, policyHash: p.policyHash },
    );
  } catch (e) {
    if (e instanceof AiFeatureOffError) return notChecked("FEATURE_OFF", "মন্তব্য যাচাই এখন বন্ধ আছে");
    if (e instanceof AiCapError) return notChecked("CAPPED", e.message);
    if (e instanceof AiProviderError) return notChecked("AI_ERROR", "এআই এখন সাড়া দিচ্ছে না — যাচাই ছাড়াই সংরক্ষণ করতে পারেন");
    throw e;
  }
  return finishCheck(p, out.result.json, out.result.resolvedModel || out.result.model);
}

/**
 * The stamp stored on save. `undefined` = the checker was off (nothing to record).
 * A valid token → CHECKED with the teacher's choices; otherwise NOT_CHECKED (SKIPPED).
 */
export async function aiCheckStamp(
  claim: { token?: string | null; issuesAccepted?: number | null; teacherOverrode?: boolean | null } | null | undefined,
  studentId: string,
  kind: CheckKind,
): Promise<IAiCheck | undefined> {
  const c = readCheckToken(claim?.token, studentId, kind);
  if (c) {
    const accepted = Math.max(0, Math.min(c.issuesFound, Math.floor(claim?.issuesAccepted ?? 0)));
    return {
      status: "CHECKED",
      policyHash: c.policyHash,
      model: c.model,
      issuesFound: c.issuesFound,
      issuesAccepted: accepted,
      teacherOverrode: c.issuesFound > 0 && (claim?.teacherOverrode ?? accepted === 0),
      checkedAt: new Date(c.at),
    };
  }
  const cfg = await aiFeatureConfig("comment_check");
  if (!cfg.enabled) return undefined;
  return { status: "NOT_CHECKED", reason: "SKIPPED" };
}
