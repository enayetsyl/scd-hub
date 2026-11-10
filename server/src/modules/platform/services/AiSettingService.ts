/**
 * AiSettingService (D-#967, D-#1090) — where every AI caller gets its key and model.
 *
 *   Gemini:   key = the saved key → GEMINI_API_KEY → none;  model = saved → GEMINI_MODEL → "gemini-flash-latest"
 *   DeepSeek: key = the saved key → DEEPSEEK_API_KEY → none; model = saved → DEEPSEEK_MODEL → "deepseek-flash"
 *
 * The existing Gemini callers (monthly comments, observation rota, support-book author,
 * voice tasks) build their provider synchronously, so the saved rows are held in memory:
 * loaded at boot, reloaded on every save, and re-read by `refreshAiConfig()` when older
 * than a minute. The server is ONE process (systemd), so a save is seen at once.
 *
 * Saving TESTS the key + model with a one-line request first — a wrong key or a retired
 * model is refused before it can break anything.
 *
 * AI-1 adds the per-FEATURE settings (`AiFeatureSetting`): which provider + model answers
 * each new AI feature, whether it is switched on (default OFF, D-#1101), and whether it may
 * fall back to the other provider once. The router (`ai/aiRouter.ts`) reads them.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { Types } from "mongoose";
import type { AuthPayload } from "../../../context";
import { callerHasPermission } from "@scd/shared";
import { ForbiddenError } from "../../../middleware/authz";
import { User } from "../../foundation/models/User";
import { AiSetting } from "../models/AiSetting";
import { AiFeatureSetting } from "../models/AiFeatureSetting";
import { AiBudgetSetting } from "../models/AiBudgetSetting";
import { writeAudit } from "./AuditService";
import { AI_PROVIDERS, type AiProviderName } from "../ai/provider";
import { DEEPSEEK_BASE_URL, DEEPSEEK_DEFAULT_MODEL, DEEPSEEK_MODELS } from "../ai/deepseekProvider";

/** The alias Google keeps pointed at the current Flash — never retired. */
export const GEMINI_DEFAULT_MODEL = "gemini-flash-latest";
/** The fast fallback — used when Flash is overloaded (503 "high demand"). */
export const GEMINI_LITE_MODEL = "gemini-flash-lite-latest";

interface Cached {
  key: string | null;
  last4: string | null;
  model: string | null;
  updatedAt: Date | null;
  updatedBy: string | null;
  loadedAt: number;
}
const cache: Record<AiProviderName, Cached | null> = { gemini: null, deepseek: null };

const ENV_KEY: Record<AiProviderName, string> = { gemini: "GEMINI_API_KEY", deepseek: "DEEPSEEK_API_KEY" };
const ENV_MODEL: Record<AiProviderName, string> = { gemini: "GEMINI_MODEL", deepseek: "DEEPSEEK_MODEL" };
const DEFAULT_MODEL: Record<AiProviderName, string> = { gemini: GEMINI_DEFAULT_MODEL, deepseek: DEEPSEEK_DEFAULT_MODEL };
const LABEL: Record<AiProviderName, string> = { gemini: "Gemini", deepseek: "DeepSeek" };

