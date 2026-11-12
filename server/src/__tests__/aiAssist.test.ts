/**
 * AI-6 teacher assistant (D-#1096, D-#1104), on an in-memory MongoDB; the AI call is a stub.
 *   • topics come from current session plans; a conversation is about one chapter
 *   • the prompt: instructions + assistant rules (stable) → the chapter's plans (picked session
 *     first) → earlier turns → the question; questions and history de-identified; the answer
 *     comes back with names restored and both turns are stored
 *   • no rules on / a cap / the AI down → a Bangla AiAssistError
 *   • a teacher sees only their own conversations; the Principal reads every one
 * Every name here is invented.
 */
const mockSend = jest.fn();
jest.mock("../modules/platform/ai/aiRouter", () => {
  const actual = jest.requireActual("../modules/platform/ai/aiRouter");
  return { ...actual, aiSend: (...a: unknown[]) => mockSend(...a) };
});

import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Student } from "../modules/foundation/models/Student";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { AiAssistMessage } from "../modules/ai-assist/models/AiAssistMessage";
import { AiAssistSession } from "../modules/ai-assist/models/AiAssistSession";
import { activateAiPolicyVersion, saveAiPolicyVersion } from "../modules/platform/services/AiPolicyService";
import { AiCapError } from "../modules/platform/services/AiUsageService";
import {
  AiAssistError,
  allAssistSessionsPage,
  askAssistant,
  assistantTopics,
  assistMessagesPage,
  ASSISTANT_INSTRUCTIONS,
  myAssistSessionsPage,
  startAssistSession,
} from "../modules/ai-assist/services/AiAssistService";
import type { AuthPayload } from "../context";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const principal: AuthPayload = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" };
const teacher: AuthPayload = { userId: new Types.ObjectId().toString(), role: "TEACHER" };
const teacher2: AuthPayload = { userId: new Types.ObjectId().toString(), role: "TEACHER" };
const office: AuthPayload = { userId: new Types.ObjectId().toString(), role: "OFFICE" };
const RULES = "## সহকারীর নিয়ম\n\n- পাঠ পরিকল্পনা থেকে উত্তর দিন।";
const reply = (text: string) => ({
  result: { provider: "deepseek", model: "deepseek-flash", resolvedModel: "deepseek-flash", text, usage: { cacheHitTokens: 0, cacheMissTokens: 1, outputTokens: 1, reasoningTokens: 0 }, finishReason: "stop", latencyMs: 5 },
  attempts: [],
  callId: "c",
});

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const c = await Class.create({ level: 3, nameBn: "তৃতীয় শ্রেণি", academicYearId: new Types.ObjectId() });
  const s = await Section.create({ classId: c._id, code: "B", nameBn: "বালক", active: true });
  await Student.create({ schoolId: "0101", name: "Tahsin Karim", nameBn: "তাহসিন করিম", classId: c._id, sectionId: s._id });
  const plan = (n: number, title: string, md: string) => ({
    _id: new Types.ObjectId(),
    docType: "session_plan",
    subject: "BAN",
    classLevel: 3,
    address: { anchorWord: "SP", number: "4", title: "আমাদের গ্রাম" },
    current: true,
    retiredAt: null,
    importedAt: new Date(),
    envelopeJson: { payload: { session_plan: { period_index: n, period_of: 2, session_title: title } } },
    renderedMarkdown: md,
  });
  await ContentArtifact.collection.insertMany([plan(1, "পাঠ পরিচিতি", "SESSION ONE TEXT"), plan(2, "শব্দার্থ", "SESSION TWO TEXT")]);
  await ContentArtifact.collection.insertOne({
    _id: new Types.ObjectId(), docType: "chapter_plan", subject: "BAN", classLevel: 3, address: { anchorWord: "CP", number: "4" }, current: true, retiredAt: null, importedAt: new Date(), renderedMarkdown: "CHAPTER PLAN TEXT",
  });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(() => mockSend.mockReset());

test("topics: class level × subject with chapters and sessions from the current plans", async () => {
  const topics = await assistantTopics(teacher);
  expect(topics).toEqual([{ classLevel: 3, subject: "BAN", chapters: [{ chapter: "4", title: "আমাদের গ্রাম", sessions: [{ sessionIndex: 1, titleBn: "পাঠ পরিচিতি" }, { sessionIndex: 2, titleBn: "শব্দার্থ" }] }] }]);
});

test("no rules on → a Bangla refusal before any AI call", async () => {
  const s = await startAssistSession(teacher, { classLevel: 3, subject: "BAN", chapter: "4" });
  await expect(askAssistant(teacher, s.id, "প্রশ্ন")).rejects.toThrow("নিয়ম এখনো চালু হয়নি");
  expect(mockSend).not.toHaveBeenCalled();
});

