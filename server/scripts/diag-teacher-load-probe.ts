// READ-ONLY probe: which databases exist on the cluster and how much routine/leave/
// attendance data each holds, so the load analysis reads the right one.
import { readFileSync } from "fs";
import { MongoClient } from "mongodb";

const env = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8");
const uri = env.match(/^MONGODB_URI=(.+)$/m)![1].trim();

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const admin = client.db().admin();
  const { databases } = await admin.listDatabases();
  for (const d of databases) {
    if (["admin", "local", "config"].includes(d.name)) continue;
    const db = client.db(d.name);
    const counts: Record<string, number> = {};
    for (const c of [
      "staffprofiles",
      "users",
      "routineslots",
      "staffleaveapplications",
      "teacherattendancedays",
      "sections",
      "subjectgroups",
      "students",
    ]) {
      counts[c] = await db.collection(c).countDocuments();
    }
    console.log(`\n=== ${d.name} ===`);
    console.log(JSON.stringify(counts, null, 2));
    const latest = await db
      .collection("teacherattendancedays")
      .find({})
      .sort({ dateKey: -1 })
      .limit(1)
      .toArray();
    console.log(`  latest attendance dateKey = ${latest[0]?.dateKey ?? "none"}`);
    const latestLeave = await db
      .collection("staffleaveapplications")
      .find({})
      .sort({ fromKey: -1 })
      .limit(1)
      .toArray();
    console.log(`  latest leave fromKey = ${latestLeave[0]?.fromKey ?? "none"}`);
  }
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
