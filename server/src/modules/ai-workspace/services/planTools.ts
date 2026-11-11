/**
 * Lesson-plan tools for AI Workspace drafts (Project 09 on DeepSeek; docs/prd-ai-workspace.md §5.1).
 *
 * The plan JSON is the master copy. A lesson-plan draft's Markdown is ALWAYS rendered from it
 * by `render_plan.py` and never written by the model or by hand. Every version is checked by
 * `validate_plan.py`, which applies the JSON Schema `LOCKED_SCD_PlanSchema_v2` plus the checks
 * a schema cannot express (35 minutes, 7 segments, the Opening / Closing rituals, Exit-Check
 * pointers, no codes on the teacher surface, numerals). A multi-period session plan is also
 * checked against its chapter plan in the same project (`--chapter`), the approved version
 * when there is one.
 *
 * The three files in server/import/plan-tools/ are the owner's LOCKED copies from Project 09.
 * Update them by replacing the files; do not edit them here.
 */
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { Types } from "mongoose";
import { execFilePromise, PYTHON_BIN } from "../../content/services/ContentService";
import { AiDraft, AiDraftVersion } from "../models/AiDraft";

const DIR = path.resolve(__dirname, "../../../../import/plan-tools");
const RENDER = path.join(DIR, "render_plan.py");
const VALIDATE = path.join(DIR, "validate_plan.py");

export interface PlanCheck {
  /** ERROR = the validator could not run (Python / jsonschema missing); treated like FAIL. */
  verdict: "PASS" | "FAIL" | "ERROR";
  fails: string[];
  warns: string[];
  /** The chapter plan a multi-period session plan was checked against. */
  chapterDraftId: string | null;
  chapterVersion: number | null;
  at: Date;
}

interface PlanHead {
  plan_type?: unknown;
  subject?: unknown;
  class_level?: unknown;
  division?: { number?: unknown } | null;
  session_plan?: { session_form?: unknown; period_index?: unknown; period_of?: unknown } | null;
}

function lastLine(s: string): string {
  const lines = s.replace(/\r\n/g, "\n").trim().split("\n").filter((l) => l.trim());
  return (lines[lines.length - 1] ?? "").trim().slice(0, 500);
}

async function withTmp<T>(files: Record<string, string>, fn: (paths: Record<string, string>) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scd_plan_"));
  try {
    const paths: Record<string, string> = {};
    for (const [name, content] of Object.entries(files)) {
      paths[name] = path.join(dir, name);
      await fs.writeFile(paths[name], content, "utf-8");
    }
    return await fn(paths);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function parsePlanHead(planJson: string): PlanHead | null {
  try {
    const v = JSON.parse(planJson) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as PlanHead) : null;
  } catch {
    return null;
  }
}

/** The teacher-facing Markdown, rendered from the plan JSON by render_plan.py. */
export async function renderPlanMarkdown(planJson: string): Promise<{ ok: true; md: string } | { ok: false; error: string }> {
  return withTmp({ "plan.json": planJson }, async (p) => {
    const r = await execFilePromise(PYTHON_BIN, [RENDER, p["plan.json"]]);
    if (r.code !== 0) return { ok: false, error: lastLine(r.stderr || r.stdout) || "render_plan.py failed" };
    return { ok: true, md: r.stdout.replace(/\r\n/g, "\n").trim() };
  });
}

/** validate_plan.py on one plan (and its chapter plan for the cross-plan check). */
export async function runPlanValidator(planJson: string, chapterJson?: string | null): Promise<Pick<PlanCheck, "verdict" | "fails" | "warns">> {
  const files: Record<string, string> = { "plan.json": planJson };
  if (chapterJson) files["chapter.json"] = chapterJson;
  return withTmp(files, async (p) => {
    const args = [VALIDATE, p["plan.json"], ...(chapterJson ? ["--chapter", p["chapter.json"]] : [])];
    const r = await execFilePromise(PYTHON_BIN, args);
    const out = `${r.stdout}\n${r.stderr}`.replace(/\r\n/g, "\n");
    const fails: string[] = [];
    const warns: string[] = [];
    for (const m of out.matchAll(/^\s*(WARN|FAIL) \[([^\]]+)\] (.*)$/gm)) (m[1] === "FAIL" ? fails : warns).push(`[${m[2]}] ${m[3].trim()}`);
    const result = /RESULT: (PASS|FAIL)/.exec(out);
    if (!result) return { verdict: "ERROR", fails: [lastLine(r.stderr || r.stdout) || "validate_plan.py did not run"], warns };
    return { verdict: result[1] as "PASS" | "FAIL", fails, warns };
  });
}

