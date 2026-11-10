/**
 * AI Workspace W-1 (docs/prd-ai-workspace.md §3; D-#1200–#1231), on an in-memory MongoDB.
 *   • reading files: text / docx (headings, lists, tables) / xlsx / text PDF / scanned PDF and
 *     pictures through OCR — every external tool stubbed; a missing tool gives a Bangla reason
 *   • token counts: the Python tokenizer when it answers, the character estimate otherwise
 *   • project instructions are AiPolicy versions under project:<id>; the rule screens refuse them
 *   • who reaches what: ai_workspace:use + membership roles; ai_workspace:admin reaches all
 *   • upload → PROCESSING → READY with tokens; pinning stops at the 400k-token prefix
 *   • Gemini reading: refused with name protection ON, off-switch message, files sent inline
 *   • caps: the project cap and the workspace cap sit inside the school budget; the budget
 *     screen flags caps that add up to more than the budget (D-#1225)
 * Every name here is invented.
 */
jest.mock("../modules/platform/services/DriveStore", () => ({
  uploadToDrive: jest.fn(async () => "drive-file-1"),
  downloadFromDrive: jest.fn(async () => Buffer.from("# পুরনো\nলেখা")),
  deleteFromDrive: jest.fn(async () => undefined),
  DriveUnavailableError: class DriveUnavailableError extends Error {},
}));

