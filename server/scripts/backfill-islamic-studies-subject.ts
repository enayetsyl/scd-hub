/**
 * Upsert the foundation Subject row for Islamic Studies into an existing DB.
 *
 * Run from the repo root:
 *   npx tsx server/scripts/backfill-islamic-studies-subject.ts
 *
 * Uses MONGODB_URI from .env and writes only the missing foundation Subject row.
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { connectDb, disconnectDb } from "../src/db";
import { Subject } from "../src/modules/foundation/models/Subject";
import { SUBJECT_LABELS_BN } from "@scd/shared";

async function main(): Promise<void> {
  await connectDb();

  const result = await Subject.updateOne(
    { code: "ISLAM" },
    {
      $set: {
        nameBn: SUBJECT_LABELS_BN.ISLAM,
        active: true,
      },
      $setOnInsert: {
        code: "ISLAM",
      },
    },
    { upsert: true },
  );

  const current = await Subject.findOne({ code: "ISLAM" }).lean();
  console.log(
    current
      ? `Islamic Studies subject present: ${current._id.toString()} (${current.nameBn})`
      : `Islamic Studies subject upsert result acknowledged: ${JSON.stringify(result)}`,
  );

  await disconnectDb();
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
