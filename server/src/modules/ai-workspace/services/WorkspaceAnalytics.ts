/**
 * AI Workspace analytics per project (W-7, docs/prd-ai-workspace.md §9) — the rows the AI-7
 * report (`aiUsageReport.byProject`, `reports:ai_usage`) shows for a date range:
 *   spend, calls, tokens and cache-hit rate (from AiUsage.projectId), drafts created /
 *   approved / AI-revised, batch jobs (done / partial / failed), the pilot scores, and how
 *   much Claude started (origin "claude"). Counts only — never a prompt or a reply.
 */
import { Types } from "mongoose";
import { AiUsage } from "../../platform/models/AiUsage";
import { AiProject } from "../models/AiProject";
import { AiDraft, AiDraftVersion } from "../models/AiDraft";
import { AiJob } from "../models/AiJob";

export interface ProjectUsageRow {
  projectId: string;
  name: string;
  usd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheHitRate: number | null;
  draftsCreated: number;
  draftsApproved: number;
  revisions: number;
  jobs: number;
  jobsDone: number;
  jobsFailed: number;
  scoreUsable: number;
  scoreMinor: number;
  scoreRewrite: number;
  byClaude: number;
}

type Counts = Map<string, number>;
const toMap = (rows: Array<{ _id: unknown; n: number }>): Counts => new Map(rows.filter((r) => r._id).map((r) => [String(r._id), r.n]));

export async function workspaceProjectRows(from: Date, to: Date): Promise<ProjectUsageRow[]> {
  const range = { $gte: from, $lt: to };
  const [usage, created, approved, revisions, jobs, scores, claudeDrafts, claudeJobs] = await Promise.all([
    AiUsage.aggregate<{ _id: Types.ObjectId; usd: number; calls: number; hit: number; miss: number; out: number }>([
      { $match: { at: range, projectId: { $ne: null } } },
      {
        $group: {
          _id: "$projectId",
          usd: { $sum: "$costUsd" },
          calls: { $sum: { $cond: [{ $and: [{ $eq: ["$attempt", 1] }, { $ne: ["$outcome", "capped"] }] }, 1, 0] } },
          hit: { $sum: "$cacheHitTokens" },
          miss: { $sum: "$cacheMissTokens" },
          out: { $sum: "$outputTokens" },
        },
      },
    ]),
    AiDraft.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { createdAt: range } }, { $group: { _id: "$projectId", n: { $sum: 1 } } }]),
    AiDraft.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { approvedAt: range } }, { $group: { _id: "$projectId", n: { $sum: 1 } } }]),
    AiDraftVersion.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { at: range, source: "revise" } }, { $group: { _id: "$projectId", n: { $sum: 1 } } }]),
    AiJob.aggregate<{ _id: Types.ObjectId; n: number; done: number; failed: number }>([
      { $match: { createdAt: range } },
      {
        $group: {
          _id: "$projectId",
          n: { $sum: 1 },
          done: { $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
        },
      },
    ]),
    AiDraft.aggregate<{ _id: { p: Types.ObjectId; s: string }; n: number }>([
      { $match: { "review.at": range } },
      { $group: { _id: { p: "$projectId", s: "$review.score" }, n: { $sum: 1 } } },
    ]),
    AiDraft.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { createdAt: range, origin: "claude" } }, { $group: { _id: "$projectId", n: { $sum: 1 } } }]),
    AiJob.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { createdAt: range, origin: "claude" } }, { $group: { _id: "$projectId", n: { $sum: 1 } } }]),
  ]);
  const ids = new Set<string>([
    ...usage.map((u) => String(u._id)),
    ...created.map((c) => String(c._id)),
    ...approved.map((c) => String(c._id)),
    ...jobs.map((j) => String(j._id)),
    ...scores.map((s) => String(s._id.p)),
  ]);
  if (ids.size === 0) return [];
  const names = new Map((await AiProject.find({ _id: { $in: [...ids] } }).select("name").lean()).map((p) => [p._id.toString(), p.name]));
  const createdM = toMap(created);
  const approvedM = toMap(approved);
  const revisionsM = toMap(revisions);
  const claudeM = new Map<string, number>();
  for (const r of [...claudeDrafts, ...claudeJobs]) claudeM.set(String(r._id), (claudeM.get(String(r._id)) ?? 0) + r.n);
  const score = (id: string, s: string) => scores.find((x) => String(x._id.p) === id && x._id.s === s)?.n ?? 0;
  const rows = [...ids].map((id) => {
    const u = usage.find((x) => String(x._id) === id);
    const j = jobs.find((x) => String(x._id) === id);
    return {
      projectId: id,
      name: names.get(id) ?? "—",
      usd: Math.round((u?.usd ?? 0) * 1e6) / 1e6,
      calls: u?.calls ?? 0,
      inputTokens: (u?.hit ?? 0) + (u?.miss ?? 0),
      outputTokens: u?.out ?? 0,
      cacheHitRate: u && u.hit + u.miss > 0 ? Math.round((u.hit / (u.hit + u.miss)) * 100) / 100 : null,
      draftsCreated: createdM.get(id) ?? 0,
      draftsApproved: approvedM.get(id) ?? 0,
      revisions: revisionsM.get(id) ?? 0,
      jobs: j?.n ?? 0,
      jobsDone: j?.done ?? 0,
      jobsFailed: j?.failed ?? 0,
      scoreUsable: score(id, "usable"),
      scoreMinor: score(id, "minor"),
      scoreRewrite: score(id, "rewrite"),
      byClaude: claudeM.get(id) ?? 0,
    };
  });
  return rows.sort((a, b) => b.usd - a.usd || a.name.localeCompare(b.name));
}
