/**
 * The bot's outside world, behind seams (TB-1, D-#1666): Telegram, Gemini and GitHub are each one small
 * interface; the real implementations below use `fetch` and the env names (all optional — with none set
 * every entry point no-ops). Tests swap the whole set with `setTelegramDeps`. Env VALUES are never logged.
 */
import { randomUUID } from "crypto";
import mongoose from "mongoose";
import { meteredGeminiFetch } from "../../platform/ai/meteredFetch";
import { aiRouteFor } from "../../platform/services/AiSettingService";
import { AiCapError, alertIfBudget, assertWithinCaps } from "../../platform/services/AiUsageService";

/** A refusal with a sentence the person can read (Bangla) — expected, never a fault. */
export class TelegramBotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramBotError";
  }
}

/** An outside service answered with an error status (Telegram / Gemini / GitHub). Callers catch it. */
export class TelegramHttpError extends Error {
  constructor(
    public readonly service: "telegram" | "gemini" | "github",
    public readonly status: number,
  ) {
    super(`${service} answered ${status}`);
    this.name = "TelegramHttpError";
  }
}

// ---------------------------------------------------------------------------
// Env (read at call time so tests and a late-set env both work)
// ---------------------------------------------------------------------------
export const env = {
  botToken: () => process.env.TELEGRAM_BOT_TOKEN || "",
  webhookSecret: () => process.env.TELEGRAM_WEBHOOK_SECRET || "",
  botUsername: () => process.env.TELEGRAM_BOT_USERNAME || "",
  geminiKey: () => process.env.BOT_GEMINI_API_KEY || "",
  geminiModel: () => process.env.BOT_GEMINI_MODEL || "gemini-flash-latest",
  geminiFallback: () => process.env.BOT_GEMINI_FALLBACK_MODEL || "gemini-flash-lite-latest",
  githubToken: () => process.env.BOT_GITHUB_TOKEN || "",
  githubRepo: () => process.env.BOT_GITHUB_REPO || "enayetsyl/scd-hub",
};

/** The bot is on only when it has its Telegram token. */
export const botEnabled = () => env.botToken().length > 0;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------
export interface InlineButton {
  text: string;
  data: string;
}

export interface TelegramApi {
  sendMessage(chatId: number, text: string, keyboard?: InlineButton[][]): Promise<void>;
  editMessageText(chatId: number, messageId: number, text: string): Promise<void>;
  answerCallbackQuery(id: string, text?: string): Promise<void>;
  /** `mimeHint` comes from the Telegram message (voice = audio/ogg, audio.mime_type, photo = image/jpeg). */
  downloadFile(fileId: string, mimeHint?: string): Promise<{ data: Buffer; mime: string }>;
  getMe(): Promise<{ username: string }>;
}

export type GeminiPart = { text: string } | { mime: string; data: string };

export interface GeminiBot {
  /** One generateContent call; returns the text. Throws TelegramHttpError("gemini", status). */
  generate(req: { model: string; system: string; parts: GeminiPart[]; refId?: string }): Promise<string>;
  /** Asked before EACH Gemini call: the owner's switch ("off"), the caps and the school budget ("cap"), else "ok". */
  allowance(): Promise<"ok" | "off" | "cap">;
}

export interface GithubApi {
  ensureLabels(labels: string[]): Promise<void>;
  /** Commit an image to the orphan `bug-assets` branch; returns its raw URL. */
  uploadAsset(path: string, data: Buffer): Promise<string>;
  createIssue(input: { title: string; body: string; labels: string[] }): Promise<{ number: number; url: string }>;
  /** Throws TelegramHttpError("github", 404 | 410) when the issue is gone. `reason` is GitHub's state_reason. */
  getIssue(number: number): Promise<{ state: "open" | "closed"; labels: string[]; reason: string | null }>;
}

export interface TelegramDeps {
  telegram: TelegramApi;
  gemini: GeminiBot;
  github: GithubApi;
}

// ---------------------------------------------------------------------------
// Real implementations
// ---------------------------------------------------------------------------
async function tgCall<T>(method: string, body: unknown): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${env.botToken()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new TelegramHttpError("telegram", res.status);
  return ((await res.json()) as { result: T }).result;
}

let cachedUsername: string | null = null;