function cipherKey(): Buffer {
  return createHash("sha256")
    .update(process.env.SETTINGS_SECRET || process.env.JWT_SECRET || "dev-secret")
    .digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", cipherKey(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}

/** Null when it cannot be read (e.g. the server secret changed) — callers fall back to .env. */
export function decryptSecret(enc: string): string | null {
  try {
    const raw = Buffer.from(enc, "base64");
    const d = createDecipheriv("aes-256-gcm", cipherKey(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

async function loadProvider(p: AiProviderName): Promise<void> {
  const row = await AiSetting.findOne({ name: p }).lean();
  // The model allows one row per provider; a row whose name is not this provider's is not ours.
  const mine = row && (row as { name?: string }).name && (row as { name?: string }).name !== p ? null : row;
  cache[p] = {
    key: mine?.keyEnc ? decryptSecret(mine.keyEnc) : null,
    last4: mine?.keyLast4 ?? null,
    model: mine?.modelName || null,
    updatedAt: mine?.updatedAt ?? null,
    updatedBy: mine?.updatedBy?.toString() ?? null,
    loadedAt: Date.now(),
  };
  if (mine?.keyEnc && !cache[p]!.key) console.error(`[ai-settings] the saved ${LABEL[p]} key cannot be decrypted (server secret changed?) — using .env`);
}

export async function refreshAiConfig(force = false): Promise<void> {
  for (const p of AI_PROVIDERS) {
    const c = cache[p];
    if (!force && c && Date.now() - c.loadedAt < 60_000) continue;
    await loadProvider(p);
  }
}

/** The key a provider's callers use; null = none configured. */
export function providerKey(p: AiProviderName): string | null {
  return cache[p]?.key || process.env[ENV_KEY[p]] || null;
}

export function providerModel(p: AiProviderName): string {
  return cache[p]?.model || process.env[ENV_MODEL[p]] || DEFAULT_MODEL[p];
}

/** The key every Gemini caller uses; null = none configured. */
export function geminiKey(): string | null {
  return providerKey("gemini");
}

export function geminiModel(): string {
  return providerModel("gemini");
}

export function deepseekKey(): string | null {
  return providerKey("deepseek");
}

export interface AiSettingsView {
  provider: AiProviderName;
  /** SETTING = saved in the app; ENV = from the server's .env; NONE = no key at all. */
  source: "SETTING" | "ENV" | "NONE";
  keyLast4: string | null;
  model: string;
  modelSaved: string | null;
  /** The model used when nothing is saved — the screen shows it as the hint. */
  defaultModel: string;
  updatedAt: Date | null;
  updatedByName: string | null;
}

function assertCanEdit(auth: AuthPayload | null): AuthPayload {
  if (!auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(auth, "system_health:ai_key")) throw new ForbiddenError("এআই সেটিং বদলানোর অনুমতি নেই");
  return auth;
}

function parseProvider(p: string | null | undefined): AiProviderName {
  if (p === undefined || p === null || p === "") return "gemini"; // the D-#967 screen sends no provider
  if ((AI_PROVIDERS as readonly string[]).includes(p)) return p as AiProviderName;
  throw new Error("এআই সেবাটি চেনা যায়নি");
}

export async function aiSettingsView(authIn: AuthPayload | null, providerIn?: string | null): Promise<AiSettingsView> {
  assertCanEdit(authIn);
  const p = parseProvider(providerIn);
  await refreshAiConfig(true);
  const c = cache[p];
  const envKey = process.env[ENV_KEY[p]] || null;
  const name = c?.updatedBy ? (await User.findById(c.updatedBy).select("name").lean())?.name ?? null : null;
  return {
    provider: p,
    source: c?.key ? "SETTING" : envKey ? "ENV" : "NONE",
    keyLast4: c?.key ? c.last4 : envKey ? envKey.slice(-4) : null,
    model: providerModel(p),
    modelSaved: c?.model ?? null,
    defaultModel: process.env[ENV_MODEL[p]] || DEFAULT_MODEL[p],
    updatedAt: c?.updatedAt ?? null,
    updatedByName: name,
  };
}

async function pingGemini(key: string, modelName: string): Promise<number> {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ text: "Reply with the single word OK." }] }], generationConfig: { maxOutputTokens: 512 } }),
    });
    return res.status;
  } catch {
    throw new Error("Gemini-তে পৌঁছানো যায়নি — ইন্টারনেট সংযোগ দেখুন");
  }
}

async function pingDeepseek(key: string, modelName: string): Promise<number> {
  try {
    const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: "user", content: "Reply with the single word OK." }],
        max_tokens: 16,
        reasoning_effort: "none",
      }),
    });
    return res.status;
  } catch {
    throw new Error("DeepSeek-এ পৌঁছানো যায়নি — ইন্টারনেট সংযোগ দেখুন");
  }
}

