/**
 * AI Workspace — lesson plans with the Project 09 plan tools (server/import/plan-tools/), on an
 * in-memory MongoDB with the REAL Python renderer and validator (CI installs jsonschema).
 *   • render_plan.py turns the plan JSON into the Markdown; the model's own Markdown is dropped
 *   • validate_plan.py checks every version; a multi-period session plan is checked against
 *     its chapter plan in the same project (the approved version when there is one)
 *   • approval re-runs the check and refuses a plan that fails it
 *   • a plan whose JSON cannot be rendered keeps a notice as its body and fails the check
 */
import { readFileSync } from "fs";
import path from "path";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User } from "../modules/foundation/models/User";
import { createAiProject, setAiProjectMembers } from "../modules/ai-workspace/services/AiProjectService";
import { approveDraft, createDraft, draft, saveDraftVersion } from "../modules/ai-workspace/services/DraftService";
import { renderPlanMarkdown, runPlanValidator } from "../modules/ai-workspace/services/planTools";
import type { AuthPayload } from "../context";

jest.setTimeout(120_000);

const FIX = path.join(__dirname, "fixtures", "p09");
const CHAPTER = readFileSync(path.join(FIX, "chapter.json"), "utf-8");
const SESSION = readFileSync(path.join(FIX, "session1.json"), "utf-8");

/** The session plan with one change (a JSON edit, as DeepSeek or a person would make). */
function sessionWith(edit: (p: Record<string, any>) => void): string {
  const p = JSON.parse(SESSION) as Record<string, any>;
  edit(p);
  return JSON.stringify(p, null, 1);
}

let mongo: MongoMemoryServer;
const principal: AuthPayload = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" };
let projectId = "";

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  await User.create({ _id: principal.userId, role: "PRINCIPAL", name: "Head Teacher", phone: "01700000001", passwordHash: "x" });
  projectId = (await createAiProject(principal, { name: "P09 — C1 বাংলা পাঠ পরিকল্পনা", nameProtection: false })).id;
  await setAiProjectMembers(principal, projectId, [{ userId: principal.userId, role: "owner" }]);
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe("the P09 tools", () => {
  it("render_plan.py renders the teacher-facing Markdown from the JSON", async () => {
    const r = await renderPlanMarkdown(CHAPTER);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.md.split("\n")[0]).toBe("# পাঠ ৫৩: আমাদের বাগান — প্রথম শ্রেণি বাংলা (২ পিরিয়ড)");
      expect(r.md).toContain("## কোন পিরিয়ডে কী / Session Map");
      expect(r.md).not.toContain("TOP-BAN");
    }
  });

  it("validate_plan.py passes the fixtures (the session against its chapter) and fails a broken plan", async () => {
    expect(await runPlanValidator(CHAPTER)).toMatchObject({ verdict: "PASS", fails: [] });
    expect(await runPlanValidator(SESSION, CHAPTER)).toMatchObject({ verdict: "PASS", fails: [], warns: [] });
    const noChapter = await runPlanValidator(SESSION);
    expect(noChapter.verdict).toBe("PASS");
    expect(noChapter.warns.join(" ")).toContain("[XP]");
    const short = await runPlanValidator(sessionWith((p) => (p.session_plan.lesson_flow.segments[2].minutes = 7)), CHAPTER);
    expect(short.verdict).toBe("FAIL");
    expect(short.fails).toContain("[SUM-35] segment minutes sum to 34, not 35");
  });
});

describe("lesson-plan drafts", () => {
  let sessionId = "";
  it("a session plan saved before its chapter plan: Markdown rendered, check passes with the no-chapter warning", async () => {
    const d = await createDraft(principal, projectId, { title: "পাঠ ৫৩ — পিরিয়ড ১", kind: "lesson_plan", body: "# the model's own Markdown", planJson: SESSION });
    sessionId = d.id;
    const { version } = await draft(principal, d.id);
    expect(version.body.startsWith("# পিরিয়ড ১: গল্প পড়া — প্রথম শ্রেণি বাংলা (১/২)")).toBe(true);
    expect(version.body).not.toContain("the model's own Markdown");
    expect(version.planCheck).toMatchObject({ verdict: "PASS", chapterDraftId: null });
    expect(version.planCheck?.warns.join(" ")).toContain("[XP]");
  });

  it("approval checks the session against the chapter plan in the project and refuses a mismatch", async () => {
    const ch = await createDraft(principal, projectId, { title: "পাঠ ৫৩ — অধ্যায় পরিকল্পনা", kind: "lesson_plan", body: "", planJson: CHAPTER });
    expect((await draft(principal, ch.id)).version.planCheck).toMatchObject({ verdict: "PASS" });
    await approveDraft(principal, ch.id);

    await saveDraftVersion(principal, sessionId, { body: "", planJson: sessionWith((p) => (p.session_plan.session_header.objective = "শিশুরা গল্পটি জোরে পড়বে।")) });
    const v2 = (await draft(principal, sessionId)).version;
    expect(v2.planCheck).toMatchObject({ verdict: "FAIL", chapterDraftId: ch.id, chapterVersion: 1 });
    expect(v2.planCheck?.fails.join(" ")).toContain("[XP-OBJ]");
    await expect(approveDraft(principal, sessionId)).rejects.toThrow("XP-OBJ");

    await saveDraftVersion(principal, sessionId, { body: "", planJson: SESSION.replace("দরকার হলে এখান থেকে নেবেন।", "দরকার হলে এই তালিকা থেকে নেবেন।") });
    expect(await approveDraft(principal, sessionId)).toMatchObject({ status: "approved", approvedVersion: 3 });
    expect((await draft(principal, sessionId)).version.planCheck).toMatchObject({ verdict: "PASS", chapterDraftId: ch.id, warns: [] });
  });

  it("JSON that cannot be rendered keeps a notice as its body and fails the check", async () => {
    const broken = JSON.stringify({ schema_version: "1.0", plan_type: "session_plan", subject: "BAN", class_level: 1, curation_tag: "KEEP_AS_IS", division: { anchor_word: "পাঠ", number: 54, title: "x" } });
    const d = await createDraft(principal, projectId, { title: "ভাঙা", kind: "lesson_plan", body: "", planJson: broken });
    const { version } = await draft(principal, d.id);
    expect(version.body.startsWith("⚠")).toBe(true);
    expect(version.planCheck?.verdict).toBe("FAIL");
    expect(version.planCheck?.fails.join(" ")).toContain("[SCHEMA]");
    await expect(approveDraft(principal, d.id)).rejects.toThrow("SCHEMA");
  });
});
