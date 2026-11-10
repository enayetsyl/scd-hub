/**
 * AI-1 settings (D-#1090, D-#1101) — DB-free.
 *   • DeepSeek gets its own encrypted key row; the Gemini row is untouched
 *   • no provider = Gemini, so the D-#967 screen on old bundles keeps working
 *   • testDeepseek maps DeepSeek's answers to the Principal's sentences
 *   • every AI feature is OFF until switched on; switching on tests the chosen provider
 *   • the route: fallback = the other provider, only when it has a key
 */
const mockRows: Record<string, Record<string, unknown>> = {};
const mockFeatures: Record<string, Record<string, unknown>> = {};
const mockAudit = jest.fn().mockResolvedValue(undefined);
const lean = <T>(v: T) => ({ lean: () => Promise.resolve(v) });
const applyUpdate = (store: Record<string, Record<string, unknown>>, id: string, base: Record<string, unknown>, u: { $set?: Record<string, unknown>; $unset?: Record<string, 1> }) => {
  const next: Record<string, unknown> = { ...(store[id] ?? base), ...(u.$set ?? {}), updatedAt: new Date() };
  for (const k of Object.keys(u.$unset ?? {})) delete next[k];
  store[id] = next;
  return Promise.resolve({});
};
jest.mock("../modules/platform/models/AiSetting", () => ({
  AiSetting: {
    findOne: (q: { name: string }) => lean(mockRows[q.name] ?? null),
    updateOne: (q: { name: string }, u: never) => applyUpdate(mockRows, q.name, { name: q.name }, u),
  },
}));
jest.mock("../modules/platform/models/AiFeatureSetting", () => ({
  AiFeatureSetting: {
    find: () => lean(Object.values(mockFeatures)),
    findOne: (q: { feature: string }) => lean(mockFeatures[q.feature] ?? null),
    updateOne: (q: { feature: string }, u: never) => applyUpdate(mockFeatures, q.feature, { feature: q.feature }, u),
  },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: { findById: () => ({ select: () => lean({ name: "Principal" }) }) },
}));
jest.mock("../modules/platform/services/AuditService", () => ({ writeAudit: (p: unknown) => mockAudit(p) }));

import {
  aiFeatureSettings,
  aiRouteFor,
  aiSettingsView,
  clearAiKey,
  deepseekKey,
  geminiKey,
  providerModel,
  refreshAiConfig,
  setAiFeatureSetting,
  setAiSettings,
  testDeepseek,
} from "../modules/platform/services/AiSettingService";
import type { AuthPayload } from "../context";

const principal: AuthPayload = { userId: "64b000000000000000000001", role: "PRINCIPAL" };
const teacher: AuthPayload = { userId: "64b000000000000000000003", role: "TEACHER" };
const DS_KEY = "sk-testdeepseekkey0123456789abcd";
const ENV = { g: process.env.GEMINI_API_KEY, d: process.env.DEEPSEEK_API_KEY, dm: process.env.DEEPSEEK_MODEL };

beforeEach(async () => {
  for (const k of Object.keys(mockRows)) delete mockRows[k];
  for (const k of Object.keys(mockFeatures)) delete mockFeatures[k];
  mockAudit.mockClear();
  process.env.GEMINI_API_KEY = "env-gemini-1111";
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_MODEL;
  await refreshAiConfig(true);
});
afterAll(() => {
  process.env.GEMINI_API_KEY = ENV.g;
  process.env.DEEPSEEK_API_KEY = ENV.d;
  process.env.DEEPSEEK_MODEL = ENV.dm;
});

describe("one key + model per provider", () => {
  test("a DeepSeek key is stored encrypted on its OWN row; Gemini is untouched", async () => {
    const test = jest.fn().mockResolvedValue(undefined);
    const v = await setAiSettings(principal, { provider: "deepseek", apiKey: DS_KEY }, test);
    expect(test).toHaveBeenCalledWith(DS_KEY, "deepseek-flash");
    expect(mockRows.deepseek.keyEnc).toBeDefined();
    expect(JSON.stringify(mockRows)).not.toContain(DS_KEY);
    expect(mockRows.gemini).toBeUndefined();
    expect(v).toMatchObject({ provider: "deepseek", source: "SETTING", keyLast4: "abcd", model: "deepseek-flash", defaultModel: "deepseek-flash" });
    expect(deepseekKey()).toBe(DS_KEY);
    expect(geminiKey()).toBe("env-gemini-1111");
    expect(mockAudit.mock.calls[0][0]).toMatchObject({ eventKind: "AI_SETTINGS_CHANGED", meta: { provider: "deepseek", keyChanged: true } });
    expect(JSON.stringify(mockAudit.mock.calls)).not.toContain(DS_KEY);
  });

  test("no provider means Gemini (the old screen); an unknown provider is refused", async () => {
    await setAiSettings(principal, { apiKey: "AIzaSyTESTKEY_abcdefghijklmnop1234" }, async () => {});
    expect(mockRows.gemini.keyEnc).toBeDefined();
    expect(mockRows.deepseek).toBeUndefined();
    expect((await aiSettingsView(principal)).provider).toBe("gemini");
    await expect(aiSettingsView(principal, "openai")).rejects.toThrow("চেনা যায়নি");
  });

  test("DeepSeek with nothing saved: no key, the default model; .env is honoured; clearing goes back to .env", async () => {
    expect(await aiSettingsView(principal, "deepseek")).toMatchObject({ source: "NONE", keyLast4: null, model: "deepseek-flash" });
    process.env.DEEPSEEK_API_KEY = "sk-env-9999";
    process.env.DEEPSEEK_MODEL = "deepseek-v4-pro";
    expect(await aiSettingsView(principal, "deepseek")).toMatchObject({ source: "ENV", keyLast4: "9999", model: "deepseek-v4-pro" });
    await setAiSettings(principal, { provider: "deepseek", apiKey: DS_KEY }, async () => {});
    const v = await clearAiKey(principal, "deepseek");
    expect(v).toMatchObject({ source: "ENV", keyLast4: "9999" });
  });

  test("a teacher cannot read or change any AI setting", async () => {
    await expect(aiSettingsView(teacher, "deepseek")).rejects.toThrow("অনুমতি নেই");
    await expect(aiFeatureSettings(teacher)).rejects.toThrow("অনুমতি নেই");
    await expect(setAiFeatureSetting(teacher, { feature: "comment_check", enabled: true })).rejects.toThrow("অনুমতি নেই");
  });
});

