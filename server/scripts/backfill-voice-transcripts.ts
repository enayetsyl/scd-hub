/**
 * One-off backfill for review voice-note transcripts (VN-T1, D-#1662). Clips that were SENT before the
 * feature went live have no transcript. This queues them: it sets transcriptStatus PENDING, tries 0 and
 * an attempt time in the past, so the scheduler's retry sweep (a few per tick, max 3 attempts) transcribes
 * them. It makes NO Gemini call itself. Idempotent: clips that already have a transcript (DONE) or are
 * already queued (PENDING / QUOTA / FAILED) are left alone; OFF / NO_KEY clips are re-queued so a key
 * saved later picks them up.
 *
 * DRY-RUN by default; pass --commit to write. Uses MONGODB_URI from env (never printed).
 *
 *   npx tsx server/scripts/backfill-voice-transcripts.ts            # dry-run (counts only)
 *   npx tsx server/scripts/backfill-voice-transcripts.ts --commit   # apply
 *   npx tsx server/scripts/backfill-voice-transcripts.ts --retry-failed [--commit]
 *                                          # ALSO re-queue QUOTA / FAILED clips, tries reset to 0
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { connectDb, disconnectDb } from "../src/db";
import { ReviewVoiceNote } from "../src/modules/content/models/ReviewVoiceNote";

const COMMIT = process.argv.includes("--commit");
const RETRY_FAILED = process.argv.includes("--retry-failed");

async function main(): Promise<void> {
  await connectDb();
  const filter = {
    submitted: true,
    $or: [{ transcriptStatus: { $exists: false } }, { transcriptStatus: { $in: RETRY_FAILED ? ["OFF", "NO_KEY", "QUOTA", "FAILED"] : ["OFF", "NO_KEY"] } }],
  };
  const candidates = await ReviewVoiceNote.countDocuments(filter);
  console.log(`VN-T1 backfill: ${candidates} sent clip(s) without a transcript.`);
  if (candidates > 0 && COMMIT) {
    const res = await ReviewVoiceNote.updateMany(filter, {
      $set: { transcriptStatus: "PENDING", transcriptTries: 0, transcriptAttemptAt: new Date(0) },
    });
    console.log(`Queued ${res.modifiedCount} clip(s); the scheduler transcribes them a few per tick.`);
  } else if (candidates > 0) {
    console.log("DRY-RUN — pass --commit to queue them.");
  }
  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
