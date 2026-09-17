/**
 * One-time migration for D-#685: make the `examsyllabuses` unique indexes PARTIAL.
 *
 * Why this cannot be left to Mongoose. The class index keeps the same key pattern
 * — `{examId, classId, subject}` — and therefore the same auto-generated NAME
 * (`examId_1_classId_1_subject_1`); only its options changed (it gained a
 * `partialFilterExpression`). Mongoose's `autoIndex` issues `createIndex` and the
 * server answers IndexOptionsConflict for a same-named index with different
 * options. The error is emitted on the model, not thrown at the write, so the
 * deploy looks clean while the OLD non-partial index is still the one enforcing
 * uniqueness.
 *
 * What that costs if it is skipped: a level row has no `classId`, the old index
 * reads a missing field as null, and the FIRST level row inserted takes the
 * (examId, null, subject) slot. Every other level of the same subject then fails
 * with E11000 — exactly the "one Arabic row per exam" the split was built to end.
 *
 * `syncIndexes()` does both halves: it drops indexes the schema no longer
 * declares (including a same-named one whose options differ) and creates the
 * four the schema does. Index-only — no document is read or written.
 *
 * Idempotent. Run once per database:
 *   DOTENV_CONFIG_PATH=<root>/.env npx tsx -r dotenv/config server/scripts/migrate-syllabus-level-index.ts
 */
import mongoose from "mongoose";
import { ExamSyllabus } from "../src/modules/exams/models/ExamSyllabus";

type IndexInfo = { name?: string; key: unknown; unique?: boolean; partialFilterExpression?: unknown };

const fmt = (ix: IndexInfo[]): string =>
  JSON.stringify(
    ix.map((i) => ({
      name: i.name,
      key: i.key,
      unique: !!i.unique,
      partial: i.partialFilterExpression ?? null,
    })),
    null,
    1,
  );

async function main(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI!);
  const coll = ExamSyllabus.collection;

  console.log("DB:", mongoose.connection.db?.databaseName);
  const before = (await coll.indexes()) as IndexInfo[];
  console.log("before:", fmt(before));

  // Reported before the change so the log says what was actually wrong here,
  // rather than asserting a state nobody checked.
  const stale = before.find(
    (i) => i.name === "examId_1_classId_1_subject_1" && i.unique && !i.partialFilterExpression,
  );
  console.log(
    stale
      ? "found the non-partial unique class index — this is the one that would reject level rows"
      : "no non-partial unique class index (already migrated, or a fresh database)",
  );

  await ExamSyllabus.syncIndexes();

  const after = (await coll.indexes()) as IndexInfo[];
  console.log("after:", fmt(after));

  // Assert the outcome rather than trusting syncIndexes' silence.
  const byClass = after.find((i) => i.unique && i.partialFilterExpression &&
    JSON.stringify(i.partialFilterExpression).includes("classId"));
  const byLevel = after.find((i) => i.unique && i.partialFilterExpression &&
    JSON.stringify(i.partialFilterExpression).includes("subjectLevel"));
  if (!byClass || !byLevel) {
    throw new Error("the two partial unique indexes are NOT both present — do not seed level rows");
  }
  console.log("\nOK — both partial unique indexes present. Level rows can be written.");

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
