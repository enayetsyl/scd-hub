/**
 * AiProjectService (AI Workspace W-1, docs/prd-ai-workspace.md §3).
 *
 * Who reaches what:
 *   - `ai_workspace:use` (granted from the matrix; Principal-only at launch, D-#1208) may
 *     create projects and work in the projects they are a MEMBER of;
 *   - project role decides the rest: viewer reads; editor also writes instructions and files;
 *     owner also changes settings, members and the name-protection switch;
 *   - `ai_workspace:admin` (LOCKED, the Principal) reaches every project as an owner.
 *
 * Instructions are AiPolicy versions under `project:<id>` (D-#1202): saving makes the new
 * version the active one. Files are AiProjectFile rows (FileIngestService reads them).
 */
import { Types } from "mongoose";
import { callerHasPermission } from "@scd/shared";
import type { AuthPayload } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { queryPage, type Page, type PageArgs } from "../../../lib/paging";
import { User } from "../../foundation/models/User";
import { holdersOf } from "../../access-control/services/holders";
import { writeAudit } from "../../platform/services/AuditService";
import { aiBudgetConfig, WORKSPACE_THINKING, type WorkspaceThinking } from "../../platform/services/AiSettingService";
import { schoolBranch, projectSpentSince, dhakaMonthStart } from "../../platform/services/AiUsageService";
import { activeProjectPolicy, projectPolicyVersionsPage, saveProjectPolicyVersion, type AiPolicyVersionView, type ProjectPolicyVersion } from "../../platform/services/AiPolicyService";
import { providerOfModel, WORKSPACE_MODELS } from "../../platform/ai/models";
import { CONTEXT_WINDOW_TOKENS, priceOf, WORKSPACE_PREFIX_MAX_TOKENS, WORKSPACE_PREFIX_WARN_TOKENS } from "../../platform/ai/aiPrices";
import { AiProject, AI_PROJECT_ROLES, type AiProjectRole, type IAiProject } from "../models/AiProject";
import { AiProjectFile } from "../models/AiProjectFile";
import { estimateTokens } from "./tokenCount";

export class AiWorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiWorkspaceError";
  }
}

const RANK: Record<AiProjectRole, number> = { viewer: 1, editor: 2, owner: 3 };

export const projectPolicyKey = (projectId: string): string => `project:${projectId}`;

export function assertWorkspaceUser(auth: AuthPayload | null): AuthPayload {
  if (!auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(auth, "ai_workspace:use") && !callerHasPermission(auth, "ai_workspace:admin")) {
    throw new ForbiddenError("এআই কর্মক্ষেত্র ব্যবহারের অনুমতি নেই");
  }
  return auth;
}

export const isWorkspaceAdmin = (auth: AuthPayload): boolean => callerHasPermission(auth, "ai_workspace:admin");

/** The caller's role in a project (admin = owner), or null. */
export function roleIn(project: Pick<IAiProject, "members">, auth: AuthPayload): AiProjectRole | null {
  if (isWorkspaceAdmin(auth)) return "owner";
  if (!callerHasPermission(auth, "ai_workspace:use")) return null;
  return project.members.find((m) => m.userId.toString() === auth.userId)?.role ?? null;
}