const realTelegram: TelegramApi = {
  async sendMessage(chatId, text, keyboard) {
    await tgCall("sendMessage", {
      chat_id: chatId,
      text: text.slice(0, 4000),
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard.map((r) => r.map((b) => ({ text: b.text, callback_data: b.data }))) } } : {}),
    });
  },
  async editMessageText(chatId, messageId, text) {
    await tgCall("editMessageText", { chat_id: chatId, message_id: messageId, text: text.slice(0, 4000) });
  },
  async answerCallbackQuery(id, text) {
    await tgCall("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });
  },
  async downloadFile(fileId, mimeHint) {
    const f = await tgCall<{ file_path?: string }>("getFile", { file_id: fileId });
    if (!f.file_path) throw new TelegramHttpError("telegram", 404);
    const res = await fetch(`https://api.telegram.org/file/bot${env.botToken()}/${f.file_path}`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new TelegramHttpError("telegram", res.status);
    const ext = f.file_path.split(".").pop()?.toLowerCase() ?? "";
    const byExt: Record<string, string> = { oga: "audio/ogg", ogg: "audio/ogg", mp3: "audio/mpeg", m4a: "audio/mp4", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
    // The message's own type wins; never guess an image type for something that may be audio.
    return { data: Buffer.from(await res.arrayBuffer()), mime: mimeHint || byExt[ext] || "application/octet-stream" };
  },
  async getMe() {
    if (!cachedUsername) cachedUsername = (await tgCall<{ username: string }>("getMe", {})).username;
    return { username: cachedUsername };
  },
};

const realGemini: GeminiBot = {
  async generate({ model, system, parts, refId }) {
    const res = await meteredGeminiFetch(
      "telegram_bot",
      model,
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.geminiKey() },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: parts.map((p) => ("text" in p ? { text: p.text } : { inline_data: { mime_type: p.mime, data: p.data } })) }],
          // No thinkingConfig: the current "-latest" models refuse `thinkingBudget: 0` with 400 INVALID_ARGUMENT
          // (seen on prod 21 Nov 2026, every draft failed). Default thinking is fine for a short JSON report.
          generationConfig: { temperature: 0.2, maxOutputTokens: 4096, responseMimeType: "application/json" },
        }),
        // A hanging model must not hold the reporter for 90 s: give up after 45 s and try the fallback model.
        signal: AbortSignal.timeout(45_000),
      },
      { refType: "telegram_report", refId: refId ?? null },
    );
    if (!res.ok) throw new TelegramHttpError("gemini", res.status);
    void alertIfBudget("telegram_bot").catch(() => 0);
    const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> };
    return (json.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("")
      .trim();
  },
  async allowance() {
    if (mongoose.connection.readyState !== 1) return "ok";
    if (!(await aiRouteFor("telegram_bot")).enabled) return "off";
    try {
      await assertWithinCaps({ feature: "telegram_bot", callId: randomUUID(), provider: "gemini", model: env.geminiModel(), refType: "telegram_report" });
    } catch (err) {
      if (err instanceof AiCapError) return "cap";
      throw err;
    }
    return "ok";
  },
};

const ASSET_BRANCH = "bug-assets";

async function gh<T>(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<{ status: number; json: T | null }> {
  const res = await fetch(`https://api.github.com/repos/${env.githubRepo()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.githubToken()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "scd-hub-bot",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok && !okStatuses.includes(res.status)) throw new TelegramHttpError("github", res.status);
  const json = res.status === 204 || !res.ok ? null : ((await res.json()) as T);
  return { status: res.status, json };
}

let branchReady = false;

async function ensureAssetBranch(): Promise<void> {
  if (branchReady) return;
  const ref = await gh("GET", `/git/ref/heads/${ASSET_BRANCH}`, undefined, [404]);
  if (ref.status === 404) {
    // An orphan branch: a commit with no parent holding one README. Never touches dev or main.
    const blob = await gh<{ sha: string }>("POST", "/git/blobs", { content: "Bug-report screenshots (bot). No code lives here.\n", encoding: "utf-8" });
    const tree = await gh<{ sha: string }>("POST", "/git/trees", { tree: [{ path: "README.md", mode: "100644", type: "blob", sha: blob.json!.sha }] });
    const commit = await gh<{ sha: string }>("POST", "/git/commits", { message: "bug-assets: init", tree: tree.json!.sha, parents: [] });
    // 422 = another call created the branch first: it is ready either way.
    await gh("POST", "/git/refs", { ref: `refs/heads/${ASSET_BRANCH}`, sha: commit.json!.sha }, [422]);
  }
  branchReady = true;
}

const realGithub: GithubApi = {
  async ensureLabels(labels) {
    for (const name of labels) {
      await gh("POST", "/labels", { name, color: name === "bug-report" ? "d73a4a" : "0e8a16" }, [422]); // 422 = already there
    }
  },
  async uploadAsset(path, data) {
    await ensureAssetBranch();
    // 422 = the file is already there (a retried filing uploaded it before): its raw URL is still right.
    await gh("PUT", `/contents/${path}`, { message: `bug-assets: ${path}`, content: data.toString("base64"), branch: ASSET_BRANCH }, [422]);
    return `https://raw.githubusercontent.com/${env.githubRepo()}/${ASSET_BRANCH}/${path}`;
  },
  async createIssue({ title, body, labels }) {
    const r = await gh<{ number: number; html_url: string }>("POST", "/issues", { title, body, labels });
    return { number: r.json!.number, url: r.json!.html_url };
  },
  async getIssue(number) {
    const r = await gh<{ state: string; state_reason?: string | null; labels: Array<{ name: string } | string> }>("GET", `/issues/${number}`);
    return {
      reason: r.json!.state_reason ?? null,
      state: r.json!.state === "closed" ? "closed" : "open",
      labels: r.json!.labels.map((l) => (typeof l === "string" ? l : l.name)),
    };
  },
};

let deps: TelegramDeps = { telegram: realTelegram, gemini: realGemini, github: realGithub };
export const telegramDeps = (): TelegramDeps => deps;
/** Tests swap the seams; call with no argument to restore the real ones. */
export function setTelegramDeps(next?: Partial<TelegramDeps>): void {
  deps = { telegram: realTelegram, gemini: realGemini, github: realGithub, ...(next ?? {}) };
}

/** The bot's username: env first, else Telegram's getMe (cached). */
export async function botUsername(): Promise<string> {
  return env.botUsername() || (await deps.telegram.getMe()).username;
}
