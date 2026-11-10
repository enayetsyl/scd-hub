/**
 * DraftService (AI Workspace W-3, docs/prd-ai-workspace.md §5).
 *
 *   create      by hand, or "save as draft" from a chat answer (a ```json block in the answer
 *               becomes the plan JSON / bank JSON / patch JSON for those kinds)
 *   version     every edit adds a version; nothing is edited in place (D-#1211)
 *   approve     owner: locks the current version (approvedVersion). A later change adds a
 *               version and the draft is a draft again until approved again.
 *   revise      "revise with notes": DeepSeek writes the next version from the project's own
 *               cached prefix + the current draft + the notes — now, or queued for off-peak
 *   export      docx / PDF, no AI (draftExport.ts, GET /files/ai-draft/:id/export)
 *   send        an APPROVED, unchanged draft into its pipeline, by someone holding that
 *               pipeline's permission, after a preview that names what it replaces (D-#1229).
 *               The pipeline's own validator decides; nothing is written around it (D-#1212).
 */
import { Types } from "mongoose";
import { callerHasPermission } from "@scd/shared";
import type { AuthPayload } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { queryPage, type Page, type PageArgs } from "../../../lib/paging";
import { User } from "../../foundation/models/User";
import { AiAssistMessage } from "../../ai-assist/models/AiAssistMessage";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { buildEnvelopeFromPair, currentVersionKey, importContentFiles, runImportGate } from "../../content/services/ContentService";
import { isBookDbReady } from "../../../bookDb";
import { submitPatch, type PatchEnvelope } from "../../support-book/services/MergeService";
import { writeAudit } from "../../platform/services/AuditService";
import { aiSend, AiFeatureOffError, AiModelOverrideError } from "../../platform/ai/aiRouter";
import { AiProviderError } from "../../platform/ai/provider";
import { isPeak, nextOffPeak } from "../../platform/ai/aiPrices";
import { DEEPSEEK_MODELS } from "../../platform/ai/deepseekProvider";
import { reidentify, DeidentifyError, type DeidScope } from "../../platform/ai/deidentify";
import { AiCapError } from "../../platform/services/AiUsageService";
import { AiUsage } from "../../platform/models/AiUsage";
import { AiProject, type IAiProject } from "../models/AiProject";
import { AiDraft, AiDraftVersion, AI_DRAFT_KINDS, AI_PIPELINE_KINDS, type AiDraftKind, type IAiDraft, type IAiDraftVersion } from "../models/AiDraft";
import { AiWorkspaceError, loadProject } from "./AiProjectService";
import { projectPrefix, protectParts } from "./ProjectChatService";

const MAX_BODY = 1_000_000;
export const DRAFT_MAX_OUTPUT_TOKENS = 32_000;
const REVISE_TIMEOUT_MS = 15 * 60 * 1000;

export const REVISE_INSTRUCTIONS = `Revise the CURRENT DRAFT above following the notes below. Keep everything the notes do not ask to change. Return the WHOLE revised draft, in the same format as the current draft, and nothing else — no introduction, no comments. If the draft has a JSON part, return it in one \`\`\`json block followed by the Markdown part.

NOTES:
`;

