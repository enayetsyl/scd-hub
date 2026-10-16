/**
 * Load a picture bundle (from extract.py) into `worksheetpictures` (D-#746).
 *
 *   node import.cjs <bundle.json>            # dry run: prints the database + what would change
 *   APPLY=1 node import.cjs <bundle.json>    # writes
 *
 * Connection: MONGODB_URI from the environment, else the first uncommented
 * MONGODB_URI= line of ENV_FILE (default ./.env). The database name is printed first —
 * the repo .env points at scdhub_local, NOT prod (memory: repo-env-is-scdhub-local).
 *
 * Idempotent by `sourceKey` (book:page:index): a re-run refreshes the bytes and size
 * only; tags/active/reserve set in the app are NEVER overwritten (`$setOnInsert`).
 */
const fs = require("fs");
const path = require("path");

function uriFromEnv() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const file = process.env.ENV_FILE || path.resolve(".env");
  const line = fs.readFileSync(file, "utf8").split(/\r?\n/).find((l) => /^MONGODB_URI=/.test(l));
  if (!line) throw new Error(`No MONGODB_URI in ${file}`);
  return line.slice("MONGODB_URI=".length).trim().replace(/^["']|["']$/g, "");
}

async function main() {
  const bundlePath = process.argv[2];
  if (!bundlePath) throw new Error("usage: node import.cjs <bundle.json>");
  const apply = process.env.APPLY === "1";
  const items = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  const { MongoClient } = require(process.env.MONGODB_MODULE || "mongodb");
  const client = new MongoClient(uriFromEnv());
  await client.connect();
  try {
    const db = client.db();
    console.log(`database: ${db.databaseName}  (${apply ? "APPLY" : "dry run"})`);
    const col = db.collection("worksheetpictures");
    const existing = new Set(
      (await col.find({}, { projection: { sourceKey: 1 } }).toArray()).map((d) => d.sourceKey),
    );
    const now = new Date();
    const ops = items.map((x) => ({
      updateOne: {
        filter: { sourceKey: x.sourceKey },
        update: {
          $set: {
            book: x.book,
            page: x.page,
            imageIndex: x.imageIndex,
            image: Buffer.from(x.image, "base64"),
            thumb: Buffer.from(x.thumb, "base64"),
            mime: x.mime,
            width: x.width,
            height: x.height,
            updatedAt: now,
          },
          $setOnInsert: {
            sourceKey: x.sourceKey,
            word: x.word ?? null,
            wordEn: x.wordEn ?? null,
            letter: x.letter ?? null,
            uses: x.uses ?? [],
            active: x.active !== false,
            reserveForFinal: false,
            lastUsedAt: null,
            useCount: 0,
            updatedBy: null,
            createdAt: now,
          },
        },
        upsert: true,
      },
    }));
    const fresh = items.filter((x) => !existing.has(x.sourceKey));
    const byBook = {};
    for (const x of items) byBook[x.book] = (byBook[x.book] || 0) + 1;
    console.log(`bundle: ${items.length} pictures ${JSON.stringify(byBook)}; new: ${fresh.length}; refresh: ${items.length - fresh.length}`);
    if (!apply) return;
    await col.createIndex({ sourceKey: 1 }, { unique: true });
    await col.createIndex({ book: 1, active: 1, page: 1 });
    for (let i = 0; i < ops.length; i += 50) await col.bulkWrite(ops.slice(i, i + 50), { ordered: false });
    console.log(`written. collection now holds ${await col.countDocuments()} pictures`);
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
