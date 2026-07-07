/**
 * Migration (AS-T6, D-#274): pre-AS-T6 AssignmentItems were delivered under the
 * one-phase flow (student records already spawned) and have no `status`. Mark them
 * ISSUED + set estMinutes (default) so they keep showing Collect/Check, not "draft".
 * Idempotent. MUST run before an AS-T6 server serves a DB with old assignment items.
 * DRY-RUN by default; pass --commit.
 *
 *   npx tsx server/scripts/migrate-assignment-item-status.ts [--commit]
 *   SYNC_TO_URI=<uri> npx tsx server/scripts/migrate-assignment-item-status.ts --commit
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
import { mongoose } from "../src/db";

const COMMIT = process.argv.includes("--commit");
const URI = process.env.SYNC_TO_URI ?? process.env.MONGODB_URI!;
const DEFAULT_EST = 20;

async function main(): Promise<void> {
  const conn = await mongoose.createConnection(URI).asPromise();
  try {
    console.log(`DB: ${conn.name}   Mode: ${COMMIT ? "COMMIT" : "DRY-RUN"}\n`);
    const coll = conn.collection("assignmentitems");
    const total = await coll.countDocuments();
    const legacy = await coll.countDocuments({ status: { $exists: false } });
    console.log(`AssignmentItems: ${total} total, ${legacy} legacy (no status).`);

    if (COMMIT && legacy > 0) {
      // status=ISSUED, estMinutes default where missing, issued stamps from delivery,
      // and drop any draftRoster (legacy items already issued their records).
      const rows = await coll.find({ status: { $exists: false } }).toArray();
      for (const it of rows) {
        await coll.updateOne(
          { _id: it._id },
          {
            $set: {
              status: "ISSUED",
              estMinutes: typeof it.estMinutes === "number" ? it.estMinutes : DEFAULT_EST,
              issuedAt: it.deliveredAt ?? new Date(),
              issuedBy: it.deliveredBy,
            },
            $unset: { draftRoster: "" },
          },
        );
      }
    }
    console.log(COMMIT ? `\n${legacy} legacy item(s) marked ISSUED.` : `\nWould mark ${legacy} legacy item(s) ISSUED.`);
  } finally {
    await conn.close();
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
