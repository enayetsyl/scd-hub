/**
 * AI Workspace W-3 — drafts (docs/prd-ai-workspace.md §5; D-#1210–#1212, D-#1229), on an
 * in-memory MongoDB. The AI call and the import pipeline are stubs.
 *   • content rules per kind (JSON kinds, lesson plan = Markdown + plan JSON)
 *   • versions are never edited; approve (owner) locks; a later change un-approves
 *   • save-as-draft from a finished answer splits a ```json block out
 *   • revise with notes: same cached prefix as chat, the current draft as context, the notes
 *     last; queued for off-peak and answered by the queue; cancel
 *   • send = publish: approved + unchanged + the pipeline's permission + confirm; the
 *     preview names what is replaced; the pipeline's verdict is recorded
 *   • export renders Markdown with the Bangla house font, no AI
 */
const mockImport = jest.fn();
const mockBuild = jest.fn();
const mockGate = jest.fn();
jest.mock("../modules/content/services/ContentService", () => {
  const actual = jest.requireActual("../modules/content/services/ContentService");
  return {
    ...actual,
    importContentFiles: (...a: unknown[]) => mockImport(...a),
    buildEnvelopeFromPair: (...a: unknown[]) => mockBuild(...a),
    runImportGate: (...a: unknown[]) => mockGate(...a),
  };
});

import { promises as fs } from "fs";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User } from "../modules/foundation/models/User";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { AiAssistMessage } from "../modules/ai-assist/models/AiAssistMessage";
import { AiUsage } from "../modules/platform/models/AiUsage";
import { AiDraft, AiDraftVersion } from "../modules/ai-workspace/models/AiDraft";
import { createAiProject, saveAiProjectInstructions, setAiProjectMembers } from "../modules/ai-workspace/services/AiProjectService";
import { projectPrefix, startProjectChat } from "../modules/ai-workspace/services/ProjectChatService";
import { AiProject } from "../modules/ai-workspace/models/AiProject";
import {
  approveDraft,
  cancelDraftRevision,
  contentFromAnswer,
  createDraft,
  draft,
  draftVersionsPage,
  previewDraftSend,
  processQueuedRevisions,
  REVISE_INSTRUCTIONS,
  reviseDraft,
  saveDraftFromMessage,
  saveDraftVersion,
  sendDraftToPipeline,
  splitJsonFence,
} from "../modules/ai-workspace/services/DraftService";
import { draftHtml, exportDraft } from "../modules/ai-workspace/services/draftExport";
import type { aiSend } from "../modules/platform/ai/aiRouter";
import type { AiSendInput } from "../modules/platform/ai/provider";
import type { AuthPayload } from "../context";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const principal: AuthPayload = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" };
const editor: AuthPayload = { userId: new Types.ObjectId().toString(), role: "TEACHER", grantedPermissions: ["ai_workspace:use"] };
const MON_PEAK = new Date("2026-11-09T07:00:00Z");
const MON_OFF = new Date("2026-11-09T12:00:00Z");
const PLAN = JSON.stringify({ plan_type: "session_plan", subject: "BAN", class_level: 1 });

function stubSend(text: string, seen: AiSendInput[] = []) {
  return (async (_f: string, input: AiSendInput, ctx: Record<string, unknown>) => {
    seen.push(input);
    const callId = new Types.ObjectId().toString();
    await AiUsage.create({ at: new Date(), branch: "sylhet", feature: "workspace_draft", callId, attempt: 1, provider: "deepseek", modelName: "deepseek-flash", costUsd: 0.004, outcome: "ok", projectId: ctx.projectId as string });
    return { result: { provider: "deepseek", model: "deepseek-flash", resolvedModel: "deepseek-flash", text, usage: { cacheHitTokens: 1, cacheMissTokens: 1, outputTokens: 1, reasoningTokens: null }, finishReason: "stop", latencyMs: 1 }, attempts: [], callId };
  }) as unknown as typeof aiSend;
}

