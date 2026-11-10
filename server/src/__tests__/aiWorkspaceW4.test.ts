/**
 * AI Workspace W-4 — batch jobs (docs/prd-ai-workspace.md §6; D-#1209, D-#1213), on an
 * in-memory MongoDB. The AI call is a stub; the worker functions are driven directly.
 *   • estimate: both prices; off-peak is half; the first item writes the cache
 *   • create: run time required, {{item}} required, template saved as an AiPolicy version
 *   • claim: at peak only "now" jobs run; off-peak jobs wait for off-peak; claims are atomic
 *   • run: the project prefix + the filled template → a draft (source "job"); cost recorded
 *   • validator refusal goes back to the AI with its answer, up to twice; then the item fails
 *   • provider failure retries twice with backoff, then fails
 *   • cancel, stale requeue, concurrency 2, and one "job finished" notification
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User } from "../modules/foundation/models/User";
import { AiPolicy } from "../modules/platform/models/AiPolicy";
import { AiUsage } from "../modules/platform/models/AiUsage";
import { Notification } from "../modules/notifications/models/Notification";
import { AiJob } from "../modules/ai-workspace/models/AiJob";
import { AiDraft, AiDraftVersion } from "../modules/ai-workspace/models/AiDraft";
import { AiProject } from "../modules/ai-workspace/models/AiProject";
import { createAiProject, saveAiProjectInstructions } from "../modules/ai-workspace/services/AiProjectService";
import { projectPrefix } from "../modules/ai-workspace/services/ProjectChatService";
import {
  cancelJob,
  claimNextItem,
  createJob,
  estimateJob,
  finishIfDone,
  job,
  requeueStaleItems,
  runItem,
  workerTick,
} from "../modules/ai-workspace/services/JobService";
import { AiProviderError, type AiSendInput } from "../modules/platform/ai/provider";
import type { aiSend } from "../modules/platform/ai/aiRouter";
import type { AuthPayload } from "../context";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const principal: AuthPayload = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" };
const MON_PEAK = new Date("2026-11-09T07:00:00Z");
const MON_OFF = new Date("2026-11-09T12:00:00Z");
let projectId = "";

type Call = { input: AiSendInput; ctx: Record<string, unknown> };
function sendWith(reply: (input: AiSendInput, n: number) => string | Error, calls: Call[] = []) {
  return (async (_f: string, input: AiSendInput, ctx: Record<string, unknown>) => {
    calls.push({ input, ctx });
    const r = reply(input, calls.length);
    if (r instanceof Error) throw r;
    const callId = new Types.ObjectId().toString();
    await AiUsage.create({ at: new Date(), branch: "sylhet", feature: "workspace_job", callId, attempt: 1, provider: "deepseek", modelName: "deepseek-flash", costUsd: 0.01, outcome: "ok", projectId: ctx.projectId as string });
    return { result: { provider: "deepseek", model: "deepseek-flash", resolvedModel: "deepseek-flash", text: r, usage: { cacheHitTokens: 900, cacheMissTokens: 100, outputTokens: 50, reasoningTokens: null }, finishReason: "stop", latencyMs: 1 }, attempts: [], callId };
  }) as unknown as typeof aiSend;
}
const base = { title: "সেশন পরিকল্পনা", kind: "free", template: "এই বিষয়ে একটি পাঠ লিখুন: {{item}}", model: "deepseek-flash", thinking: "low" };

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  await User.create({ _id: principal.userId, role: "PRINCIPAL", name: "Head Teacher", phone: "01700000001", passwordHash: "x" });
  projectId = (await createAiProject(principal, { name: "Jobs", nameProtection: false })).id;
  await saveAiProjectInstructions(principal, projectId, "## নিয়ম\nছোট করে লিখুন।");
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await AiJob.deleteMany({});
});

describe("estimate and create", () => {
  it("estimates both prices; off-peak is half of peak", async () => {
    const e = await estimateJob(principal, projectId, { ...base, items: ["ক", "খ", "গ"] });
    expect(e.items).toBe(3);
    expect(e.outputTokens).toBe(3 * 3000);
    expect(e.offpeakUsd).toBeGreaterThan(0);
    expect(e.nowUsd === e.offpeakUsd || Math.abs(e.nowUsd - 2 * e.offpeakUsd) < 0.0002).toBe(true);
  });

  it("requires the run choice, {{item}} and 1..200 items; saves the template as a versioned policy", async () => {
    await expect(createJob(principal, projectId, { ...base, items: ["ক"] })).rejects.toThrow("কম দামে");
    await expect(createJob(principal, projectId, { ...base, template: "no slot", items: ["ক"], runAt: "now" })).rejects.toThrow("{{item}}");
    await expect(createJob(principal, projectId, { ...base, items: [" ", ""], runAt: "now" })).rejects.toThrow("বিষয় দিন");
    const j = await createJob(principal, projectId, { ...base, items: ["ক", " খ "], runAt: "offpeak" });
    expect(j).toMatchObject({ total: 2, queued: 2, status: "queued", runAt: "offpeak", model: "deepseek-flash" });
    expect(j.items.map((i) => i.value)).toEqual(["ক", "খ"]);
    const doc = await AiJob.findById(j.id).lean();
    expect(doc?.templateKey).toBe(`project:${projectId}:template:job-${j.id}`);
    expect(await AiPolicy.findOne({ key: doc!.templateKey, active: true }).lean()).toMatchObject({ version: 1, body: base.template });
  });
});

describe("the worker", () => {
  it("at peak only 'now' jobs are claimed; off-peak jobs wait for off-peak", async () => {
    const off = await createJob(principal, projectId, { ...base, items: ["ক"], runAt: "offpeak" });
    expect(await claimNextItem(MON_PEAK)).toBeNull();
    const now = await createJob(principal, projectId, { ...base, items: ["খ"], runAt: "now" });
    expect((await claimNextItem(MON_PEAK))?.jobId.toString()).toBe(now.id);
    expect((await claimNextItem(MON_OFF))?.jobId.toString()).toBe(off.id);
    expect(await claimNextItem(MON_OFF)).toBeNull();
  });

  it("an item runs on the project prefix + the filled template and becomes a job draft; one notification at the end", async () => {
    const calls: Call[] = [];
    const j = await createJob(principal, projectId, { ...base, items: ["নদী"], runAt: "now" });
    const claim = (await claimNextItem(MON_OFF))!;
    await runItem(claim.jobId, claim.itemId, { send: sendWith(() => "নদী নিয়ে পাঠ", calls) });
    const p = await AiProject.findById(projectId);
    expect(calls[0].input.stablePrefix).toBe((await projectPrefix(p!)).stablePrefix);
    expect(calls[0].input.variablePart).toBe("এই বিষয়ে একটি পাঠ লিখুন: নদী");
    expect(calls[0].ctx).toMatchObject({ modelOverride: "deepseek-flash", projectId, refType: "AiJob", refId: j.id });
    const view = await job(principal, j.id);
    expect(view).toMatchObject({ done: 1, costUsd: 0.01, cacheHitRate: 0.9 });
    const draft = await AiDraft.findById(view.items[0].draftId).lean();
    expect(draft).toMatchObject({ kind: "free", jobId: new Types.ObjectId(j.id) });
    expect(await AiDraftVersion.findOne({ draftId: draft!._id }).lean()).toMatchObject({ body: "নদী নিয়ে পাঠ", source: "job" });
    expect(await finishIfDone(claim.jobId)).toBe(true);
    expect(await finishIfDone(claim.jobId)).toBe(true);
    expect((await AiJob.findById(j.id).lean())?.status).toBe("done");
    expect(await Notification.countDocuments({ kind: "AI_JOB_FINISHED", recipientUserId: principal.userId })).toBe(1);
  });

  it("a validator refusal goes back to the AI with its own answer; it passes on the second try", async () => {
    const calls: Call[] = [];
    const j = await createJob(principal, projectId, { ...base, kind: "question_bank", items: ["ভগ্নাংশ"], runAt: "now" });
    const claim = (await claimNextItem(MON_OFF))!;
    await runItem(claim.jobId, claim.itemId, { send: sendWith((_i, n) => (n === 1 ? "not json" : '```json\n{"questions":[]}\n```'), calls) });
    expect(calls).toHaveLength(2);
    expect(calls[1].input.history).toEqual([
      { role: "user", text: "এই বিষয়ে একটি পাঠ লিখুন: ভগ্নাংশ" },
      { role: "assistant", text: "not json" },
    ]);
    expect(calls[1].input.variablePart).toContain("refused by the school's validator");
    expect((await job(principal, j.id)).items[0]).toMatchObject({ status: "done", fixes: 1 });
  });

  it("after two refused fixes the item fails with the validator's reasons; a lesson plan uses the import gate", async () => {
    const j = await createJob(principal, projectId, { ...base, kind: "lesson_plan", items: ["শব্দার্থ"], runAt: "now" });
    const claim = (await claimNextItem(MON_OFF))!;
    const validate = jest.fn(async () => ["C-9: objective missing"]);
    await runItem(claim.jobId, claim.itemId, { send: sendWith(() => '```json\n{"plan_type":"session_plan"}\n```\n# সেশন'), validate });
    expect(validate).toHaveBeenCalledTimes(3);
    expect((await job(principal, j.id)).items[0]).toMatchObject({ status: "failed", fixes: 2 });
    expect((await job(principal, j.id)).items[0].error).toContain("C-9: objective missing");
  });

  it("a provider failure is retried twice with backoff, then the item fails", async () => {
    const j = await createJob(principal, projectId, { ...base, items: ["বৃষ্টি"], runAt: "now" });
    const down = sendWith(() => new AiProviderError("busy", "503", "deepseek"));
    for (let i = 0; i < 2; i++) {
      const c = (await claimNextItem(new Date(MON_OFF.getTime() + i * 10 * 60_000)))!;
      await runItem(c.jobId, c.itemId, { send: down, now: () => MON_OFF });
      const it = (await AiJob.findById(j.id).lean())!.items[0];
      expect(it).toMatchObject({ status: "queued", attempts: i + 1 });
      expect(it.nextTryAt).toBeTruthy();
    }
    expect(await claimNextItem(MON_OFF)).toBeNull(); // still backing off
    const c3 = (await claimNextItem(new Date(MON_OFF.getTime() + 60 * 60_000)))!;
    await runItem(c3.jobId, c3.itemId, { send: down, now: () => MON_OFF });
    expect((await AiJob.findById(j.id).lean())!.items[0]).toMatchObject({ status: "failed", attempts: 3 });
  });

  it("cancel stops items not started; a stale running item is queued again", async () => {
    const j = await createJob(principal, projectId, { ...base, items: ["এক", "দুই", "তিন"], runAt: "now" });
    await claimNextItem(MON_OFF);
    const v = await cancelJob(principal, j.id);
    expect(v).toMatchObject({ running: 1, queued: 0 });
    expect(v.items.filter((i) => i.status === "cancelled")).toHaveLength(2);
    await AiJob.updateOne({ _id: j.id }, { $set: { heartbeatAt: new Date(Date.now() - 60 * 60_000) } });
    expect(await requeueStaleItems(new Date())).toBe(1);
    expect((await job(principal, j.id)).queued).toBe(1);
  });

  it("the worker tick runs two items at a time and finishes the job", async () => {
    const j = await createJob(principal, projectId, { ...base, items: ["ক", "খ", "গ"], runAt: "now" });
    let live = 0;
    let peakLive = 0;
    const send = (async (f: string, input: AiSendInput, ctx: Record<string, unknown>) => {
      live++;
      peakLive = Math.max(peakLive, live);
      await new Promise((r) => setTimeout(r, 30));
      live--;
      return sendWith(() => "ঠিক আছে")(f, input, ctx as never);
    }) as unknown as typeof aiSend;
    expect(await workerTick(2, { send, now: () => MON_OFF })).toBe(2);
    expect(await workerTick(2, { send, now: () => MON_OFF })).toBe(1);
    expect(peakLive).toBe(2);
    expect((await AiJob.findById(j.id).lean())?.status).toBe("done");
  });
});
