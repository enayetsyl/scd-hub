// Purge the "declared but never issued" homework items (see diag-hw-never-marked.ts).
//
// DRY-RUN by default. Pass --apply to actually delete.
// Target DB is explicit via --db (default scdhub_local); prod runs must pass --db scdhub_prod
// ON THE VM, because the repo .env points at the scdhub_local copy (same ObjectIds).
//
// Mirrors the app's own delete semantics (HomeworkService.deleteHomeworkItem, D-#336):
//   - status must be "declared"
//   - the (class, day) must NOT be reconciled — reconciled days are frozen (handoff §4.5)
// Plus our own safety: the item must have ZERO student records.
import { readFileSync, writeFileSync } from "fs";
import { MongoClient } from "mongodb";

const env = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8");
const m = env.match(/^MONGODB_URI=(.+)$/m);
if (m) process.env.MONGODB_URI = m[1].trim();

const APPLY = process.argv.includes("--apply");
const dbArg = process.argv.find((a) => a.startsWith("--db="));
const DB_NAME = dbArg ? dbArg.slice(5) : "scdhub_local";
const TODAY = "2026-07-28";

/** reconDayKey equivalent — the service keys reconciliation by YYYY-MM-DD. */
const dayKey = (d: Date) => new Date(d).toISOString().slice(0, 10);

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db(DB_NAME);
  console.log(`DB = ${db.databaseName}   MODE = ${APPLY ? "APPLY (DESTRUCTIVE)" : "DRY-RUN"}`);

  const users = await db.collection("users").find({}).toArray();
  const userName = new Map(users.map((u) => [u._id.toString(), u.name as string]));
  const classes = await db.collection("classes").find({}).toArray();
  const className = new Map(classes.map((c) => [c._id.toString(), (c.nameBn ?? c.name ?? "") as string]));

  // Candidates: declared, given before today.
  const items = await db
    .collection("homeworkitems")
    .find({ status: "declared", dateGiven: { $lt: new Date(`${TODAY}T00:00:00.000Z`) } })
    .sort({ dateGiven: 1 })
    .toArray();

  const eligible: any[] = [];
  const blocked: string[] = [];

  for (const it of items) {
    const nRecs = await db.collection("homeworkstudentrecords").countDocuments({ hwItemId: it._id });
    const recon = await db.collection("homeworkreconciliations").findOne({
      classId: it.classId,
      reconDate: dayKey(it.dateGiven),
    });
    const reconciled = recon?.reconState === "reconciled";
    const nAttach = (it.attachmentIds?.length ?? 0) + (it.questionFileId ? 1 : 0);

    const line =
      `${it.hwId.padEnd(22)} ${dayKey(it.dateGiven)} ${it.subject.padEnd(5)} ` +
      `${(className.get(String(it.classId)) ?? "").padEnd(18)} ${userName.get(String(it.declaredBy)) ?? "?"}` +
      `  recs=${nRecs} files=${nAttach} recon=${recon?.reconState ?? "none"}`;

    if (nRecs > 0) {
      blocked.push(`SKIP (has ${nRecs} student records) ${line}`);
    } else if (reconciled) {
      blocked.push(`SKIP (day reconciled — frozen) ${line}`);
    } else {
      eligible.push({ it, line, nAttach });
    }
  }

  console.log(`\n=== ELIGIBLE TO DELETE: ${eligible.length} ===`);
  for (const e of eligible) console.log("   " + e.line);
  console.log(`\n=== BLOCKED: ${blocked.length} ===`);
  for (const b of blocked) console.log("   " + b);

  const filesAtRisk = eligible.filter((e) => e.nAttach > 0);
  console.log(`\n=== items carrying attached files (Drive refs would be orphaned): ${filesAtRisk.length} ===`);

  if (!APPLY) {
    console.log("\nDRY-RUN — nothing deleted. Re-run with --apply to delete the ELIGIBLE list.");
    await client.close();
    return;
  }

  // Backup before destroying.
  const backup = `c:/pHero/Hobby/scd/scd-hub/server/scripts/backups/hw-declared-purge-${DB_NAME}.json`;
  writeFileSync(backup, JSON.stringify(eligible.map((e) => e.it), null, 2));
  console.log(`\nBackup written: ${backup}`);

  const ids = eligible.map((e) => e.it._id);
  const res = await db.collection("homeworkitems").deleteMany({ _id: { $in: ids } });
  console.log(`DELETED ${res.deletedCount} homework items.`);

  // Read-back: none of them may survive.
  const left = await db.collection("homeworkitems").countDocuments({ _id: { $in: ids } });
  console.log(`READ-BACK: ${left} of the targeted items remain (expect 0).`);

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
