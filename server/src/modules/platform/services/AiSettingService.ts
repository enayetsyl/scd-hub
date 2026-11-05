/**
 * AiSettingService (D-#967) — where every Gemini caller gets its key and model.
 *
 *   key:   the Principal's saved key (decrypted) → GEMINI_API_KEY → none
 *   model: the saved model → GEMINI_MODEL → "gemini-flash-latest"
 *
 * The callers (monthly comments, observation rota, support-book author, voice tasks)
 * build their provider synchronously, so the saved row is held in memory: loaded at
 * boot, reloaded on every save, and re-read by `refreshAiConfig()` when it is older than
 * a minute. The server is ONE process (systemd), so a save is seen at once.
 *
 * Saving TESTS the key + model with a one-line request first — a wrong key or a model
 * Google has retired (the gemini-2.5-flash 404) is refused before it can break anything.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { Types } from "mongoose";
import type { AuthPayload } from "../../../context";
import { callerHasPermission } from "@scd/shared";
import { ForbiddenError } from "../../../middleware/authz";
import { User } from "../../foundation/models/User";
import { AiSetting } from "../models/AiSetting";
import { writeAudit } from "./AuditService";

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
let cache: Cached | null = null;

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

export async function refreshAiConfig(force = false): Promise<void> {
  if (!force && cache && Date.now() - cache.loadedAt < 60_000) return;
  const row = await AiSetting.findOne({ name: "gemini" }).lean();
  cache = {
    key: row?.keyEnc ? decryptSecret(row.keyEnc) : null,
    last4: row?.keyLast4 ?? null,
    model: row?.modelName || null,
    updatedAt: row?.updatedAt ?? null,
    updatedBy: row?.updatedBy?.toString() ?? null,
    loadedAt: Date.now(),
  };
  if (row?.keyEnc && !cache.key) console.error("[ai-settings] the saved Gemini key cannot be decrypted (server secret changed?) — using .env");
}

/** The key every Gemini caller uses; null = none configured. */
export function geminiKey(): string | null {
  return cache?.key || process.env.GEMINI_API_KEY || null;
}

export function geminiModel(): string {
  return cache?.model || process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL;
}

export interface AiSettingsView {
  /** SETTING = saved in the app; ENV = from the server's .env; NONE = no key at all. */
  source: "SETTING" | "ENV" | "NONE";
  keyLast4: string | null;
  model: string;
  modelSaved: string | null;
  updatedAt: Date | null;
  updatedByName: string | null;
}

function assertCanEdit(auth: AuthPayload | null): AuthPayload {
  if (!auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(auth, "system_health:ai_key")) throw new ForbiddenError("এআই সেটিং বদলানোর অনুমতি নেই");
  return auth;
}

export async function aiSettingsView(authIn: AuthPayload | null): Promise<AiSettingsView> {
  assertCanEdit(authIn);
  await refreshAiConfig(true);
  const envKey = process.env.GEMINI_API_KEY || null;
  const name = cache?.updatedBy ? (await User.findById(cache.updatedBy).select("name").lean())?.name ?? null : null;
  return {
    source: cache?.key ? "SETTING" : envKey ? "ENV" : "NONE",
    keyLast4: cache?.key ? cache.last4 : envKey ? envKey.slice(-4) : null,
    model: geminiModel(),
    modelSaved: cache?.model ?? null,
    updatedAt: cache?.updatedAt ?? null,
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
 * Save a new key and/or model (each optional; an empty model = back to the default).
 * Tested first; audited WITHOUT the key. `test` is injectable for tests.
 */
export async function setAiSettings(
  authIn: AuthPayload | null,
  input: { apiKey?: string | null; model?: string | null },
  test: (key: string, model: string) => Promise<void> = testGemini,
): Promise<AiSettingsView> {
  const auth = assertCanEdit(authIn);
  await refreshAiConfig(true);
  const newKey = input.apiKey?.trim() || null;
  // Shape only — Google's own test below is the real check. Keys are not one format:
  // classic "AIza…" (39 chars) and the newer AI Studio "AQ.…" keys, which carry dots.
  if (newKey && /\s/.test(newKey)) throw new Error("কী-র মাঝে ফাঁকা জায়গা আছে — আবার কপি করে বসান");
  if (newKey && !/^[\x21-\x7E]{20,300}$/.test(newKey)) throw new Error("কী (key) দেখতে সঠিক নয়");
  const modelChanged = input.model !== undefined && input.model !== null;
  const newModel = modelChanged ? input.model!.trim() || null : cache?.model ?? null;
  if (newModel && !/^[a-z0-9.\-]{3,80}$/.test(newModel)) throw new Error("মডেলের নাম সঠিক নয়");
  if (!newKey && !modelChanged) throw new Error("নতুন কী বা মডেল দিন");

  const keyToUse = newKey ?? geminiKey();
  if (!keyToUse) throw new Error("আগে একটি কী দিন");
  await test(keyToUse, newModel || process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL);

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
  await AiSetting.updateOne({ name: "gemini" }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { upsert: true });
  await writeAudit({
    eventKind: "AI_SETTINGS_CHANGED",
    actorId: auth.userId,
    actorRole: auth.role,
    targetKind: "AiSetting",
    meta: { keyChanged: !!newKey, keyLast4: newKey ? newKey.slice(-4) : undefined, model: modelChanged ? newModel ?? "(default)" : undefined },
  });
  return aiSettingsView(auth);
}

/** Forget the saved key — the server's .env key (if any) is used again. Audited. */
export async function clearAiKey(authIn: AuthPayload | null): Promise<AiSettingsView> {
  const auth = assertCanEdit(authIn);
  await AiSetting.updateOne({ name: "gemini" }, { $unset: { keyEnc: 1, keyLast4: 1 }, $set: { updatedBy: new Types.ObjectId(auth.userId) } });
  await writeAudit({ eventKind: "AI_SETTINGS_CHANGED", actorId: auth.userId, actorRole: auth.role, targetKind: "AiSetting", meta: { keyCleared: true } });
  return aiSettingsView(auth);
}