const BN = {
  notFound: "খসড়াটি পাওয়া যায়নি",
  kind: "খসড়ার ধরন সঠিক নয়",
  title: "খসড়ার একটি শিরোনাম দিন",
  empty: "খসড়া খালি রাখা যাবে না",
  tooBig: "খসড়া খুব বড়",
  same: "আগের সংস্করণের সঙ্গে কোনো পার্থক্য নেই",
  json: "এই ধরনের খসড়ায় বৈধ JSON লাগে",
  planJson: "পাঠ পরিকল্পনার খসড়ায় পরিকল্পনার JSON আর Markdown — দুটোই লাগে",
  notApproved: "শুধু অনুমোদিত খসড়া পাঠানো যায় — আগে অনুমোদন দিন",
  changed: "অনুমোদনের পরে নতুন সংস্করণ হয়েছে — আবার অনুমোদন দিন",
  exportOnly: "এই ধরনের খসড়া শুধু ডাউনলোড করা যায়",
  noPerm: "এই জায়গায় পাঠানোর অনুমতি নেই",
  confirm: "পাঠানোর আগে নিশ্চিত করুন — আগের বিষয়বস্তু প্রতিস্থাপিত হবে",
  curation: "প্রশ্নব্যাংকের জন্য একটি কিউরেশন ট্যাগ বেছে নিন",
  noBook: "বই-প্রোডাকশন ডেটাবেস কনফিগার করা হয়নি — বইয়ের অধ্যায় পাঠানো যাবে না",
  busy: "এই খসড়ার একটি সংশোধন এখনো চলছে",
  notes: "কী বদলাতে হবে লিখুন",
  run: "কখন চলবে — এখন না কম দামে — বেছে নিন",
  model: "এই মডেলটি কর্মক্ষেত্রে চলে না",
  off: "খসড়া সংশোধন এখন বন্ধ — প্রধান শিক্ষক এআই সেটিং থেকে চালু করতে পারেন",
  down: "এআই এখন সাড়া দিচ্ছে না — একটু পরে আবার চেষ্টা করুন",
} as const;

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface DraftView {
  id: string;
  projectId: string;
  title: string;
  kind: AiDraftKind;
  status: "draft" | "approved";
  currentVersion: number;
  approvedVersion: number | null;
  approvedByName: string | null;
  approvedAt: Date | null;
  createdByName: string | null;
  origin: "app" | "claude";
  revise: { status: string; runAfter: Date | null; error: string | null; notes: string } | null;
  sends: Array<{ pipeline: string; version: number; ok: boolean; summary: string; at: Date }>;
  canSend: boolean;
  /** W-6 pilot score (owner). */
  review: { score: string; note: string | null; byName: string | null; at: Date; version: number } | null;
  updatedAt: Date;
}

export interface DraftVersionView {
  id: string;
  version: number;
  body: string;
  planJson: string | null;
  note: string | null;
  source: string;
  policyHash: string | null;
  costUsd: number | null;
  createdByName: string | null;
  origin: "app" | "claude";
  at: Date;
}

async function names(ids: Array<Types.ObjectId | null | undefined>): Promise<Map<string, string>> {
  const u = [...new Set(ids.filter(Boolean).map(String))];
  return new Map(u.length ? (await User.find({ _id: { $in: u } }).select("name").lean()).map((x) => [x._id.toString(), x.name]) : []);
}

function draftView(d: IAiDraft, n: Map<string, string>): DraftView {
  const approved = d.approvedVersion !== null && d.approvedVersion !== undefined && d.approvedVersion === d.currentVersion;
  return {
    id: d._id.toString(),
    projectId: d.projectId.toString(),
    title: d.title,
    kind: d.kind,
    status: approved ? "approved" : "draft",
    currentVersion: d.currentVersion,
    approvedVersion: d.approvedVersion ?? null,
    approvedByName: d.approvedBy ? n.get(d.approvedBy.toString()) ?? null : null,
    approvedAt: d.approvedAt ?? null,
    createdByName: n.get(d.createdBy.toString()) ?? null,
    origin: d.origin,
    revise: d.revise ? { status: d.revise.status, runAfter: d.revise.runAfter ?? null, error: d.revise.error ?? null, notes: d.revise.notes } : null,
    sends: (d.sends ?? []).map((s) => ({ pipeline: s.pipeline, version: s.version, ok: s.ok, summary: s.summary, at: s.at })),
    canSend: approved && AI_PIPELINE_KINDS.includes(d.kind),
    review: d.review ? { score: d.review.score, note: d.review.note ?? null, byName: n.get(d.review.by.toString()) ?? null, at: d.review.at, version: d.review.version } : null,
    updatedAt: d.updatedAt,
  };
}

function versionView(v: IAiDraftVersion, n: Map<string, string>): DraftVersionView {
  return {
    id: v._id.toString(),
    version: v.version,
    body: v.body,
    planJson: v.planJson ?? null,
    note: v.note ?? null,
    source: v.source,
    policyHash: v.policyHash ?? null,
    costUsd: v.costUsd ?? null,
    createdByName: v.createdBy ? n.get(v.createdBy.toString()) ?? null : null,
    origin: v.origin,
    at: v.at,
  };
}

export async function loadDraft(authIn: AuthPayload | null, draftId: string, need: "viewer" | "editor" | "owner") {
  const d = Types.ObjectId.isValid(draftId) ? await AiDraft.findById(draftId) : null;
  if (!d) throw new AiWorkspaceError(BN.notFound);
  const { auth, project } = await loadProject(authIn, d.projectId.toString(), need);
  return { auth, project, draft: d };
}

// ---------------------------------------------------------------------------
// Content rules
// ---------------------------------------------------------------------------