import { promises as fs } from "fs";
import path from "path";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { User } from "../modules/foundation/models/User";
import { AiPolicy } from "../modules/platform/models/AiPolicy";
import { AiUsage } from "../modules/platform/models/AiUsage";
import { AiProjectFile } from "../modules/ai-workspace/models/AiProjectFile";
import { aiPolicySummaries, saveAiPolicyVersion } from "../modules/platform/services/AiPolicyService";
import { assertWithinCaps, AiCapError } from "../modules/platform/services/AiUsageService";
import { aiBudgetView, aiFeatureConfig, setAiBudget } from "../modules/platform/services/AiSettingService";
import { AiFeatureOffError } from "../modules/platform/ai/aiRouter";
import { geminiBody } from "../modules/platform/ai/geminiProvider";
import { DeepseekProvider } from "../modules/platform/ai/deepseekProvider";
import {
  aiProject,
  aiProjectContextBudget,
  aiProjectInstructions,
  aiProjectsPage,
  aiWorkspaceMemberCandidates,
  createAiProject,
  saveAiProjectInstructions,
  setAiProjectMembers,
  updateAiProject,
} from "../modules/ai-workspace/services/AiProjectService";
import {
  aiProjectFilesPage,
  aiProjectFileText,
  rereadAiProjectFile,
  startAiProjectFileUpload,
  updateAiProjectFile,
} from "../modules/ai-workspace/services/FileIngestService";
import {
  decodeText,
  docxXmlText,
  FILE_READ_MESSAGES,
  readFileText,
  readKindOf,
  ToolMissingOrFailed,
  xlsxToText,
  type CommandRunner,
} from "../modules/ai-workspace/services/fileText";
import { countTokens, estimateTokens } from "../modules/ai-workspace/services/tokenCount";
import type { AuthPayload } from "../context";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const principal: AuthPayload = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" };
const coordinator: AuthPayload = { userId: new Types.ObjectId().toString(), role: "TEACHER", grantedPermissions: ["ai_workspace:use"] };
const teacher2: AuthPayload = { userId: new Types.ObjectId().toString(), role: "TEACHER", grantedPermissions: ["ai_workspace:use"] };
const plainTeacher: AuthPayload = { userId: new Types.ObjectId().toString(), role: "TEACHER" };
const noPython = async () => {
  throw new Error("python missing");
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  await User.create([
    { _id: principal.userId, role: "PRINCIPAL", name: "Head Teacher", phone: "01700000001", passwordHash: "x" },
    { _id: coordinator.userId, role: "TEACHER", name: "Rafiq Coordinator", phone: "01700000002", passwordHash: "x", grantedPermissions: ["ai_workspace:use"] },
    { _id: teacher2.userId, role: "TEACHER", name: "Nadia Writer", phone: "01700000003", passwordHash: "x", grantedPermissions: ["ai_workspace:use"] },
    { _id: plainTeacher.userId, role: "TEACHER", name: "Plain Teacher", phone: "01700000004", passwordHash: "x" },
  ]);
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

// ---------------------------------------------------------------------------
// Reading files
// ---------------------------------------------------------------------------

async function makeDocx(bodyXml: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${bodyXml}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}
const p = (text: string, pPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

describe("reading files", () => {
  it("knows the kinds by extension first, then MIME", () => {
    expect(readKindOf("application/octet-stream", "notes.MD")).toBe("text");
    expect(readKindOf("application/octet-stream", "plan.docx")).toBe("docx");
    expect(readKindOf("image/heic-whatever", "scan")).toBe("image");
    expect(readKindOf("application/zip", "x.zip")).toBeNull();
  });

  it("decodes UTF-8 with or without a BOM and UTF-16 with one", () => {
    expect(decodeText(Buffer.from("﻿পাঠ ১", "utf8"))).toBe("পাঠ ১");
    expect(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("ক খ", "utf16le")]))).toBe("ক খ");
  });

  it("reads a docx in order: headings, list items, a table, entities", async () => {
    const docx = await makeDocx(
      p("পাঠ পরিকল্পনা", '<w:pStyle w:val="Heading1"/>') +
        p("উদ্দেশ্য &amp; লক্ষ্য") +
        p("প্রথম ধাপ", "<w:numPr><w:ilvl w:val=\"0\"/></w:numPr>") +
        `<w:tbl><w:tr><w:tc>${p("সময়")}</w:tc><w:tc>${p("কাজ")}</w:tc></w:tr><w:tr><w:tc>${p("৫ মিনিট")}</w:tc><w:tc>${p("পরিচিতি")}</w:tc></w:tr></w:tbl>` +
        "<w:p/>" +
        p("শেষ"),
    );
    expect(await docxXmlText(docx)).toBe("# পাঠ পরিকল্পনা\nউদ্দেশ্য & লক্ষ্য\n- প্রথম ধাপ\n\n| সময় | কাজ |\n| ৫ মিনিট | পরিচিতি |\n\nশেষ");
  });

  it("reads every sheet of an xlsx as CSV under its name", async () => {
    const wb = new ExcelJS.Workbook();
    const a = wb.addWorksheet("অধ্যায়");
    a.addRow(["নং", "শিরোনাম"]);
    a.addRow([1, "আমাদের গ্রাম, আমাদের দেশ"]);
    wb.addWorksheet("খালি");
    const data = Buffer.from(await wb.xlsx.writeBuffer());
    expect(await xlsxToText(data)).toBe('## অধ্যায়\nনং,শিরোনাম\n1,"আমাদের গ্রাম, আমাদের দেশ"');
  });

  it("a PDF with a text layer is read as text; a scan goes through pdftoppm + tesseract", async () => {
    const calls: string[] = [];
    const textPdf: CommandRunner = async (cmd) => {
      calls.push(cmd);
      return "প্রথম পৃষ্ঠার লেখা যথেষ্ট লম্বা যাতে এটি স্ক্যান না মনে হয় ক খ গ ঘ\fদ্বিতীয় পৃষ্ঠার লেখাও যথেষ্ট লম্বা যাতে এটি স্ক্যান না মনে হয় চ ছ\f";
    };
    const r1 = await readFileText({ data: Buffer.from("%PDF"), mime: "application/pdf", name: "book.pdf" }, textPdf);
    expect(r1).toMatchObject({ textSource: "text", pages: 2 });
    expect(r1.text).toContain("--- পৃষ্ঠা 2 ---");
    expect(calls).toEqual(["pdftotext"]);

    const scan: CommandRunner = async (cmd, args) => {
      if (cmd === "pdftotext") return "\f \f";
      if (cmd === "pdftoppm") {
        const prefix = args[args.length - 1];
        await fs.writeFile(`${prefix}-1.png`, "x");
        await fs.writeFile(`${prefix}-2.png`, "x");
        return "";
      }
      if (cmd === "tesseract") return `OCR ${path.basename(args[0])}`;
      throw new Error(cmd);
    };
    const r2 = await readFileText({ data: Buffer.from("%PDF"), mime: "application/pdf", name: "scan.pdf" }, scan);
    expect(r2).toMatchObject({ textSource: "tesseract", pages: 2 });
    expect(r2.text).toBe("--- পৃষ্ঠা 1 ---\nOCR p-1.png\n\n--- পৃষ্ঠা 2 ---\nOCR p-2.png");
  });

  it("a picture is OCR'd; a missing Tesseract gives the Bangla reason", async () => {
    const ok: CommandRunner = async (cmd, args) => (cmd === "tesseract" && args.includes("ben+eng") ? "ছবির লেখা" : "");
    expect(await readFileText({ data: Buffer.from("x"), mime: "image/jpeg", name: "board.jpg" }, ok)).toMatchObject({ text: "ছবির লেখা", textSource: "tesseract" });
    const missing: CommandRunner = async (cmd) => {
      throw new ToolMissingOrFailed(cmd, true, "ENOENT");
    };
    await expect(readFileText({ data: Buffer.from("x"), mime: "image/png", name: "a.png" }, missing)).rejects.toThrow(FILE_READ_MESSAGES.noTesseract);
  });

  it("an empty file or an unknown type is refused", async () => {
    await expect(readFileText({ data: Buffer.from("  \n "), mime: "text/plain", name: "a.txt" })).rejects.toThrow(FILE_READ_MESSAGES.empty);
    await expect(readFileText({ data: Buffer.from("x"), mime: "application/zip", name: "a.zip" })).rejects.toThrow(FILE_READ_MESSAGES.unsupported);
  });
});

