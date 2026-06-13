/**
 * MessageTemplateService (MT-1; prd-message-templates §3.4/§4, D-#128–#131) — the
 * resolver + renderer + edit/reset surface for the generated-message registry.
 *
 *   getEffectiveTemplate(key)  → the admin override row if present, else the code
 *                                default (MESSAGE_TEMPLATE_REGISTRY); flags isDefault.
 *   renderTemplate(key, params)→ resolves the effective template, interpolates the
 *                                {curly} placeholders (a missing declared placeholder
 *                                renders BLANK, never throws — D-#129), and emits per
 *                                langMode (BN / EN / BOTH = Bangla then English).
 *   editMessageTemplate(...)   → Principal-only (resolver-gated template:manage):
 *                                edit-time placeholder validation + empty-EN guard,
 *                                prior body audited (MESSAGE_TEMPLATE_EDITED) FIRST,
 *                                then the override row is upserted.
 *   resetMessageTemplate(key)  → deletes the override row (default returns instantly),
 *                                audited as an edit.
 *
 * The override read is BEST-EFFORT (D-#75 posture): if the DB is not connected or the
 * read throws, the CODE DEFAULT is used — a generated message never fails to send, and
 * pure unit tests (no DB) resolve the byte-identical default (the model sets
 * `bufferCommands:false`, so a no-connection read throws at once rather than hanging).
 * No seed write ever runs (D-#97/#103). Identity/operational plane; NO corpus path (ADR-005).
 */
import {
  MESSAGE_TEMPLATE_KEYS,
  MESSAGE_TEMPLATE_REGISTRY,
  TEMPLATE_LANGUAGE_MODES,
  type MessageTemplateKey,
  type MessageTemplateDef,
  type TemplateLanguageMode,
} from "@scd/shared";
import { MessageTemplate, type IMessageTemplate } from "../models/MessageTemplate";
import { writeAudit } from "../../platform/services/AuditService";

/** Edit-time validation failure (Bangla, surfaced to the Principal — the §4 "422"). */
export class MessageTemplateError extends Error {}

/** Runtime guard: is `key` a controlled template key? */
export function isMessageTemplateKey(key: string): key is MessageTemplateKey {
  return (MESSAGE_TEMPLATE_KEYS as readonly string[]).includes(key);
}

