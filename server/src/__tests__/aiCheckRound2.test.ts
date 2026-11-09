/**
 * AI round 2 (owner test 2026-11-09, D-#1175–#1179), on an in-memory MongoDB. Every name
 * and comment here is invented.
 *   • suggestions are cleaned: an addition written as a replacement inserts, overlapping
 *     quotes keep only the first, a no-op is dropped, a note (no quote) stays
 *   • hidden phones / numbers come back into a suggestion, in order
 *   • the router logs every call's de-identified request + reply (AiExchange), the long
 *     prompt parts once (AiPromptText); a log failure never breaks the call
 *   • the log: Principal-only read / export / delete (LOCKED), month + feature filters,
 *     manual delete audited; the saved choice lands on the log row
 *   • re-saving UNCHANGED text keeps an earlier CHECKED stamp
 *   • the assistant always answers in Bangla; the daily-cap message fits the feature
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { AiExchange, AiPromptText } from "../modules/platform/models/AiExchange";
import { AiUsage } from "../modules/platform/models/AiUsage";
import { AiFeatureSetting } from "../modules/platform/models/AiFeatureSetting";
import { Audit } from "../modules/platform/models/Audit";
import { StudentComment } from "../modules/comments/models/StudentComment";
import { aiSend, type AiLedger, type ProviderFactory } from "../modules/platform/ai/aiRouter";
import { deidentify, restoreNumbers } from "../modules/platform/ai/deidentify";
import type { AiSendInput } from "../modules/platform/ai/provider";
import type { AiRoute } from "../modules/platform/services/AiSettingService";
import { aiCheckStamp, cleanIssues, signCheckToken } from "../modules/platform/services/CommentCheckService";
import {
  aiExchangeDetail,
  aiExchangesExport,
  aiExchangesPage,
  deleteAiExchange,
  deleteAiExchanges,
  monthRange,
  noteCheckShown,
  previewOf,
} from "../modules/platform/services/AiExchangeService";
import { AiCapError } from "../modules/platform/services/AiUsageService";
import { ASSISTANT_INSTRUCTIONS } from "../modules/ai-assist/services/AiAssistService";
import { editComment, recordComment } from "../modules/comments/services/StudentCommentService";
import type { AuthPayload } from "../context";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await Promise.all([AiExchange.deleteMany({}), AiPromptText.deleteMany({}), AiUsage.deleteMany({}), AiFeatureSetting.deleteMany({}), Audit.deleteMany({}), StudentComment.deleteMany({})]);
});

const principal: AuthPayload = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" };
const office: AuthPayload = { userId: new Types.ObjectId().toString(), role: "OFFICE" };
const TEACHER = new Types.ObjectId().toString();

describe("suggestions are cleaned before the writer sees them (D-#1176)", () => {
  const text = { text: "আজ টিফিনের সময় [S] খাতা আনেননি। বাসায় একটু কথা বলবেন।" };

  test("an addition written as a replacement becomes an insertion", () => {
    const corrected = { text: "আসসালামু আলাইকুম। আজ টিফিনের সময় [S] খাতা আনেননি। বাসায় একটু কথা বলবেন। জাযাকুমুল্লাহু খাইরান।" };
    const out = cleanIssues([{ field: "text", type: "structure", quote: "বাসায় একটু কথা বলবেন।", suggestion: "জাযাকুমুল্লাহু খাইরান।" }], text, corrected);
    expect(out[0].suggestion).toBe("বাসায় একটু কথা বলবেন। জাযাকুমুল্লাহু খাইরান।");
  });

  test("an overlapping later issue is dropped; a no-op is dropped; a note stays", () => {
    const out = cleanIssues(
      [
        { field: "text", type: "structure", quote: "আজ টিফিনের সময় [S] খাতা আনেননি।", suggestion: "আসসালামু আলাইকুম। আজ টিফিনের সময় [S] খাতা আনেননি।" },
        { field: "text", type: "spelling", quote: "খাতা আনেননি", suggestion: "খাতা আনেন নি" },
        { field: "text", type: "standard", quote: "বাসায়", suggestion: "বাসায়" },
        { field: "text", type: "tone", quote: "", suggestion: "মন্তব্যটি উদ্বেগের — 'উদ্বেগ' বাছাই করুন" },
      ],
      text,
      {},
    );
    expect(out.map((i) => i.type)).toEqual(["structure", "tone"]);
  });
});

describe("hidden numbers come back (D-#1176)", () => {
  test("phones and long numbers, in order", () => {
    const d = deidentify("ফোন 01711-223344, রসিদ 12345678", { people: [] });
    expect(d.text).toBe("ফোন [PHONE], রসিদ [NUM]");
    expect(restoreNumbers("অনুগ্রহ করে [PHONE] নম্বরে জানাবেন ([NUM])", d.seq)).toBe("অনুগ্রহ করে 01711-223344 নম্বরে জানাবেন (12345678)");
  });
});

const input: AiSendInput = { stablePrefix: "INSTRUCTIONS + STANDARD v1", variablePart: '{"fields":{"text":"[S] আজ খাতা আনেননি"}}', maxOutputTokens: 800, reasoning: "off" };
const route = async (): Promise<AiRoute> => ({ enabled: true, primary: { provider: "deepseek", model: "deepseek-flash", key: "sk" }, fallback: null });
const okProvider: ProviderFactory = (provider) => ({
  name: provider,
  send: async (_i, model) => ({ provider, model, resolvedModel: "deepseek-v4-flash", text: '{"issues":[]}', usage: { cacheHitTokens: 0, cacheMissTokens: 100, outputTokens: 20, reasoningTokens: 0 }, finishReason: "stop" as const, latencyMs: 40 }),
});

describe("the request / reply log (D-#1179)", () => {
  test("aiSend logs the de-identified request and the reply; the prefix is stored once", async () => {
    await aiSend("comment_check", input, { userId: TEACHER, role: "TEACHER", refType: "StudentComment", refId: "s1", policyHash: "comment_standard@v1#abc" }, { route, makeProvider: okProvider });
    await aiSend("comment_check", input, { userId: TEACHER, role: "TEACHER", refType: "StudentComment", refId: "s1", policyHash: "comment_standard@v1#abc" }, { route, makeProvider: okProvider });
    const rows = await AiExchange.find({}).lean();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ feature: "comment_check", ok: true, request: input.variablePart, reply: '{"issues":[]}', modelName: "deepseek-v4-flash", policyHash: "comment_standard@v1#abc" });
    expect(await AiPromptText.countDocuments({})).toBe(1);
  });

  test("a failing log never breaks the call", async () => {
    const ledger: AiLedger = { assertWithinCaps: async () => undefined, record: async () => undefined, afterCall: async () => undefined, exchange: async () => { throw new Error("disk full"); } };
    const out = await aiSend("assistant", input, { userId: TEACHER }, { route, makeProvider: okProvider, ledger });
    expect(out.result.text).toBe('{"issues":[]}');
  });

  test("Principal reads / filters / exports; nobody else", async () => {
    await aiSend("comment_check", input, { userId: TEACHER, role: "TEACHER" }, { route, makeProvider: okProvider });
    await aiSend("assistant", { ...input, variablePart: "এই অধ্যায় কীভাবে শুরু করব?", context: "CHAPTER 3 plan" }, { userId: TEACHER, role: "TEACHER", sessionId: "x1" }, { route, makeProvider: okProvider });
    const month = monthRange(new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 7));
    expect(month.to.getTime()).toBeGreaterThan(month.from.getTime());
    const all = await aiExchangesPage(principal, {});
    expect(all.total).toBe(2);
    const checks = await aiExchangesPage(principal, { feature: "comment_check" });
    expect(checks.rows.map((r) => r.preview)).toEqual(["[S] আজ খাতা আনেননি"]);
    const asst = await aiExchangesPage(principal, { feature: "assistant" });
    const detail = await aiExchangeDetail(principal, asst.rows[0].id);
    expect(detail.context).toBe("CHAPTER 3 plan");
    expect(detail.prefix).toBe(input.stablePrefix);
    expect(await aiExchangesExport(principal, {})).toHaveLength(2);
    await expect(aiExchangesPage(office, {})).rejects.toThrow("অনুমতি নেই");
    await expect(deleteAiExchanges(office, { feature: "assistant" })).rejects.toThrow("অনুমতি নেই");
  });

  test("manual delete — one row or a filter (one filter required) — audited", async () => {
    await aiSend("comment_check", input, { userId: TEACHER }, { route, makeProvider: okProvider });
    await aiSend("comment_check", input, { userId: TEACHER }, { route, makeProvider: okProvider });
    await aiSend("assistant", input, { userId: TEACHER, sessionId: "x" }, { route, makeProvider: okProvider });
    const one = (await aiExchangesPage(principal, { feature: "assistant" })).rows[0];
    expect(await deleteAiExchange(principal, one.id)).toBe(true);
    await expect(deleteAiExchanges(principal, {})).rejects.toThrow("বাছাই করুন");
    expect(await deleteAiExchanges(principal, { feature: "comment_check" })).toBe(2);
    expect(await AiExchange.countDocuments({})).toBe(0);
    expect(await Audit.countDocuments({ eventKind: "AI_EXCHANGES_DELETED" })).toBe(2);
  });

  test("the writer's choice lands on the log row when the checked comment is saved", async () => {
    await AiFeatureSetting.create({ feature: "comment_check", enabled: true, provider: "deepseek" });
    const out = await aiSend("comment_check", input, { userId: TEACHER }, { route, makeProvider: okProvider });
    await noteCheckShown(out.callId, 3, { tone: 1, honorific: 2 });
    const sid = new Types.ObjectId().toString();
    const token = signCheckToken({ sid, kind: "DAILY", policyHash: "p", model: "m", issuesFound: 3, at: Date.now(), xid: out.callId });
    const stamp = await aiCheckStamp({ token, issuesAccepted: 2, teacherOverrode: false }, sid, "DAILY");
    expect(stamp?.status).toBe("CHECKED");
    const row = await AiExchange.findOne({ callId: out.callId }).lean();
    expect(row?.outcome).toMatchObject({ issuesShown: 3, saved: true, issuesAccepted: 2, teacherOverrode: false });
  });

  test("the preview of a check is its comment text", () => {
    expect(previewOf("comment_check", '{"fields":{"weakness":"বানান ভুল","guardianAction":"বাসায় পড়াবেন"}}')).toBe("বানান ভুল · বাসায় পড়াবেন");
    expect(previewOf("assistant", "  কী   পড়াব? ")).toBe("কী পড়াব?");
  });
});

describe("re-saving unchanged text keeps the CHECKED stamp (D-#1175)", () => {
  test("daily comment", async () => {
    const studentId = new Types.ObjectId().toString();
    const sectionId = new Types.ObjectId();
    const doc = await StudentComment.create({
      studentId: new Types.ObjectId(studentId),
      sectionId,
      authorUserId: new Types.ObjectId(TEACHER),
      type: "GENERAL",
      sentiment: "CONCERN",
      text: "উনি আজ খাতা আনেননি।",
      aiCheck: { status: "CHECKED", policyHash: "p", model: "m", issuesFound: 1, issuesAccepted: 1, teacherOverrode: false, checkedAt: new Date() },
    });
    void recordComment;
    const kept = await editComment({ commentId: doc.id, actorId: TEACHER, sentiment: "POSITIVE", text: "উনি আজ খাতা আনেননি।", aiCheck: { status: "NOT_CHECKED", reason: "SKIPPED" } });
    expect(kept).toBeTruthy();
    expect((await StudentComment.findById(doc.id).lean())?.aiCheck?.status).toBe("CHECKED");
    await editComment({ commentId: doc.id, actorId: TEACHER, text: "উনি আজ খাতা আনেননি, কাল আনবেন।", aiCheck: { status: "NOT_CHECKED", reason: "SKIPPED" } });
    expect((await StudentComment.findById(doc.id).lean())?.aiCheck?.status).toBe("NOT_CHECKED");
  });
});

describe("assistant language and cap messages (D-#1178)", () => {
  test("the assistant always answers in Bangla", () => {
    expect(ASSISTANT_INSTRUCTIONS).toContain("ALWAYS answer in Bangla");
    expect(ASSISTANT_INSTRUCTIONS).not.toContain("unless the teacher writes in English");
  });

  test("the daily-cap message fits the feature", async () => {
    await AiFeatureSetting.create({ feature: "assistant", enabled: true, provider: "deepseek", dailyPerUser: 1 });
    await aiSend("assistant", input, { userId: TEACHER, sessionId: "s" }, { route, makeProvider: okProvider });
    const err = await aiSend("assistant", input, { userId: TEACHER, sessionId: "s" }, { route, makeProvider: okProvider }).catch((e) => e);
    expect(err).toBeInstanceOf(AiCapError);
    expect((err as Error).message).toContain("কাল আবার পারবেন");
    expect((err as Error).message).not.toContain("যাচাই ছাড়াই");
  });
});
