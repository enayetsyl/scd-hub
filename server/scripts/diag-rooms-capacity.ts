// READ-ONLY: room inventory (is the room dimension of the conflict engine populated?)
// plus per-class active-section list and boys/girls headcount — the inputs to the
// boys/girls-split sizing in docs/teacher-load-analysis-2026-08.md. No writes.
import { readFileSync } from "fs";
import { MongoClient } from "mongodb";
const env = readFileSync("c:/pHero/Hobby/scd/scd-hub/.env", "utf8");
const uri = env.match(/^MONGODB_URI=(.+)$/m)![1].trim();
(async () => {
  const c = new MongoClient(uri); await c.connect();
  const db = c.db("scdhub_prod");
  const rooms = await db.collection("rooms").find({}).toArray();
  console.log(`ROOMS: ${rooms.length}`);
  for (const r of rooms as any[]) console.log(`  ${r.name ?? r.nameBn ?? r.code}  capacity=${r.capacity ?? "-"} active=${r.active}`);
  const slots = await db.collection("routineslots").find({ active: true }).toArray();
  console.log(`slots with a room set: ${slots.filter((s: any) => s.roomId).length} / ${slots.length}`);
  const cls = await db.collection("classes").find({}).sort({ level: 1 }).toArray();
  const secs = await db.collection("sections").find({}).toArray();
  const studs = await db.collection("students").find({ active: true }).toArray();
  console.log("\nCLASS LEVELS + active sections + headcount:");
  for (const k of cls as any[]) {
    const mine = (secs as any[]).filter((s) => String(s.classId) === String(k._id));
    const n = (studs as any[]).filter((s) => String(s.classId) === String(k._id)).length;
    const g = { male: 0, female: 0 } as any;
    for (const s of studs as any[]) if (String(s.classId) === String(k._id)) g[s.gender] = (g[s.gender] ?? 0) + 1;
    console.log(`  L${k.level} ${k.nameBn}  students=${n}  boys=${g.male ?? 0} girls=${g.female ?? 0}  sections=[${mine.map((s: any) => `${s.code}:${s.active}`).join(", ")}]`);
  }
  await c.close();
})();
