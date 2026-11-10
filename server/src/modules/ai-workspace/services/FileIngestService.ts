/**
 * FileIngestService (AI Workspace W-1, PRD §3, D-#1227 / D-#1230) — a project's knowledge files.
 *
 *   upload    the original goes to Drive (StoredFile `ai_workspace_file`), a PROCESSING row is
 *             written, and the upload answers; reading runs after it (OCR of a scan takes
 *             minutes) and turns the row READY (text + tokens) or FAILED (a Bangla reason).
 *   re-read   "tesseract" forces OCR on the VM (a Bangla PDF whose text layer came out
 *             garbled); "gemini" reads it with Gemini vision through aiSend("workspace_ocr")
 *             — metered, capped, OFF until the Principal switches it on, and refused for a
 *             project with name protection ON (a picture cannot be de-identified).
 *   pin       pinned files go into every message's cached prefix; pinning is refused when the
 *             prefix would pass the 400k-token limit.
 */
import { Types } from "mongoose";
import type { AuthPayload } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { queryPage, type Page, type PageArgs } from "../../../lib/paging";
import { StoredFile } from "../../platform/models/StoredFile";
import { deleteFromDrive, downloadFromDrive, uploadToDrive } from "../../platform/services/DriveStore";
import { writeAudit } from "../../platform/services/AuditService";
import { aiSend, AiFeatureOffError } from "../../platform/ai/aiRouter";
import { AiCapError } from "../../platform/services/AiUsageService";
import { WORKSPACE_PREFIX_MAX_TOKENS } from "../../platform/ai/aiPrices";
import { AiProjectFile, AI_FILE_MAX_TEXT_CHARS, type IAiProjectFile } from "../models/AiProjectFile";
import { AiAssistSession } from "../../ai-assist/models/AiAssistSession";
import type { IAiProject } from "../models/AiProject";
import { AI_FILE_MAX_BYTES, canonicalMime, FileReadError, readFileText, readKindOf, type CommandRunner } from "./fileText";
import { countTokens, type PythonRunner } from "./tokenCount";
import { AiWorkspaceError, contextBudgetOf, loadProject, overBudgetMessage } from "./AiProjectService";

export type ReadMode = "auto" | "tesseract" | "gemini";

/** Gemini's inline request limit is 20 MB; base64 adds a third. */
const GEMINI_MAX_BYTES = 14 * 1024 * 1024;

export const OCR_INSTRUCTIONS = `You transcribe documents for a Bangladeshi school. Write out ALL the text in the file exactly as it appears — Bangla stays Bangla, English stays English, numbers as written. Keep the reading order. Write headings as Markdown headings, lists as lists and tables as Markdown tables. Mark each new page with a line "--- পৃষ্ঠা N ---" when the file has pages. Do not translate, summarise, correct or comment; for an unreadable word write [অস্পষ্ট].`;

const BN = {
  tooBig: `ফাইলটি ${AI_FILE_MAX_BYTES / 1024 / 1024} MB-এর বেশি বড়।`,
  noMime: "এই ধরনের ফাইল পড়া যায় না — md, txt, docx, pdf, xlsx, csv, json বা ছবি দিন।",
  geminiOnlyScan: "Gemini দিয়ে শুধু PDF বা ছবি পড়া যায়।",
  geminiTooBig: "ফাইলটি Gemini-কে পাঠানোর জন্য বড় (১৪ MB-এর বেশি)।",
  geminiNameProtection: "নাম সুরক্ষা চালু থাকা প্রকল্পের ফাইল Gemini-কে পাঠানো যায় না — ছবি থেকে নাম লুকানো যায় না।",
  geminiOff: "Gemini দিয়ে পড়া এখন বন্ধ — প্রধান শিক্ষক এআই সেটিং থেকে চালু করতে পারেন।",
  geminiFailed: "Gemini থেকে লেখা পাওয়া যায়নি — একটু পরে আবার চেষ্টা করুন।",
  driveDown: "ফাইল রাখার জায়গায় (Drive) এখন পৌঁছানো যাচ্ছে না — একটু পরে আবার চেষ্টা করুন।",
  busy: "ফাইলটি এখনো পড়া হচ্ছে।",
  tooLong: "ফাইলে লেখা খুব বেশি — ভাগ করে দিন।",
} as const;

