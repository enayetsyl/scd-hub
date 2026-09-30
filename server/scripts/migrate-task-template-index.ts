/**
 * One-time migration: make the `tasks` template-per-day unique index PARTIAL.
 *
 * The bug. `{templateId, dueKey}` was declared `unique + sparse`. For a COMPOUND
 * index, sparse only skips a document that lacks EVERY indexed field — and every
 * task has `dueKey`. So each manual task (no `templateId`) was indexed as
 * (null, dueKey), and the second manual task due on the same date — for anyone,
 * school-wide — failed with E11000. Found on prod 2026-09-30 while adding a batch
 * of video-upload cards to the Office board: the first card for 1 Oct went in,
 * the second was refused.
 *
 * Why this cannot be left to Mongoose. The fixed index keeps the same key pattern
 * and therefore the same auto-generated NAME (`templateId_1_dueKey_1`); only its
 * options changed. `autoIndex` issues `createIndex`, the server answers
 * IndexOptionsConflict, the error is emitted on the model rather than thrown, and
 * the deploy looks clean while the OLD sparse index keeps rejecting manual tasks.
 *
 * `syncIndexes()` drops the same-named index whose options differ and creates the
 * schema's declared indexes. Index-only — no document is read or written. The old
 * index was unique over templated rows too, so no templated duplicate can exist
 * to block the rebuild.
 *
 * Idempotent. Run once per database, AFTER the model change is deployed:
 *   DOTENV_CONFIG_PATH=<root>/.env npx tsx -r dotenv/config server/scripts/migrate-task-template-index.ts
 */
import mongoose from "mongoose";
import { Task } from "../src/modules/workboard/models/Task";

type IndexInfo = {
  name?: string;
  key: unknown;
  unique?: boolean;
  sparse?: boolean;
  partialFilterExpression?: unknown;
};

const fmt = (ix: IndexInfo[]): string =>
  JSON.stringify(
    ix.map((i) => ({
      name: i.name,
      key: i.key,
      unique: !!i.unique,
      sparse: !!i.sparse,
      partial: i.partialFilterExpression ?? null,
    })),
    null,
    1,
  );

async function main(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI!);
  const coll = Task.collection;

  console.log("DB:", mongoose.connection.db?.databaseName);
  const before = (await coll.indexes()) as IndexInfo[];
  console.log("before:", fmt(before));

  const stale = before.find(
    (i) => i.name === "templateId_1_dueKey_1" && i.unique && !i.partialFilterExpression,
  );
  console.log(
    stale
      ? "found the sparse (non-partial) template index — this is the one rejecting manual tasks"
      : "no non-partial template index (already migrated, or a fresh database)",
  );

  await Task.syncIndexes();

  const after = (await coll.indexes()) as IndexInfo[];
  console.log("after:", fmt(after));

  // Assert the outcome rather than trusting syncIndexes' silence.
  const fixed = after.find(
    (i) =>
      i.name === "templateId_1_dueKey_1" &&
      i.unique &&
      !i.sparse &&
      JSON.stringify(i.partialFilterExpression ?? null).includes("templateId"),
  );
  if (!fixed) {
    throw new Error("the partial template index is NOT present — manual tasks are still limited to one per date");
  }
  console.log("\nOK — partial template index present. Manual tasks are no longer limited to one per date.");

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