/** Loads a project the caller reaches with at least `need`; refuses otherwise (same message either way). */
export async function loadProject(authIn: AuthPayload | null, projectId: string, need: AiProjectRole): Promise<{ auth: AuthPayload; project: IAiProject; role: AiProjectRole }> {
  const auth = assertWorkspaceUser(authIn);
  const project = Types.ObjectId.isValid(projectId) ? await AiProject.findById(projectId) : null;
  const role = project ? roleIn(project, auth) : null;
  if (!project || !role) throw new ForbiddenError("প্রকল্পটি পাওয়া যায়নি");
  if (RANK[role] < RANK[need]) {
    throw new ForbiddenError(need === "owner" ? "শুধু প্রকল্পের মালিক এটি বদলাতে পারেন" : "এই প্রকল্পে লেখার অনুমতি নেই");
  }
  return { auth, project, role };
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface AiProjectMemberView {
  userId: string;
  name: string;
  role: AiProjectRole;
}

export interface AiProjectView {
  id: string;
  name: string;
  description: string | null;
  ownerName: string | null;
  myRole: AiProjectRole;
  members: AiProjectMemberView[];
  defaultModel: string;
  defaultThinking: WorkspaceThinking;
  nameProtection: boolean;
  monthlyCapUsd: number | null;
  archived: boolean;
  fileCount: number;
  createdAt: Date;
  updatedAt: Date;
}

async function views(projects: IAiProject[], auth: AuthPayload): Promise<AiProjectView[]> {
  const ids = [...new Set(projects.flatMap((p) => [p.ownerId.toString(), ...p.members.map((m) => m.userId.toString())]))];
  const users = ids.length ? await User.find({ _id: { $in: ids } }).select("name").lean() : [];
  const nameOf = new Map(users.map((u) => [u._id.toString(), u.name]));
  const counts = projects.length
    ? await AiProjectFile.aggregate<{ _id: Types.ObjectId; n: number }>([
        { $match: { projectId: { $in: projects.map((p) => p._id) }, sessionId: null } },
        { $group: { _id: "$projectId", n: { $sum: 1 } } },
      ])
    : [];
  const countOf = new Map(counts.map((c) => [c._id.toString(), c.n]));
  return projects.map((p) => ({
    id: p._id.toString(),
    name: p.name,
    description: p.description ?? null,
    ownerName: nameOf.get(p.ownerId.toString()) ?? null,
    myRole: roleIn(p, auth) ?? "viewer",
    members: p.members.map((m) => ({ userId: m.userId.toString(), name: nameOf.get(m.userId.toString()) ?? "—", role: m.role })),
    defaultModel: p.defaultModel,
    defaultThinking: p.defaultThinking,
    nameProtection: p.nameProtection,
    monthlyCapUsd: p.monthlyCapUsd ?? null,
    archived: p.archived,
    fileCount: countOf.get(p._id.toString()) ?? 0,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }));
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function aiProjectsPage(authIn: AuthPayload | null, args: PageArgs & { archived?: boolean | null }): Promise<Page<AiProjectView>> {
  const auth = assertWorkspaceUser(authIn);
  const filter: Record<string, unknown> = { archived: !!args.archived };
  if (!isWorkspaceAdmin(auth)) filter["members.userId"] = new Types.ObjectId(auth.userId);
  return queryPage(AiProject, filter, { updatedAt: -1 }, args, (docs) => views(docs as unknown as IAiProject[], auth), 20);
}

export async function aiProject(authIn: AuthPayload | null, projectId: string): Promise<AiProjectView> {
  const { auth, project } = await loadProject(authIn, projectId, "viewer");
  return (await views([project], auth))[0];
}

function cleanName(raw: string | null | undefined): string {
  const name = (raw ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new AiWorkspaceError("প্রকল্পের একটি নাম দিন");
  if (name.length > 120) throw new AiWorkspaceError("নামটি ১২০ অক্ষরের মধ্যে রাখুন");
  return name;
}

function checkModel(m: string): string {
  if (!WORKSPACE_MODELS.includes(m)) throw new AiWorkspaceError("এই মডেলটি কর্মক্ষেত্রে চলে না");
  return m;
}

function checkThinking(t: string): WorkspaceThinking {
  if (!(WORKSPACE_THINKING as readonly string[]).includes(t)) throw new AiWorkspaceError("চিন্তার মাত্রা সঠিক নয়");
  return t as WorkspaceThinking;
}

function checkCap(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isFinite(v) || v < 0 || v > 1000) throw new AiWorkspaceError("মাসিক সীমা ০ থেকে ১০০০ ডলারের মধ্যে দিন");
  return Math.round(v * 100) / 100;
}

export async function createAiProject(
  authIn: AuthPayload | null,
  input: { name: string; description?: string | null; nameProtection: boolean; defaultModel?: string | null; defaultThinking?: string | null; monthlyCapUsd?: number | null },
): Promise<AiProjectView> {
  const auth = assertWorkspaceUser(authIn);
  const defaults = await aiBudgetConfig();
  const owner = new Types.ObjectId(auth.userId);
  const project = await AiProject.create({
    name: cleanName(input.name),
    description: input.description?.trim() || undefined,
    branch: schoolBranch(),
    ownerId: owner,
    members: [{ userId: owner, role: "owner" }],
    defaultModel: checkModel(input.defaultModel || defaults.workspaceDefaultModel),
    defaultThinking: checkThinking(input.defaultThinking || defaults.workspaceDefaultThinking),
    nameProtection: !!input.nameProtection,
    monthlyCapUsd: checkCap(input.monthlyCapUsd),
    archived: false,
  });
  await writeAudit({
    eventKind: "AI_PROJECT_CHANGED",
    actorId: auth.userId,
    actorRole: auth.role,
    targetKind: "AiProject",
    targetId: project._id.toString(),
    meta: { action: "create", nameProtection: project.nameProtection, defaultModel: project.defaultModel, defaultThinking: project.defaultThinking },
  });
  return (await views([project], auth))[0];
}

export async function updateAiProject(
  authIn: AuthPayload | null,
  projectId: string,
  input: {
    name?: string | null;
    description?: string | null;
    defaultModel?: string | null;
    defaultThinking?: string | null;
    nameProtection?: boolean | null;
    monthlyCapUsd?: number | null;
    clearMonthlyCap?: boolean | null;
    archived?: boolean | null;
  },
): Promise<AiProjectView> {
  const { auth, project } = await loadProject(authIn, projectId, "owner");
  const changed: Record<string, unknown> = {};
  if (input.name !== undefined && input.name !== null) changed.name = project.name = cleanName(input.name);
  if (input.description !== undefined && input.description !== null) {
    project.description = input.description.trim() || undefined;
    changed.description = true;
  }
  if (input.defaultModel) changed.defaultModel = project.defaultModel = checkModel(input.defaultModel);
  if (input.defaultThinking) changed.defaultThinking = project.defaultThinking = checkThinking(input.defaultThinking);
  if (input.nameProtection !== undefined && input.nameProtection !== null) changed.nameProtection = project.nameProtection = input.nameProtection;
  if (input.clearMonthlyCap) changed.monthlyCapUsd = project.monthlyCapUsd = null;
  else if (input.monthlyCapUsd !== undefined && input.monthlyCapUsd !== null) changed.monthlyCapUsd = project.monthlyCapUsd = checkCap(input.monthlyCapUsd);
  if (input.archived !== undefined && input.archived !== null) changed.archived = project.archived = input.archived;
  if (Object.keys(changed).length === 0) return (await views([project], auth))[0];
  await project.save();
  await writeAudit({ eventKind: "AI_PROJECT_CHANGED", actorId: auth.userId, actorRole: auth.role, targetKind: "AiProject", targetId: project._id.toString(), meta: { action: "update", ...changed } });
  return (await views([project], auth))[0];
}

export interface MemberCandidate {
  userId: string;
  name: string;
}

/** Staff who may be added as members: everyone holding `ai_workspace:use` (or admin). */
export async function aiWorkspaceMemberCandidates(authIn: AuthPayload | null): Promise<MemberCandidate[]> {
  assertWorkspaceUser(authIn);
  const [users, admins] = await Promise.all([holdersOf("ai_workspace:use"), holdersOf("ai_workspace:admin")]);
  const seen = new Map<string, string>();
  for (const u of [...users, ...admins]) seen.set(u._id.toString(), u.name);
  return [...seen.entries()].map(([userId, name]) => ({ userId, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Replaces the member list. At least one owner; members must be active staff logins. */
export async function setAiProjectMembers(authIn: AuthPayload | null, projectId: string, members: Array<{ userId: string; role: string }>): Promise<AiProjectView> {
  const { auth, project } = await loadProject(authIn, projectId, "owner");
  const seen = new Set<string>();
  const clean: Array<{ userId: Types.ObjectId; role: AiProjectRole }> = [];
  for (const m of members) {
    if (!Types.ObjectId.isValid(m.userId)) throw new AiWorkspaceError("সদস্য পাওয়া যায়নি");
    if (!(AI_PROJECT_ROLES as readonly string[]).includes(m.role)) throw new AiWorkspaceError("সদস্যের ভূমিকা সঠিক নয়");
    if (seen.has(m.userId)) continue;
    seen.add(m.userId);
    clean.push({ userId: new Types.ObjectId(m.userId), role: m.role as AiProjectRole });
  }
  if (!clean.some((m) => m.role === "owner")) throw new AiWorkspaceError("অন্তত একজন মালিক রাখতে হবে");
  const found = await User.countDocuments({ _id: { $in: clean.map((m) => m.userId) }, active: true, role: { $ne: "GUARDIAN" } });
  if (found !== clean.length) throw new AiWorkspaceError("শুধু সক্রিয় স্টাফদের সদস্য করা যায়");
  project.members = clean;
  await project.save();
  await writeAudit({
    eventKind: "AI_PROJECT_CHANGED",
    actorId: auth.userId,
    actorRole: auth.role,
    targetKind: "AiProject",
    targetId: project._id.toString(),
    meta: { action: "members", members: clean.map((m) => `${m.userId.toString()}:${m.role}`) },
  });
  return (await views([project], auth))[0];
}

// ---------------------------------------------------------------------------
// Instructions (AiPolicy `project:<id>`)
// ---------------------------------------------------------------------------

export async function aiProjectInstructions(authIn: AuthPayload | null, projectId: string): Promise<ProjectPolicyVersion | null> {
  await loadProject(authIn, projectId, "viewer");
  return activeProjectPolicy(projectPolicyKey(projectId));
}

export async function aiProjectInstructionVersionsPage(authIn: AuthPayload | null, projectId: string, args: PageArgs): Promise<Page<AiPolicyVersionView>> {
  await loadProject(authIn, projectId, "viewer");
  return projectPolicyVersionsPage(projectPolicyKey(projectId), args);
}

export async function saveAiProjectInstructions(authIn: AuthPayload | null, projectId: string, body: string, note?: string | null): Promise<ProjectPolicyVersion> {
  const { auth, project } = await loadProject(authIn, projectId, "editor");
  const before = await contextBudgetOf(project);
  const nextTokens = before.totalTokens - before.instructionTokens + estimateTokens(body);
  if (nextTokens > WORKSPACE_PREFIX_MAX_TOKENS) throw new AiWorkspaceError(overBudgetMessage(nextTokens));
  const saved = await saveProjectPolicyVersion({ key: projectPolicyKey(projectId), body, note, actorId: auth.userId, actorRole: auth.role });
  await AiProject.updateOne({ _id: project._id }, { $set: { updatedAt: new Date() } });
  return saved;
}

// ---------------------------------------------------------------------------
// Context budget (PRD §3)
// ---------------------------------------------------------------------------

export interface ContextBudget {
  model: string;
  instructionTokens: number;
  fileTokens: number;
  pinnedFiles: number;
  totalTokens: number;
  windowTokens: number;
  warnTokens: number;
  maxTokens: number;
  warn: boolean;
  over: boolean;
  /** USD for this prefix on one message, at peak price, read from the cache vs not. */
  costPerMessageCacheHitUsd: number;
  costPerMessageCacheMissUsd: number;
  /** This Dhaka month's spend on the project, and its own cap (null = none). */
  spentThisMonthUsd: number;
  monthlyCapUsd: number | null;
}

const fmtK = (n: number) => `${Math.round(n / 1000)}k`;
export const overBudgetMessage = (tokens: number): string =>
  `নির্দেশনা আর পিন করা ফাইল মিলে প্রায় ${fmtK(tokens)} টোকেন হবে — সীমা ${fmtK(WORKSPACE_PREFIX_MAX_TOKENS)}। কিছু ফাইল আনপিন করুন।`;

export async function contextBudgetOf(project: IAiProject, now: Date = new Date()): Promise<ContextBudget> {
  const id = project._id.toString();
  const [instr, files, spent] = await Promise.all([
    activeProjectPolicy(projectPolicyKey(id)),
    AiProjectFile.find({ projectId: project._id, sessionId: null, pinned: true, status: "ready" }).select("tokenCount").lean(),
    projectSpentSince(id, dhakaMonthStart(now)),
  ]);
  const instructionTokens = instr ? estimateTokens(instr.body) : 0;
  const fileTokens = files.reduce((a, f) => a + (f.tokenCount ?? 0), 0);
  const totalTokens = instructionTokens + fileTokens;
  const price = priceOf(providerOfModel(project.defaultModel) ?? "deepseek", project.defaultModel);
  const round = (usd: number) => Math.round(usd * 1_000_000) / 1_000_000;
  return {
    model: project.defaultModel,
    instructionTokens,
    fileTokens,
    pinnedFiles: files.length,
    totalTokens,
    windowTokens: CONTEXT_WINDOW_TOKENS[project.defaultModel] ?? WORKSPACE_PREFIX_MAX_TOKENS,
    warnTokens: WORKSPACE_PREFIX_WARN_TOKENS,
    maxTokens: WORKSPACE_PREFIX_MAX_TOKENS,
    warn: totalTokens > WORKSPACE_PREFIX_WARN_TOKENS,
    over: totalTokens > WORKSPACE_PREFIX_MAX_TOKENS,
    costPerMessageCacheHitUsd: round((totalTokens * price.cacheHit) / 1_000_000),
    costPerMessageCacheMissUsd: round((totalTokens * price.cacheMiss) / 1_000_000),
    spentThisMonthUsd: Math.round(spent * 10_000) / 10_000,
    monthlyCapUsd: project.monthlyCapUsd ?? null,
  };
}

export async function aiProjectContextBudget(authIn: AuthPayload | null, projectId: string): Promise<ContextBudget> {
  const { project } = await loadProject(authIn, projectId, "viewer");
  return contextBudgetOf(project);
}
