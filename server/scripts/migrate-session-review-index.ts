/**
 * One-time backfill for D-#704: stamp `sessionIndex` on session-plan review rounds.
 *
 * Session-plan rounds are now threaded per SESSION (address + sessionIndex), because every
 * session of a chapter shares the chapter's address. Rounds written before the change carry
 * no `sessionIndex`, so without this backfill:
 *   • an OPEN legacy round matches no session on the plan-review board (the session reads
 *     "unassigned" while a reviewer still has it in their queue), and
 *   • assigning that session again would not supersede it — two open rounds on one plan.
 *
 * Each round's index is read from ITS OWN artifact version (`envelopeJson.payload.
 * session_plan.period_index`), the same field the import keys sessions on. A round whose
 * artifact has no period index is left alone and reported.
 *
 * Dry-run by default; APPLY=1 writes. Idempotent (only rounds missing the field are read).
 *   DOTENV_CONFIG_PATH=<root>/.env npx tsx -r dotenv/config server/scripts/migrate-session-review-index.ts
 *   APPLY=1 DOTENV_CONFIG_PATH=<root>/.env npx tsx -r dotenv/config server/scripts/migrate-session-review-index.ts
 */
import mongoose from "mongoose";
import { ReviewAssignment } from "../src/modules/content/models/ReviewAssignment";
import { ContentArtifact } from "../src/modules/content/models/ContentArtifact";
import { planSessionIndexOf } from "../src/modules/content/services/ReviewService";

async function main(): Promise<void> {
  const apply = process.env.APPLY === "1";
  await mongoose.connect(process.env.MONGODB_URI!);
  console.log("DB:", mongoose.connection.db?.databaseName, apply ? "(APPLY)" : "(dry run)");

  const rounds = await ReviewAssignment.find({
    docType: "session_plan",
    $or: [{ sessionIndex: { $exists: false } }, { sessionIndex: null }],
  }).lean();
  console.log(`session-plan rounds without sessionIndex: ${rounds.length}`);

  let stamped = 0;
  let noIndex = 0;
  for (const r of rounds) {
    const art = await ContentArtifact.findById(r.artifactId).select({ envelopeJson: 1 }).lean();
    const idx = art ? planSessionIndexOf(art as { envelopeJson?: Record<string, unknown> | null }) : null;
    const label = `${r._id} ${r.subject} C${r.classLevel} ${r.anchorWord} ${r.addressNumber} round ${r.roundNumber} [${r.status}]`;
    if (idx == null) {
      noIndex += 1;
      console.log(`  SKIP (artifact has no period index) ${label}`);
      continue;
    }
    console.log(`  ${apply ? "SET" : "WOULD SET"} sessionIndex=${idx} ${label}`);
    if (apply) await ReviewAssignment.updateOne({ _id: r._id }, { $set: { sessionIndex: idx } });
    stamped += 1;
  }

  if (apply) {
    const left = await ReviewAssignment.countDocuments({
      docType: "session_plan",
      $or: [{ sessionIndex: { $exists: false } }, { sessionIndex: null }],
    });
    console.log(`\nstamped=${stamped} skipped=${noIndex} still-missing=${left}`);
    if (left !== noIndex) throw new Error("backfill incomplete — re-run and check the SKIP lines");
  } else {
    console.log(`\nwould stamp=${stamped} would skip=${noIndex}`);
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