describe("token counts", () => {
  it("estimates Bangla at ÷2.6 and other text at ÷4", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("কখগঘঙ")).toBe(Math.ceil(5 / 2.6));
    expect(estimateTokens("abcdefgh")).toBe(2);
  });
  it("uses the tokenizer's counts when Python answers, the estimate otherwise", async () => {
    expect(await countTokens(["ক", "ab"], async () => JSON.stringify({ counts: [3, 1], method: "tokenizer" }))).toEqual({ counts: [3, 1], method: "tokenizer" });
    expect(await countTokens(["abcd"], noPython)).toEqual({ counts: [1], method: "estimate" });
    expect(await countTokens(["abcd"], async () => '{"counts":[1,2]}')).toEqual({ counts: [1], method: "estimate" });
  });
});

// ---------------------------------------------------------------------------
// Projects, members, instructions
// ---------------------------------------------------------------------------

describe("projects", () => {
  let projectId = "";

  it("someone without ai_workspace:use is refused", async () => {
    await expect(createAiProject(plainTeacher, { name: "X", nameProtection: false })).rejects.toThrow("অনুমতি নেই");
  });

  it("a creator owns the project; defaults come from the workspace (thinking high)", async () => {
    const p1 = await createAiProject(coordinator, { name: "  C1 বাংলা   পাঠ পরিকল্পনা ", nameProtection: false });
    projectId = p1.id;
    expect(p1).toMatchObject({ name: "C1 বাংলা পাঠ পরিকল্পনা", myRole: "owner", defaultModel: "deepseek-flash", defaultThinking: "high", nameProtection: false, monthlyCapUsd: null });
    expect(p1.members).toEqual([{ userId: coordinator.userId, name: "Rafiq Coordinator", role: "owner" }]);
    await expect(createAiProject(coordinator, { name: "Y", nameProtection: true })).rejects.toThrow("নাম দিন");
    await expect(createAiProject(coordinator, { name: "Other", nameProtection: true, defaultModel: "gpt-4" })).rejects.toThrow("মডেলটি");
  });

  it("members see their projects; others do not; the admin sees all", async () => {
    await createAiProject(teacher2, { name: "Storybooks", nameProtection: false });
    expect((await aiProjectsPage(coordinator, {})).rows.map((r) => r.name)).toEqual(["C1 বাংলা পাঠ পরিকল্পনা"]);
    expect((await aiProjectsPage(principal, {})).total).toBe(2);
    await expect(aiProject(teacher2, projectId)).rejects.toThrow("পাওয়া যায়নি");
    expect((await aiProject(principal, projectId)).myRole).toBe("owner");
  });

  it("roles: a viewer reads, an editor writes instructions, only an owner changes members", async () => {
    await setAiProjectMembers(coordinator, projectId, [
      { userId: coordinator.userId, role: "owner" },
      { userId: teacher2.userId, role: "viewer" },
    ]);
    expect(await aiProjectInstructions(teacher2, projectId)).toBeNull();
    await expect(saveAiProjectInstructions(teacher2, projectId, "নিয়ম")).rejects.toThrow("লেখার অনুমতি নেই");
    await setAiProjectMembers(coordinator, projectId, [
      { userId: coordinator.userId, role: "owner" },
      { userId: teacher2.userId, role: "editor" },
    ]);
    const v1 = await saveAiProjectInstructions(teacher2, projectId, "## নিয়ম\nবাংলায় লিখুন।");
    expect(v1).toMatchObject({ version: 1 });
    expect(v1.hash).toMatch(new RegExp(`^project:${projectId}@v1#[0-9a-f]{12}$`));
    await expect(setAiProjectMembers(teacher2, projectId, [{ userId: teacher2.userId, role: "owner" }])).rejects.toThrow("মালিক");
    await expect(setAiProjectMembers(coordinator, projectId, [{ userId: coordinator.userId, role: "editor" }])).rejects.toThrow("অন্তত একজন মালিক");
    await expect(setAiProjectMembers(coordinator, projectId, [{ userId: coordinator.userId, role: "owner" }, { userId: new Types.ObjectId().toString(), role: "viewer" }])).rejects.toThrow("সক্রিয় স্টাফ");
  });

  it("instructions: a new version becomes current; the same text is refused; the rule screens never list project keys", async () => {
    const v2 = await saveAiProjectInstructions(coordinator, projectId, "## নিয়ম\nবাংলায় লিখুন। ছোট বাক্য।");
    expect(v2.version).toBe(2);
    expect((await aiProjectInstructions(coordinator, projectId))?.version).toBe(2);
    expect(await AiPolicy.countDocuments({ key: `project:${projectId}`, active: true })).toBe(1);
    await expect(saveAiProjectInstructions(coordinator, projectId, "## নিয়ম\nবাংলায় লিখুন। ছোট বাক্য।")).rejects.toThrow("পার্থক্য নেই");
    expect((await aiPolicySummaries(principal)).map((s) => s.key)).toEqual(["comment_standard", "ct_comment_standard", "assistant_rules"]);
    await expect(saveAiPolicyVersion(principal, { key: `project:${projectId}`, body: "x".repeat(30) })).rejects.toThrow("চেনা যায়নি");
    await expect(AiPolicy.create({ key: "project:nope", version: 1, body: "x", bodyHash: "x", active: false })).rejects.toThrow();
  });

  it("only the owner changes settings; the cap can be set and cleared", async () => {
    await expect(updateAiProject(teacher2, projectId, { nameProtection: true })).rejects.toThrow("মালিক");
    expect(await updateAiProject(coordinator, projectId, { monthlyCapUsd: 2.5, defaultThinking: "low" })).toMatchObject({ monthlyCapUsd: 2.5, defaultThinking: "low" });
    expect((await updateAiProject(coordinator, projectId, { clearMonthlyCap: true })).monthlyCapUsd).toBeNull();
  });

  it("member candidates are the holders of ai_workspace:use / admin", async () => {
    const names = (await aiWorkspaceMemberCandidates(coordinator)).map((c) => c.name);
    expect(names).toEqual(["Head Teacher", "Nadia Writer", "Rafiq Coordinator"]);
  });
});

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

