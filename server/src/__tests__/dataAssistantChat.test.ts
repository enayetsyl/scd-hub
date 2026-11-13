/**
 * Data assistant DA-2 — the in-app data chat loop (docs/prd-data-assistant-mcp.md §4.5, §8.3;
 * D-#1540). A scripted fake provider through the REAL router (so every round is metered) and the
 * REAL tool layer (so every call is gated, redacted and logged). Every name here is invented.
 */
import { aiSend, type ProviderFactory } from "../modules/platform/ai/aiRouter";
import type { AiProvider, AiSendInput, AiSendResult } from "../modules/platform/ai/provider";
import { AiUsage } from "../modules/platform/models/AiUsage";
import { AiExchange } from "../modules/platform/models/AiExchange";
import { AiFeatureSetting } from "../modules/platform/models/AiFeatureSetting";
import { User } from "../modules/foundation/models/User";
import { AiDataCall } from "../modules/data-assistant/models/AiDataCall";
import { DataChatMessage } from "../modules/data-assistant/models/DataChat";
import { resetLimits } from "../modules/data-assistant/limits";
import { askDataAssistant, dataChatMessage, MAX_ROUNDS, MAX_TOOL_CALLS, startDataChat, type DataChatDeps } from "../modules/data-assistant/services/DataChatService";
import { DATA_ASSISTANT_RULES } from "../modules/data-assistant/prompt";
import type { AuthPayload } from "../context";
import { MARK, setupFixtures, teardownFixtures, type Fx } from "./dataAssistantFixtures";

jest.setTimeout(180_000);
let fx: Fx;
beforeAll(async () => {
  fx = await setupFixtures();
});
afterAll(async () => teardownFixtures(fx));
beforeEach(() => resetLimits());

type Script = (input: AiSendInput, n: number) => Partial<AiSendResult>;
const seen: AiSendInput[] = [];

function depsFor(script: Script): DataChatDeps {
  let n = 0;
  const provider: AiProvider = {
    name: "anthropic",
    async send(input, model) {
      seen.push(input);
      const r = script(input, n++);
      return { provider: "anthropic", model, resolvedModel: model, text: "", usage: { cacheHitTokens: 0, cacheMissTokens: 100, outputTokens: 50, reasoningTokens: null }, finishReason: "stop", latencyMs: 1, ...r } as AiSendResult;
    },
  };
  const make: ProviderFactory = () => provider;
  return {
    send: (f, i, c, d) =>
      aiSend(f, i, c, {
        ...d,
        makeProvider: make,
        keyFor: () => "k",
        route: async () => ({ enabled: true, primary: { provider: "anthropic", model: "claude-sonnet-5-5", key: "k" }, fallback: null }),
      }),
  };
}

const call = (id: string, name: string, args: unknown) => ({ id, name, argsJson: JSON.stringify(args) });
const resultOf = (input: AiSendInput, round: number, i = 0) => JSON.parse(input.toolRounds![round].results[i].content);

async function ask(auth: AuthPayload, text: string, script: Script, model?: string) {
  const s = await startDataChat(auth, { model });
  const out = await askDataAssistant(auth, s.id, { text }, depsFor(script));
  await out.done;
  return { session: s, out, answer: await dataChatMessage(auth, out.assistant.id) };
}

it("question → find_students → student_overview → answer, every round metered, every call logged", async () => {
  seen.length = 0;
  const { answer, session } = await ask(fx.auth.principal, "আয়েশার উপস্থিতি কেমন?", (input, n) => {
    if (n === 0) return { finishReason: "tool_calls", toolCalls: [call("t1", "find_students", { query: "Ayesha" })], assistantRaw: [{ type: "tool_use", id: "t1" }] };
    if (n === 1) {
      const id = resultOf(input, 0).data[0].student_id;
      return { finishReason: "tool_calls", toolCalls: [call("t2", "student_overview", { student_id: id })], assistantRaw: [{ type: "tool_use", id: "t2" }] };
    }
    return { text: "আয়েশা আজ অনুপস্থিত।" };
  });
  expect(answer).toMatchObject({ status: "done", text: "আয়েশা আজ অনুপস্থিত।", denied: false });
  expect(answer.tools.map((t) => [t.tool, t.outcome])).toEqual([["find_students", "ok"], ["student_overview", "ok"]]);
  expect(answer.tools[0].labelBn).toMatch(/[ঀ-৿]/);
  // Three rounds → three metered calls; two tool calls → two log rows tied to the chat.
  expect(await AiUsage.countDocuments({ feature: "data_assistant" })).toBe(3);
  expect(await AiDataCall.countDocuments({ surface: "in_app", sessionId: session.id })).toBe(2);
  // The stable prefix is the rules; the date is in the variable part; tools in registry order.
  expect(seen[0].stablePrefix).toBe(DATA_ASSISTANT_RULES);
  expect(seen[0].variablePart).toMatch(/^Today \(Dhaka\): \d{4}-\d{2}-\d{2}/);
  expect(seen[0].tools!.map((t) => t.name).slice(0, 3)).toEqual(["my_access", "daily_report", "find_students"]);
  // One request-log row: question, answer and tool calls; names marked not de-identified;
  // no tool RESULT text (the student's school id comes only from a result).
  const ex = await AiExchange.findOne({ feature: "data_assistant" }).lean();
  expect(ex).toMatchObject({ deidentified: false, request: "আয়েশার উপস্থিতি কেমন?", reply: "আয়েশা আজ অনুপস্থিত।" });
  expect(ex!.toolCalls!.map((t) => t.name)).toEqual(["find_students", "student_overview"]);
  expect(JSON.stringify(ex)).not.toContain("SCD-T-0001");
  expect(await AiExchange.countDocuments({ feature: "data_assistant" })).toBe(1);
});

