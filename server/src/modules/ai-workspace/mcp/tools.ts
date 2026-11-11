/**
 * The MCP bridge's tools (AI Workspace W-5, docs/prd-ai-workspace.md §7; D-#1214).
 *
 * Every tool runs as the Principal who authorised the connector, through the SAME services
 * the app uses (so the same permissions, caps and audit). Replies are small JSON summaries
 * with ids; full text only through read_file / read_draft by character range. Long work
 * returns a job id. ds_draft / run_batch / revise_draft REQUIRE run_at, model and thinking —
 * no defaults (D-#1209); Claude asks the Principal and states both prices first.
 * Everything Claude starts is marked origin "claude" and shows in the app.
 */
import { z } from "zod";
import { Types } from "mongoose";
import type { McpServerLike } from "./sdk";
import type { AuthPayload } from "../../../context";
import { AiUsage } from "../../platform/models/AiUsage";
import { WORKSPACE_AI_FEATURES } from "../../platform/services/AiSettingService";
import { dhakaMonthStart } from "../../platform/services/AiUsageService";
import { AiProject } from "../models/AiProject";
import { AiProjectFile } from "../models/AiProjectFile";
import { AiMcpCall } from "../models/AiOAuth";
import { aiProjectInstructions, aiProjectsPage, contextBudgetOf, loadProject, saveAiProjectInstructions } from "../services/AiProjectService";
import { aiProjectFilesPage, aiProjectFileText } from "../services/FileIngestService";
import { createJob, estimateJob, job } from "../services/JobService";
import { draft, draftVersion, reviseDraft } from "../services/DraftService";

const MAX_SLICE = 50_000;
const MODEL = z.enum(["deepseek-flash", "deepseek-v4-pro"]).describe("DeepSeek model. Ask the Principal; there is no default.");
const THINKING = z.enum(["off", "low", "high"]).describe("Thinking level. Ask the Principal; there is no default.");
const RUN_AT = z
  .enum(["now", "offpeak"])
  .describe("When to run: 'now' (current price) or 'offpeak' (half price, waits for DeepSeek's off-peak window). REQUIRED — ask the Principal and state both estimated costs before choosing.");
const KIND = z.enum(["free", "lesson_plan", "question_bank", "book_chapter", "storybook", "paper"]).describe("The draft kind each result becomes.");

/** The arguments every run-starting tool shares. */
type ToolRun = { project_id: string; title: string; kind: string; model: string; thinking: string; run_at: string };

