/**
 * Data assistant DA-1 — every tool, every role (docs/prd-data-assistant-mcp.md §5, §7.1, §12).
 * Principal: ok everywhere (invalid only where the seeded school has no such record). Office with
 * template defaults: ok or the §5.4 denial exactly as the screens decide (daily report, homework /
 * assignment summary and mastery are refused — P9/P10, owner Q1b). A revoke turns ok into denied;
 * a grant turns denied into ok. GUARDIAN and a deactivated login are refused before any service
 * runs. The teacher (class teacher of one section) sees only what the teacher screens allow.
 * Every name here is invented.
 */
import { runTool } from "../modules/data-assistant/runTool";
import { resetLimits } from "../modules/data-assistant/limits";
import { toolVisible } from "../modules/data-assistant/gates";
import { TOOL_REGISTRY, findTool } from "../modules/data-assistant/tools/registry";
import { AiDataCall } from "../modules/data-assistant/models/AiDataCall";
import { setupFixtures, teardownFixtures, toolCalls, type Fx } from "./dataAssistantFixtures";

jest.setTimeout(180_000);
let fx: Fx;
beforeAll(async () => {
  fx = await setupFixtures();
});
afterAll(async () => teardownFixtures(fx));
beforeEach(() => resetLimits());

/** Calls whose seeded school has no record behind them: the service answers "invalid". */
const NO_DATA = new Set(["assignment_status/summary", "exam_results/default"]);
const key = (c: { tool: string; mode: string }) => `${c.tool}/${c.mode}`;

async function outcomes(who: keyof Fx["auth"]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const c of toolCalls(fx)) {
    resetLimits();
    out[key(c)] = (await runTool(fx.auth[who], c.tool, c.args, { surface: "in_app" })).outcome;
  }
  return out;
}

const OFFICE_DENIED = ["daily_report/default", "homework_status/summary", "assignment_status/summary", "mastery_overview/default"];

describe("the registry", () => {
  it("has the 24 tools of PRD §7, uniquely named, each with a gate, a cap and Bangla keywords", () => {
    expect(TOOL_REGISTRY).toHaveLength(24);
    expect(new Set(TOOL_REGISTRY.map((t) => t.name)).size).toBe(24);
    for (const t of TOOL_REGISTRY) {
      expect(t.name).toMatch(/^[a-z_]+$/);
      expect(t.gates.length).toBeGreaterThan(0);
      expect(t.maxRows).toBeGreaterThan(0);
      expect(t.description).toMatch(/[ঀ-৿]/);
    }
  });
});

describe("Principal", () => {
  it("gets ok from every tool and mode", async () => {
    const o = await outcomes("principal");
    for (const [k, v] of Object.entries(o)) expect([k, v]).toEqual([k, NO_DATA.has(k) ? "invalid" : "ok"]);
  });
});

describe("Office (template defaults + data_assistant:use)", () => {
  it("is refused exactly where the screens refuse it", async () => {
    const o = await outcomes("office");
    for (const [k, v] of Object.entries(o)) {
      const want = OFFICE_DENIED.includes(k) ? "denied" : NO_DATA.has(k) ? "invalid" : "ok";
      expect([k, v]).toEqual([k, want]);
    }
  });
  it("a denial is the §5.4 shape with the missing switches named in both languages", async () => {
    const r = await runTool(fx.auth.office, "mastery_overview", {}, { surface: "in_app" });
    expect(r.reply).toMatchObject({ ok: false, error: "permission_denied", needs: ["mastery:view", "mastery:approve"] });
    const e = r.reply as { message_bn: string; message_en: string };
    expect(e.message_bn).toContain("অনুমতি আপনার নেই");
    expect(e.message_en).toContain("You don't have permission");
  });
  it("a revoke turns ok into denied", async () => {
    const o = await outcomes("officeRevoked");
    expect(o["attendance_day/default"]).toBe("denied");
    expect(o["payroll_summary/totals"]).toBe("denied");
    expect(o["payroll_summary/person"]).toBe("denied");
    expect(o["find_students/default"]).toBe("ok");
  });
  it("a grant turns denied into ok", async () => {
    const o = await outcomes("officeGranted");
    expect(o["homework_status/summary"]).toBe("ok");
    expect(o["mastery_overview/default"]).toBe("ok");
    expect(o["daily_report/default"]).toBe("ok");
  });
});