let projectId = "";
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  await User.create([
    { _id: principal.userId, role: "PRINCIPAL", name: "Head Teacher", phone: "01700000001", passwordHash: "x" },
    { _id: editor.userId, role: "TEACHER", name: "Editor Teacher", phone: "01700000002", passwordHash: "x", grantedPermissions: ["ai_workspace:use"] },
  ]);
  projectId = (await createAiProject(principal, { name: "C1 Bangla plans", nameProtection: false })).id;
  await saveAiProjectInstructions(principal, projectId, "## নিয়ম\nপাঠ পরিকল্পনা লিখুন।");
  await setAiProjectMembers(principal, projectId, [{ userId: principal.userId, role: "owner" }, { userId: editor.userId, role: "editor" }]);
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe("content rules", () => {
  it("splits a json fence out of an answer", () => {
    expect(splitJsonFence("শুরু\n```json\n{\"a\":1}\n```\nশেষ")).toEqual({ json: '{"a":1}', rest: "শুরু\n\nশেষ" });
    expect(contentFromAnswer("lesson_plan", "# পাঠ\n```json\n{\"x\":1}\n```")).toEqual({ body: "# পাঠ", planJson: '{"x":1}' });
    expect(contentFromAnswer("question_bank", "```json\n{\"questions\":[]}\n```")).toEqual({ body: '{"questions":[]}', planJson: null });
    expect(contentFromAnswer("free", "  লেখা  ")).toEqual({ body: "লেখা", planJson: null });
  });

  it("refuses bad JSON, a lesson plan without both parts, an unknown kind", async () => {
    await expect(createDraft(editor, projectId, { title: "Bank", kind: "question_bank", body: "not json" })).rejects.toThrow("JSON");
    await expect(createDraft(editor, projectId, { title: "Plan", kind: "lesson_plan", body: "# md only" })).rejects.toThrow("দুটোই");
    await expect(createDraft(editor, projectId, { title: "X", kind: "poem", body: "x" })).rejects.toThrow("ধরন");
  });
});

describe("versions and approval", () => {
  let draftId = "";
  it("create → v1; edit → v2 (the same text is refused); the list never carries whole bodies", async () => {
    const d = await createDraft(editor, projectId, { title: "গল্প ১", kind: "free", body: "এক ছিল রাজা।" });
    draftId = d.id;
    expect(d).toMatchObject({ currentVersion: 1, status: "draft", canSend: false });
    await expect(saveDraftVersion(editor, draftId, { body: "এক ছিল রাজা।" })).rejects.toThrow("পার্থক্য নেই");
    const v2 = await saveDraftVersion(editor, draftId, { body: "এক ছিল এক রাজা। ".repeat(40), note: "বড় করলাম" });
    expect(v2.currentVersion).toBe(2);
    const list = await draftVersionsPage(editor, draftId, {});
    expect(list.rows.map((v) => v.version)).toEqual([2, 1]);
    expect(list.rows[0].body.length).toBe(300);
    expect(await AiDraftVersion.countDocuments({ draftId })).toBe(2);
  });

  it("only the owner approves; a later edit makes it a draft again", async () => {
    await expect(approveDraft(editor, draftId)).rejects.toThrow("মালিক");
    expect(await approveDraft(principal, draftId)).toMatchObject({ status: "approved", approvedVersion: 2, approvedByName: "Head Teacher" });
    const v3 = await saveDraftVersion(editor, draftId, { body: "নতুন" });
    expect(v3).toMatchObject({ status: "draft", approvedVersion: 2, currentVersion: 3 });
  });
});