describe("testDeepseek — the save-time check", () => {
  test.each([
    [401, "কী (key) সঠিক নয়"],
    [402, "টাকা নেই"],
    [400, "চেনে না"],
    [422, "চেনে না"],
    [429, "সীমা শেষ"],
    [503, "(503)"],
  ])("DeepSeek answering %s → %s", async (status, msg) => {
    await expect(testDeepseek("k", "deepseek-flash", async () => status)).rejects.toThrow(msg);
  });
  test("200 passes", async () => {
    await expect(testDeepseek("k", "deepseek-flash", async () => 200)).resolves.toBeUndefined();
  });
});

describe("per-feature settings", () => {
  test("every feature starts OFF, on DeepSeek, fallback on — except the workspace's Gemini reader (D-#1226/#1227)", async () => {
    const list = await aiFeatureSettings(principal);
    expect(list.map((f) => f.feature)).toEqual(["comment_check", "assistant", "workspace_ocr", "workspace_chat", "workspace_draft"]);
    for (const f of list.filter((x) => !x.feature.startsWith("workspace_"))) {
      expect(f).toMatchObject({ enabled: false, provider: "deepseek", model: "deepseek-flash", fallback: true, providerReady: false });
    }
    expect(list.find((x) => x.feature === "workspace_ocr")).toMatchObject({ enabled: false, provider: "gemini", fallback: false });
    expect(list.find((x) => x.feature === "workspace_chat")).toMatchObject({ enabled: false, provider: "deepseek", fallback: false, perSessionTurns: null });
  });

  test("switching on needs the provider's key, and tests that provider with the feature's model", async () => {
    await expect(setAiFeatureSetting(principal, { feature: "comment_check", enabled: true }, async () => {})).rejects.toThrow("DeepSeek-এর কী দিন");
    expect(mockFeatures.comment_check).toBeUndefined();

    await setAiSettings(principal, { provider: "deepseek", apiKey: DS_KEY }, async () => {});
    const test = jest.fn().mockResolvedValue(undefined);
    const v = await setAiFeatureSetting(principal, { feature: "comment_check", enabled: true, model: "deepseek-v4-pro" }, test);
    expect(test).toHaveBeenCalledWith("deepseek", DS_KEY, "deepseek-v4-pro");
    expect(v).toMatchObject({ enabled: true, provider: "deepseek", model: "deepseek-v4-pro", modelSaved: "deepseek-v4-pro", providerReady: true });
    expect(mockAudit.mock.calls.at(-1)![0]).toMatchObject({ targetKind: "AiFeatureSetting", meta: { feature: "comment_check", enabled: true } });
  });

  test("a model the provider refuses leaves the feature as it was", async () => {
    await setAiSettings(principal, { provider: "deepseek", apiKey: DS_KEY }, async () => {});
    await expect(
      setAiFeatureSetting(principal, { feature: "assistant", enabled: true, model: "deepseek-nope" }, async () => {
        throw new Error("মডেলটি DeepSeek চেনে না");
      }),
    ).rejects.toThrow("চেনে না");
    expect(mockFeatures.assistant).toBeUndefined();
  });

  test("switching OFF needs no key and no test; an unknown feature is refused", async () => {
    const test = jest.fn();
    const v = await setAiFeatureSetting(principal, { feature: "assistant", enabled: false }, test);
    expect(test).not.toHaveBeenCalled();
    expect(v.enabled).toBe(false);
    await expect(setAiFeatureSetting(principal, { feature: "essay_grader", enabled: true })).rejects.toThrow("চেনা যায়নি");
  });

  test("the route: fallback is the other provider, only when it has a key and fallback is on", async () => {
    await setAiSettings(principal, { provider: "deepseek", apiKey: DS_KEY }, async () => {});
    await setAiFeatureSetting(principal, { feature: "comment_check", enabled: true }, async () => {});
    let r = await aiRouteFor("comment_check");
    expect(r).toMatchObject({ enabled: true, primary: { provider: "deepseek", model: "deepseek-flash", key: DS_KEY }, fallback: { provider: "gemini", model: providerModel("gemini"), key: "env-gemini-1111" } });

    await setAiFeatureSetting(principal, { feature: "comment_check", fallback: false }, async () => {});
    r = await aiRouteFor("comment_check");
    expect(r.fallback).toBeNull();

    delete process.env.GEMINI_API_KEY;
    await setAiFeatureSetting(principal, { feature: "comment_check", fallback: true }, async () => {});
    r = await aiRouteFor("comment_check");
    expect(r.fallback).toBeNull();
  });
});
