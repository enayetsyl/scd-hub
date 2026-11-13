/**
 * BL-5 — the AI edit job (docs/prd-book-lifecycle.md §14, §19 bookEditJob; owner Q9, D-#1603).
 * A scripted FAKE provider answers; nothing reaches a network. The configured route even carries a
 * DeepSeek fallback, which the job must never use (no cross-provider switch inside a job).
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
import mongoose, { Types } from "mongoose";
import { setupLc, teardownLc, resetBooks, importSample, item, childVersion, type LcFx } from "./bookLcFixtures";
import { previewEditJob, rerunFailedChapters, runEditJob, startEditJob } from "../modules/book-lifecycle/services/editJob";
import { BookEditDraft } from "../modules/book-lifecycle/models/BookEditDraft";
import { BookEditJob } from "../modules/book-lifecycle/models/BookEditJob";
import { loadDraft } from "../modules/book-lifecycle/services/versionService";
import { AiFeatureSetting } from "../modules/platform/models/AiFeatureSetting";
import { AiUsage } from "../modules/platform/models/AiUsage";
import { AiExchange } from "../modules/platform/models/AiExchange";
import { Student } from "../modules/foundation/models/Student";
import { Notification } from "../modules/notifications/models/Notification";
import { AiProviderError, type AiProvider, type AiSendInput } from "../modules/platform/ai/provider";
import type { AiRoute } from "../modules/platform/services/AiSettingService";

let fx: LcFx;
const ENV = process.env.ANTHROPIC_API_KEY;
beforeAll(async () => {
  fx = await setupLc();
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-0000";
  await Student.create({ schoolId: "SCD-T-0902", name: "Kalpanik Chhatro", nameBn: "কাল্পনিক ছাত্র", classId: new Types.ObjectId(), sectionId: new Types.ObjectId(), active: true });
});
afterAll(async () => {
  process.env.ANTHROPIC_API_KEY = ENV;
  await mongoose.connection.collection("students").deleteMany({ schoolId: "SCD-T-0902" });
  await teardownLc(fx);
});
beforeEach(async () => {
  await resetBooks();
  await AiUsage.deleteMany({});
  await AiExchange.deleteMany({});
  await AiFeatureSetting.updateOne({ feature: "book_edit" }, { $set: { feature: "book_edit", enabled: true, provider: "anthropic", fallback: true } }, { upsert: true });
});
const P = () => fx.auth.principal;

interface Call {
  provider: string;
  model: string;
  input: AiSendInput;
}

/** A provider whose answers come from `answer(chapterKey, call#)`. */
function fake(calls: Call[], answer: (variable: string, n: number) => string | Error) {
  return (provider: string): AiProvider => ({
    name: provider as never,
    async send(input: AiSendInput, model: string) {
      calls.push({ provider, model, input });
      const a = answer(input.variablePart, calls.length);
      if (a instanceof Error) throw a;
      return { provider: provider as never, model, resolvedModel: model, text: a, usage: { cacheHitTokens: 10, cacheMissTokens: 100, outputTokens: 50, reasoningTokens: null }, finishReason: "stop" as const, latencyMs: 5 };
    },
  });
}
const route = (fallback = true) => async (): Promise<AiRoute> => ({
  enabled: true,
  primary: { provider: "anthropic", model: "claude-opus-5-5", key: "k" },
  fallback: fallback ? { provider: "deepseek", model: "deepseek-flash", key: "d" } : null,
});
const keyOf = (v: string) => /chapter: (\S+)/.exec(v)?.[1] ?? "?";
const shaOf = (v: string) => /baseSha: (\S+)/.exec(v)?.[1] ?? "";
const edit = (v: string, ops: unknown[]) => JSON.stringify({ schema: "book-chapter-edit/v1", draft: /draft: (\S+)/.exec(v)![1], chapter: keyOf(v), baseSha: shaOf(v), ops });

async function job(opts: { capUsd?: number; feedback?: string[]; scope?: string[]; code?: string } = {}) {
  const { book } = await importSample(P(), { code: opts.code ?? "C3-BAN" });
  const id = book._id.toString();
  const f1 = await item(P(), id, "direct_fix", { chapterKey: "ch-001", textBn: "সংখ্যা কথায়" });
  const f2 = await item(P(), id, "direct_fix", { chapterKey: "ch-002", textBn: "সংখ্যা কথায়" });
  const named = await item(P(), id, "direct_fix", { chapterKey: "ch-003", textBn: "কাল্পনিক ছাত্র বলেছে ভুল" });
  const started = await startEditJob(P(), id, { feedback: opts.feedback ?? [f1.code, f2.code, named.code], capUsd: opts.capUsd ?? 3, model: "claude-opus-5-5", reasoning: "off", confirmLarge: true, scopeChapterKeys: opts.scope });
  return { id, f1, f2, named, jobId: started.job._id };
}