describe("save from chat, revise", () => {
  it("a finished answer becomes a lesson-plan draft with its JSON part", async () => {
    const chat = await startProjectChat(principal, projectId);
    const m = await AiAssistMessage.create({ sessionId: chat.id, teacherId: principal.userId, projectId, role: "assistant", text: `# সেশন ১\nপাঠ\n\`\`\`json\n${PLAN}\n\`\`\``, at: new Date(), status: "done" });
    const d = await saveDraftFromMessage(principal, m._id.toString(), { title: "সেশন ১", kind: "lesson_plan" });
    const full = await draft(principal, d.id);
    expect(full.version).toMatchObject({ body: "# সেশন ১\nপাঠ", planJson: PLAN, source: "chat" });
    const running = await AiAssistMessage.create({ sessionId: chat.id, teacherId: principal.userId, projectId, role: "assistant", text: "", at: new Date(), status: "running" });
    await expect(saveDraftFromMessage(principal, running._id.toString(), { title: "x", kind: "free" })).rejects.toThrow("শেষ হওয়া");
  });

  it("revise: the chat's cached prefix, the current draft as context, the notes last → the next version", async () => {
    const d = await createDraft(editor, projectId, { title: "রিভাইজ", kind: "free", body: "পুরনো লেখা" });
    const seen: AiSendInput[] = [];
    const r = await reviseDraft(editor, d.id, { notes: "ছোট করুন", model: "deepseek-flash", thinking: "low", runAt: "now" }, { send: stubSend("নতুন লেখা", seen) });
    expect(r.draft.revise?.status).toBe("running");
    await r.done;
    const p = await AiProject.findById(projectId);
    expect(seen[0].stablePrefix).toBe((await projectPrefix(p!)).stablePrefix);
    expect(seen[0].context).toBe("# CURRENT DRAFT (free, version 1)\n\nপুরনো লেখা");
    expect(seen[0].variablePart).toBe(`${REVISE_INSTRUCTIONS}ছোট করুন`);
    expect(seen[0]).toMatchObject({ maxOutputTokens: 32000, reasoning: "low" });
    const after = await draft(editor, d.id);
    expect(after.draft).toMatchObject({ currentVersion: 2, revise: null });
    expect(after.version).toMatchObject({ body: "নতুন লেখা", source: "revise", costUsd: 0.004 });
  });

  it("revise off-peak at peak time waits, the queue answers it off-peak; cancel stops a queued one", async () => {
    const d = await createDraft(editor, projectId, { title: "রাতে", kind: "free", body: "খসড়া" });
    const r = await reviseDraft(editor, d.id, { notes: "আরও সহজ", model: "deepseek-flash", thinking: "off", runAt: "offpeak" }, { now: () => MON_PEAK });
    expect(r.draft.revise).toMatchObject({ status: "queued" });
    expect(await processQueuedRevisions(MON_PEAK, { send: stubSend("x") })).toBe(0);
    expect(await processQueuedRevisions(MON_OFF, { send: stubSend("সহজ খসড়া") })).toBe(1);
    expect((await draft(editor, d.id)).version.body).toBe("সহজ খসড়া");

    await reviseDraft(editor, d.id, { notes: "আবার", model: "deepseek-flash", thinking: "off", runAt: "offpeak" }, { now: () => MON_PEAK });
    expect((await cancelDraftRevision(editor, d.id)).revise).toMatchObject({ status: "stopped" });
  });

  it("revise needs the run choice and refuses a second one while busy", async () => {
    const d = await createDraft(editor, projectId, { title: "ব্যস্ত", kind: "free", body: "x y" });
    await expect(reviseDraft(editor, d.id, { notes: "a b", model: "deepseek-flash", thinking: "off", runAt: "" })).rejects.toThrow("কম দামে");
    await reviseDraft(editor, d.id, { notes: "a b", model: "deepseek-flash", thinking: "off", runAt: "offpeak" }, { now: () => MON_PEAK });
    await expect(reviseDraft(editor, d.id, { notes: "c d", model: "deepseek-flash", thinking: "off", runAt: "now" })).rejects.toThrow("চলছে");
  });
});

