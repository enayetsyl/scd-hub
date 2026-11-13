/**
 * Data assistant DA-1 — the tool-call log (docs/prd-data-assistant-mcp.md §8.1; D-#1538).
 * One AiDataCall per call with every field; denials carry deniedNeeds; arguments are swept;
 * results are never stored; dataToolCallsPage is the Principal's (data_assistant:audit), paged
 * and filtered; myDataToolCallsPage shows a person only their own calls.
 */
import { runTool } from "../modules/data-assistant/runTool";
import { resetLimits } from "../modules/data-assistant/limits";
import { AiDataCall } from "../modules/data-assistant/models/AiDataCall";
import { dataToolCallsPage, myDataToolCallsPage } from "../modules/data-assistant/services/DataCallLogService";
import { PHONE_MASK } from "../modules/data-assistant/redact";
import { setupFixtures, teardownFixtures, type Fx } from "./dataAssistantFixtures";

jest.setTimeout(180_000);
let fx: Fx;
beforeAll(async () => {
  fx = await setupFixtures();
});
afterAll(async () => teardownFixtures(fx));
beforeEach(async () => {
  resetLimits();
  await AiDataCall.deleteMany({});
});

it("writes one row per call with every field", async () => {
  const r = await runTool(fx.auth.principal, "find_students", { query: "Ayesha" }, { surface: "claude", clientName: "Claude", clientId: "c-1" });
  expect(await AiDataCall.countDocuments()).toBe(1);
  const row = (await AiDataCall.findById(r.callId).lean())!;
  expect(row).toMatchObject({ role: "PRINCIPAL", surface: "claude", clientName: "Claude", clientId: "c-1", tool: "find_students", outcome: "ok", rowCount: 1, truncated: false, impersonatorId: null });
  expect(String(row.userId)).toBe(fx.auth.principal.userId);
  expect(row.replyBytes).toBeGreaterThan(0);
  expect(row.ms).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(row)).not.toContain("Ayesha Test"); // the result is never stored
});

it("a denial carries the missing permissions; arguments are swept of phones", async () => {
  await runTool(fx.auth.office, "mastery_overview", {}, { surface: "in_app" });
  await runTool(fx.auth.principal, "find_students", { query: "01711 223344" }, { surface: "in_app" });
  const denied = await AiDataCall.findOne({ outcome: "denied" }).lean();
  expect(denied!.deniedNeeds).toEqual(["mastery:view", "mastery:approve"]);
  const swept = await AiDataCall.findOne({ tool: "find_students" }).lean();
  expect(swept!.args).toContain(PHONE_MASK);
  expect(swept!.args).not.toContain("223344");
});

it("records the impersonator on a View-as call", async () => {
  await runTool({ ...fx.auth.office, impersonatorId: fx.auth.principal.userId, impersonatorRole: "PRINCIPAL" }, "my_access", {}, { surface: "in_app", sessionId: "s-1" });
  const row = await AiDataCall.findOne({}).lean();
  expect(String(row!.impersonatorId)).toBe(fx.auth.principal.userId);
  expect(row!.sessionId).toBe("s-1");
});

describe("the log screens", () => {
  it("dataToolCallsPage: refused to Office, paged and filtered for the Principal", async () => {
    for (let i = 0; i < 3; i++) await runTool(fx.auth.principal, "my_access", {}, { surface: "in_app" });
    await runTool(fx.auth.office, "mastery_overview", {}, { surface: "in_app" });
    await expect(dataToolCallsPage(fx.auth.office, {}, {})).rejects.toThrow();
    const p = await dataToolCallsPage(fx.auth.principal, {}, { page: 1, pageSize: 2 });
    expect(p).toMatchObject({ total: 4, page: 1, pageSize: 2 });
    expect(p.rows).toHaveLength(2);
    expect((await dataToolCallsPage(fx.auth.principal, { outcome: "denied" }, {})).rows.map((r) => [r.userName, r.tool])).toEqual([["Office Desk", "mastery_overview"]]);
    expect((await dataToolCallsPage(fx.auth.principal, { userId: fx.auth.principal.userId, tool: "my_access" }, {})).total).toBe(3);
    expect((await dataToolCallsPage(fx.auth.principal, { fromKey: fx.today, toKey: fx.today }, {})).total).toBe(4);
    expect((await dataToolCallsPage(fx.auth.principal, { fromKey: "2001-01-01", toKey: "2001-01-02" }, {})).total).toBe(0);
  });
  it("myDataToolCallsPage: own calls only", async () => {
    await runTool(fx.auth.principal, "my_access", {}, { surface: "in_app" });
    await runTool(fx.auth.office, "my_access", {}, { surface: "in_app" });
    const mine = await myDataToolCallsPage(fx.auth.office, {}, {});
    expect(mine.rows.map((r) => r.userId)).toEqual([fx.auth.office.userId]);
    await expect(myDataToolCallsPage(fx.auth.guardian, {}, {})).rejects.toThrow();
  });
});