const KEY_REFUSED = "কী (key) সঠিক নয় বা এর অনুমতি নেই — Google AI Studio থেকে আবার কপি করুন";
const isKeyRefusal = (s: number) => s === 400 || s === 401 || s === 403;
/** Google's "try later" answers — they say nothing about the key or whether the model exists. */
const isBusy = (s: number) => s === 429 || s >= 500;

/**
 * One tiny request — proves the key works and the model still exists.
 * When the chosen model is merely BUSY (Flash's 503 "high demand"), the key is proved on
 * Flash-Lite instead: a busy model is not a retired one (that is a 404), and every caller
 * already falls back to Lite, so a busy minute must not block saving a good key.
 */
export async function testGemini(key: string, modelName: string, ping: (k: string, m: string) => Promise<number> = pingGemini): Promise<void> {
  const status = await ping(key, modelName);
  if (status >= 200 && status < 300) return;
  if (status === 404) throw new Error(`"${modelName}" মডেলটি আর পাওয়া যায় না — ${GEMINI_DEFAULT_MODEL} দিন`);
  if (isKeyRefusal(status)) throw new Error(KEY_REFUSED);
  if (isBusy(status) && modelName !== GEMINI_LITE_MODEL) {
    const lite = await ping(key, GEMINI_LITE_MODEL);
    if (lite >= 200 && lite < 300) return;
    if (isKeyRefusal(lite)) throw new Error(KEY_REFUSED);
  }
  if (status === 429) throw new Error("এই কী-র সীমা শেষ (429) — পরে আবার চেষ্টা করুন বা অন্য কী দিন");
  throw new Error(`Gemini সাড়া দেয়নি (${status}) — একটু পরে আবার চেষ্টা করুন`);
}

/**
 * DeepSeek's answers (api-docs.deepseek.com): 401 wrong key, 402 no balance, 400 / 422 a bad
 * request (an unknown model lands here), 429 rate limit, 5xx busy.
 */
export async function testDeepseek(key: string, modelName: string, ping: (k: string, m: string) => Promise<number> = pingDeepseek): Promise<void> {
  const status = await ping(key, modelName);
  if (status >= 200 && status < 300) return;
  if (status === 401 || status === 403) throw new Error("কী (key) সঠিক নয় — DeepSeek প্ল্যাটফর্ম থেকে আবার কপি করুন");
  if (status === 402) throw new Error("DeepSeek অ্যাকাউন্টে টাকা নেই (402) — ব্যালান্স যোগ করে আবার চেষ্টা করুন");
  if (status === 400 || status === 404 || status === 422) throw new Error(`"${modelName}" মডেলটি DeepSeek চেনে না — ${DEEPSEEK_DEFAULT_MODEL} দিন`);
  if (status === 429) throw new Error("এই কী-র সীমা শেষ (429) — পরে আবার চেষ্টা করুন");
  throw new Error(`DeepSeek সাড়া দেয়নি (${status}) — একটু পরে আবার চেষ্টা করুন`);
}

const TESTERS: Record<AiProviderName, (key: string, model: string) => Promise<void>> = {
  gemini: (k, m) => testGemini(k, m),
  deepseek: (k, m) => testDeepseek(k, m),
};

/**
 * Save a new key and/or model for one provider (each optional; an empty model = back to
 * the default). Tested first; audited WITHOUT the key. `test` is injectable for tests.
 * No `provider` = Gemini, so the D-#967 screen on old phone bundles keeps working.
 */
