/**
 * AL-2 (prd-academic-loop-2027 section 9.2 step 5): print the EXACT collection names for the prod -> dev copy,
 * read from the registered models (never hand-typed). Touches no database.
 *
 *   npx tsx server/scripts/dev-copy-collections.ts <dbName>            # bare `--nsInclude=<db>.<coll>` tokens, one per line
 *   npx tsx server/scripts/dev-copy-collections.ts --verify-restore <dumpDir> <prodDb>   # dump count vs dev count table (needs MONGODB_URI = dev)
 *   npx tsx server/scripts/dev-copy-collections.ts --names             # plain collection names
 *   npx tsx server/scripts/dev-copy-collections.ts --wipe              # the step-3 wipe list (names)
 */
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../.env") });
import mongoose from "mongoose";
import { COPY_MODELS, WIPE_MODELS, NEVER_COPIED_NOTE, nsIncludeFlags, resolveCollections } from "../src/lib/devData/collections";

const args = process.argv.slice(2);

/** Number of documents in a mongodump .bson file (each document starts with its int32 little-endian length). */
function countBson(file: string): number {
  if (!fs.existsSync(file)) return 0;
  const buf = fs.readFileSync(file);
  let n = 0;
  for (let o = 0; o + 4 <= buf.length; n++) o += buf.readInt32LE(o);
  return n;
}

async function verifyRestore(dumpDir: string, prodDb: string): Promise<void> {
  const { connectDb, disconnectDb } = await import("../src/db");
  await connectDb();
  let bad = 0;
  try {
    const db = mongoose.connection.db;
    console.log(`dev database: ${db?.databaseName}`);
    console.log("collection".padEnd(34) + "dump".padStart(10) + "dev".padStart(10) + "  ok");
    for (const f of resolveCollections(COPY_MODELS).found) {
      const dump = countBson(path.join(dumpDir, prodDb, `${f.collection}.bson`));
      const dev = (await db?.collection(f.collection).countDocuments({})) ?? -1;
      const ok = dump === dev;
      if (!ok) bad++;
      console.log(f.collection.padEnd(34) + String(dump).padStart(10) + String(dev).padStart(10) + (ok ? "  ok" : "  MISMATCH"));
    }
  } finally {
    await disconnectDb();
  }
  if (bad) {
    console.error(`${bad} collection(s) differ - do NOT mask or delete the dump until this is explained`);
    process.exit(1);
  }
  console.log("all counts match");
}

if (args.includes("--verify-restore")) {
  const [dumpDir, prodDb] = args.filter((a) => !a.startsWith("--"));
  if (!dumpDir || !prodDb) {
    console.error("usage: dev-copy-collections.ts --verify-restore <dumpDir> <prodDb>");
    process.exit(2);
  }
  verifyRestore(dumpDir, prodDb).catch((e) => {
    console.error(String((e as Error)?.message ?? e));
    process.exit(1);
  });
} else if (args.includes("--wipe")) {
  const r = resolveCollections(WIPE_MODELS);
  for (const f of r.found) console.log(f.collection);
  if (r.skipped.length) console.error(`# not built yet (skipped): ${r.skipped.join(", ")}`);
} else if (args.includes("--names")) {
  for (const f of resolveCollections(COPY_MODELS).found) console.log(f.collection);
} else {
  const db = args.find((a) => !a.startsWith("--"));
  if (!db) {
    console.error("usage: dev-copy-collections.ts <dbName> | --names | --wipe");
    process.exit(2);
  }
  for (const flag of nsIncludeFlags(db, COPY_MODELS)) console.log(flag);
  console.error(`# never copied: ${NEVER_COPIED_NOTE}`);
}
