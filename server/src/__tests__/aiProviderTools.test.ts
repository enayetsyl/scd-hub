/**
 * Data assistant DA-2 — tool calling on the provider seam (docs/prd-data-assistant-mcp.md §4.5;
 * D-#1540). No network, no database: DeepSeek through a FetchLike fixture, Claude through a fake
 * SDK client.
 *   • both request bodies carry the tools, tool_choice auto (never forced), "none" on demand
 *   • a tool-call reply parses into toolCalls + finishReason "tool_calls"; the raw assistant turn
 *     comes back for the next round
 *   • results go back in each provider's format — Claude: the assistant content echoed UNCHANGED
 *     (thinking blocks too) and ALL results in ONE user message, is_error on a failure; DeepSeek:
 *     the assistant message as returned (reasoning_content too), then one `tool` message per call
 *   • a provider without tools (Gemini) refuses before sending
 */
import { AnthropicProvider, claudeBody } from "../modules/platform/ai/anthropicProvider";
import { DeepseekProvider, deepseekBody } from "../modules/platform/ai/deepseekProvider";
import { GeminiProvider } from "../modules/platform/ai/geminiProvider";
import { AiProviderError, type AiSendInput, type AiToolRound, type FetchLike } from "../modules/platform/ai/provider";

const TOOLS = [
  { name: "find_students", description: "Find a student (শিক্ষার্থী)", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: [], additionalProperties: false } },
  { name: "attendance_day", description: "Attendance (উপস্থিতি)", inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false } },
];
const base: AiSendInput = { stablePrefix: "RULES", variablePart: "Today (Dhaka): 2026-11-13\n\nQuestion:\nকে অনুপস্থিত?", maxOutputTokens: 1000, reasoning: "low", tools: TOOLS };

const THINKING = { type: "thinking", thinking: "", signature: "sig-abc" };
const CLAUDE_TOOL_REPLY = {
  model: "claude-sonnet-5-5",
  stop_reason: "tool_use",
  content: [THINKING, { type: "text", text: "দেখছি…" }, { type: "tool_use", id: "tu_1", name: "attendance_day", input: {} }, { type: "tool_use", id: "tu_2", name: "find_students", input: { query: "আয়েশা/é" } }],
  usage: { input_tokens: 10, output_tokens: 20 },
};

function fakeClient(reply: Record<string, unknown>, seen: Array<Record<string, unknown>>) {
  return () => ({
    beta: {
      messages: {
        stream(body: Record<string, unknown>) {
          seen.push(body);
          return { on: () => undefined, finalMessage: async () => reply };
        },
      },
    },
    models: { retrieve: async (id: string) => ({ id }) },
  });
}

describe("Claude", () => {
  it("sends the tools with tool_choice auto; 'none' when asked; no tools → no tool fields", () => {
    const b = claudeBody(base, "claude-sonnet-5-5");
    expect(b.tools).toEqual([
      { name: "find_students", description: "Find a student (শিক্ষার্থী)", input_schema: TOOLS[0].inputSchema },
      { name: "attendance_day", description: "Attendance (উপস্থিতি)", input_schema: TOOLS[1].inputSchema },
    ]);
    expect(b.tool_choice).toEqual({ type: "auto" });
    expect(claudeBody({ ...base, toolChoice: "none" }, "claude-sonnet-5-5").tool_choice).toEqual({ type: "none" });
    const plain = claudeBody({ ...base, tools: undefined }, "claude-sonnet-5-5");
    expect(plain.tools).toBeUndefined();
    expect(plain.tool_choice).toBeUndefined();
  });

  it("a tool_use reply parses into toolCalls (JSON.stringify of the input) and returns the raw content", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const r = await new AnthropicProvider("k", fakeClient(CLAUDE_TOOL_REPLY, seen) as never).send(base, "claude-sonnet-5-5");
    expect(r.finishReason).toBe("tool_calls");
    expect(r.toolCalls).toEqual([
      { id: "tu_1", name: "attendance_day", argsJson: "{}" },
      { id: "tu_2", name: "find_students", argsJson: JSON.stringify({ query: "আয়েশা/é" }) },
    ]);
    expect(JSON.parse(r.toolCalls![1].argsJson)).toEqual({ query: "আয়েশা/é" });
    expect(r.assistantRaw).toBe(CLAUDE_TOOL_REPLY.content);
  });

  it("the next round echoes the assistant content unchanged and puts ALL results in ONE user message", () => {
    const round: AiToolRound = {
      assistant: CLAUDE_TOOL_REPLY.content,
      calls: [{ id: "tu_1", name: "attendance_day", argsJson: "{}" }, { id: "tu_2", name: "find_students", argsJson: "{}" }],
      results: [{ id: "tu_1", content: '{"ok":true}', isError: false }, { id: "tu_2", content: '{"ok":false,"error":"permission_denied"}', isError: true }],
      note: "Tool-call limit reached.",
    };
    const msgs = claudeBody({ ...base, toolRounds: [round] }, "claude-sonnet-5-5").messages as Array<{ role: string; content: unknown }>;
    expect(msgs).toHaveLength(3);
    expect(msgs[1]).toEqual({ role: "assistant", content: CLAUDE_TOOL_REPLY.content });
    expect((msgs[1].content as unknown[])[0]).toBe(THINKING); // the thinking block, the same object
    expect(msgs[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tu_1", content: '{"ok":true}' },
        { type: "tool_result", tool_use_id: "tu_2", content: '{"ok":false,"error":"permission_denied"}', is_error: true },
        { type: "text", text: "Tool-call limit reached." },
      ],
    });
  });

  it("a final answer after tools is a normal stop", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const r = await new AnthropicProvider("k", fakeClient({ model: "claude-sonnet-5-5", stop_reason: "end_turn", content: [THINKING, { type: "text", text: "৩ জন অনুপস্থিত" }], usage: {} }, seen) as never).send(base, "claude-sonnet-5-5");
    expect(r).toMatchObject({ finishReason: "stop", text: "৩ জন অনুপস্থিত" });
    expect(r.toolCalls).toBeUndefined();
  });
});