/** The {curly} tokens that appear in a body (deduped). */
export function templateTokens(body: string | undefined): string[] {
  if (!body) return [];
  return [...new Set([...body.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
}

/** Interpolate `{name}` → params[name]; a missing declared placeholder → "" (D-#129).
 *  Single-pass replace: inserted values are NOT re-scanned for further tokens. */
export function interpolate(body: string, params: Record<string, unknown>): string {
  return body.replace(/\{(\w+)\}/g, (_m, k: string) =>
    params[k] !== undefined && params[k] !== null ? String(params[k]) : "",
  );
}

export interface EffectiveTemplate {
  key: MessageTemplateKey;
  bnBody: string;
  enBody?: string;
  langMode: TemplateLanguageMode;
  /** True ⇒ no admin override; the code default is in effect. */
  isDefault: boolean;
  def: MessageTemplateDef;
}

/** Resolve the override-or-default for a key. Best-effort DB read (see header). */
export async function getEffectiveTemplate(key: MessageTemplateKey): Promise<EffectiveTemplate> {
  const def = MESSAGE_TEMPLATE_REGISTRY[key];
  let row: IMessageTemplate | null = null;
  try {
    row = (await MessageTemplate.findOne({ key }).lean()) as unknown as IMessageTemplate | null;
  } catch (err) {
    // No live connection / transient read failure → fall back to the code default.
    console.error(`[MessageTemplate] override read failed for "${key}" — using code default:`, err);
  }
  if (row) {
    return {
      key,
      bnBody: row.bnBody && row.bnBody.length > 0 ? row.bnBody : def.bnDefault,
      enBody: row.enBody ?? def.enDefault,
      langMode: row.langMode,
      isDefault: false,
      def,
    };
  }
  return { key, bnBody: def.bnDefault, enBody: def.enDefault, langMode: def.defaultLangMode, isDefault: true, def };
}

/** Render the effective template body for `key`, interpolated + emitted per langMode.
 *  This is THE call every generated-message site uses (D-#131). Never throws on a
 *  missing placeholder. */
export async function renderTemplate(
  key: MessageTemplateKey,
  params: Record<string, unknown> = {},
): Promise<string> {
  const eff = await getEffectiveTemplate(key);
  const bn = interpolate(eff.bnBody, params);
  const en = eff.enBody ? interpolate(eff.enBody, params) : "";
  switch (eff.langMode) {
    case "EN":
      return en;
    case "BOTH":
      return en ? `${bn}\n\n${en}` : bn;
    case "BN":
    default:
      return bn;
  }
}

/** Render a sample with the §3.4 sample values (MT-3 live preview). Unknown
 *  placeholders fall back to the bracketed name so the Principal sees the shape. */
export function renderPreview(eff: EffectiveTemplate, sample: Record<string, string>): string {
  const fill = (body: string | undefined): string =>
    body
      ? body.replace(/\{(\w+)\}/g, (_m, k: string) => (sample[k] !== undefined ? sample[k] : `[${k}]`))
      : "";
  const bn = fill(eff.bnBody);
  const en = fill(eff.enBody);
  switch (eff.langMode) {
    case "EN":
      return en;
    case "BOTH":
      return en ? `${bn}\n\n${en}` : bn;
    default:
      return bn;
  }
}

// ---------------------------------------------------------------------------
// MT-3 list + history reads
// ---------------------------------------------------------------------------

export interface TemplateListEntry extends EffectiveTemplate {
  group: string;
  labelBn: string;
  placeholders: readonly string[];
  updatedAt?: Date;
  updatedBy?: string;
}

/** Every key with its effective body + default/overridden flag (the MT-3 list). */
export async function listMessageTemplates(): Promise<TemplateListEntry[]> {
  let rows: IMessageTemplate[] = [];
  try {
    rows = (await MessageTemplate.find({}).lean()) as unknown as IMessageTemplate[];
  } catch {
    rows = []; // no connection → all defaults
  }
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return MESSAGE_TEMPLATE_KEYS.map((key) => {
    const def = MESSAGE_TEMPLATE_REGISTRY[key];
    const row = byKey.get(key);
    const eff: EffectiveTemplate = row
      ? {
          key,
          bnBody: row.bnBody && row.bnBody.length > 0 ? row.bnBody : def.bnDefault,
          enBody: row.enBody ?? def.enDefault,
          langMode: row.langMode,
          isDefault: false,
          def,
        }
      : { key, bnBody: def.bnDefault, enBody: def.enDefault, langMode: def.defaultLangMode, isDefault: true, def };
    return {
      ...eff,
      group: def.group,
      labelBn: def.labelBn,
      placeholders: def.placeholders,
      updatedAt: row?.updatedAt,
      updatedBy: row?.updatedBy?.toString(),
    };
  });
}

export interface TemplateHistoryEntry {
  at: Date;
  actorId?: string;
  action: string;
  priorBnBody?: string;
  priorEnBody?: string;
  priorLangMode?: string;
  wasDefault: boolean;
}

/** The append-only edit history for a key (MESSAGE_TEMPLATE_EDITED audit rows). */
export async function messageTemplateHistory(
  key: MessageTemplateKey,
  limit = 50,
): Promise<TemplateHistoryEntry[]> {
  const { Audit } = await import("../../platform/models/Audit");
  let rows: Array<{ eventAt: Date; actorId?: { toString(): string }; meta?: Record<string, unknown> }> = [];
  try {
    rows = (await Audit.find({ eventKind: "MESSAGE_TEMPLATE_EDITED", "meta.key": key })
      .sort({ eventAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 200))
      .lean()) as unknown as typeof rows;
  } catch {
    rows = [];
  }
  return rows.map((r) => ({
    at: r.eventAt,
    actorId: r.actorId?.toString(),
    action: (r.meta?.action as string) ?? "edit",
    priorBnBody: r.meta?.priorBnBody as string | undefined,
    priorEnBody: r.meta?.priorEnBody as string | undefined,
    priorLangMode: r.meta?.priorLangMode as string | undefined,
    wasDefault: Boolean(r.meta?.wasDefault),
  }));
}

// ---------------------------------------------------------------------------
// Edit + reset (Principal-only — the resolver gates template:manage)
// ---------------------------------------------------------------------------

export interface EditTemplateInput {
  key: string;
  bnBody: string;
  enBody?: string | null;
  langMode: string;
  actorId: string;
}

/** Validate + save an override row. Prior body is audited FIRST (ADR-008), then the
 *  row is upserted. Throws MessageTemplateError (Bangla 422) on any edit-safety break. */
export async function editMessageTemplate(input: EditTemplateInput): Promise<IMessageTemplate> {
  if (!isMessageTemplateKey(input.key)) {
    throw new MessageTemplateError(`অজানা টেমপ্লেট কী: ${input.key}`);
  }
  const key = input.key;
  const def = MESSAGE_TEMPLATE_REGISTRY[key];

  const bnBody = (input.bnBody ?? "").trim();
  const enBody = input.enBody != null ? input.enBody.trim() : "";
  if (bnBody.length === 0) {
    throw new MessageTemplateError("বাংলা বার্তা খালি রাখা যাবে না।");
  }
  if (!(TEMPLATE_LANGUAGE_MODES as readonly string[]).includes(input.langMode)) {
    throw new MessageTemplateError(`অজানা ভাষা মোড: ${input.langMode}`);
  }
  const langMode = input.langMode as TemplateLanguageMode;

  // Placeholder validation (D-#129): a body may use ONLY the declared placeholders.
  const declared = new Set(def.placeholders);
  const allowedList = def.placeholders.length > 0 ? def.placeholders.map((p) => `{${p}}`).join(", ") : "(কোনো প্লেসহোল্ডার নেই)";
  for (const token of [...templateTokens(bnBody), ...templateTokens(enBody)]) {
    if (!declared.has(token)) {
      throw new MessageTemplateError(
        `অননুমোদিত প্লেসহোল্ডার "{${token}}"। এই বার্তায় কেবল এই প্লেসহোল্ডারগুলো ব্যবহার করা যাবে: ${allowedList}`,
      );
    }
  }

  // Empty-EN guard (D-#130): cannot set EN/BOTH without an English body.
  if ((langMode === "EN" || langMode === "BOTH") && enBody.length === 0) {
    throw new MessageTemplateError("ইংরেজি বার্তা না থাকলে ভাষা মোড ইংরেজি বা উভয় করা যাবে না।");
  }

  // Audit the PRIOR body first (append-only, ADR-008 / D-#101 pattern).
  const prior = (await MessageTemplate.findOne({ key }).lean()) as unknown as IMessageTemplate | null;
  await writeAudit({
    eventKind: "MESSAGE_TEMPLATE_EDITED",
    actorId: input.actorId,
    actorRole: "PRINCIPAL",
    targetKind: "MessageTemplate",
    meta: {
      key,
      action: "edit",
      wasDefault: !prior,
      priorBnBody: prior?.bnBody ?? def.bnDefault,
      priorEnBody: prior?.enBody ?? def.enDefault,
      priorLangMode: prior?.langMode ?? def.defaultLangMode,
      newLangMode: langMode,
    },
  });

  const saved = (await MessageTemplate.findOneAndUpdate(
    { key },
    { $set: { bnBody, enBody: enBody.length > 0 ? enBody : undefined, langMode, updatedBy: input.actorId } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )) as IMessageTemplate;
  return saved;
}

export interface ResetResult {
  key: MessageTemplateKey;
  reset: boolean; // false = there was no override to reset (already default)
}

/** Delete the override row → the code default returns instantly (D-#130, J3). Audited
 *  as an edit when a row existed. Idempotent (no row → no-op, reset:false). */
export async function resetMessageTemplate(key: string, actorId: string): Promise<ResetResult> {
  if (!isMessageTemplateKey(key)) {
    throw new MessageTemplateError(`অজানা টেমপ্লেট কী: ${key}`);
  }
  const prior = (await MessageTemplate.findOne({ key }).lean()) as unknown as IMessageTemplate | null;
  if (!prior) return { key, reset: false };

  await writeAudit({
    eventKind: "MESSAGE_TEMPLATE_EDITED",
    actorId,
    actorRole: "PRINCIPAL",
    targetKind: "MessageTemplate",
    meta: {
      key,
      action: "reset",
      wasDefault: false,
      priorBnBody: prior.bnBody,
      priorEnBody: prior.enBody,
      priorLangMode: prior.langMode,
    },
  });
  await MessageTemplate.deleteOne({ key });
  return { key, reset: true };
}
