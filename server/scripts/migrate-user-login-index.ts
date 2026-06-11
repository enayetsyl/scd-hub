/**
 * One-time, IDEMPOTENT migration for D-#60 (email-or-phone staff login).
 *
 * The `users.email` index was created non-sparse (`{ unique: true }`) when email
 * was required. Phone-only staff (no email) cannot be inserted while a non-sparse
 * unique index exists on `email` (a second null email collides). This script
 * drops the old `email_1` index so Mongoose can recreate it sparse on next boot
 * (the model now declares `email: { unique: true, sparse: true }`), and ensures
 * the sparse `email_1` + `phone_1` indexes exist.
 *
 * SAFE to re-run: it only drops the index if it is present AND non-sparse; if the
 * index is already sparse (or absent), it does nothing. No documents are touched.
 *
 * Run from repo root:
 *   npx tsx server/scripts/migrate-user-login-index.ts            # dry-run: report only
 *   npx tsx server/scripts/migrate-user-login-index.ts --commit   # apply
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { connectDb, disconnectDb } from "../src/db";
import { User } from "../src/modules/foundation/models/User";

const COMMIT = process.argv.includes("--commit");

async function main(): Promise<void> {
  console.log(COMMIT ? "Mode: COMMIT (applying)\n" : "Mode: DRY-RUN (no changes; pass --commit to apply)\n");
  await connectDb();

  const coll = User.collection;
  const indexes = await coll.indexes();
  const emailIdx = indexes.find((i) => i.name === "email_1");

  console.log("Current users indexes:");
  for (const i of indexes) {
    console.log(`  - ${i.name}  keys=${JSON.stringify(i.key)} unique=${!!i.unique} sparse=${!!i.sparse}`);
  }
  console.log("");

  const needsDrop = !!emailIdx && !emailIdx.sparse;
  if (!needsDrop) {
    console.log(
      emailIdx
        ? "email_1 is already sparse (or not unique-non-sparse) — nothing to drop."
        : "no email_1 index present — nothing to drop.",
    );
  } else {
    console.log("email_1 is NON-sparse — it must be dropped so the sparse index can replace it.");
    if (COMMIT) {
      await coll.dropIndex("email_1");
      console.log("  ✓ dropped email_1");
    } else {
      console.log("  (dry-run) would drop email_1");
    }
  }

  if (COMMIT) {
    // Recreate indexes from the (updated) model definition: sparse email_1 + phone_1.
    await User.syncIndexes();
    const after = await coll.indexes();
    console.log("\nIndexes after syncIndexes():");
    for (const i of after) {
      console.log(`  - ${i.name}  keys=${JSON.stringify(i.key)} unique=${!!i.unique} sparse=${!!i.sparse}`);
    }
  } else {
    console.log("\n(dry-run) would run User.syncIndexes() to (re)create sparse email_1 + phone_1.");
  }

  await disconnectDb();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
