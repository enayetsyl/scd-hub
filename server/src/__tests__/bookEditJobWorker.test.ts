/**
 * BL-5 — the AI worker and the book edit job (docs/prd-book-lifecycle.md §14.1, §19 bookEditJobWorker).
 * The worker opens BOTH connections (main + book plane); a chapter left `running` 20 minutes is queued
 * again; one job runs at a time per job (never claimed twice). A scripted fake provider answers.
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { setupLc, teardownLc, resetBooks, importSample, item, type LcFx } from "./bookLcFixtures";
import { bookConnection, disconnectBookDb, isBookDbReady } from "../bookDb";
import { disconnectDb } from "../db";
import { openWorkerPlanes } from "../workers/aiWorkerPlanes";
import { bookEditWorkerTick, startEditJob, STALE_MS } from "../modules/book-lifecycle/services/editJob";
import { BookEditJob } from "../modules/book-lifecycle/models/BookEditJob";
import { AiFeatureSetting } from "../modules/platform/models/AiFeatureSetting";
import type { AiProvider, AiSendInput } from "../modules/platform/ai/provider";
import type { AiRoute } from "../modules/platform/services/AiSettingService";

jest.setTimeout(120_000);

describe("openWorkerPlanes", () => {
  it("opens the main database AND the book plane (both live)", async () => {
    const a = await MongoMemoryServer.create();
    const b = await MongoMemoryServer.create();
    try {
      const out = await openWorkerPlanes({ main: a.getUri("main"), book: b.getUri("book") });
      expect(out.book).toBe(true);
      expect(mongoose.connection.readyState).toBe(1);
      expect(isBookDbReady()).toBe(true);
      expect(bookConnection.name).toBe("book");
    } finally {
      await disconnectBookDb();
      await disconnectDb();
      await a.stop();
      await b.stop();
    }
  });
});

describe("bookEditWorkerTick", () => {
  let fx: LcFx;
  const ENV = process.env.ANTHROPIC_API_KEY;
  beforeAll(async () => {
    fx = await setupLc();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-0000";
  });
  afterAll(async () => {
    process.env.ANTHROPIC_API_KEY = ENV;
    await teardownLc(fx);
  });
  beforeEach(async () => {
    await resetBooks();
    await BookEditJob.deleteMany({});
    await AiFeatureSetting.updateOne({ feature: "book_edit" }, { $set: { feature: "book_edit", enabled: true, provider: "anthropic" } }, { upsert: true });
  });

  const route = async (): Promise<AiRoute> => ({ enabled: true, primary: { provider: "anthropic", model: "claude-opus-5-5", key: "k" }, fallback: null });
  const keyOf = (v: string) => /chapter: (\S+)/.exec(v)?.[1] ?? "?";

  /** A provider that records how many calls are in flight at once. */
  function tracking(log: { key: string; inFlight: number }[]) {
    let now = 0;
    return (): AiProvider => ({
      name: "anthropic",
      async send(input: AiSendInput, model: string) {
        now++;
        log.push({ key: keyOf(input.variablePart), inFlight: now });
        await new Promise((r) => setTimeout(r, 5));
        now--;
        const v = input.variablePart;
        const text = JSON.stringify({ schema: "book-chapter-edit/v1", draft: /draft: (\S+)/.exec(v)![1], chapter: keyOf(v), baseSha: /baseSha: (\S+)/.exec(v)![1], ops: [] });
        return { provider: "anthropic", model, resolvedModel: model, text, usage: { cacheHitTokens: 1, cacheMissTokens: 1, outputTokens: 1, reasoningTokens: null }, finishReason: "stop" as const, latencyMs: 1 };
      },
    });
  }

  async function queued(code: string) {
    const { book } = await importSample(fx.auth.principal, { code });
    const f = await item(fx.auth.principal, book._id.toString(), "direct_fix");
    return (await startEditJob(fx.auth.principal, book._id.toString(), { feedback: [f.code], scopeChapterKeys: ["ch-001", "ch-002", "ch-003"], model: "claude-opus-5-5", confirmLarge: true })).job;
  }

  it("a chapter left running 20 minutes is queued again, and the job then runs to its end", async () => {
    const j = await queued("C3-BAN");
    const old = new Date(Date.now() - STALE_MS - 60_000);
    await BookEditJob.updateOne({ _id: j._id }, { $set: { status: "running", heartbeatAt: old, "chapters.0.status": "running" } });
    // Not yet stale at "now − 19 minutes": untouched.
    expect(await bookEditWorkerTick({ now: () => new Date(old.getTime() + STALE_MS - 60_000) }, new Set(), 1, { wait: true })).toBe(0);
    expect((await BookEditJob.findById(j._id))!.status).toBe("running");
    const log: { key: string; inFlight: number }[] = [];
    const n = await bookEditWorkerTick({ ai: { makeProvider: tracking(log), route }, sleep: async () => undefined }, new Set(), 1);
    expect(n).toBe(1);
    const after = (await BookEditJob.findById(j._id))!;
    expect(after.status).toBe("done");
    expect(after.chapters.map((c) => c.status)).toEqual(["unchanged", "unchanged", "unchanged"]);
  });

  it("one job at a time per job: chapters strictly in order, never two calls at once; an in-flight job is not claimed twice", async () => {
    const j = await queued("C3-BAN");
    const busy = new Set([j._id.toString()]);
    expect(await bookEditWorkerTick({}, busy, 2)).toBe(0);
    const log: { key: string; inFlight: number }[] = [];
    await bookEditWorkerTick({ ai: { makeProvider: tracking(log), route }, sleep: async () => undefined }, new Set(), 2);
    expect(log.map((l) => l.key)).toEqual(["ch-001", "ch-002", "ch-003"]);
    expect(Math.max(...log.map((l) => l.inFlight))).toBe(1);
    expect(await BookEditJob.countDocuments({ _id: j._id, status: "done" })).toBe(1);
  });
});
