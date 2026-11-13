/**
 * Data assistant DA-1 — payroll_summary (docs/prd-data-assistant-mcp.md §7 tool 19; owner Q4).
 * Per-person pay lines: the screens gate them `payroll:view`, but the assistant also needs
 * `data_assistant:individual_pay` (owner 13 Nov; Principal by default, Office off). Totals stay
 * `payroll:view` only.
 */
import { runTool } from "../modules/data-assistant/runTool";
import { resetLimits } from "../modules/data-assistant/limits";
import { AiDataCall } from "../modules/data-assistant/models/AiDataCall";
import { toolSpecsFor } from "../modules/data-assistant/toolSpecs";
import { findTool } from "../modules/data-assistant/tools/registry";
import { CONTACT_MARKERS, setupFixtures, teardownFixtures, type Fx } from "./dataAssistantFixtures";

jest.setTimeout(180_000);
let fx: Fx;
beforeAll(async () => {
  fx = await setupFixtures();
});
afterAll(async () => teardownFixtures(fx));
beforeEach(() => resetLimits());

describe("payroll_summary", () => {
  it("totals: per-month figures, no per-person line", async () => {
    const r = await runTool(fx.auth.office, "payroll_summary", {}, { surface: "in_app" });
    expect(r.outcome).toBe("ok");
    const runs = (r.reply as { data: { runs: Array<Record<string, unknown>> } }).data.runs;
    expect(runs[0]).toMatchObject({ month: fx.today.slice(0, 7), staff_count: 1, gross: 18000, deductions: 250, net: 17750 });
    expect(JSON.stringify(r.reply)).not.toContain("Rahim");
  });
  it("person: one person's pay lines with payroll:view", async () => {
    const r = await runTool(fx.auth.principal, "payroll_summary", { mode: "person", staff_id: fx.ids.staff }, { surface: "claude" });
    const slips = (r.reply as { data: { payslips: Array<Record<string, unknown>> } }).data.payslips;
    expect(slips).toEqual([expect.objectContaining({ name: "Rahim Staff", gross: 18000, net: 17750, deductions: [{ head: "lateness", amount: 250 }] })]);
    const all = await runTool(fx.auth.officePay, "payroll_summary", { mode: "person", month: fx.today.slice(0, 7) }, { surface: "in_app" });
    expect((all.reply as { data: { people: unknown[] } }).data.people).toHaveLength(1);
  });
  it("Office with payroll:view but no individual_pay: person denied (audited), totals fine, person not offered", async () => {
    const r = await runTool(fx.auth.office, "payroll_summary", { mode: "person", staff_id: fx.ids.staff }, { surface: "in_app" });
    expect(r.outcome).toBe("denied");
    expect(r.reply).toMatchObject({ ok: false, error: "permission_denied", needs: ["data_assistant:individual_pay"] });
    expect(JSON.stringify(r.reply)).not.toContain("17750");
    expect(await AiDataCall.findOne({ tool: "payroll_summary", outcome: "denied" }).lean()).toBeTruthy();
    const all = await runTool(fx.auth.office, "payroll_summary", { mode: "person", month: fx.today.slice(0, 7) }, { surface: "in_app" });
    expect(all.outcome).toBe("denied");
    expect((await runTool(fx.auth.office, "payroll_summary", {}, { surface: "in_app" })).outcome).toBe("ok");
    const spec = toolSpecsFor(fx.auth.office).find((t) => t.name === "payroll_summary")!;
    expect(JSON.stringify(spec.inputSchema)).not.toContain("person");
    expect(spec.description).not.toContain("mode person");
    const full = toolSpecsFor(fx.auth.principal).find((t) => t.name === "payroll_summary")!;
    expect(JSON.stringify(full.inputSchema)).toContain("person");
  });
  it("Office granted individual_pay sees one person's pay", async () => {
    const r = await runTool(fx.auth.officePay, "payroll_summary", { mode: "person", staff_id: fx.ids.staff }, { surface: "claude" });
    expect(r.outcome).toBe("ok");
    expect(JSON.stringify(r.reply)).toContain("17750");
  });
  it("person needs a target", async () => {
    expect((await runTool(fx.auth.principal, "payroll_summary", { mode: "person" }, { surface: "in_app" })).outcome).toBe("invalid");
  });
  it("without payroll:view the tool is hidden: both modes are the §5.4 denial naming every switch", async () => {
    for (const mode of ["totals", "person"]) {
      const r = await runTool(fx.auth.officeRevoked, "payroll_summary", { mode, staff_id: fx.ids.staff }, { surface: "in_app" });
      expect(r.reply).toMatchObject({ ok: false, error: "permission_denied", needs: ["payroll:view", "data_assistant:individual_pay"] });
    }
  });
  it("no bank, NID, routing or contact at any depth", async () => {
    for (const args of [{}, { mode: "person", staff_id: fx.ids.staff }, { mode: "person", month: fx.today.slice(0, 7) }]) {
      const json = JSON.stringify((await runTool(fx.auth.principal, "payroll_summary", args, { surface: "in_app" })).reply);
      for (const m of CONTACT_MARKERS) expect(json).not.toContain(m);
      expect(json).not.toMatch(/bank|routing|nid/i);
    }
  });
  it("the person gate is staffPayslips' payroll:view plus the assistant-only individual_pay", () => {
    const g = findTool("payroll_summary")!.gates.find((x) => x.mode === "person")!;
    expect(g.rule).toEqual({ allOf: ["payroll:view", "data_assistant:individual_pay"] });
    expect(g.alsoChecked).toEqual(["data_assistant:individual_pay"]);
    expect(g.resolver).toEqual({ file: "modules/hr/resolvers/payroll.ts", field: "staffPayslips" });
  });
  it("the audit row keeps the swept arguments, never amounts", async () => {
    await runTool(fx.auth.principal, "payroll_summary", { mode: "person", staff_id: fx.ids.staff }, { surface: "in_app" });
    const row = await AiDataCall.findOne({ tool: "payroll_summary", outcome: "ok" }).sort({ at: -1 }).lean();
    expect(JSON.parse(row!.args)).toEqual({ mode: "person", staff_id: fx.ids.staff });
    expect(JSON.stringify(row)).not.toContain("17750");
  });
});
