// Build the unique index that backs the D-#338 duplicate-declare rule:
//   homeworkitems (classId, sectionId, subject, dateGiven) UNIQUE
//
//   npx tsx server/scripts/migrate-hw-unique-day-index.ts --db=scdhub_prod [--apply]
//
// Idempotent and safe to re-run. Refuses to build while ANY duplicate exists —
// a unique index build fails on duplicates, and a silent failure would leave the
// rule looking enforced when it is not. The app also autoIndexes on connect, so
// this script mainly exists to (a) verify BEFORE a deploy and (b) report clearly
// when the build is blocked.
import { readFileSync } from "fs";
import { MongoClient } from "mongodb";

const env = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8");
process.env.MONGODB_URI = env.match(/^MONGODB_URI=(.+)$/m)![1].trim();

const APPLY = process.argv.includes("--apply");
const dbArg = process.argv.find((a) => a.startsWith("--db="));
const DB_NAME = dbArg ? dbArg.slice(5) : "scdhub_local";

const INDEX_NAME = "uniq_class_section_subject_day";
const KEY = { classId: 1, sectionId: 1, subject: 1, dateGiven: 1 } as const;

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db(DB_NAME);
  const col = db.collection("homeworkitems");
  console.log(`DB = ${db.databaseName}   MODE = ${APPLY ? "APPLY" : "DRY-RUN"}`);

  const existing = await col.indexes();
  const already = existing.find((i) => i.name === INDEX_NAME);
  if (already) {
    console.log(`index ${INDEX_NAME} already exists: ${JSON.stringify(already.key)} unique=${!!already.unique}`);
    await client.close();
    return;
  }

  // Pre-flight: the build fails if any duplicate remains.
  const items = await col.find({}).toArray();
  const groups = new Map<string, any[]>();
  for (const it of items) {
    const k = `${it.classId}|${it.sectionId}|${it.subject}|${new Date(it.dateGiven).toISOString()}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(it);
  }
  const dupes = [...groups.values()].filter((v) => v.length > 1);
  console.log(`items=${items.length}  duplicate groups=${dupes.length}`);
  for (const v of dupes) {
    console.log(
      `   BLOCKER ${new Date(v[0].dateGiven).toISOString().slice(0, 10)} ${v[0].subject}: ` +
        v.map((i: any) => i.hwId).join(" + "),
    );
  }
  if (dupes.length > 0) {
    console.log(`\nABORT — resolve the duplicate(s) first (purge-hw-items.ts), then re-run.`);
    await client.close();
    process.exit(1);
  }

  if (!APPLY) {
    console.log(`\nDRY-RUN — no duplicates, the index would build cleanly. Re-run with --apply.`);
    await client.close();
    return;
  }

  await col.createIndex(KEY, { unique: true, name: INDEX_NAME });
  const after = (await col.indexes()).find((i) => i.name === INDEX_NAME);
  console.log(`\nBUILT: ${after?.name} ${JSON.stringify(after?.key)} unique=${!!after?.unique}`);

  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
