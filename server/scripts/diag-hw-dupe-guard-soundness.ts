// READ-ONLY: is the D-#338 duplicate-declare guard sound going forward?
//   1. has ANY duplicate been created since the guard went live in prod?
//   2. how is dateGiven actually stored — does dayBoundsOf() (server-LOCAL time)
//      build a window that really contains it?
import { readFileSync } from "fs";
import { MongoClient } from "mongodb";

const env = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8");
process.env.MONGODB_URI = env.match(/^MONGODB_URI=(.+)$/m)![1].trim();

/** Guard merged to main 2026-07-19 22:57 +0600 = 16:57Z. */
const GUARD_LIVE = new Date("2026-07-19T16:57:00.000Z");

/** Verbatim copy of HomeworkService.dayBoundsOf — server-LOCAL calendar day. */
function dayBoundsOf(d: Date): { start: Date; end: Date } {
  return {
    start: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0),
    end: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999),
  };
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db("scdhub_prod");
  console.log("DB =", db.databaseName);
  console.log(`process TZ offset = UTC${-new Date().getTimezoneOffset() / 60}, TZ=${process.env.TZ ?? "(unset)"}`);

  const items = await db.collection("homeworkitems").find({}).toArray();

  // --- 1. anything created AFTER the guard went live? ----------------------
  const post = items.filter((i) => new Date(i.createdAt) >= GUARD_LIVE);
  const groups = new Map<string, any[]>();
  for (const it of items) {
    const k = `${it.classId}|${it.sectionId}|${it.subject}|${new Date(it.dateGiven).toISOString().slice(0, 10)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(it);
  }
  const dupeGroups = [...groups.values()].filter((v) => v.length > 1);
  const dupesPostGuard = dupeGroups.filter((v) =>
    v.some((i) => new Date(i.createdAt) >= GUARD_LIVE),
  );
  console.log(`\nitems created since the guard went live: ${post.length}`);
  console.log(`duplicate groups involving a post-guard item: ${dupesPostGuard.length}`);
  for (const v of dupesPostGuard) {
    for (const i of v) console.log(`   ${i.hwId} createdAt=${new Date(i.createdAt).toISOString()}`);
  }

  // --- 2. does the guard's window actually contain the stored value? -------
  console.log(`\n===== dateGiven storage vs the guard window =====`);
  const sample = items.slice(0, 6);
  let misses = 0;
  for (const it of items) {
    const stored = new Date(it.dateGiven);
    // What the resolver would build from the same wire value the client sends.
    const { start, end } = dayBoundsOf(stored);
    const inside = stored >= start && stored <= end;
    if (!inside) misses += 1;
  }
  for (const it of sample) {
    const stored = new Date(it.dateGiven);
    const { start, end } = dayBoundsOf(stored);
    console.log(
      `   ${String(it.hwId).padEnd(17)} stored=${stored.toISOString()} ` +
        `window=[${start.toISOString()} .. ${end.toISOString()}] inside=${stored >= start && stored <= end}`,
    );
  }
  console.log(`   stored values falling OUTSIDE their own guard window: ${misses} / ${items.length}`);

  // --- 3. what does the wire value look like? -----------------------------
  const distinct = new Set(items.map((i) => new Date(i.dateGiven).toISOString().slice(11)));
  console.log(`\n   distinct time-of-day components in dateGiven: ${[...distinct].join(", ")}`);

  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