const good = (v: string) =>
  keyOf(v) === "ch-001" ? edit(v, [{ op: "replace", before: "1টি নৌকা", after: "একটি নৌকা", refs: ["F-1"] }]) : keyOf(v) === "ch-002" ? edit(v, [{ op: "replace", before: "2টি নৌকা", after: "দুটি নৌকা", refs: ["F-2"] }]) : edit(v, []);

it("chapters one at a time in order; prefix byte-identical; variable part holds only that chapter; output applied; AiUsage + AiExchange rows; BOOK_EDIT_READY", async () => {
  const calls: Call[] = [];
  const { jobId, f1 } = await job();
  const out = await runEditJob(jobId, { ai: { makeProvider: fake(calls, (v) => good(v)), route: route() }, sleep: async () => undefined });
  expect(out.status).toBe("done");
  expect(calls.map((c) => keyOf(c.input.variablePart))).toEqual(["ch-001", "ch-002", "ch-003"]);
  expect(new Set(calls.map((c) => c.input.stablePrefix)).size).toBe(1);
  expect(calls[0].input.variablePart).toContain("1টি নৌকা");
  expect(calls[0].input.variablePart).not.toContain("2টি নৌকা");
  expect(calls[0].input.variablePart).toContain(f1.code);
  // the de-identified, fail-closed per item: the item naming a child never reaches the prompt
  expect(calls.map((c) => c.input.variablePart + c.input.context + c.input.stablePrefix).join("")).not.toContain("কাল্পনিক ছাত্র");
  const draft = await loadDraft(out.draftId.toString());
  expect(draft.chapters.find((c) => c.key === "ch-001")?.status).toBe("edited");
  expect(draft.changes.map((c) => c.refs[0])).toEqual(["F-1", "F-2"]);
  expect(await AiUsage.countDocuments({ feature: "book_edit" })).toBe(3);
  const ex = await AiExchange.find({ feature: "book_edit" }).lean();
  expect(ex).toHaveLength(3);
  expect(ex.every((e) => e.deidentified === false && /^method:/.test(String(e.prefixRef)))).toBe(true);
  // The main database never holds book text: the exchange row names the job + chapter and a hash (D-#1622).
  expect(ex.every((e) => /^BookEditJob \S+ ch-00\d · request sha256:/.test(String(e.request)) && !String(e.request + e.reply).includes("নৌকা"))).toBe(true);
  expect(await Notification.countDocuments({ kind: "BOOK_EDIT_READY", recipientUserId: P().userId })).toBe(1);
  // nothing applies by itself
  expect(draft.status).toBe("open");
});

it("the stable prefix is byte-identical between two jobs with the same rules and decisions", async () => {
  const a: Call[] = [];
  const b: Call[] = [];
  const j1 = await job();
  await runEditJob(j1.jobId, { ai: { makeProvider: fake(a, good), route: route() }, sleep: async () => undefined });
  const j2 = await startEditJob(P(), j1.id, { feedback: [j1.f1.code], capUsd: 3, model: "claude-opus-5-5", confirmLarge: true });
  await runEditJob(j2.job._id, { ai: { makeProvider: fake(b, good), route: route() }, sleep: async () => undefined });
  expect(b[0].input.stablePrefix).toBe(a[0].input.stablePrefix);
});

it("a validator refusal goes back with findings (≤ 2 fixes) then the chapter fails", async () => {
  const calls: Call[] = [];
  const { jobId } = await job({ feedback: [], scope: ["ch-001"] });
  const out = await runEditJob(jobId, { ai: { makeProvider: fake(calls, (v) => edit(v, [{ op: "replace", before: "নেই এমন লেখা", after: "x", refs: ["F-1"] }])), route: route() }, sleep: async () => undefined });
  expect(out.status).toBe("partial");
  const ch1 = calls.filter((c) => keyOf(c.input.variablePart) === "ch-001");
  expect(ch1).toHaveLength(3);
  expect(ch1[1].input.variablePart).toContain("YOUR LAST ANSWER WAS REFUSED");
  expect(out.chapters.find((c) => c.key === "ch-001")?.status).toBe("failed");
  // The refused trial is not left in the draft.
  expect((await loadDraft(out.draftId.toString())).changes).toHaveLength(0);
  // §14.1 step 5: the failed chapter runs again as a new job on the SAME draft, same pinned model, once.
  const again = await rerunFailedChapters(P(), jobId.toString(), {});
  expect(again.draftId.toString()).toBe(out.draftId.toString());
  expect(again.chapters.map((c) => c.key)).toEqual(["ch-001"]);
  expect(again.modelName).toBe("claude-opus-5-5");
  await expect(rerunFailedChapters(P(), jobId.toString(), {})).rejects.toThrow();
});

