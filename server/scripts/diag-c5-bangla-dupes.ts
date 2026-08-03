// READ-ONLY: the full Class-5 Bangla class-test family in scdhub_prod — which rows are
// duplicates, which one is published, and what each row would take with it if removed
// (results, print requests, question requests). Feeds the retire-vs-delete decision.
// No writes.
import { readFileSync } from "fs";
import { MongoClient } from "mongodb";

const uri = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8").match(/^MONGODB_URI=(.+)$/m)![1].trim();
const id = (v: unknown) => (v ? String(v) : "");
const day = (d: unknown) => (d ? new Date(d as Date).toISOString().replace("T", " ").slice(0, 16) : "-");

async function main() {
  const c = new MongoClient(uri);
  await c.connect();
  const db = c.db("scdhub_prod");
  console.log(`default db = ${c.db().databaseName}   TARGET db = ${db.databaseName}`);

  const users = await db.collection("users").find({}).project({ name: 1 }).toArray();
  const uName = new Map(users.map((u: any) => [id(u._id), u.name]));

  const tests = await db.collection("classtests").find({ ctId: /^CT-C5-BAN-/ }).sort({ ctId: 1 }).toArray();
  console.log(`\n=== CLASS-5 BANGLA CLASS TESTS: ${tests.length} ===`);

  for (const t of tests as any[]) {
    const results = await db.collection("classtestresults").find({ testId: t._id }).toArray();
    const published = (results as any[]).filter((r) => r.publishedAt);
    const submitted = (results as any[]).filter((r) => r.submittedAt);
    const prints = await db
      .collection("printrequests")
      .find({ $or: [{ classTestId: t._id }, { sourceId: t._id }] })
      .toArray();
    const qreqs = await db.collection("classtestquestionrequests").find({ testId: t._id }).toArray();

    console.log(
      `\n  ${t.ctId}  _id=${id(t._id)}\n` +
        `     testNumber=${t.testNumber}  status=${t.status}  examDate=${day(t.examDate)}\n` +
        `     totalMarks=${t.totalMarks}  passMark=${t.passMark}  source=${t.source}  setId=${id(t.setId) || "-"}  questionFileId=${id(t.questionFileId) || "-"}\n` +
        `     teacher=${uName.get(id(t.teacherId)) ?? id(t.teacherId)}  requestedBy=${uName.get(id(t.requestedBy)) ?? "-"}  requestedAt=${day(t.requestedAt)}\n` +
        `     printedBy=${uName.get(id(t.printedBy)) ?? "-"}  printedAt=${day(t.printedAt)}  createdAt=${day(t.createdAt)}\n` +
        `     RESULTS=${results.length}  submitted=${submitted.length}  published=${published.length}\n` +
        `     printRequests=${prints.length}${(prints as any[]).map((p) => ` [${p.status}${p.deliveredAt ? ` delivered ${day(p.deliveredAt)}` : ""}]`).join("")}\n` +
        `     questionRequests=${qreqs.length}${(qreqs as any[]).map((q) => ` [${q.status}]`).join("")}`,
    );
  }

  console.log("\n=== SAME-PAPER CHECK (identical questionFileId / setId ⇒ literally the same paper) ===");
  const byPaper = new Map<string, string[]>();
  for (const t of tests as any[]) {
    const k = `${id(t.questionFileId) || "-"}|${id(t.setId) || "-"}`;
    if (!byPaper.has(k)) byPaper.set(k, []);
    byPaper.get(k)!.push(`${t.ctId}(${t.status},${t.totalMarks}m)`);
  }
  for (const [k, v] of byPaper) console.log(`  paper ${k}\n     ${v.join(", ")}`);

  await c.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
