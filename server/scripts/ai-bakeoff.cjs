#!/usr/bin/env node
/**
 * AI-8 bake-off runner (D-#1098) — runs real past comments through DeepSeek AND Gemini
 * with the live checker's exact prompt, de-identified, and prints issues caught per dollar.
 * SPENDS a little money on both providers (about 2 × 50 checks ≈ a few US cents) and writes
 * `comment_check_bakeoff` rows to the AI usage ledger. Reads nothing else into the repo.
 *
 * Preconditions: both standards switched ON (Admin → এআই-এর নিয়ম ও মানদণ্ড), both keys
 * saved (Admin → এআই কী ও মডেল), and every child's Bangla name filled (else many items
 * are skipped as NAMES_LEFT — the gate works).
 *
 * On the VM, from the deployed checkout (compiled code; node reads .env itself — never
 * `. ./.env`, it empties MONGODB_URI):
 *   cd /opt/scdhub/prod && node server/scripts/ai-bakeoff.cjs --count 50
 *   [--deepseek-model deepseek-flash] [--gemini-model gemini-flash-latest] [--out /tmp/ai-bakeoff]
 *
 * Output (outside the repo, default /tmp/ai-bakeoff-<date>/):
 *   summary.json        no text: per provider checked / errors / issues by type / cost / latency
 *   side-by-side.md     DE-IDENTIFIED comments with each model's suggestions, for the owner to
 *                       judge quality. Do not commit it; delete it after the decision.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : dflt;
};

// .env → process.env, read by node (values may hold & = ? — no shell involved).
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

async function main() {
  const mongoose = require(require.resolve("mongoose", { paths: [path.join(ROOT, "server"), ROOT] }));
  const dist = (p) => require(path.join(ROOT, "server/dist", p));
  const { sampleBakeoffItems, runBakeoff } = dist("modules/platform/services/AiBakeoffService.js");

  const count = Math.max(2, Math.min(200, Number(arg("count", "50"))));
  const out = arg("out", path.join(require("os").tmpdir(), `ai-bakeoff-${new Date().toISOString().slice(0, 10)}`));
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set");
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`database: ${mongoose.connection.db.databaseName}`);

  const items = await sampleBakeoffItems(count);
  console.log(`sample: ${items.length} comments (${items.filter((i) => i.kind === "DAILY").length} daily, ${items.filter((i) => i.kind === "CT").length} class test)`);
  const { summary, sideBySide } = await runBakeoff({
    items,
    models: { deepseek: arg("deepseek-model"), gemini: arg("gemini-model") },
    onProgress: (d, t) => process.stdout.write(`\r${d}/${t}`),
  });
  process.stdout.write("\n");

  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(summary, null, 2));
  const md = ["# AI-8 bake-off — de-identified side by side", "", "Do not commit. Delete after the decision.", ""];
  sideBySide.forEach((s, n) => {
    md.push(`## ${n + 1}. ${s.kind === "DAILY" ? "Daily comment" : `Class test, ${s.markPct}%`}`, "");
    for (const f of s.fields) md.push(`**${f.field}:** ${f.text}`, "");
    for (const [p, r] of Object.entries(s.byProvider)) {
      md.push(`### ${p}`);
      if (r.error) md.push(`error: ${r.error}`, "");
      else {
        if (r.issues.length === 0) md.push("- (no issues)");
        for (const i of r.issues) md.push(`- [${i.type}] "${i.quote}" → "${i.suggestion}"`);
        for (const [k, v] of Object.entries(r.corrected)) md.push("", `corrected ${k}: ${v}`);
        md.push("");
      }
    }
  });
  fs.writeFileSync(path.join(out, "side-by-side.md"), md.join("\n"));

  console.log(`skipped: ${JSON.stringify(summary.skipped)}`);
  for (const p of summary.providers) {
    console.log(
      `${p.provider.padEnd(9)} ${p.model.padEnd(24)} checked ${p.checked}  errors ${JSON.stringify(p.errors)}  issues ${p.issues} (${p.issuesPerCheck}/check)  ` +
        `cost $${p.costUsd.toFixed(4)} ($${p.costPerCheckUsd.toFixed(5)}/check)  issues/$ ${p.issuesPerDollar}  p50 ${p.latencyP50Ms} ms  p90 ${p.latencyP90Ms} ms`,
    );
  }
  console.log(`\nwritten: ${out}/summary.json and side-by-side.md (de-identified; do not commit)`);
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