export async function setAiSettings(
  authIn: AuthPayload | null,
  input: { apiKey?: string | null; model?: string | null; provider?: string | null },
  test?: (key: string, model: string) => Promise<void>,
): Promise<AiSettingsView> {
  const auth = assertCanEdit(authIn);
  const p = parseProvider(input.provider);
  await refreshAiConfig(true);
  const newKey = input.apiKey?.trim() || null;
  // Shape only — the provider's own test below is the real check. Keys are not one format:
  // classic "AIza…" (39 chars), the newer AI Studio "AQ.…" keys with dots, DeepSeek "sk-…".
  if (newKey && /\s/.test(newKey)) throw new Error("কী-র মাঝে ফাঁকা জায়গা আছে — আবার কপি করে বসান");
  if (newKey && !/^[\x21-\x7E]{20,300}$/.test(newKey)) throw new Error("কী (key) দেখতে সঠিক নয়");
  const modelChanged = input.model !== undefined && input.model !== null;
  const newModel = modelChanged ? input.model!.trim() || null : cache[p]?.model ?? null;
  if (newModel && !/^[a-z0-9.\-]{3,80}$/.test(newModel)) throw new Error("মডেলের নাম সঠিক নয়");
  if (!newKey && !modelChanged) throw new Error("নতুন কী বা মডেল দিন");

  const keyToUse = newKey ?? providerKey(p);
  if (!keyToUse) throw new Error("আগে একটি কী দিন");
  await (test ?? TESTERS[p])(keyToUse, newModel || process.env[ENV_MODEL[p]] || DEFAULT_MODEL[p]);

  const set: Record<string, unknown> = { updatedBy: new Types.ObjectId(auth.userId) };
  const unset: Record<string, 1> = {};
  if (newKey) {
    set.keyEnc = encryptSecret(newKey);
    set.keyLast4 = newKey.slice(-4);
  }
  if (modelChanged) {
    if (newModel) set.modelName = newModel;
    else unset.modelName = 1;
  }
  await AiSetting.updateOne({ name: p }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { upsert: true });
  await writeAudit({
    eventKind: "AI_SETTINGS_CHANGED",
    actorId: auth.userId,
    actorRole: auth.role,
    targetKind: "AiSetting",
    meta: { provider: p, keyChanged: !!newKey, keyLast4: newKey ? newKey.slice(-4) : undefined, model: modelChanged ? newModel ?? "(default)" : undefined },
  });
  return aiSettingsView(auth, p);
}

/** Forget the saved key — the server's .env key (if any) is used again. Audited. */
export async function clearAiKey(authIn: AuthPayload | null, providerIn?: string | null): Promise<AiSettingsView> {
  const auth = assertCanEdit(authIn);
  const p = parseProvider(providerIn);
  await AiSetting.updateOne({ name: p }, { $unset: { keyEnc: 1, keyLast4: 1 }, $set: { updatedBy: new Types.ObjectId(auth.userId) } });
  await writeAudit({ eventKind: "AI_SETTINGS_CHANGED", actorId: auth.userId, actorRole: auth.role, targetKind: "AiSetting", meta: { provider: p, keyCleared: true } });
  return aiSettingsView(auth, p);
}

// ---------------------------------------------------------------------------
// Per-feature settings (AI-1)
// ---------------------------------------------------------------------------

/**
 * The AI features this server knows. A feature joins this list in the slice that builds it;
 * AI-1 lists the two the PRD plans so their settings can be prepared. Labels are what the
 * Principal reads on the settings screen.
 */
