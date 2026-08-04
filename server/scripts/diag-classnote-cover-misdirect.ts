/**
 * Read-only. How often did the class-note alert/prompt go to the WRONG teacher?
 * For every substitution in the last 60 days, the standing slot teacher was alerted
 * and the actual cover was not. Counts the affected (slot, day) pairs and shows how
 * many still have no note written — those are live, misdirected backlog items.
 */
import { readFileSync } from "fs";
import mongoose from "mongoose";

const uri = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8").match(/^MONGODB_URI=(.+)$/m)![1].trim();

async function main(): Promise<void> {
  await mongoose.connect(uri, { dbName: "scdhub_prod" });
  const db = mongoose.connection.db!;
  console.log("reading db =", db.databaseName);

  const since = new Date();
  since.setDate(since.getDate() - 60);

  const subs = await db
    .collection("routinesubstitutions")
    .find({ active: true, date: { $gte: since } })
    .toArray();
  console.log("substitutions in the last 60 days:", subs.length);
  if (subs.length === 0) return;

  const slotIds = [...new Set(subs.map((s) => s.slotId.toString()))].map(
    (id) => new mongoose.Types.ObjectId(id),
  );
  const slots = await db.collection("routineslots").find({ _id: { $in: slotIds } }).toArray();
  const slotById = new Map(slots.map((s) => [s._id.toString(), s]));

  const notes = await db
    .collection("classnotes")
    .find({ slotId: { $in: slotIds }, date: { $gte: since } })
    .project({ slotId: 1, date: 1 })
    .toArray();
  const key = (slotId: unknown, d: Date): string =>
    `${String(slotId)}|${new Date(d).toISOString().slice(0, 10)}`;
  const written = new Set(notes.map((n) => key(n.slotId, n.date as Date)));

  const users = await db.collection("users").find({}).project({ name: 1 }).toArray();
  const nameOf = (id: unknown): string =>
    users.find((u) => u._id.toString() === String(id))?.name ?? String(id);

  let unwritten = 0;
  const rows: string[] = [];
  for (const su of subs) {
    const slot = slotById.get(su.slotId.toString());
    if (!slot) continue;
    const sameTeacher = slot.teacherId && su.coverTeacherId
      && slot.teacherId.toString() === su.coverTeacherId.toString();
    if (sameTeacher) continue; // no misdirection possible
    const k = key(su.slotId, su.date as Date);
    const has = written.has(k);
    if (!has) unwritten += 1;
    rows.push(
      `${new Date(su.date as Date).toISOString().slice(0, 10)}  P${slot.periodNumber} ${slot.subject}` +
        `  alerted=${nameOf(slot.teacherId)}  actually-taught=${nameOf(su.coverTeacherId)}` +
        `  note=${has ? "written" : "MISSING"}`,
    );
  }

  console.log(`\ncovered periods where the alert named the wrong teacher: ${rows.length}`);
  console.log(`  of those, still with NO class note (live misdirected backlog): ${unwritten}\n`);
  for (const r of rows.slice(0, 40)) console.log("  " + r);
  if (rows.length > 40) console.log(`  … and ${rows.length - 40} more`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
