/**
 * The data assistant's tool registry (docs/prd-data-assistant-mcp.md §7; D-#1531). ONE array in a
 * fixed order — the in-app prompt prefix and the MCP tool list follow it, so two people with the
 * same permissions get byte-identical lists (prompt cache, D-#1203). Only read tools exist here;
 * there is no raw query tool. No tool reads child support-profile data (§5.6).
 */
import { FEATURE_CATALOGUE } from "@scd/shared";
import { passes, rulePerms, toolVisible, permLabel } from "../gates";
import type { ToolDef } from "../types";
import { findStudents, studentOverview } from "./students";
import { attendanceDay, attendanceRanking, studentAttendanceHistoryTool } from "./attendance";
import { assignmentStatus, homeworkStatus, lessonProgress, routineLookup } from "./teaching";
import { classTestMarks, classTestStatus, examResults, masteryOverview, monthlyReportStatus, questionBankStats } from "./assessment";
import { findStaff, payrollSummary, staffAttendance, staffLeave } from "./staff";
import { feeDues, financeSummary } from "./finance";
import { dailyReport, notices } from "./school";

const ROLE_BN: Record<string, string> = { PRINCIPAL: "প্রধান শিক্ষক", OFFICE: "অফিস", TEACHER: "শিক্ষক" };

export const myAccess: ToolDef = {
  name: "my_access",
  label_bn: "আমি কী জানতে পারি",
  label_en: "What I can ask",
  description:
    "What can I ask about? (কী জিজ্ঞেস করতে পারি, অনুমতি). Lists the areas this person may ask about and the areas they may not, with the missing " +
    "permission's name. Call it when unsure, or to explain a 'no permission' answer.",
  input: {},
  gates: [{ mode: "default", rule: { authenticated: true }, resolver: null, note: "The door switch (data_assistant:use / :connect) is its only gate." }],
  alwaysVisible: true,
  maxRows: 30,
  async run(ctx) {
    const available = [];
    const blocked = [];
    for (const t of TOOL_REGISTRY) {
      if (t.name === "my_access") continue;
      if (toolVisible(t, ctx.auth)) {
        const partial = t.gates.filter((g) => !passes(ctx.auth, g.rule)).map((g) => g.mode);
        available.push({ tool: t.name, label_bn: t.label_bn, label_en: t.label_en, ...(partial.length ? { modes_not_allowed: partial } : {}) });
      } else {
        const needs = [...new Set(t.gates.flatMap((g) => rulePerms(g.rule)))];
        blocked.push({ tool: t.name, label_bn: t.label_bn, needs_bn: needs.map((p) => permLabel(p, "bn")).join(" / ") });
      }
    }
    return {
      data: { role_label_bn: ROLE_BN[ctx.auth.role] ?? ctx.auth.role, feature_bn: FEATURE_CATALOGUE.data_assistant.bn, areas_available: available, areas_blocked: blocked },
      rowCount: available.length + blocked.length,
    };
  },
};

export const TOOL_REGISTRY: readonly ToolDef[] = [
  myAccess,
  dailyReport,
  findStudents,
  studentOverview,
  attendanceDay,
  studentAttendanceHistoryTool,
  attendanceRanking,
  homeworkStatus,
  assignmentStatus,
  classTestStatus,
  classTestMarks,
  examResults,
  masteryOverview,
  lessonProgress,
  routineLookup,
  findStaff,
  staffAttendance,
  staffLeave,
  payrollSummary,
  financeSummary,
  feeDues,
  notices,
  questionBankStats,
  monthlyReportStatus,
];

export function findTool(name: string): ToolDef | undefined {
  return TOOL_REGISTRY.find((t) => t.name === name);
}
