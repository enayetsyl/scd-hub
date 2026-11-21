/**
 * AL-2 (prd-academic-loop-2027 section 9.2 step 5): print the EXACT collection names for the prod -> dev copy,
 * read from the registered models (never hand-typed). Touches no database.
 *
 *   npx tsx server/scripts/dev-copy-collections.ts <dbName>            # --nsInclude flags for <dbName>
 *   npx tsx server/scripts/dev-copy-collections.ts --names             # plain collection names
 *   npx tsx server/scripts/dev-copy-collections.ts --wipe              # the step-3 wipe list (names)
 */
import { COPY_MODELS, WIPE_MODELS, NEVER_COPIED_NOTE, nsIncludeFlags, resolveCollections } from "../src/lib/devData/collections";

const args = process.argv.slice(2);
if (args.includes("--wipe")) {
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