/**
 * The chapter plan a multi-period session plan belongs to: a lesson-plan draft in the same
 * project with the same subject, class and পাঠ / অধ্যায় number. Its approved version is used
 * when there is one, else its current version; approved drafts win over unapproved ones.
 */
export async function findChapterPlan(
  projectId: Types.ObjectId,
  head: PlanHead,
  selfDraftId?: Types.ObjectId | null,
): Promise<{ draftId: string; version: number; planJson: string } | null> {
  const drafts = await AiDraft.find({ projectId, kind: "lesson_plan", archived: false, ...(selfDraftId ? { _id: { $ne: selfDraftId } } : {}) })
    .sort({ updatedAt: -1 })
    .limit(500)
    .select("_id currentVersion approvedVersion")
    .lean();
  if (!drafts.length) return null;
  const pick = (d: (typeof drafts)[number]) => d.approvedVersion ?? d.currentVersion;
  const versions = await AiDraftVersion.find({ $or: drafts.map((d) => ({ draftId: d._id, version: pick(d) })) }).select("draftId version planJson").lean();
  const byDraft = new Map(versions.map((v) => [v.draftId.toString(), v]));
  const matches = drafts.flatMap((d) => {
    const v = byDraft.get(d._id.toString());
    const h = v?.planJson ? parsePlanHead(v.planJson) : null;
    if (!v || !h || h.plan_type !== "chapter_plan") return [];
    if (h.subject !== head.subject || String(h.class_level) !== String(head.class_level) || h.division?.number !== head.division?.number) return [];
    return [{ draftId: d._id.toString(), version: v.version, planJson: v.planJson as string, approved: d.approvedVersion !== null && d.approvedVersion !== undefined }];
  });
  const best = matches.find((m) => m.approved) ?? matches[0];
  return best ? { draftId: best.draftId, version: best.version, planJson: best.planJson } : null;
}

/** validate_plan.py for one version, with its chapter plan when it is a multi-period session. */
export async function checkPlanVersion(projectId: Types.ObjectId, draftId: Types.ObjectId | null, planJson: string): Promise<PlanCheck> {
  const head = parsePlanHead(planJson);
  if (!head) return { verdict: "FAIL", fails: ["[JSON] the plan JSON does not parse as an object"], warns: [], chapterDraftId: null, chapterVersion: null, at: new Date() };
  const chapter = head.plan_type === "session_plan" && head.session_plan?.session_form === "multi_period" ? await findChapterPlan(projectId, head, draftId) : null;
  const r = await runPlanValidator(planJson, chapter?.planJson ?? null);
  return { ...r, chapterDraftId: chapter?.draftId ?? null, chapterVersion: chapter?.version ?? null, at: new Date() };
}

const RENDER_FAILED = "⚠ পরিকল্পনার JSON থেকে Markdown তৈরি করা যায়নি — নিচের যাচাইয়ের ফল দেখে JSON ঠিক করুন।";

/** The body (rendered Markdown) and the check for a lesson-plan version. */
export async function preparePlanContent(projectId: Types.ObjectId, draftId: Types.ObjectId | null, planJson: string): Promise<{ body: string; planCheck: PlanCheck }> {
  const [md, planCheck] = await Promise.all([renderPlanMarkdown(planJson), checkPlanVersion(projectId, draftId, planJson)]);
  if (md.ok) return { body: md.md, planCheck };
  return { body: `${RENDER_FAILED}\n\n${md.error}`, planCheck };
}

/** A short Bangla label for a plan, used to title the drafts saved from one answer. */
export function planLabel(planJson: string): string {
  const h = parsePlanHead(planJson);
  const bn = (n: unknown) => String(n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
  if (!h) return "পরিকল্পনা";
  if (h.plan_type === "chapter_plan") return "অধ্যায় পরিকল্পনা";
  if (h.session_plan?.session_form === "multi_period" && h.session_plan.period_index !== undefined) return `পিরিয়ড ${bn(h.session_plan.period_index)}/${bn(h.session_plan.period_of ?? "?")}`;
  return "সেশন পরিকল্পনা";
}
