/**
 * THE one entry to every data-assistant tool, for both doors (docs/prd-data-assistant-mcp.md
 * §4.3; D-#1534/#1538/#1539):
 *
 *   fresh auth → feature switch → door switch → rate limit → find + validate → slot →
 *   gate + run (the tool calls the screen's own gate, then the screen's service) →
 *   redact (contacts, §6) → cap (60 KB) → log one AiDataCall row
 *
 * No tool can skip the log or the redaction: they happen here, after `run`.
 */
import { Types } from "mongoose";
import { z } from "zod";
import { callerHasPermission, catalogueAction, FEATURE_CATALOGUE, type CataloguePermission, type Permission } from "@scd/shared";
import type { AuthPayload } from "../../context";
import { ForbiddenError } from "../../middleware/authz";
import { aiFeatureConfig } from "../platform/services/AiSettingService";
import { dhakaDayKey } from "../../lib/dhakaDay";
import { doorOpen, DOOR_PERMISSION, freshAuth } from "./freshAuth";
import { acquireSlot, checkRate, LIMITS, ToolTimeout, withTimeout } from "./limits";
import { AiDataCall } from "./models/AiDataCall";
import { redact } from "./redact";
import { toolContext } from "./toolContext";
import { TOOL_REGISTRY, findTool } from "./tools/registry";
import { permLabel, rulePerms, toolVisible } from "./gates";
export { assertRule, gateOf, passes, permLabel, rulePerms, toolVisible } from "./gates";
import { ToolDenied, ToolInvalid, type DataSurface, type PermissionRule, type ToolDef, type ToolOutcome, type ToolReply, type ToolReplyErr } from "./types";

export interface RunOpts {
  surface: DataSurface;
  clientName?: string | null;
  clientId?: string | null;
  sessionId?: string | null;
  messageId?: string | null;
  /** Test seam: replaces the clock. */
  now?: Date;
}

export interface RunOutcome {
  reply: ToolReply;
  outcome: ToolOutcome;
  callId: string | null;
}

// ---------------------------------------------------------------------------
// Replies
// ---------------------------------------------------------------------------

export function deniedReply(needs: readonly string[], originalBn?: string): ToolReplyErr {
  const bn = needs.map((p) => permLabel(p, "bn")).join(" / ");
  const en = needs.map((p) => permLabel(p, "en")).join(" / ");
  return {
    ok: false,
    error: "permission_denied",
    needs: [...needs],
    message_bn: originalBn && originalBn !== "permission_denied" && /[ঀ-৿]/.test(originalBn) ? `এই তথ্য দেখার অনুমতি আপনার নেই (${originalBn})।` : `এই তথ্য দেখার অনুমতি আপনার নেই (${bn || "অনুমতি"})।`,
    message_en: `You don't have permission to see this (${en || "permission"}).`,
  };
}

const errReply = (error: ToolReplyErr["error"], bn: string, en: string, extra: Partial<ToolReplyErr> = {}): ToolReplyErr => ({ ok: false, error, message_bn: bn, message_en: en, ...extra });

const bytesOf = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");

/**
 * Trims the longest arrays inside `data` until the JSON fits `max` bytes. Returns the trimmed
 * value and whether anything was cut.
 */
export function capReply(data: unknown, max = LIMITS.replyBytes): { data: unknown; trimmed: boolean } {
  if (bytesOf(data) <= max) return { data, trimmed: false };
  const copy = JSON.parse(JSON.stringify(data)) as unknown;
  for (let guard = 0; guard < 200 && bytesOf(copy) > max; guard++) {
    let longest: unknown[] | null = null;
    const visit = (v: unknown) => {
      if (Array.isArray(v)) {
        if (!longest || v.length > longest.length) longest = v;
        v.forEach(visit);
      } else if (v && typeof v === "object") Object.values(v).forEach(visit);
    };
    visit(copy);
    const arr = longest as unknown[] | null;
    if (!arr || arr.length === 0) break;
    arr.splice(Math.max(0, Math.floor(arr.length / 2)));
  }
  if (bytesOf(copy) > max) return { data: { note: "reply too large; ask for a narrower range" }, trimmed: true };
  return { data: copy, trimmed: true };
}