type Reply = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function reply(data: unknown): Reply {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

/** Wraps a tool so every call is logged with its reply size and errors come back as text. */
function logged(auth: AuthPayload, clientName: string, tool: string, fn: (args: never) => Promise<unknown>) {
  return async (args: never): Promise<Reply> => {
    const started = Date.now();
    let out: Reply;
    let ok = true;
    try {
      out = reply(await fn(args));
    } catch (e) {
      ok = false;
      out = { content: [{ type: "text", text: JSON.stringify({ error: (e as Error).message || "failed" }) }], isError: true };
    }
    const bytes = Buffer.byteLength(out.content[0].text, "utf8");
    void AiMcpCall.create({ at: new Date(), userId: new Types.ObjectId(auth.userId), clientName, tool, ok, replyBytes: bytes, ms: Date.now() - started }).catch(() => undefined);
    return out;
  };
}

const slice = (text: string, offset?: number, length?: number) => {
  const total = text.length;
  const from = Math.max(0, Math.min(total, Math.floor(offset ?? 0)));
  const len = Math.max(1, Math.min(MAX_SLICE, Math.floor(length ?? 20_000)));
  return { offset: from, length: Math.min(len, total - from), total_chars: total, text: text.slice(from, from + len), more: from + len < total };
};

/**
 * Registration WITHOUT the SDK's generics. `registerTool<…>` infers a zod v3/v4-compatible
 * type for every input shape; ten of them made `tsc` run out of memory (4 GB, CI and local).
 * The zod schemas still validate at runtime; each callback types its own arguments.
 */
type PlainRegister = (name: string, config: { description: string; inputSchema: Record<string, z.ZodTypeAny> }, cb: (args: never) => Promise<Reply>) => unknown;

export function registerWorkspaceTools(server: McpServerLike, auth: AuthPayload, clientName: string): void {
  const register = (server.registerTool as unknown as PlainRegister).bind(server);
  const t = <A>(name: string, description: string, inputSchema: Record<string, z.ZodTypeAny>, fn: (args: A) => Promise<unknown>) =>
    register(name, { description, inputSchema }, logged(auth, clientName, name, fn as never));

  t("list_projects", "Projects in the SCD Hub AI Workspace, with their context size in tokens (instructions + pinned files) and defaults.", {}, async () => {
    const page = await aiProjectsPage(auth, { page: 1, pageSize: 100 });
    const out = [];
    for (const p of page.rows) {
      const doc = await AiProject.findById(p.id);
      const b = doc ? await contextBudgetOf(doc) : null;
      out.push({ id: p.id, name: p.name, description: p.description, files: p.fileCount, context_tokens: b?.totalTokens ?? null, default_model: p.defaultModel, default_thinking: p.defaultThinking, name_protection: p.nameProtection });
    }
    return { projects: out, total: page.total };
  });

  t(
    "read_project",
    "A project's CURRENT instructions (the master copy — apply them) and its file list with token counts. Read this before working on a project.",
    { project_id: z.string() },
    async ({ project_id }: { project_id: string }) => {
      const { project } = await loadProject(auth, project_id, "viewer");
      const [instr, files, budget] = await Promise.all([aiProjectInstructions(auth, project_id), aiProjectFilesPage(auth, project_id, { page: 1, pageSize: 100 }), contextBudgetOf(project)]);
      const body = instr?.body ?? "";
      return {
        id: project_id,
        name: project.name,
        instructions: instr ? { version: instr.version, hash: instr.hash, ...slice(body, 0, MAX_SLICE) } : null,
        files: files.rows.map((f) => ({ id: f.id, name: f.name, status: f.status, pinned: f.pinned, tokens: f.tokenCount, token_method: f.tokenMethod, read_by: f.textSource })),
        context_tokens: budget.totalTokens,
      };
    },
  );

  t(
    "read_file",
    "One project file's text by character range (keeps your context small). Default 20,000 characters; at most 50,000.",
    { file_id: z.string(), offset: z.number().int().min(0).optional(), length: z.number().int().min(1).max(MAX_SLICE).optional() },
    async ({ file_id, offset, length }: { file_id: string; offset?: number; length?: number }) => {
      const r = await aiProjectFileText(auth, file_id, offset ?? 0, length ?? 20_000);
      return { file_id, name: r.name, offset: r.offset, total_chars: r.totalChars, text: r.text, more: r.offset + r.text.length < r.totalChars };
    },
  );

  t(
    "update_instructions",
    "Save a NEW version of a project's instructions (it becomes current). Only after the Principal has approved the exact change.",
    { project_id: z.string(), body: z.string().min(1), note: z.string().max(500).optional() },
    async ({ project_id, body, note }: { project_id: string; body: string; note?: string }) => {
      const v = await saveAiProjectInstructions(auth, project_id, body, note ?? "Claude-এর মাধ্যমে (প্রধান শিক্ষকের অনুমোদনে)");
      return { project_id, version: v.version, hash: v.hash };
    },
  );

  t(
    "ds_draft",
    "Ask DeepSeek for ONE draft in a project (on its instructions + pinned files). Returns a job id — poll job_status. model, thinking and run_at are required: ask the Principal first.",
    {
      project_id: z.string(),
      title: z.string().min(2),
      kind: KIND,
      prompt: z.string().min(2),
      file_ids: z.array(z.string()).max(10).optional().describe("Unpinned project files to include for this draft only."),
      model: MODEL,
      thinking: THINKING,
      run_at: RUN_AT,
    },
    async ({ project_id, title, kind, prompt, file_ids, model, thinking, run_at }: ToolRun & { prompt: string; file_ids?: string[] }) => {
      let item = prompt;
      if (file_ids?.length) {
        const files = await AiProjectFile.find({ _id: { $in: file_ids.filter((id) => Types.ObjectId.isValid(id)) }, projectId: project_id, status: "ready" }).select("name text").lean();
        item += files.map((f) => `\n\n# FILE: ${f.name}\n\n${f.text}`).join("");
      }
      const input = { title, kind, template: "{{item}}", items: [item], model, thinking, runAt: run_at, origin: "claude" as const };
      const est = await estimateJob(auth, project_id, input);
      const j = await createJob(auth, project_id, input);
      return { job_id: j.id, status: j.status, estimate_usd: { now: est.nowUsd, offpeak: est.offpeakUsd }, run_at };
    },
  );

  t(
    "run_batch",
    "Run one template over many items (each item replaces {{item}}); each result becomes a draft. Returns a job id and the estimate. model, thinking and run_at are required: ask the Principal and state both estimated costs first.",
    { project_id: z.string(), title: z.string().min(2), kind: KIND, template: z.string().min(2), items: z.array(z.string().min(1)).min(1).max(200), model: MODEL, thinking: THINKING, run_at: RUN_AT },
    async ({ project_id, title, kind, template, items, model, thinking, run_at }: ToolRun & { template: string; items: string[] }) => {
      const input = { title, kind, template, items, model, thinking, runAt: run_at, origin: "claude" as const };
      const est = await estimateJob(auth, project_id, input);
      const j = await createJob(auth, project_id, input);
      return { job_id: j.id, items: j.total, status: j.status, estimate_usd: { now: est.nowUsd, offpeak: est.offpeakUsd }, run_at };
    },
  );

  t("job_status", "A job's progress, failures, cost and cache-hit rate, with each item's draft id.", { job_id: z.string() }, async ({ job_id }: { job_id: string }) => {
    const j = await job(auth, job_id);
    return {
      job_id,
      title: j.title,
      status: j.status,
      done: j.done,
      failed: j.failed,
      queued: j.queued,
      running: j.running,
      cost_usd: j.costUsd,
      cache_hit_rate: j.cacheHitRate,
      items: j.items.map((i) => ({ item: i.value.slice(0, 80), status: i.status, draft_id: i.draftId, error: i.error })),
    };
  });

  t(
    "read_draft",
    "A draft (current version, or a given version) by character range, with its status and any running revision.",
    { draft_id: z.string(), version: z.number().int().min(1).optional(), offset: z.number().int().min(0).optional(), length: z.number().int().min(1).max(MAX_SLICE).optional() },
    async ({ draft_id, version, offset, length }: { draft_id: string; version?: number; offset?: number; length?: number }) => {
      const d = await draft(auth, draft_id);
      const v = version ? await draftVersion(auth, draft_id, version) : d.version;
      return {
        draft_id,
        title: d.draft.title,
        kind: d.draft.kind,
        status: d.draft.status,
        current_version: d.draft.currentVersion,
        version: v.version,
        revise: d.draft.revise,
        has_plan_json: !!v.planJson,
        plan_json: v.planJson && (offset ?? 0) === 0 ? v.planJson.slice(0, MAX_SLICE) : undefined,
        plan_check: v.planCheck ? { verdict: v.planCheck.verdict, fails: v.planCheck.fails, warns: v.planCheck.warns, chapter_draft_id: v.planCheck.chapterDraftId } : undefined,
        ...slice(v.body, offset, length),
      };
    },
  );

  t(
    "revise_draft",
    "DeepSeek writes the next version of a draft from your notes (the project's cached prefix + the current draft). model, thinking and run_at are required: ask the Principal first. Poll read_draft for the new version.",
    { draft_id: z.string(), notes: z.string().min(2), model: MODEL, thinking: THINKING, run_at: RUN_AT },
    async ({ draft_id, notes, model, thinking, run_at }: { draft_id: string; notes: string; model: string; thinking: string; run_at: string }) => {
      const { draft: d, done } = await reviseDraft(auth, draft_id, { notes, model, thinking, runAt: run_at, origin: "claude" });
      done.catch(() => undefined);
      return { draft_id, revise: d.revise, current_version: d.currentVersion };
    },
  );

  t(
    "usage_report",
    "AI Workspace spend for a Dhaka month (default: this month) by project, feature and day.",
    { month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("YYYY-MM") },
    async ({ month }: { month?: string }) => {
      const start = month ? new Date(`${month}-01T00:00:00+06:00`) : dhakaMonthStart(new Date());
      const end = new Date(start);
      end.setUTCMonth(end.getUTCMonth() + 1);
      const match = { feature: { $in: [...WORKSPACE_AI_FEATURES] }, at: { $gte: start, $lt: end } };
      const [byProject, byFeature, byDay] = await Promise.all([
        AiUsage.aggregate([{ $match: match }, { $group: { _id: "$projectId", usd: { $sum: "$costUsd" }, calls: { $sum: 1 } } }]),
        AiUsage.aggregate([{ $match: match }, { $group: { _id: "$feature", usd: { $sum: "$costUsd" }, calls: { $sum: 1 } } }]),
        AiUsage.aggregate([
          { $match: match },
          { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$at", timezone: "+06:00" } }, usd: { $sum: "$costUsd" } } },
          { $sort: { _id: 1 } },
        ]),
      ]);
      const names = new Map((await AiProject.find({ _id: { $in: byProject.map((p) => p._id).filter(Boolean) } }).select("name").lean()).map((p) => [p._id.toString(), p.name]));
      const r = (n: number) => Math.round(n * 10_000) / 10_000;
      return {
        from: start.toISOString(),
        by_project: byProject.map((p) => ({ project: p._id ? names.get(String(p._id)) ?? String(p._id) : "(none)", usd: r(p.usd), calls: p.calls })),
        by_feature: byFeature.map((f) => ({ feature: f._id, usd: r(f.usd), calls: f.calls })),
        by_day: byDay.map((d) => ({ day: d._id, usd: r(d.usd) })),
      };
    },
  );
}