export const AI_FEATURES = [
  // Default caps = the owner's rulings of 2026-11-08 (D-#1103); each is changeable in the app.
  { key: "comment_check", bn: "মন্তব্য যাচাই", en: "Comment checker", dailyPerUser: 80, monthlyUsd: 3, perSessionTurns: null, defaultProvider: "deepseek", defaultFallback: true },
  { key: "assistant", bn: "শিক্ষকের সহকারী", en: "Teacher assistant", dailyPerUser: 30, monthlyUsd: 5, perSessionTurns: 40, defaultProvider: "deepseek", defaultFallback: true },
  // AI Workspace (docs/prd-ai-workspace.md). Fallback OFF by default (D-#1226). W-1: reading a
  // scanned PDF or a picture with Gemini vision, one file per call (D-#1227).
  { key: "workspace_ocr", bn: "কর্মক্ষেত্র: Gemini দিয়ে ফাইল পড়া", en: "Workspace: read a file with Gemini", dailyPerUser: 100, monthlyUsd: 10, perSessionTurns: null, defaultProvider: "gemini", defaultFallback: false },
  // W-2: project chat — no per-session turn cap (full history, D-#1204); the model per message
  // comes from the chat's picker (D-#1205).
  { key: "workspace_chat", bn: "কর্মক্ষেত্র: প্রকল্পে আলাপ", en: "Workspace: project chat", dailyPerUser: 300, monthlyUsd: 10, perSessionTurns: null, defaultProvider: "deepseek", defaultFallback: false },
] as const;
export type AiFeatureKey = (typeof AI_FEATURES)[number]["key"];

/** The features the caps and the global budget cover. Older Gemini features are metered, not capped (D-#1124). */
export const CAPPED_AI_FEATURES: readonly string[] = AI_FEATURES.map((f) => f.key);

/** Every AI Workspace feature key (some join AI_FEATURES in later slices); they share the
 *  workspace monthly cap, which sits inside the school budget (D-#1225). */
export const WORKSPACE_AI_FEATURES: readonly string[] = ["workspace_ocr", "workspace_chat", "workspace_draft", "workspace_job"];

export const AI_BUDGET_DEFAULTS = { monthlyUsd: 8, alertPct: 70, workspaceMonthlyUsd: 10 } as const;

/** The workspace-wide defaults a new project starts from (D-#1206: thinking starts HIGH). */
export const WORKSPACE_THINKING = ["off", "low", "high"] as const;
export type WorkspaceThinking = (typeof WORKSPACE_THINKING)[number];
export const WORKSPACE_DEFAULTS = { model: DEEPSEEK_DEFAULT_MODEL, thinking: "high" as WorkspaceThinking };

export interface AiFeatureView {
  feature: AiFeatureKey;
  labelBn: string;
  labelEn: string;
  enabled: boolean;
  provider: AiProviderName;
  /** Saved model for this feature; null = the provider's own model. */
  modelSaved: string | null;
  /** The model that will answer. */
  model: string;
  fallback: boolean;
  /** Whether the chosen provider has a key at all. */
  providerReady: boolean;
  /** Calls one person may make per Dhaka day (AI-2). */
  dailyPerUser: number;
  /** USD this feature may spend per Dhaka month (AI-2). */
  monthlyUsd: number;
  /** Turns per assistant session; null = no per-session cap. */
  perSessionTurns: number | null;
  updatedAt: Date | null;
}

interface FeatureRow {
  feature: string;
  enabled?: boolean;
  provider?: AiProviderName;
  modelName?: string | null;
  fallback?: boolean;
  dailyPerUser?: number | null;
  monthlyUsd?: number | null;
  perSessionTurns?: number | null;
  updatedAt?: Date;
}

function featureView(f: (typeof AI_FEATURES)[number], row: FeatureRow | null): AiFeatureView {
  const provider = row?.provider ?? f.defaultProvider;
  return {
    feature: f.key,
    labelBn: f.bn,
    labelEn: f.en,
    enabled: row?.enabled ?? false,
    provider,
    modelSaved: row?.modelName || null,
    model: row?.modelName || providerModel(provider),
    fallback: row?.fallback ?? f.defaultFallback,
    providerReady: !!providerKey(provider),
    dailyPerUser: row?.dailyPerUser ?? f.dailyPerUser,
    monthlyUsd: row?.monthlyUsd ?? f.monthlyUsd,
    perSessionTurns: row?.perSessionTurns ?? f.perSessionTurns,
    updatedAt: row?.updatedAt ?? null,
  };
}

