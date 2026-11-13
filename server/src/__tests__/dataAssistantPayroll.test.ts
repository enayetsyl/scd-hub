/**
 * Data assistant DA-1 — payroll_summary (docs/prd-data-assistant-mcp.md §7 tool 19; owner Q4).
 * OPEN-1 settled from the code: the payroll screens' per-person pay lines (`staffPayslips`,
 * `payslipsForRun`) are gated `payroll:view` — there is no separate individual-pay switch, so
 * `person` mode needs exactly `payroll:view` (the gate-parity test pins it to `staffPayslips`).
 */
import { runTool } from "../modules/data-assistant/runTool";
import { resetLimits } from "../modules/data-assistant/limits";
import { AiDataCall } from "../modules/data-assistant/models/AiDataCall";
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
    const all = await runTool(fx.auth.office, "payroll_summary", { mode: "person", month: fx.today.slice(0, 7) }, { surface: "in_app" });
    expect((all.reply as { data: { people: unknown[] } }).data.people).toHaveLength(1);
  });
  it("person needs a target", async () => {
    expect((await runTool(fx.auth.principal, "payroll_summary", { mode: "person" }, { surface: "in_app" })).outcome).toBe("invalid");
  });
  it("without payroll:view both modes are the §5.4 denial", async () => {
    for (const mode of ["totals", "person"]) {
      const r = await runTool(fx.auth.officeRevoked, "payroll_summary", { mode, staff_id: fx.ids.staff }, { surface: "in_app" });
      expect(r.reply).toMatchObject({ ok: false, error: "permission_denied", needs: ["payroll:view"] });
    }
  });
  it("no bank, NID, routing or contact at any depth", async () => {
    for (const args of [{}, { mode: "person", staff_id: fx.ids.staff }, { mode: "person", month: fx.today.slice(0, 7) }]) {
      const json = JSON.stringify((await runTool(fx.auth.principal, "payroll_summary", args, { surface: "in_app" })).reply);
      for (const m of CONTACT_MARKERS) expect(json).not.toContain(m);
      expect(json).not.toMatch(/bank|routing|nid/i);
    }
  });
  it("the person gate mirrors staffPayslips (payroll:view), no invented switch", () => {
    const g = findTool("payroll_summary")!.gates.find((x) => x.mode === "person")!;
    expect(g.rule).toEqual({ anyOf: ["payroll:view"] });
    expect(g.resolver).toEqual({ file: "modules/hr/resolvers/payroll.ts", field: "staffPayslips" });
  });
  it("the audit row keeps the swept arguments, never amounts", async () => {
    await runTool(fx.auth.principal, "payroll_summary", { mode: "person", staff_id: fx.ids.staff }, { surface: "in_app" });
    const row = await AiDataCall.findOne({ tool: "payroll_summary", outcome: "ok" }).sort({ at: -1 }).lean();
    expect(JSON.parse(row!.args)).toEqual({ mode: "person", staff_id: fx.ids.staff });
    expect(JSON.stringify(row)).not.toContain("17750");
  });
});
