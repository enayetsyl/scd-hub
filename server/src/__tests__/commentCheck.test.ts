/**
 * AI-5 comment checker (D-#1095, D-#1099, D-#1100), on an in-memory MongoDB; the AI call
 * itself is a stub (the router + providers are tested in aiProviders / aiUsage).
 *   • the prompt is de-identified; the stable prefix is the instructions + the active standard,
 *     byte-identical across calls
 *   • suggestions come back with names restored; nothing is saved by the check
 *   • fail-open: feature off, no standard, a cap, the AI failing → NOT_CHECKED with a reason
 *   • the stamp: CHECKED only with a valid server token for THIS child; otherwise
 *     NOT_CHECKED (SKIPPED) while the checker is on; nothing while it is off
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
import { AiFeatureSetting } from "../modules/platform/models/AiFeatureSetting";
import { AiPolicy } from "../modules/platform/models/AiPolicy";
import { StudentComment } from "../modules/comments/models/StudentComment";
import { activateAiPolicyVersion, saveAiPolicyVersion } from "../modules/platform/services/AiPolicyService";
import { aiCheckStamp, checkComment, CHECKER_INSTRUCTIONS, commentCheckAvailability, readCheckToken } from "../modules/platform/services/CommentCheckService";
import { AiCapError } from "../modules/platform/services/AiUsageService";
import { AiProviderError } from "../modules/platform/ai/provider";
import { recordComment } from "../modules/comments/services/StudentCommentService";
import type { AuthPayload } from "../context";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const principal: AuthPayload = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" };
const teacher: AuthPayload = { userId: new Types.ObjectId().toString(), role: "TEACHER" };
let studentId = "";
let sectionId = "";
let otherStudent = "";
const DAILY_RULES = "## দৈনিক মন্তব্যের নিয়ম\n\n- সম্মানসূচক রূপ।\n- দাঁড়ি।";
const CT_RULES = "## ক্লাস টেস্টের মন্তব্যের নিয়ম\n\n- নম্বরের সাথে মিল।";

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const c = await Class.create({ level: 3, nameBn: "তৃতীয় শ্রেণি", academicYearId: new Types.ObjectId() });
  const s = await Section.create({ classId: c._id, code: "B", nameBn: "বালক" });
  sectionId = s._id.toString();
  studentId = (await Student.create({ schoolId: "0101", name: "Tahsin Karim", nameBn: "তাহসিন করিম", classId: c._id, sectionId: s._id })).id;
  otherStudent = (await Student.create({ schoolId: "0102", name: "Arif Hossain", nameBn: "আরিফ হোসেন", classId: c._id, sectionId: s._id })).id;
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  mockSend.mockReset();
  await Promise.all([AiFeatureSetting.deleteMany({}), AiPolicy.deleteMany({}), StudentComment.deleteMany({})]);
});

async function turnOn(withCt = true): Promise<void> {
  await AiFeatureSetting.create({ feature: "comment_check", enabled: true, provider: "deepseek", fallback: true });
  await activateAiPolicyVersion(principal, (await saveAiPolicyVersion(principal, { key: "comment_standard", body: DAILY_RULES })).id);
  if (withCt) await activateAiPolicyVersion(principal, (await saveAiPolicyVersion(principal, { key: "ct_comment_standard", body: CT_RULES })).id);
}
const reply = (json: unknown) => ({
  result: { provider: "deepseek", model: "deepseek-flash", resolvedModel: "deepseek-flash", text: JSON.stringify(json), json, usage: { cacheHitTokens: 0, cacheMissTokens: 1, outputTokens: 1, reasoningTokens: 0 }, finishReason: "stop", latencyMs: 5 },
  attempts: [],
  callId: "c",
});
const daily = (text: string) => ({ kind: "DAILY" as const, studentId, fields: [{ field: "text", text }] });

describe("availability", () => {
  test("off until the feature AND the standard are on; class tests also need their standard", async () => {
    expect(await commentCheckAvailability(teacher)).toEqual({ daily: false, ct: false });
    await AiFeatureSetting.create({ feature: "comment_check", enabled: true, provider: "deepseek", fallback: true });
    expect(await commentCheckAvailability(teacher)).toEqual({ daily: false, ct: false });
    await activateAiPolicyVersion(principal, (await saveAiPolicyVersion(principal, { key: "comment_standard", body: DAILY_RULES })).id);
    expect(await commentCheckAvailability(teacher)).toEqual({ daily: true, ct: false });
    await activateAiPolicyVersion(principal, (await saveAiPolicyVersion(principal, { key: "ct_comment_standard", body: CT_RULES })).id);
    expect(await commentCheckAvailability(teacher)).toEqual({ daily: true, ct: true });
  });
});

describe("the check", () => {
  test("de-identified prompt; stable prefix = instructions + standard, identical across calls; names restored in the answer", async () => {
    await turnOn();
    mockSend.mockResolvedValue(
      reply({
        issues: [{ field: "text", type: "honorific", quote: "[S] আসে নাই", suggestion: "[S] আসেননি" }],
        corrected: { text: "আসসালামু আলাইকুম। [S] আজ বই আনেননি; [S1]-এর বই দেখে পড়েছেন। জাযাকুমুল্লাহু খাইরান।" },
      }),
    );
    const r1 = await checkComment(teacher, { ...daily("তাহসিন আজ বই আনে নাই, আরিফের বই দেখে পড়ছে। ফোন 01712345678"), commentType: "STUDY_HOMEWORK", sentiment: "CONCERN" });
    await checkComment(teacher, daily("আরেকটি মন্তব্য।"));
    const [feature, input1, ctx] = mockSend.mock.calls[0];
    const input2 = mockSend.mock.calls[1][1];
    expect(feature).toBe("comment_check");
    expect(input1.stablePrefix.startsWith(CHECKER_INSTRUCTIONS)).toBe(true);
    expect(input1.stablePrefix.endsWith(DAILY_RULES)).toBe(true);
    expect(Buffer.from(input1.stablePrefix).equals(Buffer.from(input2.stablePrefix))).toBe(true);
    expect(input1).toMatchObject({ json: true, maxOutputTokens: 800, reasoning: "off" });
    for (const leak of ["তাহসিন", "আরিফ", "01712345678"]) expect(input1.variablePart).not.toContain(leak);
    expect(JSON.parse(input1.variablePart)).toMatchObject({ fields: { text: "[S] আজ বই আনে নাই, [S1]ের বই দেখে পড়ছে। ফোন [PHONE]" }, commentType: "STUDY_HOMEWORK", sentiment: "CONCERN" });
    expect(ctx).toMatchObject({ userId: teacher.userId, role: "TEACHER", refType: "StudentComment", refId: studentId });
    expect(ctx.policyHash).toMatch(/^comment_standard@v1#/);

    expect(r1.status).toBe("CHECKED");
    expect(r1.issues).toEqual([{ field: "text", type: "honorific", quote: "তাহসিন আসে নাই", suggestion: "তাহসিন আসেননি" }]);
    expect(r1.corrected[0].text).toBe("আসসালামু আলাইকুম। তাহসিন আজ বই আনেননি; আরিফ-এর বই দেখে পড়েছেন। জাযাকুমুল্লাহু খাইরান।");
    expect(readCheckToken(r1.token, studentId, "DAILY")).toMatchObject({ issuesFound: 1, policyHash: ctx.policyHash });
    expect(await StudentComment.countDocuments()).toBe(0);
  });

  test("a class test sends both standards and the mark %, never the name; odd model output is tamed", async () => {
    await turnOn();
    mockSend.mockResolvedValue(reply({ issues: [{ field: "nonsense", type: "weird", quote: "x", suggestion: "y" }], corrected: { weakness: "ঠিক আছে।", extra: "drop me" } }));
    const r = await checkComment(teacher, {
      kind: "CT",
      studentId,
      markPct: 91.6,
      fields: [
        { field: "weakness", text: "তাহসিন প্রশ্ন বোঝে না" },
        { field: "guardianAction", text: "" },
      ],
    });
    const input = mockSend.mock.calls[0][1];
    expect(input.stablePrefix).toContain(DAILY_RULES);
    expect(input.stablePrefix).toContain(CT_RULES);
    expect(JSON.parse(input.variablePart)).toMatchObject({ markPct: 92, fields: { weakness: "[S] প্রশ্ন বোঝে না" } });
    expect(JSON.parse(input.variablePart).fields.guardianAction).toBeUndefined();
    expect(r.issues).toEqual([{ field: "weakness", type: "standard", quote: "x", suggestion: "y" }]);
    expect(r.corrected).toEqual([{ field: "weakness", text: "ঠিক আছে।" }]);
  });
});

describe("fail-open", () => {
  test.each([
    ["CAPPED", () => new AiCapError("আজ মন্তব্য যাচাই-এর সীমা শেষ", "daily"), "সীমা শেষ"],
    ["AI_ERROR", () => new AiProviderError("busy", "busy", "deepseek", 503), "সাড়া দিচ্ছে না"],
  ])("%s → NOT_CHECKED with a Bangla message, no token", async (reason, err, msg) => {
    await turnOn();
    mockSend.mockRejectedValue(err());
    const r = await checkComment(teacher, daily("একটি মন্তব্য।"));
    expect(r).toMatchObject({ status: "NOT_CHECKED", reason, token: null });
    expect(r.message).toContain(msg);
  });

  test("no active standard → NOT_CHECKED before any call; class test without its standard too", async () => {
    await AiFeatureSetting.create({ feature: "comment_check", enabled: true, provider: "deepseek", fallback: true });
    expect((await checkComment(teacher, daily("মন্তব্য।"))).reason).toBe("NO_STANDARD");
    await activateAiPolicyVersion(principal, (await saveAiPolicyVersion(principal, { key: "comment_standard", body: DAILY_RULES })).id);
    expect((await checkComment(teacher, { kind: "CT", studentId, fields: [{ field: "weakness", text: "লেখা" }] })).reason).toBe("NO_STANDARD");
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("the feature switched off → NOT_CHECKED (FEATURE_OFF)", async () => {
    const { AiFeatureOffError } = jest.requireActual("../modules/platform/ai/aiRouter");
    await turnOn();
    mockSend.mockRejectedValue(new AiFeatureOffError("comment_check"));
    expect((await checkComment(teacher, daily("মন্তব্য।"))).reason).toBe("FEATURE_OFF");
  });
});

describe("the stamp on save", () => {
  test("CHECKED needs a valid token for THIS child; a forged or foreign token is SKIPPED; checker off → nothing", async () => {
    await turnOn();
    mockSend.mockResolvedValue(reply({ issues: [{ field: "text", type: "tone", quote: "a", suggestion: "b" }, { field: "text", type: "punctuation", quote: "c", suggestion: "d" }], corrected: { text: "ঠিক।" } }));
    const r = await checkComment(teacher, daily("মন্তব্য"));

    expect(await aiCheckStamp({ token: r.token, issuesAccepted: 1, teacherOverrode: false }, studentId, "DAILY")).toMatchObject({
      status: "CHECKED",
      issuesFound: 2,
      issuesAccepted: 1,
      teacherOverrode: false,
      model: "deepseek-flash",
    });
    expect((await aiCheckStamp({ token: r.token, issuesAccepted: 9 }, studentId, "DAILY"))!.issuesAccepted).toBe(2);
    expect((await aiCheckStamp({ token: r.token }, studentId, "DAILY"))!.teacherOverrode).toBe(true);
    const forged = `${r.token!.split(".")[0]}.AAAA`;
    expect(await aiCheckStamp({ token: forged }, studentId, "DAILY")).toEqual({ status: "NOT_CHECKED", reason: "SKIPPED" });
    expect(await aiCheckStamp({ token: r.token }, otherStudent, "DAILY")).toEqual({ status: "NOT_CHECKED", reason: "SKIPPED" });
    expect(await aiCheckStamp({ token: r.token }, studentId, "CT")).toEqual({ status: "NOT_CHECKED", reason: "SKIPPED" });
    expect(await aiCheckStamp(null, studentId, "DAILY")).toEqual({ status: "NOT_CHECKED", reason: "SKIPPED" });

    await AiFeatureSetting.updateOne({ feature: "comment_check" }, { $set: { enabled: false } });
    expect(await aiCheckStamp(null, studentId, "DAILY")).toBeUndefined();
  });

  test("the stamp is stored on the comment, with no text in it", async () => {
    const doc = await recordComment({
      studentId,
      sectionId,
      type: "GENERAL",
      sentiment: "CONCERN",
      text: "আসসালামু আলাইকুম। পরীক্ষা।",
      actorId: teacher.userId,
      aiCheck: { status: "CHECKED", policyHash: "comment_standard@v1#abc", model: "deepseek-flash", issuesFound: 2, issuesAccepted: 2, teacherOverrode: false, checkedAt: new Date() },
    });
    const row = await StudentComment.findById(doc.id).lean();
    expect(row!.aiCheck).toMatchObject({ status: "CHECKED", issuesFound: 2, issuesAccepted: 2 });
    expect(JSON.stringify(row!.aiCheck)).not.toContain("পরীক্ষা");
  });

  test("a teacher without the permission cannot check", async () => {
    await expect(checkComment({ userId: teacher.userId, role: "GUARDIAN" } as AuthPayload, daily("x"))).rejects.toThrow("অনুমতি নেই");
  });
});
