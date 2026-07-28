// READ-ONLY — corrected "never collected" survey.
//
// v1 (diag-hw-never-marked.ts) treated ABSENT_REDELIVER as teacher input. WRONG:
// issueHomeworkItem stamps it automatically from attendance (present→GIVEN,
// absent→ABSENT_REDELIVER, HomeworkService.ts:623). So an item where the only
// stamps were auto-absent looked "collected" and was excluded.
//
// Correct discriminators:
//   - SUBMITTED / CHECKED / RESUBMIT / RETURNED  = always a teacher action
//   - DUE / ABSENT_REDELIVER carrying a real `by` = a teacher action
//       (D-#338 stamps the acting user; the auto due-sweep and the auto-issue
//        sentinel leave `by` absent or all-zero)
// An item is UNCOLLECTED when not one of its records ever got any of those.
import { readFileSync } from "fs";
import { MongoClient } from "mongodb";

const env = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8");
process.env.MONGODB_URI = env.match(/^MONGODB_URI=(.+)$/m)![1].trim();

const SYSTEM_ACTOR = "000000000000000000000000";
const ALWAYS_TEACHER = new Set(["SUBMITTED", "CHECKED", "RESUBMIT", "RETURNED"]);
const TODAY = "2026-07-28";

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db("scdhub_prod");
  console.log("DB =", db.databaseName);

  const users = await db.collection("users").find({}).toArray();
  const uname = new Map(users.map((u) => [u._id.toString(), u.name as string]));
  const classes = await db.collection("classes").find({}).toArray();
  const cname = new Map(classes.map((c) => [c._id.toString(), (c.nameBn ?? c.name ?? "") as string]));

  const items = await db.collection("homeworkitems").find({}).sort({ dateGiven: 1 }).toArray();
  const recs = await db.collection("homeworkstudentrecords").find({}).toArray();
  const byItem = new Map<string, any[]>();
  for (const r of recs) {
    const k = String(r.hwItemId);
    if (!byItem.has(k)) byItem.set(k, []);
    byItem.get(k)!.push(r);
  }
  console.log(`items=${items.length} records=${recs.length}`);

  const rows: any[] = [];
  for (const it of items) {
    const rs = byItem.get(String(it._id)) ?? [];
    let touched = false;
    for (const r of rs) {
      for (const st of (r.stateDates ?? []) as Array<{ state: string; by?: any }>) {
        const by = st.by ? String(st.by) : null;
        const realActor = !!by && by !== SYSTEM_ACTOR;
        if (ALWAYS_TEACHER.has(st.state) || realActor) { touched = true; break; }
      }
      if (touched) break;
    }
    if (touched) continue;

    const byState: Record<string, number> = {};
    for (const r of rs) byState[r.state] = (byState[r.state] ?? 0) + 1;
    const date = new Date(it.dateGiven).toISOString().slice(0, 10);
    rows.push({
      hwId: it.hwId,
      date,
      subject: it.subject,
      cls: cname.get(String(it.classId)) ?? "",
      teacher: uname.get(String(it.declaredBy)) ?? "?",
      status: it.status,
      n: rs.length,
      states: byState,
      absent: byState["ABSENT_REDELIVER"] ?? 0,
      fresh: date >= TODAY,
    });
  }

  const stuck = rows.filter((r) => !r.fresh);
  console.log(`\n########## UNCOLLECTED (corrected): ${rows.length}  |  stuck=${stuck.length} fresh=${rows.length - stuck.length} ##########`);
  console.log(`(v1 reported only 7 — it cleared any item whose students were auto-marked absent)\n`);

  const byTeacher = new Map<string, any[]>();
  for (const r of stuck) {
    if (!byTeacher.has(r.teacher)) byTeacher.set(r.teacher, []);
    byTeacher.get(r.teacher)!.push(r);
  }
  for (const [t, list] of [...byTeacher.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`--- ${t}: ${list.length} ---`);
    for (const r of list.sort((a, b) => a.date.localeCompare(b.date))) {
      console.log(
        `   ${r.date} ${r.cls.padEnd(16)} ${r.subject.padEnd(5)} ${r.hwId.padEnd(20)} ` +
          `status=${r.status} recs=${r.n} ${JSON.stringify(r.states)}`,
      );
    }
  }

  const tallyC = new Map<string, number>();
  const tallyS = new Map<string, number>();
  for (const r of stuck) {
    tallyC.set(r.cls, (tallyC.get(r.cls) ?? 0) + 1);
    tallyS.set(r.subject, (tallyS.get(r.subject) ?? 0) + 1);
  }
  console.log("\n=== BY CLASS ===");
  for (const [c, n] of [...tallyC].sort((a, b) => b[1] - a[1])) console.log(`   ${c}: ${n}`);
  console.log("=== BY SUBJECT ===");
  for (const [s, n] of [...tallyS].sort((a, b) => b[1] - a[1])) console.log(`   ${s}: ${n}`);

  const recCount = stuck.reduce((n, r) => n + r.n, 0);
  console.log(`\n=== student records carried by the ${stuck.length} stuck items: ${recCount} ===`);

  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
