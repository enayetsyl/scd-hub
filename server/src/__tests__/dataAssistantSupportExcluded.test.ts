/**
 * Data assistant DA-1 — child support-profile data is excluded (docs/prd-data-assistant-mcp.md §5.6;
 * D-#1545). The support-profile module is NOT built yet (checked 13 Nov 2026), so (a) checks the
 * PLANNED path and model names of docs/prd-child-support-profile.md §5; (b) seeds marker records in
 * the planned collections directly and runs every tool as the Principal; (c) no tool name or
 * description mentions support.
 */
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { runTool } from "../modules/data-assistant/runTool";
import { resetLimits } from "../modules/data-assistant/limits";
import { TOOL_REGISTRY } from "../modules/data-assistant/tools/registry";
import { setupFixtures, teardownFixtures, toolCalls, type Fx } from "./dataAssistantFixtures";

jest.setTimeout(180_000);
const DA_DIR = path.join(__dirname, "../modules/data-assistant");
/** Planned in docs/prd-child-support-profile.md §5 (module path + models). */
const SUPPORT_MODULE = "modules/support-profile";
const SUPPORT_MODELS = ["SupportProfile", "SupportProfileVersion", "SupportReport", "SupportStrategy", "SupportReview", "SupportAiRun", "SupportSeedPrompt", "SafeguardingReferral"];

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.ts$/.test(e.name) ? [path.join(dir, e.name)] : []));
}

let fx: Fx;
beforeAll(async () => {
  fx = await setupFixtures();
});
afterAll(async () => teardownFixtures(fx));

it("(a) no data-assistant file imports the support-profile module or names its models", () => {
  for (const f of files(DA_DIR)) {
    // Code only: comments may name the PRD.
    const src = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const imports = src.match(/from\s+["'][^"']+["']|require\(["'][^"']+["']\)/g) ?? [];
    expect([f, imports.filter((i) => /support-profile|supportProfile|safeguarding/i.test(i))]).toEqual([f, []]);
    for (const m of SUPPORT_MODELS) expect([f, m, new RegExp(`\\b${m}\\b`).test(src)]).toEqual([f, m, false]);
  }
  // The module path the PRD plans; when it lands, this file keeps checking it.
  expect(SUPPORT_MODULE).toBe("modules/support-profile");
});

it("(b) no tool result carries a support marker, whatever the planned collections hold", async () => {
  const db = mongoose.connection.db!;
  const marker = "SUPPORTMARKER-7f3a";
  for (const coll of ["supportprofiles", "supportprofileversions", "supportreports", "supportstrategies", "supportreviews", "safeguardingreferrals"]) {
    await db.collection(coll).insertOne({ studentId: new mongoose.Types.ObjectId(fx.ids.studentA), note: marker, flag: `${marker}-flag`, supportLevel: marker });
  }
  for (const c of toolCalls(fx)) {
    resetLimits();
    const r = await runTool(fx.auth.principal, c.tool, c.args, { surface: "claude" });
    const json = JSON.stringify(r.reply);
    expect([c.tool, json.includes(marker), /"support[A-Za-z_]*"\s*:/i.test(json)]).toEqual([c.tool, false, false]);
  }
});

it("(c) no tool's name or description mentions support", () => {
  for (const t of TOOL_REGISTRY) expect([t.name, /support|সহায়তা পরিকল্পনা|welfare/i.test(t.name + t.description.replace(/support\/welfare records/, ""))]).toEqual([t.name, false]);
});