function argsForLog(args: unknown): string {
  let s = JSON.stringify(redact(args ?? {})) ?? "{}";
  if (Buffer.byteLength(s, "utf8") > LIMITS.argsBytes) s = s.slice(0, LIMITS.argsBytes / 2) + "…";
  return s;
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

export async function runTool(authIn: AuthPayload | null, name: string, rawArgs: unknown, opts: RunOpts): Promise<RunOutcome> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  let outcome: ToolOutcome = "error";
  let reply: ToolReply;
  let deniedNeeds: string[] | undefined;
  let rowCount = 0;
  let truncated = false;
  const auth = authIn ? await freshAuth(authIn.userId, authIn) : null;

  reply = await (async (): Promise<ToolReply> => {
    if (!auth || auth.role === "GUARDIAN") {
      outcome = "denied";
      deniedNeeds = [DOOR_PERMISSION[opts.surface]];
      return deniedReply(deniedNeeds);
    }
    const feature = await aiFeatureConfig("data_assistant");
    if (!feature.enabled) {
      outcome = "off";
      return errReply("off", "তথ্য সহকারী এখন বন্ধ আছে। প্রধান শিক্ষক চালু করলে ব্যবহার করা যাবে।", "The data assistant is switched off. The Principal can switch it on.");
    }
    if (!(await doorOpen(auth, opts.surface))) {
      outcome = "denied";
      deniedNeeds = [DOOR_PERMISSION[opts.surface]];
      return deniedReply(deniedNeeds);
    }
    const rate = await checkRate(auth.userId, now.getTime());
    if (rate) {
      outcome = "limited";
      return errReply("rate_limited", `অনেক বেশি প্রশ্ন হয়েছে; ${rate.retryAfterS} সেকেন্ড পরে আবার চেষ্টা করুন।`, `Too many calls; try again in ${rate.retryAfterS} s.`, { retry_after_s: rate.retryAfterS });
    }
    const tool = findTool(name);
    if (!tool) {
      outcome = "invalid";
      return errReply("invalid_arguments", "এমন কোনো টুল নেই।", `Unknown tool "${String(name).slice(0, 60)}". Tools: ${TOOL_REGISTRY.map((t) => t.name).join(", ")}.`);
    }
    const parsed = z.object(tool.input).strict().safeParse(rawArgs ?? {});
    if (!parsed.success) {
      outcome = "invalid";
      const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "(args)"}: ${i.message}`).join("; ").slice(0, 400);
      return errReply("invalid_arguments", `প্রশ্নের তথ্য ঠিক নেই: ${msg}`, `Invalid arguments: ${msg}`);
    }
    if (!toolVisible(tool, auth)) {
      outcome = "denied";
      deniedNeeds = [...new Set(tool.gates.flatMap((g) => rulePerms(g.rule)))];
      return deniedReply(deniedNeeds);
    }
    const release = await acquireSlot(auth.userId);
    if (!release) {
      outcome = "limited";
      return errReply("busy", "সার্ভার এখন ব্যস্ত; একটু পরে আবার চেষ্টা করুন।", "The server is busy; try again shortly.");
    }
    try {
      const ctx = { auth, app: toolContext(auth), today: dhakaDayKey(now), surface: opts.surface };
      const result = await withTimeout(tool.run(ctx, parsed.data as Record<string, unknown>));
      const clean = redact(result.data);
      const capped = capReply(clean);
      rowCount = result.rowCount;
      truncated = !!result.truncated || capped.trimmed;
      outcome = "ok";
      return {
        ok: true,
        as_of: now.toISOString(),
        data: capped.data,
        row_count: result.rowCount,
        ...(truncated ? { truncated: true } : {}),
        ...(result.total !== undefined ? { total: result.total } : {}),
      };
    } catch (e) {
      if (e instanceof ToolDenied) {
        outcome = "denied";
        deniedNeeds = [...e.needs];
        return deniedReply(e.needs, e.message);
      }
      if (e instanceof ForbiddenError) {
        outcome = "denied";
        deniedNeeds = [...new Set(tool.gates.flatMap((g) => rulePerms(g.rule)))];
        return deniedReply(deniedNeeds, e.message);
      }
      if (e instanceof ToolInvalid) {
        outcome = "invalid";
        return errReply("invalid_arguments", e.message, e.message);
      }
      if (e instanceof ToolTimeout) {
        outcome = "error";
        return errReply("timeout", "উত্তর পেতে বেশি সময় লাগছে; ছোট সময়সীমা দিয়ে আবার জিজ্ঞেস করুন।", "This took too long; ask for a shorter range.");
      }
      outcome = "error";
      console.warn(`[data-assistant] ${name} failed:`, (e as Error)?.message);
      return errReply("failed", "তথ্য আনা যায়নি।", "The data could not be read.");
    } finally {
      release();
    }
  })();

  let callId: string | null = null;
  try {
    const row = await AiDataCall.create({
      at: now,
      userId: new Types.ObjectId(Types.ObjectId.isValid(authIn?.userId ?? "") ? authIn!.userId : undefined),
      role: auth?.role ?? authIn?.role ?? "UNKNOWN",
      impersonatorId: authIn?.impersonatorId && Types.ObjectId.isValid(authIn.impersonatorId) ? new Types.ObjectId(authIn.impersonatorId) : null,
      surface: opts.surface,
      clientName: opts.clientName ?? null,
      clientId: opts.clientId ?? null,
      sessionId: opts.sessionId ?? null,
      messageId: opts.messageId ?? null,
      tool: String(name).slice(0, 80),
      args: argsForLog(rawArgs),
      outcome,
      deniedNeeds,
      rowCount,
      truncated,
      replyBytes: bytesOf(reply),
      ms: Date.now() - started,
    });
    callId = String(row._id);
  } catch (e) {
    // A log failure never blocks the answer (§8.1); it is reported.
    console.error("[data-assistant] AiDataCall write failed:", (e as Error)?.message);
  }
  return { reply, outcome, callId };
}