export interface AiProjectFileView {
  id: string;
  projectId: string;
  name: string;
  mime: string;
  sizeBytes: number;
  storedFileId: string | null;
  status: IAiProjectFile["status"];
  error: string | null;
  textSource: IAiProjectFile["textSource"] | null;
  pages: number | null;
  chars: number;
  tokenCount: number;
  tokenMethod: IAiProjectFile["tokenMethod"] | null;
  pinned: boolean;
  order: number;
  at: Date;
}

export function fileView(f: IAiProjectFile): AiProjectFileView {
  return {
    id: f._id.toString(),
    projectId: f.projectId.toString(),
    name: f.name,
    mime: f.mime,
    sizeBytes: f.sizeBytes,
    storedFileId: f.storedFileId?.toString() ?? null,
    status: f.status,
    error: f.error ?? null,
    textSource: f.textSource ?? null,
    pages: f.pages ?? null,
    chars: (f.text ?? "").length,
    tokenCount: f.tokenCount,
    tokenMethod: f.tokenMethod ?? null,
    pinned: f.pinned,
    order: f.order,
    at: f.at,
  };
}

export interface IngestDeps {
  run?: CommandRunner;
  python?: PythonRunner;
  send?: typeof aiSend;
  upload?: typeof uploadToDrive;
  download?: typeof downloadFromDrive;
}