describe("with the rules on", () => {
  beforeAll(async () => {
    await activateAiPolicyVersion(principal, (await saveAiPolicyVersion(principal, { key: "assistant_rules", body: RULES })).id);
  });

  test("grounded, de-identified prompt; history on the second turn; names restored; turns stored", async () => {
    const s = await startAssistSession(teacher, { classLevel: 3, subject: "BAN", chapter: "4", sessionIndex: 2 });
    expect(s.title).toBe("C3 · BAN · অধ্যায় 4 · সেশন 2");

    mockSend.mockResolvedValueOnce(reply("[S1]-কে আলাদা করে শব্দার্থ পড়ান।"));
    const first = await askAssistant(teacher, s.id, "তাহসিন শব্দার্থ পারে না, কী করব?");
    const [feature, input, ctx] = mockSend.mock.calls[0];
    expect(feature).toBe("assistant");
    expect(input.stablePrefix).toBe(ASSISTANT_INSTRUCTIONS + RULES);
    expect(input.context.indexOf("SESSION TWO TEXT")).toBeLessThan(input.context.indexOf("SESSION ONE TEXT"));
    expect(input.context).toContain("CHAPTER PLAN TEXT");
    expect(input.variablePart).toBe("[S1] শব্দার্থ পারে না, কী করব?");
    expect(input).toMatchObject({ maxOutputTokens: 1000, reasoning: "low", history: [] });
    expect(ctx).toMatchObject({ userId: teacher.userId, refType: "AiAssistSession", sessionId: s.id });
    expect(ctx.policyHash).toMatch(/^assistant_rules@v1#/);
    expect(first.map((m) => [m.role, m.text])).toEqual([
      ["user", "তাহসিন শব্দার্থ পারে না, কী করব?"],
      ["assistant", "তাহসিন-কে আলাদা করে শব্দার্থ পড়ান।"],
    ]);

    mockSend.mockResolvedValueOnce(reply("হ্যাঁ।"));
    await askAssistant(teacher, s.id, "আরও কিছু?");
    const second = mockSend.mock.calls[1][1];
    expect(second.history.map((h: { role: string; text: string }) => [h.role, h.text])).toEqual([
      ["user", "[S1] শব্দার্থ পারে না, কী করব?"],
      ["assistant", "[S1]-কে আলাদা করে শব্দার্থ পড়ান।"],
    ]);
    expect((await AiAssistSession.findById(s.id).lean())!.turns).toBe(2);
    expect(await AiAssistMessage.countDocuments({ sessionId: s.id })).toBe(4);
  });

  test("a child on a NON-current-year section is still masked (privacy: the scope over-includes)", async () => {
    const cur = await AcademicYear.create({ label: "2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), current: true });
    try {
      // this class belongs to a year that is NOT the current one
      const c = await Class.create({ level: 3, nameBn: "তৃতীয় শ্রেণি (পরের বছর)", academicYearId: new Types.ObjectId() });
      expect(String(c.academicYearId)).not.toBe(String(cur._id));
      const sec = await Section.create({ classId: c._id, code: "G", nameBn: "বালিকা", active: true });
      await Student.create({ schoolId: "0102", name: "Nusrat Jahan", nameBn: "নুসরাত জাহান", classId: c._id, sectionId: sec._id });
      const s = await startAssistSession(teacher, { classLevel: 3, subject: "BAN", chapter: "4" });
      mockSend.mockResolvedValueOnce(reply("ঠিক আছে।"));
      await askAssistant(teacher, s.id, "নুসরাত শব্দার্থ পারে না");
      const sent = mockSend.mock.calls[0][1].variablePart as string;
      expect(sent).not.toContain("নুসরাত");
      expect(sent).toMatch(/\[S\d+\]/);
    } finally {
      await AcademicYear.deleteMany({});
    }
  });

  test("a cap or the AI failing → a Bangla AiAssistError, nothing stored", async () => {
    const s = await startAssistSession(teacher, { classLevel: 3, subject: "BAN" });
    mockSend.mockRejectedValueOnce(new AiCapError("এই আলাপে ৪০টি প্রশ্নের সীমা শেষ — নতুন আলাপ শুরু করুন।", "session"));
    await expect(askAssistant(teacher, s.id, "প্রশ্ন")).rejects.toThrow("সীমা শেষ");
    expect(await AiAssistMessage.countDocuments({ sessionId: s.id })).toBe(0);
    await expect(askAssistant(teacher, s.id, "?")).rejects.toBeInstanceOf(AiAssistError);
  });

  test("own conversations only; the Principal reads every one; nobody else lists all", async () => {
    const mine = await myAssistSessionsPage(teacher, {});
    expect(mine.total).toBeGreaterThanOrEqual(2);
    expect((await myAssistSessionsPage(teacher2, {})).total).toBe(0);
    const s = mine.rows[mine.rows.length - 1];
    await expect(assistMessagesPage(teacher2, s.id, {})).rejects.toThrow("আপনার নয়");
    await expect(askAssistant(teacher2, s.id, "প্রশ্ন")).rejects.toThrow("আপনার নয়");
    await expect(askAssistant(principal, s.id, "প্রশ্ন")).rejects.toThrow("আপনার নয়");
    expect((await assistMessagesPage(principal, s.id, {})).session.teacherId).toBe(teacher.userId);
    expect((await allAssistSessionsPage(principal, { teacherId: teacher.userId })).total).toBe(mine.total);
    await expect(allAssistSessionsPage(office, {})).rejects.toThrow("অনুমতি নেই");
    await expect(allAssistSessionsPage(teacher, {})).rejects.toThrow("অনুমতি নেই");
  });
});
