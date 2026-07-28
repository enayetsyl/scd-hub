// Executed proof that the unique index actually REJECTS a duplicate declare.
// Clones a real item's key, attempts the insert, expects E11000, and removes any
// stray doc. Read-only in effect: nothing is left behind either way.
import { readFileSync } from "fs";
import { MongoClient, ObjectId } from "mongodb";

const env = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8");
process.env.MONGODB_URI = env.match(/^MONGODB_URI=(.+)$/m)![1].trim();

const dbArg = process.argv.find((a) => a.startsWith("--db="));
const DB_NAME = dbArg ? dbArg.slice(5) : "scdhub_local";

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db(DB_NAME);
  const col = db.collection("homeworkitems");
  console.log(`DB = ${db.databaseName}`);

  const victim = await col.findOne({});
  if (!victim) throw new Error("no homework items to clone a key from");
  console.log(`cloning the key of ${victim.hwId} (${new Date(victim.dateGiven).toISOString().slice(0, 10)} ${victim.subject})`);

  const probeId = new ObjectId();
  const probe = {
    _id: probeId,
    hwId: `ZZ-PROBE-${Date.now()}`, // unique, so ONLY the day index can reject this
    academicYearId: victim.academicYearId,
    classId: victim.classId,
    classLevel: victim.classLevel,
    sectionId: victim.sectionId,
    subject: victim.subject,
    dateGiven: victim.dateGiven,
    topTags: ["PROBE"],
    timeDecl: 0,
    qCount: 0,
    selectedQids: [],
    revItem: false,
    status: "declared",
    declaredBy: victim.declaredBy,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  let rejected = false;
  let detail = "";
  try {
    await col.insertOne(probe as never);
  } catch (err) {
    const e = err as { code?: number; keyPattern?: unknown };
    rejected = e?.code === 11000;
    detail = `code=${e?.code} keyPattern=${JSON.stringify(e?.keyPattern)}`;
  }

  // Belt and braces: if it somehow inserted, take it straight back out.
  const stray = await col.deleteOne({ _id: probeId });
  console.log(`\nduplicate insert rejected: ${rejected ? "YES" : "NO"}   ${detail}`);
  console.log(`stray probe rows removed: ${stray.deletedCount} (expect 0 when rejected)`);
  console.log(rejected ? "\nPASS — the rule is enforced by the database." : "\nFAIL — a duplicate was accepted!");

  await client.close();
  if (!rejected) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
