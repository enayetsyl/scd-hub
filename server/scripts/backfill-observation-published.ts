/**
 * One-time backfill for the CO-8 publish gate (D-#271). Before CO-8 a review released
 * straight to the observed teacher at REVIEWED; now the teacher can only read a row once
 * `publishedAt` is set. Without this backfill, deploying CO-8 would retroactively HIDE
 * every already-released observation from the teachers who have already seen it.
 *
 * So: for every row that was already released under the old model — state ∈ {REVIEWED,
 * TEACHER_RESPONDED, SUPERSEDED} with `publishedAt` still null — stamp
 * `publishedAt = reviewedAt` (fallback `updatedAt` if reviewedAt is somehow null).
 * `publishedBy` stays null (a system backfill, no human publisher). Idempotent: a row
 * that already has `publishedAt` is skipped, so re-running is safe.
 *
 * DRY-RUN by default; pass --commit to write. Uses MONGODB_URI from env (never printed).
 * Run ONCE at the CO-8 deploy, against the target env:
 *
 *   npx tsx server/scripts/backfill-observation-published.ts            # dry-run (counts only)
 *   npx tsx server/scripts/backfill-observation-published.ts --commit   # apply
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { connectDb, disconnectDb } from "../src/db";
import { ClassroomObservation } from "../src/modules/classroom-observation/models/ClassroomObservation";

const COMMIT = process.argv.includes("--commit");
const RELEASED_STATES = ["REVIEWED", "TEACHER_RESPONDED", "SUPERSEDED"];

async function main(): Promise<void> {
  await connectDb();

  const filter = { state: { $in: RELEASED_STATES }, publishedAt: null };
  const candidates = await ClassroomObservation.countDocuments(filter);
  console.log(`CO-8 backfill: ${candidates} released row(s) with no publishedAt.`);

  if (candidates === 0) {
    console.log("Nothing to backfill.");
    await disconnectDb();
    return;
  }

  if (!COMMIT) {
    console.log("DRY-RUN — pass --commit to stamp publishedAt = reviewedAt (fallback updatedAt).");
    await disconnectDb();
    return;
  }

  // publishedAt = reviewedAt where present, else updatedAt (never leave it null on a
  // released row). Mongo aggregation-pipeline update so each row uses its own timestamps.
  const res = await ClassroomObservation.updateMany(filter, [
    { $set: { publishedAt: { $ifNull: ["$reviewedAt", "$updatedAt"] } } },
  ]);
  console.log(`Backfilled ${res.modifiedCount} row(s).`);

  await disconnectDb();
}

main().catch((err) => {
  console.error("backfill failed:", err);
  process.exit(1);
});