/** The first ```json fenced block, and the text without it. */
export function splitJsonFence(text: string): { json: string | null; rest: string } {
  const m = /```json\s*\n([\s\S]*?)\n```/i.exec(text);
  if (!m) return { json: null, rest: text.trim() };
  return { json: m[1].trim(), rest: (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim() };
}

const isJsonKind = (k: AiDraftKind) => k === "question_bank" || k === "book_chapter";

function checkContent(kind: AiDraftKind, body: string, planJson: string | null | undefined): { body: string; planJson: string | null } {
  const b = (body ?? "").replace(/\r\n/g, "\n").trim();
  if (b.length > MAX_BODY || (planJson ?? "").length > MAX_BODY) throw new AiWorkspaceError(BN.tooBig);
  if (isJsonKind(kind)) {
    if (!b) throw new AiWorkspaceError(BN.empty);
    try {
      JSON.parse(b);
    } catch {
      throw new AiWorkspaceError(BN.json);
    }
    return { body: b, planJson: null };
  }
  if (kind === "lesson_plan") {
    const pj = (planJson ?? "").trim();
    if (!b || !pj) throw new AiWorkspaceError(BN.planJson);
    try {
      JSON.parse(pj);
    } catch {
      throw new AiWorkspaceError(BN.json);
    }
    return { body: b, planJson: pj };
  }
  if (!b) throw new AiWorkspaceError(BN.empty);
  return { body: b, planJson: null };
}

/** Splits an AI answer into the draft's parts for its kind (a JSON block → the JSON part). */
export function contentFromAnswer(kind: AiDraftKind, text: string): { body: string; planJson: string | null } {
  if (kind === "lesson_plan") {
    const s = splitJsonFence(text);
    return { body: s.rest, planJson: s.json };
  }
  if (isJsonKind(kind)) {
    const s = splitJsonFence(text);
    return { body: s.json ?? text.trim(), planJson: null };
  }
  return { body: text.trim(), planJson: null };
}

// ---------------------------------------------------------------------------
// Create / list / read / version / approve
// ---------------------------------------------------------------------------

async function addVersion(
  draft: IAiDraft,
  input: { body: string; planJson: string | null; note?: string | null; source: IAiDraftVersion["source"]; createdBy?: string | null; origin?: "app" | "claude"; policyHash?: string | null; costUsd?: number | null },
): Promise<IAiDraftVersion> {
  for (let tries = 0; tries < 3; tries++) {
    const latest = await AiDraftVersion.findOne({ draftId: draft._id }).sort({ version: -1 }).select("version body planJson").lean();
    if (latest && latest.body === input.body && (latest.planJson ?? null) === input.planJson) throw new AiWorkspaceError(BN.same);
    const version = (latest?.version ?? 0) + 1;
    try {
      const v = await AiDraftVersion.create({
        draftId: draft._id,
        projectId: draft.projectId,
        version,
        body: input.body,
        planJson: input.planJson,
        note: input.note?.trim().slice(0, 500) || null,
        source: input.source,
        policyHash: input.policyHash ?? null,
        costUsd: input.costUsd ?? null,
        createdBy: input.createdBy && Types.ObjectId.isValid(input.createdBy) ? new Types.ObjectId(input.createdBy) : null,
        origin: input.origin ?? "app",
        at: new Date(),
      });
      await AiDraft.updateOne({ _id: draft._id }, { $set: { currentVersion: version } });
      draft.currentVersion = version;
      return v;
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e;
    }
  }
  throw new AiWorkspaceError("সংরক্ষণ করা যায়নি — আবার চেষ্টা করুন");
}

function cleanTitle(t: string | null | undefined): string {
  const s = (t ?? "").trim().replace(/\s+/g, " ");
  if (s.length < 2) throw new AiWorkspaceError(BN.title);
  return s.slice(0, 200);
}

function checkKind(k: string): AiDraftKind {
  if (!(AI_DRAFT_KINDS as readonly string[]).includes(k)) throw new AiWorkspaceError(BN.kind);
  return k as AiDraftKind;
}

export async function createDraft(
  authIn: AuthPayload | null,
  projectId: string,
  input: { title: string; kind: string; body: string; planJson?: string | null; note?: string | null; origin?: "app" | "claude"; jobId?: string | null; source?: IAiDraftVersion["source"]; policyHash?: string | null; costUsd?: number | null },
): Promise<DraftView> {
  const { auth, project } = await loadProject(authIn, projectId, "editor");
  const kind = checkKind(input.kind);
  const content = checkContent(kind, input.body, input.planJson);
  const draft = await AiDraft.create({
    projectId: project._id,
    title: cleanTitle(input.title),
    kind,
    currentVersion: 1,
    createdBy: new Types.ObjectId(auth.userId),
    origin: input.origin ?? "app",
    jobId: input.jobId && Types.ObjectId.isValid(input.jobId) ? new Types.ObjectId(input.jobId) : null,
    sends: [],
  });
  draft.currentVersion = 0;
  await addVersion(draft, { ...content, note: input.note, source: input.source ?? "manual", createdBy: auth.userId, origin: input.origin, policyHash: input.policyHash, costUsd: input.costUsd });
  await writeAudit({ eventKind: "AI_DRAFT_CHANGED", actorId: auth.userId, actorRole: auth.role, targetKind: "AiDraft", targetId: draft._id.toString(), meta: { action: "create", kind, projectId } });
  return draftView(draft, await names([draft.createdBy]));
}

/** "Save as draft" from an AI answer in a project chat. */
export async function saveDraftFromMessage(authIn: AuthPayload | null, messageId: string, input: { title: string; kind: string }): Promise<DraftView> {
  const m = Types.ObjectId.isValid(messageId) ? await AiAssistMessage.findById(messageId).lean() : null;
  if (!m || !m.projectId || m.role !== "assistant" || (m.status ?? "done") !== "done") throw new AiWorkspaceError("শুধু শেষ হওয়া এআই উত্তর খসড়া করা যায়");
  const kind = checkKind(input.kind);
  const content = contentFromAnswer(kind, m.text);
  const view = await createDraft(authIn, m.projectId.toString(), { title: input.title, kind, ...content, source: "chat", policyHash: m.policyHash ?? null, costUsd: m.costUsd ?? null });
  await AiDraft.updateOne({ _id: view.id }, { $set: { sourceSessionId: m.sessionId, sourceMessageId: m._id } });
  return view;
}

export async function draftsPage(authIn: AuthPayload | null, projectId: string, args: PageArgs & { archived?: boolean | null }): Promise<Page<DraftView>> {
  const { project } = await loadProject(authIn, projectId, "viewer");
  return queryPage(AiDraft, { projectId: project._id, archived: !!args.archived }, { updatedAt: -1 }, args, async (docs) => {
    const ds = docs as unknown as IAiDraft[];
    const n = await names(ds.flatMap((d) => [d.createdBy, d.approvedBy, d.review?.by]));
    return ds.map((d) => draftView(d, n));
  }, 20);
}

export async function draft(authIn: AuthPayload | null, draftId: string): Promise<{ draft: DraftView; version: DraftVersionView }> {
  const { draft: d } = await loadDraft(authIn, draftId, "viewer");
  const v = await AiDraftVersion.findOne({ draftId: d._id, version: d.currentVersion }).lean();
  const n = await names([d.createdBy, d.approvedBy, v?.createdBy, d.review?.by]);
  return { draft: draftView(d, n), version: versionView(v as unknown as IAiDraftVersion, n) };
}

export async function draftVersion(authIn: AuthPayload | null, draftId: string, version: number): Promise<DraftVersionView> {
  const { draft: d } = await loadDraft(authIn, draftId, "viewer");
  const v = await AiDraftVersion.findOne({ draftId: d._id, version }).lean();
  if (!v) throw new AiWorkspaceError(BN.notFound);
  return versionView(v as unknown as IAiDraftVersion, await names([v.createdBy]));
}

export async function draftVersionsPage(authIn: AuthPayload | null, draftId: string, args: PageArgs): Promise<Page<DraftVersionView>> {
  const { draft: d } = await loadDraft(authIn, draftId, "viewer");
  return queryPage(AiDraftVersion, { draftId: d._id }, { version: -1 }, args, async (docs) => {
    const vs = docs as unknown as IAiDraftVersion[];
    const n = await names(vs.map((v) => v.createdBy));
    // The list does not carry whole bodies (open one version to read it).
    return vs.map((v) => ({ ...versionView(v, n), body: v.body.slice(0, 300), planJson: null }));
  }, 20);
}

export async function saveDraftVersion(authIn: AuthPayload | null, draftId: string, input: { body: string; planJson?: string | null; note?: string | null }): Promise<DraftView> {
  const { auth, draft: d } = await loadDraft(authIn, draftId, "editor");
  if (d.revise && (d.revise.status === "running" || d.revise.status === "queued")) throw new AiWorkspaceError(BN.busy);
  const content = checkContent(d.kind, input.body, input.planJson);
  await addVersion(d, { ...content, note: input.note, source: "manual", createdBy: auth.userId });
  await writeAudit({ eventKind: "AI_DRAFT_CHANGED", actorId: auth.userId, actorRole: auth.role, targetKind: "AiDraft", targetId: draftId, meta: { action: "version", version: d.currentVersion } });
  return (await draft(auth, draftId)).draft;
}

/** Owner (or the Principal): locks the current version. */
export async function approveDraft(authIn: AuthPayload | null, draftId: string): Promise<DraftView> {
  const { auth, draft: d } = await loadDraft(authIn, draftId, "owner");
  await AiDraft.updateOne({ _id: d._id }, { $set: { approvedVersion: d.currentVersion, approvedBy: new Types.ObjectId(auth.userId), approvedAt: new Date() } });
  await writeAudit({ eventKind: "AI_DRAFT_CHANGED", actorId: auth.userId, actorRole: auth.role, targetKind: "AiDraft", targetId: draftId, meta: { action: "approve", version: d.currentVersion } });
  return (await draft(auth, draftId)).draft;
}

/**
 * The pilot score (W-6, PRD §8): the owner judges a draft — usable as-is / minor fixes /
 * rewrite — against a Claude-made one on the same instructions. Analytics count them (W-7).
 */
export async function scoreDraft(authIn: AuthPayload | null, draftId: string, input: { score: string; note?: string | null }): Promise<DraftView> {
  const { auth, draft: d } = await loadDraft(authIn, draftId, "owner");
  if (!["usable", "minor", "rewrite"].includes(input.score)) throw new AiWorkspaceError("মূল্যায়ন সঠিক নয়");
  await AiDraft.updateOne(
    { _id: d._id },
    { $set: { review: { score: input.score, note: input.note?.trim().slice(0, 1000) || null, by: new Types.ObjectId(auth.userId), at: new Date(), version: d.currentVersion } } },
  );
  await writeAudit({ eventKind: "AI_DRAFT_CHANGED", actorId: auth.userId, actorRole: auth.role, targetKind: "AiDraft", targetId: draftId, meta: { action: "score", score: input.score, version: d.currentVersion } });
  return (await draft(auth, draftId)).draft;
}

export async function setDraftArchived(authIn: AuthPayload | null, draftId: string, archived: boolean): Promise<DraftView> {
  const { auth, draft: d } = await loadDraft(authIn, draftId, "editor");
  await AiDraft.updateOne({ _id: d._id }, { $set: { archived } });
  return (await draft(auth, draftId)).draft;
}

// ---------------------------------------------------------------------------
// Revise with notes (AI)
// ---------------------------------------------------------------------------

export interface DraftDeps {
  send?: typeof aiSend;
  scope?: () => Promise<DeidScope>;
  now?: () => Date;
}

export async function reviseDraft(
  authIn: AuthPayload | null,
  draftId: string,
  input: { notes: string; model: string; thinking: string; runAt: string; origin?: "app" | "claude" },
  deps: DraftDeps = {},
): Promise<{ draft: DraftView; done: Promise<void> }> {
  const { auth, project, draft: d } = await loadDraft(authIn, draftId, "editor");
  if (project.archived) throw new AiWorkspaceError("আর্কাইভ করা প্রকল্পে কাজ চালানো যায় না");
  if (d.revise && (d.revise.status === "running" || d.revise.status === "queued")) throw new AiWorkspaceError(BN.busy);
  const notes = (input.notes ?? "").trim();
  if (notes.length < 2) throw new AiWorkspaceError(BN.notes);
  if (!(DEEPSEEK_MODELS as readonly string[]).includes(input.model)) throw new AiWorkspaceError(BN.model);
  if (!["off", "low", "high"].includes(input.thinking)) throw new AiWorkspaceError("চিন্তার মাত্রা সঠিক নয়");
  if (input.runAt !== "now" && input.runAt !== "offpeak") throw new AiWorkspaceError(BN.run);
  const now = deps.now?.() ?? new Date();
  const wait = input.runAt === "offpeak" && isPeak("deepseek", now);
  await AiDraft.updateOne(
    { _id: d._id },
    {
      $set: {
        revise: {
          status: wait ? "queued" : "running",
          notes,
          model: input.model,
          thinking: input.thinking,
          runAt: input.runAt,
          runAfter: wait ? nextOffPeak("deepseek", now) : null,
          error: null,
          requestedBy: new Types.ObjectId(auth.userId),
          at: now,
        },
      },
    },
  );
  const done = wait ? Promise.resolve() : runRevision(d._id, deps, input.origin ?? "app");
  return { draft: (await draft(auth, draftId)).draft, done };
}

/** Writes the next version from the AI; never throws (the reason goes on `revise`). */
export async function runRevision(draftId: Types.ObjectId, deps: DraftDeps = {}, origin: "app" | "claude" = "app"): Promise<void> {
  const d = await AiDraft.findOneAndUpdate({ _id: draftId, "revise.status": { $in: ["queued", "running"] } }, { $set: { "revise.status": "running", "revise.runAfter": null } }, { new: true });
  if (!d || !d.revise) return;
  const fail = (error: string) => AiDraft.updateOne({ _id: d._id }, { $set: { "revise.status": "failed", "revise.error": error } });
  try {
    const project = await AiProject.findById(d.projectId);
    const current = await AiDraftVersion.findOne({ draftId: d._id, version: d.currentVersion }).lean();
    const requester = await User.findById(d.revise.requestedBy).select("role").lean();
    if (!project || !current) return void (await fail(BN.notFound));
    const prefix = await projectPrefix(project);
    const draftText = current.planJson ? `\`\`\`json\n${current.planJson}\n\`\`\`\n\n${current.body}` : isJsonKind(d.kind) ? `\`\`\`json\n${current.body}\n\`\`\`` : current.body;
    let parts = [prefix.stablePrefix, `# CURRENT DRAFT (${d.kind}, version ${current.version})\n\n${draftText}`, REVISE_INSTRUCTIONS + d.revise.notes];
    let map: Record<string, string> = {};
    if (project.nameProtection) {
      try {
        const p = await protectParts(parts, deps.scope);
        parts = p.texts;
        map = p.map;
      } catch (e) {
        if (e instanceof DeidentifyError) return void (await fail(e.message));
        throw e;
      }
    }
    const out = await (deps.send ?? aiSend)(
      "workspace_draft",
      { stablePrefix: parts[0], context: parts[1], variablePart: parts[2], maxOutputTokens: DRAFT_MAX_OUTPUT_TOKENS, reasoning: d.revise.thinking, timeoutMs: REVISE_TIMEOUT_MS },
      {
        userId: d.revise.requestedBy.toString(),
        role: requester?.role ?? null,
        refType: "AiDraft",
        refId: d._id.toString(),
        policyHash: prefix.policy?.hash ?? null,
        projectId: project._id.toString(),
        projectMonthlyUsd: project.monthlyCapUsd ?? null,
        modelOverride: d.revise.model,
      },
    );
    const text = project.nameProtection ? reidentify(out.result.text, map) : out.result.text;
    const content = contentFromAnswer(d.kind, text);
    let checked: { body: string; planJson: string | null };
    try {
      checked = checkContent(d.kind, content.body, content.planJson ?? current.planJson);
    } catch (e) {
      return void (await fail(`এআই-এর উত্তর ব্যবহার করা গেল না: ${(e as Error).message}`));
    }
    const cost = (await AiUsage.find({ callId: out.callId }).select("costUsd").lean()).reduce((s, r) => s + (r.costUsd ?? 0), 0);
    await addVersion(d, { ...checked, note: `সংশোধন: ${d.revise.notes.slice(0, 400)}`, source: "revise", createdBy: d.revise.requestedBy.toString(), origin, policyHash: prefix.policy?.hash ?? null, costUsd: Math.round(cost * 1e6) / 1e6 });
    await AiDraft.updateOne({ _id: d._id }, { $set: { revise: null } });
  } catch (e) {
    if (e instanceof AiFeatureOffError) return void (await fail(BN.off));
    if (e instanceof AiCapError) return void (await fail(e.message));
    if (e instanceof AiModelOverrideError) return void (await fail(BN.model));
    if (e instanceof AiWorkspaceError) return void (await fail(e.message));
    if (e instanceof AiProviderError) return void (await fail(e.kind === "truncated" ? "উত্তর সীমা ছাড়িয়েছে — খসড়াটি ভাগ করে সংশোধন করুন" : BN.down));
    console.warn("[ai-workspace] revision failed:", (e as Error)?.message);
    await fail(BN.down).catch(() => undefined);
  }
}

/** Cancels a revision waiting for off-peak. */
export async function cancelDraftRevision(authIn: AuthPayload | null, draftId: string): Promise<DraftView> {
  const { auth, draft: d } = await loadDraft(authIn, draftId, "editor");
  await AiDraft.updateOne({ _id: d._id, "revise.status": "queued" }, { $set: { "revise.status": "stopped", "revise.error": "থামানো হয়েছে" } });
  return (await draft(auth, draftId)).draft;
}

/** The off-peak queue's share (called with the chat queue). */
export async function processQueuedRevisions(now: Date = new Date(), deps: DraftDeps = {}): Promise<number> {
  if (isPeak("deepseek", now)) return 0;
  const due = await AiDraft.find({ "revise.status": "queued", "revise.runAfter": { $lte: now } }).sort({ "revise.runAfter": 1 }).limit(4).select("_id origin").lean();
  for (const d of due) await runRevision(d._id, deps, d.origin);
  return due.length;
}

// ---------------------------------------------------------------------------
// Send to a pipeline (D-#1212 / D-#1229)
// ---------------------------------------------------------------------------

const PIPELINE_PERMISSION = { lesson_plan: "lesson_plans:import", question_bank: "question_bank:import", book_chapter: "book_production:author" } as const;

export interface PipelinePreview {
  pipeline: "lesson_plan" | "question_bank" | "book_chapter";
  /** The validator's dry-run verdict (lesson plans); null where there is no dry run. */
  verdict: "PASS" | "FAIL" | null;
  failChecks: string[];
  /** What the send would replace, in words; null when it adds something new. */
  replaces: string | null;
  /** What the send would add, in words. */
  adds: string;
}

async function approvedContent(authIn: AuthPayload | null, draftId: string) {
  const { auth, project, draft: d } = await loadDraft(authIn, draftId, "editor");
  if (!AI_PIPELINE_KINDS.includes(d.kind)) throw new AiWorkspaceError(BN.exportOnly);
  if (d.approvedVersion === null || d.approvedVersion === undefined) throw new AiWorkspaceError(BN.notApproved);
  if (d.approvedVersion !== d.currentVersion) throw new AiWorkspaceError(BN.changed);
  const pipeline = d.kind as PipelinePreview["pipeline"];
  if (!callerHasPermission(auth, PIPELINE_PERMISSION[pipeline])) throw new ForbiddenError(BN.noPerm);
  const v = await AiDraftVersion.findOne({ draftId: d._id, version: d.approvedVersion }).lean();
  if (!v) throw new AiWorkspaceError(BN.notFound);
  return { auth, project, draft: d, version: v, pipeline };
}

async function authorName(userId: string): Promise<string> {
  return (await User.findById(userId).select("name").lean())?.name ?? "AI Workspace";
}

const stemOf = (draftId: string, version: number) => `aiws-${draftId}-v${version}`;

function describeArtifact(a: { docType?: string; classLevel?: number; subject?: string; address?: { number?: unknown; title?: unknown }; importedAt?: Date } | null): string | null {
  if (!a) return null;
  const parts = [`C${a.classLevel ?? "?"}`, a.subject ?? "?", a.docType ?? "", a.address?.number !== undefined ? `অধ্যায় ${String(a.address.number)}` : "", a.address?.title ? String(a.address.title) : ""].filter(Boolean);
  return `${parts.join(" · ")}${a.importedAt ? ` (আমদানি ${new Date(a.importedAt).toISOString().slice(0, 10)})` : ""}`;
}

export async function previewDraftSend(authIn: AuthPayload | null, draftId: string): Promise<PipelinePreview> {
  const { auth, draft: d, version: v, pipeline } = await approvedContent(authIn, draftId);
  if (pipeline === "lesson_plan") {
    const stem = stemOf(d._id.toString(), v.version);
    const built = await buildEnvelopeFromPair(stem, v.planJson ?? "", v.body, `${stem}.json`, await authorName(auth.userId));
    if (!built.ok || !built.envelope) return { pipeline, verdict: "FAIL", failChecks: [built.error ?? "envelope could not be built"], replaces: null, adds: "" };
    const gate = await runImportGate(built.envelope);
    const prior = await ContentArtifact.findOne(currentVersionKey(built.envelope)).lean();
    const e = built.envelope as { doc_type?: string; class_level?: number; subject?: string; address?: { number?: unknown; title?: unknown } };
    return {
      pipeline,
      verdict: gate.verdict,
      failChecks: gate.failChecks,
      replaces: describeArtifact(prior as never),
      adds: describeArtifact({ docType: e.doc_type, classLevel: e.class_level, subject: e.subject, address: e.address }) ?? "",
    };
  }
  if (pipeline === "question_bank") {
    const bank = JSON.parse(v.body) as { questions?: unknown[]; stimuli?: unknown[] };
    return { pipeline, verdict: null, failChecks: [], replaces: null, adds: `${bank.questions?.length ?? 0}টি প্রশ্ন, ${bank.stimuli?.length ?? 0}টি উদ্দীপক (একই qid থাকলে আগেরটি প্রতিস্থাপিত হবে)` };
  }
  const patch = JSON.parse(v.body) as PatchEnvelope;
  const lessons = (patch.lessons ?? []).map((l) => (l as { lesson_no?: unknown }).lesson_no).join(", ");
  return { pipeline, verdict: null, failChecks: [], replaces: `${patch.book_id} — পাঠ ${lessons}`, adds: `${patch.lessons?.length ?? 0}টি পাঠ` };
}

export interface SendResult {
  ok: boolean;
  summary: string;
  failChecks: string[];
}

/** Sends the approved version; `confirm` must be true (the person saw the preview). */
export async function sendDraftToPipeline(
  authIn: AuthPayload | null,
  draftId: string,
  input: { confirm: boolean; curationTag?: string | null; unitTitle?: string | null },
): Promise<SendResult> {
  if (!input.confirm) throw new AiWorkspaceError(BN.confirm);
  const { auth, draft: d, version: v, pipeline } = await approvedContent(authIn, draftId);
  let result: SendResult;
  if (pipeline === "lesson_plan") {
    const stem = stemOf(d._id.toString(), v.version);
    const r = await importContentFiles([{ filename: `${stem}.json`, content: v.planJson ?? "" }, { filename: `${stem}.md`, content: v.body }], auth.userId, await authorName(auth.userId));
    result = { ok: r.verdict === "PASS", summary: r.verdict === "PASS" ? `পাঠ পরিকল্পনা আমদানি হয়েছে (${r.artifactId ?? ""})` : "যাচাইয়ে আটকেছে", failChecks: r.failChecks };
  } else if (pipeline === "question_bank") {
    if (!input.curationTag) throw new AiWorkspaceError(BN.curation);
    const r = await importContentFiles([{ filename: `${stemOf(d._id.toString(), v.version)}.json`, content: v.body }], auth.userId, await authorName(auth.userId), input.curationTag, input.unitTitle ?? undefined);
    result = {
      ok: r.verdict === "PASS",
      summary: `${r.itemsPassed ?? 0}/${r.itemsTotal ?? 0} আমদানি হয়েছে${r.itemsFailed ? `, ${r.itemsFailed}টি আটকেছে` : ""}`,
      failChecks: r.failChecks,
    };
  } else {
    if (!isBookDbReady()) throw new AiWorkspaceError(BN.noBook);
    const r = await submitPatch({ patch: JSON.parse(v.body) as PatchEnvelope, source: "IN_APP_CHAT", actorId: new Types.ObjectId(auth.userId) });
    result = {
      ok: r.merged,
      summary: r.merged ? `পাঠ ${r.lessonNos.join(", ")} যুক্ত হয়েছে` : `যাচাইয়ে আটকেছে (${r.report.redCount}টি লাল)`,
      failChecks: r.merged ? [] : [`${r.report.redCount} red finding(s)`],
    };
  }
  await AiDraft.updateOne({ _id: d._id }, { $push: { sends: { pipeline, version: v.version, ok: result.ok, summary: result.summary, by: new Types.ObjectId(auth.userId), at: new Date() } } });
  await writeAudit({ eventKind: "AI_DRAFT_CHANGED", actorId: auth.userId, actorRole: auth.role, targetKind: "AiDraft", targetId: draftId, meta: { action: "send", pipeline, version: v.version, ok: result.ok } });
  return result;
}

/** For export: the body of a version the caller may read. */
export async function draftForExport(authIn: AuthPayload | null, draftId: string, version?: number | null): Promise<{ title: string; body: string; isJson: boolean }> {
  const { draft: d } = await loadDraft(authIn, draftId, "viewer");
  const v = await AiDraftVersion.findOne({ draftId: d._id, version: version ?? d.currentVersion }).lean();
  if (!v) throw new AiWorkspaceError(BN.notFound);
  const body = d.kind === "lesson_plan" && v.planJson ? `${v.body}\n\n---\n\n\`\`\`json\n${v.planJson}\n\`\`\`` : v.body;
  return { title: `${d.title} — v${v.version}`, body, isJson: isJsonKind(d.kind) };
}
