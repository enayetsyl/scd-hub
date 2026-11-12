/**
 * Year-change engine runner (YC-4, docs/prd-year-change.md section 3). For the rehearsal on the dev
 * database and, later, the real run - NEVER run it against a real database without the owner's go-ahead.
 *
 *   npx tsx server/scripts/year-change.ts plan          --from 2026 --to 2027 [--input plan.json]
 *   npx tsx server/scripts/year-change.ts prepare       --from 2026 --to 2027 [--input plan.json] [--run <id>] [--apply --confirm <db>]
 *   npx tsx server/scripts/year-change.ts cutover       --run <id> [--allow-early] [--force] [--apply --confirm <db>]
 *   npx tsx server/scripts/year-change.ts undo-prepare  --run <id> [--apply --confirm <db>]
 *   npx tsx server/scripts/year-change.ts undo-cutover  --run <id> [--force] [--apply --confirm <db>]
 *   npx tsx server/scripts/year-change.ts retire        --from 2026 [--allow-early] [--apply --confirm <db>]   (after 15 Jan)
 *
 * --allow-early skips the date guard (dev rehearsal only); --force ignores unissued homework (cutover) or
 * lets undo-cutover proceed past children added to next-year sections after the cut-over.
 *
 * Dry run by default. It prints `databaseName`; `--apply` is refused unless `--confirm <databaseName>`
 * matches exactly. `--input` is a JSON file {classPlan?, promotions?, admissions?, classTeachers?}
 * (see server/src/modules/year-change/types.ts). Acts as the first PRINCIPAL user (or `--actor <userId>`,
 * which must be a PRINCIPAL). One prepared run per year pair: `prepare` reuses its runId.
 * Uses MONGODB_URI from env (never printed).
 */
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import mongoose from "mongoose";
import { connectDb, disconnectDb } from "../src/db";
import { AcademicYear } from "../src/modules/foundation/models/AcademicYear";
import { User } from "../src/modules/foundation/models/User";
import {
  YearChangeRun,
  applyCutover,
  applyPrepare,
  planCutover,
  planUndoCutover,
  planUndoPrepare,
  planYearChange,
  printCutover,
  printPlan,
  printUndo,
  retirePastYearSections,
  undoCutover,
  undoPrepare,
  type PlanInput,
  type YearChangeActor,
} from "../src/modules/year-change";

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const APPLY = argv.includes("--apply");
const ALLOW_EARLY = argv.includes("--allow-early");
const FORCE = argv.includes("--force");

async function yearId(label: string | undefined, what: string): Promise<string> {
  if (!label) throw new Error(`--${what} <label> is required`);
  const y = await AcademicYear.findOne({ label }).select("_id").lean();
  if (!y) throw new Error(`No academic year "${label}"`);
  return String(y._id);
}

async function main(): Promise<void> {
  const known = ["plan", "prepare", "cutover", "undo-prepare", "undo-cutover", "retire"];
  if (!cmd || !known.includes(cmd)) {
    console.error(`Usage: year-change.ts <${known.join(" | ")}> [options] (see the file header)`);
    process.exit(2);
  }
  await connectDb();
  const dbName = mongoose.connection.db?.databaseName ?? "(unknown)";
  console.log(`databaseName: ${dbName}`);
  const writes = cmd !== "plan";
  if (APPLY && flag("confirm") !== dbName) {
    console.error(`Refusing --apply: pass --confirm ${dbName} to confirm this is the database you mean.`);
    await disconnectDb();
    process.exit(2);
  }
  console.log(APPLY && writes ? "MODE: APPLY (writing)" : "MODE: dry-run (no writes)");

  const actorUser = flag("actor") ? await User.findById(flag("actor")).lean() : await User.findOne({ role: "PRINCIPAL", active: { $ne: false } }).lean();
  if (!actorUser) throw new Error("No PRINCIPAL user found (pass --actor <userId>)");
  if (actorUser.role !== "PRINCIPAL") throw new Error("The actor must be a PRINCIPAL user");
  const actor: YearChangeActor = { userId: String(actorUser._id), role: actorUser.role, additionalTemplates: actorUser.additionalTemplates };
  const runId = flag("run");

  if (cmd === "plan" || cmd === "prepare") {
    const extra = flag("input") ? (JSON.parse(fs.readFileSync(flag("input") as string, "utf8")) as Partial<PlanInput>) : {};
    const plan = await planYearChange({ ...extra, fromYearId: await yearId(flag("from"), "from"), toYearId: await yearId(flag("to"), "to") });
    console.log(printPlan(plan));
    if (cmd === "prepare" && APPLY) {
      // one prepared run per year pair: reuse it
      const prior = await YearChangeRun.findOne({ fromYearId: plan.fromYearId, toYearId: plan.toYearId }).select("runId").lean();
      const id = prior?.runId ?? runId ?? `yc-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12)}`;
      if (prior) console.log(`Re-using the prepared run ${id}.`);
      const r = await applyPrepare(plan, id, actor);
      console.log(`\nPrepared. runId=${id}`);
      console.log(JSON.stringify(r.writes));
      console.log(`rows written: ${r.total}`);
    } else if (cmd === "prepare") console.log("\nDry run - nothing written. Re-run with --apply --confirm <databaseName> to write.");
  } else if (cmd === "cutover") {
    if (!runId) throw new Error("--run <id> is required");
    console.log(printCutover(await planCutover(runId, undefined, { allowEarly: ALLOW_EARLY, force: FORCE })));
    if (APPLY) {
      const r = await applyCutover(runId, actor, { allowEarly: ALLOW_EARLY, force: FORCE });
      console.log(`\nCut over. ${JSON.stringify(r.writes)} (rows: ${r.total})`);
    } else console.log("\nDry run - nothing written.");
  } else if (cmd === "undo-prepare" || cmd === "undo-cutover") {
    if (!runId) throw new Error("--run <id> is required");
    const plan = cmd === "undo-prepare" ? await planUndoPrepare(runId) : await planUndoCutover(runId);
    console.log(printUndo(plan));
    if (APPLY) {
      const r = cmd === "undo-prepare" ? await undoPrepare(runId, actor) : await undoCutover(runId, actor, { force: FORCE });
      console.log(`\nUndone. rows: ${r.total}`);
    } else console.log("\nDry run - nothing written.");
  } else if (cmd === "retire") {
    const id = await yearId(flag("from"), "from");
    if (APPLY) console.log(`Retired sections: ${(await retirePastYearSections(id, actor, { allowEarly: ALLOW_EARLY })).retired}`);
    else console.log("Dry run - would set every active section of that year inactive. Re-run with --apply --confirm <databaseName>.");
  }
  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  await disconnectDb();
  process.exit(1);
});