describe("send to a pipeline", () => {
  let planId = "";
  beforeAll(async () => {
    planId = (await createDraft(editor, projectId, { title: "সেশন পরিকল্পনা", kind: "lesson_plan", body: "# সেশন ২", planJson: PLAN })).id;
  });

  it("refuses an unapproved draft, a draft changed since approval, and a send without confirm", async () => {
    await expect(sendDraftToPipeline(principal, planId, { confirm: true })).rejects.toThrow("অনুমোদন");
    await approveDraft(principal, planId);
    await expect(sendDraftToPipeline(principal, planId, { confirm: false })).rejects.toThrow("নিশ্চিত");
  });

  it("an editor without lesson_plans:import cannot preview or send", async () => {
    await expect(previewDraftSend(editor, planId)).rejects.toThrow("অনুমতি নেই");
    await expect(sendDraftToPipeline(editor, planId, { confirm: true })).rejects.toThrow("অনুমতি নেই");
  });

  it("the preview runs the validator dry and names the plan it replaces", async () => {
    const envelope = { doc_type: "session_plan", subject: "BAN", class_level: 1, address: { anchor_word: "SP", number: "4", title: "আমাদের গ্রাম" }, payload: { session_plan: { period_index: 2 } } };
    mockBuild.mockResolvedValue({ ok: true, envelope });
    mockGate.mockResolvedValue({ verdict: "PASS", failChecks: [], warnings: [], advisories: [], raw: "" });
    await ContentArtifact.collection.insertOne({ docType: "session_plan", subject: "BAN", classLevel: 1, address: { anchorWord: "SP", number: "4", title: "আমাদের গ্রাম" }, envelopeJson: { payload: { session_plan: { period_index: 2 } } }, current: true, importedAt: new Date("2026-10-01T00:00:00Z") });
    const p = await previewDraftSend(principal, planId);
    expect(p).toMatchObject({ pipeline: "lesson_plan", verdict: "PASS" });
    expect(p.replaces).toContain("C1 · BAN · session_plan · অধ্যায় 4");
    expect(p.replaces).toContain("2026-10-01");
    expect(mockBuild.mock.calls[0][1]).toBe(PLAN);
  });

  it("send imports the plan JSON + Markdown pair through the import path and records the verdict", async () => {
    mockImport.mockResolvedValue({ verdict: "PASS", failChecks: [], warnings: [], advisories: [], artifactId: "art-1", batchId: "b" });
    const r = await sendDraftToPipeline(principal, planId, { confirm: true });
    expect(r).toMatchObject({ ok: true });
    const [files, actor, author] = mockImport.mock.calls[0] as [Array<{ filename: string; content: string }>, string, string];
    expect(files.map((f) => f.filename)).toEqual([`aiws-${planId}-v1.json`, `aiws-${planId}-v1.md`]);
    expect(files[0].content).toBe(PLAN);
    expect(files[1].content).toBe("# সেশন ২");
    expect([actor, author]).toEqual([principal.userId, "Head Teacher"]);
    expect((await AiDraft.findById(planId).lean())?.sends).toMatchObject([{ pipeline: "lesson_plan", version: 1, ok: true }]);
  });

  it("a FAIL from the validator is reported, not hidden", async () => {
    mockImport.mockResolvedValue({ verdict: "FAIL", failChecks: ["C-12: missing objective"], warnings: [], advisories: [], batchId: "b" });
    expect(await sendDraftToPipeline(principal, planId, { confirm: true })).toEqual({ ok: false, summary: "যাচাইয়ে আটকেছে", failChecks: ["C-12: missing objective"] });
  });

  it("a question bank needs a curation tag; a book chapter needs the book plane; free text exports only", async () => {
    const qb = await createDraft(principal, projectId, { title: "Bank", kind: "question_bank", body: JSON.stringify({ questions: [{}], stimuli: [] }) });
    await approveDraft(principal, qb.id);
    await expect(sendDraftToPipeline(principal, qb.id, { confirm: true })).rejects.toThrow("কিউরেশন");
    mockImport.mockResolvedValue({ verdict: "PASS", failChecks: [], warnings: [], advisories: [], batchId: "b", itemsTotal: 1, itemsPassed: 1, itemsFailed: 0 });
    expect(await sendDraftToPipeline(principal, qb.id, { confirm: true, curationTag: "KEEP_AS_IS" })).toMatchObject({ ok: true, summary: "1/1 আমদানি হয়েছে" });
    expect(mockImport.mock.calls.at(-1)?.[3]).toBe("KEEP_AS_IS");

    const book = await createDraft(principal, projectId, { title: "Ch", kind: "book_chapter", body: JSON.stringify({ book_id: "B1", patch_id: "p", task: "t", lessons: [{ lesson_no: 3 }] }) });
    await approveDraft(principal, book.id);
    expect((await previewDraftSend(principal, book.id)).replaces).toBe("B1 — পাঠ 3");
    await expect(sendDraftToPipeline(principal, book.id, { confirm: true })).rejects.toThrow("বই-প্রোডাকশন");

    const free = await createDraft(principal, projectId, { title: "Free", kind: "free", body: "x y" });
    await approveDraft(principal, free.id);
    await expect(previewDraftSend(principal, free.id)).rejects.toThrow("ডাউনলোড");
  });
});

describe("export", () => {
  it("renders Markdown in the Bangla house font; JSON as a code block", () => {
    const html = draftHtml({ title: "গল্প", body: "# শিরোনাম\n\n**মোটা** লেখা", isJson: false });
    expect(html).toContain('font-family: "Noto Sans Bengali"');
    expect(html).toContain("<h1>শিরোনাম</h1>");
    expect(html).toContain("<strong>মোটা</strong>");
    expect(draftHtml({ title: "b", body: '{"a":"<x>"}', isJson: true })).toContain("<pre>{&quot;a&quot;:&quot;&lt;x&gt;&quot;}</pre>");
  });

  it("asks LibreOffice for the format and returns its file", async () => {
    const calls: string[][] = [];
    const run = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      const outdir = args[args.indexOf("--outdir") + 1];
      await fs.writeFile(`${outdir}/draft.docx`, "DOCX-BYTES");
      return "";
    };
    const out = await exportDraft({ title: "t", body: "x", isJson: false, format: "docx" }, run);
    expect(out.toString()).toBe("DOCX-BYTES");
    expect(calls[0]).toEqual(expect.arrayContaining(["--headless", "--convert-to", "docx:MS Word 2007 XML"]));
  });
});
