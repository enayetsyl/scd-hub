#!/usr/bin/env node
/**
 * Move a claude.ai Project's knowledge into an AI Workspace project (W-6, PRD §8).
 *
 *   npx tsx scripts/ai-workspace-import.ts --source <folder> [--source <folder> …]
 *       --project <projectId | exact project name> --as <Principal email or phone>
 *       [--apply] [--unpinned]
 *
 * Reads a LOCAL folder (e.g. a clone of scd-central: canon/refs, workstreams/lesson-plans/
 * references), decides what to bring with `planImport` (newest version of each document, the
 * Markdown copy over the .docx, no _wip/_inbox/archive) and prints the plan. Nothing is
 * written without --apply. With --apply each kept file goes through the SAME upload path as
 * the app (Drive original + text + tokens), as the given user, and files whose name the
 * project already has are skipped — so a re-run only adds what is new. Never deletes.
 *
 * Files from claude.ai that are not in the repo: download them from claude.ai and either put
 * them in a folder for --source or upload them in the app (Files tab).
 *
 * Run where the server's .env points at the right database (the VM for prod). It uploads to
 * the school's REAL Drive — do not run --apply on a laptop with a test database.
 */
import "dotenv/config";
import { promises as fs } from "fs";
import path from "path";
import { Types } from "mongoose";
import { connectDb, disconnectDb } from "../src/db";
import { User } from "../src/modules/foundation/models/User";
import { AiProject } from "../src/modules/ai-workspace/models/AiProject";
import { AiProjectFile } from "../src/modules/ai-workspace/models/AiProjectFile";
import { planImport, type SourceFile } from "../src/modules/ai-workspace/services/importPlan";
import { startAiProjectFileUpload } from "../src/modules/ai-workspace/services/FileIngestService";
import { estimateTokens } from "../src/modules/ai-workspace/services/tokenCount";
import type { AuthPayload } from "../src/context";

const MIME: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  json: "application/json",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

function args(): { sources: string[]; project: string; as: string; apply: boolean; unpinned: boolean } {
  const a = process.argv.slice(2);
  const sources: string[] = [];
  let project = "";
  let as = "";
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--source") sources.push(a[++i]);
    else if (a[i] === "--project") project = a[++i];
    else if (a[i] === "--as") as = a[++i];
  }
  if (!sources.length || !project || !as) {
    console.error("usage: --source <folder> [--source …] --project <id|name> --as <email|phone> [--apply] [--unpinned]");
    process.exit(2);
  }
  return { sources, project, as, apply: a.includes("--apply"), unpinned: a.includes("--unpinned") };
}

async function walk(root: string, dir = root): Promise<Array<SourceFile & { abs: string }>> {
  const out: Array<SourceFile & { abs: string }> = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(root, abs)));
    else if (e.isFile()) out.push({ abs, path: path.relative(root, abs).split(path.sep).join("/"), sizeBytes: (await fs.stat(abs)).size });
  }
  return out;
}

async function main(): Promise<void> {
  const opt = args();
  await connectDb();
  const user = await User.findOne({ $or: [{ email: opt.as.toLowerCase() }, { phone: opt.as }], active: true }).lean();
  if (!user) throw new Error(`no active user ${opt.as}`);
  const auth = { userId: user._id.toString(), role: user.role, additionalTemplates: user.additionalTemplates ?? [], grantedPermissions: user.grantedPermissions ?? [], revokedPermissions: user.revokedPermissions ?? [] } as AuthPayload;
  const project = Types.ObjectId.isValid(opt.project) ? await AiProject.findById(opt.project) : await AiProject.findOne({ name: opt.project, archived: false });
  if (!project) throw new Error(`no project ${opt.project}`);
  const existing = new Set((await AiProjectFile.find({ projectId: project._id, sessionId: null }).select("name").lean()).map((f) => f.name));

  const all: Array<SourceFile & { abs: string }> = [];
  for (const s of opt.sources) all.push(...(await walk(path.resolve(s))));
  const plan = planImport(all);
  const absOf = new Map(all.map((f) => [f.path, f.abs]));

  console.log(`project: ${project.name} (${project._id.toString()})  as: ${user.name}  mode: ${opt.apply ? "APPLY" : "dry run"}`);
  let tokens = 0;
  for (const f of plan.keep) {
    const name = path.basename(f.path);
    const already = existing.has(name);
    const ext = name.split(".").pop()!.toLowerCase();
    const est = ["md", "markdown", "txt", "json", "csv", "tsv"].includes(ext) ? estimateTokens(await fs.readFile(absOf.get(f.path)!, "utf8")) : Math.round(f.sizeBytes / 4);
    if (!already) tokens += est;
    console.log(`  ${already ? "HAVE" : "ADD "}  ~${String(est).padStart(7)} tok  ${f.path}`);
  }
  for (const s of plan.skip) console.log(`  skip  ${s.path} — ${s.reason}`);
  console.log(`new files: ${plan.keep.filter((f) => !existing.has(path.basename(f.path))).length}, about ${tokens} tokens${tokens > 150_000 ? " — ABOVE the 150k warning; consider --unpinned for the bulky ones" : ""}`);

  if (!opt.apply) {
    console.log("dry run only — add --apply to upload");
    return;
  }
  for (const f of plan.keep) {
    const name = path.basename(f.path);
    if (existing.has(name)) continue;
    const ext = name.split(".").pop()!.toLowerCase();
    const data = await fs.readFile(absOf.get(f.path)!);
    const { file, done } = await startAiProjectFileUpload(auth, { projectId: project._id.toString(), name, mime: MIME[ext] ?? "application/octet-stream", data });
    await done;
    const row = await AiProjectFile.findById(file.id).lean();
    if (opt.unpinned && row?.pinned) await AiProjectFile.updateOne({ _id: row._id }, { $set: { pinned: false } });
    console.log(`  ${row?.status === "ready" ? "OK  " : "FAIL"}  ${name}  ${row?.tokenCount ?? 0} tok${row?.error ? `  (${row.error})` : ""}`);
  }
}

main()
  .catch((e) => {
    console.error("import failed:", (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => void disconnectDb().catch(() => undefined));