/** Internal (no caller check): one feature's current settings, defaults filled in. */
export async function aiFeatureConfig(featureKey: string): Promise<AiFeatureView> {
  const f = findFeature(featureKey);
  const row = ((await AiFeatureSetting.findOne({ feature: f.key }).lean()) as FeatureRow | null) ?? null;
  return featureView(f, row);
}

function checkCap(value: number | null | undefined, label: string, max: number): void {
  if (value === null || value === undefined) return;
  if (!Number.isFinite(value) || value < 0 || value > max) throw new Error(`${label} ০ থেকে ${max}-এর মধ্যে দিন`);
}

function findFeature(key: string): (typeof AI_FEATURES)[number] {
  const f = AI_FEATURES.find((x) => x.key === key);
  if (!f) throw new Error("এই এআই সুবিধাটি চেনা যায়নি");
  return f;
}

export async function aiFeatureSettings(authIn: AuthPayload | null): Promise<AiFeatureView[]> {
  assertCanEdit(authIn);
  await refreshAiConfig(true);
  const rows = (await AiFeatureSetting.find({ feature: { $in: AI_FEATURES.map((f) => f.key) } }).lean()) as FeatureRow[];
  return AI_FEATURES.map((f) => featureView(f, rows.find((r) => r.feature === f.key) ?? null));
}

/**
 * Change one feature's switch / provider / model / fallback. Switching a feature ON, or
 * changing its provider or model while it is on, tests that provider's key with that model
 * first — a feature is never left pointing at a model that cannot answer.
 */
export async function setAiFeatureSetting(
  authIn: AuthPayload | null,
  input: {
    feature: string;
    enabled?: boolean | null;
    provider?: string | null;
    model?: string | null;
    fallback?: boolean | null;
    dailyPerUser?: number | null;
    monthlyUsd?: number | null;
    perSessionTurns?: number | null;
  },
  test?: (provider: AiProviderName, key: string, model: string) => Promise<void>,
): Promise<AiFeatureView> {
  const auth = assertCanEdit(authIn);
  const f = findFeature(input.feature);
  checkCap(input.dailyPerUser, "দৈনিক সীমা", 10_000);
  checkCap(input.monthlyUsd, "মাসিক খরচের সীমা (ডলার)", 1_000);
  checkCap(input.perSessionTurns, "এক আলাপে সর্বোচ্চ প্রশ্ন", 1_000);
  if (input.dailyPerUser !== null && input.dailyPerUser !== undefined && !Number.isInteger(input.dailyPerUser)) throw new Error("দৈনিক সীমা পূর্ণ সংখ্যা দিন");
  if (input.perSessionTurns !== null && input.perSessionTurns !== undefined && !Number.isInteger(input.perSessionTurns)) throw new Error("এক আলাপে সর্বোচ্চ প্রশ্ন পূর্ণ সংখ্যা দিন");
  await refreshAiConfig(true);
  const before = ((await AiFeatureSetting.findOne({ feature: f.key }).lean()) as FeatureRow | null) ?? null;

  const enabled = input.enabled ?? before?.enabled ?? false;
  const provider = input.provider ? parseProvider(input.provider) : before?.provider ?? f.defaultProvider;
  const modelChanged = input.model !== undefined && input.model !== null;
  const modelName = modelChanged ? input.model!.trim() || null : before?.modelName || null;
  if (modelName && !/^[a-z0-9.\-]{3,80}$/.test(modelName)) throw new Error("মডেলের নাম সঠিক নয়");
  const fallback = input.fallback ?? before?.fallback ?? f.defaultFallback;

  const needsTest = enabled && (!before?.enabled || provider !== (before?.provider ?? f.defaultProvider) || modelChanged);
  if (needsTest) {
    const key = providerKey(provider);
    if (!key) throw new Error(`আগে ${LABEL[provider]}-এর কী দিন`);
    const m = modelName || providerModel(provider);
    await (test ? test(provider, key, m) : TESTERS[provider](key, m));
  }

  const set: Record<string, unknown> = { enabled, provider, fallback, updatedBy: new Types.ObjectId(auth.userId) };
  const unset: Record<string, 1> = {};
  if (modelName) set.modelName = modelName;
  else unset.modelName = 1;
  const caps: Record<string, number> = {};
  for (const k of ["dailyPerUser", "monthlyUsd", "perSessionTurns"] as const) {
    const v = input[k];
    if (v !== null && v !== undefined) caps[k] = v;
  }
  Object.assign(set, caps);
  await AiFeatureSetting.updateOne({ feature: f.key }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { upsert: true });
  await writeAudit({
    eventKind: "AI_SETTINGS_CHANGED",
    actorId: auth.userId,
    actorRole: auth.role,
    targetKind: "AiFeatureSetting",
    meta: { feature: f.key, enabled, provider, model: modelName ?? "(provider default)", fallback, ...caps },
  });
  const row = ((await AiFeatureSetting.findOne({ feature: f.key }).lean()) as FeatureRow | null) ?? null;
  return featureView(f, row);
}

