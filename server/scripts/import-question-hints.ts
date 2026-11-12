/**
 * Load guardian question-hint files (GH-1, D-#1520/#1521) into MongoDB.
 *
 *   npx tsx server/scripts/import-question-hints.ts <file.json> [more.json ...]            # dry run
 *   npx tsx server/scripts/import-question-hints.ts <file.json> [more.json ...] --apply    # write
 *
 * Each file is the agents' format `{ "hints": [ { "qid": "...", "steps": ["…", "…", "…"] } ] }`
 * (docs/hint-guideline.md). Calls the SAME service as the `importQuestionHints` mutation: an entry is
 * refused when its qid has no current bank question, it has not exactly 3 non-empty steps, or a step
 * contains the item's answer. Idempotent: upsert by qid; an identical entry is left alone.
 * Dry run is the default and writes nothing. Exit code 1 if any entry was refused or a file was unreadable.
 *
 * Loads the repo-root .env (MONGODB_URI). Writes are attributed to the first PRINCIPAL user.
 * NEVER point this at prod from a laptop; run it on the VM like other prod scripts.
 */
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { connectDb, disconnectDb } from "../src/db";
import { User } from "../src/modules/foundation/models/User";
import { importQuestionHints } from "../src/modules/guardian-help/services/QuestionHintService";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const files = args.filter((a) => !a.startsWith("--"));
  if (files.length === 0) {
    console.error("Usage: import-question-hints.ts <file.json> [more.json ...] [--apply]");
    process.exit(2);
  }
  console.log(apply ? "Mode: APPLY (writing to DB)" : "Mode: DRY-RUN (no writes; pass --apply to write)");
  await connectDb();
  const principal = await User.findOne({ role: "PRINCIPAL" }).select("_id").lean();
  if (!principal) {
    console.error("No PRINCIPAL user found — cannot attribute the load.");
    await disconnectDb();
    process.exit(1);
  }
  const actor = { userId: String(principal._id), role: "PRINCIPAL" };
  let bad = 0;
  for (const f of files) {
    const abs = path.resolve(f);
    let text: string;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      console.error(`== ${f}: cannot read`);
      bad++;
      continue;
    }
    const r = await importQuestionHints(text, actor, { dryRun: !apply });
    if (r.fileError) {
      console.error(`== ${f}: ${r.fileError}`);
      bad++;
      continue;
    }
    console.log(
      `== ${f}: ${r.total} entries — ${r.created} new, ${r.updated} replaced, ${r.unchanged} unchanged, ${r.refused} refused` +
        (r.warnings.length ? `, ${r.warnings.length} warnings` : ""),
    );
    for (const w of r.warnings.slice(0, 40)) console.log(`    WARN ${w.qid}: ${w.message}`);
    if (r.warnings.length > 40) console.log(`    … ${r.warnings.length - 40} more warnings`);
    for (const p of r.problems.slice(0, 40)) console.log(`    REFUSED ${p.qid}: ${p.message}`);
    if (r.problems.length > 40) console.log(`    … ${r.problems.length - 40} more`);
    bad += r.refused;
  }
  await disconnectDb();
  process.exit(bad > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
