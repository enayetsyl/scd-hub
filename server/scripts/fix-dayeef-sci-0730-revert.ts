/**
 * Revert the mistaken SUBMITTED + CHECKED on Dayeef Elahi's HW-C3-SCI-0012
 * (Class 3 Science, given 2026-07-30) back to "not submitted".
 *
 * Owner report 2026-08-03: the teacher marked it submitted and checked by mistake.
 * The record never reached RETURNED, so there are exactly two mistaken actions —
 * stamped 8.5s apart, hence TWO separate action groups and two reverts.
 *
 * This calls the REAL service (`revertHomeworkRecord`) rather than hand-editing the
 * document, so the pop semantics, the side-effect cleanup (result cleared on a
 * CHECKED pop) and the HW_RECORD_REVERTED audit rows are identical to pressing the
 * button in the app. `admin: true` + the Principal's userId — the owner authorised
 * this, and the audit must name a real actor.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write.
 *   npx tsx server/scripts/fix-dayeef-sci-0730-revert.ts            # preview
 *   npx tsx server/scripts/fix-dayeef-sci-0730-revert.ts --apply    # execute
 */
import { readFileSync } from "fs";
import mongoose from "mongoose";
import { HomeworkStudentRecord } from "../src/modules/trackers/models/HomeworkStudentRecord";
import { revertHomeworkRecord } from "../src/modules/trackers/services/HomeworkRevertService";

const RECORD_ID = "6a6b1b890dc3bda8b5a35623"; // HW-C3-SCI-0012, Dayeef Elahi (0009)
const PRINCIPAL_ID = "6a28ead79b09e5fcc0b0b427"; // Md Enayetur Rahman (PRINCIPAL)
const DB = "scdhub_prod";
const APPLY = process.argv.includes("--apply");

const uri = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8").match(/^MONGODB_URI=(.+)$/m)![1].trim();

async function show(label: string): Promise<string> {
  const r = await HomeworkStudentRecord.findById(RECORD_ID).lean();
  if (!r) throw new Error("record not found");
  console.log(`\n--- ${label} ---`);
  console.log(`  state=${r.state}  result=${r.result ?? "-"}  chaseCount=${r.chaseCount}  stamps=${r.stateDates.length}`);
  for (const s of r.stateDates)
    console.log(`     ${String(s.state).padEnd(10)} ${new Date(s.at).toISOString()}  by=${s.by ?? "-"}`);
  return r.state as string;
}

async function main() {
  await mongoose.connect(uri, { dbName: DB });
  // Guard: never let a mis-set URI point this at the local test copy.
  console.log(`db = ${mongoose.connection.db?.databaseName}`);
  if (mongoose.connection.db?.databaseName !== DB) throw new Error(`expected ${DB}`);

  await show("BEFORE");

  if (!APPLY) {
    console.log(
      `\n=== DRY RUN — nothing written ===\n` +
        `  revert #1 would pop CHECKED    -> state SUBMITTED, result CORRECT cleared\n` +
        `  revert #2 would pop SUBMITTED  -> state DUE (not submitted)\n` +
        `  two HW_RECORD_REVERTED audit rows, actor = ${PRINCIPAL_ID}\n` +
        `  re-run with --apply to execute`,
    );
    await mongoose.disconnect();
    return;
  }

  for (const pass of [1, 2]) {
    const res = await revertHomeworkRecord({ recordId: RECORD_ID, actorId: PRINCIPAL_ID, admin: true });
    console.log(
      `\n  revert #${pass}: popped [${res.poppedStates.join(", ")}] -> state=${res.state} result=${res.result ?? "-"}` +
        `${res.deletedResubmissionId ? ` deletedResub=${res.deletedResubmissionId}` : ""}`,
    );
  }

  const end = await show("AFTER");
  console.log(
    end === "DUE"
      ? "\n=== OK — back to DUE (not submitted) ==="
      : `\n=== UNEXPECTED end state ${end} — expected DUE; review before leaving it ===`,
  );
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
