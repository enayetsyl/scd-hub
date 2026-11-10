/**
 * AI Workspace W-7 — analytics per project (docs/prd-ai-workspace.md §9), on an in-memory
 * MongoDB: spend / calls / tokens / cache-hit rate from the ledger, drafts created / approved
 * / AI-revised, jobs, pilot scores and what Claude started — only inside the date range — and
 * the workspace line in the AI-7 budget section.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User } from "../modules/foundation/models/User";
import { AiUsage } from "../modules/platform/models/AiUsage";
import { AiDraft, AiDraftVersion } from "../modules/ai-workspace/models/AiDraft";
import { AiJob } from "../modules/ai-workspace/models/AiJob";
import { createAiProject } from "../modules/ai-workspace/services/AiProjectService";
import { workspaceProjectRows } from "../modules/ai-workspace/services/WorkspaceAnalytics";
import { aiUsageReport } from "../modules/platform/services/AiAnalyticsService";
import type { AuthPayload } from "../context";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const principal: AuthPayload = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" };
const IN = new Date("2026-11-05T06:00:00Z");
const OUT = new Date("2026-10-05T06:00:00Z");

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  await User.create({ _id: principal.userId, role: "PRINCIPAL", name: "Head Teacher", phone: "01700000001", passwordHash: "x" });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

it("one row per active project, counting only the range", async () => {
  const a = (await createAiProject(principal, { name: "Lesson plans", nameProtection: false })).id;
  const b = (await createAiProject(principal, { name: "Storybooks", nameProtection: false })).id;
  const usage = (projectId: string, at: Date, costUsd: number, hit: number, miss: number) => ({
    at, branch: "sylhet", feature: "workspace_chat", callId: new Types.ObjectId().toString(), attempt: 1, provider: "deepseek", modelName: "deepseek-flash", costUsd, outcome: "ok", projectId, cacheHitTokens: hit, cacheMissTokens: miss, outputTokens: 100,
  });
  await AiUsage.create([usage(a, IN, 0.5, 900, 100), usage(a, IN, 0.25, 900, 100), usage(a, OUT, 9, 1, 1), usage(b, IN, 0.1, 0, 1000)]);
  const draft = (projectId: string, extra: Record<string, unknown> = {}) => ({ projectId, title: "d", kind: "free", currentVersion: 1, createdBy: principal.userId, origin: "app", sends: [], createdAt: IN, updatedAt: IN, ...extra });
  const [d1] = await AiDraft.insertMany([
    draft(a, { approvedVersion: 1, approvedAt: IN, review: { score: "usable", by: principal.userId, at: IN, version: 1 } }),
    draft(a, { origin: "claude", review: { score: "rewrite", by: principal.userId, at: IN, version: 1 } }),
    draft(a, { createdAt: OUT }),
  ]);
  await AiDraftVersion.create({ draftId: d1._id, projectId: a, version: 2, body: "x", source: "revise", origin: "app", at: IN });
  const job = { projectId: a, title: "j", kind: "free", template: "{{item}}", templateKey: "k", policyHash: "h", modelName: "deepseek-flash", thinking: "low", runAt: "now", estimate: { nowUsd: 1, offpeakUsd: 0.5, inputTokens: 1, outputTokens: 1 }, createdBy: principal.userId };
  await AiJob.create([
    { ...job, status: "done", createdAt: IN },
    { ...job, status: "failed", origin: "claude", createdAt: IN },
  ]);

  const rows = await workspaceProjectRows(new Date("2026-11-01T00:00:00+06:00"), new Date("2026-12-01T00:00:00+06:00"));
  expect(rows.map((r) => r.name)).toEqual(["Lesson plans", "Storybooks"]);
  expect(rows[0]).toMatchObject({
    usd: 0.75,
    calls: 2,
    inputTokens: 2000,
    outputTokens: 200,
    cacheHitRate: 0.9,
    draftsCreated: 2,
    draftsApproved: 1,
    revisions: 1,
    jobs: 2,
    jobsDone: 1,
    jobsFailed: 1,
    scoreUsable: 1,
    scoreRewrite: 1,
    scoreMinor: 0,
    byClaude: 2,
  });
  expect(rows[1]).toMatchObject({ usd: 0.1, cacheHitRate: 0, draftsCreated: 0 });
});

it("the AI-7 report carries byProject and a workspace line in the budget", async () => {
  const r = await aiUsageReport(principal, "2026-11-01", "2026-11-30", new Date("2026-11-10T06:00:00Z"));
  expect(r.byProject.length).toBe(2);
  const ws = r.budget.find((b) => b.scope === "workspace");
  expect(ws).toMatchObject({ capUsd: 10 });
  expect(ws!.spentUsd).toBeCloseTo(0.85);
  expect(r.budget.map((b) => b.scope).slice(-2)).toEqual(["workspace", "global"]);
});
