// READ-ONLY: the Class-3 English test #2 (CT-C3-ENG-0002) whose total marks were
// recorded as 42 but should be 32 (owner report 2026-08-03). Shows the stored values,
// whether any result depends on them, and what the pass mark would be at 32.
import { readFileSync } from "fs";
import { MongoClient } from "mongodb";

const uri = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8").match(/^MONGODB_URI=(.+)$/m)![1].trim();
const CT = process.argv[2] ?? "CT-C3-ENG-0002";
const id = (v: unknown) => (v ? String(v) : "");

async function main() {
  const c = new MongoClient(uri);
  await c.connect();
  const db = c.db("scdhub_prod");
  console.log(`db = ${db.databaseName}`);

  const t = await db.collection("classtests").findOne({ ctId: CT });
  if (!t) {
    console.log(`${CT} not found`);
    await c.close();
    return;
  }
  const users = await db.collection("users").find({}).project({ name: 1 }).toArray();
  const uName = new Map(users.map((u: any) => [id(u._id), u.name]));

  console.log(
    `\n${t.ctId}  _id=${id(t._id)}\n` +
      `  testNumber=${t.testNumber}  status=${t.status}  examDate=${new Date(t.examDate).toISOString().slice(0, 10)}\n` +
      `  totalMarks=${t.totalMarks}   passMark=${t.passMark}\n` +
      `  teacher=${uName.get(id(t.teacherId)) ?? "-"}  source=${t.source}  notes=${t.notes ?? "-"}`,
  );

  const results = await db.collection("classtestresults").find({ testId: t._id }).toArray();
  console.log(`\n  results attached: ${results.length}`);
  for (const r of results as any[])
    console.log(`     student=${id(r.studentId)} status=${r.status} marks=${r.marks} percent=${r.percent} pass=${r.pass} published=${!!r.publishedAt}`);

  const pct = (m: number, total: number) => ((m / total) * 100).toFixed(1);
  console.log(
    `\n  IF totalMarks 42 -> 32:\n` +
      `     pass mark: stored ${t.passMark}; the 40% default at 32 would be ${Math.round(0.4 * 32)}\n` +
      `     every entered mark's % changes (e.g. 20 marks: ${pct(20, 42)}% -> ${pct(20, 32)}%)\n` +
      `     results affected: ${results.length} (0 = nothing to recompute)`,
  );

  await c.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
