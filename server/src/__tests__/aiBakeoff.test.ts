/**
 * AI-8 bake-off (D-#1098), on an in-memory MongoDB with stub providers.
 *   • the sample mixes daily and class-test comments, spread across writers
 *   • both providers get the live checker's prompt; the tally counts issues, cost, errors
 *   • every call is metered as comment_check_bakeoff (not a capped feature)
 *   • the side-by-side holds de-identified text only — no child's name
 * Every name here is invented.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Student } from "../modules/foundation/models/Student";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { StudentComment } from "../modules/comments/models/StudentComment";
import { ClassTest } from "../modules/trackers/models/ClassTest";
import { ClassTestResult } from "../modules/trackers/models/ClassTestResult";
import { AiUsage } from "../modules/platform/models/AiUsage";
import { activateAiPolicyVersion, saveAiPolicyVersion } from "../modules/platform/services/AiPolicyService";
import { runBakeoff, sampleBakeoffItems, BAKEOFF_FEATURE } from "../modules/platform/services/AiBakeoffService";
import { AiProviderError } from "../modules/platform/ai/provider";
import type { ProviderFactory } from "../modules/platform/ai/aiRouter";
import type { AuthPayload } from "../context";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const principal: AuthPayload = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" };
const ENV = { d: process.env.DEEPSEEK_API_KEY, g: process.env.GEMINI_API_KEY };

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  process.env.DEEPSEEK_API_KEY = "sk-test-deepseek-000000000";
  process.env.GEMINI_API_KEY = "gemini-test-key-000000000";

  const c = await Class.create({ level: 3, nameBn: "তৃতীয় শ্রেণি", academicYearId: new Types.ObjectId() });
  const s = await Section.create({ classId: c._id, code: "B", nameBn: "বালক" });
  const child = await Student.create({ schoolId: "0101", name: "Tahsin Karim", nameBn: "তাহসিন করিম", classId: c._id, sectionId: s._id });
  const writers = [new Types.ObjectId(), new Types.ObjectId()];
  for (let i = 0; i < 6; i++) {
    await StudentComment.create({ studentId: child._id, sectionId: s._id, authorUserId: writers[i % 2], type: "GENERAL", sentiment: "CONCERN", text: `তাহসিন আজ বই আনে নাই ${i}` });
  }
  // Raw insert: only the fields the bake-off reads (+ the unique ctId).
  const testId = new Types.ObjectId();
  await ClassTest.collection.insertOne({
    _id: testId,
    ctId: "CT-C3-BAN-0001", academicYearId: new Types.ObjectId(), classLevel: 3, sectionId: s._id, subject: "BAN", testNumber: 1, totalMarks: 20, passMark: 8,
    deadlineDays: 3, requestedBy: writers[0], teacherId: writers[0], status: "PRINTED", examDate: new Date(), dueDateKey: "2026-11-08",
  });
  const test = { _id: testId };
  await ClassTestResult.create({ testId: test._id, studentId: child._id, status: "PRESENT", enteredBy: writers[0], marks: 18, weakness: "তাহসিন বানানে ভুল করে" });

  await activateAiPolicyVersion(principal, (await saveAiPolicyVersion(principal, { key: "comment_standard", body: "## নিয়ম\n\n- দাঁড়ি দিন।" })).id);
  await activateAiPolicyVersion(principal, (await saveAiPolicyVersion(principal, { key: "ct_comment_standard", body: "## ক্লাস টেস্ট\n\n- নম্বরের সাথে মিল।" })).id);
});
afterAll(async () => {
  process.env.DEEPSEEK_API_KEY = ENV.d;
  process.env.GEMINI_API_KEY = ENV.g;
  await mongoose.disconnect();
  await mongo.stop();
});

test("sample, run both, tally, meter, and keep the side-by-side free of names", async () => {
  const items = await sampleBakeoffItems(6, 2);
  expect(items.filter((i) => i.kind === "DAILY")).toHaveLength(3);
  expect(items.filter((i) => i.kind === "CT")).toHaveLength(1);
  expect(items.find((i) => i.kind === "CT")!.input.markPct).toBe(90);

  const sent: string[] = [];
  const make: ProviderFactory = (provider) => ({
    name: provider,
    send: async (input, model) => {
      sent.push(input.variablePart);
      if (provider === "gemini" && sent.length === 2) throw new AiProviderError("busy", "busy", "gemini", 503);
      const json = provider === "deepseek"
        ? { issues: [{ field: "text", type: "honorific", quote: "[S] আনে নাই", suggestion: "[S] আনেননি" }, { field: "text", type: "punctuation", quote: "x", suggestion: "x।" }], corrected: { text: "[S] আনেননি।" } }
        : { issues: [{ field: "text", type: "honorific", quote: "[S] আনে নাই", suggestion: "[S] আনেননি" }], corrected: { text: "[S] আনেননি।" } };
      return { provider, model, resolvedModel: model, text: "", json, usage: { cacheHitTokens: 5000, cacheMissTokens: 500, outputTokens: 400, reasoningTokens: 0 }, finishReason: "stop" as const, latencyMs: provider === "deepseek" ? 900 : 1500 };
    },
  });
  const { summary, sideBySide } = await runBakeoff({ items, makeProvider: make });

  for (const v of sent) expect(v).not.toMatch(/তাহসিন|Tahsin/);
  const ds = summary.providers.find((p) => p.provider === "deepseek")!;
  const gm = summary.providers.find((p) => p.provider === "gemini")!;
  expect(ds).toMatchObject({ checked: 4, issues: 8, issuesPerCheck: 2, errors: {}, latencyP50Ms: 900 });
  expect(gm).toMatchObject({ checked: 3, issues: 3, errors: { busy: 1 } });
  expect(ds.issuesByType).toEqual({ honorific: 4, punctuation: 4 });
  expect(ds.costUsd).toBeGreaterThan(0);
  expect(ds.issuesPerDollar).toBeGreaterThan(0);

  expect(await AiUsage.countDocuments({ feature: BAKEOFF_FEATURE })).toBe(8);
  expect(await AiUsage.countDocuments({ feature: BAKEOFF_FEATURE, outcome: "error" })).toBe(1);
  expect(JSON.stringify(sideBySide)).not.toMatch(/তাহসিন|Tahsin/);
  expect(sideBySide[0].fields[0].text).toContain("[S]");
});

test("refuses to start without both keys", async () => {
  const d = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  await expect(runBakeoff({ items: [] })).rejects.toThrow("no key for deepseek");
  process.env.DEEPSEEK_API_KEY = d;
});
