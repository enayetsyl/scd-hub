/**
 * AI-3 rules store + AI-3s seed (D-#1093, D-#1102), on an in-memory MongoDB.
 *   • the seed loads the proposed standards as INACTIVE v1, once, never over a saved version
 *   • saving adds the next version (never edits one); identical text is refused
 *   • one active version per key; switching a key off leaves none (the feature stops)
 *   • the hash is key@vN#sha12 and changes with the text
 *   • teachers read only the active version; only the Principal writes
 *   • the seed files are the docs' bodies byte for byte (no drift)
 */
import { readFileSync } from "fs";
import path from "path";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { AiPolicy } from "../modules/platform/models/AiPolicy";
import {
  activateAiPolicyVersion,
  activeAiPolicy,
  activeAiPolicyView,
  aiPolicySummaries,
  aiPolicyVersionsPage,
  AI_POLICY_ASSET_DIR,
  deactivateAiPolicy,
  saveAiPolicyVersion,
  seedAiPolicies,
} from "../modules/platform/services/AiPolicyService";
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
  await AiPolicy.deleteMany({});
});

const principal: AuthPayload = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" };
const teacher: AuthPayload = { userId: new Types.ObjectId().toString(), role: "TEACHER" };
const RULES = "## নিয়ম\n\n- সম্মানসূচক রূপ লিখুন।\n- প্রতিটি বাক্য দাঁড়ি দিয়ে শেষ করুন।";

describe("the seed (AI-3s)", () => {
  test("loads the two proposed standards as INACTIVE v1, once", async () => {
    expect((await seedAiPolicies()).sort()).toEqual(["comment_standard", "ct_comment_standard"]);
    const rows = await AiPolicy.find({}).lean();
    expect(rows.map((r) => [r.key, r.version, r.active, r.createdBy ?? null]).sort()).toEqual([
      ["comment_standard", 1, false, null],
      ["ct_comment_standard", 1, false, null],
    ]);
    expect(await activeAiPolicy("comment_standard")).toBeNull();
    expect(await seedAiPolicies()).toEqual([]);
    expect(await AiPolicy.countDocuments()).toBe(2);
  });

  test("never seeds over a key that already has a version", async () => {
    await saveAiPolicyVersion(principal, { key: "comment_standard", body: RULES });
    expect(await seedAiPolicies()).toEqual(["ct_comment_standard"]);
    const cs = await AiPolicy.find({ key: "comment_standard" }).lean();
    expect(cs).toHaveLength(1);
    expect(cs[0].body).toBe(RULES);
  });

  test("the seed files are the docs' standard bodies, byte for byte", () => {
    const repo = path.resolve(__dirname, "../../..");
    for (const [doc, key, head] of [
      ["comment-standard.md", "comment_standard", "## দৈনিক মন্তব্যের নিয়ম"],
      ["ct-comment-standard.md", "ct_comment_standard", "## ক্লাস টেস্টের মন্তব্যের নিয়ম"],
    ]) {
      const src = readFileSync(path.join(repo, "docs/ai-assist", doc), "utf8").replace(/\r\n/g, "\n");
      const asset = readFileSync(path.join(AI_POLICY_ASSET_DIR, `${key}.md`), "utf8").replace(/\r\n/g, "\n");
      expect(asset.trim()).toBe(src.slice(src.indexOf(head)).trim());
    }
  });
});

describe("versions", () => {
  test("saving adds the next version, OFF; identical text and tiny text are refused", async () => {
    const v1 = await saveAiPolicyVersion(principal, { key: "comment_standard", body: RULES, note: "প্রথম" });
    expect(v1).toMatchObject({ version: 1, active: false, note: "প্রথম" });
    expect(v1.hash).toMatch(/^comment_standard@v1#[0-9a-f]{12}$/);
    await expect(saveAiPolicyVersion(principal, { key: "comment_standard", body: `${RULES}\n` })).rejects.toThrow("পার্থক্য নেই");
    const v2 = await saveAiPolicyVersion(principal, { key: "comment_standard", body: `${RULES}\n- নতুন নিয়ম।` });
    expect(v2.version).toBe(2);
    expect(v2.hash).not.toBe(v1.hash.replace("@v1", "@v2"));
    await expect(saveAiPolicyVersion(principal, { key: "comment_standard", body: "ছোট" })).rejects.toThrow("খুব ছোট");
    await expect(saveAiPolicyVersion(principal, { key: "essay_rules", body: RULES })).rejects.toThrow("চেনা যায়নি");
    const page = await aiPolicyVersionsPage(principal, "comment_standard", {});
    expect(page.rows.map((r) => r.version)).toEqual([2, 1]);
    expect(page.total).toBe(2);
  });

  test("one active version per key; switching off leaves none", async () => {
    const v1 = await saveAiPolicyVersion(principal, { key: "comment_standard", body: RULES });
    const v2 = await saveAiPolicyVersion(principal, { key: "comment_standard", body: `${RULES}\n- আরও।` });
    await activateAiPolicyVersion(principal, v1.id);
    expect((await activeAiPolicy("comment_standard"))!.version).toBe(1);
    await activateAiPolicyVersion(principal, v2.id);
    const active = await activeAiPolicy("comment_standard");
    expect(active).toMatchObject({ version: 2, hash: v2.hash });
    expect(await AiPolicy.countDocuments({ key: "comment_standard", active: true })).toBe(1);
    const s = await deactivateAiPolicy(principal, "comment_standard");
    expect(s).toMatchObject({ activeVersion: null, latestVersion: 2, versions: 2 });
    expect(await activeAiPolicy("comment_standard")).toBeNull();
  });

  test("summaries list every document, including ones never written", async () => {
    await saveAiPolicyVersion(principal, { key: "ct_comment_standard", body: RULES });
    const s = await aiPolicySummaries(teacher);
    expect(s.map((x) => [x.key, x.activeVersion, x.latestVersion])).toEqual([
      ["comment_standard", null, null],
      ["ct_comment_standard", null, 1],
      ["assistant_rules", null, null],
    ]);
  });
});

describe("who may do what", () => {
  test("a teacher reads only the ACTIVE version and cannot write or list versions", async () => {
    const v1 = await saveAiPolicyVersion(principal, { key: "comment_standard", body: RULES });
    expect(await activeAiPolicyView(teacher, "comment_standard")).toBeNull();
    await activateAiPolicyVersion(principal, v1.id);
    expect((await activeAiPolicyView(teacher, "comment_standard"))!.body).toBe(RULES);
    await expect(saveAiPolicyVersion(teacher, { key: "comment_standard", body: `${RULES}!` })).rejects.toThrow("অনুমতি নেই");
    await expect(activateAiPolicyVersion(teacher, v1.id)).rejects.toThrow("অনুমতি নেই");
    await expect(aiPolicyVersionsPage(teacher, "comment_standard", {})).rejects.toThrow("অনুমতি নেই");
    await expect(activeAiPolicyView({ userId: teacher.userId, role: "GUARDIAN" } as AuthPayload, "comment_standard")).rejects.toThrow("অনুমতি নেই");
  });
});
