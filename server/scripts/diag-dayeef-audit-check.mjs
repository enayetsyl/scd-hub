// READ-ONLY: confirm the two revert audit rows landed and nothing else moved.
import { readFileSync } from "fs";
import { MongoClient, ObjectId } from "mongodb";
const uri = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env","utf8").match(/^MONGODB_URI=(.+)$/m)[1].trim();
const c = new MongoClient(uri); await c.connect();
const db = c.db("scdhub_prod");
console.log("db =", db.databaseName);
const rows = await db.collection("audits").find({ eventKind: "HW_RECORD_REVERTED", targetId: new ObjectId("6a6b1b890dc3bda8b5a35623") }).sort({ eventAt: 1 }).toArray();
console.log(`HW_RECORD_REVERTED rows: ${rows.length}`);
for (const r of rows) console.log(`  ${new Date(r.eventAt).toISOString()} actor=${r.actorId} ${r.meta.revertedFrom} -> ${r.meta.restoredTo} popped=${JSON.stringify(r.meta.popped.map(p=>p.state))}`);
const rec = await db.collection("homeworkstudentrecords").findOne({ _id: new ObjectId("6a6b1b890dc3bda8b5a35623") });
console.log(`record now: state=${rec.state} result=${rec.result ?? "-"} stamps=${rec.stateDates.length}`);
const sibs = await db.collection("homeworkstudentrecords").countDocuments({ hwItemId: rec.hwItemId });
console.log(`sibling records on the same item (untouched): ${sibs}`);
await c.close();
