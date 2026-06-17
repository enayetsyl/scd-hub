/**
 * One-time migration: drop the stale UNIQUE index `hwItemId_1_studentId_1` on
 * `homeworkstudentrecords` and re-create it NON-unique to match the current schema.
 *
 * Why: HW-T3 resubmissions are a SECOND record for the same (hwItemId, studentId),
 * distinguished by `resubOf` — so the schema marks that index non-unique. Databases
 * seeded under an earlier (unique) schema kept the old index, because Mongoose names
 * an index by its keys and won't recreate a same-named index when only `unique`
 * changed. The leftover unique index makes the Wrong→resubmission spawn fail with
 * E11000. Idempotent + safe (index-only, no document writes). Run per database:
 *   DOTENV_CONFIG_PATH=<root>/.env npx tsx -r dotenv/config server/scripts/migrate-hw-record-index.ts
 */
import mongoose from "mongoose";
import { HomeworkStudentRecord } from "../src/modules/trackers/models/HomeworkStudentRecord";

const STALE = "hwItemId_1_studentId_1";

async function main(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI!);
  const coll = HomeworkStudentRecord.collection;
  const fmt = (ix: { name?: string; key: unknown; unique?: boolean }[]) =>
    ix.map((i) => ({ name: i.name, key: i.key, unique: !!i.unique }));

  const before = await coll.indexes();
  console.log("DB:", mongoose.connection.db?.databaseName);
  console.log("before:", JSON.stringify(fmt(before)));

  const stale = before.find((i) => i.name === STALE && i.unique);
  if (stale) {
    await coll.dropIndex(STALE);
    console.log(`dropped stale UNIQUE ${STALE}`);
  } else {
    console.log(`no stale unique ${STALE} (nothing to drop)`);
  }

  // Recreate every schema index (the non-unique (hwItemId,studentId) + the rest).
  await HomeworkStudentRecord.syncIndexes();

  const after = await coll.indexes();
  console.log("after:", JSON.stringify(fmt(after)));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