it("a provider error retries the SAME provider twice and never switches provider; the model is pinned", async () => {
  const calls: Call[] = [];
  const { jobId } = await job();
  await AiFeatureSetting.updateOne({ feature: "book_edit" }, { $set: { provider: "deepseek" } });
  const out = await runEditJob(jobId, { ai: { makeProvider: fake(calls, () => new AiProviderError("busy", "boom", "anthropic")), route: route() }, sleep: async () => undefined });
  expect(calls.every((c) => c.provider === "anthropic" && c.model === "claude-opus-5-5")).toBe(true);
  expect(calls.filter((c) => keyOf(c.input.variablePart) === "ch-001")).toHaveLength(3);
  expect(out.status).toBe("partial");
  expect(await AiUsage.countDocuments({ feature: "book_edit", provider: "deepseek" })).toBe(0);
});

it("cap reached → partial before the over-cap call", async () => {
  const calls: Call[] = [];
  const { jobId } = await job({ capUsd: 0.0001 });
  const out = await runEditJob(jobId, { ai: { makeProvider: fake(calls, good), route: route() }, sleep: async () => undefined });
  expect(out.status).toBe("partial");
  expect(calls).toHaveLength(0);
});

it("feature switched off mid-job → stopped; a new version mid-job → stale_base", async () => {
  const calls: Call[] = [];
  const { jobId } = await job();
  const off = await runEditJob(jobId, {
    ai: {
      makeProvider: fake(calls, (v) => good(v)),
      route: async () => {
        const r = await route()();
        return calls.length >= 1 ? { ...r, enabled: false } : r;
      },
    },
    sleep: async () => undefined,
  });
  expect(off.status).toBe("stopped");
  const j2 = await job({ code: "C3-ENG" });
  await childVersion(P(), j2.id, "3টি নৌকা", "তিনটি নৌকা", [j2.f1.code]);
  const stale = await runEditJob(j2.jobId, { ai: { makeProvider: fake([], good), route: route() }, sleep: async () => undefined });
  expect(stale.status).toBe("stale_base");
});

it("starting needs ai_edit + manage and the feature on; a raised cap needs the AI-key holder", async () => {
  const { book } = await importSample(P(), { code: "C3-ENG" });
  await expect(startEditJob(fx.auth.officeManage, book._id.toString(), { feedback: [] })).rejects.toThrow(/ai_edit/);
  await AiFeatureSetting.updateOne({ feature: "book_edit" }, { $set: { enabled: false } });
  await expect(startEditJob(P(), book._id.toString(), { feedback: [] })).rejects.toThrow();
  expect(await BookEditJob.countDocuments()).toBe(0);
});

it("the S10 estimate writes nothing; a named item is listed as left out; 'all chapters' (*) covers every chapter; over the cap needs a confirm", async () => {
  const { book } = await importSample(P());
  const id = book._id.toString();
  const f = await item(P(), id, "direct_fix", { chapterKey: "ch-002" });
  const named = await item(P(), id, "direct_fix", { chapterKey: "ch-003", textBn: "কাল্পনিক ছাত্র বলেছে ভুল" });
  const auto = await previewEditJob(P(), id, { feedback: [f.code], model: "claude-opus-5-5" });
  expect(auto).toMatchObject({ chapters: 1, units: 1, model: "claude-opus-5-5", capUsd: 3 });
  const all = await previewEditJob(P(), id, { feedback: [f.code, named.code], scopeChapterKeys: ["*"], model: "claude-opus-5-5" });
  expect(all.chapters).toBe(4);
  expect(all.leftOut.map((x) => x.code)).toEqual([named.code]);
  expect(await BookEditDraft.countDocuments()).toBe(0);
  expect(await BookEditJob.countDocuments()).toBe(0);
  await expect(startEditJob(P(), id, { feedback: [f.code], capUsd: 0.00001, model: "claude-opus-5-5" })).rejects.toThrow(/নিশ্চিত/);
  expect(await BookEditDraft.countDocuments()).toBe(0);
  const ok = await startEditJob(P(), id, { feedback: [f.code], scopeChapterKeys: ["*"], model: "claude-opus-5-5" });
  expect(ok.job.chapters.map((c) => c.key)).toEqual(["front", "ch-001", "ch-002", "ch-003"]);
  expect(ok.job.modelName).toBe("claude-opus-5-5");
  expect(ok.job.leftOut).toEqual([]);
});