export interface AiRoute {
  enabled: boolean;
  primary: { provider: AiProviderName; model: string; key: string | null };
  /** The other provider, when fallback is on and it has a key. */
  fallback: { provider: AiProviderName; model: string; key: string } | null;
}

/** Internal (no caller check): how the router answers one feature right now. */
export async function aiRouteFor(featureKey: string): Promise<AiRoute> {
  const f = findFeature(featureKey);
  await refreshAiConfig();
  const row = ((await AiFeatureSetting.findOne({ feature: f.key }).lean()) as FeatureRow | null) ?? null;
  const v = featureView(f, row);
  const other: AiProviderName = v.provider === "deepseek" ? "gemini" : "deepseek";
  const otherKey = providerKey(other);
  return {
    enabled: v.enabled,
    primary: { provider: v.provider, model: v.model, key: providerKey(v.provider) },
    fallback: v.fallback && otherKey ? { provider: other, model: providerModel(other), key: otherKey } : null,
  };
}

// ---------------------------------------------------------------------------
// The school-wide AI budget (AI-2, D-#1103)
// ---------------------------------------------------------------------------

export interface AiBudgetView {
  /** USD per Dhaka month across the capped AI features. */
  monthlyUsd: number;
  /** The Principal is alerted when any monthly cap reaches this percent. */
  alertPct: number;
  /** AI Workspace (D-#1225): USD per Dhaka month across every workspace feature, inside `monthlyUsd`. */
  workspaceMonthlyUsd: number;
  /** AI Workspace (D-#1206): the defaults a new project starts from. */
  workspaceDefaultModel: string;
  workspaceDefaultThinking: WorkspaceThinking;
  updatedAt: Date | null;
}

export interface AiBudgetScreenView extends AiBudgetView {
  /** Sum of the monthly caps the school budget must cover: each non-workspace feature + the workspace cap. */
  capsTotalUsd: number;
  /** True when those caps add up to more than the school budget — a cap could never be reached (D-#1225). */
  capsOverBudget: boolean;
}

interface BudgetRow {
  monthlyUsd?: number;
  alertPct?: number;
  workspaceMonthlyUsd?: number;
  workspaceDefaultModel?: string;
  workspaceDefaultThinking?: WorkspaceThinking;
  updatedAt?: Date;
}

/** Internal (no caller check): the budget with defaults filled in. */
export async function aiBudgetConfig(): Promise<AiBudgetView> {
  const row = (await AiBudgetSetting.findOne({ name: "global" }).lean()) as BudgetRow | null;
  return {
    monthlyUsd: row?.monthlyUsd ?? AI_BUDGET_DEFAULTS.monthlyUsd,
    alertPct: row?.alertPct ?? AI_BUDGET_DEFAULTS.alertPct,
    workspaceMonthlyUsd: row?.workspaceMonthlyUsd ?? AI_BUDGET_DEFAULTS.workspaceMonthlyUsd,
    workspaceDefaultModel: row?.workspaceDefaultModel ?? WORKSPACE_DEFAULTS.model,
    workspaceDefaultThinking: row?.workspaceDefaultThinking ?? WORKSPACE_DEFAULTS.thinking,
    updatedAt: row?.updatedAt ?? null,
  };
}

