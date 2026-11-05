/**
 * AI key & model (D-#967) + the voice model chain — DB-free, no network.
 *   • the key is stored encrypted, read back, never returned; a bad cipher falls back to .env
 *   • saving is LOCKED to system_health:ai_key, tested first, audited without the key
 *   • the voice chain: the chosen model first, Flash-Lite on overload / retired model
 */
let mockRow: Record<string, unknown> | null = null;
const mockAudit = jest.fn().mockResolvedValue(undefined);
jest.mock("../modules/platform/models/AiSetting", () => ({
  AiSetting: {
    findOne: () => ({ lean: () => Promise.resolve(mockRow) }),
    updateOne: (_q: unknown, u: { $set?: Record<string, unknown>; $unset?: Record<string, 1> }) => {
      const next: Record<string, unknown> = { ...(mockRow ?? { name: "gemini" }), ...(u.$set ?? {}), updatedAt: new Date() };
      for (const k of Object.keys(u.$unset ?? {})) delete next[k];
      mockRow = next;
      return Promise.resolve({});
    },
  },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: { findById: () => ({ select: () => ({ lean: () => Promise.resolve({ name: "Principal" }) }) }) },
}));
jest.mock("../modules/platform/services/AuditService", () => ({ writeAudit: (p: unknown) => mockAudit(p) }));

import {
  aiSettingsView,
  clearAiKey,
  decryptSecret,
  encryptSecret,
  geminiKey,
  geminiModel,
  refreshAiConfig,
  setAiSettings,
  testGemini,
} from "../modules/platform/services/AiSettingService";
import { GeminiVoiceModel } from "../modules/workboard/voice/VoiceTaskService";
import type { AuthPayload } from "../context";

const principal: AuthPayload = { userId: "64b000000000000000000001", role: "PRINCIPAL" };
const office: AuthPayload = { userId: "64b000000000000000000002", role: "OFFICE", grantedPermissions: ["system_health:ai_key"] };
const KEY = "AIzaSyTESTKEY_abcdefghijklmnop1234";
const ENV = process.env.GEMINI_API_KEY;
const ENV_MODEL = process.env.GEMINI_MODEL;

beforeEach(async () => {
  mockRow = null;
  mockAudit.mockClear();
  process.env.GEMINI_API_KEY = "env-key-xyz9";
  delete process.env.GEMINI_MODEL;
  await refreshAiConfig(true);
});
afterAll(() => {
  process.env.GEMINI_API_KEY = ENV;
  process.env.GEMINI_MODEL = ENV_MODEL;
});

describe("the stored key", () => {
  test("encrypts and decrypts; the ciphertext does not contain the key", () => {
    const enc = encryptSecret(KEY);
    expect(enc).not.toContain(KEY);
    expect(decryptSecret(enc)).toBe(KEY);
    expect(decryptSecret("bm90IGEgcmVhbCBjaXBoZXJ0ZXh0IGF0IGFsbA==")).toBeNull();
  });

  test("nothing saved → .env key and the alias", () => {
    expect(geminiKey()).toBe("env-key-xyz9");
    expect(geminiModel()).toBe("gemini-flash-latest");
  });

  test("an unreadable saved key falls back to .env", async () => {
    mockRow = { name: "gemini", keyEnc: "garbage", keyLast4: "1234" };
    await refreshAiConfig(true);
    expect(geminiKey()).toBe("env-key-xyz9");
  });
});

