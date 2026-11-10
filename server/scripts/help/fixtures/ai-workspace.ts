/**
 * Example data for the AI Workspace help guides (docs/prd-ai-workspace.md, D-#1240–#1257).
 * LOCAL ONLY (the same guard as scripts/help/fixture.ts). No AI key is set and no AI call is
 * made: the answers, drafts, the batch job and the Claude connection are written as rows.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/hc npx tsx scripts/help/fixtures/ai-workspace.ts --reset
 *
 * The base school, plus:
 *   - the workspace features switched on and the school AI budget raised to cover the caps;
 *   - teacher2@help.test may use the workspace and is an editor of the storybook project;
 *   - project "গল্পের বই — বর্ষার দিন" (owner: the Principal): instructions (2 versions),
 *     three files (two pinned), one chat with an answer, two drafts (one with two versions
 *     and not approved, one book-chapter patch approved), one draft started by Claude, one
 *     batch job part-way through, and this month's spend;
 *   - project "৩য় শ্রেণি গণিত — পাঠ পরিকল্পনা" (name protection on), empty;
 *   - one live Claude connection with a few calls.
 */
import crypto from "crypto";
import mongoose, { Types } from "mongoose";
import { seedBaseSchool } from "../fixture";
import { User } from "../../../src/modules/foundation/models/User";
import { AiFeatureSetting } from "../../../src/modules/platform/models/AiFeatureSetting";
import { AiBudgetSetting } from "../../../src/modules/platform/models/AiBudgetSetting";
import { AiUsage } from "../../../src/modules/platform/models/AiUsage";
import { AiProjectFile } from "../../../src/modules/ai-workspace/models/AiProjectFile";
import { AiAssistMessage } from "../../../src/modules/ai-assist/models/AiAssistMessage";
import { AiAssistSession } from "../../../src/modules/ai-assist/models/AiAssistSession";
import { AiDraft } from "../../../src/modules/ai-workspace/models/AiDraft";
import { AiJob } from "../../../src/modules/ai-workspace/models/AiJob";
import { AiOAuthClient, AiOAuthToken, AiMcpCall } from "../../../src/modules/ai-workspace/models/AiOAuth";
import { createAiProject, saveAiProjectInstructions, setAiProjectMembers } from "../../../src/modules/ai-workspace/services/AiProjectService";
import { startProjectChat } from "../../../src/modules/ai-workspace/services/ProjectChatService";
import { approveDraft, createDraft, saveDraftVersion } from "../../../src/modules/ai-workspace/services/DraftService";
import type { AuthPayload } from "../../../src/context";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) {
  console.error("Refusing: MONGODB_URI must be a local in-memory database (mongodb://127.0.0.1:<port>/…).");
  process.exit(2);
}

const STORY = `চরিত্র: মিতু (৮ বছর), তার ছোট ভাই রাফি, আর বুড়ো বটগাছ।
প্রতিটি অধ্যায় ৪০০–৫০০ শব্দ, সহজ বাংলা, ছোট বাক্য।
শেষে তিনটি প্রশ্ন: একটি মনে রাখার, একটি ভাবনার, একটি নিজের জীবনের সঙ্গে মেলানোর।`;

const ANSWER = `অধ্যায় ১ — মেঘের ছাতা

সকাল থেকেই আকাশ কালো। মিতু জানালার পাশে বসে দেখল, বটগাছের পাতাগুলো দুলছে। রাফি ছুটে এসে বলল, "আপু, বৃষ্টি আসছে!"

দুজনে মিলে উঠোনে কাগজের নৌকা ভাসানোর কথা ভাবল। কিন্তু মা বললেন, আগে বই গুছিয়ে রাখতে হবে…

প্রশ্ন
১. মিতু জানালা দিয়ে কী দেখল?
২. রাফি বৃষ্টির কথা শুনে খুশি হলো কেন?
৩. বৃষ্টির দিনে তুমি কী করতে ভালোবাসো?`;