/** The file row the caller reaches with at least `need` in its project. */
async function loadFile(authIn: AuthPayload | null, fileId: string, need: "viewer" | "editor") {
  const file = Types.ObjectId.isValid(fileId) ? await AiProjectFile.findById(fileId) : null;
  if (!file) throw new AiWorkspaceError("ফাইলটি পাওয়া যায়নি");
  const { auth, project } = await loadProject(authIn, file.projectId.toString(), need);
  return { auth, project, file };
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export async function startAiProjectFileUpload(
  authIn: AuthPayload | null,
  input: { projectId: string; name: string; mime: string; data: Buffer; sessionId?: string | null },
  deps: IngestDeps = {},
): Promise<{ file: AiProjectFileView; done: Promise<void> }> {
  const { auth, project } = await loadProject(authIn, input.projectId, "editor");
  if (input.data.length === 0 || input.data.length > AI_FILE_MAX_BYTES) throw new AiWorkspaceError(BN.tooBig);
  const name = input.name.trim().slice(0, 300) || "file";
  if (!readKindOf(input.mime, name)) throw new AiWorkspaceError(BN.noMime);
  // A file attached to one chat (W-2): the chat must be this project's.
  if (input.sessionId) {
    const chat = Types.ObjectId.isValid(input.sessionId) ? await AiAssistSession.findById(input.sessionId).select("projectId").lean() : null;
    if (!chat || chat.projectId?.toString() !== project._id.toString()) throw new AiWorkspaceError("আলাপটি পাওয়া যায়নি");
  }

  let driveFileId: string;
  try {
    driveFileId = await (deps.upload ?? uploadToDrive)({ name, mime: input.mime, data: input.data, year: String(new Date().getFullYear()), subfolder: "ai-workspace" });
  } catch {
    throw new AiWorkspaceError(BN.driveDown);
  }
  const stored = await StoredFile.create({
    kind: "ai_workspace_file",
    mime: input.mime,
    sizeBytes: input.data.length,
    originalName: name,
    driveFileId,
    uploadedBy: new Types.ObjectId(auth.userId),
  });
  const last = (await AiProjectFile.findOne({ projectId: project._id, sessionId: null }).sort({ order: -1 }).select("order").lean()) as { order: number } | null;
  const file = await AiProjectFile.create({
    projectId: project._id,
    sessionId: input.sessionId && Types.ObjectId.isValid(input.sessionId) ? new Types.ObjectId(input.sessionId) : null,
    name,
    mime: input.mime,
    sizeBytes: input.data.length,
    storedFileId: stored._id,
    status: "processing",
    text: "",
    tokenCount: 0,
    // A new file is pinned unless that would pass the prefix limit (checked when it is read).
    pinned: !input.sessionId,
    order: (last?.order ?? 0) + 1,
    uploadedBy: new Types.ObjectId(auth.userId),
  });
  await writeAudit({ eventKind: "AI_PROJECT_FILE_CHANGED", actorId: auth.userId, actorRole: auth.role, targetKind: "AiProject", targetId: project._id.toString(), meta: { action: "add", fileId: file._id.toString(), name, bytes: input.data.length } });
  const done = readInto(file._id, project, input.data, "auto", auth, deps);
  return { file: fileView(file), done };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

async function geminiRead(file: IAiProjectFile, project: IAiProject, data: Buffer, auth: AuthPayload, send: typeof aiSend): Promise<string> {
  const mime = canonicalMime(file.mime, file.name);
  const kind = readKindOf(file.mime, file.name);
  if (kind !== "pdf" && kind !== "image") throw new FileReadError(BN.geminiOnlyScan);
  if (project.nameProtection) throw new FileReadError(BN.geminiNameProtection);
  if (data.length > GEMINI_MAX_BYTES) throw new FileReadError(BN.geminiTooBig);
  try {
    const out = await send(
      "workspace_ocr",
      {
        stablePrefix: OCR_INSTRUCTIONS,
        variablePart: "Transcribe this file.",
        files: [{ mime, data }],
        maxOutputTokens: 32_000,
        reasoning: "off",
        timeoutMs: 240_000,
      },
      {
        userId: auth.userId,
        role: auth.role,
        refType: "AiProjectFile",
        refId: file._id.toString(),
        projectId: project._id.toString(),
        projectMonthlyUsd: project.monthlyCapUsd ?? null,
      },
    );
    return out.result.text;
  } catch (e) {
    if (e instanceof AiFeatureOffError) throw new FileReadError(BN.geminiOff);
    if (e instanceof AiCapError) throw new FileReadError(e.message);
    throw new FileReadError(BN.geminiFailed);
  }
}

/** Reads `data` into the row; never throws (a failure is written onto the row). */
async function readInto(fileId: Types.ObjectId, project: IAiProject, data: Buffer, mode: ReadMode, auth: AuthPayload, deps: IngestDeps): Promise<void> {
  const file = await AiProjectFile.findById(fileId);
  if (!file) return;
  try {
    let text: string;
    let textSource: "text" | "tesseract" | "gemini";
    let pages: number | null = null;
    let note: string | null = null;
    if (mode === "gemini") {
      text = (await geminiRead(file, project, data, auth, deps.send ?? aiSend)).trim();
      textSource = "gemini";
    } else {
      const r = await readFileText({ data, mime: file.mime, name: file.name, forceOcr: mode === "tesseract" }, deps.run);
      ({ text, textSource, pages, note } = r);
    }
    if (!text) throw new FileReadError("ফাইলে পড়ার মতো কোনো লেখা পাওয়া যায়নি।");
    if (text.length > AI_FILE_MAX_TEXT_CHARS) throw new FileReadError(BN.tooLong);
    const { counts, method } = await countTokens([text], deps.python);
    const tokens = counts[0];
    let pinned = file.pinned;
    let error: string | null = note;
    if (pinned) {
      const budget = await contextBudgetOf(project);
      // The budget already counts this row's OLD tokens if it was ready + pinned before.
      const without = budget.totalTokens - (file.status === "ready" ? file.tokenCount : 0);
      if (without + tokens > WORKSPACE_PREFIX_MAX_TOKENS) {
        pinned = false;
        error = `${overBudgetMessage(without + tokens)} ফাইলটি আনপিন রাখা হলো।`;
      }
    }
    await AiProjectFile.updateOne(
      { _id: file._id },
      { $set: { status: "ready", text, textSource, pages, tokenCount: tokens, tokenMethod: method, pinned, error } },
    );
  } catch (e) {
    const message = e instanceof FileReadError || e instanceof AiWorkspaceError ? e.message : "ফাইলটি পড়া যায়নি।";
    if (!(e instanceof FileReadError)) console.warn("[ai-workspace] reading failed:", (e as Error)?.message);
    await AiProjectFile.updateOne({ _id: file._id }, { $set: { status: "failed", error: message } }).catch(() => undefined);
  }
}

/** Reads the file again from its Drive original: auto, Tesseract (force OCR) or Gemini. */
export async function rereadAiProjectFile(
  authIn: AuthPayload | null,
  fileId: string,
  modeIn: string,
  deps: IngestDeps = {},
): Promise<{ file: AiProjectFileView; done: Promise<void> }> {
  const mode = (["auto", "tesseract", "gemini"] as const).find((m) => m === modeIn);
  if (!mode) throw new AiWorkspaceError("পড়ার পদ্ধতি সঠিক নয়");
  const { auth, project, file } = await loadFile(authIn, fileId, "editor");
  if (file.status === "processing") throw new AiWorkspaceError(BN.busy);
  // Refuse the Gemini cases up front so the person sees why at once.
  if (mode === "gemini") {
    const kind = readKindOf(file.mime, file.name);
    if (kind !== "pdf" && kind !== "image") throw new AiWorkspaceError(BN.geminiOnlyScan);
    if (project.nameProtection) throw new AiWorkspaceError(BN.geminiNameProtection);
  }
  const stored = file.storedFileId ? await StoredFile.findById(file.storedFileId).lean() : null;
  if (!stored) throw new AiWorkspaceError("মূল ফাইলটি পাওয়া যায়নি — আবার আপলোড করুন");
  let data: Buffer;
  try {
    data = await (deps.download ?? downloadFromDrive)(stored.driveFileId);
  } catch {
    throw new AiWorkspaceError(BN.driveDown);
  }
  await AiProjectFile.updateOne({ _id: file._id }, { $set: { status: "processing", error: null } });
  await writeAudit({ eventKind: "AI_PROJECT_FILE_CHANGED", actorId: auth.userId, actorRole: auth.role, targetKind: "AiProject", targetId: project._id.toString(), meta: { action: "reread", mode, fileId, name: file.name } });
  const done = readInto(file._id, project, data, mode, auth, deps);
  const fresh = await AiProjectFile.findById(file._id);
  return { file: fileView(fresh!), done };
}

// ---------------------------------------------------------------------------
// List / text / change / remove
// ---------------------------------------------------------------------------

export async function aiProjectFilesPage(authIn: AuthPayload | null, projectId: string, args: PageArgs): Promise<Page<AiProjectFileView>> {
  const { project } = await loadProject(authIn, projectId, "viewer");
  return queryPage(AiProjectFile, { projectId: project._id, sessionId: null }, { order: 1, _id: 1 }, args, (docs) => (docs as unknown as IAiProjectFile[]).map(fileView), 50);
}

/** Files attached to one chat only (W-2) — they follow the pinned files in that chat's prompt. */
export async function aiChatFiles(authIn: AuthPayload | null, sessionId: string): Promise<AiProjectFileView[]> {
  const chat = Types.ObjectId.isValid(sessionId) ? await AiAssistSession.findById(sessionId).select("projectId").lean() : null;
  if (!chat?.projectId) throw new AiWorkspaceError("আলাপটি পাওয়া যায়নি");
  await loadProject(authIn, chat.projectId.toString(), "viewer");
  const rows = await AiProjectFile.find({ sessionId: chat._id }).sort({ order: 1, _id: 1 }).limit(50);
  return rows.map(fileView);
}

export interface AiProjectFileText {
  fileId: string;
  name: string;
  offset: number;
  text: string;
  totalChars: number;
}

/** A slice of a file's text (by character range, so a long file never travels whole). */
export async function aiProjectFileText(authIn: AuthPayload | null, fileId: string, offsetIn?: number | null, limitIn?: number | null): Promise<AiProjectFileText> {
  const { file } = await loadFile(authIn, fileId, "viewer");
  const total = (file.text ?? "").length;
  const offset = Math.max(0, Math.min(total, Math.floor(offsetIn ?? 0)));
  const limit = Math.max(1, Math.min(100_000, Math.floor(limitIn ?? 20_000)));
  return { fileId, name: file.name, offset, text: (file.text ?? "").slice(offset, offset + limit), totalChars: total };
}

export async function updateAiProjectFile(
  authIn: AuthPayload | null,
  fileId: string,
  input: { pinned?: boolean | null; order?: number | null; name?: string | null },
): Promise<AiProjectFileView> {
  const { auth, project, file } = await loadFile(authIn, fileId, "editor");
  const set: Record<string, unknown> = {};
  if (input.name !== undefined && input.name !== null) {
    const n = input.name.trim();
    if (!n) throw new AiWorkspaceError("ফাইলের একটি নাম দিন");
    set.name = n.slice(0, 300);
  }
  if (input.order !== undefined && input.order !== null) {
    if (!Number.isInteger(input.order) || input.order < 0) throw new AiWorkspaceError("ক্রম সঠিক নয়");
    set.order = input.order;
  }
  if (input.pinned !== undefined && input.pinned !== null && input.pinned !== file.pinned) {
    if (input.pinned) {
      if (file.status !== "ready") throw new AiWorkspaceError("ফাইলটি পড়া শেষ হলে পিন করা যাবে");
      const budget = await contextBudgetOf(project);
      if (budget.totalTokens + file.tokenCount > WORKSPACE_PREFIX_MAX_TOKENS) throw new AiWorkspaceError(overBudgetMessage(budget.totalTokens + file.tokenCount));
    }
    set.pinned = input.pinned;
  }
  if (Object.keys(set).length === 0) return fileView(file);
  await AiProjectFile.updateOne({ _id: file._id }, { $set: set });
  await writeAudit({ eventKind: "AI_PROJECT_FILE_CHANGED", actorId: auth.userId, actorRole: auth.role, targetKind: "AiProject", targetId: project._id.toString(), meta: { action: "update", fileId, ...set } });
  return fileView((await AiProjectFile.findById(file._id))!);
}

/** Removes the file, its stored original and (best effort) the Drive copy. */
export async function deleteAiProjectFile(authIn: AuthPayload | null, fileId: string): Promise<boolean> {
  const { auth, project, file } = await loadFile(authIn, fileId, "editor");
  const stored = file.storedFileId ? await StoredFile.findById(file.storedFileId).lean() : null;
  await AiProjectFile.deleteOne({ _id: file._id });
  if (stored) {
    await StoredFile.deleteOne({ _id: stored._id });
    void deleteFromDrive(stored.driveFileId).catch(() => undefined);
  }
  await writeAudit({ eventKind: "AI_PROJECT_FILE_CHANGED", actorId: auth.userId, actorRole: auth.role, targetKind: "AiProject", targetId: project._id.toString(), meta: { action: "remove", fileId, name: file.name } });
  return true;
}

/** Read gate for GET /files/:id on an `ai_workspace_file`: a member of its project. */
export async function assertAiWorkspaceFileReadAccess(authIn: AuthPayload | null, storedFileId: string): Promise<void> {
  const file = await AiProjectFile.findOne({ storedFileId: new Types.ObjectId(storedFileId) }).select("projectId").lean();
  if (!file) throw new ForbiddenError("ফাইলটি পাওয়া যায়নি");
  await loadProject(authIn, file.projectId.toString(), "viewer");
}