describe("setAiSettings", () => {
  test("refused without system_health:ai_key — a per-person grant cannot open a LOCKED action", async () => {
    await expect(setAiSettings(office, { apiKey: KEY }, async () => {})).rejects.toThrow("অনুমতি নেই");
    await expect(aiSettingsView(null)).rejects.toThrow("Unauthenticated");
  });

  test("tests first, then stores encrypted; the view shows only the last 4; the audit never holds the key", async () => {
    const test = jest.fn().mockResolvedValue(undefined);
    const v = await setAiSettings(principal, { apiKey: KEY, model: "gemini-flash-lite-latest" }, test);
    expect(test).toHaveBeenCalledWith(KEY, "gemini-flash-lite-latest");
    expect(mockRow!.keyEnc).toBeDefined();
    expect(JSON.stringify(mockRow)).not.toContain(KEY);
    expect(v).toMatchObject({ source: "SETTING", keyLast4: "1234", model: "gemini-flash-lite-latest", updatedByName: "Principal" });
    expect(JSON.stringify(v)).not.toContain(KEY);
    expect(geminiKey()).toBe(KEY);
    expect(JSON.stringify(mockAudit.mock.calls)).not.toContain(KEY);
    expect(mockAudit.mock.calls[0][0]).toMatchObject({ eventKind: "AI_SETTINGS_CHANGED", meta: { keyChanged: true, keyLast4: "1234" } });
  });

  test("the newer AI Studio key format (AQ.…, with dots) is accepted; a key with a space inside is refused", async () => {
    const dotted = "AQ.Ab8RN6KxTestOnlyNotARealKey_abc-DEF.ghijklmnopqrstu123";
    const test = jest.fn().mockResolvedValue(undefined);
    const v = await setAiSettings(principal, { apiKey: dotted }, test);
    expect(test).toHaveBeenCalledWith(dotted, "gemini-flash-latest");
    expect(v).toMatchObject({ source: "SETTING", keyLast4: dotted.slice(-4) });
    await expect(setAiSettings(principal, { apiKey: "AQ.Ab8RN6Kx Test OnlyNotARealKey" }, test)).rejects.toThrow("ফাঁকা জায়গা");
  });

  test("a key or model Google refuses is never saved", async () => {
    await expect(
      setAiSettings(principal, { model: "gemini-2.5-flash" }, async () => {
        throw new Error('"gemini-2.5-flash" মডেলটি আর পাওয়া যায় না');
      }),
    ).rejects.toThrow("আর পাওয়া যায় না");
    expect(mockRow).toBeNull();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  test("an empty model goes back to the default; malformed input is refused", async () => {
    await setAiSettings(principal, { model: "gemini-flash-lite-latest" }, async () => {});
    expect(geminiModel()).toBe("gemini-flash-lite-latest");
    await setAiSettings(principal, { model: "" }, async () => {});
    expect(geminiModel()).toBe("gemini-flash-latest");
    await expect(setAiSettings(principal, { apiKey: "short" }, async () => {})).rejects.toThrow("সঠিক নয়");
    await expect(setAiSettings(principal, { model: "Gemini Flash!" }, async () => {})).rejects.toThrow("মডেলের নাম সঠিক নয়");
    await expect(setAiSettings(principal, {}, async () => {})).rejects.toThrow("নতুন কী বা মডেল দিন");
  });

  test("clearing the saved key returns to .env", async () => {
    await setAiSettings(principal, { apiKey: KEY }, async () => {});
    const v = await clearAiKey(principal);
    expect(v).toMatchObject({ source: "ENV", keyLast4: "xyz9" });
    expect(geminiKey()).toBe("env-key-xyz9");
  });
});

describe("testGemini — the save-time check", () => {
  const pinger = (answers: Record<string, number>) => {
    const asked: string[] = [];
    const ping = async (_k: string, m: string) => {
      asked.push(m);
      return answers[m] ?? 200;
    };
    return { asked, ping };
  };

  test("Flash busy (503) but Lite answers → the key is proved, nothing thrown", async () => {
    const { asked, ping } = pinger({ "gemini-flash-latest": 503 });
    await expect(testGemini("k", "gemini-flash-latest", ping)).resolves.toBeUndefined();
    expect(asked).toEqual(["gemini-flash-latest", "gemini-flash-lite-latest"]);
  });

  test("Flash busy and Lite refuses the key → the key error, not the busy one", async () => {
    const { ping } = pinger({ "gemini-flash-latest": 503, "gemini-flash-lite-latest": 403 });
    await expect(testGemini("k", "gemini-flash-latest", ping)).rejects.toThrow("কী (key) সঠিক নয়");
  });

  test("both busy → the original busy message; a retired model (404) never falls back", async () => {
    const both = pinger({ "gemini-flash-latest": 503, "gemini-flash-lite-latest": 503 });
    await expect(testGemini("k", "gemini-flash-latest", both.ping)).rejects.toThrow("(503)");
    const gone = pinger({ "gemini-2.5-flash": 404 });
    await expect(testGemini("k", "gemini-2.5-flash", gone.ping)).rejects.toThrow("আর পাওয়া যায় না");
    expect(gone.asked).toEqual(["gemini-2.5-flash"]);
  });

  test("a bad key on the chosen model stops at once", async () => {
    const { asked, ping } = pinger({ "gemini-flash-latest": 400 });
    await expect(testGemini("k", "gemini-flash-latest", ping)).rejects.toThrow("কী (key) সঠিক নয়");
    expect(asked).toHaveLength(1);
  });
});

describe("the voice model chain", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const ok = (body: object) => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(body) }] } }] }), { status: 200 });

  test.each([503, 404, 429])("the chosen model answering %s moves on to Flash-Lite", async (status) => {
    const urls: string[] = [];
    global.fetch = jest.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      return urls.length === 1 ? new Response("{}", { status }) : ok({ transcript: "t", tasks: [] });
    }) as typeof fetch;
    const r = await new GeminiVoiceModel("k", "gemini-flash-latest").run("p", null);
    expect(r.transcript).toBe("t");
    expect(urls[0]).toContain("/gemini-flash-latest:");
    expect(urls[1]).toContain("/gemini-flash-lite-latest:");
  });

  test("a hard refusal (400) stops at once with the Bangla message", async () => {
    let calls = 0;
    global.fetch = jest.fn(async () => {
      calls += 1;
      return new Response("{}", { status: 400 });
    }) as typeof fetch;
    await expect(new GeminiVoiceModel("k").run("p", null)).rejects.toThrow("সাড়া দিচ্ছে না");
    expect(calls).toBe(1);
  });

  test("an unparseable reply asks the speaker to say it again", async () => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }), { status: 200 })) as typeof fetch;
    await expect(new GeminiVoiceModel("k").run("p", null)).rejects.toThrow("আবার বলুন");
  });
});
