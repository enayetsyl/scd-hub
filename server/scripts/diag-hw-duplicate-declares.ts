// READ-ONLY: can a teacher declare the same class+section+subject+day twice?
// Scan prod for duplicates and date them against the D-#338 guard.
import { readFileSync } from "fs";
import { MongoClient } from "mongodb";

const env = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8");
process.env.MONGODB_URI = env.match(/^MONGODB_URI=(.+)$/m)![1].trim();

const TZ = 6;
const localDay = (d: Date | string) =>
  new Date(new Date(d).getTime() + TZ * 3_600_000).toISOString().slice(0, 10);

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db("scdhub_prod");
  console.log("DB =", db.databaseName);

  const users = await db.collection("users").find({}).toArray();
  const uname = new Map(users.map((u) => [u._id.toString(), u.name as string]));
  const classes = await db.collection("classes").find({}).toArray();
  const cname = new Map(classes.map((c) => [c._id.toString(), (c.nameBn ?? c.name ?? "") as string]));

  const items = await db.collection("homeworkitems").find({}).sort({ createdAt: 1 }).toArray();
  console.log(`live homework items: ${items.length}`);

  // The exact key the D-#338 guard checks.
  const groups = new Map<string, any[]>();
  for (const it of items) {
    const k = `${it.classId}|${it.sectionId}|${it.subject}|${localDay(it.dateGiven)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(it);
  }

  const dupes = [...groups.entries()].filter(([, v]) => v.length > 1);
  console.log(`\n########## DUPLICATE class+section+subject+day GROUPS: ${dupes.length} ##########\n`);

  for (const [k, v] of dupes.sort((a, b) => localDay(a[1][0].dateGiven).localeCompare(localDay(b[1][0].dateGiven)))) {
    const [classId] = k.split("|");
    console.log(
      `${localDay(v[0].dateGiven)}  ${cname.get(classId) ?? classId}  ${v[0].subject}  x${v.length}`,
    );
    for (const it of v.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())) {
      console.log(
        `   ${String(it.hwId).padEnd(18)} createdAt=${new Date(it.createdAt).toISOString()} ` +
          `by=${uname.get(String(it.declaredBy)) ?? "?"} status=${it.status} desc="${(it.description ?? "").slice(0, 30)}"`,
      );
    }
    // How far apart were the two creations? Seconds apart = a double-submit race.
    const times = v.map((i: any) => new Date(i.createdAt).getTime()).sort((a: number, b: number) => a - b);
    for (let i = 1; i < times.length; i++) {
      const gapSec = Math.round((times[i] - times[i - 1]) / 1000);
      console.log(
        `   -> gap between creations: ${gapSec}s` +
          (gapSec <= 10 ? "   <<< RACE: both passed the findOne check before either insert" : ""),
      );
    }
    console.log("");
  }

  // Is there a DB-level unique index backing the guard?
  const idx = await db.collection("homeworkitems").indexes();
  console.log("===== indexes on homeworkitems =====");
  for (const i of idx) console.log(`   ${i.name} ${JSON.stringify(i.key)} unique=${!!i.unique}`);
  const hasGuardIndex = idx.some(
    (i) => i.unique && i.key.classId && i.key.sectionId && i.key.subject && i.key.dateGiven,
  );
  console.log(
    `\nunique index on (classId, sectionId, subject, dateGiven): ${hasGuardIndex ? "YES" : "NO — the guard is application-only"}`,
  );

  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
