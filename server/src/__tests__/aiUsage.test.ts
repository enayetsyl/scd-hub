/**
 * AI-2 — usage ledger, caps and the budget alert (D-#1091/#1092/#1103/#1124), on an
 * in-memory MongoDB.
 *   • prices: DeepSeek off-peak is half price; Gemini has no time-of-day pricing
 *   • the router writes one row per attempt (no text), sharing a callId; fallback = 2 rows
 *   • caps refuse BEFORE sending, write one `capped` row, and refusals do not count
 *   • the alert reaches every holder of system_health:ai_key once per cap per month
 *   • the older Gemini features are metered through meteredGeminiFetch, never broken by it
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { AiUsage } from "../modules/platform/models/AiUsage";
import { AiFeatureSetting } from "../modules/platform/models/AiFeatureSetting";
import { AiBudgetSetting } from "../modules/platform/models/AiBudgetSetting";
import { User } from "../modules/foundation/models/User";
import { Notification } from "../modules/notifications/models/Notification";
import { costUsd, isPeak } from "../modules/platform/ai/aiPrices";
import { aiSend, type ProviderFactory } from "../modules/platform/ai/aiRouter";
import { meteredGeminiFetch } from "../modules/platform/ai/meteredFetch";
import { AiProviderError, type AiSendInput } from "../modules/platform/ai/provider";
import { AiCapError, alertIfBudget, dhakaDayStart, dhakaMonthStart } from "../modules/platform/services/AiUsageService";
import type { AiRoute } from "../modules/platform/services/AiSettingService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await Promise.all([AiUsage.deleteMany({}), AiFeatureSetting.deleteMany({}), AiBudgetSetting.deleteMany({}), Notification.deleteMany({}), User.deleteMany({})]);
});

const TEACHER = new Types.ObjectId().toString();
const OTHER = new Types.ObjectId().toString();
const input: AiSendInput = { stablePrefix: "rules", variablePart: "মন্তব্য", maxOutputTokens: 800, reasoning: "off" };
const route = (r: Partial<AiRoute> = {}) => async (): Promise<AiRoute> => ({
  enabled: true,
  primary: { provider: "deepseek", model: "deepseek-flash", key: "sk" },
  fallback: { provider: "gemini", model: "gemini-flash-latest", key: "g" },
  ...r,
});
const usage = { cacheHitTokens: 5000, cacheMissTokens: 500, outputTokens: 500, reasoningTokens: 0 };
function providers(behaviour: Record<string, "ok" | "busy">) {
  const calls: string[] = [];
  const make: ProviderFactory = (provider) => ({
    name: provider,
    send: async (_i, model) => {
      calls.push(provider);
      if (behaviour[provider] === "busy") throw new AiProviderError("busy", "busy", provider, 503);
      return { provider, model, resolvedModel: model, text: "{}", usage, finishReason: "stop" as const, latencyMs: 12 };
    },
  });
  return { make, calls };
}
const flush = () => new Promise((r) => setTimeout(r, 150));
const send = (who: string, deps: Parameters<typeof aiSend>[3], extra: Record<string, string> = {}) =>
  aiSend("comment_check", input, { userId: who, role: "TEACHER", refType: "StudentComment", refId: "c1", ...extra }, deps);

describe("prices", () => {
  const wedPeak = new Date("2026-11-11T02:30:00Z");
  const wedOff = new Date("2026-11-11T05:00:00Z");
  const satPeakHour = new Date("2026-11-14T02:30:00Z");

  test("DeepSeek peak on weekday windows only; off-peak is half", () => {
    expect(isPeak("deepseek", wedPeak)).toBe(true);
    expect(isPeak("deepseek", wedOff)).toBe(false);
    expect(isPeak("deepseek", satPeakHour)).toBe(false);
    const peak = costUsd("deepseek", "deepseek-flash", usage, wedPeak);
    expect(peak).toBeCloseTo((5000 * 0.006 + 500 * 0.3 + 500 * 1.2) / 1e6, 6);
    expect(costUsd("deepseek", "deepseek-flash", usage, wedOff)).toBeCloseTo(peak / 2, 6);
  });

  test("Gemini has no time-of-day price; an unknown or dated id uses the closest listed model", () => {
    expect(costUsd("gemini", "gemini-flash-latest", usage, wedPeak)).toBe(costUsd("gemini", "gemini-flash-latest", usage, wedOff));
    expect(costUsd("deepseek", "deepseek-flash-1017", usage, wedPeak)).toBe(costUsd("deepseek", "deepseek-flash", usage, wedPeak));
    expect(costUsd("gemini", "gemini-3.6-flash-lite-001", usage, wedPeak)).toBe(costUsd("gemini", "gemini-flash-lite-latest", usage, wedPeak));
  });

  test("Dhaka days and months (UTC+6)", () => {
    expect(dhakaDayStart(new Date("2026-11-08T19:00:00Z")).toISOString()).toBe("2026-11-08T18:00:00.000Z");
    expect(dhakaDayStart(new Date("2026-11-08T17:59:00Z")).toISOString()).toBe("2026-11-07T18:00:00.000Z");
    expect(dhakaMonthStart(new Date("2026-11-30T18:30:00Z")).toISOString()).toBe("2026-11-30T18:00:00.000Z");
    expect(dhakaMonthStart(new Date("2026-11-15T00:00:00Z")).toISOString()).toBe("2026-10-31T18:00:00.000Z");
  });
});

describe("the ledger", () => {
  test("one row per call: who, what, tokens, cost — and no text", async () => {
    const { make } = providers({ deepseek: "ok" });
    const out = await send(TEACHER, { route: route(), makeProvider: make });
    const rows = await AiUsage.find({}).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      feature: "comment_check",
      callId: out.callId,
      attempt: 1,
      branch: "sylhet",
      role: "TEACHER",
      refType: "StudentComment",
      refId: "c1",
      provider: "deepseek",
      modelName: "deepseek-flash",
      cacheHitTokens: 5000,
      cacheMissTokens: 500,
      outputTokens: 500,
      outcome: "ok",
    });
    expect(String(rows[0].userId)).toBe(TEACHER);
    expect(rows[0].costUsd).toBeGreaterThan(0);
    expect(JSON.stringify(rows[0])).not.toContain("মন্তব্য");
  });

  test("a fallback writes both attempts under one callId: error, then fallback", async () => {
    const { make } = providers({ deepseek: "busy", gemini: "ok" });
    const out = await send(TEACHER, { route: route(), makeProvider: make });
    const rows = await AiUsage.find({}).sort({ attempt: 1 }).lean();
    expect(rows.map((r) => [r.attempt, r.provider, r.outcome, r.errorKind ?? null, r.callId])).toEqual([
      [1, "deepseek", "error", "busy", out.callId],
      [2, "gemini", "fallback", null, out.callId],
    ]);
    expect(rows[0].costUsd).toBe(0);
  });

  test("both failing still writes both rows before the error reaches the caller", async () => {
    const { make } = providers({ deepseek: "busy", gemini: "busy" });
    await expect(send(TEACHER, { route: route(), makeProvider: make })).rejects.toBeInstanceOf(AiProviderError);
    expect(await AiUsage.countDocuments({ outcome: "error" })).toBe(2);
  });
});

describe("caps refuse before sending", () => {
  test("a person's daily cap: refused, nothing sent, one capped row; refusals do not count; others unaffected", async () => {
    await AiFeatureSetting.create({ feature: "comment_check", enabled: true, provider: "deepseek", fallback: true, dailyPerUser: 2 });
    const p = providers({ deepseek: "ok" });
    await send(TEACHER, { route: route(), makeProvider: p.make });
    await send(TEACHER, { route: route(), makeProvider: p.make });
    const err = await send(TEACHER, { route: route(), makeProvider: p.make }).catch((e) => e);
    expect(err).toBeInstanceOf(AiCapError);
    expect((err as AiCapError).cap).toBe("daily");
    expect((err as Error).message).toContain("যাচাই ছাড়াই পাঠাতে পারেন");
    expect(p.calls).toHaveLength(2);
    expect(await AiUsage.countDocuments({ outcome: "capped" })).toBe(1);
    await expect(send(TEACHER, { route: route(), makeProvider: p.make })).rejects.toBeInstanceOf(AiCapError);
    expect(await AiUsage.countDocuments({ outcome: "capped" })).toBe(2);
    await send(OTHER, { route: route(), makeProvider: p.make });
    expect(p.calls).toHaveLength(3);
  });

  test("an assistant session's turn cap", async () => {
    await AiFeatureSetting.create({ feature: "assistant", enabled: true, provider: "deepseek", fallback: true, perSessionTurns: 2 });
    const p = providers({ deepseek: "ok" });
    const turn = (session: string) => aiSend("assistant", input, { userId: TEACHER, role: "TEACHER", sessionId: session }, { route: route(), makeProvider: p.make });
    await turn("s1");
    await turn("s1");
    const err = await turn("s1").catch((e) => e);
    expect((err as AiCapError).cap).toBe("session");
    await turn("s2");
    expect(p.calls).toHaveLength(3);
  });

  test("a feature's monthly USD cap counts this Dhaka month only", async () => {
    await AiFeatureSetting.create({ feature: "comment_check", enabled: true, provider: "deepseek", fallback: true, monthlyUsd: 1 });
    const base = { branch: "sylhet", feature: "comment_check", callId: "x", attempt: 1, provider: "deepseek", modelName: "deepseek-flash", outcome: "ok" };
    await AiUsage.create({ ...base, at: new Date(Date.now() - 40 * 86_400_000), costUsd: 5 });
    const p = providers({ deepseek: "ok" });
    await send(TEACHER, { route: route(), makeProvider: p.make });
    await AiUsage.create({ ...base, at: new Date(), costUsd: 1 });
    const err = await send(TEACHER, { route: route(), makeProvider: p.make }).catch((e) => e);
    expect((err as AiCapError).cap).toBe("monthly");
  });

  test("the school-wide budget covers the capped features together, not the older Gemini ones", async () => {
    await AiBudgetSetting.create({ name: "global", monthlyUsd: 1, alertPct: 70 });
    const base = { branch: "sylhet", callId: "x", attempt: 1, modelName: "m", outcome: "ok", at: new Date() };
    await AiUsage.create({ ...base, feature: "monthly_comment", provider: "gemini", costUsd: 50 });
    const p = providers({ deepseek: "ok" });
    await send(TEACHER, { route: route(), makeProvider: p.make });
    await AiUsage.create({ ...base, feature: "assistant", provider: "deepseek", costUsd: 0.6 });
    await AiUsage.create({ ...base, feature: "comment_check", provider: "deepseek", costUsd: 0.5 });
    const err = await send(TEACHER, { route: route(), makeProvider: p.make }).catch((e) => e);
    expect((err as AiCapError).cap).toBe("budget");
  });
});

describe("the Principal changes the caps", () => {
  const principal = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" as const };

  test("feature caps and the school budget save, are audited, and refuse nonsense", async () => {
    const { setAiFeatureSetting, setAiBudget, aiBudgetView, aiFeatureSettings } = await import("../modules/platform/services/AiSettingService");
    expect((await aiFeatureSettings(principal)).find((f) => f.feature === "comment_check")).toMatchObject({ dailyPerUser: 80, monthlyUsd: 3, perSessionTurns: null });
    const v = await setAiFeatureSetting(principal, { feature: "assistant", dailyPerUser: 10, monthlyUsd: 2.5, perSessionTurns: 20 });
    expect(v).toMatchObject({ dailyPerUser: 10, monthlyUsd: 2.5, perSessionTurns: 20, enabled: false });
    await expect(setAiFeatureSetting(principal, { feature: "assistant", dailyPerUser: -1 })).rejects.toThrow("দৈনিক সীমা");
    await expect(setAiFeatureSetting(principal, { feature: "assistant", dailyPerUser: 2.5 })).rejects.toThrow("পূর্ণ সংখ্যা");
    expect(await aiBudgetView(principal)).toMatchObject({ monthlyUsd: 8, alertPct: 70 });
    expect(await setAiBudget(principal, { monthlyUsd: 12 })).toMatchObject({ monthlyUsd: 12, alertPct: 70 });
    await expect(setAiBudget(principal, { alertPct: 0 })).rejects.toThrow("১ থেকে ১০০");
    await expect(setAiBudget({ userId: TEACHER, role: "TEACHER" }, { monthlyUsd: 99 })).rejects.toThrow("অনুমতি নেই");
  });
});

describe("the budget alert", () => {
  const user = (role: string, name: string) =>
    User.create({ name, role, passwordHash: "x", active: true, phone: `017${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}` });
  const spend = (feature: string, usd: number) =>
    AiUsage.create({ at: new Date(), branch: "sylhet", feature, callId: new Types.ObjectId().toString(), attempt: 1, provider: "deepseek", modelName: "deepseek-flash", costUsd: usd, outcome: "ok" });

  test("70 % then 100 %, once each per cap per month, to every ai_key holder and nobody else", async () => {
    const principal = await user("PRINCIPAL", "Principal");
    await user("TEACHER", "Teacher");
    await spend("comment_check", 1.0);
    expect(await alertIfBudget("comment_check")).toBe(0); // $1 of $3

    await spend("comment_check", 1.2); // $2.20 of $3 = 73 %
    expect(await alertIfBudget("comment_check")).toBe(1);
    expect(await alertIfBudget("comment_check")).toBe(0);
    const first = await Notification.find({ kind: "AI_BUDGET_ALERT" }).lean();
    expect(first).toHaveLength(1);
    expect(String(first[0].recipientUserId)).toBe(String(principal._id));
    expect(first[0].titleBn).toContain("70%");

    await spend("comment_check", 1.0); // $3.20 of $3
    expect(await alertIfBudget("comment_check")).toBe(1);
    const all = await Notification.find({ kind: "AI_BUDGET_ALERT" }).sort({ _id: 1 }).lean();
    expect(all.map((n) => n.titleBn)).toEqual(["মন্তব্য যাচাই: এ মাসের সীমার 70% খরচ হয়েছে", "মন্তব্য যাচাই: এ মাসের সীমা শেষ"]);
  });

  test("the school-wide budget alerts on its own", async () => {
    await user("PRINCIPAL", "Principal");
    await AiBudgetSetting.create({ name: "global", monthlyUsd: 4, alertPct: 50 });
    await spend("assistant", 2.1); // $2.10 of the assistant's $5 (42 %), of the school's $4 (52 %)
    expect(await alertIfBudget("assistant")).toBe(1);
    const n = await Notification.findOne({ kind: "AI_BUDGET_ALERT" }).lean();
    expect(n!.titleBn).toBe("এআই-এর মোট খরচ: এ মাসের সীমার 50% খরচ হয়েছে");
  });
});

describe("the older Gemini features are metered", () => {
  const reply = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const geminiBody = {
    modelVersion: "gemini-3.6-flash-001",
    candidates: [{ finishReason: "STOP", content: { parts: [{ text: "ok" }] } }],
    usageMetadata: { promptTokenCount: 3000, cachedContentTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 300 },
  };

  test("one row from usageMetadata; the caller still reads the same body", async () => {
    const res = await meteredGeminiFetch("monthly_comment", "gemini-flash-latest", "https://x", { method: "POST" }, {}, async () => reply(geminiBody));
    expect(((await res.json()) as typeof geminiBody).candidates[0].content.parts[0].text).toBe("ok");
    await flush();
    const row = await AiUsage.findOne({ feature: "monthly_comment" }).lean();
    expect(row).toMatchObject({ provider: "gemini", modelName: "gemini-flash-latest", resolvedModel: "gemini-3.6-flash-001", cacheHitTokens: 1000, cacheMissTokens: 2000, outputTokens: 500, reasoningTokens: 300, outcome: "ok" });
    expect(row!.costUsd).toBeGreaterThan(0);
    expect(row!.userId).toBeUndefined();
  });

  test("a refused call and a network failure are recorded; the caller sees exactly what fetch gave", async () => {
    const res = await meteredGeminiFetch("voice_task", "gemini-flash-latest", "https://x", { method: "POST" }, {}, async () => reply({}, 503));
    expect(res.status).toBe(503);
    await expect(
      meteredGeminiFetch("observation_rota", "gemini-flash-latest", "https://x", { method: "POST" }, {}, async () => {
        throw new TypeError("fetch failed");
      }),
    ).rejects.toThrow("fetch failed");
    await flush();
    const rows = await AiUsage.find({}).sort({ feature: 1 }).lean();
    expect(rows.map((r) => [r.feature, r.outcome, r.errorKind])).toEqual([
      ["observation_rota", "error", "network"],
      ["voice_task", "error", "busy"],
    ]);
  });

  test("a cut-off reply is billed and marked truncated; a non-JSON body never breaks the call", async () => {
    await meteredGeminiFetch("book_author", "gemini-flash-latest", "https://x", { method: "POST" }, {}, async () =>
      reply({ ...geminiBody, candidates: [{ finishReason: "MAX_TOKENS" }] }),
    );
    const odd = await meteredGeminiFetch("book_author", "gemini-flash-latest", "https://x", { method: "POST" }, {}, async () => new Response("not json", { status: 200 }));
    expect(await odd.text()).toBe("not json");
    await flush();
    const rows = await AiUsage.find({ feature: "book_author" }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "error", errorKind: "truncated" });
    expect(rows[0].costUsd).toBeGreaterThan(0);
  });
});
