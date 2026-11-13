/**
 * Data assistant DA-1 — read-only (docs/prd-data-assistant-mcp.md §2, §4.3 rule 5, OD-3; D-#1531).
 * Static: no file under modules/data-assistant/ (except the AiDataCall model and its one writer,
 * runTool.ts) calls a Mongo write or imports a known writing service. Runtime: hash every
 * collection, run every tool as the Principal (and the Claude door), hash again: only `aidatacalls`
 * changed (plus the whitelisted read-path side effects: PROXY_EXPIRED audit stamps, a daily-report
 * snapshot).
 */
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { runTool } from "../modules/data-assistant/runTool";
import { resetLimits } from "../modules/data-assistant/limits";
import { setupFixtures, teardownFixtures, toolCalls, type Fx } from "./dataAssistantFixtures";

jest.setTimeout(180_000);
const DA_DIR = path.join(__dirname, "../modules/data-assistant");
/** The only files that may write: the log model and runTool (its writer). Connection management
 *  (OAuth tokens, DA-3) is not a tool and lives outside tools/. */
const WRITERS = new Set(["models/AiDataCall.ts", "runTool.ts", "services/DataConnectionService.ts", "services/DataChatService.ts", "mcp/dataMcpRoute.ts"]);
const WRITE_CALL = /\.(create|save|insertMany|insertOne|updateOne|updateMany|findOneAndUpdate|findByIdAndUpdate|deleteOne|deleteMany|findOneAndDelete|bulkWrite|replaceOne)\s*\(/;
const WRITING_IMPORTS = /\b(chaseFeeDue|markDailyReportSeen|writeAudit|sendNotification|notify[A-Z]\w*|saveAiProjectInstructions|recordGuardianView)\b/;

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.ts$/.test(e.name) ? [path.join(dir, e.name)] : []));
}

it("static: no tool file writes or imports a writing service", () => {
  for (const f of files(DA_DIR)) {
    const rel = path.relative(DA_DIR, f).split(path.sep).join("/");
    if (WRITERS.has(rel)) continue;
    const src = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect([rel, WRITE_CALL.exec(src)?.[0] ?? null]).toEqual([rel, null]);
    const imports = (src.match(/import[\s\S]*?from\s+["'][^"']+["'];/g) ?? []).join("\n");
    expect([rel, WRITING_IMPORTS.exec(imports)?.[0] ?? null]).toEqual([rel, null]);
  }
});

let fx: Fx;
beforeAll(async () => {
  fx = await setupFixtures();
});
afterAll(async () => teardownFixtures(fx));

async function snapshot(): Promise<Map<string, string>> {
  const db = mongoose.connection.db!;
  const out = new Map<string, string>();
  for (const c of await db.listCollections().toArray()) {
    const docs = await db.collection(c.name).find({}).sort({ _id: 1 }).toArray();
    out.set(c.name, createHash("sha256").update(JSON.stringify(docs)).digest("hex") + `:${docs.length}`);
  }
  return out;
}

it("runtime: every tool leaves every collection unchanged except the call log", async () => {
  // Warm-up: Mongoose may create collections/indexes lazily on first use.
  for (const c of toolCalls(fx)) {
    resetLimits();
    await runTool(fx.auth.principal, c.tool, c.args, { surface: "in_app" });
  }
  const before = await snapshot();
  for (const surface of ["in_app", "claude"] as const) {
    for (const c of toolCalls(fx)) {
      resetLimits();
      await runTool(fx.auth.principal, c.tool, c.args, { surface });
      await runTool(fx.auth.teacher, c.tool, c.args, { surface: "in_app" });
    }
  }
  const after = await snapshot();
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter((k) => before.get(k) !== after.get(k));
  const ALLOWED = new Set(["aidatacalls", "audits", "dailyreports"]);
  expect(changed.filter((c) => !ALLOWED.has(c))).toEqual([]);
  expect(changed).toContain("aidatacalls");
  // Audit rows, if any, are only the whitelisted PROXY_EXPIRED stamps.
  const kinds = await mongoose.connection.db!.collection("audits").distinct("eventKind");
  expect(kinds.filter((k: string) => k !== "PROXY_EXPIRED")).toEqual([]);
});