describe("files", () => {
  let projectId = "";
  beforeAll(async () => {
    projectId = (await createAiProject(coordinator, { name: "Files project", nameProtection: false })).id;
  });

  it("upload → processing → ready with text and estimated tokens; text is read by range", async () => {
    const { file, done } = await startAiProjectFileUpload(coordinator, { projectId, name: "ref.md", mime: "text/markdown", data: Buffer.from("# রেফারেন্স\nকখগ abcd") }, { python: noPython });
    expect(file.status).toBe("processing");
    await done;
    const [row] = (await aiProjectFilesPage(coordinator, projectId, {})).rows;
    expect(row).toMatchObject({ name: "ref.md", status: "ready", textSource: "text", tokenMethod: "estimate", pinned: true });
    expect(row.tokenCount).toBe(estimateTokens("# রেফারেন্স\nকখগ abcd"));
    expect(await aiProjectFileText(coordinator, row.id, 2, 7)).toMatchObject({ text: "রেফারেন্স".slice(0, 7), totalChars: "# রেফারেন্স\nকখগ abcd".length });
    const budget = await aiProjectContextBudget(coordinator, projectId);
    expect(budget).toMatchObject({ fileTokens: row.tokenCount, pinnedFiles: 1, warn: false, over: false });
  });

  it("a viewer cannot upload; an unknown type is refused before anything is stored", async () => {
    await expect(startAiProjectFileUpload(teacher2, { projectId, name: "a.md", mime: "text/markdown", data: Buffer.from("x") })).rejects.toThrow("পাওয়া যায়নি");
    await expect(startAiProjectFileUpload(coordinator, { projectId, name: "a.zip", mime: "application/zip", data: Buffer.from("x") })).rejects.toThrow("পড়া যায় না");
  });

  it("a file past the 400k-token prefix is kept unpinned with the reason; pinning it again is refused", async () => {
    const big = "ক".repeat(1_100_000); // ≈ 423k estimated tokens
    const { done, file } = await startAiProjectFileUpload(coordinator, { projectId, name: "big.txt", mime: "text/plain", data: Buffer.from(big) }, { python: noPython });
    await done;
    const row = await AiProjectFile.findById(file.id).lean();
    expect(row).toMatchObject({ status: "ready", pinned: false });
    expect(row?.error).toContain("আনপিন");
    await expect(updateAiProjectFile(coordinator, file.id, { pinned: true })).rejects.toThrow("আনপিন করুন");
  });

  it("a failed read is written onto the row", async () => {
    const run: CommandRunner = async (cmd) => {
      throw new ToolMissingOrFailed(cmd, true, "ENOENT");
    };
    const { done, file } = await startAiProjectFileUpload(coordinator, { projectId, name: "photo.png", mime: "image/png", data: Buffer.from("png") }, { run, python: noPython });
    await done;
    expect(await AiProjectFile.findById(file.id).lean()).toMatchObject({ status: "failed", error: FILE_READ_MESSAGES.noTesseract });
  });

  it("Gemini reading: refused with name protection ON; off-switch message; the file goes inline to workspace_ocr", async () => {
    const photo = await AiProjectFile.findOne({ name: "photo.png" }).lean();
    const id = photo!._id.toString();

    await updateAiProject(coordinator, projectId, { nameProtection: true });
    await expect(rereadAiProjectFile(coordinator, id, "gemini")).rejects.toThrow("নাম সুরক্ষা");
    await updateAiProject(coordinator, projectId, { nameProtection: false, monthlyCapUsd: 3 });

    const off = jest.fn(async () => {
      throw new AiFeatureOffError("workspace_ocr");
    });
    const r1 = await rereadAiProjectFile(coordinator, id, "gemini", { send: off as never, python: noPython, download: async () => Buffer.from("png") });
    await r1.done;
    expect((await AiProjectFile.findById(id).lean())?.error).toContain("বন্ধ");

    const send = jest.fn(async () => ({
      result: { provider: "gemini", model: "gemini-flash-latest", resolvedModel: "g", text: "বোর্ডের লেখা", usage: { cacheHitTokens: 0, cacheMissTokens: 1, outputTokens: 1, reasoningTokens: null }, finishReason: "stop", latencyMs: 1 },
      attempts: [],
      callId: "c",
    }));
    const r2 = await rereadAiProjectFile(coordinator, id, "gemini", { send: send as never, python: noPython, download: async () => Buffer.from("png-bytes") });
    expect(r2.file.status).toBe("processing");
    await r2.done;
    expect(await AiProjectFile.findById(id).lean()).toMatchObject({ status: "ready", text: "বোর্ডের লেখা", textSource: "gemini", error: null });
    const [feature, input, ctx] = send.mock.calls[0] as unknown as [string, { files: Array<{ mime: string; data: Buffer }> }, Record<string, unknown>];
    expect(feature).toBe("workspace_ocr");
    expect(input.files[0]).toMatchObject({ mime: "image/png" });
    expect(input.files[0].data.toString()).toBe("png-bytes");
    expect(ctx).toMatchObject({ projectId, projectMonthlyUsd: 3, refType: "AiProjectFile", refId: id });
    await expect(rereadAiProjectFile(coordinator, (await AiProjectFile.findOne({ name: "ref.md" }).lean())!._id.toString(), "gemini")).rejects.toThrow("শুধু PDF বা ছবি");
  });
});