(async () => {
  await mongoose.connect(uri);
  if (process.argv.includes("--reset")) await mongoose.connection.dropDatabase();
  const base = await seedBaseSchool();
  const principalId = base.users.principal as Types.ObjectId;
  const teacher2Id = base.users.teacher2 as Types.ObjectId;
  const principal: AuthPayload = { userId: principalId.toString(), role: "PRINCIPAL" };

  // Features on, budget above the caps (the settings screen warns otherwise).
  for (const feature of ["workspace_chat", "workspace_draft", "workspace_job", "workspace_ocr"]) {
    await AiFeatureSetting.create({ feature, enabled: true, provider: feature === "workspace_ocr" ? "gemini" : "deepseek", fallback: false, updatedBy: principalId });
  }
  await AiBudgetSetting.create({ name: "global", monthlyUsd: 25, alertPct: 80, workspaceMonthlyUsd: 10, updatedBy: principalId });

  await User.updateOne({ _id: teacher2Id }, { $addToSet: { grantedPermissions: "ai_workspace:use" } });

  const story = await createAiProject(principal, { name: "গল্পের বই — বর্ষার দিন", description: "২য়–৩য় শ্রেণির জন্য ছয় অধ্যায়ের গল্পের বই", nameProtection: false });
  await createAiProject(principal, { name: "৩য় শ্রেণি গণিত — পাঠ পরিকল্পনা", nameProtection: true });
  const pid = new Types.ObjectId(story.id);
  await setAiProjectMembers(principal, story.id, [
    { userId: principalId.toString(), role: "owner" },
    { userId: teacher2Id.toString(), role: "editor" },
  ]);
  await saveAiProjectInstructions(principal, story.id, "চরিত্র: মিতু আর রাফি। প্রতিটি অধ্যায় ৪০০–৫০০ শব্দ।", "প্রথম খসড়া");
  await saveAiProjectInstructions(principal, story.id, STORY, "প্রশ্নের নিয়ম যোগ");

  const file = (name: string, mime: string, text: string, tokenCount: number, extra: Record<string, unknown>) =>
    AiProjectFile.create({ projectId: pid, name, mime, sizeBytes: text.length * 3, status: "ready", text, tokenCount, uploadedBy: principalId, ...extra });
  await file("চরিত্র-তালিকা.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", STORY.repeat(40), 3400, { textSource: "text", tokenMethod: "tokenizer", pinned: true, order: 1 });
  await file("পুরোনো-গল্প-স্ক্যান.pdf", "application/pdf", ANSWER.repeat(30), 6100, { textSource: "tesseract", tokenMethod: "tokenizer", pinned: true, pages: 4, order: 2 });
  await file("শব্দভান্ডার.md", "text/markdown", "মেঘ, বৃষ্টি, নৌকা, উঠোন, বটগাছ\n".repeat(60), 900, { textSource: "text", tokenMethod: "estimate", pinned: false, order: 3 });

  const chat = await startProjectChat(principal, story.id, "অধ্যায় ১-এর খসড়া");
  const sid = new Types.ObjectId(chat.id);
  const t0 = new Date(Date.now() - 2 * 3600_000);
  await AiAssistMessage.create({ sessionId: sid, teacherId: principalId, projectId: pid, role: "user", text: "অধ্যায় ১ লিখে দাও: বৃষ্টির সকাল, মিতু আর রাফি কাগজের নৌকা বানাতে চায়।", at: t0, status: "done" });
  await AiAssistMessage.create({
    sessionId: sid, teacherId: principalId, projectId: pid, role: "assistant", text: ANSWER, at: new Date(t0.getTime() + 40_000), status: "done",
    modelName: "deepseek-flash", thinking: "low", runAt: "now", cacheHitTokens: 9200, cacheMissTokens: 310, outputTokens: 820, costUsd: 0.0021,
  });

  // The chat's size as DeepSeek last measured it (the context line under the price clock).
  await AiAssistSession.updateOne({ _id: sid }, { $set: { contextTokens: 10330 } });

  const d1 = await createDraft(principal, story.id, { title: "অধ্যায় ১ — মেঘের ছাতা", kind: "storybook", body: ANSWER, source: "chat" });
  await saveDraftVersion(principal, d1.id, { body: ANSWER.replace("সকাল থেকেই আকাশ কালো।", "সকাল থেকেই আকাশ মেঘে ঢাকা।"), note: "প্রথম লাইন বদল" });

  const patch = { book_id: "C3-BAN", patch_id: "p-03", task: "পাঠ ৩-এর গল্প সহজ করা", lessons: [{ lesson_no: 3 }] };
  const d2 = await createDraft(principal, story.id, { title: "বাংলা বই — পাঠ ৩ সহজ করা", kind: "book_chapter", body: JSON.stringify(patch, null, 1) });
  await approveDraft(principal, d2.id);

  const d3 = await createDraft(principal, story.id, { title: "অধ্যায় ২ — নৌকার দৌড়", kind: "storybook", body: "অধ্যায় ২ — নৌকার দৌড়\n\nবৃষ্টি থামতেই মিতু আর রাফি উঠোনে নামল…", origin: "claude" });

  const now = new Date();
  await AiJob.create({
    projectId: pid, title: "বাকি পাঁচ অধ্যায়", kind: "storybook", template: "গল্পের অধ্যায় লেখো: {{item}}", templateKey: "k", policyHash: "h",
    modelName: "deepseek-flash", thinking: "low", runAt: "offpeak", status: "running",
    estimate: { nowUsd: 0.02, offpeakUsd: 0.01, inputTokens: 52000, outputTokens: 5000 }, costUsd: 0.004, createdBy: principalId, origin: "app",
    heartbeatAt: now,
    items: [
      { value: "অধ্যায় ২ — নৌকার দৌড়", status: "done", attempts: 1, draftId: new Types.ObjectId(d3.id), costUsd: 0.002, startedAt: now, finishedAt: now },
      { value: "অধ্যায় ৩ — ঝড়ের রাত", status: "done", attempts: 1, draftId: new Types.ObjectId(d1.id), costUsd: 0.002, startedAt: now, finishedAt: now },
      { value: "অধ্যায় ৪ — বটগাছের গল্প", status: "running", attempts: 1, startedAt: now },
      { value: "অধ্যায় ৫ — রংধনু", status: "queued" },
      { value: "অধ্যায় ৬ — রোদ উঠল", status: "queued" },
    ],
  });

  // This month's spend (the AI usage report's per-project card).
  for (let i = 0; i < 6; i++) {
    await AiUsage.create({
      at: new Date(Date.now() - i * 3600_000), userId: principalId, role: "PRINCIPAL", branch: "sylhet", feature: i < 4 ? "workspace_chat" : "workspace_job",
      callId: crypto.randomUUID(), projectId: pid, provider: "deepseek", modelName: "deepseek-flash",
      cacheHitTokens: 9000, cacheMissTokens: 400, outputTokens: 800, costUsd: 0.0021, latencyMs: 9000, outcome: "ok",
    });
  }

  // One live Claude connection.
  const clientId = "claude-ai-example";
  await AiOAuthClient.create({ clientId, name: "Claude", redirectUris: ["https://claude.ai/api/mcp/auth_callback"] });
  const hash = () => crypto.randomBytes(24).toString("hex");
  await AiOAuthToken.create({
    accessHash: hash(), refreshHash: hash(), clientId, clientName: "Claude", userId: principalId,
    accessExpiresAt: new Date(Date.now() + 3600_000), refreshExpiresAt: new Date(Date.now() + 30 * 86400_000), lastUsedAt: new Date(Date.now() - 20 * 60_000),
  });
  for (const tool of ["list_projects", "get_project", "create_draft", "list_drafts"]) {
    await AiMcpCall.create({ at: new Date(), userId: principalId, clientName: "Claude", tool, ok: true, replyBytes: 4200, ms: 120 });
  }

  console.log("fixture: ai-workspace (2 projects, 3 files, 1 chat, 3 drafts, 1 batch job, 1 Claude connection)");
  console.log(JSON.stringify({ projectId: story.id, chatId: chat.id, draftVersions: d1.id, draftSend: d2.id, draftClaude: d3.id }));
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