describe("DeepSeek", () => {
  const TOOL_REPLY = {
    model: "deepseek-v4-pro",
    choices: [
      {
        finish_reason: "tool_calls",
        message: { content: "", reasoning_content: "think…", tool_calls: [{ id: "call_1", type: "function", function: { name: "attendance_day", arguments: "{}" } }, { id: "call_2", type: "function", function: { name: "find_students", arguments: '{"query":"Ayesha"}' } }] },
      },
    ],
    usage: { prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 50, completion_tokens: 30 },
  };

  it("sends OpenAI-format tools with tool_choice auto and never streams a tool call", () => {
    const b = deepseekBody({ ...base, onDelta: () => undefined }, "deepseek-v4-pro");
    expect(b.tools).toEqual(TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })));
    expect(b.tool_choice).toBe("auto");
    expect(b.stream).toBe(false);
    expect(deepseekBody({ ...base, toolChoice: "none" }, "deepseek-v4-pro").tool_choice).toBe("none");
  });

  it("parses tool_calls and returns the assistant message (reasoning_content kept) to echo", async () => {
    let sent: Record<string, unknown> | null = null;
    const fetchImpl: FetchLike = async (_u, init) => {
      sent = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => TOOL_REPLY };
    };
    const r = await new DeepseekProvider("k", fetchImpl).send(base, "deepseek-v4-pro");
    expect(sent!.tools).toBeDefined();
    expect(r.finishReason).toBe("tool_calls");
    expect(r.toolCalls).toEqual([
      { id: "call_1", name: "attendance_day", argsJson: "{}" },
      { id: "call_2", name: "find_students", argsJson: '{"query":"Ayesha"}' },
    ]);
    expect(r.assistantRaw).toEqual({ role: "assistant", content: "", reasoning_content: "think…", tool_calls: TOOL_REPLY.choices[0].message.tool_calls });
  });

  it("the next round sends the assistant message then one tool message per call", () => {
    const assistant = { role: "assistant", content: "", reasoning_content: "think…", tool_calls: TOOL_REPLY.choices[0].message.tool_calls };
    const b = deepseekBody(
      { ...base, toolRounds: [{ assistant, calls: [], results: [{ id: "call_1", content: '{"ok":true}', isError: false }, { id: "call_2", content: '{"ok":false}', isError: true }] }] },
      "deepseek-v4-pro",
    );
    const msgs = b.messages as Array<Record<string, unknown>>;
    expect(msgs.slice(2)).toEqual([assistant, { role: "tool", tool_call_id: "call_1", content: '{"ok":true}' }, { role: "tool", tool_call_id: "call_2", content: '{"ok":false}' }]);
  });
});

describe("a provider without tools", () => {
  it("Gemini refuses before sending", async () => {
    let called = false;
    const fetchImpl: FetchLike = async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({}) };
    };
    const err = await new GeminiProvider("k", fetchImpl).send(base, "gemini-flash").catch((e) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect((err as AiProviderError).kind).toBe("not_configured");
    expect(called).toBe(false);
  });
});
