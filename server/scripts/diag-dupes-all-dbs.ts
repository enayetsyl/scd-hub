// READ-ONLY: a unique index build FAILS if any duplicate exists, and the app
// autoIndexes on connect — so check every database this cluster serves, not just prod.
import { readFileSync } from "fs";
import { MongoClient } from "mongodb";

const env = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8");
process.env.MONGODB_URI = env.match(/^MONGODB_URI=(.+)$/m)![1].trim();

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const admin = client.db().admin();
  const { databases } = await admin.listDatabases();

  for (const d of databases) {
    if (!d.name.startsWith("scdhub")) continue;
    const db = client.db(d.name);
    const cols = (await db.listCollections().toArray()).map((c) => c.name);
    if (!cols.includes("homeworkitems")) {
      console.log(`${d.name}: no homeworkitems collection`);
      continue;
    }
    const items = await db.collection("homeworkitems").find({}).toArray();
    const g = new Map<string, any[]>();
    for (const it of items) {
      const k = `${it.classId}|${it.sectionId}|${it.subject}|${new Date(it.dateGiven).toISOString().slice(0, 10)}`;
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(it);
    }
    const dupes = [...g.values()].filter((v) => v.length > 1);
    console.log(`\n${d.name}: ${items.length} items, ${dupes.length} duplicate group(s)`);
    for (const v of dupes) {
      console.log(
        `   ${new Date(v[0].dateGiven).toISOString().slice(0, 10)} ${v[0].subject}: ` +
          v.map((i: any) => i.hwId).join(" + "),
      );
    }
  }

  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
