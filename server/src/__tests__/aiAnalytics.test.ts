/**
 * AI-7 analytics (D-#1140), on an in-memory MongoDB.
 *   • spend / calls / caps / errors / fallbacks / cache-hit rate / cost per check & turn
 *   • by Dhaka day, person (system rows apart), feature and model; the range is Dhaka days
 *   • the budget is the current Dhaka month with a straight-line projection
 *   • comment quality per writer from the stamps (daily + class test), incl. issue types
 *   • Principal only
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { AiUsage } from "../modules/platform/models/AiUsage";
import { User } from "../modules/foundation/models/User";
import { StudentComment } from "../modules/comments/models/StudentComment";
import { ClassTestResult } from "../modules/trackers/models/ClassTestResult";
import { aiUsageReport } from "../modules/platform/services/AiAnalyticsService";
import type { AuthPayload } from "../context";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const principal: AuthPayload = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" };
let rina = "";
let karim = "";
// "Now" = 10 Nov 2026, 18:00 Dhaka (12:00 UTC): 9.75 days into a 30-day month.
const NOW = new Date("2026-11-10T12:00:00Z");

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  rina = (await User.create({ name: "Rina", role: "TEACHER", passwordHash: "x", active: true, phone: "01700000101" })).id;
  karim = (await User.create({ name: "Karim", role: "TEACHER", passwordHash: "x", active: true, phone: "01700000102" })).id;
  const row = (o: Record<string, unknown>) => ({ branch: "sylhet", callId: new Types.ObjectId().toString(), attempt: 1, provider: "deepseek", modelName: "deepseek-flash", cacheHitTokens: 0, cacheMissTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0, outcome: "ok", ...o });
  await AiUsage.insertMany([
    // 9 Nov Dhaka (8 Nov 20:00 UTC = 9 Nov 02:00 Dhaka)
    row({ at: new Date("2026-11-08T20:00:00Z"), userId: rina, feature: "comment_check", costUsd: 0.001, cacheHitTokens: 900, cacheMissTokens: 100 }),
    row({ at: new Date("2026-11-08T21:00:00Z"), userId: rina, feature: "comment_check", costUsd: 0.003, cacheHitTokens: 700, cacheMissTokens: 300 }),
    row({ at: new Date("2026-11-09T05:00:00Z"), userId: karim, feature: "assistant", costUsd: 0.004, cacheHitTokens: 0, cacheMissTokens: 1000 }),
    // a fallback call: error then fallback (one call)
    row({ at: new Date("2026-11-09T06:00:00Z"), userId: karim, feature: "assistant", outcome: "error", errorKind: "busy" }),
    row({ at: new Date("2026-11-09T06:00:01Z"), userId: karim, feature: "assistant", attempt: 2, outcome: "fallback", provider: "gemini", modelName: "gemini-flash-latest", costUsd: 0.006 }),
    row({ at: new Date("2026-11-09T07:00:00Z"), userId: karim, feature: "assistant", outcome: "capped" }),
    // a scheduler call, no person
    row({ at: new Date("2026-11-09T08:00:00Z"), feature: "monthly_comment", provider: "gemini", modelName: "gemini-flash-latest", costUsd: 0.01 }),
    // last month: outside the range AND outside the month budget
    row({ at: new Date("2026-10-20T08:00:00Z"), userId: rina, feature: "comment_check", costUsd: 5 }),
  ]);
  const sid = new Types.ObjectId();
  const stamp = (o: Record<string, unknown>) => ({ status: "CHECKED", policyHash: "p", model: "deepseek-flash", checkedAt: new Date(), ...o });
  await StudentComment.collection.insertMany([
    { studentId: sid, sectionId: sid, authorUserId: new Types.ObjectId(rina), type: "GENERAL", sentiment: "CONCERN", text: "a", attachmentIds: [], deliveryChannels: [], createdAt: new Date("2026-11-09T04:00:00Z"), aiCheck: stamp({ issuesFound: 3, issuesAccepted: 2, teacherOverrode: false, issueTypes: { tone: 2, punctuation: 1 } }) },
    { studentId: sid, sectionId: sid, authorUserId: new Types.ObjectId(rina), type: "GENERAL", sentiment: "CONCERN", text: "b", attachmentIds: [], deliveryChannels: [], createdAt: new Date("2026-11-09T05:00:00Z"), aiCheck: stamp({ issuesFound: 1, issuesAccepted: 0, teacherOverrode: true, issueTypes: { tone: 1 } }) },
    { studentId: sid, sectionId: sid, authorUserId: new Types.ObjectId(rina), type: "GENERAL", sentiment: "CONCERN", text: "c", attachmentIds: [], deliveryChannels: [], createdAt: new Date("2026-11-09T06:00:00Z"), aiCheck: { status: "NOT_CHECKED", reason: "SKIPPED" } },
    { studentId: sid, sectionId: sid, authorUserId: new Types.ObjectId(karim), type: "GENERAL", sentiment: "CONCERN", text: "d", attachmentIds: [], deliveryChannels: [], createdAt: new Date("2026-11-09T06:00:00Z") },
  ]);
  await ClassTestResult.collection.insertOne({
    testId: new Types.ObjectId(), studentId: sid, status: "PRESENT", marks: 10, enteredBy: new Types.ObjectId(karim), updatedAt: new Date("2026-11-09T09:00:00Z"),
    aiCheck: stamp({ issuesFound: 0, issuesAccepted: 0, teacherOverrode: false }),
  });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test("totals, buckets, budget and quality for a Dhaka range", async () => {
  const r = await aiUsageReport(principal, "2026-11-09", "2026-11-09", NOW);
  expect(r.totals).toMatchObject({ calls: 5, capped: 1, errors: 1, fallbacks: 1, checked: 3, notChecked: 1 });
  expect(r.totals.usd).toBeCloseTo(0.024, 6);
  expect(r.totals.cacheHitRate).toBe(0.53);
  expect(r.totals.avgCostPerCheckUsd).toBe(0.002);
  expect(r.totals.avgCostPerTurnUsd).toBe(0.005);

  expect(r.byDay.map((d) => d.key)).toEqual(["2026-11-09"]);
  // A call that fell back is ONE call (attempt 1); Karim and the scheduler tie on spend.
  expect(r.byPerson.map((p) => [p.label, p.calls]).sort()).toEqual([
    ["Karim", 2],
    ["Rina", 2],
    ["সিস্টেম (নির্ধারিত কাজ)", 1],
  ]);
  expect(r.byPerson[r.byPerson.length - 1].label).toBe("Rina");
  expect(r.byFeature.find((f) => f.key === "monthly_comment")!.label).toBe("মাসিক মন্তব্য");
  expect(r.byModel.map((m) => m.key).sort()).toEqual(["deepseek/deepseek-flash", "gemini/gemini-flash-latest"]);

  const cc = r.budget.find((b) => b.scope === "comment_check")!;
  expect(cc).toMatchObject({ capUsd: 3, spentUsd: 0.004 });
  expect(cc.projectedUsd).toBeCloseTo((0.004 / 9.75) * 30, 5);
  expect(r.budget.find((b) => b.scope === "global")!.spentUsd).toBeCloseTo(0.014, 6);

  const rq = r.quality.find((q) => q.name === "Rina")!;
  expect(rq).toMatchObject({ checks: 2, issuesFound: 4, issuesAccepted: 2, overrode: 1, notChecked: 1, acceptanceRate: 0.5, overrideRate: 0.5, issueTypes: { tone: 3, punctuation: 1 } });
  const kq = r.quality.find((q) => q.name === "Karim")!;
  expect(kq).toMatchObject({ checks: 1, issuesFound: 0, acceptanceRate: null, overrideRate: null, notChecked: 0 });
});

test("a wider range takes last month's spend; the budget still shows only this month", async () => {
  const r = await aiUsageReport(principal, "2026-10-01", "2026-11-10", NOW);
  expect(r.totals.usd).toBeCloseTo(5.024, 6);
  expect(r.budget.find((b) => b.scope === "comment_check")!.spentUsd).toBe(0.004);
});

test("Principal only; bad ranges refused", async () => {
  await expect(aiUsageReport({ userId: rina, role: "TEACHER" }, "2026-11-09", "2026-11-09", NOW)).rejects.toThrow("অনুমতি নেই");
  await expect(aiUsageReport({ userId: karim, role: "OFFICE" }, "2026-11-09", "2026-11-09", NOW)).rejects.toThrow("অনুমতি নেই");
  await expect(aiUsageReport(principal, "2026-11-10", "2026-11-01", NOW)).rejects.toThrow("সঠিক নয়");
  await expect(aiUsageReport(principal, "9-11-2026", "2026-11-01", NOW)).rejects.toThrow("সঠিক নয়");
});