/** The caps the school budget has to cover (each non-workspace feature + the workspace cap). */
export async function aiCapsTotalUsd(budget: AiBudgetView): Promise<number> {
  const rows = (await AiFeatureSetting.find({ feature: { $in: AI_FEATURES.map((f) => f.key) } }).lean()) as FeatureRow[];
  const others = AI_FEATURES.filter((f) => !WORKSPACE_AI_FEATURES.includes(f.key))
    .map((f) => featureView(f, rows.find((r) => r.feature === f.key) ?? null).monthlyUsd)
    .reduce((a, b) => a + b, 0);
  return Math.round((others + budget.workspaceMonthlyUsd) * 100) / 100;
}

export async function aiBudgetView(authIn: AuthPayload | null): Promise<AiBudgetScreenView> {
  assertCanEdit(authIn);
  const b = await aiBudgetConfig();
  const capsTotalUsd = await aiCapsTotalUsd(b);
  return { ...b, capsTotalUsd, capsOverBudget: capsTotalUsd > b.monthlyUsd };
}

export async function setAiBudget(
  authIn: AuthPayload | null,
  input: {
    monthlyUsd?: number | null;
    alertPct?: number | null;
    workspaceMonthlyUsd?: number | null;
    workspaceDefaultModel?: string | null;
    workspaceDefaultThinking?: string | null;
  },
): Promise<AiBudgetScreenView> {
  const auth = assertCanEdit(authIn);
  checkCap(input.monthlyUsd, "মাসিক মোট খরচের সীমা (ডলার)", 1_000);
  checkCap(input.workspaceMonthlyUsd, "এআই কর্মক্ষেত্রের মাসিক সীমা (ডলার)", 1_000);
  if (input.alertPct !== null && input.alertPct !== undefined && (!Number.isInteger(input.alertPct) || input.alertPct < 1 || input.alertPct > 100)) {
    throw new Error("সতর্কবার্তার শতাংশ ১ থেকে ১০০-এর মধ্যে পূর্ণ সংখ্যা দিন");
  }
  if (input.workspaceDefaultModel && !(DEEPSEEK_MODELS as readonly string[]).includes(input.workspaceDefaultModel)) {
    throw new Error("এই মডেলটি কর্মক্ষেত্রে চলে না");
  }
  if (input.workspaceDefaultThinking && !(WORKSPACE_THINKING as readonly string[]).includes(input.workspaceDefaultThinking)) {
    throw new Error("চিন্তার মাত্রা সঠিক নয়");
  }
  const now = await aiBudgetConfig();
  const next = {
    monthlyUsd: input.monthlyUsd ?? now.monthlyUsd,
    alertPct: input.alertPct ?? now.alertPct,
    workspaceMonthlyUsd: input.workspaceMonthlyUsd ?? now.workspaceMonthlyUsd,
    workspaceDefaultModel: input.workspaceDefaultModel || now.workspaceDefaultModel,
    workspaceDefaultThinking: (input.workspaceDefaultThinking as WorkspaceThinking | null | undefined) || now.workspaceDefaultThinking,
  };
  await AiBudgetSetting.updateOne({ name: "global" }, { $set: { ...next, updatedBy: new Types.ObjectId(auth.userId) } }, { upsert: true });
  await writeAudit({ eventKind: "AI_SETTINGS_CHANGED", actorId: auth.userId, actorRole: auth.role, targetKind: "AiBudgetSetting", meta: next });
  return aiBudgetView(auth);
}