describe("Teacher (class teacher of one section; data_assistant:use granted)", () => {
  it("passes only the teacher screens' gates", async () => {
    const o = await outcomes("teacher");
    const ok = ["my_access/default", "student_attendance_history/default", "homework_status/summary", "routine_lookup/section_day", "routine_lookup/covers", "find_staff/default", "question_bank_stats/counts"];
    for (const k of ok) expect([k, o[k]]).toEqual([k, "ok"]);
    for (const k of ["find_students/default", "attendance_day/default", "staff_leave/default", "payroll_summary/totals", "finance_summary/year", "monthly_report_status/default", "notices/default"]) expect([k, o[k]]).toEqual([k, "denied"]);
  });
  it("homework summary lists only the teacher's own section", async () => {
    const r = await runTool(fx.auth.teacher, "homework_status", { mode: "summary", class_level: 3 }, { surface: "in_app" });
    expect(r.outcome).toBe("ok");
    const rows = (r.reply as { data: Array<{ section_id: string }> }).data;
    expect(rows.map((x) => x.section_id)).toEqual([fx.ids.sectionA]);
  });
  it("another section's attendance history is refused (only the class teacher reads it)", async () => {
    const r = await runTool(fx.auth.teacher, "student_attendance_history", { student_id: fx.ids.studentB, from: fx.today, to: fx.today }, { surface: "in_app" });
    expect(r.outcome).toBe("denied");
  });
});

describe("refused before any service runs", () => {
  it.each(["guardian", "deactivated", "officeNoUse"] as const)("%s", async (who) => {
    for (const t of ["find_students", "attendance_day", "my_access"]) {
      const r = await runTool(fx.auth[who], t, t === "find_students" ? { query: "Ayesha" } : {}, { surface: "in_app" });
      expect(r.outcome).toBe("denied");
      expect((r.reply as { needs: string[] }).needs).toEqual(["data_assistant:use"]);
    }
  });
  it("the Claude door needs data_assistant:connect", async () => {
    const r = await runTool(fx.auth.officeNoUse, "my_access", {}, { surface: "claude" });
    expect((r.reply as { needs: string[] }).needs).toEqual(["data_assistant:connect"]);
  });
});

describe("visible(auth) matches the outcomes", () => {
  it("a tool hidden from a person is denied for every mode; a visible one passes at least one", async () => {
    for (const who of ["office", "teacher"] as const) {
      const o = await outcomes(who);
      for (const t of TOOL_REGISTRY) {
        const modes = Object.entries(o).filter(([k]) => k.startsWith(`${t.name}/`));
        if (modes.length === 0) continue;
        const anyOk = modes.some(([, v]) => v === "ok" || v === "invalid");
        if (!toolVisible(t, fx.auth[who])) expect([who, t.name, anyOk]).toEqual([who, t.name, false]);
      }
    }
    expect(toolVisible(findTool("my_access")!, fx.auth.office)).toBe(true);
    expect(toolVisible(findTool("my_access")!, fx.auth.guardian)).toBe(false);
  });
  it("my_access lists available and blocked areas with the missing switch in Bangla", async () => {
    const r = await runTool(fx.auth.office, "my_access", {}, { surface: "in_app" });
    const d = (r.reply as { data: { areas_available: Array<{ tool: string }>; areas_blocked: Array<{ tool: string; needs_bn: string }> } }).data;
    expect(d.areas_available.map((x) => x.tool)).toContain("attendance_day");
    const blocked = d.areas_blocked.find((x) => x.tool === "mastery_overview");
    expect(blocked?.needs_bn).toMatch(/[ঀ-৿]/);
  });
});

describe("arguments are typed", () => {
  it("unknown keys, free query operators and unknown tools are invalid", async () => {
    expect((await runTool(fx.auth.principal, "find_students", { query: { $ne: null } }, { surface: "in_app" })).outcome).toBe("invalid");
    expect((await runTool(fx.auth.principal, "find_students", { collection: "users" }, { surface: "in_app" })).outcome).toBe("invalid");
    expect((await runTool(fx.auth.principal, "find_students", { query: "a.*" }, { surface: "in_app" })).outcome).toBe("invalid");
    expect((await runTool(fx.auth.principal, "run_query", { filter: {} }, { surface: "in_app" })).outcome).toBe("invalid");
    expect(await AiDataCall.countDocuments({ tool: "run_query", outcome: "invalid" })).toBe(1);
  });
});
