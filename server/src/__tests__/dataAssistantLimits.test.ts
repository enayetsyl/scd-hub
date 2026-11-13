/**
 * Data assistant DA-1 — limits (docs/prd-data-assistant-mcp.md §8.2; D-#1539): row caps with
 * truncated + total; the 60 KB reply trim; the 31st call in a minute; the per-day cap; date-range
 * caps; a slow service times out; feature OFF answers `off`; the in-flight slots.
 */
import { capReply, runTool } from "../modules/data-assistant/runTool";
import { acquireSlot, LIMITS, resetLimits } from "../modules/data-assistant/limits";
import { findTool } from "../modules/data-assistant/tools/registry";
import { AiDataCall } from "../modules/data-assistant/models/AiDataCall";
import { AiFeatureSetting } from "../modules/platform/models/AiFeatureSetting";
import { setupFixtures, teardownFixtures, type Fx } from "./dataAssistantFixtures";

jest.setTimeout(180_000);
let fx: Fx;
beforeAll(async () => {
  fx = await setupFixtures();
});
afterAll(async () => teardownFixtures(fx));
beforeEach(() => resetLimits());

it("row caps set truncated and total", async () => {
  const r = await runTool(fx.auth.principal, "find_students", { limit: 1 }, { surface: "in_app" });
  expect(r.reply).toMatchObject({ ok: true, row_count: 1, truncated: true, total: 2 });
});

it("a reply over 60 KB is trimmed and marked", () => {
  const big = { rows: Array.from({ length: 5000 }, (_, i) => ({ i, text: "x".repeat(40) })) };
  const c = capReply(big);
  expect(c.trimmed).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(c.data))).toBeLessThanOrEqual(LIMITS.replyBytes);
  expect(capReply({ a: 1 })).toEqual({ data: { a: 1 }, trimmed: false });
});

it("the 31st call in a minute is limited", async () => {
  const outcomes = [];
  for (let i = 0; i < 31; i++) outcomes.push((await runTool(fx.auth.principal, "my_access", {}, { surface: "in_app" })).outcome);
  expect(outcomes.slice(0, 30).every((o) => o === "ok")).toBe(true);
  expect(outcomes[30]).toBe("limited");
});

it("the per-day cap counts the log", async () => {
  const keep = LIMITS.perDay;
  LIMITS.perDay = (await AiDataCall.countDocuments({ outcome: { $ne: "limited" } })) + 1;
  try {
    expect((await runTool(fx.auth.principal, "my_access", {}, { surface: "in_app" })).outcome).toBe("ok");
    resetLimits();
    const r = await runTool(fx.auth.principal, "my_access", {}, { surface: "in_app" });
    expect(r.outcome).toBe("limited");
    expect((r.reply as { retry_after_s: number }).retry_after_s).toBeGreaterThan(0);
  } finally {
    LIMITS.perDay = keep;
  }
});

it("date ranges beyond the cap are invalid", async () => {
  const r = await runTool(fx.auth.principal, "student_attendance_history", { student_id: fx.ids.studentA, from: "2024-01-01", to: "2025-06-01" }, { surface: "in_app" });
  expect(r.outcome).toBe("invalid");
  expect((r.reply as { message_en: string }).message_en).toContain("366");
  expect((await runTool(fx.auth.principal, "homework_status", { mode: "pending", from: "2026-01-01", to: "2026-03-01" }, { surface: "in_app" })).outcome).toBe("invalid");
});

it("a slow service times out", async () => {
  const tool = findTool("my_access")!;
  const run = tool.run;
  const keep = LIMITS.callTimeoutMs;
  LIMITS.callTimeoutMs = 50;
  tool.run = () => new Promise((res) => setTimeout(() => res({ data: {}, rowCount: 0 }), 500));
  try {
    const r = await runTool(fx.auth.principal, "my_access", {}, { surface: "in_app" });
    expect(r.reply).toMatchObject({ ok: false, error: "timeout" });
  } finally {
    tool.run = run;
    LIMITS.callTimeoutMs = keep;
  }
});

it("feature OFF answers off on both doors", async () => {
  await AiFeatureSetting.updateOne({ feature: "data_assistant" }, { $set: { enabled: false } });
  try {
    for (const surface of ["in_app", "claude"] as const) {
      const r = await runTool(fx.auth.principal, "my_access", {}, { surface });
      expect(r.outcome).toBe("off");
      expect(r.reply).toMatchObject({ ok: false, error: "off" });
    }
  } finally {
    await AiFeatureSetting.updateOne({ feature: "data_assistant" }, { $set: { enabled: true } });
  }
});

it("2 slots per person, 6 for the server; a third waits then is busy", async () => {
  const keep = LIMITS.waitMs;
  LIMITS.waitMs = 100;
  try {
    const a = await acquireSlot("u1");
    const b = await acquireSlot("u1");
    expect(a && b).toBeTruthy();
    expect(await acquireSlot("u1")).toBeNull();
    a!();
    const c = await acquireSlot("u1");
    expect(c).toBeTruthy();
    const others = await Promise.all(["u2", "u2", "u3", "u3"].map((u) => acquireSlot(u)));
    expect(others.every(Boolean)).toBe(true);
    expect(await acquireSlot("u4")).toBeNull(); // 6 in flight server-wide
  } finally {
    LIMITS.waitMs = keep;
    resetLimits();
  }
});