it(`stops at ${MAX_ROUNDS} rounds / ${MAX_TOOL_CALLS} calls; the last round may not call tools`, async () => {
  seen.length = 0;
  const { answer } = await ask(fx.auth.principal, "সব বলুন", (input) =>
    input.toolChoice === "none" ? { text: "যা পেয়েছি তা দিয়ে উত্তর।" } : { finishReason: "tool_calls", toolCalls: [call(`a${seen.length}`, "my_access", {}), call(`b${seen.length}`, "my_access", {}), call(`c${seen.length}`, "my_access", {})], assistantRaw: [] },
  );
  expect(seen.length).toBeLessThanOrEqual(MAX_ROUNDS);
  expect(seen[seen.length - 1].toolChoice).toBe("none");
  expect(answer.tools.length).toBeLessThanOrEqual(MAX_TOOL_CALLS);
  expect(answer).toMatchObject({ status: "done", text: "যা পেয়েছি তা দিয়ে উত্তর।" });
});

it("a denial reaches the model and the answer relays it (the 'no permission' chip)", async () => {
  const { answer } = await ask(fx.auth.office, "স্কুলের মাস্টারি কেমন?", (input, n) =>
    n === 0 ? { finishReason: "tool_calls", toolCalls: [call("m1", "mastery_overview", {})], assistantRaw: [] } : { text: resultOf(input, 0).message_bn },
  );
  expect(answer.text).toContain("অনুমতি আপনার নেই");
  expect(answer.denied).toBe(true);
  // mastery_overview is not even offered to Office.
  expect(seen[seen.length - 1].tools!.map((t) => t.name)).not.toContain("mastery_overview");
});

it("the outgoing question is swept of phones and e-mails", async () => {
  seen.length = 0;
  await ask(fx.auth.principal, `এই নম্বরটা কার ${MARK.commentPhone} বা ${MARK.commentEmail}?`, () => ({ text: "জানা নেই।" }));
  expect(seen[0].variablePart).not.toContain(MARK.commentPhone);
  expect(seen[0].variablePart).not.toContain(MARK.commentEmail);
  expect(seen[0].variablePart).toContain("[ফোন লুকানো]");
});

it("caps refuse with the cap's own text", async () => {
  await AiFeatureSetting.updateOne({ feature: "data_assistant" }, { $set: { dailyPerUser: 1 } });
  try {
    const { answer } = await ask(fx.auth.officeGranted, "একটা প্রশ্ন", (_i, n) => (n === 0 ? { finishReason: "tool_calls", toolCalls: [call("x", "my_access", {})], assistantRaw: [] } : { text: "উত্তর" }));
    expect(answer.status).toBe("failed");
    expect(answer.error).toBeTruthy();
  } finally {
    await AiFeatureSetting.updateOne({ feature: "data_assistant" }, { $unset: { dailyPerUser: 1 } });
  }
});

it("default model Claude Sonnet 5.5; picking DeepSeek carries the warning flag", async () => {
  const a = await startDataChat(fx.auth.principal, {});
  expect(a).toMatchObject({ chatModel: "claude-sonnet-5-5", deepseekWarning: false });
  const d = await startDataChat(fx.auth.principal, { model: "deepseek-flash" });
  expect(d.deepseekWarning).toBe(true);
});

it("the same permissions give a byte-identical prefix + tool list; different permissions differ", async () => {
  const twin = await User.create({ role: "OFFICE", name: "Office Twin", email: "twin@school.test", passwordHash: "x", active: true, grantedPermissions: ["data_assistant:use", "data_assistant:connect"] });
  const capture = async (auth: AuthPayload) => {
    seen.length = 0;
    await ask(auth, "q", () => ({ text: "a" }));
    return JSON.stringify({ p: seen[0].stablePrefix, t: seen[0].tools });
  };
  const a = await capture(fx.auth.office);
  const b = await capture({ userId: String(twin._id), role: "OFFICE" });
  const c = await capture(fx.auth.officeGranted);
  expect(a).toBe(b);
  expect(c).not.toBe(a);
});

it("View as: the Principal tests as an Office login (no use switch) in-app; logged with the impersonator", async () => {
  const borrowed: AuthPayload = { ...fx.auth.officeNoUse, impersonatorId: fx.auth.principal.userId, impersonatorRole: "PRINCIPAL" };
  const { answer, session } = await ask(borrowed, "বেতন কত?", (_i, n) => (n === 0 ? { finishReason: "tool_calls", toolCalls: [call("p", "payroll_summary", {})], assistantRaw: [] } : { text: "ok" }));
  expect(session.viewAs).toBe(true);
  expect(answer.tools).toEqual([expect.objectContaining({ tool: "payroll_summary", outcome: "ok" })]);
  const row = await AiDataCall.findOne({ sessionId: session.id }).lean();
  expect(String(row!.impersonatorId)).toBe(fx.auth.principal.userId);
  const ex = await AiExchange.findOne({ refId: session.id }).lean();
  expect(String(ex!.impersonatorId)).toBe(fx.auth.principal.userId);
  // The same login without an impersonator is refused.
  await expect(startDataChat(fx.auth.officeNoUse, {})).rejects.toThrow();
});

it("Guardian and a login without data_assistant:use are refused; another person's chat is not found", async () => {
  await expect(startDataChat(fx.auth.guardian, {})).rejects.toThrow();
  await expect(startDataChat(fx.auth.officeNoUse, {})).rejects.toThrow();
  const s = await startDataChat(fx.auth.principal, {});
  await expect(askDataAssistant(fx.auth.office, s.id, { text: "x" })).rejects.toThrow("পাওয়া যায়নি");
  expect(await DataChatMessage.countDocuments({ sessionId: s.id })).toBe(0);
});