// ---------------------------------------------------------------------------
// Providers, settings, caps
// ---------------------------------------------------------------------------

describe("providers, settings and caps", () => {
  it("Gemini sends files inline before the instruction; DeepSeek refuses files without calling out", async () => {
    const body = geminiBody({ stablePrefix: "P", variablePart: "Transcribe", maxOutputTokens: 10, reasoning: "off", files: [{ mime: "image/png", data: Buffer.from("ab") }] }) as {
      contents: Array<{ parts: Array<Record<string, unknown>> }>;
    };
    expect(body.contents[0].parts).toEqual([{ inlineData: { mimeType: "image/png", data: Buffer.from("ab").toString("base64") } }, { text: "Transcribe" }]);
    const fetchImpl = jest.fn();
    await expect(new DeepseekProvider("k", fetchImpl as never).send({ stablePrefix: "P", variablePart: "x", maxOutputTokens: 1, reasoning: "off", files: [{ mime: "image/png", data: Buffer.from("a") }] }, "deepseek-flash")).rejects.toThrow("cannot read");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("workspace_ocr answers from Gemini with fallback OFF and is switched off until the Principal turns it on", async () => {
    expect(await aiFeatureConfig("workspace_ocr")).toMatchObject({ provider: "gemini", fallback: false, enabled: false, monthlyUsd: 10 });
    expect(await aiFeatureConfig("assistant")).toMatchObject({ provider: "deepseek", fallback: true });
  });

  it("the budget screen holds the workspace cap + defaults and flags caps above the school budget", async () => {
    const b = await aiBudgetView(principal);
    expect(b).toMatchObject({ monthlyUsd: 8, workspaceMonthlyUsd: 10, workspaceDefaultModel: "deepseek-flash", workspaceDefaultThinking: "high", capsTotalUsd: 18, capsOverBudget: true });
    expect(await setAiBudget(principal, { monthlyUsd: 20, workspaceDefaultThinking: "low" })).toMatchObject({ capsOverBudget: false, workspaceDefaultThinking: "low" });
    await expect(setAiBudget(principal, { workspaceDefaultModel: "gpt-4" })).rejects.toThrow("মডেলটি");
    await setAiBudget(principal, { workspaceDefaultThinking: "high" });
  });

  it("the project cap, then the workspace cap, refuse before sending", async () => {
    const pid = new Types.ObjectId().toString();
    const ctx = { feature: "workspace_ocr", userId: coordinator.userId, callId: "x", provider: "gemini" as const, model: "g" };
    await AiUsage.create({ at: new Date(), branch: "sylhet", feature: "workspace_ocr", callId: "a", attempt: 1, provider: "gemini", modelName: "g", costUsd: 1.5, outcome: "ok", projectId: pid });
    await expect(assertWithinCaps({ ...ctx, projectId: pid, projectMonthlyUsd: 1 })).rejects.toMatchObject({ cap: "project" });
    await assertWithinCaps({ ...ctx, projectId: pid, projectMonthlyUsd: 5 });
    await setAiBudget(principal, { workspaceMonthlyUsd: 1 });
    const err = await assertWithinCaps({ ...ctx, projectId: pid, projectMonthlyUsd: 5 }).catch((e) => e);
    expect(err).toBeInstanceOf(AiCapError);
    expect(err).toMatchObject({ cap: "workspace" });
    expect(await AiUsage.countDocuments({ outcome: "capped", projectId: pid })).toBe(2);
  });
});
